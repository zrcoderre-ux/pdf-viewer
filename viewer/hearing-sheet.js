// Home's Hearings list (pwa/app-web.js, "Home: hearings"): the owner's Excel
// sheet of upcoming hearings, read as Home shows it, and each hearing matched
// to the case folder that holds it. Pure: the shell hands in the workbook's
// bytes and the folders it can see, so the rules are tested in node
// (test-hearing-sheet.mjs) without a file system.
//
// The owner (2026-11-18): "my excel sheet where I list the upcoming hearings
// under these columns Date, Motion Type, Case Name, Date Submitted. I mark
// them green when done and red if they are taken off calendar, or I otherwise
// don't have to work on them." The case names are hyperlinked to the case's
// eCourt page.
//
// xlsx-read.js reads values only (it is a port kept in step with another
// extension's), so this reads the parts it skips: styles.xml for each cell's
// fill (the green and red marks) and number format (dates), the theme for
// fills given as theme colours, and each sheet's hyperlinks (the eCourt link)
// from its <hyperlinks> and rels, or a HYPERLINK() formula.

import { zipEntries, readEntry, parseSharedStrings, colIndex, unescapeXml } from "./xlsx-read.js";
import { replaceParts, colLetters, escapeXmlText } from "./xlsx-write.js";

// ---- case numbers -------------------------------------------------------------

// Both LA Superior Court forms, as the E-Court extension reads them
// (clipboard/content.js, CASE_NUMBER_RE): year-first "25STCV12345" and the
// legacy district form "BC654321". Spaces or a dash inside the year-first
// form are tolerated ("25 STCV 12345", "25-STCV-12345"): a folder name typed
// by hand carries them.
const CASE_NO_RE = /(?<![A-Za-z0-9])(?:(\d{2})[ -]?([A-Za-z]{4,6})[ -]?(\d{4,6})|([A-Za-z][CDFPQSTcdfpqst])[ -]?(\d{6}))(?![A-Za-z0-9])/g;

