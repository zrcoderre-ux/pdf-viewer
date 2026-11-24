// Browser test for the rotate tool's Pages… box and its place keeping
// (viewer/rotation.js; rerenderKeepingPlace in viewer/viewer.js): an invented
// twelve-page PDF, the reader halfway down page 8; turning that page, then a
// typed range, must leave the window on page 8 where it was, at no moment
// dropping to the top of the document (the owner, 2026-11-24: rotating one
// page "moves me back up to the top of the document"); a range naming a page
// the document lacks turns nothing and says why.
//
// Run: node test-rotate-range.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium)
// and a free port in 8130-8199 for python3's http.server; exits 0 with SKIP
// where any is missing.

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
const truthy = (label, v) => check(label, !!v, true);

// ── the server ───────────────────────────────────────────────────────────────
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


let srv = null, browser = null;
async function run() {
  srv = await startServer();
  browser = await launchBrowser(chromium, CHROME);
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(srv.base + "/viewer/viewer.html");
    await page.waitForFunction(() => typeof window.__pdfViewerLoadLocal === "function");
    await page.evaluate(async () => {
      const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      for (let i = 1; i <= 12; i++) {
        const p = pdf.addPage([612, 792]);
        for (let y = 720; y > 80; y -= 24) p.drawText(`Page ${i} line ${y}`, { x: 72, y, size: 12, font });
      }
      const top = await navigator.storage.getDirectory();
      const h = await top.getFileHandle("Twelve Pages.pdf", { create: true });
      const w = await h.createWritable(); await w.write(await pdf.save()); await w.close();
      await window.__pdfViewerLoadLocal(await h.getFile(), h);
    });
    await page.waitForFunction(() => document.querySelectorAll("#pages > .page-wrapper").length === 12, null, { timeout: 20000 });
    await page.waitForTimeout(1500);

    // Halfway down page 8.
    await page.evaluate(() => {
      const w = document.querySelectorAll("#pages > .page-wrapper")[7];
      const r = w.getBoundingClientRect();
      window.scrollTo(0, window.scrollY + r.top + r.height / 2 - 100);
    });
    await page.waitForTimeout(300);
    const where = () => page.evaluate(() => {
      const ws = [...document.querySelectorAll("#pages > .page-wrapper")];
      const mid = window.innerHeight / 2;
      let best = 0, d = Infinity;
      ws.forEach((w, i) => { const r = w.getBoundingClientRect(); const dd = Math.abs(r.top + r.height / 2 - mid); if (dd < d) { d = dd; best = i + 1; } });
      const r = ws[7].getBoundingClientRect();
      return { page: best, p8top: Math.round(r.top) };
    });
    const before = await where();
    check("reading page 8", before.page, 8);
    // Record the lowest the window goes while the pages are rebuilt.
    const watchLow = () => page.evaluate(() => { window.__low = window.scrollY; window.__lowWatch = () => { window.__low = Math.min(window.__low, window.scrollY); }; document.addEventListener("scroll", window.__lowWatch, { passive: true }); });
    const low = () => page.evaluate(() => { document.removeEventListener("scroll", window.__lowWatch); return window.__low; });
    const settle = () => page.waitForTimeout(2500);

    console.log("1. one page turned: the window stays where it was");
    await page.click("#rotate-pages");
    await watchLow();
    const startY = await page.evaluate(() => window.scrollY);
    await page.click("#rot-right");
    await settle();
    const lowY = await low();
    check("page 8 turned", await page.textContent("#rot-state"), "p. 8 90°");
    const after1 = await where();
    check("still reading page 8", after1.page, 8);
    check("never sent to the top of the document", lowY > startY / 2, true);
    check("page 8 where it was on screen (within 40px)", Math.abs(after1.p8top - before.p8top) <= 40 || after1.p8top < 0 && before.p8top < 0, true);

    console.log("2. a typed range");
    check("the Pages box hidden until picked", await page.isHidden("#rot-range"), true);
    await page.selectOption("#rot-scope", "range");
    check("the Pages box shows and has the cursor", await page.evaluate(() => document.activeElement && document.activeElement.id), "rot-range");
    await watchLow();
    const startY2 = await page.evaluate(() => window.scrollY);
    await page.fill("#rot-range", "2-4, 10");
    await page.press("#rot-range", "Enter");
    await settle();
    const lowY2 = await low();
    check("pages 2-4 and 10 turned, page 8 kept", await page.textContent("#rot-state"), "p. 2 90° · p. 3 90° · p. 4 90° · +2 more");
    const after2 = await where();
    check("still reading page 8", after2.page, 8);
    if (after2.page !== 8) console.log("        ", JSON.stringify({ before, after2 }));
    check("never sent to the top of the document", lowY2 > startY2 / 2, true);
    await page.press("#rot-range", "Shift+Enter");
    await settle();
    check("Shift+Enter turns them back", await page.textContent("#rot-state"), "p. 8 90°");

    console.log("3. a page the document lacks turns nothing");
    await page.fill("#rot-range", "3, 14");
    await page.click("#rot-right");
    await page.waitForTimeout(500);
    check("nothing turned", await page.textContent("#rot-state"), "p. 8 90°");
    check("no page errors", errors, []);
  } finally {
    if (browser) await browser.close();
    if (srv) srv.stop();
  }
}
await run();
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
