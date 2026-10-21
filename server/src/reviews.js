// Avaliações e comentários sobre o site, no estilo das lojas de aplicativos.
// Regras importantes: nada aqui é inventado (média, total e distribuição vêm do
// banco), uma avaliação ativa por conta, ninguém mexe na avaliação de outro, e
// avaliar NÃO custa créditos.
import { HttpError, uid, now } from './util.js';

const MAX_COMENTARIO = 1000;
const MAX_RESPOSTA = 1000;

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function lerEstrelas(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new HttpError(400, 'A nota precisa ser um número inteiro de 1 a 5 estrelas.');
  return n;
}
function lerTexto(v, max, nome) {
  const t = String(v ?? '').trim();
  if (t.length > max) throw new HttpError(400, `${nome} pode ter no máximo ${max} caracteres.`);
  return t;
}
/** Nome público do autor: nunca expõe o e-mail de ninguém. */
const autor = (u) => (u?.name || '').trim() || 'Usuário do TurboCanal';

export async function resumo(db) {
  const linhas = await db.all("SELECT stars, COUNT(*) AS n FROM reviews WHERE status='active' GROUP BY stars");
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0, soma = 0;
  for (const l of linhas) {
    const estrelas = Number(l.stars), n = Number(l.n);
    dist[estrelas] = n;
    total += n;
    soma += estrelas * n;
  }
  return {
    total,
    media: total ? Math.round((soma / total) * 10) / 10 : 0,
    distribuicao: dist,
    // percentual de cada barra, já pronto para desenhar (0 quando não há avaliação)
    percentuais: Object.fromEntries([1, 2, 3, 4, 5].map((e) => [e, total ? Math.round((dist[e] / total) * 1000) / 10 : 0]))
  };
}

async function votos(db, tipo, ids, userId) {
  if (!ids.length) return {};
  const marcas = ids.map(() => '?').join(',');
  const linhas = await db.all(
    `SELECT target_id,
            SUM(CASE WHEN value=1 THEN 1 ELSE 0 END) AS gostei,
            SUM(CASE WHEN value=-1 THEN 1 ELSE 0 END) AS naoGostei
       FROM review_votes WHERE target_type=? AND target_id IN (${marcas}) GROUP BY target_id`,
    [tipo, ...ids]
  );
  const meus = userId
    ? await db.all(`SELECT target_id, value FROM review_votes WHERE target_type=? AND user_id=? AND target_id IN (${marcas})`, [tipo, userId, ...ids])
    : [];
  const mapa = {};
  for (const id of ids) mapa[id] = { gostei: 0, naoGostei: 0, meuVoto: 0 };
  for (const l of linhas) mapa[l.target_id] = { ...mapa[l.target_id], gostei: Number(l.gostei) || 0, naoGostei: Number(l.naogostei ?? l.naoGostei) || 0 };
  for (const m of meus) mapa[m.target_id].meuVoto = Number(m.value) || 0;
  return mapa;
}

async function respostasDe(db, reviewIds, userId) {
  if (!reviewIds.length) return {};
  const marcas = reviewIds.map(() => '?').join(',');
  const linhas = await db.all(
    `SELECT r.*, u.name AS autor_nome, u.role AS autor_papel
       FROM review_replies r JOIN users u ON u.id = r.user_id
      WHERE r.status='active' AND r.review_id IN (${marcas})
      ORDER BY r.is_dev DESC, r.created_at ASC`,
    reviewIds
  );
  const v = await votos(db, 'reply', linhas.map((l) => l.id), userId);
  const por = {};
  for (const l of linhas) {
    (por[l.review_id] ||= []).push({
      id: l.id,
      autor: autor({ name: l.autor_nome }),
      doDesenvolvedor: !!Number(l.is_dev),
      texto: l.body,
      criado_em: l.created_at,
      minha: !!userId && l.user_id === userId,
      ...v[l.id]
    });
  }
  return por;
}

