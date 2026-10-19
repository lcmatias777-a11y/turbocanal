import { getSetting } from './db.js';
import { HttpError, uid, now, ym } from './util.js';

function insertTx(db, userId, delta, balanceAfter, tool, note, idemKey = null) {
  db.prepare(
    'INSERT INTO transactions(id,user_id,delta,balance_after,tool,note,idem_key,created_at) VALUES(?,?,?,?,?,?,?,?)'
  ).run(uid(), userId, delta, balanceAfter, tool, note, idemKey, now());
}

export function getUser(db, id) {
  return db.prepare('SELECT * FROM users WHERE id=?').get(id);
}

/**
 * Recarga mensal do plano Free: no primeiro uso de cada mês, o saldo é
 * completado até o valor configurado em free_monthly_topup (padrão 5000).
 * Regra transparente: "completa até", não "soma", para evitar acúmulo infinito.
 */
export function ensureRefill(db, user) {
  if (!user || user.role === 'owner') return user;
  if (user.plan_id !== 'free') return user;
  const m = ym();
  if (user.last_refill === m) return user;
  const topup = parseInt(getSetting(db, 'free_monthly_topup') || '5000', 10);
  const run = db.transaction(() => {
    const u = db.prepare('SELECT credits,last_refill FROM users WHERE id=?').get(user.id);
    if (u.last_refill === m) return;
    const delta = Math.max(0, topup - u.credits);
    db.prepare('UPDATE users SET last_refill=?, credits=credits+? WHERE id=?').run(m, delta, user.id);
    if (delta > 0) insertTx(db, user.id, delta, u.credits + delta, null, 'Recarga mensal do plano Free');
  });
  run();
  return getUser(db, user.id);
}

export function toolCost(db, tool) {
  const row = db.prepare('SELECT cost,label FROM tool_costs WHERE tool=?').get(tool);
  if (!row) throw new HttpError(404, `Ferramenta desconhecida: ${tool}`);
  return row;
}

/**
 * Débito de créditos, validado NO SERVIDOR.
 * - Conta owner: nunca é cobrada (uso ilimitado), mas o uso fica registrado.
 * - Idempotência: o mesmo X-Idempotency-Key não cobra duas vezes.
 * - Saldo nunca fica negativo.
 */
export function spend(db, user, tool, { idem = null, note = null } = {}) {
  const costRow = toolCost(db, tool);

  if (user.role === 'owner') {
    try {
      insertTx(db, user.id, 0, null, tool, 'Uso ilimitado (administrador principal)', idem);
    } catch {
      /* idem repetido: ignora, continua ilimitado */
    }
    return { charged: 0, balance: null, unlimited: true, cost: costRow.cost };
  }

  const run = db.transaction(() => {
    if (idem) {
      const prev = db
        .prepare('SELECT delta,balance_after FROM transactions WHERE user_id=? AND idem_key=?')
        .get(user.id, idem);
      if (prev) return { charged: 0, balance: prev.balance_after, reused: true, cost: costRow.cost };
    }
    const u = db.prepare('SELECT credits FROM users WHERE id=?').get(user.id);
    if (u.credits < costRow.cost) {
      throw new HttpError(
        402,
        `Créditos insuficientes: esta ferramenta custa ${costRow.cost} créditos e seu saldo é ${u.credits}. Veja os planos para recarregar.`,
        { need: costRow.cost, balance: u.credits }
      );
    }
    const bal = u.credits - costRow.cost;
    db.prepare('UPDATE users SET credits=? WHERE id=?').run(bal, user.id);
    insertTx(db, user.id, -costRow.cost, bal, tool, note || costRow.label, idem);
    return { charged: costRow.cost, balance: bal, reused: false, cost: costRow.cost };
  });
  return run();
}

export function grant(db, userId, amount, note, tool = null) {
  if (!Number.isInteger(amount)) throw new HttpError(400, 'Valor de créditos inválido.');
  const run = db.transaction(() => {
    const u = db.prepare('SELECT credits FROM users WHERE id=?').get(userId);
    if (!u) throw new HttpError(404, 'Usuário não encontrado.');
    const bal = Math.max(0, u.credits + amount); // proteção contra saldo negativo
    db.prepare('UPDATE users SET credits=? WHERE id=?').run(bal, userId);
    insertTx(db, userId, bal - u.credits, bal, tool, note);
    return bal;
  });
  return run();
}

export function refund(db, user, amount, note) {
  if (user.role === 'owner' || amount <= 0) return;
  grant(db, user.id, amount, note);
}
