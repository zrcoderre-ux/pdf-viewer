// claude-citations.js
//
// Content script for claude.ai. Reuses the PDF viewer's pure citation-detection
// engine (findAllCitations) and URL builder (resolveUrl) to find legal
// citations in Claude's responses and overlay clickable links to Westlaw or
// Lexis+ — the same provider toggle and citation_repo.json the PDF viewer uses.
//
// Design: NON-DESTRUCTIVE overlay. claude.ai is a React app, so mutating its
// DOM (wrapping text in <a>) risks corrupting React's reconciliation and
// breaking the page. Instead we never touch Claude's nodes — we build DOM
// Ranges over the citation text and paint thin, absolutely-positioned <a>
// underline strips into our own overlay layer (a sibling of <body>), then
// reposition them on scroll/resize. This mirrors the PDF viewer's linkLayer.
//
// Pipeline:
//   scan()  — walk visible text nodes, group by block, run findAllCitations on
//             each block, map each hit back to a DOM Range, resolve its URL.
//   paint() — read getClientRects() for each Range and lay down underline
//             strips. Cheap; safe to run on every scroll frame.
// scan() runs (debounced) on DOM mutations; paint() runs (rAF-throttled) on
// scroll/resize. Provider / repo changes trigger a re-scan.

(function () {
  if (window.__claudeCitationsLoaded) return;
  window.__claudeCitationsLoaded = true;

  const OVERLAY_ID = "__cl_overlay";
  // Text inside these is never linkified: existing links, code, editor inputs,
  // and our own overlay.
  const SKIP_ANCESTOR =
    "a, code, pre, kbd, samp, script, style, textarea, " +
    "[contenteditable=''], [contenteditable='true'], #" + OVERLAY_ID;
  const BLOCK_SELECTOR =
    "p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6, dd, dt, figcaption";

  let findAllCitations = null;
  let resolveUrl = null;

  let provider = "lexis";       // matches the PDF viewer default
  let repo = {};
  let citations = [];           // [{ range, url, key, kind }]
  let overlayEl = null;

  // Table of Authorities (margin panel) state.
  let authorities = [];         // deduped [{ key, kind, url }]
  let toaEl = null;             // panel container
  let toaBodyEl = null;
  let toaCountEl = null;
  let toaMinimized = false;
  let toaWidth = null;          // persisted custom dimensions (px), null = default
  let toaHeight = null;
  let lastToaSig = "";          // skip rebuild when the authority set is unchanged

  // ── Setup ──────────────────────────────────────────────────────────────────

  async function init() {
    try {
      const mod = await import(chrome.runtime.getURL("viewer/citation-linker.js"));
      findAllCitations = mod.findAllCitations;
      resolveUrl = mod.resolveUrl;
    } catch (e) {
      // Without the engine there's nothing to do; fail quietly.
      console.warn("[claude-citations] could not load citation engine:", e);
      return;
    }

    await loadSettings();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.provider) {
        provider = changes.provider.newValue === "westlaw" ? "westlaw" : "lexis";
        scan(); // URLs depend on the active provider
      }
      if (area === "local" && changes.citationRepo) {
        repo = changes.citationRepo.newValue || {};
        scan();
      }
    });

    // React to content changes (streaming answers, new messages, navigation).
    const mo = new MutationObserver(scheduleScan);
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });

    // Reposition strips when the page (or any inner scroller) scrolls or resizes.
    window.addEventListener("scroll", schedulePaint, { capture: true, passive: true });
    window.addEventListener("resize", schedulePaint, { passive: true });

    scan();
  }

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get({ provider: "lexis" }, ({ provider: p }) => {
        provider = p === "westlaw" ? "westlaw" : "lexis";
        chrome.storage.local.get(
          {
            citationRepo: {},
            claudeToaMinimized: false,
            claudeToaWidth: null,
            claudeToaHeight: null,
          },
          ({ citationRepo, claudeToaMinimized, claudeToaWidth, claudeToaHeight }) => {
            repo = citationRepo || {};
            toaMinimized = !!claudeToaMinimized;
            toaWidth = claudeToaWidth || null;
            toaHeight = claudeToaHeight || null;
            resolve();
          }
        );
      });
    });
  }

  // ── Scan: text → citations → ranges ──────────────────────────────────────────

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 400);
  }

  function scan() {
    if (!findAllCitations) return;
    citations = [];

    // Group accepted text nodes by their nearest block ancestor so detection
    // runs per logical block (citations never span blocks) and each node is
    // counted exactly once.
    const groups = new Map(); // block element -> [{ node, start, end }]
    const text = new Map();   // block element -> concatenated string

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest(SKIP_ANCESTOR)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node;
    while ((node = walker.nextNode())) {
      const block = node.parentElement.closest(BLOCK_SELECTOR) || node.parentElement;
      let map = groups.get(block);
      if (!map) { map = []; groups.set(block, map); text.set(block, ""); }
      const start = text.get(block).length;
      const val = node.nodeValue;
      text.set(block, text.get(block) + val);
      map.push({ node, start, end: start + val.length });
    }

    for (const [block, map] of groups) {
      const blockText = text.get(block);
      if (blockText.length < 6) continue; // too short to hold a citation
      let hits;
      try { hits = findAllCitations(blockText); } catch { continue; }
      for (const cite of hits) {
        const range = rangeForSpan(map, cite.span[0], cite.span[1]);
        if (!range) continue;
        let url;
        try { url = resolveUrl(cite, repo, provider); } catch { continue; }
        if (!url) continue;
        citations.push({ range, url, key: cite.key, kind: cite.kind });
      }
    }

    // Deduplicate by key for the Table of Authorities (the in-text underlines
    // keep every occurrence; the TOA lists each authority once).
    const seen = new Map();
    for (const c of citations) {
      if (!seen.has(c.key)) seen.set(c.key, { key: c.key, kind: c.kind, url: c.url });
    }
    authorities = [...seen.values()];

    paint();
    renderToa();
  }

  // Map a [start, end) offset within a block's concatenated text to a DOM Range.
  function rangeForSpan(map, s, e) {
    let startNode = null, startOff = 0, endNode = null, endOff = 0;
    for (const m of map) {
      if (startNode === null && s >= m.start && s < m.end) {
        startNode = m.node; startOff = s - m.start;
      }
      if (e > m.start && e <= m.end) {
        endNode = m.node; endOff = e - m.start;
      }
    }
    if (!startNode || !endNode) return null;
    try {
      const r = document.createRange();
      r.setStart(startNode, startOff);
      r.setEnd(endNode, endOff);
      return r;
    } catch {
      return null;
    }
  }

  // ── Paint: ranges → underline strips ─────────────────────────────────────────

  let rafPending = false;
  function schedulePaint() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; paint(); });
  }

  function ensureOverlay() {
    if (overlayEl && overlayEl.isConnected) return overlayEl;
    overlayEl = document.createElement("div");
    overlayEl.id = OVERLAY_ID;
    // Append to <html>, NOT <body>, so our own mutations don't feed back into
    // the body MutationObserver (which would loop scan → paint → scan).
    document.documentElement.appendChild(overlayEl);
    return overlayEl;
  }

  const providerLabel = () => (provider === "westlaw" ? "Westlaw" : "Lexis+");

  function paint() {
    const overlay = ensureOverlay();
    overlay.dataset.provider = provider;
    overlay.textContent = "";
    for (const c of citations) {
      let rects;
      try { rects = c.range.getClientRects(); } catch { continue; }
      for (const rect of rects) {
        if (rect.width < 2 || rect.height < 2) continue;
        const a = document.createElement("a");
        a.href = c.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className = "cl-citation-link";
        a.dataset.kind = c.kind;
        a.title = `${c.key} → ${providerLabel()}`;
        a.draggable = false;
        a.addEventListener("dragstart", (ev) => ev.preventDefault());
        // Thin strip at the text baseline: visible, clickable underline that
        // leaves the glyphs above selectable.
        const stripHeight = 2;
        const top = rect.top + rect.height * 0.92 - stripHeight / 2;
        a.style.left = `${rect.left}px`;
        a.style.top = `${top}px`;
        a.style.width = `${rect.width}px`;
        a.style.height = `${stripHeight}px`;
        overlay.appendChild(a);
      }
    }
  }

  // ── Table of Authorities (margin panel) ──────────────────────────────────────

  const TOA_ID = "__cl_toa";
  // case → Cases, etc. Render order follows this list.
  const TOA_GROUPS = [
    ["case", "Cases"],
    ["statute", "Statutes"],
    ["rule", "Rules"],
  ];

  function ensureToa() {
    if (toaEl && toaEl.isConnected) return toaEl;

    toaEl = document.createElement("div");
    toaEl.id = TOA_ID;

    const header = document.createElement("div");
    header.className = "cl-toa-header";
    header.title = "Click to minimize / maximize";

    const title = document.createElement("span");
    title.className = "cl-toa-title";
    title.textContent = "Table of Authorities";

    toaCountEl = document.createElement("span");
    toaCountEl.className = "cl-toa-count";

    const toggle = document.createElement("button");
    toggle.className = "cl-toa-toggle";
    toggle.type = "button";

    header.appendChild(title);
    header.appendChild(toaCountEl);
    header.appendChild(toggle);

    toaBodyEl = document.createElement("div");
    toaBodyEl.className = "cl-toa-body";

    toaEl.appendChild(header);
    toaEl.appendChild(toaBodyEl);

    // Restore any saved custom dimensions.
    if (toaWidth) toaEl.style.width = `${toaWidth}px`;
    if (toaHeight) toaEl.style.height = `${toaHeight}px`;

    // Drag-to-resize grip. The panel is pinned to the top-right, so the grip
    // lives in the bottom-LEFT corner: drag left to widen, drag down to
    // lengthen. Dimensions are clamped to the viewport and persisted.
    const grip = document.createElement("div");
    grip.className = "cl-toa-resize";
    grip.title = "Drag to resize";
    toaEl.appendChild(grip);
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = toaEl.getBoundingClientRect();
      const startW = rect.width;
      const startH = rect.height;
      grip.setPointerCapture(e.pointerId);
      const onMove = (ev) => {
        const w = Math.max(220, Math.min(startW + (startX - ev.clientX), window.innerWidth - 24));
        const h = Math.max(140, Math.min(startH + (ev.clientY - startY), window.innerHeight - 24));
        toaEl.style.width = `${w}px`;
        toaEl.style.height = `${h}px`;
      };
      const onUp = () => {
        grip.removeEventListener("pointermove", onMove);
        grip.removeEventListener("pointerup", onUp);
        toaWidth = Math.round(toaEl.getBoundingClientRect().width);
        toaHeight = Math.round(toaEl.getBoundingClientRect().height);
        chrome.storage.local.set({ claudeToaWidth: toaWidth, claudeToaHeight: toaHeight });
      };
      grip.addEventListener("pointermove", onMove);
      grip.addEventListener("pointerup", onUp);
    });

    const onToggle = (e) => {
      e.preventDefault();
      e.stopPropagation();
      toaMinimized = !toaMinimized;
      applyMinimized();
      chrome.storage.local.set({ claudeToaMinimized: toaMinimized });
    };
    header.addEventListener("click", onToggle);

    // Append to <html> so panel mutations don't trigger the body observer.
    document.documentElement.appendChild(toaEl);
    return toaEl;
  }

  function applyMinimized() {
    if (!toaEl) return;
    toaEl.classList.toggle("cl-toa-minimized", toaMinimized);
    const toggle = toaEl.querySelector(".cl-toa-toggle");
    if (toggle) {
      toggle.textContent = toaMinimized ? "+" : "–";
      toggle.title = toaMinimized ? "Maximize" : "Minimize";
    }
  }

  function renderToa() {
    // Only show the panel when at least one authority was found.
    if (!authorities.length) {
      if (toaEl) toaEl.style.display = "none";
      lastToaSig = "";
      return;
    }

    ensureToa();
    toaEl.style.display = "";
    toaEl.dataset.provider = provider;
    applyMinimized();

    // Rebuild the list only when the set (or provider) actually changed, so the
    // panel doesn't flicker / lose scroll position while answers stream in.
    const sig = provider + "|" + authorities.map((a) => a.kind + ":" + a.key).join("||");
    if (sig === lastToaSig) return;
    lastToaSig = sig;

    toaCountEl.textContent = String(authorities.length);
    toaBodyEl.textContent = "";

    for (const [kind, label] of TOA_GROUPS) {
      const items = authorities
        .filter((a) => a.kind === kind)
        .sort((a, b) => a.key.localeCompare(b.key));
      if (!items.length) continue;

      const groupEl = document.createElement("div");
      groupEl.className = "cl-toa-group";
      groupEl.textContent = label;
      toaBodyEl.appendChild(groupEl);

      for (const a of items) {
        const link = document.createElement("a");
        link.className = "cl-toa-link";
        link.href = a.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = a.key;
        link.title = `Open in ${providerLabel()}`;
        toaBodyEl.appendChild(link);
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
