// Node-runnable tests for the text reader's document model (viewer/textdoc.js).
// Run: node test-textdoc.mjs
//
// The property that matters most is the ROUND TRIP: a PDF-Linker export the
// reader opens and saves without an edit must come back byte for byte, and a
// pseudonym span must always serialize as its FAKE — the real names live on
// top of the file and never in it.

import {
  markCss,
  parseExport, serializeExport, pageLabel, gutterPrefix, pageIsNumbered, shiftDown, shiftUp,
  serializeNodes, textOf, findRealsInPlain,
  serializeHeld, serializeMapped, clipText, editedSpans, spanEdited, typedReals, typedPseudonymsCited, typedSpans, blankRanges, citedNameSpans, insideSpans, occurrencesOf, makeSpot, normalizeSpots, sameSpot, spotsOnPage, spotRanges, fakeFor,
  addValue, removeValue, dropFlagsInKey, keyAnswersFlags, folderStateMoves, legacyStateHold, mergeStoredLists, formatValuesFile, parseValuesFile, parseReaderFile, addKeep, removeKeep, keptControl, flagProblem, phraseProblem, isPhrase,
  keepNeedsRun, owedKeeps, owe, settleLocal, makeKeep,
  isExportName, isKeyName, isQuarantinedName, runMarker, normalizeSettings, fontCss, VALUES_FILE, PAGE_WIDTH,
  ruleParts, ruleShape, clearReading, clearPieces, didNotOcrLines, DID_NOT_OCR,
  columnCuts, columnBands, columnWidths, lineIndent, placeColumns, COLUMN_GAP, COLUMN_REACH, COLUMN_SNAP, COLUMN_GUTTER, COLUMN_STRETCH,
  noOcrLine, setNoOcr, sameNoOcr, readsDidNotOcr, headerSaysDidNotOcr, NOOCR_RE,
  ocrAgainLine, setOcrAgain, OCRAGAIN_RE,
  textFixedLine, setTextFixed, pageTextSum, headerSaysTextCorrected, TEXTFIXED_RE,
  marginNumber, numberChain, misreadNumber, restoreMarginNumbers, pleadingLast,
} from "./viewer/textdoc.js";
import { parseKey, compileForward, compile, compileReals, buildMatcher, forwardRuns, findRealSpans } from "./viewer/pseudo-key.js";

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

// ---- pleading paper -----------------------------------------------------
console.log("numbered margin");
check("three numbered lines make a margin", pageIsNumbered([" 1  a", " 2  b", " 3  c", "stamp"]), true);
check("a lone number on a short page is a margin only where it is half the lines", pageIsNumbered([" 1  Exhibit", "cover"]), true);
check("…and not among prose", pageIsNumbered([" 1  Exhibit", "a", "b", "c"]), false);
check("no numbers, no margin", pageIsNumbered(["a", "b", ""]), false);
check("blank lines do not count against it", pageIsNumbered([" 1  a", "", "", "", " 2  b"]), true);
// A page is a page: neither the width nor the lock that widened it for a long
// line is a setting any more, and an older build's stored copy of them is
// dropped rather than carried about.
check("the sheet is a page of paper, in CSS pixels", PAGE_WIDTH, 816);
check("the width and the lock are gone, and do not come back from storage",
  [normalizeSettings({}).pageWidth, normalizeSettings({ pageWidth: 1400, lineLock: true }).pageWidth, normalizeSettings({ lineLock: true }).lineLock],
  [undefined, undefined, undefined]);

// ---- placeholders ---------------------------------------------------------
console.log("placeholders");
{
  const el = (name, kids, attrs) => ({ nodeType: 1, nodeName: name, childNodes: kids, getAttribute: (k) => (attrs && attrs[k]) || null });
  const tx = (d) => ({ nodeType: 3, data: d });
  const withSiblings = (kids) => { kids.forEach((k, i) => { k.nextSibling = kids[i + 1] || null; }); return kids; };
  const br = () => el("BR", []);
  check("a <br> closing its block is a placeholder, not a line", serializeNodes(el("DIV", withSiblings([el("DIV", withSiblings([tx("a")])), el("DIV", withSiblings([br()])), el("DIV", withSiblings([tx("b"), br()]))]))), "a\n\nb");
  check("a <br> with something after it is still a line break", serializeNodes(el("DIV", withSiblings([tx("a"), br(), tx("b")]))), "a\nb");
}

// ---- fixed line slots -------------------------------------------------------
console.log("fixed line slots");
const L = (...t) => t.map((x) => ({ num: true, text: x }));
const texts = (r) => r.lines.map((l) => (l.num ? "" : "~") + l.text);
check("Enter sends the tail down into the first blank slot below", texts(shiftDown(L("abc", "def", "", "ghi"), 0, "a", "bc")), ["a", "bc", "def", "ghi"]);
check("…the numbers stay where they are", shiftDown(L("abc", "def", "", "ghi"), 0, "a", "bc").lines.map((l) => l.num), [true, true, true, true]);
check("with no blank slot the last line's text lands on a new unnumbered line", texts(shiftDown(L("abc", "def"), 0, "abc", "")), ["abc", "", "~def"]);
check("Enter at the end of the last line adds an unnumbered line", shiftDown(L("abc"), 0, "abc", "").appended, true);
check("the caret goes to the slot below", shiftDown(L("abc", ""), 0, "ab", "c").target, 1);
check("Backspace at the start of a line joins it above and pulls the run up", texts(shiftUp(L("ab", "cd", "ef", "", "gh"), 1)), ["abcd", "ef", "", "", "gh"]);
check("…and reports where the join is, for the caret", shiftUp(L("ab", "cd"), 1).joinAt, 2);
check("a run reaching an unnumbered foot line drops that line", (() => { const r = shiftUp([{ num: true, text: "ab" }, { num: true, text: "cd" }, { num: false, text: "ef" }], 1); return [texts(r), r.dropped]; })(), [["abcd", "ef"], true]);
check("a numbered last slot is emptied, never dropped", (() => { const r = shiftUp(L("ab", "cd", "ef"), 1); return [texts(r), r.dropped]; })(), [["abcd", "ef", ""], false]);
// The blank slot Enter absorbed cannot be told from any other once the run is
// contiguous, so Backspace leaves the blank at the END of the run (Ctrl+Z is
// the exact inverse).
check("Enter then Backspace: the text is back, the blank slot at the run's end", (() => { const a = shiftDown(L("abc", "def", "", "x"), 0, "a", "bc"); const b = shiftUp(a.lines, 1); return texts(b); })(), ["abc", "def", "x", ""]);
check("Backspace at the first line does nothing", shiftUp(L("ab"), 0).joinAt, -1);

// ---- pages ----------------------------------------------------------------
console.log("pages");
const EXPORT =
  "====== Page 1 ======\n" +
  " 1  SUPERIOR COURT OF CALIFORNIA\n" +
  " 2  Ingrid Strangeways, Plaintiff,\n" +
  "\n" +
  "====== Page 2 (printed p. 1) — REVIEW: recognised at only 99 dpi, text is LOW CONFIDENCE ======\n" +
  "10  (Kremerman v. White (2021) 71 Cal.App.5th 358.)\n" +
  "28  end\n";
const doc = parseExport(EXPORT);
check("two pages", doc.pages.length, 2);
check("page numbers", doc.pages.map((p) => p.number), [1, 2]);
check("printed and review read off the header", [doc.pages[1].printed, doc.pages[1].review],
  ["1", "REVIEW: recognised at only 99 dpi, text is LOW CONFIDENCE"]);
check("lines kept, blanks included", doc.pages[0].lines, [" 1  SUPERIOR COURT OF CALIFORNIA", " 2  Ingrid Strangeways, Plaintiff,", ""]);
check("round trip", serializeExport(doc), EXPORT);
check("label", pageLabel(doc.pages[1]), "Page 2 (printed p. 1)");

const NOHDR = "line one\r\nline two";
const d2 = parseExport(NOHDR);
check("a Word export is one page with no header", [d2.pages.length, d2.pages[0].header, d2.pages[0].lines], [1, null, ["line one", "line two"]]);
check("CRLF and no trailing newline survive", serializeExport(d2), NOHDR);
check("empty file", serializeExport(parseExport("")), "");
check("preamble before the first header", parseExport("stray\n====== Page 1 ======\nx\n").pages.map((p) => [p.header, p.lines]),
  [[null, ["stray"]], ["====== Page 1 ======", ["x"]]]);

const COMBINED =
  "COMBINED TEXT EXPORT\n" +
  "#### DOCUMENT 1 OF 2 IN THIS COMBINED FILE: Brief.txt ####\n" +
  "====== Page 1 ======\n" +
  "a\n" +
  "#### DOCUMENT 2 OF 2 IN THIS COMBINED FILE: Reply.txt ####\n" +
  "====== Page 1 ======\n" +
  "b\n";
const d3 = parseExport(COMBINED);
check("banners open their own pages", d3.pages.map((p) => pageLabel(p)),
  ["", "Document 1 of 2: Brief.txt", "Page 1", "Document 2 of 2: Reply.txt", "Page 1"]);
check("combined round trip", serializeExport(d3), COMBINED);

check("gutter prefix", gutterPrefix(" 2  Ingrid Strangeways"), { gutter: " 2  ", rest: "Ingrid Strangeways" });
check("gutter with a wide indent", gutterPrefix("12        NOTICE").gutter, "12        ");
check("no gutter on prose", gutterPrefix("2. The parties"), null);
check("an empty numbered line is all gutter", gutterPrefix(" 3"), { gutter: " 3", rest: "" });
check("a bare number followed by text is not a gutter", gutterPrefix("3 items"), null);

// ---- the DOM walk, on a minimal node tree ------------------------------------
console.log("serialization");
const T = (s) => ({ nodeType: 3, data: s });
const E = (name, attrs, kids) => {
  const childNodes = kids || [];
  childNodes.forEach((k, i) => { k.nextSibling = childNodes[i + 1] || null; }); // a <br> asks whether it closes its element
  return { nodeType: 1, nodeName: name, childNodes, getAttribute: (k) => (attrs && k in attrs ? attrs[k] : null) };
};
const body = E("DIV", {}, [
  E("SPAN", { class: "gutter" }, [T(" 2  ")]),
  T("Plaintiff "),
  E("SPAN", { "data-fake": "Ingrid Strangeways" }, [T("Helen Rasho")]),
  T(" sued\ntwice"),
  E("BR"),
  E("DIV", {}, [T("a wrapped div")]),
]);
check("disk gets the fake", serializeNodes(body), " 2  Plaintiff Ingrid Strangeways sued\ntwice\n\na wrapped div");
check("screen gets the real", textOf(body), " 2  Plaintiff Helen Rasho sued\ntwice\n\na wrapped div");
check("a leading div adds no newline", serializeNodes(E("DIV", {}, [E("DIV", {}, [T("x")]), E("DIV", {}, [T("y")])])), "x\ny");

// ---- spot keeps: one occurrence left as it reads ---------------------------------
console.log("spot keeps");
{
  // The Clerk's name on a pleading: "David" faked in one place, kept where it
  // stands in the other, and a line number in the gutter before both.
  const page = E("DIV", {}, [
    E("SPAN", { class: "gutter" }, [T(" 1  ")]),
    T("Plaintiff "),
    E("SPAN", { "data-fake": "Party7", "data-real": "David" }, [T("David")]),
    T(" Smith, by "),
    E("SPAN", { "data-here": "" }, [T("David")]),
    T(" W. Slayton, Clerk"),
  ]);
  check("disk gets the fake where it is faked and the real where it is kept",
    serializeNodes(page), " 1  Plaintiff Party7 Smith, by David W. Slayton, Clerk");
  check("the screen reads the same either way",
    textOf(page), " 1  Plaintiff David Smith, by David W. Slayton, Clerk");
  const held = serializeHeld(page);
  check("serializeHeld gives the same text as a plain save", held.text, serializeNodes(page));
  check("…and where the kept spot landed in it", held.held, [[31, 36]]);
  check("the range is the value itself", held.text.slice(31, 36), "David");
  check("…and where the run's fake landed, which the marks read blanked", [held.pns, held.text.slice(14, 20)], [[[14, 20]], "Party7"]);
  check("a page with no pseudonym holds none", serializeHeld(E("DIV", {}, [T("plain")])).pns, []);
  check("a page with no spot keep holds none", serializeHeld(E("DIV", {}, [T("plain")])).held, []);
  check("an empty spot span is not a range", serializeHeld(E("DIV", {}, [E("SPAN", { "data-here": "" }, [])])).held, []);

  check("blanking holds every other offset still",
    blankRanges("by David W. Slayton", [[3, 8]]), "by \u0000\u0000\u0000\u0000\u0000 W. Slayton");
  check("nothing to blank, nothing changed", blankRanges("as it reads", []), "as it reads");
  // Order, overlap and the end of the text: blanking is idempotent, so none of
  // them can change the answer — and the string has to come out the length it
  // went in, since every offset the caller holds was read off the original.
  check("out of order is the same answer", blankRanges("by David W. Slayton", [[9, 11], [3, 8]]), "by \u0000\u0000\u0000\u0000\u0000 \u0000\u0000 Slayton");
  check("overlapping ranges blank their union", blankRanges("by David W. Slayton", [[3, 8], [5, 11]]), "by \u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000 Slayton");
  check("one inside another", blankRanges("by David W. Slayton", [[3, 11], [5, 8]]), "by \u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000 Slayton");
  check("a range past the end stops at it", blankRanges("by David", [[3, 99]]), "by \u0000\u0000\u0000\u0000\u0000");
  check("an empty range blanks nothing", blankRanges("by David", [[4, 4]]), "by David");
  check("the length is the length", blankRanges("by David W. Slayton", [[3, 8], [12, 19]]).length, "by David W. Slayton".length);
  {
    // The shape that made this the reader's largest single cost: a long export
    // with a cited name every few words. One pass over the text, not one per
    // range — the old version copied the whole string for each of them.
    const line = "The court in Rasho v. Quillmark (2019) 31 Cal.App.5th 1121 held otherwise. ";
    const text = line.repeat(6000);              // ~440 KB
    const spans = [];
    for (let i = 0, at = 0; i < 6000; i++, at += line.length) spans.push([at + 13, at + 31]);
    const from = Date.now();
    const out = blankRanges(text, spans);
    const ms = Date.now() - from;
    check("a long export with thousands of spans keeps its length", out.length, text.length);
    check("…and every span is blanked", out.slice(13, 31), "\u0000".repeat(18));
    check(`…in one pass (${ms} ms, was seconds)`, ms < 1000, true);
  }
}

