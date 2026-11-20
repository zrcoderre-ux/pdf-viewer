// Tests for the page-plan writer (viewer/pdf-edit.js, applyPagePlan) that Save
// uses to write a rotation, and Organize pages to reorder or delete pages: the
// document's own parts (its bookmarks, page labels, the pages' links) come
// through, each bookmark still pointing at its page wherever the page went; a
// bookmark to a deleted page goes with it, one with live children points at
// the first of them; a page listed twice is copied.
//
// The owner (2026-11-20): "post update the bookmarks are gone it says this
// document has no bookmarks". The writer used to copy the pages into a NEW
// document, which carried none of the document's own parts.
//
// Run: node test-page-plan.mjs   (from the repo root). Node only.

import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFString, PDFNumber, PDFHexString } from "./viewer/vendor/pdf-lib/pdf-lib.esm.min.js";
import { applyPagePlan } from "./viewer/pdf-edit.js";

let fails = 0, passes = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passes++; else fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) { console.log(`        got : ${JSON.stringify(got)}`); console.log(`        want: ${JSON.stringify(want)}`); }
}
const N = (n) => PDFName.of(n);

// Five pages, each saying which it is; bookmarks:
//   Introduction → p1
//   Argument → p3, with children "A. First point" → p4 and "B. Second" → p5
//   Exhibit → p3 (by a GoTo action)
//   Conclusion → p5
// page labels, and a link annotation on p2.
async function source() {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= 5; i++) {
    const p = doc.addPage([612, 792]);
    p.node.set(N("PDFPlusTestPage"), PDFNumber.of(i));
  }
  const ctx = doc.context;
  const pages = doc.getPages();
  const dest = (i) => ctx.obj([pages[i - 1].ref, N("XYZ"), null, null, null]);
  const refs = {};
  const item = (title, extra) => {
    const d = ctx.obj({ Title: PDFHexString.fromText(title), ...extra });
    const r = ctx.register(d);
    refs[title] = r;
    return [r, d];
  };
  const root = ctx.obj({ Type: "Outlines" });
  const rootRef = ctx.register(root);
  const [rI, I] = item("Introduction", { Dest: dest(1) });
  const [rA, A] = item("Argument", { Dest: dest(3) });
  const [rA1, A1] = item("A. First point", { Dest: dest(4) });
  const [rA2, A2] = item("B. Second", { Dest: dest(5) });
  const [rE, E] = item("Exhibit", { A: ctx.obj({ S: "GoTo", D: dest(3) }) });
  const [rC, C] = item("Conclusion", { Dest: dest(5) });
  const chain = (parent, parentRef, kids) => {
    kids.forEach(([r, d], k) => {
      d.set(N("Parent"), parentRef);
      if (k) d.set(N("Prev"), kids[k - 1][0]);
      if (k < kids.length - 1) d.set(N("Next"), kids[k + 1][0]);
    });
    parent.set(N("First"), kids[0][0]);
    parent.set(N("Last"), kids[kids.length - 1][0]);
    parent.set(N("Count"), PDFNumber.of(kids.length));
  };
  chain(A, rA, [[rA1, A1], [rA2, A2]]);
  chain(root, rootRef, [[rI, I], [rA, A], [rE, E], [rC, C]]);
  doc.catalog.set(N("Outlines"), rootRef);
  doc.catalog.set(N("PageLabels"), ctx.obj({ Nums: [0, { S: "r" }] }));
  const link = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [72, 72, 200, 90], A: { S: "URI", URI: PDFString.of("https://www.westlaw.com/x") } }));
  pages[1].node.set(N("Annots"), ctx.obj([link]));
  return doc.save();
}

