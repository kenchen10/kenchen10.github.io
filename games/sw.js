// Service worker: makes the page installable (needed for the Web Share Target)
// and lets it open offline. Network first, so deploys show up immediately;
// the cache is only used when the network fails. Results data comes from
// another origin (Apps Script) and is cached by app.js in localStorage.
const CACHE = 'games-shell-v1';
const SHELL = [
  './', 'index.html', 'style.css', 'config.js', 'games.js', 'bg.js', 'app.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
];

self.addEventListener('install', (e) => {
  // One missing file must not stop the worker from installing, so add them individually.
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        // ignoreSearch: share-target and ?me= links carry a query string
        caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))
      )
  );
});
