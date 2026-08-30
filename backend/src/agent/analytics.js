/**
 * Pure query / aggregation engine that runs over the normalised in-memory
 * records (arrays of plain objects). No Monday or LLM calls here.
 */

function valueOf(row, field) {
  const v = row[field];
  if (v && typeof v === 'object' && 'value' in v) return v.value; // parseQuantity shape
  return v;
}

const OPS = {
  eq: (a, b) => norm(a) === norm(b),
  ne: (a, b) => norm(a) !== norm(b),
  in: (a, b) => Array.isArray(b) && b.map(norm).includes(norm(a)),
  nin: (a, b) => Array.isArray(b) && !b.map(norm).includes(norm(a)),
  contains: (a, b) => a != null && String(a).toLowerCase().includes(String(b).toLowerCase()),
  gt: (a, b) => num(a) != null && num(a) > num(b),
  gte: (a, b) => num(a) != null && num(a) >= num(b),
  lt: (a, b) => num(a) != null && num(a) < num(b),
  lte: (a, b) => num(a) != null && num(a) <= num(b),
  between: (a, b) => num(a) != null && Array.isArray(b) && num(a) >= num(b[0]) && num(a) <= num(b[1]),
  before: (a, b) => a != null && String(a) < String(b),
  after: (a, b) => a != null && String(a) > String(b),
  is_null: (a) => a == null || a === '',
  not_null: (a) => a != null && a !== '',
};

const norm = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : x);
const num = (x) => {
  const n = typeof x === 'number' ? x : Number(String(x).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
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

  const out = [];
  for (const [key, groupRows] of groups) {
    out.push({
      group: key,
      count: groupRows.length,
      value: computeMetric(groupRows, metric, op),
    });
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
  return { weighted: round(weighted), raw: round(raw), count: deals.length, missingProb, defaultProb };
}

export function summarize(rows, fields) {
  return rows.slice(0, 50).map((r) => {
    const o = {};
    for (const f of fields) o[f] = valueOf(r, f);
    return o;
  });
}
