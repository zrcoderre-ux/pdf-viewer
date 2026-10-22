// Browser test: a form page beside its PDF looks like the PDF, and the line
// numbering is what it was (viewer/text-reader.js, applyMatchedLayout and
// placePages; columns.js, placeLine and dressCheckboxes; pdfsync.lineItems and
// pdfFace; rules.js on the grid).
//
// The owner's direction: the reader is what must LOOK like the PDF, however
// the export lays its lines out — and line numbering stays paramount. So, side
// by side, a form page's pieces each stand where the PDF prints them, at their
// own size and in the PDF's face, and every export line is still ONE line, in
// its order, on its own row (a piece moves across, never up or down); a
// pleading page's numbered lines stand exactly where their numbers put them,
// in the reader's own type — bold where the PDF's is bold and italic where it
// is italic, run by run, as a form's are.
//
// Run: node test-form-look.mjs   (from the repo root)
//      node test-form-look.mjs --pleading-tops   prints the pleading page's
//      numbered lines' tops as JSON and nothing else, to hold this checkout's
//      against another's (they must be the same to the pixel).
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium) and a
// free port in 8130-8199 for python3's http.server; exits 0 with SKIP where any
// is missing. The case folder is an OPFS directory, as in test-folder-save.mjs;
// both PDFs are made in the page with pdf-lib's standard fonts. Every name and
// number in them is invented.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const PW = "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = "/opt/pw-browsers/chromium";
const TOPS_ONLY = process.argv.includes("--pleading-tops");

function skip(why) { console.log(`SKIP: ${why}`); process.exit(0); }
if (!fs.existsSync(PW)) skip("Playwright is not installed at " + PW);
if (!fs.existsSync(CHROME)) skip("Chromium is not installed at " + CHROME);
const { chromium } = await import(PW);

let fails = 0;
function check(label, ok, note = "") {
  if (!ok) fails++;
  if (TOPS_ONLY) return;
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
let port = 0;
for (let p = 8130; p <= 8199; p++) if (await portFree(p)) { port = p; break; }
if (!port) skip("no free port in 8130-8199");
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: REPO, stdio: "ignore" });
await waitPort(port);
const BASE = `http://127.0.0.1:${port}`;

// ── the form ────────────────────────────────────────────────────────────────
// A Judicial Council-style form page: rows of pieces, each { t, x, y (its
// baseline, from the top), size, font: R(egular) B(old) I(talic), box (a
// checkbox drawn before its label), join (the export joins it to the piece
// before with ONE space, as an export of today does where the form prints the
// two apart), glue (the PDF prints it hard against the piece before, no space
// between — a face changing in the middle of a word — and the export writes
// the two as one word) }. A piece with no x follows the one before it a space
// on, in the PDF as in the export. Each entry is one export line — the footnote and the
// label printed beside it on its baseline are one, as are the footnote's next
// line and the party boxes two points lower.
const FORM = [
  [{ t: "SAMPLE-100", x: 520, y: 48, size: 10, font: "B" }],
  [{ t: "REQUEST FOR SAMPLE ORDER", x: 230, y: 80, font: "B" }],
  [{ t: "1.", x: 36, y: 110 }, { t: "TO THE CLERK: Please", x: 50.5, y: 110 }, { t: "dismiss", y: 110, font: "B", join: true }, { t: "this action as follows:", y: 110, join: true }],
  [{ t: "a.", x: 50.7, y: 124 }, { t: "(1)", x: 65.3, y: 124 }, { box: true, x: 88.4, y: 124 }, { t: "With prejudice", x: 107.9, y: 124 },
    { t: "(2)", x: 181.9, y: 124 }, { box: true, x: 205.4, y: 124 }, { t: "Without prejudice", x: 224.5, y: 124 }],
  [{ t: "(3)", x: 65.4, y: 138 }, { box: true, x: 88.6, y: 138 }, { t: "Cross-complaint filed", x: 107.8, y: 138 }, { t: "on", y: 138, join: true },
    { t: "(date):", y: 138, font: "I", join: true }, { t: "by", x: 314.6, y: 138 }, { t: "(name):", y: 138, font: "I", join: true }],
  [{ t: "* If the request is for some parties only, of some causes only,", x: 36, y: 170, size: 7 },
    { t: "Attorney or party without attorney for", x: 353.6, y: 170, join: true }],
  [{ t: "or of some cross-complaints only, so state the parties,", x: 36, y: 178.4, size: 7 }, { box: true, x: 358, y: 180.9 },
    { t: "Plaintiff/Petitioner", x: 377, y: 180.9 }, { box: true, x: 464.6, y: 180.9, join: true }, { t: "Defendant/Respondent", x: 483.6, y: 180.9 }],
  [{ t: "Date:", x: 36, y: 220 }, { t: "Clerk", x: 300, y: 220, font: "I" }, { t: ", by", y: 220, glue: true }],
];
const U = 4.2, X0 = 36; // the export's character on the page, and its left
/** An export line as PDF-Linker lays one out: each piece at its column, a space at least from the last. */
function exportLine(pieces) {
  let s = "";
  for (const p of pieces) {
    const t = p.box ? "[   ]" : p.t;
    if (p.glue) { s += t; continue; }
    if (p.join || p.x == null) { s += " " + t; continue; }
    let col = Math.round((p.x - X0) / U);
    if (s.length && col <= s.length) col = s.length + 1;
    s = s.padEnd(col) + t;
  }
  return s;
}
const FORM_LINES = ["[fillable form SAMPLE-100: 5 checkbox(es), 0 checked]", ...FORM.map(exportLine)];
const FORM_TEXT = "====== Page 1 ======\n" + FORM_LINES.join("\n") + "\n";

