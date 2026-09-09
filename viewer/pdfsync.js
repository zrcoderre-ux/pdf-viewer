// pdfsync.js — the decisions behind the text reader's PDF pane: which PDF in
// the case folder an export came from, which PDF page a text page shows, and
// the page ranges an operator types to swap pages in. Pure (no DOM), tested
// from Node in test-pdfsync.mjs.
//
// PDF-Linker names an export for its source's SCRUBBED stem: the PDF keeps
// its real name in the case folder ("Rasho v Quillmark - MTC.pdf"), the
// export in Text Files is that stem run through the pseudonymizer with its
// separators spaced ("Strangeways v Melbury - MTC.txt"). So an export is
// matched to a PDF by translating each PDF's stem FORWARD through the key
// and comparing — and, for a Word export or a run before filename
// scrubbing, by the bare stem too. A Combined Text.txt names each member in
// its banner, so its pages are matched document by document.

/** A file name's stem, extensions off (.pdf, .txt, .txt.LEAK), separators spaced, case folded. */
export function normalizeStem(name) {
  let s = String(name == null ? "" : name).split(/[\\/]/).pop();
  s = s.replace(/\.txt\.leak$/i, "").replace(/\.(txt|pdf|docx?)$/i, "");
  return spaceStem(s).toLowerCase();
}
/** PDF-Linker's own normalisation of a stem before it is scrubbed (_pn_scrubbed_stem). */
export function spaceStem(stem) {
  return String(stem == null ? "" : stem).replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The PDF an export came from: `pdfNames` are the case folder's PDFs,
 * `forward(text)` translates real → fake through the key (may be null). The
 * matching name, or null. A scrubbed match beats a bare one only in that
 * both are tried; the first PDF matching either wins, in the order given.
 */
export function matchPdf(exportName, pdfNames, forward) {
  const want = normalizeStem(exportName);
  if (!want) return null;
  const fwd = typeof forward === "function" ? forward : null;
  for (const pdf of pdfNames || []) {
    const stem = normalizeStem(pdf);
    if (stem === want) return pdf;
    if (fwd) {
      let faked = "";
      try { faked = fwd(spaceStem(String(pdf).replace(/\.pdf$/i, ""))); } catch { faked = ""; }
      if (faked && spaceStem(faked).toLowerCase() === want) return pdf;
    }
  }
  return null;
}

/**
 * Per text page, the name of the DOCUMENT it belongs to: a Combined Text.txt
 * member's banner name for the pages under that banner, else the file's own
 * name. One entry per page, in page order.
 */
export function pageSources(pages, fileName) {
  const out = [];
  let cur = fileName || "";
  for (const p of pages || []) {
    if (p.banner != null) {
      const m = String(p.banner).match(/^#+ DOCUMENT \d+ OF \d+ IN THIS COMBINED FILE: (.+?) #+$/);
      if (m) cur = m[1];
    }
    out.push(cur);
  }
  return out;
}

/** The PDF page a text page shows: its header's PDF number, else null. */
export function pdfPageOf(page) {
  const n = page && page.number;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * "5, 12-18, 7" → { pages: [5, 7, 12, 13, …, 18], bad: [] } — sorted, unique,
 * within 1..max (a number past `max` is reported in `bad`, not dropped
 * silently). Separators: commas, semicolons, spaces; a range is "a-b" or
 * "a–b" (en dash), either order.
 */
export function parsePageRanges(text, max) {
  const pages = new Set();
  const bad = [];
  const lim = Number.isInteger(max) && max > 0 ? max : Infinity;
  const src = String(text == null ? "" : text).replace(/\s*[-–—]\s*/g, "-");
  for (const tok of src.split(/[,;\s]+/)) {
    if (!tok) continue;
    const m = tok.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) { bad.push(tok); continue; }
    let a = parseInt(m[1], 10), b = m[2] == null ? a : parseInt(m[2], 10);
    if (a > b) [a, b] = [b, a];
    if (a < 1 || b > lim || b - a > 5000) { bad.push(tok); continue; }
    for (let n = a; n <= b; n++) pages.add(n);
  }
  return { pages: [...pages].sort((x, y) => x - y), bad };
}

/** [5, 7, 12, 13, 14] → "5, 7, 12-14". */
export function formatPageRanges(pages) {
  const ns = [...new Set((pages || []).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    out.push(j > i + 1 ? `${ns[i]}-${ns[j]}` : j === i + 1 ? `${ns[i]}, ${ns[j]}` : String(ns[i]));
    i = j;
  }
  return out.join(", ");
}

/** The localStorage key remembering which pages of a document are swapped. */
export function swapStoreKey(folderName, fileName) {
  return "textReader.swaps." + (folderName || "") + "/" + (fileName || "");
}

/**
 * Where the reader is in a scroll box, as a page index plus the fraction of
 * that page scrolled past: `tops`/`heights` are the pages' offsets and
 * heights in the box. Used to hold the PDF pane and the text side by side
 * page for page, whatever their heights.
 */
export function scrollPosition(scrollTop, tops, heights) {
  const n = Math.min(tops.length, heights.length);
  if (!n) return { index: 0, fraction: 0, above: 0 };
  // Above the first page (the box's own top padding): so many pixels short
  // of it, carried as pixels so the other box lands at ITS top, not 20px in.
  if (scrollTop < tops[0]) return { index: 0, fraction: 0, above: tops[0] - scrollTop };
  for (let i = 0; i < n; i++) {
    const bottom = tops[i] + heights[i];
    if (scrollTop < bottom || i === n - 1) {
      const h = heights[i] > 0 ? heights[i] : 1;
      const f = Math.max(0, Math.min(1, (scrollTop - tops[i]) / h));
      return { index: i, fraction: f, above: 0 };
    }
  }
  return { index: n - 1, fraction: 1, above: 0 };
}
/** The scrollTop that puts `pos` (from scrollPosition) at the top of a box laid out with `tops`/`heights`. */
export function scrollTopFor(pos, tops, heights) {
  if (!tops.length) return 0;
  const i = Math.max(0, Math.min(tops.length - 1, pos.index));
  return Math.max(0, tops[i] + (heights[i] || 0) * (pos.fraction || 0) - (pos.above || 0));
}

/**
 * Page geometry for the sync ANCHORED ON THE FIRST LINE of each page:
 * `anchors` are the tops of each page's first printed line in the box,
 * `end` the bottom of the last page. A page's span runs from its own first
 * line to the next page's, so when one box has a page's first line at its
 * top the other has that page's first line at its top too — the text's
 * page label and the PDF's top margin fall out of the mapping.
 */
export function anchorGeometry(anchors, end) {
  const tops = (anchors || []).map((a) => Number(a) || 0);
  const heights = tops.map((t, i) => Math.max(1, (i + 1 < tops.length ? tops[i + 1] : Number(end) || t + 1) - t));
  return { tops, heights };
}

// ---- the PDF page's own line geometry ---------------------------------------
//
// Pleading paper prints its line numbers down the left margin, and a PDF's
// text layer (the filer's own or an OCR's) carries them as text items: a
// bare "1".."28" standing at the left. From those the page's LINE GRID is
// read — where line 1 sits, the pitch between lines, and where the body
// text begins — so a text page can be laid out on the same grid and its
// line 7 stands exactly beside the PDF's line 7.

function median(xs) {
  const a = xs.slice().sort((p, q) => p - q);
  return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : NaN;
}

/**
 * `items` are the page's text items as [{ str, x, top, w, h }] in PDF units
 * with a top-left origin; `size` is { w, h }. Returns
 * { y1, pitch, first, last, bodyX, numberRight } — the top of line 1's
 * number, the distance between lines, the numbers seen, and where the body
 * text starts — or null where fewer than three line numbers stand in the
 * margin or they do not fall on one grid.
 */
export function pleadingGeometry(items, size) {
  const w = (size && size.w) || 612;
  const cands = new Map();
  for (const it of items || []) {
    const m = /^\s*(\d{1,2})\s*$/.exec(it.str || "");
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n < 1 || n > 40 || !(it.x < w * 0.25)) continue;
    if (!cands.has(n)) cands.set(n, []);
    cands.get(n).push({ n, top: it.top, x: it.x, right: it.x + (it.w || 0) });
  }
  if (cands.size < 3) return null;
  // One per number: the one nearest the left edge (a "3" in the body is not it).
  let pts = [...cands.values()].map((c) => c.slice().sort((a, b) => a.x - b.x)[0]).sort((a, b) => a.n - b.n);
  const fit = (ps) => {
    const pitches = [];
    for (let i = 1; i < ps.length; i++) pitches.push((ps[i].top - ps[i - 1].top) / (ps[i].n - ps[i - 1].n));
    const pitch = median(pitches);
    const y1 = median(ps.map((q) => q.top - (q.n - 1) * pitch));
    return { pitch, y1 };
  };
  let { pitch, y1 } = fit(pts);
  if (!(pitch > 0)) return null;
  // Drop what does not sit on the grid (a footnote's "2", an exhibit number), then refit.
  const kept = pts.filter((q) => Math.abs(q.top - (y1 + (q.n - 1) * pitch)) < pitch / 2);
  if (kept.length < 3) return null;
  pts = kept;
  ({ pitch, y1 } = fit(pts));
  if (!(pitch > 0)) return null;
  const numberRight = Math.max(...pts.map((q) => q.right));
  const first = pts[0].n, last = pts[pts.length - 1].n;
  const bandTop = y1 - pitch, bandBottom = y1 + last * pitch;
  let bodyX = Infinity;
  for (const it of items || []) {
    if (!it.str || !it.str.trim() || /^\s*\d{1,2}\s*$/.test(it.str)) continue;
    if (it.x <= numberRight + 1 || it.top < bandTop || it.top > bandBottom) continue;
    if (it.x < bodyX) bodyX = it.x;
  }
  if (!isFinite(bodyX)) bodyX = numberRight + pitch;
  return { y1, pitch, first, last, bodyX, numberRight };
}

/** The top of line `n` on the grid. */
export function lineTop(geom, n) {
  return geom.y1 + (n - 1) * geom.pitch;
}

/**
 * Where each of a text page's lines goes on the PDF's grid: a numbered line
 * at its number; an unnumbered line under the numbered line before it, a
 * pitch further down for each (a foot line after 28 sits below 28); lines
 * before the first numbered one stack upward from it (an e-filing stamp).
 * `lines` are [{ num }] (the gutter number or null); returns tops in PDF
 * units, null where the page has no numbered line to hang anything on.
 */
export function slotTops(lines, geom) {
  const out = (lines || []).map(() => null);
  if (!geom) return out;
  const firstIdx = (lines || []).findIndex((l) => l && l.num);
  if (firstIdx < 0) return out;
  let last = null, k = 0;
  (lines || []).forEach((l, i) => {
    if (l && l.num) { last = lineTop(geom, l.num); k = 0; out[i] = last; }
    else if (last != null) { k++; out[i] = last + k * geom.pitch; }
  });
  for (let i = 0; i < firstIdx; i++) out[i] = Math.max(0, lineTop(geom, lines[firstIdx].num) - (firstIdx - i) * geom.pitch);
  return out;
}

// ---- a page with no numbers: the PDF's printed rows, matched by their words ------
//
// An exhibit, a letter, an order: no margin numbers to hang the lines on,
// but the PDF's text layer still says where every printed ROW sits, and the
// export's lines are those rows written out — the same words, scrubbed. So
// the lines are matched to the rows by the words they share, in order (a
// monotone alignment, the shape of a diff), and each matched line takes its
// row's own top and left. A line no row claims sits under the line before
// it; a blank export line is the gap the page really had.

/** The page's printed rows from its text items: [{ top, left, height, text }] sorted down the page. */
export function pdfRows(items, size) {
  const rows = [];
  const sorted = (items || []).filter((it) => it.str && it.str.trim()).slice().sort((a, b) => a.top - b.top || a.x - b.x);
  for (const it of sorted) {
    const h = it.h || 10;
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.top - last.top) <= Math.max(2, Math.min(h, last.height) * 0.6)) {
      last.items.push(it);
      last.top = Math.min(last.top, it.top);
      last.height = Math.max(last.height, h);
    } else rows.push({ top: it.top, height: h, items: [it] });
  }
  return rows.map((r) => {
    const its = r.items.slice().sort((a, b) => a.x - b.x);
    return { top: r.top, left: its[0].x, height: r.height, text: its.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim() };
  });
}