console.log("which occurrence");
check("every occurrence, in order", occurrencesOf("David, then David again", "David"), [[0, 5], [12, 17]]);
check("whole words only — a fake reading Davidson holds no David",
  occurrencesOf("Davidson and David", "David"), [[13, 18]]);
check("case is not what tells two occurrences apart", occurrencesOf("DAVID and David", "David"), [[0, 5], [10, 15]]);
check("a value with a period in it is matched literally", occurrencesOf("A.B. Co. and AXBX Co.", "A.B."), [[0, 4]]);
check("nothing to find", occurrencesOf("none here", "David"), []);

console.log("the spot list");
check("a spot is its page, its value and which occurrence", makeSpot("2", " David ", "1"), { page: 2, value: "David", nth: 1 });
check("junk out of storage is dropped", normalizeSpots([{ page: 1, value: "David", nth: 0 }, { page: 1, value: "", nth: 0 }, null, 7]), [{ page: 1, value: "David", nth: 0 }]);
check("two spots are the same spot by page, value and occurrence",
  [sameSpot(makeSpot(1, "David", 0), makeSpot(1, "david", 0)), sameSpot(makeSpot(1, "David", 0), makeSpot(1, "David", 1)), sameSpot(makeSpot(1, "David", 0), makeSpot(2, "David", 0))],
  [true, false, false]);
check("one page's spots, in the order they stand",
  spotsOnPage([makeSpot(2, "David", 1), makeSpot(1, "Ann", 0), makeSpot(2, "David", 0)], 2),
  [{ page: 2, value: "David", nth: 0 }, { page: 2, value: "David", nth: 1 }]);
{
  const text = "Party7 Smith wrote to David W. Slayton, and David W. Slayton replied";
  check("the second occurrence is found by its ordinal", spotRanges(text, [makeSpot(0, "David", 1)]), [[44, 49]]);
  check("both of them", spotRanges(text, [makeSpot(0, "David", 0), makeSpot(0, "David", 1)]), [[22, 27], [44, 49]]);
  check("a spot whose occurrence has gone simply does not apply", spotRanges("nothing of the sort", [makeSpot(0, "David", 0)]), []);
  check("…and so does an ordinal past the end", spotRanges(text, [makeSpot(0, "David", 5)]), []);
}

// ---- real values typed into the plain text -------------------------------------
console.log("real values in plain text");
const HEADERS = ["Category", "Real Value", "Replacement", "Context", "Status", "Source", "Occurrences"];
const key = parseKey([{ name: "Pseudonym Key", rows: [HEADERS,
  ["person", "Helen Rasho", "Ingrid Strangeways", "", "", "spreadsheet", 12],
  ["person-token", "Rasho", "Strangeways", "", "", "spreadsheet", 30],
  ["entity-token", "The", "Flintham", "", "", "prescan", 2],
] }], "pseudonym_key.xlsx");
const fwd = compileForward(key);
const hits = findRealsInPlain(fwd, [{ node: "n1", text: "Ms. Rasho and HELEN RASHO's motion; the court" }]);
check("both spellings found, longest first at its site", hits.map((h) => [h.matched, h.fake]),
  [["Rasho", "Strangeways"], ["HELEN RASHO's", "INGRID STRANGEWAYS'S"]]);
check("a common word bound by the key is never rewritten", hits.length, 2);
// Un-keeping a spot has to put the pseudonym back, which means asking the key
// what one value's fake is, in the case the value was written in.
check("the fake for one value, in its own case", [fakeFor(fwd, "Helen Rasho"), fakeFor(fwd, "HELEN RASHO"), fakeFor(fwd, "Rasho")],
  ["Ingrid Strangeways", "INGRID STRANGEWAYS", "Strangeways"]);
check("a value the key does not bind has no fake", fakeFor(fwd, "Slayton"), null);
check("no key, no fake", fakeFor(null, "Helen Rasho"), null);

// ---- the names of decided cases ------------------------------------------------------
console.log("cited case names");
{
  const spans = (t) => citedNameSpans(t).map(([a, b]) => t.slice(a, b));
  const T = "Served on Helen Rasho at home. See Rasho v. Quillmark (1977) 70 Cal.App.3d 216, 219, "
    + "and Semole v. Sansoucie, supra, 28 Cal.App.3d 714. Rasho, supra, at p. 220. "
    + "The Rasho declaration says otherwise.";
  check("a case name with its citation, a short form, and a party with supra",
    spans(T), ["See Rasho v. Quillmark", "Semole v. Sansoucie", "Rasho"]);
  const at = (t, w) => { const i = t.indexOf(w); return insideSpans(citedNameSpans(t), i, i + w.length); };
  check("a party of a cited decision is inside one", at(T, "Rasho v. Quillmark"), true);
  check("…and the same name in the matter's own text is not",
    [at(T, "Helen Rasho"), at(T, "Rasho declaration")], [false, false]);
  // THE CAPTION IS THE ONE THING THIS MUST NOT SWALLOW: a caption carries no
  // reporter, and a leak in one is the leak that matters most.
  check("a caption is not a citation, whatever it looks like",
    spans("RASHO v. QUILLMARK, Defendant. Helen Rasho v. Quillmark Industries"), []);
  check("…nor is a v. with nothing after it", spans("the Rasho v. Quillmark matter"), []);
  check("the federal order — name, comma, volume, reporter",
    spans("Eagle Electric v. Keener, 247 Cal.App.2d 246, 250"), ["Eagle Electric v. Keener"]);
  check("vs. and a bare v are read the same",
    [spans("Renoir vs. Redstar Corp. (2004) 123 Cal.App.4th 1145").length, spans("Renoir v Redstar (2004) 1 Cal.5th 1").length], [1, 1]);
  check("nothing to find in plain prose, and nothing thrown by an empty text",
    [spans("The declaration of Helen Rasho, served on Vazqez."), citedNameSpans(""), citedNameSpans(null)], [[], [], []]);
  check("a value that STRADDLES a case name's edge is not inside it",
    at("...said Rasho v. Quillmark (1977) 70 Cal.App.3d 216", "said Rasho"), false);
  // A DECLARATION'S CAPITALS, which is what a party's words being unbounded
  // cost. A run of capitalised words that is not a case name — the jurat, a
  // caption block, a signature block, a list of exhibits — made the scanner
  // try every length the party could have been, from every word in the run,
  // before giving up for want of a " v. " after it: the run squared. It read
  // 2,000 words in a second, 4,000 in four, and a declaration of any length
  // not at all. The words are counted now, so the work from each place is a
  // fixed handful.
  {
    const JURAT = "I JOHN ANDREW FORSYTHE DECLARE AS FOLLOWS UNDER PENALTY OF PERJURY UNDER THE "
      + "LAWS OF THE STATE OF CALIFORNIA THAT THE FOREGOING IS TRUE AND CORRECT AND THAT THIS "
      + "DECLARATION WAS EXECUTED AT LOS ANGELES CALIFORNIA ";
    const short8 = JURAT.repeat(80), long8 = JURAT.repeat(320);   // ~17 KB and ~67 KB
    const ms = (t) => { const from = Date.now(); citedNameSpans(t); return Date.now() - from; };
    const a = ms(short8), b = ms(long8);
    check(`a declaration's capitals are read in step with their length (${a} ms then ${b} ms for four times the text)`,
      b < Math.max(60, a * 12), true);
    check("…and at the size a real declaration is, it is not seconds", ms(JURAT.repeat(1280)) < 3000, true);
    check("nothing in the jurat is taken for a case name", citedNameSpans(JURAT), []);
  }
  // The bound is a party's WORDS, and a long one still reads as it did: this
  // name always began at "Department", the pattern being unable to cross the
  // two small words of "of the State" whatever the count allows.
  check("a long institutional party is spanned as before",
    spans("People of the State of California ex rel. Department of Transportation v. Quillmark Industries, Inc. (2019) 31 Cal.App.5th 1121"),
    ["Department of Transportation v. Quillmark Industries, Inc."]);
}

