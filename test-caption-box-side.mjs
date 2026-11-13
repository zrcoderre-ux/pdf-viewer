// Browser test for a caption's `)` side beside its PDF: the bar where the PDF
// draws its box's side, the right-hand column on the sheet. The owner, of a
// declaration's caption page side by side: "there is too much empty white
// space between the parites and the verticle line and not enough space on the
// right margin. it is cut off right after SERVICE before "OF" … PERSONAL reads
// as PERSON". The export's `)` column is where PDF-Linker's characters put it,
// not where the PDF draws the box: on the reader's grid it stood far right of
// the PDF's line and ran the causes of action off the sheet.
//
// Checked: the bar within a few points of the PDF's line; every line of the
// right-hand column ends inside the sheet; the left column's text clear of the
// bar.
//
// Run: node test-caption-box-side.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium)
// and a free port in 8130-8199 for python3's http.server; exits 0 with SKIP
// where any is missing. Every name in it is invented.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browser-for-tests.mjs";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const PW = "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = "/opt/pw-browsers/chromium";

function skip(why) { console.log(`SKIP: ${why}`); process.exit(0); }
if (!fs.existsSync(PW)) skip("Playwright is not installed at " + PW);
if (!fs.existsSync(CHROME)) skip("Chromium is not installed at " + CHROME);
const { chromium } = await import(PW);

let fails = 0, passes = 0;
function check(label, ok, note = "") {
  if (ok) passes++; else fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok && note) console.log(`        ${note}`);
}

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

// The PDF's box: its side at SIDE, the right-hand column from RIGHT, the
// type's right margin at 540.
const SIDE = 325, RIGHT = 331;
const R = "r", B = "b";
// [text, line, x, font]
const LEFT = [
  ["QUARRY JETSTREAM, LLC, a California", 14], ["limited liability company;", 14.5],
  ["Plaintiff,", 15.5, 150], ["vs.", 16.5, 110],
  ["BRAMLEY FOXTON LLC, a Massachusetts limited", 17.5], ["liability company; ODELL PRAX, an individual;", 18],
  ["WEN CHO, an individual; HALDEN ROOKE", 18.5], ["PARKHURST INC., a California corporation; and", 19],
  ["DOES 1 through 50, inclusive,", 19.5], ["Defendants.", 21, 150],
];
const RIGHTS = [
  ["Case No.: 26STZV54134", 14, R], ["[Assigned for all purposes to Hon. Wyndham", 15, R], ["Harrell, Dept 718.]", 15.5, R],
  ["DECLARATION OF SPECIALLY-", 16.5, B], ["APPEARING DEFENDANT WEN CHO", 17, B], ["IN SUPPORT OF HER NOTICE OF MOTION", 17.5, B],
  ["AND MOTION TO QUASH SERVICE OF", 18, B], ["SUMMONS FOR LACK OF PERSONAL", 18.5, B], ["JURISDICTION", 19, B],
  ["[Notice of Motion and Motion to Quash Service of", 20.5, R], ["Summons for Lack of Personal Jurisdiction; and", 21, R],
  ["[Proposed] Order filed concurrently herewith]", 21.5, R], ["Date:  December 8, 2026", 24, R], ["Dept:  718", 25, R],
];
const PDF = [
  ["SUPERIOR COURT OF THE STATE OF CALIFORNIA", 12, 170, B],
  ...LEFT.map(([t, line, x]) => [t, line, x || 72, R]),
  ...RIGHTS.map(([t, line, f]) => [t, line, RIGHT, f]),
];

// The export, as PDF-Linker writes such a caption: the `)` side where its
// characters put it, right of where the PDF draws the box — at 64, as far
// right as a key's longer fakes push it.
function exportAt(COL) {
  const rowsOf = new Map();
  const slot = (line) => { if (!rowsOf.has(line)) rowsOf.set(line, ["", ""]); return rowsOf.get(line); };
  for (const [t, line, x] of LEFT) slot(line)[0] = " ".repeat(x ? Math.round((x - 72) / 6) : 0) + t;
  for (const [t, line] of RIGHTS) slot(line)[1] = t;
  const EXPORT = ["====== Page 1 ======"];
  for (let n = 1; n <= 28; n++) {
    for (const half of [0, 0.5]) {
      const line = n + half;
      const num = half ? "    " : String(n).padStart(2) + "  ";
      if (line === 12) { EXPORT.push(num + "               SUPERIOR COURT OF THE STATE OF CALIFORNIA"); continue; }
      if (line >= 14 && line <= 26) {
        const [l, r] = rowsOf.get(line) || ["", ""];
        if (half && !l && !r) continue;
        EXPORT.push((num + l).padEnd(COL) + ")" + (r ? "  " + r : ""));
        continue;
      }
      if (line === 26.5) { EXPORT.push("    " + "_".repeat(COL - 4) + ")"); continue; }
      if (!half) EXPORT.push(num.trimEnd());
    }
}
return EXPORT.join("\n") + "\n";
}

