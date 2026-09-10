// Node-runnable tests for the workbook writer (viewer/xlsx-write.js).
// Run: node test-xlsx-write.mjs
//
// The property that matters: a LEAKS.xlsx the reader answers comes back as
// the SAME workbook with the Fix? cells changed — every other part byte for
// byte, the edited sheet's other cells untouched, the cell's style kept, and
// the decision written as an inline string that reads back as typed.

import { deflateRawSync, inflateRawSync, crc32 as zlibCrc32 } from "node:zlib";
import { parseXlsx, zipEntries, readEntry } from "./viewer/xlsx-read.js";
import { crc32, colLetters, cellRef, escapeXmlText, setSheetCells, replaceParts, writeSheetCells } from "./viewer/xlsx-write.js";

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

// A zip the way openpyxl writes one: deflated entries, sizes and CRCs in
// both headers, a distinctive timestamp so a copied-through entry can be
// checked to keep it.
function buildZip(files, { stored = false } = {}) {
  const locals = [], centrals = [];
  let off = 0;
  for (const f of files) {
    const raw = Buffer.from(f.text, "utf-8");
    const data = stored ? raw : deflateRawSync(raw);
    const method = stored ? 0 : 8;
    const crc = zlibCrc32(raw) >>> 0;
    const name = Buffer.from(f.name, "utf-8");
    const local = bytes(u32(0x04034b50), u16(20), u16(0), u16(method), u16(0x1234), u16(0x5678), u32(crc), u32(data.length), u32(raw.length), u16(name.length), u16(0), name, data);
    centrals.push(bytes(u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0x1234), u16(0x5678), u32(crc), u32(data.length), u32(raw.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), name));
    locals.push(local);
    off += local.length;
  }
  const cd = bytes(...centrals);
  return bytes(...locals, cd, bytes(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(off), u16(0)));
}

console.log("primitives");
check("crc32 agrees with zlib", [crc32(Buffer.from("")), crc32(Buffer.from("hello LEAKS")), crc32(Buffer.alloc(300, 7))],
  [zlibCrc32(Buffer.from("")) >>> 0, zlibCrc32(Buffer.from("hello LEAKS")) >>> 0, zlibCrc32(Buffer.alloc(300, 7)) >>> 0]);
check("column letters", [0, 1, 25, 26, 27, 701, 702].map(colLetters), ["A", "B", "Z", "AA", "AB", "ZZ", "AAA"]);
check("cell ref", cellRef(5, 1), "B5");
check("xml text escaped, controls dropped, tab and newline kept", escapeXmlText("a<b>&c\td\ne￾"), "a&lt;b&gt;&amp;c\td\ne");

console.log("setSheetCells");
const SHEET = `<worksheet xmlns="x"><dimension ref="A1:C3"/><sheetData>` +
  `<row r="1" spans="1:3"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Fix? (yes/no)</t></is></c><c r="C1" t="s"><v>1</v></c></row>` +
  `<row r="2" spans="1:3"><c r="A2" s="2" t="s"><v>2</v></c><c r="B2" s="3"/><c r="C2" s="2" t="s"><v>3</v></c></row>` +
  `<row r="3" spans="1:3"><c r="A3" s="2" t="s"><v>4</v></c><c r="C3" s="2" t="s"><v>5</v></c></row>` +
  `<row r="4"/>` +
  `</sheetData><dataValidations count="1"><dataValidation type="list" sqref="B2:B9"><formula1>"yes,no"</formula1></dataValidation></dataValidations></worksheet>`;
{
  const out = setSheetCells(SHEET, [{ row: 2, col: 1, text: "yes" }]);
  check("an existing empty cell becomes an inline string, style kept", out.includes(`<c r="B2" s="3" t="inlineStr"><is><t xml:space="preserve">yes</t></is></c>`), true);
  check("nothing else in the row moved", out.includes(`<c r="A2" s="2" t="s"><v>2</v></c><c r="B2" s="3" t="inlineStr">`) && out.includes(`</c><c r="C2" s="2" t="s"><v>3</v></c></row>`), true);
  check("the validation and the rest of the part are untouched", out.endsWith(`<dataValidations count="1"><dataValidation type="list" sqref="B2:B9"><formula1>"yes,no"</formula1></dataValidation></dataValidations></worksheet>`), true);
}
{
  const out = setSheetCells(SHEET, [{ row: 3, col: 1, text: "~Vazquez" }]);
  check("a missing cell is inserted in column order", out.includes(`<c r="A3" s="2" t="s"><v>4</v></c><c r="B3" t="inlineStr"><is><t xml:space="preserve">~Vazquez</t></is></c><c r="C3" s="2" t="s"><v>5</v></c>`), true);
}
{
  const out = setSheetCells(SHEET, [{ row: 4, col: 1, text: "no" }]);
  check("a self-closed row is opened around the cell", out.includes(`<row r="4"><c r="B4" t="inlineStr"><is><t xml:space="preserve">no</t></is></c></row>`), true);
}
{
  const out = setSheetCells(SHEET, [{ row: 6, col: 1, text: "never" }]);
  check("a row the sheet lacks is appended before </sheetData>", out.includes(`<row r="6"><c r="B6" t="inlineStr"><is><t xml:space="preserve">never</t></is></c></row></sheetData>`), true);
}
{
  const out = setSheetCells(SHEET, [{ row: 2, col: 1, text: "yes" }, { row: 2, col: 1, text: "" }]);
  check("clearing writes an empty styled cell", out.includes(`<c r="B2" s="3"/>`) && !out.includes("inlineStr\"><is><t xml:space=\"preserve\">yes"), true);
}
{
  const out = setSheetCells(SHEET, [{ row: 2, col: 1, text: "=Rasho <v. Smith> & Co" }]);
  check("a leading = is text (an inline string is never a formula), markup escaped", out.includes(`<t xml:space="preserve">=Rasho &lt;v. Smith&gt; &amp; Co</t>`), true);
}
{
  const unnumbered = `<worksheet><sheetData><row><c r="A1"><v>1</v></c></row><row><c r="A2"><v>2</v></c></row></sheetData></worksheet>`;
  const out = setSheetCells(unnumbered, [{ row: 2, col: 1, text: "yes" }]);
  check("rows without r= are counted", out.includes(`<row><c r="A2"><v>2</v></c><c r="B2" t="inlineStr">`), true);
}

