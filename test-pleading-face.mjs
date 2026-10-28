// Browser test for pleading paper beside its PDF in the PDF's own face: the
// reader's font is set to a wide one (DejaVu Serif, standing in for the
// reader's Georgia, which this machine may not have), and a pleading's lines
// beside a PDF set in Times are drawn in the PDF's Times, not in it. The
// owner: "I think the font is slightly bigger in the text than in the pdf" —
// Georgia at the PDF's point size runs an eighth wider than Times, and its
// lines ran past the sheet's edge and its caption's parties across the `)`
// side (text-reader.js planCells, `place` false).
//
// Checked: the body's lines and the caption's in the PDF's family, each line
// ending within a few points of where the PDF's does; a caption party short
// of its `)` side.
//
// Run: node test-pleading-face.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium),
// the DejaVu Serif font, and a free port in 8130-8199 for python3's
// http.server; exits 0 with SKIP where any is missing. Every name in it is
// invented.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browser-for-tests.mjs";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const PW = "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = "/opt/pw-browsers/chromium";

function skip(why) { console.log(`SKIP: ${why}`); process.exit(0); }
if (!fs.existsSync(PW)) skip("Playwright is not installed at " + PW);
if (!fs.existsSync(CHROME)) skip("Chromium is not installed at " + CHROME);
const { chromium } = await import(PW);

let fails = 0, passes = 0;
function check(label, ok, note = "") {
  if (ok) passes++; else fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok && note) console.log(`        ${note}`);
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}
async function startServer() {
  let port = 0;
  for (let p = 8130; p <= 8199; p++) if (await portFree(p)) { port = p; break; }
  if (!port) skip("no free port in 8130-8199");
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: REPO, stdio: "ignore" });
  for (let t = 0; t < 80; t++) {
    const up = await new Promise((resolve) => { const c = net.connect(port, "127.0.0.1", () => { c.end(); resolve(true); }); c.on("error", () => resolve(false)); });
    if (up) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base: `http://127.0.0.1:${port}`, stop: () => { try { proc.kill("SIGTERM"); } catch { /* gone */ } } };
}

if (!fs.existsSync("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf")) skip("DejaVu Serif is not installed");

// The PDF: [text, line, x], all Times 12. A `)` on every caption line at x 300.
const PDF = [
  ["Attorneys for Defendant and Cross-Complainant IVO TRUCKING, LLC", 5, 72],
  ["SUPERIOR COURT OF THE STATE OF CALIFORNIA", 7, 170],
  ["DAN FRY, individually, and as successor", 9, 72], ["CASE NO. 19STZV98194", 9, 312],
  ["in interest to THE ESTATE OF DAN FRY;", 10, 72], ["Assigned for all purposes to Hon. Al Roe", 10, 312],
  ["Plaintiff,", 11, 160],
  ["IVO TRUCKING, LLC, and DOES 1 through 20,", 12, 72], ["FIRST AMENDED CROSS-COMPLAINT", 12, 312],
  ["Defendants.", 13, 160],
  ["COMES NOW, Defendant, IVO TRUCKING LLC (“Cross-Complainant”) and for its cross-", 16, 108],
  ["complaint against the Cross-Defendants, and each of them, alleges as follows, upon", 17, 72],
  ["information and belief as to all matters but those concerning itself, which it alleges", 18, 72],
  ["upon its own knowledge, and states the following facts in support of each of its claims.", 19, 72],
];
const PARENS = [9, 10, 11, 12, 13];
const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));
const L = (num, left, right = "") => (num ? String(num).padStart(2) + "  " : "    ") + pad(left, 46) + ")" + (right ? "  " + right : "");
const EXPORT = [
  "====== Page 1 ======",
  " 1", " 2", " 3", " 4",
  " 5  Attorneys for Defendant and Cross-Complainant IVO TRUCKING, LLC",
  " 6",
  " 7                SUPERIOR COURT OF THE STATE OF CALIFORNIA",
  " 8",
  L(9, "DAN FRY, individually, and as successor", "CASE NO. 19STZV98194"),
  L(10, "in interest to THE ESTATE OF DAN FRY;", "Assigned for all purposes to Hon. Al Roe"),
  L(11, "                Plaintiff,"),
  L(12, "IVO TRUCKING, LLC, and DOES 1 through 20,", "FIRST AMENDED CROSS-COMPLAINT"),
  L(13, "                Defendants."),
  "14", "15",
  "16          COMES NOW, Defendant, IVO TRUCKING LLC (“Cross-Complainant”) and for its cross-",
  "17  complaint against the Cross-Defendants, and each of them, alleges as follows, upon",
  "18  information and belief as to all matters but those concerning itself, which it alleges",
  "19  upon its own knowledge, and states the following facts in support of each of its claims.",
  "20",
].join("\n") + "\n";

