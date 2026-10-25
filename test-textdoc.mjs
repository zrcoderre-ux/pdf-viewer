// Node-runnable tests for the text reader's document model (viewer/textdoc.js).
// Run: node test-textdoc.mjs
//
// The property that matters most is the ROUND TRIP: a PDF-Linker export the
// reader opens and saves without an edit must come back byte for byte, and a
// pseudonym span must always serialize as its FAKE — the real names live on
// top of the file and never in it.

import {
  markCss,
  parseExport, serializeExport, pageLabel, gutterPrefix, pageIsNumbered, shiftDown, shiftUp, tidyGutters, makeColumnBox, reflowBox, boxBackspace, boxEdit, openBoxAround, resizeBox, pageNumbersComplete,
  serializeNodes, textOf, findRealsInPlain,
  serializeHeld, serializeMapped, clipText, editedSpans, spanEdited, typedReals, typedPseudonymsCited, typedSpans, withoutEscaped, escapedPlace, blankRanges, citedNameSpans, insideSpans, setOwnPartyWords, ownPartyWordsOf, occurrencesOf, makeSpot, normalizeSpots, sameSpot, spotsOnPage, spotRanges, fakeFor,
  addValue, removeValue, dropFlagsInKey, keyAnswersFlags, folderStateMoves, legacyStateHold, legacyListSplit, mergeStoredLists, formatValuesFile, parseValuesFile, parseReaderFile, addKeep, removeKeep, keptControl, flagProblem, phraseProblem, isPhrase,
  keepNeedsRun, owedKeeps, owe, settleLocal, makeKeep,
  isExportName, isKeyName, isQuarantinedName, isMarkdownName, docLabel, runMarker, normalizeSettings, fontCss, VALUES_FILE, PAGE_WIDTH,
  ruleParts, ruleShape, clearReading, clearPieces, didNotOcrLines, DID_NOT_OCR,
  columnCuts, columnBands, columnWidths, lineIndent, placeColumns, COLUMN_GAP, COLUMN_REACH, COLUMN_SNAP, COLUMN_GUTTER, COLUMN_STRETCH,
  checkboxRanges, checkboxState,
  noOcrLine, setNoOcr, sameNoOcr, readsDidNotOcr, headerSaysDidNotOcr, NOOCR_RE,
  ocrAgainLine, setOcrAgain, OCRAGAIN_RE,
  textFixedLine, setTextFixed, pageTextSum, pageFurnitureLine, headerSaysTextCorrected, headerSaysCondensed, TEXTFIXED_RE,
  wordsChanged, AUTO_TEXT_FIXED_WORDS, decisionDelta, applyDecisionDelta,
  marginNumber, numberChain, misreadNumber, restoreMarginNumbers, pleadingLast,
  readExport, cloneDoc, shownPages, splitFolderRows, pageScan, spotsAfterSwaps, realsLeftInExport, compileDisplay,
  pageListsAfter, fixedSumsFor, readerFileHasLines,
  keepLines, carriesKeep, spendLines, forgetKeepLines, noteKeepLines, keepLinesCarried, writtenBaseline,
  valuesLineKey, valuesLineKeys, linesNotOurs, withLinesNotOurs, sameBytes, KEY_FILE, keyRank, noteLinesRead, setAsideLines, notedBlocks,
  COMMENTS_HEAD, parseComments, commentLine, commentsBlock, findPassage,
  launcherFolderToken, rerunUrl, runRequestText, RUN_REQUEST_FILE, LAUNCHER_STEMS,
  captionParens,
  captionEdit,
  STRIKE_MARK, strikeRuns, strikeEdit, unstruck, strikeLayout,
} from "./viewer/textdoc.js";
import { parseKey, compileForward, compile, compileReals, buildMatcher, buildFindMatcher, forwardRuns, findRealSpans, translate, translateRuns } from "./viewer/pseudo-key.js";

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
    spans(T), ["Rasho v. Quillmark", "Semole v. Sansoucie", "Rasho"]);
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
  // WHAT A FLAG ASKS FIRST (citedIn in the reader). A flag is an authoritative
  // --term to PDF-Linker, a party of THIS case; a cited decision's party
  // handed over so, where the other side is this case's party already ("Ford
  // Motor Company" in a lemon-law case), makes the run take the cite for the
  // case's own caption and rename the published decision. The reader asks
  // before flagging a selection inside one, and reads it from these spans.
  {
    const P = "  1  Plaintiff Ingrid Strangeways bought a Crestline truck.\n"
      + "  2  Plaintiff relies on Kremerman v. Ford Motor Co. (2019) 30 Cal.App.5th 1, 5.\n";
    check("a flag's question: either side of a cited decision is inside its name",
      [at(P, "Kremerman"), at(P, "Ford"), at(P, "Motor Co.")], [true, true, true]);
    check("…and the case's own party on the line above is not",
      [at(P, "Strangeways"), at(P, "Crestline")], [false, false]);
  }
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
  // THE SHORT CITE WITH NO "supra", which PDF-Linker protects
  // (_pn_short_cite_follows) and this did not read: the party's name, a comma,
  // a volume and a REPORTER, then a pin or a page — or, behind "(", ";" or a
  // signal, the bare pin "at p." of the Style Manual's short form. A name
  // typed into one was marked as this case's party and written as its
  // pseudonym: "(Pratt, 30 Cal.App.5th at p. 5.)", a renamed authority.
  {
    const SC = [
      ["(Jones, 30 Cal.App.5th at p. 5.)", ["Jones"]],
      ["(Jones, 30 Cal.App.5th at pp. 5-6)", ["Jones"]],
      ["(Jones, at p. 5)", ["Jones"]],
      ["(See Jones, 30 Cal.App.5th at p. 5.)", ["Jones"]],
      ["x; Ruiz, at p. 9", ["Ruiz"]],
      ["(O'Brien, 5 Cal.5th at 10)", ["O'Brien"]],
      ["(Pérez, 30 Cal.App.5th at p. 5.)", ["Pérez"]],
      ["(Acme Corp., 30 Cal.App.5th 1, 5)", ["Acme Corp."]],
      ["(Jones, 30 Cal.App.5th, 5)", ["Jones"]],
      ["(Department of Transportation, 30 Cal.App.5th at p. 7)", ["Department of Transportation"]],
      ["Jones, 30 F. Supp. 2d 100", ["Jones"]],
      [" 3  Nothing else. (Jones,\n 4  30 Cal.App.5th at p. 5.)", ["Jones"]],
    ];
    check("a short cite with no supra: the name alone, whatever the reporter, pin or signal",
      SC.map(([t]) => spans(t)), SC.map(([, w]) => w));
    // …and the name ONLY: a span reaching back into the sentence before the
    // cite would spare a name of this case standing there, unmarked.
    check("…cut after the sentence before it and after a signal",
      [spans("Served on Helen Rasho. Jones, 30 Cal.App.5th at p. 5."), spans("Rasho. See Jones, at p. 5")], [["Jones"], ["Jones"]]);
    const NOT = [
      "Jones, 2019", "JOHN DOE, DOES 1 through 10", "Jones, 12 March 2020", "Jones, 30 Main Street",
      "Jones, 25STCV12345", "(Jones, at 5)", "Mr. Jones, at p. 5 of his deposition", "(Jones Decl., at p. 3)",
      "(Smith Depo., at p. 12)", "Rasho, 30 days later, wrote", "Jones, 30 Cal. App",
    ];
    check("…never a name before a bare number, a date, a docket or this case's own record",
      NOT.map((t) => spans(t)), NOT.map(() => []));
    // FOUND FROM THE TAIL: linear in the text, a jurat's capitals, a run of
    // near-miss tails (", 30 days", "Jones, at times"), and a brief dense with
    // short cites all read in step with their length.
    const UNIT = "I JOHN ANDREW FORSYTHE DECLARE, 30 DAYS AS FOLLOWS. Jones, at times, said so. "
      + "(Rasho, 30 Cal.App.5th at p. 5.) Quillmark, 12 March 2020, Vance, 31 Cal. App. 4th, 9; See Ruiz, at p. 4. ";
    const ms = (t) => { const from = Date.now(); citedNameSpans(t); return Date.now() - from; };
    const a = ms(UNIT.repeat(300)), b = ms(UNIT.repeat(1200));
    check(`…and read in step with the text (${a} ms then ${b} ms for four times as much)`, b < Math.max(60, a * 12), true);
    check("…a long export of them is not seconds", ms(UNIT.repeat(4800)) < 3000, true);
    check("…and each short cite in it is found", citedNameSpans(UNIT.repeat(10)).length, 30);
  }
  // WHAT PDF-LINKER KEEPS, read the way it reads it (`_PN_CITE_SHAPE_RE`, its
  // parser's one-party leads, `_flex_ws_reporter`), measured sample by sample
  // against pdf_linker.py: every name below it leaves verbatim, and a name the
  // reader did not spare was marked and saved as its pseudonym.
  {
    const KEPT = [
      ["As held in In re Marriage of Hartwell (2008) 167 Cal.App.4th 562, the court may.", "Hartwell"],
      ["See Estate of Bowles (2008) 169 Cal.App.4th 684, 690.", "Bowles"],
      ["In Conservatorship of Wendland (2001) 26 Cal.4th 519, the court held.", "Wendland"],
      ["In the Matter of the Estate of Bowen (1990) 1 Cal.App.4th 1 controls.", "Bowen"],
      ["Adoption of Kelsey S. (1992) 1 Cal.4th 816.", "Kelsey"],
      ["In re Ferrand, 9 Cal. 4th 1 (1994).", "Ferrand"],
      ["Rasho v. Superior Court (Quillmark) (2019) 30 Cal.App.5th 1 is on point.", "Rasho"],
      ["Rasho v. Superior Court (Quillmark) (2019) 30 Cal.App.5th 1 is on point.", "Quillmark"],
      ["Rasho v. Quillmark, 30 Cal. App. 5th 1 (2019), is on point.", "Rasho"],
      ["Rasho v. Quillmark, 500 F. Supp. 2d 100 (N.D. Cal. 2007), is on point.", "Rasho"],
      ["Rasho v. Quillmark, 123 S. Ct. 456 (2003), is on point.", "Rasho"],
      ["Rasho v. Quillmark, 36 Mass. App. Ct. 162 (1994).", "Rasho"],
      ["As held in Rasho v.\n12  Quillmark (2019) 30 Cal.App.5th 1, the rule.", "Quillmark"],
      ["Cf. Rasho v. Quillmark (2019) 30 Cal.App.5th 1.", "Rasho"],
      ["…71 Cal.App.5th 358, 373-374; Krongos v. Pacific Gas & Electric Co.", "Krongos"],
    ];
    check("a matter named without a v., a writ's real party, a spaced or federal reporter, a wrapped or strung cite: spared",
      KEPT.map(([t, w]) => at(t, w)), KEPT.map(() => true));
    // …and the name ONLY: what closes the sentence before it is this case's.
    check("a party closing the sentence before the cite is no part of it, with a signal or without",
      [at("The motion was served on Helen Rasho. See Jones v. Smith (2019) 30 Cal.App.5th 1.", "Helen Rasho"),
        at("The motion was served on Helen Rasho. Jones v. Smith (2019) 30 Cal.App.5th 1.", "Helen Rasho"),
        at("The motion was served on Helen Rasho. See Jones v. Smith (2019) 30 Cal.App.5th 1.", "Jones")], [false, false, true]);
    check("a lead with no citation after it is no cite",
      [spans("In re Marriage of Wrenfield, Los Angeles Superior Court Case No. BD123456, was filed."), spans("in re-filing the motion"), spans("The Estate of Bowles holds the house.")], [[], [], []]);
    // A CITE ACROSS A PAGE BREAK: the name closes one page, its year opens the
    // next (PDF-Linker reads 240 characters past the seam).
    const P1 = "  27  As held in Rasho v. Quillmark", P2 = "  1  (2019) 30 Cal.App.5th 1, the rule stands.";
    check("a cite whose year is on the next page: spared with the next page's head, not without it",
      [insideSpans(citedNameSpans(P1, { next: P2 }), P1.indexOf("Rasho"), P1.indexOf("Rasho") + 5), insideSpans(citedNameSpans(P1), P1.indexOf("Rasho"), P1.indexOf("Rasho") + 5)], [true, false]);
    check("…and nothing of the next page comes back as a span", citedNameSpans("Plain words.", { next: "Rasho v. Quillmark (2019) 30 Cal.App.5th 1" }), []);
    // THIS CASE'S OWN CAPTION recited with a year is no decision: both sides
    // mostly the case's own party words (the key's template and --term rows).
    const own = ownPartyWordsOf(["Tobias Wrenfield", "Quarrow Motors, Inc."]);
    const CAP = "In this action, Wrenfield v. Quarrow Motors, Inc. (2025), the plaintiff sued.";
    check("the case's own caption with a year: not spared; one side alone the case's: spared",
      [insideSpans(citedNameSpans(CAP, { own }), CAP.indexOf("Wrenfield"), CAP.indexOf("Wrenfield") + 9),
        insideSpans(citedNameSpans("Wrenfield v. Gelman (2019) 30 Cal.App.5th 1.", { own }), 0, 9),
        insideSpans(citedNameSpans(CAP), CAP.indexOf("Wrenfield"), CAP.indexOf("Wrenfield") + 9)], [false, true, true]);
    setOwnPartyWords(own);
    check("…the words set for the case are the default", insideSpans(citedNameSpans(CAP), CAP.indexOf("Wrenfield"), CAP.indexOf("Wrenfield") + 9), false);
    setOwnPartyWords(null);
    // Still linear on a jurat's capitals and a brief dense with leads.
    const UNIT = "I JOHN ANDREW FORSYTHE DECLARE IN RE THE ESTATE OF THE MATTER OF ADOPTION OF ALL "
      + "In re Marriage of Hartwell (2008) 167 Cal.App.4th 562; Estate of Bowles, the Estate of Bowles, In the Matter of Doe. ";
    const ms = (t) => { const from = Date.now(); citedNameSpans(t); return Date.now() - from; };
    const a = ms(UNIT.repeat(300)), b = ms(UNIT.repeat(1200));
    check(`…and the leads read in step with the text (${a} ms then ${b} ms for four times as much)`, b < Math.max(80, a * 12), true);
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
  // CTRL+Z PUTS THE MARK BACK. An undo now restores the text a page is
  // measured against and the typing's flags with its text (the reader's
  // restoreTyping), so a mark the put-back took out, brought back by Ctrl+Z on
  // that step, would be typed and in an edited place — and put back again at
  // the next pause. The put-back's own step marks what it took out
  // `data-left`, the operator's, and it is passed over however it reads.
  const leftMark = E("SPAN", { "data-fake": "Strangeways", "data-real": "Rasho", "data-left": "1" }, [T("Rasho")]);
  const lbody = page([[g("1   "), T("See "), leftMark, T(" v. Quillmark (2017) 13 Cal.App.5th 1152.")]]);
  check("a mark Ctrl+Z took back from a put-back stays, though its place was typed",
    typedPseudonymsCited(serializeMapped(lbody), "1   See"), []);

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

  // ESC IS KEPT FOR EVERY NAME IT WAS PRESSED ON. A citation the reader
  // does not read as one — this was a short cite with no "supra" ("(Rasho,
  // 30 Cal.App.5th at p. 5.)") until citedNameSpans read it, below — has the
  // save write a name typed there unless Esc left it: one Esc used to be
  // remembered, the last, and the first of two such cites went to the file as
  // "(Strangeways, 30 …)", a renamed authority. Each Esc'd name is taken out
  // of the typed set where it stands exactly; a longer name ending at the same
  // place is not the Esc'd one.
  const two = " 1  Nothing. (Rasho, 30 slip op. 5.)\n 2  End. (Rasho, 31 slip op. 9.)";
  const twoBuilt = " 1  Nothing.\n 2  End.";
  const twoTyped = typedSpans(findRealSpans(sreals, two, { layout: two }), two, twoBuilt);
  const at1 = two.indexOf("Rasho"), at2 = two.lastIndexOf("Rasho");
  check("both short cites' names are typed", twoTyped.map((h) => two.slice(h.start, h.end)), ["Rasho", "Rasho"]);
  check("withoutEscaped: each Esc'd name is left out where it stands — both of two",
    withoutEscaped(twoTyped, [[at1, at1 + 5], [at2, at2 + 5]]), []);
  check("…and only that one where one was Esc'd",
    withoutEscaped(twoTyped, [[at2, at2 + 5]]).map((h) => h.start), [at1]);
  const longer = " 1  Served on Helen Rasho.";
  const longerTyped = typedSpans(findRealSpans(sreals, longer, { layout: longer }), longer, " 1  Served on.");
  const rs = longer.indexOf("Rasho");
  check("…a longer name ending where an Esc'd one ended is not the Esc'd one",
    withoutEscaped(longerTyped, [[rs, rs + 5]]).map((h) => longer.slice(h.start, h.end)), ["Helen Rasho"]);
  check("…nor is a name wrapped over a line, piece for piece",
    withoutEscaped([{ start: 4, end: 20, ranges: [[4, 9], [15, 20]] }], [[4, 9]]).length, 1);
  check("…and with nothing Esc'd, the typed set as it was", [withoutEscaped(twoTyped, []).length, withoutEscaped(twoTyped, null).length], [2, 2]);
  // …and found again, where the page moved its nodes, by WHAT MOVED IT and
  // nowhere else (escapedPlace). The text an edit left alone — the head and
  // the tail the page's text before and after share — carries the name to
  // its place now; where the edit reached it, the answer is the occurrences
  // in the text the edit wrote, never one anywhere else on the page. It was
  // the nearest occurrence anywhere, with no limit, and a short cite's
  // "Jones" deleted with its line waited for the "Jones" typed on line 1 a
  // minute later as this case's party, which went into the file as itself.
  const cite = " 1  Plaintiff filed.\n 2  Nothing. (Rasho, 30 Cal.App.5th at p. 5.)\n 3  The end.";
  const at = cite.indexOf("Rasho");
  const typedAbove = cite.replace("filed.", "filed. Also, ");
  check("escapedPlace: text typed before it moves it by its length",
    escapedPlace(cite, typedAbove, "Rasho", at, null), { at: typedAbove.indexOf("Rasho") });
  const typedAfter = cite.replace("The end.", "The end. More.");
  check("…text written after it leaves it where it was", escapedPlace(cite, typedAfter, "Rasho", at, null), { at });
  check("…as does a page that has not changed (cells laid again: the nodes went, the text did not)", escapedPlace(cite, cite, "Rasho", at, null), { at });
  const lineGone = cite.replace("Nothing. (Rasho, 30 Cal.App.5th at p. 5.)", "");
  check("…deleted with its line: no place, and nothing written to take for it",
    escapedPlace(cite, lineGone, "Rasho", at, null), { at: -1, within: [] });
  // …which is why the reader asks it of each edit as it is made (the input
  // event): measured across the deletion AND a "Rasho" typed on line 1 after
  // it, the text written runs from the one to the other and takes it in.
  const retypedFar = lineGone.replace("filed.", "filed. Rasho was served.");
  check("…measured across two edits, the text written spans both (the reader settles each edit as it is made)",
    escapedPlace(cite, retypedFar, "Rasho", at, null).within, [retypedFar.indexOf("Rasho")]);
  const elsewhere = " 1  Rasho filed.\n 2  Nothing. (Rasho, 30 Cal.App.5th at p. 5.)\n 3  Rasho agrees.";
  const elsewhereGone = elsewhere.replace("Nothing. (Rasho, 30 Cal.App.5th at p. 5.)", "Nothing.");
  check("…never an occurrence the edit did not write, however near",
    escapedPlace(elsewhere, elsewhereGone, "Rasho", elsewhere.indexOf("(Rasho") + 1, null), { at: -1, within: [] });
  const glued = cite.replace("(Rasho", "(XRasho");
  check("…a letter glued to it is the edit reaching it, and no whole word of it there",
    escapedPlace(cite, glued, "Rasho", at, null), { at: -1, within: [] });
  const typedOver = cite.replace("(Rasho", "(Vance");
  check("…nor where its letters were typed over", escapedPlace(cite, typedOver, "Rasho", at, null), { at: -1, within: [] });
  // A move the reader could not follow by its node: the occurrences in the
  // text it moved, every one, the places of other Esc'd names left out.
  const cascaded = " 1  Plaintiff filed.\n 2  \n 3  Nothing. (Rasho, 30 Cal.App.5th at p. 5.)\n 4  The end.";
  check("…a line cascade: the occurrence in the text it moved",
    escapedPlace(cite, cascaded, "Rasho", at, null), { at: -1, within: [cascaded.indexOf("Rasho")] });
  const twoBefore = " 1  Plaintiff filed.\n 2  Nothing. (Rasho, 30 Cal.App.5th at p. 5.) Rasho agrees. Rashomon.\n 3  The end.";
  const twoMoved = " 1  Plaintiff filed.\n 2  \n 3  Nothing. (Rasho, 30 Cal.App.5th at p. 5.) Rasho agrees. Rashomon.\n 4  The end.";
  const tAt = twoBefore.indexOf("Rasho");
  check("…whole words only, leaving out a place another Esc'd name holds",
    [escapedPlace(twoBefore, twoMoved, "Rasho", tAt, null).within, escapedPlace(twoBefore, twoMoved, "Rasho", tAt, new Set([twoMoved.indexOf("Rasho")])).within],
    [[twoMoved.indexOf("Rasho"), twoMoved.indexOf("Rasho agrees")], [twoMoved.indexOf("Rasho agrees")]]);
  check("…and nothing for no name or no place", [escapedPlace(cite, cascaded, "", at, null), escapedPlace(cite, cascaded, "Rasho", -1, null)], [{ at: -1, within: [] }, { at: -1, within: [] }]);
  // …and where the edit SLIDES — the text it took repeats what stands beside
  // the name, so it could have been taken from either side of it — the two
  // ways of telling it disagree about whether it reached the name. Told head
  // first only, a deletion from "(Rasho, 30 …)" through to just before
  // "(Rasho, 31 …)" reached the second, and the reader dropped its Esc: the
  // save wrote "(Strangeways, 31 …)" under a plain "Saved". It is UNSURE now,
  // left as typed and warned, never dropped.
  const twoLines = "Plaintiff filed.\nNothing. (Rasho, 30 slip op. 5.)\nEnd. (Rasho, 31 slip op. 9.)\nSigned.";
  const second = twoLines.lastIndexOf("Rasho");
  const firstGone = twoLines.replace("(Rasho, 30 slip op. 5.)\nEnd. ", "");
  check("escapedPlace: a deletion that slides over the name — unsure, at the place either telling puts it",
    escapedPlace(twoLines, firstGone, "Rasho", second, null), { at: -1, within: [firstGone.indexOf("Rasho")], unsure: true });
  const judge = "Plaintiff filed.\nNothing else (Judge so held).\nThe end. (Jones, slip op. 5.)\nSigned.";
  const judgeGone = judge.replace("(Judge so held).\nThe end. ", "");
  check("…a deletion whose text begins as the name's does", escapedPlace(judge, judgeGone, "Jones", judge.indexOf("Jones"), null),
    { at: -1, within: [judgeGone.indexOf("Jones")], unsure: true });
  const notSlid = judge.replace("so held).\nThe end. ", "");
  check("…and one that does not slide is followed as before", escapedPlace(judge, notSlid, "Jones", judge.indexOf("Jones"), null), { at: notSlid.indexOf("Jones") });
  // editedSpans, the measure of what was TYPED, slides a deletion's point to
  // a place that splits no word: told head first, the point fell inside a
  // name the file already carried, and the save took it for typed and wrote
  // its pseudonym over it.
  const base = "Plaintiff filed.\nThat was error (Judge Whitaker erred).\n(Jones agreed.)\nSigned.";
  const baseNow = base.replace("(Judge Whitaker erred).\n", "");
  const bj = baseNow.indexOf("Jones");
  check("editedSpans: a deletion that slides is placed where it splits no word", spanEdited(editedSpans(base, baseNow), bj, bj + 5), false);
  const inLine = " 1  Nothing.\n 2  That was error (Judge said) (Jones said).\n 3  x";
  const inLineNow = inLine.replace("(Judge said) ", "");
  const ij = inLineNow.indexOf("Jones");
  check("…inside a changed line too", spanEdited(editedSpans(inLine, inLineNow), ij, ij + 5), false);
  check("…and a deletion inside a name still reaches it",
    spanEdited(editedSpans("Served on Jonnes here.", "Served on Jones here."), 10, 15), true);
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

  // …and what is held is the half that fails the dangerous way. A run spends
  // New Real Values.txt, so after a run every list was "differs" and its
  // flags were held with its keeps: names flagged as standing in the clear
  // lost their red mark and were handed to no run again. A flag read into the
  // wrong case only fakes one more name; a keep takes the mark off one.
  const OLD = { values: ["Ada Pemberton", "Bram Ellery"], keeps: [{ control: "no", value: "Riverside" }], phrases: ["Bram Ellery", "Cora Whitlow"],
    noOcr: [{ doc: "Brief.txt", page: 2 }], ocrAgain: [], textFixed: [] };
  const E = { values: [], keeps: [], phrases: [], noOcr: [], ocrAgain: [], textFixed: [] };
  check("one folder of the name known, the file not what was written: the flags and their phrases move, the keeps and page lines are held",
    ["differs", "unwritten"].map((h) => legacyListSplit(OLD, h)),
    [0, 1].map(() => ({ move: { ...E, values: ["Ada Pemberton", "Bram Ellery"], phrases: ["Bram Ellery"] },
      held: { ...E, keeps: [{ control: "no", value: "Riverside" }], noOcr: [{ doc: "Brief.txt", page: 2 }] } })));
  check("…last written here, all of it moves; two of the name, or a Text Files folder's, all of it is held",
    [legacyListSplit(OLD, ""), legacyListSplit(OLD, "named"), legacyListSplit(OLD, "text")],
    [{ move: OLD, held: null }, { move: null, held: OLD }, { move: null, held: OLD }]);
  check("…and a half with nothing in it is none",
    [legacyListSplit({ values: ["Ada Pemberton"] }, "differs").held, legacyListSplit({ keeps: [{ control: "no", value: "X" }] }, "differs").move, legacyListSplit(null, "")],
    [null, null, { move: null, held: null }]);

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
// A caption's `)` side: a column of `)`s down three lines or more, drawn as the box's side.
{
  const cap = [
    " 9",
    "10  TOBIAS WRENFIELD, an individual,  )  Case No. 23STCV01234",
    "11                                    )",
    "12            Plaintiff,              )  NOTICE OF MOTION (Hon. Dana Whitaker)",
    "13       vs.                           )",
    "14  QUARROW MOTORS, INC.,             )  Dept.: 15",
    "15  __________________________________)",
    "16  DANA WHITAKER (SBN 123456)",
  ];
  const got = captionParens(cap);
  check("caption parens: one side down the caption, the slipped row on it", got.map((x) => x && x.at),
    [null, 38, 38, 38, 39, 38, 38, null]);
  check("…every row on the first's column", [...new Set(got.filter(Boolean).map((x) => x.col))], [38]);
  check("…the underscore row is the foot", got.map((x) => !!(x && x.under)), [false, false, false, false, false, false, true, false]);
  check("…a parenthetical is not a side", captionParens(["(SBN 1)", "Dept. 15 (Hon. X)", "x (y) z"]), [null, null, null]);
  check("…two lines are not a caption", captionParens(["a   )  b", "c   )  d", "e"]), [null, null, null]);
  check("…a line without one ends the side", captionParens(["a   )", "b   )", "c", "d   )", "e   )", "f   )"]).map((x) => x && x.at), [null, null, null, 4, 4, 4]);
}
// A caption's two columns edited apart (captionEdit): an edit in one never moves the other.
{
  const cap = [
    "PARTY ONE, an individual,     )  Case No. 1",
    "          Plaintiff,          )  COMPLAINT FOR:",
    "     vs.                      )  1. Fraud",
    "PARTY TWO,                    )",
    "          Defendant.          )",
    "______________________________)",
    "The body of the complaint runs this wide across the page, and further.",
  ];
  const sides = captionParens(cap);
  const left = (r) => r.lines.slice(0, -1).filter((l) => l.includes(")") && !/^_+\)/.test(l)).map((l) => l.slice(0, l.lastIndexOf(")")).trim());
  const right = (r) => r.lines.slice(0, -1).filter((l) => l.includes(")")).map((l) => l.slice(l.lastIndexOf(")") + 1).trim());
  const at = (r) => [...new Set(r.lines.filter((l) => / \)|_\)/.test(l)).map((l) => l.lastIndexOf(")")))];
  const same = { lines: cap };
  let r = captionEdit(cap, sides, 2, { line: 2, col: cap[2].indexOf("1.") }, { op: "enter" });
  check("caption edit: Enter in the title moves that column alone down, into its first empty row", [right(r), left(r), at(r)],
    [["Case No. 1", "COMPLAINT FOR:", "", "1. Fraud", "", ""], left(same), [30]]);
  check("…the caret at the head of what went down", r.caret, { line: 3, col: 33, cell: 1 });
  r = captionEdit(cap, sides, 0, { line: 0, col: cap[0].indexOf("an ind") }, { op: "enter" });
  check("…Enter among the parties: the parties' column moves down as far as its first empty row", [left(r), right(r)],
    [["PARTY ONE,", "an individual,", "Plaintiff,", "vs.", "PARTY TWO,", "Defendant."], right(same).concat("")]);
  check("…a row added above the foot when the column has none empty", r.lines.length, cap.length + 1);
  r = captionEdit(cap, sides, 1, { line: 1, col: cap[1].indexOf("Plaintiff") }, { op: "backspace" });
  check("…Backspace at an indented party: one space of the indent off, the row where it was", r.lines[1], "         Plaintiff,           )  COMPLAINT FOR:");
  r = captionEdit(cap, sides, 3, { line: 3, col: 0 }, { op: "backspace" });
  check("…at an unindented party's head: joined to the row above in its column, the column below up a row", [left(r), right(r)],
    [["PARTY ONE, an individual,", "Plaintiff,", "vs. PARTY TWO,", "Defendant.", ""], right(same)]);
  r = captionEdit(cap, sides, 1, { line: 1, col: 31 }, { op: "backspace" });
  check("…Backspace just past the side, before a title's spaces: the title joined up, the `)` kept", [right(r), r.lines[1]],
    [["Case No. 1 COMPLAINT FOR:", "1. Fraud", "", "", "", ""], "          Plaintiff,          )  1. Fraud"]);
  check("…in the middle of a cell: the browser's own", captionEdit(cap, sides, 0, { line: 0, col: 3 }, { op: "backspace" }), null);
  check("…at the head of the column's first row: nothing", captionEdit(cap, sides, 0, { line: 0, col: cap[0].indexOf("Case") }, { op: "backspace" }).lines, cap);
  r = captionEdit(cap, sides, 1, { line: 1, col: cap[1].length }, { op: "delete" });
  check("…Delete at a title's end: the column's next row joined up", right(r), ["Case No. 1", "COMPLAINT FOR: 1. Fraud", "", "", "", ""]);
  check("…Enter on the foot's underscores: nothing", captionEdit(cap, sides, 5, { line: 5, col: 4 }, { op: "enter" }).lines, cap);
  const typed = cap.slice();
  typed[3] = "PARTY TWO, a California corporation    )";
  const s2 = sides.slice();
  s2[3] = { ...s2[3], at: typed[3].indexOf(")") };
  r = captionEdit(typed, s2, 3, { line: 3, col: 35 }, {});
  check("…typed past the side: the last word wraps down the parties, the side back on its column", [left(r), at(r), right(r)],
    [["PARTY ONE, an individual,", "Plaintiff,", "vs.", "PARTY TWO, a California", "corporation", "Defendant."], [30], right(same).concat("")]);
  check("…the caret after what was typed, on the row it went to", r.caret, { line: 4, col: 11, cell: 0 });
  const num = [" 4  A,         )  Case No. 1", " 5             )", " 6  B,         )  Title", " 7  ___________)", " 8", " 9  Body text."];
  r = captionEdit(num, captionParens(num), 2, { line: 2, col: 4 }, { op: "enter", numbered: true });
  check("…on pleading paper a row needed is the empty numbered line under the caption, the foot moved down onto it",
    r.lines, [" 4  A,         )  Case No. 1", " 5             )", " 6             )  Title", " 7  B,         )", " 8  ___________)", " 9  Body text."]);
  const nt = num.slice();
  nt[1] = " 5             X)";
  const s3 = captionParens(num);
  s3[1] = { ...s3[1], at: 16 };
  check("…typed into a party row that held nothing: what is typed opens the cell", captionEdit(nt, s3, 1, { line: 1, col: 16 }, { numbered: true, typedEmpty: true }).lines[1], " 5  X          )");
}
// The Re-run button: the folder token PDF-Linker's launcher records
// (`_launcher_folder_line`), the link it answers, and the request file.
{
  const tok = "QzpcQ2FzZXNcT2thZm9yIHYuIFBlbWJlcmx5";
  const bat = "@echo off\r\nREM PDF-Linker re-run - double-click\r\nREM Folder, for the text reader's Re-run button: " + tok + "\r\nset \"PDFLINKER_PY=x\"\r\n";
  check("launcher folder token (.bat)", launcherFolderToken(bat), tok);
  check("…(.command)", launcherFolderToken("#!/bin/sh\n# Folder, for the text reader's Re-run button: " + tok + "\nnohup x &\n"), tok);
  check("…an older launcher records none", launcherFolderToken("@echo off\r\nREM PDF-Linker re-run\r\n"), "");
  check("…a command line is not the tag", launcherFolderToken("echo Folder, for the text reader's Re-run button: " + tok), "");
  check("…it decodes to the path", Buffer.from(tok, "base64url").toString("utf8"), "C:\\Cases\\Okafor v. Pemberly");
  check("rerun link", rerunUrl(tok, "Okafor v. Pemberly", "0f8a2c4e-1b3d-4a5f-9e7c-6d2b8a1c3e5f"),
    "pdf-linker://run?f=" + tok + "&d=Okafor%20v.%20Pemberly&n=0f8a2c4e-1b3d-4a5f-9e7c-6d2b8a1c3e5f");
  check("run request", JSON.parse(runRequestText("abc", "go")), { nonce: "abc", state: "go" });
  check("its names", [RUN_REQUEST_FILE, LAUNCHER_STEMS], ["PDF-Linker Run Request.json", ["Re-run PDF-Linker", "Run PDF-Linker"]]);
}
// My-Macros' Markdown export: opened as a lone file, never a document of the folder.
check("markdown by name", ["Draft Order.md", "Draft.MARKDOWN", "Brief.txt", "notes.md.txt"].map(isMarkdownName), [true, true, false, false]);
check("…not an export", isExportName("Draft Order.md"), false);
check("…its label without the extension", ["Draft Order.md", "Draft.markdown", "Brief.txt.LEAK", "Reply.txt"].map(docLabel), ["Draft Order", "Draft", "Brief", "Reply"]);
{
  const md = "# TENTATIVE RULING\r\n\r\n**Plaintiff Quill Rasho** moves to compel.\r\n\r\n- item one\r\n1. item two\r\n";
  const p = parseExport(md);
  check("…read as one page with no header", [p.pages.length, p.pages[0].header, p.pages[0].lines[0]], [1, null, "# TENTATIVE RULING"]);
  check("…and written back byte for byte", serializeExport(p), md);
}
check("key name", [isKeyName("pseudonym_key.xlsx"), isKeyName("pseudonym_key (1).xlsx"), isKeyName("Order 2024.xlsx")], [true, true, false]);
// …never PDF-Linker's temporary copy, left beside the key by a save that crashed,
// and the key itself before a copy of it a folder lists first.
check("…not the temporary copy a save leaves", isKeyName("pseudonym_key.tmp.xlsx"), false);
check("…the key itself first", [KEY_FILE, keyRank("pseudonym_key.xlsx"), keyRank("Pseudonym_Key.xlsx"), keyRank("pseudonym_key (1).xlsx"), keyRank("pseudonym_key - Copy.xlsx")],
  ["pseudonym_key.xlsx", 0, 0, 1, 1]);

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

