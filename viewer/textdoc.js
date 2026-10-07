// textdoc.js
//
// The text reader's document model — every decision about a PDF-Linker text
// export that does not need a DOM, so it can be tested from Node
// (test-textdoc.mjs) and the wiring in text-reader.js stays thin.
//
//   parseExport / serializeExport   the file as PAGES. PDF-Linker writes one
//       "====== Page N ======" header per PDF page (a printed page number and
//       a REVIEW clause may ride on it), and a Combined Text.txt puts a
//       "#### DOCUMENT n OF m IN THIS COMBINED FILE: name ####" banner in
//       front of each member. The reader lays each page out as a sheet, the
//       way a PDF viewer would. Round-trips byte for byte, which is the
//       property a save depends on: a file the reader only opened and saved
//       must come back identical.
//   gutterPrefix    the pleading line number a line opens with, so it can be
//       styled as a margin and left out of nothing.
//   serializeNodes  a page body's DOM → the text that goes to DISK. A
//       pseudonym span writes its FAKE, never the real name it shows; that is
//       the whole rule the reader is built on, stated once, here.
//   textOf          the same walk for what the page DISPLAYS.
//   findRealsInPlain   real values standing in the editable plain text — the
//       ones a save has to turn back into fakes, and the ones to warn about.
//   formatValuesFile / parseValuesFile / addValue / dropFlagsInKey   the New
//       Real Values.txt list: names the operator flagged as unfaked, handed to
//       PDF-Linker for its next pass over the folder, and dropped again once a
//       key comes back with them in it — that case's own key (keyAnswersFlags).
//   isExportName / isKeyName   which files in a case folder are documents.
//   FONT_PRESETS / DEFAULT_SETTINGS   the reading settings.

import { caseShape, applyCase, translateRuns, findRealSpans } from "./pseudo-key.js";

// ---- the file as pages ---------------------------------------------------------

// PDF-Linker's own header shape (_PN_PAGE_HEADER_RE): the PDF page, an optional
// printed page, and an optional " — REVIEW: …" clause between the number and
// the closing rule.
export const PAGE_HEADER_RE = /^====== Page (\d+)(?: \(printed p\. ([^)]+)\))?(?: — (.*?))? ======$/;
// A Combined Text.txt member banner (_COMBINE_DOC_RE).
export const DOC_BANNER_RE = /^#+ DOCUMENT (\d+) OF (\d+) IN THIS COMBINED FILE: (.+?) #+$/;
// A pleading gutter number: the export writes `f"{num:>2}  "` plus the body,
// two or MORE spaces (a centred heading on a numbered line is indented to its
// own column), or nothing at all on an empty numbered line. One or two
// digits, since pleading paper numbers 1-28.
export const GUTTER_RE = /^( ?\d{1,2})(?:( {2,})(?=\S)|( *)$)/;

/**
 * text → { newline, trailingNewline, pages: [{ banner, header, number,
 * printed, review, lines }] }.
 *
 * `banner` and `header` are the ORIGINAL lines, kept verbatim so the
 * serialization can put them back; `number` / `printed` / `review` are read
 * off the header for display. Text before the first header (or a Word export,
 * which has no headers at all) is a page with neither.
 */
export function parseExport(text) {
  const src = String(text == null ? "" : text);
  const crlf = (src.match(/\r\n/g) || []).length;
  const lf = (src.match(/\n/g) || []).length;
  const newline = crlf > 0 && crlf * 2 >= lf ? "\r\n" : "\n";
  const trailingNewline = /\n$/.test(src);
  let body = src.replace(/\r\n/g, "\n");
  if (trailingNewline) body = body.slice(0, -1);
  const lines = body.length ? body.split("\n") : [];

  const pages = [];
  let page = null;
  const open = (banner, header) => {
    page = { banner: banner || null, header: header || null, number: null, printed: null, review: null, lines: [] };
    if (header) {
      const m = header.match(PAGE_HEADER_RE);
      if (m) {
        page.number = parseInt(m[1], 10);
        page.printed = m[2] || null;
        page.review = m[3] || null;
      }
    }
    pages.push(page);
    return page;
  };
  for (const line of lines) {
    if (PAGE_HEADER_RE.test(line)) {
      open(null, line);
      continue;
    }
    if (DOC_BANNER_RE.test(line)) {
      open(line, null);
      continue;
    }
    if (!page) open(null, null);
    page.lines.push(line);
  }
  if (!pages.length) open(null, null);
  return { newline, trailingNewline, pages };
}

/** The inverse of parseExport, byte for byte. */
export function serializeExport(doc) {
  const nl = doc.newline || "\n";
  const out = [];
  for (const p of doc.pages || []) {
    if (p.banner != null) out.push(p.banner);
    if (p.header != null) out.push(p.header);
    for (const l of p.lines || []) out.push(l);
  }
  return out.join(nl) + (doc.trailingNewline ? nl : "");
}

/** A page's label as a reader wants it, from the header's parts. */
export function pageLabel(page) {
  const p = page || {};
  if (p.banner) {
    const m = p.banner.match(DOC_BANNER_RE);
    return m ? `Document ${m[1]} of ${m[2]}: ${m[3]}` : p.banner;
  }
  if (p.number == null) return p.header ? p.header : "";
  let s = `Page ${p.number}`;
  if (p.printed) s += ` (printed p. ${p.printed})`;
  return s;
}

/**
 * Whether a page is PLEADING PAPER — numbered down its margin — from its
 * lines: at least three carry a gutter number, or at least one does and
 * they are half of the non-blank lines. A lone "1" opening a short
 * exhibit page is not a margin.
 */
export function pageIsNumbered(lines) {
  let numbered = 0, filled = 0;
  for (const l of lines || []) {
    if (!String(l).trim()) continue;
    filled++;
    if (gutterPrefix(l)) numbered++;
  }
  return numbered >= 3 || (numbered >= 1 && numbered * 2 >= filled);
}

/** The gutter number a line opens with: { gutter, rest } or null. */
export function gutterPrefix(line) {
  const m = String(line == null ? "" : line).match(GUTTER_RE);
  if (!m) return null;
  return { gutter: m[0], rest: line.slice(m[0].length) };
}

// PDF-Linker ends an export with a trailer of its own: a
// "====== Authorities cited (public verification links) ======" rule and a
// line per authority under it, riding on the last page's lines.
export const TRAILER_RE = /^\s*=+\s*Authorities cited\b.*?=+\s*$/i;

// ---- margin numbers the OCR missed ----------------------------------------------
//
// A scanned pleading reaches its export through OCR, and the OCR misses some
// of the numbers down the margin: a line that is plainly line 17 comes out
// with no number, an empty numbered line comes out blank or not at all, and a
// 12 is read as "l2", or as another number altogether. Side by side, a number
// read out of its order pinned its line at the wrong height and crammed every
// line between into the space above it; in the margin, the gaps read as lines
// that are not on the paper. Where a page carries enough of its numbers to be
// sure it is pleading paper, the missing ones are taken for what they are, an
// OCR defect, and put back (restoreMarginNumbers).

/** A line's margin number, or null: the gutter number it opens with, 1 or more. */
export function marginNumber(line) {
  const g = gutterPrefix(line);
  const n = g ? parseInt(g.gutter, 10) : NaN;
  return n > 0 ? n : null;
}

/**
 * The longest run of margin numbers that climbs down the page: the numbers
 * that are the paper's own, every other one a misreading. `nums` per line
 * (null where a line has none); answers a boolean per line. Of two runs as
 * long, the one whose numbers step with the lines (a number a line) is taken,
 * so a 16 read as 18 gives way to the 17 under it rather than the other way
 * round.
 */
export function numberChain(nums) {
  const n = (nums || []).length;
  // Numbers that already climb are their own run: the page as nearly every
  // page reads, and no reason to weigh one run against another.
  let climbs = true, was = 0;
  for (let j = 0; j < n && climbs; j++) if (nums[j] > 0) { climbs = nums[j] > was; was = nums[j]; }
  if (climbs) return Array.from({ length: n }, (_, j) => nums[j] > 0);
  const len = new Array(n).fill(0), pen = new Array(n).fill(0), prev = new Array(n).fill(-1);
  let best = -1;
  for (let j = 0; j < n; j++) {
    if (!(nums[j] > 0)) continue;
    len[j] = 1;
    for (let i = 0; i < j; i++) {
      if (!(nums[i] > 0) || !(nums[i] < nums[j])) continue;
      const l = len[i] + 1, p = pen[i] + Math.abs((nums[j] - nums[i]) - (j - i));
      if (l > len[j] || (l === len[j] && p < pen[j])) { len[j] = l; pen[j] = p; prev[j] = i; }
    }
    if (best < 0 || len[j] > len[best] || (len[j] === len[best] && pen[j] < pen[best])) best = j;
  }
  const out = new Array(n).fill(false);
  for (let j = best; j >= 0; j = prev[j]) out[j] = true;
  return out;
}

// What OCR reads a margin digit as, most often: a 1 as l, I or |, a 0 as O,
// a 5 as S, a 2 as Z, an 8 as B, a 6 as b or G, a 9 as g or q.
const OCR_DIGITS = { l: "1", I: "1", "|": "1", "!": "1", o: "0", O: "0", s: "5", S: "5", z: "2", Z: "2", B: "8", b: "6", G: "6", g: "9", q: "9" };
const MISREAD_RE = /^( ?)([0-9lI|!oOsSzZBbGgq]{1,2})(?:( {2,})(?=\S)|( *)$)/;
/**
 * A margin number the OCR misread into letters ("l2", "I7", "2O"), opening a
 * line where a number stands: { n, rest, spacing } — what it reads as, the
 * line after it and the spacing between — or null. Only a token with at least
 * one such letter in it; an all-digit one is a gutter number already.
 */
export function misreadNumber(line) {
  const m = String(line == null ? "" : line).match(MISREAD_RE);
  if (!m || /^\d+$/.test(m[2])) return null;
  const digits = [...m[2]].map((c) => (/\d/.test(c) ? c : OCR_DIGITS[c])).join("");
  const n = parseInt(digits, 10);
  if (!(n > 0)) return null;
  return { n, rest: line.slice(m[0].length), spacing: m[3] || "" };
}

/** The line as numbered `n`: its misread number replaced, or the number put in front of it in the margin's two places. */
function numberedAs(line, n) {
  const num = String(n).padStart(2);
  const g = line.match(GUTTER_RE);
  if (g) return g[2] ? num + g[2] + line.slice(g[0].length) : num;
  const mis = misreadNumber(line);
  if (mis && mis.n === n) return mis.rest ? num + (mis.spacing || "  ") + mis.rest : num;
  if (!line.trim()) return num;
  // An unnumbered line stands four places in, where the number and its two
  // spaces would be: those four are the number's now.
  return num + "  " + (line.startsWith("    ") ? line.slice(4) : line);
}

const RESTORE_MIN = 8;      // margin numbers read on a page, at least, before any is put back
const RESTORE_SHARE = 0.5;  // …and at least this share of the numbers the page should carry
const RESTORE_BARE = 4;     // …and at most this many put back as bare lines where no line stands for them

/**
 * The number the document's pleading pages run to — 28 on California
 * pleading paper — read off its pages: the highest last number that two or
 * more of its pages reach, of the pages numbered well enough to count. The
 * OCR loses numbers at the foot of a page and never adds one past it, so the
 * highest is the paper's; two pages, so that one number misread high at the
 * foot of one page is not. Null where no two pages can say, and then nothing
 * is put back at the foot of a page.
 */
export function pleadingLast(pages) {
  const tops = [];
  for (const p of pages || []) {
    if (!p || p.header == null) continue;
    const nums = (p.lines || []).map(marginNumber);
    const chain = numberChain(nums);
    let count = 0, top = 0;
    chain.forEach((on, i) => { if (on) { count++; top = nums[i]; } });
    if (count < RESTORE_MIN || count < top * RESTORE_SHARE) continue;
    tops.push(top);
  }
  tops.sort((a, b) => b - a);
  return tops.length >= 2 ? tops[1] : null;
}

