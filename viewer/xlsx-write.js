// xlsx-write.js
//
// The one thing the text reader WRITES into a workbook: the Fix? cells of
// PDF-Linker's LEAKS.xlsx, the decisions the operator made in the review
// bar. Nothing else is touched, and the way that is guaranteed is by never
// building a workbook at all: the original zip is copied ENTRY BY ENTRY —
// each part's compressed bytes, method, CRC and timestamp carried through
// exactly as they were — and only the one worksheet part that holds the
// decided cells is replaced, with its cells edited in the XML by reference.
// So the header, the Context quotes with their bold runs (shared strings,
// untouched), the column widths, the Fix? dropdown and everything else
// PDF-Linker wrote come back byte for byte, and the file still reads as
// PDF-Linker's own (`_pn_read_leak_decisions` finds the LEAKS sheet by name
// and the columns by header).
//
// An edited cell is written as an INLINE STRING (`t="inlineStr"`): it needs
// no entry in the shared-string table, every reader reads it (openpyxl, Excel,
// xlsx-read.js), and an inline string can never be a FORMULA — so a cell typed
// as `=CANONICAL` stays the text the operator meant, which is the
// `_pn_xl_plain_cells` rule from this side. The cell's own style (the
// wrap-and-top alignment PDF-Linker gives every cell) is kept.
//
// Pure: bytes in, bytes out; tested from Node in test-xlsx-write.mjs, where
// CompressionStream is a global as it is in Chrome.

import { zipEntries, readEntry } from "./xlsx-read.js";

// ---- crc32 ----------------------------------------------------------------

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}
/** CRC-32 of the bytes, as the zip format wants it. */
export function crc32(bytes) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- cell references and xml text ------------------------------------------

