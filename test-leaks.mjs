// Node-runnable tests for the LEAKS worksheet model (viewer/leaks.js).
// Run: node test-leaks.mjs
//
// The worksheet is read by header name and answered by the exact text of
// its Fix? cell, so the two things pinned here are that a row comes back
// with the columns PDF-Linker writes wherever they stand, and that a cell
// is classified the way `_pn_parse_decision_rows` will read it.

import {
  isLeaksName, leaksRank, headerIndex, sheetsLookLikeLeaks, leaksSheet, parseLeaks, classifyFix, isKeepKind,
  parseWhere, parseFiles, splitContext, matchExport, undecidedCount, nextUndecided, fixEdits,
  packDecisions, unpackDecisions, decisionsKey, CONTEXT_RULE,
} from "./viewer/leaks.js";
import { parseKey, compileForward, forwardRuns } from "./viewer/pseudo-key.js";

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

console.log("names");
check("the worksheet by name, copies included, the legacy name too",
  ["LEAKS.xlsx", "leaks.xlsx", "LEAKS (1).xlsx", "LEAKS - Copy.xlsx", "pdf_linker_leaks.xlsx", "C:\\case\\LEAKS.xlsx", "LEAKS.txt", "pseudonym_key.xlsx", "MyLEAKS.xlsx"].map(isLeaksName),
  [true, true, true, true, true, true, false, false, false]);
check("the current name ranks first", [leaksRank("LEAKS.xlsx"), leaksRank("pdf_linker_leaks.xlsx")], [0, 1]);

console.log("reading the sheet");
const HEAD = ["Value", "Fix? (yes/no)", "Context", "File", "Type", "Where (page:line)", "Notes"];
const ROWS = [
  HEAD,
  ["Helen Rasho", "", "served on Helen Rasho at\n" + CONTEXT_RULE + "\nserved on Helen Rasho at", "Rasho v Quillmark - MTC.pdf", "LEAK", "p.4:7-8, p.9:12", ""],
  ["Vazqez", "~Vazquez", "Vazqez signed", "Guaranty.pdf, Complaint.pdf", "misspelled name?", "p.43 (printed p.1):16", "pre-filled: reads as a misspelling of 'Vazquez' — leave it to accept"],
  ["", "yes", "", "", "", "", ""],
  ["Old Thing", "yes", "", "—", "(decided)", "(no longer present)", ""],
];
const SHEETS = [{ name: "Notes", part: "xl/worksheets/sheet2.xml", rows: [["just", "text"]] }, { name: "LEAKS", part: "xl/worksheets/sheet1.xml", rows: ROWS }];
check("the header row is found", headerIndex(ROWS), 0);
check("a workbook reads as a worksheet only with the header", [sheetsLookLikeLeaks(SHEETS), sheetsLookLikeLeaks([SHEETS[0]])], [true, false]);
check("the LEAKS sheet is picked by name over an earlier tab", leaksSheet(SHEETS).name, "LEAKS");
const parsed = parseLeaks(SHEETS, "LEAKS.xlsx");
check("columns by header", parsed.cols, { value: 0, fix: 1, context: 2, file: 3, type: 4, where: 5, notes: 6 });
check("the part is carried for the writer", [parsed.sheet, parsed.part], ["LEAKS", "xl/worksheets/sheet1.xml"]);
check("rows carry their sheet row number; an empty value is skipped", parsed.rows.map((r) => [r.n, r.value, r.fix, r.type]),
  [[2, "Helen Rasho", "", "LEAK"], [3, "Vazqez", "~Vazquez", "misspelled name?"], [5, "Old Thing", "yes", "(decided)"]]);
{
  // Columns in another order (an operator dragged one), a title row above the header.
  const moved = [["My notes"], ["Fix? (yes/no)", "Notes", "Value", "Where (page:line)"], ["yes", "n", "Rasho", "p.2:3"]];
  const p = parseLeaks([{ name: "Sheet1", rows: moved }], "x.xlsx");
  check("header-name driven: a reordered sheet still reads", p.rows.map((r) => [r.n, r.value, r.fix, r.notes, r.where]), [[3, "Rasho", "yes", "n", "p.2:3"]]);
  check("a missing column reads as empty", p.rows[0].context, "");
}
{
  let err = "";
  try { parseLeaks([{ name: "Sheet1", rows: [["a", "b"]] }], "notes.xlsx"); } catch (e) { err = e.message; }
  check("not a worksheet: refused by name", /notes\.xlsx has no "Value"/.test(err), true);
}

