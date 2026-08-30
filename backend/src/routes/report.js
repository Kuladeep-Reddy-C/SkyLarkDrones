import { Router } from 'express';
import { generateLeadershipReport, computeLeadershipMetrics } from '../reports/leadership.js';

const router = Router();

router.get('/leadership', async (req, res) => {
  try {
    const useLLM = req.query.narrative !== '0';
    const result = await generateLeadershipReport({ useLLM });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/leadership/metrics', async (_req, res) => {
  try {
    res.json(await computeLeadershipMetrics());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
