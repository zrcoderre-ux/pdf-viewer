// Node-runnable tests for comments saved into the PDF (viewer/annot-pdf.js)
// and the page tools in viewer/pdf-edit.js that rewrite a document.
//
// The promise of the annotation layer is that what the viewer draws is what
// the file holds, as ordinary PDF annotations another reader (Acrobat, Chrome,
// Preview) shows. So each kind is written, the file is saved and opened again,
// and what comes back is compared with what went in. Then the document tools:
// each one's output is opened and read for the change it promised.
//
// Run: node test-annot-pdf.mjs

import {
  PDFDocument, PDFName, PDFArray, PDFDict, StandardFonts, degrees,
} from "./viewer/vendor/pdf-lib/pdf-lib.esm.min.js";
import {
  readAnnotations, writeAnnotations, flattenAnnotations,
  quadForRect, quadBox, markupEdge, rotMatrix, uprightSize, wrapLines,
  parsePdfDate, refId, lineRect, inkRect, NM_PREFIX,
} from "./viewer/annot-pdf.js";
import {
  buildEditedPdf, insertBlankPages, cropPages, setMetadata, inspectDocument,
  flattenPdf, sanitizePdf,
} from "./viewer/pdf-edit.js";

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
const r2 = (v) => Math.round(v * 100) / 100;

// A three-page letter-size document with a line of text on each page.
async function sampleBytes(pages = 3) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`Page ${i}: Plaintiff contends that the trial court erred.`, { x: 72, y: 700, size: 12, font });
  }
  doc.setTitle("Sample");
  doc.setAuthor("Original Author");
  return doc.save();
}
const annotsOf = (page) => {
  const arr = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  const out = [];
  if (arr) for (let i = 0; i < arr.size(); i++) out.push(arr.lookup(i, PDFDict));
  return out;
};
const subtype = (d) => { const s = d.get(PDFName.of("Subtype")); return s ? s.asString().slice(1) : ""; };

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

console.log("geometry helpers");
{
  check("an upright quad runs top-left, top-right, bottom-left, bottom-right",
    quadForRect([10, 20, 110, 32]), [10, 32, 110, 32, 10, 20, 110, 20]);
  for (const r of [0, 90, 180, 270]) {
    check(`the box of a quad read at ${r}° is the box it came from`, quadBox(quadForRect([10, 20, 110, 32], r)), [10, 20, 110, 32]);
  }
  check("text read at a quarter turn has its bottom on the right", markupEdge(90), "right");
  check("…and upside down, on top", markupEdge(-180), "top");
  check("a box drawn at 90° swaps width and height", uprightSize([0, 0, 100, 40], 90), [40, 100]);
  check("…and at 180° keeps them", uprightSize([0, 0, 100, 40], 180), [100, 40]);
  check("rotation matrix for 270°", rotMatrix(270), [0, -1, 1, 0, 0, 0]);
  const measure = (s) => s.length * 5;
  check("words wrap to the width, hard breaks kept",
    wrapLines("one two three four\nfive", 50, measure), ["one two", "three four", "five"]);
  check("a word longer than the line still gets its own line",
    wrapLines("supercalifragilistic ok", 50, measure)[0].startsWith("supercal"), true);
  check("a PDF date with a zone is read as that moment",
    parsePdfDate("D:20240131120000Z"), Date.UTC(2024, 0, 31, 12, 0, 0));
  check("…and with an offset", parsePdfDate("D:20240131120000-08'00'"), Date.UTC(2024, 0, 31, 20, 0, 0));
  check("nonsense is no date", parsePdfDate("yesterday"), null);
  check("pdf.js names a reference 12R", refId({ objectNumber: 12, generationNumber: 0 }), "12R");
  check("…and 12R3 past generation 0", refId({ objectNumber: 12, generationNumber: 3 }), "12R3");
  const lr = lineRect([100, 100, 200, 150], 2, true);
  ok("an arrow's rect holds both ends and its head", lr[0] < 100 && lr[1] < 100 && lr[2] > 200 && lr[3] > 150);
  const ir = inkRect([[10, 10, 50, 40]], 4);
  ok("an ink rect holds every point plus half the pen", ir[0] <= 8 && ir[1] <= 8 && ir[2] >= 52 && ir[3] >= 42);
}

