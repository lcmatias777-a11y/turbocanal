import { getSetting } from './db.js';
import { HttpError, audit, must, now, uid } from './util.js';
import { grant, getUser } from './credits.js';

/**
 * Pagamentos Pix via Mercado Pago (API oficial /v1/payments).
 * Regras de honestidade:
 *  - NUNCA existe confirmação falsa: créditos só são liberados quando o
 *    Mercado Pago confirma status "approved" (via webhook ou consulta direta
 *    à API), ou quando um ADMINISTRADOR confirma manualmente (fica auditado).
 *  - Nenhum segredo do provedor vai para o frontend.
 */

function mpToken(db) {
  return (process.env.MP_ACCESS_TOKEN || getSetting(db, 'mp_access_token') || '').trim();
}
export function providerReady(db) {
  return !!mpToken(db);
}
export function paymentsEnabled(db) {
  return getSetting(db, 'payments_enabled') === '1' && providerReady(db);
}

async function mp(db, method, path, body, idemKey) {
  const token = mpToken(db);
  if (!token) throw new HttpError(409, 'Provedor de pagamentos não configurado.');
  let resp, data;
  try {
    resp = await fetch('https://api.mercadopago.com' + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(idemKey ? { 'X-Idempotency-Key': idemKey } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    data = await resp.json();
  } catch {
    throw new HttpError(502, 'Não foi possível falar com o Mercado Pago agora. Tente novamente.');
  }
  if (!resp.ok) {
    throw new HttpError(502, 'Mercado Pago: ' + (data?.message || `erro HTTP ${resp.status}`));
  }
  return data;
}

function mapStatus(mpStatus) {
  const map = {
    approved: 'approved',
    pending: 'pending',
    in_process: 'pending',
    authorized: 'pending',
    rejected: 'cancelled',
    cancelled: 'cancelled',
    refunded: 'refunded',
    charged_back: 'refunded',
    expired: 'expired'
  };
  return map[mpStatus] || 'pending';
}

export function activatePayment(db, payment, actor = null, viaLabel = 'webhook do provedor') {
  const run = db.transaction(() => {
    const fresh = db.prepare('SELECT * FROM payments WHERE id=?').get(payment.id);
    if (!fresh || fresh.status === 'approved') return fresh; // idempotente
    const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(fresh.plan_id);
    if (!plan) throw new HttpError(500, 'Plano do pagamento não existe mais.');
    db.prepare("UPDATE payments SET status='approved', updated_at=? WHERE id=?").run(now(), fresh.id);
    db.prepare('UPDATE users SET plan_id=? WHERE id=?').run(plan.id, fresh.user_id);
    grant(db, fresh.user_id, plan.monthly_credits, `Ativação do plano ${plan.name} (pagamento ${fresh.id.slice(0, 8)})`);
    audit(db, actor, 'payment.approved', fresh.id, `plano ${plan.id}, via ${viaLabel}`);
    return db.prepare('SELECT * FROM payments WHERE id=?').get(fresh.id);
  });
  return run();
}

function syncFromProvider(db, local, mpPayment) {
  const st = mapStatus(mpPayment.status);
  if (st === 'approved') return activatePayment(db, local, null, 'confirmação do Mercado Pago');
  if (st !== local.status) {
    db.prepare('UPDATE payments SET status=?, updated_at=?, raw=? WHERE id=?').run(
      st,
      now(),
      JSON.stringify({ status: mpPayment.status, detail: mpPayment.status_detail || null }),
      local.id
    );
  }
  return db.prepare('SELECT * FROM payments WHERE id=?').get(local.id);
}

function pubPayment(p) {
  if (!p) return null;
  let pix = null;
  try {
    const raw = JSON.parse(p.raw || '{}');
    if (raw.pix) pix = raw.pix;
  } catch {}
  return {
    id: p.id,
    plan_id: p.plan_id,
    amount_cents: p.amount_cents,
    provider: p.provider,
    status: p.status,
    created_at: p.created_at,
    updated_at: p.updated_at,
    pix
  };
}

export function paymentRoutes(app, db, auth) {
  app.post('/api/payments/create', auth.required, async (req, res, next) => {
    try {
      const planId = must(req.body?.plan_id, 'plano', { max: 40 });
      const plan = db.prepare('SELECT * FROM plans WHERE id=? AND active=1').get(planId);
      if (!plan) throw new HttpError(404, 'Plano não encontrado ou inativo.');
      if (plan.price_cents <= 0) throw new HttpError(400, 'O plano Free não precisa de pagamento.');
      if (req.user.role === 'owner') {
        throw new HttpError(400, 'A conta do administrador principal já tem acesso ilimitado e isento de cobrança: não há o que pagar.');
      }
      if (!providerReady(db)) {
        throw new HttpError(409, 'Os pagamentos ainda não foram ativados: o administrador precisa configurar o Access Token do Mercado Pago em Admin > Configurações. Nenhuma cobrança é simulada.');
      }
      if (getSetting(db, 'payments_enabled') !== '1') {
        throw new HttpError(409, 'Os pagamentos estão desativados pelo administrador no momento.');
      }

      const id = uid();
      const body = {
        transaction_amount: Math.round(plan.price_cents) / 100,
        description: `TurboCanal - Plano ${plan.name} (mensal)`,
        payment_method_id: 'pix',
        external_reference: id,
        payer: { email: req.user.email }
      };
      const mpData = await mp(db, 'POST', '/v1/payments', body, id);
      const td = mpData?.point_of_interaction?.transaction_data || {};
      const raw = JSON.stringify({
        pix: { qr_code: td.qr_code || null, qr_code_base64: td.qr_code_base64 || null, ticket_url: td.ticket_url || null },
        status: mpData.status
      });
      db.prepare(
        'INSERT INTO payments(id,user_id,plan_id,amount_cents,provider,provider_id,status,created_at,updated_at,raw) VALUES(?,?,?,?,?,?,?,?,?,?)'
      ).run(id, req.user.id, plan.id, plan.price_cents, 'mercadopago', String(mpData.id || ''), mapStatus(mpData.status), now(), now(), raw);
      audit(db, req.user, 'payment.created', id, `plano ${plan.id}, R$ ${(plan.price_cents / 100).toFixed(2)}`);
      res.json({ payment: pubPayment(db.prepare('SELECT * FROM payments WHERE id=?').get(id)) });
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/payments', auth.required, (req, res) => {
    const rows = db.prepare('SELECT * FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
    res.json({ items: rows.map(pubPayment) });
  });

  app.get('/api/payments/:id', auth.required, async (req, res, next) => {
    try {
      let p = db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id);
      if (!p) throw new HttpError(404, 'Pagamento não encontrado.');
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      if (p.user_id !== req.user.id && !isAdmin) throw new HttpError(403, 'Este pagamento não é seu.');
      if (p.status === 'pending' && p.provider === 'mercadopago' && p.provider_id && providerReady(db)) {
        try {
          const mpData = await mp(db, 'GET', '/v1/payments/' + p.provider_id);
          p = syncFromProvider(db, p, mpData);
        } catch {
          /* mantém o estado local se a consulta falhar */
        }
      }
      res.json({ payment: pubPayment(p) });
    } catch (e) {
      next(e);
    }
  });

  // Webhook do Mercado Pago. Segurança: NUNCA confia no corpo da notificação;
  // sempre busca o pagamento direto na API do provedor antes de liberar créditos.
  app.post('/api/payments/webhook', async (req, res) => {
    try {
      const idRaw = req.body?.data?.id || req.query?.['data.id'] || req.query?.id;
      if (!idRaw || !providerReady(db)) return res.status(200).json({ ok: true });
      const mpData = await mp(db, 'GET', '/v1/payments/' + String(idRaw));
      const local =
        db.prepare('SELECT * FROM payments WHERE provider_id=?').get(String(mpData.id)) ||
        (mpData.external_reference ? db.prepare('SELECT * FROM payments WHERE id=?').get(String(mpData.external_reference)) : null);
      if (local) syncFromProvider(db, local, mpData);
      res.status(200).json({ ok: true });
    } catch {
      // Sempre 200 para o provedor não reenviar infinitamente; o estado real
      // é reconciliado na consulta GET /api/payments/:id.
      res.status(200).json({ ok: true });
    }
  });
}
