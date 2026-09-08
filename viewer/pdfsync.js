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
