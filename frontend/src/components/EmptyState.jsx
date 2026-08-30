import { Icon } from '../lib/icons.jsx';

const PROMPTS = [
  { icon: 'spark', cat: 'Pipeline', q: "How's our pipeline looking for the energy sector this quarter?" },
  { icon: 'coin', cat: 'Revenue', q: 'Total open pipeline value, weighted by probability, broken down by stage' },
  { icon: 'layers', cat: 'Sectors', q: 'Which sectors generate the most delivered revenue?' },
  { icon: 'wallet', cat: 'Collections', q: 'How are collections? Any large receivables outstanding?' },
  { icon: 'box', cat: 'Delivery', q: 'Break down work orders by execution status' },
  { icon: 'user', cat: 'People', q: 'Which sales owner has the strongest pipeline?' },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning.';
  if (h < 18) return 'Good afternoon.';
  return 'Good evening.';
}

export default function EmptyState({ onPick, counts }) {
  return (
    <div className="empty">
      <div className="radar" aria-hidden="true">
        <span /><span /><span /><span className="sweep" />
      </div>
      <h2 className="greeting">{greeting()} <em>What would you like to know?</em></h2>
      <p className="sub">
        Ask a founder-level question about the sales pipeline or project execution.
        I read the live Deals and Work Orders boards from Monday.com
        {counts ? ` — ${counts.deals} deals, ${counts.workOrders} work orders` : ''}.
      </p>
      <div className="prompt-grid">
        {PROMPTS.map((p) => {
          const I = Icon[p.icon];
          return (
            <button key={p.q} className="prompt-card" onClick={() => onPick(p.q)}>
              <span className="pc-head">
                <I width={16} height={16} />
                <span className="eyebrow" style={{ color: 'inherit' }}>{p.cat}</span>
              </span>
              <span className="pc-q">{p.q}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
