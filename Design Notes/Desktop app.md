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

## App files from a checkout

`settings.json`'s `appFolder` (set on Home's App files row through a folder
dialog in the main process, never a path from a page) makes `fileFor` serve
the user's checkout in place of `app/`: `/index.html` and the other
`SHELL_FILES` and `/icons/` from `pwa/`, `/viewer/` and `/pdfjs/` from their
folders, and `citation-site-rules.js`, the files `assemble.mjs` copies. Each
prefix is confined to its own folder (`under`), so nothing else in the
checkout is served (`desktop/`, `.git`, `pwa/sw.js`). `shim.js` is always
the installed one.

The source is decided once, at start (`decideSource`), so every window runs
the same files; a change takes effect on Restart PDF+ (`pdfplus:restart`:
`app.relaunch` and `app.exit`). A relaunch cannot be called off once
scheduled, so the restart first asks every window's shell whether any tab
has unsaved changes (`anythingUnsaved`, through `executeJavaScript`) and
does nothing if one has. A chosen folder that fails `folderProblem` at
start is not used: PDF+ runs `app/` and Home shows the reason. Home also
shows the checkout's branch and commit, read from `.git` without git
(`gitHead`), and warns when the checkout's `desktop/package.json` is newer
than the installed version: a pull never replaces PDF+'s own program.

## No network

`lockDownSession` cancels every request that is not to `pdfplus://app/`,
`data:`, `blob:` or `devtools:` (`onBeforeRequest`), below the CSP, so a
window loaded some other way is refused too. Permissions: `fileSystem`,
the clipboard and fullscreen are granted, from the app's origin only, and
the screen share below; nothing else is. The update check (below) is the
one request PDF+ makes, from the main process in a session of its own.

## The reader's screenshot, and downloads

Hosted, the text reader's 📷 Screenshot asks for a screen share of its own
tab (`getDisplayMedia` on the shell's window, `shareThisTab`). Electron
refuses that unless it is answered: `setDisplayMediaRequestHandler` gives
the request its own window's top frame (`{ video: frame.top }`) and nothing
else, with no picker. Before that, Chromium asks the `media` permission:
**a screen share arrives as `media` with an empty `mediaTypes`**, a camera
or microphone with `video` or `audio` in it, so only the empty kind is
granted. The PNG it saves is a download; `will-download` puts every
download into Downloads under a free name (`freeName`: "name (1).png"),
with no dialog, as Chrome does.

## Links

A link never loads inside the app. Three paths lead to `openExternal`, which
opens `http`, `https` and `mailto` links in the default browser, at once for
`TRUSTED_LINK_HOSTS` (Westlaw, Lexis) and after a question for anything else,
and hands PDF-Linker's `pdf-linker:` link (the text reader's Re-run
PDF-Linker, `textdoc.rerunUrl`) to the program Windows registered for it, at
once (`APP_SCHEMES`). Any other scheme is refused:

- `window.open` is wrapped in every frame by `shim.js`. It answers as a
  browser does: a stand-in window object, or `null` for `noopener`. Without
  that, Shift+Space (`shift-space-open.js`, which counts what `window.open`
  hands back) would report every link as a blocked pop-up.
- A clicked `<a href>` to another origin is caught by the shim's `click`
  listener on `window`, after the page's own handlers (one that opens the
  link itself prevents the default, and the shim leaves it alone).
- **PDF-Linker not set up on the computer** (owner: "When I use the Re-run
  PDF-linker button I get a pop up saying I dont have an app to run it").
  `pdf-linker:` is registered per Windows user by PDF-Linker's
  `Register Reader Button.bat`; with none, Windows answered the link with
  its own "You'll need a new app" pop-up. `openExternal` now asks
  `app.getApplicationNameForProtocol` first and, where nothing is
  registered, puts up PDF+'s own message naming the .bat (OK, or Try anyway
  for a registration Windows can name no program for). Declined, it returns
  false, and the shim's `window.open` dispatches `pdfplus:link-refused` with
  the URL on the page's window, so the text reader's `rerunLinker` stops
  waiting for a run that will not come and says the same (no request file
  is left in the folder). Tests: `test-desktop.mjs` case 7,
  `test-folder-save.mjs` case 39.
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

