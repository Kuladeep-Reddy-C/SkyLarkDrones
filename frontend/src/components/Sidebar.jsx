import { Icon } from '../lib/icons.jsx';

export default function Sidebar({ open, onClose, turns, onNew, onReport, theme, onToggleTheme, health }) {
  const ok = health?.status === 'ok';
  return (
    <aside className={`rail ${open ? 'open' : ''}`} onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="rail-brand">
        <span className="mark"><Icon.lark width={18} height={18} /></span>
        <div>
          <h1>Skylark Signal</h1>
          <p>bi · monday.com</p>
        </div>
      </div>

      <button className="rail-btn" onClick={onNew}>
        <Icon.plus width={15} height={15} /> New conversation
      </button>
      <button className="rail-btn" onClick={onReport}>
        <Icon.report width={15} height={15} /> Leadership briefing
      </button>

      <div className="rail-section eyebrow">This session</div>
      <div className="rail-list">
        {turns.length === 0 && <div className="rail-item" style={{ color: 'var(--ink-faint)' }}>No questions yet</div>}
        {turns.map((t, i) => (
          <button
            key={i}
            className="rail-item"
            title={t}
            onClick={() => document.getElementById(`turn-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="rail-foot">
        <span className={`status-dot ${ok ? '' : 'bad'}`}>
          {ok ? 'Connected to Monday.com' : 'Reconnecting…'}
        </span>
        <button className="icon-btn" onClick={onToggleTheme} title="Toggle theme" aria-label="Toggle theme">
          {theme === 'dark' ? <Icon.sun width={15} height={15} /> : <Icon.moon width={15} height={15} />}
        </button>
      </div>
    </aside>
  );
}