console.log("\nevery kind of comment survives a save");
{
  const src = await sampleBytes();
  const doc = await PDFDocument.load(src);
  const list = [
    { id: "a1", page: 1, type: "highlight", rect: [72, 698, 300, 714], quads: [quadForRect([72, 698, 300, 714])], color: [1, 0.83, 0], opacity: 0.5, author: "Tester", contents: "check this", quote: "Plaintiff contends" },
    { id: "a2", page: 1, type: "underline", rect: [72, 680, 300, 694], quads: [quadForRect([72, 680, 300, 694])], color: [0, 0, 1], opacity: 1 },
    { id: "a3", page: 1, type: "strikeout", rect: [72, 660, 300, 674], quads: [quadForRect([72, 660, 300, 674])], color: [1, 0, 0], opacity: 1 },
    { id: "a4", page: 1, type: "note", rect: [500, 700, 520, 720], color: [1, 0.83, 0], contents: "A note — über “quoted”", author: "Me" },
    { id: "a5", page: 1, type: "freetext", rect: [100, 400, 300, 460], text: "A text box that wraps onto more than one line", fontSize: 12, font: "sans", color: [0, 0, 0], borderColor: [1, 0, 0], width: 1, fill: [1, 1, 0.8] },
    { id: "a6", page: 2, type: "ink", rect: inkRect([[100, 100, 150, 150, 200, 120]], 2), inkList: [[100, 100, 150, 150, 200, 120]], color: [1, 0, 0], width: 2 },
    { id: "a7", page: 2, type: "square", rect: [100, 300, 200, 380], color: [0, 0, 1], width: 2, fill: null },
    { id: "a8", page: 2, type: "circle", rect: [250, 300, 350, 380], color: [0, 0.5, 0], width: 2, fill: [0.8, 1, 0.8] },
    { id: "a9", page: 2, type: "arrow", rect: lineRect([100, 500, 300, 600], 2, true), line: [100, 500, 300, 600], color: [0, 0, 0], width: 2 },
    { id: "a10", page: 2, type: "line", rect: lineRect([100, 450, 300, 450], 1, false), line: [100, 450, 300, 450], color: [0, 0, 0], width: 1 },
    { id: "a11", page: 3, type: "stamp", rect: [100, 600, 260, 650], label: "APPROVED", color: [0.1, 0.5, 0.1] },
    { id: "a12", page: 3, type: "symbol", rect: [100, 500, 114, 514], symbol: "check", color: [0, 0, 0] },
    { id: "a13", page: 3, type: "image", role: "signature", rect: [300, 500, 450, 550], image: { data: PNG, format: "png" } },
    { id: "a14", page: 3, type: "typewriter", rect: [100, 300, 250, 316], text: "Jane Doe", fontSize: 12, font: "serif", color: [0, 0, 0], width: 0 },
    { id: "a15", page: 3, type: "whiteout", rect: [100, 200, 200, 220], fill: [1, 1, 1], color: null, width: 0 },
    { id: "a16", page: 3, type: "link", rect: [100, 100, 200, 120], url: "https://example.com/" },
  ];
  await writeAnnotations(doc, list);
  const saved = await doc.save();
  const doc2 = await PDFDocument.load(saved);
  const back = await readAnnotations(doc2);
  check("as many come back as went in", back.length, list.length);
  check("each kind on its page",
    back.map((a) => `${a.type}@${a.page}`).sort(),
    list.map((a) => `${a.type}@${a.page}`).sort());
  const by = (t) => back.find((a) => a.type === t);
  check("a note keeps its words and author", [by("note").contents, by("note").author], ["A note — über “quoted”", "Me"]);
  check("a highlight keeps its comment, quote and opacity",
    [by("highlight").contents, by("highlight").quote, r2(by("highlight").opacity)], ["check this", "Plaintiff contends", 0.5]);
  check("a highlight keeps its quads", by("highlight").quads.map((q) => q.map(r2)), [quadForRect([72, 698, 300, 714])]);
  check("a text box keeps its text and size", [by("freetext").text, by("freetext").fontSize], ["A text box that wraps onto more than one line", 12]);
  check("a text box keeps its fill", by("freetext").fill.map(r2), [1, 1, 0.8]);
  check("added text is still added text, not a text box", by("typewriter").text, "Jane Doe");
  check("a stamp keeps its label", by("stamp").label, "APPROVED");
  check("a checkmark is still a checkmark", by("symbol").symbol, "check");
  ok("a signature comes back as a signature image", by("image").role === "signature" && /^data:image\/png;base64,/.test(by("image").image.data));
  check("an arrow keeps its ends", by("arrow").line.map(r2), [100, 500, 300, 600]);
  check("ink keeps its path", by("ink").inkList[0].map(r2), [100, 100, 150, 150, 200, 120]);
  check("a link keeps its address", by("link").url, "https://example.com/");
  check("whiteout is still whiteout", by("whiteout").type, "whiteout");
  ok("every one is marked as the viewer's own", back.every((a) => a.origRef));

  // What another reader sees: standard subtypes, each with an appearance.
  const dicts = doc2.getPages().flatMap(annotsOf);
  const subs = dicts.map(subtype).filter((s) => s !== "Popup").sort();
  check("the file holds standard annotation types", subs,
    ["Circle", "FreeText", "FreeText", "Highlight", "Ink", "Line", "Line", "Link", "Square", "Square", "Stamp", "Stamp", "Stamp", "StrikeOut", "Text", "Underline"]);
  ok("every visible annotation carries an appearance stream",
    dicts.filter((d) => !["Popup", "Link"].includes(subtype(d))).every((d) => d.get(PDFName.of("AP"))));
  ok("each carries the viewer's name prefix",
    dicts.filter((d) => subtype(d) !== "Popup").every((d) => {
      const nm = d.get(PDFName.of("NM"));
      return nm && nm.decodeText().startsWith(NM_PREFIX);
    }));

  // Edit: remove two, change one, and leave the rest alone.
  const hl = by("highlight"), ul = by("underline"), st = by("strikeout");
  const keep = back.filter((a) => a !== hl && a !== ul);
  st.dirty = true; st.color = [0, 0.6, 0];
  await writeAnnotations(doc2, keep, { removeRefs: new Set([hl.origRef, ul.origRef, st.origRef]) });
  const doc3 = await PDFDocument.load(await doc2.save());
  const back3 = await readAnnotations(doc3);
  check("removing two leaves the rest", back3.length, list.length - 2);
  check("the changed one has its new colour", back3.find((a) => a.type === "strikeout").color.map(r2), [0, 0.6, 0]);
  check("and is there once", back3.filter((a) => a.type === "strikeout").length, 1);

  // Flatten: the marks become page content; links stay links.
  const n = flattenAnnotations(doc3);
  const doc4 = await PDFDocument.load(await doc3.save());
  const left = doc4.getPages().flatMap(annotsOf).map(subtype);
  ok("flatten draws each comment into its page", n >= back3.length - 1);
  check("flatten leaves only the link as an annotation", left, ["Link"]);
}

