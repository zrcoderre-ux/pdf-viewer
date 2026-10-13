// Browser test for the review bars' Instance ‹ › (viewer/text-reader.js): the
// LEAKS bar stepping the row in front through every place its value stands
// (stepRowInstance), and the names bar stepping the name in front through its
// own places in the clear (stepNameInstance) — round at either end, the strong
// mark moving with them, Alt+, and Alt+. doing the same — while Row ‹ › and
// Name ‹ › still go from one value to the next.
//
// Run: node test-review-instances.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium),
// python3 with openpyxl (to build the key and the worksheet) and a free port
// in 8130-8199 for python3's http.server; exits 0 with SKIP where any is
// missing. The case folder is an OPFS directory, as in test-folder-save.mjs.
// Every name in it is invented.

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
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "review-instances-")), name);
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
  [
    ["person", "Corwin Ashdale", "Tobias Wrenfield", "", "", "spreadsheet", 3],
    ["entity", "Pellmont Motors", "Quarrow Motors", "", "", "spreadsheet", 2],
  ]);
// One row, for a value the key does not bind, standing three times: once on
// page 1 and twice on page 2, where the row puts it.
const LEAKS_BYTES = buildXlsx("LEAKS.xlsx", "LEAKS",
  ["Value", "Fix? (yes/no)", "Context", "File", "Type", "Where (page:line)", "Notes"],
  [["Gravenor", "", "Gravenor signed.", "A Complaint.pdf", "LEAK", "p.2", ""]]);

// The names the run left in the clear, two of them, between each other:
// Corwin, Pellmont, Corwin | Pellmont, Corwin.
const CASE = "Case Instances";
const A = [
  "====== Page 1 ======",
  "Corwin Ashdale met Pellmont Motors about the vehicle.",
  "Gravenor was there.",
  "Corwin Ashdale paid for it.",
  "====== Page 2 ======",
  "Pellmont Motors refused to take it back.",
  "Gravenor signed the notice, and Gravenor kept a copy.",
  "Corwin Ashdale sued.",
].join("\n") + "\n";

// ── the browser ─────────────────────────────────────────────────────────────
let srv = null, browser = null;
async function newReader() {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto(srv.base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
  await page.evaluate(async ({ CASE, A, keyBytes, leaksBytes }) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(CASE, { create: true });
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    await put(dir, "LEAKS.xlsx", new Uint8Array(leaksBytes));
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    await put(text, "A Complaint.txt", A);
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, A, keyBytes: Array.from(KEY_BYTES), leaksBytes: Array.from(LEAKS_BYTES) });
  await page.evaluate((n) => window.__textReaderOpenDoc(n), "A Complaint.txt");
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.waitForFunction(() => /standing unfaked/.test(document.getElementById("st-leaks").textContent), null, { timeout: 8000 });
  await page.waitForTimeout(500);
  return { context, page, errors };
}
/** The strong mark: its text and the index of the page it stands on. */
const here = (page) => page.evaluate(() => {
  const h = CSS.highlights.get("leakrow-here");
  const r = h && [...h][0];
  if (!r) return null;
  const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
  return { text: r.toString(), page: Number(el.closest(".tpage").dataset.index), line: el.closest(".line") ? el.closest(".line").textContent.trim() : "" };
});
const txt = (page, id) => page.evaluate((id) => document.getElementById(id).textContent, id);
const off = (page, id) => page.evaluate((id) => document.getElementById(id).disabled, id);
async function click(page, id) { await page.evaluate((id) => document.getElementById(id).click(), id); await page.waitForTimeout(250); }
async function press(page, keys) {
  await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
  await page.keyboard.press(keys);
  await page.waitForTimeout(250);
}

