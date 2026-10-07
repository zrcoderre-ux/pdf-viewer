// Node-runnable tests for redaction (viewer/redact.js + pdf-edit.buildRedactedPdf).
//
// Two kinds of decision are tested here. The first is where a name STANDS: the
// page arrives as a pile of text-layer spans, and turning the key's match back
// into rectangles depends on how those spans are read as one string and mapped
// back. The second is what the saved file IS — which is the whole promise of
// the feature, so the PDF that comes out is opened and read for text, for an
// /Info dictionary and for an XMP packet, none of which may be in it.
//
// Run: node test-redact.mjs

import zlib from "node:zlib";
import {
  spanGap, pageTextFromSpans, spanRangeFor,
  mergeRects, padRect, clampRect, redactedName, countLabel,
  addRedaction, removeRedaction, redactionsFor, redactionPages,
  redactionCount, clearRedactions, createRedactionStore, pageBoxFromView,
  valueWords, wordsOwed, coveredClaims,
  scrubbedStem, unweldNames, nameWordFakes, partWelds, boundValueStands,
} from "./viewer/redact.js";
import { buildRedactedPdf } from "./viewer/pdf-edit.js";
import { parseKey, compileForward, forwardRuns, translate, boundRows } from "./viewer/pseudo-key.js";

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

// A span as the viewer hands it over: what it says, and where it sits.
const S = (text, left, top, width, height = 10) => ({ text, left, top, width, height });

console.log("how two spans are joined");
{
  check("a span that has dropped a line opens a new one",
    spanGap(S("Helen", 100, 100, 40), S("Rasho", 100, 118, 40)), "\n");
  check("a gap on the same line is a space",
    spanGap(S("Helen", 100, 100, 40), S("Rasho", 150, 100, 40)), " ");
  check("spans that touch are one word cut in two",
    spanGap(S("Hel", 100, 100, 20), S("en", 120, 100, 14)), "");
  check("a space already written is the gap",
    spanGap(S("Helen ", 100, 100, 44), S("Rasho", 150, 100, 40)), "");
  check("…from either side",
    spanGap(S("Helen", 100, 100, 40), S(" Rasho", 150, 100, 44)), "");
  check("an empty span joins to nothing", spanGap(S("", 100, 100, 0), S("Rasho", 100, 100, 40)), "");
  check("a hair of a gap is a kern, not a space",
    spanGap(S("Hel", 100, 100, 20), S("en", 121, 100, 14)), "");
}

console.log("the page as one string, and the way back");
{
  const spans = [S("Helen", 100, 100, 40), S("Rasho", 150, 100, 40), S("filed", 100, 118, 30)];
  const { text, map } = pageTextFromSpans(spans);
  check("the spans read as the page reads", text, "Helen Rasho\nfiled");
  check("a character knows the span it came from", map[0], { span: 0, off: 0 });
  check("the separator belongs to no span", map[5], null);
  check("and the span after it starts again at nothing", map[6], { span: 1, off: 0 });

  const at = text.indexOf("Helen Rasho");
  check("a name across two spans is one range",
    spanRangeFor(map, at, at + "Helen Rasho".length),
    { startSpan: 0, startOffset: 0, endSpan: 1, endOffset: 5 });
  check("a name inside one span is that span's own slice",
    spanRangeFor(map, text.indexOf("Rasho"), text.indexOf("Rasho") + 5),
    { startSpan: 1, startOffset: 0, endSpan: 1, endOffset: 5 });
  check("a range that is nothing but separator places nowhere",
    spanRangeFor(map, 5, 6), null);
  check("a range past the end is what there is of it",
    spanRangeFor(map, text.length - 5, text.length + 50),
    { startSpan: 2, startOffset: 0, endSpan: 2, endOffset: 5 });
}

