// Browser test for side by side across the reel's seams (viewer/text-reader.js:
// matchReelGaps, syncScroll): with ↕ Read folder on, each text page stays level
// with its PDF page, top to top, scrolled down the folder and back up, at any
// window width — the divider hung between two documents has its gap in the
// pane too. Before the fix every page under a divider stood its height lower
// than its PDF page and the columns slid apart across each seam.
//
// Run: node test-reel-sync.mjs   (from the repo root)
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
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "reel-sync-")), "pseudonym_key.xlsx");
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

const CASE = "Case Reel";
const A = ["====== Page 1 ======"].concat(Array.from({ length: 28 }, (_, k) => String(k + 1).padStart(2) + "  Page one line " + (k + 1)))
  .concat(["====== Page 2 ======"], Array.from({ length: 28 }, (_, k) => String(k + 1).padStart(2) + "  Page two line " + (k + 1)))
  .concat(["====== Page 3 ======"], Array.from({ length: 28 }, (_, k) => String(k + 1).padStart(2) + "  Page three line " + (k + 1))).join("\n") + "\n";
const B = Array.from({ length: 6 }, (_, k) => `====== Page ${k + 1} ======\n` + Array.from({ length: 40 }, (_, j) => `Brief page ${k + 1}, line ${j + 1}.`).join("\n")).join("\n") + "\n";
const C = [
  "====== Page 1 ======",
  "Name                    Amount           Date",
  "Tobias Wrenfield        $1,200           May 4",
  "Other                   $5               June 1",
].join("\n") + "\n";

async function run() {
  const srv = await startServer();
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const p = await context.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
    p.on("dialog", (d) => d.accept().catch(() => {}));
    await p.goto(srv.base + "/viewer/text-reader.html");
    await p.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
    await p.evaluate(async ({ CASE, A, B, C, keyBytes }) => {
      const top = await navigator.storage.getDirectory();
      try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
      const dir = await top.getDirectoryHandle(CASE, { create: true });
      const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
      await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
      const text = await dir.getDirectoryHandle("Text Files", { create: true });
      await put(text, "A Decl.txt", A);
      await put(text, "B Brief.txt", B);
      await put(text, "C Form.txt", C);
      const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
      const mk = async (name, pages, fn) => {
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.TimesRoman);
        for (let k = 0; k < pages; k++) fn(pdf.addPage([612, 792]), font, k);
        await put(dir, name, await pdf.save());
      };
      await mk("A Decl.pdf", 3, (pg, font, k) => {
        for (let n = 1; n <= 28; n++) {
          const y = 792 - (100 + (n - 1) * 24);
          pg.drawText(String(n), { x: 46 - font.widthOfTextAtSize(String(n), 12), y, size: 12, font });
          pg.drawText(`Page ${["one", "two", "three"][k]} line ${n}`, { x: 72, y, size: 12, font });
        }
      });
      await mk("B Brief.pdf", 6, (pg, font, k) => { for (let j = 0; j < 40; j++) pg.drawText(`Brief page ${k + 1}, line ${j + 1}.`, { x: 72, y: 720 - j * 16, size: 11, font }); });
      await mk("C Form.pdf", 1, (pg, font) => {
        [["Name", "Amount", "Date"], ["Tobias Wrenfield", "$1,200", "May 4"], ["Other", "$5", "June 1"]]
          .forEach((r, j) => r.forEach((t, q) => pg.drawText(t, { x: [72, 250, 400][q], y: 700 - j * 20, size: 10, font })));
      });
      await window.__textReaderAdoptFolder(dir);
    }, { CASE, A, B, C, keyBytes: Array.from(KEY_BYTES) });
    // ↕ Read folder on.
    await p.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && !t.checked) { t.checked = true; t.dispatchEvent(new Event("change")); } });
    await p.evaluate((n) => window.__textReaderOpenDoc(n), "A Decl.txt");
    await p.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
    const sbs = await p.$("#sbs-toggle");
    if (!(await sbs.evaluate((b) => b.getAttribute("aria-pressed") === "true"))) await sbs.click();
    await p.waitForFunction(() => !!document.querySelector("#pages .tpage.matched"), null, { timeout: 15000 });
    await p.waitForTimeout(1500);

    /** The pages on screen whose top stands more than a pixel off their PDF page's. */
    const offLevel = () => p.evaluate(() => {
      const pane = document.getElementById("pdf-pane"), out = [];
      for (const sec of document.querySelectorAll("#pages .tpage")) {
        const a = sec.getBoundingClientRect();
        if (a.bottom < 0 || a.top > innerHeight) continue;
        const sl = pane.querySelector(`.pdf-slot[data-index="${sec.dataset.index}"]`);
        if (sl && Math.abs(a.top - sl.getBoundingClientRect().top) > 1) out.push([Number(sec.dataset.index), Math.round(a.top), Math.round(sl.getBoundingClientRect().top)]);
      }
      return out;
    });
    /** Scroll the text `n` times by `dy`, and every page off level on the way. */
    const sweep = async (dy, n) => {
      const bad = [];
      for (let k = 0; k < n; k++) {
        await p.mouse.move(300, 500);
        await p.mouse.wheel(0, dy);
        await p.waitForTimeout(350);
        for (const b of await offLevel()) bad.push(b);
      }
      return bad.slice(0, 4);
    };
    check("down the folder, every page level with its PDF page", await sweep(400, 40), []);
    const reel = await p.evaluate(() => window.__textReaderReel().members.map((m) => m.name));
    check("…the reel carrying all three documents", reel, ["A Decl.txt", "B Brief.txt", "C Form.txt"]);
    check("…two dividers in the text, two gaps in the pane", await p.evaluate(() =>
      [document.querySelectorAll("#pages > .reel-divider").length, [...document.querySelectorAll("#pdf-pane .pdf-slot")].filter((s) => s.style.marginTop).length]), [2, 2]);
    check("…and at the foot of the folder the columns are one length", await p.evaluate(() => {
      const st = document.getElementById("stage"), pane = document.getElementById("pdf-pane");
      return Math.abs((st.scrollHeight - st.clientHeight) - (pane.scrollHeight - pane.clientHeight)) <= 1;
    }), true);
    await p.setViewportSize({ width: 900, height: 800 });
    await p.waitForTimeout(1500);
    check("a narrow window, back up the folder", await sweep(-400, 30), []);
    check("…and down again", await sweep(400, 30), []);
    check("no page errors", errors, []);
    await context.close();
  } finally {
    await browser.close();
    srv.stop();
  }
  console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
  process.exit(fails ? 1 : 0);
}
await run();
