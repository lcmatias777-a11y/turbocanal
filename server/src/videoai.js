// IA a partir do VÍDEO (sem o usuário digitar nada): a IA assiste ao vídeo público,
// olha quadros reais dele e os dados atuais (título, descrição, tags) e sugere
// tudo de uma vez.
import { geminiJson, youtubePart } from './gemini.js';

const IMG_BASE = () => (process.env.YT_IMG_BASE || 'https://i.ytimg.com/vi/').replace(/\/?$/, '/');

/** Quadros reais do vídeo gerados pelo YouTube (início/meio/fim) e a capa atual. */
export async function videoFrames(videoId, { thumb = true } = {}) {
  // Vídeo do canal de teste não tem quadro nenhum: ele não existe. Sair
  // buscando a imagem no YouTube só geraria 4 chamadas perdidas.
  const { ehVideoDeTeste } = await import('./canalteste.js');
  if (ehVideoDeTeste(videoId)) return [];
  const names = ['hq1.jpg', 'hq2.jpg', 'hq3.jpg', ...(thumb ? ['hqdefault.jpg'] : [])];
  const out = await Promise.all(names.map(async (name) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(IMG_BASE() + videoId + '/' + name, { signal: ctrl.signal });
      clearTimeout(t);
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !type.startsWith('image/')) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 1500) return null; // imagem de "sem quadro"
      return { name, mime: type.split(';')[0], b64: buf.toString('base64') };
    } catch {
      return null;
    }
  }));
  return out.filter(Boolean);
}

const imgPart = (f) => ({ inline_data: { mime_type: f.mime, data: f.b64 } });
const mmss = (s) => `${String(Math.floor((s || 0) / 60)).padStart(2, '0')}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;

function context(meta) {
  return `Dados atuais do vídeo: título "${meta.title || ''}"; duração ${mmss(meta.durationSec)}; ` +
    `${meta.views != null ? meta.views + ' views; ' : ''}canal "${meta.channel || ''}"; ` +
    `tags atuais: ${(meta.tags || []).slice(0, 30).join(', ') || '(nenhuma)'}; ` +
    `descrição atual: """${String(meta.description || '').slice(0, 2500)}""".`;
}

const cleanTag = (t) => String(t || '').replace(/^#/, '').replace(/[<>"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);

/** Normaliza e valida as sugestões (limites do YouTube: título 100, tags 500 caracteres no total). */
export function normalizeSuggestions(j, { watched }) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  const titulos = [...new Set(arr(j.titulos).map((t) => String(t).trim()).filter(Boolean).map((t) => t.slice(0, 100)))].slice(0, 8);
  let total = 0;
  const tags = [];
  for (const t of [...new Set(arr(j.tags).map(cleanTag).filter(Boolean).map((x) => x.toLowerCase()))]) {
    if (total + t.length + 1 > 480 || tags.length >= 30) break;
    tags.push(t); total += t.length + 1;
  }
  const hashtags = [...new Set(arr(j.hashtags).map((h) => '#' + cleanTag(h).replace(/\s+/g, '')).filter((h) => h.length > 1))].slice(0, 6);
  // capítulos: o YouTube exige começar em 00:00 e ter pelo menos 3
  let capitulos = arr(j.capitulos).map((c) => ({ tempo: String(c?.tempo || '').trim(), titulo: String(c?.titulo || '').trim().slice(0, 80) }))
    .filter((c) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(c.tempo) && c.titulo);
  if (!watched || capitulos.length < 3 || !/^0?0:00$/.test(capitulos[0].tempo)) capitulos = [];
  return {
    resumo: String(j.resumo || '').slice(0, 600),
    titulos,
    descricao: String(j.descricao || '').slice(0, 4500),
    tags,
    hashtags,
    capitulos,
    capa_textos: arr(j.capa_textos).map((t) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 5),
    melhorias: arr(j.melhorias).map((t) => String(t).trim().slice(0, 300)).filter(Boolean).slice(0, 4)
  };
}

/**
 * A IA assiste e sugere título, descrição, tags, hashtags, capítulos e textos de capa.
 * meta: { title, description, tags, durationSec, views, channel, privacy }
 */
export async function videoSuggestions(db, videoId, meta) {
  const canWatch = (meta.privacy || 'public') === 'public';
  const frames = meta.privacy === 'private' ? [] : await videoFrames(videoId, { thumb: false });
  const ask = (watching) =>
    `Você é um especialista em YouTube no Brasil (SEO, CTR e retenção). ` +
    (watching ? 'Assista ao vídeo anexado. ' : 'Você não consegue assistir a este vídeo; use os dados e os quadros anexados. ') +
    (frames.length ? `As ${frames.length} imagens anexadas são quadros reais do vídeo (início, meio e fim). ` : '') +
    context(meta) +
    ` Responda SOMENTE com JSON válido, em português do Brasil, com as chaves: ` +
    `resumo (2 frases sobre o que realmente acontece no vídeo), ` +
    `titulos (6 títulos de até 70 caracteres, fiéis ao conteúdo, variados, sem prometer o que o vídeo não entrega), ` +
    `descricao (descrição pronta para colar: 2 primeiras linhas com a promessa e as palavras-chave, um parágrafo sobre o vídeo e uma chamada para se inscrever; não invente links nem redes sociais), ` +
    `capitulos (${watching ? 'lista de {"tempo":"mm:ss","titulo":"..."} começando em 00:00, com pelo menos 3 capítulos reais' : 'lista vazia []'}), ` +
    `tags (25 tags relevantes, da mais para a menos importante, sem #), hashtags (5, com #), ` +
    `capa_textos (4 textos de até 4 palavras para a capa), melhorias (3 dicas objetivas para os próximos vídeos).`;
  const framesParts = frames.map(imgPart);
  let watched = false, res;
  if (canWatch) {
    try {
      res = await geminiJson(db, [youtubePart(videoId, meta.durationSec), ...framesParts, { text: ask(true) }], { lowRes: meta.durationSec > 20 * 60 });
      watched = true;
    } catch (e) {
      if (!e.videoProblem) throw e; // limite/chave: não adianta tentar de novo
    }
  }
  if (!res) res = await geminiJson(db, [...framesParts, { text: ask(false) }]);
  return {
    sugestoes: normalizeSuggestions(res.json, { watched }),
    assistiu: watched,
    quadros: frames.length,
    modelo: res.model,
    aviso: watched
      ? 'A IA assistiu ao vídeo e viu quadros reais dele. Revise antes de salvar.'
      : meta.privacy === 'private'
        ? 'Vídeo privado: a IA não consegue assistir. As sugestões usam o título, a descrição e as tags atuais.'
        : 'A IA não pôde assistir a este vídeo (só vídeos públicos); usou quadros reais e os dados atuais.'
  };
}

