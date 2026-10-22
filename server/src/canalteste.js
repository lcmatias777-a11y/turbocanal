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
// Nome inventado, de canal normal. A avisagem de que é simulado fica na faixa
// laranja do topo e no selo ao lado do nome, não no nome em si: nome feio
// atrapalha justamente o que o canal de teste serve para fazer, que é a
// pessoa ver como as telas ficam de verdade.
export const CANAL_TITULO = 'Pixel Arena';
export const CANAL_DESCRICAO = 'Gameplay, desafios e guias rápidos. Vídeo novo toda semana.';

/** Id de vídeo do canal de teste. Serve para o site reconhecer, em qualquer
 *  lugar, que aquele id NÃO existe no YouTube e não deve ser perguntado lá
 *  fora: era isso que fazia as ferramentas responderem "sua sessão com o
 *  Google expirou" em cima de um vídeo que nunca existiu. */
export const ID_DE_TESTE = /^tst\d{5}/;
export const ehVideoDeTeste = (id) => ID_DE_TESTE.test(String(id || '').trim());

/** A chamada fala de alguma coisa do canal de teste? */
export function mencionaCanalDeTeste(params = {}) {
  for (const v of Object.values(params)) {
    const t = String(v ?? '');
    if (!t) continue;
    if (t.includes(CANAL_ID)) return true;
    if (t.split(',').some((x) => ehVideoDeTeste(x))) return true;
  }
  return false;
}
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
    capa: e.capa || null,
    editado: true
  };
}

/** Vídeos postados pela pessoa dentro do canal de teste. Entram na frente da
 *  lista, como vídeo recém-publicado: zero view, zero like, zero comentário.
 *  Números de estreia inventados seriam a parte desonesta disto. */
export async function videosPostados(db, escopo) {
  const linhas = await db.all('SELECT * FROM demo_videos_novos WHERE escopo=? AND enviado=1 ORDER BY created_at DESC', [escopo]);
  return linhas.map((n) => ({
    id: n.id, titulo: n.titulo, descricao: n.descricao,
    tags: JSON.parse(n.tags || '[]'), assunto: '',
    publicadoEm: n.publica_em || n.created_at,
    duracaoSeg: 0, views: 0, likes: 0, comentarios: 0,
    retencao: 0, inscritosGanhos: 0, inscritosPerdidos: 0,
    privacidade: n.privacidade, categoriaId: n.categoria, novo: true
  }));
}