const srv = await startServer();
const browser = await launchBrowser(chromium, CHROME);
try {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // A folder handle is never put in IndexedDB here: the Chromium this runs on
  // in some containers goes down reading an origin-private folder's handle
  // back out of it, and the folder is only remembered, not needed, for this.
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) {
      if (v && typeof FileSystemHandle === "function" && v.handle instanceof FileSystemHandle) throw new DOMException("not kept in this test", "DataCloneError");
      return put.call(this, v, k);
    };
  });
  await page.goto(srv.base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder);
  await page.evaluate(() => {
    const sel = document.getElementById("font-select");
    sel.value = "custom"; sel.dispatchEvent(new Event("change"));
    const c = document.getElementById("font-custom");
    c.value = "DejaVu Serif"; c.dispatchEvent(new Event("input"));
  });
  await page.evaluate(async (text) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry("Case Face", { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle("Case Face", { create: true });
    const t = await dir.getDirectoryHandle("Text Files", { create: true });
    const w = await (await t.getFileHandle("Complaint.txt", { create: true })).createWritable(); await w.write(text); await w.close();
    await window.__textReaderAdoptFolder(dir);
    await window.__textReaderOpenDoc("Complaint.txt");
  }, EXPORT);
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.evaluate(async (items) => {
    const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const doc = await PDFDocument.create();
    const fonts = { r: await doc.embedFont(StandardFonts.TimesRoman), b: await doc.embedFont(StandardFonts.TimesRomanBold), i: await doc.embedFont(StandardFonts.TimesRomanItalic) };
    const pg = doc.addPage([612, 792]);
    const base = (line) => 792 - (100 + (line - 1) * 24);
    for (let n = 1; n <= 28; n++) pg.drawText(String(n), { x: 46 - fonts.r.widthOfTextAtSize(String(n), 12), y: base(n), size: 12, font: fonts.r });
    for (const [t, line, x] of items.text) pg.drawText(t, { x, y: base(line), size: 12, font: fonts.r });
    for (const line of items.parens) pg.drawText(")", { x: 304, y: base(line), size: 12, font: fonts.r });
    await window.__textReaderPickPdfs([new File([await doc.save()], "Complaint.pdf", { type: "application/pdf" })]);
  }, { text: PDF, parens: PARENS });
  await page.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body.fixed"), null, { timeout: 15000 });
  await page.waitForTimeout(1000);
  const sbs = await page.$("#sbs-toggle");
  if (!(await sbs.evaluate((b) => b.getAttribute("aria-pressed") === "true"))) await sbs.click();
  await page.waitForTimeout(2500);
  // Per line with words: its text, its family, where its last letter ends
  // (PDF units), and on a caption row where its party ends against the side.
  const measure = () => {
    const body = document.querySelector("#pages .tpage .page-body");
    const br = body.getBoundingClientRect();
    const scale = br.width / 612;
    const out = [];
    for (const l of body.querySelectorAll(":scope > .line")) {
      const lt = l.querySelector(":scope > .lt");
      if (!lt || !lt.textContent.replace(/\)/g, "").trim()) continue;
      const bar = lt.querySelector(".rb.paren");
      let right = -Infinity, party = -Infinity, family = "";
      const walk = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.data.trim() || n.parentElement.closest(".rb")) continue;
        if (!family) family = getComputedStyle(n.parentElement).fontFamily;
        const b = n.data.search(/\S\s*$/);
        const r = document.createRange(); r.setStart(n, b); r.setEnd(n, b + 1);
        const x = r.getBoundingClientRect().right;
        right = Math.max(right, x);
        if (bar && (bar.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING)) party = Math.max(party, x);
      }
      out.push({ text: lt.textContent.replace(/\s+/g, " ").trim(), family, right: (right - br.left) / scale, across: bar ? (party - bar.getBoundingClientRect().left) / scale : null });
    }
    return out;
  };
  const got = await page.evaluate(`(${measure.toString()})()`);
  // Where each PDF line ends, in Times 12 (pdf-lib's widths), by its first words.
  const ends = await page.evaluate(async (items) => {
    const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const f = await (await PDFDocument.create()).embedFont(StandardFonts.TimesRoman);
    return items.map(([t, , x]) => [t, x + f.widthOfTextAtSize(t, 12)]);
  }, PDF);
  console.log("the PDF's face");
  const body = got.filter((r) => /^(1[6-9]|5) /.test(r.text) || /^(COMES|complaint|information|upon|Attorneys)/.test(r.text));
  check("the body's lines in the PDF's family, not the reader's", body.length >= 4 && body.every((r) => /Times/i.test(r.family) && !/DejaVu/i.test(r.family)), JSON.stringify(body.map((r) => [r.text.slice(0, 14), r.family])));
  const cap = got.filter((r) => r.across != null);
  check("…the caption's too", cap.length >= 3 && cap.every((r) => /Times/i.test(r.family)), JSON.stringify(cap.map((r) => [r.text.slice(0, 14), r.family])));
  console.log("its width");
  const off = [];
  for (const [t, end] of ends) {
    if (!/^(COMES|complaint|information|upon|Attorneys)/.test(t)) continue;
    const r = got.find((g) => g.text.includes(t.slice(0, 24)));
    if (!r || Math.abs(r.right - end) > 6) off.push(`${t.slice(0, 20)}: text ${r ? r.right.toFixed(1) : "?"} vs PDF ${end.toFixed(1)}`);
  }
  check("each body line ends within 6 points of where the PDF's does", off.length === 0, off.join(" | "));
  const across = cap.filter((r) => r.across > -1);
  check("no caption party up against or across its side", across.length === 0, across.map((r) => `${r.text.slice(0, 24)} ${r.across.toFixed(1)}`).join(" | "));
  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  srv.stop();
}
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
