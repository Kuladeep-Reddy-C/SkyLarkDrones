import { Router } from 'express';
import { runAgent } from '../agent/agent.js';
import { ensureConversation, appendTurn, historyFor } from '../conversations.js';
import { hasLLM } from '../config.js';
import { getSnapshot } from '../data/store.js';
import { weightedPipeline } from '../agent/analytics.js';
import { log } from '../logger.js';

const router = Router();

/** Minimal deterministic answer used when the LLM is unavailable. */
async function fallbackAnswer(message) {
  const snap = await getSnapshot();
  const open = snap.deals.filter((d) => d.dealStatus === 'Open');
  const p = weightedPipeline(open);
  return (
    `⚠️ The language model is currently unavailable, so here is a direct data summary instead of a conversational answer.\n\n` +
    `- Deals: ${snap.counts.deals} (open: ${open.length}, open pipeline ₹${p.raw.toLocaleString('en-IN')}, weighted ₹${p.weighted.toLocaleString('en-IN')})\n` +
    `- Work orders: ${snap.counts.workOrders}\n` +
    `- Data caveats: ${snap.quality.notes.join(' ') || 'none'}\n\n` +
    `Your question was: "${message}". Please retry shortly for a full answer.`
  );
}

router.post('/', async (req, res) => {
  const { message, conversationId } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  const conv = ensureConversation(conversationId);
  const history = historyFor(conv.id);

  try {
    let payload;
    if (hasLLM) {
      const result = await runAgent(history, message.trim());
      payload = {
        conversationId: conv.id,
        reply: result.reply,
        meta: { model: result.model, steps: result.steps, tools: result.toolTrace },
      };
    } else {
      payload = {
        conversationId: conv.id,
        reply: await fallbackAnswer(message.trim()),
        meta: { model: null, degraded: true },
      };
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
      return res.json({ conversationId: conv.id, reply, meta: { degraded: true, error: err.message } });
    } catch (err2) {
      return res.status(502).json({
        error: 'The agent could not complete this request.',
        detail: err.message,
        dataError: err2.message,
      });
    }
  }
});

export default router;
