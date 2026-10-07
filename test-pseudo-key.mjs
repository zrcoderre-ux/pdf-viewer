// Node-runnable tests for the pseudonym key reader (viewer/pseudo-key.js).
// Run: node test-pseudo-key.mjs
//
// The rules are DeAnonymize.bas's and the Claude extension's; the checks here
// are the ones a wrong reading would silently break: columns by header name,
// keeps dropped, the pinned tab out of the reversal, an ambiguous fake retired,
// case mirrored, possessives carried, and the forward direction a save uses.

import {
  parseKey, compile, translate, translateRuns, compileForward, forwardRuns,
  compileReals, compileFakes, findReals, mirrorCase, caseShape, isKeyFileName, keySignature, sameCaseKey,
  compileTypeahead, endingReal, swapsOnSpace, findRealSpans, findRealSpansFrom, foldGaps, buildMatcher, buildFindMatcher,
  wordFakesOf, keyCellKind,
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
// "[Law]" on "Alder Law, P.C." keeps only PART of the value — PDF-Linker fakes
// "Alder" around it (`_pn_bracket_keep`) — so it is no keep of the whole and
// the row stays, marked, as an instruction (see "control words" below).
check("keeps dropped, counted", [key.dropped.keeps, key.dropped.controls], [2, 1]);
check("pairs: the alt row does not own, the ambiguous fake is retired", key.pairs.map((p) => p.fake + ">" + p.real).sort(),
  ["Ingrid Strangeways>Helen Rasho", "Sedgwick-Linford>Ardeshirpour-Zartoshti", "Strangeways>Rasho"]);
check("ambiguous count", key.dropped.ambiguous, 1);
check("hint is the most-used applied real", key.hint, "Rasho");
check("sheet named", key.sheet, "Pseudonym Key");
check("warn carries every real, alt spellings included", key.warn.length, 7);

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

// The other side of the same question: which PSEUDONYMS stand in a text. A
// keep on a value the run faked is work only a run can undo, and this is what
// says whether it did.
console.log("compileFakes: which pseudonyms stand");
{
  const rx = compileFakes(key);
  check("the fakes standing, distinct and first seen",
    findReals(rx, "Strangeways wrote; Ingrid Strangeways signed; Strangeways filed.").map((w) => w.fake),
    ["Strangeways", "Ingrid Strangeways"]);
  check("a possessive is the same pseudonym",
    findReals(rx, "Strangeways' declaration").map((w) => w.fake), ["Strangeways"]);
  check("wrapped at the margin, gutter number and all, it is still standing",
    findReals(rx, "Ingrid\n 9  Strangeways").map((w) => w.fake), ["Ingrid Strangeways"]);
  check("a text with no pseudonym in it", findReals(rx, "the moving papers say nothing").length, 0);
  check("the real name standing in the clear is not a pseudonym standing",
    findReals(rx, "Helen Rasho appeared").length, 0);
  check("no key, nothing to match", findReals(compileFakes(null), "anything").length, 0);
}

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
  {
    // The openings are read off the values themselves rather than by scanning
    // them all per real, so what counts as an opening is pinned: a word edge
    // inside a LONGER value, and nothing else.
    const edges = compileTypeahead(keyOf([
      ["person-token", "Helen", "Ingrid", "", "", "", 2],       // opens "Helen Rasho"
      ["person-token", "Helena", "Ingrida", "", "", "", 2],     // does NOT: "helena rasho" is another name
      ["person", "Helen Rasho", "Ingrid Strangeways", "", "", "", 2],
      ["entity", "Cross-River", "Alder-Vale", "", "", "", 2],   // a non-word edge that is not a space
      ["entity", "Cross-River Bank", "Alder-Vale Trust", "", "", "", 2],
    ]));
    const partial = Object.fromEntries(edges.map((w) => [w.real, w.partial]));
    check("openings: a word edge inside a longer value, and nothing else",
      [partial["Helen"], partial["Helena"], partial["Helen Rasho"], partial["Cross-River"], partial["Cross-River Bank"]],
      [true, false, false, true, false]);
  }
  check("a possessive rides the swap", (endingReal(ahead, "and Rasho's") || {}).fake, "Strangeways's");
  check("nothing at the end, nothing offered", endingReal(ahead, "Plaintiff Helen Rasho alleges"), null);
  check("inside a longer word, nothing", endingReal(ahead, "Rashomon Rasho, and Grasho"), null);
  check("the match is case-insensitive and reports what was typed", (endingReal(ahead, "HELEN RASHO") || {}).matched, "HELEN RASHO");
}

