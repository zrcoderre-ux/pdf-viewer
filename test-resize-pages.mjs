// Node-runnable tests for Resize pages (viewer/pdf-edit.js resizePages,
// resizePlan, pageBoxes): a page over the paper size asked for is scaled onto
// it, centred, with its text still text (read back by pdf.js where it should
// now stand), its comments, links and bookmarks moved with it, and a page that
// already fits left byte for byte as it was.
//
// Run: node test-resize-pages.mjs

import {
  PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFString, StandardFonts, degrees,
} from "./viewer/vendor/pdf-lib/pdf-lib.esm.min.js";
import { resizePages, resizePlan, pageBoxes } from "./viewer/pdf-edit.js";

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
const r2 = (v) => Math.round(v * 100) / 100;
const nums = (arr) => arr.asArray().map((n) => r2(n.asNumber()));

console.log("the plan");
{
  // 20 × 24 in onto Letter: scaled by 612/1440, centred down the page.
  const p = resizePlan({ x: 0, y: 0, width: 1440, height: 1728 }, 612, 792);
  check("an oversized page is scaled to fit and centred", [r2(p.s), r2(p.tx), r2(p.ty), p.w, p.h], [0.43, 0, 28.8, 612, 792]);
  check("a wide page gets the paper landscape", (({ w, h }) => [w, h])(resizePlan({ x: 0, y: 0, width: 1728, height: 1296 }, 612, 792)), [792, 612]);
  check("a page that fits is left alone", resizePlan({ x: 0, y: 0, width: 612, height: 792 }, 612, 792), null);
  check("…a smaller one too", resizePlan({ x: 0, y: 0, width: 400, height: 500 }, 612, 792), null);
  check("…unless every page is asked for: then it is fitted up", r2(resizePlan({ x: 0, y: 0, width: 306, height: 396 }, 612, 792, { onlyLarger: false }).s), 2);
  check("a page offset in its own space is moved to the paper's origin",
    (({ tx, ty }) => [r2(tx), r2(ty)])(resizePlan({ x: 100, y: 50, width: 1224, height: 1584 }, 612, 792)), [-50, -25]);
}

// A document: page 1 is 20 × 24 in, with a line of text, a highlight with a
// comment, a link to a place on itself, a bookmark to it; page 2 is Letter;
// page 3 is 24 × 18 in; page 4 is 18 × 24 in turned a quarter.
async function fixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([1440, 1728]);
  p1.drawText("Exhibit drawing sheet", { x: 100, y: 1600, size: 24, font });
  const p2 = doc.addPage([612, 792]);
  p2.drawText("An ordinary page", { x: 72, y: 700, size: 12, font });
  const p3 = doc.addPage([1728, 1296]);
  p3.drawText("A wide sheet", { x: 100, y: 1200, size: 24, font });
  const p4 = doc.addPage([1296, 1728]);
  p4.setRotation(degrees(90));
  p4.drawText("A turned sheet", { x: 100, y: 1600, size: 24, font });
  const ctx = doc.context;
  const hl = ctx.obj({
    Type: "Annot", Subtype: "Highlight", Rect: [100, 1590, 400, 1630],
    QuadPoints: [100, 1630, 400, 1630, 100, 1590, 400, 1590], Contents: PDFString.of("check this"), RD: [2, 2, 2, 2],
  });
  const link = ctx.obj({
    Type: "Annot", Subtype: "Link", Rect: [100, 100, 300, 140],
    Dest: [p1.ref, PDFName.of("XYZ"), 100, 1600, null],
  });
  p1.node.set(PDFName.of("Annots"), ctx.obj([ctx.register(hl), ctx.register(link)]));
  const outlines = ctx.obj({ Type: "Outlines", Count: 1 });
  const outRef = ctx.register(outlines);
  const item = ctx.obj({ Title: PDFString.of("Drawing"), Parent: outRef, Dest: [p1.ref, PDFName.of("FitH"), 1600] });
  const itemRef = ctx.register(item);
  outlines.set(PDFName.of("First"), itemRef);
  outlines.set(PDFName.of("Last"), itemRef);
  doc.catalog.set(PDFName.of("Outlines"), outRef);
  return doc.save();
}

