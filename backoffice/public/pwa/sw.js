// Service worker PWA «Показатели».
// CACHE_VERSION бампится при каждом деплое оболочки — activate чистит старые кэши.
// Оболочка отдаётся network-first: после деплоя клиенты сразу получают новый
// JS/CSS/HTML, без удаления ярлыка. Офлайн — fallback на последний кэш.
const CACHE_VERSION = 'v9';
const CACHE_NAME = `imperial-mc-pwa-${CACHE_VERSION}`;

const APP_SHELL = [
  '/pwa/',
  '/pwa/index.html',
  '/pwa/css/pwa.css',
  '/pwa/js/pwa.js',
  '/pwa/version.json',
  '/pwa/manifest.webmanifest',
  '/pwa/icons/icon-192.png',
  '/pwa/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() =>
        self.clients.matchAll({ type: 'window' }).then((clients) => {
          clients.forEach((client) => client.postMessage({ type: 'PWA_UPDATED', version: CACHE_VERSION }));
        })
      )
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // API — только сеть
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (!url.pathname.startsWith('/pwa/')) return;

  // Network-first для оболочки: новые деплои видны без переустановки PWA
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/pwa/index.html')))
  );
});
