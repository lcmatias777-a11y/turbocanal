import { getSetting } from './db.js';
import { HttpError, seededRand } from './util.js';
import { youtubeAccessToken } from './auth.js';

const MOCK_AVISO =
  'DADOS DE EXEMPLO (modo de teste, sem acesso ao YouTube). Em produção, entre com o Google.';
const EST_AVISO =
  'Estimativas derivadas de dados públicos da YouTube Data API. Não são métricas oficiais de busca do YouTube.';

const STOPWORDS = new Set(
  (
    'a o os as um uma de do da dos das em no na nos nas e ou que com para por sobre como the of and to in on for ' +
    'is are you your my eu meu minha se não nao sim mais menos muito pouco já ja foi ser ter vs ao aos à às seu sua ' +
    'this that with how what why best top new 2024 2025 2026 video vídeo videos shorts live ep parte part feat ft'
  ).split(/\s+/)
);

async function apiKey(db) {
  return ((await getSetting(db, 'yt_api_key')) || process.env.YT_API_KEY || '').trim();
}
const isMock = () => process.env.YT_MOCK === '1';

/**
 * Autenticação para a YouTube Data API: usa o token OAuth do usuário logado
 * (concedido no "Entrar com Google"); se não houver, cai para a chave de API do
 * servidor (opcional). Sem nenhum dos dois, explica o que fazer.
 */
async function authFor(db, user) {
  if (user) {
    try {
      const token = await youtubeAccessToken(db, user);
      return { headers: { Authorization: `Bearer ${token}` } };
    } catch (e) {
      const key = await apiKey(db);
      if (key) return { key };
      throw e;
    }
  }
  const key = await apiKey(db);
  if (key) return { key };
  throw new HttpError(409, 'Entre com o Google para usar as ferramentas do YouTube.');
}

// Custo em unidades de cota da YouTube Data API (padrão: 10.000/dia por projeto,
// compartilhado por TODOS os usuários do site). search.list custa 100.
const UNIT_COST = { search: 100 };

// Cache de dados públicos (não depende do usuário): economiza a cota diária.
const CACHE = new Map();
const TTL_MS = { search: 6 * 3600e3, videos: 30 * 60e3, channels: 6 * 3600e3, playlistItems: 30 * 60e3 };
function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (hit.exp < Date.now()) { CACHE.delete(key); return null; }
  return hit.data;
}
function cacheSet(key, data, ttl) {
  if (CACHE.size > 3000) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, { data, exp: Date.now() + ttl });
}

export async function countUnits(db, units) {
  const key = 'yt_units_' + new Date().toISOString().slice(0, 10);
  try {
    await db.run(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = ((COALESCE(NULLIF(settings.value,''),'0'))::int + (EXCLUDED.value)::int)::text",
      [key, String(units)]
    );
  } catch (e) {
    console.error('[cota] falha ao contar unidades:', e.message);
  }
}

export function quotaError(msg) {
  return /quota|exceeded your|dailyLimitExceeded|rateLimitExceeded/i.test(String(msg || ''));
}

async function yt(db, endpoint, params, user) {
  const cacheKey = endpoint + '?' + Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const ttl = endpoint === 'videos' && params.chart ? 60 * 60e3 : TTL_MS[endpoint];
  if (ttl) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }
  const a = await authFor(db, user);
  const u = new URL('https://www.googleapis.com/youtube/v3/' + endpoint);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, v);
  if (a.key) u.searchParams.set('key', a.key);
  let resp, data;
  try {
    resp = await fetch(u, { headers: a.headers || {} });
    data = await resp.json();
  } catch (e) {
    throw new HttpError(502, 'Não foi possível falar com a API do YouTube agora. Tente de novo em instantes.');
  }
  await countUnits(db, UNIT_COST[endpoint] || 1);
  if (!resp.ok) {
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    if (/has not been used|is disabled|accessNotConfigured/i.test(msg)) {
      throw new HttpError(502, 'A YouTube Data API ainda não está ativada no projeto do Google Cloud deste site.');
    }
    if (quotaError(msg)) {
      throw new HttpError(429, 'O limite diário da API do YouTube deste site foi atingido. Ele renova à meia-noite (horário do Pacífico, por volta das 4h ou 5h no Brasil). Seus créditos foram devolvidos.');
    }
    if (resp.status === 401) {
      throw new HttpError(401, 'Sua sessão com o Google expirou. Saia e entre com o Google novamente.');
    }
    throw new HttpError(502, 'Erro da API do YouTube: ' + msg);
  }
  if (ttl) cacheSet(cacheKey, data, ttl);
  return data;
}

