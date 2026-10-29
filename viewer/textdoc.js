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
//   readExport / shownPages / pageScan / spotsAfterSwaps / realsLeftInExport
//       a document of the folder read, counted and saved WITHOUT being on
//       screen, the way the screen would: what the folder-wide Replace all and
//       Save rest on (pageListsAfter and fixedSumsFor keep the page lists
//       right for what they write).
//   FONT_PRESETS / DEFAULT_SETTINGS   the reading settings.

import { caseShape, mirrorCase, fold as pkFold, translateRuns, findReals, findRealSpans, compile, ownFakesOf, capOnlyMiss, keySpelled } from "./pseudo-key.js";
import { REPORTERS_SORTED, REPORTERS_ALL_SORTED } from "./reporters.js";

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
  // Once a page's comments block has begun, every line up to the next header
  // or banner is the block's (see "comments on the document", below).
  let block = null;
  const open = (banner, header) => {
    block = null;
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
    if (!block && COMMENTS_RE.test(line)) block = page.comments = [];
    (block || page.lines).push(line);
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
    for (const l of p.comments || []) out.push(l);
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

/**
 * Whether a page's margin numbers RUN COMPLETE: numbered (pageIsNumbered),
 * and the numbers climbing down it (numberChain) at least `share` of the
 * numbers from 1 to its highest. A page an OCR caught a few numbers of is
 * numbered by pageIsNumbered's count and still lacks most of them: # Number
 * lines is offered there (the owner: "I have a page where Number Lines is not
 * available").
 */
export function pageNumbersComplete(lines, { share = 0.8 } = {}) {
  if (!pageIsNumbered(lines)) return false;
  const nums = (lines || []).map((l) => { const g = gutterPrefix(l); const n = g ? parseInt(g.gutter, 10) : NaN; return n > 0 ? n : null; });
  const chain = numberChain(nums);
  let count = 0, top = 0;
  nums.forEach((n, k) => { if (chain[k]) { count++; top = Math.max(top, n); } });
  // …and most of its lines of text on a number (a line between two numbers,
  // or past the last, is the paper's too, but not most of them).
  const filled = (lines || []).filter((l, k) => String(l).trim() && !(nums[k] != null && !gutterPrefix(l).rest.trim())).length;
  return count >= Math.max(3, share * top) && count >= 0.6 * filled;
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

// ---- comments on the document ---------------------------------------------------
//
// A comment made on an export is kept as a comment on its PDF: PDF-Linker writes
// it into the PDF as an annotation (a highlight over the passage, with the
// comment's text), and every run writes the PDF's comments back into the export
// it rebuilds, so a comment outlives the run the way the PDF's own words do. In
// the export they are a block after the document's last page, under a head of
// their own, one line a comment, as the My-Macros Markdown export writes Word's:
//
//   ====== Comments (not part of the document) ======
//   [c1] Page 3, on "the passage commented on": what the comment says [id rdc-qkzmwtra]
//
// numbered in order, each with the PDF page it is on, the passage it marks (a
// `"` or `\` in it written `\"`, `\\`) and its id, which is how a run tells which
// PDF comment an edit in the reader is to. The block is the document's, not its
// last page's: parseExport keeps it off the page's lines (`page.comments`, the
// raw lines from the head on), so the page's text, its sum, Find and every pass
// over the pages never see it, and serializeExport writes it back where it was.
// Its text is disk text like the page's: a real name in a comment is written
// as its pseudonym, and the reader shows it through the key.
export const COMMENTS_HEAD = "====== Comments (not part of the document) ======";
export const COMMENTS_RE = /^\s*={6} Comments \(not part of the document\) ={6}\s*$/;
const COMMENT_LINE_RE = /^\[c(\d+)\] Page (\d+)(?:, on "((?:[^"\\]|\\.)*)")?: (.*?)(?: \[by ([^[\]]{1,80})\])?(?: \[id ([A-Za-z0-9._-]{1,80})\])?$/;

/** A passage or a comment as one line of the block: its whitespace folded. */
export function commentFlat(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
}

/**
 * The comments a block carries (its raw lines, head first): [{ page, on, text,
 * author, id }] in order, `on` "" for a comment on no passage, `author` "" and
 * `id` null where the line has none. A line that does not read as a comment (a blank, a line typed
 * into the block by hand) is kept as `{ raw }`, so a block written again keeps it.
 */
export function parseComments(lines) {
  const out = [];
  for (const l of lines || []) {
    const s = String(l == null ? "" : l);
    if (COMMENTS_RE.test(s)) continue;
    const m = s.match(COMMENT_LINE_RE);
    if (!m) { if (s.trim()) out.push({ raw: s }); continue; }
    out.push({ page: parseInt(m[2], 10), on: (m[3] || "").replace(/\\(.)/g, "$1"), text: m[4], author: m[5] || "", id: m[6] || null });
  }
  return out;
}

/** A comment's author as its line carries it ("Your name on comments"): one line, no brackets, at most 80 characters; "" for none. */
export function commentAuthor(s) {
  return commentFlat(String(s == null ? "" : s).replace(/[[\]]/g, "")).slice(0, 80).trim();
}

/**
 * One comment as its line of the block, numbered `n`. Its author, where it has
 * one, is written `[by Name]` before the id; the reader writes only the
 * operator's own name there, and PDF-Linker keeps that name as it stands where
 * its `comment_author` setting names it, and leaves out any other.
 */
export function commentLine(c, n) {
  const on = commentFlat(c.on);
  const by = commentAuthor(c.author);
  return `[c${n}] Page ${c.page}` + (on ? `, on "${on.replace(/[\\"]/g, "\\$&")}"` : "") + `: ${commentFlat(c.text)}` + (by ? ` [by ${by}]` : "") + (c.id ? ` [id ${c.id}]` : "");
}

/**
 * The block for `comments` (parseComments' shape), head first and numbered in
 * order, or null for none. `lines` are the page lines it follows: a page whose
 * last line has text gets a blank line before the head, as PDF-Linker writes
 * the block (a page's text, a blank line, the block).
 */
export function commentsBlock(comments, lines) {
  const list = (comments || []).filter((c) => c && (c.raw != null || c.page));
  if (!list.length) return null;
  const last = lines && lines.length ? String(lines[lines.length - 1]) : "";
  const out = last.trim() ? ["", COMMENTS_HEAD] : [COMMENTS_HEAD];
  let n = 0;
  for (const c of list) out.push(c.raw != null ? c.raw : commentLine(c, ++n));
  return out;
}

/**
 * Where `on` (a comment's passage, as the block carries it) stands in a page's
 * disk text: [start, end) or null. Read as a passage is selected — the margin
 * numbers left out and every run of whitespace, a line break included, one
 * space — so a passage that wraps at the margin is still found. The first
 * place it reads as written, else the first ignoring case.
 */
export function findPassage(text, on) {
  const want = commentFlat(on);
  if (!want) return null;
  const src = String(text == null ? "" : text);
  let flat = "";
  const at = [];
  let space = false;
  let lineStart = 0;
  for (const line of src.split("\n")) {
    const g = gutterPrefix(line);
    for (let k = g ? g.gutter.length : 0; k < line.length; k++) {
      const ch = line[k];
      if (/\s/.test(ch)) { space = flat.length > 0; continue; }
      if (space) { flat += " "; at.push(lineStart + k); space = false; }
      flat += ch;
      at.push(lineStart + k);
    }
    space = flat.length > 0;
    lineStart += line.length + 1;
  }
  let i = flat.indexOf(want);
  if (i < 0) i = flat.toLowerCase().indexOf(want.toLowerCase());
  if (i < 0) return null;
  return [at[i], at[i + want.length - 1] + 1];
}

// ---- words struck through ---------------------------------------------------------
//
// A passage the PDF shows STRUCK THROUGH is written ~~like this~~ in the export,
// Markdown's strikethrough (owner, 2026-10-23): a strike drawn through printed
// words is lost to every reading of the page, an OCR's above all, and the words
// then read as live text. The reader marks it by hand (select, S̶ Strike or K)
// and shows it struck with the tildes hidden; PDF-Linker's next run puts a
// StrikeOut annotation on the passage in the PDF, so it outlives the run that
// rebuilds the export, and every run writes the text under one back as struck.
//
// A run is on ONE line and never crosses a column gap (two spaces or more, a
// tab) or a box-drawing rule, so a selection across a caption's two columns
// strikes each column's piece, and no cell the columns are cut into
// (columns.js) holds half a pair. A ~~ opens a run where a character other than
// a space or a ~ follows it, and closes it where one precedes it; a ~~ that
// pairs with nothing on its line is text.
export const STRIKE_MARK = "~~";
const STRIKE_GAP_RE = /[\t─-╿]/;

/** The struck runs of one line, in order: [{ open, close }], where its opening ~~ and its closing ~~ stand (each two characters). */
export function strikeRuns(line) {
  const s = String(line == null ? "" : line);
  const out = [];
  let open = -1;
  for (let i = s.indexOf(STRIKE_MARK); i >= 0; i = s.indexOf(STRIKE_MARK, i)) {
    if (open < 0) {
      const next = s[i + 2];
      if (next != null && next !== " " && next !== "~" && !STRIKE_GAP_RE.test(next)) { open = i; i += 2; continue; }
      i += 1;
      continue;
    }
    const prev = s[i - 1];
    if (i > open + 2 && prev !== " " && prev !== "~" && !STRIKE_GAP_RE.test(prev)) { out.push({ open, close: i }); open = -1; i += 2; continue; }
    // A gap inside a run that has not closed: no run crosses one.
    i += 1;
  }
  // …and a run is cut where a gap stands inside it: such a pair is text.
  return out.filter((r) => { const inner = s.slice(r.open + 2, r.close); return !inner.includes("  ") && !STRIKE_GAP_RE.test(inner); });
}

/**
 * A MARKDOWN DOCUMENT READ AS A WORD DOCUMENT (text-reader.js, dressMarkdown).
 * The owner: "It should present the markdown like it was a word document in
 * times new roman." My-Macros' `.md` is a Word draft written as Markdown, and
 * the reader showed its marks as written: `#` before a heading, `**` round the
 * bold, a `-` before each item. The page is still the file's text (a save
 * writes it back byte for byte, and names are matched through the marks), so
 * nothing is rendered away: per line, this says what the line IS — a heading,
 * an item of a list, a quotation, a rule — which of its characters are marks
 * the page hides (`hide`, [from, to) in the line's shown text), and which
 * stretches are drawn bold, in italics, as code, as a link, or as a tracked
 * change (`runs`, { from, to, cls }), the marks of each outside its stretch.
 *
 * `lines` are the lines' shown texts; `atoms`, per line, the [from, to)
 * stretches nothing may part (a pseudonym, a spot keep): no mark is read
 * inside one. Read top to bottom, since a fenced code block runs over lines.
 * `~~struck~~` is dressStrikes', and is passed over here.
 *
 * Returns, per line: { block, depth, hide, runs }. `block` is "p", "blank",
 * "h1"…"h6", "ul", "ol", "quote", "hr", "fence" (a ``` line), "code" (a line
 * inside one) or "table"; `depth` an item's level, 0 for the outermost.
 */
export function markdownLines(lines, { atoms = null } = {}) {
  let fence = null;
  return (lines || []).map((raw, k) => {
    const s = String(raw == null ? "" : raw);
    const out = { block: "p", depth: 0, hide: [], runs: [] };
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(s);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !s.slice(f[0].length).trim()) { fence = null; out.block = "fence"; out.hide.push([0, s.length]); }
      else out.block = "code";
      return out;
    }
    if (f) { fence = f[1]; out.block = "fence"; out.hide.push([0, s.length]); return out; }
    if (!s.trim()) { out.block = "blank"; return out; }
    if (/^\s{0,3}([-*])(?:\s*\1){2,}\s*$/.test(s)) { out.block = "hr"; out.hide.push([0, s.length]); return out; }
    let from = 0;
    let m;
    if ((m = /^\s{0,3}(#{1,6})(?:\s+|$)/.exec(s))) {
      out.block = "h" + m[1].length;
      out.hide.push([0, m[0].length]);
      from = m[0].length;
      const tail = /\s+#+\s*$/.exec(s.slice(from));
      if (tail) out.hide.push([from + tail.index, s.length]);
      inlineMarks(s, from, tail ? from + tail.index : s.length, atoms && atoms[k], out);
      return out;
    }
    if ((m = /^(\s{0,3}>\s?)+/.exec(s))) {
      out.block = "quote";
      out.hide.push([0, m[0].length]);
      from = m[0].length;
    } else if ((m = /^(\s*)([-*+])(\s+)(?=\S)/.exec(s))) {
      out.block = "ul";
      out.depth = Math.min(6, Math.floor(m[1].replace(/\t/g, "    ").length / 2));
      out.hide.push([0, m[0].length]);
      from = m[0].length;
    } else if ((m = /^(\s*)(\d{1,9}[.)])(\s+)(?=\S)/.exec(s))) {
      out.block = "ol";
      out.depth = Math.min(6, Math.floor(m[1].replace(/\t/g, "    ").length / 3));
      // The number stays, as Word shows it; the spaces round it are the indent's.
      if (m[1].length) out.hide.push([0, m[1].length]);
      if (m[3].length > 1) out.hide.push([m[1].length + m[2].length + 1, m[0].length]);
      from = m[0].length;
    } else if (/^\s*\|.*\|\s*$/.test(s)) {
      out.block = "table";
    }
    inlineMarks(s, from, s.length, atoms && atoms[k], out);
    return out;
  });
}
const MD_ESCAPABLE = "\\`*_{}[]()#+-.!~|<>";
const MD_PUNCT_RE = /[\p{P}\p{S}]/u;
/** A line's inline marks from `from` to `to`, written into `out` (markdownLines). */
function inlineMarks(s, from, to, atoms, out) {
  const literal = new Uint8Array(s.length + 1);
  for (const [a, b] of atoms || []) for (let i = Math.max(0, a); i < Math.min(b, s.length); i++) literal[i] = 1;
  const free = (i, n = 1) => { for (let j = i; j < i + n; j++) if (j >= to || literal[j]) return false; return true; };
  const take = (a, b) => { for (let i = a; i < b; i++) literal[i] = 1; };
  // A backslash before a mark of punctuation: hidden, and its character is text.
  for (let i = from; i < to - 1; i++) {
    if (s[i] === "\\" && free(i, 2) && MD_ESCAPABLE.includes(s[i + 1])) { out.hide.push([i, i + 1]); take(i, i + 2); i++; }
  }
  // Code: a run of backticks to the next run as long; nothing inside it is a mark.
  for (let i = from; i < to; i++) {
    if (s[i] !== "`" || !free(i)) continue;
    let n = 1;
    while (s[i + n] === "`") n++;
    const close = s.indexOf("`".repeat(n), i + n);
    if (close < 0 || close + n > to || s[close + n] === "`") { i += n - 1; continue; }
    out.hide.push([i, i + n], [close, close + n]);
    out.runs.push({ from: i + n, to: close, cls: "md-code" });
    take(i, close + n);
    i = close + n - 1;
  }
  // A tracked change or a comment, as My-Macros writes a Word draft's: {++…++},
  // {--…--}, {==…==}, {>>…<<}.
  const critic = [["{++", "++}", "md-ins"], ["{--", "--}", "md-del"], ["{==", "==}", "md-hl"], ["{>>", "<<}", "md-cmt"]];
  for (const [open, close, cls] of critic) {
    for (let i = s.indexOf(open, from); i >= 0 && i < to; i = s.indexOf(open, i + 1)) {
      if (!free(i, 3)) continue;
      const j = s.indexOf(close, i + 3);
      if (j < 0 || j + 3 > to || !free(j, 3)) continue;
      out.hide.push([i, i + 3], [j, j + 3]);
      out.runs.push({ from: i + 3, to: j, cls });
      take(i, i + 3);
      take(j, j + 3);
    }
  }
  // A link: its text shown as a link, its brackets and address hidden.
  const link = /\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  link.lastIndex = from;
  for (let m = link.exec(s); m && m.index < to; m = link.exec(s)) {
    const a = m.index, mid = a + 1 + m[1].length, end = a + m[0].length;
    if (end > to || !free(a) || !free(mid, 2) || !free(end - 1)) continue;
    out.hide.push([a, a + 1], [mid, end]);
    out.runs.push({ from: a + 1, to: mid, cls: "md-link" });
    take(a, a + 1);
    take(mid, end);
  }
  // Emphasis: `*` and `_` runs, opened and closed as CommonMark does (a run
  // that opens before a word, closes after one; an `_` inside a word is text,
  // so "Rasho_Helen_Decl" is one word), the nearest opener first.
  const runs = [];
  for (let i = from; i < to; i++) {
    const c = s[i];
    if ((c !== "*" && c !== "_") || !free(i)) continue;
    let n = 1;
    while (i + n < to && s[i + n] === c && free(i + n)) n++;
    const before = i > 0 ? s[i - 1] : " ", after = i + n < s.length ? s[i + n] : " ";
    const ws = (ch) => /\s/.test(ch), pu = (ch) => MD_PUNCT_RE.test(ch);
    const left = !ws(after) && (!pu(after) || ws(before) || pu(before));
    const right = !ws(before) && (!pu(before) || ws(after) || pu(after));
    const canOpen = c === "*" ? left : left && (!right || pu(before));
    const canClose = c === "*" ? right : right && (!left || pu(after));
    runs.push({ c, at: i, n, left: n, canOpen, canClose, used: [] });
    i += n - 1;
  }
  const pairs = [];
  for (let k = 0; k < runs.length; k++) {
    const close = runs[k];
    if (!close.canClose) continue;
    for (let j = k - 1; j >= 0 && close.left > 0; j--) {
      const open = runs[j];
      if (open.c !== close.c || !open.canOpen || open.left <= 0) continue;
      // (The rule of three: a run both ways matches only where the lengths allow.)
      if ((open.canClose || close.canOpen) && (open.n + close.n) % 3 === 0 && (open.n % 3 || close.n % 3)) continue;
      const use = open.left >= 2 && close.left >= 2 ? 2 : 1;
      const oa = open.at + open.left - use, cb = close.at + (close.n - close.left);
      pairs.push({ oa, ob: oa + use, ca: cb, cb2: cb + use, strong: use === 2 });
      open.left -= use;
      close.left -= use;
      // Runs between them that are left open are text now.
      for (let q = j + 1; q < k; q++) runs[q].left = 0;
      if (open.left > 0) j++; // the same opener again, for what is left of the closer
    }
  }
  for (const p of pairs) {
    out.hide.push([p.oa, p.ob], [p.ca, p.cb2]);
    out.runs.push({ from: p.ob, to: p.ca, cls: p.strong ? "md-b" : "md-i" });
  }
  out.hide.sort((a, b) => a[0] - b[0]);
  // Outer stretches first, so an inner one is wrapped inside it.
  out.runs.sort((a, b) => a.from - b.from || b.to - a.to);
}

/**
 * A line as the page LAYS IT OUT: a strike's ~~ marks are hidden on the page
 * and take no room there, so every column, indent and bar of the line is
 * counted in its text with the marks taken out — counted with them, a column
 * the line sets after a struck word stood four places further on, and moved
 * when the words were struck (the owner: "Strike through should not change
 * the spacing"). { text, toFile(v, opening), toVis(f) }: `text` the line
 * unstruck; toFile carries a place in `text` back to the line — the place of
 * the character standing there, or, with `opening`, of the marks standing
 * just before it, so a column that opens with a struck word begins at its
 * opening mark — and toVis a place in the line to `text`. The file keeps its
 * marks; only the layout reads past them.
 */
export function strikeLayout(line) {
  const s = String(line == null ? "" : line);
  const runs = s.includes(STRIKE_MARK) ? strikeRuns(s) : [];
  if (!runs.length) return { text: s, toFile: (v) => v, toVis: (f) => f };
  const marks = []; // where each mark begins in the line, in order
  for (const r of runs) marks.push(r.open, r.close);
  const opens = new Set(runs.map((r) => r.open));
  let text = "", at = 0;
  for (const m of marks) { text += s.slice(at, m); at = m + 2; }
  text += s.slice(at);
  const toFile = (v, opening = false) => {
    let f = v;
    for (const m of marks) { if (m <= f) f += 2; else break; }
    if (opening && opens.has(f - 2)) f -= 2;
    return f;
  };
  const toVis = (f) => {
    let v = f;
    for (const m of marks) { if (m >= f) break; v -= Math.min(2, f - m); }
    return v;
  };
  return { text, toFile, toVis };
}

/** `text` with every struck run's ~~ marks taken out: the words as the page prints them. */
export function unstruck(text) {
  return String(text == null ? "" : text).split("\n").map((line) => {
    let out = "", at = 0;
    for (const r of strikeRuns(line)) { out += line.slice(at, r.open) + line.slice(r.open + 2, r.close); at = r.close + 2; }
    return out + line.slice(at);
  }).join("\n");
}