console.log("one line of text, one box");
{
  // A name split across two spans reports two rectangles with a hairline
  // between them; the box drawn has to be one box.
  check("touching rectangles on a line become one",
    mergeRects([{ x: 100, y: 100, w: 30, h: 10 }, { x: 130, y: 100, w: 25, h: 10 }]),
    [{ x: 100, y: 100, w: 55, h: 10 }]);
  check("a rectangle a whisker short still joins",
    mergeRects([{ x: 100, y: 100, w: 30, h: 10 }, { x: 131, y: 101, w: 25, h: 9 }]),
    [{ x: 100, y: 100, w: 56, h: 10 }]);
  check("two lines stay two boxes, so a wrap does not black out the margin",
    mergeRects([{ x: 100, y: 100, w: 30, h: 10 }, { x: 100, y: 118, w: 25, h: 10 }]),
    [{ x: 100, y: 100, w: 30, h: 10 }, { x: 100, y: 118, w: 25, h: 10 }]);
  check("words apart on one line stay apart",
    mergeRects([{ x: 100, y: 100, w: 30, h: 10 }, { x: 300, y: 100, w: 25, h: 10 }]),
    [{ x: 100, y: 100, w: 30, h: 10 }, { x: 300, y: 100, w: 25, h: 10 }]);
  check("three pieces of one line come out as one",
    mergeRects([
      { x: 100, y: 100, w: 20, h: 10 },
      { x: 140, y: 100, w: 20, h: 10 },
      { x: 120, y: 100, w: 20, h: 10 },
    ]),
    [{ x: 100, y: 100, w: 60, h: 10 }]);
  check("a rectangle of no size is not a box", mergeRects([{ x: 1, y: 1, w: 0, h: 10 }]), []);
  check("nothing to merge is nothing", mergeRects([]), []);
  check("the gap is the caller's to set",
    mergeRects([{ x: 100, y: 100, w: 30, h: 10 }, { x: 140, y: 100, w: 20, h: 10 }], 10),
    [{ x: 100, y: 100, w: 60, h: 10 }]);
}

console.log("a box grown, and held on its page");
{
  check("a box grows on every side", padRect({ x: 10, y: 10, w: 40, h: 10 }, 1),
    { x: 9, y: 9, w: 42, h: 12 });
  const LETTER = { x: 0, y: 0, w: 612, h: 792 };
  check("a box over the edge is cut to the page",
    clampRect({ x: -5, y: -5, w: 50, h: 50 }, LETTER), { x: 0, y: 0, w: 45, h: 45 });
  check("a box past the far edge likewise",
    clampRect({ x: 600, y: 780, w: 50, h: 50 }, LETTER), { x: 600, y: 780, w: 12, h: 12 });
  check("a box entirely off the page is no box",
    clampRect({ x: 700, y: 900, w: 50, h: 50 }, LETTER), null);
  // A page whose box does not start at the origin — legal, and not rare in
  // scans — is held to where it actually is, not to a rectangle at 0,0.
  check("a page box away from the origin holds the box where the page is",
    clampRect({ x: 10, y: 10, w: 50, h: 50 }, { x: 30, y: 40, w: 612, h: 792 }),
    { x: 30, y: 40, w: 30, h: 20 });
  check("a page with no box keeps nothing", clampRect({ x: 0, y: 0, w: 10, h: 10 }, null), null);
}

console.log("the name the copy is saved under");
{
  // The copy is named as PDF-Linker names the export (_pn_scrubbed_stem): its
  // separators spaced, then faked — so "Rasho v Quillmark - MTC" is named as
  // its export is, "Strangeways v Melbury MTC".
  const fake = (t) => t.replace(/Rasho/g, "Strangeways").replace(/Quillmark/g, "Melbury");
  check("no key, and the copy is still marked",
    redactedName("Rasho v Quillmark - MTC.pdf", null), "Rasho v Quillmark MTC (redacted).pdf");
  check("with a key the copy carries the pseudonymized name",
    redactedName("Rasho v Quillmark - MTC.pdf", fake), "Strangeways v Melbury MTC (redacted).pdf");
  check("a copy of a copy is marked once",
    redactedName("Strangeways v Melbury (redacted).pdf", null), "Strangeways v Melbury (redacted).pdf");
  check("a path is not part of the name",
    redactedName("C:\\Cases\\Rasho\\MTC.pdf", null), "MTC (redacted).pdf");
  check("a key that throws leaves the name it had",
    redactedName("MTC.pdf", () => { throw new Error("no"); }), "MTC (redacted).pdf");
  check("a nameless file is still a file", redactedName("", null), "document (redacted).pdf");
  check("with no key at all, a document's name is written with spaces, never underscores",
    redactedName("Motion_to_Compel__Further.pdf", null), "Motion to Compel Further (redacted).pdf");
}

