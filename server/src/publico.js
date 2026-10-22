// Bate-papo público: UM grupo só, para todo mundo que entrou no site.
//
// Regras que estão no código, não só na tela:
//   - não existe conversa privada aqui; é um canal único e aberto;
//   - toda mensagem passa pelo filtro ANTES de existir para alguém;
//   - mensagem bloqueada não é guardada em lugar nenhum (guardar o que foi
//     barrado seria criar um depósito do que eu não quero que exista);
//   - conta banida não escreve;
//   - limite de ritmo por pessoa, senão um só enche a tela.

import { HttpError, uid, now, audit } from './util.js';
import { filtrar, resumoFiltro } from './filtro.js';
import { corDoId, inicialDe } from './perfil.js';

export const LIMITE_TAMANHO = 400;
const JANELA_MS = 60 * 1000;
const MAX_POR_JANELA = 12;      // mensagens por minuto, por pessoa
const MIN_ENTRE_IGUAIS = 30;    // segundos para repetir a MESMA mensagem

const ritmo = new Map(); // userId -> [timestamps]

function podeFalar(userId) {
  const agora = Date.now();
  const antes = (ritmo.get(userId) || []).filter((t) => agora - t < JANELA_MS);
  if (antes.length >= MAX_POR_JANELA) {
    const espera = Math.ceil((JANELA_MS - (agora - antes[0])) / 1000);
    throw new HttpError(429, `Você está mandando mensagem rápido demais. Espere ${espera} segundo(s).`);
  }
  antes.push(agora);
  ritmo.set(userId, antes);
  if (ritmo.size > 20000) ritmo.clear();
}

const publico = (m) => ({
  id: m.id,
  autor: m.nome || 'Alguém',
  autor_id: m.user_id,
  papel: m.role === 'owner' ? 'dono' : m.role === 'admin' ? 'equipe' : '',
  foto: m.foto_url || null,
  inicial: inicialDe(m.nome, m.email),
  cor: corDoId(m.user_id),
  texto: m.texto,
  filtrada: !!m.filtrada,
  criado_em: m.created_at
});

