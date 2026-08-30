/**
 * One-time ETL: read the two source spreadsheets and (re)create them as two
 * Monday.com boards ("Deals" and "Work Orders").
 *
 * Design choices:
 *  - Data is loaded into Monday *as-is* (raw strings, original formats). Monday is
 *    treated as the messy system-of-record. All cleaning / normalisation happens
 *    at query time in src/data/store.js — that is the "agent normalises data"
 *    requirement, and keeps Monday a faithful mirror of the source.
 *  - Money columns are created as `numbers` (safe, always numeric/blank); every
 *    other column is `text` so nothing is silently dropped.
 *  - Re-running is safe: pass --recreate to delete & rebuild, otherwise the
 *    script refuses to touch an existing non-empty board.
 *
 * Usage:
 *   node scripts/importToMonday.js --deals "../Deal funnel Data.xlsx" \
 *        --work-orders "../Work_Order_Tracker Data.xlsx" [--recreate]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { config } from '../src/config.js';
import { mondayRequest, listBoards, getAccountInfo } from '../src/monday/client.js';
import { DEALS_BOARD, WORK_ORDERS_BOARD } from '../src/data/schema.js';
import { log } from '../src/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const RECREATE = process.argv.includes('--recreate');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Spreadsheet reading
// ---------------------------------------------------------------------------
function readSheet(filePath, headerTokens) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
  if (!fs.existsSync(abs)) throw new Error(`Source file not found: ${abs}`);
  const wb = XLSX.readFile(abs, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

  // Find the header row (some sheets have blank leading rows)
  const tokenSet = new Set(headerTokens.map((t) => t.toLowerCase().trim()));
  let headerIdx = matrix.findIndex((row) => {
    const cells = row.map((c) => String(c ?? '').toLowerCase().trim());
    return [...tokenSet].filter((t) => cells.includes(t)).length >= 2;
  });
  if (headerIdx === -1) headerIdx = 0;

  const header = matrix[headerIdx].map((c) => String(c ?? '').trim());
  const rows = [];
  let skippedHeaderDupes = 0;

  for (let r = headerIdx + 1; r < matrix.length; r += 1) {
    const row = matrix[r];
    if (!row || row.every((c) => c === '' || c === null || c === undefined)) continue;

    const rec = {};
    header.forEach((h, i) => {
      if (h) rec[h] = row[i];
    });

    // Skip stray repeated header rows embedded in the data
    const vals = Object.values(rec).map((v) => String(v ?? '').toLowerCase().trim());
    const headerHits = [...tokenSet].filter((t) => vals.includes(t)).length;
    if (headerHits >= 2) {
      skippedHeaderDupes += 1;
      continue;
    }
    rows.push(rec);
  }

  log.info(`Read ${path.basename(abs)}: ${rows.length} data rows (skipped ${skippedHeaderDupes} stray header rows)`);
  return { header, rows };
}

/** Convert a raw cell to the string we store in Monday (faithful to source). */
function cellToText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    return v.toISOString().slice(0, 10); // YYYY-MM-DD
  }
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

// ---------------------------------------------------------------------------
// Monday board building
// ---------------------------------------------------------------------------
async function findBoardByName(name) {
  const boards = await listBoards();
  return boards.find((b) => b.name.trim().toLowerCase() === name.trim().toLowerCase());
}

async function deleteBoard(id) {
  await mondayRequest(`mutation ($id: ID!) { delete_board(board_id: $id) { id } }`, { id });
}

async function createBoard(name) {
  const data = await mondayRequest(
    `mutation ($name: String!, $ws: ID!) {
       create_board(board_name: $name, board_kind: public, workspace_id: $ws) { id name }
     }`,
    { name, ws: config.monday.workspaceId },
  );
  return data.create_board;
}

async function getBoardColumns(boardId) {
  const data = await mondayRequest(
    `query ($id: [ID!]) { boards(ids: $id) { columns { id title type } items_count } }`,
    { id: [boardId] },
  );
  return data.boards[0];
}

async function createColumn(boardId, title, columnType) {
  const data = await mondayRequest(
    `mutation ($board: ID!, $title: String!, $type: ColumnType!) {
       create_column(board_id: $board, title: $title, column_type: $type) { id title type }
     }`,
    { board: boardId, title, type: columnType },
  );
  return data.create_column;
}

function importTypeFor(col) {
  return col.type === 'numbers' ? 'numbers' : 'text';
}

function buildColumnValues(rec, schema, colIdByTitle) {
  const cv = {};
  for (const col of schema.columns) {
    const raw = rec[col.src];
    const text = cellToText(raw);
    if (text === '') continue;
    const colId = colIdByTitle.get(col.title);
    if (!colId) continue;
    if (importTypeFor(col) === 'numbers') {
      const n = Number(String(text).replace(/[^0-9.\-]/g, ''));
      if (Number.isFinite(n)) cv[colId] = String(n);
    } else {
      cv[colId] = text;
    }
  }
  return cv;
}

