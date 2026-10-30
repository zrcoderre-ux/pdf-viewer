// Browser test for the 📷 Screenshot of a page beside its PDF where the
// pseudonyms are LONGER than the real names: the picture is taken in the
// pseudonyms (fakesForShot), and a line the layout fitted to the page in the
// real names, or a caption's left-hand cell fitted to its `)` side, ran off
// the page or across the bar with the longer fakes in it. The owner, of such a
// screenshot: "The text is going off the page here."
//
// Checked: on the screen, in the real names, and in the picture, in the
// pseudonyms, no line's text runs past the sheet's right edge and no caption
// party runs across the `)` side; and the screen put back as it was after.
//
// Run: node test-shot-fit.mjs   (from the repo root)
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

// ── the key, as a real .xlsx ────────────────────────────────────────────────
function buildKey(rows, pinned = []) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "shot-fit-")), "pseudonym_key.xlsx");
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
// Each fake well longer than the name it stands for.
const KEY_BYTES = buildKey([
  ["organization", "Ivo Trucking", "Springvale Sablewood", "", "", "spreadsheet", 4],
  ["person", "Al Roe", "Wyndham Jocelyn", "", "", "spreadsheet", 2],
  ["person", "Dan Fry", "Denbigh Seabright", "", "", "spreadsheet", 2],
]);

// The PDF, in the real names: [text, line, x]. A `)` on every caption line at x 300.
const PDF = [
  ["Attorneys for Defendant, Cross-Defendant and Cross-Complainant IVO TRUCKING, LLC, and for", 5, 72],
  ["Cross-Defendant IVO TRUCKING, LLC (DOE 3)", 6, 72],
  ["SUPERIOR COURT OF THE STATE OF CALIFORNIA", 7, 170],
  ["DAN FRY, individually, and as successor", 9, 72], ["CASE NO. 19STZV98194", 9, 312],
  ["in interest to THE ESTATE OF DAN FRY;", 10, 72], ["Assigned for all purposes to Hon. Al Roe, Dept. 12", 10, 312],
  ["Plaintiff,", 11, 160],
  ["vs.", 12, 110],
  ["IVO TRUCKING, LLC, and DOES 1 through 20,", 13, 72], ["FIRST AMENDED CROSS-COMPLAINT", 13, 312],
  ["Defendants.", 14, 160],
];
const PARENS = [9, 10, 11, 12, 13, 14];
// A justified line, its name in two of the PDF's runs with a wide space between (pdf.js reads them as two spans).
const SPLIT = [["COMES NOW, Defendant, IVO", 17, 108], ["TRUCKING LLC (\u201cCross-Complainant\u201d) and for its", 17, 290]];
// A name spotted unfaked and flagged (New Real Values.txt): in no key, so no fake.
const FLAGGED_LINE = ["Witness Quell Harbor was deposed.", 19, 108];
// The export, in the pseudonyms, as PDF-Linker writes the page.
const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));
const L = (num, left, right = "") => (num ? String(num).padStart(2) + "  " : "    ") + pad(left, 46) + ")" + (right ? "  " + right : "");
const EXPORT = [
  "====== Page 1 ======",
  " 1", " 2", " 3", " 4",
  " 5  Attorneys for Defendant, Cross-Defendant and Cross-Complainant SPRINGVALE SABLEWOOD, LLC, and for",
  " 6  Cross-Defendant SPRINGVALE SABLEWOOD, LLC (DOE 3)",
  " 7                SUPERIOR COURT OF THE STATE OF CALIFORNIA",
  " 8",
  L(9, "DENBIGH SEABRIGHT, individually, and as successor", "CASE NO. 19STZV98194"),
  L(10, "in interest to THE ESTATE OF DENBIGH SEABRIGHT;", "Assigned for all purposes to Hon. Wyndham Jocelyn, Dept. 12"),
  L(11, "            Plaintiff,"),
  L(12, "      vs."),
  L(13, "SPRINGVALE SABLEWOOD, LLC, and DOES 1 through 20,", "FIRST AMENDED CROSS-COMPLAINT"),
  L(14, "            Defendants."),
  "15", "16",
  "17          COMES NOW, Defendant, SPRINGVALE SABLEWOOD LLC (\u201cCross-Complainant\u201d) and for its",
  "18",
  "19          Witness Quell Harbor was deposed.",
].join("\n") + "\n";

