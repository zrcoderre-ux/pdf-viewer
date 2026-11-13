// Browser test for a `*CORRECT TEXT` answer written into the text at once
// (text-reader.js writeOcrFix). The owner: "Using the * should work like use
// my text, writing that revision in wherever the old value was. Also, when
// done through pdf+ it should rewrite the textfile instantly, not waiting for
// the re-run." The correction goes in wherever the value stands as a whole
// word, in each garble's casing, in every export the row names (and no other),
// a correct text the key binds written as its pseudonym; the files are saved
// at once, and Ctrl+Z puts the text back.
//
// Run: node test-ocr-fix-instant.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium),
// python3 with openpyxl (to build the key and the worksheet) and a free port
// in 8130-8199 for python3's http.server; exits 0 with SKIP where any is
// missing. Every name in it is invented.

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
async function startServer() {
  let port = 0;
  for (let p = 8130; p <= 8199; p++) if (await portFree(p)) { port = p; break; }
  if (!port) skip("no free port in 8130-8199");
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: REPO, stdio: "ignore" });
  await waitPort(port);
  return { base: `http://127.0.0.1:${port}`, stop: () => { try { proc.kill("SIGTERM"); } catch { /* gone */ } } };
}

// ── the key, as a real .xlsx ────────────────────────────────────────────────
function buildLeaks(rows) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ocr-fix-")), "LEAKS.xlsx");
  const py = `
import json, sys, openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "LEAKS"
ws.append(["Value", "Fix? (yes/no)", "Context", "File", "Type", "Where (page:line)", "Notes"])
for r in json.loads(sys.argv[2]): ws.append(r)
wb.save(sys.argv[1])
`;
  execFileSync("python3", ["-I", "-c", py, out, JSON.stringify(rows)]);
  return fs.readFileSync(out);
}
function buildKey(rows) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ocr-fix-")), "pseudonym_key.xlsx");
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

// ── the folder ───────────────────────────────────────────────────────────────
const KEY_BYTES = buildKey([["person", "Orla Vantreese", "Mira Holt", "", "", "spreadsheet", 1],
  ["person", "Pelham Grantwic", "Dorian Fane", "", "", "spreadsheet", 1], ["person", "Pelham Grantwick", "Fenwick Lowe", "", "", "spreadsheet", 1]]);
const CASE = "Case OCR Fix";
const A = ["====== Page 1 ======", "Tenant Orla Vantrese signed the cuve!nants.", "THE CUVE!NANTS RUN WITH THE LAND; cuve!nantsx stays.",
  "====== Page 2 ======", "Mira Holt and Dorian Fane witnessed it."].join("\n") + "\n";
const B = "====== Page 1 ======\nThe cuve!nants are void.\n";
const C = "====== Page 1 ======\nAn unnamed cuve!nants stays.\n";
const LEAKS_BYTES = buildLeaks([
  ["cuve!nants", "", "signed the cuve!nants.", "A Lease.txt, B Answer.txt", "REVIEW", "p.1:1", ""],
  ["Orla Vantrese", "", "Tenant Orla Vantrese signed", "A Lease.txt", "REVIEW", "p.1:1", ""],
]);

let srv = null, browser = null;
async function newReader() {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();
  const log = { errors: [] };
  page.on("pageerror", (e) => log.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) log.errors.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto(srv.base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
  await page.evaluate(async ({ CASE, A, B, C, keyBytes, leaksBytes }) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(CASE, { create: true });
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    await put(dir, "LEAKS.xlsx", new Uint8Array(leaksBytes));
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    await put(text, "A Lease.txt", A);
    await put(text, "B Answer.txt", B);
    await put(text, "C Other.txt", C);
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, A, B, C, keyBytes: Array.from(KEY_BYTES), leaksBytes: Array.from(LEAKS_BYTES) });
  await page.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event("change")); } });
  await page.evaluate(() => window.__textReaderOpenDoc("A Lease.txt"));
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 1 && window.__textReaderLeaks && window.__textReaderLeaks());
  await page.waitForTimeout(1500);
  return { context, page, log, close: () => context.close() };
}
const readFile = (p, name) => p.evaluate(async ({ CASE, name }) => {
  const top = await navigator.storage.getDirectory();
  const dir = await (await top.getDirectoryHandle(CASE)).getDirectoryHandle("Text Files");
  return (await (await dir.getFileHandle(name)).getFile()).text();
}, { CASE, name });
const fixes = (p) => p.evaluate(() => Object.fromEntries(window.__textReaderLeaks().rows.map((r) => [r.value, [r.fix, r.fix0]])));
const lastToast = (p) => p.evaluate(() => (document.getElementById("toast") || {}).textContent || "");
async function answer(p, row, cell) {
  await p.evaluate((row) => document.querySelector(`#leaks-list li[data-row="${row}"]`).click(), row);
  await p.waitForTimeout(800);
  await p.fill("#lb-typed", cell);
  await p.click("#lb-apply");
  await p.waitForTimeout(3500);
}

