// Browser test for Tab in the text reader (viewer/text-reader.js, "Tab
// indents"): Tab puts in spaces to the next stop of four, Shift+Tab takes them
// back, a selection over several lines is indented line by line, the ⇄ Raw
// sheet takes Tab the same way, the focus stays on the page, Ctrl+Z takes the
// indent back, and the save writes the spaces.
//
// Run: node test-tab-indent.mjs   (from the repo root)
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
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tab-indent-")), "pseudonym_key.xlsx");
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

const ltText = (page, i, k) => page.evaluate(({ i, k }) => document.querySelectorAll("#pages .tpage")[i].querySelectorAll(".page-body > .line")[k].querySelector(".lt").textContent, { i, k });
const caretAt = (page, i, k, offset) => page.evaluate(({ i, k, offset }) => {
  const body = document.querySelectorAll("#pages .tpage")[i].querySelector(".page-body");
  const lt = body.querySelectorAll(":scope > .line")[k].querySelector(".lt");
  const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
  let n, at = 0;
  while ((n = w.nextNode())) { if (offset <= at + n.data.length) { const r = document.createRange(); r.setStart(n, offset - at); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); body.focus(); return true; } at += n.data.length; }
  return false;
}, { i, k, offset });

async function run() {
  srv = await startServer();
  browser = await chromium.launch({ executablePath: CHROME });
  try {
    const r = await newReader();
    const p = r.page;
    console.log("1. Tab and Shift+Tab at the caret");
    await caretAt(p, 0, 3, 0);
    await p.keyboard.press("Tab");
    check("Tab at a line's start: four spaces", await ltText(p, 0, 3), "    End.");
    check("…and the focus stays on the page", await p.evaluate(() => !!document.activeElement.closest(".page-body")), true);
    await caretAt(p, 0, 3, 8);
    await p.keyboard.press("Tab");
    check("Tab after eight characters: to the next stop (twelve)", await ltText(p, 0, 3), "    End.    ");
    await caretAt(p, 0, 3, 6);
    await p.keyboard.press("Tab");
    check("Tab mid-word at six: two spaces, to eight", await ltText(p, 0, 3), "    En  d.    ");
    await caretAt(p, 0, 3, 4);
    await p.keyboard.press("Shift+Tab");
    check("Shift+Tab after an indent of four: taken back", await ltText(p, 0, 3), "En  d.    ");
    await p.keyboard.press("Shift+Tab");
    check("Shift+Tab with no spaces before the caret: nothing", await ltText(p, 0, 3), "En  d.    ");
    console.log("2. a selection over several lines");
    await p.evaluate(() => {
      const body = document.querySelector("#pages .tpage .page-body");
      const lts = body.querySelectorAll(":scope > .line > .lt");
      const first = (lt) => { const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT); return w.nextNode(); };
      const r = document.createRange(); r.setStart(first(lts[0]), 2); r.setEnd(first(lts[1]), 2);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r); body.focus();
    });
    await p.keyboard.press("Tab");
    check("each line selected indented at its start", [(await ltText(p, 0, 0)).slice(0, 15), (await ltText(p, 0, 1)).slice(0, 8)], ["    DECLARATION", "    Name"]);
    check("…the line after them untouched", (await ltText(p, 0, 2)).slice(0, 4), "Corw");
    console.log("3. Ctrl+Z, and the save");
    await p.keyboard.press("Control+z");
    await p.waitForTimeout(200);
    check("Ctrl+Z takes the indent of both lines back, one step", [(await ltText(p, 0, 0)).slice(0, 11), (await ltText(p, 0, 1)).slice(0, 4)], ["DECLARATION", "Name"]);
    check("…and only that step", await ltText(p, 0, 3), "En  d.    ");
    await p.keyboard.press("Control+s");
    await p.waitForTimeout(1500);
    const file = await p.evaluate(async () => (await (await (await window.__case.getDirectoryHandle("Text Files")).getFileHandle("A Decl.txt")).getFile()).text());
    truthy("the save writes the spaces", file.includes(" 4  En  d.    \n"));
    console.log("4. in the ⇄ Raw sheet");
    await p.evaluate(() => document.querySelectorAll("#pages .tpage")[1].querySelector(".page-label .raw-page").click());
    await p.waitForTimeout(200);
    await p.evaluate(() => {
      const pre = document.querySelectorAll("#pages .tpage")[1].querySelector(".raw-text");
      pre.focus();
      const w = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
      let n; while ((n = w.nextNode())) { const at = n.data.indexOf(" 2  Other"); if (at >= 0) { const r = document.createRange(); r.setStart(n, at + 4); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return; } }
    });
    await p.keyboard.press("Tab");
    await p.evaluate(() => document.activeElement.blur());
    await p.evaluate(() => document.querySelectorAll("#pages .tpage")[1].querySelector(".page-label .raw-page").click()); // back to the page
    await p.waitForTimeout(500);
    const xs = () => p.evaluate(() => {
      const lts = document.querySelectorAll("#pages .tpage")[1].querySelectorAll(".page-body > .line > .lt");
      const x = (lt) => { const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const at = n.data.search(/\S/); if (at >= 0) { const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + 1); return r.getBoundingClientRect().left; } } return NaN; };
      return [x(lts[0]), x(lts[1])];
    });
    const [name, other] = await xs();
    truthy(`Tab in the raw sheet: the line indented on the page (Name ${name.toFixed(1)}, Other ${other.toFixed(1)})`, other - name > 8);
    console.log("5. Shift+Tab takes back an indent the file wrote after a margin number");
    await caretAt(p, 1, 1, 0);
    await p.keyboard.press("Shift+Tab");
    await p.waitForTimeout(600);
    const [name2, other2] = await xs();
    truthy(`…back level with the line above (Name ${name2.toFixed(1)}, Other ${other2.toFixed(1)})`, Math.abs(other2 - name2) < 1);
    await p.keyboard.press("Control+z");
    await p.waitForTimeout(600);
    const [, other3] = await xs();
    truthy("…and Ctrl+Z puts it back", Math.abs(other3 - other) < 1);
    check("no page errors", r.log.errors, []);
    await r.close();
  } finally {
    await browser.close();
    srv.stop();
  }
  console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
  process.exit(fails ? 1 : 0);
}
await run();
