// Browser test for ↗ Open PDF in new tab (viewer/text-reader.js openPdfInTab;
// pwa/app-web.js __appOpenPdf): with a case folder open, the export's PDF opens
// in a new tab of the PDF viewer — the PDF alone, at the page being read — and
// the button stays off for an export no PDF matches. In the app (the site
// pwa/build-site.sh assembles) the PDF opens as a tab of the shell's own.
//
// Run: node test-pdf-tab.mjs   (from the repo root)
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
// On disk the exports carry the FAKES; the key turns them back on screen.
// "Ashdale" is bound on its own, so a name typed as "Ashdale" is offered.
function buildKey(rows, pinned = []) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pdf-tab-")), "pseudonym_key.xlsx");
  const py = `
import json, sys, openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Pseudonym Key"
head = ["Category", "Real Value", "Replacement", "Context", "Status", "Source", "Occurrences"]
ws.append(head)
for r in json.loads(sys.argv[2]): ws.append(r)
pinned = json.loads(sys.argv[3])
if pinned:
    p = wb.create_sheet("Pinned (never in text)")
    p.append(head)
    for r in pinned: p.append(r)
wb.save(sys.argv[1])
`;
  execFileSync("python3", ["-I", "-c", py, out, JSON.stringify(rows), JSON.stringify(pinned)]);
  return fs.readFileSync(out);
}
const KEY_BYTES = buildKey([
  ["person", "Corwin Ashdale", "Tobias Wrenfield", "", "", "spreadsheet", 4],
]);
const CASE = "Case PDF Tab";
const A = Array.from({ length: 3 }, (_, k) => `====== Page ${k + 1} ======\n` + Array.from({ length: 50 }, (_, j) => `Page ${k + 1} of the declaration, line ${j + 1}.`).join("\n")).join("\n") + "\n";
const B = "====== Page 1 ======\nA letter with no PDF.\n";

/** The case folder in the origin's private file system, adopted by the reader in `w`. */
async function makeCase(w) {
  await w.evaluate(async ({ CASE, A, B, keyBytes }) => {
    const { PDFDocument, StandardFonts } = await import(new URL("vendor/pdf-lib/pdf-lib.esm.min.js", location.href).href);
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.TimesRoman);
    for (let k = 1; k <= 3; k++) pdf.addPage([612, 792]).drawText(`Declaration page ${k}`, { x: 72, y: 700, size: 14, font });
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(CASE, { create: true });
    const put = async (d, name, data) => { const f = await (await d.getFileHandle(name, { create: true })).createWritable(); await f.write(data); await f.close(); };
    await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    await put(dir, "A Decl.pdf", await pdf.save());
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    await put(text, "A Decl.txt", A);
    await put(text, "B Letter.txt", B);
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, A, B, keyBytes: Array.from(KEY_BYTES) });
  await w.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event("change")); } });
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

    console.log("1. no PDF matched: the button is off");
    await page.evaluate(() => window.__textReaderOpenDoc("B Letter.txt"));
    await page.waitForTimeout(1200);
    check("off for an export with no PDF", await page.evaluate(() => document.getElementById("pdf-tab-btn").disabled), true);

    console.log("2. the export's PDF opens in a new tab, alone, at the page being read");
    await page.evaluate(() => window.__textReaderOpenDoc("A Decl.txt"));
    await page.waitForTimeout(1200);
    check("lit for an export with its PDF", await page.evaluate(() => document.getElementById("pdf-tab-btn").disabled), false);
    await page.evaluate(() => { const s = document.querySelectorAll("#pages .tpage")[1]; document.getElementById("stage").scrollTop = s.offsetTop - 20; });
    await page.waitForTimeout(300);
    const [tab] = await Promise.all([context.waitForEvent("page"), page.click("#pdf-tab-btn")]);
    const tabErrors = [];
    tab.on("pageerror", (e) => tabErrors.push(e.message));
    await tab.waitForLoadState();
    check("the new tab is the PDF viewer", new URL(tab.url()).pathname, "/viewer/viewer.html");
    await tab.waitForFunction(() => document.querySelectorAll("#pages > .page-wrapper").length === 3, null, { timeout: 20000 });
    truthy("it shows the PDF's three pages", true);
    await tab.waitForTimeout(1200);
    check("…named for the PDF", await tab.evaluate(() => document.getElementById("filename").textContent.trim()), "A Decl");
    check("…at the page being read", await tab.evaluate(() => window.__pdfViewerSource().page), 2);
    check("…holding the folder's own file to save to", await tab.evaluate(() => window.__pdfViewerSource().handle && window.__pdfViewerSource().handle.name), "A Decl.pdf");
    check("…and no text reader in it", await tab.evaluate(() => !!document.querySelector(".page-body, #pdf-pane")), false);
    check("the reader stays where it was", await page.evaluate(() => document.getElementById("st-file").textContent.startsWith("A Decl.txt")), true);
    check("no page errors", errors.concat(tabErrors), []);
    await context.close();

    console.log("3. in the app: the PDF opens as a tab of the shell's, beside the reader's");
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-tab-site-"));
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
    await reader.waitForFunction(() => !document.getElementById("pdf-tab-btn").disabled, null, { timeout: 20000 });
    const pagesBefore = app.pages().length;
    await reader.click("#pdf-tab-btn");
    await shell.waitForFunction(() => document.querySelectorAll("iframe.tab-view").length === 2, null, { timeout: 20000 });
    check("no browser tab is opened", app.pages().length, pagesBefore);
    const viewer = await (async () => { for (let k = 0; k < 100; k++) { const f = shell.frames().find((x) => x.url().endsWith("/viewer/viewer.html")); if (f) return f; await shell.waitForTimeout(100); } return null; })();
    truthy("the shell's new tab is the PDF viewer", viewer);
    await viewer.waitForFunction(() => document.querySelectorAll("#pages > .page-wrapper").length === 3, null, { timeout: 20000 });
    check("…showing the PDF, with the folder's own file to save to", await viewer.evaluate(() => window.__pdfViewerSource().handle && window.__pdfViewerSource().handle.name), "A Decl.pdf");
    check("…and it is the tab in front", await shell.evaluate(() => { const t = document.querySelector(".tab.active"); return t ? t.textContent.includes("A Decl") && !t.textContent.includes(".txt") : false; }), true);
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
