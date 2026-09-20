// leaks.js
//
// PDF-Linker's LEAKS.xlsx — the leak-triage worksheet — as the text reader
// reads and answers it. Pure (no DOM), tested from Node in test-leaks.mjs;
// text-reader.js is the wiring around it.
//
// The worksheet is one sheet named LEAKS, a header row, then one row per
// flagged VALUE: what it is, the Fix? cell the operator answers, the
// sentence it stands in (Context: the document's own on top, then a rule,
// then the export's), which File(s), what Type of finding, Where (page:line)
// and Notes. PDF-Linker reads it back by HEADER NAME (`_pn_parse_decision_rows`)
// and takes the Fix? cell as typed, so everything here is header-driven too,
// and a decision is the cell's exact text.
//
// The control words are PDF-Linker's own (`_pn_parse_decision_rows`), and
// classifyFix mirrors that reader's branches in its order so the bar says
// what the cell will MEAN to the pass that applies it:
//   yes / no / never / phrase          the words, as they are
//   ~OTHER VALUE                       a misspelling of that value (= accepted)
//                                      — and where the SHEET arrived carrying
//                                      one, it is PDF-Linker's proposal, which
//                                      the review stops on like an empty cell
//                                      until the operator accepts it
//   *CORRECT TEXT  /  **CORRECT TEXT   a scan error of it (** in every folder)
//   [part] / {part}                    keep that part, fake the rest
//   (part)                             the phrase inside the value
//   anything else                      the exact replacement to write
// A row's decision is stored on the row as `fix` beside the sheet's own
// `fix0`, so what changed — and only that — is written back (fixEdits).

import { normalizeStem, fakedStem, looseStem, looseIndex } from "./pdfsync.js";

export const LEAKS_SHEET = "LEAKS";
export const LEAKS_FILE = "LEAKS.xlsx";
// PDF-Linker still READS the older name (`_PN_LEAK_LEGACY_STEMS`); so does the reader.
const NAME_RE = /^(leaks|pdf_linker_leaks)(?: ?\(\d+\)| - copy)?\.xlsx$/i;
/** The worksheet by name, Windows' copies included. */
export function isLeaksName(name) {
  return NAME_RE.test(String(name == null ? "" : name).split(/[\\/]/).pop().trim());
}
/** Lower ranks first: the current name over the legacy one. */
export function leaksRank(name) {
  return /^leaks/i.test(String(name == null ? "" : name).split(/[\\/]/).pop().trim()) ? 0 : 1;
}

export function fold(s) {
  return String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();
}

// ---- reading the sheet --------------------------------------------------------

const HEADS = {
  value: (h) => h === "value",
  fix: (h) => h.startsWith("fix?"),
  context: (h) => h === "context",
  // "File", and the spellings a sheet reaches it under: losing this column
  // silently is expensive — every row then names no document, so the review
  // stops walking document by document and the reader looks for each value in
  // whatever happens to be open.
  file: (h) => h === "file" || h === "files" || h === "file(s)" || h === "file name",
  type: (h) => h === "type",
  where: (h) => h.startsWith("where"),
  notes: (h) => h === "notes",
};

/** The header row's index in `rows`, or -1: the first row with Value and Fix? cells. */
export function headerIndex(rows) {
  const n = Math.min((rows || []).length, 12);
  for (let i = 0; i < n; i++) {
    const heads = (rows[i] || []).map(fold);
    if (heads.some(HEADS.value) && heads.some(HEADS.fix)) return i;
  }
  return -1;
}
export function sheetsLookLikeLeaks(sheets) {
  return (sheets || []).some((s) => headerIndex(s && s.rows) >= 0);
}
/** The LEAKS sheet: the one so named (PDF-Linker's rule), else the first that reads as one. */
export function leaksSheet(sheets) {
  const all = (sheets || []).filter((s) => headerIndex(s && s.rows) >= 0);
  return all.find((s) => fold(s.name) === fold(LEAKS_SHEET)) || all[0] || null;
}

/**
 * The worksheet as rows: { name, sheet, part, cols, rows }. Each row is
 * { n (its 1-based row in the sheet), value, fix, fix0, context, file,
 * type, where, notes }, `fix` the live decision and `fix0` what the sheet
 * holds. A row with no value is skipped, as PDF-Linker skips it.
 */
