// TODA ferramenta funciona no canal de teste?
//
// Este arquivo nasceu de um erro real: o dono ligou o canal de teste, abriu a
// "IA do vídeo" e levou "Sua sessão com o Google expirou. Saia e entre com o
// Google novamente." O site estava perguntando ao YouTube DE VERDADE por um
// vídeo que só existe aqui dentro, levava 401 e repetia a mensagem do YouTube
// como se a conta da pessoa tivesse algum problema.
//
// Por isso o YouTube daqui é um servidor que NÃO conhece os vídeos de teste,
// igual ao de verdade. Qualquer id de teste que vazar para fora é falha do
// teste, mesmo que a ferramenta tenha respondido 200: significa que a conta
// de alguém e a cota do site estão sendo usadas para perguntar por um vídeo
// que não existe.

delete process.env.DATABASE_URL;
process.env.PASSWORD_LOGIN = '1';
process.env.YT_MOCK = '0';          // como em produção: sem dado de mentira do YouTube
import { randomUUID } from 'node:crypto';
import http from 'node:http';

let VAZOU = [];
const ehDeTeste = (u) => /tst\d{5}|tnv[0-9a-f]{8}|UC-turbocanal-teste/.test(u);
const laFora = http.createServer((req, res) => {
  VAZOU.push(req.url.split('?')[0]);
  if (/\/vi\//.test(req.url)) { res.writeHead(404); return res.end(); }
  const teste = ehDeTeste(req.url);
  res.writeHead(teste ? 401 : 200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(teste ? { error: { message: 'Invalid Credentials', code: 401 } } : { items: [], rows: [] }));
});
await new Promise((r) => laFora.listen(0, r));
const fora = `http://127.0.0.1:${laFora.address().port}`;
process.env.YT_API_BASE = fora + '/youtube/v3/';
process.env.YT_UPLOAD_BASE = fora + '/upload/youtube/v3/';
process.env.YT_ANALYTICS_BASE = fora + '/youtubeanalytics/v2/';
process.env.YT_IMG_BASE = fora + '/vi/';

const { startFakeGemini } = await import('./fake-gemini.js');
const gem = await startFakeGemini();
process.env.GEMINI_API_BASE = gem.base;

const { buildApp } = await import('../src/app.js');
const { app, db } = await buildApp({ databaseUrl: undefined, dataDir: ':memory:', scheduler: false });
const { setSetting } = await import('../src/db.js');
await setSetting(db, 'gemini_api_key', gem.key);
await setSetting(db, 'yt_api_key', 'chave-do-site');
const server = app.listen(0); await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const { signToken } = await import('../src/auth.js');
const CT = await import('../src/canalteste.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU  ' + n); } else { fail++; console.log('  FALHOU  ' + n + ' ' + x); } return !!c; };

const uid2 = randomUUID();
await db.run('INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,last_refill,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
  [uid2, 'p@e.com', null, 'P', 'user', 'free', 9999999, '2099-12', new Date().toISOString()]);
const token = await signToken(db, uid2);
const req = async (p, o = {}) => {
  const r = await fetch(base + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: o.body ? JSON.stringify(o.body) : undefined });
  let d = {}; try { d = await r.json(); } catch {}
  return { s: r.status, d };
};
await req('/api/canal-teste', { method: 'POST', body: { ligado: true } });

