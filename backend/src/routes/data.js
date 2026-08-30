import { Router } from 'express';
import { getSnapshot, cacheAgeSeconds } from '../data/store.js';
import { getAccountInfo } from '../monday/client.js';
import { hasLLM, config } from '../config.js';

const router = Router();

router.get('/health', async (_req, res) => {
  const out = { status: 'ok', llm: hasLLM, model: hasLLM ? config.groq.model : null };
  try {
    const acct = await getAccountInfo();
    out.monday = { connected: true, user: acct.me?.name, account: acct.account?.name, tier: acct.account?.tier };
  } catch (err) {
    out.status = 'degraded';
    out.monday = { connected: false, error: err.message };
  }
  res.status(out.status === 'ok' ? 200 : 503).json(out);
});

router.get('/overview', async (req, res) => {
  try {
    const snap = await getSnapshot({ force: req.query.refresh === '1' });
    res.json({
      fetchedAt: snap.fetchedAt,
      ageSeconds: cacheAgeSeconds(),
      boards: snap.boards,
      counts: snap.counts,
      quality: snap.quality,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/refresh', async (_req, res) => {
  try {
    const snap = await getSnapshot({ force: true });
    res.json({ refreshed: true, fetchedAt: snap.fetchedAt, counts: snap.counts });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
