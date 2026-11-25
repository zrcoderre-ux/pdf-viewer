// Browser test for a page marked as having a BAD TEXT LAYER (viewer/pdf-edit.js
// BAD_LAYER_KEY, viewer/viewer.js setBadLayer, viewer/text-reader.js
// pdfNamesOn). The owner (2026-11-25): "I need a way to indicate that the
// visible text for a page is good, but that the original text layer for that
// page is garbage … This should work inside PDF+ and go into PDF Linker."
//
//   1. a scan under an invisible layer of PRINTABLE garble (a cipher of
//      punctuation, which the viewer's own garble test passes) keeps that
//      layer under Recognize text;
//   2. right-click on the page, "text layer is bad": the file on disk gets
//      `/PDFLinkerBadTextLayer true` on that page, written where a plain
//      search of the bytes finds it, and the page's text is now the scan's
//      words, read with Recognize text never pressed;
//   3. opened again, the mark is read off the file and the page read again;
//   4. right-click, "text layer is fine after all": the key is gone from the
//      file and the layer's own text is back;
//   5. the helpers: which pages are marked, a file that cannot hold the mark
//      settled without a parse, a mark inside an object stream still found.
//
// Run: node test-bad-text-layer.mjs   (from the repo root). Needs Playwright
// (/opt/node-tools), Chromium (/opt/pw-browsers/chromium) and a free port in
// 8130-8199; exits 0 with SKIP where any is missing. Every PDF is built in the
// page with the vendored pdf-lib; every word is invented.

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

