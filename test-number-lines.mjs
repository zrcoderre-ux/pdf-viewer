// Browser test for # Number lines (viewer/text-reader.js: numberPage): on a
// page whose export has no margin numbers the button puts pleading paper's
// 1–28 in — in order without the PDF, and with the PDF beside it each line on
// the number the PDF prints it at, a line between two numbers a half line —
// one undo step; and it is not offered on a page that has its numbers.
//
// Run: node test-number-lines.mjs   (from the repo root)
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
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "number-lines-")), "pseudonym_key.xlsx");
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
  "",
  "      Alpha",
  "      Beta",
  "      Gamma",
  "      Delta",
  "====== Page 2 ======",
  " 1  Already numbered",
  " 2  on pleading paper",
  " 3  as exported",
  // A poor scan: the OCR caught three of its numbers, and put its lines in at
  // whatever indent it read them at.
  "====== Page 3 ======",
  " 1  One",
  " 2  Two",
  " 3  Three",
  "     Four",
  "  Five",
  "        Six",
  "Seven",
  "   Eight",
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

const lines = (page, i) => page.evaluate((i) => [...document.querySelectorAll("#pages .tpage")[i].querySelectorAll(".page-body > .line")].map((l) => l.textContent.replace(/\s+$/, "")), i);
const shown = (page, i) => page.evaluate((i) => { const b = document.querySelectorAll("#pages .tpage")[i].querySelector(".page-label .num-page"); return !!b && !b.hidden; }, i);
const press = (page, i) => page.evaluate((i) => document.querySelectorAll("#pages .tpage")[i].querySelector(".page-label .num-page").click(), i);
const file = (page) => page.evaluate(async () => (await (await (await window.__case.getDirectoryHandle("Text Files")).getFileHandle("A Decl.txt")).getFile()).text());
const bare = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => String(from + k).padStart(2));

async function run() {
  srv = await startServer();
  browser = await chromium.launch({ executablePath: CHROME });
  try {
    console.log("1. without the PDF: in order");
    {
      const r = await newReader();
      const p = r.page;
      check("offered on the page with no numbers", await shown(p, 0), true);
      check("…not on the page that has them", await shown(p, 1), false);
      check("…and on a page an OCR caught only a few numbers of", await shown(p, 2), true);
      await press(p, 2);
      await p.waitForTimeout(400);
      check("that page numbered from 1, its few numbers taken off and put back, every line flush at one margin", await lines(p, 2),
        [" 1  One", " 2  Two", " 3  Three", " 4  Four", " 5  Five", " 6  Six", " 7  Seven", " 8  Eight"].concat(bare(9, 28)));
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(300);
      await press(p, 0);
      await p.waitForTimeout(400);
      check("numbered in order, the margin taken off, bare numbers to 28", await lines(p, 0),
        [" 1  Alpha", " 2  Beta", " 3  Gamma", " 4  Delta"].concat(bare(5, 28)));
      check("…and the button gone", await shown(p, 0), false);
      truthy("the page reads as numbered", await p.evaluate(() => document.querySelector("#pages .page-body").classList.contains("numbered")));
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(300);
      check("Ctrl+Z takes them out", await lines(p, 0), ["", "      Alpha", "      Beta", "      Gamma", "      Delta"]);
      check("…and the button is back", await shown(p, 0), true);
      await press(p, 0);
      await p.keyboard.press("Control+s");
      await p.waitForTimeout(1500);
      truthy("the save writes them", (await file(p)).includes("====== Page 1 ======\n 1  Alpha\n 2  Beta\n 3  Gamma\n 4  Delta\n 5\n"));
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("2. with the PDF beside it: each line on the number the PDF prints it at");
    {
      const r = await newReader();
      const p = r.page;
      await p.evaluate(async () => {
        const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.TimesRoman);
        const at = (n) => 792 - (100 + (n - 1) * 24);
        for (const page of [[["Alpha", 1], ["Beta", 3], ["Gamma", 3.5], ["Delta", 6]], [["Already numbered", 1], ["on pleading paper", 2], ["as exported", 3]]]) {
          const pg = pdf.addPage([612, 792]);
          for (let n = 1; n <= 28; n++) pg.drawText(String(n), { x: 46 - font.widthOfTextAtSize(String(n), 12), y: at(n), size: 12, font });
          for (const [t, n] of page) pg.drawText(t, { x: 72, y: at(n), size: 12, font });
        }
        const f = new File([await pdf.save()], "A Decl.pdf", { type: "application/pdf" });
        await window.__textReaderPickPdfs([f]);
      });
      const sbs = await p.$("#sbs-toggle");
      if (!(await sbs.evaluate((b) => document.body.classList.contains("sbs") || b.getAttribute("aria-pressed") === "true"))) await sbs.click();
      await p.waitForFunction(() => !!document.querySelector("#pages .tpage.matched"), null, { timeout: 15000 });
      await p.waitForTimeout(1500);
      await press(p, 0);
      await p.waitForTimeout(800);
      check("each line on its number, Gamma a half line under 3", await lines(p, 0),
        [" 1  Alpha", " 2", " 3  Beta", "    Gamma", " 4", " 5", " 6  Delta"].concat(bare(7, 28)));
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    // The PDF's text carries only some of its margin: an OCR that read 1 to 23
    // and lost the rest at the foot. The paper still runs to 28 (the owner: "I
    // had one only generate 1-23").
    console.log("3. with a PDF whose text carries only 1-23 of its margin: still 1-28");
    {
      const r = await newReader();
      const p = r.page;
      await p.evaluate(async () => {
        const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.TimesRoman);
        const at = (n) => 792 - (100 + (n - 1) * 24);
        for (const page of [[["Alpha", 1], ["Beta", 3], ["Gamma", 3.5], ["Delta", 6]], [["Already numbered", 1], ["on pleading paper", 2], ["as exported", 3]]]) {
          const pg = pdf.addPage([612, 792]);
          for (let n = 1; n <= 23; n++) pg.drawText(String(n), { x: 46 - font.widthOfTextAtSize(String(n), 12), y: at(n), size: 12, font });
          for (const [t, n] of page) pg.drawText(t, { x: 72, y: at(n), size: 12, font });
        }
        const f = new File([await pdf.save()], "A Decl.pdf", { type: "application/pdf" });
        await window.__textReaderPickPdfs([f]);
      });
      const sbs = await p.$("#sbs-toggle");
      if (!(await sbs.evaluate((b) => document.body.classList.contains("sbs") || b.getAttribute("aria-pressed") === "true"))) await sbs.click();
      await p.waitForFunction(() => !!document.querySelector("#pages .tpage.matched"), null, { timeout: 15000 });
      await p.waitForTimeout(1500);
      await press(p, 0);
      await p.waitForTimeout(800);
      check("each line on its number, and the numbers on to 28", await lines(p, 0),
        [" 1  Alpha", " 2", " 3  Beta", "    Gamma", " 4", " 5", " 6  Delta"].concat(bare(7, 28)));
      // …and laid on the paper's grid all the way down: 24 to 28 a pitch apart
      // under 23, as the PDF's own numbers are above it.
      const tops = await p.evaluate(() => [...document.querySelector("#pages .tpage .page-body").querySelectorAll(":scope > .line.num")].map((l) => parseFloat(l.style.top)));
      const steps = tops.slice(1).map((t, k) => t - tops[k]);
      truthy(`…every number laid a pitch below the last, 24 to 28 too (${steps.map((x) => x.toFixed(1)).join(" ")})`, tops.length === 28 && Math.max(...steps) - Math.min(...steps) < 0.05);
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
