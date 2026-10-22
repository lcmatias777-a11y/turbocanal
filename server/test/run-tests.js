// Testes obrigatórios do TurboCanal.
// Roda um servidor real em porta efêmera, com banco de teste limpo e YT_MOCK=1
// (as ferramentas de YouTube devolvem dados ROTULADOS como exemplo; a cobrança
// de créditos, autenticação e permissões são 100% reais).


delete process.env.DATABASE_URL; // testes rodam no PGlite em memória (Postgres embutido)
process.env.YT_MOCK = '1';
process.env.OWNER_EMAIL = process.env.OWNER_EMAIL || 'lcmatias777@gmail.com';

// YouTube simulado (só para os testes de "Meu canal"); precisa subir antes de carregar o app
const { startFakeYouTube } = await import('./fake-youtube.js');
const fake = await startFakeYouTube();
process.env.YT_API_BASE = fake.base + '/youtube/v3/';
process.env.YT_UPLOAD_BASE = fake.base + '/upload/youtube/v3/';
process.env.YT_ANALYTICS_BASE = fake.base + '/youtubeanalytics/v2/';
process.env.YT_IMG_BASE = fake.base + '/vi/';
process.env.YT_API_BASE_RESEARCH = '1';
const { startFakeGemini } = await import('./fake-gemini.js');
const gem = await startFakeGemini();
process.env.GEMINI_API_BASE = gem.base;
delete process.env.GEMINI_API_KEY; delete process.env.ANTHROPIC_API_KEY; delete process.env.GEMINI_TEXT_MODEL; delete process.env.GEMINI_IMAGE_MODEL;

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
const ownTool2 = await req('/api/tools/trends', { method: 'POST', token: tOwn, body: {} });
const ownMe = await req('/api/me', { token: tOwn });
check('owner usa ferramentas sem cobrança (charged=0, unlimited)', ownTool1.data.credits?.charged === 0 && ownTool1.data.credits?.unlimited === true);
check('owner usa outra ferramenta também sem cobrança', ownTool2.status === 200 && ownTool2.data.credits?.charged === 0);
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
const bNoAI = (await req('/api/me', { token: t1 })).data.user.credits;
const txNoAI = (await db.get('SELECT COUNT(*)::int AS n FROM transactions')).n;
const prep = await req('/api/tools/prep_ai', { method: 'POST', token: t1, body: { topic: 'bedwars no minecraft', notes: 'mostrar estrategia de cama' } });
const rep = await req('/api/tools/reply_ai', { method: 'POST', token: t1, body: { comment: 'Que vídeo top, como você fez a ponte?' } });
const tit = await req('/api/tools/title_ai', { method: 'POST', token: t1, body: { topic: 'bedwars' } });
check('sem IA ligada: ferramentas de IA recusam (409) sem resultado de mentira', prep.status === 409 && rep.status === 409 && tit.status === 409 && /chave do Gemini/.test(prep.data.error || ''), `(${prep.status}/${rep.status}/${tit.status})`);
check('sem IA ligada: nenhum crédito sai e nem aparece cobrança no histórico', (await req('/api/me', { token: t1 })).data.user.credits === bNoAI && (await db.get('SELECT COUNT(*)::int AS n FROM transactions')).n === txNoAI);
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

console.log('\n== Ideias de vídeos sem IA ligada ==');
const meI = (await req('/api/me', { token: t1 })).data.user.credits;
const idNo = await req('/api/tools/ideas_ai', { method: 'POST', token: t1, body: { titles: ['Como vencer no bedwars'] } });
check('Ideias sem IA: 409 sem cobrar', idNo.status === 409 && (await req('/api/me', { token: t1 })).data.user.credits === meI, `(status=${idNo.status})`);

console.log('\n== Meu canal com o YouTube simulado: só mexe no que é seu ==');
const mariaId = (await db.get('SELECT id FROM users WHERE email=?', ['maria@example.com'])).id;
await db.run('INSERT INTO yt_tokens(user_id,access_token,refresh_token,expires_at,channel_id,channel_title,scopes,updated_at) VALUES(?,?,?,?,?,?,?,?)',
  [mariaId, fake.token, null, Date.now() + 3600e3, null, null, 'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/yt-analytics.readonly', new Date().toISOString()]);
const meC = await req('/api/me', { token: t1 });
check('conta aparece com o canal vinculado', meC.data.user?.youtube?.connected === true);
const bal = async () => (await req('/api/me', { token: t1 })).data.user.credits;
const vids = await req('/api/channel/videos', { token: t1 });
check('lista só os vídeos do próprio canal, com SEO e VPH', vids.status === 200 && vids.data.videos?.length === 2 && vids.data.videos.every((v) => v.id.startsWith('vidMeu')) && typeof vids.data.videos[0].seoScore === 'number' && vids.data.videos[0].vph > 0, JSON.stringify(vids.data).slice(0, 200));
check('canal vinculado fica salvo com o nome', (await db.get('SELECT channel_title FROM yt_tokens WHERE user_id=?', [mariaId])).channel_title === 'Canal do Teste');

let b0 = await bal();
const alheio = await req('/api/channel/videos/vidAlheio01', { method: 'PUT', token: t1, body: { title: 'tentando mudar o vídeo dos outros' } });
check('vídeo de OUTRO canal: bloqueado (403) e crédito devolvido', alheio.status === 403 && (await bal()) === b0, `(status=${alheio.status})`);
check('nenhum pedido de alteração chegou ao YouTube para o vídeo alheio', !fake.log.some((l) => l.op === 'videos.update' && l.body.id === 'vidAlheio01'));

b0 = await bal();
const up1 = await req('/api/channel/videos/vidMeu00001', { method: 'PUT', token: t1, body: { title: 'Como vencer no bedwars (2026)', description: 'Nova descrição', tags: ['bedwars', 'minecraft'], privacy: 'unlisted' } });
const lastUp = fake.log.filter((l) => l.op === 'videos.update').pop();
check('editar título, tags e visibilidade do MEU vídeo (10 créditos)', up1.status === 200 && up1.data.result?.title === 'Como vencer no bedwars (2026)' && up1.data.result?.privacy === 'unlisted' && (await bal()) === b0 - 10, JSON.stringify(up1.data).slice(0, 200));
check('mudar a visibilidade reenvia todos os campos de status (nada é apagado)', lastUp.part === 'snippet,status' && lastUp.body.status.privacyStatus === 'unlisted' && lastUp.body.status.embeddable === true && lastUp.body.status.license === 'youtube' && lastUp.body.status.publicStatsViewable === true && lastUp.body.status.selfDeclaredMadeForKids === false, JSON.stringify(lastUp));
await req('/api/channel/videos/vidMeu00001', { method: 'PUT', token: t1, body: { title: 'Só o título', privacy: 'unlisted' } });
check('sem mudar a visibilidade, o status não é enviado', fake.log.filter((l) => l.op === 'videos.update').pop().part === 'snippet');
await req('/api/channel/videos/vidMeu00002', { method: 'PUT', token: t1, body: { title: 'Vídeo agendado', privacy: 'public' } });
const pubUp = fake.log.filter((l) => l.op === 'videos.update').pop();
check('publicar um vídeo agendado tira o agendamento e mantém o resto', pubUp.body.status.privacyStatus === 'public' && !('publishAt' in pubUp.body.status) && pubUp.body.status.license === 'creativeCommon', JSON.stringify(pubUp.body.status));

