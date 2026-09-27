const CACHE_NAME = 'sm-nalsdesigner-v1';   // troque o número (v2, v3...) se um dia precisar forçar todos a baixarem tudo de novo

// Arquivos essenciais para funcionar offline (site do cliente)
const STATIC_ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './manifest-client.json',
  './logo_emblema.png',
  './logo.png',
  'https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,600;0,700;0,900;1,700&family=Roboto:wght@300;400;500&display=swap',
];

// Instala e faz cache dos arquivos estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { mode: 'no-cors' })));
    }).then(() => self.skipWaiting())
  );
});

// Remove caches antigos ao ativar nova versão
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Estratégia:
// - Firebase / APIs externas: sempre rede, sem cache
// - HTML, JS e CSS (o código do site e do painel): REDE PRIMEIRO, cache só como reserva offline.
//   Assim, quando você publica uma versão nova, ela aparece na hora (sem ficar preso em cache antigo).
// - Imagens, fontes, manifest etc.: cache primeiro (carrega mais rápido)
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = req.url;

  if (
    url.includes('firestore.googleapis.com') ||
    url.includes('firebase') ||
    url.includes('googleapis.com/firestore') ||
    url.includes('wa.me')
  ) {
    event.respondWith(fetch(req).catch(() => new Response('Offline', { status: 503 })));
    return;
  }

  const path = new URL(url).pathname;
  const ehCodigo = req.mode === 'navigate' || /\.(html|js|css)$/i.test(path) || path.endsWith('/');

  if (ehCodigo) {
    event.respondWith(
      fetch(req).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return response;
      }).catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
