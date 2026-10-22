// Postagens: duas áreas, mesma mecânica.
//
//   pública  — todo mundo que entrou no site lê, curte e comenta.
//   admin    — só administradores leem, curtem e comentam, e só ali o
//              comentário aceita imagem.
//
// Quem publica: o administrador principal publica direto. Administrador não
// principal PEDE, como tudo o mais. Editar e excluir seguem a mesma regra.
//
// O texto da área pública passa pelo mesmo filtro do bate-papo. O da área de
// administradores não passa: ali é gente de confiança, e filtrar a conversa
// interna só atrapalharia.

import { HttpError, uid, now, audit } from './util.js';
import { filtrar } from './filtro.js';
import { corDoId, inicialDe } from './perfil.js';

export const AREAS = ['publica', 'admin'];
export const MAX_IMAGEM = 700 * 1024;       // ~700 KB depois do redimensionamento
const TIPOS_IMG = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_TITULO = 140;
const MAX_TEXTO = 6000;
const MAX_COMENTARIO = 1500;

export function validarImagem(dataUrl, { obrigatoria = false } = {}) {
  const txt = String(dataUrl || '').trim();
  if (!txt) { if (obrigatoria) throw new HttpError(400, 'Escolha uma imagem.'); return null; }
  const m = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(txt);
  if (!m) throw new HttpError(400, 'Formato de imagem não reconhecido.');
  if (!TIPOS_IMG.includes(m[1].toLowerCase())) throw new HttpError(400, 'Use uma imagem JPG, PNG ou WebP.');
  const bytes = Math.floor((m[2].length * 3) / 4);
  if (bytes > MAX_IMAGEM) throw new HttpError(413, `Imagem grande demais (${Math.round(bytes / 1024)} KB). O limite é ${Math.round(MAX_IMAGEM / 1024)} KB.`);
  if (bytes < 60) throw new HttpError(400, 'Imagem vazia.');
  return txt;
}

export function lerArea(v) {
  const a = String(v || 'publica');
  if (!AREAS.includes(a)) throw new HttpError(400, 'Área inválida.');
  return a;
}

/** Valida e, na área pública, filtra o texto. Devolve o que será gravado. */
export function prepararPostagem(dados, area) {
  const titulo = String(dados?.titulo ?? '').trim().slice(0, MAX_TITULO);
  const texto = String(dados?.texto ?? '').trim().slice(0, MAX_TEXTO);
  if (!titulo) throw new HttpError(400, 'Dê um título à postagem.');
  if (!texto) throw new HttpError(400, 'Escreva o conteúdo da postagem.');
  const imagem = validarImagem(dados?.imagem);
  if (area === 'admin') return { titulo, texto, imagem, aviso: '' };
  const ft = filtrar(titulo), fx = filtrar(texto);
  if (ft.bloqueado || fx.bloqueado) {
    throw new HttpError(422, `Postagem não publicada: ${[...new Set([...ft.motivos, ...fx.motivos])].join(', ')}. Isso vale para todo mundo, inclusive para o administrador.`);
  }
  return { titulo: ft.texto, texto: fx.texto, imagem, aviso: ft.limpo && fx.limpo ? '' : 'Parte do texto foi escondida pelo filtro.' };
}

const pessoa = (r, prefixo = '') => ({
  id: r[prefixo + 'user_id'] || r.autor_id,
  nome: r.nome || 'Alguém',
  papel: r.role === 'owner' ? 'dono' : r.role === 'admin' ? 'equipe' : '',
  foto: r.foto_url || null,
  inicial: inicialDe(r.nome, r.email),
  cor: corDoId(r[prefixo + 'user_id'] || r.autor_id)
});

/* ---------- escrita, usada também pela fila de aprovação ---------- */

