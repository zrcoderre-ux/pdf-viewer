// Browser test for Resize pages in the PDF viewer (viewer/features.js
// resizeDialog; pdf-edit.js resizePages): a PDF with a 20 × 24 in page opened
// from a file handle, the dialog's count of the pages it would change, and the
// file saved in place with that page on Letter, its text still text, and the
// Letter page left as it was.
//
// Run: node test-resize-viewer.mjs   (from the repo root)
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
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await page.goto(srv.base + "/viewer/viewer.html");
    await page.waitForFunction(() => typeof window.__pdfViewerLoadLocal === "function");
    await page.evaluate(async () => {
      const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      pdf.addPage([1440, 1728]).drawText("Exhibit drawing sheet", { x: 100, y: 1600, size: 24, font });
      pdf.addPage([612, 792]).drawText("An ordinary page", { x: 72, y: 700, size: 12, font });
      const top = await navigator.storage.getDirectory();
      const h = await top.getFileHandle("Drawing.pdf", { create: true });
      const w = await h.createWritable(); await w.write(await pdf.save()); await w.close();
      window.__h = h;
      await window.__pdfViewerLoadLocal(await h.getFile(), h);
    });
    await page.waitForFunction(() => document.querySelectorAll("#pages > .page-wrapper").length === 2, null, { timeout: 20000 });
    await page.waitForTimeout(800);

    console.log("1. the dialog counts the pages over the size");
    await page.evaluate(() => document.getElementById("resize-pages-btn").click());
    await page.waitForSelector(".modal .resize-preview");
    await page.waitForTimeout(300);
    check("Letter: page 1 alone", await page.textContent(".modal .resize-preview"), "1 of 2 pages will be resized (page 1; the largest, page 1, is 20 × 24 in).");
    await page.selectOption(".modal .paper", "custom");
    await page.fill(".modal .c-w", "18");
    await page.fill(".modal .c-h", "18");
    check("a custom 18 × 18 in: page 1 still", (await page.textContent(".modal .resize-preview")).startsWith("1 of 2 pages will be resized"), true);
    await page.fill(".modal .c-w", "30");
    await page.fill(".modal .c-h", "30");
    check("30 × 30 in: nothing to do", await page.textContent(".modal .resize-preview"), "Every page chosen already fits this size: nothing to resize.");
    await page.selectOption(".modal .paper", "letter");

    console.log("2. resized and saved in place");
    await page.click(".modal .modal-actions button:has-text(\"Resize & save\")");
    await page.waitForFunction(() => !document.querySelector(".modal .resize-preview"), null, { timeout: 20000 });
    await page.waitForTimeout(1500);
    const saved = await page.evaluate(async () => {
      const { PDFDocument } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
      const doc = await PDFDocument.load(await (await window.__h.getFile()).arrayBuffer());
      return doc.getPages().map((p) => { const b = p.getMediaBox(); return [b.width, b.height]; });
    });
    check("the file on disk: page 1 on Letter, page 2 as it was", saved, [[612, 792], [612, 792]]);
    check("the viewer shows the saved file", await page.evaluate(() => document.querySelectorAll("#pages > .page-wrapper").length), 2);
    check("page 1's text is still text", await page.evaluate(() => document.querySelector("#pages > .page-wrapper .textLayer").textContent.includes("Exhibit drawing sheet")), true);
    check("no page errors", errors, []);
  } finally {
    if (browser) await browser.close();
    if (srv) srv.stop();
  }
}
await run();
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
