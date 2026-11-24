// Tab manager for the PWA shell.
//
// Each open PDF is an <iframe> loading the canonical viewer (viewer/viewer.html).
// Because the iframes are same-origin, we drive them directly: local files are
// handed to iframe.contentWindow.__pdfViewerLoadLocal(file, handle). Tabs are
// fully isolated viewer instances; closing one tears its iframe down.
//
// Entry points that create tabs: the + button, the empty-state drop zone,
// drag-and-drop, the OS file handler (launchQueue), and another window of the
// app handing a tab over (see "Separate windows"). The app is for files you
// open from disk; viewing web PDFs is the browser extension's job.

import { icon, hydrateIcons } from "./viewer/icons.js";
import { createSplit } from "./viewer/split-view.js";

const tabsEl = document.getElementById("tabs");
const viewsEl = document.getElementById("tab-views");
const dropzone = document.getElementById("dropzone");
const newTabBtn = document.getElementById("new-tab");
const fileInput = document.getElementById("file-input");

const VIEWER_SRC = "viewer/viewer.html";
// A PDF-Linker text export opens in the text reader instead: the same tab
// strip, a different page in the iframe.
const READER_SRC = "viewer/text-reader.html";
// …and so does My-Macros' Markdown export of a Word draft, in its pseudonyms.
const isTextFile = (f) => /\.(txt|leak|md|markdown)$/i.test(f.name) || f.type === "text/plain" || f.type === "text/markdown";
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
  // Home's theme and settings buttons sit in the strip while Home is shown.
  const homeTools = document.getElementById("home-strip-tools");
  if (homeTools) homeTools.hidden = !showHome;
  // A tab's PDF side by side goes and comes back with its tab.
  for (const t of tabs) if (t.split) t.split.setVisible(!showHome && t.id === activeId);
  if (showHome) { renderRecent(); renderCaseFolders(); }
  else { clearTimeout(caseTimer); caseTimer = 0; }
  updateCaseStrip();
}

// ---- The case's buttons in the strip --------------------------------------
//
// The owner (2026-11-20): "Let's add the home page case buttons ecourt claude
// run word to the header when the case folder is open" … "Both pdf mode and
// text mode". While the tab in front is a case folder's reader (in text or in
// PDF mode: the strip is outside the reader), the strip carries that case's
// eCourt, Claude run (its workflow menu) and Word, as its hearing's row on
// Home does: the hearing found in the sheet by the folder's name (the next one,
// else the latest), the folder read for its Word documents.
const caseStrip = document.createElement("span");
caseStrip.id = "case-strip";
caseStrip.className = "case-strip";
caseStrip.hidden = true;
document.querySelector("#tabstrip .strip-spacer")?.after(caseStrip);
let caseStripDir = null, caseStripSeq = 0;
function activeCaseDir() {
  if (homeOpen || !tabs.length) return null;
  const t = tabs.find((x) => x.id === activeId);
  if (!t || !t.text) return null;
  try { return t.iframe.contentWindow.__textReaderSource?.()?.dir || t.dir || null; } catch { return t.dir || null; }
}
async function updateCaseStrip(force = false) {
  const dir = activeCaseDir();
  if (!dir) { caseStrip.hidden = true; caseStripDir = null; return; }
  let same = false;
  try { same = !!caseStripDir && (await caseStripDir.isSameEntry(dir)); } catch { same = false; }
  if (same && !force) { caseStrip.hidden = !caseStrip.childElementCount; return; }
  const seq = ++caseStripSeq;
  caseStripDir = dir;
  const out = [];
  try {
    if (!caseLib) caseLib = await import("./viewer/case-folders.js");
    if (!hearingLib) hearingLib = await import("./viewer/hearing-sheet.js");
    let listing = null;
    try { listing = await readListing(dir); } catch { listing = null; }
    const r = { name: dir.name, handle: dir, listing, opened: 0, today: false, parent: null, root: null, chain: [dir.name] };
    let hg = null;
    const sheet = await loadSheet();
    const dl = await downloadsDir();
    if (sheet.state === "ok" && sheet.hearings.length) {
      hg = hearingLib.hearingForPlace(sheet.hearings, { name: dir.name, numbers: listing ? listingNumbers(listing) : [] }, Date.now());
      if (hg && dl) {
        const br = await readBriefing(dl);
        hearingLib.fillEcourtLinks(sheet.hearings, br && !br.none ? br.calendar : null);
      }
    }
    if (dl) { try { await readClaudeRuns(dl); } catch { /* none */ } }
    const asStrip = (b, iconName, label) => {
      b.classList.add("strip-btn", "text");
      b.innerHTML = `${icon(iconName, { size: 16 })}<span>${label}</span>`;
      return b;
    };
    if (hg && hearingLib.ecourtUrlOf(hg)) {
      const b = document.createElement("button");
      b.className = "case-strip-ecourt";
      b.title = `eCourt: open ${hg.caseNumber || hg.caseName}`;
      b.addEventListener("click", () => openEcourt(hg));
      out.push(asStrip(b, "external", "eCourt"));
    }
    if (hg && listing && canAskClaude()) out.push(asStrip(claudeButton(hg, r), "message", "Claude run"));
    if (listing && canOpenWord() && caseLib.wordDocs(listing).length) {
      const box = wordButton(r);
      const n = caseLib.wordDocs(listing).length;
      asStrip(box.querySelector(".ci-word-btn"), "file-word", n > 1 ? `Word (${n})` : "Word");
      out.push(box);
    }
  } catch (e) { console.warn("case strip", e); }
  if (seq !== caseStripSeq) return;
  caseStrip.textContent = "";
  for (const x of out) caseStrip.appendChild(x);
  caseStrip.hidden = !out.length;
}
window.addEventListener("focus", () => updateCaseStrip(true));
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
  if (tab.split && tab.split.hasUnsaved()) return true;
  try {
    const w = tab.iframe.contentWindow;
    return !!(tab.text ? w?.__textReaderHasUnsaved?.() : w?.__pdfViewerHasUnsaved?.());
  } catch { return false; }
}

// ⫴ Side by side (the viewer's button, viewer/split-view.js): a second PDF
// to the right of a tab's own, in a viewer of its own, one split per tab. It
// is part of its tab: hidden with it, closed with it (a close asks about
// either side's unsaved changes), and not carried to a new window, where the
// tab arrives alone. The card offers the other tabs' PDFs as they are on disk.
function splitFor(tab) {
  if (!tab.split) {
    tab.split = createSplit({
      stage: viewsEl,
      scope: tab.iframe,
      primary: () => tab.iframe.contentWindow,
      choices: () => tabs.filter((t) => t !== tab && !t.text).map(tabChoice).filter(Boolean),
      choicesLabel: "Open in other tabs",
      wire: (w) => w.addEventListener("keydown", newWindowKey, true),
    });
    tab.split.setVisible(tab.id === activeId && !homeOpen);
  }
  return tab.split;
}
function tabChoice(t) {
  let src = null, unsaved = false;
  try {
    const w = t.iframe.contentWindow;
    src = w?.__pdfViewerSource?.() || null;
    unsaved = !!w?.__pdfViewerHasUnsaved?.();
  } catch { src = null; }
  const handle = (src && src.handle) || t.handle || null;
  if (!handle && !t.file) return null;
  return { name: t.labelEl.textContent, handle, file: handle ? null : t.file, note: unsaved ? "as saved" : "" };
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  if (tabHasUnsaved(tabs[idx]) && !confirm(`“${tabs[idx].labelEl.textContent}” has changes that are not saved. Close it anyway?`)) return;
  const [tab] = tabs.splice(idx, 1);
  if (tab.split) tab.split.close({ force: true });
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
  if (caseWindow && !tabs.length) window.close();
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
  btn.addEventListener("contextmenu", (e) => showTabMenu(e, id));
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
//
// Pulled up or down out of the strip, the tab comes away from it, as a
// browser's does: the others close up, a card with its name follows the
// pointer, and letting go there opens it in a window of its own at that spot
// (moveTabToWindow). Brought back to the strip, it is a reorder again. A lone
// tab stays put: its window is already its own.
const DRAG_SLOP = 4;  // px the pointer moves before a press is a drag
const EDGE_ZONE = 32; // px in from either end of the strip that scroll it
const TEAR_OFF = 30;  // px above or below the strip that pull a tab out of it

function dragTab(e, btn, id) {
  if (e.button !== 0 || e.target.closest(".tab-close")) return;
  const x0 = e.clientX, y0 = e.clientY;
  let lastX = x0;
  let drag = null; // set once the press has moved past DRAG_SLOP
  let raf = 0;
  let ghost = null; // the card that follows the pointer while the tab is out of the strip
  btn.setPointerCapture(e.pointerId);

  const begin = () => {
    const els = [...tabsEl.querySelectorAll(".tab")];
    const sl = tabsEl.scrollLeft;
    // Every tab's place along the strip's content, measured before anything
    // moves (a transform would show in a rect taken later).
    const slots = els.map((el) => { const r = el.getBoundingClientRect(); return { left: r.left + sl, width: r.width }; });
    const from = els.indexOf(btn);
    const gap = parseFloat(getComputedStyle(tabsEl).columnGap) || 0;
    const strip = document.getElementById("tabstrip").getBoundingClientRect();
    drag = {
      els, slots, from, to: from, step: slots[from].width + gap, grab: x0 + sl - slots[from].left,
      top: strip.top - TEAR_OFF, bottom: strip.bottom + TEAR_OFF, canTear: tabs.length > 1, tear: false,
    };
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
  // Out of the strip or back into it.
  const tear = (on) => {
    drag.tear = on;
    btn.classList.toggle("tearing", on);
    if (on) {
      for (const el of drag.els) if (el !== btn) el.style.transform = "";
      btn.style.transform = "";
      ghost = tabGhost(btn);
    } else {
      ghost.remove();
      ghost = null;
    }
  };
  const edgeScroll = () => {
    raf = 0;
    if (!drag || drag.tear) return;
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
      if (Math.hypot(lastX - x0, ev.clientY - y0) < DRAG_SLOP) return;
      begin();
    }
    const out = drag.canTear && (ev.clientY < drag.top || ev.clientY > drag.bottom);
    if (out !== drag.tear) tear(out);
    if (drag.tear) {
      ghost.style.transform = `translate(${ev.clientX - drag.grab}px, ${ev.clientY - 17}px)`;
      return;
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
    if (drag.tear) {
      const { els, grab } = drag;
      drag = null;
      ghost.remove();
      ghost = null;
      tabsEl.classList.remove("reordering");
      btn.classList.remove("dragging", "tearing");
      for (const el of els) el.style.transform = "";
      if (ev.type !== "pointercancel") moveTabToWindow(id, tornWindowAt(ev, grab));
      return;
    }
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
function newTab({ initialLabel, file, handle, text, dir, page = 0, focus = true, caseFolder = false }) {
  const id = ++seq;
  const iframe = document.createElement("iframe");
  iframe.className = "tab-view";
  iframe.src = text ? READER_SRC : VIEWER_SRC;
  // Ctrl+N is the app's wherever the keyboard is, and it is mostly in a tab.
  iframe.addEventListener("load", () => {
    try { iframe.contentWindow.addEventListener("keydown", newWindowKey, true); } catch { /* not ours */ }
  });
  viewsEl.appendChild(iframe);
  const { btn, labelEl } = makeTabButton(id, initialLabel || "Loading…", !!text);
  // `page`: where the reader was, for a PDF brought over from another window.
  const tab = { id, iframe, btn, labelEl, file, handle, text: !!text, dir: dir || null, caseFolder: !!caseFolder, page, fed: false, reflowed: false };
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
    // reader remembers it and attaches its key by itself. Opened as a case
    // folder (openCaseFolder), the reader may open it on its PDFs
    // (text-reader.js, pdfModeIfSettled); a tab brought from another window
    // opens as it was.
    const opened = tab.text && tab.caseFolder
      ? load(tab.file, tab.handle, tab.dir || undefined, { caseFolder: true })
      : load(tab.file, tab.handle, tab.dir || undefined);
    if (!tab.text) splitFor(tab).attach(w);
    if (tab.page > 1 && !tab.text) {
      Promise.resolve(opened).then(() => { try { w.__pdfViewerGoToPage?.(tab.page); } catch { /* gone */ } });
    }
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
// …and the text reader's ↗ Open PDF in new tab: the export's PDF, in a viewer
// tab of its own beside the reader's, at the page being read.
window.__appOpenPdf = (file, handle, page) => {
  if (!file) return;
  newTab({ initialLabel: file.name, file, handle: handle || null, page: page || 0 });
};

// ---- Open affordances ------------------------------------------------------

// ONE DIALOG AT A TIME. Chromium refuses a second file dialog while one is
// open, with "File picker already active", and a dialog can open behind the
// window (PDF+ especially), so a second click on Home's buttons was the
// natural thing to do and was answered with that message. Every dialog the
// shell opens goes through here: a click while one is open says where to look,
// and is then a cancel to its caller (AbortError), as is the browser's refusal
// of a dialog some other frame has open.
let dialogOpen = false;
const DIALOG_OPEN_MSG = "A file dialog is already open — finish or cancel it first (it may be behind this window).";
async function showPicker(name, opts) {
  const cancel = () => new DOMException("A file dialog is already open", "AbortError");
  if (dialogOpen) { shellToast(DIALOG_OPEN_MSG, 5000); throw cancel(); }
  dialogOpen = true;
  try { return await window[name](opts); }
  catch (e) {
    if (e && e.name === "InvalidStateError" && /already active/i.test(e.message || "")) { shellToast(DIALOG_OPEN_MSG, 5000); throw cancel(); }
    throw e;
  } finally { dialogOpen = false; }
}

// `startIn`: a folder to start the dialog in (a case folder with no exports
// yet); anything else, such as the click that called it, is ignored.
async function pickFiles(startIn = null) {
  if (window.showOpenFilePicker) {
    try {
      const handles = await showPicker("showOpenFilePicker", {
        ...(startIn && startIn.kind === "directory" ? { startIn } : {}),
        types: [
          { description: "PDF document", accept: { "application/pdf": [".pdf"] } },
          { description: "Text export", accept: { "text/plain": [".txt", ".LEAK"] } },
          { description: "Markdown", accept: { "text/markdown": [".md", ".markdown"] } },
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

async function pickCaseFolder(opts = {}) {
  if (!window.showDirectoryPicker) { alert("This browser cannot open a folder. Open the text files instead."); return; }
  let dir;
  try { dir = await showPicker("showDirectoryPicker", { mode: "readwrite" }); }
  catch (e) { if (e && e.name !== "AbortError") alert(String(e.message || e)); return; }
  await openCaseFolder(dir, opts);
}

/** The case folder `dir` in one reader tab, as the pick above opens it; a
 *  tab already reading it is brought to the front instead. `inWindow`: in a
 *  window of its own (Home's, below), where the browser lets one open. */
async function openCaseFolder(dir, { inWindow = false } = {}) {
  if (inWindow && (await focusCaseWindow(dir))) return;
  for (const t of tabs) {
    if (!t.text) continue;
    let held = t.dir;
    try { held = t.iframe.contentWindow.__textReaderSource?.()?.dir || held; } catch { /* not ready */ }
    try { if (held && (await held.isSameEntry(dir))) { activate(t.id); return; } } catch { /* gone */ }
  }
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
    // opening files: say what was not there and offer the file picker, in
    // that folder, rather than leaving a dead end behind the alert.
    if (confirm("No text exports in " + dir.name + (textDir ? "" : " — and no " + TEXT_SUBFOLDER + " folder in it: PDF-Linker has not run on it yet.")
      + "\n\nOpen files from it instead?")) pickFiles(dir);
    return;
  }
  // The combined file is the whole matter in one document, so it is the one
  // to open where the run made one; otherwise the first export, with the rest
  // listed in its Documents panel.
  const first = docs[0];
  let file;
  try { file = await first.getFile(); }
  catch (e) { alert("Could not open " + first.name + ": " + (e.message || e)); return; }
  if (inWindow && openCaseWindow(dir, { label: first.name, file, handle: first, text: true, dir, page: 0, caseFolder: true })) { rememberFolder(dir); return; }
  newTab({ initialLabel: first.name, file, handle: first, text: true, dir, focus: true, caseFolder: true });
  rememberFolder(dir);
}

// A CASE IN A WINDOW OF ITS OWN (the owner, 2026-11-18: "Now that it is acting
// as a hub, it should open in a new tab when I open a case folder"; asked
// which, "Its own window"). A case folder opened from Home (a row, or Open a
// case folder) opens in a new window of the app through the same handoff a
// tab moved to a window takes ("Separate windows"), so Home stays on screen
// here. The window remembers it holds a case, and closes once its last tab
// does. A second click on a case whose window still reads it brings that
// window to the front. Where the browser blocks the window (a popup opened
// after a dialog), the case opens in a tab here, as before.
const caseWindows = []; // [{ win, name }]
function openCaseWindow(dir, item) {
  const token = openWindow({ items: Promise.resolve([item]), quiet: true });
  if (!token) return false;
  const h = handoffs.get(token);
  caseWindows.push({ win: h.win, name: dir.name });
  return true;
}
/** Bring forward a window of this app that reads `dir`; whether there was one. */
async function focusCaseWindow(dir) {
  for (let i = caseWindows.length - 1; i >= 0; i--) {
    const cw = caseWindows[i];
    if (!cw.win || cw.win.closed) { caseWindows.splice(i, 1); continue; }
    if (cw.name !== dir.name) continue;
    let held = [];
    try { held = (cw.win.__shellCaseDirs && cw.win.__shellCaseDirs()) || []; } catch { held = []; }
    for (const d of held) {
      try { if (d && (await d.isSameEntry(dir))) { cw.win.focus(); return true; } } catch { /* gone */ }
    }
  }
  return false;
}
// What another window of the app asks to know: the case folders this one's readers hold.
Object.defineProperty(window, "__shellCaseDirs", {
  value: () => tabs.filter((t) => t.text).map((t) => {
    try { return t.iframe.contentWindow.__textReaderSource?.()?.dir || t.dir; } catch { return t.dir; }
  }).filter(Boolean),
});

newTabBtn.addEventListener("click", () => pickFiles());
document.getElementById("open-file")?.addEventListener("click", () => pickFiles());
document.getElementById("combine-files")?.addEventListener("click", combineFiles);
document.getElementById("images-to-pdf")?.addEventListener("click", imagesToPdf);
const caseBtn = document.getElementById("open-case");
if (caseBtn) caseBtn.addEventListener("click", (e) => { e.stopPropagation(); pickCaseFolder({ inWindow: true }); });
const caseBtn2 = document.getElementById("open-case-tab");
// From Home, the hub, the case opens in a window of its own; from a document, in this one.
if (caseBtn2) caseBtn2.addEventListener("click", () => pickCaseFolder({ inWindow: !dropzone.hidden }));
fileInput.addEventListener("change", () => {
  for (const f of fileInput.files) openLocalFile(f);
  fileInput.value = "";
});

// Drag and drop anywhere on the shell.
["dragenter", "dragover"].forEach((ev) =>
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    // A case folder dragged from Home onto the Folders list is no file drop.
    if (caseDrag) { if (e.dataTransfer) e.dataTransfer.dropEffect = "none"; return; }
    document.body.classList.add("dragging");
  })
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

// ---- Separate windows ------------------------------------------------------
//
// New window (the strip's button, Ctrl+N) opens another window of the app at
// Home; Move to new window (a tab's right-click menu, or pulling the tab out
// of the strip) takes a document there. Each window is this same shell with
// its own tabs, so nothing else in the app needs to know there are several.
//
// HOW THE WINDOW IS OPENED. window.open with popup features, and never
// noopener. From an installed app's window Chrome opens a popup as a window
// of the app (an "app popup": the app's frame, no browser chrome), and takes
// the features' size and place, which is what puts a torn-off tab where it
// was let go of. A noopener open is worse than no window: with the manifest's
// launch_handler `focus-existing`, Chrome's navigation capturing treats an
// in-scope open with no opener as a launch of the app, focuses the window
// already open and queues the URL to its launchQueue, so no window appears at
// all. In a browser tab (the site, not installed) the same call opens a popup
// window.
//
// HOW A DOCUMENT GETS THERE. A tab's iframe cannot be moved between windows
// (adopting it into another document reloads it), so a move opens the
// document again in the new window and then closes the tab here. The new
// window is opened with ?window=<token>, says hello to its opener with the
// token, and is posted the documents: File, file handle and case-folder
// handle all survive postMessage, cloned into the new window's own realm (an
// object handed across directly would die with this window). It answers
// "took" once its tabs are up, and only then does the tab close here; a
// window that never answers leaves the tab where it was.
//
// WHAT IS OPENED is the document as it stands on disk: the file the tab saves
// to (after a Save As, not the one it was opened from), read afresh here
// before it goes, so the new window shows what was on screen. That is why a
// tab with unsaved changes is not moved (the toast says to save it first),
// and why a password-protected PDF asks for its password again there. A PDF
// opens at the page it was on.
const WINDOW_PARAM = "window";
const handoffs = new Map(); // token → { items: Promise<item[]>, ids, timer }
const HANDOFF_WAIT = 30000; // ms a window has to take its documents before the tab is put back

function newWindowKey(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || (e.key !== "n" && e.key !== "N")) return;
  e.preventDefault();
  e.stopPropagation();
  openWindow();
}

/** Open another window of the app, the size of this one. `items`, a promise
 *  of documents, makes it a move; `at` is its top left corner on the screen
 *  (a step down and right of this window, as a browser cascades its own). */
function openWindow({ items = null, at = null, quiet = false } = {}) {
  const url = new URL("index.html", location.href);
  let token = null;
  if (items) {
    token = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    url.searchParams.set(WINDOW_PARAM, token);
  }
  const left = Math.round(at ? at.x : window.screenX + 32);
  const top = Math.round(at ? at.y : window.screenY + 32);
  const win = window.open(url.href, "_blank", `popup,width=${window.innerWidth},height=${window.innerHeight},left=${left},top=${top}`);
  if (!win) {
    if (!quiet) shellToast("The new window was blocked. Allow pop-ups for this app, then try again.", 6000);
    return null;
  }
  if (token) handoffs.set(token, { items, ids: [], timer: 0, win });
  return token;
}

/** Move a tab into a window of its own. */
function moveTabToWindow(id, at = null) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab || tabs.length < 2) return;
  if (tabHasUnsaved(tab)) {
    activate(id);
    shellToast(`Save “${tab.labelEl.textContent}” first: a document moves to its new window as it is on disk.`, 6000);
    return;
  }
  // The window opens now, while the click or the drop still counts as one
  // (Chrome blocks a window opened later); the document follows it. A file
  // that cannot be read is reported when the window asks for it.
  const items = tabItem(tab).then((item) => [item]);
  items.catch(() => {});
  const token = openWindow({ items, at });
  if (!token) return;
  const h = handoffs.get(token);
  h.ids = [id];
  tab.btn.classList.add("moving");
  h.timer = setTimeout(() => handoffFailed(token, "the new window did not open it"), HANDOFF_WAIT);
}

/** What a new window needs to open this tab's document as it is now. */
async function tabItem(tab) {
  let src = null;
  try {
    const w = tab.iframe.contentWindow;
    src = (tab.text ? w.__textReaderSource : w.__pdfViewerSource)?.() || null;
  } catch { src = null; }
  const handle = src ? src.handle || null : tab.handle || null;
  // Read here: this window holds the permission to, and the file on disk is
  // what the tab shows when nothing is unsaved.
  const file = handle ? await handle.getFile() : (src && src.file) || tab.file;
  return {
    file,
    handle,
    text: tab.text,
    dir: src ? src.dir || null : tab.dir,
    page: (src && src.page) || 0,
    label: tab.labelEl.textContent,
  };
}

function handoffFailed(token, why) {
  const h = handoffs.get(token);
  if (!h) return;
  clearTimeout(h.timer);
  handoffs.delete(token);
  for (const id of h.ids) {
    const t = tabs.find((x) => x.id === id);
    if (!t) continue;
    t.btn.classList.remove("moving");
    shellToast(`“${t.labelEl.textContent}” stays here: ${why}.`, 6000);
  }
}

/** Where a torn-off tab's window goes: with the tab under the pointer, as if
 *  it had been carried there. `grab` is where along the tab it was held. */
function tornWindowAt(ev, grab) {
  const side = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
  const titleBar = Math.max(0, window.outerHeight - window.innerHeight - side);
  const firstTab = homeTab.getBoundingClientRect().right + 2; // where the tab will sit in the new strip
  return { x: ev.screenX - side - firstTab - grab, y: ev.screenY - titleBar - 20 };
}

/** The card that follows a tab pulled out of the strip. */
function tabGhost(btn) {
  const g = document.createElement("div");
  g.className = "tab-ghost";
  const t = btn.cloneNode(true);
  t.classList.remove("dragging", "tearing", "settling", "moving");
  t.classList.add("active");
  t.style.transform = "";
  t.querySelector(".tab-close")?.remove();
  const hint = document.createElement("div");
  hint.className = "tab-ghost-hint";
  hint.innerHTML = `${icon("window-plus", { size: 14 })}<span>Drop to open in a new window</span>`;
  g.append(t, hint);
  document.body.appendChild(g);
  return g;
}

// The window that opened this one hands its documents over.
window.addEventListener("message", async (e) => {
  if (e.origin !== location.origin || !e.data || !handoffs.has(e.data.token)) return;
  const { type, token } = e.data;
  const h = handoffs.get(token);
  if (type === "pdfviewer:hello") {
    let items;
    try { items = await h.items; }
    catch (err) {
      handoffFailed(token, `it could not be read (${err.message || err})`);
      try { e.source.postMessage({ type: "pdfviewer:items", token, items: [] }, location.origin); } catch { /* closed */ }
      return;
    }
    try { e.source.postMessage({ type: "pdfviewer:items", token, items }, location.origin); }
    catch (err) {
      handoffFailed(token, `it could not be handed over (${err.message || err})`);
      try { e.source.postMessage({ type: "pdfviewer:items", token, items: [] }, location.origin); } catch { /* closed */ }
    }
  } else if (type === "pdfviewer:took") {
    clearTimeout(h.timer);
    handoffs.delete(token);
    // Nothing was unsaved when it left; closeTab asks only if something has
    // been typed into it since.
    for (const id of h.ids) closeTab(id);
  }
});

// A text reader whose Re-run PDF-Linker has started the run closes its tab:
// the run rewrites the folder's files under it (text-reader.js, rerunLinker).
// Everything was saved first, so closeTab asks nothing.
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data || e.data.type !== "textreader:close") return;
  const tab = tabs.find((t) => t.text && t.iframe.contentWindow === e.source);
  if (!tab) return;
  closeTab(tab.id);
  if (typeof e.data.text === "string") shellToast(e.data.text, 10000);
});

// This window was opened to take documents from another one.
const arrival = new URLSearchParams(location.search).get(WINDOW_PARAM);
// A window opened for a case from Home's hub: it closes with its last tab.
let caseWindow = false;
if (arrival) {
  // A reload is a fresh window at Home, not a second helping of the documents.
  history.replaceState(null, "", location.pathname + location.hash);
  const from = window.opener;
  if (from) {
    window.addEventListener("message", (e) => {
      if (e.origin !== location.origin || e.source !== from || !e.data) return;
      if (e.data.type !== "pdfviewer:items" || e.data.token !== arrival) return;
      const items = e.data.items || [];
      // Nothing came: the window it came from says why. An empty window
      // left behind would be one more to close.
      if (!items.length) { window.close(); return; }
      if (items.some((it) => it.caseFolder)) caseWindow = true;
      items.forEach((it, i) => newTab({
        initialLabel: it.label || (it.file && it.file.name), file: it.file, handle: it.handle,
        text: it.text, dir: it.dir, page: it.page, focus: i === 0, caseFolder: !!it.caseFolder,
      }));
      from.postMessage({ type: "pdfviewer:took", token: arrival }, location.origin);
    });
    from.postMessage({ type: "pdfviewer:hello", token: arrival }, location.origin);
  }
}

document.getElementById("new-window")?.addEventListener("click", () => openWindow());

// A tab's right-click menu.
const tabMenu = document.createElement("div");
tabMenu.className = "shell-menu";
tabMenu.setAttribute("role", "menu");
tabMenu.hidden = true;
tabMenu.innerHTML = `<button role="menuitem" data-act="window">${icon("window-plus", { size: 16 })}<span>Move to new window</span></button>`
  + `<button role="menuitem" data-act="close">${icon("x", { size: 16 })}<span>Close tab</span></button>`;
document.body.appendChild(tabMenu);
let menuTab = null;
function showTabMenu(e, id) {
  e.preventDefault();
  menuTab = id;
  // A lone tab is in a window of its own already.
  tabMenu.querySelector('[data-act="window"]').disabled = tabs.length < 2;
  tabMenu.hidden = false;
  const r = tabMenu.getBoundingClientRect();
  tabMenu.style.left = `${Math.max(4, Math.min(e.clientX, window.innerWidth - r.width - 4))}px`;
  tabMenu.style.top = `${Math.max(4, Math.min(e.clientY, window.innerHeight - r.height - 4))}px`;
}
function hideTabMenu() { tabMenu.hidden = true; menuTab = null; }
tabMenu.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b || b.disabled) return;
  const id = menuTab;
  hideTabMenu();
  if (b.dataset.act === "window") moveTabToWindow(id);
  else closeTab(id);
});
document.addEventListener("pointerdown", (e) => { if (!tabMenu.hidden && !tabMenu.contains(e.target)) hideTabMenu(); }, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !tabMenu.hidden) hideTabMenu(); });
window.addEventListener("blur", hideTabMenu); // a click into a document goes to its frame, not here
window.addEventListener("resize", hideTabMenu);

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
// The viewer renames its document's file (the name in its toolbar): asked
// while `handle` is still the file Recent remembers, this finds that entry and
// answers with what puts the renamed handle in its place. A stored handle
// still names the old path, so after the move it is no longer the same entry.
window.__appRenamingFile = async (handle) => {
  const keys = [];
  for (const r of await recentAll()) { try { if (await r.handle.isSameEntry(handle)) keys.push(r.key); } catch { /* stale */ } }
  return async (moved) => {
    if (!keys.length) return;
    try {
      const list = await recentAll();
      const db = await recentDb();
      const store = db.transaction("files", "readwrite").objectStore("files");
      for (const r of list) if (keys.includes(r.key)) store.put({ ...r, name: moved.name, handle: moved });
      await new Promise((resolve) => { store.transaction.oncomplete = store.transaction.onerror = resolve; });
    } catch { /* storage unavailable */ }
    renderRecent();
  };
};
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

