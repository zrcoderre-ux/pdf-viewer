// Browser test for the half line under every margin number (viewer/
// text-reader.js: halfAfter, pullUp, moveIntoHalfAbove, enterAtCaret,
// backspaceAtCaret, deleteAtCaret): Enter on line 1 sends its text to 1.5 and
// a second Enter to 2, Backspace at the head of 2 sends it back to 1.5 and a
// second joins it to 1, Delete at the end of 1 brings 2 up to 1.5; an empty
// half line is no line of the file; Ctrl+Z takes a step back; and beside the
// PDF a half line stands between its two numbers, which do not move.
//
// Run: node test-half-lines.mjs   (from the repo root)
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
// On disk the exports carry the FAKES; the key turns them back on screen.
// "Ashdale" is bound on its own, so a name typed as "Ashdale" is offered.
function buildKey(rows, pinned = []) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "half-lines-")), "pseudonym_key.xlsx");
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

const CASE = "Case Free";
const A = [
  "====== Page 1 ======",
  " 1  Alpha",
  " 2  Beta",
  " 3",
  " 4        Delta",
  " 5",
  " 6",
  "====== Page 2 ======",
  " 1  x",
].join("\n") + "\n";

// A form page with no margin numbers: beside its PDF each piece of a line is
// set where the PDF prints it — the correction ✓ Use my text lifts.
const C = [
  "====== Page 1 ======",
  "Name                    Amount           Date",
  "Tobias Wrenfield        $1,200           May 4",
  "Other                   $5               June 1",
].join("\n") + "\n";

// A second document, long enough that its last page is well off the screen.
const B = Array.from({ length: 6 }, (_, k) => `====== Page ${k + 1} ======\n` + Array.from({ length: 40 }, (_, j) => `Brief page ${k + 1}, line ${j + 1}.`).join("\n")).join("\n") + "\n";

let srv = null, browser = null;
async function openReader(page) {
  await page.evaluate((n) => window.__textReaderOpenDoc(n), "A Decl.txt");
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.waitForTimeout(800);
}
async function newReader() {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
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
    await put(text, "B Brief.txt", B);
    await put(text, "C Form.txt", C);
    window.__case = dir;
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, A, B, C, keyBytes: Array.from(KEY_BYTES) });
  await page.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event("change")); } });
  await openReader(page);
  await page.evaluate(() => document.getElementById("edit-toggle").click());
  await page.waitForTimeout(200);
  return { context, page, log, close: () => context.close() };
}
/** Everything a reader sees of page `i`: each line's place, size and face, and the page's height. */
const look = (page, i) => page.evaluate((i) => {
  const sec = document.querySelectorAll("#pages .tpage")[i];
  const box = sec.getBoundingClientRect();
  const r1 = (v) => Math.round(v * 10) / 10;
  return {
    h: r1(box.height),
    lines: [...sec.querySelectorAll(".page-body > .line")].map((l) => {
      const r = l.getBoundingClientRect(), lt = l.querySelector(".lt"), cs = getComputedStyle(lt);
      return [l.textContent, r1(r.left - box.left), r1(r.top - box.top), r1(r.height), cs.fontSize, cs.fontFamily, lt.style.transform || ""];
    }),
  };
}, i);
/** The x of the first `what` on line `k` of page `i`. */
const xOf = (page, i, k, what) => page.evaluate(({ i, k, what }) => {
  const lt = document.querySelectorAll("#pages .tpage")[i].querySelectorAll(".page-body > .line")[k].querySelector(".lt");
  const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) { const at = n.data.indexOf(what); if (at >= 0) { const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + 1); return r.getBoundingClientRect().left; } }
  return NaN;
}, { i, k, what });
/** The caret just before the first `what` on line `k` of page `i`. */
const caretBefore = (page, i, k, what) => page.evaluate(({ i, k, what }) => {
  const body = document.querySelectorAll("#pages .tpage")[i].querySelector(".page-body");
  const lt = body.querySelectorAll(":scope > .line")[k].querySelector(".lt");
  const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) { const at = n.data.indexOf(what); if (at >= 0) { const r = document.createRange(); r.setStart(n, at); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); body.focus(); return true; } }
  return false;
}, { i, k, what });
const own = (page, i) => page.evaluate((i) => [...document.querySelectorAll("#pages .tpage")[i].querySelectorAll(".page-body > .line")].map((l) => l.classList.contains("own")), i);
const isFree = (page, i) => page.evaluate((i) => document.querySelectorAll("#pages .tpage")[i].querySelector(".page-body").classList.contains("free"), i);
const fixClick = (page, i) => page.evaluate((i) => document.querySelectorAll("#pages .tpage")[i].querySelector(".page-label .fix-page").click(), i);

