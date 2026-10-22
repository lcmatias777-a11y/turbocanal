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

// ---------------- Auditoria do canal ----------------
/** Olha os últimos vídeos do canal e devolve nota, o que funciona e 5 melhorias.
 *  Regra: cada recomendação precisa citar o DADO que a sustenta (nada de palpite solto). */
export async function channelAudit(db, { canal = '', inscritos = null, videos = [] }) {
  const lista = videos.slice(0, 25);
  if (!lista.length) throw new HttpError(400, 'Não encontrei vídeos no seu canal para auditar.');
  const mediana = (arr) => {
    const v = arr.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : 0;
  };
  const medViews = mediana(lista.map((v) => v.views));
  const linhas = lista.map((v, i) =>
    `${i + 1}. "${String(v.titulo).slice(0, 90)}" | ${v.views} views | ${v.likes ?? '?'} likes | ${v.comentarios ?? '?'} comentários | ` +
    `${v.duracaoSeg ? Math.round(v.duracaoSeg / 60) + ' min' : 'duração ?'} | ${v.tags} tags | descrição ${v.descricaoTam} caracteres | SEO ${v.seo}/100 | publicado ${String(v.publicado || '').slice(0, 10)}`
  ).join('\n');
  const prompt =
    `Você é um analista de canais do YouTube, brasileiro, direto e honesto. Audite o canal com os dados REAIS abaixo. ` +
    `Canal: "${canal}"${inscritos != null ? `, ${inscritos} inscritos` : ''}. Mediana de views dos últimos vídeos: ${medViews}.\n` +
    `ÚLTIMOS VÍDEOS:\n${linhas}\n\n` +
    `Regras: use SOMENTE esses números; toda recomendação precisa citar o dado que a sustenta (ex.: "os 3 vídeos acima da mediana têm menos de 8 minutos"); ` +
    `não prometa resultado garantido; não invente métricas que não estão aí (retenção, CTR e impressões NÃO estão disponíveis, não fale delas como se soubesse). ` +
    `Responda SOMENTE com JSON válido, sem markdown: ` +
    `{"nota":0-100,"resumo":"2 frases sobre o estado do canal","funciona":[{"ponto":"o que está dando certo","dado":"o número que mostra isso"}],` +
    `"melhorias":[{"titulo":"melhoria em até 8 palavras","dado":"o número que justifica","acao":"o que fazer no próximo vídeo, bem concreto"}],` +
    `"proximos":[{"titulo":"ideia de próximo vídeo","porque":"baseado em qual padrão"}]} ` +
    `Exatamente 5 itens em "melhorias", 3 em "funciona" e 3 em "proximos".`;
  const { parsed, modelo } = await askJson(db, prompt, 2200, (p) => Array.isArray(p.melhorias) && p.melhorias.length);
  return {
    nota: Math.max(0, Math.min(100, Math.round(Number(parsed.nota) || 0))),
    resumo: String(parsed.resumo || '').slice(0, 600),
    funciona: (parsed.funciona || []).slice(0, 3),
    melhorias: parsed.melhorias.slice(0, 5),
    proximos: (parsed.proximos || []).slice(0, 3),
    base: { videos: lista.length, medianaViews: medViews },
    aviso: 'Análise feita só com os números públicos dos seus vídeos: não inclui retenção nem CTR. A retenção e os inscritos por vídeo você vê no Raio-X dos vídeos, que lê o Analytics do seu canal. CTR e impressões o YouTube só mostra no Studio.',
    metodo: 'ia',
    modelo
  };
}

// ---------------- Laboratório de título ----------------
/** Nota do título com critérios objetivos (medidos aqui, não pela IA) + 5 alternativas. */
export function titleChecks(titulo, palavra = '') {
  const t = String(titulo || '').trim();
  const p = String(palavra || '').trim().toLowerCase();
  const checks = [];
  const add = (item, ok, dica) => checks.push({ item, ok: !!ok, dica });
  add('Entre 20 e 70 caracteres', t.length >= 20 && t.length <= 70, `Está com ${t.length}. Acima de 70 o YouTube corta no feed.`);
  add('Tem número ou colchete', /\d|\[|\(/.test(t), 'Números e marcadores costumam aumentar o clique.');
  add('Palavra-chave nas primeiras 40 letras', !p || t.slice(0, 40).toLowerCase().includes(p), p ? `Coloque "${palavra}" no começo.` : 'Informe a palavra-chave para eu conferir.');
  add('Sem CAIXA ALTA exagerada', (t.replace(/[^A-ZÁÉÍÓÚÂÊÔÃÕÇ]/g, '').length / Math.max(1, t.replace(/\s/g, '').length)) < 0.5, 'Mais da metade em maiúsculas parece spam.');
  add('Promete algo claro', /(como|por que|porque|o que|melhor|pior|nunca|sempre|segredo|erro|truque|guia|passo a passo|em \d)/i.test(t), 'Diga o que a pessoa ganha assistindo.');
  add('Sem emoji demais', (t.match(/\p{Extended_Pictographic}/gu) || []).length <= 2, 'Até 2 emojis; mais do que isso polui.');
  const ok = checks.filter((c) => c.ok).length;
  return { nota: Math.round((ok / checks.length) * 100), checks, tamanho: t.length };
}

export async function titleLab(db, { titulo, palavra = '', canal = '' }) {
  const medido = titleChecks(titulo, palavra);
  const faltando = medido.checks.filter((c) => !c.ok).map((c) => c.item);
  const prompt =
    `Você é especialista em títulos do YouTube em português do Brasil. ` +
    (canal ? `Canal: "${canal}". ` : '') +
    `Título atual: "${String(titulo).slice(0, 120)}" (${medido.tamanho} caracteres).` +
    (palavra ? ` Palavra-chave alvo: "${palavra}".` : '') +
    (faltando.length ? ` Uma checagem objetiva apontou que falta: ${faltando.join('; ')}.` : ' A checagem objetiva não apontou problemas.') +
    ` Escreva 5 alternativas melhores, cada uma com no máximo 70 caracteres, sem clickbait mentiroso (não prometa o que o título não entrega). ` +
    `Para cada uma, diga em 1 frase o que ela faz melhor que o original. ` +
    `Responda SOMENTE com JSON: {"diagnostico":"2 frases sobre o título atual","alternativas":[{"titulo":"...","porque":"..."}]}`;
  const { parsed, modelo } = await askJson(db, prompt, 1200, (p) => Array.isArray(p.alternativas) && p.alternativas.length);
  return {
    original: String(titulo).slice(0, 200),
    nota: medido.nota,
    checagem: medido.checks,
    diagnostico: String(parsed.diagnostico || '').slice(0, 400),
    alternativas: parsed.alternativas.slice(0, 5).map((a) => ({ titulo: String(a.titulo || '').slice(0, 100), porque: String(a.porque || '').slice(0, 200) })),
    aviso: 'A nota vem de critérios medidos aqui (tamanho, número, palavra-chave, caixa alta, promessa, emoji). As alternativas são sugestões da IA.',
    metodo: 'ia',
    modelo
  };
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
