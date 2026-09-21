// Node-runnable tests for the text reader's PDF pane decisions (viewer/pdfsync.js).
// Run: node test-pdfsync.mjs

import {
  normalizeStem, spaceStem, matchPdf, pdfMatcher, pageSources, pdfPageOf,
  parsePageRanges, formatPageRanges, swapStoreKey, scrollPosition, scrollTopFor, anchorGeometry,
  pleadingGeometry, lineTop, slotTops, pdfRows, lineSimilarity, alignLines, rowLayout, bodyLeftOf, docBodyLeft,
  matchedScale, spreadTops, pageTypeSize, docTypeSize, typeSizes, combinedMembers, pdfsNear,
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
{
  // A stem ending in an abbreviation's own full stop: "…ISO Pet..pdf" is the
  // name the PDF really has, and the export beside it is one dot short. The
  // exact stem calls them two documents; nothing else about them differs.
  const dotted = ["Payee Supp. Decl. ISO Pet..pdf", "Reply Brief.pdf"];
  check("a name differing only in its punctuation still matches",
    [matchPdf("Payee Supp. Decl. ISO Pet.txt", dotted, null), pdfMatcher(dotted, null)("Payee Supp. Decl. ISO Pet.txt")],
    ["Payee Supp. Decl. ISO Pet..pdf", "Payee Supp. Decl. ISO Pet..pdf"]);
  check("…but an exact stem is still what decides",
    matchPdf("Reply Brief.txt", ["Reply-Brief.pdf", "Reply Brief.pdf"], null), "Reply-Brief.pdf");
  check("…and two candidates answering loosely is no answer, not a guess",
    [matchPdf("A,B.txt", ["A B.pdf", "A.B.pdf"], null), pdfMatcher(["A B.pdf", "A.B.pdf"], null)("A,B.txt")],
    [null, null]);
}
{
  // matchPdf translates every candidate for every name it is asked about; a
  // LEAKS worksheet asks thousands of times, so the same answers are served
  // from an index built once.
  const many = ["Strangeways v Melbury - MTC.txt", "Order.txt", "Strangeways v Melbury - MTC.txt.LEAK", "Reply.txt", "", "Order.txt"];
  const one = pdfMatcher(pdfs, forward);
  check("pdfMatcher answers as matchPdf does, name for name", many.map(one), many.map((n) => matchPdf(n, pdfs, forward)));
  check("…with no key, and with no PDFs",
    [many.map(pdfMatcher(pdfs, null)), many.map(pdfMatcher([], forward))],
    [many.map((n) => matchPdf(n, pdfs, null)), many.map(() => null)]);
  check("…and a forward that throws is still a bare match only",
    many.map(pdfMatcher(pdfs, () => { throw new Error("x"); })), many.map((n) => matchPdf(n, pdfs, () => { throw new Error("x"); })));
  let calls = 0;
  const counted = (t) => { calls++; return forward(t); };
  const m = pdfMatcher(pdfs, counted);
  for (let i = 0; i < 500; i++) m(many[i % many.length]);
  check("…translating each PDF once, however many names are asked about", calls, pdfs.length);
}

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
console.log("combined members");
check("the header's list, in its order", combinedMembers(parseExport(
  "# ----\n# COMBINED TEXT EXPORT — 2 documents in one file\n#\n# Documents in this file:\n#   1. Reply.txt\n#   2. Brief.txt\n#\n# Page numbering restarts\n# ----\n" +
  "\n######## DOCUMENT 1 OF 2 IN THIS COMBINED FILE: Reply.txt ########\n\n====== Page 1 ======\n 1  a\n").pages), ["Reply.txt", "Brief.txt"]);
check("no list: the banners, distinct, in order", combinedMembers(combined.pages), ["Brief.txt", "Reply.txt"]);
check("a lone export has no members", combinedMembers(lone.pages), []);
check("a list line that is not numbered ends the list", combinedMembers(parseExport("# Documents in this file:\n#   1. A.txt\n#\n#   2. B.txt\n").pages), ["A.txt"]);

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
  check("matched lines take their row's top, left and type size", [lay.positions[0], lay.positions[5]], [{ top: 60, left: 200, size: 12 }, { top: 150, left: 90, size: 12 }]);
  check("an unmatched line sits a pitch under the line before, at the page's margin, no size of its own", lay.positions[9], { top: 210 + lay.pitch, left: 72, size: null });
  check("a blank line takes the slot under its predecessor", lay.positions[1].top, 60 + lay.pitch);
  check("the pitch is the median row spacing", lay.pitch, 14);
  check("nothing matched, nothing laid out", rowLayout(["zzz"], rows), null);
  // THE FIRM NAME DOWN THE MARGIN. A pleading's PDF carries furniture the
  // export does not: the firm printed sideways in the left margin, a seal, a
  // stamp. Each is a row, and each starts further left than the body does.
  // Taking the least left of all of them put the body's margin out in the
  // furniture and drew every line the export had no row for out there with
  // it — left of the numbered margin, which is the one line nothing may
  // cross. The margin is the one the rows SHARE.
  {
    const body = [
      { top: 60, left: 96, height: 12, text: "SUPERIOR COURT OF THE STATE OF CALIFORNIA" },
      { top: 74, left: 96, height: 12, text: "Plaintiff alleges as follows:" },
      { top: 88, left: 96, height: 12, text: "1. The parties entered into the agreement." },
      { top: 102, left: 144, height: 12, text: "a. The first exhibit is attached." },
    ];
    const margin = { top: 60, left: 18, height: 9, text: "YARROWVALE HOLLOWMERE FOXGLEN LLP" };
    const withFurniture = [margin, ...body];
    check("the body's margin is the one the rows share, not the furniture's",
      bodyLeftOf(withFurniture), 96);
    const texts = body.map((r) => r.text).concat(["A line the export has that the page has not"]);
    const lay = rowLayout(texts, withFurniture);
    const lefts = lay.positions.map((p) => (p ? p.left : null));
    check("no line is laid left of the numbered margin", lefts.every((l) => l == null || l >= 96), true);
    check("…the line with no row of its own included", lefts[lefts.length - 1], 96);
    check("…and a real indent is still an indent", lefts[3], 144);
    // The caller's own margin wins, since the geometry read it off the numbers.
    const laid = rowLayout(texts, withFurniture, { bodyLeft: 90 });
    check("the margin the caller names is the floor", laid.positions.map((p) => p.left).every((l) => l >= 90), true);
    check("one margin for the whole document, from its pages' geometry",
      docBodyLeft([{ bodyX: 96 }, { bodyX: 98 }, { bodyX: 96 }], null), 96);
    check("…and from the rows where no page gave a geometry",
      docBodyLeft([], [withFurniture, withFurniture]), 96);
  }
}

