import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { runAgent } from '../agent/agent.js';
import { ensureConversation, appendTurn, historyFor } from '../conversations.js';
import { hasLLM } from '../config.js';
import { getSnapshot } from '../data/store.js';
import { weightedPipeline } from '../agent/analytics.js';
import { log } from '../logger.js';
import type { AgentEvent } from '../types.js';

const router = Router();

export const ChatBody = z.object({
  message: z.string().trim().min(1, 'message is required').max(2000),
  // the client sends `null` before a conversation exists
  conversationId: z.string().nullish(),
});

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Deterministic answer used when the LLM is unavailable. */
async function fallbackAnswer(message: string): Promise<string> {
  const snap = await getSnapshot();
  const open = snap.deals.filter((d) => d.dealStatus === 'Open');
  const p = weightedPipeline(open);
  return (
    `⚠️ The language model is currently unavailable, so here is a direct data summary.\n\n` +
    `- Deals: ${snap.counts.deals} (open: ${open.length}, open pipeline ₹${p.raw.toLocaleString('en-IN')}, weighted ₹${p.weighted.toLocaleString('en-IN')})\n` +
    `- Work orders: ${snap.counts.workOrders}\n` +
    `- Data caveats: ${snap.quality.notes.join(' ') || 'none'}\n\n` +
    `Your question: "${message}". Please retry shortly for a full answer.`
  );
}

// ---- Non-streaming --------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid request' });
    return;
  }
  const { message } = parsed.data;
  const conv = ensureConversation(parsed.data.conversationId);
  const history = historyFor(conv.id);
  const started = Date.now();
  log.info(`chat[${conv.id}] "${message.slice(0, 80)}"`);

  try {
    let payload;
    if (hasLLM) {
      const r = await runAgent(history, message);
      log.info(
        `chat[${conv.id}] answered in ${Date.now() - started}ms (${r.steps} steps${r.cached ? ', cached' : ''})`,
      );
      payload = {
        conversationId: conv.id,
        reply: r.reply,
        charts: r.charts,
        meta: { ...r.meta, cached: r.cached },
      };
    } else {
      payload = {
        conversationId: conv.id,
        reply: await fallbackAnswer(message),
        charts: [],
        meta: { degraded: true },
      };
    }
    appendTurn(conv.id, 'user', message);
    appendTurn(conv.id, 'assistant', payload.reply);
    res.json(payload);
  } catch (err) {
    log.error('chat error:', err);
    try {
      const reply = await fallbackAnswer(message);
      appendTurn(conv.id, 'user', message);
      appendTurn(conv.id, 'assistant', reply);
      res.json({
        conversationId: conv.id,
        reply,
        charts: [],
        meta: { degraded: true, error: errMessage(err) },
      });
    } catch (err2) {
      res.status(502).json({
        error: 'The agent could not complete this request.',
        detail: errMessage(err),
        dataError: errMessage(err2),
      });
    }
  }
});

// ---- Streaming (Server-Sent Events) -------------------------------------
router.post('/stream', async (req: Request, res: Response) => {
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid request' });
    return;
  }
  const { message } = parsed.data;
  const conv = ensureConversation(parsed.data.conversationId);
  const history = historyFor(conv.id);
  const started = Date.now();
  log.info(`chat[${conv.id}] (stream) "${message.slice(0, 80)}"`);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (obj: AgentEvent): void => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };
  send({ type: 'conversation', conversationId: conv.id });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

  let finalReply = '';
  try {
    if (!hasLLM) {
      finalReply = await fallbackAnswer(message);
      send({ type: 'answer', text: finalReply });
      send({ type: 'done', meta: { model: '', steps: 0, tools: [], degraded: true } });
    } else {
      const r = await runAgent(history, message, { onEvent: send });
      finalReply = r.reply;
      log.info(
        `chat[${conv.id}] (stream) done in ${Date.now() - started}ms${r.cached ? ' (cached)' : ''}`,
      );
    }
    appendTurn(conv.id, 'user', message);
    appendTurn(conv.id, 'assistant', finalReply);
  } catch (err) {
    log.error('chat stream error:', err);
    try {
      finalReply = await fallbackAnswer(message);
      send({ type: 'answer', text: finalReply });
      send({
        type: 'done',
        meta: { model: '', steps: 0, tools: [], degraded: true, error: errMessage(err) },
      });
      appendTurn(conv.id, 'user', message);
      appendTurn(conv.id, 'assistant', finalReply);
    } catch (err2) {
      send({ type: 'error', error: errMessage(err), dataError: errMessage(err2) });
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

export default router;
