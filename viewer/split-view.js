// split-view.js
//
// Side by side: a second PDF beside the one on screen, each in a viewer of
// its own. The viewer's ⫴ Side by side button (viewer.js) asks its host for
// one; the host is whatever page holds the viewer in a frame:
//
//   • the text reader's 📑 PDF mode (text-reader.js), whose frames are the
//     case folder's PDFs — the second PDF can be any of them, or any file;
//   • the app's tab (pwa/app-web.js), a split per tab — another open tab's
//     PDF, or any file;
//   • split.html, for the extension, whose viewer is a page of its own with
//     no host: the button moves it there (split.js), at the same address.
//
// WHY A SECOND VIEWER, NOT A SECOND DOCUMENT IN ONE. The viewer owns its
// window: the toolbar and panels are position: fixed, the window scrolls, and
// fit width, page turns and the overlays all read the window's own size. A
// viewer narrowed to half the window has to BE half a window, so each side is
// viewer.html in a frame, with every tool, its own Save and its own unsaved
// changes, and the host lays the two frames out. Nothing in the viewer knows
// it is one of two except the button's state (__pdfViewerSplitShown).
//
// THE LAYOUT. The host names a `scope`: the element whose frames are the
// left side (PDF mode's stage, whose every frame is a PDF of the folder; the
// app's tab frame itself; split.html's one frame). It wears pdf-split-on and
// --pdf-split-at, and the CSS below narrows its frames to the left of the
// divider. The second frame and the divider are added to `stage`, the
// positioned box the frames fill. The divider drags (double-click: halves),
// and where it was left is kept for next time.
//
// SCROLL TOGETHER. Off by default; the link button on the divider turns it on
// for both directions. A scroll of one side moves the other by as much, in
// pages rather than pixels: by the ratio of the two pages at mid-screen, so
// two documents at different zooms keep page for page. A scroll this moved is
// recognized when it comes back (`expect`) and not passed on again. PDF mode
// changing the PDF on the left is a new starting point, not a scroll.
//
// CHOOSING. The button opens the side at once with a card in it: the host's
// `choices` (PDF mode: the folder's PDFs; the app: its other tabs) and Open a
// PDF…, which asks for a file. The card comes back from the divider's folder
// button to put another PDF there.

import { icon } from "./icons.js";

const VIEWER_SRC = new URL("viewer.html", import.meta.url).href;
const AT_KEY = "pdfSplitAt";
const AT_MIN = 0.2, AT_MAX = 0.8;
const GAP = 6;  // the divider's width, px

