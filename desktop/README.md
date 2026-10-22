# PDF+ (desktop app)

PDF+ is the PDF Viewer web app (`pwa/`) installed as a Windows program. It
runs the same shell and the same viewer (`viewer/`, `pdfjs/`), so every
tool, the text reader, case folders, citation links and OCR work as they do
in the web app. What changes is where the app comes from and what it can
reach:

- **Nothing comes from the internet.** The app's files are inside the
  installed program. A new version arrives only when you install one.
- **No network, but for updates you ask for.** PDF+ refuses every request a
  page makes that is not for its own files. Citation links open in your
  normal browser: Westlaw and Lexis+ straight away, any other link only
  after PDF+ asks. The one thing PDF+ itself fetches is a newer release,
  and only when you click **Check for updates**.
- **No browser extensions.** Nothing installed in Chrome can see the
  documents open in PDF+.
- **No permission prompts.** Files and folders you open can be saved without
  the browser asking again, and the text reader's 📷 Screenshot takes the
  PDF+ window without a screen-share prompt. A screenshot goes to Downloads.

PDF+ and the web app can be installed side by side. They are separate
programs, with separate settings, saved signatures and Recent lists.

## Installing it

1. Open the repository's **Releases** (on its GitHub page, right-hand side)
   and, under the newest **PDF+** release, download
   `PDFPlus-Setup-<version>.exe`.
2. Run it. It installs for your Windows user only, with no administrator
   rights, into `AppData\Local\Programs`, and adds PDF+ to the Start menu
   and the desktop.
3. Windows SmartScreen may say it protected your PC, because the installer
   is not code-signed: **More info → Run anyway**.

## Updating it

Home shows PDF+'s version and a **Check for updates** button. Nothing is
asked of GitHub until you click it. When a newer release exists, Home shows
its version and what changed, and **Download and install** fetches it. The
installer is checked against the SHA-512 published with the release before
it runs. **Restart and install** then closes PDF+ (asking first about any
document with unsaved changes), installs the update and opens PDF+ again.
If you keep PDF+ open instead, the update installs the next time it closes.

The button reads this repository's newest release, through GitHub's own
"latest release" link, so it works only while the repository is public. A
private repository needs a GitHub key in the app first.

PDF+ does not make itself the default app for PDFs, so double-clicking a
PDF still opens it where it opened before. To open a file in PDF+, use its
**Open a file** button, drop files on its window, or right-click a PDF in
Explorer → **Open with → Choose another app**, then **Choose an app on your
PC** and pick `PDF+.exe` in PDF+'s folder under `AppData\Local\Programs`
(after the first time, PDF+ is in the Open with list). Choose **Just once**,
not Always, while you are trying it. A file opened with the button or Open
with is saved straight back to itself and listed in Home's Recent list; a
dropped file asks where to save, as in the web app.

To remove it: Windows Settings → Apps → Installed apps → PDF+ → Uninstall.
Your settings stay in `AppData\Roaming\PDF+` unless you delete that folder.

**Developer tools:** F12, for finding out what went wrong.

## Not yet in this version

- File associations (making PDF+ the default for PDF, text and Markdown
  files).
- Code signing.

## Releases

Releases are automatic. Every change merged into `main` that touches the app
(`desktop/`, `pwa/`, `viewer/`, `pdfjs/`) becomes a new PDF+ release
(`.github/workflows/release-desktop.yml`): the tests run on Linux and
Windows, the installer is built, and a GitHub release tagged
`pdfplus-v<version>` is published with the installer, its blockmap and
`latest.yml`. Its notes are the commit subjects since the last release that
touched the app. Installed copies are offered it the next time someone
clicks **Check for updates**; nothing installs without that click.

The version goes up by one patch number each release (0.2.0, 0.2.1, …). For
a new minor or major version, set it in `desktop/package.json` (in
`desktop/`: `npm version 0.3.0 --no-git-tag-version`, which updates the
lockfile too); the next release takes it. Do not push `pdfplus-v*` tags by
hand. Builds on working branches are kept as their Actions run's artifact,
**PDF+ for Windows**, for 30 days, and are never released.

## How it is built

| File | Purpose |
|------|---------|
| `main.js` | Electron's main process: serves the app from inside itself (`pdfplus://app/`), shuts off the network, locks the pages down (sandboxed, no Node, a Content-Security-Policy), sends links to the browser, reads and writes the files Windows hands over, keeps one instance running, gives the reader's screenshot its own window, checks for and installs updates when asked (electron-updater). |
| `preload.js` | The pages' only bridge to the main process. |
| `shim.js` | Put first into every page by `main.js`: files Windows opens become handles the shell and viewer already know how to use, links leave for the browser, and Home gets the version and the update button. Shared files are not changed. |
| `assemble.mjs` | Copies the PWA's shell, `viewer/` and `pdfjs/` into `app/` (not kept in git), as `pwa/build-site.sh` does for GitHub Pages. |
| `package.json` | Electron and electron-builder versions, pinned, and the installer's settings. |
| `gen-icon.py`, `build/icon.png` | The icon: the web app's page with a red plus. |

`.github/workflows/build-desktop.yml` runs `test-desktop.mjs` on Linux and
Windows, then builds the installer, on every push to a working branch that
touches `desktop/`, `pwa/`, `viewer/` or `pdfjs/`; on `main`,
`release-desktop.yml` runs it and publishes the release (above). How the pieces work and why is in
`Design Notes/Desktop app.md`.

To run it from a checkout (Node 22):

```sh
cd desktop
npm ci
npm start              # assembles app/ and opens PDF+
npm run dist           # the installer, in dist/ (on Windows)
cd .. && node test-desktop.mjs
```
