/**
 * A compact, always-fresh schema + data snapshot summary injected directly into
 * the system prompt. Lets the agent answer most questions WITHOUT first spending
 * an LLM round-trip on `get_data_overview`.
 */
import { getSnapshot } from '../data/store.js';
import type { Deal, WorkOrder } from '../types.js';

function uniq(rows: (Deal | WorkOrder)[], field: string, n = 7): string {
  const s = new Set<unknown>();
  for (const r of rows) {
    const v = (r as unknown as Record<string, unknown>)[field];
    if (v !== null && v !== undefined && v !== '') s.add(v);
    if (s.size >= n) break;
  }
  return [...s].join(' | ');
}

let cached: { key: string | null; text: string } = { key: null, text: '' };

export async function buildSchemaBrief(): Promise<string> {
  const snap = await getSnapshot();
  if (cached.key === snap.fetchedAt) return cached.text;
  const { deals: d, workOrders: w } = snap;

  const text = `## Live snapshot (${snap.fetchedAt}) — ${d.length} deals, ${w.length} work orders

DEALS fields: name, ownerCode, clientCode, dealStatus [Open|Won|Lost|On Hold],
dealStage ("A. .. O. .."), dealStageRank (1-15), closureProbability [High|Medium|Low],
probabilityPct (High .8/Med .5/Low .2), dealValue (INR, ~48% blank),
weightedValue (=dealValue*probabilityPct), sector [${uniq(d, 'sector')}],
isEnergySector (bool: Renewables or Power & Transmission), productDeal,
createdDate/createdMonth, tentativeCloseDate, closeDateActual.

WORK_ORDERS fields: name, customerCode, serial (SDPLDEAL-NNN, NOT joinable to Deals),
natureOfWork, executionStatus [${uniq(w, 'executionStatus', 5)} ..], typeOfWork,
sector (same canon), bdKamCode, skylarkPlatform [NONE|SPECTRA|DMO],
amountInGst/amountExGst, billedInGst, collectedInGst, toBeBilledInGst, receivable,
arPriority (bool), invoiceStatus, billingStatus, woStatusBilled [Open|Closed],
poDate/poMonth, startDate, endDate, deliveryDate, lastInvoiceDate.

Caveats: ${(snap.quality.notes ?? []).join(' ')}

Call get_data_overview only if you need an exact distinct-value list not shown here.`;

  cached = { key: snap.fetchedAt, text };
  return text;
}