/** A lista do canal de teste já com as edições do escopo por cima. */
export async function videosDe(db, escopo) {
  const e = await edicoes(db, escopo);
  const postados = (await videosPostados(db, escopo)).map((v) => aplicar(v, e[v.id]));
  return [...postados, ...videosBase().map((v) => aplicar(v, e[v.id]))];
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
      thumbnails: (() => { const u = v.capa || capaUrl(v.id); return { default: { url: u }, medium: { url: u }, high: { url: u }, maxres: { url: u } }; })()
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
export async function apiDeTeste(db, escopo, caminho, { method = 'GET', params = {}, body, raw } = {}) {
  const p = String(caminho);
  const vs = await videosDe(db, escopo);
  const porId = Object.fromEntries(vs.map((v) => [v.id, v]));

  // ---- canal ----
  if (p.endsWith('channels')) {
    const c = canalBase();
    const inscritos = c.inscritos;
    return { items: [{
      id: CANAL_ID,
      snippet: {
        title: CANAL_TITULO, description: CANAL_DESCRICAO, publishedAt: c.publicadoEm,
        thumbnails: { default: { url: '/api/canal-teste/avatar.svg' }, medium: { url: '/api/canal-teste/avatar.svg' }, high: { url: '/api/canal-teste/avatar.svg' } }
      },
      brandingSettings: { image: { bannerExternalUrl: '/api/canal-teste/banner.svg' } },
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

  // ---- enviar capa: guarda e passa a mostrar, como no YouTube ----
  if (p.includes('thumbnails/set')) {
    const vid = params.videoId;
    const v = porId[vid];
    if (!v) throw new HttpError(404, 'Esse vídeo não existe no canal de teste.');
    if (!raw?.buffer) throw new HttpError(400, 'Nenhuma imagem recebida.');
    const dataUrl = `data:${raw.mime || 'image/jpeg'};base64,${Buffer.from(raw.buffer).toString('base64')}`;
    await db.run(
      `INSERT INTO demo_edicoes(escopo,video_id,titulo,descricao,tags,privacidade,capa,updated_at) VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(escopo,video_id) DO UPDATE SET capa=EXCLUDED.capa, updated_at=EXCLUDED.updated_at`,
      [escopo, vid, v.titulo, v.descricao, JSON.stringify(v.tags), v.privacidade, dataUrl, now()]
    );
    return { items: [{ default: { url: dataUrl } }] };
  }
  // ---- postar vídeo: inicia o envio dentro do próprio site ----
  if (p.includes('videos') && /uploadType=resumable/.test(p)) {
    const id = 'tnv' + uid().slice(0, 8);
    const sn = body?.snippet || {}, st = body?.status || {};
    await db.run(
      `INSERT INTO demo_videos_novos(id,escopo,titulo,descricao,tags,privacidade,categoria,publica_em,bytes,enviado,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [id, escopo, String(sn.title || 'Sem título').slice(0, 100), String(sn.description || '').slice(0, 5000),
       JSON.stringify(sn.tags || []), st.privacyStatus || 'private', String(sn.categoryId || '20'),
       st.publishAt || null, 0, 0, now()]
    );
    return { __uploadUrl: `/api/canal-teste/enviar/${id}`, id };
  }

  if (p.includes('liveBroadcasts') || p.includes('liveStreams')) {
    throw new HttpError(422, 'Transmissão ao vivo não funciona no canal de teste: ela depende de um canal real no YouTube.');
  }
  throw new HttpError(501, 'Essa parte ainda não existe no canal de teste.');
}

// ---------------------------------------------------------------------------
// Capas desenhadas aqui mesmo
// ---------------------------------------------------------------------------
// Vídeo que não existe não tem capa no YouTube, e capa quebrada deixa a tela
// com aquele quadrado cinza. Então o site desenha a capa: uma imagem por
// vídeo, sempre a mesma, feita a partir do id e do título.

export const capaUrl = (id) => `/api/canal-teste/capa/${id}.svg`;

const PALETAS = [
  ['#1b2a4a', '#3d6fb5'], ['#3a1b4a', '#a14fb5'], ['#4a2a1b', '#c77b3a'],
  ['#1b4a35', '#2fae7d'], ['#4a1b2a', '#d1495b'], ['#2a2a4a', '#6b6bd1'],
  ['#143d3d', '#2a9d8f'], ['#4a3f1b', '#e9c46a']
];

function escX(t) {
  return String(t || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

/** Quebra o título em até 3 linhas que caibam na capa. */
function linhas(txt, porLinha = 20, max = 3) {
  const palavras = String(txt || '').split(/\s+/).filter(Boolean);
  const out = [];
  let atual = '';
  for (const p of palavras) {
    if ((atual + ' ' + p).trim().length > porLinha && atual) { out.push(atual); atual = p; }
    else atual = (atual + ' ' + p).trim();
    if (out.length === max) break;
  }
  if (atual && out.length < max) out.push(atual);
  if (out.length === max && palavras.join(' ').length > out.join(' ').length) {
    out[max - 1] = out[max - 1].slice(0, porLinha - 1) + '…';
  }
  return out;
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function capaSvg(v) {
  const r = sorteio(parseInt(String(v.id).replace(/\D/g, ''), 10) + 11);
  const [a, b] = PALETAS[Math.floor(r() * PALETAS.length)];
  const ls = linhas(v.titulo);
  const y0 = 360 - (ls.length - 1) * 42;
  const bolhas = Array.from({ length: 7 }, () => {
    const cx = Math.round(r() * 1280), cy = Math.round(r() * 720), rr = Math.round(30 + r() * 150);
    return `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="#fff" opacity="0.045"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720" role="img" aria-label="${escX(v.titulo)}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  ${bolhas}
  <g font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-weight="800" fill="#fff">
    ${ls.map((l, i) => `<text x="72" y="${y0 + i * 84}" font-size="74">${escX(l)}</text>`).join('\n    ')}
  </g>
  <text x="72" y="130" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="30" fill="#ffffff" opacity="0.75">${escX(CANAL_TITULO)}</text>
  <g transform="translate(1104,628)">
    <rect width="104" height="46" rx="8" fill="#000" opacity="0.72"/>
    <text x="52" y="31" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="26" font-weight="700" fill="#fff">${mmss(v.duracaoSeg)}</text>
  </g>
</svg>`;
}

export function avatarSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 176 176" width="176" height="176" role="img" aria-label="${escX(CANAL_TITULO)}">
  <defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3d6fb5"/><stop offset="1" stop-color="#a14fb5"/></linearGradient></defs>
  <rect width="176" height="176" rx="88" fill="url(#a)"/>
  <g fill="#fff"><rect x="52" y="58" width="22" height="22"/><rect x="77" y="58" width="22" height="22"/>
  <rect x="102" y="58" width="22" height="22"/><rect x="52" y="83" width="22" height="22"/>
  <rect x="102" y="83" width="22" height="22"/><rect x="52" y="108" width="72" height="14"/></g>
</svg>`;
}

export function bannerSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 384" width="2048" height="384" role="img" aria-label="${escX(CANAL_TITULO)}">
  <defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1b2a4a"/><stop offset="0.5" stop-color="#3d6fb5"/><stop offset="1" stop-color="#a14fb5"/></linearGradient></defs>
  <rect width="2048" height="384" fill="url(#b)"/>
  <circle cx="300" cy="90" r="160" fill="#fff" opacity="0.05"/>
  <circle cx="1700" cy="320" r="220" fill="#fff" opacity="0.05"/>
  <text x="1024" y="200" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="92" font-weight="800" fill="#fff">${escX(CANAL_TITULO)}</text>
  <text x="1024" y="256" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="34" fill="#fff" opacity="0.8">${escX(CANAL_DESCRICAO)}</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

export function canalTesteRoutes(app, db, auth) {
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  const svg = (res, corpo) => {
    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(corpo);
  };
  // Desenhos, sem dado de ninguém dentro: não exigem login, senão a imagem
  // não carrega dentro de <img> em algumas telas.
  app.get('/api/canal-teste/capa/:id.svg', auth.optional, wrap(async (req, res) => {
    const id = String(req.params.id).replace(/\.svg$/, '');
    const v = videosBase().find((x) => x.id === id);
    if (v) return svg(res, capaSvg(v));
    // Vídeo postado pela pessoa: o título é dela, então só ela (ou a equipe,
    // no escopo compartilhado) vê a capa.
    if (!req.user) return res.status(404).end();
    const n = await db.get('SELECT * FROM demo_videos_novos WHERE id=? AND escopo=?', [id, escopoDe(req.user)]);
    if (!n) return res.status(404).end();
    svg(res, capaSvg({ id: n.id, titulo: n.titulo, duracaoSeg: 0 }));
  }));
  // Recebe os bytes do vídeo postado no canal de teste. O arquivo NÃO é
  // guardado: o site só anota que o envio terminou e o tamanho, porque
  // guardar vídeo de teste seria encher o disco por nada.
  app.put('/api/canal-teste/enviar/:id', auth.required, wrap(async (req, res) => {
    const escopo = escopoDe(req.user);
    const v = await db.get('SELECT * FROM demo_videos_novos WHERE id=? AND escopo=?', [req.params.id, escopo]);
    if (!v) throw new HttpError(404, 'Envio não encontrado no canal de teste.');
    let bytes = 0;
    await new Promise((ok, erro) => {
      req.on('data', (c) => { bytes += c.length; });
      req.on('end', ok); req.on('error', erro);
    });
    await db.run('UPDATE demo_videos_novos SET enviado=1, bytes=? WHERE id=?', [bytes, v.id]);
    res.json({ id: v.id, kind: 'youtube#video', snippet: { title: v.titulo }, status: { privacyStatus: v.privacidade } });
  }));

  app.get('/api/canal-teste/avatar.svg', (req, res) => svg(res, avatarSvg()));
  app.get('/api/canal-teste/banner.svg', (req, res) => svg(res, bannerSvg()));

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
