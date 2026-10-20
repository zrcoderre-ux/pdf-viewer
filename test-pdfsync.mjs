// Node-runnable tests for the text reader's PDF pane decisions (viewer/pdfsync.js).
// Run: node test-pdfsync.mjs

import {
  normalizeStem, spaceStem, matchPdf, pdfMatcher, pageSources, pdfPageOf,
  parsePageRanges, formatPageRanges, swapStoreKey, scrollPosition, scrollTopFor, anchorGeometry,
  pleadingGeometry, lineTop, slotTops, pdfRows, lineSimilarity, alignLines, rowLayout, bodyLeftOf, docBodyLeft, bodyRightOf, docBodyRight,
  matchedScale, spreadTops, pageTypeSize, docTypeSize, typeSizes, combinedMembers, pdfsNear,
  offGridTops, holdWithin, rowItemsNear, lineItems, pdfFace, faceKey, numberedRowOf, faceRuns,
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
  // …and carries the item itself, for a line laid on it to set each of its
  // pieces where the PDF prints it (lineItems).
  check("a row of one item is that item's, whatever size it is", pdfRows([{ str: "x", x: 10, top: 20, w: 4, h: 30 }], null),
    [{ top: 20, left: 10, height: 30, text: "x", items: [{ str: "x", x: 10, w: 4, h: 30, base: 50, font: null }] }]);
  check("no items, no rows", [pdfRows([], null), pdfRows(null, null)], [[], []]);
  // A two-column page: the left-hand column's line and the right-hand one's
  // beside it, three points apart and a gutter away — two rows, as the export
  // writes them; a superscript up against its word, and a second column on the
  // same baseline, stay in their row.
  const cols = pdfRows([
    { str: "United States District Court", x: 54, top: 100, w: 150, h: 9.5 },
    { str: "Barbara Delo, a former costumer", x: 318, top: 103, w: 160, h: 9.5 },
    { str: "Barbara DELO, Plaintiff,", x: 90, top: 112, w: 110, h: 9.5 },
  ], null);
  check("two columns on two baselines are two rows", cols.map((r) => [r.text, r.left]),
    [["United States District Court", 54], ["Barbara Delo, a former costumer", 318], ["Barbara DELO, Plaintiff,", 90]]);
  check("a superscript up against its word stays in the row",
    pdfRows([{ str: "Id.", x: 54, top: 100, w: 12, h: 9.5 }, { str: "1", x: 66.5, top: 100.5, w: 3, h: 6 }], null).map((r) => r.text), ["Id. 1"]);
  check("a second column on the same baseline stays in the row",
    pdfRows([{ str: "JANE DOE,", x: 90, top: 300, w: 60, h: 12 }, { str: "Case No.: 25STCV12345", x: 330, top: 300, w: 120, h: 12 }], null).map((r) => r.text), ["JANE DOE, Case No.: 25STCV12345"]);
  // …and the row keeps its items, so a line laid on it finds where that
  // column begins — the item that prints it — and a page whose every line has
  // both halves has its grid read off them (text-reader.js, charGrid's pairs).
  const halves = pdfRows([{ str: "JANE DOE,", x: 90, top: 300, w: 60, h: 12 }, { str: "Case No.: 25STCV12345", x: 330, top: 300, w: 120, h: 12 }], null)[0];
  const line = "JANE DOE," + " ".repeat(48) + "Case No.: 25STCV12345";
  check("…and keeps its items, so a line laid on it finds where that column begins",
    lineItems(line, halves.items).map((g) => [g.at, g.x]), [[0, 90], [57, 330]]);
}

