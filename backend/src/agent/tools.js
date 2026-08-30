/**
 * Agent tools. Each tool operates on the normalised in-memory snapshot
 * (which is refreshed from Monday.com on a TTL). Tool results are plain JSON.
 */
import { getSnapshot, cacheAgeSeconds } from '../data/store.js';
import { applyFilters, aggregate, weightedPipeline, summarize } from './analytics.js';

const DEAL_FIELDS = {
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
  sector: 'enum — Renewables | Power & Transmission | Mining | Railways | Construction | Manufacturing | Aviation | Security & Surveillance | DSP | Tender | Others',
  isEnergySector: 'boolean — true for Renewables or Power & Transmission',
  createdDate: 'date YYYY-MM-DD',
  createdMonth: 'string YYYY-MM',
  tentativeCloseDate: 'date YYYY-MM-DD',
  tentativeCloseMonth: 'string YYYY-MM',
  closeDateActual: 'date YYYY-MM-DD (rarely populated)',
};

const WO_FIELDS = {
  name: 'string — masked deal name for this work order',
  customerCode: 'string — masked customer code',
  serial: 'string — deal serial like SDPLDEAL-075 (no reliable match in Deals board)',
  natureOfWork: 'string — One time Project | Monthly Contract | Annual Rate Contract | Proof of Concept',
  executionStatus: 'string — Completed | Ongoing | Not Started | Executed until current month | Pause / struck | ...',
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

function distinctValues(rows, field, limit = 25) {
  const counts = new Map();
  for (const r of rows) {
    const v = r[field];
    if (v === null || v === undefined || v === '') continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function pickRows(snap, board) {
  if (board === 'deals') return snap.deals;
  if (board === 'work_orders' || board === 'workOrders') return snap.workOrders;
  throw new Error(`Unknown board "${board}". Use "deals" or "work_orders".`);
}

export const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'get_data_overview',
      description:
        'Start here. Returns record counts, the field catalog for both boards, distinct values + counts for key categorical fields, the data-quality report, and how stale the Monday snapshot is. Call this before other tools so you use correct field names and values.',
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
          filters: {
            type: 'array',
            description: 'AND-combined filters.',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                op: {
                  type: 'string',
                  enum: ['eq', 'ne', 'in', 'nin', 'contains', 'gt', 'gte', 'lt', 'lte', 'between', 'before', 'after', 'is_null', 'not_null'],
                },
                value: {},
              },
              required: ['field', 'op'],
            },
          },
          fields: { type: 'array', items: { type: 'string' }, description: 'Fields to return. Defaults to a sensible set.' },
          sort: {
            type: 'object',
            properties: { field: { type: 'string' }, dir: { type: 'string', enum: ['asc', 'desc'] } },
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
          filters: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, op: { type: 'string' }, value: {} }, required: ['field', 'op'] } },
          group_by: { type: 'string', description: 'Field to group by. Omit for a single overall aggregate.' },
          metric: { type: 'string', description: 'Numeric field to aggregate (e.g. dealValue, amountInGst, receivable). Omit for count.' },
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
        'Deals board only. Returns raw and probability-weighted pipeline value for the (optionally filtered) set of deals, plus a breakdown by stage and by status. Blank probabilities use a 0.3 default.',
      parameters: {
        type: 'object',
        properties: {
          filters: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, op: { type: 'string' }, value: {} }, required: ['field', 'op'] } },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'refresh_data',
      description: 'Force a fresh pull from Monday.com (bypass the cache). Use only if the user says the data looks stale.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
];

export async function executeTool(name, args = {}) {
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
              dealStatus: distinctValues(snap.deals, 'dealStatus'),
              sector: distinctValues(snap.deals, 'sector'),
              dealStage: distinctValues(snap.deals, 'dealStage'),
              closureProbability: distinctValues(snap.deals, 'closureProbability'),
              productDeal: distinctValues(snap.deals, 'productDeal'),
              ownerCode: distinctValues(snap.deals, 'ownerCode'),
            },
          },
          work_orders: {
            fields: WO_FIELDS,
            distinct: {
              executionStatus: distinctValues(snap.workOrders, 'executionStatus'),
              sector: distinctValues(snap.workOrders, 'sector'),
              natureOfWork: distinctValues(snap.workOrders, 'natureOfWork'),
              invoiceStatus: distinctValues(snap.workOrders, 'invoiceStatus'),
              woStatusBilled: distinctValues(snap.workOrders, 'woStatusBilled'),
              skylarkPlatform: distinctValues(snap.workOrders, 'skylarkPlatform'),
            },
          },
        },
        quality: snap.quality,
      };

    case 'query_records': {
      const rows = pickRows(snap, args.board);
      let filtered = applyFilters(rows, args.filters);
      if (args.sort?.field) {
        const dir = args.sort.dir === 'asc' ? 1 : -1;
        filtered = [...filtered].sort((a, b) => {
          const av = a[args.sort.field];
          const bv = b[args.sort.field];
          if (av == null) return 1;
          if (bv == null) return -1;
          return av > bv ? dir : av < bv ? -dir : 0;
        });
      }
      const defaultFields = args.board === 'deals'
        ? ['name', 'sector', 'dealStatus', 'dealStage', 'dealValue', 'probabilityPct', 'ownerCode', 'createdDate', 'tentativeCloseDate']
        : ['name', 'sector', 'executionStatus', 'amountInGst', 'billedInGst', 'collectedInGst', 'receivable', 'invoiceStatus', 'poDate'];
      const fields = args.fields?.length ? args.fields : defaultFields;
      const limit = Math.min(args.limit || 20, 50);
      return {
        board: args.board,
        totalMatches: filtered.length,
        returned: Math.min(filtered.length, limit),
        rows: summarize(filtered.slice(0, limit), fields),
      };
    }

    case 'aggregate_records': {
      const rows = pickRows(snap, args.board);
      const filtered = applyFilters(rows, args.filters);
      const result = aggregate(filtered, {
        groupBy: args.group_by || null,
        metric: args.metric || null,
        op: args.op || 'count',
      });
      return { board: args.board, matched: filtered.length, ...result };
    }

    case 'pipeline_analysis': {
      const filtered = applyFilters(snap.deals, args.filters);
      const overall = weightedPipeline(filtered);
      const byStage = aggregate(filtered, { groupBy: 'dealStage', metric: 'dealValue', op: 'sum' });
      const byStatus = aggregate(filtered, { groupBy: 'dealStatus', metric: 'dealValue', op: 'sum' });
      const openOnly = weightedPipeline(filtered.filter((d) => d.dealStatus === 'Open'));
      return { matched: filtered.length, overall, openPipeline: openOnly, byStage, byStatus };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
