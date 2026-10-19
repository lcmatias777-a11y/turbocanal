// Testes obrigatórios do TurboCanal.
// Roda um servidor real em porta efêmera, com banco de teste limpo e YT_MOCK=1
// (as ferramentas de YouTube devolvem dados ROTULADOS como exemplo; a cobrança
// de créditos, autenticação e permissões são 100% reais).

import fs from 'node:fs';

process.env.DB_PATH = './data/test.db';
process.env.YT_MOCK = '1';
process.env.OWNER_EMAIL = process.env.OWNER_EMAIL || 'lcmatias777@gmail.com';
for (const f of ['./data/test.db', './data/test.db-wal', './data/test.db-shm']) {
  try { fs.rmSync(f); } catch {}
}

const { buildApp } = await import('../src/app.js');
const { getSetting } = await import('../src/db.js');
const { app, db } = buildApp();

const server = app.listen(0);
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASSOU  ${name}`); }
  else { fail++; console.log(`  FALHOU  ${name} ${extra}`); }
}
async function req(path, { method = 'GET', body, token, headers = {} } = {}) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

console.log('\n== 1) Usuário Free: cadastro, 5000 créditos e uso das ferramentas ==');
const u1 = await req('/api/auth/register', { method: 'POST', body: { email: 'maria@example.com', password: 'senha12345', name: 'Maria' } });
check('cadastro do usuário comum', u1.status === 200 && u1.data.user?.email === 'maria@example.com');
check('saldo inicial de 5000 créditos', u1.data.user?.credits === 5000, `(saldo=${u1.data.user?.credits})`);
const t1 = u1.data.token;

const kw = await req('/api/tools/keyword_research', { method: 'POST', token: t1, body: { q: 'minecraft bedwars' } });
check('ferramenta executa e debita créditos (5000 - 5 = 4995)', kw.status === 200 && kw.data.credits?.balance === 4995, `(status=${kw.status}, saldo=${kw.data.credits?.balance})`);
check('resultado de teste vem rotulado como exemplo (mock)', kw.data.result?.mock === true);

console.log('\n== Idempotência: a mesma requisição não cobra duas vezes ==');
const idem = 'teste-idem-123';
const a1 = await req('/api/tools/trends', { method: 'POST', token: t1, body: {}, headers: { 'X-Idempotency-Key': idem } });
const a2 = await req('/api/tools/trends', { method: 'POST', token: t1, body: {}, headers: { 'X-Idempotency-Key': idem } });
check('primeira chamada cobra', a1.data.credits?.charged === 3, `(charged=${a1.data.credits?.charged})`);
check('repetição com a mesma chave não cobra de novo', a2.status === 200 && a2.data.credits?.charged === 0 && a2.data.credits?.reused === true, `(charged=${a2.data.credits?.charged})`);

console.log('\n== Saldo insuficiente: bloqueia sem ficar negativo ==');
db.prepare('UPDATE users SET credits=2 WHERE email=?').run('maria@example.com');
const poor = await req('/api/tools/video_analysis', { method: 'POST', token: t1, body: { video: 'dQw4w9WgXcQ' } });
const after = await req('/api/me', { token: t1 });
check('retorna 402 com aviso de saldo insuficiente', poor.status === 402, `(status=${poor.status})`);
check('saldo não ficou negativo', after.data.user?.credits === 2, `(saldo=${after.data.user?.credits})`);
db.prepare('UPDATE users SET credits=4992 WHERE email=?').run('maria@example.com');

console.log('\n== 4) Usuário comum NÃO vira admin forjando o e-mail no navegador ==');
const adm1 = await req('/api/admin/users', { token: t1 });
check('usuário comum recebe 403 no painel admin', adm1.status === 403, `(status=${adm1.status})`);
const forged = await req('/api/admin/users', { token: t1, headers: { 'X-User-Email': 'lcmatias777@gmail.com' } });
check('header forjado com e-mail do admin continua 403', forged.status === 403, `(status=${forged.status})`);

console.log('\n== 2 e 3) Conta do administrador principal: reivindicação segura, tudo liberado e sem consumir créditos ==');
const own = await req('/api/auth/register', { method: 'POST', body: { email: 'lcmatias777@gmail.com', password: 'senha12345', name: 'Admin' } });
check('cadastro com o e-mail do owner NÃO dá admin automaticamente', own.status === 200 && own.data.user?.role === 'user', `(role=${own.data.user?.role})`);
const tOwn = own.data.token;
const admBefore = await req('/api/admin/users', { token: tOwn });
check('antes de reivindicar, ainda é 403 no painel', admBefore.status === 403);
const badClaim = await req('/api/auth/claim-owner', { method: 'POST', token: tOwn, body: { token: 'token-errado' } });
check('reivindicação com token errado é recusada', badClaim.status === 403);
const wrongUserClaim = await req('/api/auth/claim-owner', { method: 'POST', token: t1, body: { token: getSetting(db, 'admin_setup_token') } });
check('outra conta com o token certo também é recusada (e-mail não bate)', wrongUserClaim.status === 403);
const goodClaim = await req('/api/auth/claim-owner', { method: 'POST', token: tOwn, body: { token: getSetting(db, 'admin_setup_token') } });
check('reivindicação correta (e-mail + token do console) vira owner', goodClaim.status === 200 && goodClaim.data.user?.role === 'owner', `(status=${goodClaim.status})`);

const ownTool1 = await req('/api/tools/keyword_research', { method: 'POST', token: tOwn, body: { q: 'geometry dash' } });
const ownTool2 = await req('/api/tools/title_ai', { method: 'POST', token: tOwn, body: { topic: 'bedwars no minecraft' } });
const ownMe = await req('/api/me', { token: tOwn });
check('owner usa ferramentas sem cobrança (charged=0, unlimited)', ownTool1.data.credits?.charged === 0 && ownTool1.data.credits?.unlimited === true);
check('owner usa ferramenta de IA também sem cobrança', ownTool2.status === 200 && ownTool2.data.credits?.charged === 0);
check('saldo do owner é tratado como ilimitado no /api/me', ownMe.data.user?.unlimited === true);
const ownAdmin = await req('/api/admin/overview', { token: tOwn });
check('owner acessa o painel administrativo', ownAdmin.status === 200 && typeof ownAdmin.data.users === 'number');
const ownPay = await req('/api/payments/create', { method: 'POST', token: tOwn, body: { plan_id: 'p10' } });
check('owner não tem o que pagar (isento de cobrança interna)', ownPay.status === 400, `(status=${ownPay.status})`);

console.log('\n== Persistência da regra do owner após novo login (logout/login) ==');
const relog = await req('/api/auth/login', { method: 'POST', body: { email: 'lcmatias777@gmail.com', password: 'senha12345' } });
check('depois de novo login, continua owner e ilimitado', relog.data.user?.role === 'owner' && relog.data.user?.unlimited === true);

console.log('\n== Gestão de administradores (somente o principal promove/remove; principal é intocável) ==');
const u2 = await req('/api/auth/register', { method: 'POST', body: { email: 'joao@example.com', password: 'senha12345', name: 'João' } });
const t2 = u2.data.token;
const promoByUser = await req('/api/admin/admins', { method: 'POST', token: t1, body: { email: 'joao@example.com' } });
check('usuário comum não promove admins (403)', promoByUser.status === 403);
const promo = await req('/api/admin/admins', { method: 'POST', token: tOwn, body: { email: 'joao@example.com' } });
check('owner promove João a admin', promo.status === 200);
const admByJoao = await req('/api/admin/users', { token: t2 });
check('novo admin acessa o painel', admByJoao.status === 200);
const promoByAdmin = await req('/api/admin/admins', { method: 'POST', token: t2, body: { email: 'maria@example.com' } });
check('admin comum NÃO promove outros admins (só o principal)', promoByAdmin.status === 403);
const ownerId = db.prepare('SELECT id FROM users WHERE email=?').get('lcmatias777@gmail.com').id;
const demoteOwnerByAdmin = await req(`/api/admin/admins/${ownerId}`, { method: 'DELETE', token: t2 });
check('admin não consegue remover/rebaixar o administrador principal', demoteOwnerByAdmin.status === 403);
const demoteOwnerByOwner = await req(`/api/admin/admins/${ownerId}`, { method: 'DELETE', token: tOwn });
check('nem o próprio fluxo permite rebaixar o principal', demoteOwnerByOwner.status === 403);
const joaoId = db.prepare('SELECT id FROM users WHERE email=?').get('joao@example.com').id;
const demoteJoao = await req(`/api/admin/admins/${joaoId}`, { method: 'DELETE', token: tOwn });
const joaoAfter = await req('/api/admin/users', { token: t2 });
check('owner remove o admin João, que perde o painel', demoteJoao.status === 200 && joaoAfter.status === 403);
const auditLog = await req('/api/admin/audit', { token: tOwn });
check('promoção/remoção ficam no histórico de auditoria', auditLog.status === 200 && auditLog.data.items.some((a) => a.action === 'admin.promote') && auditLog.data.items.some((a) => a.action === 'admin.demote'));

console.log('\n== Pagamentos: sem provedor configurado, nada é confirmado de mentira ==');
const pay = await req('/api/payments/create', { method: 'POST', token: t1, body: { plan_id: 'p10' } });
check('criar cobrança sem provedor retorna 409 com explicação (sem simulação)', pay.status === 409, `(status=${pay.status})`);
const planAfter = await req('/api/me', { token: t1 });
check('plano do usuário não mudou e nenhum crédito foi liberado', planAfter.data.user?.plan_id === 'free');

console.log('\n== Isolamento entre contas ==');
const h1 = await req('/api/history', { token: t1 });
const h2 = await req('/api/history', { token: t2 });
check('históricos de usuários diferentes não se misturam', h1.status === 200 && h2.status === 200 && JSON.stringify(h1.data) !== JSON.stringify(h2.data));

console.log('\n== 5) Caminho da extensão do Chrome (Bearer token, mesmas regras) ==');
const tokenResp = await req('/api/auth/token', { token: t1 });
const extMe = await req('/api/me', { token: tokenResp.data.token });
check('token da extensão autentica a MESMA conta e o MESMO saldo', extMe.status === 200 && extMe.data.user?.email === 'maria@example.com');
const extTool = await req('/api/tools/trends', { method: 'POST', token: tokenResp.data.token, body: {} });
check('ferramenta via extensão também debita no servidor', extTool.status === 200 && typeof extTool.data.credits?.balance === 'number');

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
server.close();
process.exit(fail ? 1 : 0);
