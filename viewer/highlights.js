// highlights.js
//
// In-memory persistent text highlighting, scoped to the current viewer tab.
// Highlights are NOT saved across browser sessions — closing the tab wipes
// them — so there is no storage layer here, just a module-level Map keyed
// by page number.
//
// Storage shape per highlight — two kinds:
//   Span-based (made in this session by selecting text):
//   {
//     id: number,                      // monotonically increasing
//     startSpanIdx: number,            // index into textLayer's <span> children
//     startOffset:  number,            // char offset within that span
//     endSpanIdx:   number,
//     endOffset:    number,
//   }
//   Imported (loaded from a saved PDF's /Highlight annotations):
//   {
//     id: number,
//     pdfRects: Array<{x,y,w,h}>,       // PDF points, origin bottom-left
//     imported: true,
//   }
//
// Geometry: span highlights are repainted from their (span, offset) coordinates
// by constructing a DOM Range and calling getClientRects() — same approach
// the citation linker uses for its overlay rects. This means they stay aligned
// correctly across zoom changes (which re-render the page from scratch with new
// spans, but the span *count* and *text content* are stable for a given PDF, so
// the indices remain valid). Imported highlights are stored in PDF space and
// converted to on-screen pixels each repaint (× scale, with a Y-flip), so they
// track zoom too — and, crucially, they're removable exactly like span
// highlights, which is how a saved-and-reopened highlight can be deleted.
//
// Two ways to add a highlight:
//   1. Highlight tool mode (highlightMode = true): releasing the mouse after
//      a drag immediately converts the selection into a persistent highlight.
//   2. Normal mode: drag to select text normally (Ctrl+C copies it). A small
//      context menu appears on right-click over a selection or an existing
//      highlight, offering "Highlight selection" or "Remove highlight".
//
// Selection shapes:
//   - Default: native flowing text selection (drag with the left button).
//   - Rectangle (marquee): sweep a box to grab every glyph whose center falls
//     inside it — handy for columns/tables where flowing selection grabs the
//     wrong text. Two ways to start one:
//       * Hold Alt and drag (either mouse button), or
//       * Turn on the Rectangle-select tool, then drag with the left button.
//     In the highlight tool the box is highlighted immediately; otherwise the
//     same Copy / Highlight menu appears for the boxed text.

// Solid yellow. The translucency is applied ONCE at the layer level
// (.highlightLayer { opacity }) rather than per-rect, so overlapping highlight
// rectangles don't stack into a darker patch — the whole layer is one flat tint.
const HIGHLIGHT_COLOR = "rgb(255, 213, 0)";
let _nextId = 1;

// pageNumber -> Array<highlight>
const _highlightsByPage = new Map();

// ── Context menu ──────────────────────────────────────────────────────────────

let _ctxMenu = null;
let _ctxCleanup = null;

function ensureCtxMenu() {
  if (_ctxMenu) return _ctxMenu;
  _ctxMenu = document.createElement("div");
  _ctxMenu.id = "hl-ctx-menu";
  _ctxMenu.setAttribute("role", "menu");
  document.body.appendChild(_ctxMenu);
  return _ctxMenu;
}

function dismissCtxMenu() {
  if (_ctxCleanup) { _ctxCleanup(); _ctxCleanup = null; }
  if (_ctxMenu) _ctxMenu.style.display = "none";
}

// Show context menu at (clientX, clientY) with given items.
// items: Array<{ label: string, action: () => void, danger?: boolean }>
function showCtxMenu(x, y, items) {
  dismissCtxMenu();

  const menu = ensureCtxMenu();
  menu.innerHTML = "";

  for (const item of items) {
    const btn = document.createElement("button");
    btn.setAttribute("role", "menuitem");
    btn.textContent = item.label;
    if (item.danger) btn.classList.add("hl-ctx-danger");
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismissCtxMenu();
      item.action();
    });
    menu.appendChild(btn);
  }

  menu.style.display = "block";
  menu.style.left = "0px";
  menu.style.top  = "0px";
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  menu.style.left = `${Math.min(x, vw - mw - 6)}px`;
  menu.style.top  = `${Math.min(y, vh - mh - 6)}px`;

  const onDown = (e) => { if (!menu.contains(e.target)) dismissCtxMenu(); };
  const onKey  = (e) => { if (e.key === "Escape") dismissCtxMenu(); };
  setTimeout(() => {
    document.addEventListener("mousedown", onDown, { capture: true });
    document.addEventListener("keydown",   onKey,  { capture: true });
  }, 0);
  _ctxCleanup = () => {
    document.removeEventListener("mousedown", onDown, { capture: true });
    document.removeEventListener("keydown",   onKey,  { capture: true });
  };
}

