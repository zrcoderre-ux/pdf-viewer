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

import { icon, hydrateIcons } from "./viewer/icons.js";

const tabsEl = document.getElementById("tabs");
const viewsEl = document.getElementById("tab-views");
const dropzone = document.getElementById("dropzone");
const newTabBtn = document.getElementById("new-tab");
const fileInput = document.getElementById("file-input");

const VIEWER_SRC = "viewer/viewer.html";
// A PDF-Linker text export opens in the text reader instead: the same tab
// strip, a different page in the iframe.
const READER_SRC = "viewer/text-reader.html";
const isTextFile = (f) => /\.(txt|leak)$/i.test(f.name) || f.type === "text/plain";
const isPdfFile = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
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
  return (t || "").replace(/\s*[—-]\s*(PDF Viewer|Text Reader)\s*$/, "").trim() || "PDF";
}

// Home is the page with nothing open, and a tab of its own once something is:
// the Home button shows it over the documents without closing any of them.
let homeOpen = false;
const homeTab = document.getElementById("home-tab");

function updateChrome() {
  const showHome = tabs.length === 0 || homeOpen;
  dropzone.hidden = !showHome;
  document.body.classList.toggle("has-tabs", tabs.length > 0);
  document.body.classList.toggle("home-open", showHome && tabs.length > 0);
  homeTab.classList.toggle("active", showHome);
  if (showHome) renderRecent();
}
function showHome(on) {
  homeOpen = on;
  for (const t of tabs) t.btn.classList.toggle("active", !on && t.id === activeId);
  updateChrome();
  if (on) document.title = "PDF Viewer";
  else syncShellTitle();
}
homeTab.addEventListener("click", () => showHome(tabs.length ? !homeOpen : true));

function activate(id) {
  activeId = id;
  homeOpen = false;
  updateChrome();
  syncShellTitle();
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
      try {
        const w = t.iframe.contentWindow;
        (t.text ? w?.__textReaderReflow : w?.__pdfViewerReflow)?.();
      } catch { /* not ready */ }
    });
  }
  // Hand the keyboard to the viewer itself, so its shortcuts (auto-scroll's
  // A / Space / [ / ], Shift+Space to open links) work on the tab you're
  // looking at without having to click into the page first.
  if (t) { try { t.iframe.focus(); } catch { /* not ready */ } }
}

function setLabel(tab, text) {
  tab.labelEl.textContent = text;
  tab.btn.title = text;
}

// Reflect the viewer's document title (which tracks the document's name) onto
// the tab label, live — and onto the SHELL's own title while that tab is the
// one showing.
//
// The shell's title is not decoration. A print from inside an iframe is a
// print of the top document, and the name the browser offers to save the PDF
// under is that document's title — so with the shell stuck on "PDF Viewer"
// every "Save as PDF" out of the reader or the viewer was called PDF Viewer,
// whatever was open in it.
function watchTitle(tab) {
  try {
    const doc = tab.iframe.contentDocument;
    const apply = () => {
      setLabel(tab, cleanTitle(doc.title));
      if (tab.id === activeId) syncShellTitle();
    };
    apply();
    const titleEl = doc.querySelector("title");
    if (titleEl) new MutationObserver(apply).observe(titleEl, { childList: true });
  } catch { /* cross-origin or not ready — ignore */ }
}

/** The shell wears the open document's name; with nothing open, its own. */
function syncShellTitle() {
  const t = tabs.find((x) => x.id === activeId);
  let name = "";
  try { name = t ? cleanTitle(t.iframe.contentDocument.title) : ""; } catch { name = ""; }
  document.title = name && name !== "PDF" ? name : "PDF Viewer";
}

function tabHasUnsaved(tab) {
  try { return !!tab.iframe.contentWindow?.__pdfViewerHasUnsaved?.(); } catch { return false; }
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  if (tabHasUnsaved(tabs[idx]) && !confirm(`“${tabs[idx].labelEl.textContent}” has changes that are not saved. Close it anyway?`)) return;
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
    else { activeId = null; syncShellTitle(); }
  }
  updateChrome();
}