const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
const th = await req('/api/channel/videos/vidMeu00001/thumbnail', { method: 'POST', token: t1, body: { image: png } });
check('enviar capa para o MEU vídeo chega ao YouTube como imagem', th.status === 200 && fake.log.some((l) => l.op === 'thumbnails.set' && l.videoId === 'vidMeu00001' && l.type === 'image/png' && l.bytes > 0));
b0 = await bal();
const th2 = await req('/api/channel/videos/vidAlheio01/thumbnail', { method: 'POST', token: t1, body: { image: png } });
check('capa em vídeo alheio: bloqueada e sem cobrança', th2.status === 403 && (await bal()) === b0);

const pls = await req('/api/channel/playlists', { token: t1 });
check('playlists: lista só as do meu canal', pls.status === 200 && pls.data.items.length === 1 && pls.data.items[0].id === 'PL_MEU1' && pls.data.items[0].count === 1);
b0 = await bal();
const plNew = await req('/api/channel/playlists', { method: 'POST', token: t1, body: { title: 'Tutoriais', privacy: 'unlisted' } });
check('criar playlist (10 créditos)', plNew.status === 200 && plNew.data.result?.id?.startsWith('PL_NOVA') && (await bal()) === b0 - 10);
const plAdd = await req('/api/channel/playlists/' + plNew.data.result.id + '/items', { method: 'POST', token: t1, body: { video_id: 'vidMeu00002' } });
check('adicionar vídeo à playlist', plAdd.status === 200 && fake.items[plNew.data.result.id].includes('vidMeu00002'));
b0 = await bal();
const plBad = await req('/api/channel/playlists/PL_ALHEIA/items', { method: 'POST', token: t1, body: { video_id: 'vidMeu00001' } });
check('playlist de outro canal: bloqueada (403) e crédito devolvido', plBad.status === 403 && (await bal()) === b0, `(status=${plBad.status})`);
const plItems = await req('/api/channel/playlists/' + plNew.data.result.id + '/items', { token: t1 });
check('ver os vídeos da playlist', plItems.status === 200 && plItems.data.items.length === 1 && plItems.data.items[0].videoId === 'vidMeu00002');
const plDel = await req('/api/channel/playlists/' + plNew.data.result.id + '/items/' + plItems.data.items[0].itemId, { method: 'DELETE', token: t1 });
check('tirar vídeo da playlist', plDel.status === 200 && fake.items[plNew.data.result.id].length === 0);

const ovBefore = (await req('/api/admin/overview', { token: tOwn })).data.youtubeQuota.usedToday;
const upS = await req('/api/channel/upload/start', { method: 'POST', token: t1, body: { title: 'Meu vídeo novo', description: 'x', tags: ['a'], privacy: 'private', size: 1000, mime: 'video/mp4' } });
const ovAfter = (await req('/api/admin/overview', { token: tOwn })).data.youtubeQuota.usedToday;
check('postar vídeo: abre a sessão de envio direto para o Google', upS.status === 200 && upS.data.result?.uploadUrl?.startsWith('https://upload.example.test/') && fake.log.some((l) => l.op === 'videos.insert(resumable)' && l.body.snippet.title === 'Meu vídeo novo' && l.size === '1000'));
check('envio conta 1.600 unidades na cota do dia', ovAfter - ovBefore >= 1600, `(${ovBefore} -> ${ovAfter})`);
const sched = await req('/api/channel/upload/start', { method: 'POST', token: t1, body: { title: 'Agendado', privacy: 'public', publishAt: new Date(Date.now() + 86400e3).toISOString(), size: 10 } });
check('agendar publicação envia como privado com data', sched.status === 200 && sched.data.result.scheduled === true && fake.log.filter((l) => l.op === 'videos.insert(resumable)').pop().body.status.privacyStatus === 'private');

const live = await req('/api/channel/live', { method: 'POST', token: t1, body: { title: 'Live de teste', privacy: 'unlisted' } });
check('criar live devolve RTMP e chave de transmissão', live.status === 200 && live.data.result?.rtmpUrl?.startsWith('rtmp://') && live.data.result?.streamKey === 'abcd-efgh-ijkl' && live.data.result.watchUrl.includes('live12345ab'));
const anC = await req('/api/channel/analytics?days=28', { token: t1 });
check('analytics soma views, minutos e inscritos líquidos', anC.status === 200 && anC.data.totals.views === 150 && anC.data.totals.minutes === 420 && anC.data.totals.subs === 6 && anC.data.topVideos[0]?.title === fake.videos.vidMeu00001.snippet.title, JSON.stringify(anC.data.totals));
const cms = await req('/api/channel/comments', { token: t1 });
const repC = await req('/api/channel/comments/cm1/reply', { method: 'POST', token: t1, body: { text: 'Valeu!' } });
check('comentários: lista e responde', cms.status === 200 && cms.data.items[0]?.text === 'Que vídeo top!' && repC.status === 200 && fake.log.some((l) => l.op === 'comments.insert' && l.body.snippet.parentId === 'cm1'));
const ownC = await req('/api/channel/videos', { token: tOwn });
check('quem não vinculou canal recebe aviso para vincular (409)', ownC.status === 409);

console.log('\n== IA ligada (Gemini simulado): troca de modelo, IA do vídeo, capa a partir do vídeo ==');
const { setSetting } = await import('../src/db.js');
await setSetting(db, 'gemini_api_key', 'chave-errada');
b0 = await bal();
const badKey = await req('/api/tools/prep_ai', { method: 'POST', token: t1, body: { topic: 'bedwars' } });
check('chave recusada pelo Google: aviso claro e créditos devolvidos', badKey.status === 409 && /recusada/.test(badKey.data.error || '') && (await bal()) === b0, `(status=${badKey.status} ${badKey.data.error})`);
await setSetting(db, 'gemini_api_key', gem.key);
const aiT = await req('/api/admin/ai-test', { method: 'POST', token: tOwn });
check('Admin "Testar a IA": funciona e pula o modelo que a chave não acessa', aiT.status === 200 && aiT.data.ok === true && aiT.data.modelo === 'gemini-3.6-flash', JSON.stringify(aiT.data));
const aiTUser = await req('/api/admin/ai-test', { method: 'POST', token: t1 });
check('usuário comum não acessa o teste da IA', aiTUser.status === 403);
const prepAI = await req('/api/tools/prep_ai', { method: 'POST', token: t1, body: { topic: 'bedwars no minecraft' } });
check('Preparar com IA de verdade (15 créditos)', prepAI.status === 200 && prepAI.data.result.metodo === 'ia' && prepAI.data.result.titulos.length === 5 && prepAI.data.credits.charged === 15);
const repAI = await req('/api/tools/reply_ai', { method: 'POST', token: t1, body: { comment: 'top!' } });
check('Resposta a comentário com IA (lê JSON mesmo vindo em bloco de código)', repAI.status === 200 && repAI.data.result.respostas.length === 3);
const idBad = await req('/api/tools/ideas_ai', { method: 'POST', token: t1, body: {} });
check('Ideias sem tema e sem canal: 400 sem cobrar', idBad.status === 400);
const idOk = await req('/api/tools/ideas_ai', { method: 'POST', token: t1, body: { titles: ['Como vencer no bedwars', 'Bedwars sem gastar nada'] } });
check('Ideias com IA: 10 ideias (10 créditos)', idOk.status === 200 && idOk.data.result.ideias.length === 10 && idOk.data.credits.charged === 10);
process.env.GEMINI_RETRY_MS = '10';
gem.state.busy = new Set(['gemini-3.6-flash']);
const busy1 = await req('/api/tools/prep_ai', { method: 'POST', token: t1, body: { topic: 'bedwars' } });
check('modelo sobrecarregado: tenta de novo e usa outro modelo sozinho', busy1.status === 200 && busy1.data.result.modelo !== 'gemini-3.6-flash', JSON.stringify({ s: busy1.status, m: busy1.data.result?.modelo, e: busy1.data.error }));
gem.state.busy = new Set(['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview', 'gemini-2.5-flash']);
b0 = await bal();
const busy2 = await req('/api/tools/prep_ai', { method: 'POST', token: t1, body: { topic: 'bedwars' } });
check('todos sobrecarregados: aviso em português e créditos devolvidos', busy2.status === 503 && /sobrecarregada/.test(busy2.data.error) && (await bal()) === b0, busy2.data.error);
gem.state.busy = new Set();
const ownPrep = await req('/api/tools/prep_ai', { method: 'POST', token: tOwn, body: { topic: 'geometry dash' } });
check('owner usa a IA sem cobrança', ownPrep.status === 200 && ownPrep.data.credits.charged === 0 && ownPrep.data.credits.unlimited === true);

