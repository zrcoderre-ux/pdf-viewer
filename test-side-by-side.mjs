// Browser test for ⫴ Side by side (viewer/split-view.js): a second PDF beside
// the first, each in a viewer of its own —
//   A. the viewer in a page of its own (the extension's tab) moves to
//      split.html with its PDF, and the card opens a file beside it; the
//      divider drags and halves, Scroll together moves both, and the second
//      viewer's own button closes it;
//   B. in the app, a tab's split offers the other tabs, goes and comes back
//      with its tab, and closes with it;
//   C. in the text reader's 📑 PDF mode, the folder's PDFs are offered, the
//      split stays while ‹ › change the PDF on the left and while the text is
//      back.
//
// Run: node test-side-by-side.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium),
// python3 with openpyxl (to build the key) and a free port in 8130-8199 for
// python3's http.server; exits 0 with SKIP where any is missing. Every name
// in it is invented.

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browser-for-tests.mjs";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const PW = "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = "/opt/pw-browsers/chromium";

function skip(why) { console.log(`SKIP: ${why}`); process.exit(0); }
if (!fs.existsSync(PW)) skip("Playwright is not installed at " + PW);
if (!fs.existsSync(CHROME)) skip("Chromium is not installed at " + CHROME);
try { execFileSync("python3", ["-I", "-c", "import openpyxl"], { stdio: "ignore" }); } catch { skip("python3 with openpyxl is needed to build the key"); }
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
const near = (label, got, want, tol = 4) => {
  const ok = Math.abs(got - want) <= tol;
  if (ok) passes++; else fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${got}, want ${want} ± ${tol})`}`);
};

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
async function startServer(cwd) {
  let port = 0;
  for (let p = 8130; p <= 8199; p++) if (await portFree(p)) { port = p; break; }
  if (!port) skip("no free port in 8130-8199");
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd, stdio: "ignore" });
  await waitPort(port);
  return { base: `http://127.0.0.1:${port}`, stop: () => { try { proc.kill("SIGTERM"); } catch { /* gone */ } } };
}

// ── the key, as a real .xlsx ────────────────────────────────────────────────
function buildKey(rows) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "side-by-side-")), "pseudonym_key.xlsx");
  const py = `
import json, sys, openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Pseudonym Key"
ws.append(["Category", "Real Value", "Replacement", "Context", "Status", "Source", "Occurrences"])
for r in json.loads(sys.argv[2]): ws.append(r)
wb.save(sys.argv[1])
`;
  execFileSync("python3", ["-I", "-c", py, out, JSON.stringify(rows)]);
  return fs.readFileSync(out);
}
const KEY_BYTES = buildKey([["person", "Corwin Ashdale", "Tobias Wrenfield", "", "", "spreadsheet", 4]]);
const CASE = "Case Side By Side";
const exportOf = (n, what) => Array.from({ length: n }, (_, k) => `====== Page ${k + 1} ======\n` + Array.from({ length: 50 }, (_, j) => `Page ${k + 1} of the ${what}, line ${j + 1}.`).join("\n")).join("\n") + "\n";
const A_TXT = exportOf(3, "declaration");
const B_TXT = exportOf(2, "letter");

/** PDF bytes made in the page with the vendored pdf-lib: `n` letter pages saying `label page k`. */
async function makePdf(page, n, label) {
  return Buffer.from(await page.evaluate(async ({ n, label }) => {
    const { PDFDocument, StandardFonts } = await import(new URL("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js", location.href).href);
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.TimesRoman);
    for (let k = 1; k <= n; k++) pdf.addPage([612, 792]).drawText(`${label} page ${k}`, { x: 72, y: 700, size: 14, font });
    return Array.from(await pdf.save());
  }, { n, label }));
}

async function frameOf(page, selector) {
  for (let k = 0; k < 200; k++) {
    const h = await page.$(selector);
    const f = h && (await h.contentFrame());
    if (f) return f;
    await page.waitForTimeout(100);
  }
  return null;
}
const pagesIn = (f, n) => f.waitForFunction((k) => document.querySelectorAll("#pages > .page-wrapper").length === k, n, { timeout: 20000 });
const widthOf = (page, selector) => page.evaluate((s) => Math.round(document.querySelector(s).getBoundingClientRect().width), selector);

