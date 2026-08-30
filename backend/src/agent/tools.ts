/**
 * Agent tools. Each operates on the normalised in-memory snapshot (refreshed
 * from Monday.com on a TTL). Tool results are plain JSON.
 */
import type Groq from 'groq-sdk';
import { getSnapshot, cacheAgeSeconds } from '../data/store.js';
import { applyFilters, aggregate, weightedPipeline, summarize, fmtINR } from './analytics.js';
import type { AggOp, Deal, Filter, Snapshot, WorkOrder } from '../types.js';

const MONEY_KEY = /value|amount|receivable|billed|collected|gst/i;

/** Attach a "<field>_fmt" (₹ Cr/L) next to every money field so the LLM never scales it. */
function withFormattedMoney(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'number' && MONEY_KEY.test(k) && !/pct|rank|count/i.test(k)) {
        out[`${k}_fmt`] = fmtINR(v);
      }
    }
    return out;
  });
}

const DEAL_FIELDS: Record<string, string> = {
  name: 'string — masked deal name',
  ownerCode: 'string — sales owner code (OWNER_001..)',
  clientCode: 'string — masked client code',
  dealStatus: 'enum — Open | Won | Lost | On Hold (normalised; "Dead" -> Lost)',
  closureProbability: 'string — High | Medium | Low | pct',
  probabilityPct: 'number — 0..1 (High=0.8, Medium=0.5, Low=0.2)',
  dealValue: 'number — masked deal value (INR)',
  weightedValue: 'number — dealValue * probabilityPct',
  dealStage: 'string — raw funnel stage e.g. "E. Proposal/Commercials Sent"',
  dealStageName: 'string — stage without the letter prefix',
  dealStageRank: 'number — A=1 .. O=15 (funnel progression)',
  productDeal: 'string — product mix (Pure Service, Service + Spectra, ...)',
  sector:
    'enum — Renewables | Power & Transmission | Mining | Railways | Construction | Manufacturing | Aviation | Security & Surveillance | DSP | Tender | Others',
  isEnergySector: 'boolean — true for Renewables or Power & Transmission',
  createdDate: 'date YYYY-MM-DD',
  createdMonth: 'string YYYY-MM',
  tentativeCloseDate: 'date YYYY-MM-DD',
  tentativeCloseMonth: 'string YYYY-MM',
  closeDateActual: 'date YYYY-MM-DD (rarely populated)',
};

const WO_FIELDS: Record<string, string> = {
  name: 'string — masked deal name for this work order',
  customerCode: 'string — masked customer code',
  serial: 'string — deal serial like SDPLDEAL-075 (no reliable match in Deals board)',
  natureOfWork:
    'string — One time Project | Monthly Contract | Annual Rate Contract | Proof of Concept',
  executionStatus:
    'string — Completed | Ongoing | Not Started | Executed until current month | Pause / struck | ...',
  typeOfWork: 'string — survey/inspection type(s)',
  sector: 'enum — same canonical set as deals',
  isEnergySector: 'boolean',
  documentType: 'string — Purchase Order | Email Confirmation | LOA/LOI',
  bdKamCode: 'string — BD/KAM owner code',
  skylarkPlatform: 'string — NONE | SPECTRA | DMO | SPECTRA + DMO',
  amountExGst: 'number — order value excl GST (INR, masked)',
  amountInGst: 'number — order value incl GST (INR, masked)',
  billedInGst: 'number — billed value incl GST to date',
  collectedInGst: 'number — amount collected incl GST',
  toBeBilledInGst: 'number — amount still to be billed incl GST',
  receivable: 'number — outstanding receivable (masked)',
  arPriority: 'boolean — flagged AR priority account',
  invoiceStatus: 'string — Fully Billed | Partially Billed | Not billed yet | ...',
  billingStatus: 'string — free text billing note (often blank)',
  collectionStatus: 'string — almost always blank in source data',
  woStatusBilled: 'string — Open | Closed',
  poDate: 'date YYYY-MM-DD — date of PO/LOI',
  poMonth: 'string YYYY-MM',
  startDate: 'date — probable start',
  endDate: 'date — probable end',
  deliveryDate: 'date — data delivery date',
  lastInvoiceDate: 'date',
};