export function parseLeaks(sheets, name) {
  const sheet = leaksSheet(sheets);
  if (!sheet) throw new Error((name || "The workbook") + ' has no "Value" / "Fix?" header — not a LEAKS worksheet.');
  const rows = sheet.rows || [];
  const hi = headerIndex(rows);
  const heads = (rows[hi] || []).map(fold);
  const cols = {};
  for (const k of Object.keys(HEADS)) cols[k] = heads.findIndex(HEADS[k]);
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const at = (k) => (cols[k] >= 0 && row[cols[k]] != null ? String(row[cols[k]]) : "");
    const value = at("value");
    if (!value.trim()) continue;
    const fix = at("fix");
    out.push({
      n: i + 1, value, fix, fix0: fix, ok: false,
      context: at("context"), file: at("file"), type: at("type"), where: at("where"), notes: at("notes"),
    });
  }
  return { name: name || "", sheet: sheet.name, part: sheet.part || null, cols, rows: out };
}

// ---- what a Fix? cell means -----------------------------------------------------

// Excel's own error text is never an instruction (`_PN_XL_ERROR_VALUES`).
const ERROR_VALUES = new Set(["#n/a", "#ref!", "#name?", "#value!", "#div/0!", "#num!", "#null!"]);
export const CONTROLS = ["yes", "no", "never", "phrase"];

const KEEP_PART_RE = /\[([^\]]*)\]|\{([^}]*)\}/g;
const PHRASE_PART_RE = /\(([^)]*)\)/g;
function keepParts(s) {
  const out = [];
  let m;
  KEEP_PART_RE.lastIndex = 0;
  while ((m = KEEP_PART_RE.exec(s))) out.push((m[1] != null ? m[1] : m[2]).trim());
  return out;
}
function onlyGroups(s, re) {
  return s.replace(re, "").trim() === "" && s.replace(re, "") !== s;
}
function partsFit(value, parts) {
  const v = fold(value);
  return parts.length > 0 && parts.every((p) => p && v.includes(fold(p)));
}

/**
 * What the cell will mean to PDF-Linker: { kind, label, canon, parts }.
 * `kind` is one of "", yes, no, never, phrase, phrase-part, alias, ocr,
 * keep, replacement, error; `label` is the sentence the bar shows.
 */
export function classifyFix(cell, value) {
  const raw = String(cell == null ? "" : cell).trim();
  const low = raw.toLowerCase();
  if (!raw) return { kind: "", label: "Undecided" };
  if (ERROR_VALUES.has(low)) return { kind: "error", label: "Excel error text — read as undecided" };
  if (low === "yes" || low === "y") return { kind: "yes", label: "yes — fake it (auto)" };
  if (low === "no" || low === "n") return { kind: "no", label: "no — leave it, in this case" };
  if (low === "never") return { kind: "never", label: "never — leave it, in every case" };
  if (low === "phrase") return { kind: "phrase", label: "phrase — fake it whole, kept words too" };
  if (onlyGroups(raw, PHRASE_PART_RE)) {
    const parts = [];
    let m;
    PHRASE_PART_RE.lastIndex = 0;
    while ((m = PHRASE_PART_RE.exec(raw))) parts.push(m[1].trim());
    if (partsFit(value, parts)) return { kind: "phrase-part", label: "phrase — fake “" + parts.join("”, “") + "” whole", parts };
    return { kind: "replacement", label: "replace with “" + raw + "” (the part is not in the value)" };
  }
  if (raw[0] === "*") {
    const durable = raw.startsWith("**");
    const rest = raw.replace(/^\*+/, "").trim();
    const parts = keepParts(rest);
    const canon = rest.replace(KEEP_PART_RE, "").trim();
    if (parts.length) {
      if (!partsFit(value, parts)) return { kind: "replacement", label: "replace with “" + raw + "” (the kept part is not in the value)" };
      return { kind: "ocr", label: "scan error of “" + canon + "”, keeping “" + parts.join("”, “") + "”" + (durable ? " — every folder" : ""), canon, parts, durable };
    }
    if (!canon) return { kind: "replacement", label: "replace with “" + raw + "”" };
    return { kind: "ocr", label: "scan error of “" + canon + "”" + (durable ? " — remembered in every folder" : ""), canon, durable };
  }
  if (raw[0] === "~" || raw[0] === "=") {
    const rest = raw.slice(1).trim();
    const parts = keepParts(rest);
    const canon = rest.replace(KEEP_PART_RE, "").trim();
    if (parts.length && !partsFit(value, parts)) return { kind: "replacement", label: "replace with “" + raw + "” (the kept part is not in the value)" };
    if (!canon) return { kind: "replacement", label: "replace with “" + raw + "”" };
    return { kind: "alias", label: "a misspelling of “" + canon + "”" + (parts.length ? ", keeping “" + parts.join("”, “") + "”" : ""), canon, parts };
  }
  const parts = keepParts(raw);
  if (parts.length && onlyGroups(raw, KEEP_PART_RE)) {
    if (partsFit(value, parts)) {
      const whole = parts.some((p) => fold(p) === fold(value));
      return { kind: "keep", label: whole ? "keep the whole value" : "keep “" + parts.join("”, “") + "”, fake the rest", parts };
    }
    return { kind: "replacement", label: "replace with “" + raw + "” (the kept part is not in the value)" };
  }
  return { kind: "replacement", label: "replace with “" + raw + "”" };
}

