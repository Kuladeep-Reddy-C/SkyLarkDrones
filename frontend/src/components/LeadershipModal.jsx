import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api.js';

export default function LeadershipModal({ onClose }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    api
      .leadership(true)
      .then((r) => alive && setState({ loading: false, ...r }))
      .catch((e) => alive && setState({ loading: false, error: e.message }));
    return () => { alive = false; };
  }, []);

  function copy() {
    navigator.clipboard?.writeText(state.markdown || '');
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Leadership Update</h2>
          <div>
            {state.markdown && <button className="btn" onClick={copy}>Copy Markdown</button>}
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="modal-body">
          {state.loading && <p className="muted">Pulling live data and drafting the update…</p>}
          {state.error && <p className="error-text">⚠️ {state.error}</p>}
          {state.markdown && (
            <>
              {state.mode && (
                <p className="muted small">
                  Mode: {state.mode}
                  {state.model ? ` · ${state.model}` : ''} · numbers computed deterministically from live Monday data
                </p>
              )}
              <div className="report">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{state.markdown}</ReactMarkdown>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
