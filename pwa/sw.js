// Minimal service worker: precache the app shell so the PWA is installable and
// works offline. There is no dynamic/runtime caching of PDFs — those are
// user-supplied at launch time.

const CACHE = "pdf-viewer-shell-v1";

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./viewer.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./vendor/pdfjs/pdf.mjs",
  "./vendor/pdfjs/pdf.worker.mjs",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Only serve our own shell from cache; never intercept the user's PDF
  // fetches or anything cross-origin.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).catch(() => cached);
    })
  );
});
