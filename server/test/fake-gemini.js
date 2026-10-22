// Gemini simulado para os testes automáticos: imita a API generateContent o suficiente
// para exercitar o código real (troca de modelo, erros de faturamento e de chave,
// assistir vídeo, quadros anexados e geração de imagem). Nada aqui roda em produção.
import express from 'express';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

export async function startFakeGemini() {
  const KEY = 'chave-teste';
  const state = {
    unavailable: new Set(['gemini-3.8-flash']), // simula um modelo que esta chave ainda não acessa
    imageBilling: false, // simula "imagem sem uso gratuito"
    videoFails: false, // simula vídeo que a IA não consegue assistir
    busy: new Set(), // simula modelo sobrecarregado (503)
    log: []
  };
  const reply = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.post(/^\/v1beta\/models\/([^/:]+):generateContent$/, (req, res) => {
    const model = req.params[0];
    if (req.get('x-goog-api-key') !== KEY) return res.status(400).json({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
    if (state.busy?.has(model)) return res.status(503).json({ error: { code: 503, message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.', status: 'UNAVAILABLE' } });
    if (state.unavailable.has(model)) return res.status(404).json({ error: { code: 404, message: `models/${model} is not found for API version v1beta, or is not supported for generateContent.`, status: 'NOT_FOUND' } });
    const parts = req.body?.contents?.[0]?.parts || [];
    const text = parts.map((p) => p.text || '').join('\n');
    const video = parts.some((p) => p.file_data || p.fileData);
    const images = parts.filter((p) => p.inline_data || p.inlineData).length;
    const isImage = /image|banana/.test(model);
    state.log.push({ model, video, images, isImage, text: text.slice(0, 400), gen: req.body?.generationConfig });
    if (isImage) {
      if (state.imageBilling) return res.status(429).json({ error: { code: 429, message: 'You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: ' + model, status: 'RESOURCE_EXHAUSTED' } });
      return res.json({ candidates: [{ content: { parts: [{ text: 'Aqui está a capa.' }, { inlineData: { mimeType: 'image/png', data: PNG_1PX } }] } }] });
    }
    if (video && state.videoFails) return res.status(400).json({ error: { code: 400, message: 'Request contains an invalid argument: the video at file_uri could not be processed.', status: 'INVALID_ARGUMENT' } });
    if (/Responda somente com a palavra OK/.test(text)) return res.json(reply('OK'));
    if (/"texto":"até 4 palavras/.test(text)) return res.json(reply(JSON.stringify({ texto: 'venci sem gastar nada', cena: 'o jogador comemorando na ilha com a cama protegida', emocao: 'surpresa', cores: 'amarelo e azul' })));
    if (/capitulos \(/.test(text)) {
      const watching = /Assista ao vídeo anexado/.test(text);
      const tags = Array.from({ length: 40 }, (_, i) => (i === 0 ? '#Bedwars' : `bedwars dica número ${i} para iniciantes no minecraft`));
      return res.json(reply(JSON.stringify({
        resumo: 'O jogador mostra como vencer partidas de bedwars sem gastar.', titulos: ['Como vencer no Bedwars sem gastar nada', 'Bedwars: 5 truques que ninguém usa', 'Como vencer no Bedwars sem gastar nada'],
        descricao: 'Neste vídeo eu mostro como vencer no bedwars.\nInscreva-se!',
        capitulos: watching ? [{ tempo: '00:00', titulo: 'Começo' }, { tempo: '01:10', titulo: 'Proteção da cama' }, { tempo: '04:30', titulo: 'Final' }] : [{ tempo: '00:00', titulo: 'inventado' }],
        tags, hashtags: ['bedwars', '#minecraft'], capa_textos: ['VENCI SEM GASTAR'], melhorias: ['Mostre o resultado nos primeiros 5 segundos.']
      })));
    }
    if (/desempenho \(/.test(text)) return res.json(reply(JSON.stringify({ resumo: 'O jogador vence partidas de bedwars.', gancho: { nota: 7, analise: 'Começa mostrando a vitória.', sugestao: 'Mostre o placar antes.' }, desempenho: { veredito: 'acima da média', porque: 'Tem 4800 views, bem acima dos outros vídeos.' }, ideias: [{ titulo: 'Bedwars só com arco', porque: 'Desafio parecido' }, { titulo: 'Bedwars sem armadura', porque: 'Curiosidade' }, { titulo: 'Bedwars em 1 minuto', porque: 'Shorts' }, { titulo: 'extra' }], inscritos: ['Peça inscrição no pico do vídeo.', 'Faça séries.', 'Responda comentários.'] })));
    if (/"melhorias":\[\{"titulo"/.test(text)) return res.json(reply(JSON.stringify({
      nota: 72, resumo: 'Canal pequeno com vídeos acima da mediana quando são curtos.',
      funciona: [{ ponto: 'Vídeos curtos rendem mais', dado: 'os 3 acima da mediana têm menos de 8 min' }, { ponto: 'Títulos com número', dado: '2 dos 3 melhores têm número' }, { ponto: 'Tags consistentes', dado: 'média de 9 tags' }],
      melhorias: Array.from({ length: 7 }, (_, i) => ({ titulo: `Melhoria ${i + 1}`, dado: `dado ${i + 1}`, acao: `ação ${i + 1}` })),
      proximos: [{ titulo: 'Próximo 1', porque: 'padrão dos curtos' }, { titulo: 'Próximo 2', porque: 'tags' }, { titulo: 'Próximo 3', porque: 'número no título' }]
    })));
    if (/"alternativas":\[\{"titulo"/.test(text)) return res.json(reply(JSON.stringify({
      diagnostico: 'O título é longo e não traz a palavra-chave no começo.',
      alternativas: Array.from({ length: 7 }, (_, i) => ({ titulo: `Alternativa ${i + 1}`, porque: `motivo ${i + 1}` }))
    })));
    if (/"ideias"/.test(text)) return res.json(reply(JSON.stringify({ ideias: Array.from({ length: 10 }, (_, i) => ({ titulo: `Ideia ${i + 1} de bedwars`, formato: i % 2 ? 'Shorts' : 'Longo', porque: 'Combina com o canal.', palavra_chave: 'bedwars' })) })));
    if (/"respostas"/.test(text)) return res.json(reply('```json\n' + JSON.stringify({ respostas: ['Valeu!', 'Boa pergunta!', 'Qual parte você mais gostou?'] }) + '\n```'));
    if (/titulos \(8 títulos/.test(text)) return res.json(reply(JSON.stringify({ titulos: ['T1', 'T2', 'T3', 'T4', 'T5'], descricao: 'desc', tags: ['a', 'b'], hashtags: ['#a'], capa_textos: ['UAU'], roteiro: [{ parte: 'Gancho', texto: 'x' }, { parte: 'Promessa', texto: 'y' }, { parte: 'Parte 1', texto: 'z' }, { parte: 'Final', texto: 'w' }], ideias: ['i1', 'i2', 'i3', 'i4', 'i5'] })));
    if (/Gere 8 títulos/.test(text)) return res.json(reply('1. Título um\n2. Título dois\n3. Título três\n4. Título quatro'));
    if (/cortes/.test(text)) return res.json(reply(JSON.stringify({ cortes: Array.from({ length: 5 }, (_, i) => ({ inicio: `00:0${i}`, fim: `00:0${i + 2}`, titulo: `Corte ${i + 1}`, gancho: 'Olha isso', motivo: 'prende' })) })));
    return res.json(reply('Descrição otimizada de teste.'));
  });
  const server = app.listen(0);
  await new Promise((r) => server.on('listening', r));
  return { base: `http://127.0.0.1:${server.address().port}/v1beta/`, key: KEY, state, close: () => server.close() };
}
