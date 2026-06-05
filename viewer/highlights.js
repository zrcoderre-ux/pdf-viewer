// highlights.js
//
// In-memory persistent text highlighting, scoped to the current viewer tab.
// Highlights are NOT saved across browser sessions — closing the tab wipes
// them — so there is no storage layer here, just a module-level Map keyed
// by page number.
//
// Storage shape per highlight:
//   {
//     id: number,                      // monotonically increasing
//     startSpanIdx: number,            // index into textLayer's <span> children
//     startOffset:  number,            // char offset within that span
//     endSpanIdx:   number,
//     endOffset:    number,
//   }
//
// Geometry: highlights are repainted from these (span, offset) coordinates
// by constructing a DOM Range and calling getClientRects() — same approach
// the citation linker uses for its overlay rects. This means highlights
// stay aligned correctly across zoom changes (which re-render the page
// from scratch with new spans, but the span *count* and *text content* are
// stable for a given PDF, so the indices remain valid).
//
// Two ways to add a highlight:
//   1. Highlight tool mode (highlightMode = true): releasing the mouse after
//      a drag immediately converts the selection into a persistent highlight.
//   2. Normal mode: drag to select text normally (Ctrl+C copies it). A small
//      context menu appears on right-click over a selection or an existing
//      highlight, offering "Highlight selection" or "Remove highlight".

const HIGHLIGHT_COLOR = "rgba(255, 213, 0, 0.40)"; // yellow, 40% alpha
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

function rectsForHighlight(hl, textLayerDiv, highlightLayerDiv) {
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

export function repaintHighlightsForPage(pageNumber, textLayerDiv, highlightLayerDiv) {
  while (highlightLayerDiv.firstChild) {
    highlightLayerDiv.removeChild(highlightLayerDiv.firstChild);
  }

  const list = _highlightsByPage.get(pageNumber);
  if (!list || !list.length) return;

  for (const hl of list) {
    const rects = rectsForHighlight(hl, textLayerDiv, highlightLayerDiv);
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

// ── Event wiring ──────────────────────────────────────────────────────────────

// Wire up event handlers on a single page. Call once per page after render.
//
// getHighlightMode: () => boolean  — returns current tool state
// repaintCb: (pageNumber) => void  — called whenever highlights change
export function attachHighlightHandlers(
  pageNumber, pageWrapper, textLayerDiv, highlightLayerDiv,
  getHighlightMode, repaintCb
) {
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
