// Browser test for the walk through the key's Fix? answers (text-reader.js
// decideKey, keyAnswerCell, setKeyAnswer; textdoc.js setAnswer, answerLine).
// The owner: "when I step through the pseudonym key I should get the same yes
// no never, phrase and type replacement options that I get for leaks." No and
// never keep the name as the right-click does; phrase and a typed answer go to
// PDF-Linker as `fix: VALUE | ANSWER` lines of New Real Values.txt; yes takes
// an answer back.
//
// Run: node test-key-answers.mjs   (from the repo root)
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
async function startServer() {
  let port = 0;
  for (let p = 8130; p <= 8199; p++) if (await portFree(p)) { port = p; break; }
  if (!port) skip("no free port in 8130-8199");
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: REPO, stdio: "ignore" });
  await waitPort(port);
  return { base: `http://127.0.0.1:${port}`, stop: () => { try { proc.kill("SIGTERM"); } catch { /* gone */ } } };
}

// ── the key, as a real .xlsx ────────────────────────────────────────────────
function buildKey(rows) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "key-answers-")), "pseudonym_key.xlsx");
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

// ── the document ─────────────────────────────────────────────────────────────
const CASE = "Case Key Answers";
const A = "====== Page 1 ======\nThe tenant Mira Holt signed the lease. Dorian Fane witnessed it.\n";

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
  await page.evaluate(async ({ CASE, A, keyBytes }) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(CASE, { create: true });
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    await put(text, "A Lease.txt", A);
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, A, keyBytes: Array.from(KEY_BYTES) });
  await page.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event("change")); } });
  await page.evaluate(() => window.__textReaderOpenDoc("A Lease.txt"));
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body .pn").length > 0);
  await page.waitForTimeout(800);
  return { context, page, log, close: () => context.close() };
}
const bar = (p) => p.evaluate(() => ({
  term: document.getElementById("kb-term").selectedOptions[0]?.textContent || "",
  answer: document.getElementById("kb-answer").textContent,
  on: [...document.querySelectorAll("#key-bar button[data-kfix].on")].map((b) => b.dataset.kfix),
  typed: document.getElementById("kb-typed").value,
}));
const goTerm = (p, real) => p.evaluate((real) => {
  const sel = document.getElementById("kb-term");
  const o = [...sel.options].find((x) => x.textContent.startsWith(real));
  sel.value = o.value;
  sel.dispatchEvent(new Event("change"));
}, real);
const answersShown = (p) => p.evaluate(() => [...document.querySelectorAll("#answers-list li")].map((li) => li.firstChild.textContent));
async function savedFile(p) {
  await p.evaluate(() => document.getElementById("flags-save").click());
  await p.waitForTimeout(800);
  return p.evaluate(async (CASE) => {
    const top = await navigator.storage.getDirectory();
    const d = await top.getDirectoryHandle(CASE);
    try { return await (await (await d.getFileHandle("New Real Values.txt")).getFile()).text(); } catch { return ""; }
  }, CASE);
}
const lines = (t) => t.split("\n").filter((l) => l && l[0] !== "#");

async function run() {
  srv = await startServer();
  browser = await launchBrowser(chromium, CHROME);
  try {
    console.log("1. the walk offers the Leaks bar's answers");
    const r = await newReader();
    const p = r.page;
    await p.evaluate(() => document.getElementById("key-walk-btn").click());
    await p.waitForTimeout(500);
    await goTerm(p, "Orla Vantreese");
    await p.waitForTimeout(300);
    const b0 = await bar(p);
    check("the bar stands on the term, unanswered", [b0.term.startsWith("Orla Vantreese → Mira Holt"), b0.answer, b0.on], [true, "not answered — faked as the key has it", []]);
    check("…with yes, no, never and phrase, and a field to type in", await p.evaluate(() => [[...document.querySelectorAll("#key-bar button[data-kfix]")].map((b) => b.dataset.kfix), !!document.getElementById("kb-typed")]), [["yes", "no", "never", "phrase"], true]);

    console.log("2. a typed replacement");
    await p.fill("#kb-typed", "Bertram Ollivant");
    await p.press("#kb-typed", "Enter");
    await p.waitForTimeout(500);
    check("the walk moves on to the next term", (await bar(p)).term.startsWith("Pelham Grantwick"), true);
    check("…the answer listed in the Flagged panel", await answersShown(p), ["Orla Vantreese → Bertram Ollivant"]);
    await goTerm(p, "Orla Vantreese");
    await p.waitForTimeout(300);
    const b1 = await bar(p);
    check("back on it: the answer shown, and in the field", [b1.answer, b1.typed], ["replace with “Bertram Ollivant”", "Bertram Ollivant"]);
    check("…the name still marked as the key has it until PDF-Linker runs", await p.evaluate(() => [...document.querySelectorAll(".pn")].map((s) => s.textContent)), ["Orla Vantreese", "Pelham Grantwick"]);

    console.log("3. no, and the file PDF-Linker reads");
    await goTerm(p, "Pelham Grantwick");
    await p.waitForTimeout(300);
    await p.click('#key-bar button[data-kfix="no"]');
    await p.waitForTimeout(600);
    let file = lines(await savedFile(p));
    check("a typed answer goes as a fix line, a no as its keep line", [file.includes("fix: Orla Vantreese | Bertram Ollivant"), file.includes("no: Pelham Grantwick")], [true, true]);

    console.log("4. phrase, then yes takes the answer back");
    await goTerm(p, "Orla Vantreese");
    await p.waitForTimeout(300);
    await p.click('#key-bar button[data-kfix="phrase"]');
    await p.waitForTimeout(500);
    check("phrase replaces the typed answer", await answersShown(p), ["Orla Vantreese → phrase"]);
    await goTerm(p, "Orla Vantreese");
    await p.waitForTimeout(300);
    check("…and is shown lit", (await bar(p)).on, ["phrase"]);
    await p.click('#key-bar button[data-kfix="yes"]');
    await p.waitForTimeout(500);
    check("yes: no answer left", await answersShown(p), []);
    file = lines(await savedFile(p));
    check("…and none in the file, the keep still there", [file.some((l) => l.startsWith("fix:")), file.includes("no: Pelham Grantwick")], [false, true]);
    check("no page errors", r.log.errors, []);
    await r.close();
  } finally {
    await browser.close();
    srv.stop();
  }
  console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
  process.exit(fails ? 1 : 0);
}
await run();