// ---- what an edit wrote ------------------------------------------------------------
console.log("what an edit wrote");
{
  // Each run the edit put in, as the text it put in; a place it took text out as ^at.
  const wrote = (a, b, o) => editedSpans(a, b, o).map(([x, y]) => (x === y ? "^" + x : b.slice(x, y)));
  check("nothing changed, nothing written", editedSpans("Counsel for Helen Rasho.", "Counsel for Helen Rasho."), []);
  check("typing in the middle of a line is the typing",
    wrote("Counsel for Helen Rasho appeared.", "Counsel for Rasho and Helen Rasho appeared."), ["Rasho and "]);
  check("a line put in is that line", wrote("x\ny\nz", "x\nNEW\ny\nz"), ["NEW\n"]);
  check("a line taken out is a place", wrote("x\ny\nz", "x\nz"), ["^2"]);
  // AN ENTER ON PLEADING PAPER moves the text down the numbered slots and leaves
  // the numbers where they were: every line below it differs, and the words in
  // them are still the words that were there.
  check("an Enter's cascade writes the break and the numbers, not the words",
    wrote("5  AAA\n6  BBB\n7  CCC\n8\n9  DDD", "5  A\n6  AA\n7  BBB\n8  CCC\n9  DDD"), ["\n6  ", "7", "8", "^24"]);
  // Replace all: the lines it did not touch are not written, whatever lies between.
  const ra = "one Rasho two\nkeep Rasho\nthree Rasho", rb = "one Strangeways two\nkeep Rasho\nthree Strangeways";
  const kept = rb.indexOf("keep Rasho") + 5;
  check("a line between two edits is left as it was", spanEdited(editedSpans(ra, rb), kept, kept + 5), false);
  check("…and the edited ones are written", [rb.indexOf("Strangeways"), rb.lastIndexOf("Strangeways")].map((i) => spanEdited(editedSpans(ra, rb), i, i + 11)), [true, true]);
  check("an edit too long to place is all written",
    wrote("a\nb\nc\nd", "1\n2\n3\n4", { maxD: 2 }), ["1\n2\n3\n4"]);
  check("a place taken out of a span's middle is in it, one at its edge is not",
    [spanEdited([[5, 5]], 3, 8), spanEdited([[3, 3]], 3, 8), spanEdited([[8, 8]], 3, 8)], [true, false, false]);
  check("text put in beside a span is not in it", [spanEdited([[0, 3]], 3, 8), spanEdited([[8, 9]], 3, 8), spanEdited([[7, 9]], 3, 8)], [false, false, true]);

  // The converter's question, asked of a page as the reader builds one.
  const g = (s) => E("SPAN", { class: "gutter" }, [T(s)]);
  const page = (lines) => E("DIV", {}, lines.map((kids) => E("DIV", {}, kids)));
  const segsOf = (nodes) => nodes.map((n) => ({ node: n, text: n.data }));
  const n1 = T("Plaintiff "), pn = E("SPAN", { "data-fake": "Ingrid Strangeways" }, [T("Helen Rasho")]), n2 = T(" brings this motion.");
  const n3 = T("Counsel for Helen Rasho appeared."), n4 = T("See Rasho v. Quillmark (2017) 13 Cal.App.5th 1152.");
  const body = page([[g("1   "), n1, pn, n2], [g("2   "), n3], [g("3   "), n4]]);
  const built = serializeMapped(body);
  check("the disk text, the pseudonym as its fake",
    built.text, "1   Plaintiff Ingrid Strangeways brings this motion.\n2   Counsel for Helen Rasho appeared.\n3   See Rasho v. Quillmark (2017) 13 Cal.App.5th 1152.");
  check("each text node where its text stands in it", [built.at.get(n1), built.at.get(n3), built.at.get(n4)],
    [4, built.text.indexOf("Counsel"), built.text.indexOf("See Rasho")]);
  check("a pseudonym's own text is not one of them", built.at.has(pn.childNodes[0]), false);
  const typed = () => typedReals(findRealsInPlain(fwd, segsOf([n1, n2, n3, n4])), serializeMapped(body), built.text)
    .map((h) => [h.node === n2 ? "typed line" : h.node === n3 ? "line 2" : "citation", h.matched]);
  check("a page nobody typed on has nothing typed", typed(), []);
  n2.data = " brings this motion. Rasho agrees.";
  // THE BUG THIS ANSWERS: typing on line 1 marked line 2's leak and the cited
  // decision's party on line 3 as pseudonyms too.
  check("typing on one line marks the name typed, and only that", typed(), [["typed line", "Rasho"]]);
  n2.data = " brings this motion. See Rasho v. Quillmark (2017) 13 Cal.App.5th 1152.";
  check("a citation typed whole keeps its parties", typed(), []);
  n2.data = " brings this motion.";
  check("no text it was built from, nothing counts as typed",
    typedReals(findRealsInPlain(fwd, segsOf([n2, n3])), serializeMapped(body), null), []);
  // The Enter's cascade, as the reader makes it: the text after the caret goes
  // down a slot, and the empty slot below takes the last of it.
  const m5 = T("Counsel for Helen Rasho appeared."), m6 = T("The end.");
  const before = serializeMapped(page([[g(" 5  "), m5], [g(" 6  "), m6], [g(" 7")]])).text;
  const k6 = T("Counsel for Helen Rasho appeared."), k7 = T("The end.");
  const after = page([[g(" 5")], [g(" 6  "), k6], [g(" 7  "), k7]]);
  check("an Enter above a leak does not make it typed",
    typedReals(findRealsInPlain(fwd, segsOf([k6, k7])), serializeMapped(after), before), []);
  // A party marked at the Space prompt before the rest of its citation was typed.
  const pnOf = (fake, real) => E("SPAN", { "data-fake": fake, "data-real": real }, [T(real)]);
  const filed = pnOf("Strangeways", "Rasho"), early = pnOf("Strangeways", "Rasho"), plain = pnOf("Strangeways", "Rasho");
  const cbody = page([
    [g("1   "), T("Cf. "), filed, T(" v. Quillmark (2017) 13 Cal.App.5th 1152.")],
    [g("2   "), T("See "), early, T(" v. Quillmark (2017) 13 Cal.App.5th 1152.")],
    [g("3   "), plain, T(" agrees.")],
  ]);
  const cbuilt = "1   Cf. Strangeways v. Quillmark (2017) 13 Cal.App.5th 1152.\n2   See\n3   ";
  const back = typedPseudonymsCited(serializeMapped(cbody), cbuilt);
  check("a party marked while its citation was typed goes back; the page's own and a typed one outside a citation stay",
    [back.includes(early), back.includes(filed), back.includes(plain), back.length], [true, false, false, 1]);
  check("nothing typed, nothing goes back", typedPseudonymsCited(serializeMapped(cbody), serializeMapped(cbody).text), []);
  // A SAVE BEFORE THE CITATION WAS FINISHED. "See Rasho" saved — the caret still
  // at its end, or after a pause — went to the file as "See Strangeways", and
  // the save took that text for the page's own: the citation typed after it
  // left the mark standing in it, and the next save wrote the renamed
  // authority. The typing's marks carry data-typed, and it counts whatever the
  // page was built from.
  const saved = pnOf("Strangeways", "Rasho"), savedTyped = E("SPAN", { "data-fake": "Strangeways", "data-real": "Rasho", "data-typed": "1" }, [T("Rasho")]);
  const sbody = page([
    [g("1   "), T("See "), saved, T(" v. Quillmark (2017) 13 Cal.App.5th 1152.")],
    [g("2   "), T("See "), savedTyped, T(" v. Quillmark (2017) 13 Cal.App.5th 1152.")],
  ]);
  const ssaved = "1   See Strangeways\n2   See Strangeways";
  const sback = typedPseudonymsCited(serializeMapped(sbody), ssaved);
  check("a mark the typing made goes back after a save took it for the page's; one the page was saved with stays",
    [sback.includes(savedTyped), sback.includes(saved), sback.length], [true, false, 1]);
  check("…however the page reads against the text it was built from",
    typedPseudonymsCited(serializeMapped(sbody), serializeMapped(sbody).text), [savedTyped]);
  check("…and a typed mark outside a citation stays",
    typedPseudonymsCited(serializeMapped(page([[g("1   "), E("SPAN", { "data-fake": "Strangeways", "data-real": "Rasho", "data-typed": "1" }, [T("Rasho")]), T(" agrees.")]])), "1   Strangeways agrees."), []);

  // THE SAVE'S QUESTION, of the names it reads standing in the page whole. A
  // name typed and saved inside the converter's wait — or with the caret still
  // at its end, or dismissed with Esc, or typed across a line break, which the
  // converter cannot read — went into the export in the clear and was "not
  // yet reviewed" from then on. The save writes each name this answers as its
  // pseudonym.
  const sreals = compileReals(key);
  const typedAt = (built, now) => typedSpans(findRealSpans(sreals, now, { layout: now }), now, built).map((h) => now.slice(h.start, h.end));
  const leftover = " 1  Counsel for Helen Rasho appeared.\n 2  Nothing else.";
  check("a name typed is the save's to write; the run's leftover beside it is the review's",
    typedAt(leftover, leftover.replace("else.", "else. Served on Helen Rasho.")), ["Helen Rasho"]);
  check("…and on a page nobody typed on, nothing", typedAt(leftover, leftover), []);
  check("…nor where the page has no text it was built from", typedSpans(findRealSpans(sreals, leftover), leftover, null), []);
  check("a name typed across a line break is one name, typed",
    typedAt(" 1  Served on\n 2  by mail.", " 1  Served on Helen\n 2  Rasho, by mail."), ["Helen\n 2  Rasho"]);
  check("the surname typed under a given name the page had makes the whole name typed",
    typedAt(" 1  Served on Helen\n 2  by mail.", " 1  Served on Helen\n 2  Rasho by mail."), ["Helen\n 2  Rasho"]);
  // An Enter inside a name the run left writes the break and the number
  // between its pieces, and nothing of the name: it is still the review's.
  check("an Enter inside a leftover does not make it typed",
    typedAt(" 1  Counsel for Helen Rasho appeared.\n 2", " 1  Counsel for Helen\n 2  Rasho appeared."), []);
  check("a citation typed whole keeps its parties, read whole as well",
    typedAt(" 1  Nothing.", " 1  Nothing. See Rasho v. Quillmark (2017) 13 Cal.App.5th 1152."), []);
}

// ---- the values file ---------------------------------------------------------------
console.log("values file");
let list = addValue([], "  Rosa   Delgado ");
list = addValue(list, "rosa delgado");
list = addValue(list, "Sunbelt Rentals LLC");
check("dedup, case-blind, whitespace folded", list, ["Rosa Delgado", "Sunbelt Rentals LLC"]);
check("remove", removeValue(list, "ROSA DELGADO"), ["Sunbelt Rentals LLC"]);
const file = formatValuesFile(list);
check("file round trip", parseValuesFile(file), list);
check("comments and blanks ignored", parseValuesFile("# note\n\n  Rosa Delgado\n#x\nRosa Delgado\n"), ["Rosa Delgado"]);
check("the file is named with spaces", VALUES_FILE, "New Real Values.txt");
let keeps = addKeep([], "no", "Stockton Theatres");
keeps = addKeep(keeps, "bogus", "Palermo");
keeps = addKeep(keeps, "never", "stockton theatres");
check("a keep per value, the later control winning, a bad control read as no", keeps, [{ control: "no", value: "Palermo" }, { control: "never", value: "Stockton Theatres" }]);
check("keptControl", [keptControl(keeps, "PALERMO"), keptControl(keeps, "x")], ["no", ""]);
check("removeKeep", removeKeep(keeps, "palermo"), [{ control: "never", value: "Stockton Theatres" }]);
const both = formatValuesFile(list, keeps);
check("keeps written as control lines", both.endsWith("\nno: Palermo\nnever: Stockton Theatres\n"), true);
check("both halves read back", parseReaderFile(both), { values: list, keeps, phrases: [], noOcr: [], ocrAgain: [], textFixed: [] });
check("parseValuesFile ignores the keeps", parseValuesFile(both), list);
// ── a keep that asks nothing of PDF-Linker ─────────────────────────────────
//
// Keeping a value the run FAKED is work for the next run: only PDF-Linker can
// put the real name back. Keeping one that stands in the clear is not — the
// files already read that way — so it stays in the reader rather than going
// into the list the case folder is handed. `faked` is the CASE's answer, not
// one document's: the reader asks the folder, and until the folder has been
// read the keep is `pending` and owed like any other.
console.log("which keeps PDF-Linker is owed");
check("a value standing in the clear, this case, unraised: nothing to run",
  keepNeedsRun({ control: "no", faked: false, onLeaksSheet: false }), false);
check("a pseudonym standing anywhere in the case: only a run can put it back",
  keepNeedsRun({ control: "no", faked: true, onLeaksSheet: false }), true);
check("a value PDF-Linker has raised on LEAKS.xlsx: its row is waiting on an answer",
  keepNeedsRun({ control: "no", faked: false, onLeaksSheet: true }), true);
check("never reaches the next matter through the file and nowhere else",
  keepNeedsRun({ control: "never", faked: false, onLeaksSheet: false }), true);

check("a local keep is marked as one", makeKeep("no", "Helen Rasho", "local"),
  { control: "no", value: "Helen Rasho", state: "local" });
check("a keep waiting on the folder is marked too", makeKeep("no", "Helen Rasho", "pending"),
  { control: "no", value: "Helen Rasho", state: "pending" });
check("…and never never", makeKeep("never", "Helen Rasho", "local"),
  { control: "never", value: "Helen Rasho" });
check("a state nobody defined is no state", makeKeep("no", "Helen Rasho", "maybe"),
  { control: "no", value: "Helen Rasho" });

let mixed = addKeep([], "no", "Helen Rasho", "local");
mixed = addKeep(mixed, "no", "Stockton Theatres");
mixed = addKeep(mixed, "no", "Palermo", "pending");
check("the file is handed everything but the keeps the case already carries out",
  owedKeeps(mixed).map((k) => k.value), ["Stockton Theatres", "Palermo"]);
check("a local keep is not written into the file",
  /Helen Rasho/.test(formatValuesFile([], mixed)), false);
check("a keep still waiting on the folder IS written — owed until the evidence says otherwise",
  formatValuesFile([], mixed).endsWith("\nno: Stockton Theatres\nno: Palermo\n"), true);

check("a pseudonym found standing makes a local keep owed again",
  owe(mixed, "HELEN RASHO")[0], { control: "no", value: "Helen Rasho" });
check("…and a pending one too", owe(mixed, "palermo")[2], { control: "no", value: "Palermo" });
check("owing what is already owed changes nothing", owe(mixed, "Stockton Theatres"), mixed);
check("the folder read clean settles a pending keep",
  settleLocal(mixed, "Palermo")[2], { control: "no", value: "Palermo", state: "local" });
check("but nothing settles a keep that was owed on the evidence",
  settleLocal(mixed, "Stockton Theatres"), mixed);
check("…nor one already made owed", settleLocal(owe(mixed, "Palermo"), "Palermo"),
  owe(mixed, "Palermo"));
check("turning a local keep into a never writes it out",
  owedKeeps(addKeep(mixed, "never", "Helen Rasho")).map((k) => k.value).sort(),
  ["Helen Rasho", "Palermo", "Stockton Theatres"]);
check("a keep read back from the file is owed, with no state at all",
  parseReaderFile("no: Helen Rasho\n").keeps, [{ control: "no", value: "Helen Rasho" }]);

check("flag: nothing selected", flagProblem("  ", false) !== "", true);
check("flag: wholly a pseudonym", flagProblem("Strangeways", true) !== "", true);
check("flag: partly a pseudonym is a name the run half missed", flagProblem("Rosa Strangeways", false), "");
check("flag: a passage", flagProblem("x".repeat(200), false) !== "", true);
check("flag: a name", flagProblem("Rosa Delgado", false), "");

// A phrase is the words TOGETHER: two of them at least, and it may take in a
// pseudonym — the word faked on its own is usually why the question comes up.
console.log("phrases");
check("phrase: nothing selected", phraseProblem("  ") !== "", true);
check("phrase: one word is not a phrase", phraseProblem("River") !== "", true);
check("phrase: a passage", phraseProblem("word ".repeat(40)) !== "", true);
check("phrase: several words", phraseProblem("Cross  River\nBank"), "");
check("a phrase is written with its control word, a plain flag bare",
  formatValuesFile(["Cross River Bank", "Rosa Delgado"], [{ control: "no", value: "Semole" }], ["cross river bank"]).split("\n").filter((l) => l && l[0] !== "#"),
  ["phrase: Cross River Bank", "Rosa Delgado", "no: Semole"]);
