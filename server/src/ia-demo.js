// Respostas de DEMONSTRAÇÃO das ferramentas de IA, para o canal de teste.
//
// Por que existe: no canal de teste o vídeo não existe, então não há o que a
// IA assista. Chamar o Gemini ali gastaria dinheiro de verdade para analisar
// um vídeo inventado, e ainda deixava a demonstração refém da chave do Google
// estar válida naquele minuto.
//
// Então aqui não há IA nenhuma. São respostas montadas por regra, a partir do
// título, das tags e dos números do próprio vídeo de teste. Elas são boas o
// suficiente para a pessoa ver COMO a tela fica e o que cada ferramenta
// entrega, e cada uma sai marcada com metodo: 'demonstracao' e um aviso em
// português dizendo, sem rodeio, que aquilo não passou pela IA.
//
// Nada daqui aparece para quem está com um canal de verdade ligado.

import { videosDe, escopoDe, CANAL_TITULO } from './canalteste.js';

export const AVISO =
  'Resposta de demonstração: ela foi montada por regras a partir dos dados deste vídeo de teste e NÃO passou pela IA. ' +
  'Com um canal de verdade ligado, esta mesma tela traz a resposta real do Gemini.';

/** Ferramentas que a demonstração cobre. O resto do site não muda. */
export const FERRAMENTAS = new Set([
  'title_ai', 'description_ai', 'video_insights_ai', 'prep_ai', 'transform_ai',
  'reply_ai', 'ideas_ai', 'coach_ai', 'audit_ai', 'title_lab'
]);

const marca = (o) => ({ ...o, metodo: 'demonstracao', demonstracao: true, modelo: 'demonstração (sem IA)', aviso: AVISO });
const titulo = (v) => (v?.titulo || v?.title || 'seu vídeo');
const assunto = (v) => (v?.assunto || titulo(v).split(' ').slice(-2).join(' '));

async function acharVideo(db, req) {
  const escopo = escopoDe(req.user);
  const lista = await videosDe(db, escopo);
  const pedido = String(req.videoId || req.body?.video || '').trim();
  return lista.find((v) => v.id === pedido) || lista[0];
}

const mmss = (s) => `${String(Math.floor((s || 0) / 60)).padStart(2, '0')}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;

function titulosDe(v) {
  const a = assunto(v);
  return [
    `${a}: o que eu faria diferente hoje`,
    `Testei ${a} do jeito mais difícil`,
    `${a} em ${Math.max(3, Math.round((v.duracaoSeg || 600) / 60))} minutos, sem enrolação`,
    `O erro de ${a} que quase todo mundo comete`,
    `${a}: antes e depois de mudar uma coisa só`,
    `Por que ${a} ficou mais difícil este ano`,
    `${a} para quem está começando agora`,
    `Passei uma semana só em ${a}`
  ];
}

function descricaoDe(v) {
  const a = assunto(v);
  return `${titulo(v)}\n\n` +
    `Neste vídeo eu mostro ${a.toLowerCase()} do começo ao fim, explicando cada decisão e o que eu faria diferente.\n\n` +
    `00:00 Começo\n${mmss(Math.round((v.duracaoSeg || 600) * 0.2))} A preparação\n` +
    `${mmss(Math.round((v.duracaoSeg || 600) * 0.5))} A parte difícil\n` +
    `${mmss(Math.round((v.duracaoSeg || 600) * 0.8))} Resultado\n\n` +
    `Se ajudou, deixa o like e se inscreve. Toda semana tem vídeo novo sobre ${a}.\n\n` +
    `#${a.replace(/\s+/g, '')} #gameplay #dicas`;
}

function tagsDe(v) {
  const a = assunto(v).toLowerCase();
  return [a, `${a} dicas`, `${a} guia`, `${a} gameplay`, `${a} para iniciantes`,
    `como jogar ${a}`, `${a} 2026`, 'gameplay br', 'dicas de jogo', CANAL_TITULO.toLowerCase()];
}

function capitulosDe(v) {
  const d = v.duracaoSeg || 600;
  return [
    { tempo: '00:00', titulo: 'Abertura' },
    { tempo: mmss(Math.round(d * 0.2)), titulo: 'Preparação' },
    { tempo: mmss(Math.round(d * 0.5)), titulo: 'A parte difícil' },
    { tempo: mmss(Math.round(d * 0.8)), titulo: 'Resultado' }
  ];
}

/** Cada ferramenta devolve no MESMO formato que a versão com IA devolveria,
 *  senão a tela quebraria justamente na demonstração. */