process.env.YT_MOCK = '0'; // a IA do vídeo lê os dados reais do vídeo (aqui, no YouTube simulado)
fake.videos.vidMeu00001.status.privacyStatus = 'public'; // os testes anteriores deixaram como não listado
b0 = await bal();
gem.state.log.length = 0;
const va = await req('/api/tools/video_insights_ai', { method: 'POST', token: t1, body: { video: 'https://youtu.be/vidMeu00001' } });
const vaReq = gem.state.log.find((l) => !l.isImage);
const sg = va.data.result?.sugestoes || {};
check('IA do vídeo: assiste (vídeo público), recebe quadros reais e reconhece que o vídeo é seu', va.status === 200 && va.data.result.own === true && va.data.result.assistiu === true && vaReq?.video === true && vaReq?.images === 3, JSON.stringify({ s: va.status, e: va.data.error, own: va.data.result?.own, log: vaReq && { v: vaReq.video, i: vaReq.images } }));
check('IA do vídeo custa 300 créditos para usuário comum', va.data.credits?.charged === 300 && (await bal()) === b0 - 300);
check('sugestões dentro dos limites do YouTube (tags ≤ 480 caracteres, sem #, sem repetidas)', sg.tags.length > 5 && sg.tags.join(',').length <= 480 && sg.tags.every((t) => !t.startsWith('#')) && new Set(sg.tags).size === sg.tags.length, sg.tags.join(',').length);
check('títulos sem repetição, hashtags com #, capítulos válidos começando em 00:00', sg.titulos.length === 2 && sg.hashtags.every((h) => h.startsWith('#')) && sg.capitulos.length === 3 && sg.capitulos[0].tempo === '00:00');
gem.state.log.length = 0;
fake.videos.vidMeu00002.status = { privacyStatus: 'private', license: 'youtube', embeddable: true, publicStatsViewable: true, madeForKids: false };
const vp = await req('/api/tools/video_insights_ai', { method: 'POST', token: t1, body: { video: 'vidMeu00002' } });
const vpReq = gem.state.log.find((l) => !l.isImage);
check('vídeo privado: a IA não tenta assistir nem pegar quadros e não inventa capítulos', vp.status === 200 && vp.data.result.assistiu === false && vpReq.video === false && vpReq.images === 0 && vp.data.result.sugestoes.capitulos.length === 0, JSON.stringify(vp.data).slice(0, 200));
gem.state.videoFails = true;
const vf = await req('/api/tools/video_insights_ai', { method: 'POST', token: t1, body: { video: 'vidMeu00001' } });
gem.state.videoFails = false;
check('se a IA não consegue assistir, usa quadros e dados (e avisa)', vf.status === 200 && vf.data.result.assistiu === false && vf.data.result.quadros === 3 && /não pôde assistir/.test(vf.data.result.aviso));
const vo = await req('/api/tools/video_insights_ai', { method: 'POST', token: t1, body: { video: 'vidAlheio01' } });
check('vídeo público de outro canal: analisa, mas marca que não é seu (sem salvar)', vo.status === 200 && vo.data.result.own === false);

const vpan = await req('/api/tools/video_panel', { method: 'POST', token: t1, body: { video: 'vidAlheio01' } });
check('painel da extensão traz o canal (inscritos, idade, tags do canal) e custa 1 crédito', vpan.status === 200 && vpan.data.result.channel?.subs === 50000 && vpan.data.result.channel.keywords.includes('geometry dash') && vpan.data.result.channel.handle === '@outrocanal' && vpan.data.credits.charged === 1, JSON.stringify(vpan.data).slice(0, 300));
check('painel marca as tags que aparecem no título', Array.isArray(vpan.data.result.seoTags?.noTitulo));
b0 = await bal();
const coach = await req('/api/tools/coach_ai', { method: 'POST', token: t1, body: { video: 'vidAlheio01' } });
check('análise da IA na extensão: resumo, nota do gancho, desempenho, 3 ideias e dicas (300 créditos)', coach.status === 200 && coach.data.result.gancho.nota === 7 && coach.data.result.ideias.length === 3 && coach.data.result.inscritos.length === 3 && coach.data.result.desempenho.veredito && coach.data.credits.charged === 300 && (await bal()) === b0 - 300, JSON.stringify(coach.data).slice(0, 300));
const extv = await req('/api/extension/version');
check('site informa a versão atual da extensão (para o aviso de atualização)', extv.status === 200 && /^\d+\.\d+\.\d+$/.test(extv.data.version || ''), JSON.stringify(extv.data));
const noThumb = await req('/api/channel/videos/vidMeu00001/ai-thumbnail', { method: 'POST', token: t1, body: {} });
check('capa com IA foi retirada (a rota não existe mais)', noThumb.status === 404);
b0 = await bal();
const tf = await req('/api/tools/transform_ai', { method: 'POST', token: t1, body: { video: 'vidMeu00001', mode: 'shorts' } });
check('Transformar em Shorts devolve exatamente 3 cortes (40 créditos)', tf.status === 200 && tf.data.result.resultado.cortes.length === 3 && tf.data.credits.charged === 40 && (await bal()) === b0 - 40, JSON.stringify(tf.data).slice(0, 200));
process.env.YT_MOCK = '1';
const trN = await req('/api/tools/trends', { method: 'POST', token: t1, body: { keywords: ['bedwars', 'geometry dash', 'extra'], categoryId: '20' } });
check('Tendências do nicho: até 2 termos do canal + categoria do canal', trN.status === 200 && trN.data.result.groups.length === 3 && trN.data.result.nicho.length === 2 && trN.data.result.categoria === 'Jogos', JSON.stringify(trN.data).slice(0, 200));
const costsNow = (await req('/api/tools/costs')).data.costs;
check('preços: IA do vídeo a 300 créditos e capa com IA fora da tabela', costsNow.find((c) => c.tool === 'video_insights_ai').cost === 300 && !costsNow.some((c) => c.tool === 'thumbnail_ai'));

// ---------- Créditos mensais do plano Free ----------
console.log('\n— Créditos mensais —');
const maria = await db.get('SELECT * FROM users WHERE email=?', ['maria@example.com']);
const mesAtual = new Date().toISOString().slice(0, 7);
const mesPassado = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15)).toISOString().slice(0, 7);

