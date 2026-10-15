// Browser test for one redaction mark reaching every place its words stand,
// and for Find standing clear of the Redact bar (viewer/viewer.js,
// viewer/find.js, viewer/text-reader.js, redact.spreadPhrase / phraseHits /
// coveredBy).
//
//   1. The PDF viewer: a selection marked on page 1 marks the same words on
//      page 3, any case, and not inside a longer word; Ctrl+F with the Redact
//      tool on opens Find below the Redact bar rather than over it, with a
//      Redact all button that marks Find's matches.
//   2. The text reader: a drag over a name in the PDF beside the export marks
//      it in that PDF's other pages AND in the case folder's other PDF.
//
// Run: node test-redact-spread.mjs   (from the repo root)
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

let fails = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        got : ${JSON.stringify(got)}`);
    console.log(`        want: ${JSON.stringify(want)}`);
  }
}
const truthy = (label, v) => check(label, !!v, true);

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
    const up = await new Promise((resolve) => {
      const c = net.connect(port, "127.0.0.1", () => { c.end(); resolve(true); });
      c.on("error", () => resolve(false));
    });
    if (up) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base: `http://127.0.0.1:${port}`, stop: () => { try { proc.kill("SIGTERM"); } catch { /* gone */ } } };
}

/** A PDF of one page per entry, each entry's lines set down the page, built by hand. */
function pdfPages(pages) {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", null];
  const kids = [];
  const font = 3;
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (const lines of pages) {
    const content = "BT /F1 14 Tf " + lines.map((l, i) => `1 0 0 1 72 ${700 - i * 24} Tm (${l}) Tj`).join(" ") + " ET";
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const c = objs.length;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    kids.push(objs.length);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Array.from(Buffer.from(out, "latin1"));
}

let srv = null, browser = null;
async function newPage(url) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const log = { errors: [], toasts: [] };
  page.on("pageerror", (e) => log.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) log.errors.push("console: " + m.text()); });
  await page.goto(srv.base + url);
  return { context, page, log };
}
async function watchToasts(r, id) {
  await r.page.exposeFunction("__testToast", (t) => r.log.toasts.push(t));
  await r.page.evaluate((id) => {
    const el = document.getElementById(id);
    new MutationObserver(() => { const t = el.textContent.trim(); if (t) window.__testToast(t); }).observe(el, { childList: true, characterData: true, subtree: true });
  }, id);
}

const VIEWER_PDF = pdfPages([
  ["Plaintiff Corwin Ashdale filed this action.", "He lives in Ashdalewood."],
  ["Nothing about the party here."],
  ["Signed: CORWIN ASHDALE", "Witness: corwin ashdale"],
]);

