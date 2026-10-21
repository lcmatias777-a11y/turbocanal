// IA a partir do VÍDEO (sem o usuário digitar nada): a IA assiste ao vídeo público,
// olha quadros reais dele e os dados atuais (título, descrição, tags) e sugere
// tudo de uma vez; também cria capas usando os quadros como referência.
import { geminiJson, geminiImage, youtubePart } from './gemini.js';
import { HttpError } from './util.js';

const IMG_BASE = () => (process.env.YT_IMG_BASE || 'https://i.ytimg.com/vi/').replace(/\/?$/, '/');

/** Quadros reais do vídeo gerados pelo YouTube (início/meio/fim) e a capa atual. */
export async function videoFrames(videoId, { thumb = true } = {}) {
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

const STYLES = {
  auto: 'o estilo que mais combina com o vídeo e o nicho',
  gamer: 'gamer, cores saturadas, brilho neon, energia alta',
  vibrante: 'vibrante e colorido, alto contraste',
  dramatico: 'dramático, iluminação forte, emoção intensa',
  minimalista: 'minimalista e limpo, poucos elementos, fundo simples',
  vlog: 'vlog/realista, rosto em destaque com expressão marcante'
};

/** Capa com IA a partir do próprio vídeo: conceito (texto) + imagem com os quadros como referência. */
export async function videoThumbnail(db, videoId, meta, style = 'auto') {
  const frames = meta.privacy === 'private' ? [] : await videoFrames(videoId, { thumb: true });
  if (!frames.length) throw new HttpError(409, 'Não consegui pegar quadros deste vídeo (vídeos privados ou ainda em processamento não têm quadros públicos). Deixe o vídeo público ou não listado e tente de novo. Nenhum crédito foi cobrado.');
  const framesParts = frames.map(imgPart);
  const conceptAsk = (watching) =>
    `Você cria capas (thumbnails) de alto CTR para YouTube no Brasil. ${watching ? 'Assista ao vídeo anexado. ' : ''}` +
    `As imagens anexadas são quadros reais do vídeo (a última é a capa atual). ` + context(meta) +
    ` Planeje UMA capa nova. Responda SOMENTE com JSON: {"texto":"até 4 palavras em português, em maiúsculas","cena":"o que mostrar, usando pessoas, personagens e cenário que aparecem nos quadros","emocao":"emoção principal","cores":"2 ou 3 cores dominantes"}.`;
  let concept;
  const canWatch = (meta.privacy || 'public') === 'public';
  if (canWatch) {
    try { concept = (await geminiJson(db, [youtubePart(videoId, meta.durationSec), ...framesParts, { text: conceptAsk(true) }], { lowRes: true })).json; } catch (e) { if (!e.videoProblem) throw e; }
  }
  if (!concept) concept = (await geminiJson(db, [...framesParts, { text: conceptAsk(false) }])).json;
  const texto = String(concept.texto || '').toUpperCase().split(/\s+/).slice(0, 4).join(' ');
  const prompt =
    `Crie uma thumbnail (capa) de vídeo do YouTube em 16:9, para o vídeo "${meta.title || ''}". ` +
    `Use as imagens anexadas (quadros reais do vídeo) como referência: mantenha os mesmos personagens, pessoas, cenário e jogo, para a capa ser fiel ao conteúdo. ` +
    `Cena: ${concept.cena || 'o momento mais marcante do vídeo'}. Emoção: ${concept.emocao || 'surpresa'}. Cores: ${concept.cores || 'alto contraste'}. ` +
    `Estilo: ${STYLES[style] || STYLES.auto}. Um elemento principal grande, fundo que não compete, legível em tamanho pequeno. ` +
    (texto ? `Escreva o texto "${texto}" em letras grandes, grossas e legíveis, com contorno escuro. ` : 'Sem texto. ') +
    `Sem marcas d'água, sem logotipos de terceiros, sem bordas.`;
  const img = await geminiImage(db, [...framesParts, { text: prompt }]);
  return { ...img, conceito: { ...concept, texto }, quadros: frames.length, aviso: 'Capa criada por IA com base em quadros reais do vídeo. Confira o texto e os detalhes antes de usar.' };
}
