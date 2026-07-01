// Service worker: installability + offline + auto-update.
//
// Strategy: NETWORK-FIRST for same-origin GETs. When online, every asset
// (index.html, viewer modules, pdf.js, tesseract, icons) is fetched fresh and
// a copy is stashed in the cache. So an installed app picks up new deploys the
// next time it's opened with a connection — no reinstall needed. When offline,
// requests fall back to whatever was cached during previous online use, and
// navigations fall back to the cached shell.
//
// Bump CACHE to force old caches out on the next activate.

const CACHE = "pdf-viewer-v2";

// Precache the minimal shell so the very first offline launch has something to
// show. Everything else is cached on demand as it's fetched while online.
const CORE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./app-web.js",
  "./app-web.css",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin (e.g. user PDFs)

  event.respondWith(
    fetch(request)
      .then((resp) => {
        // Cache a fresh copy of successful, cacheable responses.
        if (resp && resp.ok && (resp.type === "basic" || resp.type === "default")) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return resp;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        // Offline navigation with nothing cached for this URL → serve the shell.
        if (request.mode === "navigate") {
          const shell = await caches.match("./index.html");
          if (shell) return shell;
        }
        throw new Error("offline and uncached: " + url.pathname);
      })
  );
});