check("…and read back as a value to fake that goes whole",
  parseReaderFile("# c\nphrase:  Cross River Bank \nRosa Delgado\nno: Semole\n"),
  { values: ["Cross River Bank", "Rosa Delgado"], keeps: [{ control: "no", value: "Semole" }], phrases: ["Cross River Bank"], noOcr: [], ocrAgain: [], textFixed: [] });
check("the round trip holds", (() => {
  const t = formatValuesFile(["Bank of America", "Helen Rasho"], [], ["Bank of America"]);
  const r = parseReaderFile(t);
  return formatValuesFile(r.values, r.keeps, r.phrases) === t;
})(), true);
check("isPhrase folds case and spacing", [isPhrase(["Bank of  America"], "bank of america"), isPhrase([], "Bank of America"), isPhrase(["Bank of America"], "")], [true, false, false]);

// A flag is a job for PDF-Linker's next run, and the key coming back with the
// name in it is the run's answer: the value is faked, and the flag has nothing
// left to ask for.
console.log("flags the key has answered");
const RUN = compileForward(parseKey([{ name: "Pseudonym Key", rows: [HEADERS,
  ["person", "Rosa Delgado", "Wilma Trent", "", "", "spreadsheet", 4],
  ["person-token", "Delgado", "Trent", "", "", "spreadsheet", 9],
  ["person", "Vazqez", "Wilma Trent", "", "", "alt spelling", 1],
] }], "pseudonym_key.xlsx"));
check("a flagged value the key now fakes comes off the list",
  dropFlagsInKey(["Rosa Delgado", "Sunbelt Rentals LLC"], RUN),
  { kept: ["Sunbelt Rentals LLC"], dropped: ["Rosa Delgado"] });
check("case and spacing are no part of it",
  dropFlagsInKey(["  ROSA   DELGADO "], RUN).dropped, ["  ROSA   DELGADO "]);
check("an alt spelling the run added is the same answer",
  dropFlagsInKey(["Vazqez"], RUN).dropped, ["Vazqez"]);
check("a row for something INSIDE the value is not the answer",
  dropFlagsInKey(["Delgado Roofing Inc."], RUN),
  { kept: ["Delgado Roofing Inc."], dropped: [] });
const STANDS = ["Sunbelt Rentals LLC", "Marisol Ybarra"];
check("nothing in the key, nothing dropped \u2014 and the list stands as it is",
  dropFlagsInKey(STANDS, RUN), { kept: STANDS, dropped: [] });
check("no key, nothing dropped", dropFlagsInKey(["Rosa Delgado"], null), { kept: ["Rosa Delgado"], dropped: [] });
check("no list, nothing to drop", dropFlagsInKey(null, RUN), { kept: [], dropped: [] });
{
  // A key row whose Replacement is an INSTRUCTION ("~Rosa Delgado" typed over
  // a misspelling's stand-in) binds no fake (pseudo-key keyCellKind): the run
  // has not answered that flag, the reader has nothing to write for it, and a
  // name typed out is not marked through its shorter words either.
  const CTL = compileForward(parseKey([{ name: "Pseudonym Key", rows: [HEADERS,
    ["person", "Rosa Delgado", "Wilma Trent", "", "", "spreadsheet", 4],
    ["person-token", "Rosa", "Wilma", "", "", "spreadsheet", 6],
    ["person", "Rosa Delgadoe", "~Rosa Delgado", "", "leaked", "document", 1],
    ["person", "Marisol Ybarra", "phrase", "", "", "", 1],
  ] }], "pseudonym_key.xlsx"));
  check("a flag the key holds only an instruction for stays on the list",
    dropFlagsInKey(["Rosa Delgadoe", "Marisol Ybarra", "Rosa Delgado"], CTL), { kept: ["Rosa Delgadoe", "Marisol Ybarra"], dropped: ["Rosa Delgado"] });
  check("…it has no fake", [fakeFor(CTL, "Rosa Delgadoe"), fakeFor(CTL, "Marisol Ybarra")], [null, null]);
  check("…and typed out, neither it nor the shorter name inside it is marked",
    findRealsInPlain(CTL, [{ node: "n1", text: "Rosa Delgadoe signed; Rosa wrote" }]).map((h) => [h.matched, h.fake]), [["Rosa", "Wilma"]]);
}

// …and only the folder's OWN key answers them: the key in hand outlives the
// folder it was read from, and another case's key binds that case's names.
// Both sides are the list's storage name (the reader's valuesStoreKey).
console.log("whose key answers the flags");
check("the key read from this folder, or chosen with it open, answers its list",
  keyAnswersFlags("textReader.values.Case B", "textReader.values.Case B"), true);
check("another folder's key does not",
  keyAnswersFlags("textReader.values.Case A", "textReader.values.Case B"), false);
check("a key that is nobody's (dropped with a document, or offered at start) answers no list",
  [keyAnswersFlags(null, "textReader.values.Case B"), keyAnswersFlags("", "textReader.values.Case B"), keyAnswersFlags(undefined, "textReader.values.Case B")], [false, false, false]);
check("…not even no list", [keyAnswersFlags(null, null), keyAnswersFlags("", "")], [false, false]);

// A case folder's state is kept under its own id, not its bare name: two
// folders called "Opposition" (two clients) shared one list, and one case's
// `no` was read into the other's, where it took the orange mark off the
// plaintiff and was written into its New Real Values.txt. The id begins with
// "/", which no file or folder name holds, so moving a name's state to an id
// takes that name's keys and nothing of an id's or of another name's.
console.log("a folder's state, by name and by id");
{
  const P = { whole: ["textReader.values.", "textReader.valuesSaved."], perDoc: ["textReader.spots.", "textReader.swaps.", "textReader.leaks."] };
  const ID = "/folder/0b5e", OTHER = "/folder/77aa";
  const keys = [
    "textReader.values.Opposition", "textReader.valuesSaved.Opposition",
    "textReader.spots.Opposition/Brief.txt", "textReader.swaps.Opposition/Brief.txt", "textReader.leaks.Opposition/LEAKS.xlsx",
    "textReader.values.Opposition Reply", "textReader.spots.Opposition Reply/Brief.txt",
    "textReader.values.Brief.txt", "textReader.spots./Brief.txt",
    "textReader.values." + OTHER, "textReader.spots." + OTHER + "/Brief.txt", "textReader.keys", "textReaderSettings",
  ];
  check("the name's own keys move to the id, each to its place",
    folderStateMoves(keys, "Opposition", ID, P), [
      { from: "textReader.values.Opposition", to: "textReader.values." + ID },
      { from: "textReader.valuesSaved.Opposition", to: "textReader.valuesSaved." + ID },
      { from: "textReader.spots.Opposition/Brief.txt", to: "textReader.spots." + ID + "/Brief.txt" },
      { from: "textReader.swaps.Opposition/Brief.txt", to: "textReader.swaps." + ID + "/Brief.txt" },
      { from: "textReader.leaks.Opposition/LEAKS.xlsx", to: "textReader.leaks." + ID + "/LEAKS.xlsx" },
    ]);
  check("…not a longer name that begins with it, a lone document's list, or another folder's id",
    folderStateMoves(keys, "Opposition", ID, P).map((x) => x.from).filter((k) => !/\.Opposition(\/|$)/.test(k)), []);
  check("an id's state moves whole to another id (a Text Files folder's to its case folder's)",
    folderStateMoves(keys, OTHER, ID, P), [
      { from: "textReader.values." + OTHER, to: "textReader.values." + ID },
      { from: "textReader.spots." + OTHER + "/Brief.txt", to: "textReader.spots." + ID + "/Brief.txt" },
    ]);
  check("no folder, or no move, moves nothing", [folderStateMoves(keys, "", ID, P), folderStateMoves(keys, ID, ID, P), folderStateMoves(keys, "Opposition", "", P)], [[], [], []]);
  check("a lone document's spots (no folder) are never a name's to take",
    folderStateMoves(["textReader.spots./Brief.txt"], "Brief.txt", ID, P), []);

  // Whose an older build's list under the bare name is: told only by the file
  // that build last wrote, still standing in this folder. The count of folders
  // of the name is no evidence on its own — that build remembered one per
  // name, so the first opened after the upgrade always counted one, and a
  // keep never written, taken in client A's Opposition, moved into client B's
  // and was written into B's file. A Text Files folder's list never moves:
  // every case's had the one name.
  const SAVED = "# New Real Values.txt\nno: Okafor\n";
  check("moved only where the folder's file is what that build last wrote, and it is the one of the name",
    legacyStateHold({ sameName: 1, saved: SAVED, onDisk: SAVED }), "");
  check("…held where it was never written, whatever the count",
    [legacyStateHold({ sameName: 1, saved: "", onDisk: null }), legacyStateHold({ sameName: 1 }), legacyStateHold({ sameName: 1, saved: "", onDisk: SAVED })],
    ["unwritten", "unwritten", "unwritten"]);
  check("…where the file is not what was written, or is gone (a run spends it)",
    [legacyStateHold({ sameName: 1, saved: SAVED, onDisk: "no: Okafor\n" }), legacyStateHold({ sameName: 1, saved: SAVED, onDisk: null })], ["differs", "differs"]);
  check("…where two of the name are known, or none is",
    [legacyStateHold({ sameName: 2, saved: SAVED, onDisk: SAVED }), legacyStateHold({ saved: SAVED, onDisk: SAVED })], ["named", "named"]);
  check("…and always for a Text Files folder, its file matching or not",
    [legacyStateHold({ textFiles: true, sameName: 1, saved: SAVED, onDisk: SAVED }), legacyStateHold({ textFiles: true, sameName: 1 })], ["text", "text"]);

  // …and the list kept while the Text Files folder was open joins its case
  // folder's, nothing in either lost and the case folder's own winning.
  const mine = { values: ["Zachary Coderre", "Helen Rasho"], keeps: [{ control: "no", value: "Riverside" }], phrases: ["Helen Rasho"],
    noOcr: [{ doc: "Brief.txt", page: 2 }], ocrAgain: [], textFixed: [] };
  const theirs = { values: ["helen rasho", "Okafor", "Cross River Bank"], keeps: [{ control: "never", value: "riverside" }, { control: "no", value: "Pemberly", state: "local" }],
    phrases: ["Cross River Bank", "helen rasho"], noOcr: [], ocrAgain: [{ doc: "Brief.txt", page: 2 }, { doc: "Brief.txt", page: 5 }],
    textFixed: [{ doc: "Brief.txt", page: 2, sum: "0a1b2c3d" }, { doc: "Reply.txt", page: 1, sum: "deadbeef" }] };
  const m = mergeStoredLists(mine, theirs);
  check("flags: both lists, one of each value, the case folder's spelling",
    m.values, ["Zachary Coderre", "Helen Rasho", "Okafor", "Cross River Bank"]);
  check("phrases: the case folder's, and theirs for a value only they flagged", m.phrases, ["Helen Rasho", "Cross River Bank"]);
  check("keeps: a value both keep keeps the case folder's control; one only they kept comes with its state",
    m.keeps, [{ control: "no", value: "Riverside" }, { control: "no", value: "Pemberly", state: "local" }]);
  check("pages: one the case folder names is left to it; the rest come",
    [m.noOcr, m.ocrAgain, m.textFixed], [[{ doc: "Brief.txt", page: 2 }], [{ doc: "Brief.txt", pdf: "", page: 5 }], [{ doc: "Reply.txt", pdf: "", page: 1, sum: "deadbeef" }]]);
  check("an empty or missing list takes the other whole",
    [mergeStoredLists(null, mine).values, mergeStoredLists(mine, {}).keeps], [mine.values, mine.keeps]);
}

// ---- folder listing ------------------------------------------------------------------
console.log("folder");
check("exports", ["Brief.txt", "Brief.txt.LEAK", "Reply.TXT"].map(isExportName), [true, true, true]);
check("tool artifacts are not documents", ["LEAKS.txt", "Combined Text.txt", "Authorities Cited.txt", "New Real Values.txt", "ETA 12-30 (3 files).txt", "DONE 12-45.txt", "pdf_linker.log"].map(isExportName), [false, false, false, false, false, false, false]);
// PDF-Linker's run markers: an ETA standing means a run is going (or died part-way).
check("run markers", ["ETA ~6.04PM (6 of 13).txt", "ETA (estimating...).txt", "DONE 12.45AM.txt", "eta ~11.05pm (applying leak fixes).TXT", "Brief.txt", "ETA.txt", "ETA notes.docx"].map(runMarker),
  [{ kind: "ETA", label: "~6:04 PM (6 of 13)" }, { kind: "ETA", label: "(estimating...)" }, { kind: "DONE", label: "12:45 AM" }, { kind: "ETA", label: "~11:05 PM (applying leak fixes)" }, null, null, null]);
check("quarantine", isQuarantinedName("Brief.txt.LEAK"), true);
check("key name", [isKeyName("pseudonym_key.xlsx"), isKeyName("pseudonym_key (1).xlsx"), isKeyName("Order 2024.xlsx")], [true, true, false]);