// THE NAME GOES WHERE THE COPY GOES. The stem used to be run forward as it
// stood, and the key finds a name only standing as a word: an underscore is a
// letter to its matcher and a weld has no boundary, so "Helen_Rasho_Decl",
// "RashoDecl" and "25STCV59720_Complaint" were the names of copies whose pages
// were black over every one of those values. Both of the readers' forwards are
// run here — the text reader's (forwardRuns) and the viewer's (translate) —
// over the key the review found it with.
console.log("the copy's name hides what its pages hide");
{
  const key = parseKey([{ name: "Pseudonym Key", rows: [
    ["Category", "Real Value", "Replacement", "Context", "Status", "Source", "Occurrences"],
    ["person", "Helen Rasho", "Ingrid Strangeways", "", "", "spreadsheet", 12],
    ["person-token", "Rasho", "Strangeways", "", "", "spreadsheet", 30],
    ["entity", "Quillmark Holdings", "Melbury Partners", "", "", "spreadsheet", 4],
    ["entity-token", "Quillmark", "Melbury", "", "", "spreadsheet", 4],
    ["docket", "25STCV59720", "25STZV11111", "", "", "spreadsheet", 4],
    ["docket", "23-cv-01234", "23-cv-05678", "", "", "spreadsheet", 2],
    ["person-token", "Lee", "Hartwell", "", "", "spreadsheet", 4],
    ["person-token", "Ann", "Corvina", "", "", "spreadsheet", 4],
    ["person-token", "Bill", "Tamsin", "", "", "spreadsheet", 3],
    ["person-token", "Rashoe", "~Rasho", "", "leaked", "document", 1],
    ["email", "helen_rasho@rashofamilylaw.com", "quenby3@postbox9.org", "", "", "", 2],
    ["person", "José García", "Tomás Velarde", "", "", "", 2],
    ["person-token", "García", "Velarde", "", "", "", 2],
    ["person-token", "O'Brien", "Fairweather", "", "", "", 2],
  ] }], "pseudonym_key.xlsx");
  const f = compileForward(key);
  const rows = boundRows(key);
  const readers = {
    reader: { forward: (t) => forwardRuns(f, t).map((r) => (r.t === "swap" ? r.to : r.s)).join(""), rows },
    viewer: { forward: (t) => translate(f, t).text, rows },
  };
  const both = (name) => {
    const a = redactedName(name, readers.reader);
    const b = redactedName(name, readers.viewer);
    return a === b ? a : `reader ${a} / viewer ${b}`;
  };
  const NEUTRAL = /^document [0-9a-f]{6} \(redacted\)\.pdf$/;

  check("underscores are spaces, and the names between them are faked",
    both("Rasho_v_Quillmark_MTC.pdf"), "Strangeways v Melbury MTC (redacted).pdf");
  check("a full name joined by underscores is faked whole",
    both("Helen_Rasho_Decl.pdf"), "Ingrid Strangeways Decl (redacted).pdf");
  check("a docket before an underscore is faked",
    both("25STCV59720_Complaint.pdf"), "25STZV11111 Complaint (redacted).pdf");
  check("a hyphen is a space too, as PDF-Linker spaces it",
    both("Rasho-Decl.pdf"), "Strangeways Decl (redacted).pdf");
  check("…save inside a value spelled with one: the docket keeps its hyphens and is faked whole",
    both("23-cv-01234_Order.pdf"), "23-cv-05678 Order (redacted).pdf");
  // …and an underscore the same: an address whose handle carries one, spaced
  // out, was no address the key binds, and its handle two words it does — the
  // forward faked the person and left the firm's domain, the surname in it:
  // "Letter to ingrid strangeways@rashofamilylaw.com (redacted).pdf".
  check("…an e-mail address whose handle has an underscore keeps it, and is faked whole",
    both("Letter to helen_rasho@rashofamilylaw.com.pdf"), "Letter to quenby3@postbox9.org (redacted).pdf");
  check("…wherever it stands in the name",
    both("RE_helen_rasho@rashofamilylaw.com_thread.pdf"), "RE quenby3@postbox9.org thread (redacted).pdf");

  // Two or three bound name words run together, and nothing else, are their
  // fakes run together the same way, each in its own case.
  check("a welded full name is its fakes welded",
    both("HelenRasho Decl.pdf"), "IngridStrangeways Decl (redacted).pdf");
  check("…in capitals", both("HELENRASHO_DECL.pdf"), "INGRIDSTRANGEWAYS DECL (redacted).pdf");
  check("…in lower case", both("helenrasho.pdf"), "ingridstrangeways (redacted).pdf");
  check("…two parties' words alike", both("QuillmarkRasho Opp.pdf"), "MelburyStrangeways Opp (redacted).pdf");

  // A value the key cannot fake where it stands takes the copy to a neutral
  // name: a name welded to a word no key binds, at a seam where the case or
  // the digits turn; a long value inside a word; a docket that lost its
  // hyphens; a value whose row holds an instruction rather than a fake.
  for (const n of ["RashoDecl.pdf", "MSJRasho.pdf", "Rasho2023.pdf", "HELENRASHODECL.pdf",
    "25STCV59720Complaint.pdf", "23_cv_01234 Order.pdf", "Rashoe_Decl.pdf",
    // An address spelled otherwise than the key spells it: its handle faked
    // word by word, its host would stand.
    "helen.rasho@rashofamilylaw.com thread.pdf",
    // A value spaced out, its accents dropped, its apostrophe dropped; a weld
    // the forward parts at an accent and half fakes ("JoséVelarde").
    "25_STCV_59720 Complaint.pdf", "Jose_Garcia_Decl.pdf", "OBRIEN_DECL.pdf", "JoséGarcía Decl.pdf"]) {
    const got = both(n);
    ok(`${n} takes a neutral name (${got})`, NEUTRAL.test(got));
  }
  const n1 = redactedName("RashoDecl.pdf", readers.reader);
  check("the same document always takes the same neutral name", redactedName("RashoDecl.pdf", readers.reader), n1);
  ok("…and another document another", redactedName("RashoReply.pdf", readers.reader) !== n1);
  check("re-redacting a neutral copy keeps its name, marked once", redactedName(n1, readers.reader), n1);
  // The hash carries the key: a guess at the original name cannot be tested
  // against the copy by anyone who does not hold the key.
  ok("…and the hash is not the stem's alone", redactedName("RashoDecl.pdf", { forward: readers.reader.forward, rows: rows.slice(1) }) !== n1);

  // A SHORT NAME RUN INTO OTHER LETTERS, its own letters carrying a capital,
  // is the name: PDF-Linker's short weld tier. The commit before pinned
  // "RASHODECL (redacted).pdf" here as the expected name, on the reasoning
  // that such a test would call "Release" a leak for a party named Lee; it
  // would not, "release" having no "lee" in it.
  for (const n of ["RASHODECL.pdf", "Rashodecl.pdf", "RASHOS OPP.pdf", "Rashos_Opp.pdf", "DECLRASHO.pdf"]) {
    const got = both(n);
    ok(`${n} takes a neutral name (${got})`, NEUTRAL.test(got));
  }
  // Under four letters a name is too short to tell from a word's letters.
  check("a name under four letters inside a word is no name: Lee in Leeward, Ann in Annual",
    both("Leeward_Annual_Report.pdf"), "Leeward Annual Report (redacted).pdf");
  // The cost: with no dictionary, a capitalised word with a party's short name
  // in it is the name — a useful name lost, not a party's name kept.
  ok("a capitalised word with a short name in it takes a neutral name: Bill in Billing",
    NEUTRAL.test(both("Billing Statement.pdf")));
  check("…never a lower-case one, as PDF-Linker reads it (_pn_span_is_cased)",
    both("billing statement.pdf"), "billing statement (redacted).pdf");
  check("a possessive is faked as before", both("Quillmark's MSJ.pdf"), "Melbury's MSJ (redacted).pdf");
  check("a date's hyphens are spaces, as in the export's own name",
    both("2023-01-05 RASHO DECL.pdf"), "2023 01 05 STRANGEWAYS DECL (redacted).pdf");

  // A bare forward (no rows) still checks with its own reading of the name.
  ok("a bare forward still sends a seam weld to a neutral name",
    NEUTRAL.test(redactedName("RashoDecl.pdf", readers.reader.forward)));
}

