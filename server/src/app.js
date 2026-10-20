import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, getSetting, printSetupHints } from './db.js';
import { HttpError, rateLimit } from './util.js';
import { makeAuth, authRoutes, googleConfigured } from './auth.js';
import { toolRoutes } from './tools.js';
import { paymentRoutes, providerReady } from './payments.js';
import { adminRoutes } from './admin.js';
import { channelRoutes, runAbScheduler } from './channel.js';
import { geminiKey } from './gemini.js';

export async function buildApp({ databaseUrl = process.env.DATABASE_URL, dataDir = process.env.DATA_DIR || './data/pglite', scheduler = true } = {}) {
  const db = await openDb({ url: databaseUrl, dataDir: databaseUrl ? undefined : dataDir });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // CORS: a extensão usa Bearer token (não cookies); cookies só valem no mesmo domínio.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Idempotency-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: '6mb' })); // capas em base64 (até 2 MB cada, x2 no A/B)
  app.use(cookieParser());

  app.use('/api/auth/register', rateLimit(10, 10 * 60 * 1000));
  app.use('/api/auth/login', rateLimit(30, 10 * 60 * 1000));
  app.use('/api/tools', rateLimit(120, 60 * 1000));

  const auth = makeAuth(db);
  authRoutes(app, db, auth);
  toolRoutes(app, db, auth);
  paymentRoutes(app, db, auth);
  adminRoutes(app, db, auth);
  channelRoutes(app, db, auth);

  app.get('/api/plans', async (req, res, next) => {
    try {
      res.json({ items: await db.all('SELECT id,name,price_cents,monthly_credits,description FROM plans WHERE active=1 ORDER BY sort') });
    } catch (e) { next(e); }
  });
  app.get('/api/settings/public', async (req, res, next) => {
    try {
      res.json({
        site_name: (await getSetting(db, 'site_name')) || 'TurboCanal',
        payments_enabled: (await getSetting(db, 'payments_enabled')) === '1' && (await providerReady(db)),
        youtube_configured: !!((await getSetting(db, 'yt_api_key')) || process.env.YT_API_KEY),
        gemini_configured: !!(await geminiKey(db)),
        google_login: googleConfigured()
      });
    } catch (e) { next(e); }
  });
  app.get('/api/health', (req, res) => res.json({ ok: true, db: db.kind }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota de API não encontrada.' }));

  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web');
  app.use(express.static(webDir));
  app.get('*', (req, res) => res.sendFile(path.join(webDir, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err instanceof HttpError ? err.status : err?.type === 'entity.too.large' ? 413 : 500;
    if (status >= 500) console.error('[erro]', err);
    res.status(status).json({ error: status === 413 ? 'Arquivo grande demais.' : err.message || 'Erro interno.', ...(err.extra || {}) });
  });

  await printSetupHints(db);
  if (scheduler) {
    setInterval(() => runAbScheduler(db).catch((e) => console.error('[ab]', e.message)), 5 * 60 * 1000).unref();
  }
  return { app, db };
}
