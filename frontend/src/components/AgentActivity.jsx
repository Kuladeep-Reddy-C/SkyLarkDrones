import { useEffect, useState } from 'react';

/**
 * The "cooking" panel: a live timeline of what the agent is doing while the
 * user waits. `steps` is an array of { id, label, state: 'run'|'done', summary }.
 */
const IDLE_LINES = [
  'Connecting to Monday.com…',
  'Reading the Deals and Work Orders boards…',
  'Normalising dates, currencies and sector names…',
  'Checking data quality…',
];

export default function AgentActivity({ steps, phase }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (phase !== 'thinking' || steps.length) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 1400);
    return () => clearInterval(t);
  }, [phase, steps.length]);

  return (
    <div className="activity">
      <div className="activity-head">
        <span className="spinner" />
        <span>{phase === 'answering' ? 'Writing the answer…' : 'Preparing your briefing'}</span>
      </div>
      <ul>
        {steps.length === 0 && (
          <li className="run"><span className="dot" />{IDLE_LINES[tick % IDLE_LINES.length]}</li>
        )}
        {steps.map((s) => (
          <li key={s.id} className={s.state}>
            <span className="dot" />
            <span className="lbl">{s.label}</span>
            {s.summary && <span className="sum">{s.summary}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