// ── Highlight storage helpers ─────────────────────────────────────────────────

export function clearAllHighlights() {
  _highlightsByPage.clear();
  _nextId = 1;
}

// True if any page has at least one highlight (used to enable "Save").
export function hasHighlights() {
  for (const list of _highlightsByPage.values()) if (list && list.length) return true;
  return false;
}

// Rendered highlight rectangles for a page, grouped per highlight, relative to
// highlightLayerDiv (px, top-left origin) — the same rects painted on screen.
// The caller converts each group into PDF-space points to write it as one
// /Highlight annotation. `renderCtx` = { scale, pageHeightPts } is needed to
// place imported (PDF-space) highlights; span highlights ignore it.
export function getHighlightRectGroups(pageNumber, textLayerDiv, highlightLayerDiv, renderCtx) {
  const list = _highlightsByPage.get(pageNumber);
  if (!list || !list.length) return [];
  const out = [];
  for (const hl of list) {
    const rects = rectsForHighlight(hl, textLayerDiv, highlightLayerDiv, renderCtx);
    if (rects.length) out.push({ id: hl.id, rects });
  }
  return out;
}

// Register a highlight loaded from a saved PDF's annotations. `pdfRects` are in
// PDF points (origin bottom-left). Stored as one removable highlight.
export function addImportedHighlight(pageNumber, pdfRects) {
  if (!pdfRects || !pdfRects.length) return;
  if (!_highlightsByPage.has(pageNumber)) _highlightsByPage.set(pageNumber, []);
  _highlightsByPage.get(pageNumber).push({ id: _nextId++, pdfRects, imported: true });
}

function captureSelectionForPage(pageNumber, textLayerDiv) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

  const range = sel.getRangeAt(0);
  if (!textLayerDiv.contains(range.startContainer) ||
      !textLayerDiv.contains(range.endContainer)) {
    return null;
  }

  const spans = Array.from(textLayerDiv.querySelectorAll("span"));
  const findSpanIdx = (node) => {
    let span = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (span && span.tagName !== "SPAN") span = span.parentElement;
    if (!span) return -1;
    return spans.indexOf(span);
  };

  const startSpanIdx = findSpanIdx(range.startContainer);
  const endSpanIdx   = findSpanIdx(range.endContainer);
  if (startSpanIdx < 0 || endSpanIdx < 0) return null;

  const hl = {
    id: _nextId++,
    startSpanIdx,
    startOffset: range.startOffset,
    endSpanIdx,
    endOffset:   range.endOffset,
  };

  if (
    hl.startSpanIdx > hl.endSpanIdx ||
    (hl.startSpanIdx === hl.endSpanIdx && hl.startOffset > hl.endOffset)
  ) {
    [hl.startSpanIdx, hl.endSpanIdx] = [hl.endSpanIdx, hl.startSpanIdx];
    [hl.startOffset, hl.endOffset]   = [hl.endOffset, hl.startOffset];
  }

  if (hl.startSpanIdx === hl.endSpanIdx && hl.startOffset === hl.endOffset) {
    return null;
  }

  if (!_highlightsByPage.has(pageNumber)) {
    _highlightsByPage.set(pageNumber, []);
  }
  _highlightsByPage.get(pageNumber).push(hl);
  return hl;
}

