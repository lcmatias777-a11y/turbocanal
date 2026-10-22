import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';
import { HttpError, audit, isEmail, must, now, uid, ym } from './util.js';
import { ensureRefill, getUser } from './credits.js';

const COOKIE = 'tc_token';
// Login básico já inclui leitura do YouTube (as ferramentas de pesquisa/análise usam o
// token do próprio usuário, sem chave de API). "Conectar canal" pede gestão completa.
const BASIC_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/youtube.readonly'];
const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/yt-analytics.readonly'
];
export const isManageScope = (scopes) => /auth\/youtube(\s|$)|youtube\.force-ssl/.test(String(scopes || ''));

const baseUrl = () => (process.env.BASE_URL || 'http://localhost:8787').replace(/\/$/, '');
export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
// Com o login do Google configurado, cadastro/login por senha ficam desligados (só Google),
// a menos que PASSWORD_LOGIN=1. Sem Google (ex.: rodando local/testes), a senha funciona.
export const passwordLoginEnabled = () => process.env.PASSWORD_LOGIN === '1' || !googleConfigured();

async function secret(db) {
  return getSetting(db, 'jwt_secret');
}

export async function signToken(db, userId, days = 30) {
  const u = await db.get('SELECT sessao_v FROM users WHERE id=?', [userId]);
  return jwt.sign({ uid: userId, sv: Number(u?.sessao_v || 0) }, await secret(db), { expiresIn: `${days}d` });
}

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: 30 * 24 * 3600 * 1000,
    path: '/'
  };
}

export async function publicUser(db, user) {
  if (!user) return null;
  const plan = await db.get('SELECT id,name,price_cents,monthly_credits FROM plans WHERE id=?', [user.plan_id]);
  const yt = await db.get('SELECT channel_id, channel_title, refresh_token, scopes FROM yt_tokens WHERE user_id=?', [user.id]);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    plan_id: user.plan_id,
    plan,
    credits: user.credits,
    unlimited: user.role === 'owner',
    created_at: user.created_at,
    youtube: yt && isManageScope(yt.scopes)
      ? { connected: true, channel_id: yt.channel_id, channel_title: yt.channel_title }
      : { connected: false, readonly: !!yt }
  };
}

export function makeAuth(db) {
  function readToken(req) {
    const h = req.get('Authorization');
    if (h && h.startsWith('Bearer ')) return h.slice(7);
    return req.cookies?.[COOKIE] || null;
  }

  const required = async (req, res, next) => {
    try {
      const tk = readToken(req);
      if (!tk) throw new HttpError(401, 'Faça login para continuar.');
      let payload;
      try {
        payload = jwt.verify(tk, await secret(db));
      } catch {
        throw new HttpError(401, 'Sessão inválida ou expirada. Entre novamente.');
      }
      // Papel e saldo sempre lidos do banco (nunca confiar no que o navegador manda)
      const user = await getUser(db, payload.uid);
      if (!user) throw new HttpError(401, 'Conta não encontrada. Entre novamente.');
      if (Number(payload.sv || 0) !== Number(user.sessao_v || 0)) {
        throw new HttpError(401, 'Esta sessão foi encerrada. Entre de novo com o Google.');
      }
      if (user.banido) throw new HttpError(403, `Esta conta está suspensa.${user.banido_motivo ? ` Motivo: ${user.banido_motivo}` : ''} Se achar que é engano, fale com o administrador do site.`);
      req.user = await ensureRefill(db, user);
      next();
    } catch (e) {
      next(e);
    }
  };

  const requireRole = (...roles) => (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'Faça login para continuar.'));
    if (!roles.includes(req.user.role)) {
      return next(new HttpError(403, 'Acesso restrito: você não tem permissão para esta área.'));
    }
    next();
  };

  /** Deixa passar sem login, mas preenche req.user quando houver sessão válida.
   *  Serve para páginas públicas que mostram algo a mais para quem está logado. */
  const optional = async (req, res, next) => {
    try {
      const tk = readToken(req);
      if (tk) {
        const payload = jwt.verify(tk, await secret(db));
        const user = await getUser(db, payload.uid);
        if (user) req.user = user;
      }
    } catch {}
    next();
  };

  return {
    required,
    optional,
    admin: [required, requireRole('owner', 'admin')],
    owner: [required, requireRole('owner')]
  };
}

