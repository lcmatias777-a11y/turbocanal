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

export const MIN_GRUPO = 3;      // faixa com menos que isso não vira conclusão
export const MIN_VIEWS_GRUPO = 1000; // e o grupo precisa de volume, não só de contagem
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
const soma = (vs, f) => vs.reduce((t, v) => t + (f ? f(v) : v), 0);

/** Tira o vídeo que mais pesa no grupo e vê se a vantagem continua de pé.
 *  Se cair, a conclusão era de um vídeo só e não do formato. */
function robusta(vencedor, perdedor, campo, fator) {
  if (!vencedor?.amostra?.length || !perdedor?.amostra?.length) return false;
  const ordenado = [...vencedor.amostra].sort((a, b) => b[campo] - a[campo]);
  const semOMaior = ordenado.slice(1);
  if (semOMaior.length < MIN_GRUPO) return false;
  return mediana(semOMaior.map((v) => v[campo])) >= mediana(perdedor.amostra.map((v) => v[campo])) * fator;
}
const br = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

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
  // Conversão abaixo do esperado: não é "público fora do nicho". A pergunta certa é
  // quantos inscritos seria razoável esperar naquela quantidade de views, pela
  // própria taxa do canal. Zero em 100 views não diz nada; zero em 10 mil, sim.
  const esperados = (views) => (medianaPorMil * views) / 1000;
  const soView = [...comparaveis]
    .filter((v) => v.inscritosPorMil < medianaPorMil && esperados(v.views) >= 3)
    .map((v) => ({ ...v, esperados: Math.round(esperados(v.views) * 10) / 10 }))
    .sort((a, b) => (b.esperados - b.inscritosLiquidos) - (a.esperados - a.inscritosLiquidos)).slice(0, 5);

  // --- 2) Que formato prende ---
  const faixas = FAIXAS.map((f, id) => {
    const vs = comparaveis.filter((v) => v.faixa === id);
    return {
      id, nome: f.nome, videos: vs.length, amostra: vs, viewsTotais: soma(vs, (v) => v.views),
      retencaoMediana: r1(mediana(vs.map((v) => v.percentualMedio))),
      segundosMediana: Math.round(mediana(vs.map((v) => v.duracaoMediaSeg))),
      viewsMediana: Math.round(mediana(vs.map((v) => v.views))),
      inscritosPorMilMediana: r1(mediana(vs.map((v) => v.inscritosPorMil))),
      suficiente: vs.length >= MIN_GRUPO && soma(vs, (v) => v.views) >= MIN_VIEWS_GRUPO
    };
  });
  // Short roda em loop (a mesma pessoa assiste varias vezes), entao a retencao dele
  // passa de 100% e NAO da para comparar com video longo na mesma regua.
  const comAmostra = faixas.filter((f) => f.suficiente);
  const longas = comAmostra.filter((f) => f.id > 0);
  const melhorFaixa = [...longas].sort((a, b) => b.retencaoMediana - a.retencaoMediana)[0] || null;
  const piorFaixa = longas.length > 1 ? [...longas].sort((a, b) => a.retencaoMediana - b.retencaoMediana)[0] : null;
  const faixaShorts = comAmostra.find((f) => f.id === 0) || null;
  const temAcimaDeCem = comparaveis.some((v) => v.percentualMedio > 100);

  const retencaoGeral = r1(mediana(comparaveis.map((v) => v.percentualMedio)));
  const prendemMais = [...comparaveis].sort((a, b) => b.percentualMedio - a.percentualMedio).slice(0, 5);
  const prendemMenos = [...comparaveis].sort((a, b) => a.percentualMedio - b.percentualMedio).slice(0, 5);

  const conclusoes = [];
  if (campeoes.length) {
    const c = campeoes[0];
    const firme = c.views >= 300;
    conclusoes.push(firme
      ? `“${c.titulo}” é o que mais converte: ${br(c.inscritosPorMil)} inscritos por mil views, contra ${br(medianaPorMil)} na mediana do canal. Vale olhar o que esse vídeo faz de diferente.`
      : `“${c.titulo}” aparece como o que mais converte (${br(c.inscritosPorMil)} inscritos por mil views, contra ${br(medianaPorMil)} na mediana). Mas ele tem só ${br(c.views)} views: nessa escala, um inscrito a mais ou a menos muda bastante a taxa. Trate como pista.`);
  }
  // Comparar a melhor faixa com a PIOR exagera a diferença (a pior pode ter tido
  // um azar). A referência passa a ser a mediana de todos os vídeos normais.
  const normais = comparaveis.filter((v) => v.faixa > 0);
  const retencaoNormais = r1(mediana(normais.map((v) => v.percentualMedio)));
  const refNormais = { amostra: normais };
  let formatoRobusto = null;
  if (melhorFaixa && normais.length >= MIN_GRUPO * 2 && melhorFaixa.retencaoMediana > retencaoNormais) {
    formatoRobusto = robusta(melhorFaixa, refNormais, 'percentualMedio', 1.3);
    conclusoes.push(formatoRobusto
      ? `Entre os vídeos normais, os de ${melhorFaixa.nome} seguram ${br(melhorFaixa.retencaoMediana)}% do público, contra ${br(retencaoNormais)}% na mediana de todos os seus vídeos normais (${melhorFaixa.videos} de ${normais.length}). A vantagem continua de pé mesmo tirando o vídeo que mais puxa.`
      : `Os seus vídeos de ${melhorFaixa.nome} aparecem com ${br(melhorFaixa.retencaoMediana)}% contra ${br(retencaoNormais)}% na mediana dos normais, mas a diferença não é grande o bastante ou some quando tiro o vídeo que mais puxa. É uma faixa para TESTAR, não uma duração ideal.`);
  }
  if (faixaShorts) {
    conclusoes.push(`Seus Shorts têm ${br(faixaShorts.retencaoMediana)}% de retenção mediana em ${faixaShorts.videos} vídeos. Short roda em loop, então esse número passa de 100% quando a mesma pessoa assiste mais de uma vez: compare Short com Short, nunca com vídeo longo.`);
  }
  if (soView.length && soView[0].views >= MIN_VIEWS_GRUPO) {
    const v = soView[0];
    conclusoes.push(`“${v.titulo}” converteu menos inscrito do que o seu canal costuma converter: ${br(v.views)} views renderiam cerca de ${br(v.esperados)} inscrito(s) pela taxa mediana do canal, e vieram ${v.inscritosLiquidos}. Vale investigar a conversão desse vídeo. Isso NÃO quer dizer que o público é de fora do nicho: pode ser um vídeo que resolve a dúvida e a pessoa segue a vida.`);
  }

  const avisos = [
    'Tudo aqui vem do YouTube Analytics do seu próprio canal, no período escolhido.',
    'CTR e impressões não aparecem porque a API de Analytics do YouTube não entrega esses dois para canais comuns — só o Studio mostra. Preferi deixar faltando a inventar um número.',
    'Retenção média não diz em que segundo a pessoa saiu, só quanto do vídeo ela viu em média.'
  ];
  avisos.push(`Um grupo só vira conclusão com ${MIN_GRUPO} vídeos E pelo menos ${MIN_VIEWS_GRUPO.toLocaleString('pt-BR')} views somadas: três vídeos de 100 views não medem taxa de conversão do mesmo jeito que três de 100 mil.`);
  avisos.push('Nada aqui prova causa. O vídeo pode ter ido bem pelo assunto, pela capa, por ter sido compartilhado ou por sorte do algoritmo. São pistas do seu próprio canal, não leis.');
  if (temAcimaDeCem) avisos.push('Alguns vídeos aparecem com retenção acima de 100%. Não é erro: Shorts e vídeos curtos repetem sozinhos, então a mesma pessoa assiste mais de uma vez e a média passa de 100%.');
  if (comparaveis.length < MIN_GRUPO) avisos.push(`Só ${comparaveis.length} vídeo(s) com pelo menos ${opts.minViews ?? MIN_VIEWS} views no período: ainda é pouco para comparar.`);
  if (todos.length > comparaveis.length) avisos.push(`${todos.length - comparaveis.length} vídeo(s) com menos de ${opts.minViews ?? MIN_VIEWS} views ficaram de fora da comparação.`);

  return {
    base: { analisados: comparaveis.length, total: todos.length, medianaInscritosPorMil: medianaPorMil, retencaoMediana: retencaoGeral, minGrupo: MIN_GRUPO },
    campeoes, soView, prendemMais, prendemMenos, retencaoNormais,
    faixas: faixas.map(({ amostra, ...f }) => f), melhorFaixa, piorFaixa, faixaShorts, temAcimaDeCem, formatoRobusto, conclusoes, avisos
  };
}