// ── the pleading ────────────────────────────────────────────────────────────
// Twenty-eight numbers down the margin, a pitch of 24 points, the body at 72,
// in Times; a checkbox on one numbered line.
const PLEAD_BODY = {
  1: "Marigold Teasdale-Vane (SBN 000000)", 2: "TEASDALE-VANE LAW", 3: "100 Example Way", 4: "Sampletown, CA 90000",
  8: "SUPERIOR COURT OF THE STATE OF CALIFORNIA", 9: "FOR THE COUNTY OF SAMPLE",
  12: "QUILLON BRAKESMAN, an individual,", 13: "Plaintiff,", 14: "v.", 15: "ORVELLE HOLDINGS, INC.,",
  16: "Defendant.", 19: "[ X ] Plaintiff demands a jury trial.", 21: "Plaintiff alleges as follows:",
  22: "1. Plaintiff is an individual residing in the County of Sample.", 23: "2. Defendant is a corporation doing business there.",
};
// …and the faces some of its lines are set in: the court's heading in bold,
// the plaintiff's name in bold with the rest of its line regular, one word of
// the body in italics. Everything else is Times.
const PLEAD_FACES = {
  8: [["SUPERIOR COURT OF THE STATE OF CALIFORNIA", "B"]],
  12: [["QUILLON BRAKESMAN,", "B"], [" an individual,", "R"]],
  22: [["1. Plaintiff is an ", "R"], ["individual", "I"], [" residing in the County of Sample.", "R"]],
};
// What the reader is to draw them in, by the line (its index among the page's
// lines) and a word on it.
const PLEAD_WANT = [
  { line: 7, t: "SUPERIOR", bold: true }, { line: 11, t: "QUILLON", bold: true }, { line: 11, t: "individual," },
  { line: 21, t: "individual", italic: true }, { line: 21, t: "residing" }, { line: 0, t: "Marigold" },
];
// Lines the PDF sets in pieces cut mid-word, as some filings' makers do; the
// export has the words whole (the pieces join to the line's text exactly).
const SPLIT_AT = {
  21: ["Plain", "tiff all", "eges as fol", "lows:"],
  23: ["2. Def", "endant is a corpo", "ration doing bus", "iness there."],
};
for (const [n, parts] of Object.entries(SPLIT_AT)) if (parts.join("") !== PLEAD_BODY[n]) throw new Error(`SPLIT_AT ${n} is not its line`);
const INDENTED = 21;
// The clerk's filing stamp over the attorney block, at the right: its first
// words written onto line 1 a column after the attorney's name (as PDF-Linker
// writes them), and on the PDF with numbers its second printed at line 2's
// very height, with the firm's name a few points under it — the row an indent
// would be read off.
const STAMP = { 1: "Electronically FILED by", 2: "Superior Court of California," };
PLEAD_BODY[1] = PLEAD_BODY[1] + " ".repeat(12) + STAMP[1];
// A caption's second column, on the PDFs without numbers: each line's two
// pieces set apart (x 72 and 350), the file's at one column — the evidence the
// export's character grid is read off.
const CAPTION = { 13: ["Plaintiff,", "Case No. 12345"], 16: ["Defendant.", "Dept. 5"] };
const PLEAD_PLAIN = { ...PLEAD_BODY }; // (the row-by-row pleading's: no second column)
for (const [n, [a, b]] of Object.entries(CAPTION)) PLEAD_BODY[n] = a.padEnd(40) + b;
const JUSTIFIED = 15;
const PLEAD_LINES = [];
// (An indented paragraph is written indented: its spaces after the gutter's two.)
for (let n = 1; n <= 28; n++) PLEAD_LINES.push(String(n).padStart(2) + (PLEAD_BODY[n] ? "  " + (n === INDENTED ? "     " : "") + PLEAD_BODY[n] : ""));
const PLEAD_TEXT = "====== Page 1 ======\n" + PLEAD_LINES.join("\n") + "\n";
// …and the export of a PDF it does not line up with by its spaces (the
// paragraph's indent is the PDF's alone): laid row by row.
const PLEAD_ROW_LINES = [];
for (let n = 1; n <= 28; n++) PLEAD_ROW_LINES.push(String(n).padStart(2) + (PLEAD_PLAIN[n] ? "  " + PLEAD_PLAIN[n] : ""));
const PLEAD_ROW_TEXT = "====== Page 1 ======\n" + PLEAD_ROW_LINES.join("\n") + "\n";

