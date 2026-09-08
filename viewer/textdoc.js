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
//   formatValuesFile / parseValuesFile / addValue   the New Real Values.txt
//       list: names the operator flagged as unfaked, handed to PDF-Linker
//       for its next pass over the folder.
//   isExportName / isKeyName   which files in a case folder are documents.
//   FONT_PRESETS / DEFAULT_SETTINGS   the reading settings.

import { caseShape, applyCase } from "./pseudo-key.js";

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
// an older engine), so both are read as line breaks too.

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const BLOCKS = new Set(["DIV", "P", "LI"]);

function walk(node, emit, opts) {
  const fakes = !!(opts && opts.fakes);
  const rec = (n, atStart) => {
    if (n.nodeType === TEXT_NODE) {
      emit(n.data != null ? n.data : n.nodeValue || "");
      return;
    }
    if (n.nodeType !== ELEMENT_NODE) return;
    const name = String(n.nodeName || "").toUpperCase();
    if (name === "BR") {
      emit("\n");
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
function foldKey(s) {
  return String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();
}
// The fake in the matched text's own case, possessive carried — exactly what
// pseudo-key's forwardRuns writes, so the span made while typing and the
// text a save writes cannot differ.
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
  "# Apply Leak Fixes) and pseudonymizes each value as if it had been given",
  "# with --term. A line 'no: VALUE' is the opposite — a value the run faked",
  "# that should be left as it is in this case (a cited decision's name); a",
  "# line 'never: VALUE' keeps it in every case. Lines beginning with # are",
  "# ignored. Delete a line to withdraw it.",
];

// A keep line: `no: VALUE` (this case) or `never: VALUE` (every case).
export const KEEP_RE = /^(no|never)\s*:\s*(.+?)\s*$/i;
export const KEEP_CONTROLS = ["no", "never"];

/** A keep entry as the list holds it: { control, value }. */
export function makeKeep(control, value) {
  const c = String(control || "no").toLowerCase();
  return { control: KEEP_CONTROLS.includes(c) ? c : "no", value: normalizeValue(value) };
}
/** Add a keep, or change the control of one already held (its spelling kept). */
export function addKeep(keeps, control, value) {
  const k = makeKeep(control, value);
  if (!k.value) return (keeps || []).slice();
  const have = (keeps || []).find((x) => foldKey(x.value) === foldKey(k.value));
  const out = (keeps || []).filter((x) => foldKey(x.value) !== foldKey(k.value));
  out.push(have ? { control: k.control, value: have.value } : k);
  return out;
}
export function removeKeep(keeps, value) {
  const k = foldKey(value);
  return (keeps || []).filter((x) => foldKey(x.value) !== k);
}
export function keptControl(keeps, value) {
  const k = foldKey(value);
  const hit = (keeps || []).find((x) => foldKey(x.value) === k);
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

export function formatValuesFile(values, keeps) {
  const body = (values || []).map(normalizeValue).filter(Boolean);
  const kept = (keeps || []).map((k) => makeKeep(k.control, k.value)).filter((k) => k.value).map((k) => `${k.control}: ${k.value}`);
  return VALUES_HEAD.concat(body, kept).join("\n") + "\n";
}

/** The file's values to fake, in order (the keeps are parseReaderFile's). */
export function parseValuesFile(text) {
  return parseReaderFile(text).values;
}

/** Both halves of the file: { values, keeps }. */
export function parseReaderFile(text) {
  const values = [];
  const keeps = [];
  const seen = new Set();
  for (const raw of String(text == null ? "" : text).split(/\r?\n/)) {
    const line = raw.replace(/^\ufeff/, "").trim();
    if (!line || line[0] === "#") continue;
    const m = line.match(KEEP_RE);
    const v = normalizeValue(m ? m[2] : line);
    if (!v || seen.has(foldKey(v))) continue;
    seen.add(foldKey(v));
    if (m) keeps.push(makeKeep(m[1], v));
    else values.push(v);
  }
  return { values, keeps };
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
export function isKeyName(name) {
  return /^pseudonym[ _-]?key.*\.xlsx$/i.test(String(name == null ? "" : name).split(/[\\/]/).pop().trim());
}

// The folder PDF-Linker writes the exports to, and the one holding the
// unscrubbed copies (never listed as documents: it carries the real names).
export const TEXT_SUBFOLDER = "Text Files";
export const ORIGINAL_SUBFOLDER_RE = /^original text/i;

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

export const DEFAULT_SETTINGS = {
  font: "georgia",
  customFont: "",
  fontSize: 15,      // px
  lineHeight: 1.5,   // ratio
  pageWidth: 820,    // px
  marks: true,       // highlight pseudonyms and show the fake on hover
  markColor: "#f5c518", // the highlight's colour
  markAlpha: 0.18,   // …and how strong it is (0 = invisible, 1 = solid); subtle by default
  showFakes: false,  // display the fakes instead of the real names
  gutter: true,      // dim the pleading line numbers
  lineLock: false,   // keep every numbered line on ONE screen line (below)
};

/** A settings object with every field valid, from whatever was stored. */
export function normalizeSettings(raw) {
  const s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
  if (!FONT_PRESETS.some((f) => f.id === s.font)) s.font = DEFAULT_SETTINGS.font;
  s.customFont = String(s.customFont || "").slice(0, 200);
  s.fontSize = clamp(Number(s.fontSize), 9, 40, DEFAULT_SETTINGS.fontSize);
  s.lineHeight = clamp(Number(s.lineHeight), 1, 3, DEFAULT_SETTINGS.lineHeight);
  s.pageWidth = clamp(Number(s.pageWidth), 400, 2000, DEFAULT_SETTINGS.pageWidth);
  s.marks = s.marks !== false;
  s.markColor = /^#[0-9a-fA-F]{6}$/.test(String(s.markColor || "")) ? String(s.markColor).toLowerCase() : DEFAULT_SETTINGS.markColor;
  s.markAlpha = clamp(Number(s.markAlpha), 0.04, 0.9, DEFAULT_SETTINGS.markAlpha);
  s.showFakes = s.showFakes === true;
  s.gutter = s.gutter !== false;
  s.lineLock = s.lineLock === true;
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
