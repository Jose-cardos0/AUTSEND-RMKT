// Service worker mínimo do app do atendente (Autsend Atendente).
// Só habilita a instalação como PWA — sem cache offline agressivo (voz precisa da rede).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => { /* passa direto pra rede */ })
