// Enquetes entre administradores.
//
// Quem abre é o administrador principal. Os outros administradores votam.
// Dá para abrir uma enquete a partir de um pedido que está na fila: aí a
// enquete vira a consulta antes do Sim ou do Não, e o pedido continua sendo
// decidido por ele, não pela maioria. A enquete informa, não manda: quem
// decide pedido é o principal, e misturar as duas coisas seria entregar o
// controle sem dizer que entregou.

import { HttpError, uid, now, audit } from './util.js';
import { corDoId, inicialDe } from './perfil.js';

export const MIN_OPCOES = 2;
export const MAX_OPCOES = 8;

export function lerOpcoes(v) {
  const lista = (Array.isArray(v) ? v : String(v || '').split('\n'))
    .map((x) => String(x).trim().slice(0, 80))
    .filter(Boolean);
  const unicas = [...new Set(lista)];
  if (unicas.length < MIN_OPCOES) throw new HttpError(400, `Escreva pelo menos ${MIN_OPCOES} opções diferentes.`);
  if (unicas.length > MAX_OPCOES) throw new HttpError(400, `No máximo ${MAX_OPCOES} opções.`);
  return unicas;
}

/** Apuração: cada administrador vota uma vez, e as porcentagens fecham em
 *  100 sobre quem votou, nunca sobre quem poderia ter votado. */
export function apurar(opcoes, votos) {
  const total = votos.length;
  const contagem = opcoes.map((nome, i) => ({ i, nome, votos: votos.filter((v) => Number(v.opcao) === i).length }));
  if (!total) return { total: 0, opcoes: contagem.map((c) => ({ ...c, percentual: 0 })) };
  const comPiso = contagem.map((c) => {
    const exato = (c.votos / total) * 100;
    return { ...c, piso: Math.floor(exato), resto: exato - Math.floor(exato) };
  });
  let sobra = 100 - comPiso.reduce((s, c) => s + c.piso, 0);
  const ordem = [...comPiso].sort((a, b) => b.resto - a.resto || b.votos - a.votos);
  const extra = new Set();
  for (const c of ordem) { if (sobra-- <= 0) break; extra.add(c.i); }
  return {
    total,
    opcoes: comPiso.map((c) => ({ i: c.i, nome: c.nome, votos: c.votos, percentual: c.piso + (extra.has(c.i) ? 1 : 0) }))
  };
}

