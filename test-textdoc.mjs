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
  addValue, removeValue, formatValuesFile, parseValuesFile, parseReaderFile, addKeep, removeKeep, keptControl, flagProblem,
  isExportName, isKeyName, isQuarantinedName, normalizeSettings, fontCss, VALUES_FILE,
} from "./viewer/textdoc.js";
import { parseKey, compileForward } from "./viewer/pseudo-key.js";

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
check("lineLock is remembered and defaults off", [normalizeSettings({}).lineLock, normalizeSettings({ lineLock: true }).lineLock, normalizeSettings({ lineLock: "yes" }).lineLock], [false, true, false]);

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
check("both halves read back", parseReaderFile(both), { values: list, keeps });
check("parseValuesFile ignores the keeps", parseValuesFile(both), list);
check("flag: nothing selected", flagProblem("  ", false) !== "", true);
check("flag: a pseudonym", flagProblem("Strangeways", true) !== "", true);
check("flag: a passage", flagProblem("x".repeat(200), false) !== "", true);
check("flag: a name", flagProblem("Rosa Delgado", false), "");

// ---- folder listing ------------------------------------------------------------------
console.log("folder");
check("exports", ["Brief.txt", "Brief.txt.LEAK", "Reply.TXT"].map(isExportName), [true, true, true]);
check("tool artifacts are not documents", ["LEAKS.txt", "Combined Text.txt", "Authorities Cited.txt", "New Real Values.txt", "ETA 12-30 (3 files).txt", "DONE 12-45.txt", "pdf_linker.log"].map(isExportName), [false, false, false, false, false, false, false]);
check("quarantine", isQuarantinedName("Brief.txt.LEAK"), true);
check("key name", [isKeyName("pseudonym_key.xlsx"), isKeyName("pseudonym_key (1).xlsx"), isKeyName("Order 2024.xlsx")], [true, true, false]);

// ---- settings ------------------------------------------------------------------------------
console.log("settings");
const s = normalizeSettings({ font: "nope", fontSize: 200, lineHeight: "x", marks: false });
check("bad settings fall back", [s.font, s.fontSize, s.lineHeight, s.marks], ["georgia", 40, 1.5, false]);
const mk = normalizeSettings({ markColor: "#0000FF", markAlpha: 5 });
check("highlight colour normalised and intensity bounded", [mk.markColor, mk.markAlpha], ["#0000ff", 0.9]);
check("a bad colour falls back", normalizeSettings({ markColor: "blue" }).markColor, "#f5c518");
check("markCss", markCss({ markColor: "#ff0000", markAlpha: 0.2 }), { bg: "rgba(255, 0, 0, 0.200)", hover: "rgba(255, 0, 0, 0.500)", ring: "rgba(255, 0, 0, 0.120)" });
check("custom font css", fontCss(normalizeSettings({ font: "custom", customFont: "Baskerville, serif" })), "Baskerville, serif");
check("empty custom falls back to the first preset", fontCss(normalizeSettings({ font: "custom", customFont: " " })), "Georgia, 'Times New Roman', serif");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
