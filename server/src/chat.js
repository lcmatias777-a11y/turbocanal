// Conversas entre administradores.
//
// Três tipos: "geral" (todo administrador entra sozinho), "dm" (um a um) e
// "grupo" (criado por alguém; se quem cria não é o administrador principal, o
// grupo só nasce depois do Sim dele, via pedidos.js).
//
// Fixar é por pessoa: o que você arrasta para "Principais" é seu, não muda o
// que os outros veem. Mensagem some para ninguém: apagar é só do autor ou do
// administrador principal, e fica na auditoria.

import { HttpError, uid, now, audit } from './util.js';
import { notificar } from './notify.js';

const MAX_MSG = 2000;
const GERAL = 'conv-geral-admins';

const txt = (v, max = MAX_MSG) => String(v ?? '').trim().slice(0, max);

async function ehAdmin(db, userId) {
  const u = await db.get('SELECT role FROM users WHERE id=?', [userId]);
  return ['owner', 'admin'].includes(u?.role);
}

let ultimaSync = 0;

/** Garante que a conversa geral existe e que todo administrador está nela.
 *  A aba de chats recarrega a cada 8s; sem este freio isso viraria escrita no
 *  banco a cada 8 segundos para sempre. Roda no máximo uma vez por minuto, ou
 *  na hora quando o pedido vem de quem ainda não está na conversa. */
