// Node-runnable tests for the text reader's PDF pane decisions (viewer/pdfsync.js).
// Run: node test-pdfsync.mjs

import {
  normalizeStem, spaceStem, matchPdf, pageSources, pdfPageOf,
  parsePageRanges, formatPageRanges, swapStoreKey, scrollPosition, scrollTopFor, anchorGeometry,
  pleadingGeometry, lineTop, slotTops, pdfRows, lineSimilarity, alignLines, rowLayout,
  typePitch, matchedScale,
} from "./viewer/pdfsync.js";
import { parseExport } from "./viewer/textdoc.js";

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

console.log("stems");
check("extensions off, separators spaced, case folded", normalizeStem("Rasho_v-Quillmark  MTC.pdf"), "rasho v quillmark mtc");
check("a quarantined export's double extension", normalizeStem("Text Files/Reply.txt.LEAK"), "reply");
check("spaceStem keeps case", spaceStem("Rasho_v_Quillmark - MTC"), "Rasho v Quillmark MTC");

console.log("matching an export to its PDF");
const forward = (s) => s.replace(/Rasho/g, "Strangeways").replace(/Quillmark/g, "Melbury");
const pdfs = ["Order.pdf", "Rasho v Quillmark - MTC.pdf", "Strangeways Decl.pdf"];
check("the scrubbed stem matches through the key", matchPdf("Strangeways v Melbury - MTC.txt", pdfs, forward), "Rasho v Quillmark - MTC.pdf");
check("a bare stem matches without a key", matchPdf("Order.txt", pdfs, null), "Order.pdf");
check("a quarantined export matches its PDF", matchPdf("Strangeways v Melbury - MTC.txt.LEAK", pdfs, forward), "Rasho v Quillmark - MTC.pdf");
check("the underscore spelling of the PDF matches the spaced export", matchPdf("Strangeways v Melbury MTC.txt", ["Rasho_v_Quillmark_MTC.pdf"], forward), "Rasho_v_Quillmark_MTC.pdf");
check("no match is null", matchPdf("Reply.txt", pdfs, forward), null);
check("a forward that throws is a bare match only", matchPdf("Order.txt", pdfs, () => { throw new Error("x"); }), "Order.pdf");
check("an empty name matches nothing", matchPdf("", pdfs, forward), null);

console.log("page sources");
const combined = parseExport(
  "# Combined\n\n######## DOCUMENT 1 OF 2 IN THIS COMBINED FILE: Brief.txt ########\n\n====== Page 1 ======\n 1  a\n====== Page 2 ======\n 1  b\n" +
  "\n######## DOCUMENT 2 OF 2 IN THIS COMBINED FILE: Reply.txt ########\n\n====== Page 1 ======\n 1  c\n");
// The banner line is a page of its own in the model (no header), then the member's pages.
check("a combined file's pages name their member document", pageSources(combined.pages, "Combined Text.txt"), ["Combined Text.txt", "Brief.txt", "Brief.txt", "Brief.txt", "Reply.txt", "Reply.txt"]);
const lone = parseExport("====== Page 1 ======\n 1  a\n====== Page 2 ======\n 1  b\n");
check("a lone export's pages name the file", pageSources(lone.pages, "Brief.txt"), ["Brief.txt", "Brief.txt"]);
check("a text page's PDF page is its header number", lone.pages.map(pdfPageOf), [1, 2]);
check("a page with no header has no PDF page", pdfPageOf(parseExport("just text\n").pages[0]), null);
check("a combined member's numbering restarts; a banner page has no PDF page", combined.pages.map(pdfPageOf), [null, null, 1, 2, null, 1]);

console.log("page ranges");
check("ranges, singles, either order, sorted unique", parsePageRanges("12-14, 5; 7 3-2 5", 20), { pages: [2, 3, 5, 7, 12, 13, 14], bad: [] });
check("en dash and spaces around it", parsePageRanges("4 – 6", 20), { pages: [4, 5, 6], bad: [] });
check("past the end is reported, not dropped silently", parsePageRanges("3, 25, 30-31", 20), { pages: [3], bad: ["25", "30-31"] });
check("junk is reported", parsePageRanges("a, 2, 0", 20), { pages: [2], bad: ["a", "0"] });
check("empty is empty", parsePageRanges("", 20), { pages: [], bad: [] });
check("no maximum", parsePageRanges("999", null), { pages: [999], bad: [] });
check("format: runs collapse to ranges, pairs stay listed", formatPageRanges([14, 12, 13, 5, 7, 8]), "5, 7, 8, 12-14");
check("format: empty", formatPageRanges([]), "");
check("round trip", parsePageRanges(formatPageRanges([1, 2, 3, 9]), 10).pages, [1, 2, 3, 9]);

