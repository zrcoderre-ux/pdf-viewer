# PDF Viewer PWA

An installable Progressive Web App that runs the **full citation-linking PDF
viewer** in a dedicated, standalone window — its own icon, no browser tab strip
or address bar. It reuses the **same** viewer code as the Chrome extension
(`viewer/` at the repo root): citation links to Lexis+/Westlaw, Table of
Authorities, OCR, highlighting, box-select, thumbnails/bookmarks, source/footer
naming, and download — all working on PDFs you open from disk.

**Live:** https://zrcoderre-ux.github.io/pdf-viewer/

## How it works

The PWA is a **tabbed shell** around the canonical viewer. Each open PDF is a
separate `<iframe>` running `viewer/viewer.html`, so every tab is a fully
isolated viewer instance (its own zoom, highlights, OCR…) with no shared state:

| File | Purpose |
|------|---------|
| `index.html` | Tab-manager shell: a tab strip + iframe stage + empty state. Hosts no viewer markup itself. |
| `app-web.js` | Tab manager: opens PDFs in new tabs (+ button, drag-drop, OS file handler, or a routed `?file=` URL), switches/closes tabs, syncs tab titles, registers the service worker. Local files reach a tab's viewer via `iframe.contentWindow.__pdfViewerLoadLocal`; tabs load lazily the first time they're shown so overlays get correct geometry. |
| `app-web.css` | Styles the tab strip, iframe stage, and empty-state drop zone. |
| `manifest.webmanifest` | `display: standalone` + `file_handlers` for `application/pdf`. |
| `sw.js` | Service worker — **network-first** (auto-updates when online) with offline fallback. |
| `build-site.sh` | Assembles the deployable site: this shell **+** the canonical `viewer/` and `pdfjs/` copied from the repo root. |
| `icons/`, `gen-icons.py` | App icons (regenerate: `python3 gen-icons.py`). |

**Single source of truth:** the viewer logic lives once, at the repo root. The
only extension-file change is a small, guarded shim at the top of
`viewer/viewer.js` that supplies the `chrome.*` APIs (backed by Web Storage)
when running as a hosted page. Inside the extension `chrome.storage` exists, so
the shim is skipped and extension behavior is unchanged.

Local files are read as bytes and handed straight to the viewer — no network,
so CORS never applies and every tool works offline on opened files. (Fetching
arbitrary *cross-origin* PDFs by URL remains the extension's job.)

## Auto-update

The service worker is network-first: whenever the installed app is opened
**online**, it fetches the latest deployed assets and refreshes its cache, so
improvements show up on the next launch — no reinstall or re-download. Offline,
it serves the last-cached version.

## Build & run locally

Service workers and file handling need HTTP(S), not `file://`:

```sh
pwa/build-site.sh          # assembles ./_site
python3 -m http.server 8100 --directory _site
```

Open <http://localhost:8100/>, install from the address-bar icon, then
"Open with → PDF Viewer" on any local PDF.

## Deploying

`.github/workflows/deploy-pwa.yml` runs `build-site.sh` and publishes `_site` to
GitHub Pages on every push to `main` that touches `pwa/`, `viewer/`, or
`pdfjs/`. One-time setup (already done): **Settings → Pages → Source: GitHub
Actions**.

**Two delivery channels — don't confuse them:** your `git pull` tool updates the
*extension* on your machine; this *app* updates itself from the hosted URL. The
`pwa/` files a pull drops on disk are just source, not the running app.

## Routing web PDFs to the app (optional, off by default)

The extension can redirect PDFs you click while browsing to this app instead of
its own bundled viewer — enable it in the extension's **Options → "Open web PDFs
in the app"** (off by default). A routed PDF arrives as `…/pdf-viewer/?file=<url>`
and opens in a new tab.

**Extension-brokered fetch.** A hosted page can't fetch cookie-gated or
cross-origin court PDFs. So the app doesn't fetch routed URLs itself — it asks
the extension. A content-script bridge (`content/app-bridge.js`) injected into
the app's page relays the request to the extension's background worker, which
fetches the PDF **with your cookies and host permissions** (bypassing CORS) and
returns the bytes. The app then renders them like a locally-opened file. This
makes eCMS / Westlaw / cross-origin PDFs work in the app. If the extension isn't
present, the app falls back to fetching the URL directly (public PDFs only).

The one manual step: for a routed PDF to open in the **installed app window**
(not just a browser tab), turn on Chrome's "Open supported links in this app"
for the PWA. The manifest requests this via `handle_links: preferred`, but the
user setting is what enables it. (The brokered fetch works either way — this
only controls window vs. tab.)

Note: the bridge content script is matched to the default app URL in
`manifest.json`. If you change the app URL in Options, update that match.

## Notes / limitations

- **OCR** relies on the bundled Tesseract WASM. It works from local files, but
  threaded OCR may be limited on GitHub Pages (no cross-origin-isolation
  headers); it falls back to single-threaded where needed.
- **Cross-tab filename disambiguation** is effectively per-window in the PWA
  (each window has its own session storage) — a no-op, not a bug.