/** "Coach" da extensão: a IA assiste (se público) e analisa o vídeo com os números dele e do canal. */
export async function videoCoach(db, videoId, panel) {
  const v = panel.video || {};
  const ch = panel.channel || {};
  const meta = { title: v.title, description: v.description, tags: v.tags, durationSec: v.durationSec, views: v.views, channel: v.channel || ch.title, privacy: v.privacy };
  const canWatch = (v.privacy || 'public') === 'public' && !v.mock;
  const frames = v.privacy === 'private' || v.mock ? [] : await videoFrames(videoId, { thumb: false });
  const numbers = `Números: ${v.views || 0} views, ${v.vph ?? '?'} views por hora desde a publicação, engajamento ${v.engagement ?? '?'}%, publicado em ${String(v.publishedAt || '').slice(0, 10)}` +
    (ch.medianRecentViews ? `; os vídeos recentes do canal têm mediana de ${ch.medianRecentViews} views (este vídeo está em ${panel.outlierCanal}x essa mediana)` : '') +
    (ch.subs != null ? `; o canal tem ${ch.subs} inscritos` : '') + '.';
  const ask = (watching) =>
    `Você é um coach de YouTube no Brasil. ${watching ? 'Assista ao vídeo anexado. ' : 'Você não consegue assistir a este vídeo; use os dados e os quadros anexados. '}` +
    context(meta) + ' ' + numbers +
    ` Responda SOMENTE com JSON válido em português do Brasil com as chaves: ` +
    `resumo (3 frases sobre o que acontece no vídeo), ` +
    `gancho ({"nota": 0 a 10, "analise": "como são os primeiros 10 a 30 segundos", "sugestao": "como melhorar a abertura"}), ` +
    `desempenho ({"veredito": "acima da média", "na média" ou "abaixo da média", "porque": "2 ou 3 motivos concretos, usando os números"}), ` +
    `ideias (3 objetos {"titulo": "até 70 caracteres", "porque": "1 frase"} de vídeos parecidos que o criador deste canal poderia fazer), ` +
    `inscritos (3 dicas práticas para este canal ganhar mais inscritos).`;
  let watched = false, res;
  if (canWatch) {
    try { res = await geminiJson(db, [youtubePart(videoId, v.durationSec), ...frames.map(imgPart), { text: ask(true) }], { lowRes: v.durationSec > 20 * 60 }); watched = true; }
    catch (e) { if (!e.videoProblem) throw e; }
  }
  if (!res) res = await geminiJson(db, [...frames.map(imgPart), { text: ask(false) }]);
  const j = res.json || {};
  const arr = (x) => (Array.isArray(x) ? x : []);
  return {
    assistiu: watched,
    modelo: res.model,
    resumo: String(j.resumo || '').slice(0, 800),
    gancho: { nota: Math.max(0, Math.min(10, Number(j.gancho?.nota) || 0)), analise: String(j.gancho?.analise || '').slice(0, 600), sugestao: String(j.gancho?.sugestao || '').slice(0, 600) },
    desempenho: { veredito: String(j.desempenho?.veredito || '').slice(0, 40), porque: String(j.desempenho?.porque || '').slice(0, 800) },
    ideias: arr(j.ideias).slice(0, 3).map((x) => ({ titulo: String(x?.titulo || x || '').slice(0, 100), porque: String(x?.porque || '').slice(0, 300) })),
    inscritos: arr(j.inscritos).slice(0, 3).map((x) => String(x).slice(0, 300)),
    aviso: watched ? 'A IA assistiu ao vídeo. Notas e vereditos são opiniões da IA, não métricas do YouTube.' : 'A IA não pôde assistir (só vídeos públicos); usou os dados e quadros do vídeo.'
  };
}