/** Every case number in `text`, normalized ("25STCV12345"), in order, once each. */
export function caseNumbersIn(text) {
  const out = [];
  for (const m of String(text || "").matchAll(CASE_NO_RE)) {
    const n = (m[1] ? m[1] + m[2] + m[3] : m[4] + m[5]).toUpperCase();
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** The case number an eCourt link names (`caseNumber=`), or "". */
export function caseNumberOfUrl(url) {
  try {
    const q = new URL(String(url)).searchParams.get("caseNumber") || "";
    return caseNumbersIn(q)[0] || "";
  } catch { return ""; }
}

/** eCourt's case page for a case id (calendar-sync.js caseIdOfUrl reads it back). */
export const ECOURT_CASE_URL = "https://civil.lacourt.org/ecourt/ecms/case?id=";

/**
 * A link for every hearing the sheet gives none (the owner, 2026-11-20: "I'm
 * noticing some hearings missing ecourt buttons"): a row typed or pasted with
 * no link has no eCourt button. Sets `ecourtUrl` (and `ecourtFrom`: "sheet",
 * another row of the same case number that has one; "ecourt", the calendar
 * E-Court Suite read, by its case number) on each hearing with no web link of
 * its own; `url` stays the sheet's, as the calendar sync matches by it.
 * Returns how many were filled.
 */
export function fillEcourtLinks(hearings, calendar) {
  const key = (n) => String(n || "").trim().toUpperCase();
  const found = new Map();
  for (const h of hearings || []) {
    if (h && isWebLink(h.url) && h.caseNumber && !found.has(key(h.caseNumber))) found.set(key(h.caseNumber), { url: h.url, from: "sheet" });
  }
  for (const d of (calendar && Array.isArray(calendar.days) ? calendar.days : [])) {
    for (const r of (d && Array.isArray(d.rows) ? d.rows : [])) {
      if (!r) continue;
      const n = key(r.caseNumber || caseNumbersIn(r.caseText)[0]);
      if (!n || found.has(n)) continue;
      const id = /^\d+$/.test(String(r.caseId || "")) ? String(r.caseId) : "";
      const url = isWebLink(r.url) && /lacourt\.org\//i.test(r.url) ? r.url : id ? ECOURT_CASE_URL + id : "";
      if (url) found.set(n, { url, from: "ecourt" });
    }
  }
  let n = 0;
  for (const h of hearings || []) {
    if (!h) continue;
    delete h.ecourtUrl; delete h.ecourtFrom;
    if (isWebLink(h.url) || !h.caseNumber) continue;
    const hit = found.get(key(h.caseNumber));
    if (hit) { h.ecourtUrl = hit.url; h.ecourtFrom = hit.from; n++; }
  }
  return n;
}

/** The link a hearing's eCourt button opens: the sheet's, else one filled in (fillEcourtLinks), else "". */
export function ecourtUrlOf(h) {
  if (!h) return "";
  if (isWebLink(h.url)) return h.url;
  return isWebLink(h.ecourtUrl) ? h.ecourtUrl : "";
}

/**
 * A case's link marked with the case it belongs to, so that E-Court Suite
 * puts a case's eCourt page and its Claude chat in one Chrome window (the
 * owner, 2026-11-24: "a claude tab opened in a case would open in the same
 * window as the ecourt for the same case (and vice versa)"). The mark is the
 * fragment `#pdfplus-case=<case>`, a link's own fragment kept after `&then=`;
 * the extension (case-window/background.js) takes it off before the page
 * loads and restores that fragment. No case: the link as it was.
 */
export const CASE_WINDOW_MARK = "pdfplus-case=";
export function caseWindowKey(h) {
  if (!h) return "";
  return String(h.caseNumber || h.caseName || "").replace(/\s+/g, " ").trim().toUpperCase();
}
export function caseWindowUrl(url, h) {
  const key = caseWindowKey(h);
  if (!key || !isWebLink(url)) return String(url || "");
  try {
    const u = new URL(String(url));
    const own = u.hash.replace(/^#/, "");
    u.hash = CASE_WINDOW_MARK + encodeURIComponent(key) + (own ? "&then=" + encodeURIComponent(own) : "");
    return u.href;
  } catch { return String(url); }
}

/** Whether a link may be opened from Home: http(s) only. */
export function isWebLink(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

// ---- colours: the owner's marks ---------------------------------------------

// Excel's default indexed palette (a workbook may override it in styles.xml).
const INDEXED = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

function hexToRgb(hex) {
  const h = String(hex || "").replace(/^#/, "").slice(-6);
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Excel's tint: toward white (tint > 0) or black (tint < 0), on the lightness. */
function tinted(hsl, tint) {
  if (!tint) return hsl;
  const [h, s, l] = hsl;
  return [h, s, tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint];
}

/**
 * What a fill colour means: "done" for a green, "off" for a red (pinks
 * included: Excel's "Bad" style is FFC7CE), "" for anything else, white,
 * black and greys among them. `hex` is "RRGGBB" (or "AARRGGBB").
 */
export function markOfColor(hex, tint = 0) {
  const rgb = hexToRgb(hex);
  if (!rgb) return "";
  const [h, s, l] = tinted(rgbToHsl(rgb), tint);
  if (s < 0.2 || l > 0.96 || l < 0.08) return "";
  if (h >= 70 && h <= 170) return "done";
  if (h >= 325 || h <= 15) return "off";
  return "";
}

// Theme colours by Excel's index: lt1, dk1, lt2, dk2 (the scheme lists them
// dk1, lt1, dk2, lt2), then accent1-6, hyperlink, followed hyperlink.
const THEME_ORDER = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
// The Office theme's, for a workbook with no theme part.
const OFFICE_THEME = {
  dk1: "000000", lt1: "FFFFFF", dk2: "44546A", lt2: "E7E6E6", accent1: "4472C4", accent2: "ED7D31",
  accent3: "A5A5A5", accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47", hlink: "0563C1", folHlink: "954F72",
};

export function parseTheme(xml) {
  const out = { ...OFFICE_THEME };
  const scheme = /<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/.exec(String(xml || ""));
  if (!scheme) return out;
  for (const name of Object.keys(OFFICE_THEME)) {
    const m = new RegExp(`<a:${name}>([\\s\\S]*?)</a:${name}>`).exec(scheme[0]);
    if (!m) continue;
    const v = /<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/.exec(m[1]) || /lastClr="([0-9A-Fa-f]{6})"/.exec(m[1]);
    if (v) out[name] = v[1].toUpperCase();
  }
  return out;
}

export const attrOf = (tag, name) => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : null;
};

/** A <fgColor .../>-style tag as { hex, tint }, or null. */
function colorOf(tag, theme, indexed) {
  if (!tag) return null;
  const tint = Number(attrOf(tag, "tint")) || 0;
  const rgb = attrOf(tag, "rgb");
  if (rgb) return { hex: rgb.slice(-6).toUpperCase(), tint };
  const th = attrOf(tag, "theme");
  if (th != null) { const n = THEME_ORDER[Number(th)]; return n ? { hex: theme[n], tint } : null; }
  const ix = attrOf(tag, "indexed");
  if (ix != null) { const c = indexed[Number(ix)]; return c ? { hex: c, tint } : null; }
  return null;
}

// Built-in number formats that are dates (14-22, 45-47) and the East Asian ones.
const DATE_FMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
function isDateFormat(code) {
  // A custom format is a date where it names a day, month or year outside
  // quotes and brackets ("[Red]", "[$-409]").
  const bare = String(code || "").replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  return /[dmy]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare);
}

/**
 * styles.xml as each cell style (the `s=` index) needs it:
 * [{ fill: { hex, tint } | null, date: bool }].
 */
/** The indexed palette a styles.xml uses: its own <indexedColors>, else Excel's. */
function indexedOf(xml) {
  const ic = /<indexedColors>([\s\S]*?)<\/indexedColors>/.exec(xml);
  if (ic) {
    const over = [...ic[1].matchAll(/<rgbColor\s[^>]*rgb="([0-9A-Fa-f]{8}|[0-9A-Fa-f]{6})"/g)].map((m) => m[1].slice(-6).toUpperCase());
    if (over.length) return over;
  }
  return INDEXED;
}
/** The colour of one <fill>'s body ({ hex, tint }), or null for none. */
function fillColor(body, theme, indexed) {
  const pat = /<patternFill\b([^>]*)\/?>/.exec(body);
  const type = pat ? attrOf(pat[1], "patternType") : null;
  if (pat && type && type !== "none") {
    const fg = /<fgColor\b[^>]*\/?>/.exec(body);
    const bg = /<bgColor\b[^>]*\/?>/.exec(body);
    return colorOf(fg && fg[0], theme, indexed) || colorOf(bg && bg[0], theme, indexed);
  }
  // A gradient: its first stop.
  const stop = /<stop\b[^>]*>\s*(<color\b[^>]*\/?>)/.exec(body);
  return stop ? colorOf(stop[1], theme, indexed) : null;
}
const FILL_RE = /<fill>([\s\S]*?)<\/fill>|<fill\/>/g;

export function parseStyles(xml, theme = OFFICE_THEME) {
  xml = String(xml || "");
  const indexed = indexedOf(xml);
  const fmts = new Map();
  for (const m of xml.matchAll(/<numFmt\s[^>]*\/?>/g)) fmts.set(Number(attrOf(m[0], "numFmtId")), attrOf(m[0], "formatCode") || "");
  const fills = [];
  const fillsXml = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(xml);
  if (fillsXml) for (const m of fillsXml[1].matchAll(FILL_RE)) fills.push(fillColor(m[1] || "", theme, indexed));
  const out = [];
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (xfs) {
    for (const m of xfs[1].matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)) {
      const fillId = Number(attrOf(m[1], "fillId") || 0);
      const fmtId = Number(attrOf(m[1], "numFmtId") || 0);
      out.push({
        fill: fills[fillId] || null,
        date: DATE_FMT_IDS.has(fmtId) || (fmts.has(fmtId) && isDateFormat(fmts.get(fmtId))),
      });
    }
  }
  return out;
}

// ---- dates -------------------------------------------------------------------

/** Local midnight of an Excel serial date (`date1904`: the Mac 1904 system). */
export function serialToDate(serial, date1904 = false) {
  const n = Math.floor(Number(serial));
  if (!Number.isFinite(n)) return 0;
  return date1904 ? new Date(1904, 0, 1 + n).getTime() : new Date(1899, 11, 30 + n).getTime();
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/**
 * Local midnight of a date typed as text: "11/20/2026", "11/20/26", "11/20"
 * (the year from `now`: this year, or next where the date would be more than
 * six months gone), "2026-11-20", "Nov 20, 2026", "Friday, November 20, 2026";
 * 0 for anything else.
 */
export function textToDate(text, now = Date.now()) {
  const s = String(text || "").trim();
  if (!s) return 0;
  const yearFor = (mo, d) => {
    const ref = new Date(now);
    let y = ref.getFullYear();
    if (new Date(y, mo, d).getTime() < now - 182 * 86400000) y++;
    return y;
  };
  const full = (y) => (y < 100 ? 2000 + y : y);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  m = /(?:^|\s)(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?!\d)/.exec(s);
  if (m) {
    const mo = +m[1] - 1, d = +m[2];
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return 0;
    return new Date(m[3] ? full(+m[3]) : yearFor(mo, d), mo, d).getTime();
  }
  m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/.exec(s);
  if (m) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mo < 0) return 0;
    const d = +m[2];
    return new Date(m[3] ? +m[3] : yearFor(mo, d), mo, d).getTime();
  }
  return 0;
}

// ---- the sheet ----------------------------------------------------------------

/**
 * One sheet's cells: Map "row,col" (0-based) → { v, t, s, f }, plus the
 * row-level style of each row that carries one (`rowStyle`) and the sheet's
 * hyperlinks (Map "row,col" → url).
 */
export function parseSheetCells(xml, shared, rels) {
  const cells = new Map();
  const rowStyle = new Map();
  let maxRow = -1;
  // Lazy, so an empty row with attributes (<row r="4" ht="28" customHeight="1"/>)
  // ends at its own "/>" and does not take in the next row's cells.
  const rowRe = /<row((?:\s[^>]*?)?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm, nextRow = 0;
  while ((rm = rowRe.exec(xml))) {
    const rn = parseInt(attrOf(rm[1], "r") || "", 10);
    const r = Number.isFinite(rn) && rn >= 1 ? rn - 1 : nextRow;
    nextRow = r + 1;
    if (r > maxRow) maxRow = r;
    if (attrOf(rm[1], "customFormat") === "1" && attrOf(rm[1], "s") != null) rowStyle.set(r, Number(attrOf(rm[1], "s")));
    let next = 0;
    const cellRe = /<c((?:\s[^>]*)?)\/>|<c((?:\s[^>]*)?)>([\s\S]*?)<\/c>/g;
    let cm;
    while ((cm = cellRe.exec(rm[2] || ""))) {
      const tag = cm[1] != null ? cm[1] : cm[2];
      const inner = cm[3] || "";
      const ref = attrOf(tag, "r");
      const c = ref ? colIndex(ref) : next;
      next = c + 1;
      const t = attrOf(tag, "t");
      const s = Number(attrOf(tag, "s") || 0);
      const fm = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(inner);
      const vm = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
      let v = vm ? unescapeXml(vm[1]) : "";
      if (t === "s") v = shared[parseInt(v, 10)] ?? "";
      else if (t === "inlineStr") v = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => unescapeXml(x[1])).join("");
      else if (t === "b") v = v === "1" ? "TRUE" : "FALSE";
      cells.set(`${r},${c}`, { v, t, s, f: fm ? unescapeXml(fm[1]) : "" });
    }
  }
  const links = new Map();
  const hl = /<hyperlinks>([\s\S]*?)<\/hyperlinks>/.exec(xml);
  if (hl) {
    for (const m of hl[1].matchAll(/<hyperlink\b[^>]*\/?>/g)) {
      const ref = attrOf(m[0], "ref") || "";
      const rid = attrOf(m[0], "r:id");
      const url = rid && rels.get(rid);
      if (!url) continue;
      // A link may cover a range ("C4:C9"): every cell in it.
      const [a, b] = ref.split(":");
      const pa = refRowCol(a), pb = b ? refRowCol(b) : pa;
      if (!pa || !pb) continue;
      for (let r = pa[0]; r <= pb[0] && r - pa[0] < 5000; r++) for (let c = pa[1]; c <= pb[1] && c - pa[1] < 50; c++) links.set(`${r},${c}`, url);
    }
  }
  return { cells, rowStyle, links, maxRow };
}

function refRowCol(ref) {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(String(ref || ""));
  return m ? [Number(m[2]) - 1, colIndex(m[1])] : null;
}

/** The URL a HYPERLINK("url", …) formula names, or "". */
export function hyperlinkOfFormula(f) {
  const m = /HYPERLINK\(\s*"((?:[^"]|"")*)"/i.exec(String(f || ""));
  return m ? m[1].replace(/""/g, '"') : "";
}