function makeTabButton(id, initialLabel, text = false) {
  const btn = document.createElement("div");
  btn.className = "tab" + (text ? " text" : "");
  btn.setAttribute("role", "tab");
  const ic = document.createElement("span");
  ic.className = "tab-icon";
  ic.innerHTML = icon(text ? "file-text" : "file", { size: 15 });
  const labelEl = document.createElement("span");
  labelEl.className = "tab-label";
  labelEl.textContent = initialLabel;
  const close = document.createElement("button");
  close.className = "tab-close";
  close.title = "Close tab";
  close.setAttribute("aria-label", "Close tab");
  close.innerHTML = icon("x", { size: 14 });
  close.addEventListener("click", (e) => { e.stopPropagation(); closeTab(id); });
  btn.append(ic, labelEl, close);
  btn.addEventListener("click", () => activate(id));
  // A middle click closes a tab, as in a browser.
  btn.addEventListener("auxclick", (e) => { if (e.button === 1) { e.preventDefault(); closeTab(id); } });
  btn.addEventListener("pointerdown", (e) => dragTab(e, btn, id));
  tabsEl.appendChild(btn);
  return { btn, labelEl };
}

// ---- Dragging a tab to a new place in the strip ----------------------------
//
// Pointer events rather than HTML drag and drop: the shell takes every native
// drag as files coming in (the drop overlay, openLocalFile), and a native drag
// carries a ghost image instead of the tab itself. A press that moves past
// DRAG_SLOP is a drag: the tab follows the pointer along the strip, the tabs
// it passes slide aside to make its room, and on release it is put down there
// and `tabs` takes the new order, so closing a tab still hands over to its
// neighbour on screen. A press that does not move is still a click. A drag
// selects the tab as it starts, as a browser's does (Chrome sends no click
// for a press released somewhere else). Held near either end of a strip too
// long to show, the strip scrolls.
const DRAG_SLOP = 4;  // px the pointer moves before a press is a drag
const EDGE_ZONE = 32; // px in from either end of the strip that scroll it

