// The hearings sheet kept up to date from eCourt's calendar (pwa/app-web.js,
// "Home: the calendar"). The owner (2026-11-19): "is there a way to automate
// that process [copying the agenda into my Excel sheet]? Ideally in a way that
// can update automatically if a new case is moved or taken off calendar (but
// notifies me, it should never do that silently)" … "I also want it to add to
// the sheet, for that I want to go 10 days forward." … "The excel is currently
// open all day, but with these changes I won't need to have it open all the
// time."
//
// E-Court Suite's hourly refresh reads the next ten court days' agendas into
// the rows its Copy All would copy, and asks a case's Hearings tab why a
// hearing it saw has left its day; its native host writes that into the
// briefing file as `calendar` (hearing-sheet.js, parseBriefingFile). Here,
// pure (bytes and objects in, bytes and objects out; tested in node by
// test-calendar-sync.mjs):
//
//   planCalendar   what the sheet lacks or no longer matches, day by day: a
//                  hearing to ADD; a row to mark OFF calendar (the Hearings tab
//                  says vacated, taken off, or continued — the case is not
//                  heard that day); a row HELD for the owner (gone from the
//                  agenda, and the Hearings tab does not say why).
//   addCalendarRows the rows written into the sheet as the owner's paste lays
//                  them out, learned from the sheet itself (sheetLayout).
//   removeCalendarRow Undo of an add.
//
// Never silently: Home lists every change it made, with Undo, and a day E-Court
// could not read (failed, signed out) changes nothing.

import { zipEntries, readEntry, parseSharedStrings, colIndex } from "./xlsx-read.js";
import { replaceParts, colLetters, escapeXmlText } from "./xlsx-write.js";
import { readHearings, parseSheetCells, parseRels, relsPartOf, attrOf, caseNumbersIn, nameWords, dateToSerial, textToDate, isWebLink } from "./hearing-sheet.js";

// ---- days and cases -----------------------------------------------------------

