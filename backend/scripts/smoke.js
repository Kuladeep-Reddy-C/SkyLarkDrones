/**
 * Offline smoke test: exercises the data layer + analytics + leadership metrics
 * against live Monday data, WITHOUT the LLM. Prints numbers to eyeball.
 *   npm run smoke
 */
import { getSnapshot } from '../src/data/store.js';
import { applyFilters, aggregate, weightedPipeline } from '../src/agent/analytics.js';
import { executeTool } from '../src/agent/tools.js';
import { computeLeadershipMetrics } from '../src/reports/leadership.js';

const line = (s) => console.log(`\n=== ${s} ===`);

const snap = await getSnapshot();
console.log(`deals=${snap.counts.deals} workOrders=${snap.counts.workOrders} fetchedAt=${snap.fetchedAt}`);

line('Deals by status (count + value)');
console.table(aggregate(snap.deals, { groupBy: 'dealStatus', metric: 'dealValue', op: 'sum' }).groups);

line('Open pipeline overall');
const open = snap.deals.filter((d) => d.dealStatus === 'Open');
console.log(weightedPipeline(open));

line('Energy sector (Renewables + Power & Transmission) — all deals by status');
const energy = applyFilters(snap.deals, [{ field: 'isEnergySector', op: 'eq', value: true }]);
console.table(aggregate(energy, { groupBy: 'dealStatus', metric: 'dealValue', op: 'sum' }).groups);
console.log('open energy pipeline:', weightedPipeline(energy.filter((d) => d.dealStatus === 'Open')));

line('Deals by sector (open only, weighted)');
for (const g of aggregate(open, { groupBy: 'sector', metric: 'dealValue', op: 'sum' }).groups) {
  console.log(`  ${g.group}: raw ${g.value}  (${g.count} deals)`);
}

line('Work orders by execution status');
console.table(aggregate(snap.workOrders, { groupBy: 'executionStatus', op: 'count' }).groups);

line('Work order money totals');
const sum = (f) => snap.workOrders.reduce((s, w) => s + (w[f] || 0), 0);
console.log({
  orderValueInGst: sum('amountInGst'),
  billedInGst: sum('billedInGst'),
  collectedInGst: sum('collectedInGst'),
  receivable: sum('receivable'),
});

line('tool: aggregate_records (deals, group by dealStage, sum dealValue)');
console.log(JSON.stringify(await executeTool('aggregate_records', {
  board: 'deals', group_by: 'dealStage', metric: 'dealValue', op: 'sum',
}), null, 1).slice(0, 1500));

line('tool: query_records with between date filter');
console.log(JSON.stringify(await executeTool('query_records', {
  board: 'deals',
  filters: [
    { field: 'isEnergySector', op: 'eq', value: true },
    { field: 'tentativeCloseDate', op: 'between', value: ['2026-01-01', '2026-03-31'] },
  ],
  fields: ['name', 'sector', 'dealStatus', 'dealValue', 'tentativeCloseDate'],
}), null, 1));

line('Leadership metrics');
const m = await computeLeadershipMetrics();
console.log(JSON.stringify({
  pipeline: m.pipeline.openValueRawFmt,
  weighted: m.pipeline.openValueWeightedFmt,
  won: m.closed.won, wonValue: m.closed.wonValueFmt,
  lost: m.closed.lost,
  orderValue: m.execution.orderValueFmt,
  billed: m.execution.billedFmt,
  collected: m.execution.collectedFmt,
  receivable: m.execution.receivableFmt,
  caveats: m.caveats,
}, null, 1));

process.exit(0);
