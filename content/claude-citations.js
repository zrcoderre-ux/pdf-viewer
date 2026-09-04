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
//   scan()  — walk visible text nodes into ONE page-wide string, run
//             findAllCitations over it, map each hit back to a DOM Range,
//             resolve its URL.
//   paint() — read getClientRects() for each Range and lay down underline
//             strips. Cheap; safe to run on every scroll frame.
// scan() runs (debounced) on DOM mutations; paint() runs (rAF-throttled) on
// scroll/resize. Provider / repo changes trigger a re-scan.
//
// A chat page is not a document, and two consequences follow. It unmounts what
// scrolls out of view, so scan() also feeds a per-URL memory (citation-memory.js):
// the Table of Authorities lists everything found on the page so far rather than
// only what is mounted right now, and a case cited in a message no longer in the
// DOM is still available for an italicized short name further down to resolve
// against. And a short-form reference points back to a full cite in an earlier
// paragraph, which is why the page is scanned as one string instead of block by
// block.

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
  // code name. Used by the single-code inheritance pass below. The shape is
  // wide enough for federal sections too — the C.F.R. and the U.S. Code both
  // put dots and hyphens inside one section number ("§ 2560.503-1"), and a
  // bare reference that inherits a federal code has to keep the whole thing.
  const BARE_SECTION_RE =
    /(?:§§?|sections?|secs?\.?)\s*(?<sec>\d+(?:\.\d+)*[a-z]{0,3}(?:-\d+[a-z]{0,3})?(?:\([a-z0-9]+\))*)/gi;

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
  let memory = null;            // per-URL citation memory (citation-memory.js)
  let memoryApi = null;         // its module (storage-key helpers + pruning)
  let savedRevision = -1;       // memory.revision as last written to storage
  let saveTimer = null;

  let provider = "lexis";       // matches the PDF viewer default
  let repo = {};
  let citations = [];           // [{ range, url, key, kind }]
  let authorities = [];         // deduped [{ key, kind, url }] for the TOA
  let overlayEl = null;
  let suppressed = false;      // true on a site the user excepted in Options

  const providerLabel = () => (provider === "westlaw" ? "Westlaw" : "Lexis+");

  // ── Setup ──────────────────────────────────────────────────────────────────

  // Sites listed as exceptions in Options never get citation links. The
  // background worker already keeps them out of its dynamic registration, but
  // the claude.ai injection is static in manifest.json and can't be excluded
  // that way — so the check has to be enforceable from in here too.
  function isExceptedSite() {
    const rules = window.CitationSiteRules;
    if (!rules) return Promise.resolve(false);
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        { citationSiteExceptions: rules.DEFAULT_EXCEPTIONS },
        ({ citationSiteExceptions }) => {
          resolve(rules.isExcepted(location.href, citationSiteExceptions));
        }
      );
    });
  }

  // Stop linking without a reload — the overlay comes down, the TOA empties,
  // and scan() becomes a no-op until the site is taken off the list.
  function setSuppressed(next) {
    if (next === suppressed) return;
    suppressed = next;
    if (suppressed) {
      citations = [];
      authorities = [];
      if (memory) memory.clear();
      paint();
      if (toaPanel) toaPanel.render([], provider);
      window.__citationLinker = { active: false, reason: "site excepted in Options", host: location.host };
    } else {
      window.__citationLinker = { active: true, host: location.host, lastScanCitations: 0 };
      scan();
    }
  }

  async function init() {
    if (await isExceptedSite()) {
      suppressed = true;
      window.__citationLinker = { active: false, reason: "site excepted in Options", host: location.host };
      console.info(`[Citation Linker] ${location.host} is listed as an exception in Options — not linking here.`);
      return;
    }

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

    // The per-URL memory is what keeps an authority listed after the app has
    // unmounted the message it came from. Optional in the same sense as the
    // panel: without it the TOA falls back to listing only what is on screen.
    try {
      memoryApi = await import(chrome.runtime.getURL("viewer/citation-memory.js"));
      memory = memoryApi.createCitationMemory();
    } catch (e) {
      memory = null;
      memoryApi = null;
      console.warn("[Citation Linker] Citation memory unavailable on this site:", e);
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
      if (area === "sync" && changes.citationSiteExceptions) {
        const rules = window.CitationSiteRules;
        const list = changes.citationSiteExceptions.newValue;
        if (rules) setSuppressed(rules.isExcepted(location.href, list || []));
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

    // A reload is what the debounce would otherwise lose: write on the way out
    // so the last authorities found are in storage before the page goes.
    window.addEventListener("pagehide", flushSave);

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

  // Blocks are joined by a paragraph break — a hard stop for the detector — so
  // reading the page as one string doesn't invent a citation that runs out of
  // one paragraph and into the next. Anything that slips past it anyway is
  // dropped by the segment check in addCitation().
  const BLOCK_SEP = "\n\n";

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 400);
  }

  function scan() {
    if (suppressed || !findAllCitations) return;
    // Another conversation is another set of authorities. The same one — its
    // query string and #hash aside — keeps everything found on it so far.
    // A page the reader is returning to — after a reload, or after a trip to
    // another conversation and back — brings its saved table with it.
    if (memory && memory.setUrl(location.href)) hydrateFromStorage();
    citations = [];

    // The page is read as ONE string rather than block by block. Short-form
    // references point BACKWARD — "Aguilar, supra", an italicized "Market
    // Lofts" — and the full citation they resolve against is usually in an
    // earlier paragraph, which a per-block scan can't see.
    let docText = "";
    const nodes = [];      // { node, start, end }, document order, doc offsets
    const segments = [];   // { start, end, clipEls } per contiguous block run
    const italicRanges = [];
    let currentBlock = null;
    let segment = null;

    // Case names are italicized and almost nothing else is, so an italic run
    // repeating part of a case cited earlier is a reference to it. Posture is
    // read per parent element and cached — getComputedStyle on every text node
    // of a long page is far too expensive.
    const italicCache = new WeakMap();
    const isItalicEl = (el) => {
      let cached = italicCache.get(el);
      if (cached === undefined) {
        let style = null;
        try { style = getComputedStyle(el); } catch { style = null; }
        cached = !!style && style.fontStyle !== "normal";
        italicCache.set(el, cached);
      }
      return cached;
    };

    // Overflow-clipping ancestors of a block — used at paint time to drop
    // strips for text scrolled out of a clipped container (e.g. a partially
    // collapsed "thinking" panel) so they don't land over the main chat.
    const clipCache = new Map();
    const clipsFor = (block) => {
      let c = clipCache.get(block);
      if (c === undefined) clipCache.set(block, (c = clipAncestorsOf(block)));
      return c;
    };

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
      // A new block (or a return to one after a nested block interrupted it)
      // starts a new segment, separated from the last by a paragraph break.
      if (block !== currentBlock) {
        if (docText) docText += BLOCK_SEP;
        currentBlock = block;
        segment = { start: docText.length, end: docText.length, clipEls: clipsFor(block) };
        segments.push(segment);
      }
      const start = docText.length;
      docText += node.nodeValue;
      const end = docText.length;
      nodes.push({ node, start, end });
      segment.end = end;
      if (isItalicEl(parent)) italicRanges.push([start, end]);
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

    let hits = [];
    if (docText.length >= 6) {
      try {
        hits = findAllCitations(docText, {
          italicRanges,
          // Cases already seen on this page. An app that unmounts what scrolls
          // out of view takes the full citation with it, and without this an
          // italicized "Market Lofts" further down would have nothing left to
          // resolve against.
          priorCases: memory ? memory.priorCases() : [],
        });
      } catch { hits = []; }
    }

    const matchedSpans = [];
    const markers = [];   // { pos, code, kind } where a code is named

    // Link one detected citation and remember its authority. A match running
    // past the end of the block it starts in is an artifact of reading the page
    // as one string — two adjacent blocks that happen to read as one sentence —
    // and is dropped, because no reader sees one citation there.
    const addCitation = (cite) => {
      const seg = segmentFor(segments, cite.span[0]);
      if (!seg || cite.span[1] > seg.end) return;
      let url;
      try { url = resolveUrl(cite, repo, provider); } catch { return; }
      if (!url) return;
      // Remembered before the range is built: an authority the reader has seen
      // is still an authority even if we can't map it back to a paintable range.
      if (memory) memory.remember(cite, url);
      const range = rangeForSpan(nodes, cite.span[0], cite.span[1]);
      if (!range) return;
      citations.push({ range, url, key: cite.key, kind: cite.kind, clipEls: seg.clipEls });
    };

    for (const cite of hits) {
      matchedSpans.push(cite.span);
      if (cite.kind === "statute" || cite.kind === "regulation") {
        const i = cite.key.indexOf(" § ");
        if (i > 0) {
          markers.push({ pos: cite.span[0], code: cite.key.slice(0, i), kind: cite.kind });
        }
      }
      addCitation(cite);
    }
    markers.sort((a, b) => a.pos - b.pos);

    // Bare model-UCC sections first ("§ 3-310"): identified by the hyphen
    // alone, so no carry-forward is needed. Recorded into matchedSpans so the
    // carry-forward pass below skips them (its section pattern would otherwise
    // grab a wrong "§ 3").
    let m;
    BARE_UCC_RE.lastIndex = 0;
    while ((m = BARE_UCC_RE.exec(docText)) !== null) {
      const s = m.index;
      const e = m.index + m[0].length;
      if (matchedSpans.some(([a, b]) => s < b && e > a)) continue;
      addCitation({ kind: "statute", key: `UCC § ${m.groups.sec}`, span: [s, e] });
      matchedSpans.push([s, e]);
    }

    // Carry-forward inheritance: a bare "§ N" / "section N" reference (no code
    // name of its own) inherits the most recently NAMED code that appears
    // before it in reading order. Bare sections before any code is ever named
    // stay unlinked (nothing to inherit). The single-named-code case is just
    // the special case where every bare section follows that one code. The
    // kind travels with the code, so a section inheriting "Treas. Reg." is
    // still grouped and colored as a regulation, not a statute.
    BARE_SECTION_RE.lastIndex = 0;
    while ((m = BARE_SECTION_RE.exec(docText)) !== null) {
      const s = m.index;
      const e = m.index + m[0].length;
      // Skip references already covered by a full citation above.
      if (matchedSpans.some(([a, b]) => s < b && e > a)) continue;
      // Nearest code named at or before this section.
      let code = null;
      for (const mk of markers) {
        if (mk.pos <= s) code = mk;
        else break;
      }
      if (!code) continue;
      addCitation({ kind: code.kind, key: `${code.code} § ${m.groups.sec}`, span: [s, e] });
    }

    // The Table of Authorities is CUMULATIVE for as long as the reader stays on
    // this page. A chat app unmounts the messages that scroll out of view, so a
    // list rebuilt from the live DOM would drop authorities as the reader
    // scrolled past them — the panel emptying itself behind you.
    authorities = memory
      ? memory.authorities((c) => resolveUrl(c, repo, provider))
      : dedupeAuthorities(citations);

    if (window.__citationLinker) {
      window.__citationLinker.lastScanCitations = citations.length;
      window.__citationLinker.authorities = authorities.length;
    }

    paint();
    if (toaPanel) toaPanel.render(authorities, provider);
    scheduleSave();
  }

  // ── Persistence: the table survives a reload ────────────────────────────────
  //
  // A refresh is not a new conversation, so it must not empty the panel. Each
  // page's record lives under its own chrome.storage.local key, with one small
  // index recording when each was last seen — so a save writes back only the
  // conversation being read, and the history stays bounded (see prunePageIndex).

  function hydrateFromStorage() {
    if (!memory || !memoryApi || !memory.url) return;
    const key = memory.url;
    chrome.storage.local.get({ [memoryApi.pageStoreKey(key)]: null }, (got) => {
      if (chrome.runtime.lastError) return;
      // The reader may have moved on while storage was answering.
      if (!memory || memory.url !== key) return;
      if (!memory.hydrate(got[memoryApi.pageStoreKey(key)])) return;
      // savedRevision is deliberately left alone: the scan that ran while
      // storage was answering may have found authorities the stored record
      // doesn't have, and those still need writing back.
      authorities = memory.authorities((c) => resolveUrl(c, repo, provider));
      if (toaPanel) toaPanel.render(authorities, provider);
    });
  }

  function scheduleSave() {
    if (!memory || !memoryApi || memory.revision === savedRevision) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveToStorage, 1500);
  }

  function flushSave() {
    if (!memory || !memoryApi || memory.revision === savedRevision) return;
    clearTimeout(saveTimer);
    saveToStorage();
  }

  function saveToStorage() {
    if (!memory || !memoryApi || !memory.url) return;
    const key = memory.url;
    const storeKey = memoryApi.pageStoreKey(key);
    chrome.storage.local.get(
      { [memoryApi.PAGE_INDEX_KEY]: {}, [storeKey]: null },
      (got) => {
        if (chrome.runtime.lastError || !memory || memory.url !== key) return;
        // Another tab may have written this same conversation since we last
        // read it. Merging rather than overwriting keeps both tabs' findings.
        memory.hydrate(got[storeKey]);
        const now = Date.now();
        const { index, dropped } = memoryApi.prunePageIndex({
          ...(got[memoryApi.PAGE_INDEX_KEY] || {}),
          [key]: now,
        });
        const rev = memory.revision;
        const write = { [memoryApi.PAGE_INDEX_KEY]: index, [storeKey]: { at: now, ...memory.toJSON() } };
        chrome.storage.local.set(write, () => {
          if (chrome.runtime.lastError) {
            console.warn("[Citation Linker] Could not save the Table of Authorities:",
              chrome.runtime.lastError.message);
            return;
          }
          if (memory && memory.url === key) savedRevision = rev;
        });
        // Records the index no longer carries are dead weight.
        const stale = dropped.filter((k) => k !== key).map(memoryApi.pageStoreKey);
        if (stale.length) chrome.storage.local.remove(stale, () => chrome.runtime.lastError);
      }
    );
  }

  // Used only if the memory module didn't load: the authorities visible in
  // this scan, deduped by key (the in-text underlines keep every occurrence;
  // the TOA lists each authority once).
  function dedupeAuthorities(list) {
    const seen = new Map();
    for (const c of list) {
      if (!seen.has(c.key)) seen.set(c.key, { key: c.key, kind: c.kind, url: c.url });
    }
    return [...seen.values()];
  }

  // The segment — one contiguous run of text in a single block — that a
  // document offset falls in. Binary search: a long chat has thousands.
  function segmentFor(segments, pos) {
    let lo = 0, hi = segments.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const seg = segments[mid];
      if (pos < seg.start) hi = mid - 1;
      else if (pos >= seg.end) lo = mid + 1;
      else return seg;
    }
    return null;
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

  // Map a [start, end) offset within the page's concatenated text to a DOM
  // Range. Offsets that begin on a block separator belong to no node and get
  // no range.
  function rangeForSpan(nodes, s, e) {
    let lo = 0, hi = nodes.length - 1, i = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const n = nodes[mid];
      if (s < n.start) hi = mid - 1;
      else if (s >= n.end) lo = mid + 1;
      else { i = mid; break; }
    }
    if (i === -1) return null;
    let j = i;
    while (j < nodes.length && e > nodes[j].end) j++;
    if (j >= nodes.length || e <= nodes[j].start) return null;
    try {
      const r = document.createRange();
      r.setStart(nodes[i].node, s - nodes[i].start);
      r.setEnd(nodes[j].node, e - nodes[j].start);
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

  // Shift+Space ("open every link the selection covers", shift-space-open.js —
  // same extension, same isolated world) can only see the strips paint() has
  // drawn, and paint() deliberately skips citations scrolled out of view. So a
  // selection running past the bottom of the screen would stop at the last
  // visible citation. Hand over the whole inventory instead, measured from the
  // Ranges themselves, which exist whether or not a strip was drawn.
  (window.__shiftSpaceLinkSources = window.__shiftSpaceLinkSources || []).push(() => {
    const out = [];
    for (const c of citations) {
      let rects;
      try { rects = c.range.getClientRects(); } catch (e) { continue; }
      if (rects.length) out.push({ url: c.url, rects: [...rects] });
    }
    return out;
  });

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
