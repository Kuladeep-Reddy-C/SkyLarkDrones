/**
 * Pure query / aggregation engine over the normalised in-memory records.
 * No Monday or LLM calls here — everything is deterministic and unit-tested.
 */
import type { Deal, Filter, FilterOp, AggOp, AggResult, WeightedPipeline } from '../types.js';

type AnyRow = Record<string, unknown>;

const round = (n: number): number => Math.round(n * 100) / 100;

const MONEY_FIELD = /value|amount|receivable|billed|collected|gst|pipeline|weighted/i;

function valueOf(row: AnyRow, field: string): unknown {
  const v = row[field];
  if (v && typeof v === 'object' && 'value' in v) return (v as { value: unknown }).value;
  return v;
}

const norm = (x: unknown): unknown => (typeof x === 'string' ? x.trim().toLowerCase() : x);

/** Strict numeric parse — null/''/non-numeric -> null (never 0). */
const num = (x: unknown): number | null => {
  if (x === null || x === undefined || x === '') return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const s = String(x).replace(/[₹$,\s]/g, '');
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const isDateish = (x: unknown): boolean => typeof x === 'string' && /^\d{4}-\d{2}(-\d{2})?/.test(x);

/**
 * Ordered comparison for numbers and ISO date strings.
 * Returns null when either side is missing / incomparable (=> filter fails).
 */
function cmp(a: unknown, b: unknown): number | null {
  if (a === null || a === undefined || a === '') return null;
  if (b === null || b === undefined || b === '') return null;
  const na = num(a);
  const nb = num(b);
  if (na !== null && nb !== null) return na - nb;
  if (isDateish(a) || isDateish(b)) {
    const sa = String(a).slice(0, 10);
    const sb = String(b).slice(0, 10);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  return null;
}

const toRange = (b: unknown): unknown[] => {
  if (Array.isArray(b)) return b;
  if (typeof b === 'string') return b.split(/\s*(?:,|\.\.|to|\s)\s*/).filter(Boolean);
  return [];
};

const OPS: Record<FilterOp, (a: unknown, b: unknown) => boolean> = {
  eq: (a, b) => norm(a) === norm(b),
  ne: (a, b) => norm(a) !== norm(b),
  in: (a, b) => toRange(b).map(norm).includes(norm(a)),
  nin: (a, b) => a != null && a !== '' && !toRange(b).map(norm).includes(norm(a)),
  contains: (a, b) => a != null && String(a).toLowerCase().includes(String(b).toLowerCase()),
  gt: (a, b) => (cmp(a, b) ?? -Infinity) > 0,
  gte: (a, b) => (cmp(a, b) ?? -Infinity) >= 0,
  lt: (a, b) => {
    const c = cmp(a, b);
    return c !== null && c < 0;
  },
  lte: (a, b) => {
    const c = cmp(a, b);
    return c !== null && c <= 0;
  },
  between: (a, b) => {
    const [lo, hi] = toRange(b);
    const c1 = cmp(a, lo);
    const c2 = cmp(a, hi);
    return c1 !== null && c2 !== null && c1 >= 0 && c2 <= 0;
  },
  before: (a, b) => {
    const c = cmp(a, b);
    return c !== null && c < 0;
  },
  after: (a, b) => (cmp(a, b) ?? -Infinity) > 0,
  is_null: (a) => a === null || a === undefined || a === '',
  not_null: (a) => a !== null && a !== undefined && a !== '',
};

export function applyFilters<T extends object>(rows: T[], filters: Filter[] = []): T[] {
  if (!Array.isArray(filters) || !filters.length) return rows;
  return rows.filter((row) =>
    filters.every((f) => {
      const fn = OPS[f.op];
      if (!fn) return true;
      return fn(valueOf(row as AnyRow, f.field), f.value);
    }),
  );
}

function computeMetric(rows: AnyRow[], metric: string | null, op: AggOp): number | null {
  if (op === 'count' || !metric) return rows.length;
  if (op === 'count_distinct') {
    return new Set(rows.map((r) => valueOf(r, metric)).filter((v) => v != null && v !== '')).size;
  }
  const nums = rows.map((r) => num(valueOf(r, metric))).filter((n): n is number => n != null);
  if (!nums.length) return op === 'sum' ? 0 : null;
  switch (op) {
    case 'sum':
      return round(nums.reduce((a, b) => a + b, 0));
    case 'avg':
      return round(nums.reduce((a, b) => a + b, 0) / nums.length);
    case 'min':
      return Math.min(...nums);
    case 'max':
      return Math.max(...nums);
    default:
      return null;
  }
}

export function aggregate(
  rows: AnyRow[],
  {
    groupBy = null,
    metric = null,
    op = 'count',
  }: {
    groupBy?: string | null;
    metric?: string | null;
    op?: AggOp;
  } = {},
): AggResult {
  const groups = new Map<string, AnyRow[]>();
  for (const row of rows) {
    const key = groupBy ? String(valueOf(row, groupBy) ?? '(none)') : '__all__';
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const isMoney = Boolean(
    metric && op !== 'count' && op !== 'count_distinct' && MONEY_FIELD.test(metric),
  );
  const out = [...groups.entries()].map(([group, groupRows]) => {
    const value = computeMetric(groupRows, metric, op);
    return {
      group,
      count: groupRows.length,
      value,
      ...(isMoney && value !== null ? { valueFormatted: fmtINR(value) } : {}),
    };
  });
  out.sort((a, b) => (b.value ?? b.count) - (a.value ?? a.count));
  return { groupBy, metric, op, groups: out };
}

/** Format an INR amount the way the answer should read it (Cr / L / plain). */
export function fmtINR(n: number | null | undefined): string | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${round(n / 1e7)} Cr`;
  if (abs >= 1e5) return `₹${round(n / 1e5)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/** Weighted pipeline value: sum(value * probability), default prob for blanks. */
export function weightedPipeline(deals: Deal[], defaultProb = 0.3): WeightedPipeline {
  let weighted = 0;
  let raw = 0;
  let missingProb = 0;
  for (const d of deals) {
    if (d.dealValue == null) continue;
    raw += d.dealValue;
    let p = d.probabilityPct;
    if (p == null) {
      p = defaultProb;
      missingProb += 1;
    }
    weighted += d.dealValue * p;
  }
  return {
    weighted: round(weighted),
    raw: round(raw),
    weightedFormatted: fmtINR(weighted),
    rawFormatted: fmtINR(raw),
    count: deals.length,
    missingProb,
    defaultProb,
  };
}

export function summarize(rows: AnyRow[], fields: string[]): Record<string, unknown>[] {
  return rows.slice(0, 50).map((r) => {
    const o: Record<string, unknown> = {};
    for (const f of fields) o[f] = valueOf(r, f);
    return o;
  });
}
