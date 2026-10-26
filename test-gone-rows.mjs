// Browser test for a LEAKS row answered no once the pages no longer carry its
// value (text-reader.js answerGoneRows, liveTextOfDoc). The owner: "Clicking
// did not OCR should automatically mark no all flagged words that appear only
// on did not OCR pages, same for when a use my text page has deleted that
// word." A row whose value stands on another page, or in another document of
// the folder, is left; so is one the key fakes elsewhere in the case, where a
// no (a keep) would un-fake it.
//
// Run: node test-gone-rows.mjs   (from the repo root)
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
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gone-rows-")), "LEAKS.xlsx");
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
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gone-rows-")), "pseudonym_key.xlsx");
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
const KEY_BYTES = buildKey([["person", "Orla Vantreese", "Mira Holt", "", "", "spreadsheet", 1], ["person", "Pelham Grantwick", "Dorian Fane", "", "", "spreadsheet", 1]]);

// ── the folder ───────────────────────────────────────────────────────────────
const CASE = "Case Gone Rows";
// Page 2 is OCR soup carrying three names in the clear; page 1 carries one of
// them again and the pseudonym of another.
const A = ["====== Page 1 ======", "Tenant Mira Holt signed. Pelham Grantwick witnessed it.",
  "====== Page 2 ======", "Qu3ntin Larrabee ~~ Pelham Grantwick ;; Orla Vantreese #4 Ysolde Marrick"].join("\n") + "\n";
// Another document of the folder carries the fourth.
const B = "====== Page 1 ======\nYsolde Marrick filed the answer.\n";
const LEAKS_BYTES = buildLeaks([
  ["Qu3ntin Larrabee", "", "Qu3ntin Larrabee ~~", "A Lease.txt", "LEAK", "p.2:1", ""],
  ["Pelham Grantwick", "", "Pelham Grantwick witnessed", "A Lease.txt", "LEAK", "p.1:1, p.2:1", ""],
  ["Orla Vantreese", "", ";; Orla Vantreese #4", "A Lease.txt", "LEAK", "p.2:1", ""],
  ["Ysolde Marrick", "", "#4 Ysolde Marrick", "A Lease.txt, B Answer.txt", "LEAK", "p.2:1", ""],
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
  await page.evaluate(async ({ CASE, A, B, keyBytes, leaksBytes }) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(CASE, { create: true });
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    await put(dir, "LEAKS.xlsx", new Uint8Array(leaksBytes));
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    await put(text, "A Lease.txt", A);
    await put(text, "B Answer.txt", B);
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, A, B, keyBytes: Array.from(KEY_BYTES), leaksBytes: Array.from(LEAKS_BYTES) });
  await page.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event("change")); } });
  await page.evaluate(() => window.__textReaderOpenDoc("A Lease.txt"));
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 1 && window.__textReaderLeaks && window.__textReaderLeaks());
  await page.waitForTimeout(1500);
  return { context, page, log, close: () => context.close() };
}
const fixes = (p) => p.evaluate(() => Object.fromEntries(window.__textReaderLeaks().rows.map((r) => [r.value, r.fix])));
const lastToast = (p) => p.evaluate(() => (document.getElementById("toast") || {}).textContent || "");

async function run() {
  srv = await startServer();
  browser = await launchBrowser(chromium, CHROME);
  try {
    console.log("1. ⊘ Did not OCR on the page of soup");
    {
      const r = await newReader();
      const p = r.page;
      await p.evaluate(() => document.getElementById("edit-toggle").click());
      await p.waitForTimeout(600);
      check("the rows unanswered to start", await fixes(p), { "Qu3ntin Larrabee": "", "Pelham Grantwick": "", "Orla Vantreese": "", "Ysolde Marrick": "" });
      await p.evaluate(() => document.querySelectorAll("#pages .tpage")[1].querySelector(".page-label .nocr-page").click());
      await p.waitForTimeout(2500);
      check("only the value that stood nowhere else is answered no; the one on page 1, the one in another document and the one the key fakes elsewhere are left",
        await fixes(p), { "Qu3ntin Larrabee": "no", "Pelham Grantwick": "", "Orla Vantreese": "", "Ysolde Marrick": "" });
      const t = await lastToast(p);
      check("…and the toast says which, and why the one the key fakes was left", [t.includes("Qu3ntin Larrabee"), t.includes("Orla Vantreese") && t.includes("un-fake")], [true, true]);
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(800);
      check("Ctrl+Z takes the answer back", (await fixes(p))["Qu3ntin Larrabee"], "");
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("2. a word typed out of a ✓ Use my text page");
    {
      const r = await newReader();
      const p = r.page;
      await p.evaluate(() => document.querySelectorAll("#pages .tpage")[1].querySelector(".page-label .fix-page").click());
      await p.waitForTimeout(1200);
      // The soup's first word selected and deleted, as a person would.
      await p.evaluate(() => {
        const body = document.querySelectorAll("#pages .tpage .page-body")[1];
        const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
          const at = n.data.indexOf("Qu3ntin Larrabee");
          if (at < 0) continue;
          const rg = document.createRange();
          rg.setStart(n, at); rg.setEnd(n, at + "Qu3ntin Larrabee".length);
          const s = document.getSelection(); s.removeAllRanges(); s.addRange(rg);
          return;
        }
      });
      await p.keyboard.press("Delete");
      await p.waitForTimeout(3000);
      check("deleted from the page, and nowhere else: answered no", await fixes(p), { "Qu3ntin Larrabee": "no", "Pelham Grantwick": "", "Orla Vantreese": "", "Ysolde Marrick": "" });
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
