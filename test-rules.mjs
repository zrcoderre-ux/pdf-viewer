// Node-runnable tests for the boxes an export draws (viewer/rules.js).
// The measuring and the setting need a page; the column grid does not, and
// that is where a box is squared up or left with a step in its side.
// Run: node test-rules.mjs

import { ruleGrid } from "./viewer/rules.js";

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

console.log("one box's rows on one column grid");
{
  // An MC-350EX caption: nine rows of two columns, then a notice whose rows
  // run the whole width — and one notice line long enough that PDF-Linker
  // pushed its closing bar two characters out.
  const rows = [[5, 95, 146], [5, 95, 146], [5, 146], [5, 148], [5, 146]];
  const widths = [[4, 190, 90, 0], [4, 150, 60, 0], [4, 300, 0], [4, 305, 0], [4, 120, 0]];
  const { lead, spans } = ruleGrid(rows, widths);
  check("the lead is one width for every row, so the first bars stand together", lead, 4);
  check("every row ends at the same column, the widest cell that reaches it", spans.map((s) => s.reduce((a, b) => a + b, 0)), [305, 305, 305, 305, 305]);
  check("a bar two characters out is the same rule, not a column of its own", spans[3], [305]);
  check("the inner column is the widest cell that ends there, and a wide row past it pushes only the column it reaches", spans[0], [190, 115]);
  check("a row with no bar at the inner column spans it", spans[2], [305]);
}

console.log("what the grid will not merge");
{
  check("two of one row's own bars are never one column, however close",
    ruleGrid([[0, 2]], [[0, 40, 0]]).spans, [[40]]);
  check("bars further apart than the slop are columns of their own",
    ruleGrid([[0, 20], [0, 30]], [[0, 50, 0], [0, 80, 0]]).spans, [[50], [80]]);
  check("the slop is the caller's to set",
    ruleGrid([[0, 20], [0, 30]], [[0, 50, 0], [0, 80, 0]], 10).spans, [[80], [80]]);
}

console.log("beside its PDF, the bars where the PDF's grid puts them");
{
  // CIV-110's caption: bars at columns 0, 93 and 141 down the caption, at 0
  // and 141 through the notice under it; the export's grid read back off the
  // PDF (x0 + column × unit) puts them at 0, 349.5 and 529.9 from the box's
  // left. The labels in the caption need far less, the notice a little more.
  const unit = 3.758;
  const place = (o) => o * unit;
  const rows = [[0, 93, 141], [0, 93, 141], [0, 141]];
  const widths = [[0, 160, 70, 0], [0, 90, 20, 0], [0, 480, 0]];
  const { lead, spans } = ruleGrid(rows, widths, undefined, place);
  check("every bar stands at its column's place on the grid", [lead, spans[0][0], lead + spans[0][0] + spans[0][1]].map((v) => +v.toFixed(1)), [0, 349.5, 529.9]);
  check("…the same right edge for the notice that has no inner bar", +(lead + spans[2][0]).toFixed(1), 529.9);
  check("a cell wider than the grid gives still pushes its column out",
    ruleGrid([[0, 10]], [[0, 80, 0]], undefined, (o) => o * 4).spans, [[80]]);
  check("a first cell the grid sets further in leads every row in",
    ruleGrid([[5, 20], [5, 20]], [[3, 30, 0], [2, 40, 0]], undefined, (o) => o * 4), { lead: 20, heads: [20, 20], spans: [[60], [60]] });
  check("a place that cannot be read is no place", ruleGrid([[0, 10]], [[0, 25, 0]], undefined, () => NaN).spans, [[25]]);
  check("…and without one the grid is the cells' own, as before (the notice's width sets the right edge)",
    ruleGrid(rows, widths), { lead: 0, spans: [[160, 320], [160, 320], [480]] });
}

console.log("beside its PDF, two boxes in one stack, and no bar past the page's type");
{
  // SUM-100's top: the court's box (bars at 110 and 158) beside the caption's
  // labels, the notice under it (0 and 158, its top rule meeting the court
  // box's foot at 110), the case number's box (90 and 158) under that. The
  // notice is in small type, and PDF-Linker widened its box to hold it: the
  // grid puts the closing bar past the PDF's rule, where the page's type (its
  // form number, its page count) ends, at 534 from the stack's left.
  const place = (o) => o * 3.6;
  const rows = [[110, 158], [110, 158], [0, 110, 158], [0, 158], [0, 158], [90, 158]];
  const widths = [[200, 120, 0], [190, 60, 0], [0, 0, 0, 0], [0, 529, 0], [0, 300, 0], [130, 100, 0]];
  const g = ruleGrid(rows, widths, undefined, place, { reach: 534 });
  check("each row's first bar stands at its own column: the court box's at 110, the notice's at 0, the case number's at 90",
    g.heads.map((v) => +v.toFixed(1)), [396, 396, 0, 0, 0, 324]);
  check("no column is placed past the page's type: every row reaching the closing bar ends there",
    g.spans.map((s, k) => +(g.heads[k] + s.reduce((a, b) => a + b, 0)).toFixed(1)), [534, 534, 534, 534, 534, 534]);
  check("…where the grid alone would have set it past the PDF's rule",
    +ruleGrid(rows, widths, undefined, place).spans[3][0].toFixed(1), 568.8);
  check("a place within the grid's slack of the type stands (a form whose type stops short of its box's side)",
    +ruleGrid(rows, widths, undefined, place, { reach: 566, slack: 3.6 }).spans[3][0].toFixed(1), 568.8);
  check("…and one further past it is set at the type's edge",
    +ruleGrid(rows, widths, undefined, place, { reach: 560, slack: 3.6 }).spans[3][0].toFixed(1), 560);
  check("…though a cell wider than the type reaches still pushes its column out",
    ruleGrid([[0, 100]], [[0, 350, 0]], undefined, (o) => o * 4, { reach: 300 }).spans, [[350]]);
  check("the flowing sheet keeps its one lead for every row, as before: there every box's left side stands together",
    ruleGrid(rows, widths), { lead: 200, spans: [[529], [529], [0, 529], [529], [529], [529]] });
  check("no rows on the grid, nothing to place", ruleGrid([], [], undefined, place), { lead: 0, heads: [], spans: [] });
}

console.log("edges");
{
  check("no rows, nothing to place", ruleGrid([], []), { lead: 0, spans: [] });
  check("a row of one bar has no cell between two", ruleGrid([[5]], [[3, 9]]), { lead: 3, spans: [[]] });
  check("a missing or unmeasured width counts as nothing",
    ruleGrid([[0, 10], [0, 10]], [[undefined, NaN, 0], [2, 60, 0]]), { lead: 2, spans: [[60], [60]] });
}

console.log(`\n${"=".repeat(60)}\nFAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
