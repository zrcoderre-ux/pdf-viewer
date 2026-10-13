// Browser test for files a PDF-Linker run changed under the reader and the
// viewer (viewer/text-reader.js, viewer/viewer.js): nothing is written over a
// newer copy. A save under a key the folder no longer holds is refused and the
// bar offers the folder read again; LEAKS.xlsx answered in Excel, or removed by
// a run, is not saved over or put back; New Real Values.txt keeps the lines the
// reader did not write; an export a run rewrote is not written over by an
// empty save; a lone file changed or renamed on disk is not written through
// its old handle; and the PDF viewer asks before saving over a PDF that
// changed on disk.
//
// Run: node test-stale-writes.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium),
// python3 with openpyxl (to build the key and the worksheet) and a free port
// in 8130-8199 for python3's http.server; exits 0 with SKIP where any is
// missing. The case folder is an OPFS directory, as in test-folder-save.mjs.
// Every name in it is invented.

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// ── the key and the worksheet, as real .xlsx ────────────────────────────────
function buildXlsx(name, sheet, head, rows) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "stale-writes-")), name);
  const py = `
import json, sys, openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = sys.argv[2]
ws.append(json.loads(sys.argv[3]))
for r in json.loads(sys.argv[4]): ws.append(r)
wb.save(sys.argv[1])
`;
  execFileSync("python3", ["-I", "-c", py, out, sheet, JSON.stringify(head), JSON.stringify(rows)]);
  return fs.readFileSync(out);
}
const KEY_HEAD = ["Category", "Real Value", "Replacement", "Context", "Status", "Source", "Occurrences"];
const KEY_ROWS = [
  ["person", "Corwin Ashdale", "Tobias Wrenfield", "", "", "spreadsheet", 3],
  ["entity", "Pellmont Motors", "Quarrow Motors", "", "", "spreadsheet", 2],
];
const KEY_BYTES = buildXlsx("pseudonym_key.xlsx", "Pseudonym Key", KEY_HEAD, KEY_ROWS);
// …the same key written again by a run that changed nothing in it (new bytes, new time).
const KEY_SAME = buildXlsx("pseudonym_key.xlsx", "Pseudonym Key", KEY_HEAD, KEY_ROWS);
// …and one a run rewrote: a name it faked since.
const KEY_MOVED = buildXlsx("pseudonym_key.xlsx", "Pseudonym Key", KEY_HEAD, KEY_ROWS.concat([["person", "Theo Brackwell", "Marlow Tenbury", "", "", "flagged", 1]]));
const LEAKS_HEAD = ["Value", "Fix? (yes/no)", "Context", "File", "Type", "Where (page:line)", "Notes"];
const LEAKS_BYTES = buildXlsx("LEAKS.xlsx", "LEAKS", LEAKS_HEAD, [["Gravenor", "", "Gravenor signed.", "A Complaint.pdf", "LEAK", "p.1", ""]]);
// …answered in Excel meanwhile.
const LEAKS_EXCEL = buildXlsx("LEAKS.xlsx", "LEAKS", LEAKS_HEAD, [["Gravenor", "no", "Gravenor signed.", "A Complaint.pdf", "LEAK", "p.1", ""]]);

// ── the case ────────────────────────────────────────────────────────────────
const CASE = "Case Stale";
const A = "====== Page 1 ======\nPlaintiff Tobias Wrenfield bought a vehicle from Quarrow Motors.\nGravenor signed.\n";
const A_RUN = "====== Page 1 ======\nPlaintiff Tobias Wrenfield bought a vehicle from Quarrow Motors.\nGravenor signed. Marlow Tenbury witnessed it.\n";
// New Real Values.txt as the folder is opened: a value the reader reads into
// its list, and a page list PDF-Linker reads that the list cannot hold.
const NRV = "Quell Harbor\ndid not ocr: Exhibit A.pdf | pages 3-5, 9\n";

/** A one-page PDF with `text` on it, built by hand: ASCII, so offsets are bytes. */
function pdfWith(text) {
  const content = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Array.from(Buffer.from(out, "latin1"));
}

