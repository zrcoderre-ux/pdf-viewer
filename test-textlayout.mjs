// Node-runnable tests for the exports and Compare (viewer/textlayout.js),
// Find's matching (viewer/find.js) and the zip writer (viewer/zip.js).
//
// Text items are shaped like pdf.js's getTextContent() output, so the page
// reading is tested without pdf.js. The zip is read back with Node's zlib:
// every entry's name, CRC and inflated bytes must match what went in, which
// is what Word needs to open a .docx.
//
// Run: node test-textlayout.mjs

import zlib from "node:zlib";
import {
  linesFromItems, paragraphsFromLines, plainText, buildDocx,
  tokenize, diffWords, compareHunks,
} from "./viewer/textlayout.js";
import { normalize, findIn } from "./viewer/find.js";
import { crc32, makeZip } from "./viewer/zip.js";

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

const item = (str, x, y, size = 12, width = str.length * size * 0.5) => ({ str, transform: [size, 0, 0, size, x, y], width });

console.log("reading a page");
{
  const items = [
    item("Second line of the", 72, 672),
    item("MEMORANDUM", 72, 720, 18),
    item("the court erred, and the", 205, 690),
    item("Plaintiff contends that", 72, 690, 12, 130),
    item("paragraph, which runs on", 72, 654),
    item("to a fourth line.", 72, 636, 12, 90),
    item("A new paragraph starts here after a gap", 72, 600),
    item("and ends on its second line.", 72, 582),
  ];
  const lines = linesFromItems(items);
  check("items become lines, top to bottom, left to right", lines.map((l) => l.text), [
    "MEMORANDUM",
    "Plaintiff contends that the court erred, and the",
    "Second line of the",
    "paragraph, which runs on",
    "to a fourth line.",
    "A new paragraph starts here after a gap",
    "and ends on its second line.",
  ]);
  const paras = paragraphsFromLines(lines);
  check("lines become paragraphs at the gaps", paras.map((p) => p.text), [
    "MEMORANDUM",
    "Plaintiff contends that the court erred, and the Second line of the paragraph, which runs on to a fourth line.",
    "A new paragraph starts here after a gap and ends on its second line.",
  ]);
  check("the larger type is a heading", paras.map((p) => p.heading), [true, false, false]);
  const hy = paragraphsFromLines(linesFromItems([item("a sum-", 72, 700), item("mary judgment", 72, 686)]));
  check("a word broken at the line end is mended", hy[0].text, "a summary judgment");
  check("blank items are skipped", linesFromItems([item("   ", 72, 700), item("x", 72, 680)]).map((l) => l.text), ["x"]);
}

console.log("\nplain text and Word");
{
  const pages = [
    { lines: [{ text: "First page" }], paragraphs: [{ text: "Heading", size: 20, heading: true, indent: 0 }, { text: "Body & <more>", size: 12, heading: false, indent: 36 }], widthPts: 612, heightPts: 792 },
    { lines: [{ text: "Second page" }], paragraphs: [{ text: "Tab\there", size: 12, heading: false, indent: 0 }], widthPts: 612, heightPts: 792 },
  ];
  check("plain text marks each page as the text reader reads it",
    plainText(pages), "====== Page 1 ======\nFirst page\n\n====== Page 2 ======\nSecond page\n");
  const parts = buildDocx(pages, { title: "Brief" });
  check("a .docx has the parts Word needs", parts.map((p) => p.name).sort(), [
    "[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "word/_rels/document.xml.rels", "word/document.xml", "word/styles.xml",
  ]);
  const xml = parts.find((p) => p.name === "word/document.xml").data;
  ok("text is escaped", xml.includes("Body &amp; &lt;more&gt;"));
  ok("a heading uses a heading style", xml.includes('<w:pStyle w:val="Heading1"/>'));
  ok("an indent is kept", xml.includes('<w:ind w:firstLine="720"/>'));
  ok("pages are separated by a page break", xml.includes('<w:br w:type="page"/>'));
  ok("a tab is a Word tab", xml.includes("<w:tab/>"));
  ok("the page is letter size", xml.includes('<w:pgSz w:w="12240" w:h="15840"/>'));
  ok("the title is in the properties", parts.find((p) => p.name === "docProps/core.xml").data.includes("<dc:title>Brief</dc:title>"));
}

