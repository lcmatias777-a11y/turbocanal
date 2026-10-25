import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, getSetting, printSetupHints } from './db.js';
import { HttpError, rateLimit } from './util.js';
import { makeAuth, authRoutes, googleConfigured } from './auth.js';
import { toolRoutes } from './tools.js';
import { paymentRoutes, providerReady } from './payments.js';
import { hotmartRoutes } from './hotmart.js';
import { adminRoutes } from './admin.js';
import { channelRoutes, runAbScheduler } from './channel.js';
import { reviewRoutes } from './reviews.js';
import { notifyRoutes } from './notify.js';
import { pedidoRoutes } from './pedidos.js';
import { chatRoutes } from './chat.js';
import { xrayRoutes } from './xray.js';
import { proximaRoutes } from './proxima.js';
import { experimentoRoutes } from './experimentos.js';
import { estatisticaRoutes } from './estatisticas.js';
import { pushRoutes } from './push.js';
import { publicoRoutes } from './publico.js';
import { perfilRoutes } from './perfil.js';
import { postagemRoutes } from './postagens.js';
import { enqueteRoutes } from './enquetes.js';
import { canalTesteRoutes } from './canalteste.js';
import { middleware as guardaMiddleware } from './guarda.js';
import { blockRoutes } from './blocks.js';
import { geminiKey } from './gemini.js';