/** Whether a decision is a KEEP the reader should mirror (a bound value left as it stands). */
export function isKeepKind(kind) {
  return kind === "no" || kind === "never";
}

// ---- the master workbook: the keeps PDF-Linker carries between cases -------------
//
// Beside each case's own LEAKS.xlsx, PDF-Linker keeps ONE workbook across every
// matter (`_pn_master_path`), holding two sheets:
//
//   "KEEP"         the durable decisions — a value marked "leave it alone", or a
//                  bracketed keep-spec — re-applied on every future run in any
//                  folder. Headers: Value, "Fix? (yes/no)", Type, Times Seen,
//                  Cases, First Seen, Last Seen, Notes, Origin.
//   "Master Leaks" the tally of GENUINE leaks seen across matters. The opposite
//                  list, and not read here: it has no Fix? column, so the header
//                  rule below passes over it of its own accord.
//
// The reader wants the KEEP sheet for one reason: a value the operator has
// already said to leave alone is not a leak, and flagging it again in every new
// case is the reader crying wolf at its own settled decisions.
export const MASTER_KEEP_SHEET = "KEEP";
export const MASTER_TALLY_SHEET = "Master Leaks";
const MASTER_NAME_RE = /^(master[ _]leaks|master)(?: ?\(\d+\)| - copy)?\.xlsx$/i;
/** The master workbook by name, Windows' copies included. */
export function isMasterName(name) {
  return MASTER_NAME_RE.test(String(name == null ? "" : name).split(/[\\/]/).pop().trim());
}
/** Its KEEP sheet, or null — by name, and only where it reads as a decision sheet. */
export function masterKeepSheet(sheets) {
  return (sheets || []).find((sh) => fold(sh && sh.name) === fold(MASTER_KEEP_SHEET) && headerIndex(sh && sh.rows) >= 0) || null;
}
export function sheetsLookLikeMaster(sheets) {
  return !!masterKeepSheet(sheets);
}
/**
 * The master workbook's standing keeps: { name, sheet, keeps, partial, rows }.
 * `keeps` are the values to leave alone WHEREVER they stand — [{ value,
 * control, note, cases }].
 *
 * Only a keep of the WHOLE value is taken. A bracketed spec that keeps part of
 * a value ("[David] W. Slayton") says that part stands inside that value, not
 * that the part stands everywhere; applying it as a value would stop the reader
 * flagging the same word in a name it knows nothing about. Those rows are
 * counted in `partial` and reported rather than applied.
 */