/**
 * A page's lines with the margin numbers the OCR missed put back, as
 * { lines, added } (`added`, the numbers put back, in order), or null where
 * nothing is — where the page does not carry enough of its numbers to be
 * pleading paper (RESTORE_MIN, and RESTORE_SHARE of the numbers it should
 * have), or where every number is there. `last` is the number the document's
 * pages run to (pleadingLast); without one, nothing is put back below the
 * last number read.
 *
 * A number is put back only where it cannot be anything else:
 * - between two numbers read, as many lines as numbers missing: one each, in
 *   order — a blank line becomes the bare number, a misread one its number;
 * - between two numbers with no line between them: each missing number as a
 *   bare line of its own (an empty numbered line the OCR dropped), up to
 *   RESTORE_BARE of them — more is a number misread high, not lines lost;
 * - between two with more lines than numbers missing (a caption's single-
 *   spaced lines among them): only where exactly that many of those lines
 *   open with a misread number;
 * - above the first number read and below the last: the run of lines that
 *   stands against it, one each, and any number left over on the blank lines
 *   beyond them, or as a bare line of its own — never past a line of text
 *   standing apart from the numbered lines (a filing stamp, the footer).
 * Anything else is left as the OCR wrote it: a number on the wrong line puts
 * that line at the wrong height, which is worse than a number missing. A
 * number read out of its order (one that is not in numberChain), or past the
 * one the pages run to, is put right where its line takes a number here, and
 * left as it reads otherwise.
 */
export function restoreMarginNumbers(lines, { last = 0 } = {}) {
  const src = (lines || []).map((l) => String(l == null ? "" : l));
  let end = src.findIndex((l) => TRAILER_RE.test(l));
  if (end < 0) end = src.length;
  const nums = src.slice(0, end).map(marginNumber);
  // A number past the one the pages run to is a misreading, whatever its order.
  const chain = numberChain(last > 0 ? nums.map((n) => (n > last ? null : n)) : nums);
  const at = [];
  chain.forEach((on, i) => { if (on) at.push([i, nums[i]]); });
  if (!at.length) return null;
  const top = at[at.length - 1][1];
  if (at.length < RESTORE_MIN || at.length < Math.max(top, last || 0) * RESTORE_SHARE) return null;
  const give = new Map();   // line index → the number it takes
  const insert = new Map(); // line index → the bare numbers that go in before it
  const blank = (i) => !src[i].trim();
  const put = (i, ns) => { if (ns.length) insert.set(i, (insert.get(i) || []).concat(ns)); };
  const run = (from, to) => { const out = []; for (let n = from; n <= to; n++) out.push(n); return out; };
  // Between two numbers read.
  for (let c = 1; c < at.length; c++) {
    const [p, a] = at[c - 1], [q, b] = at[c];
    const k = b - a - 1;
    if (k <= 0) continue;
    const between = [];
    for (let i = p + 1; i < q; i++) between.push(i);
    let pick = null;
    if (between.length === k) pick = between;
    else if (!between.length) { if (k <= RESTORE_BARE) put(q, run(a + 1, b - 1)); }
    else if (between.length > k) {
      const marked = between.filter((i) => {
        if (nums[i] != null) return true;
        const mis = misreadNumber(src[i]);
        return !!mis && mis.n > a && mis.n < b;
      });
      if (marked.length === k) pick = marked;
    }
    if (pick) pick.forEach((i, j) => give.set(i, a + 1 + j));
  }
  // Above the first number read: the lines standing against it, nearest
  // first, then the blank lines above them; whatever is left, bare lines.
  {
    const [p, a] = at[0];
    const k = a - 1;
    let i = p - 1;
    const text = [];
    while (i >= 0 && !blank(i)) text.push(i--);
    if (k > 0 && text.length <= k) {
      let n = a - 1;
      for (const t of text) give.set(t, n--);
      while (n >= 1 && i >= 0 && blank(i)) give.set(i--, n--);
      if (n >= 1 && n <= RESTORE_BARE) put(i + 1, run(1, n));
    }
  }
  // Below the last: the same, down the page, to the number the pages run to.
  if (last > top) {
    const [q, b] = at[at.length - 1];
    const k = last - b;
    let i = q + 1;
    const text = [];
    while (i < end && !blank(i)) text.push(i++);
    if (text.length <= k) {
      let n = b + 1;
      for (const t of text) give.set(t, n++);
      while (n <= last && i < end && blank(i)) give.set(i++, n++);
      if (n <= last && last - n < RESTORE_BARE) put(i, run(n, last));
    }
  }
  if (!give.size && !insert.size) return null;
  const out = [];
  const added = [];
  for (let i = 0; i <= src.length; i++) {
    for (const n of insert.get(i) || []) { out.push(String(n).padStart(2)); added.push(n); }
    if (i === src.length) break;
    if (give.has(i)) {
      const n = give.get(i);
      out.push(numberedAs(src[i], n));
      added.push(n);
    } else out.push(src[i]);
  }
  return { lines: out, added: added.sort((x, y) => x - y) };
}

// ---- a page that did not OCR ----------------------------------------------------
//
// A page whose text is not worth keeping — an exhibit the OCR mangled, a
// photograph read as letters — is written as this one line instead, so whoever
// reads the export next (PDF-Linker, a model, a person) is told the page is
// there and its text is not, rather than handed the noise.
export const DID_NOT_OCR = "[DID NOT OCR]";

/**
 * A page's lines with its text stripped and DID_NOT_OCR in its place. The
 * page header is not a line and is untouched; the trailer is PDF-Linker's and
 * not the page's text, so it stays, with the blank lines that stood before it.
 */
export function didNotOcrLines(lines) {
  const src = (lines || []).map((l) => String(l == null ? "" : l));
  const t = src.findIndex((l) => TRAILER_RE.test(l));
  if (t < 0) return [DID_NOT_OCR];
  let from = t;
  while (from > 0 && !src[from - 1].trim()) from--;
  return [DID_NOT_OCR, ...src.slice(from)];
}

// ---- the page body's DOM, both ways ---------------------------------------------
//
// The reader renders a page body as text nodes, gutter spans (decoration
// around the number), and PSEUDONYM spans: an element with a `data-fake`
// attribute showing the real value. The walks below are the only two readers
// of that structure, and they are written against a minimal node interface
// (nodeType, nodeName, childNodes, data/nodeValue, getAttribute) so they can
// be tested without a browser.
//
// Chrome's `contenteditable="plaintext-only"` inserts a "\n" for Enter inside a
// pre-wrap element, but a <br> or a wrapping <div> can still arrive (a paste,
// an older engine), so both are read as line breaks too — except a <br> that
// CLOSES its element, which is the placeholder an empty editable block
// carries so the caret has somewhere to go (Chrome leaves one behind when a
// block is emptied, and the reader puts one in every empty line slot); a
// trailing line break renders as nothing, and it is read as nothing.

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const BLOCKS = new Set(["DIV", "P", "LI"]);

function walk(node, emit, opts) {
  const fakes = !!(opts && opts.fakes);
  // `mark` is told where a SPOT KEEP's span starts and ends in what is being
  // emitted (see serializeHeld): a value the operator said to leave alone at
  // this one place, which is therefore plain text on disk like any other.
  const mark = opts && opts.mark;
  // `text` is told of each text node as its text is about to be emitted, and
  // `fake` of each pseudonym span as its fake is (see serializeMapped). A
  // pseudonym span's own text is never one of the text nodes.
  const onText = opts && opts.text;
  const onFake = opts && opts.fake;
  const rec = (n, atStart) => {
    if (n.nodeType === TEXT_NODE) {
      if (onText) onText(n);
      emit(n.data != null ? n.data : n.nodeValue || "");
      return;
    }
    if (n.nodeType !== ELEMENT_NODE) return;
    const name = String(n.nodeName || "").toUpperCase();
    if (name === "BR") {
      if (n.nextSibling) emit("\n");
      return;
    }
    if (mark && n.getAttribute && n.getAttribute(HERE_ATTR) != null) {
      mark("in");
      for (const c of n.childNodes || []) rec(c, false);
      mark("out");
      return;
    }
    const fake = n.getAttribute ? n.getAttribute("data-fake") : null;
    if (fake != null) {
      // A pseudonym span: the file gets the fake, the screen gets whatever
      // the span shows (its real name, or the fake while fakes are shown).
      if (onFake) onFake(n);
      if (fakes) emit(fake);
      else {
        let shown = "";
        for (const c of n.childNodes || []) if (c.nodeType === TEXT_NODE) shown += c.data != null ? c.data : c.nodeValue || "";
        emit(shown);
      }
      return;
    }
    if (BLOCKS.has(name) && !atStart) emit("\n");
    let first = true;
    for (const c of n.childNodes || []) {
      rec(c, first && atStart);
      first = false;
    }
  };
  rec(node, true);
}

/** What a page body writes to DISK: fakes underneath, real names never. */
export function serializeNodes(root) {
  let out = "";
  walk(root, (s) => { out += s; }, { fakes: true });
  return out;
}

/** What a page body DISPLAYS. */
export function textOf(root) {
  let out = "";
  walk(root, (s) => { out += s; }, { fakes: false });
  return out;
}

// ---- spot keeps: a value left as it reads at ONE place ---------------------------
//
// The two keeps the reader has always had are decisions about a VALUE: leave
// "Careau" alone in this case, or in every case. Neither can say what a name
// on every document needs — the Clerk's own name, whose "David" must read as
// itself where it stands while a party's "David" stays faked, since one
// pseudonym standing for both would say the party is a David too. A SPOT KEEP
// is that narrower decision: this occurrence, here, and no other.
//
// The span the reader marks it with carries no fake, so the disk text gets the
// real value at that one place like any other plain text, and the round trip
// is unchanged. What has to be remembered is WHICH occurrence it was, and the
// disk text is the only thing both halves of the reader agree on: a spot is
// its value and its ordinal among that value's occurrences in the page's own
// disk text ({ page, value, nth }). Every occurrence of the value elsewhere on
// the page is a fake and spells differently, so the ordinal is stable under
// every edit but one to the spot's own line.
const HERE_ATTR = "data-here";

/**
 * What a page body writes to disk, and where its spot keeps landed in it:
 * { text, held: [[start, end), …], pns: [[start, end), …] } — `held` the
 * ranges a save must leave as they read rather than write back to their
 * pseudonyms, `pns` the fakes the run wrote. With `mapped`, `segs` as well:
 * each text node and where its text stands in `text` ([{ node, start, end }],
 * in order; a pseudonym span's own text is not one), which is what a reading
 * of the disk text needs to put its marks back on the page.
 */
export function serializeHeld(root, { mapped = false } = {}) {
  let out = "";
  const held = [];
  const segs = mapped ? [] : null;
  // …and where each PSEUDONYM's fake stands in it. The marks read the page with
  // these blanked (the reader's flatten, clearReading): a fake is what the run
  // wrote, and a word of it that happens to be a real the key binds is not a
  // name standing in the clear. A save that reads the page must read it the
  // same way, or it finds names the page never marks — and rewrites them
  // inside the fake.
  const pns = [];
  let open = -1;
  walk(root, (s) => { out += s; }, {
    fakes: true,
    text: mapped ? (n) => {
      const d = n.data != null ? n.data : n.nodeValue || "";
      segs.push({ node: n, start: out.length, end: out.length + d.length });
    } : null,
    mark: (phase) => {
      if (phase === "in") open = out.length;
      else if (open >= 0) { if (out.length > open) held.push([open, out.length]); open = -1; }
    },
    fake: (n) => {
      const f = n.getAttribute("data-fake") || "";
      if (f) pns.push([out.length, out.length + f.length]);
    },
  });
  return mapped ? { text: out, held, pns, segs } : { text: out, held, pns };
}

/**
 * What a page body writes to disk, with where each of its text nodes and
 * pseudonym spans stands in it: { text, at, pn } — Maps from a text node, and
 * from a pseudonym span, to the offset its text (its fake) begins at. A
 * pseudonym span's own text node is not in `at`.
 */
export function serializeMapped(root) {
  let out = "";
  const at = new Map(), pn = new Map();
  walk(root, (s) => { out += s; }, {
    fakes: true,
    text: (n) => at.set(n, out.length),
    fake: (n) => pn.set(n, out.length),
  });
  return { text: out, at, pn };
}

