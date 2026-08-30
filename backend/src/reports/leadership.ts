/**
 * Leadership update generator.
 *
 * Interpretation of the optional requirement ("help prepare data for leadership
 * updates"): a one-click, board-ready snapshot of the pipeline + execution
 * numbers a founder would put in front of investors / the leadership team, with
 * data-quality caveats attached so nobody is misled.
 *
 *  1. `computeLeadershipMetrics()` — deterministic aggregates (always available).
 *  2. `generateLeadershipReport()` — optional LLM narrative; falls back to a
 *     templated Markdown report with the same numbers.
 */
import { getSnapshot } from '../data/store.js';
import { weightedPipeline, aggregate } from '../agent/analytics.js';
import { chat } from '../agent/groqClient.js';
import { LEADERSHIP_PROMPT } from '../agent/systemPrompt.js';
import { hasLLM } from '../config.js';
import type { AggGroup } from '../types.js';

const crore = (n: number | null): number | null =>
  n == null ? null : Math.round((n / 1e7) * 100) / 100;

const fmtINR = (n: number | null | undefined): string => {
  if (n == null) return 'n/a';
  if (Math.abs(n) >= 1e7) return `₹${crore(n)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${Math.round((n / 1e5) * 10) / 10} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};

export interface LeadershipMetrics {
  generatedAt: string;
  dataFetchedAt: string;
  period: { latestDealMonth: string | null };
  pipeline: {
    openDeals: number;
    openValueRaw: number;
    openValueWeighted: number;
    openValueRawFmt: string;
    openValueWeightedFmt: string;
    missingProbability: number;
    byStage: AggGroup[];
    bySector: AggGroup[];
  };
  closed: {
    won: number;
    wonValue: number;
    wonValueFmt: string;
    lost: number;
    lostValue: number;
    lostValueFmt: string;
    winRateByCount: number | null;
  };
  execution: {
    workOrders: number;
    byStatus: AggGroup[];
    orderValue: number;
    orderValueFmt: string;
    billed: number;
    billedFmt: string;
    collected: number;
    collectedFmt: string;
    receivable: number;
    receivableFmt: string;
    collectionRate: number | null;
    arPriorityCount: number;
  };
  sectorPerformance: AggGroup[];
  caveats: string[];
}

export async function computeLeadershipMetrics(): Promise<LeadershipMetrics> {
  const snap = await getSnapshot();
  const { deals, workOrders, quality } = snap;

  const open = deals.filter((d) => d.dealStatus === 'Open');
  const won = deals.filter((d) => d.dealStatus === 'Won');
  const lost = deals.filter((d) => d.dealStatus === 'Lost');

  const pipeline = weightedPipeline(open);
  const wonValue = won.reduce((s, d) => s + (d.dealValue ?? 0), 0);
  const lostValue = lost.reduce((s, d) => s + (d.dealValue ?? 0), 0);
  const winRateByCount = won.length + lost.length ? won.length / (won.length + lost.length) : null;

  const latestMonth =
    deals
      .map((d) => d.createdMonth)
      .filter((m): m is string => Boolean(m))
      .sort()
      .at(-1) ?? null;

  const sum = (fn: (w: (typeof workOrders)[number]) => number): number =>
    workOrders.reduce((s, w) => s + fn(w), 0);
  const orderValue = sum((w) => w.amountInGst ?? 0);
  const billed = sum((w) => w.billedInGst ?? 0);
  const collected = sum((w) => w.collectedInGst ?? 0);
  const receivable = sum((w) => w.receivable ?? 0);
  const arPriorityCount = workOrders.filter((w) => w.arPriority).length;

  return {
    generatedAt: new Date().toISOString(),
    dataFetchedAt: snap.fetchedAt,
    period: { latestDealMonth: latestMonth },
    pipeline: {
      openDeals: open.length,
      openValueRaw: pipeline.raw,
      openValueWeighted: pipeline.weighted,
      openValueRawFmt: fmtINR(pipeline.raw),
      openValueWeightedFmt: fmtINR(pipeline.weighted),
      missingProbability: pipeline.missingProb,
      byStage: aggregate(open as unknown as Record<string, unknown>[], {
        groupBy: 'dealStage',
        metric: 'dealValue',
        op: 'sum',
      }).groups,
      bySector: aggregate(open as unknown as Record<string, unknown>[], {
        groupBy: 'sector',
        metric: 'dealValue',
        op: 'sum',
      }).groups,
    },
    closed: {
      won: won.length,
      wonValue,
      wonValueFmt: fmtINR(wonValue),
      lost: lost.length,
      lostValue,
      lostValueFmt: fmtINR(lostValue),
      winRateByCount,
    },
    execution: {
      workOrders: workOrders.length,
      byStatus: aggregate(workOrders as unknown as Record<string, unknown>[], {
        groupBy: 'executionStatus',
        op: 'count',
      }).groups,
      orderValue,
      orderValueFmt: fmtINR(orderValue),
      billed,
      billedFmt: fmtINR(billed),
      collected,
      collectedFmt: fmtINR(collected),
      receivable,
      receivableFmt: fmtINR(receivable),
      collectionRate: billed ? collected / billed : null,
      arPriorityCount,
    },
    sectorPerformance: aggregate(workOrders as unknown as Record<string, unknown>[], {
      groupBy: 'sector',
      metric: 'amountInGst',
      op: 'sum',
    }).groups,
    caveats: quality.notes,
  };
}

function templateReport(m: LeadershipMetrics): string {
  const pctS = (x: number | null): string => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);
  const list = (groups: AggGroup[], suffix: string, n: number): string =>
    groups
      .slice(0, n)
      .map((g) => `  - ${g.group}: ${fmtINR(g.value)} (${g.count} ${suffix})`)
      .join('\n');

  const execStatus = m.execution.byStatus.map((g) => `  - ${g.group}: ${g.count}`).join('\n');
  const caveats =
    m.caveats.map((c) => `- ${c}`).join('\n') || '- No material data-quality issues detected.';

  return `# Leadership Update — Skylark Drones
_Generated ${new Date(m.generatedAt).toUTCString()} · data pulled ${new Date(m.dataFetchedAt).toUTCString()}_

## Executive Summary
Open pipeline stands at **${m.pipeline.openValueRawFmt}** across **${m.pipeline.openDeals} deals**, or **${m.pipeline.openValueWeightedFmt}** probability-weighted. To date the team has **won ${m.closed.won} deals (${m.closed.wonValueFmt})** and lost ${m.closed.lost} (${m.closed.lostValueFmt}) — a ${pctS(m.closed.winRateByCount)} win rate by count. On delivery, ${m.execution.workOrders} work orders represent **${m.execution.orderValueFmt}** of booked value, of which ${m.execution.billedFmt} is billed and ${m.execution.collectedFmt} collected, leaving **${m.execution.receivableFmt} receivable**.

## Pipeline Health
- Open deals: ${m.pipeline.openDeals} · raw value ${m.pipeline.openValueRawFmt} · weighted ${m.pipeline.openValueWeightedFmt}
- ${m.pipeline.missingProbability} open deals have no closure probability (0.3 default applied)
- By stage (top 5):
${list(m.pipeline.byStage, 'deals', 5)}
- By sector:
${list(m.pipeline.bySector, 'deals', 6)}

## Revenue & Collections
- Won value (all-time in data): ${m.closed.wonValueFmt} · Lost value: ${m.closed.lostValueFmt}
- Booked order value: ${m.execution.orderValueFmt}
- Billed: ${m.execution.billedFmt} · Collected: ${m.execution.collectedFmt} · Collection rate ${pctS(m.execution.collectionRate)}
- Outstanding receivable: ${m.execution.receivableFmt} · AR-priority accounts: ${m.execution.arPriorityCount}

## Sector Performance (delivered work order value)
${list(m.sectorPerformance, 'WOs', 6)}

## Operational Delivery
- Work orders by execution status:
${execStatus}

## Data Quality Caveats
${caveats}
`;
}

export interface LeadershipReport {
  markdown: string;
  metrics: LeadershipMetrics;
  mode: 'llm' | 'template' | 'template-fallback';
  model?: string;
}

export async function generateLeadershipReport({
  useLLM = true,
}: { useLLM?: boolean } = {}): Promise<LeadershipReport> {
  const metrics = await computeLeadershipMetrics();
  const fallback = templateReport(metrics);

  if (!useLLM || !hasLLM) return { markdown: fallback, metrics, mode: 'template' };

  try {
    const res = await chat({
      messages: [
        { role: 'system', content: LEADERSHIP_PROMPT },
        {
          role: 'user',
          content:
            'Here are the computed metrics (authoritative — do not change the numbers, format them nicely):\n\n' +
            JSON.stringify(metrics, null, 2),
        },
      ],
      temperature: 0.3,
      max_tokens: 1600,
    });
    const md = res.choices?.[0]?.message?.content?.trim();
    if (md && md.length > 200) return { markdown: md, metrics, mode: 'llm', model: res.model };
    return { markdown: fallback, metrics, mode: 'template' };
  } catch {
    return { markdown: fallback, metrics, mode: 'template-fallback' };
  }
}
