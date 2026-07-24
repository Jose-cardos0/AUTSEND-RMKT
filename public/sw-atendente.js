// Service worker do app do atendente (Autsend Atendente).
// Habilita instalação como PWA + push (tocar com o app fechado).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => { /* passa direto pra rede */ })

// Push: mostra a notificação de chamada recebida.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (_) { data = {} }
  const title = data.title || 'Autsend Atendente'
  const body = data.body || 'Chamada recebida'
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/atendente-icon-192.png',
    badge: '/atendente-icon-192.png',
    tag: data.tag || 'chamada',
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: { url: '/atendente' },
  }))
})

// Clicou na notificação → foca/abre o app (com ?call=1 pra mostrar a tela de "recebendo chamada").
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) { if (c.url.includes('/atendente')) { try { c.postMessage({ tipo: 'chamada' }) } catch (_) {} await c.focus(); return } }
    await self.clients.openWindow('/atendente?call=1')
  })())
})
