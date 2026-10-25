// O webhook da Hotmart: quem entra, quem nao entra, e o que NUNCA libera acesso.
//
// Este arquivo existe porque o formato do aviso da Hotmart foi levantado de
// implementacoes de terceiros, nao da documentacao oficial (que bloqueia o
// acesso daqui). Um mapeamento levantado assim pode estar errado em algum
// campo, e o jeito de isso nao custar dinheiro e garantir por teste que, em
// toda duvida, o acesso NAO sai: sem token, sem produto, sem oferta conhecida,
// sem e-mail, ou com a transacao ja revertida, nada e liberado.
delete process.env.DATABASE_URL; delete process.env.HOTMART_HOTTOK;
process.env.PASSWORD_LOGIN = '1'; process.env.YT_MOCK = '1';
process.env.OWNER_EMAIL = 'dono@example.com';
import { randomUUID } from 'node:crypto';
const S = '/home/claude/turbocanal/server';
const { buildApp } = await import(S + '/src/app.js');
const { setSetting } = await import(S + '/src/db.js');
const { app, db } = await buildApp({ databaseUrl: undefined, dataDir: ':memory:', scheduler: false });
const srv = app.listen(0); await new Promise((r) => srv.on('listening', r));
const base = `http://127.0.0.1:${srv.address().port}`;

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU  ' + n); } else { fail++; console.log('  FALHOU  ' + n + ' ' + x); } };

const TOKEN = 'hottok-de-mentira-1234567890';
const PRODUTO = '1234567';