function removeHighlight(pageNumber, id) {
  const list = _highlightsByPage.get(pageNumber);
  if (!list) return false;
  const idx = list.findIndex((h) => h.id === id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  return true;
}

// ── Geometry ──────────────────────────────────────────────────────────────────

function rectsForHighlight(hl, textLayerDiv, highlightLayerDiv, renderCtx) {
  // Imported highlight: stored in PDF points, converted to layer pixels here.
  // The highlight layer covers the page at the current scale, so a PDF point
  // (x, y-from-bottom) maps to layer px: left = x·scale, top = (H − (y+h))·scale.
  if (hl.pdfRects) {
    const s = (renderCtx && renderCtx.scale) || 1;
    const hPts = renderCtx && renderCtx.pageHeightPts;
    if (!hPts) return [];
    const out = [];
    for (const r of hl.pdfRects) {
      if (!(r.w > 0 && r.h > 0)) continue;
      out.push({
        left:   r.x * s,
        top:    (hPts - (r.y + r.h)) * s,
        width:  r.w * s,
        height: r.h * s,
      });
    }
    return out;
  }

  const spans = textLayerDiv.querySelectorAll("span");
  const startSpan = spans[hl.startSpanIdx];
  const endSpan   = spans[hl.endSpanIdx];
  if (!startSpan || !endSpan) return [];

  const startNode = startSpan.firstChild;
  const endNode   = endSpan.firstChild;
  if (!startNode || !endNode) return [];

  const startNodeLen = startNode.length || 0;
  const endNodeLen   = endNode.length   || 0;

  const range = document.createRange();
  try {
    range.setStart(startNode, Math.max(0, Math.min(hl.startOffset, startNodeLen)));
    range.setEnd(endNode,     Math.max(0, Math.min(hl.endOffset,   endNodeLen)));
  } catch {
    return [];
  }

  const clientRects = range.getClientRects();
  if (!clientRects.length) return [];

  const layerRect = highlightLayerDiv.getBoundingClientRect();
  const out = [];
  for (const cr of clientRects) {
    if (cr.width <= 0.5 || cr.height <= 0.5) continue;
    out.push({
      left:   cr.left - layerRect.left,
      top:    cr.top  - layerRect.top,
      width:  cr.width,
      height: cr.height,
    });
  }
  return out;
}

// ── Painting ──────────────────────────────────────────────────────────────────

export function repaintHighlightsForPage(pageNumber, textLayerDiv, highlightLayerDiv, renderCtx) {
  while (highlightLayerDiv.firstChild) {
    highlightLayerDiv.removeChild(highlightLayerDiv.firstChild);
  }

  const list = _highlightsByPage.get(pageNumber);
  if (!list || !list.length) return;

  for (const hl of list) {
    const rects = rectsForHighlight(hl, textLayerDiv, highlightLayerDiv, renderCtx);
    if (!rects.length) continue;
    for (const r of rects) {
      const div = document.createElement("div");
      div.className = "highlight-rect";
      div.dataset.highlightId = String(hl.id);
      div.style.position   = "absolute";
      div.style.left       = `${r.left}px`;
      div.style.top        = `${r.top}px`;
      div.style.width      = `${r.width}px`;
      div.style.height     = `${r.height}px`;
      div.style.background = HIGHLIGHT_COLOR;
      div.style.pointerEvents = "auto";
      div.style.cursor     = "pointer";
      div.title = "Right-click to remove highlight";
      highlightLayerDiv.appendChild(div);
    }
  }
}

// ── Rectangle (marquee) selection ───────────────────────────────────────────────

// Set true on a marquee mouseup so the contextmenu event that Chrome fires
// immediately afterwards (for the right button) is swallowed instead of
// opening the native menu or our text menu.
let _suppressNextContextMenu = false;

// Lazily-created visual box shown while the user drags a marquee. Positioned
// with fixed coordinates (client space) so it tracks the cursor regardless of
// page scroll.
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
    border: "1px solid rgba(26,115,232,0.9)",
    background: "rgba(26,115,232,0.15)",
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
// { spanIdx, startOffset, endOffset } describing one span's selected slice.
// Runs are returned in reading order (top→bottom, then left→right); `text` is
// those slices joined with spaces within a line and newlines between lines.
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
    if (runStart >= 0) {
      runs.push({ spanIdx: i, startOffset: runStart, endOffset: len, y: top, x: left });
    }
  }

  // Reading order: cluster by vertical band (~4px tolerance), then by x.
  runs.sort((a, b) => (Math.abs(a.y - b.y) > 4 ? a.y - b.y : a.x - b.x));

  // Build text, inserting a newline whenever we move to a new vertical band
  // and a single space between runs that share a line.
  let text = "";
  let lastY = null;
  for (const run of runs) {
    const slice = (spans[run.spanIdx].textContent || "")
      .slice(run.startOffset, run.endOffset);
    if (lastY !== null) text += (Math.abs(run.y - lastY) > 4) ? "\n" : " ";
    text += slice;
    lastY = run.y;
  }
  text = text.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();

  return { text, runs };
}

// Persist each marquee run as its own (single-span) highlight so the existing
// range-based repaint/removal machinery handles them unchanged.
function addRectHighlights(pageNumber, runs) {
  if (!runs.length) return false;
  if (!_highlightsByPage.has(pageNumber)) _highlightsByPage.set(pageNumber, []);
  const list = _highlightsByPage.get(pageNumber);
  for (const run of runs) {
    list.push({
      id: _nextId++,
      startSpanIdx: run.spanIdx,
      startOffset:  run.startOffset,
      endSpanIdx:   run.spanIdx,
      endOffset:    run.endOffset,
    });
  }
  return true;
}