/** `text` with each range blanked to the same length, so offsets still hold. */
// ---- the names of DECIDED CASES ------------------------------------------------------
//
// Most of what a key matches in a brief is not the matter's own people: it is
// the parties of the decisions the brief cites. A pleading names Slaybaugh,
// Semole and Renoir a dozen times each, and a key that binds a surname of
// this case which happens to be one of theirs marks every one of them — which
// buries the leak that matters under a page of orange, and, worse, would have
// the save rewrite a published citation into a pseudonym.
//
// A cited case is recognisable, and that is the whole test here: a case NAME
// ("Rasho v. Quillmark", "People v. Superior Court") carrying the CITATION
// that makes it one — a year in parentheses, a volume and reporter, or
// "supra" — or a short form, the party's name with "supra" after it. The
// citation is what separates a decision from this matter's own caption, which
// is the one thing a leak gate must never pass: a caption has no reporter.
//
// Inside such a span a bound value is the DECISION's party and not this
// case's, whatever the key says: it stays as it reads, it is not marked, and
// the forward pass writes no pseudonym over it.

// A party: capitalised words, the small words a name carries, a corporate tail.
//
// COUNTED, NOT UNBOUNDED. A party's words used to be `*`, and a run of
// capitalised words that is NOT a case name — a declaration's "I, JOHN
// ANDREW FORSYTHE, DECLARE AS FOLLOWS UNDER PENALTY OF PERJURY…", a caption
// block, a signature block, a table of exhibits — is exactly what that costs
// most: from every word in the run, the engine tries every length the party
// could have been before it gives up for want of a " v. " after it. That is
// the run squared. Measured on a declaration's capitals: 2,000 words a second,
// 4,000 in four — and a tab that never comes back on a declaration of any
// length. A party is a few words (the citation engine allows four and five),
// so the words are COUNTED here, and the work from each place is a fixed
// handful rather than the rest of the paragraph.
const PARTY_WORDS = 8;
const PARTY = "[A-Z][\\w.'\u2019-]*(?:(?:\\s+(?:of|the|and|&|de|la|le|van|von|del|da|dos|ex|rel\\.)\\s+|\\s+)[A-Z\\d][\\w.'\u2019-]*|,\\s+(?:Inc|LLC|L\\.L\\.C|Corp|Co|Ltd|N\\.A|LP|L\\.P)\\.?){0," + PARTY_WORDS + "}";
const CASE_NAME_RE = new RegExp(PARTY + "\\s+v(?:s?\\.|s\\b|\\.|\\b)\\s+" + PARTY, "g");
// What must follow the name for it to be a citation and not a caption: a year
// in parentheses, a volume and reporter, or supra. A page or pin may come
// first ("at p. 220"), and a comma or an opening bracket may sit between.
const CITE_AFTER_RE = /^[\s,;]*(?:\((?:[^)]{0,40}\b\d{4})\)|\d{1,4}\s+[A-Z][\w.]*\s*\d|supra\b|\[\d)/i;
// A short form: the party alone, with supra after it.
const SUPRA_RE = new RegExp("[A-Z][\\w.'\u2019-]*(?:\\s+[A-Z][\\w.'\u2019-]*){0," + PARTY_WORDS + "}(?=,?\\s+supra\\b)", "g");

/**
 * Where `text` names a decided case: `[start, end]` per span, in order. A span
 * covers the case NAME alone — the citation after it is what proves the name
 * is one, and is not part of what the name protects.
 */
export function citedNameSpans(text) {
  const src = String(text == null ? "" : text);
  const out = [];
  for (const re of [CASE_NAME_RE, SUPRA_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      if (!m[0]) { re.lastIndex++; continue; }
      const end = m.index + m[0].length;
      if (re === CASE_NAME_RE && !CITE_AFTER_RE.test(src.slice(end, end + 60))) continue;
      out.push([m.index, end]);
    }
  }
  out.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  // The overlapping ones merged, so a caller has one span to test against.
  const merged = [];
  for (const [a, b] of out) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}
/** Whether [start, end) falls inside one of `spans`. */
export function insideSpans(spans, start, end) {
  for (const [a, b] of spans || []) {
    if (a > start) break;
    if (start >= a && end <= b) return true;
  }
  return false;
}

/**
 * Whether a name found in the text stands in a cited decision's name: the
 * whole of it, or — a name wrapped down a column, with the other column's text
 * between its pieces — each of its pieces (`ranges`).
 */
export function insideCited(cited, h) {
  if (insideSpans(cited, h.start, h.end)) return true;
  const r = h.ranges;
  return !!r && r.length > 1 && r.every(([a, b]) => insideSpans(cited, a, b));
}

/**
 * `text` with each range blanked to NULs (or to `fill`) — the same length out as in, so every
 * offset a caller has read off the original still points at the same character.
 *
 * ONE PASS, not one per range. It used to rebuild the whole string for each
 * range in turn (slice + repeat + slice), which is the text copied once per
 * range: a five-hundred-kilobyte export with a couple of thousand cited names
 * in it is a gigabyte of copying, for one document, and the folder sweep does
 * it to every document in the case and again whenever a keep moves. Under the
 * profiler it was the largest single thing the reader did. The pieces are cut
 * once and joined instead.
 *
 * The ranges are sorted and clamped here rather than trusted: blanking is
 * idempotent and order cannot change the answer, so a caller handing them over
 * in any order — or running past the end of the text — gets the same string.
 */
export function blankRanges(text, ranges, fill = "\u0000") {
  if (!ranges || !ranges.length) return text;
  const src = String(text == null ? "" : text);
  const spans = [];
  for (const r of ranges) {
    if (!r) continue;
    const a = Math.max(0, Math.min(src.length, Math.trunc(r[0])));
    const b = Math.max(0, Math.min(src.length, Math.trunc(r[1])));
    if (b > a) spans.push([a, b]);
  }
  if (!spans.length) return src;
  spans.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out = [];
  let at = 0;
  for (const [a, b] of spans) {
    if (b <= at) continue;          // inside one already blanked
    const from = a > at ? a : at;   // …or overlapping the end of it
    if (from > at) out.push(src.slice(at, from));
    out.push(fill.repeat(b - from));
    at = b;
  }
  out.push(src.slice(at));
  return out.join("");
}

/**
 * What a document's FILE is carrying in the clear, read THE WAY THE PAGE READS
 * IT — so the ⚠ beside a document in the folder's list and the walk through
 * the names, which reads the page, give the same answer about it.
 *
 * They used to read two different texts. The page is built a page at a time,
 * each pseudonym the run wrote made a span of its own and each spot keep ("keep
 * just this one") a span of its own, and the marks read it with both blanked:
 * a pseudonym is the fake in the file, whatever real name is painted over it,
 * and a spot keep is a real name left there on purpose. The folder sweep read
 * the raw file, so a key whose real "Jones" is a word of the fake "Mary Jones"
 * found a leak inside every "Mary Jones", and a name kept where it stood was
 * counted as long as the file carried it. The document got its ⚠, and walking
 * into it found nothing.
 *
 * `rev` is the key's fake → real matcher (what the page is built with), `reals`
 * the key less its keeps, `flagRx` the flagged values' matcher, `spots` the
 * document's own spot keeps ({ page, value, nth }, page by page of this file),
 * `mask(flat, raw)` the case-wide keeps (the same length out as in; `raw`, the
 * page as it stands, for a kept value wrapped down a column). Each page is read on
 * its own, as the page is: its text as buildBody gets it, the pseudonyms and
 * the spot keeps blanked to spaces as flatten blanks them, the names of cited
 * decisions spared from the leaks.
 * → { values: [the real value of every occurrence], flags: count }
 */
export function clearReading(text, { rev = null, reals = null, flagRx = null, spots = null, mask = null } = {}) {
  const values = [];
  let flags = 0;
  if (!reals && !flagRx) return { values, flags };
  const pages = parseExport(text).pages;
  for (let i = 0; i < pages.length; i++) {
    const raw = pages[i].lines.join("\n");
    const blank = spotRanges(raw, spotsOnPage(spots, i));
    if (rev) {
      let at = 0;
      for (const r of translateRuns(rev, raw)) {
        const len = r.t === "swap" ? r.from.length : r.s.length;
        if (r.t === "swap") blank.push([at, at + len]);
        at += len;
      }
    }
    const flat = blankRanges(raw, blank, " ");
    if (reals) {
      // A name wrapped down a column is read too, its cells off the page as
      // it stands (`layout`), not off the reading with its fakes blanked out.
      const cited = citedNameSpans(flat);
      for (const h of findRealSpans(reals, mask ? mask(flat, raw) : flat, { layout: raw })) {
        if (!insideCited(cited, h)) values.push(h.real);
      }
    }
    if (flagRx) {
      // The flagged values are read as the page shows the text — each fake as
      // the real name it stands for — so a flagged name with a pseudonym in
      // it ("Rosa" in the clear, "Delgado" faked) is found, and counted where
      // any of it stands in the clear (clearPieces): what is inside a fake the
      // run has faked already, and a spot keep stands on purpose.
      let shown = "", rawAt = 0;
      const held = [], plain = []; // plain: [raw start, shown start, length] per run of the file's own text
      for (const r of rev ? translateRuns(rev, raw) : [{ t: "text", s: raw }]) {
        if (r.t === "swap") {
          held.push([shown.length, shown.length + r.to.length]);
          shown += r.to;
          rawAt += r.from.length;
        } else {
          plain.push([rawAt, shown.length, r.s.length]);
          shown += r.s;
          rawAt += r.s.length;
        }
      }
      const toShown = (o) => { for (const [rs, ss, len] of plain) if (o >= rs && o <= rs + len) return ss + (o - rs); return null; };
      for (const [x, y] of spotRanges(raw, spotsOnPage(spots, i))) {
        const a = toShown(x), b = toShown(y);
        if (a != null && b != null) held.push([a, b]);
      }
      held.sort((p, q) => p[0] - q[0]);
      flagRx.lastIndex = 0;
      let m;
      while ((m = flagRx.exec(shown))) {
        if (clearPieces(shown, m.index, m.index + m[0].length, held).length) flags++;
        if (m.index === flagRx.lastIndex) flagRx.lastIndex++;
      }
    }
  }
  return { values, flags };
}

/**
 * The parts of `text`[a, b) that stand in the clear: the match less every
 * place in `held` ([from, to) pairs sorted by `from`: a pseudonym's real name
 * shown over its fake, a spot keep, a margin number), each trimmed of blank,
 * and only the parts with a letter or a digit in them. None for a match
 * standing wholly inside what is held — a value the run has faked already.
 * What a flagged value's red mark is drawn over, and what makes it count.
 */
export function clearPieces(text, a, b, held) {
  const raw = [];
  let at = a;
  for (const [x, y] of held || []) {
    if (y <= at) continue;
    if (x >= b) break;
    if (x > at) raw.push([at, x]);
    at = Math.max(at, y);
    if (at >= b) break;
  }
  if (at < b) raw.push([at, b]);
  const out = [];
  for (let [x, y] of raw) {
    while (x < y && /\s/.test(text[x])) x++;
    while (y > x && /\s/.test(text[y - 1])) y--;
    if (y > x && /[\p{L}\p{N}]/u.test(text.slice(x, y))) out.push([x, y]);
  }
  return out;
}

