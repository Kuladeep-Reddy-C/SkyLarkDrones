/** Shared domain types. */

export type BoardKey = 'deals' | 'work_orders';

export interface ParsedDate {
  iso: string | null;
  monthKey: string | null;
  monthName?: string | null;
  raw: string;
  unparseable?: boolean;
}

export interface Quantity {
  value: number | null;
  raw: string | null;
}

export interface Deal {
  id: string;
  name: string | null;
  ownerCode: string | null;
  clientCode: string | null;
  dealStatus: string | null;
  dealStatusRaw: string | null;
  closureProbability: string | null;
  probabilityPct: number | null;
  dealValue: number | null;
  weightedValue: number | null;
  dealStage: string | null;
  dealStageName: string | null;
  dealStageCode: string | null;
  dealStageRank: number | null;
  productDeal: string | null;
  sector: string | null;
  sectorRaw: string | null;
  isEnergySector: boolean;
  createdDate: string | null;
  createdMonth: string | null;
  tentativeCloseDate: string | null;
  tentativeCloseMonth: string | null;
  closeDateActual: string | null;
  _issues: string[];
}

export interface WorkOrder {
  id: string;
  name: string | null;
  customerCode: string | null;
  serial: string | null;
  natureOfWork: string | null;
  lastExecutedMonth: string | null;
  executionStatus: string | null;
  typeOfWork: string | null;
  sector: string | null;
  sectorRaw: string | null;
  isEnergySector: boolean;
  documentType: string | null;
  bdKamCode: string | null;
  skylarkPlatform: string | null;
  amountExGst: number | null;
  amountInGst: number | null;
  billedInGst: number | null;
  collectedInGst: number | null;
  toBeBilledInGst: number | null;
  receivable: number | null;
  arPriority: boolean;
  qtyPerPo: Quantity;
  qtyBilled: Quantity;
  qtyBalance: Quantity;
  invoiceStatus: string | null;
  billingStatus: string | null;
  collectionStatus: string | null;
  woStatusBilled: string | null;
  expectedBillingMonth: string | null;
  actualBillingMonth: string | null;
  actualCollectionMonth: string | null;
  poDate: string | null;
  poMonth: string | null;
  startDate: string | null;
  endDate: string | null;
  deliveryDate: string | null;
  lastInvoiceDate: string | null;
  _issues: string[];
}

export type Row = Deal | WorkOrder;

export interface FieldFill {
  field: string;
  filled: number;
  missing: number;
  missingPct: number;
}

export interface QualityReport {
  deals: { total: number; fill: FieldFill[]; issues: Record<string, number> };
  workOrders: { total: number; fill: FieldFill[]; issues: Record<string, number> };
  crossBoard: { note: string; knownSectors: string[] };
  notes: string[];
}

export interface Snapshot {
  fetchedAt: string;
  boards: { dealsId: string; workOrdersId: string };
  counts: { deals: number; workOrders: number };
  deals: Deal[];
  workOrders: WorkOrder[];
  quality: QualityReport;
}

// ---- analytics --------------------------------------------------------------

export type FilterOp =
  | 'eq'
  | 'ne'
  | 'in'
  | 'nin'
  | 'contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'before'
  | 'after'
  | 'is_null'
  | 'not_null';

export interface Filter {
  field: string;
  op: FilterOp;
  value?: unknown;
}

export type AggOp = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct';

export interface AggGroup {
  group: string;
  count: number;
  value: number | null;
  valueFormatted?: string | null;
}

export interface AggResult {
  groupBy: string | null;
  metric: string | null;
  op: AggOp;
  groups: AggGroup[];
}

export interface WeightedPipeline {
  weighted: number;
  raw: number;
  weightedFormatted: string | null;
  rawFormatted: string | null;
  count: number;
  missingProb: number;
  defaultProb: number;
}

// ---- charts ---------------------------------------------------------------

export interface ChartSpec {
  type: 'bar' | 'funnel';
  title: string;
  unit: string;
  data: { label: string; value: number }[];
}

// ---- agent --------------------------------------------------------------

export interface ToolCallTrace {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  result?: unknown;
}

export interface AgentMeta {
  model: string;
  steps: number;
  tools: { tool: string; args: Record<string, unknown>; ok: boolean }[];
  cached?: boolean;
  degraded?: boolean;
  error?: string;
}

export interface AgentResult {
  reply: string;
  toolTrace: ToolCallTrace[];
  steps: number;
  model: string;
  charts: ChartSpec[];
  meta: AgentMeta;
  cached?: boolean;
}

export type AgentEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'status'; label: string }
  | { type: 'tool'; id: string; tool: string; label: string }
  | { type: 'tool_done'; id: string; tool: string; label: string; summary: string }
  | { type: 'answer'; text: string }
  | { type: 'charts'; charts: ChartSpec[] }
  | { type: 'done'; meta: AgentMeta }
  | { type: 'error'; error: string; dataError?: string };
