// Tab manager for the PWA shell.
//
// Each open PDF is an <iframe> loading the canonical viewer (viewer/viewer.html).
// Because the iframes are same-origin, we drive them directly: local files are
// handed to iframe.contentWindow.__pdfViewerLoadLocal(file, handle). Tabs are
// fully isolated viewer instances; closing one tears its iframe down.
//
// Entry points that create tabs: the + button, the empty-state drop zone,
// drag-and-drop, and the OS file handler (launchQueue). The app is for files
// you open from disk; viewing web PDFs is the browser extension's job.

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
// `handle` is the FileSystemFileHandle when we have one (file picker / OS
// handler) — passed through so the viewer's Save can overwrite the same file.
function openLocalFile(file, handle) {
  if (!file) return;
  newTab({
    initialLabel: file.name,
    pending: (tab) => {
      const feed = () => {
        const w = tab.iframe.contentWindow;
        if (w && w.__pdfViewerLoadLocal) { w.__pdfViewerLoadLocal(file, handle); watchTitle(tab); }
        else setTimeout(feed, 30);
      };
      feed();
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
      for (const h of handles) openLocalFile(await h.getFile(), h);
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
    for (const handle of params.files) openLocalFile(await handle.getFile(), handle);
  });
}

updateChrome();

// Service worker: installability, offline, and auto-update when online.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW registration failed:", e));
  });
}
