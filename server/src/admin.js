import { getSetting, setSetting } from './db.js';
import { HttpError, audit, isEmail, must } from './util.js';
import { grant } from './credits.js';
import { activatePayment, providerReady } from './payments.js';

const SETTING_KEYS = [
  'site_name',
  'free_monthly_topup',
  'yt_api_key',
  'mp_access_token',
  'payments_enabled',
  'pix_key_value',
  'pix_key_type',
  'pix_key_confirmed'
];
const SECRET_KEYS = new Set(['yt_api_key', 'mp_access_token']);
const PIX_TYPES = new Set(['phone', 'cpf', 'cnpj', 'email', 'random']);

function maskSecret(v) {
  if (!v) return '';
  return v.length <= 6 ? '•••' : v.slice(0, 3) + '•••' + v.slice(-3);
}

export function adminRoutes(app, db, auth) {
  // ---------- Visão geral ----------
  app.get('/api/admin/overview', ...auth.admin, (req, res) => {
    const users = db.prepare('SELECT COUNT(*) n FROM users').get().n;
    const byPlan = db.prepare('SELECT plan_id, COUNT(*) n FROM users GROUP BY plan_id').all();
    const byRole = db.prepare('SELECT role, COUNT(*) n FROM users GROUP BY role').all();
    const spent30d = db
      .prepare("SELECT COALESCE(SUM(-delta),0) s FROM transactions WHERE delta<0 AND created_at >= datetime('now','-30 days')")
      .get().s;
    const usage30d = db
      .prepare("SELECT tool, COUNT(*) n FROM transactions WHERE tool IS NOT NULL AND created_at >= datetime('now','-30 days') GROUP BY tool ORDER BY n DESC")
      .all();
    const paid = db.prepare("SELECT COALESCE(SUM(amount_cents),0) s, COUNT(*) n FROM payments WHERE status='approved'").get();
    res.json({
      users,
      byPlan,
      byRole,
      creditsSpent30d: spent30d,
      usage30d,
      payments: { approvedCount: paid.n, approvedTotalCents: paid.s },
      config: {
        youtubeApiConfigured: !!(getSetting(db, 'yt_api_key') || process.env.YT_API_KEY),
        paymentProviderConfigured: providerReady(db),
        paymentsEnabled: getSetting(db, 'payments_enabled') === '1',
        pixKeyConfirmed: getSetting(db, 'pix_key_confirmed') === '1'
      }
    });
  });

  // ---------- Usuários ----------
  app.get('/api/admin/users', ...auth.admin, (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const rows = q
      ? db.prepare('SELECT id,email,name,role,plan_id,credits,created_at FROM users WHERE lower(email) LIKE ? OR lower(name) LIKE ? ORDER BY created_at DESC LIMIT 100').all(`%${q}%`, `%${q}%`)
      : db.prepare('SELECT id,email,name,role,plan_id,credits,created_at FROM users ORDER BY created_at DESC LIMIT 100').all();
    res.json({ items: rows });
  });

  app.post('/api/admin/users/:id/credits', ...auth.admin, (req, res, next) => {
    try {
      const delta = parseInt(req.body?.delta, 10);
      if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000000) {
        throw new HttpError(400, 'Informe um ajuste de créditos válido (inteiro diferente de zero).');
      }
      const note = String(req.body?.note || '').slice(0, 200) || 'Ajuste manual pelo administrador';
      const bal = grant(db, req.params.id, delta, note);
      audit(db, req.user, 'admin.credits_adjust', req.params.id, `${delta >= 0 ? '+' : ''}${delta} (${note})`);
      res.json({ ok: true, balance: bal });
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/admin/users/:id/plan', ...auth.admin, (req, res, next) => {
    try {
      const planId = must(req.body?.plan_id, 'plano', { max: 40 });
      const plan = db.prepare('SELECT id FROM plans WHERE id=?').get(planId);
      if (!plan) throw new HttpError(404, 'Plano não encontrado.');
      const target = db.prepare('SELECT id,email FROM users WHERE id=?').get(req.params.id);
      if (!target) throw new HttpError(404, 'Usuário não encontrado.');
      db.prepare('UPDATE users SET plan_id=? WHERE id=?').run(planId, target.id);
      audit(db, req.user, 'admin.user_plan_set', target.email, planId);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Planos ----------
  app.get('/api/admin/plans', ...auth.admin, (req, res) => {
    res.json({ items: db.prepare('SELECT * FROM plans ORDER BY sort').all() });
  });

  app.post('/api/admin/plans', ...auth.admin, (req, res, next) => {
    try {
      const id = must(req.body?.id, 'id do plano', { max: 30 }).toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!id) throw new HttpError(400, 'ID de plano inválido.');
      if (db.prepare('SELECT 1 FROM plans WHERE id=?').get(id)) throw new HttpError(409, 'Já existe um plano com esse ID.');
      const name = must(req.body?.name, 'nome do plano', { max: 60 });
      const price = parseInt(req.body?.price_cents, 10);
      const credits = parseInt(req.body?.monthly_credits, 10);
      if (!Number.isInteger(price) || price < 0) throw new HttpError(400, 'Preço inválido.');
      if (!Number.isInteger(credits) || credits <= 0) throw new HttpError(400, 'Créditos mensais inválidos.');
      db.prepare('INSERT INTO plans(id,name,price_cents,monthly_credits,sort,active,description) VALUES(?,?,?,?,?,?,?)')
        .run(id, name, price, credits, parseInt(req.body?.sort, 10) || 99, 1, String(req.body?.description || '').slice(0, 400));
      audit(db, req.user, 'admin.plan_create', id, `${name} R$${(price / 100).toFixed(2)} ${credits}cr`);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  app.put('/api/admin/plans/:id', ...auth.admin, (req, res, next) => {
    try {
      const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(req.params.id);
      if (!plan) throw new HttpError(404, 'Plano não encontrado.');
      const name = req.body?.name !== undefined ? must(req.body.name, 'nome', { max: 60 }) : plan.name;
      const price = req.body?.price_cents !== undefined ? parseInt(req.body.price_cents, 10) : plan.price_cents;
      const credits = req.body?.monthly_credits !== undefined ? parseInt(req.body.monthly_credits, 10) : plan.monthly_credits;
      const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : plan.active;
      const sort = req.body?.sort !== undefined ? parseInt(req.body.sort, 10) || 0 : plan.sort;
      const description = req.body?.description !== undefined ? String(req.body.description).slice(0, 400) : plan.description;
      if (!Number.isInteger(price) || price < 0) throw new HttpError(400, 'Preço inválido.');
      if (!Number.isInteger(credits) || credits <= 0) throw new HttpError(400, 'Créditos mensais inválidos.');
      if (plan.id === 'free' && price > 0) throw new HttpError(400, 'O plano Free precisa continuar com preço zero.');
      db.prepare('UPDATE plans SET name=?,price_cents=?,monthly_credits=?,active=?,sort=?,description=? WHERE id=?')
        .run(name, price, credits, active, sort, description, plan.id);
      audit(db, req.user, 'admin.plan_update', plan.id, `R$${(price / 100).toFixed(2)} ${credits}cr ativo=${active}`);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Custos das ferramentas ----------
  app.put('/api/admin/tools/:tool', ...auth.admin, (req, res, next) => {
    try {
      const row = db.prepare('SELECT * FROM tool_costs WHERE tool=?').get(req.params.tool);
      if (!row) throw new HttpError(404, 'Ferramenta não encontrada.');
      const cost = parseInt(req.body?.cost, 10);
      if (!Number.isInteger(cost) || cost < 0 || cost > 100000) throw new HttpError(400, 'Custo inválido.');
      db.prepare('UPDATE tool_costs SET cost=? WHERE tool=?').run(cost, row.tool);
      audit(db, req.user, 'admin.tool_cost', row.tool, String(cost));
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Pagamentos ----------
  app.get('/api/admin/payments', ...auth.admin, (req, res) => {
    const rows = db
      .prepare('SELECT p.*, u.email FROM payments p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 200')
      .all()
      .map((p) => ({ ...p, raw: undefined }));
    res.json({ items: rows });
  });

  // Confirmação MANUAL por um administrador (auditada). Use só depois de conferir
  // o recebimento de verdade; não é uma confirmação automática falsa.
  app.post('/api/admin/payments/:id/confirm', ...auth.admin, (req, res, next) => {
    try {
      const p = db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id);
      if (!p) throw new HttpError(404, 'Pagamento não encontrado.');
      if (p.status === 'approved') return res.json({ ok: true, ja_aprovado: true });
      const note = String(req.body?.note || '').slice(0, 300);
      if (!note) throw new HttpError(400, 'Descreva como você conferiu o recebimento (ex.: comprovante Pix, extrato).');
      const updated = activatePayment(db, p, req.user, `confirmação manual do administrador: ${note}`);
      res.json({ ok: true, status: updated.status });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Configurações ----------
  app.get('/api/admin/settings', ...auth.admin, (req, res) => {
    const out = {};
    for (const k of SETTING_KEYS) {
      const v = getSetting(db, k) || '';
      out[k] = SECRET_KEYS.has(k) ? { set: !!v, masked: maskSecret(v) } : v;
    }
    out.owner_email = getSetting(db, 'owner_email');
    out.base_url = process.env.BASE_URL || 'http://localhost:8787';
    out.webhook_url = (process.env.BASE_URL || 'http://localhost:8787').replace(/\/$/, '') + '/api/payments/webhook';
    res.json({ settings: out });
  });

  app.put('/api/admin/settings', ...auth.admin, (req, res, next) => {
    try {
      const updates = req.body?.updates;
      if (!updates || typeof updates !== 'object') throw new HttpError(400, 'Nada para atualizar.');
      for (const [k, vRaw] of Object.entries(updates)) {
        if (!SETTING_KEYS.includes(k)) throw new HttpError(400, `Configuração desconhecida: ${k}`);
        const v = String(vRaw ?? '').trim();
        if (k === 'pix_key_type' && !PIX_TYPES.has(v)) {
          throw new HttpError(400, 'Tipo de chave Pix inválido (phone, cpf, cnpj, email ou random).');
        }
        if (k === 'free_monthly_topup') {
          const n = parseInt(v, 10);
          if (!Number.isInteger(n) || n < 0 || n > 100000000) throw new HttpError(400, 'Valor de recarga mensal inválido.');
        }
        if (k === 'payments_enabled' && v === '1') {
          if (!providerReady(db) && !String(updates.mp_access_token || '').trim()) {
            throw new HttpError(409, 'Para ativar pagamentos, configure antes o Access Token do Mercado Pago. Sem provedor, nenhuma cobrança real pode ser confirmada.');
          }
          if (getSetting(db, 'pix_key_confirmed') !== '1' && String(updates.pix_key_confirmed || '') !== '1') {
            throw new HttpError(409, 'Confirme antes o tipo da chave Pix de recebimento (o número informado no cadastro ainda não foi validado como chave Pix).');
          }
        }
      }
      for (const [k, vRaw] of Object.entries(updates)) {
        const v = String(vRaw ?? '').trim();
        if (SECRET_KEYS.has(k) && v === '') continue; // campo vazio não apaga segredo por engano
        setSetting(db, k, v);
        audit(db, req.user, 'admin.setting', k, SECRET_KEYS.has(k) ? '(valor atualizado)' : v);
      }
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Administradores (regras do administrador principal) ----------
  app.get('/api/admin/admins', ...auth.admin, (req, res) => {
    const rows = db.prepare("SELECT id,email,name,role,created_at FROM users WHERE role IN ('owner','admin') ORDER BY role DESC, created_at").all();
    res.json({ items: rows, voce: { id: req.user.id, role: req.user.role } });
  });

  // Somente o OWNER promove novos administradores.
  app.post('/api/admin/admins', ...auth.owner, (req, res, next) => {
    try {
      const email = must(req.body?.email, 'e-mail', { max: 190 }).toLowerCase();
      if (!isEmail(email)) throw new HttpError(400, 'E-mail inválido.');
      const target = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      if (!target) throw new HttpError(404, 'Não existe conta cadastrada com esse e-mail. A pessoa precisa criar a conta primeiro (conta autenticada).');
      if (target.role === 'owner') throw new HttpError(400, 'Essa conta já é o administrador principal.');
      if (target.role === 'admin') throw new HttpError(409, 'Essa conta já é administradora.');
      db.prepare("UPDATE users SET role='admin' WHERE id=?").run(target.id);
      audit(db, req.user, 'admin.promote', email);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // Somente o OWNER remove administradores; o OWNER nunca pode ser removido/rebaixado.
  app.delete('/api/admin/admins/:id', ...auth.owner, (req, res, next) => {
    try {
      const target = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
      if (!target) throw new HttpError(404, 'Usuário não encontrado.');
      if (target.role === 'owner') {
        throw new HttpError(403, 'O administrador principal não pode ser removido nem rebaixado.');
      }
      if (target.role !== 'admin') throw new HttpError(400, 'Essa conta não é administradora.');
      db.prepare("UPDATE users SET role='user' WHERE id=?").run(target.id);
      audit(db, req.user, 'admin.demote', target.email);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Auditoria ----------
  app.get('/api/admin/audit', ...auth.admin, (req, res) => {
    res.json({ items: db.prepare('SELECT * FROM audit ORDER BY created_at DESC LIMIT 300').all() });
  });
}