function wordSet(s) {
  return new Set((String(s || "").toLowerCase().match(/[a-z0-9]{2,}/g) || []));
}
/** How alike two lines are: the share of words they have in common (0..1). */
export function lineSimilarity(a, b) {
  const A = wordSet(a), B = wordSet(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / Math.max(A.size, B.size);
}

/**
 * Which row each line is, in order: `lines` and `rows` are texts; returns an
 * array, per line, of the row index or null. A pair counts only where it
 * shares at least `min` of its words; a line with no words (a blank) is
 * never matched.
 */
export function alignLines(lines, rows, min = 0.25) {
  const n = (lines || []).length, m = (rows || []).length;
  const out = new Array(n).fill(null);
  if (!n || !m) return out;
  const sim = lines.map((l) => rows.map((r) => { const v = lineSimilarity(l, r); return v >= min ? v : 0; }));
  // Longest-common-subsequence with weights: best[i][j] over the first i lines and j rows.
  const best = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let v = Math.max(best[i - 1][j], best[i][j - 1]);
      if (sim[i - 1][j - 1] > 0) v = Math.max(v, best[i - 1][j - 1] + sim[i - 1][j - 1]);
      best[i][j] = v;
    }
  }
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (sim[i - 1][j - 1] > 0 && best[i][j] === best[i - 1][j - 1] + sim[i - 1][j - 1]) { out[i - 1] = j - 1; i--; j--; }
    else if (best[i - 1][j] >= best[i][j - 1]) i--;
    else j--;
  }
  return out;
}

