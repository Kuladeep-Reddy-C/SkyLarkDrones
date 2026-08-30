import { Router, type Request, type Response } from 'express';
import { generateLeadershipReport, computeLeadershipMetrics } from '../reports/leadership.js';

const router = Router();

const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

router.get('/leadership', async (req: Request, res: Response) => {
  try {
    const useLLM = req.query.narrative !== '0';
    res.json(await generateLeadershipReport({ useLLM }));
  } catch (err) {
    res.status(502).json({ error: errMessage(err) });
  }
});

router.get('/leadership/metrics', async (_req: Request, res: Response) => {
  try {
    res.json(await computeLeadershipMetrics());
  } catch (err) {
    res.status(502).json({ error: errMessage(err) });
  }
});

export default router;
