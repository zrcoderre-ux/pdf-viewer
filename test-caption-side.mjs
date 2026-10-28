// Browser test for a pleading's caption boxed by a column of `)`s, beside its
// PDF: the side drawn as a bar (textdoc.captionParens, rules.js markParen), a
// numbered line that holds nothing but its `)`, and three of the caption's
// rows written between two numbers — the party's first line under the cause
// of action beside it. The owner, of such a page: "The PDF does not have these
// weird sizing inconsistencies. And the counts should be in line with one
// another." Every caption line used to stand over every other through its `)`,
// and a numbered line with only its `)` held a line's room, so the three rows
// between lines 14 and 15 were taken down to half their size.
//
// Checked: every line of the caption in the PDF's 12 point; the causes of
// action set at one left, their second lines at another; no line on top of
// another.
//
// Run: node test-caption-side.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium)
// and a free port in 8130-8199 for python3's http.server; exits 0 with SKIP
// where any is missing. Every name in it is invented.

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

// The PDF: [text, line (fractions between), x, size]. A `)` on every half
// line from 11 to 18 at the box's side; the causes of action single-spaced
// beside the party block, the second and third a little off the half lines.
const PDF = [
  ["S. SAUNDERSON EDGERTON (SBN 094464)", 1, 72, 12],
  ["Attorneys for Plaintiff Cobalt Cal Orion, a California corporation", 6, 72, 12],
  ["SUPERIOR COURT OF THE STATE OF CALIFORNIA", 8, 170, 12],
  ["COBALT CAL ORION, a", 11, 72, 12], ["CASE NO:", 11, 316, 12],
  ["California corporation,", 11.5, 72, 12], ["COMPLAINT FOR:", 11.5, 316, 12],
  ["Plaintiff", 12.5, 190, 12], ["1. BREACH OF WRITTEN", 12.5, 320, 12],
  ["vs.", 13.5, 110, 12], ["CONTRACT;", 13.5, 335, 12],
  ["2. QUANTUM MERUIT; AND", 14.1, 320, 12],
  ["ROCKHAVEN ENTERPRISES, INC., a California", 14.6, 72, 12], ["3. FORECLOSURE OF", 14.6, 320, 12],
  ["corporation; EASTMARK YARROWVALE, LLC, a", 15.1, 72, 12], ["MECHANIC'S LIEN", 15.1, 335, 12],
  ["California limited liability company; EVERLINE", 15.6, 72, 12],
  ["FALCON, LLC, a California limited", 16.1, 72, 12],
  ["liability company; and DOES 1 to 50,", 16.6, 72, 12],
  ["inclusive,", 17.1, 72, 12],
  ["Defendants", 18, 190, 12],
];
const PARENS = [11, 11.5, 12, 12.5, 13, 13.5, 14, 14.1, 14.6, 15.1, 15.6, 16.1, 16.6, 17.1, 18];
// The export, as PDF-Linker wrote the owner's page.
const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));
const L = (num, left, right = "") => (num ? String(num).padStart(2) + "  " : "    ") + pad(left, 44) + ")" + (right ? "  " + right : "");
const EXPORT = [
  "====== Page 1 ======",
  " 1  S. SAUNDERSON EDGERTON (SBN 094464)",
  " 2", " 3", " 4", " 5",
  " 6  Attorneys for Plaintiff Cobalt Cal Orion, a California corporation",
  " 7",
  " 8                SUPERIOR COURT OF THE STATE OF CALIFORNIA",
  " 9", "10",
  L(11, "COBALT CAL ORION, a", "CASE NO:"),
  L(null, "California corporation,", "COMPLAINT FOR:"),
  L(12, ""),
  L(null, "                    Plaintiff", "1. BREACH OF WRITTEN"),
  L(13, ""),
  L(null, "          vs.", "    CONTRACT;"),
  L(14, ""),
  L(null, "", "2. QUANTUM MERUIT; AND"),
  L(null, "ROCKHAVEN ENTERPRISES, INC., a California", "3. FORECLOSURE OF"),
  L(15, "corporation; EASTMARK YARROWVALE, LLC, a", "    MECHANIC'S LIEN"),
  L(null, "California limited liability company; EVERLINE"),
  L(16, "FALCON, LLC, a California limited"),
  L(null, "liability company; and DOES 1 to 50,"),
  L(17, "inclusive,"),
  L(18, "                    Defendants"),
  "19", "20",
].join("\n") + "\n";

