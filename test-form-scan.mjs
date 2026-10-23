// Browser test: a SCANNED court form beside its PDF is drawn in the form's own
// type — its sizes, faces and rows — read off PDF-Linker's blank of it
// (viewer/form-templates.js, text-reader.js formTypeOver).
//
// The owner, in chat: "Use the forms in pdf-linker form templates in PDF+ such
// that it knows the correct font size and spacing for those forms." A scan's
// text is an OCR layer in an invisible font that names no face, sized by the
// recogniser line by line, so the reader drew a scanned form in its own type,
// uncut and unplaced. Here a filled CIV-110 is scanned (rendered, shrunk 3%,
// moved) and read by Tesseract, exactly as an OCR layer arrives; its export is
// written from the filled form's own text, row by row; and the page is opened
// side by side twice — once with the library, once with it unreachable (the
// reader as it was) — and the two compared.
//
// Run: node test-form-scan.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium),
// python3 with PyMuPDF, Tesseract, and a free port in 8130-8199; exits 0 with
// SKIP where any is missing. The values typed into the form are invented.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browser-for-tests.mjs";
import * as pdfjs from "./pdfjs/build/pdf.mjs";
import { pdfRows } from "./viewer/pdfsync.js";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const PW = "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = "/opt/pw-browsers/chromium";
const BLANK = path.join(REPO, "..", "PDF-Linker", "Form Templates", "CIV-110 Request for Dismissal.pdf");

function skip(why) { console.log(`SKIP: ${why}`); process.exit(0); }
if (!fs.existsSync(PW)) skip("Playwright is not installed at " + PW);
if (!fs.existsSync(CHROME)) skip("Chromium is not installed at " + CHROME);
if (spawnSync("tesseract", ["--version"]).status !== 0) skip("Tesseract is not installed");
if (spawnSync("python3", ["-c", "import pymupdf"]).status !== 0) skip("python3 has no PyMuPDF");
if (!fs.existsSync(BLANK)) skip("no PDF-Linker checkout beside this one, to scan its CIV-110 blank");
const { chromium } = await import(PW);

let fails = 0;
function check(label, ok, note = "") {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok && note) console.log(`        ${note}`);
}

// ── the scan ────────────────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "form-scan-"));
const MAKE = `
import sys, subprocess, pymupdf
from PIL import Image
blank, out = sys.argv[1], sys.argv[2]
doc = pymupdf.open(blank)
p = doc[0]
values = {"CaseNumber": "24STCV01234", "Name": "Dana Q. Ellery"}
for w in p.widgets():
    if w.field_type == pymupdf.PDF_WIDGET_TYPE_TEXT and w.rect.width > 80:
        for k, v in values.items():
            if k in (w.field_name or ""):
                w.field_value = v
                w.update()
                break
doc.bake()
one = pymupdf.open(); one.insert_pdf(doc, from_page=0, to_page=0)
one.save(out + "-filled.pdf")
pix = one[0].get_pixmap(matrix=pymupdf.Matrix(200 / 72, 200 / 72), colorspace=pymupdf.csGRAY)
im = Image.frombytes("L", (pix.width, pix.height), pix.samples)
page = Image.new("L", im.size, 255)
page.paste(im.resize((int(im.width * 0.97), int(im.height * 0.97))), (int(12 * 200 / 72), int(18 * 200 / 72)))
page.save(out + ".png", dpi=(200, 200))
subprocess.run(["tesseract", out + ".png", out, "--dpi", "200", "pdf"], check=True, capture_output=True)
`;
fs.writeFileSync(path.join(TMP, "make.py"), MAKE);
const made = spawnSync("python3", [path.join(TMP, "make.py"), BLANK, path.join(TMP, "scan")], { encoding: "utf8" });
if (made.status !== 0) { console.log(made.stderr); skip("could not make the scan"); }
const scanBytes = fs.readFileSync(path.join(TMP, "scan.pdf"));

// ── its export ──────────────────────────────────────────────────────────────
// The filled form's own text (the labels as the blank spells them, the values
// typed), its rows as the reader groups them, each piece at its column: the
// export of a scanned form whose labels PDF-Linker restored from the blank.
const U = 4.2, X0 = 36;
async function exportOf(bytes) {
  const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  const pg = await d.getPage(1);
  const H = pg.getViewport({ scale: 1 }).height;
  const tc = await pg.getTextContent();
  const items = tc.items.filter((it) => it.str && it.str.trim() && it.transform).map((it) => ({ str: it.str, x: it.transform[4], top: H - (it.transform[5] + (it.height || 0)), w: it.width || 0, h: it.height || 0 }));
  await d.destroy();
  const lines = pdfRows(items, { w: 612, h: H }).map((r) => {
    let s = "";
    for (const it of r.items) {
      let col = Math.max(0, Math.round((it.x - X0) / U));
      if (s.length && col <= s.length) col = s.length + 1;
      s = s.padEnd(col) + it.str.trim();
    }
    return s;
  });
  return "====== Page 1 ======\n" + lines.join("\n") + "\n";
}
const EXPORT = await exportOf(fs.readFileSync(path.join(TMP, "scan-filled.pdf")));

// ── the reader ──────────────────────────────────────────────────────────────
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