console.log("each piece of a line where the PDF prints it");
{
  // A form's signature block, as a Judicial Council form prints it: the
  // footnote in 7-point and, on its baseline, the 9-point label of the party
  // boxes; then the footnote's next line, and the boxes' labels a row of their
  // own two points lower. The export writes each footnote line with what
  // stands beside it, joined by a space or a few.
  const items = [
    { str: "* If dismissal requested is of specified parties only,", x: 36, top: 482, w: 170, h: 7, font: "f1" },
    { str: "Attorney or party without attorney for", x: 353.6, top: 480, w: 145.6, h: 9, font: "f1" },
    { str: "or of specified cross-complaints only,", x: 36, top: 490.7, w: 120, h: 7, font: "f1" },
    { str: "Plaintiff/Petitioner", x: 377, top: 491.2, w: 70, h: 9, font: "f1" },
    { str: "Defendant/Respondent", x: 483.6, top: 491.2, w: 92.6, h: 9, font: "f2" },
  ];
  const rows = pdfRows(items, { w: 612, h: 792 });
  check("the label on the footnote's baseline is in its row; the boxes' labels are a row of their own",
    rows.map((r) => r.items.map((i) => i.str.slice(0, 9))), [["* If dism", "Attorney "], ["or of spe"], ["Plaintiff", "Defendant"]]);
  const near = (j, taken) => rowItemsNear(rows, j, new Set(taken)).map((c) => [c.it.str.slice(0, 9), c.own]);
  check("a line takes its row's items and those of a row beside it no line has",
    near(1, [0, 1]), [["or of spe", true], ["Plaintiff", false], ["Defendant", false]]);
  check("…but not a row another line was matched to", near(1, [0, 1, 2]), [["or of spe", true]]);
  check("…nor an item standing over one of its own across the page (a line above or below)",
    rowItemsNear([{ top: 0, height: 9, items: [{ str: "a", x: 10, w: 100, h: 9 }] }, { top: 4, height: 9, items: [{ str: "b", x: 50, w: 20, h: 9 }, { str: "c", x: 200, w: 20, h: 9 }] }], 0).map((c) => c.it.str), ["a", "c"]);
  const L0 = "* If dismissal requested is of specified parties only, Attorney or party without attorney for";
  const got0 = lineItems(L0, rowItemsNear(rows, 0, new Set([0, 1])));
  check("each item is found where it begins in the line, at its own x — the label after ONE space a piece of its own",
    got0.map((g) => [g.at, g.x, g.item.h]), [[0, 36, 7], [L0.indexOf("Attorney"), 353.6, 9]]);
  const L1 = "or of specified cross-complaints only,    [   ] Plaintiff/Petitioner [   ] Defendant/Respondent";
  const got1 = lineItems(L1, rowItemsNear(rows, 1, new Set([0, 1])));
  check("a box before a label goes with it: its piece begins at the box, its item at the word",
    got1.map((g) => [L1.slice(g.at, g.at + 5), L1.slice(g.start, g.start + 5), g.x]), [["or of", "or of", 36], ["[   ]", "Plain", 377], ["[   ]", "Defen", 483.6]]);
  // Items that open alike are told apart by order; an item's own "(" is where
  // it begins; a superscript glued to its word begins no piece.
  const form = [
    { str: "Cross-complaint filed", x: 108, w: 84, h: 9 }, { str: "on", x: 194, w: 10, h: 9 }, { str: "(date):", x: 206.6, w: 26, h: 9 },
    { str: "Cross-complaint filed", x: 300, w: 84, h: 9 }, { str: "by", x: 386, w: 9.5, h: 9 }, { str: "(name):", x: 398, w: 31, h: 9 },
  ];
  const line = "Cross-complaint filed on (date):   Cross-complaint filed by (name):";
  check("two items opening alike are found in order, each by its first words",
    lineItems(line, form).map((g) => [g.at, g.x]), [[0, 108], [22, 194], [25, 206.6], [35, 300], [57, 386], [60, 398]]);
  check("a superscript glued to its word is found but begins no piece",
    lineItems("Consent is hereby given.1", [{ str: "Consent is hereby given.", x: 50, w: 100, h: 9 }, { str: "1", x: 150, w: 3, h: 6 }]).map((g) => [g.at, !!g.glued]),
    [[0, false], [24, true]]);
  check("…and nothing begins inside a pseudonym",
    lineItems("Served on Pat Doe Smith today", [{ str: "Served on Pat", x: 10, w: 60, h: 9 }, { str: "Doe Smith today", x: 75, w: 60, h: 9 }], { atoms: [[10, 23]] }).map((g) => !!g.glued),
    [false, true]);
  check("an item of a row beside the line is taken only on four letters or more",
    lineItems("signed by me", [{ it: { str: "signed", x: 10, w: 30, h: 9 }, own: true }, { it: { str: "by", x: 60, w: 9, h: 9 }, own: false }]).length, 1);
  check("an item whose words the line does not carry is not found", lineItems("Plaintiff's motion", [{ str: "Exhibit A", x: 10, w: 40, h: 9 }]), []);
  check("an item read in proportion where what it prints before its word is not in the line",
    lineItems("dismissal", [{ str: "* dismissal", x: 100, w: 44, h: 9 }]).map((g) => g.x), [108]);
}