// gastou quase tudo e o mês virou
await db.run('UPDATE users SET credits=?, last_refill=? WHERE id=?', [12, mesPassado, maria.id]);
await req('/api/me', { token: t1 });
let depois = await db.get('SELECT credits,last_refill FROM users WHERE id=?', [maria.id]);
check('virou o mês: o saldo do Free é completado até 5.000 no primeiro uso', depois.credits === 5000 && depois.last_refill === mesAtual, JSON.stringify(depois));

const txRec = await db.get("SELECT * FROM transactions WHERE user_id=? AND note LIKE 'Recarga mensal%' ORDER BY created_at DESC", [maria.id]);
check('a recarga fica registrada no histórico do usuário', !!txRec && txRec.delta === 4988, JSON.stringify(txRec).slice(0, 120));

// no mesmo mês não recarrega de novo
await db.run('UPDATE users SET credits=? WHERE id=?', [40, maria.id]);
await req('/api/me', { token: t1 });
depois = await db.get('SELECT credits FROM users WHERE id=?', [maria.id]);
check('no mesmo mês não recarrega de novo (não dá para repetir o mês)', depois.credits === 40, String(depois.credits));

// completa até, não soma: quem tem mais que o teto não perde nem ganha
await db.run('UPDATE users SET credits=?, last_refill=? WHERE id=?', [7000, mesPassado, maria.id]);
await req('/api/me', { token: t1 });
depois = await db.get('SELECT credits FROM users WHERE id=?', [maria.id]);
check('quem tem mais que o teto não perde o saldo nem ganha de novo', depois.credits === 7000, String(depois.credits));

// o administrador pode AUMENTAR a recarga mensal
const setTop = await req('/api/admin/settings', { method: 'PUT', token: tOwn, body: { updates: { free_monthly_topup: '9000' } } });
await db.run('UPDATE users SET credits=?, last_refill=? WHERE id=?', [100, mesPassado, maria.id]);
await req('/api/me', { token: t1 });
depois = await db.get('SELECT credits FROM users WHERE id=?', [maria.id]);
check('o administrador pode aumentar a recarga mensal (9.000 no mês seguinte)', setTop.status === 200 && depois.credits === 9000, String(depois.credits));
await req('/api/admin/settings', { method: 'PUT', token: tOwn, body: { updates: { free_monthly_topup: '5000' } } });

// plano pago: os créditos entram quando o pagamento é confirmado, e NÃO caem para o teto do Free
const planoPago = await db.get("SELECT * FROM plans WHERE id<>'free' AND active=1 ORDER BY price_cents LIMIT 1");
const { activatePayment } = await import('../src/payments.js');
await db.run('INSERT INTO payments(id,user_id,plan_id,amount_cents,status,provider,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
  ['pay_teste_1', maria.id, planoPago.id, planoPago.price_cents, 'pending', 'teste', new Date().toISOString(), new Date().toISOString()]);
const antesPago = (await db.get('SELECT credits FROM users WHERE id=?', [maria.id])).credits;
await activatePayment(db, { id: 'pay_teste_1' }, null, 'teste');
const depoisPago = await db.get('SELECT credits,plan_id FROM users WHERE id=?', [maria.id]);
check(`pagamento confirmado: entra o plano ${planoPago.id} e soma ${planoPago.monthly_credits} créditos`,
  depoisPago.plan_id === planoPago.id && depoisPago.credits === antesPago + planoPago.monthly_credits, JSON.stringify(depoisPago));

await db.run('UPDATE users SET last_refill=? WHERE id=?', [mesPassado, maria.id]);
await req('/api/me', { token: t1 });
const pagoDepoisDoMes = await db.get('SELECT credits FROM users WHERE id=?', [maria.id]);
check('plano pago não é rebaixado para o teto do Free quando o mês vira', pagoDepoisDoMes.credits === depoisPago.credits, String(pagoDepoisDoMes.credits));

const segundoPag = await activatePayment(db, { id: 'pay_teste_1' }, null, 'teste');
const semDobra = await db.get('SELECT credits FROM users WHERE id=?', [maria.id]);
check('confirmar o mesmo pagamento duas vezes não dá crédito em dobro', semDobra.credits === pagoDepoisDoMes.credits, String(semDobra.credits));


// ---------- Avaliações e comentários sobre o site ----------
console.log('\n— Avaliações e comentários do site —');
const uAna = await req('/api/auth/register', { method: 'POST', body: { email: 'ana@example.com', password: 'senha12345', name: 'Ana Souza' } });
const tAna = uAna.data.token;
// alguém da equipe (administrador adicionado pelo principal), para conferir o selo "equipe"
const uEq = await req('/api/auth/register', { method: 'POST', body: { email: 'equipe@example.com', password: 'senha12345', name: 'Equipe TurboCanal' } });
const tEq = uEq.data.token;
await req('/api/admin/admins', { method: 'POST', token: tOwn, body: { email: 'equipe@example.com' } });

const vazio = await req('/api/reviews');
check('sem nada publicado: total 0, média 0 e lista vazia (nada inventado)',
  vazio.status === 200 && vazio.data.total === 0 && vazio.data.resumo.media === 0 && vazio.data.itens.length === 0, JSON.stringify(vazio.data).slice(0, 160));

const semLogin = await req('/api/reviews', { method: 'POST', body: { estrelas: 5 } });
check('avaliar exige login', semLogin.status === 401);
const comentSemLogin = await req('/api/comments', { method: 'POST', body: { texto: 'oi' } });
check('comentar exige login', comentSemLogin.status === 401);

const saldoAntesAv = (await req('/api/me', { token: t1 })).data.user.credits;
const av1 = await req('/api/reviews', { method: 'POST', token: t1, body: { estrelas: 5, comentario: 'Mudou meu canal de patamar.' } });
check('criar avaliação de 5 estrelas com comentário', av1.status === 200 && av1.data.novo === true && av1.data.resumo.media === 5 && av1.data.resumo.total === 1, JSON.stringify(av1.data).slice(0, 140));
check('avaliar NÃO cobra créditos', (await req('/api/me', { token: t1 })).data.user.credits === saldoAntesAv);

const av1b = await req('/api/reviews', { method: 'POST', token: t1, body: { estrelas: 4, comentario: 'Editei: muito bom, mas ainda falta app.' } });
const depoisEdit = await req('/api/reviews');
check('a mesma conta edita a sua avaliação em vez de criar outra',
  av1b.data.novo === false && depoisEdit.data.total === 1 && depoisEdit.data.resumo.media === 4, JSON.stringify(depoisEdit.data.resumo));
const avDono = await req('/api/reviews', { method: 'POST', token: tOwn, body: { estrelas: 5, comentario: 'Aviso do dono do site.' } });
const comDono = await req('/api/reviews');
const doDono = comDono.data.itens.find((i) => i.doDesenvolvedor);
check('a avaliação do DONO do site vem marcada como desenvolvedor', avDono.status === 200 && !!doDono && doDono.papel === 'owner', JSON.stringify(comDono.data.itens.map((i) => [i.autor, i.papel])));
const cDono = await req('/api/comments', { method: 'POST', token: tOwn, body: { texto: 'Bem-vindo ao TurboCanal!' } });
const cEquipe = await req('/api/comments', { method: 'POST', token: tEq, body: { texto: 'Qualquer dúvida é só chamar.' } });
const listaSelos = (await req('/api/reviews')).data.itens;
check('o COMENTÁRIO do dono também vem marcado como desenvolvedor',
  cDono.status === 200 && listaSelos.some((i) => i.tipo === 'comentario' && i.doDesenvolvedor), JSON.stringify(listaSelos.filter((i) => i.tipo === 'comentario').map((i) => [i.autor, i.papel])));