// ---- a form's checkboxes are one piece ----------------------------------------
// PDF-Linker writes a checkbox as "[   ]", "[ X ]" or "[ ? ]" ("[ ]", "[X]",
// "[?]" before those). The empty one's three spaces are COLUMN_GAP, so the
// columns cut inside it: a "[" at the end of one cell, "] Plaintiff" at the
// head of the next. A mark is one thing, never cut, and wherever the columns
// are worked out from (columnBands reads the same cuts) it begins nothing.
console.log("checkboxes are one piece");
{
  check("the six spellings, each with its state",
    checkboxRanges("a [   ] b [ X ] c [ ? ] d [ ] e [X] f [?]"),
    [[2, 7, ""], [10, 15, "x"], [18, 23, "?"], [26, 29, ""], [32, 35, "x"], [38, 41, "?"]]);
  check("\u2026and nothing else in brackets", checkboxRanges("[  ] [x] [XX] [ X] [Exhibit A] [sic]"), []);
  check("a mark's state, or null for what is not one whole mark",
    ["[   ]", "[ X ]", "[ ? ]", "[ ]", "[X]", "[?]", "[  ]", "[ X ] "].map(checkboxState), ["", "x", "?", "", "x", "?", null, null]);
  // A signature block's line, with the space PDF-Linker leaves inside a box.
  const sig = "(TYPE OR PRINT NAME OF  [   ] ATTORNEY    [   ] PARTY WITHOUT ATTORNEY)" + " ".repeat(36) + "(SIGNATURE)";
  const cuts = columnCuts(sig);
  check("no cut falls inside an empty box", cuts.every((c) => !checkboxRanges(sig).some(([a, b]) => c > a && c < b)), true);
  check("\u2026the line is cut before each box and its label, and at the signature",
    cuts.map((c) => sig.slice(c, c + 14)), ["[   ] PARTY WI", "(SIGNATURE)"]);
  const party = "or of specified cross-complaints only, so state and identify the parties, causes of    [   ] Plaintiff/Petitioner [   ] Defendant/Respondent";
  check("a box after a single space is no cut, and the box before it is not broken either",
    columnCuts(party).map((c) => party.slice(c, c + 8)), ["[   ] Pl"]);
  check("the older spellings hold no gap, and an atom given beside them still counts (the gap after a box is a gap)",
    [columnCuts("a. [ ]    Complaint   [X]  Petition"), columnCuts("Plaintiff Pat    Doe     [ ]   x", { atoms: [[10, 20]] })], [[10, 22], [25, 31]]);
  // Eight lines of checkbox items, the boxes in one column: an empty box's
  // spaces end at its "]", and counted as a gap every "]" began a column of
  // its own \u2014 a second column the lines around it were then cut at.
  const items = ["a.", "b.", "c.", "d.", "e.", "f.", "g.", "h."].map((l, i) => ({ text: `    ${l}   [   ] item number ${i + 1} of the list` }));
  const bands = columnBands(items);
  check("a column of boxes: no column begins at their closing brackets",
    bands.every((b) => ![...b.stops.keys()].includes(14)), true);
  check("\u2026and the box column itself is where the lines begin after the item letter", [...bands[3].stops.keys()].includes(9), true);
}
// The box is a span with no data-fake, like the rule spans: it serializes as
// its characters.
{
  const T = (s) => ({ nodeType: 3, data: s });
  const E = (name, kids, attrs) => ({ nodeType: 1, nodeName: name, childNodes: kids, getAttribute: (k) => (attrs && k in attrs ? attrs[k] : null) });
  const line = E("DIV", [E("SPAN", [E("SPAN", [T("[ X ]")], { "data-cb": "x" }), T(" Plaintiff/Petitioner  "), E("SPAN", [T("[   ]")]), T(" Defendant")])]);
  check("a line with its boxes drawn serializes as the file's text", serializeNodes(line), "[ X ] Plaintiff/Petitioner  [   ] Defendant");
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
  // Only the authorities trailer ends a page short of the next header: a
  // ruled line the operator typed is the page's own (the shared vectors,
  // pinned in PDF-Linker's tests to the same sums).
  check("a ruled line the page carries is part of its text, as in PDF-Linker",
    [pageTextSum(["The lease was signed.", "== Exhibit A ==", "Rent: $900 — paid"]), pageTextSum(["The lease was signed.", "= = = = =", "Rent: $900 — paid"])], ["9b3e2d29", "42fcfd5c"]);
  check("pageFurnitureLine: a line shaped like PDF-Linker's own heading, above the trailer",
    [pageFurnitureLine(["Text.", "====== Page 3 ======", "More."]), pageFurnitureLine(["Text.", "== Exhibit A ==", "= = = = ="]),
      pageFurnitureLine(["Text.", "====== Authorities cited (public verification links) ======", "====== Page 3 ======"]), pageFurnitureLine([])],
    ["====== Page 3 ======", null, null, null]);
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

// ---- a document of the folder off the screen: read, counted and saved as the screen would ----
// The folder-wide Replace all and Save work on documents that are not on
// screen. What they read of one must be what the screen would read of it: the
// counts, the pages a save has to build, the spot keeps after its forward pass,
// and the standing assertion.
console.log("documents off the screen");
{
  const HEAD = ["Category", "Real Value", "Replacement", "Context", "Status", "Source", "Occurrences"];
  const kx = parseKey([{ name: "Pseudonym Key", rows: [HEAD,
    ["person", "Corwin Ashdale", "Tobias Wrenfield", "", "", "spreadsheet", 4],
    ["person-token", "Ashdale", "Wrenfield", "", "", "spreadsheet", 4],
    ["entity", "Pellmont Motors", "Quarrow Motors", "", "", "spreadsheet", 3],
  ] }], "k");
  const rev = compile(kx), reals = compileReals(kx), fwdx = compileForward(kx);
  // readExport: the function the reader used to carry, word for word.
  const oldRead = (text) => {
    const parsed = parseExport(text);
    const last = pleadingLast(parsed.pages);
    let pages = 0, numbers = 0;
    for (const p of parsed.pages) {
      if (p.header == null) continue;
      const r = restoreMarginNumbers(p.lines, { last });
      if (!r) continue;
      p.lines = r.lines; p.restored = r.added; pages++; numbers += r.added.length;
    }
    parsed.restored = { pages, numbers };
    return parsed;
  };
  const numPage = (n, skip) => [`====== Page ${n} ======`, ...Array.from({ length: 28 }, (_, k) => (k + 1 === skip ? "" : String(k + 1).padStart(2) + "  line " + (k + 1)))];
  const pleading = [...numPage(1, 5), ...numPage(2), ...numPage(3, 9), "====== Page 4 ======", "EXHIBIT A"].join("\n") + "\n";
  check("readExport gives the lines and the numbers put back that the reader's own did", readExport(pleading), oldRead(pleading));
  check("…numbers put back, and marked on the page", readExport(pleading).pages[0].restored, [5]);

  // cloneDoc
  const orig = readExport(pleading);
  const copy = cloneDoc(orig);
  copy.pages[0].lines[0] = "changed";
  copy.pages[0].restored.push(99);
  check("cloneDoc serializes the same", serializeExport(cloneDoc(orig)), serializeExport(orig));
  check("…and is a copy: the original's lines and marks do not move with it", [orig.pages[0].lines[0], orig.pages[0].restored], [" 1  line 1", [5]]);

  // shownPages: what Find and Replace read off a built page, from the text alone.
  const text = [
    "====== Page 1 ======",
    " 1  Plaintiff Tobias Wrenfield bought a vehicle from Quarrow",
    " 2  Motors on Page Street.",
    " 3",
    "====== Page 2 (printed p. 2) ======",
    "Wrenfield asks for the vehicle back.",
    "====== Authorities cited (public verification links) ======",
    "Wrenfield v. Quarrow Motors (2001) 90 Cal.App.4th 12",
  ].join("\n") + "\n";
  const d = parseExport(text);
  const real = shownPages(d, { rev, showFakes: false });
  check("shownPages: the fakes shown as the real names, the margin numbers blanked to spaces",
    real[0], "    Plaintiff Corwin Ashdale bought a vehicle from Pellmont\n    Motors on Page Street.\n  ");
  check("…a page at a time, the trailer with its page and no header in any of them",
    real[1], "Ashdale asks for the vehicle back.\n====== Authorities cited (public verification links) ======\nAshdale v. Pellmont Motors (2001) 90 Cal.App.4th 12");
  check("…with Show fakes on, the file's own face", shownPages(d, { rev, showFakes: true })[0],
    "    Plaintiff Tobias Wrenfield bought a vehicle from Quarrow\n    Motors on Page Street.\n  ");
  check("…and a pseudonym wrapped over a numbered line is read piece by piece, the number between blanked", real[0].includes("Pellmont\n    Motors"), true);
  const count = (pages, q) => pages.reduce((n, p) => { const rx = buildFindMatcher([q]); let k = 0; rx.lastIndex = 0; while (rx.exec(p)) k++; return n + k; }, 0);
  check("a query of \"Page\" counts the text's own word, never the page headers", count(real, "Page"), 1);
  check("…and a margin number is never a hit", count(real, "2"), 2);
  check("…while a pseudonym's real name is, through the key", count(real, "Ashdale"), 3);
  check("no key: the text as it is, numbers blanked", shownPages(parseExport("====== Page 1 ======\n 1  a b\n"), {})[0], "    a b");
  // A margin number straight before a pseudonym is still a number (buildBody's
  // U+0001 stand-in), and a line that opens with one is not.
  check("…a number followed straight by a pseudonym is blanked", shownPages(parseExport("====== Page 1 ======\n 4  Tobias Wrenfield\n"), { rev })[0], "    Corwin Ashdale");

  // splitFolderRows
  const docA = { name: "A" }, docB = { name: "B" }, docC = { name: "C" }, comb = { name: "Combined Text.txt", combined: true };
  const split = splitFolderRows([{ doc: comb, count: 6 }, { doc: docA, count: 2 }, { doc: docB, count: 1 }, { doc: docC, count: 3 }], (x) => x === docA || x === docB);
  check("splitFolderRows: the documents on screen out, the combined file apart", [split.rest.map((r) => r.doc.name + " " + r.count), split.combined.map((r) => r.count)], [["C 3"], [6]]);
  check("…and a combined file on screen is on screen", splitFolderRows([{ doc: comb, count: 6 }], (x) => x === comb), { rest: [], combined: [] });

  // pageScan
  const kj = parseKey([{ rows: [["Real Value", "Replacement"], ["Quillmark", "Mary Jones"], ["Jones", "Pat Doe"]] }], "k");
  const oj = { rev: compile(kj), reals: compileReals(kj) };
  const s1 = pageScan(" 1  Mary Jones signed.", oj);
  check("pageScan: a real word inside a fake is no reason to build the page, and the fake is blanked", [s1.needs, s1.scan], [false, " 1  \u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000 signed."]);
  check("…a real standing is", pageScan(" 1  Jones signed.", oj).needs, true);
  check("…and one in a cited decision too: the save's own pass decides it", pageScan("See Jones v. Smith (2001) 90 Cal.App.4th 12.", oj).needs, true);
  const s2 = pageScan("Pat signed; Jones left.", { ...oj, spots: [makeSpot(0, "Jones", 0)] });
  check("…a spot keep is blanked, and is no reason either", [s2.needs, s2.scan], [false, "Pat signed; \u0000\u0000\u0000\u0000\u0000 left."]);
  check("…but a spot running into a fake is", pageScan("Mary Jones left.", { ...oj, spots: [makeSpot(0, "Jones", 0)] }).needs, true);
  check("…the keeps masked are no reason", pageScan("Jones left.", { ...oj, mask: (t) => t.replace(/Jones/g, "\u0000\u0000\u0000\u0000\u0000") }).needs, false);
  check("…and a cited name is blanked in the scan", /Jones|Smith/.test(pageScan("Jones v. Smith (2001) 90 Cal.App.4th 12.", {}).scan), false);

  // spotsAfterSwaps: the bug the folder save would hit in every such document.
  const before = "Corwin Ashdale, then Corwin Ashdale; Corwin Ashdale kept.";
  const held = [[37, 51]]; // the third
  const places = [{ start: 0, end: 14, to: "Tobias Wrenfield" }, { start: 21, end: 35, to: "Tobias Wrenfield" }];
  let after = "", at = 0;
  for (const p of places) { after += before.slice(at, p.start) + p.to; at = p.end; }
  after += before.slice(at);
  check("spotsAfterSwaps: the third occurrence kept, the two before it faked → the first now, where it moved to",
    spotsAfterSwaps(3, before, held, places, after), [makeSpot(3, "Corwin Ashdale", 0)]);
  check("…and the kept place is still the value", after.slice(41, 55), "Corwin Ashdale");
  check("…an occurrence kept before any swap keeps its ordinal",
    spotsAfterSwaps(0, before, [[0, 14]], [{ start: 21, end: 35, to: "Tobias Wrenfield" }, { start: 37, end: 51, to: "Tobias Wrenfield" }],
      "Corwin Ashdale, then Tobias Wrenfield; Tobias Wrenfield kept."), [makeSpot(0, "Corwin Ashdale", 0)]);
  // …and what a save's forward pass gives, end to end: the spot still applies.
  const runs = forwardRuns(fwdx, blankRanges(before, held));
  const sw = []; let off = 0;
  for (const r of runs) { const len = r.t === "swap" ? r.from.length : r.s.length; if (r.t === "swap") sw.push({ start: off, end: off + len, to: r.to }); off += len; }
  let fw = "", k = 0;
  for (const s of sw) { fw += before.slice(k, s.start) + s.to; k = s.end; }
  fw += before.slice(k);
  check("…through the key's own forward pass, the spot lands on the value it kept",
    spotRanges(fw, spotsAfterSwaps(0, before, held, sw, fw)).map(([a, b]) => fw.slice(a, b)), ["Corwin Ashdale"]);

  // pageListsAfter: syncNoOcr's five rules.
  const e1 = { doc: "A.txt", pdf: "A.pdf", page: 1 };
  const pg = (lines, header = "====== Page 1 ======") => ({ header, lines, review: null });
  const none = { noOcr: [], ocrAgain: [], textFixed: [] };
  check("pageListsAfter: a page reading [DID NOT OCR] is owed", pageListsAfter(none, [{ entry: e1, page: pg([DID_NOT_OCR]) }]).noOcr.length, 1);
  check("…unless it is asked to be read again", pageListsAfter({ ...none, ocrAgain: [e1] }, [{ entry: e1, page: pg([DID_NOT_OCR]) }]).noOcr.length, 0);
  check("…a header PDF-Linker wrote as DID NOT OCR takes it off",
    pageListsAfter({ ...none, noOcr: [e1] }, [{ entry: e1, page: pg([DID_NOT_OCR], "====== Page 1 — DID NOT OCR ======") }]).noOcr.length, 0);
  check("…a page no longer reading it comes off only with drop",
    [pageListsAfter({ ...none, noOcr: [e1] }, [{ entry: e1, page: pg(["text"]) }]).noOcr.length, pageListsAfter({ ...none, noOcr: [e1] }, [{ entry: e1, page: pg(["text"]) }], { drop: true }).noOcr.length], [1, 0]);
  check("…a request to read again is done once the page reads", pageListsAfter({ ...none, ocrAgain: [e1] }, [{ entry: e1, page: pg(["text"]) }]).ocrAgain.length, 0);
  check("…and a page reading [DID NOT OCR] has no transcription", pageListsAfter({ ...none, textFixed: [{ ...e1, sum: "00000000" }] }, [{ entry: e1, page: pg([DID_NOT_OCR]) }]).textFixed.length, 0);
  const same = { noOcr: [e1], ocrAgain: [], textFixed: [] };
  check("…and the same lists where nothing moved", pageListsAfter(same, [{ entry: e1, page: pg([DID_NOT_OCR]) }]).noOcr === same.noOcr, true);

  // fixedSumsFor
  // A save moves a sum only where it wrote the page and the line was true of
  // the file it replaced, or ✎ was pressed there.
  const tf = [{ ...e1, sum: pageTextSum(["a"]) }];
  check("fixedSumsFor: a page the save wrote, its line true of the file replaced: the text as written",
    fixedSumsFor(tf, [{ entry: e1, lines: ["a", "b"], before: ["a"] }])[0].sum, pageTextSum(["a", "b"]));
  check("…a page the save did not write (an empty Ctrl+S): the line stands",
    fixedSumsFor(tf, [{ entry: e1, lines: ["Tne Iease"], before: ["Tne Iease"] }]) === tf, true);
  check("…a line a run outdated (the file replaced read otherwise): it stands, whatever is written",
    fixedSumsFor(tf, [{ entry: e1, lines: ["Tne Iease betvveen"], before: ["Tne Iease"] }]) === tf, true);
  check("…nothing known of the file replaced: it stands", fixedSumsFor(tf, [{ entry: e1, lines: ["a", "b"] }]) === tf, true);
  check("…✎ pressed since the last save: the text as written, whatever the file read",
    fixedSumsFor(tf, [{ entry: e1, lines: ["The lease"], before: ["Tne Iease"], pressed: true }])[0].sum, pageTextSum(["The lease"]));
  check("…a line with no sum takes the page the save wrote",
    fixedSumsFor([{ ...e1, sum: "" }], [{ entry: e1, lines: ["a", "b"], before: ["a"] }])[0].sum, pageTextSum(["a", "b"]));
  check("…a page with no entry is passed over", fixedSumsFor(tf, [{ entry: { ...e1, page: 2 }, lines: ["a"], before: [] }]) === tf, true);

  // readerFileHasLines: the last flag withdrawn
  const empty = formatValuesFile([], [], [], [], [], []);
  check("readerFileHasLines: the header alone has no lines", [readerFileHasLines(empty), readerFileHasLines(""), readerFileHasLines("﻿# just a note\n\n")], [false, false, false]);
  check("…and a value is one", readerFileHasLines(formatValuesFile(["Rosa"], [], [], [], [], [])), true);
  check("…and the header-only file parses to nothing", parseReaderFile(empty), { values: [], keeps: [], phrases: [], noOcr: [], ocrAgain: [], textFixed: [] });

  // realsLeftInExport: the standing assertion
  const plain = "Tobias Wrenfield signed. See Ashdale v. Smith (2001) 90 Cal.App.4th 12.";
  const heldText = blankRanges(plain, [[0, 16]]);
  check("realsLeftInExport: a fake blanked gives nothing, a cited party nothing", realsLeftInExport(plain, heldText, { reals }), []);
  const leak = "Corwin Ashdale signed.";
  check("…a real standing gives that real", realsLeftInExport(leak, leak, { reals }).map((w) => w.real), ["Corwin Ashdale"]);
  check("…and the case-wide keeps are masked", realsLeftInExport(leak, leak, { reals, mask: (t) => t.replace("Corwin Ashdale", "\u0000".repeat(14)) }), []);
  check("…no key, no assertion", realsLeftInExport(leak, leak, {}), []);
  // The page headers and banners are PDF-Linker's, copied through: a NOTE
  // saying "the operator's transcription" is no "Operator" standing in a page.
  {
    const opKey = { pairs: [{ real: "Operator", fake: "Ventor" }], warn: [{ real: "Operator", fake: "Ventor" }] };
    const op = compileReals(opKey);
    const noted = "====== Page 1 ======\nThe request.\n====== Page 2 — NOTE: TEXT CORRECTED by hand in the text reader; this page's text layer is the operator's transcription ======\nExhibit A.\n";
    check("realsLeftInExport: a page header's NOTE is not read", realsLeftInExport(noted, noted, { reals: op }), []);
    const crlf = noted.replace(/\n/g, "\r\n");
    check("…nor under CRLF", realsLeftInExport(crlf, crlf, { reals: op }), []);
    const banner = "#### DOCUMENT 1 OF 2 IN THIS COMBINED FILE: Operator Report.txt ####\nThe request.\n";
    check("…nor a combined file's banner", realsLeftInExport(banner, banner, { reals: op }), []);
    const inPage = noted.replace("Exhibit A.", "The Operator signed.");
    check("…but the same name in the page's text still is", realsLeftInExport(inPage, inPage, { reals: op }).map((w) => w.real), ["Operator"]);
    const two = compileReals({ pairs: [{ real: "Night Operator", fake: "Day Ventor" }], warn: [{ real: "Night Operator", fake: "Day Ventor" }] });
    const across = "====== Page 1 ======\nSigned by the Night\n====== Page 2 ======\nOperator and others.\n";
    check("…and a name is not read across the header between two pages", realsLeftInExport(across, across, { reals: two }), []);
  }
}

// ── what PDF-Linker has spent ─────────────────────────────────────────────────
//
// PDF-Linker consumes New Real Values.txt: a keep line it applied goes onto the
// master workbook's KEEP sheet and out of the file (the file is deleted once
// nothing is left). The reader's list kept every keep of the case and wrote it
// again on the next save, which put back on the master a row the operator had
// emptied or deleted there. A keep the reader WROTE that the file no longer
// carries is spent; one still in the file (held under PDF-Linker's "#" comment
// when its master write failed, or waiting for the full re-run) is not.
console.log("what PDF-Linker has spent");
{
  const kCor = { control: "no", value: "Corwin Ashdale" };
  const kMar = { control: "never", value: "Marlow Tenbury" };
  const wrote = formatValuesFile(["Quell Harbor"], [kCor, kMar], [], [], [], []);
  check("keepLines: every keep line, its control lower case, its value folded to one line",
    keepLines("# a note\nNO:  Corwin   Ashdale \nQuell Harbor\nnever: Marlow Tenbury\nno: corwin ashdale\n"),
    [{ control: "no", value: "Corwin Ashdale" }, { control: "never", value: "Marlow Tenbury" }, { control: "no", value: "corwin ashdale" }]);
  check("…a page line and a value are not keeps", keepLines("did not ocr: A.pdf | page 2\nRosa Delgado\nphrase: Cross River Bank\n"), []);
  check("carriesKeep: with a control, that control only", [carriesKeep(wrote, "corwin ashdale", "no"), carriesKeep(wrote, "Corwin Ashdale", "never")], [true, false]);
  check("…without one, either", [carriesKeep(wrote, "MARLOW TENBURY"), carriesKeep(wrote, "Quell Harbor"), carriesKeep(null, "x")], [true, false, false]);

  // The file consumed whole: PDF-Linker deleted it.
  const gone = spendLines({ keeps: [kCor, kMar], textFixed: [] }, wrote, null);
  check("a keep written and gone from the folder (the file deleted) is spent", gone.spentKeeps.map((k) => k.value), ["Corwin Ashdale", "Marlow Tenbury"]);
  check("…and off the list", gone.keeps, []);
  check("…and off the record of what was written, the rest of it kept",
    gone.saved.split("\n").filter((l) => l && !l.startsWith("#")), ["Quell Harbor"]);
  check("…so the list without them is in step with what the file still holds",
    formatValuesFile(["Quell Harbor"], gone.keeps, [], [], [], []), gone.saved);
  check("…and a save with a new flag hands over the flag alone, never the keeps again",
    parseReaderFile(formatValuesFile(["Quell Harbor", "Rosa Delgado"], gone.keeps, [], [], [], [])).keeps, []);

  // The file rewritten by PDF-Linker without the keep lines.
  const rewritten = "Quell Harbor\n";
  check("a keep line taken out of a file that stays is spent the same way",
    spendLines({ keeps: [kCor], textFixed: [] }, wrote, rewritten).spentKeeps.map((k) => k.value), ["Corwin Ashdale"]);

  // The master write failed: the keep stays in the file under a "#" comment.
  const held = "# 1 keep(s) applied, but not on the master KEEP sheet yet: this run could not write it (open in Excel? see pdf_linker.log). This file is their only record until a run records them there.\n\nno: Corwin Ashdale\n";
  const still = spendLines({ keeps: [kCor], textFixed: [] }, wrote, held);
  check("a keep still in the file under PDF-Linker's # comment is not spent", [still.spentKeeps, still.keeps], [[], [kCor]]);
  check("…the same list back, untouched", still.keeps === spendLines({ keeps: still.keeps }, wrote, held).keeps, true);
  check("…and still written", carriesKeep(still.saved, "Corwin Ashdale", "no"), true);
  check("a keep line on the value with another control in the file is a keep still there",
    spendLines({ keeps: [kCor], textFixed: [] }, wrote, "never: Corwin Ashdale\n").spentKeeps, []);

  check("a keep never written is a decision not yet handed over: not spent, whatever the file says",
    spendLines({ keeps: [kCor], textFixed: [] }, formatValuesFile(["Quell Harbor"], [], [], [], [], []), null).spentKeeps, []);
  check("…nor one whose control changed since (never written as never)",
    spendLines({ keeps: [{ control: "never", value: "Corwin Ashdale" }], textFixed: [] }, wrote, null).spentKeeps, []);
  check("…and its old line, gone from the file, is off the record",
    carriesKeep(spendLines({ keeps: [{ control: "never", value: "Corwin Ashdale" }], textFixed: [] }, wrote, null).saved, "Corwin Ashdale"), false);
  check("a local keep is never written and never spent",
    spendLines({ keeps: [{ control: "no", value: "Corwin Ashdale", state: "local" }], textFixed: [] }, wrote, null).spentKeeps, []);
  check("the spelling and the spacing are folded",
    spendLines({ keeps: [{ control: "no", value: "corwin  ASHDALE" }], textFixed: [] }, "no:   Corwin Ashdale\n", null).spentKeeps.length, 1);

  // A transcribed page, spent by its page and sum (what adoption always did).
  const page = { doc: "A Complaint.txt", pdf: "A Complaint.pdf", page: 2, sum: "0a1b2c3d" };
  const fixedFile = formatValuesFile([], [], [], [], [], [page]);
  check("a transcribed page written and gone is spent",
    spendLines({ keeps: [], textFixed: [page] }, fixedFile, null).spentFixed.length, 1);
  check("…one whose text changed since (another sum) is not",
    spendLines({ keeps: [], textFixed: [{ ...page, sum: "ffffffff" }] }, fixedFile, null).spentFixed.length, 0);
  check("…nor one the file still names",
    spendLines({ keeps: [], textFixed: [page] }, fixedFile, fixedFile).spentFixed.length, 0);
  check("…and its line goes off the record with it",
    spendLines({ keeps: [], textFixed: [page] }, fixedFile, null).saved.split("\n").some((l) => /^text corrected:/.test(l)), false);
  const none = { keeps: [kCor], textFixed: [page] };
  const same = spendLines(none, wrote + "text corrected: A Complaint.pdf | page 2 | sum 0a1b2c3d\n", wrote + "text corrected: A Complaint.pdf | page 2 | sum 0a1b2c3d\n");
  check("nothing spent: the same lists back", [same.keeps === none.keeps, same.textFixed === none.textFixed], [true, true]);
  check("…and the record as it was", same.saved, wrote + "text corrected: A Complaint.pdf | page 2 | sum 0a1b2c3d\n");
  check("the record keeps its header and its values; a page line the file no longer carries goes, as a keep's does",
    spendLines({ keeps: [] }, "# head\nQuell Harbor\ndid not ocr: A.pdf | page 3\nno: Corwin Ashdale\n", null).saved,
    "# head\nQuell Harbor\n");
  // A page line written here and gone from the file — applied, or SET ASIDE by
  // PDF-Linker as "# <the line>" because the PDF's pages no longer match its
  // export — comes off the list, or the next write puts it back to apply.
  {
    const n3 = { doc: "A.pdf", pdf: "", page: 3 }, n4 = { doc: "A.pdf", pdf: "", page: 4 };
    const wroteN = "did not ocr: A.pdf | page 3\nocr again: A.pdf | page 4\n";
    const asideFile = "# not applied: A.pdf now has 12 pages and its export 11 — mark the page again on the export the next full run writes\n# did not ocr: A.pdf | page 3\nocr again: A.pdf | page 4\n";
    const sp = spendLines({ keeps: [], textFixed: [], noOcr: [n3], ocrAgain: [n4] }, wroteN, asideFile);
    check("a ⊘ line set aside: off the list, and named as set aside; an OCR-again line the file still carries stays",
      [sp.noOcr, sp.ocrAgain.length, sp.setAside], [[], 1, [n3]]);
    check("…and off the record", sp.saved.split("\n").filter(Boolean), ["ocr again: A.pdf | page 4"]);
    const applied = spendLines({ keeps: [], textFixed: [], noOcr: [n3], ocrAgain: [] }, wroteN, null);
    check("…one applied (the file gone): off the list, set aside nothing", [applied.noOcr, applied.setAside], [[], []]);
    check("…one never written here stays", spendLines({ keeps: [], textFixed: [], noOcr: [n3], ocrAgain: [] }, "", null).noOcr, [n3]);
    check("setAsideLines: the page lines PDF-Linker wrote back under #", setAsideLines(asideFile), { noOcr: [n3], ocrAgain: [], textFixed: [] });
    // …and the ⊘ list does not take the page back by itself while it is held.
    const held = pageListsAfter({ noOcr: [], ocrAgain: [], textFixed: [] }, [{ entry: n3, page: { header: "====== Page 3 ======", lines: [DID_NOT_OCR] } }], { held: [n3] });
    check("pageListsAfter: a page held as set aside is not put back on the list", held.noOcr, []);
  }

  // A keep taken afresh is not the one written before.
  check("forgetKeepLines: the keep lines on the value go, whatever their control",
    forgetKeepLines("# h\nno: Corwin Ashdale\nnever: corwin ashdale\nQuell Harbor\nnever: Marlow Tenbury\n", ["CORWIN ASHDALE"]),
    "# h\nQuell Harbor\nnever: Marlow Tenbury\n");
  const fresh = forgetKeepLines(wrote, ["Corwin Ashdale"]);
  check("…so the same keep taken again is owed, not spent",
    spendLines({ keeps: [kCor], textFixed: [] }, fresh, null).spentKeeps, []);

  // The line in the open folder's file that another session wrote: noted as
  // handed over, so the list without it is owed to the file.
  const elsewhere = formatValuesFile(["Quell Harbor"], [], [], [], [], []);
  const noted = noteKeepLines(elsewhere, [{ control: "never", value: "Marlow Tenbury" }]);
  check("noteKeepLines: a line the record does not carry is put in", carriesKeep(noted, "Marlow Tenbury", "never"), true);
  check("…once", noteKeepLines(noted, [{ control: "never", value: "marlow tenbury" }]), noted);
  check("…and a bad control or no value is not", noteKeepLines(elsewhere, [{ control: "maybe", value: "X" }, { control: "no", value: " " }]), elsewhere);
  check("…so the list without it differs from what was written, which has lines: owed to the file",
    [formatValuesFile(["Quell Harbor"], [], [], [], [], []) !== noted, readerFileHasLines(noted)], [true, true]);
  check("a file of nothing but # lines is nothing PDF-Linker reads",
    [readerFileHasLines(formatValuesFile([], [], [], [], [], [])), keepLines(formatValuesFile([], [], [], [], [], []))], [false, []]);

  // The keeps WITHDRAWN (the reader's record, kept as keep lines) held to what
  // the folder's file still carries: a line the file no longer has is nothing
  // left to keep out of the list.
  const record = "no: Corwin Ashdale\nnever: Marlow Tenbury\n";
  check("keepLinesCarried: the record's lines the file still carries, same control and value",
    keepLinesCarried(record, "# held\n\nNO:  corwin   ashdale\nQuell Harbor\n"), "no: Corwin Ashdale\n");
  check("…a line on the value under another control is another keep: not the one withdrawn",
    keepLinesCarried(record, "never: Corwin Ashdale\n"), "");
  check("…no file (or nothing withdrawn) leaves nothing", [keepLinesCarried(record, null), keepLinesCarried("", wrote)], ["", ""]);
  check("…and the record as it was where the file carries all of it",
    keepLinesCarried(record, formatValuesFile([], [kCor, kMar], [], [], [], [])), record);

  // The record of what was written, rebuilt from the folder's own file where it
  // was written somewhere else (a copy of the case under the same name, a
  // download): the list's text where the file reads the same, else the file's.
  const list = formatValuesFile(["Quell Harbor"], [kCor], [], [], [], []);
  check("writtenBaseline: no file, nothing written here", writtenBaseline(list, null), "");
  check("…the file carrying the same lines (PDF-Linker's comments, another order, other spacing): the list's own text, in step",
    writtenBaseline(list, "# 1 keep(s) applied, but not on the master KEEP sheet yet\n\nno:  corwin ashdale\nQUELL HARBOR\n"), list);
  check("…the file lacking a line: the file's text, so the list reads as owed to it",
    writtenBaseline(list, "Quell Harbor\n"), "Quell Harbor\n");
  check("…and one carrying a line the list does not: the file's text too",
    writtenBaseline(list, list + "never: Marlow Tenbury\n"), list + "never: Marlow Tenbury\n");
  check("…the record then owes the list exactly what the folder lacks",
    spendLines({ keeps: [kCor], textFixed: [] }, writtenBaseline(list, null), null).spentKeeps, []);
}

// ✎ Use my text is asked without the click where a page was TYPED over in
// several words by the time a save writes it.
console.log("a page typed over is handed over by itself");
{
  check("several words, not one", AUTO_TEXT_FIXED_WORDS, 2);
  check("nothing typed", wordsChanged("The lease was signed.", "The lease was signed."), 0);
  check("a word corrected in place counts once", wordsChanged("The lease was slgned.", "The lease was signed."), 1);
  check("two words corrected", wordsChanged("Tbe lease was slgned.", "The lease was signed."), 2);
  check("a word taken out and one put right", wordsChanged("The the lease was slgned.", "The lease was signed."), 2);
  check("a word put in", wordsChanged("The lease signed.", "The lease was signed."), 1);
  check("a line moved or re-broken is no change", wordsChanged("The lease\nwas signed.", "The lease was\n  signed."), 0);
  check("two corrections far apart on a page count as two",
    wordsChanged(["Tbe lease", ...Array(50).fill("was signed in full"), "on Monday"].join("\n"),
      ["The lease", ...Array(50).fill("was signed in full"), "on Mnday"].join("\n")), 2);
  check("a whole line typed in", wordsChanged("", "Rent is due on the first."), 6);
}

// Ctrl+Z on a decision: a step holds what the decision moved and moves only
// that back, so what came in since stands.
console.log("a decision undone and made again");
{
  const st = (o) => ({ flagged: [], phrases: [], keeps: [], settled: [], rows: null, ...o });
  check("nothing moved, no step", decisionDelta(st({ flagged: ["Rosa Delgado"] }), st({ flagged: ["Rosa Delgado"] })), null);
  const flag = decisionDelta(st({ flagged: ["Rosa Delgado"] }), st({ flagged: ["Rosa Delgado", "Tamsin Kettleby"] }));
  check("a flag moves one value", [flag.flagged.add, flag.flagged.drop], [["Tamsin Kettleby"], []]);
  // A value the folder's file brought in after the flag stands through its undo.
  const later = st({ flagged: ["Rosa Delgado", "Tamsin Kettleby", "Oswin Halvorsen"] });
  const back = applyDecisionDelta(later, flag, true);
  check("undone, the flag alone comes off", back.flagged, ["Rosa Delgado", "Oswin Halvorsen"]);
  check("…and redone, it goes back on", applyDecisionDelta(back, flag, false).flagged, ["Rosa Delgado", "Oswin Halvorsen", "Tamsin Kettleby"]);
  check("the state handed in is not touched", later.flagged.length, 3);
  const off = decisionDelta(st({ flagged: ["Rosa Delgado"], phrases: ["Rosa Delgado"] }), st());
  const on = applyDecisionDelta(st(), off, true);
  check("a value taken off the Flagged list, phrase and all, comes back", [on.flagged, on.phrases], [["Rosa Delgado"], ["Rosa Delgado"]]);
  const keep = decisionDelta(st({ keeps: [{ control: "no", value: "Cal" }] }),
    st({ keeps: [{ control: "never", value: "Cal" }, { control: "no", value: "Dealer", state: "local" }] }));
  check("keeps by value, before and after", keep.keeps.length, 2);
  check("undone, each keep reads as it did", applyDecisionDelta(st({ keeps: [{ control: "never", value: "Cal" }, { control: "no", value: "Dealer", state: "local" }] }), keep, true).keeps,
    [{ control: "no", value: "Cal" }]);
  const fake = decisionDelta(st({ settled: ["a"] }), st({ settled: ["a", "rosa delgado"] }));
  check("a fake-it undone", applyDecisionDelta(st({ settled: ["a", "rosa delgado"] }), fake, true).settled, ["a"]);
  const rows = decisionDelta(st({ rows: [["", false], ["", false], ["no", false]] }), st({ rows: [["", false], ["yes", false], ["no", true]] }));
  check("a LEAKS answer by row", rows.rows, [{ i: 1, before: ["", false], after: ["yes", false] }, { i: 2, before: ["no", false], after: ["no", true] }]);
  check("undone, the rows read as before and no other moves",
    applyDecisionDelta(st({ rows: [["typed later", false], ["yes", false], ["no", true]] }), rows, true).rows,
    [["typed later", false], ["", false], ["no", false]]);
  check("rows of another sheet's length are not compared", decisionDelta(st({ rows: [["", false]] }), st({ rows: [["yes", false], ["", false]] })), null);
}

// ---- the lines of New Real Values.txt the reader did not write ----
// The reader writes the file whole, from its lists: a page list PDF-Linker
// reads and the lists cannot hold, and a line put in the file since the
// folder was opened, are kept as they stand, after the reader's own.
console.log("the lines of New Real Values.txt the reader did not write");
{
  check("a line's identity: value, phrase, keep, page lines, comments none",
    ["Quell Harbor", "phrase: Cross River Bank", "never:  Corwin Ashdale", "did not ocr: Exhibit A.pdf | page 2", "# a comment", ""].map(valuesLineKey),
    ["value:quell harbor", "phrase:cross river bank", "never:corwin ashdale", "noocr:exhibit a.pdf|2", "", ""]);
  check("…a page list the reader cannot parse is kept raw", valuesLineKey("did not ocr: Exhibit A.pdf | pages 3-5, 9").startsWith("raw:"), true);
  check("…folded alike however it is spelled", valuesLineKey("QUELL  harbor") === valuesLineKey("Quell Harbor"), true);
  const mine = "# New Real Values\nMarlow Tenbury\nno: Cal\n";
  const seen = valuesLineKeys("Quell Harbor\ndid not ocr: Exhibit A.pdf | pages 3-5, 9\n");
  const disk = "Quell Harbor\ndid not ocr: Exhibit A.pdf | pages 3-5, 9\nHand Typed Value\nMarlow Tenbury\n";
  check("kept: the page list and a line put in since the folder was opened; not the reader's own, nor one it read and has since let go",
    linesNotOurs(disk, { mine, written: "", seen }), ["did not ocr: Exhibit A.pdf | pages 3-5, 9", "Hand Typed Value"]);
  check("…a line this tab last wrote and has since let go is not kept", linesNotOurs("Old Value\n", { mine, written: "Old Value\n", seen: new Set() }), []);
  check("…a keep the operator withdrew is not kept", linesNotOurs("no: Old Keep\n", { mine, seen: new Set(), withdrawn: (c, v) => c === "no" && v === "Old Keep" }), []);
  check("…with the file never read (no seen), only the raw lines", linesNotOurs(disk, { mine, seen: null }), ["did not ocr: Exhibit A.pdf | pages 3-5, 9"]);
  check("…once each", linesNotOurs("Hand Typed Value\nhand typed  value\n", { mine, seen: new Set() }), ["Hand Typed Value"]);
  const both = withLinesNotOurs(mine, ["Hand Typed Value"]);
  check("written after the reader's own lines, under a comment", both.split("\n").slice(-3), ["# Already in this file, not written by the text reader — kept as they stand:", "Hand Typed Value", ""]);
  check("…which PDF-Linker reads as the reader's lines plus the kept one", parseReaderFile(both).values, ["Marlow Tenbury", "Hand Typed Value"]);
  check("…and nothing kept, the reader's text as it was", withLinesNotOurs(mine, []), mine);
  // PDF-Linker's notes stay over the lines it wrote under them.
  const ourKeep = formatValuesFile(["restitution"], [{ control: "no", value: "Corwin Ashdale", state: "" }], [], [], [], []);
  const carried = "# 1 keep(s) kept here by this line: the master KEEP sheet's row for each is another case's.\n\nno: Corwin Ashdale\n";
  const nb = notedBlocks(carried, ourKeep);
  check("notedBlocks: a note and the line under it the reader still carries",
    nb.blocks, [{ note: ["# 1 keep(s) kept here by this line: the master KEEP sheet's row for each is another case's."], lines: ["no: Corwin Ashdale"] }]);
  check("…the line written under the note, not among the reader's own",
    withLinesNotOurs(nb.mine, [], nb.blocks).split("\n").filter((l) => l && !l.startsWith("# ") || /kept here/.test(l)),
    ["restitution", "# 1 keep(s) kept here by this line: the master KEEP sheet's row for each is another case's.", "no: Corwin Ashdale"]);
  check("…a line the reader withdrew goes, and its note with it",
    notedBlocks(carried, formatValuesFile(["restitution"], [], [], [], [], [])).blocks, []);
  check("…the reader's own header, its kept-lines head and a set-aside page line are no notes",
    notedBlocks(ourKeep + "\n" + "# Already in this file, not written by the text reader — kept as they stand:\nno: Corwin Ashdale\n# did not ocr: A.pdf | page 3\n", ourKeep).blocks, []);
  check("sameBytes", [sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2])), sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3])), sameBytes(null, new Uint8Array([]))], [true, false, false]);

  // What the folder's opening read INTO the list from the file is recorded as
  // in the file, so letting it go owes the file its removal.
  const kCor = { control: "no", value: "Corwin Ashdale", state: "" };
  const fixed = { doc: "Exhibit A.pdf", pdf: "", page: 2, sum: "ed8d6603" };
  const listNow = formatValuesFile(["Quell Harbor"], [kCor], [], [], [], [fixed]);
  const fileNow = "Quell Harbor\nno: Corwin Ashdale\ntext corrected: Exhibit A.pdf | page 2 | sum ed8d6603\ndid not ocr: Exhibit A.pdf | pages 3-5, 9\n";
  check("noteLinesRead: the file holding just what the list does — the list's own text, in step",
    noteLinesRead("", fileNow, listNow), listNow);
  const partial = noteLinesRead("Old Value\n", "Quell Harbor\nHand Typed Value\n", listNow);
  check("…else the record and the lines the list took from the file, nothing it did not take",
    partial, "Old Value\nQuell Harbor\n");
  check("…a page list the reader cannot read is never recorded", noteLinesRead("", "did not ocr: Exhibit A.pdf | pages 3-5, 9\n", listNow), "");
  check("…no file, the record as it was", noteLinesRead("Old Value\n", null, listNow), "Old Value\n");
  check("…a transcribed page read in and since taken out by PDF-Linker reads as spent",
    spendLines({ keeps: [], textFixed: [fixed] }, noteLinesRead("", fileNow, listNow), "Quell Harbor\n").spentFixed, [fixed]);
}