console.log("the workbook, rewritten");
const WORKBOOK = `<?xml version="1.0"?><workbook xmlns="x" xmlns:r="r"><sheets><sheet name="LEAKS" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const RELS = `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>`;
const SHARED = `<sst count="6" uniqueCount="6"><si><t>Value</t></si><si><t>Context</t></si><si><t>Helen Rasho</t></si><si><r><t>served on </t></r><r><rPr><b/></rPr><t>Helen Rasho</t></r></si><si><t>Vazqez</t></si><si><t>ctx</t></si></sst>`;
const FILES = [
  { name: "[Content_Types].xml", text: `<Types/>` },
  { name: "xl/workbook.xml", text: WORKBOOK },
  { name: "xl/_rels/workbook.xml.rels", text: RELS },
  { name: "xl/sharedStrings.xml", text: SHARED },
  { name: "xl/worksheets/sheet1.xml", text: SHEET },
  { name: "xl/styles.xml", text: `<styleSheet/>` },
];
for (const stored of [false, true]) {
  const tag = stored ? "stored" : "deflated";
  const src = new Uint8Array(buildZip(FILES, { stored }));
  const before = await parseXlsx(src);
  check(`${tag}: the fixture reads as a worksheet`, before.sheets[0].rows[1], ["Helen Rasho", "", "served on Helen Rasho"]);
  const part = before.sheets[0].part;
  check(`${tag}: the sheet's part is named`, part, "xl/worksheets/sheet1.xml");
  const out = await writeSheetCells(src, part, [{ row: 2, col: 1, text: "no" }, { row: 3, col: 1, text: "~Vazquez" }]);
  const after = await parseXlsx(out);
  check(`${tag}: the decisions read back`, after.sheets[0].rows.map((r) => r[1]), ["Fix? (yes/no)", "no", "~Vazquez"]);
  check(`${tag}: the other cells are as they were`, after.sheets[0].rows.map((r) => [r[0], r[2]]), before.sheets[0].rows.map((r) => [r[0], r[2]]));
  // Every untouched entry: same bytes, method, crc, stamp — copied through.
  const ea = zipEntries(src), eb = zipEntries(out);
  check(`${tag}: same entries in the same order`, eb.map((e) => e.name), ea.map((e) => e.name));
  const same = ea.filter((e) => e.name !== part).every((e) => {
    const f = eb.find((x) => x.name === e.name);
    return f && f.method === e.method && f.crc === e.crc && f.usize === e.usize && f.time === 0x1234 && f.date === 0x5678 &&
      Buffer.compare(Buffer.from(src.subarray(e.start, e.start + e.size)), Buffer.from(out.subarray(f.start, f.start + f.size))) === 0;
  });
  check(`${tag}: untouched parts copied byte for byte`, same, true);
  const edited = eb.find((e) => e.name === part);
  const raw = edited.method === 8 ? inflateRawSync(Buffer.from(out.subarray(edited.start, edited.start + edited.size))) : Buffer.from(out.subarray(edited.start, edited.start + edited.size));
  check(`${tag}: the edited part's CRC and size are right`, [zlibCrc32(raw) >>> 0 === edited.crc, raw.length === edited.usize, edited.method], [true, true, 8]);
  check(`${tag}: the edited part reads through the reader`, await readEntry(out, edited) === setSheetCells(SHEET, [{ row: 2, col: 1, text: "no" }, { row: 3, col: 1, text: "~Vazquez" }]), true);
  // Idempotent: writing the same decisions again changes nothing that matters.
  const again = await parseXlsx(await writeSheetCells(out, part, [{ row: 2, col: 1, text: "no" }]));
  check(`${tag}: a second write reads the same`, again.sheets[0].rows, after.sheets[0].rows);
}
{
  const src = new Uint8Array(buildZip(FILES));
  let err = "";
  try { await replaceParts(src, { "xl/worksheets/nope.xml": "<x/>" }); } catch (e) { err = String(e.message); }
  check("a part the workbook lacks is refused", /no part/.test(err), true);
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
