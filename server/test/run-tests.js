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
const noKeyThumb = await req('/api/channel/videos/vidMeu00001/ai-thumbnail', { method: 'POST', token: t1, body: {} });
check('capa com IA sem chave: 409 e nada cobrado', noKeyThumb.status === 409);
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

b0 = await bal();
gem.state.log.length = 0;
const at = await req('/api/channel/videos/vidMeu00001/ai-thumbnail', { method: 'POST', token: t1, body: { style: 'gamer' } });
const atImg = gem.state.log.find((l) => l.isImage);
check('capa com IA a partir do vídeo: usa 4 quadros reais e devolve imagem 16:9 (300 créditos)', at.status === 200 && at.data.result.base64?.length > 10 && atImg?.images === 4 && atImg?.gen?.imageConfig?.aspectRatio === '16:9' && at.data.credits.charged === 300 && (await bal()) === b0 - 300, JSON.stringify({ s: at.status, e: at.data.error }));
check('texto da capa em maiúsculas e no máximo 4 palavras', at.data.result.conceito.texto === 'VENCI SEM GASTAR NADA');
const atOther = await req('/api/channel/videos/vidAlheio01/ai-thumbnail', { method: 'POST', token: t1, body: {} });
check('capa com IA em vídeo de outro canal: bloqueada', atOther.status === 403);
const atPriv = await req('/api/channel/videos/vidMeu00002/ai-thumbnail', { method: 'POST', token: t1, body: {} });
check('vídeo privado sem quadros públicos: explica e devolve os créditos', atPriv.status === 409 && /quadros/.test(atPriv.data.error));
gem.state.imageBilling = true;
b0 = await bal();
const atBill = await req('/api/channel/videos/vidMeu00001/ai-thumbnail', { method: 'POST', token: t1, body: {} });
gem.state.imageBilling = false;
check('imagem sem faturamento ativo: explica o custo e devolve os créditos', atBill.status === 409 && /faturamento/.test(atBill.data.error) && (await bal()) === b0, atBill.data.error);
process.env.YT_MOCK = '1';
const trN = await req('/api/tools/trends', { method: 'POST', token: t1, body: { keywords: ['bedwars', 'geometry dash', 'extra'], categoryId: '20' } });
check('Tendências do nicho: até 2 termos do canal + categoria do canal', trN.status === 200 && trN.data.result.groups.length === 3 && trN.data.result.nicho.length === 2 && trN.data.result.categoria === 'Jogos', JSON.stringify(trN.data).slice(0, 200));
const costsNow = (await req('/api/tools/costs')).data.costs;
check('preços novos: IA do vídeo e capa com IA a 300 créditos', costsNow.find((c) => c.tool === 'video_insights_ai').cost === 300 && costsNow.find((c) => c.tool === 'thumbnail_ai').cost === 300);
fake.close(); gem.close();

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
server.close();
process.exit(fail ? 1 : 0);
