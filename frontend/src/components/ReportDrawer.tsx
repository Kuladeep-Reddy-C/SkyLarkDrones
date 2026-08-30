import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api.ts';
import { Icon } from '../lib/icons.tsx';

interface State {
  loading: boolean;
  markdown?: string;
  mode?: string;
  model?: string;
  error?: string;
}

export default function ReportDrawer({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<State>({ loading: true });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .leadership(true)
      .then((r) => alive && setState({ loading: false, ...r }))
      .catch(
        (e: unknown) =>
          alive && setState({ loading: false, error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = () => {
    navigator.clipboard?.writeText(state.markdown ?? '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label="Leadership briefing">
        <div className="drawer-head">
          <Icon.report width={18} height={18} style={{ color: 'var(--accent)' }} />
          <h2>Leadership briefing</h2>
          <span className="grow" />
          {state.markdown && (
            <button className="copy-btn" onClick={copy}>
              <Icon.copy width={12} height={12} /> {copied ? 'Copied' : 'Copy Markdown'}
            </button>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon.close width={15} height={15} />
          </button>
        </div>

        <div className="drawer-body">
          {state.loading && (
            <>
              <p className="report-mode">Pulling live data and drafting the briefing…</p>
              {Array.from({ length: 9 }).map((_, i) => (
                <div
                  key={i}
                  className="skeleton-line"
                  style={{ width: `${60 + ((i * 37) % 40)}%` }}
                />
              ))}
            </>
          )}
          {state.error && <p className="error-text">⚠️ {state.error}</p>}
          {state.markdown && (
            <>
              <p className="report-mode">
                {state.mode === 'llm' ? 'Narrative by ' : 'Templated · '}
                {state.model ? state.model.replace('openai/', '') : ''}
                {' · figures computed deterministically from live Monday.com data'}
              </p>
              <div className="prose">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{state.markdown}</ReactMarkdown>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