// ---- Home: case folders ------------------------------------------------------
//
// The matters in hand, each with what PDF-Linker is doing in it: the case
// folders opened here (Open a case folder, a row of this list, or a folder a
// reader tab attached however it was opened: "textreader:folder"), and the
// folders that came into Downloads TODAY, where the E-Court downloads land.
// A click opens the whole folder in one reader, as Open a case folder does.
//
// DOWNLOADS IS LINKED ONCE. A page cannot read a folder by its path, so the
// operator points the app at Downloads with one pick (the dialog starts
// there), kept as a handle in IndexedDB beside the folders. Read leave only:
// the folders are opened for writing one at a time, on their own click. A
// browser may want that leave given again next session, on a click ("Allow
// Downloads"); an installed app can keep it.
//
// STATUS is read off the run's own traces, as the reader's run bar reads them
// (case-folders.js, folderStatus): the ETA and DONE markers, the key, the log,
// LEAKS.xlsx and the quarantined exports. Looked at again while Home is up
// (CASE_RECHECK_MS) and when the window comes back, and redrawn only where
// something changed, so a hover or a keyboard focus is not knocked off a row.
const FOLDERS_DB = "pdfviewer-folders";
const CASE_RECHECK_MS = 15000;
const CASE_ROWS_MAX = 15;
const FOLDERS_KEPT = 12;
const DOC_STATS_MAX = 6; // documents a folder's time is read from; the run's own files always are
let caseLib = null;

function foldersDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FOLDERS_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("folders", { keyPath: "key" });
      req.result.createObjectStore("places");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