const srv = await startServer();
const browser = await launchBrowser(chromium, CHROME);
try {
for (const COL of [52, 64]) {
    console.log(`the export's side at column ${COL}`);
    const TEXT = exportAt(COL);
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
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
      try { await top.removeEntry("Case Box", { recursive: true }); } catch { /* none yet */ }
      const dir = await top.getDirectoryHandle("Case Box", { create: true });
      const t = await dir.getDirectoryHandle("Text Files", { create: true });
      const w = await (await t.getFileHandle("Decl.txt", { create: true })).createWritable(); await w.write(text); await w.close();
      await window.__textReaderAdoptFolder(dir);
      await window.__textReaderOpenDoc("Decl.txt");
    }, TEXT);
    await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
    await page.evaluate(async ({ items, side }) => {
      const { PDFDocument, StandardFonts, rgb } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
      const doc = await PDFDocument.create();
      const fonts = { r: await doc.embedFont(StandardFonts.TimesRoman), b: await doc.embedFont(StandardFonts.TimesRomanBold) };
      const pg = doc.addPage([612, 792]);
      const base = (line) => 792 - (100 + (line - 1) * 24);
      for (let n = 1; n <= 28; n++) pg.drawText(String(n), { x: 46 - fonts.r.widthOfTextAtSize(String(n), 12), y: base(n), size: 12, font: fonts.r });
      for (const [t, line, x, f] of items) pg.drawText(t, { x, y: base(line), size: 12, font: fonts[f] });
      pg.drawLine({ start: { x: side, y: base(13.5) }, end: { x: side, y: base(26.5) }, thickness: 1, color: rgb(0, 0, 0) });
      pg.drawLine({ start: { x: 72, y: base(26.5) }, end: { x: side, y: base(26.5) }, thickness: 1, color: rgb(0, 0, 0) });
      await window.__textReaderPickPdfs([new File([await doc.save()], "Decl.pdf", { type: "application/pdf" })]);
    }, { items: PDF, side: SIDE });
    await page.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body.fixed"), null, { timeout: 15000 });
    await page.waitForTimeout(1000);
    const sbs = await page.$("#sbs-toggle");
    if (!(await sbs.evaluate((b) => b.getAttribute("aria-pressed") === "true"))) await sbs.click();
    await page.waitForTimeout(2500);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(/\.png$/, `-${COL}.png`) });
    const got = await page.evaluate((texts) => {
      const sec = document.querySelector("#pages .tpage");
      const sr = sec.getBoundingClientRect();
      const scale = sr.width / 612;
      const bars = [...sec.querySelectorAll(".rb.paren")].map((b) => (b.getBoundingClientRect().left - sr.left) / scale);
      const ends = {};
      const walk = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        for (const t of texts) {
          const i = n.data.indexOf(t);
          if (i < 0) continue;
          const r = document.createRange();
          r.setStart(n, i); r.setEnd(n, i + t.length);
          const b = r.getBoundingClientRect();
          ends[t] = { from: (b.left - sr.left) / scale, to: (b.right - sr.left) / scale };
        }
      }
      return { bars, ends, rules: sec.querySelector(".page-body").__rules };
    }, [...LEFT.map((l) => l[0]), ...RIGHTS.map((r) => r[0])]);
    const bar = got.bars.length ? Math.min(...got.bars) : NaN;
    console.log(`bar at ${bar.toFixed(1)} pt, the PDF's at ${SIDE}`);
    check("the bars one column", got.bars.length > 5 && Math.max(...got.bars) - Math.min(...got.bars) < 0.5, got.bars.join(" "));
    // The reader's type runs a few percent wider than the PDF's, and the
    // parties here come within a dozen points of the PDF's side: the bar stands
    // at the PDF's side or just clear of the widest party line, no further.
    const partyEnd = Math.max(...LEFT.map(([t]) => (got.ends[t] ? got.ends[t].to : 0)));
    const want = Math.max(SIDE, partyEnd + 1);
    check("the bar at the PDF's box side, or just clear of the parties", bar >= SIDE - 3 && bar <= want + 4, `bar at ${bar.toFixed(1)}, the PDF's at ${SIDE}, the parties end at ${partyEnd.toFixed(1)}`);
    const right = RIGHTS.map(([t]) => [t, got.ends[t]]);
    const off = right.filter(([, e]) => !e || e.to > 612 - 24);
    check("every line of the right-hand column ends on the sheet, clear of its edge", off.length === 0, off.map(([t, e]) => `${t} → ${e ? e.to.toFixed(1) : "?"}`).join(" | "));
    const starts = right.filter(([, e]) => e).map(([, e]) => e.from);
    check("…and starts as far past the bar as the PDF starts it past its side", starts.every((x) => Math.abs(x - bar - (RIGHT - SIDE)) <= 4), starts.map((x) => x.toFixed(1)).join(" "));
    const crowd = LEFT.filter(([t]) => got.ends[t] && got.ends[t].to > bar - 1);
    check("the parties clear of the bar", crowd.length === 0, crowd.map(([t]) => t).join(" | "));
    check("no page errors", errors.length === 0, errors.join(" | "));
    await page.context().close();
}
} finally {
  await browser.close();
  srv.stop();
}
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
