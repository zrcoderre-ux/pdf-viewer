// Node-runnable tests for editing a PDF's own text (viewer/pdf-text-edit.js).
//
// What Edit text promises is that the saved file holds the new words and not
// the old ones — not a white box over them. So each case here writes a PDF,
// edits it, saves it, and reads the text back out with pdf.js (the same
// reader the viewer uses): the old words must be gone, the new ones there,
// and everything else on the page where it was. The pieces under that — the
// content-stream reader, the line layout, and finding paragraphs in pdf.js's
// text items — are checked on their own first.
//
// Run: node test-pdf-text-edit.mjs

import * as pdfjs from "./pdfjs/build/pdf.mjs";
import {
  PDFDocument, StandardFonts, PDFName, PDFDict,
} from "./viewer/vendor/pdf-lib/pdf-lib.esm.min.js";
import {
  parseContent, layoutText, layoutEdit, findTextBlocks, fontStyleFromName,
  applyTextEdits, removeGlyphs, toWinAnsi, standardFontKey, mul, ASCENT,
} from "./viewer/pdf-text-edit.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("./pdfjs/build/pdf.worker.mjs", import.meta.url).href;

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
function ok(label, cond) { check(label, !!cond, true); }
const enc = (s) => new TextEncoder().encode(s);
const r1 = (v) => Math.round(v * 10) / 10;

async function textOf(bytes) {
  const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= d.numPages; i++) {
    const tc = await (await d.getPage(i)).getTextContent();
    pages.push(tc.items.filter((x) => x.str.trim()).map((x) => ({ s: x.str, x: r1(x.transform[4]), y: r1(x.transform[5]) })));
  }
  return pages;
}
const joined = (items) => items.map((i) => i.s).join(" ");
async function blocksOf(bytes, pn = 1) {
  const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  const page = await d.getPage(pn);
  const tc = await page.getTextContent();
  await page.getOperatorList();
  const fontInfo = (fn) => {
    let f = null;
    try { f = page.commonObjs.get(fn); } catch { f = null; }
    return fontStyleFromName(f && f.name, { generic: (f && f.fallbackName) || "" });
  };
  return findTextBlocks(tc.items, { fontInfo, pageBox: page.view });
}

console.log("reading a content stream");
{
  const ops = parseContent(enc("q 1 0 0 1 72 700 cm BT /F1 12 Tf (a\\(b\\)c\\101) Tj [<4142> -250 (C)] TJ ET % a comment\n/P <</MCID 3>> BDC EMC Q"));
  check("operators in order", ops.map((o) => o.op), ["q", "cm", "BT", "Tf", "Tj", "TJ", "ET", "BDC", "EMC", "Q"]);
  check("a literal string with escapes", String.fromCharCode(...ops[4].args[0].v), "a(b)cA");
  check("a TJ array of hex, number and literal", ops[5].args[0].v.map((x) => x.t), ["hex", "num", "str"]);
  check("its hex string", [...ops[5].args[0].v[0].v], [0x41, 0x42]);
  check("a dictionary operand", ops[7].args.map((x) => x.t), ["name", "dict"]);
  const bytes = enc("BT (x) Tj ET");
  const tj = parseContent(bytes).find((o) => o.op === "Tj");
  check("an operation's byte range covers its operands and operator", new TextDecoder().decode(bytes.subarray(tj.start, tj.end)), "(x) Tj");
  const img = parseContent(enc("q BI /W 2 /H 1 /BPC 8 /CS /G ID \x00\x01 EI Q"));
  check("an inline image is one operation", img.map((o) => o.op), ["q", "BI", "Q"]);
  check("matrices multiply as PDF's do", mul([2, 0, 0, 2, 0, 0], [1, 0, 0, 1, 10, 20]), [2, 0, 0, 2, 10, 20]);
}

