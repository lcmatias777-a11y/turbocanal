import { getSetting, setSetting } from './db.js';
import { HttpError, audit, isEmail, must, now } from './util.js';
import { grant } from './credits.js';
import { activatePayment, providerReady } from './payments.js';
import { googleConfigured } from './auth.js';
import { testGemini } from './gemini.js';

const SETTING_KEYS = ['site_name', 'free_monthly_topup', 'yt_api_key', 'gemini_api_key', 'mp_access_token', 'payments_enabled', 'pix_key_value', 'pix_key_type', 'pix_key_confirmed'];
const SECRET_KEYS = new Set(['yt_api_key', 'gemini_api_key', 'mp_access_token']);
const PIX_TYPES = new Set(['phone', 'cpf', 'cnpj', 'email', 'random']);

function maskSecret(v) {
  if (!v) return '';
  return v.length <= 6 ? '•••' : v.slice(0, 3) + '•••' + v.slice(-3);
}
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

export function adminRoutes(app, db, auth) {
  const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };

  // ---------- Backup: baixar uma cópia do banco ----------
  // O Postgres gratuito do Render expira; isto garante que dá para recomeçar sem perder nada.
  const TABELAS_BACKUP = ['users', 'plans', 'tool_costs', 'transactions', 'payments', 'settings', 'audit',
    'ab_tests', 'competitors', 'reviews', 'site_comments', 'respostas', 'review_votes', 'review_reports', 'blocos'];
  // Segredos e tokens do YouTube ficam de fora: backup é para os DADOS, não para as chaves.
  const SEGREDO = /^(gemini_api_key|yt_api_key|mp_access_token|jwt_secret|admin_setup_token)$/;

  app.get('/api/admin/backup', ...auth.owner, wrap(async (req, res) => {
    const dump = { gerado_em: now(), banco: db.kind, versao: 1, tabelas: {} };
    for (const t of TABELAS_BACKUP) {
      try {
        let linhas = await db.all(`SELECT * FROM ${t}`);
        if (t === 'users') linhas = linhas.map((u) => ({ ...u, pass_hash: u.pass_hash ? '(removido do backup)' : null }));
        if (t === 'settings') linhas = linhas.filter((r) => !SEGREDO.test(r.key));
        dump.tabelas[t] = linhas;
      } catch { dump.tabelas[t] = []; }
    }
    dump.resumo = Object.fromEntries(Object.entries(dump.tabelas).map(([t, l]) => [t, l.length]));
    await audit(db, req.user, 'admin.backup', 'banco', `${Object.values(dump.resumo).reduce((a, b) => a + b, 0)} linhas`);
    res.setHeader('Content-Disposition', `attachment; filename="turbocanal-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(dump, null, 2));
  }));

  app.get('/api/admin/backup/resumo', ...auth.admin, wrap(async (req, res) => {
    const resumo = {};
    for (const t of TABELAS_BACKUP) {
      try { resumo[t] = Number((await db.get(`SELECT COUNT(*) AS n FROM ${t}`)).n) || 0; } catch { resumo[t] = 0; }
    }
    const ultimo = await db.get("SELECT created_at FROM audit WHERE action='admin.backup' ORDER BY created_at DESC LIMIT 1");
    res.json({ resumo, total: Object.values(resumo).reduce((a, b) => a + b, 0), ultimo_backup: ultimo?.created_at || null });
  }));

  // Estado honesto de cada integração: o que já funciona e o que ainda falta.
  // NUNCA devolve o valor de chave nenhuma — só se está preenchida ou não.
  app.get('/api/admin/checklist', ...auth.admin, wrap(async (req, res) => {
    const temYt = !!((await getSetting(db, 'yt_api_key')) || process.env.YT_API_KEY);
    const temIA = !!((await getSetting(db, 'gemini_api_key')) || process.env.GEMINI_API_KEY);
    const temMp = !!(await getSetting(db, 'mp_access_token'));
    const pixOk = (await getSetting(db, 'pix_key_confirmed')) === '1';
    const pagLigado = (await getSetting(db, 'payments_enabled')) === '1';
    const ultimoBackup = (await db.get("SELECT created_at FROM audit WHERE action='admin.backup' ORDER BY created_at DESC LIMIT 1"))?.created_at || null;
    const diasBackup = ultimoBackup ? Math.floor((Date.now() - new Date(ultimoBackup).getTime()) / 86400e3) : null;
    const canaisLigados = (await db.get('SELECT COUNT(*)::int AS n FROM yt_tokens')).n;

    const itens = [
      { chave: 'banco', titulo: 'Banco de dados', ok: db.kind === 'postgres', critico: true,
        estado: db.kind === 'postgres' ? 'Postgres (os dados ficam salvos)' : `${db.kind} — os dados somem a cada deploy`,
        resolver: db.kind === 'postgres' ? '' : 'Crie um Postgres no Render e ligue a variável DATABASE_URL no serviço.' },
      { chave: 'login', titulo: 'Entrar com o Google', ok: googleConfigured(), critico: true,
        estado: googleConfigured() ? 'configurado' : 'falta o client ID/secret do Google',
        resolver: googleConfigured() ? '' : 'Preencha GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET nas variáveis do servidor.' },
      { chave: 'youtube', titulo: 'Chave da API do YouTube', ok: temYt, critico: true,
        estado: temYt ? `preenchida · ${canaisLigados} canal(is) vinculado(s) por OAuth` : 'não preenchida: busca, tendências e análises não funcionam',
        resolver: temYt ? '' : 'Cole a chave em Admin → Configurações → Chave da API do YouTube.' },
      { chave: 'ia', titulo: 'IA (Gemini)', ok: temIA, critico: false,
        estado: temIA ? 'preenchida' : 'não preenchida: as ferramentas de IA avisam e NÃO cobram créditos',
        resolver: temIA ? '' : 'Cole a chave em Admin → Configurações → Chave do Gemini.' },
      { chave: 'mercadopago', titulo: 'Mercado Pago (Pix)', ok: temMp, critico: false,
        estado: temMp ? 'token preenchido' : 'sem token: ninguém consegue pagar',
        resolver: temMp ? '' : 'Cole o Access Token de produção em Admin → Configurações. Nunca cole aqui no chat.' },
      { chave: 'pix', titulo: 'Chave Pix conferida por você', ok: pixOk, critico: false,
        estado: pixOk ? 'conferida' : 'ainda NÃO conferida — nenhum Pix é gerado até você confirmar que a chave é sua',
        resolver: pixOk ? '' : 'Abra Admin → Configurações, confira a chave Pix e marque que ela é sua.' },
      { chave: 'pagamentos', titulo: 'Pagamentos ligados', ok: pagLigado && temMp && pixOk, critico: false,
        estado: pagLigado && temMp && pixOk ? 'ligados' : 'desligados: os planos pagos aparecem, mas não dá para comprar',
        resolver: pagLigado && temMp && pixOk ? '' : 'Depende do token do Mercado Pago e da chave Pix conferida; depois ligue em Admin → Configurações.' },
      { chave: 'backup', titulo: 'Backup do banco', ok: diasBackup !== null && diasBackup <= 30, critico: false,
        estado: ultimoBackup ? `último há ${diasBackup} dia(s)` : 'nunca foi feito',
        resolver: diasBackup !== null && diasBackup <= 30 ? '' : 'Baixe um backup em Admin → Banco de dados. Guarde o arquivo fora do Render.' }
    ];
    const faltando = itens.filter((i) => !i.ok);
    res.json({
      itens,
      prontos: itens.length - faltando.length,
      total: itens.length,
      faltando: faltando.length,
      bloqueios: faltando.filter((i) => i.critico).map((i) => i.titulo)
    });
  }));

  app.get('/api/admin/overview', ...auth.admin, wrap(async (req, res) => {
    const users = (await db.get('SELECT COUNT(*)::int AS n FROM users')).n;
    const byPlan = await db.all('SELECT plan_id, COUNT(*)::int AS n FROM users GROUP BY plan_id');
    const byRole = await db.all('SELECT role, COUNT(*)::int AS n FROM users GROUP BY role');
    const spent30d = (await db.get('SELECT COALESCE(SUM(-delta),0)::int AS s FROM transactions WHERE delta<0 AND created_at >= ?', [daysAgo(30)])).s;
    const usage30d = await db.all('SELECT tool, COUNT(*)::int AS n FROM transactions WHERE tool IS NOT NULL AND created_at >= ? GROUP BY tool ORDER BY n DESC', [daysAgo(30)]);
    const paid = await db.get("SELECT COALESCE(SUM(amount_cents),0)::int AS s, COUNT(*)::int AS n FROM payments WHERE status='approved'");
    const ytUnitsToday = parseInt((await getSetting(db, 'yt_units_' + new Date().toISOString().slice(0, 10))) || '0', 10);
    res.json({
      users, byPlan, byRole, creditsSpent30d: spent30d, usage30d,
      youtubeQuota: { usedToday: ytUnitsToday, dailyLimit: 10000 },
      payments: { approvedCount: paid.n, approvedTotalCents: paid.s },
      config: {
        youtubeApiConfigured: !!((await getSetting(db, 'yt_api_key')) || process.env.YT_API_KEY),
        geminiConfigured: !!((await getSetting(db, 'gemini_api_key')) || process.env.GEMINI_API_KEY),
        googleLoginConfigured: googleConfigured(),
        paymentProviderConfigured: await providerReady(db),
        paymentsEnabled: (await getSetting(db, 'payments_enabled')) === '1',
        pixKeyConfirmed: (await getSetting(db, 'pix_key_confirmed')) === '1',
        database: db.kind
      }
    });
  }));

  app.get('/api/admin/users', ...auth.admin, wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const rows = q
      ? await db.all('SELECT id,email,name,role,plan_id,credits,created_at FROM users WHERE lower(email) LIKE ? OR lower(name) LIKE ? ORDER BY created_at DESC LIMIT 100', [`%${q}%`, `%${q}%`])
      : await db.all('SELECT id,email,name,role,plan_id,credits,created_at FROM users ORDER BY created_at DESC LIMIT 100');
    res.json({ items: rows });
  }));

  app.post('/api/admin/users/:id/credits', ...auth.admin, wrap(async (req, res) => {
    const delta = parseInt(req.body?.delta, 10);
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000000) throw new HttpError(400, 'Informe um ajuste de créditos válido (inteiro diferente de zero).');
    const note = String(req.body?.note || '').slice(0, 200) || 'Ajuste manual pelo administrador';
    const bal = await grant(db, req.params.id, delta, note);
    await audit(db, req.user, 'admin.credits_adjust', req.params.id, `${delta >= 0 ? '+' : ''}${delta} (${note})`);
    res.json({ ok: true, balance: bal });
  }));

  app.post('/api/admin/users/:id/plan', ...auth.admin, wrap(async (req, res) => {
    const planId = must(req.body?.plan_id, 'plano', { max: 40 });
    if (!(await db.get('SELECT id FROM plans WHERE id=?', [planId]))) throw new HttpError(404, 'Plano não encontrado.');
    const target = await db.get('SELECT id,email FROM users WHERE id=?', [req.params.id]);
    if (!target) throw new HttpError(404, 'Usuário não encontrado.');
    await db.run('UPDATE users SET plan_id=? WHERE id=?', [planId, target.id]);
    await audit(db, req.user, 'admin.user_plan_set', target.email, planId);
    res.json({ ok: true });
  }));

  app.get('/api/admin/plans', ...auth.admin, wrap(async (req, res) => {
    res.json({ items: await db.all('SELECT * FROM plans ORDER BY sort') });
  }));

  app.post('/api/admin/plans', ...auth.admin, wrap(async (req, res) => {
    const id = must(req.body?.id, 'id do plano', { max: 30 }).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!id) throw new HttpError(400, 'ID de plano inválido.');
    if (await db.get('SELECT 1 AS x FROM plans WHERE id=?', [id])) throw new HttpError(409, 'Já existe um plano com esse ID.');
    const name = must(req.body?.name, 'nome do plano', { max: 60 });
    const price = parseInt(req.body?.price_cents, 10);
    const credits = parseInt(req.body?.monthly_credits, 10);
    if (!Number.isInteger(price) || price < 0) throw new HttpError(400, 'Preço inválido.');
    if (!Number.isInteger(credits) || credits <= 0) throw new HttpError(400, 'Créditos mensais inválidos.');
    await db.run('INSERT INTO plans(id,name,price_cents,monthly_credits,sort,active,description) VALUES(?,?,?,?,?,?,?)', [id, name, price, credits, parseInt(req.body?.sort, 10) || 99, 1, String(req.body?.description || '').slice(0, 400)]);
    await audit(db, req.user, 'admin.plan_create', id, `${name} R$${(price / 100).toFixed(2)} ${credits}cr`);
    res.json({ ok: true });
  }));

  app.put('/api/admin/plans/:id', ...auth.admin, wrap(async (req, res) => {
    const plan = await db.get('SELECT * FROM plans WHERE id=?', [req.params.id]);
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
    await db.run('UPDATE plans SET name=?,price_cents=?,monthly_credits=?,active=?,sort=?,description=? WHERE id=?', [name, price, credits, active, sort, description, plan.id]);
    await audit(db, req.user, 'admin.plan_update', plan.id, `R$${(price / 100).toFixed(2)} ${credits}cr ativo=${active}`);
    res.json({ ok: true });
  }));

  app.put('/api/admin/tools/:tool', ...auth.admin, wrap(async (req, res) => {
    const row = await db.get('SELECT * FROM tool_costs WHERE tool=?', [req.params.tool]);
    if (!row) throw new HttpError(404, 'Ferramenta não encontrada.');
    const cost = parseInt(req.body?.cost, 10);
    if (!Number.isInteger(cost) || cost < 0 || cost > 100000) throw new HttpError(400, 'Custo inválido.');
    await db.run('UPDATE tool_costs SET cost=? WHERE tool=?', [cost, row.tool]);
    await audit(db, req.user, 'admin.tool_cost', row.tool, String(cost));
    res.json({ ok: true });
  }));

  app.get('/api/admin/payments', ...auth.admin, wrap(async (req, res) => {
    const rows = (await db.all('SELECT p.*, u.email FROM payments p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 200')).map((p) => ({ ...p, raw: undefined }));
    res.json({ items: rows });
  }));

  // Confirmação MANUAL auditada (só depois de conferir o recebimento de verdade)
  app.post('/api/admin/payments/:id/confirm', ...auth.admin, wrap(async (req, res) => {
    const p = await db.get('SELECT * FROM payments WHERE id=?', [req.params.id]);
    if (!p) throw new HttpError(404, 'Pagamento não encontrado.');
    if (p.status === 'approved') return res.json({ ok: true, ja_aprovado: true });
    const note = String(req.body?.note || '').slice(0, 300);
    if (!note) throw new HttpError(400, 'Descreva como você conferiu o recebimento (ex.: comprovante Pix, extrato).');
    const updated = await activatePayment(db, p, req.user, `confirmação manual do administrador: ${note}`);
    res.json({ ok: true, status: updated.status });
  }));

  app.get('/api/admin/settings', ...auth.admin, wrap(async (req, res) => {
    const out = {};
    for (const k of SETTING_KEYS) {
      const v = (await getSetting(db, k)) || '';
      out[k] = SECRET_KEYS.has(k) ? { set: !!v, masked: maskSecret(v) } : v;
    }
    out.owner_email = await getSetting(db, 'owner_email');
    out.base_url = process.env.BASE_URL || 'http://localhost:8787';
    out.webhook_url = (process.env.BASE_URL || 'http://localhost:8787').replace(/\/$/, '') + '/api/payments/webhook';
    out.google_login_configured = googleConfigured();
    out.google_redirect_uri = out.base_url.replace(/\/$/, '') + '/api/auth/google/callback';
    out.database = db.kind;
    res.json({ settings: out });
  }));

  // Testa a chave do Gemini (texto, gratuito). Não gasta créditos de ninguém.
  app.post('/api/admin/ai-test', ...auth.admin, wrap(async (req, res) => {
    const r = await testGemini(db);
    await audit(db, req.user, 'admin.ai_test', r.modelo, r.ok ? 'ok' : 'resposta inesperada');
    res.json(r);
  }));

  app.put('/api/admin/settings', ...auth.admin, wrap(async (req, res) => {
    const updates = req.body?.updates;
    if (!updates || typeof updates !== 'object') throw new HttpError(400, 'Nada para atualizar.');
    for (const [k, vRaw] of Object.entries(updates)) {
      if (!SETTING_KEYS.includes(k)) throw new HttpError(400, `Configuração desconhecida: ${k}`);
      const v = String(vRaw ?? '').trim();
      if (k === 'pix_key_type' && !PIX_TYPES.has(v)) throw new HttpError(400, 'Tipo de chave Pix inválido (phone, cpf, cnpj, email ou random).');
      if (k === 'free_monthly_topup') {
        const n = parseInt(v, 10);
        if (!Number.isInteger(n) || n < 0 || n > 100000000) throw new HttpError(400, 'Valor de recarga mensal inválido.');
      }
      if (k === 'payments_enabled' && v === '1') {
        if (!(await providerReady(db)) && !String(updates.mp_access_token || '').trim()) {
          throw new HttpError(409, 'Para ativar pagamentos, configure antes o Access Token do Mercado Pago. Sem provedor, nenhuma cobrança real pode ser confirmada.');
        }
        if ((await getSetting(db, 'pix_key_confirmed')) !== '1' && String(updates.pix_key_confirmed || '') !== '1') {
          throw new HttpError(409, 'Confirme antes o tipo da chave Pix de recebimento (o número informado no cadastro ainda não foi validado como chave Pix).');
        }
      }
    }
    for (const [k, vRaw] of Object.entries(updates)) {
      const v = String(vRaw ?? '').trim();
      if (SECRET_KEYS.has(k) && v === '') continue;
      await setSetting(db, k, v);
      await audit(db, req.user, 'admin.setting', k, SECRET_KEYS.has(k) ? '(valor atualizado)' : v);
    }
    res.json({ ok: true });
  }));

  // ---------- Administradores ----------
  app.get('/api/admin/admins', ...auth.admin, wrap(async (req, res) => {
    const rows = await db.all("SELECT id,email,name,role,created_at FROM users WHERE role IN ('owner','admin') ORDER BY role DESC, created_at");
    res.json({ items: rows, voce: { id: req.user.id, role: req.user.role } });
  }));

  app.post('/api/admin/admins', ...auth.owner, wrap(async (req, res) => {
    const email = must(req.body?.email, 'e-mail', { max: 190 }).toLowerCase();
    if (!isEmail(email)) throw new HttpError(400, 'E-mail inválido.');
    const target = await db.get('SELECT * FROM users WHERE email=?', [email]);
    if (!target) throw new HttpError(404, 'Não existe conta cadastrada com esse e-mail. A pessoa precisa criar a conta primeiro (conta autenticada).');
    if (target.role === 'owner') throw new HttpError(400, 'Essa conta já é o administrador principal.');
    if (target.role === 'admin') throw new HttpError(409, 'Essa conta já é administradora.');
    await db.run("UPDATE users SET role='admin' WHERE id=?", [target.id]);
    await audit(db, req.user, 'admin.promote', email);
    res.json({ ok: true });
  }));

  app.delete('/api/admin/admins/:id', ...auth.owner, wrap(async (req, res) => {
    const target = await db.get('SELECT * FROM users WHERE id=?', [req.params.id]);
    if (!target) throw new HttpError(404, 'Usuário não encontrado.');
    if (target.role === 'owner') throw new HttpError(403, 'O administrador principal não pode ser removido nem rebaixado.');
    if (target.role !== 'admin') throw new HttpError(400, 'Essa conta não é administradora.');
    await db.run("UPDATE users SET role='user' WHERE id=?", [target.id]);
    await audit(db, req.user, 'admin.demote', target.email);
    res.json({ ok: true });
  }));

  app.get('/api/admin/audit', ...auth.admin, wrap(async (req, res) => {
    res.json({ items: await db.all('SELECT * FROM audit ORDER BY created_at DESC LIMIT 300') });
  }));
}