/**
 * Where each line goes on a page with no number grid: matched lines at their
 * row's top and left; the others under the line before them, a pitch apart
 * (the median distance between matched rows); leading ones stack up from the
 * first match. Returns [{ top, left, size }] per line — `size` the matched
 * row's own type height, null for a line no row claims — or null where
 * nothing matched at all, plus the pitch.
 */
export function rowLayout(lineTexts, rows) {
  const map = alignLines(lineTexts, rows.map((r) => r.text));
  const matched = map.map((j, i) => (j == null ? null : i)).filter((i) => i != null);
  if (!matched.length) return null;
  const tops = matched.map((i) => rows[map[i]].top);
  // The pitch is read between lines the export wrote ADJACENT (no blank
  // between): a blank line stands for a gap the page really had.
  const adjacent = [], stepped = [];
  for (let k = 1; k < tops.length; k++) {
    if (!(tops[k] > tops[k - 1])) continue;
    const step = matched[k] - matched[k - 1];
    (step === 1 ? adjacent : stepped).push((tops[k] - tops[k - 1]) / step);
  }
  const med = (xs) => { const a = xs.slice().sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
  const pitch = adjacent.length ? med(adjacent) : stepped.length ? med(stepped) : rows[map[matched[0]]].height * 1.2;
  const left0 = Math.min(...rows.map((r) => r.left));
  const out = new Array(lineTexts.length).fill(null);
  let last = null, k = 0;
  lineTexts.forEach((_, i) => {
    if (map[i] != null) { last = rows[map[i]].top; k = 0; out[i] = { top: last, left: rows[map[i]].left, size: rows[map[i]].height }; }
    else if (last != null) { k++; out[i] = { top: last + k * pitch, left: left0, size: null }; }
  });
  const first = matched[0];
  for (let i = 0; i < first; i++) out[i] = { top: Math.max(0, rows[map[first]].top - (first - i) * pitch), left: left0, size: null };
  return { positions: out, pitch };
}

// ---- the type a text page is set in beside its PDF page ----------------------
//
// A page is a page: the type keeps its own spacing whatever size it is set
// at, the way a PDF does, so zooming in must never push two lines together.
// And the PDF's type sets the text's. The reading size is the size of the
// BODY type — the PDF's body drawn at that size fixes the scale, and the
// sheet, the line grid, the margins and the PDF page beside it are all
// drawn at it, so the two are one size to the eye at any zoom — while each
// line takes its own row's size where the PDF varies (a heading, a
// footnote, the small print of an exhibit), so a page of tight rows fits
// them instead of being pushed down. A size too big for the pane grows the
// page past its edge, where the horizontal scroll bar reaches it.

/**
 * The page's body type size in PDF units: the median height of its printed
 * rows, the margin's bare line numbers left out. Null where there are no
 * rows to read.
 */
export function pageTypeSize(rows) {
  const hs = (rows || []).filter((r) => r && r.height > 0 && !/^\s*\d{1,2}\s*$/.test(r.text || "")).map((r) => r.height);
  return hs.length ? median(hs) : null;
}

/**
 * Each line's type size from its row's: `sizes` per line (null where the
 * line has no row), `base` the page's body size. A row within `tolerance`
 * of the body is the body — a text layer's heights wobble, an OCR's more —
 * and one further off (a heading, a footnote) keeps its own.
 */
export function typeSizes(sizes, base, tolerance = 0.2) {
  const b = Number(base) > 0 ? Number(base) : null;
  return (sizes || []).map((h) => {
    if (!(h > 0)) return b;
    if (b && Math.abs(h - b) <= b * tolerance) return b;
    return h;
  });
}

/**
 * The scale that draws `unit` PDF units as `px` pixels: the PDF's body
 * type at the reading size. Bounded, so a misread size cannot blow the
 * sheet up or crush it. Null where there is nothing to scale to.
 */
export function matchedScale(unit, px, { min = 0.15, max = 8 } = {}) {
  const u = Number(unit), p = Number(px);
  if (!(u > 0) || !(p > 0)) return null;
  return Math.min(max, Math.max(min, p / u));
}

/**
 * Lines that never land on each other: each top is held at least the box
 * of the line before it below that line — `box` one height for all, or one
 * per line — pushed down where the PDF's own rows were printed closer
 * than that (a scan's text layer, a signature under its rule). Reading the
 * text beats lining it up: a pushed line is out of register with the PDF
 * by that much and legible, an overlapped one is neither. Nulls (lines
 * with no place) pass through. `tops` in order.
 */
export function spreadTops(tops, box) {
  const boxes = Array.isArray(box) ? box : null;
  const one = !boxes && Number(box) > 0 ? Number(box) : 0;
  let last = null, lastBox = 0;
  return (tops || []).map((t, i) => {
    if (t == null || !Number.isFinite(t)) return t == null ? null : t;
    const y = last == null ? t : Math.max(t, last + lastBox);
    last = y;
    lastBox = boxes ? (Number(boxes[i]) > 0 ? Number(boxes[i]) : 0) : one;
    return y;
  });
}
