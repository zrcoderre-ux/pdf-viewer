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
//       key comes back with them in it.
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
  const rec = (n, atStart) => {
    if (n.nodeType === TEXT_NODE) {
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
 * { text, held: [[start, end), …] } — the ranges a save must leave as they
 * read rather than write back to their pseudonyms.
 */
export function serializeHeld(root) {
  let out = "";
  const held = [];
  let open = -1;
  walk(root, (s) => { out += s; }, {
    fakes: true,
    mark: (phase) => {
      if (phase === "in") open = out.length;
      else if (open >= 0) { if (out.length > open) held.push([open, out.length]); open = -1; }
    },
  });
  return { text: out, held };
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
 * `mask` the case-wide keeps (the same length out as in). Each page is read on
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
      const cited = citedNameSpans(flat);
      for (const h of findRealSpans(reals, mask ? mask(flat) : flat)) {
        if (!insideSpans(cited, h.start, h.end)) values.push(h.real);
      }
    }
    if (flagRx) {
      flagRx.lastIndex = 0;
      let m;
      while ((m = flagRx.exec(flat))) {
        flags++;
        if (m.index === flagRx.lastIndex) flagRx.lastIndex++;
      }
    }
  }
  return { values, flags };
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
  "# fakes or keeps on its own notwithstanding. Lines beginning with # are",
  "# ignored. Delete a line to withdraw it.",
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

export function formatValuesFile(values, keeps, phrases) {
  const body = (values || []).map(normalizeValue).filter(Boolean)
    .map((v) => (isPhrase(phrases, v) ? `phrase: ${v}` : v));
  // A local keep is left out on purpose: the file it would go into is a list of
  // work for the next run, and that keep is work the run has already done
  // (keepNeedsRun). Writing it would hand PDF-Linker a value to leave exactly
  // as it already is.
  const kept = owedKeeps(keeps).map((k) => makeKeep(k.control, k.value)).filter((k) => k.value).map((k) => `${k.control}: ${k.value}`);
  return VALUES_HEAD.concat(body, kept).join("\n") + "\n";
}

/** The file's values to fake, in order (the keeps are parseReaderFile's). */
export function parseValuesFile(text) {
  return parseReaderFile(text).values;
}

/**
 * The file's lines: { values, keeps, phrases }. A phrase line is a value to
 * fake, so it is in `values` too; `phrases` says which of them go whole.
 */
export function parseReaderFile(text) {
  const values = [];
  const keeps = [];
  const phrases = [];
  const seen = new Set();
  for (const raw of String(text == null ? "" : text).split(/\r?\n/)) {
    const line = raw.replace(/^\ufeff/, "").trim();
    if (!line || line[0] === "#") continue;
    const m = line.match(KEEP_RE);
    const p = m ? null : line.match(PHRASE_RE);
    const v = normalizeValue(m ? m[2] : p ? p[1] : line);
    if (!v || seen.has(foldKey(v))) continue;
    seen.add(foldKey(v));
    if (m) keeps.push(makeKeep(m[1], v));
    else values.push(v);
    if (p) phrases.push(v);
  }
  return { values, keeps, phrases };
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
export function flagProblem(selectionText, touchesPseudonym) {
  const v = normalizeValue(selectionText);
  if (!v) return "Select the unfaked name first.";
  if (touchesPseudonym) return "That is already a pseudonym — its real name is shown over the fake.";
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
// authorities list and this tool's values file).
const TOOL_TXT = new Set(["leaks.txt", "pdf_linker_leaks.txt", "combined text.txt", "authorities cited.txt", VALUES_FILE.toLowerCase()]);
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
  markColor: "#f5c518", // the highlight's colour
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
