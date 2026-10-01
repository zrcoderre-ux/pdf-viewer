// Node-runnable tests for the text layer repair (viewer/text-layer.js).
//
// pdf.js's TextLayer is stood in for by what the repair reads of it: its
// textDivs, one per item that has a `str`, each with the font size and
// transform pdf.js wrote. A layer laid out in a window with no layout has
// every font size at 0; the repair must give each span its item's height,
// leave a sound layer exactly as it was, and keep spans and items in step
// past the items pdf.js makes no span for (marked content).
//
// Run: node test-text-layer.mjs

import { repairTextLayer } from "./viewer/text-layer.js";

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

const item = (str, size, x = 72, y = 700) => ({ str, transform: [size, 0, 0, size, x, y] });
const div = (text, px, transform = "") => ({
  textContent: text,
  style: { fontSize: `calc(var(--scale-factor)*${px.toFixed(2)}px)`, transform },
});
const sizes = (divs) => divs.map((d) => d.style.fontSize);

console.log("a layer laid out with no layout");
{
  const items = [
    item("Plaintiff contends", 12),
    { type: "beginMarkedContent", id: null },
    item("MEMORANDUM", 18),
    { type: "endMarkedContent" },
    item("", 12),
    item("§ 1542", 10.5),
  ];
  const textDivs = [div("Plaintiff contends", 0, "scaleX(1.01)"), div("MEMORANDUM", 0), div("", 0), div("§ 1542", 0, "scaleX(0.98)")];
  const n = repairTextLayer({ textDivs }, items);
  check("each span sized from its own item", sizes(textDivs), [
    "calc(var(--scale-factor)*12.00px)",
    "calc(var(--scale-factor)*18.00px)",
    "calc(var(--scale-factor)*12.00px)",
    "calc(var(--scale-factor)*10.50px)",
  ]);
  check("every zero-size span counted", n, 4);
  check("pdf.js's width scale kept", textDivs.map((d) => d.style.transform), ["scaleX(1.01)", "", "", "scaleX(0.98)"]);
}

console.log("a rotated or skewed matrix");
{
  // Text turned a quarter: its height is the length of the matrix's second axis.
  const items = [{ str: "Exhibit A", transform: [0, 14, -14, 0, 300, 100] }];
  const textDivs = [div("Exhibit A", 0)];
  repairTextLayer({ textDivs }, items);
  check("height read off the turned axis", sizes(textDivs), ["calc(var(--scale-factor)*14.00px)"]);
}

console.log("a sound layer");
{
  const items = [item("Defendant responds", 12), item("1", 12)];
  const textDivs = [div("Defendant responds", 12, "scaleX(1.002)"), div("1", 12)];
  const before = JSON.stringify(textDivs);
  check("nothing sized", repairTextLayer({ textDivs }, items), 0);
  check("left exactly as pdf.js made it", JSON.stringify(textDivs), before);
}

console.log("nothing to repair");
{
  check("no layer", repairTextLayer(null, []), 0);
  check("no spans", repairTextLayer({ textDivs: [] }, [item("x", 12)]), 0);
  check("no items", repairTextLayer({ textDivs: [div("x", 0)] }, null), 0);
  // pdf.js stops making spans past its ceiling; the items beyond have none.
  const textDivs = [div("one", 0)];
  check("more items than spans", repairTextLayer({ textDivs }, [item("one", 9), item("two", 9)]), 1);
}

console.log(`\nFAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