check('o comentário de um administrador vem marcado como equipe',
  cEquipe.status === 200 && listaSelos.some((i) => i.tipo === 'comentario' && i.daEquipe));
check('comentário de pessoa comum não ganha selo nenhum', listaSelos.every((i) => i.autor !== 'Maria' || i.papel === 'user'));
await req('/api/reviews/mine', { method: 'DELETE', token: tOwn });
for (const c of listaSelos.filter((i) => i.tipo === 'comentario' && (i.doDesenvolvedor || i.daEquipe))) {
  await req('/api/comments/' + c.id, { method: 'DELETE', token: tOwn });
}

check('o nome da conta aparece na avaliação (e nunca o e-mail)',
  depoisEdit.data.itens[0].autor === 'Maria' && !JSON.stringify(depoisEdit.data).includes('@example.com'), depoisEdit.data.itens[0].autor);

const av2 = await req('/api/reviews', { method: 'POST', token: tAna, body: { estrelas: 2, comentario: 'Travou na hora de postar.' } });
const comDuas = await req('/api/reviews');
check('média e distribuição saem da soma real (4 e 2 = 3,0)',
  av2.status === 200 && comDuas.data.resumo.media === 3 && comDuas.data.resumo.distribuicao['4'] === 1 && comDuas.data.resumo.distribuicao['2'] === 1, JSON.stringify(comDuas.data.resumo));
check('as barras vêm em porcentagem (50% cada)', comDuas.data.resumo.percentuais['4'] === 50 && comDuas.data.resumo.percentuais['2'] === 50);

// comentário solto: sem nota, quantos quiser, e NÃO mexe na média
const c1 = await req('/api/comments', { method: 'POST', token: tAna, body: { texto: 'Só uma dúvida: vai ter app de celular?' } });
const c2 = await req('/api/comments', { method: 'POST', token: tAna, body: { texto: 'Outro comentário meu, sem nota nenhuma.' } });
const comComentarios = await req('/api/reviews');
check('dá para comentar sem dar nota, e mais de uma vez na mesma conta',
  c1.status === 200 && c2.status === 200 && comComentarios.data.total === 4, JSON.stringify({ total: comComentarios.data.total }));
check('comentário solto NÃO entra na média nem na contagem de avaliações',
  comComentarios.data.resumo.media === 3 && comComentarios.data.resumo.total === 2 && comComentarios.data.resumo.comentarios === 2, JSON.stringify(comComentarios.data.resumo));
const soComent = comComentarios.data.itens.filter((i) => i.tipo === 'comentario');
check('o comentário vem marcado como comentário e sem estrelas', soComent.length === 2 && soComent[0].estrelas === null, JSON.stringify(soComent[0] || {}).slice(0, 120));
const comentVazio = await req('/api/comments', { method: 'POST', token: tAna, body: { texto: '   ' } });
check('comentário em branco é recusado', comentVazio.status === 400);
const comentLongo = await req('/api/comments', { method: 'POST', token: tAna, body: { texto: 'x'.repeat(1001) } });
check('comentário acima de 1.000 caracteres é recusado', comentLongo.status === 400);

for (const [nota, nome] of [[0, 'zero'], [6, 'seis'], [3.5, 'quebrada'], ['cinco', 'texto']]) {
  const r = await req('/api/reviews', { method: 'POST', token: tAna, body: { estrelas: nota } });
  check(`nota ${nome} é recusada pelo servidor`, r.status === 400, String(r.status));
}

const melhores = await req('/api/reviews?sort=melhores');
check('ordenar por melhor avaliação põe as com nota na frente e os comentários no fim',
  melhores.data.itens[0].estrelas === 4 && melhores.data.itens[melhores.data.itens.length - 1].tipo === 'comentario', JSON.stringify(melhores.data.itens.map((i) => i.estrelas)));
const pag = await req('/api/reviews?limit=2&page=2');
check('paginação funciona (2 por página, 2 páginas)', pag.data.paginas === 2 && pag.data.itens.length === 2 && pag.data.pagina === 2);

// respostas: dono = desenvolvedor, admin = equipe, e nessa ordem
const idAvMaria = melhores.data.itens[0].id;
const idComent = soComent[0].id;
const respUser = await req('/api/replies', { method: 'POST', token: tAna, body: { alvo_tipo: 'avaliacao', alvo_id: idAvMaria, texto: 'Também senti isso!' } });
const respEquipe = await req('/api/replies', { method: 'POST', token: tEq, body: { alvo_tipo: 'avaliacao', alvo_id: idAvMaria, texto: 'Oi! Aqui é a equipe.' } });
const respDev = await req('/api/replies', { method: 'POST', token: tOwn, body: { alvo_tipo: 'avaliacao', alvo_id: idAvMaria, texto: 'Obrigado! O app está no nosso plano.' } });
const comResp = await req('/api/reviews?sort=melhores');
const respostas = comResp.data.itens[0].respostas;
check('dá para responder a uma avaliação', respUser.status === 200 && respEquipe.status === 200 && respDev.status === 200 && respostas.length === 3);
check('a resposta do desenvolvedor (dono) vem em primeiro lugar, depois a da equipe, depois a dos outros',
  respostas[0].doDesenvolvedor === true && respostas[1].daEquipe === true && respostas[2].papel === 'user',
  JSON.stringify(respostas.map((r) => [r.autor, r.papel])));
const respComent = await req('/api/replies', { method: 'POST', token: tOwn, body: { alvo_tipo: 'comentario', alvo_id: idComent, texto: 'Boa pergunta: ainda não, mas o site abre no celular.' } });
const listaComResp = await req('/api/reviews');
const comentComResp = listaComResp.data.itens.find((i) => i.id === idComent);
check('também dá para responder um comentário solto, com destaque do desenvolvedor',
  respComent.status === 200 && comentComResp.respostas.length === 1 && comentComResp.respostas[0].doDesenvolvedor === true, JSON.stringify(comentComResp?.respostas || []).slice(0, 140));

// gostei / não gostei em avaliação, comentário e resposta
const votoProprio = await req('/api/votes', { method: 'POST', token: t1, body: { alvo_tipo: 'avaliacao', alvo_id: idAvMaria, valor: 1 } });
check('ninguém vota no que escreveu', votoProprio.status === 400);
const v1 = await req('/api/votes', { method: 'POST', token: tAna, body: { alvo_tipo: 'avaliacao', alvo_id: idAvMaria, valor: 1 } });
check('gostei na avaliação conta 1', v1.status === 200 && v1.data.gostei === 1 && v1.data.naoGostei === 0, JSON.stringify(v1.data));
const v2 = await req('/api/votes', { method: 'POST', token: tAna, body: { alvo_tipo: 'avaliacao', alvo_id: idAvMaria, valor: -1 } });
check('trocar para não gostei move o voto (não soma os dois)', v2.data.gostei === 0 && v2.data.naoGostei === 1, JSON.stringify(v2.data));
const v3 = await req('/api/votes', { method: 'POST', token: tAna, body: { alvo_tipo: 'avaliacao', alvo_id: idAvMaria, valor: 0 } });
check('votar 0 desfaz o voto', v3.data.gostei === 0 && v3.data.naoGostei === 0);
const vc = await req('/api/votes', { method: 'POST', token: t1, body: { alvo_tipo: 'comentario', alvo_id: idComent, valor: 1 } });
check('dá para votar em um comentário solto', vc.status === 200 && vc.data.gostei === 1, JSON.stringify(vc.data));
const vr = await req('/api/votes', { method: 'POST', token: tAna, body: { alvo_tipo: 'resposta', alvo_id: respostas[0].id, valor: 1 } });
check('dá para votar em uma resposta', vr.status === 200 && vr.data.gostei === 1);
const comVoto = await req('/api/reviews?sort=melhores', { token: tAna });
check('o site mostra o voto de quem está logado (para marcar o botão)', comVoto.data.itens[0].respostas[0].meuVoto === 1);

