// Browser test for Find starting where the reading is (viewer/find.js `go`
// and `openAt`; viewer/text-reader.js findFromHere): Ctrl+F opened with page
// 6 of 10 on screen stands on page 6's first match, not the document's first,
// counts every match in the document, and Enter goes on forward and round the
// end to page 1. Checked in the PDF viewer and in the text reader, each with
// an invented ten-page document.
//
// Run: node test-find-from-here.mjs   (from the repo root)
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
async function waitPort(port, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await new Promise((resolve) => {
      const c = net.connect(port, "127.0.0.1", () => { c.end(); resolve(true); });
      c.on("error", () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("http.server did not come up on " + port);
}
async function startServer(cwd = REPO) {
  let port = 0;
  for (let p = 8130; p <= 8199; p++) if (await portFree(p)) { port = p; break; }
  if (!port) skip("no free port in 8130-8199");
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd, stdio: "ignore" });
  await waitPort(port);
  return { base: `http://127.0.0.1:${port}`, stop: () => { try { proc.kill("SIGTERM"); } catch { /* gone */ } } };
}

const PAGES = 10;
// Two matches a page: "Brannock Ledger" on lines 3 and 20.
const line = (k, j) => (j === 2 || j === 19 ? `Page ${k + 1} line ${j + 1}: the Brannock Ledger entry.` : `Page ${k + 1} line ${j + 1}: nothing to see here.`);

let srv = null, browser = null;
async function run() {
  srv = await startServer();
  browser = await launchBrowser(chromium, CHROME);
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });

    console.log("1. the PDF viewer");
    {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("dialog", (d) => d.accept().catch(() => {}));
      await page.goto(srv.base + "/viewer/viewer.html");
      await page.waitForFunction(() => typeof window.__pdfViewerLoadLocal === "function");
      await page.evaluate(async ({ PAGES, src }) => {
        const line = new Function("k", "j", `return (${src})(k, j);`);
        const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        for (let k = 0; k < PAGES; k++) { const pg = pdf.addPage([612, 792]); for (let j = 0; j < 28; j++) pg.drawText(line(k, j), { x: 72, y: 740 - j * 24, size: 11, font }); }
        const top = await navigator.storage.getDirectory();
        const h = await top.getFileHandle("Ledger.pdf", { create: true });
        const w = await h.createWritable(); await w.write(await pdf.save()); await w.close();
        await window.__pdfViewerLoadLocal(await h.getFile(), h);
      }, { PAGES, src: line.toString() });
      await page.waitForFunction((n) => document.querySelectorAll("#pages > .page-wrapper").length === n, PAGES, { timeout: 20000 });
      await page.waitForFunction((n) => [...document.querySelectorAll("#pages > .page-wrapper .textLayer")].filter((l) => l.textContent.includes("Brannock")).length === n, PAGES, { timeout: 20000 });
      await page.waitForTimeout(500);
      const toPage = (n) => page.evaluate((n) => { const w = document.querySelector(`#pages > .page-wrapper[data-page-number="${n}"]`); window.scrollTo(0, w.getBoundingClientRect().top + window.scrollY - 80); }, n);
      const count = () => page.evaluate(() => document.getElementById("find-count").textContent);
      await toPage(6); await page.waitForTimeout(600);
      await page.keyboard.press("Control+f");
      await page.waitForSelector("#find-input", { state: "visible" });
      await page.keyboard.type("Brannock Ledger");
      await page.waitForTimeout(800);
      check("opened on page 6: page 6's first match, of every match in the document", await count(), `11 of ${PAGES * 2}`);
      for (let k = 0; k < 10; k++) { await page.keyboard.press("Enter"); await page.waitForTimeout(60); }
      check("…Enter ten times: round the end to page 1's first", await count(), `1 of ${PAGES * 2}`);
      await page.keyboard.press("Escape");
      await toPage(9); await page.waitForTimeout(600);
      await page.keyboard.press("Control+f");
      await page.waitForTimeout(800);
      check("closed and opened again on page 9: page 9's first", await count(), `17 of ${PAGES * 2}`);
      check("openAt on page 4 going forward: page 4's first", await page.evaluate(() => window.__pdfViewerFind("Brannock Ledger", {}, 1, 4)), PAGES * 2);
      check("…stood on", await count(), `7 of ${PAGES * 2}`);
      check("openAt on a page with none past the end of the matches: round to the first", [await page.evaluate(() => window.__pdfViewerFind("Page 3 line 3:", {}, 1, 5)), await count()], [1, "1 of 1"]);
      check("no page errors", errors, []);
      await page.close();
    }

    console.log("2. the text reader");
    {
      const p = await context.newPage();
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("dialog", (d) => d.accept().catch(() => {}));
      await p.goto(srv.base + "/viewer/text-reader.html");
      await p.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
      const TEXT = Array.from({ length: PAGES }, (_, k) => `====== Page ${k + 1} ======\n` + Array.from({ length: 28 }, (_, j) => String(j + 1).padStart(2) + "  " + line(k, j)).join("\n")).join("\n") + "\n";
      await p.evaluate(async ({ TEXT }) => {
        const top = await navigator.storage.getDirectory();
        try { await top.removeEntry("Case Find", { recursive: true }); } catch { /* none yet */ }
        const dir = await top.getDirectoryHandle("Case Find", { create: true });
        const text = await dir.getDirectoryHandle("Text Files", { create: true });
        const w = await (await text.getFileHandle("Ledger.txt", { create: true })).createWritable(); await w.write(TEXT); await w.close();
        await window.__textReaderAdoptFolder(dir);
      }, { TEXT });
      await p.evaluate((n) => window.__textReaderOpenDoc(n), "Ledger.txt");
      await p.waitForFunction((n) => document.querySelectorAll("#pages .tpage .page-body").length === n, PAGES, { timeout: 20000 });
      await p.waitForTimeout(800);
      const toPage = (n) => p.evaluate((i) => { document.getElementById("stage").scrollTop = document.querySelector(`#pages .tpage[data-index="${i}"]`).offsetTop; }, n - 1);
      const count = () => p.evaluate(() => document.getElementById("fb-count").textContent);
      const where = () => p.evaluate(() => document.getElementById("fb-where").textContent);
      await toPage(6); await p.waitForTimeout(600);
      await p.keyboard.press("Control+f");
      await p.waitForSelector("#fb-input", { state: "visible" });
      await p.keyboard.type("Brannock Ledger");
      await p.waitForTimeout(1200);
      check("opened on page 6: page 6's first hit, of every hit in the document", [await count(), await where()], [`11 of ${PAGES * 2} here`, "Page 6:3"]);
      for (let k = 0; k < 10; k++) { await p.keyboard.press("Enter"); await p.waitForTimeout(250); }
      check("…Enter ten times: round the end to page 1's first", [await count(), await where()], [`1 of ${PAGES * 2} here`, "Page 1:3"]);
      await p.keyboard.press("Escape"); await p.waitForTimeout(300);
      await toPage(9); await p.waitForTimeout(800);
      await p.keyboard.press("Control+f");
      await p.waitForTimeout(1200);
      check("closed and opened again on page 9: page 9's first", [await count(), await where()], [`17 of ${PAGES * 2} here`, "Page 9:3"]);
      check("no page errors", errors, []);
      await p.close();
    }
  } finally {
    if (browser) await browser.close();
    if (srv) srv.stop();
  }
}
await run();
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