console.log("the PDF's own typeface");
{
  const SANS = 'Arial, Helvetica, "Liberation Sans", Arimo, "Nimbus Sans", sans-serif';
  const SERIF = '"Times New Roman", Times, "Liberation Serif", Tinos, "Nimbus Roman", serif';
  check("a subset Arial, bold", pdfFace("QZRSCC+Arial-BoldMT", "sans-serif"), { family: SANS, bold: true, italic: false });
  check("…italic", pdfFace("JRFCIQ+Arial-ItalicMT", "sans-serif"), { family: SANS, bold: false, italic: true });
  check("Times, bold italic", pdfFace("TimesNewRomanPS-BoldItalicMT", "serif"), { family: SERIF, bold: true, italic: true });
  check("Helvetica's oblique is its italic", pdfFace("Helvetica-Oblique", "sans-serif").italic, true);
  check("an Adobe face's short italic, and a family the stacks do not name, in pdf.js's family",
    pdfFace("ABCDEF+MyriadPro-BoldIt", "sans-serif"), { family: SANS, bold: true, italic: true });
  check("a face the machine may have goes first, its family behind it",
    [pdfFace("CenturySchoolbook", "sans-serif").family, pdfFace("Calibri,Bold", "sans-serif").family],
    ['"Century Schoolbook", "TeX Gyre Schola", ' + SERIF, "Calibri, Carlito, " + SANS]);
  check("a font not loaded yet: its family alone", pdfFace("", "monospace"),
    { family: '"Courier New", Courier, "Liberation Mono", Cousine, "Nimbus Mono PS", monospace', bold: false, italic: false });
  check("what pdf.js read of a system font counts", pdfFace("F1", "serif", { bold: true }).bold, true);
  check("no face for a symbol font, an OCR layer's or a Type 3 font",
    [pdfFace("ZapfDingbats", "serif"), pdfFace("GlyphLessFont", "sans-serif"), pdfFace("T3Font_0", "sans-serif"), pdfFace("F7", "sans-serif", { isType3Font: true })],
    [null, null, null, null]);
  check("one face, one key", [faceKey(pdfFace("Arial-BoldMT", "sans-serif")) === faceKey(pdfFace("XYZABC+Arial,Bold", "serif")), faceKey(null)], [true, ""]);
}

console.log("the PDF's row for each line of a numbered page");
{
  // Four rows: line 1 with its body, a bare "2", a caption line on the half
  // line between 2 and 3, and line 3 with its body.
  const geom = { y1: 100, pitch: 24, first: 1, last: 28, bodyX: 72, numberRight: 46 };
  const rows = [
    { top: 100, height: 12, text: "1 Body one", items: [{ str: "1", x: 40 }, { str: "Body one", x: 72 }] },
    { top: 124, height: 12, text: "2", items: [{ str: "2", x: 40 }] },
    { top: 136, height: 12, text: "Caption line", items: [{ str: "Caption line", x: 72 }] },
    { top: 148, height: 12, text: "3 Body three", items: [{ str: "3", x: 40 }, { str: "Body three", x: 72 }] },
  ];
  check("a numbered line's row is the one at its number; a bare number is no row; a half line's is the row printed there",
    numberedRowOf([1, 2, null, 3], geom, rows, null, 70.5), [0, null, 2, 3]);
  check("a row the line's words were matched to wins", numberedRowOf([1, 2, null, 3], geom, rows, [null, null, 3, null], 70.5), [0, null, 3, 3]);
  check("no half line between numbers that are not consecutive", numberedRowOf([1, null, 5], geom, rows, null, 70.5), [0, null, null]);
  check("no geometry or no rows, nothing", [numberedRowOf([1], null, rows), numberedRowOf([1], geom, [])], [[null], [null]]);
}

