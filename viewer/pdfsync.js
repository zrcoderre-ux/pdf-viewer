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

import { checkboxRanges } from "./textdoc.js";

/** A file name's stem, extensions off (.pdf, .txt, .txt.LEAK, .md), separators spaced, case folded. */
export function normalizeStem(name) {
  let s = String(name == null ? "" : name).split(/[\\/]/).pop();
  s = s.replace(/\.txt\.leak$/i, "").replace(/\.(txt|pdf|docx?|md|markdown)$/i, "");
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

/**
 * The localStorage key remembering which pages of a document are swapped.
 * `folder` is the case folder's id (the reader's stateFolder), "" with none.
 */
export const SWAPS_PREFIX = "textReader.swaps.";
export function swapStoreKey(folder, fileName) {
  return SWAPS_PREFIX + (folder || "") + "/" + (fileName || "");
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

/**
 * The lines OFF the grid on a numbered page — a footer under line 28 (the
 * page number, the document's title), a stamp or a caption above line 1 —
 * put on the PDF's row that prints their words. slotTops can only stack them
 * a pitch apart from the nearest number, blank lines and all, and a footer
 * three or four lines under 28 lands past the foot of the paper: the sheet
 * grew to hold it, by a different amount on every page. The PDF prints them
 * like any other row, so where the words match one, that row is where they go.
 *
 * `texts` and `nums` are per line (nums null off the grid), `tops` from
 * slotTops, `rows` from pdfRows, `pitch` the grid's. A match is taken only where it falls
 * between the numbered lines either side of it, so a footer is never pulled
 * up among the body. Returns { tops, sizes, rowOf } — sizes the matched row's
 * own type height and rowOf its index in `rows`, null elsewhere.
 */
export function offGridTops(texts, nums, tops, rows, pitch = 0) {
  const out = (tops || []).slice();
  const sizes = out.map(() => null);
  const rowOf = out.map(() => null);
  if (!rows || !rows.length || !texts || !texts.length) return { tops: out, sizes, rowOf };
  const n = out.length;
  const inWindow = (k, top) => {
    let above = null, below = null;
    for (let i = k - 1; i >= 0; i--) if (nums[i] && out[i] != null) { above = out[i]; break; }
    for (let i = k + 1; i < n; i++) if (nums[i] && out[i] != null) { below = out[i]; break; }
    return (above == null || top > above) && (below == null || top < below);
  };
  const used = new Set();
  const take = (k, j) => { out[k] = rows[j].top; sizes[k] = rows[j].height; rowOf[k] = j; used.add(j); };
  const map = alignLines(texts.map((t, k) => (nums[k] ? "" : t)), rows.map((r) => r.text));
  map.forEach((j, k) => { if (j != null && !nums[k] && inWindow(k, rows[j].top)) take(k, j); });
  // A line with no word in it to match by — the page number, "- 3 -" — is
  // matched by its characters instead: the same marks, the spacing aside.
  const bare = (t) => String(t || "").replace(/\s+/g, "");
  for (let k = 0; k < n; k++) {
    if (nums[k] || sizes[k] != null || !bare(texts[k])) continue;
    const j = rows.findIndex((r, i) => !used.has(i) && bare(r.text) === bare(texts[k]) && inWindow(k, r.top));
    if (j >= 0) take(k, j);
  }
  // What is still unplaced beside a placed footer or stamp is stacked off
  // the NUMBERED line, as though the rows between were not there: a blank
  // line or two a pitch apart, and they land under the title they sit above.
  // So a run between two placed lines is spread evenly between them, and one
  // after the last placed row (or before the first) stacks off that row.
  const placed = out.map((t, k) => t != null && (!!nums[k] || sizes[k] != null));
  const matched = (k) => !nums[k] && sizes[k] != null;
  let prev = -1;
  for (let k = 0; k < n; k++) {
    if (!placed[k]) continue;
    if (prev >= 0 && k - prev > 1 && (matched(prev) || matched(k))) {
      for (let i = prev + 1; i < k; i++) if (out[i] != null) out[i] = out[prev] + ((out[k] - out[prev]) * (i - prev)) / (k - prev);
    } else if (prev < 0 && matched(k) && pitch > 0) {
      for (let i = 0; i < k; i++) if (out[i] != null) out[i] = Math.max(0, out[k] - (k - i) * pitch);
    }
    prev = k;
  }
  if (prev >= 0 && matched(prev) && pitch > 0) {
    for (let i = prev + 1; i < n; i++) if (out[i] != null) out[i] = out[prev] + (i - prev) * pitch;
  }
  return { tops: out, sizes, rowOf };
}

/**
 * THE PDF'S ROW FOR EACH LINE OF A NUMBERED PAGE, as its index in `rows`, or
 * null: a numbered line's is the row printed at its number (lineTop, within
 * three tenths of the pitch); an unnumbered line's is the row offGridTops
 * matched it to by its words (`matched`, its rowOf), else the row at its half
 * line between the numbers either side — one alone between 5 and 6 is 5.5,
 * two are 5⅓ and 5⅔; none where the numbers either side are not consecutive.
 * Only a row carrying type at or right of `left` counts (the body margin, a
 * point or so in: a row that is the bare margin number is no row for a
 * line). What a line's indent is read off (text-reader.js, pdfIndents) and
 * what its faces are (planCells).
 */
export function numberedRowOf(nums, geom, rows, matched = null, left = 0) {
  const n = (nums || []).length;
  const out = new Array(n).fill(null);
  if (!geom || !rows || !rows.length) return out;
  const pitch = geom.pitch;
  const inBody = (it) => it.x >= left && String(it.str).trim();
  const nearest = (y) => {
    let best = null, gap = pitch * 0.3;
    rows.forEach((r, j) => {
      const d = Math.abs(r.top - y);
      if (d <= gap && (r.items || []).some(inBody)) { best = j; gap = d; }
    });
    return best;
  };
  const numAt = [];
  nums.forEach((v, k) => { if (v != null) numAt.push(k); });
  const slotY = (k) => {
    if (nums[k] != null) return lineTop(geom, nums[k]);
    let a = -1, b = -1;
    for (const i of numAt) { if (i < k) a = i; else { b = i; break; } }
    if (a < 0 || b < 0 || nums[b] !== nums[a] + 1) return null;
    return lineTop(geom, nums[a]) + (pitch * (k - a)) / (b - a);
  };
  for (let k = 0; k < n; k++) {
    if (matched && matched[k] != null) { out[k] = matched[k]; continue; }
    const y = slotY(k);
    if (y != null) out[k] = nearest(y);
  }
  return out;
}

/**
 * Lines held ON THE PAPER: worked up from the foot, each line's top is held
 * at least its own box above the line below it and the lowest one its box
 * above `height` — so a line spreadTops pushed, or a pitch-stacked one the
 * PDF has no row for, is brought back onto the page instead of the page
 * growing to reach it. `room` per line (0 for an empty line, which holds
 * nothing). Where the lines cannot all fit — their boxes are taller than the
 * page — `tops` is handed back as it was: the words come first. `spans`, as
 * spreadTops takes them: a line is held above only the lines it stands over.
 */
export function holdWithin(tops, room, height, spans = null) {
  if (!tops || !(height > 0)) return tops;
  const out = tops.slice();
  const roomOf = (i) => (room && room[i] > 0 ? room[i] : 0);
  if (!spans) {
    let limit = height;
    for (let i = out.length - 1; i >= 0; i--) {
      const t = out[i];
      if (t == null) continue;
      const r = roomOf(i);
      out[i] = Math.min(t, limit - r);
      if (r > 0) limit = out[i];
    }
  } else {
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i] == null) continue;
      let limit = height;
      for (let k = i + 1; k < out.length; k++) if (out[k] != null && roomOf(k) > 0 && overlaps(spans[i], spans[k])) limit = Math.min(limit, out[k]);
      out[i] = Math.min(out[i], limit - roomOf(i));
    }
  }
  return out.some((t) => t != null && t < 0) ? tops : out;
}