export function parseMasterKeeps(sheets, name) {
  const sheet = masterKeepSheet(sheets);
  if (!sheet) {
    throw new Error((name || "The workbook") + ' has no "KEEP" sheet with a Value / Fix? header — not PDF-Linker\'s master workbook.');
  }
  const parsed = parseLeaks([sheet], name);
  const keeps = [];
  const partial = [];
  for (const row of parsed.rows) {
    const c = classifyFix(row.fix, row.value);
    if (isKeepKind(c.kind)) {
      keeps.push({ value: row.value, control: c.kind === "never" ? "never" : "no", note: row.notes });
    } else if (c.kind === "keep") {
      const whole = (c.parts || []).some((part) => fold(part) === fold(row.value));
      if (whole) keeps.push({ value: row.value, control: "no", note: row.notes });
      else partial.push({ value: row.value, parts: c.parts || [] });
    }
  }
  return { name: name || "", sheet: sheet.name, keeps, partial, rows: parsed.rows.length };
}

// ---- the locating columns ------------------------------------------------------------

const WHERE_RE = /^p\.(\d+)(?:\s*\(printed p\.\s*([^)]*)\))?(?::(\d+)(?:-(?:p\.\d+:)?(\d+))?)?$/i;
const LINE_RE = /^line (\d+)(?:-(\d+))?$/i;
/**
 * The Where cell's locations, in order: [{ page, printed, line, lineEnd }] —
 * `page` the export's PDF page (null for a Word body's "line N"), `line`
 * the gutter number (null where the page carries none). Sentinels and the
 * trailing "…" yield nothing.
 */
export function parseWhere(cell) {
  const out = [];
  for (const tok of String(cell == null ? "" : cell).split(/,\s*/)) {
    const t = tok.trim().replace(/\s*…$/, "");
    if (!t) continue;
    let m = t.match(WHERE_RE);
    if (m) {
      out.push({ page: parseInt(m[1], 10), printed: m[2] ? m[2].trim() : null, line: m[3] ? parseInt(m[3], 10) : null, lineEnd: m[4] ? parseInt(m[4], 10) : null });
      continue;
    }
    m = t.match(LINE_RE);
    if (m) out.push({ page: null, printed: null, line: parseInt(m[1], 10), lineEnd: m[2] ? parseInt(m[2], 10) : null });
  }
  return out;
}

/** The File cell's names: [] for "—", "(decided)", "N files" or an empty cell. */
export function parseFiles(cell) {
  const s = String(cell == null ? "" : cell).trim();
  if (!s || s === "—" || s === "-" || /^\d+ files?$/i.test(s)) return [];
  return s.split(/,\s*/).map((x) => x.trim()).filter(Boolean);
}

// The seam PDF-Linker stacks the two quotes on (`_PN_CONTEXT_RULE`).
export const CONTEXT_RULE = "———— EXPORT ————";
/** The Context cell's two halves: { original, exported } (exported "" where they were the same). */
export function splitContext(cell) {
  const text = String(cell == null ? "" : cell);
  const at = text.indexOf("\n" + CONTEXT_RULE + "\n");
  if (at < 0) return { original: text, exported: "" };
  return { original: text.slice(0, at), exported: text.slice(at + CONTEXT_RULE.length + 2) };
}

/**
 * The export a File cell's name belongs to — the reverse of pdfsync's
 * matchPdf: the PDF (or Word file) keeps its real name, the export is that
 * stem run forward through the key. Returns the export name, or null.
 */
export function matchExport(fileName, exportNames, forward) {
  if (!fileName) return null;
  // The one-off form of exportMatcher, and literally it: asking the same
  // question two ways is how the two come to answer it differently — one
  // export at a time cannot see that a second answers to the same loose stem,
  // and would return the first rather than declining an ambiguous name.
  return exportMatcher(exportNames, forward)(fileName);
}

/**
 * `matchExport` for MANY lookups against the SAME list of exports — the
 * worksheet's rows, which name a handful of documents between thousands of
 * them. matchExport walks the whole list and runs the key forward over the
 * File name once per export on the way; here the exports are indexed by stem
 * once, the key is run forward over each File name once, and the answer is
 * two map lookups. Same answer, the first export in the list still winning.
 */
