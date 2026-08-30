/**
 * Data-quality analysis. Produces a compact report the agent can cite as
 * caveats ("42% of open deals have no closure probability", etc).
 */
import type { Deal, WorkOrder, FieldFill, QualityReport } from '../types.js';

function pct(n: number, total: number): number {
  return total ? Math.round((n / total) * 1000) / 10 : 0;
}

function fieldFill(rows: Record<string, unknown>[], field: string): FieldFill {
  const filled = rows.filter((r) => {
    const v = r[field];
    if (v && typeof v === 'object' && 'value' in v) {
      return (v as { value: unknown }).value !== null;
    }
    return v !== null && v !== undefined && v !== '';
  }).length;
  return {
    field,
    filled,
    missing: rows.length - filled,
    missingPct: pct(rows.length - filled, rows.length),
  };
}

export function analyseQuality(deals: Deal[], workOrders: WorkOrder[]): QualityReport {
  const dealFields = [
    'dealValue',
    'sector',
    'dealStatus',
    'dealStage',
    'closureProbability',
    'createdDate',
    'ownerCode',
    'clientCode',
  ];
  const woFields = [
    'amountInGst',
    'sector',
    'executionStatus',
    'poDate',
    'billedInGst',
    'collectedInGst',
    'invoiceStatus',
    'collectionStatus',
    'billingStatus',
  ];

  const dealIssueCounts: Record<string, number> = {};
  for (const d of deals)
    for (const i of d._issues) dealIssueCounts[i] = (dealIssueCounts[i] ?? 0) + 1;
  const woIssueCounts: Record<string, number> = {};
  for (const w of workOrders)
    for (const i of w._issues) woIssueCounts[i] = (woIssueCounts[i] ?? 0) + 1;

  const openDeals = deals.filter((d) => d.dealStatus === 'Open');
  const openNoProb = openDeals.filter((d) => d.probabilityPct === null).length;

  const notes: string[] = [];
  if (openDeals.length) {
    notes.push(
      `${openNoProb}/${openDeals.length} open deals (${pct(openNoProb, openDeals.length)}%) have no closure probability — weighted pipeline uses a 0.3 default for those.`,
    );
  }
  const woNoCollection = workOrders.filter((w) => !w.collectionStatus).length;
  if (woNoCollection) {
    notes.push(
      `${woNoCollection}/${workOrders.length} work orders have a blank "Collection status" — collection figures rely on the Collected Amount field instead.`,
    );
  }
  const dealNoValue = deals.filter((d) => d.dealValue === null).length;
  if (dealNoValue) {
    notes.push(
      `${dealNoValue}/${deals.length} deals have no deal value and are excluded from revenue/pipeline sums.`,
    );
  }

  const sectors = new Set<string>([
    ...deals.map((d) => d.sector).filter((s): s is string => Boolean(s)),
    ...workOrders.map((w) => w.sector).filter((s): s is string => Boolean(s)),
  ]);

  return {
    deals: {
      total: deals.length,
      fill: dealFields.map((f) => fieldFill(deals as unknown as Record<string, unknown>[], f)),
      issues: dealIssueCounts,
    },
    workOrders: {
      total: workOrders.length,
      fill: woFields.map((f) => fieldFill(workOrders as unknown as Record<string, unknown>[], f)),
      issues: woIssueCounts,
    },
    crossBoard: {
      note:
        'Work Orders carry a "Serial #" like SDPLDEAL-NNN but the Deals board has no matching id column, ' +
        'so deal↔work-order joins are not reliable. Cross-board analysis is done at the sector / owner level.',
      knownSectors: [...sectors].sort(),
    },
    notes,
  };
}
