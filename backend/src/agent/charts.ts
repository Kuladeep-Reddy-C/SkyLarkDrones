/**
 * Turn the agent's own tool results into chart specs the frontend renders with
 * Recharts. Zero extra LLM calls — the data was already fetched.
 */
import type { AggResult, ChartSpec, ToolCallTrace } from '../types.js';

const MONEY_RE = /value|amount|receivable|billed|collected|gst|pipeline/i;
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Choose ONE unit for the whole series from its magnitude. */
function moneyScale(values: (number | null)[]): { unit: string; div: number } {
  const max = Math.max(0, ...values.map((v) => Math.abs(v ?? 0)));
  if (max >= 1e7) return { unit: '₹ Cr', div: 1e7 };
  if (max >= 1e5) return { unit: '₹ L', div: 1e5 };
  return { unit: '₹', div: 1 };
}

type MaybeAgg = Partial<AggResult> & { error?: unknown };

function fromAggregate(res: MaybeAgg): ChartSpec | null {
  if (!res || !Array.isArray(res.groups) || !res.groupBy) return null;
  const groups = res.groups
    .filter((g) => g.group && g.group !== '(none)' && g.group !== '__all__')
    .slice(0, 12);
  if (groups.length < 2) return null;

  const isCount = res.op === 'count' || !res.metric;
  const isMoney = !isCount && MONEY_RE.test(res.metric ?? '');
  const scale = isMoney ? moneyScale(groups.map((g) => g.value)) : { unit: '', div: 1 };

  return {
    type: 'bar',
    title: isCount ? `${res.groupBy} — count` : `${res.metric} (${res.op}) by ${res.groupBy}`,
    unit: scale.unit,
    data: groups.map((g) => ({
      label: String(g.group),
      value: isCount ? g.count : r2((g.value ?? 0) / scale.div),
    })),
  };
}

function fromPipeline(res: { byStage?: AggResult; error?: unknown }): ChartSpec | null {
  if (!res || !res.byStage?.groups) return null;
  const groups = res.byStage.groups.filter((g) => g.group && g.group !== '(none)');
  if (groups.length < 2) return null;
  const scale = moneyScale(groups.map((g) => g.value));
  const data = [...groups]
    .sort((a, b) => String(a.group).localeCompare(String(b.group)))
    .map((g) => ({
      label: String(g.group).replace(/^[A-Za-z]\.\s*/, ''),
      value: r2((g.value ?? 0) / scale.div),
    }));
  return { type: 'funnel', title: 'Pipeline value by stage', unit: scale.unit, data };
}

export function chartsFromTrace(trace: ToolCallTrace[]): ChartSpec[] {
  const charts: ChartSpec[] = [];
  for (const step of trace) {
    const result = step.result as { error?: unknown } | undefined;
    if (!result || result.error) continue;
    let c: ChartSpec | null = null;
    if (step.tool === 'aggregate_records') c = fromAggregate(result as MaybeAgg);
    else if (step.tool === 'pipeline_analysis') c = fromPipeline(result as { byStage?: AggResult });
    if (c) charts.push(c);
    if (charts.length >= 2) break;
  }
  return charts;
}
