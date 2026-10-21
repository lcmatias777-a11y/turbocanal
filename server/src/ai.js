// Ferramentas de IA de texto. Ordem de preferência:
//   1) Anthropic (ANTHROPIC_API_KEY)  2) Gemini (chave no Admin ou GEMINI_API_KEY)
//   3) gerador heurístico local (sempre avisa o usuário do método usado)
import { geminiKey, geminiText } from './gemini.js';

const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

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
  if (a) return { text: a, metodo: 'ia', modelo: MODEL() };
  if (await geminiKey(db)) {
    try {
      const g = await geminiText(db, prompt, { maxTokens });
      if (g) return { text: g, metodo: 'ia', modelo: 'gemini' };
    } catch {
      /* cai para o heurístico */
    }
  }
  return null;
}

// Núcleo do tema: tira complementos de um título existente ("X: guia...", "X (2026)", "X | canal")
function topicCore(topic) {
  let t = String(topic || '').trim().replace(/\s+/g, ' ');
  t = t.split(/\s*(?::|\||\s-\s|\s–\s|\(|\[)\s*/)[0].trim() || t;
  return t.replace(/[.!?,;]+$/, '').trim();
}
const fitTitle = (s) => (s.length <= 100 ? s : s.slice(0, 100).replace(/\s+\S*$/, ''));

function heurTitles(topic, keywords = []) {
  const t = topicCore(topic);
  const kw = keywords.filter(Boolean).slice(0, 3);
  const extra = kw.length && !t.toLowerCase().includes(String(kw[0]).toLowerCase()) ? ` (${kw[0]})` : '';
  const m = t.match(/^como\s+(.+)$/i);
  const list = m
    ? [
        `${t}: o guia completo para iniciantes`,
        `7 erros que te impedem de ${m[1]}`,
        `${t} do ZERO em 2026${extra}`,
        `${t} em 10 minutos (o essencial)`,
        `O segredo para ${m[1]} que ninguém te conta`,
        `Tentei ${m[1]} por 30 dias: o resultado`,
        `${t}? Explicado de um jeito simples`,
        `Antes de tentar ${m[1]}, assista isso`
      ]
    : [
        `${t}: o guia completo para iniciantes`,
        `7 erros em ${t} que travam seu canal`,
        `Como fazer ${t} do ZERO em 2026${extra}`,
        `${t} em 10 minutos: o essencial`,
        `A verdade sobre ${t} que ninguém te conta`,
        `Testei ${t} por 30 dias: o resultado`,
        `${t} explicado de um jeito simples`,
        `Antes de tentar ${t}, assista isso`
      ];
  return [...new Set(list.map((x) => fitTitle(x.charAt(0).toUpperCase() + x.slice(1))))];
}

export async function titleSuggestions(db, { topic, keywords = [] }) {
  const prompt =
    `Você é um especialista em títulos de vídeos do YouTube em português do Brasil. ` +
    `Gere 8 títulos originais, com no máximo 70 caracteres cada, para um vídeo sobre: "${topic}". ` +
    (keywords.length ? `Palavras-chave para considerar: ${keywords.join(', ')}. ` : '') +
    `Varie o estilo (lista, pergunta, curiosidade, tutorial). Responda apenas com os títulos, um por linha, sem numeração.`;
  const ai = await callAny(db, prompt, 900);
  if (ai) {
    const titles = ai.text.split('\n').map((l) => l.replace(/^[\d.)\-*\s]+/, '').trim()).filter(Boolean).slice(0, 8);
    if (titles.length >= 4) return { titles, metodo: 'ia', modelo: ai.modelo };
  }
  return {
    titles: heurTitles(topic, keywords),
    metodo: 'heuristica',
    aviso: 'Gerado por regras locais (nenhuma IA configurada neste servidor). O administrador pode ativar a IA em Admin > Configurações.'
  };
}

function heurDescription({ topic, draft = '', keywords = [] }) {
  const kws = keywords.filter(Boolean);
  const hash = kws.slice(0, 4).map((k) => '#' + k.replace(/\s+/g, '')).join(' ');
  return [
    `Neste vídeo você vai aprender sobre ${topic}.`,
    draft ? `\n${draft.trim()}\n` : '',
    `\n⏱ CAPÍTULOS\n00:00 Introdução\n(adicione os capítulos reais do seu vídeo)`,
    `\n🔔 Se este conteúdo te ajudou, se inscreva no canal e ative o sininho.`,
    kws.length ? `\nPalavras-chave: ${kws.join(', ')}` : '',
    hash ? `\n${hash}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export async function descriptionOptimize(db, { topic, draft = '', keywords = [] }) {
  const prompt =
    `Você é um especialista em SEO para YouTube (pt-BR). Escreva uma descrição otimizada (até 1500 caracteres) ` +
    `para um vídeo sobre "${topic}". ` +
    (draft ? `Rascunho atual do criador: """${draft.slice(0, 1500)}""". Melhore mantendo a voz dele. ` : '') +
    (keywords.length ? `Inclua naturalmente: ${keywords.join(', ')}. ` : '') +
    `Estrutura: 2 primeiras linhas com a promessa do vídeo, seção de capítulos com 00:00, chamada para inscrição, e 3 a 5 hashtags no final. Responda só com a descrição.`;
  const ai = await callAny(db, prompt, 1200);
  if (ai) return { description: ai.text, metodo: 'ia', modelo: ai.modelo };
  return {
    description: heurDescription({ topic, draft, keywords }),
    metodo: 'heuristica',
    aviso: 'Gerado por modelo local de regras (nenhuma IA configurada neste servidor).'
  };
}

// ---------------- Preparar (pacote de publicação, ideias, roteiro) ----------------
function parseJsonLoose(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const m = String(text).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

function words(topic) {
  return String(topic).toLowerCase().split(/[^a-zà-ú0-9#+]+/i).filter((w) => w.length >= 3);
}

function heurPrep({ topic, notes = '', mode }) {
  const t = topicCore(topic);
  const ws = words(t);
  const lt = t.toLowerCase();
  const tags = [...new Set([lt, ...ws.filter((w) => w !== 'como'), `${lt} tutorial`, `${lt} dicas`, ...(lt.startsWith('como ') ? [] : [`como ${lt}`]), `${lt} para iniciantes`, `${lt} 2026`, `melhor ${ws[ws.length - 1] || lt}`])].slice(0, 15);
  const base = {
    titulos: heurTitles(t, ws),
    descricao: heurDescription({ topic: t, draft: notes, keywords: ws.slice(0, 5) }),
    tags,
    hashtags: ws.slice(0, 4).map((w) => '#' + w),
    capa_textos: ['NÃO FAÇA ISSO', 'FUNCIONA?!', 'O SEGREDO', 'EM 10 MIN', 'TESTEI 30 DIAS'],
    roteiro: [
      { parte: 'Gancho (0 a 10s)', texto: `Comece mostrando o resultado final de ${t} ou o maior erro que as pessoas cometem.` },
      { parte: 'Promessa (10 a 30s)', texto: `Diga em uma frase o que a pessoa vai conseguir fazer com ${t} até o fim do vídeo.` },
      { parte: 'Parte 1', texto: 'O básico, sem enrolação: o primeiro passo e por que ele importa.' },
      { parte: 'Parte 2', texto: 'O passo que mais gente erra, com um exemplo na tela.' },
      { parte: 'Parte 3', texto: 'O truque avançado ou atalho que diferencia seu vídeo.' },
      { parte: 'Chamada final', texto: 'Peça inscrição citando o próximo vídeo da série (gera clique em sequência).' }
    ],
    ideias: [
      `${t}: guia completo do zero`, `7 erros de ${t} que todo iniciante comete`, `Testei ${t} por 7 dias`, `${t} vs alternativa: qual é melhor?`,
      `Reagindo aos melhores de ${t}`, `${t} com 1 regra só (desafio)`, `O que ninguém te conta sobre ${t}`, `${t}: do pior ao melhor (ranking)`,
      `Fiz ${t} do jeito ERRADO de propósito`, `${t} em 60 segundos (Shorts)`
    ]
  };
  return { ...base, metodo: 'heuristica', aviso: 'Gerado por regras locais (nenhuma IA configurada). Com a chave do Gemini no Admin, o resultado fica muito melhor.', mode };
}

export async function prepPack(db, { topic, notes = '', audience = '', mode = 'pacote' }) {
  const prompt =
    `Você é um estrategista de YouTube brasileiro. Tema do vídeo: "${topic}". ` +
    (notes ? `Anotações do criador: """${notes.slice(0, 1500)}""". ` : '') +
    (audience ? `Público: ${audience}. ` : '') +
    `Responda SOMENTE com JSON válido (sem markdown) com as chaves: ` +
    `titulos (8 títulos de até 70 caracteres, variados), descricao (descrição otimizada com 2 linhas de promessa, capítulos 00:00 de exemplo, CTA e 3 a 5 hashtags), ` +
    `tags (15 tags), hashtags (5), capa_textos (5 textos curtos de até 4 palavras para a capa), ` +
    `roteiro (lista de objetos {parte, texto} com gancho de 0 a 10s, promessa, 3 partes e chamada final), ` +
    `ideias (10 ideias de próximos vídeos relacionados).`;
  const ai = await callAny(db, prompt, 2500);
  const parsed = ai ? parseJsonLoose(ai.text) : null;
  if (parsed && Array.isArray(parsed.titulos)) return { ...parsed, metodo: 'ia', modelo: ai.modelo, mode };
  return heurPrep({ topic, notes, mode });
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
  const ai = await callAny(db, prompt, 1800);
  const parsed = ai ? parseJsonLoose(ai.text) : null;
  if (parsed && Array.isArray(parsed.ideias) && parsed.ideias.length) return { ideias: parsed.ideias.slice(0, 10), metodo: 'ia', modelo: ai.modelo, base: list.length };
  return heurIdeas({ niche, titles: list });
}

function heurIdeas({ niche, titles }) {
  const freq = {};
  const stop = new Set(['como', 'para', 'com', 'que', 'uma', 'meu', 'minha', 'você', 'voce', 'mais', 'muito', 'isso', 'esse', 'essa', 'dos', 'das', 'por', 'sem', 'the', 'and']);
  for (const t of titles) for (const w of words(t)) if (!stop.has(w)) freq[w] = (freq[w] || 0) + 1;
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([w]) => w);
  const base = (niche || top.slice(0, 2).join(' ') || 'seu tema').trim();
  const best = titles[0];
  const ideias = [
    best
      ? { titulo: `${best.slice(0, 58)} (parte 2)`, formato: 'Longo', porque: 'Continuar o vídeo que mais performou aproveita quem já gostou do tema.', palavra_chave: base }
      : { titulo: `${base}: guia completo do zero`, formato: 'Longo', porque: 'Guias completos têm busca constante.', palavra_chave: base },
    { titulo: `7 erros de ${base} que todo iniciante comete`, formato: 'Longo', porque: 'Listas de erros despertam curiosidade e retêm até o fim.', palavra_chave: `${base} erros` },
    { titulo: `${base} em 60 segundos`, formato: 'Shorts', porque: 'Shorts trazem público novo para os vídeos longos.', palavra_chave: base },
    { titulo: `Testei ${base} por 7 dias`, formato: 'Longo', porque: 'Desafios com prazo criam expectativa pelo resultado.', palavra_chave: base },
    { titulo: `${base}: do pior ao melhor (ranking)`, formato: 'Longo', porque: 'Rankings geram discussão nos comentários.', palavra_chave: `melhor ${base}` },
    { titulo: `O que ninguém te conta sobre ${base}`, formato: 'Shorts', porque: 'Promessa de segredo aumenta o clique.', palavra_chave: base },
    { titulo: `${top[2] || base} vs ${top[3] || 'o mais popular'}: qual é melhor?`, formato: 'Longo', porque: 'Comparações respondem uma dúvida real de quem pesquisa.', palavra_chave: `${top[2] || base} vs` },
    { titulo: `Respondendo as perguntas sobre ${base}`, formato: 'Longo', porque: 'Usa as dúvidas do seu público como pauta.', palavra_chave: `${base} dúvidas` },
    { titulo: `${base} para iniciantes (passo a passo)`, formato: 'Longo', porque: 'Termo de busca com muita procura e intenção clara.', palavra_chave: `${base} iniciante` },
    { titulo: `Fiz ${base} do jeito ERRADO de propósito`, formato: 'Shorts', porque: 'Humor e quebra de expectativa viralizam bem em Shorts.', palavra_chave: base }
  ];
  return { ideias, metodo: 'heuristica', base: titles.length, aviso: 'Gerado por regras locais a partir dos seus títulos (nenhuma IA configurada). Com a chave do Gemini no Admin, as ideias ficam personalizadas de verdade.' };
}

// ---------------- Sugestões de resposta a comentários ----------------
export async function replySuggestions(db, { comment, channel = '' }) {
  const prompt =
    `Você administra o canal do YouTube "${channel}". Escreva 3 respostas curtas (até 220 caracteres), simpáticas e naturais, ` +
    `em português do Brasil, para este comentário: """${String(comment).slice(0, 1000)}""". Varie o tom (agradecer, responder a dúvida, puxar conversa). ` +
    `Responda SOMENTE com JSON: {"respostas": ["...", "...", "..."]}.`;
  const ai = await callAny(db, prompt, 500);
  const parsed = ai ? parseJsonLoose(ai.text) : null;
  if (parsed && Array.isArray(parsed.respostas)) return { respostas: parsed.respostas.slice(0, 3), metodo: 'ia' };
  return {
    respostas: ['Valeu demais pelo comentário! 🙌 Fico feliz que curtiu.', 'Boa pergunta! Vou explicar melhor isso num próximo vídeo, fica ligado. 😉', 'Obrigado por assistir! Qual parte você mais gostou?'],
    metodo: 'heuristica'
  };
}
