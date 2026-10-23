// Browser test for an exhibit's figures read as margin numbers
// (viewer/text-reader.js: marginRuns, scanGeom): an invoice whose lines open
// with a "25", a "1", an "8" and a "3" is `numbered` by its count, and its PDF
// carries no margin numbers. Laid as pleading paper it stood its "1" at line 1
// and crowded the forty lines above it over the page's top (the owner: "some
// of the text is being pushed up off the page"). Beside its PDF every line
// must stand on the page.
//
// Run: node test-stray-numbers.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium),
// python3 with openpyxl (to build the key) and a free port in 8130-8199 for
// python3's http.server; exits 0 with SKIP where any is missing. Every name
// and number in it is invented.

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
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passes++; else fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        got : ${JSON.stringify(got)}`);
    console.log(`        want: ${JSON.stringify(want)}`);
  }
}
const truthy = (label, v) => check(label, !!v, true);

// ── the server ───────────────────────────────────────────────────────────────
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
async function startServer() {
  let port = 0;
  for (let p = 8130; p <= 8199; p++) if (await portFree(p)) { port = p; break; }
  if (!port) skip("no free port in 8130-8199");
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: REPO, stdio: "ignore" });
  await waitPort(port);
  return { base: `http://127.0.0.1:${port}`, stop: () => { try { proc.kill("SIGTERM"); } catch { /* gone */ } } };
}

// ── the key, as a real .xlsx ────────────────────────────────────────────────
// On disk the exports carry the FAKES; the key turns them back on screen.
// "Ashdale" is bound on its own, so a name typed as "Ashdale" is offered.
function buildKey(rows, pinned = []) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "stray-numbers-")), "pseudonym_key.xlsx");
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
const KEY_BYTES = buildKey([
  ["person", "Corwin Ashdale", "Tobias Wrenfield", "", "", "spreadsheet", 4],
]);

const CASE = "Case Stray";
// The invoice as the export has it: its quantities' figures at the heads of lines.
const LINES = [
  "                                   Exhibits",
  "         Monarch & Professional Health Granite Cobalt",
  "                     Ashcombe Beaumont",
  "                     6521 Willow Ave.",
  "                     Los Angeles, CA",
  "Invoice #: RO-2025-03-04",
  "Date: June 19, 2025",
  "Bill To:                              Pay to:",
  "Danbury Crestline                     6521 Willow Ave.",
  "4185 Aspen Dr.                        Los Angeles, CA 90044",
  "Los Angeles, CA 90027                 Bank of Lightwell:",
  "                                      Account Number: 645827867198",
  "Description                 Amount",
  "1. Compensation for Caregiving March 2025",
  "March 1 to March 25                                   $48,387",
  "days",
  "25",
  "2. Tax check for year end 2024",
  "As you know, this check was written.                  $80,000",
  "tried to deposit it there wasn't enough money in",
  "the account and it was returned.",
  "3. As per agreement with Dr. Danbury Crestline,",
  "upon his death, additional compensation to be",
  "paid equal to 1 month's salary for every year",
  "worked, Worked from April 2046 to March",
  "2025.",
  "years",
  "at $40,000.00                                         $320,000.00",
  "year",
  " 1",
  "months",
  " 8  at $40,000.00 per month                           $26,666.00",
  "months",
  " 3  at $60,000.00 per month",
  "                                                      $15,000.00",
  "Please wire payment in the amount of",
  "                                                      $490,053.00",
  "Bank of Lightwell",
  "Account #: 327866090117",
  "Issued by;",
  "Ashcombe Beaumont",
];
const R = "====== Page 1 ======\n" + LINES.join("\n") + "\n";

async function run() {
  const srv = await startServer();
  const browser = await launchBrowser(chromium, CHROME);
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const p = await context.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
    p.on("dialog", (d) => d.accept().catch(() => {}));
    await p.goto(srv.base + "/viewer/text-reader.html");
    await p.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
    await p.evaluate(async ({ CASE, R, LINES, keyBytes }) => {
      const top = await navigator.storage.getDirectory();
      try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
      const dir = await top.getDirectoryHandle(CASE, { create: true });
      const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
      await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
      const text = await dir.getDirectoryHandle("Text Files", { create: true });
      await put(text, "R Exhibit.txt", R);
      // The PDF prints the invoice's lines down the page, no margin numbers.
      const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Courier);
      const pg = pdf.addPage([612, 792]);
      LINES.forEach((l, k) => { if (l.trim()) pg.drawText(l.trim(), { x: 40 + l.search(/\S/) * 6, y: 760 - k * 17, size: 10, font }); });
      await put(dir, "R Exhibit.pdf", await pdf.save());
      await window.__textReaderAdoptFolder(dir);
    }, { CASE, R, LINES, keyBytes: Array.from(KEY_BYTES) });
    await p.evaluate((n) => window.__textReaderOpenDoc(n), "R Exhibit.txt");
    await p.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
    const sbs = await p.$("#sbs-toggle");
    if (!(await sbs.evaluate((b) => b.getAttribute("aria-pressed") === "true"))) await sbs.click();
    await p.waitForFunction(() => !!document.querySelector("#pages .tpage.matched"), null, { timeout: 15000 });
    await p.waitForTimeout(2500);
    const got = await p.evaluate(() => {
      const sec = document.querySelector("#pages .tpage"), body = sec.querySelector(".page-body");
      const b = body.getBoundingClientRect(), s = sec.getBoundingClientRect();
      const lines = [...body.querySelectorAll(":scope > .line")].filter((l) => l.textContent.trim());
      const off = lines.filter((l) => { const r = l.getBoundingClientRect(); return r.top < b.top - 1 || r.bottom > s.bottom + 1; }).map((l) => l.textContent.trim());
      const tops = lines.map((l) => l.getBoundingClientRect().top);
      const outOfOrder = tops.filter((t, k) => k && t < tops[k - 1] - 1).length;
      return { numbered: body.classList.contains("numbered"), matched: sec.classList.contains("matched"), lines: lines.length, off, outOfOrder };
    });
    check("the invoice counts as numbered by its figures (the case under test)", got.numbered, true);
    check("…and is laid beside its PDF", got.matched, true);
    check("every line of it stands on the page, none crowded over its top", got.off, []);
    check("…each line below the one before it", got.outOfOrder, 0);
    check("no page errors", errors, []);
    await context.close();
  } finally {
    await browser.close();
    srv.stop();
  }
  console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
  process.exit(fails ? 1 : 0);
}
await run();