// ---- the way back spares what the way out spared ----------------------------
// A fake inside a cited decision's name is that decision's party, not this
// case's: the run spared the name, and a published party can share a word with
// a fake. The page shows it as the export has it.
console.log("cited names on the way back");
{
  const key = parseKey([{ name: "Pseudonym Key", rows: [HEADERS,
    ["person", "Helen Rasho", "Ingrid Smith", "", "", "spreadsheet", 4],
    ["person", "Rasho", "Smith", "", "", "spreadsheet", 3],
    ["entity", "Quillmark, Inc.", "Jones Holdings, Inc.", "", "", "spreadsheet", 2],
    ["person", "Gregory Walton", "Ford", "", "", "harvested", 1],
  ] }], "k");
  const rev = compileDisplay(key);
  check("a cited decision's party who shares a word with a fake keeps its name; the sentence around it reads back",
    translate(rev, "Smith relies on Smith v. Ford Motor Co. (2010) 50 Cal.4th 100, 105.").text,
    "Rasho relies on Smith v. Ford Motor Co. (2010) 50 Cal.4th 100, 105.");
  check("…a writ's real party in interest with it",
    translate(rev, "See Ford v. Superior Court (Smith) (2019) 7 Cal.5th 1.").text,
    "See Ford v. Superior Court (Smith) (2019) 7 Cal.5th 1.");
  check("…and a short cite",
    translate(rev, "(Smith, supra, 50 Cal.4th at p. 105.)").text, "(Smith, supra, 50 Cal.4th at p. 105.)");
  check("this case's own caption, cited, was faked and reads back",
    translate(rev, "In Smith v. Jones Holdings, Inc. (2023) 90 Cal.App.5th 100, the court remanded.").text,
    "In Rasho v. Quillmark, Inc. (2023) 90 Cal.App.5th 100, the court remanded.");
  check("a caption with no cite after it is this case and reads back",
    translate(rev, "SMITH v. JONES HOLDINGS, INC.").text, "RASHO v. QUILLMARK, INC.");
  const p1 = "Plaintiff relies on Smith v. Ford Motor Co.";
  check("a cite whose year opens the next page is spared there too",
    [translate(rev, p1, { next: " 1  (2010) 50 Cal.4th 100." }).text, translate(rev, p1).text],
    [p1, "Plaintiff relies on Rasho v. Gregory Walton Motor Co."]);
  const doc = readExport("====== Page 1 ======\n 1  " + p1 + "\n====== Page 2 ======\n 1  (2010) 50 Cal.4th 100.\n");
  check("…and the page as Find reads it agrees",
    shownPages(doc, { rev })[0].includes("Smith v. Ford Motor Co."), true);
  check("a matcher compiled without the reader's spare reverses everything, as before",
    translate(compile(key), "Smith v. Ford Motor Co. (2010) 50 Cal.4th 100").text, "Rasho v. Gregory Walton Motor Co. (2010) 50 Cal.4th 100");
  check("the runs carry the spared fake as text, never as a pseudonym",
    translateRuns(rev, "Smith v. Ford (2010) 50 Cal.4th 1").filter((r) => r.t === "swap").length, 0);
}

