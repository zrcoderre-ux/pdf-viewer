// find.js
//
// Find in document (Ctrl+F): every match highlighted, the current one in its
// own colour, Enter and Shift+Enter to step, match case and whole words.
//
// It reads the pages' own text layers — the same invisible spans text
// selection runs on — so a match is a DOM Range and is painted with the CSS
// Custom Highlight API (::highlight(find-match) in viewer.css) without
// touching the layer. The browser's own find could not do this job: the
// viewer's toolbar and tools sit over the page, and its find knows nothing of
// which page a match is on.

const QUOTES = { "‘": "'", "’": "'", "‚": "'", "‛": "'", "“": '"', "”": '"', "„": '"', "–": "-", "—": "-", "−": "-", " ": " ", "­": "" };

/**
 * A page's text as one searchable string. `raw` joins the text nodes in DOM
 * order (a <br> reads as a line break); `norm` is that with every run of
 * blank folded to one space and typographic quotes and dashes made plain;
 * `normToRaw[i]` is the raw offset of norm[i]; `nodes` maps raw offsets back
 * to text nodes.
 */
export function indexTextLayer(layer) {
  const nodes = [];
  let raw = "";
  const walk = (el) => {
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        const t = child.data;
        if (!t) continue;
        nodes.push({ node: child, start: raw.length, end: raw.length + t.length });
        raw += t;
      } else if (child.nodeName === "BR") {
        raw += "\n";
      } else if (child.nodeType === 1 && child.childNodes.length) {
        // pdf.js writes the gaps between words into the text itself, and a
        // line break as a <br>, so spans join as they stand.
        walk(child);
      }
    }
  };
  walk(layer);
  return { raw, nodes, ...normalize(raw) };
}

export function normalize(raw) {
  let norm = "";
  const normToRaw = [];
  let inSpace = false;
  for (let i = 0; i < raw.length; i++) {
    let ch = raw[i];
    if (ch in QUOTES) ch = QUOTES[ch];
    if (!ch) continue;
    if (/\s/.test(ch)) {
      if (inSpace || !norm.length) continue;
      inSpace = true;
      norm += " ";
      normToRaw.push(i);
      continue;
    }
    inSpace = false;
    norm += ch;
    normToRaw.push(i);
  }
  return { norm, normToRaw };
}

/** Every match of `query` in `norm`, as [start, end) pairs of norm offsets. */
export function findIn(norm, query, { caseSensitive = false, wholeWord = false } = {}) {
  const q = normalize(String(query || "")).norm.trim();
  if (!q) return [];
  const hay = caseSensitive ? norm : norm.toLowerCase();
  const needle = caseSensitive ? q : q.toLowerCase();
  const out = [];
  const isWord = (c) => !!c && /[\p{L}\p{N}_]/u.test(c);
  let i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) {
    const end = i + needle.length;
    if (!wholeWord || (!isWord(norm[i - 1]) && !isWord(norm[end]))) out.push([i, end]);
    i = end;
  }
  return out;
}

function rawToPoint(nodes, off) {
  // Binary search for the node holding raw offset `off`.
  let lo = 0, hi = nodes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const n = nodes[mid];
    if (off < n.start) hi = mid - 1;
    else if (off >= n.end) lo = mid + 1;
    else return { node: n.node, offset: off - n.start };
  }
  // Offsets that fall on a synthesized break: the start of the next node.
  const next = nodes.find((n) => n.start >= off);
  if (next) return { node: next.node, offset: 0 };
  const last = nodes[nodes.length - 1];
  return last ? { node: last.node, offset: last.node.data.length } : null;
}

