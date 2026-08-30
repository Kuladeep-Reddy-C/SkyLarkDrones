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

export const api = {
  health: () => req('/api/data/health'),
  overview: (refresh = false) => req(`/api/data/overview${refresh ? '?refresh=1' : ''}`),
  refresh: () => req('/api/data/refresh', { method: 'POST' }),
  chat: (message, conversationId) =>
    req('/api/chat', { method: 'POST', body: JSON.stringify({ message, conversationId }) }),
  leadership: (narrative = true) =>
    req(`/api/report/leadership${narrative ? '' : '?narrative=0'}`),
};