console.log("the pieces of the name's scrub");
{
  const words = nameWordFakes([
    { real: "Helen Rasho", fake: "Ingrid Strangeways" },
    { real: "Quillmark Holdings", fake: "Melbury Holdings" },
    { real: "Rashoe", fake: "", control: "~Rasho" },
    { real: "J. Doe", fake: "K. Wilde" },
  ]);
  check("a word the fake carries over is no name; an instruction is no fake; a word under three letters is none",
    [...words.entries()], [["helen", "Ingrid"], ["rasho", "Strangeways"], ["quillmark", "Melbury"], ["doe", "Wilde"]]);
  check("a run that is one bound word is the forward's business", unweldNames("Rasho Quillmark", words), "Rasho Quillmark");
  check("a run with a letter no bound word accounts for is left whole", unweldNames("RashoDecl HelenRashoX", words), "RashoDecl HelenRashoX");
  check("three words run together, and no more", unweldNames("HelenRashoQuillmark DoeHelenRashoQuillmark", words),
    "IngridStrangewaysMelbury DoeHelenRashoQuillmark");
  check("welds part where the case and the digits turn", partWelds("RashoDecl MSJRasho Rasho2023 25STCV59720"),
    "Rasho Decl MSJ Rasho Rasho 2023 25 STCV 59720");
  const rows = [{ real: "Helen Rasho" }, { real: "Rasho" }, { real: "25STCV59720" }, { real: "Lee" }];
  check("a value is found whatever stands between its words",
    ["Helen-Rasho", "helen.rasho", "Rasho's", "HelenRasho"].map((s) => boundValueStands(s, rows)), [true, true, true, true]);
  check("a short name inside a word, where its letters carry a capital and it is four letters or more",
    ["RASHODECL", "Rashomon", "DeclRASHO", "rashomon", "Leeward", "Strangeways"].map((s) => boundValueStands(s, rows)),
    [true, true, true, false, false, false]);
  check("a long value inside a word is found", boundValueStands("Complaint25STCV59720", rows), true);
  check("…and spaced out across whole words, edge to edge, but not from the middle of one",
    ["25 STCV 59720 Complaint", "x25 STCV 597201"].map((s) => boundValueStands(s, rows)), [true, false]);
  check("a value is read with its accents off",
    ["Jose Garcia", "GARCIA DECL"].map((s) => boundValueStands(s, [{ real: "José García" }, { real: "García" }])), [true, true]);
  check("…and with the apostrophe a file name drops", boundValueStands("OBRIEN DECL", [{ real: "O'Brien" }]), true);
  check("an e-mail address's host is a value of its own",
    boundValueStands("ingrid strangeways@rashofamilylaw.com", [{ real: "helen_rasho@rashofamilylaw.com" }]), true);
  // The forward reads a word as ASCII letters and parts "JoséGarcía" at the
  // accent: the surname faked, the given name welded to its pseudonym.
  check("a name word of a longer value welded to anything is found",
    boundValueStands("JoséVelarde Decl", [{ real: "José García", fake: "Tomás Velarde" }]), true);
  check("scrubbedStem with nothing to scrub is the stem spaced", scrubbedStem("A_B-C", null), "A B C");
}

