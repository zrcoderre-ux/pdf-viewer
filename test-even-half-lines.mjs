// Browser test for one type size between a pleading's numbers
// (pdfsync.evenHalfLines, from text-reader.js's matched layout): a half line
// the PDF prints in smaller type is drawn in the page's size, a run of small
// type down the numbers (a footnote) in one size, its PDF's, and nothing on
// the page ever taken under the PDF's own size.
//
// Run: node test-even-half-lines.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium)
// and a free port in 8130-8199 for python3's http.server; exits 0 with SKIP
// where any is missing. Every name in it is invented.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const PW = "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = "/opt/pw-browsers/chromium";

function skip(why) { console.log(`SKIP: ${why}`); process.exit(0); }
if (!fs.existsSync(PW)) skip("Playwright is not installed at " + PW);
if (!fs.existsSync(CHROME)) skip("Chromium is not installed at " + CHROME);
const { chromium } = await import(PW);

let fails = 0, passes = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passes++; else fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        got : ${JSON.stringify(got)}`);
    console.log(`        want: ${JSON.stringify(want)}`);
  }
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

const BODY = { 1: "Plaintiff Ashby states as follows.", 2: "The parties are named below.", 5: "Parties: Plaintiff Ashby is a creditor of the Estate.", 6: "Angeles Superior Court sits here.", 8: "The Debt: provided to the decedent over many months.", 9: "Bookkeeper wages were promised." };

/** A pleading page and its export: `halves`, per number, the half lines under it as [text, PDF type size, spacing]; `small`, per number, the numbered line's own size where not 12. */
async function open(browser, base, halves, small = {}) {
  const lines = ["====== Page 1 ======"];
  for (let n = 1; n <= 12; n++) { lines.push(`${String(n).padStart(2)}  ${BODY[n] || ""}`.trimEnd()); for (const [t] of halves[n] || []) lines.push("    " + t); }
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder);
  await page.evaluate(async (text) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry("Case Even", { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle("Case Even", { create: true });
    const t = await dir.getDirectoryHandle("Text Files", { create: true });
    const w = await (await t.getFileHandle("A Decl.txt", { create: true })).createWritable(); await w.write(text); await w.close();
    await window.__textReaderAdoptFolder(dir);
    await window.__textReaderOpenDoc("A Decl.txt");
  }, lines.join("\n") + "\n");
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.evaluate(async ({ BODY, halves, small }) => {
    const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.TimesRoman);
    const pg = pdf.addPage([612, 792]);
    for (let n = 1; n <= 28; n++) {
      const y = 792 - (100 + (n - 1) * 24);
      pg.drawText(String(n), { x: 46 - font.widthOfTextAtSize(String(n), 12), y, size: 12, font });
      if (BODY[n]) pg.drawText(BODY[n], { x: 72, y, size: small[n] || 12, font });
      (halves[n] || []).forEach(([t, size, gap], k) => pg.drawText(t, { x: 72, y: y - (k + 1) * gap, size, font }));
    }
    await window.__textReaderPickPdfs([new File([await pdf.save()], "A Decl.pdf", { type: "application/pdf" })]);
  }, { BODY, halves, small });
  await page.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body.fixed"), null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const sizes = await page.evaluate(() => [...document.querySelectorAll("#pages .tpage .page-body > .line")].map((l) => parseFloat(getComputedStyle(l).fontSize)));
  const texts = await page.evaluate(() => [...document.querySelectorAll("#pages .tpage .page-body > .line")].map((l) => l.textContent));
  return { sizes, texts, errors, close: () => page.context().close() };
}

const srv = await startServer();
const browser = await chromium.launch({ executablePath: CHROME });
try {
  console.log("1. a half line the PDF prints in 7 point, under 12-point body type");
  {
    const r = await open(browser, srv.base, { 5: [["duly appointed Personal Representative of the Estate in the Los", 7, 12]] });
    check("every line in one size", new Set(r.sizes.map((s) => Math.round(s * 100))).size, 1);
    check("…the body's, nothing taken down", r.sizes[5] > 15, true);
    check("no page errors", r.errors, []);
    await r.close();
  }
  console.log("2. two half lines crammed into one gap: nothing on the page taken down");
  {
    const r = await open(browser, srv.base, { 5: [["duly appointed Personal Representative of the Estate in the Los", 7, 12]], 8: [["check for tax check for the year this check was returned", 12, 8], ["the bank letter indicating the check was returned for funds", 12, 8]] });
    check("every line in one size", new Set(r.sizes.map((s) => Math.round(s * 100))).size, 1);
    check("…the PDF's 12 point (16px at this width), not two thirds of it", r.sizes.map((s) => Math.round(s)), r.sizes.map(() => 16));
    check("no page errors", r.errors, []);
    await r.close();
  }
  console.log("3. a footnote in 8 point down lines 8-9, a half line between them");
  {
    const r = await open(browser, srv.base, { 8: [["footnote text continued on the half line below it", 8, 12]] }, { 8: 8, 9: 8 });
    const at = (n) => r.sizes[r.texts.findIndex((t) => t.startsWith(String(n).padStart(2) + " "))];
    const half = r.sizes[r.texts.findIndex((t) => t.includes("footnote text continued"))];
    check("the footnote's numbered lines and its half line in one size, the PDF's 8 point", [at(8), half, at(9)].map((s) => Math.round(s * 3 / 4)), [8, 8, 8]);
    check("…the body beside it at the PDF's 12 point", [at(1), at(5), at(6)].map((s) => Math.round(s * 3 / 4)), [12, 12, 12]);
    check("no page errors", r.errors, []);
    await r.close();
  }
} finally {
  await browser.close();
  srv.stop();
}
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
