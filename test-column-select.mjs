// Browser test for a drag down one column of a page (viewer/text-reader.js,
// "a drag down a column takes that column"). The owner, of a permit's box
// whose right-hand cell is OCR noise: "I should be able to select the
// gibberish text on the right side of the line without it selecting the left.
// That is part of what the column should achieve."
//
// Checked, in the editor: a drag from a box's right-hand cell down to a row
// further on paints and copies the right-hand cells only — none of the
// left-hand cells' text, not the name in one of them, not the box's bars —
// and a line of rules between gives no blank line; an edit over such a
// selection is refused and the page is unchanged; a click lets it go and
// typing works again; Ctrl+A takes the page whole. On a page whose columns are
// laid out with spaces (columns.js), a drag down either column takes that
// column alone; a drag along one line is the browser's own.
//
// Run: node test-column-select.mjs   (from the repo root)
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
const truthy = (label, v, note) => { check(label, !!v, true); if (!v && note) console.log(`        ${note}`); };

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

function buildKey(rows) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "column-select-")), "pseudonym_key.xlsx");
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
const KEY_BYTES = buildKey([["person", "Corwin Ashdale", "Tobias Wrenfield", "", "", "spreadsheet", 1]]);

// The file carries the fake; the screen shows "Corwin Ashdale" in the box's left-hand cell.
const W = 30;
const cell = (s) => " " + s.padEnd(W - 1);
const row = (l, r) => "│" + cell(l) + "│" + cell(r) + "│";
const rule = (a, m, b) => a + "─".repeat(W) + m + "─".repeat(W) + b;
const RIGHT = ["The carrier named on xq~p,c", "lht: Dcpnrt111c ofMot6r", "carrier of)~fp{~!,~~1 d~J", "mcl 1hc requ!re11_1c111s"];
const LEFT = ["Tobias Wrenfield", "4445 E TREFOIL AVE", "MAYWOOD, CA 90270", "Pmt Date: 10/16/2018"];
const COLS = [
  ["Left column text one", "Right column alpha"],
  ["Left column text two", "Right column beta"],
  ["Left column text three", "Right column gamma"],
  ["Left column text four", "Right column delta"],
];
const DOC = [
  "====== Page 1 ======",
  "PERMIT NOTICE",
  rule("┌", "┬", "┐"),
  row(LEFT[0], RIGHT[0]),
  row(LEFT[1], RIGHT[1]),
  row(LEFT[2], RIGHT[2]),
  rule("├", "┼", "┤"),
  row(LEFT[3], RIGHT[3]),
  rule("└", "┴", "┘"),
  "Changes to your business entity may require a new application.",
  "====== Page 2 ======",
  "TWO COLUMNS",
  ...COLS.map(([l, r]) => l.padEnd(34) + r),
  "",
].join("\n") + "\n";

