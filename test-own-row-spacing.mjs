// Browser test for a single-spaced block on pleading paper beside its PDF: a
// proof of service's 13-point type set at 15 points' leading on 24-point
// paper, the export
// writing a line at each number and one between some of them. Held at its
// numbers and half lines, each line had 12 points and the block was taken
// down to under its size (pdfsync.fitRuns). The owner
// (2026-11-24): yes to "use the PDF's own row spacing there"
// (pdfsync.ownRowTops).
//
// Checked: pdfsync.ownRowTops on its own (node); in the reader, every line of
// the block at the PDF's 13 point, the lines 15 points apart as printed, the
// margin numbers still 24 points apart, no line on top of another.
//
// Run: node test-own-row-spacing.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium)
// and a free port in 8130-8199 for python3's http.server; the browser part
// exits 0 with SKIP where any is missing. Every name in it is invented.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browser-for-tests.mjs";
import * as PS from "./viewer/pdfsync.js";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const PW = "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = "/opt/pw-browsers/chromium";

let fails = 0, passes = 0;
function check(label, ok, note = "") {
  if (ok) passes++; else fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok && note) console.log(`        ${note}`);
}

// ── pdfsync.ownRowTops on its own ───────────────────────────────────────────
console.log("ownRowTops");
{
  const tops = [100, 111, 122, 133, 144, 166, 188], fixed = [true, false, true, false, true, true, true];
  const clear = tops.map(() => 13);
  const rows = [100, 114, 128, 142, 156, 170, 188].map((top) => ({ top }));
  const f = PS.fitRuns(tops, clear, fixed, { floor: 0.4 });
  check("fitRuns alone takes the block down", f.some((x) => x < 0.999));
  const own = PS.ownRowTops(tops, fixed, clear, [0, 1, 2, 3, 4, 5, 6], rows, f);
  check("the block stands on the PDF's rows", own.tops.join() === "100,114,128,142,156,170,188", own.tops.join());
  const f2 = PS.fitRuns(own.tops, clear, fixed, { floor: 0.4 });
  check("…and nothing is taken down there", f2.every((x) => x === 1), f2.join());
  const side = PS.ownRowTops([100, 111, 122], [true, false, true], [13, 13, 13], [0, 1, 2], [{ top: 100 }, { top: 100 }, { top: 122 }], [1, 0.69, 1]);
  check("lines side by side (a caption) are left to fitRuns", !side.moved.some(Boolean), side.moved.join());
  const unrowed = PS.ownRowTops(tops, fixed, clear, [0, null, 2, 3, 4, 5, 6], rows, f);
  check("a run with a line no PDF row printed stays on its numbers", !unrowed.moved[1] && !unrowed.moved[0], unrowed.moved.join());
}

function skip(why) {
  console.log(`SKIP (browser part): ${why}`);
  console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
  process.exit(fails ? 1 : 0);
}
if (!fs.existsSync(PW)) skip("Playwright is not installed at " + PW);
if (!fs.existsSync(CHROME)) skip("Chromium is not installed at " + CHROME);
const { chromium } = await import(PW);
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}
async function startServer() {
  let port = 0;
  for (let p = 8130; p <= 8199; p++) if (await portFree(p)) { port = p; break; }
  if (!port) skip("no free port in 8130-8199");
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: REPO, stdio: "ignore" });
  for (let t = 0; t < 80; t++) {
    const up = await new Promise((resolve) => { const c = net.connect(port, "127.0.0.1", () => { c.end(); resolve(true); }); c.on("error", () => resolve(false)); });
    if (up) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base: `http://127.0.0.1:${port}`, stop: () => { try { proc.kill("SIGTERM"); } catch { /* gone */ } } };
}

// The PDF: a proof of service's paragraph in 13 point, single-spaced at 15
// points from line 10 of 24-point paper: a half line's 12 points do not hold
// its type.
const PARA = [
  "I, Marisol T. Quenby, declare: I am employed in the County of Fernbrook,",
  "State of California. I am over the age of eighteen years and not a party",
  "to the within action; my business address is 18 Larkmere Lane, Suite 400,",
  "Fernbrook, California 90001. On the date below I served the foregoing",
  "document described as NOTICE OF MOTION AND MOTION on the interested",
  "parties in this action by placing a true copy thereof enclosed in a",
  "sealed envelope addressed as stated on the attached service list. I am",
  "readily familiar with the firm's practice of collection and processing",
  "correspondence for mailing. Under that practice it would be deposited",
  "with the U.S. Postal Service on that same day with postage fully prepaid.",
];
const at = PARA.map((_t, i) => 10 + (i * 15) / 24);
// The export, as PDF-Linker writes it: a line at each number, and one between
// two numbers where the paragraph has two there.
const NUMS = [10, null, 11, null, 12, 13, null, 14, null, 15];
const EXPORT = [
  "====== Page 1 ======",
  ...Array.from({ length: 9 }, (_v, k) => String(k + 1).padStart(2)),
  ...PARA.map((t, i) => (NUMS[i] ? String(NUMS[i]).padStart(2) + "  " : "    ") + t),
  ...Array.from({ length: 13 }, (_v, k) => String(k + 16).padStart(2)),
].join("\n") + "\n";

