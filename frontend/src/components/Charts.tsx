import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  LabelList,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import type { ChartSpec } from '../types.ts';

const SERIES = [
  'var(--accent)',
  'var(--sky)',
  'var(--ok)',
  'var(--warn)',
  '#7c6aa8',
  '#4b8a8a',
  '#9c6f4a',
  '#6a86a8',
];

function TooltipBox({ active, payload, unit }: TooltipProps<number, string> & { unit: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as { label: string; value: number };
  return (
    <div
      style={{
        background: 'var(--surface, var(--panel))',
        border: '1px solid var(--line-strong, var(--line-bright))',
        borderRadius: 8,
        padding: '6px 10px',
        fontSize: 12,
        boxShadow: 'var(--shadow)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div style={{ color: 'var(--ink-faint)' }}>{p.label}</div>
      <div style={{ color: 'var(--ink)', fontWeight: 600 }}>
        {p.value}
        {unit ? ` ${unit}` : ''}
      </div>
    </div>
  );
}

function ChartCard({ spec }: { spec: ChartSpec }) {
  const data = spec.data ?? [];
  const height = Math.max(160, Math.min(380, data.length * 32 + 36));
  const funnel = spec.type === 'funnel';
  return (
    <div className="chart-card">
      <p className="chart-title">
        {spec.title}
        {spec.unit ? ` · ${spec.unit}` : ''}
      </p>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ left: 4, right: 34, top: 2, bottom: 2 }}
          barCategoryGap={funnel ? 2 : 6}
        >
          <CartesianGrid horizontal={false} stroke="var(--line)" />
          <XAxis type="number" tick={{ fontSize: 10 }} stroke="var(--line-bright)" />
          <YAxis
            type="category"
            dataKey="label"
            width={funnel ? 150 : 118}
            tick={{ fontSize: 11, fill: 'var(--ink-soft)' }}
            stroke="var(--line-bright)"
          />
          <Tooltip cursor={{ fill: 'var(--panel-2)' }} content={<TooltipBox unit={spec.unit} />} />
          <Bar
            dataKey="value"
            radius={[0, 5, 5, 0]}
            maxBarSize={26}
            animationDuration={750}
            animationEasing="ease-out"
          >
            {data.map((_, i) => (
              <Cell
                key={i}
                fill={funnel ? 'var(--accent)' : SERIES[i % SERIES.length]}
                fillOpacity={funnel ? 1 - i * 0.05 : 0.92}
              />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              style={{
                fill: 'var(--ink-faint)',
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Charts({ charts }: { charts?: ChartSpec[] }) {
  if (!charts?.length) return null;
  return (
    <div className="charts">
      {charts.map((c, i) => (
        <ChartCard key={i} spec={c} />
      ))}
    </div>
  );
}