// ---- a name wrapped across numbered lines ----------------------------------
console.log("across lines");
{
  const c = compile(key), f = compileForward(key), r = compileReals(key);
  const wrapped = " 8  Plaintiff Ingrid\n 9  Strangeways moved.";
  const runs = translateRuns(c, wrapped);
  check("a fake wrapped over a gutter number is one name, shown as two pieces", runs.filter((x) => x.t === "swap").map((x) => x.from + ">" + x.to), ["Ingrid>Helen", "Strangeways>Rasho"]);
  check("the gutter number stays in the text between the pieces", runs.map((x) => x.t === "text" ? x.s : "*"), [" 8  Plaintiff ", "*", "\n 9  ", "*", " moved."]);
  check("each piece knows the whole", runs.filter((x) => x.t === "swap").map((x) => [x.whole.from, x.whole.to, x.piece, x.pieces]), [["Ingrid\n 9  Strangeways", "Helen Rasho", 0, 2], ["Ingrid\n 9  Strangeways", "Helen Rasho", 1, 2]]);
  check("a blank numbered line between the halves is crossed too", translateRuns(c, "Ingrid\n 9\n10  Strangeways").filter((x) => x.t === "swap").map((x) => x.to), ["Helen", "Rasho"]);
  check("a real wrapped the same way is written as its fake, line by line, the number kept", forwardRuns(f, "Helen\n 5  Rasho appeared").map((x) => x.t === "swap" ? x.to : x.s).join(""), "Ingrid\n 5  Strangeways appeared");
  check("case is read across the gap", translateRuns(c, "INGRID\n 9  STRANGEWAYS").filter((x) => x.t === "swap").map((x) => x.to), ["HELEN", "RASHO"]);
  const three = compileForward(keyOf([["entity", "Cross River Bank", "Thornfield", "", "", "", 1]]));
  check("word counts that differ: the whole replacement on the first line, nothing on the next", forwardRuns(three, "at Cross River\n 9  Bank today").map((x) => x.t === "swap" ? "[" + x.to + "]" : x.s).join(""), "at [Thornfield]\n 9  [] today");
  check("a number inside prose is not a gutter: no gap there, only the surname token", translateRuns(c, "Ingrid 9 Strangeways").filter((x) => x.t === "swap").map((x) => x.from), ["Strangeways"]);
  check("a wrapped real is found with its span", findRealSpans(r, "x Helen\n 5  Rasho y").map((x) => [x.start, x.end, x.real]), [[2, 17, "Helen Rasho"]]);
  check("foldGaps reads the gap as a space", foldGaps("Helen\n 5  Rasho"), "Helen Rasho");
}

// ---- a name wrapped inside a column ---------------------------------------------
//
// A caption's left-hand column wraps a name with the other column between its
// halves: "…; and QUARRY     )  Case No.", then "OPALRIDGE DOVEWOOD CASCADIA,"
// under it. The gap reading could not cross the ")" and the case number, so
// the name stood in its fake.
console.log("\ninside a column");
{
  const k = keyOf([
    ["person", "Jonathan Avery Smith Walker", "Quarry Opalridge Dovewood Cascadia", "", "", "", 5],
    ["person-token", "Walker", "Cascadia", "", "", "", 9],
    ["person", "Helen Rasho", "Ingrid Strangeways", "", "", "", 12],
  ]);
  const c = compile(k);
  const show = (t) => translateRuns(c, t).map((x) => x.t === "swap" ? "[" + x.from + ">" + x.to + "]" : x.s).join("");
  const swaps = (t) => translateRuns(c, t).filter((x) => x.t === "swap").map((x) => x.from + ">" + x.to + (x.whole ? " " + x.piece + "/" + x.pieces : ""));
  const L = (n, a, b) => String(n).padStart(2) + "  " + a.padEnd(50) + b;
  const caption = [
    L(10, "INGRID STRANGEWAYS, an individual; and QUARRY", ")  Case No.: 25STCV59720"),
    L(11, "OPALRIDGE DOVEWOOD CASCADIA, an", ")"),
    L(12, "individual,", ")  COMPLAINT FOR:"),
  ].join("\n");
  check("a caption's ')' column between the halves: one name, a piece per line",
    swaps(caption), ["INGRID STRANGEWAYS>HELEN RASHO", "QUARRY>JONATHAN 0/2", "OPALRIDGE DOVEWOOD CASCADIA>AVERY SMITH WALKER 1/2"]);
  check("…the other column, the line break and the number stay as they stand",
    translateRuns(c, caption).map((x) => x.t === "swap" ? x.from : x.s).join(""), caption);
  check("…the whole name rides on each piece",
    translateRuns(c, caption).filter((x) => x.whole).map((x) => foldGaps(x.whole.from)), ["QUARRY OPALRIDGE DOVEWOOD CASCADIA", "QUARRY OPALRIDGE DOVEWOOD CASCADIA"]);
  check("…counted once", translate(c, caption).count, 2);
  check("a box's bar between the halves",
    swaps(" 4  Plaintiff Quarry            │ Case No.\n 5  Opalridge Dovewood Cascadia,  │"), ["Quarry>Jonathan 0/2", "Opalridge Dovewood Cascadia>Avery Smith Walker 1/2"]);
  check("a wide blank before the other column",
    swaps(" 4  Plaintiff Quarry                Case No. 1\n 5  Opalridge Dovewood Cascadia,"), ["Quarry>Jonathan 0/2", "Opalridge Dovewood Cascadia>Avery Smith Walker 1/2"]);
  check("a name wrapped in the RIGHT-hand column, its rest under it there",
    swaps(L(4, "INGRID STRANGEWAYS,", ")  Plaintiff QUARRY") + "\n" + L(5, "", ")  OPALRIDGE DOVEWOOD CASCADIA")),
    ["INGRID STRANGEWAYS>HELEN RASHO", "QUARRY>JONATHAN 0/2", "OPALRIDGE DOVEWOOD CASCADIA>AVERY SMITH WALKER 1/2"]);
  const two = L(4, "the left column runs to Quarry", "Ingrid Strangeways said") + "\n" + L(5, "Opalridge Dovewood Cascadia went", "so on the right");
  check("the other column's name between the pieces is swapped where it stands",
    show(two), two.replace("Quarry", "[Quarry>Jonathan]").replace("Ingrid Strangeways", "[Ingrid Strangeways>Helen Rasho]").replace("Opalridge Dovewood Cascadia", "[Opalridge Dovewood Cascadia>Avery Smith Walker]"));
  const J = (n, a, b) => String(n).padStart(2) + "  " + a.padEnd(36) + "  " + b;
  check("a page in two columns two spaces apart, the lines beside it starting there too",
    swaps([J(4, "the left column ends on a Quarry", "the right column"), J(5, "Opalridge Dovewood Cascadia went on", "runs down here"), J(6, "and the left column goes on", "and so on")].join("\n")),
    ["Quarry>Jonathan 0/2", "Opalridge Dovewood Cascadia>Avery Smith Walker 1/2"]);
  check("two spaces after a full stop are no column: only the surname token",
    swaps(" 4  He sued Quarry  and others\n 5  Opalridge Dovewood Cascadia said."), ["Cascadia>Walker"]);
  check("down three lines of a column",
    swaps([L(10, "QUARRY", ")  Case"), L(11, "OPALRIDGE DOVEWOOD", ")  No."), L(12, "CASCADIA, an", ")  1")].join("\n")),
    ["QUARRY>JONATHAN 0/3", "OPALRIDGE DOVEWOOD>AVERY SMITH 1/3", "CASCADIA>WALKER 2/3"]);
  check("a blank numbered line between the halves is passed over",
    swaps([L(10, "and QUARRY", ")  Case"), "11", L(12, "OPALRIDGE DOVEWOOD CASCADIA", ")")].join("\n")),
    ["QUARRY>JONATHAN 0/2", "OPALRIDGE DOVEWOOD CASCADIA>AVERY SMITH WALKER 1/2"]);
  check("the rest indented past the column's start is not its rest",
    swaps([L(10, "and QUARRY", ")  Case"), L(11, "        OPALRIDGE DOVEWOOD CASCADIA", ")")].join("\n")), ["CASCADIA>WALKER"]);
  check("the rest in the other column is not its rest",
    swaps([L(10, "and QUARRY", ")  Case"), L(11, "", ")  OPALRIDGE DOVEWOOD CASCADIA")].join("\n")), ["CASCADIA>WALKER"]);
  check("the plain wrap is read as it always was",
    translateRuns(c, " 8  Plaintiff Ingrid\n 9  Strangeways moved.").map((x) => x.t === "text" ? x.s : "*"), [" 8  Plaintiff ", "*", "\n 9  ", "*", " moved."]);
  check("a forward pass not asked to is not read in columns",
    forwardRuns(compileForward(k), L(10, "and Jonathan", ")  Case") + "\n" + L(11, "Avery Smith Walker, an", ")")).filter((x) => x.t === "swap").map((x) => x.to), ["Cascadia"]);
  // A name swapped earlier on a line moves everything after it on that line,
  // the ")" with it: the column the ")" draws is followed by the mark, not by
  // where the mark happens to stand.
  check("the column a ')' draws is followed by the ')', wherever a swap has moved it",
    swaps(" 4  INGRID STRANGEWAYS, an individual,   )  Plaintiff QUARRY\n 5  and others,                 )  OPALRIDGE DOVEWOOD CASCADIA"),
    ["INGRID STRANGEWAYS>HELEN RASHO", "QUARRY>JONATHAN 0/2", "OPALRIDGE DOVEWOOD CASCADIA>AVERY SMITH WALKER 1/2"]);
}