/** One transaction on `store`; `fn(store)` returns a request whose result is the answer, or nothing. */
async function foldersTx(store, mode, fn) {
  const db = await foldersDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
async function foldersAll() {
  try { return ((await foldersTx("folders", "readonly", (s) => s.getAll())) || []).sort((a, b) => b.when - a.when); }
  catch { return []; }
}
async function rememberFolder(dir) {
  if (!dir || dir.kind !== "directory") return;
  try {
    const list = await foldersAll();
    let key = null;
    for (const r of list) {
      if (r.name !== dir.name) continue;
      try { if (await r.handle.isSameEntry(dir)) { key = r.key; break; } } catch { /* gone */ }
    }
    await foldersTx("folders", "readwrite", (s) => {
      s.put({ key: key || `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: dir.name, handle: dir, when: Date.now() });
      for (const old of list.filter((r) => r.key !== key).slice(FOLDERS_KEPT - 1)) s.delete(old.key);
    });
  } catch { /* storage unavailable: the folder is simply not listed */ }
  if (!dropzone.hidden) renderCaseFolders();
}
async function downloadsDir() {
  try { const h = await foldersTx("places", "readonly", (s) => s.get("downloads")); return h && h.kind === "directory" ? h : null; }
  catch { return null; }
}

async function permitted(h, mode, ask) {
  try {
    if (!h.queryPermission) return true;
    if ((await h.queryPermission({ mode })) === "granted") return true;
    return ask ? (await h.requestPermission({ mode })) === "granted" : false;
  } catch { return false; }
}

/** One look at a folder: a listing for case-folders.js, the times read only off the files that say something. */
async function readListing(dir) {
  const files = [], dirs = [];
  let textDir = null;
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind === "directory") {
      dirs.push(name);
      if (name.toLowerCase() === TEXT_SUBFOLDER.toLowerCase()) textDir = entry;
    } else files.push({ name, entry });
  }
  let docs = 0;
  const out = [];
  let priority = null;
  for (const f of files) {
    if (f.name.toLowerCase() === caseLib.PRIORITY_FILE.toLowerCase()) {
      // The folder's place in PDF-Linker's line: its words, not its time.
      try { priority = caseLib.parsePriority(await (await f.entry.getFile()).text()); } catch { priority = null; }
    }
    const doc = /\.(pdf|docx?)$/i.test(f.name);
    if (!caseLib.signalFile(f.name) || (doc && ++docs > DOC_STATS_MAX)) { out.push({ name: f.name }); continue; }
    try { const file = await f.entry.getFile(); out.push({ name: f.name, size: file.size, at: file.lastModified }); }
    catch { out.push({ name: f.name }); }
  }
  // When the run going started, read off pdf_linker.log only while an ETA
  // marker says a run is going (case-folders.js, lastRunStart).
  let runStart = 0;
  const logEntry = files.find((f) => f.name.toLowerCase() === "pdf_linker.log");
  if (logEntry && files.some((f) => { const m = caseLib.runMarker(f.name); return m && m.kind === "ETA"; })) {
    try { runStart = await readRunStart(dir.name, logEntry.entry); } catch { runStart = 0; }
  }
  let held = 0;
  if (textDir) {
    try { for await (const [name, entry] of textDir.entries()) if (entry.kind === "file" && /\.txt\.leak$/i.test(name)) held++; }
    catch { /* unreadable: nothing held that can be seen */ }
  }
  return { files: out, dirs, held, priority, runStart };
}

// The last "Run started" line of each folder's log, by folder name: the log
// only grows during a run, so after the first look only what it added since
// is read. A log that shrank (a new one) is read again from its end.
const RUN_START_CHUNK = 512 * 1024;
const RUN_START_SCAN_MAX = 64 * 1024 * 1024;
const runStartSeen = new Map();
async function readRunStart(key, entry) {
  const file = await entry.getFile();
  const size = file.size;
  const was = runStartSeen.get(key);
  if (was && was.size === size) return was.start;
  let start = 0;
  if (was && size > was.size) {
    start = caseLib.lastRunStart(await file.slice(Math.max(0, was.size - 200), size).text()) || was.start;
  } else {
    // From the end back, a chunk at a time, each reaching a little into the
    // next so a line cut by a chunk's end is read whole.
    for (let end = size; end > 0 && size - end < RUN_START_SCAN_MAX && !start; end -= RUN_START_CHUNK) {
      const from = Math.max(0, end - RUN_START_CHUNK);
      start = caseLib.lastRunStart(await file.slice(from, Math.min(size, end + 200)).text());
    }
  }
  runStartSeen.set(key, { size, start });
  return start;
}

// Downloads holds every case ever downloaded, so each folder in it is read by
// its NAMES first, and its files' times only where the names changed since the
// last look (a run renames its ETA marker after every PDF, and DONE replaces
// it), the day did, or a run is going in it. A zip's time never changes, so it is read once.
const downloadsSeen = new Map(); // folder name → { sig, day, listing }
const zipTimes = new Map();      // zip name → lastModified
/**
 * A Downloads folder's listing, read again only where its names changed since
 * the last look, the day did, or a run is going in it; null where it cannot
 * be read.
 */
async function cachedListing(dir, now) {
  const day = caseLib.startOfDay(now);
  let names;
  try { names = []; for await (const [n] of dir.entries()) names.push(n); } catch { return null; }
  const sig = names.sort().join("\n");
  const seen = downloadsSeen.get(dir.name);
  let listing = seen && seen.sig === sig && seen.day === day ? seen.listing : null;
  // A run going is read again each look: the names hold still through a
  // long PDF, and pdf_linker.log's time is what says the run is alive.
  if (listing && /^(running|stalled)$/.test(caseLib.folderStatus(listing, now).state)) listing = null;
  if (!listing) {
    try { listing = await readListing(dir); } catch { return null; }
    downloadsSeen.set(dir.name, { sig, day, listing });
  }
  return listing;
}
async function todayInDownloads(dl, now) {
  const day = caseLib.startOfDay(now);
  // PDF+ knows each folder's own time (main.js, "pdfplus:downloads-today"),
  // so only the day's folders are read at all. Where the linked folder is
  // not the Downloads it lists (another folder was picked), or an older PDF+
  // has no such call (app files run from a checkout), every folder is read.
  let native = null;
  try { native = window.pdfplusNative && window.pdfplusNative.downloadsToday ? await window.pdfplusNative.downloadsToday(day) : null; }
  catch { native = null; }
  if (native && Array.isArray(native.folders) && native.name.toLowerCase() === dl.name.toLowerCase()) {
    const rows = [];
    for (const f of native.folders) {
      let dir;
      try { dir = await dl.getDirectoryHandle(f.name); } catch { continue; }
      let listing;
      try { listing = await readListing(dir); } catch { continue; }
      if (caseLib.isCaseListing(listing)) rows.push({ name: f.name, handle: dir, listing, today: true, opened: 0, activity: f.at, parent: dl, root: dl, chain: [f.name] });
    }
    return rows;
  }
  const zipsToday = new Set();
  const subs = [];
  for await (const [name, entry] of dl.entries()) {
    if (entry.kind === "directory") { subs.push(entry); continue; }
    if (!/\.zip$/i.test(name)) continue;
    if (!zipTimes.has(name)) { try { zipTimes.set(name, (await entry.getFile()).lastModified); } catch { zipTimes.set(name, 0); } }
    if (zipTimes.get(name) >= day) zipsToday.add(name.replace(/\.zip$/i, "").toLowerCase());
  }
  const rows = [];
  const look = async (dir) => {
    const listing = await cachedListing(dir, now);
    if (!listing || !caseLib.isCaseListing(listing) || !caseLib.isToday(dir.name, listing, now, zipsToday)) return;
    rows.push({ name: dir.name, handle: dir, listing, today: true, opened: 0, parent: dl, root: dl, chain: [dir.name] });
  };
  // A few at a time: a synced Downloads answers slowly, one folder after another.
  for (let i = 0; i < subs.length; i += 4) await Promise.all(subs.slice(i, i + 4).map(look));
  return rows;
}

// Re-runs a reader has just started ("textreader:run"), shown as started until
// the folder's own ETA says so (case-folders.js, withRunStart).
const runsStarted = []; // [{ handle, name, at, how }]: how "rerun" (a reader's) or "takeover" (Home's)
const RUN_START_RECHECK_MS = 3000; // looked at this often while one waits for its ETA
/** The start a row's folder is waiting on, or null. */
async function runStartFor(row) {
  for (const s of runsStarted) {
    if (s.name !== row.name) continue;
    try { if (await s.handle.isSameEntry(row.handle)) return s; } catch { /* gone */ }
  }
  return null;
}

let caseRendering = false, caseAgain = false, caseShown = "", caseTimer = 0;
let drawFailSaid = "";
async function renderCaseFolders() {
  if (caseRendering) { caseAgain = true; return; }
  caseRendering = true;
  try {
    do { caseAgain = false; await renderCaseFoldersNow(); } while (caseAgain);
  } catch (e) {
    // Said, not only logged: a draw that fails leaves the old list standing,
    // which reads as a button that does nothing (the owner, 2026-11-20, of
    // Show previous: "doesn't seem to do anything").
    console.warn(e);
    const msg = String((e && e.message) || e);
    if (msg !== drawFailSaid) {
      drawFailSaid = msg;
      shellToast(`Home could not draw its lists: ${msg}${e && e.stack ? " (" + String(e.stack).split("\n").slice(1, 2).join("").trim() + ")" : ""}`, 12000);
    }
  }
  finally { caseRendering = false; }
}
async function renderCaseFoldersNow() {
  const section = document.getElementById("case-folders");
  const listEl = document.getElementById("case-list");
  if (!section || !listEl || !window.showDirectoryPicker) return;
  if (!caseLib) caseLib = await import("./viewer/case-folders.js");
  const now = Date.now();
  const rows = [];
  const goneKeys = [];
  for (const r of await foldersAll()) {
    const row = { name: r.name, handle: r.handle, opened: r.when, today: false, key: r.key };
    if (await permitted(r.handle, "read", false)) {
      // A folder that cannot be read is not listed (the owner: "it should just
      // stop listing that case", not "Not found — moved or deleted?"). One the
      // disk says is gone (moved, renamed or deleted) is forgotten as well, so it
      // does not hold one of the FOLDERS_KEPT places; any other failure (a
      // synced or network drive away for now) only leaves it out of this look.
      try { row.listing = await readListing(r.handle); }
      catch (e) { if (e && e.name === "NotFoundError") goneKeys.push(r.key); continue; }
    } else row.locked = true;
    rows.push(row);
  }
  if (goneKeys.length) {
    try { await foldersTx("folders", "readwrite", (s) => { for (const k of goneKeys) s.delete(k); }); } catch { /* not forgotten: left out again next look */ }
  }
  const dl = await downloadsDir();
  const dlState = !dl ? "none" : (await permitted(dl, "read", false)) ? "ok" : "locked";
  if (dlState === "ok") {
    let found = [];
    try { found = await todayInDownloads(dl, now); } catch { /* Downloads unreadable this time */ }
    for (const f of found) {
      // A folder opened here AND downloaded today is one row.
      let same = null;
      for (const r of rows) {
        if (r.name !== f.name) continue;
        try { if (await r.handle.isSameEntry(f.handle)) { same = r; break; } } catch { /* gone */ }
      }
      if (same) { same.today = true; if (!same.listing) { same.listing = f.listing; same.locked = false; } }
      else rows.push(f);
    }
  }
  // A re-run started on a folder that is in neither list (forgotten meanwhile) is still listed.
  for (const s of runsStarted) {
    let found = false;
    for (const r of rows) if (r.name === s.name) { try { if (await r.handle.isSameEntry(s.handle)) { found = true; break; } } catch { /* gone */ } }
    if (found) continue;
    const row = { name: s.name, handle: s.handle, opened: 0, today: false };
    try { row.listing = await readListing(s.handle); } catch { row.listing = null; }
    rows.push(row);
  }
  // The hearings sheet, read once a look. Each hearing on its list is matched
  // to its case folder (hearingItems), and a folder so matched is shown on its
  // hearing's row, with its buttons; a Downloads folder matched that the list
  // did not hold joins `rows`, so its status and place in line are read too.
  const sheet = await loadSheet();
  const hv = await hearingItems(rows, sheet, dl, dlState, now);
  hv.briefing = dlState === "ok" && sheet.hearings.length ? await readBriefing(dl) : { entries: [], at: 0, none: true };
  // A hearing the sheet gives no link: one from another row of its case, or
  // the calendar E-Court Suite read (fillEcourtLinks), for its eCourt button.
  hearingLib.fillEcourtLinks(sheet.hearings, hv.briefing && !hv.briefing.none ? hv.briefing.calendar : null);
  // The hearings for E-Court Suite to check on each case's Hearings tab (moved, off).
  if (dlState === "ok" && sheet.state === "ok") { try { await writeSheetHearings(dl, sheet.hearings, now); } catch (e) { console.warn("sheet hearings", e); } }
  // The Claude extension's workflow runs (viewer/claude-runs.js).
  hv.runs = dlState === "ok" ? await readClaudeRuns(dl) : null;
  // The calendar E-Court Suite read, written into the sheet; a change made
  // reads the sheet again (the next pass).
  try { if (await syncCalendar(sheet, hv.briefing, now)) caseAgain = true; } catch (e) { console.warn("calendar", e); }
  for (const r of rows) {
    r.status = r.listing ? caseLib.folderStatus(r.listing, now) : null;
    r.activity = Math.max(r.activity || 0, r.listing ? caseLib.lastActivity(r.listing) : 0);
    const start = runsStarted.length && !r.locked ? await runStartFor(r) : null;
    if (start) {
      const { status, keep } = caseLib.withRunStart(r.status, start.at, now, start.how);
      r.status = status;
      if (!keep) runsStarted.splice(runsStarted.indexOf(start), 1);
    }
  }
  // The Case folders list holds only the folders no hearing on the list is
  // matched to (the owner: "ideally this will never happen"); each still says
  // its hearing where the sheet has one, a past one.
  for (const r of rows) r.hearing = sheet.hearings.length ? hearingLib.hearingForPlace(sheet.hearings, placeOfRow(r), now) : null;
  await syncLine(rows, now);
  const line = caseLib.sortRows(rows).filter((r) => r.rank > 0);
  // …nor one whose hearing is marked done or off calendar (the owner: "cases
  // that are done and off don't need to be shown in the Case Folders rows"),
  // unless a run is going in it.
  const settledMark = (r) => r.hearing && r.hearing.mark && !(r.status && /^(running|starting|stalled)$/.test(r.status.state));
  const shown = caseLib.sortRows(rows.filter((r) => !hv.matched.has(r) && !settledMark(r))).slice(0, CASE_ROWS_MAX);
  lineShown = line;
  rowsShown = [...shown, ...hv.matched];
  showDownloadsLink(dl, dlState);
  renderTree(dl, dlState);
  try { await renderHearings(sheet, hv, dlState, now, line); } catch (e) { console.warn(e); }
  // Hidden where every folder is on a hearing's row; listed as before where no sheet is linked.
  section.hidden = !shown.length && sheet.state !== "none";
  const head = section.querySelector("h2");
  if (head) head.textContent = sheet.state === "none" ? "Case folders" : "Case folders not on the hearings list";
  const say = shown.map((r) => {
    const st = r.locked ? { text: "Click to allow", title: "The browser wants your leave to read this folder again.", tone: "idle" }
        : caseLib.statusText(r.status, now);
    const where = [];
    if (r.today) where.push("In Downloads today");
    if (r.opened) where.push("Opened " + caseLib.whenText(r.opened, now));
    // A run going: when it started and how long it has gone (runningSub).
    if (st.sub) where.unshift(st.sub);
    // The case's hearing, off the hearings sheet.
    if (r.hearing) where.unshift(hearingWhen(r.hearing, now));
    return { r, st, where: where.join(" · ") };
  });
  // Redrawn only where something changed (the text of a row, Downloads' link).
  const sig = dlState + "\n" + say.map(({ r, st, where }) => [r.name, where, st.text, st.tone, r.rank || 0, prioTotal, r.status ? r.status.state : "", caseLib.hasShareLog(r.listing) ? 1 : 0, canOpenWord() ? caseLib.wordDocs(r.listing).join("/") : "", r.hearing ? hearingLib.ecourtUrlOf(r.hearing) : ""].join("|")).join("\n");
  scheduleCaseRecheck();
  if (sig === caseShown) return;
  caseShown = sig;
  document.getElementById("case-clear").hidden = !rows.some((r) => r.opened);
  listEl.textContent = "";
  if (!say.length) {
    const p = document.createElement("p");
    p.className = "case-empty";
    p.textContent = dlState === "ok"
      ? "No case folder in Downloads today, and none opened here yet."
      : "Case folders you open here are listed with what PDF-Linker is doing in each" + (dlState === "none" ? " — and, once Downloads is linked, the ones downloaded today." : ".");
    listEl.appendChild(p);
    return;
  }
  for (const { r, st, where } of say) {
    const row = document.createElement("div");
    row.className = "case-row";
    const b = document.createElement("button");
    b.className = "recent-item case-item";
    b.innerHTML = `<span class="ri-icon">${icon("folder", { size: 18 })}</span><span class="ci-main"><span class="ci-name-line"><span class="ri-name"></span></span><span class="ci-where"></span></span><span class="ci-status"></span>`;
    b.querySelector(".ri-name").textContent = r.name;
    if (!r.locked && r.status && r.status.leaks) b.querySelector(".ci-name-line").appendChild(leaksChip());
    b.querySelector(".ci-where").textContent = where;
    const pill = b.querySelector(".ci-status");
    pill.textContent = st.text;
    pill.classList.add("tone-" + st.tone);
    pill.title = st.text;
    b.title = `Open ${r.name}, the whole case folder, in one reader` + (st.title ? ".\n" + st.title : "")
      + (sheet.state !== "none" ? `\nNo hearing on the list matched it (case numbers it carries: ${listingNumbers(r.listing).concat(hearingLib.caseNumbersIn(r.name)).filter((x, i, a) => a.indexOf(x) === i).join(", ") || "none"}).` : "");
    b.addEventListener("click", async () => {
      // Asked first, while the click still counts as one: a reader saves into the folder.
      if (!(await permitted(r.handle, "readwrite", true))) return;
      try { await openCaseFolder(r.handle, { inWindow: true }); }
      catch (e) { shellToast(`“${r.name}” could not be opened — it may have been moved or deleted.`, 5000); renderCaseFolders(); }
    });
    row.appendChild(b);
    caseDraggable(row, r);
    if (r.hearing && hearingLib.ecourtUrlOf(r.hearing)) row.appendChild(ecourtButton(r.hearing));
    for (const x of folderControls(r, line)) row.appendChild(x);
    listEl.appendChild(row);
  }
}

/**
 * The badge a case folder with a LEAKS sheet carries by its name (the owner,
 * 2026-11-20: "Update the home screen to show whether there is a LEAKS SHEET
 * in the folder"): LEAKS.xlsx stands in the folder until no row needs a look.
 */
function leaksChip() {
  const chip = document.createElement("span");
  chip.className = "ci-leaks-chip";
  chip.textContent = "LEAKS";
  chip.setAttribute("aria-label", "LEAKS sheet in the folder");
  chip.title = "LEAKS.xlsx is in this case folder: PDF-Linker flagged values for you to answer in its Fix? column. It goes once no row needs a look.";
  return chip;
}

/**
 * A row's buttons are icons, to leave the case name its room (the owner,
 * 2026-11-18: "the new Hearings section is too narrow, it basically only shows
 * the case number. Let's switch some of the buttons to icons"); each keeps its
 * name as its label and hover.
 */
function iconise(b, name, label, extra = "") {
  b.classList.add("ci-ico");
  b.innerHTML = icon(name, { size: 16 }) + extra;
  b.setAttribute("aria-label", label);
  if (!b.title) b.title = label;
  return b;
}

/**
 * A case folder's own buttons, wherever its row stands (the Case folders list,
 * or its hearing's row): Word, Log to share, Prioritize, Take over.
 */
function folderControls(r, line) {
  const out = [];
  if (r.locked) return out;
  if (canOpenWord() && caseLib.wordDocs(r.listing).length) out.push(wordButton(r));
  if (caseLib.hasShareLog(r.listing)) out.push(shareLogButton(r));
  if (r.listing) out.push(lineControls(r));
  if (r.status && r.status.state === "stalled") out.push(takeOverButton(r));
  return out;
}
/** What a folder's buttons say, for the redraw signatures. */
function folderControlsSig(r, line) {
  if (!r || r.locked) return r ? "locked" : "";
  return [r.rank || 0, prioTotal, caseLib.hasShareLog(r.listing) ? 1 : 0,
    canOpenWord() ? caseLib.wordDocs(r.listing).join("/") : "", r.status ? r.status.state : ""].join("/");
}
/** The Downloads link, in the Hearings heading: it serves both lists. */
function showDownloadsLink(dl, dlState) {
  setupNeeded("downloads", dlState !== "ok");
  const dlBtn = document.getElementById("case-downloads");
  if (!dlBtn) return;
  dlBtn.textContent = dlState === "none" ? "Link Downloads…" : dlState === "locked" ? "Allow Downloads" : "Change Downloads folder…";
  dlBtn.title = dlState === "none"
    ? "Point the app at your Downloads folder once: each hearing's case is looked for in it, and the case folders that come into it each day are listed"
    : dlState === "locked" ? "The browser wants your leave to read Downloads again" : `Case folders are read from ${dl.name}`;
}

// ---- Home: the briefing E-Court Suite reports --------------------------------
//
// The owner (2026-11-19): integrate Home "with e-court suite so that it can do
// updates on the status of oppositions and replies". The extension works each
// hearing's briefing out on its case page and on its day's agenda, and its
// native host writes it to BRIEFING_FILE in Downloads (hearing-sheet.js,
// "the briefing E-Court Suite reports"); Home reads it there each look, again
// only where its size or time moved, and shows each hearing's Motion,
// Opposition and Reply as the case page colours them. Opening a case in
// eCourt (the eCourt button), or its day's agenda, brings it up to date.
const BRIEFING_STALE_MS = 12 * 3600000;
let briefingSeen = null; // { key, entries, at }
async function readBriefing(dl) {
  let fh;
  try { fh = await dl.getFileHandle(hearingLib.BRIEFING_FILE); }
  catch { return { entries: [], at: 0, none: true }; }
  try {
    const f = await fh.getFile();
    const key = `${f.size}|${f.lastModified}`;
    if (!briefingSeen || briefingSeen.key !== key) {
      const parsed = hearingLib.parseBriefingFile(await f.text());
      briefingSeen = { key, entries: parsed.entries, refresh: parsed.refresh, calendar: parsed.calendar, at: f.lastModified };
    }
    return briefingSeen;
  } catch { return briefingSeen || { entries: [], at: 0, none: true }; }
}
// The sheet's rows a hearing's briefing is matched among (briefingsFor's
// `sameDay`): every upcoming row not off calendar, set by renderHearings.
let briefRows = null;
/** The briefing entries a hearing's row shows: one per motion set that day (hearing-sheet.js, briefingsFor). */
const briefingsOf = (hg, briefing) => (briefing && !briefing.none ? hearingLib.briefingsFor(hg, briefing.entries, briefRows) : []);
/**
 * The row's briefing column: chips, or a faint dash where the extension has
 * said nothing of the hearing yet. A case with more than one motion set that
 * day (one row, as Copy All writes it) shows one line of chips a motion, each
 * led by the motion's tag, as the case page works each up apart.
 */
function briefingCell(hg, briefing, now) {
  const cell = document.createElement("span");
  cell.className = "ci-brief";
  if (!briefing || briefing.none || hg.mark === "off") return cell;
  const list = briefingsOf(hg, briefing);
  if (!list.length) {
    if (hg.caseNumber && hg.mark !== "done") {
      cell.classList.add("none");
      cell.textContent = "—";
      cell.title = "E-Court Suite has not reported this hearing's briefing yet. Its hourly refresh (weekdays, 8 AM to 6 PM, while an eCourt tab is open in Chrome) reads every upcoming hearing on the sheet that has its eCourt link; Refresh from eCourt, above, runs it now.";
    }
    return cell;
  }
  const multi = list.length > 1;
  if (multi) cell.classList.add("multi");
  const lines = [];
  for (const entry of list) {
    const asOf = `Last updated ${caseLib.whenText(entry.at, now)} by E-Court Suite, which reads it again every few hours on its own (Refresh from eCourt, above, does it now).`;
    const group = multi ? document.createElement("span") : cell;
    if (multi) {
      group.className = "ci-brief-group";
      const tag = document.createElement("span");
      tag.className = "ci-brief-tag";
      tag.textContent = hearingLib.motionTag(entry.motionType);
      tag.title = entry.motionType || "";
      group.appendChild(tag);
      cell.appendChild(group);
    }
    if (now - entry.at > BRIEFING_STALE_MS) group.classList.add("stale");
    const chips = hearingLib.briefingChips(entry);
    // Each chip's due date on a line under it, where any chip has one; a chip
    // without keeps the line blank, so the chips stay one height.
    // Where every chip is due the same day, the date is said once, after
    // them (the owner, 2026-11-24).
    const oneDue = chips.length > 1 && chips[0].due && chips.every((c) => c.due === chips[0].due) ? chips[0].due : "";
    const dueLine = !oneDue && chips.some((c) => c.due);
    for (const ch of chips) {
      const chip = document.createElement("span");
      chip.className = "ci-chip st-" + ch.state + (dueLine ? " has-due" : "");
      const top = document.createElement("span");
      top.className = "cc-label";
      top.textContent = ch.label + (ch.mark ? " " + ch.mark : "");
      chip.appendChild(top);
      if (dueLine) {
        const due = document.createElement("span");
        due.className = "cc-due";
        due.textContent = ch.due || "\u00a0";
        chip.appendChild(due);
      }
      chip.title = (multi && entry.motionType ? entry.motionType + " — " : "") + ch.title + "\n" + asOf;
      group.appendChild(chip);
    }
    if (oneDue) {
      const due = document.createElement("span");
      due.className = "cc-due-once";
      due.textContent = oneDue;
      due.title = `Every paper above is due ${oneDue.replace(/^Due /, "")}`;
      group.appendChild(due);
    }
    lines.push((multi && entry.motionType ? entry.motionType + ": " : "") + (entry.text || "") + "\n" + asOf);
  }
  cell.title = lines.join("\n\n");
  // When it was last brought up to date, first in the hover (the owner,
  // 2026-11-20: "It should also show the time of most recent update" … "It
  // doesn't need to be in the row, just visible on hover over the briefing"):
  // the oldest of the row's motions, so it never claims more than every chip has.
  const at = Math.min(...list.map((e) => e.at || 0));
  // …and what E-Court Suite's own refresh last did, which says why an update
  // is old (the owner: "it is saying yesterday, which is inaccurate").
  const rs = briefing.refresh ? hearingLib.refreshText(briefing.refresh, now) : null;
  const refreshLine = rs ? `E-Court Suite's background refresh: ${rs.text}${rs.title ? " — " + rs.title : ""}` : "E-Court Suite's background refresh has not reported running (it needs E-Court Suite 3.49.30 or later, reloaded, and an eCourt tab open in Chrome, weekdays 8 AM to 6 PM).";
  if (at) cell.title = `Last updated ${caseLib.whenText(at, now)}\n${refreshLine}\n\n` + cell.title;
  return cell;
}
const briefingMissing = (hg, briefing) => briefingsOf(hg, briefing).some((e) => ["motion", "opp", "reply"].some((k) => e[k] && e[k].note === "Not Filed"));

// Refresh from eCourt: E-Court Suite reads the next ten court days at once
// (its service worker, "The background refresh"). Home cannot reach eCourt,
// so it opens an eCourt page the extension knows (REFRESH_URL) in Chrome; the
// extension runs the check in that tab and closes it when done, or leaves it
// open where eCourt wants a sign-in. The file says how it went.
const REFRESH_URL = "https://civil.lacourt.org/#lac-refresh-briefing";
document.getElementById("briefing-refresh")?.addEventListener("click", () => {
  window.open(REFRESH_URL, "_blank", "noopener");
  // A notice of calendar changes needs the leave to show one; a click is when to ask.
  try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {}); } catch { /* none */ }
  shellToast("E-Court Suite is reading eCourt in Chrome: the next ten court days' calendar, and the briefing. Home shows it as soon as it is done.", 6000);
});

// ---- Home: the sidebar's foot ------------------------------------------------
//
// The owner (2026-11-19): "move the check for updates to the bottom left
// corner. same with the app files: and how Home works". PDF+'s shim puts its
// version, Check for updates and App files (.pdfplus-about) into #home-foot,
// at the bottom of the Folders sidebar, beside How Home's lists work; an older
// shim put it at the end of Home's main column, so it is moved here from
// wherever it lands. The help opens as a panel beside the sidebar.
function footAbout() {
  const foot = document.getElementById("home-foot");
  const box = document.querySelector(".pdfplus-about");
  if (foot && box && box.parentElement !== foot) foot.insertBefore(box, foot.firstChild);
}
{
  footAbout();
  document.addEventListener("DOMContentLoaded", footAbout);
  const inner = document.querySelector("#dropzone .home-inner");
  if (inner) new MutationObserver(footAbout).observe(inner, { childList: true });
  const help = document.querySelector("#home-foot .home-more");
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && help && help.open) help.open = false; });
  document.addEventListener("click", (e) => { if (help && help.open && !help.contains(e.target)) help.open = false; });
}

// ---- Home: a Claude workflow run for the case --------------------------------
//
// The owner (2026-11-19): "Let's add integration with my Claude extension too.
// I should be able to press a button to open the options tab and have it
// automatically bring the hearing date and files up for me while I select the
// workflow run" … "make sure that I can continue using the options page
// normally too. Also make sure that this new method respects all existing
// safeguards against accidental uploads."
//
// Chrome will not let an extension open a folder by its path, so PDF+, which
// knows where the case folder is (main.js "pdfplus:folder-path", from the
// folders it was given), writes CLAUDE_REQUEST_FILE into Downloads — the
// case, its hearing date, the folder's name and path — and opens claude.ai
// with a bare marker (CLAUDE_MARKER_URL: never the case's name, which
// claude.ai's own page would see). The Claude extension opens its Options on
// Workflows with the case shown; Create run on a workflow brings the folder
// over through the E-Court Suite's native host (which serves only this
// request's folder, read-only) and into the run's editor by the same door,
// and the same checks, as Choose folder… (the extension's
// src/pdfplus-run.js). PDF+ only in the desktop app: a browser has no path.
const CLAUDE_REQUEST_FILE = "Claude Run Request.json";
const CLAUDE_MARKER_URL = "https://claude.ai/#cum-pdfplus-run";
function canAskClaude() {
  return !!(window.pdfplusNative && typeof window.pdfplusNative.folderPath === "function");
}
/**
 * The Claude button: a menu of the Claude extension's workflows (the owner,
 * 2026-11-20: "change the claude run button to a drop down menu that lets me
 * select the workflow to run. That way it can initiate the full thing for me,
 * upload the documents and fill in the date I can just hit the save and start
 * this run button"). The one picked goes in the request (workflowId), and the
 * extension presses its Create run itself: the run is made as a draft, the
 * case folder's papers come in through Choose folder…'s checks and the hearing
 * date is filled; starting it is still the owner's press. "Choose in the
 * Claude extension…" is the old way. The list comes from Claude Run
 * Status.json (claude-runs.js); with none there (an older extension), the
 * button goes straight to the old way.
 */
function claudeButton(hg, r) {
  const b = document.createElement("button");
  b.className = "ci-claude";
  b.title = `Claude: pick a workflow, and a run of it is set up for ${hg.caseName} in the Claude extension, with its hearing date and its case folder's papers; you press Save and start this run there`;
  iconise(b, "message", "Claude run");
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    const wfs = (runsSeen && runsSeen.workflows) || [];
    if (!wfs.length) { askClaude(hg, r); return; }
    if (b.classList.contains("open")) { closeWordMenus(); return; }
    openMenu(b, [
      ...wfs.map((w) => ({ text: w.name, title: `Set up a run of ${w.name} for ${hg.caseName}: its papers and hearing date go in, and you press Save and start this run`, pick: () => askClaude(hg, r, w) })),
      { text: "Choose in the Claude extension…", title: "Open the Claude extension's workflows with this case, and choose there", cls: "ci-word-all", pick: () => askClaude(hg, r) },
    ]);
  });
  b.setAttribute("aria-haspopup", "menu");
  return b;
}
/** A menu under `btn` (the Word menu's look): [{ text, title, cls, pick }]. */
function openMenu(btn, items) {
  closeWordMenus();
  const menu = document.createElement("div");
  menu.className = "ci-word-menu";
  menu.setAttribute("role", "menu");
  for (const it of items) {
    const x = document.createElement("button");
    x.className = "ci-word-item" + (it.cls ? " " + it.cls : "");
    x.setAttribute("role", "menuitem");
    x.textContent = it.text;
    if (it.title) x.title = it.title;
    x.addEventListener("click", (e) => { e.stopPropagation(); closeWordMenus(); it.pick(); });
    menu.appendChild(x);
  }
  document.body.appendChild(menu);
  const at = btn.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(at.left, window.innerWidth - w - 8)) + "px";
  menu.style.top = (at.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, at.top - 4 - h) : at.bottom + 4) + "px";
  btn.classList.add("open");
  setTimeout(() => {
    document.addEventListener("click", closeWordMenus, { once: true });
    window.addEventListener("resize", closeWordMenus, { once: true });
    document.addEventListener("scroll", closeWordMenus, { once: true, capture: true });
  }, 0);
}
async function askClaude(hg, r, wf = null) {
  const native = window.pdfplusNative;
  if (!canAskClaude()) { shellToast("A Claude run is set up from PDF+, the desktop app: a browser cannot say where a folder is.", 6000); return; }
  const dl = await downloadsDir();
  if (!dl) { shellToast("Link Downloads first (the settings menu): the request for the Claude extension is left there.", 6000); return; }
  if (!(await permitted(dl, "readwrite", true))) { shellToast("PDF+ may not write into Downloads, so the Claude run was not set up.", 6000); return; }
  // Where the folder is. A page holds the folder by handle and is never told
  // its path, so Home says everything it knows of it and PDF+'s main process
  // (desktop/folder-place.js) answers only where one place holds the folder
  // with this file of it at its size (the owner, 2026-11-19: "if it already
  // has the ability to open the case folder, doesn't it already have the
  // folder location, or at least have the ability to get that information?"):
  // the path its PDF-Linker launcher records; where it sits under Downloads
  // or a folder of the Folders list (asked of those folders' own handles);
  // where the hearing's place says; and, last, its name searched for.
  const probe = ((r.listing && r.listing.files) || []).find((f) => typeof f.size === "number" && f.size > 0);
  if (!probe) { shellToast(`${r.name} has nothing in it PDF+ can check its place by.`, 6000); return; }
  let hint = "";
  try {
    const run = await import("./viewer/run-request.js");
    const l = await run.folderLauncher(r.handle);
    if (l && l.token) hint = run.folderPathOfToken(l.token);
  } catch { hint = ""; }
  const asks = [];
  for (const h of [dl, ...(await treeRoots())]) {
    try {
      const chain = await h.resolve(r.handle);
      if (Array.isArray(chain) && chain.length) asks.push({ root: h.name, chain });
    } catch { /* not under it */ }
  }
  if (r.root && r.chain && r.chain.length) asks.push({ root: r.root.name, chain: r.chain });
  asks.push({ root: r.name, chain: [] });
  let folderPath = "";
  for (const where of asks) {
    try { folderPath = await native.folderPath({ ...where, launcher: { name: probe.name, size: probe.size }, hint }); } catch { folderPath = ""; }
    if (folderPath) break;
  }
  if (!folderPath) {
    shellToast(`PDF+ could not find where ${r.name} is on this computer: not where its PDF-Linker launcher says, not under Downloads or a folder of the Folders list, and not (just once) by its name. Add the folder holding it to the Folders list, then press Claude again.`, 10000);
    return;
  }
  const iso = (at) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const request = {
    version: 1,
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    at: Date.now(),
    caseNumber: hg.caseNumber || "",
    caseName: hg.caseName || "",
    motion: hg.motion || "",
    hearingDate: hg.date ? iso(hg.date) : "",
    folderName: r.name,
    folderPath,
    ...(wf ? { workflowId: wf.id, workflowName: wf.name } : {}),
  };
  try {
    const w = await (await dl.getFileHandle(CLAUDE_REQUEST_FILE, { create: true })).createWritable();
    await w.write(JSON.stringify(request, null, 1));
    await w.close();
  } catch (e) {
    shellToast(`The request for the Claude extension could not be written into Downloads: ${(e && e.message) || e}.`, 7000);
    return;
  }
  window.open(CLAUDE_MARKER_URL, "_blank", "noopener");
  // No workflow list from the extension (its Claude Run Status.json never
  // reached Downloads, or an older extension): the old way, and why there was
  // no menu (the owner, 2026-11-20: "it is still just taking me to the
  // options page, there is no drop down menu").
  const noList = !wf && !((runsSeen && runsSeen.workflows) || []).length;
  shellToast(wf
    ? `The Claude extension sets up a run of ${wf.name} for ${hg.caseName} in Chrome: its papers come from ${r.name}, and the hearing date is filled in. Look it over and press Save and start this run.`
    : `The Claude extension's Options opens in Chrome with ${hg.caseName}: choose the workflow and press Create run — its papers come from ${r.name}.`
      + (noList ? ` There was no workflow menu because the Claude extension has not written its list into Downloads (${runsSeen ? "its Claude Run Status.json carries none: update the extension and reload it" : "no Claude Run Status.json there"}); the line under Options' Workflows toolbar says why.` : ""), noList ? 14000 : 8000);
}

