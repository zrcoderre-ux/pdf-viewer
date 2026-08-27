// shift-space-open.js
//
// Shift+Space = middle click. Chrome opens a link in an unfocused background
// tab when you click it with the scroll wheel; this gives the same result from
// the keyboard, for two targets:
//
//   1. the link under the mouse pointer, and
//   2. every link inside the current text selection.
//
// Both surfaces of this extension need it, so this is a plain classic script
// with no imports — the same file is injected as a content script on the web
// and loaded by <script src> in the PDF viewer page.
//
// WHY THE TARGETS ARE FOUND GEOMETRICALLY
//
// Our citation links are not in the page's text flow. Both the viewer and the
// content script paint absolutely-positioned <a> strips over the text (see
// createLinkOverlayFromRects and paint()), precisely so the underlying DOM is
// never touched. A selection therefore never *contains* them in the DOM sense,
// and range.intersectsNode() would miss every one. So a link counts as selected
// when the selection's rectangles actually cover it on screen, which is also
// what "highlighted hyperlink" means to the person looking at the page. The
// same test is applied to ordinary page links, where it has a second benefit:
// a selection that merely ends at a link's first character doesn't drag that
// link in, the way intersectsNode() would.
//
// The tab itself is opened by the background worker (chrome.tabs.create with
// active:false), because a page can't open an unfocused tab on its own.
//
// Shift+Space is Chrome's "scroll up one screen". We call preventDefault ONLY
// when we found at least one link to open — with no link in play the key
// scrolls exactly as it always did.