// ---- a REAL name wrapped inside a column: the leak, and the save ---------------
//
// The same column, the other way: a real name the run missed, wrapped down a
// caption's left-hand column. The marks read the text with the run's fakes,
// the keeps and the cited names blanked out of it, so the column is read off
// the text as it stands (`layout`), and a blank where a fake was is no column.
console.log("\na real name inside a column");
{
  const k = keyOf([
    ["person", "Jonathan Avery Smith Walker", "Quarry Opalridge Dovewood Cascadia", "", "", "", 5],
    ["person-token", "Walker", "Cascadia", "", "", "", 9],
    ["person", "Helen Rasho", "Ingrid Strangeways", "", "", "", 12],
  ]);
  const r = compileReals(k), f = compileForward(k);
  const L = (n, a, b) => String(n).padStart(2) + "  " + a.padEnd(50) + b;
  const caption = [
    L(10, "Ingrid Strangeways, an individual; and Jonathan", ")  Case No.: 25STCV59720"),
    L(11, "Avery Smith Walker, an", ")"),
    L(12, "individual,", ")  COMPLAINT FOR:"),
  ].join("\n");
  const spans = (t, o) => findRealSpans(r, t, o).map((h) => [h.real, h.ranges.map(([a, b]) => t.slice(a, b))]);
  check("without columns, only the surname token is a leak", spans(caption), [["Walker", ["Walker"]]]);
  check("with columns, the whole name, a piece per cell",
    spans(caption, { columns: true }), [["Jonathan Avery Smith Walker", ["Jonathan", "Avery Smith Walker"]]]);
  const h = findRealSpans(r, caption, { columns: true })[0];
  check("…its start and end take in the other column between the pieces",
    [caption.slice(h.start, h.start + 8), caption.slice(h.end - 6, h.end), caption.slice(h.start, h.end).includes("Case No.")], ["Jonathan", "Walker", true]);
  check("findReals reads it the same way", findReals(r, caption, { columns: true }).map((w) => w.real), ["Jonathan Avery Smith Walker"]);
  // The fake on the first line blanked to spaces, as the marks and the save
  // read the page: the blank is the matcher's, the column is the file's.
  const fakeAt = caption.indexOf("Ingrid Strangeways");
  const blanked = caption.slice(0, fakeAt) + " ".repeat(18) + caption.slice(fakeAt + 18);
  check("read off the layout, a blanked fake moves no column",
    spans(blanked, { layout: caption }), [["Jonathan Avery Smith Walker", ["Jonathan", "Avery Smith Walker"]]]);
  // A blank where a fake stood is not a column of its own: "Jonathan" before
  // a fake, the rest of the name at the start of the next line, is two things.
  const before = " 4  signed by Jonathan Ingrid Strangeways and\n 5  Avery Smith Walker came";
  const fk = before.indexOf("Ingrid");
  const gone = before.slice(0, fk) + " ".repeat(18) + before.slice(fk + 18);
  check("a fake blanked out of the reading is no column to cross",
    spans(gone, { layout: before }), [["Walker", ["Walker"]]]);
  check("…though the same text read as its own layout would have cut one there",
    spans(gone, { columns: true }).map((x) => x[0]), ["Jonathan Avery Smith Walker"]);
  const kept = caption.replace("Jonathan", "\u0000".repeat(8));
  check("a kept word blanked at the end of the cell is no name crossing out of it", spans(kept, { layout: caption }), [["Walker", ["Walker"]]]);
  check("a handful at a time, the same names in the same places",
    (() => {
      const text = [caption, caption, caption].join("\n");
      const all = findRealSpans(r, text, { columns: true }).map((x) => x.ranges.join(";"));
      const got = [];
      for (let at = 0; ;) {
        const { spans: s, next } = findRealSpansFrom(r, text, at, 1, { columns: true });
        for (const x of s) got.push(x.ranges.join(";"));
        if (next < 0) break;
        at = next;
      }
      return [got.length, JSON.stringify(got) === JSON.stringify(all)];
    })(), [3, true]);
  const fw = forwardRuns(f, caption, { layout: caption }).map((x) => x.t === "swap" ? x.to : x.s).join("");
  check("the save writes it as its fake, a piece per cell, the other column where it stands",
    fw, caption.replace("Ingrid Strangeways", "Ingrid Strangeways").replace("Jonathan", "Quarry").replace("Avery Smith Walker", "Opalridge Dovewood Cascadia"));
  check("…and nothing of the name is left for the reals to find", findReals(r, fw, { columns: true }).map((w) => w.real), []);
}