const CASE = "Case Shot Fit";
const srv = await startServer();
const browser = await launchBrowser(chromium, CHROME);
try {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept().catch(() => {}));
  // The case folder, with the key or (keyBytes null) without one, opened at FACC.txt beside its PDF.
  const openCase = async (page, CASE, keyBytes) => {
  await page.goto(srv.base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
  await page.evaluate(async ({ CASE, EXPORT, PDF, PARENS, SPLIT, FLAGGED_LINE, keyBytes }) => {
    const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const pg = doc.addPage([612, 792]);
    const base = (line) => 792 - (100 + (line - 1) * 24);
    for (let n = 1; n <= 28; n++) pg.drawText(String(n), { x: 46 - font.widthOfTextAtSize(String(n), 12), y: base(n), size: 12, font });
    for (const [t, line, x] of PDF.concat(SPLIT, [FLAGGED_LINE])) pg.drawText(t, { x, y: base(line), size: 12, font });
    for (const line of PARENS) pg.drawText(")", { x: 300, y: base(line), size: 12, font });
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(CASE, { create: true });
    const put = async (d, name, data) => { const f = await (await d.getFileHandle(name, { create: true })).createWritable(); await f.write(data); await f.close(); };
    if (keyBytes) await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    await put(dir, "FACC.pdf", await doc.save());
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    await put(text, "FACC.txt", EXPORT);
    await put(dir, "New Real Values.txt", "Quell Harbor\n"); // a name spotted unfaked, flagged
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, EXPORT, PDF, PARENS, SPLIT, FLAGGED_LINE, keyBytes });
  await page.evaluate(() => window.__textReaderOpenDoc("FACC.txt"));
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body.fixed"), null, { timeout: 15000 });
  await page.waitForTimeout(1000);
  const sbs = await page.$("#sbs-toggle");
  if (!(await sbs.evaluate((b) => b.getAttribute("aria-pressed") === "true"))) await sbs.click();
  await page.waitForTimeout(2500);
  };
  await openCase(page, CASE, Array.from(KEY_BYTES));

  // Per line with words: its text, how far its last letter runs past the sheet's
  // edge (px), and on a caption row how far its party runs across the `)` side.
  const measure = () => {
    const body = document.querySelector("#pages .tpage .page-body");
    const br = body.getBoundingClientRect();
    const edge = br.right;
    const out = [];
    for (const l of body.querySelectorAll(":scope > .line")) {
      const lt = l.querySelector(":scope > .lt");
      if (!lt || !lt.textContent.replace(/\)/g, "").trim()) continue;
      const bar = lt.querySelector(".rb.paren");
      let right = -Infinity, leftRight = -Infinity;
      const walk = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.data.trim()) continue;
        if (n.parentElement.closest(".rb")) continue;
        // To its last letter: the spaces a cell ends with carry it to its bar and are not drawn.
        const b = n.data.search(/\S\s*$/);
        const r = document.createRange(); r.setStart(n, b); r.setEnd(n, b + 1);
        const rc = r.getBoundingClientRect();
        right = Math.max(right, rc.right);
        if (bar && (bar.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING)) leftRight = Math.max(leftRight, rc.right);
      }
      out.push({ text: lt.textContent.trim().slice(0, 40), past: right - edge, across: bar ? leftRight - bar.getBoundingClientRect().left : null });
    }
    return out;
  };
  const bad = (rows) => rows.filter((r) => r.past > 1 || (r.across != null && r.across > 1)).map((r) => `${r.text} (past ${r.past.toFixed(1)}, across ${r.across == null ? "-" : r.across.toFixed(1)})`);

  console.log("1. on the screen, the real names");
  const screen = await page.evaluate(`(${measure.toString()})()`);
  check("the real names are shown", screen.some((r) => /IVO TRUCKING/.test(r.text)), JSON.stringify(screen.map((r) => r.text)));
  check("no line off the page, no party across the side", bad(screen).length === 0, bad(screen).join(" | "));

  console.log("2. in the screenshot, the pseudonyms");
  const shot = await page.evaluate(async (m) => {
    const measure = eval(m);
    const c0 = document.createElement("canvas"); c0.width = 8; c0.height = 8; c0.getContext("2d").fillRect(0, 0, 8, 8);
    navigator.mediaDevices.getDisplayMedia = async () => c0.captureStream(5);
    let seen = null;
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...a) {
      if (!seen) {
        seen = { rows: measure(), whole: document.querySelectorAll(".shot-cover.whole").length };
        seen.covers = [...document.querySelectorAll(".shot-cover:not(.whole)")].map((c) => { const r = c.getBoundingClientRect(); return { text: c.textContent, font: getComputedStyle(c).fontFamily, top: r.top, left: r.left, w: r.width }; });
      }
      return toBlob.apply(this, a);
    };
    document.getElementById("shot-btn").click();
    for (let t = 0; t < 100 && !seen; t++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 800));
    HTMLCanvasElement.prototype.toBlob = toBlob;
    return seen;
  }, `(${measure.toString()})`);
  const shotRows = shot && shot.rows;
  check("the picture is in the pseudonyms", !!shotRows && shotRows.some((r) => /SPRINGVALE SABLEWOOD/.test(r.text)), JSON.stringify(shotRows && shotRows.map((r) => r.text)));
  check("no line off the page, no party across the side", !!shotRows && bad(shotRows).length === 0, shotRows ? bad(shotRows).join(" | ") : "no picture taken");
  console.log("3. the PDF's names covered");
  const covers = (shot && shot.covers) || [];
  const split = covers.filter((c) => /Springvale Sablewood|SPRINGVALE SABLEWOOD/i.test(c.text));
  check("the PDF page is in the picture, not left out", !!shot && shot.whole === 0, JSON.stringify(shot && shot.whole));
  check("the name split over two of the PDF's spans is covered", split.length >= 1, JSON.stringify(covers.map((c) => c.text)));
  const blank = covers.filter((c) => !c.text.trim() && covers.some((o) => o !== c && o.text.trim() && Math.abs(o.top - c.top) < 2));
  check("…by one cover on its line, its fake across all of it, no blank cover beside it", blank.length === 0, JSON.stringify(covers.map((c) => [c.text, Math.round(c.top), Math.round(c.left), Math.round(c.w)])));
  check("…in the PDF's face (Times), not the text layer's generic one", covers.length > 0 && covers.every((c) => /Times/i.test(c.font)), JSON.stringify([...new Set(covers.map((c) => c.font))]));

  console.log("4. the screen put back");
  const after = await page.evaluate(`(${measure.toString()})()`);
  check("the real names again, laid out as before", JSON.stringify(after) === JSON.stringify(screen), JSON.stringify(after.filter((r, k) => JSON.stringify(r) !== JSON.stringify(screen[k]))));

  console.log("5. with Flagged open, its values covered: in the list, on the page, in Find and over the PDF");
  await page.click("#tab-flags");
  await page.waitForFunction(() => [...document.querySelectorAll("#flags-list li")].some((li) => /Quell Harbor/.test(li.innerText)), null, { timeout: 5000 });
  await page.click("#find-btn");
  await page.fill("#fb-input", "Quell Harbor"); // the name typed into Find
  await page.waitForTimeout(500);
  const where = () => ({
    page: document.querySelector("#pages .tpage .page-body").textContent,
    find: document.getElementById("fb-input").value,
    pdf: [...document.querySelectorAll(".shot-cover:not(.whole)")].map((c) => c.textContent),
  });
  const before = await page.evaluate(`(${where.toString()})()`);
  check("on the screen, the flagged name on the page and in Find", /Quell Harbor/.test(before.page) && /Quell Harbor/.test(before.find), JSON.stringify([before.find]));
  const shootFlags = (page) => page.evaluate(async (w) => {
    const where = eval(w);
    const c0 = document.createElement("canvas"); c0.width = 8; c0.height = 8; c0.getContext("2d").fillRect(0, 0, 8, 8);
    navigator.mediaDevices.getDisplayMedia = async () => c0.captureStream(5);
    const read = () => [...document.querySelectorAll("#flags-list li")].map((li) => ({ text: li.innerText, before: getComputedStyle(li, "::before").content }));
    let seen = null;
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...a) {
      if (!seen) seen = { rows: read(), ...where() };
      return toBlob.apply(this, a);
    };
    document.getElementById("shot-btn").click();
    for (let t = 0; t < 100 && !seen; t++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 800));
    HTMLCanvasElement.prototype.toBlob = toBlob;
    return { seen, after: { rows: read(), ...where() }, toast: document.getElementById("toast").textContent };
  }, `(${where.toString()})`);
  const flags = await shootFlags(page);
  const seen = flags.seen;
  check("in the picture, no flagged value in the list", !!seen && seen.rows.length > 0 && seen.rows.every((r) => !/Quell|Harbor/.test(r.text)), JSON.stringify(seen && seen.rows));
  check("…each covered with the five blocks", !!seen && seen.rows.every((r) => r.before === '"\u2588\u2588\u2588\u2588\u2588"'), JSON.stringify(seen && seen.rows));
  check("…nor on the page, covered there with the blocks", !!seen && !/Quell|Harbor/.test(seen.page) && /Witness \u2588{5} was deposed/.test(seen.page), seen && seen.page.slice(-80));
  check("…nor in the Find box", !!seen && !/Quell|Harbor/.test(seen.find) && seen.find.includes("\u2588"), JSON.stringify(seen && seen.find));
  check("…and over the PDF, a cover with the blocks", !!seen && seen.pdf.some((t) => t === "\u2588".repeat(5)), JSON.stringify(seen && seen.pdf));
  check("all shown again after", flags.after.rows.some((r) => /Quell Harbor/.test(r.text)) && flags.after.rows.every((r) => r.before === "none")
    && flags.after.page === before.page && flags.after.find === before.find && flags.after.pdf.length === 0, JSON.stringify([flags.after.find, flags.after.pdf]));
  check("the toast says the flagged name was covered", /The flagged name is covered/.test(flags.toast), flags.toast);

  console.log("6. with no key open, the flagged name covered all the same");
  const bare = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  bare.on("pageerror", (e) => errors.push(e.message));
  bare.on("dialog", (d) => d.accept().catch(() => {}));
  await openCase(bare, CASE + " No Key", null);
  await bare.click("#tab-flags");
  await bare.waitForFunction(() => [...document.querySelectorAll("#flags-list li")].some((li) => /Quell Harbor/.test(li.innerText)), null, { timeout: 5000 });
  const bareFlags = await shootFlags(bare);
  const bs = bareFlags.seen;
  check("the page shows the flagged name", /Quell Harbor/.test(bareFlags.after.page), bareFlags.after.page.slice(-80));
  check("in the picture, covered in the list, on the page and over the PDF",
    !!bs && bs.rows.every((r) => !/Quell|Harbor/.test(r.text)) && /Witness \u2588{5} was deposed/.test(bs.page) && bs.pdf.some((t) => t === "\u2588".repeat(5)),
    JSON.stringify(bs && { rows: bs.rows, page: bs.page.slice(-60), pdf: bs.pdf }));
  check("the toast says so", /The flagged name is covered/.test(bareFlags.toast), bareFlags.toast);
  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  srv.stop();
}
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
