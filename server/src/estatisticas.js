// Resultados dos criadores: três registros separados, medidos sobre dados reais
// do YouTube, com as regras versionadas.
//
// O que este arquivo NÃO faz, de propósito:
//   - não pergunta a meta ao usuário (a meta sai dos números do canal);
//   - não inventa o número de inscritos de antes da primeira medição;
//   - não atribui crescimento ao TurboCanal (registra o que foi observado);
//   - não reclassifica conquista antiga quando a regra muda (cada registro
//     guarda a versão da regra que valia).
//
// As funções de cálculo são puras e ficam no topo, para poderem ser testadas
// sem banco e sem rede.

import { HttpError, uid, now, audit } from './util.js';

/* ========================= REGRAS (versionadas) ========================= */

export const REGRAS_PADRAO = {
  // Metas de inscritos. A meta aplicável é a menor que ainda não foi passada.
  metas: [1000, 10000, 100000, 1000000, 10000000],
  // Limite que separa o Registro 1 do Registro 3 (metade da meta).
  fracaoLimiar: 0.5,
  // Uso real mínimo para o canal entrar nas estatísticas.
  usosMinimos: 3,
  diasDistintosMinimos: 2,
  exigeFerramentaDeCanal: true,
  // Quanto tempo o acompanhamento dura, contado do dia em que o uso mínimo
  // foi cumprido.
  diasAcompanhamento: 90,
  // Abaixo disso nenhuma distribuição é publicada (protege quem é pouca gente).
  minimoParaPublicar: 5,
  // Intervalo mínimo entre duas medições gravadas do mesmo canal.
  horasEntreMedicoes: 20
};

// Ferramentas que contam como uso real. Saiu da lista real de tool_costs do
// projeto; o que está fora (responder comentário, criar playlist, enviar capa)
// é operação de rotina, não análise nem melhoria de conteúdo.
export const FERRAMENTAS_CANAL = new Set([
  'channel_analysis', 'channel_sync', 'audit_ai', 'best_time',
  'video_analysis', 'video_insights_ai', 'coach_ai'
]);
export const FERRAMENTAS_CONTEUDO = new Set([
  'title_lab', 'title_ai', 'description_ai', 'prep_ai', 'ideas_ai', 'transform_ai'
]);
export const FERRAMENTAS_VALIDAS = new Set([...FERRAMENTAS_CANAL, ...FERRAMENTAS_CONTEUDO]);

export const ESTADOS = {
  sem_dados: 'Sem dados suficientes',
  aguardando_uso: 'Ainda não cumpriu o uso mínimo',
  em_acompanhamento: 'Em acompanhamento',
  concluiu_meta: 'Alcançou uma meta',
  encerrado_sem_meta: 'Período encerrado sem a meta'
};

/* ========================= CÁLCULO PURO ========================= */

const dia = (iso) => String(iso || '').slice(0, 10);
const maisDias = (iso, d) => new Date(new Date(iso).getTime() + d * 86400e3).toISOString();

/** A meta aplicável é a menor meta ainda não alcançada. Acima da maior, não há
 *  meta: devolve null em vez de inventar uma. */
export function metaAplicavel(inscritos, metas = REGRAS_PADRAO.metas) {
  if (!Number.isFinite(inscritos)) return null;
  for (const m of [...metas].sort((a, b) => a - b)) if (inscritos < m) return m;
  return null;
}

export function limiarDe(meta, fracao = REGRAS_PADRAO.fracaoLimiar) {
  return Math.floor(meta * fracao);
}

/** 1 = começou ABAIXO do limite de 50% (potencial de ajuda significativa).
 *  3 = começou no limite ou acima dele, sem ainda ter a meta.
 *  Exatamente 50% conta como grupo 3: 50% não é "abaixo de 50%". */
export function grupoDe(inscritosInicio, meta, fracao = REGRAS_PADRAO.fracaoLimiar) {
  if (!Number.isFinite(inscritosInicio) || !Number.isFinite(meta)) return null;
  return inscritosInicio < limiarDe(meta, fracao) ? 1 : 3;
}

/** Transações de ferramenta viram usos válidos. Um estorno automático cancela
 *  a cobrança mais recente ainda não cancelada daquela mesma ferramenta: é
 *  assim que operação que falhou deixa de contar como uso. */
