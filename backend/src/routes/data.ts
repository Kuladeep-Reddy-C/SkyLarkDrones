import { Router, type Request, type Response } from 'express';
import { getSnapshot, cacheAgeSeconds } from '../data/store.js';
import { getAccountInfo } from '../monday/client.js';
import { hasLLM, config } from '../config.js';

const router = Router();

const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

router.get('/health', async (_req: Request, res: Response) => {
  const out: Record<string, unknown> = {
    status: 'ok',
    llm: hasLLM,
    model: hasLLM ? config.groq.model : null,
  };
  try {
    const acct = await getAccountInfo();
    out.monday = {
      connected: true,
      user: acct.me?.name,
      account: acct.account?.name,
      tier: acct.account?.tier,
    };
  } catch (err) {
    out.status = 'degraded';
    out.monday = { connected: false, error: errMessage(err) };
  }
  res.status(out.status === 'ok' ? 200 : 503).json(out);
});

router.get('/overview', async (req: Request, res: Response) => {
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
    res.status(502).json({ error: errMessage(err) });
  }
});

router.post('/refresh', async (_req: Request, res: Response) => {
  try {
    const snap = await getSnapshot({ force: true });
    res.json({ refreshed: true, fetchedAt: snap.fetchedAt, counts: snap.counts });
  } catch (err) {
    res.status(502).json({ error: errMessage(err) });
  }
});

export default router;