function distinctValues(
  rows: Record<string, unknown>[],
  field: string,
  limit = 25,
): { value: unknown; count: number }[] {
  const counts = new Map<unknown, number>();
  for (const r of rows) {
    const v = r[field];
    if (v === null || v === undefined || v === '') continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function pickRows(snap: Snapshot, board: string): (Deal | WorkOrder)[] {
  if (board === 'deals') return snap.deals;
  if (board === 'work_orders' || board === 'workOrders') return snap.workOrders;
  throw new Error(`Unknown board "${board}". Use "deals" or "work_orders".`);
}

const filterItemsSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: { field: { type: 'string' }, op: { type: 'string' }, value: {} },
    required: ['field', 'op'],
  },
} as const;

export const toolDefinitions: Groq.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_data_overview',
      description:
        'Returns record counts, the field catalog for both boards, distinct values + counts for key categorical fields, the data-quality report, and how stale the Monday snapshot is. Only needed for an exact distinct-value list.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_records',
      description:
        'Filter records from one board and return matching rows (max 50) plus the total match count. Use for "list/show me" questions or to inspect examples.',
      parameters: {
        type: 'object',
        properties: {
          board: { type: 'string', enum: ['deals', 'work_orders'] },
          filters: { ...filterItemsSchema, description: 'AND-combined filters.' },
          fields: { type: 'array', items: { type: 'string' }, description: 'Fields to return.' },
          sort: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              dir: { type: 'string', enum: ['asc', 'desc'] },
            },
          },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
        required: ['board'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'aggregate_records',
      description:
        'Group + aggregate records from one board. Use for "how many / total / average / by sector / by stage / by owner" questions.',
      parameters: {
        type: 'object',
        properties: {
          board: { type: 'string', enum: ['deals', 'work_orders'] },
          filters: filterItemsSchema,
          group_by: {
            type: 'string',
            description: 'Field to group by. Omit for a single overall aggregate.',
          },
          metric: {
            type: 'string',
            description:
              'Numeric field to aggregate (dealValue, amountInGst, receivable). Omit for count.',
          },
          op: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max', 'count_distinct'] },
        },
        required: ['board'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pipeline_analysis',
      description:
        'Deals board only. Returns raw + probability-weighted pipeline value for the (optionally filtered) deals, plus breakdown by stage and by status. Blank probabilities use a 0.3 default.',
      parameters: { type: 'object', properties: { filters: filterItemsSchema } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'refresh_data',
      description:
        'Force a fresh pull from Monday.com (bypass the cache). Use only if the user says the data looks stale.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
];

interface QueryArgs {
  board: string;
  filters?: Filter[];
  fields?: string[];
  sort?: { field: string; dir?: 'asc' | 'desc' };
  limit?: number;
}
interface AggregateArgs {
  board: string;
  filters?: Filter[];
  group_by?: string;
  metric?: string;
  op?: AggOp;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const snap = await getSnapshot({ force: name === 'refresh_data' });

  switch (name) {
    case 'refresh_data':
      return { refreshed: true, fetchedAt: snap.fetchedAt, counts: snap.counts };

    case 'get_data_overview':
      return {
        snapshotAgeSeconds: cacheAgeSeconds(),
        fetchedAt: snap.fetchedAt,
        counts: snap.counts,
        boards: {
          deals: {
            fields: DEAL_FIELDS,
            distinct: {
              dealStatus: distinctValues(
                snap.deals as unknown as Record<string, unknown>[],
                'dealStatus',
              ),
              sector: distinctValues(snap.deals as unknown as Record<string, unknown>[], 'sector'),
              dealStage: distinctValues(
                snap.deals as unknown as Record<string, unknown>[],
                'dealStage',
              ),
              closureProbability: distinctValues(
                snap.deals as unknown as Record<string, unknown>[],
                'closureProbability',
              ),
              productDeal: distinctValues(
                snap.deals as unknown as Record<string, unknown>[],
                'productDeal',
              ),
              ownerCode: distinctValues(
                snap.deals as unknown as Record<string, unknown>[],
                'ownerCode',
              ),
            },
          },
          work_orders: {
            fields: WO_FIELDS,
            distinct: {
              executionStatus: distinctValues(
                snap.workOrders as unknown as Record<string, unknown>[],
                'executionStatus',
              ),
              sector: distinctValues(
                snap.workOrders as unknown as Record<string, unknown>[],
                'sector',
              ),
              natureOfWork: distinctValues(
                snap.workOrders as unknown as Record<string, unknown>[],
                'natureOfWork',
              ),
              invoiceStatus: distinctValues(
                snap.workOrders as unknown as Record<string, unknown>[],
                'invoiceStatus',
              ),
              woStatusBilled: distinctValues(
                snap.workOrders as unknown as Record<string, unknown>[],
                'woStatusBilled',
              ),
              skylarkPlatform: distinctValues(
                snap.workOrders as unknown as Record<string, unknown>[],
                'skylarkPlatform',
              ),
            },
          },
        },
        quality: snap.quality,
      };

    case 'query_records': {
      const a = args as unknown as QueryArgs;
      const rows = pickRows(snap, a.board) as unknown as Record<string, unknown>[];
      let filtered = applyFilters(rows, a.filters);
      if (a.sort?.field) {
        const dir = a.sort.dir === 'asc' ? 1 : -1;
        const key = a.sort.field;
        filtered = [...filtered].sort((x, y) => {
          const av = x[key];
          const bv = y[key];
          if (av == null) return 1;
          if (bv == null) return -1;
          return av > bv ? dir : av < bv ? -dir : 0;
        });
      }
      const defaultFields =
        a.board === 'deals'
          ? [
              'name',
              'sector',
              'dealStatus',
              'dealStage',
              'dealValue',
              'probabilityPct',
              'ownerCode',
              'createdDate',
              'tentativeCloseDate',
            ]
          : [
              'name',
              'sector',
              'executionStatus',
              'amountInGst',
              'billedInGst',
              'collectedInGst',
              'receivable',
              'invoiceStatus',
              'poDate',
            ];
      const fields = a.fields?.length ? a.fields : defaultFields;
      const limit = Math.min(a.limit ?? 20, 50);
      return {
        board: a.board,
        totalMatches: filtered.length,
        returned: Math.min(filtered.length, limit),
        rows: withFormattedMoney(summarize(filtered.slice(0, limit), fields)),
      };
    }

    case 'aggregate_records': {
      const a = args as unknown as AggregateArgs;
      const rows = pickRows(snap, a.board) as unknown as Record<string, unknown>[];
      const filtered = applyFilters(rows, a.filters);
      const result = aggregate(filtered, {
        groupBy: a.group_by ?? null,
        metric: a.metric ?? null,
        op: a.op ?? 'count',
      });
      return { board: a.board, matched: filtered.length, ...result };
    }

    case 'pipeline_analysis': {
      const a = args as { filters?: Filter[] };
      const filtered = applyFilters(snap.deals, a.filters);
      const overall = weightedPipeline(filtered);
      const byStage = aggregate(filtered as unknown as Record<string, unknown>[], {
        groupBy: 'dealStage',
        metric: 'dealValue',
        op: 'sum',
      });
      const byStatus = aggregate(filtered as unknown as Record<string, unknown>[], {
        groupBy: 'dealStatus',
        metric: 'dealValue',
        op: 'sum',
      });
      const openOnly = weightedPipeline(filtered.filter((d) => d.dealStatus === 'Open'));
      return { matched: filtered.length, overall, openPipeline: openOnly, byStage, byStatus };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
