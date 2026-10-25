// A rota que CRIA o pagamento, exercitada de verdade.
//
// Por que este arquivo existe: a rota /api/payments/create usava a variavel
// `periodo` sem nunca declarar, e toda tentativa de pagar morria num
// ReferenceError que o tratador de erro escondia como 500. Nenhum dos 35
// arquivos de teste pegou isso, porque todos rodam sem o provedor configurado:
// a rota barrava antes, no 409 de "pagamentos nao ativados", e nunca chegava na
// linha quebrada. O teste que faltava era este: com o provedor LIGADO.
delete process.env.DATABASE_URL; process.env.PASSWORD_LOGIN = '1'; process.env.YT_MOCK = '1';
process.env.OWNER_EMAIL = 'dono@example.com';
import { randomUUID } from 'node:crypto';
const S = '/home/claude/turbocanal/server';

// Mercado Pago de mentira: responde no lugar da api.mercadopago.com e deixa
// passar tudo o mais (inclusive as chamadas do proprio teste ao 127.0.0.1).
const fetchReal = globalThis.fetch;
let chamadasMP = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.startsWith('https://api.mercadopago.com')) return fetchReal(url, opts);
  const corpo = opts?.body ? JSON.parse(opts.body) : null;
  chamadasMP.push({ url: u, corpo });
  return new Response(JSON.stringify({
    id: 987654321, status: 'pending', status_detail: 'pending_waiting_transfer',
    external_reference: corpo?.external_reference || null,
    point_of_interaction: { transaction_data: { qr_code: 'PIX-DE-MENTIRA', qr_code_base64: 'AAAA', ticket_url: 'https://exemplo/ticket' } }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const { buildApp } = await import(S + '/src/app.js');
const { setSetting } = await import(S + '/src/db.js');
const { signToken } = await import(S + '/src/auth.js');
const { app, db } = await buildApp({ databaseUrl: undefined, dataDir: ':memory:', scheduler: false });
const srv = app.listen(0); await new Promise((r) => srv.on('listening', r));
const base = `http://127.0.0.1:${srv.address().port}`;

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU  ' + n); } else { fail++; console.log('  FALHOU  ' + n + ' ' + x); } };
const reais = (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',');

const id = randomUUID();
await db.run('INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,last_refill,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
  [id, 'paga@example.com', null, 'Paga', 'user', 'free', 0, '2099-12', new Date().toISOString()]);
const tk = await signToken(db, id);

const criar = async (body) => {
  const r = await fetchReal(base + '/api/payments/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
    body: JSON.stringify(body)
  });
  let d = {}; try { d = await r.json(); } catch {}
  return { s: r.status, d };
};

console.log('\n== Sem o provedor configurado, a rota recusa e NAO simula cobranca ==');
{
  const r = await criar({ plan_id: 'p10', periodo: '2m' });
  check('recusa com 409 enquanto o Access Token nao existe', r.s === 409, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);
  check('nao gravou pagamento nenhum', (await db.all('SELECT * FROM payments')).length === 0);
}

// Agora LIGA o provedor: e daqui para baixo que o erro vivia escondido.
await setSetting(db, 'mp_access_token', 'TEST-token-de-mentira');
await setSetting(db, 'payments_enabled', '1');

console.log('\n== Com o provedor ligado: a rota precisa RESPONDER, nao dar 500 ==');
{
  chamadasMP = [];
  const r = await criar({ plan_id: 'p10', periodo: '2m' });
  check('criar pagamento de 2 meses responde 200 (era 500 com a variavel faltando)', r.s === 200, `${r.s} ${JSON.stringify(r.d).slice(0, 200)}`);
  check('devolveu o pagamento com o Pix do provedor', r.d?.payment?.pix?.qr_code === 'PIX-DE-MENTIRA', JSON.stringify(r.d).slice(0, 150));
  check('o Starter de 2 meses cobra R$ 10,00', r.d?.payment?.amount_cents === 1000, reais(r.d?.payment?.amount_cents));
  check('o periodo gravado e 2m', r.d?.payment?.periodo === '2m', String(r.d?.payment?.periodo));
  check('o rotulo que a pessoa ve diz 2 meses', r.d?.payment?.periodo_rotulo === '2 meses', String(r.d?.payment?.periodo_rotulo));
  check('falou com o Mercado Pago uma vez', chamadasMP.length === 1, String(chamadasMP.length));
  check('mandou o valor certo em reais para o provedor', chamadasMP[0]?.corpo?.transaction_amount === 10, String(chamadasMP[0]?.corpo?.transaction_amount));
  check('a descricao no extrato nao promete mensalidade que nao existe',
    /2 meses/.test(chamadasMP[0]?.corpo?.description || '') && !/mensal/i.test(chamadasMP[0]?.corpo?.description || ''),
    String(chamadasMP[0]?.corpo?.description));
}

console.log('\n== O anual: 6 pagamentos com 10% de desconto ==');
{
  chamadasMP = [];
  const r = await criar({ plan_id: 'p10', periodo: '12m' });
  check('criar pagamento anual responde 200', r.s === 200, `${r.s} ${JSON.stringify(r.d).slice(0, 200)}`);
  check('o Starter anual cobra R$ 54,00', r.d?.payment?.amount_cents === 5400, reais(r.d?.payment?.amount_cents));
  check('o periodo gravado e 12m', r.d?.payment?.periodo === '12m', String(r.d?.payment?.periodo));
  check('o rotulo que a pessoa ve diz 1 ano', r.d?.payment?.periodo_rotulo === '1 ano', String(r.d?.payment?.periodo_rotulo));
  check('mandou R$ 54 para o provedor, nao R$ 60', chamadasMP[0]?.corpo?.transaction_amount === 54, String(chamadasMP[0]?.corpo?.transaction_amount));
}

console.log('\n== Periodo invalido nao quebra e nao cobra a esmo ==');
for (const [rotulo, valor] of [['ausente', undefined], ['nulo', null], ['inventado', 'banana'], ['numero', 12], ['objeto', { a: 1 }]]) {
  chamadasMP = [];
  const r = await criar({ plan_id: 'p10', ...(valor === undefined ? {} : { periodo: valor }) });
  check(`periodo ${rotulo}: responde 200 e cai nos 2 meses`,
    r.s === 200 && r.d?.payment?.periodo === '2m' && r.d?.payment?.amount_cents === 1000,
    `${r.s} ${r.d?.payment?.periodo} ${reais(r.d?.payment?.amount_cents)}`);
  check(`periodo ${rotulo}: nao cobrou valor estranho do provedor`, chamadasMP[0]?.corpo?.transaction_amount === 10, String(chamadasMP[0]?.corpo?.transaction_amount));
}

console.log('\n== Todos os planos pagos passam pela rota de verdade ==');
for (const [plano, esperado2m, esperadoAno] of [['p10', 1000, 5400], ['p20', 2000, 10800], ['p40', 4000, 21600], ['p70', 7000, 37800], ['p100', 10000, 54000]]) {
  const a = await criar({ plan_id: plano, periodo: '2m' });
  const b = await criar({ plan_id: plano, periodo: '12m' });
  check(`${plano}: 2 meses = ${reais(esperado2m)} e 1 ano = ${reais(esperadoAno)}`,
    a.s === 200 && a.d?.payment?.amount_cents === esperado2m && b.s === 200 && b.d?.payment?.amount_cents === esperadoAno,
    `${a.s}/${a.d?.payment?.amount_cents} ${b.s}/${b.d?.payment?.amount_cents}`);
}

console.log('\n== O que a rota tem que continuar recusando ==');
{
  const r = await criar({ plan_id: 'free', periodo: '2m' });
  check('o plano Free nao gera cobranca', r.s === 400, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);
  const r2 = await criar({ plan_id: 'nao-existe', periodo: '2m' });
  check('plano inexistente da 404', r2.s === 404, String(r2.s));
  const r3 = await fetchReal(base + '/api/payments/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_id: 'p10' }) });
  check('sem estar logado nao cria pagamento', r3.status === 401, String(r3.status));
}

console.log('\n== Nenhum pagamento nasce aprovado ==');
{
  const todos = await db.all('SELECT * FROM payments');
  check('todo pagamento criado comeca pendente, nunca aprovado',
    todos.length > 0 && todos.every((p) => p.status === 'pending'),
    todos.map((p) => p.status).join(','));
  const u = await db.get('SELECT plan_id, plano_ate, credits FROM users WHERE id=?', [id]);
  const free = await db.get("SELECT monthly_credits FROM plans WHERE id='free'");
  const p10 = await db.get("SELECT monthly_credits FROM plans WHERE id='p10'");
  check('criar pagamento NAO libera o plano antes de pagar',
    u.plan_id === 'free' && !u.plano_ate, `${u.plan_id} ${u.plano_ate}`);
  // A conta fica com os creditos do plano gratuito (a recarga mensal do Free, que
  // e esperada); o que NAO pode acontecer e receber os creditos do plano pago.
  check('criar pagamento NAO entrega os creditos do plano pago',
    u.credits <= free.monthly_credits && u.credits < p10.monthly_credits,
    `${u.credits} (free ${free.monthly_credits}, p10 ${p10.monthly_credits})`);
}

console.log(`\nRESULTADO pagar-test: ${pass} passaram, ${fail} falharam`);
srv.close();
process.exit(fail ? 1 : 0);