export const RESPOSTAS = {
  async title_ai(db, req) {
    const tema = String(req.body?.topic || '').trim();
    const v = await acharVideo(db, req);
    const base = tema ? { ...v, assunto: tema } : v;
    return marca({ titles: titulosDe(base) });
  },

  async description_ai(db, req) {
    const tema = String(req.body?.topic || '').trim();
    const v = await acharVideo(db, req);
    return marca({ description: descricaoDe(tema ? { ...v, assunto: tema } : v) });
  },

  async title_lab(db, req) {
    const { titleChecks } = await import('./ai.js');
    const t = String(req.body?.title || req.body?.titulo || '').trim() || titulo(await acharVideo(db, req));
    const medido = titleChecks(t, String(req.body?.keyword || req.body?.palavra || ''));
    const faltam = medido.checks.filter((c) => !c.ok).map((c) => c.item);
    const v = await acharVideo(db, req);
    return marca({
      original: t.slice(0, 200),
      nota: medido.nota,
      checagem: medido.checks,
      diagnostico: faltam.length
        ? `O título cumpre ${medido.checks.length - faltam.length} de ${medido.checks.length} critérios medidos. Falta: ${faltam.join(', ')}.`
        : 'O título cumpre todos os critérios medidos aqui.',
      alternativas: titulosDe(v).slice(0, 5).map((x) => ({
        titulo: x.slice(0, 100),
        porque: 'Traz o assunto no começo e uma promessa clara, que é o que os critérios medidos pedem.'
      }))
    });
  },

  async reply_ai(db, req) {
    const c = String(req.body?.comment || '').trim().slice(0, 200);
    return marca({ respostas: [
      `Valeu demais pelo comentário! Anotei aqui${c ? ` o que você falou sobre "${c.slice(0, 60)}"` : ''} para o próximo vídeo.`,
      'Obrigado por assistir! Se quiser que eu entre mais fundo nessa parte, me diz que eu faço um vídeo só sobre isso.',
      'Boa! É justamente esse tipo de comentário que me ajuda a escolher o próximo tema. Abraço!'
    ] });
  },

  async ideas_ai(db, req) {
    const lista = await videosDe(db, escopoDe(req.user));
    const top = [...lista].sort((a, b) => b.views - a.views).slice(0, 10);
    return marca({
      base: top.length,
      ideias: top.map((v) => ({
        titulo: `${assunto(v)}: a continuação que ficou faltando`,
        porque: `"${titulo(v).slice(0, 60)}" é um dos vídeos mais vistos do canal (${v.views.toLocaleString('pt-BR')} views). Assunto que já funcionou costuma repetir.`,
        formato: v.duracaoSeg < 60 ? 'Short' : 'vídeo normal'
      }))
    });
  },

  async audit_ai(db, req) {
    const lista = await videosDe(db, escopoDe(req.user));
    const views = lista.map((v) => v.views).sort((a, b) => a - b);
    const med = views[Math.floor(views.length / 2)] || 0;
    const curtos = lista.filter((v) => v.duracaoSeg < 60).length;
    const semTag = lista.filter((v) => (v.tags || []).length < 5).length;
    return marca({
      nota: 68,
      resumo: `O canal tem ${lista.length} vídeos e mediana de ${med.toLocaleString('pt-BR')} views. A audiência existe e é constante; o que mais atrapalha é a falta de padrão em descrição e tags.`,
      funciona: [
        'Frequência de publicação constante ao longo dos anos.',
        'Os vídeos de desafio ("24 horas") puxam bem acima da mediana.',
        `Mistura de ${curtos} Shorts com vídeos longos, o que alimenta os dois tipos de recomendação.`
      ],
      melhorias: [
        `${semTag} vídeos têm menos de 5 tags. Padronizar isso é o ajuste mais barato do canal.`,
        'Descrições curtas demais na maioria: faltam capítulos e as palavras do assunto.',
        'Os títulos repetem muito a mesma forma; vale testar outras.',
        'As capas não têm padrão visual que identifique o canal de longe.',
        'Vídeos acima de 20 minutos seguram bem menos: vale cortar ou dividir.'
      ],
      proximos: [
        'Escolher o vídeo mais visto e fazer a continuação dele.',
        'Padronizar descrição e tags nos 10 vídeos mais vistos.',
        'Testar uma capa com o mesmo padrão nos próximos 3 vídeos.'
      ],
      base: { videos: lista.length, medianaViews: med }
    });
  },

  async video_insights_ai(db, req) {
    const v = await acharVideo(db, req);
    return marca({
      sugestoes: {
        resumo: `Vídeo sobre ${assunto(v).toLowerCase()}, com ${mmss(v.duracaoSeg)} de duração e ${(v.views || 0).toLocaleString('pt-BR')} visualizações. O começo entra direto no assunto, o meio é a parte mais densa e o fim mostra o resultado.`,
        titulos: titulosDe(v).slice(0, 5),
        descricao: descricaoDe(v),
        tags: tagsDe(v),
        hashtags: [`#${assunto(v).replace(/\s+/g, '')}`, '#gameplay', '#dicas'],
        capitulos: capitulosDe(v),
        capa_textos: ['DEU CERTO?', 'O ERRO DE TODOS', `${Math.max(3, Math.round((v.duracaoSeg || 600) / 60))} MIN`, 'ANTES x DEPOIS'],
        melhorias: [
          'Colocar a promessa do vídeo nos primeiros 5 segundos.',
          'Cortar a preparação pela metade: é onde a retenção costuma cair.',
          'Fechar com uma pergunta clara para puxar comentário.'
        ]
      },
      assistiu: false,
      quadros: 0,
      video: { id: v.id, title: v.titulo, description: v.descricao, tags: v.tags, privacy: v.privacidade, durationSec: v.duracaoSeg, channel: CANAL_TITULO },
      videoId: v.id,
      own: true
    });
  },

  async coach_ai(db, req) {
    const v = await acharVideo(db, req);
    const lista = await videosDe(db, escopoDe(req.user));
    const med = [...lista].map((x) => x.views).sort((a, b) => a - b)[Math.floor(lista.length / 2)] || 1;
    const acima = Math.round(((v.views || 0) / med - 1) * 100);
    return marca({
      assistiu: false,
      resumo: `"${titulo(v)}" tem ${(v.views || 0).toLocaleString('pt-BR')} views, ${acima >= 0 ? acima + '% acima' : Math.abs(acima) + '% abaixo'} da mediana do canal.`,
      gancho: 'O título promete um resultado e o vídeo entrega no fim, o que segura quem chega pelo assunto.',
      desempenho: acima >= 0
        ? 'Foi melhor que o vídeo típico do canal. Vale repetir o formato.'
        : 'Ficou abaixo do vídeo típico do canal. O assunto pode estar saturado ou a capa não está chamando.',
      ideias: titulosDe(v).slice(0, 3),
      dicas: [
        'Responder os comentários nas primeiras horas ajuda o alcance.',
        'Fixar um comentário com a pergunta do vídeo aumenta a conversa.',
        'Reaproveitar o melhor trecho como Short traz gente nova para o vídeo longo.'
      ]
    });
  },

  async prep_ai(db, req) {
    const tema = String(req.body?.topic || '').trim();
    const v = await acharVideo(db, req);
    const base = tema ? { ...v, assunto: tema } : v;
    return marca({
      titulos: titulosDe(base).slice(0, 5),
      descricao: descricaoDe(base),
      tags: tagsDe(base),
      roteiro: [
        'Gancho (0-10s): mostre o resultado final antes de explicar.',
        'Contexto (10-45s): por que este vídeo existe.',
        'Desenvolvimento: uma ideia por bloco, sem voltar atrás.',
        'Virada: o momento em que quase dá errado.',
        'Fecho: o que você faria diferente + chamada para o próximo vídeo.'
      ]
    });
  },

  async transform_ai(db, req) {
    const v = await acharVideo(db, req);
    const d = v.duracaoSeg || 600;
    return marca({
      cortes: [0.15, 0.45, 0.75].map((f, i) => ({
        inicio: mmss(Math.round(d * f)),
        fim: mmss(Math.round(d * f) + 45),
        titulo: ['O começo que prende', 'A parte que todo mundo erra', 'O resultado'][i],
        porque: 'Trecho com virada clara, que funciona sozinho fora do vídeo.'
      })),
      post: `Novo vídeo no ar: ${titulo(v)}. Conta aqui o que você teria feito diferente.`,
      artigo: `${titulo(v)}\n\n${descricaoDe(v)}`,
      thread: [
        `Fiz ${assunto(v).toLowerCase()} e documentei tudo. Segue o que aprendi:`,
        '1) O erro mais comum aparece logo no começo.',
        '2) O meio é onde dá para economizar metade do tempo.',
        '3) O resultado depende mais da preparação do que da execução.'
      ]
    });
  }
};
