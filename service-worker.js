const CACHE_NAME = 'pokedex-static-v5';
const RUNTIME_CACHE_NAME = 'pokedex-runtime-v5';

const KANTO_SPRITE_ASSETS = Array.from({ length: 151 }, (_, index) => {
  const id = String(index + 1).padStart(3, '0');
  return `./images/pokemons/${id}.gif`;
});

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './data/kanto-151.json',
  './manifest.webmanifest',
  './favicons/favicon.png',
  './favicons/pokeball.png',
  './images/left-pokedex.png',
  './images/right-pokedex.png',
  ...KANTO_SPRITE_ASSETS
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(request.url);

  if (requestUrl.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request)
          .then((networkResponse) => {
            const clonedResponse = networkResponse.clone();
            caches.open(RUNTIME_CACHE_NAME).then((cache) => cache.put(request, clonedResponse));
            return networkResponse;
          })
          .catch(() => caches.match(request));
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        const clonedResponse = networkResponse.clone();
        caches.open(RUNTIME_CACHE_NAME).then((cache) => cache.put(request, clonedResponse));
        return networkResponse;
      })
      .catch(() => caches.match(request))
  );
});
