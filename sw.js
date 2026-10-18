// Service Worker（仕様書8.4）
// ★どのファイルを変えて公開するときも、ここの番号を上げる（pon-v2, pon-v3 …）
const CACHE_NAME = 'pon-v10';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'config.js',
  'i18n.js',
  'logic.js',
  'store.js',
  'game.js',
  'gen-worker.js',
  'daily-k.json',
  'free-k.json',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // ブラウザのHTTPキャッシュに残った古いファイルを入れないよう cache:'reload' で取り直す
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('pon-') && key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// キャッシュ優先：キャッシュにあれば返し、無ければネットワーク
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