console.log("what the bar says");
{
  check("nothing marked", countLabel(0, 0), "Nothing marked.");
  check("one box on one page", countLabel(1, 1), "1 box on 1 page.");
  check("several", countLabel(7, 3), "7 boxes on 3 pages.");
}

console.log("the boxes held between now and the save");
{
  clearRedactions();
  const a = addRedaction(3, [{ x: 10, y: 10, w: 40, h: 10 }], { kind: "key", label: "Helen Rasho" });
  const b = addRedaction(3, [{ x: 10, y: 40, w: 40, h: 10 }], { kind: "area" });
  addRedaction(1, [{ x: 0, y: 0, w: 20, h: 20 }], { kind: "text" });
  check("counted by box and by page", redactionCount(), { boxes: 3, pages: 2 });
  check("the pages come back in order", redactionPages().map((p) => p.pageNumber), [1, 3]);
  check("a box remembers what it covers", redactionsFor(3)[0].label, "Helen Rasho");
  check("a box with no size is no box", addRedaction(5, [{ x: 0, y: 0, w: 0, h: 5 }]), null);
  check("…and files nothing", redactionsFor(5), []);
  ok("a box can be taken back off", removeRedaction(3, a.id));
  check("taking one off leaves the rest", redactionsFor(3).map((r) => r.id), [b.id]);
  check("taking off what is not there changes nothing", removeRedaction(3, 9999), false);
  clearRedactions("area");
  check("the key's boxes can be dropped on their own without touching the hand's",
    redactionCount(), { boxes: 1, pages: 1 });
  clearRedactions();
  check("and everything can go", redactionCount(), { boxes: 0, pages: 0 });
}

