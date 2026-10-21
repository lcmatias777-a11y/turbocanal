// Testes obrigatórios do TurboCanal.
// Roda um servidor real em porta efêmera, com banco de teste limpo e YT_MOCK=1
// (as ferramentas de YouTube devolvem dados ROTULADOS como exemplo; a cobrança
// de créditos, autenticação e permissões são 100% reais).


delete process.env.DATABASE_URL; // testes rodam no PGlite em memória (Postgres embutido)
process.env.YT_MOCK = '1';
process.env.OWNER_EMAIL = process.env.OWNER_EMAIL || 'lcmatias777@gmail.com';

const { buildApp } = await import('../src/app.js');
const { getSetting } = await import('../src/db.js');
const { app, db } = await buildApp({ databaseUrl: undefined, dataDir: ':memory:', scheduler: false });

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
await db.run('UPDATE users SET credits=2 WHERE email=?', ['maria@example.com']);
const poor = await req('/api/tools/video_analysis', { method: 'POST', token: t1, body: { video: 'dQw4w9WgXcQ' } });
const after = await req('/api/me', { token: t1 });
check('retorna 402 com aviso de saldo insuficiente', poor.status === 402, `(status=${poor.status})`);
check('saldo não ficou negativo', after.data.user?.credits === 2, `(saldo=${after.data.user?.credits})`);
await db.run('UPDATE users SET credits=4992 WHERE email=?', ['maria@example.com']);

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
const wrongUserClaim = await req('/api/auth/claim-owner', { method: 'POST', token: t1, body: { token: await getSetting(db, 'admin_setup_token') } });
check('outra conta com o token certo também é recusada (e-mail não bate)', wrongUserClaim.status === 403);
const goodClaim = await req('/api/auth/claim-owner', { method: 'POST', token: tOwn, body: { token: await getSetting(db, 'admin_setup_token') } });
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
const ownerId = (await db.get('SELECT id FROM users WHERE email=?', ['lcmatias777@gmail.com'])).id;
const demoteOwnerByAdmin = await req(`/api/admin/admins/${ownerId}`, { method: 'DELETE', token: t2 });
check('admin não consegue remover/rebaixar o administrador principal', demoteOwnerByAdmin.status === 403);
const demoteOwnerByOwner = await req(`/api/admin/admins/${ownerId}`, { method: 'DELETE', token: tOwn });
check('nem o próprio fluxo permite rebaixar o principal', demoteOwnerByOwner.status === 403);
const joaoId = (await db.get('SELECT id FROM users WHERE email=?', ['joao@example.com'])).id;
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

console.log('\n== Canal do YouTube e IA: sem credenciais, avisam a pendência e não cobram ==');
const ch = await req('/api/channel/videos', { token: t1 });
check('Meu canal sem conexão retorna 409 explicando', ch.status === 409, `(status=${ch.status})`);
const thumbNo = await req('/api/channel/videos/abc123/thumbnail', { method: 'POST', token: t1, body: { image: 'data:image/png;base64,iVBORw0KGgo=' } });
const meAfter = await req('/api/me', { token: t1 });
check('enviar capa sem canal conectado: 409 e créditos estornados', thumbNo.status === 409 && meAfter.data.user?.credits === 4992 - 3, `(status=${thumbNo.status}, saldo=${meAfter.data.user?.credits})`);
const ins = await req('/api/tools/video_insights_ai', { method: 'POST', token: t1, body: { video: 'dQw4w9WgXcQ' } });
const meAfter2 = await req('/api/me', { token: t1 });
check('IA do Gemini sem chave: 409 e sem cobrança', ins.status === 409 && meAfter2.data.user?.credits === meAfter.data.user?.credits, `(status=${ins.status})`);
const pub = await req('/api/settings/public');
check('settings públicos informam o que está configurado', pub.status === 200 && pub.data.google_login === false && pub.data.gemini_configured === false);
const health = await req('/api/health');
check('health informa o tipo de banco', health.data.db === 'pglite');

console.log('\n== Novas ferramentas: preparar, responder, transformar, painel, concorrentes ==');
const prep = await req('/api/tools/prep_ai', { method: 'POST', token: t1, body: { topic: 'bedwars no minecraft', notes: 'mostrar estrategia de cama' } });
check('Preparar publicação devolve títulos, tags, roteiro e ideias (gerador local sem IA)', prep.status === 200 && prep.data.result.titulos?.length >= 5 && prep.data.result.roteiro?.length >= 4 && prep.data.result.ideias?.length >= 5 && prep.data.credits.charged === 15, `(status=${prep.status})`);
const rep = await req('/api/tools/reply_ai', { method: 'POST', token: t1, body: { comment: 'Que vídeo top, como você fez a ponte?' } });
check('Sugestão de resposta a comentário devolve 3 opções', rep.status === 200 && rep.data.result.respostas?.length === 3);
const before = (await req('/api/me', { token: t1 })).data.user.credits;
const tr = await req('/api/tools/transform_ai', { method: 'POST', token: t1, body: { video: 'dQw4w9WgXcQ', mode: 'shorts' } });
const after2 = (await req('/api/me', { token: t1 })).data.user.credits;
check('Transformar sem chave do Gemini: 409 e créditos devolvidos', tr.status === 409 && after2 === before, `(status=${tr.status}, antes=${before}, depois=${after2})`);
const panel = await req('/api/tools/video_panel', { method: 'POST', token: t1, body: { video: 'dQw4w9WgXcQ' } });
check('Painel da extensão custa 1 crédito e traz views por hora e engajamento', panel.status === 200 && panel.data.credits.charged === 1 && typeof panel.data.result.video.vph === 'number' && panel.data.result.video.engagement != null);
const kw2 = await req('/api/tools/keyword_research', { method: 'POST', token: t1, body: { q: 'geometry dash' } });
check('Vídeos da pesquisa trazem VPH e outlier', kw2.data.result.topVideos.every((v) => typeof v.vph === 'number' && typeof v.outlier === 'number'));
const comp = await req('/api/competitors', { method: 'POST', token: t1, body: { channel: '@canalexemplo' } });
const compList = await req('/api/competitors', { token: t1 });
check('Adicionar concorrente salva na lista com vídeos recentes', comp.status === 200 && compList.data.items.length === 1 && compList.data.items[0].last_data.recent.length > 0, `(status=${comp.status})`);
const compDel = await req('/api/competitors/' + compList.data.items[0].id, { method: 'DELETE', token: t1 });
const compList2 = await req('/api/competitors', { token: t1 });
check('Remover concorrente', compDel.status === 200 && compList2.data.items.length === 0);
const compOther = await req('/api/competitors', { token: t2 });
check('Lista de concorrentes é separada por usuário', compOther.status === 200 && compOther.data.items.length === 0);

