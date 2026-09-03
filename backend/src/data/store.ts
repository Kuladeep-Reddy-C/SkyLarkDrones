/**
 * The data layer. Pulls raw items from the two Monday boards at query time,
 * normalises every field (dates, numbers, sectors, statuses, stray nulls) and
 * caches the result in memory for a short TTL.
 *
 * Nothing here is hardcoded from the CSVs — the board ids come from config or
 * are resolved by name, and every refresh re-queries Monday.
 */
import { config } from '../config.js';
import { log } from '../logger.js';
import { mondayRequest, listBoards } from '../monday/client.js';
import {
  cleanText,
  parseDate,
  parseNumber,
  parseQuantity,
  normalizeSector,
  normalizeDealStatus,
  parseDealStage,
  normalizeProbability,
} from './normalize.js';
import { analyseQuality } from './quality.js';
import type { Deal, WorkOrder, Snapshot } from '../types.js';

interface MondayColumnValue {
  id: string;
  text: string | null;
  column: { title: string | null } | null;
}
interface MondayItem {
  id: string;
  name: string;
  column_values: MondayColumnValue[];
}

let cache: Snapshot | null = null;
let inflight: Promise<Snapshot> | null = null;
let resolvedIds: { dealsId: string; woId: string } | null = null;

async function resolveBoardIds(): Promise<{ dealsId: string; woId: string }> {
  if (resolvedIds) return resolvedIds;
  let dealsId = config.monday.dealsBoardId;
  let woId = config.monday.workOrdersBoardId;

  if (!dealsId || !woId) {
    const boards = await listBoards();
    const byName = (n: string) =>
      boards.find((b) => b.name.trim().toLowerCase() === n.trim().toLowerCase());
    if (!dealsId) dealsId = byName(config.monday.dealsBoardName)?.id ?? '';
    if (!woId) woId = byName(config.monday.workOrdersBoardName)?.id ?? '';
  }
  if (!dealsId || !woId) {
    throw new Error(
      'Could not resolve Monday board ids. Set MONDAY_DEALS_BOARD_ID / ' +
        'MONDAY_WORK_ORDERS_BOARD_ID in .env or run `npm run import`.',
    );
  }
  resolvedIds = { dealsId, woId };
  return resolvedIds;
}

