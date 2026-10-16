// Browser test for one pitch down the margin off the grid (viewer/text-reader.js:
// slotLines, slotRows; text-reader.css `[data-slot]`): a line between two
// margin numbers is kept, and every number of every numbered page stands the
// same distance from the next, as a normal page and as a ✓ Use my text page;
// taking the in-between line out brings every gap back to one row.
//
// Run: node test-margin-pitch.mjs   (from the repo root)
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
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "margin-pitch-")), "pseudonym_key.xlsx");
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

const CASE = "Case Pitch";
const L = ["====== Page 1 ======"];
const P1 = { 1: "DECLARATION OF TOBIAS WRENFIELD", 3: "I, Tobias Wrenfield, declare:", 5: "1. A line.", 6: "2. A caption line", 8: "Signed." };
for (let n = 1; n <= 10; n++) { L.push(String(n).padStart(2) + (P1[n] ? "  " + P1[n] : "")); if (n === 6) L.push("    its second line, between the numbers"); }
L.push("Footer text after the numbers");
L.push("====== Page 2 ======");
for (let n = 1; n <= 6; n++) L.push(String(n).padStart(2) + (n === 2 ? "  Plain." : ""));
// …and a box drawn down numbered lines: its bars must still meet.
L.push("====== Page 3 ======", " 1  Box:", " 2  \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2510", " 3  \u2502 Fact \u2502 Okay \u2502", " 4  \u2502 Two  \u2502 Yes  \u2502", " 5  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2518", " 6  After.");
const A = L.join("\n") + "\n";

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
  await page.evaluate(async ({ CASE, A, keyBytes }) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(CASE, { create: true });
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    await put(text, "A Decl.txt", A);
    window.__case = dir;
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, A, keyBytes: Array.from(KEY_BYTES) });
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
  };
}, i);
const pageText = (page, i) => page.evaluate((i) => [...document.querySelectorAll("#pages .tpage")[i].querySelectorAll(".page-body .line")]
  .map((l) => l.textContent).join("\n"), i);
const fixClick = (page, i) => page.evaluate((i) => document.querySelectorAll("#pages .tpage")[i].querySelector(".page-label .fix-page").click(), i);

async function run() {
  srv = await startServer();
  browser = await chromium.launch({ executablePath: CHROME });
  try {
    const gaps = (p) => p.evaluate(() => [...document.querySelectorAll("#pages .tpage")].map((sec) => {
      const tops = [...sec.querySelectorAll(".page-body > .line.num .gutter")].map((g) => g.getBoundingClientRect().top);
      return tops.slice(1).map((t, k) => Math.round(t - tops[k]));
    }));
    const lh = (p) => p.evaluate(() => {
      const l = document.querySelector("#pages .page-body > .line.num");
      return Math.round(parseFloat(getComputedStyle(l).fontSize) * parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--reader-lh") || getComputedStyle(l).getPropertyValue("--reader-lh")));
    });
    const even = (g) => { const all = g.flat(); return all.length > 0 && all.every((x) => Math.abs(x - all[0]) <= 1) ? all[0] : JSON.stringify(g); };
    console.log("1. a line between two numbers: every gap the same, on both pages");
    {
      const r = await newReader();
      const p = r.page;
      const row = await lh(p);
      const g = await gaps(p);
      const one = even(g);
      truthy(`every gap the same (${JSON.stringify(g)})`, typeof one === "number");
      truthy(`…two rows apart (row ${row}, gap ${one})`, typeof one === "number" && Math.abs(one - 2 * row) <= 2);
      const bars = await p.evaluate(() => {
        const sec = document.querySelectorAll("#pages .tpage")[2];
        const rows = [...sec.querySelectorAll(".page-body > .line.rl")];
        const out = [];
        for (let k = 1; k < rows.length; k++) {
          const a = rows[k - 1].getBoundingClientRect(), b = rows[k].getBoundingClientRect();
          out.push(Math.round(b.top - a.bottom));
        }
        return { n: rows.length, gaps: out };
      });
      check("the box is drawn, its rows touching (no gap for its bars to break at)", bars, { n: 4, gaps: [0, 0, 0] });
      truthy("the line between the numbers is kept", (await p.evaluate(() => document.querySelector("#pages .page-body").textContent)).includes("its second line, between the numbers"));
      console.log("2. …and as a ✓ Use my text page");
      await fixClick(p, 0);
      await p.waitForTimeout(800);
      const g2 = await gaps(p);
      truthy(`every gap the same on the free page and the other (${JSON.stringify(g2)})`, typeof even(g2) === "number");
      console.log("3. the in-between line taken out: one row again, everywhere");
      // Through the file's own text (⇄ Raw): the line taken out there.
      await p.evaluate(() => document.querySelector("#pages .tpage .page-label .raw-page").click());
      await p.waitForTimeout(200);
      await p.evaluate(() => {
        const pre = document.querySelector("#pages .tpage .raw-sheet .raw-text");
        pre.focus();
        const w = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
        let n; while ((n = w.nextNode())) { const k = n.data.indexOf("\n    its second line"); if (k >= 0) { const r = document.createRange(); r.setStart(n, k); r.setEnd(n, n.data.indexOf("\n", k + 1)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); break; } }
      });
      await p.keyboard.press("Delete");
      await p.evaluate(() => document.querySelector("#pages .tpage .page-label .raw-page").click());
      await p.waitForTimeout(900);
      check("the line is gone", await p.evaluate(() => [...document.querySelectorAll("#pages .page-body")[0].querySelectorAll(":scope > .line")].slice(5, 7).map((l) => l.textContent)), [" 6  2. A caption line", " 7"]);
      const g3 = await gaps(p);
      const three = even(g3);
      truthy(`every gap one row (${JSON.stringify(g3)}, row ${row})`, typeof three === "number" && Math.abs(three - row) <= 2);
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
