// Browser test for a page asked for as ✓ Use my text (viewer/text-reader.js:
// setFree, isFreePage, the guarded dressColumns/dressLines): the page keeps
// the paper's shape, is set fixed-pitch and unwrapped as the file is, and
// its spaces are no longer cut into columns, its
// margin numbers stay fixed in their gutter, the text is unchanged, and
// withdrawing the request lays it out as before; beside its PDF it comes off
// the grid with its PDF page held level. The page is built free again
// on reopening the document, the click turns ✎ Edit on, and the Flagged
// panel's list goes to each page on it.
//
// Run: node test-free-page.mjs   (from the repo root)
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
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "free-page-")), "pseudonym_key.xlsx");
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
  " 1  DECLARATION OF TOBIAS WRENFIELD",
  " 2  Name                    Amount           Date",
  " 3  Tobias Wrenfield        $1,200           May 4",
  " 4  End.",
  "====== Page 2 ======",
  " 1  Name                    Amount           Date",
  " 2  Other                   $5               June 1",
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
  await page.evaluate(async ({ CASE, A, B, keyBytes }) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(CASE, { create: true });
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    await put(text, "A Decl.txt", A);
    await put(text, "B Brief.txt", B);
    window.__case = dir;
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, A, B, keyBytes: Array.from(KEY_BYTES) });
  await page.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event("change")); } });
  await openReader(page);
  await page.evaluate(() => document.getElementById("edit-toggle").click());
  await page.waitForTimeout(200);
  return { context, page, log, close: () => context.close() };
}
const state = (page, i) => page.evaluate((i) => {
  const sec = document.querySelectorAll("#pages .tpage")[i];
  const body = sec.querySelector(".page-body");
  return {
    free: body.classList.contains("free"),
    numbered: body.classList.contains("numbered"),
    gutters: body.querySelectorAll(".gutter").length,
    cells: body.querySelectorAll(".cc").length,
    fit: sec.style.getPropertyValue("--fit"),
    minH: body.style.minHeight,
    h: Math.round(sec.getBoundingClientRect().height),
  };
}, i);
const pageText = (page, i) => page.evaluate((i) => [...document.querySelectorAll("#pages .tpage")[i].querySelectorAll(".page-body .line")]
  .map((l) => l.textContent).join("\n"), i);
const fixClick = (page, i) => page.evaluate((i) => document.querySelectorAll("#pages .tpage")[i].querySelector(".page-label .fix-page").click(), i);

