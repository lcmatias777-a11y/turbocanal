// Ferramentas de IA. Com ANTHROPIC_API_KEY configurada, usa a API da Anthropic;
// sem chave (ou em caso de falha), usa um gerador heurístico e AVISA o usuário.

const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

async function callClaude(prompt, maxTokens = 900) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL(),
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await resp.json();
    if (!resp.ok) return null;
    return data?.content?.map((c) => c.text || '').join('\n').trim() || null;
  } catch {
    return null;
  }
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

export async function titleSuggestions({ topic, keywords = [] }) {
  const prompt =
    `Você é um especialista em títulos de vídeos do YouTube em português do Brasil. ` +
    `Gere 8 títulos originais, com no máximo 70 caracteres cada, para um vídeo sobre: "${topic}". ` +
    (keywords.length ? `Palavras-chave para considerar: ${keywords.join(', ')}. ` : '') +
    `Varie o estilo (lista, pergunta, curiosidade, tutorial). Responda apenas com os títulos, um por linha, sem numeração.`;
  const ai = await callClaude(prompt);
  if (ai) {
    const titles = ai.split('\n').map((l) => l.replace(/^[\d.)\-*\s]+/, '').trim()).filter(Boolean).slice(0, 8);
    if (titles.length >= 4) return { titles, metodo: 'ia', modelo: MODEL() };
  }
  return {
    titles: heurTitles(topic, keywords),
    metodo: 'heuristica',
    aviso: 'Gerado por regras locais (IA não configurada neste servidor). O administrador pode ativar a IA com uma chave da API da Anthropic.'
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

export async function descriptionOptimize({ topic, draft = '', keywords = [] }) {
  const prompt =
    `Você é um especialista em SEO para YouTube (pt-BR). Escreva uma descrição otimizada (até 1500 caracteres) ` +
    `para um vídeo sobre "${topic}". ` +
    (draft ? `Rascunho atual do criador: """${draft.slice(0, 1500)}""". Melhore mantendo a voz dele. ` : '') +
    (keywords.length ? `Inclua naturalmente: ${keywords.join(', ')}. ` : '') +
    `Estrutura: 2 primeiras linhas com a promessa do vídeo, seção de capítulos com 00:00, chamada para inscrição, e 3 a 5 hashtags no final. Responda só com a descrição.`;
  const ai = await callClaude(prompt, 1200);
  if (ai) return { description: ai, metodo: 'ia', modelo: MODEL() };
  return {
    description: heurDescription({ topic, draft, keywords }),
    metodo: 'heuristica',
    aviso: 'Gerado por modelo local de regras (IA não configurada neste servidor).'
  };
}