/** Map rId → target of a part's rels XML (external targets only matter here). */
export function parseRels(xml) {
  const out = new Map();
  for (const m of String(xml || "").matchAll(/<Relationship\s[^>]*\/?>/g)) {
    const id = attrOf(m[0], "Id"), target = attrOf(m[0], "Target");
    if (id && target) out.set(id, target);
  }
  return out;
}

/** The rels part that sits beside a part: xl/worksheets/sheet1.xml → xl/worksheets/_rels/sheet1.xml.rels. */
export function relsPartOf(part) {
  const i = part.lastIndexOf("/");
  return part.slice(0, i + 1) + "_rels/" + part.slice(i + 1) + ".rels";
}

/**
 * Which column is which, off a header row: { date, motion, caseName,
 * submitted } (0-based, -1 missing). "Date" alone is the hearing date;
 * "Date Submitted" (or any "submitted") is the submission date.
 */
export function headerColumns(row) {
  const cols = { date: -1, motion: -1, caseName: -1, submitted: -1 };
  row.forEach((raw, i) => {
    const h = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!h) return;
    if (/submit/.test(h)) { if (cols.submitted < 0) cols.submitted = i; }
    else if (/^(hearing )?date$|^date of hearing$|^hearing$/.test(h)) { if (cols.date < 0) cols.date = i; }
    else if (/motion/.test(h)) { if (cols.motion < 0) cols.motion = i; }
    else if (/case/.test(h)) { if (cols.caseName < 0) cols.caseName = i; }
  });
  return cols;
}

/**
 * The hearings in a workbook's bytes:
 *   { hearings: [{ sheet, row, date, dateText, motion, caseName, caseNumber,
 *                  url, submitted, submittedText, mark }], sheets: [names read] }
 * Every sheet whose first 20 rows hold a header with a Date and a Case Name
 * column is read; each row under it with a case name is a hearing. `row` is
 * the sheet's own 1-based row number. `date` and `submitted` are local
 * midnights (0 where blank or unreadable). A row with no date of its own
 * takes the one above it, as a list kept under a date written once does.
 * `mark` is "done" (green), "off" (red) or "": the fill of the row's
 * Date, Motion Type or Case Name cell, else of the row itself.
 * `caseNumber` is the first case number in the case name, the rest of the
 * row, or the link's caseNumber= parameter. `note` is the words the owner
 * wrote in the row's Date cell, "" for none (dateNote). `part` and `cols`
 * (the sheet's zip part and its columns) are what markHearing writes by.
 */
export async function readHearings(data, now = Date.now()) {
  if (data && typeof data.arrayBuffer === "function" && !(data instanceof Uint8Array)) data = new Uint8Array(await data.arrayBuffer());
  const entries = zipEntries(data);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const text = async (name) => { const e = byName.get(name); return e ? readEntry(data, e) : ""; };
  const shared = parseSharedStrings(await text("xl/sharedStrings.xml"));
  const theme = parseTheme(await text("xl/theme/theme1.xml"));
  const styles = parseStyles(await text("xl/styles.xml"), theme);
  const wb = await text("xl/workbook.xml");
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(wb);
  const wbRels = parseRels(await text("xl/_rels/workbook.xml.rels"));
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\s[^>]*\/?>/g)) {
    const rid = attrOf(m[0], "r:id");
    let target = rid && wbRels.get(rid);
    if (!target) continue;
    target = target.startsWith("/") ? target.slice(1) : target.startsWith("xl/") ? target : "xl/" + target;
    if (attrOf(m[0], "state") === "hidden" || attrOf(m[0], "state") === "veryHidden") continue;
    sheets.push({ name: attrOf(m[0], "name") || "", part: target });
  }
  const hearings = [];
  const read = [];
  for (const sh of sheets) {
    const xml = await text(sh.part);
    if (!xml) continue;
    const { cells, rowStyle, links, maxRow } = parseSheetCells(xml, shared, parseRels(await text(relsPartOf(sh.part))));
    const rowValues = (r) => {
      const out = [];
      for (let c = 0; c < 40; c++) { const x = cells.get(`${r},${c}`); out.push(x ? String(x.v) : ""); }
      return out;
    };
    let head = -1, cols = null;
    for (let r = 0; r <= Math.min(maxRow, 19); r++) {
      const hc = headerColumns(rowValues(r));
      if (hc.date >= 0 && hc.caseName >= 0) { head = r; cols = hc; break; }
    }
    if (head < 0) continue;
    read.push(sh.name);
    const cell = (r, c) => (c >= 0 ? cells.get(`${r},${c}`) : null);
    const dateOf = (x) => {
      if (!x || x.v === "") return { at: 0, text: "" };
      const num = Number(x.v);
      if (x.t !== "s" && x.t !== "inlineStr" && x.t !== "str" && Number.isFinite(num) && num > 20000 && num < 80000) {
        return { at: serialToDate(num, date1904), text: "" };
      }
      return { at: textToDate(x.v, now), text: String(x.v).trim() };
    };
    const markOf = (x) => {
      const st = x && styles[x.s];
      return st && st.fill ? markOfColor(st.fill.hex, st.fill.tint) : "";
    };
    let lastDate = { at: 0, text: "" };
    for (let r = head + 1; r <= maxRow; r++) {
      const nameCell = cell(r, cols.caseName);
      const caseName = String((nameCell && nameCell.v) || "").replace(/\s+/g, " ").trim();
      const dc = cell(r, cols.date);
      let d = dateOf(dc);
      // A row with a date and no case is a date written over the cases under it.
      if (!caseName) { if (d.at && !d.text) lastDate = d; continue; }
      // Words in the Date cell beside a case are the owner's note on it
      // (dateNote): the row keeps a date the words name ("Continued to
      // 1/5/27"), else takes the one above it; only a plain date is the one
      // the rows below it take.
      // A note PDF+ wrote beside the row's own date ("11/20/2026 · Check POS",
      // setHearingNote) is that date and that note: the date is still the one
      // the rows below take.
      const lead = splitNoteLead(d.text);
      let note;
      if (lead) {
        note = lead.note;
        d = { at: textToDate(lead.date, now), text: "" };
        lastDate = d;
      } else {
        note = dateNote(d.text);
        if (note) { if (!d.at) d = lastDate.at ? lastDate : { at: 0, text: "No date" }; }
        else if (!d.at && !d.text) d = lastDate;
        else lastDate = d;
      }
      const motionCell = cell(r, cols.motion);
      const sub = dateOf(cell(r, cols.submitted));
      // The case name's own link first, then any other cell's in the row.
      let url = "";
      for (const k of [cols.caseName, ...Array.from({ length: 40 }, (_, i) => i).filter((i) => i !== cols.caseName)]) {
        const x = cells.get(`${r},${k}`);
        const u = links.get(`${r},${k}`) || (x && hyperlinkOfFormula(x.f)) || "";
        if (isWebLink(u)) { url = u; break; }
      }
      let mark = markOf(nameCell) || markOf(dc) || markOf(motionCell);
      if (!mark && rowStyle.has(r)) { const st = styles[rowStyle.get(r)]; if (st && st.fill) mark = markOfColor(st.fill.hex, st.fill.tint); }
      const rest = rowValues(r).join(" ");
      const caseNumber = caseNumbersIn(caseName)[0] || caseNumbersIn(rest)[0] || caseNumberOfUrl(url);
      hearings.push({
        sheet: sh.name, row: r + 1,
        date: d.at, dateText: d.at ? "" : d.text,
        motion: String((motionCell && motionCell.v) || "").replace(/\s+/g, " ").trim(),
        caseName, caseNumber, url,
        submitted: sub.at, submittedText: sub.at ? "" : sub.text,
        mark, note,
        part: sh.part, cols,
      });
    }
  }
  return { hearings, sheets: read };
}