// ---- Home: the settings menu -------------------------------------------------
//
// The hearings sheet and Downloads are set once and changed rarely, so their
// buttons (#hearings-link, #case-downloads: their own handlers, below) are in
// a menu in Home's bar (the owner's review, 2026-11-18: "setup actions as loud
// as the work"). The menu's button carries a dot while either wants setting
// up or allowing; an empty list offers the same button where it is wanted.
const setupNeeds = new Set();
function setupNeeded(what, on) {
  if (on) setupNeeds.add(what); else setupNeeds.delete(what);
  document.getElementById("home-settings")?.classList.toggle("needs", setupNeeds.size > 0);
}
{
  const gear = document.getElementById("home-settings");
  const menu = document.getElementById("home-settings-menu");
  const shut = () => { if (menu) menu.hidden = true; gear?.setAttribute("aria-expanded", "false"); };
  gear?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    gear.setAttribute("aria-expanded", open ? "true" : "false");
  });
  menu?.addEventListener("click", () => setTimeout(shut, 0));
  document.addEventListener("click", (e) => { if (menu && !menu.hidden && !menu.contains(e.target)) shut(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") shut(); });
}

// ---- Home: hearings ---------------------------------------------------------
//
// The owner (2026-11-18): "I want to change the pdf+ homepage into a central
// hub ... integrate my excel sheet where I list the upcoming hearings under
// these columns Date, Motion Type, Case Name, Date Submitted. I mark them
// green when done and red if they are taken off calendar ... it should
// attempt to match cases by the case number with their row in Excel, and
// should indicate the download status ... That way I can tell at a glance
// what I have downloaded and what I still need." The case names are
// hyperlinked to eCourt, so a hearing's eCourt button opens the sheet's own
// link (desktop/main.js trusts civil.lacourt.org, so PDF+ asks nothing).
//
// THE SHEET IS LINKED ONCE, as Downloads is: one pick, the handle kept in the
// folders database (`places`, "hearings"), read leave only — nothing here
// writes to it. Each look reads its File afresh and parses it again only
// where its size or time moved, so a save in Excel shows on the next look.
// Excel holds a workbook open for writing, but other programs may read it; a
// read that fails keeps the last one and says so.
//
// The rules (columns, marks, dates, the matching) are in
// viewer/hearing-sheet.js, tested by test-hearing-sheet.mjs.
const HEARING_ROWS_MAX = 40;
const DOWNLOADS_INDEX_MS = 60000; // Downloads' own names are read again this often
let hearingLib = null;
let sheetSeen = null;   // { key, hearings, sheets, readAt }
let hearingsAll = false; // "Show off calendar"
// "Show previous" (the owner, 2026-11-20: "Add a button for showing previous
// motions next to the off calendar button"): the hearings of the last
// PAST_DAYS, under the upcoming ones, newest first.
let hearingsPast = false;
const PAST_DAYS = 60;
let hearingsShown = "";
// The summary pill the list is filtered by ("" none): "notdl", "unbriefed", "claude", "downloaded", "done".
let hearingFilter = "";
let downloadsIndexSeen = null; // { at, name, places }

async function sheetHandle() {
  try { const h = await foldersTx("places", "readonly", (s) => s.get("hearings")); return h && h.kind === "file" ? h : null; }
  catch { return null; }
}

/**
 * The hearings sheet as this look reads it: { state, name, hearings, sheets,
 * readAt, error } — state "none" (not linked), "locked" (the leave to read it
 * wants a click), "ok", or "error" (unread, `hearings` the last read's).
 */
async function loadSheet() {
  if (!hearingLib) hearingLib = await import("./viewer/hearing-sheet.js");
  const h = await sheetHandle();
  if (!h) return { state: "none", name: "", hearings: [], sheets: [] };
  if (!(await permitted(h, "read", false))) return { state: "locked", name: h.name, hearings: [], sheets: [] };
  // Off / On calendar changes not yet in the file: written now where PDF+ may
  // write (asked on the click that made them; a look asks nothing).
  const edits = await editsAll();
  if (edits.length && (await permitted(h, "readwrite", false))) await writeEdits(h);
  try {
    const file = await h.getFile();
    const key = `${h.name}|${file.size}|${file.lastModified}`;
    if (!sheetSeen || sheetSeen.key !== key) {
      const { hearings, sheets } = await hearingLib.readHearings(file);
      sheetSeen = { key, hearings, sheets, readAt: file.lastModified };
    }
    return { state: "ok", name: h.name, ...sheetSeen, hearings: withEdits(sheetSeen.hearings) };
  } catch (e) {
    const last = sheetSeen || { hearings: [], sheets: [] };
    return { state: "error", name: h.name, ...last, hearings: withEdits(last.hearings), error: (e && e.message) || String(e) };
  }
}

// ---- Off calendar / On calendar, written into the sheet ----------------------
//
// The owner (2026-11-18): "Add off calendar and on calendar toggles. These
// would change the color of the excel sheet accordingly." A toggle is kept as
// an EDIT (in the folders database, `places` → "hearingEdits", so a restart
// keeps it) and written at once where it can be: the file is read as it
// stands and only its styles and the one sheet are rewritten
// (hearing-sheet.js, markHearing). Excel holds a workbook it has open against
// writing, so while it does the write fails, the edit waits, the list shows
// it as made ("waiting"), and every look tries again: it lands once Excel
// closes the workbook, over whatever Excel saved. A row the sheet no longer
// has is dropped with a word.
let hearingEdits = null;   // [{ sheet, row, caseName, date, mark }]
let editsError = "";       // why the last write failed, "" when none waits
let editsBusy = false;
const sameHearing = (a, b) => a.sheet === b.sheet && a.row === b.row && a.caseName === b.caseName;
const isNoteEdit = (e) => typeof e.note === "string";
async function editsAll() {
  if (!hearingEdits) {
    try { hearingEdits = (await foldersTx("places", "readonly", (st) => st.get("hearingEdits"))) || []; }
    catch { hearingEdits = []; }
  }
  return hearingEdits;
}
async function editsSave() {
  try { await foldersTx("places", "readwrite", (st) => st.put(hearingEdits, "hearingEdits")); } catch { /* kept for this session only */ }
}
/** The hearings as Home shows them: each one an edit waits on marked as the edit says. */
function withEdits(hearings) {
  const edits = hearingEdits || [];
  if (!edits.length) return hearings;
  return hearings.map((hg) => {
    let out = hg;
    for (const e of edits) {
      if (!sameHearing(e, hg)) continue;
      out = isNoteEdit(e) ? { ...out, note: e.note, noteWaiting: true } : { ...out, mark: e.mark, waiting: true };
    }
    return out;
  });
}
async function writeEdits(h) {
  if (editsBusy) return;
  editsBusy = true;
  try {
    const edits = await editsAll();
    while (edits.length) {
      const e = edits[0];
      let out;
      try { out = isNoteEdit(e) ? await hearingLib.setHearingNote(await h.getFile(), e, e.note) : await hearingLib.markHearing(await h.getFile(), e, e.mark); }
      catch (x) {
        if (x && x.name === "NotReadableError") { editsError = x.message || String(x); return; }
        edits.shift();
        await editsSave();
        shellToast(`${e.caseName}${isNoteEdit(e) ? "'s note was not written" : " was not marked"} in ${h.name}: ${(x && x.message) || x}.`, 8000);
        continue;
      }
      let w = null;
      try {
        w = await h.createWritable();
        await w.write(out);
        await w.close();
      } catch (x) {
        try { if (w) await w.abort(); } catch { /* already gone */ }
        editsError = (x && x.message) || String(x);
        return;
      }
      edits.shift();
      await editsSave();
      editsError = "";
      sheetSeen = null;
    }
  } finally { editsBusy = false; }
}
async function setHearingMark(hg, mark, what = mark === "off" ? "off calendar" : mark === "done" ? "done" : "on calendar") {
  const h = await sheetHandle();
  if (!h) return;
  // Asked first, while the click still counts as one (PDF+ grants it).
  if (!(await permitted(h, "readwrite", true))) { shellToast(`PDF+ may not write into ${h.name}, so it was not changed.`, 6000); return; }
  const edits = await editsAll();
  const i = edits.findIndex((e) => sameHearing(e, hg) && !isNoteEdit(e));
  if (i >= 0) edits.splice(i, 1);
  edits.push({ sheet: hg.sheet, row: hg.row, caseName: hg.caseName, date: hg.date, mark });
  await editsSave();
  await writeEdits(h);
  shellToast(edits.length
    ? `${hg.caseName} is marked ${what} here. ${h.name} looks open in Excel, so it is written as soon as Excel closes it.`
    : `${hg.caseName} marked ${what} in ${h.name}.`, 6000);
  hearingsShown = "";
  renderCaseFolders();
}
/**
 * A note on a hearing (the owner, 2026-11-19: a sticky note on every row,
 * "by clicking it, I can add a note ... When there is a note, it is colored in
 * and I can view and edit the note by clicking on it"): kept as an edit and
 * written into the row's Date cell as Off calendar is (hearing-sheet.js,
 * setHearingNote), waiting while Excel holds the workbook.
 */
async function setHearingNoteText(hg, note) {
  const h = await sheetHandle();
  if (!h) return;
  if (!(await permitted(h, "readwrite", true))) { shellToast(`PDF+ may not write into ${h.name}, so the note was not saved.`, 6000); return; }
  const edits = await editsAll();
  const i = edits.findIndex((e) => sameHearing(e, hg) && isNoteEdit(e));
  if (i >= 0) edits.splice(i, 1);
  edits.push({ sheet: hg.sheet, row: hg.row, caseName: hg.caseName, date: hg.date, note });
  await editsSave();
  await writeEdits(h);
  shellToast(edits.length
    ? `The note on ${hg.caseName} is kept here. ${h.name} looks open in Excel, so it is written as soon as Excel closes it.`
    : note ? `Note on ${hg.caseName} saved in ${h.name}.` : `Note on ${hg.caseName} taken out of ${h.name}.`, 5000);
  hearingsShown = "";
  renderCaseFolders();
}

// ---- Home: the calendar (the hearings sheet kept up to date) ----------------
//
// The owner (2026-11-19): automate copying eCourt's agenda into the hearings
// sheet, "in a way that can update automatically if a new case is moved or
// taken off calendar (but notifies me, it should never do that silently)",
// ten court days forward. E-Court Suite's hourly refresh puts the calendar in
// the briefing file (readBriefing); each look plans against the sheet as it
// stands (calendar-sync.js, planCalendar) and, where PDF+ may write the
// workbook without asking, writes it at once: new hearings added as Copy All
// would paste them, the ones the Hearings tab says are vacated or continued
// marked off calendar. Every change goes into calendarLog (the folders
// database, `places`), which is the list at the top of Hearings with its Undo
// and keeps a change from being made twice. A hearing gone from its day's
// agenda with no word why changes nothing: it is listed for the owner. Excel
// holding the workbook leaves the plan for the next look, as a mark waits.
let calLib = null;
let calLog = null;   // [{ id, key, kind: added|off|held|kept, at, day, caseText, motion, reason, status, newDay, sheet, row, caseName, date, undone, cleared }]
const calState = { waiting: 0, why: "", refused: [], at: 0 };
let calBusy = false;
const CAL_LOG_DAYS = 21;
const CAL_SHOWN_MS = 2 * 86400000;
async function calLogAll() {
  if (!calLog) {
    try { calLog = (await foldersTx("places", "readonly", (st) => st.get("calendarLog"))) || []; } catch { calLog = []; }
  }
  return calLog;
}
async function calLogSave() {
  const cut = Date.now() - CAL_LOG_DAYS * 86400000;
  calLog = (calLog || []).filter((e) => e.at >= cut || (calLib && calLib.dayAt(e.day) >= cut));
  try { await foldersTx("places", "readwrite", (st) => st.put(calLog, "calendarLog")); } catch { /* kept for this session only */ }
}
function calNotify(title, lines) {
  if (!lines.length) return;
  shellToast(`${title}: ${lines[0]}${lines.length > 1 ? ` and ${lines.length - 1} more (listed under Hearings)` : ""}.`, 9000);
  try {
    if (!("Notification" in window)) return;
    const body = lines.slice(0, 5).join("\n") + (lines.length > 5 ? `\n…and ${lines.length - 5} more` : "");
    if (Notification.permission === "granted") new Notification(title, { body, tag: "pdfplus-calendar-" + Date.now() });
    else if (Notification.permission === "default") Notification.requestPermission().then((p) => { if (p === "granted") new Notification(title, { body }); }).catch(() => {});
  } catch { /* the toast said it */ }
}
async function bytesOf(file) { return new Uint8Array(await file.arrayBuffer()); }
async function writeSheetBytes(h, bytes) {
  let w = null;
  try {
    w = await h.createWritable();
    await w.write(bytes);
    await w.close();
    return "";
  } catch (x) {
    try { if (w) await w.abort(); } catch { /* already gone */ }
    return (x && x.message) || String(x);
  }
}
/**
 * The hearings on the sheet, for E-Court Suite (the owner, 2026-11-20: "Let's
 * also add detection for when the hearing date has moved"): written to
 * Downloads as SHEET_HEARINGS_FILE where the list changed; its hourly refresh
 * checks each on its case's Hearings tab and says, in the briefing file's
 * calendar, which moved (and to when) or went off calendar, however far out.
 */
let sheetHearingsSaid = null;
async function writeSheetHearings(dl, hearings, now) {
  if (!calLib) calLib = await import("./viewer/calendar-sync.js");
  const list = calLib.sheetHearingsList(hearings, now);
  const body = JSON.stringify(list);
  if (sheetHearingsSaid === body) return;
  if (!(await permitted(dl, "readwrite", false))) return;
  if (sheetHearingsSaid === null) {
    // First look this session: the file as it stands may already say it.
    try {
      const was = JSON.parse(await (await (await dl.getFileHandle(calLib.SHEET_HEARINGS_FILE)).getFile()).text());
      if (was && JSON.stringify(was.hearings) === body) { sheetHearingsSaid = body; return; }
    } catch { /* none yet */ }
  }
  const w = await (await dl.getFileHandle(calLib.SHEET_HEARINGS_FILE, { create: true })).createWritable();
  await w.write(JSON.stringify({ version: 1, written: now, hearings: list }, null, 1));
  await w.close();
  sheetHearingsSaid = body;
}

/**
 * What the calendar log says of a hearing's row: a move it was marked off for
 * ({ to }) or written under ({ from }), else null.
 */
function movedOf(hg) {
  if (!calLib || !calLog || !hg || !hg.date) return null;
  const key = calLib.changeKey(calLib.isoOf(hg.date), hg);
  for (let i = calLog.length - 1; i >= 0; i--) {
    const e = calLog[i];
    if (!e || e.key !== key || e.undone) continue;
    if (e.kind === "off" && e.reason === "moved" && hg.mark === "off") return { to: e.newDay || "", status: e.status || "" };
    if (e.kind === "added" && e.movedFrom) return { from: e.movedFrom };
  }
  return null;
}

/** Bring the sheet up to the calendar: whether it changed the sheet. */
async function syncCalendar(sheet, briefing, now) {
  if (calBusy || !briefing || briefing.none || !briefing.calendar || sheet.state !== "ok" || !sheetSeen) return false;
  if ((hearingEdits || []).length) return false; // the owner's own changes go first (Excel is likely open)
  const h = await sheetHandle();
  if (!h) return false;
  if (!calLib) calLib = await import("./viewer/calendar-sync.js");
  const log = await calLogAll();
  const plan = calLib.planCalendar({ hearings: sheetSeen.hearings, calendar: briefing.calendar, log, now });
  calState.at = briefing.calendar.at || 0;
  // Gone with no word why: listed (once), never changed.
  const held = plan.held.filter((x) => !x.seen);
  for (const x of held) log.push({ id: `${x.key}|held|${now}`, key: x.key, kind: "held", at: now, day: x.day, caseText: x.hg.caseName, motion: x.hg.motion, reason: x.reason, status: x.status, newDay: x.newDay, sheet: x.hg.sheet, row: x.hg.row, caseName: x.hg.caseName, date: x.hg.date });
  if (held.length) { await calLogSave(); calNotify("Check the hearings sheet", held.map((x) => calLib.changeText({ ...x, kind: "held" }).text)); }
  const n = plan.adds.length + plan.offs.length;
  if (!n) { calState.waiting = 0; calState.why = ""; calState.refused = []; return false; }
  if (!(await permitted(h, "readwrite", false))) { calState.waiting = n; calState.why = "leave"; return false; }
  calBusy = true;
  try {
    let bytes;
    try { bytes = await bytesOf(await h.getFile()); }
    catch (x) { calState.waiting = n; calState.why = (x && x.message) || String(x); return false; }
    const res = await calLib.addCalendarRows(bytes, plan.adds, now);
    bytes = res.bytes;
    calState.refused = res.refused.map((r) => ({ ...r, add: plan.adds.find((a) => a.key === r.key) }));
    const offs = [];
    for (const o of plan.offs) {
      try { bytes = await hearingLib.markHearing(bytes, o.hg, "off"); offs.push(o); } catch { /* the row is gone: nothing to mark */ }
    }
    if (!res.placed.length && !offs.length) { calState.waiting = 0; return false; }
    const err = await writeSheetBytes(h, bytes);
    if (err) { calState.waiting = n; calState.why = err; return false; }
    calState.waiting = 0; calState.why = "";
    const lines = [];
    for (const p of res.placed) {
      const a = plan.adds.find((x) => x.key === p.key);
      const e = { id: `${p.key}|added|${now}`, key: p.key, kind: "added", at: now, day: a.day, caseText: a.caseText, motion: a.motion, movedFrom: a.movedFrom || "", sheet: p.sheet, row: p.row, caseName: p.caseName, date: p.date };
      log.push(e);
      lines.push(calLib.changeText(e).text);
    }
    for (const o of offs) {
      const e = { id: `${o.key}|off|${now}`, key: o.key, kind: "off", at: now, day: o.day, caseText: o.hg.caseName, motion: o.hg.motion, reason: o.reason, status: o.status, newDay: o.newDay, sheet: o.hg.sheet, row: o.hg.row, caseName: o.hg.caseName, date: o.hg.date };
      log.push(e);
      lines.push(calLib.changeText(e).text);
    }
    await calLogSave();
    sheetSeen = null;
    hearingsShown = "";
    calNotify(`Hearings sheet updated (${lines.length})`, lines);
    return true;
  } finally { calBusy = false; }
}
/** Undo one change: the added row taken out, the red taken off. */
async function undoCalendar(e) {
  const h = await sheetHandle();
  if (!h || !calLib) return;
  if (!(await permitted(h, "readwrite", true))) { shellToast(`PDF+ may not write into ${h.name}.`, 5000); return; }
  let bytes;
  try {
    const now = await bytesOf(await h.getFile());
    bytes = e.kind === "added"
      ? await calLib.removeCalendarRow(now, { sheet: e.sheet, row: e.row, caseName: e.caseName, date: e.date })
      : await hearingLib.markHearing(now, { sheet: e.sheet, row: e.row, caseName: e.caseName, date: e.date }, "");
  } catch (x) { shellToast(`Not undone: ${(x && x.message) || x}.`, 7000); return; }
  const err = await writeSheetBytes(h, bytes);
  if (err) { shellToast(`Not undone: ${h.name} looks open in Excel. Close it and press Undo again.`, 7000); return; }
  e.undone = true;
  await calLogSave();
  sheetSeen = null; hearingsShown = "";
  shellToast(e.kind === "added" ? `${e.caseText} taken back out of ${h.name}; it will not be added again.` : `${e.caseText} is on calendar again in ${h.name}.`, 6000);
  renderCaseFolders();
}
// ---- Home: Claude runs ---------------------------------------------------------
//
// The owner (2026-11-19): "I'd like to have the dashboard display include the
// current status of any claude run going." The Claude extension keeps
// CLAUDE_RUNS_FILE in Downloads through the E-Court Suite's native host
// (viewer/claude-runs.js); Home reads it each look, again only where it moved,
// puts each case's newest run in its row's Claude column (runCell), and counts
// the runs going in the summary.
let runsLib = null;
let runsSeen = null; // { key, written, runs }
async function readClaudeRuns(dl) {
  if (!runsLib) runsLib = await import("./viewer/claude-runs.js");
  let fh;
  try { fh = await dl.getFileHandle(runsLib.CLAUDE_RUNS_FILE); } catch { return null; }
  try {
    const f = await fh.getFile();
    const key = `${f.size}|${f.lastModified}`;
    if (!runsSeen || runsSeen.key !== key) runsSeen = { key, ...runsLib.parseClaudeRuns(await f.text()) };
    return runsSeen;
  } catch { return runsSeen; }
}
/**
 * A hearing row's Claude column (the owner: "a simplified version of the
 * options page runs history (for the most recent run of that case) like what
 * time it finished or what step it was on. Similar to the E-court motion
 * opposition reply display"): the case's newest run as a bar of its steps
 * (done, the one running, failed, to come) and a line — "Step 3 of 7",
 * "Finished 3:10 PM", "Held: usage limit". Hover lists every step as the
 * extension's runs list does; a click opens the chat it last worked in.
 */
function runCell(hg, placeName, runs, now) {
  const cell = document.createElement("span");
  cell.className = "ci-run";
  if (!runs || !runsLib) return cell;
  const mine = runsLib.runsForHearing(hg, runs.runs, placeName, now);
  if (!mine.length) return cell;
  const r = mine[0];
  const { tone, line } = runsLib.runLine(r, runs.written, now);
  cell.classList.add("has", "tone-" + tone);
  // Steps done out of the run's steps, as a fraction (the owner, 2026-11-20:
  // "replace the lights with the number out of blank like a fraction").
  // The workflow's name over it (the owner: "Also the name of the run … of
  // the workflow").
  if (r.template) {
    const name = document.createElement("span");
    name.className = "cr-name";
    name.textContent = r.template;
    cell.appendChild(name);
  }
  const row = document.createElement("span");
  row.className = "cr-row";
  const frac = runsLib.stepFraction(r);
  if (frac) {
    const f = document.createElement("span");
    f.className = "cr-frac";
    f.textContent = `${frac.done}/${frac.total}`;
    f.setAttribute("aria-label", `${frac.done} of ${frac.total} steps done`);
    row.appendChild(f);
  }
  const txt = document.createElement("span");
  txt.className = "cr-line";
  txt.textContent = line;
  row.appendChild(txt);
  cell.appendChild(row);
  cell.title = [`Claude run: ${r.name}${r.template ? " (" + r.template + ")" : ""}`, ...runsLib.stepLines(r),
    r.error ? `Failed: ${r.error}` : "", r.at ? `Last moved ${runsLib.clockText(r.at, now)}.` : "",
    r.url ? "Click to open its chat." : "", mine.length > 1 ? `${mine.length - 1} earlier run${mine.length > 2 ? "s" : ""} for this case.` : ""].filter(Boolean).join("\n");
  cell.setAttribute("aria-label", `Claude run${r.template ? " of " + r.template : ""}: ${frac ? frac.done + " of " + frac.total + " steps done, " : ""}${line}`);
  if (r.url) {
    cell.setAttribute("role", "button");
    cell.classList.add("link");
    cell.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); window.open(r.url, "_blank", "noopener"); });
  }
  return cell;
}

/** The list of changes at the top of Hearings. */
function renderCalendarChanges(box, sheet, briefing, now) {
  box.textContent = "";
  const log = (calLog || []).filter((e) => !e.cleared && !e.resolved && (e.kind === "held" ? !e.undone : now - e.at < CAL_SHOWN_MS));
  const cal = briefing && !briefing.none ? briefing.calendar : null;
  const issues = [];
  if (calState.waiting && calState.why === "leave") issues.push({ text: `${calState.waiting} calendar change${calState.waiting === 1 ? "" : "s"} for ${sheet.name} waiting for your leave to write it.`, action: "Allow" });
  else if (calState.waiting) issues.push({ text: `${calState.waiting} calendar change${calState.waiting === 1 ? "" : "s"} waiting: ${sheet.name} looks open in Excel. They are written once it is closed.`, title: calState.why });
  for (const r of calState.refused) issues.push({ text: `Not added: ${r.add ? r.add.caseText : r.key} — ${r.why}. Paste it by hand.`, warn: true });
  box.hidden = !log.length && !issues.length;
  if (box.hidden) return;
  const head = document.createElement("div");
  head.className = "cal-head";
  const title = document.createElement("span");
  title.className = "cal-title";
  title.innerHTML = `${icon("calendar", { size: 15 })}<span>Calendar changes</span>`;
  head.appendChild(title);
  if (cal && cal.at) {
    const when = document.createElement("span");
    when.className = "cal-when";
    when.textContent = `from eCourt, ${caseLib.whenText(cal.at, now)}`;
    when.title = `E-Court Suite read the next ${cal.windowDays || 10} court days' agendas ${new Date(cal.at).toLocaleString()}; days it could not read change nothing.`;
    head.appendChild(when);
  }
  if (log.length) {
    const clear = document.createElement("button");
    clear.className = "link-btn cal-clear";
    clear.textContent = "Clear";
    clear.title = "Take these off the list (the sheet is not changed; a hearing to check stays until you decide)";
    clear.addEventListener("click", async () => { for (const e of log) if (e.kind !== "held") e.cleared = true; await calLogSave(); hearingsShown = ""; renderCaseFolders(); });
    head.appendChild(clear);
  }
  box.appendChild(head);
  for (const is of issues) {
    const p = document.createElement("div");
    p.className = "cal-item cal-issue" + (is.warn ? " warn" : "");
    p.textContent = is.text;
    if (is.title) p.title = is.title;
    if (is.action) {
      const b = document.createElement("button");
      b.className = "link-btn";
      b.textContent = is.action;
      b.addEventListener("click", async () => { const h = await sheetHandle(); if (h && (await permitted(h, "readwrite", true))) { calState.why = ""; renderCaseFolders(); } });
      p.appendChild(b);
    }
    box.appendChild(p);
  }
  for (const e of [...log].sort((a, b) => (a.kind === "held") - (b.kind === "held") || b.at - a.at).slice(0, 12)) {
    const p = document.createElement("div");
    p.className = `cal-item k-${e.kind}${e.undone ? " undone" : ""}`;
    const said = calLib.changeText(e);
    const txt = document.createElement("span");
    txt.className = "cal-text";
    txt.textContent = said.text + (e.undone ? " — undone" : "");
    p.title = said.title;
    p.appendChild(txt);
    const btn = (label, title, fn) => { const b = document.createElement("button"); b.className = "link-btn"; b.textContent = label; b.title = title; b.addEventListener("click", fn); p.appendChild(b); };
    if ((e.kind === "added" || e.kind === "off") && !e.undone) btn("Undo", e.kind === "added" ? "Take this row back out of the sheet; it will not be added again" : "Take the red off: on calendar again", () => undoCalendar(e));
    if (e.kind === "held") {
      const hg = sheet.hearings.find((x) => x.sheet === e.sheet && x.caseName === e.caseName && x.date === e.date);
      if (hg && !hg.mark) btn("Off calendar", "Mark it red in the sheet", async () => { e.resolved = true; log.push({ id: `${e.key}|off|${Date.now()}`, key: e.key, kind: "off", at: Date.now(), day: e.day, caseText: e.caseText, manual: true, cleared: true }); await calLogSave(); setHearingMark(hg, "off"); });
      btn("Keep", "It stays as it is; this is not asked again", async () => { e.resolved = true; calLog.push({ id: `${e.key}|kept|${Date.now()}`, key: e.key, kind: "kept", at: Date.now(), day: e.day, cleared: true }); await calLogSave(); hearingsShown = ""; renderCaseFolders(); });
    }
    box.appendChild(p);
  }
}