console.log("scroll sync");
const tops = [0, 100, 300], heights = [100, 200, 100];
check("position at the top", scrollPosition(0, tops, heights), { index: 0, fraction: 0, above: 0 });
check("position halfway down the second page", scrollPosition(200, tops, heights), { index: 1, fraction: 0.5, above: 0 });
check("position past the end clamps to the last page", scrollPosition(1000, tops, heights), { index: 2, fraction: 1, above: 0 });
check("the same position in a box with other heights", scrollTopFor({ index: 1, fraction: 0.5 }, [0, 400, 800], [400, 400, 400]), 600);
check("an index past the end clamps", scrollTopFor({ index: 9, fraction: 0 }, [0, 400], [400, 400]), 400);
check("no pages", scrollPosition(50, [], []), { index: 0, fraction: 0, above: 0 });
check("above the first page: the padding is carried in pixels", scrollPosition(0, [20, 120], [100, 100]), { index: 0, fraction: 0, above: 20 });
check("…so the other box lands at its own top, whatever its page heights", scrollTopFor({ index: 0, fraction: 0, above: 20 }, [20, 900], [880, 880]), 0);

check("anchors: each page spans first line to the next page's first line", anchorGeometry([60, 460, 900], 1300), { tops: [60, 460, 900], heights: [400, 440, 400] });
check("anchors: a text page and a PDF page meet at their first lines whatever the furniture above", (() => {
  const text = anchorGeometry([80, 380], 700), pdf = anchorGeometry([120, 1100], 2000);
  return [scrollTopFor(scrollPosition(80, text.tops, text.heights), pdf.tops, pdf.heights), scrollTopFor(scrollPosition(380, text.tops, text.heights), pdf.tops, pdf.heights), scrollTopFor(scrollPosition(230, text.tops, text.heights), pdf.tops, pdf.heights)];
})(), [120, 1100, 610]);
check("anchors: an empty list", anchorGeometry([], 0), { tops: [], heights: [] });
console.log("the PDF page's line grid");
{
  const items = [];
  for (let n = 1; n <= 28; n++) items.push({ str: String(n), x: 40, top: 60 + (n - 1) * 24, w: 10, h: 12 });
  items.push({ str: "SUPERIOR COURT", x: 90, top: 60, w: 100, h: 12 }, { str: "v.", x: 90, top: 60 + 3 * 24, w: 10, h: 12 });
  items.push({ str: "2", x: 300, top: 400, w: 6, h: 12 });          // a "2" in the body: not a margin number
  items.push({ str: "Exhibit A", x: 200, top: 740, w: 60, h: 12 });  // below the grid: not the body margin
  const g = pleadingGeometry(items, { w: 612, h: 792 });
  check("line 1, the pitch and the numbers seen", g && [g.y1, g.pitch, g.first, g.last], [60, 24, 1, 28]);
  check("the body starts where the text does, right of the numbers", g && [g.bodyX, g.numberRight], [90, 50]);
  check("line 7 on the grid", lineTop(g, 7), 60 + 6 * 24);
  check("a stray number off the grid is dropped", pleadingGeometry(items.concat([{ str: "5", x: 42, top: 700, w: 8, h: 12 }]), { w: 612, h: 792 }).y1, 60);
  check("fewer than three numbers is no grid", pleadingGeometry(items.slice(0, 2), { w: 612, h: 792 }), null);
  check("numbers all on one line is no grid", pleadingGeometry([{ str: "1", x: 40, top: 60 }, { str: "2", x: 60, top: 60 }, { str: "3", x: 80, top: 60 }], { w: 612, h: 792 }), null);
  const L = (...ns) => ns.map((n) => ({ num: n }));
  check("numbered lines sit at their numbers, an unnumbered one under the line before it", slotTops(L(null, 1, 2, null, 3), g), [36, 60, 84, 108, 108]);
  check("a foot line after 28 sits below 28", slotTops(L(28, null), g), [60 + 27 * 24, 60 + 28 * 24]);
  check("two stamp lines above line 1 stack upward, never above the page", slotTops(L(null, null, 1), { y1: 30, pitch: 24 }), [0, 6, 30]);
  check("no numbered line, nothing to hang on", slotTops(L(null, null), g), [null, null]);
  check("no grid, nothing", slotTops(L(1, 2), null), [null, null]);
}