export function parseVideoId(input) {
  const s = String(input || '').trim();
  const m =
    s.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
    s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
    s.match(/shorts\/([A-Za-z0-9_-]{11})/) ||
    s.match(/^([A-Za-z0-9_-]{11})$/);
  if (!m) throw new HttpError(400, 'Informe um link de vídeo do YouTube válido ou o ID de 11 caracteres.');
  return m[1];
}

function isoDurToSec(iso) {
  const m = String(iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

function mapVideo(item) {
  const st = item.statistics || {};
  return {
    id: item.id,
    title: item.snippet?.title,
    channel: item.snippet?.channelTitle,
    channelId: item.snippet?.channelId,
    publishedAt: item.snippet?.publishedAt,
    description: item.snippet?.description || '',
    tags: item.snippet?.tags || [],
    thumb: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null,
    views: +st.viewCount || 0,
    likes: st.likeCount != null ? +st.likeCount : null,
    comments: st.commentCount != null ? +st.commentCount : null,
    durationSec: isoDurToSec(item.contentDetails?.duration)
  };
}

/** Views por hora desde a publicação (métrica pública, estilo "VPH"). */
export function vph(v) {
  const hours = Math.max(1, (Date.now() - new Date(v.publishedAt || Date.now()).getTime()) / 3600e3);
  return Math.round((v.views || 0) / hours);
}
/** Engajamento: (likes + comentários) / views, em %. */
export function engagement(v) {
  if (!v.views) return null;
  return Math.round((((v.likes || 0) + (v.comments || 0)) / v.views) * 10000) / 100;
}
function withMetrics(list) {
  const views = list.map((v) => v.views || 0).sort((a, b) => a - b);
  const median = views.length ? views[Math.floor(views.length / 2)] || 1 : 1;
  return list.map((v) => ({ ...v, vph: vph(v), engagement: engagement(v), outlier: Math.round(((v.views || 0) / Math.max(1, median)) * 10) / 10 }));
}

// ---------------- Dados de exemplo (SOMENTE testes automatizados) ----------------
function mockVideos(q, n = 10) {
  const rnd = seededRand('v:' + q);
  return Array.from({ length: n }, (_, i) => ({
    mock: true,
    id: 'MOCK' + String(i).padStart(7, '0'),
    title: `Exemplo ${i + 1}: ${q} na prática`,
    channel: `Canal Exemplo ${1 + (i % 4)}`,
    channelId: 'UCMOCK' + (i % 4),
    publishedAt: new Date(Date.now() - (i + 1) * 86400000 * 7).toISOString(),
    description: `Vídeo de exemplo sobre ${q}. ` + 'Conteúdo demonstrativo. '.repeat(10),
    tags: [q, q + ' tutorial', q + ' dicas'],
    thumb: null,
    views: Math.floor(rnd() * 500000) + 1000,
    likes: Math.floor(rnd() * 20000),
    comments: Math.floor(rnd() * 2000),
    durationSec: 300 + Math.floor(rnd() * 900)
  }));
}

async function fetchVideosByIds(db, ids, user) {
  if (!ids.length) return [];
  const data = await yt(db, 'videos', { part: 'snippet,statistics,contentDetails', id: ids.join(','), maxResults: 50 }, user);
  return (data.items || []).map(mapVideo);
}

// ---------------- Ferramentas ----------------
export async function searchVideos(db, q, max = 10, user = null) {
  if (isMock()) return { mock: true, aviso: MOCK_AVISO, items: withMetrics(mockVideos(q, max)) };
  const s = await yt(db, 'search', { part: 'snippet', q, type: 'video', maxResults: Math.min(max, 25) }, user);
  const ids = (s.items || []).map((i) => i.id?.videoId).filter(Boolean);
  const items = withMetrics(await fetchVideosByIds(db, ids, user));
  return { items };
}

export function seoChecklist(v) {
  const checks = [];
  const add = (item, ok, dica) => checks.push({ item, ok: !!ok, dica });
  const t = v.title || '';
  add('Título entre 20 e 70 caracteres', t.length >= 20 && t.length <= 70, 'Títulos nessa faixa aparecem inteiros na busca e no feed.');
  add('Título com número ou colchete', /\d|\[|\(/.test(t), 'Números e marcadores tendem a aumentar o CTR (teste no seu nicho).');
  add('Descrição com 200+ caracteres', (v.description || '').length >= 200, 'Use as 2 primeiras linhas para a promessa do vídeo e inclua palavras-chave naturais.');
  add('Descrição com link ou capítulo', /https?:\/\/|\n0?0:0?0/.test(v.description || ''), 'Capítulos (00:00) e links ajudam retenção e navegação.');
  add('Pelo menos 8 tags', (v.tags || []).length >= 8, 'Tags ajudam o YouTube a entender o tema; use variações da palavra-chave.');
  add('Duração acima de 3 minutos', v.durationSec >= 180, 'Vídeos muito curtos (fora Shorts) limitam o tempo de exibição.');
  if (v.likes != null && v.views > 0) {
    add('Engajamento (likes/views) acima de 2%', v.likes / v.views >= 0.02, 'Peça a ação no início e no meio do vídeo, não só no fim.');
  }
  const ok = checks.filter((c) => c.ok).length;
  return { score: Math.round((ok / checks.length) * 100), checks, aviso: 'Pontuação heurística do TurboCanal, não é uma métrica oficial do YouTube.' };
}

export async function videoAnalysis(db, idOrUrl, user = null) {
  const id = parseVideoId(idOrUrl);
  if (isMock()) {
    const v = mockVideos(id, 1)[0];
    v.id = id;
    v.vph = vph(v); v.engagement = engagement(v);
    return { mock: true, aviso: MOCK_AVISO, video: v, seo: seoChecklist(v) };
  }
  const items = await fetchVideosByIds(db, [id], user);
  if (!items.length) throw new HttpError(404, 'Vídeo não encontrado (pode ser privado ou removido).');
  const video = items[0];
  video.vph = vph(video);
  video.engagement = engagement(video);
  return { video, seo: seoChecklist(video) };
}

export async function channelAnalysis(db, q, user = null) {
  if (isMock()) {
    const rnd = seededRand('c:' + q);
    const recent = withMetrics(mockVideos(q, 6));
    return {
      mock: true,
      aviso: MOCK_AVISO,
      channel: { id: 'UCMOCK0', title: `Canal Exemplo (${q})`, subs: Math.floor(rnd() * 100000), views: Math.floor(rnd() * 5e6), videos: 120, publishedAt: '2019-01-01T00:00:00Z', thumb: null, description: 'Canal de exemplo.' },
      recent,
      mediaViewsRecentes: Math.round(recent.reduce((a, v) => a + v.views, 0) / recent.length)
    };
  }
  const query = String(q || '').trim();
  let ch;
  if (/^UC[A-Za-z0-9_-]{22}$/.test(query)) {
    ch = await yt(db, 'channels', { part: 'snippet,statistics,contentDetails', id: query }, user);
  } else {
    const handle = query.startsWith('@') ? query : '@' + query.replace(/^.*youtube\.com\/@?/, '').split(/[/?]/)[0];
    ch = await yt(db, 'channels', { part: 'snippet,statistics,contentDetails', forHandle: handle }, user);
    if (!ch.items?.length) {
      const s = await yt(db, 'search', { part: 'snippet', q: query, type: 'channel', maxResults: 1 }, user);
      const cid = s.items?.[0]?.id?.channelId;
      if (cid) ch = await yt(db, 'channels', { part: 'snippet,statistics,contentDetails', id: cid }, user);
    }
  }
  const c = ch.items?.[0];
  if (!c) throw new HttpError(404, 'Canal não encontrado. Tente o @handle ou o link do canal.');
  const uploads = c.contentDetails?.relatedPlaylists?.uploads;
  let recent = [];
  if (uploads) {
    const pl = await yt(db, 'playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: 10 }, user);
    const ids = (pl.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean);
    recent = withMetrics(await fetchVideosByIds(db, ids, user));
  }
  const st = c.statistics || {};
  return {
    channel: {
      id: c.id,
      title: c.snippet?.title,
      description: c.snippet?.description || '',
      publishedAt: c.snippet?.publishedAt,
      thumb: c.snippet?.thumbnails?.medium?.url || null,
      subs: st.hiddenSubscriberCount ? null : +st.subscriberCount || 0,
      views: +st.viewCount || 0,
      videos: +st.videoCount || 0
    },
    recent,
    mediaViewsRecentes: recent.length ? Math.round(recent.reduce((a, v) => a + v.views, 0) / recent.length) : null
  };
}

export async function keywordResearch(db, q, user = null) {
  let items;
  if (isMock()) items = mockVideos(q, 20);
  else {
    const s = await yt(db, 'search', { part: 'snippet', q, type: 'video', maxResults: 25 }, user);
    const ids = (s.items || []).map((i) => i.id?.videoId).filter(Boolean);
    items = await fetchVideosByIds(db, ids, user);
  }
  const terms = new Map();
  for (const v of items) {
    const words = [
      ...String(v.title || '').toLowerCase().split(/[^a-zà-ú0-9+#]+/i),
      ...(v.tags || []).flatMap((t) => String(t).toLowerCase().split(/[^a-zà-ú0-9+#]+/i))
    ].filter((w) => w.length >= 3 && !STOPWORDS.has(w));
    const seen = new Set();
    for (const w of words) {
      if (seen.has(w)) continue;
      seen.add(w);
      const cur = terms.get(w) || { term: w, videos: 0, totalViews: 0, maxViews: 0 };
      cur.videos += 1;
      cur.totalViews += v.views;
      cur.maxViews = Math.max(cur.maxViews, v.views);
      terms.set(w, cur);
    }
  }
  const list = [...terms.values()]
    .map((t) => ({
      term: t.term,
      videos: t.videos,
      avgViews: Math.round(t.totalViews / t.videos),
      maxViews: t.maxViews,
      score: Math.round(t.videos * Math.log10(1 + t.totalViews / t.videos))
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);
  return {
    query: q,
    baseadoEm: items.length,
    terms: list,
    topVideos: withMetrics(items).slice(0, 8),
    aviso: isMock() ? MOCK_AVISO : EST_AVISO,
    ...(isMock() ? { mock: true } : {})
  };
}

export async function trends(db, region = 'BR', categoryId, user = null) {
  if (isMock()) return { mock: true, aviso: MOCK_AVISO, region, items: withMetrics(mockVideos('tendências ' + region, 12)) };
  const data = await yt(db, 'videos', {
    part: 'snippet,statistics,contentDetails',
    chart: 'mostPopular',
    regionCode: region,
    maxResults: 12,
    ...(categoryId ? { videoCategoryId: categoryId } : {})
  }, user);
  return { region, items: withMetrics((data.items || []).map(mapVideo)) };
}