/**
 * The edit that strikes through the stretch [a, b) of `text` — a page's text,
 * its lines split on "\n" — or takes the strike off it where every word of it
 * is struck already: { strike, ops, text } — `strike` which of the two, `ops`
 * the ~~ marks to put in ({ at, ins, open }: `open` a mark before the first
 * character of its run, else one after the last) and take out ({ at, del }),
 * offsets in `text`, LAST FIRST (an insertion and a deletion at one place, the
 * deletion first) so each holds while those after it are made, and `text` the
 * result.
 * Null where the stretch holds nothing to strike: spaces, a rule, a gap.
 *
 * Per line, each character is struck or not; the stretch's are set, and the
 * marks are written again round each run of struck characters, a run carried
 * over one space between two struck words and stopped by anything else — so
 * a run struck beside another joins it, and one taken off in its middle
 * leaves two. `atoms` ([start, end) stretches of `text`: a pseudonym, a spot
 * keep) are taken whole where the stretch reaches into one, as a selection
 * does: a mark inside a name would part it from its fake.
 */
export function strikeEdit(text, a, b, { atoms = [] } = {}) {
  const src = String(text == null ? "" : text);
  let lo = Math.max(0, Math.min(a, b)), hi = Math.min(src.length, Math.max(a, b));
  for (const [s, e] of atoms) {
    if (lo > s && lo < e) lo = s;
    if (hi > s && hi < e) hi = e;
  }
  if (hi <= lo) return null;
  const lines = [];
  for (let at = 0; at <= src.length;) {
    const nl = src.indexOf("\n", at);
    const end = nl < 0 ? src.length : nl;
    if (end > lo && at < hi) lines.push({ at, s: src.slice(at, end) });
    if (nl < 0 || at >= hi) break;
    at = nl + 1;
  }
  // Every line the stretch reaches, read into its characters.
  const read = lines.map(({ at, s }) => {
    const runs = strikeRuns(s);
    const marks = new Set();
    for (const r of runs) for (const p of [r.open, r.open + 1, r.close, r.close + 1]) marks.add(p);
    const chars = []; // { p (offset in the line), c, struck }
    let k = 0;
    for (let p = 0; p < s.length; p++) {
      if (marks.has(p)) continue;
      while (k < runs.length && runs[k].close + 2 <= p) k++;
      const struck = k < runs.length && p >= runs[k].open + 2 && p < runs[k].close;
      chars.push({ p, c: s[p], struck });
    }
    return { at, s, runs, chars };
  });
  const word = (c) => c !== " " && !STRIKE_GAP_RE.test(c);
  const chosen = [];
  for (const l of read) for (const ch of l.chars) if (word(ch.c) && l.at + ch.p >= lo && l.at + ch.p < hi) chosen.push(ch);
  if (!chosen.length) return null;
  const strike = !chosen.every((ch) => ch.struck);
  for (const ch of chosen) ch.struck = strike;
  const ops = [];
  for (const l of read) {
    // The marks as they stand: an open before its run's first character, a
    // close after its last — named by the character they stand beside.
    const before = new Map(), after = new Map(); // character index → line offset of the mark
    for (const r of l.runs) {
      const first = l.chars.findIndex((ch) => ch.p === r.open + 2);
      const last = l.chars.findIndex((ch) => ch.p === r.close - 1);
      if (first >= 0) before.set(first, r.open);
      if (last >= 0) after.set(last, r.close);
    }
    // …and as they should: round each run of struck words, over single spaces.
    const want = [];
    for (let i = 0; i < l.chars.length;) {
      if (!l.chars[i].struck || !word(l.chars[i].c)) { i++; continue; }
      let j = i;
      for (;;) {
        if (j + 1 < l.chars.length && l.chars[j + 1].struck && word(l.chars[j + 1].c)) { j++; continue; }
        if (j + 2 < l.chars.length && l.chars[j + 1].c === " " && l.chars[j + 2].struck && word(l.chars[j + 2].c)) { j += 2; continue; }
        break;
      }
      want.push([i, j]);
      i = j + 1;
    }
    const wantBefore = new Set(want.map((w) => w[0])), wantAfter = new Set(want.map((w) => w[1]));
    for (const [i, off] of before) if (!wantBefore.has(i)) ops.push({ at: l.at + off, del: 2 });
    for (const [i, off] of after) if (!wantAfter.has(i)) ops.push({ at: l.at + off, del: 2 });
    for (const i of wantBefore) if (!before.has(i)) ops.push({ at: l.at + l.chars[i].p, ins: STRIKE_MARK, open: true });
    for (const i of wantAfter) if (!after.has(i)) ops.push({ at: l.at + l.chars[i].p + 1, ins: STRIKE_MARK, open: false });
  }
  if (!ops.length) return null;
  ops.sort((x, y) => y.at - x.at || (x.del ? -1 : 1) - (y.del ? -1 : 1));
  let out = src;
  for (const op of ops) out = op.del ? out.slice(0, op.at) + out.slice(op.at + op.del) : out.slice(0, op.at) + op.ins + out.slice(op.at);
  return { strike, ops, text: out };
}

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

/**
 * A numbered page's margin numbers set back in their column, as the export
 * writes them: the number right-aligned in two characters and two spaces
 * after it (GUTTER_RE). A line typed into the ⇄ Raw sheet as "9 37. The
 * defendant…" — one space after its margin number — reads as an unnumbered
 * line with a 9 at its head, and the page drawn from it crowds it in under the
 * line above. The owner, in chat: "Margin lines only go up to 28". So only a
 * number from 1 to `last` with ONE space after it, and only where it takes its
 * place in the numbers climbing down the page (numberChain), is taken for the
 * margin's; a line whose text opens with a paragraph number ("37. …") is the
 * text's. Returns the lines, changed only where a number was set back.
 */
export const MARGIN_LAST = 28;
const ONE_SPACE_GUTTER_RE = /^( ?)(\d{1,2}) (?=\S)/;
export function tidyGutters(lines, { last = MARGIN_LAST } = {}) {
  const src = (lines || []).map((l) => String(l == null ? "" : l));
  const loose = src.map((l) => {
    if (gutterPrefix(l)) return null;
    const m = l.match(ONE_SPACE_GUTTER_RE);
    const n = m ? parseInt(m[2], 10) : NaN;
    return n >= 1 && n <= last ? { n, rest: l.slice(m[0].length) } : null;
  });
  if (!loose.some(Boolean)) return src;
  const nums = src.map((l, k) => (loose[k] ? loose[k].n : marginNumber(l)));
  const chain = numberChain(nums);
  return src.map((l, k) => (loose[k] && chain[k] ? String(loose[k].n).padStart(2) + "  " + loose[k].rest : l));
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
  // The number itself, written with one space after it (tidyGutters): it is
  // this one, not text the number goes in front of.
  const one = line.match(ONE_SPACE_GUTTER_RE);
  if (one && parseInt(one[2], 10) === n) return num + "  " + line.slice(one[0].length);
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
    if (!p || p.header == null || headerSaysCondensed(p)) continue;
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

/**
 * The export as the reader opens it: its pages, with the margin numbers the
 * OCR missed put back on every page that carries enough of its numbers to be
 * pleading paper (restoreMarginNumbers, to the number the document's pages run
 * to). Each page keeps the numbers put back on it (`restored`), which the
 * margin marks, and the document how many there were, for the toast. The file
 * is not touched: the pages are what the reader shows, lays beside the PDF and
 * saves, so a save writes the numbers and closing without one loses nothing
 * that the next open does not put back. Every document the reader works on is
 * read through here — the one opened, the ones the reel hangs, and the ones a
 * folder-wide Replace all or Save works on off the screen — so all of them
 * read, and are written, alike.
 */
export function readExport(text) {
  const parsed = parseExport(text);
  const last = pleadingLast(parsed.pages);
  let pages = 0, numbers = 0;
  for (const p of parsed.pages) {
    if (p.header == null || headerSaysCondensed(p)) continue;
    const r = restoreMarginNumbers(p.lines, { last });
    if (!r) continue;
    p.lines = r.lines;
    p.restored = r.added;
    pages++;
    numbers += r.added.length;
  }
  parsed.restored = { pages, numbers };
  return parsed;
}

/**
 * A document as a copy of its own: its pages and their lines, the numbers put
 * back on each, never shared with the original — so a document set aside with
 * its edits (the reader's store of unsaved documents) is not changed by
 * whatever is done to the one it was copied from, or the other way round.
 */
export function cloneDoc(doc) {
  if (!doc) return doc;
  return {
    newline: doc.newline,
    trailingNewline: doc.trailingNewline,
    pages: (doc.pages || []).map((p) => ({ ...p, lines: (p.lines || []).slice(), restored: p.restored ? p.restored.slice() : p.restored, comments: p.comments ? p.comments.slice() : p.comments })),
  };
}

// ---- a page as the screen shows it -----------------------------------------------
//
// The reader builds a page (buildBody) from its disk text: the key's fakes laid
// out as pseudonym spans showing the real name (or the fake, with Show fakes
// on), a line's margin number in a gutter span of its own. Find and Replace
// read the built page back with its gutters blanked (the reader's flatten), so
// a phrase wrapped at the margin is one phrase and a margin number is never a
// hit. The same reading, made from the text alone, is how a document that is
// NOT on screen is counted: page by page, never across a page break, and never
// the page headers or a combined file's banners, which are not in a page body.
// It walks the runs exactly as buildBody lays them out — a margin number opens
// a line only at its start, and a number followed straight by a pseudonym is
// still one (the U+0001 stand-in for the span the next run supplies) — so the
// count of a document off the screen is the count it would have on it.

/** The page's runs as buildBody lays them out: { runs, gutters: [[start, end)], pns: [[start, end)] } in the disk text. `next`: the page after's opening. */
function laidOut(text, rev, next = "") {
  const runs = rev ? translateRuns(rev, text, { next }) : [{ t: "text", s: text }];
  const gutters = [], pns = [];
  let at = 0, lineStart = true;
  runs.forEach((r, ri) => {
    if (r.t === "swap") {
      if (r.from) pns.push([at, at + r.from.length]);
      at += r.from.length;
      lineStart = false;
      return;
    }
    const pieces = r.s.split("\n");
    pieces.forEach((piece, i) => {
      if (i > 0) { at += 1; lineStart = true; }
      if (!piece) return;
      const last = i === pieces.length - 1 && ri + 1 < runs.length;
      const g = lineStart ? gutterPrefix(last ? piece + "\u0001" : piece) : null;
      if (g && g.gutter.length <= piece.length) gutters.push([at, at + g.gutter.length]);
      at += piece.length;
      lineStart = false;
    });
    lineStart = r.s.endsWith("\n") || (lineStart && r.s === "");
  });
  return { runs, gutters, pns };
}

/**
 * Each page of `doc` as the screen shows it, as Find and Replace read it off the
 * page: the fakes as the real names (`rev`, the key's fake → real side), or as
 * they are with `showFakes`, and every margin number blanked to spaces. →
 * [string per page].
 */
export function shownPages(doc, { rev = null, showFakes = false } = {}) {
  const pages = (doc && doc.pages) || [];
  return pages.map((p, i) => {
    const text = (p.lines || []).join("\n");
    const { runs, gutters } = laidOut(text, rev, pages[i + 1] ? (pages[i + 1].lines || []).slice(0, 12).join("\n") : "");
    let out = "";
    for (const r of runs) out += r.t === "swap" ? (showFakes ? r.from : r.to) : r.s;
    if (!gutters.length) return out;
    // The gutters stand in the file's own text, and only text runs carry one,
    // so their places in the shown text are the file's, moved by the swaps
    // before them.
    const moved = [];
    let at = 0, shift = 0, g = 0;
    for (const r of runs) {
      const len = r.t === "swap" ? r.from.length : r.s.length;
      if (r.t === "swap") shift += (showFakes ? r.from : r.to).length - len;
      else while (g < gutters.length && gutters[g][0] < at + len) { moved.push([gutters[g][0] + shift, gutters[g][1] + shift]); g++; }
      at += len;
    }
    return blankRanges(out, moved, " ");
  });
}

/**
 * The folder's find counts split three ways: the documents on screen are left
 * out (their hits are counted on the page, and a row for them too counted them
 * twice), the combined file is apart (it holds every export over again, and
 * PDF-Linker writes it from them), and the rest. `onReel(doc)` says which are
 * on screen. → { rest, combined }, each the rows as they came.
 */
export function splitFolderRows(rows, onReel) {
  const rest = [], combined = [];
  for (const r of rows || []) {
    if (!r || !r.doc) continue;
    if (onReel && onReel(r.doc)) continue;
    (r.doc.combined ? combined : rest).push(r);
  }
  return { rest, combined };
}

/**
 * A page of a document that is not on screen, as a save would read it, from
 * its disk text alone: { needs, scan }.
 *
 * A save reads each page it writes as the page reads (the reader's
 * serializeHeld and standingSpans): the run's fakes and the spot keeps
 * blanked, the case-wide keeps masked, the names of cited decisions spared —
 * and where a real the key binds stands there, the page goes through the
 * reader's own save on a page built for it, which is what decides whether it
 * is written as its fake. A page where none stands is written as it is, and
 * building it would change nothing; `scan` is then what the standing assertion
 * reads of it (the spots, the fakes and the cited names blanked to NULs).
 * `needs` says the page must be built after all: any real standing in it,
 * cited or not, and — as a safety valve — a spot keep the page would not lay
 * out whole (one running into a fake, a margin number or another spot), since
 * then the held place the page reads is not the place the text says.
 * `spots` are this page's own spot keeps; `mask(flat, raw)` the case-wide keeps.
 */
export function pageScan(raw, { rev = null, reals = null, spots = null, mask = null, next = "" } = {}) {
  const text = String(raw == null ? "" : raw);
  const { pns, gutters } = laidOut(text, rev, next);
  const held = spotRanges(text, spots);
  const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1];
  let needs = held.some((h, k) => pns.some((p) => overlaps(h, p)) || gutters.some((g) => overlaps(h, g)) || held.some((o, j) => j !== k && overlaps(h, o)));
  const blank = held.concat(pns);
  const flat = blank.length ? blankRanges(text, blank, " ") : text;
  if (!needs && reals) needs = findRealSpans(reals, mask ? mask(flat, text) : flat, { layout: text }).length > 0;
  return { needs, scan: blankRanges(text, blank.concat(citedNameSpans(flat, { next }))) };
}

/**
 * The spot keeps of a page once a save's forward pass has rewritten it. A spot
 * is its value and its ordinal among that value's occurrences in the page's
 * disk text, and the pass writes the decided occurrences around it as their
 * fakes: an occurrence before the kept one is no longer the value, so the
 * ordinal counted before the pass points past the end after it, and the kept
 * name would stand as a decided one. Each kept range (`held`, in `oldText`) is
 * moved by the swaps before it (`places`: [{ start, end, to }] in `oldText`) and
 * its ordinal counted again in `newText`. → [{ page, value, nth }].
 */
export function spotsAfterSwaps(page, oldText, held, places, newText) {
  const swaps = (places || []).slice().sort((a, b) => a.start - b.start);
  const out = [];
  for (const [a, b] of held || []) {
    const value = String(oldText).slice(a, b);
    let shift = 0;
    for (const s of swaps) {
      if (s.end > a) break;
      shift += String(s.to).length - (s.end - s.start);
    }
    const at = occurrencesOf(newText, value).findIndex(([s]) => s === a + shift);
    out.push(makeSpot(page, value, at < 0 ? 0 : at));
  }
  return out;
}

/**
 * The standing assertion over one export about to be written: the real values
 * the key binds still standing in it. `plain` is the export as it will be
 * written; `held` the same text with what may stand in it blanked (the spot
 * keeps, the run's fakes, the cited names, the names nobody has decided on) —
 * the two the same length. The case-wide keeps are masked (`mask(text,
 * layout)`), and a name wrapped down a column is read off `plain`. A save
 * writes nothing at all while any export it would write answers with one.
 *
 * THE PAGES, NOT THE HEADERS. A page header and a combined file's banner are
 * PDF-Linker's lines, copied through byte for byte (serializeExport): no page
 * shows them, the marks and Find never read them, the save never fakes in
 * them and nobody can retype them. The assertion read them all the same, so a
 * page transcribed by hand, whose header PDF-Linker writes as "…this page's
 * text layer is the operator's transcription", refused every save of its
 * document under a key that binds "Operator" — naming a value that stood
 * nowhere a reader could find it. They are blanked with NUL, which is no gap,
 * so a name is not read across a page break either.
 */
export function realsLeftInExport(plain, held, { reals = null, mask = null } = {}) {
  if (!reals) return [];
  const masked = mask ? mask(held, plain) : held;
  return findReals(reals, blankRanges(masked, citedNameSpans(held).concat(headLineRanges(held), commentAuthorRanges(held))), { layout: plain });
}
/**
 * Where a comment's author stands in an export's comments block, the name in
 * its line's `[by Name]`: [[start, end), …]. It is the operator's own name
 * (the reader writes "Your name on comments" there, and PDF-Linker writes only
 * the name its `comment_author` setting gives and keeps it as it stands), so
 * it is never a real name left to fake, even where a party shares a word of it.
 */