async function fetchAllItems(boardId: string): Promise<MondayItem[]> {
  const items: MondayItem[] = [];
  let cursor: string | null = null;
  // Monday returns a cursor for each page; continue until the cursor is exhausted.
  do {
    const data: { boards: { items_page: { cursor: string | null; items: MondayItem[] } }[] } =
      await mondayRequest(
        `query ($board: [ID!], $cursor: String) {
           boards(ids: $board) {
             items_page(limit: 50, cursor: $cursor) {
               cursor
               items { id name column_values { id text column { title } } }
             }
           }
         }`,
        { board: [boardId], cursor },
      );
    const page = data.boards?.[0]?.items_page;
    if (!page) break;
    items.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return items;
}

/** Turn a Monday item into a {title -> rawText} map. */
function toRawMap(item: MondayItem): Record<string, string> {
  const map: Record<string, string> = { Name: item.name };
  for (const cv of item.column_values ?? []) {
    const title = cv.column?.title;
    if (title) map[title] = cv.text ?? '';
  }
  return map;
}

// ---- Normalisation --------------------------------------------------------

function normalizeDeal(item: MondayItem): Deal {
  const r = toRawMap(item);
  const get = (t: string): string | undefined => r[t];
  const issues: string[] = [];

  const value = parseNumber(get('Masked Deal Value'));
  if (value === null && cleanText(get('Masked Deal Value'))) issues.push('unparseable deal value');

  const sector = normalizeSector(get('Sector / Service'));
  const status = normalizeDealStatus(get('Deal Status'));
  const stage = parseDealStage(get('Deal Stage'));
  const prob = normalizeProbability(get('Closure Probability'));
  const created = parseDate(get('Created Date'));
  const tentative = parseDate(get('Tentative Close Date'));
  const closed = parseDate(get('Close Date (Actual)'));

  if (!sector.sector) issues.push('missing sector');
  if (!status.status) issues.push('missing deal status');
  if (value === null) issues.push('missing deal value');
  if (!created?.iso) issues.push('missing/invalid created date');
  if (prob.pct === null && status.status === 'Open')
    issues.push('open deal without closure probability');

  const weighted = value !== null && prob.pct !== null ? Math.round(value * prob.pct) : null;

  return {
    id: item.id,
    name: cleanText(item.name),
    ownerCode: cleanText(get('Owner Code')),
    clientCode: cleanText(get('Client Code')),
    dealStatus: status.status,
    dealStatusRaw: status.raw,
    closureProbability: prob.label,
    probabilityPct: prob.pct,
    dealValue: value,
    weightedValue: weighted,
    dealStage: stage.stage,
    dealStageName: stage.name,
    dealStageCode: stage.code,
    dealStageRank: stage.rank,
    productDeal: cleanText(get('Product Deal')),
    sector: sector.sector,
    sectorRaw: sector.raw,
    isEnergySector: sector.energy,
    createdDate: created?.iso ?? null,
    createdMonth: created?.monthKey ?? null,
    tentativeCloseDate: tentative?.iso ?? null,
    tentativeCloseMonth: tentative?.monthKey ?? null,
    closeDateActual: closed?.iso ?? null,
    _issues: issues,
  };
}

function normalizeWorkOrder(item: MondayItem): WorkOrder {
  const r = toRawMap(item);
  const get = (t: string): string | undefined => r[t];
  const issues: string[] = [];

  const sector = normalizeSector(get('Sector'));
  const amountEx = parseNumber(get('Amount Excl GST (Masked)'));
  const amountIn = parseNumber(get('Amount Incl GST (Masked)'));
  const billedIn = parseNumber(get('Billed Value Incl GST (Masked)'));
  const collectedIn = parseNumber(get('Collected Amount Incl GST (Masked)'));
  const receivable = parseNumber(get('Amount Receivable (Masked)'));
  const toBeBilledIn = parseNumber(get('Amount To Be Billed Incl GST (Masked)'));

  const exec = cleanText(get('Execution Status'));
  const poDate = parseDate(get('Date of PO/LOI'));
  const startDate = parseDate(get('Probable Start Date'));
  const endDate = parseDate(get('Probable End Date'));
  const deliveryDate = parseDate(get('Data Delivery Date'));
  const lastInvoice = parseDate(get('Last Invoice Date'));

  if (!sector.sector) issues.push('missing sector');
  if (!exec) issues.push('missing execution status');
  if (amountIn === null) issues.push('missing work order value');
  if (!poDate?.iso) issues.push('missing/invalid PO date');

  return {
    id: item.id,
    name: cleanText(item.name),
    customerCode: cleanText(get('Customer Name Code')),
    serial: cleanText(get('Serial #')),
    natureOfWork: cleanText(get('Nature of Work')),
    lastExecutedMonth: cleanText(get('Last Executed Month')),
    executionStatus: exec,
    typeOfWork: cleanText(get('Type of Work')),
    sector: sector.sector,
    sectorRaw: sector.raw,
    isEnergySector: sector.energy,
    documentType: cleanText(get('Document Type')),
    bdKamCode: cleanText(get('BD/KAM Personnel Code')),
    skylarkPlatform: cleanText(get('Skylark Platform in Deliverables')),
    amountExGst: amountEx,
    amountInGst: amountIn,
    billedInGst: billedIn,
    collectedInGst: collectedIn,
    toBeBilledInGst: toBeBilledIn,
    receivable,
    arPriority: /priority/i.test(get('AR Priority Account') ?? ''),
    qtyPerPo: parseQuantity(get('Quantities as per PO')),
    qtyBilled: parseQuantity(get('Quantity Billed (Till Date)')),
    qtyBalance: parseQuantity(get('Balance in Quantity')),
    invoiceStatus: cleanText(get('Invoice Status')),
    billingStatus: cleanText(get('Billing Status')),
    collectionStatus: cleanText(get('Collection Status')),
    woStatusBilled: cleanText(get('WO Status (Billed)')),
    expectedBillingMonth: cleanText(get('Expected Billing Month')),
    actualBillingMonth: cleanText(get('Actual Billing Month')),
    actualCollectionMonth: cleanText(get('Actual Collection Month')),
    poDate: poDate?.iso ?? null,
    poMonth: poDate?.monthKey ?? null,
    startDate: startDate?.iso ?? null,
    endDate: endDate?.iso ?? null,
    deliveryDate: deliveryDate?.iso ?? null,
    lastInvoiceDate: lastInvoice?.iso ?? null,
    _issues: issues,
  };
}

// ---- Public API ---------------------------------------------------------

async function buildSnapshot(): Promise<Snapshot> {
  const { dealsId, woId } = await resolveBoardIds();
  log.info(`Fetching Monday snapshot (deals=${dealsId}, workOrders=${woId})`);
  const [dealItems, woItems] = await Promise.all([fetchAllItems(dealsId), fetchAllItems(woId)]);

  const deals = dealItems.map(normalizeDeal);
  const workOrders = woItems.map(normalizeWorkOrder);
  const quality = analyseQuality(deals, workOrders);

  return {
    fetchedAt: new Date().toISOString(),
    boards: { dealsId, workOrdersId: woId },
    counts: { deals: deals.length, workOrders: workOrders.length },
    deals,
    workOrders,
    quality,
  };
}

export async function getSnapshot({ force = false }: { force?: boolean } = {}): Promise<Snapshot> {
  const ttlMs = config.cache.ttlSeconds * 1000;
  const fresh = cache && Date.now() - new Date(cache.fetchedAt).getTime() < ttlMs;
  if (fresh && !force && cache) return cache;
  if (inflight) return inflight;

  inflight = buildSnapshot()
    .then((snap) => {
      cache = snap;
      return snap;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function getCachedSnapshot(): Snapshot | null {
  return cache;
}

export function cacheAgeSeconds(): number | null {
  if (!cache) return null;
  return Math.round((Date.now() - new Date(cache.fetchedAt).getTime()) / 1000);
}