async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    try { document.execCommand("copy"); } catch {}
  }
}

// ── Box-selection preview ─────────────────────────────────────────────────────
// A marquee (box) selection uses a custom drag rectangle that disappears on
// release, and — unlike native flowing selection — the boxed text has no
// ::selection tint, so nothing shows what was grabbed. We paint a translucent
// blue overlay over the selected glyph runs and keep it up until the next
// mousedown (a new selection, or a click to dismiss) or until the runs are
// turned into a highlight.
let _boxSelPreview = [];

function clearBoxSelPreview() {
  for (const el of _boxSelPreview) el.remove();
  _boxSelPreview = [];
}

function paintRunsPreview(pageWrapper, textLayerDiv, runs) {
  clearBoxSelPreview();
  const spans = textLayerDiv.querySelectorAll("span");
  const wrapRect = pageWrapper.getBoundingClientRect();
  const range = document.createRange();
  for (const run of runs) {
    const span = spans[run.spanIdx];
    const node = span && span.firstChild;
    if (!node) continue;
    const len = node.length || 0;
    try {
      range.setStart(node, Math.max(0, Math.min(run.startOffset, len)));
      range.setEnd(node, Math.max(0, Math.min(run.endOffset, len)));
    } catch {
      continue;
    }
    for (const cr of range.getClientRects()) {
      if (cr.width <= 0.5 || cr.height <= 0.5) continue;
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
}

// ── Event wiring ──────────────────────────────────────────────────────────────

// Wire up event handlers on a single page. Call once per page after render.
//
// getHighlightMode: () => boolean  — returns current tool state
// repaintCb: (pageNumber) => void  — called whenever highlights change
export function attachHighlightHandlers(
  pageNumber, pageWrapper, textLayerDiv, highlightLayerDiv,
  getHighlightMode, repaintCb, getRectSelectMode
) {
  // ── Rectangle (marquee) selection ─────────────────────────────────────────
  // Started by either: Alt + drag (any button), or the Rectangle-select tool +
  // left-drag. A plain left-drag (no Alt, tool off) is left alone so normal
  // text selection still works.
  pageWrapper.addEventListener("mousedown", (e) => {
    // Any press on a page dismisses a lingering box-selection preview — whether
    // it starts a new selection or is just a click to clear the old one.
    clearBoxSelPreview();
    const rectTool   = !!(getRectSelectMode && getRectSelectMode());
    const altGesture = e.altKey && (e.button === 0 || e.button === 2);
    const toolGesture = rectTool && e.button === 0;
    if (!altGesture && !toolGesture) return;

    // Take over: no native text selection, and (for the right button) we'll
    // swallow the contextmenu that follows.
    const startButton = e.button;
    e.preventDefault();
    // Anchor the drag in DOCUMENT coordinates (pageX/pageY) so scrolling during
    // the drag keeps the box over the same content. The marquee is positioned
    // absolutely, so these coordinates paint it correctly and it scrolls along.
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
      // Only a right-button drag is followed by a contextmenu event; swallow
      // just that one. (Setting the flag after a left-drag would wrongly eat
      // the user's next normal right-click menu.)
      if (startButton === 2) _suppressNextContextMenu = true;

      // collectRectSelection compares against getBoundingClientRect (viewport
      // space), so convert the document-anchored start back to the CURRENT
      // viewport frame; the end point is already a live client coordinate.
      const startClientX = startX - window.scrollX;
      const startClientY = startY - window.scrollY;
      const box = {
        left:   Math.min(startClientX, ev.clientX),
        right:  Math.max(startClientX, ev.clientX),
        top:    Math.min(startClientY, ev.clientY),
        bottom: Math.max(startClientY, ev.clientY),
      };
      // Ignore click-sized boxes (no real drag).
      if (box.right - box.left < 4 || box.bottom - box.top < 4) return;

      const { text, runs } = collectRectSelection(box, textLayerDiv);
      if (!runs.length) return;

      // Highlight tool: box → highlight immediately. Otherwise offer the menu.
      if (getHighlightMode()) {
        if (addRectHighlights(pageNumber, runs)) repaintCb(pageNumber);
        return;
      }
      // Show what was grabbed (persists until the next click) and offer actions.
      paintRunsPreview(pageWrapper, textLayerDiv, runs);
      showCtxMenu(ev.clientX, ev.clientY + 8, [
        { label: "Copy", action: () => copyText(text) },
        {
          label: "Highlight",
          action: () => {
            clearBoxSelPreview();
            if (addRectHighlights(pageNumber, runs)) repaintCb(pageNumber);
          },
        },
      ]);
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  });

  // ── mouseup: highlight-tool mode auto-captures; normal mode auto-shows menu ─
  pageWrapper.addEventListener("mouseup", (e) => {
    if (e.target && e.target.classList &&
        e.target.classList.contains("highlight-rect")) {
      return; // handled via contextmenu
    }

    // Highlight-tool mode: convert the selection straight to a highlight.
    if (getHighlightMode()) {
      setTimeout(() => {
        const hl = captureSelectionForPage(pageNumber, textLayerDiv);
        if (hl) {
          const sel = window.getSelection();
          if (sel) sel.removeAllRanges();
          repaintCb(pageNumber);
        }
      }, 0);
      return;
    }

    // Normal mode: if there's a real selection inside this page's text
    // layer, pop the Copy / Highlight menu near the mouse-release point.
    // Use setTimeout(0) so the selection is fully committed by the time
    // we check (Chrome finalizes the selection just after mouseup fires).
    // We also need to defer enough that left-clicks immediately after the
    // menu opens (to dismiss it) don't reopen it from a stale selection;
    // the menu's own outside-click dismiss runs in capture phase and
    // beats this handler, so a single tick is enough.
    const releaseX = e.clientX;
    const releaseY = e.clientY;
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!textLayerDiv.contains(range.startContainer) ||
          !textLayerDiv.contains(range.endContainer)) return;

      const selectedText = sel.toString();
      if (!selectedText.trim()) return;

      // Position the menu just below the mouse-release point. The menu's
      // own showCtxMenu logic will nudge it back inside the viewport if
      // we land too close to the right or bottom edge.
      showCtxMenu(releaseX, releaseY + 8, [
        {
          label: "Copy",
          action: async () => {
            try {
              await navigator.clipboard.writeText(selectedText);
            } catch {
              try { document.execCommand("copy"); } catch {}
            }
          },
        },
        {
          label: "Highlight",
          action: () => {
            const hl = captureSelectionForPage(pageNumber, textLayerDiv);
            if (hl) {
              const s = window.getSelection();
              if (s) s.removeAllRanges();
              repaintCb(pageNumber);
            }
          },
        },
      ]);
    }, 0);
  });

  // ── contextmenu (right-click) ─────────────────────────────────────────────
  pageWrapper.addEventListener("contextmenu", (e) => {
    // Swallow the contextmenu that trails an Alt+right marquee drag, plus any
    // Alt+right-click, so the native menu never flashes during the gesture.
    if (_suppressNextContextMenu) { _suppressNextContextMenu = false; e.preventDefault(); return; }
    if (e.altKey) { e.preventDefault(); return; }

    const targetIsRect = e.target && e.target.classList &&
                         e.target.classList.contains("highlight-rect");

    if (targetIsRect) {
      // Right-click on an existing highlight → offer removal
      e.preventDefault();
      const id = Number(e.target.dataset.highlightId);
      showCtxMenu(e.clientX, e.clientY, [
        {
          label: "Remove highlight",
          danger: true,
          action: () => {
            if (removeHighlight(pageNumber, id)) repaintCb(pageNumber);
          },
        },
      ]);
      return;
    }

    // Right-click anywhere while text is selected → offer "Copy" and
    // "Highlight selection". Copy goes first because it's the more
    // common action; users who want to highlight already have a tool
    // toggle and can also use this menu item.
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!textLayerDiv.contains(range.startContainer) ||
        !textLayerDiv.contains(range.endContainer)) return;

    const selectedText = sel.toString();

    e.preventDefault();
    showCtxMenu(e.clientX, e.clientY, [
      {
        label: "Copy",
        action: async () => {
          try {
            await navigator.clipboard.writeText(selectedText);
          } catch {
            // Fallback for environments where clipboard API is gated:
            // use the legacy execCommand path. Selection is still live
            // at this point because we captured selectedText eagerly.
            try { document.execCommand("copy"); } catch {}
          }
        },
      },
      {
        label: "Highlight selection",
        action: () => {
          const hl = captureSelectionForPage(pageNumber, textLayerDiv);
          if (hl) {
            const s = window.getSelection();
            if (s) s.removeAllRanges();
            repaintCb(pageNumber);
          }
        },
      },
    ]);
  });
}
