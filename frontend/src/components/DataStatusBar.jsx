import { useState } from 'react';

function ago(iso) {
  if (!iso) return 'unknown';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export default function DataStatusBar({ overview, onRefresh }) {
  const [open, setOpen] = useState(false);
  if (!overview) return <div className="statusbar loading">Connecting to Monday.com…</div>;

  const { counts, quality, fetchedAt } = overview;
  const caveats = quality?.notes || [];

  return (
    <div className="statusbar">
      <div className="statusbar-row">
        <span>
          <strong>{counts?.deals ?? '—'}</strong> deals · <strong>{counts?.workOrders ?? '—'}</strong> work orders
        </span>
        <span className="muted">· snapshot {ago(fetchedAt)}</span>
        <button className="link" onClick={onRefresh}>refresh</button>
        {caveats.length > 0 && (
          <button className="link warn" onClick={() => setOpen((o) => !o)}>
            {caveats.length} data caveat{caveats.length > 1 ? 's' : ''} {open ? '▲' : '▼'}
          </button>
        )}
      </div>
      {open && (
        <ul className="caveats">
          {caveats.map((c, i) => <li key={i}>{c}</li>)}
          {quality?.crossBoard?.note && <li>{quality.crossBoard.note}</li>}
        </ul>
      )}
    </div>
  );
}