/** Done (the owner: "a button for me to indicate that I am done"): its Motion Type and Case Name cells green in the sheet; pressed again, Not done. */
function doneButton(hg) {
  const b = document.createElement("button");
  b.className = "ci-done";
  const done = hg.mark === "done";
  b.classList.toggle("on", done);
  b.setAttribute("aria-pressed", done ? "true" : "false");
  b.title = done ? `Not done: take the green off ${hg.caseName}'s Motion Type and Case Name cells in the sheet` : `Done: fill ${hg.caseName}'s Motion Type and Case Name cells green in the sheet`;
  iconise(b, "check", done ? "Not done" : "Done");
  b.addEventListener("click", (e) => { e.stopPropagation(); setHearingMark(hg, done ? "" : "done", done ? "not done" : "done"); });
  return b;
}
function calendarButton(hg) {
  const b = document.createElement("button");
  b.className = "ci-cal";
  const off = hg.mark !== "off";
  b.title = off ? `Off calendar: fill ${hg.caseName}'s Motion Type and Case Name cells red in the sheet` : `On calendar: take the red off ${hg.caseName}'s row in the sheet`;
  iconise(b, off ? "calendar-x" : "calendar-check", off ? "Off calendar" : "On calendar");
  b.addEventListener("click", (e) => { e.stopPropagation(); setHearingMark(hg, off ? "off" : ""); });
  return b;
}

// Notes typed in a case's Date cell (hearing-sheet.js, dateNote): a sticky
// note before the case name, opened and closed with a click; which are open
// is kept across redraws.
const notesOpen = new Set();
let noteEditing = ""; // the note being written: the list is not redrawn under it
const noteKey = (hg) => `${hg.sheet}|${hg.row}|${hg.caseName}`;

// The case selected on the Hearings list (its buttons open under it), by
// noteKey; kept across redraws, cleared by Escape or a second click.
let selectedHearing = "";
function selectHearing(row, key, on) {
  const list = document.getElementById("hearing-list");
  for (const r of list ? list.querySelectorAll(".hearing-row.selected") : []) {
    if (r === row && on) continue;
    r.classList.remove("selected");
    r.querySelector(".hearing-tools")?.remove();
    r.querySelector(".hearing-item")?.setAttribute("aria-expanded", "false");
  }
  selectedHearing = on ? key : "";
  if (on && row && !row.classList.contains("selected")) {
    row.classList.add("selected");
    if (row.__tools) row.appendChild(row.__tools());
    row.querySelector(".hearing-item")?.setAttribute("aria-expanded", "true");
  }
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !selectedHearing) return;
  if (e.target && /^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName)) return;
  if (document.querySelector(".hearing-row.selected")) selectHearing(null, "", false);
});
/** A row button as the selected case's bar shows it: its icon, then its name in words. */
function labelTools(el) {
  for (const b of el.matches(".ci-ico") ? [el] : el.querySelectorAll(".ci-ico")) {
    if (b.querySelector(".tl-label")) continue;
    const t = document.createElement("span");
    t.className = "tl-label";
    t.textContent = b.getAttribute("aria-label") || b.title || "";
    b.appendChild(t);
  }
  return el;
}

/** The case numbers the files in a listing carry ("Register of Actions 25STCV12345.pdf"). */
function listingNumbers(listing) {
  const out = new Set();
  for (const f of (listing && listing.files) || []) for (const n of hearingLib.caseNumbersIn(f.name)) out.add(n);
  return [...out];
}
/** A case folder's row as the matching takes it (hearing-sheet.js, placeMatches). */
function placeOfRow(r) {
  return { name: r.name, kind: r.today ? "folder" : "opened", numbers: listingNumbers(r.listing), row: r };
}

/**
 * Downloads' own entries as places a hearing's case may stand: its folders,
 * its zips and the loose files whose names carry a case number, but no Order
 * Template Input sheet more than two days old. Names only (no file is opened
 * but those sheets, for their time), read again every DOWNLOADS_INDEX_MS.
 */
async function downloadsIndex(dl) {
  const now = Date.now();
  if (downloadsIndexSeen && downloadsIndexSeen.name === dl.name && now - downloadsIndexSeen.at < DOWNLOADS_INDEX_MS) return downloadsIndexSeen.places;
  const places = [];
  for await (const [name, entry] of dl.entries()) {
    if (entry.kind === "directory") places.push({ name, kind: "folder", handle: entry, parent: dl, root: dl, chain: [name] });
    else if (/\.zip$/i.test(name)) places.push({ name, kind: "zip" });
    else if (hearingLib.caseNumbersIn(name).length) {
      // An Order Template Input sheet left from an earlier motion in the case
      // is no sign of this hearing's papers (looseFileCounts): only its time
      // is read, and only for it.
      let at = 0;
      if (hearingLib.ORDER_TEMPLATE_RE.test(name)) { try { at = (await entry.getFile()).lastModified; } catch { at = 0; } }
      if (hearingLib.looseFileCounts(name, at, now)) places.push({ name, kind: "file" });
    }
  }
  downloadsIndexSeen = { at: now, name: dl.name, places };
  return places;
}

/** "Hearing Fri, Nov 20 · Demurrer", as a case folder's row says it. */
function hearingWhen(hg, now) {
  const when = hg.date ? hearingLib.dayText(hg.date, now) : hg.dateText;
  const mark = hg.mark === "done" ? " (done)" : hg.mark === "off" ? " (off calendar)" : "";
  return `Hearing ${when}${hg.motion ? " · " + hg.motion : ""}${mark}`;
}

function ecourtButton(hg) {
  const b = document.createElement("button");
  b.className = "ci-ecourt";
  b.title = `eCourt: open ${hg.caseNumber || hg.caseName} (${hearingLib.isWebLink(hg.url) ? "the hearings sheet's link" : hg.ecourtFrom === "sheet" ? "the link on another row of this case in the hearings sheet" : "the link E-Court Suite read from eCourt's calendar; this row of the hearings sheet has none"})`;
  iconise(b, "external", "eCourt");
  b.addEventListener("click", (e) => { e.stopPropagation(); openEcourt(hg); });
  return b;
}
function openEcourt(hg) {
  const url = hearingLib.ecourtUrlOf(hg);
  if (!url) return;
  window.open(url, "_blank", "noopener");
}

/**
 * The hearings on the list, each with where its case stands:
 * { items: [{ hg, place, r, controls }], all, open, downloaded, matched }.
 * `r` is the case folder's row (one of `rows`; a Downloads folder the Case
 * folders list did not hold is added to `rows` here), `controls` true on the
 * first hearing of each folder only, which carries its buttons. `matched` is
 * the set of rows on a hearing's row.
 */
/** Whether a folder is inside Downloads (any depth). */
async function isInDownloads(dl, h) {
  if (!dl || !h || typeof dl.resolve !== "function") return false;
  try { const p = await dl.resolve(h); return Array.isArray(p) && p.length > 0; } catch { return false; }
}
async function hearingItems(rows, sheet, dl, dlState, now) {
  const empty = { items: [], all: [], open: [], shownAll: [], downloaded: 0, pastCount: 0, matched: new Set() };
  if (!sheet.hearings.length) return empty;
  // Where each case may stand: the folders listed (opened here, today's in
  // Downloads), then everything else in Downloads, by name.
  const places = rows.map(placeOfRow);
  if (dlState === "ok") {
    let idx = [];
    try { idx = await downloadsIndex(dl); } catch { idx = []; }
    for (const p of idx) if (!(p.kind === "folder" && rows.some((r) => r.name === p.name))) places.push({ ...p });
  }
  // The folders on the Folders list, where a case moved from Home stands: it
  // stays on its hearing's row until the hearing has passed.
  for (const p of await treeIndex()) {
    let dup = false;
    for (const r of rows) if (r.name === p.name) { try { if (await r.handle.isSameEntry(p.handle)) { dup = true; break; } } catch { /* gone */ } }
    if (!dup && !places.some((x) => x.kind === "folder" && x.handle && x.name === p.name && x.root === p.root && x.chain.join("/") === p.chain.join("/"))) places.push({ ...p });
  }
  const all = hearingLib.upcoming(sheet.hearings, now, { all: true });
  const open = all.filter((h) => !h.mark);
  // A hearing marked done stays listed, with its ✓, until it has passed (the
  // owner: "There should be a checkmark next to it on the home screen
  // indicating it is done"); one off calendar only with Show off calendar.
  const shownAll = hearingsAll ? all : all.filter((h) => h.mark !== "off");
  // The hearings already past, newest first, for Show previous.
  const today0 = new Date(now).setHours(0, 0, 0, 0);
  const pastAll = sheet.hearings.filter((h) => h.date && h.date < today0 && h.date >= today0 - PAST_DAYS * 86400000)
    .sort((a, b) => b.date - a.date || a.row - b.row);
  const pastShown = hearingsAll ? pastAll : pastAll.filter((h) => h.mark !== "off");
  const list = shownAll.slice(0, HEARING_ROWS_MAX).concat(hearingsPast ? pastShown.slice(0, HEARING_ROWS_MAX) : []);
  const items = [];
  const owner = new Map();
  const links = await hearingLinks();
  for (const hg of list) {
    // A folder the operator pointed this hearing at (locateCase) is its own,
    // whatever its name; one gone or unreadable is no place.
    let place = null;
    const link = links.find((l) => l.key === linkKey(hg));
    if (link) {
      for (const p of places) {
        const h = p.handle || (p.row && p.row.handle);
        if (!h || p.name !== link.handle.name) continue;
        try { if (await h.isSameEntry(link.handle)) { place = p; break; } } catch { /* gone */ }
      }
      if (!place && (await permitted(link.handle, "read", false)) && (await cachedListing(link.handle, now))) {
        place = { name: link.handle.name, kind: "folder", handle: link.handle, parent: null, root: null, chain: [link.handle.name], linked: true };
        places.push(place);
      }
    }
    if (!place) place = hearingLib.findPlace(hg, places);
    let r = place ? place.row || null : null;
    if (!r && place && place.kind === "folder" && place.handle) {
      const listing = await cachedListing(place.handle, now);
      if (listing) {
        r = { name: place.name, handle: place.handle, listing, opened: 0, today: false, parent: place.parent || null, root: place.root || null, chain: place.chain || [place.name], inTree: !!place.inTree };
        rows.push(r);
        place.row = r;
      }
    }
    const fh = r ? r.handle : place && (place.kind === "folder" || place.kind === "opened") ? place.handle || (place.row && place.row.handle) : null;
    const item = { hg, place, r, controls: false, inDl: dlState === "ok" && fh ? await isInDownloads(dl, fh) : false };
    if (r && !owner.has(r)) { owner.set(r, item); item.controls = true; }
    items.push(item);
  }
  const downloaded = open.filter((h) => {
    const it = items.find((x) => x.hg === h);
    const p = it ? it.place : hearingLib.findPlace(h, places);
    return p && (p.kind === "folder" || p.kind === "opened");
  }).length;
  return { items, all, open, shownAll, downloaded, pastCount: pastShown.length, matched: new Set(owner.keys()) };
}

// The folder's status and the Claude run take the room their widest row
// needs, no more (the owner, 2026-11-24: the case name had been cut to
// "Doe…" beside columns half empty); each still one column down the list.
// Measured while the list is on screen; hidden, the CSS defaults stand.
function fitColumns(listEl) {
  // Not on screen: drawn again (and measured) on the next look.
  if (!listEl.isConnected || !listEl.getClientRects().length) { hearingsShown = ""; return; }
  listEl.classList.add("measuring");
  const widest = (sel) => Math.max(0, ...[...listEl.querySelectorAll(sel)].map((e) => Math.ceil(e.getBoundingClientRect().width)));
  const st = widest(".ci-status-col"), run = widest(".ci-run.has");
  listEl.classList.remove("measuring");
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  if (st) listEl.style.setProperty("--status-w", clamp(st + 6, 110, 290) + "px");
  if (run) listEl.style.setProperty("--run-w", clamp(run + 2, 96, 210) + "px");
}

const LOCKED_STATUS = { text: "Click to allow", title: "The browser wants your leave to read this folder again.", tone: "idle" };

