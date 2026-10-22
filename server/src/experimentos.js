// Diário de experimentos.
//
// O criador escreve uma hipótese ("títulos mais curtos rendem mais"), diz o que
// vai mudar e qual número vai olhar. Na data de revisão o site compara os vídeos
// publicados DEPOIS do início com os de ANTES, no mesmo número, e devolve a
// diferença medida.
//
// O que este arquivo NÃO faz: dizer que a mudança causou o resultado. Ele mostra
// antes e depois, diz em quantos vídeos cada lado se baseia e avisa que poucos
// vídeos não provam nada. Quem conclui é a pessoa.

import { HttpError, uid, now } from './util.js';
import { notificar } from './notify.js';

export const METRICAS = {
  views: { nome: 'views', rotulo: 'Views por vídeo', campo: 'views', unidade: '' },
  retencao: { nome: 'retencao', rotulo: 'Retenção média (%)', campo: 'percentualMedio', unidade: '%' },
  inscritos: { nome: 'inscritos', rotulo: 'Inscritos por mil views', campo: 'inscritosPorMil', unidade: '' }
};

export const MIN_LADO = 3;      // menos que isso de cada lado não vira comparação
const MAX_TEXTO = 300;
const DIAS_PADRAO = 21;

const txt = (v, max = MAX_TEXTO) => String(v ?? '').trim().slice(0, max);

