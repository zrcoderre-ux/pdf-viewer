// PDF+ — what the pages need from the desktop that Chrome gave the PWA.
//
// main.js puts this script first into every page it serves (the shell and
// every viewer and text-reader tab), so it runs before any of the page's own
// code. It changes nothing in the shared files: the shell and the viewer run
// exactly as in the PWA, and this supplies the few things that differ.
//
// FILES WINDOWS OPENS. In the PWA a PDF opened from Explorer arrives through
// the launchQueue as a FileSystemFileHandle, and Save writes back through it.
// Electron has no launchQueue, and no way to make a real handle from a path.
// So a file Windows hands PDF+ arrives as a PathFileHandle: the same methods
// the shell and the viewer call on a real one (getFile, createWritable,
// queryPermission, requestPermission, isSameEntry, kind, name), carried out
// by the main process on that one path, and fed to the shell through a
// launchQueue of our own, so app-web.js's own launchQueue consumer opens it
// as it would in the PWA (a tab, and a place in the Recent list).
//
// A HANDLE THAT IS STORED OR SENT. The shell keeps Recent files in IndexedDB
// and hands a tab to a new window by postMessage, and the text reader keeps
// handles in IndexedDB too. A real handle survives that copy; a PathFileHandle
// comes back as a plain object with its data (kind, name, the path) and none
// of its methods. So whatever IndexedDB or a message hands back is looked
// over, and such an object is given its methods again (revive).
//
// LINKS. A link the page opens with window.open goes to the default browser
// through the main process (which asks first, unless it is Westlaw or
// Lexis+). window.open is answered as a browser answers an opened tab (a
// window object, or null for noopener), so Shift+Space counts what it opened
// instead of reporting the links blocked as pop-ups.
(() => {
  "use strict";

  /** The bridge from preload.js. It is in each window's top frame; a tab's
   *  iframe reaches it through its parent (same origin). */
  function native() {
    let w = window;
    for (let i = 0; i < 8 && w; i++) {
      try { if (w.pdfplusNative) return w.pdfplusNative; } catch { return null; }
      if (w === w.parent) break;
      w = w.parent;
    }
    return null;
  }
  if (!native()) return; // not in PDF+ (a page opened some other way)

  const MARK = "__pdfplusPath";
  const WIN = native().platform === "win32";
  const samePath = (a, b) => {
    const n = (p) => String(p).replace(/[\\/]+$/, "");
    return WIN ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
  };
  const mimeOf = (name) =>
    /\.pdf$/i.test(name) ? "application/pdf"
      : /\.(md|markdown)$/i.test(name) ? "text/markdown"
        : /\.(txt|leak)$/i.test(name) ? "text/plain" : "";

  // ---- PathFileHandle -------------------------------------------------------

  // Its data is own properties, so a structured copy (IndexedDB, postMessage)
  // keeps them; its methods are on the prototype, which revive() puts back.
  class PathFileHandle {
    constructor(p, name) {
      this.kind = "file";
      this.name = name;
      this[MARK] = p;
    }
    async getFile() {
      const r = await native().readFile(this[MARK]);
      return new File([r.bytes], this.name, { type: mimeOf(this.name), lastModified: Math.round(r.lastModified) });
    }
    async createWritable(opts = {}) {
      const w = new PathWritable(this);
      if (opts && opts.keepExistingData) w._buf = new Uint8Array(await (await this.getFile()).arrayBuffer());
      w._len = w._buf.length;
      return w;
    }
    async queryPermission() { return "granted"; }
    async requestPermission() { return "granted"; }
    async isSameEntry(other) {
      if (!other || other.kind !== this.kind) return false;
      let p = typeof other[MARK] === "string" ? other[MARK] : "";
      if (!p && typeof other.getFile === "function") {
        try { p = native().pathForFile(await other.getFile()); } catch { p = ""; }
      }
      return !!p && samePath(p, this[MARK]);
    }
  }

  // What is written comes from the tab's own frame, whose Blob and
  // ArrayBuffer are not this frame's: tell them apart by what they are, not
  // by instanceof.
  const tag = (x) => Object.prototype.toString.call(x);
  const isBlob = (x) => x && typeof x === "object" && /^\[object (Blob|File)\]$/.test(tag(x));
  const isBuffer = (x) => tag(x) === "[object ArrayBuffer]" || tag(x) === "[object SharedArrayBuffer]";

  async function toBytes(data) {
    if (isBlob(data)) return new Uint8Array(await data.arrayBuffer());
    if (isBuffer(data)) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (typeof data === "string") return new TextEncoder().encode(data);
    throw new TypeError("PDF+: cannot write " + tag(data));
  }

  // FileSystemWritableFileStream's methods, gathered in memory and written in
  // one go at close() (main.js writes beside the file and moves it over).
  class PathWritable {
    constructor(handle) {
      this._handle = handle;
      this._buf = new Uint8Array(0);
      this._len = 0;
      this._pos = 0;
      this._done = false;
    }
    _room(n) {
      if (n <= this._buf.length) return;
      const next = new Uint8Array(Math.max(n, this._buf.length * 2, 1024));
      next.set(this._buf.subarray(0, this._len));
      this._buf = next;
    }
    async write(data) {
      if (this._done) throw new TypeError("PDF+: the file is already closed");
      if (data && typeof data === "object" && typeof data.type === "string"
        && !isBlob(data) && !ArrayBuffer.isView(data) && !isBuffer(data)) {
        if (data.type === "seek") return this.seek(data.position);
        if (data.type === "truncate") return this.truncate(data.size);
        if (data.type !== "write") throw new TypeError("PDF+: unknown write " + data.type);
        if (data.position != null) this._pos = Number(data.position);
        data = data.data;
      }
      const bytes = await toBytes(data);
      const end = this._pos + bytes.length;
      this._room(end);
      if (this._pos > this._len) this._buf.fill(0, this._len, this._pos);
      this._buf.set(bytes, this._pos);
      this._pos = end;
      this._len = Math.max(this._len, end);
    }
    async seek(position) { this._pos = Number(position); }
    async truncate(size) {
      size = Number(size);
      this._room(size);
      if (size > this._len) this._buf.fill(0, this._len, size);
      this._len = size;
      if (this._pos > size) this._pos = size;
    }
    async close() {
      if (this._done) throw new TypeError("PDF+: the file is already closed");
      this._done = true;
      await native().writeFile(this._handle[MARK], this._buf.slice(0, this._len));
    }
    async abort() { this._done = true; this._buf = new Uint8Array(0); }
  }

  // ---- revive: a stored or sent PathFileHandle gets its methods back ---------

  function revive(v, depth) {
    if (!v || typeof v !== "object" || depth > 3) return;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length && i < 2000; i++) revive(v[i], depth + 1);
      return;
    }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return;
    if (v.kind === "file" && typeof v[MARK] === "string") {
      Object.setPrototypeOf(v, PathFileHandle.prototype);
      return;
    }
    let n = 0;
    for (const k in v) {
      if (++n > 64) break;
      const x = v[k];
      if (x && typeof x === "object") revive(x, depth + 1);
    }
  }
  function reviveGetter(proto, prop) {
    const d = proto && Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.get) return;
    Object.defineProperty(proto, prop, {
      ...d,
      get() {
        const v = d.get.call(this);
        try { revive(v, 0); } catch { /* left as it came */ }
        return v;
      },
    });
  }
  reviveGetter(window.IDBRequest && IDBRequest.prototype, "result");
  reviveGetter(window.IDBCursorWithValue && IDBCursorWithValue.prototype, "value");
  reviveGetter(window.MessageEvent && MessageEvent.prototype, "data");

  // ---- links ----------------------------------------------------------------

  const nativeOpen = window.open;
  window.open = function open(url, target, features) {
    let u = null;
    try { u = new URL(url == null || url === "" ? "about:blank" : String(url), location.href); } catch { u = null; }
    if (!u || u.origin === location.origin || u.protocol === "blob:" || u.protocol === "about:") {
      return nativeOpen.apply(window, arguments);
    }
    // The web, mail, and PDF-Linker's own pdf-linker: link (main.js APP_SCHEMES).
    if (!/^(https?|mailto|pdf-linker):$/.test(u.protocol)) return null;
    native().openExternal(u.href).catch(() => {});
    if (/(^|,)\s*(noopener|noreferrer)\s*(=\s*(yes|1|true))?\s*(,|$)/i.test(String(features || ""))) return null;
    // What a browser hands back for a tab that opened elsewhere.
    return {
      closed: false,
      opener: null,
      focus() {},
      blur() {},
      close() { this.closed = true; },
      postMessage() {},
    };
  };

  // A link clicked in a page leaves for the browser the same way, rather than
  // taking the tab's frame (and the document in it) with it. After the page's
  // own handlers: a link the page opens itself has its default prevented.
  window.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || a.hasAttribute("download")) return;
    let u;
    try { u = new URL(a.href, location.href); } catch { return; }
    if (u.origin === location.origin || /^(blob|about|javascript|data):$/.test(u.protocol)) return;
    e.preventDefault();
    window.open(u.href, "_blank", "noopener");
  });

  // ---- file dialogs: start where the last one finished ----------------------
  //
  // Chrome opens a site's file dialogs where its last one finished; Electron
  // does not remember, so every Open and Save started in Documents. So each
  // dialog here is given `startIn` (the handle the last dialog returned, kept
  // in IndexedDB across restarts, one per dialog `id`), unless the page gave
  // its own. A PathFileHandle as `startIn` (a file Windows opened) is not a
  // handle Chromium knows and would be refused, so the last one stands in.
  // A folder since moved or deleted: the dialog is asked again without it.
  // The pickers are called through window.__pdfplusPickers so a test can
  // stand in for the dialog itself.
  const PICK_DB = "pdfplus-pickers";
  const pickDb = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(PICK_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("last");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  async function lastPicked(id) {
    try {
      const db = await pickDb();
      return await new Promise((resolve) => {
        const r = db.transaction("last").objectStore("last").get(id || "");
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
      });
    } catch { return null; }
  }
  async function rememberPicked(id, handle) {
    try {
      const db = await pickDb();
      db.transaction("last", "readwrite").objectStore("last").put(handle, id || "");
    } catch { /* not remembered: the next dialog starts in Documents */ }
  }
  const pickers = { open: window.showOpenFilePicker, save: window.showSaveFilePicker, directory: window.showDirectoryPicker };
  Object.defineProperty(window, "__pdfplusPickers", { value: pickers });
  for (const [kind, name] of [["open", "showOpenFilePicker"], ["save", "showSaveFilePicker"], ["directory", "showDirectoryPicker"]]) {
    if (typeof pickers[kind] !== "function") continue;
    window[name] = async function (options) {
      const opts = { ...(options || {}) };
      if (opts.startIn && typeof opts.startIn === "object" && typeof opts.startIn[MARK] === "string") delete opts.startIn;
      const given = !!opts.startIn;
      if (!given) {
        const last = await lastPicked(opts.id);
        if (last) opts.startIn = last;
      }
      let result;
      try {
        result = await pickers[kind].call(window, opts);
      } catch (e) {
        if ((e && e.name === "AbortError") || given || !opts.startIn) throw e;
        delete opts.startIn;
        result = await pickers[kind].call(window, opts);
      }
      const first = Array.isArray(result) ? result[0] : result;
      if (first && typeof first === "object" && first.kind) rememberPicked(opts.id, first);
      return result;
    };
  }

  // ---- the shell: files from Windows, and its name ---------------------------

  const isShell = window.top === window && /^\/(index\.html)?$/.test(location.pathname);
  if (!isShell) return;

  // Chromium has a launchQueue of its own, which nothing in Electron feeds.
  {
    let consumer = null;
    const queue = [];
    const launch = (params) => {
      if (consumer) { try { consumer(params); } catch (e) { console.error(e); } }
      else queue.push(params);
    };
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      value: {
        setConsumer(fn) {
          consumer = typeof fn === "function" ? fn : null;
          while (consumer && queue.length) launch(queue.shift());
        },
      },
    });
    native().onOpenFiles((files) => {
      const handles = (files || []).map((f) => new PathFileHandle(f.path, f.name));
      if (handles.length) launch({ files: handles });
    });
  }

  // Home says PDF+ (the window's title is set by main.js), and has its
  // version and the update button.
  document.addEventListener("DOMContentLoaded", () => {
    try { updatesOnHome(); } catch (e) { console.error(e); }
    const h1 = document.querySelector(".home-hero h1");
    if (h1 && h1.textContent.trim() === "PDF Viewer") h1.textContent = "PDF+";
    const drop = document.querySelector(".home-drop");
    if (drop) {
      for (const n of drop.childNodes) {
        if (n.nodeType === Node.TEXT_NODE && /Once installed/.test(n.textContent)) {
          n.textContent = " Or drop files anywhere in this window. Files you open with PDF+ from Explorer land here too.";
        }
      }
    }
  });

  // ---- updates, on Home -----------------------------------------------------
  //
  // The version, and Check for updates: nothing is asked of GitHub until it
  // is clicked (main.js, "Updates"). A newer release shows its version and
  // what changed, and is downloaded and installed only on a second click;
  // PDF+ then closes (asking first about unsaved documents), installs it and
  // opens again.
  function updatesOnHome() {
    const home = document.querySelector("#dropzone .home-inner");
    const n = native();
    if (!home || !n.checkForUpdate) return;
    const style = document.createElement("style");
    style.textContent = `
      .pdfplus-about { margin-top: 26px; font-size: 12.5px; color: var(--c-text-3); }
      .pdfplus-about .pa-row { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
      .pdfplus-about .link-btn { padding: 0; font-size: 12.5px; color: var(--c-accent); }
      .pdfplus-about .link-btn:disabled { color: var(--c-text-3); cursor: default; }
      .pdfplus-about .pa-status { color: var(--c-text-2); }
      .pdfplus-about .pa-update { margin-top: 12px; padding: 14px 16px; border: 1px solid var(--c-border); border-radius: 12px; background: var(--c-card); color: var(--c-text); }
      .pdfplus-about .pa-head { font-weight: 650; font-size: 13.5px; }
      .pdfplus-about .pa-notes { margin: 10px 0 12px; max-height: 240px; overflow: auto; white-space: pre-wrap; font: inherit; line-height: 1.55; color: var(--c-text-2); }
      .pdfplus-about .pa-get { border: 1px solid var(--c-accent-strong); background: var(--c-accent-strong); color: #fff; border-radius: 8px; padding: 7px 14px; font: inherit; font-weight: 600; cursor: pointer; }
      .pdfplus-about .pa-get:disabled { opacity: 0.6; cursor: default; }
      .pdfplus-about .pa-hint { margin-top: 8px; color: var(--c-text-3); }
      .pdfplus-about .pa-source { margin-top: 10px; }
      .pdfplus-about .pa-src-where { color: var(--c-text-2); overflow-wrap: anywhere; }
      .pdfplus-about .pa-src-note { margin-top: 6px; color: var(--c-text-2); }
      .pdfplus-about .pa-src-note.warn { color: #e5484d; }
    `;
    document.head.appendChild(style);

    const box = document.createElement("section");
    box.className = "pdfplus-about";
    box.innerHTML = `
      <div class="pa-row">
        <span class="pa-version">PDF+</span>
        <button type="button" class="link-btn pa-check" title="Asks GitHub for the newest PDF+ release. Nothing else is sent, and nothing is asked until you click.">Check for updates</button>
        <span class="pa-status" role="status" aria-live="polite"></span>
      </div>
      <div class="pa-update" hidden>
        <div class="pa-head"></div>
        <pre class="pa-notes"></pre>
        <button type="button" class="pa-get">Download and install</button>
        <div class="pa-hint" hidden></div>
      </div>
      <div class="pa-source">
        <div class="pa-row">
          <span>App files:</span>
          <span class="pa-src-where">…</span>
          <button type="button" class="link-btn pa-src-choose" title="Run the tools and the reader from your own copy of the pdf-viewer repository: after a git pull, Restart PDF+ and it runs what you pulled. Nothing is downloaded.">Use a folder…</button>
          <button type="button" class="link-btn pa-src-builtin" hidden>Use PDF+'s own</button>
          <button type="button" class="link-btn pa-src-restart" hidden title="Close PDF+ and open it again, with the app files as set here (a git pull included)">Restart PDF+</button>
        </div>
        <div class="pa-src-note" hidden></div>
      </div>`;
    const more = home.querySelector(".home-more");
    if (more) home.insertBefore(box, more); else home.appendChild(box);

    const $ = (sel) => box.querySelector(sel);
    const status = (t) => { $(".pa-status").textContent = t; };
    n.version().then((v) => { if (v) $(".pa-version").textContent = `PDF+ ${v}`; }).catch(() => {});
    if (n.source) appFilesOnHome($);

    let stage = "idle"; // idle → checking → available → downloading → ready
    $(".pa-check").addEventListener("click", async () => {
      if (stage === "checking" || stage === "downloading") return;
      stage = "checking";
      $(".pa-check").disabled = true;
      status("Checking…");
      let r;
      try { r = await n.checkForUpdate(); } catch (e) { r = { status: "error", message: String((e && e.message) || e) }; }
      $(".pa-check").disabled = false;
      if (r.status === "available") {
        stage = "available";
        status("");
        $(".pa-head").textContent = `PDF+ ${r.version} is available. You have ${r.current}.`;
        $(".pa-notes").textContent = r.notes || "No notes came with this release.";
        $(".pa-get").textContent = "Download and install";
        $(".pa-get").disabled = false;
        $(".pa-hint").hidden = true;
        $(".pa-update").hidden = false;
        return;
      }
      stage = "idle";
      $(".pa-update").hidden = true;
      status(r.status === "none" ? `PDF+ is up to date.`
        : r.status === "unavailable" ? r.message
          : `Could not check for updates: ${r.message}`);
    });

    n.onUpdateProgress((pct) => {
      if (stage === "downloading") $(".pa-get").textContent = `Downloading… ${pct}%`;
    });
    $(".pa-get").addEventListener("click", async () => {
      if (stage === "ready") {
        $(".pa-get").disabled = true;
        $(".pa-get").textContent = "Installing…";
        await n.installUpdate();
        return;
      }
      if (stage !== "available") return;
      stage = "downloading";
      $(".pa-get").disabled = true;
      $(".pa-check").disabled = true;
      $(".pa-get").textContent = "Downloading…";
      let r;
      try { r = await n.downloadUpdate(); } catch (e) { r = { status: "error", message: String((e && e.message) || e) }; }
      $(".pa-check").disabled = false;
      if (r.status !== "downloaded") {
        stage = "available";
        $(".pa-get").disabled = false;
        $(".pa-get").textContent = "Download and install";
        $(".pa-hint").hidden = false;
        $(".pa-hint").textContent = `The download failed: ${r.message}`;
        return;
      }
      stage = "ready";
      $(".pa-get").disabled = false;
      $(".pa-get").textContent = "Restart and install";
      $(".pa-hint").hidden = false;
      $(".pa-hint").textContent = "PDF+ closes, installs the update and opens again. A document with unsaved changes is asked about first; if you keep PDF+ open, the update installs the next time it closes.";
    });
  }

  // ---- app files, on Home -----------------------------------------------------
  //
  // Where the tools and the reader come from: PDF+'s own copy, or a folder
  // holding the user's checkout of the repository (main.js, "Where the app's
  // files come from"), chosen through a folder dialog in the main process.
  // The choice takes effect on Restart PDF+, which is also how a git pull is
  // taken up; Restart refuses while a document has unsaved changes.
  function appFilesOnHome($) {
    const n = native();
    const newer = (a, b) => {
      const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
      for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
      return false;
    };
    const note = (text, warn) => {
      const el = $(".pa-src-note");
      el.hidden = !text;
      el.textContent = text || "";
      el.classList.toggle("warn", !!warn);
    };
    const show = (info, said) => {
      if (!info) return;
      const folder = info.chosen || "";
      const head = info.git && info.git.commit ? ` (${info.git.branch ? info.git.branch + " @ " : ""}${info.git.commit})` : "";
      $(".pa-src-where").textContent = folder ? folder + head : "built into PDF+";
      $(".pa-src-choose").textContent = folder ? "Change folder…" : "Use a folder…";
      $(".pa-src-builtin").hidden = !folder;
      $(".pa-src-restart").hidden = !(folder || info.restartNeeded);
      if (said) { note(said.text, said.warn); return; }
      if (info.problem) { note(`${folder} cannot be used: ${info.problem}. PDF+ is running its own files.`, true); return; }
      if (info.restartNeeded) { note("Restart PDF+ to start using " + (folder ? "this folder." : "its own files."), false); return; }
      if (info.folder && info.folderVersion && newer(info.folderVersion, info.appVersion)) {
        note(`This folder has PDF+ ${info.folderVersion}, newer than the ${info.appVersion} installed: its window, file access or engine changed, and that part comes only from an update (Check for updates).`, false);
        return;
      }
      note(info.folder ? "After a git pull, Restart PDF+ to run what you pulled." : "", false);
    };
    const refresh = (said) => n.source().then((info) => show(info, said)).catch(() => {});
    refresh();
    // Back to Home after a pull: the commit shown is read afresh.
    document.getElementById("home-tab")?.addEventListener("click", () => refresh());

    $(".pa-src-choose").addEventListener("click", async () => {
      const info = await n.chooseSourceFolder();
      if (!info) return;
      show(info, info.refused ? { text: info.refused, warn: true } : null);
    });
    $(".pa-src-builtin").addEventListener("click", async () => show(await n.useBuiltInSource()));
    $(".pa-src-restart").addEventListener("click", async () => {
      const r = await n.restart();
      if (r && r.ok) return;
      if (r && r.why === "unsaved") refresh({ text: "A document has unsaved changes: save it (or close it) first, then Restart PDF+.", warn: true });
    });
  }
})();