const srv = await startServer();
const browser = await launchBrowser(chromium, CHROME);
try {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // A folder handle is never put in IndexedDB here: the Chromium this runs on
  // in some containers goes down reading an origin-private folder's handle
  // back out of it, and the folder is only remembered, not needed, for this.
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) {
      if (v && typeof FileSystemHandle === "function" && v.handle instanceof FileSystemHandle) throw new DOMException("not kept in this test", "DataCloneError");
      return put.call(this, v, k);
    };
  });
  await page.goto(srv.base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder);
  await page.evaluate(async (text) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry("Case Own Rows", { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle("Case Own Rows", { create: true });
    const t = await dir.getDirectoryHandle("Text Files", { create: true });
    const w = await (await t.getFileHandle("Proof.txt", { create: true })).createWritable(); await w.write(text); await w.close();
    await window.__textReaderAdoptFolder(dir);
    await window.__textReaderOpenDoc("Proof.txt");
  }, EXPORT);
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.evaluate(async (items) => {
    const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const doc = await PDFDocument.create();
    const fonts = { r: await doc.embedFont(StandardFonts.TimesRoman), b: await doc.embedFont(StandardFonts.TimesRomanBold), i: await doc.embedFont(StandardFonts.TimesRomanItalic) };
    const pg = doc.addPage([612, 792]);
    const base = (line) => 792 - (100 + (line - 1) * 24);
    for (let n = 1; n <= 28; n++) pg.drawText(String(n), { x: 46 - fonts.r.widthOfTextAtSize(String(n), 12), y: base(n), size: 12, font: fonts.r });
    items.text.forEach((t, i) => pg.drawText(t, { x: 72, y: base(items.at[i]), size: 13, font: fonts.r }));
    await window.__textReaderPickPdfs([new File([await doc.save()], "Proof.pdf", { type: "application/pdf" })]);
  }, { text: PARA, at });
  await page.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body.fixed"), null, { timeout: 15000 });
  await page.waitForTimeout(1000);
  const sbs = await page.$("#sbs-toggle");
  if (!(await sbs.evaluate((b) => b.getAttribute("aria-pressed") === "true"))) await sbs.click();
  await page.waitForTimeout(2500);
  const got = await page.evaluate(() => {
    const body = document.querySelector("#pages .tpage .page-body");
    const br = body.getBoundingClientRect();
    const scale = br.width / 612;
    return [...body.querySelectorAll(":scope > .line")].map((l) => {
      const lt = l.querySelector(":scope > .lt");
      const gn = l.querySelector(".gn");
      return {
        text: lt ? lt.textContent : "",
        num: gn ? parseInt(gn.textContent, 10) : null,
        top: (l.getBoundingClientRect().top - br.top) / scale,
        gnTop: gn ? (gn.getBoundingClientRect().top - br.top) / scale : null,
        size: parseFloat(getComputedStyle(l).fontSize) / scale,
      };
    });
  });
  const block = got.filter((l) => PARA.some((t) => l.text.includes(t.slice(0, 20))));
  check("the paragraph's ten lines are drawn", block.length === 10, String(block.length));
  console.log("sizes");
  check("every line of the block at the PDF's 13 point", block.every((l) => Math.abs(l.size - 13) < 0.2), block.map((l) => l.size.toFixed(1)).join(" "));
  console.log("spacing");
  const gaps = block.slice(1).map((l, i) => l.top - block[i].top);
  check("the lines 15 points apart, as printed", gaps.every((g) => Math.abs(g - 15) < 1.5), gaps.map((g) => g.toFixed(1)).join(" "));
  const nums = got.filter((l) => l.num >= 9 && l.num <= 16 && l.gnTop != null);
  const numGaps = nums.slice(1).map((l, i) => (l.gnTop - nums[i].gnTop) / (l.num - nums[i].num));
  check("the margin numbers still 24 points apart", numGaps.length > 4 && numGaps.every((g) => Math.abs(g - 24) < 1.5), numGaps.map((g) => g.toFixed(1)).join(" "));
  const clashes = block.slice(1).filter((l, i) => l.top < block[i].top + block[i].size - 0.5);
  check("no line on top of another", clashes.length === 0, clashes.map((l) => l.text.slice(0, 20)).join(" | "));
  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  srv.stop();
}
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