/** The page laid beside the scan: each text line's face, size and placed pieces. */
async function laidOut(browser, { library }) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept().catch(() => {}));
  if (!library) await page.route("**/form-templates/**", (r) => r.abort());
  await page.goto(BASE + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc && !!window.__textReaderPickPdfs);
  await page.evaluate(async ({ scan, text }) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry("Case Form Scan", { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle("Case Form Scan", { create: true });
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    const bytes = new Uint8Array(scan);
    await put(dir, "Sample Scan.pdf", bytes);
    await put(await dir.getDirectoryHandle("Text Files", { create: true }), "Sample Scan.txt", text);
    window.__scanBytes = bytes;
    await window.__textReaderAdoptFolder(dir);
  }, { scan: [...scanBytes], text: EXPORT });
  await page.evaluate((n) => window.__textReaderOpenDoc(n), "Sample Scan.txt");
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.evaluate(async () => { await window.__textReaderPickPdfs([new File([window.__scanBytes], "Sample Scan.pdf", { type: "application/pdf" })]); });
  const sbs = await page.$("#sbs-toggle");
  if (!(await sbs.evaluate((b) => document.body.classList.contains("sbs") || b.classList.contains("on") || b.getAttribute("aria-pressed") === "true"))) await sbs.click();
  await page.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body.fixed"), null, { timeout: 20000 });
  await page.waitForTimeout(2500);
  const got = await page.evaluate(() => {
    const body = document.querySelector("#pages .tpage .page-body.fixed");
    const sizeOf = (lt, t) => {
      const walk = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.data.includes(t)) { const cs = getComputedStyle(n.parentElement); return { size: parseFloat(cs.fontSize), weight: cs.fontWeight, family: cs.fontFamily }; }
      return null;
    };
    const lines = [...body.querySelectorAll(":scope > .line")].map((l) => {
      const lt = l.querySelector(":scope > .lt");
      return { text: l.textContent, face: lt ? lt.style.fontFamily : "", placed: lt ? lt.querySelectorAll(".cc[style*='min-width']").length : 0, lt };
    });
    const find = (t) => { const l = lines.find((x) => x.text.includes(t)); return l ? sizeOf(l.lt, t) : null; };
    return {
      lines: lines.map(({ text, face, placed }) => ({ text, face, placed })),
      heading: find("REQUEST FOR DISMISSAL"), label: find("STATE BAR NUMBER:"), value: find("24STCV01234"),
      name: find("Dana Q. Ellery"), nameLabel: find("NAME:"),
      valueLine: (lines.find((x) => x.text.includes("24STCV01234")) || {}).text,
      forms: window.__textReaderFormLook().forms, file: TD_serialize(body),
    };
    function TD_serialize(b) { return [...b.querySelectorAll(":scope > .line")].map((l) => l.textContent).join("\n"); }
  });
  await context.close();
  return { ...got, errors };
}

let browser = null;
try {
  browser = await launchBrowser(chromium, CHROME);
  const before = await laidOut(browser, { library: false });
  const after = await laidOut(browser, { library: true });
  const texted = (r) => r.lines.filter((l) => l.text.trim());
  const faced = (r) => texted(r).filter((l) => /Arial|Liberation Sans|Helvetica/.test(l.face)).length;

  console.log("the scan without the library (the reader as it was)");
  check("no form recognised", before.forms === 0, String(before.forms));
  check("its lines in the reader's own type: none in the form's face", faced(before) === 0, `${faced(before)} faced`);
  const was = before.heading && before.label ? before.heading.size / before.label.size : 0;
  console.log(`        (the heading was ${was.toFixed(2)} times the label, by the OCR's sizes; the form prints it 1.5 times)`);

  console.log("the scan with PDF-Linker's blank of it");
  check("recognised as its form", after.forms >= 1, String(after.forms));
  check("the page reads back as the file, every line in its order", after.file === EXPORT.replace(/^====== Page 1 ======\n/, "").replace(/\n$/, ""));
  const share = faced(after) / Math.max(1, texted(after).length);
  check("most of its lines in the form's face, Arial", share >= 0.8, `${faced(after)} of ${texted(after).length}`);
  check("its pieces placed where the form prints them", texted(after).filter((l) => l.placed).length >= 10, `${texted(after).filter((l) => l.placed).length} lines with placed pieces`);
  check("the heading in the form's bold", after.heading && after.heading.weight === "700", JSON.stringify(after.heading));
  const ratio = after.heading && after.label ? after.heading.size / after.label.size : 0;
  check("…at the form's sizes: the 9-point heading half again the 6-point label", Math.abs(ratio - 1.5) <= 0.08, `${ratio.toFixed(3)} (${JSON.stringify(after.heading)} / ${JSON.stringify(after.label)})`);
  const vRatio = after.value && after.label ? after.value.size / after.label.size : 0;
  check("…and the case number typed in its field at the field's 9 points", Math.abs(vRatio - 1.5) <= 0.08, `${vRatio.toFixed(3)} (${JSON.stringify(after.value)}) on ${JSON.stringify(after.valueLine)}`);
  const nRatio = after.name && after.nameLabel ? after.name.size / after.nameLabel.size : 0;
  check("…and the name typed a few points after its 6-point label at its field's 9, not the label's size", Math.abs(nRatio - 1.5) <= 0.08, `${nRatio.toFixed(3)} (${JSON.stringify(after.name)} / ${JSON.stringify(after.nameLabel)})`);
  check("no error on either page", before.errors.length === 0 && after.errors.length === 0, [...before.errors, ...after.errors].join(" | "));
} catch (e) {
  fails++;
  console.log(`  FAIL  the test itself threw: ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill("SIGTERM");
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
