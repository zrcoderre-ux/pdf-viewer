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
 * The same stem with its PUNCTUATION AND SPACING taken out — letters and
 * digits only, folded.
 *
 * A stem is a file name a person typed, and the same document is written
 * "Payee Supp. Decl. ISO Pet..pdf" in one place and "Payee Supp. Decl. ISO
 * Pet.txt" in another: a stem ending in an abbreviation's own full stop
 * carries a doubled dot in the PDF's name and a single one in the export's,
 * because the tool that made the export wrote `stem + ".txt"` over a stem
 * whose trailing dot something had already eaten. Under the exact stem those
 * are two documents. Under this one they are the document they are.
 *
 * It is the SECOND question, never the first: the exact stem still decides,
 * and this is only asked where nothing answered it and exactly one candidate
 * answers this. A looser match than "the punctuation differs" would start
 * pairing documents that are genuinely different, and pointing the review at
 * the wrong file is worse than pointing it at none.
 */
export function looseStem(name) {
  return normalizeStem(name).replace(/[^a-z0-9]+/g, "");
}
/**
 * `stem → the one candidate that answers to it loosely`, for the candidates
 * no exact stem claimed. A stem two candidates answer to is left out: an
 * ambiguous name has no answer, and a guess is the thing to avoid.
 */
export function looseIndex(keys) {
  const seen = new Map();
  for (const [k, v] of keys) {
    const l = looseStem(k);
    if (!l) continue;
    if (seen.has(l)) { if (seen.get(l) !== v) seen.set(l, null); }
    else seen.set(l, v);
  }
  return seen;
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
  const stems = [];
  for (const pdf of pdfNames || []) {
    const stem = normalizeStem(pdf);
    if (stem === want) return pdf;
    let faked = "";
    if (fwd) {
      try { faked = fwd(spaceStem(String(pdf).replace(/\.pdf$/i, ""))); } catch { faked = ""; }
      if (faked && spaceStem(faked).toLowerCase() === want) return pdf;
    }
    stems.push([stem, pdf], [faked ? spaceStem(faked).toLowerCase() : "", pdf]);
  }
  // Nothing answered exactly: the one candidate that differs only in its
  // punctuation, if there is exactly one (looseStem).
  const one = looseIndex(stems).get(looseStem(exportName));
  return one == null ? null : one;
}

/** The name a file takes once the key is run forward over it, folded as a stem. */
export function fakedStem(name, forward) {
  if (typeof forward !== "function") return "";
  let faked = "";
  try { faked = forward(spaceStem(String(name).replace(/\.pdf$/i, ""))); } catch { faked = ""; }
  return faked ? spaceStem(faked).toLowerCase() : "";
}

/**
 * `matchPdf` for MANY lookups against the SAME list of PDFs. matchPdf runs
 * the key forward over every candidate for every name it is asked about, and
 * a LEAKS worksheet asks it thousands of times: a case folder's worth of
 * candidates then costs hundreds of thousands of translations, which is the
 * kind of arithmetic that stops a tab. The answer depends on the candidate,
 * not on the name, so each candidate is translated ONCE and written down
 * under both the stem it has and the stem it takes; a lookup is then the name's
 * own stem read out of a map.
 *
 * Returns `(exportName) => the matching PDF, or null` — the same answer
 * `matchPdf(exportName, pdfNames, forward)` gives, the first candidate in the
 * list still winning.
 */
export function pdfMatcher(pdfNames, forward) {
  const list = (pdfNames || []).slice();
  const at = new Map(); // a stem → the first candidate that answers to it
  list.forEach((pdf, i) => {
    for (const s of [normalizeStem(pdf), fakedStem(pdf, forward)]) if (s && !at.has(s)) at.set(s, i);
  });
  // …and the same stems with their punctuation taken out, for the names that
  // differ only in it. Built once with the index, asked only after it.
  const loose = looseIndex([...at.entries()]);
  const memo = new Map();
  return (exportName) => {
    const want = normalizeStem(exportName);
    if (!want) return null;
    if (!memo.has(want)) {
      let hit = at.has(want) ? list[at.get(want)] : null;
      if (hit == null) {
        const i = loose.get(looseStem(exportName));
        if (i != null) hit = list[i];
      }
      memo.set(want, hit);
    }
    return memo.get(want);
  };
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
      const m = String(p.banner).match(BANNER_NAME_RE);
      if (m) cur = m[1];
    }
    out.push(cur);
  }
  return out;
}