async function renderHearings(sheet, hv, dlState, now, line) {
  const section = document.getElementById("hearings");
  const listEl = document.getElementById("hearing-list");
  const sumEl = document.getElementById("hearings-summary");
  if (!section || !listEl) return;
  section.hidden = false;
  const { items, all, open, shownAll, downloaded } = hv;
  briefRows = (all || []).filter((h) => h.mark !== "off");
  const folderSt = (r) => (r.locked ? LOCKED_STATUS : caseLib.statusText(r.status, now));
  // Not redrawn under a note being written; it is once the note is closed.
  if (noteEditing && listEl.contains(document.activeElement)) return;
  const sig = [sheet.state, sheet.name, sheet.error ? 1 : 0, sheet.readAt, hearingsAll, hearingsPast, hv.pastCount, dlState, downloaded, all.length, open.length,
    (calLog || []).map((e) => e.id + (e.undone ? "u" : "") + (e.cleared ? "c" : "") + (e.resolved ? "r" : "")).join(","), calState.waiting, calState.why, calState.refused.length,
    hv.runs ? hv.runs.key : "", Math.floor(now / 120000),
    (hearingEdits || []).length, editsError ? 1 : 0, hv.briefing ? hv.briefing.key || (hv.briefing.none ? "none" : "") : "",
    Math.floor(now / 600000), canAskClaude() ? "claude" : "", hearingFilter,
    ...items.map(({ hg, place, r, controls, inDl }) => [hg.sheet, hg.row, hg.date, hg.caseName, hg.motion, hg.mark, hg.waiting ? 1 : 0, hg.note, hg.noteWaiting ? 1 : 0, inDl ? 1 : 0, hearingLib.ecourtUrlOf(hg), hg.submitted, hg.submittedText,
      place ? place.kind + ":" + place.name + ":" + (r && r.inTree ? r.chain.join("/") : "") : "", r ? [folderSt(r).text, folderSt(r).tone, folderSt(r).sub || ""].join("/") : "",
      controls ? folderControlsSig(r, line) : ""].join("|"))].join("\n");
  if (sig === hearingsShown) return;
  hearingsShown = sig;

  const linkBtn = document.getElementById("hearings-link");
  linkBtn.textContent = sheet.state === "none" ? "Link hearings sheet…" : sheet.state === "locked" ? "Allow hearings sheet" : "Change sheet…";
  linkBtn.title = sheet.state === "none"
    ? "Point Home at your Excel sheet of upcoming hearings once (Date, Motion Type, Case Name, Date Submitted)"
    : sheet.state === "locked" ? `The browser wants your leave to read ${sheet.name} again`
      : `Read from ${sheet.name}${sheet.sheets && sheet.sheets.length ? " (" + sheet.sheets.join(", ") + ")" : ""}. Saved in Excel, it is read again on the next look.`;
  setupNeeded("sheet", sheet.state === "none" || sheet.state === "locked");
  const refreshBtn = document.getElementById("briefing-refresh");
  if (refreshBtn) refreshBtn.hidden = !sheet.hearings.length;
  setupNeeded("downloads", dlState !== "ok");
  const allBtn = document.getElementById("hearings-all");
  const offCount = all.filter((h) => h.mark === "off").length;
  const doneCount = all.filter((h) => h.mark === "done").length;
  const marked = offCount;
  allBtn.hidden = !offCount;
  allBtn.textContent = hearingsAll ? "Hide off calendar" : `Show off calendar (${offCount})`;
  const pastBtn = document.getElementById("hearings-past");
  if (pastBtn) {
    pastBtn.hidden = !hv.pastCount;
    pastBtn.textContent = hearingsPast ? "Hide previous" : `Show previous (${hv.pastCount})`;
    pastBtn.title = `The hearings of the last ${PAST_DAYS} days, under the upcoming ones${hearingsAll ? "" : " (off calendar ones with Show off calendar)"}`;
  }

  const notDl = open.length - downloaded;
  // The counts are filters (the owner, 2026-11-24: "Turn them into pills that
  // filter the list"): a click shows only the hearings it counts, a second
  // click (or "to work up") shows them all again. What needs doing leads.
  const going = hv.runs && runsLib ? hv.runs.runs.filter((r) => runsLib.isGoingNow(r, now)) : [];
  const counts = {
    notdl: notDl,
    unbriefed: open.filter((h) => briefingMissing(h, hv.briefing)).length,
    claude: going.length,
    downloaded,
    done: doneCount,
  };
  if (hearingFilter && !counts[hearingFilter]) hearingFilter = "";
  sumEl.hidden = !open.length && !doneCount;
  sumEl.textContent = "";
  if (open.length || doneCount) {
    const pill = (text, key, cls, title) => {
      const s = document.createElement("button");
      s.type = "button";
      s.className = "hs-pill" + (cls ? " " + cls : "") + (key && hearingFilter === key ? " active" : "") + (!key && !hearingFilter ? " active" : "");
      s.textContent = text;
      s.setAttribute("aria-pressed", (key ? hearingFilter === key : !hearingFilter) ? "true" : "false");
      s.title = (title ? title + "\n" : "") + (key ? (hearingFilter === key ? "Click to show every hearing again" : "Click to show only these") : "Every hearing ahead");
      s.addEventListener("click", () => { hearingFilter = key && hearingFilter !== key ? key : ""; hearingsShown = ""; renderCaseFolders(); });
      sumEl.appendChild(s);
      return s;
    };
    if (notDl) pill(`${notDl} not downloaded`, "notdl", "hs-warn");
    if (counts.unbriefed) pill(`${counts.unbriefed} with briefing not filed`, "unbriefed", "hs-warn");
    // The Claude runs going, the ones on no hearing of the list included.
    // Only runs moving now (isGoingNow): not a failed or paused one, nor one
    // left days ago still saying "running".
    if (going.length) pill(`${going.length} Claude run${going.length === 1 ? "" : "s"} going`, "claude", "hs-claude", going.map((r) => `${r.name}: ${runsLib.runLine(r, hv.runs.written, now).line}`).join("\n"));
    pill(`${open.length} to work up`, "", "hs-all");
    if (downloaded) pill(`${downloaded} downloaded`, "downloaded", "hs-ok");
    if (doneCount) pill(`${doneCount} done`, "done", "hs-ok");
    // How E-Court Suite's last check of the briefing went.
    const rt = hv.briefing && !hv.briefing.none ? hearingLib.refreshText(hv.briefing.refresh, now) : null;
    if (rt) {
      const sp = document.createElement("span");
      sp.className = "hs-refresh tone-" + rt.tone;
      sp.textContent = rt.text;
      sp.title = rt.title;
      sumEl.appendChild(sp);
    }
    if (dlState !== "ok") {
      const note = document.createElement("button");
      note.className = "hs-note link-btn";
      note.textContent = dlState === "none" ? "Link Downloads to match the folders in it" : "Allow Downloads to match the folders in it";
      note.addEventListener("click", () => document.getElementById("case-downloads").click());
      sumEl.appendChild(note);
    }
  }
  const waiting = (hearingEdits || []).length;
  if (waiting) {
    sumEl.hidden = false;
    const w = document.createElement("span");
    w.className = "hs-warn";
    w.textContent = `${waiting} change${waiting === 1 ? "" : "s"} (marks, notes) waiting to be written: close ${sheet.name} in Excel`;
    w.title = editsError ? `The last try said: ${editsError}` : "";
    sumEl.appendChild(w);
  }

  const calBox = document.getElementById("calendar-changes");
  if (calBox) renderCalendarChanges(calBox, sheet, hv.briefing, now);
  listEl.textContent = "";
  noteEditing = "";
  const empty = (text) => { const p = document.createElement("p"); p.className = "case-empty"; p.textContent = text; listEl.appendChild(p); };
  // An empty list says what to do, with the button that does it (the same
  // as the settings menu's).
  const emptyWith = (text, label, id) => {
    const p = document.createElement("p");
    p.className = "case-empty with-action";
    p.textContent = text + " ";
    const go = document.createElement("button");
    go.className = "case-empty-go";
    go.textContent = label;
    go.addEventListener("click", () => document.getElementById(id).click());
    p.appendChild(go);
    listEl.appendChild(p);
  };
  if (sheet.state === "none") return emptyWith("Link your Excel sheet of upcoming hearings, and each one is listed here with whether its case is downloaded.", "Link hearings sheet…", "hearings-link");
  if (sheet.state === "locked") return emptyWith(`The browser wants your leave to read ${sheet.name} again.`, "Allow hearings sheet", "hearings-link");
  if (sheet.state === "error") {
    const p = document.createElement("p");
    p.className = "case-empty hearings-error";
    p.textContent = `${sheet.name} could not be read just now (${sheet.error}).${sheet.hearings.length ? " These are from the last read." : ""}`;
    listEl.appendChild(p);
  }
  if (sheet.state === "ok" && !sheet.sheets.length) return empty(`No sheet in ${sheet.name} has a header row with Date and Case Name columns.`);
  if (!items.length) { if (sheet.state === "ok") empty(marked ? "Every upcoming hearing is off calendar." : "No hearings from today on in the sheet."); return; }

  // A summary pill picked: only the hearings it counts.
  const isDl = ({ place }) => !!place && (place.kind === "folder" || place.kind === "opened");
  const filterBy = {
    notdl: (it) => !it.hg.mark && !isDl(it),
    downloaded: (it) => !it.hg.mark && isDl(it),
    done: (it) => it.hg.mark === "done",
    unbriefed: (it) => !it.hg.mark && briefingMissing(it.hg, hv.briefing),
    claude: (it) => !!(hv.runs && runsLib && runsLib.runsForHearing(it.hg, hv.runs.runs, it.place ? it.place.name : "").some((r) => runsLib.isGoingNow(r, now))),
  }[hearingFilter];
  const rowItems = filterBy ? items.filter(filterBy) : items;
  if (!rowItems.length) {
    const p = document.createElement("p");
    p.className = "case-empty with-action";
    p.textContent = "No hearing on the list matches. ";
    const go = document.createElement("button");
    go.className = "case-empty-go";
    go.textContent = "Show every hearing";
    go.addEventListener("click", () => { hearingFilter = ""; hearingsShown = ""; renderCaseFolders(); });
    p.appendChild(go);
    listEl.appendChild(p);
    return;
  }
  // The briefing column takes room only for the chips there are.
  // Its width: a chip with its due date under it 76px, one whose date is said
  // once after the chips 58px plus the date's 70px.
  const chipsWide = (e) => {
    const cs = hearingLib.briefingChips(e);
    if (!cs.length) return 0;
    const once = cs.length > 1 && cs[0].due && cs.every((c) => c.due === cs[0].due);
    return once ? cs.length * 58 + (cs.length - 1) * 5 + 74 : cs.length * 76 + (cs.length - 1) * 5;
  };
  const chipMost = Math.max(0, ...rowItems.map(({ hg }) => (hv.briefing && !hv.briefing.none && hg.mark !== "off" ? Math.max(0, ...briefingsOf(hg, hv.briefing).map(chipsWide)) : 0)));
  const dashes = hv.briefing && !hv.briefing.none && rowItems.some(({ hg }) => hg.caseNumber && hg.mark !== "done" && hg.mark !== "off" && !briefingsOf(hg, hv.briefing).length);
  // A row with more than one motion set that day leads each line of chips with its tag.
  const multiBrief = hv.briefing && !hv.briefing.none && rowItems.some(({ hg }) => hg.mark !== "off" && briefingsOf(hg, hv.briefing).length > 1);
  listEl.classList.toggle("has-multi-brief", !!multiBrief);
  listEl.classList.toggle("has-brief", chipMost > 0 || !!dashes);
  listEl.classList.toggle("has-claude", canAskClaude());
  listEl.classList.toggle("has-runs", !!(hv.runs && runsLib && rowItems.some(({ hg, place }) => runsLib.runsForHearing(hg, hv.runs.runs, place ? place.name : "").length)));
  listEl.style.setProperty("--brief-w", (chipMost || 24) + "px");
  let lastDay = null;
  // Every other case a shade apart (the owner, 2026-11-24: "a subtle color
  // shift between cases"), starting again under each day.
  let altRow = false;
  const dayCounts = new Map();
  for (const { hg } of rowItems) { const k = hg.date || hg.dateText; dayCounts.set(k, (dayCounts.get(k) || 0) + 1); }
  const today0 = new Date(now).setHours(0, 0, 0, 0);
  let pastHead = false;
  for (const { hg, place, r, controls, inDl } of rowItems) {
    // The previous hearings (Show previous) under a heading of their own.
    if (!pastHead && hg.date && hg.date < today0) {
      pastHead = true;
      const ph = document.createElement("div");
      ph.className = "hearing-past-head";
      ph.textContent = `Previous hearings · the last ${PAST_DAYS} days, newest first`;
      listEl.appendChild(ph);
    }
    const dayKey = hg.date || hg.dateText;
    if (dayKey !== lastDay) {
      lastDay = dayKey;
      altRow = false;
      // The day, how far off it is and how many hearings it holds (the owner,
      // 2026-11-24): "Thu, Nov 26 · in 2 days · 2 hearings"; today and
      // tomorrow stand out.
      const head = document.createElement("div");
      head.className = "hearing-day";
      const main = document.createElement("span");
      main.className = "hd-day";
      main.textContent = hg.date ? hearingLib.dayText(hg.date, now) : hg.dateText;
      head.appendChild(main);
      const rel = hg.date ? hearingLib.daysAwayText(hg.date, now) : "";
      const n = dayCounts.get(dayKey) || 0;
      for (const t of [rel, n ? `${n} hearing${n === 1 ? "" : "s"}` : ""]) {
        if (!t) continue;
        const x = document.createElement("span");
        x.className = "hd-more";
        x.textContent = t;
        head.appendChild(x);
      }
      if (hg.date) {
        const off = hearingLib.daysAway(hg.date, now);
        if (off === 0) head.classList.add("today");
        else if (off === 1) head.classList.add("tomorrow");
        head.title = new Date(hg.date).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      }
      listEl.appendChild(head);
    }
    // The case folder, where there is one: its status in the pill, its name
    // (and a run's start) on the second line, its buttons on the row.
    const folder = r ? r.handle : place && (place.kind === "folder" || place.kind === "opened") ? place.handle : null;
    const st = r ? folderSt(r) : null;
    const row = document.createElement("div");
    row.className = "case-row hearing-row" + (hg.mark ? " mark-" + hg.mark : "") + (altRow ? " alt" : "");
    altRow = !altRow;
    const b = document.createElement("button");
    b.className = "recent-item case-item hearing-item" + (folder ? " has-folder" : "");
    // No folder or calendar icon in front (the owner, 2026-11-24): the pill
    // says where the case folder stands.
    b.innerHTML = `<span class="ci-main"><span class="ci-name-line"><span class="ri-name"><span class="ci-num"></span> <span class="ci-title"><span class="ci-case"></span></span></span></span><span class="ci-where"></span></span><span class="ci-status"></span>`;
    // The briefing, then the status, each in a column of fixed width.
    const statusCol = document.createElement("span");
    statusCol.className = "ci-status-col";
    b.querySelector(".ci-status").replaceWith(statusCol);
    // In the order things happen (the owner, 2026-11-20: "thinking
    // chronologically, the order should go briefing status, download
    // status/pdf linker status, run status"): the briefing, where the case
    // folder stands, then the Claude run.
    statusCol.before(briefingCell(hg, hv.briefing, now));
    statusCol.after(runCell(hg, place ? place.name : "", hv.runs, now));
    // The case number in a column of its own, the name beside it (the
    // owner's review, 2026-11-18: number and name each line up to be read
    // down). The name is the sheet's, as written.
    const num = hg.caseNumber || "";
    const lead = num ? new RegExp("^\\s*" + num + "(?![A-Za-z0-9])[\\s,:;-]*", "i") : null;
    b.querySelector(".ci-num").textContent = num;
    b.querySelector(".ci-case").textContent = lead && lead.test(hg.caseName) ? hg.caseName.replace(lead, "") : hg.caseName;
    b.querySelector(".ri-name").title = hg.caseName;
    if (hg.mark === "done") {
      const tick = document.createElement("span");
      tick.className = "ci-done-mark";
      tick.innerHTML = icon("check", { size: 15, stroke: 2.5 });
      tick.title = "Done: marked green in the sheet";
      tick.setAttribute("aria-label", "Done");
      b.querySelector(".ci-case").before(tick);
    }
    // The sticky note (the owner, 2026-11-19): on every row, outlined where
    // there is no note, filled in where there is; a click opens the note under
    // the row to read, write or change (setHearingNoteText).
    let noteEl = null;
    {
      const key = noteKey(hg);
      const has = !!hg.note;
      const pad = document.createElement("span");
      pad.className = "ci-note" + (has ? " has" : "") + (hg.noteWaiting ? " waiting" : "");
      pad.innerHTML = icon("sticky-note", { size: 16 });
      pad.title = has ? `Note: ${hg.note}\n(click to read or change it)` : "Add a note (kept in the sheet's Date column)";
      pad.setAttribute("role", "button");
      pad.setAttribute("aria-label", (has ? "The note on " : "Add a note on ") + hg.caseName);
      b.querySelector(".ci-name-line").prepend(pad);
      noteEl = document.createElement("div");
      noteEl.className = "hearing-note";
      noteEl.hidden = !notesOpen.has(key);
      pad.classList.toggle("open", !noteEl.hidden);
      const ta = document.createElement("textarea");
      ta.className = "note-text";
      ta.rows = 2;
      ta.value = hg.note || "";
      ta.placeholder = "A note on this hearing…";
      ta.setAttribute("aria-label", "Note on " + hg.caseName);
      const btns = document.createElement("div");
      btns.className = "note-btns";
      const mk = (label, cls, fn) => { const x = document.createElement("button"); x.className = cls; x.textContent = label; x.addEventListener("click", (e) => { e.stopPropagation(); fn(); }); btns.appendChild(x); return x; };
      const close = () => { noteEl.hidden = true; pad.classList.remove("open"); notesOpen.delete(key); noteEditing = ""; };
      mk("Save", "note-save", () => { const v = ta.value.replace(/\s+/g, " ").trim(); close(); if (v !== (hg.note || "")) setHearingNoteText(hg, v); });
      if (has) mk("Remove note", "link-btn note-remove", () => { close(); setHearingNoteText(hg, ""); });
      mk("Cancel", "link-btn", () => { ta.value = hg.note || ""; close(); });
      const hint = document.createElement("span");
      hint.className = "note-hint";
      hint.textContent = hg.noteWaiting ? `Waiting to be written into ${sheet.name} (open in Excel?)` : "Ctrl+Enter saves · kept in the sheet's Date column";
      btns.appendChild(hint);
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); btns.querySelector(".note-save").click(); }
        else if (e.key === "Escape") { e.preventDefault(); ta.value = hg.note || ""; close(); }
      });
      ta.addEventListener("focus", () => { noteEditing = key; });
      noteEl.append(ta, btns);
      pad.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        noteEl.hidden = !noteEl.hidden;
        pad.classList.toggle("open", !noteEl.hidden);
        if (noteEl.hidden) { notesOpen.delete(key); noteEditing = ""; }
        else {
          if (!noteEl.isConnected) row.after(noteEl);
          notesOpen.add(key); noteEditing = key;
          setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
        }
      });
    }
    // A case folder still in Downloads, marked so it is plain which are left
    // to file (the owner: "It should be visually obvious which case folders on
    // the hearings table are in the downloads folder").
    // …only once the hearing is marked done (the owner, 2026-11-20: "Change
    // the still in download symbol to only show up after I mark the item
    // done"): a case still being worked belongs in Downloads.
    if (inDl && hg.mark === "done") {
      row.classList.add("in-downloads");
      const chip = document.createElement("span");
      chip.className = "ci-dl-chip";
      chip.innerHTML = icon("download", { size: 13, stroke: 2.4 });
      chip.setAttribute("aria-label", "In Downloads");
      chip.title = "Marked done, and its case folder is still in Downloads. Drag the row onto a folder on the left to file it there.";
      b.querySelector(".ci-name-line").appendChild(chip);
    }

    // More than one motion set that day for the case (the case page's "⚠ N
    // motions set <date>"): said by the name, the motions on its hover.
    {
      const set = hg.mark === "off" ? [] : briefingsOf(hg, hv.briefing);
      if (set.length > 1) {
        const badge = document.createElement("span");
        badge.className = "ci-motions-chip";
        badge.textContent = `⚠ ${set.length} motions`;
        badge.title = `${set.length} motions set ${hg.date ? new Date(hg.date).toLocaleDateString() : "that day"}, each worked up apart in eCourt:\n` + set.map((e) => "• " + (e.motionType || "motion")).join("\n");
        b.querySelector(".ci-name-line").appendChild(badge);
      }
    }
    // A LEAKS sheet in the case folder: PDF-Linker flagged values to answer.
    if (r && !r.locked && r.status && r.status.leaks) b.querySelector(".ci-name-line").appendChild(leaksChip());
    // The motion as a tag on the name's line (the owner, 2026-11-24), not
    // grey under it: what is being heard reads with whose case it is.
    if (hg.motion) {
      const tag = document.createElement("span");
      tag.className = "ci-motion";
      tag.textContent = hg.motion;
      tag.title = hg.motion;
      b.querySelector(".ci-title").appendChild(tag);
    }

    const where = [];
    if (hg.caseNumber && !hearingLib.caseNumbersIn(hg.caseName).includes(hg.caseNumber)) where.push(hg.caseNumber);
    const moved = movedOf(hg);
    if (moved && moved.from) where.push("Moved from " + hearingLib.shortDate(calLib.dayAt(moved.from), now));
    if (hg.submitted || hg.submittedText) where.push("Submitted " + (hg.submitted ? hearingLib.shortDate(hg.submitted, now) : hg.submittedText));
    // The case folder's name is on the hover only: the row is that folder.
    const folderSaid = folder ? place.name + (r && r.inTree ? ` (in ${r.chain.length > 1 ? r.chain[r.chain.length - 2] : r.root.name})` : "") : "";
    if (st && st.sub) where.push(st.sub);
    b.querySelector(".ci-where").textContent = where.join(" · ");
    const pill = document.createElement("span");
    pill.className = "ci-status";
    statusCol.appendChild(pill);
    const said = hg.mark === "off" && moved && moved.to !== undefined ? { text: moved.to ? `Moved to ${hearingLib.shortDate(calLib.dayAt(moved.to), now)}` : "Moved", tone: "off", title: `The case's Hearings tab says “${moved.status || "continued"}”${moved.to ? `; the hearing is written into the sheet under ${new Date(calLib.dayAt(moved.to)).toLocaleDateString()}` : ""}. Marked red in the sheet.` }
        : hg.mark === "off" ? { text: "Off calendar", tone: "off", title: "Marked red in the sheet: off calendar, or nothing to work up." }
        : st || hearingLib.placeText(place);
    pill.textContent = said.text;
    pill.classList.add("tone-" + said.tone);
    // A hearing done says nothing of where its case stands (the owner: "If a
    // case folder is done, remove the not downloaded button").
    if (hg.mark === "done" && !st) pill.hidden = true;
    if (hg.waiting) pill.classList.add("waiting");
    pill.title = said.text;
    const placeSaid = hearingLib.placeText(place);
    b.title = (folder ? `Case folder: ${folderSaid}\nClick for this case's buttons; double-click to open ${place.name}, the whole case folder.` : "Click for this case's buttons, Find its folder among them; double-click to look for it at once.")
      + `\n${placeSaid.title}` + (st && st.title ? "\n" + st.title : hg.mark ? "\n" + said.title : "") + `\nFrom the hearings sheet: ${hg.sheet}, row ${hg.row}; case number read: ${hg.caseNumber || "none"}.`
      + (hg.waiting ? `\nMarked ${hg.mark === "off" ? "off" : "on"} calendar here; not yet written into ${sheet.name} (open in Excel?).` : "");
    const openIt = async () => {
      if (folder) {
        if (!(await permitted(folder, "readwrite", true))) return;
        try { await openCaseFolder(folder, { inWindow: true }); }
        catch { shellToast(`“${place.name}” could not be opened — it may have been moved or deleted.`, 5000); renderCaseFolders(); }
      } else locateCase(hg);
    };
    // A click selects the case and opens its buttons under it; a second click
    // closes them; a double click opens the case folder (the owner: "I could
    // click on the case first to select it, and only then would all the
    // buttons appear").
    const selKey = noteKey(hg);
    b.setAttribute("aria-expanded", selectedHearing === selKey ? "true" : "false");
    b.addEventListener("click", (e) => {
      if (e.detail >= 2) { selectHearing(row, selKey, true); openIt(); return; }
      selectHearing(row, selKey, selectedHearing !== selKey);
    });
    row.appendChild(b);
    if (r) caseDraggable(row, r);
    // The buttons in fixed slots, each in the same place on every row, an
    // empty slot keeping its room: the folder's own (on the first hearing of
    // its case only), then Done, Off calendar and eCourt.
    // At a glance: where the folder stands in PDF-Linker's line.
    if (controls && r && r.rank) {
      const tag = document.createElement("span");
      tag.className = "ci-place ci-place-glance";
      tag.textContent = caseLib.ordinal(r.rank);
      tag.title = caseLib.lineTitle(r.rank, r.name);
      statusCol.prepend(tag);
    }
    // The buttons, built when the case is selected: under the row, labelled.
    row.__selKey = selKey;
    row.__tools = () => {
      const bar = document.createElement("div");
      bar.className = "hearing-tools";
      const add = (el, label = true) => { if (!el) return; if (label) labelTools(el); bar.appendChild(el); };
      const open = document.createElement("button");
      open.className = "ht-open";
      open.innerHTML = `${icon(folder ? "folder" : "search", { size: 16 })}<span>${folder ? "Open case folder" : "Find its folder…"}</span>`;
      open.title = folder ? `Open ${place.name}, the whole case folder, in a window of its own (or double-click the case)` : "Pick this case's folder (moved somewhere Home does not look?); Home keeps it as this hearing's";
      open.addEventListener("click", (e) => { e.stopPropagation(); openIt(); });
      bar.appendChild(open);
      add(hearingLib.ecourtUrlOf(hg) ? ecourtButton(hg) : null);
      const editable = sheet.state === "ok" || sheet.state === "error";
      if (editable) { add(doneButton(hg)); add(calendarButton(hg)); }
      add(r && !r.locked && canAskClaude() ? claudeButton(hg, r) : null);
      const own = controls && r && !r.locked;
      if (own && canOpenWord() && caseLib.wordDocs(r.listing).length) add(wordButton(r));
      if (own && caseLib.hasShareLog(r.listing)) add(shareLogButton(r));
      if (own && r.listing) { const lc = lineControls(r); if (lc.childNodes.length) { if (lc.querySelector(".ci-line-add")) labelTools(lc); bar.appendChild(lc); } }
      if (own && r.status && r.status.state === "stalled") add(takeOverButton(r), false);
      bar.addEventListener("click", (e) => e.stopPropagation());
      return bar;
    };
    if (selectedHearing === selKey) { row.classList.add("selected"); row.appendChild(row.__tools()); }
    listEl.appendChild(row);
    // The note's panel is in the list only while it is open.
    if (noteEl && !noteEl.hidden) listEl.appendChild(noteEl);
  }
  fitColumns(listEl);
  if (shownAll.length > HEARING_ROWS_MAX) empty(`And ${shownAll.length - HEARING_ROWS_MAX} more in the sheet.`);
}

