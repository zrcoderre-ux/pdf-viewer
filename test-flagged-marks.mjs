// Browser test for a value flagged already (text-reader.js markFlagNow,
// unmarkFlagNow, flaggedAt). The owner: "when a value has already been
// flagged, it should be highlighted so I don't attempt to reflag it." A flag
// marks every place the value stands red at once, without waiting for the
// document-wide pass; a selection of a flagged value is told so in the pop-up
// and not flagged again by 🚩's release; and a flag withdrawn takes its marks
// down at once.
//
// Run: node test-flagged-marks.mjs   (from the repo root)
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
function buildKey(rows) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "flagged-marks-")), "pseudonym_key.xlsx");
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

// ── the document ─────────────────────────────────────────────────────────────
const KEY_BYTES = buildKey([["person", "Orla Vantreese", "Mira Holt", "", "", "spreadsheet", 1]]);
const CASE = "Case Flagged Marks";
const A = "====== Page 1 ======\nThe tenant Mira Holt signed. Rosa Quillfeather witnessed it.\nLater Rosa Quillfeather called the landlord.\nRosa Quillfeather paid the rent.\n";

let srv = null, browser = null;
async function newReader() {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
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
    await put(text, "A Note.txt", A);
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, A, keyBytes: Array.from(KEY_BYTES) });
  await page.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event("change")); } });
  await page.evaluate(() => window.__textReaderOpenDoc("A Note.txt"));
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body .pn").length > 0);
  await page.waitForTimeout(800);
  return { context, page, log, close: () => context.close() };
}
// Select `word` (the n-th time it stands on the page), from `from` letters in, `len` long.
const select = (p, n, from, len) => p.evaluate(({ n, from, len }) => {
  const walker = document.createTreeWalker(document.querySelector("#pages .page-body"), NodeFilter.SHOW_TEXT);
  let k = 0;
  for (let t; (t = walker.nextNode());) {
    let at = -1;
    while ((at = t.data.indexOf("Rosa Quillfeather", at + 1)) >= 0) {
      if (k++ !== n) continue;
      const r = document.createRange();
      r.setStart(t, at + from);
      r.setEnd(t, at + from + len);
      const s = document.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return true;
    }
  }
  return false;
}, { n, from, len });
const marks = (p) => p.evaluate(() => { const h = CSS.highlights.get("flagged"); return h ? [...h].map((r) => r.toString()) : []; });
const pop = (p) => p.evaluate(() => ({
  shown: !document.getElementById("flag-pop").hidden,
  disabled: document.getElementById("flag-pop-btn").disabled,
  note: document.getElementById("flag-pop-note").textContent,
}));
const flaggedList = (p) => p.evaluate(() => [...document.querySelectorAll("#flags-list li .fv")].map((x) => x.textContent));

async function run() {
  srv = await startServer();
  browser = await launchBrowser(chromium, CHROME);
  try {
    const r = await newReader();
    const p = r.page;
    console.log("1. a flag marks every place the value stands, at once");
    check("nothing flagged yet", await marks(p), []);
    truthy("selected", await select(p, 0, 0, 17));
    await p.waitForTimeout(300);
    check("the pop-up offers the flag", (await pop(p)).disabled, false);
    // Read in the same task as the click: before the document-wide pass can run.
    const now = await p.evaluate(() => {
      document.getElementById("flag-pop-btn").click();
      const h = CSS.highlights.get("flagged");
      return h ? [...h].map((r) => r.toString()) : [];
    });
    check("red at once, all three places", now, ["Rosa Quillfeather", "Rosa Quillfeather", "Rosa Quillfeather"]);
    await p.waitForTimeout(800);
    check("…and still, once the pass has read the page", await marks(p), ["Rosa Quillfeather", "Rosa Quillfeather", "Rosa Quillfeather"]);

    console.log("2. selected again, it is said to be flagged already");
    await select(p, 2, 0, 17);
    await p.waitForTimeout(300);
    const p2 = await pop(p);
    check("the pop-up up, its Flag off", [p2.shown, p2.disabled], [true, true]);
    truthy("…saying so: " + p2.note, /flagged already/.test(p2.note));
    await select(p, 1, 0, 4);
    await p.waitForTimeout(300);
    const p3 = await pop(p);
    check("a word of it: asked, the Flag still there", [p3.shown, p3.disabled], [true, false]);
    truthy("…saying what it is part of: " + p3.note, /Part of “Rosa Quillfeather”, flagged already/.test(p3.note));

    console.log("3. with 🚩 on, a release over a flagged value flags nothing again");
    await p.evaluate(() => { document.getSelection().removeAllRanges(); document.getElementById("flag-btn").click(); });
    await p.waitForTimeout(200);
    const before = await p.evaluate(() => document.querySelectorAll("#flags-list li").length);
    // A double-click on "Rosa" in the second line.
    const box = await p.evaluate(() => {
      const walker = document.createTreeWalker(document.querySelector("#pages .page-body"), NodeFilter.SHOW_TEXT);
      let k = 0;
      for (let t; (t = walker.nextNode());) {
        let at = -1;
        while ((at = t.data.indexOf("Rosa Quillfeather", at + 1)) >= 0) {
          if (k++ !== 1) continue;
          const r = document.createRange(); r.setStart(t, at); r.setEnd(t, at + 4);
          const b = r.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }
      }
      return null;
    });
    await p.mouse.dblclick(box.x, box.y);
    await p.waitForTimeout(500);
    check("the list unchanged", await p.evaluate(() => document.querySelectorAll("#flags-list li").length), before);
    const p4 = await pop(p);
    check("…the selection left with the pop-up asking", [p4.shown, /flagged already/.test(p4.note)], [true, true]);
    await p.evaluate(() => { document.getSelection().removeAllRanges(); document.getElementById("flag-btn").click(); });

    console.log("4. withdrawn, its marks come down at once");
    const gone = await p.evaluate(() => {
      document.querySelector("#flags-list li .x").click();
      const h = CSS.highlights.get("flagged");
      return h ? h.size : 0;
    });
    check("no red mark left", gone, 0);
    await p.waitForTimeout(800);
    check("…nor after the pass", await marks(p), []);
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