export function usosValidos(linhas) {
  const ordenadas = [...linhas].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const abertas = new Map(); // tool -> [índices de cobranças ainda válidas]
  const cobrancas = [];
  for (const t of ordenadas) {
    const tool = t.tool;
    if (!tool || !FERRAMENTAS_VALIDAS.has(tool)) continue;
    if (Number(t.delta) < 0 || (Number(t.delta) === 0 && t.ilimitado)) {
      cobrancas.push({ tool, em: t.created_at, dia: dia(t.created_at), valido: true });
      if (!abertas.has(tool)) abertas.set(tool, []);
      abertas.get(tool).push(cobrancas.length - 1);
    } else if (Number(t.delta) > 0) {
      const fila = abertas.get(tool);
      if (fila && fila.length) cobrancas[fila.pop()].valido = false; // estorno
    }
  }
  return cobrancas.filter((c) => c.valido).map(({ tool, em, dia: d }) => ({ tool, em, dia: d }));
}

/** O canal cumpriu o uso mínimo? Devolve também a data em que cumpriu e a
 *  prova (os eventos que justificaram), porque "elegível" sem prova é chute. */
export function avaliarUso(usos, regras = REGRAS_PADRAO) {
  const ordenados = [...usos].sort((a, b) => String(a.em).localeCompare(String(b.em)));
  const vistos = [];
  const dias = new Set();
  let temCanal = false;
  for (const u of ordenados) {
    vistos.push(u);
    dias.add(u.dia);
    if (FERRAMENTAS_CANAL.has(u.tool) || FERRAMENTAS_CONTEUDO.has(u.tool)) temCanal = true;
    const ok =
      vistos.length >= regras.usosMinimos &&
      dias.size >= regras.diasDistintosMinimos &&
      (!regras.exigeFerramentaDeCanal || temCanal);
    if (ok) return { elegivel: true, em: u.em, prova: vistos.slice(-12) };
  }
  return {
    elegivel: false,
    em: null,
    prova: vistos.slice(-12),
    falta: {
      usos: Math.max(0, regras.usosMinimos - vistos.length),
      dias: Math.max(0, regras.diasDistintosMinimos - dias.size),
      ferramentaDeCanal: regras.exigeFerramentaDeCanal && !temCanal
    }
  };
}

/** Medições com número utilizável, em ordem. Medição de canal que esconde a
 *  contagem, ou leitura que falhou, não entram: ficam registradas como
 *  indisponíveis e somem do cálculo em vez de virar zero. */
export function medicoesUteis(medicoes) {
  return [...medicoes]
    .filter((m) => m.inscritos !== null && m.inscritos !== undefined && Number.isFinite(Number(m.inscritos)))
    .map((m) => ({ ...m, inscritos: Number(m.inscritos) }))
    .sort((a, b) => String(a.medido_em).localeCompare(String(b.medido_em)));
}

/** Percorre as medições da janela e devolve as metas cruzadas, cada uma com o
 *  registro (1 ou 3) decidido pelo número de inscritos no INÍCIO do trecho
 *  daquela meta. Metas já conquistadas antes são puladas: conquista antiga
 *  nunca é reclassificada. */
export function percorrerMetas({ medicoes, inscritosInicio, regras = REGRAS_PADRAO, jaConquistadas = [] }) {
  const uteis = medicoesUteis(medicoes);
  if (!uteis.length || !Number.isFinite(inscritosInicio)) return [];
  const feitas = new Set(jaConquistadas.map(Number));
  const novas = [];
  let base = inscritosInicio;
  let meta = metaAplicavel(base, regras.metas);
  let guarda = 0;
  while (meta && guarda++ < regras.metas.length + 2) {
    if (feitas.has(meta)) { base = meta; meta = metaAplicavel(base, regras.metas); continue; }
    const cruzou = uteis.find((m) => m.inscritos >= meta);
    if (!cruzou) break;
    novas.push({
      meta,
      registro: grupoDe(base, meta, regras.fracaoLimiar),
      inscritosInicio: base,
      inscritosConquista: cruzou.inscritos,
      atingidaEm: cruzou.medido_em,
      precisao: cruzou.precisao || 'exata'
    });
    base = cruzou.inscritos;
    meta = metaAplicavel(base, regras.metas);
  }
  return novas;
}

