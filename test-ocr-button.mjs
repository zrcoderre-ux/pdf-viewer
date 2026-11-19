// Browser test for the viewer's Recognize text (OCR) button (viewer/ocr.js,
// viewer.js renderAllPages): which pages it reads. The owner (2026-11-19):
// "PDF+ OCR does not work … Yes, the recognize text button", on court filings
// whose scanned pages carry eCourt's e-filing stamp as text, and "When the PDF
// is visibly garbled, that should be treated as if it is not garbled. it is
// only when the invisible text layer is garbled …".
//
//   1. a plain scan is read;
//   2. a scan under an e-filing stamp set as text is read, the stamp keeping
//      its own text and not read twice;
//   3. a scan under an INVISIBLE text layer that is garbled (private-use code
//      points) is read, the recognizer's text replacing the garbled layer;
//   4. a page whose garbled text is drawn VISIBLY is left as it is;
//   5. a page of ordinary text is left as it is.
//
// Run: node test-ocr-button.mjs   (from the repo root). Needs Playwright
// (/opt/node-tools), Chromium (/opt/pw-browsers/chromium) and a free port in
// 8130-8199; exits 0 with SKIP where any is missing. Every PDF is built in the
// page with the vendored pdf-lib; every word is invented.

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
const site = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-button-site-"));
execFileSync("bash", [path.join(REPO, "pwa", "build-site.sh"), site], { stdio: "ignore" });
const srv = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: site, stdio: "ignore" });
for (let k = 0; k < 80; k++) {
  const up = await new Promise((r) => { const c = net.connect(port, "127.0.0.1", () => { c.end(); r(true); }); c.on("error", () => r(false)); });
  if (up) break;
  await new Promise((r) => setTimeout(r, 100));
}

