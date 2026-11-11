const CACHE_NAME = 'myclinic-authority-shell-v8';
const SHELL_ASSETS = ['./', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Zero-trust rule: NEVER cache authenticated Supabase REST/Auth/Edge responses.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname.includes('/rest/v1/') ||
    url.pathname.includes('/auth/v1/') ||
    url.pathname.includes('/functions/v1/')
  ) {
    return;
  }

  // Hashed build output (/assets/index-*.js, *-CHASH.js, .css) is IMMUTABLE,
  // so it is cache-first: after the first visit a navigation costs zero
  // chunk downloads. v7 ran network-first for everything, which re-fetched
  // every lazy chunk on every route change.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((hit) => {
          if (hit) return hit;
          return fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
        }),
      ),
    );
    return;
  }

  // Shell + navigations stay network-first with a cache fallback so an
  // offline operator still gets the last known console.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
