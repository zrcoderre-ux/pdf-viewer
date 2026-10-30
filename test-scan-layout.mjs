// Browser test for a SCANNED page beside its PDF (pdfsync.scanLayout,
// text-reader.js scanPage and scanTypeSize): a dense lease page whose PDF text
// is an OCR layer, sized line by line, and whose export is the run's own
// reading of it (its header's REVIEW clause says the OCR layer was CORRECTED),
// so that a run of its lines shares too few words with any row to be matched
// and one line's words stand on a row three lines down. The owner, of such a
// page: lines a third of a page apart, others crushed to a few pixels, each
// line in its own size and run off the right edge — "When it creates this
// level of spacing issues, and font size problems, it ceases to be useful."
//
// Checked: every line in one size; the lines down the page about a line
// apart, none crushed and no gap of several; every line on the paper and
// across it inside the PDF's text; the page the paper's height. And a page
// the export does not mark (a born-digital PDF) is laid out as before.
//
// Run: node test-scan-layout.mjs   (from the repo root)
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

// Fifty lines of a lease, 12 points apart from 90, each about as wide as the
// PDF's text; the OCR's rows each in a size of its own, 9 to 13 points.
const W = ["lessee", "lessor", "premises", "sublease", "assignment", "consent", "covenant", "condition", "obligation", "performed",
  "provisions", "default", "notice", "paragraph", "option", "writing", "transfer", "assignee", "sublessee", "rent"];
const line = (i) => {
  let s = `${i}.`;
  for (let k = 0; s.length < 92; k++) s += ` ${W[(i * 7 + k * 3) % 20]}`;
  return s;
};
const garble = (t) => t.split(" ").map((w, k) => (k % 4 === 3 ? w : w.replace(/[aeiou]/g, "x") + "q")).join(" ");
const N = 50, TOP = 90, PITCH = 12;
const SIZES = [9, 13, 10, 12, 9.5, 13, 11, 12.5, 9, 13];

function build({ review }) {
  const exp = [], pdf = [];
  for (let i = 0; i < N; i++) {
    exp.push(line(i));
    // Lines 20-33 the run read again: the PDF's OCR shares a word in four.
    const t = i >= 20 && i < 34 ? garble(line(i)) : line(i);
    pdf.push([t, TOP + i * PITCH, SIZES[i % 10]]);
  }
  // …and line 22's words on line 25's row, a fragment of a leaning line.
  pdf[25][0] = line(22);
  const header = review ? "====== Page 1 — REVIEW: 160 word(s) of this page's OCR layer were CORRECTED to this run's own reading ======" : "====== Page 1 ======";
  return { text: [header, ...exp].join("\n") + "\n", pdf };
}