export function exportMatcher(exportNames, forward) {
  const list = (exportNames || []).slice();
  const at = new Map(); // an export's stem → its place in the list
  list.forEach((e, i) => { const s = normalizeStem(e); if (s && !at.has(s)) at.set(s, i); });
  // …and the stems with their punctuation taken out, for the File cell whose
  // name differs from its export's in nothing else. A LEAKS row names the
  // PDF — "Payee Supp. Decl. ISO Pet..pdf", a stem ending in an abbreviation's
  // own full stop — and the export beside it is "…ISO Pet.txt", one dot
  // short. Under the exact stem the row's document is simply not in the
  // folder, and the review falls back to reading whatever is open: the row is
  // then reported missing from a document it never named. Asked only after
  // the exact stems, and only where ONE export answers (looseIndex).
  const loose = looseIndex([...at.entries()]);
  const memo = new Map();
  return (fileName) => {
    if (!fileName) return null;
    if (memo.has(fileName)) return memo.get(fileName);
    let best = -1;
    for (const s of [normalizeStem(fileName), fakedStem(fileName, forward)]) {
      if (s && at.has(s) && (best < 0 || at.get(s) < best)) best = at.get(s);
    }
    if (best < 0) {
      const i = loose.get(looseStem(fileName));
      if (i != null) best = i;
    }
    const hit = best >= 0 ? list[best] : null;
    memo.set(fileName, hit);
    return hit;
  };
}

// ---- working the rows ----------------------------------------------------------------

/**
 * A row PDF-LINKER ANSWERED FOR THE OPERATOR, still standing as it wrote it:
 * the sheet arrived with a `~value` in its Fix? cell (its own reading that
 * this value is a misspelling of that one; `=` is read the same way), and the
 * operator has neither changed it nor accepted it.
 *
 * That is a proposal, not a decision. It is usually right, which is why it is
 * pre-filled, and when it is wrong it is wrong in the way that matters most —
 * "~Martin" over a real "Marin" writes a real name into the file as though it
 * had been checked. So the review stops on it exactly as it stops on an empty
 * cell; what it must never do is go past unseen. Accepting it is a decision
 * the reader remembers (there is nothing to write: the cell already says it).
 */
export function isSuggested(row) {
  if (!row || row.ok) return false;
  const own = String(row.fix0 == null ? "" : row.fix0).trim();
  if (own[0] !== "~" && own[0] !== "=") return false;
  return fold(row.fix) === fold(own);
}
/** Whether a row is still the review's business: nothing typed, or a suggestion not yet accepted. */
export function isPending(row) {
  return !fold(row && row.fix) || isSuggested(row);
}
export function undecidedCount(rows) {
  return (rows || []).filter(isPending).length;
}

// ---- the walk: ONE DOCUMENT AT A TIME -------------------------------------------------
//
// A row stands in a document — its File cell — and answering it means reading
// that document. A case folder of three hundred exports is three hundred
// documents, and a walk that took the rows in sheet order would hop from one
// to the next and back again, with the reader holding every document it had
// passed through: that is what takes the tab down.
//
// So the walk is a DOCUMENT AT A TIME. Every row standing in the document in
// front is reached before any row of the next one, undecided rows first; the
// documents come in the order the rows first name them, those with something
// left to answer before those with nothing. The reader then has to hold only
// the document in front, and reads the next one when this one is answered
// (text-reader.js).
//
// A row's document is the FIRST name in its File cell — the one the reader
// opens for it — even where the same value leaked into several: the row is one
// decision, made once, and it is made there. A row naming no file (or a tally,
// "12 files") stands in "": whatever document is open when the walk reaches it.
//
// Within a document the rows are taken in the order they STAND in it, by the
// page and line of their Where cell, not in the order the worksheet lists
// them — see walkOrder.

/** The document a row stands in: the first name in its File cell, "" where it names none. */
export function rowFile(row) {
  const files = parseFiles(row && row.file);
  return files.length ? files[0] : "";
}

/**
 * Where a row stands in its document: its FIRST location, the page and then
 * the line, for putting the rows of one document in the order a reader meets
 * them. A Word body's "line N" has no page and sorts on the line alone; a row
 * whose Where names no place at all — a sentinel, a tally, an empty cell —
 * has none, and goes after the rows that do.
 */
