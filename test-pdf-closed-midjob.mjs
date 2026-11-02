// Browser test for a PDF closed while a job of the PDF queue is reading it
// (viewer/text-reader.js, closePdfInfo / opListOf / PDF_JOB_STALL). pdf.js
// never answers a page's operator list once its document is destroyed under
// the request, the line grid asks for one inside its job, and the queue runs
// one job at a time: every PDF after it said "Loading…" for good. The owner,
// of a 14.7 MB exhibit set: the PDF column "says Loading... but never loads",
// the long-task report naming draws in flight for 3,500 seconds.
//
// Here the operator list is made to hang as pdf.js's does, the folder is
// changed (which closes every PDF), and the next folder's PDF must draw.
//
// Run: node test-pdf-closed-midjob.mjs   (from the repo root)
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

const WORDS = "the motion is granted in part and denied in part for the reasons stated on the record at the hearing".split(" ");
const lines = (seed) => Array.from({ length: 30 }, (_, k) => Array.from({ length: 9 }, (_, j) => WORDS[(seed + k * 7 + j * 3) % WORDS.length]).join(" "));
const exportOf = (ls) => "====== Page 1 ======\n" + ls.join("\n") + "\n";

const srv = await startServer();
const browser = await launchBrowser(chromium, CHROME);
try {
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) {
      if (v && typeof FileSystemHandle === "function" && v.handle instanceof FileSystemHandle) throw new DOMException("not kept in this test", "DataCloneError");
      return put.call(this, v, k);
    };
  });
  await page.goto(srv.base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
  /** A case folder with one export and its PDF, adopted and the export opened. */
  const openCase = (name, ls) => page.evaluate(async ({ name, ls }) => {
    const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pg = doc.addPage([612, 792]);
    ls.forEach((t, k) => pg.drawText(t, { x: 72, y: 720 - k * 20, size: 11, font }));
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry(name, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(name, { create: true });
    const put = async (d, n, data) => { const w = await (await d.getFileHandle(n, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(await dir.getDirectoryHandle("Text Files", { create: true }), "Order.txt", ls.length ? "====== Page 1 ======\n" + ls.join("\n") + "\n" : "");
    await put(dir, "Order.pdf", await doc.save());
    await window.__textReaderAdoptFolder(dir);
    await window.__textReaderOpenDoc("Order.txt");
  }, { name, ls });
  const sbsOn = async () => {
    const sbs = await page.$("#sbs-toggle");
    if (!(await sbs.evaluate((b) => b.getAttribute("aria-pressed") === "true"))) await sbs.click();
  };
  const drawn = (ms) => page.waitForFunction(() => !!document.querySelector("#pdf-pane .pdf-slot.ready, .pdf-inline.ready"), null, { timeout: ms }).then(() => true, () => false);

  // Every operator list from here hangs, as pdf.js's does for a document
  // destroyed under the request.
  await page.evaluate(async () => {
    const lib = await import("/pdfjs/build/pdf.mjs");
    const { PDFDocument } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const d = await PDFDocument.create(); d.addPage([100, 100]);
    const probe = await lib.getDocument({ data: await d.save() }).promise;
    const proto = Object.getPrototypeOf(await probe.getPage(1));
    window.__realOpList = proto.getOperatorList;
    window.__opListAsked = 0;
    proto.getOperatorList = function () { window.__opListAsked++; return new Promise(() => {}); };
    window.__opProto = proto;
  });
  await openCase("Case One", lines(1));
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await sbsOn();
  await page.waitForFunction(() => window.__opListAsked > 0, null, { timeout: 15000 }).catch(() => {});
  const asked = await page.evaluate(() => window.__opListAsked);
  check("the grid's job asked for an operator list, which hangs", asked > 0, `asked ${asked}`);
  check("…and the queue is held by it", await page.evaluate(() => window.__textReaderPdfQueue().busy));
  // Operator lists answer again; the one asked stays unanswered, as pdf.js leaves it.
  await page.evaluate(() => { window.__opProto.getOperatorList = window.__realOpList; });
  // Another folder: every PDF of this one is closed.
  const t0 = Date.now();
  await openCase("Case Two", lines(5));
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  const ok = await drawn(10000);
  check("the next folder's PDF is drawn, well inside the queue's stall limit", ok, `waited ${Date.now() - t0} ms`);
  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  srv.stop();
}
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