/** Local midnight of "YYYY-MM-DD", or 0. */
export function dayAt(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : 0;
}
/** "YYYY-MM-DD" of a time. */
export function isoOf(at) {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** eCourt's case id in a case page link (?id=…), or "". */
export function caseIdOfUrl(url) {
  const m = /[?&]id=(\d+)/.exec(String(url || ""));
  return m ? m[1] : "";
}
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** One case as the calendar and the sheet each say it: { id, number, text }. */
function caseOf(x) {
  if (x.caseName !== undefined) {
    // A sheet row.
    return { id: caseIdOfUrl(x.url), number: x.caseNumber || "", text: x.caseName || "" };
  }
  return { id: x.caseId || caseIdOfUrl(x.url), number: x.caseNumber || caseNumbersIn(x.caseText)[0] || "", text: x.caseText || "" };
}

/**
 * Whether two cases are one: by eCourt's id where both have it, else the case
 * number where both have one, else the name (the same words, or every word of
 * the shorter in the longer, two at least).
 */
export function sameCase(a, b) {
  const x = caseOf(a), y = caseOf(b);
  if (x.id && y.id) return x.id === y.id;
  if (x.number && y.number) return x.number.toUpperCase() === y.number.toUpperCase();
  if (norm(x.text) && norm(x.text) === norm(y.text)) return true;
  const wa = nameWords(x.text), wb = nameWords(y.text);
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return short.length >= 2 && short.every((w) => long.includes(w));
}

/** The key a change is known by, across looks: "YYYY-MM-DD|<id or number or name>". */
export function changeKey(day, x) {
  const c = caseOf(x);
  return `${day}|${c.id ? "id:" + c.id : c.number ? "no:" + c.number.toUpperCase() : "nm:" + norm(c.text)}`;
}

// ---- the plan -------------------------------------------------------------------

/**
 * What the sheet needs from the calendar: { adds, offs, held, days }.
 *
 *   hearings  readHearings' rows (all of them, every mark).
 *   calendar  the file's `calendar` ({ days: [{ day, state, rows, at }], gone }).
 *   log       Home's record of changes already made or decided ([{ key, kind }]):
 *             a key added once is never added again (removed from the sheet by
 *             hand, or undone, it stays out); one marked off, kept, or undone
 *             is never marked again.
 *
 * Only days from today on that E-Court read (state "ok", or "empty": a day
 * with no agenda table) are looked at. For each: an agenda row with no row of
 * its case on that day in the sheet is an ADD; an unmarked sheet row of that
 * day whose case is not on the day's agenda is an OFF where E-Court's `gone`
 * says off or moved, else HELD (the owner decides). Marked rows (done, off)
 * are left alone.
 */
export function planCalendar({ hearings = [], calendar = null, log = [], now = Date.now() } = {}) {
  const out = { adds: [], offs: [], held: [], days: [] };
  if (!calendar || !Array.isArray(calendar.days)) return out;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const did = new Map();
  for (const e of log || []) if (e && e.key) { if (!did.has(e.key)) did.set(e.key, new Set()); did.get(e.key).add(e.kind); }
  const done = (key, ...kinds) => kinds.some((k) => did.has(key) && did.get(key).has(k));
  const gone = Array.isArray(calendar.gone) ? calendar.gone : [];
  for (const d of calendar.days) {
    const at = dayAt(d && d.day);
    if (!at || at < today.getTime()) continue;
    if (d.state !== "ok" && d.state !== "empty") continue;
    out.days.push(d.day);
    const rows = Array.isArray(d.rows) ? d.rows : [];
    const sheetRows = hearings.filter((h) => h.date === at);
    const used = new Set();
    for (const r of rows) {
      const hit = sheetRows.find((h) => !used.has(h) && sameCase(h, r));
      if (hit) { used.add(hit); continue; }
      const key = changeKey(d.day, r);
      if (done(key, "added")) continue;
      // Two rows of one case the same day (two times) are one key; added once.
      if (out.adds.some((a) => a.key === key)) continue;
      out.adds.push({ key, day: d.day, at, motion: String(r.motion || ""), caseText: String(r.caseText || ""), url: String(r.url || ""), caseId: r.caseId || "", caseNumber: r.caseNumber || "" });
    }
    for (const h of sheetRows) {
      if (used.has(h) || h.mark) continue;
      if (rows.some((r) => sameCase(h, r))) continue;
      const key = changeKey(d.day, h);
      if (done(key, "off", "kept")) continue;
      const g = gone.find((x) => x && x.day === d.day && sameCase(h, x));
      const item = { key, day: d.day, at, hg: h, reason: g ? g.reason : "unknown", status: g ? String(g.status || "") : "", newDay: g ? String(g.newDay || "") : "" };
      if (g && (g.reason === "off" || g.reason === "moved")) out.offs.push(item);
      else if (!done(key, "held")) out.held.push(item);
      else out.held.push({ ...item, seen: true });
    }
  }
  // The owner (2026-11-20): "Let's also add detection for when the hearing
  // date has moved". E-Court checks every hearing the sheet holds on its
  // case's Hearings tab (Home writes them: sheetHearingsList), so `gone` also
  // says off or moved for a day it did not read (past the ten court days, or
  // unread this run): the sheet's row of that day is marked off the same way.
  for (const g of gone) {
    if (!g || (g.reason !== "off" && g.reason !== "moved") || out.days.includes(g.day)) continue;
    const at = dayAt(g.day);
    if (!at || at < today.getTime()) continue;
    const h = hearings.find((x) => x.date === at && !x.mark && sameCase(x, g));
    if (!h) continue;
    const key = changeKey(g.day, h);
    if (done(key, "off", "kept") || out.offs.some((o) => o.key === key)) continue;
    out.offs.push({ key, day: g.day, at, hg: h, reason: g.reason, status: String(g.status || ""), newDay: String(g.newDay || "") });
  }
  // A hearing moved is written under its new day at once, however far out,
  // where the sheet has no row of its case that day; a new day E-Court read
  // is left to its agenda (the add above), which lists it.
  for (const o of out.offs) {
    if (o.reason !== "moved" || !o.newDay || out.days.includes(o.newDay)) continue;
    const at = dayAt(o.newDay);
    if (!at || at < today.getTime()) continue;
    if (hearings.some((x) => x.date === at && sameCase(x, o.hg))) continue;
    const g = gone.find((x) => x && x.day === o.day && sameCase(o.hg, x)) || {};
    const row = { caseText: o.hg.caseName || g.caseText || "", caseId: g.caseId || caseIdOfUrl(o.hg.url), caseNumber: o.hg.caseNumber || g.caseNumber || "", url: o.hg.url || g.url || "" };
    const key = changeKey(o.newDay, row);
    if (done(key, "added") || out.adds.some((a) => a.key === key)) continue;
    out.adds.push({ key, day: o.newDay, at, motion: String(o.hg.motion || g.motion || ""), caseText: String(row.caseText), url: String(row.url), caseId: row.caseId, caseNumber: row.caseNumber, movedFrom: o.day });
  }
  return out;
}

/**
 * The hearings Home hands E-Court Suite to check on each case's Hearings tab
 * ("PDF+ Hearings Sheet.json" in Downloads; its refresh/run.js): every
 * unmarked hearing from today on whose case id is known (its link, or one
 * filled in: `ecourtUrl`), one per case and day.
 */
export const SHEET_HEARINGS_FILE = "PDF+ Hearings Sheet.json";
export function sheetHearingsList(hearings, now = Date.now()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const out = [], seen = new Set();
  for (const h of hearings || []) {
    if (!h || h.mark || !h.date || h.date < today.getTime()) continue;
    const caseId = caseIdOfUrl(h.url) || caseIdOfUrl(h.ecourtUrl);
    if (!caseId) continue;
    const day = isoOf(h.date);
    if (seen.has(day + "|" + caseId)) continue;
    seen.add(day + "|" + caseId);
    out.push({ day, caseId, caseNumber: h.caseNumber || "", caseText: h.caseName || "", motion: h.motion || "", url: isWebLink(h.url) ? h.url : h.ecourtUrl || "" });
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) || a.caseId.localeCompare(b.caseId));
}