console.log("\ncomments on the document (the block after the last page)");
{
  const text = "====== Page 1 ======\n 1  Plaintiff Rasho filed.\n 2  The court denied it.\n\n" + COMMENTS_HEAD +
    "\n[c1] Page 1, on \"Rasho filed\": Check the \"date\" here [id rdc-abc]\n[c2] Page 1: A note on the page\n";
  const d = parseExport(text);
  check("the block is off the page's lines", d.pages[0].lines, [" 1  Plaintiff Rasho filed.", " 2  The court denied it.", ""]);
  check("…kept as the page's comments, head first", d.pages[0].comments.length, 3);
  check("…and written back byte for byte", serializeExport(d), text);
  check("the page's sum does not see it", pageTextSum(d.pages[0].lines), pageTextSum([" 1  Plaintiff Rasho filed.", " 2  The court denied it."]));
  const cs = parseComments(d.pages[0].comments);
  check("each line read as a comment", cs, [
    { page: 1, on: "Rasho filed", text: "Check the \"date\" here", id: "rdc-abc" },
    { page: 1, on: "", text: "A note on the page", id: null },
  ]);
  check("a quote in the passage is escaped",
    commentLine({ page: 4, on: 'the "Agreement"  of\nsale', text: "  why?\n ", id: "x1" }, 3),
    '[c3] Page 4, on "the \\"Agreement\\" of sale": why? [id x1]');
  check("…and read back", parseComments([commentLine({ page: 4, on: 'a "b" \\c', text: "t", id: "x1" }, 1)])[0].on, 'a "b" \\c');
  check("a block after a page of text opens with a blank line", commentsBlock([{ page: 1, on: "", text: "x", id: null }], [" 1  text"]),
    ["", COMMENTS_HEAD, "[c1] Page 1: x"]);
  check("…after a blank one, with none", commentsBlock([{ page: 2, on: "", text: "x", id: null }], ["text", ""]), [COMMENTS_HEAD, "[c1] Page 2: x"]);
  check("no comments, no block", commentsBlock([], ["text"]), null);
  check("a line typed into the block by hand is kept", commentsBlock(parseComments([COMMENTS_HEAD, "my own note", "[c9] Page 1: y"]), [""]),
    [COMMENTS_HEAD, "my own note", "[c1] Page 1: y"]);
  const added = parseExport(serializeExport({ newline: "\n", trailingNewline: true, pages: [{ header: "====== Page 1 ======", lines: ["text"], comments: commentsBlock([{ page: 1, on: "", text: "x" }], ["text"]) }] }));
  check("a block first written settles: its blank line is the page's", [added.pages[0].lines, added.pages[0].comments], [["text", ""], [COMMENTS_HEAD, "[c1] Page 1: x"]]);
  check("a Combined Text.txt member's block ends at the next banner",
    parseExport("#### DOCUMENT 1 OF 2 IN THIS COMBINED FILE: A.txt ####\n====== Page 1 ======\na\n\n" + COMMENTS_HEAD + "\n[c1] Page 1: x\n\n#### DOCUMENT 2 OF 2 IN THIS COMBINED FILE: B.txt ####\n====== Page 1 ======\nb\n").pages.map((p) => [p.lines, p.comments || null]),
    [[[], null], [["a", ""], [COMMENTS_HEAD, "[c1] Page 1: x", ""]], [[], null], [["b"], null]]);
  const page = " 1  The parties met in\n 2  Los Angeles on Friday.";
  check("a passage wrapped at the margin is found across the numbers", (([a, b]) => page.slice(a, b))(findPassage(page, "met in Los Angeles")), "met in\n 2  Los Angeles");
  check("…ignoring case where it must", (([a, b]) => page.slice(a, b))(findPassage(page, "los angeles")), "Los Angeles");
  check("…and not found, null", findPassage(page, "San Diego"), null);
  check("cloneDoc copies the block", (() => { const c = cloneDoc(d); c.pages[0].comments.push("x"); return d.pages[0].comments.length; })(), 3);
}


