// Node-runnable tests for the boxes an export draws (viewer/rules.js).
// The measuring and the setting need a page; the column grid does not, and
// that is where a rule is kept straight or left with a step in it: every rule
// glyph of a page, its boxes' rows and its lines of rules alone, on one grid.
// Run: node test-rules.mjs

import { pageGrid, ruleCell } from "./viewer/rules.js";

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
const r1 = (v) => Math.round(v * 10) / 10;
/** Each row's bars, and its runs as page px, read back off a grid: what a page would draw. */
const drawn = (g) => g.rows.map((r) => {
  const left = (i) => (i ? r.bars[i - 1] + 1 : 0);
  return { bars: r.bars.map(r1), runs: r.runs.flatMap((rs, i) => rs.map(([a, b]) => [r1(left(i) + a), r1(left(i) + b)])) };
});
/** A row of text cells with these needs between bars at these offsets. */
const row = (bars, needs) => ({ bars, cells: needs.map((need) => ({ need })) });

console.log("a cell's text read for the grid");
{
  check("a cell of spaces alone is blank", ruleCell("     ", 4), { blank: true });
  check("a cell of rules and spaces is its runs, in the line's offsets", ruleCell("   ────  ──", 10), { runs: [[13, 17], [19, 21]] });
  check("any other cell is where its text begins, and the spaces it opens with", ruleCell("  ATTORNEY OR PARTY   ", 6), { lead: 2, t: 8 });
  check("…a rule glyph in among text is text", ruleCell(" Date: ────", 0), { lead: 1, t: 1 });
}

console.log("one box's rows on one column grid");
{
  // An MC-350EX caption: rows of two columns, then a notice whose rows run the
  // whole width — and one notice line long enough that PDF-Linker pushed its
  // closing bar two characters out.
  const rows = [row([5, 95, 146], [4, 190, 90, 0]), row([5, 95, 146], [4, 150, 60, 0]), row([5, 146], [4, 300, 0]), row([5, 148], [4, 305, 0]), row([5, 146], [4, 120, 0])];
  const g = drawn(pageGrid(rows));
  check("every row's first bar stands in one column", g.map((r) => r.bars[0]), [4, 4, 4, 4, 4]);
  check("every row's last bar stands in one column, the bar two characters out among them", g.map((r) => r.bars[r.bars.length - 1]), [310, 310, 310, 310, 310]);
  check("the inner column is the widest cell that ends there, a pixel past its bar", g[0].bars[1], 195);
  check("…and a wide row past it pushes only the column it reaches", g[1].bars, [4, 195, 310]);
}

console.log("a bar stands at its column whatever number of bars come before it");
{
  // CIV-110: the caption's foot (bars at 0, 93 and 141) over the notice's
  // first row (0 and 141). Each bar is a pixel wide, and a row with one more
  // of them in front of its last bar drew that bar a pixel further out — a
  // step down the box's side where the two rows met.
  const g = pageGrid([{ bars: [0, 93, 141], cells: [{}, { runs: [[1, 93]] }, { runs: [[94, 141]] }, {}] }, row([0, 141], [0, 400, 0])], { place: (o) => o * 3 });
  check("the right side is one x in both rows", g.rows.map((r) => r.bars[r.bars.length - 1]), [423, 423]);
  const w = g.rows[0].widths;
  check("…the cells and the bars before it add up to it", w[0] + 1 + w[1] + 1 + w[2], 423);
}

console.log("what the grid will not merge");
{
  check("two of one row's own bars are never one column, however close",
    pageGrid([row([0, 2], [0, 40, 0])]).rows[0].bars, [0, 41]);
  check("bars further apart than the slop are columns of their own",
    pageGrid([row([0, 20], [0, 50, 0]), row([0, 30], [0, 80, 0])]).rows.map((r) => r.bars), [[0, 51], [0, 81]]);
  check("the slop is the caller's to set",
    pageGrid([row([0, 20], [0, 50, 0]), row([0, 30], [0, 80, 0])], { slop: 10 }).rows.map((r) => r.bars), [[0, 81], [0, 81]]);
  check("a column is counted from its first offset, so a run of near ones does not chain into one",
    pageGrid([row([10], [0, 0]), row([12], [0, 0]), row([14], [0, 0]), row([16], [0, 0])], { place: (o) => o * 5 }).rows.map((r) => r.bars[0]), [50, 50, 70, 70]);
}

