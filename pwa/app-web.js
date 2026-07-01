// Tab manager for the PWA shell.
//
// Each open PDF is an <iframe> loading the canonical viewer (viewer/viewer.html).
// Because the iframes are same-origin, we drive them directly:
//   - local files  -> iframe.contentWindow.__pdfViewerLoadLocal(file)
//   - routed URLs  -> iframe src = viewer/viewer.html?file=<url> (viewer fetches)
// Tabs are fully isolated viewer instances; closing one tears its iframe down.
//
// Entry points that create tabs: the + button, the empty-state drop zone,
// drag-and-drop, the OS file handler (launchQueue), and a ?file=<url> on the
// shell URL (how the extension's optional "route web PDFs to the app" lands).

const tabsEl = document.getElementById("tabs");
const viewsEl = document.getElementById("tab-views");
const dropzone = document.getElementById("dropzone");
const newTabBtn = document.getElementById("new-tab");
const fileInput = document.getElementById("file-input");

const VIEWER_SRC = "viewer/viewer.html";
let tabs = [];
let activeId = null;
let seq = 0;

function cleanTitle(t) {
  return (t || "").replace(/\s*[—-]\s*PDF Viewer\s*$/, "").trim() || "PDF";
}

function updateChrome() {
  dropzone.hidden = tabs.length > 0;
  document.body.classList.toggle("has-tabs", tabs.length > 0);
}

function activate(id) {
  activeId = id;
  for (const t of tabs) {
    const on = t.id === id;
    t.iframe.classList.toggle("active", on);
    t.btn.classList.toggle("active", on);
    t.btn.setAttribute("aria-selected", String(on));
  }
  // Load a tab's PDF the first time it's actually shown, so the viewer renders
  // and places citation overlays with correct (visible) geometry — never while
  // the iframe is display:none. Deferred via microtask so that opening several
  // files at once only loads the one that ends up active; the rest load when
  // first clicked.
  queueMicrotask(() => {
    const t = tabs.find((x) => x.id === id);
    if (t && t.pending && activeId === id) {
      const run = t.pending;
      t.pending = null;
      run(t);
    }
  });
}

function setLabel(tab, text) {
  tab.labelEl.textContent = text;
  tab.btn.title = text;
}

// Reflect the viewer's document title (which tracks the PDF's name) onto the
// tab label, live.
function watchTitle(tab) {
  try {
    const doc = tab.iframe.contentDocument;
    const apply = () => setLabel(tab, cleanTitle(doc.title));
    apply();
    const titleEl = doc.querySelector("title");
    if (titleEl) new MutationObserver(apply).observe(titleEl, { childList: true });
  } catch { /* cross-origin or not ready — ignore */ }
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const [tab] = tabs.splice(idx, 1);
  tab.iframe.remove();
  tab.btn.remove();
  if (activeId === id) {
    const next = tabs[idx] || tabs[idx - 1];
    if (next) activate(next.id);
    else activeId = null;
  }
  updateChrome();
}

function makeTabButton(id, initialLabel) {
  const btn = document.createElement("div");
  btn.className = "tab";
  btn.setAttribute("role", "tab");
  const labelEl = document.createElement("span");
  labelEl.className = "tab-label";
  labelEl.textContent = initialLabel;
  const close = document.createElement("button");
  close.className = "tab-close";
  close.title = "Close tab";
  close.textContent = "×";
  close.addEventListener("click", (e) => { e.stopPropagation(); closeTab(id); });
  btn.append(labelEl, close);
  btn.addEventListener("click", () => activate(id));
  tabsEl.appendChild(btn);
  return { btn, labelEl };
}

// Create a tab. `pending(tab)` runs the first time the tab is shown (see
// activate) and is responsible for actually loading the PDF into its iframe.
function newTab({ initialLabel, pending }) {
  const id = ++seq;
  const iframe = document.createElement("iframe");
  iframe.className = "tab-view";
  iframe.src = VIEWER_SRC; // blank viewer; the PDF is loaded lazily on show
  viewsEl.appendChild(iframe);
  const { btn, labelEl } = makeTabButton(id, initialLabel || "Loading…");
  const tab = { id, iframe, btn, labelEl, pending };
  tabs.push(tab);
  activate(id);
  updateChrome();
  return tab;
}

// Open a local File in a new tab. Loads lazily when the tab is first shown.
function openLocalFile(file) {
  if (!file) return;
  newTab({
    initialLabel: file.name,
    pending: (tab) => {
      const feed = () => {
        const w = tab.iframe.contentWindow;
        if (w && w.__pdfViewerLoadLocal) { w.__pdfViewerLoadLocal(file); watchTitle(tab); }
        else setTimeout(feed, 30);
      };
      feed();
    },
  });
}

