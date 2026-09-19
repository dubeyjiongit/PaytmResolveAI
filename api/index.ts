import express from 'express';
import cors from 'cors';
import { apiRouter } from '../backend/src/routes/api.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true, data: { status: 'healthy', timestamp: new Date().toISOString() } });
});

app.use('/api', apiRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'No API route matches this path.' } });
});

export default app;
