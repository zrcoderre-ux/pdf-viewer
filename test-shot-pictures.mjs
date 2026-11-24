// Browser test for the 📷 Screenshot over the PDF pane: what a page DRAWS
// that its text layer does not say. The owner: "Screenshot isn't properly
// obscuring the real values in the pdf like it should."
//
// The cover over the PDF read names off the text layer alone, so a real name
// went into the picture, under "the names in their pseudonyms", when it stood
//   A. in a picture on the page (a scan, a letterhead, an exhibit);
//   B. in a filled form field (its appearance is drawn, not in the layer);
//   C. as type drawn as shapes under an OCR layer (here the OCR read it wrong);
//   D. on a page whose text layer was not laid yet when the shot was taken.
// And E., the case that always worked: the name as the page's own text.
//
// Each PDF draws the name in RED, nothing else on the page is red, and the
// picture is taken for real (Playwright's screenshot, at the moment the
// reader takes its frame): the PDF pane's red pixels are counted in it.
//
// Run: node test-shot-pictures.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium),
// python3 with openpyxl (to build the key) and a free port in 8130-8199;
// exits 0 with SKIP where any is missing. Every name in it is invented.

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
function check(label, ok, note = "") {
  if (ok) passes++; else fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok && note) console.log(`        ${note}`);
}
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
  if (!port) skip("no free port in 8130-8199");
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: REPO, stdio: "ignore" });
  for (let t = 0; t < 80; t++) {
    const up = await new Promise((resolve) => { const c = net.connect(port, "127.0.0.1", () => { c.end(); resolve(true); }); c.on("error", () => resolve(false)); });
    if (up) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base: `http://127.0.0.1:${port}`, stop: () => { try { proc.kill("SIGTERM"); } catch { /* gone */ } } };
}
function buildKey(rows) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "shot-pics-")), "pseudonym_key.xlsx");
  const py = `
import json, sys, openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Pseudonym Key"
ws.append(["Category", "Real Value", "Replacement", "Context", "Status", "Source", "Occurrences"])
for r in json.loads(sys.argv[2]): ws.append(r)
wb.save(sys.argv[1])
`;
  execFileSync("python3", ["-I", "-c", py, out, JSON.stringify(rows)]);
  return Array.from(fs.readFileSync(out));
}
const KEY = buildKey([["person", "Nadia Quillfeather", "Odile Brackenbury", "", "", "spreadsheet", 3]]);
const EXPORT = [
  "====== Page 1 ======",
  " 1  Plaintiff Odile Brackenbury moves to compel further responses.",
  " 2  The declaration of Odile Brackenbury is attached.",
].join("\n") + "\n";

