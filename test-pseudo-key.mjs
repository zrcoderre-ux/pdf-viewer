// Node-runnable tests for the pseudonym key reader (viewer/pseudo-key.js).
// Run: node test-pseudo-key.mjs
//
// The rules are DeAnonymize.bas's and the Claude extension's; the checks here
// are the ones a wrong reading would silently break: columns by header name,
// keeps dropped, the pinned tab out of the reversal, an ambiguous fake retired,
// case mirrored, possessives carried, and the forward direction a save uses.

import {
  parseKey, compile, translate, translateRuns, compileForward, forwardRuns,
  compileReals, findReals, mirrorCase, caseShape, isKeyFileName, keySignature, sameCaseKey,
  compileTypeahead, endingReal, swapsOnSpace,
} from "./viewer/pseudo-key.js";

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

const HEADERS = ["Category", "Real Value", "Replacement", "Context", "Status", "Source", "Occurrences"];
const sheet = (name, rows) => ({ name, rows: [HEADERS].concat(rows) });
const keyOf = (rows, extra) => parseKey([sheet("Pseudonym Key", rows)].concat(extra || []), "pseudonym_key.xlsx");

console.log("parseKey");
const key = keyOf([
  ["person", "Helen Rasho", "Ingrid Strangeways", "…", "", "spreadsheet", 12],
  ["person-token", "Rasho", "Strangeways", "…", "", "spreadsheet", 30],
  ["entity", "Cal", "no", "", "", "", 0],
  ["entity", "Labor", "never", "", "", "", 0],
  ["entity", "Alder Law, P.C.", "[Law]", "", "", "", 0],
  ["person-token", "Ardeshirpour- Zartoshti", "Sedgwick-Linford", "", "alt spelling", "spreadsheet", 1],
  ["person-token", "Ardeshirpour-Zartoshti", "Sedgwick-Linford", "", "", "spreadsheet", 4],
  ["person", "Angela White", "Marlow Kestrel", "", "", "prescan", 2],
  ["person", "Angie White", "Marlow Kestrel", "", "", "prescan", 1],
]);
check("keeps dropped, counted", key.dropped.keeps, 3);
check("pairs: the alt row does not own, the ambiguous fake is retired", key.pairs.map((p) => p.fake + ">" + p.real).sort(),
  ["Ingrid Strangeways>Helen Rasho", "Sedgwick-Linford>Ardeshirpour-Zartoshti", "Strangeways>Rasho"]);
check("ambiguous count", key.dropped.ambiguous, 1);
check("hint is the most-used applied real", key.hint, "Rasho");
check("sheet named", key.sheet, "Pseudonym Key");
check("warn carries every real, alt spellings included", key.warn.length, 6);

const colOrder = parseKey([{ name: "Key", rows: [["Replacement", "Real Value"], ["Strangeways", "Rasho"]] }]);
check("columns by header name, any order", colOrder.pairs, [{ fake: "Strangeways", real: "Rasho" }]);

const pinned = parseKey([
  sheet("Pseudonym Key", [["person", "Helen Rasho", "Ingrid Strangeways", "", "", "", 3]]),
  sheet("Pinned (never in text)", [["person", "John Doe", "Yorke Deverell", "", "", "", 0], ["person", "Helen Rasho", "Other Fake", "", "", "", 0]]),
]);
check("pinned rows reverse nothing", pinned.pairs, [{ fake: "Ingrid Strangeways", real: "Helen Rasho" }]);
check("pinned rows still forward-map, and the applied fake wins", pinned.warn.map((w) => w.real + ">" + w.fake), ["Helen Rasho>Ingrid Strangeways", "John Doe>Yorke Deverell"]);

const poss = keyOf([["person", "Zachary's", "John's", "", "", "", 1]]);
check("a possessive row derives its bare form", poss.pairs.map((p) => p.fake + ">" + p.real).sort(), ["John's>Zachary's", "John>Zachary"]);

console.log("translate");
const c = compile(key);
check("longest first, case mirrored", translate(c, "INGRID STRANGEWAYS sued. Strangeways lost; ingrid strangeways.").text,
  "HELEN RASHO sued. Rasho lost; helen rasho.");