// ── the browser ─────────────────────────────────────────────────────────────
let srv = null, browser = null;
async function newPage(url) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const log = { errors: [], toasts: [] };
  page.on("pageerror", (e) => log.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) log.errors.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto(srv.base + url);
  return { context, page, log, close: () => context.close() };
}
async function watchToasts(r, id) {
  await r.page.exposeFunction("__testToast", (t) => r.log.toasts.push(t));
  await r.page.evaluate((id) => {
    const el = document.getElementById(id);
    new MutationObserver(() => { const t = el.textContent.trim(); if (t) window.__testToast(t); }).observe(el, { childList: true, characterData: true, subtree: true });
  }, id);
}
/** The reader on the case folder, its document open (or, with `loose`, a lone file in a folder of its own). */
async function newReader({ loose = false } = {}) {
  const r = await newPage("/viewer/text-reader.html");
  await r.page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
  await watchToasts(r, "toast");
  await r.page.evaluate(async ({ CASE, A, NRV, keyBytes, leaksBytes, loose }) => {
    const top = await navigator.storage.getDirectory();
    for (const n of [CASE, "Loose"]) { try { await top.removeEntry(n, { recursive: true }); } catch { /* none yet */ } }
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    if (loose) {
      const dir = await top.getDirectoryHandle("Loose", { create: true });
      await put(dir, "A Complaint.txt", A);
      window.__case = dir;
      const h = await dir.getFileHandle("A Complaint.txt");
      await window.__textReaderLoadLocal(await h.getFile(), h);
      return;
    }
    const dir = await top.getDirectoryHandle(CASE, { create: true });
    await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    await put(dir, "LEAKS.xlsx", new Uint8Array(leaksBytes));
    await put(dir, "New Real Values.txt", NRV);
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    await put(text, "A Complaint.txt", A);
    window.__case = dir;
    await window.__textReaderAdoptFolder(dir);
    await window.__textReaderOpenDoc("A Complaint.txt");
  }, { CASE, A, NRV, keyBytes: Array.from(KEY_BYTES), leaksBytes: Array.from(LEAKS_BYTES), loose });
  await r.page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await r.page.waitForTimeout(800);
  return r;
}
/** A file of the case folder (path under it), its text — or null where it is not there. */
const readFile = (page, rel) => page.evaluate(async (rel) => {
  let d = window.__case;
  const parts = rel.split("/");
  try {
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
    return await (await (await d.getFileHandle(parts[parts.length - 1])).getFile()).text();
  } catch { return null; }
}, rel);
const readBytes = (page, rel) => page.evaluate(async (rel) => {
  try { return Array.from(new Uint8Array(await (await (await window.__case.getFileHandle(rel)).getFile()).arrayBuffer())); } catch { return null; }
}, rel);
/** A file of the case folder written as a run writes it (`data`: text or byte array); null removes it. */
const writeFile = (page, rel, data) => page.evaluate(async ({ rel, data }) => {
  let d = window.__case;
  const parts = rel.split("/");
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
  const name = parts[parts.length - 1];
  if (data == null) { await d.removeEntry(name); return; }
  const w = await (await d.getFileHandle(name, { create: true })).createWritable();
  await w.write(typeof data === "string" ? data : new Uint8Array(data));
  await w.close();
}, { rel, data });
async function save(page) {
  await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !/^Saving/.test(document.getElementById("st-dirty").textContent), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);
}
const lastSave = (log) => log.toasts.filter((t) => /Saved|Not saved|Nothing|not saved/.test(t)).slice(-1)[0] || "";
/** Type `text` at the end of the page's first line. */
async function typeOnPage(page, text) {
  await page.evaluate(() => { if (!document.body.classList.contains("editing")) document.getElementById("edit-toggle").click(); });
  await page.evaluate(() => {
    const body = document.querySelector("#pages .tpage .page-body");
    const lt = body.querySelector(".line .lt") || body.querySelector(".line");
    const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
    let n, last = null;
    while ((n = w.nextNode())) last = n;
    const r = document.createRange(); r.setStart(last, last.data.length); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    body.focus();
  });
  await page.keyboard.type(text, { delay: 10 });
  await page.waitForTimeout(500);
}
const runBar = (page) => page.evaluate(() => (document.getElementById("run-bar").hidden ? "" : document.getElementById("run-bar-text").textContent));