/** Registro 2: crescimento observado na janela. Independente das metas. */
export function crescimentoNaJanela(medicoes, de, ate) {
  const uteis = medicoesUteis(medicoes).filter((m) => {
    const t = String(m.medido_em);
    return (!de || t >= de) && (!ate || t <= ate);
  });
  if (uteis.length < 2) {
    return { suficiente: false, medicoes: uteis.length, motivo: uteis.length ? 'uma medição só não mostra crescimento' : 'sem medição na janela' };
  }
  const pri = uteis[0], ult = uteis.at(-1);
  const diferenca = ult.inscritos - pri.inscritos;
  const percentual = pri.inscritos > 0 ? Math.round((diferenca / pri.inscritos) * 1000) / 10 : null;
  const dias = Math.round((Date.parse(ult.medido_em) - Date.parse(pri.medido_em)) / 86400e3);
  return {
    suficiente: true,
    inicial: pri.inscritos,
    final: ult.inscritos,
    diferenca,
    percentual, // null quando a base é zero: divisão por zero não vira número
    de: pri.medido_em,
    ate: ult.medido_em,
    dias,
    medicoes: uteis.length,
    estimado: uteis.some((m) => m.precisao === 'arredondada')
  };
}

/** Faixas de inscritos, derivadas das próprias metas para não divergirem. */
export function faixas(metas = REGRAS_PADRAO.metas) {
  const ms = [...metas].sort((a, b) => a - b);
  const fmt = (n) => n.toLocaleString('pt-BR');
  const out = [{ id: 'f0', de: 0, ate: ms[0] - 1, rotulo: `Menos de ${fmt(ms[0])}` }];
  for (let i = 0; i < ms.length; i++) {
    const de = ms[i], ate = i + 1 < ms.length ? ms[i + 1] - 1 : null;
    out.push({ id: 'f' + (i + 1), de, ate, rotulo: ate === null ? `${fmt(de)} ou mais` : `${fmt(de)} a ${fmt(ate)}` });
  }
  return out;
}

export function faixaDe(inscritos, metas = REGRAS_PADRAO.metas) {
  if (!Number.isFinite(inscritos)) return null;
  const fs = faixas(metas);
  for (const f of fs) if (inscritos >= f.de && (f.ate === null || inscritos <= f.ate)) return f.id;
  return null;
}

/** Distribuição exclusiva: cada item cai em exatamente uma categoria, o
 *  denominador é só desta distribuição, e a soma fecha em 100%.
 *  Com menos participantes que o mínimo, não publica porcentagem nenhuma. */
export function distribuir(itens, categorias, classificar, { minimo = REGRAS_PADRAO.minimoParaPublicar, populacao = '', unidade = 'canais' } = {}) {
  const contagem = new Map(categorias.map((c) => [c.id, 0]));
  let fora = 0;
  for (const it of itens) {
    const id = classificar(it);
    if (id !== null && id !== undefined && contagem.has(id)) contagem.set(id, contagem.get(id) + 1);
    else fora++;
  }
  const n = itens.length - fora;
  if (n < minimo) {
    return { populacao, unidade, suficiente: false, n, minimo, fora, mensagem: 'Dados insuficientes para apresentar uma distribuição confiável.' };
  }
  // Maior resto: as porcentagens arredondadas somam exatamente 100.
  const brutos = categorias.map((c) => ({ ...c, quantidade: contagem.get(c.id), exato: (contagem.get(c.id) / n) * 100 }));
  const comPiso = brutos.map((b) => ({ ...b, piso: Math.floor(b.exato), resto: b.exato - Math.floor(b.exato) }));
  let sobra = 100 - comPiso.reduce((s, b) => s + b.piso, 0);
  const ordem = [...comPiso].sort((a, b) => b.resto - a.resto || b.quantidade - a.quantidade);
  const extra = new Set();
  for (const b of ordem) { if (sobra-- <= 0) break; extra.add(b.id); }
  const categoriasOut = comPiso.map((b) => ({
    id: b.id, rotulo: b.rotulo, quantidade: b.quantidade,
    percentual: b.piso + (extra.has(b.id) ? 1 : 0)
  }));
  return { populacao, unidade, suficiente: true, n, fora, categorias: categoriasOut };
}

/* ========================= BANCO ========================= */

export async function regrasAtuais(db) {
  const r = await db.get('SELECT versao, regras FROM regras_estat ORDER BY versao DESC LIMIT 1');
  if (!r) return { versao: 1, regras: { ...REGRAS_PADRAO } };
  try { return { versao: r.versao, regras: { ...REGRAS_PADRAO, ...JSON.parse(r.regras) } }; }
  catch { return { versao: r.versao, regras: { ...REGRAS_PADRAO } }; }
}

export async function regrasDaVersao(db, versao) {
  const r = await db.get('SELECT versao, regras FROM regras_estat WHERE versao=?', [versao]);
  if (!r) return { versao: versao || 1, regras: { ...REGRAS_PADRAO } };
  try { return { versao: r.versao, regras: { ...REGRAS_PADRAO, ...JSON.parse(r.regras) } }; }
  catch { return { versao: r.versao, regras: { ...REGRAS_PADRAO } }; }
}