async function buildBoard(schema, boardName, sheet) {
  let board = await findBoardByName(boardName);

  if (board) {
    const info = await getBoardColumns(board.id);
    if (info.items_count > 0 && !RECREATE) {
      throw new Error(
        `Board "${boardName}" already exists with ${info.items_count} items. ` +
        `Re-run with --recreate to rebuild it.`,
      );
    }
    if (RECREATE) {
      log.warn(`Deleting existing board "${boardName}" (${board.id})`);
      await deleteBoard(board.id);
      board = null;
    }
  }

  if (!board) {
    board = await createBoard(boardName);
    log.info(`Created board "${boardName}" -> ${board.id}`);
  }

  // Ensure columns exist
  let existing = await getBoardColumns(board.id);
  const colIdByTitle = new Map(existing.columns.map((c) => [c.title, c.id]));

  for (const col of schema.columns) {
    if (colIdByTitle.has(col.title)) continue;
    const created = await createColumn(board.id, col.title, importTypeFor(col));
    colIdByTitle.set(col.title, created.id);
    log.info(`  + column "${col.title}" (${importTypeFor(col)})`);
    await sleep(120);
  }

  // Create items in batches (aliased mutations) to minimise request count.
  // Monday charges ~30k complexity per create_item and 1,000,000 / 60s, so this
  // is throughput-bound at ~30 items/min; the client self-paces on the headers.
  const nameHeader = schema.nameSourceHeader;
  const BATCH = 6;
  const allRows = sheet.rows.map((rec, i) => ({
    name: (cellToText(rec[nameHeader]) || `(unnamed ${schema.key} ${i + 1})`).slice(0, 255),
    cv: JSON.stringify(buildColumnValues(rec, schema, colIdByTitle)),
  }));

  // Resume support: skip rows already present on the board
  existing = await getBoardColumns(board.id);
  const already = existing.items_count || 0;
  const rows = allRows.slice(already);
  if (already) log.info(`  resuming: ${already} items already on board, ${rows.length} to go`);

  let created = already;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const varDefs = ['$board: ID!'];
    const fields = [];
    const vars = { board: board.id };
    chunk.forEach((row, j) => {
      varDefs.push(`$n${j}: String!`, `$c${j}: JSON!`);
      fields.push(
        `i${j}: create_item(board_id: $board, item_name: $n${j}, column_values: $c${j}) { id }`,
      );
      vars[`n${j}`] = row.name;
      vars[`c${j}`] = row.cv;
    });
    const mutation = `mutation (${varDefs.join(', ')}) { ${fields.join('\n')} }`;
    await mondayRequest(mutation, vars);
    created += chunk.length;
    log.info(`  ...${created}/${allRows.length} items`);
  }
  log.info(`Board "${boardName}": ${created} items created`);
  return board.id;
}

// ---------------------------------------------------------------------------
// .env write-back
// ---------------------------------------------------------------------------
function updateEnv(updates) {
  const envPath = path.resolve(__dirname, '..', '.env');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  for (const [k, v] of Object.entries(updates)) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    if (re.test(content)) content = content.replace(re, `${k}=${v}`);
    else content += `\n${k}=${v}`;
  }
  fs.writeFileSync(envPath, content.trim() + '\n');
  log.info(`Wrote board ids to ${envPath}`);
}

// ---------------------------------------------------------------------------
async function main() {
  const acct = await getAccountInfo();
  log.info(`Connected to Monday as ${acct.me.name} (${acct.me.email}) / account "${acct.account.name}" [${acct.account.tier}]`);

  const dealsFile = arg('deals', 'Deal funnel Data.xlsx');
  const woFile = arg('work-orders', 'Work_Order_Tracker Data.xlsx');

  const dealsSheet = readSheet(dealsFile, DEALS_BOARD.headerTokens);
  const woSheet = readSheet(woFile, WORK_ORDERS_BOARD.headerTokens);

  const dealsBoardId = await buildBoard(DEALS_BOARD, config.monday.dealsBoardName, dealsSheet);
  const woBoardId = await buildBoard(WORK_ORDERS_BOARD, config.monday.workOrdersBoardName, woSheet);

  updateEnv({
    MONDAY_DEALS_BOARD_ID: dealsBoardId,
    MONDAY_WORK_ORDERS_BOARD_ID: woBoardId,
  });

  log.info('Import complete.');
  log.info(`  Deals board:       https://monday.com/boards/${dealsBoardId}`);
  log.info(`  Work Orders board: https://monday.com/boards/${woBoardId}`);
}

main().catch((err) => {
  log.error(err.stack || err.message);
  process.exit(1);
});
