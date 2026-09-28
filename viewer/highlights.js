// highlights.js
//
// Text selection on the page, and turning a selection into markup.
//
// The markup itself — highlights, underlines, strikeouts — belongs to the
// annotation layer (annotations.js), which keeps it in PDF coordinates and
// writes it into the file. What lives here is the part that deals with the
// SELECTION: reading which lines of which page a selection covers, the
// marquee (box) selection for columns and tables, and the moment a selection
// should become markup.
//
//   - With a markup tool on (Highlight, Underline, Strikethrough), releasing
//     the mouse after a drag turns the selection straight into that markup.
//   - Otherwise a drag is an ordinary text selection (Ctrl+C copies it); the
//     viewer's selection toolbar offers the markup, and right-click offers it
//     again with Copy.
//
// Selection shapes:
//   - Default: native flowing text selection (drag with the left button).
//   - Rectangle (marquee): sweep a box to grab every glyph whose center falls
//     inside it — handy for columns and tables where flowing selection grabs
//     the wrong text. Started by holding Alt and dragging (either button), or
//     with the Box select tool on and a left drag.

import { contextMenu } from "./ui.js";

// sink(pageNumber, clientRects, kind, quoteText) — makes the markup.
let sink = () => null;
export function setMarkupSink(fn) { sink = fn || (() => null); }

/**
 * The current selection, split by page: [{ pageNumber, rects, text }]. Rects
 * are client rects of the selected glyph runs; a rect as tall as a page (the
 * canvas or a layer swept up by a selection crossing a page break) is left out.
 */
export function selectionByPage(root = document) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return [];
  const byPage = new Map();
  const wrappers = [...root.querySelectorAll(".page-wrapper")].map((w) => ({ w, r: w.getBoundingClientRect(), pn: Number(w.dataset.pageNumber) }));
  for (let i = 0; i < sel.rangeCount; i++) {
    const range = sel.getRangeAt(i);
    for (const cr of range.getClientRects()) {
      if (cr.width < 0.5 || cr.height < 0.5) continue;
      const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
      const hit = wrappers.find(({ r }) => cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom);
      if (!hit || cr.height > hit.r.height * 0.25) continue;
      // Only glyph boxes: an empty text-layer <br> or the layer itself is not text.
      if (!byPage.has(hit.pn)) byPage.set(hit.pn, []);
      byPage.get(hit.pn).push(cr);
    }
  }
  const text = sel.toString();
  return [...byPage.entries()].map(([pageNumber, rects]) => ({ pageNumber, rects, text }));
}

/** Turn the current selection into `kind` markup, page by page. Returns how many were made. */
export function markupSelection(kind) {
  const parts = selectionByPage();
  let n = 0;
  for (const p of parts) if (sink(p.pageNumber, p.rects, kind, p.text)) n++;
  if (n) { const s = window.getSelection(); if (s) s.removeAllRanges(); }
  return n;
}

// ── Rectangle (marquee) selection ─────────────────────────────────────────────

// Set true on a marquee mouseup so the contextmenu event that Chrome fires
// immediately afterwards (for the right button) is swallowed.
let _suppressNextContextMenu = false;

let _marqueeEl = null;
function ensureMarqueeEl() {
  if (_marqueeEl) return _marqueeEl;
  _marqueeEl = document.createElement("div");
  _marqueeEl.id = "rect-marquee";
  Object.assign(_marqueeEl.style, {
    // Absolute (document-anchored), not fixed (viewport-anchored), so the box
    // stays over the same content if the page is scrolled mid-drag.
    position: "absolute",
    display: "none",
    pointerEvents: "none",
    zIndex: "2147483646",
    border: "1px solid rgba(37,99,235,0.9)",
    background: "rgba(37,99,235,0.12)",
    borderRadius: "2px",
  });
  document.body.appendChild(_marqueeEl);
  return _marqueeEl;
}
function paintMarquee(el, x0, y0, x1, y1) {
  el.style.left   = `${Math.min(x0, x1)}px`;
  el.style.top    = `${Math.min(y0, y1)}px`;
  el.style.width  = `${Math.abs(x1 - x0)}px`;
  el.style.height = `${Math.abs(y1 - y0)}px`;
}

function rectsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
// A glyph counts as selected when its center sits inside the box.
function centerInside(cr, box) {
  const cx = cr.left + cr.width / 2;
  const cy = cr.top + cr.height / 2;
  return cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom;
}

// Walk the page's text spans and collect the character runs whose glyphs fall
// inside `box` (client coords). Returns { text, runs } where each run is
// { spanIdx, startOffset, endOffset } describing one span's selected slice,
// in reading order; `text` is those slices joined with spaces within a line
// and newlines between lines.
function collectRectSelection(box, textLayerDiv) {
  const spans = Array.from(textLayerDiv.querySelectorAll("span"));
  const runs = [];
  const charRange = document.createRange();
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const sr = span.getBoundingClientRect();
    if (!rectsIntersect(sr, box)) continue;
    const node = span.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) continue;
    const len = node.length || 0;
    const top = sr.top;
    const left = sr.left;
    let runStart = -1;
    for (let c = 0; c < len; c++) {
      charRange.setStart(node, c);
      charRange.setEnd(node, c + 1);
      const cr = charRange.getBoundingClientRect();
      const inside = cr.width > 0 && cr.height > 0 && centerInside(cr, box);
      if (inside) {
        if (runStart < 0) runStart = c;
      } else if (runStart >= 0) {
        runs.push({ spanIdx: i, startOffset: runStart, endOffset: c, y: top, x: left });
        runStart = -1;
      }
    }
    if (runStart >= 0) runs.push({ spanIdx: i, startOffset: runStart, endOffset: len, y: top, x: left });
  }

  // Reading order: cluster by vertical band (~4px tolerance), then by x.
  runs.sort((a, b) => (Math.abs(a.y - b.y) > 4 ? a.y - b.y : a.x - b.x));

  let text = "";
  let lastY = null;
  for (const run of runs) {
    const slice = (spans[run.spanIdx].textContent || "").slice(run.startOffset, run.endOffset);
    if (lastY !== null) text += (Math.abs(run.y - lastY) > 4) ? "\n" : " ";
    text += slice;
    lastY = run.y;
  }
  text = text.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
  return { text, runs };
}