function escapeRe(s) {
  return String(s == null ? "" : s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every occurrence of `value` in `text`, as [start, end) pairs. Whole words
 * only, and by the same boundary rule the key's own matcher uses, so a fake
 * that happens to read "Davidson" holds no occurrence of "David".
 */
export function occurrencesOf(text, value) {
  const out = [];
  const v = String(value == null ? "" : value);
  if (!v || !text) return out;
  const rx = new RegExp("(?<![A-Za-z0-9_])" + escapeRe(v) + "(?![A-Za-z0-9_])", "gi");
  let m;
  while ((m = rx.exec(text))) {
    out.push([m.index, m.index + m[0].length]);
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return out;
}

/** A spot keep as the list holds it: { page, value, nth }. */
export function makeSpot(page, value, nth) {
  return { page: Number(page) || 0, value: normalizeValue(value), nth: Math.max(0, Number(nth) || 0) };
}
/** A stored list, cleaned of anything that is not a spot. */
export function normalizeSpots(list) {
  return (Array.isArray(list) ? list : [])
    .filter((s) => s && s.value)
    .map((s) => makeSpot(s.page, s.value, s.nth));
}
export function sameSpot(a, b) {
  return !!a && !!b && a.page === b.page && a.nth === b.nth && foldKey(a.value) === foldKey(b.value);
}
/** The spots on one page, in the order they stand. */
export function spotsOnPage(spots, page) {
  return (spots || []).filter((s) => s.page === page).sort((a, b) => a.nth - b.nth);
}
/**
 * Where a page's spots stand in its disk text: [[start, end), …], sorted. A
 * spot whose occurrence is no longer there — its line edited since — simply
 * does not apply, and the value goes back to being faked.
 */
export function spotRanges(text, spots) {
  const out = [];
  for (const s of spots || []) {
    const at = occurrencesOf(text, s.value)[s.nth];
    if (at) out.push(at);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * The page's lines from the DOM (for the document model) — what
 * serializeNodes yields, split.
 */
export function linesFromNodes(root) {
  return serializeNodes(root).split("\n");
}

// ---- what an edit wrote ------------------------------------------------------------
//
// A real name TYPED into a page is marked as a pseudonym once the caret has
// left it (the reader's convertTypedReals), so the file carries the fake as if
// the run had written it. A real name the page already carried was not typed:
// one the run missed is the review's to decide, and a save leaves an undecided
// one where it stands; a cited decision's party is never faked at all
// (citedNameSpans). Typing anywhere on a page used to mark every real name in
// its plain text, which made both decisions for the operator — a citation
// rewritten into a case that does not exist among them.
//
// So the question is put to the edit: which places in the page's text did it
// write? A diff of the page's disk text against the text it was built from
// answers it, line by line first, so a page that kept most of its lines finds
// them kept whatever moved around them, then character by character inside
// the lines that changed, so the words of a changed line that the edit did not
// touch are not taken for typed. An Enter on pleading paper moves the text
// down the numbered slots and leaves the numbers where they were: every line
// below it differs, and the character pass finds the words still there and
// only the numbers and the break moved.

/**
 * Myers' shortest edit script between two sequences (strings, or arrays of
 * numbers), as the runs where they differ, in order: [{ a0, a1, b0, b1 }] —
 * `a`'s [a0, a1) became `b`'s [b0, b1), either side possibly empty. Null where
 * the script is longer than `maxD`: past that, where the edit fell is not
 * worth the memory of finding out.
 */
function editHunks(a, b, maxD) {
  const n = a.length, m = b.length;
  const lim = Math.min(n + m, maxD);
  const off = lim + 1;
  const v = new Int32Array(2 * lim + 3);
  const trace = [];
  let D = -1;
  for (let d = 0; d <= lim && D < 0; d++) {
    // Each diagonal's furthest reach after d - 1 steps, kept for the walk back.
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { D = d; break; }
    }
  }
  if (D < 0) return null;
  // Walked back from the end, a step at a time; steps with nothing in common
  // between them are one run.
  const hunks = [];
  let cur = null;
  let x = n, y = m;
  for (let d = D; d > 0; d--) {
    const w = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && w[k - 1 + d + 1] < w[k + 1 + d + 1]) ? k + 1 : k - 1;
    const prevX = w[prevK + d + 1], prevY = prevX - prevK;
    let same = false;
    while (x > prevX && y > prevY) { x--; y--; same = true; }
    if (same || !cur) { cur = { a0: x, a1: x, b0: y, b1: y }; hunks.push(cur); }
    cur.a0 = prevX;
    cur.b0 = prevY;
    x = prevX;
    y = prevY;
  }
  return hunks.reverse();
}

/**
 * Where `after` differs from `before`, in `after`'s own places: [start, end)
 * for text an edit put in, [at, at] for a place it took text out. What
 * spanEdited asks of.
 */
export function editedSpans(before, after, { maxD = 1000 } = {}) {
  const a0 = String(before == null ? "" : before), b0 = String(after == null ? "" : after);
  const out = [];
  if (a0 === b0) return out;
  // The head and tail the two have in common: an edit made in one place,
  // which is most of them, is what is left between.
  const lim = Math.min(a0.length, b0.length);
  let p = 0;
  while (p < lim && a0.charCodeAt(p) === b0.charCodeAt(p)) p++;
  let s = 0;
  while (s < lim - p && a0.charCodeAt(a0.length - 1 - s) === b0.charCodeAt(b0.length - 1 - s)) s++;
  const a = a0.slice(p, a0.length - s), b = b0.slice(p, b0.length - s);
  const put = (from, to) => out.push([p + from, p + to]);
  if (!a.length || !b.length) { put(0, b.length); return out; }
  // Line by line.
  const al = a.split("\n"), bl = b.split("\n");
  const ids = new Map();
  const id = (l) => { let k = ids.get(l); if (k == null) { k = ids.size; ids.set(l, k); } return k; };
  const starts = (lines) => { const st = []; let at = 0; for (const l of lines) { st.push(at); at += l.length + 1; } return st; };
  const bAt = starts(bl);
  const lineHunks = editHunks(al.map(id), bl.map(id), maxD);
  if (!lineHunks) { put(0, b.length); return out; }
  for (const h of lineHunks) {
    const from = h.b0 < bl.length ? bAt[h.b0] : b.length;
    if (h.b1 === h.b0) { put(from, from); continue; }
    const bText = bl.slice(h.b0, h.b1).join("\n");
    if (h.a1 === h.a0) { put(from, from + bText.length); continue; }
    // …then character by character inside the lines that changed.
    const chars = editHunks(al.slice(h.a0, h.a1).join("\n"), bText, maxD);
    if (!chars) { put(from, from + bText.length); continue; }
    for (const c of chars) put(from + c.b0, from + c.b1);
  }
  return out;
}

/** Whether an edit (editedSpans) wrote any of [start, end): put text inside it, or took text out of its middle. */
export function spanEdited(spans, start, end) {
  for (const [a, b] of spans || []) {
    if (a === b ? start < a && a < end : a < end && b > start) return true;
  }
  return false;
}

/**
 * Of the real names found standing in a page's plain text (findRealsInPlain),
 * the ones an edit wrote: something of the edit is in each, and none stands in
 * a cited decision's name, which no pseudonym is ever written over — a
 * citation typed whole keeps its parties. `page` is serializeMapped of the page
 * as it stands, `built` the text the page was built from (or last saved as);
 * with none, nothing counts as typed.
 */
export function typedReals(hits, page, built) {
  if (!hits || !hits.length || built == null) return [];
  const spans = editedSpans(built, page.text);
  const where = [];
  for (const h of hits) {
    const o = page.at.get(h.node);
    if (o != null && spanEdited(spans, o + h.start, o + h.end)) where.push([h, o + h.start, o + h.end]);
  }
  if (!where.length) return [];
  const cited = citedNameSpans(page.text);
  return where.filter(([, s, e]) => !insideSpans(cited, s, e)).map(([h]) => h);
}

/**
 * The pseudonym spans an edit made that now stand in a cited decision's name:
 * a party marked at the as-you-type prompt, or by the converter in a pause,
 * before the rest of the citation was typed after it. [span element] — each
 * to go back to the name as typed, since a pseudonym there is a citation to a
 * case that does not exist. Spans the page was built with are not an edit's.
 */
export function typedPseudonymsCited(page, built) {
  if (built == null || !page.pn || !page.pn.size) return [];
  const spans = editedSpans(built, page.text);
  if (!spans.length) return [];
  const made = [];
  for (const [el, o] of page.pn) {
    const len = String(el.getAttribute("data-fake") || "").length;
    if (spanEdited(spans, o, o + len)) made.push([el, o, o + len]);
  }
  if (!made.length) return [];
  const cited = citedNameSpans(page.text);
  return made.filter(([, s, e]) => insideSpans(cited, s, e)).map(([el]) => el);
}

// ---- real values in the plain text ----------------------------------------------

/**
 * Real values (from the key's forward matcher) standing in PLAIN text —
 * outside any pseudonym span — with where they stand. `plain` is a list of
 * { node, text } segments the caller collected; offsets are into each
 * segment's own text. Returns [{ node, start, end, matched, real, fake }].
 */
export function findRealsInPlain(compiledForward, segments) {
  const out = [];
  if (!compiledForward || !compiledForward.rx) return out;
  const rx = compiledForward.rx;
  for (const seg of segments || []) {
    const text = seg.text || "";
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(text))) {
      const fake = lookupForward(compiledForward, m[0]);
      if (fake != null) out.push({ node: seg.node, start: m.index, end: m.index + m[0].length, matched: m[0], fake });
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
  }
  return out;
}

const POSS_MATCH_RE = /['’][sS]$/;
/** A value folded for comparison: trimmed, one space between words, lower case. */
export function foldValue(s) { return foldKey(s); }
function foldKey(s) {
  return String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();
}
// The fake in the matched text's own case, possessive carried — exactly what
// pseudo-key's forwardRuns writes, so the span made while typing and the
// text a save writes cannot differ.
/** The fake a real value takes, in the value's own case — null if unbound. */
export function fakeFor(compiledForward, value) {
  if (!compiledForward || !compiledForward.map) return null;
  return lookupForward(compiledForward, String(value == null ? "" : value));
}
function lookupForward(compiled, m) {
  let fake = compiled.map.get(foldKey(m));
  let suffix = "";
  if (fake == null) {
    const mp = m.match(POSS_MATCH_RE);
    if (!mp) return null;
    fake = compiled.map.get(foldKey(m.slice(0, -mp[0].length)));
    if (fake == null) return null;
    suffix = mp[0];
  }
  const shape = caseShape(suffix ? m.slice(0, -suffix.length) : m);
  const cased = applyCase(shape, fake);
  if (!suffix) return cased;
  return cased + (shape === "upper" ? suffix.toUpperCase() : shape === "lower" ? suffix.toLowerCase() : suffix);
}

// ---- New Real Values.txt ----------------------------------------------------------
//
// A name the operator spotted unfaked while reading is written to this file in
// the CASE FOLDER (beside pseudonym_key.xlsx), one value per line, and
// PDF-Linker reads it on its next pass over the folder as if each line had
// been given with --term. Lines opening with # are comments. No underscores
// in the name, by the owner's rule for documents.

export const VALUES_FILE = "New Real Values.txt";

const VALUES_HEAD = [
  "# New Real Values — written by the text reader for PDF-Linker.",
  "# One real value per line: names spotted unfaked in the scrubbed exports.",
  "# PDF-Linker reads this file from the case folder on its next run (and on",
  "# Apply Fixes) and pseudonymizes each value as if it had been given",
  "# with --term. A line 'no: VALUE' is the opposite — a value the run faked",
  "# that should be left as it is in this case (a cited decision's name); a",
  "# line 'never: VALUE' keeps it in every case. A line 'phrase: VALUE' is a",
  "# value of several words faked WHOLE, as one name, a word of it the key",
  "# fakes or keeps on its own notwithstanding. A line 'did not ocr: FILE |",
  "# page N' is a page marked Did not OCR: PDF-Linker marks it in the PDF,",
  "# never OCRs it again and exports it as [DID NOT OCR]. A line 'ocr again:",
  "# FILE | page N' undoes that: PDF-Linker takes the mark off the page and",
  "# its next full run reads the page again. A line 'text corrected: FILE |",
  "# page N | sum …' is a page whose text was typed in by hand: PDF-Linker",
  "# writes that text into the PDF as the page's text layer and never OCRs the",
  "# page again. Lines beginning with # are ignored. Delete a line to withdraw",
  "# it.",
];

// A keep line: `no: VALUE` (this case) or `never: VALUE` (every case).
export const KEEP_RE = /^(no|never)\s*:\s*(.+?)\s*$/i;
// A phrase line: `phrase: VALUE` — the worksheet's own `phrase`, a value of
// several words faked whole. It is a value to fake like any other line, so it
// is on the flagged list; the prefix is what says the words go together.
export const PHRASE_RE = /^phrase\s*:\s*(.+?)\s*$/i;
export const KEEP_CONTROLS = ["no", "never"];

/**
 * Whether a keep is work for PDF-Linker, or work already done.
 *
 * A keep says: do not fake this value. What that COSTS depends on what the
 * files already say, and the two cases are not the same job at all.
 *
 *   The run faked it. A file carries the pseudonym and only PDF-Linker can
 *     put the real name back, so the keep has to reach the case folder and the
 *     run has to happen before the files read the way the keep wants them to.
 *   The value stands in the clear. Nothing faked it, so there is nothing to
 *     un-fake: the files ALREADY read the way the keep wants them to. The keep
 *     is not an instruction, it is a note to the reader — stop marking this,
 *     it was left alone on purpose — and handing it to PDF-Linker would ask a
 *     run to do what has already been done.
 *
 * `faked` is a question about the WHOLE CASE, not about one document: a keep
 * is the case's, and a pseudonym standing in any export of the folder is a
 * name the next run would otherwise be the only thing able to restore.
 *
 * Two things spoil the second case. `never` is a decision about every matter
 * this operator will ever open, which only the case folder's file carries from
 * one to the next, so it is always written out. And a value PDF-Linker has
 * itself raised on LEAKS.xlsx is a question already asked: the worksheet's own
 * Fix? cell is where it gets answered, and a keep that stayed here would leave
 * that row standing open.
 */
export function keepNeedsRun({ control, faked, onLeaksSheet }) {
  return control === "never" || !!faked || !!onLeaksSheet;
}

// A keep's state, beside its control:
//   ""         PDF-Linker is owed it — the ordinary keep, written to the file.
//   "local"    the files already carry it out; it is not written anywhere.
//   "pending"  it LOOKS local, but the folder has not been read yet. Owed
//              until the reading says otherwise, because a keep wrongly held
//              back is a name the run never restores and nothing ever says so.
export const KEEP_STATES = ["local", "pending"];

/** A keep entry as the list holds it: { control, value } and, when it has one, `state`. */
export function makeKeep(control, value, state) {
  const c = String(control || "no").toLowerCase();
  const k = { control: KEEP_CONTROLS.includes(c) ? c : "no", value: normalizeValue(value) };
  // `never` reaches the next matter through the file and nowhere else, so it
  // is never anything but owed, however it was asked for.
  if (k.control === "no" && KEEP_STATES.includes(state)) k.state = state;
  return k;
}
/** Add a keep, or change the control of one already held (its spelling kept). */
export function addKeep(keeps, control, value, state) {
  const k = makeKeep(control, value, state);
  if (!k.value) return (keeps || []).slice();
  const have = (keeps || []).find((x) => foldKey(x.value) === foldKey(k.value));
  const out = (keeps || []).filter((x) => foldKey(x.value) !== foldKey(k.value));
  out.push(have ? makeKeep(k.control, have.value, k.state) : k);
  return out;
}
/** The keeps PDF-Linker is owed: everything the files do not already carry out. */
export function owedKeeps(keeps) {
  return (keeps || []).filter((k) => k.state !== "local");
}
/**
 * A keep the files already answer, turned back into one PDF-Linker is owed.
 * The facts a keep was taken under can change under it — another export in the
 * folder turns out to carry the pseudonym, or PDF-Linker raises the value on
 * LEAKS.xlsx — and this is the only direction that direction is ever taken
 * without evidence: a keep can stop being local, and nothing here makes one.
 */
export function owe(keeps, value) {
  return restate(keeps, value, "", (x) => !!x.state);
}
/**
 * …and the one move the other way, which needs the folder actually read: a
 * keep held owed only because nothing had looked yet, once looking says the
 * files carry it out. Only from `pending` — a keep that was owed on the
 * evidence stays owed.
 */
export function settleLocal(keeps, value) {
  return restate(keeps, value, "local", (x) => x.state === "pending");
}
function restate(keeps, value, state, when) {
  const k = foldKey(value);
  let moved = false;
  const out = (keeps || []).map((x) => {
    if (foldKey(x.value) !== k || !when(x)) return x;
    moved = true;
    return makeKeep(x.control, x.value, state);
  });
  return moved ? out : keeps;
}
export function removeKeep(keeps, value) {
  const k = foldKey(value);
  return (keeps || []).filter((x) => foldKey(x.value) !== k);
}
// A keeps list is asked about a value over and over: once per pseudonym span
// on the page when the marks are laid again, once per row of the key when the
// key is compiled. Scanning the list for each question is what makes a case
// with a thousand keeps in it a thousand times slower than one with ten —
// and a leak review makes a keep every time the operator says "no", so the
// reader got slower the further through the worksheet it went.
//
// So the list is indexed, and the index is hung off the list itself: the
// reader replaces a keeps list rather than editing it in place (addKeep and
// removeKeep above both return a new one), so an index built for a list is
// good for as long as that list is the list, and goes when it does.
const NO_KEEPS = [];
const keepIndexes = new WeakMap();
function keepIndex(keeps) {
  const list = keeps || NO_KEEPS;
  let index = keepIndexes.get(list);
  if (!index) {
    index = new Map();
    for (const k of list) { const f = foldKey(k && k.value); if (!index.has(f)) index.set(f, k); }
    keepIndexes.set(list, index);
  }
  return index;
}
export function keptControl(keeps, value) {
  const hit = keepIndex(keeps).get(foldKey(value));
  return hit ? hit.control : "";
}

/** A flagged value, normalised: one line, one space between words. */
export function normalizeValue(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
}

/** Add a value to the list (case-insensitive dedup). Returns the new list. */
export function addValue(list, value) {
  const v = normalizeValue(value);
  if (!v) return list.slice();
  const have = new Set((list || []).map((x) => foldKey(x)));
  if (have.has(foldKey(v))) return (list || []).slice();
  return (list || []).concat([v]);
}

export function removeValue(list, value) {
  const k = foldKey(value);
  return (list || []).filter((x) => foldKey(x) !== k);
}

/**
 * The flagged values a key now FAKES, split off from the ones it does not.
 *
 * A flag is a job handed to PDF-Linker: this name was left in the clear, fake
 * it on the next run. The next run's key comes back with the name in it, and
 * the job is done — the value is a pseudonym everywhere the run reached, and a
 * list that still carries it hands the same job over again and again.
 *
 * The test is the key's FORWARD side, over the whole value: a row for the
 * value itself (an alt spelling counts, being forward-only by design), not a
 * row for something inside it. The key binding "David" does not pseudonymize
 * the flagged "David W. Slayton" — half the name would still be standing —
 * so that flag stays. A value the operator has KEPT is not in the forward
 * side at all and stays flagged for the same reason: nothing has faked it.
 */
export function dropFlagsInKey(list, compiledForward) {
  const kept = [], dropped = [];
  for (const v of list || []) (fakeFor(compiledForward, v) ? dropped : kept).push(v);
  return { kept: dropped.length ? kept : (list || []).slice(), dropped };
}

/**
 * Whether the key in hand may answer a flag list: take a flag off it
 * (dropFlagsInKey) or keep a value of the folder's New Real Values.txt out of
 * it. Only a key read from that very list's case folder, or chosen by hand
 * while it was open, may — `keyOwner` and `listId` are both the list's storage
 * name. The key in hand outlives the folder it came from, and another case's
 * key binds that case's names: a flag it took off here would be a name nothing
 * has faked here and nobody is asking to fake any more. A flag left on is only
 * asked about again.
 */
export function keyAnswersFlags(keyOwner, listId) {
  return !!keyOwner && keyOwner === listId;
}

export function formatValuesFile(values, keeps, phrases, noOcr, ocrAgain, textFixed) {
  const body = (values || []).map(normalizeValue).filter(Boolean)
    .map((v) => (isPhrase(phrases, v) ? `phrase: ${v}` : v));
  // A local keep is left out on purpose: the file it would go into is a list of
  // work for the next run, and that keep is work the run has already done
  // (keepNeedsRun). Writing it would hand PDF-Linker a value to leave exactly
  // as it already is.
  const kept = owedKeeps(keeps).map((k) => makeKeep(k.control, k.value)).filter((k) => k.value).map((k) => `${k.control}: ${k.value}`);
  const pages = (noOcr || []).map(makeNoOcrEntry).filter(Boolean).map(noOcrLine);
  const again = (ocrAgain || []).map(makeNoOcrEntry).filter(Boolean).map(ocrAgainLine);
  const fixed = (textFixed || []).map(makeTextFixedEntry).filter(Boolean).map(textFixedLine);
  return VALUES_HEAD.concat(body, kept, pages, again, fixed).join("\n") + "\n";
}

// ---- a page PDF-Linker is to leave unread -------------------------------------
//
// ⊘ Did not OCR strips a page in the export the reader saves, and a full
// PDF-Linker run rebuilds every export from its PDF — so without telling it,
// the page is OCR'd again and its noise comes back. The page is handed over as
// one line of New Real Values.txt, `did not ocr: FILE | page N`: FILE is the
// source PDF's name where the reader knows it (the side-by-side pane's own
// match), else the export's, which PDF-Linker maps back to its PDF; N is the
// PDF page, as the export's header numbers it; and a pipe separates the two
// because no Windows file name can carry one. PDF-Linker writes a mark into
// the PDF's page and spends the line, and from then on exports the page as
// [DID NOT OCR] under a header saying so (headerSaysDidNotOcr) — which is how
// the reader knows a page is PDF-Linker's now and drops it from the list.

export const NOOCR_RE = /^did[\s-]*not[\s-]*ocr\s*:\s*(.+?)\s*\|\s*(?:pages?|pp?\.?)?\s*(\d+)\s*$/i;

/** A page to leave unread: { doc, pdf, page }, or null without a doc and a page. */
export function makeNoOcrEntry(e) {
  const doc = normalizeValue(e && e.doc);
  const pdf = normalizeValue(e && e.pdf);
  const page = Number(e && e.page);
  if (!(doc || pdf) || !Number.isInteger(page) || page < 1) return null;
  return { doc: doc || pdf, pdf, page };
}
/** Its line in New Real Values.txt. */
export function noOcrLine(e) {
  const x = makeNoOcrEntry(e);
  return x ? `did not ocr: ${x.pdf || x.doc} | page ${x.page}` : "";
}
/** Whether two entries name the same page: by the export, or by the file named. */
export function sameNoOcr(a, b) {
  const x = makeNoOcrEntry(a), y = makeNoOcrEntry(b);
  if (!x || !y || x.page !== y.page) return false;
  return foldKey(x.doc) === foldKey(y.doc) || foldKey(x.pdf || x.doc) === foldKey(y.pdf || y.doc);
}
/** The list with `entry` in it (`on`) or out of it; the same list when nothing moves. */
export function setNoOcr(list, entry, on) {
  const x = makeNoOcrEntry(entry);
  const have = list || [];
  if (!x) return have;
  const hit = have.some((e) => sameNoOcr(e, x));
  if (on) return hit ? have : have.concat([x]);
  return hit ? have.filter((e) => !sameNoOcr(e, x)) : have;
}
// ---- …and a page PDF-Linker is to read again ------------------------------------
//
// ↻ OCR This Page undoes ⊘ Did not OCR. Where the strip is the reader's own and
// never reached the case folder, the reader puts the page's text back itself;
// otherwise the page may already be marked in its PDF, and only PDF-Linker can
// take the mark off. It is handed over the same way, one line of New Real
// Values.txt naming the page the same way: `ocr again: FILE | page N`.
// PDF-Linker takes the mark off (and its own record of having read the page),
// spends the line, and its next full run reads the page and exports its text —
// which is how the reader knows the request is done and drops it.
export const OCRAGAIN_RE = /^ocr[\s-]*(?:this[\s-]*page[\s-]*)?again\s*:\s*(.+?)\s*\|\s*(?:pages?|pp?\.?)?\s*(\d+)\s*$/i;
// Any line opening that way is a page, never a value, whether or not it reads.
const OCRAGAIN_LEAD_RE = /^ocr[\s-]*(?:this[\s-]*page[\s-]*)?again\s*:/i;

/** Its line in New Real Values.txt (an entry as makeNoOcrEntry reads it). */
export function ocrAgainLine(e) {
  const x = makeNoOcrEntry(e);
  return x ? `ocr again: ${x.pdf || x.doc} | page ${x.page}` : "";
}
/** The list with `entry` in it or out of it — the same page list setNoOcr keeps. */
export const setOcrAgain = setNoOcr;

// ---- …and a page the operator TRANSCRIBED -------------------------------------
//
// ✎ Use my text is the sibling of ⊘ Did not OCR, for the page whose OCR was bad
// and whose text the operator has typed in by hand until it says what the page
// says. A full PDF-Linker run rebuilds every export from its PDF, so the
// transcription has to reach the PDF itself: the page is handed over as
// `text corrected: FILE | page N | sum XXXXXXXX`, FILE and N as for a DID NOT
// OCR line. PDF-Linker reads the page out of the export the reader saved, reads
// its pseudonyms back through the key, and draws it as the page's text layer
// in the PDF; it marks the page so no OCR pass reads over it again, spends the
// line, and from then on exports the page off that layer under a header saying
// TEXT CORRECTED (headerSaysTextCorrected).
//
// The SUM is the page's text as the reader last SAVED it (pageTextSum, which
// PDF-Linker's _pn_page_text_sum computes the same way over the same lines).
// PDF-Linker applies the line only where the export's page still reads that
// way, so a line that outlived its text — the export rewritten by a run since,
// or the page typed over and not saved — never freezes the wrong text into the
// PDF; it is left in the file, and the page is saved and marked again.
export const TEXTFIXED_RE = /^text[\s-]*corrected\s*:\s*(.+?)\s*\|\s*(?:pages?|pp?\.?)?\s*(\d+)\s*(?:\|\s*sum\s*([0-9a-f]{8})\s*)?$/i;
const TEXTFIXED_LEAD_RE = /^text[\s-]*corrected\s*:/i;
// A rule line ends a page's text, for the sum, as it does in PDF-Linker's own
// cut (the authorities trailer an older build wrote rides on the last page).
const PAGE_RULE_RE = /^=+ .* =+$/;

/** A page transcribed by hand: { doc, pdf, page, sum }, or null without a doc and a page. */
export function makeTextFixedEntry(e) {
  const x = makeNoOcrEntry(e);
  if (!x) return null;
  const sum = String((e && e.sum) || "").toLowerCase();
  return { ...x, sum: /^[0-9a-f]{8}$/.test(sum) ? sum : "" };
}
/** Its line in New Real Values.txt. */
export function textFixedLine(e) {
  const x = makeTextFixedEntry(e);
  return x ? `text corrected: ${x.pdf || x.doc} | page ${x.page}` + (x.sum ? ` | sum ${x.sum}` : "") : "";
}
/** The list with `entry` in it (`on`, its sum taking the entry's) or out of it; the same list when nothing moves. */
export function setTextFixed(list, entry, on) {
  const x = makeTextFixedEntry(entry);
  const have = list || [];
  if (!x) return have;
  const at = have.findIndex((e) => sameNoOcr(e, x));
  if (!on) return at < 0 ? have : have.filter((_, k) => k !== at);
  if (at < 0) return have.concat([x]);
  if (have[at].sum === x.sum) return have;
  return have.map((e, k) => (k === at ? { ...e, sum: x.sum } : e));
}
/**
 * The page's text as a checksum: FNV-1a, 32 bits, over the UTF-8 bytes of its
 * lines up to the first rule line, joined by newlines — each line's trailing
 * spaces, tabs and carriage returns dropped, and the blank lines at either end.
 * PDF-Linker's _pn_page_text_sum is the same function; the two are pinned to
 * the same values on both sides.
 */
export function pageTextSum(lines) {
  const src = (lines || []).map((l) => String(l == null ? "" : l));
  const r = src.findIndex((l) => PAGE_RULE_RE.test(l));
  const body = (r < 0 ? src : src.slice(0, r)).map((l) => l.replace(/[ \t\r]+$/, ""));
  while (body.length && !body[0]) body.shift();
  while (body.length && !body[body.length - 1]) body.pop();
  let h = 2166136261;
  for (const b of new TextEncoder().encode(body.join("\n"))) {
    h ^= b;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
/** Whether PDF-Linker wrote the page off the operator's transcription (its header says so). */
export function headerSaysTextCorrected(page) {
  return /\bTEXT CORRECTED\b/.test(String((page && (page.review || page.header)) || ""));
}

/** Whether a page's lines read DID_NOT_OCR and nothing else (the trailer aside). */
export function readsDidNotOcr(lines) {
  const src = (lines || []).map((l) => String(l == null ? "" : l));
  const t = src.findIndex((l) => TRAILER_RE.test(l));
  const body = (t < 0 ? src : src.slice(0, t)).map((l) => l.trim()).filter(Boolean);
  return body.length === 1 && body[0] === DID_NOT_OCR;
}
/** Whether PDF-Linker wrote the page as DID_NOT_OCR itself (its header says so). */
export function headerSaysDidNotOcr(page) {
  return /\bDID NOT OCR\b/.test(String((page && (page.review || page.header)) || ""));
}

/** The file's values to fake, in order (the keeps are parseReaderFile's). */
export function parseValuesFile(text) {
  return parseReaderFile(text).values;
}

/**
 * The file's lines: { values, keeps, phrases, noOcr, ocrAgain, textFixed }. A
 * phrase line is a value to fake, so it is in `values` too; `phrases` says
 * which of them go whole; `noOcr` is the pages marked Did not OCR, `ocrAgain`
 * the pages to read again and `textFixed` the pages transcribed by hand
 * ({ doc, pdf: "", page }, `doc` being whatever file the line names, and a
 * transcribed page's `sum`).
 */
export function parseReaderFile(text) {
  const values = [];
  const keeps = [];
  const phrases = [];
  let noOcr = [];
  let ocrAgain = [];
  let textFixed = [];
  const seen = new Set();
  for (const raw of String(text == null ? "" : text).split(/\r?\n/)) {
    const line = raw.replace(/^\ufeff/, "").trim();
    if (!line || line[0] === "#") continue;
    // A page, not a value: never flagged, whether or not it reads as one.
    if (/^did[\s-]*not[\s-]*ocr\s*:/i.test(line)) {
      const n = line.match(NOOCR_RE);
      if (n) noOcr = setNoOcr(noOcr, { doc: n[1], page: Number(n[2]) }, true);
      continue;
    }
    if (OCRAGAIN_LEAD_RE.test(line)) {
      const n = line.match(OCRAGAIN_RE);
      if (n) ocrAgain = setOcrAgain(ocrAgain, { doc: n[1], page: Number(n[2]) }, true);
      continue;
    }
    if (TEXTFIXED_LEAD_RE.test(line)) {
      const n = line.match(TEXTFIXED_RE);
      if (n) textFixed = setTextFixed(textFixed, { doc: n[1], page: Number(n[2]), sum: n[3] }, true);
      continue;
    }
    const m = line.match(KEEP_RE);
    const p = m ? null : line.match(PHRASE_RE);
    const v = normalizeValue(m ? m[2] : p ? p[1] : line);
    if (!v || seen.has(foldKey(v))) continue;
    seen.add(foldKey(v));
    if (m) keeps.push(makeKeep(m[1], v));
    else values.push(v);
    if (p) phrases.push(v);
  }
  return { values, keeps, phrases, noOcr, ocrAgain, textFixed };
}

/** Whether a flagged value is one to fake whole (`phrase:`). */
export function isPhrase(phrases, value) {
  const k = foldKey(value);
  return !!k && (phrases || []).some((x) => foldKey(x) === k);
}

/**
 * Whether a selection may be flagged, and why not. A pseudonym cannot be a
 * new real value (it is already faked), and a value must be short enough to
 * be a name rather than a paragraph.
 */
export const VALUE_MAX = 120;
/**
 * Why a selection may not be flagged as a real value, or "". `selectionText`
 * is the selection as the real names read; `allFaked`, that every word of it
 * is a pseudonym already — there is nothing left in the clear to hand over. A
 * selection only PARTLY faked ("Rosa" in the clear, "Delgado" a pseudonym) is
 * a name the run half missed, and is flagged whole.
 */
export function flagProblem(selectionText, allFaked) {
  const v = normalizeValue(selectionText);
  if (!v) return "Select the unfaked name first.";
  if (allFaked) return "That is already a pseudonym — its real name is shown over the fake.";
  if (v.length > VALUE_MAX) return `That is ${v.length} characters; a real value is a name, a number or an address, not a passage.`;
  return "";
}

/**
 * Whether a selection may be marked a phrase, and why not. A phrase is the
 * words TOGETHER, so it takes two of them at least — PDF-Linker reads
 * `phrase` on a single word as an ordinary yes. Unlike a flag it may take in a
 * pseudonym: the word the key already fakes on its own is usually the reason
 * to say the words go together. `text` is the selection as the real names read.
 */
export function phraseProblem(text) {
  const v = normalizeValue(text);
  if (!v) return "Select the words of the phrase first.";
  if (!/\S\s+\S/.test(v)) return "A phrase is two words or more.";
  if (v.length > VALUE_MAX) return `That is ${v.length} characters; a phrase is a name, not a passage.`;
  return "";
}

// ---- which files in a case folder are documents -----------------------------------

// PDF-Linker's own non-export .txt files (its _is_tool_txt_artifact plus the
// authorities list, the transcriptions a run could not apply and this tool's
// values file).
const TOOL_TXT = new Set(["leaks.txt", "pdf_linker_leaks.txt", "combined text.txt", "authorities cited.txt", "edited pages not applied.txt", VALUES_FILE.toLowerCase()]);
const MARKER_RE = /^(ETA|DONE) .*\.txt$/i;

/** A scrubbed export (or its quarantined *.txt.LEAK twin) by name. */
export function isExportName(name) {
  const n = String(name == null ? "" : name).trim();
  const low = n.toLowerCase();
  if (!/\.txt(\.leak)?$/i.test(low)) return false;
  if (TOOL_TXT.has(low)) return false;
  if (MARKER_RE.test(n)) return false;
  return true;
}

export function isQuarantinedName(name) {
  return /\.txt\.leak$/i.test(String(name == null ? "" : name));
}

/**
 * PDF-Linker's run-status marker by name: { kind: "ETA" | "DONE", label }, or
 * null for any other file. A run drops a zero-byte `ETA <estimate>.txt` in the
 * case folder and rewrites it after each PDF ("ETA ~6.04PM (6 of 13).txt",
 * `_write_eta_marker`); a clean finish replaces it with `DONE <clock>.txt`.
 * Its clocks are written colon-free for Windows ("6.04PM"); the label puts
 * the colon back ("~6:04 PM (6 of 13)"). The SIZE is the caller's to check:
 * PDF-Linker reads only an empty file as a marker, so a real file the
 * operator happened to name "ETA notes.txt" is not one.
 */
export function runMarker(name) {
  const m = /^(ETA|DONE) (.*)\.txt$/i.exec(String(name == null ? "" : name).trim());
  if (!m) return null;
  const label = m[2].trim().replace(/\b(\d{1,2})\.(\d{2}) ?(AM|PM)\b/gi, (_, h, mm, ap) => `${h}:${mm} ${ap.toUpperCase()}`);
  return { kind: m[1].toUpperCase(), label };
}

/** The pseudonym key by name — the macro's pattern plus Windows' copies. */
/** A document's name as a reader says it: without the export's extension. */
export function docLabel(name) {
  return String(name == null ? "" : name).replace(/\.txt(\.LEAK)?$/i, "");
}

export function isKeyName(name) {
  return /^pseudonym[ _-]?key.*\.xlsx$/i.test(String(name == null ? "" : name).split(/[\\/]/).pop().trim());
}

// The one file holding every export, which PDF-Linker writes into the CASE
// folder (not Text Files) — listed as a document of its own, first.
export const COMBINED_FILE = "Combined Text.txt";
export function isCombinedName(name) {
  return String(name == null ? "" : name).split(/[\\/]/).pop().trim().toLowerCase() === COMBINED_FILE.toLowerCase();
}

// The folder PDF-Linker writes the exports to, and the one holding the
// unscrubbed copies (never listed as documents: it carries the real names).
export const TEXT_SUBFOLDER = "Text Files";
export const ORIGINAL_SUBFOLDER_RE = /^original text/i;

// ---- fixed line slots -------------------------------------------------------------
//
// On pleading paper the numbers are the paper: an edit moves TEXT between
// the numbered slots and never moves a number. Enter in a line sends the
// text after the caret down into the next slot, whose own text goes down a
// slot, and so on until an EMPTY slot takes the last of it — the first blank
// line below absorbs the shift, as it does on the typed page; with no blank
// slot left, the last line's text lands on a new UNNUMBERED line at the foot
// of the page (the file gains a line; nothing is lost). Backspace at the
// start of a line is the inverse: its text joins the line above and the run
// of non-blank lines under it moves up one slot, the slot at the run's end
// left empty — and an unnumbered line that shift emptied at the foot of the
// page is dropped again. `lines` are [{ num, text }] — whether the line
// carries a gutter number, and its text after it.

/** Enter in line `i`, `head` staying and `tail` moving down. */
export function shiftDown(lines, i, head, tail) {
  const out = lines.map((l) => ({ num: !!l.num, text: String(l.text) }));
  if (i < 0 || i >= out.length) return { lines: out, appended: false, target: i };
  out[i].text = String(head);
  let carry = String(tail);
  for (let j = i + 1; j < out.length; j++) {
    const displaced = out[j].text;
    out[j].text = carry;
    if (displaced === "") return { lines: out, appended: false, target: i + 1 };
    carry = displaced;
  }
  out.push({ num: false, text: carry });
  return { lines: out, appended: true, target: i + 1 };
}

/** Backspace at the start of line `i` (i ≥ 1): its text joins line i-1, the run below moves up. */
export function shiftUp(lines, i) {
  const out = lines.map((l) => ({ num: !!l.num, text: String(l.text) }));
  if (i < 1 || i >= out.length) return { lines: out, joinAt: -1, dropped: false };
  const joinAt = out[i - 1].text.length;
  out[i - 1].text += out[i].text;
  let j = i;
  while (j + 1 < out.length && out[j + 1].text !== "") { out[j].text = out[j + 1].text; j++; }
  out[j].text = "";
  let dropped = false;
  if (j === out.length - 1 && !out[j].num) { out.pop(); dropped = true; }
  return { lines: out, joinAt, dropped };
}

// ---- reading settings -----------------------------------------------------------------

export const FONT_PRESETS = [
  { id: "georgia", label: "Georgia", css: "Georgia, 'Times New Roman', serif" },
  { id: "times", label: "Times New Roman", css: "'Times New Roman', Times, serif" },
  { id: "charter", label: "Charter / Book serif", css: "Charter, 'Bitstream Charter', 'Iowan Old Style', Georgia, serif" },
  { id: "palatino", label: "Palatino", css: "Palatino, 'Palatino Linotype', 'Book Antiqua', serif" },
  { id: "system", label: "System sans", css: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { id: "arial", label: "Arial", css: "Arial, Helvetica, sans-serif" },
  { id: "verdana", label: "Verdana", css: "Verdana, Geneva, sans-serif" },
  { id: "courier", label: "Courier (typewriter)", css: "'Courier New', Courier, monospace" },
  { id: "mono", label: "Consolas / mono", css: "Consolas, 'Cascadia Mono', 'DejaVu Sans Mono', monospace" },
  { id: "custom", label: "Custom…", css: "" },
];

/**
 * The sheet, in CSS pixels: 8.5 inches at 96 to the inch — a page of paper.
 * It is not a setting and the type never changes it. Where the stage is
 * narrower than this the page takes what there is, since the alternative is
 * reading a page that will not fit the window.
 */
export const PAGE_WIDTH = 816;

export const DEFAULT_SETTINGS = {
  font: "georgia",
  customFont: "",
  fontSize: 15,      // px
  lineHeight: 1.5,   // ratio
  marks: true,       // highlight pseudonyms and show the fake on hover
  markColor: "#19dcfa", // the highlight's colour
  markAlpha: 0.18,   // …and how strong it is (0 = invisible, 1 = solid); subtle by default
  showFakes: false,  // display the fakes instead of the real names
  gutter: true,      // dim the pleading line numbers
  reel: true,        // read the case folder on: the next export under the last
  zoom: 1,           // the magnification: the page drawn larger, never re-laid
};

/** A settings object with every field valid, from whatever was stored. */
export function normalizeSettings(raw) {
  const s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
  if (!FONT_PRESETS.some((f) => f.id === s.font)) s.font = DEFAULT_SETTINGS.font;
  s.customFont = String(s.customFont || "").slice(0, 200);
  s.fontSize = clamp(Number(s.fontSize), 9, 40, DEFAULT_SETTINGS.fontSize);
  s.lineHeight = clamp(Number(s.lineHeight), 1, 3, DEFAULT_SETTINGS.lineHeight);
  s.marks = s.marks !== false;
  s.markColor = /^#[0-9a-fA-F]{6}$/.test(String(s.markColor || "")) ? String(s.markColor).toLowerCase() : DEFAULT_SETTINGS.markColor;
  // The old default yellow was saved with every settings write, chosen or
  // not: a stored copy of it is the old default, and reads as the new one.
  if (s.markColor === "#f5c518") s.markColor = DEFAULT_SETTINGS.markColor;
  s.markAlpha = clamp(Number(s.markAlpha), 0.04, 0.9, DEFAULT_SETTINGS.markAlpha);
  s.showFakes = s.showFakes === true;
  s.gutter = s.gutter !== false;
  // A page is a page: the width was a setting and the lock made it wider
  // still, and neither is a thing the reader has any more.
  delete s.pageWidth;
  delete s.lineLock;
  // A page beside its PDF page is laid on that page's grid, always: the two
  // were a setting each, and the pane without the grid is half of what the
  // pane is for. Stored copies of the old switch are dropped.
  delete s.matchGrid;
  // The folder read as one document: on where there is a folder to read.
  s.reel = s.reel !== false;
  s.zoom = clamp(Number(s.zoom), 0.25, 5, DEFAULT_SETTINGS.zoom);
  return s;
}

function clamp(n, lo, hi, dflt) {
  if (!isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

/** The pseudonym highlight as CSS colours: the fill, the hover fill, the ring. */
export function markCss(settings) {
  const s = settings || DEFAULT_SETTINGS;
  const hex = /^#[0-9a-fA-F]{6}$/.test(String(s.markColor || "")) ? s.markColor : DEFAULT_SETTINGS.markColor;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const a = clamp(Number(s.markAlpha), 0.04, 0.9, DEFAULT_SETTINGS.markAlpha);
  const rgba = (alpha) => `rgba(${r}, ${g}, ${b}, ${Math.min(1, alpha).toFixed(3)})`;
  return { bg: rgba(a), hover: rgba(Math.min(1, a + 0.3)), ring: rgba(Math.min(1, a * 0.6)) };
}

/** The font-family CSS for a settings object. */
export function fontCss(settings) {
  const s = settings || DEFAULT_SETTINGS;
  if (s.font === "custom" && s.customFont.trim()) return s.customFont.trim();
  const p = FONT_PRESETS.find((f) => f.id === s.font) || FONT_PRESETS[0];
  return p.css || FONT_PRESETS[0].css;
}

// ---- rule glyphs: the boxes an export draws ----------------------------------------
//
// PDF-Linker draws a page's line art into its export with the box-drawing
// glyphs — a `─` run for a horizontal rule, a `│` on every line a vertical
// rule crosses, a corner or tee where two meet. That is a picture of a box
// only in a monospace font at single spacing: in any other font the bars of
// one column land at different x on different lines, and any leading above
// the glyph's own height cuts a vertical rule into a stack of short strokes.
// The reader lets the font and the leading be anything, so it DRAWS the box
// instead of showing the glyphs (viewer/rules.js): a line carrying bars is
// laid out as a row of cells split at its bars, consecutive lines whose
// bars stand at the same character offsets share one table, and each bar is
// a cell one pixel wide that the row's full height fills. The glyphs stay in
// the DOM, so the round trip and a copy are unchanged. These two are the pure
// half — what a line's text says about its rules — and are Node-tested.

export const RULE_H = "\u2500";
export const RULE_BARS = "\u2502\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c";
const RULE_PART_RE = /([\u2502\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c])|(\u2500+)/g;
const RULE_ANY_RE = /[\u2500\u2502\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c]/;
const RULE_ONLY_RE = /^[\s\u2500\u2502\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c]*$/;
/** How much of a bar's height each glyph draws: the whole of it, its lower half (a top corner or tee), its upper half. */
const RULE_BAR_EXTENT = { "\u2502": "full", "\u251c": "full", "\u2524": "full", "\u253c": "full",
  "\u250c": "down", "\u2510": "down", "\u252c": "down", "\u2514": "up", "\u2518": "up", "\u2534": "up" };

/** A text's pieces: { t: "text" | "bar" | "h", s }, a bar glyph one piece each, a `─` run one piece. */
export function ruleParts(s) {
  const out = [];
  let last = 0, m;
  RULE_PART_RE.lastIndex = 0;
  while ((m = RULE_PART_RE.exec(s))) {
    if (m.index > last) out.push({ t: "text", s: s.slice(last, m.index) });
    out.push(m[1] ? { t: "bar", s: m[1], v: RULE_BAR_EXTENT[m[1]] } : { t: "h", s: m[2] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: "text", s: s.slice(last) });
  return out;
}

/**
 * What a whole line (its gutter included) says about its rules, or null for
 * a line with none: `bars`, the character offsets of its bar glyphs — two
 * lines whose offsets agree are rows of one box — and `rule`, true where the
 * line is nothing but rule glyphs and spaces (a box's top, a section
 * divider, an underline), which is drawn at half a line's height.
 */
export function ruleShape(line) {
  if (!RULE_ANY_RE.test(line)) return null;
  const bars = [];
  for (let i = 0; i < line.length; i++) if (RULE_BARS.includes(line[i])) bars.push(i);
  return { bars, rule: RULE_ONLY_RE.test(line) };
}

// ---- columns laid out with spaces ----------------------------------------------------
//
// The same character grid lays a page's COLUMNS out with spaces: a second
// column, a caption's right half, a centred heading, an indent stands where it
// does because of how many spaces come before it. That too is a layout only in
// a monospace font. In the reader's own a space is a quarter of an em and a
// letter about half of one, so every run of spaces drew short, and a column
// began wherever the text to its left happened to end — a different place on
// every line. These say where a line's spaces cut it into columns, and how
// wide each piece is on the grid; viewer/columns.js lays the pieces out.

/** A gap this many spaces wide is a gap between columns; a narrower one is two words' (a sentence's double space). */
export const COLUMN_GAP = 3;
// A column the lines around it begin at this often, this far in, with text
// beside it on one of them, is a second column there: a line whose left-hand
// half runs up to it is still cut there, even with only a space between (a
// justified left column fills its width).
export const COLUMN_FIRM = 3;
export const COLUMN_FIRM_AT = 12;
// A column runs down the lines that begin at it, across this many lines or
// fewer that do not, and stops. A form's columns are pieces of its page — the
// box beside the caption, the party boxes beside a signature — and the prose
// above and below them is not in them.
export const COLUMN_REACH = 3;
// A second column whose left-hand half runs up to it — a gap this narrow on
// one of its lines — is a page set in two columns, justified: its lines
// above and below the run, which reach the column with a space or two, are
// still beside it.
export const COLUMN_TIGHT = 4;
const GAP_RUN_RE = / +(?=\S)/g;

/**
 * Where a line's spaces cut it between columns: the offsets at which a column
 * begins after a gap. A gap of COLUMN_GAP spaces always cuts; a narrower one
 * only where it lands on one of the columns the line stands in (columnBands:
 * `stops`, column → how many lines of its run begin there; `second`, the
 * line's second columns) — two spaces on a column two lines begin at, one
 * space on a second column. A double space after a full stop lands nowhere
 * in particular. `start` is the column the line's text begins
 * at on the page, for a line whose margin number stands before it. The
 * line's own indent is not a cut; lineIndent says how deep it is.
 *
 * `atoms` are [from, to) stretches of the line that are one thing on screen
 * and are never cut: a pseudonym, a spot keep. A column does not begin in the
 * middle of a name, and a word of one that happens to stand on the page's
 * second column is still a word of the name.
 */
export function columnCuts(text, { stops = null, second = null, start = 0, atoms = null } = {}) {
  const s = String(text == null ? "" : text);
  const cuts = [];
  const first = s.search(/\S/);
  if (first < 0) return cuts;
  const begun = (col) => (!stops ? 0 : stops instanceof Map ? stops.get(col) || 0 : stops.has(col) ? 2 : 0);
  const within = (i) => !!atoms && atoms.some(([a, b]) => i > a && i < b);
  GAP_RUN_RE.lastIndex = first;
  let m;
  while ((m = GAP_RUN_RE.exec(s))) {
    const at = m.index + m[0].length, col = start + at, gap = m[0].length;
    if (within(m.index) || within(at)) continue;
    if (gap >= COLUMN_GAP || (gap === 2 && begun(col) >= 2) || (gap === 1 && !!second && second.has(col))) cuts.push(at);
  }
  return cuts;
}

/**
 * The columns each line of a page stands in. A column is where lines begin —
 * where a line's text starts, or after a gap of COLUMN_GAP, counted from the
 * page's left edge — and it runs down the lines that begin at it, across
 * COLUMN_REACH lines or fewer that do not, and stops: a form's box beside the
 * caption runs down the caption, not down the prose under it.
 *
 * `lines` [{ text, start }] in page order, as columnCuts takes them; a line
 * with no text begins nothing but still counts for how far apart the others
 * are. One { stops, second } per line: `stops`, column → how many lines of
 * its run begin there, for each run of two lines or more the line stands in
 * (from the run's first line to its last); `second`, those that are a second
 * column there — COLUMN_FIRM lines or more, COLUMN_FIRM_AT in or further, and
 * text on both sides of it on one of them at least. Lines that only START at
 * a column are an indent (a form's checkbox items, a quotation), not a column
 * beside another, and a line of prose that runs across an indent is not cut
 * at it.
 *
 * A JUSTIFIED page in two columns fills its left-hand column's width, so most
 * of its lines reach the second column with a space or two and begin nothing
 * there; the run is only the lines that fall short of it. The lines above its
 * first and below its last were left out of it, and drawn as one line with
 * the right-hand column straight after the left. So a second column whose
 * left-hand half comes within COLUMN_TIGHT of it on one of its lines runs on
 * past its run, line by line, for as long as each line reaches it exactly
 * with a gap of a space or two and text on both sides. A blank line, or one
 * that does not land on the column, ends it there. A form's box, whose labels
 * stand well clear of its column, is not tight, and the prose beside it is
 * not cut on a space that happens to fall there.
 */
export function columnBands(lines, { reach = COLUMN_REACH } = {}) {
  const list = lines || [];
  const texts = list.map((l) => String(l && l.text != null ? l.text : ""));
  const starts = list.map((l) => (l && l.start) || 0);
  const at = new Map(); // column → [{ i, beside, gap }], in page order
  const begins = list.map(() => []); // line → the columns it begins at
  list.forEach((l, i) => {
    const s = texts[i];
    const first = s.search(/\S/);
    if (first < 0) return;
    const start = starts[i];
    const add = (col, beside, gap) => { if (!at.has(col)) at.set(col, []); at.get(col).push({ i, beside, gap }); begins[i].push(col); };
    if (start + first > 0) add(start + first, false, Infinity);
    for (const c of columnCuts(s)) add(start + c, true, c - s.slice(0, c).trimEnd().length);
  });
  // Whether line i reaches `col` as a justified left-hand column does: text
  // there, one or two spaces before it, and text before them.
  const lands = (i, col) => {
    const s = texts[i], j = col - starts[i];
    if (j < 2 || j >= s.length || s[j] === " " || s[j - 1] !== " ") return false;
    const left = s.slice(0, j).trimEnd();
    return left.trim().length > 0 && j - left.length <= 2;
  };
  // …and whether it begins a character either side of it: the same column,
  // where an OCR'd page set it a little off on that line.
  const nearly = (i, col) => begins[i].some((c) => c !== col && Math.abs(c - col) <= 1);
  const out = list.map(() => ({ stops: new Map(), second: new Set() }));
  for (const [col, hits] of at) {
    let run = [];
    const close = () => {
      if (run.length >= 2) {
        const n = run.length;
        const second = n >= COLUMN_FIRM && col >= COLUMN_FIRM_AT && run.some((h) => h.beside);
        let from = run[0].i, to = run[run.length - 1].i;
        // Tight: a line of its run runs up to it, or a line inside the run
        // reaches it with a space or two. Lines PAST its ends say nothing of
        // the kind: prose beside a form's box puts a word on the box's column
        // by chance, and taken into the box's band it would carry the box's
        // column out past its own left-hand half.
        const tight = second && (run.some((h) => h.beside && h.gap <= COLUMN_TIGHT)
          || Array.from({ length: to - from }, (_, k) => from + k).some((i) => lands(i, col)));
        // A second column runs on past its run over the lines that still
        // stand beside it: those that reach it as its own left-hand column
        // does (a tight one), and those that begin a character off it, as
        // its own lines do, within `reach` of the last.
        for (let moved = second; moved;) {
          moved = false;
          while (tight && from > 0 && lands(from - 1, col)) { from--; moved = true; }
          while (tight && to < list.length - 1 && lands(to + 1, col)) { to++; moved = true; }
          for (let d = 1; d <= reach + 1 && from - d >= 0; d++) if (nearly(from - d, col)) { from -= d; moved = true; break; }
          for (let d = 1; d <= reach + 1 && to + d < list.length; d++) if (nearly(to + d, col)) { to += d; moved = true; break; }
        }
        for (let i = from; i <= to; i++) {
          out[i].stops.set(col, n);
          if (second) out[i].second.add(col);
        }
      }
      run = [];
    };
    for (const h of hits) {
      if (run.length && h.i - run[run.length - 1].i > reach + 1) close();
      run.push(h);
    }
    close();
  }
  return out;
}

/**
 * How deep a line is indented on the grid: { lead, the spaces its text opens
 * with; ind, the characters its text stands in from the body margin }. On
 * pleading paper the margin is `origin` characters in (the number and the two
 * spaces after it), and a numbered line's own spaces are its number's
 * (`start`, the length of the number and every space after it): its text
 * stands start − origin in, which is where a centred heading, a "Plaintiff,"
 * under the party's name, or a line of the caption's right-hand column alone
 * on its number is set.
 */
export function lineIndent(text, { start = 0, origin = 0 } = {}) {
  const first = String(text == null ? "" : text).search(/\S/);
  const lead = first > 0 ? first : 0;
  return { lead, ind: first < 0 ? 0 : Math.max(0, start + lead - origin) };
}

/**
 * Each piece's width on the grid, in characters: the piece before each cut
 * spans up to it, the first from where the line's text begins (`from`, past
 * its indent).
 */
export function columnWidths(cuts, from = 0) {
  return cuts.map((c, i) => c - (i ? cuts[i - 1] : from));
}

// Second columns this close together are ONE column: an OCR'd page sets the
// same column a character either side of where it stands on the lines around.
export const COLUMN_SNAP = 2;
// The white a second column keeps from the widest text to its left, in grid
// characters, at the least: two columns read as two, not as one line.
export const COLUMN_GUTTER = 4;
// …and how far out a second column is taken for that text: no further than
// this times its place on the grid. A line wider than that (a cut in the wrong
// place, a run of capitals past any column) pushes the rest of its own line
// on rather than take the whole column out to the edge of the paper.
export const COLUMN_STRETCH = 1.5;

/**
 * Where a page's columns stand when its text is set in the reader's own font,
 * whose letters are not the grid's: the left-hand column's lines run wider or
 * narrower than the characters the export gave them, and a justified column
 * running up to the second one, or a page in capitals, ran into it. Each
 * SECOND column (columnBands) is placed once for the lines it stands beside:
 * as far in as the grid has it, or as far as the widest text to its left on
 * any of them reaches and a gutter more (`gutter`, at most `stretch` times
 * its place on the grid). Columns within `snap` of each other are one. Every
 * other place on such a line keeps its distance on the grid from the column
 * before it, so an indent in the right-hand column, a gap inside it and the
 * next column along all move with it.
 *
 * `lines` in page order, null for a line with nothing to place:
 * { from, the page column its text begins at; cuts, the page columns where
 * each piece after a gap begins (columnCuts, plus the line's start); second,
 * its second columns; w, each piece's width before its cut, its text only;
 * origin, the body margin's column (pleading paper) }. `unit` is the grid's
 * character, and `pad` what a piece keeps after its text where it is not on a
 * second column (the cell's own margin) — all in one unit, whichever it is
 * (columns.js works in ems of the page's body type).
 *
 * One { ind, ends } per line, from the body margin in that unit — where its
 * text begins and where each piece ends — or null for a line beside no second
 * column, which keeps the plain grid.
 */
export function placeColumns(lines, { unit = 8, gutter = COLUMN_GUTTER * unit, pad = 2 * unit, snap = COLUMN_SNAP, stretch = COLUMN_STRETCH } = {}) {
  const list = lines || [];
  const all = new Set();
  for (const l of list) if (l && l.second) for (const c of l.second) all.add(c);
  const groups = [];
  for (const c of [...all].sort((a, b) => a - b)) {
    const g = groups[groups.length - 1];
    if (g && c - g.hi <= snap) g.hi = c;
    else groups.push({ lo: c, hi: c, x: null });
  }
  const mine = list.map((l) => {
    if (!l || !l.second) return [];
    const s = [...l.second];
    return groups.filter((g) => s.some((c) => c >= g.lo && c <= g.hi));
  });
  // A line's piece begins on a column a character either side of it, as an
  // OCR'd line sets it (columnBands runs the column over such lines).
  const groupAt = (gs, p) => gs.find((g) => p >= g.lo - 1 && p <= g.hi + 1) || null;
  // Where page column p stands on line i: on the nearest column placed at or
  // before it, at its distance on the grid from it — else on the grid.
  const xOf = (i, p) => {
    let g = null;
    for (const h of mine[i]) if (h.x != null && h.lo - 1 <= p) g = h;
    if (!g) return Math.max(0, p - (list[i].origin || 0)) * unit;
    return p <= g.hi + 1 ? g.x : g.x + (p - g.hi) * unit;
  };
  // Line i's pieces laid left to right, up to the one cut on `stop` (a column
  // not placed yet): where each ends, and where that one begins. The first
  // cut on a column is the column; another on it is a gap inside a piece.
  const lay = (i, stop) => {
    const l = list[i];
    const ends = [];
    const seen = new Set();
    let x = xOf(i, l.from);
    for (let k = 0; k < l.cuts.length; k++) {
      const p = l.cuts[k];
      if (stop && p > stop.hi + 1) break;
      let g = groupAt(mine[i], p);
      if (g && seen.has(g)) g = null;
      if (g) seen.add(g);
      if (g && g === stop) return { x, k, ends };
      const e = g && g.x != null ? g.x : Math.max(xOf(i, p), x + ((l.w && l.w[k]) || 0) + pad);
      ends.push(e);
      x = e;
    }
    return { x, k: -1, ends };
  };
  for (const g of groups) {
    let floor = 0, need = 0;
    list.forEach((l, i) => {
      if (!mine[i].includes(g)) return;
      floor = Math.max(floor, xOf(i, g.hi));
      const r = lay(i, g);
      if (r.k >= 0) need = Math.max(need, r.x + ((l.w && l.w[r.k]) || 0) + gutter);
    });
    g.x = Math.max(floor, Math.min(need, floor * stretch));
  }
  return list.map((l, i) => (mine[i].length ? { ind: xOf(i, l.from), ends: lay(i, null).ends } : null));
}