document.getElementById("hearings-link")?.addEventListener("click", async () => {
  const h = await sheetHandle();
  // Linked but not readable this session: the leave is asked again. Refused,
  // the dialog follows, to link it afresh.
  if (h && !(await permitted(h, "read", false)) && (await permitted(h, "read", true))) { renderCaseFolders(); return; }
  let picked;
  try {
    [picked] = await showPicker("showOpenFilePicker", {
      id: "hearings",
      types: [{ description: "Excel workbook", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx", ".xlsm"] } }],
      multiple: false,
    });
  } catch (e) { if (e && e.name !== "AbortError") shellToast(String(e.message || e), 5000); return; }
  if (!picked) return;
  if (!/\.(xlsx|xlsm)$/i.test(picked.name)) { shellToast("The hearings sheet must be an Excel workbook (.xlsx or .xlsm). An older .xls can be saved as .xlsx from Excel.", 7000); return; }
  try { await foldersTx("places", "readwrite", (s) => s.put(picked, "hearings")); }
  catch { shellToast("The hearings sheet could not be kept: this browser is not storing anything for the app.", 6000); return; }
  sheetSeen = null;
  hearingsShown = "";
  renderCaseFolders();
});
document.getElementById("hearings-all")?.addEventListener("click", () => {
  hearingsAll = !hearingsAll;
  hearingsShown = "";
  renderCaseFolders();
});
document.getElementById("hearings-past")?.addEventListener("click", async () => {
  hearingsPast = !hearingsPast;
  hearingsShown = "";
  renderCaseFolders();
  // They come under every upcoming hearing, out of sight on a long list (the
  // owner, 2026-11-20: "Show previous doesn't seem to do anything"): brought
  // into view, and lit for a moment; hidden again, back to the list's top.
  const want = hearingsPast;
  for (let i = 0; i < 100 && hearingsPast === want; i++) {
    const head = document.querySelector("#hearing-list .hearing-past-head");
    if (want && head) {
      head.scrollIntoView({ behavior: "smooth", block: "start" });
      head.classList.remove("flash");
      void head.offsetWidth;
      head.classList.add("flash");
      return;
    }
    if (!want && !head) {
      document.getElementById("hearings")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
});

// ---- Home: find a case's folder ---------------------------------------------
//
// The owner (2026-11-18): "Instead of clicking the case name for a not
// downloaded case sending me to e-court (I can use the ecourt button for
// that) it should let me try to locate the file (because I might have just
// moved it to another folder)." A click on a hearing with no folder found
// asks for the folder (the dialog starts where the last one was found), and
// the folder picked is that hearing's from then on: a LINK, by its case
// number (else its case name's words), kept in the folders database (`places`
// → "hearingLinks") and looked at before any matching (hearingItems). A
// folder carrying another case's number, or no sign of a case at all, is
// refused. Then it opens, as a click on a found case does. Links older than
// HEARING_LINK_KEEP_MS are let go, and a link's folder moved from the
// Folders list moves with it (moveCase).
const HEARING_LINK_KEEP_MS = 120 * 86400000;
let hearingLinksSeen = null; // [{ key, handle, at, caseName }]
const linkKey = (hg) => hg.caseNumber || "name:" + hearingLib.nameWords(hg.caseName).join(" ");
async function hearingLinks() {
  if (!hearingLinksSeen) {
    try { hearingLinksSeen = ((await foldersTx("places", "readonly", (st) => st.get("hearingLinks"))) || []).filter((l) => l && l.handle && l.handle.kind === "directory"); }
    catch { hearingLinksSeen = []; }
    const now = Date.now();
    const kept = hearingLinksSeen.filter((l) => now - (l.at || 0) <= HEARING_LINK_KEEP_MS);
    if (kept.length !== hearingLinksSeen.length) { hearingLinksSeen = kept; await saveHearingLinks(); }
  }
  return hearingLinksSeen;
}
async function saveHearingLinks() {
  try { await foldersTx("places", "readwrite", (st) => st.put(hearingLinksSeen, "hearingLinks")); }
  catch { shellToast("The folder could not be kept: this browser is not storing anything for the app.", 6000); }
}
async function locateCase(hg) {
  let dir;
  try { dir = await showPicker("showDirectoryPicker", { id: "locate", mode: "readwrite" }); }
  catch (e) { if (e && e.name !== "AbortError") shellToast(String(e.message || e), 5000); return; }
  let listing = null;
  try { listing = await readListing(dir); } catch { listing = null; }
  const nums = [...new Set([...hearingLib.caseNumbersIn(dir.name), ...listingNumbers(listing)])];
  if (hg.caseNumber && nums.length && !nums.includes(hg.caseNumber)) {
    shellToast(`${dir.name} is not ${hg.caseName}'s folder: it carries ${nums.join(", ")}, not ${hg.caseNumber}.`, 8000);
    return;
  }
  if (!listing || !caseLib.isCaseListing(listing)) {
    shellToast(`${dir.name} holds no case papers (no PDF, Word document or PDF-Linker files): pick the case's own folder.`, 8000);
    return;
  }
  const links = await hearingLinks();
  const key = linkKey(hg);
  for (let i = links.length - 1; i >= 0; i--) if (links[i].key === key) links.splice(i, 1);
  links.push({ key, handle: dir, at: Date.now(), caseName: hg.caseName });
  await saveHearingLinks();
  hearingsShown = ""; caseShown = "";
  shellToast(`${dir.name} is now ${hg.caseName}'s case folder.`, 5000);
  renderCaseFolders();
  try { await openCaseFolder(dir, { inWindow: true }); } catch { /* listed; a click opens it */ }
}

// ---- Home: folders -----------------------------------------------------------
//
// The owner (2026-11-18): "I want to add the ability to drag and drop them
// into another folder straight from the hearings menu. Can you add a file
// explorer style folder list to the left side?" And: "They should still
// remain in the Hearing list until the hearing date has passed."
//
// The FOLDERS LIST (#folder-tree) holds Downloads (once linked) and the
// folders the operator adds (+), kept as handles in the folders database
// (`places` → "treeRoots"), with write leave asked at the pick. Each opens
// like File Explorer's, a level at a time; a folder whose name carries a case
// number is a case folder and opens no further. A case folder's row, on a
// hearing or in Case folders, is dragged onto a folder of the list; the move
// bar asks, and Move moves it (viewer/case-move.js, moveFolder: a page can
// move files but not folders, so it is moved file by file into a folder of
// the same name, and the emptied one is taken away). Refused while
// PDF-Linker runs in it or a reader tab holds it (moveBlocker), and where a
// file would land on another. The click on Move is the one the write leave
// is asked on.
//
// A moved folder stays on its hearing's row: the list's own folders are
// looked through for case folders (treeIndex: their folders, and one level
// further under any whose name is no case's), as Downloads is. In PDF+, the
// folder's PDF-Linker launcher is rewritten to name its new place (main.js
// "pdfplus:folder-path"; retargetLauncher), so Re-run and Take over still
// reach it.
const TREE_KIDS_MAX = 300;
const TREE_INDEX_MS = 60000;
const SPRING_OPEN_MS = 800;
let moveLib = null;
let treeRootsSeen = null;     // the handles added, in order
const treeOpen = new Set();   // keys of the folders opened: "<root>/<name>/<name>"
let treeShown = "";
let treeBusy = false, treeAgain = false;
let treeIndexSeen = null;     // { at, places }
let caseDrag = null;          // the row being dragged, while it is

async function treeRoots() {
  if (!treeRootsSeen) {
    try { treeRootsSeen = ((await foldersTx("places", "readonly", (st) => st.get("treeRoots"))) || []).filter((h) => h && h.kind === "directory"); }
    catch { treeRootsSeen = []; }
  }
  return treeRootsSeen;
}
async function saveTreeRoots() {
  try { await foldersTx("places", "readwrite", (st) => st.put(treeRootsSeen, "treeRoots")); }
  catch { shellToast("The folders list could not be kept: this browser is not storing anything for the app.", 6000); }
}
/** A folder's own folders, by name: [{ name, handle }], sorted as File Explorer sorts. */
async function subfolders(dir) {
  const out = [];
  for await (const [name, h] of dir.entries()) if (h.kind === "directory" && !name.startsWith(".")) out.push({ name, handle: h });
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}
const isCaseName = (name) => !!hearingLib && hearingLib.caseNumbersIn(name).length > 0;

/**
 * The case folders standing in the folders the operator added: each one's
 * own folders, and those one level further under any whose name carries no
 * case number (a folder per judge, per month). Names only; read again every
 * TREE_INDEX_MS, and at once after a move.
 */
async function treeIndex() {
  const now = Date.now();
  if (treeIndexSeen && now - treeIndexSeen.at < TREE_INDEX_MS) return treeIndexSeen.places;
  const places = [];
  for (const root of await treeRoots()) {
    if (!(await permitted(root, "read", false))) continue;
    let kids;
    try { kids = await subfolders(root); } catch { continue; }
    for (const k of kids) {
      places.push({ name: k.name, kind: "folder", handle: k.handle, parent: root, root, chain: [k.name], inTree: true });
      if (isCaseName(k.name)) continue;
      let grand;
      try { grand = await subfolders(k.handle); } catch { continue; }
      for (const g of grand) places.push({ name: g.name, kind: "folder", handle: g.handle, parent: k.handle, root, chain: [k.name, g.name], inTree: true });
    }
  }
  treeIndexSeen = { at: now, places };
  return places;
}

/** Draw the folders list: each root, and under each folder opened its own folders. */
async function renderTree(dl, dlState, underDrag = false) {
  if (treeBusy) { treeAgain = true; return; }
  treeBusy = true;
  try {
    do { treeAgain = false; await renderTreeNow(dl, dlState, underDrag); } while (treeAgain);
  } catch (e) { console.warn(e); }
  finally { treeBusy = false; }
}
async function renderTreeNow(dl, dlState, underDrag = false) {
  const box = document.getElementById("tree-list");
  // Never redrawn under a drag, but for a folder the drag springs open.
  if (!box || (caseDrag && !underDrag)) return;
  if (!hearingLib) hearingLib = await import("./viewer/hearing-sheet.js");
  const roots = [];
  if (dl && dlState === "ok") roots.push({ handle: dl, fixed: true });
  for (const h of await treeRoots()) roots.push({ handle: h, fixed: false, locked: !(await permitted(h, "read", false)) });
  // The nodes, depth first, each opened one's folders read now.
  const nodes = [];
  const add = async (handle, depth, key, root, chain, extra = {}) => {
    const open = treeOpen.has(key);
    const node = { handle, depth, key, root, chain, name: handle.name, open, leaf: depth > 0 && isCaseName(handle.name), ...extra };
    nodes.push(node);
    if (!open || node.leaf || node.locked) return;
    let kids = [];
    try { kids = await subfolders(handle); } catch { node.unreadable = true; return; }
    node.kids = kids.length;
    for (const k of kids.slice(0, TREE_KIDS_MAX)) await add(k.handle, depth + 1, key + "/" + k.name, root, [...chain, k.name]);
    if (kids.length > TREE_KIDS_MAX) nodes.push({ more: kids.length - TREE_KIDS_MAX, depth: depth + 1, key: key + "/…" });
  };
  for (const [i, r] of roots.entries()) await add(r.handle, 0, (r.fixed ? "dl" : "r" + i) + ":" + r.handle.name, r.handle, [], { fixed: r.fixed, locked: !!r.locked, rootIndex: r.fixed ? -1 : i - (roots[0] && roots[0].fixed ? 1 : 0) });
  const sig = nodes.map((n) => [n.key, n.open ? 1 : 0, n.leaf ? 1 : 0, n.locked ? 1 : 0, n.kids || 0, n.more || 0, n.unreadable ? 1 : 0].join("|")).join("\n") + "\n" + dlState;
  if (sig === treeShown) return;
  treeShown = sig;
  box.textContent = "";
  if (!nodes.length) {
    const p = document.createElement("p");
    p.className = "tree-empty";
    p.textContent = "Add the folders you file cases into with + Add, or drop several here from File Explorer; then drag a case onto one to move it there.";
    box.appendChild(p);
    return;
  }
  for (const n of nodes) {
    const el = document.createElement("div");
    el.className = "tree-node" + (n.leaf ? " leaf" : "") + (n.depth === 0 ? " root" : "");
    el.style.setProperty("--depth", n.depth);
    if (n.more) {
      el.classList.add("tree-more");
      el.textContent = `and ${n.more} more`;
      box.appendChild(el);
      continue;
    }
    const caret = document.createElement("span");
    caret.className = "tree-caret";
    caret.textContent = n.leaf ? "" : n.open ? "▾" : "▸";
    el.appendChild(caret);
    el.insertAdjacentHTML("beforeend", `<span class="tree-icon">${icon("folder", { size: 15 })}</span>`);
    const label = document.createElement("span");
    label.className = "tree-name";
    label.textContent = n.name;
    el.appendChild(label);
    el.title = n.leaf ? `${n.name}: a case folder` : n.locked ? `${n.name}: click to let PDF+ read it again` : `${n.name}${n.unreadable ? " could not be read" : ""}. Drag a case here to move it into this folder.`;
    if (n.depth === 0 && !n.fixed) {
      const x = document.createElement("button");
      x.className = "tree-remove";
      x.textContent = "✕";
      x.title = `Take ${n.name} off the folders list (nothing on disk changes)`;
      x.setAttribute("aria-label", x.title);
      x.addEventListener("click", async (e) => {
        e.stopPropagation();
        const roots = await treeRoots();
        roots.splice(n.rootIndex, 1);
        await saveTreeRoots();
        treeIndexSeen = null; treeShown = ""; hearingsShown = "";
        renderCaseFolders();
      });
      el.appendChild(x);
    }
    el.addEventListener("click", async () => {
      if (n.locked) { if (await permitted(n.handle, "readwrite", true)) { treeShown = ""; treeIndexSeen = null; renderCaseFolders(); } return; }
      if (n.leaf) return;
      if (treeOpen.has(n.key)) treeOpen.delete(n.key); else treeOpen.add(n.key);
      treeShown = "";
      renderTree(dl, dlState);
    });
    // A folder still waiting for leave takes a drop too: the leave is asked
    // on the move bar's Move (the owner found today's and tomorrow's cases
    // would not drop).
    if (!n.leaf) dropTarget(el, n, dl, dlState);
    box.appendChild(el);
  }
}

/** A case folder's row may be dragged onto the folders list. */
function caseDraggable(row, r) {
  row.draggable = true;
  row.classList.add("draggable");
  row.addEventListener("dragstart", (e) => {
    caseDrag = r;
    document.body.classList.add("case-dragging");
    try { e.dataTransfer.setData("text/plain", r.name); e.dataTransfer.effectAllowed = "move"; } catch { /* no data */ }
  });
  row.addEventListener("dragend", () => {
    caseDrag = null;
    document.body.classList.remove("case-dragging");
    for (const x of document.querySelectorAll(".tree-node.drop-here")) x.classList.remove("drop-here");
  });
}
function dropTarget(el, n, dl, dlState) {
  let spring = 0;
  el.addEventListener("dragover", (e) => {
    if (!caseDrag) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    el.classList.add("drop-here");
    // Held over a closed folder, it opens, as File Explorer's do.
    if (!spring && !n.open && !n.locked) spring = setTimeout(() => { treeOpen.add(n.key); treeShown = ""; renderTree(dl, dlState, true); }, SPRING_OPEN_MS);
  });
  el.addEventListener("dragleave", () => { el.classList.remove("drop-here"); clearTimeout(spring); spring = 0; });
  el.addEventListener("drop", (e) => {
    if (!caseDrag) return;
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(spring); spring = 0;
    el.classList.remove("drop-here");
    const r = caseDrag;
    caseDrag = null;
    document.body.classList.remove("case-dragging");
    askMove(r, n);
  });
}

// The move bar: asks, then says how the move goes.
let moveBar = null;
function showMoveBar() {
  if (!moveBar) {
    moveBar = document.createElement("div");
    moveBar.id = "move-bar";
    moveBar.setAttribute("role", "dialog");
    moveBar.innerHTML = `<span class="mb-text"></span><button class="mb-go">Move</button><button class="mb-cancel">Cancel</button>`;
    document.body.appendChild(moveBar);
  }
  moveBar.hidden = false;
  return moveBar;
}
async function askMove(r, n) {
  const bar = showMoveBar();
  const where = [n.root.name, ...n.chain].join(" › ");
  const go = bar.querySelector(".mb-go"), cancel = bar.querySelector(".mb-cancel");
  go.disabled = false; cancel.disabled = false;
  go.hidden = false; cancel.textContent = "Cancel";
  cancel.onclick = () => { bar.hidden = true; };
  // A case open in its own window would lose its folder under it: offered
  // closed first, in the same click.
  const cw = r.handle ? await caseWindowHolding(r.handle) : null;
  if (cw) {
    bar.querySelector(".mb-text").textContent = `“${r.name}” is open in its own window. Close that window and move it into ${where}?`;
    go.textContent = "Close window and move";
    go.onclick = async () => { try { cw.win.close(); } catch { /* gone */ } await new Promise((res) => setTimeout(res, 400)); go.textContent = "Move"; moveCase(r, n); };
  } else {
    bar.querySelector(".mb-text").textContent = `Move “${r.name}” into ${where}?${n.locked ? " (PDF+ asks your leave for it first.)" : ""}`;
    go.textContent = "Move";
    go.onclick = () => moveCase(r, n);
  }
  go.focus();
}

/** A window of the app that holds the folder (a case opened in its own window), or null. */
async function caseWindowHolding(dir) {
  for (const cw of caseWindows) {
    if (!cw.win || cw.win.closed || cw.name !== dir.name) continue;
    let held = [];
    try { held = (cw.win.__shellCaseDirs && cw.win.__shellCaseDirs()) || []; } catch { held = []; }
    for (const d of held) { try { if (d && (await d.isSameEntry(dir))) return cw; } catch { /* gone */ } }
  }
  return null;
}
/** Whether a reader tab holds the folder. */
async function inReader(dir) {
  for (const t of tabs) {
    if (!t.text) continue;
    let held = t.dir;
    try { held = t.iframe.contentWindow.__textReaderSource?.()?.dir || held; } catch { /* not ready */ }
    try { if (held && (await held.isSameEntry(dir))) return true; } catch { /* gone */ }
  }
  return false;
}

async function moveCase(r, n) {
  const bar = showMoveBar();
  const text = bar.querySelector(".mb-text");
  const go = bar.querySelector(".mb-go"), cancel = bar.querySelector(".mb-cancel");
  const done = (msg) => { text.textContent = msg; go.hidden = true; cancel.disabled = false; cancel.textContent = "Close"; cancel.onclick = () => { bar.hidden = true; }; };
  go.disabled = true; cancel.disabled = true;
  if (!moveLib) moveLib = await import("./viewer/case-move.js");
  const src = r.handle, target = n.handle;
  // Asked on this click: the folder, the one holding it, and the target.
  for (const h of [src, r.parent, target]) {
    if (h && !(await permitted(h, "readwrite", true))) return done(`“${r.name}” was not moved: PDF+ may not write into ${h.name}.`);
  }
  let state = "";
  try { state = caseLib.folderStatus(await readListing(src), Date.now()).state; } catch { /* unreadable: the move finds out */ }
  if (runsStarted.some((x) => x.name === r.name)) state = "starting";
  const why = moveLib.moveBlocker({ state, inReader: (await inReader(src)) || !!(await caseWindowHolding(src)) });
  if (why) return done(`“${r.name}” was not moved: ${why}`);
  // The opened-here records of this folder, its hearing links and its place
  // in line, to point at its new place (the old handle dies with the move).
  const moved = new Set(), movedLine = new Set();
  for (const l of await hearingLinks()) { try { if (l.handle.name === r.name && (await l.handle.isSameEntry(src))) moved.add(l); } catch { /* gone */ } }
  for (const e of await prioAll()) { try { if (e.name === r.name && (await e.handle.isSameEntry(src))) movedLine.add(e); } catch { /* gone */ } }
  const records = [];
  for (const rec of await foldersAll()) {
    if (rec.name !== r.name) continue;
    try { if (await rec.handle.isSameEntry(src)) records.push(rec); } catch { /* gone */ }
  }
  let res;
  try {
    res = await moveLib.moveFolder(src, target, { parent: r.parent || null, onFile: (i, total) => { text.textContent = `Moving “${r.name}”: ${i} of ${total} files…`; } });
  } catch (e) {
    const msg = (e && e.message) || String(e);
    done(`“${r.name}” was ${/^(a folder cannot|it is already|this browser|.* already has )/.test(msg) ? "not moved" : "only partly moved (drag it onto the same folder again to finish)"}: ${msg}.`);
    afterMove(r, n);
    return;
  }
  for (const rec of records) {
    try { await foldersTx("folders", "readwrite", (st) => st.put({ ...rec, handle: res.dir })); } catch { /* listed again once opened */ }
  }
  // A hearing's link and a place in line follow the folder to its new place.
  let relinked = false;
  for (const l of await hearingLinks()) if (moved.has(l)) { l.handle = res.dir; relinked = true; }
  if (relinked) await saveHearingLinks();
  let reline = false;
  for (const e of await prioAll()) if (movedLine.has(e)) { e.handle = res.dir; reline = true; }
  if (reline) await prioSave();
  const launcher = await retargetLauncher(res.dir, n, r.name);
  const notes = [];
  if (res.left) notes.push(`the empty folder is left where it was`);
  if (launcher === "unknown") notes.push("its PDF-Linker launcher still names the old place, so run PDF-Linker on it afresh before using Re-run");
  if (launcher === "browser") notes.push("its PDF-Linker launcher still names the old place (PDF+ rewrites it; a browser cannot)");
  done(`Moved “${r.name}” into ${n.name}${res.moved ? ` (${res.moved} files)` : ""}.${notes.length ? " Note: " + notes.join("; ") + "." : ""}`);
  treeOpen.add(n.key);
  afterMove(r, n);
}
function afterMove(r) {
  downloadsIndexSeen = null;
  treeIndexSeen = null;
  downloadsSeen.delete(r.name);
  caseShown = ""; hearingsShown = ""; treeShown = "";
  renderCaseFolders();
}

/**
 * Point the moved folder's PDF-Linker launcher at its new place: "ok", "none"
 * (no launcher, or one that names no place), "browser" (no PDF+ to say the
 * place), "unknown" (PDF+ could not say it for sure).
 */
async function retargetLauncher(dir, n, name) {
  const run = await import("./viewer/run-request.js");
  let launcher;
  try { launcher = await run.folderLauncher(dir); } catch { launcher = null; }
  if (!launcher || !launcher.token) return "none";
  const native = window.pdfplusNative;
  if (!native || typeof native.folderPath !== "function") return "browser";
  try {
    const fh = await dir.getFileHandle(launcher.name);
    const file = await fh.getFile();
    // The folders from the list's root down to the moved one (n.chain: the
    // root's own folders down to the folder dropped on).
    const now = await native.folderPath({ root: n.root.name, chain: [...n.chain, name], launcher: { name: launcher.name, size: file.size } });
    if (!now) return "unknown";
    const text = moveLib.retargetLauncher(await file.text(), run.folderPathOfToken(launcher.token), now);
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
    return "ok";
  } catch { return "unknown"; }
}

/** Put folders on the folders list (each once): { added: [names], already: [names] }. */
async function addTreeRoots(handles) {
  const roots = await treeRoots();
  const added = [], already = [];
  for (const h of handles) {
    let dup = false;
    for (const x of roots) { try { if (await x.isSameEntry(h)) { dup = true; break; } } catch { /* gone */ } }
    if (dup) { already.push(h.name); continue; }
    roots.push(h);
    added.push(h.name);
  }
  if (added.length) {
    await saveTreeRoots();
    treeIndexSeen = null; treeShown = ""; hearingsShown = "";
    renderCaseFolders();
  }
  return { added, already };
}
const namesSaid = (names) => (names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`);

document.getElementById("tree-add")?.addEventListener("click", async () => {
  let h;
  try { h = await showPicker("showDirectoryPicker", { id: "tree", mode: "readwrite" }); }
  catch (e) { if (e && e.name !== "AbortError") shellToast(String(e.message || e), 5000); return; }
  const { added } = await addTreeRoots([h]);
  if (!added.length) shellToast(`${h.name} is on the list already.`, 4000);
});

// SEVERAL FOLDERS AT ONCE (the owner, 2026-11-18: "Can you make it so that I
// can select multiple folders to add at once? I can't add my entire OneDrive
// folder, because it holds system files, but each of individual folders I
// have are inside of it"). The folder dialog picks one folder, and Chrome
// refuses one holding system folders; but folders dropped on a page come as
// handles (DataTransferItem.getAsFileSystemHandle), as many as were dragged.
// So the folders selected in File Explorer are dropped on the list. The
// handles are asked for at once, in the drop itself, as the API wants; files
// among them are left out.
{
  const panel = document.getElementById("folder-tree");
  const isOsDrop = (e) => !caseDrag && e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
  panel?.addEventListener("dragover", (e) => {
    if (!isOsDrop(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    panel.classList.add("drop-folders");
  });
  panel?.addEventListener("dragleave", (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove("drop-folders"); });
  panel?.addEventListener("drop", async (e) => {
    if (!isOsDrop(e)) return;
    e.preventDefault();
    e.stopPropagation(); // not opened as files by the shell's own drop
    panel.classList.remove("drop-folders");
    document.body.classList.remove("dragging");
    const asks = [...e.dataTransfer.items].filter((it) => it.kind === "file" && typeof it.getAsFileSystemHandle === "function").map((it) => it.getAsFileSystemHandle());
    if (!asks.length) { shellToast("This browser does not hand dropped folders to a page: add them one at a time with + Add.", 6000); return; }
    const got = (await Promise.allSettled(asks)).map((x) => (x.status === "fulfilled" ? x.value : null));
    const dirs = got.filter((h) => h && h.kind === "directory");
    const files = got.filter((h) => h && h.kind === "file").length;
    const refused = got.filter((h) => !h).length;
    const { added, already } = await addTreeRoots(dirs);
    const said = [];
    if (added.length) said.push(`Added ${added.length} folder${added.length === 1 ? "" : "s"}: ${namesSaid(added)}`);
    if (already.length) said.push(`${namesSaid(already)} ${already.length === 1 ? "was" : "were"} on the list already`);
    if (files) said.push(`${files} file${files === 1 ? "" : "s"} left out (only folders go on the list)`);
    if (refused) said.push(`${refused} the browser would not hand over (a folder holding system files)`);
    shellToast(said.join(". ") + ".", 7000);
  });
}

// ---- Home: open the case folder's Word documents ------------------------------
//
// The owner (2026-11-05): "Add a button to open the word document(s) inside
// that case folder to the pdf+ home screen". A page cannot start Word, so the
// button stands only in PDF+, whose main process opens a Word document in
// the program Windows opens it with (desktop/main.js, pdfplus:open-document;
// preload.js reads the file's path). The documents are the folder's own,
// not its subfolders' (case-folders.js, wordDocs). One opens at the click;
// several are listed under the button, each to open, with Open all.
function canOpenWord() {
  return !!(window.pdfplusNative && typeof window.pdfplusNative.openDocument === "function");
}
function wordButton(r) {
  const docs = caseLib.wordDocs(r.listing);
  const box = document.createElement("span");
  box.className = "ci-word";
  const b = document.createElement("button");
  b.className = "ci-word-btn";
  b.title = docs.length === 1 ? `Word: open ${docs[0]}` : `Word: open one or all of the ${docs.length} Word documents in ${r.name}`;
  iconise(b, "file-word", docs.length === 1 ? "Word" : `Word (${docs.length})`, docs.length > 1 ? `<span class="ci-ico-n">${docs.length}</span>` : "");
  b.setAttribute("aria-haspopup", docs.length > 1 ? "menu" : "false");
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    if (docs.length === 1) { openWordDocs(r, docs); return; }
    toggleWordMenu(box, r, docs);
  });
  box.appendChild(b);
  return box;
}
function closeWordMenus() {
  for (const m of document.querySelectorAll(".ci-word-menu")) m.remove();
  for (const b of document.querySelectorAll(".ci-word-btn.open, .ci-claude.open")) b.classList.remove("open");
}
// The list stands on the page, under the button, so the case list's own box
// does not clip it; a scroll or a resize closes it rather than leave it adrift.
function toggleWordMenu(box, r, docs) {
  const btn = box.querySelector(".ci-word-btn");
  const wasOpen = btn.classList.contains("open");
  closeWordMenus();
  if (wasOpen) return;
  const menu = document.createElement("div");
  menu.className = "ci-word-menu";
  menu.setAttribute("role", "menu");
  menu.dataset.folder = r.name;
  const item = (text, names, cls = "") => {
    const x = document.createElement("button");
    x.className = "ci-word-item" + (cls ? " " + cls : "");
    x.setAttribute("role", "menuitem");
    x.textContent = text;
    x.title = names.length === 1 ? `Open ${names[0]} in Word` : `Open all ${names.length} in Word`;
    x.addEventListener("click", (e) => { e.stopPropagation(); closeWordMenus(); openWordDocs(r, names); });
    return x;
  };
  for (const d of docs) menu.appendChild(item(d, [d]));
  menu.appendChild(item(`Open all ${docs.length}`, docs, "ci-word-all"));
  document.body.appendChild(menu);
  const at = btn.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(at.right - w, window.innerWidth - w - 8)) + "px";
  menu.style.top = (at.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, at.top - 4 - h) : at.bottom + 4) + "px";
  btn.classList.add("open");
  setTimeout(() => {
    document.addEventListener("click", closeWordMenus, { once: true });
    window.addEventListener("resize", closeWordMenus, { once: true });
    document.addEventListener("scroll", closeWordMenus, { once: true, capture: true });
  }, 0);
}
// A File read through the folder handle carries no path, so PDF+ is told
// where the folder may be: its place under the Downloads Home lists (the
// handle's own `resolve`), and the folder its PDF-Linker launcher records.
// The desktop opens a document there only where it is this very File.
async function wordDocPlaces(r) {
  const where = { downloads: null, folders: [], folder: r.handle.name };
  try {
    const dl = await downloadsDir();
    const parts = dl ? await dl.resolve(r.handle) : null;
    if (parts && parts.length) where.downloads = parts;
  } catch { /* not under Downloads, or Downloads not readable */ }
  try {
    const lib = await import("./viewer/run-request.js");
    const launcher = await lib.folderLauncher(r.handle);
    const p = launcher && launcher.token ? lib.folderPathOfToken(launcher.token) : "";
    if (p) where.folders.push(p);
  } catch { /* no launcher */ }
  return where;
}
async function openWordDocs(r, names) {
  if (!(await permitted(r.handle, "read", true))) return;
  const failed = [];
  const where = await wordDocPlaces(r);
  for (const name of names) {
    try {
      const file = await (await r.handle.getFileHandle(name)).getFile();
      await window.pdfplusNative.openDocument(file, where);
    } catch (e) {
      failed.push(`${name} (${String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, "")})`);
    }
  }
  if (failed.length) shellToast(`Could not open ${failed.join("; ")}`, 7000);
}

// ---- Home: the log to share --------------------------------------------------
//
// The owner (2026-11-05): "a tool into the homescreen of PDF+ that lets me
// open copy of pdf_linker.log that has all real names removed that is free to
// share for diagnostic purposes". PDF-Linker writes that copy itself, as the
// run goes (its `_SHARE_LOG_FILE`): it knows where in each message it set a
// value, keeps its own wording and takes the values out, so no key is read
// here and nothing is redacted on this side. The button stands on a row whose
// folder holds the file; the copy opens over Home as plain text (never in the
// text reader, which would read it through a key), to copy or save.
function shareLogButton(r) {
  const b = document.createElement("button");
  b.className = "ci-share-log";
  iconise(b, "file-text", "Log to share");
  b.title = `Log to share: open ${caseLib.SHARE_LOG_FILE} for ${r.name}: PDF-Linker's log with every name, file, folder, number and address it was handed taken out, so it can be sent for diagnosis. The real log, pdf_linker.log, stays in the folder.`;
  b.addEventListener("click", (e) => { e.stopPropagation(); showShareLog(r); });
  return b;
}
async function showShareLog(r) {
  let text;
  try {
    if (!(await permitted(r.handle, "read", true))) return;
    const fh = await r.handle.getFileHandle(caseLib.SHARE_LOG_FILE);
    text = await (await fh.getFile()).text();
  } catch (e) {
    shellToast(`${caseLib.SHARE_LOG_FILE} could not be read in ${r.name}: ${(e && e.message) || e}`, 6000);
    return;
  }
  const dlg = document.createElement("dialog");
  dlg.className = "share-log-dialog";
  dlg.innerHTML = `<div class="sl-head"><span class="sl-title"></span><span class="sl-actions"><button class="sl-copy">Copy</button><button class="sl-save">Save…</button><button class="sl-close" aria-label="Close">Close</button></span></div><p class="sl-note"></p><pre class="sl-text"></pre>`;
  dlg.querySelector(".sl-title").textContent = caseLib.SHARE_LOG_FILE;
  dlg.querySelector(".sl-note").textContent = "Every name, file, folder, number and address PDF-Linker was handed is shown as […]. The wording is PDF-Linker's own; lines it cannot place are redacted whole.";
  dlg.querySelector(".sl-text").textContent = text;
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector(".sl-close").addEventListener("click", close);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dlg.querySelector(".sl-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); shellToast("The log to share is on the clipboard.", 2500); }
    catch (e) { shellToast(`Could not copy: ${(e && e.message) || e}`, 5000); }
  });
  dlg.querySelector(".sl-save").addEventListener("click", async () => {
    const blob = new Blob([text], { type: "text/plain" });
    try {
      if (window.showSaveFilePicker) {
        const h = await window.showSaveFilePicker({ suggestedName: caseLib.SHARE_LOG_FILE, types: [{ description: "Text", accept: { "text/plain": [".txt"] } }] });
        const w = await h.createWritable();
        await w.write(blob);
        await w.close();
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = caseLib.SHARE_LOG_FILE;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      }
    } catch (e) {
      if (!e || e.name !== "AbortError") shellToast(`Could not save: ${(e && e.message) || e}`, 5000);
    }
  });
  document.body.appendChild(dlg);
  dlg.showModal();
  const pre = dlg.querySelector(".sl-text");
  pre.scrollTop = pre.scrollHeight; // the newest lines, where a run going is
}

// ---- Home: PDF-Linker's line --------------------------------------------------
//
// The owner (2026-11-04): "indicate the priority order of cases running or to
// be run with PDF Linker. The higher priority indicates that i need it done
// sooner, and it should cut the line for access to cores and whatever other
// processing it needs that is in short supply." Each row can be put in the
// line (Prioritize), moved up or down in it, or taken out; the line is listed
// first, in its order. Each folder's place is written into its own
// PRIORITY_FILE (case-folders.js, "PDF-Linker's line"), which the run reads
// as it goes (PDF-Linker's `_start_run_priority`), so a reorder reaches a run
// already going within its next look (15 s). A case leaves the line when a
// run of it finishes.
// THE LINE IS KEPT HERE, FOR A DAY (the owner, 2026-11-18: "Let's reserve the
// prioritize button for when that run is already going. Once selected have it
// remember that priority for 24 hours so I don't have to keep pressing it (but
// I can update it manually later)"). PDF-Linker spends a place when a run of
// the folder finishes: it removes the file, and reads one older than the
// folder's newest DONE stamp as none (`_run_priority_read`). So the line is
// Home's own, in the folders database (`places` → "priorityLine": the folders
// in order, each with the time it was put in line), and each look writes every
// folder's file to say its place where it does not (`syncLine`), stamped now,
// so a re-run within the day is in line again from its start. A place lasts
// PRIORITY_KEEP_MS from when it was given; then it is dropped and its file
// removed. ▲ ▼ ✕ change it at any time; Prioritize is offered only on a run
// going, where it does something now. A file a Home before this wrote (or
// another window) is taken into the line as it stands.
const PRIORITY_KEEP_MS = 24 * 3600000;
let prioLine = null;  // [{ name, handle, at }], first first
let prioTotal = 0;    // places in line, as last looked at
let lineShown = [];   // the rows in line, first first, as last looked at
let rowsShown = [];   // every row listed, as last looked at
let lineBusy = false;
async function prioAll() {
  if (!prioLine) {
    try { prioLine = ((await foldersTx("places", "readonly", (st) => st.get("priorityLine"))) || []).filter((e) => e && e.handle && e.handle.kind === "directory"); }
    catch { prioLine = []; }
  }
  return prioLine;
}
async function prioSave() {
  try { await foldersTx("places", "readwrite", (st) => st.put(prioLine, "priorityLine")); } catch { /* kept for this session */ }
}
async function prioIndex(list, handle, name) {
  for (const [i, e] of list.entries()) {
    if (name && e.name !== name) continue;
    try { if (await e.handle.isSameEntry(handle)) return i; } catch { /* gone */ }
  }
  return -1;
}
async function dropPlaceFile(handle) {
  try { await handle.removeEntry(caseLib.PRIORITY_FILE); } catch { /* none, or not ours to remove */ }
}
/** The line this look: expired places dropped, files a run spent written again, each row's rank set. */
async function syncLine(rows, now) {
  const list = await prioAll();
  let changed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    if (now - list[i].at <= PRIORITY_KEEP_MS) continue;
    if (await permitted(list[i].handle, "readwrite", false)) await dropPlaceFile(list[i].handle);
    list.splice(i, 1);
    changed = true;
  }
  // Places on disk Home does not hold yet, in their own order.
  const adopt = [];
  for (const r of rows) {
    if (!r.listing || r.locked || caseLib.liveRank(r.listing) <= 0) continue;
    if ((await prioIndex(list, r.handle, r.name)) >= 0) continue;
    const set = r.listing.priority ? r.listing.priority.set : now;
    if (now - set > PRIORITY_KEEP_MS) continue;
    adopt.push({ name: r.name, handle: r.handle, at: set, rank: caseLib.liveRank(r.listing) });
  }
  for (const a of adopt.sort((x, y) => x.rank - y.rank)) { list.push({ name: a.name, handle: a.handle, at: a.at }); changed = true; }
  for (const r of rows) {
    const i = r.locked ? -1 : await prioIndex(list, r.handle, r.name);
    r.rank = i >= 0 ? i + 1 : 0;
  }
  // Each folder's file says its place: written where it does not (a run
  // spent it, or the line moved). A look asks nothing: only where Home may
  // already write.
  if (!lineBusy) {
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!(await permitted(e.handle, "readwrite", false))) continue;
      let row = null;
      for (const r of rows) { if (r.name === e.name) { try { if (await r.handle.isSameEntry(e.handle)) { row = r; break; } } catch { /* gone */ } } }
      let listing = row && row.listing;
      if (!listing) {
        try { listing = await readListing(e.handle); }
        catch (x) { if (x && x.name === "NotFoundError") { list.splice(i, 1); changed = true; } continue; }
      }
      if (caseLib.liveRank(listing) === i + 1) continue;
      try {
        const w = await (await e.handle.getFileHandle(caseLib.PRIORITY_FILE, { create: true })).createWritable();
        await w.write(caseLib.priorityText(i + 1, now));
        await w.close();
        downloadsSeen.delete(e.name);
      } catch { /* written on a later look */ }
    }
    // A removal above moves the places behind it up: the next look writes them.
  }
  prioTotal = list.length;
  if (changed) await prioSave();
  return list;
}
function lineControls(r) {
  const box = document.createElement("span");
  const place = r.rank || 0;
  const total = prioTotal;
  const btn = (cls, text, label, op, disabled = false) => {
    const x = document.createElement("button");
    x.className = cls;
    x.textContent = text;
    x.title = label;
    x.setAttribute("aria-label", label);
    x.disabled = disabled;
    x.addEventListener("click", (e) => { e.stopPropagation(); changeLineFor(r, op); });
    return x;
  };
  if (!place) {
    box.className = "ci-line";
    // Only on a run going: it is the run that the place serves now.
    if (!(r.status && /^(running|starting|stalled)$/.test(r.status.state))) return box;
    const behind = total ? `, behind the ${total} case${total === 1 ? "" : "s"} already in it` : "";
    box.appendChild(iconise(btn("ci-line-add", "", `Prioritize: put ${r.name} in PDF-Linker's line${behind}: while it runs, its OCR takes the cores ahead of every run behind it, and those runs drop to below-normal CPU priority. It keeps its place for 24 hours, through any re-run, unless you move it or take it out.`, "add", total >= caseLib.RANK_MAX), "chevrons-up", "Prioritize"));
    return box;
  }
  box.className = "ci-line in-line";
  const tag = document.createElement("span");
  tag.className = "ci-place";
  tag.textContent = caseLib.ordinal(place);
  tag.title = caseLib.lineTitle(place, r.name);
  box.appendChild(tag);
  box.appendChild(btn("ci-line-btn", "▲", `Move ${r.name} up in PDF-Linker's line`, "up", place === 1));
  box.appendChild(btn("ci-line-btn", "▼", `Move ${r.name} down in PDF-Linker's line`, "down", place === total));
  box.appendChild(btn("ci-line-btn", "✕", `Take ${r.name} out of PDF-Linker's line`, "remove"));
  return box;
}
async function changeLineFor(r, op) {
  if (lineBusy) return;
  // Asked first, while the click still counts as one (PDF+ grants it).
  if (!(await permitted(r.handle, "readwrite", true))) { shellToast(`The line was not changed: PDF+ may not write into ${r.name}.`, 6000); return; }
  lineBusy = true;
  try {
    const list = await prioAll();
    const i = await prioIndex(list, r.handle, r.name);
    if (op === "add") { if (i < 0 && list.length < caseLib.RANK_MAX) list.push({ name: r.name, handle: r.handle, at: Date.now() }); }
    else if (i < 0) return;
    else if (op === "remove") { list.splice(i, 1); await dropPlaceFile(r.handle); downloadsSeen.delete(r.name); }
    else if (op === "up" && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    else if (op === "down" && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
    await prioSave();
    caseShown = ""; hearingsShown = "";
  } finally {
    lineBusy = false;
    renderCaseFolders();
  }
}

// ---- Home: take over a run that stopped part-way -----------------------------
//
// The owner (2026-11-04): "an easy way to do a takeover run in pdf linker when
// the previous run is hung, as evidenced by the stopped part way check in
// pdf+'s home screen". PDF-Linker's own launchers never take over (a second
// double-click on a folder in flight is more often a misclick than a
// decision, and it costs the run its file and its pre-scan), so a stuck run
// was ended only by the command line pdf_linker.log names. Here the button
// stands only on a row Home already reads as stopped part-way (folderStatus's
// "stalled": nothing written for RUN_STALE_MS and past its projected finish),
// and asks a second click before it acts. It goes the way the reader's Re-run
// goes (run-request.js; textdoc.js, "THE RE-RUN BUTTON"): the folder's
// launcher's `pdf-linker:` link, then the request file, saying "takeover" in
// place of "go". PDF-Linker (`_serve_reader_request`) ends the run still
// holding the folder, unless the run has written its ETA marker or log in the
// last ten minutes, and starts the folder's Re-run PDF-Linker. The row then
// says "Taken over" until the new run's ETA is there (withRunStart).
const TAKEOVER_ARM_MS = 6000;     // the second click must come this soon
const TAKEOVER_PICKUP_MS = 90000; // PDF-Linker has this long to take the request
let takingOver = false;
let openingAppLink = false;       // the beforeunload guard stands aside for the link
function takeOverButton(r) {
  const t = document.createElement("button");
  t.className = "ci-takeover";
  t.textContent = "Take over";
  t.title = `End the PDF-Linker run that seems stuck on ${r.name} and start it again from the folder's Re-run PDF-Linker. What it finished stays done; the file it was on is redone.`;
  t.addEventListener("click", (e) => { e.stopPropagation(); takeOverRun(r, t); });
  return t;
}
function disarm(btn) {
  clearTimeout(btn._armT);
  delete btn.dataset.armed;
  btn.classList.remove("armed");
  btn.textContent = "Take over";
}
/** Open an outside program's link (pdf-linker:) without leaving Home. */
function openAppLink(url) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  a.hidden = true;
  document.body.appendChild(a);
  openingAppLink = true;
  try { a.click(); } finally {
    a.remove();
    setTimeout(() => { openingAppLink = false; }, 1000);
  }
}
async function takeOverRun(r, btn) {
  if (takingOver) return;
  const dir = r.handle;
  if (!btn.dataset.armed) {
    // The leave to write into the folder is asked on the first click, so the
    // second still counts as a click: Chrome opens an outside program only on one.
    if (!(await permitted(dir, "readwrite", true))) { shellToast(`Not taken over: PDF+ may not write into ${r.name}.`, 6000); return; }
    btn.dataset.armed = "1";
    btn.classList.add("armed");
    btn.textContent = "Click again to end it";
    btn._armT = setTimeout(() => disarm(btn), TAKEOVER_ARM_MS);
    return;
  }
  disarm(btn);
  takingOver = true;
  try {
    const lib = await import("./viewer/run-request.js");
    const TD = await import("./viewer/textdoc.js");
    // Looked at afresh: a run that has written since the last look is alive.
    let st = null;
    try { st = caseLib.folderStatus(await readListing(dir), Date.now()); } catch { st = null; }
    if (!st || st.state !== "stalled") {
      shellToast(`${r.name} no longer looks stopped part-way, so nothing was ended.`, 6000);
      renderCaseFolders();
      return;
    }
    const launcher = await lib.folderLauncher(dir);
    if (!launcher) { shellToast(`${r.name} has no Re-run PDF-Linker launcher, so PDF+ cannot reach PDF-Linker for it. pdf_linker.log in the folder names the command line that takes the run over.`, 12000); return; }
    if (!launcher.token) {
      shellToast(`${launcher.name} in ${r.name} was written by a PDF-Linker from before the Re-run button, so it does not say where the folder is. pdf_linker.log in the folder names the command line that takes the run over.`, 12000);
      return;
    }
    const nonce = crypto.randomUUID();
    openAppLink(TD.rerunUrl(launcher.token, dir.name, nonce));
    try { await lib.writeRunRequest(dir, nonce, "takeover"); }
    catch (e) { shellToast(`Not taken over: PDF+ could not write ${TD.RUN_REQUEST_FILE} into ${r.name} (${e.message || e}).`, 9000); return; }
    shellToast(`Asking PDF-Linker to take over ${r.name} — if the browser asks whether to open PDF-Linker, say Open.`, TAKEOVER_PICKUP_MS);
    const taken = await lib.awaitPickup(dir, TAKEOVER_PICKUP_MS);
    if (!taken) {
      shellToast(`PDF-Linker did not answer, so nothing was ended. If this computer has not been set up for the Re-run button, double-click Register Reader Button.bat in the PDF-Linker folder once; pdf_linker.log in ${r.name} names the command line that takes the run over by hand.`, 15000);
      return;
    }
    for (let i = runsStarted.length - 1; i >= 0; i--) {
      try { if (runsStarted[i].name === dir.name && (await runsStarted[i].handle.isSameEntry(dir))) runsStarted.splice(i, 1); } catch { /* gone */ }
    }
    runsStarted.push({ handle: dir, name: dir.name, at: Date.now(), how: "takeover" });
    shellToast(`PDF-Linker is taking over ${r.name}: it ends the stuck run and starts Re-run PDF-Linker. pdf_linker.log says what it did.`, 9000);
    renderCaseFolders();
  } finally {
    takingOver = false;
  }
}
function scheduleCaseRecheck() {
  clearTimeout(caseTimer);
  caseTimer = 0;
  if (dropzone.hidden || document.visibilityState !== "visible") return;
  caseTimer = setTimeout(renderCaseFolders, runsStarted.length ? RUN_START_RECHECK_MS : CASE_RECHECK_MS);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !dropzone.hidden) renderCaseFolders(); });