/**
 * The note in a Date cell's text, or "": the cell's words where they say more
 * than a date ("Check POS", "TBD", "Continued to 1/5/27"); a date alone, in
 * any form textToDate reads ("Fri, Nov 20, 2026", "11/20"), is no note.
 */
const DATE_WORDS = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b\.?|(?<=\d)(?:st|nd|rd|th)\b/gi;
export function dateNote(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  return /[a-z]/i.test(t.replace(DATE_WORDS, "")) ? t : "";
}

/**
 * A Date cell PDF+ gave a note beside its date: "11/20/2026 · Check POS" →
 * { date: "11/20/2026", note: "Check POS" }; anything else null. Only the
 * " · " PDF+ writes divides them, so a note the owner typed ("12/1 asked to
 * continue") reads as it always has (dateNote).
 */
export const NOTE_SEP = " · ";
export function splitNoteLead(text) {
  const m = /^\s*(\d{1,2}\/\d{1,2}\/\d{2,4}) · ([\s\S]*\S)\s*$/.exec(String(text || ""));
  return m && textToDate(m[1]) ? { date: m[1], note: m[2].trim() } : null;
}

// ---- marking a hearing in the sheet ---------------------------------------------
//
// The owner (2026-11-18): "Add off calendar and on calendar toggles. These
// would change the color of the excel sheet accordingly." Off calendar fills
// the row's cells red, as the owner marks them by hand; On calendar takes the
// red off. The workbook is copied part for part (xlsx-write.js, replaceParts)
// and only styles.xml and the one sheet are rewritten: a new cell style is a
// copy of the cell's own (its font, borders, number format, alignment) with
// only the fill changed, so a date stays a date and a link keeps its look.

const RED_FILL = '<fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/><bgColor indexed="64"/></patternFill></fill>';
// Excel's standard Light Green.
const GREEN_FILL = '<fill><patternFill patternType="solid"><fgColor rgb="FF92D050"/><bgColor indexed="64"/></patternFill></fill>';

