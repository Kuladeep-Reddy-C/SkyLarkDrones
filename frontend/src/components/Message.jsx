import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function Message({ message }) {
  const { role, content, meta } = message;
  const isUser = role === 'user';
  return (
    <div className={`msg ${isUser ? 'user' : 'assistant'}`}>
      <div className={`bubble ${meta?.error ? 'error' : ''}`}>
        {isUser ? (
          <p>{content}</p>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        )}
      </div>
      {!isUser && meta && !meta.welcome && (
        <div className="msg-meta">
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