export async function salvarRegras(db, actor, mudancas) {
  const atual = await regrasAtuais(db);
  const novas = { ...atual.regras };
  const num = (v, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `Valor fora do intervalo permitido (${min} a ${max}).`);
    return n;
  };
  if (mudancas.usosMinimos !== undefined) novas.usosMinimos = Math.round(num(mudancas.usosMinimos, 1, 100));
  if (mudancas.diasDistintosMinimos !== undefined) novas.diasDistintosMinimos = Math.round(num(mudancas.diasDistintosMinimos, 1, 60));
  if (mudancas.exigeFerramentaDeCanal !== undefined) novas.exigeFerramentaDeCanal = !!mudancas.exigeFerramentaDeCanal;
  if (mudancas.diasAcompanhamento !== undefined) novas.diasAcompanhamento = Math.round(num(mudancas.diasAcompanhamento, 7, 1095));
  if (mudancas.fracaoLimiar !== undefined) novas.fracaoLimiar = num(mudancas.fracaoLimiar, 0.05, 0.95);
  if (mudancas.minimoParaPublicar !== undefined) novas.minimoParaPublicar = Math.round(num(mudancas.minimoParaPublicar, 1, 1000));
  if (mudancas.horasEntreMedicoes !== undefined) novas.horasEntreMedicoes = Math.round(num(mudancas.horasEntreMedicoes, 1, 720));
  if (mudancas.metas !== undefined) {
    const lista = (Array.isArray(mudancas.metas) ? mudancas.metas : String(mudancas.metas).split(','))
      .map((v) => Math.round(Number(String(v).replace(/\D/g, ''))))
      .filter((n) => Number.isFinite(n) && n > 0);
    const unicas = [...new Set(lista)].sort((a, b) => a - b);
    if (unicas.length < 1 || unicas.length > 12) throw new HttpError(400, 'Informe de 1 a 12 metas de inscritos.');
    novas.metas = unicas;
  }
  if (JSON.stringify(novas) === JSON.stringify(atual.regras)) return { versao: atual.versao, regras: atual.regras, mudou: false };
  const versao = atual.versao + 1;
  await db.run('INSERT INTO regras_estat(versao,regras,autor_id,autor_email,criado_em) VALUES(?,?,?,?,?)',
    [versao, JSON.stringify(novas), actor?.id || null, actor?.email || 'sistema', now()]);
  await audit(db, actor, 'estatisticas.regras', 'versao ' + versao, { anterior: atual.regras, nova: novas });
  return { versao, regras: novas, mudou: true, anterior: atual.regras };
}

/** Grava uma medição de inscritos. Chamada a cada leitura autorizada do canal.
 *  Nunca derruba a ferramenta que a chamou: falha aqui é só log. */
export async function registrarMedicao(db, user, canal, origem = 'canal') {
  try {
    if (!user?.id || !canal?.id) return null;
    const st = canal.statistics || {};
    const oculto = !!st.hiddenSubscriberCount;
    const bruto = oculto ? null : Number(st.subscriberCount);
    const inscritos = Number.isFinite(bruto) ? bruto : null;
    // Acima de 1.000 o YouTube arredonda a contagem pública. Fica marcado como
    // arredondada para o número nunca ser apresentado como exato.
    const precisao = inscritos === null ? 'indisponivel' : inscritos >= 1000 ? 'arredondada' : 'exata';
    const quando = now();
    const { regras } = await regrasAtuais(db);
    const ultima = await db.get('SELECT medido_em FROM medicoes_canal WHERE canal_id=? ORDER BY medido_em DESC LIMIT 1', [canal.id]);
    if (ultima && Date.now() - Date.parse(ultima.medido_em) < regras.horasEntreMedicoes * 3600e3) return null;
    const fonte = process.env.YT_MOCK === '1' ? 'mock' : origem;
    await db.run(
      `INSERT INTO medicoes_canal(id,user_id,canal_id,inscritos,oculto,precisao,origem,dia,medido_em)
       VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(canal_id,dia) DO NOTHING`,
      [uid(), user.id, canal.id, inscritos, oculto ? 1 : 0, precisao, fonte, dia(quando), quando]
    );
    await recalcular(db, user.id).catch(() => {});
    return { inscritos, precisao };
  } catch (e) {
    console.error('[estatisticas] medição não gravada:', e.message);
    return null;
  }
}

/** Recalcula o acompanhamento de um usuário a partir das medições e do uso.
 *  É idempotente: rodar duas vezes não cria conquista nem medição repetida. */