// ---- settings ------------------------------------------------------------------------------
console.log("settings");
const s = normalizeSettings({ font: "nope", fontSize: 200, lineHeight: "x", marks: false });
check("bad settings fall back", [s.font, s.fontSize, s.lineHeight, s.marks], ["georgia", 40, 1.5, false]);
const mk = normalizeSettings({ markColor: "#0000FF", markAlpha: 5 });
check("highlight colour normalised and intensity bounded", [mk.markColor, mk.markAlpha], ["#0000ff", 0.9]);
check("a bad colour falls back", normalizeSettings({ markColor: "blue" }).markColor, "#19dcfa");
check("a stored old default yellow reads as the new default", normalizeSettings({ markColor: "#F5C518" }).markColor, "#19dcfa");
check("the default highlight is #19dcfa", markCss(normalizeSettings(null)).bg, "rgba(25, 220, 250, 0.180)");
check("markCss", markCss({ markColor: "#ff0000", markAlpha: 0.2 }), { bg: "rgba(255, 0, 0, 0.200)", hover: "rgba(255, 0, 0, 0.500)", ring: "rgba(255, 0, 0, 0.120)" });
check("custom font css", fontCss(normalizeSettings({ font: "custom", customFont: "Baskerville, serif" })), "Baskerville, serif");
check("empty custom falls back to the first preset", fontCss(normalizeSettings({ font: "custom", customFont: " " })), "Georgia, 'Times New Roman', serif");

// ---- rule glyphs: the boxes an export draws --------------------------------
console.log("rule glyphs");
check("a line with no rule glyph has no shape", ruleShape(" 5  HELEN RASHO, an individual,"), null);
check("bars are located in the WHOLE line, gutter included",
  ruleShape(" 5  RASHO,      \u2502 Case No. 25STZV12345"), { bars: [16], rule: false });
check("a continuation line under the same box carries the same offsets",
  ruleShape("    (cont.)     \u2502 more").bars, ruleShape(" 5  RASHO,      \u2502 Case No.").bars);
check("a line of nothing but rules and spaces is a rule row",
  ruleShape("\u251c\u2500\u2500\u2500\u2500\u2524   \u2502"), { bars: [0, 5, 9], rule: true });
check("an underline inside a text row is not a rule row",
  ruleShape("\u2502 DOES 1  TO \u2500\u2500\u2500\u2500 \u2502").rule, false);
check("a bar-less underline is a rule row with no bars",
  ruleShape("          \u2500\u2500\u2500\u2500\u2500"), { bars: [], rule: true });
check("parts: text, a bar with its extent, a run",
  ruleParts("ab\u2502cd\u2500\u2500e\u250c\u2518"),
  [{ t: "text", s: "ab" }, { t: "bar", s: "\u2502", v: "full" }, { t: "text", s: "cd" }, { t: "h", s: "\u2500\u2500" },
   { t: "text", s: "e" }, { t: "bar", s: "\u250c", v: "down" }, { t: "bar", s: "\u2518", v: "up" }]);
check("parts of a plain string is the string", ruleParts("plain"), [{ t: "text", s: "plain" }]);
check("the parts join back to the text", ruleParts("\u250c\u2500\u2500\u252c\u2500\u2510 x").map((q) => q.s).join(""), "\u250c\u2500\u2500\u252c\u2500\u2510 x");
// The dressed DOM (rules.js) wraps the glyphs in spans that carry no
// data-fake, so the walk serializes them as their own text: a cell span, a
// bar span and a run span read back as the line the file holds.
{
  const T = (s) => ({ nodeType: 3, data: s });
  const E = (name, kids, attrs) => ({ nodeType: 1, nodeName: name, childNodes: kids, getAttribute: (k) => (attrs && k in attrs ? attrs[k] : null) });
  const line1 = E("DIV", [E("SPAN", [E("SPAN", [T(" NAME: "), E("SPAN", [T("Rosa Delgado")], { "data-fake": "Wren Ashby" }), T("   ")]),
                                     E("SPAN", [T("\u2502")]), E("SPAN", [E("SPAN", [T("\u2500\u2500\u2500")])])])]);
  const line2 = E("DIV", [E("SPAN", [T("plain")])]);
  const body = E("DIV", [line1, line2]);
  check("a dressed line serializes as the file's own text, fakes underneath",
    serializeNodes(body), " NAME: Wren Ashby   \u2502\u2500\u2500\u2500\nplain");
  check("…and displays the real name", textOf(body), " NAME: Rosa Delgado   \u2502\u2500\u2500\u2500\nplain");
}

// ---- columns laid out with spaces -------------------------------------------
// A Westlaw printout exported on the character grid: the right-hand column is
// where it is because of the spaces in front of it, and the reader cuts each
// line there (columns.js) so the column stands at one place on every line.
console.log("columns laid out with spaces");
{
  const R = " ".repeat(62);
  check("a right-hand column alone on its line: no cut, an indent", [columnCuts(R + "and its Executive Director"), lineIndent(R + "and its Executive Director")], [[], { lead: 62, ind: 62 }]);
  check("an indented left column and a right-hand one: one cut, after the gap",
    columnCuts("                 Barbara DELO, Plaintiff,                     \u201cDefendants\u201d). Delo alleges"), [62]);
  check("a left column running close to the right one: three spaces are still a gap",
    columnCuts("company and its executive director, alleging discrimination   I. Factual Allegations"), [62]);
  check("the gap is three spaces", COLUMN_GAP, 3);
  check("a sentence's double space is not a column", columnCuts("The motion is DENIED.  Plaintiff may proceed."), []);
  check("…unless it lands on one of the page's columns", columnCuts("Holdings: held that:  costumer", { stops: new Set([22]) }), [22]);
  check("a page's column counts from its own left edge, past a margin number",
    columnCuts("Plaintiff,  DECLARATION", { stops: new Set([16]), start: 4 }), [12]);
  check("trailing spaces are not a column, and an empty line has none", [columnCuts("Synopsis     "), columnCuts("      "), columnCuts("")], [[], [], []]);
  const lines = [
    { text: R + "Barbara Delo, a former costumer" },
    { text: "company and its executive director   I. Factual" },
    { text: "       United States District Court" },
    { text: "Holdings:" + " ".repeat(53) + "costumer who holds" },
  ];
  const stopsOf = (bands) => bands.map((b) => [...b.stops]);
  check("a column is where two lines or more begin, and it covers the lines between them",
    stopsOf(columnBands(lines)), [[[62, 2]], [[62, 2]], [[62, 2]], [[62, 2]]]);
  check("…counted from the page's edge, a numbered line's text where its number's spaces end",
    stopsOf(columnBands([{ text: "COMPLAINT FOR:", start: 44 }, { text: R.slice(0, 44) + "1. BREACH;" }])), [[[44, 2]], [[44, 2]]]);
  // A justified left-hand column fills its width, and its long lines run up
  // to the second column with a space or two between.
  const westlaw = [
    { text: R + "Barbara Delo, a former costumer" },
    { text: "company and its executive director, alleging discrimination   I. Factual Allegations" },
    { text: "costumer's sexual harassment claim accrued after the effectiv Jo Marine" },
    { text: "                 Barbara DELO, Plaintiff,                     \u201cDefendants\u201d). Delo alleges" },
  ];
  const wb = columnBands(westlaw);
  check("lines beside a second column make it one: three begin at it, text to its left on some",
    wb.map((b) => [...b.second]), [[62], [62], [62], [62]]);
  check("one space onto the second column is a gap", columnCuts(westlaw[2].text, wb[2]), [62]);
  const full = "could invoke the Ending Forced Arbitration of Sexual Assault  Compl. \u00b6 15.";
  check("…and two spaces onto a column lines begin at", columnCuts(full, wb[2]), [62]);
  // A column covers the lines it runs down, and stops: a form's column is a
  // piece of its page.
  const below = westlaw.concat(Array.from({ length: COLUMN_REACH + 2 }, () => ({ text: "" })), [westlaw[2]]);
  const bb = columnBands(below);
  check("the same line further down the page, past where the column runs, is two words",
    [[...bb[bb.length - 1].second], columnCuts(westlaw[2].text, bb[bb.length - 1])], [[], []]);
  check("…though a few lines with none beginning at it do not stop a column",
    columnCuts(westlaw[2].text, columnBands(westlaw.slice(0, 2).concat([{ text: "" }, { text: "" }, westlaw[2], westlaw[3]]))[4]), [62]);
  // Lines that only START at a column are an indent, not a column beside
  // another: an address block, a form's checkbox items.
  const pad = " ".repeat(21);
  const named = "Defendant Weddell Of Sharnbrook Of Livesey Brindley moved to dismiss.";
  const indented = columnBands([{ text: pad + "1200 Main Street" }, { text: named }, { text: pad + "Suite 400" }, { text: pad + "Los Angeles, CA 90012" }]);
  check("an indent three lines share is a column lines begin at, but not a second column",
    [[...indented[1].stops], [...indented[1].second]], [[[21, 3]], []]);
  check("…so prose running across it is not cut there", columnCuts(named, indented[1]), []);
  check("…nor onto a column too few lines begin at, or too near the margin", [
    columnCuts("x".repeat(61) + " y", { stops: new Map([[62, 2]]), second: new Set() }),
    columnCuts("The court is to rule.", columnBands([{ text: "a.        Text one" }, { text: "The court is to rule." }, { text: "          Text two" }, { text: "b.        Text three" }])[1]),
  ], [[], []]);
  // A Judicial Council form (APP-003) on the character grid: its checkbox
  // items stand at column 18 down the middle of the page, and the caption at
  // the top runs across that column with a single space ("ATTORNEY OR PARTY
  // WITHOUT", "SUPERIOR COURT OF CALIFORNIA"). Counted down the whole page,
  // the items made 18 the page's second column and cut the caption there.
  const app003 = [
    "ATTORNEY OR PARTY WITHOUT ATTORNEY                            STATE BAR NUMBER:",
    " ".repeat(118) + "FOR COURT USE ONLY",
    "NAME:", "FIRM NAME:", "STREET ADDRESS:",
    "CITY:                                                        STATE:         ZIP CODE:",
    "TELEPHONE NO.:                                               FAX NO.:",
    "E-MAIL ADDRESS:", "ATTORNEY FOR (name):", "",
    "SUPERIOR COURT OF CALIFORNIA, COUNTY OF",
    " STREET ADDRESS:", " MAILING ADDRESS:", "CITY AND ZIP CODE:", "     BRANCH NAME:",
    ...Array.from({ length: 12 }, () => ""),
    "     b.           An appendix under rule 8.124.",
    "",
    "     c.           The original superior court file under rule 8.128. (NOTE: Local rules in the Court of Appeal, First, Third, and Fourth",
    "                  Appellate Districts, permit parties to stipulate (agree) to use the original superior court file instead of a clerk's",
    "                  you may select this option if your appeal is in one of these districts and all the parties have stipulated to use the",
    "                  superior court file instead of a clerk's transcript in this case. Attach a copy of this stipulation.)",
  ].map((text) => ({ text }));
  const fb = columnBands(app003);
  const band = fb.length - 1;
  check("a form's checkbox column is a second column down the items it stands beside", [...fb[band].second], [18]);
  check("…and the caption above them is not cut at it", [columnCuts(app003[0].text, fb[0]), columnCuts(app003[10].text, fb[10])], [[62], []]);
  // A pseudonym is one span on screen: a word of it on the second column is
  // a word of the name, and the line is cut after the name or not at all.
  const name = [10, 51];
  check("a name's word on the second column is not a cut inside the name",
    [columnCuts(named, { second: new Set([21]) }), columnCuts(named, { second: new Set([21]), atoms: [name] })], [[21], []]);
  check("…the column after the name still is", columnCuts(named, { second: new Set([52]), atoms: [name] }), [52]);
  check("…and a gap of spaces inside a span is not one either",
    columnCuts("Plaintiff Pat    Doe     Case No. 1", { atoms: [[10, 20]] }), [25]);
  check("each cell spans to the next cut, the first from past the indent", [columnWidths([62], 17), columnWidths([40, 62])], [[45], [40, 22]]);
}
// A JUSTIFIED page in two columns (the user's contract, page 15): the left-hand
// column fills its width, so most of its lines reach the second column with a
// space or two and begin nothing there. The lines above the first that falls
// short of it, and below the last, were left out of its band and drawn as one
// line, the right-hand column run straight on from the left.
console.log("a justified page in two columns");
{
  const L = (left, right, at = 62, lead = 1) => {
    const s = " ".repeat(lead) + left;
    return s + " ".repeat(Math.max(1, at - s.length)) + right;
  };
  const page = [
    "                   BUSINESS LOAN AND SECURITY          AGREEMENT TERMS AND CONDITIONS",
    "",
    L("each Guarantor authorize Windermere to use its, his, or her", "not waive any other Event of Default. None of the"),
    L("name, city, and state in a listing of Windermere's customers", "provisions of this Agreement may be waived except by a"),
    L("and in Windermere's advertising and marketing materials. To", "specific written waiver signed by an officer of Windermere"),
    L("ensure proper service, Windermere may choose to monitor", "and delivered to Borrower. The provisions of this"),
    L("and/or record telephone calls between Windermere and its", "Agreement may not be amended, except in a writing"),
    L("customers or other third parties. Borrower agrees that any", "signed by   Borrower   and   Windermere. Borrower will"),
    L("call between Windermere and Borrower (or its representative)", "reimburse Windermere for all reasonable attorneys'"),
    L("may be monitored and/or recorded for this purpose.", "fees (in the event Windermere utilizes a third party law"),
    L("principal balance and all lawful interest and fees are paid", "Agreement for convenience. Borrower and Windermere"),
    "",
    L("name, city, and state in a listing of Windermere's customers", "provisions of this Agreement may be waived except by a"),
  ].map((text) => ({ text }));
  check("the case: the top three lines reach the column with two spaces, one, two",
    [2, 3, 4].map((i) => page[i].text.slice(59, 62).split("").filter((c) => c === " ").length), [2, 1, 2]);
  const bands = columnBands(page);
  check("a second column's band runs up over the lines that reach it, and down past its last",
    bands.map((b) => b.second.has(62)), [false, false, true, true, true, true, true, true, true, true, true, false, false]);
  check("…so each of them is cut there", [2, 3, 4, 8, 10].map((i) => columnCuts(page[i].text, bands[i])), [[62], [62], [62], [62], [62]]);
  check("…and a blank line ends it: the same words under it are two words",
    [bands[12].second.has(62), columnCuts(page[12].text, bands[12])], [false, []]);
  check("…as does a line that does not land on the column: the heading above is its own",
    columnCuts(page[0].text, bands[0]).includes(62), false);
  // A form's box stands well clear of its labels: no line of it runs up to
  // its column, and the prose beside it is not cut on a space that happens
  // to fall there.
  const prose = "Plaintiff dismisses the entire action of all parties and all causes of action.";
  const box = [
    prose,
    "ATTORNEY OR PARTY WITHOUT ATTORNEY" + " ".repeat(7) + "FOR COURT USE ONLY",
    "NAME:" + " ".repeat(36) + "(court stamp)",
    "FIRM NAME:" + " ".repeat(31) + "(court stamp)",
    prose,
  ].map((text) => ({ text }));
  const fb = columnBands(box);
  check("the case: the prose has a word at the box's column, one space before it", [prose[40], prose[41] !== " ", prose[39] !== " ", fb[2].second.has(41)], [" ", true, true, true]);
  check("a box whose labels stand clear of its column does not run past its lines",
    [columnCuts(prose, fb[0]), columnCuts(prose, fb[4])], [[], []]);
  // An OCR'd page sets a column a character off on some lines: a line at the
  // edge of the run that begins one character from the column stands beside
  // it all the same.
  const caption = [
    L("WINDERMERE HAVENWOOD, LLC, a California", ")  Case No.: 25STCV59720", 51, 0),
    L("limited liability company,", ")", 50, 0),
    L("", ")  COMPLAINT FOR:", 50, 0),
    L("Plaintiff,", ")", 50, 16),
    L("vs.", ")  1. BREACH OF CONTRACT;", 50, 8),
  ].map((text) => ({ text }));
  check("a line at the edge of the run that begins a character off the column is beside it",
    columnBands(caption).map((b) => [...b.second]), [[50], [50], [50], [50], [50]]);
}
console.log("a second column placed for the reader's own font");
{
  const at = (second) => new Set(second);
  const opts = { unit: 10, gutter: 40, pad: 20 };
  const placed = placeColumns([
    { from: 0, cuts: [20], second: at([20]), w: [150] },
    { from: 0, cuts: [20], second: at([20]), w: [230] },
    { from: 20, cuts: [], second: at([20]) },
    { from: 0, cuts: [21], second: at([20]), w: [100] },
    { from: 24, cuts: [], second: at([20]) },
    { from: 0, cuts: [20, 32], second: at([20]), w: [120, 50] },
    null,
    { from: 5, cuts: [], second: at([]) },
  ], opts);
  check("the column stands where the widest text to its left ends, a gutter on, on every line beside it",
    placed.slice(0, 2).map((p) => p.ends), [[270], [270]]);
  check("…a line beginning at it, and one whose column is a character off, there too",
    [placed[2], placed[3].ends], [{ ind: 270, ends: [] }, [270]]);
  check("…an indent in the right-hand column and a gap inside it keep their grid distance from it",
    [placed[4].ind, placed[5].ends], [310, [270, 390]]);
  check("a line beside no second column keeps the plain grid", [placed[6], placed[7]], [null, null]);
  check("no further in than the grid has it where everything to its left fits",
    placeColumns([{ from: 0, cuts: [20], second: at([20]), w: [100] }], opts)[0].ends, [200]);
  check(`…and no further out than ${COLUMN_STRETCH} times that for one line far too wide: it pushes its own line`,
    placeColumns([{ from: 0, cuts: [20], second: at([20]), w: [400] }, { from: 0, cuts: [20], second: at([20]), w: [150] }], opts).map((p) => p.ends), [[300], [300]]);
  check(`second columns within ${COLUMN_SNAP} of each other are one column`,
    placeColumns([{ from: 0, cuts: [62], second: at([62]), w: [600] }, { from: 0, cuts: [61], second: at([61]), w: [500] }], opts).map((p) => p.ends), [[640], [640]]);
  check("a third column is placed past the second, from where the second stands",
    placeColumns([{ from: 0, cuts: [20, 50], second: at([20, 50]), w: [250, 300] }, { from: 0, cuts: [20, 50], second: at([20, 50]), w: [100, 100] }], opts).map((p) => p.ends),
    [[290, 630], [290, 630]]);
  check("on pleading paper the grid is counted from the body margin",
    placeColumns([{ from: 4, cuts: [50], second: at([50]), w: [100], origin: 4 }], opts)[0], { ind: 0, ends: [460] });
  check("the gutter is four grid characters", COLUMN_GUTTER, 4);
}
console.log("indents on the grid");
{
  check("an indent off pleading paper is its spaces", lineIndent("     The Court has read"), { lead: 5, ind: 5 });
  check("pleading paper: a numbered line's spaces are its number's, its text stands where they end",
    [lineIndent("Plaintiff,", { start: 18, origin: 4 }), lineIndent("JANE DOE,", { start: 4, origin: 4 })], [{ lead: 0, ind: 14 }, { ind: 0, lead: 0 }].map((x) => ({ lead: x.lead, ind: x.ind })));
  check("…the caption's right-hand column alone on a number of its own", lineIndent("DEMAND FOR JURY TRIAL", { start: 44, origin: 4 }), { lead: 0, ind: 40 });
  check("…and a line between two numbers is counted from the same margin", lineIndent(" ".repeat(44) + "1. BREACH", { origin: 4 }), { lead: 44, ind: 40 });
  check("…never in front of it", lineIndent("  (cont.)", { origin: 4 }), { lead: 2, ind: 0 });
  check("an empty line has no indent", lineIndent("    ", { origin: 4 }), { lead: 0, ind: 0 });
}
// The cells are wrappers with no data-fake: a line cut into them serializes as
// the line the file holds, the gap spaces included.
{
  const T = (s) => ({ nodeType: 3, data: s });
  const E = (name, kids, attrs) => ({ nodeType: 1, nodeName: name, childNodes: kids, getAttribute: (k) => (attrs && k in attrs ? attrs[k] : null) });
  const line = E("DIV", [E("SPAN", [
    E("SPAN", [T("Barbara "), E("SPAN", [T("Rosa")], { "data-fake": "Wren" }), T(","), E("SPAN", [T("     ")])]),
    T("\u201cDefendants\u201d)."),
  ])]);
  check("a line cut into column cells serializes as the file's text", serializeNodes(line), "Barbara Wren,     \u201cDefendants\u201d).");
}

