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

  // Bare model-UCC reference: a SINGLE "§" (or "section"/"sec.") followed by a
  // HYPHENATED number ("§ 3-310"). The hyphen is the tell for the model UCC, so
  // these need no code-name context. The lookarounds on "§" exclude the second
  // "§" of a "§§ 1542-1543" range (which is a span of CA sections, not a UCC
  // article-section).
  const BARE_UCC_RE =
    /(?:(?<!§)§(?!§)|\bsections?|\bsecs?\.?)\s*(?<sec>\d+-\d+(?:\([a-z0-9]+\))*)/gi;

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
    // The citation engine is REQUIRED. Loading it via dynamic import() can be
    // blocked by a strict site Content-Security-Policy — if so, we can't run
    // here, and we say so loudly (in the console) so it's diagnosable rather
    // than a silent no-op.
    try {
      const mod = await import(chrome.runtime.getURL("viewer/citation-linker.js"));
      findAllCitations = mod.findAllCitations;
      resolveUrl = mod.resolveUrl;
    } catch (e) {
      window.__citationLinker = { active: false, reason: "engine blocked (site CSP?)", host: location.host };
      console.warn(
        `[Citation Linker] Could not load the citation engine on ${location.host} — ` +
        `this site's Content-Security-Policy is likely blocking it, so citation links can't be added here.`,
        e
      );
      return;
    }

    // The Table of Authorities panel is OPTIONAL — if its import is blocked,
    // in-text citation links still work, so don't let it abort init.
    try {
      const toaMod = await import(chrome.runtime.getURL("viewer/toa.js"));
      // Sit just below the browser toolbar (near the top of the viewport),
      // matching the PDF viewer's placement under its own toolbar.
      toaPanel = toaMod.createToaPanel({ providerLabel, top: "8px" });
    } catch (e) {
      toaPanel = null;
      console.warn("[Citation Linker] Table of Authorities panel unavailable on this site:", e);
    }

    window.__citationLinker = { active: true, host: location.host, lastScanCitations: 0 };
    console.info(`[Citation Linker] Active on ${location.host}. Inspect window.__citationLinker for status.`);

    await loadSettings();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.provider) {
        provider = changes.provider.newValue === "westlaw" ? "westlaw" : "lexis";
        scan(); // URLs depend on the active provider
      }
      if (area === "sync" && changes.toaEnabledWeb) {
        if (toaPanel) toaPanel.setEnabled(changes.toaEnabledWeb.newValue !== false);
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
        { provider: "lexis", toaEnabledWeb: true },
        ({ provider: p, toaEnabledWeb }) => {
          provider = p === "westlaw" ? "westlaw" : "lexis";
          if (toaPanel) toaPanel.setEnabled(toaEnabledWeb !== false);
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

    const acceptText = (node) => {
      if (!node.nodeValue || !node.nodeValue.trim()) return false;
      const parent = node.parentElement; // null for text directly under a shadow root
      if (!parent || parent.closest(SKIP_ANCESTOR)) return false;
      // Skip text in hidden subtrees (e.g. a collapsed "thinking" panel).
      // Linking it would paint a strip at the text's geometric position,
      // which for hidden/clipped content lands over unrelated chat text.
      if (parent.checkVisibility &&
          !parent.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) {
        return false;
      }
      return true;
    };
    const addTextNode = (node) => {
      const parent = node.parentElement;
      const block = parent.closest(BLOCK_SELECTOR) || parent;
      let map = groups.get(block);
      if (!map) { map = []; groups.set(block, map); text.set(block, ""); }
      const start = text.get(block).length;
      const val = node.nodeValue;
      text.set(block, text.get(block) + val);
      map.push({ node, start, end: start + val.length });
    };

    // Walk the light DOM AND every open shadow root. Modern web-component apps
    // (Teams, many enterprise SPAs) render their text inside shadow trees that
    // a plain document walk never reaches. A TreeWalker can't cross shadow
    // boundaries, so we recurse into each element's shadowRoot ourselves.
    const walkRoot = (root) => {
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let n;
      while ((n = tw.nextNode())) {
        if (n.nodeType === Node.TEXT_NODE) { if (acceptText(n)) addTextNode(n); }
        else if (n.shadowRoot) walkRoot(n.shadowRoot);
      }
    };
    walkRoot(document.body);

    // Per-block context kept for the bare-section inheritance pass.
    const blocks = [];
    for (const [block, map] of groups) {
      const blockText = text.get(block);
      if (blockText.length < 6) continue; // too short to hold a citation
      let hits;
      try { hits = findAllCitations(blockText); } catch { continue; }
      const matchedSpans = [];
      const markers = []; // { pos, code } where a statute code is named
      // Overflow-clipping ancestors of this block — used at paint time to drop
      // strips for text scrolled out of a clipped container (e.g. a partially
      // collapsed "thinking" panel) so they don't land over the main chat.
      const clipEls = clipAncestorsOf(block);
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
        citations.push({ range, url, key: cite.key, kind: cite.kind, clipEls });
      }
      markers.sort((a, b) => a.pos - b.pos);
      blocks.push({ map, blockText, matchedSpans, markers, clipEls });
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
    for (const { map, blockText, matchedSpans, markers, clipEls } of blocks) {
      let m;
      // Bare model-UCC sections first ("§ 3-310"): identified by the hyphen
      // alone, so no carry-forward is needed. Recorded into matchedSpans so the
      // carry-forward pass below skips them (its section pattern would otherwise
      // grab a wrong "§ 3").
      BARE_UCC_RE.lastIndex = 0;
      while ((m = BARE_UCC_RE.exec(blockText)) !== null) {
        const s = m.index;
        const e = m.index + m[0].length;
        if (matchedSpans.some(([a, b]) => s < b && e > a)) continue;
        const key = `UCC § ${m.groups.sec}`;
        let url;
        try { url = resolveUrl({ kind: "statute", key }, repo, provider); } catch { continue; }
        if (!url) continue;
        const range = rangeForSpan(map, s, e);
        if (!range) continue;
        citations.push({ range, url, key, kind: "statute", clipEls });
        matchedSpans.push([s, e]);
      }

      BARE_SECTION_RE.lastIndex = 0;
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
        citations.push({ range, url, key, kind: "statute", clipEls });
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

    if (window.__citationLinker) window.__citationLinker.lastScanCitations = citations.length;

    paint();
    if (toaPanel) toaPanel.render(authorities, provider);
  }

  // Collect an element's overflow-clipping ancestors (those that visually clip
  // their content). Used to drop strips for citation text that's scrolled out
  // of such a container — e.g. a partially collapsed "thinking" panel — whose
  // getClientRects() would otherwise report a position over the main chat.
  function clipAncestorsOf(el) {
    const out = [];
    for (let p = el && el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      const clipsX = s.overflowX !== "visible";
      const clipsY = s.overflowY !== "visible";
      if (clipsX || clipsY) out.push({ el: p, clipsX, clipsY });
    }
    return out;
  }

  // True if the rect's center lies within every clipping ancestor's box — i.e.
  // the citation text is actually visible, not scrolled out of a clipped panel.
  function rectVisibleInClips(rect, clipEls) {
    if (!clipEls) return true;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    for (const { el, clipsX, clipsY } of clipEls) {
      const cr = el.getBoundingClientRect();
      if (clipsX && (cx < cr.left || cx > cr.right)) return false;
      if (clipsY && (cy < cr.top || cy > cr.bottom)) return false;
    }
    return true;
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

  // The message composer is a fixed bar at the bottom of the page; chat text
  // scrolls *behind* it. Because our overlay sits above everything (max
  // z-index), a citation strip whose rect lands under the composer would paint
  // its underline over the "write a message" box. Collect the composer's input
  // bar rect(s) so paint can drop those strips.
  function composerRects() {
    const rects = [];
    for (const ce of document.querySelectorAll("[contenteditable='true'], [contenteditable=''], textarea")) {
      // Prefer the surrounding fixed/sticky input bar (so its toolbar/padding is
      // covered too), else fall back to the editable element itself. Bounded
      // climb so this stays cheap on every scroll frame.
      let box = ce, p = ce.parentElement, depth = 0;
      while (p && p !== document.body && depth < 20) {
        const pos = getComputedStyle(p).position;
        if (pos === "fixed" || pos === "sticky") { box = p; break; }
        p = p.parentElement; depth++;
      }
      const r = box.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) rects.push(r);
    }
    return rects;
  }

  function rectIntersectsAny(rect, others) {
    for (const o of others) {
      if (rect.left < o.right && rect.right > o.left &&
          rect.top < o.bottom && rect.bottom > o.top) return true;
    }
    return false;
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
    const blockers = composerRects();
    for (const c of citations) {
      let rects;
      try { rects = c.range.getClientRects(); } catch { continue; }
      for (const rect of rects) {
        if (rect.width < 2 || rect.height < 2) continue;
        // Drop strips for text clipped out of a scrollable/collapsed container
        // (its rect would otherwise land over unrelated chat text).
        if (!rectVisibleInClips(rect, c.clipEls)) continue;
        // Drop strips that fall under the message composer (chat text scrolls
        // behind it, but our overlay would otherwise paint over the input box).
        if (rectIntersectsAny(rect, blockers)) continue;
        const a = document.createElement("a");
        a.href = c.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className = "cl-citation-link";
        a.dataset.kind = c.kind;
        a.title = `${c.key} → ${providerLabel()}`;
        a.draggable = false;
        a.addEventListener("dragstart", (ev) => ev.preventDefault());
        // Cover the whole citation rect so the entire phrase is an easy click
        // target; the CSS makes it transparent with only a colored bottom
        // border, so it still reads as an underline.
        a.style.left = `${rect.left}px`;
        a.style.top = `${rect.top}px`;
        a.style.width = `${rect.width}px`;
        a.style.height = `${rect.height}px`;
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
