import { getSetting } from './db.js';
import { HttpError, now, uid, ym } from './util.js';
import { PERIODOS, lerPeriodo, somarMeses } from './payments.js';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Recebimento de vendas da Hotmart (webhook 2.0.0).
 *
 * REGRA QUE MANDA AQUI: nada libera acesso sem prova. A prova e o token fixo
 * que a Hotmart manda no cabecalho X-HOTMART-HOTTOK, mais o produto e a oferta
 * batendo com o que o administrador configurou. Faltando qualquer peca, o
 * evento e GRAVADO, o dono e AVISADO, e o acesso NAO sai. Preferimos um cliente
 * esperando (que o administrador resolve em um clique) a um ano de acesso
 * entregue por um pagamento de dez reais.
 *
 * O FORMATO foi levantado de implementacoes reais de terceiros, nao da
 * documentacao oficial (developers.hotmart.com bloqueia o acesso daqui). Por
 * isso o corpo inteiro de cada chamada fica gravado em hotmart_eventos: a
 * primeira venda de verdade confirma ou corrige o mapeamento, com o JSON na
 * mao em vez de palpite.
 *
 * O que e DECIDIDO PELO NOME DO EVENTO, nunca pelo data.purchase.status: um
 * PURCHASE_REFUNDED pode chegar com status 'APPROVED', porque aquele campo e o
 * status da compra e nao o do evento. Ler o status primeiro transformaria
 * reembolso em venda.
 */

const LIBERA = new Set(['PURCHASE_APPROVED', 'PURCHASE_COMPLETE']);
const REVOGA = new Set(['PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK']);

/* Eventos que a Hotmart manda e que, por decisao escrita, nao mexem no acesso:
 *  - PURCHASE_CANCELED / PURCHASE_EXPIRED: a compra nunca foi aprovada, nao ha
 *    o que tirar.
 *  - SUBSCRIPTION_CANCELLATION: hoje o produto e pagamento unico por periodo,
 *    entao nao existe assinatura para cancelar. Se um dia virar assinatura,
 *    falta decidir se o acesso cai na hora ou no fim do periodo ja pago, e essa
 *    decisao e do dono, nao minha.
 *  - ORDER_FULFILLMENT: repete uma transacao ja aprovada (risco de liberar duas
 *    vezes); a deduplicacao por transacao + evento ja cobriria, mas fica fora. */