// denúncia e moderação
const idAvAna = (await req('/api/reviews?sort=recentes')).data.itens.find((i) => i.tipo === 'avaliacao' && i.autor === 'Ana Souza').id;
const den1 = await req('/api/reports', { method: 'POST', token: t1, body: { alvo_tipo: 'avaliacao', alvo_id: idAvAna, motivo: 'Comentário ofensivo' } });
const den2 = await req('/api/reports', { method: 'POST', token: t1, body: { alvo_tipo: 'avaliacao', alvo_id: idAvAna, motivo: 'de novo' } });
check('denunciar funciona e não duplica para a mesma pessoa', den1.status === 200 && den2.data.repetida === true);
const listaDen = await req('/api/admin/reviews/reports', { token: tOwn });
check('o administrador vê a denúncia com o conteúdo denunciado', listaDen.status === 200 && listaDen.data.itens.length === 1 && listaDen.data.itens[0].alvo.texto.includes('Travou'), JSON.stringify(listaDen.data.itens[0] || {}).slice(0, 140));
check('usuário comum não vê as denúncias', (await req('/api/admin/reviews/reports', { token: t1 })).status === 403);

const mod = await req('/api/admin/moderate', { method: 'POST', token: tOwn, body: { alvo_tipo: 'avaliacao', alvo_id: idAvAna, remover: true, motivo: 'linguagem imprópria' } });
const depoisMod = await req('/api/reviews');
check('avaliação removida pela moderação sai da lista e da média',
  mod.status === 200 && depoisMod.data.resumo.total === 1 && depoisMod.data.resumo.media === 4, JSON.stringify(depoisMod.data.resumo));
const reenvio = await req('/api/reviews', { method: 'POST', token: tAna, body: { estrelas: 5, comentario: 'tentando de novo' } });
check('quem teve a avaliação removida não reenvia por cima', reenvio.status === 403);
const modComent = await req('/api/admin/moderate', { method: 'POST', token: tOwn, body: { alvo_tipo: 'comentario', alvo_id: idComent, remover: true, motivo: 'fora do assunto' } });
check('o administrador também modera comentário solto', modComent.status === 200 && (await req('/api/reviews')).data.resumo.comentarios === 1);
const restaura = await req('/api/admin/moderate', { method: 'POST', token: tOwn, body: { alvo_tipo: 'avaliacao', alvo_id: idAvAna, remover: false, motivo: 'revisado' } });
check('o administrador pode restaurar', restaura.status === 200 && (await req('/api/reviews')).data.resumo.total === 2);

// ninguém mexe no que é de outro
check('ninguém apaga a resposta de outra pessoa', (await req(`/api/replies/${respostas[2].id}`, { method: 'DELETE', token: t1 })).status === 403);
check('cada um apaga a própria resposta', (await req(`/api/replies/${respostas[2].id}`, { method: 'DELETE', token: tAna })).status === 200);
const outroComent = (await req('/api/reviews')).data.itens.find((i) => i.tipo === 'comentario');
check('ninguém apaga o comentário de outra pessoa', (await req(`/api/comments/${outroComent.id}`, { method: 'DELETE', token: t1 })).status === 403);
check('cada um apaga o próprio comentário', (await req(`/api/comments/${outroComent.id}`, { method: 'DELETE', token: tAna })).status === 200);

const minha = await req('/api/reviews/mine', { token: t1 });
check('a conta consegue ver a própria avaliação para editar', minha.status === 200 && minha.data.avaliacao.estrelas === 4);
const apagar = await req('/api/reviews/mine', { method: 'DELETE', token: t1 });
const depoisApagar = await req('/api/reviews');
check('apagar a própria avaliação recalcula a média na hora',
  apagar.status === 200 && depoisApagar.data.resumo.total === 1 && depoisApagar.data.resumo.media === 2, JSON.stringify(depoisApagar.data.resumo));


// ---------- Backup do banco ----------
console.log('\n— Backup do banco —');
const bkComum = await req('/api/admin/backup', { token: t1 });
check('usuário comum não baixa backup', bkComum.status === 403);
const bkAdmin = await req('/api/admin/backup', { token: tEq });
check('administrador comum também não baixa (só o principal)', bkAdmin.status === 403, String(bkAdmin.status));
const bk = await req('/api/admin/backup', { token: tOwn });
check('o administrador principal baixa o backup', bk.status === 200 && bk.data.tabelas && bk.data.resumo);
check('o backup traz os dados de verdade (usuários, planos, créditos)',
  bk.data.tabelas.users.length >= 2 && bk.data.tabelas.plans.length === 6 && bk.data.tabelas.transactions.length > 0, JSON.stringify(bk.data.resumo));
check('o backup NÃO leva senha nem chaves de API',
  bk.data.tabelas.users.every((u) => !u.pass_hash || u.pass_hash === '(removido do backup)')
  && !bk.data.tabelas.settings.some((r) => /api_key|jwt_secret|mp_access_token|setup_token/.test(r.key)),
  JSON.stringify(bk.data.tabelas.settings.map((r) => r.key)));
const resumoBk = await req('/api/admin/backup/resumo', { token: tOwn });
check('o painel mostra quantas linhas existem e quando foi o último backup',
  resumoBk.status === 200 && resumoBk.data.total > 0 && !!resumoBk.data.ultimo_backup, JSON.stringify(resumoBk.data).slice(0, 120));

// ---------- Ferramentas novas: auditoria do canal e laboratório de título ----------
console.log('\n— Auditoria do canal e título —');
let b0a = (await req('/api/me', { token: t1 })).data.user.credits;
const aud = await req('/api/tools/audit_ai', { method: 'POST', token: t1, body: {} });
check('auditoria do canal: nota, o que funciona, 5 melhorias e próximos vídeos',
  aud.status === 200 && typeof aud.data.result.nota === 'number' && aud.data.result.melhorias.length === 5
  && aud.data.result.funciona.length === 3 && aud.data.result.proximos.length === 3, JSON.stringify(aud.data).slice(0, 180));
check('cada melhoria vem com o dado que a sustenta', aud.data.result.melhorias.every((m) => m.dado && m.acao));
check('a auditoria diz em que se baseou (quantidade de vídeos e mediana)', aud.data.result.base?.videos > 0 && aud.data.result.base.medianaViews >= 0, JSON.stringify(aud.data.result.base));
check('a auditoria avisa que não tem retenção nem CTR', /retenção|CTR/i.test(aud.data.result.aviso || ''));
check('auditoria custa 200 créditos', aud.data.credits.charged === 200 && (await req('/api/me', { token: t1 })).data.user.credits === b0a - 200);