const CSS = `
.pdf-split-on > iframe:not(.pdf-split-second), iframe.pdf-split-on {
  right: auto !important; width: calc(var(--pdf-split-at, 50%) - ${GAP / 2}px) !important;
}
.pdf-split-second, .pdf-split-pick {
  position: absolute !important; top: 0 !important; bottom: 0 !important; right: 0 !important;
  left: calc(var(--pdf-split-at, 50%) + ${GAP / 2}px) !important;
  /* A frame, like any replaced box, does not stretch between left and right:
     its width and height are given. */
  width: calc(100% - var(--pdf-split-at, 50%) - ${GAP / 2}px) !important; height: 100% !important;
  border: 0; margin: 0; box-sizing: border-box;
}
.pdf-split-second { display: block !important; z-index: 1; visibility: visible; pointer-events: auto; }
.pdf-split-pick { z-index: 3; display: flex; align-items: flex-start; justify-content: center; overflow: auto;
  padding: 72px 20px 20px; background: #16181c; color: #e6e8eb; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
.pdf-split-pick[hidden] { display: none !important; }
.pdf-split-card { width: min(440px, 100%); background: #1f2329; border: 1px solid #343a43; border-radius: 12px;
  padding: 18px; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
.pdf-split-card h2 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
.pdf-split-card p { margin: 0 0 14px; color: #a7adb6; }
.pdf-split-card h3 { margin: 12px 0 6px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #a7adb6; }
.pdf-split-list { display: flex; flex-direction: column; gap: 2px; max-height: 46vh; overflow: auto; margin-bottom: 14px; }
.pdf-split-list button { display: flex; align-items: center; gap: 8px; text-align: left; padding: 7px 9px; border: 0; border-radius: 7px;
  background: transparent; color: inherit; font: inherit; cursor: pointer; }
.pdf-split-list button:hover, .pdf-split-list button:focus-visible { background: rgba(255,255,255,.08); outline: none; }
.pdf-split-list button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pdf-split-list button small { margin-left: auto; color: #a7adb6; flex: none; }
.pdf-split-actions { display: flex; gap: 8px; justify-content: flex-end; }
.pdf-split-actions button { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 8px;
  border: 1px solid #3a414b; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.pdf-split-actions button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.pdf-split-bar { position: absolute; top: 0; bottom: 0; z-index: 4; width: ${GAP}px;
  left: calc(var(--pdf-split-at, 50%) - ${GAP / 2}px); cursor: col-resize; touch-action: none; background: #2a2e35; }
.pdf-split-bar:hover, .pdf-split-dragging .pdf-split-bar { background: #2563eb; }
.pdf-split-tools { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column;
  gap: 2px; padding: 3px; border-radius: 16px; background: #1f2329; border: 1px solid #3a414b; box-shadow: 0 4px 14px rgba(0,0,0,.35); cursor: default; }
.pdf-split-tools button { width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%; display: grid; place-items: center;
  background: transparent; color: #e6e8eb; cursor: pointer; }
.pdf-split-tools button:hover { background: rgba(255,255,255,.12); }
.pdf-split-tools button[aria-pressed="true"] { background: #2563eb; color: #fff; }
.pdf-split-away { visibility: hidden !important; pointer-events: none !important; }
.pdf-split-dragging iframe { pointer-events: none !important; }
:root[data-theme="light"] .pdf-split-pick { background: #eef0f3; color: #1b1f24; }
:root[data-theme="light"] .pdf-split-card { background: #fff; border-color: #d5d9e0; box-shadow: 0 10px 30px rgba(16,24,40,.14); }
:root[data-theme="light"] .pdf-split-card p, :root[data-theme="light"] .pdf-split-card h3,
:root[data-theme="light"] .pdf-split-list button small { color: #5b6470; }
:root[data-theme="light"] .pdf-split-list button:hover, :root[data-theme="light"] .pdf-split-list button:focus-visible { background: rgba(16,24,40,.06); }
:root[data-theme="light"] .pdf-split-actions button { border-color: #d5d9e0; }
:root[data-theme="light"] .pdf-split-actions button.primary { border-color: #2563eb; }
:root[data-theme="light"] .pdf-split-bar { background: #d5d9e0; }
:root[data-theme="light"] .pdf-split-bar:hover, :root[data-theme="light"] .pdf-split-dragging .pdf-split-bar { background: #2563eb; }
:root[data-theme="light"] .pdf-split-tools { background: #fff; border-color: #d5d9e0; box-shadow: 0 4px 14px rgba(16,24,40,.14); }
:root[data-theme="light"] .pdf-split-tools button { color: #1b1f24; }
:root[data-theme="light"] .pdf-split-tools button:hover { background: rgba(16,24,40,.08); }
:root[data-theme="light"] .pdf-split-tools button[aria-pressed="true"] { background: #2563eb; color: #fff; }
`;

