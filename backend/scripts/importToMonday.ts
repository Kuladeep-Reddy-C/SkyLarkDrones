/**
 * One-time ETL: read the two source spreadsheets and (re)create them as two
 * Monday.com boards ("Deals" and "Work Orders").
 *
 *  - Data is loaded into Monday *as-is* (raw strings, original formats). Monday is
 *    the messy system-of-record; all cleaning happens at query time in
 *    src/data/store.ts.
 *  - Money columns -> `numbers`; everything else -> `text` so nothing is dropped.
 *  - Re-running is safe: pass --recreate to delete & rebuild; otherwise the
 *    script refuses to touch an existing non-empty board, and resumes a partial run.
 *
 * Usage:
 *   npm run import -- --deals "../Deal funnel Data.xlsx" \
 *     --work-orders "../Work_Order_Tracker Data.xlsx" [--recreate]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { config } from '../src/config.js';
import { mondayRequest, listBoards, getAccountInfo } from '../src/monday/client.js';
import { DEALS_BOARD, WORK_ORDERS_BOARD, type BoardSchema } from '../src/data/schema.js';
import { log } from '../src/logger.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(currentDir, '..', '..');

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const RECREATE = process.argv.includes('--recreate');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type SheetRecord = Record<string, unknown>;
interface Sheet {
  header: string[];
  rows: SheetRecord[];
}

// ---------------------------------------------------------------------------
function readSheet(filePath: string, headerTokens: string[]): Sheet {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
  if (!fs.existsSync(abs)) throw new Error(`Source file not found: ${abs}`);
  const wb = XLSX.readFile(abs, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' });

  const tokenSet = new Set(headerTokens.map((t) => t.toLowerCase().trim()));
  let headerIdx = matrix.findIndex((row) => {
    const cells = row.map((c) =>
      String(c ?? '')
        .toLowerCase()
        .trim(),
    );
    return [...tokenSet].filter((t) => cells.includes(t)).length >= 2;
  });
  if (headerIdx === -1) headerIdx = 0;

  const header = matrix[headerIdx].map((c) => String(c ?? '').trim());
  const rows: SheetRecord[] = [];
  let skippedHeaderDupes = 0;

  for (let r = headerIdx + 1; r < matrix.length; r += 1) {
    const row = matrix[r];
    if (!row || row.every((c) => c === '' || c === null || c === undefined)) continue;

    const rec: SheetRecord = {};
    header.forEach((h, i) => {
      if (h) rec[h] = row[i];
    });

    const vals = Object.values(rec).map((v) =>
      String(v ?? '')
        .toLowerCase()
        .trim(),
    );
    if ([...tokenSet].filter((t) => vals.includes(t)).length >= 2) {
      skippedHeaderDupes += 1;
      continue;
    }
    rows.push(rec);
  }

  log.info(
    `Read ${path.basename(abs)}: ${rows.length} data rows (skipped ${skippedHeaderDupes} stray header rows)`,
  );
  return { header, rows };
}

/** Convert a raw cell to the string we store in Monday (faithful to source). */
function cellToText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

// ---------------------------------------------------------------------------
interface BoardColumns {
  columns: { id: string; title: string; type: string }[];
  items_count: number;
}

async function findBoardByName(name: string): Promise<{ id: string; name: string } | undefined> {
  const boards = await listBoards();
  return boards.find((b) => b.name.trim().toLowerCase() === name.trim().toLowerCase());
}

function deleteBoard(id: string): Promise<unknown> {
  return mondayRequest(`mutation ($id: ID!) { delete_board(board_id: $id) { id } }`, { id });
}

async function createBoard(name: string): Promise<{ id: string; name: string }> {
  const data = await mondayRequest<{ create_board: { id: string; name: string } }>(
    `mutation ($name: String!, $ws: ID!) {
       create_board(board_name: $name, board_kind: public, workspace_id: $ws) { id name }
     }`,
    { name, ws: config.monday.workspaceId },
  );
  return data.create_board;
}

async function getBoardColumns(boardId: string): Promise<BoardColumns> {
  const data = await mondayRequest<{ boards: BoardColumns[] }>(
    `query ($id: [ID!]) { boards(ids: $id) { columns { id title type } items_count } }`,
    { id: [boardId] },
  );
  return data.boards[0];
}

async function createColumn(
  boardId: string,
  title: string,
  columnType: 'text' | 'numbers',
): Promise<{ id: string }> {
  const data = await mondayRequest<{ create_column: { id: string } }>(
    `mutation ($board: ID!, $title: String!, $type: ColumnType!) {
       create_column(board_id: $board, title: $title, column_type: $type) { id title type }
     }`,
    { board: boardId, title, type: columnType },
  );
  return data.create_column;
}

const importTypeFor = (col: { type: string }): 'text' | 'numbers' =>
  col.type === 'numbers' ? 'numbers' : 'text';

