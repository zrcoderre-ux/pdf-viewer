// Browser test: a rule straight in the export is straight in the reader, in
// either view (viewer/rules.js, fitRuleRows and pageGrid; text-reader.css,
// .fit and .rg).
//
// The owner, in chat: "Where the raw text has straight lines, those lines
// should still be straight in the viewer. Like a form box, or a separate
// statement. Parallel and perpendicular lines should still be parallel and
// perpendicular. Also, this should remain true even when using side by side
// view." So, on a separate statement on pleading paper and on a form page —
// its caption box over a notice, a divider and signature lines under them,
// two boxes down its right margin — each opened in the real reader, flowing
// and beside its PDF, every rule glyph is read back where the page draws it:
//
//   down    a bar at one column of the file, on line after line, is one x,
//           and each row's bar meets the next row's;
//   level   every run of one row is drawn at one height, the height its
//           corners turn at;
//   meet    a run beside a bar in the file touches that bar;
//   across  glyphs at one column on different lines — a box's side, the
//           divider under it, the next box's side — are one x;
//   whole   a line of rules alone is one line high: it never wraps;
//   crisp   every bar is one pixel wide and stands on a whole pixel of the
//           screen, so one column's bars are drawn the same pixel down the
//           page (fractional widths drew one row's bar two pixels wide).
//
// Run: node test-straight-rules.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium) and a
// free port in 8130-8199 for python3's http.server; exits 0 with SKIP where any
// is missing. The case folder is an OPFS directory, as in test-form-look.mjs;
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

function skip(why) { console.log(`SKIP: ${why}`); process.exit(0); }
if (!fs.existsSync(PW)) skip("Playwright is not installed at " + PW);
if (!fs.existsSync(CHROME)) skip("Chromium is not installed at " + CHROME);
const { chromium } = await import(PW);