console.log("a row's own type: one tall glyph does not set the line's size or place");
{
  // A Judicial Council form's small print, with a mark stamped on the line
  // BELOW it in twenty-five point type: the mark's glyph box reaches up into
  // the small print, and its height used to become that whole row's — side
  // by side the parenthetical came out at three times the form's type and ran
  // off the sheet.
  const form = [
    { str: "(If the claimant is an adult with a disability who (1) has capacity to consent to the order requested and (2) does not have a", x: 66, top: 300, w: 400, h: 8 },
    { str: "conservator of the estate, check e. and f. and ensure that the claimant personally reads and signs item 21. (Prob. Code, § 3613.))", x: 66, top: 310, w: 400, h: 8 },
    { str: "e.", x: 66, top: 330, w: 5, h: 8 },
    { str: "H", x: 72, top: 313, w: 12, h: 25 },
    { str: "Has the capacity, within the meaning of Probate Code section 812, to consent to the requested order.", x: 86, top: 330, w: 330, h: 8 },
  ];
  const rows = pdfRows(form, { w: 612, h: 792 });
  check("the stamped glyph joins the line it sits on, not the row its box reaches into", rows.length, 3);
  check("…so the small print is its own line, at its own size and place", [rows[1].text.slice(0, 12), rows[1].top, rows[1].height, rows[1].left], ["conservator ", 310, 8, 66]);
  check("…and the stamped line is set in its body's type, at its body's place", [rows[2].top, rows[2].height], [330, 8]);
  check("a line set wholly in a display size keeps it, the margin's number beside it and all",
    pdfRows([{ str: "ORDER", x: 200, top: 60, w: 90, h: 24 }, { str: "1", x: 40, top: 72, w: 4, h: 12 }], null).map((r) => [r.text, r.top, r.height]),
    [["1 ORDER", 60, 24]]);
  check("a row of one item is that item's, whatever size it is", pdfRows([{ str: "x", x: 10, top: 20, w: 4, h: 30 }], null), [{ top: 20, left: 10, height: 30, text: "x" }]);
  check("no items, no rows", [pdfRows([], null), pdfRows(null, null)], [[], []]);
}