let browser = null;
try {
  browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto(BASE + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc && !!window.__textReaderPickPdfs);

  // The PDFs, made in the page, and the folder: both PDFs, both exports.
  const made = await page.evaluate(async ({ FORM, STAMP, PLEAD_BODY, PLEAD_PLAIN, PLEAD_FACES, FORM_TEXT, PLEAD_TEXT, PLEAD_ROW_TEXT, SPLIT_AT, INDENTED, JUSTIFIED, CAPTION }) => {
    const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const form = await PDFDocument.create();
    const fp = form.addPage([612, 792]);
    const fonts = { R: await form.embedFont(StandardFonts.Helvetica), B: await form.embedFont(StandardFonts.HelveticaBold), I: await form.embedFont(StandardFonts.HelveticaOblique) };
    const placed = []; // [line, piece, x, size, font] of each piece that prints text
    FORM.forEach((pieces, k) => {
      let end = null, prevEnd = null;
      for (const p of pieces) {
        const size = p.size || 9;
        const font = fonts[p.font || "R"];
        if (p.box) { fp.drawRectangle({ x: p.x, y: 792 - p.y - 1, width: 9, height: 9, borderWidth: 0.5 }); continue; }
        const x = p.x != null ? p.x : end + (p.glue ? 0 : fonts.R.widthOfTextAtSize(" ", size));
        fp.drawText(p.t, { x, y: 792 - p.y, size, font });
        end = x + font.widthOfTextAtSize(p.t, size);
        placed.push({ line: k + 1, t: p.t, x, size, font: p.font || "R", apart: prevEnd == null || x - prevEnd >= size });
        prevEnd = end;
      }
    });
    // The pleading twice: with its numbers in the text layer, and without (a
    // filing whose margin numbers are drawn, not set as text) — the export
    // numbers its lines either way.
    // `plain`: every line one piece in one face (no character grid to read
    // off it, so the page is laid row by row) and the paragraph indented on
    // the PDF alone.
    // `pitch`: the scan's rows that far apart (a single-spaced filing numbered
    // by # Number lines, a number on every row); `image`: no text at all (a
    // scan no OCR has read), only the paper's rule down the margin.
    const pleading = async (numbers, plain = false, { pitch = 24, image = false } = {}) => {
    const plead = await PDFDocument.create();
    const pp = plead.addPage([612, 792]);
    if (image) { pp.drawLine({ start: { x: 60, y: 0 }, end: { x: 60, y: 792 }, thickness: 1 }); return plead.save(); }
    const tf = { R: await plead.embedFont(StandardFonts.TimesRoman), B: await plead.embedFont(StandardFonts.TimesRomanBold), I: await plead.embedFont(StandardFonts.TimesRomanItalic) };
    const times = tf.R;
    for (let n = 1; n <= 28; n++) {
      // (A scan's lines are not on its paper's pitch: on the PDFs without
      // numbers, three lines a few points off their places.)
      const y = 792 - (100 + (n - 1) * pitch) - (numbers || pitch !== 24 ? 0 : ({ 3: 5, 9: -4, 14: 6 }[n] || 0));
      const num = String(n);
      if (numbers) pp.drawText(num, { x: 46 - times.widthOfTextAtSize(num, 12), y, size: 12, font: times });
      const body = plain ? PLEAD_PLAIN[n] : PLEAD_BODY[n];
      if (!body) continue;
      // A checkbox is drawn, not printed: its export mark has no text on the PDF.
      if (body.startsWith("[ X ] ")) { pp.drawRectangle({ x: 72, y: y - 1, width: 10, height: 10, borderWidth: 0.5 }); pp.drawText(body.slice(6), { x: 88, y, size: 12, font: times }); continue; }
      // A line set in several faces is several pieces, each hard against the
      // last; and a PDF that sets its words in pieces cut wherever its maker
      // split the run (kerning, a tracked span) — each piece a text item of
      // its own, the words whole in the export.
      // (Line 21 an indented paragraph on the PDF without its numbers: the text
      // is set in, the margin number stays in its column.)
      let x = !numbers && n === INDENTED ? 108 : 72;
      if (numbers && n === 1) {
        pp.drawText(body.slice(0, body.indexOf(STAMP[1])).trimEnd(), { x, y, size: 12, font: tf.R });
        pp.drawText(STAMP[1], { x: 430, y, size: 9, font: tf.R });
        continue;
      }
      if (numbers && n === 2) {
        pp.drawText(STAMP[2], { x: 430, y, size: 9, font: tf.R });
        pp.drawText(body, { x, y: y - 7, size: 12, font: tf.R });
        continue;
      }
      // (On the PDFs without numbers, line 15 set as a justified line is: each
      // word an item of its own, the word spaces wide, under a column's gap.)
      if (!numbers && !plain && CAPTION[n]) {
        CAPTION[n].forEach((t, j) => pp.drawText(t, { x: j ? 350 : 72, y, size: 12, font: tf.R }));
        continue;
      }
      if (!numbers && !plain && n === JUSTIFIED) {
        for (const w of body.split(" ")) { pp.drawText(w, { x, y, size: 12, font: tf.R }); x += tf.R.widthOfTextAtSize(w, 12) + 0.8 * 12; }
        continue;
      }
      for (const [t, f] of plain ? [[body, "R"]] : PLEAD_FACES[n] || (SPLIT_AT[n] ? SPLIT_AT[n].map((t) => [t, "R"]) : [[body, "R"]])) { pp.drawText(t, { x, y, size: 12, font: tf[f] }); x += tf[f].widthOfTextAtSize(t, 12); }
    }
    return plead.save();
    };
    const formBytes = await form.save(), pleadBytes = await pleading(true), unreadBytes = await pleading(false), rowBytes = await pleading(false, true);
    const tightBytes = await pleading(false, true, { pitch: 12 }), imageBytes = await pleading(false, true, { image: true });
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry("Case Form Look", { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle("Case Form Look", { create: true });
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(dir, "Sample Form.pdf", formBytes);
    await put(dir, "Sample Pleading.pdf", pleadBytes);
    await put(dir, "Sample Unread Pleading.pdf", unreadBytes);
    await put(dir, "Sample Row Pleading.pdf", rowBytes);
    await put(dir, "Sample Tight Pleading.pdf", tightBytes);
    await put(dir, "Sample Image Pleading.pdf", imageBytes);
    // …and each poor scan's export without its numbers, beside the same PDF.
    for (const [n, b] of [["Unread", unreadBytes], ["Row", rowBytes], ["Tight", tightBytes]]) await put(dir, `Sample ${n} Bare.pdf`, b);
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    await put(text, "Sample Form.txt", FORM_TEXT);
    await put(text, "Sample Pleading.txt", PLEAD_TEXT);
    await put(text, "Sample Unread Pleading.txt", PLEAD_TEXT);
    await put(text, "Sample Row Pleading.txt", PLEAD_ROW_TEXT);
    await put(text, "Sample Tight Pleading.txt", PLEAD_ROW_TEXT);
    await put(text, "Sample Image Pleading.txt", PLEAD_ROW_TEXT);
    const bare = (t) => t.split("\n").map((l) => (/^[ \d]\d/.test(l) ? l.slice(2).replace(/^  /, "") : l)).join("\n");
    await put(text, "Sample Unread Bare.txt", bare(PLEAD_TEXT));
    await put(text, "Sample Row Bare.txt", bare(PLEAD_ROW_TEXT));
    await put(text, "Sample Tight Bare.txt", bare(PLEAD_ROW_TEXT));
    await window.__textReaderAdoptFolder(dir);
    window.__formLookPdfs = { "Sample Form.pdf": formBytes, "Sample Pleading.pdf": pleadBytes, "Sample Unread Pleading.pdf": unreadBytes, "Sample Row Pleading.pdf": rowBytes, "Sample Tight Pleading.pdf": tightBytes, "Sample Image Pleading.pdf": imageBytes, "Sample Unread Bare.pdf": unreadBytes, "Sample Row Bare.pdf": rowBytes, "Sample Tight Bare.pdf": tightBytes };
    return { placed };
  }, { FORM, STAMP, PLEAD_BODY, PLEAD_PLAIN, PLEAD_FACES, FORM_TEXT, PLEAD_TEXT, PLEAD_ROW_TEXT, SPLIT_AT, INDENTED, JUSTIFIED, CAPTION });

  /** Open an export beside its PDF and wait for its page to be laid on the grid. */
  async function openBeside(exportName, pdfName) {
    await page.evaluate((n) => window.__textReaderOpenDoc(n), exportName);
    await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
    await page.evaluate(async (pdfName) => {
      const f = new File([window.__formLookPdfs[pdfName]], pdfName, { type: "application/pdf" });
      await window.__textReaderPickPdfs([f]);
    }, pdfName);
    const sbs = await page.$("#sbs-toggle");
    if (!(await sbs.evaluate((b) => document.body.classList.contains("sbs") || b.classList.contains("on") || b.getAttribute("aria-pressed") === "true"))) await sbs.click();
    await page.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body.fixed"), null, { timeout: 15000 });
    await page.waitForTimeout(1500);
  }
  /**
   * Every word on the page drawn with a gap between two of its letters: the
   * grid moves pieces of a line, and must never open one up inside a word.
   * A gap is the next letter starting more than a fifth of the type past where
   * the one before it ends, as the screen draws them (transforms and all).
   */
  const letterGaps = (words = false) => page.evaluate((words) => {
    const out = [];
    const body = document.querySelector("#pages .tpage .page-body.fixed");
    if (!body) return ["no page on the grid"];
    for (const lt of body.querySelectorAll(":scope > .line > .lt")) {
      const chars = [];
      const walk = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const el = n.parentElement;
        if (el.closest(".gn, .gutter, .cb")) continue; // a margin number, a drawn checkbox
        const size = parseFloat(getComputedStyle(el).fontSize) || 12;
        for (let i = 0; i < n.data.length; i++) {
          const r = document.createRange();
          r.setStart(n, i); r.setEnd(n, i + 1);
          const b = r.getBoundingClientRect();
          chars.push({ ch: n.data[i], l: b.left, r: b.right, top: b.top, size });
        }
      }
      // …and two words one space apart in the file drawn further apart than a
      // wide space: a gap the PDF does not have.
      for (let i = 2; words && i < chars.length; i++) {
        const a = chars[i - 2], sp = chars[i - 1], c = chars[i];
        if (sp.ch !== " " || !/[\p{L}\p{N},.;:)]/u.test(a.ch) || !/[\p{L}\p{N}(]/u.test(c.ch) || (chars[i - 3] && chars[i - 3].ch === " ") || (chars[i + 1] && chars[i + 1].ch === " ")) continue;
        if (Math.abs(c.top - a.top) > c.size) continue;
        const gap = c.l - a.r;
        if (gap > 0.6 * c.size) out.push(`words "${chars.slice(Math.max(0, i - 8), i + 8).map((x) => x.ch).join("").trim()}" gap ${gap.toFixed(1)}px at ${c.size.toFixed(1)}px`);
      }
      for (let i = 1; i < chars.length; i++) {
        const a = chars[i - 1], c = chars[i];
        if (!/[\p{L}\p{N}]/u.test(a.ch) || !/[\p{L}\p{N}]/u.test(c.ch)) continue;
        const gap = c.l - a.r;
        if (gap > 0.2 * c.size || Math.abs(c.top - a.top) > c.size) {
          const word = chars.slice(Math.max(0, i - 6), i + 6).map((x) => x.ch).join("");
          out.push(`"${word.trim()}" ${a.ch}|${c.ch} gap ${gap.toFixed(1)}px at ${c.size.toFixed(1)}px`);
        }
      }
    }
    return out;
  }, words);
  /** The page laid out, as the screen has it: each line's box, rows, top and text. */
  const readPage = () => page.evaluate(async () => {
    const TD = await import("/viewer/textdoc.js");
    const sec = document.querySelector("#pages .tpage");
    const body = sec.querySelector(".page-body");
    const b = body.getBoundingClientRect();
    const lines = [...body.querySelectorAll(":scope > .line")].map((l) => {
      const lt = l.querySelector(":scope > .lt");
      const r = l.getBoundingClientRect();
      // Where each piece of the line stands on its baseline: a probe of no size
      // set at the head of each cell and of the line, read and taken out again.
      const bases = [];
      for (const host of [lt, ...lt.querySelectorAll(":scope > .cc")]) {
        const probe = document.createElement("span");
        probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
        host.insertBefore(probe, host === lt ? null : host.firstChild);
        bases.push(probe.getBoundingClientRect().top - b.top);
        probe.remove();
      }
      return {
        text: l.textContent, top: parseFloat(l.style.top), boxTop: r.top - b.top, boxBottom: r.bottom - b.top, lh: parseFloat(l.style.lineHeight),
        bases, num: l.classList.contains("num") ? parseInt(l.querySelector(".gn").textContent, 10) : null,
        face: lt.style.fontFamily, cells: lt.querySelectorAll(".cc").length, placed: lt.querySelectorAll(".cc[style*='min-width']").length,
        faced: lt.querySelectorAll(".fc").length, weight: lt.style.fontWeight || "",
      };
    });
    return { lines, width: sec.getBoundingClientRect().width, file: TD.serializeNodes(body), boxes: [...body.querySelectorAll(".cb")].map((c) => c.textContent) };
  });

  // ── a form page beside its PDF ──────────────────────────────────────────────
  if (!TOPS_ONLY) console.log("a form page beside its PDF");
  if (!TOPS_ONLY) {
    await openBeside("Sample Form.txt", "Sample Form.pdf");
    const laid = await readPage();
    const scale = laid.width / 612;
    check("the page reads back as the file: every line, in its order", laid.file === FORM_LINES.join("\n"), JSON.stringify(laid.file).slice(0, 200));
    const texted = laid.lines.filter((l) => l.text.trim() && !Number.isNaN(l.top));
    check("…and stands down the page in that order", texted.every((l, k) => k === 0 || l.top >= texted[k - 1].top), texted.map((l) => l.top.toFixed(1)).join(" "));
    const strays = texted.filter((l) => !(l.boxBottom - l.boxTop <= l.lh + 1 && l.bases.every((y) => Math.abs(y - l.bases[0]) <= 0.5) && l.bases[0] > l.boxTop && l.bases[0] <= l.boxBottom));
    check("each line stands on ONE row: its box one line high, every piece of it on the line's own baseline", strays.length === 0,
      strays.map((l) => `${l.text.trim().slice(0, 30)} box ${l.boxTop.toFixed(1)}–${l.boxBottom.toFixed(1)} lh ${l.lh} baselines ${l.bases.map((v) => v.toFixed(1)).join(",")}`).join(" | "));
    check("…the 9-point label on the 7-point footnote's line on that line's baseline, not raised to the row it was printed on",
      (() => { const l = laid.lines.find((x) => x.text.includes("Attorney or party")); return !!l && l.bases.length === 2 && Math.abs(l.bases[0] - l.bases[1]) <= 0.5; })());
    check("every checkbox is one piece, drawn whole", laid.boxes.length === 5 && laid.boxes.every((t) => t === "[   ]"), JSON.stringify(laid.boxes));
    // Where the pieces stand, and in what face and size.
    const where = await page.evaluate(({ wanted }) => {
      const body = document.querySelector("#pages .tpage .page-body");
      const left = body.getBoundingClientRect().left;
      return wanted.map(({ line, t }) => {
        const lt = body.querySelectorAll(":scope > .line")[line].querySelector(".lt");
        const walk = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const i = n.data.indexOf(t);
          if (i < 0) continue;
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + 1);
          const cs = getComputedStyle(n.parentElement);
          return { t, x: r.getBoundingClientRect().left - left, size: parseFloat(cs.fontSize), weight: cs.fontWeight, style: cs.fontStyle, family: cs.fontFamily };
        }
        return { t, missing: true };
      });
    }, { wanted: made.placed.map((p) => ({ line: p.line, t: p.t })) });
    // A piece the PDF sets APART (a column's gap before it) stands where the PDF
    // prints it; one set hard after the word before follows that word, a space
    // on, rather than open a gap between two words (pdfsync.standApart).
    const off = where.map((w, k) => ({ w, p: made.placed[k] })).filter(({ w, p }) => p.apart && (w.missing || Math.abs(w.x - p.x * scale) > 1.5));
    check("every piece the PDF sets apart stands where the PDF prints it — a label the export joins with one space too", off.length === 0,
      off.map(({ w, p }) => `${p.t}: ${w.missing ? "missing" : w.x.toFixed(1)} vs ${(p.x * scale).toFixed(1)}`).join(" | "));
    const sized = where.map((w, k) => ({ w, p: made.placed[k] })).filter(({ w, p }) => !w.missing && Math.abs(w.size - p.size * scale) > 0.05);
    check("…at its own size: the 9-point label on the 7-point footnote's line is 9-point", sized.length === 0,
      sized.map(({ w, p }) => `${p.t}: ${w.size.toFixed(2)} vs ${(p.size * scale).toFixed(2)}`).join(" | "));
    const faced = where.map((w, k) => ({ w, p: made.placed[k] })).filter(({ w, p }) => !w.missing
      && ((w.weight === "700") !== (p.font === "B") || (w.style === "italic") !== (p.font === "I") || !/Arial|Helvetica|Liberation Sans/.test(w.family)));
    check("…in the PDF's face: Helvetica as Arial, its bold bold, its oblique italic", faced.length === 0,
      faced.map(({ w, p }) => `${p.t}: ${w.weight} ${w.style} ${w.family.slice(0, 30)} vs ${p.font}`).join(" | "));
    const note = laid.lines.find((l) => l.text.startsWith("[fillable form"));
    check("a line the PDF does not print (PDF-Linker's note) keeps the reader's own face", !!note && !note.face, note ? note.face : "no note line");
    const formGaps = await letterGaps();
    check("no word on the form page drawn with a gap between its letters", formGaps.length === 0, formGaps.slice(0, 6).join(" | "));
    const look = await page.evaluate(() => window.__textReaderFormLook());
    if (!TOPS_ONLY) console.log(`        (planned ${look.planned} page(s) in ${look.plan.toFixed(1)} ms; placing passes took ${look.place.toFixed(1)} ms; fonts asked for ${look.fonts.pages} time(s), ${look.fonts.ms.toFixed(1)} ms)`);
    // Side by side shut: the page keeps the look, and the face, it had beside
    // the PDF — at the wider page the shut pane leaves, so each top is scaled.
    await page.click("#sbs-toggle");
    await page.waitForTimeout(800);
    const shut = await readPage();
    const grow = shut.width / laid.width;
    const moved = shut.lines.filter((l, k) => { const b = laid.lines[k];
      return !b || l.text !== b.text || l.face !== b.face || l.placed !== b.placed || l.faced !== b.faced || l.weight !== b.weight || Number.isNaN(l.top) !== Number.isNaN(b.top)
        || (!Number.isNaN(l.top) && Math.abs(l.top - b.top * grow) > 1); });
    check("side by side shut, the page keeps the side-by-side look — every piece's face, every run's, its place and row — the file unchanged",
      shut.file === FORM_LINES.join("\n") && shut.lines.some((l) => l.face) && moved.length === 0 && shut.boxes.length === 5,
      JSON.stringify(moved.slice(0, 4).map((l) => [l.text.trim().slice(0, 20), l.face.slice(0, 10), l.placed, l.top])));
    // …and a document opened with side by side already off is laid on its PDF too.
    await page.evaluate((n) => window.__textReaderOpenDoc(n), "Sample Form.txt");
    await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
    await page.evaluate(async () => {
      const f = new File([window.__formLookPdfs["Sample Form.pdf"]], "Sample Form.pdf", { type: "application/pdf" });
      await window.__textReaderPickPdfs([f]);
    });
    const opened = await page.waitForFunction(() => !document.body.classList.contains("sbs") && !!document.querySelector("#pages .tpage.matched .page-body.fixed"), null, { timeout: 15000 }).then(() => true, () => false);
    await page.waitForTimeout(800);
    const fresh = opened ? await readPage() : null;
    check("opened with side by side off, the page is laid on its PDF in the PDF's faces",
      !!fresh && fresh.lines.some((l) => l.face) && fresh.boxes.length === 5, fresh ? "" : "never laid on the grid");
    await page.click("#sbs-toggle"); // …and back on for the next document
    await page.waitForTimeout(400);
  }

  // ── a pleading page beside its PDF ─────────────────────────────────────────
  if (!TOPS_ONLY) console.log("a pleading page beside its PDF");
  {
    await openBeside("Sample Pleading.txt", "Sample Pleading.pdf");
    const laid = await readPage();
    // Where its numbers put the numbered lines: the PDF's own geometry, read as
    // the reader reads it (pdfsync.pleadingGeometry over pdf.js's items).
    const geom = await page.evaluate(async () => {
      const pdfjs = await import("/pdfjs/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/build/pdf.worker.mjs";
      const PS = await import("/viewer/pdfsync.js");
      const pdf = await pdfjs.getDocument({ data: window.__formLookPdfs["Sample Pleading.pdf"].slice() }).promise;
      const pg = await pdf.getPage(1);
      const v = pg.getViewport({ scale: 1 });
      const tc = await pg.getTextContent();
      const items = tc.items.filter((it) => it.str && it.transform).map((it) => ({ str: it.str, x: it.transform[4], top: v.height - (it.transform[5] + (it.height || 0)), w: it.width || 0, h: it.height || 0 }));
      const size = { w: v.width, h: v.height };
      const g = PS.pleadingGeometry(items, size);
      // The reader's right margin: the type's furthest right, held no wider than the left margin.
      return { ...g, right: Math.max(PS.docBodyRight([PS.pdfRows(items, size)]) || 0, size.w - g.bodyX) };
    });
    const scale = laid.width / 612;
    const numbered = laid.lines.filter((l) => l.num);
    if (TOPS_ONLY) {
      console.log(JSON.stringify(numbered.map((l) => [l.num, l.top])));
    } else {
      const offTop = numbered.filter((l) => Math.abs(l.top - (geom.y1 + (l.num - 1) * geom.pitch) * scale) > 0.01);
      check("every numbered line stands exactly at its number on the PDF", numbered.length === 28 && offTop.length === 0,
        offTop.map((l) => `${l.num}: ${l.top} vs ${((geom.y1 + (l.num - 1) * geom.pitch) * scale).toFixed(3)}`).join(" | "));
      check("…the pleading's lines are left where they were: in the reader's own family, no piece placed", laid.lines.every((l) => !l.face && !l.placed),
        JSON.stringify(laid.lines.filter((l) => l.face || l.placed).map((l) => l.text.slice(0, 20))));
      // …and in the PDF's weight and slant, run by run: each wanted word's
      // text node, and the style it is drawn in.
      const readFaces = () => page.evaluate(({ wanted }) => {
        const body = document.querySelector("#pages .tpage .page-body");
        return wanted.map(({ line, t }) => {
          const lt = body.querySelectorAll(":scope > .line")[line].querySelector(".lt");
          const walk = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
          for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            if (n.data.indexOf(t) < 0) continue;
            const cs = getComputedStyle(n.parentElement);
            return { t, weight: cs.fontWeight, style: cs.fontStyle, wrapped: n.parentElement.classList.contains("fc") };
          }
          return { t, missing: true };
        });
      }, { wanted: PLEAD_WANT });
      const offWant = (got) => got.filter((w, i) => w.missing || (w.weight === "700") !== !!PLEAD_WANT[i].bold || (w.style === "italic") !== !!PLEAD_WANT[i].italic);
      const sayOff = (off) => off.map((w) => `${w.t}: ${w.missing ? "missing" : w.weight + " " + w.style}`).join(" | ");
      const styled = await readFaces();
      check("…and in the PDF's weight and slant, run by run: the heading bold, the plaintiff's name bold and the rest of its line not, one word of the body in italics",
        offWant(styled).length === 0, sayOff(offWant(styled)));
      check("…a run inside a line in a wrapper of its own, the line's own face on the line", styled.some((w) => w.wrapped) && laid.lines.filter((l) => l.faced).length >= 2,
        JSON.stringify(styled));
      check("…its checkbox drawn whole on its numbered line", laid.boxes.length === 1 && laid.boxes[0] === "[ X ]", JSON.stringify(laid.boxes));
      check("…and the page reads back as the file", laid.file === PLEAD_LINES.join("\n"), JSON.stringify(laid.file).slice(0, 160));
      // The caption: the attorney block at the margin, the clerk's stamp at the right.
      const cap = await page.evaluate(() => {
        const body = document.querySelector("#pages .tpage .page-body.fixed");
        const L = body.getBoundingClientRect().left, R = body.getBoundingClientRect().right;
        const right = parseFloat(body.style.getPropertyValue("--body-r")) || 0;
        const at = (k, what) => {
          const lt = body.querySelectorAll(":scope > .line")[k].querySelector(".lt");
          const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) { const i = n.data.indexOf(what); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + what.length); const b = r.getBoundingClientRect(); return { l: b.left - L, r: b.right - L }; } }
          return null;
        };
        return { firm1: at(0, "Marigold"), stamp: at(0, "Electronically FILED by"), firm2: at(1, "TEASDALE"), edge: R - L - right };
      });
      check("…the caption's attorney block at the margin, line 2 too though the PDF's row at its height is the stamp's",
        !!cap.firm1 && !!cap.firm2 && Math.abs(cap.firm1.l - 72 * scale) < 1.5 && Math.abs(cap.firm2.l - 72 * scale) < 1.5, JSON.stringify(cap));
      check("…and the clerk's stamp on line 1 against the right margin", !!cap.stamp && Math.abs(cap.stamp.r - cap.edge) < 3, JSON.stringify(cap));
      const pleadGaps = await letterGaps(true);
      check("…and no word on it drawn with a gap between its letters, or between two of its words", pleadGaps.length === 0, pleadGaps.slice(0, 6).join(" | "));
      // The right margin is the PDF's: every line's text box ends where the PDF's body does, not at the paper's edge.
      const ends = await page.evaluate(() => {
        const body = document.querySelector("#pages .tpage .page-body.fixed");
        const left = body.getBoundingClientRect().left;
        return { margin: body.style.getPropertyValue("--body-r"), boxes: [...body.querySelectorAll(":scope > .line:not(.rl):not(.rr) > .lt")].map((lt) => lt.getBoundingClientRect().right - left) };
      });
      const past = ends.boxes.filter((r) => r > geom.right * scale + 1);
      check("…and its lines end at the PDF's right margin, not the paper's edge",
        geom.right > 400 && geom.right < 600 && !!ends.margin && ends.boxes.length > 0 && past.length === 0 && ends.boxes.some((r) => Math.abs(r - geom.right * scale) <= 1),
        `margin ${ends.margin}, PDF right ${(geom.right * scale).toFixed(1)}, ends ${[...new Set(ends.boxes.map((r) => r.toFixed(1)))].join(",")}`);
      // Side by side shut, the pleading keeps the look it had beside the PDF
      // (as the form does, above): its runs in the PDF's weight and slant, on
      // their numbers, the file unchanged.
      await page.click("#sbs-toggle");
      await page.waitForTimeout(800);
      const shut = await readPage();
      const kept = await readFaces();
      check("…side by side shut, the pleading keeps its runs' weight and slant, the file unchanged",
        shut.file === PLEAD_LINES.join("\n") && offWant(kept).length === 0 && shut.lines.filter((l) => l.faced).length === laid.lines.filter((l) => l.faced).length
          && shut.lines.every((l) => !l.face && !l.placed),
        sayOff(offWant(kept)) || JSON.stringify(shut.lines.filter((l) => l.face || l.placed).map((l) => l.text.slice(0, 20))));
    }
  }

  // ── a numbered export beside a PDF whose numbers are not text ─────────────
  // A poor scan, numbered in the file (# Number lines, or by hand). Its lines
  // stand where they stand WITHOUT the numbers — on the rows the PDF prints
  // their words on — and the numbers are drawn down the paper's margin apart
  // from them: 1 to 28 at one pitch, from the margin at the top to the one at
  // the foot (the owner: "Adding the numbers shouldnt move the text. It should
  // only add the number margins"; "The added numbers from number lines are not
  // uniformly spaced"; "the 1-28 only went halfway down the page"). Each is
  // laid against the same PDF's export without numbers, line by line.
  // (Only the open document's pages are read: the reel holds the documents
  // either side of it too, a pleading whose PDF's numbers are text among them.)
  const ownOf = async (name) => {
    const own = await page.evaluate((n) => { const m = window.__textReaderReel().members.find((x) => x.name === n); return m ? [m.from, m.from + m.count] : [0, 1e9]; }, name + ".txt");
    const ownSecs = `[...document.querySelectorAll("#pages .tpage")].filter((s) => +s.dataset.index >= ${own[0]} && +s.dataset.index < ${own[1]})`;
    return (js) => page.evaluate(new Function(`const secs = ${ownSecs}; ${js}`));
  };
  // Where each line's text stands on the page: its first character's middle
  // and left, from the page's top left. (Not a line a drawn checkbox opens:
  // where its box goes is the checkbox's own question, not the numbers'.)
  const TEXT_AT = `{
    const body = secs[0].querySelector(".page-body"), b = body.getBoundingClientRect();
    return [...body.querySelectorAll(":scope > .line")].map((l) => {
      if (l.querySelector(".cb")) return null;
      const lt = l.querySelector(".lt"), w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        const k = t.data.search(/\\S/);
        if (k < 0) continue;
        const r = document.createRange(); r.setStart(t, k); r.setEnd(t, k + 1);
        const q = r.getBoundingClientRect();
        return { text: lt.textContent.trim().slice(0, 24), mid: (q.top + q.bottom) / 2 - b.top, left: q.left - b.left };
      }
      return null;
    });
  }`;
  if (!TOPS_ONLY) for (const [name, lines] of [["Sample Unread Pleading", PLEAD_LINES], ["Sample Row Pleading", PLEAD_ROW_LINES], ["Sample Tight Pleading", PLEAD_ROW_LINES]]) {
    console.log(`a numbered export beside a PDF whose numbers are not text (${name})`);
    const bare = name.replace("Pleading", "Bare");
    await openBeside(bare + ".txt", bare + ".pdf");
    const before = await (await ownOf(bare))(TEXT_AT);
    await openBeside(name + ".txt", name + ".pdf");
    const onOwn = await ownOf(name);
    check("…laid by its words, as the page without numbers is, its numbers drawn down the margin apart from its lines",
      await onOwn(`return secs.length > 0 && secs.every((s) => s.querySelector(".page-body.fixed.own-margin") && s.querySelector(".page-inner > .margin-nums"));`));
    const after = await onOwn(TEXT_AT);
    const moved = after.map((a, k) => ({ a, b: before[k], k })).filter(({ a, b }) => !!a !== !!b || (a && (a.text !== b.text || Math.abs(a.mid - b.mid) > 1.5 || Math.abs(a.left - b.left) > 1.5)));
    check("…every line's text exactly where it stands without the numbers: adding them moves nothing",
      after.length === before.length && after.filter(Boolean).length > 10 && moved.length === 0,
      moved.slice(0, 4).map(({ a, b, k }) => `${k}: ${JSON.stringify(b)} → ${JSON.stringify(a)}`).join(" | "));
    const hidden = await onOwn(`return [...secs[0].querySelectorAll(".page-body > .line.num > .gutter")].every((g) => getComputedStyle(g).visibility === "hidden");`);
    check("…the lines' own numbers out of sight (kept: the file writes them)", hidden);
    // The margin: 1 to 28 at one pitch, in one column, down the length of the
    // page between its margins.
    const nums = await onOwn(`{
      const inner = secs[0].querySelector(".page-inner"), box = inner.getBoundingClientRect();
      const spans = [...inner.querySelectorAll(":scope > .margin-nums > span")].map((s) => { const r = s.getBoundingClientRect(); return { n: s.textContent, top: r.top - box.top, bottom: box.bottom - r.bottom, right: r.right - box.left, h: r.height }; });
      return { spans, inch: 72 * box.width / 612, selectable: getComputedStyle(inner.querySelector(".margin-nums")).userSelect };
    }`);
    const sp = nums.spans, steps = sp.slice(1).map((x, k) => x.top - sp[k].top);
    check("…the numbers 1 to 28, every one a pitch below the last, all one pitch",
      sp.map((x) => x.n).join() === Array.from({ length: 28 }, (_, k) => k + 1).join() && Math.max(...steps) - Math.min(...steps) < 0.05, steps.map((x) => x.toFixed(2)).join(" ").slice(0, 200));
    check("…down the length of the page: 1 within two inches of the top, 28 at least an inch above the foot and within an inch and two lines of it",
      sp.length === 28 && sp[0].top <= 2 * nums.inch + 1 && sp[27].bottom >= nums.inch - 1 && sp[27].bottom <= nums.inch + 2 * sp[27].h + 1, JSON.stringify({ head: sp[0] && sp[0].top, foot: sp[27] && sp[27].bottom, inch: nums.inch }));
    check("…in one column, left of the text, and never selected", new Set(sp.map((x) => x.right.toFixed(1))).size === 1 && sp[0].right < Math.min(...after.filter(Boolean).map((a) => a.left)) && nums.selectable === "none");
    const gaps = await letterGaps(true);
    check("no word drawn with a gap between its letters, nor between two words the file sets a space apart", gaps.length === 0, gaps.slice(0, 6).join(" | "));
    // A numbered page whose PDF's numbers are no text is a poor scan: every line
    // in the document's body type and the reader's own face, none of the scan's.
    const type = await onOwn(`return secs.flatMap((s) => [...s.querySelectorAll(".page-body.fixed > .line")])
      .filter((l) => l.querySelector(".lt").textContent.trim())
      .map((l) => { const lt = l.querySelector(".lt"); return [getComputedStyle(lt).fontSize, lt.style.fontFamily || "", lt.querySelectorAll("[style*='font']").length]; });`);
    check("…every line in one size, the document's, in the reader's own face — none of the scan's",
      new Set(type.map((t) => t[0])).size === 1 && type.every((t) => !t[1] && !t[2]), JSON.stringify([...new Set(type.map((t) => t.join(" ")))]).slice(0, 300));
    const file = await onOwn(`return import("/viewer/textdoc.js").then((TD) => TD.serializeNodes(secs[0].querySelector(".page-body")));`);
    check("…and the page reads back as the file, its numbers in it", file === lines.join("\n"), JSON.stringify(file).slice(0, 160));
  }
  // A scan with no text at all has no row to put a line on: laid on the paper's
  // numbers, 1 to 28 at one pitch down the length of the page.
  if (!TOPS_ONLY) {
    const name = "Sample Image Pleading";
    console.log(`a numbered export beside a PDF with no text (${name})`);
    await openBeside(name + ".txt", name + ".pdf");
    const onOwn = await ownOf(name);
    check("…laid as pleading paper, on the paper's numbers", await onOwn(`return secs.length > 0 && secs.every((s) => s.querySelector(".page-body.numbered.fixed") && !s.querySelector(".margin-nums"));`));
    const numTops = (await onOwn(`return [...secs[0].querySelectorAll(".page-body > .line.num")].map((l) => parseFloat(l.style.top));`));
    const steps = numTops.slice(1).map((t, k) => t - numTops[k]);
    check("…every number a pitch below the last, all one pitch", numTops.length === 28 && Math.max(...steps) - Math.min(...steps) < 0.05, steps.map((x) => x.toFixed(2)).join(" ").slice(0, 200));
    const foot = await onOwn(`{
      const sec = secs[0], b = sec.querySelector(".page-body"), box = sec.querySelector(".page-inner").getBoundingClientRect();
      const ns = [...b.querySelectorAll(":scope > .line.num")], r1 = ns[0].getBoundingClientRect(), r28 = ns[27].getBoundingClientRect();
      return { head: r1.top - box.top, gap: box.bottom - r28.bottom, inch: 72 * box.width / 612, line: r28.height };
    }`);
    check("…down the length of the page: line 1 within two inches of the top, line 28 at least an inch above the foot and within an inch and two lines of it",
      foot.head <= 2 * foot.inch + 1 && foot.gap >= foot.inch - 1 && foot.gap <= foot.inch + 2 * foot.line + 1, JSON.stringify(foot));
  }

  // ── typing into a page shown ⇄ Raw, on a page laid on its PDF ──────────
  // Side by side on and off: switched back to text, the page is what was typed.
  if (!TOPS_ONLY) for (const beside of [false]) {
    console.log(`typing ⇄ Raw on a page laid on its PDF, side by side ${beside ? "on" : "off"}`);
    await openBeside("Sample Pleading.txt", "Sample Pleading.pdf");
    if (!beside) { await page.click("#sbs-toggle"); await page.waitForTimeout(600); }
    const editOn = await page.evaluate(() => document.body.classList.contains("editing"));
    if (!editOn) { await page.evaluate(() => document.getElementById("edit-toggle").click()); await page.waitForTimeout(200); }
    // The pleading's own page (the reader may hold the document before it too).
    // (Found by its place in the reel: the poor scans' exports above carry its text too.)
    const SEC = `[...document.querySelectorAll("#pages .tpage")].find((s) => +s.dataset.index === window.__textReaderReel().members.find((m) => m.name === "Sample Pleading.txt").from)`;
    const sec = (js) => page.evaluate(new Function(`const sec = ${SEC}; ${js}`));
    // ONE TEXT, TWO VIEWS: typed on the page (Text view), it is in the raw sheet.
    const onPage = await sec(`
      const lt = [...sec.querySelectorAll(".page-body > .line > .lt")].find((x) => x.textContent === "Sampletown, CA 90000");
      if (!lt) return false;
      lt.closest(".page-body").focus();
      const n = lt.lastChild; const r = document.createRange(); r.setStart(n, n.data.length); r.collapse(true);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return true;`);
    if (onPage) await page.keyboard.type(" USA", { delay: 10 });
    await page.waitForTimeout(600);
    await sec(`sec.querySelector(".page-label .raw-page").click();`);
    await page.waitForTimeout(300);
    const rawHas = await sec(`return sec.querySelector(".raw-sheet .raw-text").textContent.split("\\n");`);
    check("typed in Text view, the edit is in ⇄ Raw: one text, two views", onPage && rawHas.includes(" 4  Sampletown, CA 90000 USA"), JSON.stringify(rawHas.slice(4, 6)));
    const typed = await sec(`
      const pre = sec.querySelector(".raw-sheet .raw-text");
      if (!pre || !pre.isContentEditable) return false;
      pre.focus();
      const w = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const k = n.data.indexOf("TEASDALE-VANE LAW");
        if (k >= 0) { const r = document.createRange(); r.setStart(n, k + "TEASDALE-VANE LAW".length); r.collapse(true); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return true; }
      }
      return false;`);
    if (typed) await page.keyboard.type(" LLP", { delay: 10 });
    // …and one of the two spaces after line 3's margin number taken out: the
    // number is still the margin's, set back in its column.
    const squeezed = await sec(`
      const pre = sec.querySelector(".raw-sheet .raw-text");
      const w = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const k = n.data.indexOf(" 3  100 Example Way");
        if (k >= 0) { const r = document.createRange(); r.setStart(n, k + 3); r.collapse(true); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return true; }
      }
      return false;`);
    if (squeezed) await page.keyboard.press("Delete");
    await page.waitForTimeout(100);
    await sec(`sec.querySelector(".page-label .raw-page").click();`);
    await page.waitForTimeout(800);
    const line2 = await sec(`const l = sec.querySelectorAll(".page-body > .line")[1]; return l ? (l.querySelector(".lt") || l).textContent : null;`);
    check("switched back to text, the page is what was typed into the raw sheet", typed && line2 === "TEASDALE-VANE LAW LLP", JSON.stringify({ typed, line2 }));
    const line3 = await sec(`const l = sec.querySelectorAll(".page-body > .line")[2]; return l ? { num: l.classList.contains("num"), gn: (l.querySelector(".gn") || {}).textContent, text: (l.querySelector(".lt") || l).textContent } : null;`);
    check("…a margin number typed with one space after it is still the margin's, its line numbered", squeezed && line3 && line3.num && line3.gn === " 3" && line3.text === "100 Example Way", JSON.stringify({ squeezed, line3 }));
    await sec(`sec.querySelector(".page-label .raw-page").click();`);
    await page.waitForTimeout(300);
    const raw3 = await sec(`return sec.querySelector(".raw-sheet .raw-text").textContent.split("\\n")[3];`);
    check("…and ⇄ Raw shows it set back in its column", raw3 === " 3  100 Example Way", JSON.stringify(raw3));
    // …and a save writes exactly what ⇄ Raw shows: the file on disk is the sheet.
    const sheet = await sec(`return sec.querySelector(".raw-sheet .raw-text").textContent;`);
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(1500);
    const disk = await page.evaluate(async () => {
      const top = await navigator.storage.getDirectory();
      const dir = await (await top.getDirectoryHandle("Case Form Look")).getDirectoryHandle("Text Files");
      return (await (await dir.getFileHandle("Sample Pleading.txt")).getFile()).text();
    });
    check("…and a save writes exactly what ⇄ Raw shows", disk.replace(/\n$/, "") === sheet, JSON.stringify({ disk: disk.slice(0, 120), sheet: sheet.slice(0, 120) }));
    await sec(`sec.querySelector(".page-label .raw-page").click();`);
    await page.waitForTimeout(300);
    if (!editOn) await page.evaluate(() => document.getElementById("edit-toggle").click());
    if (!beside) await page.click("#sbs-toggle");
    await page.waitForTimeout(300);
  }

  if (!TOPS_ONLY) check("no error on the page", errors.length === 0, errors.join(" | "));
} catch (e) {
  fails++;
  console.log(`  FAIL  the test itself threw: ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill("SIGTERM");
}
if (!TOPS_ONLY) console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails && !TOPS_ONLY ? 1 : 0);