/**
 * Whether two lines stand over each other across the page: [from, to) each, a
 * missing one standing over everything. By more than a few characters: the
 * export's grid is the PDF's rounded, and a left-hand column's long line runs
 * a character or two into the column beside it that it never touches on the
 * page. Never by less than half the shorter of the two, so a line of one or
 * two characters ("v.") still stands over the line it is under.
 */
const SPAN_SLOP = 3;
function overlaps(a, b) {
  if (!a || !b) return true;
  const shared = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
  return shared > Math.min(SPAN_SLOP, 0.5 * Math.min(a[1] - a[0], b[1] - b[0]));
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
 *
 * TWO COLUMNS ARE TWO ROWS. A two-column page's halves are set to their own
 * leading, so a line of the left-hand column and the line of the right-hand
 * one beside it sit a few points apart — close enough to read as one row by
 * the tolerance a superscript needs, and the export writes them as the two
 * lines they are. One row for two lines left one of them with nothing to
 * match, stacked a line lower, and every line after it pushed down with it.
 * So an item joins a row only where it shares a baseline with something in
 * it, or stands up against something in it as a superscript does; one on
 * another baseline a column's gutter away from everything in the row is a
 * row of its own.
 *
 * …and where the halves DO share a baseline, as a justified page set in two
 * columns has them, the row is both halves — and says where each begins by
 * its ITEMS, which it keeps, in x order: { str, x, w, h, base, font }, `font`
 * the item's pdf.js font id where it had one. A line laid on the row finds
 * them in its text (lineItems): the export's character grid is read off where
 * they begin (text-reader.js, charGrid's pairs), and each piece of the line is
 * put where the PDF prints it, at its own size and in its own face (pdfFace).
 * (A row used to keep only `breaks`, the items a column's gutter clear of the
 * one before, for the grid of a page whose every line has both halves; every
 * item is a pair now, and those are among them.)
 */
export function pdfRows(items, size) {
  const rows = [];
  const sorted = (items || []).filter((it) => it.str && it.str.trim()).map((it) => {
    const h = it.h > 0 ? it.h : 10;
    return { str: it.str, x: it.x, w: it.w > 0 ? it.w : 0, h, base: it.top + h, font: it.font || null };
  }).sort((a, b) => a.base - b.base || a.x - b.x);
  const apart = (row, it) => {
    const h = Math.min(it.h, row.tall);
    const level = Math.max(1, h * 0.15), gutter = h * 1.5;
    for (const o of row.items) {
      if (Math.abs(o.base - it.base) <= level) return false;
      if (Math.max(it.x - (o.x + o.w), o.x - (it.x + it.w)) <= gutter) return false;
    }
    return true;
  };
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.base - last.base) <= Math.max(2, Math.min(it.h, last.tall) * 0.6) && !apart(last, it)) {
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
    // The row's words as it prints them: two items that touch on the page are
    // one run of type, joined as it is — a word a PDF sets in two items ("Plain"
    // "tiff") is one word, or the row shares no word with the line it is, and
    // the line is matched to no row at all.
    let text = "";
    its.forEach((it, k) => {
      const prev = its[k - 1];
      // (…in one size: a superscript set against its word is a note's number.)
      const touch = prev && prev.w > 0 && it.x - (prev.x + prev.w) < 0.15 * Math.min(it.h, prev.h) && Math.abs(it.h - prev.h) <= 0.2 * Math.max(it.h, prev.h);
      text += (k === 0 || touch ? "" : " ") + it.str;
    });
    return { top: base - height, left: its[0].x, height, text: text.replace(/\s+/g, " ").trim(), items: its };
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
/**
 * Where a page's text ENDS across the page, in PDF units from its left edge:
 * the furthest right any of its rows prints type, or null with no rows. The
 * owner, in chat: "Pdf viewer removes any margin on the right side of the text
 * file. It shouldn't. it should have the same margin as the pdf." The reader
 * holds a line on the grid inside the larger of this and the document's own
 * (docBodyRight), so no line is held short of type its PDF page prints.
 */
export function bodyRightOf(rows) {
  let right = 0;
  for (const r of rows || []) for (const it of (r && r.items) || []) right = Math.max(right, it.x + (it.w || 0));
  return right > 0 ? right : null;
}
/** …and across the pages read so far, so every page of a document ends at one margin. */
export function docBodyRight(rowsByPage) {
  const rs = [];
  for (const rows of rowsByPage || []) { const r = bodyRightOf(rows); if (r != null) rs.push(r); }
  return rs.length ? median(rs) : null;
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
  return { positions: out, pitch, rowOf: map };
}

/**
 * The character grid PDF-Linker set a page's text on, read back off the PDF:
 * { x0, unit } in PDF units, so that a line whose text begins at column c of
 * the export stands at x0 + c × unit on the page — or null where the page
 * does not say.
 *
 * An export lays a page out in characters: its indents, its centred headings
 * and a two-column page's second column are runs of spaces, each standing
 * for the width of a character on the PDF. `pairs` are [{ col, x }]: where a
 * piece of type begins in the export, and where the PDF prints it — every
 * piece each line carries (text-reader.js, matchItems; lineItems below), a
 * box's labels and a second column's among them. Those lie on one straight
 * line, and the line is fitted robustly (Theil–Sen: the median slope between
 * every two pieces that begin columns apart), since a piece found at the
 * wrong item is a point far off it. Too few pieces that begin anywhere but
 * the margin, a slope no font has, or a fit most pieces miss by more than a
 * character and a half, and there is no grid.
 */
export function charGrid(pairs) {
  const pts = (pairs || []).filter((p) => p && p.col >= 0 && Number.isFinite(p.x));
  if (pts.length < 3 || pts.filter((p) => p.col >= 4).length < 2) return null;
  const slopes = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dc = pts[j].col - pts[i].col;
      if (Math.abs(dc) >= 4) slopes.push((pts[j].x - pts[i].x) / dc);
    }
  }
  if (!slopes.length) return null;
  const unit = median(slopes);
  if (!(unit >= 1.5 && unit <= 15)) return null;
  const x0 = median(pts.map((p) => p.x - unit * p.col));
  const near = pts.filter((p) => Math.abs(p.x - (x0 + unit * p.col)) <= Math.max(1.5 * unit, 3)).length;
  if (near < Math.max(3, pts.length * 0.6)) return null;
  return { x0, unit };
}

