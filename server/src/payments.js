import { getSetting } from './db.js';
import { HttpError, audit, must, now, uid, ym } from './util.js';
import { grant } from './credits.js';

/**
 * Pagamentos Pix via Mercado Pago (API oficial /v1/payments).
 *  - NUNCA existe confirmação falsa: créditos só são liberados quando o Mercado Pago
 *    confirma "approved" (webhook ou consulta direta), ou por confirmação MANUAL
 *    auditada de um administrador.
 *  - Nenhum segredo do provedor vai para o frontend.
 */
async function mpToken(db) {
  return (process.env.MP_ACCESS_TOKEN || (await getSetting(db, 'mp_access_token')) || '').trim();
}
export async function providerReady(db) {
  return !!(await mpToken(db));
}
export async function paymentsEnabled(db) {
  return (await getSetting(db, 'payments_enabled')) === '1' && (await providerReady(db));
}

async function mp(db, method, path, body, idemKey) {
  const token = await mpToken(db);
  if (!token) throw new HttpError(409, 'Provedor de pagamentos não configurado.');
  let resp, data;
  try {
    resp = await fetch('https://api.mercadopago.com' + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(idemKey ? { 'X-Idempotency-Key': idemKey } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    data = await resp.json();
  } catch {
    throw new HttpError(502, 'Não foi possível falar com o Mercado Pago agora. Tente novamente.');
  }
  if (!resp.ok) throw new HttpError(502, 'Mercado Pago: ' + (data?.message || `erro HTTP ${resp.status}`));
  return data;
}

function mapStatus(mpStatus) {
  const map = { approved: 'approved', pending: 'pending', in_process: 'pending', authorized: 'pending', rejected: 'cancelled', cancelled: 'cancelled', refunded: 'refunded', charged_back: 'refunded', expired: 'expired' };
  return map[mpStatus] || 'pending';
}

export async function activatePayment(db, payment, actor = null, viaLabel = 'webhook do provedor') {
  let aviso = null;
  return db.tx(async (q) => {
    const fresh = await q.get('SELECT * FROM payments WHERE id=?', [payment.id]);
    if (!fresh || fresh.status === 'approved') return fresh; // idempotente
    const plan = await q.get('SELECT * FROM plans WHERE id=?', [fresh.plan_id]);
    if (!plan) throw new HttpError(500, 'Plano do pagamento não existe mais.');
    await q.run("UPDATE payments SET status='approved', updated_at=? WHERE id=?", [now(), fresh.id]);
    const per = PERIODOS[lerPeriodo(fresh.periodo)];
    const u = await q.get('SELECT credits, plano_ate FROM users WHERE id=?', [fresh.user_id]);
    // O pagamento compra TEMPO. A data nova soma ao que ainda falta, então quem
    // paga antes de vencer não perde os dias que sobraram.
    const ate = somarMeses(u.plano_ate, per.meses);
    // Os créditos do plano entram mês a mês (credits.js), mas o primeiro mês
    // entra agora: quem acabou de pagar não pode ficar esperando a virada do mês.
    const bal = Math.max(u.credits, plan.monthly_credits);
    await q.run('UPDATE users SET plan_id=?, plano_ate=?, credits=?, last_refill=? WHERE id=?',
      [plan.id, ate, bal, ym(), fresh.user_id]);
    if (bal !== u.credits) {
      await q.run('INSERT INTO transactions(id,user_id,delta,balance_after,tool,note,idem_key,created_at) VALUES(?,?,?,?,?,?,?,?)', [
        uid(), fresh.user_id, bal - u.credits, bal, null,
        `Ativação do plano ${plan.name} por ${per.rotulo} (pagamento ${fresh.id.slice(0, 8)})`, null, now()
      ]);
    }
    await q.run('INSERT INTO audit(id, actor_id, actor_email, action, target, detail, created_at) VALUES(?,?,?,?,?,?,?)', [
      uid(), actor?.id || null, actor?.email || 'sistema', 'payment.approved', fresh.id, `plano ${plan.id}, via ${viaLabel}`, now()
    ]);
    aviso = { user: fresh.user_id, plano: plan.name, creditos: plan.monthly_credits, valorCentavos: fresh.amount_cents, meses: per.meses, ate };
    return q.get('SELECT * FROM payments WHERE id=?', [fresh.id]);
  }).then(async (r) => {
    if (aviso) {
      const { avisos } = await import('./notify.js');
      await avisos.pagamento(db, aviso.user, aviso);
    }
    return r;
  });
}

async function syncFromProvider(db, local, mpPayment) {
  const st = mapStatus(mpPayment.status);
  if (st === 'approved') return activatePayment(db, local, null, 'confirmação do Mercado Pago');
  if (st !== local.status) {
    await db.run('UPDATE payments SET status=?, updated_at=?, raw=? WHERE id=?', [st, now(), JSON.stringify({ status: mpPayment.status, detail: mpPayment.status_detail || null }), local.id]);
  }
  return db.get('SELECT * FROM payments WHERE id=?', [local.id]);
}

function pubPayment(p) {
  if (!p) return null;
  let pix = null;
  try { const raw = JSON.parse(p.raw || '{}'); if (raw.pix) pix = raw.pix; } catch {}
  const per = PERIODOS[lerPeriodo(p.periodo)];
  return { id: p.id, plan_id: p.plan_id, amount_cents: p.amount_cents, provider: p.provider, status: p.status,
    periodo: lerPeriodo(p.periodo), periodo_rotulo: per.rotulo, meses: per.meses,
    created_at: p.created_at, updated_at: p.updated_at, pix };
}

/** O que cada pagamento compra.
 *
 *  Não existe cobrança automática no site: o Mercado Pago não cobra ninguém
 *  sozinho. O que existe é pagamento por PERÍODO. Um pagamento compra 2 meses
 *  pelo preço do plano; o anual compra 12 meses por 6 pagamentos com 10% de
 *  desconto (Starter: 6 x R$ 10 = R$ 60, menos 10% = R$ 54).
 *
 *  Os créditos NÃO entram todos de uma vez: entram mês a mês, enquanto o prazo
 *  estiver valendo, pela recarga mensal (credits.js). Quem paga de novo soma
 *  ao que falta, não joga fora o tempo que sobrou. */
export const PERIODOS = {
  '2m': { meses: 2, vezes: 1, desconto: 0, rotulo: '2 meses' },
  '12m': { meses: 12, vezes: 6, desconto: 0.10, rotulo: '1 ano' }
};
// Cuidado com o atalho esperto aqui: a primeira versao era
//   PERIODOS[String(v || '2m')] ? String(v) : '2m'
// e com v = null o teste do meio passava pelo fallback mas o retorno era a
// string "null". Simples e sem gracinha:
export const lerPeriodo = (v) => (Object.hasOwn(PERIODOS, String(v)) ? String(v) : '2m');
/** Preço final em centavos de um plano num período, já com o desconto. */
export function precoDoPeriodo(plan, periodo) {
  const p = PERIODOS[lerPeriodo(periodo)];
  return Math.round(plan.price_cents * p.vezes * (1 - p.desconto));
}
/** Nova data de fim: soma os meses ao que ainda falta, não ao dia de hoje. */
export function somarMeses(ateAtual, meses, agora = new Date()) {
  const base = ateAtual && new Date(ateAtual) > agora ? new Date(ateAtual) : new Date(agora);
  const d = new Date(base);
  d.setMonth(d.getMonth() + meses);
  return d.toISOString();
}

export function paymentRoutes(app, db, auth) {
  app.post('/api/payments/create', auth.required, async (req, res, next) => {
    try {
      const planId = must(req.body?.plan_id, 'plano', { max: 40 });
      const plan = await db.get('SELECT * FROM plans WHERE id=? AND active=1', [planId]);
      if (!plan) throw new HttpError(404, 'Plano não encontrado ou inativo.');
      if (plan.price_cents <= 0) throw new HttpError(400, 'O plano Free não precisa de pagamento.');
      if (req.user.role === 'owner') {
        throw new HttpError(400, 'A conta do administrador principal já tem acesso ilimitado e isento de cobrança: não há o que pagar.');
      }
      if (!(await providerReady(db))) {
        throw new HttpError(409, 'Os pagamentos ainda não foram ativados: o administrador precisa configurar o Access Token do Mercado Pago em Admin > Configurações. Nenhuma cobrança é simulada.');
      }
      if ((await getSetting(db, 'payments_enabled')) !== '1') {
        throw new HttpError(409, 'Os pagamentos estão desativados pelo administrador no momento.');
      }
      const id = uid();
      const valor = precoDoPeriodo(plan, periodo);
      const body = {
        transaction_amount: valor / 100,
        // O que a pessoa vai ver no extrato: o plano e o periodo que ela comprou.
        // Nada de "(mensal)": nao existe cobranca automatica, e dizer que existe
        // no extrato do cliente seria mentira no lugar mais caro de mentir.
        description: `TurboCanal - Plano ${plan.name} (${PERIODOS[periodo].rotulo})`,
        payment_method_id: 'pix',
        external_reference: id,
        payer: { email: req.user.email }
      };
      const mpData = await mp(db, 'POST', '/v1/payments', body, id);
      const td = mpData?.point_of_interaction?.transaction_data || {};
      const raw = JSON.stringify({ pix: { qr_code: td.qr_code || null, qr_code_base64: td.qr_code_base64 || null, ticket_url: td.ticket_url || null }, status: mpData.status });
      await db.run('INSERT INTO payments(id,user_id,plan_id,amount_cents,provider,provider_id,status,periodo,created_at,updated_at,raw) VALUES(?,?,?,?,?,?,?,?,?,?,?)', [
        id, req.user.id, plan.id, valor, 'mercadopago', String(mpData.id || ''), mapStatus(mpData.status), periodo, now(), now(), raw
      ]);
      await audit(db, req.user, 'payment.created', id, `plano ${plan.id}, ${PERIODOS[periodo].rotulo}, R$ ${(valor / 100).toFixed(2)}`);
      res.json({ payment: pubPayment(await db.get('SELECT * FROM payments WHERE id=?', [id])) });
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/payments', auth.required, async (req, res, next) => {
    try {
      const rows = await db.all('SELECT * FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 50', [req.user.id]);
      res.json({ items: rows.map(pubPayment) });
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/payments/:id', auth.required, async (req, res, next) => {
    try {
      let p = await db.get('SELECT * FROM payments WHERE id=?', [req.params.id]);
      if (!p) throw new HttpError(404, 'Pagamento não encontrado.');
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      if (p.user_id !== req.user.id && !isAdmin) throw new HttpError(403, 'Este pagamento não é seu.');
      if (p.status === 'pending' && p.provider === 'mercadopago' && p.provider_id && (await providerReady(db))) {
        try {
          const mpData = await mp(db, 'GET', '/v1/payments/' + p.provider_id);
          p = await syncFromProvider(db, p, mpData);
        } catch { /* mantém estado local */ }
      }
      res.json({ payment: pubPayment(p) });
    } catch (e) {
      next(e);
    }
  });

  // Webhook: NUNCA confia no corpo; busca o pagamento direto na API do provedor.
  app.post('/api/payments/webhook', async (req, res) => {
    try {
      const idRaw = req.body?.data?.id || req.query?.['data.id'] || req.query?.id;
      if (!idRaw || !(await providerReady(db))) return res.status(200).json({ ok: true });
      const mpData = await mp(db, 'GET', '/v1/payments/' + String(idRaw));
      const local =
        (await db.get('SELECT * FROM payments WHERE provider_id=?', [String(mpData.id)])) ||
        (mpData.external_reference ? await db.get('SELECT * FROM payments WHERE id=?', [String(mpData.external_reference)]) : null);
      if (local) await syncFromProvider(db, local, mpData);
      res.status(200).json({ ok: true });
    } catch {
      res.status(200).json({ ok: true });
    }
  });
}