/** The <fill> entries of a styles.xml, raw, with what each means (markOfColor). */
function fillsOf(xml, theme) {
  const indexed = indexedOf(xml);
  const block = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(xml);
  if (!block) return [];
  return [...block[1].matchAll(FILL_RE)].map((m) => {
    const c = fillColor(m[1] || "", theme, indexed);
    return { raw: m[0], mark: c ? markOfColor(c.hex, c.tint) : "" };
  });
}
/** The <xf> entries of <cellXfs>, raw. */
function cellXfsOf(xml) {
  const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  return block ? [...block[1].matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map((m) => m[0]) : [];
}
/** An <xf> with its fillId set (applyFill with it). */
function withFill(xf, fillId) {
  const open = /^<xf\b[^>]*?(?=\/?>)/.exec(xf)[0];
  let tag = /\sfillId="/.test(open) ? open.replace(/\sfillId="[^"]*"/, ` fillId="${fillId}"`) : open + ` fillId="${fillId}"`;
  tag = /\sapplyFill="/.test(tag) ? tag.replace(/\sapplyFill="[^"]*"/, ' applyFill="1"') : tag + ' applyFill="1"';
  return tag + xf.slice(open.length);
}
function setAttr(tag, name, value) {
  return new RegExp(`\\s${name}="`).test(tag) ? tag.replace(new RegExp(`\\s${name}="[^"]*"`), ` ${name}="${value}"`) : tag.replace(/(\/?>)$/, ` ${name}="${value}"$1`);
}

/**
 * The workbook with hearing `hg`'s row marked `mark` ("done": its Motion Type
 * and Case Name cells filled green; "off": the same two filled red; "": both
 * marks taken off), as new bytes. The row is found afresh in `data` (the file
 * as it stands now, which Excel may have changed): at `hg.row` of `hg.sheet`
 * where its case name still stands there, else the row of that sheet holding
 * the same case name and date; none, and it throws. The fill is the one the
 * sheet's own rows so marked use, where it has one, else a plain red or
 * light green. Marking one way takes the other mark off every cell of the
 * row and off the row's own style; "" takes both off; any other fill (a
 * yellow highlight on the Date cell) is left be.
 */
export async function markHearing(data, hg, mark) {
  if (data && typeof data.arrayBuffer === "function" && !(data instanceof Uint8Array)) data = new Uint8Array(await data.arrayBuffer());
  const { hearings } = await readHearings(data);
  const target = findRowNow(hearings, hg);
  if (!target) throw new Error(`the row for ${hg.caseName} is no longer in the sheet`);
  const entries = zipEntries(data);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const text = async (name) => { const e = byName.get(name); return e ? readEntry(data, e) : ""; };
  const theme = parseTheme(await text("xl/theme/theme1.xml"));
  let styles = await text("xl/styles.xml");
  const sheetXml = await text(target.part);
  if (!styles || !sheetXml) throw new Error("the workbook has no styles or no sheet part");
  const fills = fillsOf(styles, theme);
  const xfs = cellXfsOf(styles);
  const markOfXf = (s) => {
    const m = /\sfillId="(\d+)"/.exec(xfs[s] || "");
    return m && fills[+m[1]] ? fills[+m[1]].mark : "";
  };
  // The red and the green: the ones the sheet's own marked rows use, else a
  // plain one added once.
  const added = { fills: [], xfs: [] };
  const fillFor = (which) => {
    let id = fills.findIndex((f) => f.mark === which);
    if (id < 0) {
      const raw = which === "off" ? RED_FILL : GREEN_FILL;
      const k = added.fills.indexOf(raw);
      id = fills.length + (k < 0 ? added.fills.push(raw) - 1 : k);
    }
    return id;
  };
  // One new style per old one and fill, reused where an identical one stands.
  const memo = new Map();
  const styleFor = (s, which) => {
    const key = s + "|" + which;
    if (memo.has(key)) return memo.get(key);
    const base = xfs[s] || xfs[0] || '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>';
    const want = withFill(base, which ? fillFor(which) : 0);
    let at = xfs.indexOf(want);
    if (at < 0) {
      let k = added.xfs.indexOf(want);
      if (k < 0) { k = added.xfs.length; added.xfs.push(want); }
      at = xfs.length + k;
    }
    memo.set(key, at);
    return at;
  };
  // The owner (2026-11-18): Done "turning the hearing type and case name cells
  // green", and Off calendar "should turn only those cells red". Marking takes
  // the other mark off the rest of the row; "" takes both off it.
  const cols = [target.cols.motion, target.cols.caseName].filter((c) => c >= 0);
  const clear = mark === "" ? ["off", "done"] : [mark === "off" ? "done" : "off"];
  const nextSheet = restyleRow(sheetXml, target.row, (col, s) => {
    const marked = markOfXf(s);
    if (mark && cols.includes(col)) return marked === mark ? null : styleFor(s, mark);
    return clear.includes(marked) ? styleFor(s, "") : null;
  }, mark ? cols : [], (s) => (clear.includes(markOfXf(s)) ? styleFor(s, "") : null));
  if (added.fills.length) {
    styles = styles.replace(/<fills\b([^>]*)>([\s\S]*?)<\/fills>/, (all, a, body) =>
      `${setAttr(`<fills${a}>`, "count", fills.length + added.fills.length)}${body}${added.fills.join("")}</fills>`);
  }
  if (added.xfs.length) {
    styles = styles.replace(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/, (all, a, body) =>
      `${setAttr(`<cellXfs${a}>`, "count", xfs.length + added.xfs.length)}${body}${added.xfs.join("")}</cellXfs>`);
  }
  const replace = { [target.part]: nextSheet };
  if (added.fills.length || added.xfs.length) replace["xl/styles.xml"] = styles;
  return replaceParts(data, replace);
}

// ---- a note on a hearing, in its Date cell -----------------------------------
//
// The owner (2026-11-19): "Change the * to a sticky note icon, and give them
// all one. When it is transparent that means there is not currently a note,
// but by clicking it, I can add a note. When there is a note, it is colored
// in and I can view and edit the note by clicking on it." The owner keeps
// notes in the Date column (dateNote), so that is where one is written: a row
// whose Date cell is blank (a row under a date written once) takes the note
// alone; a row whose Date cell holds the date keeps it in front
// ("11/20/2026 · Check POS", splitNoteLead), so neither it nor the rows under
// it lose their date. A note taken off gives the cell back its date as a date
// (a number, where its style is a date's) or leaves it empty.

/** M/D/YYYY of a local midnight. */
const mdy = (at) => { const d = new Date(at); return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`; };

/** Excel's serial number for a local midnight (1900 system, or 1904). */
export function dateToSerial(at, date1904 = false) {
  const d = new Date(at);
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((utc - (date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30))) / 86400000);
}

/** The <c> for a cell holding a number (a date's serial), keeping style `s`. */
const numCell = (ref, s, n) => `<c r="${ref}"${s ? ` s="${s}"` : ""}><v>${n}</v></c>`;

/**
 * The sheet XML with cell (rowN, col) replaced by `cellXml` (built for its
 * ref and its old style: cellXml(ref, s)); a cell the row lacks is put in
 * column order. The row must be there.
 */
export function replaceCell(xml, rowN, col, build) {
  const ref = colLetters(col) + rowN;
  const rowRe = /<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g;
  let m, seq = 0;
  while ((m = rowRe.exec(xml))) {
    seq++;
    const rn = parseInt(attrOf(m[1], "r") || "", 10);
    if ((Number.isFinite(rn) ? rn : seq) === rowN) break;
  }
  if (!m) throw new Error("row " + rowN + " is not in the sheet");
  const open = `<row${m[1].replace(/\s+$/, "")}>`;
  let inner = m[3] || "";
  let done = false;
  inner = inner.replace(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g, (cell, attrs) => {
    const r = attrOf(attrs, "r");
    if (!r || colIndex(r.replace(/\d+$/, "")) !== col) return cell;
    done = true;
    return build(ref, attrOf(attrs, "s") || "");
  });
  if (!done) {
    let at = inner.length;
    for (const c of inner.matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)) {
      const r = attrOf(c[1], "r");
      if (r && colIndex(r.replace(/\d+$/, "")) > col) { at = c.index; break; }
    }
    inner = inner.slice(0, at) + build(ref, "") + inner.slice(at);
  }
  return xml.slice(0, m.index) + open + inner + "</row>" + xml.slice(m.index + m[0].length);
}

/** The row of `hearings` that is `hg` now: at its row where its case name still stands there, else the same case name and date. */
function findRowNow(hearings, hg) {
  const same = (h) => h.sheet === hg.sheet && h.caseName === hg.caseName;
  return hearings.find((h) => same(h) && h.row === hg.row) || hearings.find((h) => same(h) && h.date === hg.date) || null;
}

/**
 * The workbook with hearing `hg`'s note set to `note` ("" takes it off), as
 * new bytes; written in the row's Date cell as above. The row is found afresh
 * as markHearing finds it; none, and it throws. A sheet without a Date column
 * cannot hold one, and throws.
 */
export async function setHearingNote(data, hg, note) {
  if (data && typeof data.arrayBuffer === "function" && !(data instanceof Uint8Array)) data = new Uint8Array(await data.arrayBuffer());
  note = String(note || "").replace(/\s+/g, " ").trim();
  const { hearings } = await readHearings(data);
  const target = findRowNow(hearings, hg);
  if (!target) throw new Error(`the row for ${hg.caseName} is no longer in the sheet`);
  if (target.cols.date < 0) throw new Error("the sheet has no Date column to keep a note in");
  const entries = zipEntries(data);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const text = async (name) => { const e = byName.get(name); return e ? readEntry(data, e) : ""; };
  const shared = parseSharedStrings(await text("xl/sharedStrings.xml"));
  const styles = parseStyles(await text("xl/styles.xml"), parseTheme(await text("xl/theme/theme1.xml")));
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(await text("xl/workbook.xml"));
  const sheetXml = await text(target.part);
  const { cells } = parseSheetCells(sheetXml, shared, new Map());
  const x = cells.get(`${target.row - 1},${target.cols.date}`);
  // The date the cell holds, if it holds one: as a number, or written in front.
  let leadAt = 0;
  const num = x ? Number(x.v) : NaN;
  if (x && x.t !== "s" && x.t !== "inlineStr" && x.t !== "str" && x.v !== "" && Number.isFinite(num) && num > 20000 && num < 80000) leadAt = serialToDate(num, date1904);
  else if (x && x.v !== "") {
    const lead = splitNoteLead(x.v);
    if (lead) leadAt = textToDate(lead.date);
    else if (!dateNote(x.v) && textToDate(x.v)) leadAt = textToDate(x.v);
  }
  const isDateStyle = (s) => !!(styles[Number(s || 0)] && styles[Number(s || 0)].date);
  const next = replaceCell(sheetXml, target.row, target.cols.date, (ref, s) => {
    if (note) return `<c r="${ref}"${s ? ` s="${s}"` : ""} t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(leadAt ? mdy(leadAt) + NOTE_SEP + note : note)}</t></is></c>`;
    if (leadAt) return isDateStyle(s) ? numCell(ref, s, dateToSerial(leadAt, date1904)) : `<c r="${ref}"${s ? ` s="${s}"` : ""} t="inlineStr"><is><t>${mdy(leadAt)}</t></is></c>`;
    return `<c r="${ref}"${s ? ` s="${s}"` : ""}/>`;
  });
  return replaceParts(data, { [target.part]: next });
}

/**
 * The sheet XML with row `rowN`'s cells restyled: `cellStyle(col, s)` gives a
 * cell its new style index, or null to leave it; `need` lists the columns
 * the row must have (a missing one is added, empty, in column order, styled
 * by cellStyle(col, 0)); `rowStyle(s)` does the same for the row's own style.
 */
export function restyleRow(xml, rowN, cellStyle, need = [], rowStyle = () => null) {
  const rowRe = /<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g;
  let m, seq = 0;
  while ((m = rowRe.exec(xml))) {
    seq++;
    const rn = parseInt(attrOf(m[1], "r") || "", 10);
    if ((Number.isFinite(rn) ? rn : seq) === rowN) break;
  }
  if (!m) throw new Error("row " + rowN + " is not in the sheet");
  let open = `<row${m[1].replace(/\s+$/, "")}>`;
  const rs = attrOf(m[1], "s");
  if (rs != null && attrOf(m[1], "customFormat") === "1") {
    const ns = rowStyle(Number(rs));
    if (ns != null) open = setAttr(open, "s", ns);
  }
  let inner = m[3] || "";
  const have = new Set();
  inner = inner.replace(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g, (cell, attrs) => {
    const ref = attrOf(attrs, "r");
    if (!ref) return cell;
    const col = colIndex(ref.replace(/\d+$/, ""));
    have.add(col);
    const ns = cellStyle(col, Number(attrOf(attrs, "s") || 0));
    if (ns == null) return cell;
    const openTag = /^<c\b[^>]*?\/?>/.exec(cell)[0];
    return setAttr(openTag, "s", ns) + cell.slice(openTag.length);
  });
  for (const col of [...need].sort((a, b) => a - b)) {
    if (have.has(col)) continue;
    const ns = cellStyle(col, 0);
    if (ns == null) continue;
    const ref = colLetters(col) + rowN;
    const add = `<c r="${ref}" s="${ns}"/>`;
    // Before the first cell to its right.
    let at = inner.length;
    for (const c of inner.matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)) {
      const r = attrOf(c[1], "r");
      if (r && colIndex(r.replace(/\d+$/, "")) > col) { at = c.index; break; }
    }
    inner = inner.slice(0, at) + add + inner.slice(at);
  }
  return xml.slice(0, m.index) + open + inner + "</row>" + xml.slice(m.index + m[0].length);
}

// ---- matching a hearing to its case folder -------------------------------------

const STOP = new Set(["v", "vs", "versus", "et", "al", "the", "of", "and", "a", "an", "in", "re", "inc", "llc", "lp", "llp", "corp",
  "corporation", "co", "company", "ltd", "pc", "an", "individual", "matter", "estate", "trust", "trustee", "people", "state", "california",
  // A folder's own words that name no party.
  "case", "cases", "folder", "copy", "new", "files", "hearing", "motion"]);
/** The words of a name that say which case it is: lower-cased, no case numbers, no filler. */
export function nameWords(text) {
  const bare = String(text || "").replace(CASE_NO_RE, " ");
  return bare.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
}

/**
 * Whether a place (a folder, a zip, a file) is the hearing's case:
 * `place` is { name, numbers? (case numbers in the files inside it) }.
 * By case number where both have one: the place's name, or a file in it
 * ("Register of Actions 25STCV12345.pdf", which the E-Court Export saves);
 * a place carrying another case's number is never this one. Where either
 * side has none, by name (namesMatch).
 *
 * The owner (2026-11-18), on 0.2.88: "I am still seeing both the case folder
 * and hearing entries for the same cases." The rule was by number alone
 * wherever the sheet gave one, so a folder named for its parties, with no
 * Register of Actions in it, matched no hearing at all.
 */
export function placeMatches(hearing, place) {
  const nums = new Set([...caseNumbersIn(place.name), ...((place.numbers) || [])]);
  if (hearing.caseNumber && nums.size) return nums.has(hearing.caseNumber);
  return namesMatch(hearing, place.name);
}

/**
 * Whether a place's name names the hearing's case: every word of it that
 * says anything (nameWords) stands in the case name or the motion ("ACME
 * Demurrer" for a demurrer in ACME v. Roe), and of them two at least are the
 * case name's, or one of four letters or more ("ACME", not "Roe").
 */
export function namesMatch(hearing, placeName) {
  const fw = nameWords(String(placeName || "").replace(/\.(zip|pdf|docx?|xlsx)$/i, ""));
  if (!fw.length) return false;
  const caseWords = new Set(nameWords(hearing.caseName));
  const motionWords = new Set(nameWords(hearing.motion));
  if (!fw.every((w) => caseWords.has(w) || motionWords.has(w))) return false;
  const naming = fw.filter((w) => caseWords.has(w));
  return naming.length >= 2 || (naming.length === 1 && naming[0].length >= 4);
}

// The E-Court extension's Order Template Input sheet ("Order_Template_Input_
// 25STCV12345.xlsx", order-template.js filenameFor; Chrome adds " (1)" to a
// second): it lands loose in Downloads, where the Word macro looks for it,
// and stays there after that motion is worked up. The owner (2026-11-18):
// one more than two days old is most likely left over from a previous motion
// in the same case, so its case number matches but it says nothing of
// whether the papers for this hearing are downloaded.
export const ORDER_TEMPLATE_RE = /^Order[ _-]?Template[ _-]?Input(?![a-z])/i;
export const LOOSE_STALE_MS = 2 * 86400000;

/**
 * Whether a loose file in Downloads (`name`, written at `at`, ms) counts as
 * the case's: not an Order Template Input sheet more than LOOSE_STALE_MS old.
 */
export function looseFileCounts(name, at, now) {
  if (!ORDER_TEMPLATE_RE.test(String(name || ""))) return true;
  return typeof at === "number" && at > 0 && now - at <= LOOSE_STALE_MS;
}

/**
 * The best place a hearing's case stands, of `places`
 * ([{ name, kind: "opened" | "folder" | "zip" | "file", numbers?, ... }]):
 * an opened or Downloads folder first, then a zip, then loose files; null
 * where none matches. The place itself is handed back, so the caller keeps
 * whatever it attached (a handle, a listing).
 */
const KIND_RANK = { opened: 0, folder: 0, zip: 1, file: 2 };
export function findPlace(hearing, places) {
  let best = null;
  for (const p of places) {
    if (!placeMatches(hearing, p)) continue;
    if (!best || (KIND_RANK[p.kind] ?? 9) < (KIND_RANK[best.kind] ?? 9)) best = p;
  }
  return best;
}

/** What Home says of where the case stands: { text, tone, title }. */
export function placeText(place) {
  if (!place) return { text: "Not downloaded", tone: "warn", title: "No case folder for this case in Downloads or among the folders opened here." };
  if (place.kind === "zip") return { text: "Zip in Downloads", tone: "warn", title: `${place.name} is in Downloads, not extracted yet.` };
  if (place.kind === "file") return { text: "Files in Downloads", tone: "warn", title: `${place.name} is loose in Downloads, in no case folder.` };
  if (place.kind === "opened") return { text: "Downloaded", tone: "ok", title: `Opened here: ${place.name}` };
  return { text: "Downloaded", tone: "ok", title: `In Downloads: ${place.name}` };
}

/**
 * The hearings Home lists, in date order (a date it could not read last):
 * by default the ones on or after today (`now`'s day) not marked done or off.
 * `all` lists every hearing on or after `since` instead.
 */
export function upcoming(hearings, now, { all = false, since = null } = {}) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const from = since == null ? d.getTime() : since;
  return hearings
    .filter((h) => (h.date ? h.date >= from : !!h.dateText) && (all || !h.mark))
    .sort((a, b) => (a.date || Infinity) - (b.date || Infinity) || a.row - b.row);
}

/** "Today", "Tomorrow", "Fri, Nov 20" (", 2027" another year). */
export function dayText(at, now) {
  if (!at) return "";
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const days = Math.round((at - d.getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  const t = new Date(at);
  const opts = { weekday: "short", month: "short", day: "numeric" };
  if (t.getFullYear() !== new Date(now).getFullYear()) opts.year = "numeric";
  return t.toLocaleDateString(undefined, opts);
}

/** Whole calendar days from today to `at`: 0 today, 1 tomorrow, -3 three days ago. */
export function daysAway(at, now) {
  const a = new Date(at); a.setHours(12, 0, 0, 0);
  const d = new Date(now); d.setHours(12, 0, 0, 0);
  return Math.round((a.getTime() - d.getTime()) / 86400000);
}

/** "in 2 days", "3 days ago"; "" for today and tomorrow, which dayText names. */
export function daysAwayText(at, now) {
  if (!at) return "";
  const n = daysAway(at, now);
  if (n === 0 || n === 1) return "";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** "11/12" (this year) or "11/12/25": the Date Submitted as the row says it. */
export function shortDate(at, now) {
  if (!at) return "";
  const t = new Date(at);
  const md = `${t.getMonth() + 1}/${t.getDate()}`;
  return t.getFullYear() === new Date(now).getFullYear() ? md : `${md}/${String(t.getFullYear()).slice(2)}`;
}

/**
 * The hearing a case folder's row shows: the next one on or after today for
 * its case (any mark), else the latest before. `place` as findPlace takes it.
 */
export function hearingForPlace(hearings, place, now) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const mine = hearings.filter((h) => h.date && placeMatches(h, place));
  const next = mine.filter((h) => h.date >= d.getTime()).sort((a, b) => a.date - b.date);
  if (next.length) return next[0];
  return mine.sort((a, b) => b.date - a.date)[0] || null;
}

// ---- the briefing E-Court Suite reports ----------------------------------------
//
// The owner (2026-11-19): integrate Home "with e-court suite so that it can do
// updates on the status of oppositions and replies". PDF+ cannot reach eCourt;
// the E-Court Suite extension can, and works each hearing's briefing out on
// its case page and its day's agenda. Its native host writes what it found to
// BRIEFING_FILE in Downloads (the extension's lib/case-status.js,
// briefingSummary; its service worker; its native host's writeBriefingStatus),
// one entry per hearing:
//   { caseNumber, day: "YYYY-MM-DD", motionType, key, kind: "motion" |
//     "motionOnly" | "osc", motion, opp, reply: { due, filed (ms | null),
//     state: "filed" | "late" | "missing" | "personal" | "pending", note:
//     "Not Filed" | "Not Posted Yet" | "", manual } | null,
//     osc: { text, state: "ok" | "warn" | "note" (only Does left) }, text, at }
// The states are the case page's own colours, so Home says what it says.

export const BRIEFING_FILE = "E-Court Briefing Status.json";

/**
 * The whole file: { entries, refresh, calendar } — calendar is the next ten
 * court days' agendas as Copy All would copy them (calendar-sync.js reads it),
 * or null; refresh is how E-Court Suite's last
 * background or asked-for check went ({ at, state: "running" | "done" |
 * "failed" | "skipped", reason: "signin" | "notab" | "agenda" | …, cases,
 * how: "hourly" | "now" }), or null.
 */
export function parseBriefingFile(text) {
  let data = null;
  try { data = JSON.parse(String(text || "")); } catch { data = null; }
  const refresh = data && data.refresh && typeof data.refresh === "object" && typeof data.refresh.at === "number" ? data.refresh : null;
  const cal = data && data.calendar && typeof data.calendar === "object" && Array.isArray(data.calendar.days) ? data.calendar : null;
  return { entries: parseBriefing(text), refresh, calendar: cal };
}

/** How the last check went, as Home's summary says it: { text, tone ("ok" | "warn" | "run"), title }, or null. */
export function refreshText(refresh, now) {
  if (!refresh) return null;
  const t = new Date(refresh.at);
  const when = t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    + (new Date(now).toDateString() === t.toDateString() ? "" : " " + t.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  if (refresh.state === "running") return { text: "Checking briefing…", tone: "run", title: `E-Court Suite started checking the next five court days at ${when}.` };
  if (refresh.state === "done") return { text: `Briefing checked ${when}`, tone: "ok", title: `E-Court Suite checked ${refresh.cases || 0} hearing${refresh.cases === 1 ? "" : "s"} on the next five court days at ${when}${refresh.how === "now" ? ", asked from Home" : ""}. It checks again every hour on weekdays, 8 AM to 6 PM, while an eCourt tab is open.` };
  const why = {
    signin: "eCourt sign-in needed",
    notab: "no eCourt tab open",
    agenda: "open the eCourt agenda once",
    tab: "the eCourt tab could not be used",
    closed: "the eCourt tab was closed",
  }[refresh.reason] || "it did not finish";
  return { text: `Briefing not checked: ${why}`, tone: "warn", title: `E-Court Suite's check at ${when} did not run through: ${why}${refresh.error ? ` (Chrome said: ${refresh.error})` : ""}. Refresh briefing tries again.` };
}

