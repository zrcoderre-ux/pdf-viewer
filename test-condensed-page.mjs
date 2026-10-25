// Browser test for a condensed transcript's sheet (textdoc.js:
// headerSaysCondensed; text-reader.js: buildPages, slotLines,
// applyMatchedLayoutNow): PDF-Linker writes the four deposition pages a court
// reporter prints on one sheet one after another, each under its "Page N"
// heading with its own line numbers 1-25, and says so in the page's header.
// The reader reads that page a line a row, as the file has it — away from the
// PDF and beside it — never laid on the PDF page's grid (where the left
// column's numbers pinned all four pages' lines 1 to 25 and crammed the rest
// between them) and never slotted (where the heading between line 25 of one
// page and line 1 of the next made a slot of two rows, and every numbered page
// on screen went double spaced); # Number lines and ✕ Remove numbers are not
// offered on it. A pleading page beside it is laid as before. A LEAKS row
// whose Where names one of the sheet's pages ("p.2 (printed p.32):5") is
// found on that page's line 5, not the first line 5 of the sheet
// (condensedPageOf).
//
// Run: node test-condensed-page.mjs   (from the repo root)
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

// ── the key and the worksheet, as real .xlsx ────────────────────────────────
function buildXlsx(name, sheet, head, rows) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "condensed-")), name);
  const py = `
import json, sys, openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = sys.argv[2]
ws.append(json.loads(sys.argv[3]))
for r in json.loads(sys.argv[4]): ws.append(r)
wb.save(sys.argv[1])
`;
  execFileSync("python3", ["-I", "-c", py, out, sheet, JSON.stringify(head), JSON.stringify(rows)]);
  return fs.readFileSync(out);
}
const KEY_BYTES = buildXlsx("pseudonym_key.xlsx", "Pseudonym Key",
  ["Category", "Real Value", "Replacement", "Context", "Status", "Source", "Occurrences"],
  [["person", "Corla Ventimiglia", "Maren Fallowby", "", "", "spreadsheet", 4]]);
// A name said on line 5 of every page of the sheet; the row stands on page 32's.
const LEAKS_BYTES = buildXlsx("LEAKS.xlsx", "LEAKS",
  ["Value", "Fix? (yes/no)", "Context", "File", "Type", "Where (page:line)", "Notes"],
  [["Gravenor", "", "Gravenor said so.", "Deposition.pdf", "REVIEW", "p.2 (printed p.32):5", ""]]);

// ── the export: a pleading page, then a sheet of pages 30-33 ────────────────
const CASE = "Case Condensed";
const PAGES = [30, 31, 32, 33];
const L = ["====== Page 1 ======"];
for (let n = 1; n <= 12; n++) L.push(String(n).padStart(2) + `  Pleading line ${n}.`);
L.push(`====== Page 2 (printed p. 30-33) — NOTE: CONDENSED TRANSCRIPT: 4 pages printed on this one (pages ${PAGES.join(", ")}), each written in turn with its own line numbers ======`);
L.push("              Maren Fallowby v. Ashgrove Freight Lines");
for (const p of PAGES) {
  L.push(`                        Page ${p}`);
  for (let n = 1; n <= 25; n++) L.push(String(n).padStart(2) + `  Q Line ${n} of page ${p}` + (n === 5 ? ", Gravenor said so." : "."));
}
L.push("    Reporting Co.    9 (Pages 30 - 33)    Halvorsen Reporting");
const A = L.join("\n") + "\n";

let srv = null, browser = null;
async function newReader({ leaks = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const log = { errors: [] };
  page.on("pageerror", (e) => log.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) log.errors.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto(srv.base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
  await page.evaluate(async ({ CASE, A, keyBytes, leaksBytes }) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(CASE, { create: true });
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    if (leaksBytes) await put(dir, "LEAKS.xlsx", new Uint8Array(leaksBytes));
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    await put(text, "Deposition.txt", A);
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, A, keyBytes: Array.from(KEY_BYTES), leaksBytes: leaks ? Array.from(LEAKS_BYTES) : null });
  await page.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event("change")); } });
  await page.evaluate((n) => window.__textReaderOpenDoc(n), "Deposition.txt");
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 1);
  await page.waitForTimeout(800);
  return { context, page, log, close: () => context.close() };
}

