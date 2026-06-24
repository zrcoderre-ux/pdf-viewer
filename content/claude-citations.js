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

  // Bare section reference ("§ 1671", "§§ 430.10", "section 664.6") with no
  // code name. Used by the single-code inheritance pass below.
  const BARE_SECTION_RE =
    /(?:§§?|sections?|secs?\.?)\s*(?<sec>\d+(?:\.\d+)?[a-z]?(?:\([a-z0-9]+\))*)/gi;

  let findAllCitations = null;
  let resolveUrl = null;
  let toaPanel = null;          // shared Table of Authorities panel (toa.js)

  let provider = "lexis";       // matches the PDF viewer default
  let repo = {};
  let citations = [];           // [{ range, url, key, kind }]
  let authorities = [];         // deduped [{ key, kind, url }] for the TOA
  let overlayEl = null;

  const providerLabel = () => (provider === "westlaw" ? "Westlaw" : "Lexis+");

  // ── Setup ──────────────────────────────────────────────────────────────────

  async function init() {
    try {
      const base = chrome.runtime.getURL("viewer/citation-linker.js");
      const mod = await import(base);
      findAllCitations = mod.findAllCitations;
      resolveUrl = mod.resolveUrl;
      const toaMod = await import(chrome.runtime.getURL("viewer/toa.js"));
      toaPanel = toaMod.createToaPanel({ providerLabel });
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
      if (area === "sync" && changes.toaEnabled) {
        toaPanel.setEnabled(changes.toaEnabled.newValue !== false);
        scan();
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
      chrome.storage.sync.get(
        { provider: "lexis", toaEnabled: true },
        ({ provider: p, toaEnabled }) => {
          provider = p === "westlaw" ? "westlaw" : "lexis";
          if (toaPanel) toaPanel.setEnabled(toaEnabled !== false);
          chrome.storage.local.get({ citationRepo: {} }, ({ citationRepo }) => {
            repo = citationRepo || {};
            resolve();
          });
        }
      );
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

    // Per-block context kept for the bare-section inheritance pass.
    const blocks = [];
    for (const [block, map] of groups) {
      const blockText = text.get(block);
      if (blockText.length < 6) continue; // too short to hold a citation
      let hits;
      try { hits = findAllCitations(blockText); } catch { continue; }
      const matchedSpans = [];
      const markers = []; // { pos, code } where a statute code is named
      for (const cite of hits) {
        matchedSpans.push(cite.span);
        if (cite.kind === "statute") {
          const i = cite.key.indexOf(" § ");
          if (i > 0) markers.push({ pos: cite.span[0], code: cite.key.slice(0, i) });
        }
        const range = rangeForSpan(map, cite.span[0], cite.span[1]);
        if (!range) continue;
        let url;
        try { url = resolveUrl(cite, repo, provider); } catch { continue; }
        if (!url) continue;
        citations.push({ range, url, key: cite.key, kind: cite.kind });
      }
      markers.sort((a, b) => a.pos - b.pos);
      blocks.push({ map, blockText, matchedSpans, markers });
    }

    // Carry-forward inheritance: a bare "§ N" / "section N" reference (no code
    // name of its own) inherits the most recently NAMED code that appears
    // before it in reading order. We walk blocks in document order, tracking
    // the last code named; within a block a bare section uses the nearest
    // preceding code marker, falling back to the carried-in code. Bare sections
    // before any code is ever named stay unlinked (nothing to inherit). The
    // single-named-code case is just the special case where every bare section
    // follows that one code.
    let lastCode = null;
    for (const { map, blockText, matchedSpans, markers } of blocks) {
      BARE_SECTION_RE.lastIndex = 0;
      let m;
      while ((m = BARE_SECTION_RE.exec(blockText)) !== null) {
        const s = m.index;
        const e = m.index + m[0].length;
        // Skip references already covered by a full citation above.
        if (matchedSpans.some(([a, b]) => s < b && e > a)) continue;
        // Nearest code named at or before this section in the block, else the
        // code carried in from earlier blocks.
        let code = lastCode;
        for (const mk of markers) {
          if (mk.pos <= s) code = mk.code;
          else break;
        }
        if (!code) continue;
        const key = `${code} § ${m.groups.sec}`;
        let url;
        try { url = resolveUrl({ kind: "statute", key }, repo, provider); } catch { continue; }
        if (!url) continue;
        const range = rangeForSpan(map, s, e);
        if (!range) continue;
        citations.push({ range, url, key, kind: "statute" });
      }
      // Hand the last code named in this block to the next block.
      if (markers.length) lastCode = markers[markers.length - 1].code;
    }

    // Deduplicate by key for the Table of Authorities (the in-text underlines
    // keep every occurrence; the TOA lists each authority once).
    const seen = new Map();
    for (const c of citations) {
      if (!seen.has(c.key)) seen.set(c.key, { key: c.key, kind: c.kind, url: c.url });
    }
    authorities = [...seen.values()];

    paint();
    if (toaPanel) toaPanel.render(authorities, provider);
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


  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