console.log("the type a page is set in: the PDF's own sizes at the reading size");
{
  const rows = [{ top: 60, height: 12, text: "1" }, { top: 60, height: 12, text: "IN THE SUPERIOR COURT" }, { top: 84, height: 12, text: "2" }, { top: 84, height: 12.4, text: "FOR THE COUNTY" }, { top: 700, height: 8, text: "footnote" }];
  check("the body size is the median row height, the margin's numbers left out", pageTypeSize(rows), 12);
  check("no rows, no size", [pageTypeSize([]), pageTypeSize(null)], [null, null]);
  // A PAGE IS NOT A DOCUMENT. An exhibit's title page carries one line, set
  // large, and its own median is that heading: drawn to put THAT at the
  // reading size, the sheet comes out a quarter the size of the filing's
  // other pages and the PDF beside it shrinks to match. The document's own
  // body is the reading, and the title page then shows a large heading on a
  // page the size of the rest, the way the PDF does.
  const title = [{ top: 300, height: 36, text: "EXHIBIT A" }];
  check("the document's body size is read over all of its pages", docTypeSize([rows, title, rows]), 12);
  check("…where a page alone would read its own heading as the body", pageTypeSize(title), 36);
  check("…and the heading keeps its own size at that scale", typeSizes([36], docTypeSize([rows, title, rows])), [36]);
  check("pages not read yet are passed over; none read, no size",
    [docTypeSize([null, rows, null]), docTypeSize([null, null]), docTypeSize([]), docTypeSize(null)], [12, null, null, null]);
  check("a row within a fifth of the body is the body; a heading and a footnote keep their own; a line with no row takes the body", typeSizes([12.4, 11, 18, null, 8], 12), [12, 12, 18, 12, 8]);
  check("no body size: each row its own", typeSizes([10, null], null), [10, null]);
  // 12pt body at a 15px reading size: the sheet is drawn at 1.25, and every point of size grows it.
  check("the body type at the reading size sets the scale", matchedScale(12, 15), 1.25);
  check("a bigger size is a bigger sheet, the spacing untouched", matchedScale(12, 30), 2.5);
  check("no size, no scale", [matchedScale(0, 15), matchedScale(12, 0)], [null, null]);
  check("a misread size cannot blow the sheet up", matchedScale(0.5, 22.5), 8);
  check("lines on the grid are left where they are", spreadTops([36, 60, 84, 108], 24), [36, 60, 84, 108]);
  check("a row printed too close under the one above is pushed down a line", spreadTops([0, 14, 20, 40], 14), [0, 14, 28, 42]);
  check("the push carries until a gap absorbs it", spreadTops([0, 5, 10, 60], 14), [0, 14, 28, 60]);
  check("two lines on one row never share it", spreadTops([100, 100], 24), [100, 124]);
  check("a line with no place is passed over, not pushed", spreadTops([0, null, 3], 14), [0, null, 14]);
  check("each line's own box: a heading's tall box pushes, a footnote's small one does not", spreadTops([0, 10, 30, 36], [22, 14, 14, 9]), [0, 22, 36, 50]);
  check("no box, nothing moves", spreadTops([0, 5], 0), [0, 5]);
}

console.log("the PDFs the reading has reached");
{
  // A reel, or a combined file: three pages of each document, one PDF behind each.
  const many = [];
  for (let d = 0; d < 20; d++) for (let p = 0; p < 3; p++) many.push({ name: `D${d}.pdf` });
  check("the page under the reading line comes first", pdfsNear(many, 7, 40, 4)[0], "D2.pdf");
  check("then outward, a page at a time, either side", pdfsNear(many, 7, 40, 4), ["D2.pdf", "D1.pdf", "D3.pdf", "D0.pdf"]);
  check("the limit is what stops it, not the document", pdfsNear(many, 30, 40, 2), ["D10.pdf", "D9.pdf"]);
  check("reach is in pages: one document either side at three pages each", pdfsNear(many, 9, 3, 9), ["D3.pdf", "D2.pdf", "D4.pdf"]);
  check("a folder of three hundred is still a handful", pdfsNear(new Array(900).fill(0).map((_, i) => ({ name: `D${Math.floor(i / 3)}.pdf` })), 450, 40, 4).length, 4);
  check("at the head of the document it reads forward", pdfsNear(many, 0, 40, 3), ["D0.pdf", "D1.pdf", "D2.pdf"]);
  check("at the foot it reads back", pdfsNear(many, 59, 40, 3), ["D19.pdf", "D18.pdf", "D17.pdf"]);
  check("a page with no PDF is passed over", pdfsNear([null, null, { name: "A.pdf" }, null], 0, 40, 4), ["A.pdf"]);
  check("plain names are names too", pdfsNear(["A.pdf", "B.pdf"], 0, 40, 4), ["A.pdf", "B.pdf"]);
  check("no pages, nothing to hold", pdfsNear([], 0, 40, 4), []);
  check("a limit of none holds none", pdfsNear(many, 0, 40, 0), []);
  check("a reading line past the end is the end", pdfsNear(many, 999, 40, 1), ["D19.pdf"]);
  check("…and before the start is the start", pdfsNear(many, -5, 40, 1), ["D0.pdf"]);
}

check("swap store key", swapStoreKey("Rasho v Quillmark", "Brief.txt"), "textReader.swaps.Rasho v Quillmark/Brief.txt");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
