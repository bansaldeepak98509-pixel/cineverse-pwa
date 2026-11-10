/* CineVerse Ultimate service worker */
const CACHE = 'cineverse-v17';
const IMG_CACHE = 'cineverse-v17-img';
const IMG_LIMIT = 260; /* posters ka cap - phone storage bharna band */
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

/* Poster cache ko limit mein rakho: purane posters pehle nikaalo (keys insertion order mein aate hain) */
function trimImgCache() {
  return caches.open(IMG_CACHE).then(c => c.keys().then(reqs => {
    if (reqs.length <= IMG_LIMIT) return;
    const extra = reqs.slice(0, reqs.length - IMG_LIMIT);
    return Promise.all(extra.map(r => c.delete(r).catch(() => {})));
  })).catch(() => {});
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(new Request(u, {cache: 'reload'})))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== IMG_CACHE).map(k => caches.delete(k))))
      .then(() => trimImgCache())
      .then(() => self.clients.claim())
  );
});

/* Page se poster cache ki jaankari / safai */
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'cv-cache-count') {
    caches.open(IMG_CACHE).then(c => c.keys()).then(keys => {
      const msg = { type: 'cv-cache-count', count: keys.length };
      if (e.source && e.source.postMessage) e.source.postMessage(msg);
      else self.clients.matchAll({ includeUncontrolled: true }).then(cs => cs.forEach(c => c.postMessage(msg)));
    }).catch(() => {});
  }
  if (d.type === 'cv-clear-img') {
    caches.delete(IMG_CACHE).then(() => trimImgCache()).catch(() => {});
  }
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // Page loads: network first so a new version is picked up as soon as it is online,
    // cache only as the offline fallback.
    if (req.mode === 'navigate' || (req.destination === 'document')) {
      e.respondWith(
        fetch(req).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => caches.match(req, {ignoreSearch: true}).then(hit => hit || caches.match('./index.html')))
      );
      return;
    }
    // Own assets: serve fast, refresh in the background.
    e.respondWith(
      caches.match(req, {ignoreSearch: true}).then(hit => {
        const net = fetch(req).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // Posters / artwork from other hosts: cache as they are seen, network on miss
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(IMG_CACHE).then(c => c.put(req, copy)).then(trimImgCache).catch(() => {});
      }
      return res;
    }).catch(() => hit))
  );
});
