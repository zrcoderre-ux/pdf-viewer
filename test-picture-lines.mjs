// Browser test for a picture in a PDF beside its text page (pdfsync.rowLayout's
// spread, from text-reader.js's matched layout): the export carries the
// picture's words (PDF-Linker's OCR of it) and the PDF's text layer does not,
// and every line the PDF does carry stays on its row — under the picture,
// above it and beside a picture at the foot of the page — and on the page,
// which keeps the paper's height, so side by side its PDF page's sheet has no
// white held open under it (plain paper and pleading paper).
//
// Run: node test-picture-lines.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium)
// and a free port in 8130-8199 for python3's http.server; exits 0 with SKIP
// where any is missing. Every name in it is invented.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  if (!ok) {
    console.log(`        got : ${JSON.stringify(got)}`);
    console.log(`        want: ${JSON.stringify(want)}`);
  }
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

const W = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa", "quebec", "romeo", "sierra", "tango"];
const para = (i) => `The witness ${W[i % 20]} testified regarding the ${W[(i * 7) % 20]} contract on ${W[(i * 3) % 20]} terms ${i}`;
const picLine = (k) => `          Email from ${W[k % 20]} sent ${W[(k + 5) % 20]} subject ${W[(k + 9) % 20]} re payment ${k}`;

/** One page: `before` picture lines, `body` lines 24 points apart from y (PDF, top down), `inside` after body line 7, `after` at the end; `pleading`, numbered 1-28 down the margin. */
function build({ before = 0, inside = 0, after = 0, y = 100, pleading = false }) {
  const exp = [], pdf = [];
  for (let k = 0; k < before; k++) exp.push(picLine(k));
  for (let i = 0, n = 1; i < 28; i++, n++) {
    if (i === 7 && inside) { for (let k = 0; k < inside; k++) exp.push(picLine(100 + k)); y += 8 * 24; n += 8; }
    if (n > 28 || y > 750) break;
    exp.push(pleading ? `${String(n).padStart(2)}  ${para(i)}` : para(i)); pdf.push([para(i), y, pleading ? n : 0]); y += 24;
    if (!pleading && y > 700) break;
  }
  for (let k = 0; k < after; k++) exp.push(picLine(200 + k));
  return { exp, pdf };
}

async function open(browser, base, { exp, pdf }) {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder);
  await page.evaluate(async (text) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry("Case Picture", { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle("Case Picture", { create: true });
    const t = await dir.getDirectoryHandle("Text Files", { create: true });
    const w = await (await t.getFileHandle("A Decl.txt", { create: true })).createWritable(); await w.write(text); await w.close();
    await window.__textReaderAdoptFolder(dir);
    await window.__textReaderOpenDoc("A Decl.txt");
  }, ["====== Page 1 ======", ...exp].join("\n") + "\n");
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.evaluate(async (pdfLines) => {
    const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const pg = doc.addPage([612, 792]);
    for (const [t, y, n] of pdfLines) {
      pg.drawText(t, { x: 72, y: 792 - y, size: 12, font });
      if (n) pg.drawText(String(n), { x: 46 - font.widthOfTextAtSize(String(n), 12), y: 792 - y, size: 12, font });
    }
    await window.__textReaderPickPdfs([new File([await doc.save()], "A Decl.pdf", { type: "application/pdf" })]);
  }, pdf);
  await page.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body.fixed"), null, { timeout: 15000 });
  await page.waitForTimeout(1000);
  const sbs = await page.$("#sbs-toggle");
  if (!(await sbs.evaluate((b) => b.getAttribute("aria-pressed") === "true"))) await sbs.click();
  await page.waitForTimeout(2000);
  const sheet = await page.evaluate(() => {
    const sh = document.querySelector(".pdf-slot .pdf-sheet"), c = sh && sh.querySelector("canvas");
    return sh && c ? Math.round(sh.getBoundingClientRect().height - c.getBoundingClientRect().height) : null;
  });
  const lines = await page.evaluate(() => {
    const body = document.querySelector("#pages .tpage .page-body");
    const br = body.getBoundingClientRect();
    const scale = br.width / 612;
    return { height: br.height / scale, at: [...body.querySelectorAll(":scope > .line")].map((l) => { const r = l.getBoundingClientRect(); return [l.textContent.trim(), (r.top - br.top) / scale, (r.bottom - br.top) / scale]; }) };
  });
  return { lines, sheet, errors, close: () => page.context().close() };
}

/** Each PDF line's text top on the page against its PDF row's (its baseline less the 12-point type). */
function offRow(r, pdf) {
  return pdf.map(([t, y]) => { const l = r.lines.at.find(([s]) => s.endsWith(t)); return l ? Math.round(Math.abs(l[1] - (y - 12))) : "missing"; });
}

const srv = await startServer();
const browser = await chromium.launch({ executablePath: CHROME });
try {
  for (const [label, spec] of [
    ["1. fourteen of a picture's lines among the body's", { inside: 14 }],
    ["2. thirty of them, more than a pitch apiece holds", { inside: 30 }],
    ["3. a picture at the head of the page", { before: 20, y: 292 }],
    ["4. a picture at the foot of the page", { after: 24 }],
    ["5. sixty of them at the foot, more than the page holds at a pitch apiece", { after: 60 }],
    ["6. pleading paper: a picture's words under line 28", { pleading: true, after: 12 }],
    ["7. pleading paper: a picture over eight lines' numbers", { pleading: true, inside: 14 }],
  ]) {
    console.log(label);
    const b = build(spec);
    const r = await open(browser, srv.base, b);
    check("every line the PDF carries on its row", offRow(r, b.pdf).every((d) => d <= 1), true);
    check("…and every line on the page", r.lines.at.every(([, top, bottom]) => top >= -1 && bottom <= r.lines.height + 1) && Math.round(r.lines.height) === 792, true);
    check("…and side by side no white held open under its PDF page", Math.abs(r.sheet) <= 2, true);
    check("no page errors", r.errors, []);
    await r.close();
  }
} finally {
  await browser.close();
  srv.stop();
}
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
