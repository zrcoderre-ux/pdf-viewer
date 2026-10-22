# PDF+ (desktop app)

PDF+ is the PDF Viewer web app (`pwa/`) installed as a Windows program. It
runs the same shell and the same viewer (`viewer/`, `pdfjs/`), so every
tool, the text reader, case folders, citation links and OCR work as they do
in the web app. What changes is where the app comes from and what it can
reach:

- **Nothing comes from the internet.** The app's files are inside the
  installed program. A new version arrives only when you install one.
- **No network at all.** PDF+ refuses every request that is not for its own
  files. Citation links open in your normal browser: Westlaw and Lexis+
  straight away, any other link only after PDF+ asks.
- **No browser extensions.** Nothing installed in Chrome can see the
  documents open in PDF+.
- **No permission prompts.** Files and folders you open can be saved without
  the browser asking again.

PDF+ and the web app can be installed side by side. They are separate
programs, with separate settings, saved signatures and Recent lists.

## Trying it

1. Open the repository's **Actions** tab, then the latest **Build PDF+
   (desktop)** run with a green check.
2. Under **Artifacts**, download **PDF+ for Windows** (you need to be signed
   in to GitHub). It is a zip with `PDF+ Setup <version>.exe` inside.
3. Run the setup file. It installs for your Windows user only, with no
   administrator rights, into `AppData\Local\Programs`, and adds PDF+ to the
   Start menu and the desktop.
4. Windows SmartScreen may say it protected your PC, because the installer
   is not code-signed: **More info → Run anyway**.

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
- An update button, and releases. For now each build is downloaded from its
  Actions run.
- Code signing.

## How it is built

| File | Purpose |
|------|---------|
| `main.js` | Electron's main process: serves the app from inside itself (`pdfplus://app/`), shuts off the network, locks the pages down (sandboxed, no Node, a Content-Security-Policy), sends links to the browser, reads and writes the files Windows hands over, keeps one instance running. |
| `preload.js` | The pages' only bridge to the main process. |
| `shim.js` | Put first into every page by `main.js`: files Windows opens become handles the shell and viewer already know how to use, and links leave for the browser. Shared files are not changed. |
| `assemble.mjs` | Copies the PWA's shell, `viewer/` and `pdfjs/` into `app/` (not kept in git), as `pwa/build-site.sh` does for GitHub Pages. |
| `package.json` | Electron and electron-builder versions, pinned, and the installer's settings. |
| `gen-icon.py`, `build/icon.png` | The icon: the web app's page with a red plus. |

`.github/workflows/build-desktop.yml` runs `test-desktop.mjs` on Linux and
Windows, then builds the installer, on every push that touches `desktop/`,
`pwa/`, `viewer/` or `pdfjs/`. How the pieces work and why is in
`Design Notes/Desktop app.md`.

To run it from a checkout (Node 22):

```sh
cd desktop
npm ci
npm start              # assembles app/ and opens PDF+
npm run dist           # the installer, in dist/ (on Windows)
cd .. && node test-desktop.mjs
```
