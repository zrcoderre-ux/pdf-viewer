// Tests for the case folder's order (viewer/doc-order.js; text-reader.js,
// "THE FOLDER'S ORDER"): the documents of a case folder are rearranged by
// drag and drop or by ↑ ↓, in the text's Documents list and in PDF mode's ⇅
// list; a move in one is carried to the other; the continuous scroll (the
// reel) and PDF mode's ‹ › read in that order; and the order is still there
// when the folder is opened again in a new session.
//
// Run: node test-doc-order.mjs   (from the repo root)
//
// The browser part needs Playwright (/opt/node-tools), Chromium
// (/opt/pw-browsers/chromium) and a free port in 8130-8199 for python3's
// http.server, and is skipped where any is missing. Every name is invented.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyOrder, moveItem, carryOrder, orderOf, saveOrder, ORDER_KEY, ORDER_FOLDERS } from "./viewer/doc-order.js";

const REPO = path.dirname(fileURLToPath(import.meta.url));
let fails = 0, passes = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passes++; else fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) { console.log(`        got : ${JSON.stringify(got)}`); console.log(`        want: ${JSON.stringify(want)}`); }
}
const names = (xs) => xs.map((x) => x.name);
const it = (...ns) => ns.map((name) => ({ name }));

console.log("1. the order kept, applied to the folder as it is read");
{
  const docs = it("All.txt", "A.txt", "B.txt", "C.txt", "New.txt");
  docs[0].combined = true;
  const pin = (d) => !!d.combined;
  check("the stored order first, a document it does not name after, the combined file on top",
    names(applyOrder(docs, ["C.txt", "Gone.txt", "A.txt", "B.txt", "All.txt"], (d) => d.name, pin)),
    ["All.txt", "C.txt", "A.txt", "B.txt", "New.txt"]);
  check("…no order kept: the list as it was, the same array", applyOrder(docs, []) === docs, true);
  check("…an order that moves nothing: the same array", applyOrder(docs, ["All.txt", "A.txt", "B.txt", "C.txt", "New.txt"], (d) => d.name, pin) === docs, true);
  check("a move, up and down", [names(moveItem(it("A", "B", "C"), 2, 0)), names(moveItem(it("A", "B", "C"), 0, 1)), names(moveItem(it("A", "B", "C"), 0, 9))],
    [["C", "A", "B"], ["B", "A", "C"], ["B", "C", "A"]]);
}

console.log("2. a move in one list carried to the other");
{
  const docs = it("A.txt", "B.txt", "C.txt");
  const pdfs = it("A.pdf", "B.pdf", "Exhibit.pdf", "C.pdf");
  const byName = (list) => (x) => list.find((y) => y.name.replace(/\.\w+$/, "") === x.name.replace(/\.\w+$/, "")) || null;
  const newDocs = [docs[2], docs[0], docs[1]];
  check("the PDFs follow their exports; a PDF with none stays behind the one it followed",
    names(carryOrder(pdfs, newDocs, byName(newDocs))), ["C.pdf", "A.pdf", "B.pdf", "Exhibit.pdf"]);
  const all = [{ name: "All.txt", combined: true }, ...docs];
  check("…and the exports follow their PDFs, the combined file on top",
    names(carryOrder(all, [pdfs[3], pdfs[2], pdfs[1], pdfs[0]], byName(pdfs), (d) => !!d.combined)), ["All.txt", "C.txt", "B.txt", "A.txt"]);
}

console.log("3. kept per folder, the newest folders only");
{
  const store = new Map();
  const get = (k, d) => (store.has(k) ? JSON.parse(store.get(k)) : d);
  const set = (k, v) => store.set(k, JSON.stringify(v));
  saveOrder(get, set, "f1", { docs: ["B", "A"], pdfs: ["B.pdf"] }, 1);
  check("read back", orderOf(get, "f1"), { docs: ["B", "A"], pdfs: ["B.pdf"] });
  check("…a folder with none: empty", orderOf(get, "f2"), { docs: [], pdfs: [] });
  for (let i = 0; i < ORDER_FOLDERS + 5; i++) saveOrder(get, set, "x" + i, { docs: ["A"], pdfs: [] }, 10 + i);
  check(`only the last ${ORDER_FOLDERS} folders kept`, [Object.keys(get(ORDER_KEY, {})).length, orderOf(get, "f1").docs.length], [ORDER_FOLDERS, 0]);
}