(function (root) {
  "use strict";

  if (!root || root.__shiftSpaceOpenLoaded) return;
  root.__shiftSpaceOpenLoaded = true;

  const doc = root.document;
  if (!doc) return;

  // Opening a tab per link is only reasonable up to a point; a selection that
  // sweeps a whole page of citations shouldn't fill the tab strip.
  const MAX_TABS = 20;

  // A selected link has to be genuinely covered by the selection, not merely
  // touched at its edge. Well under half, because a partial selection through
  // a long link ("Smith v. Jones (1998) 19 Cal.4th 1") is still that link.
  const MIN_COVERAGE = 0.25;

  // Our own overlay strips live outside the selected DOM entirely, so they're
  // gathered document-wide rather than from the selection's subtree.
  //   citation-link     PDF viewer citation overlay
  //   pdf-link          PDF viewer's overlay for the document's own links
  //   cl-citation-link  website citation overlay (content script)
  const OVERLAY_LINKS = "a.citation-link, a.pdf-link, a.cl-citation-link";

  // Protocols worth a new tab. A middle click on mailto:/tel:/javascript:
  // doesn't open a background tab either.
  const OPENABLE_SCHEMES = ["http:", "https:", "file:", "chrome-extension:"];

  let enabled = true;           // Options → "Shift+Space opens links…"
  let mouseX = null;
  let mouseY = null;

  // ── Which links can be opened ──────────────────────────────────────────────

  function isOpenableLink(el) {
    if (!el || el.nodeType !== 1 || el.tagName !== "A") return false;
    const raw = (el.getAttribute("href") || "").trim();
    // A bare fragment is an in-page jump, and in the PDF viewer href="#" is a
    // go-to-page link whose real work happens in a click handler — opening a
    // second copy of the document is never what was meant.
    if (!raw || raw.charAt(0) === "#") return false;
    let protocol;
    try { protocol = new URL(el.href, doc.baseURI).protocol; } catch (e) { return false; }
    return OPENABLE_SCHEMES.indexOf(protocol) !== -1;
  }

  // ── Geometry ───────────────────────────────────────────────────────────────

  function area(r) { return Math.max(0, r.width) * Math.max(0, r.height); }

  function intersectionArea(a, b) {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  }

  // What fraction of `el` the selection rectangles cover. Rects are compared
  // one at a time rather than as a union: selection rects are laid out one per
  // line, as are a link's own rects, so at most one of them meaningfully
  // overlaps each link rect and the largest single overlap is the answer.
  function coverage(el, selRects) {
    let rects;
    try { rects = el.getClientRects(); } catch (e) { return 0; }
    let total = 0;
    let covered = 0;
    for (const r of rects) {
      const a = area(r);
      if (a <= 0) continue;
      total += a;
      let best = 0;
      for (const s of selRects) {
        const hit = intersectionArea(r, s);
        if (hit > best) best = hit;
      }
      covered += best;
    }
    return total > 0 ? covered / total : 0;
  }

  function firstRect(el) {
    try {
      const rects = el.getClientRects();
      return rects.length ? rects[0] : el.getBoundingClientRect();
    } catch (e) {
      return { top: 0, left: 0 };
    }
  }

  // ── Finding targets ────────────────────────────────────────────────────────

  // The link the mouse is resting on, if any. Read live from the pointer's last
  // known position rather than remembered from mouseover, so it stays right
  // after the page scrolls or an overlay repaints under a still mouse.
  function linkAtPointer() {
    if (mouseX == null || mouseY == null || !doc.elementFromPoint) return null;
    const el = doc.elementFromPoint(mouseX, mouseY);
    if (!el || !el.closest) return null;
    const a = el.closest("a[href]");
    return isOpenableLink(a) ? a : null;
  }

  // Every link the selection paints over, in reading order.
  function linksInSelection(sel) {
    if (!sel || sel.isCollapsed || !sel.rangeCount) return [];

    const selRects = [];
    const candidates = new Set();

    for (let i = 0; i < sel.rangeCount; i++) {
      const range = sel.getRangeAt(i);
      for (const r of range.getClientRects()) {
        if (r.width > 0 && r.height > 0) selRects.push(r);
      }
      // Ordinary page links: only the selection's own subtree can hold them,
      // plus an enclosing link when the whole selection sits inside one.
      const node = range.commonAncestorContainer;
      const el = node && node.nodeType === 1 ? node : node && node.parentElement;
      if (!el) continue;
      const enclosing = el.closest ? el.closest("a[href]") : null;
      if (enclosing) candidates.add(enclosing);
      if (el.querySelectorAll) {
        for (const a of el.querySelectorAll("a[href]")) candidates.add(a);
      }
    }
    if (!selRects.length) return [];

    // Overlay strips are painted into their own layer, never inside the
    // selection's subtree, so they have to be looked for document-wide.
    if (doc.querySelectorAll) {
      for (const a of doc.querySelectorAll(OVERLAY_LINKS)) candidates.add(a);
    }

    const hits = [];
    for (const a of candidates) {
      if (!isOpenableLink(a)) continue;
      if (coverage(a, selRects) < MIN_COVERAGE) continue;
      hits.push(a);
    }
    // Open them the way they read: top to bottom, then left to right. Links on
    // one line rarely share an exact top (glyph rects differ by a pixel), so
    // anything within a few pixels counts as the same line.
    hits.sort((p, q) => {
      const rp = firstRect(p), rq = firstRect(q);
      const dt = rp.top - rq.top;
      return Math.abs(dt) > 4 ? dt : rp.left - rq.left;
    });
    return hits;
  }

  function urlsOf(links) {
    const out = [];
    for (const a of links) {
      const url = a.href;
      if (url && out.indexOf(url) === -1) out.push(url);
    }
    return out;
  }

  // Pointer and selection can disagree. The pointer is what a middle click
  // would have acted on, so it wins — unless it's pointing INTO the selection,
  // which is the ordinary case right after a drag-select and means "all of
  // these", not "this one".
  function collectUrls() {
    const selected = urlsOf(linksInSelection(root.getSelection ? root.getSelection() : null));
    const hovered = linkAtPointer();
    if (hovered) {
      const url = hovered.href;
      if (selected.indexOf(url) === -1) return [url];
    }
    if (selected.length) return selected;
    return [];
  }

  // ── Opening ────────────────────────────────────────────────────────────────

  function extensionApi() {
    const api = root.chrome;
    return api && api.runtime && api.runtime.id ? api : null;
  }

  function open(urls) {
    const api = extensionApi();
    if (api) {
      // The background worker holds chrome.tabs; only it can open a tab that
      // doesn't steal focus.
      api.runtime.sendMessage({ type: "open-background-tabs", urls }, () => {
        void api.runtime.lastError; // worker asleep / no receiver — nothing to do
      });
      return;
    }
    // Outside the extension (the PWA build), a page can't open an unfocused
    // tab at all. Best effort: open it anyway rather than swallow the keypress.
    for (const url of urls) {
      try { root.open(url, "_blank", "noopener"); } catch (e) { /* popup blocked */ }
    }
  }

  // Background tabs open silently. A one-line confirmation says how many, which
  // matters most in the case the count isn't obvious (a big selection).
  let toastEl = null;
  let toastTimer = null;
  function toast(text) {
    if (!doc.documentElement) return;
    if (!toastEl || !toastEl.isConnected) {
      toastEl = doc.createElement("div");
      toastEl.style.cssText = [
        "position:fixed", "left:50%", "bottom:24px", "transform:translateX(-50%)",
        "z-index:2147483647", "pointer-events:none",
        "background:rgba(32,33,36,0.92)", "color:#fff",
        "font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        "padding:7px 14px", "border-radius:6px",
        "box-shadow:0 2px 10px rgba(0,0,0,0.35)",
      ].join(";");
      // Appended to <html>, not <body>: the content script's MutationObserver
      // watches the body subtree, and a toast there would kick off a re-scan.
      doc.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl && toastEl.isConnected) toastEl.remove();
    }, 1600);
  }

  // ── The key ────────────────────────────────────────────────────────────────

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    return !!el.isContentEditable;
  }

  function onKeyDown(e) {
    if (!enabled || e.defaultPrevented) return;
    // Holding the combo down must not spray tabs.
    if (e.repeat) return;
    if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const isSpace = e.code === "Space" || e.key === " " || e.key === "Spacebar";
    if (!isSpace) return;
    // In a text field Shift+Space types a space.
    if (isEditable(doc.activeElement)) return;

    const urls = collectUrls();
    if (!urls.length) return; // no link in play — let the page scroll up

    e.preventDefault();
    e.stopPropagation();

    const opening = urls.slice(0, MAX_TABS);
    open(opening);
    toast(
      urls.length > opening.length
        ? `Opened ${opening.length} of ${urls.length} links in background tabs`
        : opening.length === 1
          ? "Opened link in a background tab"
          : `Opened ${opening.length} links in background tabs`
    );
  }

  function onMouseMove(e) { mouseX = e.clientX; mouseY = e.clientY; }

  // Pointer left the window: it isn't resting on anything any more.
  function onMouseOut(e) {
    if (!e.relatedTarget) { mouseX = null; mouseY = null; }
  }

  function install() {
    // Capture on the window so the shortcut is read before the page's own
    // handlers — many sites bind Space themselves.
    root.addEventListener("keydown", onKeyDown, true);
    doc.addEventListener("mousemove", onMouseMove, { capture: true, passive: true });
    doc.addEventListener("mouseout", onMouseOut, { capture: true, passive: true });

    const api = extensionApi();
    if (!api || !api.storage) return;
    try {
      api.storage.sync.get({ shiftSpaceOpenLinks: true }, (v) => {
        void api.runtime.lastError;
        if (v) enabled = v.shiftSpaceOpenLinks !== false;
      });
      api.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "sync" && changes.shiftSpaceOpenLinks) {
          enabled = changes.shiftSpaceOpenLinks.newValue !== false;
        }
      });
    } catch (e) { /* storage unavailable; the default (on) stands */ }
  }

  // Exposed for the Node tests, which drive these against a stubbed DOM.
  root.ShiftSpaceOpen = {
    install,
    isOpenableLink,
    coverage,
    linksInSelection,
    linkAtPointer,
    collectUrls,
    urlsOf,
    onKeyDown,
    setPointer: (x, y) => { mouseX = x; mouseY = y; },
    setEnabled: (v) => { enabled = v; },
    MAX_TABS,
    MIN_COVERAGE,
  };

  install();
})(typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : this);