window.addEventListener("focus", () => { if (!dropzone.hidden) renderCaseFolders(); });

document.getElementById("case-downloads")?.addEventListener("click", async () => {
  const dl = await downloadsDir();
  // Linked but not readable this session: the leave is asked again. Refused
  // (or the folder gone), the dialog follows, to link it afresh.
  if (dl && !(await permitted(dl, "read", false)) && (await permitted(dl, "read", true))) { renderCaseFolders(); return; }
  let h;
  try { h = await showPicker("showDirectoryPicker", { id: "downloads", startIn: dl || "downloads", mode: "read" }); }
  catch (e) { if (e && e.name !== "AbortError") shellToast(String(e.message || e), 5000); return; }
  try { await foldersTx("places", "readwrite", (s) => s.put(h, "downloads")); }
  catch { shellToast("The Downloads folder could not be kept: this browser is not storing anything for the app.", 6000); return; }
  downloadsSeen.clear();
  renderCaseFolders();
});
document.getElementById("case-clear")?.addEventListener("click", async () => {
  // A folder in PDF-Linker's line stays listed: it could not be moved or
  // taken out of the line from here once it was forgotten.
  if (!caseLib) caseLib = await import("./viewer/case-folders.js");
  const forget = [];
  const line = await prioAll();
  for (const r of await foldersAll()) {
    if ((await prioIndex(line, r.handle, r.name)) < 0) forget.push(r.key);
  }
  try { await foldersTx("folders", "readwrite", (s) => { for (const k of forget) s.delete(k); }); } catch { /* ok */ }
  renderCaseFolders();
});
// Every window of the app hears what a reader in any of them says of its
// folder: a case opened from Home reads in a window of its own, and Home,
// in the hub's window, says the re-run started and the folder opened.
let shellChannel = null;
try { shellChannel = new BroadcastChannel("pdfplus-shell"); } catch { shellChannel = null; }
function relay(msg) { try { shellChannel && shellChannel.postMessage(msg); } catch { /* not cloneable here: this window's own Home has it */ } }
shellChannel?.addEventListener("message", async (e) => {
  const d = e.data || {};
  if (d.type === "run" && d.dir && d.dir.kind === "directory") {
    for (let i = runsStarted.length - 1; i >= 0; i--) {
      try { if (runsStarted[i].name === d.dir.name && (await runsStarted[i].handle.isSameEntry(d.dir))) runsStarted.splice(i, 1); } catch { /* gone */ }
    }
    runsStarted.push({ handle: d.dir, name: d.dir.name, at: d.at || Date.now(), how: d.how || "rerun" });
  }
  if ((d.type === "run" || d.type === "folder") && !dropzone.hidden) renderCaseFolders();
});

// A reader's Re-run PDF-Linker has started the run (text-reader.js,
// rerunLinker): said on Home at once, ahead of the ETA marker PDF-Linker
// writes once it is under way.
window.addEventListener("message", async (e) => {
  if (e.origin !== location.origin || !e.data || e.data.type !== "textreader:run") return;
  if (!tabs.some((t) => t.text && t.iframe.contentWindow === e.source)) return;
  const dir = e.data.dir;
  if (!dir || dir.kind !== "directory") return;
  for (let i = runsStarted.length - 1; i >= 0; i--) {
    try { if (runsStarted[i].name === dir.name && (await runsStarted[i].handle.isSameEntry(dir))) runsStarted.splice(i, 1); } catch { /* gone */ }
  }
  const at = Date.now();
  runsStarted.push({ handle: dir, name: dir.name, at, how: "rerun" });
  relay({ type: "run", dir, at, how: "rerun" });
  if (!dropzone.hidden) renderCaseFolders();
});
// A reader tab says which case folder it attached, however it came to it.
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data || e.data.type !== "textreader:folder") return;
  if (!tabs.some((t) => t.text && t.iframe.contentWindow === e.source)) return;
  rememberFolder(e.data.dir).then(() => relay({ type: "folder" }));
});

// Light or dark: Home's own ☀/🌙 (the owner, 2026-11-20: "How do I switch
// between light and dark mode?" ... "yes, add it to home"), the same choice as
// the viewer's toggle (localStorage "pdfViewerTheme"), so either one switches
// Home, every tab and every window (same-origin storage events).
const homeThemeBtn = document.getElementById("home-theme");
function applyHomeTheme(theme) {
  const light = theme === "light";
  document.documentElement.setAttribute("data-theme", light ? "light" : "dark");
  if (homeThemeBtn) {
    homeThemeBtn.innerHTML = icon(light ? "moon" : "sun", { size: 17 });
    homeThemeBtn.title = light ? "Switch to dark mode" : "Switch to light mode";
  }
}
let homeTheme = "dark";
try { if (localStorage.getItem("pdfViewerTheme") === "light") homeTheme = "light"; } catch { /* ok */ }
applyHomeTheme(homeTheme);
homeThemeBtn?.addEventListener("click", () => {
  homeTheme = homeTheme === "light" ? "dark" : "light";
  applyHomeTheme(homeTheme);
  try { localStorage.setItem("pdfViewerTheme", homeTheme); } catch { /* ok */ }
  // A tab's page hears a storage event only from another document: Home is
  // one, so every viewer and reader tab hears this one.
});
window.addEventListener("storage", (e) => {
  if (e.key !== "pdfViewerTheme") return;
  homeTheme = e.newValue === "light" ? "light" : "dark";
  applyHomeTheme(homeTheme);
});

// Unsaved work: a tab says so with a dot, and closing the window asks first.
setInterval(() => {
  for (const t of tabs) t.btn.classList.toggle("dirty", tabHasUnsaved(t));
}, 1500);
window.addEventListener("beforeunload", (e) => {
  if (openingAppLink) return; // a pdf-linker: link, which leaves Home where it is (takeOverRun)
  if (tabs.some(tabHasUnsaved)) { e.preventDefault(); e.returnValue = ""; }
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "o" || e.key === "O")) { e.preventDefault(); pickFiles(); }
});
document.addEventListener("keydown", newWindowKey);

hydrateIcons();
updateChrome();

// Service worker: installability, offline, and auto-update when online.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW registration failed:", e));
  });
}