export async function criarPostagem(db, quem, { area, titulo, texto, imagem }) {
  const id = uid();
  await db.run('INSERT INTO postagens(id,autor_id,area,titulo,texto,imagem,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [id, quem.id, area, titulo, texto, imagem || null, 'ativa', now(), now()]);
  await audit(db, quem, 'postagem.criar', id, `${area}: ${titulo}`);
  return { id };
}

export async function editarPostagem(db, quem, id, { titulo, texto, imagem, trocarImagem }) {
  const p = await db.get('SELECT * FROM postagens WHERE id=?', [id]);
  if (!p) throw new HttpError(404, 'Postagem não encontrada.');
  await db.run('UPDATE postagens SET titulo=?,texto=?,imagem=?,updated_at=? WHERE id=?',
    [titulo, texto, trocarImagem ? (imagem || null) : p.imagem, now(), p.id]);
  await audit(db, quem, 'postagem.editar', p.id, titulo);
  return { id: p.id };
}

export async function excluirPostagem(db, quem, id, motivo = '') {
  const p = await db.get('SELECT * FROM postagens WHERE id=?', [id]);
  if (!p) throw new HttpError(404, 'Postagem não encontrada.');
  await db.run("UPDATE postagens SET status='excluida', updated_at=? WHERE id=?", [now(), p.id]);
  await audit(db, quem, 'postagem.excluir', p.id, motivo || p.titulo);
  return { ok: true };
}

export function postagemRoutes(app, db, auth) {
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
  const ehAdmin = (u) => ['owner', 'admin'].includes(u.role);
  const podeVer = (u, area) => area === 'publica' || ehAdmin(u);

  app.get('/api/postagens', auth.required, wrap(async (req, res) => {
    const area = lerArea(req.query.area);
    if (!podeVer(req.user, area)) throw new HttpError(403, 'Esta área é só para administradores.');
    const linhas = await db.all(
      `SELECT p.*, u.name AS nome, u.email, u.role, u.foto_url,
              (SELECT COUNT(*) FROM post_reacoes r WHERE r.post_id=p.id AND r.valor=1) AS curtidas,
              (SELECT COUNT(*) FROM post_reacoes r WHERE r.post_id=p.id AND r.valor=-1) AS descurtidas,
              (SELECT valor FROM post_reacoes r WHERE r.post_id=p.id AND r.user_id=?) AS minha,
              (SELECT COUNT(*) FROM post_comentarios c WHERE c.post_id=p.id AND c.status='ativo') AS comentarios
         FROM postagens p JOIN users u ON u.id=p.autor_id
        WHERE p.area=? AND p.status='ativa' ORDER BY p.created_at DESC LIMIT 60`,
      [req.user.id, area]
    );
    res.json({
      area,
      podePublicar: ehAdmin(req.user),
      souDono: req.user.role === 'owner',
      itens: linhas.map((p) => ({
        id: p.id, titulo: p.titulo, texto: p.texto, imagem: p.imagem || null,
        autor: pessoa(p), criado_em: p.created_at, editado_em: p.updated_at !== p.created_at ? p.updated_at : null,
        curtidas: Number(p.curtidas), descurtidas: Number(p.descurtidas),
        minhaReacao: p.minha === null || p.minha === undefined ? 0 : Number(p.minha),
        comentarios: Number(p.comentarios)
      }))
    });
  }));

  app.post('/api/postagens', ...auth.admin, wrap(async (req, res) => {
    const area = lerArea(req.body?.area);
    const dados = prepararPostagem(req.body, area);
    const { pedirOuFazer } = await import('./pedidos.js');
    const r = await pedirOuFazer(db, req.user, 'criar_postagem', { area, ...dados, motivo: req.body?.motivo });
    res.status(r.executado ? 200 : 202).json({ ok: true, ...r, aviso: dados.aviso });
  }));

  app.put('/api/postagens/:id', ...auth.admin, wrap(async (req, res) => {
    const p = await db.get('SELECT * FROM postagens WHERE id=? AND status=?', [req.params.id, 'ativa']);
    if (!p) throw new HttpError(404, 'Postagem não encontrada.');
    const dados = prepararPostagem({ ...p, ...req.body }, p.area);
    const { pedirOuFazer } = await import('./pedidos.js');
    const r = await pedirOuFazer(db, req.user, 'editar_postagem', {
      alvo_id: p.id, ...dados, trocarImagem: req.body?.imagem !== undefined, motivo: req.body?.motivo
    });
    res.status(r.executado ? 200 : 202).json({ ok: true, ...r, aviso: dados.aviso });
  }));

  app.delete('/api/postagens/:id', ...auth.admin, wrap(async (req, res) => {
    const { pedirOuFazer } = await import('./pedidos.js');
    const r = await pedirOuFazer(db, req.user, 'excluir_postagem', { alvo_id: req.params.id, motivo: req.body?.motivo });
    res.status(r.executado ? 200 : 202).json({ ok: true, ...r });
  }));

  // ---------- curtir e não curtir ----------
  app.post('/api/postagens/:id/reagir', auth.required, wrap(async (req, res) => {
    const p = await db.get('SELECT id, area FROM postagens WHERE id=? AND status=?', [req.params.id, 'ativa']);
    if (!p) throw new HttpError(404, 'Postagem não encontrada.');
    if (!podeVer(req.user, p.area)) throw new HttpError(403, 'Esta área é só para administradores.');
    const valor = Number(req.body?.valor);
    if (![1, -1].includes(valor)) throw new HttpError(400, 'Reação inválida.');
    const atual = await db.get('SELECT valor FROM post_reacoes WHERE post_id=? AND user_id=?', [p.id, req.user.id]);
    if (atual && Number(atual.valor) === valor) {
      await db.run('DELETE FROM post_reacoes WHERE post_id=? AND user_id=?', [p.id, req.user.id]); // clicar de novo desfaz
    } else {
      await db.run(`INSERT INTO post_reacoes(post_id,user_id,valor,created_at) VALUES(?,?,?,?)
                    ON CONFLICT(post_id,user_id) DO UPDATE SET valor=EXCLUDED.valor`, [p.id, req.user.id, valor, now()]);
    }
    const c = await db.get('SELECT COUNT(*) AS n FROM post_reacoes WHERE post_id=? AND valor=1', [p.id]);
    const d = await db.get('SELECT COUNT(*) AS n FROM post_reacoes WHERE post_id=? AND valor=-1', [p.id]);
    const minha = await db.get('SELECT valor FROM post_reacoes WHERE post_id=? AND user_id=?', [p.id, req.user.id]);
    res.json({ ok: true, curtidas: Number(c.n), descurtidas: Number(d.n), minhaReacao: minha ? Number(minha.valor) : 0 });
  }));

  // ---------- comentários ----------
  app.get('/api/postagens/:id/comentarios', auth.required, wrap(async (req, res) => {
    const p = await db.get('SELECT id, area FROM postagens WHERE id=? AND status=?', [req.params.id, 'ativa']);
    if (!p) throw new HttpError(404, 'Postagem não encontrada.');
    if (!podeVer(req.user, p.area)) throw new HttpError(403, 'Esta área é só para administradores.');
    const linhas = await db.all(
      `SELECT c.*, u.name AS nome, u.email, u.role, u.foto_url FROM post_comentarios c
         JOIN users u ON u.id=c.user_id
        WHERE c.post_id=? AND c.status='ativo' ORDER BY c.created_at`, [p.id]
    );
    res.json({
      area: p.area,
      aceitaImagem: p.area === 'admin',
      itens: linhas.map((c) => ({
        id: c.id, texto: c.texto, imagem: c.imagem || null,
        autor: pessoa(c), criado_em: c.created_at, meu: c.user_id === req.user.id
      }))
    });
  }));

  app.post('/api/postagens/:id/comentarios', auth.required, wrap(async (req, res) => {
    if (req.user.banido) throw new HttpError(403, 'Sua conta está impedida de comentar.');
    const p = await db.get('SELECT id, area, autor_id FROM postagens WHERE id=? AND status=?', [req.params.id, 'ativa']);
    if (!p) throw new HttpError(404, 'Postagem não encontrada.');
    if (!podeVer(req.user, p.area)) throw new HttpError(403, 'Esta área é só para administradores.');
    const bruto = String(req.body?.texto ?? '').trim();
    if (!bruto) throw new HttpError(400, 'Escreva alguma coisa.');
    if (bruto.length > MAX_COMENTARIO) throw new HttpError(400, `Comentário longo demais (máximo ${MAX_COMENTARIO} caracteres).`);

    // Imagem em comentário só na área de administradores, como o dono pediu.
    let imagem = null;
    if (req.body?.imagem) {
      if (p.area !== 'admin') throw new HttpError(400, 'Imagem em comentário só na área dos administradores.');
      if (!ehAdmin(req.user)) throw new HttpError(403, 'Só administradores mandam imagem aqui.');
      imagem = validarImagem(req.body.imagem);
    }

    let texto = bruto, aviso = '';
    if (p.area === 'publica') {
      const f = filtrar(bruto);
      if (f.bloqueado) {
        // Mesma anotação do bate-papo: guarda o motivo, nunca o texto barrado.
        // Sem isso o dono via na moderação só metade do que o filtro pegou.
        await db.run('INSERT INTO chat_bloqueios(id,user_id,motivos,onde,created_at) VALUES(?,?,?,?,?)',
          [uid(), req.user.id, f.motivos.join(', '), 'comentário', now()]);
        throw new HttpError(422, f.aviso, { motivos: f.motivos });
      }
      texto = f.texto; aviso = f.limpo ? '' : f.aviso;
    }
    const id = uid();
    await db.run('INSERT INTO post_comentarios(id,post_id,user_id,texto,imagem,status,created_at) VALUES(?,?,?,?,?,?,?)',
      [id, p.id, req.user.id, texto, imagem, 'ativo', now()]);
    // Avisa quem escreveu a postagem, menos quando é ela mesma comentando
    if (p.autor_id !== req.user.id) {
      const { notificar } = await import('./notify.js');
      await notificar(db, p.autor_id, 'resposta_recebida', 'Comentaram na sua postagem', {
        corpo: `${req.user.name || req.user.email} comentou.`, link: p.area === 'admin' ? '#/admin/postagens' : '#/postagens'
      });
    }
    const linha = await db.get(
      `SELECT c.*, u.name AS nome, u.email, u.role, u.foto_url FROM post_comentarios c JOIN users u ON u.id=c.user_id WHERE c.id=?`, [id]
    );
    res.json({ ok: true, aviso, comentario: { id: linha.id, texto: linha.texto, imagem: linha.imagem || null, autor: pessoa(linha), criado_em: linha.created_at, meu: true } });
  }));

  app.delete('/api/postagens/comentarios/:id', auth.required, wrap(async (req, res) => {
    const c = await db.get('SELECT * FROM post_comentarios WHERE id=? AND status=?', [req.params.id, 'ativo']);
    if (!c) throw new HttpError(404, 'Comentário não encontrado.');
    if (c.user_id === req.user.id || req.user.role === 'owner') {
      await db.run("UPDATE post_comentarios SET status='apagado' WHERE id=?", [c.id]);
      await audit(db, req.user, 'postagem.comentario_apagar', c.id, '');
      return res.json({ ok: true, executado: true });
    }
    if (!ehAdmin(req.user)) throw new HttpError(403, 'Você só apaga os seus próprios comentários.');
    const { pedirOuFazer } = await import('./pedidos.js');
    const r = await pedirOuFazer(db, req.user, 'apagar_comentario_postagem', { alvo_id: c.id, motivo: req.body?.motivo });
    res.status(r.executado ? 200 : 202).json({ ok: true, ...r });
  }));
}

export async function apagarComentarioPostagem(db, quem, id, motivo = '') {
  const c = await db.get('SELECT * FROM post_comentarios WHERE id=?', [id]);
  if (!c) throw new HttpError(404, 'Comentário não encontrado.');
  await db.run("UPDATE post_comentarios SET status='apagado' WHERE id=?", [c.id]);
  await audit(db, quem, 'postagem.comentario_apagar', c.id, motivo);
  return { ok: true };
}