export function commentAuthorRanges(text) {
  const out = [];
  let at = 0, inside = false;
  for (const line of String(text == null ? "" : text).split("\n")) {
    const bare = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (COMMENTS_RE.test(bare)) inside = true;
    else if (PAGE_HEADER_RE.test(bare) || DOC_BANNER_RE.test(bare)) inside = false;
    else if (inside) {
      const m = bare.match(COMMENT_LINE_RE);
      if (m && m[5]) {
        const end = bare.length - (m[6] ? ` [id ${m[6]}]`.length : 0) - 1;
        out.push([at + end - m[5].length, at + end]);
      }
    }
    at += line.length + 1;
  }
  return out;
}
/** Where an export's page headers and banners stand: [[start, end), …], each line without its break. */
function headLineRanges(text) {
  const out = [];
  let at = 0;
  for (const line of String(text == null ? "" : text).split("\n")) {
    const bare = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (PAGE_HEADER_RE.test(bare) || DOC_BANNER_RE.test(bare)) out.push([at, at + bare.length]);
    at += line.length + 1;
  }
  return out;
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
  // `child` is told of each place BETWEEN an element's children as the walk
  // reaches it — (element, i) before its i-th child, and (element, count)
  // after the last — which is how a DOM boundary point that sits on an
  // element rather than in a text node (a selection's end, see serializeHeld)
  // finds where it stands in what is emitted. A pseudonym span's inside is
  // not walked, so it is never told of one.
  const onChild = opts && opts.child;
  const kids = (n, atStart) => {
    const list = n.childNodes || [];
    for (let i = 0; i < list.length; i++) {
      if (onChild) onChild(n, i);
      rec(list[i], i === 0 && atStart);
    }
    if (onChild) onChild(n, list.length);
  };
  const rec = (n, atStart) => {
    if (n.nodeType === TEXT_NODE) {
      if (onText) onText(n);
      emit(n.data != null ? n.data : n.nodeValue || "");
      return;
    }
    if (n.nodeType !== ELEMENT_NODE) return;
    const name = String(n.nodeName || "").toUpperCase();
    if (name === "BR") {
      if (onChild) onChild(n, 0);
      if (n.nextSibling) emit("\n");
      return;
    }
    if (mark && n.getAttribute && n.getAttribute(HERE_ATTR) != null) {
      mark("in");
      kids(n, false);
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
    kids(n, atStart);
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
 * of the disk text needs to put its marks back on the page, and `pnNodes`,
 * the pseudonym spans themselves in the order of `pns`.
 *
 * With `points` ([{ node, offset, end }], DOM boundary points: a text node and
 * an offset into it, or an element and a child index), `at` as well: where
 * each stands in `text`, or -1 for one that is not inside `root`. A point
 * INSIDE a pseudonym span takes the span whole — the span's start for a
 * start point, its end for one marked `end` — since the file carries the
 * fake and a piece of the real name lines up with no piece of it; a point at
 * the span's very start or end is that place either way. This is how a
 * selection on the page is cut out of the text the file carries (the reader's
 * copy, cut and drag).
 */
export function serializeHeld(root, { mapped = false, points = null } = {}) {
  let out = "";
  const held = [];
  const segs = mapped ? [] : null;
  const pnNodes = mapped ? [] : null;
  const pts = points || [];
  const at = pts.map(() => -1);
  const place = (k, pos) => { if (at[k] < 0) at[k] = pos; };
  const len = (n) => (n.data != null ? n.data : n.nodeValue || "").length;
  // Where a point stands in a pseudonym span's own text: "start", "end", "mid",
  // or null where it is not in the span at all.
  const inSpan = (span, p) => {
    let before = 0, hit = -1;
    const visit = (n) => {
      if (n.nodeType === TEXT_NODE) {
        if (n === p.node) hit = before + Math.min(Math.max(0, p.offset), len(n));
        before += len(n);
        return;
      }
      const list = n.childNodes || [];
      for (let i = 0; i < list.length; i++) {
        if (n === p.node && p.offset === i) hit = before;
        visit(list[i]);
      }
      if (n === p.node && p.offset >= list.length) hit = before;
    };
    visit(span);
    if (hit < 0) return null;
    return before > 0 && hit === 0 ? "start" : before > 0 && hit === before ? "end" : "mid";
  };
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
    text: mapped || pts.length ? (n) => {
      const d = n.data != null ? n.data : n.nodeValue || "";
      if (mapped) segs.push({ node: n, start: out.length, end: out.length + d.length });
      pts.forEach((p, k) => { if (p.node === n) place(k, out.length + Math.min(Math.max(0, p.offset), d.length)); });
    } : null,
    child: pts.length ? (n, i) => { pts.forEach((p, k) => { if (p.node === n && p.offset === i) place(k, out.length); }); } : null,
    mark: (phase) => {
      if (phase === "in") open = out.length;
      else if (open >= 0) { if (out.length > open) held.push([open, out.length]); open = -1; }
    },
    fake: (n) => {
      const f = n.getAttribute("data-fake") || "";
      if (f) {
        pns.push([out.length, out.length + f.length]);
        if (mapped) pnNodes.push(n);
      }
      pts.forEach((p, k) => {
        if (at[k] >= 0) return;
        const where = inSpan(n, p);
        if (where) place(k, where === "start" || (where === "mid" && !p.end) ? out.length : out.length + f.length);
      });
    },
  });
  const res = mapped ? { text: out, held, pns, segs, pnNodes } : { text: out, held, pns };
  if (points) res.at = at;
  return res;
}

/**
 * `text` from `a` to `b` as a copy of it carries it: each of `swaps` ({ start,
 * end, to }, places in `text`) that the stretch reaches written WHOLE as its
 * `to`, and the `skip` ranges ([start, end)) left out.
 *
 * Whole, because a selection that ends half way through a name is still a
 * selection of the name: "Helen Ra" is two thirds of a real name, and there is
 * no two thirds of its pseudonym that says less. A swap the stretch only
 * touches at an end (one ending where it begins) is not reached. The skipped
 * ranges are what the page shows but a selection never takes — the pleading
 * margin's numbers — and they are cut from the text around the swaps, never
 * out of a `to`.
 */
export function clipText(text, swaps, a, b, skip) {
  const src = String(text == null ? "" : text);
  const lo = Math.max(0, Math.min(src.length, a | 0)), hi = Math.max(0, Math.min(src.length, b | 0));
  if (hi <= lo) return "";
  const gaps = (skip || []).filter((r) => r && r[1] > r[0]).sort((x, y) => x[0] - y[0]);
  // Asked with `from` only ever moving on, so the ranges already passed are
  // passed for good: one walk over them for the whole stretch, not one per
  // swap (a Word export is one page, its every name a swap).
  let gi = 0;
  const plain = (from, to) => {
    while (gi < gaps.length && gaps[gi][1] <= from) gi++;
    let out = "", at = from;
    for (let j = gi; j < gaps.length && gaps[j][0] < to; j++) {
      const [x, y] = gaps[j];
      if (y <= at) continue;
      if (x > at) out += src.slice(at, x);
      at = Math.max(at, y);
    }
    return at < to ? out + src.slice(at, to) : out;
  };
  const ws = (swaps || []).filter((w) => w && w.end > w.start).sort((x, y) => x.start - y.start);
  let out = "", at = lo;
  for (const w of ws) {
    if (w.end <= lo || w.end <= at) continue;
    if (w.start >= hi) break;
    out += plain(at, Math.max(at, w.start)) + String(w.to == null ? "" : w.to);
    at = w.end;
  }
  return out + plain(at, Math.max(at, hi));
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
// The whitespace INSIDE a cite as the export prints it (PDF-Linker's
// `_PN_CITE_WS`): a space, or a line break — blank lines, a page's
// "====== Page N ======" header — and the gutter number the next line opens
// on. A cite on pleading paper wraps wherever the margin falls, and a name
// read on spaces alone lost the half past the wrap: "Rasho v.\n12  Quillmark
// (2019) …" was no cite at all, and both parties were marked as this case's.
const CITE_GAP = "(?:[ \\t]+|[ \\t]*\\n\\s*(?:={6}[ \\t]+Page[^\\n]*\\n\\s*)?(?:\\d{1,3}[ \\t]+)?)";
// …and before the TAIL alone, the next page's furniture too — a letterhead, an
// e-filing stamp, printed as short unnumbered lines after the page header
// (`_PN_CITE_PAGE_FURNITURE`): a case name does not resume after a page's
// letterhead, but its year does.
const CITE_TAIL_GAP = "(?:[ \\t]+|[ \\t]*\\n\\s*(?:={6}[ \\t]+Page[^\\n]*\\n\\s*(?:(?![ \\t]*(?:\\d{1,3}[ \\t]{2,}|={6}))[^\\n]{1,90}\\n\\s*){0,4})?(?:\\d{1,3}[ \\t]+)?)";
const PARTY = "[A-Z][\\w.'\u2019-]*(?:(?:" + CITE_GAP + "(?:of|the|and|&|de|la|le|van|von|del|da|dos|ex|rel\\.)" + CITE_GAP + "|" + CITE_GAP + ")[A-Z\\d][\\w.'\u2019-]*|,\\s+(?:Inc|LLC|L\\.L\\.C|Corp|Co|Ltd|N\\.A|LP|L\\.P)\\.?){0," + PARTY_WORDS + "}";
const CASE_NAME_RE = new RegExp(PARTY + CITE_GAP + "v(?:s?\\.|s\\b|\\.|\\b)" + CITE_GAP + PARTY, "g");
// A matter named WITHOUT a " v. " — "In re Marriage of Hartwell", "Estate of
// Bowles", "In the Matter of the Estate of Bowen", "Conservatorship of
// Wendland" — read with the same citation after it. These are PDF-Linker's
// leads: the parser's `_NONV_PREFIX` and the shape guard's "In re" / "In the
// Matter of" (`_PN_CITE_SHAPE_RE`'s `inre`). Read on " v. " alone, every one
// was a name the key bound standing in the clear: marked, and written as its
// pseudonym at the save — a published authority renamed. "Matter of" and
// "Ex parte" alone are left out, as PDF-Linker leaves them out.
const NONV_LEAD = "(?:In" + CITE_GAP + "(?:re|Re|RE)|IN" + CITE_GAP + "RE|In" + CITE_GAP + "the" + CITE_GAP + "Matter" + CITE_GAP + "of|(?:Estate|Guardianship|Conservatorship|Adoption|Marriage)" + CITE_GAP + "of)";
const NONV_RE = new RegExp("(?<![\\w'\u2019])" + NONV_LEAD + CITE_GAP + PARTY, "g");
// What must follow the name for it to be a citation and not a caption: a year
// in parentheses — the court before it where a federal or out-of-state cite
// puts one, "(9th Cir. 2009)" (`_PN_CITE_YEAR`) — a volume and reporter, or
// supra. A page or pin may come first ("at p. 220"), and a comma or an opening
// bracket may sit between. The reporter is read from PDF-Linker's list with
// its spaces flexed (`_flex_ws_reporter`): "30 Cal. App. 5th 1", "500 F. Supp.
// 2d 100" and "123 S. Ct. 456" were no reporter to the old shape, which read
// one capitalised word before the page.
const CITE_REPORTER = REPORTERS_ALL_SORTED.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ +/g, "\\s+")).join("|");
const CITE_YEAR = "\\((?:(?:\\d{1,2}(?:st|nd|rd|th)|[A-Z][\\w.]*)[ \\t]+){0,4}(?:1[7-9]|20)\\d\\d\\)";
// A WRIT names its real party in interest in parentheses between the case
// name and the year: "Rasho v. Superior Court (Quillmark) (2019) 30 Cal.App.5th
// 1". The parenthesis is part of the name, and the year after it the citation.
const CITE_RPI = "[ \\t]*\\([A-Z][\\w.'\u2019&-]*(?:(?:,?[ \\t]+|[ \\t]+(?:of|the|and|&)[ \\t]+)[A-Z\\d][\\w.'\u2019&-]*){0,7}\\)";
const CITE_AFTER_RE = new RegExp("^(" + CITE_RPI + ")?(?:,?" + CITE_TAIL_GAP + "|,?[ \\t]*|[\\s,;]*)(?:" + CITE_YEAR + "|\\((?:[^)]{0,40}\\b\\d{4})\\)|\\d{1,4}" + CITE_GAP + "(?:" + CITE_REPORTER + ")|\\d{1,4}\\s+[A-Z][\\w.]*\\s*\\d|[Ss]upra\\b|\\[\\d)");
// How far past a name its citation may start: the real party, a page break
// and the next page's furniture.
const CITE_AFTER_REACH = 480;
// A short form: the party alone, with supra after it.
const SUPRA_RE = new RegExp("[A-Z][\\w.'\u2019-]*(?:\\s+[A-Z][\\w.'\u2019-]*){0," + PARTY_WORDS + "}(?=,?\\s+supra\\b)", "g");
// What stands before a STRUNG cite with no tail in reach — "…71 Cal.App.5th
// 358, 373-374; Krongos v. Pacific Gas & Electric Co." closing a page whose
// next page carries its year: the cite before it, a pin, then ";"
// (`_PN_STRING_CITE_SEAM_RE`). The name runs and the " v. " are held to the
// line they stand on, since nothing but the word count says where they end.
const STRUNG_SEAM_RE = new RegExp("(?:" + CITE_YEAR + "|(?<!\\w)\\d{1,4}\\s+(?:" + CITE_REPORTER + ")|(?<![A-Za-z])supra\\b)(?:[^;\\n]|\\n[ \\t]*(?:\\d{1,3}[ \\t]+)?){0,40};[ \\t]*\\n?[ \\t]*(?:\\d{1,3}[ \\t]+)?[ \\t]*$");
const STRUNG_PARTY = "[A-Z][\\w.'\u2019-]*(?:(?:[ \\t]+(?:of|the|and|&|de|la|le|van|von|del|da|dos|ex|rel\\.)[ \\t]+|[ \\t]+)[A-Z\\d][\\w.'\u2019-]*|,[ \\t]+(?:Inc|LLC|L\\.L\\.C|Corp|Co|Ltd|N\\.A|LP|L\\.P)\\.?){0," + PARTY_WORDS + "}";
const STRUNG_RE = new RegExp("(?<![\\w'\u2019])" + STRUNG_PARTY + "[ \\t]+vs?\\.?[ \\t]+" + STRUNG_PARTY, "g");
// The " v. " inside a matched name, where the plaintiff's half ends.
const NAME_V_RE = new RegExp(CITE_GAP + "v(?:s?\\.|s\\b|\\.|\\b)" + CITE_GAP);

// …and the SHORT CITE WITH NO "supra", which PDF-Linker protects and this did
// not read: "(Jones, 30 Cal.App.5th at p. 5.)" — the party's name, a comma,
// then the volume and reporter of the decision's own cite and the pin
// (PDF-Linker's `_pn_short_cite_follows` and `_PN_SHORT_CITE_TAIL`). It carries
// neither a " v. " nor a "supra", so a name typed into one was marked as this
// case's party and saved as its pseudonym — "(Pratt, 30 Cal.App.5th at p.
// 5.)", a published authority renamed — unless Esc was pressed on it, and an
// Esc is a thing the reader then has to follow through every edit that moves
// the text (escapesIn), which is where each of the last rounds' failures was.
// Read as a citation, the name is spared wherever it is and however it got
// there: typed, pasted, carried over a line the browser merged, or a cite the
// file already held.
//
// What is read, the name and then, after ", ":
// - a VOLUME and a REPORTER from reporters.js (the citation linker's list,
//   ported from PDF-Linker's), then a pin — "at p. 5", "at pp. 5-6", "at 5"
//   (PDF-Linker's own shape) — or a page — "30 Cal.App.5th 1", "30
//   Cal.App.5th, 5". The reporter is what makes it a cite: a bare number after
//   a name ("Jones, 2019", "DOES 1", a docket, "Jones, 12 March 2020", "Jones,
//   30 Main Street") is not one, and a name before it is not spared;
// - or the pin alone, "(Jones, at p. 5)", the California Style Manual's short
//   form for a decision cited just before. PDF-Linker does not read this one
//   (its pin needs the reporter before it), so a name the run left there is
//   its review's, as before; the reader spares it because faking it renames
//   the authority, which the project ranks above a visible leak. With no
//   reporter to say "citation", it is read only where a citation stands —
//   behind "(", ";" or a signal ("See Jones, at p. 5") — and with "p." or
//   "pp.", never a bare "at 5"; and never after a record word ("Jones Decl.,
//   at p. 3", "Smith Depo., at p. 12"), which cites this case's own papers by
//   its own people.
//
// FOUND FROM THE TAIL, NOT FROM THE NAME. A scan that tried a name at every
// capital and then asked for the tail after it is the shape the hang notes
// forbid ("Text reader hangs and freezes.md": a jurat's capitals). This scans
// for the tail — a comma, then a volume and reporter, or "at p." — which
// ordinary prose almost never writes, and the reporter alternation is tried
// only where ", <digits> " has already been read. From each tail found the
// name is read BACKWARDS over a fixed window (SHORT_NAME_WINDOW characters)
// with a counted word pattern, so the work per tail is a constant and the
// whole is linear in the text.
//
// The span is the NAME only, and only the name's own words: PDF-Linker's
// `_pn_cite_run_start` walks a run read from the left past the words up to the
// last citation signal ("See", "Cf.", "Accord", "Id.", …) and the last full
// stop that closes an ordinary word ("…served on Helen Rasho. Jones, 30 …" is
// "Jones", not "Rasho. Jones"), and so does this — a span too wide would spare
// a name of THIS case standing before the cite, unmarked and unwarned, which
// is the one thing a span must never do.
const SHORT_NAME_WINDOW = 160;
const SHORT_WS = "(?:[ \\t]*\\n[ \\t]*(?:\\d{1,3}[ \\t]+)?|[ \\t]+)"; // a space, or a line break and the next line's gutter number
const SHORT_REPORTER = REPORTERS_SORTED.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const SHORT_TAIL_RE = new RegExp(
  "(?<=[\\p{L}\\p{N}.'’)]),(?:" + SHORT_WS + ")"
  + "(?:\\d{1,4}" + SHORT_WS + "(?:" + SHORT_REPORTER + ")(?:[ \\t]*,)?" + SHORT_WS + "?(?:at" + SHORT_WS + "(?:pp?\\.[ \\t]*)?)?\\d"
  + "|(at" + SHORT_WS + "pp?\\.[ \\t]*\\d))", "gu");
const SHORT_WORD = "\\p{Lu}[\\p{L}\\p{N}.'’&-]*";
const SHORT_NAME_RE = new RegExp(
  "(?<![\\p{L}\\p{N}.'’&-])" + SHORT_WORD
  + "(?:" + SHORT_WS + "(?:(?:of|the|and|&|de|la|le|van|von|del|da|dos|ex|rel\\.)" + SHORT_WS + ")?" + SHORT_WORD + "){0,4}$", "u");
// A citation signal (PDF-Linker's _PN_CITE_SIGNAL_WORDS, the capitalised ones a name run can open with).
const SHORT_SIGNALS = new Set(["see", "cf", "accord", "but", "compare", "citing", "contra", "also", "generally", "in", "quoting", "e.g", "id", "ibid", "and", "or", "the"]);
// A full stop that is part of a name, not the end of a sentence before it.
const SHORT_ABBREVS = new Set(["inc", "co", "corp", "ltd", "llc", "llp", "lp", "l.p", "n.a", "bros", "assn", "dept", "servs", "mfg", "natl", "intl", "univ", "cnty", "mr", "mrs", "ms", "dr", "st", "mt", "ft", "jr", "sr", "u.s", "u.s.a"]);
// What cites this case's own record, not a decision: never spared behind a bare "at p.".
const SHORT_RECORD = new Set(["decl", "declaration", "depo", "dep", "deposition", "tr", "trans", "transcript", "ex", "exh", "exhibit", "rt", "ct", "aa", "ra", "opp", "reply", "mot", "motion", "compl", "complaint", "brief", "pet", "petition", "answer", "aff", "affidavit"]);

/** The short cites with no supra in `src`: [start, end] of each one's name (see SHORT_TAIL_RE). */
function shortCiteNames(src, out) {
  SHORT_TAIL_RE.lastIndex = 0;
  let m;
  while ((m = SHORT_TAIL_RE.exec(src))) {
    const c = m.index; // the comma
    const from = Math.max(0, c - SHORT_NAME_WINDOW);
    const nm = SHORT_NAME_RE.exec(src.slice(from, c));
    if (!nm) continue;
    const runAt = from + nm.index;
    // Its words, and where the name really begins: after the last signal, and
    // after the last full stop that closes an ordinary word.
    const words = [];
    for (const w of nm[0].matchAll(/\S+/g)) words.push([w[0], runAt + w.index]);
    let cut = 0;
    for (let i = 0; i < words.length - 1; i++) {
      const w = words[i][0];
      const base = w.replace(/[.,]+$/, "").toLowerCase();
      if (SHORT_SIGNALS.has(base)) cut = i + 1;
      else if (w.endsWith(".") && base.length > 1 && !SHORT_ABBREVS.has(base) && /\p{Ll}/u.test(base)) cut = i + 1;
    }
    // A gutter number the run read across a line break is no word of the name.
    while (cut < words.length && /^\d+$/.test(words[cut][0])) cut++;
    if (cut >= words.length) continue;
    const start = words[cut][1];
    if (m[1]) {
      // The bare pin: only where a citation stands, and not this case's record.
      const lastBase = words[words.length - 1][0].replace(/[.,]+$/, "").toLowerCase();
      if (SHORT_RECORD.has(lastBase)) continue;
      const before = src.slice(Math.max(0, start - 4), start).replace(/\s+$/, "");
      if (!(cut > 0 && SHORT_SIGNALS.has(words[cut - 1][0].replace(/[.,]+$/, "").toLowerCase())) && !/[(;]$/.test(before)) continue;
    }
    out.push([start, c]);
  }
}

// THIS CASE'S OWN CAPTION, recited with a year — "this action, Wrenfield v.
// Quarrow Motors (2025)" — is no authority, and PDF-Linker fakes it: a "X v. Y"
// whose two sides are each MOSTLY words of the parties the case's own key
// was built from (the E-Court template, `--term`: `_side_is_trusted` over
// `_trusted_party_tokens`) is the document's caption, not a decision. The
// reader spared it as a cited decision, so the caption's names stood unmarked
// and a typed one was saved real. The words come from the key
// (setOwnPartyWords, pseudo-key's ownPartyWords); with none, nothing is
// exempted.
let OWN_PARTY_WORDS = null;
/** The words of this case's own parties (a Set of word bases, wordBase's), or null: citedNameSpans' caption exemption. */
export function setOwnPartyWords(words) { OWN_PARTY_WORDS = words && words.size ? words : null; }
// The words that identify nobody: a firm's furniture, the small words, a role.
const CAPTION_FILLER = new Set(["inc", "llc", "llp", "lp", "corp", "corporation", "co", "company", "ltd", "na", "pc", "plc", "the", "and", "of", "for",
  "plaintiff", "plaintiffs", "defendant", "defendants", "petitioner", "petitioners", "respondent", "respondents", "appellant", "appellants",
  "appellee", "appellees", "cross-complainant", "cross-defendant", "real", "party", "interest"]);
/** The word bases setOwnPartyWords takes, from the case's own parties' values (pseudo-key's parseKey `own`). */
export function ownPartyWordsOf(values) {
  const out = new Set();
  for (const v of values || []) for (const w of String(v).split(/\s+/)) { const b = wordBase(w); if (b.length >= 3 && !CAPTION_FILLER.has(b)) out.add(b); }
  return out;
}
/** A word's base, as PDF-Linker's `_pn_word_base` reads it: no edge punctuation, no possessive, lower case. */
export function wordBase(w) {
  return String(w == null ? "" : w).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/['’]s$/i, "").toLowerCase();
}
/** Whether a side of a "X v. Y" is MOSTLY words of this case's own parties (`own`). */
function sideIsOwn(side, own) {
  const words = String(side).split(/[\s,]+/).map(wordBase).filter((b) => b.length >= 3 && !CAPTION_FILLER.has(b) && !/^\d+$/.test(b));
  const hits = words.filter((b) => own.has(b)).length;
  return hits > 0 && hits * 2 >= words.length;
}
/**
 * Where its name really begins inside a run read from the left (PDF-Linker's
 * `_pn_cite_run_start`): after the last citation signal ("See", "Cf.") and the
 * last full stop that closes an ordinary word — "…served on Helen Rasho. See
 * Jones v. Smith (2019) …" names "Jones v. Smith", and a span from "Helen"
 * spared this case's own party, unmarked and unwarned. A gutter number the
 * run read across a line break is no word either. → an offset into `run`, or
 * -1 where nothing is left.
 */
function nameRunStart(run) {
  const words = [];
  for (const w of run.matchAll(/\S+/g)) words.push([w[0], w.index]);
  let cut = 0;
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i][0];
    const base = w.replace(/[.,]+$/, "").toLowerCase();
    if (SHORT_SIGNALS.has(base)) cut = i + 1;
    else if (w.endsWith(".") && base.length > 1 && !SHORT_ABBREVS.has(base) && /\p{Ll}/u.test(base)) cut = i + 1;
  }
  while (cut < words.length && /^\d+$/.test(words[cut][0])) cut++;
  return cut < words.length ? words[cut][1] : -1;
}

