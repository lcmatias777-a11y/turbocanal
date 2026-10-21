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

function heurTitles(topic, keywords = []) {
  const t = topic.trim();
  const kw = keywords.filter(Boolean).slice(0, 3);
  const extra = kw.length ? ` (${kw[0]})` : '';
  return [
    `${t}: o guia completo para iniciantes`,
    `7 erros em ${t} que travam seu canal`,
    `Como fazer ${t} do ZERO em 2026${extra}`,
    `${t} em 10 minutos: o essencial`,
    `A verdade sobre ${t} que ninguém te conta`,
    `Testei ${t} por 30 dias: o resultado`,
    `${t} explicado de um jeito simples`,
    `Antes de tentar ${t}, assista isso`
  ];
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
  const t = topic.trim();
  const ws = words(t);
  const tags = [...new Set([t.toLowerCase(), ...ws, `${t} tutorial`, `${t} dicas`, `como ${t}`, `${t} para iniciantes`, `${t} 2026`, `melhor ${ws[0] || t}`])].slice(0, 15);
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