export async function recalcular(db, userId) {
  const u = await db.get('SELECT id, role FROM users WHERE id=?', [userId]);
  if (!u) return null;
  // Conta administrativa não entra nas estatísticas de criadores.
  if (u.role !== 'user') return null;
  const tok = await db.get('SELECT channel_id FROM yt_tokens WHERE user_id=?', [userId]);
  const canalId = tok?.channel_id;
  if (!canalId) return null;

  let acomp = await db.get('SELECT * FROM acompanhamentos WHERE user_id=? AND canal_id=?', [userId, canalId]);
  const atuais = await regrasAtuais(db);
  // Acompanhamento já existente roda com a versão de regra em que nasceu:
  // mudar a regra não reclassifica quem já está no meio do caminho.
  const { versao, regras } = acomp ? await regrasDaVersao(db, acomp.regras_versao) : atuais;

  const medicoes = (await db.all(
    `SELECT inscritos, precisao, origem, medido_em FROM medicoes_canal
      WHERE canal_id=? AND origem NOT IN ('mock','descartada') ORDER BY medido_em`,
    [canalId]
  ));
  const uteis = medicoesUteis(medicoes);

  const gravar = async (campos) => {
    const quando = now();
    if (acomp) {
      const sets = Object.keys(campos).map((k) => `${k}=?`).join(',');
      await db.run(`UPDATE acompanhamentos SET ${sets}, atualizado_em=? WHERE id=?`, [...Object.values(campos), quando, acomp.id]);
      acomp = await db.get('SELECT * FROM acompanhamentos WHERE id=?', [acomp.id]);
    } else {
      const id = uid();
      const cols = ['id', 'user_id', 'canal_id', 'regras_versao', 'criado_em', 'atualizado_em', ...Object.keys(campos)];
      const vals = [id, userId, canalId, versao, quando, quando, ...Object.values(campos)];
      await db.run(`INSERT INTO acompanhamentos(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})
                    ON CONFLICT(user_id,canal_id) DO NOTHING`, vals);
      acomp = await db.get('SELECT * FROM acompanhamentos WHERE user_id=? AND canal_id=?', [userId, canalId]);
    }
    return acomp;
  };

  if (!uteis.length) {
    await gravar({ estado: 'sem_dados' });
    return acomp;
  }

  const primeira = uteis[0];
  const uso = avaliarUso(usosValidos(await db.all(
    'SELECT delta, tool, created_at FROM transactions WHERE user_id=? AND tool IS NOT NULL ORDER BY created_at', [userId]
  )), regras);

  // meta_alvo/limiar/grupo descrevem o ponto de partida do acompanhamento, que
  // é o que decide Registro 1 x Registro 3. Enquanto o uso mínimo não é
  // cumprido, valem como prévia, calculados sobre a primeira medição.
  const descreverPartida = (partida) => {
    const meta = metaAplicavel(partida, regras.metas);
    return {
      meta_alvo: meta,
      limiar: meta ? limiarDe(meta, regras.fracaoLimiar) : null,
      grupo: meta ? grupoDe(partida, meta, regras.fracaoLimiar) : null
    };
  };
  const baseCampos = {
    inicio: primeira.medido_em,
    inscritos_inicial: primeira.inscritos,
    ...descreverPartida(primeira.inscritos)
  };

  if (!uso.elegivel) {
    await gravar({ ...baseCampos, elegivel_em: null, elegivel_prova: JSON.stringify(uso.prova || []), fim: null, estado: 'aguardando_uso' });
    return acomp;
  }

  const fim = maisDias(uso.em, regras.diasAcompanhamento);
  // A janela do acompanhamento começa quando o uso real começou: crescimento
  // de antes de usar a ferramenta não entra como "durante o acompanhamento".
  const naJanela = uteis.filter((m) => m.medido_em >= uso.em && m.medido_em <= fim);
  const inicioJanela = naJanela[0] || null;

  await gravar({
    ...baseCampos,
    ...(inicioJanela ? descreverPartida(inicioJanela.inscritos) : {}),
    elegivel_em: uso.em,
    elegivel_prova: JSON.stringify(uso.prova || []),
    fim,
    estado: acomp?.estado === 'concluiu_meta' ? 'concluiu_meta' : 'em_acompanhamento'
  });

  if (inicioJanela) {
    const jaFeitas = (await db.all('SELECT meta FROM conquistas WHERE canal_id=?', [canalId])).map((r) => Number(r.meta));
    const novas = percorrerMetas({
      medicoes: naJanela,
      inscritosInicio: inicioJanela.inscritos,
      regras,
      jaConquistadas: jaFeitas
    });
    for (const c of novas) {
      await db.run(
        `INSERT INTO conquistas(id,acompanhamento_id,user_id,canal_id,meta,registro,inscritos_inicio,inscritos_conquista,atingida_em,precisao,regras_versao,criado_em)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(canal_id,meta) DO NOTHING`,
        [uid(), acomp.id, userId, canalId, c.meta, c.registro, c.inscritosInicio, c.inscritosConquista, c.atingidaEm, c.precisao, versao, now()]
      );
    }
  }

  const temConquista = await db.get('SELECT 1 AS x FROM conquistas WHERE canal_id=? LIMIT 1', [canalId]);
  const estado = temConquista ? 'concluiu_meta' : now() > fim ? 'encerrado_sem_meta' : 'em_acompanhamento';
  if (estado !== acomp.estado) await gravar({ estado });
  return acomp;
}

