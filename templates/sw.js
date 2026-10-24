const CACHE_NAME = 'datasentinel-v3';
const ASSETS = [
  '/script.js',
  '/style.css',
  '/manifest.json',
  '/icon.svg',
];
// Paginas dinamicas (sessao, CSRF) nunca devem ser servidas do cache.
const NEVER_CACHE_PATHS = ['/', '/login'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (requestUrl.origin !== self.location.origin) return;
  if (NEVER_CACHE_PATHS.includes(requestUrl.pathname)) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      }).catch(() => caches.match(event.request));
    })
  );
});
