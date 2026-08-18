// 聲調譜 TONESCORE — オフライン用の Service Worker
// ★配信物を変えたら VERSION を上げ、index.html の ?v= と js/app.js の APP_VERSION も揃える。
//
// ★HTMLは「ネットワーク優先」。ここをキャッシュ優先にすると、更新しても端末が
//   古いHTML（＝古い ?v= 参照）を返し続け、更新が常に1回遅れる。
//   実機で v3 を配信済みなのに v2 が動いていた原因がこれ（2026-08-18）。
const VERSION = 'v5';
const CACHE = `tonescore-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './css/app.css?v=5',
  './js/app.js?v=5',
  './js/tones.js',
  './js/pitch.js',
  './js/bopomofo.js',
  './js/data/phrases.js',
  './manifest.json?v=5',
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

const isHTML = (req) =>
  req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  if (isHTML(e.request)) {
    // ネットワーク優先。取れたらキャッシュを更新し、オフライン時だけキャッシュへ落ちる
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // ?v= 付きの静的物はキャッシュ優先でよい（URLが変われば別物として取り直される）
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }))
  );
});