async function run() {
  srv = await startServer();
  browser = await chromium.launch({ executablePath: CHROME });
  try {
    console.log("1. the PDF viewer");
    {
      const r = await newPage("/viewer/viewer.html");
      const p = r.page;
      await p.waitForFunction(() => typeof window.__pdfViewerLoadLocal === "function");
      await watchToasts(r, "toast-host");
      await p.evaluate(async (bytes) => {
        const f = new File([new Uint8Array(bytes)], "Spread Test.pdf", { type: "application/pdf" });
        await window.__pdfViewerLoadLocal(f, null);
      }, VIEWER_PDF);
      await p.waitForFunction(() => document.querySelectorAll(".page-wrapper .textLayer span").length >= 4, null, { timeout: 15000 });
      await p.waitForTimeout(800);
      await p.evaluate(() => document.getElementById("redact-toggle").click());
      await p.waitForTimeout(300);
      // Select "Corwin Ashdale" on page 1 and let go, as a drag would.
      await p.evaluate(() => {
        const layer = document.querySelector('.page-wrapper[data-page-number="1"] .textLayer');
        const span = [...layer.querySelectorAll("span")].find((s) => s.textContent.includes("Corwin Ashdale"));
        const t = span.firstChild, i = t.data.indexOf("Corwin Ashdale");
        const range = document.createRange();
        range.setStart(t, i); range.setEnd(t, i + "Corwin Ashdale".length);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
      await p.waitForTimeout(600);
      const boxes = () => p.evaluate(() => Object.fromEntries([1, 2, 3].map((n) => [n, document.querySelectorAll(`.page-wrapper[data-page-number="${n}"] .redactLayer .redact-rect`).length])));
      check("marked on page 1 by hand, and on page 3 twice (capitals and lower case); none on page 2", await boxes(), { 1: 1, 2: 0, 3: 2 });
      check("the bar counts three boxes on two pages", await p.evaluate(() => document.getElementById("redact-state").textContent), "3 boxes on 2 pages.");
      truthy("a toast says where else it was marked", r.log.toasts.some((t) => /also marked in 2 other places/.test(t)));
      // The same mark again: nothing new, nothing doubled.
      await p.evaluate(() => {
        const layer = document.querySelector('.page-wrapper[data-page-number="3"] .textLayer');
        const span = [...layer.querySelectorAll("span")].find((s) => s.textContent.includes("CORWIN ASHDALE"));
        const t = span.firstChild, i = t.data.indexOf("CORWIN ASHDALE");
        const range = document.createRange();
        range.setStart(t, i); range.setEnd(t, i + 14);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
      await p.waitForTimeout(600);
      check("marking a marked place again spreads nothing more", await p.evaluate(() => document.getElementById("redact-state").textContent), "4 boxes on 2 pages.");

      // Find, with the Redact tool on.
      await p.mouse.click(5, 450);
      await p.keyboard.press("Control+f");
      await p.waitForTimeout(400);
      const geo = await p.evaluate(() => {
        const a = document.getElementById("find-bar").getBoundingClientRect();
        const b = document.getElementById("redact-bar").getBoundingClientRect();
        return { open: !document.getElementById("find-bar").hidden, overlap: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top, below: a.top >= b.bottom, redactAll: !document.getElementById("find-redact").hidden };
      });
      truthy("Ctrl+F opens Find with Redact on", geo.open);
      check("…clear of the Redact bar", geo.overlap, false);
      truthy("…with Redact all on it", geo.redactAll);
      await p.keyboard.type("Ashdalewood");
      await p.waitForTimeout(500);
      await p.evaluate(() => document.getElementById("find-redact").click());
      await p.waitForTimeout(400);
      check("Redact all marks Find's match", (await boxes())[1], 2);
      // A narrow window: the Redact bar wraps, and Find still stands clear of it.
      await p.setViewportSize({ width: 900, height: 800 });
      await p.waitForTimeout(500);
      const narrow = await p.evaluate(() => {
        const a = document.getElementById("find-bar").getBoundingClientRect();
        const b = document.getElementById("redact-bar").getBoundingClientRect();
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      });
      check("…and in a narrow window", narrow, false);
      // Redact off: Find goes back to its own place, the button with it.
      await p.evaluate(() => document.getElementById("redact-done").click());
      await p.waitForTimeout(400);
      check("Redact closed: Find back at the top, Redact all gone", await p.evaluate(() => ({ top: document.getElementById("find-bar").style.top, hidden: document.getElementById("find-redact").hidden })), { top: "", hidden: true });
      check("no page errors", r.log.errors, []);
      await r.context.close();
    }

    console.log("2. the text reader: a mark spread over the case folder");
    {
      const r = await newPage("/viewer/text-reader.html");
      const p = r.page;
      await p.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
      await watchToasts(r, "toast");
      await p.evaluate(async ({ a, b, txt }) => {
        const top = await navigator.storage.getDirectory();
        try { await top.removeEntry("Spread Case", { recursive: true }); } catch { /* none yet */ }
        const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
        const dir = await top.getDirectoryHandle("Spread Case", { create: true });
        await put(dir, "A Complaint.pdf", new Uint8Array(a));
        await put(dir, "B Reply.pdf", new Uint8Array(b));
        const text = await dir.getDirectoryHandle("Text Files", { create: true });
        await put(text, "A Complaint.txt", txt);
        await window.__textReaderAdoptFolder(dir);
        await window.__textReaderOpenDoc("A Complaint.txt");
      }, {
        a: pdfPages([["Plaintiff Quentin Marlowe filed this action."], ["Quentin Marlowe signed it."]]),
        b: pdfPages([["The reply of QUENTIN MARLOWE follows."], ["Nothing here."], ["Quentin", "Marlowe"]]),
        txt: "====== Page 1 ======\nPlaintiff Quentin Marlowe filed this action.\n====== Page 2 ======\nQuentin Marlowe signed it.\n",
      });
      await p.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0, null, { timeout: 15000 });
      await p.waitForTimeout(800);
      await p.evaluate(() => document.getElementById("redact-btn").click());
      await p.waitForFunction(() => {
        const s = [...document.querySelectorAll(".pdf-slot .textLayer span")];
        return s.some((x) => x.textContent.includes("Quentin Marlowe"));
      }, null, { timeout: 15000 });
      await p.waitForTimeout(800);
      // A drag over the name, its own rectangle and a little beyond either side.
      const rect = await p.evaluate(() => {
        const span = [...document.querySelectorAll(".pdf-slot .textLayer span")].find((x) => x.textContent.includes("Quentin Marlowe"));
        span.scrollIntoView({ block: "center" });
        const t = span.firstChild, i = t.data.indexOf("Quentin Marlowe");
        const range = document.createRange();
        range.setStart(t, i); range.setEnd(t, i + "Quentin Marlowe".length);
        const q = range.getBoundingClientRect();
        return { x0: q.left - 2, x1: q.right + 2, y0: q.top - 2, y1: q.bottom + 2 };
      });
      await p.mouse.move(rect.x0, rect.y0);
      await p.mouse.down();
      await p.mouse.move((rect.x0 + rect.x1) / 2, rect.y1, { steps: 4 });
      await p.mouse.move(rect.x1, rect.y1, { steps: 4 });
      await p.mouse.up();
      await p.waitForFunction(() => /^\d+ box/.test(document.getElementById("rb-state").textContent) && !/Marking/.test(document.getElementById("rb-state").textContent), null, { timeout: 20000 });
      await p.waitForTimeout(1500);
      const state = await p.evaluate(() => document.getElementById("rb-state").textContent);
      check("the drag's own box, page 2 of the complaint, and the reply's two (capitals; a name across two lines)", state, "4 boxes on 4 pages of 2 documents: A Complaint.pdf (2), B Reply.pdf (2).");
      truthy("a toast says it went across the folder", r.log.toasts.some((t) => /also marked in 3 other places across 2 of the folder's 2 PDFs/.test(t)));
      check("no page errors", r.log.errors, []);
      await r.context.close();
    }
  } finally {
    if (browser) await browser.close();
    if (srv) srv.stop();
  }
  console.log(`\n${"=".repeat(60)}\nFAILURES: ${fails}`);
  process.exit(fails ? 1 : 0);
}
run().catch((e) => { console.error(e); if (srv) srv.stop(); process.exit(1); });