export function enqueteRoutes(app, db, auth) {
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  const montar = async (e, userId, mostrarQuem) => {
    const votos = await db.all(
      `SELECT v.*, u.name AS nome, u.email, u.role, u.foto_url FROM enquete_votos v
         JOIN users u ON u.id=v.user_id WHERE v.enquete_id=? ORDER BY v.created_at`, [e.id]
    );
    const opcoes = JSON.parse(e.opcoes);
    const meu = votos.find((v) => v.user_id === userId);
    const aberta = e.status === 'aberta' && (!e.fecha_em || e.fecha_em > now());
    return {
      id: e.id, pergunta: e.pergunta, status: aberta ? 'aberta' : 'fechada',
      criada_em: e.created_at, fecha_em: e.fecha_em || null,
      pedido_id: e.pedido_id || null,
      meuVoto: meu ? Number(meu.opcao) : null,
      // Antes de votar, o resultado fica escondido: ver o placar muda o voto.
      // O administrador principal é exceção: a enquete é a consulta DELE, e
      // obrigá-lo a votar para ler o resultado não faria sentido.
      resultado: (meu || !aberta || mostrarQuem) ? apurar(opcoes, votos) : { total: votos.length, escondido: true, opcoes: opcoes.map((nome, i) => ({ i, nome })) },
      quemVotou: mostrarQuem
        ? votos.map((v) => ({
            opcao: Number(v.opcao), nome: v.nome || 'Alguém',
            foto: v.foto_url || null, inicial: inicialDe(v.nome, v.email), cor: corDoId(v.user_id)
          }))
        : undefined
    };
  };

  app.get('/api/admin/enquetes', ...auth.admin, wrap(async (req, res) => {
    const linhas = await db.all('SELECT * FROM enquetes ORDER BY (status=\'aberta\') DESC, created_at DESC LIMIT 40');
    const itens = [];
    for (const e of linhas) itens.push(await montar(e, req.user.id, req.user.role === 'owner'));
    const admins = Number((await db.get("SELECT COUNT(*) AS n FROM users WHERE role IN ('owner','admin')")).n);
    res.json({ itens, souDono: req.user.role === 'owner', administradores: admins });
  }));

  // Só o principal abre: enquete é consulta dele à equipe.
  app.post('/api/admin/enquetes', ...auth.owner, wrap(async (req, res) => {
    const pergunta = String(req.body?.pergunta || '').trim().slice(0, 300);
    if (!pergunta) throw new HttpError(400, 'Escreva a pergunta.');
    const opcoes = lerOpcoes(req.body?.opcoes);
    let pedidoId = null;
    if (req.body?.pedido_id) {
      const p = await db.get('SELECT id, status FROM pedidos_admin WHERE id=?', [req.body.pedido_id]);
      if (!p) throw new HttpError(404, 'Pedido não encontrado.');
      if (p.status !== 'pendente') throw new HttpError(409, 'Esse pedido já foi decidido.');
      pedidoId = p.id;
    }
    const dias = Math.min(30, Math.max(1, parseInt(req.body?.dias, 10) || 7));
    const id = uid();
    await db.run('INSERT INTO enquetes(id,criada_por,pergunta,opcoes,pedido_id,status,fecha_em,created_at) VALUES(?,?,?,?,?,?,?,?)',
      [id, req.user.id, pergunta, JSON.stringify(opcoes), pedidoId, 'aberta', new Date(Date.now() + dias * 86400e3).toISOString(), now()]);
    const { notificar } = await import('./notify.js');
    const admins = await db.all("SELECT id FROM users WHERE role='admin'");
    for (const a of admins) {
      await notificar(db, a.id, 'pedido_admin', 'Nova enquete para a equipe', {
        corpo: pergunta, link: '#/admin/enquetes', dados: { enquete: id }
      });
    }
    await audit(db, req.user, 'enquete.criar', id, pergunta);
    res.json({ ok: true, id, avisados: admins.length });
  }));

  app.post('/api/admin/enquetes/:id/votar', ...auth.admin, wrap(async (req, res) => {
    const e = await db.get('SELECT * FROM enquetes WHERE id=?', [req.params.id]);
    if (!e) throw new HttpError(404, 'Enquete não encontrada.');
    if (e.status !== 'aberta' || (e.fecha_em && e.fecha_em <= now())) throw new HttpError(409, 'Essa enquete já está fechada.');
    const opcoes = JSON.parse(e.opcoes);
    const op = parseInt(req.body?.opcao, 10);
    if (!Number.isInteger(op) || op < 0 || op >= opcoes.length) throw new HttpError(400, 'Opção inválida.');
    await db.run(`INSERT INTO enquete_votos(enquete_id,user_id,opcao,created_at) VALUES(?,?,?,?)
                  ON CONFLICT(enquete_id,user_id) DO UPDATE SET opcao=EXCLUDED.opcao, created_at=EXCLUDED.created_at`,
      [e.id, req.user.id, op, now()]);
    res.json({ ok: true, ...(await montar(await db.get('SELECT * FROM enquetes WHERE id=?', [e.id]), req.user.id, req.user.role === 'owner')) });
  }));

  app.post('/api/admin/enquetes/:id/fechar', ...auth.owner, wrap(async (req, res) => {
    const e = await db.get('SELECT * FROM enquetes WHERE id=?', [req.params.id]);
    if (!e) throw new HttpError(404, 'Enquete não encontrada.');
    await db.run("UPDATE enquetes SET status='fechada' WHERE id=?", [e.id]);
    await audit(db, req.user, 'enquete.fechar', e.id, e.pergunta);
    res.json({ ok: true });
  }));

  app.delete('/api/admin/enquetes/:id', ...auth.owner, wrap(async (req, res) => {
    await db.run('DELETE FROM enquete_votos WHERE enquete_id=?', [req.params.id]);
    await db.run('DELETE FROM enquetes WHERE id=?', [req.params.id]);
    await audit(db, req.user, 'enquete.apagar', req.params.id, '');
    res.json({ ok: true });
  }));
}