/** Monta um aviso no formato 2.0.0, do jeito que as implementacoes reais mostram. */
function aviso(evento, { email = 'cliente@example.com', oferta = 'OFMES', transacao = 'HP' + randomUUID(), produto = PRODUTO, status = 'APPROVED', valor = 9.99 } = {}) {
  return {
    id: randomUUID(), creation_date: Date.now(), event: evento, version: '2.0.0',
    data: {
      product: { id: Number(produto), ucode: 'abc', name: 'TurboCanal' },
      buyer: { email, name: 'Cliente Teste' },
      purchase: { transaction: transacao, status, offer: { code: oferta }, price: { value: valor, currency_value: 'BRL' } }
    }
  };
}
const chamar = async (corpo, token = TOKEN) => {
  const h = { 'Content-Type': 'application/json' };
  if (token !== null) h['X-HOTMART-HOTTOK'] = token;
  const r = await fetch(base + '/api/hotmart/webhook', { method: 'POST', headers: h, body: JSON.stringify(corpo) });
  let d = {}; try { d = await r.json(); } catch {}
  return { s: r.status, d };
};
const conta = async (email) => db.get('SELECT * FROM users WHERE lower(email)=?', [email.toLowerCase()]);
const eventos = () => db.all('SELECT * FROM hotmart_eventos ORDER BY created_at');
const registrar = async (email) => {
  const r = await fetch(base + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'senha-boa-123456', name: 'Cliente' })
  });
  return r.status;
};
const criaUsuario = async (email) => {
  const id = randomUUID();
  await db.run('INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,last_refill,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [id, email, null, 'Cliente', 'user', 'free', 0, '2099-12', new Date().toISOString()]);
  return id;
};
const meses = (ate) => (ate ? Math.round((new Date(ate) - Date.now()) / 86400000 / 30.4) : 0);

// notificarDono avisa quem tem role 'owner'. Sem um dono no banco, o aviso
// nao tem destinatario e o teste do aviso nao provaria nada.
await db.run('INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,last_refill,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
  [randomUUID(), 'dono@example.com', null, 'Dono', 'owner', 'free', 0, '2099-12', new Date().toISOString()]);

console.log('\n== Sem o token configurado no site, o webhook nao aceita nada ==');
{
  const r = await chamar(aviso('PURCHASE_APPROVED'));
  check('responde 503 enquanto o hottok nao foi configurado', r.s === 503, String(r.s));
  check('nao gravou evento nenhum', (await eventos()).length === 0);
}

await setSetting(db, 'hotmart_hottok', TOKEN);

console.log('\n== O token errado nao passa, e nao grava nada ==');
for (const [rotulo, tk] of [['token errado', 'token-errado'], ['sem cabecalho', null], ['token vazio', ''], ['prefixo do certo', TOKEN.slice(0, 10)]]) {
  const r = await chamar(aviso('PURCHASE_APPROVED'), tk);
  check(`${rotulo}: responde 401`, r.s === 401, String(r.s));
}
check('nenhuma dessas tentativas gravou evento', (await eventos()).length === 0);

console.log('\n== Token certo, mas o produto ainda nao foi configurado: grava e NAO libera ==');
{
  const id = await criaUsuario('cliente@example.com');
  const r = await chamar(aviso('PURCHASE_APPROVED'));
  check('responde 200 (senao a Hotmart reenvia para sempre)', r.s === 200, String(r.s));
  const ev = await eventos();
  check('gravou o evento com o motivo', ev.length === 1 && /produto nao configurado/.test(ev[0].resultado), ev[0]?.resultado);
  check('guardou o corpo inteiro do aviso', !!ev[0]?.corpo && JSON.parse(ev[0].corpo)?.data?.buyer?.email === 'cliente@example.com');
  const u = await db.get('SELECT plan_id, plano_ate FROM users WHERE id=?', [id]);
  check('NAO liberou plano nenhum', u.plan_id === 'free' && !u.plano_ate, `${u.plan_id} ${u.plano_ate}`);
}

await setSetting(db, 'hotmart_product_id', PRODUTO);

console.log('\n== Produto de outro vendedor na mesma conta Hotmart: ignora ==');
{
  const r = await chamar(aviso('PURCHASE_APPROVED', { produto: '9999999' }));
  check('responde 200 e marca como ignorado', r.s === 200 && r.d.acao === 'ignorado', JSON.stringify(r.d));
  const u = await conta('cliente@example.com');
  check('nao liberou nada para a conta', u.plan_id === 'free' && !u.plano_ate, `${u.plan_id} ${u.plano_ate}`);
}

console.log('\n== Oferta que o site nao conhece: grava, avisa e NAO libera ==');
{
  const r = await chamar(aviso('PURCHASE_APPROVED', { oferta: 'OFERTA-QUE-NAO-EXISTE' }));
  check('responde 200', r.s === 200, String(r.s));
  const ev = (await eventos()).at(-1);
  check('o motivo gravado e a oferta desconhecida', /oferta desconhecida/.test(ev.resultado), ev.resultado);
  const u = await conta('cliente@example.com');
  check('NAO liberou plano por uma oferta desconhecida', u.plan_id === 'free' && !u.plano_ate, `${u.plan_id} ${u.plano_ate}`);
  const recado = await db.get("SELECT * FROM notificacoes WHERE titulo LIKE '%oferta que o site nao conhece%' LIMIT 1");
  check('o dono foi avisado do acesso que nao saiu', !!recado, 'sem aviso');
}

await setSetting(db, 'hotmart_ofertas', JSON.stringify({
  OFMES: { plan: 'p10', periodo: '1m' },
  OFANO: { plan: 'p10', periodo: '12m' }
}));

console.log('\n== Compra aprovada de verdade: libera o plano e o prazo ==');
let transMes;
{
  transMes = 'HP-1M-' + randomUUID();
  const r = await chamar(aviso('PURCHASE_APPROVED', { transacao: transMes }));
  check('responde 200 e diz que liberou', r.s === 200 && r.d.acao === 'liberado', JSON.stringify(r.d));
  const u = await conta('cliente@example.com');
  check('o plano virou Starter', u.plan_id === 'p10', String(u.plan_id));
  check('o prazo ficou em 1 mes', meses(u.plano_ate) === 1, `${u.plano_ate} (${meses(u.plano_ate)} meses)`);
  const plan = await db.get("SELECT monthly_credits FROM plans WHERE id='p10'");
  check('os creditos do primeiro mes entraram', u.credits >= plan.monthly_credits, `${u.credits} de ${plan.monthly_credits}`);
}

console.log('\n== Oferta mapeada para periodo que nao esta a venda nao libera ==');
{
  // Se o mapa de ofertas aponta para um periodo retirado de venda ('2m'), isso
  // e configuracao velha, nao autorizacao: o acesso NAO sai.
  const mapaAntes = await db.get("SELECT value FROM settings WHERE key='hotmart_ofertas'");
  await setSetting(db, 'hotmart_ofertas', JSON.stringify({ OFVELHA: { plan: 'p10', periodo: '2m' } }));
  const id = await criaUsuario('velha@example.com');
  const r = await chamar(aviso('PURCHASE_APPROVED', { email: 'velha@example.com', oferta: 'OFVELHA' }));
  const u = await db.get('SELECT plan_id, plano_ate FROM users WHERE id=?', [id]);
  check('periodo fora de venda no mapa nao libera acesso',
    r.s === 200 && u.plan_id === 'free' && !u.plano_ate, `${r.s} ${u.plan_id} ${u.plano_ate}`);
  await setSetting(db, 'hotmart_ofertas', mapaAntes.value);
}

console.log('\n== Reenvio da Hotmart nao soma prazo duas vezes ==');
{
  const antes = (await conta('cliente@example.com')).plano_ate;
  const r = await chamar(aviso('PURCHASE_APPROVED', { transacao: transMes }));
  check('o reenvio e reconhecido como repetido', r.s === 200 && r.d.acao === 'repetido', JSON.stringify(r.d));
  const depois = (await conta('cliente@example.com')).plano_ate;
  check('o prazo nao mudou no reenvio', antes === depois, `${antes} -> ${depois}`);
}

console.log('\n== A oferta anual vale 12 meses, nao 2 ==');
{
  const id = await criaUsuario('anual@example.com');
  await chamar(aviso('PURCHASE_APPROVED', { email: 'anual@example.com', oferta: 'OFANO', valor: 99 }));
  const u = await db.get('SELECT plan_id, plano_ate FROM users WHERE id=?', [id]);
  check('o prazo ficou em 12 meses', u.plan_id === 'p10' && meses(u.plano_ate) === 12, `${u.plan_id} ${u.plano_ate} (${meses(u.plano_ate)} meses)`);
}

console.log('\n== PURCHASE_COMPLETE tambem libera ==');
{
  const id = await criaUsuario('completa@example.com');
  const r = await chamar(aviso('PURCHASE_COMPLETE', { email: 'completa@example.com' }));
  const u = await db.get('SELECT plan_id FROM users WHERE id=?', [id]);
  check('compra completa libera o plano', r.d.acao === 'liberado' && u.plan_id === 'p10', `${r.d.acao} ${u.plan_id}`);
}

console.log('\n== Decide pelo EVENTO, nunca pelo data.purchase.status ==');
{
  // A pegadinha documentada: reembolso chega com status 'APPROVED', porque
  // aquele campo e o status da COMPRA e nao o do evento.
  const id = await criaUsuario('reembolso@example.com');
  await chamar(aviso('PURCHASE_APPROVED', { email: 'reembolso@example.com', transacao: 'HP-REEMB-1' }));
  const antes = await db.get('SELECT plan_id FROM users WHERE id=?', [id]);
  check('primeiro a compra liberou', antes.plan_id === 'p10', String(antes.plan_id));
  const r = await chamar(aviso('PURCHASE_REFUNDED', { email: 'reembolso@example.com', transacao: 'HP-REEMB-1', status: 'APPROVED' }));
  const u = await db.get('SELECT plan_id, plano_ate FROM users WHERE id=?', [id]);
  check('reembolso com status APPROVED tira o acesso, nao libera', r.d.acao === 'revogado' && u.plan_id === 'free' && !u.plano_ate,
    `${r.d.acao} ${u.plan_id} ${u.plano_ate}`);
}

console.log('\n== Chargeback tambem tira o acesso ==');
{
  const id = await criaUsuario('charge@example.com');
  await chamar(aviso('PURCHASE_APPROVED', { email: 'charge@example.com', transacao: 'HP-CB-1' }));
  await chamar(aviso('PURCHASE_CHARGEBACK', { email: 'charge@example.com', transacao: 'HP-CB-1' }));
  const u = await db.get('SELECT plan_id FROM users WHERE id=?', [id]);
  check('chargeback volta a conta para o Free', u.plan_id === 'free', String(u.plan_id));
}

console.log('\n== Aprovacao atrasada depois do reembolso NAO reabre o acesso ==');
{
  const r = await chamar(aviso('PURCHASE_APPROVED', { email: 'reembolso@example.com', transacao: 'HP-REEMB-1' }));
  const u = await conta('reembolso@example.com');
  check('a transacao revertida e recusada', r.d.acao === 'recusado' || r.d.acao === 'repetido', JSON.stringify(r.d));
  check('a conta continua no Free', u.plan_id === 'free' && !u.plano_ate, `${u.plan_id} ${u.plano_ate}`);
}

console.log('\n== Aviso sem e-mail: grava e nao libera ==');
{
  const corpo = aviso('PURCHASE_APPROVED');
  delete corpo.data.buyer;
  const r = await chamar(corpo);
  check('responde 200', r.s === 200, String(r.s));
  const ev = (await eventos()).at(-1);
  check('o motivo gravado e a falta de e-mail', /sem e-mail/.test(ev.resultado), ev.resultado);
}

console.log('\n== Assinante em vez de comprador: usa data.subscriber.email ==');
{
  const id = await criaUsuario('assinante@example.com');
  const corpo = aviso('PURCHASE_APPROVED', { transacao: 'HP-SUB-1' });
  delete corpo.data.buyer;
  corpo.data.subscriber = { email: 'assinante@example.com', name: 'Assinante' };
  await chamar(corpo);
  const u = await db.get('SELECT plan_id FROM users WHERE id=?', [id]);
  check('liberou pelo e-mail do assinante', u.plan_id === 'p10', String(u.plan_id));
}

console.log('\n== Eventos que nao mexem no acesso ==');
for (const evento of ['SUBSCRIPTION_CANCELLATION', 'PURCHASE_CANCELED', 'PURCHASE_EXPIRED', 'PURCHASE_BILLET_PRINTED', 'PURCHASE_DELAYED', 'PURCHASE_PROTEST', 'SWITCH_PLAN', 'ORDER_FULFILLMENT', 'CLUB_FIRST_ACCESS']) {
  const id = await criaUsuario(`ev-${evento.toLowerCase()}@example.com`);
  const r = await chamar(aviso(evento, { email: `ev-${evento.toLowerCase()}@example.com` }));
  const u = await db.get('SELECT plan_id, plano_ate FROM users WHERE id=?', [id]);
  check(`${evento}: grava e nao mexe no acesso`, r.s === 200 && u.plan_id === 'free' && !u.plano_ate, `${r.s} ${u.plan_id} ${u.plano_ate}`);
}

console.log('\n== Compra que chega ANTES da conta existir ==');
{
  const r = await chamar(aviso('PURCHASE_APPROVED', { email: 'novo@example.com', oferta: 'OFANO', transacao: 'HP-PEND-1', valor: 99 }));
  check('fica guardada como pendente', r.s === 200 && r.d.acao === 'pendente', JSON.stringify(r.d));
  const p = await db.get("SELECT * FROM hotmart_pendentes WHERE email='novo@example.com'");
  check('a pendencia guarda plano e periodo', p?.plan_id === 'p10' && p?.periodo === '12m', `${p?.plan_id} ${p?.periodo}`);
  check('ninguem foi criado no lugar da pessoa', !(await conta('novo@example.com')), 'criou conta sozinho');

  const st = await registrar('novo@example.com');
  check('a pessoa se cadastra normalmente', st === 200 || st === 201, String(st));
  const u = await conta('novo@example.com');
  check('no cadastro, a compra entra sozinha', u?.plan_id === 'p10' && meses(u.plano_ate) === 12, `${u?.plan_id} ${u?.plano_ate}`);
  const p2 = await db.get("SELECT * FROM hotmart_pendentes WHERE email='novo@example.com'");
  check('a pendencia fica marcada como aplicada', !!p2?.aplicado_em, String(p2?.aplicado_em));
}

console.log('\n== A compra entra mesmo quando a pessoa chega por uma tela de admin ==');
{
  // A guarda de escrita (guarda.js, linha do middleware) vigia plan_id e
  // credits em users quando a requisicao e de uma rota /api/admin que NAO e
  // GET. A aplicacao da compra pendente roda no meio de QUALQUER requisicao
  // autenticada, inclusive dessas: sem a decisao escrita de semGuarda em
  // hotmart.js, a compra nao entrava nessa requisicao e entrava na seguinte,
  // que e falha intermitente, a pior de achar.
  // CUIDADO ao mexer aqui: com um GET este teste passa dos dois jeitos e nao
  // prova nada, porque GET em rota de admin nao e vigiado. Tem de ser escrita.
  const { signToken } = await import(S + '/src/auth.js');
  const id = randomUUID();
  await db.run('INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,last_refill,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [id, 'adm-hotmart@example.com', null, 'Admin', 'admin', 'free', 0, '2099-12', new Date().toISOString()]);
  await db.run(
    'INSERT INTO hotmart_pendentes(id,email,plan_id,periodo,oferta,transacao,valor_centavos,created_at) VALUES(?,?,?,?,?,?,?,?)',
    [randomUUID(), 'adm-hotmart@example.com', 'p10', '12m', 'OFANO', 'HP-ADM-1', 5400, new Date().toISOString()]);
  const tk = await signToken(db, id);
  const alvo = randomUUID();
  await db.run('INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,last_refill,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [alvo, 'alvo-adm@example.com', null, 'Alvo', 'user', 'free', 0, '2099-12', new Date().toISOString()]);
  const r = await fetch(base + `/api/admin/users/${alvo}/credits`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
    body: JSON.stringify({ delta: 10, motivo: 'teste' })
  });
  check('a rota de admin que escreve responde sem erro de servidor', r.status < 500, String(r.status));
  const u = await db.get('SELECT plan_id, plano_ate FROM users WHERE id=?', [id]);
  check('a compra pendente entrou numa requisicao de ESCRITA em rota administrativa',
    u.plan_id === 'p10' && meses(u.plano_ate) === 12, `${u.plan_id} ${u.plano_ate}`);
}

console.log('\n== Reembolso de uma compra que nunca virou conta ==');
{
  await chamar(aviso('PURCHASE_APPROVED', { email: 'desistiu@example.com', transacao: 'HP-DES-1' }));
  const r = await chamar(aviso('PURCHASE_REFUNDED', { email: 'desistiu@example.com', transacao: 'HP-DES-1' }));
  check('a pendencia e cancelada', r.d.acao === 'revogado', JSON.stringify(r.d));
  await registrar('desistiu@example.com');
  const u = await conta('desistiu@example.com');
  check('quem pediu reembolso nao ganha acesso ao se cadastrar', u?.plan_id === 'free' && !u?.plano_ate, `${u?.plan_id} ${u?.plano_ate}`);
}

console.log('\n== Corpo estranho nao derruba o servidor ==');
for (const [rotulo, corpo] of [
  ['vazio', {}], ['sem data', { event: 'PURCHASE_APPROVED' }], ['data nulo', { event: 'PURCHASE_APPROVED', data: null }],
  ['data texto', { event: 'PURCHASE_APPROVED', data: 'xx' }], ['evento nulo', { event: null, data: {} }],
  ['evento numero', { event: 7, data: {} }], ['buyer texto', { event: 'PURCHASE_APPROVED', data: { buyer: 'x', product: { id: PRODUTO } } }],
  ['array', []], ['aninhado fundo', { event: 'PURCHASE_APPROVED', data: { purchase: { offer: { code: { a: 1 } } }, product: { id: PRODUTO } } }]
]) {
  const r = await chamar(corpo);
  check(`corpo ${rotulo}: responde 200 ou 401, nunca 500`, r.s === 200 || r.s === 401, String(r.s));
}

console.log('\n== Os botoes de compra do site apontam para a Hotmart ==');
{
  // A venda passou a ser so pela Hotmart. O site nao tem checkout proprio na
  // tela, entao o botao precisa do endereco da oferta. Sem endereco, o cartao
  // do plano nao pode mostrar botao nenhum: um botao que nao leva a lugar
  // nenhum e pior que nenhum botao.
  const mapaAntes = await db.get("SELECT value FROM settings WHERE key='hotmart_ofertas'");

  const planos = async () => (await (await fetch(base + '/api/plans')).json()).items;

  await setSetting(db, 'hotmart_ofertas', JSON.stringify({ OFMES: { plan: 'p10', periodo: '1m' } }));
  let p10 = (await planos()).find((x) => x.id === 'p10');
  check('oferta sem endereco nao vira botao', !p10.compra_1m && !p10.compra_12m, `${p10.compra_1m} ${p10.compra_12m}`);

  await setSetting(db, 'hotmart_ofertas', JSON.stringify({
    OFMES: { plan: 'p10', periodo: '1m', url: 'https://pay.hotmart.com/MES' },
    OFANO: { plan: 'p10', periodo: '12m', url: 'https://pay.hotmart.com/ANO' }
  }));
  p10 = (await planos()).find((x) => x.id === 'p10');
  check('com endereco, o plano traz os dois links',
    p10.compra_1m === 'https://pay.hotmart.com/MES' && p10.compra_12m === 'https://pay.hotmart.com/ANO',
    `${p10.compra_1m} ${p10.compra_12m}`);
  const outro = (await planos()).find((x) => x.id === 'p20');
  check('plano sem oferta cadastrada continua sem link', !outro.compra_1m && !outro.compra_12m);

  // Endereco torto nao pode virar botao.
  for (const [rotulo, url] of [['http sem s', 'http://pay.hotmart.com/X'], ['texto solto', 'clique aqui'],
    ['javascript:', 'javascript:alert(1)'], ['vazio', ''], ['numero', 42]]) {
    await setSetting(db, 'hotmart_ofertas', JSON.stringify({ OFX: { plan: 'p40', periodo: '1m', url } }));
    const p40 = (await planos()).find((x) => x.id === 'p40');
    check(`endereco ${rotulo} nao vira botao`, !p40.compra_1m, String(p40.compra_1m));
  }

  // Periodo fora de venda tambem nao gera botao.
  await setSetting(db, 'hotmart_ofertas', JSON.stringify({ OFV: { plan: 'p40', periodo: '2m', url: 'https://pay.hotmart.com/V' } }));
  const p40 = (await planos()).find((x) => x.id === 'p40');
  check('periodo fora de venda nao gera botao', !p40.compra_1m && !p40.compra_12m);

  await setSetting(db, 'hotmart_ofertas', mapaAntes.value);
}

console.log('\n== O token nunca sai do servidor ==');
{
  const r = await fetch(base + '/api/settings/public');
  const txt = await r.text();
  check('a configuracao publica nao mostra o hottok', !txt.includes(TOKEN), txt.slice(0, 200));
}

console.log(`\nRESULTADO hotmart-test: ${pass} passaram, ${fail} falharam`);
srv.close();
process.exit(fail ? 1 : 0);
