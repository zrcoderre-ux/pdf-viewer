// PDF+ — the desktop app's main process.
//
// PDF+ is the PWA's tabbed shell (pwa/index.html + app-web.js) and the
// canonical viewer (viewer/, pdfjs/) running in Electron instead of in Chrome
// from GitHub Pages: the same files, copied into app/ by assemble.mjs, served
// from inside the app and never fetched. What this file adds is what Chrome
// and the hosting gave the PWA, and the lockdown that is the point of having
// a desktop app at all:
//
//   - The pages are served from the app itself under pdfplus://app/, a
//     standard, secure scheme (storage, workers, fetch and the File System
//     Access API all need one), with a Content-Security-Policy, and with
//     shim.js injected first into every page (see shim.js).
//   - NO NETWORK. Every request that is not to pdfplus://app/ (or a data: or
//     blob: URL the page made itself) is cancelled. Links leave the app for
//     the default browser, never load in it: Westlaw and Lexis+ straight away
//     (citation links, Shift+Space), anything else after asking.
//   - The pages get no Node: sandboxed, context-isolated, and the only bridge
//     (preload.js) can read and write just the files Windows handed the app
//     (Open with, a double-click once PDF+ is the default) — never a path the
//     page names on its own. Files opened through the app's own pickers are
//     Chromium's File System Access handles, as in the PWA, with the
//     permission prompts answered yes.
//   - One instance: a file opened while PDF+ is running goes to the window
//     last used, as a new tab.
//   - Updates only when asked: Home's Check for updates button reads the
//     newest GitHub release (release-desktop.yml) and installs it on a click.
//     It is the one thing that goes on the network, from this process, never
//     from a page.
//   - Or the app's files from a folder: a checkout of this repository the
//     user picks on Home ("App files"), served in place of the built-in
//     copy, so a git pull and a restart bring PDF+ up to date with no
//     download and no GitHub release (see "Where the app's files come from").

"use strict";

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const SCHEME = "pdfplus";
const HOST = "app";
const ORIGIN = `${SCHEME}://${HOST}`;
const APP_DIR = path.join(__dirname, "app"); // assembled by assemble.mjs
const SHIM_PATH = "/__pdfplus/shim.js";
const ICON = path.join(__dirname, "build", "icon.png");
const APP_NAME = "PDF+";

// What Windows may hand the app: the PWA's file handlers, as in
// pwa/manifest.webmanifest.
const OPENABLE = /\.(pdf|txt|leak|md|markdown)$/i;

// Links that open in the browser without asking: the citation links' own
// targets (viewer/code-tables.js). Any other link is shown first.
const TRUSTED_LINK_HOSTS = [/(^|\.)westlaw\.com$/i, /(^|\.)lexis\.com$/i, /(^|\.)lexisnexis\.com$/i];
// PDF-Linker's own link (the text reader's Re-run PDF-Linker button,
// textdoc.rerunUrl), handed to the program Windows has registered for it.
// It carries a folder token and a nonce, and PDF-Linker runs only on the
// request file the reader writes beside it, so it goes without asking.
const APP_SCHEMES = ["pdf-linker:"];

// Content-Security-Policy for every page: scripts only from the app (plus
// WebAssembly, for OCR), nothing fetched from anywhere else. The network is
// shut in onBeforeRequest as well; this is what stops a script that got into
// a page from running at all.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
};

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
}]);