export function mediana(ns) {
  const a = (ns || []).filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
const r1 = (n) => Math.round(n * 10) / 10;

/** Compara os vídeos de antes e de depois do início do experimento.
 *  Função pura: os testes usam direto. */
export function compararAntesDepois(videos, { inicio, metrica = 'views' } = {}) {
  const m = METRICAS[metrica] || METRICAS.views;
  const corte = new Date(inicio).getTime();
  if (!Number.isFinite(corte)) throw new HttpError(400, 'Data de início inválida.');

  const antes = [], depois = [];
  for (const v of videos || []) {
    const t = new Date(v.publicado || v.publishedAt || 0).getTime();
    if (!Number.isFinite(t) || !t) continue;
    const valor = Number(v[m.campo]);
    if (!Number.isFinite(valor)) continue;
    (t < corte ? antes : depois).push({ titulo: String(v.titulo || v.id || ''), valor, quando: new Date(t).toISOString() });
  }
  const medAntes = r1(mediana(antes.map((x) => x.valor)));
  const medDepois = r1(mediana(depois.map((x) => x.valor)));
  const suficiente = antes.length >= MIN_LADO && depois.length >= MIN_LADO;
  const diferenca = medAntes > 0 ? Math.round(((medDepois - medAntes) / medAntes) * 100) : null;

  // robustez: tira o vídeo mais extremo do lado "depois" e vê se o sinal continua
  const semExtremo = [...depois].sort((a, b) => b.valor - a.valor).slice(1);
  const medSem = r1(mediana(semExtremo.map((x) => x.valor)));
  const mesmoSentido = diferenca === null ? null
    : semExtremo.length >= MIN_LADO - 1 && Math.sign(medSem - medAntes) === Math.sign(medDepois - medAntes) && medSem !== medAntes;

  let leitura;
  if (!suficiente) {
    leitura = `Ainda não dá para comparar: ${antes.length} vídeo(s) antes e ${depois.length} depois. Preciso de pelo menos ${MIN_LADO} de cada lado.`;
  } else if (diferenca === null) {
    leitura = 'Não dá para calcular a diferença porque a mediana de antes é zero.';
  } else if (mesmoSentido === false) {
    leitura = `${m.rotulo}: ${medAntes}${m.unidade} antes contra ${medDepois}${m.unidade} depois (${diferenca >= 0 ? '+' : ''}${diferenca}%). Mas tirando o vídeo mais extremo a diferença muda de sentido, então isso aqui está pendurado em um vídeo só.`;
  } else {
    leitura = `${m.rotulo}: ${medAntes}${m.unidade} antes contra ${medDepois}${m.unidade} depois (${diferenca >= 0 ? '+' : ''}${diferenca}%), em ${antes.length} e ${depois.length} vídeos. A diferença continua no mesmo sentido mesmo tirando o vídeo mais extremo.`;
  }

  return {
    metrica: m.nome, rotulo: m.rotulo, unidade: m.unidade,
    antes: { videos: antes.length, mediana: medAntes },
    depois: { videos: depois.length, mediana: medDepois },
    diferenca, suficiente, mesmoSentido, leitura,
    aviso: `Isto é antes e depois, não é prova. ${depois.length} vídeo(s) não provam que a sua mudança causou a diferença: assunto, capa, época do ano e o próprio algoritmo mudam junto. Serve para você decidir se vale continuar testando.`
  };
}

export function experimentoRoutes(app, db, auth) {
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
  const monta = (r) => ({
    id: r.id, hipotese: r.hipotese, mudanca: r.mudanca, metrica: r.metrica,
    rotulo: METRICAS[r.metrica]?.rotulo || r.metrica,
    status: r.status, criado_em: r.created_at, revisar_em: r.revisar_em,
    conclusao: r.conclusao, resultado: (() => { try { return r.resultado ? JSON.parse(r.resultado) : null; } catch { return null; } })()
  });

  app.get('/api/experimentos', auth.required, wrap(async (req, res) => {
    const rows = await db.all('SELECT * FROM experimentos WHERE user_id=? ORDER BY created_at DESC LIMIT 50', [req.user.id]);
    res.json({
      itens: rows.map(monta),
      metricas: Object.values(METRICAS).map((m) => ({ id: m.nome, rotulo: m.rotulo })),
      emAberto: rows.filter((r) => r.status === 'rodando').length,
      paraRevisar: rows.filter((r) => r.status === 'rodando' && r.revisar_em <= now()).length
    });
  }));

  app.post('/api/experimentos', auth.required, wrap(async (req, res) => {
    const hipotese = txt(req.body?.hipotese);
    const mudanca = txt(req.body?.mudanca);
    if (!hipotese) throw new HttpError(400, 'Escreva a hipótese: o que você acha que vai acontecer?');
    if (!mudanca) throw new HttpError(400, 'Escreva o que você vai mudar nos próximos vídeos.');
    const metrica = METRICAS[req.body?.metrica] ? req.body.metrica : 'views';
    const dias = Math.min(90, Math.max(7, parseInt(req.body?.dias, 10) || DIAS_PADRAO));
    const abertos = (await db.get("SELECT COUNT(*)::int AS n FROM experimentos WHERE user_id=? AND status='rodando'", [req.user.id])).n;
    if (abertos >= 3) throw new HttpError(400, 'Você já tem 3 experimentos rodando. Conclua um antes de começar outro: testar tudo ao mesmo tempo não deixa saber o que funcionou.');
    const id = uid();
    const revisar = new Date(Date.now() + dias * 86400e3).toISOString();
    await db.run('INSERT INTO experimentos(id,user_id,hipotese,mudanca,metrica,status,revisar_em,resultado,conclusao,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [id, req.user.id, hipotese, mudanca, metrica, 'rodando', revisar, '', '', now(), now()]);
    res.json({ ok: true, id, revisar_em: revisar, dias });
  }));

  // Mede agora: compara os vídeos publicados depois do início com os de antes
  app.get('/api/experimentos/:id/medir', auth.required, wrap(async (req, res) => {
    const e = await db.get('SELECT * FROM experimentos WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    if (!e) throw new HttpError(404, 'Experimento não encontrado.');
    const { myVideoXray } = await import('./channel.js');
    const { analisarVideos } = await import('./xray.js');
    const dados = await myVideoXray(db, req.user, 365);
    const todos = analisarVideos(dados.videos, { minViews: 1 });
    const lista = [...todos.prendemMais, ...todos.prendemMenos, ...todos.campeoes, ...todos.soView];
    // usa a lista completa do Analytics, não só os recortes
    const completa = dados.videos.map((v) => ({
      titulo: v.titulo, publicado: v.publicado, views: v.views,
      percentualMedio: v.percentualMedio,
      inscritosPorMil: v.views >= 1 ? Math.round(((v.inscritosGanhos - v.inscritosPerdidos) / v.views) * 1000 * 10) / 10 : 0
    }));
    const r = compararAntesDepois(completa.length ? completa : lista, { inicio: e.created_at, metrica: e.metrica });
    res.json({ experimento: monta(e), ...r });
  }));

  app.post('/api/experimentos/:id/concluir', auth.required, wrap(async (req, res) => {
    const e = await db.get('SELECT * FROM experimentos WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    if (!e) throw new HttpError(404, 'Experimento não encontrado.');
    if (e.status !== 'rodando') throw new HttpError(409, 'Esse experimento já foi concluído.');
    const conclusao = txt(req.body?.conclusao, 600);
    if (!conclusao) throw new HttpError(400, 'Escreva o que você concluiu. É isso que vai servir da próxima vez.');
    await db.run("UPDATE experimentos SET status='concluido', conclusao=?, resultado=?, updated_at=? WHERE id=?",
      [conclusao, JSON.stringify(req.body?.resultado ?? null), now(), e.id]);
    res.json({ ok: true });
  }));

  app.delete('/api/experimentos/:id', auth.required, wrap(async (req, res) => {
    const e = await db.get('SELECT id FROM experimentos WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    if (!e) throw new HttpError(404, 'Experimento não encontrado.');
    await db.run('DELETE FROM experimentos WHERE id=?', [e.id]);
    res.json({ ok: true });
  }));
}

/** Avisa quem tem experimento vencendo. Chamado pelo agendador do servidor. */
export async function avisarExperimentos(db) {
  const vencidos = await db.all(
    "SELECT * FROM experimentos WHERE status='rodando' AND revisar_em <= ? AND avisado=0 LIMIT 100", [now()]);
  for (const e of vencidos) {
    await notificar(db, e.user_id, 'resposta_recebida', 'Hora de olhar o seu experimento', {
      corpo: `"${e.hipotese}" — já passou a data que você marcou para revisar. Veja o antes e depois.`,
      link: '#/ferramentas/experimentos', dados: { experimento: e.id }
    });
    await db.run('UPDATE experimentos SET avisado=1 WHERE id=?', [e.id]);
  }
  return vencidos.length;
}
