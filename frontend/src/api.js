const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.detail || `HTTP ${res.status}`);
  return body;
}

/**
 * Streaming chat over SSE (POST + ReadableStream). Calls onEvent({type, ...})
 * for every server event. Resolves when the stream closes.
 */
async function chatStream(message, conversationId, onEvent) {
  const res = await fetch(`${BASE}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversationId }),
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()));
      } catch { /* ignore malformed frame */ }
    }
  }
}

export const api = {
  health: () => req('/api/data/health'),
  overview: (refresh = false) => req(`/api/data/overview${refresh ? '?refresh=1' : ''}`),
  refresh: () => req('/api/data/refresh', { method: 'POST' }),
  chat: (message, conversationId) =>
    req('/api/chat', { method: 'POST', body: JSON.stringify({ message, conversationId }) }),
  chatStream,
  leadership: (narrative = true) => req(`/api/report/leadership${narrative ? '' : '?narrative=0'}`),
};