// ---- what a file carries in the clear, read as the page reads it ------------
// The ⚠ beside a document in the folder list is this reading and the walk into
// it reads the page: the two must agree, or a document is marked that the walk
// finds nothing in.
console.log("clear reading (the folder's ⚠ and the page agree)");
{
  const key = parseKey([{ rows: [["Real Value", "Replacement"], ["Quillmark", "Mary Jones"], ["Jones", "Pat Doe"], ["Hepworth", "Sam Roe"]] }], "k");
  const opts = { rev: compile(key), reals: compileReals(key) };
  const pg = (n, lines) => `====== Page ${n} ======\n` + lines.map((l, i) => String(i + 1).padStart(2) + "  " + l).join("\n") + "\n";
  check("a real name that is a word of another name's fake is not a leak inside that fake",
    clearReading(pg(1, ["Mary Jones signed the lease."]), opts).values, []);
  check("…and the same name standing on its own is",
    clearReading(pg(1, ["Mary Jones met Jones."]), opts).values, ["Jones"]);
  check("every occurrence is counted, as the page counts them",
    clearReading(pg(1, ["Quillmark and", "Quillmark again."]), opts).values, ["Quillmark", "Quillmark"]);
  const two = pg(1, ["Hepworth was there."]) + pg(2, ["Hepworth was there.", "And Hepworth left."]);
  check("a spot keep is not a leak: only its own occurrence, on its own page",
    clearReading(two, { ...opts, spots: [makeSpot(1, "Hepworth", 0)] }).values, ["Hepworth", "Hepworth"]);
  check("…and a keep for the case masks every one",
    clearReading(two, { ...opts, mask: (t) => t.replace(/Hepworth/g, (m) => "\u0000".repeat(m.length)) }).values, []);
  check("a cited decision's party is spared",
    clearReading(pg(1, ["See Hepworth v. Smith (2001) 90 Cal.App.4th 12."]), opts).values, []);
  const flagRx = buildMatcher(["Jones"]);
  check("a flagged value inside a fake is not standing in the clear",
    clearReading(pg(1, ["Mary Jones and Jones."]), { rev: opts.rev, flagRx }).flags, 1);
  check("no key and no flags, nothing to read", clearReading(pg(1, ["Quillmark"]), {}), { values: [], flags: 0 });
  // A flagged NAME with a pseudonym in it: "Rosa" in the clear, "Quillmark"
  // faked as "Mary Jones". Read as the page shows it, it stands half in the clear.
  const partly = buildMatcher(["Rosa Quillmark"]);
  check("a flagged name with a pseudonym in it counts where some of it stands in the clear",
    clearReading(pg(1, ["Rosa Mary Jones testified.", "Rosa Quillmark signed."]), { rev: opts.rev, flagRx: partly }).flags, 2);
  check("…and one wholly inside a fake does not",
    clearReading(pg(1, ["Mary Jones testified."]), { rev: opts.rev, flagRx: buildMatcher(["Quillmark"]) }).flags, 0);
  check("…nor one kept where it stands",
    clearReading(pg(1, ["Rosa signed.", "Rosa left."]), { flagRx: buildMatcher(["Rosa"]), spots: [makeSpot(0, "Rosa", 0)] }).flags, 1);
  check("clearPieces: the match less what is held, trimmed", clearPieces("Rosa Quillmark signed", 0, 14, [[5, 14]]), [[0, 4]]);
  check("…none where it is all held", clearPieces("Rosa Quillmark", 5, 14, [[5, 14]]), []);
  check("…and a margin number or bare punctuation is no piece", clearPieces("Rosa\n 5  Quillmark,", 0, 19, [[5, 9]]), [[0, 4], [9, 19]]);
  check("…but blank and a comma alone are not", clearPieces("Rosa , Quill", 0, 12, [[0, 4], [7, 12]]), []);
  // A real name wrapped down a caption's left-hand column, the ")" and the
  // case number between its halves: one leak, as the page marks it.
  const k2 = parseKey([{ rows: [["Real Value", "Replacement"], ["Jonathan Avery Smith Walker", "Quarry Opalridge Dovewood Cascadia"], ["Walker", "Cascadia"], ["Helen Rasho", "Ingrid Strangeways"]] }], "k");
  const o2 = { rev: compile(k2), reals: compileReals(k2) };
  const cap = (a, b) => a.padEnd(56) + b;
  check("a real name wrapped down a caption's column is one leak, not its surname token",
    clearReading(pg(1, [cap("Ingrid Strangeways, an individual; and Jonathan", ")  Case No.: 25STCV59720"), cap("Avery Smith Walker, an", ")")]), o2).values,
    ["Jonathan Avery Smith Walker"]);
  check("…and the fake wrapped the same way is no leak at all",
    clearReading(pg(1, [cap("Helen Rasho, an individual; and Quarry", ")  Case No.: 25STCV59720"), cap("Opalridge Dovewood Cascadia, an", ")")]), o2).values,
    ["Helen Rasho"]);
}
// The disk text with each text node's place in it, for a reading of the disk
// text to put its marks back on the page.
{
  const T = (s) => ({ nodeType: 3, data: s });
  const E = (name, kids, attrs) => ({ nodeType: 1, nodeName: name, childNodes: kids, getAttribute: (k) => (attrs && k in attrs ? attrs[k] : null) });
  const a = T("Helen "), b = T("Rasho"), c = T(" met "), d = T("Quillmark");
  const body = E("DIV", [E("DIV", [a, E("SPAN", [T("Mary Jones")], { "data-fake": "Pat Doe" }), c]), E("DIV", [E("SPAN", [d], { "data-here": "" }), b])]);
  const got = serializeHeld(body, { mapped: true });
  check("mapped: the disk text, the fake's place, the spot's, and every text node but the fake's own",
    [got.text, got.pns, got.held, got.segs.map((g) => [g.node.data, g.start, g.end])],
    ["Helen Pat Doe met \nQuillmarkRasho", [[6, 13]], [[19, 28]], [["Helen ", 0, 6], [" met ", 13, 18], ["Quillmark", 19, 28], ["Rasho", 28, 33]]]);
  check("…and without it, what it always gave", Object.keys(serializeHeld(body)), ["text", "held", "pns"]);
}