/** Um vídeo só, comparado com a mediana do próprio canal. É o que a extensão
 *  mostra quando o vídeo aberto no YouTube é do canal da pessoa. */
export function compararUm(videoId, analise, videos) {
  const v = (videos || []).find((x) => String(x.id) === String(videoId));
  if (!v) return null;
  const views = Math.max(0, +v.views || 0);
  const ganhos = Math.max(0, +v.inscritosGanhos || 0) - Math.max(0, +v.inscritosPerdidos || 0);
  const porMil = views >= 1 ? Math.round((ganhos / views) * 1000 * 10) / 10 : 0;
  const ret = Math.max(0, +v.percentualMedio || 0);
  const cmp = (valor, base) => (base > 0 ? Math.round(((valor - base) / base) * 100) : null);
  return {
    id: v.id, titulo: v.titulo || '', views,
    retencao: Math.round(ret * 10) / 10,
    retencaoVsCanal: cmp(ret, analise.base.retencaoMediana),
    inscritos: ganhos, inscritosPorMil: porMil,
    inscritosVsCanal: cmp(porMil, analise.base.medianaInscritosPorMil),
    medianaCanal: { retencao: analise.base.retencaoMediana, inscritosPorMil: analise.base.medianaInscritosPorMil, videos: analise.base.analisados },
    aviso: ret > 100 ? 'Acima de 100% porque vídeo curto repete sozinho: a mesma pessoa assiste mais de uma vez.' : ''
  };
}

export function xrayRoutes(app, db, auth) {
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
  // Um vídeo do meu canal, comparado com a mediana do canal (usado pela extensão)
  app.get('/api/channel/raiox/:videoId', auth.required, wrap(async (req, res) => {
    const { myVideoXray } = await import('./channel.js');
    const dados = await myVideoXray(db, req.user, 365);
    const analise = analisarVideos(dados.videos);
    const um = compararUm(req.params.videoId, analise, dados.videos);
    if (!um) return res.json({ meu: false, motivo: 'Este vídeo não é do seu canal, ou ainda não tem números no Analytics.' });
    res.json({ meu: true, canal: dados.canal, ...um });
  }));

  app.get('/api/channel/raiox', auth.required, wrap(async (req, res) => {
    const { myVideoXray } = await import('./channel.js');
    const dias = parseInt(req.query.dias, 10) || 90;
    if (dias < 28 || dias > 365) throw new HttpError(400, 'O período precisa ficar entre 28 e 365 dias.');
    const dados = await myVideoXray(db, req.user, dias);
    res.json({ canal: dados.canal, periodo: dados.periodo, ...analisarVideos(dados.videos) });
  }));
}