// ---- each piece of a line where the PDF prints it ------------------------------
//
// The grid above puts a line's columns where the export's spaces say, and the
// export is laid out for a model to read, not to look like the page: it may run
// wider than the paper, join two pieces the form prints apart with one space,
// or carry on one line pieces the form prints in two sizes (CIV-110's 7-point
// footnote and the 9-point "Attorney or party without attorney for" beside it).
// The PDF knows where each piece is: pdf.js hands its text over as ITEMS, a run
// of type each — a new one wherever the form leaves a gap or changes face — and
// a line's text carries them in order. So beside the PDF a line is cut wherever
// one of its items begins (text-reader.js, applyMatchedLayout), and each piece
// stands at its item's x, at its item's size, in its item's face.

/**
 * The PDF items a line matched to row `j` may carry: the row's own, and those
 * of each row beside it — its span down the page overlapping row j's — that no
 * other line was matched to (`taken`, a Set of row indexes). A form prints a
 * label a point or two off the line it stands on (the export writes "causes of
 * … [   ] Plaintiff/Petitioner" as one line; the PDF's rows are two), and an
 * item of a row beside it that stands OVER one of row j's own across the page
 * is a line above or below, not a piece of this one. [{ it, own }] in x order,
 * `own` true for row j's.
 */
export function rowItemsNear(rows, j, taken = null) {
  const row = rows && rows[j];
  if (!row) return [];
  const own = row.items || [];
  const out = own.map((it) => ({ it, own: true }));
  const top = row.top, bottom = row.top + row.height;
  rows.forEach((o, r) => {
    if (r === j || (taken && taken.has(r)) || !(o.top < bottom && o.top + o.height > top)) return;
    for (const it of o.items || []) {
      if (own.some((m) => it.x < m.x + m.w && m.x < it.x + it.w)) continue;
      out.push({ it, own: false });
    }
  });
  return out.sort((a, b) => a.it.x - b.it.x);
}

const WORD_RE = /[\p{L}\p{N}]+/gu;
const wordsOf = (s) => [...String(s).matchAll(WORD_RE)].map((m) => ({ w: m[0].toLowerCase(), i: m.index }));