console.log("\nannotations on a rotated page");
{
  const doc = await PDFDocument.load(await sampleBytes(1));
  doc.getPage(0).setRotation(degrees(90));
  await writeAnnotations(doc, [
    { id: "r1", page: 1, type: "freetext", rect: [100, 100, 160, 300], text: "Sideways", fontSize: 14, font: "sans", color: [0, 0, 0], rotate: 90 },
  ]);
  const doc2 = await PDFDocument.load(await doc.save());
  const [a] = await readAnnotations(doc2);
  check("a text box on a turned page keeps its turn", a.rotate, 90);
  const ap = annotsOf(doc2.getPage(0))[0].lookup(PDFName.of("AP"), PDFDict).lookup(PDFName.of("N"));
  const m = ap.dict.lookup(PDFName.of("Matrix"), PDFArray);
  check("its appearance is drawn turned to match", m && m.asArray().map((v) => v.asNumber()), [0, 1, -1, 0, 0, 0]);
}

console.log("\npage tools");
{
  const src = await sampleBytes(3);

  const blank = await PDFDocument.load(await insertBlankPages({ srcBytes: src, at: 1, count: 2 }));
  check("two blank pages after page 1", blank.getPageCount(), 5);
  check("they take the size of the page before them", [blank.getPage(1).getWidth(), blank.getPage(1).getHeight()], [612, 792]);

  const withAnnots = await buildEditedPdf({
    srcBytes: src,
    annotations: { annots: [{ id: "n", page: 2, type: "note", rect: [10, 10, 30, 30], color: [1, 1, 0], contents: "x" }] },
    appendBytes: [await sampleBytes(2)],
    insertAt: 1,
  });
  const merged = await PDFDocument.load(withAnnots);
  check("insert from file puts the pages where asked", merged.getPageCount(), 5);
  const mergedAnn = await readAnnotations(merged);
  check("and a comment on page 2 follows its page to 4", mergedAnn.map((a) => a.page), [4]);

  const cropped = await PDFDocument.load(await cropPages({ srcBytes: src, margins: { top: 36, left: 18, right: 0, bottom: 0 }, pages: new Set([2]) }));
  const cb = cropped.getPage(1).getCropBox();
  check("crop trims the page's top and left", [cb.x, cb.y, cb.width, cb.height], [18, 0, 594, 756]);
  check("and leaves the other pages whole", cropped.getPage(0).getCropBox().height, 792);

  // On a page turned a quarter, the margin shown on top is the page's own left.
  const turned = await PDFDocument.load(src);
  turned.getPage(0).setRotation(degrees(90));
  const tc = await PDFDocument.load(await cropPages({ srcBytes: await turned.save(), margins: { top: 50, left: 0, right: 0, bottom: 0 }, pages: new Set([1]) }));
  const tb = tc.getPage(0).getCropBox();
  check("crop on a turned page trims the edge that shows on top", [tb.x, tb.y, tb.width, tb.height], [50, 0, 562, 792]);

  const meta = await setMetadata({ srcBytes: src, info: { title: "Motion for Summary Judgment", author: "", subject: "Opposition", keywords: "msj" } });
  const info = await inspectDocument(meta);
  check("properties are written", [info.info.title, info.info.author, info.info.subject], ["Motion for Summary Judgment", "", "Opposition"]);
  check("inspect counts the pages", info.pageCount, 3);

  const flat = await PDFDocument.load(await flattenPdf({ srcBytes: withAnnots }));
  check("flatten leaves no comments", (await readAnnotations(flat)).length, 0);

  const { bytes: clean, removed } = await sanitizePdf({ srcBytes: withAnnots, options: { metadata: true, comments: true } });
  const cleanDoc = await PDFDocument.load(clean, { updateMetadata: false });
  check("sanitize removes the title and author", [cleanDoc.getTitle() || "", cleanDoc.getAuthor() || ""], ["", ""]);
  check("and the comments", (await readAnnotations(cleanDoc)).length, 0);
  ok("and says what it removed", removed.length >= 2);
}

console.log(`\n${"=".repeat(60)}\nFAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