let site = null, browser = null;
async function run() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "side-by-side-site-"));
  execFileSync("bash", [path.join(REPO, "pwa", "build-site.sh"), out], { stdio: "ignore" });
  site = await startServer(out);
  browser = await launchBrowser(chromium, CHROME);
  try {
    // The PDFs, written into the site so the viewer can read one by address.
    const ctx0 = await browser.newContext();
    const p0 = await ctx0.newPage();
    await p0.goto(site.base + "/index.html");
    const A_PDF = await makePdf(p0, 3, "Declaration");
    const B_PDF = await makePdf(p0, 2, "Letter");
    await ctx0.close();
    fs.writeFileSync(path.join(out, "A Decl.pdf"), A_PDF);
    fs.writeFileSync(path.join(out, "B Letter.pdf"), B_PDF);

    console.log("A. a viewer of its own moves to split.html");
    const ctxA = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const pa = await ctxA.newPage();
    const errA = [];
    pa.on("pageerror", (e) => errA.push(e.message));
    pa.on("dialog", (d) => d.accept().catch(() => {}));
    await pa.goto(site.base + "/viewer/viewer.html?file=" + encodeURIComponent("/A Decl.pdf"));
    await pagesIn(pa.mainFrame(), 3);
    await pa.click("#split-toggle");
    await pa.waitForURL(/\/viewer\/split\.html\?file=/, { timeout: 10000 });
    const left = await frameOf(pa, "#stage > iframe:not(.pdf-split-second)");
    await pagesIn(left, 3);
    truthy("the PDF opens again on the left", true);
    await pa.waitForSelector(".pdf-split-pick:not([hidden])", { timeout: 10000 });
    truthy("…with the card asking what goes beside it", true);
    check("the left viewer's button is pressed", await left.evaluate(() => document.getElementById("split-toggle").getAttribute("aria-pressed")), "true");
    check("the page wears the PDF's name", await pa.evaluate(() => /A Decl/.test(document.title)), true);
    // The picker of the File System Access API is not one Playwright answers:
    // the plain input it falls back to is.
    await pa.evaluate(() => { window.showOpenFilePicker = undefined; });
    const [chooser] = await Promise.all([pa.waitForEvent("filechooser"), pa.click(".pdf-split-actions .primary")]);
    await chooser.setFiles({ name: "B Letter.pdf", mimeType: "application/pdf", buffer: B_PDF });
    const right = await frameOf(pa, "iframe.pdf-split-second");
    await pagesIn(right, 2);
    truthy("Open a PDF… puts it on the right", true);
    check("…the card gone", await pa.evaluate(() => document.querySelector(".pdf-split-pick").hidden), true);
    const half = (1400 - 6) / 2;
    near("the left side is half the window", await widthOf(pa, "#stage > iframe:not(.pdf-split-second)"), half, 2);
    near("…and so is the right", await widthOf(pa, "iframe.pdf-split-second"), half, 2);
    check("the right viewer's button closes", await right.evaluate(() => /^Close side by side/.test(document.getElementById("split-toggle").title)), true);

    console.log("   the divider");
    const bar = await pa.evaluate(() => { const r = document.querySelector(".pdf-split-bar").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 80 }; });
    await pa.mouse.move(bar.x, bar.y);
    await pa.mouse.down();
    await pa.mouse.move(420, bar.y, { steps: 6 });
    await pa.mouse.up();
    near("dragged to 30%, the left side is 30%", await widthOf(pa, "#stage > iframe:not(.pdf-split-second)"), 420 - 3, 3);
    await pa.mouse.dblclick(417, bar.y);
    near("double-click halves it again", await widthOf(pa, "#stage > iframe:not(.pdf-split-second)"), half, 2);

    console.log("   scroll together");
    await left.evaluate(() => window.scrollTo(0, 0));
    await right.evaluate(() => window.scrollTo(0, 0));
    await pa.waitForTimeout(200);
    await left.evaluate(() => window.scrollTo(0, 400));
    await pa.waitForTimeout(300);
    check("off: the other side stays", await right.evaluate(() => Math.round(window.scrollY)), 0);
    await left.evaluate(() => window.scrollTo(0, 0));
    await pa.waitForTimeout(200);
    await pa.click(".pdf-split-tools button[aria-pressed]");
    check("the link button is on", await pa.evaluate(() => document.querySelector(".pdf-split-tools button[aria-pressed]").getAttribute("aria-pressed")), "true");
    await left.evaluate(() => window.scrollTo(0, 400));
    await pa.waitForFunction(() => document.querySelector("iframe.pdf-split-second").contentWindow.scrollY > 0, null, { timeout: 3000 }).catch(() => {});
    near("on: the right moves as far, page for page", await right.evaluate(() => Math.round(window.scrollY)), 400, 6);
    await right.evaluate(() => window.scrollTo(0, 100));
    await pa.waitForTimeout(400);
    near("…and the other way", await left.evaluate(() => Math.round(window.scrollY)), 100, 6);

    console.log("   closed from the right viewer's own button");
    await right.click("#split-toggle");
    await pa.waitForFunction(() => !document.querySelector("iframe.pdf-split-second"), null, { timeout: 5000 });
    truthy("the second viewer is gone", true);
    near("the left fills the page again", await widthOf(pa, "#stage > iframe"), 1400, 1);
    check("…its button no longer pressed", await left.evaluate(() => document.getElementById("split-toggle").getAttribute("aria-pressed")), "false");
    await left.click("#split-toggle");
    await pa.waitForSelector(".pdf-split-pick:not([hidden])", { timeout: 5000 });
    truthy("the left's button opens the card again", true);
    await pa.click(".pdf-split-actions button:not(.primary)");
    await pa.waitForFunction(() => !document.querySelector(".pdf-split-bar"), null, { timeout: 5000 });
    truthy("…and Close on the card closes the split", true);
    check("no page errors", errA, []);
    await ctxA.close();

    console.log("B. in the app, a split per tab");
    const ctxB = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const shell = await ctxB.newPage();
    const errB = [];
    shell.on("pageerror", (e) => errB.push(e.message));
    shell.on("dialog", (d) => d.accept().catch(() => {}));
    await shell.goto(site.base + "/index.html");
    await shell.setInputFiles("#file-input", [
      { name: "A Decl.pdf", mimeType: "application/pdf", buffer: A_PDF },
      { name: "B Letter.pdf", mimeType: "application/pdf", buffer: B_PDF },
    ]);
    await shell.waitForFunction(() => document.querySelectorAll("iframe.tab-view").length === 2);
    const tabB = await frameOf(shell, "iframe.tab-view.active");
    await pagesIn(tabB, 2);
    await tabB.click("#split-toggle");
    await shell.waitForSelector(".pdf-split-pick:not([hidden])", { timeout: 10000 });
    check("the card offers the other tab", await shell.evaluate(() => [...document.querySelectorAll(".pdf-split-list button span")].map((s) => s.textContent)), ["A Decl"]);
    await shell.click(".pdf-split-list button");
    const besideB = await frameOf(shell, "iframe.pdf-split-second");
    await pagesIn(besideB, 3);
    truthy("…and opens it beside", true);
    near("the tab's own viewer is half the window", await widthOf(shell, "iframe.tab-view.active"), half, 2);
    near("…and so is the one beside it", await widthOf(shell, "iframe.pdf-split-second"), half, 2);
    await shell.click(".tab:not(.active):not(.text)");
    await shell.waitForFunction(() => document.querySelector("iframe.pdf-split-second").classList.contains("pdf-split-away"));
    truthy("another tab: the split goes with its tab", true);
    near("…and that tab fills the window", await widthOf(shell, "iframe.tab-view.active"), 1400, 1);
    await shell.click("#home-tab");
    await shell.click(".tab:not(.active)");
    await shell.waitForFunction(() => document.querySelectorAll("iframe.tab-view.active").length === 1);
    await shell.click(".tab:not(.active)");
    await shell.waitForFunction(() => !document.querySelector("iframe.pdf-split-second").classList.contains("pdf-split-away"));
    truthy("back: it comes back with it", true);
    await shell.click(".tab.active .tab-close");
    await shell.waitForFunction(() => !document.querySelector("iframe.pdf-split-second") && !document.querySelector(".pdf-split-bar"), null, { timeout: 5000 });
    truthy("closing the tab closes its split", true);
    check("no page errors in the app", errB, []);
    await ctxB.close();

    console.log("C. in PDF mode");
    const ctxC = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const rp = await ctxC.newPage();
    const errC = [];
    rp.on("pageerror", (e) => errC.push(e.message));
    rp.on("dialog", (d) => d.accept().catch(() => {}));
    await rp.goto(site.base + "/viewer/text-reader.html");
    await rp.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
    await rp.evaluate(async ({ CASE, A_TXT, B_TXT, A, B, keyBytes }) => {
      const top = await navigator.storage.getDirectory();
      try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
      const dir = await top.getDirectoryHandle(CASE, { create: true });
      const put = async (d, name, data) => { const f = await (await d.getFileHandle(name, { create: true })).createWritable(); await f.write(data); await f.close(); };
      await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
      await put(dir, "A Decl.pdf", new Uint8Array(A));
      await put(dir, "B Letter.pdf", new Uint8Array(B));
      const text = await dir.getDirectoryHandle("Text Files", { create: true });
      await put(text, "A Decl.txt", A_TXT);
      await put(text, "B Letter.txt", B_TXT);
      await window.__textReaderAdoptFolder(dir);
    }, { CASE, A_TXT, B_TXT, A: Array.from(A_PDF), B: Array.from(B_PDF), keyBytes: Array.from(KEY_BYTES) });
    await rp.evaluate(() => window.__textReaderOpenDoc("A Decl.txt"));
    await rp.waitForFunction(() => !document.getElementById("pdf-mode-btn").disabled, null, { timeout: 20000 });
    await rp.click("#pdf-mode-btn");
    const fa = await frameOf(rp, '#pdf-mode iframe[title="A Decl.pdf"]');
    await pagesIn(fa, 3);
    await fa.click("#split-toggle");
    await rp.waitForSelector(".pdf-split-pick:not([hidden])", { timeout: 10000 });
    check("the card offers the folder's other PDFs", await rp.evaluate(() => [...document.querySelectorAll(".pdf-split-list button span")].map((s) => s.textContent)), ["B Letter"]);
    await rp.click(".pdf-split-list button");
    const beside = await frameOf(rp, "#pdf-mode iframe.pdf-split-second");
    await pagesIn(beside, 2);
    check("…opened beside, holding the folder's own file to save to", await beside.evaluate(() => window.__pdfViewerSource().handle && window.__pdfViewerSource().handle.name), "B Letter.pdf");
    near("the PDF on the left is half the window", await widthOf(rp, '#pdf-mode iframe[title="A Decl.pdf"]'), half, 2);
    near("…and so is the one beside it", await widthOf(rp, "#pdf-mode iframe.pdf-split-second"), half, 2);
    await rp.click("#pm-next");
    const fb = await frameOf(rp, '#pdf-mode iframe[title="B Letter.pdf"]');
    await pagesIn(fb, 2);
    await rp.waitForFunction(() => !document.querySelector('#pdf-mode iframe[title="B Letter.pdf"]').hidden);
    near("› changes the left, which keeps half the window", await widthOf(rp, '#pdf-mode iframe[title="B Letter.pdf"]'), half, 2);
    check("…and the PDF beside stays", await rp.evaluate(() => !!document.querySelector("#pdf-mode iframe.pdf-split-second") && !document.querySelector(".pdf-split-second").classList.contains("pdf-split-away")), true);
    check("…the new left viewer's button pressed too", await fb.evaluate(() => document.getElementById("split-toggle").getAttribute("aria-pressed")), "true");
    await beside.press("body", "Control+Shift+M");
    await rp.waitForFunction(() => !document.body.classList.contains("pdf-mode"), null, { timeout: 10000 });
    truthy("Ctrl+Shift+M from the PDF beside goes back to the text", true);
    await rp.click("#pdf-mode-btn");
    await rp.waitForFunction(() => document.body.classList.contains("pdf-mode"));
    check("in again, the PDF beside is still there", await rp.evaluate(() => !!document.querySelector("#pdf-mode iframe.pdf-split-second")), true);
    await rp.click(".pdf-split-tools button:last-child");
    await rp.waitForFunction(() => !document.querySelector(".pdf-split-second"), null, { timeout: 5000 });
    truthy("× on the divider closes it", true);
    check("no page errors in the reader", errC, []);
    await ctxC.close();
  } finally {
    if (browser) await browser.close();
    if (site) site.stop();
  }
}
await run();
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