async function createUser(db, { email, passHash = null, name = '', googleSub = null }) {
  const free = await db.get('SELECT * FROM plans WHERE id=?', ['free']);
  const id = uid();
  await db.tx(async (q) => {
    await q.run(
      'INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,last_refill,google_sub,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [id, email, passHash, name, 'user', 'free', free.monthly_credits, ym(), googleSub, now()]
    );
    await q.run(
      'INSERT INTO transactions(id,user_id,delta,balance_after,tool,note,idem_key,created_at) VALUES(?,?,?,?,?,?,?,?)',
      [uid(), id, free.monthly_credits, free.monthly_credits, null, 'Créditos iniciais do plano Free', null, now()]
    );
  });
  const novo = await getUser(db, id);
  try {
    const { avisos } = await import('./notify.js');
    await avisos.boasVindas(db, novo);
  } catch {}
  return novo;
}

async function grantOwnerIfVerified(db, user, email, via) {
  const ownerEmail = ((await getSetting(db, 'owner_email')) || '').toLowerCase();
  if (email === ownerEmail && user.role !== 'owner') {
    await db.run("UPDATE users SET role='owner' WHERE id=?", [user.id]);
    await audit(db, user, 'auth.claim_owner_google', email, via);
    return getUser(db, user.id);
  }
  return user;
}