console.log("\nlaying text out");
{
  const measure = (t, fam, st, size) => t.length * size * 0.5; // every character half an em
  const runs = [{ text: "aaa bbb ccc ddd eee" }];
  const lines = layoutText({ runs, width: 42, size: 10, align: "left" }, measure);
  check("words wrap at the width", lines.map((l) => l.segs.map((s) => s.text).join("")), ["aaa bbb", "ccc ddd", "eee"]);
  const just = layoutText({ runs, width: 42, size: 10, align: "justify" }, measure);
  check("justified lines share out the slack between words, the last line does not", just.map((l) => r1(l.wordSpacing)), [7, 7, 0]);
  const ind = layoutText({ runs, width: 42, size: 10, indent: 10 }, measure);
  check("a first-line indent shortens the first line", ind.map((l) => l.segs.map((s) => s.text).join("")), ["aaa", "bbb ccc", "ddd eee"]);
  check("…and moves it in", ind.map((l) => l.x), [10, 0, 0]);
  const br = layoutText({ runs: [{ text: "one\ntwo" }], width: 100, size: 10, align: "justify" }, measure);
  check("a line break ends a line, unjustified", br.map((l) => [l.segs[0].text, l.hard]), [["one", true], ["two", true]]);
  const mixed = layoutText({ runs: [{ text: "See " }, { text: "Aguilar", italic: true }, { text: ", supra." }], width: 200, size: 10 }, measure);
  check("styles keep their runs on a line", mixed[0].segs.map((s) => [s.text, !!s.italic]), [["See ", false], ["Aguilar", true], [", supra.", false]]);
  const center = layoutText({ runs: [{ text: "abcd" }], width: 40, size: 10, align: "center" }, measure);
  check("centred text sits in the middle", center[0].x, 10);
  const edit = { rect: [72, 0, 172, 700], runs: [{ text: "one two" }], fontSize: 10, lineHeight: 20, font: "serif" };
  const L = layoutEdit(edit);
  check("an edit's first baseline is ASCENT em under its top", L.firstBaseline, 700 - ASCENT * 10);
  check("the standard fonts pick up bold and italic", standardFontKey("serif", { bold: true, italic: true }), "TimesRomanBoldItalic");
  check("what the standard fonts cannot write is folded or marked", toWinAnsi("“quoted” — ok ✓−"), "“quoted” — ok ?-");
}

console.log("\nwhat a font is set in");
{
  check("Times New Roman, bold italic", fontStyleFromName("ABCDEF+TimesNewRomanPS-BoldItalicMT"), { family: "serif", bold: true, italic: true });
  check("Arial", fontStyleFromName("Arial-BoldMT"), { family: "sans", bold: true, italic: false });
  check("Courier", fontStyleFromName("CourierNewPSMT"), { family: "mono", bold: false, italic: false });
  check("an unknown name falls back on pdf.js's family", fontStyleFromName("F1", { generic: "serif" }).family, "serif");
}