const vs = CT.videosBase();
const VID = vs[0].id;
const CASOS = [
  ['Meus vídeos',            'GET',  '/api/channel/videos?max=5'],
  ['Analytics do canal',     'GET',  '/api/channel/analytics?days=28'],
  ['Raio-X dos vídeos',      'GET',  '/api/channel/raiox?dias=90'],
  ['Raio-X de 1 vídeo',      'GET',  `/api/channel/raiox/${VID}`],
  ['Comentários',            'GET',  '/api/channel/comments'],
  ['Playlists',              'GET',  '/api/channel/playlists'],
  ['Próxima ação',           'GET',  '/api/proxima-acao'],
  ['Melhor horário',         'POST', '/api/tools/best_time', {}],
  ['Editar vídeo',           'PUT',  `/api/channel/videos/${VID}`, { title: 'Título novo pelo teste', description: 'oi' }],
  ['Criar playlist',         'POST', '/api/channel/playlists', { title: 'Playlist de teste' }],
  ['Responder comentário',   'POST', '/api/channel/comments/cmt000/reply', { text: 'obrigado!' }],
  ['Análise de vídeo (SEO)', 'POST', '/api/tools/video_analysis', { video: VID }],
  ['Painel da extensão',     'POST', '/api/tools/video_panel', { video: VID }],
  ['IA do vídeo',            'POST', '/api/tools/video_insights_ai', { video: VID }],
  ['IA coach (extensão)',    'POST', '/api/tools/coach_ai', { video: VID }],
  ['Auditoria do canal (IA)','POST', '/api/tools/audit_ai', {}],
  ['Ideias de vídeos (IA)',  'POST', '/api/tools/ideas_ai', {}],
  ['Laboratório de título',  'POST', '/api/tools/title_lab', { title: 'Joguei Minecraft por 24 horas' }],
  ['Títulos (IA)',           'POST', '/api/tools/title_ai', { topic: 'minecraft bedwars' }],
  ['Descrição (IA)',         'POST', '/api/tools/description_ai', { topic: 'minecraft bedwars' }],
  ['Preparar publicação',    'POST', '/api/tools/prep_ai', { topic: 'minecraft bedwars' }],
  ['Transformar vídeo (IA)', 'POST', '/api/tools/transform_ai', { video: VID }],
  ['Sugerir resposta (IA)',  'POST', '/api/tools/reply_ai', { comment: 'faz a parte 2' }],
  ['Análise de canal',       'POST', '/api/tools/channel_analysis', { channel: CT.CANAL_ID }],
  ['Busca de vídeos',        'POST', '/api/tools/video_search', { q: 'minecraft' }],
  ['Palavras-chave',         'POST', '/api/tools/keyword_research', { q: 'minecraft' }],
  ['Tendências',             'POST', '/api/tools/trends', {}],
  ['Enviar capa',            'POST', `/api/channel/videos/${VID}/thumbnail`, { image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DAwMDEwMDAwMAAAB4LAwEqRpXcAAAAAElFTkSuQmCC' }],
  ['Teste A/B de capa',      'GET',  '/api/channel/ab'],
  ['Criar live',             'POST', '/api/channel/live', { title: 'live de teste' }],
  ['Postar vídeo (iniciar)', 'POST', '/api/channel/upload/start', { title: 'Vídeo novo de teste', description: 'oi', privacy: 'private', sizeBytes: 1024, mime: 'video/mp4' }],
  ['Criar teste A/B',        'POST', '/api/channel/ab', { video_id: VID, thumb_a: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DAwMDEwMDAwMAAAB4LAwEqRpXcAAAAAElFTkSuQmCC', thumb_b: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DAwMDEwMDAwMAAAB4LAwEqRpXcAAAAAElFTkSuQmCC', hours: 24 }],
  ['Experimentos',           'GET',  '/api/experimentos'],
  ['Concorrentes',           'GET',  '/api/competitors'],
  ['Histórico',              'GET',  '/api/history?limit=5'],
  ['Postar vídeo (enviar)',  'ENVIO', '']
];

console.log('\n== Toda ferramenta responde no canal de teste ==');
let uploadUrl = null;
const PRECISAM_DE_CANAL_REAL = new Set(['Criar live']);
for (const [nome, metodo, rota, body] of CASOS) {
  VAZOU = [];
  if (metodo === 'ENVIO') {
    if (!uploadUrl) { check(nome, false, 'o início do envio não devolveu endereço'); continue; }
    const r2 = await fetch(base + uploadUrl, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'video/mp4' }, body: Buffer.alloc(2048) });
    check(nome, r2.ok, String(r2.status));
    continue;
  }
  const r = await req(rota, { method: metodo, body });
  if (nome === 'Postar vídeo (iniciar)') uploadUrl = r.d.uploadUrl || r.d.result?.uploadUrl || null;
  const vazou = VAZOU.filter(ehDeTeste);
  if (PRECISAM_DE_CANAL_REAL.has(nome)) {
    check(`${nome}: recusa explicando o motivo (depende de canal real)`,
      r.s === 422 && /canal de teste/i.test(JSON.stringify(r.d)), `${r.s} ${JSON.stringify(r.d).slice(0, 80)}`);
  } else {
    check(nome, r.s >= 200 && r.s < 300, `${r.s} ${(r.d.error || JSON.stringify(r.d)).slice(0, 80)}`);
  }
  check(`${nome}: não pergunta ao YouTube por vídeo que não existe`, vazou.length === 0, vazou.slice(0, 2).join(', '));
}

console.log('\n== O vídeo postado entra no canal de teste ==');
const lista = await req('/api/channel/videos?max=5');
const itens = lista.d.videos || lista.d.items || [];
check('o vídeo postado aparece no topo da lista', /Vídeo novo de teste/.test(JSON.stringify(itens)), JSON.stringify(itens).slice(0, 120));
check('e entra com zero view, zero like e zero comentário (nada de estreia inventada)',
  itens.some((v) => /Vídeo novo de teste/.test(v.title || '') && !v.views && !v.likes));

console.log('\n== Capas: desenho do próprio site, nunca quadrado quebrado ==');
const capa = await fetch(base + `/api/canal-teste/capa/${VID}.svg`);
const svgTxt = await capa.text();
check('a capa do vídeo é servida pelo site', capa.ok && /^<svg/.test(svgTxt), String(capa.status));
check('e traz o título do vídeo desenhado nela', svgTxt.includes(vs[0].titulo.split(' ')[0]));
const av = await fetch(base + '/api/canal-teste/avatar.svg');
const bn = await fetch(base + '/api/canal-teste/banner.svg');
check('o canal tem foto', av.ok);
check('e tem capa de canal', bn.ok);
check('o nome do canal é nome de canal, não "teste"', !/teste|simulad/i.test(CT.CANAL_TITULO), CT.CANAL_TITULO);

console.log('\n== Enviar capa troca a capa de verdade ==');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DAwMDEwMDAwMAAAB4LAwEqRpXcAAAAAElFTkSuQmCC';
await req(`/api/channel/videos/${vs[2].id}/thumbnail`, { method: 'POST', body: { image: PNG } });
const depois = await req('/api/channel/videos?max=10');
const alvo = (depois.d.videos || []).find((v) => v.id === vs[2].id);
check('depois de enviar, a capa passa a ser a enviada', /^data:image\//.test(alvo?.thumb || ''), String(alvo?.thumb).slice(0, 40));

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
server.close(); laFora.close();
process.exit(fail ? 1 : 0);
