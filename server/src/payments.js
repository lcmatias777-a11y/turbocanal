import { getSetting } from './db.js';
import { HttpError, audit, must, now, uid } from './util.js';
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
    await q.run('UPDATE users SET plan_id=? WHERE id=?', [plan.id, fresh.user_id]);
    const u = await q.get('SELECT credits FROM users WHERE id=?', [fresh.user_id]);
    const bal = u.credits + plan.monthly_credits;
    await q.run('UPDATE users SET credits=? WHERE id=?', [bal, fresh.user_id]);
    await q.run('INSERT INTO transactions(id,user_id,delta,balance_after,tool,note,idem_key,created_at) VALUES(?,?,?,?,?,?,?,?)', [
      uid(), fresh.user_id, plan.monthly_credits, bal, null, `Ativação do plano ${plan.name} (pagamento ${fresh.id.slice(0, 8)})`, null, now()
    ]);
    await q.run('INSERT INTO audit(id, actor_id, actor_email, action, target, detail, created_at) VALUES(?,?,?,?,?,?,?)', [
      uid(), actor?.id || null, actor?.email || 'sistema', 'payment.approved', fresh.id, `plano ${plan.id}, via ${viaLabel}`, now()
    ]);
    aviso = { user: fresh.user_id, plano: plan.name, creditos: plan.monthly_credits, valorCentavos: fresh.amount_cents };
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
  return { id: p.id, plan_id: p.plan_id, amount_cents: p.amount_cents, provider: p.provider, status: p.status, created_at: p.created_at, updated_at: p.updated_at, pix };
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
      const body = {
        transaction_amount: Math.round(plan.price_cents) / 100,
        // "(mensal)" saia aqui e ia parar no extrato do cliente, mas nao existe
        // cobranca recorrente: cada Pix e um pagamento avulso que libera os
        // creditos daquele plano uma vez.
        description: `TurboCanal - Plano ${plan.name}`,
        payment_method_id: 'pix',
        external_reference: id,
        payer: { email: req.user.email }
      };
      const mpData = await mp(db, 'POST', '/v1/payments', body, id);
      const td = mpData?.point_of_interaction?.transaction_data || {};
      const raw = JSON.stringify({ pix: { qr_code: td.qr_code || null, qr_code_base64: td.qr_code_base64 || null, ticket_url: td.ticket_url || null }, status: mpData.status });
      await db.run('INSERT INTO payments(id,user_id,plan_id,amount_cents,provider,provider_id,status,created_at,updated_at,raw) VALUES(?,?,?,?,?,?,?,?,?,?)', [
        id, req.user.id, plan.id, plan.price_cents, 'mercadopago', String(mpData.id || ''), mapStatus(mpData.status), now(), now(), raw
      ]);
      await audit(db, req.user, 'payment.created', id, `plano ${plan.id}, R$ ${(plan.price_cents / 100).toFixed(2)}`);
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