const srv = await startServer();
const browser = await launchBrowser(chromium, CHROME);
try {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // A folder handle is never put in IndexedDB here: the Chromium this runs on
  // in some containers goes down reading an origin-private folder's handle
  // back out of it, and the folder is only remembered, not needed, for this.
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) {
      if (v && typeof FileSystemHandle === "function" && v.handle instanceof FileSystemHandle) throw new DOMException("not kept in this test", "DataCloneError");
      return put.call(this, v, k);
    };
  });
  await page.goto(srv.base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder);
  await page.evaluate(async (text) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry("Case Side", { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle("Case Side", { create: true });
    const t = await dir.getDirectoryHandle("Text Files", { create: true });
    const w = await (await t.getFileHandle("Complaint.txt", { create: true })).createWritable(); await w.write(text); await w.close();
    await window.__textReaderAdoptFolder(dir);
    await window.__textReaderOpenDoc("Complaint.txt");
  }, EXPORT);
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.evaluate(async (items) => {
    const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const doc = await PDFDocument.create();
    const fonts = { r: await doc.embedFont(StandardFonts.TimesRoman), b: await doc.embedFont(StandardFonts.TimesRomanBold), i: await doc.embedFont(StandardFonts.TimesRomanItalic) };
    const pg = doc.addPage([612, 792]);
    const base = (line) => 792 - (100 + (line - 1) * 24);
    for (let n = 1; n <= 28; n++) pg.drawText(String(n), { x: 46 - fonts.r.widthOfTextAtSize(String(n), 12), y: base(n), size: 12, font: fonts.r });
    for (const [t, line, x, size] of items.text) pg.drawText(t, { x, y: base(line), size, font: fonts.r });
    for (const line of items.parens) pg.drawText(")", { x: 304, y: base(line), size: 12, font: fonts.r });
    await window.__textReaderPickPdfs([new File([await doc.save()], "Complaint.pdf", { type: "application/pdf" })]);
  }, { text: PDF, parens: PARENS });
  await page.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body.fixed"), null, { timeout: 15000 });
  await page.waitForTimeout(1000);
  const sbs = await page.$("#sbs-toggle");
  if (!(await sbs.evaluate((b) => b.getAttribute("aria-pressed") === "true"))) await sbs.click();
  await page.waitForTimeout(2500);
  const got = await page.evaluate(() => {
    const body = document.querySelector("#pages .tpage .page-body");
    const br = body.getBoundingClientRect();
    const scale = br.width / 612;
    const lines = [...body.querySelectorAll(":scope > .line")].map((l) => {
      const lt = l.querySelector(":scope > .lt");
      const text = lt ? lt.textContent : "";
      return { text, top: (l.getBoundingClientRect().top - br.top) / scale, size: parseFloat(getComputedStyle(l).fontSize) / scale, from: text.search(/\S/), to: text.trimEnd().length };
    });
    // Where a phrase's first letter stands across the page, in PDF units.
    const leftOf = (t) => {
      const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const i = n.data.indexOf(t);
        if (i < 0) continue;
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
        return (r.getBoundingClientRect().left - br.left) / scale;
      }
      return null;
    };
    return {
      lines,
      lefts: Object.fromEntries(["1. BREACH", "CONTRACT;", "2. QUANTUM", "3. FORECLOSURE", "MECHANIC"].map((t) => [t, leftOf(t)])),
    };
  });

  const worded = got.lines.filter((l) => l.text.replace(/\)/g, "").trim());
  const size = (t) => { const l = worded.find((x) => x.text.includes(t)); return l ? Math.round(l.size * 10) / 10 : null; };
  const block = ["COBALT CAL ORION", "California corporation,", "Plaintiff", "1. BREACH", "vs.", "CONTRACT;", "2. QUANTUM", "ROCKHAVEN", "3. FORECLOSURE",
    "corporation; EASTMARK", "MECHANIC", "EVERLINE", "FALCON, LLC", "DOES 1 to 50", "inclusive,", "Defendants"];
  const sizes = block.map(size);
  console.log("sizes");
  check("the caption all in the PDF's 12 point, none shrunk", sizes.every((s) => s === 12), JSON.stringify(Object.fromEntries(block.map((t, k) => [t, sizes[k]]))));
  console.log("the causes of action");
  const x = got.lefts;
  const near = (a, b) => a != null && b != null && Math.abs(a - b) <= 1.5;
  check("1., 2. and 3. at one left", near(x["1. BREACH"], x["2. QUANTUM"]) && near(x["1. BREACH"], x["3. FORECLOSURE"]), JSON.stringify(x));
  check("…their second lines at one left", near(x["CONTRACT;"], x.MECHANIC), JSON.stringify(x));
  console.log("spacing");
  // A line stands over another only where they share columns of the export
  // (the `)` side aside: it is the box's bar, not type).
  const cols = (t) => { const s = t.replace(/\)/g, " "); return { from: s.search(/\S/), to: s.trimEnd().length }; };
  const clashes = [];
  worded.forEach((b, k) => { for (let j = 0; j < k; j++) { const a = worded[j]; const ca = cols(a.text), cb = cols(b.text); const over = Math.min(ca.to, cb.to) - Math.max(ca.from, cb.from) > 3; if (over && b.top < a.top + a.size - 0.5 && b.top > a.top - b.size + 0.5) clashes.push(`${a.text.trim().slice(0, 24)} / ${b.text.trim().slice(0, 24)}`); } });
  check("no line on top of another", clashes.length === 0, clashes.join(" | "));
  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  srv.stop();
}
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
