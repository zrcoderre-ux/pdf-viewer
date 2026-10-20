// Browser test for ✓ Use my text (viewer/text-reader.js: setFree,
// markOwnLines; columns.js `.own`): pressing it changes nothing on screen,
// away from the PDF or beside it; spaces typed into a line then move that
// line's text and no other, its size and its place down the page untouched;
// the lines typed in are remembered when the document is opened again;
// withdrawing it makes the page an ordinary one; pressing it turns ✎ Edit on;
// and the Flagged panel's list goes to each page on it.
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

async function run() {
  srv = await startServer();
  browser = await chromium.launch({ executablePath: CHROME });
  try {
    console.log("1. pressing ✎ Use my text changes nothing on screen");
    {
      const r = await newReader();
      const p = r.page;
      const before = [await look(p, 0), await look(p, 1)];
      await fixClick(p, 0);
      await p.waitForTimeout(900);
      check("the page is on the list", await isFree(p, 0), true);
      check("…and looks exactly as it did, line for line", await look(p, 0), before[0]);
      check("…and so does the page after it", await look(p, 1), before[1]);
      check("no line is the operator's yet", (await own(p, 0)).some(Boolean), false);
      console.log("2. spaces typed into a line move its text, and no other line");
      const amount = await xOf(p, 0, 1, "Amount");
      const was = await xOf(p, 0, 2, "$1,200");
      truthy("caret placed", await caretBefore(p, 0, 2, "$1,200"));
      await p.keyboard.type("    ", { delay: 20 });
      await p.waitForTimeout(1200);
      check("the line typed in is the operator's own, and only it", await own(p, 0), [false, false, true, false]);
      const now = await xOf(p, 0, 2, "$1,200");
      truthy(`its text moved right by the spaces typed (${was.toFixed(1)} → ${now.toFixed(1)})`, now - was > 8);
      check("the line above did not move", await xOf(p, 0, 1, "Amount"), amount);
      const after = await look(p, 0);
      check("…nor did the others, nor their size or face", after.lines.filter((_, k) => k !== 2), before[0].lines.filter((_, k) => k !== 2));
      check("the line keeps its size and face", after.lines[2].slice(4), before[0].lines[2].slice(4));
      console.log("3. withdrawn, the page is an ordinary one again");
      await fixClick(p, 0);
      await p.waitForTimeout(900);
      check("off the list", await isFree(p, 0), false);
      check("no line marked", (await own(p, 0)).some(Boolean), false);
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("4. reopened, the page is still on the list and its own lines still its own; pressing it turns ✎ Edit on");
    {
      const r = await newReader();
      const p = r.page;
      await fixClick(p, 0);
      await p.waitForTimeout(300);
      await caretBefore(p, 0, 2, "$1,200");
      await p.keyboard.type("  ", { delay: 20 });
      await p.waitForTimeout(600);
      await p.keyboard.press("Control+s");
      await p.waitForTimeout(1500);
      await openReader(p);
      check("on the list on reopening", await isFree(p, 0), true);
      check("…the line typed in still the operator's own", await own(p, 0), [false, false, true, false]);
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
    console.log("5. beside its PDF: pressing it changes nothing; a line typed in moves alone");
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
      await p.waitForTimeout(1500);
      const before = await look(p, 0);
      await fixClick(p, 0);
      await p.waitForTimeout(1500);
      check("on the grid, the page looks exactly as it did", await look(p, 0), before);
      const amount = await xOf(p, 0, 1, "Amount");
      const was = await xOf(p, 0, 2, "$1,200");
      await caretBefore(p, 0, 2, "$1,200");
      await p.keyboard.type("    ", { delay: 20 });
      await p.waitForTimeout(1500);
      const now = await xOf(p, 0, 2, "$1,200");
      truthy(`its text moved right by the spaces typed (${was.toFixed(1)} → ${now.toFixed(1)})`, now - was > 4);
      check("the line above did not move", await xOf(p, 0, 1, "Amount"), amount);
      const after = await look(p, 0);
      check("…its place down the page and its size are the PDF's still", after.lines[2].slice(2, 5), before.lines[2].slice(2, 5));
      check("…and the page is the PDF page's size", after.h, before.h);
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("6. a form beside its PDF: an ordinary line's pieces stay where the PDF prints them; a line typed in on a ✓ Use my text page moves with its spaces");
    for (const fixed of [false, true]) {
      const r = await newReader();
      const p = r.page;
      await p.evaluate((n) => window.__textReaderOpenDoc(n), "C Form.txt");
      await p.waitForFunction(() => document.querySelectorAll("#pages .tpage").length === 1 && document.querySelector("#pages .page-body").textContent.includes("Amount"));
      await p.waitForTimeout(600);
      await p.evaluate(async () => {
        const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        const pg = pdf.addPage([612, 792]);
        [["Name", "Amount", "Date"], ["Tobias Wrenfield", "$1,200", "May 4"], ["Other", "$5", "June 1"]].forEach((row, k) => {
          const y = 792 - (100 + k * 20);
          row.forEach((t, j) => pg.drawText(t, { x: [72, 250, 420][j], y, size: 11, font }));
        });
        const f = new File([await pdf.save()], "C Form.pdf", { type: "application/pdf" });
        await window.__textReaderPickPdfs([f]);
      });
      const sbs = await p.$("#sbs-toggle");
      if (!(await sbs.evaluate((b) => document.body.classList.contains("sbs") || b.getAttribute("aria-pressed") === "true"))) await sbs.click();
      await p.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body.fixed"), null, { timeout: 15000 });
      await p.waitForTimeout(1500);
      if (fixed) {
        const before = await look(p, 0);
        await fixClick(p, 0);
        await p.waitForTimeout(1500);
        check("✓ Use my text: the form looks exactly as it did", await look(p, 0), before);
      }
      const face = () => p.evaluate(() => { const lt = document.querySelectorAll("#pages .page-body > .line")[1].querySelector(".lt"); const cs = getComputedStyle(lt); return [cs.fontFamily, cs.fontSize]; });
      const faceWas = await face();
      const was = await xOf(p, 0, 1, "$1,200");
      const other = await xOf(p, 0, 2, "$5");
      await caretBefore(p, 0, 1, "$1,200");
      await p.keyboard.type("        ", { delay: 20 });
      await p.waitForTimeout(1500);
      const now = await xOf(p, 0, 1, "$1,200");
      if (fixed) check("✓ Use my text: the line typed in keeps the PDF's face and size", await face(), faceWas);
      if (fixed) truthy(`✓ Use my text: the piece moved right by the spaces typed (${was.toFixed(1)} → ${now.toFixed(1)})`, now - was > 8);
      else truthy(`ordinary page: the piece stays where the PDF prints it (${was.toFixed(1)} → ${now.toFixed(1)})`, Math.abs(now - was) < 1);
      check(`${fixed ? "✓ Use my text" : "ordinary page"}: the line below did not move`, await xOf(p, 0, 2, "$5"), other);
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("8. typed into ⇄ Raw on a ✓ Use my text page laid on its PDF, side by side off: the page is the typing back as text");
    for (const beside of [false, true]) {
      const r = await newReader();
      const p = r.page;
      await p.evaluate(async () => {
        const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.TimesRoman);
        for (const lines of [["DECLARATION OF TOBIAS WRENFIELD", "Name                    Amount           Date", "Tobias Wrenfield        $1,200           May 4", "End."], ["Name                    Amount           Date", "Other                   $5               June 1"]]) {
          const pg = pdf.addPage([612, 792]);
          lines.forEach((t, k) => { const y = 792 - (100 + k * 24); pg.drawText(String(k + 1), { x: 40, y, size: 12, font }); pg.drawText(t, { x: 72, y, size: 12, font }); });
        }
        await window.__textReaderPickPdfs([new File([await pdf.save()], "A Decl.pdf", { type: "application/pdf" })]);
      });
      const sbs = await p.$("#sbs-toggle");
      const on = await sbs.evaluate((b) => b.getAttribute("aria-pressed") === "true");
      if (on !== beside) await sbs.click();
      await p.waitForTimeout(3000);
      console.log("DBG", await p.evaluate(() => [document.body.className, document.querySelectorAll("#pages .tpage").length, document.querySelectorAll("#pages .tpage.matched").length, JSON.stringify(window.__textReaderPdfQueue ? window.__textReaderPdfQueue() : null)]));
      await p.waitForFunction(() => !!document.querySelector("#pages .tpage.matched"), null, { timeout: 15000 });
      await p.waitForTimeout(1200);
      await fixClick(p, 0);
      await p.waitForTimeout(900);
      await p.evaluate(() => document.querySelectorAll("#pages .tpage")[0].querySelector(".page-label .raw-page").click());
      await p.waitForTimeout(300);
      const placed = await p.evaluate(() => {
        const pre = document.querySelectorAll("#pages .tpage")[0].querySelector(".raw-sheet .raw-text");
        if (!pre || !pre.isContentEditable) return false;
        pre.focus();
        const w = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const k = n.data.indexOf("End.");
          if (k >= 0) { const rg = document.createRange(); rg.setStart(n, k + 4); rg.collapse(true); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg); return true; }
        }
        return false;
      });
      truthy(`side by side ${beside ? "on" : "off"}: caret placed in the raw sheet`, placed);
      await p.keyboard.type(" Signed.", { delay: 10 });
      await p.waitForTimeout(100);
      await p.evaluate(() => document.querySelectorAll("#pages .tpage")[0].querySelector(".page-label .raw-page").click());
      await p.waitForTimeout(1000);
      const text = await p.evaluate(() => [...document.querySelectorAll("#pages .tpage")[0].querySelectorAll(".page-body > .line")].map((l) => (l.querySelector(".lt") || l).textContent).join("\n"));
      truthy(`side by side ${beside ? "on" : "off"}: back as text, the page is what was typed (${JSON.stringify(text.split("\n").pop())})`, /End\. Signed\.$/.test(text));
      await p.evaluate(() => document.querySelectorAll("#pages .tpage")[0].querySelector(".page-label .raw-page").click());
      await p.waitForTimeout(300);
      truthy(`side by side ${beside ? "on" : "off"}: …and ⇄ Raw again shows it`, await p.evaluate(() => /End\. Signed\./.test(document.querySelectorAll("#pages .tpage")[0].querySelector(".raw-sheet .raw-text").textContent)));
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("7. the Flagged panel's list goes to each ✓ Use my text page, in whichever document it is");
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
        const stage = document.getElementById("stage");
        const box = stage.getBoundingClientRect();
        const r = document.querySelectorAll("#pages .tpage")[4].getBoundingClientRect();
        return { top: Math.round(r.top - box.top), h: Math.round(box.height) };
      });
      truthy(`the document opened at page 5, its head in view (top ${at.top} of ${at.h})`, at.top >= -2 && at.top < at.h / 2);
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