const BODY = ["Plaintiff filed the motion on November 20, 2026.", "See Code Civ. Proc. section 437c."];
const STAMP = "Electronically FILED by Superior Court of California, County of Los Angeles";
const browser = await launchBrowser(chromium, CHROME);
try {
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 1000 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => typeof window.__appOpenPdf === "function");
  // A PDF of one page: `scan` a picture of BODY covering it, `stamp` the stamp
  // as text, `invisible` / `visible` a garbled line (private-use code points)
  // drawn invisibly or not, `text` BODY as ordinary text.
  await page.evaluate(async ({ BODY, STAMP }) => {
    const L = await import("./viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    window.__makePdf = async ({ scan = false, stamp = false, invisible = false, visible = false, text = false }) => {
      const doc = await L.PDFDocument.create();
      const pg = doc.addPage([612, 792]);
      const font = await doc.embedFont(L.StandardFonts.Helvetica);
      if (scan) {
        const c = document.createElement("canvas"); c.width = 1224; c.height = 1584;
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = "#000"; g.font = "40px serif";
        BODY.forEach((line, i) => g.fillText(line, 100, 300 + i * 70));
        const png = await new Promise((r) => c.toBlob(r, "image/png"));
        const img = await doc.embedPng(new Uint8Array(await png.arrayBuffer()));
        pg.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
      }
      if (stamp) pg.drawText(STAMP, { x: 40, y: 770, size: 7, font });
      if (text) BODY.forEach((line, i) => pg.drawText(line + " " + line, { x: 50, y: 650 - i * 20, size: 11, font }));
      if (invisible || visible) {
        const diffs = [65];
        for (let i = 0; i < 26; i++) diffs.push(L.PDFName.of("uniE0" + (16 + i).toString(16).toUpperCase()));
        const ref = doc.context.register(doc.context.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: { Type: "Encoding", Differences: diffs } }));
        const key = pg.node.newFontDictionary("Garble", ref);
        const mode = invisible ? L.TextRenderingMode.Invisible : L.TextRenderingMode.Fill;
        for (let i = 0; i < 4; i++) {
          pg.pushOperators(L.beginText(), L.setFontAndSize(key, 14), L.setTextRenderingMode(mode), L.moveText(100, 640 - i * 35), L.showText(L.PDFString.of("ABCDEFGHIJKLMNOPQRSTUVWXYZ")), L.endText());
        }
      }
      return new File([await doc.save()], "scan.pdf", { type: "application/pdf" });
    };
  }, { BODY, STAMP });
  // Each PDF opens in a tab of its own: the newest viewer is the one in front.
  const viewer = () => page.frames().filter((f) => /viewer\/viewer\.html/.test(f.url())).pop();
  const textOf = async () => (await viewer().evaluate(() => [...document.querySelectorAll(".textLayer span")].map((s) => s.textContent).join(" "))).replace(/\s+/g, " ").trim();
  // Open the PDF, let it settle, press Recognize text, and wait until the
  // OCR chip has come and gone (or nothing happens).
  async function readWith(opts) {
    const tabs = page.frames().filter((f) => /viewer\/viewer\.html/.test(f.url())).length;
    await page.evaluate(async (opts) => window.__appOpenPdf(await window.__makePdf(opts)), opts);
    for (let k = 0; k < 150 && page.frames().filter((f) => /viewer\/viewer\.html/.test(f.url())).length <= tabs; k++) await page.waitForTimeout(100);
    await viewer().waitForSelector(".page-wrapper", { timeout: 15000 });
    await page.waitForTimeout(1500);
    const before = await textOf();
    await viewer().evaluate(() => document.getElementById("ocr-run").click());
    // Recognition takes a few seconds; wait for the progress chip to clear.
    await page.waitForTimeout(1200);
    for (let k = 0; k < 90; k++) {
      const busy = await viewer().evaluate(() => { const c = document.getElementById("ocr-progress"); return !!document.querySelector(".page-wrapper.ocr-running") || (c && !c.hidden); });
      if (!busy) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(800);
    return { before, after: await textOf() };
  }
  const hasBody = (t) => /Plaintiff\s+filed\s+the\s+motion/i.test(t) && /437c/.test(t);
  const pua = (t) => /[-]/.test(t);

  console.log("1. a plain scan is read");
  let r = await readWith({ scan: true });
  check("no text before, its words after", [r.before, hasBody(r.after)], ["", true]);

  console.log("2. a scan under an e-filing stamp set as text");
  r = await readWith({ scan: true, stamp: true });
  check("before: only the stamp", r.before, STAMP);
  check("after: the scan's words read", hasBody(r.after), true);
  check("…the stamp kept, and not read a second time", (r.after.match(/Electronically/g) || []).length, 1);

  console.log("3. a scan under a garbled INVISIBLE text layer");
  r = await readWith({ scan: true, invisible: true });
  check("before: the layer's private-use characters", pua(r.before), true);
  check("after: the scan's words instead", [hasBody(r.after), pua(r.after)], [true, false]);

  console.log("4. garbled text drawn VISIBLY is left as it is");
  r = await readWith({ visible: true, text: true });
  check("the page's text unchanged", r.after, r.before);
  check("…its boxes still its own", pua(r.after), true);

  console.log("5. a page of ordinary text is left as it is");
  r = await readWith({ text: true });
  check("unchanged", [r.after === r.before, hasBody(r.after)], [true, true]);

  console.log("6. how a page is weighed");
  const weigh = await viewer().evaluate(async () => {
    const o = await import("./ocr.js");
    const tc = (s) => ({ items: [{ str: s }] });
    const O = { save: 1, restore: 2, transform: 3, paintImageXObject: 4, setTextRenderingMode: 5, showText: 6 };
    return {
      garbled: o.pageTextIsGarbled(tc("")),
      fewBoxes: o.pageTextIsGarbled(tc("A long page of ordinary words ".repeat(20) + "")),
      sparse: [o.sparseText(tc("Electronically FILED")), o.sparseText(tc("x".repeat(500)))],
      cover: o.imageCoverage({ fnArray: [1, 3, 4, 2], argsArray: [[], [612, 0, 0, 792, 0, 0], [], []] }, O, 612 * 792),
      small: o.imageCoverage({ fnArray: [1, 3, 4, 2], argsArray: [[], [100, 0, 0, 50, 10, 10], [], []] }, O, 612 * 792) < 0.5,
      inv: o.invisibleTextCounts({ fnArray: [5, 6, 5, 6], argsArray: [[3], [[{ unicode: "" }, { unicode: "" }]], [0], [[{ unicode: "" }]]] }, O),
    };
  });
  check("garbled: many private-use characters", weigh.garbled, true);
  check("…not one among many words", weigh.fewBoxes, false);
  check("a stamp's worth of text is a scrap; a page's is not", weigh.sparse, [true, false]);
  check("a picture covering the page", [weigh.cover, weigh.small], [1, true]);
  check("only the invisible text counted", weigh.inv, { chars: 2, garbled: 2 });
  check("no page errors", errors, []);
} finally {
  await browser.close();
  srv.kill();
  fs.rmSync(site, { recursive: true, force: true });
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
