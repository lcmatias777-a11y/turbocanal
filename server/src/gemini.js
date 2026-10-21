// Integração com a API do Gemini (Google AI Studio). A chave é configurada pelo
// administrador em Admin > Configurações (gemini_api_key) ou via GEMINI_API_KEY.
// Usos: IA que "assiste" o vídeo do YouTube pela URL, geração de capas (imagem),
// e textos (títulos/descrições) quando a chave da Anthropic não está configurada.
import { getSetting } from './db.js';
import { HttpError } from './util.js';

const TEXT_MODEL = () => process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
const IMAGE_MODEL = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

export async function geminiKey(db) {
  return ((await getSetting(db, 'gemini_api_key')) || process.env.GEMINI_API_KEY || '').trim();
}

async function call(db, model, body) {
  const key = await geminiKey(db);
  if (!key) {
    throw new HttpError(
      409,
      'A IA do Gemini ainda não foi configurada neste servidor. O administrador pode colar a chave da API (gratuita no Google AI Studio) em Admin > Configurações.'
    );
  }
  let resp, data;
  try {
    resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body)
    });
    data = await resp.json();
  } catch {
    throw new HttpError(502, 'Não foi possível falar com a API do Gemini agora. Tente de novo em instantes.');
  }
  if (!resp.ok) {
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    throw new HttpError(502, 'Erro da API do Gemini: ' + msg);
  }
  return data;
}

function textOf(data) {
  return (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('\n').trim();
}

/** Texto simples (usado por títulos/descrições quando não há chave da Anthropic). */
export async function geminiText(db, prompt, { maxTokens = 1200 } = {}) {
  const data = await call(db, TEXT_MODEL(), {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.8 }
  });
  return textOf(data);
}

/**
 * A IA assiste o vídeo (o Gemini aceita URLs públicas do YouTube como entrada)
 * e devolve resumo, ganchos, títulos, ideia de capa e melhorias de SEO.
 */
export async function videoInsights(db, videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const prompt =
    `Você é um estrategista de conteúdo para YouTube (pt-BR). Assista a este vídeo e responda em JSON válido, sem markdown, com as chaves:\n` +
    `resumo (3 frases), publico (quem é o público-alvo), ganchos (3 frases de abertura que prendem nos primeiros 10s), ` +
    `titulos (5 títulos de até 70 caracteres), tags (10 tags), capa (descrição detalhada de uma capa/thumbnail forte: cena, texto curto de até 4 palavras, cores, emoção), ` +
    `melhorias (3 sugestões objetivas de edição ou roteiro), nota_retencao (0 a 10, estimativa heurística com justificativa curta).`;
  const data = await call(db, TEXT_MODEL(), {
    contents: [{ role: 'user', parts: [{ file_data: { file_uri: url } }, { text: prompt }] }],
    generationConfig: { maxOutputTokens: 2000, temperature: 0.7, responseMimeType: 'application/json' }
  });
  const raw = textOf(data);
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
  }
  if (!parsed) throw new HttpError(502, 'A IA respondeu em um formato inesperado. Tente novamente.');
  return { videoId, modelo: TEXT_MODEL(), insights: parsed, aviso: 'Análise gerada por IA a partir do conteúdo público do vídeo. Notas e estimativas são heurísticas, não métricas do YouTube.' };
}

/** Gera uma capa (imagem) a partir de uma descrição; devolve PNG em base64. */
export async function generateThumbnail(db, { title, brief = '', style = 'vibrante' }) {
  const prompt =
    `Crie uma thumbnail (capa) de vídeo do YouTube, proporção 16:9, impactante e legível em tamanho pequeno. ` +
    `Tema do vídeo: "${title}". ${brief ? 'Detalhes: ' + brief + '. ' : ''}` +
    `Estilo: ${style}. Composição com um elemento principal grande, contraste alto, sem marcas d'água, sem logotipos de terceiros. ` +
    `Se incluir texto, use no máximo 4 palavras em português, grandes e legíveis.`;
  const data = await call(db, IMAGE_MODEL(), {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
  });
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) throw new HttpError(502, 'A IA não devolveu uma imagem desta vez. Tente de novo com outra descrição.');
  return {
    mime: img.inlineData.mimeType || 'image/png',
    base64: img.inlineData.data,
    modelo: IMAGE_MODEL(),
    nota: parts.find((p) => p.text)?.text || ''
  };
}

/**
 * Transformar: a IA assiste o vídeo e reaproveita o conteúdo.
 *  - shorts: encontra de 3 a 5 trechos que funcionam sozinhos como Shorts (com tempos)
 *  - post: post para a aba Comunidade; artigo: artigo de blog; thread: sequência para redes
 */
export async function transformVideo(db, videoId, mode = 'shorts') {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const prompts = {
    shorts:
      'Assista a este vídeo e encontre de 3 a 5 trechos que funcionam sozinhos como YouTube Shorts (cada um com no máximo 60 segundos). ' +
      'Responda SOMENTE com JSON: {"cortes":[{"inicio":"mm:ss","fim":"mm:ss","titulo":"título do Short (até 60 caracteres)","gancho":"frase de abertura","motivo":"por que esse trecho prende"}]}.',
    post: 'Assista a este vídeo e escreva um post para a aba Comunidade do YouTube (até 500 caracteres) que gere comentários, mais uma enquete com 4 opções. Responda SOMENTE com JSON: {"post":"...","enquete":{"pergunta":"...","opcoes":["...","...","...","..."]}}.',
    artigo: 'Assista a este vídeo e transforme o conteúdo em um artigo de blog em português (título, introdução, 3 a 5 seções com subtítulos e conclusão). Responda SOMENTE com JSON: {"titulo":"...","texto":"... em markdown simples ..."}.',
    thread: 'Assista a este vídeo e transforme em uma sequência de 6 posts curtos para redes sociais (até 270 caracteres cada), o primeiro com um gancho forte e o último com chamada para o vídeo. Responda SOMENTE com JSON: {"posts":["...","..."]}.'
  };
  const prompt = prompts[mode] || prompts.shorts;
  const data = await call(db, TEXT_MODEL(), {
    contents: [{ role: 'user', parts: [{ file_data: { file_uri: url } }, { text: prompt }] }],
    generationConfig: { maxOutputTokens: 2500, temperature: 0.7, responseMimeType: 'application/json' }
  });
  const raw = textOf(data);
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
  }
  if (!parsed) throw new HttpError(502, 'A IA respondeu em um formato inesperado. Tente novamente.');
  return { videoId, mode, modelo: TEXT_MODEL(), resultado: parsed, aviso: 'Gerado por IA a partir do conteúdo público do vídeo. Confira os tempos antes de cortar.' };
}
