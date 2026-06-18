/* =====================================================================
   BOTTA CONSAPEVOLE — Service Worker
   Strategia: cache-first per l'app shell (offline + avvio istantaneo),
   con aggiornamento in background (stale-while-revalidate) per le risorse.
   ===================================================================== */

const CACHE = 'botta-consapevole-v5';

// Percorsi relativi: l'app funziona anche servita da una sottocartella.
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './audio.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png',
  './icons/startup-1080x2340.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Navigazioni: prova rete, fallback a index.html dalla cache (offline SPA).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Asset: cache-first + revalidate in background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return 