// ---- a key of thousands of names -------------------------------------------------
//
// One alternation over every value was two disasters at a few thousand of
// them: half a megabyte of pattern, which the engine accepts and then refuses
// to RUN (thrown the first time anything is matched against it, which was
// inside the first document opened, so the file never opened at all), and,
// where it did run, an attempt per name at every word of the document. The
// values are filed under their first word now. What they find may not change.
console.log("\na key of thousands of names");
{
  const names = ["Helen Rasho", "Marcus Delacroix", "Cross River Bank", "Rasho", "Quillmark LLC", "Ingrid Strangeways"];
  const filler = [];
  for (let i = 0; i < 4000; i++) filler.push(`Alder Vale Holdings ${i}`);
  const values = names.concat(filler);
  const big = buildMatcher(values);
  const text = "  Plaintiff Helen Rasho and Cross River Bank's agent, Alder Vale Holdings 3712, met Marcus Delacroix.\n"
    + " 7  Ingrid\n 8  Strangeways signed for Quillmark LLC, and Rasho left.";
  const found = [];
  big.lastIndex = 0;
  for (let m; (m = big.exec(text));) { found.push(m[0]); if (m.index === big.lastIndex) big.lastIndex++; }
  check("a key of four thousand names matches instead of throwing",
    found, ["Helen Rasho", "Cross River Bank's", "Alder Vale Holdings 3712", "Marcus Delacroix", "Ingrid\n 8  Strangeways", "Quillmark LLC", "Rasho"]);
  check("…the longest name at a place still wins over the short one inside it",
    found.includes("Helen Rasho") && !found.includes("Rasho Rasho"), true);
  check("…test answers, and leaves no place behind it",
    [big.test("about Marcus Delacroix today"), big.test("nobody here"), big.lastIndex], [true, false, 0]);
  check("…and a replace over it covers every match",
    "Helen Rasho met Marcus Delacroix".replace(big, (m) => "·".repeat(m.length)),
    "··········· met ················");
  // The same answers a single regex gives, name for name: the small matcher
  // over the same values is one regex, so the two can be compared directly.
  const small = buildMatcher(names);
  const lines = [
    "Helen Rasho signed", "Rasho alone", "Cross River Bank's demand", "no names at all here",
    "Marcus Delacroix and Helen Rasho", "Ingrid\n 4  Strangeways wrapped", "Quillmark LLC, Rasho",
  ];
  const run = (rx, s) => { const out = []; rx.lastIndex = 0; for (let m; (m = rx.exec(s));) { out.push(m.index + ":" + m[0]); if (m.index === rx.lastIndex) rx.lastIndex++; } return out; };
  check("indexed by first word, it answers as one regex over each value does",
    lines.map((l) => run(big, l).filter((x) => !/Alder/.test(x))), lines.map((l) => run(small, l)));
  {
    // A WALK over a long text, which is what reading a document is: the words
    // are read once across it, not once per name found, and what comes out is
    // what a matcher of one value at a time gives.
    const long = Array.from({ length: 400 }, (_, i) =>
      ` ${(i % 28) + 1}  Plaintiff Helen Rasho and Marcus Delacroix met Cross River Bank about Alder Vale Holdings ${i}.`).join("\n");
    const found = run(big, long);
    check("a walk over four hundred lines finds every name",
      [found.length, found.filter((x) => /Helen Rasho/.test(x)).length], [1600, 400]);
    check("…and the walk agrees with a one-value matcher throughout",
      found.filter((x) => !/Alder/.test(x)), run(small, long));
  }
  {
    // And what it costs. A key's names begin with all sorts of words, so the
    // word in front of the reader picks out a handful to try: the work is the
    // document's length, not the document times the key. (The shape above —
    // four thousand names all beginning "Alder" — is the one that cannot be
    // told apart by a first word, and it is the slow one by construction.)
    const spread = [];
    for (let i = 0; i < 4000; i++) spread.push(`Vendor${i} Holdings ${i}`);
    const wide = buildMatcher(spread.concat(["Helen Rasho"]));
    const page = Array.from({ length: 28 }, (_, l) =>
      ` ${l + 1}  Plaintiff Helen Rasho alleges that Vendor${l * 7} Holdings ${l * 7} signed the guaranty and has not paid.`).join("\n");
    const doc = Array.from({ length: 150 }, () => page).join("\n");
    const t = Date.now();
    const hits = run(wide, doc);
    const ms = Date.now() - t;
    check("a hundred and fifty pages under a key of four thousand names", hits.length, 150 * 28 * 2);
    check("…read in well under a second", ms < 900, true);
    if (ms >= 900) console.log(`        (it took ${ms} ms)`);
  }
}