export function rowPlace(row) {
  for (const l of parseWhere(row && row.where)) {
    if (l.page == null && l.line == null) continue;
    return { page: l.page == null ? Infinity : l.page, line: l.line == null ? Infinity : l.line };
  }
  return null;
}
/**
 * Every row in the order the review WALKS them: document by document, and
 * inside a document in the order the rows stand IN it.
 *
 * PDF-Linker writes one row per VALUE, so the sheet's own order is the order
 * the values were first found — which sends a reader to page 4, then page 31,
 * then back to page 9, for no reason that means anything on the page. Down
 * the document instead: the review reads a page and finishes with it.
 *
 * Kept per list, because the order is asked for on every repaint and does not
 * move: a decision changes what a row SAYS, never where it stands. The list
 * is replaced whenever the worksheet is, so its identity is the whole test.
 */
let walkMemo = { rows: null, order: [] };
export function walkOrder(rows) {
  const all = rows || [];
  if (walkMemo.rows === all) return walkMemo.order;
  // One place per row, read once: a comparison that parsed the Where cell
  // would parse it a few thousand times over a worksheet of any size.
  const place = all.map((r, i) => {
    const p = rowPlace(r);
    return p ? [0, p.page, p.line, i] : [1, 0, 0, i];
  });
  const byFile = new Map();
  const files = [];
  all.forEach((r, i) => {
    const f = fold(rowFile(r));
    if (!byFile.has(f)) { byFile.set(f, []); files.push(f); }
    byFile.get(f).push(i);
  });
  const out = [];
  for (const f of files) {
    const list = byFile.get(f);
    list.sort((a, b) => {
      const ka = place[a], kb = place[b];
      for (let k = 0; k < 4; k++) if (ka[k] !== kb[k]) return ka[k] - kb[k];
      return 0;
    });
    out.push(...list);
  }
  walkMemo = { rows: all, order: out };
  return out;
}
/** The next row along the walk from `at` (`dir` < 0 for the one before), wrapping. */
export function stepFrom(rows, at, dir) {
  const walk = walkOrder(rows);
  if (!walk.length) return -1;
  const k = walk.indexOf(at);
  if (k < 0) return walk[0];
  const n = walk.length;
  return walk[(((k + (dir < 0 ? -1 : 1)) % n) + n) % n];
}
/**
 * The rows in the order the review will reach them, as indices into `rows`:
 * the row in front, then the rest of ITS document from where that row stands,
 * down the document and round to it, then the next document, and so on.
 */
export function reviewOrder(rows, from) {
  const all = rows || [];
  const n = all.length;
  if (!n) return [];
  const start = Number.isInteger(from) && from >= 0 && from < n ? from : 0;
  // The documents in the order the walk reaches them FROM the row in front,
  // and each one's rows in the order they stand in it.
  const byFile = new Map();
  const files = [];
  const home = fold(rowFile(all[start]));
  files.push(home);
  byFile.set(home, []);
  for (let k = 0; k < n; k++) {
    const f = fold(rowFile(all[(start + k) % n]));
    if (!byFile.has(f)) { byFile.set(f, []); files.push(f); }
  }
  for (const i of walkOrder(all)) {
    const b = byFile.get(fold(rowFile(all[i])));
    if (b) b.push(i);
  }
  // The document in front first, then those with rows still to answer, then
  // the rest — each in the order the walk first names it.
  const pending = (f) => byFile.get(f).some((i) => isPending(all[i]));
  const order = [home]
    .concat(files.filter((f) => f !== home && pending(f)))
    .concat(files.filter((f) => f !== home && !pending(f)));
  // The row in front is where the operator is standing, decided or not, and
  // the rest of its document follows it down the page and wraps to the top.
  const hr = byFile.get(home);
  const at = Math.max(0, hr.indexOf(start));
  const out = [];
  for (let k = 0; k < hr.length; k++) out.push(hr[(at + k) % hr.length]);
  for (const f of order.slice(1)) out.push(...byFile.get(f));
  return out;
}

/**
 * The documents the review will visit, in that order — each under the
 * spelling its first row gives it; "" is the open document.
 */
export function leakFileOrder(rows, from) {
  const all = rows || [];
  const out = [];
  const seen = new Set();
  for (const i of reviewOrder(all, from)) {
    const file = rowFile(all[i]);
    const k = fold(file);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(file);
  }
  return out;
}