export function authRoutes(app, db, auth) {
  app.post('/api/auth/register', async (req, res, next) => {
    try {
      if (!passwordLoginEnabled()) throw new HttpError(403, 'Cadastro apenas com o Google. Use "Entrar com Google".');
      const email = must(req.body?.email, 'e-mail', { max: 190 }).toLowerCase();
      const password = must(req.body?.password, 'senha', { max: 200 });
      const name = String(req.body?.name || '').trim().slice(0, 120);
      if (!isEmail(email)) throw new HttpError(400, 'E-mail inválido.');
      if (password.length < 8) throw new HttpError(400, 'A senha precisa ter pelo menos 8 caracteres.');
      const exists = await db.get('SELECT 1 AS x FROM users WHERE email=?', [email]);
      if (exists) throw new HttpError(409, 'Já existe uma conta com esse e-mail. Faça login.');
      const user = await createUser(db, { email, passHash: bcrypt.hashSync(password, 10), name });
      await audit(db, user, 'auth.register', email);
      const token = await signToken(db, user.id);
      res.cookie(COOKIE, token, cookieOpts());
      res.json({ user: await publicUser(db, user), token });
    } catch (e) {
      next(e);
    }
  });

  // Encerrar TODAS as sessões da minha conta. É o botão de emergência de verdade:
  // se alguém entrou na sua conta do Google, isso derruba o invasor na hora.
  app.post('/api/me/sair-de-tudo', auth.required, async (req, res, next) => {
    try {
      await db.run('UPDATE users SET sessao_v=sessao_v+1 WHERE id=?', [req.user.id]);
      await audit(db, req.user, 'auth.sessoes_encerradas', req.user.id, 'pela própria pessoa');
      res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined });
      res.json({ ok: true, aviso: 'Todas as sessões foram encerradas, inclusive esta. Entre de novo com o Google.' });
    } catch (e) { next(e); }
  });

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      if (!passwordLoginEnabled()) throw new HttpError(403, 'Login apenas com o Google. Use "Entrar com Google".');
      const email = must(req.body?.email, 'e-mail', { max: 190 }).toLowerCase();
      const password = must(req.body?.password, 'senha', { max: 200 });
      const user = await db.get('SELECT * FROM users WHERE email=?', [email]);
      if (!user || !user.pass_hash || !bcrypt.compareSync(password, user.pass_hash)) {
        throw new HttpError(401, 'E-mail ou senha incorretos.');
      }
      const token = await signToken(db, user.id);
      res.cookie(COOKIE, token, cookieOpts());
      res.json({ user: await publicUser(db, await ensureRefill(db, user)), token });
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/me', auth.required, async (req, res, next) => {
    try {
      res.json({ user: await publicUser(db, req.user) });
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/me/password', auth.required, async (req, res, next) => {
    try {
      const current = must(req.body?.current, 'senha atual', { max: 200 });
      const nextPwd = must(req.body?.next, 'nova senha', { max: 200 });
      if (nextPwd.length < 8) throw new HttpError(400, 'A nova senha precisa ter pelo menos 8 caracteres.');
      if (!req.user.pass_hash || !bcrypt.compareSync(current, req.user.pass_hash)) {
        throw new HttpError(401, 'Senha atual incorreta.');
      }
      await db.run('UPDATE users SET pass_hash=? WHERE id=?', [bcrypt.hashSync(nextPwd, 10), req.user.id]);
      await audit(db, req.user, 'auth.password_change', req.user.email);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // Token para a extensão do Chrome (Bearer). Mesmo usuário, mesmo saldo.
  app.get('/api/auth/token', auth.required, async (req, res) => {
    res.json({ token: await signToken(db, req.user.id), aviso: 'Guarde este token como uma senha. Ele dá acesso à sua conta.' });
  });

  /**
   * Reivindicação do administrador principal (owner) pelo token de setup do console.
   * O e-mail enviado pelo navegador NÃO basta: precisa estar logado na conta cujo
   * e-mail é o owner_email E informar o token impresso no console (uso único).
   */
  app.post('/api/auth/claim-owner', auth.required, async (req, res, next) => {
    try {
      const token = must(req.body?.token, 'token de setup', { max: 200 });
      const ownerEmail = ((await getSetting(db, 'owner_email')) || '').toLowerCase();
      const stored = await getSetting(db, 'admin_setup_token');
      if (req.user.email.toLowerCase() !== ownerEmail) {
        throw new HttpError(403, 'Esta conta não é o e-mail do administrador principal configurado no servidor.');
      }
      if (!stored || token !== stored) {
        await audit(db, req.user, 'auth.claim_owner_fail', req.user.email, 'token incorreto');
        throw new HttpError(403, 'Token de setup incorreto. Ele é impresso no console do servidor na primeira execução.');
      }
      await db.run("UPDATE users SET role='owner' WHERE id=?", [req.user.id]);
      await setSetting(db, 'admin_setup_token', crypto.randomBytes(16).toString('hex'));
      await audit(db, req.user, 'auth.claim_owner_ok', req.user.email);
      res.json({ user: await publicUser(db, await getUser(db, req.user.id)) });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Login com Google / Conectar canal do YouTube (OAuth 2.0) ----------
  // GET /api/auth/google            -> login (escopos básicos)
  // GET /api/auth/google?connect=1  -> conectar canal (escopos do YouTube), exige login
  app.get('/api/auth/google', async (req, res) => {
    if (!googleConfigured()) {
      return res
        .status(409)
        .json({ error: 'Login com Google ainda não configurado neste servidor (faltam GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET).' });
    }
    const connect = req.query.connect === '1';
    const force = req.query.force === '1';
    const stateObj = { s: crypto.randomBytes(12).toString('hex'), connect, forced: force };
    res.cookie('tc_oauth_state', stateObj.s, { httpOnly: true, sameSite: 'lax', maxAge: 600000, path: '/' });
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
    u.searchParams.set('redirect_uri', `${baseUrl()}/api/auth/google/callback`);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', (connect ? [...BASIC_SCOPES, ...YT_SCOPES] : BASIC_SCOPES).join(' '));
    u.searchParams.set('state', Buffer.from(JSON.stringify(stateObj)).toString('base64url'));
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('include_granted_scopes', 'true');
    // prompt=consent garante o refresh_token (necessário para o acesso continuar após 1 hora)
    if (connect || force) u.searchParams.set('prompt', 'consent');
    else u.searchParams.set('prompt', 'select_account');
    res.redirect(u.toString());
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    try {
      if (!googleConfigured()) throw new HttpError(409, 'Login com Google não configurado.');
      const { code, state, error } = req.query;
      if (error) throw new HttpError(400, 'Google recusou: ' + String(error));
      let st = {};
      try { st = JSON.parse(Buffer.from(String(state || ''), 'base64url').toString()); } catch {}
      if (!code || !st.s || st.s !== req.cookies?.tc_oauth_state) {
        throw new HttpError(400, 'Fluxo de login inválido. Tente de novo.');
      }
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(code),
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${baseUrl()}/api/auth/google/callback`,
          grant_type: 'authorization_code'
        })
      });
      const tok = await tokenResp.json();
      if (!tokenResp.ok) throw new HttpError(502, 'Falha ao validar login com o Google.');
      const infoResp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tok.access_token}` }
      });
      const info = await infoResp.json();
      if (!infoResp.ok || !info.email || info.email_verified !== true) {
        throw new HttpError(403, 'Não foi possível confirmar seu e-mail no Google.');
      }
      const email = String(info.email).toLowerCase();
      let user = await db.get('SELECT * FROM users WHERE email=?', [email]);
      if (!user) {
        user = await createUser(db, { email, name: info.name || '', googleSub: info.sub || null });
        await audit(db, user, 'auth.register_google', email);
      } else if (!user.google_sub && info.sub) {
        await db.run('UPDATE users SET google_sub=? WHERE id=?', [info.sub, user.id]);
      }
      // E-mail do administrador principal VERIFICADO pelo Google => owner, com segurança
      user = await grantOwnerIfVerified(db, user, email, 'e-mail verificado pelo Google');

      // Escopos do YouTube concedidos? Guarda tokens e identifica o canal.
      const scopes = String(tok.scope || '');
      if (scopes.includes('youtube')) {
        let channel = null;
        try {
          const chResp = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
            headers: { Authorization: `Bearer ${tok.access_token}` }
          });
          const ch = await chResp.json();
          channel = ch.items?.[0] || null;
        } catch {}
        const prev = await db.get('SELECT refresh_token FROM yt_tokens WHERE user_id=?', [user.id]);
        const refresh = tok.refresh_token || prev?.refresh_token || null;
        if (!refresh && !st.forced) {
          // Sem refresh_token (o Google só envia no primeiro consentimento): pede de novo, uma vez.
          return res.redirect(`/api/auth/google?force=1${st.connect ? '&connect=1' : ''}`);
        }
        await db.run(
          `INSERT INTO yt_tokens(user_id,access_token,refresh_token,expires_at,channel_id,channel_title,scopes,updated_at)
           VALUES(?,?,?,?,?,?,?,?)
           ON CONFLICT(user_id) DO UPDATE SET access_token=EXCLUDED.access_token, refresh_token=COALESCE(EXCLUDED.refresh_token, yt_tokens.refresh_token),
             expires_at=EXCLUDED.expires_at, channel_id=COALESCE(EXCLUDED.channel_id, yt_tokens.channel_id),
             channel_title=COALESCE(EXCLUDED.channel_title, yt_tokens.channel_title), scopes=EXCLUDED.scopes, updated_at=EXCLUDED.updated_at`,
          [user.id, tok.access_token, refresh, Date.now() + (tok.expires_in || 3600) * 1000 - 60000, channel?.id || null, channel?.snippet?.title || null, scopes, now()]
        );
        if (isManageScope(scopes)) await audit(db, user, 'youtube.connected', channel?.snippet?.title || email);
      }
      res.cookie(COOKIE, await signToken(db, user.id), cookieOpts());
      res.redirect(st.connect ? '/#/canal' : '/#/dashboard');
    } catch (e) {
      res.redirect('/#/login?erro=' + encodeURIComponent(e.message || 'Falha no login com Google'));
    }
  });

  app.post('/api/auth/youtube/disconnect', auth.required, async (req, res) => {
    const row = await db.get('SELECT refresh_token, access_token FROM yt_tokens WHERE user_id=?', [req.user.id]);
    const tk = row?.refresh_token || row?.access_token;
    if (tk) {
      try {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: tk })
        });
      } catch { /* melhor esforço */ }
    }
    await db.run('DELETE FROM yt_tokens WHERE user_id=?', [req.user.id]);
    await audit(db, req.user, 'youtube.disconnected', req.user.email);
    res.json({ ok: true, relogin: true });
  });
}