/**
 * Where `text` names a decided case: `[start, end]` per span, in order. A span
 * covers the case NAME alone — the citation after it is what proves the name
 * is one, and is not part of what the name protects (a writ's real party in
 * interest, in its parentheses, is part of the name).
 *
 * `next`: the opening of the page after, where `text` is one page — a cite
 * whose name closes this page has its year at the head of the next
 * (PDF-Linker reads 240 characters across the seam, `_PAGE_CTX`). `own`: the
 * words of this case's own parties (setOwnPartyWords by default), whose
 * caption recited with a year is no decision.
 */
export function citedNameSpans(text, { next = "", own = OWN_PARTY_WORDS } = {}) {
  const page = String(text == null ? "" : text);
  const src = next ? page + "\n====== Page ======\n" + String(next).slice(0, 240) : page;
  const out = [];
  for (const re of [CASE_NAME_RE, NONV_RE, SUPRA_RE, STRUNG_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      if (!m[0]) { re.lastIndex++; continue; }
      if (m.index >= page.length) break;
      let start = m.index, end = m.index + m[0].length;
      if (re === SUPRA_RE) {
        const at = nameRunStart(m[0]);
        if (at < 0) continue;
        out.push([start + at, end]);
        continue;
      }
      if (re === STRUNG_RE) {
        // No tail in reach: only behind the cite it is strung after.
        if (!STRUNG_SEAM_RE.test(src.slice(Math.max(0, start - 160), start))) continue;
      } else {
        const t = CITE_AFTER_RE.exec(src.slice(end, end + CITE_AFTER_REACH));
        if (!t) continue;
        if (t[1]) end += t[1].length; // a writ's real party in interest
      }
      if (re !== NONV_RE) {
        // The plaintiff's own words: not the sentence or the signal before it…
        const v = NAME_V_RE.exec(m[0]);
        const at = nameRunStart(v ? m[0].slice(0, v.index) : m[0]);
        if (at < 0) continue;
        // …and not this case's own caption recited with a year.
        if (own && v && sideIsOwn(m[0].slice(at, v.index), own) && sideIsOwn(m[0].slice(v.index + v[0].length), own)) continue;
        start += at;
      }
      out.push([start, end]);
    }
  }
  shortCiteNames(src, out);
  const mine = [];
  for (const [a, b] of out) if (a < page.length) mine.push([a, Math.min(b, page.length)]);
  mine.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  // The overlapping ones merged, so a caller has one span to test against.
  const merged = [];
  for (const [a, b] of mine) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}
/**
 * The key's fake → real matcher as the reader shows a page with it: every
 * fake reversed except one standing in a cited decision's name. The run
 * spared those names (citedNameSpans), so a fake there is a published party
 * that shares a word with one of this case's fakes — "Smith v. Jones (2010)
 * 50 Cal.4th 100", Smith a fake here — and the real name over it is a wrong
 * citation, copied out in the real names where no check for a fake left in
 * the text can find it. This case's own caption, cited, is the exception the
 * run makes too: it was faked, and it reads back. `own` is asked of the FAKES
 * the case's parties went out under, since that is what the page holds.
 */
export function compileDisplay(key) {
  const own = ownPartyWordsOf(ownFakesOf(key));
  return compile(key, { spare: (t, next) => citedNameSpans(t, { next, own }) });
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
    const next = pages[i + 1] ? pages[i + 1].lines.slice(0, 12).join("\n") : "";
    const blank = spotRanges(raw, spotsOnPage(spots, i));
    if (rev) {
      let at = 0;
      for (const r of translateRuns(rev, raw, { next })) {
        const len = r.t === "swap" ? r.from.length : r.s.length;
        if (r.t === "swap") blank.push([at, at + len]);
        at += len;
      }
    }
    const flat = blankRanges(raw, blank, " ");
    if (reals) {
      // A name wrapped down a column is read too, its cells off the page as
      // it stands (`layout`), not off the reading with its fakes blanked out.
      const cited = citedNameSpans(flat, { next });
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
      for (const r of rev ? translateRuns(rev, raw, { next }) : [{ t: "text", s: raw }]) {
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
  if (!b.length) { const x = slidPoint(a0, p, a0.length - s, b0, p); out.push([x, x]); return out; }
  if (!a.length) { put(0, b.length); return out; }
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
    const aText = al.slice(h.a0, h.a1).join("\n");
    for (const c of chars) {
      if (c.b1 > c.b0) put(from + c.b0, from + c.b1);
      else { const x = slidPoint(aText, c.a0, c.a1, b, from + c.b0); put(x, x); }
    }
  }
  return out;
}

// WHERE A DELETION WAS, when the text it took repeats what stands beside it.
// Deleting "(Judge Whitaker erred).\n" from before "(Jones, 30 …)" leaves the
// same text as deleting "Judge Whitaker erred).\n(" from after the "(", or
// "udge Whitaker erred).\n(J" from after "(J": the deletion SLIDES, and each
// of those is as true an account of the edit as the others. Taken head first
// (the shared head extended as far as it goes) the point it took text out at
// fell inside "Jones" — "took text out of its middle" — and a name the FILE
// already carried counted as typed: the save wrote a short cite PDF-Linker had
// shipped with its real name as "(Pratt, 30 Cal.App.5th at p. 5.)", under a
// plain "Saved" (the final review's item 3, on b6d82a6 and 0b35064 alike). So
// a deletion's point is slid, within the places that tell the same story, to
// the first that splits no word of what is left; where every one splits one,
// it stays where it was found. A name is then typed only where some of the
// edit is in it whichever way the edit is told — failing toward a name left as
// the file had it, which the save names in red, never toward a pseudonym
// written over a name nobody typed. (Text PUT IN that repeats what is beside
// it slides the same way; which copy is "the typed one" is then truly
// undecidable, and the insertion is left where it was found.)
const SLIDE_MAX = 400;
const WORDCH = /[\p{L}\p{N}]/u;
/**
 * The point in `after` a deletion of `before`'s [d0, d1) is best told at:
 * `x` is where it was found (the point in `after` that d0 maps to); the
 * deletion slides left while the character before it equals the last one it
 * took, right while the first it took equals the one after it, and the first
 * place, leftmost first, that splits no word in `after` is the answer.
 */
function slidPoint(before, d0, d1, after, x) {
  if (!(d1 > d0)) return x;
  const splits = (y) => y > 0 && y < after.length && WORDCH.test(after[y - 1]) && WORDCH.test(after[y]);
  if (!splits(x)) return x;
  let l = 0;
  while (l < SLIDE_MAX && d0 - l > 0 && before[d0 - l - 1] === before[d1 - l - 1]) l++;
  let r = 0;
  while (r < SLIDE_MAX && d1 + r < before.length && before[d0 + r] === before[d1 + r]) r++;
  for (let k = -l; k <= r; k++) if (!splits(x + k)) return x + k;
  return x;
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
  const cited = citedNameSpans(page.text, { next: page.next || "" });
  return where.filter(([, s, e]) => !insideSpans(cited, s, e)).map(([h]) => h);
}

/**
 * The same question asked by the SAVE, of the names standing in the page's
 * disk reading (the reader's standingSpans: findRealSpans hits, a name wrapped
 * over a line break or down a column one hit with a range per piece): the ones
 * an edit wrote, none in a cited decision's name. `text` is the page as it is
 * about to be written, `built` what it was built from or last saved as; with
 * none, nothing counts as typed.
 *
 * The converter answers it for the screen and passes over the name the caret
 * is still in and the one Esc dismissed at the prompt; it reads a text node at
 * a time, so a name typed across a line break is not one it can see at all;
 * and it waits a quarter of a second after the typing. A save inside any of
 * those wrote the real name into the export and then counted it as a name the
 * file had carried, "not yet reviewed", from then on. The save asks here
 * instead, of every name it reads, and writes each one this returns as its
 * pseudonym. A piece the edit wrote makes the name typed: "Rasho" typed under
 * a "Helen" the page had is "Helen Rasho" typed, and is faked whole.
 */
export function typedSpans(spans, text, built, { next = "" } = {}) {
  if (!spans || !spans.length || built == null) return [];
  const edits = editedSpans(built, text);
  if (!edits.length) return [];
  const mine = spans.filter((h) => (h.ranges && h.ranges.length ? h.ranges : [[h.start, h.end]]).some(([a, b]) => spanEdited(edits, a, b)));
  if (!mine.length) return [];
  const cited = citedNameSpans(text, { next });
  return mine.filter((h) => !insideCited(cited, h));
}

/**
 * The typed names Esc left AS TYPED taken out of `spans` (typedSpans' answer):
 * `escaped` is [[start, end], …], each the place of one Esc'd name in the same
 * disk text. A name is the Esc'd one only where it stands EXACTLY there — a
 * longer name ending at the same place ("Bob Jones" typed over an Esc'd
 * "Jones"), or one of several pieces wrapped over lines, is not: it is a name
 * the operator never dismissed, and goes as typed names go.
 */
export function withoutEscaped(spans, escaped) {
  if (!spans || !spans.length || !escaped || !escaped.length) return spans || [];
  return spans.filter((h) => {
    if (h.ranges && h.ranges.length > 1) return true;
    return !escaped.some(([a, b]) => h.start === a && h.end === b);
  });
}

/**
 * Where an Esc'd name stands now, for one whose nodes went from under its
 * range: `was` is the page's disk text when its place was noted (`at`, the
 * start of `name` there), `now` the page's disk text as it stands. The two
 * are compared by the head and the tail they have in common, which is what an
 * edit made in one place leaves alone, and the answer is one of two:
 *
 * - { at } — the name lay wholly in that head or tail, so nothing written
 *   since the note reached it: its start now (moved by what the edit put in
 *   or took out before it), where `now` holds it still, a whole word;
 * - { at: -1, within } — the edit reached it (wrote over it, took it out,
 *   moved the text it stood in, or glued a letter to it): `within` the
 *   starts of the name's whole-word occurrences that the text the edit wrote
 *   takes in (any of them between the shared head and tail; where the edit
 *   only took text out, the ones it closed up across), leaving out `taken`
 *   (the places of the page's other Esc'd names).
 * - { at: -1, within, unsure: true } — it cannot say: told head first and
 *   tail first, the edit disagrees about whether it reached the name (the
 *   text it took or wrote repeats what stands beside the name — "(Jones, 30
 *   …)" deleted from before "(Jones, 31 …)" — so it could have been taken
 *   from either side). `within` is every place either telling puts the name
 *   and every whole-word occurrence in the widest region the edit could have
 *   written; the reader leaves each as typed and warns, and never drops it
 *   for the browser's own edit (escapesIn). Told head first only, the shared
 *   head ran on into the name, the Esc was dropped and the save wrote
 *   "(Pratt, 31 …)" under a plain "Saved" (measured on 0b35064).
 *
 * BOUNDED, BY THE EDIT. This used to be the name's occurrences ANYWHERE on
 * the page, nearest first, with no limit — on the reading that an occurrence
 * wrongly taken for the Esc'd one is only a name left as typed. But a name
 * whose line was deleted waited for the next occurrence however far off and
 * however much later: "Jones was served." typed on line 1, after the short
 * cite holding the Esc'd "Jones" had been cut from line 3, went into the file
 * as itself, with no prompt and no mark, under a warning that it "stands in
 * the file as it did" (measured on b6d82a6). An occurrence the edit did not
 * write is one the operator never pressed Esc on, and it is not offered
 * here. What the reader does with `within` — drop the name, where the one
 * edit since the note was the browser's own and so took it out; leave each
 * occurrence as typed and say so, where the text was moved by something it
 * could not follow — is its own (escapesIn).
 */
export function escapedPlace(was, now, name, at, taken) {
  const a0 = String(was == null ? "" : was), b0 = String(now == null ? "" : now);
  if (!name || !(at >= 0)) return { at: -1, within: [] };
  const word = /[\p{L}\p{N}]/u;
  const whole = (i) => b0.startsWith(name, i) && !(i > 0 && word.test(b0[i - 1])) && !word.test(b0[i + name.length] || "");
  const lim = Math.min(a0.length, b0.length);
  const end = at + name.length;
  // The head and the tail the two share, taken HEAD FIRST (p, s) and TAIL
  // FIRST (p2, s2): the same edit, placed as late and as early as it can be.
  let p = 0;
  while (p < lim && a0.charCodeAt(p) === b0.charCodeAt(p)) p++;
  let s = 0;
  while (s < lim - p && a0.charCodeAt(a0.length - 1 - s) === b0.charCodeAt(b0.length - 1 - s)) s++;
  let s2 = 0;
  while (s2 < lim && a0.charCodeAt(a0.length - 1 - s2) === b0.charCodeAt(b0.length - 1 - s2)) s2++;
  let p2 = 0;
  while (p2 < lim - s2 && a0.charCodeAt(p2) === b0.charCodeAt(p2)) p2++;
  // Where each alignment says the name stands now, untouched — or -1, reached.
  const untouched = (hp, hs) => {
    if (end <= hp && whole(at)) return at;
    if (at >= a0.length - hs && end <= a0.length) {
      const there = at + (b0.length - a0.length);
      if (whole(there)) return there;
    }
    return -1;
  };
  const one = untouched(p, s), two = untouched(p2, s2);
  if (one >= 0 && one === two) return { at: one };
  // The two disagree: the text the edit took or wrote repeats what stands
  // beside it ("(Jones, 30 …)" deleted from before "(Jones, 31 …)"), so it
  // could have been taken from either side of the name and nothing here can
  // say which. The name is UNSURE — left as typed where either reading puts
  // it, and warned — never dropped: dropping it writes its pseudonym, and the
  // party of a short cite written so is a renamed authority.
  const unsure = one >= 0 || two >= 0;
  // The edit reached it, or may have: what it wrote is, at the widest, [lo,
  // hi) of `now` — from the earlier start to the later end of the two
  // placings — or the point lo where it only took text out.
  const lo = Math.min(p, p2), hi = Math.max(b0.length - s, b0.length - s2);
  const within = [];
  const add = (i) => { if (i >= 0 && whole(i) && !(taken && taken.has(i)) && !within.includes(i)) within.push(i); };
  for (let i = b0.indexOf(name); i >= 0; i = b0.indexOf(name, i + 1)) {
    const j = i + name.length;
    if (!(hi > lo ? i < hi && j > lo : i < lo && j > lo)) continue;
    add(i);
  }
  if (unsure) { add(one); add(two); within.sort((x, y) => x - y); }
  return unsure ? { at: -1, within, unsure: true } : { at: -1, within };
}

/**
 * The pseudonym spans an edit made that now stand in a cited decision's name:
 * a party marked at the as-you-type prompt, or by the converter in a pause,
 * before the rest of the citation was typed after it. [span element] — each
 * to go back to the name as typed, since a pseudonym there is a citation to a
 * case that does not exist. Spans the page was built with are not an edit's.
 *
 * …and a span carrying `data-typed` is one, whatever `built` says. The reader
 * sets it on every mark the typing makes and carries it over a save's rebuild
 * of the page, because a save takes the text it wrote for the page's own
 * (`built`): told apart by the edit alone, "See Jones" saved before the
 * citation was finished was "See Pratt" built, and the "v. Smith (2019) 30
 * Cal.App.5th 1." typed after the save left the mark standing in it, to be
 * written as a renamed authority by the next save.
 *
 * …and never a span carrying `data-left`: a mark this put back that the
 * operator took back with Ctrl+Z. The undo puts back the text the page was
 * measured against (`built`) and the typing's flags with the mark (the
 * reader's restoreTyping), which would have it put back again at the next
 * pause; the guide's "Ctrl+Z puts the mark back" is the operator saying the
 * citation is one whose parties the file holds as pseudonyms.
 */
export function typedPseudonymsCited(page, built) {
  if (!page.pn || !page.pn.size) return [];
  const spans = built == null ? [] : editedSpans(built, page.text);
  const made = [];
  for (const [el, o] of page.pn) {
    if (el.getAttribute("data-left") != null) continue; // the operator's: Ctrl+Z took it back from a put-back
    const len = String(el.getAttribute("data-fake") || "").length;
    if (el.getAttribute("data-typed") != null || spanEdited(spans, o, o + len)) made.push([el, o, o + len]);
  }
  if (!made.length) return [];
  const cited = citedNameSpans(page.text, { next: page.next || "" });
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
      // A one-word real PDF-Linker matches only capitalised (pseudo-key's capOnlyReal).
      const fake = capOnlyMiss(compiledForward, m[0]) ? null : lookupForward(compiledForward, m[0]);
      if (fake != null) out.push({ node: seg.node, start: m.index, end: m.index + m[0].length, matched: m[0], fake });
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
  }
  return out;
}

