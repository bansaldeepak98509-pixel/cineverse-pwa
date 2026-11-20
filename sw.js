/* CineVerse Ultimate service worker */
const VERSION = 'v23';
const CACHE = 'cineverse-' + VERSION;
const IMG_CACHE = 'cineverse-img'; /* posters version badalne par bhi bache rahein (purana v21-img activate par hat jaata hai) */
const IMG_LIMIT = 260; /* posters ka cap - phone storage bharna band */
const NAV_TIMEOUT = 4000; /* slow net par 4s ke baad cached app dikhao, network background mein update kare */
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
/* Sirf ye hosts poster/artwork cache mein jaate hain. API calls (TMDB JSON, Firebase/Firestore,
   TV schedule, api.tmdb.org fallback) kabhi cache nahi hote - pehle cache-first hone se TMDB sync purana data dikhata tha. */
const IMG_HOSTS = /(^|\.)(image\.tmdb\.org|upload\.wikimedia\.org|i\.ytimg\.com|img\.youtube\.com|lh3\.googleusercontent\.com)$/i;

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
      /* Pehli install: turant active. Update: wait karo, app "Update ready" dikhayega
         aur user ke tap par activate hoga (beech mein data save ho raha ho to kuch na toote). */
      .then(() => { if (!self.registration.active) return self.skipWaiting(); })
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

/* Page se poster cache ki jaankari / safai / update */
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'cv-skip-waiting') { self.skipWaiting(); return; }
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

function putShell(req, res) {
  if (res && res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (url.origin === self.location.origin) {
    // Page loads: network first (naya version turant), 4s timeout ya offline par cached app.
    if (req.mode === 'navigate' || req.destination === 'document') {
      e.respondWith(new Promise(resolve => {
        let done = false;
        const fallback = () => caches.match(req, {ignoreSearch: true})
          .then(hit => hit || caches.match('./index.html'))
          .then(hit => hit || caches.match('./'));
        const net = fetch(req).then(res => putShell('./index.html', res));
        const timer = setTimeout(() => {
          fallback().then(hit => { if (hit && !done) { done = true; resolve(hit); } });
        }, NAV_TIMEOUT);
        net.then(res => { clearTimeout(timer); if (!done) { done = true; resolve(res); } })
          .catch(() => {
            clearTimeout(timer);
            fallback().then(hit => {
              if (done) return;
              done = true;
              resolve(hit || new Response(
                '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CineVerse</title>' +
                '<body style="background:#0a0a0f;color:#fff;font-family:system-ui;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px">' +
                '<div><div style="font-size:3rem">📡</div><h1 style="font-size:1.2rem">Aap offline hain</h1><p style="color:#aaa">Internet aate hi CineVerse khul jayega.</p>' +
                '<button onclick="location.reload()" style="margin-top:12px;padding:10px 18px;border-radius:20px;border:0;background:#ff2f42;color:#fff;font-weight:700">Dobara try karein</button></div>',
                {headers: {'Content-Type': 'text/html; charset=utf-8'}}));
            });
          });
      }));
      return;
    }
    // Own assets: serve fast, refresh in the background.
    e.respondWith(
      caches.match(req, {ignoreSearch: true}).then(hit => {
        const net = fetch(req).then(res => putShell(req, res)).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // Posters / artwork from known image hosts: cache as they are seen, network on miss.
  // Baaki sab cross-origin (APIs, Firebase, CDN scripts, iframes) seedha network/browser cache se.
  if (req.destination !== 'image' && !IMG_HOSTS.test(url.hostname)) return;
  if (req.destination && req.destination !== 'image') return;
  e.respondWith(
    caches.open(IMG_CACHE).then(c => c.match(req)).then(hit => hit || fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(IMG_CACHE).then(c => c.put(req, copy)).then(trimImgCache).catch(() => {});
      }
      return res;
    }).catch(() => hit || Response.error()))
  );
});

/* Notification par tap -> app kholo/focus karo */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