/** Client rects of a set of marquee runs. */
function runRects(textLayerDiv, runs) {
  const spans = textLayerDiv.querySelectorAll("span");
  const range = document.createRange();
  const out = [];
  for (const run of runs) {
    const node = spans[run.spanIdx] && spans[run.spanIdx].firstChild;
    if (!node) continue;
    const len = node.length || 0;
    try {
      range.setStart(node, Math.max(0, Math.min(run.startOffset, len)));
      range.setEnd(node, Math.max(0, Math.min(run.endOffset, len)));
    } catch { continue; }
    for (const cr of range.getClientRects()) if (cr.width > 0.5 && cr.height > 0.5) out.push(cr);
  }
  return out;
}

async function copyText(text) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch { try { document.execCommand("copy"); } catch { /* none */ } }
}

// ── Box-selection preview ─────────────────────────────────────────────────────
// The boxed text has no ::selection tint, so the grabbed glyph runs are painted
// with the selection blue until the next press on a page.
let _boxSelPreview = [];
export function clearBoxSelPreview() {
  for (const el of _boxSelPreview) el.remove();
  _boxSelPreview = [];
}
function paintRunsPreview(pageWrapper, rects) {
  clearBoxSelPreview();
  const wrapRect = pageWrapper.getBoundingClientRect();
  for (const cr of rects) {
    const d = document.createElement("div");
    d.className = "box-sel-preview";
    d.style.left   = `${cr.left - wrapRect.left}px`;
    d.style.top    = `${cr.top - wrapRect.top}px`;
    d.style.width  = `${cr.width}px`;
    d.style.height = `${cr.height}px`;
    pageWrapper.appendChild(d);
    _boxSelPreview.push(d);
  }
}

// ── Event wiring ──────────────────────────────────────────────────────────────

// Wire up the selection handlers on a single page. Call once per page after render.
//   getMarkupKind: () => "highlight" | "underline" | "strikeout" | null
//   getRectSelectMode: () => boolean
//   extraMenu: (text) => [menu items] appended to a marquee's menu
export function attachHighlightHandlers(pageNumber, pageWrapper, textLayerDiv, getMarkupKind, getRectSelectMode, extraMenu = null) {
  pageWrapper.addEventListener("mousedown", (e) => {
    clearBoxSelPreview();
    const rectTool = !!(getRectSelectMode && getRectSelectMode());
    const altGesture = e.altKey && (e.button === 0 || e.button === 2);
    const toolGesture = rectTool && e.button === 0;
    if (!altGesture && !toolGesture) return;
    if (e.target.closest && e.target.closest(".annot:not(.markup), .note-popup")) return;

    const startButton = e.button;
    e.preventDefault();
    const startX = e.pageX;
    const startY = e.pageY;
    const boxEl = ensureMarqueeEl();
    boxEl.style.display = "block";
    paintMarquee(boxEl, startX, startY, startX, startY);

    const onMove = (ev) => paintMarquee(boxEl, startX, startY, ev.pageX, ev.pageY);
    const onUp = (ev) => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      boxEl.style.display = "none";
      if (startButton === 2) _suppressNextContextMenu = true;
      const startClientX = startX - window.scrollX;
      const startClientY = startY - window.scrollY;
      const box = {
        left:   Math.min(startClientX, ev.clientX),
        right:  Math.max(startClientX, ev.clientX),
        top:    Math.min(startClientY, ev.clientY),
        bottom: Math.max(startClientY, ev.clientY),
      };
      if (box.right - box.left < 4 || box.bottom - box.top < 4) return;

      const { text, runs } = collectRectSelection(box, textLayerDiv);
      if (!runs.length) return;
      const rects = runRects(textLayerDiv, runs);
      const kind = getMarkupKind && getMarkupKind();
      if (kind) { sink(pageNumber, rects, kind, text); return; }
      paintRunsPreview(pageWrapper, rects);
      const mark = (k) => { clearBoxSelPreview(); sink(pageNumber, rects, k, text); };
      contextMenu(ev.clientX, ev.clientY + 8, [
        { label: "Copy", icon: "copy", action: () => copyText(text) },
        "-",
        { label: "Highlight", icon: "highlighter", action: () => mark("highlight") },
        { label: "Underline", icon: "underline", action: () => mark("underline") },
        { label: "Strikethrough", icon: "strikethrough", action: () => mark("strikeout") },
        ...(extraMenu ? extraMenu(text, rects) : []),
      ]);
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  });

  // A markup tool turns the selection into markup the moment the drag ends.
  pageWrapper.addEventListener("mouseup", () => {
    const kind = getMarkupKind && getMarkupKind();
    if (!kind) return;
    // Chrome finalizes the selection just after mouseup fires.
    setTimeout(() => markupSelection(kind), 0);
  });

  pageWrapper.addEventListener("contextmenu", (e) => {
    if (_suppressNextContextMenu) { _suppressNextContextMenu = false; e.preventDefault(); return; }
    if (e.altKey) { e.preventDefault(); }
  });
}
