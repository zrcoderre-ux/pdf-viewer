// Node-runnable tests for the minimal .xlsx reader (viewer/xlsx-read.js).
// Run: node test-xlsx-read.mjs
//
// Builds a small workbook (deflated and stored) in memory and reads it back:
// sheet names in workbook order tied through the rels file, shared strings
// with rich-text runs, inline strings, escaped entities, and sparse cells.

import { deflateRawSync } from "node:zlib";
import { parseXlsx, colIndex, unescapeXml } from "./viewer/xlsx-read.js";

let fails = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        got : ${JSON.stringify(got)}`);
    console.log(`        want: ${JSON.stringify(want)}`);
    fails++;
  }
}

const bytes = (...parts) => Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

function buildZip(files, { stored = false } = {}) {
  const locals = [], centrals = [];
  let off = 0;
  for (const f of files) {
    const raw = Buffer.from(f.text, "utf-8");
    const data = stored ? raw : deflateRawSync(raw);
    const method = stored ? 0 : 8;
    const name = Buffer.from(f.name, "utf-8");
    const local = bytes(u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0), u32(0), u32(data.length), u32(raw.length), u16(name.length), u16(0), name, data);
    centrals.push(bytes(u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0), u32(0), u32(data.length), u32(raw.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), name));
    locals.push(local);
    off += local.length;
  }
  const cd = bytes(...centrals);
  return bytes(...locals, cd, bytes(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(off), u16(0)));
}

const WORKBOOK = `<?xml version="1.0"?><workbook xmlns="x" xmlns:r="r"><sheets><sheet name="Pinned (never in text)" sheetId="2" r:id="rId2"/><sheet name="Pseudonym Key" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const RELS = `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t" Target="/xl/worksheets/sheet2.xml"/></Relationships>`;
const SHARED = `<sst count="3" uniqueCount="3"><si><t>Real Value</t></si><si><r><t>Helen </t></r><r><rPr><b/></rPr><t>Rasho</t></r></si><si><t>A &amp; B &#x27;s</t></si></sst>`;
const SHEET1 = `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Replacement</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2"><v>12</v></c></row><row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" t="b"><v>1</v></c></row></sheetData></worksheet>`;
const SHEET2 = `<worksheet><sheetData><row><c t="inlineStr"><is><t>pinned</t></is></c></row></sheetData></worksheet>`;
const FILES = [
  { name: "xl/workbook.xml", text: WORKBOOK },
  { name: "xl/_rels/workbook.xml.rels", text: RELS },
  { name: "xl/sharedStrings.xml", text: SHARED },
  { name: "xl/worksheets/sheet1.xml", text: SHEET1 },
  { name: "xl/worksheets/sheet2.xml", text: SHEET2 },
];

for (const stored of [false, true]) {
  const wb = await parseXlsx(new Uint8Array(buildZip(FILES, { stored })));
  const tag = stored ? "stored" : "deflated";
  check(`${tag}: sheets in workbook order`, wb.sheets.map((s) => s.name), ["Pinned (never in text)", "Pseudonym Key"]);
  check(`${tag}: rows, rich text joined, sparse cells filled`, wb.sheets[1].rows,
    [["Real Value", "Replacement"], ["Helen Rasho", "", "12"], ["A & B 's", "TRUE"]]);
  check(`${tag}: the other sheet`, wb.sheets[0].rows, [["pinned"]]);
}
check("colIndex", ["A1", "Z9", "AA1", "BC7"].map(colIndex), [0, 25, 26, 54]);
check("entities", unescapeXml("&lt;a&gt; &#65;&#x42;"), "<a> AB");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