/** 0-based column → letters: 0 → "A", 26 → "AA". */
export function colLetters(col) {
  let n = Math.max(0, Math.floor(col)) + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
/** (row 1-based, col 0-based) → "B5". */
export function cellRef(row, col) {
  return colLetters(col) + String(row);
}

// XML 1.0 refuses the C0 controls (but tab, newline, return), the surrogate
// code points on their own, and U+FFFE/U+FFFF — a cell holding one is a
// worksheet no reader can open (the `_pn_xl_text` lesson). A typed decision
// can only carry one by paste, and it is dropped rather than the cell.
const BAD_XML_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
/** Text made safe for a <t> element. */
export function escapeXmlText(s) {
  return String(s == null ? "" : s)
    .replace(BAD_XML_RE, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function attrOf(tag, name) {
  const m = tag.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'));
  return m ? m[1] : null;
}
function colOfRef(ref) {
  let col = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    col = col * 26 + (c - 64);
  }
  return col > 0 ? col - 1 : 0;
}

/** The <c> element for a cell: an inline string, or an empty styled cell. */
function cellXml(ref, style, text) {
  const s = style ? ` s="${style}"` : "";
  if (text === "" || text == null) return `<c r="${ref}"${s}/>`;
  // xml:space keeps a leading or trailing space (an operator's " yes").
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(text)}</t></is></c>`;
}

/**
 * The sheet XML with `edits` ([{ row, col, text }], row 1-based, col
 * 0-based) applied: each named cell becomes an inline string holding
 * `text` (or an empty cell for ""), keeping the style the cell had. A cell
 * the row does not have is inserted in column order; a row the sheet does
 * not have is inserted in row order. Everything else in the part is left
 * exactly as it was.
 */
export function setSheetCells(xml, edits) {
  let out = String(xml == null ? "" : xml);
  for (const e of edits || []) {
    if (!e || !Number.isInteger(e.row) || e.row < 1 || !Number.isInteger(e.col) || e.col < 0) continue;
    out = setOneCell(out, e.row, e.col, e.text == null ? "" : String(e.text));
  }
  return out;
}

function setOneCell(xml, rowN, col, text) {
  const ref = cellRef(rowN, col);
  // The row, by its r= — every writer this reads (openpyxl, Excel) numbers
  // its rows; a row without r= is found by counting.
  const rowRe = /<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g;
  let m, seq = 0, hit = null, insertBefore = -1;
  while ((m = rowRe.exec(xml))) {
    seq++;
    const rn = parseInt(attrOf(m[1], "r") || "", 10);
    const n = isFinite(rn) && rn >= 1 ? rn : seq;
    if (n === rowN) { hit = m; break; }
    if (n > rowN && insertBefore < 0) insertBefore = m.index;
  }
  if (!hit) {
    const rowXml = `<row r="${rowN}">${cellXml(ref, "", text)}</row>`;
    if (insertBefore >= 0) return xml.slice(0, insertBefore) + rowXml + xml.slice(insertBefore);
    const close = xml.lastIndexOf("</sheetData>");
    if (close >= 0) return xml.slice(0, close) + rowXml + xml.slice(close);
    if (/<sheetData\s*\/>/.test(xml)) return xml.replace(/<sheetData\s*\/>/, `<sheetData>${rowXml}</sheetData>`);
    throw new Error("xlsx: no <sheetData> in the sheet");
  }
  const rowStart = hit.index;
  const whole = hit[0];
  if (hit[2] === "/>") {
    // An empty, self-closed row: open it around the cell.
    const open = whole.slice(0, whole.length - 2) + ">";
    return xml.slice(0, rowStart) + open + cellXml(ref, "", text) + "</row>" + xml.slice(rowStart + whole.length);
  }
  const openTag = whole.slice(0, whole.indexOf(">") + 1);
  const inner = hit[3];
  const innerStart = rowStart + openTag.length;
  const cellRe = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
  let cm, before = -1;
  while ((cm = cellRe.exec(inner))) {
    const r = attrOf(cm[1], "r");
    if (!r) continue;
    const c = colOfRef(r);
    if (c === col) {
      const style = attrOf(cm[1], "s") || "";
      const at = innerStart + cm.index;
      return xml.slice(0, at) + cellXml(ref, style, text) + xml.slice(at + cm[0].length);
    }
    if (c > col && before < 0) before = innerStart + cm.index;
  }
  const at = before >= 0 ? before : innerStart + inner.length;
  return xml.slice(0, at) + cellXml(ref, "", text) + xml.slice(at);
}

// ---- the zip, copied through with one part replaced ------------------------

function u16le(n) { return [n & 0xff, (n >>> 8) & 0xff]; }
function u32le(n) { return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]; }
const enc = new TextEncoder();

async function deflateRaw(bytes) {
  if (typeof CompressionStream === "undefined") return null;
  const cs = new CompressionStream("deflate-raw");
  const body = new Response(new Blob([bytes]).stream().pipeThrough(cs));
  return new Uint8Array(await body.arrayBuffer());
}

/**
 * The workbook `data` with the parts named in `replace` ({ "xl/worksheets/
 * sheet1.xml": "<xml…>" }) replaced by the given text, every other entry
 * copied through untouched — its compressed bytes, method, CRC and stamp
 * from the original central directory. A replaced part is deflated where
 * the platform can (Chrome, Node 18+), else stored. Returns the new bytes.
 */
export async function replaceParts(data, replace) {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  const entries = zipEntries(b);
  const want = new Map(Object.entries(replace || {}));
  for (const name of want.keys()) if (!entries.some((e) => e.name === name)) throw new Error("xlsx: no part " + name);
  const locals = [], centrals = [];
  let off = 0;
  for (const e of entries) {
    let method = e.method, comp, crc, usize;
    const time = e.time, date = e.date;
    if (want.has(e.name)) {
      const raw = enc.encode(want.get(e.name));
      usize = raw.length;
      crc = crc32(raw);
      const packed = await deflateRaw(raw);
      if (packed) { method = 8; comp = packed; } else { method = 0; comp = raw; }
    } else {
      comp = b.subarray(e.start, e.start + e.size);
      crc = e.crc;
      usize = e.usize;
    }
    const name = enc.encode(e.name);
    const local = new Uint8Array([
      ...u32le(0x04034b50), ...u16le(20), ...u16le(0), ...u16le(method), ...u16le(time), ...u16le(date),
      ...u32le(crc), ...u32le(comp.length), ...u32le(usize), ...u16le(name.length), ...u16le(0),
    ]);
    locals.push(local, name, comp);
    centrals.push(new Uint8Array([
      ...u32le(0x02014b50), ...u16le(20), ...u16le(20), ...u16le(0), ...u16le(method), ...u16le(time), ...u16le(date),
      ...u32le(crc), ...u32le(comp.length), ...u32le(usize), ...u16le(name.length), ...u16le(0), ...u16le(0),
      ...u16le(0), ...u16le(0), ...u32le(0), ...u32le(off),
    ]), name);
    off += local.length + name.length + comp.length;
  }
  const cdSize = centrals.reduce((n, p) => n + p.length, 0);
  const eocd = new Uint8Array([
    ...u32le(0x06054b50), ...u16le(0), ...u16le(0), ...u16le(entries.length), ...u16le(entries.length),
    ...u32le(cdSize), ...u32le(off), ...u16le(0),
  ]);
  const total = off + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of locals.concat(centrals, [eocd])) { out.set(part, p); p += part.length; }
  return out;
}

/**
 * The workbook with `edits` applied to the sheet at zip part `partName`
 * (from parseXlsx's sheet.part). The one call the reader makes.
 */
export async function writeSheetCells(data, partName, edits) {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  const entry = zipEntries(b).find((e) => e.name === partName);
  if (!entry) throw new Error("xlsx: no sheet part " + partName);
  const xml = await readEntry(b, entry);
  return replaceParts(b, { [partName]: setSheetCells(xml, edits) });
}