const texto = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** Compara em tempo constante, sem vazar o tamanho do token pelo tempo. */
function tokenIgual(a, b) {
  if (!a || !b) return false;
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

async function hottokConfigurado(db) {
  return texto(process.env.HOTMART_HOTTOK || (await getSetting(db, 'hotmart_hottok')));
}

/** De quem e a compra: o comprador, ou o assinante em eventos de assinatura. */
function emailDoPayload(d) {
  const comprador = obj(d.buyer), assinante = obj(d.subscriber);
  const e = texto(comprador.email) || texto(assinante.email);
  return e.toLowerCase();
}

/** O codigo da oferta vem em data.purchase.offer.code, e algumas chamadas
 *  trazem em data.offer.code. Aceita os dois lugares, nada alem disso. */
function ofertaDoPayload(d) {
  const compra = obj(d.purchase);
  return texto(obj(compra.offer).code || obj(d.offer).code);
}

/** O mapa oferta -> plano e periodo, que o administrador preenche depois de
 *  criar as ofertas na Hotmart. Formato:
 *    {"ABC12345": {"plan": "p10", "periodo": "12m"}}
 *  Lixo no lugar do JSON nao derruba o webhook: vira mapa vazio, e o evento
 *  cai no caminho de "oferta desconhecida", que avisa o dono. */
async function mapaDeOfertas(db) {
  try {
    const m = JSON.parse((await getSetting(db, 'hotmart_ofertas')) || '{}');
    return obj(m);
  } catch {
    return {};
  }
}

async function avisarDono(db, titulo, corpo) {
  try {
    const { notificarDono } = await import('./notify.js');
    await notificarDono(db, 'pedido_admin', titulo, { corpo, link: '#/admin/hotmart' });
  } catch (e) {
    console.error('[hotmart] nao deu para avisar o dono:', e.message);
  }
}

async function gravar(db, { evento, transacao, email, produto, oferta, resultado, detalhe, corpo }) {
  await db.run(
    `INSERT INTO hotmart_eventos(id,evento,transacao,email,produto,oferta,resultado,detalhe,corpo,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [uid(), evento || '', transacao || '', email || '', produto || '', oferta || '',
      resultado, detalhe || '', JSON.stringify(corpo ?? null).slice(0, 60000), now()]
  );
}

/** Esta transacao ja foi revertida alguma vez? Se foi, uma aprovacao que chegue
 *  depois (reenvio atrasado da Hotmart) NAO pode reabrir o acesso. */
async function jaRevertida(db, transacao) {
  if (!transacao) return false;
  const r = await db.get(
    `SELECT 1 AS x FROM hotmart_eventos
      WHERE transacao=? AND evento IN ('PURCHASE_REFUNDED','PURCHASE_CHARGEBACK') AND resultado LIKE 'acesso retirado%'
      LIMIT 1`, [transacao]);
  return !!r;
}

/** Este par transacao + evento ja foi aplicado? A Hotmart reenvia ate cinco
 *  vezes, e reenvio nao pode somar prazo de novo. */
async function jaAplicado(db, transacao, evento) {
  if (!transacao) return false;
  const r = await db.get(
    "SELECT 1 AS x FROM hotmart_eventos WHERE transacao=? AND evento=? AND resultado LIKE 'acesso%' LIMIT 1",
    [transacao, evento]);
  return !!r;
}

/** Soma o periodo comprado na conta. Mesma conta de payments.js: o prazo novo
 *  soma ao que ainda falta, e os creditos do primeiro mes entram agora. */
async function liberar(db, userId, planId, periodo, transacao) {
  const per = PERIODOS[lerPeriodo(periodo)];
  return db.tx(async (q) => {
    const plan = await q.get('SELECT * FROM plans WHERE id=? AND active=1', [planId]);
    if (!plan) throw new HttpError(500, `O plano ${planId} do mapa de ofertas nao existe no banco.`);
    const u = await q.get('SELECT credits, plano_ate FROM users WHERE id=?', [userId]);
    const ate = somarMeses(u.plano_ate, per.meses);
    const bal = Math.max(u.credits, plan.monthly_credits);
    await q.run('UPDATE users SET plan_id=?, plano_ate=?, credits=?, last_refill=? WHERE id=?',
      [plan.id, ate, bal, ym(), userId]);
    if (bal !== u.credits) {
      await q.run('INSERT INTO transactions(id,user_id,delta,balance_after,tool,note,idem_key,created_at) VALUES(?,?,?,?,?,?,?,?)', [
        uid(), userId, bal - u.credits, bal, null,
        `Plano ${plan.name} por ${per.rotulo} (Hotmart ${String(transacao).slice(0, 20)})`, null, now()
      ]);
    }
    await q.run('INSERT INTO audit(id, actor_id, actor_email, action, target, detail, created_at) VALUES(?,?,?,?,?,?,?)', [
      uid(), null, 'hotmart', 'hotmart.liberado', String(transacao || ''), `plano ${plan.id}, ${per.rotulo}`, now()
    ]);
    return { plano: plan.name, meses: per.meses, ate, creditos: plan.monthly_credits };
  });
}

/** Tira o acesso: volta para o Free e zera o prazo. Nao mexe nos creditos que
 *  a pessoa ja gastou, porque isso nao volta mesmo. */
async function revogar(db, userId, transacao, motivo) {
  await db.tx(async (q) => {
    await q.run("UPDATE users SET plan_id='free', plano_ate=NULL WHERE id=?", [userId]);
    await q.run('INSERT INTO audit(id, actor_id, actor_email, action, target, detail, created_at) VALUES(?,?,?,?,?,?,?)', [
      uid(), null, 'hotmart', 'hotmart.revogado', String(transacao || ''), motivo, now()
    ]);
  });
}

/**
 * Compra que chegou antes da conta existir.
 *
 * Quem compra na Hotmart nao tem conta no TurboCanal ainda. Em vez de criar
 * conta por conta propria no lugar da pessoa, a compra fica guardada e e
 * aplicada no primeiro acesso de quem usar aquele mesmo e-mail. Chamada de
 * auth.js: no cadastro e em cada entrada.
 */
export async function aplicarCompraPendente(db, user) {
  if (!user?.email) return user;
  let pend;
  try {
    // `cancelado_em IS NULL` nao e detalhe: sem ele, quem pediu reembolso antes
    // de ter conta ganhava o acesso ao se cadastrar depois. Foi o teste que
    // pegou.
    pend = await db.get(
      "SELECT * FROM hotmart_pendentes WHERE email=? AND aplicado_em IS NULL AND cancelado_em IS NULL ORDER BY created_at LIMIT 1",
      [String(user.email).toLowerCase()]);
  } catch {
    return user; // banco antigo, sem a tabela: nao atrapalha a entrada
  }
  if (!pend) return user;
  try {
    /* semGuarda e uma decisao escrita, nao um atalho. O motivo: esta funcao
     * roda no meio de QUALQUER requisicao autenticada, inclusive numa rota
     * /api/admin. Nessas rotas a guarda de escrita vigia plan_id e credits em
     * users, e barraria a aplicacao da compra. O resultado seria a compra nao
     * entrar calada quando a pessoa entrasse por uma tela de admin, e entrar
     * na requisicao seguinte: falha intermitente, a pior de achar. O que esta
     * escrita faz esta logo abaixo e e so isto: somar o periodo ja pago na
     * Hotmart, cuja prova (token, produto e oferta) foi conferida quando o
     * webhook gravou a pendencia. */
    const { semGuarda } = await import('./guarda.js');
    const r = await semGuarda(
      'compra da Hotmart aplicada no primeiro acesso da conta',
      ['users:plan_id', 'users:credits', 'transactions', 'audit'],
      () => liberar(db, user.id, pend.plan_id, pend.periodo, pend.transacao));
    await db.run('UPDATE hotmart_pendentes SET aplicado_em=?, user_id=? WHERE id=?', [now(), user.id, pend.id]);
    await gravar(db, {
      evento: 'PENDENTE_APLICADO', transacao: pend.transacao, email: user.email, oferta: pend.oferta,
      resultado: 'acesso liberado', detalhe: `${r.plano}, ${pend.periodo}, no primeiro acesso da conta`
    });
    try {
      const { avisos } = await import('./notify.js');
      await avisos.pagamento(db, user.id, { plano: r.plano, creditos: r.creditos, valorCentavos: pend.valor_centavos || 0, meses: r.meses, ate: r.ate });
    } catch {}
    return await db.get('SELECT * FROM users WHERE id=?', [user.id]);
  } catch (e) {
    console.error('[hotmart] compra pendente nao aplicada:', e.message);
    return user;
  }
}

export function hotmartRoutes(app, db) {
  /* A Hotmart reenvia TUDO que nao responder 2xx, e desativa a configuracao
   * sozinha se a URL der erro. Por isso: 401 so quando o token esta errado
   * (ai e bom que ela reclame, porque e configuracao errada), 503 enquanto o
   * token nao foi configurado, e 200 para todo o resto, inclusive para evento
   * que a gente ignora de proposito. Erro nosso tambem responde 200, com o
   * evento gravado: reenviar nao conserta um defeito de codigo, e enquanto nao
   * consertarmos o registro e o que permite liberar na mao. */
  app.post('/api/hotmart/webhook', async (req, res) => {
    const corpo = obj(req.body);
    const evento = texto(corpo.event).toUpperCase();
    const d = obj(corpo.data);
    const compra = obj(d.purchase);
    const transacao = texto(compra.transaction) || texto(corpo.id);
    const email = emailDoPayload(d);
    const produto = texto(obj(d.product).id);
    const oferta = ofertaDoPayload(d);
    const base = { evento, transacao, email, produto, oferta, corpo };

    try {
      const esperado = await hottokConfigurado(db);
      if (!esperado) {
        console.error('[hotmart] chamada recebida sem o hottok configurado no site');
        return res.status(503).json({ erro: 'Integração da Hotmart ainda não configurada neste site.' });
      }
      if (!tokenIgual(req.get('x-hotmart-hottok'), esperado)) {
        console.error('[hotmart] token invalido numa chamada ao webhook');
        return res.status(401).json({ erro: 'Token inválido.' });
      }

      const produtoEsperado = texto(await getSetting(db, 'hotmart_product_id'));
      if (!produtoEsperado) {
        await gravar(db, { ...base, resultado: 'nao liberado: produto nao configurado', detalhe: 'falta o ID do produto em Admin > Hotmart' });
        await avisarDono(db, 'Venda da Hotmart chegou sem o produto configurado',
          `Evento ${evento} de ${email || 'e-mail nao informado'}. Preencha o ID do produto em Admin > Hotmart para o acesso sair sozinho.`);
        return res.status(200).json({ ok: true, acao: 'registrado' });
      }
      if (produto && produto !== produtoEsperado) {
        await gravar(db, { ...base, resultado: 'ignorado: outro produto', detalhe: `chegou ${produto}, esperado ${produtoEsperado}` });
        return res.status(200).json({ ok: true, acao: 'ignorado' });
      }

      if (!LIBERA.has(evento) && !REVOGA.has(evento)) {
        await gravar(db, { ...base, resultado: 'registrado: evento sem acao', detalhe: 'este evento nao mexe no acesso' });
        return res.status(200).json({ ok: true, acao: 'registrado' });
      }

      if (!email) {
        await gravar(db, { ...base, resultado: 'nao liberado: payload sem e-mail', detalhe: 'nem data.buyer.email nem data.subscriber.email' });
        await avisarDono(db, 'Venda da Hotmart sem e-mail no aviso',
          `O evento ${evento} da transacao ${transacao} chegou sem e-mail. Veja o conteudo em Admin > Hotmart.`);
        return res.status(200).json({ ok: true, acao: 'registrado' });
      }

      const conta = await db.get('SELECT * FROM users WHERE lower(email)=?', [email]);

      if (REVOGA.has(evento)) {
        const motivo = evento === 'PURCHASE_REFUNDED' ? 'reembolso na Hotmart' : 'chargeback na Hotmart';
        if (!conta) {
          await db.run('UPDATE hotmart_pendentes SET cancelado_em=? WHERE email=? AND aplicado_em IS NULL', [now(), email]);
          await gravar(db, { ...base, resultado: 'acesso retirado: compra pendente cancelada', detalhe: motivo });
          return res.status(200).json({ ok: true, acao: 'revogado' });
        }
        await revogar(db, conta.id, transacao, motivo);
        await gravar(db, { ...base, resultado: 'acesso retirado', detalhe: motivo });
        await avisarDono(db, 'Acesso retirado por ' + motivo, `${email} voltou para o plano Free. Transacao ${transacao}.`);
        return res.status(200).json({ ok: true, acao: 'revogado' });
      }

      // Daqui para baixo e liberacao.
      if (await jaAplicado(db, transacao, evento)) {
        await gravar(db, { ...base, resultado: 'ignorado: reenvio', detalhe: 'esta transacao e este evento ja foram aplicados' });
        return res.status(200).json({ ok: true, acao: 'repetido' });
      }
      if (await jaRevertida(db, transacao)) {
        await gravar(db, { ...base, resultado: 'nao liberado: transacao ja revertida', detalhe: 'aprovacao atrasada depois de reembolso ou chargeback' });
        return res.status(200).json({ ok: true, acao: 'recusado' });
      }

      const mapa = await mapaDeOfertas(db);
      const destino = obj(mapa[oferta]);
      const planId = texto(destino.plan);
      const periodo = texto(destino.periodo);
      if (!oferta || !planId || !PERIODOS[periodo]?.aVenda) {
        await gravar(db, { ...base, resultado: 'nao liberado: oferta desconhecida', detalhe: `oferta "${oferta}" nao esta no mapa de ofertas` });
        await avisarDono(db, 'Venda da Hotmart com oferta que o site nao conhece',
          `${email} comprou a oferta "${oferta}" e o acesso NAO foi liberado, porque o site nao sabe qual plano e qual periodo ela vale. ` +
          'Cadastre essa oferta em Admin > Hotmart e depois reenvie o aviso pelo painel da Hotmart, ou libere na mao.');
        return res.status(200).json({ ok: true, acao: 'registrado' });
      }

      if (!conta) {
        await db.run(
          `INSERT INTO hotmart_pendentes(id,email,plan_id,periodo,oferta,transacao,valor_centavos,created_at)
           VALUES(?,?,?,?,?,?,?,?)`,
          [uid(), email, planId, periodo, oferta, transacao,
            Math.round(Number(obj(compra.price).value || 0) * 100) || 0, now()]);
        await gravar(db, { ...base, resultado: 'guardado: conta ainda nao existe', detalhe: `${planId} por ${periodo}, aplica no primeiro acesso` });
        await avisarDono(db, 'Venda da Hotmart guardada: a conta ainda nao existe',
          `${email} comprou ${planId} por ${PERIODOS[periodo].rotulo}. O acesso entra sozinho quando essa pessoa entrar no site com esse e-mail.`);
        return res.status(200).json({ ok: true, acao: 'pendente' });
      }

      const r = await liberar(db, conta.id, planId, periodo, transacao);
      await gravar(db, { ...base, resultado: 'acesso liberado', detalhe: `${r.plano}, ${PERIODOS[periodo].rotulo}` });
      try {
        const { avisos } = await import('./notify.js');
        await avisos.pagamento(db, conta.id, {
          plano: r.plano, creditos: r.creditos, meses: r.meses, ate: r.ate,
          valorCentavos: Math.round(Number(obj(compra.price).value || 0) * 100) || 0
        });
      } catch {}
      return res.status(200).json({ ok: true, acao: 'liberado' });
    } catch (e) {
      console.error('[hotmart] erro ao tratar o webhook:', e.stack || e.message);
      try {
        await gravar(db, { ...base, resultado: 'erro ao processar', detalhe: String(e.message || e).slice(0, 400) });
        await avisarDono(db, 'Erro ao processar uma venda da Hotmart',
          `Evento ${evento} de ${email || 'sem e-mail'}: ${String(e.message || e).slice(0, 200)}. O conteudo esta gravado em Admin > Hotmart.`);
      } catch {}
      return res.status(200).json({ ok: true, acao: 'registrado com erro' });
    }
  });
}