check("possessive carried", translate(c, "Strangeways's brief and STRANGEWAYS'S reply").text, "Rasho's brief and RASHO'S reply");
check("whole words only", translate(c, "Strangewaysx").text, "Strangewaysx");
check("a name wrapped over a gutter line still matches", translate(c, "Ingrid\n 3  Strangeways").count, 1);
check("a space run matches too", translate(c, "Ingrid   Strangeways").text, "Helen Rasho");
check("runs", translateRuns(c, "Dear Strangeways, hi"), [{ t: "text", s: "Dear " }, { t: "swap", from: "Strangeways", to: "Rasho" }, { t: "text", s: ", hi" }]);
check("no key: one text run", translateRuns(compile(null), "abc"), [{ t: "text", s: "abc" }]);
check("mixed case left as stored", mirrorCase("McDonald", "Cross River Bank, LLC"), "Cross River Bank, LLC");
check("caseShape", ["ABC", "abc", "Abc Def", "McD"].map(caseShape), ["upper", "lower", "title", "mixed"]);

console.log("forward");
const f = compileForward(key);
check("real → fake for a save", forwardRuns(f, "Plaintiff HELEN RASHO and Rasho's counsel"),
  [{ t: "text", s: "Plaintiff " }, { t: "swap", from: "HELEN RASHO", to: "INGRID STRANGEWAYS" }, { t: "text", s: " and " }, { t: "swap", from: "Rasho's", to: "Strangeways's" }, { t: "text", s: " counsel" }]);
check("the alt spelling forwards too", forwardRuns(f, "Ardeshirpour- Zartoshti")[0].to, "Sedgwick-Linford");
check("the kept value is not a real to forward", forwardRuns(f, "Cal Labor").length, 1);
check("findReals distinct, first seen", findReals(compileReals(key), "Rasho, Rasho, Helen Rasho").map((w) => w.real), ["Rasho", "Helen Rasho"]);

console.log("identity");
check("file name", [isKeyFileName("pseudonym_key.xlsx"), isKeyFileName("pseudonym key (2).xlsx"), isKeyFileName("x.xlsx")], [true, true, false]);
check("signature is order-free", keySignature(key) === keySignature({ pairs: key.pairs.slice().reverse() }), true);
const grown = keyOf([
  ["person", "Helen Rasho", "Ingrid Strangeways", "", "", "", 12],
  ["person-token", "Rasho", "Strangeways", "", "", "", 30],
  ["person-token", "Ardeshirpour-Zartoshti", "Sedgwick-Linford", "", "", "", 4],
  ["person", "New Party", "Fresh Fake", "", "", "", 1],
]);
check("a re-run's key is the same case", sameCaseKey(key, grown), true);
check("another case is not", sameCaseKey(key, keyOf([["person", "A B", "C D", "", "", "", 1]])), false);

// ---- the as-you-type prompt --------------------------------------------------
console.log("typeahead");
{
  const ahead = compileTypeahead(key);
  check("longest real first", ahead[0].real.length >= ahead[ahead.length - 1].real.length, true);
  const whole = endingReal(ahead, "Plaintiff Helen Rasho");
  check("the name just typed is offered, with its fake", whole && [whole.real, whole.fake, whole.matched, whole.partial], ["Helen Rasho", "Ingrid Strangeways", "Helen Rasho", false]);
  const two = compileTypeahead(keyOf([["person", "Helen Rasho", "Ingrid Strangeways", "", "", "", 2], ["person-token", "Helen", "Ingrid", "", "", "", 2]]));
  const first = endingReal(two, "Plaintiff Helen");
  check("a real that opens a longer one is partial", first && [first.real, first.partial], ["Helen", true]);
  check("…and the longer one, once finished, is whole", (endingReal(two, "Plaintiff Helen Rasho") || {}).partial, false);
  check("space swaps a whole name and not a partial", [swapsOnSpace(whole), swapsOnSpace(first), swapsOnSpace(null)], [true, false, false]);
  const kept = compileTypeahead(keyOf([["person-token", "Helen", "Ingrid", "", "", "", 2]]), ["Helen Rasho"]);
  check("a real that opens a KEPT value is partial too", (endingReal(kept, "Helen") || {}).partial, true);
  check("a possessive rides the swap", (endingReal(ahead, "and Rasho's") || {}).fake, "Strangeways's");
  check("nothing at the end, nothing offered", endingReal(ahead, "Plaintiff Helen Rasho alleges"), null);
  check("inside a longer word, nothing", endingReal(ahead, "Rashomon Rasho, and Grasho"), null);
  check("the match is case-insensitive and reports what was typed", (endingReal(ahead, "HELEN RASHO") || {}).matched, "HELEN RASHO");
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
