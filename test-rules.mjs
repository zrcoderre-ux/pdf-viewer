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

console.log("edges");
{
  check("no rows, nothing to place", ruleGrid([], []), { lead: 0, spans: [] });
  check("a row of one bar has no cell between two", ruleGrid([[5]], [[3, 9]]), { lead: 3, spans: [[]] });
  check("a missing or unmeasured width counts as nothing",
    ruleGrid([[0, 10], [0, 10]], [[undefined, NaN, 0], [2, 60, 0]]), { lead: 2, spans: [[60], [60]] });
}

console.log(`\n${"=".repeat(60)}\nFAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