// A profile of its own, for tests (test-desktop.mjs): the single-instance
// lock, storage and the opened-files list all live in it.
if (process.env.PDFPLUS_USER_DATA) app.setPath("userData", process.env.PDFPLUS_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

// ---- Files Windows handed over ---------------------------------------------
//
// The bridge reads and writes only these. A path is granted when it arrives
// on the command line (the first launch, or a second one forwarded by the
// single-instance lock), and the grant is kept, so a file in the Recent list
// opens again after a restart. The newest GRANT_LIMIT are kept.

const GRANT_LIMIT = 500;
let grantsFile = "";
let grants = []; // newest first, as given (a path's case kept for display)

const pathKey = (p) => {
  const r = path.resolve(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
};

function loadGrants() {
  grantsFile = path.join(app.getPath("userData"), "opened-files.json");
  try {
    const list = JSON.parse(fs.readFileSync(grantsFile, "utf8"));
    if (Array.isArray(list)) grants = list.filter((p) => typeof p === "string");
  } catch { grants = []; }
}

function grant(p) {
  const k = pathKey(p);
  grants = [path.resolve(p), ...grants.filter((g) => pathKey(g) !== k)].slice(0, GRANT_LIMIT);
  try { fs.writeFileSync(grantsFile, JSON.stringify(grants, null, 1)); } catch { /* kept for this run */ }
}

function isGranted(p) {
  if (typeof p !== "string" || !p || !path.isAbsolute(p)) return false;
  const k = pathKey(p);
  return grants.some((g) => pathKey(g) === k);
}

/** The openable files on a command line: what Windows passes for "Open with"
 *  and a double-click. Chromium's own switches and anything that is not an
 *  existing file are not. */
function filesFromArgv(argv, cwd) {
  const args = argv.slice(process.defaultApp ? 2 : 1);
  const out = [];
  for (const a of args) {
    if (!a || a.startsWith("--") || !OPENABLE.test(a)) continue;
    const p = path.resolve(cwd || process.cwd(), a);
    try { if (fs.statSync(p).isFile()) out.push(p); } catch { /* not there */ }
  }
  return out;
}

// Files waiting for a window whose page has said it is ready for them.
const pending = [];
const readyContents = new Set();
let lastWindow = null;

function deliverFiles(paths) {
  if (!paths.length) return;
  for (const p of paths) grant(p);
  const files = paths.map((p) => ({ path: p, name: path.basename(p) }));
  const win = (lastWindow && !lastWindow.isDestroyed() && lastWindow) || BrowserWindow.getAllWindows()[0];
  if (win && readyContents.has(win.webContents.id)) {
    win.webContents.send("pdfplus:open-files", files);
  } else {
    pending.push(...files);
  }
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
}

// ---- Where the app's files come from ----------------------------------------
//
// Built in: app/, which assemble.mjs filled from the repository when the
// installer was made. Or a folder: the user's own checkout of this repository
// (settings.json's appFolder, chosen on Home through a folder dialog in this
// process, never a path a page names), read in place: pwa/'s shell files and
// icons, viewer/, pdfjs/ and citation-site-rules.js, the same files
// assemble.mjs copies, so a git pull is picked up at the next start.
// PDF+'s own program (this file, preload.js, shim.js, Electron) is always the
// installed one.
//
// Which it is is decided once, at start, so every window runs the same files;
// a change on Home takes effect on Restart. A folder that has gone, or lacks
// the app's files, is not used: PDF+ runs its own files and Home says why.

let settings = {};
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

function loadSettings() {
  try { settings = JSON.parse(fs.readFileSync(settingsFile(), "utf8")) || {}; } catch { settings = {}; }
}

function saveSettings() {
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 1));
}

// What a checkout must hold to be served (assemble.mjs copies the same).
const FOLDER_NEEDS = ["pwa/index.html", "pwa/app-web.js", "pwa/app-web.css", "viewer/viewer.html", "viewer/text-reader.html", "pdfjs/build/pdf.mjs", "citation-site-rules.js"];
const SHELL_FILES = new Set(["/index.html", "/manifest.webmanifest", "/app-web.js", "/app-web.css"]);

function folderProblem(dir) {
  if (!dir || !path.isAbsolute(dir)) return "it is not a folder";
  try { if (!fs.statSync(dir).isDirectory()) return "it is not a folder"; } catch { return "it is not there"; }
  for (const f of FOLDER_NEEDS) {
    if (!fs.existsSync(path.join(dir, f))) return `${f.split("/").join(path.sep)} is not in it (is it a copy of the pdf-viewer repository?)`;
  }
  return "";
}

// { folder } when the folder is in use; { wanted, problem } when it was set
// and could not be used.
let source = { folder: "" };

