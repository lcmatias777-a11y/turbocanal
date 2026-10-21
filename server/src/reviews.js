// Avaliações e comentários sobre o site.
// Duas coisas diferentes, na mesma lista:
//   - AVALIAÇÃO: tem nota de 1 a 5 estrelas, uma por conta, entra na média.
//   - COMENTÁRIO: só texto, quantos a pessoa quiser, NÃO entra na média.
// Nos dois dá para responder, dar gostei/não gostei e denunciar. A resposta de
// quem toca o site aparece primeiro e em destaque (dono = desenvolvedor, admin = equipe).
// Nada aqui é inventado: média, total e distribuição saem de uma soma no banco.
import { HttpError, uid, now } from './util.js';

const MAX_TEXTO = 1000;
const TIPOS = { avaliacao: 'reviews', comentario: 'site_comments', resposta: 'respostas' };
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function lerEstrelas(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new HttpError(400, 'A nota precisa ser um número inteiro de 1 a 5 estrelas.');
  return n;
}
function lerTexto(v, nome, obrigatorio = false, max = MAX_TEXTO) {
  const t = String(v ?? '').trim();
  if (obrigatorio && !t) throw new HttpError(400, `${nome} não pode ficar em branco.`);
  if (t.length > max) throw new HttpError(400, `${nome} pode ter no máximo ${max} caracteres.`);
  return t;
}
function lerTipo(v) {
  const t = String(v || '').trim();
  if (!TIPOS[t]) throw new HttpError(400, 'Tipo de conteúdo inválido.');
  return t;
}
/** Nome que aparece na tela: o nome da conta do Google. Nunca o e-mail. */
const autor = (nome) => String(nome || '').trim() || 'Usuário do TurboCanal';
const papelDe = (user) => (user.role === 'owner' ? 'owner' : user.role === 'admin' ? 'admin' : 'user');

export async function resumo(db) {
  const linhas = await db.all("SELECT stars, COUNT(*) AS n FROM reviews WHERE status='active' GROUP BY stars");
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0, soma = 0;
  for (const l of linhas) {
    const e = Number(l.stars), n = Number(l.n);
    dist[e] = n; total += n; soma += e * n;
  }
  const comentarios = Number((await db.get("SELECT COUNT(*) AS n FROM site_comments WHERE status='active'")).n) || 0;
  return {
    total,
    comentarios,
    media: total ? Math.round((soma / total) * 10) / 10 : 0,
    distribuicao: dist,
    percentuais: Object.fromEntries([1, 2, 3, 4, 5].map((e) => [e, total ? Math.round((dist[e] / total) * 1000) / 10 : 0]))
  };
}

/** Gostei/não gostei de vários itens de uma vez (e o voto de quem está olhando). */
async function votos(db, chaves, userId) {
  const mapa = {};
  for (const [tipo, id] of chaves) mapa[tipo + ':' + id] = { gostei: 0, naoGostei: 0, meuVoto: 0 };
  if (!chaves.length) return mapa;
  const ids = [...new Set(chaves.map(([, id]) => id))];
  const marcas = ids.map(() => '?').join(',');
  for (const l of await db.all(
    `SELECT target_type, target_id,
            SUM(CASE WHEN value=1 THEN 1 ELSE 0 END) AS gostei,
            SUM(CASE WHEN value=-1 THEN 1 ELSE 0 END) AS naogostei
       FROM review_votes WHERE target_id IN (${marcas}) GROUP BY target_type, target_id`, ids)) {
    const k = l.target_type + ':' + l.target_id;
    if (mapa[k]) { mapa[k].gostei = Number(l.gostei) || 0; mapa[k].naoGostei = Number(l.naogostei) || 0; }
  }
  if (userId) {
    for (const m of await db.all(`SELECT target_type, target_id, value FROM review_votes WHERE user_id=? AND target_id IN (${marcas})`, [userId, ...ids])) {
      const k = m.target_type + ':' + m.target_id;
      if (mapa[k]) mapa[k].meuVoto = Number(m.value) || 0;
    }
  }
  return mapa;
}

