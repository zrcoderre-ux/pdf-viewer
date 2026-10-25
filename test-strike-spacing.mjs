// Browser test for a strike that moves nothing (textdoc.js strikeLayout;
// columns.js dressColumns, pieceText, dressLineColumns; rules.js laidText;
// text-reader.js shownBlankingMarks, planCells, placePages, autoLayPage;
// pdfsync.js fileLayout; markOwnLines). A strike's ~~ marks are hidden on the page and
// take no room there; counted as characters, every column after a struck
// word moved four places on — a second column, a caption's ")" side, a ruled
// box's bar — and beside the PDF a struck piece at a column's head was set
// two tildes short of the PDF's x. The owner: "Strike through should not
// change the spacing in pdf viewer". A strike leaves ✓ Use my text as it
// was, and on a ✓ Use my text page a struck line is not taken for one the
// operator set by hand.
//
// Run: node test-strike-spacing.mjs   (from the repo root)
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
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "strike-spacing-")), "pseudonym_key.xlsx");
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
const CASE = "Case Strike Spacing";
// A pleading page: prose, two columns, a caption with its ")" side. Its lines
// stand where its PDF prints them (PLEADING), at 6 pt a character from 72.
const PLEADING = { 1: ["DECLARATION OF TOBIAS WRENFIELD", 200], 2: ["The letter of May 4 was sent to the buyer on Friday.", 72], 3: ["LESSOR SIGNS HERE", 72, "LESSEE SIGNS HERE", 320], 4: ["TOBIAS WRENFIELD,", 72, ")", 300, "Case No. 24STCV01234", 320], 6: ["Plaintiff,", 110, ")", 300, "COMPLAINT FOR DAMAGES", 320], 7: ["Plain line after the caption block.", 72] };
// An exhibit page with no numbers: a schedule in three columns.
const SCHEDULE = { 1: ["SCHEDULE OF CHARGES", 220], 2: ["The letter of May 4 was sent to the buyer on Friday.", 72], 3: ["Name", 72, "Amount", 250, "Date", 400], 4: ["Rent charged", 72, "$1,200", 250, "May 4", 400], 5: ["Deposit held", 72, "$500", 250, "May 5", 400], 7: ["LESSOR SIGNS HERE", 72, "LESSEE SIGNS HERE", 320] };
function laid(lines, numbered) {
  const out = ["====== Page 1 ======"];
  for (let n = 1; n <= 8; n++) {
    const l = lines[n];
    let s = "";
    if (l) for (let k = 0; k < l.length; k += 2) { const col = Math.round((l[k + 1] - 72) / 6); if (s.length < col) s += " ".repeat(col - s.length); else if (s) s += "   "; s += l[k]; }
    out.push(numbered ? (String(n).padStart(2) + (s ? "  " + s : "")) : s);
  }
  return out.join("\n") + "\n";
}
const A = laid(PLEADING, true);
const B = laid(SCHEDULE, false);
// A box drawn with rules, and a caption off pleading paper.
const C = ["====== Page 1 ======", "┌──────────────┬──────────┐", "│ Fact         │ Okay     │", "│ Second fact  │ Yes      │", "└──────────────┴──────────┘", "", "TOBIAS WRENFIELD,             )  Case No. 24STCV01234", "               Plaintiff,     )", "       v.                      )  COMPLAINT FOR DAMAGES", "ACME CORP,                    )", "               Defendant.     )"].join("\n") + "\n";

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
  await page.evaluate(async ({ CASE, A, B, C, keyBytes }) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(CASE, { create: true });
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    await put(text, "A Decl.txt", A);
    await put(text, "B Exhibit.txt", B);
    await put(text, "C Table.txt", C);
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, A, B, C, keyBytes: Array.from(KEY_BYTES) });
  await page.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event("change")); } });
  await page.evaluate((n) => window.__textReaderOpenDoc(n), doc);
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.waitForTimeout(1000);
  return { context, page, log, close: () => context.close() };
}
/** The PDF of `lines` (laid() above), picked beside the document, and the grid waited for. */
async function besidePdf(p, lines, numbered) {
  await p.evaluate(async ({ lines, numbered }) => {
    const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.TimesRoman);
    const pg = pdf.addPage([612, 792]);
    for (let n = 1; n <= 8; n++) {
      const y = 792 - (100 + (n - 1) * 24);
      if (numbered) pg.drawText(String(n), { x: 46 - font.widthOfTextAtSize(String(n), 12), y, size: 12, font });
      const l = lines[n];
      if (l) for (let k = 0; k < l.length; k += 2) pg.drawText(l[k], { x: l[k + 1], y, size: 12, font });
    }
    const f = new File([await pdf.save()], (numbered ? "A Decl" : "B Exhibit") + ".pdf", { type: "application/pdf" });
    await window.__textReaderPickPdfs([f]);
  }, { lines, numbered });
  const sbs = await p.$("#sbs-toggle");
  if (!(await sbs.evaluate((b) => document.body.classList.contains("sbs") || b.getAttribute("aria-pressed") === "true"))) await sbs.click();
  await p.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body"), null, { timeout: 15000 });
  await p.waitForTimeout(2000);
}
/** Where each of `words` begins on the page (its first character's left, px), the hidden marks passed over. */
const placesOf = (p, words) => p.evaluate((words) => {
  const body = document.querySelector("#pages .tpage .page-body");
  const out = {};
  for (const wd of words) {
    const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let n;
    out[wd] = null;
    while ((n = w.nextNode())) {
      if (n.parentElement.closest(".sk, .gutter")) continue;
      const at = n.data.indexOf(wd);
      if (at < 0) continue;
      const r = document.createRange();
      r.setStart(n, at); r.setEnd(n, at + 1);
      out[wd] = Math.round(r.getBoundingClientRect().left * 10) / 10;
      break;
    }
  }
  return out;
}, words);
const moved = (a, b) => Object.keys(a).filter((k) => a[k] == null || b[k] == null || Math.abs(a[k] - b[k]) > 0.6).map((k) => `${k} ${a[k]} → ${b[k]}`);
/** Strike each [from, to] (the text of two places, `to` taken through its last character), as a selection and Ctrl+Shift+X do. */
async function strike(p, pairs) {
  for (const [from, to] of pairs) {
    const ok = await p.evaluate(({ from, to }) => {
      const body = document.querySelector("#pages .tpage .page-body");
      const find = (what, end) => {
        const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) { if (n.parentElement.closest(".gutter, .sk")) continue; const at = n.data.indexOf(what); if (at >= 0) return [n, end ? at + what.length : at]; }
        return null;
      };
      const a = find(from, false), b = find(to, true);
      if (!a || !b) return false;
      const r = document.createRange();
      r.setStart(a[0], a[1]); r.setEnd(b[0], b[1]);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      return true;
    }, { from, to });
    if (!ok) throw new Error("no text to select: " + from);
    await p.keyboard.press("Control+Shift+X");
    await p.waitForTimeout(700);
  }
  await p.waitForTimeout(1500);
}
const editToggle = async (p) => { await p.evaluate(() => document.getElementById("edit-toggle").click()); await p.waitForTimeout(900); };
const fixState = (p) => p.evaluate(() => ({ button: document.querySelector("#pages .tpage .page-label .fix-page").textContent, own: document.querySelectorAll("#pages .line.own").length }));

