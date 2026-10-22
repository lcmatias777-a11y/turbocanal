// Canal de teste: um canal do YouTube que NÃO existe.
//
// Serve para a pessoa experimentar as ferramentas sem precisar ligar um canal
// de verdade. Os 1000 vídeos, as views, os likes e a retenção são inventados
// de propósito, e isso está escrito na tela em todo lugar onde eles aparecem.
// Nada daqui conta como resultado de criador, nada daqui vira medição, e nada
// daqui toca o YouTube: editar um título de teste muda só o banco do site.
//
// Por que gerar em vez de guardar: 1000 vídeos por usuário seriam milhões de
// linhas sem necessidade. Os números saem de um sorteio com semente fixa, ou
// seja, a mesma conta sempre devolve os mesmos vídeos. O banco guarda apenas o
// que as pessoas EDITARAM, que é pouco.

import { HttpError, uid, now, audit } from './util.js';

export const TOTAL_VIDEOS = 1000;
export const CANAL_ID = 'UC-turbocanal-teste-0001';
export const CANAL_TITULO = 'Canal de Teste (simulado)';
export const SEMENTE = 20261022;

/** Sorteio com semente (mulberry32): mesma semente, mesma sequência, sempre.
 *  Sem isso o canal de teste mudaria de números a cada carregamento e as
 *  ferramentas pareceriam estar errando. */
