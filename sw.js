// 聲調譜 TONESCORE — オフライン用の最小 Service Worker
// ★配信物を変えたら VERSION を上げ、index.html の ?v= も揃えて上げること。
const VERSION = 'v2';
const CACHE = `tonescore-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './css/app.css?v=2',
  './js/app.js?v=2',
  './js/tones.js',
  './js/pitch.js',
  './js/bopomofo.js',
  './js/data/phrases.js',
  './manifest.json?v=2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
