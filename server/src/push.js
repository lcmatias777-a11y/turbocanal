// Aviso de chamada com o site FECHADO (Web Push).
//
// Como funciona, e por que não custa nada: o navegador tem um endereço próprio
// de entrega (Google no Chrome, Mozilla no Firefox). O site manda a mensagem
// cifrada para esse endereço e o navegador entrega ao Service Worker, que
// mostra a notificação. Não há serviço pago no meio. As chaves VAPID são
// geradas aqui, uma vez, e guardadas no banco.
//
// O limite honesto: com o NAVEGADOR inteiro fechado no computador, não chega.
// No Android chega com o Chrome fechado; no iPhone, só se o site tiver sido
// adicionado à tela de início.

import { HttpError, uid, now, audit } from './util.js';
import { getSetting, setSetting } from './db.js';

let webpush = null;
async function lib() {
  if (!webpush) { const m = await import('web-push'); webpush = m.default || m; }
  return webpush;
}

/** Gera as chaves na primeira vez e devolve o par guardado. */
export async function chaves(db) {
  let pub = await getSetting(db, 'vapid_public');
  let priv = await getSetting(db, 'vapid_private');
  if (!pub || !priv) {
    const w = await lib();
    const par = w.generateVAPIDKeys();
    pub = par.publicKey; priv = par.privateKey;
    await setSetting(db, 'vapid_public', pub);
    await setSetting(db, 'vapid_private', priv);
  }
  return { pub, priv };
}

async function pronto(db) {
  const { pub, priv } = await chaves(db);
  const w = await lib();
  const contato = (await getSetting(db, 'owner_email')) || process.env.OWNER_EMAIL || 'suporte@turbocanal';
  w.setVapidDetails('mailto:' + contato, pub, priv);
  return w;
}

/** Manda um aviso para TODAS as inscrições de uma pessoa (ela pode ter vários
 *  aparelhos). Inscrição que o navegador recusa de vez é apagada. */
export async function avisar(db, userId, payload) {
  let w;
  try { w = await pronto(db); } catch (e) { console.error('[push] sem chaves:', e.message); return 0; }
  const subs = await db.all('SELECT * FROM push_subs WHERE user_id=?', [userId]);
  let enviados = 0;
  for (const s of subs) {
    try {
      await w.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60, urgency: 'high' }
      );
      enviados++;
    } catch (e) {
      // 404 e 410 = o navegador descartou a inscrição; qualquer outro erro é
      // temporário e a inscrição fica.
      const st = e?.statusCode;
      if (st === 404 || st === 410) await db.run('DELETE FROM push_subs WHERE id=?', [s.id]);
      else console.error('[push] falha ao enviar:', st || e.message);
    }
  }
  return enviados;
}

/** Aviso de chamada. Separado porque é o único com urgência de verdade. */
export async function avisarChamada(db, paraUserId, deNome, conversaId, deUserId = null) {
  return avisar(db, paraUserId, {
    tipo: 'chamada',
    titulo: `📞 ${deNome || 'Alguém'} está te ligando`,
    corpo: 'Toque para abrir o TurboCanal e atender.',
    link: '/#/admin/chats',
    conversa: conversaId,
    // Quem ligou. Sem isto o botao "Recusar" do aviso nao tinha para quem
    // mandar o desligamento, e so fechava o aviso: quem ligou ficava ouvindo
    // "Chamando..." ate o tempo acabar.
    de: deUserId
  });
}

export function pushRoutes(app, db, auth) {
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  // A chave pública não é segredo: o navegador precisa dela para se inscrever.
  app.get('/api/push/chave', auth.required, wrap(async (req, res) => {
    const { pub } = await chaves(db);
    res.json({ chave: pub });
  }));

  app.post('/api/push/assinar', auth.required, wrap(async (req, res) => {
    const sub = req.body?.inscricao;
    const endpoint = String(sub?.endpoint || '').slice(0, 1000);
    const p256dh = String(sub?.keys?.p256dh || '').slice(0, 300);
    const auth2 = String(sub?.keys?.auth || '').slice(0, 300);
    if (!/^https:\/\//.test(endpoint) || !p256dh || !auth2) throw new HttpError(400, 'Inscrição de notificação inválida.');
    const jaTem = await db.get('SELECT id FROM push_subs WHERE endpoint=?', [endpoint]);
    if (jaTem) {
      await db.run('UPDATE push_subs SET user_id=?, p256dh=?, auth=?, agente=?, atualizado_em=? WHERE id=?',
        [req.user.id, p256dh, auth2, String(req.headers['user-agent'] || '').slice(0, 200), now(), jaTem.id]);
    } else {
      await db.run('INSERT INTO push_subs(id,user_id,endpoint,p256dh,auth,agente,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?)',
        [uid(), req.user.id, endpoint, p256dh, auth2, String(req.headers['user-agent'] || '').slice(0, 200), now(), now()]);
    }
    res.json({ ok: true });
  }));

  app.delete('/api/push/assinar', auth.required, wrap(async (req, res) => {
    const endpoint = String(req.body?.endpoint || '');
    if (endpoint) await db.run('DELETE FROM push_subs WHERE user_id=? AND endpoint=?', [req.user.id, endpoint]);
    else await db.run('DELETE FROM push_subs WHERE user_id=?', [req.user.id]);
    res.json({ ok: true });
  }));

  // Quantos aparelhos a pessoa tem ligados, para a tela poder dizer a verdade.
  app.get('/api/push/meus', auth.required, wrap(async (req, res) => {
    const linhas = await db.all('SELECT id, agente, criado_em FROM push_subs WHERE user_id=? ORDER BY criado_em', [req.user.id]);
    res.json({ itens: linhas.map((l) => ({ id: l.id, agente: l.agente, criado_em: l.criado_em })) });
  }));

  // Teste: manda um aviso para os próprios aparelhos da pessoa.
  app.post('/api/push/testar', auth.required, wrap(async (req, res) => {
    const n = await avisar(db, req.user.id, {
      tipo: 'teste', titulo: '🔔 Aviso de teste do TurboCanal',
      corpo: 'Se você está lendo isto, os avisos com o site fechado funcionam.', link: '/#/admin/chats'
    });
    await audit(db, req.user, 'push.teste', '', `${n} aparelho(s)`);
    res.json({ ok: true, enviados: n });
  }));
}