console.log("a page with no numbers: rows matched by their words");
{
  const items = [
    { str: "ORDER OF DISMISSAL", x: 200, top: 60, w: 120, h: 12 },
    { str: "The court, having considered", x: 72, top: 100, w: 150, h: 12 }, { str: "the motion,", x: 230, top: 100.4, w: 60, h: 12 },
    { str: "orders as follows:", x: 72, top: 114, w: 90, h: 12 },
    { str: "1. The action is dismissed.", x: 90, top: 150, w: 140, h: 12 },
    { str: "2. Each side bears its own fees.", x: 90, top: 164, w: 160, h: 12 },
    { str: "Dated: March 1, 2026", x: 72, top: 210, w: 100, h: 12 },
  ];
  const rows = pdfRows(items, { w: 612, h: 792 });
  check("items on one baseline are one row, in x order", rows.map((r) => r.text), ["ORDER OF DISMISSAL", "The court, having considered the motion,", "orders as follows:", "1. The action is dismissed.", "2. Each side bears its own fees.", "Dated: March 1, 2026"]);
  check("a row carries its top and left", [rows[1].top, rows[1].left, rows[3].left], [100, 72, 90]);
  check("similarity is the share of words in common", [lineSimilarity("The court having considered the motion", "the court, having considered the MOTION,"), lineSimilarity("abc def", "xyz"), lineSimilarity("", "x")], [1, 0, 0]);
  const lines = ["ORDER OF DISMISSAL", "", "The court, having considered the motion,", "orders as follows:", "", "1. The action is dismissed.", "2. Each side bears its own fees.", "", "Dated: March 1, 2026", "Judge of the Superior Court"];
  check("lines match their rows in order, blanks and an unmatched line left out", alignLines(lines, rows.map((r) => r.text)), [0, null, 1, 2, null, 3, 4, null, 5, null]);
  check("a scrubbed name still matches its row on the other words", alignLines(["Plaintiff Ingrid Strangeways alleges that Melbury breached the lease."], ["Plaintiff Helen Rasho alleges that Quillmark breached the lease."]), [0]);
  const lay = rowLayout(lines, rows);
  check("matched lines take their row's top and left", [lay.positions[0], lay.positions[5]], [{ top: 60, left: 200 }, { top: 150, left: 90 }]);
  check("an unmatched line sits a pitch under the line before, at the page's margin", lay.positions[9], { top: 210 + lay.pitch, left: 72 });
  check("a blank line takes the slot under its predecessor", lay.positions[1].top, 60 + lay.pitch);
  check("the pitch is the median row spacing", lay.pitch, 14);
  check("nothing matched, nothing laid out", rowLayout(["zzz"], rows), null);
}

console.log("the scale a page is drawn at: the reading size, never the spacing");
{
  check("a grid of one pitch is that pitch", typePitch([36, 60, 84, 108], 24), 24);
  check("rows printed close together pull the pitch down, floored at half the usual gap", typePitch([0, 14, 28, 34, 48], 14), 7);
  check("a lone tight row does not shrink the whole page", typePitch([0, 24, 48, 50, 74, 98, 122, 146, 170, 194, 218], 24), 24);
  check("no gaps at all falls back to the layout's own pitch", typePitch([40], 14), 14);
  check("no gaps and no fallback is no pitch", typePitch([], 0), null);
  // 15px type at 1.5 leading in a 24pt pleading slot: the sheet is drawn a
  // shade under the PDF's own size, and every point of size grows it.
  check("the leading fills one line slot", matchedScale(24, 22.5), 0.9375);
  check("a bigger size is a bigger sheet, the spacing untouched", matchedScale(24, 45), 1.875);
  check("no pitch, no scale", [matchedScale(0, 22.5), matchedScale(24, 0)], [null, null]);
  check("a misread pitch cannot blow the sheet up", matchedScale(0.5, 22.5), 8);
}

check("swap store key", swapStoreKey("Rasho v Quillmark", "Brief.txt"), "textReader.swaps.Rasho v Quillmark/Brief.txt");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
