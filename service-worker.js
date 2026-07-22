/* eslint-env serviceworker */

/**
 * Offline support.
 *
 * The app shell is cached on install and served cache-first, so the sheet opens with
 * no signal at all — which is the point, since the table is not always somewhere with
 * a usable connection.
 *
 * This is cache-first, so a deployed change reaches a phone only once the worker updates.
 * CACHE_VERSION is NOT bumped by hand: tools/stamp-sw.py rewrites it to a content hash of
 * the precached files at deploy time (see deploy.yml). The repo copy stays at 'v1' on
 * purpose — the stamp and the deploy both rely on the committed copy being unstamped.
 *
 * Character data is never touched here. It lives in localStorage, which the service
 * worker cannot see and does not cache.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `dnd-sheets-${CACHE_VERSION}`;

// Relative paths throughout: the site is served from a subpath on GitHub Pages
// (/dnd-character-sheets/), so a leading slash would resolve to the wrong origin root.
const SHELL = [
  './',
  './index.html',
  './style.css',
  './tests.html',
  './manifest.webmanifest',
  './js/main.js',
  './js/render.js',
  './js/state.js',
  './js/storage.js',
  './js/rules.js',
  './js/constants.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('dnd-sheets-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never interfere with anything but plain same-origin reads.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Opaque or error responses are not worth caching.
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          // Offline and uncached: a navigation still gets the app shell, so a
          // deep link or a cold launch never lands on the browser's error page.
          if (request.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
    }),
  );
});