console.log("margin numbers set back in their column (tidyGutters)");
{
  check("one space after a margin number: set back to two, the number in two characters",
    tidyGutters([" 8  make.", "9 37. Oakenshaw then told", "10  application.", "18 40. Told", "19 that she had", "20  Born."]),
    [" 8  make.", " 9  37. Oakenshaw then told", "10  application.", "18  40. Told", "19  that she had", "20  Born."]);
  check("a paragraph number in the text is the text's, not the margin's", tidyGutters([" 8  make.", "37. Oakenshaw", " 9  next"]), [" 8  make.", "37. Oakenshaw", " 9  next"]);
  check("margin numbers only go up to 28", tidyGutters(["27  a", "28  b", "29 c"]), ["27  a", "28  b", "29 c"]);
  check("a number out of order down the page is the text's", tidyGutters(["25  a", "26", "5 days later"]), ["25  a", "26", "5 days later"]);
  check("nothing to set back, the lines as they were", tidyGutters([" 1  a", " 2", " 3  c"]), [" 1  a", " 2", " 3  c"]);
  check("a number put back where the line already carries it with one space: read as that number, not put in front of it",
    (restoreMarginNumbers(Array.from({ length: 10 }, (_, k) => (k === 5 ? "6 text six" : String(k + 1).padStart(2) + "  line " + (k + 1)))) || { lines: null }).lines,
    Array.from({ length: 10 }, (_, k) => String(k + 1).padStart(2) + "  " + (k === 5 ? "text six" : "line " + (k + 1))));
}