function decideSource() {
  const wanted = typeof settings.appFolder === "string" ? settings.appFolder : "";
  if (!wanted) return { folder: "" };
  const problem = folderProblem(wanted);
  return problem ? { folder: "", wanted, problem } : { folder: wanted };
}

/** `rel` under `base`, or null where it would leave it. */
function under(base, rel) {
  const f = path.normalize(path.join(base, rel));
  return f.startsWith(base + path.sep) ? f : null;
}

/** The file on disk for a path under pdfplus://app/, or null. */
function fileFor(rel) {
  if (rel === SHIM_PATH) return path.join(__dirname, "shim.js");
  const root = source.folder;
  if (!root) return under(APP_DIR, rel);
  if (SHELL_FILES.has(rel)) return path.join(root, "pwa", rel.slice(1));
  if (rel.startsWith("/icons/")) return under(path.join(root, "pwa", "icons"), rel.slice("/icons".length));
  if (rel.startsWith("/viewer/")) return under(path.join(root, "viewer"), rel.slice("/viewer".length));
  if (rel.startsWith("/pdfjs/")) return under(path.join(root, "pdfjs"), rel.slice("/pdfjs".length));
  if (rel === "/citation-site-rules.js") return path.join(root, "citation-site-rules.js");
  return null;
}

/** The checkout's branch and commit, read from .git (no git needed). */
function gitHead(dir) {
  try {
    const head = fs.readFileSync(path.join(dir, ".git", "HEAD"), "utf8").trim();
    const m = /^ref: refs\/heads\/(.+)$/.exec(head);
    if (!m) return { branch: "", commit: head.slice(0, 7) };
    let sha = "";
    try { sha = fs.readFileSync(path.join(dir, ".git", "refs", "heads", ...m[1].split("/")), "utf8").trim(); } catch {
      try {
        const packed = fs.readFileSync(path.join(dir, ".git", "packed-refs"), "utf8");
        const line = packed.split("\n").find((l) => l.endsWith(" refs/heads/" + m[1]));
        sha = line ? line.split(" ")[0] : "";
      } catch { sha = ""; }
    }
    return { branch: m[1], commit: sha.slice(0, 7) };
  } catch { return null; }
}

function folderVersion(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "desktop", "package.json"), "utf8")).version || ""; } catch { return ""; }
}

function sourceInfo() {
  const chosen = typeof settings.appFolder === "string" ? settings.appFolder : "";
  const shown = source.folder || chosen;
  return {
    appVersion: app.getVersion(),
    folder: source.folder,                                  // in use now
    chosen,                                                 // what settings say (from the next start)
    restartNeeded: chosen !== source.folder && !(source.problem && chosen === source.wanted),
    problem: source.problem && chosen === source.wanted ? source.problem : "",
    git: shown ? gitHead(shown) : null,
    folderVersion: shown ? folderVersion(shown) : "",
  };
}

// ---- Serving the app --------------------------------------------------------

function notFound() {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
}

