import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { config } from './config.js';
import { log } from './logger.js';
import chatRoutes from './routes/chat.js';
import dataRoutes from './routes/data.js';
import reportRoutes from './routes/report.js';
import { getSnapshot } from './data/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || config.server.corsOrigins.includes(origin) || config.server.corsOrigins.includes('*')) {
        return cb(null, true);
      }
      return cb(null, false);
    },
  }),
);

app.use('/api/chat', chatRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/report', reportRoutes);

app.get('/healthz', (_req, res) => res.status(200).send('ok'));

app.get('/api', (_req, res) => {
  res.json({
    name: 'Skylark Drones BI Agent API',
    endpoints: [
      'GET  /api/data/health',
      'GET  /api/data/overview[?refresh=1]',
      'POST /api/data/refresh',
      'POST /api/chat            { message, conversationId? }',
      'GET  /api/report/leadership[?narrative=0]',
      'GET  /api/report/leadership/metrics',
    ],
  });
});

// Optionally serve the built frontend (single-service deploy)
const clientDir = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    return res.sendFile(path.join(clientDir, 'index.html'));
  });
  log.info(`Serving frontend from ${clientDir}`);
}

app.use((err, _req, res, _next) => {
  log.error(err.stack || err.message);
  res.status(500).json({ error: 'Internal error', detail: err.message });
});

app.listen(config.server.port, () => {
  log.info(`Skylark BI Agent API listening on :${config.server.port}`);
  log.info(`LLM: ${config.groq.apiKey ? config.groq.model : 'DISABLED (no GROQ_API_KEY)'}`);
  // Warm the cache in the background (non-fatal if Monday is briefly unreachable)
  getSnapshot().then(
    (s) => log.info(`Snapshot warm: ${s.counts.deals} deals, ${s.counts.workOrders} work orders`),
    (e) => log.warn(`Initial snapshot failed (will retry on first request): ${e.message}`),
  );
});