function dragTab(e, btn, id) {
  if (e.button !== 0 || e.target.closest(".tab-close")) return;
  const x0 = e.clientX;
  let lastX = x0;
  let drag = null; // set once the press has moved past DRAG_SLOP
  let raf = 0;
  btn.setPointerCapture(e.pointerId);

  const begin = () => {
    const els = [...tabsEl.querySelectorAll(".tab")];
    const sl = tabsEl.scrollLeft;
    // Every tab's place along the strip's content, measured before anything
    // moves (a transform would show in a rect taken later).
    const slots = els.map((el) => { const r = el.getBoundingClientRect(); return { left: r.left + sl, width: r.width }; });
    const from = els.indexOf(btn);
    const gap = parseFloat(getComputedStyle(tabsEl).columnGap) || 0;
    drag = { els, slots, from, to: from, step: slots[from].width + gap, grab: x0 + sl - slots[from].left };
    tabsEl.classList.add("reordering");
    btn.classList.add("dragging");
    if (activeId !== id || homeOpen) activate(id);
  };
  const place = () => {
    const { els, slots, from, step, grab } = drag;
    const me = slots[from], last = slots[slots.length - 1];
    const left = Math.max(slots[0].left, Math.min(last.left + last.width - me.width, lastX + tabsEl.scrollLeft - grab));
    btn.style.transform = `translateX(${left - me.left}px)`;
    // It goes past a tab once its leading edge crosses that tab's middle — not
    // its own middle, which a wide tab held against the end of the strip
    // would never get past a narrow one's.
    let to = from;
    for (let i = from + 1; i < els.length; i++) if (left + me.width > slots[i].left + slots[i].width / 2) to = i;
    for (let i = from - 1; i >= 0; i--) if (left < slots[i].left + slots[i].width / 2) to = i;
    drag.to = to;
    els.forEach((el, i) => {
      if (el === btn) return;
      const shift = from < i && i <= to ? -step : to <= i && i < from ? step : 0;
      el.style.transform = shift ? `translateX(${shift}px)` : "";
    });
  };
  const edgeScroll = () => {
    raf = 0;
    if (!drag) return;
    const r = tabsEl.getBoundingClientRect();
    const over = lastX < r.left + EDGE_ZONE ? lastX - (r.left + EDGE_ZONE)
      : lastX > r.right - EDGE_ZONE ? lastX - (r.right - EDGE_ZONE) : 0;
    if (!over) return;
    const before = tabsEl.scrollLeft;
    tabsEl.scrollLeft += Math.sign(over) * Math.min(14, 2 + Math.abs(over) / 3);
    if (tabsEl.scrollLeft === before) return; // at the end already
    place();
    raf = requestAnimationFrame(edgeScroll);
  };
  const onMove = (ev) => {
    lastX = ev.clientX;
    if (!drag) {
      if (Math.abs(lastX - x0) < DRAG_SLOP) return;
      begin();
    }
    place();
    if (!raf) raf = requestAnimationFrame(edgeScroll);
  };
  const finish = (ev) => {
    btn.removeEventListener("pointermove", onMove);
    btn.removeEventListener("pointerup", finish);
    btn.removeEventListener("pointercancel", finish);
    if (raf) cancelAnimationFrame(raf);
    if (!drag) return;
    const { els, from } = drag;
    const to = ev.type === "pointercancel" ? from : drag.to;
    drag = null;
    // Where it was let go of, so it can glide from there into its slot.
    const shown = btn.getBoundingClientRect().left;
    tabsEl.classList.remove("reordering");
    btn.classList.remove("dragging");
    for (const el of els) el.style.transform = "";
    if (to !== from) {
      if (to > from) els[to].after(btn); else els[to].before(btn);
      const order = [...tabsEl.querySelectorAll(".tab")];
      tabs.sort((a, b) => order.indexOf(a.btn) - order.indexOf(b.btn));
    }
    const dx = shown - btn.getBoundingClientRect().left;
    if (Math.abs(dx) >= 1) {
      btn.style.transform = `translateX(${dx}px)`;
      btn.getBoundingClientRect(); // the start of the glide, laid out
      btn.classList.add("settling");
      btn.style.transform = "";
      btn.addEventListener("transitionend", () => btn.classList.remove("settling"), { once: true });
    }
  };
  btn.addEventListener("pointermove", onMove);
  btn.addEventListener("pointerup", finish);
  btn.addEventListener("pointercancel", finish);
}

// Create a tab and feed its PDF to the viewer as soon as the viewer is ready —
// even while the tab is hidden — so every open PDF resolves its real name (and
// download filename) automatically, without waiting to be clicked.
function newTab({ initialLabel, file, handle, text, dir, focus = true }) {
  const id = ++seq;
  const iframe = document.createElement("iframe");
  iframe.className = "tab-view";
  iframe.src = text ? READER_SRC : VIEWER_SRC;
  viewsEl.appendChild(iframe);
  const { btn, labelEl } = makeTabButton(id, initialLabel || "Loading…", !!text);
  const tab = { id, iframe, btn, labelEl, file, handle, text: !!text, dir: dir || null, fed: false, reflowed: false };
  tabs.push(tab);
  feedWhenReady(tab);
  if (focus) activate(id);
  updateChrome();
  return tab;
}

