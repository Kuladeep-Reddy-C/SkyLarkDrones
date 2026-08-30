import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Charts from './Charts.jsx';

export default function Message({ message }) {
  const { role, content, meta, charts } = message;
  const isUser = role === 'user';
  return (
    <div className={`msg ${isUser ? 'user' : 'assistant'}`}>
      <div className={`bubble ${meta?.error ? 'error' : ''}`}>
        {isUser ? (
          <p>{content}</p>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || ''}</ReactMarkdown>
        )}
      </div>

      {!isUser && charts?.length > 0 && <Charts charts={charts} />}

      {!isUser && meta && !meta.welcome && (
        <div className="msg-meta">
          {meta.cached && <span title="served from a recent identical question">cached</span>}
          {meta.model && <span>{meta.model}</span>}
          {meta.degraded && <span className="warn">degraded mode</span>}
          {Array.isArray(meta.tools) && meta.tools.length > 0 && (
            <span title={meta.tools.map((t) => t.tool).join(', ')}>
              {meta.tools.length} data {meta.tools.length === 1 ? 'call' : 'calls'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
