// Node-runnable tests for redaction (viewer/redact.js + pdf-edit.buildRedactedPdf).
//
// Two kinds of decision are tested here. The first is where a name STANDS: the
// page arrives as a pile of text-layer spans, and turning the key's match back
// into rectangles depends on how those spans are read as one string and mapped
// back. The second is what the saved file IS — which is the whole promise of
// the feature, so the PDF that comes out is opened and read for text, for an
// /Info dictionary and for an XMP packet, none of which may be in it.
//
// Run: node test-redact.mjs

import zlib from "node:zlib";
import {
  spanGap, pageTextFromSpans, spanRangeFor,
  mergeRects, padRect, clampRect, redactedName, countLabel,
  addRedaction, removeRedaction, redactionsFor, redactionPages,
  redactionCount, clearRedactions,
} from "./viewer/redact.js";
import { buildRedactedPdf } from "./viewer/pdf-edit.js";

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
function ok(label, cond) { check(label, !!cond, true); }

// A span as the viewer hands it over: what it says, and where it sits.
const S = (text, left, top, width, height = 10) => ({ text, left, top, width, height });

console.log("how two spans are joined");
{
  check("a span that has dropped a line opens a new one",
    spanGap(S("Helen", 100, 100, 40), S("Rasho", 100, 118, 40)), "\n");
  check("a gap on the same line is a space",
    spanGap(S("Helen", 100, 100, 40), S("Rasho", 150, 100, 40)), " ");
  check("spans that touch are one word cut in two",
    spanGap(S("Hel", 100, 100, 20), S("en", 120, 100, 14)), "");
  check("a space already written is the gap",
    spanGap(S("Helen ", 100, 100, 44), S("Rasho", 150, 100, 40)), "");
  check("…from either side",
    spanGap(S("Helen", 100, 100, 40), S(" Rasho", 150, 100, 44)), "");
  check("an empty span joins to nothing", spanGap(S("", 100, 100, 0), S("Rasho", 100, 100, 40)), "");
  check("a hair of a gap is a kern, not a space",
    spanGap(S("Hel", 100, 100, 20), S("en", 121, 100, 14)), "");
}

console.log("the page as one string, and the way back");
{
  const spans = [S("Helen", 100, 100, 40), S("Rasho", 150, 100, 40), S("filed", 100, 118, 30)];
  const { text, map } = pageTextFromSpans(spans);
  check("the spans read as the page reads", text, "Helen Rasho\nfiled");
  check("a character knows the span it came from", map[0], { span: 0, off: 0 });
  check("the separator belongs to no span", map[5], null);
  check("and the span after it starts again at nothing", map[6], { span: 1, off: 0 });

  const at = text.indexOf("Helen Rasho");
  check("a name across two spans is one range",
    spanRangeFor(map, at, at + "Helen Rasho".length),
    { startSpan: 0, startOffset: 0, endSpan: 1, endOffset: 5 });
  check("a name inside one span is that span's own slice",
    spanRangeFor(map, text.indexOf("Rasho"), text.indexOf("Rasho") + 5),
    { startSpan: 1, startOffset: 0, endSpan: 1, endOffset: 5 });
  check("a range that is nothing but separator places nowhere",
    spanRangeFor(map, 5, 6), null);
  check("a range past the end is what there is of it",
    spanRangeFor(map, text.length - 5, text.length + 50),
    { startSpan: 2, startOffset: 0, endSpan: 2, endOffset: 5 });
}

console.log("one line of text, one box");
{
  // A name split across two spans reports two rectangles with a hairline
  // between them; the box drawn has to be one box.
  check("touching rectangles on a line become one",
    mergeRects([{ x: 100, y: 100, w: 30, h: 10 }, { x: 130, y: 100, w: 25, h: 10 }]),
    [{ x: 100, y: 100, w: 55, h: 10 }]);
  check("a rectangle a whisker short still joins",
    mergeRects([{ x: 100, y: 100, w: 30, h: 10 }, { x: 131, y: 101, w: 25, h: 9 }]),
    [{ x: 100, y: 100, w: 56, h: 10 }]);
  check("two lines stay two boxes, so a wrap does not black out the margin",
    mergeRects([{ x: 100, y: 100, w: 30, h: 10 }, { x: 100, y: 118, w: 25, h: 10 }]),
    [{ x: 100, y: 100, w: 30, h: 10 }, { x: 100, y: 118, w: 25, h: 10 }]);
  check("words apart on one line stay apart",
    mergeRects([{ x: 100, y: 100, w: 30, h: 10 }, { x: 300, y: 100, w: 25, h: 10 }]),
    [{ x: 100, y: 100, w: 30, h: 10 }, { x: 300, y: 100, w: 25, h: 10 }]);
  check("three pieces of one line come out as one",
    mergeRects([
      { x: 100, y: 100, w: 20, h: 10 },
      { x: 140, y: 100, w: 20, h: 10 },
      { x: 120, y: 100, w: 20, h: 10 },
    ]),
    [{ x: 100, y: 100, w: 60, h: 10 }]);
  check("a rectangle of no size is not a box", mergeRects([{ x: 1, y: 1, w: 0, h: 10 }]), []);
  check("nothing to merge is nothing", mergeRects([]), []);
  check("the gap is the caller's to set",
    mergeRects([{ x: 100, y: 100, w: 30, h: 10 }, { x: 140, y: 100, w: 20, h: 10 }], 10),
    [{ x: 100, y: 100, w: 60, h: 10 }]);
}