/**
 * Where each PDF item a line carries begins in its text, and so where the line
 * is cut beside its PDF page: [{ at, start, x, item }] in order. `text` is the
 * line as it reads (real names, as the PDF prints them), `cands` its items
 * (rowItemsNear). An item is found by its first words — up to three, in order,
 * after the last item found, so two items that open alike are told apart by
 * where they stand. `start` is where the item's own text begins (its "(" of
 * "(date):" where the line has it too), `x` where that character stands on the
 * page in PDF units, and `at` where its PIECE begins: the same place, or a
 * checkbox mark standing a space before it (the PDF draws the box; its item is
 * the label beside it, and the box goes with the label).
 *
 * A piece begins only after a space, or at the line's first character: an item
 * glued to the text before it (a superscript, a word the PDF split in two, a
 * link inside its parentheses) runs on in the piece before, and a place inside
 * one of `atoms` ([from, to) in the text: a pseudonym, a spot keep) is no place
 * to cut at all. Such an item is still in the list, `glued` true — its face is
 * still the face of the text it prints — and begins no piece. An item of a row
 * beside this one (`own` false) has to be found by four letters or more: a
 * word as short as "by" is in too many lines to say this is the one it belongs
 * to.
 */
export function lineItems(text, cands, { atoms = null } = {}) {
  const s = String(text == null ? "" : text);
  const words = wordsOf(s);
  const boxes = checkboxRanges(s);
  const first = s.search(/\S/);
  const inside = (i) => !!atoms && atoms.some(([a, b]) => i > a && i < b);
  const out = [];
  let cursor = 0;
  for (const c of cands || []) {
    const it = c && c.it ? c.it : c;
    const str = String((it && it.str) || "");
    const lead = str.replace(/^\s+/, "");
    const iw = wordsOf(lead);
    if (!iw.length) continue;
    const need = Math.min(3, iw.length);
    if (c && c.own === false && iw.slice(0, need).reduce((n, w) => n + w.w.length, 0) < 4) continue;
    let p = -1;
    for (let q = cursor; q + need <= words.length && p < 0; q++) {
      let ok = true;
      for (let m = 0; m < need && ok; m++) ok = words[q + m].w === iw[m].w;
      if (ok) p = q;
    }
    if (p < 0) continue;
    cursor = p + need;
    // Where the item's text begins in the line, and where that is on the page:
    // its first word, or what it prints before that word where the line has
    // the same characters there; else the word's own place, read off the item's
    // width in proportion.
    const j = words[p].i;
    const pre = lead.slice(0, iw[0].i);
    const skipped = str.length - lead.length;
    const w = it.w > 0 ? it.w : 0;
    let start = j, x = it.x + (str.length ? (w * (skipped + iw[0].i)) / str.length : 0);
    if (pre && j >= pre.length && s.slice(j - pre.length, j).toLowerCase() === pre.toLowerCase()) {
      start = j - pre.length;
      x = it.x + (str.length ? (w * skipped) / str.length : 0);
    }
    let at = start;
    const before = s.slice(0, start).replace(/ +$/, "");
    const box = before.length < start ? boxes.find((b) => b[1] === before.length) : null;
    if (box) at = box[0];
    const glued = inside(at) || (at > first && s[at - 1] !== " ");
    out.push(glued ? { at: start, start, x, item: it, glued } : { at, start, x, item: it });
  }
  return out;
}

/**
 * Which of a line's found items (lineItems' answer, in order) STAND APART from
 * the one before them on the PDF: a gap there of `em` × the type's height or
 * more, a column's, where a word space is a fraction of one. Per item, true
 * for the first. The owner, in chat: "It shouldn't exaggerate spaces between
 * words. Indentation should be reserved for the beginning of a sentence." A
 * line of prose that a PDF sets in several items (a face changing, a kerning
 * run, a justified line's words) is one run of text whose words follow one
 * another; only a piece the PDF sets apart is a piece to put where the PDF
 * puts it — on the page, and in the file's spaces.
 */
export const APART_EM = 1;
export function standApart(found, { em = APART_EM } = {}) {
  return (found || []).map((g, i) => {
    if (i === 0) return true;
    const a = found[i - 1].item, b = g.item;
    if (!a || !b) return true;
    const end = a.x + (a.w > 0 ? a.w : 0);
    const h = Math.max(b.h > 0 ? b.h : 0, a.h > 0 ? a.h : 0) || 10;
    return b.x - end >= em * h;
  });
}

// ---- the PDF's own typeface ---------------------------------------------------
//
// Beside its PDF page a line is drawn in the PDF's face, not the reader's: a
// form set in Arial reads as Arial, its headings bold where the PDF's are, its
// "(date):" in italics. pdf.js says only which of three families a font falls
// in (its text content's style: serif, sans-serif or monospace); its NAME —
// "QZRSCC+Arial-BoldMT" — is on the font object once pdf.js has loaded it, and
// the weight and slant are read off that. The face is drawn in what this
// machine has: Arial on Windows, Liberation Sans (cut to Arial's widths) on
// Linux, and the family's generic behind them.

