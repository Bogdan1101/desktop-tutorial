// Кэширует игру, чтобы она открывалась без интернета. При изменении файлов увеличьте VERSION.
const VERSION = 'dota3-v11';
const FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/three.module.min.js', 'src/main.js', 'src/config.js', 'src/world.js', 'src/models.js', 'src/units.js',
  'src/game.js', 'src/ai.js', 'src/hud.js', 'src/input.js', 'src/nav.js', 'src/abilities.js', 'src/audio.js',
  'src/overlays.js', 'src/settings.js', 'src/profile.js', 'src/tutorial.js',
  'vendor/GLTFLoader.js', 'vendor/BufferGeometryUtils.js', 'vendor/SkeletonUtils.js', 'assets/robot.glb',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Сначала сеть (чтобы видеть обновления), без сети — кэш
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