console.log("a box grown, and held on its page");
{
  check("a box grows on every side", padRect({ x: 10, y: 10, w: 40, h: 10 }, 1),
    { x: 9, y: 9, w: 42, h: 12 });
  const LETTER = { x: 0, y: 0, w: 612, h: 792 };
  check("a box over the edge is cut to the page",
    clampRect({ x: -5, y: -5, w: 50, h: 50 }, LETTER), { x: 0, y: 0, w: 45, h: 45 });
  check("a box past the far edge likewise",
    clampRect({ x: 600, y: 780, w: 50, h: 50 }, LETTER), { x: 600, y: 780, w: 12, h: 12 });
  check("a box entirely off the page is no box",
    clampRect({ x: 700, y: 900, w: 50, h: 50 }, LETTER), null);
  // A page whose box does not start at the origin — legal, and not rare in
  // scans — is held to where it actually is, not to a rectangle at 0,0.
  check("a page box away from the origin holds the box where the page is",
    clampRect({ x: 10, y: 10, w: 50, h: 50 }, { x: 30, y: 40, w: 612, h: 792 }),
    { x: 30, y: 40, w: 30, h: 20 });
  check("a page with no box keeps nothing", clampRect({ x: 0, y: 0, w: 10, h: 10 }, null), null);
}

console.log("the name the copy is saved under");
{
  const fake = (t) => t.replace(/Rasho/g, "Strangeways").replace(/Quillmark/g, "Melbury");
  check("no key, and the copy is still marked",
    redactedName("Rasho v Quillmark - MTC.pdf", null), "Rasho v Quillmark - MTC (redacted).pdf");
  check("with a key the copy carries the pseudonymized name",
    redactedName("Rasho v Quillmark - MTC.pdf", fake), "Strangeways v Melbury - MTC (redacted).pdf");
  check("a copy of a copy is marked once",
    redactedName("Strangeways v Melbury (redacted).pdf", null), "Strangeways v Melbury (redacted).pdf");
  check("a path is not part of the name",
    redactedName("C:\\Cases\\Rasho\\MTC.pdf", null), "MTC (redacted).pdf");
  check("a key that throws leaves the name it had",
    redactedName("MTC.pdf", () => { throw new Error("no"); }), "MTC (redacted).pdf");
  check("a nameless file is still a file", redactedName("", null), "document (redacted).pdf");
}

console.log("what the bar says");
{
  check("nothing marked", countLabel(0, 0), "Nothing marked.");
  check("one box on one page", countLabel(1, 1), "1 box on 1 page.");
  check("several", countLabel(7, 3), "7 boxes on 3 pages.");
}

console.log("the boxes held between now and the save");
{
  clearRedactions();
  const a = addRedaction(3, [{ x: 10, y: 10, w: 40, h: 10 }], { kind: "key", label: "Helen Rasho" });
  const b = addRedaction(3, [{ x: 10, y: 40, w: 40, h: 10 }], { kind: "area" });
  addRedaction(1, [{ x: 0, y: 0, w: 20, h: 20 }], { kind: "text" });
  check("counted by box and by page", redactionCount(), { boxes: 3, pages: 2 });
  check("the pages come back in order", redactionPages().map((p) => p.pageNumber), [1, 3]);
  check("a box remembers what it covers", redactionsFor(3)[0].label, "Helen Rasho");
  check("a box with no size is no box", addRedaction(5, [{ x: 0, y: 0, w: 0, h: 5 }]), null);
  check("…and files nothing", redactionsFor(5), []);
  ok("a box can be taken back off", removeRedaction(3, a.id));
  check("taking one off leaves the rest", redactionsFor(3).map((r) => r.id), [b.id]);
  check("taking off what is not there changes nothing", removeRedaction(3, 9999), false);
  clearRedactions("area");
  check("the key's boxes can be dropped on their own without touching the hand's",
    redactionCount(), { boxes: 1, pages: 1 });
  clearRedactions();
  check("and everything can go", redactionCount(), { boxes: 0, pages: 0 });
}