const srv = await startServer();
const browser = await launchBrowser(chromium, CHROME);
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept().catch(() => {}));
  // The frame the reader takes, taken for real by Playwright at that moment.
  let snap = null;
  await page.exposeFunction("__snapForTest", async () => { snap = await page.screenshot(); return true; });

  await page.goto(srv.base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);

  const open = async (kind) => {
    await page.evaluate(async ({ kind, EXPORT, KEY }) => {
      const { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize,
        setTextRenderingMode, moveText, showText, setFillingColor } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.TimesRoman);
      const pg = doc.addPage([612, 792]);
      const black = rgb(0, 0, 0), red = rgb(1, 0, 0);
      pg.drawText("1", { x: 40, y: 700, size: 12, font, color: black });
      pg.drawText("2", { x: 40, y: 676, size: 12, font, color: black });
      if (kind === "text" || kind === "late") {
        pg.drawText("Plaintiff", { x: 72, y: 700, size: 12, font, color: black });
        pg.drawText("Nadia Quillfeather", { x: 72 + font.widthOfTextAtSize("Plaintiff ", 12), y: 700, size: 12, font, color: red });
        pg.drawText("moves to compel further responses.", { x: 230, y: 700, size: 12, font, color: black });
      } else {
        pg.drawText("Plaintiff moves to compel further responses.", { x: 72, y: 700, size: 12, font, color: black });
      }
      if (kind === "image") {
        // A letterhead or an exhibit: the name in a picture.
        const c = document.createElement("canvas"); c.width = 600; c.height = 80;
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 600, 80);
        g.fillStyle = "#f00"; g.font = "bold 44px serif"; g.fillText("Nadia Quillfeather", 10, 56);
        const png = await doc.embedPng(await new Promise((r) => c.toBlob((b) => b.arrayBuffer().then(r), "image/png")));
        pg.drawImage(png, { x: 72, y: 560, width: 300, height: 40 });
      }
      if (kind === "field") {
        const form = doc.getForm();
        const f = form.createTextField("declarant");
        f.setText("Nadia Quillfeather");
        f.addToPage(pg, { x: 72, y: 600, width: 260, height: 24, textColor: red, borderWidth: 0, font });
        form.updateFieldAppearances(font);
      }
      if (kind === "outline") {
        // Type drawn as shapes (bars stand for the outlined glyphs), and an OCR
        // layer over it that read the name wrong ("Nadia Qui11feather").
        for (let k = 0; k < 18; k++) pg.drawRectangle({ x: 72 + k * 7, y: 600, width: 5, height: 10, color: red });
        const name = font.encodeText("Nadia Qui11feather");
        pg.pushOperators(pushGraphicsState(), beginText(), setFontAndSize(pg.node.newFontDictionary(font.name, font.ref), 12),
          setTextRenderingMode(3), moveText(72, 600), showText(name), endText(), popGraphicsState());
      }
      const top = await navigator.storage.getDirectory();
      const CASE = "Case Shot Pictures " + kind;
      try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
      const dir = await top.getDirectoryHandle(CASE, { create: true });
      const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
      await put(dir, "pseudonym_key.xlsx", new Uint8Array(KEY));
      await put(dir, `Motion ${kind}.pdf`, await doc.save());
      const text = await dir.getDirectoryHandle("Text Files", { create: true });
      await put(text, `Motion ${kind}.txt`, EXPORT);
      await window.__textReaderAdoptFolder(dir);
    }, { kind, EXPORT, KEY });
    await page.evaluate((kind) => window.__textReaderOpenDoc(`Motion ${kind}.txt`), kind);
    await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
    const sbs = await page.$("#sbs-toggle");
    if (!(await sbs.evaluate((b) => b.getAttribute("aria-pressed") === "true"))) await sbs.click();
    await page.waitForFunction(() => { const s = document.querySelector("#pdf-pane .pdf-slot"); return s && s.dataset.rendered && s.dataset.textFor === s.dataset.rendered; }, null, { timeout: 15000 });
    await page.waitForTimeout(600);
  };
  // Red pixels in the PDF pane of a PNG (decoded in the page).
  const redIn = async (png) => page.evaluate(async (b64) => {
    const pane = document.getElementById("pdf-pane").getBoundingClientRect();
    const bmp = await createImageBitmap(await (await fetch("data:image/png;base64," + b64)).blob());
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext("2d"); g.drawImage(bmp, 0, 0);
    const k = bmp.width / window.innerWidth;
    const x0 = Math.round(pane.left * k), y0 = Math.round(pane.top * k), w = Math.round(pane.width * k), h = Math.round(pane.height * k);
    const d = g.getImageData(x0, y0, w, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i] - d[i + 1] > 80 && d[i] - d[i + 2] > 80) n++;
    return n;
  }, png.toString("base64"));
  const shoot = async (before) => {
    snap = null;
    return page.evaluate(async (before) => {
      if (before) eval(before);
      const c0 = document.createElement("canvas"); c0.width = 8; c0.height = 8; c0.getContext("2d").fillRect(0, 0, 8, 8);
      navigator.mediaDevices.getDisplayMedia = async () => c0.captureStream(5);
      let seen = null;
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (cb, ...a) {
        if (seen) return toBlob.call(this, cb, ...a);
        seen = {
          whole: [...document.querySelectorAll(".shot-cover.whole")].map((c) => c.textContent),
          pics: document.querySelectorAll(".shot-cover.pic").length,
          fakes: [...document.querySelectorAll(".shot-cover:not(.whole):not(.pic)")].map((c) => c.textContent),
        };
        window.__snapForTest().then(() => toBlob.call(this, cb, ...a));
      };
      document.getElementById("shot-btn").click();
      for (let t = 0; t < 100 && !seen; t++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 1500));
      HTMLCanvasElement.prototype.toBlob = toBlob;
      return { seen, toast: document.getElementById("toast").textContent, after: document.querySelectorAll(".shot-cover").length };
    }, before || null);
  };

  const cases = [
    ["E. the name as the page's text", "text", null, (s) => s.fakes.some((t) => /Odile Brackenbury/.test(t)) && !s.whole.length],
    ["A. the name in a picture", "image", null, (s) => s.pics >= 1 && !s.whole.length],
    ["B. the name in a filled form field", "field", null, (s) => s.pics >= 1 && !s.whole.length],
    ["C. type drawn as shapes under an OCR layer that misread the name", "outline", null, (s) => s.whole.length === 1],
    ["D. the text layer not yet laid when the picture is taken", "late",
      "document.querySelector('#pdf-pane .pdf-slot').removeAttribute('data-text-for')", (s) => s.whole.length === 1],
  ];
  for (const [label, kind, before, want] of cases) {
    console.log(label);
    await open(kind);
    const shotRed0 = await redIn(await page.screenshot());
    check("on the screen, the name is there in red", shotRed0 > 50, `red pixels: ${shotRed0}`);
    const r = await shoot(before);
    check("the picture was taken", !!r.seen && !!snap, JSON.stringify(r));
    if (!r.seen || !snap) continue;
    const red = await redIn(snap);
    check("no red pixel of the name in the picture", red === 0, `red pixels: ${red}; ${JSON.stringify(r.seen)}`);
    check("covered the way it should be", want(r.seen), JSON.stringify(r.seen));
    check("the screen put back after", r.after === 0);
    if (kind === "image" || kind === "field") check("the toast says a picture or field was covered", /picture.*covered/.test(r.toast), r.toast);
    if (kind === "outline" || kind === "late") check("the toast says a page was left out", /left out/.test(r.toast), r.toast);
  }
  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  srv.stop();
}
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