// --- Extension broker -------------------------------------------------------
// If the extension is installed, its content-script bridge (content/app-bridge)
// can fetch a URL with the user's cookies + host permissions (bypassing CORS)
// and hand back the bytes. That's the only way cookie-gated / cross-origin
// court PDFs can open here. We detect it with a ping and fall back to a direct
// fetch by the viewer when it's absent.

const EXT_NS = "pdfviewer-ext";
const extPending = new Map();
let extReady = false;
let extSeq = 0;

window.addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const m = e.data;
  if (!m || m.ns !== EXT_NS || m.dir !== "toPage") return;
  if (m.type === "ready") { extReady = true; return; }
  const p = extPending.get(m.requestId);
  if (!p) return;
  extPending.delete(m.requestId);
  if (m.type === "bytes") p.resolve({ b64: m.b64, filename: m.filename });
  else p.reject(new Error(m.error || "extension fetch failed"));
});

function extAvailable() {
  if (extReady) return Promise.resolve(true);
  return new Promise((resolve) => {
    window.postMessage({ ns: EXT_NS, dir: "toExt", type: "ping" }, location.origin);
    setTimeout(() => resolve(extReady), 400);
  });
}

function extFetch(url) {
  return new Promise((resolve, reject) => {
    const requestId = ++extSeq;
    extPending.set(requestId, { resolve, reject });
    window.postMessage({ ns: EXT_NS, dir: "toExt", type: "fetch", url, requestId }, location.origin);
    setTimeout(() => {
      if (extPending.has(requestId)) { extPending.delete(requestId); reject(new Error("extension fetch timeout")); }
    }, 60000);
  });
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function nameFromUrl(url) {
  try {
    const p = new URL(url).pathname.split("/").filter(Boolean).pop() || "document.pdf";
    return /\.pdf$/i.test(p) ? decodeURIComponent(p) : "document.pdf";
  } catch { return "document.pdf"; }
}

function feedFileToTab(tab, file) {
  const feed = () => {
    const w = tab.iframe.contentWindow;
    if (w && w.__pdfViewerLoadLocal) { w.__pdfViewerLoadLocal(file); watchTitle(tab); }
    else setTimeout(feed, 30);
  };
  feed();
}

// Open a URL in a new tab (routed web PDF). Prefer the extension broker so
// cookie-gated/cross-origin PDFs work; otherwise let the viewer fetch directly.
function openUrl(url) {
  newTab({
    initialLabel: "Loading…",
    pending: async (tab) => {
      if (await extAvailable()) {
        try {
          const { b64, filename } = await extFetch(url);
          const file = new File([b64ToBytes(b64)], filename || nameFromUrl(url), { type: "application/pdf" });
          feedFileToTab(tab, file);
          return;
        } catch (err) {
          console.warn("extension broker failed; falling back to direct fetch:", err);
        }
      }
      tab.iframe.addEventListener("load", () => watchTitle(tab), { once: true });
      tab.iframe.src = VIEWER_SRC + "?file=" + encodeURIComponent(url);
    },
  });
}

// ---- Open affordances ------------------------------------------------------

async function pickFiles() {
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({
        types: [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }],
        multiple: true,
      });
      for (const h of handles) openLocalFile(await h.getFile());
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  fileInput.click();
}

newTabBtn.addEventListener("click", pickFiles);
dropzone.addEventListener("click", pickFiles);
fileInput.addEventListener("change", () => {
  for (const f of fileInput.files) openLocalFile(f);
  fileInput.value = "";
});

// Drag and drop anywhere on the shell.
["dragenter", "dragover"].forEach((ev) =>
  document.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add("dragging"); })
);
["dragleave", "drop"].forEach((ev) =>
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "dragleave" && e.relatedTarget) return;
    document.body.classList.remove("dragging");
  })
);
document.addEventListener("drop", (e) => {
  const files = e.dataTransfer?.files;
  if (files) for (const f of files) if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) openLocalFile(f);
});

// OS file handler — a PDF opened from the system lands here (possibly several).
if ("launchQueue" in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params || !params.files) return;
    for (const handle of params.files) openLocalFile(await handle.getFile());
  });
}

// Routed web PDF: the extension can redirect a PDF to <app>/?file=<url>.
const routed = new URLSearchParams(location.search).get("file");
if (routed) {
  openUrl(routed);
  // Clean the shell URL so a refresh doesn't reopen the same tab.
  history.replaceState(null, "", location.pathname);
}

updateChrome();

// Service worker: installability, offline, and auto-update when online.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW registration failed:", e));
  });
}
