// Minimal service worker. It exists so browsers treat the page as an installable
// app (needed for the Web Share Target in manifest.webmanifest). No caching.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
