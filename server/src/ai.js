// Ferramentas de IA de texto. Sempre IA de verdade (sem gerador de modelos prontos):
//   1) Anthropic (ANTHROPIC_API_KEY), se configurada
//   2) Gemini (chave no Admin ou GEMINI_API_KEY)
// Sem nenhuma das duas, as rotas recusam ANTES de cobrar (veja needAI em tools.js).
import { geminiKey, geminiText, parseJsonLoose, AI_MISSING_MSG } from './gemini.js';
import { HttpError } from './util.js';

const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

export async function aiConfigured(db) {
  return !!process.env.ANTHROPIC_API_KEY || !!(await geminiKey(db));
}

async function callClaude(prompt, maxTokens = 900) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await resp.json();
    if (!resp.ok) return null;
    return data?.content?.map((c) => c.text || '').join('\n').trim() || null;
  } catch {
    return null;
  }
}

async function callAny(db, prompt, maxTokens) {
  const a = await callClaude(prompt, maxTokens);
  if (a) return { text: a, modelo: MODEL() };
  if (await geminiKey(db)) {
    const g = await geminiText(db, prompt, { maxTokens });
    if (g.text) return { text: g.text, modelo: g.model };
    throw new HttpError(502, 'A IA não respondeu desta vez. Tente de novo (os créditos foram devolvidos).');
  }
  throw new HttpError(409, AI_MISSING_MSG);
}

async function askJson(db, prompt, maxTokens, check) {
  const ai = await callAny(db, prompt, maxTokens);
  const parsed = parseJsonLoose(ai.text);
  if (!parsed || !check(parsed)) throw new HttpError(502, 'A IA respondeu em um formato inesperado. Tente de novo (os créditos foram devolvidos).');
  return { parsed, modelo: ai.modelo };
}

export async function titleSuggestions(db, { topic, keywords = [] }) {
  const prompt =
    `Você é um especialista em títulos de vídeos do YouTube em português do Brasil. ` +
    `Gere 8 títulos originais, com no máximo 70 caracteres cada, para um vídeo sobre: "${topic}". ` +
    (keywords.length ? `Palavras-chave para considerar: ${keywords.join(', ')}. ` : '') +
    `Varie o estilo (lista, pergunta, curiosidade, tutorial). Responda apenas com os títulos, um por linha, sem numeração.`;
  const ai = await callAny(db, prompt, 900);
  const titles = ai.text.split('\n').map((l) => l.replace(/^[\d.)\-*\s"]+/, '').replace(/"$/, '').trim()).filter(Boolean).slice(0, 8);
  if (titles.length < 3) throw new HttpError(502, 'A IA respondeu em um formato inesperado. Tente de novo (os créditos foram devolvidos).');
  return { titles, metodo: 'ia', modelo: ai.modelo };
}

export async function descriptionOptimize(db, { topic, draft = '', keywords = [] }) {
  const prompt =
    `Você é um especialista em SEO para YouTube (pt-BR). Escreva uma descrição otimizada (até 1500 caracteres) ` +
    `para um vídeo sobre "${topic}". ` +
    (draft ? `Rascunho atual do criador: """${draft.slice(0, 1500)}""". Melhore mantendo a voz dele. ` : '') +
    (keywords.length ? `Inclua naturalmente: ${keywords.join(', ')}. ` : '') +
    `Estrutura: 2 primeiras linhas com a promessa do vídeo, chamada para inscrição e 3 a 5 hashtags no final. Não invente links. Responda só com a descrição.`;
  const ai = await callAny(db, prompt, 1200);
  return { description: ai.text, metodo: 'ia', modelo: ai.modelo };
}

// ---------------- Preparar (pacote de publicação, ideias, roteiro) ----------------
export async function prepPack(db, { topic, notes = '', audience = '', mode = 'pacote' }) {
  const prompt =
    `Você é um estrategista de YouTube brasileiro. Tema do vídeo: "${topic}". ` +
    (notes ? `Anotações do criador: """${notes.slice(0, 1500)}""". ` : '') +
    (audience ? `Público: ${audience}. ` : '') +
    `Responda SOMENTE com JSON válido (sem markdown) com as chaves: ` +
    `titulos (8 títulos de até 70 caracteres, variados), descricao (descrição otimizada com 2 linhas de promessa, chamada para inscrição e 3 a 5 hashtags; sem inventar links), ` +
    `tags (15 tags), hashtags (5), capa_textos (5 textos curtos de até 4 palavras para a capa), ` +
    `roteiro (lista de objetos {parte, texto} com gancho de 0 a 10s, promessa, 3 partes e chamada final), ` +
    `ideias (10 ideias de próximos vídeos relacionados).`;
  const { parsed, modelo } = await askJson(db, prompt, 2500, (p) => Array.isArray(p.titulos) && p.titulos.length);
  return { ...parsed, metodo: 'ia', modelo, mode };
}

// ---------------- Ideias de próximos vídeos para o canal ----------------
export async function channelIdeas(db, { niche = '', titles = [], channel = '' }) {
  const list = titles.filter(Boolean).slice(0, 20);
  const prompt =
    `Você é um estrategista de YouTube brasileiro. ` +
    (channel ? `Canal: "${channel}". ` : '') +
    (niche ? `Nicho/tema do canal: ${niche}. ` : '') +
    (list.length ? `Vídeos do canal com mais views (do mais para o menos visto): ${list.map((t) => `"${t}"`).join('; ')}. ` : '') +
    `Sugira 10 ideias de PRÓXIMOS vídeos com boa chance de performar e coerentes com o canal (misture Shorts e vídeos longos). ` +
    `Responda SOMENTE com JSON válido, sem markdown: {"ideias":[{"titulo":"até 70 caracteres","formato":"Shorts ou Longo","porque":"1 frase curta","palavra_chave":"termo de busca principal"}]}`;
  const { parsed, modelo } = await askJson(db, prompt, 1800, (p) => Array.isArray(p.ideias) && p.ideias.length);
  return { ideias: parsed.ideias.slice(0, 10), metodo: 'ia', modelo, base: list.length };
}

// ---------------- Sugestões de resposta a comentários ----------------
export async function replySuggestions(db, { comment, channel = '' }) {
  const prompt =
    `Você administra o canal do YouTube "${channel}". Escreva 3 respostas curtas (até 220 caracteres), simpáticas e naturais, ` +
    `em português do Brasil, para este comentário: """${String(comment).slice(0, 1000)}""". Varie o tom (agradecer, responder a dúvida, puxar conversa). ` +
    `Responda SOMENTE com JSON: {"respostas": ["...", "...", "..."]}.`;
  const { parsed, modelo } = await askJson(db, prompt, 500, (p) => Array.isArray(p.respostas) && p.respostas.length);
  return { respostas: parsed.respostas.slice(0, 3).map((r) => String(r).slice(0, 500)), metodo: 'ia', modelo };
}