async function run() {
  srv = await startServer();
  browser = await chromium.launch({ executablePath: CHROME });
  try {
    // ── the LEAKS row, instance by instance ───────────────────────────────
    console.log("1. the LEAKS bar steps the row's value through where it stands");
    {
      const r = await newReader();
      const p = r.page;
      await p.evaluate(() => window.__textReaderGoToLeak(0));
      await p.waitForFunction(() => /instance \d/.test(document.getElementById("lb-inst").textContent), null, { timeout: 8000 });
      check("the row opens at the instance its Where names, the first on page 2", await txt(p, "lb-inst"), "· instance 2 of 3 · Page 2");
      check("…marked there", await here(p), { text: "Gravenor", page: 1, line: "Gravenor signed the notice, and Gravenor kept a copy." });
      check("…the instance arrows offered", [await off(p, "lb-inst-prev"), await off(p, "lb-inst-next")], [false, false]);
      const where = await p.evaluate(() => {
        const r = [...CSS.highlights.get("leakrow-here")][0];
        return r.startOffset;
      });
      await click(p, "lb-inst-next");
      check("› goes to the next place it stands", await txt(p, "lb-inst"), "· instance 3 of 3 · Page 2");
      const next = await here(p);
      const at2 = await p.evaluate(() => [...CSS.highlights.get("leakrow-here")][0].startOffset);
      check("…the second on the same line, the mark with it", [next.page, next.text, at2 > where], [1, "Gravenor", true]);
      await click(p, "lb-inst-next");
      check("…and round to the first after the last", await txt(p, "lb-inst"), "· instance 1 of 3 · Page 1");
      check("…on page 1", (await here(p)).page, 0);
      await click(p, "lb-inst-prev");
      check("‹ goes back round to the last", await txt(p, "lb-inst"), "· instance 3 of 3 · Page 2");
      await press(p, "Alt+Comma");
      check("Alt+, steps back too", await txt(p, "lb-inst"), "· instance 2 of 3 · Page 2");
      await press(p, "Alt+Period");
      check("…and Alt+. forward", await txt(p, "lb-inst"), "· instance 3 of 3 · Page 2");
      check("the row stays the row", await p.evaluate(() => window.__textReaderLeaks().at), 0);
      check("…and its Fix? cell untouched", await p.evaluate(() => window.__textReaderLeaks().rows[0].fix), "");
      // A decision made standing on another instance is the row's decision:
      // the same cell, whichever place the text is at.
      await p.evaluate(() => window.__textReaderDecide("no", false));
      await p.waitForTimeout(300);
      check("a decision on another instance answers the row", await p.evaluate(() => window.__textReaderLeaks().rows[0].fix), "no");
      check("…and the bar still says where it is", await txt(p, "lb-inst"), "· instance 3 of 3 · Page 2");
      check("no errors", r.errors, []);
      await r.context.close();
    }

    // ── the names bar, instance by instance ───────────────────────────────
    console.log("2. the names bar steps the name in front through its own places");
    {
      const r = await newReader();
      const p = r.page;
      // The worksheet's bar out of the way: the names walk alone.
      await p.evaluate(() => { const b = document.getElementById("lb-close"); if (!document.getElementById("leaks-bar").hidden) b.click(); });
      await p.evaluate(() => document.getElementById("st-leaks").click());
      await p.waitForFunction(() => !document.getElementById("names-bar").hidden && /of/.test(document.getElementById("nb-count").textContent), null, { timeout: 8000 });
      await p.waitForTimeout(300);
      check("the walk opens on the first name", [await txt(p, "nb-value"), await txt(p, "nb-count"), await txt(p, "nb-inst")], ["Corwin Ashdale", "1 of 5", "· instance 1 of 3"]);
      await click(p, "nb-next");
      check("Name › goes to the next name down the page, whichever it is", [await txt(p, "nb-value"), await txt(p, "nb-count"), await txt(p, "nb-inst")], ["Pellmont Motors", "2 of 5", "· instance 1 of 2"]);
      await click(p, "nb-prev");
      await click(p, "nb-inst-next");
      check("Instance › goes to the same name where it next stands, past the other", [await txt(p, "nb-value"), await txt(p, "nb-count"), await txt(p, "nb-inst")], ["Corwin Ashdale", "3 of 5", "· instance 2 of 3"]);
      check("…the mark with it", await here(p), { text: "Corwin Ashdale", page: 0, line: "Corwin Ashdale paid for it." });
      await click(p, "nb-inst-next");
      check("…on to page 2", [await txt(p, "nb-count"), await txt(p, "nb-inst"), (await here(p)).page], ["5 of 5", "· instance 3 of 3", 1]);
      await click(p, "nb-inst-next");
      check("…and round to the first after the last, staying in the document", [await txt(p, "nb-count"), await txt(p, "nb-inst")], ["1 of 5", "· instance 1 of 3"]);
      await click(p, "nb-inst-prev");
      check("Instance ‹ goes back round to the last", [await txt(p, "nb-count"), await txt(p, "nb-inst")], ["5 of 5", "· instance 3 of 3"]);
      await press(p, "Alt+Comma");
      check("Alt+, steps the names bar's name back", [await txt(p, "nb-count"), await txt(p, "nb-inst")], ["3 of 5", "· instance 2 of 3"]);
      await press(p, "Alt+Period");
      check("…and Alt+. forward", [await txt(p, "nb-count"), await txt(p, "nb-inst")], ["5 of 5", "· instance 3 of 3"]);
      // The walk stands where Instance left it: Name ‹ goes on from there.
      await click(p, "nb-prev");
      check("Name ‹ goes on from where Instance left the walk", [await txt(p, "nb-value"), await txt(p, "nb-count")], ["Pellmont Motors", "4 of 5"]);
      await click(p, "nb-inst-prev");
      check("…and Pellmont Motors steps through its own two", [await txt(p, "nb-count"), await txt(p, "nb-inst")], ["2 of 5", "· instance 1 of 2"]);
      check("no errors", r.errors, []);
      await r.context.close();
    }

    // ── both bars up: the keys follow the mark ───────────────────────────
    console.log("3. with both bars up, Alt+, and Alt+. step whichever walk put the mark there");
    {
      const r = await newReader();
      const p = r.page;
      await p.evaluate(() => window.__textReaderGoToLeak(0));
      await p.waitForFunction(() => /instance \d/.test(document.getElementById("lb-inst").textContent), null, { timeout: 8000 });
      await p.evaluate(() => document.getElementById("st-leaks").click());
      await p.waitForFunction(() => !document.getElementById("names-bar").hidden && /of/.test(document.getElementById("nb-count").textContent), null, { timeout: 8000 });
      await p.waitForTimeout(300);
      check("the names walk has the mark", (await here(p)).text, "Corwin Ashdale");
      await press(p, "Alt+Period");
      check("…so Alt+. steps its name", [await txt(p, "nb-inst"), (await here(p)).text], ["· instance 2 of 3", "Corwin Ashdale"]);
      check("…and the row's instance is where it was", await txt(p, "lb-inst"), "· instance 2 of 3 · Page 2");
      await click(p, "lb-inst-next");
      check("the row's › takes the mark back to the row's value", [await txt(p, "lb-inst"), (await here(p)).text], ["· instance 3 of 3 · Page 2", "Gravenor"]);
      await press(p, "Alt+Period");
      check("…and then Alt+. steps the row's", [await txt(p, "lb-inst"), (await here(p)).text], ["· instance 1 of 3 · Page 1", "Gravenor"]);
      check("no errors", r.errors, []);
      await r.context.close();
    }
  } finally {
    await browser.close();
    srv.stop();
  }
  console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
  process.exit(fails ? 1 : 0);
}
run().catch((e) => { console.error(e); if (browser) browser.close(); if (srv) srv.stop(); process.exit(1); });
