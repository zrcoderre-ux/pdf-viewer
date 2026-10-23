// Browser test for 📑 PDF mode (viewer/text-reader.js, "PDF mode"): with a
// case folder open, the button puts the PDF viewer in the text's place at the
// PDF and page being read; ‹ › step between the folder's PDFs, each kept open
// in its own frame; scrolling on past the last page and auto-scroll reaching
// it go on into the next PDF; the viewer's Find goes on through the folder;
// and the same button brings the text back at the page the PDF was on.
//
// Run: node test-pdf-mode.mjs   (from the repo root)
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

// ── the key, as a real .xlsx ────────────────────────────────────────────────
function buildKey(rows) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pdf-mode-")), "pseudonym_key.xlsx");
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
const CASE = "Case PDF Mode";
const exportOf = (n, what) => Array.from({ length: n }, (_, k) => `====== Page ${k + 1} ======\n` + Array.from({ length: 50 }, (_, j) => `Page ${k + 1} of the ${what}, line ${j + 1}.`).join("\n")).join("\n") + "\n";
const A = exportOf(3, "declaration");
const B = exportOf(2, "letter");

async function makeCase(w) {
  await w.evaluate(async ({ CASE, A, B, keyBytes }) => {
    const { PDFDocument, StandardFonts } = await import(new URL("vendor/pdf-lib/pdf-lib.esm.min.js", location.href).href);
    const make = async (n, label, extra) => {
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.TimesRoman);
      for (let k = 1; k <= n; k++) {
        const p = pdf.addPage([612, 792]);
        p.drawText(`${label} page ${k}`, { x: 72, y: 700, size: 14, font });
        if (extra[k]) p.drawText(extra[k], { x: 72, y: 600, size: 14, font });
      }
      return pdf.save();
    };
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(CASE, { create: true });
    const put = async (d, name, data) => { const f = await (await d.getFileHandle(name, { create: true })).createWritable(); await f.write(data); await f.close(); };
    await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    await put(dir, "A Decl.pdf", await make(3, "Declaration", { 1: "the word quillfeather here" }));
    await put(dir, "B Letter.pdf", await make(2, "Letter", { 2: "a zephyrine clause and quillfeather again" }));
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    await put(text, "A Decl.txt", A);
    await put(text, "B Letter.txt", B);
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, A, B, keyBytes: Array.from(KEY_BYTES) });
  await w.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event("change")); } });
}

/** The frame PDF mode is showing, as Playwright's Frame, with its PDF's name. */
async function shownFrame(page) {
  const name = await page.evaluate(() => { const f = [...document.querySelectorAll("#pdf-mode iframe")].find((x) => !x.hidden); return f ? f.title : null; });
  const handle = await page.$(`#pdf-mode iframe[title="${name}"]`);
  return { name, frame: handle ? await handle.contentFrame() : null };
}
async function waitShown(page, name, pages) {
  await page.waitForFunction((n) => { const f = [...document.querySelectorAll("#pdf-mode iframe")].find((x) => !x.hidden); return f && f.title === n; }, name, { timeout: 20000 });
  const { frame } = await shownFrame(page);
  await frame.waitForFunction((k) => document.querySelectorAll("#pages > .page-wrapper").length === k, pages, { timeout: 20000 });
  await frame.waitForTimeout(600);
  return frame;
}