/**
 * The PDFs the reading has reached, nearest first.
 *
 * `sources` is one entry per text page — the PDF that page is drawn from, or
 * null — `at` the page the reading line sits on, `reach` how many pages
 * either side of it still count as reached, and `limit` the most documents
 * that may be named at once.
 *
 * A reel of twenty exports has twenty PDFs behind it and a Combined Text.txt
 * of a big case folder has three hundred. Every one of them opened is the
 * whole case in memory — its bytes, its pages as pdf.js holds them, and the
 * line grid read off each. What the READING is at is a handful, and this
 * says which: the page under the line, then outward from it a page at a
 * time, until `limit` documents are named or `reach` is spent.
 */
export function pdfsNear(sources, at, reach, limit) {
  const out = [];
  const list = Array.isArray(sources) ? sources : [];
  if (!list.length || !(limit > 0)) return out;
  const nameAt = (i) => {
    const s = list[i];
    return s ? (typeof s === "string" ? s : s.name) : null;
  };
  const add = (i) => {
    const name = nameAt(i);
    if (name && !out.includes(name)) out.push(name);
  };
  const start = Math.max(0, Math.min(list.length - 1, Math.round(Number(at) || 0)));
  add(start);
  for (let d = 1; d <= reach && out.length < limit; d++) {
    if (start - d >= 0) add(start - d);
    if (out.length >= limit) break;
    if (start + d < list.length) add(start + d);
  }
  return out.slice(0, limit);
}

// The list a Combined Text.txt opens with (_combined_text_body):
//   # Documents in this file:
//   #   1. Brief.txt
//   #   2. Reply.txt
const MEMBER_LIST_RE = /^#\s*Documents in this file:\s*$/i;
const MEMBER_LINE_RE = /^#\s+(\d+)\.\s+(.+?)\s*$/;
const BANNER_NAME_RE = /^#+ DOCUMENT \d+ OF \d+ IN THIS COMBINED FILE: (.+?) #+$/;

/**
 * The documents a Combined Text.txt holds, IN ORDER: the names its header
 * lists under "# Documents in this file:", else — an older combined file,
 * or a header somebody trimmed — the distinct names of its DOCUMENT
 * banners in the order they stand. A lone export yields [].
 */
export function combinedMembers(pages) {
  const out = [];
  const first = (pages || [])[0];
  if (first && first.banner == null && first.header == null) {
    let inList = false;
    for (const line of first.lines || []) {
      const l = String(line);
      if (!inList) { if (MEMBER_LIST_RE.test(l)) inList = true; continue; }
      const m = l.match(MEMBER_LINE_RE);
      if (!m) break;
      out.push(m[2]);
    }
    if (out.length) return out;
  }
  for (const p of pages || []) {
    if (p.banner == null) continue;
    const m = String(p.banner).match(BANNER_NAME_RE);
    if (m && !out.includes(m[1])) out.push(m[1]);
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

/**
 * The page's printed rows from its text items: [{ top, left, height, text }]
 * sorted down the page.
 *
 * Grouped by BASELINE, not by the top of the glyph box: the items printed on
 * one line share a baseline whatever sizes they are set in, while a tall
 * glyph's box stands well above the line it belongs to. A twenty-five point
 * mark on an eight point form line otherwise reads as part of the row two
 * lines above it, the line it was never on.
 *
 * And a row's height is its BODY type's — the median of its items' heights
 * weighted by the characters each one prints — not the tallest, which lets
 * one outsized glyph (a stamped initial, a signature's flourish, a symbol in
 * a display face) set the size for everything beside it. Side by side, a
 * line is drawn at its row's own size (applyMatchedLayout), so a height read
 * off the wrong glyph is a line of small print set three times too big,
 * running off the sheet and widening every sheet in the document with it.
 */
export function pdfRows(items, size) {
  const rows = [];
  const sorted = (items || []).filter((it) => it.str && it.str.trim()).map((it) => {
    const h = it.h > 0 ? it.h : 10;
    return { str: it.str, x: it.x, h, base: it.top + h };
  }).sort((a, b) => a.base - b.base || a.x - b.x);
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.base - last.base) <= Math.max(2, Math.min(it.h, last.tall) * 0.6)) {
      last.items.push(it);
      last.base = Math.min(last.base, it.base);
      last.tall = Math.max(last.tall, it.h);
    } else rows.push({ base: it.base, tall: it.h, items: [it] });
  }
  return rows.map((r) => {
    const its = r.items.slice().sort((a, b) => a.x - b.x);
    const height = bodyHeight(its);
    // Where the row sits: its body type's own baseline, less that type's
    // height. The outsized glyph's box is the one thing that must not place
    // the line — it reaches up into the row above and would take the line
    // with it.
    const body = its.filter((i) => Math.abs(i.h - height) <= height * 0.2);
    const base = Math.min(...(body.length ? body : its).map((i) => i.base));
    return { top: base - height, left: its[0].x, height, text: its.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim() };
  });
}

