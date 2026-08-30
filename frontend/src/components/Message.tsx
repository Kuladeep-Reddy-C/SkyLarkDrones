import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Charts from './Charts.tsx';
import { Icon } from '../lib/icons.tsx';
import type { ChatMessage } from '../types.ts';

interface Props {
  message: ChatMessage;
  index: number;
}

export default function Message({ message, index }: Props) {
  const { role, content, meta, charts } = message;
  const [copied, setCopied] = useState(false);
  const isUser = role === 'user';

  if (isUser) {
    return (
      <div className="msg user" id={`turn-${index}`}>
        <div className="body">{content}</div>
      </div>
    );
  }

  const copy = () => {
    navigator.clipboard?.writeText(content || '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className="msg assistant">
      <div className="who">
        <span className="avatar">
          <Icon.lark width={13} height={13} />
        </span>
        <span className="name">Skylark</span>
      </div>

      <div className={`prose ${meta?.error ? 'error-text' : ''}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || ''}</ReactMarkdown>
      </div>

      {charts && charts.length > 0 && <Charts charts={charts} />}

      {meta && !meta.welcome && (
        <div className="msg-meta">
          {!meta.error && (
            <button className="copy-btn" onClick={copy}>
              <Icon.copy width={12} height={12} /> {copied ? 'Copied' : 'Copy'}
            </button>
          )}
          {meta.cached && <span className="tag accent">cached</span>}
          {meta.model && <span className="tag">{meta.model.replace('openai/', '')}</span>}
          {meta.degraded && <span className="tag warn">degraded</span>}
          {Array.isArray(meta.tools) && meta.tools.length > 0 && (
            <span className="tag" title={meta.tools.map((t) => t.tool).join(' · ')}>
              {meta.tools.length} data {meta.tools.length === 1 ? 'call' : 'calls'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
