import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts';

const PALETTE = ['#2563eb', '#0f9d58', '#b45309', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#ea580c'];

function ChartCard({ spec }) {
  const data = spec.data || [];
  const height = Math.max(180, Math.min(360, data.length * 34 + 40));
  return (
    <div className="chart-card">
      <div className="chart-title">{spec.title}{spec.unit ? ` · ${spec.unit}` : ''}</div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="#eee" />
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis
            type="category"
            dataKey="label"
            width={spec.type === 'funnel' ? 150 : 120}
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            formatter={(v) => [`${v}${spec.unit ? ` ${spec.unit}` : ''}`, '']}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive>
            {data.map((_, i) => (
              <Cell key={i} fill={spec.type === 'funnel' ? PALETTE[0] : PALETTE[i % PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Charts({ charts }) {
  if (!charts?.length) return null;
  return (
    <div className="charts">
      {charts.map((c, i) => <ChartCard key={i} spec={c} />)}
    </div>
  );
}