async function run() {
  srv = await startServer();
  browser = await launchBrowser(chromium, CHROME);
  try {
    console.log("1. *covenants on a row naming two documents");
    {
      const r = await newReader();
      const p = r.page;
      await answer(p, 0, "*covenants");
      check("the open export is rewritten and saved, each garble in its own casing, a longer word left",
        await readFile(p, "A Lease.txt"),
        ["====== Page 1 ======", "Tenant Orla Vantrese signed the covenants.", "THE COVENANTS RUN WITH THE LAND; cuve!nantsx stays.",
          "====== Page 2 ======", "Mira Holt and Dorian Fane witnessed it."].join("\n") + "\n");
      check("…and the other document the row names", await readFile(p, "B Answer.txt"), "====== Page 1 ======\nThe covenants are void.\n");
      check("…and not one it does not name", await readFile(p, "C Other.txt"), C);
      check("the answer is saved into LEAKS.xlsx with them", (await fixes(p))["cuve!nants"], ["*covenants", "*covenants"]);
      truthy("the toast says what was corrected and that it is saved", /corrected to .covenants. in 3 places across 2 documents and saved/.test(await lastToast(p)));
      console.log("2. a correction the key binds goes in as its pseudonym");
      await answer(p, 1, "*Orla Vantreese");
      const a = await readFile(p, "A Lease.txt");
      check("the file carries the pseudonym, never the real name", [a.includes("Tenant Mira Holt signed"), a.includes("Orla"), a.includes("Vantrese")], [true, false, false]);
      console.log("3. Ctrl+Z puts the text back");
      await p.click("#pages");
      await p.evaluate(() => document.activeElement && document.activeElement.blur());
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(1200);
      const shown = await p.evaluate(() => document.querySelectorAll("#pages .tpage .page-body")[0].textContent);
      truthy("the garble stands again on the page", shown.includes("Orla Vantrese"));
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("4. *CORRECT TEXT given a name in the key walk");
    {
      const r = await newReader();
      const p = r.page;
      await p.evaluate(() => document.getElementById("key-walk-btn").click());
      await p.waitForTimeout(500);
      await p.evaluate(() => {
        const sel = document.getElementById("kb-term");
        const o = [...sel.options].find((x) => x.textContent.startsWith("Pelham Grantwic →"));
        sel.value = o.value;
        sel.dispatchEvent(new Event("change"));
      });
      await p.waitForTimeout(300);
      await p.fill("#kb-typed", "*Pelham Grantwick");
      await p.press("#kb-typed", "Enter");
      await p.waitForTimeout(3500);
      const a = await readFile(p, "A Lease.txt");
      check("the misread name's pseudonym is replaced by the correct name's, and saved",
        [a.includes("Mira Holt and Fenwick Lowe witnessed it."), a.includes("Dorian Fane")], [true, false]);
      const vals = await p.evaluate(async (CASE) => {
        const d = await (await navigator.storage.getDirectory()).getDirectoryHandle(CASE);
        try { return await (await (await d.getFileHandle("New Real Values.txt")).getFile()).text(); } catch { return ""; }
      }, CASE);
      truthy("…and the answer is saved for PDF-Linker", /Pelham Grantwic\b.*\*Pelham Grantwick/.test(vals));
      check("no page errors", r.log.errors, []);
      await r.close();
    }
  } finally {
    await browser.close();
    srv.stop();
  }
  console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
  process.exit(fails ? 1 : 0);
}
await run();