/** The entries of the file's text, or [] where it is not that file. */
export function parseBriefing(text) {
  let data;
  try { data = JSON.parse(String(text || "")); } catch { return []; }
  if (!data || !Array.isArray(data.entries)) return [];
  return data.entries.filter((e) => e && typeof e.caseNumber === "string" && /^\d{4}-\d\d-\d\d$/.test(e.day || ""));
}

const isoDay = (at) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * The entry for a hearing: the first of briefingsFor's (the best match). null for none.
 */
export function briefingFor(hg, entries, sameDay = null) {
  return briefingsFor(hg, entries, sameDay)[0] || null;
}

// The words a motion is matched by: the sheet's Motion Type (Copy All's, or the
// owner's own, abbreviations and all) against E-Court's motionType.
const MOTION_ABBREVS = [
  [/\bmsj\b/g, "summary judgment"], [/\bmsa\b/g, "summary adjudication"], [/\bmjop\b/g, "judgment pleadings"],
  [/\bmtc\b/g, "compel"], [/\bmts\b/g, "strike"], [/\bmtq\b/g, "quash"], [/\bmil\b/g, "limine"],
  [/\bdemur\b/g, "demurrer"], [/\bjnov\b/g, "notwithstanding verdict"],
];
const MOTION_STOP = new Set(["hearing", "motion", "the", "and", "for", "notice", "without", "with", "not", "initial", "pleading", "filed", "party", "parties", "plaintiff", "plaintiffs", "defendant", "defendants"]);
function motionWords(s) {
  let t = String(s || "").toLowerCase();
  for (const [re, to] of MOTION_ABBREVS) t = t.replace(re, to);
  return new Set(t.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !MOTION_STOP.has(w)));
}
function motionScore(text, e) {
  const want = motionWords(text);
  let n = 0;
  for (const w of motionWords(e && e.motionType)) if (want.has(w)) n++;
  return n;
}
const isStrikeRow = (h) => /\b(motion to )?strike\b/i.test(String(h && h.motion || "")) && !/\bdemurrer\b/i.test(String(h && h.motion || "")) && !/\bcosts?\b/i.test(String(h && h.motion || ""));
const isDemurrerRow = (h) => /\bdemurrer\b/i.test(String(h && h.motion || ""));