function buildColumnValues(
  rec: SheetRecord,
  schema: BoardSchema,
  colIdByTitle: Map<string, string>,
): Record<string, string> {
  const cv: Record<string, string> = {};
  for (const col of schema.columns) {
    const text = cellToText(rec[col.src]);
    if (text === '') continue;
    const colId = colIdByTitle.get(col.title);
    if (!colId) continue;
    if (importTypeFor(col) === 'numbers') {
      const n = Number(text.replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(n)) cv[colId] = String(n);
    } else {
      cv[colId] = text;
    }
  }
  return cv;
}

async function buildBoard(schema: BoardSchema, boardName: string, sheet: Sheet): Promise<string> {
  let board = await findBoardByName(boardName);

  if (board) {
    const info = await getBoardColumns(board.id);
    if (info.items_count > 0 && !RECREATE) {
      throw new Error(
        `Board "${boardName}" already exists with ${info.items_count} items. Re-run with --recreate to rebuild it.`,
      );
    }
    if (RECREATE) {
      log.warn(`Deleting existing board "${boardName}" (${board.id})`);
      await deleteBoard(board.id);
      board = undefined;
    }
  }

  if (!board) {
    board = await createBoard(boardName);
    log.info(`Created board "${boardName}" -> ${board.id}`);
  }
  const boardId = board.id;

  // Ensure columns exist
  let existing = await getBoardColumns(boardId);
  const colIdByTitle = new Map(existing.columns.map((c) => [c.title, c.id]));
  for (const col of schema.columns) {
    if (colIdByTitle.has(col.title)) continue;
    const created = await createColumn(boardId, col.title, importTypeFor(col));
    colIdByTitle.set(col.title, created.id);
    log.info(`  + column "${col.title}" (${importTypeFor(col)})`);
    await sleep(120);
  }

  // Create items in batches. Monday charges ~30k complexity per create_item and
  // 1,000,000 / 60s, so throughput is bound at ~30 items/min; the client self-paces.
  const nameHeader = schema.nameSourceHeader;
  const BATCH = 6;
  const allRows = sheet.rows.map((rec, i) => ({
    name: (cellToText(rec[nameHeader]) || `(unnamed ${schema.key} ${i + 1})`).slice(0, 255),
    cv: JSON.stringify(buildColumnValues(rec, schema, colIdByTitle)),
  }));

  // Resume support: skip rows already present on the board
  existing = await getBoardColumns(boardId);
  const already = existing.items_count || 0;
  const rows = allRows.slice(already);
  if (already) log.info(`  resuming: ${already} items already on board, ${rows.length} to go`);

  let created = already;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const varDefs = ['$board: ID!'];
    const fields: string[] = [];
    const vars: Record<string, unknown> = { board: boardId };
    chunk.forEach((row, j) => {
      varDefs.push(`$n${j}: String!`, `$c${j}: JSON!`);
      fields.push(
        `i${j}: create_item(board_id: $board, item_name: $n${j}, column_values: $c${j}) { id }`,
      );
      vars[`n${j}`] = row.name;
      vars[`c${j}`] = row.cv;
    });
    await mondayRequest(`mutation (${varDefs.join(', ')}) { ${fields.join('\n')} }`, vars);
    created += chunk.length;
    log.info(`  ...${created}/${allRows.length} items`);
  }
  log.info(`Board "${boardName}": ${created} items created`);
  return boardId;
}

function updateEnv(updates: Record<string, string>): void {
  const envPath = path.resolve(currentDir, '..', '.env');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  for (const [k, v] of Object.entries(updates)) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    content = re.test(content) ? content.replace(re, `${k}=${v}`) : `${content}\n${k}=${v}`;
  }
  fs.writeFileSync(envPath, `${content.trim()}\n`);
  log.info(`Wrote board ids to ${envPath}`);
}

async function main(): Promise<void> {
  const acct = await getAccountInfo();
  log.info(
    `Connected to Monday as ${acct.me.name} (${acct.me.email}) / account "${acct.account.name}" [${acct.account.tier}]`,
  );

  const dealsSheet = readSheet(arg('deals', 'Deal funnel Data.xlsx'), DEALS_BOARD.headerTokens);
  const woSheet = readSheet(
    arg('work-orders', 'Work_Order_Tracker Data.xlsx'),
    WORK_ORDERS_BOARD.headerTokens,
  );

  const dealsBoardId = await buildBoard(DEALS_BOARD, config.monday.dealsBoardName, dealsSheet);
  const woBoardId = await buildBoard(WORK_ORDERS_BOARD, config.monday.workOrdersBoardName, woSheet);

  updateEnv({ MONDAY_DEALS_BOARD_ID: dealsBoardId, MONDAY_WORK_ORDERS_BOARD_ID: woBoardId });

  log.info('Import complete.');
  log.info(`  Deals board:       https://monday.com/boards/${dealsBoardId}`);
  log.info(`  Work Orders board: https://monday.com/boards/${woBoardId}`);
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
