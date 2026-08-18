// Service worker PWA «Показатели». Версия в имени кэша — единственный способ
// заставить браузер подтянуть новый app-shell после деплоя (иначе activate
// увидит старый CACHE_NAME и ничего не тронет).
const CACHE_VERSION = 'v2';
const CACHE_NAME = `imperial-mc-pwa-${CACHE_VERSION}`;

const APP_SHELL = [
  '/pwa/',
  '/pwa/index.html',
  '/pwa/css/pwa.css',
  '/pwa/js/pwa.js',
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
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // API всегда только из сети. POST/логин кэшировать нельзя: иначе после
  // одного неверного ввода SW мог бы отдать сохранённый 401 даже при верном
  // пароле, а устаревшая статистика хуже короткого ожидания сети.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Оболочка приложения — сначала кэш, чтобы открывалось мгновенно и офлайн
  if (url.pathname.startsWith('/pwa/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