async function run() {
  srv = await startServer();
  browser = await chromium.launch({ executablePath: CHROME });
  try {
    console.log("1. ✓ Use my text frees the page of the PDF, the margin numbers kept");
    {
      const r = await newReader();
      const p = r.page;
      const before = await state(p, 0);
      const text0 = await pageText(p, 0);
      truthy("laid out in columns before", before.cells > 0);
      truthy("numbered before", before.numbered && before.gutters === 4);
      await fixClick(p, 0);
      await p.waitForTimeout(700);
      const after = await state(p, 0);
      check("free", after.free, true);
      check("no column cells", after.cells, 0);
      const other = await state(p, 1);
      truthy(`…still shaped to the paper: as tall as the page beside it (${after.h} and ${other.h})`, after.minH !== "" && Math.abs(after.h - other.h) <= 2);
      check("the margin numbers stay in their gutter", [after.numbered, after.gutters], [true, 4]);
      const look = await p.evaluate(() => {
        const body = document.querySelector("#pages .tpage .page-body");
        const lines = [...body.querySelectorAll(":scope > .line > .lt")];
        // The x of the character at one column on two lines ("Amount" and "$1,200" both start at column 24 of their text).
        const xAt = (lt, col) => {
          const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
          let n, at = 0;
          while ((n = w.nextNode())) {
            if (col < at + n.data.length) { const r = document.createRange(); r.setStart(n, col - at); r.setEnd(n, col - at + 1); return r.getBoundingClientRect().left; }
            at += n.data.length;
          }
          return NaN;
        };
        const a = lines[1], b = lines[2];
        return {
          mono: /mono/i.test(getComputedStyle(body).fontFamily),
          wrap: getComputedStyle(lines[1]).whiteSpace,
          fits: lines.every((lt) => lt.scrollWidth <= lt.clientWidth + 1),
          dx: Math.abs(xAt(a, a.textContent.indexOf("Amount")) - xAt(b, b.textContent.indexOf("$1,200"))),
        };
      });
      check("set fixed-pitch and unwrapped, as the file is", [look.mono, look.wrap], [true, "pre"]);
      truthy("every line seen to its end", look.fits);
      truthy(`a column typed straight in the file is straight on the page (${look.dx.toFixed(2)}px)`, look.dx < 0.5);
      check("the text unchanged", await pageText(p, 0), text0);
      check("the other page is held to the PDF as before", (await state(p, 1)).free, false);
      truthy("…its columns kept", (await state(p, 1)).cells > 0);
      // Spaces typed are spaces kept: no column cut moves them.
      await p.evaluate(() => {
        const body = document.querySelector("#pages .tpage .page-body");
        const lt = body.querySelectorAll(".line")[2].querySelector(".lt");
        const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
        let n, last = null; while ((n = w.nextNode())) last = n;
        const rg = document.createRange(); rg.setStart(last, last.data.length); rg.collapse(true);
        const s = getSelection(); s.removeAllRanges(); s.addRange(rg); body.focus();
      });
      await p.keyboard.type("      Paid", { delay: 10 });
      await p.waitForTimeout(700);
      check("still no column cells after typing spaces", (await state(p, 0)).cells, 0);
      truthy("the typed spacing stands", (await pageText(p, 0)).includes("May 4      Paid"));
      // Withdrawn: laid out as before.
      await fixClick(p, 0);
      await p.waitForTimeout(700);
      const back = await state(p, 0);
      check("withdrawn: not free", back.free, false);
      truthy("…its columns back", back.cells > 0);
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("2. reopened, the page is built free");
    {
      const r = await newReader();
      const p = r.page;
      await fixClick(p, 0);
      await p.waitForTimeout(500);
      await p.keyboard.press("Control+s");
      await p.waitForTimeout(1500);
      await openReader(p);
      const s = await state(p, 0);
      check("free on reopening", [s.free, s.cells, s.gutters], [true, 0, 4]);
      // Opened protected: ✓ Use my text on another page turns ✎ Edit on.
      truthy("reopened protected", await p.evaluate(() => !document.body.classList.contains("editing")));
      await fixClick(p, 1);
      await p.waitForTimeout(300);
      truthy("✎ Use my text turns ✎ Edit on", await p.evaluate(() => document.body.classList.contains("editing") && document.querySelectorAll("#pages .page-body")[1].isContentEditable));
      await fixClick(p, 1);
      await p.waitForTimeout(300);
      truthy("…and withdrawing it leaves ✎ Edit on", await p.evaluate(() => document.body.classList.contains("editing")));
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("3. beside its PDF, the page comes off the grid and its PDF page stays level");
    {
      const r = await newReader();
      const p = r.page;
      await p.evaluate(async () => {
        const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.TimesRoman);
        const pages = [
          ["DECLARATION OF TOBIAS WRENFIELD", "Name                    Amount           Date", "Tobias Wrenfield        $1,200           May 4", "End."],
          ["Name                    Amount           Date", "Other                   $5               June 1"],
        ];
        for (const lines of pages) {
          const pg = pdf.addPage([612, 792]);
          lines.forEach((t, k) => {
            const y = 792 - (100 + k * 24);
            pg.drawText(String(k + 1), { x: 40, y, size: 12, font });
            pg.drawText(t, { x: 72, y, size: 12, font });
          });
        }
        const f = new File([await pdf.save()], "A Decl.pdf", { type: "application/pdf" });
        await window.__textReaderPickPdfs([f]);
      });
      const sbs = await p.$("#sbs-toggle");
      if (!(await sbs.evaluate((b) => document.body.classList.contains("sbs") || b.getAttribute("aria-pressed") === "true"))) await sbs.click();
      await p.waitForFunction(() => !!document.querySelector("#pages .tpage.matched"), null, { timeout: 15000 });
      await p.waitForTimeout(1200);
      const matched = () => p.evaluate(() => [...document.querySelectorAll("#pages .tpage")].map((s) => s.classList.contains("matched")));
      check("both pages on the grid before", await matched(), [true, true]);
      await fixClick(p, 0);
      await p.waitForTimeout(1200);
      check("the freed page is off the grid, the other on it", await matched(), [false, true]);
      const level = await p.evaluate(() => {
        const sec = document.querySelector("#pages .tpage");
        const slot = document.querySelector('.pdf-slot[data-index="0"]');
        return slot ? Math.abs(slot.getBoundingClientRect().height - sec.getBoundingClientRect().height) : -1;
      });
      truthy(`its PDF page held to its height (off by ${level.toFixed ? level.toFixed(1) : level}px)`, level >= 0 && level <= 2);
      check("the margin numbers kept", (await state(p, 0)).gutters, 4);
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("4. the Flagged panel's list goes to each ✓ Use my text page, in whichever document it is");
    {
      const r = await newReader();
      const p = r.page;
      await p.evaluate((n) => window.__textReaderOpenDoc(n), "B Brief.txt");
      await p.waitForFunction(() => document.querySelectorAll("#pages .tpage").length === 6);
      await p.waitForTimeout(600);
      await fixClick(p, 4);
      await p.waitForTimeout(300);
      await p.evaluate((n) => window.__textReaderOpenDoc(n), "A Decl.txt");
      await p.waitForFunction(() => document.querySelectorAll("#pages .tpage").length === 2);
      await p.waitForTimeout(600);
      check("the list names the page", await p.evaluate(() => [...document.querySelectorAll("#text-fixed-list li")].map((li) => li.textContent)), ["B Brief — page 5"]);
      await p.evaluate(() => document.querySelector("#text-fixed-list li").click());
      await p.waitForFunction(() => document.querySelectorAll("#pages .tpage").length === 6, null, { timeout: 8000 });
      await p.waitForTimeout(1200);
      const at = await p.evaluate(() => {
        const stage = document.getElementById("pages").closest("#stage") || document.scrollingElement;
        const box = stage.getBoundingClientRect();
        const sec = document.querySelectorAll("#pages .tpage")[4];
        const r = sec.getBoundingClientRect();
        return { top: Math.round(r.top - box.top), h: Math.round(box.height), free: sec.querySelector(".page-body").classList.contains("free") };
      });
      truthy(`the document opened at page 5, its head in view (top ${at.top} of ${at.h})`, at.top >= -2 && at.top < at.h / 2);
      check("…a page free of the PDF", at.free, true);
      const hs = await p.evaluate(() => [...document.querySelectorAll("#pages .tpage")].slice(3, 6).map((sec) => Math.round(sec.getBoundingClientRect().height)));
      truthy(`a long free page is no longer than the pages either side (${hs.join(", ")})`, Math.abs(hs[1] - hs[0]) <= 2 && Math.abs(hs[1] - hs[2]) <= 2);
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