const FACE_STACKS = {
  "sans-serif": 'Arial, Helvetica, "Liberation Sans", Arimo, "Nimbus Sans", sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", Tinos, "Nimbus Roman", serif',
  monospace: '"Courier New", Courier, "Liberation Mono", Cousine, "Nimbus Mono PS", monospace',
};
// Faces a filing is commonly set in, by the start of the name the PDF gives
// them (letters only, lower case): the face itself first where the machine has
// it, then one cut to its widths, then its family. Arial, Times and Courier
// are the stacks themselves.
const NAMED_FACES = [
  [/^arialnarrow/, '"Arial Narrow", "Liberation Sans Narrow"', "sans-serif"],
  [/^(?:arial|helvetica|arimo|liberationsans|nimbussans)/, "", "sans-serif"],
  [/^(?:calibri|carlito)/, "Calibri, Carlito", "sans-serif"],
  [/^verdana/, 'Verdana, "DejaVu Sans"', "sans-serif"],
  [/^tahoma/, "Tahoma", "sans-serif"],
  [/^segoeui/, '"Segoe UI"', "sans-serif"],
  [/^centurygothic/, '"Century Gothic"', "sans-serif"],
  [/^franklingothic/, '"Franklin Gothic Book"', "sans-serif"],
  [/^(?:timesnewroman|times|tinos|liberationserif|nimbusrom)/, "", "serif"],
  [/^georgia/, "Georgia", "serif"],
  [/^(?:cambria|caladea)/, "Cambria, Caladea", "serif"],
  [/^(?:garamond|ebgaramond)/, 'Garamond, "EB Garamond"', "serif"],
  [/^(?:bookantiqua|palatino)/, '"Book Antiqua", "Palatino Linotype", Palatino, "TeX Gyre Pagella"', "serif"],
  [/^(?:centuryschoolbook|newcenturyschlbk)/, '"Century Schoolbook", "TeX Gyre Schola"', "serif"],
  [/^bookman/, '"Bookman Old Style", "TeX Gyre Bonum"', "serif"],
  [/^(?:couriernew|courier|cousine|liberationmono|nimbusmono)/, "", "monospace"],
  [/^consolas/, "Consolas", "monospace"],
  [/^lucidaconsole/, '"Lucida Console"', "monospace"],
];
// A symbol font draws pictures, not letters: Wingdings' "o" is a box. A piece
// set in one keeps the face of the line around it. And a font that says
// nothing of the type on the page is no face at all: an OCR's text layer is
// set in Tesseract's GlyphLessFont (or another invisible one) over the scan,
// and a Type 3 font is pictures of glyphs a scanner or an OCR drew — the type
// is in the image, and the reader's own face reads a scan as well as a guess.
const SYMBOL_FACE_RE = /symbol|dingbat|wingding|webding|marlett|zapf|glyphless|^t3font|^type3/i;

/**
 * The face to draw a PDF font's text in: { family, a CSS font-family list;
 * bold; italic } — from the font's `name` as pdf.js loaded it (its subset tag
 * "ABCDEF+" off; empty while it has not loaded) and `generic`, the family
 * pdf.js reads off the font ("serif", "sans-serif", "monospace"). `hints` are
 * what pdf.js itself set ({ bold, italic }, on a font it put a system face in
 * for; isType3Font). Null for a symbol font, an OCR layer's, a Type 3 font.
 */
export function pdfFace(name, generic, hints = null) {
  const raw = String(name || "").replace(/^[A-Z]{6}\+/, "");
  if (SYMBOL_FACE_RE.test(raw) || (hints && hints.isType3Font)) return null;
  const key = raw.toLowerCase().replace(/[^a-z]/g, "");
  let kind = FACE_STACKS[generic] ? generic : "sans-serif", first = "";
  for (const [re, faces, g] of NAMED_FACES) if (re.test(key)) { first = faces; kind = g; break; }
  const bold = /bold|black|heavy|demi/i.test(raw) || !!(hints && hints.bold);
  const italic = /italic|oblique/i.test(raw) || /[-,_][A-Za-z]*It(?:MT|PS)?$/.test(raw) || !!(hints && hints.italic);
  return { family: (first ? first + ", " : "") + FACE_STACKS[kind], bold, italic };
}
/** A face as one string: the same face, the same key. */
export function faceKey(face) {
  return face ? `${face.italic ? "italic " : ""}${face.bold ? "700 " : ""}${face.family || ""}` : "";
}

// ---- the faces a line's runs are set in -----------------------------------------
//
// A line is seldom one face: a caption in bold, a case name in italics in the
// body, a footnote's number set small — and pdf.js's text items break where the
// face changes, so the items lineItems finds in a line say where each face
// begins. faceRuns turns them into the runs the reader draws (columns.faceLine)
// on every page beside its PDF: a form's pieces, a pleading's lines, an
// exhibit's prose alike.

const WORD_CHAR_RE = /[\p{L}\p{N}]/u;
/**
 * The runs of a line set in faces of their own: [{ from, to, face }] in FILE
 * offsets (the text the cells are cut in, a pseudonym counted as its fake),
 * ascending, none overlapping, none beginning or ending inside a pseudonym or
 * a spot keep. `text` is the line as it shows; `found` is lineItems' answer
 * for it, glued pieces included (a face changes in the middle of a word as
 * often as at a space — "*Smith*'s", a footnote's number); `faceOf` gives a
 * font id's face, null for one not known; `fileAt` and `atoms` are the line's
 * map (columns.lineMap). A run begins where its item's text begins — moved to
 * the end of a pseudonym where it begins inside one, which then keeps the
 * face before it — and ends where the next found item's begins. Where that is
 * further on than the item's own text reaches by more than two characters (an
 * item between the two that the line does not carry, or text the PDF does not
 * print), or there is no next item, the run ends where the item's text does,
 * moved to the nearer edge of a word it would end inside: pdf.js's spacing
 * and the export's differ by a character here and there, and a face that
 * stops a letter short of a word's end reads worse than one that runs a
 * letter long. Runs that touch in one face are one; a run whose face is not
 * known is left out, so the line's own face stands there.
 */