console.log("column boxes (makeColumnBox, reflowBox, boxBackspace)");
{
  const L = [" 7  QUILLON BRAKESMAN,           COMPLAINT FOR:", " 8  Plaintiff,                    1. Breach of contract", " 9  v.                            2. Fraud", "10", "11  Next."];
  const m = makeColumnBox(L, 0, 2, 34, { numbered: true });
  check("a box of the lines: rules over and under as half lines, each line on its number", m.lines, [
    "    ┌────────────────────────────────┬───────────────────────┐",
    " 7  │ QUILLON BRAKESMAN,             │ COMPLAINT FOR:        │",
    " 8  │ Plaintiff,                     │ 1. Breach of contract │",
    " 9  │ v.                             │ 2. Fraud              │",
    "    └────────────────────────────────┴───────────────────────┘", "10", "11  Next."]);
  const typed = m.lines.slice();
  typed[2] = typed[2].replace("1. Breach of contract", "1. Breach of written contract and of the covenant");
  const r = reflowBox(typed, 2, { line: 2, col: typed[2].indexOf("covenant") + 3 }, { numbered: true });
  check("typed past a cell's width: wrapped down the column, the box grown over the empty line 10, 2. Fraud whole", r.lines.slice(1, 6).map((l) => [l.slice(0, 4), l.split("│")[2].trim()]),
    [[" 7  ", "COMPLAINT FOR:"], [" 8  ", "1. Breach of written"], [" 9  ", "contract and of the"], ["10  ", "covenant"], ["    ", "2. Fraud"]]);
  check("…the caret in the word it was in", r.lines[r.caret.line].slice(r.caret.col - 3, r.caret.col + 5), "covenant");
  const e = reflowBox(m.lines, 2, { line: 2, col: m.lines[2].indexOf("of contract") + 3 }, { numbered: true, breakAt: true });
  const b = boxBackspace(e.lines, e.caret.line, e.caret.col, { numbered: true });
  check("Enter in a cell and Backspace back: the box as it was (grown over line 10)", b.lines.slice(0, 4).concat(b.lines.slice(5)), m.lines.slice(0, 4).concat(b.lines.slice(5)));
  check("Backspace at the head of the first row's cell: nothing joined across the rule", boxBackspace(m.lines, 1, m.lines[1].indexOf("COMPLAINT"), { numbered: true }).lines, m.lines);
  const wide = makeColumnBox(L, 0, 2, 34, { numbered: true, across: 70 });
  check("drawn across the page's text: the right column to the widest line", wide.lines[0].length, 4 + 70);
  const narrower = resizeBox(wide.lines, 1, 1, 24, { numbered: true });
  check("the divider moved left: every rule at the new column, the left column's text wrapped down it, the right untouched",
    [narrower.filter((l) => /[┌│└]/.test(l)).every((l) => l[24] === "┬" || l[24] === "│" || l[24] === "┴"), narrower.slice(1, 4).map((l) => l.split("│")[1].trim()), narrower.slice(1, 4).map((l) => l.split("│")[2].trim())],
    [true, ["QUILLON", "BRAKESMAN,", "Plaintiff,"], ["COMPLAINT FOR:", "1. Breach of contract", "2. Fraud"]]);
  check("the right edge drawn in: the box narrower", resizeBox(wide.lines, 1, 2, 60, { numbered: true })[0].length, 61);
  check("…a divider not past its neighbour", resizeBox(wide.lines, 1, 1, 2, { numbered: true })[0].indexOf("┬"), 4 + 1 + 6);
}
console.log("a table ruled only between its columns: keys kept in the column (openBoxAround, boxEdit)");
{
  // As PDF-Linker writes a table with no rule down its outer sides: the rules
  // start and end in a ─, each row a │ between its columns and none at its ends.
  const R = "    ───────────────────────────┼──────────────────────┼─────────────────────────";
  const row = (lead, a, b, c) => (lead + " " + a).padEnd(31) + "│ " + b.padEnd(21) + "│ " + c;
  const L = [R,
    row(" 8  ", "1. Paragraph 4;", "Hearsay; the", "Overrule. Authentication."),
    row(" 9  ", "Exhibit 18", "deposition", "Paragraph 4 authenticates"),
    row("    ", "Attached to the", "excerpts are", "the transcript excerpts, a line longer than its rule."),
    row("10  ", "Compendium of", "offered for the", "Deposition evidence."),
    row("    ", "", "truth of the", ""),
    row("11  ", "Exhibits.", "", ""),
    R.replace(/┼/g, "┴"), "12"].map((l) => l.trimEnd());
  const col = (lines, j) => lines.filter((l) => l.includes("│") && !l.includes("─")).map((l) => (j ? l.split("│")[j] : l.split("│")[0].slice(4)).trim());
  check("its open sides found: the box's lines, a │ to go at each end", openBoxAround(L, 2), { from: 0, to: 7, left: 4, right: 80 });
  check("a table ruled on every side has none open", openBoxAround(["┌──┬──┐", "│ a│ b│", "└──┴──┘"], 1), null);
  check("…nor does a line of two bars with no rule by it", openBoxAround(["a │ b │ c"], 0), null);
  const bs = boxEdit(L, 6, L[6].indexOf("Exhibits"), "Backspace", { numbered: true });
  check("Backspace at the head of the first column's text: joined to the column's row above, no bar moved", [col(bs.lines, 0), bs.lines.filter((l) => l.includes("│")).every((l) => l[31] === "│" || l[31] === "┼" || l[31] === "┴")],
    [["1. Paragraph 4;", "Exhibit 18", "Attached to the", "Compendium of", "Exhibits.", ""], true]);
  check("…the other columns as they were, the long line not wrapped", [col(bs.lines, 1), col(bs.lines, 2)], [col(L, 1), col(L, 2)]);
  check("…the rules as they stood, numbers kept", [bs.lines[0], bs.lines[bs.lines.length - 2], bs.lines.map((l) => l.slice(0, 4)).join("|")], [L[0], L[L.length - 2], L.map((l) => l.slice(0, 4)).join("|")]);
  check("…the caret at its head, a line up", [bs.caret.line, bs.lines[bs.caret.line].slice(bs.caret.col, bs.caret.col + 8)], [5, "Exhibits"]);
  const bj = boxEdit(bs.lines, 5, bs.caret.col, "Backspace", { numbered: true });
  check("Backspace again: joined to the end of the column's text above, the caret after it", [col(bj.lines, 0).slice(3, 5), bj.lines[bj.caret.line].slice(bj.caret.col - 3, bj.caret.col)], [["Compendium of Exhibits.", ""], "of "]);
  const en = boxEdit(L, 2, L[2].indexOf("Exhibit 18"), "Enter", { numbered: true });
  check("Enter: that column's text from the caret down a row, the others not moved", [col(en.lines, 0), col(en.lines, 1), col(en.lines, 2)],
    [["1. Paragraph 4;", "", "Exhibit 18", "Attached to the", "Compendium of", "Exhibits."], col(L, 1), col(L, 2)]);
  check("…the caret at the head of the text it sent down", en.lines[en.caret.line].slice(en.caret.col, en.caret.col + 7), "Exhibit");
  check("Backspace inside a cell's text: the page's own", boxEdit(L, 2, L[2].indexOf("hibit"), "Backspace", { numbered: true }), null);
  check("Delete at a cell's end: nothing taken (no bar, no row joined)", boxEdit(L, 2, L[2].indexOf("Exhibit 18") + 10, "Delete", { numbered: true }).lines, L);
  check("Delete inside a cell's text: the page's own", boxEdit(L, 2, L[2].indexOf("hibit"), "Delete", { numbered: true }), null);
  const typed = L.slice();
  typed[1] = typed[1].replace("Hearsay; the", "Hearsay; the deposition is");
  const ty = boxEdit(typed, 1, typed[1].indexOf(" is") + 3, "typed", { numbered: true });
  check("typed past a cell's width: the row set back on its rules, the word wrapped down its column", [ty.lines[1].indexOf("│"), col(ty.lines, 1).slice(0, 3)], [31, ["Hearsay; the", "deposition is", "deposition excerpts"]]);
}
{
  const B = ["┌──────────────┬──────────┐", "│ Hearsay; the │ x        │", "│ deposition   │ y        │", "│ excerpts are │          │", "└──────────────┴──────────┘"];
  check("Backspace joining a cell's text longer than the cell above: wrapped back down its column, no bar moved (once read off the row the join had widened)",
    boxBackspace(B, 2, 2, {}).lines, B);
}
console.log("words struck through (strikeRuns, strikeEdit, unstruck)");
{
  check("a run read off its line", strikeRuns("pay ~~the sum~~ of $500"), [{ open: 4, close: 13 }]);
  check("a ~~ that pairs with nothing, or opens on a space, is text", strikeRuns("a ~~ b ~~c and ~~d"), []);
  check("a pair across a column gap is text: no run crosses one", strikeRuns("~~LEFT      RIGHT~~"), []);
  check("…nor across a box's rule", strikeRuns("~~a │ b~~"), []);
  check("the words as printed", unstruck("x ~~a b~~ y\n~~c~~ d ~~ e"), "x a b y\nc d ~~ e");
  check("the mark", STRIKE_MARK, "~~");
  const ed = (t, a, b, o) => { const r = strikeEdit(t, a, b, o); return r && [r.text, r.strike]; };
  check("words struck", ed("pay the sum of $500", 4, 11), ["pay ~~the sum~~ of $500", true]);
  check("pressed on struck words: the strike off", ed("pay ~~the sum~~ of $500", 6, 13), ["pay the sum of $500", false]);
  check("off a word in the middle: the run either side stays", ed("pay ~~the sum of~~ $500", 10, 13), ["pay ~~the~~ sum ~~of~~ $500", false]);
  check("struck beside a run: the two join", ed("~~abc~~ def", 8, 11), ["~~abc def~~", true]);
  check("part struck, part not: all of it struck, one run", ed("a ~~b~~ c", 0, 9), ["~~a b c~~", true]);
  check("across a column gap: a run each side", ed("left col      right col", 0, 23), ["~~left col~~      ~~right col~~", true]);
  check("over two lines: each line's piece", ed("line one\nline two", 5, 13), ["line ~~one~~\n~~line~~ two", true]);
  check("a stretch reaching into a name takes it whole", ed("Jane Doe paid", 2, 4, { atoms: [[0, 8]] }), ["~~Jane Doe~~ paid", true]);
  check("spaces alone: nothing to strike", strikeEdit("a    b", 2, 4), null);
  const r = strikeEdit("pay ~~the sum~~ of $500 now", 16, 27);
  check("the ops last first, each a mark in or out", r.ops.map((o) => [o.at, o.del ? "del" : o.open ? "open" : "close"]), [[27, "close"], [13, "del"]]);
}
console.log("a condensed transcript's sheet: four pages' own numbers, nothing put back (headerSaysCondensed)");
{
  const head = (n, pages) => `====== Page ${n} (printed p. ${pages[0]}-${pages[pages.length - 1]}) — NOTE: CONDENSED TRANSCRIPT: ${pages.length} pages printed on this one (pages ${pages.join(", ")}), each written in turn with its own line numbers ======`;
  const sheet = (n, pages) => {
    const out = [head(n, pages), "         Corla Ventimiglia v. Ashgrove Freight Lines"];
    for (const p of pages) {
      out.push(`                        Page ${p}`);
      // Line 24 left empty, line 25 read by nothing: a pleading page's
      // numbers would be put back over both.
      for (let k = 1; k <= 23; k++) out.push(String(k).padStart(2) + `  Q Line ${k} of page ${p}.`);
    }
    out.push("    9 (Pages 30 - 33)    Halvorsen Reporting");
    return out;
  };
  const pleading = (n) => [`====== Page ${n} ======`, ...Array.from({ length: 26 }, (_, k) => String(k + 1).padStart(2) + `  Pleading line ${k + 1}.`)];
  const text = [...pleading(1), ...sheet(2, [30, 31, 32, 33]), ...sheet(3, [34, 35, 36, 37])].join("\n") + "\n";
  const doc = readExport(text);
  check("its header says so", doc.pages.map(headerSaysCondensed), [false, true, true]);
  check("an ordinary header does not", headerSaysCondensed(parseExport("====== Page 2 (printed p. 9) — REVIEW: recognised at only 150 dpi, text is LOW CONFIDENCE ======\n").pages[0]), false);
  check("nothing put back on the sheets", [doc.pages[1].restored || null, doc.pages[2].restored || null], [null, null]);
  check("…which read as the file has them", serializeExport({ ...doc, pages: doc.pages.slice(1) }), [...sheet(2, [30, 31, 32, 33]), ...sheet(3, [34, 35, 36, 37])].join("\n") + "\n");
  // Their boxes run to 23 on every sheet: counted, the one pleading page's 24
  // to 26 would have read as numbers misread past the paper's last.
  check("the sheets say nothing of where the pleading pages run to", pleadingLast(doc.pages), null);
  check("…as a document of sheets alone says nothing", pleadingLast(readExport([...sheet(1, [30, 31, 32, 33]), ...sheet(2, [34, 35, 36, 37])].join("\n")).pages), null);
}
console.log("a line as the page lays it out: a strike's hidden marks take no room (strikeLayout)");
{
  const L = strikeLayout(" 3  ~~LESSOR SIGNS HERE~~        LESSEE SIGNS HERE");
  check("the marks out", L.text, " 3  LESSOR SIGNS HERE        LESSEE SIGNS HERE");
  check("…so the second column stands where it stood unstruck", L.text.indexOf("LESSEE"), " 3  LESSOR SIGNS HERE        LESSEE SIGNS HERE".indexOf("LESSEE"));
  check("a place carried back to the line: the character's, or the opening mark before it", [L.toFile(4), L.toFile(4, true), L.toFile(21), L.toFile(29)], [6, 4, 25, 33]);
  check("…and a place in the line to the layout's", [L.toVis(4), L.toVis(6), L.toVis(23), L.toVis(25), L.toVis(33)], [4, 4, 21, 21, 29]);
  const M = strikeLayout("~~a~~ b   ~~c d~~  e");
  check("two runs", [M.text, M.toFile(M.text.indexOf("e")), M.toFile(M.text.indexOf("c"), true)], ["a b   c d  e", 19, 10]);
  const plain = strikeLayout("no ~~ marks paired here ~~ ");
  check("marks that pair with nothing are text, and take their room", [plain.text, plain.toFile(5), plain.toVis(5)], ["no ~~ marks paired here ~~ ", 5, 5]);
}
console.log("margin numbers that run complete (pageNumbersComplete)");
{
  check("pleading paper 1 to 28: complete", pageNumbersComplete(Array.from({ length: 28 }, (_, k) => String(k + 1).padStart(2) + "  x")), true);
  check("three numbers an OCR caught on a page of eight lines: not", pageNumbersComplete([" 1  a", " 2  b", " 3  c", "d", "e", "f", "g", "h"]), false);
  check("no numbers: not", pageNumbersComplete(["a", "b"]), false);
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