export async function buildApp({ databaseUrl = process.env.DATABASE_URL, dataDir = process.env.DATA_DIR || './data/pglite', scheduler = true } = {}) {
  const db = await openDb({ url: databaseUrl, dataDir: databaseUrl ? undefined : dataDir });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // CORS: a extensão usa Bearer token (não cookies); cookies só valem no mesmo domínio.
  app.use(guardaMiddleware);   // guarda de escrita: ver src/guarda.js
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
  hotmartRoutes(app, db);
  adminRoutes(app, db, auth);
  channelRoutes(app, db, auth);
  reviewRoutes(app, db, auth);
  blockRoutes(app, db, auth);
  notifyRoutes(app, db, auth);
  pedidoRoutes(app, db, auth);
  chatRoutes(app, db, auth);
  xrayRoutes(app, db, auth);
  proximaRoutes(app, db, auth);
  experimentoRoutes(app, db, auth);
  estatisticaRoutes(app, db, auth);
  pushRoutes(app, db, auth);
  publicoRoutes(app, db, auth);
  perfilRoutes(app, db, auth);
  postagemRoutes(app, db, auth);
  enqueteRoutes(app, db, auth);
  canalTesteRoutes(app, db, auth);

  app.get('/api/plans', async (req, res, next) => {
    try {
      res.json({ items: await db.all('SELECT id,name,price_cents,price_year_cents,monthly_credits,description FROM plans WHERE active=1 ORDER BY sort') });
    } catch (e) { next(e); }
  });
  app.get('/api/settings/public', async (req, res, next) => {
    try {
      res.json({
        site_name: (await getSetting(db, 'site_name')) || 'TurboCanal',
        // A tela anunciava "5.000 créditos" em texto fixo em tres lugares, mas o
        // valor e editavel em Admin > Configuracoes: bastava o administrador
        // mudar para as tres frases passarem a mentir. Agora vem daqui.
        free_monthly_topup: parseInt((await getSetting(db, 'free_monthly_topup')) || '5000', 10),
        payments_enabled: (await getSetting(db, 'payments_enabled')) === '1' && (await providerReady(db)),
        youtube_configured: !!((await getSetting(db, 'yt_api_key')) || process.env.YT_API_KEY),
        gemini_configured: !!(await geminiKey(db)),
        google_login: googleConfigured()
      });
    } catch (e) { next(e); }
  });
  app.get('/api/health', (req, res) => res.json({ ok: true, db: db.kind }));
  // Versão atual da extensão (a extensão compara com a dela e avisa quando há atualização)
  let extVersion = null;
  try { extVersion = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../extension/manifest.json'), 'utf8')).version; } catch {}
  app.get('/api/extension/version', (req, res) => res.json({ version: extVersion, download: '/turbocanal-extensao.zip' }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota de API não encontrada.' }));

  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web');
  // Páginas legais em URLs reais (o Google lê sem JavaScript)
  app.get(['/privacidade', '/privacy'], (req, res) => res.sendFile(path.join(webDir, 'privacidade.html')));
  app.get(['/termos', '/terms'], (req, res) => res.sendFile(path.join(webDir, 'termos.html')));
  // Motor do editor de vídeo (ffmpeg.wasm), servido do próprio site e com cache longo
  const nm = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules/@ffmpeg');
  const vendorOpts = { maxAge: '30d', immutable: true, setHeaders: (r, f) => { if (f.endsWith('.wasm')) r.setHeader('Content-Type', 'application/wasm'); } };
  app.use('/vendor/ffmpeg/ffmpeg', express.static(path.join(nm, 'ffmpeg/dist/esm'), vendorOpts));
  app.use('/vendor/ffmpeg/util', express.static(path.join(nm, 'util/dist/esm'), vendorOpts));
  app.use('/vendor/ffmpeg/core', express.static(path.join(nm, 'core/dist/esm'), vendorOpts));
  /* A página sempre sai com um número de versão colado no endereço do app.js e
   * do styles.css. Sem isso o navegador guarda os arquivos e continua usando a
   * cópia velha depois de uma publicação: a correção sobe para o servidor e
   * quem já tinha entrado no site nunca a vê. Com o número mudando a cada
   * publicação, o endereço muda junto e o navegador é obrigado a buscar de novo.
   * No Render o número é o commit publicado; fora dele, a hora em que o
   * servidor subiu. */
  const VERSAO = (process.env.RENDER_GIT_COMMIT || '').slice(0, 8) || String(Date.now());
  let paginaInicial = null;
  const servirPagina = (req, res, next) => {
    try {
      if (paginaInicial === null) {
        paginaInicial = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8')
          .replace(/(\/assets\/(?:app\.js|styles\.css))(["'])/g, `$1?v=${VERSAO}$2`);
      }
      res.type('html').set('Cache-Control', 'no-cache').send(paginaInicial);
    } catch (e) { next(e); }
  };
  app.get(['/', '/index.html'], servirPagina);
  app.use(express.static(webDir));
  app.get('*', servirPagina);

  // eslint-disable-next-line no-unused-vars
  // Código curto para a pessoa citar quando avisar do erro; o mesmo código sai
  // no log do servidor, então dá para achar o erro dela entre todos.
  const erroId = () => Math.random().toString(36).slice(2, 8).toUpperCase();
  app.use((err, req, res, next) => {
    const status = err instanceof HttpError ? err.status : err?.type === 'entity.too.large' ? 413 : 500;
    const id = status >= 500 ? erroId() : null;
    if (id) console.error(`[erro ${id}] ${req.method} ${req.path}`, err);
    // Erro 500 é erro MEU, não do usuário, e a mensagem dele costuma ser
    // interna: caminho de arquivo, texto do Postgres, nome de tabela e rota
    // (a guarda de escrita, por exemplo). Isso ia inteiro para o navegador.
    // Agora o texto cru fica no log do servidor e a pessoa recebe uma frase
    // que ela entende, com um código para ela me passar. Em desenvolvimento
    // e nos testes a mensagem continua aparecendo, que é onde ela serve.
    const cru = status === 413 ? 'Arquivo grande demais.' : err.message || 'Erro interno.';
    // "No ar" = tem banco Postgres de verdade. Em desenvolvimento e nos testes o
    // banco é em memória, e ali a mensagem crua é justamente o que eu preciso ver.
    const noAr = !!process.env.DATABASE_URL && process.env.MOSTRAR_ERRO_CRU !== '1';
    const paraOUsuario = status >= 500 && noAr
      ? `Deu um erro aqui do nosso lado, não foi culpa sua. Já ficou registrado. Código: ${id}`
      : cru;
    res.status(status).json({ error: paraOUsuario, ...(err.extra || {}) });
  });

  await printSetupHints(db);
  if (scheduler) {
    // Cada tarefa roda dentro de tarefaDoSite: fora de requisição a guarda de
    // escrita barra por padrão, e quem roda aqui diz o nome por escrito.
    const { tarefaDoSite } = await import('./guarda.js');
    setInterval(() => tarefaDoSite('teste A/B', [], () => runAbScheduler(db)).catch((e) => console.error('[ab]', e.message)), 5 * 60 * 1000).unref();
    setInterval(() => tarefaDoSite('avisos de experimento', [], async () => {
      const { avisarExperimentos } = await import('./experimentos.js'); await avisarExperimentos(db);
    }).catch((e) => console.error('[experimentos]', e.message)), 60 * 60 * 1000).unref();
    setInterval(() => tarefaDoSite('estatísticas', [], async () => {
      const { recalcularTodos } = await import('./estatisticas.js'); await recalcularTodos(db);
    }).catch((e) => console.error('[estatisticas]', e.message)), 6 * 60 * 60 * 1000).unref();
  }
  return { app, db };
}