console.log("the words a redaction owes");
{
  check("a value is its significant words", valueWords("Zachary Coderre, Esq."), ["zachary", "coderre", "esq"]);
  check("a lone initial is not a word to chase", valueWords("Helen J. Rasho"), ["helen", "rasho"]);
  check("nothing is nothing", valueWords(""), []);
  // The rule, and the whole of it: what the run REPLACED is what must be
  // boxed. A word the fake carries through was never a thing to hide.
  check("a name owes its own words",
    wordsOwed("Zachary Coderre", "Rushton Greenhalgh"), ["zachary", "coderre"]);
  check("an honorific the fake carries through is owed nothing",
    wordsOwed("Zachary Coderre, Esq.", "Rushton, Greenhalgh, Esq."), ["zachary", "coderre"]);
  check("…and so is every word a name is built around",
    wordsOwed("Department of Quillmark", "Department of Melbury"), ["quillmark"]);
  check("no fake in hand, and every word is owed",
    wordsOwed("Helen Rasho", ""), ["helen", "rasho"]);
  check("a value the fake carries whole owes itself rather than nothing",
    wordsOwed("Esq.", "Esq."), ["esq"]);
}

console.log("what the boxes on a page cover");
{
  const claim = (real, fake) => ({ real, fake });
  // THE SPLIT-BOX CASE. The PDF's text broke the name, so the key's shorter
  // rows matched where the full one did not: two boxes, side by side, and the
  // whole name is black. That is the job done.
  check("a name boxed in pieces is a name boxed",
    coveredClaims([claim("Zachary Coderre", "Rushton Greenhalgh")], ["Zachary", "Coderre"]), [true]);
  check("…and in one piece, as usual",
    coveredClaims([claim("Zachary Coderre", "Rushton Greenhalgh")], ["Zachary Coderre"]), [true]);
  check("half a name is not a name boxed",
    coveredClaims([claim("Zachary Coderre", "Rushton Greenhalgh")], ["Zachary"]), [false]);
  check("nothing boxed, nothing covered",
    coveredClaims([claim("Zachary Coderre", "Rushton Greenhalgh")], []), [false]);

  // THE HONORIFIC CASE. "[redacted] [redacted] Esq." is a complete redaction.
  check("an Esq. left standing is not a miss",
    coveredClaims([claim("Zachary Coderre, Esq.", "Rushton, Greenhalgh, Esq.")], ["Zachary", "Coderre"]), [true]);
  check("…and the department is not a miss either",
    coveredClaims([claim("Department of Quillmark", "Department of Melbury")], ["Quillmark"]), [true]);

  // A box's words are spent once: two of a name on a page need two boxes.
  const two = [claim("Helen Rasho", "Strangeways Melbury"), claim("Helen Rasho", "Strangeways Melbury")];
  check("two occurrences, two boxes", coveredClaims(two, ["Helen Rasho", "Helen Rasho"]), [true, true]);
  check("two occurrences, one box — one is still standing",
    coveredClaims(two, ["Helen Rasho"]), [true, false]);
  check("…and the pieces of two count the same",
    coveredClaims(two, ["Helen", "Rasho", "Helen", "Rasho"]), [true, true]);

  // A drag that ran on past the name — over the comma after it, or the word
  // beside it — still covers the name: it is the words that are compared.
  check("a box that took the comma too still covers the name",
    coveredClaims([claim("Zachary Coderre", "Rushton Greenhalgh")], ["Zachary Coderre,"]), [true]);
  check("…and one that took the word beside it",
    coveredClaims([claim("Zachary Coderre", "Rushton Greenhalgh")], ["Zachary Coderre, Esq."]), [true]);
  check("…and one that took the name the other way round",
    coveredClaims([claim("Zachary Coderre", "Rushton Greenhalgh")], ["Coderre, Zachary"]), [true]);
  check("…and one that took the whole line",
    coveredClaims([claim("Zachary Coderre", "Rushton Greenhalgh")], ["Counsel of record: Zachary Coderre, Esq."]), [true]);

  // The longest claim is matched first, or the short one spends the word it
  // needed and the full name is reported unredacted.
  check("a bare surname does not steal the full name's word",
    coveredClaims([claim("Coderre", "Greenhalgh"), claim("Zachary Coderre", "Rushton Greenhalgh")],
      ["Zachary", "Coderre", "Coderre"]), [true, true]);
  check("…and where there is only one, the longer claim takes it",
    coveredClaims([claim("Coderre", "Greenhalgh"), claim("Zachary Coderre", "Rushton Greenhalgh")],
      ["Zachary", "Coderre"]), [false, true]);
}