/** Respostas de vários itens. O desenvolvedor vem primeiro, depois a equipe, depois o resto. */
async function respostasDe(db, chaves, userId) {
  const por = {};
  if (!chaves.length) return por;
  const ids = chaves.map(([, id]) => id);
  const marcas = ids.map(() => '?').join(',');
  const linhas = await db.all(
    `SELECT r.*, u.name AS autor_nome FROM respostas r JOIN users u ON u.id=r.user_id
      WHERE r.status='active' AND r.alvo_id IN (${marcas})
      ORDER BY CASE r.papel WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, r.created_at ASC`, ids);
  const v = await votos(db, linhas.map((l) => ['resposta', l.id]), userId);
  for (const l of linhas) {
    const chave = l.alvo_tipo + ':' + l.alvo_id;
    (por[chave] ||= []).push({
      id: l.id,
      autor: autor(l.autor_nome),
      papel: l.papel,
      doDesenvolvedor: l.papel === 'owner',
      daEquipe: l.papel === 'admin',
      texto: l.body,
      criado_em: l.created_at,
      minha: !!userId && l.user_id === userId,
      ...v['resposta:' + l.id]
    });
  }
  return por;
}

export function reviewRoutes(app, db, auth) {
  app.get('/api/reviews/summary', wrap(async (req, res) => res.json(await resumo(db))));

  // Lista única com avaliações e comentários misturados, do jeito que aparecem na tela
  app.get('/api/reviews', auth.optional, wrap(async (req, res) => {
    const ordem = req.query.sort === 'melhores' ? 'melhores' : 'recentes';
    const limite = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const pagina = Math.max(1, parseInt(req.query.page, 10) || 1);
    const userId = req.user?.id || null;
    const total = Number((await db.get(
      "SELECT (SELECT COUNT(*) FROM reviews WHERE status='active') + (SELECT COUNT(*) FROM site_comments WHERE status='active') AS n"
    )).n) || 0;
    const ordenacao = ordem === 'melhores'
      ? 'CASE WHEN stars IS NULL THEN 1 ELSE 0 END, stars DESC, created_at DESC'
      : 'created_at DESC';
    const linhas = await db.all(
      `SELECT * FROM (
         SELECT r.id, r.user_id, r.stars, r.comment AS texto, r.created_at, r.updated_at, 'avaliacao' AS tipo, u.name AS autor_nome
           FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.status='active'
         UNION ALL
         SELECT c.id, c.user_id, NULL AS stars, c.body AS texto, c.created_at, c.updated_at, 'comentario' AS tipo, u.name AS autor_nome
           FROM site_comments c JOIN users u ON u.id=c.user_id WHERE c.status='active'
       ) t ORDER BY ${ordenacao} LIMIT ? OFFSET ?`,
      [limite, (pagina - 1) * limite]
    );
    const chaves = linhas.map((l) => [l.tipo, l.id]);
    const v = await votos(db, chaves, userId);
    const resp = await respostasDe(db, chaves, userId);
    res.json({
      resumo: await resumo(db),
      ordem, pagina, total,
      paginas: Math.max(1, Math.ceil(total / limite)),
      itens: linhas.map((l) => ({
        id: l.id,
        tipo: l.tipo,
        autor: autor(l.autor_nome),
        estrelas: l.stars == null ? null : Number(l.stars),
        comentario: l.texto,
        criado_em: l.created_at,
        editado_em: l.updated_at !== l.created_at ? l.updated_at : null,
        minha: !!userId && l.user_id === userId,
        respostas: resp[l.tipo + ':' + l.id] || [],
        ...v[l.tipo + ':' + l.id]
      }))
    });
  }));

  app.get('/api/reviews/mine', auth.required, wrap(async (req, res) => {
    const r = await db.get('SELECT * FROM reviews WHERE user_id=?', [req.user.id]);
    res.json({ avaliacao: r ? { id: r.id, estrelas: Number(r.stars), comentario: r.comment, status: r.status, criado_em: r.created_at, editado_em: r.updated_at } : null });
  }));

  // ---------- avaliação (uma por conta) ----------
  app.post('/api/reviews', auth.required, wrap(async (req, res) => {
    const estrelas = lerEstrelas(req.body?.estrelas ?? req.body?.stars);
    const comentario = lerTexto(req.body?.comentario ?? req.body?.comment, 'O comentário');
    const atual = await db.get('SELECT * FROM reviews WHERE user_id=?', [req.user.id]);
    if (atual?.status === 'removed') throw new HttpError(403, 'Sua avaliação foi removida pela moderação e não pode ser reenviada.');
    if (atual) await db.run('UPDATE reviews SET stars=?, comment=?, updated_at=? WHERE id=? AND user_id=?', [estrelas, comentario, now(), atual.id, req.user.id]);
    else await db.run('INSERT INTO reviews(id,user_id,stars,comment,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', [uid(), req.user.id, estrelas, comentario, 'active', now(), now()]);
    const r = await db.get('SELECT * FROM reviews WHERE user_id=?', [req.user.id]);
    res.json({ ok: true, novo: !atual, avaliacao: { id: r.id, estrelas: Number(r.stars), comentario: r.comment, criado_em: r.created_at, editado_em: r.updated_at }, resumo: await resumo(db) });
  }));

  app.delete('/api/reviews/mine', auth.required, wrap(async (req, res) => {
    const r = await db.get('SELECT * FROM reviews WHERE user_id=?', [req.user.id]);
    if (!r) throw new HttpError(404, 'Você ainda não avaliou o site.');
    await db.run('DELETE FROM review_votes WHERE target_id=?', [r.id]);
    await db.run('DELETE FROM respostas WHERE alvo_tipo=? AND alvo_id=?', ['avaliacao', r.id]);
    await db.run('DELETE FROM reviews WHERE id=? AND user_id=?', [r.id, req.user.id]);
    res.json({ ok: true, resumo: await resumo(db) });
  }));

  // ---------- comentário solto (sem nota, quantos quiser) ----------
  app.post('/api/comments', auth.required, wrap(async (req, res) => {
    const texto = lerTexto(req.body?.texto ?? req.body?.comentario, 'O comentário', true);
    const id = uid();
    await db.run('INSERT INTO site_comments(id,user_id,body,status,created_at,updated_at) VALUES(?,?,?,?,?,?)', [id, req.user.id, texto, 'active', now(), now()]);
    res.json({ ok: true, comentario: { id, tipo: 'comentario', autor: autor(req.user.name), estrelas: null, comentario: texto, criado_em: now(), minha: true, gostei: 0, naoGostei: 0, meuVoto: 0, respostas: [] } });
  }));

  app.delete('/api/comments/:id', auth.required, wrap(async (req, res) => {
    const c = await db.get('SELECT * FROM site_comments WHERE id=?', [req.params.id]);
    if (!c) throw new HttpError(404, 'Comentário não encontrado.');
    const ehAdmin = ['owner', 'admin'].includes(req.user.role);
    if (c.user_id !== req.user.id && !ehAdmin) throw new HttpError(403, 'Este comentário não é seu.');
    await db.run('DELETE FROM review_votes WHERE target_id=?', [c.id]);
    await db.run('DELETE FROM respostas WHERE alvo_tipo=? AND alvo_id=?', ['comentario', c.id]);
    await db.run('DELETE FROM site_comments WHERE id=?', [c.id]);
    res.json({ ok: true, resumo: await resumo(db) });
  }));

  // ---------- responder (vale para avaliação e para comentário) ----------
  app.post('/api/replies', auth.required, wrap(async (req, res) => {
    const tipo = lerTipo(req.body?.alvo_tipo);
    if (tipo === 'resposta') throw new HttpError(400, 'Não dá para responder a uma resposta.');
    const texto = lerTexto(req.body?.texto, 'A resposta', true);
    const alvo = await db.get(`SELECT * FROM ${TIPOS[tipo]} WHERE id=? AND status='active'`, [req.body?.alvo_id]);
    if (!alvo) throw new HttpError(404, 'Conteúdo não encontrado.');
    const papel = papelDe(req.user);
    const id = uid();
    await db.run('INSERT INTO respostas(id,alvo_tipo,alvo_id,user_id,body,papel,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      [id, tipo, alvo.id, req.user.id, texto, papel, 'active', now(), now()]);
    res.json({ ok: true, resposta: { id, autor: autor(req.user.name), papel, doDesenvolvedor: papel === 'owner', daEquipe: papel === 'admin', texto, criado_em: now(), minha: true, gostei: 0, naoGostei: 0, meuVoto: 0 } });
  }));

  app.delete('/api/replies/:id', auth.required, wrap(async (req, res) => {
    const r = await db.get('SELECT * FROM respostas WHERE id=?', [req.params.id]);
    if (!r) throw new HttpError(404, 'Resposta não encontrada.');
    if (r.user_id !== req.user.id && !['owner', 'admin'].includes(req.user.role)) throw new HttpError(403, 'Esta resposta não é sua.');
    await db.run('DELETE FROM review_votes WHERE target_id=?', [r.id]);
    await db.run('DELETE FROM respostas WHERE id=?', [r.id]);
    res.json({ ok: true });
  }));

  // ---------- gostei / não gostei ----------
  app.post('/api/votes', auth.required, wrap(async (req, res) => {
    const tipo = lerTipo(req.body?.alvo_tipo);
    const valor = Number(req.body?.valor);
    if (![1, -1, 0].includes(valor)) throw new HttpError(400, 'Voto inválido (1 para gostei, -1 para não gostei, 0 para desfazer).');
    const alvo = await db.get(`SELECT * FROM ${TIPOS[tipo]} WHERE id=? AND status='active'`, [req.body?.alvo_id]);
    if (!alvo) throw new HttpError(404, 'Conteúdo não encontrado.');
    if (alvo.user_id === req.user.id) throw new HttpError(400, 'Você não pode votar no que escreveu.');
    await db.run('DELETE FROM review_votes WHERE target_type=? AND target_id=? AND user_id=?', [tipo, alvo.id, req.user.id]);
    if (valor !== 0) await db.run('INSERT INTO review_votes(id,target_type,target_id,user_id,value,created_at) VALUES(?,?,?,?,?,?)', [uid(), tipo, alvo.id, req.user.id, valor, now()]);
    res.json({ ok: true, ...(await votos(db, [[tipo, alvo.id]], req.user.id))[tipo + ':' + alvo.id] });
  }));

  // ---------- denúncias ----------
  app.post('/api/reports', auth.required, wrap(async (req, res) => {
    const tipo = lerTipo(req.body?.alvo_tipo);
    const motivo = lerTexto(req.body?.motivo, 'O motivo', false, 300);
    const alvo = await db.get(`SELECT * FROM ${TIPOS[tipo]} WHERE id=? AND status='active'`, [req.body?.alvo_id]);
    if (!alvo) throw new HttpError(404, 'Conteúdo não encontrado.');
    const ja = await db.get('SELECT id FROM review_reports WHERE target_type=? AND target_id=? AND user_id=?', [tipo, alvo.id, req.user.id]);
    if (ja) return res.json({ ok: true, repetida: true });
    await db.run('INSERT INTO review_reports(id,target_type,target_id,user_id,reason,status,created_at) VALUES(?,?,?,?,?,?,?)', [uid(), tipo, alvo.id, req.user.id, motivo, 'open', now()]);
    res.json({ ok: true });
  }));

  // ---------- moderação ----------
  app.get('/api/admin/reviews/reports', ...auth.admin, wrap(async (req, res) => {
    const linhas = await db.all(
      `SELECT d.*, u.name AS quem_nome, u.email AS quem_email FROM review_reports d JOIN users u ON u.id=d.user_id
        WHERE d.status='open' ORDER BY d.created_at DESC LIMIT 100`);
    const itens = [];
    for (const d of linhas) {
      const tabela = TIPOS[d.target_type];
      if (!tabela) continue;
      const campo = d.target_type === 'avaliacao' ? 'a.comment' : 'a.body';
      const alvo = await db.get(
        `SELECT a.id, ${d.target_type === 'avaliacao' ? 'a.stars' : 'NULL AS stars'}, ${campo} AS texto, a.status, u.name AS autor
           FROM ${tabela} a JOIN users u ON u.id=a.user_id WHERE a.id=?`, [d.target_id]);
      itens.push({ id: d.id, tipo: d.target_type, alvo_id: d.target_id, motivo: d.reason, criado_em: d.created_at, denunciante: d.quem_nome || d.quem_email, alvo });
    }
    res.json({ itens });
  }));

  app.post('/api/admin/moderate', ...auth.admin, wrap(async (req, res) => {
    const tipo = lerTipo(req.body?.alvo_tipo);
    const remover = req.body?.remover !== false;
    const motivo = lerTexto(req.body?.motivo, 'O motivo', false, 300);
    const alvo = await db.get(`SELECT * FROM ${TIPOS[tipo]} WHERE id=?`, [req.body?.alvo_id]);
    if (!alvo) throw new HttpError(404, 'Conteúdo não encontrado.');
    const campoMod = tipo === 'avaliacao' ? ', moderated_reason=?' : '';
    const vals = tipo === 'avaliacao'
      ? [remover ? 'removed' : 'active', req.user.id, motivo, now(), alvo.id]
      : [remover ? 'removed' : 'active', req.user.id, now(), alvo.id];
    await db.run(`UPDATE ${TIPOS[tipo]} SET status=?, moderated_by=?${campoMod}, updated_at=? WHERE id=?`, vals);
    await db.run("UPDATE review_reports SET status='handled' WHERE target_type=? AND target_id=?", [tipo, alvo.id]);
    await db.run('INSERT INTO audit(id, actor_id, actor_email, action, target, detail, created_at) VALUES(?,?,?,?,?,?,?)',
      [uid(), req.user.id, req.user.email, remover ? 'review.remove' : 'review.restore', alvo.id, `${tipo}: ${motivo || '(sem motivo)'}`, now()]);
    res.json({ ok: true, resumo: await resumo(db) });
  }));
}
