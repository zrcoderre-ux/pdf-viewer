// Browser test for deleting a selection across lines on pleading paper
// (viewer/text-reader.js: deleteAcrossLines): Backspace, Delete, a cut,
// typing and a paste over a selection that runs across margin numbers take
// the selected text and join what is left, as an editor does, and never a
// number; Ctrl+Z takes it back in one step. The owner: "It should let me
// backspace over multiple lines on pleding paper, it just shouldnt delete the
// number margins".
//
// Run: node test-select-across-lines.mjs   (from the repo root)
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
// On disk the exports carry the FAKES; the key turns them back on screen.
// "Ashdale" is bound on its own, so a name typed as "Ashdale" is offered.
function buildKey(rows, pinned = []) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "select-lines-")), "pseudonym_key.xlsx");
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

/** A selection on page 1 from just before `a` on line `ka` to just before `b` on line `kb` ("" = the line's end). */
const selectFrom = (page, ka, a, kb, b) => page.evaluate(({ ka, a, kb, b }) => {
  const body = document.querySelector("#pages .tpage .page-body");
  const pt = (k, what) => {
    const lt = body.querySelectorAll(":scope > .line")[k].querySelector(".lt");
    const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
    let n, last = null;
    while ((n = w.nextNode())) { last = n; if (what) { const at = n.data.indexOf(what); if (at >= 0) return [n, at]; } }
    return last ? [last, last.data.length] : [lt, lt.childNodes.length];
  };
  const r = document.createRange();
  r.setStart(...pt(ka, a)); r.setEnd(...pt(kb, b));
  const s = getSelection(); s.removeAllRanges(); s.addRange(r); body.focus();
  return s.toString();
}, { ka, a, kb, b });
const numbers = (page) => page.evaluate(() => [...document.querySelector("#pages .tpage .page-body").querySelectorAll(":scope > .line.num .gn")].map((g) => g.textContent.trim()));

async function run() {
  srv = await startServer();
  browser = await launchBrowser(chromium, CHROME);
  try {
    console.log("1. Backspace over a selection from line 1 into line 4");
    {
      const r = await newReader();
      const p = r.page;
      check("as the file has it", await slots(p), START);
      await selectFrom(p, 0, "pha", 3, "lta");
      await p.keyboard.press("Backspace");
      check("the selected text gone, line 4's rest joined to line 1, every number kept", await slots(p), [["1", "Allta"], ["2", ""], ["3", ""], ["4", ""], ["5", ""], ["6", ""]]);
      check("no number lost", await numbers(p), ["1", "2", "3", "4", "5", "6"]);
      truthy("…and nothing refused", !(await p.evaluate(() => document.body.textContent.includes("line numbers are fixed"))));
      await p.keyboard.type("X");
      check("the caret where the join is", (await slots(p))[0], ["1", "AlXlta"]);
      await p.keyboard.press("Control+z");
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(200);
      check("Ctrl+Z: as it was", await slots(p), START);
      await p.keyboard.press("Control+s");
      await p.waitForTimeout(1200);
      check("the file as it was", await file(p), A);

      console.log("2. Delete over the line break: the end of 1 to the head of 2");
      await selectFrom(p, 0, "", 1, "Beta");
      await p.keyboard.press("Delete");
      check("2 joined to 1, its number stays", await slots(p), [["1", "AlphaBeta"], ["2", ""], ["3", ""], ["4", "Delta"], ["5", ""], ["6", ""]]);
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(200);

      console.log("3. typing over a selection across lines");
      await selectFrom(p, 0, "pha", 1, "ta");
      await p.keyboard.type("Z");
      check("the selection replaced, the lines joined", await slots(p), [["1", "AlZta"], ["2", ""], ["3", ""], ["4", "Delta"], ["5", ""], ["6", ""]]);
      await p.keyboard.press("Control+s");
      await p.waitForTimeout(1200);
      truthy("saved with every number: " + JSON.stringify((await file(p)).split("\n").slice(0, 7)), (await file(p)).startsWith("====== Page 1 ======\n 1  AlZta\n 2\n 3\n 4"));
      for (let k = 0; k < 3; k++) await p.keyboard.press("Control+z");
      await p.waitForTimeout(200);
      check("Ctrl+Z: as it was", await slots(p), START);

      console.log("4. a cut and a paste across lines");
      await selectFrom(p, 1, "eta", 3, "elta");
      await p.evaluate(() => document.execCommand("cut"));
      await p.waitForTimeout(200);
      check("cut: 2's rest and 4's joined, 3 and 4 empty", await slots(p), [["1", "Alpha"], ["2", "Belta"], ["3", ""], ["4", ""], ["5", ""], ["6", ""]]);
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(200);
      check("Ctrl+Z: as it was", await slots(p), START);
      await selectFrom(p, 0, "lpha", 1, "eta");
      await p.evaluate(() => {
        const dt = new DataTransfer(); dt.setData("text/plain", "QQ");
        document.querySelector("#pages .tpage .page-body").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      });
      await p.waitForTimeout(300);
      check("paste: the selection replaced", (await slots(p)).slice(0, 2), [["1", "AQQeta"], ["2", ""]]);
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(200);
      check("Ctrl+Z once: as it was", await slots(p), START);

      console.log("5. lines selected with the keyboard (Shift+Down, Shift+End) from the head of 2, Backspace");
      await caretIn(p, 1);
      await p.keyboard.press("Shift+ArrowDown");
      await p.keyboard.press("Shift+ArrowDown");
      await p.keyboard.press("Shift+End");
      console.log("        selected: " + JSON.stringify(await p.evaluate(() => getSelection().toString())));
      await p.keyboard.press("Backspace");
      check("2's to 4's text gone, the numbers stay", await slots(p), [["1", "Alpha"], ["2", ""], ["3", ""], ["4", ""], ["5", ""], ["6", ""]]);
      console.log("6. a drag from line 1's number to the head of line 4, Delete");
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(200);
      const box = async (k, sel) => p.evaluate(({ k, sel }) => { const r = document.querySelectorAll("#pages .tpage .page-body > .line")[k].querySelector(sel).getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; }, { k, sel });
      const g = await box(0, ".gutter"), t = await box(3, ".lt");
      await p.mouse.move(g.x + 2, g.y);
      await p.mouse.down();
      await p.mouse.move(t.x + 1, t.y, { steps: 8 });
      await p.mouse.up();
      console.log("        selected: " + JSON.stringify(await p.evaluate(() => getSelection().toString())));
      await p.keyboard.press("Delete");
      const after = await slots(p);
      check("the numbers all stay", after.filter(([n]) => n !== "·").map(([n]) => n), ["1", "2", "3", "4", "5", "6"]);
      truthy("line 4's text joined up to line 1: " + JSON.stringify(after), /Delta$/.test(after[0][1]) && !after.slice(1).some(([, x]) => /Alpha|Beta/.test(x)));
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