/** Each page's text items and where pdf.js reads them: [[str, x, y]] per page. */
async function textAt(bytes) {
  const pdfjs = await import("./pdfjs/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: bytes.slice(0), disableWorker: true, isEvalSupported: false, verbosity: 0 }).promise;
  const out = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    out.push(tc.items.filter((i) => i.str.trim()).map((i) => [i.str, r2(i.transform[4]), r2(i.transform[5])]));
  }
  await pdf.destroy();
  return out;
}

console.log("a document resized to Letter");
{
  const src = await fixture();
  check("the dialog's count of each page's size", (await pageBoxes(src)).map((b) => [b.width, b.height, b.rotate]), [[1440, 1728, 0], [612, 792, 0], [1728, 1296, 0], [1296, 1728, 90]]);
  const report = {};
  const out = await resizePages({ srcBytes: src, width: 612, height: 792, report });
  check("the pages over Letter are the ones resized", report.resized, [1, 3, 4]);
  const doc = await PDFDocument.load(out);
  const pages = doc.getPages();
  const size = (p) => { const b = p.getMediaBox(); return [b.x, b.y, b.width, b.height]; };
  check("page 1 is Letter, portrait", size(pages[0]), [0, 0, 612, 792]);
  check("page 2 is as it was", size(pages[1]), [0, 0, 612, 792]);
  check("page 3, wide, is Letter landscape", size(pages[2]), [0, 0, 792, 612]);
  check("page 4, turned, keeps its turn on landscape Letter in its own space", [size(pages[3]), pages[3].getRotation().angle], [[0, 0, 612, 792], 90]);
  const s = 612 / 1440, ty = (792 - s * 1728) / 2;
  const text = await textAt(out);
  check("page 1's text is still text, scaled to where it now stands", text[0], [["Exhibit drawing sheet", r2(100 * s), r2(1600 * s + ty)]]);
  check("page 2's text did not move", text[1], [["An ordinary page", 72, 700]]);
  const a1 = pages[0].node.lookup(PDFName.of("Annots"), PDFArray);
  const hl = a1.lookup(0, PDFDict), link = a1.lookup(1, PDFDict);
  const at = (x, y) => [r2(s * x), r2(s * y + ty)];
  check("the highlight's box moved with the text", nums(hl.lookup(PDFName.of("Rect"))), [...at(100, 1590), ...at(400, 1630)]);
  check("…its quads too", nums(hl.lookup(PDFName.of("QuadPoints"))), [...at(100, 1630), ...at(400, 1630), ...at(100, 1590), ...at(400, 1590)]);
  check("…its margins scaled, not moved", nums(hl.lookup(PDFName.of("RD"))), [0.85, 0.85, 0.85, 0.85]);
  check("…and its comment kept", hl.lookup(PDFName.of("Contents")).decodeText(), "check this");
  const dest = link.lookup(PDFName.of("Dest"), PDFArray);
  check("the link's place on the page moved", [r2(dest.lookup(2).asNumber()), r2(dest.lookup(3).asNumber())], at(100, 1600));
  const out1 = doc.catalog.lookup(PDFName.of("Outlines"), PDFDict).lookup(PDFName.of("First"), PDFDict);
  check("the bookmark's place moved", r2(out1.lookup(PDFName.of("Dest"), PDFArray).lookup(2).asNumber()), at(0, 1600)[1]);
  check("nothing to do is said so (no bytes)", await resizePages({ srcBytes: out, width: 612, height: 792 }), null);
  const only3 = {};
  await resizePages({ srcBytes: src, width: 612, height: 792, pages: new Set([3]), report: only3 });
  check("a chosen page only", only3.resized, [3]);
  const big = {};
  await resizePages({ srcBytes: src, width: 18 * 72, height: 18 * 72, report: big });
  check("under 18 × 18 in, the pages over it are the ones resized", big.resized, [1, 3, 4]);
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