console.log("\ncompare");
{
  const tok = (s, page = 1) => s.split(/\s+/).filter(Boolean).map((w) => ({ w, page }));
  // Rebuild B from A and the ops: the diff is only right if this works.
  const apply = (A, B, ops) => {
    const out = [];
    for (const o of ops) {
      if (o.op === "eq") out.push(...A.slice(o.a[0], o.a[1]).map((t) => t.w));
      if (o.op === "ins") out.push(...B.slice(o.b[0], o.b[1]).map((t) => t.w));
    }
    return out.join(" ");
  };
  let bad = 0, seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let t = 0; t < 300; t++) {
    const words = () => Array.from({ length: rand(30) }, () => "abcdefgh"[rand(8)]).join(" ");
    const A = tok(words()), B = tok(words());
    const ops = diffWords(A, B);
    if (apply(A, B, ops) !== B.map((x) => x.w).join(" ")) bad++;
    for (const o of ops) if (o.op === "eq") for (let i = 0; i < o.a[1] - o.a[0]; i++) if (A[o.a[0] + i].w !== B[o.b[0] + i].w) bad++;
  }
  check("300 random word lists: the diff always rebuilds the second from the first", bad, 0);
  const minimal = diffWords(tok("a b c d e f"), tok("a b x d e f"));
  check("one changed word is one delete and one insert", minimal.filter((o) => o.op !== "eq").length, 2);
  const h = compareHunks(tok("The court finds that the motion is granted in part."), tok("The court finds that the motion is denied."));
  check("a replacement is one change", h.length, 1);
  check("…with what was taken out and put in", [h[0].removed, h[0].added], ["granted in part.", "denied."]);
  check("…and the words before it", h[0].before, "The court finds that the motion is");
  const paged = compareHunks(tokenize([{ lines: [{ text: "same" }] }, { lines: [{ text: "old words" }] }]), tokenize([{ lines: [{ text: "same" }] }, { lines: [{ text: "new words" }] }]));
  check("a change knows its page", [paged[0].pageA, paged[0].pageB], [2, 2]);
  check("curly and straight quotes are the same word", diffWords(tok("don’t"), tok("don't")).map((o) => o.op), ["eq"]);
  check("identical text has no changes", compareHunks(tok("x y z"), tok("x y z")), []);
}

console.log("\nfind");
{
  const { norm, normToRaw } = normalize("  Plaintiff’s   “motion”\n\nwas   denied — in part");
  check("blank runs fold to one space, quotes and dashes made plain", norm, "Plaintiff's \"motion\" was denied - in part");
  check("each character maps back to the page text", normToRaw.slice(0, 3), [2, 3, 4]);
  check("matches are found regardless of case", findIn("The court. the Court.", "the court"), [[0, 9], [11, 20]]);
  check("match case", findIn("The court. the Court.", "the court", { caseSensitive: true }), []);
  check("whole words skip a word inside another", findIn("theory the other", "the", { wholeWord: true }), [[7, 10]]);
  check("a query with curly quotes finds straight ones", findIn("Plaintiff's motion", "Plaintiff’s"), [[0, 11]]);
  check("an empty query finds nothing", findIn("anything", "   "), []);
}

console.log("\nzip");
{
  check("CRC-32 check value", crc32(new TextEncoder().encode("123456789")).toString(16), "cbf43926");
  const big = "Lorem ipsum dolor sit amet. ".repeat(200);
  const img = new Uint8Array(300).map((_, i) => (i * 37) & 0xff);
  const blob = await makeZip([
    { name: "word/document.xml", data: big },
    { name: "page-1.png", data: img, store: true },
    { name: "ünïcode.txt", data: "hi" },
  ]);
  const buf = Buffer.from(await blob.arrayBuffer());
  // Walk the central directory, then read each entry through its local header.
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const flags = buf.readUInt16LE(p + 8);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const lho = buf.readUInt32LE(p + 42);
    const dataStart = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const body = buf.subarray(dataStart, dataStart + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : body;
    entries.push({ name, method, crcOk: crc32(data) === crc, flags, text: name.endsWith(".png") ? data.length : data.toString("utf8").slice(0, 11) });
    p += 46 + nlen + elen + clen;
  }
  check("three entries in order", entries.map((e) => e.name), ["word/document.xml", "page-1.png", "ünïcode.txt"]);
  check("text is deflated, the image stored", entries.map((e) => e.method), [8, 0, 0]);
  ok("every CRC matches its contents", entries.every((e) => e.crcOk));
  check("contents read back", entries.map((e) => e.text), ["Lorem ipsum", 300, "hi"]);
  ok("a non-ASCII name is flagged UTF-8", (entries[2].flags & 0x800) !== 0);
}

console.log(`\n${"=".repeat(60)}\nFAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