/** Access token válido do YouTube para o usuário (renova com refresh_token se preciso). */
export async function youtubeAccessToken(db, user) {
  const row = await db.get('SELECT * FROM yt_tokens WHERE user_id=?', [user.id]);
  if (!row) {
    throw new HttpError(409, 'Entre com o Google para usar as ferramentas do YouTube (ou use "Conectar meu canal" para gerenciar seu canal).');
  }
  if (row.access_token && Number(row.expires_at) > Date.now()) return row.access_token;
  if (!row.refresh_token) {
    throw new HttpError(409, 'Sua sessão com o Google expirou. Saia e entre com o Google novamente.');
  }
  if (!googleConfigured()) throw new HttpError(409, 'Login com Google não configurado neste servidor.');
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: row.refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token'
    })
  });
  const tok = await resp.json();
  if (!resp.ok || !tok.access_token) {
    await db.run('DELETE FROM yt_tokens WHERE user_id=?', [user.id]);
    throw new HttpError(409, 'A autorização do YouTube expirou ou foi revogada. Conecte seu canal novamente.');
  }
  await db.run('UPDATE yt_tokens SET access_token=?, expires_at=?, updated_at=? WHERE user_id=?', [
    tok.access_token,
    Date.now() + (tok.expires_in || 3600) * 1000 - 60000,
    now(),
    user.id
  ]);
  return tok.access_token;
}
