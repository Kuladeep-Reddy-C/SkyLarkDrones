import { Router } from 'express';
import { runAgent } from '../agent/agent.js';
import { ensureConversation, appendTurn, historyFor } from '../conversations.js';
import { hasLLM } from '../config.js';
import { getSnapshot } from '../data/store.js';
import { weightedPipeline } from '../agent/analytics.js';
import { log } from '../logger.js';

const router = Router();

/** Deterministic answer used when the LLM is unavailable. */
async function fallbackAnswer(message) {
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
router.post('/', async (req, res) => {
  const { message, conversationId } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }
  const conv = ensureConversation(conversationId);
  const history = historyFor(conv.id);
  const started = Date.now();
  log.info(`chat[${conv.id}] "${message.trim().slice(0, 80)}"`);

  try {
    let payload;
    if (hasLLM) {
      const r = await runAgent(history, message.trim());
      log.info(`chat[${conv.id}] answered in ${Date.now() - started}ms (${r.steps} steps${r.cached ? ', cached' : ''})`);
      payload = { conversationId: conv.id, reply: r.reply, charts: r.charts || [], meta: { ...r.meta, cached: r.cached } };
    } else {
      payload = { conversationId: conv.id, reply: await fallbackAnswer(message.trim()), charts: [], meta: { degraded: true } };
    }
    appendTurn(conv.id, 'user', message.trim());
    appendTurn(conv.id, 'assistant', payload.reply);
    return res.json(payload);
  } catch (err) {
    log.error('chat error:', err.stack || err.message);
    try {
      const reply = await fallbackAnswer(message.trim());
      appendTurn(conv.id, 'user', message.trim());
      appendTurn(conv.id, 'assistant', reply);
      return res.json({ conversationId: conv.id, reply, charts: [], meta: { degraded: true, error: err.message } });
    } catch (err2) {
      return res.status(502).json({ error: 'The agent could not complete this request.', detail: err.message, dataError: err2.message });
    }
  }
});

// ---- Streaming (Server-Sent Events) --------------------------------------
router.post('/stream', async (req, res) => {
  const { message, conversationId } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }
  const conv = ensureConversation(conversationId);
  const history = historyFor(conv.id);
  const started = Date.now();
  log.info(`chat[${conv.id}] (stream) "${message.trim().slice(0, 80)}"`);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  send({ type: 'conversation', conversationId: conv.id });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

  let finalReply = '';
  try {
    if (!hasLLM) {
      finalReply = await fallbackAnswer(message.trim());
      send({ type: 'answer', text: finalReply });
      send({ type: 'done', meta: { degraded: true } });
    } else {
      const r = await runAgent(history, message.trim(), { onEvent: send });
      finalReply = r.reply;
      log.info(`chat[${conv.id}] (stream) done in ${Date.now() - started}ms${r.cached ? ' (cached)' : ''}`);
    }
    appendTurn(conv.id, 'user', message.trim());
    appendTurn(conv.id, 'assistant', finalReply);
  } catch (err) {
    log.error('chat stream error:', err.stack || err.message);
    try {
      finalReply = await fallbackAnswer(message.trim());
      send({ type: 'answer', text: finalReply });
      send({ type: 'done', meta: { degraded: true, error: err.message } });
      appendTurn(conv.id, 'user', message.trim());
      appendTurn(conv.id, 'assistant', finalReply);
    } catch (err2) {
      send({ type: 'error', error: err.message, dataError: err2.message });
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

export default router;
