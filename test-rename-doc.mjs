// Browser test for renaming a document from its name in the top bar
// (viewer/text-reader.js startRename, renameDoc): the export is renamed on
// disk in its pseudonyms and its PDF with it in its real names, so the pair
// still pairs; Esc leaves both; a document with unsaved edits, or a name
// already taken, is refused and nothing on disk moves. The name is SHOWN in
// the real names the key gives back — the top bar, the tab's title, the
// Documents list, the status bar — and in its pseudonyms with Show fakes on
// (shownDocName).
//
// Run: node test-rename-doc.mjs   (from the repo root)
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
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rename-doc-")), "pseudonym_key.xlsx");
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
const CASE = "Case Rename";
const A = "====== Page 1 ======\nThe declaration of Tobias Wrenfield.\n====== Page 2 ======\nIt goes on.\n";
const B = "====== Page 1 ======\nA letter with no PDF.\n";

let srv = null, browser = null;
async function names(page) {
  return page.evaluate(async (CASE) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(CASE);
    const list = async (d) => { const out = []; for await (const [n, e] of d.entries()) if (e.kind === "file") out.push(n); return out.sort(); };
    return { pdfs: (await list(dir)).filter((n) => n.endsWith(".pdf")), txt: await list(await dir.getDirectoryHandle("Text Files")) };
  }, CASE);
}
const title = (page) => page.evaluate(() => { const t = document.getElementById("doc-title"); return t.isConnected && !t.hidden ? t.textContent : null; });
async function rename(page, to, key = "Enter") {
  await page.click("#doc-title");
  await page.waitForTimeout(200);
  if (!(await page.$("#doc-title-input"))) return false;
  await page.fill("#doc-title-input", to);
  await page.press("#doc-title-input", key);
  await page.waitForTimeout(1500);
  return true;
}
const lastToast = (page) => page.evaluate(() => { const t = document.getElementById("toast"); return t ? t.textContent : ""; });

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
    await page.evaluate(async ({ CASE, A, B, keyBytes }) => {
      const { PDFDocument } = await import(new URL("vendor/pdf-lib/pdf-lib.esm.min.js", location.href).href);
      const pdf = await PDFDocument.create();
      pdf.addPage([612, 792]); pdf.addPage([612, 792]);
      const top = await navigator.storage.getDirectory();
      try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
      const dir = await top.getDirectoryHandle(CASE, { create: true });
      const put = async (d, name, data) => { const f = await (await d.getFileHandle(name, { create: true })).createWritable(); await f.write(data); await f.close(); };
      await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
      await put(dir, "Corwin Ashdale Decl.pdf", await pdf.save());
      const text = await dir.getDirectoryHandle("Text Files", { create: true });
      await put(text, "Tobias Wrenfield Decl.txt", A);
      await put(text, "B Letter.txt", B);
      await window.__textReaderAdoptFolder(dir);
    }, { CASE, A, B, keyBytes: Array.from(KEY_BYTES) });
    await page.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event("change")); } });
    await page.evaluate(() => window.__textReaderOpenDoc("Tobias Wrenfield Decl.txt"));
    await page.waitForFunction(() => document.querySelectorAll("#pages .tpage").length > 0);
    await page.waitForTimeout(800);

    console.log("1. the name in the top bar, in the real names");
    check("the export's name, its pseudonyms put back", await title(page), "Corwin Ashdale Decl");
    check("the tab's title too", await page.title(), "Corwin Ashdale Decl.txt — Text Reader");
    check("the Documents list too", await page.evaluate(() => [...document.querySelectorAll("#docs-list li")].map((li) => li.firstChild.textContent)), ["B Letter", "Corwin Ashdale Decl"]);
    truthy("the status bar too", /^Corwin Ashdale Decl\.txt · /.test(await page.evaluate(() => document.getElementById("st-file").textContent)));
    truthy("its PDF is matched", await page.evaluate(() => !document.getElementById("pdf-tab-btn").disabled));
    const fakes = (on) => page.evaluate((on) => { const t = document.getElementById("fakes-toggle"); if (t.checked !== on) { t.checked = on; t.dispatchEvent(new Event("change")); } }, on);
    await fakes(true);
    check("Show fakes on: the bar in the pseudonyms", await title(page), "Tobias Wrenfield Decl");
    check("…the tab's title", await page.title(), "Tobias Wrenfield Decl.txt — Text Reader");
    check("…the Documents list", await page.evaluate(() => [...document.querySelectorAll("#docs-list li")].map((li) => li.firstChild.textContent)), ["B Letter", "Tobias Wrenfield Decl"]);
    await fakes(false);
    check("…and off again, the real names", await title(page), "Corwin Ashdale Decl");
    // 📷 Screenshot: the picture is in the pseudonyms (swapChrome), the titles with it.
    const shot = await page.evaluate(async () => {
      const c0 = document.createElement("canvas"); c0.width = 8; c0.height = 8; c0.getContext("2d").fillRect(0, 0, 8, 8);
      navigator.mediaDevices.getDisplayMedia = async () => c0.captureStream(5);
      let seen = null;
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (...a) {
        if (!seen) seen = { title: document.getElementById("doc-title").textContent, list: [...document.querySelectorAll("#docs-list li")].map((li) => li.firstChild.textContent), status: document.getElementById("st-file").textContent };
        return toBlob.apply(this, a);
      };
      document.getElementById("shot-btn").click();
      for (let t = 0; t < 100 && !seen; t++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 500));
      HTMLCanvasElement.prototype.toBlob = toBlob;
      return seen;
    });
    check("in the screenshot, the bar in the pseudonyms", shot && shot.title, "Tobias Wrenfield Decl");
    check("…the Documents list", shot && shot.list, ["B Letter", "Tobias Wrenfield Decl"]);
    truthy("…the status bar", shot && /^Tobias Wrenfield Decl\.txt · /.test(shot.status));
    check("…and the real names back after it", await title(page), "Corwin Ashdale Decl");

    console.log("2. Esc leaves it");
    truthy("a click makes it a field", await rename(page, "Something Else", "Escape"));
    check("nothing on disk moved", await names(page), { pdfs: ["Corwin Ashdale Decl.pdf"], txt: ["B Letter.txt", "Tobias Wrenfield Decl.txt"] });
    check("the name as it was", await title(page), "Corwin Ashdale Decl");

    console.log("3. renamed in its pseudonyms: the export as typed, the PDF in the real names");
    await rename(page, "Tobias Wrenfield Reply Decl");
    check("both renamed", await names(page), { pdfs: ["Corwin Ashdale Reply Decl.pdf"], txt: ["B Letter.txt", "Tobias Wrenfield Reply Decl.txt"] });
    check("the bar shows the new name", await title(page), "Corwin Ashdale Reply Decl");
    check("the tab's title too", await page.title(), "Corwin Ashdale Reply Decl.txt — Text Reader");
    truthy("…and its PDF is still its PDF", await page.evaluate(() => !document.getElementById("pdf-tab-btn").disabled));
    check("the Documents list has it", await page.evaluate(() => [...document.querySelectorAll("#docs-list li")].map((li) => li.firstChild.textContent)), ["B Letter", "Corwin Ashdale Reply Decl"]);

    console.log("4. a real name typed is written as its pseudonym in the export");
    await rename(page, "Corwin Ashdale Second Decl");
    check("export faked, PDF real", await names(page), { pdfs: ["Corwin Ashdale Second Decl.pdf"], txt: ["B Letter.txt", "Tobias Wrenfield Second Decl.txt"] });
    check("the bar shows the export's name, in the real names", await title(page), "Corwin Ashdale Second Decl");
    console.log("4a. the field opens on the name as shown, and left as it is renames nothing");
    await rename(page, "Corwin Ashdale Second Decl");
    check("nothing moved", await names(page), { pdfs: ["Corwin Ashdale Second Decl.pdf"], txt: ["B Letter.txt", "Tobias Wrenfield Second Decl.txt"] });

    console.log("5. an export with no PDF: the export alone");
    await page.evaluate(() => window.__textReaderOpenDoc("B Letter.txt"));
    await page.waitForTimeout(800);
    await rename(page, "B Letter to Counsel");
    check("renamed", await names(page), { pdfs: ["Corwin Ashdale Second Decl.pdf"], txt: ["B Letter to Counsel.txt", "Tobias Wrenfield Second Decl.txt"] });

    console.log("6. a name already taken is refused");
    await rename(page, "Tobias Wrenfield Second Decl");
    check("nothing moved", await names(page), { pdfs: ["Corwin Ashdale Second Decl.pdf"], txt: ["B Letter to Counsel.txt", "Tobias Wrenfield Second Decl.txt"] });
    truthy("…and the toast says why", /already a Tobias Wrenfield Second Decl\.txt/.test(await lastToast(page)));

    console.log("7. without move(): copied and the old removed, through a passing name where only the case changes");
    await page.evaluate(() => { delete FileSystemHandle.prototype.move; delete FileSystemFileHandle.prototype.move; });
    await rename(page, "b letter to counsel");
    check("renamed", await names(page), { pdfs: ["Corwin Ashdale Second Decl.pdf"], txt: ["Tobias Wrenfield Second Decl.txt", "b letter to counsel.txt"] });
    check("its text whole", await page.evaluate(async (CASE) => {
      const t = await (await (await navigator.storage.getDirectory()).getDirectoryHandle(CASE)).getDirectoryHandle("Text Files");
      return (await (await t.getFileHandle("b letter to counsel.txt")).getFile()).text();
    }, CASE), B);
    check("the bar shows it", await title(page), "b letter to counsel");

    console.log("8. unsaved edits keep the name");
    await page.click("#edit-toggle");
    await page.click("#pages .tpage .page-body");
    await page.keyboard.press("End");
    await page.keyboard.type(" More.");
    await page.waitForTimeout(300);
    check("no field opens", await rename(page, "Never"), false);
    truthy("…and the toast says to save first", /save your edits first/.test(await lastToast(page)));
    check("nothing moved", await names(page), { pdfs: ["Corwin Ashdale Second Decl.pdf"], txt: ["Tobias Wrenfield Second Decl.txt", "b letter to counsel.txt"] });

    check("no page errors", errors, []);
    await context.close();
  } finally {
    await browser.close();
    srv.stop();
  }
}
await run();
console.log(`\n${fails ? fails + " failed, " : "all "}${passes} passed`);
process.exit(fails ? 1 : 0);
