// Node-runnable tests for the text reader's PDF pane decisions (viewer/pdfsync.js).
// Run: node test-pdfsync.mjs

import {
  normalizeStem, spaceStem, matchPdf, pageSources, pdfPageOf,
  parsePageRanges, formatPageRanges, swapStoreKey, scrollPosition, scrollTopFor, anchorGeometry,
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
check("swap store key", swapStoreKey("Rasho v Quillmark", "Brief.txt"), "textReader.swaps.Rasho v Quillmark/Brief.txt");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