// The sheet's lines: their tops, how far each stands below the one before,
// and whether any is slotted.
const sheet = (p) => p.evaluate(() => {
  const sec = document.querySelectorAll("#pages .tpage")[1];
  const lines = [...sec.querySelectorAll(".page-body > .line")];
  const tops = lines.map((l) => l.getBoundingClientRect().top);
  const steps = tops.slice(1).map((t, k) => Math.round((t - tops[k]) * 10) / 10);
  return {
    condensed: sec.classList.contains("condensed"),
    matched: sec.classList.contains("matched"),
    lines: lines.length,
    slotted: lines.filter((l) => l.dataset.slot).length,
    min: Math.min(...steps),
    max: Math.max(...steps),
    numberButtons: [...sec.querySelectorAll(".page-label .num-page, .page-label .unnum-page")].map((b) => b.hidden),
    slotRows: document.getElementById("pages").style.getPropertyValue("--slot-rows") || "1",
  };
});

async function run() {
  srv = await startServer();
  browser = await launchBrowser(chromium, CHROME);
  try {
    console.log("1. away from the PDF: the sheet a line a row, nothing slotted, no numbering offered");
    {
      const r = await newReader();
      const p = r.page;
      const s = await sheet(p);
      check("the page knows it is a condensed transcript's sheet", s.condensed, true);
      check("every line of the file a line on the page", s.lines, 1 + 4 * 26 + 1);
      check("no line slotted", s.slotted, 0);
      truthy(`each line one row below the last (steps ${s.min} to ${s.max})`, s.min > 0 && s.max - s.min <= 1);
      check("…and no numbered page on screen padded to two rows", s.slotRows, "1");
      check("# Number lines and ✕ Remove numbers not offered", s.numberButtons, [true, true]);
      check("the file's lines as they are", await p.evaluate(() => [...document.querySelectorAll("#pages .tpage")[1].querySelectorAll(".page-body > .line")].slice(1, 4).map((l) => l.textContent)), ["                        Page 30", " 1  Q Line 1 of page 30.", " 2  Q Line 2 of page 30."]);
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("1b. a LEAKS row is found on the sheet's page its Where names");
    {
      const r = await newReader({ leaks: true });
      const p = r.page;
      await p.evaluate(() => window.__textReaderGoToLeak(0));
      await p.waitForFunction(() => { const h = CSS.highlights.get("leakrow-here"); return !!h && h.size > 0; }, null, { timeout: 8000 });
      check("marked on page 32's line 5, not page 30's", await p.evaluate(() => {
        const r = [...CSS.highlights.get("leakrow-here")][0];
        const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
        return [r.toString(), el.closest(".line").textContent];
      }), ["Gravenor", " 5  Q Line 5 of page 32, Gravenor said so."]);
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("2. beside the PDF: the sheet flows, the pleading page is laid on its grid");
    {
      const r = await newReader();
      const p = r.page;
      await p.evaluate(async () => {
        const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.TimesRoman);
        const mono = await pdf.embedFont(StandardFonts.Courier);
        const one = pdf.addPage([612, 792]);
        for (let n = 1; n <= 12; n++) {
          const y = 792 - (100 + (n - 1) * 24);
          one.drawText(String(n), { x: 46 - font.widthOfTextAtSize(String(n), 12), y, size: 12, font });
          one.drawText(`Pleading line ${n}.`, { x: 72, y, size: 12, font });
        }
        const two = pdf.addPage([612, 792]);
        const places = [[36, 60], [36, 410], [318, 60], [318, 410]];
        [30, 31, 32, 33].forEach((pno, k) => {
          const [bx, by] = places[k];
          two.drawText(`Page ${pno}`, { x: bx + 111, y: 792 - (by + 12), size: 8, font });
          for (let n = 1; n <= 25; n++) {
            const y = 792 - (by + 28 + (n - 1) * 12);
            two.drawText(String(n), { x: bx + 14 - font.widthOfTextAtSize(String(n), 7), y, size: 7, font });
            two.drawText(`Q Line ${n} of page ${pno}.`, { x: bx + 22, y, size: 7, font: mono });
          }
        });
        const f = new File([await pdf.save()], "Deposition.pdf", { type: "application/pdf" });
        await window.__textReaderPickPdfs([f]);
      });
      const sbs = await p.$("#sbs-toggle");
      if (!(await sbs.evaluate((b) => document.body.classList.contains("sbs") || b.getAttribute("aria-pressed") === "true"))) await sbs.click();
      await p.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body"), null, { timeout: 15000 });
      await p.waitForTimeout(1500);
      check("the pleading page is laid on its PDF page's grid", await p.evaluate(() => document.querySelectorAll("#pages .tpage")[0].classList.contains("matched")), true);
      const s = await sheet(p);
      check("the sheet is not", s.matched, false);
      check("…nothing slotted", s.slotted, 0);
      truthy(`…each line one row below the last (steps ${s.min} to ${s.max})`, s.min > 0 && s.max - s.min <= 1);
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