export async function sincronizarGeral(db, { forcar = false } = {}) {
  if (!forcar && Date.now() - ultimaSync < 60000) return GERAL;
  ultimaSync = Date.now();
  const j = await db.get('SELECT id FROM conversas WHERE id=?', [GERAL]);
  if (!j) {
    await db.run('INSERT INTO conversas(id,tipo,nome,criado_por,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      [GERAL, 'geral', 'Todos os administradores', null, now(), now()]);
  }
  const admins = await db.all("SELECT id FROM users WHERE role IN ('owner','admin')");
  for (const a of admins) {
    await db.run('INSERT INTO conversa_membros(conversa_id,user_id,fixado,ordem,lido_em,entrou_em) VALUES(?,?,?,?,?,?) ON CONFLICT(conversa_id,user_id) DO NOTHING',
      [GERAL, a.id, 1, 0, '', now()]);
  }
  // quem deixou de ser administrador sai da conversa geral
  await db.run(`DELETE FROM conversa_membros WHERE conversa_id=? AND user_id NOT IN (SELECT id FROM users WHERE role IN ('owner','admin'))`, [GERAL]);
  return GERAL;
}

/** Conversa de um a um: acha a que já existe ou cria. Não precisa de aprovação. */
export async function acharOuCriarDm(db, a, b) {
  if (a === b) throw new HttpError(400, 'Não dá para abrir uma conversa com você mesmo.');
  if (!(await ehAdmin(db, a)) || !(await ehAdmin(db, b))) throw new HttpError(403, 'O chat é só entre administradores.');
  const achada = await db.get(
    `SELECT c.id FROM conversas c
      JOIN conversa_membros m1 ON m1.conversa_id=c.id AND m1.user_id=?
      JOIN conversa_membros m2 ON m2.conversa_id=c.id AND m2.user_id=?
     WHERE c.tipo='dm' LIMIT 1`, [a, b]);
  if (achada) return { id: achada.id, nova: false };
  const id = uid();
  await db.run('INSERT INTO conversas(id,tipo,nome,criado_por,created_at,updated_at) VALUES(?,?,?,?,?,?)', [id, 'dm', '', a, now(), now()]);
  for (const u of [a, b]) {
    await db.run('INSERT INTO conversa_membros(conversa_id,user_id,fixado,ordem,lido_em,entrou_em) VALUES(?,?,?,?,?,?)', [id, u, 0, 0, '', now()]);
  }
  return { id, nova: true };
}

/** Cria o grupo de verdade (chamado pelo pedidos.js depois do Sim, ou direto pelo dono). */
export async function criarGrupo(db, criadorId, nome, membros) {
  const id = uid();
  const todos = [...new Set([criadorId, ...membros])];
  await db.run('INSERT INTO conversas(id,tipo,nome,criado_por,created_at,updated_at) VALUES(?,?,?,?,?,?)', [id, 'grupo', txt(nome, 60), criadorId, now(), now()]);
  for (const u of todos) {
    await db.run('INSERT INTO conversa_membros(conversa_id,user_id,fixado,ordem,lido_em,entrou_em) VALUES(?,?,?,?,?,?) ON CONFLICT(conversa_id,user_id) DO NOTHING',
      [id, u, 0, 0, '', now()]);
  }
  await db.run('INSERT INTO mensagens(id,conversa_id,user_id,texto,sistema,created_at) VALUES(?,?,?,?,?,?)',
    [uid(), id, criadorId, `Grupo "${txt(nome, 60)}" criado.`, 1, now()]);
  for (const u of todos.filter((x) => x !== criadorId)) {
    await notificar(db, u, 'mensagem_chat', `Você entrou no grupo "${txt(nome, 60)}"`, { link: '#/admin/chats', dados: { conversa: id } });
  }
  return { id, nome };
}

export function chatRoutes(app, db, auth) {
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  const souMembro = async (convId, userId) =>
    !!(await db.get('SELECT 1 AS x FROM conversa_membros WHERE conversa_id=? AND user_id=?', [convId, userId]));

  async function montarLista(userId) {
    const jaEstou = await db.get('SELECT 1 AS x FROM conversa_membros WHERE conversa_id=? AND user_id=?', [GERAL, userId]);
    await sincronizarGeral(db, { forcar: !jaEstou });
    const rows = await db.all(
      `SELECT c.*, m.fixado, m.ordem, m.lido_em
         FROM conversas c JOIN conversa_membros m ON m.conversa_id=c.id
        WHERE m.user_id=? ORDER BY c.updated_at DESC`, [userId]);
    const out = [];
    for (const c of rows) {
      const membros = await db.all(
        'SELECT u.id,u.email,u.name,u.role FROM conversa_membros m JOIN users u ON u.id=m.user_id WHERE m.conversa_id=?', [c.id]);
      const ultima = await db.get('SELECT texto, created_at, user_id FROM mensagens WHERE conversa_id=? ORDER BY created_at DESC LIMIT 1', [c.id]);
      const naoLidas = (await db.get(
        'SELECT COUNT(*)::int AS n FROM mensagens WHERE conversa_id=? AND user_id<>? AND created_at > ?',
        [c.id, userId, c.lido_em || ''])).n;
      const outro = c.tipo === 'dm' ? membros.find((m) => m.id !== userId) : null;
      out.push({
        id: c.id, tipo: c.tipo,
        nome: c.tipo === 'dm' ? (outro?.name || outro?.email || 'Conversa') : c.nome,
        subtitulo: c.tipo === 'dm' ? (outro?.email || '') : `${membros.length} participante${membros.length === 1 ? '' : 's'}`,
        membros: membros.map((m) => ({ id: m.id, email: m.email, nome: m.name || '', papel: m.role })),
        fixado: !!c.fixado, ordem: c.ordem,
        ultima: ultima ? { texto: ultima.texto, quando: ultima.created_at, minha: ultima.user_id === userId } : null,
        naoLidas, atualizado_em: c.updated_at
      });
    }
    out.sort((a, b) => (b.fixado - a.fixado) || (a.fixado ? a.ordem - b.ordem : 0) || String(b.atualizado_em).localeCompare(String(a.atualizado_em)));
    return out;
  }

  app.get('/api/admin/chats', ...auth.admin, wrap(async (req, res) => {
    const itens = await montarLista(req.user.id);
    res.json({ itens, naoLidas: itens.reduce((a, c) => a + c.naoLidas, 0), eu: req.user.id, sou_dono: req.user.role === 'owner' });
  }));

  // Com quem dá para conversar (todo administrador, menos eu)
  app.get('/api/admin/chats/pessoas', ...auth.admin, wrap(async (req, res) => {
    const rows = await db.all("SELECT id,email,name,role FROM users WHERE role IN ('owner','admin') AND id<>? ORDER BY role DESC, email", [req.user.id]);
    res.json({ itens: rows.map((r) => ({ id: r.id, email: r.email, nome: r.name || '', papel: r.role })) });
  }));

  app.post('/api/admin/chats/dm', ...auth.admin, wrap(async (req, res) => {
    const r = await acharOuCriarDm(db, req.user.id, String(req.body?.com || ''));
    res.json({ ok: true, conversa: r.id, nova: r.nova });
  }));

  // Criar grupo: o principal cria direto; admin comum manda pedido
  app.post('/api/admin/chats/grupo', ...auth.admin, wrap(async (req, res) => {
    const { pedirOuFazer } = await import('./pedidos.js');
    const r = await pedirOuFazer(db, req.user, 'criar_grupo', { nome: req.body?.nome, membros: req.body?.membros, motivo: req.body?.motivo });
    res.status(r.executado ? 200 : 202).json({ ok: true, ...r });
  }));

  app.get('/api/admin/chats/:id/mensagens', ...auth.admin, wrap(async (req, res) => {
    if (!(await souMembro(req.params.id, req.user.id))) throw new HttpError(403, 'Você não participa desta conversa.');
    const limite = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 60));
    const rows = await db.all(
      `SELECT m.*, u.name, u.email, u.role FROM mensagens m JOIN users u ON u.id=m.user_id
        WHERE m.conversa_id=? ORDER BY m.created_at DESC LIMIT ${limite}`, [req.params.id]);
    await db.run('UPDATE conversa_membros SET lido_em=? WHERE conversa_id=? AND user_id=?', [now(), req.params.id, req.user.id]);
    res.json({
      itens: rows.reverse().map((m) => ({
        id: m.id, texto: m.texto, sistema: !!m.sistema, quando: m.created_at,
        autor: m.name || m.email, autor_id: m.user_id, papel: m.role, minha: m.user_id === req.user.id
      }))
    });
  }));

  app.post('/api/admin/chats/:id/mensagens', ...auth.admin, wrap(async (req, res) => {
    if (!(await souMembro(req.params.id, req.user.id))) throw new HttpError(403, 'Você não participa desta conversa.');
    const texto = txt(req.body?.texto);
    if (!texto) throw new HttpError(400, 'Escreva alguma coisa.');
    const id = uid();
    await db.run('INSERT INTO mensagens(id,conversa_id,user_id,texto,sistema,created_at) VALUES(?,?,?,?,?,?)', [id, req.params.id, req.user.id, texto, 0, now()]);
    await db.run('UPDATE conversas SET updated_at=? WHERE id=?', [now(), req.params.id]);
    const outros = await db.all('SELECT user_id FROM conversa_membros WHERE conversa_id=? AND user_id<>?', [req.params.id, req.user.id]);
    const conv = await db.get('SELECT tipo,nome FROM conversas WHERE id=?', [req.params.id]);
    const onde = conv.tipo === 'dm' ? '' : ` em ${conv.nome || 'um grupo'}`;
    for (const o of outros) {
      await notificar(db, o.user_id, 'mensagem_chat', `${req.user.name || req.user.email} mandou mensagem${onde}`, {
        corpo: texto.slice(0, 180), link: '#/admin/chats', dados: { conversa: req.params.id }
      });
    }
    res.json({ ok: true, id });
  }));

  app.delete('/api/admin/chats/:id/mensagens/:msg', ...auth.admin, wrap(async (req, res) => {
    const m = await db.get('SELECT * FROM mensagens WHERE id=? AND conversa_id=?', [req.params.msg, req.params.id]);
    if (!m) throw new HttpError(404, 'Mensagem não encontrada.');
    if (m.user_id !== req.user.id && req.user.role !== 'owner') throw new HttpError(403, 'Essa mensagem não é sua.');
    await db.run('DELETE FROM mensagens WHERE id=?', [m.id]);
    await audit(db, req.user, 'chat.mensagem_apagada', m.id, `${m.user_id === req.user.id ? 'pelo autor' : 'pelo administrador principal'} · ${String(m.texto).slice(0, 150)}`);
    res.json({ ok: true });
  }));

  // Fixar / desfixar (é o arrastar para "Principais"): vale só para quem fez
  app.post('/api/admin/chats/:id/fixar', ...auth.admin, wrap(async (req, res) => {
    if (!(await souMembro(req.params.id, req.user.id))) throw new HttpError(403, 'Você não participa desta conversa.');
    const fixado = req.body?.fixado === false ? 0 : 1;
    const ordem = Number.isInteger(req.body?.ordem) ? Math.max(0, Math.min(99, req.body.ordem)) : 0;
    await db.run('UPDATE conversa_membros SET fixado=?, ordem=? WHERE conversa_id=? AND user_id=?', [fixado, ordem, req.params.id, req.user.id]);
    res.json({ ok: true, fixado: !!fixado, ordem });
  }));

  // ---------- Ligação de voz entre administradores ----------
  // O servidor só entrega recado de um navegador para o outro (oferta, resposta e
  // candidatos de rede). O ÁUDIO NÃO PASSA AQUI: ele vai direto de um computador
  // para o outro (WebRTC). Por isso não custa nada e nada é gravado.
  const TIPOS_SINAL = ['chamando', 'oferta', 'resposta', 'ice', 'aceitou', 'recusou', 'desligou', 'falhou'];
  const VALIDADE_SINAL = 120; // segundos

  app.post('/api/admin/chats/:id/sinal', ...auth.admin, wrap(async (req, res) => {
    if (!(await souMembro(req.params.id, req.user.id))) throw new HttpError(403, 'Você não participa desta conversa.');
    const tipo = String(req.body?.tipo || '');
    if (!TIPOS_SINAL.includes(tipo)) throw new HttpError(400, 'Tipo de sinal inválido.');
    const para = String(req.body?.para || '');
    if (!(await souMembro(req.params.id, para))) throw new HttpError(400, 'Essa pessoa não participa desta conversa.');
    // Guarda também QUAL aba mandou e, quando houver, para qual aba vai. Sem isso,
    // com duas abas abertas uma consome os recados da outra e a ligação quebra.
    const corpo = { ...(req.body?.dados ?? {}), _de: String(req.body?.cliente || '').slice(0, 40), _para: String(req.body?.paraCliente || '').slice(0, 40) };
    const dados = JSON.stringify(corpo).slice(0, 20000);
    await db.run('INSERT INTO sinais(id,conversa_id,de_user,para_user,tipo,dados,created_at) VALUES(?,?,?,?,?,?,?)',
      [uid(), req.params.id, req.user.id, para, tipo, dados, now()]);
    // limpeza: sinal velho não serve para nada
    await db.run('DELETE FROM sinais WHERE created_at < ?', [new Date(Date.now() - VALIDADE_SINAL * 1000).toISOString()]);
    res.json({ ok: true });
  }));

  // Recados endereçados a mim (em qualquer conversa). Lidos uma vez e apagados.
  app.get('/api/admin/chats/sinais', ...auth.admin, wrap(async (req, res) => {
    const cliente = String(req.query.cliente || '').slice(0, 40);
    const todos = await db.all(
      `SELECT s.*, u.name, u.email FROM sinais s JOIN users u ON u.id=s.de_user
        WHERE s.para_user=? AND s.created_at >= ? ORDER BY s.created_at`,
      [req.user.id, new Date(Date.now() - VALIDADE_SINAL * 1000).toISOString()]);
    // recado sem destinatário de aba (o "está te ligando") vai para qualquer aba;
    // o resto só para a aba que está na ligação.
    const rows = todos.filter((r) => {
      let p = '';
      try { p = JSON.parse(r.dados)?._para || ''; } catch {}
      return !p || p === cliente;
    });
    if (rows.length) await db.run(`DELETE FROM sinais WHERE id IN (${rows.map(() => '?').join(',')})`, rows.map((r) => r.id));
    res.json({
      itens: rows.map((r) => ({
        id: r.id, conversa: r.conversa_id, de: r.de_user, deNome: r.name || r.email,
        tipo: r.tipo, dados: (() => { try { return JSON.parse(r.dados); } catch { return {}; } })(),
        deCliente: (() => { try { return JSON.parse(r.dados)?._de || ''; } catch { return ''; } })(), quando: r.created_at
      }))
    });
  }));

  // Só para saber se chegou coisa nova, sem baixar a lista toda
  app.get('/api/admin/chats/novidades', ...auth.admin, wrap(async (req, res) => {
    const r = await db.get(
      `SELECT COUNT(*)::int AS n FROM mensagens m
         JOIN conversa_membros cm ON cm.conversa_id=m.conversa_id AND cm.user_id=?
        WHERE m.user_id<>? AND m.created_at > cm.lido_em`, [req.user.id, req.user.id]);
    res.json({ naoLidas: r.n });
  }));
}