let srv = null, site = null, browser = null;
async function run() {
  srv = await startServer();
  browser = await launchBrowser(chromium, CHROME);
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await page.goto(srv.base + "/viewer/text-reader.html");
    await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
    await makeCase(page);
    await page.evaluate(() => window.__textReaderOpenDoc("A Decl.txt"));
    await page.waitForFunction(() => !document.getElementById("pdf-mode-btn").disabled, null, { timeout: 20000 });

    // PDF mode reads on from one PDF into the next only while the folder is read on.
    const setReel = (on) => page.evaluate((v) => { const t = document.getElementById("reel-toggle"); if (t.checked !== v) { t.checked = v; t.dispatchEvent(new Event("change")); } }, on);
    await setReel(true);
    console.log("1. PDF mode opens the PDF being read, at its page, in the viewer");
    await page.evaluate(() => { const s = document.querySelectorAll("#pages .tpage")[1]; document.getElementById("stage").scrollTop = s.offsetTop - 20; });
    await page.waitForTimeout(300);
    await page.click("#pdf-mode-btn");
    let fa = await waitShown(page, "A Decl.pdf", 3);
    check("the reader is in PDF mode", await page.evaluate(() => document.body.classList.contains("pdf-mode") && document.getElementById("pdf-mode-btn").getAttribute("aria-pressed")), "true");
    check("…at the page being read", await fa.evaluate(() => window.__pdfViewerSource().page), 2);
    check("…holding the folder's own file to save to", await fa.evaluate(() => window.__pdfViewerSource().handle && window.__pdfViewerSource().handle.name), "A Decl.pdf");
    check("…with the viewer's tools (the tools rail is there)", await fa.evaluate(() => !!document.querySelector("#tools-rail, .tools-rail, #rail")), true);
    check("the switcher lists the folder's PDFs", await page.evaluate(() => [...document.querySelectorAll("#pm-pick option")].map((o) => o.textContent)), ["A Decl", "B Letter"]);
    check("…and says where it is", await page.evaluate(() => document.getElementById("pm-where").textContent), "1 of 2");
    check("the reader's own buttons are out of the way", await page.evaluate(() => getComputedStyle(document.getElementById("save")).display), "none");

    console.log("2. ‹ › step between the PDFs, each kept open");
    await page.click("#pm-next");
    await waitShown(page, "B Letter.pdf", 2);
    check("› shows the next PDF", await page.evaluate(() => document.getElementById("pm-pick").value), "1");
    await page.click("#pm-prev");
    fa = await waitShown(page, "A Decl.pdf", 3);
    check("‹ comes back to the first, where it was left", await fa.evaluate(() => window.__pdfViewerSource().page), 2);
    check("…one frame per PDF", await page.evaluate(() => document.querySelectorAll("#pdf-mode iframe").length), 2);

    console.log("3. scrolling on past the last page goes on into the next PDF");
    await fa.evaluate(() => { const s = document.scrollingElement; s.scrollTop = s.scrollHeight; });
    await page.waitForTimeout(300);
    await page.mouse.move(700, 500);
    for (let k = 0; k < 8; k++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(40); }
    let fb = await waitShown(page, "B Letter.pdf", 2);
    check("…at its first page", await fb.evaluate(() => window.__pdfViewerSource().page), 1);
    for (let k = 0; k < 16; k++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
    fa = await waitShown(page, "A Decl.pdf", 3);
    check("…and back up past the first page into the one before, at its foot", await fa.evaluate(() => window.__pdfViewerSource().page), 3);

    console.log("4. auto-scroll reaching the end carries on into the next PDF");
    await fa.evaluate(() => window.dispatchEvent(new CustomEvent("autoscroll-end")));
    fb = await waitShown(page, "B Letter.pdf", 2);
    check("auto-scroll is running there", await fb.evaluate(() => window.__pdfViewerAutoScroll.on()), true);
    await fb.evaluate(() => document.getElementById("autoscroll-toggle").click());
    check("…until turned off", await fb.evaluate(() => window.__pdfViewerAutoScroll.on()), false);
    await page.click("#pm-prev");
    fa = await waitShown(page, "A Decl.pdf", 3);

    console.log("5. Find goes on through the folder");
    await fa.evaluate(() => window.__pdfViewerGoToPage(1));
    await fa.press("body", "Control+f");
    await fa.fill("#find-input", "zephyrine");
    await fa.press("#find-input", "Enter");
    fb = await waitShown(page, "B Letter.pdf", 2);
    await fb.waitForFunction(() => /1 of 1/.test(document.getElementById("find-count").textContent), null, { timeout: 10000 });
    truthy("a word only in the next PDF opens it, standing on the match", true);
    check("…on its page", await fb.evaluate(() => window.__pdfViewerSource().page), 2);
    await page.waitForFunction(() => /of 2$/.test(document.getElementById("pm-find").textContent), null, { timeout: 10000 });
    check("the toolbar counts it through the folder", await page.evaluate(() => document.getElementById("pm-find").textContent), "“zephyrine”: 1 in 1 PDF of 2");
    await fb.fill("#find-input", "quillfeather");
    await fb.press("#find-input", "Enter");
    await fb.waitForFunction(() => /1 of 1/.test(document.getElementById("find-count").textContent), null, { timeout: 10000 });
    await page.waitForFunction(() => /2 in 2 PDFs of 2$/.test(document.getElementById("pm-find").textContent), null, { timeout: 10000 });
    truthy("…a word in both counted in both", true);
    await fb.press("#find-input", "Enter");
    fa = await waitShown(page, "A Decl.pdf", 3);
    await fa.waitForFunction(() => /1 of 1/.test(document.getElementById("find-count").textContent), null, { timeout: 10000 });
    check("past the last match here, › goes round to the next PDF that has one", await fa.evaluate(() => window.__pdfViewerSource().page), 1);

    console.log("6. with ↕ Read folder on off, each PDF ends where it ends");
    await setReel(false);
    await fa.evaluate(() => window.__pdfViewerGoToPage(1));
    await fa.fill("#find-input", "zephyrine");
    await fa.press("#find-input", "Enter");
    await page.waitForTimeout(1500);
    check("Find stays in this PDF", (await shownFrame(page)).name, "A Decl.pdf");
    check("…and says it has nothing here", await fa.evaluate(() => document.getElementById("find-count").textContent), "No results");
    await page.waitForFunction(() => /this PDF only/.test(document.getElementById("pm-find").textContent), null, { timeout: 10000 });
    truthy("…and the toolbar says the search is this PDF only", true);
    await fa.fill("#find-input", "quillfeather");
    await fa.press("#find-input", "Enter");
    await fa.waitForFunction(() => /1 of 1/.test(document.getElementById("find-count").textContent), null, { timeout: 10000 });
    await fa.press("#find-input", "Enter");
    await page.waitForTimeout(1500);
    check("past its last match Find goes round this PDF, not on", (await shownFrame(page)).name, "A Decl.pdf");
    await fa.evaluate(() => { const s = document.scrollingElement; s.scrollTop = s.scrollHeight; });
    await page.waitForTimeout(300);
    await page.mouse.move(700, 500);
    for (let k = 0; k < 10; k++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(40); }
    await page.waitForTimeout(800);
    check("scrolling past the last page stays in it", (await shownFrame(page)).name, "A Decl.pdf");
    await fa.evaluate(() => window.dispatchEvent(new CustomEvent("autoscroll-end")));
    await page.waitForTimeout(800);
    check("…and so does auto-scroll reaching it", (await shownFrame(page)).name, "A Decl.pdf");
    await fa.press("#find-input", "Escape");

    console.log("7. the same button brings the text back, at the PDF's page");
    await page.click("#pm-next");
    fb = await waitShown(page, "B Letter.pdf", 2);
    await fb.evaluate(() => window.__pdfViewerGoToPage(2));
    await page.waitForTimeout(300);
    await page.click("#pdf-mode-btn");
    await page.waitForFunction(() => document.getElementById("st-file").textContent.startsWith("B Letter.txt"), null, { timeout: 20000 });
    await page.waitForTimeout(800);
    check("out of PDF mode", await page.evaluate(() => document.body.classList.contains("pdf-mode") || !document.getElementById("pdf-mode").hidden), false);
    check("…in the export of the PDF that was shown, at its page", await page.evaluate(() => { const st = document.getElementById("stage"); const line = st.scrollTop + st.clientHeight * 0.35; let at = null; for (const s of document.querySelectorAll("#pages .tpage")) { if (s.offsetTop > line) break; at = s; } return at ? /Page 2 of the letter/.test(at.textContent) : false; }), true);
    await page.click("#pdf-mode-btn");
    fb = await waitShown(page, "B Letter.pdf", 2);
    check("and in again, the frames still open", await page.evaluate(() => document.querySelectorAll("#pdf-mode iframe").length), 2);
    await page.keyboard.press("Control+Shift+M");
    await page.waitForFunction(() => !document.body.classList.contains("pdf-mode"), null, { timeout: 10000 });
    truthy("Ctrl+Shift+M from inside the viewer goes back too", true);
    check("no page errors", errors, []);
    await context.close();

    console.log("8. the reader's own Find, with ↕ Read folder on off: this document only");
    const reader2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const rp = await reader2.newPage();
    const rpErrors = [];
    rp.on("pageerror", (e) => rpErrors.push(e.message));
    rp.on("dialog", (d) => d.accept().catch(() => {}));
    await rp.goto(srv.base + "/viewer/text-reader.html");
    await rp.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
    await makeCase(rp);
    await rp.evaluate(() => window.__textReaderOpenDoc("A Decl.txt"));
    await rp.waitForFunction(() => document.getElementById("st-file").textContent.startsWith("A Decl.txt"), null, { timeout: 20000 });
    await rp.waitForTimeout(800);
    await rp.keyboard.press("Control+f");
    await rp.fill("#fb-input", "of the letter");
    await rp.waitForTimeout(1500);
    check("off: the bar says this document only", await rp.evaluate(() => document.getElementById("fb-rest").textContent), "· this document only (↕ Read folder on is off; Replace all still reaches the folder)");
    await rp.press("#fb-input", "Enter");
    await rp.waitForTimeout(1500);
    check("…and Enter does not open the other document", await rp.evaluate(() => document.getElementById("st-file").textContent.startsWith("A Decl.txt")), true);
    await rp.evaluate(() => { const t = document.getElementById("reel-toggle"); t.checked = true; t.dispatchEvent(new Event("change")); });
    await rp.waitForFunction(() => /in 1 other document/.test(document.getElementById("fb-rest").textContent), null, { timeout: 10000 });
    truthy("on: the rest of the folder is counted again", true);
    check("no page errors in the reader", rpErrors, []);
    await reader2.close();

    console.log("9. in the app: PDF mode in the reader's own tab");
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-mode-site-"));
    execFileSync("bash", [path.join(REPO, "pwa", "build-site.sh"), out], { stdio: "ignore" });
    site = await startServer(out);
    const app = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const shell = await app.newPage();
    const appErrors = [];
    shell.on("pageerror", (e) => appErrors.push(e.message));
    shell.on("dialog", (d) => d.accept().catch(() => {}));
    await shell.goto(site.base + "/index.html");
    await shell.setInputFiles("#file-input", { name: "A Decl.txt", mimeType: "text/plain", buffer: Buffer.from(A) });
    await shell.waitForFunction(() => { const f = document.querySelector("iframe.tab-view"); return !!(f && f.contentWindow && f.contentWindow.__textReaderAdoptFolder); }, null, { timeout: 20000 });
    const reader = shell.frames().find((f) => f.url().endsWith("/viewer/text-reader.html"));
    await reader.waitForFunction(() => document.querySelectorAll("#pages .tpage").length > 0, null, { timeout: 20000 });
    await makeCase(reader);
    await reader.evaluate(() => window.__textReaderOpenDoc("A Decl.txt"));
    await reader.waitForFunction(() => !document.getElementById("pdf-mode-btn").disabled, null, { timeout: 20000 });
    await reader.click("#pdf-mode-btn");
    const inner = await (async () => { for (let k = 0; k < 200; k++) { const f = shell.frames().find((x) => x.url().endsWith("/viewer/viewer.html") && x.parentFrame() === reader); if (f) return f; await shell.waitForTimeout(100); } return null; })();
    truthy("the viewer opens inside the reader's tab", inner);
    await inner.waitForFunction(() => document.querySelectorAll("#pages > .page-wrapper").length === 3, null, { timeout: 20000 });
    check("…on the folder's PDF, with its file to save to", await inner.evaluate(() => window.__pdfViewerSource().handle && window.__pdfViewerSource().handle.name), "A Decl.pdf");
    check("…and no second tab in the shell", await shell.evaluate(() => document.querySelectorAll("iframe.tab-view").length), 1);
    await reader.click("#pdf-mode-btn");
    await reader.waitForFunction(() => !document.body.classList.contains("pdf-mode"), null, { timeout: 10000 });
    truthy("…and back to the text", true);
    check("no page errors in the app", appErrors, []);
    await app.close();
  } finally {
    if (browser) await browser.close();
    if (srv) srv.stop();
    if (site) site.stop();
  }
}
await run();
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