const POSS_MATCH_RE = /['’][sS]$/;
const POSS_TAIL_RE = /['’]s$/i;
/** A value folded for comparison: trimmed, one space between words, lower case, quote-blind (pseudo-key's fold). */
export function foldValue(s) { return foldKey(s); }
function foldKey(s) {
  return pkFold(s);
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
  let k = foldKey(m);
  let fake = compiled.map.get(k);
  let suffix = "";
  const mp = m.match(POSS_MATCH_RE);
  if (fake == null) {
    if (!mp) return null;
    k = foldKey(m.slice(0, -mp[0].length));
    fake = compiled.map.get(k);
    if (fake == null) return null;
    suffix = mp[0];
  } else if (mp && POSS_TAIL_RE.test(fake)) {
    // A possessive row: the 's is the text's own, as pseudo-key's lookup has it.
    fake = fake.replace(POSS_TAIL_RE, "");
    suffix = mp[0];
  }
  const core = suffix ? m.slice(0, -suffix.length) : m;
  const shape = caseShape(core);
  // The key's spelling of the real decides a shout it does not make, as in
  // pseudo-key's swapTo.
  if (shape === "title" && compiled.spell) fake = keySpelled(fake, compiled.spell.get(k), core);
  const cased = mirrorCase(core, fake);
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
  "# PDF-Linker reads this file from the case folder on its next run (a",
  "# click of Re-run PDF-Linker), pseudonymizing each value as if it were given",
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
  "# page again. A line 'fix: VALUE | ANSWER' is an answer given in the walk",
  "# through the key, read as that value's Fix? cell in LEAKS.xlsx: a typed",
  "# replacement (a new pseudonym for it), ~CORRECT, *CORRECT or a [kept part].",
  "# Lines beginning with # are ignored. Delete a line to withdraw it.",
];

// A keep line: `no: VALUE` (this case) or `never: VALUE` (every case).
export const KEEP_RE = /^(no|never)\s*:\s*(.+?)\s*$/i;
// A phrase line: `phrase: VALUE` — the worksheet's own `phrase`, a value of
// several words faked whole. It is a value to fake like any other line, so it
// is on the flagged list; the prefix is what says the words go together.
export const PHRASE_RE = /^phrase\s*:\s*(.+?)\s*$/i;
// An answer given in the walk through the key: `fix: VALUE | ANSWER`, the
// value's whole Fix? cell (PDF-Linker's _READER_FIX_RE). Its no, never and
// phrase go as the lines above; this carries the rest — a typed replacement
// above all, a new pseudonym for a name the key fakes already.
export const FIX_RE = /^fix\s*:\s*(.+?)\s*\|\s*(.+?)\s*$/i;
/** An answer: { value, answer }, both trimmed, or null without both. */
export function makeAnswer(value, answer) {
  const v = normalizeValue(value), a = String(answer == null ? "" : answer).replace(/\s+/g, " ").trim();
  return v && a ? { value: v, answer: a } : null;
}
/** The answer the list holds for `value`, or "". */
export function answerFor(list, value) {
  const f = foldKey(normalizeValue(value));
  const a = (list || []).find((x) => foldKey(x.value) === f);
  return a ? a.answer : "";
}
/** The list with `value` answered `answer` (in place of any answer it had), or with its answer taken off where `answer` is empty; the same list when nothing moves. */
export function setAnswer(list, value, answer) {
  const have = list || [];
  const f = foldKey(normalizeValue(value));
  const now = makeAnswer(value, answer);
  const at = have.findIndex((x) => foldKey(x.value) === f);
  if (!now) return at < 0 ? have : have.filter((_, k) => k !== at);
  if (at >= 0 && have[at].answer === now.answer) return have;
  // Answered again: the value as it was first written, the answer the new one.
  return at < 0 ? have.concat([now]) : have.map((x, k) => (k === at ? { value: x.value, answer: now.answer } : x));
}
/** Its line in New Real Values.txt. */
export function answerLine(a) { return `fix: ${a.value} | ${a.answer}`; }
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

// ---- Ctrl+Z on a DECISION ------------------------------------------------------
//
// A flag, a phrase, a keep, a "fake it" and a LEAKS answer are decisions, not
// edits of the text, and Ctrl+Z walked straight past them: the way back was to
// find the value in a list and take it off by hand. Each is now a step on the
// reader's undo history, beside the text edits and in the order taken. The step
// holds only what that one decision MOVED (decisionDelta), and undoing it moves
// those values back (applyDecisionDelta) — never the whole list, so a value the
// case folder's file brought in since, or a keep the folder's reading settled,
// stands. The page lists (⊘ Did not OCR, ↻ OCR This Page, ✎ Use my text) are
// not decisions here: a strip and its put-back are text edits with undo steps
// of their own.
//
// A state: { flagged: [value], phrases: [value], keeps: [keep], settled: [key],
// rows: [[fix, ok]] | null } — rows the LEAKS worksheet's, by index.

function listDelta(a, b) {
  const ka = new Set((a || []).map((x) => foldKey(x)));
  const kb = new Set((b || []).map((x) => foldKey(x)));
  return {
    add: (b || []).filter((x) => !ka.has(foldKey(x))),
    drop: (a || []).filter((x) => !kb.has(foldKey(x))),
  };
}
function setDelta(a, b) {
  const sa = new Set(a || []), sb = new Set(b || []);
  return { add: [...sb].filter((x) => !sa.has(x)), drop: [...sa].filter((x) => !sb.has(x)) };
}
function sameKeep(x, y) {
  return !!x && !!y && x.control === y.control && x.value === y.value && (x.state || "") === (y.state || "");
}
/** What moved from decision state `a` to `b`: { flagged, phrases, settled: {add, drop}, keeps: [{before, after}], rows: [{i, before, after}] }, or null where nothing did. */
export function decisionDelta(a, b) {
  const flagged = listDelta(a.flagged, b.flagged);
  const phrases = listDelta(a.phrases, b.phrases);
  const settled = setDelta(a.settled, b.settled);
  const ka = new Map((a.keeps || []).map((k) => [foldKey(k.value), k]));
  const kb = new Map((b.keeps || []).map((k) => [foldKey(k.value), k]));
  const keeps = [];
  for (const key of new Set([...ka.keys(), ...kb.keys()])) {
    const before = ka.get(key) || null, after = kb.get(key) || null;
    if (!sameKeep(before, after)) keeps.push({ before, after });
  }
  // …and the answers given in the walk through the key, by value.
  const aa = new Map((a.answers || []).map((x) => [foldKey(x.value), x]));
  const ab = new Map((b.answers || []).map((x) => [foldKey(x.value), x]));
  const answers = [];
  for (const key of new Set([...aa.keys(), ...ab.keys()])) {
    const before = aa.get(key) || null, after = ab.get(key) || null;
    if ((before && before.answer) !== (after && after.answer)) answers.push({ before, after });
  }
  const rows = [];
  if (a.rows && b.rows && a.rows.length === b.rows.length) {
    a.rows.forEach((r, i) => {
      const t = b.rows[i];
      if (r[0] !== t[0] || !!r[1] !== !!t[1]) rows.push({ i, before: [r[0], !!r[1]], after: [t[0], !!t[1]] });
    });
  }
  const moved = flagged.add.length || flagged.drop.length || phrases.add.length || phrases.drop.length
    || settled.add.length || settled.drop.length || keeps.length || rows.length || answers.length;
  return moved ? { flagged, phrases, settled, keeps, rows, answers } : null;
}
/** State `state` with `delta` taken back (`undo`) or made again; a new state, `state` untouched. */
export function applyDecisionDelta(state, delta, undo) {
  const list = (have, d) => {
    let out = (have || []).slice();
    for (const v of undo ? d.add : d.drop) out = removeValue(out, v);
    for (const v of undo ? d.drop : d.add) out = addValue(out, v);
    return out;
  };
  const settled = new Set(state.settled || []);
  for (const v of undo ? delta.settled.add : delta.settled.drop) settled.delete(v);
  for (const v of undo ? delta.settled.drop : delta.settled.add) settled.add(v);
  let keeps = (state.keeps || []).slice();
  for (const { before, after } of delta.keeps) {
    const want = undo ? before : after;
    keeps = removeKeep(keeps, (before || after).value);
    if (want) keeps = keeps.concat([{ ...want }]);
  }
  const rows = state.rows ? state.rows.map((r) => r.slice()) : null;
  if (rows) for (const { i, before, after } of delta.rows) if (i < rows.length) rows[i] = (undo ? before : after).slice();
  let answers = (state.answers || []).slice();
  for (const { before, after } of delta.answers || []) {
    const want = undo ? before : after;
    answers = setAnswer(answers, (before || after).value, want ? want.answer : "");
  }
  return {
    flagged: list(state.flagged, delta.flagged),
    phrases: list(state.phrases, delta.phrases),
    keeps, settled: [...settled], rows, answers,
  };
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

/**
 * The storage keys a folder's state is kept under for the folder `from`, each
 * paired with its key for the folder `to`: [{ from, to }], out of `keys` (the
 * store's keys as they stand). `whole` are the prefixes kept once per folder
 * (prefix + folder: the flagged list, what was last written); `perDoc` those
 * kept once per document in it (prefix + folder + "/" + file: spot keeps,
 * swapped pages, unsaved LEAKS answers).
 *
 * A folder was once named by its bare name and is now named by an id that
 * begins with "/", which no file or folder name can hold — so a name's
 * prefix-and-slash never reaches into an id's keys, and the move from a name
 * to an id (or from a Text Files folder's id to its case folder's) takes only
 * that folder's own. An empty `from` is no folder, and moves nothing.
 */
export function folderStateMoves(keys, from, to, { whole = [], perDoc = [] } = {}) {
  const out = [];
  if (!from || !to || from === to) return out;
  for (const k of keys || []) {
    if (typeof k !== "string") continue;
    const w = whole.find((p) => k === p + from);
    if (w) { out.push({ from: k, to: w + to }); continue; }
    const d = perDoc.find((p) => k.startsWith(p + from + "/"));
    if (d) out.push({ from: k, to: d + to + k.slice((d + from).length) });
  }
  return out;
}

/**
 * Whether an older build's state, kept under a folder's bare NAME, may be
 * moved under the id of the folder of that name now being opened: "" where it
 * may, else why it is held aside — "text" (a Text Files folder), "named" (more
 * than one folder of the name known here), "unwritten" (that build never wrote
 * the list to a folder) or "differs" (the folder's New Real Values.txt is not
 * the text that build last wrote).
 *
 * The state was every same-named folder's at once, so whose it is can only be
 * told from the one thing the folder itself carries: the file that build last
 * wrote, still standing in THIS folder (`onDisk` equal to `saved`). How many
 * folders of the name are remembered (`sameName`) is no evidence on its own:
 * that build remembered folders by name too, one handle per name, so the
 * first one opened after the upgrade always counts one — measured, a keep
 * never written, made in client A's Opposition, moved into client B's because
 * B was the one remembered, took the orange mark off B's plaintiff and was
 * written into B's file as `no:`. It still holds a list aside where two are
 * known. A Text Files folder's list is never moved: every case's Text Files
 * folder shared the one name, and a list carried up from it is written into
 * the case folder PDF-Linker reads.
 */
export function legacyStateHold({ textFiles = false, sameName = 0, saved = "", onDisk = null } = {}) {
  if (textFiles) return "text";
  if (sameName !== 1) return "named"; // counting this one: none known is no answer either
  if (!saved) return "unwritten";
  return onDisk === saved ? "" : "differs";
}

/**
 * An older build's stored list (as readStoredValues gives it) split by what
 * legacyStateHold answered for it: `{ move, held }`, the part read into the
 * folder being opened and the part held aside, either null where empty.
 *
 * NOT THE FLAGS. The whole list was held aside wherever the folder could not
 * show it was last written there — and the ordinary state after a run is just
 * that, since a run spends New Real Values.txt once it has applied it. So for
 * an operator who had flagged, saved and run PDF-Linker, the first open after
 * the upgrade held every flag aside with the keeps, though only one folder of
 * the name had ever been known: the names flagged as standing in the clear
 * lost their red mark, nothing handed them to PDF-Linker again, and the save
 * wrote no file. The two halves of the list fail in opposite directions. A
 * keep or a page line read into the wrong case takes the mark off a real name
 * and hands its run a `no:` for it; a flag read into the wrong case only fakes
 * one more name there (and a phrase only joins a flag's words). So where one
 * folder of the name is known ("unwritten", "differs") the flags and their
 * phrases move and only the keeps and page lines are held; where the list was
 * last written here ("") all of it moves; where two folders of the name are
 * known ("named"), or it is a Text Files folder's ("text" — every case's had
 * the one name), all of it is held, as no one folder can be told from another.
 */
export function legacyListSplit(list, hold) {
  const l = list || {};
  const any = (x) => Object.values(x).some((v) => Array.isArray(v) && v.length);
  const whole = { values: l.values || [], keeps: l.keeps || [], phrases: l.phrases || [], noOcr: l.noOcr || [], ocrAgain: l.ocrAgain || [], textFixed: l.textFixed || [], answers: l.answers || [] };
  if (!hold) return { move: any(whole) ? whole : null, held: null };
  if (hold === "text" || hold === "named") return { move: null, held: any(whole) ? whole : null };
  const move = { values: whole.values, keeps: [], phrases: whole.phrases.filter((p) => isPhrase(whole.values, p)), noOcr: [], ocrAgain: [], textFixed: [], answers: [] };
  const held = { values: [], keeps: whole.keeps, phrases: [], noOcr: whole.noOcr, ocrAgain: whole.ocrAgain, textFixed: whole.textFixed, answers: whole.answers };
  return { move: any(move) ? move : null, held: any(held) ? held : null };
}

/**
 * Two stored lists ({ values, keeps, phrases, noOcr, ocrAgain, textFixed,
 * answers })
 * made one: everything in either, `mine` winning where both name a value or
 * a page — a keep's control, a phrase, a page asked to be read again rather
 * than left unread — as the folder's New Real Values.txt is merged into its
 * list on adoption. Nothing in either is lost: a flag left on is only asked
 * about again, and a flag dropped could let a name ship. Used where a list
 * kept in the Text Files folder joins its case folder's.
 */
export function mergeStoredLists(mine, theirs) {
  const a = mine || {}, b = theirs || {};
  let values = (a.values || []).slice(), keeps = (a.keeps || []).slice(), phrases = (a.phrases || []).slice();
  let noOcr = (a.noOcr || []).slice(), ocrAgain = (a.ocrAgain || []).slice(), textFixed = (a.textFixed || []).slice();
  const hadValue = (v) => values.some((x) => foldKey(x) === foldKey(v));
  for (const v of b.values || []) {
    const fresh = !hadValue(v);
    values = addValue(values, v);
    if (fresh && isPhrase(b.phrases, v)) phrases = addValue(phrases, v);
  }
  for (const k of b.keeps || []) if (!keptControl(keeps, k.value)) keeps = addKeep(keeps, k.control, k.value, k.state);
  const named = (e) => noOcr.some((x) => sameNoOcr(x, e)) || ocrAgain.some((x) => sameNoOcr(x, e));
  for (const e of b.noOcr || []) if (!named(e)) noOcr = setNoOcr(noOcr, e, true);
  for (const e of b.ocrAgain || []) if (!named(e)) ocrAgain = setOcrAgain(ocrAgain, e, true);
  for (const e of b.textFixed || []) if (!named(e) && !textFixed.some((x) => sameNoOcr(x, e))) textFixed = setTextFixed(textFixed, e, true);
  let answers = (a.answers || []).slice();
  for (const x of b.answers || []) if (!answerFor(answers, x.value)) answers = setAnswer(answers, x.value, x.answer);
  return { values, keeps, phrases, noOcr, ocrAgain, textFixed, answers };
}

export function formatValuesFile(values, keeps, phrases, noOcr, ocrAgain, textFixed, answers) {
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
  const told = (answers || []).map((a) => makeAnswer(a && a.value, a && a.answer)).filter(Boolean).map(answerLine);
  return VALUES_HEAD.concat(body, kept, told, pages, again, fixed).join("\n") + "\n";
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
// The authorities trailer an older build wrote rides on the last page of an
// export, and ends that page's text — for the sum, here and in PDF-Linker's
// page cut alike (`_PN_EXPORT_TRAILER_RE`, the same pattern as TRAILER_RE).
// It is the ONLY line that ends a page short of the next page header: the
// broad rule this replaced (any "=… x …=" line) also ended a page at a line
// the operator typed — "= = = = =", "== Exhibit A ==" — so PDF-Linker drew
// the text above it as the page's whole layer, marked the page TEXT
// CORRECTED, and the rest was never read again.
//
// …and a line shaped like PDF-Linker's own furniture — six "=" each side of
// a label: a page header, a held page's heading in Edited Pages Not
// Applied.txt pasted back with its page — is not cut at either: the page is
// not handed over (pageFurnitureLine; PDF-Linker's `_pn_page_furniture_line`
// refuses it the same way, pinned to the same vectors).
const FURNITURE_RE = /^={6} \S(?:.*\S)? ={6}$/;
// …and the head of the comments block ends a page's text as the trailer does
// (COMMENTS_RE; PDF-Linker's `_pn_page_cut`). The reader keeps the block off
// the page's lines (parseExport), so here it is for lines read some other way.
const pageCut = (l) => TRAILER_RE.test(l) || COMMENTS_RE.test(l);
/** The first line of a page, above its authorities trailer if it has one, shaped like PDF-Linker's own furniture; null where none is. */
export function pageFurnitureLine(lines) {
  for (const raw of lines || []) {
    const line = String(raw == null ? "" : raw);
    if (pageCut(line)) return null;
    if (FURNITURE_RE.test(line)) return line;
  }
  return null;
}

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
 * lines up to the authorities trailer or the comments block (pageCut), joined by newlines — each line's trailing
 * spaces, tabs and carriage returns dropped, and the blank lines at either end.
 * PDF-Linker's _pn_page_text_sum is the same function; the two are pinned to
 * the same values on both sides.
 */
export function pageTextSum(lines) {
  const src = (lines || []).map((l) => String(l == null ? "" : l));
  const r = src.findIndex(pageCut);
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
/**
 * Whether PDF-Linker wrote the page as a CONDENSED transcript (its header
 * says so): a court reporter's sheet of four deposition pages, each in its
 * own box with its own line numbers 1-25, which PDF-Linker writes one after
 * another, each under its "Page N" heading. The page's margin numbers start
 * again at 1 for every one of them, so it is no pleading page: nothing is put
 * back in its margin (restoreMarginNumbers), it says nothing about the
 * number the document's pleading pages run to (pleadingLast), and it is not
 * laid on its PDF page's grid, where four columns of numbers stand side by
 * side (text-reader.js, applyMatchedLayoutNow).
 */
export function headerSaysCondensed(page) {
  return /\bCONDENSED TRANSCRIPT\b/.test(String((page && (page.review || page.header)) || ""));
}

/** Whether PDF-Linker wrote the page off the operator's transcription (its header says so). */
export function headerSaysTextCorrected(page) {
  return /\bTEXT CORRECTED\b/.test(String((page && (page.review || page.header)) || ""));
}

// ✎ Use my text is also asked WITHOUT the click: a page the operator has typed
// over in this many words or more, by the time a save writes it, is handed to
// PDF-Linker as a transcription (the reader's autoUseMyText). One word is a
// correction PDF-Linker's own fixes reach (a `*` fix, a flag); several are a
// page being transcribed, and a full run would otherwise put the OCR's reading
// back over every one of them.
export const AUTO_TEXT_FIXED_WORDS = 2;
// Past this many word pairs the middle of two texts is not aligned word by
// word; it is counted as changed in the larger of its two sides.
const WORDS_CHANGED_MAX_CELLS = 4e6;
/**
 * How many words differ between `before` and `after`, two texts of one page:
 * the words taken out or the words put in, whichever is more, over a word-by-
 * word alignment (a longest common run), the common head and tail first set
 * aside. Words are the runs between whitespace, so a line moved or re-broken
 * is no change, and a word corrected in place counts once.
 */
export function wordsChanged(before, after) {
  const a = String(before == null ? "" : before).split(/\s+/).filter(Boolean);
  const b = String(after == null ? "" : after).split(/\s+/).filter(Boolean);
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ea = a.length, eb = b.length;
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const n = ea - lo, m = eb - lo;
  if (!n || !m) return Math.max(n, m);
  if (n * m > WORDS_CHANGED_MAX_CELLS) return Math.max(n, m);
  let prev = new Uint32Array(m + 1), cur = new Uint32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    const w = a[lo + i - 1];
    for (let j = 1; j <= m; j++) {
      cur[j] = w === b[lo + j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  const same = prev[m];
  return Math.max(n - same, m - same);
}

// A page line PDF-Linker SET ASIDE: `# <the line>`, under a `# not applied: …`
// note — refused because its PDF's page count no longer matches its export.
const SET_ASIDE_RE = /^#\s*((?:did[\s-]*not[\s-]*ocr|ocr[\s-]*again|text[\s-]*corrected)\s*:.*)$/i;
/** The page lines PDF-Linker set aside in `disk` (`# <the line>`), as parseReaderFile reads them: { noOcr, ocrAgain, textFixed }. */
export function setAsideLines(disk) {
  const lines = [];
  for (const raw of String(disk == null ? "" : disk).split(/\r?\n/)) {
    const m = raw.replace(/^\ufeff/, "").trim().match(SET_ASIDE_RE);
    if (m) lines.push(m[1]);
  }
  const p = parseReaderFile(lines.join("\n"));
  return { noOcr: p.noOcr, ocrAgain: p.ocrAgain, textFixed: p.textFixed };
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

/**
 * The page lists PDF-Linker is owed, as they follow the pages: `lists` is
 * { noOcr, ocrAgain, textFixed }, `items` the pages read, each { entry, page }
 * (the page's entry, { doc, pdf, page }, and the page itself, its header and
 * lines). Read off the pages rather than kept beside them, so nothing can leave
 * a list saying what the text does not:
 *   - a page whose header PDF-Linker wrote as DID NOT OCR is the run's now,
 *     and comes off the list of pages not to OCR;
 *   - a page that reads [DID NOT OCR] under any other header is owed as not to
 *     OCR — unless it has been asked to be read again;
 *   - with `drop` (the page's text is the document's last word: an undo just
 *     put it back, a save writes it), a page that no longer reads it comes off;
 *   - a request to read a page again is done once the page reads as read
 *     under a header that is not DID NOT OCR;
 *   - a page that reads [DID NOT OCR] has no transcription to hand over.
 * → { noOcr, ocrAgain, textFixed }, each the same list where nothing moved.
 */
export function pageListsAfter(lists, items, { drop = false, held = null } = {}) {
  let list = (lists && lists.noOcr) || [], again = (lists && lists.ocrAgain) || [], fixed = (lists && lists.textFixed) || [];
  for (const { entry, page: p } of items || []) {
    if (!entry || !p) continue;
    const marked = headerSaysDidNotOcr(p), reads = readsDidNotOcr(p.lines);
    const asked = again.some((e) => sameNoOcr(e, entry));
    // …never one PDF-Linker set aside (`held`): its page is not the one the
    // line named any more, until the page is marked again by hand.
    const aside = !!held && held.some((e) => sameNoOcr(e, entry));
    if (marked) list = setNoOcr(list, entry, false);
    else if (reads) { if (!asked && !aside) list = setNoOcr(list, entry, true); }
    else if (drop) list = setNoOcr(list, entry, false);
    if (asked && !marked && !reads) again = setOcrAgain(again, entry, false);
    if (reads) fixed = setTextFixed(fixed, entry, false);
  }
  return { noOcr: list, ocrAgain: again, textFixed: fixed };
}

/**
 * Each transcribed page's sum set to its text as a save just wrote it —
 * `items` are { entry, lines, before, pressed }: the page as written, the
 * page as the file it replaced read (null where that is not known), and
 * whether ✎ Use my text was pressed on it since the last save. A SAVE MOVES A
 * SUM ONLY WHERE IT WROTE THE PAGE AND THE LINE WAS TRUE OF THE FILE IT
 * REPLACED, or where ✎ was pressed: it used to stamp every transcribed page
 * of every document it wrote, so an empty Ctrl+S on an export a run had
 * rewritten from the bad OCR made that OCR the operator's transcription, and
 * the next run burned it into the PDF and spent the line. A page with no
 * `text corrected` entry is passed over. → the list, the same one where no
 * sum moved.
 */
export function fixedSumsFor(textFixed, items) {
  let list = textFixed || [];
  for (const { entry, lines, before = null, pressed = false } of items || []) {
    const had = entry && list.find((e) => sameNoOcr(e, entry));
    if (!had) continue;
    const sum = pageTextSum(lines);
    if (sum === had.sum) continue;
    if (!pressed) {
      // Nothing known of the page the write replaced: the line stands.
      if (before == null) continue;
      const was = pageTextSum(before);
      // The save did not write this page — an empty Ctrl+S, an edit on
      // another page, a margin number put back somewhere else.
      if (was === sum) continue;
      // The line was not true of the page the write replaced: a run rewrote
      // the export since (from the OCR the operator was replacing, its PDF
      // locked), and stamping the page's text now handed that reading to the
      // next run as the operator's transcription. The line keeps its sum;
      // PDF-Linker refuses it and says so, and ✎ asks again.
      if (had.sum && was !== had.sum) continue;
    }
    list = setTextFixed(list, { ...entry, sum }, true);
  }
  return list;
}

/**
 * Whether a New Real Values.txt carries any line PDF-Linker reads: anything
 * but blank lines and `#` comments. A file of the header alone is read as
 * empty, which is how the last flag withdrawn reaches PDF-Linker — the file is
 * written with nothing in it rather than left holding the flag.
 */
export function readerFileHasLines(text) {
  for (const raw of String(text == null ? "" : text).split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, "").trim();
    if (line && line[0] !== "#") return true;
  }
  return false;
}

/** The file's values to fake, in order (the keeps are parseReaderFile's). */
export function parseValuesFile(text) {
  return parseReaderFile(text).values;
}

/**
 * The file's lines: { values, keeps, phrases, noOcr, ocrAgain, textFixed,
 * answers }. A
 * phrase line is a value to fake, so it is in `values` too; `phrases` says
 * which of them go whole; `noOcr` is the pages marked Did not OCR, `ocrAgain`
 * the pages to read again and `textFixed` the pages transcribed by hand
 * ({ doc, pdf: "", page }, `doc` being whatever file the line names, and a
 * transcribed page's `sum`); `answers` the walk through the key's answers,
 * { value, answer }.
 */
export function parseReaderFile(text) {
  const values = [];
  const keeps = [];
  const phrases = [];
  let noOcr = [];
  let ocrAgain = [];
  let textFixed = [];
  const answers = [];
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
    // An answer from the walk through the key. A `fix:` line with nothing
    // after its pipe is no answer, and no value either.
    if (/^fix\s*:/i.test(line)) {
      const f = line.match(FIX_RE);
      const a = f && makeAnswer(f[1], f[2]);
      if (a && !seen.has(foldKey(a.value))) { seen.add(foldKey(a.value)); answers.push(a); }
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
  return { values, keeps, phrases, noOcr, ocrAgain, textFixed, answers };
}

// ---- what PDF-Linker has spent ---------------------------------------------------
//
// PDF-Linker CONSUMES New Real Values.txt (_pn_consume_reader_file): a keep line
// it applied goes onto the master workbook's KEEP sheet, under this folder's
// Origin, and out of the file, which is deleted once nothing is left in it. The
// reader's list went on holding every keep taken in the case, and wrote each of
// them into the file again on the next save that found the list changed — so a
// keep the operator had since emptied or deleted on the master came back on the
// next run, and the operator removed the same values over and over.
//
// So the list is read against the file as it stands. An entry whose line the
// reader WROTE (it is in `saved`, the text last written) and that the file no
// longer carries has been SPENT: its decision lives on the master now, or was
// taken off it there, and either way handing it over again is the bug. A line
// still in the file is not spent, whatever the comment above it says —
// PDF-Linker writes back a keep whose master row it could not write, and one
// a typed --fix-leaks holds for the full run, each under a "#" line saying why. The
// text-corrected pages are spent the same way, by their page and sum. `saved`
// must be what was written into THIS folder: the reader asks that of it first
// (text-reader.js, writtenWhere), and rebuilds it from the folder's own file
// where it was written anywhere else (writtenBaseline).

/** Every keep line of a reader file, in order: [{ control, value }] (parseReaderFile reads a value's first line only). */
export function keepLines(text) {
  const out = [];
  for (const raw of String(text == null ? "" : text).split(/\r?\n/)) {
    const line = raw.replace(/^\ufeff/, "").trim();
    if (!line || line[0] === "#") continue;
    const m = line.match(KEEP_RE);
    const v = m ? normalizeValue(m[2]) : "";
    if (v) out.push({ control: m[1].toLowerCase(), value: v });
  }
  return out;
}
/**
 * Whether the reader file `text` carries a keep line on `value` — one with
 * `control` where it is given, else either. With a control it is the question
 * "did the reader write THIS keep?" (asked of the text last written); without,
 * "is a keep on the value still in the file?" (asked of the file).
 */
export function carriesKeep(text, value, control = "") {
  const f = foldKey(value);
  const c = String(control || "").toLowerCase();
  return !!f && keepLines(text).some((k) => foldKey(k.value) === f && (!c || k.control === c));
}
/**
 * The lists read against New Real Values.txt as it stands on disk.
 *
 *   lists   { keeps, textFixed }
 *   saved   the file as the reader last wrote it (valuesSaved)
 *   disk    the file now, or null where there is none — PDF-Linker deletes it
 *           once it has spent every line (a file that cannot be read is no
 *           answer at all: the caller does not ask)
 *
 * A keep is spent where the reader wrote it (`saved` carries its line, its own
 * control) and the file carries no keep line on its value; a transcribed page
 * where `saved` carries its line with the same sum and the file names the page
 * no more. A local keep is never written, so it is never spent.
 *
 * → { keeps, textFixed, spentKeeps, spentFixed, saved }: each list less what
 * was spent (the same array where nothing was), and `saved` less every keep and
 * text-corrected line the file no longer carries — the reader's record of what
 * it handed over brought into step with what the folder still holds, so an
 * entry PDF-Linker has spent does not leave the list reading as unwritten.
 */
export function spendLines(lists, saved, disk) {
  const keeps = (lists && lists.keeps) || [];
  const textFixed = (lists && lists.textFixed) || [];
  const noOcr = (lists && lists.noOcr) || [];
  const ocrAgain = (lists && lists.ocrAgain) || [];
  const answers = (lists && lists.answers) || [];
  const now = disk == null ? "" : String(disk);
  const was = saved == null ? "" : String(saved);
  const onDisk = new Set(keepLines(now).map((k) => foldKey(k.value)));
  const wrote = new Set(keepLines(was).map((k) => k.control + ":" + foldKey(k.value)));
  const spentKeeps = keeps.filter((k) => k && k.state !== "local"
    && wrote.has(k.control + ":" + foldKey(k.value)) && !onDisk.has(foldKey(k.value)));
  const fixedWritten = parseReaderFile(was).textFixed;
  const fixedOnDisk = parseReaderFile(now).textFixed;
  const spentFixed = textFixed.filter((e) => fixedWritten.some((w) => sameNoOcr(w, e) && w.sum === e.sum)
    && !fixedOnDisk.some((d) => sameNoOcr(d, e)));
  // …and a page not to OCR, or to OCR again, written here and no longer in the
  // file as a line PDF-Linker reads: applied (the page marked, the line spent),
  // or SET ASIDE — refused because its PDF's page count no longer matches its
  // export, and written back as `# <the line>` (setAsideLines) so no run
  // applies it to a renumbered page. Kept, the reader's next write put the
  // line back as one to apply, and the run after it marked the wrong page.
  const wroteP = parseReaderFile(was), diskP = parseReaderFile(now);
  const gonePage = (written, onDisk) => (e) => written.some((w) => sameNoOcr(w, e)) && !onDisk.some((d) => sameNoOcr(d, e));
  const spentNoOcr = noOcr.filter(gonePage(wroteP.noOcr, diskP.noOcr));
  const spentAgain = ocrAgain.filter(gonePage(wroteP.ocrAgain, diskP.ocrAgain));
  // …and an answer from the walk through the key, written here and no longer
  // in the file: the full run carried it out and spent its line (one it
  // could not yet carry out — a plain --fix-leaks — it leaves in the file).
  const sameAnswer = (x, y) => foldKey(x.value) === foldKey(y.value) && x.answer === y.answer;
  const spentAnswers = answers.filter((a) => wroteP.answers.some((w) => sameAnswer(w, a)) && !diskP.answers.some((d) => sameAnswer(d, a)));
  const aside = setAsideLines(now);
  const setAside = spentNoOcr.filter((e) => aside.noOcr.some((d) => sameNoOcr(d, e)))
    .concat(spentAgain.filter((e) => aside.ocrAgain.some((d) => sameNoOcr(d, e))))
    .concat(textFixed.filter((e) => aside.textFixed.some((d) => sameNoOcr(d, e))));
  const lines = was.split("\n").filter((raw) => {
    const line = raw.replace(/^\ufeff/, "").trim();
    if (!line || line[0] === "#") return true;
    if (TEXTFIXED_LEAD_RE.test(line)) {
      const n = line.match(TEXTFIXED_RE);
      return !n || fixedOnDisk.some((d) => sameNoOcr(d, { doc: n[1], page: Number(n[2]) }));
    }
    const pl = parseReaderFile(line);
    if (pl.noOcr.length) return diskP.noOcr.some((d) => sameNoOcr(d, pl.noOcr[0]));
    if (pl.ocrAgain.length) return diskP.ocrAgain.some((d) => sameNoOcr(d, pl.ocrAgain[0]));
    if (pl.answers.length) return diskP.answers.some((d) => foldKey(d.value) === foldKey(pl.answers[0].value));
    const m = line.match(KEEP_RE);
    return !m || onDisk.has(foldKey(m[2]));
  });
  return {
    keeps: spentKeeps.length ? keeps.filter((k) => !spentKeeps.includes(k)) : keeps,
    textFixed: spentFixed.length ? textFixed.filter((e) => !spentFixed.includes(e)) : textFixed,
    noOcr: spentNoOcr.length ? noOcr.filter((e) => !spentNoOcr.includes(e)) : noOcr,
    ocrAgain: spentAgain.length ? ocrAgain.filter((e) => !spentAgain.includes(e)) : ocrAgain,
    answers: spentAnswers.length ? answers.filter((a) => !spentAnswers.includes(a)) : answers,
    spentKeeps,
    spentAnswers,
    spentFixed,
    setAside,
    saved: lines.join("\n"),
  };
}
/**
 * `saved` without its keep lines on `values`. A keep taken AFRESH is not the one
 * written before: the old line may be spent, and the new decision must not be
 * taken for it and retired unsent.
 */
export function forgetKeepLines(saved, values) {
  const want = new Set((values || []).map(foldKey).filter(Boolean));
  const was = saved == null ? "" : String(saved);
  if (!want.size) return was;
  return was.split("\n").filter((raw) => {
    const m = raw.replace(/^\ufeff/, "").trim().match(KEEP_RE);
    return !m || !want.has(foldKey(m[2]));
  }).join("\n");
}
/**
 * `saved` with the keep `lines` ({ control, value }) put in where it does not
 * carry them: lines the reader has found in the folder's file, written there by
 * another session, and is about to take out of it. Recorded as handed over,
 * the list without them reads as owed to the file (valuesDirty), and opening
 * the folder does not read them back in as a keep (carriesKeep).
 */
export function noteKeepLines(saved, lines) {
  let out = saved == null ? "" : String(saved);
  for (const k of lines || []) {
    const v = normalizeValue(k && k.value);
    const c = String((k && k.control) || "").toLowerCase();
    if (!v || !KEEP_CONTROLS.includes(c) || carriesKeep(out, v, c)) continue;
    out += (out && !out.endsWith("\n") ? "\n" : "") + `${c}: ${v}\n`;
  }
  return out;
}
// ---- the lines of New Real Values.txt the reader did not write ----------------
//
// The reader writes the file whole, from its lists. A line PDF-Linker reads that
// the lists cannot hold (a page list, "did not ocr: X.pdf | pages 3-5, 9"), and a
// line written into the file since the folder was opened — typed by hand, or by
// another reader tab — were lost at the next save. They are kept now: the
// reader's own lines first (PDF-Linker and parseReaderFile take a value's FIRST
// line), then every other line of the file as it stands, verbatim, under a
// comment. A line leaves the file only as one the reader wrote or read and has
// since withdrawn. See "Files a run changed under the reader" in the design notes.

const KEPT_LINES_HEAD = "# Already in this file, not written by the text reader — kept as they stand:";

/**
 * A line's identity, for telling the file's lines from the reader's own:
 * `value:`/`phrase:` and the value, `no:`/`never:` and the value, `noocr:` and
 * `again:` and the page, `fixed:` and the page and its sum, all folded; `raw:`
 * and the folded line for one PDF-Linker reads that the reader cannot parse (a
 * page list); "" for a blank line or a comment.
 */
export function valuesLineKey(raw) {
  const line = String(raw == null ? "" : raw).replace(/^\ufeff/, "").trim();
  if (!line || line[0] === "#") return "";
  const p = parseReaderFile(line);
  const page = (e) => foldKey(e.doc) + "|" + e.page;
  if (p.noOcr.length) return "noocr:" + page(p.noOcr[0]);
  if (p.ocrAgain.length) return "again:" + page(p.ocrAgain[0]);
  if (p.textFixed.length) return "fixed:" + page(p.textFixed[0]) + "|" + foldKey(p.textFixed[0].sum || "");
  if (p.keeps.length) return p.keeps[0].control + ":" + foldKey(p.keeps[0].value);
  if (p.answers.length) return "fix:" + foldKey(p.answers[0].value) + "|" + foldKey(p.answers[0].answer);
  if (p.values.length) return (p.phrases.length ? "phrase:" : "value:") + foldKey(p.values[0]);
  return "raw:" + foldKey(line);
}
function lineKeys(text) {
  const out = new Set();
  for (const raw of String(text == null ? "" : text).split(/\r?\n/)) { const k = valuesLineKey(raw); if (k) out.add(k); }
  return out;
}
/** The keys of every line of a reader file (valuesLineKey), as a Set. */
export function valuesLineKeys(text) { return lineKeys(text); }
/**
 * The lines of `disk` (the file as it stands) the reader is to keep when it
 * writes `mine` (its own text): verbatim, in order, once each. A line `mine`
 * carries is its own. A `raw:` line is always kept — the reader cannot read it
 * into a list, so nothing it holds can stand for it. Any other line is kept only
 * where the reader neither `written` it (the text this tab last wrote: a line
 * gone from its lists since is withdrawn) nor `seen` it in the file when the
 * folder was opened (it was read into the lists then: gone from them since, it
 * was withdrawn) — every such line goes where `seen` is null, the file never
 * read — and it is not a keep the operator withdrew (`withdrawn(control, value)`).
 */
export function linesNotOurs(disk, { mine = "", written = "", seen = null, withdrawn = null } = {}) {
  const ours = lineKeys(mine);
  const wrote = lineKeys(written);
  const out = [], had = new Set();
  for (const raw of String(disk == null ? "" : disk).split(/\r?\n/)) {
    const k = valuesLineKey(raw);
    if (!k || ours.has(k) || had.has(k)) continue;
    if (!k.startsWith("raw:")) {
      if (!seen || wrote.has(k) || seen.has(k)) continue;
      const m = raw.replace(/^\ufeff/, "").trim().match(KEEP_RE);
      if (m && withdrawn && withdrawn(m[1].toLowerCase(), normalizeValue(m[2]))) continue;
    }
    had.add(k);
    out.push(raw.replace(/^\ufeff/, "").replace(/\s+$/, ""));
  }
  return out;
}
/**
 * The file to write: the reader's own text, then PDF-Linker's notes with the
 * lines under them (`noted`, notedBlocks'), then the lines kept (linesNotOurs)
 * under their comment.
 */
export function withLinesNotOurs(mine, kept, noted = []) {
  let text = String(mine == null ? "" : mine);
  for (const b of noted || []) text += (text && !text.endsWith("\n") ? "\n" : "") + "\n" + b.note.concat([""], b.lines).join("\n") + "\n";
  if (!kept || !kept.length) return text;
  return text + (text && !text.endsWith("\n") ? "\n" : "") + "\n" + KEPT_LINES_HEAD + "\n" + kept.join("\n") + "\n";
}
// PDF-LINKER'S NOTES stay over their lines. A run writes lines back into the
// file under a `#` note saying what they are — a keep it could not record on
// the master, one waiting for a full re-run, a line saved after it read the
// file, and (keep withdrawals, G3) a keep line carried back for this case
// whose master row is another case's, which the note tells the next run to
// apply as this case's keep without recording it again. The reader read those
// lines into its lists and wrote them back among its own, the note dropped:
// a carried keep line then read as a fresh instruction, recorded once more as
// the newest, and could put this case's `no` back over the other case's row.
// The reader's own header (its first line has never changed) and the page
// lines PDF-Linker set aside (`# <the line>`) are not notes.
const READER_HEAD_FIRST = VALUES_HEAD[0];
/**
 * PDF-Linker's notes in `disk` (the file as it stands) over lines the reader's
 * own text (`mine`) still carries: { blocks: [{ note, lines }], mine } — each
 * note's comment lines and the lines under it that `mine` carries (verbatim,
 * as the file has them), and `mine` without those lines, which go under their
 * note instead (withLinesNotOurs). A line the reader no longer carries is not
 * kept under its note; a note with none left goes.
 */
export function notedBlocks(disk, mine) {
  const text = String(mine == null ? "" : mine);
  const ours = new Set();
  for (const raw of text.split(/\r?\n/)) { const k = valuesLineKey(raw); if (k && !k.startsWith("raw:")) ours.add(k); }
  const blocks = [], moved = new Set();
  let cur = null, header = false;
  for (const raw of String(disk == null ? "" : disk).split(/\r?\n/)) {
    const line = raw.replace(/^\ufeff/, "").trim();
    if (!line) continue;
    if (line[0] === "#") {
      if (line === READER_HEAD_FIRST) { header = true; cur = null; continue; }
      if (header || line === KEPT_LINES_HEAD || SET_ASIDE_RE.test(line)) { cur = null; continue; }
      if (cur && !cur.lines.length) cur.note.push(line);
      else { cur = { note: [line], lines: [] }; blocks.push(cur); }
      continue;
    }
    header = false;
    if (!cur) continue;
    const k = valuesLineKey(line);
    if (k && ours.has(k) && !moved.has(k)) { cur.lines.push(line); moved.add(k); }
  }
  const out = blocks.filter((b) => b.lines.length);
  if (!out.length) return { blocks: [], mine: text };
  return { blocks: out, mine: text.split("\n").filter((raw) => !moved.has(valuesLineKey(raw))).join("\n") };
}
/** Whether two byte arrays hold the same bytes. */
export function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The keep lines of `record` that `text` still carries — the same control on
 * the same value — as keep lines of their own ("" where `text` is null, a file
 * that is not there). The record of the keeps WITHDRAWN is held to what the
 * folder's file still says: a line the file no longer carries is nothing left
 * to keep out of the list, and a line written there afterwards by another
 * session is a keep to read in, not one withdrawn.
 */
export function keepLinesCarried(record, text) {
  if (text == null) return "";
  return noteKeepLines("", keepLines(record).filter((k) => carriesKeep(text, k.value, k.control)));
}
/** The lines of a reader file PDF-Linker reads, whitespace folded and lower case, sorted and once each. */
function readerLines(text) {
  const out = new Set();
  for (const raw of String(text == null ? "" : text).split(/\r?\n/)) {
    const line = foldKey(raw.replace(/^﻿/, ""));
    if (line && line[0] !== "#") out.add(line);
  }
  return [...out].sort();
}
/**
 * The record of what was written (valuesSaved), rebuilt from the folder's file
 * as it stands (`disk`, null where there is none) where the record on hand was
 * written somewhere else — another folder of the same name (a copy of the
 * case, every case's Text Files), or no folder at all (the save picker, a
 * download). The list's own text (`listText`, formatValuesFile's) where the
 * file carries exactly the lines it would write, so a folder already in step
 * reads in step; the file's text otherwise, so the list reads as owed to this
 * folder wherever it differs; "" where the folder has no file.
 */
export function writtenBaseline(listText, disk) {
  if (disk == null) return "";
  const a = readerLines(listText), b = readerLines(disk);
  return a.length === b.length && a.every((l, i) => l === b[i]) ? String(listText == null ? "" : listText) : String(disk);
}
/**
 * The record of what was written (`saved`) with every line of the folder's
 * file (`disk`) that the list (`listText`, formatValuesFile's) carries and the
 * record does not: the lines the folder's opening read INTO the list — written
 * by another browser, another session or by hand. They stand in the file all
 * the same, so a list that lets one go owes the file its removal (valuesDirty):
 * unrecorded, the value withdrawn read as "nothing to write", stayed in the
 * file, and PDF-Linker went on applying it. And a keep or a transcribed page
 * PDF-Linker then takes out reads as spent (spendLines), not owed again. A line
 * the reader cannot read into a list (`raw:`) is never recorded. Where the
 * record then carries exactly the list's lines, the list's own text, so a
 * folder in step with its file reads in step.
 */
export function noteLinesRead(saved, disk, listText) {
  const was = saved == null ? "" : String(saved);
  if (disk == null) return was;
  const list = lineKeys(listText), have = lineKeys(was);
  let out = was;
  for (const raw of String(disk).split(/\r?\n/)) {
    const k = valuesLineKey(raw);
    if (!k || k.startsWith("raw:") || !list.has(k) || have.has(k)) continue;
    have.add(k);
    out += (out && !out.endsWith("\n") ? "\n" : "") + raw.replace(/^﻿/, "").trim() + "\n";
  }
  if (out === was) return was;
  const a = readerLines(listText), b = readerLines(out);
  return a.length === b.length && a.every((l, i) => l === b[i]) ? String(listText == null ? "" : listText) : out;
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

/**
 * A Markdown document by name: what My-Macros' Markdown export writes from a
 * Word draft, in its pseudonyms (the re-anonymized copy). It is read as a lone
 * file, the way a headerless Word export is — one page, the real values put
 * back on screen through the key — and saved in its pseudonyms under its own
 * name. Never one of a case folder's documents: PDF-Linker neither writes nor
 * reads it, so isExportName does not take it.
 */
export function isMarkdownName(name) {
  return /\.(md|markdown)$/i.test(String(name == null ? "" : name).trim());
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

/**
 * THE RE-RUN BUTTON (text-reader.js, `rerunLinker`). A page cannot start a
 * program, and it cannot learn where on disk the case folder it was handed
 * sits. PDF-Linker writes the folder's path into each launcher it leaves, on a
 * comment line of its own (`_launcher_folder_line`), as unpadded base64url of
 * its UTF-8; the reader copies that token into a `pdf-linker:` link, which
 * Windows hands to PDF-Linker (`--reader-request`, registered once per
 * computer by its `Register Reader Button.bat`). The link carries a nonce, and
 * PDF-Linker starts the launcher only once the reader has written the same
 * nonce into `RUN_REQUEST_FILE` in that folder: the save's "go", and the proof
 * that the page asking holds the folder. The tag, the token's alphabet, the
 * link and the file's fields change only in step with PDF-Linker.
 */
export const RUN_REQUEST_FILE = "PDF-Linker Run Request.json";
export const LAUNCHER_STEMS = ["Re-run PDF-Linker", "Run PDF-Linker"];
const LAUNCHER_FOLDER_TAG = "Folder, for the text reader's Re-run button:";
/** The folder token a launcher's text records, or "" (an older PDF-Linker's launcher records none). */
export function launcherFolderToken(text) {
  const tag = LAUNCHER_FOLDER_TAG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^(?:REM|#)[ \\t]+${tag}[ \\t]+([A-Za-z0-9_-]+)[ \\t]*\\r?$`, "m").exec(String(text == null ? "" : text));
  return m ? m[1] : "";
}
/** The `pdf-linker:` link that asks PDF-Linker to run the folder its launcher's token names. */
export function rerunUrl(token, folderName, nonce) {
  return `pdf-linker://run?f=${token}&d=${encodeURIComponent(folderName || "")}&n=${nonce}`;
}
/** The request file's text: `go` once everything is saved, `cancel` where a save did not finish. */
export function runRequestText(nonce, state) {
  return JSON.stringify({ nonce, state }) + "\n";
}

/** The pseudonym key by name — the macro's pattern plus Windows' copies. */
/** A document's name as a reader says it: without the export's extension. */
export function docLabel(name) {
  return String(name == null ? "" : name).replace(/\.(txt(\.LEAK)?|md|markdown)$/i, "");
}

export function isKeyName(name) {
  const n = String(name == null ? "" : name).split(/[\\/]/).pop().trim();
  // …never PDF-Linker's own temporary copy, written beside the key while a
  // save is going and left behind by one that crashed (`_pn_xl_save`).
  return /^pseudonym[ _-]?key.*\.xlsx$/i.test(n) && !/\.tmp\.xlsx$/i.test(n);
}
// The one name PDF-Linker reads its key under. A copy ("pseudonym_key (1).xlsx",
// "pseudonym_key - Copy.xlsx") is still a key, but where the real one stands
// beside it, the real one is the folder's (keyRank 0 over 1): Windows lists a
// folder in its own order, and the first match was the copy as often as not.
export const KEY_FILE = "pseudonym_key.xlsx";
export function keyRank(name) {
  return String(name == null ? "" : name).split(/[\\/]/).pop().trim().toLowerCase() === KEY_FILE ? 0 : 1;
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

/**
 * THE `)` SIDE OF A CAPTION. A pleading's cover page boxes its parties with a
 * column of `)`s down their right, one on every line of the caption, and the
 * case number and title stand beyond it:
 *
 *     TOBIAS WRENFIELD,             )  Case No. 23STCV01234
 *               Plaintiff,          )
 *     ______________________________)
 *
 * In the reader's font that column wanders as its left half's words do, so
 * it is drawn as the box's side (rules.js, dressLines), as a `│` is. `lines`
 * are a page's lines as the file writes them (gutter included); per line the
 * result is null, or { at, col, under }: the offset of its side `)`, the
 * offset the whole side stands at (its first line's, so every row of it is
 * one table and one column), and whether only an underscore run stands before
 * it (the box's foot). A side `)` follows a space or an underscore and is
 * followed by a space or the line's end, so "(SBN 123456)" and "(Hon. Dana
 * Whitaker)" are not one; and it stands within PAREN_SLOP of the side's
 * column on CAPTION_PAREN_MIN lines running, with no line between them
 * lacking one.
 */
export const CAPTION_PAREN_MIN = 3;
const PAREN_SLOP = 2;
export function captionParens(lines) {
  const cands = lines.map((s) => {
    s = String(s == null ? "" : s);
    const out = [];
    for (let i = s.indexOf(")"); i >= 0; i = s.indexOf(")", i + 1)) {
      if (i > 0 && (s[i - 1] === " " || s[i - 1] === "_") && (i + 1 === s.length || s[i + 1] === " ")) out.push(i);
    }
    return out;
  });
  const res = lines.map(() => null);
  for (let i = 0; i < lines.length;) {
    if (!cands[i].length) { i++; continue; }
    // The longest run from here, for each side this line could be.
    let best = null;
    for (const col of cands[i]) {
      const picks = [];
      for (let j = i; j < lines.length; j++) {
        const near = cands[j].filter((c) => Math.abs(c - col) <= PAREN_SLOP).sort((a, b) => Math.abs(a - col) - Math.abs(b - col))[0];
        if (near == null) break;
        picks.push(near);
      }
      if (!best || picks.length > best.picks.length) best = { col, picks };
    }
    if (best.picks.length < CAPTION_PAREN_MIN) { i++; continue; }
    best.picks.forEach((at, k) => {
      const s = String(lines[i + k]);
      const before = s.slice(0, at).replace(/^\s*\d*\s*/, "");
      res[i + k] = { at, col: best.col, under: /^_+\s*$/.test(before) };
    });
    i += best.picks.length;
  }
  return res;
}

/**
 * A CAPTION'S TWO COLUMNS, EDITED APART. The owner, in chat: "When it
 * recognizes a caption box, it should treat that like a column, and prevent
 * moving of the case no or causes of action from moving the party captions
 * and visa vera". A caption row is one line of the file, so an Enter in the
 * parties pushed the case number and the causes of action down with them, and
 * a party name typed longer pushed the `)` side out of its column. Here the
 * rows of a caption (`sides`, captionParens' reading of the page, the `)` of
 * each row where it now stands) are two columns of slots, as a column box's
 * are (reflowBox): the left one the parties, the foot's underscores no slot of
 * it; the right one the case number and title, down to the foot. An edit in
 * one column moves the text of that column only:
 *
 *   "type"       the row set back with its `)` on the side's column; a cell's
 *                text that outgrows its width (the side; the page's widest
 *                line outside the caption, for the right) wrapped word by word
 *                onto the column's next slot — in front of its text where that
 *                carries on in lower case, else the column moving down a slot
 *                as far as its first empty one.
 *   "enter"      the cell broken at the caret, what follows it a slot of its
 *                own below, the column moving down to make room.
 *   "backspace"  at the head of a cell's text: one space of its indent off
 *                (a left cell's past its margin, a right cell's past the two
 *                after the side), else the cell joined to the column's slot
 *                above, the column below coming up a slot. Nothing on the
 *                column's first slot.
 *   "delete"     at the end of a cell's text: the column's next slot joined
 *                to it, the column below coming up.
 *
 * A column that needs a slot more than the caption has gets a row above the
 * foot — on pleading paper, the empty numbered line under the caption where
 * there is one (the foot moves down onto it), else a line between numbers.
 * Rows whose two cells did not change are left exactly as the file has them.
 * `caret` is { line, col } in `lines`; `typedEmpty`, with "type", that the
 * left cell typed into held nothing before (on pleading paper its spaces are
 * the margin's, so what was typed opens the cell). Returns { lines, caret:
 * { line, col, cell } } (cell 0 the parties, 1 the right), the lines unchanged
 * where the key has nothing to do in the caption (it is still the caption's),
 * or null where the caret is no caption cell's, or a Backspace or Delete is
 * not at a cell's head or end (the browser's own, then).
 */
export const CAPTION_RIGHT_LEAD = 2; // ")  Case No.": the spaces PDF-Linker writes after the side
const CAPTION_RIGHT_MIN = 30; // the right column is never drawn narrower than this
export function captionEdit(lines, sides, i, caret, { op = "type", numbered = false, typedEmpty = false } = {}) {
  const side = sides && sides[i];
  if (!side || !caret) return null;
  const col = side.col;
  let from = i, to = i;
  while (from > 0 && sides[from - 1] && sides[from - 1].col === col) from--;
  while (to + 1 < lines.length && sides[to + 1] && sides[to + 1].col === col) to++;
  const cell = (s) => { const t = s.trim(); return { lead: t ? s.length - s.trimStart().length : 0, t }; };
  const startOf = (s, at) => {
    if (!numbered) return 0;
    const m = /^( ?\d{1,2})(?= |$)/.exec(s);
    return Math.min(m ? m[1].length + 2 : Math.min(4, s.length - s.trimStart().length), at);
  };
  const pos = [];
  for (let k = from; k <= to; k++) {
    const s = String(lines[k]), at = sides[k].at, start = startOf(s, at);
    pos.push({ k, orig: s, at, start, head: s.slice(0, start), left: cell(s.slice(start, at)), right: cell(s.slice(at + 1)), under: !!sides[k].under });
  }
  const feet = pos.filter((p) => p.under);
  if (feet.length > 1 || (feet.length && !pos[pos.length - 1].under)) return null; // no shape this knows
  const foot = feet[0] || null;
  const footLeft = foot ? foot.orig.slice(foot.start, foot.at) : "";
  const leftPos = () => (foot ? pos.slice(0, -1) : pos);
  const cols = [leftPos().map((p) => ({ ...p.left })), pos.map((p) => ({ ...p.right }))];
  // Where the caret is: which column, which slot, how far into its text.
  const here = pos.find((p) => p.k === caret.line);
  if (!here) return null;
  let cur = null;
  if (caret.col <= here.at) {
    if (here === foot) return op === "type" ? null : { lines: lines.slice(), caret: { ...caret, cell: 0 } };
    cur = { j: 0, s: leftPos().indexOf(here), base: here.start, c: here.left };
  } else cur = { j: 1, s: pos.indexOf(here), base: here.at + 1, c: here.right };
  const headAt = cur.base + cur.c.lead;
  // On the right, the spaces before the text are its head too: a Backspace the
  // browser took there would delete the side's `)` before them.
  const atHead = !cur.c.t || caret.col === headAt || (cur.j === 1 && caret.col < headAt);
  const atEnd = !cur.c.t || caret.col >= headAt + cur.c.t.length;
  cur = { j: cur.j, s: cur.s, off: Math.max(0, Math.min(cur.c.t.length, caret.col - headAt)) };
  // Each column's room: the left one up to a space before the side; the right
  // one to the page's widest line outside the caption.
  let widest = 0;
  lines.forEach((l, k) => { if (k < from || k > to) widest = Math.max(widest, String(l).trimEnd().length); });
  const newStart = numbered ? 4 : 0;
  const room = (j, s) => (j === 0 ? col - (leftPos()[s] ? leftPos()[s].start : newStart) - 1 : Math.max(widest, col + 1 + CAPTION_RIGHT_MIN) - col - 1);
  const empty = () => ({ lead: 0, t: "" });
  // `item` in at slot s, the column below moving down as far as its first empty slot.
  const insertAt = (arr, s, item) => {
    let m = s;
    while (m < arr.length && arr[m].t) m++;
    if (m < arr.length) arr.splice(m, 1);
    arr.splice(s, 0, item);
  };
  // Slot s out, the column below coming up as far as its first empty slot.
  const removeAt = (arr, s) => {
    let m = s + 1;
    while (m < arr.length && arr[m].t) m++;
    arr.splice(s, 1);
    arr.splice(m - 1, 0, empty());
  };
  const wrap = (j, s) => {
    const arr = cols[j];
    for (; s < arr.length; s++) {
      const c = arr[s], fit = Math.max(1, room(j, s));
      if (c.lead + c.t.length <= fit) break;
      if (c.lead >= fit) c.lead = 0;
      if (c.lead + c.t.length <= fit) break;
      const w = fit - c.lead;
      let cut = c.t.lastIndexOf(" ", w);
      if (cut <= 0) cut = w;
      const keep = c.t.slice(0, cut).trimEnd(), carry = c.t.slice(cut).trim();
      if (cur.j === j && cur.s === s && cur.off > keep.length) cur = { j, s: s + 1, off: Math.max(0, cur.off - (c.t.length - carry.length)) };
      c.t = keep;
      if (s + 1 >= arr.length) arr.push(empty());
      const nx = arr[s + 1];
      if (nx.t && /^[a-z]/.test(nx.t)) nx.t = carry + " " + nx.t;
      else if (!nx.t) { nx.lead = c.lead; nx.t = carry; }
      else insertAt(arr, s + 1, { lead: c.lead, t: carry });
    }
  };
  const arr = cols[cur.j], c = arr[cur.s];
  const force = new Set(); // positions written whatever their cells say
  if (op === "type") {
    if (cur.j === 0) {
      if (typedEmpty && c.lead + c.t.length > room(0, cur.s)) c.lead = 0;
      force.add(here);
    }
    wrap(cur.j, cur.s);
  } else if (op === "enter") {
    const keep = c.t.slice(0, cur.off).trimEnd(), carry = c.t.slice(cur.off).trim();
    const lead = c.lead;
    c.t = keep;
    if (!keep) c.lead = 0;
    if (cur.s + 1 >= arr.length) arr.push(empty());
    insertAt(arr, cur.s + 1, { lead: carry ? lead : 0, t: carry });
    cur = { j: cur.j, s: cur.s + 1, off: 0 };
    wrap(cur.j, cur.s);
  } else if (op === "backspace") {
    if (!atHead) return null;
    if (c.t && c.lead > (cur.j === 0 ? 0 : CAPTION_RIGHT_LEAD)) { c.lead--; cur.off = 0; }
    else if (cur.s === 0) return { lines: lines.slice(), caret: { ...caret, cell: cur.j } };
    else {
      const up = arr[cur.s - 1];
      const at = up.t.length + (up.t && c.t ? 1 : 0);
      if (!up.t) up.lead = c.lead;
      up.t = up.t && c.t ? up.t + " " + c.t : up.t + c.t;
      removeAt(arr, cur.s);
      cur = { j: cur.j, s: cur.s - 1, off: at };
      wrap(cur.j, cur.s);
    }
  } else if (op === "delete") {
    if (!atEnd) return null;
    if (cur.s + 1 >= arr.length) return { lines: lines.slice(), caret: { ...caret, cell: cur.j } };
    const nx = arr[cur.s + 1];
    const at = c.t.length;
    if (!c.t) c.lead = nx.lead;
    c.t = c.t && nx.t ? c.t + " " + nx.t : c.t + nx.t;
    removeAt(arr, cur.s + 1);
    cur = { j: cur.j, s: cur.s, off: at };
    wrap(cur.j, cur.s);
  } else return null;
  // Slots past the caption's rows that hold nothing are no rows.
  const slotsOf = (j) => (j === 0 ? leftPos().length : pos.length);
  for (const j of [0, 1]) {
    const hold = cur.j === j ? cur.s + 1 : 0; // the caret's slot stays, empty or not
    while (cols[j].length > Math.max(slotsOf(j), hold) && !cols[j][cols[j].length - 1].t) cols[j].pop();
  }
  const out = lines.slice();
  while (cols[0].length > slotsOf(0) || cols[1].length > slotsOf(1)) {
    const last = pos[pos.length - 1];
    const below = last.k + 1;
    const g = numbered && below < out.length ? gutterPrefix(out[below]) : null;
    if (g && !g.rest.trim()) {
      // The empty numbered line under the caption is taken into it: the foot
      // (where there is one) moves down onto it, its place a row.
      const num = g.gutter.match(/^ ?\d{1,2}/)[0];
      pos.push({ k: below, orig: null, at: -1, start: num.length + 2, head: num + "  ", left: empty(), right: empty(), under: false });
    } else {
      // …else a line between: above the foot, or under the caption's last row.
      const at = foot ? pos[pos.length - 1].k : below;
      out.splice(at, 0, "");
      for (const p of pos) if (p.k >= at) p.k++;
      const row = { k: at, orig: null, at: -1, start: newStart, head: " ".repeat(newStart), left: empty(), right: empty(), under: false };
      if (foot) pos.splice(pos.length - 1, 0, row); else pos.push(row);
    }
  }
  const footAt = foot ? pos.length - 1 : -1;
  const lefts = pos.filter((p, q) => q !== footAt);
  for (const j of [0, 1]) while (cols[j].length < slotsOf(j)) cols[j].push(empty());
  // The caret's slot is written even empty, so it has spaces to stand in.
  const caretPos = cur.j === 0 ? lefts[cur.s] : pos[cur.s];
  let caretOut = null;
  pos.forEach((p, q) => {
    const isFoot = q === footAt;
    const L = isFoot ? null : cols[0][lefts.indexOf(p)];
    const R = cols[1][q];
    const same = (a, b) => a.lead === b.lead && a.t === b.t;
    const keep = p.orig != null && !force.has(p) && p.under === isFoot && (isFoot ? p.orig.slice(p.start, p.at) === footLeft : same(L, p.left)) && same(R, p.right)
      && !(p === caretPos && cur.j === 1 && !R.t && !p.right.lead);
    let at, rlead;
    if (keep) { at = p.at; rlead = p.right.lead; }
    else {
      const area = col - p.start;
      const leftStr = isFoot ? footLeft : (" ".repeat(L.lead) + L.t).slice(0, Math.max(0, area - 1)).padEnd(area);
      at = p.start + leftStr.length;
      rlead = R.t ? (R.lead >= 1 ? R.lead : CAPTION_RIGHT_LEAD) : (p === caretPos && cur.j === 1 ? CAPTION_RIGHT_LEAD : 0);
      out[p.k] = p.head + leftStr + ")" + " ".repeat(rlead) + R.t;
    }
    if (p === caretPos) {
      caretOut = cur.j === 0
        ? { line: p.k, col: p.start + (keep ? p.left.lead : L.lead) + cur.off, cell: 0 }
        : { line: p.k, col: at + 1 + rlead + cur.off, cell: 1 };
    }
  });
  return { lines: out, caret: caretOut };
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

// A form's CHECKBOX as PDF-Linker writes it: "[   ]" empty, "[ X ]" ticked,
// "[ ? ]" where the ink could not be read — and, in exports written before
// those, "[ ]", "[X]" and "[?]". The empty one holds three spaces, which is a
// gap between columns (COLUMN_GAP): cut there, the box came out as a "[" at
// the end of one cell and a "]" at the head of the next. A box is one thing
// on the page, so it is one thing here — never cut (columnCuts), and drawn as
// a box (columns.js, dressCheckboxes).
const CHECKBOX_RE = /\[(?: {3}| X | \? |X|\?| )\]/g;
/** What a mark says: "" an empty box, "x" a ticked one, "?" one the run could not read. */
const CHECKBOX_STATE = { "[   ]": "", "[ ]": "", "[ X ]": "x", "[X]": "x", "[ ? ]": "?", "[?]": "?" };
/** A checkbox mark's state, or null where `s` is not one whole mark. */
export function checkboxState(s) {
  return Object.prototype.hasOwnProperty.call(CHECKBOX_STATE, s) ? CHECKBOX_STATE[s] : null;
}
/** Every checkbox mark in a text, in order: [from, to, state] each. */
export function checkboxRanges(text) {
  const s = String(text == null ? "" : text);
  const out = [];
  if (!s.includes("[")) return out;
  CHECKBOX_RE.lastIndex = 0;
  let m;
  while ((m = CHECKBOX_RE.exec(s))) out.push([m.index, m.index + m[0].length, CHECKBOX_STATE[m[0]]]);
  return out;
}

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
 * second column is still a word of the name. A checkbox mark is one of them
 * always (checkboxRanges), whoever asks: the three spaces inside "[   ]" are
 * no gap between columns.
 */
export function columnCuts(text, { stops = null, second = null, start = 0, atoms = null } = {}) {
  const s = String(text == null ? "" : text);
  const cuts = [];
  const first = s.search(/\S/);
  if (first < 0) return cuts;
  const begun = (col) => (!stops ? 0 : stops instanceof Map ? stops.get(col) || 0 : stops.has(col) ? 2 : 0);
  const boxes = checkboxRanges(s);
  const whole = boxes.length ? (atoms || []).concat(boxes) : atoms;
  const within = (i) => !!whole && whole.some(([a, b]) => i > a && i < b);
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

// ---- column boxes on a ✓ Use my text page -------------------------------------
//
// The owner, in chat: "Add the ability for me to insert column boxes when using
// use my text. That way I can insulate the formatting changes for the causes of
// action from the parties on a cover page." A box is written as PDF-Linker
// writes a form's (box-drawing rules: ┌─┬─┐ over, │ between, └─┴─┘ under), so
// ⇄ Raw and the model reading the file see the column, and the reader draws it
// ruled (rules.js). Typing in one column never moves another: a cell's text
// that outgrows its width wraps, word by word, onto the next row of the same
// column (a row is added at the box's foot where there is none).

const BOX_JOINTS = "┌┬┐├┼┤└┴┘│";
/** Where a line's box rules stand: the offsets of its │ and joints, or [] for none. */
export function boxBars(line) {
  const out = [];
  const s = String(line || "");
  for (let i = 0; i < s.length; i++) if (BOX_JOINTS.includes(s[i])) out.push(i);
  return out;
}
/** Whether a line is a row of a box's text: two │ or more, nothing ruled across. */
export function isBoxRow(line) {
  const s = String(line || "");
  return (s.match(/│/g) || []).length >= 2 && !/[─┌┐└┘├┤┬┴┼]/.test(s);
}
/** Whether a line is a box's rule: ─ and its joints, nothing else but spaces and a margin number. */
export function isBoxRule(line) {
  const s = String(line || "").replace(/^( ?\d{1,2})?\s*/, "");
  return /^[─┌┐└┘├┤┬┴┼│]+$/.test(s.trimEnd()) && s.includes("─");
}
/** The box line `i` stands in: { from, to } (its rule lines too), or null. */
export function boxAround(lines, i) {
  const inBox = (k) => k >= 0 && k < lines.length && (isBoxRow(lines[k]) || isBoxRule(lines[k]));
  if (!isBoxRow(lines[i])) return null;
  let from = i, to = i;
  while (inBox(from - 1)) from--;
  while (inBox(to + 1)) to++;
  return { from, to };
}

/**
 * Make lines `from`…`to` a two-column box, the divider at `col` (an offset in
 * the line, a margin number and its spaces counted): each line's text left of
 * it (moved back to the start of a word it would cut) the left cell, the rest
 * the right; a rule over and under. On a numbered page (`numbered`) each line
 * keeps its number, and the rules are lines between numbers, written with four
 * spaces where a number stands (as PDF-Linker writes a half line). `across`,
 * the page's widest line past its margin number: the box is drawn that wide.
 * Returns the page's new lines and `{ first, last }`, the box's rows among them.
 */
export function makeColumnBox(lines, from, to, col, { numbered = false, across = 0 } = {}) {
  const rows = [];
  for (let k = from; k <= to; k++) {
    const s = String(lines[k] || "");
    const g = numbered ? gutterPrefix(s) : null;
    const lead = g ? String(parseInt(g.gutter, 10)).padStart(2) + "  " : numbered ? "    " : "";
    const body = g ? s.slice(g.gutter.length) : numbered ? s.replace(/^ {0,4}/, "") : s;
    const shift = g ? g.gutter.length : numbered ? s.length - body.length : 0;
    let cut = Math.max(0, col - shift);
    while (cut > 0 && cut < body.length && /\S/.test(body[cut - 1]) && /\S/.test(body[cut])) cut--;
    rows.push({ lead, left: body.slice(0, cut).trim(), right: body.slice(cut).trim() });
  }
  const wl = Math.max(Math.max(0, col - 4), ...rows.map((r) => r.left.length)) + 2;
  // The box across the page's text (`across`, its widest line past the margin
  // number), so the right column is not drawn only as wide as what it holds.
  const wr = Math.max(12 + 2, ...rows.map((r) => r.right.length + 2), across - wl - 3);
  const pad = numbered ? "    " : "";
  const out = lines.slice(0, from);
  out.push(pad + "┌" + "─".repeat(wl) + "┬" + "─".repeat(wr) + "┐");
  const first = out.length;
  for (const r of rows) out.push(r.lead + "│" + (" " + r.left).padEnd(wl) + "│" + (" " + r.right).padEnd(wr) + "│");
  const last = out.length - 1;
  out.push(pad + "└" + "─".repeat(wl) + "┴" + "─".repeat(wr) + "┘");
  return { lines: out.concat(lines.slice(to + 1)), first, last };
}

/**
 * A box row typed in, set back on its box's rules: every cell its text at the
 * box's widths, and a cell's text that runs past its width wrapped, word by
 * word, onto the next row of the same column. Where that row carries on the
 * text (it opens in lower case) the words go in front of it and it wraps in
 * turn; else (an item of its own — "2. Fraud") the column's rows from there
 * move down one, as far as its first empty row (a row added at the box's foot
 * where there is none — four spaces where a number stands, on a numbered
 * page). Nothing in any other column moves. `caret` is { line, col } in the
 * row typed in (null for none). With `breakAt` (Enter in a cell) the cell is
 * broken at the caret, what follows it a line of its own in the column below.
 * Returns { lines, caret } or null where the row is not one the box's rules
 * can be read for.
 */
export function reflowBox(lines, i, caret = null, { numbered = false, breakAt = false } = {}) {
  const box = boxAround(lines, i);
  if (!box) return null;
  // The box's columns: off a rule (its joints), else another row of it.
  const own = boxBars(lines[i]);
  let rule = null;
  for (let k = box.from; k <= box.to && !rule; k++) if (k !== i && isBoxRule(lines[k]) && boxBars(lines[k]).length === own.length) rule = boxBars(lines[k]);
  for (let k = box.from; k <= box.to && !rule; k++) if (k !== i && isBoxRow(lines[k]) && boxBars(lines[k]).length === own.length) rule = boxBars(lines[k]);
  if (!rule) return null;
  const n = own.length - 1; // cells a row
  const width = (j) => rule[j + 1] - rule[j] - 1;
  const room = (j) => Math.max(1, width(j) - 2);
  const out = lines.slice();
  // The box's rows, top to bottom, and each one's cells' text.
  const rows = [];
  for (let k = box.from; k <= box.to; k++) if (isBoxRow(out[k]) && boxBars(out[k]).length === own.length) rows.push(k);
  const text = new Map(rows.map((k) => {
    const b = boxBars(out[k]);
    return [k, b.slice(0, -1).map((x, j) => out[k].slice(x + 1, b[j + 1]).trim())];
  }));
  const touched = new Set([i]);
  // The caret: which cell, and how far into its text.
  let at = null;
  if (caret && caret.line === i) {
    for (let j = 0; j < n; j++) {
      if (caret.col > own[j] && caret.col <= own[j + 1]) {
        const cell = lines[i].slice(own[j] + 1, own[j + 1]);
        const lead = cell.length - cell.replace(/^ +/, "").length;
        at = { row: i, j, off: Math.max(0, Math.min(text.get(i)[j].length, caret.col - own[j] - 1 - lead)) };
      }
    }
  }
  const addRow = () => {
    const last = rows[rows.length - 1];
    // On pleading paper the box grows over the empty numbered line under its
    // foot rule, where there is one, rather than a line between two numbers.
    const foot = last + 1;
    if (numbered && foot < out.length && isBoxRule(out[foot]) && foot + 1 < out.length) {
      const g = gutterPrefix(out[foot + 1]);
      if (g && !g.rest.trim()) {
        const row = String(parseInt(g.gutter, 10)).padStart(2) + "  ";
        const made = row.padEnd(rule[0]).slice(0, rule[0]) + "│" + Array.from({ length: n }, (_, j) => " ".repeat(width(j))).join("│") + "│";
        out[foot + 1] = out[foot];
        out[foot] = made;
        rows.push(foot);
        text.set(foot, Array.from({ length: n }, () => ""));
        return foot;
      }
    }
    const lead = numbered ? "    " : " ".repeat(rule[0]);
    out.splice(last + 1, 0, lead + "│" + Array.from({ length: n }, (_, j) => " ".repeat(width(j))).join("│") + "│");
    // Rows below it in the box move down a line with it.
    for (let r = 0; r < rows.length; r++) if (rows[r] > last) rows[r]++;
    const moved = new Map();
    for (const [k, v] of text) moved.set(k > last ? k + 1 : k, v);
    text.clear();
    for (const [k, v] of moved) text.set(k, v);
    rows.push(last + 1);
    text.set(last + 1, Array.from({ length: n }, () => ""));
    if (at && at.row > last) at.row++;
    return last + 1;
  };
  if (breakAt && !at) return null;
  for (let j = 0; j < n; j++) {
    let r = rows.indexOf(i);
    let force = breakAt && at.j === j;
    for (;;) {
      const k = rows[r];
      const t = text.get(k)[j];
      if (!force && t.length <= room(j)) break;
      let cut = force ? at.off : t.lastIndexOf(" ", room(j));
      if (!force && cut <= 0) cut = room(j);
      const keep = t.slice(0, cut).trimEnd(), carry = t.slice(cut).trim();
      text.get(k)[j] = keep;
      touched.add(k);
      if (at && at.row === k && at.j === j && (force || at.off > keep.length)) at = { row: null, j, off: force ? 0 : Math.max(0, at.off - (t.length - carry.length)) };
      if (r + 1 >= rows.length) addRow();
      const next = rows[r + 1];
      const nt = text.get(next)[j];
      const broke = force;
      force = false;
      if (!broke && nt && /^[a-z]/.test(nt)) text.get(next)[j] = carry + " " + nt;
      else if (!nt) text.get(next)[j] = carry;
      else {
        // An item of its own: the column moves down a row to make room.
        let m = r + 1;
        while (m < rows.length && text.get(rows[m])[j]) m++;
        if (m >= rows.length) { addRow(); m = rows.length - 1; }
        for (let q = m; q > r + 1; q--) { text.get(rows[q])[j] = text.get(rows[q - 1])[j]; touched.add(rows[q]); }
        text.get(next)[j] = carry;
      }
      touched.add(next);
      if (at && at.row === null) at.row = next;
      r++;
    }
  }
  for (const k of touched) {
    const b = boxBars(out[k]);
    const lead = out[k].slice(0, b[0]);
    const head = lead.length === rule[0] ? lead : lead.slice(0, rule[0]).padEnd(rule[0]);
    out[k] = head + text.get(k).map((t, j) => "│" + (" " + t).padEnd(width(j))).join("") + "│" + out[k].slice(b[b.length - 1] + 1);
  }
  return { lines: out, caret: at && at.row != null ? { line: at.row, col: rule[at.j] + 2 + at.off } : null };
}

/**
 * Backspace at the head of a box cell's text: the cell's text joined to the
 * end of the same column's text on the row above (wrapped on from there as
 * typing would be), never to the line above across the box — and nothing at
 * all on the box's first row. A row left empty in every cell that is no line
 * of the paper (an unnumbered row) goes. `col` is the caret's column in row
 * `i`. Returns { lines, caret } or null where this is no head of a box cell.
 */
export function boxBackspace(lines, i, col, { numbered = false } = {}) {
  const box = boxAround(lines, i);
  if (!box) return null;
  const own = boxBars(lines[i]);
  let j = -1, lead = 0;
  for (let q = 0; q < own.length - 1; q++) {
    const cell = lines[i].slice(own[q] + 1, own[q + 1]);
    lead = cell.length - cell.replace(/^ +/, "").length;
    if (col > own[q] && col <= own[q + 1]) { j = q; if (col - own[q] - 1 > lead) return null; break; }
  }
  if (j < 0) return null;
  let p = i - 1;
  while (p >= box.from && !isBoxRow(lines[p])) p--;
  if (p < box.from) return { lines: lines.slice(), caret: { line: i, col } }; // the first row: nothing above to join to
  const out = lines.slice();
  const pb = boxBars(out[p]), ib = boxBars(out[i]);
  const above = out[p].slice(pb[j] + 1, pb[j + 1]).trim();
  const mine = out[i].slice(ib[j] + 1, ib[j + 1]).trim();
  const joined = above && mine ? above + " " + mine : above + mine;
  const put = (s, bars, t) => s.slice(0, bars[j] + 1) + (" " + t).padEnd(bars[j + 1] - bars[j] - 1) + s.slice(bars[j + 1]);
  out[p] = put(out[p], pb, joined);
  // The column's rows below come up one, as far as its first empty row — as
  // Enter sent them down.
  const rows = [];
  for (let k = i; k <= box.to; k++) if (isBoxRow(out[k]) && boxBars(out[k]).length === ib.length) rows.push(k);
  const cell = (k) => { const b = boxBars(out[k]); return out[k].slice(b[j] + 1, b[j + 1]).trim(); };
  for (let q = 0; q < rows.length; q++) {
    const next = q + 1 < rows.length ? cell(rows[q + 1]) : "";
    out[rows[q]] = put(out[rows[q]], boxBars(out[rows[q]]), next);
    if (!next) break;
  }
  const caretCol = pb[j] + 2 + above.length + (above && mine ? 1 : 0);
  // A row of nothing that is no numbered line of the paper goes.
  const empty = ib.slice(0, -1).every((b, q) => !out[i].slice(b + 1, ib[q + 1]).trim());
  if (empty && !(numbered && gutterPrefix(out[i]))) out.splice(i, 1);
  // The joined text set back on the box's widths, wrapping on down the column.
  // (Off the row as it stood: a join longer than the cell has moved the
  // bars of the one `put` wrote.)
  const temp = out[p];
  out[p] = lines[p].slice(0, pb[j] + 1) + (" " + joined) + lines[p].slice(pb[j + 1]);
  const res = reflowBox(out, p, { line: p, col: caretCol }, { numbered });
  if (!res) { out[p] = temp; return { lines: out, caret: { line: p, col: caretCol } }; }
  return { lines: res.lines, caret: res.caret || { line: p, col: caretCol } };
}

// ---- a box with no rule down its outer sides --------------------------------
//
// PDF-Linker writes a table the page rules only BETWEEN its columns (the
// commonest table a filing prints: its rules across, and between its columns,
// nothing down its outer edges) as rule lines that start and end in a `─`, and
// rows with a `│` between each two columns and none at either end. Its first
// column is the text before the first `│`, its last the text after the last.
// The owner, of such a table: "the column lines should not be broken by
// backspace, and backspace should move only the text in that column up a
// line. Likewise, enter should only move text in that column down." So the
// box's edits are made on it CLOSED — a `│` put at each open side, where its
// rules end — and the sides taken back off after (boxEdit).

/** The open sides of the box line `i` stands in: { from, to, left, right } (`left`/`right` the columns a closing `│` goes at, null where that side is ruled), or null. */
export function openBoxAround(lines, i) {
  const s = String(lines[i] || "");
  if (!s.includes("│") || /[─┌┐└┘├┤┬┴┼]/.test(s)) return null;
  const bars = boxBars(s);
  const sameBars = (k) => { const b = boxBars(lines[k]); return b.length === bars.length && b.every((x, q) => x === bars[q]); };
  const part = (k) => k >= 0 && k < lines.length && (isBoxRule(lines[k]) || (!/[─┌┐└┘├┤┬┴┼]/.test(lines[k]) && sameBars(k)));
  let from = i, to = i;
  while (part(from - 1)) from--;
  while (part(to + 1)) to++;
  let rule = null;
  for (let k = from; k <= to && !rule; k++) if (isBoxRule(lines[k])) rule = String(lines[k]);
  if (!rule) return null;
  const a = rule.search(/[─┌┐└┘├┤┬┴┼│]/), z = rule.trimEnd().length - 1;
  const left = rule[a] === "─" ? a : null, right = rule[z] === "─" ? z + 1 : null;
  if (left == null && right == null) return null;
  // Every joint of the rule a bar of the rows, as rows of one box have.
  const joints = boxBars(rule).filter((x) => x > a && x < z);
  if (joints.length !== bars.length || !joints.every((x, q) => x === bars[q])) return null;
  return { from, to, left, right };
}
/**
 * The box's lines with its open sides closed: a `│` at each (openBoxAround),
 * the right one past the longest row's text, so no column's text is wrapped
 * for it, and a rule run on to it in `─`. `rules` gets each closed rule line
 * and the line it was, so openBox can put it back as it stood.
 */
function closeBox(lines, box, rules) {
  const out = lines.slice();
  let end = box.right;
  if (end != null) for (let k = box.from; k <= box.to; k++) if (!isBoxRule(lines[k])) end = Math.max(end, String(lines[k]).trimEnd().length + 1);
  const at = end != null ? end + (box.left != null ? 1 : 0) : null;
  for (let k = box.from; k <= box.to; k++) {
    const was = String(out[k]), rule = isBoxRule(was);
    let s = was;
    if (box.left != null) s = s.padEnd(box.left).slice(0, box.left) + "│" + s.slice(box.left);
    if (at != null) { const t = s.trimEnd(); s = t.padEnd(at, rule ? "─" : " ") + "│"; }
    if (rule) rules.set(s, was);
    out[k] = s;
  }
  return out;
}
/**
 * …and taken back off: the box's lines as they now run, from its first line
 * on (a row Enter added, a foot rule moved under it), its rules as they stood
 * and its rows without their closing `│`s.
 */
function openBox(lines, box, rules, bars) {
  const out = lines.slice();
  for (let k = box.from; k < out.length; k++) {
    const s = String(out[k]);
    if (rules.has(s)) { out[k] = rules.get(s); continue; }
    if (!isBoxRow(s) || boxBars(s).length !== bars) break;
    let t = s;
    if (box.right != null) { t = t.trimEnd(); if (t.endsWith("│")) t = t.slice(0, -1); }
    if (box.left != null && t[box.left] === "│") t = t.slice(0, box.left) + t.slice(box.left + 1);
    out[k] = t.trimEnd();
  }
  return out;
}

/**
 * A key in a box's row, kept in its column: Enter breaks the cell at the
 * caret and sends the rest of that column down a row (reflowBox, `breakAt`),
 * Backspace at a cell's head joins it to the same column's row above and
 * brings the rest of the column up (boxBackspace), and Delete never takes a
 * `│`, nor reaches past the row's last cell. A box ruled on every side or
 * only between its columns alike (openBoxAround). `typed`: a row just typed
 * in, set back on the box's rules (reflowBox). `col` is the caret's column in
 * row `i`. Returns { lines, caret } — the page's lines and the caret's
 * { line, col } in them (lines unchanged where the key does nothing there) —
 * or null where line `i` is no box row, or the key is the page's own (a
 * Backspace inside a cell's text).
 */
export function boxEdit(lines, i, col, key, { numbered = false } = {}) {
  const open = openBoxAround(lines, i);
  const rules = new Map();
  const work = open ? closeBox(lines, open, rules) : lines;
  const shift = open && open.left != null && col >= open.left ? 1 : 0;
  const c = col + shift;
  if (!isBoxRow(work[i])) return null;
  let res;
  if (key === "Delete") {
    const s = work[i], bars = boxBars(s);
    // Never a rule, nor past the last cell's text into the row under it.
    if (BOX_JOINTS.includes(s[c] || "") || c >= bars[bars.length - 1] || !s.slice(c, bars.find((b) => b >= c)).trim()) res = { lines: work.slice(), caret: { line: i, col: c } };
    else return null;
  } else if (key === "Enter") res = reflowBox(work, i, { line: i, col: c }, { numbered, breakAt: true });
  else if (key === "Backspace") res = boxBackspace(work, i, c, { numbered });
  else if (key === "typed") res = reflowBox(work, i, { line: i, col: c }, { numbered });
  if (!res) return null;
  if (!open) return res;
  const back = openBox(res.lines, open, rules, boxBars(work[i]).length);
  const caret = res.caret ? { line: res.caret.line, col: Math.max(0, res.caret.col - (open.left != null && res.caret.col > open.left ? 1 : 0)) } : null;
  return { lines: back, caret };
}

/**
 * A column box's rule `j` (0 the left edge, 1 the first divider, …, the last
 * the right edge) moved to column `col` of the line: a divider moves between
 * its two columns, the right edge widens or narrows the last. Every rule line
 * of the box is drawn again at the new places and every row set on them, a
 * cell's text that no longer fits wrapped onto its column's next rows
 * (reflowBox). The owner, in chat: the columns "are not adjustable". `i` is
 * any row of the box. Returns the page's lines, or null where the box's rules
 * cannot be read or `j` is its left edge.
 */
export const BOX_MIN = 6; // the narrowest a column is drawn, its two spaces of margin counted
export function resizeBox(lines, i, j, col, { numbered = false } = {}) {
  const box = boxAround(lines, i);
  if (!box || j < 1) return null;
  let rule = null;
  for (let k = box.from; k <= box.to && !rule; k++) if (isBoxRule(lines[k])) rule = boxBars(lines[k]);
  if (!rule || j >= rule.length) return null;
  const lo = rule[j - 1] + BOX_MIN + 1;
  const hi = j + 1 < rule.length ? rule[j + 1] - BOX_MIN - 1 : Infinity;
  const at = Math.max(lo, Math.min(hi, Math.round(col)));
  if (at === rule[j]) return lines.slice();
  const bars = rule.slice();
  bars[j] = at;
  const n = bars.length - 1;
  const width = (q) => bars[q + 1] - bars[q] - 1;
  let out = lines.slice();
  for (let k = box.from; k <= box.to; k++) {
    const s = out[k];
    const b = boxBars(s);
    if (b.length !== bars.length) continue;
    const head = s.slice(0, b[0]);
    if (isBoxRule(s)) {
      out[k] = head + bars.slice(0, -1).map((x, q) => s[b[q]] + "─".repeat(width(q))).join("") + s[b[n]];
    } else if (isBoxRow(s)) {
      const cells = b.slice(0, -1).map((x, q) => s.slice(x + 1, b[q + 1]).trim());
      out[k] = head + cells.map((t, q) => "│" + (" " + t).padEnd(width(q))).join("") + "│";
    }
  }
  // Each row whose text the new widths no longer hold, wrapped down its column.
  for (let k = box.from; k < out.length; k++) {
    const around = boxAround(out, k);
    if (!around && !isBoxRule(out[k])) { if (k > box.from) break; continue; }
    if (!isBoxRow(out[k])) continue;
    const res = reflowBox(out, k, null, { numbered });
    if (res) out = res.lines;
  }
  return out;
}