export function reviewRoutes(app, db, auth) {
  // ---------- leitura pública ----------
  app.get('/api/reviews/summary', wrap(async (req, res) => res.json(await resumo(db))));

  app.get('/api/reviews', auth.optional, wrap(async (req, res) => {
    const ordem = req.query.sort === 'melhores' ? 'melhores' : 'recentes';
    const limite = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const pagina = Math.max(1, parseInt(req.query.page, 10) || 1);
    const userId = req.user?.id || null;
    const total = Number((await db.get("SELECT COUNT(*) AS n FROM reviews WHERE status='active'")).n) || 0;
    const ordenacao = ordem === 'melhores'
      ? 'r.stars DESC, curtidas DESC, r.created_at DESC'
      : 'r.created_at DESC';
    const linhas = await db.all(
      `SELECT r.*, u.name AS autor_nome,
              (SELECT COUNT(*) FROM review_votes v WHERE v.target_type='review' AND v.target_id=r.id AND v.value=1) AS curtidas
         FROM reviews r JOIN users u ON u.id = r.user_id
        WHERE r.status='active'
        ORDER BY ${ordenacao}
        LIMIT ? OFFSET ?`,
      [limite, (pagina - 1) * limite]
    );
    const ids = linhas.map((l) => l.id);
    const v = await votos(db, 'review', ids, userId);
    const resp = await respostasDe(db, ids, userId);
    res.json({
      resumo: await resumo(db),
      ordem,
      pagina,
      paginas: Math.max(1, Math.ceil(total / limite)),
      total,
      itens: linhas.map((l) => ({
        id: l.id,
        autor: autor({ name: l.autor_nome }),
        estrelas: Number(l.stars),
        comentario: l.comment,
        criado_em: l.created_at,
        editado_em: l.updated_at !== l.created_at ? l.updated_at : null,
        minha: !!userId && l.user_id === userId,
        respostas: resp[l.id] || [],
        ...v[l.id]
      }))
    });
  }));

  app.get('/api/reviews/mine', auth.required, wrap(async (req, res) => {
    const r = await db.get('SELECT * FROM reviews WHERE user_id=?', [req.user.id]);
    res.json({
      avaliacao: r ? { id: r.id, estrelas: Number(r.stars), comentario: r.comment, status: r.status, criado_em: r.created_at, editado_em: r.updated_at } : null
    });
  }));

  // ---------- escrever a própria avaliação ----------
  app.post('/api/reviews', auth.required, wrap(async (req, res) => {
    const estrelas = lerEstrelas(req.body?.estrelas ?? req.body?.stars);
    const comentario = lerTexto(req.body?.comentario ?? req.body?.comment, MAX_COMENTARIO, 'O comentário');
    const atual = await db.get('SELECT * FROM reviews WHERE user_id=?', [req.user.id]);
    if (atual && atual.status === 'removed') throw new HttpError(403, 'Sua avaliação foi removida pela moderação e não pode ser reenviada.');
    if (atual) {
      await db.run('UPDATE reviews SET stars=?, comment=?, updated_at=? WHERE id=? AND user_id=?', [estrelas, comentario, now(), atual.id, req.user.id]);
    } else {
      await db.run('INSERT INTO reviews(id,user_id,stars,comment,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        [uid(), req.user.id, estrelas, comentario, 'active', now(), now()]);
    }
    const r = await db.get('SELECT * FROM reviews WHERE user_id=?', [req.user.id]);
    res.json({
      ok: true,
      novo: !atual,
      avaliacao: { id: r.id, estrelas: Number(r.stars), comentario: r.comment, criado_em: r.created_at, editado_em: r.updated_at },
      resumo: await resumo(db)
    });
  }));

  app.delete('/api/reviews/mine', auth.required, wrap(async (req, res) => {
    const r = await db.get('SELECT * FROM reviews WHERE user_id=?', [req.user.id]);
    if (!r) throw new HttpError(404, 'Você ainda não avaliou o site.');
    await db.run('DELETE FROM review_votes WHERE target_type=? AND target_id=?', ['review', r.id]);
    await db.run('DELETE FROM review_replies WHERE review_id=?', [r.id]);
    await db.run('DELETE FROM reviews WHERE id=? AND user_id=?', [r.id, req.user.id]);
    res.json({ ok: true, resumo: await resumo(db) });
  }));

  // ---------- respostas ----------
  app.post('/api/reviews/:id/replies', auth.required, wrap(async (req, res) => {
    const texto = lerTexto(req.body?.texto ?? req.body?.body, MAX_RESPOSTA, 'A resposta');
    if (!texto) throw new HttpError(400, 'Escreva a resposta.');
    const alvo = await db.get("SELECT * FROM reviews WHERE id=? AND status='active'", [req.params.id]);
    if (!alvo) throw new HttpError(404, 'Avaliação não encontrada.');
    const ehDev = req.user.role === 'owner' || req.user.role === 'admin';
    const id = uid();
    await db.run('INSERT INTO review_replies(id,review_id,user_id,body,is_dev,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      [id, alvo.id, req.user.id, texto, ehDev ? 1 : 0, 'active', now(), now()]);
    res.json({ ok: true, resposta: { id, autor: autor(req.user), doDesenvolvedor: ehDev, texto, criado_em: now(), gostei: 0, naoGostei: 0, meuVoto: 0, minha: true } });
  }));

  app.delete('/api/replies/:id', auth.required, wrap(async (req, res) => {
    const r = await db.get('SELECT * FROM review_replies WHERE id=?', [req.params.id]);
    if (!r) throw new HttpError(404, 'Resposta não encontrada.');
    const ehAdmin = req.user.role === 'owner' || req.user.role === 'admin';
    if (r.user_id !== req.user.id && !ehAdmin) throw new HttpError(403, 'Esta resposta não é sua.');
    await db.run('DELETE FROM review_votes WHERE target_type=? AND target_id=?', ['reply', r.id]);
    await db.run('DELETE FROM review_replies WHERE id=?', [r.id]);
    res.json({ ok: true });
  }));

  // ---------- gostei / não gostei ----------
  const votar = (tipo, tabela) => wrap(async (req, res) => {
    const valor = Number(req.body?.valor ?? req.body?.value);
    if (![1, -1, 0].includes(valor)) throw new HttpError(400, 'Voto inválido (use 1 para gostei, -1 para não gostei, 0 para desfazer).');
    const alvo = await db.get(`SELECT * FROM ${tabela} WHERE id=? AND status='active'`, [req.params.id]);
    if (!alvo) throw new HttpError(404, 'Conteúdo não encontrado.');
    if (alvo.user_id === req.user.id) throw new HttpError(400, 'Você não pode votar no que escreveu.');
    await db.run('DELETE FROM review_votes WHERE target_type=? AND target_id=? AND user_id=?', [tipo, alvo.id, req.user.id]);
    if (valor !== 0) {
      await db.run('INSERT INTO review_votes(id,target_type,target_id,user_id,value,created_at) VALUES(?,?,?,?,?,?)',
        [uid(), tipo, alvo.id, req.user.id, valor, now()]);
    }
    const v = (await votos(db, tipo, [alvo.id], req.user.id))[alvo.id];
    res.json({ ok: true, ...v });
  });
  app.post('/api/reviews/:id/vote', auth.required, votar('review', 'reviews'));
  app.post('/api/replies/:id/vote', auth.required, votar('reply', 'review_replies'));

  // ---------- denúncias ----------
  const denunciar = (tipo, tabela) => wrap(async (req, res) => {
    const motivo = lerTexto(req.body?.motivo ?? req.body?.reason, 300, 'O motivo');
    const alvo = await db.get(`SELECT * FROM ${tabela} WHERE id=? AND status='active'`, [req.params.id]);
    if (!alvo) throw new HttpError(404, 'Conteúdo não encontrado.');
    const jaTem = await db.get('SELECT id FROM review_reports WHERE target_type=? AND target_id=? AND user_id=?', [tipo, alvo.id, req.user.id]);
    if (jaTem) return res.json({ ok: true, repetida: true });
    await db.run('INSERT INTO review_reports(id,target_type,target_id,user_id,reason,status,created_at) VALUES(?,?,?,?,?,?,?)',
      [uid(), tipo, alvo.id, req.user.id, motivo, 'open', now()]);
    res.json({ ok: true });
  });
  app.post('/api/reviews/:id/report', auth.required, denunciar('review', 'reviews'));
  app.post('/api/replies/:id/report', auth.required, denunciar('reply', 'review_replies'));

  // ---------- moderação (administradores) ----------
  app.get('/api/admin/reviews/reports', ...auth.admin, wrap(async (req, res) => {
    const linhas = await db.all(
      `SELECT d.*, u.name AS quem_nome, u.email AS quem_email
         FROM review_reports d JOIN users u ON u.id = d.user_id
        WHERE d.status='open' ORDER BY d.created_at DESC LIMIT 100`
    );
    const itens = [];
    for (const d of linhas) {
      const alvo = d.target_type === 'review'
        ? await db.get('SELECT r.id, r.stars, r.comment AS texto, r.status, u.name AS autor FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.id=?', [d.target_id])
        : await db.get('SELECT p.id, p.body AS texto, p.status, u.name AS autor FROM review_replies p JOIN users u ON u.id=p.user_id WHERE p.id=?', [d.target_id]);
      itens.push({ id: d.id, tipo: d.target_type, alvo_id: d.target_id, motivo: d.reason, criado_em: d.created_at, denunciante: d.quem_nome || d.quem_email, alvo });
    }
    res.json({ itens });
  }));

  const moderar = (tipo, tabela) => wrap(async (req, res) => {
    const remover = req.body?.remover !== false;
    const alvo = await db.get(`SELECT * FROM ${tabela} WHERE id=?`, [req.params.id]);
    if (!alvo) throw new HttpError(404, 'Conteúdo não encontrado.');
    const motivo = lerTexto(req.body?.motivo, 300, 'O motivo');
    if (tabela === 'reviews') {
      await db.run('UPDATE reviews SET status=?, moderated_by=?, moderated_reason=?, updated_at=? WHERE id=?',
        [remover ? 'removed' : 'active', req.user.id, motivo, now(), alvo.id]);
    } else {
      await db.run('UPDATE review_replies SET status=?, moderated_by=?, updated_at=? WHERE id=?',
        [remover ? 'removed' : 'active', req.user.id, now(), alvo.id]);
    }
    await db.run("UPDATE review_reports SET status='handled' WHERE target_type=? AND target_id=?", [tipo, alvo.id]);
    await db.run('INSERT INTO audit(id, actor_id, actor_email, action, target, detail, created_at) VALUES(?,?,?,?,?,?,?)',
      [uid(), req.user.id, req.user.email, remover ? 'review.remove' : 'review.restore', alvo.id, motivo || '(sem motivo)', now()]);
    res.json({ ok: true, resumo: await resumo(db) });
  });
  app.post('/api/admin/reviews/:id/moderate', ...auth.admin, moderar('review', 'reviews'));
  app.post('/api/admin/replies/:id/moderate', ...auth.admin, moderar('reply', 'review_replies'));
}
