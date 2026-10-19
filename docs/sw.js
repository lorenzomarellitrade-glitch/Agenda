// Service worker: app offline (cache, aggiornata in background) e notifiche push.
const CACHE = 'agenda-v2';
const FILE = [
  './', './index.html', './app.css', './app.js', './config.js', './manifest.json',
  './icone/icon-180.png', './icone/icon-192.png', './icone/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomi) => Promise.all(nomi.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const inCache = await cache.match(req, { ignoreSearch: true });
    const rete = fetch(req).then((r) => {
      if (r.ok) cache.put(req, r.clone());
      return r;
    }).catch(() => inCache || cache.match('./index.html'));
    if (inCache) { e.waitUntil(rete); return inCache; }
    return rete;
  }));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { testo: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titolo || 'Agenda', {
    body: d.testo || '',
    tag: d.tag || undefined,
    icon: 'icone/icon-192.png',
    badge: 'icone/icon-192.png',
    data: { url: d.url || './' },
  }));
});

// Tocco sulla notifica: apre l'app (sulla vista indicata dalla notifica, se c'è).
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
    for (const c of lista) {
      if ('focus' in c) {
        c.postMessage({ apri: url });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
