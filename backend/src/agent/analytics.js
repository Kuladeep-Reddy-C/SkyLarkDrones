/**
 * Pure query / aggregation engine that runs over the normalised in-memory
 * records (arrays of plain objects). No Monday or LLM calls here.
 */

function valueOf(row, field) {
  const v = row[field];
  if (v && typeof v === 'object' && 'value' in v) return v.value; // parseQuantity shape
  return v;
}

const norm = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : x);

/** Strict numeric parse — null/''/non-numeric -> null (never 0). */
const num = (x) => {
  if (x === null || x === undefined || x === '') return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const s = String(x).replace(/[₹$,\s]/g, '');
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const isDateish = (x) => typeof x === 'string' && /^\d{4}-\d{2}(-\d{2})?/.test(x);

/**
 * Ordered comparison that works for both numbers and ISO date strings.
 * Returns null when either side is missing / incomparable (=> filter fails).
 */
function cmp(a, b) {
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

const toRange = (b) => {
  if (Array.isArray(b)) return b;
  if (typeof b === 'string') return b.split(/\s*(?:,|\.\.|to|\s)\s*/).filter(Boolean);
  return [];
};

const OPS = {
  eq: (a, b) => norm(a) === norm(b),
  ne: (a, b) => norm(a) !== norm(b),
  in: (a, b) => toRange(b).map(norm).includes(norm(a)),
  nin: (a, b) => a != null && a !== '' && !toRange(b).map(norm).includes(norm(a)),
  contains: (a, b) => a != null && String(a).toLowerCase().includes(String(b).toLowerCase()),
  gt: (a, b) => cmp(a, b) > 0,
  gte: (a, b) => cmp(a, b) >= 0,
  lt: (a, b) => { const c = cmp(a, b); return c !== null && c < 0; },
  lte: (a, b) => { const c = cmp(a, b); return c !== null && c <= 0; },
  between: (a, b) => {
    const [lo, hi] = toRange(b);
    const c1 = cmp(a, lo);
    const c2 = cmp(a, hi);
    return c1 !== null && c2 !== null && c1 >= 0 && c2 <= 0;
  },
  before: (a, b) => { const c = cmp(a, b); return c !== null && c < 0; },
  after: (a, b) => cmp(a, b) > 0,
  is_null: (a) => a === null || a === undefined || a === '',
  not_null: (a) => a !== null && a !== undefined && a !== '',
};

export function applyFilters(rows, filters = []) {
  if (!Array.isArray(filters) || !filters.length) return rows;
  return rows.filter((row) =>
    filters.every((f) => {
      const fn = OPS[f.op];
      if (!fn) return true;
      return fn(valueOf(row, f.field), f.value);
    }),
  );
}

export function aggregate(rows, { groupBy = null, metric = null, op = 'count' } = {}) {
  const groups = new Map();
  for (const row of rows) {
    const key = groupBy ? (valueOf(row, groupBy) ?? '(none)') : '__all__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const isMoney = metric && op !== 'count' && op !== 'count_distinct' && MONEY_FIELD.test(metric);
  const out = [];
  for (const [key, groupRows] of groups) {
    const value = computeMetric(groupRows, metric, op);
    const row = { group: key, count: groupRows.length, value };
    if (isMoney && value !== null) row.valueFormatted = fmtINR(value);
    out.push(row);
  }
  out.sort((a, b) => (b.value ?? b.count) - (a.value ?? a.count));
  return { groupBy, metric, op, groups: out };
}

function computeMetric(rows, metric, op) {
  if (op === 'count' || !metric) return rows.length;
  const nums = rows.map((r) => num(valueOf(r, metric))).filter((n) => n != null);
  if (op === 'count_distinct') {
    return new Set(rows.map((r) => valueOf(r, metric)).filter((v) => v != null && v !== '')).size;
  }
  if (!nums.length) return op === 'sum' ? 0 : null;
  switch (op) {
    case 'sum': return round(nums.reduce((a, b) => a + b, 0));
    case 'avg': return round(nums.reduce((a, b) => a + b, 0) / nums.length);
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
    default: return null;
  }
}

const round = (n) => Math.round(n * 100) / 100;

/** Format an INR amount the way the answer should read it (Cr / L / plain). */
export function fmtINR(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${round(n / 1e7)} Cr`;
  if (abs >= 1e5) return `₹${round(n / 1e5)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

const MONEY_FIELD = /value|amount|receivable|billed|collected|gst|pipeline|weighted/i;

/** Weighted pipeline value: sum(value * probability), default prob for blanks. */
export function weightedPipeline(deals, defaultProb = 0.3) {
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

export function summarize(rows, fields) {
  return rows.slice(0, 50).map((r) => {
    const o = {};
    for (const f of fields) o[f] = valueOf(r, f);
    return o;
  });
}
