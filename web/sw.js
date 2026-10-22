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
      data: { link: d.link || '/#/admin/chats' },
      actions: chamada ? [{ action: 'atender', title: 'Atender' }, { action: 'recusar', title: 'Recusar' }] : []
    })
  );
});

self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  if (ev.action === 'recusar') return; // só dispensa o aviso
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