/** Recalcula todo mundo. Usado pelo botão do painel e pelo agendador. */
export async function recalcularTodos(db) {
  const ids = await db.all(
    `SELECT DISTINCT a.user_id FROM acompanhamentos a
     UNION SELECT DISTINCT m.user_id FROM medicoes_canal m`
  );
  let n = 0;
  for (const r of ids) { try { await recalcular(db, r.user_id); n++; } catch { /* segue */ } }
  return n;
}

/* ========================= AGREGAÇÃO ========================= */

/** Os três registros, agregados e sem nada que identifique uma pessoa. */
export async function resultados(db) {
  const { versao, regras } = await regrasAtuais(db);
  const acomps = await db.all(
    `SELECT a.*, (SELECT inscritos FROM medicoes_canal m WHERE m.canal_id=a.canal_id AND m.inscritos IS NOT NULL AND m.origem NOT IN ('mock','descartada') ORDER BY m.medido_em DESC LIMIT 1) AS inscritos_atuais
     FROM acompanhamentos a`
  );
  const elegiveis = acomps.filter((a) => ['em_acompanhamento', 'concluiu_meta', 'encerrado_sem_meta'].includes(a.estado));
  const conquistas = await db.all('SELECT canal_id, meta, registro, inscritos_inicio, inscritos_conquista, atingida_em FROM conquistas');

  // --- Registro 2: crescimento na janela de cada acompanhamento elegível ---
  const crescimentos = [];
  for (const a of elegiveis) {
    const med = await db.all(
      `SELECT inscritos, precisao, medido_em FROM medicoes_canal
        WHERE canal_id=? AND origem NOT IN ('mock','descartada') AND medido_em>=? AND medido_em<=? ORDER BY medido_em`,
      [a.canal_id, a.elegivel_em || a.inicio, a.fim || now()]
    );
    const c = crescimentoNaJanela(med, a.elegivel_em || a.inicio, a.fim || now());
    if (c.suficiente) crescimentos.push({ canal: a.canal_id, ...c });
  }
  const somaGanhos = crescimentos.reduce((s, c) => s + Math.max(0, c.diferenca), 0);
  const somaPerdas = crescimentos.reduce((s, c) => s + Math.min(0, c.diferenca), 0);

  const r1 = conquistas.filter((c) => Number(c.registro) === 1);
  const r3 = conquistas.filter((c) => Number(c.registro) === 3);
  const min = regras.minimoParaPublicar;

  const catsFaixa = faixas(regras.metas).map((f) => ({ id: f.id, rotulo: f.rotulo }));
  const distFaixaAtual = distribuir(
    elegiveis.filter((a) => a.inscritos_atuais !== null && a.inscritos_atuais !== undefined),
    catsFaixa,
    (a) => faixaDe(Number(a.inscritos_atuais), regras.metas),
    { minimo: min, populacao: 'Canais elegíveis com medição válida, pela faixa de inscritos de hoje' }
  );
  const concluidos = elegiveis.filter((a) => ['concluiu_meta', 'encerrado_sem_meta'].includes(a.estado));
  const distDesfecho = distribuir(
    concluidos,
    [{ id: 'concluiu_meta', rotulo: 'Alcançou uma meta' }, { id: 'encerrado_sem_meta', rotulo: 'Terminou o período sem a meta' }],
    (a) => a.estado,
    { minimo: min, populacao: 'Acompanhamentos já encerrados ou com meta alcançada' }
  );
  const catsMeta = [...regras.metas].sort((a, b) => a - b).map((m) => ({ id: 'm' + m, rotulo: m.toLocaleString('pt-BR') + ' inscritos' }));
  const distMetas = distribuir(
    conquistas,
    catsMeta,
    (c) => 'm' + Number(c.meta),
    { minimo: min, populacao: 'Metas alcançadas, contando cada conquista uma vez', unidade: 'conquistas' }
  );

  const periodos = elegiveis.map((a) => a.elegivel_em).filter(Boolean).sort();

  return {
    versaoRegras: versao,
    regras: {
      metas: regras.metas, fracaoLimiar: regras.fracaoLimiar, usosMinimos: regras.usosMinimos,
      diasDistintosMinimos: regras.diasDistintosMinimos, diasAcompanhamento: regras.diasAcompanhamento,
      minimoParaPublicar: min, exigeFerramentaDeCanal: regras.exigeFerramentaDeCanal
    },
    base: {
      canaisElegiveis: elegiveis.length,
      emAcompanhamento: elegiveis.filter((a) => a.estado === 'em_acompanhamento').length,
      encerradosSemMeta: elegiveis.filter((a) => a.estado === 'encerrado_sem_meta').length,
      aguardandoUso: acomps.filter((a) => a.estado === 'aguardando_uso').length,
      semDados: acomps.filter((a) => a.estado === 'sem_dados').length,
      periodoDe: periodos[0] || null,
      periodoAte: periodos.length ? (elegiveis.map((a) => a.fim).filter(Boolean).sort().at(-1) || null) : null,
      suficienteParaPublicar: elegiveis.length >= min,
      minimoParaPublicar: min
    },
    registro1: {
      titulo: 'Metas alcançadas com potencial de ajuda significativa',
      descricao: `Canais que começaram abaixo de ${Math.round(regras.fracaoLimiar * 100)}% da meta, cumpriram o uso mínimo e alcançaram a meta durante o acompanhamento.`,
      total: r1.length,
      publicavel: r1.length >= min,
      porMeta: resumirPorMeta(r1, regras.metas)
    },
    registro2: {
      titulo: 'Inscritos conquistados durante o acompanhamento',
      descricao: 'Crescimento observado enquanto o canal usava a plataforma. É medição, não prova de causa.',
      canais: crescimentos.length,
      publicavel: crescimentos.length >= min,
      inscritosGanhos: somaGanhos,
      inscritosPerdidos: Math.abs(somaPerdas),
      liquido: somaGanhos + somaPerdas,
      medianaDiferenca: mediana(crescimentos.map((c) => c.diferenca)),
      medianaPercentual: mediana(crescimentos.map((c) => c.percentual).filter((v) => v !== null)),
      estimado: crescimentos.some((c) => c.estimado)
    },
    registro3: {
      titulo: 'Metas alcançadas por quem já estava acima do limite',
      descricao: `Canais que já começaram em ${Math.round(regras.fracaoLimiar * 100)}% da meta ou acima. A conquista conta, mas não entra no primeiro registro.`,
      total: r3.length,
      publicavel: r3.length >= min,
      porMeta: resumirPorMeta(r3, regras.metas)
    },
    distribuicoes: [distFaixaAtual, distDesfecho, distMetas],
    aviso: 'Crescimento observado durante o acompanhamento não comprova que o TurboCanal o causou. Não há grupo de controle, e fatores fora da plataforma afetam qualquer canal.'
  };
}