async function serve(request) {
  const url = new URL(request.url);
  if (url.host !== HOST) return notFound();
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return notFound(); }
  if (rel === "/") rel = "/index.html";
  const file = fileFor(rel);
  if (!file) return notFound();
  let body;
  try { body = await fsp.readFile(file); } catch { return notFound(); }
  const ext = path.extname(file).toLowerCase();
  const headers = {
    "content-type": MIME[ext] || "application/octet-stream",
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "cache-control": "no-cache",
  };
  if (ext === ".html") {
    // shim.js goes in ahead of every script on the page.
    const html = body.toString("utf8").replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n<script src="${SHIM_PATH}"></script>`);
    return new Response(html, { headers });
  }
  return new Response(body, { headers });
}

// ---- Links ------------------------------------------------------------------

function isAppUrl(u) {
  return typeof u === "string" && u.startsWith(ORIGIN + "/");
}

/** A link the page wants opened: in the default browser, if it is a web or
 *  mail link at all, and after asking unless it goes to Westlaw or Lexis+;
 *  a pdf-linker: link to PDF-Linker. */
async function openExternal(raw, win) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (!["https:", "http:", "mailto:", ...APP_SCHEMES].includes(u.protocol)) return false;
  const parent = win && !win.isDestroyed() ? win : null;
  const ask = (opts) => (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts));
  // PDF-LINKER NOT SET UP ON THIS COMPUTER. Its link is handed to the program
  // Windows registered for it, which PDF-Linker's Register Reader Button.bat
  // does once per computer; with none, Windows put up its own "You'll need a
  // new app to open this pdf-linker link", which says nothing of what to do
  // (the owner: "I get a pop up saying I dont have an app to run it"). So the
  // registration is asked about first, and PDF+ says what to do. "Try anyway"
  // is there in case the question answers wrong (a registration Windows can
  // name no program for): it does what the button did before.
  if (APP_SCHEMES.includes(u.protocol) && !app.getApplicationNameForProtocol(u.href)) {
    const { response } = await ask({
      type: "warning",
      buttons: ["OK", "Try anyway"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: APP_NAME,
      message: "PDF-Linker is not set up on this computer for the Re-run PDF-Linker button.",
      detail: "Double-click Register Reader Button.bat in the PDF-Linker folder once (it needs no administrator rights), then press Re-run PDF-Linker again. Until then, double-click the Re-run PDF-Linker launcher in the case folder.\n\nThe reader saves your changes either way, and the folder stays open.",
    });
    if (response !== 1) return false;
  }
  const trusted = APP_SCHEMES.includes(u.protocol)
    || (u.protocol === "https:" && TRUSTED_LINK_HOSTS.some((re) => re.test(u.hostname)));
  if (!trusted) {
    const opts = {
      type: "question",
      buttons: ["Open in browser", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: APP_NAME,
      message: "Open this link in your web browser?",
      detail: u.href.length > 400 ? u.href.slice(0, 400) + "…" : u.href,
    };
    const { response } = await ask(opts);
    if (response !== 0) return false;
  }
  await shell.openExternal(u.href);
  return true;
}

// ---- Windows ----------------------------------------------------------------

function webPreferences() {
  return {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    safeDialogs: true,
    spellcheck: true,
  };
}

function windowOptions(extra = {}) {
  return {
    width: 1280,
    height: 860,
    minWidth: 480,
    minHeight: 360,
    title: APP_NAME,
    backgroundColor: "#16181c",
    autoHideMenuBar: true,
    icon: process.platform === "win32" ? undefined : ICON, // Windows takes the .exe's own
    ...extra,
    webPreferences: webPreferences(),
  };
}

function trackWindow(win) {
  win.on("focus", () => { lastWindow = win; });
  win.on("closed", () => { if (lastWindow === win) lastWindow = null; });
  // The window wears the document's name, as the PWA's does; Home is PDF+.
  win.on("page-title-updated", (e, title) => {
    e.preventDefault();
    const t = String(title || "").trim();
    win.setTitle(!t || t === "PDF Viewer" || t === APP_NAME ? APP_NAME : `${t} — ${APP_NAME}`);
  });
}

function createWindow() {
  const win = new BrowserWindow(windowOptions());
  trackWindow(win);
  lastWindow = win;
  win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

// Every page in every window, including the tabs' iframes and windows the
// app opens itself (New window, a tab pulled out of the strip).
function guardContents(contents) {
  const id = contents.id;
  contents.on("destroyed", () => readyContents.delete(id));

  contents.setWindowOpenHandler(({ url }) => {
    // Another window of the app: allowed, as a window like the first, with
    // its opener kept (the tab handoff talks to it by postMessage).
    if (isAppUrl(url) || url.startsWith(`blob:${ORIGIN}/`)) {
      return { action: "allow", overrideBrowserWindowOptions: windowOptions() };
    }
    openExternal(url, BrowserWindow.fromWebContents(contents)).catch(() => {});
    return { action: "deny" };
  });
  contents.on("did-create-window", (win) => trackWindow(win));

  // No page ever leaves the app: a link followed in place goes to the browser.
  const stay = (e, url) => {
    url = String(url || "");
    if (isAppUrl(url) || url.startsWith("about:") || url.startsWith("blob:") || url.startsWith("data:")) return;
    e.preventDefault();
    openExternal(url, BrowserWindow.fromWebContents(contents)).catch(() => {});
  };
  contents.on("will-navigate", (e) => stay(e, e.url));
  contents.on("will-frame-navigate", (e) => { if (!e.isMainFrame) stay(e, e.url); });
  contents.on("will-redirect", (e) => stay(e, e.url));
  contents.on("will-attach-webview", (e) => e.preventDefault());

  // Chromium shows no dialog for beforeunload in Electron: the close is just
  // refused. Ask, as Chrome does for the PWA when a tab has unsaved changes.
  contents.on("will-prevent-unload", (e) => {
    const win = BrowserWindow.fromWebContents(contents);
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: ["Close without saving", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: APP_NAME,
      message: "Some documents in this window have changes that are not saved.",
      detail: "Close the window anyway? The changes will be lost.",
    });
    if (choice === 0) e.preventDefault();
  });

  // Developer tools (F12), for finding out what went wrong. There is no menu.
  contents.on("before-input-event", (e, input) => {
    if (input.type === "keyDown" && input.key === "F12") {
      contents.toggleDevTools();
      e.preventDefault();
    }
  });
}

// ---- The bridge (preload.js) ------------------------------------------------

function fromApp(event) {
  const url = event.senderFrame && event.senderFrame.url;
  return isAppUrl(url);
}

function registerIpc() {
  ipcMain.handle("pdfplus:read", async (event, p) => {
    if (!fromApp(event) || !isGranted(p)) throw new Error("PDF+ has not been given that file.");
    const [bytes, st] = await Promise.all([fsp.readFile(p), fsp.stat(p)]);
    return { bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), lastModified: st.mtimeMs, size: st.size };
  });

  // Written beside the file and moved over it, so a save that fails part way
  // leaves the file as it was (Chrome's File System Access writes the same
  // way, through a .crswap file).
  ipcMain.handle("pdfplus:write", async (event, p, bytes) => {
    if (!fromApp(event) || !isGranted(p)) throw new Error("PDF+ has not been given that file.");
    if (!(bytes instanceof Uint8Array)) throw new TypeError("bytes must be a Uint8Array");
    const tmp = path.join(path.dirname(p), `.${path.basename(p)}.${crypto.randomBytes(4).toString("hex")}.pdfplus-tmp`);
    try {
      await fsp.writeFile(tmp, bytes);
      await fsp.rename(tmp, p);
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
    const st = await fsp.stat(p);
    return { lastModified: st.mtimeMs, size: st.size };
  });

  ipcMain.handle("pdfplus:open-external", (event, url) => {
    if (!fromApp(event)) return false;
    return openExternal(url, BrowserWindow.fromWebContents(event.sender));
  });

  // A window's shell is ready for files: hand it any that came before it was.
  ipcMain.on("pdfplus:open-files-ready", (event) => {
    if (!fromApp(event) || event.senderFrame !== event.sender.mainFrame) return;
    readyContents.add(event.sender.id);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (pending.length && (!lastWindow || lastWindow === win || lastWindow.isDestroyed())) {
      event.sender.send("pdfplus:open-files", pending.splice(0));
    }
  });
}

// ---- Updates ----------------------------------------------------------------
//
// Asked for on Home (shim.js), never on its own. electron-updater reads
// latest.yml from where app-update.yml points (package.json build.publish:
// the newest GitHub release, by GitHub's own "latest" link), and checks the
// installer it downloads against the SHA-512 in it before running it. It
// runs in a session of its own, so the pages' network block does not apply
// to it and it does not apply to the pages.
//
// PDFPLUS_UPDATE_CONFIG points it at another app-update.yml, for tests
// (test-desktop.mjs) and for the unpackaged app, which has none.

let updater = null;

function getUpdater() {
  if (updater) return updater;
  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true; // downloaded and not yet installed: installed when PDF+ closes
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;
  autoUpdater.on("error", () => {}); // reported through the call that failed
  if (process.env.PDFPLUS_UPDATE_CONFIG) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.updateConfigPath = process.env.PDFPLUS_UPDATE_CONFIG;
  }
  updater = autoUpdater;
  return updater;
}

/** Release notes as plain text: latest.yml may hold a string or, across
 *  several versions, a list of them. */
function notesText(notes) {
  if (!notes) return "";
  if (Array.isArray(notes)) return notes.map((n) => (n && n.note) || "").filter(Boolean).join("\n\n");
  return String(notes);
}

function updateError(e) {
  const msg = String((e && e.message) || e || "").split("\n")[0];
  if (/\b404\b|Cannot find latest/i.test(msg)) return "no PDF+ release has been published yet.";
  if (/ENOTFOUND|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ECONNREFUSED|ETIMEDOUT/i.test(msg)) return "GitHub could not be reached. Is this computer online?";
  return msg || "unknown error";
}

function registerUpdateIpc() {
  ipcMain.handle("pdfplus:version", (event) => (fromApp(event) ? app.getVersion() : ""));

  ipcMain.handle("pdfplus:update-check", async (event) => {
    if (!fromApp(event)) return { status: "error", message: "not allowed" };
    if (!app.isPackaged && !process.env.PDFPLUS_UPDATE_CONFIG) {
      return { status: "unavailable", message: "Updates work in the installed PDF+, not in one run from its source." };
    }
    try {
      const r = await getUpdater().checkForUpdates();
      const info = r && r.updateInfo;
      if (!r || !r.isUpdateAvailable || !info) return { status: "none", version: app.getVersion() };
      return { status: "available", version: info.version, current: app.getVersion(), notes: notesText(info.releaseNotes), date: info.releaseDate || "" };
    } catch (e) {
      return { status: "error", message: updateError(e) };
    }
  });

  ipcMain.handle("pdfplus:update-download", async (event) => {
    if (!fromApp(event)) return { status: "error", message: "not allowed" };
    const u = getUpdater();
    const progress = (p) => {
      if (!event.sender.isDestroyed()) event.sender.send("pdfplus:update-progress", Math.floor((p && p.percent) || 0));
    };
    u.on("download-progress", progress);
    try {
      await u.downloadUpdate();
      return { status: "downloaded" };
    } catch (e) {
      return { status: "error", message: updateError(e) };
    } finally {
      u.removeListener("download-progress", progress);
    }
  });

  // Closes every window (a window with unsaved changes asks first, and
  // Cancel keeps PDF+ open: the update then installs when it next closes),
  // installs without the installer's own window, and opens PDF+ again.
  ipcMain.handle("pdfplus:update-install", (event) => {
    if (!fromApp(event) || !updater) return false;
    setImmediate(() => updater.quitAndInstall(true, true));
    return true;
  });
}

// ---- App files and restarting (Home) ----------------------------------------

/** Whether any window has a document with unsaved changes. */
async function anythingUnsaved() {
  const probe = `[...document.querySelectorAll("#tab-views iframe")].some((f) => {
    try {
      const w = f.contentWindow;
      return !!((w.__pdfViewerHasUnsaved && w.__pdfViewerHasUnsaved()) || (w.__textReaderHasUnsaved && w.__textReaderHasUnsaved()));
    } catch { return false; }
  })`;
  for (const win of BrowserWindow.getAllWindows()) {
    try { if (await win.webContents.executeJavaScript(probe)) return true; } catch { /* not a shell */ }
  }
  return false;
}

function registerSourceIpc() {
  ipcMain.handle("pdfplus:source", (event) => (fromApp(event) ? sourceInfo() : null));

  ipcMain.handle("pdfplus:source-choose", async (event) => {
    if (!fromApp(event)) return null;
    const win = BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showOpenDialog(win, {
      title: "Choose your copy of the pdf-viewer repository",
      buttonLabel: "Use this folder",
      properties: ["openDirectory"],
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ...sourceInfo(), canceled: true };
    const dir = r.filePaths[0];
    const problem = folderProblem(dir);
    if (problem) return { ...sourceInfo(), refused: `${dir} cannot be used: ${problem}.` };
    settings.appFolder = dir;
    saveSettings();
    return sourceInfo();
  });

  ipcMain.handle("pdfplus:source-builtin", (event) => {
    if (!fromApp(event)) return null;
    delete settings.appFolder;
    saveSettings();
    return sourceInfo();
  });

  // Restart, to take the new setting or a git pull. Not over unsaved work:
  // a relaunch cannot be called off once asked for, so the windows are asked
  // first and nothing happens while a document has changes.
  ipcMain.handle("pdfplus:restart", async (event) => {
    if (!fromApp(event)) return { ok: false };
    if (await anythingUnsaved()) return { ok: false, why: "unsaved" };
    app.relaunch();
    app.exit(0);
    return { ok: true };
  });
}

// ---- Start ------------------------------------------------------------------

function lockDownSession(ses) {
  // No network: the app's own files, and URLs the page made from its own data.
  ses.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const ok = isAppUrl(u) || u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("devtools:");
    cb({ cancel: !ok });
  });
  // Files: yes, as the PWA's user always answers (open, save, a case folder).
  // Clipboard: copying, and the viewer's own paste. Nothing else is asked
  // for, but for the reader's screenshot (below).
  const allowed = new Set(["fileSystem", "clipboard-sanitized-write", "clipboard-read", "fullscreen"]);
  ses.setPermissionCheckHandler((_wc, permission, origin) => allowed.has(permission) && isAppUrl(String(origin || "").replace(/\/?$/, "/")));
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    const from = (details && details.requestingUrl) || (wc && wc.getURL()) || "";
    // A screen share (getDisplayMedia) asks for "media" with no camera or
    // microphone in it; setDisplayMediaRequestHandler then gives it the
    // app's own window and nothing else. A camera or a microphone is refused.
    const share = permission === "media" && details && Array.isArray(details.mediaTypes) && details.mediaTypes.length === 0;
    cb((allowed.has(permission) || share) && isAppUrl(from));
  });

  // The text reader's 📷 Screenshot asks for a screen share of its own tab
  // (getDisplayMedia, text-reader.js shareThisTab), which is how a hosted
  // page gets a picture of itself. Here it gets its own window, without the
  // share picker, and nothing else: no other window, no screen, no sound.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const frame = request.frame;
    if (!frame || !isAppUrl(frame.url) || !request.videoRequested) return callback(null);
    callback({ video: frame.top || frame });
  });

  // A download (the screenshot's PNG; a file saved where there is no save
  // picker) goes into Downloads with no question, as Chrome's do, under a
  // name of its own: "name (1).png" beside a "name.png" already there.
  ses.on("will-download", (_e, item) => {
    item.setSavePath(freeName(app.getPath("downloads"), item.getFilename() || "download"));
  });
}

function freeName(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 0; ; i++) {
    const p = path.join(dir, i ? `${stem} (${i})${ext}` : name);
    if (!fs.existsSync(p)) return p;
  }
}

function start() {
  if (process.platform === "win32") app.setAppUserModelId("com.zrcoderre.pdfplus");
  Menu.setApplicationMenu(null);

  app.on("second-instance", (_e, argv, cwd) => {
    const files = filesFromArgv(argv, cwd);
    if (files.length) deliverFiles(files);
    else {
      const win = (lastWindow && !lastWindow.isDestroyed() && lastWindow) || BrowserWindow.getAllWindows()[0];
      if (win) { if (win.isMinimized()) win.restore(); win.focus(); } else createWindow();
    }
  });

  app.on("web-contents-created", (_e, contents) => guardContents(contents));
  app.on("window-all-closed", () => app.quit());

  app.whenReady().then(() => {
    loadGrants();
    loadSettings();
    source = decideSource();
    lockDownSession(session.defaultSession);
    protocol.handle(SCHEME, serve);
    registerIpc();
    registerUpdateIpc();
    registerSourceIpc();
    const first = filesFromArgv(process.argv, process.cwd());
    for (const p of first) grant(p);
    pending.push(...first.map((p) => ({ path: p, name: path.basename(p) })));
    createWindow();
  });
}
