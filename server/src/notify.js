// Notificações do site.
//
// Regra da casa: notificação só é criada quando a coisa ACONTECEU de verdade no
// banco (crédito entrou, pagamento foi confirmado, alguém respondeu). Nada de
// aviso "você vai receber" antes do fato. Cada uma guarda o motivo e o número,
// porque "seus créditos mudaram" sem dizer quanto e por quê não serve pra nada.

import { uid, now, HttpError } from './util.js';

const MAX_TITULO = 160;
const MAX_CORPO = 600;

/** Todos os tipos que o site sabe emitir. Tipo fora da lista não entra. */
export const TIPOS = {
  boas_vindas: '👋',
  creditos_recarregados: '🔄',
  creditos_pagamento: '💎',
  creditos_aumentados: '➕',
  creditos_diminuidos: '➖',
  virou_admin: '🛠',
  deixou_admin: '🔒',
  resposta_recebida: '💬',
  pedido_admin: '🙋',
  pedido_decidido: '✅',
  mensagem_chat: '✉️',
  experimento: '🧪',
  seguranca: '🔐'
};

/** Cria uma notificação. Nunca derruba a operação principal se falhar. */
export async function notificar(db, userId, tipo, titulo, { corpo = '', link = '', dados = {} } = {}) {
  if (!userId || !TIPOS[tipo]) return null;
  try {
    const id = uid();
    await db.run(
      'INSERT INTO notificacoes(id,user_id,tipo,titulo,corpo,link,dados,lida,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      [id, userId, tipo, String(titulo).slice(0, MAX_TITULO), String(corpo).slice(0, MAX_CORPO), String(link).slice(0, 200), JSON.stringify(dados || {}), 0, now()]
    );
    return id;
  } catch {
    return null;
  }
}

/** Mesma notificação para todo mundo que é administrador principal. */
export async function notificarDono(db, tipo, titulo, extra = {}) {
  const donos = await db.all("SELECT id FROM users WHERE role='owner'");
  for (const d of donos) await notificar(db, d.id, tipo, titulo, extra);
  return donos.length;
}

const n = (v) => Number(v || 0).toLocaleString('pt-BR');

/** Textos prontos, pra mensagem sair igual de qualquer lugar do código. */
export const avisos = {
  boasVindas: (db, user) => notificar(db, user.id, 'boas_vindas', `Boas-vindas, ${String(user.name || '').split(' ')[0] || 'criador'}!`, {
    corpo: `Sua conta está pronta com ${n(user.credits)} créditos. Vincule seu canal do YouTube para liberar as ferramentas que leem os seus próprios números.`,
    link: '#/dashboard'
  }),
  recarga: (db, userId, quanto, teto) => notificar(db, userId, 'creditos_recarregados', `Seus créditos do mês foram restaurados`, {
    corpo: `Entraram ${n(quanto)} créditos para completar o saldo até ${n(teto)}, que é o limite mensal do plano Free. Isso acontece sozinho no primeiro uso de cada mês.`,
    link: '#/historico',
    dados: { quanto, teto }
  }),
  pagamento: (db, userId, { plano, creditos, valorCentavos }) => notificar(db, userId, 'creditos_pagamento', `Pagamento confirmado: +${n(creditos)} créditos`, {
    corpo: `Seu plano agora é o ${plano}. Os ${n(creditos)} créditos já estão no seu saldo e passam a entrar todo mês enquanto o plano estiver ativo.`,
    link: '#/historico',
    dados: { plano, creditos, valorCentavos }
  }),
  ajuste: (db, userId, delta, motivo, porQuem) => notificar(
    db, userId,
    delta >= 0 ? 'creditos_aumentados' : 'creditos_diminuidos',
    delta >= 0 ? `Você recebeu ${n(delta)} créditos` : `Foram retirados ${n(-delta)} créditos`,
    {
      corpo: `Motivo: ${motivo || 'não informado'}.${porQuem ? ` Ajuste feito por ${porQuem}.` : ''}`,
      link: '#/historico',
      dados: { delta, motivo }
    }
  ),
  virouAdmin: (db, userId, porQuem) => notificar(db, userId, 'virou_admin', 'Você agora é administrador do TurboCanal', {
    corpo: `${porQuem || 'O administrador principal'} te adicionou à equipe. Você já pode abrir o painel. Ações que mexem na conta dos outros (créditos, banir, remover comentário, adicionar administrador) passam pela aprovação do administrador principal.`,
    link: '#/admin'
  }),
  deixouAdmin: (db, userId) => notificar(db, userId, 'deixou_admin', 'Seu acesso de administrador foi removido', {
    corpo: 'Sua conta continua normal, só não abre mais o painel administrativo.',
    link: '#/dashboard'
  }),
  resposta: (db, userId, { autor, trecho, alvo }) => notificar(db, userId, 'resposta_recebida', `${autor} respondeu você`, {
    corpo: trecho ? `"${String(trecho).slice(0, 180)}"` : '',
    link: '#/avaliacoes',
    dados: { alvo }
  })
};

export function notifyRoutes(app, db, auth) {
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
  const monta = (r) => ({
    id: r.id,
    tipo: r.tipo,
    emoji: TIPOS[r.tipo] || '🔔',
    titulo: r.titulo,
    corpo: r.corpo,
    link: r.link,
    dados: (() => { try { return JSON.parse(r.dados); } catch { return {}; } })(),
    lida: !!r.lida,
    criado_em: r.created_at
  });

  app.get('/api/notifications', auth.required, wrap(async (req, res) => {
    const limite = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const sóNaoLidas = req.query.nao_lidas === '1';
    const rows = await db.all(
      `SELECT * FROM notificacoes WHERE user_id=?${sóNaoLidas ? ' AND lida=0' : ''} ORDER BY created_at DESC LIMIT ${limite}`,
      [req.user.id]
    );
    const naoLidas = (await db.get('SELECT COUNT(*)::int AS n FROM notificacoes WHERE user_id=? AND lida=0', [req.user.id])).n;
    res.json({ itens: rows.map(monta), naoLidas });
  }));

  app.post('/api/notifications/:id/lida', auth.required, wrap(async (req, res) => {
    const r = await db.get('SELECT id FROM notificacoes WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    if (!r) throw new HttpError(404, 'Notificação não encontrada.');
    await db.run('UPDATE notificacoes SET lida=1 WHERE id=?', [r.id]);
    res.json({ ok: true, naoLidas: (await db.get('SELECT COUNT(*)::int AS n FROM notificacoes WHERE user_id=? AND lida=0', [req.user.id])).n });
  }));

  app.post('/api/notifications/todas-lidas', auth.required, wrap(async (req, res) => {
    await db.run('UPDATE notificacoes SET lida=1 WHERE user_id=? AND lida=0', [req.user.id]);
    res.json({ ok: true, naoLidas: 0 });
  }));

  app.delete('/api/notifications/:id', auth.required, wrap(async (req, res) => {
    const r = await db.get('SELECT id FROM notificacoes WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    if (!r) throw new HttpError(404, 'Notificação não encontrada.');
    await db.run('DELETE FROM notificacoes WHERE id=?', [r.id]);
    res.json({ ok: true });
  }));
}
