// Raio-X dos vídeos: o que os seus próprios números já provam.
//
// Duas perguntas que o criador faz toda semana e que o YouTube responde com
// número, não com achismo:
//   1. Quais vídeos TRAZEM INSCRITO (e não só view)?
//   2. Que formato PRENDE a pessoa (retenção por faixa de duração)?
//
// Tudo sai da YouTube Analytics API do canal do próprio usuário. O que a API
// não entrega (CTR e impressões) não aparece aqui nem como estimativa.

import { HttpError } from './util.js';

export const MIN_GRUPO = 3;   // faixa com menos que isso não vira conclusão
export const MIN_VIEWS = 50;  // vídeo com menos views não entra na comparação

export const FAIXAS = [
  { id: 0, nome: 'até 1 min (Shorts)', max: 60 },
  { id: 1, nome: '1 a 5 min', max: 300 },
  { id: 2, nome: '5 a 10 min', max: 600 },
  { id: 3, nome: '10 a 20 min', max: 1200 },
  { id: 4, nome: 'mais de 20 min', max: Infinity }
];

export const faixaDe = (seg) => FAIXAS.findIndex((f) => (+seg || 0) <= f.max);

export function mediana(ns) {
  const a = (ns || []).filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const r1 = (n) => Math.round(n * 10) / 10;

/** Recebe a lista de vídeos com os números do Analytics e devolve a análise. */
export function analisarVideos(videos, opts = {}) {
  const todos = (videos || []).map((v) => {
    const views = Math.max(0, +v.views || 0);
    const ganhos = Math.max(0, +v.inscritosGanhos || 0);
    const perdidos = Math.max(0, +v.inscritosPerdidos || 0);
    return {
      id: String(v.id || ''),
      titulo: String(v.titulo || v.id || '').slice(0, 120),
      publicado: v.publicado || null,
      views,
      duracaoSeg: Math.max(0, Math.round(+v.duracaoSeg || 0)),
      duracaoMediaSeg: Math.max(0, Math.round(+v.duracaoMediaSeg || 0)),
      percentualMedio: Math.max(0, +v.percentualMedio || 0),
      inscritosGanhos: ganhos,
      inscritosPerdidos: perdidos,
      inscritosLiquidos: ganhos - perdidos,
      // quantos inscritos cada 1.000 views desse vídeo trouxeram
      inscritosPorMil: views >= 1 ? r1(((ganhos - perdidos) / views) * 1000) : 0,
      likes: Math.max(0, +v.likes || 0),
      comentarios: Math.max(0, +v.comentarios || 0),
      faixa: faixaDe(v.duracaoSeg)
    };
  });
  const comparaveis = todos.filter((v) => v.views >= (opts.minViews ?? MIN_VIEWS));

  // --- 1) Quais vídeos trazem inscrito ---
  const porInscrito = [...comparaveis].sort((a, b) => b.inscritosPorMil - a.inscritosPorMil || b.inscritosLiquidos - a.inscritosLiquidos);
  const medianaPorMil = mediana(comparaveis.map((v) => v.inscritosPorMil));
  const campeoes = porInscrito.filter((v) => v.inscritosPorMil > medianaPorMil && v.inscritosLiquidos > 0).slice(0, 5);
  const soView = [...comparaveis]
    .filter((v) => v.views >= Math.max(1, mediana(comparaveis.map((x) => x.views))) && v.inscritosPorMil <= medianaPorMil)
    .sort((a, b) => b.views - a.views).slice(0, 5);

  // --- 2) Que formato prende ---
  const faixas = FAIXAS.map((f, id) => {
    const vs = comparaveis.filter((v) => v.faixa === id);
    return {
      id, nome: f.nome, videos: vs.length,
      retencaoMediana: r1(mediana(vs.map((v) => v.percentualMedio))),
      segundosMediana: Math.round(mediana(vs.map((v) => v.duracaoMediaSeg))),
      viewsMediana: Math.round(mediana(vs.map((v) => v.views))),
      inscritosPorMilMediana: r1(mediana(vs.map((v) => v.inscritosPorMil))),
      suficiente: vs.length >= MIN_GRUPO
    };
  });
  const comAmostra = faixas.filter((f) => f.suficiente);
  const melhorFaixa = [...comAmostra].sort((a, b) => b.retencaoMediana - a.retencaoMediana)[0] || null;
  const piorFaixa = comAmostra.length > 1 ? [...comAmostra].sort((a, b) => a.retencaoMediana - b.retencaoMediana)[0] : null;

  const retencaoGeral = r1(mediana(comparaveis.map((v) => v.percentualMedio)));
  const prendemMais = [...comparaveis].sort((a, b) => b.percentualMedio - a.percentualMedio).slice(0, 5);
  const prendemMenos = [...comparaveis].sort((a, b) => a.percentualMedio - b.percentualMedio).slice(0, 5);

  const conclusoes = [];
  if (campeoes.length) {
    conclusoes.push(`“${campeoes[0].titulo}” é o que mais converte: ${campeoes[0].inscritosPorMil} inscritos por mil views, contra ${medianaPorMil} na mediana do canal. Vale olhar o que esse vídeo faz de diferente.`);
  }
  if (melhorFaixa && piorFaixa && melhorFaixa.id !== piorFaixa.id) {
    conclusoes.push(`Seus vídeos de ${melhorFaixa.nome} seguram ${melhorFaixa.retencaoMediana}% do público, contra ${piorFaixa.retencaoMediana}% nos de ${piorFaixa.nome} (${melhorFaixa.videos} e ${piorFaixa.videos} vídeos).`);
  }
  if (soView.length && campeoes.length) {
    conclusoes.push(`“${soView[0].titulo}” traz muita view e pouco inscrito (${soView[0].inscritosPorMil} por mil). Esse público chega e não fica: pode ser assunto fora do seu nicho.`);
  }

  const avisos = [
    'Tudo aqui vem do YouTube Analytics do seu próprio canal, no período escolhido.',
    'CTR e impressões não aparecem porque a API de Analytics do YouTube não entrega esses dois para canais comuns — só o Studio mostra. Preferi deixar faltando a inventar um número.',
    'Retenção média não diz em que segundo a pessoa saiu, só quanto do vídeo ela viu em média.'
  ];
  if (comparaveis.length < MIN_GRUPO) avisos.push(`Só ${comparaveis.length} vídeo(s) com pelo menos ${opts.minViews ?? MIN_VIEWS} views no período: ainda é pouco para comparar.`);
  if (todos.length > comparaveis.length) avisos.push(`${todos.length - comparaveis.length} vídeo(s) com menos de ${opts.minViews ?? MIN_VIEWS} views ficaram de fora da comparação.`);

  return {
    base: { analisados: comparaveis.length, total: todos.length, medianaInscritosPorMil: medianaPorMil, retencaoMediana: retencaoGeral, minGrupo: MIN_GRUPO },
    campeoes, soView, prendemMais, prendemMenos, faixas, melhorFaixa, piorFaixa, conclusoes, avisos
  };
}

export function xrayRoutes(app, db, auth) {
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
  app.get('/api/channel/raiox', auth.required, wrap(async (req, res) => {
    const { myVideoXray } = await import('./channel.js');
    const dias = parseInt(req.query.dias, 10) || 90;
    if (dias < 28 || dias > 365) throw new HttpError(400, 'O período precisa ficar entre 28 e 365 dias.');
    const dados = await myVideoXray(db, req.user, dias);
    res.json({ canal: dados.canal, periodo: dados.periodo, ...analisarVideos(dados.videos) });
  }));
}
