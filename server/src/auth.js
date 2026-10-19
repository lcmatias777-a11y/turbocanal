import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';
import { HttpError, audit, isEmail, must, now, uid, ym } from './util.js';
import { ensureRefill, getUser } from './credits.js';

const COOKIE = 'tc_token';

function secret(db) {
  return getSetting(db, 'jwt_secret');
}

export function signToken(db, userId, days = 30) {
  return jwt.sign({ uid: userId }, secret(db), { expiresIn: `${days}d` });
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

export function publicUser(db, user) {
  if (!user) return null;
  const plan = db.prepare('SELECT id,name,price_cents,monthly_credits FROM plans WHERE id=?').get(user.plan_id);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    plan_id: user.plan_id,
    plan,
    credits: user.credits,
    unlimited: user.role === 'owner',
    created_at: user.created_at
  };
}

export function makeAuth(db) {
  function readToken(req) {
    const h = req.get('Authorization');
    if (h && h.startsWith('Bearer ')) return h.slice(7);
    return req.cookies?.[COOKIE] || null;
  }

  const required = (req, res, next) => {
    try {
      const tk = readToken(req);
      if (!tk) throw new HttpError(401, 'Faça login para continuar.');
      let payload;
      try {
        payload = jwt.verify(tk, secret(db));
      } catch {
        throw new HttpError(401, 'Sessão inválida ou expirada. Entre novamente.');
      }
      // Papel e saldo sempre lidos do banco (nunca confiar no que o navegador manda)
      const user = getUser(db, payload.uid);
      if (!user) throw new HttpError(401, 'Conta não encontrada. Entre novamente.');
      req.user = ensureRefill(db, user);
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

  return {
    required,
    admin: [required, requireRole('owner', 'admin')],
    owner: [required, requireRole('owner')]
  };
}

function createUser(db, { email, passHash = null, name = '', googleSub = null }) {
  const free = db.prepare('SELECT * FROM plans WHERE id=?').get('free');
  const id = uid();
  const run = db.transaction(() => {
    db.prepare(
      'INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,last_refill,google_sub,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
    ).run(id, email, passHash, name, 'user', 'free', free.monthly_credits, ym(), googleSub, now());
    db.prepare(
      'INSERT INTO transactions(id,user_id,delta,balance_after,tool,note,idem_key,created_at) VALUES(?,?,?,?,?,?,?,?)'
    ).run(uid(), id, free.monthly_credits, free.monthly_credits, null, 'Créditos iniciais do plano Free', null, now());
  });
  run();
  return getUser(db, id);
}

export function authRoutes(app, db, auth) {
  app.post('/api/auth/register', (req, res, next) => {
    try {
      const email = must(req.body?.email, 'e-mail', { max: 190 }).toLowerCase();
      const password = must(req.body?.password, 'senha', { max: 200 });
      const name = String(req.body?.name || '').trim().slice(0, 120);
      if (!isEmail(email)) throw new HttpError(400, 'E-mail inválido.');
      if (password.length < 8) throw new HttpError(400, 'A senha precisa ter pelo menos 8 caracteres.');
      const exists = db.prepare('SELECT 1 FROM users WHERE email=?').get(email);
      if (exists) throw new HttpError(409, 'Já existe uma conta com esse e-mail. Faça login.');
      const user = createUser(db, { email, passHash: bcrypt.hashSync(password, 10), name });
      audit(db, user, 'auth.register', email);
      const token = signToken(db, user.id);
      res.cookie(COOKIE, token, cookieOpts());
      res.json({ user: publicUser(db, user), token });
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/auth/login', (req, res, next) => {
    try {
      const email = must(req.body?.email, 'e-mail', { max: 190 }).toLowerCase();
      const password = must(req.body?.password, 'senha', { max: 200 });
      const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      if (!user || !user.pass_hash || !bcrypt.compareSync(password, user.pass_hash)) {
        throw new HttpError(401, 'E-mail ou senha incorretos.');
      }
      const token = signToken(db, user.id);
      res.cookie(COOKIE, token, cookieOpts());
      res.json({ user: publicUser(db, ensureRefill(db, user)), token });
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/me', auth.required, (req, res) => {
    res.json({ user: publicUser(db, req.user) });
  });

  app.post('/api/me/password', auth.required, (req, res, next) => {
    try {
      const current = must(req.body?.current, 'senha atual', { max: 200 });
      const nextPwd = must(req.body?.next, 'nova senha', { max: 200 });
      if (nextPwd.length < 8) throw new HttpError(400, 'A nova senha precisa ter pelo menos 8 caracteres.');
      if (!req.user.pass_hash || !bcrypt.compareSync(current, req.user.pass_hash)) {
        throw new HttpError(401, 'Senha atual incorreta.');
      }
      db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(bcrypt.hashSync(nextPwd, 10), req.user.id);
      audit(db, req.user, 'auth.password_change', req.user.email);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // Token para usar na extensão do Chrome (Bearer). Mesmo usuário, mesmo saldo.
  app.get('/api/auth/token', auth.required, (req, res) => {
    res.json({ token: signToken(db, req.user.id), aviso: 'Guarde este token como uma senha. Ele dá acesso à sua conta.' });
  });

  /**
   * Reivindicação do administrador principal (owner).
   * Segurança: o e-mail enviado pelo navegador NÃO basta. É preciso:
   *  (a) estar logado numa conta cujo e-mail é o owner_email configurado; E
   *  (b) informar o token de setup impresso no console do servidor (uso único).
   * Alternativa: login com Google com o e-mail verificado do owner (rota abaixo).
   */
  app.post('/api/auth/claim-owner', auth.required, (req, res, next) => {
    try {
      const token = must(req.body?.token, 'token de setup', { max: 200 });
      const ownerEmail = (getSetting(db, 'owner_email') || '').toLowerCase();
      const stored = getSetting(db, 'admin_setup_token');
      if (req.user.email.toLowerCase() !== ownerEmail) {
        throw new HttpError(403, 'Esta conta não é o e-mail do administrador principal configurado no servidor.');
      }
      if (!stored || token !== stored) {
        audit(db, req.user, 'auth.claim_owner_fail', req.user.email, 'token incorreto');
        throw new HttpError(403, 'Token de setup incorreto. Ele é impresso no console do servidor na primeira execução.');
      }
      db.prepare("UPDATE users SET role='owner' WHERE id=?").run(req.user.id);
      setSetting(db, 'admin_setup_token', crypto.randomBytes(16).toString('hex')); // rotaciona: uso único
      audit(db, req.user, 'auth.claim_owner_ok', req.user.email);
      res.json({ user: publicUser(db, getUser(db, req.user.id)) });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Login com Google (opcional; só funciona com credenciais configuradas) ----------
  const gid = process.env.GOOGLE_CLIENT_ID;
  const gsecret = process.env.GOOGLE_CLIENT_SECRET;
  const baseUrl = (process.env.BASE_URL || 'http://localhost:8787').replace(/\/$/, '');

  app.get('/api/auth/google', (req, res) => {
    if (!gid || !gsecret) {
      return res
        .status(409)
        .json({ error: 'Login com Google ainda não configurado (defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET).' });
    }
    const state = crypto.randomBytes(12).toString('hex');
    res.cookie('tc_oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 600000, path: '/' });
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', gid);
    u.searchParams.set('redirect_uri', `${baseUrl}/api/auth/google/callback`);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid email profile');
    u.searchParams.set('state', state);
    res.redirect(u.toString());
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    try {
      if (!gid || !gsecret) throw new HttpError(409, 'Login com Google não configurado.');
      const { code, state } = req.query;
      if (!code || !state || state !== req.cookies?.tc_oauth_state) {
        throw new HttpError(400, 'Fluxo de login inválido. Tente de novo.');
      }
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(code),
          client_id: gid,
          client_secret: gsecret,
          redirect_uri: `${baseUrl}/api/auth/google/callback`,
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
      let user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      if (!user) {
        user = createUser(db, { email, name: info.name || '', googleSub: info.sub || null });
        audit(db, user, 'auth.register_google', email);
      } else if (!user.google_sub && info.sub) {
        db.prepare('UPDATE users SET google_sub=? WHERE id=?').run(info.sub, user.id);
      }
      // E-mail do owner VERIFICADO pelo Google => concede owner com segurança
      const ownerEmail = (getSetting(db, 'owner_email') || '').toLowerCase();
      if (email === ownerEmail && user.role !== 'owner') {
        db.prepare("UPDATE users SET role='owner' WHERE id=?").run(user.id);
        audit(db, user, 'auth.claim_owner_google', email, 'e-mail verificado pelo Google');
        user = getUser(db, user.id);
      }
      res.cookie(COOKIE, signToken(db, user.id), cookieOpts());
      res.redirect('/#/dashboard');
    } catch (e) {
      res.redirect('/#/login?erro=' + encodeURIComponent(e.message || 'Falha no login com Google'));
    }
  });
}