console.log("the page's own box, for holding a match inside it");
{
  check("a letter page", pageBoxFromView([0, 0, 612, 792]), { x: 0, y: 0, w: 612, h: 792 });
  // A cropped page's box does not start at the origin, and a box is clamped
  // to the box the PDF states, not to the size it is displayed at.
  check("a box that does not start at the origin carries its offset",
    pageBoxFromView([20, 30, 632, 822]), { x: 20, y: 30, w: 612, h: 792 });
  check("no view, no box", pageBoxFromView(null), { x: 0, y: 0, w: 0, h: 0 });
}

console.log("a store per document, because a pane holds more than one");
{
  // The text reader's pane shows the pages of every member of a Combined
  // Text.txt at once. Page 3 of the motion is not page 3 of the reply.
  const motion = createRedactionStore();
  const reply = createRedactionStore();
  motion.add(3, [{ x: 10, y: 10, w: 40, h: 10 }], { kind: "key", label: "Helen Rasho" });
  reply.add(3, [{ x: 20, y: 20, w: 40, h: 10 }], { kind: "area" });
  check("each document counts only its own", motion.count(), { boxes: 1, pages: 1 });
  check("a box filed under one is not under the other", reply.for(3)[0].kind, "area");
  check("…and page 3 of one is not page 3 of the other", motion.for(3)[0].label, "Helen Rasho");
  reply.clear();
  check("clearing one leaves the other alone", motion.count(), { boxes: 1, pages: 1 });
  check("and the cleared one is empty", reply.count(), { boxes: 0, pages: 0 });
  // The default store the viewer's bare functions stand for is a store too,
  // and nothing either of these did reached it.
  clearRedactions();
  addRedaction(3, [{ x: 0, y: 0, w: 5, h: 5 }]);
  check("the viewer's own store is its own", redactionCount(), { boxes: 1, pages: 1 });
  check("…and holds only what was put in it", motion.count(), { boxes: 1, pages: 1 });
  clearRedactions();
}