console.log("\nfinding paragraphs");
{
  const T = (str, x, y, size = 12, fontName = "R", width = str.length * size * 0.45) => ({ str, transform: [size, 0, 0, size, x, y], width, fontName });
  const J = (str, x, y) => T(str, x, y, 12, "R", 540 - x); // a justified line, out to the margin
  const items = [
    T("MEMORANDUM", 306 - 27, 740, 12, "B", 54),
    // Double-spaced, justified, first line indented half an inch.
    J("Plaintiff contends that the trial court erred when it granted the", 108, 700),
    J("motion, and that the order should be reversed because there was a", 72, 676),
    J("triable issue of material fact on each element of the claim, and", 72, 652),
    T("the record shows it.", 72, 628, 12, "R", 96),
    T("1", 168.5, 632, 8, "R", 4), // a footnote mark just after "it."
    // The next paragraph starts indented at the same spacing.
    J("Defendant does not dispute that the release at issue was signed by", 108, 604),
    T("both parties.", 72, 580),
    // Pleading line numbers down the margin.
    T("1", 30, 700), T("2", 30, 676), T("3", 30, 652), T("4", 30, 628),
  ];
  const fontInfo = (f) => (f === "B" ? { family: "serif", bold: true } : { family: "serif" });
  const blocks = findTextBlocks(items, { fontInfo, pageBox: [0, 0, 612, 792] });
  check("heading, two paragraphs; the margin numbers are not prose", blocks.map((b) => [b.lines, b.text.slice(0, 20)]), [[1, "MEMORANDUM"], [4, "Plaintiff contends t"], [2, "Defendant does not d"]]);
  const p = blocks[1];
  check("its size, spacing and indent", [p.fontSize, p.lineHeight, p.indent], [12, 24, 36]);
  check("it is justified", p.align, "justify");
  check("the footnote mark is a superscript run", p.runs.filter((r) => r.sup).map((r) => r.text.trim()), ["1"]);
  check("the heading is bold and centred", [blocks[0].runs[0].bold, blocks[0].align], [true, "center"]);
  check("lines are joined with spaces", p.text.includes("the motion, and") && p.text.includes("reversed because"), true);
  const short = findTextBlocks([T("A short line ends here.", 72, 700), T("Next line starts a new paragraph", 72, 686), T("that runs on.", 72, 672)], { fontInfo });
  check("a line that ends short, where the next word would have fitted, ends its paragraph", short.map((b) => b.lines), [1, 2]);
  const rotated = findTextBlocks([{ str: "sideways", transform: [0, 12, -12, 0, 100, 100], width: 40, fontName: "R" }], { fontInfo });
  check("rotated text is left alone", rotated.length, 0);
}

console.log("\nediting a document made with the standard fonts");
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([612, 792]);
  ["The quick brown fox jumps over the lazy dog and keeps", "running across the field until the sun goes down behind", "the hills."].forEach((l, i) => page.drawText(l, { x: 72, y: 700 - i * 14, size: 12, font }));
  page.drawText("A second paragraph stays exactly where it was.", { x: 72, y: 640, size: 12, font });
  const src = await doc.save();
  const blocks = await blocksOf(src);
  check("two paragraphs found", blocks.map((b) => b.lines), [3, 1]);
  const d2 = await PDFDocument.load(src);
  const res = await applyTextEdits(d2, [{ page: 1, ...blocks[0], runs: [{ text: "A slow red fox " }, { text: "walks", italic: true }, { text: " home." }], colorAuto: true }]);
  const out = await d2.save();
  const [items] = await textOf(out);
  const t = joined(items);
  check("nothing had to be painted over", res.covered, 0);
  ok("the old words are gone from the file", !/quick|running|hills/.test(t));
  ok("the new words are in it", /A slow red fox/.test(t) && /walks/.test(t) && /home\./.test(t));
  const other = items.find((i) => /second paragraph/.test(i.s));
  check("the other paragraph is where it was", other && [other.x, other.y], [72, 640]);
  const first = items.find((i) => /A slow red fox/.test(i.s));
  check("the new text starts on the old first baseline", first && [first.x, first.y], [72, 700]);
  // The font resources the new text uses are on this page.
  const fonts = d2.getPage(0).node.lookup(PDFName.of("Resources"), PDFDict).lookup(PDFName.of("Font"), PDFDict);
  ok("the italic run uses Times-Italic", [...fonts.values()].some((ref) => {
    const f = d2.context.lookup(ref);
    return f && f.lookup(PDFName.of("BaseFont")).asString() === "/Times-Italic";
  }));
}