/** Page 1's slots: each line as [its number or "·" for a half line, its text]. */
const slots = (page) => page.evaluate(() => [...document.querySelector("#pages .tpage .page-body").querySelectorAll(":scope > .line")]
  .map((l) => [l.classList.contains("num") ? l.querySelector(".gn").textContent.trim() : "·", l.querySelector(".lt").textContent]));
const caretIn = (page, k, end = false) => page.evaluate(({ k, end }) => {
  const body = document.querySelector("#pages .tpage .page-body");
  const lt = body.querySelectorAll(":scope > .line")[k].querySelector(".lt");
  const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
  let n, last = null, first = null; while ((n = w.nextNode())) { if (!first) first = n; last = n; }
  const r = document.createRange();
  if (end && last) r.setStart(last, last.data.length); else if (first) r.setStart(first, 0); else r.setStart(lt, 0);
  r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); body.focus();
}, { k, end });
const file = (page) => page.evaluate(async () => (await (await (await window.__case.getDirectoryHandle("Text Files")).getFileHandle("A Decl.txt")).getFile()).text());
const START = [["1", "Alpha"], ["2", "Beta"], ["3", ""], ["4", "Delta"], ["5", ""], ["6", ""]];

async function run() {
  srv = await startServer();
  browser = await chromium.launch({ executablePath: CHROME });
  try {
    console.log("1. Enter and Backspace step by half lines");
    {
      const r = await newReader();
      const p = r.page;
      check("as the file has it", await slots(p), START);
      await caretIn(p, 0);
      await p.keyboard.press("Enter");
      check("Enter on 1: the text to 1.5", await slots(p), [["1", ""], ["·", "Alpha"], ["2", "Beta"], ["3", ""], ["4", "Delta"], ["5", ""], ["6", ""]]);
      await p.keyboard.press("Enter");
      check("…again: to 2, and 2's text to 2.5; 1.5 empty again and gone", await slots(p), [["1", ""], ["2", "Alpha"], ["·", "Beta"], ["3", ""], ["4", "Delta"], ["5", ""], ["6", ""]]);
      await p.keyboard.press("Backspace");
      check("Backspace at the head of 2: back to 1.5, 2.5 up to 2", await slots(p), [["1", ""], ["·", "Alpha"], ["2", "Beta"], ["3", ""], ["4", "Delta"], ["5", ""], ["6", ""]]);
      await p.keyboard.press("Backspace");
      check("…again: joined to 1, the half line gone", await slots(p), START);
      await caretIn(p, 0, true);
      await p.keyboard.press("Delete");
      check("Delete at the end of 1: 2 up to 1.5", await slots(p), [["1", "Alpha"], ["·", "Beta"], ["2", ""], ["3", ""], ["4", "Delta"], ["5", ""], ["6", ""]]);
      await p.keyboard.press("Delete");
      check("…again: 1.5 joined to 1", await slots(p), [["1", "AlphaBeta"], ["2", ""], ["3", ""], ["4", "Delta"], ["5", ""], ["6", ""]]);
      await p.keyboard.press("Control+z");
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(200);
      check("Ctrl+Z twice: back as it was", await slots(p), START);
      console.log("2. mid-line, and the save");
      await p.evaluate(() => {
        const lt = document.querySelectorAll("#pages .tpage .page-body > .line")[3].querySelector(".lt");
        const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT); const n = w.nextNode();
        const rg = document.createRange(); rg.setStart(n, 2); rg.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); lt.closest(".page-body").focus();
      });
      await p.keyboard.press("Enter");
      check("Enter mid-line on 4: the rest to 4.5", (await slots(p)).slice(3, 6), [["4", "De"], ["·", "lta"], ["5", ""]]);
      await p.keyboard.press("Control+s");
      await p.waitForTimeout(1500);
      truthy("the half line is a line of the file between 4 and 5", (await file(p)).includes(" 4        De\nlta\n 5\n"));
      console.log("2b. Backspace at the head of an indented line: the indent goes first, a space a press, the line staying on its number; once it is gone, Backspace moves it up a half line");
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(200);
      const four = () => p.evaluate(() => { const l = document.querySelectorAll("#pages .tpage .page-body > .line")[3]; return [l.querySelector(".gn").textContent.trim(), l.querySelector(".gs").textContent.length, l.querySelector(".lt").textContent]; });
      check("line 4 indented, as the file has it", await four(), ["4", 8, "Delta"]);
      await caretIn(p, 3);
      await p.keyboard.press("Backspace");
      check("Backspace: one space of the indent off, still on 4", await four(), ["4", 7, "Delta"]);
      for (let k = 0; k < 5; k++) await p.keyboard.press("Backspace");
      check("five more: the indent off, still on 4", await four(), ["4", 2, "Delta"]);
      check("…and nothing moved", await slots(p), START);
      await p.keyboard.press("Backspace");
      check("…again: up to 3.5", (await slots(p)).slice(2, 5), [["3", ""], ["·", "Delta"], ["4", ""]]);
      for (let k = 0; k < 7; k++) await p.keyboard.press("Control+z");
      await p.waitForTimeout(200);
      check("Ctrl+Z seven times: indented on 4 again", await four(), ["4", 8, "Delta"]);
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("3. beside the PDF: a half line stands between its numbers, and no number moves");
    {
      const r = await newReader();
      const p = r.page;
      await p.evaluate(async () => {
        const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.TimesRoman);
        // Line 4 indented half an inch, and a row between 1 and 2 (1.5) an inch in.
        for (const [body, half] of [[{ 1: "Alpha", 2: "Beta", 4: "Delta" }, { 1: "Alpha" }], [{ 1: "x" }, {}]]) {
          const pg = pdf.addPage([612, 792]);
          for (let n = 1; n <= 28; n++) {
            const y = 792 - (100 + (n - 1) * 24);
            pg.drawText(String(n), { x: 46 - font.widthOfTextAtSize(String(n), 12), y, size: 12, font });
            if (body[n] && !(n === 1 && half[1])) pg.drawText(body[n], { x: n === 4 ? 108 : 72, y, size: 12, font });
            if (half[n]) pg.drawText(half[n], { x: 144, y: y - 12, size: 12, font });
          }
        }
        const f = new File([await pdf.save()], "A Decl.pdf", { type: "application/pdf" });
        await window.__textReaderPickPdfs([f]);
      });
      const sbs = await p.$("#sbs-toggle");
      if (!(await sbs.evaluate((b) => document.body.classList.contains("sbs") || b.getAttribute("aria-pressed") === "true"))) await sbs.click();
      await p.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body.fixed"), null, { timeout: 15000 });
      await p.waitForTimeout(1500);
      const tops = () => p.evaluate(() => [...document.querySelector("#pages .tpage .page-body").querySelectorAll(":scope > .line")].map((l) => [l.classList.contains("num") ? l.querySelector(".gn").textContent.trim() : "·", Math.round(l.getBoundingClientRect().top * 10) / 10]));
      const xAt = (k) => p.evaluate((k) => {
        const lt = document.querySelectorAll("#pages .tpage .page-body > .line")[k].querySelector(".lt");
        const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
        let n; while ((n = w.nextNode())) { const at = n.data.search(/\S/); if (at >= 0) { const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + 1); return r.getBoundingClientRect().left; } }
        return NaN;
      }, k);
      const scale = await p.evaluate(() => document.querySelector("#pages .tpage").getBoundingClientRect().width / 612);
      const flush = await xAt(1); // Beta, on line 2, where the PDF prints it at the margin
      truthy(`line 4 starts where the PDF's line 4 does, half an inch in (${((await xAt(3)) - flush).toFixed(1)}px, want ${(36 * scale).toFixed(1)})`, Math.abs((await xAt(3)) - flush - 36 * scale) < 2);
      truthy("…though the file gives it no indent", (await slots(p))[3][1] === "Delta");
      // Backspace at its head: the indent the reader shows goes — the PDF's as
      // well as the file's — and the line stays on 4; Ctrl+Z puts it back.
      const tops0 = await tops();
      await caretIn(p, 3);
      await p.keyboard.press("Backspace");
      await p.waitForTimeout(1200);
      truthy(`Backspace at the head of the indented line 4: it starts at the margin (${((await xAt(3)) - flush).toFixed(1)}px)`, Math.abs((await xAt(3)) - flush) < 2);
      check("…still on 4, nothing moved down the page", await tops(), tops0);
      await p.keyboard.press("Backspace");
      await p.waitForTimeout(800);
      check("a second Backspace: up to 3.5", (await slots(p)).slice(2, 5), [["3", ""], ["·", "Delta"], ["4", ""]]);
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(600);
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(1200);
      truthy(`Ctrl+Z: indented again (${((await xAt(3)) - flush).toFixed(1)}px)`, Math.abs((await xAt(3)) - flush - 36 * scale) < 2);
      const before = await tops();
      await caretIn(p, 0);
      await p.keyboard.press("Enter");
      await p.waitForTimeout(1200);
      const after = await tops();
      check("the numbers stand where they stood", after.filter(([n]) => n !== "·"), before);
      const half = after.find(([n]) => n === "·");
      const t1 = after.find(([n]) => n === "1")[1], t2 = after.find(([n]) => n === "2")[1];
      truthy(`the half line between 1 and 2 (${t1}, ${half && half[1]}, ${t2})`, !!half && half[1] > t1 && half[1] < t2);
      const halfX = await xAt(1) - flush;
      truthy(`…and starts where the PDF's row at 1.5 does, an inch in (${halfX.toFixed(1)}px, want ${(72 * scale).toFixed(1)})`, Math.abs(halfX - 72 * scale) < 2);
      check("the file is unchanged by it: the half line's text as typed", (await slots(p))[1], ["·", "Alpha"]);
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