export function publicoRoutes(app, db, auth) {
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  app.get('/api/chat-publico', auth.required, wrap(async (req, res) => {
    const linhas = await db.all(
      `SELECT c.*, u.name AS nome, u.email, u.role, u.foto_url FROM chat_publico c
         JOIN users u ON u.id = c.user_id
        WHERE c.status='ativo' ORDER BY c.created_at DESC LIMIT 80`
    );
    res.json({
      itens: linhas.reverse().map(publico),
      regras: 'Um canal só, para todo mundo. Link, telefone, e-mail, endereço, combinar por fora e compra não passam: a mensagem é barrada na hora.',
      sou: { id: req.user.id, papel: req.user.role }
    });
  }));

  app.post('/api/chat-publico', auth.required, wrap(async (req, res) => {
    if (req.user.banido) throw new HttpError(403, 'Sua conta está impedida de escrever no bate-papo.');
    const bruto = String(req.body?.texto ?? '').trim();
    if (!bruto) throw new HttpError(400, 'Escreva alguma coisa.');
    if (bruto.length > LIMITE_TAMANHO) throw new HttpError(400, `Mensagem longa demais (máximo ${LIMITE_TAMANHO} caracteres).`);
    podeFalar(req.user.id);

    const r = filtrar(bruto);
    if (r.bloqueado) {
      // Não guarda o texto. Guarda só que houve bloqueio e por quê, para o
      // dono conseguir ver padrão de abuso sem eu criar um arquivo do que foi
      // barrado.
      await db.run('INSERT INTO chat_bloqueios(id,user_id,motivos,onde,created_at) VALUES(?,?,?,?,?)',
        [uid(), req.user.id, r.motivos.join(', '), 'bate-papo', now()]);
      const quantos = Number((await db.get(
        "SELECT COUNT(*) AS n FROM chat_bloqueios WHERE user_id=? AND created_at > ?",
        [req.user.id, new Date(Date.now() - 24 * 3600e3).toISOString()]
      )).n);
      throw new HttpError(422, r.aviso, { motivos: r.motivos, bloqueios24h: quantos });
    }

    const id = uid();
    await db.run('INSERT INTO chat_publico(id,user_id,texto,filtrada,status,created_at) VALUES(?,?,?,?,?,?)',
      [id, req.user.id, r.texto, r.limpo ? 0 : 1, 'ativo', now()]);
    const linha = await db.get(
      `SELECT c.*, u.name AS nome, u.email, u.role, u.foto_url FROM chat_publico c JOIN users u ON u.id=c.user_id WHERE c.id=?`, [id]
    );
    res.json({ ok: true, mensagem: publico(linha), aviso: r.limpo ? '' : r.aviso });
  }));

  // Apagar: o próprio autor sempre pode. Administrador não principal pede.
  app.delete('/api/chat-publico/:id', auth.required, wrap(async (req, res) => {
    const m = await db.get('SELECT * FROM chat_publico WHERE id=?', [req.params.id]);
    if (!m || m.status !== 'ativo') throw new HttpError(404, 'Mensagem não encontrada.');
    if (m.user_id === req.user.id) {
      await db.run("UPDATE chat_publico SET status='apagada' WHERE id=?", [m.id]);
      return res.json({ ok: true, executado: true });
    }
    if (!['owner', 'admin'].includes(req.user.role)) throw new HttpError(403, 'Você só apaga as suas próprias mensagens.');
    const { pedirOuFazer } = await import('./pedidos.js');
    const r = await pedirOuFazer(db, req.user, 'apagar_mensagem_publica', { alvo_id: m.id, motivo: req.body?.motivo });
    res.status(r.executado ? 200 : 202).json({ ok: true, ...r });
  }));

  // Denunciar: qualquer pessoa marca, e o dono decide. Sem isso, moderar
  // dependeria de alguém estar olhando a tela na hora certa.
  app.post('/api/chat-publico/:id/denunciar', auth.required, wrap(async (req, res) => {
    const m = await db.get('SELECT id FROM chat_publico WHERE id=? AND status=?', [req.params.id, 'ativo']);
    if (!m) throw new HttpError(404, 'Mensagem não encontrada.');
    const jaTem = await db.get('SELECT id FROM chat_denuncias WHERE mensagem_id=? AND user_id=?', [m.id, req.user.id]);
    if (jaTem) return res.json({ ok: true, repetida: true });
    await db.run('INSERT INTO chat_denuncias(id,mensagem_id,user_id,motivo,created_at) VALUES(?,?,?,?,?)',
      [uid(), m.id, req.user.id, String(req.body?.motivo || '').slice(0, 200), now()]);
    const n = Number((await db.get('SELECT COUNT(*) AS n FROM chat_denuncias WHERE mensagem_id=?', [m.id])).n);
    // Três denúncias escondem a mensagem na hora e avisam o dono. Esperar
    // moderação humana com a mensagem no ar é o pior dos dois mundos.
    if (n >= 3) {
      await db.run("UPDATE chat_publico SET status='oculta' WHERE id=?", [m.id]);
      const { notificarDono } = await import('./notify.js');
      await notificarDono(db, 'seguranca', 'Mensagem do bate-papo escondida por denúncias', {
        corpo: `Uma mensagem recebeu ${n} denúncias e saiu do ar automaticamente. Veja na moderação do bate-papo.`,
        link: '#/admin/batepapo'
      });
    }
    res.json({ ok: true, denuncias: n, escondida: n >= 3 });
  }));

  // ---------- painel ----------
  app.get('/api/admin/chat-publico', ...auth.admin, wrap(async (req, res) => {
    const linhas = await db.all(
      `SELECT c.*, u.name AS nome, u.email, u.role, u.foto_url,
              (SELECT COUNT(*) FROM chat_denuncias d WHERE d.mensagem_id=c.id) AS denuncias
         FROM chat_publico c JOIN users u ON u.id=c.user_id
        ORDER BY c.created_at DESC LIMIT 120`
    );
    const bloqueios = await db.all(
      `SELECT b.motivos, b.onde, b.created_at, u.email FROM chat_bloqueios b JOIN users u ON u.id=b.user_id
        ORDER BY b.created_at DESC LIMIT 60`
    );
    const top = await db.all(
      `SELECT u.email, COUNT(*) AS n FROM chat_bloqueios b JOIN users u ON u.id=b.user_id
        WHERE b.created_at > ? GROUP BY u.email ORDER BY n DESC LIMIT 10`,
      [new Date(Date.now() - 7 * 24 * 3600e3).toISOString()]
    );
    res.json({
      itens: linhas.map((m) => ({ ...publico(m), email: m.email, status: m.status, denuncias: Number(m.denuncias) })),
      bloqueios,
      maisBarrados: top.map((t) => ({ email: t.email, vezes: Number(t.n) }))
    });
  }));

  app.post('/api/admin/chat-publico/:id/restaurar', ...auth.owner, wrap(async (req, res) => {
    await db.run("UPDATE chat_publico SET status='ativo' WHERE id=?", [req.params.id]);
    await db.run('DELETE FROM chat_denuncias WHERE mensagem_id=?', [req.params.id]);
    await audit(db, req.user, 'batepapo.restaurar', req.params.id, '');
    res.json({ ok: true });
  }));
}

/** Usada pela fila de aprovação quando um admin não principal pede para apagar. */
export async function apagarMensagemPublica(db, quem, id, motivo = '') {
  const m = await db.get('SELECT * FROM chat_publico WHERE id=?', [id]);
  if (!m) throw new HttpError(404, 'Mensagem não encontrada.');
  await db.run("UPDATE chat_publico SET status='apagada' WHERE id=?", [m.id]);
  await audit(db, quem, 'batepapo.apagar', m.id, motivo || '(sem motivo)');
  return { ok: true };
}

export { resumoFiltro };
