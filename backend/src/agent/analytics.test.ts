import { describe, it, expect } from 'vitest';
import { applyFilters, aggregate, weightedPipeline, fmtINR, summarize } from './analytics.js';
import type { Deal } from '../types.js';

type Row = Record<string, unknown>;

const rows: Row[] = [
  {
    sector: 'Renewables',
    dealStatus: 'Open',
    dealValue: 1_000_000,
    tentativeCloseDate: '2026-02-10',
  },
  { sector: 'Renewables', dealStatus: 'Won', dealValue: 4_000_000, tentativeCloseDate: null },
  { sector: 'Mining', dealStatus: 'Open', dealValue: null, tentativeCloseDate: '2025-12-01' },
  { sector: 'Mining', dealStatus: 'Open', dealValue: 2_000_000, tentativeCloseDate: '2026-05-01' },
  { sector: null, dealStatus: 'Lost', dealValue: 500_000, tentativeCloseDate: null },
];

describe('applyFilters', () => {
  it('eq filters exactly (case-insensitively)', () => {
    expect(applyFilters(rows, [{ field: 'sector', op: 'eq', value: 'renewables' }])).toHaveLength(
      2,
    );
  });
  it('in accepts an array or a comma string', () => {
    expect(
      applyFilters(rows, [{ field: 'sector', op: 'in', value: ['Mining', 'Renewables'] }]),
    ).toHaveLength(4);
    expect(
      applyFilters(rows, [{ field: 'sector', op: 'in', value: 'Mining, Renewables' }]),
    ).toHaveLength(4);
  });
  it('a null date never matches a between filter (regression)', () => {
    const hit = applyFilters(rows, [
      { field: 'tentativeCloseDate', op: 'between', value: ['2026-01-01', '2026-03-31'] },
    ]);
    expect(hit).toHaveLength(1);
    expect(hit[0].tentativeCloseDate).toBe('2026-02-10');
  });
  it('a null value never matches a numeric comparison (regression)', () => {
    expect(applyFilters(rows, [{ field: 'dealValue', op: 'gte', value: 0 }])).toHaveLength(4);
  });
  it('is_null / not_null', () => {
    expect(applyFilters(rows, [{ field: 'dealValue', op: 'is_null' }])).toHaveLength(1);
    expect(applyFilters(rows, [{ field: 'sector', op: 'not_null' }])).toHaveLength(4);
  });
  it('AND-combines multiple filters', () => {
    const hit = applyFilters(rows, [
      { field: 'sector', op: 'eq', value: 'Mining' },
      { field: 'dealStatus', op: 'eq', value: 'Open' },
    ]);
    expect(hit).toHaveLength(2);
  });
});

describe('aggregate', () => {
  it('groups + sums, ignoring null metric values', () => {
    const res = aggregate(rows, { groupBy: 'sector', metric: 'dealValue', op: 'sum' });
    const bySector = Object.fromEntries(res.groups.map((g) => [g.group, g.value]));
    expect(bySector.Renewables).toBe(5_000_000);
    expect(bySector.Mining).toBe(2_000_000);
  });
  it('attaches a formatted amount for money metrics', () => {
    const res = aggregate(rows, { groupBy: 'sector', metric: 'dealValue', op: 'sum' });
    const renew = res.groups.find((g) => g.group === 'Renewables');
    expect(renew?.valueFormatted).toBe('₹50 L'); // 5,000,000
  });
  it('counts rows when no metric is given', () => {
    const res = aggregate(rows, { groupBy: 'dealStatus', op: 'count' });
    expect(res.groups.find((g) => g.group === 'Open')?.count).toBe(3);
  });
  it('sorts groups descending by value', () => {
    const res = aggregate(rows, { groupBy: 'sector', metric: 'dealValue', op: 'sum' });
    expect(res.groups[0].group).toBe('Renewables');
  });
});

describe('weightedPipeline', () => {
  const deals = [
    { dealValue: 1_000_000, probabilityPct: 0.8 },
    { dealValue: 2_000_000, probabilityPct: null },
    { dealValue: null, probabilityPct: 0.5 },
  ] as Deal[];

  it('weights by probability, using the default for blanks', () => {
    const p = weightedPipeline(deals);
    expect(p.raw).toBe(3_000_000);
    expect(p.weighted).toBe(1_400_000); // 1M*.8 + 2M*.3
    expect(p.missingProb).toBe(1);
  });
  it('exposes pre-formatted strings so the LLM never does crore/lakh math', () => {
    const p = weightedPipeline(deals);
    expect(p.rawFormatted).toBe('₹30 L'); // 3,000,000
    expect(
      weightedPipeline([{ dealValue: 90_428_187, probabilityPct: 1 }] as Deal[]).rawFormatted,
    ).toBe('₹9.04 Cr');
  });
});

describe('fmtINR', () => {
  it('picks crore / lakh / plain by magnitude', () => {
    expect(fmtINR(90_428_187)).toBe('₹9.04 Cr');
    expect(fmtINR(350_000)).toBe('₹3.5 L');
    expect(fmtINR(4_200)).toBe('₹4,200');
    expect(fmtINR(null)).toBeNull();
  });
});

describe('summarize', () => {
  it('projects only the requested fields and unwraps quantities', () => {
    const out = summarize([{ a: 1, b: 2, q: { value: 5, raw: '5 HA' } }], ['a', 'q']);
    expect(out[0]).toEqual({ a: 1, q: 5 });
  });
});
