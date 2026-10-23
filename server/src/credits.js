import { getSetting } from './db.js';
import { HttpError, uid, now, ym } from './util.js';

async function insertTx(q, userId, delta, balanceAfter, tool, note, idemKey = null) {
  await q.run(
    'INSERT INTO transactions(id,user_id,delta,balance_after,tool,note,idem_key,created_at) VALUES(?,?,?,?,?,?,?,?)',
    [uid(), userId, delta, balanceAfter, tool, note, idemKey, now()]
  );
}

export function getUser(db, id) {
  return db.get('SELECT * FROM users WHERE id=?', [id]);
}

/** O plano pago desta conta ainda está valendo? */
export const planoValendo = (user, agora = new Date()) =>
  !!(user?.plano_ate && new Date(user.plano_ate) > agora);

/**
 * Recarga mensal de TODA conta, no primeiro uso de cada mês.
 *
 * Quanto entra depende do plano estar valendo ou não:
 *  - plano pago dentro do prazo -> completa até os créditos mensais do plano;
 *  - fora do prazo, ou plano Free -> completa até free_monthly_topup (5000).
 *
 * "Completa até", não soma: quem já tem mais do que isso não recebe nada.
 *
 * É assim que o pagamento por período paga: a pessoa compra 2 meses (ou 12, no
 * anual) e os créditos do plano entram MÊS A MÊS enquanto o prazo corre, em vez
 * de virem todos de uma vez. Quando o prazo acaba, a conta não fica no vácuo:
 * volta a receber o piso de 5000, igual a qualquer outra.
 */
export async function ensureRefill(db, user) {
  if (!user || user.role === 'owner') return user;
  const m = ym();
  if (user.last_refill === m) return user;

  const piso = parseInt((await getSetting(db, 'free_monthly_topup')) || '5000', 10);
  let alvo = piso, doPlano = false;
  if (planoValendo(user)) {
    const plano = await db.get('SELECT monthly_credits FROM plans WHERE id=?', [user.plan_id]);
    if (plano && plano.monthly_credits > alvo) { alvo = plano.monthly_credits; doPlano = true; }
  }

  let recarregou = 0;
  // A recarga mensal roda sozinha na primeira visita do mês, em qualquer
  // página, inclusive dentro do painel administrativo. Ela não é ação de
  // administrador nenhum, então sai da guarda de escrita explicitamente.
  const { semGuarda } = await import('./guarda.js');
  // Declara, por escrito, o que esta escrita automática pode tocar. Fora desta
  // lista a guarda barra, inclusive se uma função auxiliar daqui de dentro
  // tentar mexer em plano, preço ou configuração.
  await semGuarda('recarga mensal de créditos', ['users:credits', 'transactions'], () => db.tx(async (q) => {
    const u = await q.get('SELECT credits,last_refill FROM users WHERE id=?', [user.id]);
    if (!u || u.last_refill === m) return;
    const delta = Math.max(0, alvo - u.credits);
    await q.run('UPDATE users SET last_refill=?, credits=credits+? WHERE id=?', [m, delta, user.id]);
    if (delta > 0) {
      await insertTx(q, user.id, delta, u.credits + delta, null,
        doPlano ? 'Créditos do mês do seu plano' : 'Recarga mensal de créditos');
    }
    recarregou = delta;
  }));
  if (recarregou > 0) {
    const { avisos } = await import('./notify.js');
    await avisos.recarga(db, user.id, recarregou, alvo, doPlano);
  }
  return getUser(db, user.id);
}

export async function toolCost(db, tool) {
  const row = await db.get('SELECT cost,label FROM tool_costs WHERE tool=?', [tool]);
  if (!row) throw new HttpError(404, `Ferramenta desconhecida: ${tool}`);
  return row;
}

/**
 * Débito de créditos, validado NO SERVIDOR.
 * - owner: nunca é cobrado (uso ilimitado), mas o uso fica registrado.
 * - Idempotência: o mesmo X-Idempotency-Key não cobra duas vezes.
 * - Saldo nunca fica negativo.
 */
export async function spend(db, user, tool, { idem = null, note = null } = {}) {
  const costRow = await toolCost(db, tool);

  // Canal de teste não cobra NADA. Nem as ferramentas de IA: lá a resposta é
  // de demonstração, montada por regras, e não chega a chamar o Gemini.
  {
    const { ligado } = await import('./canalteste.js');
    if (await ligado(db, user)) {
      try {
        await insertTx(db, user.id, 0, null, tool, 'Canal de teste (não cobra)', idem);
      } catch { /* idem repetido: ignora */ }
      return { charged: 0, balance: null, demo: true, cost: costRow.cost };
    }
  }

  if (user.role === 'owner') {
    try {
      await insertTx(db, user.id, 0, null, tool, 'Uso ilimitado (administrador principal)', idem);
    } catch {
      /* idem repetido: ignora */
    }
    return { charged: 0, balance: null, unlimited: true, cost: costRow.cost };
  }

  return db.tx(async (q) => {
    if (idem) {
      const prev = await q.get('SELECT delta,balance_after FROM transactions WHERE user_id=? AND idem_key=?', [user.id, idem]);
      if (prev) return { charged: 0, balance: prev.balance_after, reused: true, cost: costRow.cost };
    }
    const u = await q.get('SELECT credits FROM users WHERE id=?', [user.id]);
    if (u.credits < costRow.cost) {
      throw new HttpError(
        402,
        `Créditos insuficientes: esta ferramenta custa ${costRow.cost} créditos e seu saldo é ${u.credits}. Veja os planos para recarregar.`,
        { need: costRow.cost, balance: u.credits }
      );
    }
    const bal = u.credits - costRow.cost;
    await q.run('UPDATE users SET credits=? WHERE id=?', [bal, user.id]);
    await insertTx(q, user.id, -costRow.cost, bal, tool, note || costRow.label, idem);
    return { charged: costRow.cost, balance: bal, reused: false, cost: costRow.cost };
  });
}

export async function grant(db, userId, amount, note, tool = null) {
  if (!Number.isInteger(amount)) throw new HttpError(400, 'Valor de créditos inválido.');
  return db.tx(async (q) => {
    const u = await q.get('SELECT credits FROM users WHERE id=?', [userId]);
    if (!u) throw new HttpError(404, 'Usuário não encontrado.');
    const bal = Math.max(0, u.credits + amount);
    await q.run('UPDATE users SET credits=? WHERE id=?', [bal, userId]);
    await insertTx(q, userId, bal - u.credits, bal, tool, note);
    return bal;
  });
}

export async function refund(db, user, amount, note, tool = null) {
  if (user.role === 'owner' || amount <= 0) return;
  // O estorno guarda QUAL ferramenta falhou. Sem isso não dá para saber que
  // aquela cobrança não vale como uso real da plataforma.
  await grant(db, user.id, amount, note, tool);
}
