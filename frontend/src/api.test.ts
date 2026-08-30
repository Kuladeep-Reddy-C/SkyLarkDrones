import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from './api.ts';
import type { AgentEvent } from './types.ts';

function sseResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      // deliberately split across chunk boundaries to exercise the buffer
      const blob = frames.map((f) => `data: ${f}\n\n`).join('');
      const mid = Math.floor(blob.length / 2);
      controller.enqueue(enc.encode(blob.slice(0, mid)));
      controller.enqueue(enc.encode(blob.slice(mid)));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => vi.restoreAllMocks());

describe('api.chatStream', () => {
  it('parses SSE frames split across chunks and forwards each event', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        JSON.stringify({ type: 'conversation', conversationId: 'abc' }),
        JSON.stringify({
          type: 'tool',
          id: '0',
          tool: 'aggregate_records',
          label: 'Aggregating deals',
        }),
        JSON.stringify({ type: 'answer', text: 'Pipeline is ₹26.4 Cr.' }),
        JSON.stringify({ type: 'done', meta: { model: 'gpt-oss-20b', steps: 2, tools: [] } }),
      ]),
    );

    const events: AgentEvent[] = [];
    await api.chatStream('hi', null, (e) => events.push(e));

    expect(events.map((e) => e.type)).toEqual(['conversation', 'tool', 'answer', 'done']);
    const answer = events.find((e) => e.type === 'answer');
    expect(answer && 'text' in answer && answer.text).toBe('Pipeline is ₹26.4 Cr.');
  });

  it('throws a useful error on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'message is required' }), { status: 400 }),
    );
    await expect(api.chatStream('', null, () => {})).rejects.toThrow('message is required');
  });
});
