import { describe, it, expect } from 'vitest';
import { chartsFromTrace } from './charts.js';
import type { ToolCallTrace } from '../types.js';

function trace(tool: string, result: unknown): ToolCallTrace[] {
  return [{ tool, args: {}, ok: true, result }];
}

describe('chartsFromTrace', () => {
  it('builds a bar chart from an aggregate_records result, one unit for the whole series', () => {
    const [chart] = chartsFromTrace(
      trace('aggregate_records', {
        groupBy: 'sector',
        metric: 'amountInGst',
        op: 'sum',
        groups: [
          { group: 'Renewables', count: 36, value: 87_000_000 },
          { group: 'Railways', count: 2, value: 6_600_000 },
        ],
      }),
    );
    expect(chart.type).toBe('bar');
    expect(chart.unit).toBe('₹ Cr');
    // Railways must be expressed in the SAME unit (crore), not lakh
    expect(chart.data).toEqual([
      { label: 'Renewables', value: 8.7 },
      { label: 'Railways', value: 0.66 },
    ]);
  });

  it('builds a funnel from pipeline_analysis, sorted by stage letter', () => {
    const [chart] = chartsFromTrace(
      trace('pipeline_analysis', {
        byStage: {
          groups: [
            { group: 'E. Proposal', count: 3, value: 20_000_000 },
            { group: 'B. SQL', count: 2, value: 5_000_000 },
          ],
        },
      }),
    );
    expect(chart.type).toBe('funnel');
    expect(chart.data.map((d) => d.label)).toEqual(['SQL', 'Proposal']);
  });

  it('skips single-group and errored results, caps at 2 charts', () => {
    expect(chartsFromTrace(trace('aggregate_records', { error: 'boom' }))).toHaveLength(0);
    expect(
      chartsFromTrace(
        trace('aggregate_records', {
          groupBy: 'x',
          op: 'count',
          groups: [{ group: 'a', count: 1, value: null }],
        }),
      ),
    ).toHaveLength(0);
  });
});
