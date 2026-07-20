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

// The viewers share this browser tab's sessionStorage for their cross-tab
// naming registry ("titledoc:*" keys). A full shell reload discards every
// iframe without cleanup, so purge leftover entries before any viewer boots —
// ghosts from the previous load would corrupt name disambiguation.
try {
  for (const k of Object.keys(sessionStorage)) {
    if (k.startsWith("titledoc:")) sessionStorage.removeItem(k);
  }
} catch { /* storage unavailable — viewers fall back gracefully */ }

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
  // A tab that was fed while hidden (display:none) placed its overlays with zero
  // geometry. The first time it's shown, reflow the viewer so citation links /
  // highlights / form fields land correctly. (The name already resolved while
  // hidden, so labels/downloads are right regardless.)
  const t = tabs.find((x) => x.id === id);
  if (t && t.fed && !t.reflowed) {
    t.reflowed = true;
    queueMicrotask(() => {
      try { t.iframe.contentWindow?.__pdfViewerReflow?.(); } catch { /* not ready */ }
    });
  }
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
  // Removing an iframe discards its document without firing unload handlers,
  // so tell the viewer to drop its cross-tab naming-registry entry first —
  // otherwise the closed doc would keep disambiguating the remaining tabs.
  try { tab.iframe.contentWindow?.__pdfViewerUnregister?.(); } catch { /* gone */ }
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

// Create a tab and feed its PDF to the viewer as soon as the viewer is ready —
// even while the tab is hidden — so every open PDF resolves its real name (and
// download filename) automatically, without waiting to be clicked.
function newTab({ initialLabel, file, handle }) {
  const id = ++seq;
  const iframe = document.createElement("iframe");
  iframe.className = "tab-view";
  iframe.src = VIEWER_SRC;
  viewsEl.appendChild(iframe);
  const { btn, labelEl } = makeTabButton(id, initialLabel || "Loading…");
  const tab = { id, iframe, btn, labelEl, file, handle, fed: false, reflowed: false };
  tabs.push(tab);
  feedWhenReady(tab);
  activate(id);
  updateChrome();
  return tab;
}

// Feed the PDF into a tab's viewer once its window exposes the load hook. Runs
// regardless of visibility. If the tab is the visible one when fed, it rendered
// with correct geometry and needs no later reflow.
function feedWhenReady(tab) {
  const w = tab.iframe.contentWindow;
  if (w && w.__pdfViewerLoadLocal) {
    tab.fed = true;
    if (activeId === tab.id) tab.reflowed = true; // rendered while visible
    w.__pdfViewerLoadLocal(tab.file, tab.handle);
    watchTitle(tab);
  } else {
    setTimeout(() => feedWhenReady(tab), 30);
  }
}

// Open a local File in a new tab. `handle` is the FileSystemFileHandle when we
// have one (file picker / OS handler) — passed through so the viewer's Save can
// overwrite the same file.
function openLocalFile(file, handle) {
  if (!file) return;
  newTab({ initialLabel: file.name, file, handle });
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