/**
 * A row's body type height: the median of its items' heights weighted by the
 * characters each prints, so a lone tall glyph beside a line of text counts
 * for the one character it is and a line set wholly in a display size keeps
 * that size.
 */
function bodyHeight(items) {
  const weighed = items.map((it) => ({ h: it.h, n: Math.max(1, String(it.str).trim().length) })).sort((a, b) => a.h - b.h);
  const half = weighed.reduce((s, w) => s + w.n, 0) / 2;
  let seen = 0;
  for (const w of weighed) { seen += w.n; if (seen >= half) return w.h; }
  return weighed.length ? weighed[weighed.length - 1].h : 10;
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
/**
 * THE MARGIN THE BODY STARTS AT — the left the rows SHARE, not the least left
 * of any of them.
 *
 * A pleading page has furniture outside its body: a firm name printed down
 * the left margin, a seal, a stamp. Each of those is a row like any other,
 * and each begins further left than the text does. Taking the least left of
 * all of them puts the body's own margin out in the furniture, and every line
 * laid at it — a line the export has no row for, which is every line the PDF
 * carries and the export does not — is drawn out there with it, left of the
 * numbered margin. The numbered margin is the boundary: nothing the grid does
 * may cross it.
 *
 * So the margin is the one the most rows begin at, to the nearest few points.
 */
export function bodyLeftOf(rows) {
  const counts = new Map();
  for (const r of rows || []) {
    if (!r || !(r.left >= 0)) continue;
    const k = Math.round(r.left / 4) * 4;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null, most = 0;
  for (const [k, n] of counts) if (n > most || (n === most && best != null && k < best)) { most = n; best = k; }
  return best;
}
/** …and across the pages read so far, so every page's margin is the same one. */
export function docBodyLeft(geoms, rowsByPage) {
  const xs = [];
  for (const g of geoms || []) if (g && g.bodyX > 0) xs.push(g.bodyX);
  if (xs.length) return median(xs);
  const ls = [];
  for (const rows of rowsByPage || []) { const l = bodyLeftOf(rows); if (l != null) ls.push(l); }
  return ls.length ? median(ls) : null;
}
export function rowLayout(lineTexts, rows, { bodyLeft = null } = {}) {
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
  // The body's margin, and the floor every line is held at: a row further
  // left than it is the page's furniture, not its text.
  const floorAt = bodyLeft != null ? bodyLeft : bodyLeftOf(rows);
  const left0 = floorAt == null ? Math.min(...rows.map((r) => r.left)) : floorAt;
  const held = (x) => (floorAt == null ? x : Math.max(x, floorAt));
  const out = new Array(lineTexts.length).fill(null);
  let last = null, k = 0;
  lineTexts.forEach((_, i) => {
    if (map[i] != null) { last = rows[map[i]].top; k = 0; out[i] = { top: last, left: held(rows[map[i]].left), size: rows[map[i]].height }; }
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
  const hs = bodyHeights(rows);
  return hs.length ? median(hs) : null;
}
/** A page's printed row heights, the margin's bare line numbers left out. */
function bodyHeights(rows) {
  return (rows || []).filter((r) => r && r.height > 0 && !/^\s*\d{1,2}\s*$/.test(r.text || "")).map((r) => r.height);
}
/**
 * The DOCUMENT's body type size: the same reading taken of every printed row
 * in the PDF rather than of one page's.
 *
 * A PAGE IS NOT A DOCUMENT. An exhibit's title page carries one line —
 * "EXHIBIT A", set large — and the median of one heading is that heading, so
 * a page drawn to put its body type at the reading size is drawn to make a
 * 36-point heading fifteen pixels: a quarter-size sheet, with the PDF beside
 * it shrunk to match. The pages of one filing are one paper and belong at one
 * scale, and the scale that suits the filing is the one its body is set in —
 * which the title page then shows a large heading on, as the PDF does.
 *
 * Null where the document has no rows read yet; the caller falls back to the
 * page's own, and to the line pitch behind that.
 */
export function docTypeSize(rowsByPage) {
  const hs = [];
  for (const rows of rowsByPage || []) if (rows) hs.push(...bodyHeights(rows));
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