console.log("what a Fix? cell means");
const kinds = (cells, value) => cells.map((c) => classifyFix(c, value).kind);
check("the control words, and their shorthands", kinds(["", "yes", "Y", "no", "n", "NEVER", "phrase"], "Cross River Bank"), ["", "yes", "yes", "no", "no", "never", "phrase"]);
check("an alias, either mark, with or without a keep-spec", kinds(["~Vazquez", "=Vazquez", "~David {said}"], "avidsaid"), ["alias", "alias", "alias"]);
check("…and it names the canonical", [classifyFix("~Vazquez", "Vazqez").canon, classifyFix("~David {said}", "avidsaid").canon, classifyFix("~David {said}", "avidsaid").parts], ["Vazquez", "David", ["said"]]);
check("a scan error, once or remembered", [classifyFix("*Smith", "Smlth"), classifyFix("**San Diego", "SanDiega")].map((c) => [c.kind, c.canon, !!c.durable]), [["ocr", "Smith", false], ["ocr", "San Diego", true]]);
check("a keep-spec that fits keeps; one that does not is a literal replacement", kinds(["[Human Resources]", "{Law}", "[Nobody]"], "Alder Law, P.C."), ["replacement", "keep", "replacement"]);
check("a keep of the whole value says so", classifyFix("[Alder Law, P.C.]", "Alder Law, P.C.").label, "keep the whole value");
check("a phrase part", [classifyFix("(Cross River Bank)", "Cross River Bank Tower").kind, classifyFix("(Nowhere)", "Cross River Bank Tower").kind], ["phrase-part", "replacement"]);
check("Excel's error text is no instruction", classifyFix("#NAME?", "x").kind, "error");
check("anything else is the replacement", [classifyFix("Rathmore Symington", "Marcus Delacroix").kind, classifyFix("yes please", "x").kind], ["replacement", "replacement"]);
check("the keeps the reader mirrors", ["no", "never", "yes", "keep", ""].map(isKeepKind), [true, true, false, false, false]);

console.log("locating");
check("Where: pages, lines, ranges, a printed page, a wrap onto the next page, a Word line", parseWhere("p.4:7-8, p.9, p.43 (printed p.1):16, p.7:27-p.8:1, line 12-14, (not located), p.2:3 …"),
  [{ page: 4, printed: null, line: 7, lineEnd: 8 }, { page: 9, printed: null, line: null, lineEnd: null }, { page: 43, printed: "1", line: 16, lineEnd: null },
   { page: 7, printed: null, line: 27, lineEnd: 1 }, { page: null, printed: null, line: 12, lineEnd: 14 }, { page: 2, printed: null, line: 3, lineEnd: null }]);
check("Where: sentinels yield nothing", [parseWhere("(no longer present)"), parseWhere(""), parseWhere("(not located)")], [[], [], []]);
check("File: names, or nothing to open", [parseFiles("A.pdf, B v C.docx"), parseFiles("4 files"), parseFiles("—"), parseFiles(""), parseFiles("Brief.pdf")], [["A.pdf", "B v C.docx"], [], [], [], ["Brief.pdf"]]);
check("Context: the two halves, or the original alone", [splitContext("a\n" + CONTEXT_RULE + "\nb"), splitContext("only"), splitContext("")], [{ original: "a", exported: "b" }, { original: "only", exported: "" }, { original: "", exported: "" }]);
{
  const key = parseKey([{ name: "Pseudonym Key", rows: [["Real Value", "Replacement"], ["Rasho", "Strangeways"], ["Quillmark", "Melbury"]] }], "pseudonym_key.xlsx");
  const fwd = compileForward(key);
  const forward = (s) => forwardRuns(fwd, s).map((r) => (r.t === "swap" ? r.to : r.s)).join("");
  const docs = ["Strangeways v Melbury - MTC.txt", "Order.txt", "Reply.txt.LEAK"];
  check("a File name reaches its export through the key", matchExport("Rasho v Quillmark - MTC.pdf", docs, forward), "Strangeways v Melbury - MTC.txt");
  check("…a bare stem too, a Word file too, a quarantined export too", [matchExport("Order.docx", docs, forward), matchExport("Reply.pdf", docs, null)], ["Order.txt", "Reply.txt.LEAK"]);
  check("no match, no export", matchExport("Nothing.pdf", docs, forward), null);
}

console.log("working the rows");
const rows = parsed.rows.map((r) => Object.assign({}, r));
check("undecided rows counted", undecidedCount(rows), 1);
check("next undecided wraps, and is -1 when none", [nextUndecided(rows, 2), nextUndecided(rows, 0), nextUndecided(rows, null), nextUndecided([{ fix: "yes" }], 0)], [0, 0, 0, -1]);
check("…backwards too", nextUndecided(rows, 0, -1), 0);
rows[0].fix = "no";
rows[2].fix = "";
check("only the rows that moved are written, to the Fix? column, by sheet row", fixEdits({ cols: parsed.cols, rows }), [{ row: 2, col: 1, text: "no" }, { row: 5, col: 1, text: "" }]);
const packed = packDecisions(rows);
check("unsaved decisions remembered with the cell they replace", packed, { 2: { base: "", fix: "no" }, 5: { base: "yes", fix: "" } });
{
  const fresh = parseLeaks(SHEETS, "LEAKS.xlsx").rows;
  check("laid back over a sheet that has not moved", [unpackDecisions(fresh, packed), fresh.map((r) => r.fix)], [2, ["no", "~Vazquez", ""]]);
  const changed = parseLeaks(SHEETS, "LEAKS.xlsx").rows;
  changed[0].fix0 = changed[0].fix = "never"; // Excel decided it since
  check("…but never over a cell somebody typed since", [unpackDecisions(changed, packed), changed[0].fix], [1, "never"]);
}
check("the store key names folder and file", decisionsKey("Rasho v Quillmark", "LEAKS.xlsx"), "textReader.leaks.Rasho v Quillmark/LEAKS.xlsx");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
