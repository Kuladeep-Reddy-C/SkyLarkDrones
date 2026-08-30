import { useState } from 'react';
import { Icon } from '../lib/icons.tsx';
import type { OverviewResponse } from '../types.ts';

function ago(iso: string | undefined): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

interface Props {
  overview: OverviewResponse | null;
  onRefresh: () => Promise<void> | void;
}

export default function SnapshotChip({ overview, onRefresh }: Props) {
  const [open, setOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);
  if (!overview) return <span className="snapshot-chip">connecting…</span>;

  const { counts, quality, fetchedAt } = overview;
  const caveats = quality?.notes ?? [];

  const refresh = async () => {
    setSpinning(true);
    await onRefresh();
    setSpinning(false);
  };

  return (
    <>
      <span className="snapshot-chip">
        <b className="num">{counts?.deals ?? '—'}</b> deals
        <span className="sep">·</span>
        <b className="num">{counts?.workOrders ?? '—'}</b> WOs
        <span className="sep">·</span>
        <span title={fetchedAt}>{ago(fetchedAt)}</span>
        <button onClick={refresh} title="Refresh from Monday.com">
          <Icon.refresh
            width={12}
            height={12}
            style={{ animation: spinning ? 'spin .7s linear infinite' : 'none' }}
          />
        </button>
        {caveats.length > 0 && (
          <button onClick={() => setOpen((o) => !o)} style={{ color: 'var(--warn)' }}>
            {caveats.length} caveat{caveats.length > 1 ? 's' : ''}
          </button>
        )}
      </span>

      {open && (
        <div className="caveat-pop">
          <h4 className="eyebrow" style={{ color: 'var(--warn)' }}>
            Data-quality caveats
          </h4>
          <ul>
            {caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
            {quality?.crossBoard?.note && <li>{quality.crossBoard.note}</li>}
          </ul>
        </div>
      )}
    </>
  );
}