export function sorteio(semente) {
  let a = semente >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ASSUNTOS = [
  'Minecraft', 'Geometry Dash', 'Roblox', 'Fortnite', 'Among Us',
  'Stardew Valley', 'Terraria', 'Rocket League', 'Fall Guys', 'Hollow Knight'
];
const FORMAS = [
  (a, n) => `${a}: consegui o recorde em ${n} tentativas`,
  (a) => `Joguei ${a} por 24 horas e aconteceu isso`,
  (a, n) => `${n} coisas de ${a} que quase ninguém sabe`,
  (a) => `Testei o build mais estranho de ${a}`,
  (a, n) => `${a} no nível ${n}: valeu a pena?`,
  (a) => `Por que eu parei de jogar ${a}`,
  (a, n) => `Tentei zerar ${a} com ${n} vidas`,
  (a) => `${a} mudou e ninguém falou sobre isso`,
  (a, n) => `Guia rápido de ${a} em ${n} minutos`,
  (a) => `Reagindo ao meu primeiro vídeo de ${a}`,
  (a, n) => `${n} erros que todo mundo comete em ${a}`,
  (a) => `${a}: o modo que me fez desistir`
];

/** Distribuição de audiência: a maioria dos vídeos vai mal, alguns vão bem e
 *  um punhado estoura. É a forma real de um canal, e é ela que dá sinal para
 *  as ferramentas de outlier e de melhor horário terem o que encontrar. */
function viewsDe(r, base, estouro) {
  const u = Math.max(r(), 1e-6);
  const cauda = Math.exp(-Math.log(u) * 0.78);        // cauda longa
  let v = base * cauda * (0.55 + r() * 0.9);
  if (estouro) v *= 9 + r() * 22;
  return Math.max(35, Math.round(v));
}

function descricaoDe(r, titulo, assunto, caprichada) {
  if (!caprichada) return `${titulo}\n\nDeixa o like!`;
  return `${titulo}\n\n` +
    `Neste vídeo eu mostro ${assunto.toLowerCase()} do começo ao fim, explicando cada decisão.\n\n` +
    `00:00 Início\n01:20 Preparação\n04:45 A parte difícil\n09:10 Resultado\n\n` +
    `Se ajudou, se inscreve no canal. Eu posto toda semana sobre ${assunto}.`;
}

let CACHE = null;

/** Os 1000 vídeos do canal de teste. Gera uma vez por processo e reaproveita:
 *  é só conta, mas não há motivo para refazer a cada chamada. */
export function videosBase() {
  if (CACHE) return CACHE;
  const r = sorteio(SEMENTE);
  const fim = Date.UTC(2026, 9, 1);                   // 01/10/2026
  const inicio = Date.UTC(2021, 0, 11);               // ~5 anos e 9 meses
  const passo = (fim - inicio) / TOTAL_VIDEOS;
  const lista = [];

  for (let i = 0; i < TOTAL_VIDEOS; i++) {
    const assunto = ASSUNTOS[Math.floor(r() * ASSUNTOS.length)];
    const forma = FORMAS[Math.floor(r() * FORMAS.length)];
    const n = 2 + Math.floor(r() * 48);
    const titulo = forma(assunto, n);

    // Publicação: espalhada, mas com preferência por fim de tarde e fim de
    // semana, que é o que o "melhor horário" precisa ter para achar algo.
    const quando = new Date(inicio + passo * i + (r() - 0.5) * passo * 0.8);
    const diaSem = quando.getUTCDay();
    const gostaDeTarde = r() < 0.62;
    quando.setUTCHours(gostaDeTarde ? 18 + Math.floor(r() * 4) : 8 + Math.floor(r() * 10));
    quando.setUTCMinutes(Math.floor(r() * 60), 0, 0);

    // O canal cresce: vídeo mais novo parte de uma base maior.
    const crescimento = 900 + (i / TOTAL_VIDEOS) * 5200;
    const fimDeSemana = diaSem === 0 || diaSem === 6;
    const base = crescimento * (fimDeSemana ? 1.35 : 1) * (gostaDeTarde ? 1.22 : 1);
    const estouro = r() < 0.022;
    const views = viewsDe(r, base, estouro);

    const curto = r() < 0.18;
    const durSeg = curto ? 15 + Math.floor(r() * 45) : 170 + Math.floor(r() * 1430);

    const engaja = 0.021 + r() * 0.07;
    const likes = Math.round(views * engaja);
    const comentarios = Math.round(likes * (0.04 + r() * 0.12));

    // Retenção: vídeo curto segura mais, vídeo longo segura menos, com ruído.
    const retBase = curto ? 0.72 : 0.52 - Math.min(0.26, (durSeg - 170) / 1430 * 0.3);
    const retencao = Math.min(0.95, Math.max(0.12, retBase + (r() - 0.5) * 0.22));

    // Conversão em inscritos: ligada ao assunto, para a ferramenta de
    // "campeão de conversão" e a de "público fora do nicho" terem o que achar.
    const foraDoNicho = r() < 0.04;
    const porMil = foraDoNicho ? r() * 0.25 : 1.1 + r() * 5.4;
    const ganhos = Math.round((views / 1000) * porMil);
    const perdidos = Math.round(ganhos * (0.04 + r() * 0.16));

    const caprichada = r() < 0.45;
    const qtTags = caprichada ? 6 + Math.floor(r() * 9) : Math.floor(r() * 4);
    const tags = [];
    for (let t = 0; t < qtTags; t++) {
      tags.push(t === 0 ? assunto.toLowerCase() : `${assunto.toLowerCase()} ${['dicas', 'guia', 'gameplay', 'speedrun', 'desafio', 'mods', 'build', 'ranked', 'tutorial', 'reagindo'][t % 10]}`);
    }

    lista.push({
      id: 'tst' + String(i).padStart(5, '0') + 'xyz',
      titulo,
      descricao: descricaoDe(r, titulo, assunto, caprichada),
      tags,
      assunto,
      publicadoEm: quando.toISOString(),
      duracaoSeg: durSeg,
      views,
      likes,
      comentarios,
      retencao: Math.round(retencao * 1000) / 1000,
      inscritosGanhos: ganhos,
      inscritosPerdidos: perdidos,
      privacidade: 'public',
      categoriaId: '20'
    });
  }

  lista.sort((a, b) => (a.publicadoEm < b.publicadoEm ? 1 : -1));   // mais novo primeiro
  CACHE = lista;
  return lista;
}

/** Números do canal, somados a partir dos vídeos: nada de total solto que não
 *  bata com a lista (número que não fecha com a própria lista é o tipo de
 *  detalhe que faz a pessoa desconfiar da ferramenta inteira, com razão). */
export function canalBase() {
  const vs = videosBase();
  const views = vs.reduce((s, v) => s + v.views, 0);
  const inscritos = vs.reduce((s, v) => s + v.inscritosGanhos - v.inscritosPerdidos, 0);
  return {
    id: CANAL_ID,
    titulo: CANAL_TITULO,
    inscritos: Math.max(0, inscritos),
    totalViews: views,
    totalVideos: vs.length,
    publicadoEm: vs[vs.length - 1].publicadoEm
  };
}

// ---------------------------------------------------------------------------
// Escopos
// ---------------------------------------------------------------------------
// "admin"  -> um canal de teste só, compartilhado por TODOS os administradores.
//             Se um troca o título, muda para os outros. Foi o pedido: entre
//             eles o canal de teste é público.
// "u:<id>" -> um canal de teste por usuário comum, que só ele mexe.

export function escopoDe(user) {
  return ['owner', 'admin'].includes(user?.role) ? 'admin' : 'u:' + user.id;
}

export async function ligado(db, user) {
  if (!user) return false;
  const r = await db.get('SELECT ligado FROM demo_estado WHERE user_id=?', [user.id]);
  return !!(r && Number(r.ligado));
}

export async function ligar(db, user, valor) {
  await db.run(
    `INSERT INTO demo_estado(user_id,ligado,created_at) VALUES(?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET ligado=EXCLUDED.ligado`,
    [user.id, valor ? 1 : 0, now()]
  );
}

/** Token falso. É assim que o resto do site sabe, num ponto só, que deve
 *  responder com o canal de teste em vez de falar com o YouTube. */
export const TOKEN = (escopo) => 'demo:' + escopo;
export const ehTokenDeTeste = (t) => typeof t === 'string' && t.startsWith('demo:');
export const escopoDoToken = (t) => String(t).slice(5);

// ---------------------------------------------------------------------------
// Edições: só o que a pessoa mudou
// ---------------------------------------------------------------------------

async function edicoes(db, escopo) {
  const linhas = await db.all('SELECT * FROM demo_edicoes WHERE escopo=?', [escopo]);
  return Object.fromEntries(linhas.map((e) => [e.video_id, e]));
}

function aplicar(v, e) {
  if (!e) return v;
  return {
    ...v,
    titulo: e.titulo ?? v.titulo,
    descricao: e.descricao ?? v.descricao,
    tags: e.tags ? JSON.parse(e.tags) : v.tags,
    privacidade: e.privacidade ?? v.privacidade,
    editado: true
  };
}

/** A lista do canal de teste já com as edições do escopo por cima. */
export async function videosDe(db, escopo) {
  const e = await edicoes(db, escopo);
  return videosBase().map((v) => aplicar(v, e[v.id]));
}

// ---------------------------------------------------------------------------
// Tradução para o formato que a API do YouTube devolve
// ---------------------------------------------------------------------------

function dur(seg) {
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
  return 'PT' + (h ? h + 'H' : '') + (m ? m + 'M' : '') + (s ? s + 'S' : h || m ? '' : '0S');
}

function comoVideo(v) {
  return {
    id: v.id,
    snippet: {
      title: v.titulo, description: v.descricao, tags: v.tags,
      publishedAt: v.publicadoEm, categoryId: v.categoriaId,
      channelId: CANAL_ID, channelTitle: CANAL_TITULO,
      thumbnails: { medium: { url: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg` } }
    },
    statistics: { viewCount: String(v.views), likeCount: String(v.likes), commentCount: String(v.comentarios) },
    status: { privacyStatus: v.privacidade },
    contentDetails: { duration: dur(v.duracaoSeg) }
  };
}

/** Quanto das views de um vídeo caiu DENTRO da janela pedida. Vídeo novo leva
 *  quase tudo, vídeo velho só um fiapo: é o que o Analytics mostraria. */
function viewsNaJanela(v, iniMs, fimMs) {
  const pub = Date.parse(v.publicadoEm);
  if (pub > fimMs) return 0;
  const diasJanela = Math.max(1, (fimMs - iniMs) / 86400e3);
  const idadeDias = Math.max(0, (iniMs - pub) / 86400e3);
  // metade das views nos primeiros 7 dias, o resto caindo devagar
  const fracao = idadeDias <= 0
    ? Math.min(1, diasJanela / 14) * 0.6
    : 0.45 * Math.pow(idadeDias + 7, -0.95) * diasJanela;
  const bruto = v.views * Math.min(1, Math.max(0, fracao));
  // Balanço do dia a dia. Sem isto a série do Analytics sai como uma reta
  // caindo, que não parece audiência nenhuma e não dá o que testar num
  // gráfico. O balanço é sorteado pela DATA, então é sempre o mesmo.
  const diaIndice = Math.floor(iniMs / 86400e3);
  const r = sorteio(SEMENTE + diaIndice * 131);
  const diaSem = new Date(iniMs).getUTCDay();
  const peso = (diaSem === 0 || diaSem === 6) ? 1.28 : (diaSem === 3 ? 0.88 : 1);
  return Math.round(bruto * peso * (0.74 + r() * 0.52));
}

/** A API do YouTube, fingida. Um ponto só: tudo que o site já fazia continua
 *  igual, e nenhuma chamada sai para a internet. */
export async function apiDeTeste(db, escopo, caminho, { method = 'GET', params = {}, body } = {}) {
  const p = String(caminho);
  const vs = await videosDe(db, escopo);
  const porId = Object.fromEntries(vs.map((v) => [v.id, v]));

  // ---- canal ----
  if (p.endsWith('channels')) {
    const c = canalBase();
    const inscritos = c.inscritos;
    return { items: [{
      id: CANAL_ID,
      snippet: { title: CANAL_TITULO, description: 'Canal simulado para testar as ferramentas do TurboCanal. Não existe no YouTube.', publishedAt: c.publicadoEm },
      statistics: { subscriberCount: String(inscritos), viewCount: String(c.totalViews), videoCount: String(c.totalVideos) },
      contentDetails: { relatedPlaylists: { uploads: 'UU-turbocanal-teste' } }
    }] };
  }

  // ---- lista de uploads (com paginação, como a de verdade) ----
  if (p.endsWith('playlistItems') && method === 'GET' && params.playlistId === 'UU-turbocanal-teste') {
    const max = Math.min(50, parseInt(params.maxResults, 10) || 50);
    const de = parseInt(params.pageToken, 10) || 0;
    const fatia = vs.slice(de, de + max);
    return {
      items: fatia.map((v) => ({ contentDetails: { videoId: v.id } })),
      nextPageToken: de + max < vs.length ? String(de + max) : undefined
    };
  }

  // ---- vídeos por id ----
  if (p.endsWith('videos') && method === 'GET') {
    const ids = String(params.id || '').split(',').map((s) => s.trim()).filter(Boolean);
    return { items: ids.map((id) => porId[id]).filter(Boolean).map(comoVideo) };
  }

  // ---- editar vídeo ----
  if (p.endsWith('videos') && method === 'PUT') {
    const id = body?.id;
    const v = porId[id];
    if (!v) throw new HttpError(404, 'Esse vídeo não existe no canal de teste.');
    const sn = body.snippet || {};
    await db.run(
      `INSERT INTO demo_edicoes(escopo,video_id,titulo,descricao,tags,privacidade,updated_at) VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(escopo,video_id) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao,
         tags=EXCLUDED.tags, privacidade=EXCLUDED.privacidade, updated_at=EXCLUDED.updated_at`,
      [escopo, id, sn.title ?? v.titulo, sn.description ?? v.descricao,
       JSON.stringify(sn.tags ?? v.tags), body.status?.privacyStatus ?? v.privacidade, now()]
    );
    const novo = aplicar(v, { titulo: sn.title, descricao: sn.description, tags: JSON.stringify(sn.tags ?? v.tags), privacidade: body.status?.privacyStatus });
    return comoVideo(novo);
  }

  // ---- relatórios do Analytics ----
  if (p.includes('youtubeanalytics')) {
    const ini = Date.parse(params.startDate + 'T00:00:00Z');
    const fim = Date.parse(params.endDate + 'T23:59:59Z');
    const dims = String(params.dimensions || '');
    const mets = String(params.metrics || '').split(',');

    if (dims === 'video') {
      const max = Math.min(200, parseInt(params.maxResults, 10) || 50);
      const linhas = vs.map((v) => {
        const views = viewsNaJanela(v, ini, fim);
        const mapa = {
          views,
          estimatedMinutesWatched: Math.round((views * v.duracaoSeg * v.retencao) / 60),
          averageViewDuration: Math.round(v.duracaoSeg * v.retencao),
          averageViewPercentage: Math.round(v.retencao * 1000) / 10,
          subscribersGained: Math.round(views / 1000 * (v.inscritosGanhos / Math.max(1, v.views / 1000))),
          subscribersLost: Math.round(views / 1000 * (v.inscritosPerdidos / Math.max(1, v.views / 1000))),
          likes: Math.round(views * (v.likes / Math.max(1, v.views))),
          comments: Math.round(views * (v.comentarios / Math.max(1, v.views)))
        };
        return [v.id, ...mets.map((m) => mapa[m] ?? 0)];
      }).filter((r) => r[1] > 0);
      linhas.sort((a, b) => b[1] - a[1]);
      return { rows: linhas.slice(0, max) };
    }

    if (dims === 'day') {
      const linhas = [];
      for (let t = ini; t <= fim; t += 86400e3) {
        const dia = new Date(t);
        const iso = dia.toISOString().slice(0, 10);
        let views = 0, min = 0, ganhos = 0, perdidos = 0, likes = 0;
        for (const v of vs) {
          const nodia = viewsNaJanela(v, t, t + 86399e3);
          if (!nodia) continue;
          views += nodia;
          min += Math.round((nodia * v.duracaoSeg * v.retencao) / 60);
          ganhos += Math.round(nodia / 1000 * (v.inscritosGanhos / Math.max(1, v.views / 1000)));
          perdidos += Math.round(nodia / 1000 * (v.inscritosPerdidos / Math.max(1, v.views / 1000)));
          likes += Math.round(nodia * (v.likes / Math.max(1, v.views)));
        }
        const mapa = { views, estimatedMinutesWatched: min, subscribersGained: ganhos, subscribersLost: perdidos, likes };
        linhas.push([iso, ...mets.map((m) => mapa[m] ?? 0)]);
      }
      return { rows: linhas };
    }
    return { rows: [] };
  }

  // ---- comentários ----
  if (p.endsWith('commentThreads')) {
    const r = sorteio(SEMENTE + 7);
    const FRASES = [
      'primeiro!!', 'esse vídeo me ajudou demais, obrigado', 'faz a parte 2 por favor',
      'não entendi a parte do meio, dá pra explicar?', 'melhor canal sobre isso',
      'tenta fazer sem usar atalho da próxima vez', 'qual a config que tu usa?',
      'vim pelo short, já me inscrevi', 'esse foi o melhor até agora', 'a edição ficou muito boa'
    ];
    const respostas = await db.all('SELECT comentario_id FROM demo_respostas WHERE escopo=?', [escopo]);
    const jaRespondi = new Set(respostas.map((x) => x.comentario_id));
    const itens = [];
    for (let i = 0; i < 30; i++) {
      const v = vs[Math.floor(r() * 60)];
      const id = 'cmt' + String(i).padStart(3, '0');
      itens.push({
        id,
        snippet: {
          videoId: v.id,
          totalReplyCount: jaRespondi.has(id) ? 1 : 0,
          topLevelComment: { id, snippet: {
            authorDisplayName: ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio'][i % 6] + ' ' + (100 + i),
            textDisplay: FRASES[i % FRASES.length],
            publishedAt: new Date(Date.now() - i * 3600e3 * 5).toISOString(),
            likeCount: Math.floor(r() * 40)
          } }
        }
      });
    }
    return { items: itens };
  }

  if (p.endsWith('comments') && method === 'POST') {
    const pai = body?.snippet?.parentId;
    await db.run('INSERT INTO demo_respostas(id,escopo,comentario_id,texto,created_at) VALUES(?,?,?,?,?)',
      [uid(), escopo, pai, String(body?.snippet?.textOriginal || '').slice(0, 2000), now()]);
    return { id: uid(), snippet: { textDisplay: body?.snippet?.textOriginal } };
  }

  // ---- playlists ----
  if (p.endsWith('playlists') && method === 'GET') {
    if (params.id) {
      const pl = await db.get('SELECT * FROM demo_playlists WHERE escopo=? AND id=?', [escopo, params.id]);
      return { items: pl ? [{ id: pl.id, snippet: { title: pl.titulo, description: pl.descricao, channelId: CANAL_ID } }] : [] };
    }
    const todas = await db.all('SELECT * FROM demo_playlists WHERE escopo=? ORDER BY created_at DESC', [escopo]);
    return { items: todas.map((pl) => ({
      id: pl.id, snippet: { title: pl.titulo, description: pl.descricao, channelId: CANAL_ID },
      status: { privacyStatus: 'public' },
      contentDetails: { itemCount: 0 }
    })) };
  }

  if (p.endsWith('playlists') && method === 'POST') {
    const id = 'PLteste' + uid().slice(0, 10);
    await db.run('INSERT INTO demo_playlists(id,escopo,titulo,descricao,created_at) VALUES(?,?,?,?,?)',
      [id, escopo, String(body?.snippet?.title || 'Sem nome').slice(0, 150), String(body?.snippet?.description || '').slice(0, 2000), now()]);
    return { id, snippet: { title: body?.snippet?.title, description: body?.snippet?.description } };
  }

  if (p.endsWith('playlistItems') && method === 'GET') {
    const itens = await db.all('SELECT * FROM demo_playlist_itens WHERE escopo=? AND playlist_id=? ORDER BY created_at', [escopo, params.playlistId]);
    return { items: itens.map((it) => ({
      id: it.id,
      snippet: { title: porId[it.video_id]?.titulo || it.video_id, resourceId: { videoId: it.video_id } },
      contentDetails: { videoId: it.video_id }
    })) };
  }

  if (p.endsWith('playlistItems') && method === 'POST') {
    const vid = body?.snippet?.resourceId?.videoId;
    if (!porId[vid]) throw new HttpError(404, 'Esse vídeo não existe no canal de teste.');
    const id = uid();
    await db.run('INSERT INTO demo_playlist_itens(id,escopo,playlist_id,video_id,created_at) VALUES(?,?,?,?,?)',
      [id, escopo, body.snippet.playlistId, vid, now()]);
    return { id, snippet: body.snippet };
  }

  if (p.endsWith('playlistItems') && method === 'DELETE') {
    await db.run('DELETE FROM demo_playlist_itens WHERE escopo=? AND id=?', [escopo, params.id]);
    return {};
  }

  // ---- o que não dá para simular de verdade: diz, não finge ----
  if (p.includes('thumbnails/set')) {
    throw new HttpError(422, 'No canal de teste a capa não é enviada: não existe vídeo de verdade para receber a imagem. Ligue seu canal para usar esta parte.');
  }
  if (p.includes('liveBroadcasts') || p.includes('liveStreams')) {
    throw new HttpError(422, 'Transmissão ao vivo não funciona no canal de teste: ela depende de um canal real no YouTube.');
  }
  throw new HttpError(501, 'Essa parte ainda não existe no canal de teste.');
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

export function canalTesteRoutes(app, db, auth) {
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  app.get('/api/canal-teste', auth.required, wrap(async (req, res) => {
    const escopo = escopoDe(req.user);
    const c = canalBase();
    const mexidos = Number((await db.get('SELECT COUNT(*) AS n FROM demo_edicoes WHERE escopo=?', [escopo])).n);
    res.json({
      ligado: await ligado(db, req.user),
      compartilhado: escopo === 'admin',
      canal: { titulo: c.titulo, inscritos: c.inscritos, videos: c.totalVideos, views: c.totalViews },
      editados: mexidos,
      aviso: 'Este canal não existe no YouTube. Os vídeos, as visualizações e a retenção são inventados para você experimentar as ferramentas. Nada daqui vira resultado de criador nem é publicado em lugar nenhum.',
      cobranca: 'No canal de teste as ferramentas que só fazem conta saem de graça. As que chamam a IA continuam cobrando, porque cada chamada custa dinheiro de verdade para o site.',
      limites: ['enviar capa', 'transmissão ao vivo', 'postar vídeo'],
      compartilhadoTexto: escopo === 'admin'
        ? 'Entre administradores o canal de teste é o MESMO: se você trocar um título, os outros administradores veem a troca.'
        : 'Este canal de teste é só seu: o que você mudar aqui ninguém mais vê.'
    });
  }));

  app.post('/api/canal-teste', auth.required, wrap(async (req, res) => {
    const valor = !!req.body?.ligado;
    await ligar(db, req.user, valor);
    await audit(db, req.user, valor ? 'canalteste.ligar' : 'canalteste.desligar', escopoDe(req.user), '');
    res.json({ ok: true, ligado: valor });
  }));

  // Voltar o canal de teste ao estado original. No escopo dos administradores
  // isso apaga a edição de todo mundo, então só o principal faz.
  app.post('/api/canal-teste/reiniciar', auth.required, wrap(async (req, res) => {
    const escopo = escopoDe(req.user);
    if (escopo === 'admin' && req.user.role !== 'owner') {
      throw new HttpError(403, 'O canal de teste dos administradores é compartilhado: reiniciar apagaria a edição dos outros. Só o administrador principal faz isso.');
    }
    for (const t of ['demo_edicoes', 'demo_playlist_itens', 'demo_playlists', 'demo_respostas']) {
      await db.run(`DELETE FROM ${t} WHERE escopo=?`, [escopo]);
    }
    await audit(db, req.user, 'canalteste.reiniciar', escopo, '');
    res.json({ ok: true });
  }));
}