// ── the browser ──────────────────────────────────────────────────────────────
const PW = "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = "/opt/pw-browsers/chromium";
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
  if (!port) return null;
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: REPO, stdio: "ignore" });
  for (let t = 0; t < 80; t++) {
    const up = await new Promise((r) => { const c = net.connect(port, "127.0.0.1", () => { c.end(); r(true); }); c.on("error", () => r(false)); });
    if (up) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base: `http://127.0.0.1:${port}`, stop: () => { try { proc.kill("SIGTERM"); } catch { /* gone */ } } };
}

const CASE = "Case Order";
const exportOf = (n, what) => Array.from({ length: n }, (_, k) => `====== Page ${k + 1} ======\n` + Array.from({ length: 40 }, (_, j) => `Page ${k + 1} of the ${what}, line ${j + 1}.`).join("\n")).join("\n") + "\n";

async function browserPart() {
  if (!fs.existsSync(PW) || !fs.existsSync(CHROME)) { console.log("SKIP: the browser part (Playwright or Chromium missing)"); return; }
  const { chromium } = await import(PW);
  const { launchBrowser } = await import("./browser-for-tests.mjs");
  const srv = await startServer();
  if (!srv) { console.log("SKIP: no free port"); return; }
  const browser = await launchBrowser(chromium, CHROME);
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const open = async () => {
      const page = await context.newPage();
      page.on("dialog", (d) => d.accept().catch(() => {}));
      page.__errors = [];
      page.on("pageerror", (e) => page.__errors.push(e.message));
      await page.goto(srv.base + "/viewer/text-reader.html");
      await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
      return page;
    };
    const listed = (page) => page.$$eval("#docs-list li", (lis) => lis.map((l) => l.dataset.name));
    const picks = (page) => page.$$eval("#pm-pick option", (os) => os.map((o) => o.textContent));
    const dividers = (page) => page.$$eval("#pages > .reel-divider", (ds) => ds.map((d) => d.dataset.name));

    let page = await open();
    await page.evaluate(async ({ CASE, docs }) => {
      const { PDFDocument, StandardFonts } = await import(new URL("vendor/pdf-lib/pdf-lib.esm.min.js", location.href).href);
      const make = async (label) => {
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.TimesRoman);
        pdf.addPage([612, 792]).drawText(`${label} page 1`, { x: 72, y: 700, size: 14, font });
        return pdf.save();
      };
      const top = await navigator.storage.getDirectory();
      try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
      const dir = await top.getDirectoryHandle(CASE, { create: true });
      const put = async (d, name, data) => { const f = await (await d.getFileHandle(name, { create: true })).createWritable(); await f.write(data); await f.close(); };
      const text = await dir.getDirectoryHandle("Text Files", { create: true });
      for (const [stem, body] of docs) {
        await put(dir, stem + ".pdf", await make(stem));
        await put(text, stem + ".txt", body);
      }
      await window.__textReaderAdoptFolder(dir);
    }, { CASE, docs: [["Alder Decl", exportOf(2, "Alder declaration")], ["Birch Letter", exportOf(2, "Birch letter")], ["Cedar Motion", exportOf(2, "Cedar motion")]] });
    await page.waitForFunction(() => document.querySelectorAll("#docs-list li").length === 3, null, { timeout: 20000 });

    console.log("4. the Documents list: ↑ ↓ and drag and drop");
    check("the folder's order to start with: by name", await listed(page), ["Alder Decl.txt", "Birch Letter.txt", "Cedar Motion.txt"]);
    check("…each row with ↑ ↓, the first's ↑ and the last's ↓ off",
      await page.$$eval("#docs-list li .reorder-btn", (bs) => bs.map((b) => b.disabled)), [true, false, false, false, false, true]);
    await page.hover("#docs-list li:nth-child(1)");
    await page.click("#docs-list li:nth-child(1) .reorder-btn:nth-child(2)");
    check("↓ moves a document down one", await listed(page), ["Birch Letter.txt", "Alder Decl.txt", "Cedar Motion.txt"]);
    check("…and opens nothing", await page.evaluate(() => document.querySelectorAll("#pages .tpage").length), 0);
    await page.locator("#docs-list li:nth-child(3)").dragTo(page.locator("#docs-list li:nth-child(1)"), { targetPosition: { x: 20, y: 3 } });
    check("dragging the last above the first puts it first", await listed(page), ["Cedar Motion.txt", "Birch Letter.txt", "Alder Decl.txt"]);

    console.log("5. the continuous scroll reads in that order");
    await page.evaluate(() => { const t = document.getElementById("reel-toggle"); if (!t.checked) { t.checked = true; t.dispatchEvent(new Event("change")); } });
    await page.evaluate(() => window.__textReaderOpenDoc("Cedar Motion.txt"));
    // The reel hangs the next document as the reading nears the end.
    const readOn = async () => {
      for (let k = 0; k < 30; k++) {
        if ((await page.evaluate(() => document.querySelectorAll("#pages > .reel-divider").length)) >= 2) break;
        await page.evaluate(() => { const s = document.getElementById("stage"); s.scrollTop = s.scrollHeight; s.dispatchEvent(new Event("scroll")); });
        await page.waitForTimeout(400);
      }
      await page.evaluate(() => { document.getElementById("stage").scrollTop = 0; });
      await page.waitForTimeout(300);
    };
    await readOn();
    check("the documents read on below it, in the order set", await dividers(page), ["Birch Letter.txt", "Alder Decl.txt"]);
    await page.click("#docs-list li:nth-child(3) .reorder-btn:nth-child(1)", { force: true });
    await page.waitForFunction(() => [...document.querySelectorAll("#pages > .reel-divider")].map((d) => d.dataset.name).join("|") !== "Birch Letter.txt|Alder Decl.txt", null, { timeout: 20000 });
    await readOn();
    check("a move with the reel on screen hangs it again in the new order", [await listed(page), await dividers(page)],
      [["Cedar Motion.txt", "Alder Decl.txt", "Birch Letter.txt"], ["Alder Decl.txt", "Birch Letter.txt"]]);

    console.log("6. PDF mode follows, and its ⇅ list moves the text's too");
    await page.waitForFunction(() => !document.getElementById("pdf-mode-btn").disabled, null, { timeout: 20000 });
    await page.click("#pdf-mode-btn");
    await page.waitForFunction(() => document.querySelectorAll("#pm-pick option").length === 3, null, { timeout: 20000 });
    check("its PDFs in the same order", await picks(page), ["Cedar Motion", "Alder Decl", "Birch Letter"]);
    check("⇅ is offered", await page.evaluate(() => !document.getElementById("pm-order").hidden), true);
    await page.click("#pm-order");
    await page.waitForSelector("#pm-order-panel:not([hidden]) li", { timeout: 5000 });
    check("…its list, the PDFs in order", await page.$$eval("#pm-order-panel li .pm-order-name", (xs) => xs.map((x) => x.textContent)), ["Cedar Motion", "Alder Decl", "Birch Letter"]);
    await page.click("#pm-order-panel li:nth-child(3) .reorder-btn:nth-child(1)");
    check("↑ in it moves the PDF, the switcher and the text's list with it",
      [await page.$$eval("#pm-order-panel li .pm-order-name", (xs) => xs.map((x) => x.textContent)), await picks(page), await listed(page)],
      [["Cedar Motion", "Birch Letter", "Alder Decl"], ["Cedar Motion", "Birch Letter", "Alder Decl"], ["Cedar Motion.txt", "Birch Letter.txt", "Alder Decl.txt"]]);
    await page.locator("#pm-order-panel li:nth-child(1)").dragTo(page.locator("#pm-order-panel li:nth-child(3)"), { targetPosition: { x: 40, y: 20 } });
    check("…and dragging in it too", await picks(page), ["Birch Letter", "Alder Decl", "Cedar Motion"]);
    check("…the PDF shown stays the one shown", await page.evaluate(() => document.getElementById("pm-pick").selectedOptions[0].textContent), "Cedar Motion");
    await page.keyboard.press("Escape");
    check("Escape closes it", await page.evaluate(() => document.getElementById("pm-order-panel").hidden), true);
    const errs1 = page.__errors.slice();
    await page.close();

    console.log("7. the order outlasts the session");
    page = await open();
    await page.evaluate(async (CASE) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(CASE);
      await window.__textReaderAdoptFolder(dir);
    }, CASE);
    await page.waitForFunction(() => document.querySelectorAll("#docs-list li").length === 3, null, { timeout: 20000 });
    check("the folder opened again lists its documents in the order set", await listed(page), ["Birch Letter.txt", "Alder Decl.txt", "Cedar Motion.txt"]);
    await page.evaluate(async (CASE) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(CASE);
      const text = await dir.getDirectoryHandle("Text Files");
      const f = await (await text.getFileHandle("Aaron Note.txt", { create: true })).createWritable(); await f.write("====== Page 1 ======\nA note.\n"); await f.close();
      await window.__textReaderAdoptFolder(dir);
    }, CASE);
    await page.waitForFunction(() => document.querySelectorAll("#docs-list li").length === 4, null, { timeout: 20000 });
    check("…a document new since goes after the ones the order names", await listed(page), ["Birch Letter.txt", "Alder Decl.txt", "Cedar Motion.txt", "Aaron Note.txt"]);
    check("no page errors", [...errs1, ...page.__errors], []);
  } finally {
    await browser.close();
    srv.stop();
  }
}
await browserPart();
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
