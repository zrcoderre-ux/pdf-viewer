# PDF+, the desktop app (`desktop/`)

PDF+ is the PWA's shell (`pwa/index.html`, `app-web.js`) and the canonical
viewer running in Electron. No shared file was changed to make it: the
differences live in `desktop/main.js`, `preload.js` and `shim.js`, and
`assemble.mjs` copies the shared files into `desktop/app/` the way
`pwa/build-site.sh` copies them for GitHub Pages. A change to `viewer/` or
`pwa/` reaches PDF+ on its next build; nothing in `desktop/` reaches the PWA.
`desktop/README.md` says how to install, run and build it.

## Serving the app

`main.js` registers `pdfplus` as a standard, secure scheme and serves
`pdfplus://app/<path>` from `desktop/app/` (`serve`). A standard scheme is
what gives the pages localStorage, IndexedDB, workers, `fetch` and the File
System Access API; `file://` would not. Every response carries the
Content-Security-Policy in `CSP`; every HTML response gets
`<script src="/__pdfplus/shim.js">` put in right after `<head>`, so the shim
runs before `theme-boot.js` and the page's modules. The service worker is
not copied (`assemble.mjs`): `app-web.js` still tries to register it and
logs a warning, which `test-desktop.mjs` ignores.

The CSP allows scripts only from the app, plus `'wasm-unsafe-eval'` for
Tesseract, and no `'unsafe-eval'`: pdf.js and Tesseract's worker test for
`new Function` and fall back. `test-desktop.mjs` runs OCR and fails on any
CSP refusal in the console, so a feature that needs more shows up there.

## No network

`lockDownSession` cancels every request that is not to `pdfplus://app/`,
`data:`, `blob:` or `devtools:` (`onBeforeRequest`), below the CSP, so a
window loaded some other way is refused too. Permissions: `fileSystem`,
the clipboard and fullscreen are granted, from the app's origin only;
nothing else is.

## Links

A link never loads inside the app. Three paths lead to `openExternal`, which
opens `http`, `https` and `mailto` links in the default browser, at once for
`TRUSTED_LINK_HOSTS` (Westlaw, Lexis) and after a question for anything else:

- `window.open` is wrapped in every frame by `shim.js`. It answers as a
  browser does: a stand-in window object, or `null` for `noopener`. Without
  that, Shift+Space (`shift-space-open.js`, which counts what `window.open`
  hands back) would report every link as a blocked pop-up.
- A clicked `<a href>` to another origin is caught by the shim's `click`
  listener on `window`, after the page's own handlers (one that opens the
  link itself prevents the default, and the shim leaves it alone).
- `setWindowOpenHandler`, `will-navigate` and `will-frame-navigate` in
  `guardContents` are the backstop. **`will-frame-navigate` was not emitted
  for a link clicked in a tab's iframe** in Electron 44 (the navigation went
  ahead and the network block left the frame on an error page), which is why
  the shim's click listener exists.

## Files Windows hands over: `PathFileHandle`

Electron has no `launchQueue`, and nothing can make a real
`FileSystemFileHandle` from a path. So a file on the command line (Open
with; a second launch, forwarded by the single-instance lock) becomes a
`PathFileHandle` in `shim.js`: `kind`, `name`, `getFile`, `createWritable`,
`queryPermission`, `requestPermission`, `isSameEntry`, carried out by the
main process on that one path. The shim feeds these to the shell through a
`launchQueue` of its own, so `app-web.js`'s existing consumer opens them
(a tab, the Recent list) exactly as the PWA's file handler does.

- **Chromium already defines `window.launchQueue`**, and nothing in Electron
  feeds it, so the shim replaces it unconditionally; testing
  `"launchQueue" in window` first left the files unopened.
- **Grants.** The bridge reads and writes only paths the main process was
  given on a command line (`grant`, `isGranted`), kept newest first in
  `opened-files.json` in the profile (500 at most) so Recent works after a
  restart. A page cannot name a path of its own.
- **Writing.** `PathWritable` gathers the writes in memory and sends them at
  `close()`; `main.js` writes beside the file and renames over it, as
  Chrome's File System Access does with its `.crswap` file.
- **Frames.** The handle is made in the shell's frame and used in a tab's
  iframe, whose `Blob` and `ArrayBuffer` are not the shell's. `toBytes` tells
  them apart by `Object.prototype.toString`, not `instanceof`: the
  `instanceof Blob` test failed on the viewer's Save blob, the write threw,
  and the viewer fell back to the save picker.
- **Stored or sent.** IndexedDB (Recent, the text reader's stores) and
  `postMessage` (a tab moved to a new window) copy a `PathFileHandle` as a
  plain object: its own properties survive, its prototype does not. The shim
  wraps the getters of `IDBRequest.result`, `IDBCursorWithValue.value` and
  `MessageEvent.data` and puts the prototype back on any plain object that
  has `kind: "file"` and a `__pdfplusPath` (`revive`, three levels deep).
- `isSameEntry` against a real handle compares paths through
  `webUtils.getPathForFile` on the handle's file.

Files opened through the app's own pickers, Save As and case folders are
Chromium's real File System Access handles, as in the PWA, and need none of
this; the `fileSystem` permission handler answers their prompts yes.

## Windows and closing

New window and a tab pulled out of the strip use `window.open` with the
opener kept; `setWindowOpenHandler` allows app URLs as a window like the
first. Electron shows no dialog for `beforeunload`: the close is simply
refused. `will-prevent-unload` asks instead ("Close without saving" /
"Cancel"). There is no menu; F12 opens the developer tools.

## Packaging

`package.json` pins Electron and electron-builder. The installer is NSIS,
one-click, per user (`perMachine: false`), so it needs no administrator
rights. `electronFuses` turns off `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and
the inspector switches, and makes the app load only from its asar, checked
against the integrity hash electron-builder embeds. Playwright cannot drive
a packaged build (it needs the inspector), so `test-desktop.mjs` runs the
unpacked app from `desktop/`.

## Tests

`test-desktop.mjs` launches the app with Playwright's Electron driver
(`PDFPLUS_USER_DATA` gives it a profile of its own) and covers: a PDF from
the command line opened and saved in place with a sticky note; Recent; a
second launch handing its files over; a text export in the reader; the
bridge refusing a file it was not given; no network; links; a handle sent by
`postMessage`; a tab moved to a new window and saved there; OCR under the
CSP; and the unsaved-changes question on close. CI
(`.github/workflows/build-desktop.yml`) runs it on Linux and Windows before
building the installer.
