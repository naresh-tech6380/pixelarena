/* PixelArena service worker — offline-first shell */
const CACHE = 'pixelarena-v11';
const CORE = [
  './',
  './index.html',
  './privacy.html',
  './404.html',
  './css/style.css',
  './js/home.js',
  './js/leaderboard.js',
  './js/firebase-config.js',
  './assets/logo.svg',
  './assets/og-banner.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './manifest.webmanifest',
  './games/neon-rush/index.html',
  './games/neon-rush/game.js',
  './games/neon-rush/assets/card-neon-rush.jpg',
  './games/neon-snake/index.html',
  './games/neon-snake/game.js',
  './games/neon-snake/assets/card-neon-snake.jpg',
  './games/stack-tower/index.html',
  './games/stack-tower/game.js',
  './games/stack-tower/assets/card-stack-tower.jpg',
  './games/shadow-clash/index.html',
  './games/shadow-clash/game.js',
  './games/shadow-clash/assets/dojo-bg.jpg',
  './games/shadow-clash/assets/card-shadow-clash.jpg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // let CDN/fonts go to network
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