const BODY = ["Plaintiff filed the motion on November 20, 2026.", "See Code Civ. Proc. section 437c."];
const CIPHER = "-0&,$%-!'-,?$#,-#$\"!'-@@\"%$-#$\"!";
const browser = await launchBrowser(chromium, CHROME);
try {
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 1000 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  await page.goto(`http://127.0.0.1:${port}/viewer/viewer.html`);
  await page.waitForFunction(() => typeof window.__pdfViewerLoadLocal === "function");
  // One page: a scan of BODY covering it, under an invisible layer of CIPHER.
  await page.evaluate(async ({ BODY, CIPHER }) => {
    const L = await import("./vendor/pdf-lib/pdf-lib.esm.min.js");
    const doc = await L.PDFDocument.create();
    const pg = doc.addPage([612, 792]);
    const font = await doc.embedFont(L.StandardFonts.Helvetica);
    const c = document.createElement("canvas"); c.width = 1224; c.height = 1584;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#000"; g.font = "40px serif";
    BODY.forEach((line, i) => g.fillText(line, 100, 300 + i * 70));
    const png = await new Promise((r) => c.toBlob(r, "image/png"));
    pg.drawImage(await doc.embedPng(new Uint8Array(await png.arrayBuffer())), { x: 0, y: 0, width: 612, height: 792 });
    // Drawn INVISIBLY (render mode 3), as a filer's OCR layer is.
    const key = pg.node.newFontDictionary("Helv", font.ref);
    for (let i = 0; i < 6; i++) {
      pg.pushOperators(L.beginText(), L.setFontAndSize(key, 14), L.setTextRenderingMode(L.TextRenderingMode.Invisible),
        L.moveText(50, 640 - i * 35), L.showText(font.encodeText(CIPHER + " " + CIPHER)), L.endText());
    }
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry("Bad Layer Case", { recursive: true }); } catch { /* none yet */ }
    window.__case = await top.getDirectoryHandle("Bad Layer Case", { create: true });
    const w = await (await window.__case.getFileHandle("Exhibit A.pdf", { create: true })).createWritable();
    await w.write(await doc.save()); await w.close();
  }, { BODY, CIPHER });
  const load = async () => {
    await page.evaluate(async () => { const h = await window.__case.getFileHandle("Exhibit A.pdf"); await window.__pdfViewerLoadLocal(await h.getFile(), h); });
    await page.waitForSelector(".page-wrapper", { timeout: 15000 });
  };
  const settle = async () => {
    await page.waitForTimeout(1200);
    for (let k = 0; k < 90; k++) {
      const busy = await page.evaluate(() => { const c = document.getElementById("ocr-progress"); return !!document.querySelector(".page-wrapper.ocr-running") || (c && !c.hidden); });
      if (!busy) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(800);
  };
  const textOf = async () => (await page.evaluate(() => [...document.querySelectorAll(".textLayer span")].map((s) => s.textContent).join(" "))).replace(/\s+/g, " ").trim();
  const fileText = () => page.evaluate(async () => {
    const b = new Uint8Array(await (await (await window.__case.getFileHandle("Exhibit A.pdf")).getFile()).arrayBuffer());
    let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s;
  });
  const hasBody = (t) => /Plaintiff\s+filed\s+the\s+motion/i.test(t) && /437c/.test(t);
  const hasCipher = (t) => t.includes("-0&,$%");
  const menu = async (pick) => {
    const box = await page.locator(".page-wrapper").first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + 60, { button: "right" });
    await page.waitForTimeout(300);
    const items = await page.evaluate(() => [...document.querySelectorAll(".menu button, .menu [role=menuitem], .menu .menu-item")].map((b) => b.textContent.trim()).filter(Boolean));
    if (pick) await page.locator(".menu").getByText(pick).first().click();
    return items;
  };

  console.log("1. a printable garble passes the viewer's own test, and stays");
  await load();
  await page.evaluate(() => document.getElementById("ocr-run").click());
  await settle();
  let t = await textOf();
  check("the cipher, not the scan's words", [hasCipher(t), hasBody(t)], [true, false]);

  console.log("2. right-click: text layer is bad");
  const items = await menu("text layer is bad");
  check("the menu offers it", items.some((x) => /Page 1: text layer is bad/.test(x)), true);
  await settle();
  let raw = await fileText();
  check("the file carries the mark, findable in its bytes", /\/PDFLinkerBadTextLayer\s+true/.test(raw), true);
  t = await textOf();
  check("the page reads as it shows: the scan's words, no cipher", [hasBody(t), hasCipher(t)], [true, false]);

  console.log("3. opened again (Recognize text not pressed), the mark is read off the file");
  await page.reload();
  await page.waitForFunction(() => typeof window.__pdfViewerLoadLocal === "function");
  await page.evaluate(async () => { const top = await navigator.storage.getDirectory(); window.__case = await top.getDirectoryHandle("Bad Layer Case"); });
  await load();
  await settle();
  t = await textOf();
  check("the scan's words again", [hasBody(t), hasCipher(t)], [true, false]);

  console.log("4. right-click: text layer is fine after all");
  const back = await menu("fine after all");
  check("the menu offers the undo", back.some((x) => /Page 1: text layer is fine after all/.test(x)), true);
  await settle();
  raw = await fileText();
  check("the mark is off the file", /PDFLinkerBadTextLayer/.test(raw), false);
  t = await textOf();
  check("the layer's own text is back", hasCipher(t), true);

  console.log("5. the helpers");
  const h = await page.evaluate(async () => {
    const E = await import("./pdf-edit.js");
    const L = await import("./vendor/pdf-lib/pdf-lib.esm.min.js");
    const doc = await L.PDFDocument.create();
    for (let i = 0; i < 3; i++) doc.addPage([200, 200]);
    const plain = await doc.save({ useObjectStreams: false });
    E.setBadLayerMarks(doc, { set: [0, 2] });
    const marked = [...E.badLayerPagesOf(doc)];
    const packed = await doc.save({ useObjectStreams: true });
    E.setBadLayerMarks(doc, { clear: [0] });
    return {
      marked,
      after: [...E.badLayerPagesOf(doc)],
      plainMay: E.mayHaveBadLayer(plain),
      plainRead: [...(await E.readBadLayerPages(plain))],
      packedRead: [...(await E.readBadLayerPages(packed))],
    };
  });
  check("pages marked, 0-based", h.marked, [0, 2]);
  check("…one taken off", h.after, [2]);
  check("a file with neither the name nor an object stream is settled unparsed", [h.plainMay, h.plainRead], [false, []]);
  check("a mark inside an object stream is still found, 1-based", h.packedRead, [1, 3]);
  check("no page errors", errors, []);
} finally {
  await browser.close();
  srv.kill();
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