// ---- the sheet's layout -----------------------------------------------------------

/**
 * How the owner's paste lays a day out, read off the sheet (the latest day
 * with hearings): { part, cols, mode, gapWithin, gapBetween, tpl: { hearing,
 * heading, blank } (row numbers), sheet }.
 *   mode  "heading": the date on a row of its own above the day's cases;
 *         "first":   the date in the first case's Date cell, the rest blank;
 *         "every":   the date in every case's Date cell.
 *   gapWithin   blank rows between two cases of a day (Copy All leaves one);
 *   gapBetween  blank rows between one day's last case and the next day.
 * null where the sheet has no dated hearing to learn from.
 */
export function sheetLayout(hearings, cells, sheetName) {
  const hs = hearings.filter((h) => h.sheet === sheetName && h.date).sort((a, b) => a.row - b.row);
  if (!hs.length) return null;
  const hasValue = (r) => { for (let c = 0; c < 40; c++) { const x = cells.get(`${r - 1},${c}`); if (x && String(x.v).trim() !== "") return true; } return false; };
  const cols = hs[0].cols;
  const latest = Math.max(...hs.map((h) => h.date));
  const group = hs.filter((h) => h.date === latest);
  const first = group[0];
  // A date row of its own above the day's first case, blank rows aside.
  let heading = 0;
  for (let r = first.row - 1; r > 1; r--) {
    if (!hasValue(r)) continue;
    const dc = cells.get(`${r - 1},${cols.date}`), nc = cells.get(`${r - 1},${cols.caseName}`);
    if (dc && String(dc.v).trim() !== "" && !(nc && String(nc.v).trim() !== "")) heading = r;
    break;
  }
  const ownDate = (h) => { const x = cells.get(`${h.row - 1},${cols.date}`); return !!(x && String(x.v).trim() !== ""); };
  const mode = heading ? "heading" : group.length > 1 && group.every(ownDate) ? "every" : "first";
  // The gaps, from the sheet's own spacing: the most common between two
  // cases of one day, and between two days.
  const commonest = (list, dflt) => {
    if (!list.length) return dflt;
    const n = new Map();
    for (const g of list) n.set(g, (n.get(g) || 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  };
  const within = [], between = [];
  for (let i = 1; i < hs.length; i++) {
    const a = hs[i - 1], b = hs[i];
    let blanks = 0;
    for (let r = a.row + 1; r < b.row; r++) if (!hasValue(r)) blanks++;
    if (a.date === b.date) within.push(blanks);
    else {
      // Between days: the blank rows above the next day's start (its date row, where it has one).
      let start = b.row;
      if (mode === "heading") for (let r = b.row - 1; r > a.row; r--) if (hasValue(r)) { start = r; break; }
      let k = 0;
      for (let r = a.row + 1; r < start; r++) if (!hasValue(r)) k++;
      between.push(k);
    }
  }
  const gapWithin = commonest(within, 1);
  const gapBetween = commonest(between, gapWithin);
  // The rows to copy the look of: an unmarked case of the latest day (any
  // day, failing that), the date row, a blank row between two cases.
  const unmarked = [...group].reverse().find((h) => !h.mark) || [...hs].reverse().find((h) => !h.mark) || group[group.length - 1];
  let blank = 0;
  for (let r = unmarked.row + 1; r <= unmarked.row + 3; r++) if (!hasValue(r)) { blank = r; break; }
  return { part: first.part, cols, sheet: sheetName, mode, gapWithin, gapBetween, tpl: { hearing: unmarked.row, heading, blank }, templateMarked: !!unmarked.mark };
}

// ---- rows in the sheet's XML ---------------------------------------------------------

const ROW_RE = /<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g;
const CELL_RE = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
const rowNumOf = (attrs, seq) => { const n = parseInt(attrOf(attrs, "r") || "", 10); return Number.isFinite(n) ? n : seq; };

/** The <row> elements: [{ n, attrs, inner, start, end }] in order. */
function rowsOf(xml) {
  const out = [];
  const sd = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml);
  if (!sd) return out;
  const base = sd.index + sd[0].indexOf(">") + 1;
  let m, seq = 0;
  ROW_RE.lastIndex = 0;
  while ((m = ROW_RE.exec(sd[1]))) {
    seq++;
    const n = rowNumOf(m[1], seq);
    seq = n;
    out.push({ n, attrs: m[1], inner: m[3] || "", start: base + m.index, end: base + m.index + m[0].length });
  }
  return out;
}

/** A1-style token shifted for rows inserted at `at` (n > 0) or row `at` deleted (n = -1); null where it named only that row. */
export function shiftRef(token, at, n) {
  const t = String(token || "");
  const one = /^(\$?[A-Z]{0,3})(\$?)(\d+)$/;
  const parts = t.split(":");
  if (parts.length > 2) return t;
  const rowOf = (p) => { const m = one.exec(p); return m ? +m[3] : null; };
  const setRow = (p, r) => { const m = one.exec(p); return m[1] + m[2] + r; };
  if (parts.length === 1) {
    const r = rowOf(t);
    if (r == null) return t;
    if (n > 0) return r >= at ? setRow(t, r + n) : t;
    if (r === at) return null;
    return r > at ? setRow(t, r - 1) : t;
  }
  const [a, b] = parts;
  const ra = rowOf(a), rb = rowOf(b);
  if (ra == null || rb == null) return t; // whole columns ("A:A")
  if (n > 0) return `${ra >= at ? setRow(a, ra + n) : a}:${rb >= at ? setRow(b, rb + n) : b}`;
  if (ra === at && rb === at) return null;
  const na = ra > at ? ra - 1 : ra, nb = rb >= at ? rb - 1 : rb;
  return `${setRow(a, na)}:${setRow(b, Math.max(na, nb))}`;
}
const shiftList = (v, at, n) => v.split(/\s+/).filter(Boolean).map((x) => shiftRef(x, at, n)).filter(Boolean).join(" ");

/**
 * Why rows cannot be put in, or taken out of, the sheet at row `at` (what is
 * under it would need moving that PDF+ does not move), or "".
 */
export function shiftBlocker(xml, at, { calcChain = false } = {}) {
  if (/<tableParts\b[^>]*count="[1-9]/.test(xml) || /<tablePart\b/.test(xml)) return "the sheet holds an Excel table";
  if (/<drawing\b/.test(xml)) return "the sheet holds a drawing or chart";
  if (/<legacyDrawing\b/.test(xml)) return "the sheet holds comments";
  for (const r of rowsOf(xml)) {
    if (r.n < at) continue;
    for (const c of r.inner.matchAll(/<f\b([^>]*)>([\s\S]*?)<\/f>|<f\b([^>]*)\/>/g)) {
      const attrs = c[1] || c[3] || "";
      if (/t="shared"/.test(attrs)) return "the sheet has shared formulas below";
      const f = c[2] || "";
      if (calcChain) return "the sheet has formulas below";
      if (/\$?\b[A-Z]{1,3}\$?\d+\b/.test(f.replace(/"(?:[^"]|"")*"/g, ""))) return "the sheet has formulas below";
    }
  }
  return "";
}

/**
 * The sheet XML with `n` rows put in at row `at` (rows from `at` on moving
 * down), or, n = -1, row `at` taken out (the rows under it moving up): every
 * row and cell number, and every reference outside the cells (the dimension,
 * hyperlinks, merged cells, conditional formats, validations, the selection,
 * the pane, filters, page breaks). Formulas are not rewritten: shiftBlocker
 * says where that would be needed.
 */
export function shiftRows(xml, at, n) {
  let out = String(xml);
  const sd = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>|<sheetData\s*\/>/.exec(out);
  if (!sd) throw new Error("xlsx: no <sheetData> in the sheet");
  let body = sd[1] || "";
  if (n < 0) {
    // The row itself goes.
    body = body.replace(ROW_RE, (whole, attrs) => (rowNumOf(attrs, -1) === at ? "" : whole));
  }
  body = body.replace(ROW_RE, (whole, attrs) => {
    const r = rowNumOf(attrs, -1);
    if (r < 0) return whole;
    const nr = n > 0 ? (r >= at ? r + n : r) : (r > at ? r - 1 : r);
    if (nr === r) return whole;
    return whole
      .replace(/^<row\b([^>]*?)\br="\d+"/, (s, pre) => `<row${pre}r="${nr}"`)
      .replace(/(<c\b[^>]*?\br=")([A-Z]+)\d+"/g, (s, pre, col) => `${pre}${col}${nr}"`);
  });
  const head = out.slice(0, sd.index);
  let tail = out.slice(sd.index + sd[0].length);
  const sdOpen = sd[0].startsWith("<sheetData/") || /^<sheetData\s*\/>/.test(sd[0]) ? null : sd[0].slice(0, sd[0].indexOf(">") + 1);
  const sheetData = sdOpen ? `${sdOpen}${body}</sheetData>` : sd[0];
  // Outside the cells: single references and lists.
  const fixAttr = (s, name, list) => s.replace(new RegExp(`(\\s${name}=")([^"]*)(")`, "g"), (m, a, v, z) => {
    const nv = list ? shiftList(v, at, n) : shiftRef(v, at, n);
    return nv == null || nv === "" ? `${a}${list ? "" : "A1"}${z}` : `${a}${nv}${z}`;
  });
  // Hyperlinks and merged cells on a row taken out go with it.
  tail = tail.replace(/<hyperlink\b[^>]*\/>|<hyperlink\b[^>]*>[\s\S]*?<\/hyperlink>/g, (h) => {
    const ref = attrOf(h, "ref");
    const nr = shiftRef(ref, at, n);
    return nr == null ? "" : h.replace(/(\sref=")[^"]*"/, `$1${nr}"`);
  });
  tail = tail.replace(/<hyperlinks>\s*<\/hyperlinks>/, "");
  tail = tail.replace(/<mergeCell\b[^>]*\/>/g, (h) => {
    const nr = shiftRef(attrOf(h, "ref"), at, n);
    return nr == null ? "" : h.replace(/(\sref=")[^"]*"/, `$1${nr}"`);
  });
  tail = tail.replace(/<mergeCells\b([^>]*)>([\s\S]*?)<\/mergeCells>/, (all, a, inner) => {
    const k = (inner.match(/<mergeCell\b/g) || []).length;
    return k ? `<mergeCells${a.replace(/\scount="\d+"/, ` count="${k}"`)}>${inner}</mergeCells>` : "";
  });
  for (const tag of ["conditionalFormatting", "dataValidation", "selection", "protectedRange", "ignoredError"]) {
    tail = tail.replace(new RegExp(`<${tag}\\b[^>]*>`, "g"), (t) => fixAttr(t, "sqref", true));
  }
  tail = tail.replace(/<conditionalFormatting\b[^>]*\ssqref=""[^>]*>[\s\S]*?<\/conditionalFormatting>/g, "");
  tail = tail.replace(/<selection\b[^>]*>/g, (t) => fixAttr(t, "activeCell", false));
  tail = tail.replace(/<pane\b[^>]*>/g, (t) => fixAttr(t, "topLeftCell", false));
  tail = tail.replace(/<autoFilter\b[^>]*>/g, (t) => fixAttr(t, "ref", false));
  tail = tail.replace(/(<rowBreaks\b[\s\S]*?<\/rowBreaks>)/, (blk) => blk.replace(/(<brk\b[^>]*\sid=")(\d+)"/g, (m, a, id) => {
    const r = +id;
    return `${a}${n > 0 ? (r >= at ? r + n : r) : r > at ? r - 1 : r}"`;
  }));
  let headOut = head.replace(/<dimension\b[^>]*>/, (t) => fixAttr(t, "ref", false));
  headOut = headOut.replace(/<selection\b[^>]*>/g, (t) => fixAttr(fixAttr(t, "sqref", true), "activeCell", false));
  headOut = headOut.replace(/<pane\b[^>]*>/g, (t) => fixAttr(t, "topLeftCell", false));
  return headOut + sheetData + tail;
}

// ---- writing the rows -----------------------------------------------------------------

const inline = (ref, s, text) => `<c r="${ref}"${s ? ` s="${s}"` : ""} t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(text)}</t></is></c>`;
const numCell = (ref, s, v) => `<c r="${ref}"${s ? ` s="${s}"` : ""}><v>${v}</v></c>`;
const blankCell = (ref, s) => (s ? `<c r="${ref}" s="${s}"/>` : "");

/** A template row's look: { attrs (the <row>'s, without r), styles: Map col → s }. */
function lookOf(xml, rowN) {
  const r = rowN ? rowsOf(xml).find((x) => x.n === rowN) : null;
  const styles = new Map();
  if (!r) return { attrs: "", styles };
  for (const c of r.inner.matchAll(CELL_RE)) {
    const ref = attrOf(c[1], "r");
    if (ref) styles.set(colIndex(ref.replace(/\d+$/, "")), attrOf(c[1], "s") || "");
  }
  return { attrs: r.attrs.replace(/\sr="\d+"/, "").replace(/\s+$/, ""), styles };
}

/** A row's XML from a look: `values` Map col → { text } or { num }. */
function rowXml(look, n, values) {
  const cols = new Set([...look.styles.keys(), ...values.keys()]);
  const cells = [...cols].sort((a, b) => a - b).map((c) => {
    const ref = colLetters(c) + n;
    const s = look.styles.get(c) || "";
    const v = values.get(c);
    if (v && v.text != null && v.text !== "") return inline(ref, s, v.text);
    if (v && v.num != null) return numCell(ref, s, v.num);
    return blankCell(ref, s);
  }).join("");
  return `<row r="${n}"${look.attrs}>${cells}</row>`;
}

/** The sheet XML with a hyperlink on `ref` to rel `rid` (made the <hyperlinks> where there is none). */
function addHyperlink(xml, ref, rid) {
  const tag = `<hyperlink ref="${ref}" r:id="${rid}"/>`;
  if (/<hyperlinks>/.test(xml)) return xml.replace(/<\/hyperlinks>/, tag + "</hyperlinks>");
  if (/<hyperlinks\/>/.test(xml)) return xml.replace(/<hyperlinks\/>/, `<hyperlinks>${tag}</hyperlinks>`);
  const after = /<(printOptions|pageMargins|pageSetup|headerFooter|rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/.exec(xml);
  const at = after ? after.index : xml.lastIndexOf("</worksheet>");
  let out = xml.slice(0, at) + `<hyperlinks>${tag}</hyperlinks>` + xml.slice(at);
  if (!/xmlns:r="/.test(out.slice(0, out.indexOf(">", out.indexOf("<worksheet"))))) {
    out = out.replace(/<worksheet\b/, '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
  }
  return out;
}

const REL_HYPERLINK = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const escAttr = (s) => escapeXmlText(s).replace(/"/g, "&quot;");

/**
 * The workbook with each add written in (`adds` from planCalendar), as
 * { bytes, placed: [{ key, sheet, row }], refused: [{ key, why }] }. Each day
 * goes where the owner's paste would have put it: after the day's last case
 * where the day is in the sheet, else as a new day before the first later
 * one, else after the sheet's last row with anything in it — laid out as
 * sheetLayout reads the latest day: its date row (or date in the first case,
 * or in every case), its blank rows, each cell's look; the Case Name linked to
 * the case in eCourt, as the paste macro keeps the link. Nothing else in the
 * workbook changes (xlsx-write.js, replaceParts). A day whose place needs rows
 * moved that PDF+ cannot move (shiftBlocker) is refused, with why.
 */
export async function addCalendarRows(data, adds, now = Date.now()) {
  if (data && typeof data.arrayBuffer === "function" && !(data instanceof Uint8Array)) data = new Uint8Array(await data.arrayBuffer());
  let bytes = data;
  const placed = [], refused = [];
  if (!adds || !adds.length) return { bytes, placed, refused };
  const read = async (b) => {
    const entries = zipEntries(b);
    const byName = new Map(entries.map((e) => [e.name, e]));
    const text = async (name) => { const e = byName.get(name); return e ? readEntry(b, e) : ""; };
    return { byName, text };
  };
  let { byName, text } = await read(bytes);
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(await text("xl/workbook.xml"));
  const calcChain = byName.has("xl/calcChain.xml");
  let { hearings } = await readHearings(bytes, now);
  const dated = hearings.filter((h) => h.date);
  if (!dated.length) {
    for (const a of adds) refused.push({ key: a.key, why: "the sheet has no dated hearing to copy the layout from" });
    return { bytes, placed, refused };
  }
  // The sheet the latest hearings are kept on.
  const sheetName = dated.reduce((a, b) => (b.date > a.date || (b.date === a.date && b.row > a.row) ? b : a)).sheet;
  const part = dated.find((h) => h.sheet === sheetName).part;
  const shared = parseSharedStrings(await text("xl/sharedStrings.xml"));
  let xml = await text(part);
  const layout = sheetLayout(hearings, parseSheetCells(xml, shared, new Map()).cells, sheetName);
  const looks = { hearing: lookOf(xml, layout.tpl.hearing), heading: lookOf(xml, layout.tpl.heading), blank: lookOf(xml, layout.tpl.blank) };
  const { cols } = layout;
  const relsName = relsPartOf(part);
  let rels = (await text(relsName)) || "";
  const relsNew = !rels;
  if (!rels) rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const relIds = new Set(parseRels(rels).keys());
  let relN = 1;
  const newRel = (url) => {
    while (relIds.has("rIdPdfPlus" + relN)) relN++;
    const id = "rIdPdfPlus" + relN;
    relIds.add(id);
    rels = rels.replace(/<\/Relationships>/, `<Relationship Id="${id}" Type="${REL_HYPERLINK}" Target="${escAttr(url)}" TargetMode="External"/></Relationships>`);
    return id;
  };
  const byDay = new Map();
  for (const a of adds) { if (!byDay.has(a.day)) byDay.set(a.day, []); byDay.get(a.day).push(a); }
  const hasValueRow = (r) => /<v>|<is>/.test(r.inner);
  for (const day of [...byDay.keys()].sort()) {
    const list = byDay.get(day);
    const at = dayAt(day);
    const serial = dateToSerial(at, date1904);
    const hs = hearings.filter((h) => h.sheet === sheetName && h.date).sort((a, b) => a.row - b.row);
    const mine = hs.filter((h) => h.date === at);
    const rows = rowsOf(xml);
    const lastContent = Math.max(0, ...rows.filter(hasValueRow).map((r) => r.n));
    let insertAt, block = [];
    const caseRow = (a, withDate) => ({ a, values: new Map([
      ...(withDate && cols.date >= 0 ? [[cols.date, { num: serial }]] : []),
      ...(cols.motion >= 0 ? [[cols.motion, { text: a.motion }]] : []),
      [cols.caseName, { text: a.caseText }],
    ]) });
    const gaps = (k) => Array.from({ length: k }, () => ({ blank: true }));
    if (mine.length) {
      insertAt = mine[mine.length - 1].row + 1;
      for (const a of list) block.push(...gaps(layout.gapWithin), caseRow(a, layout.mode === "every"));
    } else {
      const heading = layout.mode === "heading" ? [{ heading: true }] : [];
      const cases = list.flatMap((a, i) => [...(i ? gaps(layout.gapWithin) : []), caseRow(a, layout.mode === "every" || (layout.mode === "first" && i === 0))]);
      const later = hs.find((h) => h.date > at);
      if (later) {
        // A new day before the first later one: at that day's start.
        let start = later.row;
        if (layout.mode === "heading") {
          for (const r of [...rows].reverse()) if (r.n < later.row && hasValueRow(r)) { const before = hs.filter((h) => h.row < later.row); const prev = before.length ? before[before.length - 1].row : 0; if (r.n > prev) start = r.n; break; }
        }
        insertAt = start;
        block = [...heading, ...cases, ...gaps(layout.gapBetween)];
      } else {
        insertAt = lastContent + 1;
        block = [...gaps(layout.gapBetween), ...heading, ...cases];
      }
    }
    // Rows from insertAt down with nothing in them are taken over rather than
    // moved, so a new day at the end needs nothing moved at all.
    const below = rows.filter((r) => r.n >= insertAt);
    const anythingBelow = below.some(hasValueRow) || new RegExp(`<(hyperlink|mergeCell)\\b[^>]*ref="[A-Z]+(\\d+)`).test(xml) && [...xml.matchAll(/<(?:hyperlink|mergeCell)\b[^>]*ref="[A-Z]+(\d+)/g)].some((m) => +m[1] >= insertAt);
    if (anythingBelow) {
      const why = shiftBlocker(xml, insertAt, { calcChain });
      if (why) { for (const a of list) refused.push({ key: a.key, why: `${why}, so rows cannot be put in above it` }); continue; }
      xml = shiftRows(xml, insertAt, block.length);
    } else {
      // Empty rows in the way go; the rest stay where they are.
      const gone = new Set(below.filter((r) => r.n < insertAt + block.length).map((r) => r.n));
      xml = xml.replace(ROW_RE, (whole, attrs) => (gone.has(rowNumOf(attrs, -1)) ? "" : whole));
    }
    // The new rows, in row order, before the first row after them.
    const made = block.map((b, i) => {
      const n = insertAt + i;
      if (b.blank) return rowXml(looks.blank.attrs || looks.blank.styles.size ? looks.blank : { attrs: "", styles: new Map() }, n, new Map());
      if (b.heading) return rowXml(looks.heading, n, new Map([[cols.date, { num: serial }]]));
      return rowXml(looks.hearing, n, b.values);
    }).join("");
    const after = rowsOf(xml).find((r) => r.n >= insertAt + block.length);
    if (after) xml = xml.slice(0, after.start) + made + xml.slice(after.start);
    else {
      const close = xml.lastIndexOf("</sheetData>");
      if (close >= 0) xml = xml.slice(0, close) + made + xml.slice(close);
      else xml = xml.replace(/<sheetData\s*\/>/, `<sheetData>${made}</sheetData>`);
    }
    // The links, and where each case landed.
    block.forEach((b, i) => {
      if (!b.a) return;
      const n = insertAt + i;
      if (b.a.url && /^https?:\/\//i.test(b.a.url)) xml = addHyperlink(xml, colLetters(cols.caseName) + n, newRel(b.a.url));
      placed.push({ key: b.a.key, sheet: sheetName, row: n, caseName: b.a.caseText, date: at });
    });
    // The dimension reaches the last row.
    const lastRow = Math.max(...rowsOf(xml).map((r) => r.n));
    xml = xml.replace(/<dimension\b([^>]*)\sref="([A-Z]+\d+):([A-Z]+)(\d+)"/, (m, a, s, c, r) => `<dimension${a} ref="${s}:${c}${Math.max(+r, lastRow)}"`);
    // The next day is placed against the sheet as it now stands.
    bytes = await replaceParts(bytes, { [part]: xml });
    hearings = (await readHearings(bytes, now)).hearings;
  }
  if (!placed.length) return { bytes: data, placed, refused };
  bytes = relsNew ? await replaceParts(bytes, { [part]: xml }, { add: { [relsName]: rels } }) : await replaceParts(bytes, { [part]: xml, [relsName]: rels });
  return { bytes, placed, refused, layout: { mode: layout.mode, gapWithin: layout.gapWithin, gapBetween: layout.gapBetween, templateMarked: layout.templateMarked } };
}

/**
 * Undo of an add: the workbook with the case's row taken out (found afresh by
 * sheet, Case Name and day), and the blank row above it where it is blank; a
 * date row left with no case under it goes too, with the blank row above it.
 * Throws where the row is no longer in the sheet, or rows cannot be taken out
 * there (shiftBlocker).
 */
export async function removeCalendarRow(data, rec, now = Date.now()) {
  if (data && typeof data.arrayBuffer === "function" && !(data instanceof Uint8Array)) data = new Uint8Array(await data.arrayBuffer());
  const { hearings } = await readHearings(data, now);
  const hit = hearings.find((h) => h.sheet === rec.sheet && h.caseName === rec.caseName && h.date === rec.date && h.row === rec.row)
    || hearings.find((h) => h.sheet === rec.sheet && h.caseName === rec.caseName && h.date === rec.date);
  if (!hit) throw new Error(`the row for ${rec.caseName} is no longer in the sheet`);
  const entries = zipEntries(data);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const text = async (name) => { const e = byName.get(name); return e ? readEntry(data, e) : ""; };
  const shared = parseSharedStrings(await text("xl/sharedStrings.xml"));
  let xml = await text(hit.part);
  const why = shiftBlocker(xml, hit.row, { calcChain: byName.has("xl/calcChain.xml") });
  if (why) throw new Error(`${why}, so rows cannot be taken out above it`);
  const cellsNow = () => parseSheetCells(xml, shared, new Map()).cells;
  const empty = (cells, r) => { for (let c = 0; c < 40; c++) { const x = cells.get(`${r - 1},${c}`); if (x && String(x.v).trim() !== "") return false; } return true; };
  xml = shiftRows(xml, hit.row, -1);
  let r = hit.row - 1;
  if (r > 1 && empty(cellsNow(), r)) { xml = shiftRows(xml, r, -1); r--; }
  // A date row with no case left under it.
  const others = hearings.filter((h) => h !== hit && h.sheet === hit.sheet && h.date === hit.date);
  if (!others.length && r > 1) {
    const cells = cellsNow();
    const dc = cells.get(`${r - 1},${hit.cols.date}`), nc = cells.get(`${r - 1},${hit.cols.caseName}`);
    if (dc && String(dc.v).trim() !== "" && !(nc && String(nc.v).trim() !== "")) {
      xml = shiftRows(xml, r, -1);
      r--;
      if (r > 1 && empty(cellsNow(), r)) xml = shiftRows(xml, r, -1);
    }
  }
  return replaceParts(data, { [hit.part]: xml });
}

/** The words of one change, for the list on Home and the notice: { text, title }. */
export function changeText(c) {
  const short = (iso) => { const at = dayAt(iso); return at ? new Date(at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : iso; };
  const who = c.caseText || (c.hg && c.hg.caseName) || "";
  if (c.kind === "added" && c.movedFrom) return { text: `Moved ${who}: ${short(c.movedFrom)} → ${short(c.day)}`, title: `The case's Hearings tab moved its ${c.motion || "hearing"} from ${short(c.movedFrom)} to ${short(c.day)}. Written into the sheet under ${short(c.day)}; the ${short(c.movedFrom)} row is marked red.` };
  if (c.kind === "added") return { text: `Added ${who}, ${short(c.day)}`, title: `New on eCourt's agenda for ${short(c.day)}: ${c.motion || "hearing"}. Written into the sheet as Copy All would copy it.` };
  if (c.kind === "off" && c.reason === "moved") {
    return { text: `Moved ${short(c.day)}${c.newDay ? " → " + short(c.newDay) : ""}: ${who}`, title: `The case's Hearings tab says “${c.status || "continued"}”${c.newDay ? ` and sets it for ${short(c.newDay)}, where it is written into the sheet` : ", with no new day yet"}. The ${short(c.day)} row's Motion Type and Case Name cells are marked red.` };
  }
  if (c.kind === "off") {
    const why = "taken off calendar";
    return { text: `Off calendar ${short(c.day)}: ${who} (${why})`, title: `Gone from ${short(c.day)}'s agenda; the case's Hearings tab says “${c.status || why}”. Its Motion Type and Case Name cells are marked red.${c.reason === "moved" && c.newDay ? ` It is written under ${short(c.newDay)}.` : ""}` };
  }
  if (c.kind === "held") return { text: `Check ${who}, ${short(c.day)}: not on that day's agenda`, title: `It is in the sheet for ${short(c.day)}, but eCourt's agenda for that day does not list it${c.status ? `, and its Hearings tab says “${c.status}”` : ", and its Hearings tab does not say why"}. Nothing was changed: mark it off calendar, or keep it.` };
  return { text: who, title: "" };
}

export const _test = { rowsOf, lookOf, rowXml, addHyperlink, textToDate };