/** Whether every row standing in `file` has been answered. */
export function fileDone(rows, file) {
  const k = fold(file);
  return !(rows || []).some((r) => fold(rowFile(r)) === k && isPending(r));
}

/** The next undecided row from `from` (exclusive), in walk order; -1 when none. */
export function nextUndecided(rows, from, dir) {
  const all = rows || [];
  if (!all.length) return -1;
  const here = Number.isInteger(from) && from >= 0 && from < all.length ? from : null;
  const order = reviewOrder(all, here == null ? 0 : here);
  const rest = order.slice(1);
  if (dir < 0) rest.reverse();
  // From a row in front the walk goes past it and round to it; from nowhere
  // (no row in front yet) the first row of the walk counts too.
  for (const i of here == null ? [order[0], ...rest] : [...rest, order[0]]) {
    if (isPending(all[i])) return i;
  }
  return -1;
}

/** The cell edits a save writes: only the rows whose decision moved. */
export function fixEdits(parsed) {
  const col = parsed && parsed.cols ? parsed.cols.fix : -1;
  if (col < 0) return [];
  return (parsed.rows || []).filter((r) => r.fix !== r.fix0).map((r) => ({ row: r.n, col, text: r.fix }));
}

/** Where unsaved decisions are remembered between reloads. */
export function decisionsKey(folder, name) {
  return "textReader.leaks." + (folder || "") + "/" + (name || "");
}
/**
 * { rowNumber: { base, fix } } for the rows that moved, and { base, ok: true }
 * for a suggestion accepted as it stands — `base` the sheet's own cell then.
 * An accepted suggestion writes nothing to the workbook (the cell already
 * carries it) and so is remembered HERE or nowhere; a save does not clear it.
 */
export function packDecisions(rows) {
  const out = {};
  for (const r of rows || []) {
    if (r.fix !== r.fix0) out[r.n] = { base: r.fix0, fix: r.fix };
    else if (r.ok) out[r.n] = { base: r.fix0, ok: true };
  }
  return out;
}
/** Remembered decisions laid back over the rows — only where the sheet's cell is still what it was. */
export function unpackDecisions(rows, stored) {
  let n = 0;
  for (const r of rows || []) {
    const s = stored && stored[r.n];
    if (!s || s.base !== r.fix0) continue;
    if (typeof s.fix === "string" && s.fix !== r.fix0) { r.fix = s.fix; n++; }
    else if (s.ok) { r.ok = true; n++; }
  }
  return n;
}

// ---- the pages the worksheet points at -------------------------------------------------
//
// Answering a row means standing on the page it names, so the pages a review
// will reach are all written down in the rows before it gets to any of them.
// The reader reads them off ahead of time (text-reader.js warms them), and
// wants them in the order the review will ACTUALLY reach them — which is the
// walk above: the row in front of the operator, the rest of its document,
// then the next document's.

/**
 * Every page the rows name, in that visit order: [{ file, page }] — `file`
 * the File cell's name ("" where the row names none: the open document),
 * `page` the export's PDF page, null for a row that names a file but no
 * page of it (a Word body's "line N"). Each file-and-page once. A row
 * naming several files gives its pages to each, the way the row itself
 * stands for a value found in each.
 *
 * `files`, where given, is the documents the reader is willing to hold — the
 * one in front, and the next once that one is answered. Pages of any other
 * document are left out, so a folder too big to hold at once is never asked
 * for at once. A page named by no file is the open document's and always kept.
 */
export function leakPages(rows, from, files) {
  const all = rows || [];
  const only = files == null ? null : new Set((files || []).map(fold));
  const out = [];
  const seen = new Set();
  for (const i of reviewOrder(all, from)) {
    const row = all[i];
    const pages = parseWhere(row.where).filter((w) => w.page != null).map((w) => w.page);
    const named = parseFiles(row.file);
    for (const file of named.length ? named : [""]) {
      if (only && file && !only.has(fold(file))) continue;
      for (const page of pages.length ? pages : [null]) {
        const k = fold(file) + "|" + (page == null ? "" : page);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ file, page });
      }
    }
  }
  return out;
}