/**
 * Every briefing entry a hearing's row shows, as E-Court works a case's
 * motions set the same day (the owner, 2026-11-20: "Look at how e-court
 * handles multiple motions on the same day and make sure that a similar
 * approach works for pdf home page for brief status"): its case page works
 * each motion up apart, under one day (groupWorkableHearings), a standalone
 * motion to strike folded into the same day's demurrer; Copy All writes them
 * all into ONE row's Motion Type. So:
 *
 *   - one sheet row of the case that day (`sameDay`, the sheet's rows of that
 *     case and date; null reads as one): every entry of that case and day, one
 *     per motion, those its Motion Type names first; where some are named and
 *     some not, only the named (an entry for a motion since dropped stays off);
 *   - several rows (the owner split them, or the calendar added one): each row
 *     its own motion's entry, matched one to one by the words their motions
 *     share, best pairs first; a motion-to-strike row beside a demurrer row of
 *     the day shares the demurrer's; one row and one entry left over pair up.
 *
 * Several entries for one motion (an older report) keep the newest.
 */
export function briefingsFor(hg, entries, sameDay = null) {
  if (!hg || !hg.caseNumber || !hg.date || !entries) return [];
  const day = isoDay(hg.date);
  const byMotion = new Map();
  for (const e of entries) {
    if (!e || e.caseNumber !== hg.caseNumber || e.day !== day) continue;
    const k = e.key || String(e.motionType || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const was = byMotion.get(k);
    if (!was || (e.at || 0) > (was.at || 0)) byMotion.set(k, e);
  }
  const mine = [...byMotion.values()];
  if (!mine.length) return [];
  const rows = (sameDay || []).filter((h) => h && h.caseNumber === hg.caseNumber && h.date === hg.date);
  if (!rows.includes(hg)) rows.push(hg);
  // In the order the row names them (Copy All writes the agenda's order),
  // then by how many words they share, then the newest.
  const rowText = (() => { let t = String(hg.motion || "").toLowerCase(); for (const [re, to] of MOTION_ABBREVS) t = t.replace(re, to); return t; })();
  const at = (e) => { let best = Infinity; for (const w of motionWords(e.motionType)) { const i = rowText.indexOf(w); if (i !== -1 && i < best) best = i; } return best; };
  const order = (list, text) => list.slice().sort((a, b) => at(a) - at(b) || motionScore(text, b) - motionScore(text, a) || (b.at || 0) - (a.at || 0));
  if (rows.length <= 1) {
    if (mine.length === 1) return mine;
    const named = mine.filter((e) => motionScore(hg.motion, e) > 0);
    return order(named.length ? named : mine, hg.motion);
  }
  // Several rows: one entry each.
  const demurrer = rows.find((h) => isDemurrerRow(h));
  const own = rows.filter((h) => !(demurrer && isStrikeRow(h)));
  const pairs = [];
  for (const h of own) for (const e of mine) { const sc = motionScore(h.motion, e); if (sc > 0) pairs.push({ h, e, sc }); }
  pairs.sort((a, b) => b.sc - a.sc || (b.e.at || 0) - (a.e.at || 0));
  const got = new Map(), used = new Set();
  for (const p of pairs) if (!got.has(p.h) && !used.has(p.e)) { got.set(p.h, p.e); used.add(p.e); }
  const leftRows = own.filter((h) => !got.has(h)), leftEntries = mine.filter((e) => !used.has(e));
  if (leftRows.length === 1 && leftEntries.length === 1) got.set(leftRows[0], leftEntries[0]);
  const target = demurrer && isStrikeRow(hg) ? demurrer : hg;
  return got.has(target) ? [got.get(target)] : [];
}

/**
 * A short tag for a motion, where a row shows more than one: "MSJ",
 * "Demurrer", "Compel", … (the full motion is the tag's hover).
 */
export function motionTag(motionType) {
  const t = String(motionType || "").replace(/^\s*hearing on\s+/i, "").trim();
  const low = t.toLowerCase();
  if (/summary judgment/.test(low)) return /adjudication/.test(low) ? "MSJ/MSA" : "MSJ";
  if (/summary adjudication/.test(low)) return "MSA";
  if (/judgment on the pleadings/.test(low)) return "MJOP";
  if (/\bdemurrer\b/.test(low)) return "Demurrer";
  if (/\bin limine\b/.test(low)) return "MIL";
  if (/strike or tax costs|tax costs/.test(low)) return "Tax costs";
  if (/new trial/.test(low)) return "New trial";
  if (/reconsider/.test(low)) return "Reconsider";
  const m = t.match(/^(?:motion|petition|application)\s+(?:to|for)\s+(.+)$/i);
  const rest = (m ? m[1] : t).replace(/\b(?:the|of|and|a|an|further|responses?|to|for)\b/gi, " ").replace(/\s+/g, " ").trim();
  const words = rest.split(" ").filter(Boolean).slice(0, 2).join(" ");
  return words ? words[0].toUpperCase() + words.slice(1) : "Motion";
}

const SLOT_NAMES = { motion: "Motion", opp: "Opposition", reply: "Reply" };
const STATE_WORDS = {
  filed: "filed on time",
  late: "filed late",
  missing: "not filed",
  personal: "late for electronic service, timely if personally served: check the proof of service",
  pending: "not due yet",
};
const shortDay = (ms) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/**
 * The chips a hearing row shows for its briefing: [{ label, state, mark,
 * title, due }], `due` the line under the label ("Due 11/14", "" with none), `state` the colour ("filed" green, "late" and "missing" red,
 * "personal" amber, "pending" plain, "unposted" plain and marked as unsure),
 * `mark` the sign after the label (✓, ✗, !, ?, or none). An OSC is one chip.
 */
export function briefingChips(entry) {
  if (!entry) return [];
  if (entry.kind === "osc") {
    // "note": every named defendant is in default or dismissed and only Does
    // are left, a lesser thing than a missing default, so amber, not red.
    const st = entry.osc && entry.osc.state;
    const title = (entry.osc && entry.osc.text) || entry.text || "";
    if (st === "note") return [{ label: "Defaults", state: "personal", mark: "!", title }];
    const warn = st === "warn";
    return [{ label: "Defaults", state: warn ? "missing" : "filed", mark: warn ? "!" : "✓", title }];
  }
  const out = [];
  for (const [k, label] of [["motion", "Mot"], ["opp", "Opp"], ["reply", "Rep"]]) {
    const s = entry[k];
    if (!s) continue;
    let state = s.state, mark = "";
    if (s.note === "Not Posted Yet") { state = "unposted"; mark = "?"; }
    else if (state === "filed") mark = "✓";
    else if (state === "missing") mark = "✗";
    else if (state === "late") mark = "!";
    else if (state === "personal") mark = "!";
    const parts = [];
    if (s.due) parts.push(`due ${shortDay(s.due)}`);
    if (s.filed) parts.push(`filed ${shortDay(s.filed)}`);
    const said = s.note === "Not Posted Yet"
      ? "nothing on file yet, but eCourt posts filings up to 2 court days late"
      : s.note === "Not Filed" ? "not filed" : STATE_WORDS[s.state] || "";
    const title = `${SLOT_NAMES[k]}: ${[said, ...parts].filter(Boolean).join(", ")}${s.manual ? " (picked by hand in E-Court Suite)" : ""}`;
    // The deadline under the label (the owner, 2026-11-20: "expand the Motion
    // Opposition Reply labels to include due dates underneath").
    out.push({ label, state, mark, title, due: s.due ? `Due ${shortDay(s.due)}` : "" });
  }
  return out;
}

// ---- Download the new filing -------------------------------------------------
//
// The owner (2026-11-24): "I want an additional flag when the number of PDFs
// does not increase following the posting of the Opposition or Reply that
// were not previously posted on E-Court. The goal being that If I had not
// previously downloaded them, I would then do so." And: "If no other hearing
// is pending, it should be even broader, so that I can capture other types of
// later filings that might affect that hearing."
//
// E-Court Suite stamps when it first saw each paper filed (`seen` on a slot)
// and each rise in the case's docket (`docket.adds`: { at, n, names }), its
// lib/briefing-news.js. Home keeps each case folder's PDF count over time
// (`log`: [{ at, count }], oldest first). A posting at `at` wants the folder
// to hold more PDFs now than it did then.

/** The folder's PDF count at `at`: the last logged at or before it, or null where Home did not know the folder yet. */
export function pdfCountAt(log, at) {
  let out = null;
  for (const e of log || []) { if (e.at <= at) out = e.count; else break; }
  return out;
}

/** The log with `count` at `now` added where it changed (or was never logged), trimmed to `keepMs`, the last entry always kept. */
export function logPdfCount(log, count, now, keepMs = 45 * 86400000, max = 80) {
  let out = (log || []).slice();
  if (!out.length || out[out.length - 1].count !== count) out.push({ at: now, count });
  // The newest entry at or before the cut stays: it is the count at every
  // moment after the cut until the next.
  let from = 0;
  for (let i = 0; i < out.length; i++) if (out[i].at < now - keepMs) from = i;
  out = out.slice(from);
  if (out.length > max) out = out.slice(-max);
  return out;
}

const NEWS_SLOTS = [["opp", "Opposition", "Opp"], ["reply", "Reply", "Rep"]];

/**
 * The postings a hearing's briefing entries report since `since` (a moment
 * already settled or dismissed): [{ at, want, what: [labels], short: [tags] }],
 * oldest first. An Opposition or Reply each wants a PDF of its own. Where the
 * hearing is the case's only motion on calendar (`onlyMotion`, E-Court Suite
 * 3.49.42+), every rise in the docket is a posting too, wanting at least one
 * PDF however many docket entries it brought (one filing is often a brief, a
 * declaration and a proof of service).
 */
export function newPostings(entries, since = 0) {
  const byAt = new Map();
  const at = (t) => { if (!byAt.has(t)) byAt.set(t, { at: t, slots: 0, docs: 0, what: [], short: [] }); return byAt.get(t); };
  for (const e of entries || []) {
    if (!e || e.kind === "osc") continue;
    for (const [k, word, tag] of NEWS_SLOTS) {
      const s = e[k];
      if (!s || s.filed == null || typeof s.seen !== "number" || s.seen <= since) continue;
      const p = at(s.seen);
      p.slots++;
      p.what.push(word);
      p.short.push(tag);
    }
    if (e.onlyMotion && e.docket && Array.isArray(e.docket.adds)) {
      for (const a of e.docket.adds) {
        if (!a || typeof a.at !== "number" || a.at <= since || !(a.n > 0)) continue;
        const p = at(a.at);
        p.docs += a.n;
        p.names = (a.names || []).filter((x) => typeof x === "string");
      }
    }
  }
  return [...byAt.values()].sort((a, b) => a.at - b.at).map((p) => {
    const what = p.what.slice();
    const short = p.short.slice();
    // A docket rise beyond the Opposition or Reply it brought: other filings.
    if (p.docs > p.slots) {
      const others = (p.names || []).filter((n) => !/^\s*(opposition|reply)\b/i.test(n));
      what.push(...(others.length ? others : [p.docs - p.slots === 1 ? "a filing" : `${p.docs - p.slots} docket entries`]));
      if (!short.length) short.push("filing");
    }
    return { at: p.at, want: Math.max(p.slots, p.docs ? 1 : 0), what, short };
  });
}

/**
 * The flag, or null: { missing, since, before, now, what, short, settled }.
 * Each posting wants the folder to hold, now, its count then plus every PDF
 * that posting and the later ones want. A posting from before Home knew the
 * folder is left out: the folder was downloaded with it. `settled` is the
 * moment every posting is answered (null while one is not), which the caller
 * keeps, so a PDF deleted later does not bring an answered flag back.
 */
export function newFilingFlag(entries, log, since = 0) {
  const posts = newPostings(entries, since).filter((p) => p.want > 0);
  if (!posts.length || !log || !log.length) return null;
  const nowCount = log[log.length - 1].count;
  let worst = null;
  for (let i = 0; i < posts.length; i++) {
    const before = pdfCountAt(log, posts[i].at);
    if (before == null) continue;
    const want = posts.slice(i).reduce((s, p) => s + p.want, 0);
    const missing = before + want - nowCount;
    // On a tie the later posting is the one short: the PDF added between was the earlier one's.
    if (missing > 0 && (!worst || missing >= worst.missing)) worst = { missing, i, before };
  }
  const last = posts[posts.length - 1].at;
  if (!worst) return { missing: 0, settled: last };
  const open = posts.slice(worst.i);
  const short = [...new Set(open.flatMap((p) => p.short))];
  return { missing: worst.missing, since: open[0].at, before: worst.before, now: nowCount, what: open.flatMap((p) => p.what), short, settled: null };
}