console.log("on the page's character grid: each column at its place, further only where a cell needs it");
{
  // CIV-110's caption on the export's grid read back off the PDF (x0 + column
  // × unit): bars at columns 0, 93 and 141 down the caption, at 0 and 141
  // through the notice under it.
  const unit = 3.758, place = (o) => o * unit;
  const rows = [row([0, 93, 141], [0, 160, 70, 0]), row([0, 93, 141], [0, 90, 20, 0]), row([0, 141], [0, 480, 0])];
  const g = pageGrid(rows, { place });
  check("every bar stands at its column's place", g.rows[0].bars.map(r1), [0, 349.5, 529.9]);
  check("…the same right edge for the notice, which has no inner bar", r1(g.rows[2].bars[1]), 529.9);
  check("a cell wider than its place pushes its column out, a pixel past the bar before it",
    pageGrid([row([0, 10], [0, 80, 0])], { place: (o) => o * 4 }).rows[0].bars, [0, 81]);
  check("a first cell the grid sets further in stands each row's first bar at ITS column — two boxes, one under the other's side",
    pageGrid([row([110, 158], [200, 120, 0]), row([0, 110, 158], [0, 0, 0, 0]), row([0, 158], [0, 300, 0])], { place: (o) => o * 3.6 }).rows.map((r) => r.bars.map(r1)),
    [[396, 568.8], [0, 396, 568.8], [0, 568.8]]);
  check("a place that cannot be read is no place: the cells' own widths",
    pageGrid([row([0, 10], [0, 25, 0])], { place: () => NaN }).rows[0].bars, [0, 26]);
}

console.log("no column past the page's type");
{
  // SUM-100's notice, widened by PDF-Linker for its small type: the grid puts
  // its closing bar past the PDF's rule, where the page's form number and page
  // count end (534 from the box's left).
  const place = (o) => o * 3.6;
  const rows = [row([110, 158], [200, 120, 0]), row([0, 158], [0, 300, 0])];
  check("a column further than the slack past the type stands at the type's edge",
    pageGrid(rows, { place, reach: 534 }).rows.map((r) => r.bars.map(r1)), [[396, 534], [0, 534]]);
  check("…one within the slack stands at its place (a form whose type stops short of its box's side)",
    r1(pageGrid(rows, { place, reach: 566, slack: 3.6 }).rows[1].bars[1]), 568.8);
  check("…and a cell wider than the type reaches still pushes its column out",
    pageGrid([row([0, 100], [0, 350, 0])], { place: (o) => o * 4, reach: 300 }).rows[0].bars, [0, 351]);
}

console.log("a rule's runs drawn where the grid puts its ends");
{
  const place = (o) => o * 4;
  // A separate statement's row rule: "────┼────" between two text rows whose
  // divider stands at 30. The left half ran from the rule row's own indent and
  // the right half to its own end; each half is drawn from bar to bar.
  const rows = [
    row([30], [100, 0]),
    { bars: [30], cells: [{ runs: [[4, 30]] }, { runs: [[31, 60]] }] },
    row([30], [90, 0]),
  ];
  const g = drawn(pageGrid(rows, { place }));
  check("the divider is one x in every row", g.map((r) => r.bars[0]), [120, 120, 120]);
  check("the left half runs from its column to the bar, the right from the bar's far side to its column", g[1].runs, [[16, 120], [121, 240]]);
  // A box's top rule, a divider under the box, and a signature line: the box's
  // bars at 0, 93 and 141; the divider's ends at 0 and 141; the signature
  // line's at 93 and 142 — a character past the box's side, the same edge.
  const page = [
    { bars: [0, 93, 141], cells: [{}, { runs: [[1, 93]] }, { runs: [[94, 141]] }, {}] },
    row([0, 93, 141], [0, 200, 100, 0]),
    { bars: [], cells: [{ runs: [[0, 141]] }] },
    { bars: [], cells: [{ runs: [[0, 70], [93, 142]] }] },
  ];
  const p = drawn(pageGrid(page, { place: (o) => o * 3 }));
  check("a divider spanning a box's columns spans the box, over its bars' own pixels", p[2].runs, [[0, 424]]);
  check("…the box's top rule, with its corners, the same", [p[0].bars[0], p[0].runs[1][1] + 1], [0, 424]);
  check("a signature line under the box's right column runs from its inner bar to its side", p[3].runs[1], [279, 424]);
  check("…and one ending in the open, at its column's place", p[3].runs[0], [0, 210]);
  check("a run's free end is a column like a bar's: nothing pushes past it", pageGrid([{ bars: [], cells: [{ runs: [[10, 12], [13, 20]] }] }]).rows[0].runs[0], [[0, 1], [2, 3]]);
}

console.log("edges");
{
  check("no rows, nothing to place", pageGrid([]), { X: [], rows: [] });
  check("a row of one bar has a cell before it and a cell after", pageGrid([row([5], [3, 9])]).rows[0].widths, [3, 9]);
  check("a missing or unmeasured width counts as nothing",
    pageGrid([row([0, 10], [undefined, NaN, 0]), row([0, 10], [2, 60, 0])]).rows.map((r) => r.bars), [[2, 63], [2, 63]]);
  check("a line of rules alone with a run at its very start", drawn(pageGrid([{ bars: [], cells: [{ runs: [[0, 5]] }] }], { place: (o) => o * 2 }))[0].runs, [[0, 10]]);
}

console.log(`\n${"=".repeat(60)}\nFAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
