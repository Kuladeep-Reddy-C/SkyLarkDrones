import type { AgentEvent, HealthResponse, LeadershipResponse, OverviewResponse } from './types.ts';

const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error((body.error as string) || (body.detail as string) || `HTTP ${res.status}`);
  }
  return body as T;
}

/**
 * Streaming chat over SSE (POST + ReadableStream). Calls onEvent for every
 * server event; resolves when the stream closes.
 */
async function chatStream(
  message: string,
  conversationId: string | null,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversationId }),
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
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
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as AgentEvent);
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}

export const api = {
  health: () => req<HealthResponse>('/api/data/health'),
  overview: (refresh = false) =>
    req<OverviewResponse>(`/api/data/overview${refresh ? '?refresh=1' : ''}`),
  refresh: () => req<{ refreshed: boolean }>('/api/data/refresh', { method: 'POST' }),
  chatStream,
  leadership: (narrative = true) =>
    req<LeadershipResponse>(`/api/report/leadership${narrative ? '' : '?narrative=0'}`),
};