// Feed the PDF into a tab's viewer once its window exposes the load hook. Runs
// regardless of visibility. If the tab is the visible one when fed, it rendered
// with correct geometry and needs no later reflow.
function feedWhenReady(tab) {
  const w = tab.iframe.contentWindow;
  const load = w && (tab.text ? w.__textReaderLoadLocal : w.__pdfViewerLoadLocal);
  if (load) {
    tab.fed = true;
    if (activeId === tab.id) tab.reflowed = true; // rendered while visible
    // The case folder goes with the document where the tab came from one: the
    // reader remembers it and attaches its key by itself.
    load(tab.file, tab.handle, tab.dir || undefined);
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
  const text = isTextFile(file) && !isPdfFile(file);
  newTab({ initialLabel: file.name, file, handle, text });
  if (handle) rememberRecent(handle, text);
}
// The viewer's Ctrl+O and the Home page's button come here.
window.__appOpenFile = () => pickFiles();

// ---- Open affordances ------------------------------------------------------

async function pickFiles() {
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({
        types: [
          { description: "PDF document", accept: { "application/pdf": [".pdf"] } },
          { description: "Text export", accept: { "text/plain": [".txt", ".LEAK"] } },
        ],
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

// ---- a whole case folder ---------------------------------------------------
//
// PDF-Linker leaves a matter in one shape: the case folder holds the key, the
// PDFs, the LEAKS worksheet and (where the run made one) Combined Text.txt,
// and the exports themselves sit in a "Text Files" subfolder under it. So the
// folder is the thing to open, not the files: one pick, and the matter is up
// — the folder attached, its key in force and its PDFs to hand.
//
// ONE TAB, WHATEVER THE FOLDER HOLDS. A case folder is a matter, not a pile
// of files, and the reader already treats it as one: every export is listed
// in its Documents panel, a click away and built ahead of the click; the
// folder reads ON, the next export hanging under the last as the page reaches
// it; the leak walk steps out of one document and into the next by itself;
// and Find reads the whole folder. A tab per export gave none of that — forty
// readers each compiling the same key, each knowing only its own document,
// and the operator hunting the tab strip for the file the walk had just named.
// So the pick opens the combined file where the run made one (it IS every
// export, in one document) and otherwise the first, and the rest of the
// matter is where it belongs: inside that one reader.
const TEXT_SUBFOLDER = "Text Files";
const isExport = (name) => /\.txt(\.leak)?$/i.test(name)
  && !/^(leaks|pdf_linker_leaks|authorities cited|new real values)\.txt$/i.test(name)
  && !/^(ETA|DONE) .*\.txt$/i.test(name);
const isCombined = (name) => /^combined text\.txt$/i.test(name);

async function pickCaseFolder() {
  if (!window.showDirectoryPicker) { alert("This browser cannot open a folder. Open the text files instead."); return; }
  let dir;
  try { dir = await window.showDirectoryPicker({ mode: "readwrite" }); }
  catch (e) { if (e && e.name !== "AbortError") alert(String(e.message || e)); return; }
  let combined = null, textDir = null;
  const rootDocs = [];
  try {
    for await (const [name, entry] of dir.entries()) {
      if (entry.kind === "directory") { if (name.toLowerCase() === TEXT_SUBFOLDER.toLowerCase()) textDir = entry; continue; }
      if (isCombined(name)) combined = entry;
      else if (isExport(name)) rootDocs.push(entry);
    }
  } catch (e) { alert("Could not read " + dir.name + ": " + (e.message || e)); return; }
  let docs = [];
  if (textDir) {
    try { for await (const [name, entry] of textDir.entries()) if (entry.kind === "file" && isExport(name)) docs.push(entry); }
    catch { /* unreadable: what is in the folder itself will have to do */ }
  }
  if (!docs.length) docs = rootDocs;
  docs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  if (combined) docs = [combined].concat(docs);
  if (!docs.length) {
    // Pointed at a folder that holds no exports, the app is still an app for
    // opening files: say what was not there and offer the file picker rather
    // than leaving a dead end behind the alert.
    if (confirm("No text exports in " + dir.name + (textDir ? "" : " — and no " + TEXT_SUBFOLDER + " folder in it.")
      + "\n\nOpen files instead?")) pickFiles();
    return;
  }
  // The combined file is the whole matter in one document, so it is the one
  // to open where the run made one; otherwise the first export, with the rest
  // listed in its Documents panel.
  const first = docs[0];
  let file;
  try { file = await first.getFile(); }
  catch (e) { alert("Could not open " + first.name + ": " + (e.message || e)); return; }
  newTab({ initialLabel: first.name, file, handle: first, text: true, dir, focus: true });
}

newTabBtn.addEventListener("click", pickFiles);
document.getElementById("open-file")?.addEventListener("click", pickFiles);
document.getElementById("combine-files")?.addEventListener("click", combineFiles);
document.getElementById("images-to-pdf")?.addEventListener("click", imagesToPdf);
const caseBtn = document.getElementById("open-case");
if (caseBtn) caseBtn.addEventListener("click", (e) => { e.stopPropagation(); pickCaseFolder(); });
const caseBtn2 = document.getElementById("open-case-tab");
if (caseBtn2) caseBtn2.addEventListener("click", pickCaseFolder);
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
  if (files) for (const f of files) if (isPdfFile(f) || isTextFile(f)) openLocalFile(f);
});

// OS file handler — a PDF opened from the system lands here (possibly several).
if ("launchQueue" in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params || !params.files) return;
    for (const handle of params.files) openLocalFile(await handle.getFile(), handle);
  });
}