// ── the file the save writes ──────────────────────────────────────────────────

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A `w`×`h` PNG of one flat colour — enough to be a page. */
function pngOf(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = r; raw[row + 2 + x * 3] = g; raw[row + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

console.log("the redacted copy is a document with nothing in it but pictures");
{
  const page = pngOf(8, 10, [255, 255, 255]);
  const bytes = await buildRedactedPdf({
    pages: [
      { bytes: page, format: "png", widthPts: 612, heightPts: 792 },
      { bytes: page, format: "png", widthPts: 400, heightPts: 300 },
    ],
  });
  const buf = Buffer.from(bytes);

  ok("it is a PDF", buf.subarray(0, 5).toString("latin1") === "%PDF-");

  // pdf-lib writes its objects into compressed object streams, so reading the
  // file as text would find nothing anywhere and every "no X" below would pass
  // for the wrong reason. Everything deflated in it is inflated first, and the
  // assertions are made against the whole of it, plain and inflated together.
  const readable = (() => {
    const parts = [buf.toString("latin1")];
    const raw = buf.toString("latin1");
    const re = /stream\r?\n/g;
    let m;
    while ((m = re.exec(raw))) {
      const from = m.index + m[0].length;
      const to = raw.indexOf("endstream", from);
      if (to < 0) continue;
      try { parts.push(zlib.inflateSync(buf.subarray(from, to)).toString("latin1")); }
      catch { /* an image, or not deflated — nothing to read out of it */ }
    }
    return parts.join("\n");
  })();
  ok("the inflating worked — the page objects are in there to be read",
    /\/Type\s*\/Page\b/.test(readable));

  check("no /Info dictionary — no author, no producer, no dates", /\/Info/.test(readable), false);
  check("no XMP packet either", /\/Metadata|<x:xmpmeta/.test(readable), false);
  check("nothing says what wrote it", /Producer|Creator|pdf-lib/i.test(readable), false);
  check("no font is embedded, because there is no text to set",
    /\/Font|\/BaseFont/.test(readable), false);
  check("no annotation survives", /\/Annots/.test(readable), false);
  check("no form", /\/AcroForm/.test(readable), false);
  ok("the pages are images", /\/Subtype\s*\/Image/.test(readable));

  // The content stream is the page's whole instruction list. A redacted page
  // draws one image and does nothing else — in particular it opens no text
  // object, which is what "no text layer" comes down to in a PDF.
  const { PDFDocument, PDFName, PDFArray } = await import("./viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
  // Loaded WITHOUT updateMetadata, because loading with it is pdf-lib stamping
  // its own Producer onto the document in memory — which would be this test
  // writing the very thing it is checking is not there.
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  check("two pages in, two pages out", doc.getPageCount(), 2);
  check("each page keeps the size its original had",
    doc.getPages().map((p) => [Math.round(p.getSize().width), Math.round(p.getSize().height)]),
    [[612, 792], [400, 300]]);

  const contents = doc.getPages().map((p) => {
    const ctx = p.node.context;
    const refs = p.node.lookup(PDFName.of("Contents"), PDFArray);
    const raw = Buffer.concat(refs.asArray().map((ref) => Buffer.from(ctx.lookup(ref).contents)));
    try { return zlib.inflateSync(raw).toString("latin1"); }
    catch { return raw.toString("latin1"); }
  });
  check("no page opens a text object", contents.some((c) => /\bBT\b/.test(c)), false);
  check("no page shows a glyph", contents.some((c) => /\bTj\b|\bTJ\b/.test(c)), false);
  ok("every page draws its image", contents.every((c) => /\bDo\b/.test(c)));

  check("read back, the document has no title, author, producer or creator",
    [doc.getTitle(), doc.getAuthor(), doc.getProducer(), doc.getCreator(),
     doc.getSubject(), doc.getKeywords()].map((v) => v || ""),
    ["", "", "", "", "", ""]);
  check("and no dates", [doc.getCreationDate(), doc.getModificationDate()]
    .map((v) => (v ? "set" : "")), ["", ""]);

  let threw = "";
  try { await buildRedactedPdf({ pages: [] }); } catch (e) { threw = e.message; }
  ok("a copy with no pages is refused rather than written", /at least one page/.test(threw));
}

console.log(`\n${"=".repeat(60)}\nFAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