async function run() {
  srv = await startServer();
  browser = await launchBrowser(chromium, CHROME);
  try {
    console.log("1. away from the PDF: words struck before a second column and a caption's side move nothing, read or edited");
    {
      const r = await newReader("A Decl.txt");
      const p = r.page;
      const words = ["was sent", "LESSEE", "Case No.", "COMPLAINT"];
      const reading = await placesOf(p, words);
      await editToggle(p);
      const editing = await placesOf(p, words);
      await strike(p, [["letter", "May 4"], ["LESSOR", "HERE"], ["TOBIAS WRENFIELD,", "FIELD,"], ["Plaintiff,", "Plaintiff,"]]);
      check("in the editor nothing moved", moved(editing, await placesOf(p, words)), []);
      await editToggle(p);
      check("…nor read", moved(reading, await placesOf(p, words)), []);
      check("✓ Use my text left as it was", (await fixState(p)).button, "✎ Use my text");
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("2. a word struck in a ruled box's cell, and a caption's party off pleading paper");
    {
      const r = await newReader("C Table.txt");
      const p = r.page;
      const words = ["Okay", "Yes", "Case No.", "COMPLAINT", "Plaintiff", "Defendant"];
      const reading = await placesOf(p, words);
      await strike(p, [["Fact", "Fact"], ["TOBIAS WRENFIELD,", "FIELD,"], ["ACME", "CORP,"]]);
      check("the box's bars and the caption's side stand where they stood", moved(reading, await placesOf(p, words)), []);
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("3. beside the PDF, pleading paper: nothing moves");
    {
      const r = await newReader("A Decl.txt");
      const p = r.page;
      await besidePdf(p, PLEADING, true);
      const words = ["was sent", "LESSOR", "LESSEE", "Case No.", "COMPLAINT", "Plaintiff"];
      const before = await placesOf(p, words);
      await strike(p, [["letter", "May 4"], ["LESSOR", "HERE"], ["TOBIAS WRENFIELD,", "FIELD,"], ["Plaintiff,", "Plaintiff,"]]);
      check("every piece where it stood", moved(before, await placesOf(p, words)), []);
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("4. beside the PDF, a page with no numbers: a struck piece is set at the PDF's x, two struck rows too");
    {
      const r = await newReader("B Exhibit.txt");
      const p = r.page;
      await besidePdf(p, SCHEDULE, false);
      const words = ["Rent", "$1,200", "May 4", "Deposit", "$500", "May 5", "LESSOR", "LESSEE"];
      const before = await placesOf(p, words);
      await strike(p, [["Rent", "charged"], ["Deposit", "held"], ["$500", "$500"], ["LESSOR", "HERE"]]);
      check("every piece where it stood", moved(before, await placesOf(p, words)), []);
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("5. on a ✓ Use my text page beside its PDF: a struck line is not set apart as typed, and nothing moves");
    {
      const r = await newReader("B Exhibit.txt");
      const p = r.page;
      await besidePdf(p, SCHEDULE, false);
      await p.evaluate(() => document.querySelector("#pages .tpage .page-label .fix-page").click());
      await p.waitForTimeout(1200);
      check("✓ Use my text pressed", (await fixState(p)).button, "✓ Use my text");
      const words = ["Rent", "$1,200", "May 4", "Deposit", "$500", "May 5"];
      const before = await placesOf(p, words);
      await strike(p, [["Rent", "charged"], ["$500", "$500"]]);
      check("no line set apart as typed", (await fixState(p)).own, 0);
      check("every piece where it stood", moved(before, await placesOf(p, words)), []);
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
