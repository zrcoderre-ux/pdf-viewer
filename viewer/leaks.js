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
//   *CORRECT TEXT  /  **CORRECT TEXT   a scan error of it (** in every folder)
//   [part] / {part}                    keep that part, fake the rest
//   (part)                             the phrase inside the value
//   anything else                      the exact replacement to write
// A row's decision is stored on the row as `fix` beside the sheet's own
// `fix0`, so what changed — and only that — is written back (fixEdits).

import { matchPdf } from "./pdfsync.js";

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
  file: (h) => h === "file",
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
      n: i + 1, value, fix, fix0: fix,
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
  for (const e of exportNames || []) if (matchPdf(e, [fileName], forward)) return e;
  return null;
}

// ---- working the rows ----------------------------------------------------------------

export function undecidedCount(rows) {
  return (rows || []).filter((r) => !fold(r.fix)).length;
}
/** The next undecided row from `from` (exclusive), wrapping; -1 when none. */
export function nextUndecided(rows, from, dir) {
  const n = (rows || []).length;
  if (!n) return -1;
  const step = dir < 0 ? -1 : 1;
  for (let k = 1; k <= n; k++) {
    const i = (((from == null ? -1 : from) + step * k) % n + n) % n;
    if (!fold(rows[i].fix)) return i;
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
/** { rowNumber: { base, fix } } for the rows that moved — `base` the sheet's own cell then. */
export function packDecisions(rows) {
  const out = {};
  for (const r of rows || []) if (r.fix !== r.fix0) out[r.n] = { base: r.fix0, fix: r.fix };
  return out;
}
/** Remembered decisions laid back over the rows — only where the sheet's cell is still what it was. */
export function unpackDecisions(rows, stored) {
  let n = 0;
  for (const r of rows || []) {
    const s = stored && stored[r.n];
    if (s && typeof s.fix === "string" && s.base === r.fix0 && s.fix !== r.fix0) { r.fix = s.fix; n++; }
  }
  return n;
}