async function open(browser, base, { text, pdf }, { turned = false } = {}) {
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
  await page.goto(base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder);
  await page.evaluate(async (text) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry("Case Scan Layout", { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle("Case Scan Layout", { create: true });
    const t = await dir.getDirectoryHandle("Text Files", { create: true });
    const w = await (await t.getFileHandle("Lease.txt", { create: true })).createWritable(); await w.write(text); await w.close();
    await window.__textReaderAdoptFolder(dir);
    await window.__textReaderOpenDoc("Lease.txt");
  }, text);
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.evaluate(async ({ rows, turned }) => {
    const { PDFDocument, StandardFonts, degrees } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const pg = doc.addPage([612, 792]);
    // (`turned`: the page stored upside down and shown upright by /Rotate 180,
    // as a scanner leaves a sheet fed the wrong way up — each line drawn
    // turned half round, from the far corner.)
    if (turned) pg.setRotation(degrees(180));
    // Each row squeezed to the width the scan prints it at, as an OCR layer's
    // words are stretched to their boxes: its size is the OCR's, its width the page's.
    for (const [t, y, size, x] of rows) {
      // (A cell of a table, `x` its left: drawn at its size, as its OCR read it.)
      const fit = x != null ? size : Math.min(size, size * 468 / font.widthOfTextAtSize(t, size));
      if (turned) pg.drawText(t, { x: 612 - 72, y, size: fit, font, rotate: degrees(180) });
      else pg.drawText(t, { x: x != null ? x : 72, y: 792 - y, size: fit, font });
    }
    await window.__textReaderPickPdfs([new File([await doc.save()], "Lease.pdf", { type: "application/pdf" })]);
  }, { rows: pdf, turned });
  await page.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body.fixed"), null, { timeout: 15000 });
  await page.waitForTimeout(1000);
  const sbs = await page.$("#sbs-toggle");
  if (!(await sbs.evaluate((b) => b.getAttribute("aria-pressed") === "true"))) await sbs.click();
  await page.waitForTimeout(2000);
  const got = await page.evaluate(() => {
    const body = document.querySelector("#pages .tpage .page-body");
    const br = body.getBoundingClientRect();
    const scale = br.width / 612;
    const lines = [...body.querySelectorAll(":scope > .line")].filter((l) => l.textContent.trim()).map((l) => {
      const lt = l.querySelector(":scope > .lt") || l;
      const r = document.createRange();
      r.selectNodeContents(lt);
      const tr = r.getBoundingClientRect();
      return { top: (l.getBoundingClientRect().top - br.top) / scale, size: parseFloat(getComputedStyle(lt).fontSize) / scale, right: (tr.right - br.left) / scale, text: l.textContent };
    });
    return { height: br.height / scale, lines };
  });
  return { ...got, errors, close: () => page.context().close() };
}

const srv = await startServer();
const browser = await launchBrowser(chromium, CHROME);
try {
  console.log("a scanned page the run read again (its REVIEW clause)");
  const r = await open(browser, srv.base, build({ review: true }));
  const sizes = r.lines.map((l) => Math.round(l.size * 100) / 100);
  check("every line in one size", new Set(sizes).size === 1, JSON.stringify([...new Set(sizes)]));
  const steps = r.lines.slice(1).map((l, k) => l.top - r.lines[k].top);
  const size = sizes[0];
  check("the lines down the page in order, none crushed onto the one above", steps.every((s) => s >= size * 1.2 * 0.85), JSON.stringify(steps.map((s) => Math.round(s * 10) / 10)));
  check("…and no gap of several lines between two", steps.every((s) => s <= PITCH * 2), JSON.stringify(steps.map((s) => Math.round(s * 10) / 10)));
  // (A row's top is its baseline less its type; a line's box a little over its type.)
  const rowTop = (i) => TOP + i * PITCH - SIZES[i % 10];
  check("…the first and last where the PDF prints them", Math.abs(r.lines[0].top - rowTop(0)) <= 6 && Math.abs(r.lines[N - 1].top - rowTop(N - 1)) <= 6,
    `${Math.round(r.lines[0].top)}, ${Math.round(r.lines[N - 1].top)}`);
  check("every line across the page inside the PDF's text, none cut off at the edge", r.lines.every((l) => l.right <= 540 + 6), JSON.stringify(r.lines.map((l) => Math.round(l.right)).filter((x) => x > 546)));
  check("the page the paper's height", Math.round(r.height) === 792, String(r.height));
  check("no page errors", r.errors.length === 0, r.errors.join(" | "));
  await r.close();

  console.log("the same scan stored upside down, shown upright by /Rotate 180");
  {
    const t = await open(browser, srv.base, build({ review: true }), { turned: true });
    check("its first line at the head of the page and its last at the foot, as shown",
      Math.abs(t.lines[0].top - rowTop(0)) <= 6 && Math.abs(t.lines[N - 1].top - rowTop(N - 1)) <= 6, `${Math.round(t.lines[0].top)}, ${Math.round(t.lines[N - 1].top)}`);
    const ts = t.lines.slice(1).map((l, k) => l.top - t.lines[k].top);
    check("…the lines down the page in order", ts.every((s) => s > 0), JSON.stringify(ts.map((s) => Math.round(s))));
    check("…and the page the paper's height", Math.round(t.height) === 792, String(t.height));
    await t.close();
  }

  console.log("a scanned page of a ruled table (the owner: \"The text words are much smaller than the pdf\")");
  {
    // Four columns ruled all round, each row's cells wrapped to three or four
    // lines at 8 points on a 9-point leading, a rule between two rows and the
    // page number at the foot — the export's rows a hundred characters of
    // cells padded to their bars.
    const COLS = [[72, 26], [200, 24], [330, 40], [500, 8]];
    const ROWS = [
      [["EXIT ILLUMINATION"], ["Lack of 24-hour", "illumination in all", "required exit ways"], ["Missing or non-operational exit signage", "is a life-threatening violation that", "impedes egress and escape in case of", "fire or other emergency."], ["HIGH"]],
      [["EXPOSED WIRING"], ["Unapproved electrical", "wiring"], ["Exposed wiring is a potentially life-", "threatening condition that may cause an", "electrical fire or electric shock."], ["HIGH"]],
      [["FLOOR COVERING"], ["Floor covering defective,", "missing, or unsafe"], ["Failure to maintain safe and sanitary", "floor covering creates a minimally", "untenantable condition."], ["LOW"]],
      [["INSECT SCREENS"], ["Missing or defective", "insect screening."], ["Failure to maintain legally required", "insect screen may allow pests."], ["LOW"]],
    ];
    const rule = (a, m, z) => a + COLS.map(([, w]) => "─".repeat(w + 2)).join(m) + z;
    const exp = ["====== Page 1 — REVIEW: 40 word(s) of this page's OCR layer were CORRECTED to this run's own reading ======",
      "The violations and their severity levels can be seen below.", rule("┌", "┬", "┐")];
    const pdf = [["The violations and their severity levels can be seen below.", 100, 9, 72]];
    let y = 120;
    const lineTops = [];
    ROWS.forEach((cells, r) => {
      const n = Math.max(...cells.map((c) => c.length));
      for (let i = 0; i < n; i++) {
        exp.push("│" + cells.map((c, k) => " " + (c[i] || "").padEnd(COLS[k][1]) + " ").join("│") + "│");
        cells.forEach((c, k) => { if (c[i]) pdf.push([c[i], y + i * 9, 8, COLS[k][0] + 2]); });
        lineTops.push(y + i * 9 - 8);
      }
      y += n * 9 + 4;
      exp.push(r < ROWS.length - 1 ? rule("├", "┼", "┤") : rule("└", "┴", "┘"));
    });
    exp.push("", "", "                                   25 of 28");
    pdf.push(["25 of 28", 740, 10, 290]);
    const t = await open(browser, srv.base, { text: exp.join("\n") + "\n", pdf });

    // Of the lines with type: a table's rule line holds a thin slot of its
    // own (text-reader.js HAIR_ROOM), its size a third of a line, no type's.
    const typed = t.lines.filter((l) => !/^[\s\u2500-\u257F]*$/.test(l.text));
    const sz = [...new Set(typed.map((l) => Math.round(l.size * 10) / 10))];
    check("the type the PDF's size, not shrunk to fit the table's padded rows across the page", sz.length === 1 && sz[0] >= 7.5 && sz[0] <= 9, JSON.stringify(sz));
    const firstRow = t.lines[2], lastCell = t.lines[t.lines.length - 3];
    check("…its first row where the scan prints it, and its last within a line of it (each rule no line's height)",
      Math.abs(firstRow.top - lineTops[0]) <= 6 && Math.abs(lastCell.top - lineTops[lineTops.length - 1]) <= 9, `${Math.round(firstRow.top)} / ${lineTops[0]}, ${Math.round(lastCell.top)} / ${lineTops[lineTops.length - 1]}`);
    check("…and the page number at the foot, where the scan prints it", Math.abs(t.lines[t.lines.length - 1].top - (740 - 10)) <= 8, String(Math.round(t.lines[t.lines.length - 1].top)));
    check("no page errors", t.errors.length === 0, t.errors.join(" | "));
    await t.close();
  }

  console.log("a scanned invoice table, its cells on baselines a point apart (the owner: \"The viewer shows this chart as way too small\")");
  {
    // Thirty rows of five columns, unruled, 7.5-point cells on an 11-point
    // leading, each cell a point lower than the one before it, as a scan's
    // OCR reads a table that leans: pdfRows makes each cell a row of its own,
    // and the leading was read as the step between them. The export's columns
    // padded with spaces; a total row and a page number at the foot.
    const COLX = [96, 345, 395, 450, 505], PADS = [56, 14, 16, 18];
    const exp = ["====== Page 1 — REVIEW: 40 word(s) of this page's OCR layer were CORRECTED to this run's own reading ======", ""];
    const pdf = [];
    const head = ["Invoice", "Date", "Invoice Total", "Reimbursables", "No Contract"];
    exp.push(head.map((c, k) => (k < 4 ? c.padEnd(PADS[k]) : c)).join(""));
    head.forEach((c, k) => pdf.push([c, 140, 7, COLX[k]]));
    const tops = [];
    for (let r = 0; r < 30; r++) {
      const fee = `$${(1800 + 900 * (r % 3)).toLocaleString("en-US")}.00`;
      const cells = [`#${String(r + 1).padStart(2, "0")}-${100 + r}-23 - Safety Inspections ${W[r % 20]} ${W[(r * 7) % 20]}`, `${(r % 12) + 1}/${r + 1}/23`, fee, "", fee];
      exp.push(cells.map((c, k) => (k < 4 ? c.padEnd(PADS[k]) : c)).join(""));
      const y = 155 + r * 11;
      tops.push(y - 7.5);
      cells.forEach((c, k) => { if (c) pdf.push([c, y + k, 7.5, COLX[k]]); });
    }
    exp.push("Total of all invoices".padEnd(PADS[0] + PADS[1]) + "$78,370.00".padEnd(PADS[2]) + "$0.00".padEnd(PADS[3]) + "$78,370.00", "", "", "                                   56");
    ["Total of all invoices", "", "$78,370.00", "$0.00", "$78,370.00"].forEach((c, k) => { if (c) pdf.push([c, 155 + 30 * 11 + 6, 7.5, COLX[k]]); });
    pdf.push(["56", 740, 10, 300]);
    const t = await open(browser, srv.base, { text: exp.join("\n") + "\n", pdf });
    const sz = [...new Set(t.lines.map((l) => Math.round(l.size * 10) / 10))];
    check("the table in one size, near the PDF's, not half of it", sz.length === 1 && sz[0] >= 7, JSON.stringify(sz));
    const first = t.lines[1], last = t.lines[30];
    check("…its first and last rows where the scan prints them", Math.abs(first.top - tops[0]) <= 6 && Math.abs(last.top - tops[29]) <= 6,
      `${Math.round(first.top)} / ${tops[0]}, ${Math.round(last.top)} / ${tops[29]}`);
    check("…and across the page inside the PDF's text", t.lines.every((l) => l.right <= 560), JSON.stringify(t.lines.map((l) => Math.round(l.right)).filter((x) => x > 560)));
    check("no page errors", t.errors.length === 0, t.errors.join(" | "));
    await t.close();
  }

  console.log("the same page, a born-digital PDF (no REVIEW clause): laid out as before, by its rows");
  const b = await open(browser, srv.base, build({ review: false }));
  const bs = new Set(b.lines.map((l) => Math.round(l.size * 100) / 100));
  check("its rows' own sizes, as before", bs.size > 1, JSON.stringify([...bs]));
  check("no page errors", b.errors.length === 0, b.errors.join(" | "));
  await b.close();
} finally {
  await browser.close();
  srv.stop();
}
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
