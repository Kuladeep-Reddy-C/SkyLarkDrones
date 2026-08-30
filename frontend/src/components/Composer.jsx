import { useState } from 'react';

export default function Composer({ onSend, busy }) {
  const [text, setText] = useState('');

  function submit(e) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    onSend(text);
    setText('');
  }

  return (
    <form className="composer" onSubmit={submit}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) submit(e);
        }}
        placeholder="Ask about pipeline, revenue, sectors, collections…"
        rows={1}
        disabled={busy}
      />
      <button type="submit" className="btn primary" disabled={busy || !text.trim()}>
        {busy ? '…' : 'Send'}
      </button>
    </form>
  );
}
