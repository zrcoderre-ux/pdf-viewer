// Browser test for a table's keys kept in its columns (textdoc.js boxEdit,
// openBoxAround; text-reader.js boxKey, boxReflowSoon). PDF-Linker writes a
// table the page rules only between its columns with no │ at either end;
// Backspace at "Exhibits" joined its row onto the line above across the
// table, the bars broken, on a ✓ Use my text page and an ordinary one alike.
// The owner: "the column lines should not be broken by backspace, and
// backspace should move only the text in that column up a line. Likewise,
// enter should only move text in that column down."
//
// Run: node test-table-keys.mjs   (from the repo root)
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
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "table-keys-")), "pseudonym_key.xlsx");
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
const KEY_BYTES = buildKey([["person", "Corwin Ashdale", "Bertram Ollivant", "", "", "spreadsheet", 4]]);

// ── the documents ────────────────────────────────────────────────────────────
const CASE = "Case Table Keys";
const R = "    ───────────────────────────┼──────────────────────┼─────────────────────────";
const row = (lead, a, b, c) => ((lead + " " + a).padEnd(31) + "│ " + b.padEnd(21) + "│ " + c).trimEnd();
const TABLE = ["====== Page 1 ======", " 1  Plaintiffs respond to the objections.", " 2", R,
  row(" 3  ", "1. Paragraph 4;", "Hearsay; the", "Overrule. Authentication."),
  row(" 4  ", "Exhibit 18", "deposition", "Paragraph 4 authenticates"),
  row("    ", "Attached to the", "excerpts are", "the transcript excerpts."),
  row(" 5  ", "Compendium of", "offered for the", "Deposition evidence."),
  row("    ", "", "truth of the", ""),
  row(" 6  ", "Exhibits.", "", ""),
  R.replace(/┼/g, "┴"), " 7", " 8  Dated: May 4."];
const A = TABLE.join("\n") + "\n";

let srv = null, browser = null;
async function newReader(doc) {
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
    await put(text, "A Objections.txt", A);
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, A, keyBytes: Array.from(KEY_BYTES) });
  await page.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event("change")); } });
  await page.evaluate((n) => window.__textReaderOpenDoc(n), doc);
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.waitForTimeout(1000);
  return { context, page, log, close: () => context.close() };
}
const editToggle = async (p) => { await p.evaluate(() => document.getElementById("edit-toggle").click()); await p.waitForTimeout(900); };
/** The page's text as it would be saved. */
const pageText = (p) => p.evaluate(async () => (await import("/viewer/textdoc.js")).serializeNodes(document.querySelector("#pages .tpage .page-body")).split("\n"));
/** The caret put at `off` characters into the first `what` on the page, and `key` pressed. */
async function press(p, what, off, key) {
  const ok = await p.evaluate(({ what, off }) => {
    const body = document.querySelector("#pages .tpage .page-body");
    const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.parentElement.closest(".gutter")) continue;
      const at = n.data.indexOf(what);
      if (at < 0) continue;
      const r = document.createRange();
      r.setStart(n, at + off); r.collapse(true);
      const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
      return true;
    }
    return false;
  }, { what, off });
  if (!ok) throw new Error("no text on the page: " + what);
  await p.keyboard.press(key);
  await p.waitForTimeout(600);
}
const tableRows = (lines) => lines.filter((l) => l.includes("│") && !l.includes("─"));
const column = (lines, j) => tableRows(lines).map((l) => (j ? l.split("│")[j] : l.split("│")[0].slice(4)).trim());
const barsStraight = (lines) => [...new Set(lines.filter((l) => /[│┼┴]/.test(l)).map((l) => [...l].map((c, k) => ("│┼┴".includes(c) ? k : -1)).filter((k) => k >= 0).join(",")))];
const numbers = (lines) => lines.map((l) => l.slice(0, 4));

async function run() {
  srv = await startServer();
  browser = await launchBrowser(chromium, CHROME);
  try {
    for (const free of [false, true]) {
      console.log(free ? "2. a ✓ Use my text page" : "1. an ordinary page");
      const r = await newReader("A Objections.txt");
      const p = r.page;
      if (free) {
        await p.evaluate(() => document.querySelector("#pages .tpage .page-label .fix-page").click());
        await p.waitForTimeout(1200);
      } else await editToggle(p);
      const before = await pageText(p);
      check("the page read as the file has it", before, TABLE.slice(1));
      await press(p, "Exhibits.", 0, "Backspace");
      const bs = await pageText(p);
      check("Backspace at the head of the first column's text: that column's text up a row, onto the empty one",
        column(bs, 0), ["1. Paragraph 4;", "Exhibit 18", "Attached to the", "Compendium of", "Exhibits.", ""]);
      check("…the other columns, the bars and the numbers as they were", [column(bs, 1), column(bs, 2), barsStraight(bs), numbers(bs)], [column(before, 1), column(before, 2), barsStraight(before), numbers(before)]);
      await press(p, "Exhibits.", 0, "Backspace");
      const bj = await pageText(p);
      check("Backspace again: joined to the end of the column's text above, nothing else moved",
        [column(bj, 0), column(bj, 2), barsStraight(bj)], [["1. Paragraph 4;", "Exhibit 18", "Attached to the", "Compendium of Exhibits.", "", ""], column(before, 2), barsStraight(before)]);
      await press(p, "Exhibit 18", 0, "Enter");
      const en = await pageText(p);
      check("Enter at the head of a cell's text: that column's text from there down a row, the others not moved",
        [column(en, 0), column(en, 1), column(en, 2), barsStraight(en)],
        [["1. Paragraph 4;", "", "Exhibit 18", "Attached to the", "Compendium of Exhibits.", ""], column(before, 1), column(before, 2), barsStraight(before)]);
      await press(p, "deposition", 0, "Backspace");
      const b2 = await pageText(p);
      // "Hearsay; the deposition" is longer than the cell: it wraps on down
      // the middle column as typing would, the rows that carry on its text
      // (they open in lower case) run in after it.
      check("Backspace in the middle column: joined up within it and wrapped on down it, the first and last columns untouched",
        [column(b2, 1), column(b2, 0), column(b2, 2), barsStraight(b2)], [["Hearsay; the", "deposition excerpts", "are offered for the", "truth of the", "", ""], column(en, 0), column(en, 2), barsStraight(before)]);
      await press(p, "Paragraph 4;", 12, "Space");
      await p.keyboard.type("and 5;");
      await p.waitForTimeout(800);
      const ty = await pageText(p);
      check("typed in a cell of the first column: the row set back on its rules, the bars straight",
        [column(ty, 0)[0], barsStraight(ty), column(ty, 2)], ["1. Paragraph 4; and 5;", barsStraight(before), column(en, 2)]);
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