console.log("the runs of a line in the PDF's faces");
{
  const R = { family: "", bold: false, italic: false }, I = { family: "", bold: false, italic: true }, B = { family: "", bold: true, italic: false };
  const faceOf = (f) => (f === "R" ? R : f === "I" ? I : f === "B" ? B : null);
  const item = (start, str, font) => ({ start, item: { str, font } });
  const text = "1. Plaintiff is an individual residing in the County of Sample.";
  check("each item's run, from its text to the next item's",
    faceRuns(text, [item(0, "1. Plaintiff is an", "R"), item(19, "individual", "I"), item(30, "residing in the County of Sample.", "R")], { faceOf }),
    [{ from: 0, to: 19, face: R }, { from: 19, to: 30, face: I }, { from: 30, to: text.length, face: R }]);
  check("an item the line does not carry between two found: the run before it ends where its own text does",
    faceRuns(text, [item(0, "1. Plaintiff is an", "R"), item(30, "residing in the County of Sample.", "R")], { faceOf }),
    [{ from: 0, to: 18, face: R }, { from: 30, to: text.length, face: R }]);
  check("a face that changes in the middle of a word", faceRuns("Smith's motion", [item(0, "Smith", "I"), item(5, "'s motion", "R")], { faceOf }),
    [{ from: 0, to: 5, face: I }, { from: 5, to: 14, face: R }]);
  check("touching runs in one face are one", faceRuns("REQUEST FOR DISMISSAL", [item(0, "REQUEST", "B"), item(8, "FOR DISMISSAL", "B")], { faceOf }),
    [{ from: 0, to: 21, face: B }]);
  check("a face not known is left out", faceRuns("Hello world", [item(0, "Hello", "?"), item(6, "world", "B")], { faceOf }), [{ from: 6, to: 11, face: B }]);
  check("the last run ends where its text does, moved to the nearer edge of a word it would end inside",
    [faceRuns("SUPERIOR COURT OF CALIFORNIA, COUNTY OF SAMPLE", [item(0, "SUPERIOR COURT OF CALIFORNI", "B")], { faceOf })[0].to,
      faceRuns("SUPERIOR COURT OF CALIFORNIA, COUNTY OF SAMPLE", [item(0, "SUPERIOR COURT OF CA", "B")], { faceOf })[0].to],
    [28, 18]);
  check("a next item within two characters takes the run up to itself", faceRuns("Hello, World", [item(0, "Hello", "B"), item(7, "World", "R")], { faceOf }),
    [{ from: 0, to: 7, face: B }, { from: 7, to: 12, face: R }]);
  // A pseudonym is one piece: a run beginning inside it begins after it, and
  // the offsets are the file's (the fake's length, not the real name's).
  const line = "Served on Pat Doe today";
  const fileAt = (i) => (i <= 10 ? i : i >= 17 ? i + 12 : -1); // "Pat Doe" shown; "Strangeways Melbury" in the file
  check("a run beginning inside a pseudonym begins after it, and the one before runs over it, in the file's offsets",
    faceRuns(line, [item(0, "Served on Pat", "R"), item(14, "Doe", "B")], { faceOf, atoms: [[10, 17]], fileAt }), [{ from: 0, to: 29, face: R }]);
  check("…and a run ending inside one ends after it", faceRuns(line, [item(0, "Served on Pa", "B")], { faceOf, atoms: [[10, 17]], fileAt }), [{ from: 0, to: 29, face: B }]);
  check("nothing found, no runs", [faceRuns(line, [], { faceOf }), faceRuns("", [item(0, "x", "B")], { faceOf })], [[], []]);
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
  // Pleading paper: numbered at 0, 24, 48, 72, the caption's single-spaced
  // lines between them half a pitch down, every line 12 points of type.
  const caption = [0, 24, 36, 48, 60, 72];
  const numbered = [true, true, false, true, false, true];
  check("the numbered lines stay on their numbers, the lines between them on their rows",
    spreadTops(caption, 12, numbered), [0, 24, 36, 48, 60, 72]);
  check("…where a whole line's box apiece pushed every number after them down",
    spreadTops(caption, 14.4).map((y) => Math.round(y * 10) / 10), [0, 24, 38.4, 52.8, 67.2, 81.6]);
  check("a line between two numbers too tall for the gap is held above the next, never pushes it",
    spreadTops([0, 24, 36, 48], 14.4, [true, true, false, true]), [0, 24, 38.4, 48]);
  check("lines that cannot all have their room share the space between the numbers evenly",
    spreadTops([0, 24, 25, 26, 27, 48], 12, [true, true, false, false, false, true]), [0, 24, 36, 40, 44, 48]);
  check("a numbered line printed too close under the one above still keeps its number",
    spreadTops([0, 5, 24], 12, [true, true, true]), [0, 5, 24]);
  check("lines above the first number are held above it", spreadTops([20, 22, 24], 12, [false, false, true]), [0, 12, 24]);
  // A two-column page: a left-hand line, the right-hand line three points
  // under it, then the next of each.
  const halves = [[0, 45], [60, 110], [0, 50], [60, 105]];
  check("the two halves of a two-column page are never one line on top of the other",
    spreadTops([0, 3, 12, 15], 11.4, null, halves), [0, 3, 12, 15]);
  check("…where read as one column they pushed every line after them down",
    spreadTops([0, 3, 12, 15], 11.4).map((y) => Math.round(y * 10) / 10), [0, 11.4, 22.8, 34.2]);
  check("a line under both halves clears both", spreadTops([0, 3, 9], 11.4, null, [[0, 45], [60, 110], [0, 110]]), [0, 3, 14.4]);
  check("a left-hand line a character or two into the right-hand column does not touch it",
    spreadTops([0, 3], 11.4, null, [[0, 62], [60, 76]]), [0, 3]);
  check("…but a short line under a long one does", spreadTops([0, 3], 11.4, null, [[17, 41], [27, 29]]), [0, 11.4]);
  check("held on the paper, a half is held only above the lines it stands over",
    holdWithin([0, 3, 12, 15], [11.4, 11.4, 11.4, 11.4], 100, halves), [0, 3, 12, 15]);
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

console.log("lines off the grid, and lines held on the paper");
{
  // A pleading page: 27 and 28 on the grid, then the footer PDF-Linker writes
  // under 28 — blanks, the page number, the document's title.
  const rows = [
    { top: 696, left: 100, height: 12, text: "Line 27 of the motion" },
    { top: 720, left: 50, height: 12, text: "28" },
    { top: 742, left: 290, height: 10, text: "- 1 -" },
    { top: 757, left: 170, height: 9, text: "PLAINTIFF'S NOTICE OF MOTION AND MOTION TO COMPEL" },
  ];
  const texts = ["Line 27 of the motion", "", "", "", "   - 1 -", "", "  PLAINTIFF'S NOTICE OF MOTION AND MOTION TO COMPEL", ""];
  const nums = [27, 28, null, null, null, null, null, null];
  const stacked = [696, 720, 744, 768, 792, 816, 840, 864];
  const got = offGridTops(texts, nums, stacked, rows, 24);
  check("the footer's title goes to its row", got.tops[6], 757);
  check("…at its own type size", got.sizes[6], 9);
  check("a page number with no word in it is matched by its characters", [got.tops[4], got.sizes[4]], [742, 10]);
  check("…and each matched line says which row it was matched to", got.rowOf, [null, null, null, null, 2, null, 3, null]);
  check("the numbered lines are left on the grid", got.tops.slice(0, 2), [696, 720]);
  check("a blank between two placed lines goes between them", got.tops[5], 749.5);
  check("a blank after the last placed row stacks off that row", got.tops[7], 781);
  check("a line whose words are in the body is not pulled up among it",
    offGridTops(["", "Line 27 of the motion"], [27, null], [696, 720], rows, 24).tops[1], 720);
  check("no rows, nothing moves", offGridTops(texts, nums, stacked, null, 24).tops, stacked);

  check("lines that fit are left where they are", holdWithin([0, 20, 40], [14, 14, 14], 100), [0, 20, 40]);
  check("a line past the foot is brought back onto the page", holdWithin([0, 20, 95], [14, 14, 14], 100), [0, 20, 86]);
  check("…and pushes the line above it up only as far as it must", holdWithin([0, 80, 90], [14, 14, 14], 100), [0, 72, 86]);
  check("an empty line holds no room", holdWithin([0, 80, 90], [14, 0, 14], 100), [0, 80, 86]);
  check("lines that cannot all fit are handed back as they were", holdWithin([0, 50, 120], [60, 60, 60], 100), [0, 50, 120]);
  check("a line with no place passes through", holdWithin([null, 95], [14, 14], 100), [null, 86]);
}

console.log("the right margin");
{
  const row = (...its) => ({ items: its.map(([x, w]) => ({ x, w })) });
  check("a page's type ends at its furthest-right row, every piece of it counted", bodyRightOf([row([72, 300]), row([72, 200], [400, 140]), row([90, 100])]), 540);
  check("no rows, no margin", [bodyRightOf([]), bodyRightOf(null)], [null, null]);
  check("the document's margin is the median of its pages'", docBodyRight([[row([72, 468])], [row([72, 470])], [row([72, 200])], null]), 540);
  check("…and none with nothing read", docBodyRight([null, []]), null);
}
check("swap store key", swapStoreKey("Rasho v Quillmark", "Brief.txt"), "textReader.swaps.Rasho v Quillmark/Brief.txt");
// …which the reader asks with the case folder's id, never its bare name: two
// folders of one name keep two lists of swapped pages.
check("swap store key by folder id", [swapStoreKey("/folder/0b5e", "Brief.txt"), swapStoreKey("/folder/77aa", "Brief.txt"), swapStoreKey("", "Brief.txt")],
  ["textReader.swaps./folder/0b5e/Brief.txt", "textReader.swaps./folder/77aa/Brief.txt", "textReader.swaps./Brief.txt"]);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