b0a = (await req('/api/me', { token: t1 })).data.user.credits;
const tl = await req('/api/tools/title_lab', { method: 'POST', token: t1, body: { titulo: 'EU FIZ ISSO', palavra: 'bedwars' } });
check('laboratório de título: nota medida aqui, diagnóstico e 5 alternativas',
  tl.status === 200 && tl.data.result.alternativas.length === 5 && tl.data.result.checagem.length === 6, JSON.stringify(tl.data).slice(0, 160));
check('título curto, em caixa alta e sem a palavra-chave tira nota baixa', tl.data.result.nota <= 40, String(tl.data.result.nota));
const tlBom = await req('/api/tools/title_lab', { method: 'POST', token: t1, body: { titulo: 'Como vencer no bedwars: 7 truques que funcionam', palavra: 'bedwars' } });
check('título bom tira nota alta', tlBom.data.result.nota >= 80, String(tlBom.data.result.nota));
check('laboratório de título custa 100 créditos', tl.data.credits.charged === 100);
check('título é obrigatório', (await req('/api/tools/title_lab', { method: 'POST', token: t1, body: {} })).status === 400);
const custos = (await req('/api/tools/costs')).data.costs;
check('as duas ferramentas novas aparecem na tabela de preços',
  custos.find((c) => c.tool === 'audit_ai')?.cost === 200 && custos.find((c) => c.tool === 'title_lab')?.cost === 100);

// ---------- Melhor horário para publicar ----------
console.log('\n— Melhor horário para publicar —');
const { analisarHorarios, mediana, partesLocais } = await import('../src/schedule.js');
check('mediana ignora o viral: [1,2,3,1000] dá 3 e não 251 (que seria a média)', mediana([1, 2, 3, 1000]) === 3 && mediana([1, 2, 3]) === 2 && mediana([5]) === 5 && mediana([]) === 0);
const pl = partesLocais('2026-03-10T01:00:00Z', 'America/Sao_Paulo');
check('converte o horário UTC para o fuso do usuário (01h de terça em Brasília ainda é segunda, 22h)', pl.dia === 1 && pl.hora === 22, JSON.stringify(pl));

// Canal de teste: 5 vídeos no sábado à noite (10 mil views) e 6 na terça de manhã (mil views)
const spIso = (data, hora) => new Date(`${data}T${String(hora).padStart(2, '0')}:00:00-03:00`).toISOString();
const sabados = ['2026-01-03', '2026-01-10', '2026-01-17', '2026-01-24', '2026-01-31'];
const tercas = ['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27', '2026-02-03', '2026-02-10'];
const amostra = [
  ...sabados.map((d, i) => ({ titulo: `Sábado ${i}`, views: 10000 + i, publicado: spIso(d, 19) })),
  ...tercas.map((d, i) => ({ titulo: `Terça ${i}`, views: 1000 + i, publicado: spIso(d, 7) }))
];
const anH = analisarHorarios(amostra, { tz: 'America/Sao_Paulo', agora: '2026-06-01T00:00:00Z' });
check('acha o melhor dia e a melhor faixa pela mediana de views', anH.melhorDia.nome === 'sábado' && anH.melhorFaixa.nome === '18h–21h', `${anH.melhorDia?.nome} / ${anH.melhorFaixa?.nome}`);
check('acha também o pior dia e a pior faixa', anH.piorDia.nome === 'terça-feira' && anH.piorFaixa.nome === '06h–09h', `${anH.piorDia?.nome} / ${anH.piorFaixa?.nome}`);
check('cruza dia + horário quando aquela célula tem amostra', anH.combinacao && anH.combinacao.nome === 'sábado, 18h–21h' && anH.combinacao.videos === 5, JSON.stringify(anH.combinacao));
check('a recomendação cita a mediana, a diferença e em quantos vídeos se baseia',
  /sábado/.test(anH.recomendacao) && /5 vídeo/.test(anH.recomendacao) && /%/.test(anH.recomendacao), anH.recomendacao);
check('diz em que se baseou: 11 vídeos considerados e a mediana geral', anH.base.considerados === 11 && anH.base.medianaGeral === 1005, JSON.stringify(anH.base));
check('avisa que mede o horário da publicação, não o da audiência', anH.avisos.some((a) => /publicado/i.test(a) && /assisti/i.test(a)));
check('grupo com menos de 3 vídeos não entra como recomendação',
  analisarHorarios([...amostra.slice(0, 2)], { agora: '2026-06-01T00:00:00Z' }).combinacao === null);

const anNovo = analisarHorarios([...amostra, { titulo: 'recém-saído', views: 5, publicado: '2026-05-25T12:00:00Z' }], { agora: '2026-06-01T00:00:00Z' });
check('vídeo novo demais fica de fora da conta (ainda está somando views)',
  anNovo.base.considerados === 11 && anNovo.base.ignoradosNovos === 1 && anNovo.avisos.some((a) => /últimos 21 dias/.test(a)), JSON.stringify(anNovo.base));
const anSemData = analisarHorarios([...amostra, { titulo: 'sem data', views: 9 }], { agora: '2026-06-01T00:00:00Z' });
check('vídeo sem data válida é ignorado e contado no aviso', anSemData.base.ignoradosSemData === 1 && anSemData.base.considerados === 11);
const anPouco = analisarHorarios(amostra.slice(0, 4), { agora: '2026-06-01T00:00:00Z' });
check('com pouca amostra o resultado avisa em vez de recomendar com segurança', anPouco.avisos.some((a) => /uns 20/.test(a)));
const anMesmaFaixa = analisarHorarios(tercas.map((d, i) => ({ views: 100 + i, publicado: spIso(d, 7) })), { agora: '2026-06-01T00:00:00Z' });
check('se tudo saiu na mesma faixa, diz que não há horários para comparar', anMesmaFaixa.avisos.some((a) => /mesma faixa/.test(a)));
check('fuso inválido não passa', (() => { try { analisarHorarios(amostra, { tz: 'Nao/Existe' }); return false; } catch (e) { return e.status === 400; } })());

const b0h = (await req('/api/me', { token: t1 })).data.user.credits;
const bt = await req('/api/tools/best_time', { method: 'POST', token: t1, body: { fuso: 'America/Sao_Paulo' } });
check('o endpoint pega os vídeos do canal no servidor e devolve a análise',
  bt.status === 200 && bt.data.result.fuso === 'America/Sao_Paulo' && Array.isArray(bt.data.result.dias) && bt.data.result.dias.length === 7, JSON.stringify(bt.data).slice(0, 180));
check('canal com só um vídeo recém-postado: não inventa recomendação',
  bt.data.result.recomendacao === null && bt.data.result.base.considerados === 0 && bt.data.result.base.ignoradosNovos === 1, JSON.stringify(bt.data.result.base));
check('melhor horário custa 10 créditos', bt.data.credits.charged === 10 && (await req('/api/me', { token: t1 })).data.user.credits === b0h - 10);
check('melhor horário aparece na tabela de preços',
  (await req('/api/tools/costs')).data.costs.find((c) => c.tool === 'best_time')?.cost === 10);
check('melhor horário exige login', (await req('/api/tools/best_time', { method: 'POST', body: {} })).status === 401);

