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
    if (!/^(https?|mailto):$/.test(u.protocol)) return null;
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

  // Home says PDF+ (the window's title is set by main.js).
  document.addEventListener("DOMContentLoaded", () => {
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
})();
