// A fila de aprovação cobre TUDO?
//
// Este arquivo existe por causa de um buraco real: avisos e cards, pagamentos,
// planos, preços e configurações ficaram de fora da fila, e um administrador
// não principal conseguia executar tudo isso sozinho.
//
// Parte 1 é um CENSO: ele lê as rotas que o servidor realmente registrou e
// reprova se existir qualquer rota administrativa de escrita que não esteja
// classificada aqui. É o que impede o buraco de voltar em silêncio: rota nova
// sem decisão consciente quebra o teste.
// Parte 2 prova, uma por uma, que o admin comum PEDE e não FAZ.

delete process.env.DATABASE_URL;
process.env.YT_MOCK = '1';
process.env.PASSWORD_LOGIN = '1';
process.env.OWNER_EMAIL = 'dono@example.com';

import { randomUUID } from 'node:crypto';
const { buildApp } = await import('../src/app.js');
const { app, db } = await buildApp({ databaseUrl: undefined, dataDir: ':memory:', scheduler: false });
const server = app.listen(0);
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const { signToken } = await import('../src/auth.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU  ' + n); } else { fail++; console.log('  FALHOU  ' + n + ' ' + x); } return !!c; };
async function req(path, { method = 'GET', body, token } = {}) {
  const r = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {}; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
async function criar(email, role = 'user') {
  const id = randomUUID();
  await db.run('INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,created_at) VALUES(?,?,?,?,?,?,?,?)',
    [id, email, null, email.split('@')[0], role, 'free', 5000, new Date().toISOString()]);
  return { id, email, token: await signToken(db, id) };
}

/* ============ PARTE 1: censo das rotas administrativas de escrita ============ */

// Toda ação que um admin não principal só pode PEDIR.
const FILA = new Set([
  'POST /api/admin/users/:id/credits',
  'POST /api/admin/users/:id/banir',
  'POST /api/admin/users/:id/plan',
  'POST /api/admin/plans',
  'PUT /api/admin/plans/:id',
  'PUT /api/admin/tools/:tool',
  'POST /api/admin/payments/:id/confirm',
  'POST /api/admin/admins',
  'DELETE /api/admin/admins/:id',
  'POST /api/admin/blocks',
  'PUT /api/admin/blocks/:id',
  'DELETE /api/admin/blocks/:id',
  'POST /api/admin/blocks/:id/move',
  'POST /api/admin/chats/grupo',
  'POST /api/admin/moderate'
]);
// Nem com autorização: só o administrador principal, e o motivo de cada uma.
const SO_DONO = new Map([
  ['PUT /api/admin/settings', 'guardaria o token do Mercado Pago e a chave da IA dentro do pedido'],
  ['POST /api/admin/users/:id/encerrar-sessoes', 'derrubar sessão alheia é poder de dono'],
  ['POST /api/admin/pedidos/:id/decidir', 'quem decide o pedido é o principal'],
  ['POST /api/admin/estatisticas/regras', 'muda o critério do que o site publica como resultado']
]);
// Admin comum faz direto, e o porquê de cada uma ser inofensiva.
const LIVRE = new Map([
  ['POST /api/admin/ai-test', 'só testa a chave, não escreve nada'],
  ['POST /api/admin/estatisticas/recalcular', 'recalcula sobre dado existente, não muda regra nem número'],
  ['POST /api/admin/chats/dm', 'abrir conversa de dois'],
  ['POST /api/admin/chats/:id/mensagens', 'mandar mensagem no chat'],
  ['DELETE /api/admin/chats/:id/mensagens/:msg', 'apagar mensagem (o próprio autor ou o dono, conferido dentro)'],
  ['POST /api/admin/chats/:id/fixar', 'fixar conversa, muda só a lateral de quem fixou'],
  ['POST /api/admin/chats/:id/sinal', 'recado de ligação: o dono dispensou autorização para chamadas']
]);

// Express 4 guarda em _router; o getter app.router foi aposentado e lança.
const pilha = app._router?.stack || [];
const rotas = [];
for (const l of pilha) {
  if (!l.route?.path) continue;
  const caminho = String(l.route.path);
  if (!caminho.startsWith('/api/admin')) continue;
  for (const m of Object.keys(l.route.methods || {})) {
    if (m === 'get' || m === '_all') continue;
    rotas.push(`${m.toUpperCase()} ${caminho}`);
  }
}
console.log(`\n== Censo: ${rotas.length} rotas administrativas de escrita ==`);
const naoClassificadas = rotas.filter((r) => !FILA.has(r) && !SO_DONO.has(r) && !LIVRE.has(r));
check('toda rota administrativa de escrita está classificada', naoClassificadas.length === 0,
  naoClassificadas.length ? `\n    >>> SEM CLASSIFICAÇÃO: ${naoClassificadas.join(', ')}\n    >>> Decida: vai para a fila (FILA), é só do dono (SO_DONO) ou é inofensiva (LIVRE).` : '');
const sumiram = [...FILA, ...SO_DONO.keys(), ...LIVRE.keys()].filter((r) => !rotas.includes(r));
check('nenhuma rota classificada aqui desapareceu do servidor', sumiram.length === 0, sumiram.join(', '));
check('o servidor registrou as rotas (o censo não leu uma lista vazia)', rotas.length >= 20, String(rotas.length));

/* ============ PARTE 2: o admin comum pede, não faz ============ */

const dono = await criar('dono@example.com', 'owner');
const adm = await criar('adm@example.com', 'admin');
const alvo = await criar('alvo@example.com');
const comum = await criar('comum@example.com');

const pendentes = async () => Number((await db.get("SELECT COUNT(*) AS n FROM pedidos_admin WHERE status='pendente'")).n);
async function pede(nome, path, { method = 'POST', body } = {}) {
  const antes = await pendentes();
  const r = await req(path, { method, body, token: adm.token });
  const virouPedido = r.status === 202 && r.data.executado === false && !!r.data.pedido;
  check(nome, virouPedido && (await pendentes()) === antes + 1, `(status=${r.status}) ${JSON.stringify(r.data).slice(0, 150)}`);
  return r.data.pedido;
}
const aprova = (id) => req(`/api/admin/pedidos/${id}/decidir`, { method: 'POST', token: dono.token, body: { decisao: 'sim' } });

console.log('\n== Dinheiro e créditos ==');
const pag = randomUUID();
await db.run('INSERT INTO payments(id,user_id,plan_id,amount_cents,provider,provider_id,status,created_at,updated_at,raw) VALUES(?,?,?,?,?,?,?,?,?,?)',
  [pag, alvo.id, 'p10', 1000, 'pix', 'x1', 'pending', new Date().toISOString(), new Date().toISOString(), '{}']);
const pPag = await pede('confirmar pagamento à mão vira pedido', `/api/admin/payments/${pag}/confirm`, { body: { note: 'vi o comprovante Pix' } });
check('o pagamento continua pendente antes do Sim', (await db.get('SELECT status FROM payments WHERE id=?', [pag])).status === 'pending');
check('e os créditos do usuário não mudaram', Number((await db.get('SELECT credits FROM users WHERE id=?', [alvo.id])).credits) === 5000);
await aprova(pPag);
check('depois do Sim, o pagamento é aprovado', (await db.get('SELECT status FROM payments WHERE id=?', [pag])).status === 'approved');
check('e aí sim os créditos entram', Number((await db.get('SELECT credits FROM users WHERE id=?', [alvo.id])).credits) > 5000);

const pCred = await pede('ajustar créditos vira pedido', `/api/admin/users/${alvo.id}/credits`, { body: { delta: 5000, motivo: 'cortesia' } });
check('o saldo não muda antes do Sim', Number((await db.get('SELECT credits FROM users WHERE id=?', [alvo.id])).credits) === 65000, String((await db.get('SELECT credits FROM users WHERE id=?', [alvo.id])).credits));
await aprova(pCred);
check('depois do Sim o saldo muda', Number((await db.get('SELECT credits FROM users WHERE id=?', [alvo.id])).credits) === 70000);

console.log('\n== Planos e preços ==');
const pPlano = await pede('criar plano vira pedido', '/api/admin/plans', { body: { id: 'turbo9', name: 'Turbo 9', price_cents: 900, monthly_credits: 999999 } });
check('o plano não existe antes do Sim', !(await db.get('SELECT id FROM plans WHERE id=?', ['turbo9'])));
await aprova(pPlano);
check('depois do Sim o plano existe', !!(await db.get('SELECT id FROM plans WHERE id=?', ['turbo9'])));

const pEdit = await pede('editar plano vira pedido', '/api/admin/plans/p10', { method: 'PUT', body: { monthly_credits: 9000000 } });
check('os créditos mensais do plano não mudam antes do Sim', Number((await db.get('SELECT monthly_credits FROM plans WHERE id=?', ['p10'])).monthly_credits) === 60000);
await aprova(pEdit);
check('depois do Sim mudam', Number((await db.get('SELECT monthly_credits FROM plans WHERE id=?', ['p10'])).monthly_credits) === 9000000);

const pCusto = await pede('mudar preço de ferramenta vira pedido', '/api/admin/tools/audit_ai', { method: 'PUT', body: { cost: 0 } });
check('o preço não muda antes do Sim', Number((await db.get('SELECT cost FROM tool_costs WHERE tool=?', ['audit_ai'])).cost) === 200);
await aprova(pCusto);
check('depois do Sim muda', Number((await db.get('SELECT cost FROM tool_costs WHERE tool=?', ['audit_ai'])).cost) === 0);

const planoAntes = (await db.get('SELECT plan_id FROM users WHERE id=?', [alvo.id])).plan_id;
const pPlanoUser = await pede('trocar o plano de um usuário vira pedido', `/api/admin/users/${alvo.id}/plan`, { body: { plan_id: 'turbo9' } });
check('o plano do usuário não muda antes do Sim', (await db.get('SELECT plan_id FROM users WHERE id=?', [alvo.id])).plan_id === planoAntes, `(${planoAntes})`);
await aprova(pPlanoUser);
check('depois do Sim muda', (await db.get('SELECT plan_id FROM users WHERE id=?', [alvo.id])).plan_id === 'turbo9');

console.log('\n== Avisos e cards (o que o buraco original deixava passar) ==');
const corpo = { tipo: 'aviso', pagina: 'home', slot: 'topo', titulo: 'Aviso do admin', texto: 'teste', estilo: 'info' };
const pBloco = await pede('criar aviso vira pedido', '/api/admin/blocks', { body: corpo });
check('o aviso não aparece no site antes do Sim', (await req('/api/blocks?pagina=home')).data.itens.length === 0);
await aprova(pBloco);
const noSite = await req('/api/blocks?pagina=home');
check('depois do Sim o aviso aparece', noSite.data.itens.length === 1 && noSite.data.itens[0].titulo === 'Aviso do admin');
const blocoId = (await db.get('SELECT id FROM blocos LIMIT 1')).id;

const pEditB = await pede('editar aviso vira pedido', `/api/admin/blocks/${blocoId}`, { method: 'PUT', body: { ...corpo, titulo: 'Trocado pelo admin' } });
check('o texto do site não muda antes do Sim', (await db.get('SELECT titulo FROM blocos WHERE id=?', [blocoId])).titulo === 'Aviso do admin');
await aprova(pEditB);
check('depois do Sim muda', (await db.get('SELECT titulo FROM blocos WHERE id=?', [blocoId])).titulo === 'Trocado pelo admin');

const pMover = await pede('mudar a ordem vira pedido', `/api/admin/blocks/${blocoId}/move`, { body: { direcao: 'baixo' } });
await aprova(pMover);
const pExcluir = await pede('excluir aviso vira pedido', `/api/admin/blocks/${blocoId}`, { method: 'DELETE' });
check('o aviso continua no ar antes do Sim', !!(await db.get('SELECT id FROM blocos WHERE id=?', [blocoId])));
await aprova(pExcluir);
check('depois do Sim some', !(await db.get('SELECT id FROM blocos WHERE id=?', [blocoId])));

console.log('\n== Administradores, banimento e moderação ==');
await pede('adicionar administrador vira pedido', '/api/admin/admins', { body: { email: comum.email } });
check('a conta não virou admin antes do Sim', (await db.get('SELECT role FROM users WHERE id=?', [comum.id])).role === 'user');
await pede('remover administrador vira pedido', `/api/admin/admins/${adm.id}`, { method: 'DELETE' });
await pede('banir conta vira pedido', `/api/admin/users/${alvo.id}/banir`, { body: { motivo: 'teste' } });
check('a conta não foi banida antes do Sim', Number((await db.get('SELECT banido FROM users WHERE id=?', [alvo.id])).banido) === 0);

const rev = randomUUID();
await db.run('INSERT INTO reviews(id,user_id,stars,comment,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
  [rev, alvo.id, 5, 'muito bom', 'active', new Date().toISOString(), new Date().toISOString()]);
const pMod = await pede('remover avaliação vira pedido', '/api/admin/moderate', { body: { alvo_tipo: 'avaliacao', alvo_id: rev, motivo: 'teste' } });
check('a avaliação continua visível antes do Sim', (await db.get('SELECT status FROM reviews WHERE id=?', [rev])).status === 'active');
await aprova(pMod);
check('depois do Sim ela é removida', (await db.get('SELECT status FROM reviews WHERE id=?', [rev])).status === 'removed');
await pede('restaurar avaliação TAMBÉM vira pedido', '/api/admin/moderate', { body: { alvo_tipo: 'avaliacao', alvo_id: rev, remover: false, motivo: 'voltar' } });
check('ela continua removida antes do Sim', (await db.get('SELECT status FROM reviews WHERE id=?', [rev])).status === 'removed');

console.log('\n== O que nem com autorização o admin comum faz ==');
for (const [rota, porque] of SO_DONO) {
  const [m, caminho] = rota.split(' ');
  const url = caminho.replace(':id', alvo.id).replace(':tool', 'audit_ai');
  const r = await req(url, { method: m, token: adm.token, body: { updates: { site_name: 'Invadido' }, decisao: 'sim', usosMinimos: 1 } });
  check(`${rota} recusa o admin comum (${porque})`, r.status === 403, `(status=${r.status})`);
}
check('o nome do site não mudou', ((await db.get("SELECT value FROM settings WHERE key='site_name'"))?.value || 'TurboCanal') !== 'Invadido');

console.log('\n== Recusar o pedido não executa nada ==');
const pRecusa = await pede('pedido que será recusado', `/api/admin/users/${alvo.id}/credits`, { body: { delta: 99999999, motivo: 'tentativa' } });
const antesSaldo = Number((await db.get('SELECT credits FROM users WHERE id=?', [alvo.id])).credits);
const nao = await req(`/api/admin/pedidos/${pRecusa}/decidir`, { method: 'POST', token: dono.token, body: { decisao: 'nao', resposta: 'não autorizo' } });
check('o dono recusa', nao.status === 200 && nao.data.status === 'recusado');
check('e o saldo fica como estava', Number((await db.get('SELECT credits FROM users WHERE id=?', [alvo.id])).credits) === antesSaldo);
const denovo = await req(`/api/admin/pedidos/${pRecusa}/decidir`, { method: 'POST', token: dono.token, body: { decisao: 'sim' } });
check('pedido já decidido não pode ser decidido de novo', denovo.status === 409, `(${denovo.status})`);

console.log('\n== Usuário comum não chega nem perto ==');
let barrados = 0;
for (const rota of [...FILA, ...SO_DONO.keys(), ...LIVRE.keys()]) {
  const [m, caminho] = rota.split(' ');
  const url = caminho.replace(':id', alvo.id).replace(':tool', 'audit_ai').replace(':msg', 'x');
  const r = await req(url, { method: m, token: comum.token, body: {} });
  if (r.status === 403) barrados++;
  else console.log(`    (não deu 403: ${rota} -> ${r.status})`);
}
check('usuário comum recebe 403 em TODAS as rotas administrativas de escrita',
  barrados === FILA.size + SO_DONO.size + LIVRE.size, `(${barrados} de ${FILA.size + SO_DONO.size + LIVRE.size})`);

console.log('\n== O admin comum enxerga os próprios pedidos, e só ==');
const meus = await req('/api/admin/pedidos', { token: adm.token });
check('ele vê a lista dos pedidos dele', meus.status === 200 && meus.data.itens.length > 0);
check('e não recebe o selo de dono', meus.data.sou_dono === false);
check('todos os pedidos que ele vê são dele', meus.data.itens.every((p) => p.pedido_por_id === adm.id));

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
server.close();
process.exit(fail ? 1 : 0);
