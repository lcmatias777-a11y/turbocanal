// Service Worker do TurboCanal.
//
// Serve para UMA coisa: receber o aviso de chamada quando o site está fechado.
// Ele não guarda páginas em cache de propósito — cache mal feito entrega
// versão velha do site depois de um deploy, e o preço disso é alto demais
// para o ganho.

self.addEventListener('install', (ev) => self.skipWaiting());
self.addEventListener('activate', (ev) => ev.waitUntil(self.clients.claim()));

self.addEventListener('push', (ev) => {
  let d = {};
  try { d = ev.data ? ev.data.json() : {}; } catch { d = {}; }
  const chamada = d.tipo === 'chamada';
  ev.waitUntil(
    self.registration.showNotification(d.titulo || 'TurboCanal', {
      body: d.corpo || '',
      tag: chamada ? 'turbocanal-chamada' : 'turbocanal-aviso',
      renotify: chamada,
      requireInteraction: chamada,
      vibrate: chamada ? [250, 120, 250, 120, 250] : undefined,
      data: { link: d.link || '/#/admin/chats', conversa: d.conversa || null, de: d.de || null },
      actions: chamada ? [{ action: 'atender', title: 'Atender' }, { action: 'recusar', title: 'Recusar' }] : []
    })
  );
});

self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  // "Recusar" tem de recusar de verdade: manda o desligamento para quem ligou,
  // senão o outro lado fica ouvindo "Chamando…" até o tempo de 45s acabar e
  // recebe a explicação errada ("ninguém atendeu"). Se o envio falhar, não há
  // nada pior do que o comportamento antigo, e o erro fica no console.
  if (ev.action === 'recusar') {
    const d = ev.notification.data || {};
    if (!d.conversa || !d.de) return;
    ev.waitUntil(
      fetch(`/api/admin/chats/${encodeURIComponent(d.conversa)}/sinal`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ para: d.de, tipo: 'recusou', dados: {} })
      }).catch((e) => console.error('[sw] não consegui recusar a chamada:', e && e.message))
    );
    return;
  }
  const link = (ev.notification.data && ev.notification.data.link) || '/#/admin/chats';
  ev.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of abas) {
      // Já existe uma aba do site: traz para a frente em vez de abrir outra.
      if (c.url.includes(self.registration.scope.replace(/\/$/, ''))) {
        await c.focus();
        try { c.postMessage({ tipo: 'abrir', link }); } catch {}
        return;
      }
    }
    await self.clients.openWindow(link);
  })());
});
