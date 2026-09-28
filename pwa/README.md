# PDF Viewer PWA

An installable Progressive Web App that runs the **full PDF editor and
citation-linking viewer** in a dedicated, standalone window — its own icon, no
browser tab strip or address bar. It reuses the **same** viewer code as the
Chrome extension (`viewer/` at the repo root): comments and markup, Fill &
Sign, text edits, page organizing, redaction, password protection, Bates
numbering, export to Word, compression, Compare, citation links to
Lexis+/Westlaw, Table of Authorities and OCR — all working on PDFs you open from
disk, and saved back into the same file. See the root README's *PDF editor*
section for the tools.

**Live:** https://zrcoderre-ux.github.io/pdf-viewer/

## How it works

The PWA is a **tabbed shell** around the canonical viewer. Each open PDF is a
separate `<iframe>` running `viewer/viewer.html`, so every tab is a fully
isolated viewer instance (its own zoom, highlights, OCR…) with no shared state:

| File | Purpose |
|------|---------|
| `index.html` | Tab-manager shell: a tab strip (with a Home tab) + iframe stage + the Home screen (Open, Open case folder, Combine files, Images to PDF, recent files). Hosts no viewer markup itself. |
| `app-web.js` | Tab manager: opens PDFs in new tabs (+ button, drag-drop, OS file handler, or a routed `?file=` URL), switches/closes tabs, syncs tab titles, registers the service worker. Local files reach a tab's viewer via `iframe.contentWindow.__pdfViewerLoadLocal`; tabs load lazily the first time they're shown so overlays get correct geometry. The active tab's iframe takes keyboard focus, so the viewer's shortcuts (auto-scroll's A / Space / [ / ], Shift+Space) work without clicking into the page. |
| `app-web.css` | Styles the tab strip, iframe stage and Home screen, in the viewer's dark and light themes. |
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

## Text exports

A `.txt` opened in the app — from the picker, a drop, or the OS file handler —
opens in the **text reader** (`viewer/text-reader.html`) in its own tab rather
than the PDF viewer: PDF-Linker's scrubbed exports laid out as pages in your
font, citations linked, the real names put back on screen from the case's
`pseudonym_key.xlsx`, editable and saved back with the fakes underneath. See
the root README's "Text reader" section. The tab manager feeds it through
`__textReaderLoadLocal`, the reader's twin of the viewer's load hook.

## Editing local documents

Every PDF in the app is one you opened from disk, so **Save** (Ctrl S) writes
your changes back into the same file through the file's handle from the picker
or the OS file handler; a dot on the Save button and on the tab marks unsaved
changes, and
closing a tab or the window with unsaved changes asks first. Comments,
signatures and text edits are stored as standard PDF annotations, so they
reopen editable here and show in Acrobat and Preview. A password-protected
file opens with a prompt and is saved back protected.

The Home screen adds three things that do not need an open document:
**Combine files** (several PDFs into one, in file-name order — rearrange the
pages afterwards with Organize pages), **Images to PDF**, and a **Recent files** list that reopens a file without the picker
(the browser asks for permission again when needed). Ctrl O opens a file from
anywhere in the app.

In the extension, a web PDF can be edited too: **Save as…** saves a copy with
the changes, and later saves go to that copy.

## Notes / limitations

- **OCR** relies on the bundled Tesseract WASM. It works from local files, but
  threaded OCR may be limited on GitHub Pages (no cross-origin-isolation
  headers); it falls back to single-threaded where needed.
- **Cross-tab filename disambiguation** is effectively per-window in the PWA
  (each window has its own session storage) — a no-op, not a bug.