## File dialogs start where the last one finished

Chrome opens a site's file dialogs where its last one finished; Electron
does not remember (every dialog started in Documents, which OneDrive often
holds). The shim wraps `showOpenFilePicker`, `showSaveFilePicker` and
`showDirectoryPicker` in every frame: unless the page gave its own
`startIn`, the dialog gets the handle the last dialog returned, kept in the
`pdfplus-pickers` IndexedDB store (shared by the shell and every tab, kept
across restarts, one per dialog `id`). A `PathFileHandle` given as
`startIn` is dropped for the last handle (Chromium refuses a handle it did
not make), and a start that fails (the folder gone) is asked again without
it. The real pickers sit in `window.__pdfplusPickers`, where the test puts a
stand-in dialog; that the real Windows dialog honours `startIn` is
Chromium's, and is not tested here.

## Windows and closing

New window and a tab pulled out of the strip use `window.open` with the
opener kept; `setWindowOpenHandler` allows app URLs as a window like the
first. Electron shows no dialog for `beforeunload`: the close is simply
refused. `will-prevent-unload` asks instead ("Close without saving" /
"Cancel"). There is no menu; F12 opens the developer tools.

## Updates

Home's version and **Check for updates** are drawn by the shim
(`updatesOnHome`); the checking is electron-updater's in `main.js`
("Updates"), asked through the bridge and never on its own. It reads
`latest.yml` from the URL in `package.json`'s `build.publish` (written into
the app's `app-update.yml`): the generic provider on
`…/releases/latest/download`, GitHub's link to the newest release's files,
so no API and no tag parsing; the catch is that every release in the
repository is taken for a PDF+ release. `latest.yml` names the installer
and its SHA-512, which electron-updater checks after the download; the
installer is not signed (`publisherName` unset), so no signature check is
made.

Releases are automatic: `release-desktop.yml` runs on every push to `main`
that touches the app. Its `version` job takes `desktop/package.json`'s
version where that is newer than the last `pdfplus-v*` tag, else the last
tag's with the patch one up; `build-desktop.yml`, called with that
`version`, stamps it on the build (`npm version`, not committed) and writes
the release notes (`build/release-notes.md`, the commit subjects since the
last tag), which are what the button shows; `publish` creates the tag on the
merged commit with the release. One run at a time (`concurrency`), so two
merges never compute the same version. `build-desktop.yml` no longer runs
by itself on `main`, which would build the same commit twice.

The installer's file name has no spaces or `+`
(`PDFPlus-Setup-<version>.exe`): GitHub renames such release assets, and
`latest.yml` would then name a file the release does not have.

`autoInstallOnAppQuit` stays on: a downloaded update that was not installed
at once (Cancel on the unsaved-changes question) installs when PDF+ next
closes. `PDFPLUS_UPDATE_CONFIG` points the updater at another
`app-update.yml` (tests; the unpackaged app has none and says so). The
Linux updater wants an AppImage, so the test hands it a stand-in path in
`APPIMAGE`; Windows CI runs the real Windows updater against the test's
local server.

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
CSP; the reader's screenshot in Downloads (and a camera still refused); the
update button against a local stand-in for the releases (up to date, then a
newer release shown with its notes and downloaded, never installed); the
unsaved-changes question on close; file dialogs starting where the last one
finished, in every tab and after a restart; and app files from a copy of the
repository (a wrong folder refused, Restart held over unsaved work, the
folder's files run from the next start, nothing outside its app folders
served, a pull taken up at the start after, a broken folder falling back). CI
(`.github/workflows/build-desktop.yml`) runs it on Linux and Windows before
building the installer.