// ── the file the save writes ──────────────────────────────────────────────────

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A `w`×`h` PNG of one flat colour — enough to be a page. */
function pngOf(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = r; raw[row + 2 + x * 3] = g; raw[row + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

console.log("the redacted copy is a document with nothing in it but pictures");
{
  const page = pngOf(8, 10, [255, 255, 255]);
  const bytes = await buildRedactedPdf({
    pages: [
      { bytes: page, format: "png", widthPts: 612, heightPts: 792 },
      { bytes: page, format: "png", widthPts: 400, heightPts: 300 },
    ],
  });
  const buf = Buffer.from(bytes);

  ok("it is a PDF", buf.subarray(0, 5).toString("latin1") === "%PDF-");

  // pdf-lib writes its objects into compressed object streams, so reading the
  // file as text would find nothing anywhere and every "no X" below would pass
  // for the wrong reason. Everything deflated in it is inflated first, and the
  // assertions are made against the whole of it, plain and inflated together.
  const readable = (() => {
    const parts = [buf.toString("latin1")];
    const raw = buf.toString("latin1");
    const re = /stream\r?\n/g;
    let m;
    while ((m = re.exec(raw))) {
      const from = m.index + m[0].length;
      const to = raw.indexOf("endstream", from);
      if (to < 0) continue;
      try { parts.push(zlib.inflateSync(buf.subarray(from, to)).toString("latin1")); }
      catch { /* an image, or not deflated — nothing to read out of it */ }
    }
    return parts.join("\n");
  })();
  ok("the inflating worked — the page objects are in there to be read",
    /\/Type\s*\/Page\b/.test(readable));

  check("no /Info dictionary — no author, no producer, no dates", /\/Info/.test(readable), false);
  check("no XMP packet either", /\/Metadata|<x:xmpmeta/.test(readable), false);
  check("nothing says what wrote it", /Producer|Creator|pdf-lib/i.test(readable), false);
  check("no font is embedded, because there is no text to set",
    /\/Font|\/BaseFont/.test(readable), false);
  check("no annotation survives", /\/Annots/.test(readable), false);
  check("no form", /\/AcroForm/.test(readable), false);
  ok("the pages are images", /\/Subtype\s*\/Image/.test(readable));

  // The content stream is the page's whole instruction list. A redacted page
  // draws one image and does nothing else — in particular it opens no text
  // object, which is what "no text layer" comes down to in a PDF.
  const { PDFDocument, PDFName, PDFArray } = await import("./viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
  // Loaded WITHOUT updateMetadata, because loading with it is pdf-lib stamping
  // its own Producer onto the document in memory — which would be this test
  // writing the very thing it is checking is not there.
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  check("two pages in, two pages out", doc.getPageCount(), 2);
  check("each page keeps the size its original had",
    doc.getPages().map((p) => [Math.round(p.getSize().width), Math.round(p.getSize().height)]),
    [[612, 792], [400, 300]]);

  const contents = doc.getPages().map((p) => {
    const ctx = p.node.context;
    const refs = p.node.lookup(PDFName.of("Contents"), PDFArray);
    const raw = Buffer.concat(refs.asArray().map((ref) => Buffer.from(ctx.lookup(ref).contents)));
    try { return zlib.inflateSync(raw).toString("latin1"); }
    catch { return raw.toString("latin1"); }
  });
  check("no page opens a text object", contents.some((c) => /\bBT\b/.test(c)), false);
  check("no page shows a glyph", contents.some((c) => /\bTj\b|\bTJ\b/.test(c)), false);
  ok("every page draws its image", contents.every((c) => /\bDo\b/.test(c)));

  check("read back, the document has no title, author, producer or creator",
    [doc.getTitle(), doc.getAuthor(), doc.getProducer(), doc.getCreator(),
     doc.getSubject(), doc.getKeywords()].map((v) => v || ""),
    ["", "", "", "", "", ""]);
  check("and no dates", [doc.getCreationDate(), doc.getModificationDate()]
    .map((v) => (v ? "set" : "")), ["", ""]);

  let threw = "";
  try { await buildRedactedPdf({ pages: [] }); } catch (e) { threw = e.message; }
  ok("a copy with no pages is refused rather than written", /at least one page/.test(threw));
}

console.log(`\n${"=".repeat(60)}\nFAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