function addStyle(doc) {
  if (doc.getElementById("pdf-split-style")) return;
  const s = doc.createElement("style");
  s.id = "pdf-split-style";
  s.textContent = CSS;
  doc.head.appendChild(s);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const label = (name) => String(name || "PDF").replace(/\.pdf$/i, "");
const clampAt = (v) => Math.min(AT_MAX, Math.max(AT_MIN, Number.isFinite(v) ? v : 0.5));
function savedAt() {
  try { return clampAt(parseFloat(localStorage.getItem(AT_KEY))); } catch { return 0.5; }
}

/**
 * A side-by-side split for one host.
 *   stage    the positioned box the viewer frames fill; the second frame, the
 *            divider and the card are added to it
 *   scope    the element whose frames are the left side (default: stage)
 *   primary  () → the Window of the viewer on the left
 *   choices  () → [{ name, file?, handle?, note? }] offered on the card
 *   choicesLabel  the card's heading over them
 *   wire     (w) → the host's own hooks on the second viewer's window
 *   onLoad   (src, file) → told what the second viewer has just opened
 *   onChange (open) → told when the side opens or closes
 */
export function createSplit({ stage, scope = stage, primary, choices = () => [], choicesLabel = "Open", wire = null, onLoad = null, onChange = null }) {
  const doc = stage.ownerDocument;
  const win = doc.defaultView;
  addStyle(doc);

  let open = false;
  let visible = true;
  let at = savedAt();
  let linked = false;
  let frame = null;      // the second viewer
  let ready = null;      // …its load
  let shown = null;      // what it shows: { name, file?, handle? }
  let bar = null, pick = null, linkBtn = null;
  const attached = new Set();            // viewer windows told of the state
  const last = new WeakMap();            // window → its last scrollY
  const expect = new WeakMap();          // window → the scrollY this moved it to
  let lastLeft = null;

  function applyAt() {
    const v = `${(at * 100).toFixed(3)}%`;
    for (const el of [scope, frame, bar, pick]) if (el) el.style.setProperty("--pdf-split-at", v);
  }
  function applyShown() {
    const on = open && visible;
    scope.classList.toggle("pdf-split-on", on);
    for (const el of [frame, bar, pick]) if (el) el.classList.toggle("pdf-split-away", !on);
  }
  function notify() {
    for (const w of [...attached]) {
      if (w.closed) { attached.delete(w); continue; }
      try { w.__pdfViewerSplitShown && w.__pdfViewerSplitShown(open, w === secondWin()); } catch { attached.delete(w); }
    }
    if (onChange) { try { onChange(open); } catch { /* the host's */ } }
  }
  function secondWin() {
    try { return frame ? frame.contentWindow : null; } catch { return null; }
  }

  // ── the divider ──
  function makeBar() {
    bar = doc.createElement("div");
    bar.className = "pdf-split-bar";
    bar.title = "Drag to make one side wider; double-click to halve";
    const tools = doc.createElement("div");
    tools.className = "pdf-split-tools";
    const btn = (name, title, fn) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.title = title;
      b.setAttribute("aria-label", title);
      b.innerHTML = icon(name, { size: 15 });
      b.addEventListener("click", (e) => { e.stopPropagation(); fn(b); });
      tools.appendChild(b);
      return b;
    };
    linkBtn = btn("link", "Scroll together — scrolling one side scrolls the other, page for page", () => setLinked(!linked));
    linkBtn.setAttribute("aria-pressed", String(linked));
    btn("folder", "Show another PDF on the right", () => showCard());
    btn("x", "Close side by side", () => close());
    tools.addEventListener("pointerdown", (e) => e.stopPropagation());
    tools.addEventListener("dblclick", (e) => e.stopPropagation());
    bar.appendChild(tools);
    bar.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      stage.classList.add("pdf-split-dragging");
      const r = stage.getBoundingClientRect();
      const move = (ev) => { at = clampAt((ev.clientX - r.left) / (r.width || 1)); applyAt(); };
      const done = () => {
        stage.classList.remove("pdf-split-dragging");
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", done);
        bar.removeEventListener("pointercancel", done);
        try { localStorage.setItem(AT_KEY, String(at)); } catch { /* not kept */ }
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", done);
      bar.addEventListener("pointercancel", done);
    });
    bar.addEventListener("dblclick", () => {
      at = 0.5;
      applyAt();
      try { localStorage.setItem(AT_KEY, "0.5"); } catch { /* not kept */ }
    });
    stage.appendChild(bar);
  }

  // ── the card: what to show on the right ──
  function showCard() {
    if (!pick) {
      pick = doc.createElement("div");
      pick.className = "pdf-split-pick";
      pick.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelCard(); }
      });
      stage.appendChild(pick);
    }
    pick.innerHTML = "";
    const card = doc.createElement("div");
    card.className = "pdf-split-card";
    const h = doc.createElement("h2");
    h.textContent = "Side by side";
    const p = doc.createElement("p");
    let leftName = "";
    try { leftName = (primary() && primary().document.title || "").replace(/\s*[—-]\s*PDF Viewer\s*$/, "").trim(); } catch { leftName = ""; }
    p.textContent = leftName && leftName !== "PDF Viewer" ? `Choose the PDF to show beside “${leftName}”.` : "Choose the PDF to show on this side.";
    card.append(h, p);
    let list = [];
    try { list = choices() || []; } catch { list = []; }
    if (list.length) {
      const h3 = doc.createElement("h3");
      h3.textContent = choicesLabel;
      const ul = doc.createElement("div");
      ul.className = "pdf-split-list";
      for (const c of list) {
        const b = doc.createElement("button");
        b.type = "button";
        b.innerHTML = icon("file-text", { size: 15 });
        const s = doc.createElement("span");
        s.textContent = label(c.name);
        b.appendChild(s);
        if (c.note) { const sm = doc.createElement("small"); sm.textContent = c.note; b.appendChild(sm); }
        b.title = c.name;
        b.addEventListener("click", () => load(c));
        ul.appendChild(b);
      }
      card.append(h3, ul);
    }
    const actions = doc.createElement("div");
    actions.className = "pdf-split-actions";
    const cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.textContent = frame ? "Cancel" : "Close";
    cancel.addEventListener("click", cancelCard);
    const other = doc.createElement("button");
    other.type = "button";
    other.className = "primary";
    other.innerHTML = `${icon("folder", { size: 15 })}<span>Open a PDF…</span>`;
    other.addEventListener("click", async () => {
      const src = await pickFile();
      if (src) load(src);
    });
    actions.append(cancel, other);
    card.appendChild(actions);
    pick.appendChild(card);
    pick.hidden = false;
    applyAt();
    applyShown();
    const first = card.querySelector(".pdf-split-list button") || other;
    try { first.focus(); } catch { /* ok */ }
  }
  function hideCard() { if (pick) pick.hidden = true; }
  function cancelCard() {
    if (frame) { hideCard(); try { frame.focus(); } catch { /* ok */ } }
    else close();
  }

  // A file from the user: a handle where the browser gives one, so the
  // viewer's Save writes it in place; a plain File where it does not.
  function pickFile() {
    if (win.showOpenFilePicker) {
      return win.showOpenFilePicker({ types: [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }] })
        .then(([h]) => (h ? { name: h.name, handle: h } : null))
        .catch((e) => (e && e.name === "AbortError" ? null : inputFile()));
    }
    return inputFile();
  }
  function inputFile() {
    return new Promise((resolve) => {
      const input = doc.createElement("input");
      input.type = "file";
      input.accept = "application/pdf,.pdf";
      input.addEventListener("change", () => { const f = input.files && input.files[0]; resolve(f ? { name: f.name, file: f } : null); });
      input.addEventListener("cancel", () => resolve(null));
      input.click();
    });
  }

  // ── the second viewer ──
  function makeFrame() {
    frame = doc.createElement("iframe");
    frame.className = "pdf-split-second";
    frame.title = "Side by side";
    frame.src = VIEWER_SRC;
    stage.appendChild(frame);
    const f = frame;
    ready = (async () => {
      await new Promise((res) => f.addEventListener("load", res, { once: true }));
      const w = f.contentWindow;
      for (let t = 0; typeof w.__pdfViewerLoadLocal !== "function"; t++) {
        if (t > 400) throw new Error("the viewer did not start");
        await sleep(50);
      }
      attach(w);
      if (wire) { try { wire(w); } catch { /* the host's */ } }
      return w;
    })();
    applyAt();
    applyShown();
  }

  async function load(src) {
    if (frame && hasUnsaved() && !win.confirm(`“${label(shown && shown.name)}” has changes that are not saved. Show another PDF in its place anyway?`)) return false;
    if (!frame) makeFrame();
    hideCard();
    let w;
    try {
      w = await ready;
      const file = src.file || (src.handle && (await src.handle.getFile()));
      if (!file) throw new Error(`could not read ${src.name}`);
      try { w.__pdfViewerUnregister && w.__pdfViewerUnregister(); } catch { /* ok */ }
      shown = { name: src.name || file.name, file: src.handle ? null : file, handle: src.handle || null };
      await w.__pdfViewerLoadLocal(file, src.handle || null);
      if (onLoad) { try { onLoad(shown, file); } catch { /* the host's */ } }
    } catch (e) {
      win.alert(`Could not open ${src.name || "the PDF"} side by side: ${e.message || e}`);
      if (!shown) close({ force: true });
      return false;
    }
    try { frame.focus(); w.focus(); } catch { /* ok */ }
    return true;
  }

  // ── scrolling together ──
  function pageHeight(w) {
    try {
      const d = w.document;
      const at = d.elementFromPoint(w.innerWidth / 2, w.innerHeight / 2);
      const page = (at && at.closest && at.closest(".page-wrapper")) || d.querySelector(".page-wrapper");
      return page ? page.getBoundingClientRect().height : 0;
    } catch { return 0; }
  }
  function onScroll(w) {
    const y = w.scrollY;
    const prev = last.get(w);
    last.set(w, y);
    if (expect.has(w)) {
      const want = expect.get(w);
      expect.delete(w);
      if (Math.abs(want - y) < 2) return;
    }
    if (!linked || !open || !visible || prev == null) return;
    let left = null;
    try { left = primary(); } catch { left = null; }
    const right = secondWin();
    const other = w === left ? right : w === right ? left : null;
    if (!other) return;
    // PDF mode brought another PDF up on the left: where it lands is a
    // starting point, not a scroll to pass on.
    if (left !== lastLeft) { lastLeft = left; return; }
    const dy = y - prev;
    if (!dy) return;
    const hw = pageHeight(w), ho = pageHeight(other);
    const k = hw > 0 && ho > 0 ? ho / hw : 1;
    const before = other.scrollY;
    other.scrollTo({ top: before + dy * k, behavior: "instant" });
    const got = other.scrollY;
    if (Math.abs(got - before) >= 1) expect.set(other, got);
    last.set(other, got);
  }
  function setLinked(on) {
    linked = !!on;
    if (linkBtn) linkBtn.setAttribute("aria-pressed", String(linked));
    try { lastLeft = primary(); } catch { lastLeft = null; }
    for (const w of [lastLeft, secondWin()]) if (w) { try { last.set(w, w.scrollY); } catch { /* gone */ } }
  }

  // ── the host's side ──
  /** A viewer of this host: its ⫴ button asks here, and it is told the state. */
  function attach(w) {
    if (!w || attached.has(w)) return;
    attached.add(w);
    w.__pdfSplitHost = { toggle: () => toggle(), isOpen: () => open };
    try { w.addEventListener("scroll", () => onScroll(w), { passive: true }); } catch { /* gone */ }
    try { w.__pdfViewerSplitShown && w.__pdfViewerSplitShown(open, w === secondWin()); } catch { /* not started */ }
  }
  function begin() {
    if (open) return;
    open = true;
    at = savedAt();
    if (!bar) makeBar();
    applyAt();
    applyShown();
    notify();
    showCard();
  }
  function hasUnsaved() {
    const w = secondWin();
    try { return !!(w && w.__pdfViewerHasUnsaved && w.__pdfViewerHasUnsaved()); } catch { return false; }
  }
  /** Close the side; asks first if its PDF has unsaved changes (unless `force`). False where the answer was no. */
  function close({ force = false } = {}) {
    if (!open) return true;
    if (!force && hasUnsaved() && !win.confirm(`“${label(shown && shown.name)}” has changes that are not saved. Close it anyway?`)) return false;
    const w = secondWin();
    if (w) { attached.delete(w); try { w.__pdfViewerUnregister && w.__pdfViewerUnregister(); } catch { /* gone */ } }
    for (const el of [frame, bar, pick]) if (el) el.remove();
    frame = bar = pick = linkBtn = null;
    ready = null;
    shown = null;
    open = false;
    linked = false;
    applyShown();
    notify();
    try { const p = primary(); if (p) { p.frameElement && p.frameElement.focus(); p.focus(); } } catch { /* ok */ }
    return true;
  }
  function toggle() { if (open) close(); else begin(); }

  return {
    attach,
    toggle,
    begin,
    close,
    load,
    hasUnsaved,
    isOpen: () => open,
    /** The second viewer's window, once it has a PDF. */
    win: () => (shown ? secondWin() : null),
    /** What the second viewer shows: { name, file?, handle? }. */
    shown: () => shown,
    /** Hidden with its host (another tab, Home), kept as it is. */
    setVisible(on) { visible = !!on; applyShown(); },
  };
}

// ── the extension's page of its own ─────────────────────────────────────────
//
// A viewer with no host moves to split.html. One opened from a link goes by
// its address; one opened from a file dropped on it has none, so the File
// (and its handle, if it had one) is put in IndexedDB, which holds both,
// for split.html to take.
const STASH_DB = "pdfSplitStash";
function stashDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(STASH_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("s");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function stashFile(item) {
  const db = await stashDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("s", "readwrite");
    tx.objectStore("s").put(item, "left");
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
  db.close();
}
export async function takeStash() {
  const db = await stashDb();
  const item = await new Promise((resolve, reject) => {
    const tx = db.transaction("s", "readwrite");
    const st = tx.objectStore("s");
    const g = st.get("left");
    g.onsuccess = () => { st.delete("left"); };
    tx.oncomplete = () => resolve(g.result || null);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
  db.close();
  return item;
}
