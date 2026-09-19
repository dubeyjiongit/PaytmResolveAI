/**
 * PaytmResolve AI — Express Server Entry Point
 * ---------------------------------------------------------------------------
 * Zero external DB dependencies: the moment this process starts, the mock
 * database (backend/src/mockDb/transactions.ts) is already fully seeded in
 * memory. `npm install && npm run dev` is enough — no migrations, no
 * connection strings, no external services.
 *
 * In production this same process also serves the built frontend
 * (`frontend/dist`), so the whole app deploys as a single unified service
 * on Render, Railway, or any other Node host.
 * ---------------------------------------------------------------------------
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { apiRouter } from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = Number(process.env.PORT) || 5000;
const NODE_ENV = process.env.NODE_ENV ?? 'development';

// ============================================================================
// CORE MIDDLEWARE
// ============================================================================

app.use(cors());
app.use(express.json({ limit: '10mb' })); // generous limit: base64 receipt uploads for the OCR route

// ============================================================================
// API ROUTES
// ============================================================================

app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, data: { status: 'healthy', env: NODE_ENV, timestamp: new Date().toISOString() } });
});

app.use('/api', apiRouter);

// Anything under /api that didn't match a route above is a genuine 404 —
// never fall through to the SPA index.html for API paths.
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'No API route matches this path.' } });
});

// ============================================================================
// UNIFIED STATIC FRONTEND SERVING
// ----------------------------------------------------------------------------
// Gated on "does a built frontend actually exist", not on NODE_ENV. Some
// hosts (Render, Railway, plain `node backend/dist/index.js`) don't always
// guarantee NODE_ENV=production is set before the process starts, and this
// app has zero external runtime dependencies to spend on a cross-platform
// env-var-setting tool just to make that guarantee hold. Checking the
// filesystem instead means: run `npm run build` at the repo root once, then
// `npm start` (or any host's default start command) always serves the
// unified app correctly, in any environment, with no extra flags.
// ============================================================================

const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');

if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));

  // SPA fallback: any non-API GET request returns index.html so the
  // frontend's client-side router can take over.
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
} else if (NODE_ENV === 'production') {
  // eslint-disable-next-line no-console
  console.warn(
    `[PaytmResolve AI] No built frontend was found at ${frontendDistPath}. ` +
      'Run "npm run build" at the repo root before starting the server, or use "npm run dev" for local development with the Vite dev server.',
  );
}

// ============================================================================
// GENERIC ERROR HANDLER — last line of defense, never let the process crash
// on a request-scoped error.
// ============================================================================

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  // eslint-disable-next-line no-console
  console.error('[PaytmResolve AI] Unhandled request error:', message);
  res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message } });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[PaytmResolve AI] Backend listening on port ${PORT} (NODE_ENV=${NODE_ENV})`);
});
