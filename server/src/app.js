import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, getSetting, printSetupHints } from './db.js';
import { HttpError, rateLimit } from './util.js';
import { makeAuth, authRoutes } from './auth.js';
import { toolRoutes } from './tools.js';
import { paymentRoutes, providerReady } from './payments.js';
import { adminRoutes } from './admin.js';

export function buildApp({ dbPath = process.env.DB_PATH || './data/turbocanal.db' } = {}) {
  const db = openDb(dbPath);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // CORS: a extensão do Chrome usa Bearer token (não cookies), então liberar a
  // origem com '*' é seguro aqui; cookies só valem no mesmo domínio do site.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Idempotency-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Proteção básica contra abuso em cadastro/login (criação automática de contas)
  app.use('/api/auth/register', rateLimit(10, 10 * 60 * 1000));
  app.use('/api/auth/login', rateLimit(30, 10 * 60 * 1000));
  app.use('/api/tools', rateLimit(120, 60 * 1000));

  const auth = makeAuth(db);
  authRoutes(app, db, auth);
  toolRoutes(app, db, auth);
  paymentRoutes(app, db, auth);
  adminRoutes(app, db, auth);

  // Informações públicas para o site e a extensão
  app.get('/api/plans', (req, res) => {
    res.json({ items: db.prepare('SELECT id,name,price_cents,monthly_credits,description FROM plans WHERE active=1 ORDER BY sort').all() });
  });
  app.get('/api/settings/public', (req, res) => {
    res.json({
      site_name: getSetting(db, 'site_name') || 'TurboCanal',
      payments_enabled: getSetting(db, 'payments_enabled') === '1' && providerReady(db),
      youtube_configured: !!(getSetting(db, 'yt_api_key') || process.env.YT_API_KEY),
      google_login: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    });
  });
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // 404 de API em JSON
  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota de API não encontrada.' }));

  // Site estático (SPA)
  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web');
  app.use(express.static(webDir));
  app.get('*', (req, res) => res.sendFile(path.join(webDir, 'index.html')));

  // Tratamento central de erros (sem vazar segredos ou stack para o cliente)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error('[erro]', err);
    res.status(status).json({ error: err.message || 'Erro interno.', ...(err.extra || {}) });
  });

  printSetupHints(db);
  return { app, db };
}