export function faceRuns(text, found, { fileAt = null, atoms = [], faceOf = () => null } = {}) {
  const s = String(text == null ? "" : text);
  const n = s.length;
  const atomAt = (i) => (atoms || []).find(([a, b]) => i > a && i < b) || null;
  const offAtom = (i) => { const a = atomAt(i); return a ? a[1] : i; };
  const isWord = (i) => i >= 0 && i < n && WORD_CHAR_RE.test(s[i]);
  const wordEdge = (i) => {
    if (!(isWord(i - 1) && isWord(i))) return i;
    let a = i, b = i;
    while (isWord(a - 1)) a--;
    while (isWord(b)) b++;
    return i - a < b - i ? a : b;
  };
  const toFile = (i) => (fileAt ? fileAt(i) : i);
  const items = (found || [])
    .filter((g) => g && g.start >= 0 && g.start < n)
    .map((g) => ({ start: g.start, face: faceOf(g.item && g.item.font), reach: String((g.item && g.item.str) || "").trim().length }))
    .sort((a, b) => a.start - b.start);
  const runs = [];
  items.forEach((it, i) => {
    const from = offAtom(it.start);
    const next = i + 1 < items.length ? offAtom(items[i + 1].start) : n;
    const own = offAtom(wordEdge(Math.min(n, it.start + it.reach)));
    const to = Math.min(next, i + 1 < items.length && own >= next - 2 ? next : own);
    if (!it.face || !(to > from)) return;
    const a = toFile(from), b = toFile(to);
    if (a < 0 || !(b > a)) return;
    const last = runs[runs.length - 1];
    if (last && last.to === a && faceKey(last.face) === faceKey(it.face)) { last.to = b; return; }
    runs.push({ from: a, to: b, face: it.face });
  });
  return runs;
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
 *
 * `fixed`, per line, marks the lines that are the page's grid — a pleading's
 * numbered lines, each standing beside its own number on the PDF — and those
 * never move: a line between two of them makes room for itself within the
 * space they leave, and is never what pushes the next one off its number.
 * The caption's single-spaced lines between two numbers used to do exactly
 * that, a little each, until the numbers down the side were out of step with
 * the PDF's and two of them stood crowded together where the push ran out.
 * Where the lines between two fixed ones cannot all have their boxes there,
 * they share the space evenly instead.
 *
 * `spans`, per line, is where across the page it stands ([from, to), in the
 * export's characters): a line clears only the lines above it that it stands
 * UNDER. A two-column page sets its halves to their own leading, and a line of
 * the left-hand column and the right-hand line beside it can be printed three
 * points apart; read as one above the other, the second was pushed a whole
 * line down, and every line after it, until the page ran a third again past
 * its PDF. Side by side they never touch.
 */
export function spreadTops(tops, box, fixed = null, spans = null) {
  const boxes = Array.isArray(box) ? box : null;
  const one = !boxes && Number(box) > 0 ? Number(box) : 0;
  const boxOf = (i) => (boxes ? (Number(boxes[i]) > 0 ? Number(boxes[i]) : 0) : one);
  const placed = (t) => t != null && Number.isFinite(t);
  const isFixed = (i) => !!(fixed && fixed[i]);
  let last = null, lastBox = 0;
  const out = [];
  (tops || []).forEach((t, i) => {
    if (!placed(t)) { out.push(t == null ? null : t); return; }
    let y = t;
    if (!isFixed(i) && spans) {
      for (let j = 0; j < i; j++) if (placed(out[j]) && overlaps(spans[j], spans[i])) y = Math.max(y, out[j] + boxOf(j));
    } else if (last != null && !isFixed(i)) y = Math.max(t, last + lastBox);
    out.push(y);
    last = y;
    lastBox = boxOf(i);
  });
  if (!fixed) return out;
  // Back from each fixed line: what runs into it is held above it, and a run
  // that cannot be is spread evenly from the line before it down to this one.
  let next = null; // the index of the fixed line below
  for (let i = out.length - 1; i >= 0; i--) {
    if (!placed(out[i])) continue;
    if (isFixed(i)) { next = i; continue; }
    if (next == null) continue;
    // The run of free lines above `next`, back to the fixed line before it.
    let a = i;
    while (a - 1 >= 0 && !(placed(out[a - 1]) && isFixed(a - 1))) a--;
    const run = [];
    for (let k = a; k <= i; k++) if (placed(out[k])) run.push(k);
    const prev = a - 1 >= 0 ? a - 1 : null;
    const start = prev != null ? out[prev] + boxOf(prev) : -Infinity;
    const end = out[next];
    let limit = end;
    const held = run.map(() => 0);
    for (let r = run.length - 1; r >= 0; r--) { held[r] = Math.min(out[run[r]], limit - boxOf(run[r])); if (boxOf(run[r]) > 0) limit = held[r]; }
    if (!run.length || held[0] >= start || !Number.isFinite(start)) run.forEach((k, r) => { out[k] = held[r]; });
    else {
      const total = run.reduce((sum, k) => sum + boxOf(k), 0);
      const share = total > 0 ? Math.max(0, end - start) / total : 0;
      let y = start;
      for (const k of run) { out[k] = y; y += boxOf(k) * share; }
    }
    i = a; // the run is placed; carry on above it
    next = null;
  }
  return out;
}

// ---- a ✓ Use my text page's file laid out as its PDF lays it out -----------------
//
// The owner, in chat: "Let's have raw automatically update to match the layout,
// but my manual editing should overwrite that" — the margin numbers, the indents,
// each line's place on the numbers and the gaps within a line, on the pages
// handed to PDF-Linker as typed text, whose file is what it writes into the PDF.
// The reader works the layout out (text-reader.js, autoLayFreePage); these are
// the parts of it that need no page.

/**
 * Where a numbered page's lines are on its PDF, from the numbers the FILE gives
 * the lines its words were matched to: `pairs` [{ n, top }] (a margin number,
 * and the top in PDF units of the row that line was matched to). Theil–Sen, as
 * charGrid is, so a few lines on the wrong number move nothing: { y1, pitch },
 * line n's top being y1 + (n - 1) × pitch; null with fewer than three pairs, a
 * pitch no pleading has, or a fit most pairs miss by more than a third of it.
 */
export function slotFit(pairs) {
  const pts = (pairs || []).filter((p) => p && p.n > 0 && Number.isFinite(p.top));
  if (pts.length < 3) return null;
  const slopes = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const dn = pts[j].n - pts[i].n;
    if (dn) slopes.push((pts[j].top - pts[i].top) / dn);
  }
  if (!slopes.length) return null;
  const pitch = median(slopes);
  if (!(pitch >= 6 && pitch <= 60)) return null;
  const y1 = median(pts.map((p) => p.top - (p.n - 1) * pitch));
  const near = pts.filter((p) => Math.abs(p.top - (y1 + (p.n - 1) * pitch)) <= pitch / 3).length;
  if (near < Math.max(3, pts.length * 0.6)) return null;
  return { y1, pitch };
}

/**
 * A page's file lines laid out as its PDF lays them out.
 *
 * `lines`, in the file's order: { num, the margin number it carries (null for
 * none); indent, the spaces its text is set in by past the margin (past the
 * gutter's number and two spaces, on a numbered line); body, its text from its
 * first character on; auto, false for a line the operator has typed since the
 * layout last wrote it — written back exactly as it stands, on its own number;
 * top, the PDF row its words were matched to (PDF units), or null; pieces,
 * [{ at, x }]: where each PDF item that begins a piece of it begins in `body`
 * and where on the page that item stands }.
 *
 * Options: `slot(top)`, the line a row's top stands at (1 for the first,
 * fractions between) — null on a page with no numbers, whose lines keep their
 * order and places; `last`, the paper's last number (28); `x0` and `unit`, the
 * PDF's x of the margin's column and the width of a character of the file in
 * PDF units; `gap`, the fewest spaces that are a column (COLUMN_GAP); `slack`,
 * how many characters a column may stand from the PDF's and keep its place (a
 * proportional face's type is no whole number of the file's characters, and a
 * file already laid out as its PDF is left as it is). A column is every piece
 * the PDF sets at one column, down the page: where the file has all of them at
 * one column within `slack` of the PDF's, they keep it; else every one of them
 * takes the PDF's, so the file's column is one column again.
 *
 * A line's text: its first piece at its column; each piece after it the
 * spaces its column asks for where those are a column's (`gap` or more), else
 * the one space of prose — or, where the file had a column there and the PDF
 * puts the pieces closer, still a column's `gap`. On a numbered page each line
 * is put on the number its row stands at (a row between two numbers, a line of
 * its own under the first), never above a line before it in the file: where
 * its row would put it there, it takes the next number free. An empty
 * unnumbered line the layout owns is dropped, every number down to the
 * page's last (the highest the file numbers or a line is put on, no further
 * than `last`) is written, and its line is written " 7" where it carries
 * nothing.
 *
 * Returns the lines, with `.typed`: the indexes among them of the lines
 * written from one the operator typed (`auto` false), which the layout is not
 * to take for its own next time.
 */
export function fileLayout(lines, { slot = null, last = 28, x0 = 0, unit = 6, gap = 3, slack = 2 } = {}) {
  // Where the PDF puts a piece, as a column past the margin — and each such
  // column the file already has in one place near enough, kept where it is.
  const want = (p) => Math.max(0, Math.round((p.x - x0) / unit));
  const has = new Map(); // the PDF's column → the columns the file has its pieces at
  for (const l of lines) {
    if (!l.auto) continue;
    for (const p of l.pieces || []) {
      if (!p || !Number.isFinite(p.x)) continue;
      const w = want(p);
      if (!has.has(w)) has.set(w, new Set());
      has.get(w).add(Math.max(0, l.indent || 0) + p.at);
    }
  }
  const keep = new Map();
  for (const [w, cols] of has) {
    if (cols.size !== 1) continue;
    const c = [...cols][0];
    if (Math.abs(c - w) <= slack) keep.set(w, c);
  }
  const text = (l) => {
    const body = String(l.body || "");
    const indent = Math.max(0, l.indent || 0);
    const ps = l.auto ? (l.pieces || []).filter((p) => p && p.at >= 0 && p.at < body.length && Number.isFinite(p.x)).sort((a, b) => a.at - b.at) : [];
    if (!ps.length) return " ".repeat(indent) + body;
    const colOf = (p) => (keep.has(want(p)) ? keep.get(want(p)) : want(p));
    const cuts = ps.map((p) => p.at);
    let out = ps[0].at === 0 ? " ".repeat(colOf(ps[0])) : " ".repeat(indent) + body.slice(0, ps[0].at).replace(/ +$/, "");
    ps.forEach((p, i) => {
      const seg = body.slice(p.at, i + 1 < ps.length ? cuts[i + 1] : body.length);
      if (i > 0 || ps[0].at !== 0) {
        const had = (body.slice(0, p.at).match(/ +$/) || [""])[0].length;
        if (i > 0 || out.length) {
          const want = colOf(p) - out.length;
          out += " ".repeat(want >= gap ? want : had >= gap ? gap : 1);
        }
      }
      out += i + 1 < ps.length ? seg.replace(/ +$/, "") : seg;
    });
    return out;
  };
  const pad = (n) => String(n).padStart(2);
  if (!slot) {
    const out = lines.map((l) => ((l.num != null ? pad(l.num) + "  " : "") + text(l)).replace(/ +$/, ""));
    out.typed = lines.map((l, k) => (l.auto ? -1 : k)).filter((k) => k >= 0);
    return out;
  }
  const at = new Map(); // number → line
  const halves = new Map(); // number → the lines under it (0: above the first)
  let cur = 0;
  const half = (k) => { const n = Math.min(cur, last); if (!halves.has(n)) halves.set(n, []); halves.get(n).push(k); };
  lines.forEach((l, k) => {
    const blank = !String(l.body || "").trim();
    if (blank && l.auto) return; // every number is written below; an empty half line is no line
    let want = null;
    if (l.auto && l.top != null) {
      const s = slot(l.top);
      const r = Math.round(s);
      if (Math.abs(s - r) <= 0.3 && r >= 1 && r <= last) want = r;
      else if (s > 1) want = Math.floor(s) + 0.5;
    }
    if (want == null) want = l.num != null ? l.num : cur + 0.5;
    if (Number.isInteger(want)) {
      if (want <= cur || at.has(want)) want = cur + 1 <= last ? cur + 1 : null;
      if (want == null) { half(k); return; }
      at.set(want, k);
      cur = want;
      return;
    }
    if (Math.floor(want) > cur && Math.floor(want) <= last) cur = Math.floor(want);
    half(k);
  });
  const out = [];
  out.typed = [];
  const mark = (k) => { if (!lines[k].auto) out.typed.push(out.length - 1); };
  const put = (n) => { for (const k of halves.get(n) || []) { out.push(text(lines[k]).replace(/ +$/, "")); mark(k); } };
  put(0);
  let upto = 0;
  for (const l of lines) if (l.num > upto) upto = l.num;
  for (const n of at.keys()) if (n > upto) upto = n;
  for (const n of halves.keys()) if (n > upto) upto = n;
  for (let n = 1; n <= Math.min(upto, last); n++) {
    if (at.has(n)) { out.push((pad(n) + "  " + text(lines[at.get(n)])).replace(/\s+$/, "")); mark(at.get(n)); }
    else out.push(pad(n));
    put(n);
  }
  return out;
}

// ---- a pleading's caption: the attorney block left, the clerk's stamp right ----
//
// The owner, in chat: "The law firm name, attorneys, emails, address, phone
// numbers are always left aligned. But frequently PDF viewer is mistakenly
// heavily indenting them. Likewise, the stamp in the top right is always right
// aligned." Above the court's title on a pleading's first page, a line's
// indent read off the PDF is as often the clerk's stamp's (printed over the
// same height, at the right) as its own; and PDF-Linker writes the stamp's
// words onto the attorney block's lines, a column's spaces after them.

const COURT_TITLE_RE = /\b(SUPERIOR COURT OF THE STATE|COURT OF APPEAL|UNITED STATES (DISTRICT|BANKRUPTCY) COURT|SUPREME COURT OF|DISTRICT COURT FOR|IN THE .{0,40}COURT)\b/i;
const STAMP_RE = /(Electronically\s+(FILED|RECEIVED)|\bE-?FILED\b|ENDORSED|CONFORMED\s+COPY|ORIGINAL\s+FILED|Superior\s+Court\s+of\s+California|^\s*County\s+of\s+[A-Z]|Executive\s+Officer|Clerk\s+of\s+(the\s+)?Court|Deputy(\s+Clerk)?\b|^\s*By[\s:]|\b\d{1,2}\/\d{1,2}\/\d{2,4}\s+(at\s+)?\d{1,2}:\d{2}(\s*[AP]\.?M\.?)?|Envelope\s*(ID|No)|Transaction\s+ID|^\s*FILED\b)/i;
/**
 * How each line of a pleading's caption is aligned: per line, "left" (the
 * attorney block: flush at the margin), "right" (the clerk's stamp, against
 * the right margin), "split" (an attorney line carrying the stamp's words a
 * column after it: the one at the margin, the other at the right), or null
 * (the line is no part of the caption, or the page is not a document's first:
 * `first` false). `texts` are the lines' text, a margin number not in them.
 * The caption runs from the top to the court's title, which is not in it.
 */
export function captionAlign(texts, { first = true, gap = 3 } = {}) {
  const out = (texts || []).map(() => null);
  if (!first) return out;
  const end = texts.findIndex((t) => COURT_TITLE_RE.test(t || ""));
  if (end < 0) return out;
  const sep = new RegExp(` {${gap},}`);
  for (let k = 0; k < end; k++) {
    const t = String(texts[k] || "").trim();
    if (!t) continue;
    const parts = t.split(sep);
    if (parts.length >= 2 && STAMP_RE.test(parts[parts.length - 1]) && !STAMP_RE.test(parts[0])) out[k] = "split";
    else if (STAMP_RE.test(t)) out[k] = "right";
    else out[k] = "left";
  }
  // THE CLERK'S NAME: a line of nothing but a person's name ("Edgecombe W.
  // Slayton,"), standing over the stamp's line of the clerk's office, is the stamp's — the
  // owner, "Fix the clerk name issue". An attorney's name carries its State Bar
  // number, or stands among the firm's lines, not the stamp's.
  const isStamp = (k) => out[k] === "right" || out[k] === "split";
  const near = (k, d) => { for (let q = k + d; q >= 0 && q < end; q += d) if (String(texts[q] || "").trim()) return q; return -1; };
  for (let k = 0; k < end; k++) {
    if (out[k] !== "left" || !PERSON_RE.test(String(texts[k]).trim()) || ATTORNEY_RE.test(texts[k])) continue;
    // …above the line naming the office it signs for, as a stamp sets it
    // ("Edgecombe W. Slayton," over "Executive Officer/Clerk of Court,").
    const down = near(k, 1);
    if (down >= 0 && isStamp(down) && CLERK_OFFICE_RE.test(texts[down])) out[k] = "right";
  }
  return out;
}
// A person's name alone on a line: two to four capitalised words (an initial
// among them), a trailing comma; and what an attorney's lines carry that a
// clerk's never does.
const PERSON_RE = /^[A-Z][a-z'’-]+(?:\s+(?:[A-Z]\.|[A-Z][a-z'’-]+)){1,3},?$/;
const CLERK_OFFICE_RE = /Executive\s+Officer|Clerk\s+of\s+(the\s+)?Court|Court\s+Executive/i;
const ATTORNEY_RE = /\bSBN\b|Bar\s+No|@|\(\d{3}\)|\bEsq\b|\b(LLP|LLC|APC|P\.C\.|LAW)\b/i;