// ---- the matcher, against a matcher of one value at a time -----------------------
//
// buildMatcher indexes the values by their first word and tries only the few
// filed under the word in front of it. What it must give back is what ONE
// alternation over every value gave: the leftmost match, and at the same place
// the longest value. A matcher of a single value is still one plain regex, so
// a walk made of those — leftmost, then longest, then on past it — is the
// oracle, built from nothing but the same public function.
console.log("\nthe matcher, value by value");
{
  const oracle = (values, text) => {
    const each = values.map((v) => ({ v, rx: buildMatcher([v]) }));
    const out = [];
    let at = 0;
    for (;;) {
      let best = null;
      for (const { rx } of each) {
        rx.lastIndex = at;
        const m = rx.exec(text);
        if (!m) continue;
        if (!best || m.index < best.index || (m.index === best.index && m[0].length > best[0].length)) best = m;
      }
      if (!best) return out;
      out.push(best.index + ":" + best[0]);
      at = best.index + (best[0].length || 1);
    }
  };
  const walk = (rx, text) => {
    const out = [];
    rx.lastIndex = 0;
    for (let m; (m = rx.exec(text));) {
      out.push(m.index + ":" + m[0]);
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
    return out;
  };

  const VALUES = [
    "Helen", "Helen Rasho", "Helena Rasho", "Rasho", "Rasho's", "Cross-River Bank",
    "Alder Law, P.C.", "O'Brien", "Deverell5", "quenby3@postbox9.org", "Strangeways Ltd",
    "McDonald", "Cal", "ANGELA WHITE", "Ardeshirpour- Zartoshti", "'Quoted Name'",
  ];
  const TEXTS = [
    "Plaintiff Helen Rasho and Helen alone, with Helena Rasho elsewhere.",
    "HELEN RASHO sued; helen rasho answered; Helen   Rasho replied.",
    "Helen\n 4  Rasho wrapped over the gutter, and Cross-River\n 5  Bank did too.",
    "Rasho's brief, RASHO'S reply, and Rasho’s motion.",
    "Served at quenby3@postbox9.org by Deverell5 of Alder Law, P.C.",
    "O'Brien and McDonald for Strangeways Ltd; Cal is short.",
    "'Quoted Name' opened the matter, then Helen Rasho closed it.",
    "Nothing here but ordinary words about a guaranty.",
    "Rashox is not Rasho, and Helenas are not Helen.",
    "Ardeshirpour- Zartoshti signed, as did Ardeshirpour-Zartoshti.",
    "Helen Rasho Helen Rasho Helen Rasho back to back.",
    "  ",
  ];
  const big = buildMatcher(VALUES);
  let same = 0, diff = 0;
  for (const t of TEXTS) {
    const got = walk(big, t), want = oracle(VALUES, t);
    if (JSON.stringify(got) === JSON.stringify(want)) same++;
    else { diff++; check(`same answers on ${JSON.stringify(t.slice(0, 40))}`, got, want); }
  }
  check("every text reads the same as a walk of one-value matchers", [same, diff], [TEXTS.length, 0]);

  // …and on a key too big to have been one alternation at all.
  const many = VALUES.slice();
  for (let i = 0; i < 3000; i++) many.push(`Party ${i} Holdings`);
  const huge = buildMatcher(many);
  const text = "Party 1742 Holdings served Helen Rasho, and Party 2 Holdings' agent replied.";
  check("a key of three thousand reads the same", walk(huge, text), oracle(many, text));
  check("…and finds nothing where there is nothing", walk(huge, "a quiet line with no names in it"), []);
  check("test and replace agree with it",
    [huge.test("about Helen Rasho today"), huge.test("nobody here"),
     "Helen Rasho met Party 7 Holdings".replace(huge, (m) => "·".repeat(m.length))],
    [true, false, "··········· met ················"]);
}

// ---- reading a document in handfuls ----------------------------------------------
//
// A Word export has no page headers, so the whole of it is ONE page: read a
// page at a time it is never put down, and the reader holds the thread until
// the browser offers to kill it. Read in handfuls it can stop anywhere, and
// what it finds may not change for being read that way.
console.log("\nin handfuls");
{
  const k = keyOf([
    ["person", "Helen Rasho", "Ingrid Strangeways", "", "", "", 9],
    ["person-token", "Rasho", "Strangeways", "", "", "", 9],
    ["entity", "Cross River Bank", "Alder Vale Trust", "", "", "", 9],
  ]);
  const reals = compileReals(k);
  const text = Array.from({ length: 200 }, (_, i) =>
    ` ${(i % 28) + 1}  Helen Rasho and Cross River Bank and Rasho again, line ${i}.`).join("\n");
  const whole = findRealSpans(reals, text);
  const byHand = [];
  let at = 0, rounds = 0;
  for (;;) {
    const { spans, next } = findRealSpansFrom(reals, text, at, 7);
    byHand.push(...spans);
    rounds++;
    if (next < 0) break;
    at = next;
  }
  check("a handful at a time finds what one pass finds", byHand, whole);
  check("…and it took more than one handful to do it", rounds > 10, true);
  check("…a handful of one works too", (() => {
    const one = []; let a = 0;
    for (;;) { const r = findRealSpansFrom(reals, text, a, 1); one.push(...r.spans); if (r.next < 0) break; a = r.next; }
    return one.length;
  })(), whole.length);
  check("no key, no text: nothing and nowhere to carry on from",
    [findRealSpansFrom(null, text, 0, 5), findRealSpansFrom(reals, "", 0, 5)],
    [{ spans: [], next: -1 }, { spans: [], next: -1 }]);
}

// ---- a value carrying a RUN of blank ------------------------------------------
//
// A key holds what the run captured, and what the run captured is sometimes a
// name standing in two columns of a caption or wrapped at the margin: "Set"
// and "Hepworth" a line break and fifty-two spaces apart. Every space in a
// value used to become a gap of its own, and a gap is a `+` over whitespace —
// so a dozen of them in a row reading ONE run of blank is every way of cutting
// that run into a dozen pieces. Each extra space quadrupled the work, and the
// operator's key held one that took the sweep two minutes on one declaration.
console.log("\na value carrying a run of blank");
{
  const k = keyOf([
    ["person", "Real Name", "Set    Hepworth", "", "", "", 9],
    ["person", "Other Name", "Quenby Vale", "", "", "", 9],
  ]);
  const fakes = compileFakes(k);
  const names = (t) => findReals(fakes, t).map((w) => w.real);
  check("the run is a gap: the words one space apart", names("the matter was Set Hepworth on Tuesday"), ["Real Name"]);
  check("…any run of blank between them", names("the matter was Set      Hepworth on Tuesday"), ["Real Name"]);
  check("…and a line break with the gutter number after it",
    names("the matter was Set\n 9  Hepworth on Tuesday"), ["Real Name"]);
  check("a value whose OWN run holds a line break reads the same",
    findReals(compileFakes(keyOf([["person", "R", "Set\n            Hepworth", "", "", "", 9]])),
      "the matter was Set Hepworth on Tuesday").map((w) => w.real), ["R"]);
  check("a word that is not the value is still not found", names("the matter was Set Quenby on Tuesday"), []);
  check("…and the other value still is", names("Quenby Vale appeared"), ["Other Name"]);

  // The guard: a page of pleading paper whose blank columns stand right after
  // the value's first word — the shape that made it exponential.
  const page = ("15  the matter was Set                          | CASE NO. 24STZV98883\n").repeat(200);
  const deep = compileFakes(keyOf([["person", "R", "Set        Hepworth", "", "", "", 9]]));
  const t0 = Date.now();
  findReals(deep, page);
  const ms = Date.now() - t0;
  check(`eight spaces in the value read a page of columns in ${ms} ms, not seconds`, ms < 500, true);
}

// ---- the find bar's matcher, and Match case ----------------------------------
console.log("find matcher");
{
  const hits = (rx, s) => (s.match(rx) || []);
  const text = "The Court held. COURT OF APPEAL. the court below.";
  check("case is ignored by default", hits(buildFindMatcher(["court"]), text), ["Court", "COURT", "court"]);
  check("Match case finds only what is written that way", hits(buildFindMatcher(["Court"], { caseSensitive: true }), text), ["Court"]);
  check("…for every needle, the fake's face included", hits(buildFindMatcher(["Rasho", "Melbury"], { caseSensitive: true }), "Rasho, RASHO, Melbury, melbury"), ["Rasho", "Melbury"]);
  check("a phrase still reads across a numbered line under Match case", hits(buildFindMatcher(["Superior Court"], { caseSensitive: true }), "the Superior\n 3  Court held"), ["Superior\n 3  Court"]);
  check("part of a word is found either way", hits(buildFindMatcher(["our"], { caseSensitive: true }), "Court, OUR court"), ["our", "our"]);
  check("nothing to look for, no matcher", buildFindMatcher(["  "], { caseSensitive: true }), null);
}

console.log("a fake that is an ordinary word");
{
  // An older PDF-Linker cut "We" for the surname "Dax" off the front of a
  // longer name's fake, and composed "Ilse Dax" -> "Delacroix We" from it.
  const k = keyOf([
    ["person-token", "Dax", "We", "…", "", "document", 9],
    ["person", "Ilse Dax", "Delacroix We", "…", "", "spreadsheet", 4],
    ["person-token", "Ilse", "Delacroix", "…", "", "spreadsheet", 4],
  ]);
  check("retired from the display, and said", [k.pairs.some((p) => p.fake === "We"), k.wordFakes, k.dropped.words],
    [false, [{ fake: "We", real: "Dax" }], 1]);
  const t = translate(compile(k), "We respectfully submit that we and Delacroix We agree.").text;
  check("every 'we' reads as written; the composed name still reverses whole", t, "We respectfully submit that we and Ilse Dax agree.");
  check("…and a real name typed is still written as the key says", forwardRuns(compileForward(k), "Dax signed.").filter((r) => r.t === "swap").map((r) => r.to), ["We"]);
  // A key parsed and kept in the library before the rule: its pairs carry the word.
  const old = { ...k, wordFakes: undefined, pairs: k.pairs.concat([{ fake: "We", real: "Dax" }]) };
  check("a key kept from before is guarded too", [wordFakesOf(old), translate(compile(old), "we agree").text], [[{ fake: "We", real: "Dax" }], "we agree"]);
  check("an ordinary key has none", wordFakesOf(keyOf([["person", "Helen Rasho", "Ingrid Strangeways", "", "", "", 1]])), []);
}

// ---- control words in the Replacement cell ---------------------------------------
//
// The key's Replacement column takes the worksheet's control words: the
// operator types "~Rasho" over a misspelling's stand-in, "*Strangeways" over a
// scan error's, "phrase", "(Cross River Bank)", "[Law]", and the cell sits in
// the key until the next full run. Read as pseudonyms, a save wrote "~Rasho"
// for "Rashoe" — the canonical real name, inside a pseudonym span that the
// marks and the save's last check never look into. PDF-Linker reads every one
// of them as no binding (`_pn_key_reverse_pairs`), and so does the reader now:
// a whole-value keep is dropped, every other instruction keeps its real MARKED
// and is never reversed, forwarded or offered.
console.log("control words in the Replacement cell");
{
  const kinds = (cells, real) => cells.map((c) => keyCellKind(c, real));
  check("no, n and never keep the whole value", kinds(["no", "N", " never "], "Rashoe"), ["keep", "keep", "keep"]);
  check("yes, y and phrase are instructions", kinds(["yes", "Y", "PHRASE"], "Rashoe"), ["control", "control", "control"]);
  check("a misspelling, the old alias mark, a scan error, a durable one",
    kinds(["~Rasho", "=Rasho", "*Strangeways", "**Strangeways", "~", "*David {said}"], "Rashoe"),
    ["control", "control", "control", "control", "control", "control"]);
  check("Excel's error text, and any cell opening with #", kinds(["#NAME?", "#SPILL!", "#GETTING_DATA", "#4"], "Rashoe"),
    ["control", "control", "control", "control"]);
  check("a phrase part, in the value or not", kinds(["(Cross River Bank)", "(Lakeshore)"], "Cross River Bank Tower"), ["control", "control"]);
  check("keep-specs: the whole value kept is a keep, a part kept is an instruction",
    kinds(["[Alder Law, P.C.]", "{Alder} [Law, P.C.]", "[Law]", "{Law}", "[Alder] Law", "Alder {Law}"], "Alder Law, P.C."),
    ["keep", "keep", "control", "control", "control", "control"]);
  check("a keep-spec naming text the value does not hold is no pseudonym either",
    kinds(["[Lawyer]", "Quill {Esq}"], "Alder Law, P.C."), ["control", "control"]);
  // `_pn_keep_spec_parts` hands the cut the [bracketed] parts first and the
  // {braced} ones after, whatever order they were typed in; taken as typed,
  // "{Law}" went first, took the "Law" of "Law Firm", and "[Law Firm]" was no
  // longer in what was left — a value PDF-Linker keeps whole, marked here.
  check("brackets are cut before braces, as PDF-Linker cuts them",
    kinds(["{Law} [Law Firm]", "[Law Firm] {Law}", "{Law} [Firm]"], "Law Firm Law"), ["keep", "keep", "control"]);
  check("a pseudonym is a pseudonym, brackets inside a name or not",
    kinds(["Strangeways", "Ingrid Strangeways", "Smith (Jr.)", "Deverell5", "quenby3@postbox9.org", "O'Hara-Vale"], "Rashoe"),
    ["fake", "fake", "fake", "fake", "fake", "fake"]);
  check("an empty cell is nothing", keyCellKind("  ", "Rashoe"), "");

  const k = keyOf([
    ["person", "Helen Rasho", "Ingrid Strangeways", "", "replaced", "spreadsheet", 12],
    ["person-token", "Rasho", "Strangeways", "", "replaced", "spreadsheet", 30],
    ["person-token", "Helen", "Ingrid", "", "replaced", "spreadsheet", 14],
    ["person-token", "Rashoe", "~Rasho", "", "leaked", "document", 1],
    ["person", "Helen Rashoe", "~Helen Rasho", "", "leaked", "document", 1],
    ["person-token", "Rasbo", "*Rasho", "", "leaked", "document", 1],
    ["entity", "Cross River Bank Tower", "(Cross River Bank)", "", "replaced", "", 2],
    ["person", "Odile Varnum", "#NAME?", "", "replaced", "", 2],
    ["person-token", "Quillon", "n", "", "replaced", "", 2],
    ["entity", "Alder Law, P.C.", "Alder {Law}", "", "replaced", "", 2],
    ["person", "Dana Okafor", "phrase", "", "replaced", "", 2],
    ["person", "Rashoe's", "~Rasho's", "", "leaked", "document", 1],
  ]);
  check("only the pseudonyms reverse", k.pairs.map((p) => p.fake + ">" + p.real).sort(),
    ["Ingrid Strangeways>Helen Rasho", "Ingrid>Helen", "Strangeways>Rasho"]);
  check("the keep is dropped, the instructions counted", [k.dropped.keeps, k.dropped.controls], [1, 8]);
  check("every instruction's real is still bound, with no fake and the cell as `control`",
    k.warn.filter((w) => w.control).map((w) => [w.real, w.fake, w.control]),
    [["Rashoe", "", "~Rasho"], ["Helen Rashoe", "", "~Helen Rasho"], ["Rasbo", "", "*Rasho"],
      ["Cross River Bank Tower", "", "(Cross River Bank)"], ["Odile Varnum", "", "#NAME?"],
      ["Alder Law, P.C.", "", "Alder {Law}"], ["Dana Okafor", "", "phrase"], ["Rashoe's", "", "~Rasho's"]]);
  check("the kept value binds nothing", k.warn.some((w) => w.real === "Quillon"), false);
  check("a possessive instruction derives no bare row of its own",
    keyOf([["person", "Zachary's", "~Zackary's", "", "leaked", "", 1]]).warn.map((w) => w.real), ["Zachary's"]);

  // The save: what the verifier's sentence wrote before was "~Rasho and
  // *Rasho met #Name? at (Cross River Bank)…". Now nothing is written for any
  // of them, and every one is still there to be marked and refused.
  const text = "Rashoe and Rasbo met Odile Varnum at Cross River Bank Tower; Quillon and Dana Okafor of Alder Law, P.C. agreed with Rasho.";
  const out = forwardRuns(compileForward(k), text);
  check("a save writes no instruction, and fakes only the pseudonyms",
    out.filter((r) => r.t === "swap").map((r) => r.from + ">" + r.to), ["Rasho>Strangeways"]);
  check("every instruction's real stands to be marked; the kept one is not marked",
    findReals(compileReals(k), text).map((w) => w.real + (w.control ? " [" + w.control + "]" : "")),
    ["Rashoe [~Rasho]", "Rasbo [*Rasho]", "Odile Varnum [#NAME?]", "Cross River Bank Tower [(Cross River Bank)]",
      "Dana Okafor [phrase]", "Alder Law, P.C. [Alder {Law}]", "Rasho"]);
  check("on screen, the word 'phrase' and a stray '~Rasho' are only what they say",
    translate(compile(k), "the phrase used; ~Rasho; n of section 2").text, "the phrase used; ~Rasho; n of section 2");
  check("an instruction is no pseudonym standing", findReals(compileFakes(k), "~Rasho said phrase").length, 0);

  // HALF SCRUBBED. "Helen" is bound and "Helen Rashoe" holds an instruction:
  // read through its own shorter word, the save wrote "Ingrid Rashoe", and with
  // the longer name gone from the text nothing was left to mark or refuse.
  const fw = compileForward(k);
  check("a name holding an instruction is never written through its shorter words",
    forwardRuns(fw, "Helen Rashoe signed; Helen wrote; HELEN RASHOE'S reply").map((r) => r.t === "swap" ? "[" + r.to + "]" : r.s).join(""),
    "Helen Rashoe signed; [Ingrid] wrote; HELEN RASHOE'S reply");
  check("…and is marked whole", findReals(compileReals(k), "Helen Rashoe signed").map((w) => w.real), ["Helen Rashoe"]);

  const ahead = compileTypeahead(k);
  check("nothing offers an instruction as you type", ahead.filter((e) => !e.fake).length, 0);
  check("…and an instruction typed out is offered nothing", endingReal(ahead, "Plaintiff Rashoe"), null);
  check("…and the shorter name it opens is partial, so Space types on toward it", (endingReal(ahead, "Plaintiff Helen") || {}).partial, true);

  // Which wins where one value has both: the applied sheet over the pinned,
  // and on one sheet the instruction, typed over that value's stand-in.
  const both = parseKey([
    sheet("Pseudonym Key", [
      ["person-token", "Rashoe", "Strangeways", "", "replaced", "", 2],
      ["person", "Rashoe", "~Rasho", "", "leaked", "", 1],
      ["person", "Vela Quist", "~Vela Quiste", "", "leaked", "", 1],
    ]),
    sheet("Pinned (never in text)", [["person", "Vela Quist", "Marlow Kestrel", "", "", "", 0], ["person", "Odile Varnum", "phrase", "", "", "", 0]]),
  ]);
  check("one sheet: the instruction stands; applied over pinned either way",
    both.warn.map((w) => [w.real, w.fake, w.control || "", w.pinned]),
    [["Rashoe", "", "~Rasho", false], ["Vela Quist", "", "~Vela Quiste", false], ["Odile Varnum", "", "phrase", true]]);
  check("…and nothing of either is forwarded", forwardRuns(compileForward(both), "Rashoe, Vela Quist, Odile Varnum").filter((r) => r.t === "swap").length, 0);

  // A key parsed before this rule and kept in the library: its pairs and its
  // warning rows carry the instruction as the fake, and its `dropped` has no
  // `controls` count. It answers as a fresh parse.
  const old = {
    ...k,
    dropped: { keeps: 0, ambiguous: 0, words: 0, pinned: 0 },
    pairs: k.pairs.concat([{ fake: "~Rasho", real: "Rashoe" }, { fake: "phrase", real: "Dana Okafor" }, { fake: "#NAME?", real: "Odile Varnum" }]),
    warn: [
      { real: "Rasho", fake: "Strangeways", pinned: false },
      { real: "Rashoe", fake: "~Rasho", pinned: false },
      { real: "Dana Okafor", fake: "phrase", pinned: false },
      { real: "Quillon", fake: "n", pinned: false },
    ],
  };
  check("a key kept from before: no instruction reverses",
    translate(compile(old), "~Rasho and the phrase and #NAME?").text, "~Rasho and the phrase and #NAME?");
  check("…none is written", forwardRuns(compileForward(old), "Rashoe and Dana Okafor and Quillon").filter((r) => r.t === "swap").length, 0);
  check("…the instructions' reals are still marked, the old keep is not",
    findReals(compileReals(old), "Rashoe and Dana Okafor and Quillon").map((w) => [w.real, w.fake, w.control]),
    [["Rashoe", "", "~Rasho"], ["Dana Okafor", "", "phrase"]]);
  check("…nothing is offered or counted as a pseudonym standing",
    [compileTypeahead(old).map((e) => e.real), findReals(compileFakes(old), "~Rasho phrase n").length], [["Rasho"], 0]);
  check("…while a key this build parsed is taken as it stands, its count saying so",
    [typeof k.dropped.controls, typeof old.dropped.controls], ["number", "undefined"]);
  // …and its ordinary-word fakes, where "n" or "yes" typed over a stand-in was
  // listed as one, and the reader's toast told the operator a full run would
  // give "Quillon" a stand-in in place of "n".
  check("a key kept from before names no instruction as an ordinary-word fake",
    wordFakesOf({ ...old, wordFakes: [{ fake: "n", real: "Quillon" }, { fake: "yes", real: "Odile Varnum" }, { fake: "We", real: "Dax" }] }),
    [{ fake: "We", real: "Dax" }]);
  check("…and a fresh parse lists none", keyOf([
    ["person-token", "Quillon", "n", "", "replaced", "", 2],
    ["person", "Odile Varnum", "yes", "", "replaced", "", 2],
    ["person-token", "Dax", "We", "", "", "document", 9],
  ]).wordFakes, [{ fake: "We", real: "Dax" }]);
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