// ---------- Avisos e cards do painel ----------
console.log('\n— Avisos e cards —');
const vazioBl = await req('/api/blocks?pagina=home');
check('sem nada criado, a página não mostra aviso nenhum', vazioBl.status === 200 && vazioBl.data.itens.length === 0);

const criarComum = await req('/api/admin/blocks', { method: 'POST', token: t1, body: { tipo: 'aviso', pagina: 'home', slot: 'topo', titulo: 'teste' } });
check('usuário comum não cria aviso (bloqueado no servidor)', criarComum.status === 403, String(criarComum.status));
check('usuário comum não vê a lista do painel', (await req('/api/admin/blocks', { token: t1 })).status === 403);

const av = await req('/api/admin/blocks', { method: 'POST', token: tOwn, body: {
  tipo: 'aviso', pagina: 'home', slot: 'topo', emoji: '⚠️',
  titulo: 'Plataforma em fase de testes', texto: 'Se encontrar algum erro, fale com a gente.', estilo: 'aviso' } });
check('o administrador principal cria um aviso', av.status === 200 && av.data.bloco.titulo === 'Plataforma em fase de testes', JSON.stringify(av.data).slice(0, 140));

const card = await req('/api/admin/blocks', { method: 'POST', token: tEq, body: {
  tipo: 'card', pagina: 'home', slot: 'lateral-direita', emoji: '🎬',
  titulo: 'Canal oficial do TurboCanal', texto: 'Dicas toda semana',
  link_url: 'https://www.youtube.com/@turbocanal', link_texto: 'Acessar' } });
check('administrador adicionado por mim também cria (card com link)', card.status === 200 && card.data.bloco.link_url.includes('youtube.com'), JSON.stringify(card.data).slice(0, 140));
check('o card guarda o nome escolhido e NÃO marca para mostrar o endereço', card.data.bloco.titulo === 'Canal oficial do TurboCanal' && card.data.bloco.mostrar_url === false);

const naPagina = await req('/api/blocks?pagina=home');
check('o visitante recebe os dois, na posição escolhida', naPagina.data.itens.length === 2
  && naPagina.data.itens.find((b) => b.slot === 'topo') && naPagina.data.itens.find((b) => b.slot === 'lateral-direita'), JSON.stringify(naPagina.data.itens.map((b) => b.slot)));
check('outra página não recebe o que é só da inicial', (await req('/api/blocks?pagina=planos')).data.itens.length === 0);

// validações
const ruins = [
  [{ tipo: 'aviso', pagina: 'home', slot: 'inventada', titulo: 'x' }, 'posição que não existe'],
  [{ tipo: 'aviso', pagina: 'nao-existe', slot: 'topo', titulo: 'x' }, 'página que não existe'],
  [{ tipo: 'outro', pagina: 'home', slot: 'topo', titulo: 'x' }, 'tipo inválido'],
  [{ tipo: 'card', pagina: 'home', slot: 'topo', titulo: 'x', link_url: 'javascript:alert(1)' }, 'link com javascript:'],
  [{ tipo: 'card', pagina: 'home', slot: 'topo', titulo: 'x', link_url: 'ftp://arquivo' }, 'link que não é http'],
  [{ tipo: 'aviso', pagina: 'home', slot: 'topo', titulo: 'y'.repeat(121) }, 'título longo demais'],
  [{ tipo: 'aviso', pagina: 'home', slot: 'topo' }, 'aviso sem título e sem texto'],
  [{ tipo: 'card', pagina: 'home', slot: 'topo', titulo: 'só nome' }, 'card sem link e sem texto']
];
for (const [corpo, nome] of ruins) {
  const r = await req('/api/admin/blocks', { method: 'POST', token: tOwn, body: corpo });
  check(`recusa ${nome}`, r.status === 400, String(r.status));
}

// editar persiste
const ed = await req('/api/admin/blocks/' + av.data.bloco.id, { method: 'PUT', token: tOwn, body: { ...av.data.bloco, titulo: 'Aviso editado' } });
check('editar um aviso salva no banco', ed.status === 200 && (await req('/api/blocks?pagina=home')).data.itens.find((b) => b.id === av.data.bloco.id).titulo === 'Aviso editado');

// ocultar e publicar de novo
await req('/api/admin/blocks/' + av.data.bloco.id, { method: 'PUT', token: tOwn, body: { ...av.data.bloco, publicado: false } });
check('ocultar tira da página (mas continua no painel)',
  !(await req('/api/blocks?pagina=home')).data.itens.some((b) => b.id === av.data.bloco.id)
  && (await req('/api/admin/blocks', { token: tOwn })).data.itens.some((b) => b.id === av.data.bloco.id));
await req('/api/admin/blocks/' + av.data.bloco.id, { method: 'PUT', token: tOwn, body: { ...av.data.bloco, publicado: true } });
check('publicar de novo traz de volta', (await req('/api/blocks?pagina=home')).data.itens.some((b) => b.id === av.data.bloco.id));

// ordem dentro da mesma posição
const bl2 = await req('/api/admin/blocks', { method: 'POST', token: tOwn, body: { tipo: 'aviso', pagina: 'home', slot: 'topo', titulo: 'Segundo aviso' } });
const ordem1 = (await req('/api/blocks?pagina=home')).data.itens.filter((b) => b.slot === 'topo').map((b) => b.titulo);
await req(`/api/admin/blocks/${bl2.data.bloco.id}/move`, { method: 'POST', token: tOwn, body: { direcao: 'cima' } });
const ordem2 = (await req('/api/blocks?pagina=home')).data.itens.filter((b) => b.slot === 'topo').map((b) => b.titulo);
check('mover para cima muda a ordem de verdade', ordem2[0] === 'Segundo aviso' && ordem2.join() !== ordem1.join(), `${ordem1} -> ${ordem2}`);
check('subir o que já é o primeiro não quebra', (await req(`/api/admin/blocks/${bl2.data.bloco.id}/move`, { method: 'POST', token: tOwn, body: { direcao: 'cima' } })).data.semMudanca === true);

// mudar de lugar
await req('/api/admin/blocks/' + bl2.data.bloco.id, { method: 'PUT', token: tOwn, body: { ...bl2.data.bloco, slot: 'rodape', pagina: 'todas' } });
const mudou = await req('/api/blocks?pagina=planos');
check('mudar a posição e a página leva o aviso para o novo lugar',
  mudou.data.itens.some((b) => b.id === bl2.data.bloco.id && b.slot === 'rodape'), JSON.stringify(mudou.data.itens.map((b) => [b.slot, b.pagina])));

// usuário comum não edita nem exclui
check('usuário comum não edita', (await req('/api/admin/blocks/' + av.data.bloco.id, { method: 'PUT', token: t1, body: { ...av.data.bloco, titulo: 'invadido' } })).status === 403);
check('usuário comum não exclui', (await req('/api/admin/blocks/' + av.data.bloco.id, { method: 'DELETE', token: t1 })).status === 403);

// excluir não leva junto o resto
const antesAval = (await req('/api/reviews')).data.total;
check('o administrador exclui um item', (await req('/api/admin/blocks/' + bl2.data.bloco.id, { method: 'DELETE', token: tOwn })).status === 200);
check('excluir um aviso não apaga nada do resto do site',
  (await req('/api/reviews')).data.total === antesAval && (await req('/api/blocks?pagina=home')).data.itens.length === 2);

fake.close(); gem.close();

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
server.close();
process.exit(fail ? 1 : 0);