async function run() {
  srv = await startServer();
  browser = await chromium.launch({ executablePath: CHROME });
  try {
    // ── 1. the key ────────────────────────────────────────────────────────
    console.log("1. a save under a key the folder no longer holds is refused, and the folder offered again");
    {
      const r = await newReader();
      const p = r.page;
      await writeFile(p, "pseudonym_key.xlsx", Array.from(KEY_SAME));
      await typeOnPage(p, " It broke.");
      await save(p);
      truthy("the key written again with nothing changed in it: saved as ever", /^Saved A Complaint/.test(lastSave(r.log)) && (await readFile(p, "Text Files/A Complaint.txt")).includes("It broke."));
      await writeFile(p, "pseudonym_key.xlsx", Array.from(KEY_MOVED));
      await p.evaluate(() => window.dispatchEvent(new Event("focus")));
      await p.waitForTimeout(1200);
      truthy("the window focused: the bar says the key changed on disk", /pseudonym_key\.xlsx in Case Stale has changed on disk/.test(await runBar(p)));
      await typeOnPage(p, " Again.");
      await save(p);
      truthy("…and a save is refused, said so", /^Not saved: pseudonym_key\.xlsx in Case Stale has changed on disk/.test(lastSave(r.log)));
      check("…nothing written", (await readFile(p, "Text Files/A Complaint.txt")).includes("Again."), false);
      check("…the bar offers the folder read again", await p.evaluate(() => document.getElementById("run-bar-btn").textContent), "Read the folder again");
      await p.evaluate(() => document.getElementById("run-bar-btn").click());
      await p.waitForTimeout(2500);
      check("read again, the bar is down", await runBar(p), "");
      await typeOnPage(p, " Third.");
      await save(p);
      truthy("…and the next save writes, under the new key", /^Saved A Complaint/.test(lastSave(r.log)) && (await readFile(p, "Text Files/A Complaint.txt")).includes("Third."));
      check("no page errors", r.log.errors, []);
      await r.close();
    }

    // ── 2. LEAKS.xlsx ─────────────────────────────────────────────────────
    console.log("2. LEAKS.xlsx answered in Excel, or removed by a run, is not saved over or put back");
    {
      const r = await newReader();
      const p = r.page;
      await p.evaluate(() => window.__textReaderGoToLeak(0));
      await p.waitForTimeout(500);
      await p.evaluate(() => window.__textReaderDecide("yes"));
      await p.waitForTimeout(300);
      await writeFile(p, "LEAKS.xlsx", Array.from(LEAKS_EXCEL));
      await save(p);
      check("answered in Excel since: the file is Excel's still", await readBytes(p, "LEAKS.xlsx"), Array.from(LEAKS_EXCEL));
      truthy("…and the save says so", /LEAKS\.xlsx was not saved: it changed on disk/.test(lastSave(r.log)));
      truthy("…the answer kept here", await p.evaluate(() => window.__textReaderHasUnsaved()));
      await writeFile(p, "LEAKS.xlsx", null);
      await save(p);
      check("removed by a run: not put back", await readBytes(p, "LEAKS.xlsx"), null);
      truthy("…and the save says so", /LEAKS\.xlsx was not saved: it is no longer in/.test(lastSave(r.log)));
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    {
      // …and one that has not moved is saved as before.
      const r = await newReader();
      const p = r.page;
      await p.evaluate(() => window.__textReaderGoToLeak(0));
      await p.waitForTimeout(500);
      await p.evaluate(() => window.__textReaderDecide("yes"));
      await save(p);
      truthy("the worksheet as it was read: written", /LEAKS\.xlsx (written too )?\(1 decision\)/.test(lastSave(r.log)));
      check("no page errors", r.log.errors, []);
      await r.close();
    }

    // ── 3. New Real Values.txt ────────────────────────────────────────────
    console.log("3. New Real Values.txt keeps the lines the reader did not write");
    {
      const r = await newReader();
      const p = r.page;
      // Typed into the file by hand once the folder was open.
      await writeFile(p, "New Real Values.txt", NRV + "Hand Typed Value\n");
      // The value read in from the file, withdrawn from the Flagged panel, and
      // another flagged here: the reader writes the file.
      await p.evaluate(() => [...document.querySelectorAll("#flags-list li")].find((li) => /Quell Harbor/.test(li.textContent)).querySelector(".x").click());
      await p.waitForTimeout(300);
      await p.evaluate(() => {
        const body = document.querySelector("#pages .tpage .page-body");
        const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) { const k = n.data.indexOf("vehicle"); if (k >= 0) { const r = document.createRange(); r.setStart(n, k); r.setEnd(n, k + 7); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return; } }
      });
      await p.keyboard.press("Control+Shift+F");
      await p.waitForTimeout(400);
      await save(p);
      const nrv = await readFile(p, "New Real Values.txt");
      const lines = nrv.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      check("the reader's own line, then the page list and the line typed by hand; the value withdrawn gone", lines, ["vehicle", "did not ocr: Exhibit A.pdf | pages 3-5, 9", "Hand Typed Value"]);
      truthy("…under their comment", nrv.includes("# Already in this file, not written by the text reader — kept as they stand:\ndid not ocr: Exhibit A.pdf | pages 3-5, 9\nHand Typed Value\n"));
      check("no page errors", r.log.errors, []);
      await r.close();
    }

    // ── 4. an export a run rewrote ────────────────────────────────────────
    console.log("4. an empty save does not write over an export a run rewrote");
    {
      const r = await newReader();
      const p = r.page;
      await save(p); // New Real Values.txt written: nothing else is owed
      await writeFile(p, "Text Files/A Complaint.txt", A_RUN);
      await save(p);
      check("the run's text stands", await readFile(p, "Text Files/A Complaint.txt"), A_RUN);
      truthy("…and the save says so", /changed on disk since it was opened/.test(lastSave(r.log)) && /Nothing was written/.test(lastSave(r.log)));
      truthy("…the bar offers the folder read again", /A document in hand has changed on disk/.test(await runBar(p)));
      check("no page errors", r.log.errors, []);
      await r.close();
    }

    // ── 5. a lone file ────────────────────────────────────────────────────
    console.log("5. a lone file changed or renamed on disk is not written through its old handle");
    {
      const r = await newReader({ loose: true });
      const p = r.page;
      await typeOnPage(p, " Mine.");
      await writeFile(p, "A Complaint.txt", A_RUN);
      await save(p);
      check("changed on disk after the edits: the disk's text stands", await readFile(p, "A Complaint.txt"), A_RUN);
      truthy("…and the save says so", /changed on disk after your edits/.test(lastSave(r.log)));
      await writeFile(p, "A Complaint.txt", null);
      await writeFile(p, "A Complaint.txt.LEAK", A_RUN);
      await save(p);
      check("renamed away by a run: not made again", await readFile(p, "A Complaint.txt"), null);
      truthy("…and the save says so", /no longer where it was opened/.test(lastSave(r.log)));
      check("no page errors", r.log.errors, []);
      await r.close();
    }

    // ── 6. the PDF viewer ─────────────────────────────────────────────────
    console.log("6. the PDF viewer asks before saving over a PDF that changed on disk");
    {
      const r = await newPage("/viewer/viewer.html");
      const p = r.page;
      await p.waitForFunction(() => typeof window.__pdfViewerLoadLocal === "function");
      const load = () => p.evaluate(async () => {
        const h = await window.__case.getFileHandle("Exhibit A.pdf");
        await window.__pdfViewerLoadLocal(await h.getFile(), h);
      });
      await p.evaluate(async (bytes) => {
        const top = await navigator.storage.getDirectory();
        try { await top.removeEntry("Viewer Case", { recursive: true }); } catch { /* none yet */ }
        window.__case = await top.getDirectoryHandle("Viewer Case", { create: true });
        const w = await (await window.__case.getFileHandle("Exhibit A.pdf", { create: true })).createWritable();
        await w.write(new Uint8Array(bytes)); await w.close();
      }, pdfWith("Original page"));
      await load();
      await p.waitForTimeout(1500);
      const saveClick = async () => { await p.evaluate(() => document.getElementById("save-edits").click()); await p.waitForTimeout(1500); };
      // The dialog Save puts up (the page's own dialogs stand in it, hidden).
      const dialog = () => p.evaluate(() => { const m = [...document.querySelectorAll(".modal")].filter((x) => x.offsetParent !== null).pop(); return m ? m.querySelector("h3").textContent : ""; });
      const pdfText = async () => Buffer.from(await readBytes(p, "Exhibit A.pdf")).toString("latin1");
      await saveClick();
      check("unchanged on disk: saved with no question", await dialog(), "");
      await p.evaluate(async (bytes) => { const w = await (await window.__case.getFileHandle("Exhibit A.pdf")).createWritable(); await w.write(new Uint8Array(bytes)); await w.close(); }, pdfWith("Linked by PDF-Linker"));
      await saveClick();
      check("changed on disk: asked", await dialog(), "This PDF changed on disk");
      await p.evaluate(() => [...document.querySelectorAll(".modal button")].find((b) => b.textContent === "Cancel").click());
      await p.waitForTimeout(500);
      truthy("Cancel: the file on disk is left as it is", (await pdfText()).includes("Linked by PDF-Linker"));
      await saveClick();
      await p.evaluate(() => document.getElementById("stale-reopen").click());
      await p.waitForTimeout(1500);
      truthy("Reopen: the file on disk is left as it is", (await pdfText()).includes("Linked by PDF-Linker"));
      await saveClick();
      check("…and, reopened, the next save asks nothing", await dialog(), "");
      await p.evaluate(async (bytes) => { const w = await (await window.__case.getFileHandle("Exhibit A.pdf")).createWritable(); await w.write(new Uint8Array(bytes)); await w.close(); }, pdfWith("Second run"));
      await saveClick();
      await p.evaluate(() => document.getElementById("stale-overwrite").click());
      await p.waitForTimeout(1500);
      check("Overwrite it: written over", (await pdfText()).includes("Second run"), false);
      check("no page errors", r.log.errors, []);
      await r.close();
    }
  } finally {
    await browser.close();
    srv.stop();
  }
  console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
  process.exit(fails ? 1 : 0);
}
await run();