console.log("\ntext inside a form shared by two pages");
{
  const srcDoc = await PDFDocument.create();
  const font = await srcDoc.embedFont(StandardFonts.Helvetica);
  srcDoc.addPage([612, 792]).drawText("Letterhead line that is shared by every page.", { x: 72, y: 740, size: 12, font });
  const doc = await PDFDocument.create();
  const [emb] = await doc.embedPdf(await srcDoc.save());
  for (let i = 0; i < 2; i++) doc.addPage([612, 792]).drawPage(emb, { x: 0, y: 0 });
  const src = await doc.save();
  const [b] = await blocksOf(src);
  const d2 = await PDFDocument.load(src);
  const res = await applyTextEdits(d2, [{ page: 1, ...b, runs: [{ text: "Edited on page one only." }], colorAuto: true }]);
  const [p1, p2] = await textOf(await d2.save());
  check("found inside the form, not painted over", res.covered, 0);
  ok("page 1 has the new line and not the old", /Edited on page one only/.test(joined(p1)) && !/Letterhead/.test(joined(p1)));
  ok("page 2, drawing the same form, is untouched", /Letterhead line/.test(joined(p2)) && !/Edited/.test(joined(p2)));
}

console.log("\ntaking one word out of a kerned line");
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const page = doc.addPage([612, 792]);
  page.drawText("x", { x: 10, y: 10, size: 1, font });
  const key = [...page.node.Resources().lookup(PDFName.of("Font"), PDFDict).keys()][0].asString();
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(enc(`BT ${key} 12 Tf 72 700 Td [(Alpha) -500 (Beta) 250 (Gamma)] TJ ET`))));
  const src = await doc.save();
  const d2 = await PDFDocument.load(src);
  // Courier at 12pt: 7.2pt a character. Beta runs from 114 to 142.8.
  const { stats } = removeGlyphs(d2, d2.getPage(0), [[112, 695, 141, 712]]);
  check("four glyphs found", stats[0].count, 4);
  await applyTextEdits(d2, [{ page: 1, orig: [112, 695, 141, 712], rect: [112, 695, 141, 712], runs: [], fontSize: 12, font: "mono", colorAuto: true }]);
  const [items] = await textOf(await d2.save());
  check("the words either side stay exactly where they were", items.map((i) => [i.s.trim(), i.x]), [["Alpha", 72], ["Gamma", 139.8]]);
}

console.log("\na composite (Type0) font");
{
  // Two-byte codes and a /W width array, drawn with raw operators: the
  // glyphs are found by their codes' widths, not by their shapes.
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const ctx = doc.context;
  const desc = ctx.obj({ Type: "Font", Subtype: "CIDFontType2", BaseFont: "Test", CIDSystemInfo: { Registry: ctx.obj("Adobe"), Ordering: ctx.obj("Identity"), Supplement: 0 }, DW: 500, W: [1, [600, 400]] });
  const f0 = ctx.obj({ Type: "Font", Subtype: "Type0", BaseFont: "Test", Encoding: "Identity-H", DescendantFonts: [ctx.register(desc)] });
  page.node.set(PDFName.of("Resources"), ctx.obj({ Font: { F0: ctx.register(f0) } }));
  page.node.set(PDFName.of("Contents"), ctx.register(ctx.flateStream(enc("BT /F0 10 Tf 100 500 Td <000100020001000200010002> Tj ET"))));
  const d2 = await PDFDocument.load(await doc.save());
  // Advances: 6, 4, 6, 4, 6, 4 pt. The third and fourth glyphs: 110 to 120.
  const { stats } = removeGlyphs(d2, d2.getPage(0), [[110.5, 490, 119.5, 515]]);
  check("the two glyphs in the box are found", stats[0].count, 2);
  await applyTextEdits(d2, [{ page: 1, orig: [110.5, 490, 119.5, 515], rect: [110.5, 490, 119.5, 515], runs: [], fontSize: 10, font: "sans", colorAuto: true }]);
  const cs = new TextDecoder().decode(await (await import("./viewer/vendor/pdf-lib/pdf-lib.esm.min.js")).decodePDFRawStream(d2.getPage(0).node.lookup(PDFName.of("Contents"))).decode());
  ok("they are replaced by their advance, the rest kept", /\[<00010002> -1000 <00010002>\] TJ/.test(cs));
}

console.log(`\n${"=".repeat(60)}\nFAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