// ---- a selection, cut out of the text the file carries ------------------------
// The reader's copy, cut and drag put the PSEUDONYMS on the clipboard: the
// page is read whole as the save reads it, and the selection's two ends are
// found in that text (serializeHeld's `points`) and cut out of it (clipText).
console.log("copying a selection");
{
  const T = (s) => ({ nodeType: 3, data: s });
  const E = (name, kids, attrs) => ({ nodeType: 1, nodeName: name, childNodes: kids, getAttribute: (k) => (attrs && k in attrs ? attrs[k] : null) });
  const g = T(" 2  "), a = T("Plaintiff "), real = T("Helen Rasho"), b = T(" moves."), c = T("Second line");
  const pn = E("SPAN", [real], { "data-fake": "Ingrid Strangeways", "data-real": "Helen Rasho" });
  const gutter = E("SPAN", [g], { class: "gutter" });
  const line1 = E("DIV", [gutter, a, pn, b]), line2 = E("DIV", [c]);
  const body = E("DIV", [line1, line2]);
  const at = (...pts) => serializeHeld(body, { points: pts }).at;
  const disk = serializeHeld(body, { mapped: true });
  check("the disk text the points are found in", disk.text, " 2  Plaintiff Ingrid Strangeways moves.\nSecond line");
  check("…its pseudonym spans in the order of their places", [disk.pnNodes.length, disk.pnNodes[0] === pn], [1, true]);
  check("a point in a text node is its offset in the disk text", at({ node: a, offset: 4 }, { node: b, offset: 6 }, { node: c, offset: 6 }), [8, 38, 46]);
  check("a point between children stands where the walk is there: before a line's newline, or after it inside the line",
    at({ node: body, offset: 1 }, { node: line2, offset: 0 }, { node: body, offset: 2 }), [39, 40, 51]);
  check("a point inside a pseudonym takes it whole: a start point its start, an end point its end",
    at({ node: real, offset: 4 }, { node: real, offset: 4, end: true }), [14, 32]);
  check("…and one at its very start or end is that place either way",
    at({ node: real, offset: 0, end: true }, { node: real, offset: 11 }, { node: pn, offset: 0 }, { node: pn, offset: 1, end: true }), [14, 32, 14, 32]);
  check("a point not on the page is -1", at({ node: T("elsewhere"), offset: 2 }), [-1]);
  check("…and without points there is no `at`", "at" in serializeHeld(body), false);

  const sw = [{ start: 14, end: 32, to: "Helen Rasho" }];
  check("clipText: the stretch, a swap it reaches written whole", clipText(disk.text, sw, 4, 20), "Plaintiff Helen Rasho");
  check("…a swap only touched at the stretch's end is not reached", [clipText(disk.text, sw, 4, 14), clipText(disk.text, sw, 32, 39)], ["Plaintiff ", " moves."]);
  check("…a stretch inside a swap is the swap", clipText(disk.text, sw, 20, 21), "Helen Rasho");
  check("…the skipped margin number is left out, the newline kept", clipText(disk.text, [], 0, 51, [[0, 4]]), "Plaintiff Ingrid Strangeways moves.\nSecond line");
  check("…an empty stretch is nothing", clipText(disk.text, sw, 20, 20), "");
  // A name wrapped over two numbered lines: a swap per piece, the margin between them.
  const wrapped = " 1  Helen\n 2  Rasho signed";
  const pieces = [{ start: 4, end: 9, to: "Ingrid" }, { start: 14, end: 19, to: "Strangeways" }];
  check("…a wrapped name's pieces with the margin numbers out from between them",
    clipText(wrapped, pieces, 0, wrapped.length, [[0, 4], [10, 14]]), "Ingrid\nStrangeways signed");
  check("…and a stretch that begins in the margin is the line's text", clipText(wrapped, pieces, 11, wrapped.length, [[0, 4], [10, 14]]), "Strangeways signed");

  // THE CITATION NEEDS THE PAGE. A cited decision's party is the decision's,
  // and the forward pass spares it only where the reporter after it is in the
  // text it reads: a selection that stops at the case name, read on its own,
  // would fake the decision's party — a citation to a case that does not exist
  // pasted straight into the drafting model.
  const key = parseKey([{ rows: [["Real Value", "Replacement"], ["Varnell", "Pembrook"], ["Ostrow Freight", "Halden Cartage"]] }], "k");
  const fwd = compileForward(key);
  const swaps = (text) => {
    const out = [];
    let off = 0;
    for (const r of forwardRuns(fwd, blankRanges(text, citedNameSpans(text)))) {
      const n = r.t === "swap" ? r.from.length : r.s.length;
      if (r.t === "swap") out.push({ start: off, end: off + n, to: r.to });
      off += n;
    }
    return out;
  };
  const page = "Varnell signed it. As this Court held in Varnell v. Ostrow Freight (2019) 31 Cal.App.5th 200, the clause binds.";
  const from = page.indexOf("As this"), to = page.indexOf(" (2019)");
  const frag = page.slice(from, to);
  check("read on its own, the fragment fakes the decision's parties", clipText(frag, swaps(frag), 0, frag.length), "As this Court held in Pembrook v. Halden Cartage");
  check("cut out of the page read whole, it carries them as cited", clipText(page, swaps(page), from, to), "As this Court held in Varnell v. Ostrow Freight");
  check("…while this case's own Varnell on the same page is faked", clipText(page, swaps(page), 0, 18), "Pembrook signed it.");
}

// ---- a page that did not OCR ------------------------------------------------
// The page's text goes and one line saying so takes its place; the header is
// not a line, and PDF-Linker's trailer is not the page's text.
console.log("did not OCR");
{
  check("the marker", DID_NOT_OCR, "[DID NOT OCR]");
  check("a page of noise is one line",
    didNotOcrLines([" 1  ~~ /l|; ,,.", " 2  rn ll1 ;:", "", " 3"]), ["[DID NOT OCR]"]);
  check("an empty page gains the line", didNotOcrLines([]), ["[DID NOT OCR]"]);
  check("the trailer stays, with the blank line before it",
    didNotOcrLines(["garble", "", "====== Authorities cited (public verification links) ======", "Civ. Code, § 1717: https://example.test"]),
    ["[DID NOT OCR]", "", "====== Authorities cited (public verification links) ======", "Civ. Code, § 1717: https://example.test"]);
  const doc = parseExport("====== Page 1 ======\nkept\n====== Page 2 ======\n 1  a;;l\n 2  xx\n====== Page 3 ======\nkept too\n");
  doc.pages[1].lines = didNotOcrLines(doc.pages[1].lines);
  check("the file keeps every header and the other pages",
    serializeExport(doc), "====== Page 1 ======\nkept\n====== Page 2 ======\n[DID NOT OCR]\n====== Page 3 ======\nkept too\n");
  check("…and reads back as the same pages", parseExport(serializeExport(doc)).pages.map((p) => p.lines), [["kept"], ["[DID NOT OCR]"], ["kept too"]]);
  check("a stripped page is stripped again to the same lines", didNotOcrLines(["[DID NOT OCR]"]), ["[DID NOT OCR]"]);
}

// A page marked Did not OCR is handed to PDF-Linker as a line of New Real
// Values.txt, or its next full run rebuilds the export from the PDF and OCRs
// the page again. The line names the PDF where the reader knows it, else the
// export, and the PDF page; PDF-Linker marks the page in the PDF and spends
// the line, and from then on writes the page's header as DID NOT OCR itself.
console.log("did not OCR, handed to PDF-Linker");
{
  const e = { doc: "Kingscote Decl..txt", pdf: "Feit Decl.pdf", page: 43 };
  check("the line names the PDF where it is known", noOcrLine(e), "did not ocr: Feit Decl.pdf | page 43");
  check("…and the export where it is not", noOcrLine({ doc: "Kingscote Decl..txt", pdf: "", page: 7 }), "did not ocr: Kingscote Decl..txt | page 7");
  check("an entry with no page is not a line", noOcrLine({ doc: "X.txt", page: 0 }), "");
  let list = setNoOcr([], e, true);
  list = setNoOcr(list, { doc: "kingscote decl..txt", pdf: "", page: 43 }, true);
  list = setNoOcr(list, { doc: "Feit Decl.pdf", pdf: "", page: 43 }, true);
  check("one page, one entry, however it is named", list.length, 1);
  check("another page of it is another entry", setNoOcr(list, { ...e, page: 44 }, true).length, 2);
  check("off again", setNoOcr(list, e, false), []);
  check("nothing moves, the same list", setNoOcr(list, e, true) === list, true);
  check("sameNoOcr needs the page", sameNoOcr(e, { ...e, page: 1 }), false);
  const file = formatValuesFile(["Rosa Delgado"], [{ control: "no", value: "Semole" }], [], list);
  check("written after the values and the keeps",
    file.split("\n").filter((l) => l && l[0] !== "#"),
    ["Rosa Delgado", "no: Semole", "did not ocr: Feit Decl.pdf | page 43"]);
  const back = parseReaderFile(file);
  check("read back, never as a value", [back.values, back.noOcr], [["Rosa Delgado"], [{ doc: "Feit Decl.pdf", pdf: "", page: 43 }]]);
  check("…and written again the same", formatValuesFile(back.values, back.keeps, back.phrases, back.noOcr), file);
  check("a line PDF-Linker would write back reads too",
    parseReaderFile("DID NOT OCR:  Exhibits.pdf  |  p. 9\n").noOcr, [{ doc: "Exhibits.pdf", pdf: "", page: 9 }]);
  check("an unreadable one is still no value", parseReaderFile("did not ocr: Exhibits page nine\n"), { values: [], keeps: [], phrases: [], noOcr: [], ocrAgain: [], textFixed: [] });
  check("NOOCR_RE takes the pipe form", NOOCR_RE.test("did not ocr: A.pdf | page 2"), true);
  check("a stripped page reads Did not OCR", readsDidNotOcr(didNotOcrLines([" 1  soup"])), true);
  check("…the trailer aside", readsDidNotOcr(["[DID NOT OCR]", "", "====== Authorities cited (public verification links) ======", "x"]), true);
  check("a page of text does not", readsDidNotOcr(["[DID NOT OCR]", "more"]), false);
  const ran = parseExport("====== Page 2 — NOTE: marked DID NOT OCR; the page's text is left out ======\n[DID NOT OCR]\n");
  check("PDF-Linker's own header says the page is its now", headerSaysDidNotOcr(ran.pages[0]), true);
  check("…and an ordinary one does not", headerSaysDidNotOcr(parseExport("====== Page 2 ======\n[DID NOT OCR]\n").pages[0]), false);
  check("…and the header round-trips byte for byte", serializeExport(ran), "====== Page 2 — NOTE: marked DID NOT OCR; the page's text is left out ======\n[DID NOT OCR]\n");
}

// ↻ OCR This Page undoes a page's DID NOT OCR mark: the page is handed to
// PDF-Linker as `ocr again: FILE | page N`, which takes the mark off the page
// in its PDF, and its next full run reads the page again.
console.log("OCR this page again");
{
  const e = { doc: "Kingscote Decl..txt", pdf: "Feit Decl.pdf", page: 43 };
  check("the line names the PDF where it is known", ocrAgainLine(e), "ocr again: Feit Decl.pdf | page 43");
  check("…and the export where it is not", ocrAgainLine({ doc: "Kingscote Decl..txt", pdf: "", page: 7 }), "ocr again: Kingscote Decl..txt | page 7");
  check("an entry with no page is not a line", ocrAgainLine({ doc: "X.txt", page: 0 }), "");
  let list = setOcrAgain([], e, true);
  list = setOcrAgain(list, { doc: "Feit Decl.pdf", pdf: "", page: 43 }, true);
  check("one page, one entry", list.length, 1);
  check("off again", setOcrAgain(list, e, false), []);
  const file = formatValuesFile(["Rosa Delgado"], [], [], [{ doc: "Exhibits.pdf", page: 2 }], list);
  check("written after the pages not to OCR",
    file.split("\n").filter((l) => l && l[0] !== "#"),
    ["Rosa Delgado", "did not ocr: Exhibits.pdf | page 2", "ocr again: Feit Decl.pdf | page 43"]);
  const back = parseReaderFile(file);
  check("read back, never as a value", [back.values, back.noOcr.length, back.ocrAgain],
    [["Rosa Delgado"], 1, [{ doc: "Feit Decl.pdf", pdf: "", page: 43 }]]);
  check("…and written again the same", formatValuesFile(back.values, back.keeps, back.phrases, back.noOcr, back.ocrAgain), file);
  check("the other spellings read too",
    parseReaderFile("OCR this page again: Exhibits.pdf | p. 9\nocr-again:  B.pdf  |  page 3\n").ocrAgain,
    [{ doc: "Exhibits.pdf", pdf: "", page: 9 }, { doc: "B.pdf", pdf: "", page: 3 }]);
  check("an unreadable one is still no value", parseReaderFile("ocr again: Exhibits page nine\n"),
    { values: [], keeps: [], phrases: [], noOcr: [], ocrAgain: [], textFixed: [] });
  check("OCRAGAIN_RE takes the pipe form", OCRAGAIN_RE.test("ocr again: A.pdf | page 2"), true);
  check("…and is not a did-not-ocr line", NOOCR_RE.test("ocr again: A.pdf | page 2"), false);
  check("a file with neither list writes neither", formatValuesFile(["X Y"], [], [], [], []).includes("ocr again: "), false);
  check("the header says what the line does", formatValuesFile([], [], [], [], []).includes("'ocr again:"), true);
}

