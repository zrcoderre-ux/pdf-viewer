// Browser test for a pleading's caption page beside its PDF: the attorney block
// with the clerk's e-filing stamp beside it, the firm's name in bold and the
// stamp in smaller type, and the caption's party block single-spaced beside
// its causes of action. The owner: "I am still getting incorrect sizing
// variation (as well as misjudge bolding. The caption involves all the same
// size text, yet is being shrunk", and "the bold is being mistakenly applied
// accros the entire line. Only the name of the Firm is bold up toop, not
// edgcombe w. slyaton. nothing in the party cpation box is bold in the pdf".
//
// Checked: every line of the attorney block and the caption in the PDF's 12
// point (a line's size is its first piece's, not the stamp's row beside it;
// pdfsync.firstPieceSize); the firm bold and the stamp's name beside it not
// (pdfsync.faceCovers); the stamp's italic line italic and the e-mail beside
// it not; and no line on top of another, the party block and the causes of
// action beside it each a column of its own (pdfsync.fitRuns with spans).
//
// Run: node test-caption-faces.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium)
// and a free port in 8130-8199 for python3's http.server; exits 0 with SKIP
// where any is missing. Every name in it is invented.

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

// The PDF: [text, line (a half line .5), x, size, font, drop] — `drop` points
// below the line's baseline (the stamp's rows and the causes of action are
// printed off the body's rows, as a court's stamp and a caption's second
// column are).
const R = "r", B = "b", I = "i";
const PDF = [
  // (Line 1's stamp printed nearer the number's height than the block beside it.)
  ["S. SAUNDERSON EDGERTON (SBN 094464)", 1, 72, 12, R, 3], ["Electronically FILED by", 1, 430, 9, R, -5],
  ["wimborne@example.com", 1.5, 72, 12, R, 0], ["Superior Court of California", 1.5, 420, 9, I, 3],
  ["DANFORTH HEPWORTH (SBN 991500)", 2, 72, 12, R, 0], ["County of Los Angeles", 2, 430, 9, R, 3],
  ["ROSEMONT & EDGERTON LLP", 3, 72, 12, B, 0], ["Dunmore K. Fairweather,", 3, 430, 9, R, 3],
  ["3530 Bilberry Boulevard, Suite 1300", 3.5, 72, 12, R, 0],
  ["Los Angeles, CA 90010", 4, 72, 12, R, 0],
  ["Attorneys for Plaintiff Cobalt Cal Orion, a California corporation", 6, 72, 12, R, 0],
  ["SUPERIOR COURT OF THE STATE OF CALIFORNIA", 8, 170, 12, B, 0],
  ["COBALT CAL ORION, a", 11, 72, 12, R, 0], ["CASE NO:", 11, 330, 12, R, 0],
  ["California corporation,", 11.5, 72, 12, R, 0], ["COMPLAINT FOR:", 11.5, 330, 12, R, 0],
  ["Plaintiff,", 12, 190, 12, R, 0], ["1. BREACH OF WRITTEN", 12, 330, 12, R, 6],
  ["vs.", 13, 110, 12, R, 0], ["CONTRACT;", 13, 345, 12, R, 6],
  ["ROCKHAVEN ENTERPRISES, INC., a California", 14, 72, 12, R, 0], ["2. QUANTUM MERUIT; AND", 14, 330, 12, R, 6],
  ["corporation; EASTMARK YARROWVALE, LLC, a", 14.5, 72, 12, R, 0], ["3. FORECLOSURE OF", 14.5, 330, 12, R, 6],
  ["California limited liability company; and", 15, 72, 12, R, 0], ["MECHANIC'S LIEN", 15, 345, 12, R, 6],
  ["DOES 1 to 50, inclusive,", 15.5, 72, 12, R, 0],
  ["Defendants.", 16, 190, 12, R, 0],
];
// The clerk's name is a pseudonym in the export and the real one in the PDF,
// so no piece of the PDF is found for it in the line (no key is open here).
// The export, as PDF-Linker writes such a page: the stamp on the lines of the
// block beside it, and the caption's second column on lines of its own where
// its rows fall between the body's.
const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));
const EXPORT = [
  "====== Page 1 ======",
  " 1  " + pad("S. SAUNDERSON EDGERTON (SBN 094464)", 52) + "Electronically FILED by",
  "    " + pad("wimborne@example.com", 52) + "Superior Court of California",
  " 2  " + pad("DANFORTH HEPWORTH (SBN 991500)", 52) + "County of Los Angeles",
  " 3  " + pad("ROSEMONT & EDGERTON LLP", 52) + "Edgecombe W. Slayton,",
  "    3530 Bilberry Boulevard, Suite 1300",
  " 4  Los Angeles, CA 90010",
  " 5",
  " 6  Attorneys for Plaintiff Cobalt Cal Orion, a California corporation",
  " 7",
  " 8                SUPERIOR COURT OF THE STATE OF CALIFORNIA",
  " 9",
  "10",
  "11  " + pad("COBALT CAL ORION, a", 44) + "CASE NO:",
  "    " + pad("California corporation,", 44) + "COMPLAINT FOR:",
  "12                    Plaintiff,",
  "                                                1. BREACH OF WRITTEN",
  "13          vs.",
  "                                                  CONTRACT;",
  "14  ROCKHAVEN ENTERPRISES, INC., a California",
  "                                                2. QUANTUM MERUIT; AND",
  "    corporation; EASTMARK YARROWVALE, LLC, a",
  "                                                3. FORECLOSURE OF",
  "15  California limited liability company; and",
  "                                                  MECHANIC'S LIEN",
  "    DOES 1 to 50, inclusive,",
  "16                    Defendants.",
  "17",
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
  await page.evaluate(async (text) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry("Case Caption", { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle("Case Caption", { create: true });
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
    for (const [t, line, x, size, f, drop] of items) pg.drawText(t, { x, y: base(line) - drop, size, font: fonts[f] });
    await window.__textReaderPickPdfs([new File([await doc.save()], "Complaint.pdf", { type: "application/pdf" })]);
  }, PDF);
  await page.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body.fixed"), null, { timeout: 15000 });
  await page.waitForTimeout(1000);
  const sbs = await page.$("#sbs-toggle");
  if (!(await sbs.evaluate((b) => b.getAttribute("aria-pressed") === "true"))) await sbs.click();
  await page.waitForTimeout(2500);
  const got = await page.evaluate(() => {
    const body = document.querySelector("#pages .tpage .page-body");
    const br = body.getBoundingClientRect();
    const scale = br.width / 612;
    const lines = [...body.querySelectorAll(":scope > .line")].map((l) => {
      const lt = l.querySelector(":scope > .lt");
      const text = lt ? lt.textContent : "";
      return { text, top: (l.getBoundingClientRect().top - br.top) / scale, size: parseFloat(getComputedStyle(l).fontSize) / scale, from: text.search(/\S/), to: text.trimEnd().length };
    });
    const faceOf = (t) => {
      const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (n.data.includes(t)) { const cs = getComputedStyle(n.parentElement); return { bold: Number(cs.fontWeight) >= 600, italic: cs.fontStyle === "italic" }; }
      }
      return null;
    };
    return {
      lines,
      faces: Object.fromEntries(["ROSEMONT", "Edgecombe", "Superior Court of California", "wimborne", "CONTRACT;", "MECHANIC", "vs.", "SUPERIOR COURT OF THE STATE"].map((t) => [t, faceOf(t)])),
    };
  });

  const worded = got.lines.filter((l) => l.text.trim());
  const size = (t) => { const l = worded.find((x) => x.text.includes(t)); return l ? Math.round(l.size * 10) / 10 : null; };
  const block = ["S. SAUNDERSON EDGERTON", "wimborne@", "DANFORTH HEPWORTH", "ROSEMONT", "3530 Bilberry", "Los Angeles, CA", "COBALT CAL ORION", "California corporation,", "Plaintiff,",
    "1. BREACH", "CONTRACT;", "ROCKHAVEN", "2. QUANTUM", "corporation; EASTMARK", "3. FORECLOSURE", "California limited liability", "MECHANIC", "DOES 1 to 50", "Defendants."];
  const sizes = block.map(size);
  console.log("sizes");
  check("the attorney block and the caption all in the PDF's 12 point, none shrunk", sizes.every((s) => s === 12), JSON.stringify(Object.fromEntries(block.map((t, k) => [t, sizes[k]]))));
  console.log("faces");
  const f = got.faces;
  check("the firm's name bold", f.ROSEMONT && f.ROSEMONT.bold, JSON.stringify(f.ROSEMONT));
  check("…the clerk's name beside it on its line not", f.Edgecombe && !f.Edgecombe.bold, JSON.stringify(f.Edgecombe));
  check("the stamp's italic line italic", f["Superior Court of California"] && f["Superior Court of California"].italic, JSON.stringify(f["Superior Court of California"]));
  check("…the e-mail beside it on its line not", f.wimborne && !f.wimborne.italic, JSON.stringify(f.wimborne));
  check("nothing in the caption box bold", ["CONTRACT;", "MECHANIC", "vs."].every((t) => f[t] && !f[t].bold), JSON.stringify([f["CONTRACT;"], f.MECHANIC, f["vs."]]));
  check("the court's title bold", f["SUPERIOR COURT OF THE STATE"] && f["SUPERIOR COURT OF THE STATE"].bold, JSON.stringify(f["SUPERIOR COURT OF THE STATE"]));
  console.log("spacing");
  // A line stands over another only where they share columns of the export.
  const over = (a, b) => Math.min(a.to, b.to) - Math.max(a.from, b.from) > 3;
  const clashes = [];
  worded.forEach((b, k) => { for (let j = 0; j < k; j++) { const a = worded[j]; if (over(a, b) && b.top < a.top + a.size - 0.5 && b.top > a.top - b.size + 0.5) clashes.push(`${a.text.trim().slice(0, 24)} / ${b.text.trim().slice(0, 24)}`); } });
  check("no line on top of another", clashes.length === 0, clashes.join(" | "));
  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  srv.stop();
}
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