// ---- Home: combine, create, recent ----------------------------------------

function shellToast(msg, ms = 3200) {
  const el = document.getElementById("shell-toast");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(shellToast.t);
  shellToast.t = setTimeout(() => { el.hidden = true; }, ms);
}

function pickRaw({ multiple = true, accept }) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files ? [...input.files] : []));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

// Several PDFs into one, opened as a new (unsaved) document: Save asks where.
async function combineFiles() {
  const files = (await pickRaw({ accept: "application/pdf,.pdf" })).filter(isPdfFile);
  if (!files.length) return;
  if (files.length < 2) { shellToast("Choose two or more PDFs to combine."); return; }
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  shellToast(`Combining ${files.length} files…`, 60000);
  try {
    const { PDFDocument } = await import("./viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const { decryptPdf, detectEncryption } = await import("./viewer/pdf-crypt.js");
    const out = await PDFDocument.create();
    const skipped = [];
    for (const f of files) {
      let bytes = new Uint8Array(await f.arrayBuffer());
      if (detectEncryption(bytes)) {
        try { bytes = (await decryptPdf(bytes, "")).bytes; } catch { skipped.push(f.name); continue; }
      }
      const src = await PDFDocument.load(bytes);
      for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
    }
    const bytes = await out.save();
    const file = new File([bytes], "Combined.pdf", { type: "application/pdf" });
    openLocalFile(file, null);
    shellToast(skipped.length ? `Combined. Skipped (password-protected): ${skipped.join(", ")}` : `Combined ${files.length} files — Save to keep the result.`, 5000);
  } catch (e) {
    console.error(e);
    shellToast(`Could not combine the files: ${e.message || e}`, 6000);
  }
}

// Images, one per page, each fitted to a US Letter page.
async function imagesToPdf() {
  const files = await pickRaw({ accept: "image/*" });
  if (!files.length) return;
  shellToast(`Creating a PDF from ${files.length} image${files.length === 1 ? "" : "s"}…`, 60000);
  try {
    const { PDFDocument } = await import("./viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const doc = await PDFDocument.create();
    for (const f of files) {
      let bytes = new Uint8Array(await f.arrayBuffer());
      let type = (f.type || "").toLowerCase();
      if (type !== "image/jpeg" && type !== "image/png") {
        const bmp = await createImageBitmap(f);
        const c = document.createElement("canvas");
        c.width = bmp.width; c.height = bmp.height;
        c.getContext("2d").drawImage(bmp, 0, 0);
        bytes = new Uint8Array(await (await new Promise((r) => c.toBlob(r, "image/png"))).arrayBuffer());
        type = "image/png";
      }
      const img = type === "image/jpeg" ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
      const land = img.width > img.height;
      const [PW, PH] = land ? [792, 612] : [612, 792];
      const s = Math.min((PW - 36) / img.width, (PH - 36) / img.height, 1);
      const page = doc.addPage([PW, PH]);
      page.drawImage(img, { x: (PW - img.width * s) / 2, y: (PH - img.height * s) / 2, width: img.width * s, height: img.height * s });
    }
    const out = await doc.save();
    openLocalFile(new File([out], files.length === 1 ? files[0].name.replace(/\.[^.]+$/, "") + ".pdf" : "Images.pdf", { type: "application/pdf" }), null);
    shellToast("Created — Save to keep the PDF.", 4000);
  } catch (e) {
    console.error(e);
    shellToast(`Could not create the PDF: ${e.message || e}`, 6000);
  }
}

// Recent files: the handles of files opened with the picker or from the
// system, kept in IndexedDB (a handle is all it takes to open the file again,
// with the browser asking for permission once).
const RECENT_DB = "pdfviewer-recent";
function recentDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(RECENT_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files", { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function recentAll() {
  try {
    const db = await recentDb();
    return await new Promise((resolve) => {
      const r = db.transaction("files").objectStore("files").getAll();
      r.onsuccess = () => resolve((r.result || []).sort((a, b) => b.when - a.when));
      r.onerror = () => resolve([]);
    });
  } catch { return []; }
}
async function rememberRecent(handle, text) {
  try {
    const list = await recentAll();
    // One entry per file: a handle that is the same file replaces the old one.
    let key = null;
    for (const r of list) { try { if (await r.handle.isSameEntry(handle)) { key = r.key; break; } } catch { /* stale */ } }
    const db = await recentDb();
    const tx = db.transaction("files", "readwrite");
    const store = tx.objectStore("files");
    store.put({ key: key || `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: handle.name, handle, text: !!text, when: Date.now() });
    for (const old of list.slice(11)) store.delete(old.key);
  } catch { /* storage unavailable: no recent list */ }
}
async function renderRecent() {
  const section = document.getElementById("recent");
  const listEl = document.getElementById("recent-list");
  if (!section || !listEl) return;
  const list = (await recentAll()).slice(0, 10);
  section.hidden = !list.length;
  listEl.textContent = "";
  for (const r of list) {
    const b = document.createElement("button");
    b.className = "recent-item" + (r.text ? " text" : "");
    b.innerHTML = `<span class="ri-icon">${icon(r.text ? "file-text" : "file", { size: 18 })}</span><span class="ri-name"></span><span class="ri-when"></span>`;
    b.querySelector(".ri-name").textContent = r.name;
    b.querySelector(".ri-when").textContent = new Date(r.when).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    b.addEventListener("click", async () => {
      try {
        if (r.handle.requestPermission && (await r.handle.queryPermission({ mode: "readwrite" })) !== "granted") {
          if ((await r.handle.requestPermission({ mode: "readwrite" })) !== "granted") return;
        }
        openLocalFile(await r.handle.getFile(), r.handle);
      } catch (e) {
        shellToast(`“${r.name}” could not be opened — it may have been moved or deleted.`, 5000);
      }
    });
    listEl.appendChild(b);
  }
}
document.getElementById("recent-clear")?.addEventListener("click", async () => {
  try {
    const db = await recentDb();
    db.transaction("files", "readwrite").objectStore("files").clear();
  } catch { /* ok */ }
  renderRecent();
});

// The theme follows the viewer's toggle (same-origin storage events).
window.addEventListener("storage", (e) => {
  if (e.key === "pdfViewerTheme") document.documentElement.setAttribute("data-theme", e.newValue === "light" ? "light" : "dark");
});

// Unsaved work: a tab says so with a dot, and closing the window asks first.
setInterval(() => {
  for (const t of tabs) t.btn.classList.toggle("dirty", tabHasUnsaved(t));
}, 1500);
window.addEventListener("beforeunload", (e) => {
  if (tabs.some(tabHasUnsaved)) { e.preventDefault(); e.returnValue = ""; }
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "o" || e.key === "O")) { e.preventDefault(); pickFiles(); }
});

hydrateIcons();
updateChrome();

// Service worker: installability, offline, and auto-update when online.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW registration failed:", e));
  });
}