// ✎ Use my text hands a page TRANSCRIBED by hand to PDF-Linker as `text
// corrected: FILE | page N | sum …`; PDF-Linker writes the page's text, as
// saved, into the PDF as its text layer, and applies the line only where the
// export's page still reads as the sum says.
console.log("a page transcribed by hand");
{
  // PDF-Linker's _pn_page_text_sum pins the same three values
  // (tests/test_text_corrected_page.py): the two sides must never disagree.
  check("the sum is PDF-Linker's", pageTextSum(["The lease was signed."]), "46d66a09");
  check("…for an empty page", pageTextSum([]), "811c9dc5");
  check("…and past ASCII", pageTextSum(["Rent: $900 — paid"]), "a1d0b975");
  check("blank lines at the ends and trailing blanks do not count",
    pageTextSum(["", "  The lease was signed.  ", "Rent: $900 — paid\t", "", ""]),
    pageTextSum(["  The lease was signed.", "Rent: $900 — paid"]));
  check("a rule line ends the page", pageTextSum(["The lease was signed.", "", "====== Authorities cited (public verification links) ======", "Smith v. Jones"]), "46d66a09");
  check("…and any change to the text moves it", pageTextSum(["The lease was signed!"]) === "46d66a09", false);
  const e = { doc: "Kingscote Decl..txt", pdf: "Feit Decl.pdf", page: 4, sum: "0A1B2C3D" };
  check("the line names the PDF and carries the sum", textFixedLine(e), "text corrected: Feit Decl.pdf | page 4 | sum 0a1b2c3d");
  check("…and is written without one where there is none", textFixedLine({ doc: "X.txt", page: 2 }), "text corrected: X.txt | page 2");
  check("a sum that is not one is dropped", textFixedLine({ doc: "X.txt", page: 2, sum: "zz" }), "text corrected: X.txt | page 2");
  let list = setTextFixed([], e, true);
  list = setTextFixed(list, { doc: "Feit Decl.pdf", pdf: "", page: 4, sum: "0a1b2c3d" }, true);
  check("one page, one entry", list.length, 1);
  check("nothing moves, the same list", setTextFixed(list, e, true) === list, true);
  const moved = setTextFixed(list, { ...e, sum: "ffffffff" }, true);
  check("a new save moves the sum", [moved.length, moved[0].sum], [1, "ffffffff"]);
  check("off again", setTextFixed(list, e, false), []);
  const file = formatValuesFile(["Rosa Delgado"], [], [], [{ doc: "Exhibits.pdf", page: 2 }], [], list);
  check("written last, after the page lists",
    file.split("\n").filter((l) => l && l[0] !== "#"),
    ["Rosa Delgado", "did not ocr: Exhibits.pdf | page 2", "text corrected: Feit Decl.pdf | page 4 | sum 0a1b2c3d"]);
  const back = parseReaderFile(file);
  check("read back, never as a value", [back.values, back.textFixed],
    [["Rosa Delgado"], [{ doc: "Feit Decl.pdf", pdf: "", page: 4, sum: "0a1b2c3d" }]]);
  check("…and written again the same", formatValuesFile(back.values, back.keeps, back.phrases, back.noOcr, back.ocrAgain, back.textFixed), file);
  check("a line typed by hand, without a sum, reads too",
    parseReaderFile("Text-Corrected:  Exhibits.pdf  |  p. 9\n").textFixed, [{ doc: "Exhibits.pdf", pdf: "", page: 9, sum: "" }]);
  check("an unreadable one is still no value", parseReaderFile("text corrected: Exhibits page nine\n"),
    { values: [], keeps: [], phrases: [], noOcr: [], ocrAgain: [], textFixed: [] });
  check("TEXTFIXED_RE is not a did-not-ocr line", NOOCR_RE.test("text corrected: A.pdf | page 2"), false);
  check("…and takes the sum", TEXTFIXED_RE.exec("text corrected: A.pdf | page 2 | sum 0a1b2c3d")[3], "0a1b2c3d");
  const ran = parseExport("====== Page 4 — NOTE: TEXT CORRECTED by hand in the text reader; this page's text layer is the operator's transcription ======\nThe lease.\n");
  check("PDF-Linker's header says the page is its now", headerSaysTextCorrected(ran.pages[0]), true);
  check("…and an ordinary one does not", headerSaysTextCorrected(parseExport("====== Page 4 ======\nThe lease.\n").pages[0]), false);
  check("the header says what the line does", formatValuesFile([], [], [], [], [], []).includes("'text corrected:"), true);
}

console.log("margin numbers the OCR missed");
{
  // A pleading page as PDF-Linker writes it: a number, two spaces, the line;
  // a bare number on an empty numbered line; an unnumbered line four places in.
  const num = (n, t = "") => String(n).padStart(2) + (t ? "  " + t : "");
  const body = (n) => `Line ${n} of the motion.`;
  const page = (skip = new Set(), over = {}) => {
    const out = ["", "", ""];
    for (let n = 1; n <= 28; n++) {
      if (over[n] !== undefined) { if (over[n] !== null) out.push(over[n]); continue; }
      out.push(skip.has(n) ? "    " + body(n) : num(n, body(n)));
    }
    out.push("", "", "                                  - 2 -", "", "            NOTICE OF MOTION");
    return out;
  };
  const whole = page();
  check("marginNumber reads the gutter", [marginNumber(" 7  text"), marginNumber("17"), marginNumber("    text"), marginNumber(" 0  x")], [7, 17, null, null]);
  check("numberChain keeps the numbers in their order", numberChain([1, 2, null, 3, 4]), [true, true, false, true, true]);
  check("…and drops one read out of it", numberChain([14, 15, null, 11, 18, 19]), [true, true, false, false, true, true]);
  check("…of two runs as long, the one that steps with the lines", numberChain([15, 18, 17, 19]), [true, false, true, true]);
  check("misreadNumber reads OCR's letters for digits", [misreadNumber("l2  corporation,"), misreadNumber("I7"), misreadNumber("2O  the")].map((m) => m && m.n), [12, 17, 20]);
  check("…but an all-digit gutter is not misread, and a word is not a number", [misreadNumber("12  x"), misreadNumber("Line 4")], [null, null]);
  check("a page with every number has nothing to put back", restoreMarginNumbers(whole, { last: 28 }), null);
  const one = restoreMarginNumbers(page(new Set([9])), { last: 28 });
  check("a line between two numbers that lost its own gets it back", [one.lines[3 + 8], one.added], [" 9  Line 9 of the motion.", [9]]);
  check("…and nothing else on the page moves", one.lines.filter((l, i) => i !== 11), whole.filter((l, i) => i !== 11));
  const dropped = restoreMarginNumbers(page(new Set(), { 6: null }), { last: 28 });
  check("an empty numbered line the OCR dropped comes back as a bare number", [dropped.lines.slice(7, 10), dropped.added], [[" 5  " + body(5), " 6", " 7  " + body(7)], [6]]);
  const blankLine = restoreMarginNumbers(page(new Set(), { 6: "" }), { last: 28 });
  check("…and one it left blank takes its number", blankLine.lines[8], " 6");
  const misread = restoreMarginNumbers(page(new Set(), { 12: "l2  " + body(12) }), { last: 28 });
  check("a number read as letters is put right", misread.lines[14], "12  " + body(12));
  const swapped = restoreMarginNumbers(page(new Set([16]), { 17: "11  " + body(17) }), { last: 28 });
  check("a number read out of its order is put right with the one missing beside it", [swapped.lines.slice(18, 20), swapped.added], [["16  " + body(16), "17  " + body(17)], [16, 17]]);
  const head = restoreMarginNumbers(page(new Set([1, 2])), { last: 28 });
  check("above the first number read: the lines against it, one each", head.lines.slice(2, 6), ["", " 1  " + body(1), " 2  " + body(2), " 3  " + body(3)]);
  const headBlank = restoreMarginNumbers(page(new Set(), { 1: "", 2: "" }), { last: 28 });
  check("…and empty numbered lines above it take theirs from the blank lines", headBlank.lines.slice(0, 6), ["", "", "", " 1", " 2", " 3  " + body(3)]);
  const foot = restoreMarginNumbers(page(new Set([27, 28])), { last: 28 });
  check("below the last: the lines against it, to the number the pages run to", foot.lines.slice(28, 32), ["26  " + body(26), "27  " + body(27), "28  " + body(28), ""]);
  check("…and the footer under the blank lines is left alone", foot.lines.slice(-5), whole.slice(-5));
  check("…but without the number the pages run to, nothing is put back at the foot", restoreMarginNumbers(page(new Set([27, 28])), {}), null);
  const footBlank = restoreMarginNumbers(page(new Set(), { 27: null, 28: null }), { last: 28 });
  check("empty lines at the foot come back on the blank lines before the footer", [footBlank.lines.slice(28, 31), footBlank.lines.slice(-3)], [["26  " + body(26), "27", "28"], whole.slice(-3)]);
  const footer = ["", "", "", ...Array.from({ length: 27 }, (_, k) => num(k + 1, body(k + 1))), "- 2 -", "NOTICE OF MOTION"];
  check("text straight under the last number, more lines than numbers missing, is not numbered", restoreMarginNumbers(footer, { last: 28 }), null);
  // A caption's single-spaced lines: more lines than numbers between 1 and 3.
  const capOf = (third) => ["", " 1  JANE ATTORNEY", "    jane@law.example", third, "    100 Main Street", ...Array.from({ length: 26 }, (_, k) => num(k + 3, body(k + 3)))];
  check("between two numbers with more lines than numbers missing, nothing is guessed", restoreMarginNumbers(capOf("    LAW OFFICES"), { last: 28 }), null);
  check("…and a number read among them is the paper's own, so nothing is missing", restoreMarginNumbers(capOf("2   LAW OFFICES"), { last: 28 }), null);
  check("…not a misreading that reads as another number", restoreMarginNumbers(capOf("l   LAW OFFICES"), { last: 28 }), null);
  check("…and one that does is its line's number", restoreMarginNumbers(capOf("Z   LAW OFFICES"), { last: 28 }).lines[3], " 2   LAW OFFICES");
  const few = ["", ...Array.from({ length: 28 }, (_, k) => (k % 3 ? "    " + body(k + 1) : num(k + 1, body(k + 1))))];
  check("too few numbers read to be sure it is pleading paper: left as it is", restoreMarginNumbers(few, { last: 28 }), null);
  const trailer = [...page(new Set([5])), "====== Authorities cited (public verification links) ======", " 3  Smith v. Jones (2020) 1 Cal.5th 1"];
  const tr = restoreMarginNumbers(trailer, { last: 28 });
  check("the Authorities trailer is not the page's", [tr.added, tr.lines.slice(-2)], [[5], trailer.slice(-2)]);
  const high = [...whole.slice(0, 30), num(88, body(28)), ...whole.slice(31)];
  check("a number misread past the one the pages run to is put right", restoreMarginNumbers(high, { last: 28 }).lines[30], "28  " + body(28));
  check("…and with no such number known, is no reason to put back sixty lines", restoreMarginNumbers(high.map((l, i) => (i === 5 || i === 9 ? "    " + l.slice(4) : l))), null);
  const doc = parseExport(["====== Page 1 ======", ...whole, "====== Page 2 ======", ...page(new Set([3])), "====== Page 3 ======", "EXHIBIT A"].join("\n") + "\n");
  check("pleadingLast: the number the document's pages run to", pleadingLast(doc.pages), 28);
  check("…and none from a page or none", [pleadingLast(parseExport(["====== Page 1 ======", ...whole].join("\n")).pages), pleadingLast([])], [null, null]);
  const tops = (...ns) => ns.map((t) => ({ header: "x", lines: Array.from({ length: t }, (_, k) => num(k + 1, "x")) }));
  check("…the highest that two pages reach: the OCR loses numbers at the foot, never adds them", [pleadingLast(tops(28, 27, 26)), pleadingLast(tops(28, 26, 28))], [27, 28]);
  check("…so one number misread high at the foot of one page is not it", pleadingLast([...tops(28, 28), { header: "x", lines: [...Array.from({ length: 27 }, (_, k) => num(k + 1, "x")), num(88, "x")] }]), 28);
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