const srv = await startServer();
const browser = await launchBrowser(chromium, CHROME);
try {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errors = [], toasts = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) {
      if (v && typeof FileSystemHandle === "function" && v.handle instanceof FileSystemHandle) throw new DOMException("not kept in this test", "DataCloneError");
      return put.call(this, v, k);
    };
  });
  await page.goto(srv.base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
  await page.exposeFunction("__testToast", (t) => toasts.push(t));
  await page.evaluate(() => {
    const el = document.getElementById("toast");
    new MutationObserver(() => { const t = el.textContent.trim(); if (t) window.__testToast(t); }).observe(el, { childList: true, characterData: true, subtree: true });
  });
  await page.evaluate(async ({ text, keyBytes }) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry("Case Columns", { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle("Case Columns", { create: true });
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    await put(await dir.getDirectoryHandle("Text Files", { create: true }), "Permit.txt", text);
    await window.__textReaderAdoptFolder(dir);
  }, { text: DOC, keyBytes: Array.from(KEY_BYTES) });
  await page.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event("change")); } });
  await page.evaluate(() => window.__textReaderOpenDoc("Permit.txt"));
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body .line.rl").length >= 4);
  await page.waitForTimeout(800);
  await page.evaluate(() => document.getElementById("edit-toggle").click());
  await page.waitForTimeout(300);

  /** Where a phrase's character `at` stands on screen: [x, y] at its middle. */
  const pointOf = (phrase, at = 0, side = "left", scroll = false) => page.evaluate(({ phrase, at, side, scroll }) => {
    const walk = document.createTreeWalker(document.getElementById("pages"), NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const i = n.data.indexOf(phrase);
      if (i < 0) continue;
      const k = i + (at < 0 ? phrase.length + at : at);
      if (scroll) { n.parentElement.scrollIntoView({ block: "center" }); return null; }
      const r = document.createRange(); r.setStart(n, k); r.setEnd(n, k + 1);
      const b = r.getBoundingClientRect();
      return [side === "left" ? b.left + 0.5 : b.right - 0.5, b.top + b.height / 2];
    }
    return null;
  }, { phrase, at, side, scroll });
  async function drag(from, to) {
    await pointOf(from[0], 0, "left", true);
    await page.waitForTimeout(300); // side by side, the other column follows the scroll
    const a = await pointOf(...from), b = await pointOf(...to);
    await page.mouse.move(a[0], a[1]);
    await page.mouse.down();
    await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 6 });
    await page.mouse.move(b[0], b[1], { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);
  }
  const copy = () => page.evaluate(() => {
    const dt = new DataTransfer();
    const sel = getSelection();
    const at = sel.rangeCount ? sel.getRangeAt(0).startContainer : document.body;
    (at.nodeType === 1 ? at : at.parentElement).dispatchEvent(new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true }));
    return dt.getData("text/plain");
  });
  const state = () => page.evaluate(() => ({ colsel: !!document.querySelector(".page-body.colsel"), sel: getSelection().toString() }));
  const page1 = () => page.evaluate(() => document.querySelectorAll("#pages .tpage")[0].querySelector(".page-body").textContent);

  console.log("1. down a box's right-hand cell");
  await drag([RIGHT[0], 0], [RIGHT[3], -1, "right"]);
  let s = await state();
  truthy("the column's selection stands", s.colsel);
  truthy("the selection holds the right-hand cells", RIGHT.every((t) => s.sel.includes(t)), JSON.stringify(s.sel));
  truthy("…and none of the left-hand cells", !["Ashdale", "TREFOIL", "MAYWOOD", "Pmt Date"].some((t) => s.sel.includes(t)), JSON.stringify(s.sel));
  await page.screenshot({ path: path.join(os.tmpdir(), "column-select-box.png") });
  const c1 = await copy();
  check("the copy is the column, a line a row, no rule line between", c1.split("\n").map((l) => l.trim()), RIGHT);
  truthy("…no name from the cell beside it, real or fake", !/Ashdale|Wrenfield|Corwin|Tobias/.test(c1));
  truthy("no flag pop-up over it", await page.evaluate(() => document.getElementById("flag-pop").hidden));
  const before = await page1();
  // A right press (the menu that copies it) keeps it.
  await pointOf(RIGHT[1], 0, "left", true);
  const rp = await pointOf(RIGHT[1], 3);
  await page.mouse.click(rp[0], rp[1], { button: "right" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  truthy("a right press keeps the column", (await state()).colsel);
  toasts.length = 0;
  await page.keyboard.press("Control+Shift+X");
  await page.waitForTimeout(150);
  check("a strike over it changes nothing", await page1(), before);
  await page.keyboard.press("Backspace");
  await page.keyboard.type("Z");
  await page.waitForTimeout(150);
  check("an edit over it changes nothing", await page1(), before);
  truthy("…and says why", toasts.some((t) => /one column/.test(t)), JSON.stringify(toasts));
  // A click lets the column go, and typing works again.
  await pointOf(LEFT[1], 0, "left", true);
  const p = await pointOf(LEFT[1], 4);
  await page.mouse.click(p[0], p[1]);
  await page.waitForTimeout(100);
  truthy("a click lets the column go", !(await state()).colsel);
  await page.keyboard.type("Q");
  await page.waitForTimeout(150);
  truthy("…and typing works again", (await page1()).includes("4445Q"), (await page1()).slice(0, 200));
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(150);

  console.log("2. Ctrl+A after a column's selection");
  await drag([RIGHT[0], 0], [RIGHT[2], -1, "right"]);
  truthy("a column's selection stands", (await state()).colsel);
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(100);
  s = await state();
  truthy("Ctrl+A lets it go and takes the left-hand cells too", !s.colsel && s.sel.includes("TREFOIL"), JSON.stringify(s));

  console.log("3. a page laid out in two columns with spaces");
  truthy("the page is cut into cells", await page.evaluate(() => document.querySelectorAll("#pages .tpage")[1].querySelectorAll(".page-body .cc").length >= 4));
  await page.mouse.click(5, 5);
  await drag([COLS[0][1], 0], [COLS[2][1], -1, "right"]);
  s = await state();
  const c3 = await copy();
  check("down the right-hand column: that column", c3.split("\n").map((l) => l.trim()), COLS.slice(0, 3).map((r) => r[1]));
  truthy("…painted alone", s.colsel && !s.sel.includes("Left"), JSON.stringify(s.sel));
  await page.screenshot({ path: path.join(os.tmpdir(), "column-select-cols.png") });
  await page.mouse.click(5, 5);
  await drag([COLS[0][0], 0], [COLS[2][0], -1, "right"]);
  s = await state();
  const c4 = await copy();
  check("down the left-hand column: that column", c4.split("\n").map((l) => l.trim()), COLS.slice(0, 3).map((r) => r[0]));
  truthy("…painted alone", s.colsel && !s.sel.includes("Right"), JSON.stringify(s.sel));
  await page.mouse.click(5, 5);
  await drag([COLS[1][0], 0], [COLS[1][1], -1, "right"]);
  s = await state();
  truthy("along one line: the browser's own selection, both columns", !s.colsel && s.sel.includes("Left column text two") && s.sel.includes("Right column beta"), JSON.stringify(s));

  console.log("4. side by side with its PDF");
  await page.mouse.click(5, 5);
  await page.evaluate(async ({ left, right, cols }) => {
    const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([612, 792]);
    p1.drawText("PERMIT NOTICE", { x: 72, y: 720, size: 11, font });
    left.forEach((t, k) => {
      const y = 696 - k * 16 - (k === 3 ? 6 : 0);
      p1.drawText(k === 0 ? "Corwin Ashdale" : t, { x: 76, y, size: 11, font });
      p1.drawText(right[k], { x: 260, y, size: 11, font });
    });
    for (const x of [72, 256, 440]) p1.drawLine({ start: { x, y: 708 }, end: { x, y: 630 }, thickness: 1 });
    p1.drawText("Changes to your business entity may require a new application.", { x: 72, y: 610, size: 11, font });
    const p2 = doc.addPage([612, 792]);
    p2.drawText("TWO COLUMNS", { x: 72, y: 720, size: 11, font });
    cols.forEach(([l, r], k) => { p2.drawText(l, { x: 72, y: 700 - k * 16, size: 11, font }); p2.drawText(r, { x: 300, y: 700 - k * 16, size: 11, font }); });
    await window.__textReaderPickPdfs([new File([await doc.save()], "Permit.pdf", { type: "application/pdf" })]);
  }, { left: LEFT, right: RIGHT, cols: COLS });
  const matched = await page.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body.fixed"), null, { timeout: 15000 }).then(() => true, () => false);
  if (!matched) console.log("  (no page matched its PDF here: side by side not checked)");
  else {
    await page.waitForTimeout(800);
    const sbs = await page.$("#sbs-toggle");
    if (sbs && !(await sbs.evaluate((b) => b.getAttribute("aria-pressed") === "true"))) await sbs.click();
    await page.waitForTimeout(2000);
    await page.mouse.click(5, 5);
    await drag([RIGHT[0], 0], [RIGHT[3], -1, "right"]);
    s = await state();
    const c5 = await copy();
    check("the box's right-hand cells alone", c5.split("\n").map((l) => l.trim()), RIGHT);
    truthy("…painted alone", s.colsel && !/TREFOIL|MAYWOOD|Pmt/.test(s.sel), JSON.stringify(s.sel));
    await page.screenshot({ path: path.join(os.tmpdir(), "column-select-sbs.png") });
  }

  check("no page errors", errors, []);
} finally {
  await browser.close();
  srv.stop();
}
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
