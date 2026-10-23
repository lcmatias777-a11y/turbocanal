import { getSetting, setSetting } from './db.js';
import { HttpError, audit, isEmail, must, now } from './util.js';
import { grant } from './credits.js';
import { pedirOuFazer } from './pedidos.js';
import { activatePayment, providerReady } from './payments.js';
import { googleConfigured } from './auth.js';
import { testGemini } from './gemini.js';

const SETTING_KEYS = ['site_name', 'free_monthly_topup', 'yt_api_key', 'gemini_api_key', 'mp_access_token', 'payments_enabled', 'pix_key_value', 'pix_key_type', 'pix_key_confirmed'];
/** TUDO o que é segredo dentro da tabela settings, numa lista só.
 *  Antes havia duas listas: uma para mascarar na tela e outra para tirar do
 *  backup. Elas saíram do lugar e a chave privada das notificações (vapid_private)
 *  ficava mascarada na tela mas ia em texto puro dentro do arquivo de backup.
 *  Uma lista só não tem como sair do lugar. */
export const SEGREDOS_SETTINGS = new Set([
  'yt_api_key', 'gemini_api_key', 'mp_access_token', 'vapid_private', 'jwt_secret', 'admin_setup_token'
]);
const SECRET_KEYS = SEGREDOS_SETTINGS;
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
  const SEGREDO = (k) => SEGREDOS_SETTINGS.has(k);

  app.get('/api/admin/backup', ...auth.owner, wrap(async (req, res) => {
    const dump = { gerado_em: now(), banco: db.kind, versao: 1, tabelas: {} };
    for (const t of TABELAS_BACKUP) {
      try {
        let linhas = await db.all(`SELECT * FROM ${t}`);
        if (t === 'users') linhas = linhas.map((u) => ({ ...u, pass_hash: u.pass_hash ? '(removido do backup)' : null }));
        if (t === 'settings') linhas = linhas.filter((r) => !SEGREDO(r.key));
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
      { chave: 'duas_etapas', titulo: 'Verificação em duas etapas na sua conta Google', ok: null, critico: false,
        estado: 'só você consegue conferir isso (o site não enxerga a sua conta Google)',
        resolver: 'O TurboCanal não tem senha própria: o login é só pelo Google. Então a chave do site inteiro é a sua conta Google. Ligue a verificação em duas etapas nela em myaccount.google.com/security. É a única coisa que protege de verdade contra conta invadida.' },
      { chave: 'backup', titulo: 'Backup do banco', ok: diasBackup !== null && diasBackup <= 30, critico: false,
        estado: ultimoBackup ? `último há ${diasBackup} dia(s)` : 'nunca foi feito',
        resolver: diasBackup !== null && diasBackup <= 30 ? '' : 'Baixe um backup em Admin → Banco de dados. Guarde o arquivo fora do Render.' }
    ];
    const avaliados = itens.filter((i) => i.ok !== null);
    const faltando = avaliados.filter((i) => !i.ok);
    res.json({
      itens,
      prontos: avaliados.length - faltando.length,
      total: avaliados.length,
      faltando: faltando.length,
      bloqueios: faltando.filter((i) => i.critico).map((i) => i.titulo)
    });
  }));

  app.get('/api/admin/overview', ...auth.admin, wrap(async (req, res) => {
    const users = (await db.get('SELECT COUNT(*)::int AS n FROM users')).n;
    const byPlan = await db.all('SELECT plan_id, COUNT(*)::int AS n FROM users GROUP BY plan_id');
    const byRole = await db.all('SELECT role, COUNT(*)::int AS n FROM users GROUP BY role');
    // Só uso de ferramenta: ajuste manual do administrador NÃO é consumo de API.
    const spent30d = (await db.get('SELECT COALESCE(SUM(-delta),0)::int AS s FROM transactions WHERE delta<0 AND tool IS NOT NULL AND created_at >= ?', [daysAgo(30)])).s;
    const ajustes30d = (await db.get('SELECT COALESCE(SUM(-delta),0)::int AS s FROM transactions WHERE delta<0 AND tool IS NULL AND created_at >= ?', [daysAgo(30)])).s;
    const usage30d = await db.all('SELECT tool, COUNT(*)::int AS n FROM transactions WHERE tool IS NOT NULL AND created_at >= ? GROUP BY tool ORDER BY n DESC', [daysAgo(30)]);
    const paid = await db.get("SELECT COALESCE(SUM(amount_cents),0)::int AS s, COUNT(*)::int AS n FROM payments WHERE status='approved'");
    // A pergunta que decide se o site vale alguma coisa: quem usou uma ferramenta
    // na semana passada VOLTOU e usou de novo esta semana? Nada de vaidade: conta
    // uso real de ferramenta, não login.
    const semanaPassada = await db.all(
      'SELECT DISTINCT user_id FROM transactions WHERE tool IS NOT NULL AND created_at >= ? AND created_at < ?',
      [daysAgo(14), daysAgo(7)]);
    const estaSemana = new Set((await db.all(
      'SELECT DISTINCT user_id FROM transactions WHERE tool IS NOT NULL AND created_at >= ?', [daysAgo(7)])).map((r) => r.user_id));
    const voltaram = semanaPassada.filter((r) => estaSemana.has(r.user_id)).length;
    const retorno = {
      usaramSemanaPassada: semanaPassada.length,
      voltaramEstaSemana: voltaram,
      percentual: semanaPassada.length ? Math.round((voltaram / semanaPassada.length) * 100) : null,
      ativosEstaSemana: estaSemana.size
    };
    const ytUnitsToday = parseInt((await getSetting(db, 'yt_units_' + new Date().toISOString().slice(0, 10))) || '0', 10);
    res.json({
      users, byPlan, byRole, creditsSpent30d: spent30d, creditsAdjusted30d: ajustes30d, usage30d, retorno,
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
      ? await db.all('SELECT id,email,name,role,plan_id,credits,banido,banido_motivo,created_at FROM users WHERE lower(email) LIKE ? OR lower(name) LIKE ? ORDER BY created_at DESC LIMIT 100', [`%${q}%`, `%${q}%`])
      : await db.all('SELECT id,email,name,role,plan_id,credits,banido,banido_motivo,created_at FROM users ORDER BY created_at DESC LIMIT 100');
    res.json({ items: rows });
  }));

  app.post('/api/admin/users/:id/credits', ...auth.admin, wrap(async (req, res) => {
    const r = await pedirOuFazer(db, req.user, 'creditos', {
      alvo_user: req.params.id, delta: req.body?.delta, motivo: req.body?.note
    });
    res.status(r.executado ? 200 : 202).json({ ok: true, ...r, balance: r.resultado?.balance });
  }));

  app.post('/api/admin/users/:id/banir', ...auth.admin, wrap(async (req, res) => {
    const r = await pedirOuFazer(db, req.user, req.body?.desfazer ? 'desbanir' : 'banir', {
      alvo_user: req.params.id, motivo: req.body?.motivo
    });
    res.status(r.executado ? 200 : 202).json({ ok: true, ...r });
  }));

  app.post('/api/admin/users/:id/plan', ...auth.admin, wrap(async (req, res) => {
    const r = await pedirOuFazer(db, req.user, 'plano_do_usuario', {
      alvo_user: req.params.id, plan_id: req.body?.plan_id, motivo: req.body?.motivo
    });
    res.status(r.executado ? 200 : 202).json({ ok: true, ...r });
  }));

  app.get('/api/admin/plans', ...auth.admin, wrap(async (req, res) => {
    res.json({ items: await db.all('SELECT * FROM plans ORDER BY sort') });
  }));

  app.post('/api/admin/plans', ...auth.admin, wrap(async (req, res) => {
    const r = await pedirOuFazer(db, req.user, 'criar_plano', { ...req.body, motivo: req.body?.motivo });
    res.status(r.executado ? 200 : 202).json({ ok: true, ...r });
  }));

  app.put('/api/admin/plans/:id', ...auth.admin, wrap(async (req, res) => {
    const r = await pedirOuFazer(db, req.user, 'editar_plano', { ...req.body, alvo_id: req.params.id, motivo: req.body?.motivo });
    res.status(r.executado ? 200 : 202).json({ ok: true, ...r });
  }));

  app.put('/api/admin/tools/:tool', ...auth.admin, wrap(async (req, res) => {
    const r = await pedirOuFazer(db, req.user, 'custo_ferramenta', { alvo_id: req.params.tool, cost: req.body?.cost, motivo: req.body?.motivo });
    res.status(r.executado ? 200 : 202).json({ ok: true, ...r });
  }));

  app.get('/api/admin/payments', ...auth.admin, wrap(async (req, res) => {
    const rows = (await db.all('SELECT p.*, u.email FROM payments p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 200')).map((p) => ({ ...p, raw: undefined }));
    res.json({ items: rows });
  }));

  // Confirmação MANUAL auditada (só depois de conferir o recebimento de verdade)
  app.post('/api/admin/payments/:id/confirm', ...auth.admin, wrap(async (req, res) => {
    const r = await pedirOuFazer(db, req.user, 'confirmar_pagamento', { alvo_id: req.params.id, note: req.body?.note, motivo: req.body?.note });
    res.status(r.executado ? 200 : 202).json({ ok: true, ...r, status: r.resultado?.status, ja_aprovado: r.resultado?.ja_aprovado });
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

  app.put('/api/admin/settings', ...auth.owner, wrap(async (req, res) => {
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

  app.post('/api/admin/admins', ...auth.admin, wrap(async (req, res) => {
    const email = must(req.body?.email, 'e-mail', { max: 190 }).toLowerCase();
    if (!isEmail(email)) throw new HttpError(400, 'E-mail inválido.');
    const r = await pedirOuFazer(db, req.user, 'adicionar_admin', { email, motivo: req.body?.motivo });
    res.status(r.executado ? 200 : 202).json({ ok: true, ...r });
  }));

  app.delete('/api/admin/admins/:id', ...auth.admin, wrap(async (req, res) => {
    const r = await pedirOuFazer(db, req.user, 'remover_admin', { alvo_user: req.params.id, motivo: req.body?.motivo });
    res.status(r.executado ? 200 : 202).json({ ok: true, ...r });
  }));

  // Derrubar as sessões de outra conta (só o administrador principal).
  // Serve para cortar o acesso de uma conta de administrador invadida.
  app.post('/api/admin/users/:id/encerrar-sessoes', ...auth.owner, wrap(async (req, res) => {
    const alvo = await db.get('SELECT id,email,role FROM users WHERE id=?', [req.params.id]);
    if (!alvo) throw new HttpError(404, 'Usuário não encontrado.');
    // Nem a própria conta, nem a de outro administrador: derrubar o acesso de
    // quem administra é briga entre administradores, não moderação.
    if (alvo.id === req.user.id) throw new HttpError(400, 'Para sair das suas próprias sessões, use Sair em cada aparelho.');
    if (alvo.role !== 'user') throw new HttpError(403, 'Não dá para encerrar as sessões de um administrador. Tire o cargo dele na aba Administradores, que isso já derruba o acesso ao painel.');
    await db.run('UPDATE users SET sessao_v=sessao_v+1 WHERE id=?', [alvo.id]);
    await audit(db, req.user, 'auth.sessoes_encerradas', alvo.id, `pelo administrador principal · ${alvo.email}`);
    const { notificar } = await import('./notify.js');
    await notificar(db, alvo.id, 'seguranca', 'Suas sessões foram encerradas', {
      corpo: 'O administrador principal encerrou os acessos da sua conta. Entre de novo com o Google.', link: '#/dashboard'
    });
    res.json({ ok: true });
  }));

  app.get('/api/admin/audit', ...auth.admin, wrap(async (req, res) => {
    res.json({ items: await db.all('SELECT * FROM audit ORDER BY created_at DESC LIMIT 300') });
  }));
}
