# PDF Viewer PWA

A bare-bones, installable Progressive Web App that turns PDFs into a **dedicated
app experience** — its own icon, its own standalone window, no browser tab strip
or address bar. It renders PDFs with the same PDF.js build the extension uses,
but deliberately does *nothing else* (no citation linking, OCR, etc.). Its whole
job is to be the app shell.

## What's here

| File | Purpose |
|------|---------|
| `index.html` | The app shell (toolbar + drop zone + page container). |
| `viewer.js` | Minimal PDF.js renderer. Accepts a PDF via the OS file handler (`launchQueue`), a `?file=` URL param, drag-and-drop, or the Open button. |
| `styles.css` | Styling for the standalone window. |
| `manifest.webmanifest` | Web app manifest: `display: standalone`, icons, and `file_handlers` registering `application/pdf`. |
| `sw.js` | Service worker that precaches the shell (required for installability + offline). |
| `icons/` | App icons (192 & 512 px). Regenerate with `python3 gen-icons.py`. |
| `vendor/pdfjs/` | Copy of the PDF.js build (`pdf.mjs` + `pdf.worker.mjs`). |

## How to try it

The PWA must be served over HTTP(S) (service workers don't run from `file://`):

```sh
cd pwa
python3 -m http.server 8099
```

Open <http://localhost:8099/> in Chrome, then install it from the address-bar
install icon (or ⋮ → *Install PDF Viewer*). Once installed:

- **Open a local PDF from your OS** ("Open with → PDF Viewer") and it launches in
  the standalone app window via the `file_handlers` registration.
- Drag a PDF onto the window, or use **Open…**, to load one manually.

> For real deployment, host the `pwa/` folder on any static host (e.g. GitHub
> Pages) over HTTPS. File handling and installability require a secure origin.

## How it pairs with the extension

The PWA covers files launched from the OS. The companion Chrome extension (repo
root) covers the other half:

- **Web capture** — the extension's `declarativeNetRequest` redirect can point at
  this PWA's hosted URL (`…/pwa/index.html?file=<pdf-url>`) instead of the
  in-extension viewer, so PDFs you hit while browsing open in the app window
  (with Chrome's "open supported links in this app" enabled).
- **CORS bypass** — a hosted page can't fetch arbitrary cross-origin PDFs; the
  extension has the host permissions to fetch the bytes and hand them in. The
  `?file=` path here works today for same-origin / CORS-open URLs and local
  files; cross-origin brokering is the extension's job.