console.log('\n== Studio sem canal vinculado: avisa e devolve créditos ==');
const bal0 = (await req('/api/me', { token: t1 })).data.user.credits;
const up = await req('/api/channel/upload/start', { method: 'POST', token: t1, body: { title: 'teste', size: 10, mime: 'video/mp4' } });
const lv = await req('/api/channel/live', { method: 'POST', token: t1, body: { title: 'live teste' } });
const an = await req('/api/channel/analytics', { token: t1 });
const cm = await req('/api/channel/comments', { token: t1 });
const bal1 = (await req('/api/me', { token: t1 })).data.user.credits;
check('Postar, live, analytics e comentários exigem canal vinculado (409)', [up, lv, an, cm].every((r) => r.status === 409), `(${[up, lv, an, cm].map((r) => r.status)})`);
check('Nenhum crédito perdido nas tentativas sem canal', bal1 === bal0, `(antes=${bal0}, depois=${bal1})`);

console.log('\n== Páginas legais e motor do editor ==');
const privR = await fetch(base + '/privacidade');
const privT = await privR.text();
check('/privacidade é uma página HTML real (sem depender de JavaScript)', privR.status === 200 && privT.includes('Política de Privacidade') && privT.includes('Uso Limitado'));
const termR = await fetch(base + '/termos');
check('/termos é uma página HTML real', termR.status === 200 && (await termR.text()).includes('Termos de Uso'));
const wasm = await fetch(base + '/vendor/ffmpeg/core/ffmpeg-core.wasm', { method: 'HEAD' });
check('Motor do editor (ffmpeg.wasm) servido pelo site com tipo correto', wasm.status === 200 && wasm.headers.get('content-type') === 'application/wasm');
const ffjs = await fetch(base + '/vendor/ffmpeg/ffmpeg/index.js');
check('Biblioteca do editor servida pelo site', ffjs.status === 200);

console.log('\n== Com o Google configurado: login SOMENTE com Google ==');
process.env.GOOGLE_CLIENT_ID = 'teste.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'segredo-de-teste';
const regG = await req('/api/auth/register', { method: 'POST', body: { email: 'novo@example.com', password: 'senha12345' } });
const logG = await req('/api/auth/login', { method: 'POST', body: { email: 'maria@example.com', password: 'senha12345' } });
check('cadastro por senha bloqueado (403)', regG.status === 403, `(status=${regG.status})`);
check('login por senha bloqueado (403)', logG.status === 403, `(status=${logG.status})`);
const g1 = await fetch(base + '/api/auth/google', { redirect: 'manual' });
const loc1 = g1.headers.get('location') || '';
check('Entrar com Google redireciona ao Google pedindo leitura do YouTube', g1.status === 302 && loc1.startsWith('https://accounts.google.com/') && loc1.includes('youtube.readonly') && loc1.includes('access_type=offline'));
const g2 = await fetch(base + '/api/auth/google?connect=1', { redirect: 'manual' });
const gUrl2 = new URL(g2.headers.get('location') || 'http://x');
const sc2 = (gUrl2.searchParams.get('scope') || '').split(' ');
check('Vincular canal pede gestão do canal e analytics, com consentimento', sc2.includes('https://www.googleapis.com/auth/youtube') && sc2.includes('https://www.googleapis.com/auth/yt-analytics.readonly') && gUrl2.searchParams.get('prompt') === 'consent', `(${sc2.join(' ')})`);
const pubG = await req('/api/settings/public');
check('site informa que o login com Google está ativo', pubG.data.google_login === true);
const tokOld = await req('/api/me', { token: t1 });
check('sessões já abertas continuam válidas', tokOld.status === 200);
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

console.log('\n== Admin enxerga a cota do YouTube ==');
const ov = await req('/api/admin/overview', { token: tOwn });
check('visão geral mostra unidades de cota usadas hoje', ov.status === 200 && typeof ov.data.youtubeQuota?.usedToday === 'number');

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
server.close();
process.exit(fail ? 1 : 0);
