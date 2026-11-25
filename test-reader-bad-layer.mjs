// Browser test for the text reader's TEXT LAYER mark (viewer/text-reader.js
// "a page's TEXT LAYER marked bad, from the PDF side", pdf-edit.js
// markBadLayerInBytes). The owner (2026-11-25): "It should have me right click
// on the pdf side of the side by side, so I never see it by accident."
//
//   1. right-click a page of the side-by-side PDF pane: the menu offers
//      "Text layer is bad"; picked, the PDF in the case folder carries
//      `/PDFLinkerBadTextLayer true` on that page, findable in its bytes;
//   2. right-click it again: "Text layer is fine after all" takes it off;
//   3. right-click on the TEXT side offers no such thing;
//   4. marked bad, a LEAKS row whose value stands only on that page's text is
//      answered no, and one standing on another page too is left (the owner,
//      2026-11-25: "any leaks flagged on that corresponding text page should
//      be marked no (if they appear only there)").
//
// Run: node test-reader-bad-layer.mjs   (from the repo root). Needs Playwright
// (/opt/node-tools), Chromium (/opt/pw-browsers/chromium) and a free port in
// 8130-8199; exits 0 with SKIP where any is missing. Every word is invented.

import { spawn, execFileSync } from "node:child_process";
import os from "node:os";
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
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passes++; else fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) { console.log(`        got : ${JSON.stringify(got)}`); console.log(`        want: ${JSON.stringify(want)}`); }
}
const portFree = (port) => new Promise((resolve) => { const s = net.createServer(); s.once("error", () => resolve(false)); s.once("listening", () => s.close(() => resolve(true))); s.listen(port, "127.0.0.1"); });
let port = 0;
for (let p = 8130; p <= 8199; p++) if (await portFree(p)) { port = p; break; }
if (!port) skip("no free port in 8130-8199");
const srv = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: REPO, stdio: "ignore" });
for (let k = 0; k < 80; k++) {
  const up = await new Promise((r) => { const c = net.connect(port, "127.0.0.1", () => { c.end(); r(true); }); c.on("error", () => r(false)); });
  if (up) break;
  await new Promise((r) => setTimeout(r, 100));
}

const EXPORT = ["====== Page 1 ======", " 1  Plaintiff Tamsin Orrell moves to compel further responses.",
  "====== Page 2 ======", " 1  -0&,$%-!'-,?$#,-#$\"!'-@@\"%$ Brannoc Ivesdale ~~ Tamsin Orrell"].join("\n") + "\n";
function buildLeaks(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reader-bad-layer-"));
  const out = path.join(dir, "LEAKS.xlsx");
  const py = `
import json, sys, openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "LEAKS"
ws.append(["Value", "Fix? (yes/no)", "Context", "File", "Type", "Where (page:line)", "Notes"])
for r in json.loads(sys.argv[2]): ws.append(r)
wb.save(sys.argv[1])
`;
  try { execFileSync("python3", ["-I", "-c", py, out, JSON.stringify(rows)]); } catch { skip("python3 with openpyxl is needed to build LEAKS.xlsx"); }
  return Array.from(fs.readFileSync(out));
}
const LEAKS = buildLeaks([
  ["Brannoc Ivesdale", "", "$ Brannoc Ivesdale ~~", "Motion.txt", "LEAK", "p.2:1", ""],
  ["Tamsin Orrell", "", "Plaintiff Tamsin Orrell moves", "Motion.txt", "LEAK", "p.1:1, p.2:1", ""],
]);
const browser = await launchBrowser(chromium, CHROME);
try {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/viewer/text-reader.html`);
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
  await page.evaluate(async ({ EXPORT, LEAKS }) => {
    const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    doc.addPage([612, 792]).drawText("Plaintiff moves to compel further responses.", { x: 72, y: 700, size: 12, font });
    doc.addPage([612, 792]).drawText("AMERICAN BAR ASSOCIATION", { x: 72, y: 700, size: 14, font });
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry("Case Reader Bad Layer", { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle("Case Reader Bad Layer", { create: true });
    window.__case = dir;
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(dir, "Motion.pdf", await doc.save());
    await put(dir, "LEAKS.xlsx", new Uint8Array(LEAKS));
    await put(await dir.getDirectoryHandle("Text Files", { create: true }), "Motion.txt", EXPORT);
    await window.__textReaderAdoptFolder(dir);
  }, { EXPORT, LEAKS });
  await page.evaluate(() => window.__textReaderOpenDoc("Motion.txt"));
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0 && window.__textReaderLeaks && window.__textReaderLeaks());
  const sbs = await page.$("#sbs-toggle");
  if (!(await sbs.evaluate((b) => b.getAttribute("aria-pressed") === "true"))) await sbs.click();
  await page.waitForFunction(() => document.querySelectorAll("#pdf-pane .pdf-slot:not(.blank)").length >= 2, null, { timeout: 15000 });
  await page.waitForTimeout(800);

  const fileHas = () => page.evaluate(async () => {
    const b = new Uint8Array(await (await (await window.__case.getFileHandle("Motion.pdf")).getFile()).arrayBuffer());
    let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return /\/PDFLinkerBadTextLayer\s+true/.test(s);
  });
  const marks = () => page.evaluate(async () => {
    const E = await import("/viewer/pdf-edit.js");
    return [...await E.readBadLayerPages(await (await (await window.__case.getFileHandle("Motion.pdf")).getFile()).arrayBuffer())];
  });
  const rightClick = async (sel) => {
    const el = page.locator(sel);
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + Math.min(80, box.height / 2), { button: "right" });
    await page.waitForTimeout(500);
    return page.evaluate(() => { const m = document.getElementById("page-menu"); return m && !m.hidden ? [...m.querySelectorAll("button")].map((b) => b.textContent) : []; });
  };

  console.log("1. right-click the PDF side's page 2: text layer is bad");
  let items = await rightClick('#pdf-pane .pdf-slot[data-index="1"]');
  check("the menu offers it", items.some((x) => /^Text layer is bad/.test(x)), true);
  await page.locator("#page-menu button", { hasText: "Text layer is bad" }).click();
  await page.waitForTimeout(800);
  check("the PDF carries the mark, findable in its bytes", await fileHas(), true);
  check("on page 2 only", await marks(), [2]);
  await page.waitForTimeout(2000);
  const fixes = () => page.evaluate(() => Object.fromEntries(window.__textReaderLeaks().rows.map((r) => [r.value, r.fix])));
  check("the leak only on that page is answered no; the one on page 1 too is left", await fixes(), { "Brannoc Ivesdale": "no", "Tamsin Orrell": "" });

  console.log("2. right-click it again: fine after all");
  items = await rightClick('#pdf-pane .pdf-slot[data-index="1"]');
  check("the menu offers the undo", items.some((x) => /fine after all/.test(x)), true);
  await page.locator("#page-menu button", { hasText: "fine after all" }).click();
  await page.waitForTimeout(800);
  check("the mark is off", await marks(), []);

  console.log("3. the text side offers no such thing");
  await page.keyboard.press("Escape");
  items = await rightClick('#pages .tpage[data-index="1"] .page-body');
  check("no page menu on the text side", items, []);
  check("no page errors", errors, []);
} finally {
  await browser.close();
  srv.kill();
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