let fails = 0;
function check(label, ok, note = "") {
  if (!ok) fails++;
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

const fill = (s, n) => (s + " ".repeat(n)).slice(0, n);
const H = (n) => "─".repeat(n);

// ── the form ────────────────────────────────────────────────────────────────
// As PDF-Linker draws a form's line art: a caption box of two columns (its
// inner bar at COL) over a notice of one (the foot of the caption, three bars,
// over a row of two — the row that used to draw its side a pixel out), a
// divider the width of the box, signature lines under its two columns (the
// right one a character past the box's side), and two boxes down the right
// margin, each with its own side at the box's.
const W = 96, COL = 60;
const FORM_LINES = [
  fill("", 86) + "SAMPLE-200",
  "┌" + H(COL - 1) + "┬" + H(W - COL - 1) + "┐",
  "│" + fill(" ATTORNEY OR PARTY WITHOUT ATTORNEY      STATE BAR NO.:", COL - 1) + "│" + fill("        FOR COURT USE ONLY", W - COL - 1) + "│",
  "│" + fill(" NAME:", COL - 1) + "│" + fill("", W - COL - 1) + "│",
  "├" + H(COL - 1) + "┤" + fill("", W - COL - 1) + "│",
  "│" + fill(" SUPERIOR COURT OF CALIFORNIA, COUNTY OF", COL - 1) + "│" + fill("", W - COL - 1) + "│",
  "├" + H(COL - 1) + "┼" + H(W - COL - 1) + "┤",
  "│" + fill("               REQUEST FOR SAMPLE ORDER", COL - 1) + "│" + fill(" CASE NUMBER:", W - COL - 1) + "│",
  "├" + H(COL - 1) + "┴" + H(W - COL - 1) + "┤",
  "│" + fill(" A conformed copy will not be returned by the clerk unless a method of return is provided.", W - 1) + "│",
  "└" + H(W - 1) + "┘",
  "1. TO THE CLERK: Please enter the sample order as follows:",
  "",
  H(44) + fill("", COL - 44) + H(W - COL + 1),
  fill("(TYPE OR PRINT NAME)", COL) + "             (SIGNATURE)",
  H(W + 1),
  fill("2. Costs (specify):", 76) + "┌" + H(W - 77) + "┐",
  fill("", 76) + "│" + fill(" $", W - 77) + "│",
  fill("", 76) + "└" + H(W - 77) + "┘",
  fill("3. Fees for an interpreter, as allowed by statute:", 76) + "┌" + H(W - 77) + "┐",
  fill("", 76) + "│" + fill(" $", W - 77) + "│",
  fill("", 76) + "└" + H(W - 77) + "┘",
];
const FORM_TEXT = "====== Page 1 ======\n" + FORM_LINES.join("\n") + "\n";
// The form's PDF: the export's grid on the page, a character U points wide from X0.
const U = 5.4, X0 = 36, PITCH = 12, Y0 = 50;

// ── the separate statement ──────────────────────────────────────────────────
// Pleading paper: twenty-eight numbers, the statement's grid of two columns
// (its divider at column BAR of the line, the number's four characters
// included), each fact's cells wrapped over numbered and unnumbered lines, and
// the rules between the facts on lines of their own.
const BAR = 46;
const sl = (n, a, b) => (n ? String(n).padStart(2) + "  " : "    ") + fill(a, BAR - 4) + "│" + (b ? " " + b : "");
const srule = (j) => "    " + H(BAR - 4) + j + H(40);
const SS_LINES = [
  " 1                  SEPARATE STATEMENT OF UNDISPUTED MATERIAL FACTS",
  " 2",
  srule("┬"),
  sl(3, "MOVING PARTY'S UNDISPUTED MATERIAL", "OPPOSING PARTY'S RESPONSE AND"),
  sl(0, "FACTS AND SUPPORTING EVIDENCE", "SUPPORTING EVIDENCE"),
  srule("┼"),
  sl(4, "1. Plaintiff leased the premises at 100", "Undisputed."),
  sl(0, "Example Way on March 1, 2021."),
  sl(5, "Supporting Evidence: Quillon Decl., ¶ 3."),
  srule("┼"),
  sl(6, "2. The lease required Defendant to", "Disputed. Section 7.2 places the"),
  sl(0, "maintain the roof in good repair.", "roof on the tenant. Orvelle"),
  sl(7, "Supporting Evidence: Ex. A, § 7.2.", "Decl., ¶ 6."),
  srule("┴"),
];
// …and an underline on a numbered line of its own: a rule line, its number in
// the margin, its run from the body margin like the statement's rules.
SS_LINES.push(" 8", " 9  " + H(30));
for (let n = 10; n <= 28; n++) SS_LINES.push(String(n).padStart(2));
const SS_TEXT = "====== Page 1 ======\n" + SS_LINES.join("\n") + "\n";

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

  // The PDFs, made in the page, and a folder for each (a folder of two would
  // read its exports as one reel).
  await page.evaluate(async ({ FORM_LINES, SS_LINES, FORM_TEXT, SS_TEXT, U, X0, PITCH, Y0, BAR }) => {
    const { PDFDocument, StandardFonts, rgb } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const RULES = /[─-╿]/;
    /** A line's text pieces, each [column, text]: runs of type two spaces or a rule glyph apart. */
    const pieces = (s) => {
      const out = [];
      const re = /[^\s─-╿]+(?: [^\s─-╿]+)*/g;
      let m;
      while ((m = re.exec(s))) out.push([m.index, m[0]]);
      return out;
    };
    /** The line art of `lines` drawn on `pg`: each run a line at its row's middle, each bar down its row. */
    const art = (pg, lines, xAt, yAt, half) => {
      lines.forEach((s, k) => {
        const y = yAt(k);
        const runs = s.matchAll(/─+/g);
        for (const m of runs) pg.drawLine({ start: { x: xAt(m.index), y }, end: { x: xAt(m.index + m[0].length), y }, thickness: 0.6, color: rgb(0, 0, 0) });
        for (let c = 0; c < s.length; c++) {
          if (!RULES.test(s[c]) || s[c] === "─") continue;
          const up = "│├┤┼└┘┴".includes(s[c]), down = "│├┤┼┌┐┬".includes(s[c]);
          pg.drawLine({ start: { x: xAt(c), y: up ? y + half : y }, end: { x: xAt(c), y: down ? y - half : y }, thickness: 0.6, color: rgb(0, 0, 0) });
        }
      });
    };
    const form = await PDFDocument.create();
    const fp = form.addPage([612, 792]);
    const helv = await form.embedFont(StandardFonts.Helvetica);
    const fx = (c) => X0 + c * U, fy = (k) => 792 - (Y0 + k * PITCH);
    FORM_LINES.forEach((s, k) => { for (const [c, t] of pieces(s)) fp.drawText(t, { x: fx(c), y: fy(k) - 3, size: 9, font: helv }); });
    art(fp, FORM_LINES, fx, fy, PITCH / 2);
    const ss = await PDFDocument.create();
    const sp = ss.addPage([612, 792]);
    const times = await ss.embedFont(StandardFonts.TimesRoman);
    // Numbered lines at their numbers, 24 points apart; the lines between at the half.
    let n = 0, y = 0;
    const ys = SS_LINES.map((s) => {
      const m = s.match(/^ ?(\d{1,2})(?: |$)/);
      if (m) { n = Number(m[1]); y = 792 - (100 + (n - 1) * 24); return y; }
      return y - 12;
    });
    const sx = (c) => 72 + (c - 4) * 5.6;
    SS_LINES.forEach((s, k) => {
      const m = s.match(/^ ?(\d{1,2})(?: |$)/);
      if (m) sp.drawText(m[1], { x: 46 - times.widthOfTextAtSize(m[1], 12), y: ys[k], size: 12, font: times });
      for (const [c, t] of pieces(s.slice(4))) sp.drawText(t, { x: sx(c + 4), y: ys[k], size: 10, font: times });
    });
    art(sp, SS_LINES, sx, (k) => ys[k] + 3, 6);
    const formBytes = await form.save(), ssBytes = await ss.save();
    const top = await navigator.storage.getDirectory();
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    window.__straight = {};
    for (const [folder, pdfName, bytes, txtName, txt] of [
      ["Case Straight Form", "Sample Form.pdf", formBytes, "Sample Form.txt", FORM_TEXT],
      ["Case Straight Statement", "Separate Statement.pdf", ssBytes, "Separate Statement.txt", SS_TEXT],
    ]) {
      try { await top.removeEntry(folder, { recursive: true }); } catch { /* none yet */ }
      const dir = await top.getDirectoryHandle(folder, { create: true });
      await put(dir, pdfName, bytes);
      const text = await dir.getDirectoryHandle("Text Files", { create: true });
      await put(text, txtName, txt);
      window.__straight[txtName] = { dir, pdfName, bytes };
    }
  }, { FORM_LINES, SS_LINES, FORM_TEXT, SS_TEXT, U, X0, PITCH, Y0, BAR });

  /** Every rule glyph of the open page, where the page draws it, by its column in the file. */
  const readRules = () => page.evaluate(async () => {
    const TD = await import("/viewer/textdoc.js");
    const body = document.querySelector("#pages .tpage .page-body");
    const b = body.getBoundingClientRect();
    const R = (r) => ({ l: r.left, r: r.right, t: r.top - b.top, b: r.bottom - b.top });
    const lines = [...body.querySelectorAll(":scope > .line")].map((line, i) => {
      const raw = TD.serializeNodes(line);
      const glyphs = [];
      let off = 0;
      for (const p of TD.ruleParts(raw)) { if (p.t !== "text") glyphs.push({ t: p.t, s: p.s, at: off }); off += p.s.length; }
      const barEls = [...line.querySelectorAll(".rb")];
      const bars = glyphs.filter((g) => g.t === "bar").map((g, k) => ({ col: g.at, s: g.s, ...(barEls[k] ? R(barEls[k].getBoundingClientRect()) : {}) }));
      // The runs as drawn: the grid's layers on a cell or a line (.rg), else the spans.
      const drawn = [];
      for (const el of [line.querySelector(":scope > .lt.rg"), ...line.querySelectorAll(":scope > .lt > .rc")]) {
        if (!el) continue;
        if (!el.classList.contains("rg")) { for (const rh of el.querySelectorAll(".rh")) { const r = R(rh.getBoundingClientRect()); drawn.push({ l: r.l, r: r.r, y: (r.t + r.b) / 2 }); } continue; }
        const r = R(el.getBoundingClientRect());
        const pos = el.style.backgroundPosition.split(",").map(parseFloat), size = el.style.backgroundSize.split(",").map(parseFloat);
        pos.forEach((x, k) => drawn.push({ l: r.l + x, r: r.l + x + size[k], y: (r.t + r.b) / 2 }));
      }
      const runs = glyphs.filter((g) => g.t === "h").map((g, k) => ({ col: g.at, len: g.s.length, ...(drawn[k] || {}) }));
      const lr = R(line.getBoundingClientRect());
      return { i, raw, bars, runs, drawn: drawn.length, top: lr.t, height: lr.b - lr.t, lh: parseFloat(getComputedStyle(line.querySelector(":scope > .lt") || line).lineHeight) || 0, rr: line.classList.contains("rr") && !line.classList.contains("rl") };
    });
    return { lines, file: TD.serializeNodes(body), width: body.getBoundingClientRect().width, left: b.left, dpr: window.devicePixelRatio || 1 };
  });

  /** The five properties, over one page as drawn. */
  function straightness(name, lines, dpr) {
    const DOWN = "│├┤┼┌┐┬", UP = "│├┤┼└┘┴";
    const off = { down: [], level: [], meet: [], across: [], whole: [], drawn: [], crisp: [] };
    for (const l of lines) if (l.runs.length !== l.drawn) off.drawn.push(`line ${l.i}: ${l.drawn} of ${l.runs.length}`);
    for (let i = 0; i + 1 < lines.length; i++) {
      for (const a of lines[i].bars) {
        if (!DOWN.includes(a.s)) continue;
        const c = lines[i + 1].bars.find((x) => x.col === a.col && UP.includes(x.s));
        if (!c) continue;
        const dx = Math.abs((a.l + a.r) / 2 - (c.l + c.r) / 2), gap = c.t - a.b;
        if (dx > 0.05 || gap > 0.6) off.down.push(`col ${a.col}, lines ${i}–${i + 1}: ${dx.toFixed(2)} across, ${gap.toFixed(2)} apart`);
      }
    }
    const ends = new Map();
    const note = (k, line, x) => { if (!ends.has(k)) ends.set(k, []); ends.get(k).push([line, x]); };
    for (const l of lines) {
      const ys = l.runs.map((r) => r.y);
      if (ys.length > 1 && Math.max(...ys) - Math.min(...ys) > 0.6) off.level.push(`line ${l.i}: ${ys.map((y) => y.toFixed(1)).join(" ")}`);
      for (const b of l.bars) if (ys.length && "┌┐┬└┘┴".includes(b.s) && Math.abs((b.t + b.b) / 2 - ys[0]) > 1.1) off.level.push(`line ${l.i}: ${b.s} turns at ${((b.t + b.b) / 2).toFixed(1)}, its rule at ${ys[0].toFixed(1)}`);
      for (const run of l.runs) {
        const before = l.bars.find((x) => x.col === run.col - 1), after = l.bars.find((x) => x.col === run.col + run.len);
        if (before && Math.abs(run.l - before.r) > 0.6) off.meet.push(`line ${l.i}: run at ${run.col} begins ${run.l.toFixed(1)}, its ${before.s} ends ${before.r.toFixed(1)}`);
        if (after && Math.abs(run.r - after.l) > 0.6) off.meet.push(`line ${l.i}: run at ${run.col} ends ${run.r.toFixed(1)}, its ${after.s} begins ${after.l.toFixed(1)}`);
        // A run drawn on through its bar's own pixel, where it opens on one or ends at one.
        note("L" + (before ? before.col : run.col), l.i, before ? before.l : run.l);
        note("R" + (after ? after.col + 1 : run.col + run.len), l.i, after ? after.r : run.r);
      }
      for (const b of l.bars) {
        note("B" + b.col, l.i, (b.l + b.r) / 2);
        if (Math.abs(b.r - b.l - 1) > 0.01 || Math.abs(b.l * dpr - Math.round(b.l * dpr)) > 0.05) off.crisp.push(`line ${l.i} col ${b.col}: ${b.l.toFixed(3)}+${(b.r - b.l).toFixed(3)}`);
      }
      if (l.rr && l.height > l.lh + 1) off.whole.push(`line ${l.i}: ${l.height.toFixed(1)} high, a line is ${l.lh.toFixed(1)}`);
    }
    for (const [k, v] of ends) {
      const xs = v.map((e) => e[1]);
      if (v.length > 1 && Math.max(...xs) - Math.min(...xs) > (k[0] === "B" ? 0.05 : 0.6)) off.across.push(`${k}: ${v.map((e) => `${e[0]}@${e[1].toFixed(1)}`).join(" ")}`);
    }
    check(`${name}: every run of the file is drawn by the grid`, !off.drawn.length, off.drawn.slice(0, 4).join(" | "));
    check(`${name}: down — a bar at one column is one x down its lines, and meets the next row's`, !off.down.length, off.down.slice(0, 4).join(" | "));
    check(`${name}: level — a row's runs at one height, where its corners turn`, !off.level.length, off.level.slice(0, 4).join(" | "));
    check(`${name}: meet — a run touches the bar beside it`, !off.meet.length, off.meet.slice(0, 4).join(" | "));
    check(`${name}: across — glyphs at one column on different lines are one x`, !off.across.length, off.across.slice(0, 4).join(" | "));
    check(`${name}: whole — a line of rules alone is one line high`, !off.whole.length, off.whole.slice(0, 4).join(" | "));
    check(`${name}: crisp — every bar a pixel wide, on a whole pixel`, !off.crisp.length, off.crisp.slice(0, 4).join(" | "));
  }

  /** Open an export, read it flowing, then beside its PDF. */
  async function both(txtName, expectFile, sbsCheck) {
    await page.evaluate(async (n) => { await window.__textReaderAdoptFolder(window.__straight[n].dir); await window.__textReaderOpenDoc(n); }, txtName);
    await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body .line").length > 0);
    await page.waitForTimeout(1200);
    const flow = await readRules();
    check(`${txtName}, flowing: the page reads back as the file`, flow.file === expectFile, JSON.stringify(flow.file).slice(0, 160));
    straightness(`${txtName}, flowing`, flow.lines, flow.dpr);
    await page.evaluate(async (n) => {
      const s = window.__straight[n];
      await window.__textReaderPickPdfs([new File([s.bytes], s.pdfName, { type: "application/pdf" })]);
    }, txtName);
    const sbs = await page.$("#sbs-toggle");
    if (!(await sbs.evaluate((b) => document.body.classList.contains("sbs") || b.classList.contains("on") || b.getAttribute("aria-pressed") === "true"))) await sbs.click();
    await page.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body.fixed"), null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    const laid = await readRules();
    check(`${txtName}, side by side: the page reads back as the file`, laid.file === expectFile, JSON.stringify(laid.file).slice(0, 160));
    straightness(`${txtName}, side by side`, laid.lines, laid.dpr);
    if (sbsCheck) await sbsCheck(laid);
    await sbs.click();
    await page.waitForTimeout(600);
  }

  console.log("a form page");
  await both("Sample Form.txt", FORM_LINES.join("\n"), async (laid) => {
    // Beside its PDF the box is the PDF's: each side and the inner bar where
    // the PDF draws its rule, the export's column on the PDF's grid.
    const scale = laid.width / 612;
    const cap = laid.lines[2].bars.map((b) => (b.l + b.r) / 2 - laid.left);
    const want = [0, COL, W].map((c) => (X0 + c * U) * scale);
    check("side by side, the caption's bars stand on the PDF's rules", cap.length === 3 && cap.every((x, k) => Math.abs(x - want[k]) <= 2),
      `${cap.map((x) => x.toFixed(1)).join(" ")} vs ${want.map((x) => x.toFixed(1)).join(" ")}`);
  });

  console.log("a separate statement on pleading paper");
  await both("Separate Statement.txt", SS_LINES.join("\n"));

  check("no error on the page", errors.length === 0, errors.join(" | "));
} catch (e) {
  fails++;
  console.log(`  FAIL  the test itself threw: ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill("SIGTERM");
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
