import { useRef, useState } from 'react';
import { Icon } from '../lib/icons.jsx';

export default function Composer({ onSend, busy }) {
  const [text, setText] = useState('');
  const ref = useRef(null);

  function grow(el) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }
  function submit(e) {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    onSend(text);
    setText('');
    if (ref.current) ref.current.style.height = 'auto';
  }

  return (
    <div className="composer-wrap">
      <form className="composer" onSubmit={submit}>
        <textarea
          ref={ref}
          value={text}
          rows={1}
          placeholder="Ask about pipeline, revenue, sectors, collections…"
          disabled={busy}
          onChange={(e) => { setText(e.target.value); grow(e.target); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); }}
        />
        <button className="send-btn" type="submit" disabled={busy || !text.trim()} aria-label="Send">
          {busy ? <span className="spinner" style={{ borderTopColor: 'var(--accent-ink)' }} /> : <Icon.send width={16} height={16} />}
        </button>
      </form>
      <div className="composer-hint">
        <span>⏎ send</span><span>⇧ ⏎ newline</span><span>live data · Monday.com</span>
      </div>
    </div>
  );
}