// What a reader finds: each page's own number, and the bookmarks as
// [title, the page number they land on (by the page's own mark), children].
async function read(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const look = (x) => (x instanceof PDFRef ? ctx.lookup(x) : x);
  const pages = doc.getPages();
  const mark = (ref) => {
    const p = pages.find((pg) => pg.ref.toString() === ref.toString());
    return p ? p.node.get(N("PDFPlusTestPage")).asNumber() : "gone";
  };
  const destOf = (it) => {
    let d = look(it.get(N("Dest")));
    if (!d) { const a = look(it.get(N("A"))); if (a instanceof PDFDict) d = look(a.get(N("D"))); }
    return d instanceof PDFArray ? mark(d.get(0)) : null;
  };
  const walk = (parent) => {
    const out = [];
    let ref = parent.get(N("First"));
    let prev = null;
    while (ref) {
      const it = look(ref);
      const back = it.get(N("Prev"));
      if ((back ? back.toString() : null) !== (prev ? prev.toString() : null)) out.push("BAD-PREV");
      const kids = it.get(N("First")) ? walk(it) : [];
      out.push(kids.length ? [it.get(N("Title")).decodeText(), destOf(it), kids] : [it.get(N("Title")).decodeText(), destOf(it)]);
      prev = ref;
      ref = it.get(N("Next"));
    }
    const last = parent.get(N("Last"));
    if (out.length && (!last || last.toString() !== prev.toString())) out.push("BAD-LAST");
    return out;
  };
  const outlines = look(doc.catalog.get(N("Outlines")));
  return {
    pages: pages.map((p) => [p.node.get(N("PDFPlusTestPage")).asNumber(), p.getRotation().angle]),
    bookmarks: outlines instanceof PDFDict ? walk(outlines) : null,
    labels: !!doc.catalog.get(N("PageLabels")),
    link: pages.some((p) => { const a = look(p.node.get(N("Annots"))); return a instanceof PDFArray && a.size() > 0; }),
  };
}

const src = await source();
const ALL = [["Introduction", 1], ["Argument", 3, [["A. First point", 4], ["B. Second", 5]]], ["Exhibit", 3], ["Conclusion", 5]];
check("the source, as built", (await read(src)).bookmarks, ALL);

console.log("1. a rotation saved (every page kept, one turned)");
let got = await read(await applyPagePlan({ srcBytes: src, plan: [0, 1, 2, 3, 4].map((i) => ({ srcIndex: i, rotate: i === 1 ? 90 : 0 })) }));
check("the pages, the second turned", got.pages, [[1, 0], [2, 90], [3, 0], [4, 0], [5, 0]]);
check("every bookmark kept, each on its page", got.bookmarks, ALL);
check("the page labels and the page's link kept", [got.labels, got.link], [true, true]);

console.log("2. pages reordered");
got = await read(await applyPagePlan({ srcBytes: src, plan: [4, 3, 2, 1, 0].map((i) => ({ srcIndex: i })) }));
check("the new order", got.pages.map((p) => p[0]), [5, 4, 3, 2, 1]);
check("each bookmark follows its page", got.bookmarks, ALL);

console.log("3. a page deleted");
got = await read(await applyPagePlan({ srcBytes: src, plan: [0, 1, 3, 4].map((i) => ({ srcIndex: i })) }));
check("the bookmark to it goes; one with children points at its first", got.bookmarks,
  [["Introduction", 1], ["Argument", 4, [["A. First point", 4], ["B. Second", 5]]], ["Conclusion", 5]]);
got = await read(await applyPagePlan({ srcBytes: src, plan: [0, 1, 2].map((i) => ({ srcIndex: i })) }));
check("…children and all, where every child's page went", got.bookmarks, [["Introduction", 1], ["Argument", 3], ["Exhibit", 3]]);
got = await read(await applyPagePlan({ srcBytes: src, plan: [{ srcIndex: 1 }] }));
check("no bookmark left: none at all", got.bookmarks, null);

console.log("4. a page listed twice");
got = await read(await applyPagePlan({ srcBytes: src, plan: [0, 0, 1, 2, 3, 4].map((i) => ({ srcIndex: i })) }));
check("copied for its second place", got.pages.map((p) => p[0]), [1, 1, 2, 3, 4, 5]);
check("…the bookmarks on the first", got.bookmarks, ALL);

console.log("5. refusals");
let err = "";
try { await applyPagePlan({ srcBytes: src, plan: [] }); } catch (e) { err = e.message; }
check("no pages", err, "A document must keep at least one page.");
try { await applyPagePlan({ srcBytes: src, plan: [{ srcIndex: 9 }] }); } catch (e) { err = e.message; }
check("a page that is not there", err, "Page plan references a page that doesn't exist.");

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
