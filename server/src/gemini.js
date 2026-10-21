// Integração com a API do Gemini (Google AI Studio). A chave é configurada pelo
// administrador em Admin > Configurações (gemini_api_key) ou via GEMINI_API_KEY.
// Usos: textos das ferramentas (títulos, descrições, tags, ideias, respostas) e a IA
// que "assiste" o vídeo do YouTube pela URL e acha os cortes. Só texto: o site não
// gera imagens (geração de imagem não tem uso gratuito na API do Gemini).
//
// Os modelos mudam com o tempo: tentamos uma lista em ordem e guardamos o que funcionou.
import { getSetting } from './db.js';
import { HttpError } from './util.js';

const API_BASE = () => (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta/').replace(/\/?$/, '/');
const uniq = (a) => [...new Set(a.filter(Boolean))];
const MODELS = {
  text: () => uniq([process.env.GEMINI_TEXT_MODEL, 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview', 'gemini-2.5-flash'])
};
const working = { text: null }; // último modelo que respondeu bem

export const AI_MISSING_MSG =
  'A IA ainda não foi ligada neste site: falta o administrador colar a chave do Gemini em Admin > Configurações (a chave é gratuita no Google AI Studio). Nenhum crédito foi cobrado.';

export async function geminiKey(db) {
  return ((await getSetting(db, 'gemini_api_key')) || process.env.GEMINI_API_KEY || '').trim();
}

/** Classifica o erro do Gemini para decidir: tentar outro modelo ou explicar ao usuário. */
export function classifyGeminiError(status, msg) {
  const m = String(msg || '');
  if (/API key not valid|API_KEY_INVALID|invalid api key|API key expired/i.test(m)) return 'key';
  if (/limit: ?0\b|free[_ ]tier|FreeTier|billing|requires a paid|upgrade your plan/i.test(m)) return 'billing';
  if (status === 503 || status === 500 || status === 504 || /high demand|overloaded|UNAVAILABLE|try again later|temporarily|Internal error|DEADLINE_EXCEEDED/i.test(m)) return 'busy';
  if (status === 404 || /is not found|not supported for generateContent|no longer available|is not available|does not exist|unknown model|has been deprecated|not found for API version/i.test(m)) return 'model';
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(m)) return 'quota';
  if (status === 400 && /Unknown name|Invalid JSON payload|Cannot find field/i.test(m)) return 'payload';
  if (/video|file_uri|fileData|youtube/i.test(m) && status === 400) return 'video';
  if (/location is not supported|User location/i.test(m)) return 'region';
  if (/SAFETY|blocked/i.test(m)) return 'safety';
  return 'other';
}

function errorFor(kind, cls, msg) {
  switch (cls) {
    case 'key':
      return new HttpError(409, 'A chave do Gemini foi recusada pelo Google. Confira em Admin > Configurações (copie de novo em aistudio.google.com/apikey). Os créditos foram devolvidos.');
    case 'quota':
      return new HttpError(429, 'A IA atingiu o limite de uso por agora. Tente de novo em alguns minutos. Os créditos foram devolvidos.');
    case 'billing':
      return new HttpError(429, 'A IA gratuita do Gemini chegou ao limite por agora (por minuto ou do dia). Tente de novo mais tarde. Os créditos foram devolvidos.');
    case 'busy':
      return new HttpError(503, 'A IA do Google está sobrecarregada neste momento (isso costuma passar em poucos minutos). Tente de novo daqui a pouco. Os créditos foram devolvidos.');
    case 'region':
      return new HttpError(409, 'O Gemini não está disponível para a região do servidor. Os créditos foram devolvidos.');
    case 'safety':
      return new HttpError(422, 'A IA recusou gerar este conteúdo pelas regras de segurança do Google. Tente outro vídeo ou estilo. Os créditos foram devolvidos.');
    default:
      return new HttpError(502, 'Erro da IA do Gemini: ' + String(msg || '').slice(0, 300) + ' (os créditos foram devolvidos)');
  }
}

async function post(key, model, body) {
  let resp, data;
  try {
    resp = await fetch(`${API_BASE()}models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body)
    });
    data = await resp.json().catch(() => ({}));
  } catch {
    throw new HttpError(502, 'Não foi possível falar com a IA do Gemini agora. Tente de novo em instantes. Os créditos foram devolvidos.');
  }
  return { ok: resp.ok, status: resp.status, data, msg: data?.error?.message || `HTTP ${resp.status}` };
}

/**
 * Chama o Gemini tentando os modelos em ordem. `variants` são corpos alternativos
 * (ex.: sem um campo de configuração) usados quando o modelo recusa o formato.
 */
export async function callGemini(db, kind, body, { variants = [] } = {}) {
  const key = await geminiKey(db);
  if (!key) throw new HttpError(409, AI_MISSING_MSG);
  const list = uniq([working[kind], ...MODELS[kind]()]);
  let lastCls = 'model', lastMsg = '';
  for (const model of list) {
    for (const b of [body, ...variants]) {
      let r = await post(key, model, b);
      if (!r.ok && classifyGeminiError(r.status, r.msg) === 'busy') {
        await new Promise((ok) => setTimeout(ok, Number(process.env.GEMINI_RETRY_MS || 1500))); // sobrecarga passageira: tenta de novo uma vez
        r = await post(key, model, b);
      }
      if (r.ok) {
        const blocked = r.data?.promptFeedback?.blockReason;
        if (blocked && !r.data?.candidates?.length) throw errorFor(kind, 'safety', blocked);
        working[kind] = model;
        return { data: r.data, model };
      }
      const cls = classifyGeminiError(r.status, r.msg);
      lastCls = cls; lastMsg = r.msg;
      if (cls === 'payload') continue; // tenta o mesmo modelo com o corpo alternativo
      if (cls === 'video') { const e = errorFor(kind, 'other', r.msg); e.videoProblem = true; throw e; }
      break; // sai do loop de corpos
    }
    if (['model', 'payload', 'quota', 'billing', 'busy'].includes(lastCls)) continue; // próximo modelo (os limites gratuitos são por modelo)
    throw errorFor(kind, lastCls, lastMsg);
  }
  throw lastCls === 'model' || lastCls === 'payload'
    ? new HttpError(502, 'Nenhum modelo do Gemini disponível respondeu para esta chave agora. Detalhe: ' + String(lastMsg).slice(0, 200) + ' (os créditos foram devolvidos)')
    : errorFor(kind, lastCls, lastMsg);
}

export function textOf(data) {
  return (data?.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('\n').trim();
}

export function parseJsonLoose(text) {
  if (!text) return null;
  const t = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

/** Texto simples. */
export async function geminiText(db, prompt, { maxTokens = 4096 } = {}) {
  const { data, model } = await callGemini(db, 'text', {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: Math.max(2048, maxTokens * 2), temperature: 0.8 }
  });
  return { text: textOf(data), model };
}

/** Resposta em JSON a partir de partes (texto, imagens, vídeo do YouTube). */
export async function geminiJson(db, parts, { maxTokens = 8192, temperature = 0.7, lowRes = false } = {}) {
  const gen = { maxOutputTokens: maxTokens, temperature, responseMimeType: 'application/json' };
  const body = { contents: [{ role: 'user', parts }], generationConfig: lowRes ? { ...gen, mediaResolution: 'MEDIA_RESOLUTION_LOW' } : gen };
  const { data, model } = await callGemini(db, 'text', body, { variants: [{ contents: body.contents, generationConfig: { maxOutputTokens: maxTokens, temperature } }] });
  const json = parseJsonLoose(textOf(data));
  if (!json) throw new HttpError(502, 'A IA respondeu em um formato inesperado. Tente novamente (os créditos foram devolvidos).');
  return { json, model };
}

/** Parte "vídeo do YouTube" (só vídeos públicos); limita a duração analisada nos vídeos longos. */
export function youtubePart(videoId, durationSec = 0) {
  const part = { file_data: { file_uri: `https://www.youtube.com/watch?v=${videoId}` } };
  if (durationSec > 45 * 60) part.video_metadata = { start_offset: '0s', end_offset: '2400s' };
  return part;
}

/**
 * Transformar: a IA assiste o vídeo e reaproveita o conteúdo.
 *  - shorts: encontra de 3 a 5 trechos que funcionam sozinhos como Shorts (com tempos)
 *  - post: post para a aba Comunidade; artigo: artigo de blog; thread: sequência para redes
 */
export async function transformVideo(db, videoId, mode = 'shorts') {
  const prompts = {
    shorts:
      'Assista a este vídeo e encontre EXATAMENTE 3 trechos (os 3 melhores) que funcionam sozinhos como YouTube Shorts, cada um com 15 a 60 segundos e sem se sobrepor. ' +
      'Responda SOMENTE com JSON: {"cortes":[{"inicio":"mm:ss","fim":"mm:ss","titulo":"título do Short (até 60 caracteres)","gancho":"frase de abertura","motivo":"por que esse trecho prende"}]}.',
    post: 'Assista a este vídeo e escreva um post para a aba Comunidade do YouTube (até 500 caracteres) que gere comentários, mais uma enquete com 4 opções. Responda SOMENTE com JSON: {"post":"...","enquete":{"pergunta":"...","opcoes":["...","...","...","..."]}}.',
    artigo: 'Assista a este vídeo e transforme o conteúdo em um artigo de blog em português (título, introdução, 3 a 5 seções com subtítulos e conclusão). Responda SOMENTE com JSON: {"titulo":"...","texto":"... em markdown simples ..."}.',
    thread: 'Assista a este vídeo e transforme em uma sequência de 6 posts curtos para redes sociais (até 270 caracteres cada), o primeiro com um gancho forte e o último com chamada para o vídeo. Responda SOMENTE com JSON: {"posts":["...","..."]}.'
  };
  const { json, model } = await geminiJson(db, [youtubePart(videoId), { text: prompts[mode] || prompts.shorts }], { lowRes: true });
  if (mode === 'shorts') json.cortes = (Array.isArray(json.cortes) ? json.cortes : []).filter((c) => c && c.inicio && c.fim).slice(0, 3);
  return { videoId, mode, modelo: model, resultado: json, aviso: 'Gerado por IA a partir do conteúdo público do vídeo. Confira os tempos antes de cortar.' };
}

/** Teste rápido da chave (usado no Admin). */
export async function testGemini(db) {
  const { text, model } = await geminiText(db, 'Responda somente com a palavra OK.', { maxTokens: 50 });
  return { ok: /ok/i.test(text), modelo: model, resposta: text.slice(0, 40) };
}
