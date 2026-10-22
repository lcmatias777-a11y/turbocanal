// Aprovação do administrador principal.
//
// Pedido do dono: administrador comum NÃO executa sozinho nada que mexa na conta
// de outra pessoa. A ação vira um PEDIDO que chega ao administrador principal
// com Sim / Não / Conversar. O pedido guarda exatamente o que será feito, e a
// execução só acontece depois do Sim, no servidor, nunca no navegador.
//
// Isso é o que segura o estrago se uma conta de administrador for invadida:
// quem entrar numa conta de admin comum consegue PEDIR, não consegue FAZER.

import { HttpError, uid, now, audit } from './util.js';
import { grant } from './credits.js';
import { notificar, notificarDono } from './notify.js';

const txt = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const n = (v) => Number(v || 0).toLocaleString('pt-BR');

async function usuario(db, id) {
  const u = await db.get('SELECT id,email,name,role,plan_id,credits,banido FROM users WHERE id=?', [id]);
  if (!u) throw new HttpError(404, 'Usuário não encontrado.');
  return u;
}

/** Cada ação sabe se descrever e se executar. Ação fora desta lista não existe. */
export const ACOES = {
  creditos: {
    rotulo: 'Ajustar créditos',
    async validar(db, dados) {
      const delta = parseInt(dados.delta, 10);
      if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000000) throw new HttpError(400, 'Informe um ajuste de créditos válido (inteiro diferente de zero).');
      const alvo = await usuario(db, dados.alvo_user);
      if (alvo.role === 'owner') throw new HttpError(403, 'O administrador principal tem créditos ilimitados; não há o que ajustar.');
      return { delta, motivo: txt(dados.motivo) || 'Ajuste manual pelo administrador' };
    },
    descrever: (p, alvo) => `${p.payload.delta >= 0 ? 'aumentar' : 'diminuir'} ${n(Math.abs(p.payload.delta))} créditos de ${alvo}`,
    async executar(db, p, quem) {
      const bal = await grant(db, p.alvo_user, p.payload.delta, p.payload.motivo);
      await notificar(db, p.alvo_user, p.payload.delta >= 0 ? 'creditos_aumentados' : 'creditos_diminuidos',
        p.payload.delta >= 0 ? `Você recebeu ${n(p.payload.delta)} créditos` : `Foram retirados ${n(-p.payload.delta)} créditos`,
        { corpo: `Motivo: ${p.payload.motivo}.`, link: '#/historico', dados: { delta: p.payload.delta } });
      await audit(db, quem, 'admin.credits_adjust', p.alvo_user, `${p.payload.delta >= 0 ? '+' : ''}${p.payload.delta} (${p.payload.motivo})`);
      return { balance: bal };
    }
  },

  banir: {
    rotulo: 'Banir conta',
    async validar(db, dados) {
      const alvo = await usuario(db, dados.alvo_user);
      if (alvo.role === 'owner') throw new HttpError(403, 'O administrador principal não pode ser banido.');
      if (alvo.banido) throw new HttpError(409, 'Essa conta já está banida.');
      return { motivo: txt(dados.motivo) || 'Não informado' };
    },
    descrever: (p, alvo) => `banir a conta ${alvo}`,
    async executar(db, p, quem) {
      await db.run('UPDATE users SET banido=1, banido_motivo=? WHERE id=?', [p.payload.motivo, p.alvo_user]);
      await audit(db, quem, 'admin.ban', p.alvo_user, p.payload.motivo);
      return { banido: true };
    }
  },

  desbanir: {
    rotulo: 'Tirar o banimento',
    async validar(db, dados) {
      const alvo = await usuario(db, dados.alvo_user);
      if (!alvo.banido) throw new HttpError(409, 'Essa conta não está banida.');
      return { motivo: txt(dados.motivo) };
    },
    descrever: (p, alvo) => `tirar o banimento de ${alvo}`,
    async executar(db, p, quem) {
      await db.run("UPDATE users SET banido=0, banido_motivo='' WHERE id=?", [p.alvo_user]);
      await audit(db, quem, 'admin.unban', p.alvo_user, p.payload.motivo || '');
      return { banido: false };
    }
  },

  remover_comentario: {
    rotulo: 'Remover comentário',
    async validar(db, dados) {
      const tipo = ['avaliacao', 'comentario', 'resposta'].includes(dados.alvo_tipo) ? dados.alvo_tipo : null;
      if (!tipo) throw new HttpError(400, 'Tipo de conteúdo inválido.');
      const tabela = { avaliacao: 'reviews', comentario: 'site_comments', resposta: 'respostas' }[tipo];
      const alvo = await db.get(`SELECT id FROM ${tabela} WHERE id=?`, [dados.alvo_id]);
      if (!alvo) throw new HttpError(404, 'Conteúdo não encontrado.');
      return { alvo_tipo: tipo, motivo: txt(dados.motivo) || 'Moderação' };
    },
    descrever: (p) => `remover ${{ avaliacao: 'uma avaliação', comentario: 'um comentário', resposta: 'uma resposta' }[p.payload.alvo_tipo]}`,
    async executar(db, p, quem) {
      const tabela = { avaliacao: 'reviews', comentario: 'site_comments', resposta: 'respostas' }[p.payload.alvo_tipo];
      const alvo = await db.get(`SELECT * FROM ${tabela} WHERE id=?`, [p.alvo_id]);
      if (!alvo) throw new HttpError(404, 'Esse conteúdo já não existe mais.');
      await db.run(`UPDATE ${tabela} SET status='removed', updated_at=? WHERE id=?`, [now(), p.alvo_id]);
      await audit(db, quem, 'moderacao.remover', p.alvo_id, `${p.payload.alvo_tipo} · ${p.payload.motivo}`);
      return { removido: true };
    }
  },

  adicionar_admin: {
    rotulo: 'Adicionar administrador',
    async validar(db, dados) {
      const email = txt(dados.email, 190).toLowerCase();
      const alvo = await db.get('SELECT * FROM users WHERE email=?', [email]);
      if (!alvo) throw new HttpError(404, 'Não existe conta cadastrada com esse e-mail.');
      if (alvo.role === 'owner') throw new HttpError(400, 'Essa conta já é o administrador principal.');
      if (alvo.role === 'admin') throw new HttpError(409, 'Essa conta já é administradora.');
      return { email, alvo_user: alvo.id };
    },
    descrever: (p) => `tornar ${p.payload.email} administrador`,
    async executar(db, p, quem) {
      await db.run("UPDATE users SET role='admin' WHERE id=?", [p.payload.alvo_user]);
      await notificar(db, p.payload.alvo_user, 'virou_admin', 'Você agora é administrador do TurboCanal', {
        corpo: 'Você já pode abrir o painel. Ações que mexem na conta dos outros passam pela aprovação do administrador principal.',
        link: '#/admin'
      });
      await audit(db, quem, 'admin.promote', p.payload.email);
      return { promovido: true };
    }
  },

  remover_admin: {
    rotulo: 'Remover administrador',
    async validar(db, dados) {
      const alvo = await usuario(db, dados.alvo_user);
      if (alvo.role === 'owner') throw new HttpError(403, 'O administrador principal não pode ser rebaixado.');
      if (alvo.role !== 'admin') throw new HttpError(400, 'Essa conta não é administradora.');
      return { email: alvo.email };
    },
    descrever: (p, alvo) => `tirar o acesso de administrador de ${alvo}`,
    async executar(db, p, quem) {
      await db.run("UPDATE users SET role='user' WHERE id=?", [p.alvo_user]);
      await notificar(db, p.alvo_user, 'deixou_admin', 'Seu acesso de administrador foi removido', {
        corpo: 'Sua conta continua normal, só não abre mais o painel administrativo.', link: '#/dashboard'
      });
      await audit(db, quem, 'admin.demote', p.payload.email);
      return { removido: true };
    }
  },

  criar_grupo: {
    rotulo: 'Criar grupo de conversa',
    async validar(db, dados) {
      const nome = txt(dados.nome, 60);
      if (!nome) throw new HttpError(400, 'Dê um nome ao grupo.');
      const ids = Array.isArray(dados.membros) ? [...new Set(dados.membros.map((x) => String(x)))].slice(0, 20) : [];
      if (!ids.length) throw new HttpError(400, 'Escolha pelo menos uma pessoa para o grupo.');
      const rows = await db.all(`SELECT id,email,role FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
      if (rows.length !== ids.length) throw new HttpError(400, 'Alguma das contas escolhidas não existe.');
      if (rows.some((r) => !['owner', 'admin'].includes(r.role))) throw new HttpError(400, 'O chat é só entre administradores.');
      return { nome, membros: ids, emails: rows.map((r) => r.email) };
    },
    descrever: (p) => `criar o grupo "${p.payload.nome}" com ${p.payload.emails.join(' + ')}`,
    async executar(db, p, quem) {
      const { criarGrupo } = await import('./chat.js');
      const conv = await criarGrupo(db, p.pedido_por, p.payload.nome, p.payload.membros);
      await audit(db, quem, 'chat.grupo_criado', conv.id, p.payload.nome);
      return { conversa: conv.id };
    }
  }
};

/** O caminho único de toda ação administrativa sensível.
 *  Dono executa na hora. Admin comum cria um pedido e o dono decide. */
export async function pedirOuFazer(db, user, acao, dados = {}) {
  const def = ACOES[acao];
  if (!def) throw new HttpError(400, 'Ação administrativa desconhecida.');
  if (!['owner', 'admin'].includes(user.role)) throw new HttpError(403, 'Só administradores.');
  const payload = await def.validar(db, dados);
  const alvoUser = dados.alvo_user || payload.alvo_user || null;
  const alvoId = dados.alvo_id || null;

  if (user.role === 'owner') {
    const p = { id: uid(), acao, pedido_por: user.id, alvo_user: alvoUser, alvo_id: alvoId, payload };
    const resultado = await def.executar(db, p, user);
    return { executado: true, resultado };
  }

  const id = uid();
  await db.run(
    'INSERT INTO pedidos_admin(id,acao,pedido_por,alvo_user,alvo_id,payload,motivo,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [id, acao, user.id, alvoUser, alvoId, JSON.stringify(payload), txt(dados.motivo), 'pendente', now(), now()]
  );
  const alvoLabel = alvoUser ? (await db.get('SELECT email FROM users WHERE id=?', [alvoUser]))?.email || alvoUser : '';
  const frase = def.descrever({ payload, alvo_user: alvoUser, alvo_id: alvoId }, alvoLabel);
  await notificarDono(db, 'pedido_admin', `${user.email} quer ${frase}`, {
    corpo: `${payload.motivo || txt(dados.motivo) || 'Sem motivo informado.'} Abra o painel para responder Sim, Não ou conversar.`,
    link: '#/admin/pedidos',
    dados: { pedido: id, acao }
  });
  await audit(db, user, 'pedido.criado', id, frase);
  return { executado: false, pedido: id, frase };
}

export function pedidoRoutes(app, db, auth) {
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
  const monta = async (r) => {
    const payload = (() => { try { return JSON.parse(r.payload); } catch { return {}; } })();
    const quem = await db.get('SELECT email,name FROM users WHERE id=?', [r.pedido_por]);
    const alvo = r.alvo_user ? await db.get('SELECT email,name FROM users WHERE id=?', [r.alvo_user]) : null;
    return {
      id: r.id, acao: r.acao, rotulo: ACOES[r.acao]?.rotulo || r.acao,
      frase: ACOES[r.acao]?.descrever({ payload, alvo_user: r.alvo_user, alvo_id: r.alvo_id }, alvo?.email || '') || r.acao,
      pedido_por: quem?.email || r.pedido_por, pedido_por_id: r.pedido_por, pedido_por_nome: quem?.name || '',
      alvo: alvo?.email || null, motivo: r.motivo || payload.motivo || '',
      status: r.status, resposta: r.resposta, erro: r.erro, criado_em: r.created_at, decidido_em: r.updated_at
    };
  };

  // O dono vê tudo; o admin comum vê só os pedidos que ele mesmo fez.
  app.get('/api/admin/pedidos', ...auth.admin, wrap(async (req, res) => {
    const dono = req.user.role === 'owner';
    const rows = dono
      ? await db.all('SELECT * FROM pedidos_admin ORDER BY (status=\'pendente\') DESC, created_at DESC LIMIT 200')
      : await db.all('SELECT * FROM pedidos_admin WHERE pedido_por=? ORDER BY created_at DESC LIMIT 200', [req.user.id]);
    res.json({ itens: await Promise.all(rows.map(monta)), pendentes: (await db.get("SELECT COUNT(*)::int AS n FROM pedidos_admin WHERE status='pendente'")).n, sou_dono: dono });
  }));

  app.post('/api/admin/pedidos/:id/decidir', ...auth.owner, wrap(async (req, res) => {
    const p = await db.get('SELECT * FROM pedidos_admin WHERE id=?', [req.params.id]);
    if (!p) throw new HttpError(404, 'Pedido não encontrado.');
    if (p.status !== 'pendente') throw new HttpError(409, `Esse pedido já foi ${p.status === 'aprovado' ? 'aprovado' : 'recusado'}.`);
    const sim = req.body?.decisao === 'sim';
    const resposta = txt(req.body?.resposta, 400);
    if (!sim) {
      await db.run("UPDATE pedidos_admin SET status='recusado', decidido_por=?, resposta=?, updated_at=? WHERE id=?", [req.user.id, resposta, now(), p.id]);
      await notificar(db, p.pedido_por, 'pedido_decidido', 'Seu pedido foi recusado', {
        corpo: resposta || 'O administrador principal recusou sem comentário.', link: '#/admin/pedidos'
      });
      await audit(db, req.user, 'pedido.recusado', p.id, resposta);
      return res.json({ ok: true, status: 'recusado' });
    }
    const def = ACOES[p.acao];
    if (!def) throw new HttpError(400, 'Essa ação não existe mais no site.');
    const payload = JSON.parse(p.payload);
    try {
      const resultado = await def.executar(db, { ...p, payload }, req.user);
      await db.run("UPDATE pedidos_admin SET status='aprovado', decidido_por=?, resposta=?, updated_at=? WHERE id=?", [req.user.id, resposta, now(), p.id]);
      await notificar(db, p.pedido_por, 'pedido_decidido', 'Seu pedido foi aprovado', {
        corpo: `${def.rotulo}: feito.${resposta ? ` ${resposta}` : ''}`, link: '#/admin/pedidos'
      });
      await audit(db, req.user, 'pedido.aprovado', p.id, def.rotulo);
      res.json({ ok: true, status: 'aprovado', resultado });
    } catch (e) {
      // Aprovado mas falhou na hora de executar: não finge que deu certo.
      await db.run("UPDATE pedidos_admin SET status='falhou', decidido_por=?, erro=?, updated_at=? WHERE id=?", [req.user.id, String(e.message || e).slice(0, 300), now(), p.id]);
      await notificar(db, p.pedido_por, 'pedido_decidido', 'Seu pedido foi aprovado, mas não deu para executar', {
        corpo: String(e.message || e).slice(0, 300), link: '#/admin/pedidos'
      });
      throw e;
    }
  }));
}
