// 聲調譜 TONESCORE — オフライン用の Service Worker
// ★配信物を変えたら VERSION を上げ、index.html の ?v= と js/app.js の APP_VERSION も揃える。
//
// ★方針：**すべてネットワーク優先**。キャッシュはオフライン時の保険としてだけ使う。
//   キャッシュ優先にすると、更新のたびに「新しいHTML＋古いJS」のような
//   組み合わせが起きる。実際に v6 で、新しい app.js と古い pitch.js が混ざり
//   `does not provide an export named 'decideVoicing'` で起動不能になった（2026-08-18）。
//   `?v=` を付けられるのは HTML から参照する物だけで、ESモジュールの import 先には
//   付け忘れが起きる。付け忘れても壊れない側に倒す。
const VERSION = 'v12';
const CACHE = `tonescore-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './css/app.css?v=12',
  './js/app.js?v=12',
  './js/tones.js?v=12',
  './js/pitch.js?v=12',
  './js/bopomofo.js?v=12',
  './js/data/phrases.js?v=12',
  './manifest.json?v=12',
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
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