function resumirPorMeta(lista, metas) {
  const out = [];
  for (const m of [...metas].sort((a, b) => a - b)) {
    const n = lista.filter((c) => Number(c.meta) === m).length;
    if (n) out.push({ meta: m, quantidade: n });
  }
  return out;
}

export function mediana(ns) {
  const v = ns.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : Math.round(((v[meio - 1] + v[meio]) / 2) * 10) / 10;
}

/** O que o próprio usuário vê sobre o acompanhamento dele. */
export async function meuAcompanhamento(db, user) {
  const tok = await db.get('SELECT channel_id, channel_title FROM yt_tokens WHERE user_id=?', [user.id]);
  if (!tok?.channel_id) return { canalLigado: false };
  const a = await db.get('SELECT * FROM acompanhamentos WHERE user_id=? AND canal_id=?', [user.id, tok.channel_id]);
  const { regras } = a ? await regrasDaVersao(db, a.regras_versao) : await regrasAtuais(db);
  const med = await db.all('SELECT inscritos, precisao, medido_em FROM medicoes_canal WHERE canal_id=? ORDER BY medido_em', [tok.channel_id]);
  const conq = await db.all('SELECT meta, registro, inscritos_conquista, atingida_em FROM conquistas WHERE canal_id=? ORDER BY meta', [tok.channel_id]);
  const usos = usosValidos(await db.all(
    'SELECT delta, tool, created_at FROM transactions WHERE user_id=? AND tool IS NOT NULL ORDER BY created_at', [user.id]
  ));
  const uso = avaliarUso(usos, regras);
  const atual = medicoesUteis(med).at(-1) || null;
  return {
    canalLigado: true,
    canal: tok.channel_title || null,
    estado: a?.estado || 'sem_dados',
    estadoRotulo: ESTADOS[a?.estado || 'sem_dados'],
    inicio: a?.inicio || null,
    inscritosInicial: a?.inscritos_inicial ?? null,
    inscritosAtuais: atual?.inscritos ?? null,
    precisaoAtual: atual?.precisao || null,
    metaAlvo: a?.meta_alvo ?? null,
    limiar: a?.limiar ?? null,
    grupo: a?.grupo ?? null,
    elegivelEm: a?.elegivel_em || null,
    fim: a?.fim || null,
    uso: { elegivel: uso.elegivel, falta: uso.falta || null, usosValidos: usos.length, diasDistintos: new Set(usos.map((u) => u.dia)).size },
    crescimento: a?.elegivel_em ? crescimentoNaJanela(med, a.elegivel_em, a.fim || now()) : { suficiente: false, motivo: 'acompanhamento ainda não começou' },
    conquistas: conq,
    medicoes: med.length,
    regras: { metas: regras.metas, usosMinimos: regras.usosMinimos, diasDistintosMinimos: regras.diasDistintosMinimos, diasAcompanhamento: regras.diasAcompanhamento }
  };
}

