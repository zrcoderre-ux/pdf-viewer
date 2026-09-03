// Node-runnable tests: the geometry behind the page rotation tool.
// Run: node test-page-rotation.mjs
//
// Turning a page is cheap for the canvas — PDF.js takes a rotated viewport and
// paints it — but the OCR text layer has no such help. Its word boxes were
// recognized from the page the way the PDF stores it, and they have to be
// re-placed by hand every time the page turns, or a straightened scan renders
// with its selectable text still lying on its side: invisible spans in the
// wrong place, so selections grab the wrong words and citation links land in
// the margin.
//
// rotatedRunPlacement is that re-placement. It returns the anchor for a span
// carrying `transform-origin: 0 0; transform: rotate(<angle>deg)`, which is the
// image of the run's TOP-LEFT corner — not the box's top-left, because the
// rotation sends the span's own axes the same way the page went. The tests
// below pin that corner for each quarter turn, and pin what the rotate bar's
// scope picker means.

import { normalizeAngle, pagesInScope, rotatedRunPlacement } from "./viewer/rotation.js";

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

console.log("\n--- normalizeAngle keeps angles to the four quarter turns ---");
check("0 stays 0", normalizeAngle(0), 0);
check("90", normalizeAngle(90), 90);
check("a full turn is no turn", normalizeAngle(360), 0);
check("past a full turn wraps", normalizeAngle(450), 90);
check("counter-clockwise from upright", normalizeAngle(-90), 270);
check("two turns back", normalizeAngle(-180), 180);
check("off-quarter angles snap", normalizeAngle(87), 90);
check("junk reads as upright", normalizeAngle(undefined), 0);
check("so does a string", normalizeAngle("nope"), 0);

// A letter-size page (612 x 792) with a line of text near the top-left:
// x 72..300, y 100..112 measured from the top.
const RUN = { x0: 72, y0: 100, x1: 300, y1: 112, pageW: 612, pageH: 792 };
const at = (angle, scale = 1) => rotatedRunPlacement({ ...RUN, angle, scale });

console.log("\n--- an upright page places the run where it already is ---");
check("anchor is the box's own top-left", at(0),
  { left: 72, top: 100, runWidth: 228, runHeight: 12, angle: 0 });
check("zoom multiplies through", at(0, 1.5),
  { left: 108, top: 150, runWidth: 342, runHeight: 18, angle: 0 });

console.log("\n--- a quarter turn clockwise ---");
// The page is now 792 wide and 612 tall. The run reads downward, so its
// top-left corner lands at the TOP-RIGHT of where the run now sits:
// x = pageH - y0 = 692, y = x0 = 72.
check("anchor is the rotated top-left corner", at(90),
  { left: 692, top: 72, runWidth: 228, runHeight: 12, angle: 90 });
check("reading order is preserved (width is still along the line)",
  at(90).runWidth, 228);

console.log("\n--- upside down ---");
// (x, y) -> (pageW - x, pageH - y): 612-72 = 540, 792-100 = 692.
check("anchor is the far corner", at(180),
  { left: 540, top: 692, runWidth: 228, runHeight: 12, angle: 180 });

console.log("\n--- a quarter turn counter-clockwise ---");
// (x, y) -> (y, pageW - x): 100, 612-72 = 540. The run reads upward.
check("anchor is the rotated top-left corner", at(270),
  { left: 100, top: 540, runWidth: 228, runHeight: 12, angle: 270 });
check("Shift+R from upright is the same as 270", at(-90), at(270));

console.log("\n--- four quarter turns come back to where it started ---");
check("full circle", at(360), at(0));

console.log("\n--- the run stays inside the rotated page ---");
// The rotated page is pageH x pageW on a quarter turn; the anchor plus the
// run's own extent must not leave it. (At 90 the run extends down and left.)
const p90 = at(90);
check("anchor within the turned page's width", p90.left <= RUN.pageH, true);
check("run's far end within its height", p90.top + p90.runWidth <= RUN.pageW, true);

console.log("\n--- scope picker ---");
check("this page", pagesInScope("page", 3, 10), [3]);
check("all pages", pagesInScope("all", 3, 4), [1, 2, 3, 4]);
check("odd pages — the recto side of a duplex scan", pagesInScope("odd", 1, 6), [1, 3, 5]);
check("even pages", pagesInScope("even", 1, 6), [2, 4, 6]);
check("a page beyond the document rotates nothing", pagesInScope("page", 11, 10), []);
check("an empty document", pagesInScope("all", 1, 0), []);

console.log("\n" + "=".repeat(60));
console.log(`FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
