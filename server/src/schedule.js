// Melhor dia e horário para publicar.
//
// Tudo aqui é CONTA sobre dado real: pega a data de publicação e as views dos
// vídeos públicos do próprio canal (API do YouTube) e compara as medianas.
// Não existe estimativa inventada, nem "previsão" de views. Quando a amostra é
// pequena demais o resultado diz isso em vez de dar uma recomendação.

import { HttpError } from './util.js';

export const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const FAIXAS = ['00h–03h', '03h–06h', '06h–09h', '09h–12h', '12h–15h', '15h–18h', '18h–21h', '21h–00h'];

export const MIN_AMOSTRA = 3;      // abaixo disso um grupo nem aparece como sinal
export const MIN_RECOMENDA = 5;    // abaixo disso é sinal, não recomendação
export const MIN_TOTAL = 8;        // abaixo disso o canal inteiro é pouca amostra
export const DIAS_MATURACAO = 21;  // vídeo mais novo que isso ainda está somando views

/** Mediana (não média: um vídeo viral não deve decidir o seu horário). */
export function mediana(ns) {
  const a = (ns || []).filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

/** Dia da semana (0=domingo) e hora (0–23) de uma data, no fuso pedido. */
export function partesLocais(quando, tz) {
  const d = quando instanceof Date ? quando : new Date(quando);
  if (Number.isNaN(d.getTime())) return null;
  let f;
  try {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
  } catch {
    throw new HttpError(400, `Fuso horário inválido: ${tz}`);
  }
  const p = {};
  for (const x of f.formatToParts(d)) if (x.type !== 'literal') p[x.type] = x.value;
  const hora = (+p.hour || 0) % 24; // hour12:false pode devolver "24" à meia-noite
  const base = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  if (Number.isNaN(base.getTime())) return null;
  return { dia: base.getUTCDay(), hora };
}

const pct = (v, base) => (base > 0 ? Math.round(((v - base) / base) * 100) : 0);

function grupos(itens, chave, nomes) {
  const mapa = new Map();
  for (const it of itens) {
    const k = chave(it);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(it.views);
  }
  return nomes.map((nome, id) => {
    const vs = mapa.get(id) || [];
    return { id, nome, videos: vs.length, mediana: mediana(vs), suficiente: vs.length >= MIN_AMOSTRA };
  });
}

/** Recebe a lista de vídeos ({ titulo, views, publicado }) e devolve a análise.
 *  Função pura — os testes a usam direto, sem API. */
export function analisarHorarios(videos, opts = {}) {
  const tz = String(opts.tz || 'America/Sao_Paulo');
  const agora = opts.agora ? new Date(opts.agora) : new Date();
  if (Number.isNaN(agora.getTime())) throw new HttpError(400, 'Data de referência inválida.');
  const maturacao = Number.isFinite(opts.maturacao) ? Math.max(0, Math.trunc(opts.maturacao)) : DIAS_MATURACAO;
  const corte = agora.getTime() - maturacao * 86400e3;

  const usados = [];
  let novos = 0, semData = 0;
  for (const v of videos || []) {
    const t = new Date(v.publicado || v.publishedAt || 0).getTime();
    if (!Number.isFinite(t) || !t) { semData++; continue; }
    const pl = partesLocais(new Date(t), tz);
    if (!pl) { semData++; continue; }
    if (t >= corte) { novos++; continue; }
    usados.push({
      titulo: String(v.titulo || v.title || '').slice(0, 120),
      views: Math.max(0, Math.round(+(v.views ?? v.viewCount) || 0)),
      quando: new Date(t).toISOString(),
      dia: pl.dia,
      hora: pl.hora,
      faixa: Math.floor(pl.hora / 3)
    });
  }
  usados.sort((a, b) => a.quando.localeCompare(b.quando));

  const geral = mediana(usados.map((v) => v.views));
  const dias = grupos(usados, (v) => v.dia, DIAS);
  const faixas = grupos(usados, (v) => v.faixa, FAIXAS);
  for (const g of [...dias, ...faixas]) g.diferenca = g.videos ? pct(g.mediana, geral) : 0;

  const melhor = (gs) => gs.filter((g) => g.suficiente).sort((a, b) => b.mediana - a.mediana || b.videos - a.videos)[0] || null;
  const pior = (gs) => gs.filter((g) => g.suficiente).sort((a, b) => a.mediana - b.mediana || b.videos - a.videos)[0] || null;
  const melhorDia = melhor(dias), melhorFaixa = melhor(faixas);
  const piorDia = pior(dias), piorFaixa = pior(faixas);

  // Combinação dia+faixa: só aparece se aquela célula tiver amostra de verdade
  const celulas = new Map();
  for (const v of usados) {
    const k = `${v.dia}|${v.faixa}`;
    if (!celulas.has(k)) celulas.set(k, { dia: v.dia, faixa: v.faixa, views: [] });
    celulas.get(k).views.push(v.views);
  }
  const combinacao = [...celulas.values()]
    .filter((c) => c.views.length >= MIN_AMOSTRA)
    .map((c) => {
      const semOMaior = [...c.views].sort((x, y) => y - x).slice(1);
      return {
        dia: c.dia, faixa: c.faixa, nome: `${DIAS[c.dia]}, ${FAIXAS[c.faixa]}`,
        videos: c.views.length, mediana: mediana(c.views), diferenca: pct(mediana(c.views), geral),
        // a vantagem continua de pé sem o vídeo que mais puxa?
        robusta: semOMaior.length >= MIN_AMOSTRA - 1 && pct(mediana(semOMaior), geral) >= 25,
        firme: c.views.length >= MIN_RECOMENDA
      };
    })
    .sort((a, b) => b.mediana - a.mediana || b.videos - a.videos)[0] || null;
  const combinacoesTestadas = celulas.size;

  const avisos = [
    'A API do YouTube informa a hora em que o vídeo foi publicado, não a hora em que as pessoas assistiram. O que está medido aqui é a relação entre o horário de publicação e as views que o vídeo acumulou.',
    'Atenção a uma armadilha: eu comparo muitas combinações de dia e horário e mostro a melhor. Quanto mais combinações, maior a chance de uma parecer ótima por puro acaso. Por isso só chamo de recomendação a partir de ' + MIN_RECOMENDA + ' vídeos na mesma combinação, e mesmo assim testo se a vantagem sobrevive sem o vídeo que mais puxa.',
    'Views dependem muito mais do assunto, do título e da capa do que do horário. Trate isto como um empurrãozinho, não como regra.'
  ];
  if (novos) avisos.push(`${novos} vídeo(s) publicado(s) nos últimos ${maturacao} dias ficaram de fora: ainda estão somando views e não dá para comparar com os antigos.`);
  if (semData) avisos.push(`${semData} vídeo(s) sem data de publicação válida foram ignorados.`);
  if (usados.length < MIN_TOTAL) avisos.push(`Com ${usados.length} vídeo(s) maduro(s) isto ainda é fraco. O número começa a ficar confiável com uns 20.`);
  const faixasUsadas = faixas.filter((f) => f.videos).length;
  if (usados.length >= MIN_AMOSTRA && faixasUsadas < 2) avisos.push('Todos os seus vídeos saíram na mesma faixa de horário, então não há horários diferentes para comparar.');

  let recomendacao = null;
  if (combinacao) {
    const base = `os vídeos publicados ${combinacao.nome.toLowerCase()} têm mediana de ${combinacao.mediana.toLocaleString('pt-BR')} views (${combinacao.diferenca >= 0 ? '+' : ''}${combinacao.diferenca}% sobre a mediana geral), em ${combinacao.videos} vídeo(s)`;
    recomendacao = combinacao.firme && combinacao.robusta
      ? `No seu canal, ${base}. A vantagem continua de pé mesmo tirando o vídeo que mais puxa.`
      : !combinacao.firme
        ? `Sinal, ainda inconclusivo: ${base}. Com menos de ${MIN_RECOMENDA} vídeos nessa combinação eu não chamo isso de recomendação.`
        : `Sinal, ainda inconclusivo: ${base}, mas a vantagem SOME quando tiro o vídeo que mais puxa a média.`;
  } else if (melhorDia && melhorFaixa) {
    recomendacao = `Separado, o melhor dia é ${melhorDia.nome} (mediana ${melhorDia.mediana.toLocaleString('pt-BR')} views, ${melhorDia.videos} vídeos) e a melhor faixa é ${melhorFaixa.nome} (mediana ${melhorFaixa.mediana.toLocaleString('pt-BR')} views, ${melhorFaixa.videos} vídeos). Nenhuma combinação dia+horário tem ${MIN_AMOSTRA} vídeos ainda, então não dá para cruzar os dois.`;
  } else if (melhorDia || melhorFaixa) {
    const g = melhorDia || melhorFaixa;
    recomendacao = `Só um lado tem amostra: ${g.nome}, mediana ${g.mediana.toLocaleString('pt-BR')} views em ${g.videos} vídeos.`;
  }

  return {
    fuso: tz,
    base: {
      considerados: usados.length,
      ignoradosNovos: novos,
      ignoradosSemData: semData,
      diasMaturacao: maturacao,
      medianaGeral: geral,
      minAmostra: MIN_AMOSTRA,
      minRecomenda: MIN_RECOMENDA,
      combinacoesTestadas,
      primeiro: usados[0]?.quando || null,
      ultimo: usados[usados.length - 1]?.quando || null
    },
    dias,
    faixas,
    melhorDia,
    melhorFaixa,
    piorDia: piorDia && melhorDia && piorDia.id !== melhorDia.id ? piorDia : null,
    piorFaixa: piorFaixa && melhorFaixa && piorFaixa.id !== melhorFaixa.id ? piorFaixa : null,
    combinacao,
    recomendacao,
    avisos
  };
}