/* ========================= ROTAS ========================= */

export function estatisticaRoutes(app, db, auth) {
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  // Público: só números agregados, nunca canal, nome ou e-mail de ninguém.
  app.get('/api/estatisticas/resultados', wrap(async (req, res) => {
    res.json(await resultados(db));
  }));

  // O próprio usuário vê a situação do canal dele.
  app.get('/api/estatisticas/meu', auth.required, wrap(async (req, res) => {
    res.json(await meuAcompanhamento(db, req.user));
  }));

  app.get('/api/admin/estatisticas/regras', ...auth.admin, wrap(async (req, res) => {
    const atual = await regrasAtuais(db);
    const historico = await db.all('SELECT versao, regras, autor_email, criado_em FROM regras_estat ORDER BY versao DESC LIMIT 20');
    res.json({
      versao: atual.versao,
      regras: atual.regras,
      padrao: REGRAS_PADRAO,
      ferramentas: { canal: [...FERRAMENTAS_CANAL], conteudo: [...FERRAMENTAS_CONTEUDO] },
      historico: historico.map((h) => { try { return { ...h, regras: JSON.parse(h.regras) }; } catch { return h; } })
    });
  }));

  // Só o dono muda regra: mexer no critério muda o que o site publica.
  app.post('/api/admin/estatisticas/regras', ...auth.owner, wrap(async (req, res) => {
    const r = await salvarRegras(db, req.user, req.body || {});
    res.json({ ok: true, ...r, aviso: r.mudou ? 'Acompanhamentos e conquistas que já existem continuam com a versão de regra anterior. A mudança vale para os novos.' : 'Nada mudou.' });
  }));

  app.get('/api/admin/estatisticas/situacao', ...auth.admin, wrap(async (req, res) => {
    const por = await db.all('SELECT estado, COUNT(*) AS n FROM acompanhamentos GROUP BY estado');
    const medicoes = await db.get('SELECT COUNT(*) AS n, MIN(medido_em) AS pri, MAX(medido_em) AS ult FROM medicoes_canal');
    const conq = await db.all('SELECT registro, COUNT(*) AS n FROM conquistas GROUP BY registro');
    res.json({
      estados: Object.fromEntries(por.map((p) => [p.estado, Number(p.n)])),
      rotulos: ESTADOS,
      medicoes: { total: Number(medicoes?.n || 0), primeira: medicoes?.pri || null, ultima: medicoes?.ult || null },
      conquistas: Object.fromEntries(conq.map((c) => ['registro' + c.registro, Number(c.n)])),
      resultados: await resultados(db)
    });
  }));

  app.post('/api/admin/estatisticas/recalcular', ...auth.admin, wrap(async (req, res) => {
    const n = await recalcularTodos(db);
    await audit(db, req.user, 'estatisticas.recalcular', '', { usuarios: n });
    res.json({ ok: true, usuarios: n });
  }));
}