export function createFind({ pagesEl, scrollToPage, onOpenChange = () => {} }) {
  const bar = document.getElementById("find-bar");
  const input = document.getElementById("find-input");
  const countEl = document.getElementById("find-count");
  const prevBtn = document.getElementById("find-prev");
  const nextBtn = document.getElementById("find-next");
  const caseEl = document.getElementById("find-case");
  const wordEl = document.getElementById("find-word");
  const closeBtn = document.getElementById("find-close");
  const toggleBtn = document.getElementById("find-toggle");
  const supported = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined";

  let index = new Map();   // page -> { layer, ...indexTextLayer }
  let matches = [];        // [{ pn, range }]
  let current = -1;
  let timer = 0;

  function pageLayers() {
    return [...pagesEl.querySelectorAll(".page-wrapper")].map((w) => ({ pn: Number(w.dataset.pageNumber), layer: w.querySelector(".textLayer") })).filter((x) => x.layer);
  }
  function ensureIndex() {
    for (const { pn, layer } of pageLayers()) {
      const cached = index.get(pn);
      if (cached && cached.layer === layer && cached.size === layer.childNodes.length) continue;
      index.set(pn, { layer, size: layer.childNodes.length, ...indexTextLayer(layer) });
    }
  }

  function search(query, opts) {
    ensureIndex();
    const out = [];
    for (const [pn, ix] of [...index.entries()].sort((a, b) => a[0] - b[0])) {
      if (!ix.layer.isConnected) continue;
      for (const [s, e] of findIn(ix.norm, query, opts)) {
        const a = rawToPoint(ix.nodes, ix.normToRaw[s]);
        const b = rawToPoint(ix.nodes, ix.normToRaw[e - 1] + 1);
        if (!a || !b) continue;
        const range = document.createRange();
        try { range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset); } catch { continue; }
        out.push({ pn, range });
      }
    }
    return out;
  }

  function paint() {
    if (!supported) return;
    CSS.highlights.delete("find-match");
    CSS.highlights.delete("find-current");
    if (!matches.length) return;
    CSS.highlights.set("find-match", new Highlight(...matches.map((m) => m.range)));
    if (current >= 0 && matches[current]) CSS.highlights.set("find-current", new Highlight(matches[current].range));
  }
  function showCount() {
    const q = input.value.trim();
    countEl.classList.toggle("none", !!q && !matches.length);
    countEl.textContent = !q ? " " : matches.length ? `${current + 1} of ${matches.length}` : "No results";
    prevBtn.disabled = nextBtn.disabled = matches.length < 2 && !(matches.length === 1 && current < 0);
  }
  function reveal(i) {
    const m = matches[i];
    if (!m) return;
    const place = () => {
      const r = m.range.getBoundingClientRect();
      if (!r.width && !r.height) return false;
      const topBar = 52 + 60;
      if (r.top < topBar || r.bottom > window.innerHeight - 40) {
        window.scrollBy({ top: r.top - window.innerHeight / 3, behavior: "auto" });
      }
      if (r.left < 0 || r.right > window.innerWidth) window.scrollBy({ left: r.left - window.innerWidth / 2 });
      return true;
    };
    if (!place()) { scrollToPage(m.pn, { smooth: false }); requestAnimationFrame(place); }
  }
  function go(dir) {
    if (!matches.length) return;
    if (current < 0) {
      // Start from what is on screen (below the toolbar), not the top of the
      // document.
      const top = 60;
      current = matches.findIndex((m) => m.range.getBoundingClientRect().top >= top);
      if (current < 0) current = 0;
      if (dir < 0) current = (current - 1 + matches.length) % matches.length;
    } else current = (current + dir + matches.length) % matches.length;
    paint();
    showCount();
    reveal(current);
  }
  function run({ keepPlace = false } = {}) {
    const q = input.value;
    const prevPn = keepPlace && matches[current] ? matches[current].pn : null;
    matches = q.trim() ? search(q, { caseSensitive: caseEl.checked, wholeWord: wordEl.checked }) : [];
    current = -1;
    if (prevPn != null) current = matches.findIndex((m) => m.pn >= prevPn);
    paint();
    showCount();
    if (!keepPlace && matches.length) go(1);
  }

  function open(text = "") {
    bar.hidden = false;
    toggleBtn?.setAttribute("aria-pressed", "true");
    if (text) input.value = text;
    input.focus();
    input.select();
    if (input.value.trim()) run();
    onOpenChange(true);
  }
  function close() {
    bar.hidden = true;
    toggleBtn?.setAttribute("aria-pressed", "false");
    matches = [];
    current = -1;
    paint();
    onOpenChange(false);
  }

  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => run(), 160); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer); if (!matches.length || input.dataset.q !== input.value) { input.dataset.q = input.value; run(); } else go(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  });
  prevBtn.addEventListener("click", () => go(-1));
  nextBtn.addEventListener("click", () => go(1));
  closeBtn.addEventListener("click", close);
  caseEl.addEventListener("change", () => run());
  wordEl.addEventListener("change", () => run());
  toggleBtn?.addEventListener("click", () => (bar.hidden ? open(selectedText()) : close()));

  function selectedText() {
    const s = window.getSelection();
    const t = s && !s.isCollapsed ? s.toString().replace(/\s+/g, " ").trim() : "";
    return t.length <= 200 ? t : "";
  }

  return {
    open,
    close,
    isOpen: () => !bar.hidden,
    /** A new document: forget the old one's text. */
    reset() { index = new Map(); matches = []; current = -1; paint(); if (!bar.hidden) showCount(); },
    /** The pages were rebuilt (zoom, rotation): read them again and keep the place. */
    pagesRebuilt() { index = new Map(); if (!bar.hidden && input.value.trim()) run({ keepPlace: true }); },
    /** Every match as { pn, range }, for tools that act on them (redact by search). */
    findAll(query, opts = {}) { return search(query, opts); },
  };
}
