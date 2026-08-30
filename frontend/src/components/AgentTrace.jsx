import { useEffect, useState } from 'react';
import { Icon } from '../lib/icons.jsx';

const IDLE = [
  'Reading the Deals and Work Orders boards…',
  'Normalising dates, currencies and sector names…',
  'Checking the data-quality report…',
  'Planning the analysis…',
];

export default function AgentTrace({ steps, phase }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (steps.length) return undefined;
    const t = setInterval(() => setI((n) => n + 1), 1500);
    return () => clearInterval(t);
  }, [steps.length]);

  return (
    <div className="trace">
      <div className="trace-head">
        <span className="spinner" />
        {phase === 'answering' ? 'Composing the answer' : 'Working'}
      </div>
      <ul className="trace-steps">
        {steps.length === 0 && (
          <li className="run"><span className="glyph" /><span className="lbl">{IDLE[i % IDLE.length]}</span></li>
        )}
        {steps.map((s) => (
          <li key={s.id} className={s.state}>
            <span className="glyph">{s.state === 'done' && <Icon.check width={9} height={9} />}</span>
            <span className="lbl">{s.label}</span>
            {s.summary && <span className="sum">{s.summary}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
