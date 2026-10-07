// Browser test for the text reader's folder-wide Replace all and Save
// (viewer/text-reader.js): Replace all reaching every export of a case folder,
// the store of unsaved documents, moving between documents without dropping an
// edit, one Save writing every document and every decision, the undo journal,
// conflicts and write failures, a prepare stopped, a stored document dropped,
// leaving the folder, and the fallbacks for a lone file, a light attach and
// Combined Text.txt. Cases 15-24 pin what a review of all that found: the
// walks' save written the folder's way, spot keeps stored only once written,
// a find holding the reel, an undo naming a document saved with more edits,
// dropped edits taken off the page, a lone file joining its folder, Ctrl+Z
// asking before an unseen folder replace (and a field keeping its own undo),
// "fake it" withdrawn, the save's toast, and the same folder opened again.
// Cases 25-28 pin the keeps PDF-Linker has spent: a keep whose line it took out
// of New Real Values.txt is not handed over again (recorded on the master, the
// master row emptied since, or the master write failed and the line held), the
// folder opened again, a keep withdrawn not read back in, and Remove from Master
// Keep taking the value off every case's list and out of the folder's file.
// Cases 29-35 pin what a review of that found: two reader tabs on one folder
// (a stale list stored over a keep is not a withdrawal; a withdrawal reaches the
// other tab), a same-named copy of the case and a list saved by the picker or a
// download (neither spends a keep in the folder PDF-Linker reads), the Flagged
// panel's own Save after a run, Remove from Master Keep reaching other folders'
// files (or naming those out of reach), and a master workbook remembered but
// not read.
//
// Run: node test-folder-save.mjs            (from the repo root)
//      node test-folder-save.mjs --only 3   (one case, by number)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium),
// python3 with openpyxl (to build a real pseudonym_key.xlsx) and a free port
// in 8130-8199 for python3's http.server; exits 0 with SKIP where any is
// missing. The case folder is an OPFS directory (navigator.storage.
// getDirectory()), a real FileSystemDirectoryHandle the reader reads, lists and
// writes exactly as it would a picked one. Every name, firm and docket in it is
// invented.

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const { parseXlsx } = await import("./viewer/xlsx-read.js");
const LK = await import("./viewer/leaks.js");
const PW = "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = "/opt/pw-browsers/chromium";

function skip(why) { console.log(`SKIP: ${why}`); process.exit(0); }
if (!fs.existsSync(PW)) skip("Playwright is not installed at " + PW);
if (!fs.existsSync(CHROME)) skip("Chromium is not installed at " + CHROME);
try { execFileSync("python3", ["-I", "-c", "import openpyxl"], { stdio: "ignore" }); } catch { skip("python3 with openpyxl is needed to build the key"); }
const { chromium } = await import(PW);

const ONLY = (() => { const i = process.argv.indexOf("--only"); return i > 0 ? Number(process.argv[i + 1]) : 0; })();

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
const KEY = [
  ["person", "Corwin Ashdale", "Tobias Wrenfield", "", "", "spreadsheet", 4],
  ["person-token", "Ashdale", "Wrenfield", "", "", "spreadsheet", 4],
  ["entity", "Pellmont Motors", "Quarrow Motors", "", "", "spreadsheet", 3],
];
function buildKeyXlsx(rows) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "folder-save-")), "pseudonym_key.xlsx");
  const py = `
import json, sys, openpyxl
rows = json.loads(sys.argv[2])
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Pseudonym Key"
ws.append(["Category", "Real Value", "Replacement", "Context", "Status", "Source", "Occurrences"])
for r in rows: ws.append(r)
wb.save(sys.argv[1])
`;
  execFileSync("python3", ["-I", "-c", py, out, JSON.stringify(rows)]);
  return fs.readFileSync(out);
}
const KEY_BYTES = buildKeyXlsx(KEY);

// ── the fixture: an invented case ──────────────────────────────────────────
const CASE = "Case Harness";
const A = "====== Page 1 ======\nPlaintiff Tobias Wrenfield bought a vehicle from Quarrow Motors.\nThe vehicle failed within a month.\n====== Page 2 ======\nWrenfield asks for restitution.\n";
// …with a real name the run left in the clear, for the decisions.
const A_LEAK = "====== Page 1 ======\nPlaintiff Tobias Wrenfield bought a vehicle from Quarrow Motors.\nThe vehicle failed within a month.\n====== Page 2 ======\nWrenfield asks for restitution. Corwin Ashdale signed it.\n";
const B = "====== Page 1 ======\nQuarrow Motors denies that the vehicle was defective.\n====== Page 2 ======\nQuarrow Motors prays for judgment.\n";
const C = "====== Page 1 ======\nI, Tobias Wrenfield, declare:\n1. I drove the vehicle home.\n2. The vehicle stalled twice.\n====== Page 2 ======\n3. I returned the vehicle to the dealer. Wrenfield\n";
const D = "====== Page 1 ======\nI served the papers on counsel for Corwin Ashdale by mail.\n";
const F = "====== Page 1 ======\nThe motion concerns Quarrow Motors only.\n";
const F_HIT = "====== Page 1 ======\nThe motion concerns the vehicle Quarrow Motors sold.\n";
// Pleading paper: line 6 lost its margin number (put back on open, written at
// save), line 3 is the query alone, "Quarrow / Motors" is a pseudonym wrapped
// over a numbered line, three real names stand in the clear, and a cited
// decision's party.
const E = [
  "====== Page 1 ======",
  " 1  DECLARATION OF TOBIAS WRENFIELD",
  " 2  I, Tobias Wrenfield, declare:",
  " 3  vehicle",
  " 4  The vehicle was sold by Quarrow",
  " 5  Motors in June.",
  "    The vehicle broke down at once.",
  " 7  Corwin Ashdale signed for it; Corwin Ashdale paid.",
  " 8  Corwin Ashdale kept the vehicle keys.",
  " 9  See Ashdale v. Quarrow Motors (2001) 90 Cal.App.4th 12.",
  "10  Vehicle storage fees are due.",
  "11  Nothing else.",
  "12  Dated this day.",
  "====== Page 2 ======",
  "The vehicle is in storage.",
].join("\n") + "\n";
const banner = (k, n, name) => `#### DOCUMENT ${k} OF ${n} IN THIS COMBINED FILE: ${name} ####`;
const COMBINED = [banner(1, 3, "A Complaint.txt"), ...A.trimEnd().split("\n"), banner(2, 3, "B Answer.txt"), ...B.trimEnd().split("\n"), banner(3, 3, "C Declaration.txt"), ...C.trimEnd().split("\n")].join("\n") + "\n";
const BASE = { "A Complaint.txt": A, "B Answer.txt": B, "C Declaration.txt": C, "D Proof of Service.txt": D, "F Motion.txt.LEAK": F };
const ROOT = { "Combined Text.txt": COMBINED };

// ── the browser ─────────────────────────────────────────────────────────────
let srv = null, browser = null;
/** A fresh reader tab in a context of its own (its own storage and OPFS). */
async function newReader({ presets = {} } = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const log = { errors: [], dialogs: [], toasts: [], downloads: [], answer: () => true };
  page.on("pageerror", (e) => log.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) log.errors.push("console: " + m.text()); });
  page.on("download", (d) => log.downloads.push(d.suggestedFilename()));
  page.on("dialog", async (d) => {
    log.dialogs.push({ type: d.type(), message: d.message() });
    try { if (d.type() === "beforeunload" || log.answer(d.message(), d.type())) await d.accept(); else await d.dismiss(); } catch { /* the page went */ }
  });
  await page.goto(srv.base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
  if (Object.keys(presets).length) await page.evaluate((p) => { for (const [k, v] of Object.entries(p)) localStorage.setItem(k, JSON.stringify(v)); }, presets);
  await page.exposeFunction("__testToast", (t) => log.toasts.push(t));
  await page.evaluate(() => {
    const el = document.getElementById("toast");
    new MutationObserver(() => { const t = el.textContent.trim(); if (t) window.__testToast(t); }).observe(el, { childList: true, characterData: true, subtree: true });
  });
  return { context, page, log, close: () => context.close() };
}
/** The case folder into OPFS: the key and the root files in it, the exports in Text Files. */
async function writeFolder(page, { docs = BASE, root = ROOT, key = true } = {}) {
  await page.evaluate(async ({ CASE, docs, root, keyBytes }) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(CASE, { create: true });
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    if (keyBytes) await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    for (const [name, body] of Object.entries(root)) await put(dir, name, body);
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    for (const [name, body] of Object.entries(docs)) await put(text, name, body);
    window.__case = dir;
  }, { CASE, docs, root, keyBytes: key ? Array.from(KEY_BYTES) : null });
}
async function adopt(page) {
  return page.evaluate(async (CASE) => {
    if (!window.__case) window.__case = await (await navigator.storage.getDirectory()).getDirectoryHandle(CASE);
    const found = await window.__textReaderAdoptFolder(window.__case);
    return found ? found.docs.map((d) => d.name) : null;
  }, CASE);
}
async function setReel(page, on) {
  await page.evaluate((on) => { const t = document.getElementById("reel-toggle"); if (t.checked !== on) { t.checked = on; t.dispatchEvent(new Event("change")); } }, on);
}
async function setShowFakes(page, on) {
  await page.evaluate((on) => { const t = document.getElementById("fakes-toggle"); if (t.checked !== on) { t.checked = on; t.dispatchEvent(new Event("change")); } }, on);
  await page.waitForTimeout(300);
}
async function openDoc(page, name, { settle = 700 } = {}) {
  const ok = await page.evaluate((n) => window.__textReaderOpenDoc(n), name);
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.waitForTimeout(settle);
  return ok;
}
/** Every file of the case folder: text in full (the key as a byte count), with when it was written. */
async function readFolder(page) {
  return page.evaluate(async () => {
    const out = {};
    const walk = async (dir, pre) => {
      for await (const [name, e] of dir.entries()) {
        const p = pre ? pre + "/" + name : name;
        if (e.kind === "directory") await walk(e, p);
        else { const f = await e.getFile(); out[p] = { text: /\.xlsx$/i.test(name) ? `<${f.size} bytes>` : await f.text(), at: f.lastModified }; }
      }
    };
    await walk(window.__case, "");
    return out;
  });
}
const T = (files, name) => (files["Text Files/" + name] || {}).text;
async function writeDisk(page, name, text) {
  await page.evaluate(async ({ name, text }) => {
    const dir = await window.__case.getDirectoryHandle("Text Files");
    const w = await (await dir.getFileHandle(name)).createWritable();
    await w.write(text); await w.close();
  }, { name, text });
}
async function bar(page) {
  return page.evaluate(() => ({
    count: document.getElementById("fb-count").textContent,
    rest: document.getElementById("fb-rest").textContent,
    rnote: document.getElementById("fb-rnote").textContent,
    all: document.getElementById("fb-replace-all").textContent,
    allDisabled: document.getElementById("fb-replace-all").disabled,
    undoFolder: !document.getElementById("fb-undo-folder").hidden,
  }));
}
/** The bar settled: no "reading", and the same text for a while. */
async function settled(page, ms = 12000, quiet = 700) {
  const t0 = Date.now();
  let last = null, since = Date.now();
  while (Date.now() - t0 < ms) {
    const b = await bar(page);
    const s = b.count + "|" + b.rest + "|" + b.rnote + "|" + b.all;
    if (s !== last) { last = s; since = Date.now(); }
    else if (!/reading|Preparing|Stop/.test(s) && b.count !== "" && Date.now() - since >= quiet) return b;
    await page.waitForTimeout(100);
  }
  return bar(page);
}
async function find(page, q, { matchCase = false, replace = true } = {}) {
  await page.evaluate(() => document.getSelection().removeAllRanges());
  const open = await page.evaluate(() => !document.getElementById("find-bar").hidden);
  if (!open) {
    await page.locator("#pages .tpage .page-body").first().click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.evaluate(() => document.getSelection().removeAllRanges());
    await page.keyboard.press(replace ? "Control+h" : "Control+f");
    await page.waitForSelector("#fb-input", { state: "visible" });
  }
  if (matchCase !== (await page.isChecked("#fb-case"))) await page.click("#fb-case");
  await page.fill("#fb-input", q);
  return settled(page);
}
async function replaceAll(page, withText) {
  await page.fill("#fb-with", withText);
  await page.click("#fb-replace-all");
  await page.waitForTimeout(500);
  return settled(page);
}
async function save(page, { wait = 8000 } = {}) {
  await page.evaluate(() => document.getElementById("save").click());
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !/^Saving/.test(document.getElementById("st-dirty").textContent), null, { timeout: wait }).catch(() => {});
  await page.waitForTimeout(500);
}
const unsaved = (page) => page.evaluate(() => window.__textReaderUnsaved().map((u) => `${u.name}@${u.where}${u.conflict ? "!" : ""}`).sort());
const stDirty = (page) => page.evaluate(() => document.getElementById("st-dirty").textContent);
const hasUnsaved = (page) => page.evaluate(() => window.__textReaderHasUnsaved());
const pagesText = (page) => page.evaluate(() => [...document.querySelectorAll("#pages .tpage .page-body")].map((b) => b.textContent).join("\n"));
/** Type over a word on the screen, as an edit: the text node changed and an input event fired. */
async function typeOver(page, word, to, { index = null } = {}) {
  const ok = await page.evaluate(({ word, to, index }) => {
    const bodies = index == null ? [...document.querySelectorAll("#pages .tpage .page-body")] : [document.querySelector(`#pages .tpage[data-index="${index}"] .page-body`)];
    for (const b of bodies) {
      if (!b) continue;
      const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        if (n.parentElement.closest(".pn, [data-here], .gutter") || !n.data.includes(word)) continue;
        n.data = n.data.replace(word, to);
        b.dispatchEvent(new InputEvent("input", { bubbles: true }));
        return true;
      }
    }
    return false;
  }, { word, to, index });
  await page.waitForTimeout(500);
  return ok;
}
/**
 * "Fake it" on a real name standing in the clear, from its right-click menu —
 * not the names bar, whose walk would go on into the next document that has one.
 */
async function fakeIt(page, real) {
  await page.waitForFunction(() => /standing unfaked/.test(document.getElementById("st-leaks").textContent), null, { timeout: 8000 });
  const at = await page.evaluate((real) => {
    for (const body of document.querySelectorAll("#pages .tpage .page-body")) {
      const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        if (n.parentElement.closest(".pn, [data-here], .gutter")) continue;
        const i = n.data.indexOf(real);
        if (i < 0) continue;
        const rg = document.createRange(); rg.setStart(n, i + 1); rg.setEnd(n, i + 2);
        n.parentElement.scrollIntoView({ block: "center" });
        const r = rg.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    return null;
  }, real);
  if (!at) throw new Error(`${real} is not standing on the page`);
  await page.waitForTimeout(200);
  const pt = await page.evaluate((real) => {
    for (const body of document.querySelectorAll("#pages .tpage .page-body")) {
      const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        if (n.parentElement.closest(".pn, [data-here], .gutter")) continue;
        const i = n.data.indexOf(real);
        if (i < 0) continue;
        const rg = document.createRange(); rg.setStart(n, i + 1); rg.setEnd(n, i + 2);
        const r = rg.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    return null;
  }, real);
  await page.mouse.click(pt.x, pt.y, { button: "right" });
  await page.waitForFunction(() => !document.getElementById("keep-menu").hidden, null, { timeout: 4000 });
  const lead = await page.evaluate(() => document.getElementById("keep-menu-value").textContent);
  if (lead !== real) throw new Error(`the menu is for ${lead}, not ${real}`);
  await page.evaluate(() => document.getElementById("keep-menu-fake-it").click());
  await page.waitForTimeout(400);
}
/** Scroll the reading down until the reel has hung `n` documents (or there is no more). */
async function hang(page, n) {
  for (let k = 0; k < 20; k++) {
    const have = await page.evaluate(() => window.__textReaderReel().members.length);
    if (have >= n) return have;
    await page.evaluate(() => { const s = document.getElementById("stage"); s.scrollTop = s.scrollHeight; s.dispatchEvent(new Event("scroll")); });
    await page.waitForTimeout(400);
  }
  return page.evaluate(() => window.__textReaderReel().members.length);
}
const spotsOf = (page, name) => page.evaluate((k) => localStorage.getItem(k), `textReader.spots.${CASE}/${name}`);
const NRV = (files) => (files["New Real Values.txt"] || {}).text || null;

// ── the master workbook, as a real .xlsx ───────────────────────────────────
// PDF-Linker's own, beside pdf_linker.config and outside every case folder: a
// KEEP sheet under its own headers, a row per keep, the Fix? cell the decision.
// In OPFS beside the case folder, attached by its handle as Load master
// workbook… attaches it.
const MASTER = "master_leaks.xlsx";
function buildMasterXlsx(rows) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "folder-save-")), MASTER);
  const py = `
import json, sys, openpyxl
rows = json.loads(sys.argv[2])
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Master Leaks"
ws.append(["Value", "Type", "Times Seen", "Cases", "First Seen", "Last Seen"])
k = wb.create_sheet("KEEP")
k.append(["Value", "Fix? (yes/no)", "Type", "Times Seen", "Cases", "First Seen", "Last Seen", "Notes", "Origin"])
for r in rows: k.append(r)
wb.save(sys.argv[1])
`;
  execFileSync("python3", ["-I", "-c", py, out, JSON.stringify(rows)]);
  return fs.readFileSync(out);
}
const keepRow = (value, fix, origin = "Case Harness [0a1b2c3d]") =>
  [value, fix, fix === "never" ? "KEEP-ALWAYS" : "KEEP", 1, origin.replace(/ \[.*$/, ""), "2026-10-01", "2026-10-01", "kept in the text reader", origin];
const ELSEWHERE = keepRow("Clerk", "never", "Case Elsewhere [11111111]");
const MASTER_PLAIN = buildMasterXlsx([ELSEWHERE]);
const MASTER_KEEPS_NO = buildMasterXlsx([ELSEWHERE, keepRow("Corwin Ashdale", "no")]);
const MASTER_CLEARED = buildMasterXlsx([ELSEWHERE, keepRow("Corwin Ashdale", null)]);
const MASTER_KEEPS_NEVER = buildMasterXlsx([ELSEWHERE, keepRow("Corwin Ashdale", "never")]);
async function writeMaster(page, bytes) {
  await page.evaluate(async ({ name, bytes }) => {
    const top = await navigator.storage.getDirectory();
    const w = await (await top.getFileHandle(name, { create: true })).createWritable();
    await w.write(new Uint8Array(bytes)); await w.close();
  }, { name: MASTER, bytes: Array.from(bytes) });
}
async function attachMaster(page) {
  await page.evaluate(async (name) => window.__textReaderAdoptMaster(await (await navigator.storage.getDirectory()).getFileHandle(name)), MASTER);
  await page.waitForTimeout(300);
}
/** The master workbook's keeps as the file now reads, "control:value". */
async function masterOnDisk(page) {
  const bytes = await page.evaluate(async (name) => Array.from(new Uint8Array(await (await (await (await navigator.storage.getDirectory()).getFileHandle(name)).getFile()).arrayBuffer())), MASTER);
  return LK.parseMasterKeeps((await parseXlsx(new Uint8Array(bytes))).sheets, MASTER).keeps.map((k) => k.control + ":" + k.value);
}
const masterState = (page) => page.evaluate(() => window.__textReaderMasterState());
/** A case's keeps as the reader stores them, "control: value". */
const storedKeeps = (page, name = CASE) => page.evaluate((k) => {
  const v = JSON.parse(localStorage.getItem(k) || "null");
  return ((v && v.keeps) || []).map((x) => x.control + ": " + x.value);
}, `textReader.values.${name}`);
/** New Real Values.txt's lines PDF-Linker reads, or null with no file. */
const nrvLines = (files) => { const t = NRV(files); return t == null ? null : t.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")); };
async function writeNrv(page, text) {
  await page.evaluate(async (text) => {
    const w = await (await window.__case.getFileHandle("New Real Values.txt", { create: true })).createWritable();
    await w.write(text); await w.close();
  }, text);
}
/** PDF-Linker's run spending the file: every line applied, the file deleted. */
async function consume(page) {
  await page.evaluate(async () => { try { await window.__case.removeEntry("New Real Values.txt"); } catch { /* none */ } });
}
/** "Keep in this case" (no) or "Never fake it anywhere" (never) from a pseudonym's right-click. */
async function keepPn(page, real, control = "no") {
  const ok = await page.evaluate((real) => {
    const pn = [...document.querySelectorAll("#pages .tpage .page-body .pn")].find((el) => (el.dataset.wholeReal || el.dataset.real) === real);
    if (!pn) return false;
    pn.scrollIntoView({ block: "center" });
    const r = pn.getBoundingClientRect();
    pn.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 2, clientY: r.top + r.height / 2 }));
    return true;
  }, real);
  if (!ok) throw new Error(`no pseudonym of ${real} on the page`);
  await page.waitForFunction(() => !document.getElementById("keep-menu").hidden, null, { timeout: 4000 });
  const id = control === "never" ? "keep-menu-never" : control === "unmaster" ? "keep-menu-unmaster" : "keep-menu-no";
  const shown = await page.evaluate((id) => !document.getElementById(id).hidden, id);
  if (!shown) throw new Error(`the menu offers no ${id} for ${real}`);
  await page.evaluate((id) => document.getElementById(id).click(), id);
  await page.waitForTimeout(500);
}
/** Flag a word standing on the page, from a selection and the flag button. */
async function flagWord(page, word) {
  const ok = await page.evaluate((word) => {
    for (const body of document.querySelectorAll("#pages .tpage .page-body")) {
      const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const i = n.data.indexOf(word);
        if (i < 0 || n.parentElement.closest(".gutter, .pn")) continue;
        const rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, i + word.length);
        const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(rg);
        document.getElementById("flag-btn").click();
        return true;
      }
    }
    return false;
  }, word);
  if (!ok) throw new Error(`${word} is not on the page`);
  await page.waitForTimeout(300);
}
/** PDF-Linker's file when the master KEEP write failed: the keep written back under a comment. */
const HELD_NRV = "# 1 keep(s) applied, but not on the master KEEP sheet yet: this run could not write it (open in Excel? see pdf_linker.log). This file is their only record until a run records them there.\n\nno: Corwin Ashdale\n";
/** The keeps the open list holds, as the Flagged panel shows them. */
const keepsShown = (page) => page.evaluate(() => [...document.querySelectorAll("#keeps-list li")].map((li) => li.firstChild.textContent));
/** The × beside a keep in the Flagged panel: "make it a pseudonym again". */
async function unkeep(page, value) {
  await page.evaluate((v) => { const li = [...document.querySelectorAll("#keeps-list li")].find((x) => x.firstChild.textContent === v); li.querySelector(".x").click(); }, value);
  await page.waitForTimeout(300);
}
/** The toast hook again, after the page was loaded afresh (the binding outlives a reload; the observer does not). */
async function watchToasts(page) {
  await page.evaluate(() => {
    const el = document.getElementById("toast");
    new MutationObserver(() => { const t = el.textContent.trim(); if (t) window.__testToast(t); }).observe(el, { childList: true, characterData: true, subtree: true });
  });
}
/** The reader loaded afresh in its own tab — its storage, its OPFS and its remembered handles kept. */
async function reload(r) {
  await r.page.reload();
  await r.page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
  await watchToasts(r.page);
  await r.page.waitForTimeout(500); // the remembered master workbook, attached again (restoreMaster)
}
/**
 * Two reader tabs on ONE browser profile: one context, so they share
 * localStorage, IndexedDB and OPFS — and a write to localStorage in one is a
 * storage event in the other, as between two real tabs.
 */
async function newPair() {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const mk = async () => {
    const page = await context.newPage();
    const log = { errors: [], dialogs: [], toasts: [] };
    page.on("pageerror", (e) => log.errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) log.errors.push("console: " + m.text()); });
    page.on("dialog", async (d) => { log.dialogs.push({ type: d.type(), message: d.message() }); try { await d.accept(); } catch { /* the page went */ } });
    await page.goto(srv.base + "/viewer/text-reader.html");
    await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
    await page.exposeFunction("__testToast", (t) => log.toasts.push(t));
    await watchToasts(page);
    return { page, log };
  };
  const a = await mk();
  const b = await mk();
  return { a, b, close: () => context.close() };
}
/** Another case folder into OPFS, under `parent` (the top) — and its New Real Values.txt where `nrv` is given. */
async function writeFolderAs(page, name, { docs = BASE, parent = "", nrv = null } = {}) {
  await page.evaluate(async ({ name, docs, parent, nrv, keyBytes }) => {
    let top = await navigator.storage.getDirectory();
    if (parent) top = await top.getDirectoryHandle(parent, { create: true });
    try { await top.removeEntry(name, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(name, { create: true });
    const put = async (d, n, data) => { const w = await (await d.getFileHandle(n, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    if (nrv != null) await put(dir, "New Real Values.txt", nrv);
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    for (const [n, body] of Object.entries(docs)) await put(text, n, body);
  }, { name, docs, parent, nrv, keyBytes: Array.from(KEY_BYTES) });
}
/** Open the case folder `name` (under `parent`) as the folder. */
async function adoptNamed(page, name, { parent = "" } = {}) {
  await page.evaluate(async ({ name, parent }) => {
    let top = await navigator.storage.getDirectory();
    if (parent) top = await top.getDirectoryHandle(parent);
    window.__case = await top.getDirectoryHandle(name);
    await window.__textReaderAdoptFolder(window.__case);
  }, { name, parent });
  await page.waitForTimeout(300);
}
/** A case folder's New Real Values.txt, by name (under `parent`), or null with none. */
async function nrvOf(page, name, { parent = "" } = {}) {
  return page.evaluate(async ({ name, parent }) => {
    try {
      let top = await navigator.storage.getDirectory();
      if (parent) top = await top.getDirectoryHandle(parent);
      const d = await top.getDirectoryHandle(name);
      return await (await (await d.getFileHandle("New Real Values.txt")).getFile()).text();
    } catch { return null; }
  }, { name, parent });
}
const linesOf = (text) => (text == null ? null : text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")));

const cases = [];
const test = (n, title, fn) => cases.push({ n, title, fn });

// ── 1. counts ───────────────────────────────────────────────────────────────
test(1, "the folder counted per page, each document once, the combined file apart", async () => {
  const r = await newReader();
  try {
    await writeFolder(r.page);
    await adopt(r.page);
    await openDoc(r.page, "A Complaint.txt");
    const reel = await r.page.evaluate(() => window.__textReaderReel().members.map((m) => m.name));
    check("A open, B hung under it", reel, ["A Complaint.txt", "B Answer.txt"]);
    const b = await find(r.page, "vehicle");
    check("“1 of 3 here · 3 in 1 other document”, the combined file apart", [b.count, b.rest], ["1 of 3 here", "· 3 in 1 other document · Combined Text.txt: 6, left to PDF-Linker"]);
    check("Replace all is enabled", b.allDisabled, false);
    const p = await find(r.page, "Page");
    check("a page header is never a hit", p.rest, "· nowhere else in the folder");
    check("no page errors", r.log.errors, []);
  } finally { await r.close(); }
});

// ── 2. reach ────────────────────────────────────────────────────────────────
test(2, "Replace all reaches every export; nothing is written until Save", async () => {
  const r = await newReader();
  try {
    await writeFolder(r.page, { docs: { ...BASE, "F Motion.txt.LEAK": F_HIT } });
    await adopt(r.page);
    await openDoc(r.page, "A Complaint.txt");
    const before = await readFolder(r.page);
    await find(r.page, "vehicle");
    const after = await replaceAll(r.page, "automobile");
    const conf = r.log.dialogs.filter((d) => d.type === "confirm").map((d) => d.message);
    check("one confirm", conf.length, 1);
    truthy("…naming 7 in 4 documents of the case", /^Replace “vehicle” with “automobile” in 4 documents of Case Harness\?/.test(conf[0]));
    truthy("…on screen and off it", /• On screen: 3 in 2 documents \(A Complaint, B Answer\)/.test(conf[0]) && /• Not on screen: 4 in 2 documents \(C Declaration, F Motion\)/.test(conf[0]));
    truthy("…and the combined file left to PDF-Linker", /• Not touched: Combined Text\.txt \(6\) — PDF-Linker writes it again from the exports/.test(conf[0]));
    truthy("…and nothing written yet", /Nothing is written yet\./.test(conf[0]));
    const mid = await readFolder(r.page);
    check("the disk is unchanged before Save, bytes and times", Object.fromEntries(Object.entries(mid).map(([k, v]) => [k, v.text + "@" + v.at])), Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.text + "@" + v.at])));
    check("the bar: nothing left anywhere", after.rest, "· nowhere else in the folder · Combined Text.txt: 6, left to PDF-Linker");
    check("4 documents unsaved", await stDirty(r.page), "● 4 documents unsaved — Save writes them all");
    check("…two on the reel, two in the store", await unsaved(r.page), ["A Complaint.txt@reel", "B Answer.txt@reel", "C Declaration.txt@store", "F Motion.txt.LEAK@store"]);
    check("the Documents list tags them", await r.page.evaluate(() => [...document.querySelectorAll("#docs-list li")].filter((li) => li.querySelector(".tag.unsaved")).map((li) => li.dataset.name)), ["A Complaint.txt", "B Answer.txt", "C Declaration.txt", "F Motion.txt.LEAK"]);
    check("↶ Undo replace in folder is offered", after.undoFolder, true);
    truthy("the toast says so", r.log.toasts.some((t) => /^Replaced 7 in 4 documents \(3 here, 3 in C Declaration, 1 in F Motion\) — not saved yet: Ctrl\+S writes all 4/.test(t)));
    await save(r.page);
    const files = await readFolder(r.page);
    const changed = Object.keys(files).filter((k) => files[k].text !== before[k].text || files[k].at !== before[k].at).sort();
    check("Save writes A, B, C and F; D and the combined file are untouched", changed, ["Text Files/A Complaint.txt", "Text Files/B Answer.txt", "Text Files/C Declaration.txt", "Text Files/F Motion.txt.LEAK"]);
    check("…every vehicle replaced", ["A Complaint.txt", "B Answer.txt", "C Declaration.txt", "F Motion.txt.LEAK"].map((n) => /vehicle/.test(T(files, n))), [false, false, false, false]);
    check("nothing unsaved afterwards", [await unsaved(r.page), await hasUnsaved(r.page)], [[], false]);
    truthy("the toast names them and the combined file", r.log.toasts.some((t) => /^Saved 4 documents: A Complaint, B Answer, C Declaration, F Motion/.test(t) && /Combined Text\.txt is behind the exports/.test(t)));
    check("no page errors, no downloads", [r.log.errors, r.log.downloads], [[], []]);
  } finally { await r.close(); }
});

// ── 3. byte parity ───────────────────────────────────────────────────────────
// The document replaced off the screen is written byte for byte as the same
// document opened on its own, replaced and saved: its file, its stored spot
// keeps, and New Real Values.txt.
const PARITY_DOCS = { ...BASE, "E Exhibit.txt": E };
async function parityRun({ open, q, withText, fakes = false, matchCase = false, reel = true, presets = {}, settle = null, docsOverride = null }) {
  const r = await newReader({ presets });
  try {
    await writeFolder(r.page, { docs: docsOverride || PARITY_DOCS });
    if (!reel) await setReel(r.page, false);
    await adopt(r.page);
    await openDoc(r.page, open);
    if (fakes) await setShowFakes(r.page, true);
    if (settle) await fakeIt(r.page, settle);
    if (q != null) { await find(r.page, q, { matchCase }); await replaceAll(r.page, withText); }
    await save(r.page);
    const files = await readFolder(r.page);
    const spots = {};
    for (const name of Object.keys(docsOverride || PARITY_DOCS)) spots[name] = await spotsOf(r.page, name);
    return { files, spots, errors: r.log.errors, toasts: r.log.toasts, dialogs: r.log.dialogs };
  } finally { await r.close(); }
}
test(3, "a document replaced off the screen reads byte for byte as one opened, replaced and saved", async () => {
  const subs = [
    { label: "vehicle → automobile", q: "vehicle", withText: "automobile", docs: ["C Declaration.txt", "E Exhibit.txt"] },
    { label: "vehicle → (empty): an emptied numbered line", q: "vehicle", withText: "", docs: ["C Declaration.txt", "E Exhibit.txt"] },
    { label: "vehicle → a real name, written as its pseudonym", q: "vehicle", withText: "Corwin Ashdale", docs: ["C Declaration.txt", "E Exhibit.txt"] },
    { label: "Ashdale → Ashdale-Brook: part of a longer name left", q: "Ashdale", withText: "Ashdale-Brook", docs: ["C Declaration.txt", "D Proof of Service.txt", "E Exhibit.txt"] },
    { label: "Show fakes on, Wrenfield → Smith", q: "Wrenfield", withText: "Smith", fakes: true, docs: ["C Declaration.txt", "E Exhibit.txt"] },
    { label: "Match case on, Vehicle", q: "Vehicle", withText: "Car", matchCase: true, docs: ["E Exhibit.txt"] },
  ];
  for (const s of subs) {
    console.log("  — " + s.label);
    const subject = await parityRun({ open: "A Complaint.txt", q: s.q, withText: s.withText, fakes: s.fakes, matchCase: s.matchCase });
    for (const x of s.docs) {
      const ref = await parityRun({ open: x, q: s.q, withText: s.withText, fakes: s.fakes, matchCase: s.matchCase, reel: false });
      check(`${x}: the same bytes`, T(subject.files, x), T(ref.files, x));
      check(`${x}: the same spot keeps stored`, subject.spots[x], ref.spots[x]);
      check(`${x}: the same New Real Values.txt`, NRV(subject.files), NRV(ref.files));
      if (ref.errors.length) check(`${x}: no page errors in the reference`, ref.errors, []);
    }
    check("no page errors", subject.errors, []);
  }
  // A decided name with a spot keep after it: the first two "Corwin Ashdale"
  // in E written as their pseudonym, the third kept where it stands — the
  // ordinal counted again after the pass (it used to point past the end, and
  // the save refused).
  console.log("  — a name said to be faked, with a spot keep after it");
  const presets = { [`textReader.spots.${CASE}/E Exhibit.txt`]: [{ page: 0, value: "Corwin Ashdale", nth: 2 }] };
  const docs = { ...PARITY_DOCS, "A Complaint.txt": A_LEAK };
  const subject = await parityRun({ open: "A Complaint.txt", settle: "Corwin Ashdale", presets, docsOverride: docs });
  const unseen = subject.dialogs.filter((d) => /^Save also writes/.test(d.message));
  check("one confirm for the documents never opened", unseen.length, 1);
  truthy("…naming D and E and the name", unseen[0] && /• D Proof of Service — “Corwin Ashdale”/.test(unseen[0].message) && /• E Exhibit — “Corwin Ashdale”/.test(unseen[0].message));
  if (unseen[0]) console.log("        (" + JSON.stringify(unseen[0].message) + ")");
  for (const x of ["D Proof of Service.txt", "E Exhibit.txt"]) {
    const ref = await parityRun({ open: x, settle: "Corwin Ashdale", presets, reel: false, docsOverride: docs });
    check(`${x}: the same bytes`, T(subject.files, x), T(ref.files, x));
    check(`${x}: the same spot keeps stored`, subject.spots[x], ref.spots[x]);
  }
  check("E: the decided names written, the kept one standing, the margin number put back", T(subject.files, "E Exhibit.txt").split("\n").slice(6, 9),
    [" 6  The vehicle broke down at once.", " 7  Tobias Wrenfield signed for it; Tobias Wrenfield paid.", " 8  Corwin Ashdale kept the vehicle keys."]);
  check("E: the spot keep is the first occurrence now", JSON.parse(subject.spots["E Exhibit.txt"]), [{ page: 0, value: "Corwin Ashdale", nth: 0 }]);
  check("D written with the pseudonym", T(subject.files, "D Proof of Service.txt"), "====== Page 1 ======\nI served the papers on counsel for Tobias Wrenfield by mail.\n");
  check("no page errors", subject.errors, []);
});

// ── 4. undo ─────────────────────────────────────────────────────────────────
test(4, "one Ctrl+Z puts every document back, wherever it has gone", async () => {
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await find(r.page, "vehicle");
      await replaceAll(r.page, "automobile");
      await r.page.keyboard.press("Control+z");
      await r.page.waitForTimeout(500);
      check("Ctrl+Z right away: nothing unsaved", await unsaved(r.page), []);
      check("…the pages on screen back", /automobile/.test(await pagesText(r.page)), false);
      check("…and the status clear", await hasUnsaved(r.page), false);
      await r.page.keyboard.press("Control+y");
      await r.page.waitForTimeout(500);
      check("Ctrl+Y redoes it", await unsaved(r.page), ["A Complaint.txt@reel", "B Answer.txt@reel", "C Declaration.txt@store"]);
      check("…on screen too", /automobile/.test(await pagesText(r.page)), true);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await find(r.page, "vehicle");
      await replaceAll(r.page, "automobile");
      r.log.dialogs.length = 0;
      await openDoc(r.page, "C Declaration.txt");
      check("C opened from the store, no dialog", r.log.dialogs, []);
      check("…its edits on screen", /automobile/.test(await pagesText(r.page)), true);
      await r.page.keyboard.press("Control+z");
      await r.page.waitForTimeout(600);
      check("after opening C, Ctrl+Z puts all three back: nothing unsaved", await unsaved(r.page), []);
      check("…C on screen back", /automobile/.test(await pagesText(r.page)), false);
      check("…and the disk never written", T(await readFolder(r.page), "C Declaration.txt"), C);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await find(r.page, "vehicle");
      await replaceAll(r.page, "automobile");
      await save(r.page);
      const written = await readFolder(r.page);
      check("saved", /automobile/.test(T(written, "C Declaration.txt")), true);
      check("↶ Undo replace in folder still offered after the save", (await bar(r.page)).undoFolder, true);
      await r.page.click("#fb-undo-folder");
      await r.page.waitForTimeout(600);
      truthy("…asked first", r.log.dialogs.some((d) => /^Put back the 3 documents changed by replacing “vehicle” with “automobile”\?/.test(d.message)));
      check("after Save, ↶: all three unsaved again", await unsaved(r.page), ["A Complaint.txt@reel", "B Answer.txt@reel", "C Declaration.txt@store"]);
      await save(r.page);
      const back = await readFolder(r.page);
      check("…and Save writes the original bytes", [T(back, "A Complaint.txt"), T(back, "B Answer.txt"), T(back, "C Declaration.txt")], [A, B, C]);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    // C changed since the replace: in the store by an edit (↶ leaves it and
    // names it), or on disk after a save (Save will not write over it).
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await find(r.page, "vehicle");
      await replaceAll(r.page, "automobile");
      await openDoc(r.page, "C Declaration.txt");
      await typeOver(r.page, "home", "away");
      await openDoc(r.page, "A Complaint.txt");
      await r.page.click("#fb-undo-folder");
      await r.page.waitForTimeout(600);
      truthy("↶ leaves a document changed since, and names it", r.log.toasts.some((t) => /Left as it is: C Declaration \(changed since the replace\)/.test(t)));
      check("…A and B put back, C kept as it was edited", await unsaved(r.page), ["C Declaration.txt@store"]);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await find(r.page, "vehicle");
      await replaceAll(r.page, "automobile");
      await save(r.page);
      await writeDisk(r.page, "C Declaration.txt", C.replace("twice", "three times").replace(/vehicle/g, "automobile"));
      await r.page.click("#fb-undo-folder");
      await r.page.waitForTimeout(400);
      await save(r.page);
      const files = await readFolder(r.page);
      check("C changed on disk after the save: ↶ then Save does not write over it", T(files, "C Declaration.txt"), C.replace("twice", "three times").replace(/vehicle/g, "automobile"));
      check("…A and B are written back", [T(files, "A Complaint.txt"), T(files, "B Answer.txt")], [A, B]);
      truthy("…and C is named", r.log.toasts.some((t) => /⚠ C Declaration changed on disk after your edits/.test(t)));
      check("…still unsaved, marked", await unsaved(r.page), ["C Declaration.txt@store!"]);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
});

// ── 5. no edit dropped ──────────────────────────────────────────────────────
test(5, "moving between documents never drops an edit", async () => {
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await setReel(r.page, false);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      truthy("A edited", await typeOver(r.page, "restitution", "rescission"));
      r.log.dialogs.length = 0;
      await openDoc(r.page, "C Declaration.txt");
      check("opening C asks nothing", r.log.dialogs, []);
      check("…A is unsaved in the store", await unsaved(r.page), ["A Complaint.txt@store"]);
      check("…and the status bar says so", await stDirty(r.page), "● 1 document unsaved (A Complaint) — Save writes it");
      await openDoc(r.page, "A Complaint.txt");
      check("A reopened: its edit is there", /rescission/.test(await pagesText(r.page)), true);
      check("…still unsaved", await unsaved(r.page), ["A Complaint.txt@reel"]);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    const r = await newReader();
    try {
      const long = (name, n) => Array.from({ length: n }, (_, k) => `====== Page ${k + 1} ======\n${name} page ${k + 1} says nothing much.`).join("\n") + "\n";
      await writeFolder(r.page, { docs: { "A Complaint.txt": long("A", 2), "B Answer.txt": long("B", 2), "C Declaration.txt": long("C", 2), "D Proof of Service.txt": long("D", 2) }, root: {} });
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt", { settle: 1500 });
      await hang(r.page, 4);
      const members = await r.page.evaluate(() => window.__textReaderReel().members.map((m) => [m.name, m.from]));
      check("A to D on the reel", members.map((m) => m[0]), ["A Complaint.txt", "B Answer.txt", "C Declaration.txt", "D Proof of Service.txt"]);
      const bFrom = members.find((m) => m[0] === "B Answer.txt")[1];
      truthy("B edited on the reel", await typeOver(r.page, "nothing much", "a great deal", { index: bFrom }));
      r.log.dialogs.length = 0;
      await openDoc(r.page, "D Proof of Service.txt");
      check("opening D asks nothing", r.log.dialogs, []);
      check("…B is in the store", await unsaved(r.page), ["B Answer.txt@store"]);
      await save(r.page);
      check("Save writes B", /a great deal/.test(T(await readFolder(r.page), "B Answer.txt")), true);
      check("…and nothing is left unsaved", await unsaved(r.page), []);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
});

// ── 6. conflict ─────────────────────────────────────────────────────────────
test(6, "a file written since its edits began is not written over", async () => {
  const r = await newReader();
  try {
    await writeFolder(r.page);
    await adopt(r.page);
    await openDoc(r.page, "A Complaint.txt");
    await find(r.page, "vehicle");
    await replaceAll(r.page, "automobile");
    const theirs = C.replace("twice", "three times");
    await writeDisk(r.page, "C Declaration.txt", theirs);
    await save(r.page);
    const files = await readFolder(r.page);
    check("C is not written", T(files, "C Declaration.txt"), theirs);
    check("…A and B are", [/automobile/.test(T(files, "A Complaint.txt")), /automobile/.test(T(files, "B Answer.txt"))], [true, true]);
    truthy("…C is named", r.log.toasts.some((t) => /⚠ C Declaration changed on disk after your edits \(PDF-Linker or another window wrote it\) — not written; still unsaved/.test(t)));
    truthy("…first, before the documents written", r.log.toasts.some((t) => /^⚠ C Declaration changed on disk/.test(t) && / — Saved 2 documents: A Complaint, B Answer/.test(t)));
    check("…kept, marked", await unsaved(r.page), ["C Declaration.txt@store!"]);
    check("…and tagged in the list", await r.page.evaluate(() => { const li = [...document.querySelectorAll("#docs-list li")].find((x) => x.dataset.name === "C Declaration.txt"); const t = li && li.querySelector(".tag.unsaved"); return t ? t.textContent : null; }), "changed on disk");
    await openDoc(r.page, "C Declaration.txt", { settle: 1200 });
    check("opening it shows the banner", await r.page.evaluate(() => [!document.getElementById("key-offer").hidden, document.getElementById("key-offer-text").textContent, document.getElementById("key-offer-btn").textContent]),
      [true, "C Declaration.txt changed on disk after your edits — PDF-Linker or another window wrote it — so Save will not write over it. What is on screen is your version.", "Take the disk's version"]);
    check("…with your version on screen", /automobile/.test(await pagesText(r.page)), true);
    await r.page.click("#key-offer-btn");
    await r.page.waitForTimeout(800);
    check("taking the disk's version drops the edits", [/three times/.test(await pagesText(r.page)), await unsaved(r.page)], [true, []]);
    check("no page errors", r.log.errors, []);
  } finally { await r.close(); }
});

// ── 7. write failure ─────────────────────────────────────────────────────────
test(7, "a file that cannot be written is named, and the others are written", async () => {
  const r = await newReader();
  try {
    await writeFolder(r.page);
    await adopt(r.page);
    await openDoc(r.page, "A Complaint.txt");
    await find(r.page, "vehicle");
    await replaceAll(r.page, "automobile");
    await r.page.evaluate(() => {
      const orig = FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable = function (...a) {
        if (this.name === "C Declaration.txt") return Promise.reject(new DOMException("the file is locked", "NoModificationAllowedError"));
        return orig.apply(this, a);
      };
    });
    await save(r.page);
    const files = await readFolder(r.page);
    check("A and B written, C not", [/automobile/.test(T(files, "A Complaint.txt")), /automobile/.test(T(files, "B Answer.txt")), T(files, "C Declaration.txt")], [true, true, C]);
    truthy("…C named, with why", r.log.toasts.some((t) => /⚠ C Declaration could not be written \(NoModificationAllowedError: the file is locked\) — still unsaved\./.test(t)));
    check("…still unsaved", await unsaved(r.page), ["C Declaration.txt@store"]);
    check("…and no download, no picker", r.log.downloads, []);
    check("no page errors", r.log.errors, []);
  } finally { await r.close(); }
});

// ── 8. decisions ─────────────────────────────────────────────────────────────
test(8, "every decision is owed until Save writes it", async () => {
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      check("nothing owed at first", await hasUnsaved(r.page), false);
      await r.page.evaluate(() => {
        for (const body of document.querySelectorAll("#pages .tpage .page-body")) {
          const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = w.nextNode())) {
            const i = n.data.indexOf("restitution");
            if (i < 0 || n.parentElement.closest(".gutter")) continue;
            const rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, i + 11);
            const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(rg);
            document.getElementById("flag-btn").click();
            return;
          }
        }
      });
      await r.page.waitForTimeout(300);
      check("a flag alone: the unsaved hook is true", await hasUnsaved(r.page), true);
      await save(r.page);
      check("…saved", /^restitution$/m.test(NRV(await readFolder(r.page))), true);
      check("…nothing owed", await hasUnsaved(r.page), false);
      await r.page.evaluate(() => { const li = [...document.querySelectorAll("#flags-list li")].find((x) => x.firstChild.textContent === "restitution"); li.querySelector(".x").click(); });
      await r.page.waitForTimeout(200);
      check("the last flag withdrawn is owed", await hasUnsaved(r.page), true);
      await save(r.page);
      const nrv = NRV(await readFolder(r.page));
      check("…and Save writes the file with nothing in it", [nrv.split("\n").filter((l) => l.trim() && !l.startsWith("#")), nrv.startsWith("# New Real Values")], [[], true]);
      check("…nothing owed", await hasUnsaved(r.page), false);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    const r = await newReader();
    try {
      await writeFolder(r.page, { docs: { ...BASE, "A Complaint.txt": A_LEAK } });
      await setReel(r.page, false);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt", { settle: 1200 });
      await fakeIt(r.page, "Corwin Ashdale");
      // Off the screen only: open B, which does not carry it.
      await openDoc(r.page, "B Answer.txt", { settle: 2500 });
      check("“fake it” is owed where the name stands off the screen", await hasUnsaved(r.page), true);
      truthy("…and the status bar counts it", /decided name/.test(await stDirty(r.page)));
      await r.page.reload();
      await r.page.waitForFunction(() => !!window.__textReaderAdoptFolder);
      await r.page.evaluate(() => { window.__case = null; });
      await adopt(r.page);
      await openDoc(r.page, "B Answer.txt", { settle: 3000 });
      check("reloaded before saving: the decision is still owed", await hasUnsaved(r.page), true);
      r.log.dialogs.length = 0;
      await r.page.close({ runBeforeUnload: true });
      await new Promise((res) => setTimeout(res, 800));
      check("closing the tab with only that owed asks first", r.log.dialogs.map((d) => d.type), ["beforeunload"]);
    } finally { await r.close(); }
  }
  {
    const r = await newReader();
    try {
      await writeFolder(r.page, { docs: { ...BASE, "A Complaint.txt": A_LEAK } });
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt", { settle: 1200 });
      await fakeIt(r.page, "Corwin Ashdale");
      await save(r.page);
      const conf = r.log.dialogs.filter((d) => /^Save also writes/.test(d.message));
      check("Save confirms once for D", conf.length, 1);
      truthy("…naming it and the name", conf[0] && /• D Proof of Service — “Corwin Ashdale”/.test(conf[0].message));
      const files = await readFolder(r.page);
      check("D is written with Tobias Wrenfield", T(files, "D Proof of Service.txt"), D.replace("Corwin Ashdale", "Tobias Wrenfield"));
      check("…and A", /Tobias Wrenfield signed it/.test(T(files, "A Complaint.txt")), true);
      check("…and nothing is owed", await hasUnsaved(r.page), false);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
});

// ── 9. spot routing ─────────────────────────────────────────────────────────
test(9, "a spot keep belongs to the document whose page it is on", async () => {
  const r = await newReader();
  try {
    await writeFolder(r.page);
    await adopt(r.page);
    await openDoc(r.page, "A Complaint.txt", { settle: 1200 });
    const bFrom = await r.page.evaluate(() => window.__textReaderReel().members.find((m) => m.name === "B Answer.txt").from);
    await r.page.evaluate((i) => {
      const span = document.querySelector(`#pages .tpage[data-index="${i}"] .pn`);
      span.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
      document.getElementById("keep-menu-here").click();
    }, bFrom + 1);
    await r.page.waitForTimeout(400);
    check("stored under B, as B's own page 2", JSON.parse(await spotsOf(r.page, "B Answer.txt")), [{ page: 1, value: "Pellmont Motors", nth: 0 }]);
    check("…and not under A", await spotsOf(r.page, "A Complaint.txt"), null);
    check("B is the document unsaved", await unsaved(r.page), ["B Answer.txt@reel"]);
    await save(r.page);
    check("…and its file carries the value there", T(await readFolder(r.page), "B Answer.txt").split("\n")[3], "Pellmont Motors prays for judgment.");
    check("no page errors", r.log.errors, []);
  } finally { await r.close(); }
});

// ── 10. the shed gap ─────────────────────────────────────────────────────────
test(10, "a member shed after a replace still comes back on Ctrl+Z", async () => {
  const r = await newReader();
  try {
    const long = Array.from({ length: 40 }, (_, k) => `====== Page ${k + 1} ======\nPage ${k + 1}: the vehicle again.`).join("\n") + "\n";
    await writeFolder(r.page, { docs: { "A Complaint.txt": A, "B Answer.txt": B, "C Declaration.txt": long }, root: {} });
    await adopt(r.page);
    await openDoc(r.page, "A Complaint.txt", { settle: 1500 });
    await hang(r.page, 3);
    check("A, B and C on the reel", await r.page.evaluate(() => window.__textReaderReel().members.map((m) => m.name)), ["A Complaint.txt", "B Answer.txt", "C Declaration.txt"]);
    await find(r.page, "vehicle");
    await replaceAll(r.page, "automobile");
    await save(r.page);
    // The find bar down: while it is up nothing is shed (its count reads the
    // reel's pages — case 17).
    await r.page.evaluate(() => document.getElementById("fb-close").click());
    await r.page.evaluate(() => { const s = document.getElementById("stage"); s.scrollTop = s.scrollHeight; });
    await r.page.waitForTimeout(1500);
    await r.page.evaluate(() => { const s = document.getElementById("stage"); s.scrollTop = s.scrollHeight; s.dispatchEvent(new Event("scroll")); });
    await r.page.waitForTimeout(1500);
    const shed = await r.page.evaluate(() => window.__textReaderReel().members.filter((m) => m.shed).map((m) => m.name));
    truthy("A and B shed", shed.includes("A Complaint.txt") && shed.includes("B Answer.txt"));
    await r.page.keyboard.press("Control+z");
    await r.page.waitForTimeout(800);
    check("Ctrl+Z: all three unsaved again", (await unsaved(r.page)).sort(), ["A Complaint.txt@reel", "B Answer.txt@reel", "C Declaration.txt@reel"]);
    await save(r.page);
    const files = await readFolder(r.page);
    check("…and Save writes all three back", [T(files, "A Complaint.txt"), T(files, "B Answer.txt"), T(files, "C Declaration.txt")], [A, B, long]);
    check("no page errors", r.log.errors, []);
  } finally { await r.close(); }
});

// ── 11. an edit made while the save runs ────────────────────────────────────
test(11, "a save never clears an edit made while it ran", async () => {
  const r = await newReader();
  try {
    await writeFolder(r.page);
    await setReel(r.page, false);
    await adopt(r.page);
    await openDoc(r.page, "A Complaint.txt");
    await typeOver(r.page, "restitution", "rescission");
    await r.page.evaluate(() => {
      const orig = FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable = async function (...a) { await new Promise((res) => setTimeout(res, 1500)); return orig.apply(this, a); };
    });
    await r.page.evaluate(() => document.getElementById("save").click());
    await r.page.waitForTimeout(400);
    await typeOver(r.page, "month", "week");
    await r.page.waitForFunction(() => !/^Saving/.test(document.getElementById("st-dirty").textContent), null, { timeout: 8000 });
    await r.page.waitForTimeout(400);
    const text = T(await readFolder(r.page), "A Complaint.txt");
    check("the save wrote the first edit", [/rescission/.test(text), /week/.test(text)], [true, false]);
    check("…and the edit made while it ran is still unsaved", await unsaved(r.page), ["A Complaint.txt@reel"]);
    check("no page errors", r.log.errors, []);
  } finally { await r.close(); }
});

// ── 12. fallbacks ────────────────────────────────────────────────────────────
test(12, "a lone file, a light attach and Combined Text.txt keep Replace all on the screen", async () => {
  {
    const r = await newReader();
    try {
      await r.page.evaluate(async (text) => { await window.__textReaderLoadLocal(new File([text], "Lone.txt", { type: "text/plain" }), null, null); }, C);
      await r.page.waitForTimeout(600);
      await find(r.page, "vehicle");
      await replaceAll(r.page, "automobile");
      check("a lone file: no confirm", r.log.dialogs, []);
      truthy("…the pages on screen replaced", r.log.toasts.some((t) => /^Replaced 3 in 2 pages/.test(t)));
      await r.page.evaluate(async (text) => { await window.__textReaderLoadLocal(new File([text], "Other.txt", { type: "text/plain" }), null, null); }, D);
      await r.page.waitForTimeout(500);
      check("…and the old question before another file opens", r.log.dialogs.map((d) => d.message), ["Discard unsaved edits to Lone.txt?"]);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    const r = await newReader({ presets: { "textReader.askFolder": "1" } });
    try {
      await writeFolder(r.page);
      await r.page.evaluate(async () => {
        const h = await (await window.__case.getDirectoryHandle("Text Files")).getFileHandle("A Complaint.txt");
        await window.__textReaderLoadLocal(await h.getFile(), h, window.__case);
      });
      await r.page.waitForTimeout(1000);
      await find(r.page, "vehicle");
      await replaceAll(r.page, "automobile");
      check("a light attach: no confirm", r.log.dialogs.filter((d) => d.type === "confirm"), []);
      check("…and the offer bar says what was not read", await r.page.evaluate(() => [document.getElementById("key-offer-text").textContent, document.getElementById("key-offer-btn").textContent]),
        ["Replace all changed only the pages on screen: only this file's key is attached; the rest of Case Harness is not read.", "Read the whole folder"]);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await adopt(r.page);
      await openDoc(r.page, "Combined Text.txt");
      await find(r.page, "vehicle");
      await replaceAll(r.page, "automobile");
      check("Combined Text.txt open: no confirm", r.log.dialogs, []);
      truthy("…replaced in it alone, and said so", r.log.toasts.some((t) => /^Replaced 6 in 4 pages/.test(t) && /Replace all from Combined Text\.txt stays in it — PDF-Linker writes it again from the exports\. Open an export to replace across the folder\./.test(t)));
      check("…nothing in the store", (await unsaved(r.page)).filter((u) => /@store/.test(u)), []);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
});

// ── 13. the off-screen reading is the screen's ──────────────────────────────
test(13, "textdoc.shownPages reads every fixture page as the page body does", async () => {
  const r = await newReader();
  try {
    const docs = { ...PARITY_DOCS, "A Complaint.txt": A_LEAK };
    await writeFolder(r.page, { docs });
    await setReel(r.page, false);
    await adopt(r.page);
    for (const name of Object.keys(docs)) {
      await openDoc(r.page, name, { settle: 400 });
      for (const fakes of [false, true]) {
        await setShowFakes(r.page, fakes);
        const out = await r.page.evaluate(async ({ text, keyRows }) => {
          const TD = await import("/viewer/textdoc.js");
          const PK = await import("/viewer/pseudo-key.js");
          const key = PK.parseKey([{ name: "Pseudonym Key", rows: [["Category", "Real Value", "Replacement", "Context", "Status", "Source", "Occurrences"], ...keyRows] }], "k");
          const shown = TD.shownPages(TD.readExport(text), { rev: PK.compile(key), showFakes: document.body.classList.contains("show-fakes") });
          // The reader's flatten({ blankGutters: true }), as Find reads a page.
          const flatten = (body) => {
            let t = "";
            const rec = (n, atStart) => {
              if (n.nodeType === 3) { const p = n.parentElement; t += p && p.closest(".gutter") ? " ".repeat(n.data.length) : n.data; return; }
              if (n.nodeType !== 1) return;
              if (n.nodeName === "BR") { if (n.nextSibling) t += "\n"; return; }
              if ((n.nodeName === "DIV" || n.nodeName === "P" || n.nodeName === "LI") && !atStart) t += "\n";
              let first = true;
              for (const c of n.childNodes) { rec(c, first && atStart); first = false; }
            };
            rec(body, true);
            return t;
          };
          const dom = [...document.querySelectorAll("#pages .tpage .page-body")].map(flatten);
          return { equal: dom.length === shown.length && dom.every((d, i) => d === shown[i]), dom, shown };
        }, { text: docs[name], keyRows: KEY });
        check(`${name}, Show fakes ${fakes ? "on" : "off"}: the same reading, page by page`, out.equal ? "equal" : { dom: out.dom, shown: out.shown }, "equal");
      }
      await setShowFakes(r.page, false);
    }
    check("no page errors", r.log.errors, []);
  } finally { await r.close(); }
});

// ── 14. stopping, dropping, leaving ─────────────────────────────────────────
test(14, "a prepare stopped changes nothing; one stored document dropped; leaving the folder asks", async () => {
  // Esc while the documents off the screen are being prepared: nothing changes.
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await setReel(r.page, false);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await find(r.page, "vehicle");
      // C's file is slow to read, so the prepare is still on it when Esc comes.
      await r.page.evaluate(() => {
        const orig = FileSystemFileHandle.prototype.getFile;
        FileSystemFileHandle.prototype.getFile = function (...a) {
          const p = orig.apply(this, a);
          return this.name === "C Declaration.txt" ? p.then((f) => new Promise((res) => setTimeout(() => res(f), 1500))) : p;
        };
      });
      await r.page.fill("#fb-with", "automobile");
      await r.page.click("#fb-replace-all");
      await r.page.waitForFunction(() => /Preparing the replace/.test(document.getElementById("fb-rnote").textContent), null, { timeout: 5000 });
      check("the button reads Stop", (await bar(r.page)).all, "Stop");
      await r.page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      await r.page.waitForTimeout(2500);
      truthy("Esc: stopped, and said so", r.log.toasts.some((t) => t === "Replace all stopped — nothing was changed."));
      check("…no confirm was asked", r.log.dialogs.filter((d) => /^Replace “vehicle”/.test(d.message)).length, 0);
      check("…nothing unsaved", [await unsaved(r.page), /vehicle/.test(await pagesText(r.page))], [[], true]);
      check("…and the button is back", (await bar(r.page)).all, "Replace all");
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  // One stored document dropped from its tag; then leaving the folder asks,
  // stays on Cancel twice, and drops the edits on Cancel then OK.
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await setReel(r.page, false);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await find(r.page, "vehicle");
      await replaceAll(r.page, "automobile");
      check("A, B and C unsaved", await unsaved(r.page), ["A Complaint.txt@reel", "B Answer.txt@store", "C Declaration.txt@store"]);
      r.log.dialogs.length = 0;
      // The tag is a label: a click on it opens the document, as the row does.
      await r.page.evaluate(() => {
        const li = [...document.querySelectorAll("#docs-list li")].find((x) => x.dataset.name === "C Declaration.txt");
        li.querySelector(".tag.unsaved").click();
      });
      await r.page.waitForFunction(() => window.__textReaderReel().members[0].name === "C Declaration.txt", null, { timeout: 5000 }).catch(() => {});
      await r.page.waitForTimeout(600);
      check("clicking the tag opens C, asking nothing", [r.log.dialogs.map((d) => d.message), await unsaved(r.page)], [[], ["A Complaint.txt@store", "B Answer.txt@store", "C Declaration.txt@reel"]]);
      check("…and offers no drop for the document on screen", await r.page.evaluate(() => !![...document.querySelectorAll("#docs-list li")].find((x) => x.dataset.name === "C Declaration.txt").querySelector(".drop-unsaved")), false);
      await openDoc(r.page, "A Complaint.txt");
      r.log.dialogs.length = 0;
      await r.page.evaluate(() => {
        const li = [...document.querySelectorAll("#docs-list li")].find((x) => x.dataset.name === "C Declaration.txt");
        li.querySelector(".drop-unsaved").click();
      });
      await r.page.waitForTimeout(400);
      check("the × asks first", r.log.dialogs.map((d) => d.message), ["Drop your unsaved edits to C Declaration.txt? The file stays as it is on disk."]);
      check("…and C is dropped", await unsaved(r.page), ["A Complaint.txt@reel", "B Answer.txt@store"]);
      const before = await readFolder(r.page);
      // Forget this folder: Cancel, and Cancel again — the reader stays.
      r.log.dialogs.length = 0;
      r.log.answer = () => false;
      await r.page.evaluate(() => document.getElementById("forget-folder").click());
      await r.page.waitForTimeout(800);
      check("leaving asks: save first, or not — then leave without saving, or stay", r.log.dialogs.map((d) => d.message), [
        "Case Harness has work not yet saved: 2 documents (A Complaint, B Answer).\n\nOK — save it all first, then go on.\nCancel — do not save: next, choose between leaving without saving and staying in Case Harness.",
        "Leave Case Harness without saving? The unsaved edits to A Complaint, B Answer are dropped. (Flags, keeps and LEAKS answers stay remembered here.)\n\nOK — leave, and drop those edits.\nCancel — stay in Case Harness; nothing is dropped.",
      ]);
      check("…Cancel twice: still in the folder, still unsaved", [await r.page.evaluate(() => window.__textReaderSource().dir != null), (await unsaved(r.page)).length], [true, 2]);
      // …then Cancel, and OK: the edits are dropped, the folder let go of, and nothing written.
      r.log.dialogs.length = 0;
      r.log.answer = (m) => /^Leave Case Harness without saving/.test(m);
      await r.page.evaluate(() => document.getElementById("forget-folder").click());
      await r.page.waitForTimeout(1200);
      check("…Cancel then OK: dropped", await unsaved(r.page), []);
      const after = await r.page.evaluate(async () => {
        const out = {};
        const dir = await window.__case.getDirectoryHandle("Text Files");
        for await (const [name, e] of dir.entries()) out[name] = await (await e.getFile()).text();
        return out;
      });
      check("…and the disk as it was", Object.fromEntries(Object.entries(before).filter(([k]) => k.startsWith("Text Files/")).map(([k, v]) => [k.slice("Text Files/".length), v.text])), after);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  // Leaving with OK: everything saved first, then the folder let go of.
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await setReel(r.page, false);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await find(r.page, "vehicle");
      await replaceAll(r.page, "automobile");
      r.log.answer = () => true;
      await r.page.evaluate(() => document.getElementById("forget-folder").click());
      await r.page.waitForTimeout(2500);
      const files = await readFolder(r.page);
      check("OK: A, B and C written before leaving", ["A Complaint.txt", "B Answer.txt", "C Declaration.txt"].map((n) => /automobile/.test(T(files, n) || "")), [true, true, true]);
      check("…F, with no hit, untouched", T(files, "F Motion.txt.LEAK"), F);
      check("…nothing left unsaved", await unsaved(r.page), []);
      check("…and the folder let go of", await r.page.evaluate(() => window.__textReaderSource().dir == null), true);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
});

// ── 15. the walks' save writes the folder's way ────────────────────────────
// The names walk saves the document it leaves (saveOnTheWayOut). In the case
// folder that save is written as every save there is: in place, after the
// content check — never over a file changed under its edits, and never into
// a picker or Downloads when the file will not take the write.
test(15, "the walks' save never writes over a changed file, and never downloads", async () => {
  const C_NAME = "====== Page 1 ======\nI, Tobias Wrenfield, declare:\n1. I drove the vehicle home. Corwin Ashdale was there.\n";
  const D_NAME = "====== Page 1 ======\nI served Pellmont Motors by mail.\n";
  {
    const r = await newReader();
    try {
      await writeFolder(r.page, { docs: { ...BASE, "C Declaration.txt": C_NAME, "D Proof of Service.txt": D_NAME } });
      await setReel(r.page, false);
      await adopt(r.page);
      await openDoc(r.page, "C Declaration.txt");
      truthy("C edited", await typeOver(r.page, "drove", "walked"));
      await openDoc(r.page, "A Complaint.txt");
      const theirs = C_NAME.replace("home", "home (rewritten by PDF-Linker)");
      await writeDisk(r.page, "C Declaration.txt", theirs);
      await openDoc(r.page, "C Declaration.txt", { settle: 1500 });
      check("C back from the store, changed on disk", await unsaved(r.page), ["C Declaration.txt@reel!"]);
      await r.page.waitForFunction(() => /standing unfaked/.test(document.getElementById("st-leaks").textContent), null, { timeout: 8000 });
      await r.page.click("#st-leaks");
      await r.page.waitForTimeout(500);
      await r.page.click("#nb-fake");
      await r.page.waitForTimeout(3000);
      check("C on disk is the other writer's still", T(await readFolder(r.page), "C Declaration.txt"), theirs);
      truthy("…the walk stayed, and says why", r.log.toasts.some((t) => /^C Declaration\.txt was not written, so the walk has stayed here\. ⚠ C Declaration changed on disk after your edits/.test(t)));
      check("…C still open, still unsaved", [await r.page.evaluate(() => window.__textReaderReel().members[0].name), await unsaved(r.page)], ["C Declaration.txt", ["C Declaration.txt@reel!"]]);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    const C_LEAK = "====== Page 1 ======\nI, Tobias Wrenfield, declare:\n1. I drove the vehicle home.\n2. The vehicle stalled twice.\n====== Page 2 ======\n3. Corwin Ashdale took the vehicle back.\n";
    const r = await newReader();
    try {
      await writeFolder(r.page, { docs: { ...BASE, "C Declaration.txt": C_LEAK, "D Proof of Service.txt": D_NAME } });
      await setReel(r.page, false);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await find(r.page, "vehicle");
      await replaceAll(r.page, "automobile");
      await r.page.evaluate(() => document.getElementById("fb-close").click());
      await openDoc(r.page, "C Declaration.txt", { settle: 1500 });
      await r.page.evaluate(() => {
        const orig = FileSystemFileHandle.prototype.createWritable;
        FileSystemFileHandle.prototype.createWritable = function (...a) {
          if (this.name === "C Declaration.txt") return Promise.reject(new DOMException("the file is locked", "NoModificationAllowedError"));
          return orig.apply(this, a);
        };
        window.showSaveFilePicker = undefined;
      });
      await r.page.waitForFunction(() => /standing unfaked/.test(document.getElementById("st-leaks").textContent), null, { timeout: 8000 });
      await r.page.click("#st-leaks");
      await r.page.waitForTimeout(500);
      await r.page.click("#nb-fake");
      await r.page.waitForTimeout(3000);
      check("a file that will not take the walk's save: no download", r.log.downloads, []);
      check("…the file as it was", T(await readFolder(r.page), "C Declaration.txt"), C_LEAK);
      truthy("…named, with why", r.log.toasts.some((t) => /⚠ C Declaration could not be written \(NoModificationAllowedError: the file is locked\) — still unsaved\./.test(t)));
      check("…and still unsaved, with the rest", await unsaved(r.page), ["A Complaint.txt@store", "B Answer.txt@store", "C Declaration.txt@reel"]);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
});

// ── 16. spot keeps moved by a save are stored once it writes ────────────────
test(16, "a save that writes nothing leaves the stored spot keeps as the file counts them", async () => {
  const presets = { [`textReader.spots.${CASE}/E Exhibit.txt`]: [{ page: 0, value: "Corwin Ashdale", nth: 2 }] };
  // Refused, then saved again where it stands: the pages the refused save
  // changed are unsaved, and the save that writes them stores the keeps.
  {
    const r = await newReader({ presets });
    try {
      await writeFolder(r.page, { docs: { ...BASE, "E Exhibit.txt": E } });
      await setReel(r.page, false);
      await adopt(r.page);
      await openDoc(r.page, "E Exhibit.txt", { settle: 1500 });
      await fakeIt(r.page, "Corwin Ashdale");
      await r.page.evaluate(() => { window.__case.requestPermission = async () => "denied"; });
      await save(r.page);
      check("refused: the file as it was, the keep stored as it counts", [T(await readFolder(r.page), "E Exhibit.txt") === E, JSON.parse(await spotsOf(r.page, "E Exhibit.txt"))], [true, [{ page: 0, value: "Corwin Ashdale", nth: 2 }]]);
      check("…and the pages the save changed are unsaved", await unsaved(r.page), ["E Exhibit.txt@reel"]);
      await r.page.evaluate(() => { delete window.__case.requestPermission; });
      await save(r.page);
      check("granted, saved again: the kept occurrence kept, the others faked", T(await readFolder(r.page), "E Exhibit.txt").split("\n").slice(7, 9),
        [" 7  Tobias Wrenfield signed for it; Tobias Wrenfield paid.", " 8  Corwin Ashdale kept the vehicle keys."]);
      check("…the keep stored as the written file counts it", JSON.parse(await spotsOf(r.page, "E Exhibit.txt")), [{ page: 0, value: "Corwin Ashdale", nth: 0 }]);
      check("…and nothing unsaved", await unsaved(r.page), []);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  // Refused, and the edits let go of (the tab reloaded).
  const r = await newReader({ presets });
  try {
    await writeFolder(r.page, { docs: { ...BASE, "E Exhibit.txt": E } });
    await setReel(r.page, false);
    await adopt(r.page);
    await openDoc(r.page, "E Exhibit.txt", { settle: 1500 });
    await fakeIt(r.page, "Corwin Ashdale");
    await r.page.evaluate(() => { window.__case.requestPermission = async () => "denied"; });
    await save(r.page);
    truthy("the grant refused: nothing written", r.log.toasts.some((t) => /^Not saved: the browser did not let the reader write into Case Harness\. Nothing was written/.test(t)));
    check("…the file as it was", T(await readFolder(r.page), "E Exhibit.txt"), E);
    check("…and the spot keep stored as the file still counts it", JSON.parse(await spotsOf(r.page, "E Exhibit.txt")), [{ page: 0, value: "Corwin Ashdale", nth: 2 }]);
    // The edits go (the tab reloaded); the decision is the case's, and stands.
    r.log.answer = () => true;
    await r.page.reload();
    await r.page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
    await r.page.evaluate(() => { window.__case = null; });
    await adopt(r.page);
    await openDoc(r.page, "E Exhibit.txt", { settle: 1500 });
    await save(r.page);
    check("saved again: the kept occurrence kept, the others faked", T(await readFolder(r.page), "E Exhibit.txt").split("\n").slice(7, 9),
      [" 7  Tobias Wrenfield signed for it; Tobias Wrenfield paid.", " 8  Corwin Ashdale kept the vehicle keys."]);
    check("…and the spot keep stored as the written file counts it", JSON.parse(await spotsOf(r.page, "E Exhibit.txt")), [{ page: 0, value: "Corwin Ashdale", nth: 0 }]);
    check("no page errors", r.log.errors, []);
  } finally { await r.close(); }
});

// ── 17. a find holds the reel ───────────────────────────────────────────────
test(17, "a member of the reel is not shed under a find, so its hits are counted", async () => {
  const longA = Array.from({ length: 80 }, (_, i) => `====== Page ${i + 1} ======\n` + Array.from({ length: 30 }, (_, j) => `Line ${j} of page ${i + 1} about Quarrow Motors and nothing else.`).join("\n")).join("\n") + "\n";
  const Bz = "====== Page 1 ======\nThe zebra crossing is in Quarrow Motors' lot.\n";
  const r = await newReader();
  try {
    await writeFolder(r.page, { docs: { "A Complaint.txt": longA, "B Answer.txt": Bz, "C Declaration.txt": C }, root: {} });
    await adopt(r.page);
    await openDoc(r.page, "A Complaint.txt");
    await hang(r.page, 2);
    const scrollTo = async (top) => { await r.page.evaluate((t) => { const s = document.getElementById("stage"); s.scrollTop = t; s.dispatchEvent(new Event("scroll")); }, top); await r.page.waitForTimeout(1500); };
    await scrollTo(0);
    await scrollTo(10);
    truthy("B shed while reading A's top", (await r.page.evaluate(() => window.__textReaderReel().members.filter((m) => m.shed).map((m) => m.name))).includes("B Answer.txt"));
    let b = await find(r.page, "zebra");
    check("the find builds it back and counts it", b.count, "1 of 1 here");
    for (const top of [999999, 0, 10]) await scrollTo(top);
    check("…and nothing is shed while the bar is up", await r.page.evaluate(() => window.__textReaderReel().members.filter((m) => m.shed).map((m) => m.name)), []);
    await r.page.fill("#fb-input", "zebr");
    await r.page.waitForTimeout(600);
    await r.page.fill("#fb-input", "zebra");
    b = await settled(r.page);
    check("…so B's hit is still counted, and Replace all on", [b.count, b.rest, b.allDisabled], ["1 of 1 here", "· nowhere else in the folder", false]);
    check("no page errors", r.log.errors, []);
  } finally { await r.close(); }
});

// ── 18. an undo names a document changed since ──────────────────────────────
test(18, "after a document of the replace was saved with more edits, an undo names it", async () => {
  const r = await newReader();
  try {
    await writeFolder(r.page);
    await setReel(r.page, false);
    await adopt(r.page);
    await openDoc(r.page, "A Complaint.txt");
    await find(r.page, "vehicle");
    await replaceAll(r.page, "automobile");
    await openDoc(r.page, "C Declaration.txt");
    truthy("C edited on top of the replace", await typeOver(r.page, "drove", "steered"));
    await save(r.page);
    await openDoc(r.page, "B Answer.txt");
    await r.page.click("#fb-undo-folder");
    await r.page.waitForTimeout(800);
    truthy("↶: C named as left", r.log.toasts.some((t) => /^Put back 2 documents .* Left as it is: C Declaration \(changed since the replace\)\./.test(t)));
    check("…A and B put back, unsaved; C as it was saved", await unsaved(r.page), ["A Complaint.txt@store", "B Answer.txt@reel"]);
    check("…its file untouched", /steered the automobile/.test(T(await readFolder(r.page), "C Declaration.txt")), true);
    check("…and the replace row says so", (await bar(r.page)).rnote, "Put back: 2 documents (unsaved); left as it is: C Declaration");
    check("no page errors", r.log.errors, []);
  } finally { await r.close(); }
});

// ── 19. dropped means dropped ───────────────────────────────────────────────
test(19, "edits dropped on leaving the folder leave the page as its file reads", async () => {
  const r = await newReader();
  try {
    await writeFolder(r.page);
    await setReel(r.page, false);
    await adopt(r.page);
    await openDoc(r.page, "A Complaint.txt");
    truthy("A edited", await typeOver(r.page, "failed", "faltered"));
    let n = 0;
    r.log.answer = () => { n++; return n !== 1; }; // Cancel "save first", OK "leave without saving"
    await r.page.evaluate(() => document.getElementById("forget-folder").click());
    await r.page.waitForTimeout(2000);
    check("Forget this folder, leaving without saving: the folder let go of", await r.page.evaluate(() => window.__textReaderSource().dir == null), true);
    check("…the page reads as the file does", [/faltered/.test(await pagesText(r.page)), /failed/.test(await pagesText(r.page))], [false, true]);
    check("…and nothing is unsaved", [await hasUnsaved(r.page), await unsaved(r.page)], [false, []]);
    await r.page.keyboard.press("Control+s");
    await r.page.waitForTimeout(1500);
    check("…so a plain Ctrl+S writes nothing that was dropped", /faltered/.test(T(await readFolder(r.page), "A Complaint.txt")), false);
    check("no page errors", r.log.errors, []);
  } finally { await r.close(); }
});

// ── 20. a file opened on its own joins its folder ───────────────────────────
test(20, "a document opened on its own becomes one of the folder's when the folder is opened", async () => {
  const r = await newReader();
  try {
    await writeFolder(r.page);
    await setReel(r.page, false);
    await r.page.evaluate(async () => { const h = await (await window.__case.getDirectoryHandle("Text Files")).getFileHandle("A Complaint.txt"); await window.__textReaderLoadLocal(await h.getFile(), h); });
    await r.page.waitForTimeout(1000);
    await adopt(r.page);
    await r.page.waitForTimeout(800);
    truthy("A edited", await typeOver(r.page, "failed", "faltered"));
    r.log.dialogs.length = 0;
    await openDoc(r.page, "C Declaration.txt");
    check("opening C asks nothing", r.log.dialogs.map((d) => d.message), []);
    check("…A is kept in the store", await unsaved(r.page), ["A Complaint.txt@store"]);
    const theirs = A.replace("restitution", "restitution (rewritten by PDF-Linker)");
    await writeDisk(r.page, "A Complaint.txt", theirs);
    await save(r.page);
    check("…and checked against its file: not written over", T(await readFolder(r.page), "A Complaint.txt"), theirs);
    check("…kept, marked", await unsaved(r.page), ["A Complaint.txt@store!"]);
    check("no page errors", r.log.errors, []);
  } finally { await r.close(); }
});

// ── 21. Ctrl+Z ──────────────────────────────────────────────────────────────
test(21, "Ctrl+Z asks before it takes back a replace it cannot show, and a field keeps its own", async () => {
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await setReel(r.page, false);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await find(r.page, "vehicle");
      await replaceAll(r.page, "automobile");
      await save(r.page);
      await openDoc(r.page, "D Proof of Service.txt");
      const before = await readFolder(r.page);
      r.log.dialogs.length = 0;
      r.log.answer = () => false;
      await r.page.locator("#pages .tpage .page-body").first().click({ position: { x: 3, y: 5 } });
      await r.page.keyboard.press("Control+z");
      await r.page.waitForTimeout(600);
      check("Ctrl+Z in a document the replace never touched asks first", r.log.dialogs.map((d) => d.message.split(":")[0]), ["Ctrl+Z here takes back a Replace all across the folder"]);
      check("…Cancel: nothing changes", [await unsaved(r.page), await hasUnsaved(r.page)], [[], false]);
      r.log.answer = () => true;
      const k = r.log.toasts.length;
      await r.page.keyboard.press("Control+z");
      await r.page.waitForTimeout(800);
      truthy("…OK: put back, and said so", r.log.toasts.slice(k).some((t) => /^Put back 3 documents as they were before replacing “vehicle” — unsaved; Ctrl\+S writes them, Ctrl\+Y does the replace again\./.test(t)));
      check("…all three unsaved, the disk untouched", [await unsaved(r.page), T(await readFolder(r.page), "C Declaration.txt") === T(before, "C Declaration.txt")], [["A Complaint.txt@store", "B Answer.txt@store", "C Declaration.txt@store"], true]);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await find(r.page, "vehicle");
      await replaceAll(r.page, "automobile");
      const was = await unsaved(r.page);
      await r.page.click("#fb-with");
      await r.page.keyboard.press("End");
      await r.page.keyboard.type("s");
      await r.page.keyboard.press("Control+z");
      await r.page.waitForTimeout(600);
      check("Ctrl+Z in the Replace-with box takes back the letter typed there", await r.page.inputValue("#fb-with"), "automobile");
      check("…and not the replace", await unsaved(r.page), was);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
});

// ── 22. "fake it" withdrawn ─────────────────────────────────────────────────
test(22, "a “fake it” kept for the case can be withdrawn", async () => {
  const r = await newReader();
  try {
    await writeFolder(r.page, { docs: { ...BASE, "A Complaint.txt": A_LEAK } });
    await setReel(r.page, false);
    await adopt(r.page);
    await openDoc(r.page, "A Complaint.txt", { settle: 1200 });
    await fakeIt(r.page, "Corwin Ashdale");
    const listed = () => r.page.evaluate(() => [...document.querySelectorAll("#settled-list li")].map((li) => li.firstChild.textContent));
    check("the decision is listed in the Flagged panel, as spelled", await listed(), ["Corwin Ashdale"]);
    check("…and owed", await hasUnsaved(r.page), true);
    await r.page.evaluate(() => document.querySelector("#settled-list li .x").click());
    await r.page.waitForTimeout(400);
    check("× withdraws it: off the list", await listed(), []);
    check("…out of the case's store", await r.page.evaluate((k) => localStorage.getItem(k), `textReader.settled.${CASE}`), "[]");
    check("…and nothing is owed for it", await hasUnsaved(r.page), false);
    check("no page errors", r.log.errors, []);
  } finally { await r.close(); }
});

// ── 23. what the toasts say ─────────────────────────────────────────────────
test(23, "the save names six documents at most, in the folder's order; a real name in the replacement is counted one way", async () => {
  {
    const names = ["01 One", "02 Two", "03 Three", "04 Four", "05 Five", "06 Six", "07 Seven", "08 Eight"];
    const docs = Object.fromEntries(names.map((n) => [n + ".txt", `====== Page 1 ======\n${n}: the vehicle was sold.\n`]));
    const r = await newReader();
    try {
      await writeFolder(r.page, { docs, root: {} });
      await setReel(r.page, false);
      await adopt(r.page);
      await openDoc(r.page, "05 Five.txt");
      await find(r.page, "vehicle");
      await replaceAll(r.page, "automobile");
      await save(r.page);
      truthy("eight saved: six named in the folder's order, and how many more", r.log.toasts.some((t) => /^Saved 8 documents: 01 One, 02 Two, 03 Three, 04 Four, 05 Five, 06 Six…, and 2 more/.test(t)));
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await setReel(r.page, false);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await find(r.page, "vehicle");
      await replaceAll(r.page, "Corwin Ashdale");
      const conf = r.log.dialogs.filter((d) => /^Replace “vehicle”/.test(d.message)).map((d) => d.message)[0] || "";
      truthy("the confirm names the real name", /• “Corwin Ashdale” in the replacement is a real name: wherever it goes in, the file gets its pseudonym/.test(conf));
      truthy("…and the toast counts its places as places", r.log.toasts.some((t) => /6 occurrences of 1 real name marked — the file will carry the pseudonym\./.test(t)));
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
});

// ── 24. the same folder opened again ────────────────────────────────────────
test(24, "the same folder opened again keeps the replace's documents found", async () => {
  const r = await newReader();
  try {
    await writeFolder(r.page);
    await setReel(r.page, false);
    await adopt(r.page);
    await openDoc(r.page, "A Complaint.txt");
    await find(r.page, "vehicle");
    await replaceAll(r.page, "automobile");
    await openDoc(r.page, "C Declaration.txt");
    check("C open from the store", await unsaved(r.page), ["A Complaint.txt@store", "B Answer.txt@store", "C Declaration.txt@reel"]);
    // The folder read again: every entry of it is a new object.
    await adopt(r.page);
    await r.page.waitForTimeout(500);
    await r.page.click("#fb-undo-folder");
    await r.page.waitForTimeout(800);
    truthy("↶ after the folder was read again: all three put back", r.log.toasts.some((t) => /^Put back 3 documents as they were before replacing “vehicle”/.test(t)));
    check("…C on screen back, nothing unsaved", [/automobile/.test(await pagesText(r.page)), await unsaved(r.page)], [false, []]);
    check("no page errors", r.log.errors, []);
  } finally { await r.close(); }
});

// ── 25. a spent keep is not handed over again ───────────────────────────────
test(25, "a keep PDF-Linker has spent is not handed over again, whatever the master now says", async () => {
  // Kept, saved, spent by a run — then a new flag makes the list owed again.
  const keptAndSpent = async (r, masterAfter, { spend = consume } = {}) => {
    await writeFolder(r.page);
    await writeMaster(r.page, MASTER_PLAIN);
    await setReel(r.page, false);
    await adopt(r.page);
    await attachMaster(r.page);
    await openDoc(r.page, "A Complaint.txt");
    await keepPn(r.page, "Corwin Ashdale", "no");
    await save(r.page);
    const handed = nrvLines(await readFolder(r.page));
    if (masterAfter) await writeMaster(r.page, masterAfter);
    await spend(r.page);
    await flagWord(r.page, "restitution");
    r.log.toasts.length = 0;
    await save(r.page);
    return handed;
  };
  {
    const r = await newReader();
    try {
      const handed = await keptAndSpent(r, MASTER_KEEPS_NO);
      check("the keep is handed to PDF-Linker first", handed, ["no: Corwin Ashdale"]);
      check("recorded on the master and spent: Save writes the new flag, and not the keep", nrvLines(await readFolder(r.page)), ["restitution"]);
      check("…the keep is off the case's list", await storedKeeps(r.page), []);
      check("…and nothing said: the master keeps it", r.log.toasts.some((t) => /off this case's keeps/.test(t)), false);
      check("…where it is still kept, by the master", (await masterState(r.page)).keeps.includes("no:Corwin Ashdale"), true);
      check("…and nothing owed", await hasUnsaved(r.page), false);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    const r = await newReader();
    try {
      await keptAndSpent(r, MASTER_CLEARED);
      check("the master row emptied since: the keep is still not handed over", nrvLines(await readFolder(r.page)), ["restitution"]);
      check("…it is off the case's list", await storedKeeps(r.page), []);
      truthy("…and the save says so, by name", r.log.toasts.some((t) => /⚠ “Corwin Ashdale” is off this case's keeps: PDF-Linker has taken its line out of New Real Values\.txt, and master_leaks\.xlsx does not keep it — removed there, or never recorded\. It is not sent again/.test(t)));
      check("…and the master is left as the operator left it", await masterOnDisk(r.page), ["never:Clerk"]);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    const r = await newReader();
    try {
      // The run could not write the master: PDF-Linker writes the keep back,
      // under a comment saying why. It is not spent.
      await keptAndSpent(r, null, { spend: (page) => writeNrv(page, HELD_NRV) });
      check("the master write failed, the line held under its comment: still handed over", nrvLines(await readFolder(r.page)), ["restitution", "no: Corwin Ashdale"]);
      check("…and still on the case's list", await storedKeeps(r.page), ["no: Corwin Ashdale"]);
      check("…with nothing said", r.log.toasts.some((t) => /off this case's keeps/.test(t)), false);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
});

// ── 26. the folder opened again ─────────────────────────────────────────────
test(26, "opening the folder retires a spent keep, never reads a withdrawn one back, and a keep taken again is handed over", async () => {
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await writeMaster(r.page, MASTER_PLAIN);
      await setReel(r.page, false);
      await adopt(r.page);
      await attachMaster(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await keepPn(r.page, "Corwin Ashdale", "never");
      await save(r.page);
      check("the keep handed over", nrvLines(await readFolder(r.page)), ["never: Corwin Ashdale"]);
      await writeMaster(r.page, MASTER_KEEPS_NEVER);
      await consume(r.page);
      await writeMaster(r.page, MASTER_CLEARED); // …and emptied on the master since, by hand
      r.log.toasts.length = 0;
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await r.page.waitForTimeout(800);
      check("opened again after the run: the spent keep is off the case's list", await storedKeeps(r.page), []);
      check("…nothing is owed (it is not written again)", await hasUnsaved(r.page), false);
      truthy("…and the master not keeping it, it is said by name", r.log.toasts.some((t) => /^“Corwin Ashdale” is off this case's keeps: PDF-Linker has taken its line out of New Real Values\.txt, and master_leaks\.xlsx does not keep it/.test(t)));
      await flagWord(r.page, "restitution");
      await save(r.page);
      check("…and the next save hands over only what is new", nrvLines(await readFolder(r.page)), ["restitution"]);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await setReel(r.page, false);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await keepPn(r.page, "Corwin Ashdale", "no");
      await save(r.page);
      // Withdrawn after it was written, and the folder opened again before a save.
      await r.page.evaluate(() => { const li = [...document.querySelectorAll("#keeps-list li")].find((x) => x.firstChild.textContent === "Corwin Ashdale"); li.querySelector(".x").click(); });
      await r.page.waitForTimeout(300);
      check("a keep withdrawn after it was written is owed out of the file", await hasUnsaved(r.page), true);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      check("…opening the folder does not read it back in from the file", await storedKeeps(r.page), []);
      check("…and the file is still owed", await hasUnsaved(r.page), true);
      await save(r.page);
      check("…which Save writes with nothing in it", nrvLines(await readFolder(r.page)), []);
      await adopt(r.page);
      check("…and the next opening finds nothing to read back", [await storedKeeps(r.page), await hasUnsaved(r.page)], [[], false]);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await setReel(r.page, false);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await keepPn(r.page, "Corwin Ashdale", "no");
      await save(r.page);
      await consume(r.page);
      // The same keep withdrawn and taken again, with the reader still open:
      // a decision taken afresh, not the line PDF-Linker spent.
      await r.page.evaluate(() => { const li = [...document.querySelectorAll("#keeps-list li")].find((x) => x.firstChild.textContent === "Corwin Ashdale"); li.querySelector(".x").click(); });
      await r.page.waitForTimeout(300);
      await keepPn(r.page, "Corwin Ashdale", "no");
      await save(r.page);
      check("a keep taken again after its line was spent is handed over again", nrvLines(await readFolder(r.page)), ["no: Corwin Ashdale"]);
      check("…and stays on the case's list", await storedKeeps(r.page), ["no: Corwin Ashdale"]);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await setReel(r.page, false);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await keepPn(r.page, "Corwin Ashdale", "no");
      await save(r.page);
      await consume(r.page);
      // Withdrawn after the run took its line: the list and the file already agree.
      await r.page.evaluate(() => { const li = [...document.querySelectorAll("#keeps-list li")].find((x) => x.firstChild.textContent === "Corwin Ashdale"); li.querySelector(".x").click(); });
      await r.page.waitForTimeout(300);
      r.log.toasts.length = 0;
      await save(r.page);
      check("a keep withdrawn after its line was spent: Save writes no file", NRV(await readFolder(r.page)), null);
      check("…says nothing of a missing folder", r.log.toasts.some((t) => /no case folder is open/.test(t)), false);
      check("…and leaves nothing owed", await hasUnsaved(r.page), false);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
});

// ── 27. Remove from Master Keep, everywhere the reader keeps it ──────────────
test(27, "Remove from Master Keep takes the value off every case's keeps and out of the folder's file", async () => {
  const OTHER = "Case Other";
  const presets = {
    [`textReader.values.${OTHER}`]: { values: ["Quell Harbor"], keeps: [{ control: "never", value: "Corwin Ashdale" }, { control: "no", value: "Marlow Tenbury" }], phrases: [], noOcr: [], ocrAgain: [], textFixed: [] },
  };
  {
    const r = await newReader({ presets });
    try {
      await writeFolder(r.page, { docs: { ...BASE, "A Complaint.txt": A_LEAK } });
      await writeMaster(r.page, MASTER_KEEPS_NEVER);
      await setReel(r.page, false);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt", { settle: 1200 });
      await keepPn(r.page, "Corwin Ashdale", "never");
      await save(r.page);
      check("the case keeps it, and its file carries it", [await storedKeeps(r.page), nrvLines(await readFolder(r.page))], [["never: Corwin Ashdale"], ["never: Corwin Ashdale"]]);
      await attachMaster(r.page);
      await r.page.waitForFunction(() => [...document.querySelectorAll("#master-list li")].some((li) => li.firstChild.textContent === "Corwin Ashdale"), null, { timeout: 8000 });
      r.log.dialogs.length = 0;
      r.log.toasts.length = 0;
      // The × in the Master Keep list.
      await r.page.evaluate(() => [...document.querySelectorAll("#master-list li")].find((li) => li.firstChild.textContent === "Corwin Ashdale").querySelector(".x").click());
      await r.page.waitForTimeout(1200);
      const conf = r.log.dialogs.filter((d) => d.type === "confirm").map((d) => d.message);
      check("one confirm", conf.length, 1);
      truthy("…saying the case lists and the file go too", /It also comes off this reader's keeps for Case Harness, Case Other, and out of Case Harness's New Real Values\.txt, which still carries it — Save writes that\. Left there, PDF-Linker's next run would put it back on the Master Keep\./.test(conf[0] || ""));
      check("the master's row is emptied", await masterOnDisk(r.page), ["never:Clerk"]);
      check("…the case's list lets it go", await storedKeeps(r.page), []);
      check("…and every other case's, the rest of it kept", [await storedKeeps(r.page, OTHER), await r.page.evaluate((k) => JSON.parse(localStorage.getItem(k)).values, `textReader.values.${OTHER}`)], [["no: Marlow Tenbury"], ["Quell Harbor"]]);
      truthy("…and the toast says so", r.log.toasts.some((t) => /off the Master Keep/.test(t) && /It is off this reader's keeps for Case Harness, Case Other too, and Save takes it out of Case Harness's New Real Values\.txt\./.test(t)));
      check("the folder's file is owed the change", [await hasUnsaved(r.page), /New Real Values\.txt to write/.test(await stDirty(r.page))], [true, true]);
      // Opened again before the save: the line in the file is not read back.
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      check("opened again before Save: not read back from the file", [await storedKeeps(r.page), await hasUnsaved(r.page)], [[], true]);
      await save(r.page);
      check("Save writes the file with nothing PDF-Linker reads", nrvLines(await readFolder(r.page)), []);
      await adopt(r.page);
      check("…and opened again, nothing comes back and nothing is owed", [await storedKeeps(r.page), await hasUnsaved(r.page)], [[], false]);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    // The line written into the folder's file by another session (the other
    // reader, its own origin), read in when the folder was opened: this reader
    // never wrote it, and takes it out all the same.
    const r = await newReader();
    try {
      await writeFolder(r.page, { docs: { ...BASE, "A Complaint.txt": A_LEAK } });
      await writeNrv(r.page, "# written in the other reader\nnever: Corwin Ashdale\n");
      await writeMaster(r.page, MASTER_KEEPS_NEVER);
      await setReel(r.page, false);
      await adopt(r.page);
      check("the other session's keep is read in", await storedKeeps(r.page), ["never: Corwin Ashdale"]);
      await attachMaster(r.page);
      await openDoc(r.page, "A Complaint.txt", { settle: 1200 });
      await r.page.waitForFunction(() => [...document.querySelectorAll("#master-list li")].some((li) => li.firstChild.textContent === "Corwin Ashdale"), null, { timeout: 8000 });
      r.log.dialogs.length = 0;
      await r.page.evaluate(() => [...document.querySelectorAll("#master-list li")].find((li) => li.firstChild.textContent === "Corwin Ashdale").querySelector(".x").click());
      await r.page.waitForTimeout(1200);
      truthy("the confirm names the file", /out of Case Harness's New Real Values\.txt, which still carries it/.test((r.log.dialogs.find((d) => d.type === "confirm") || {}).message || ""));
      check("…the keep goes, and the file is owed", [await storedKeeps(r.page), await hasUnsaved(r.page)], [[], true]);
      await save(r.page);
      check("Save takes the line out of the file", nrvLines(await readFolder(r.page)), []);
      await adopt(r.page);
      check("…and it is not read back", await storedKeeps(r.page), []);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
});

// ── 28. the right-click's way in, and the selection's ───────────────────────
test(28, "Remove from the Master Keep from the right-click or the selection reaches the other cases' keeps too", async () => {
  const OTHER = "Case Other";
  const presets = { [`textReader.values.${OTHER}`]: { values: [], keeps: [{ control: "no", value: "Corwin Ashdale" }], phrases: [], noOcr: [], ocrAgain: [], textFixed: [] } };
  const setUp = async (r) => {
    await writeFolder(r.page);
    await writeMaster(r.page, MASTER_KEEPS_NEVER);
    await setReel(r.page, false);
    await adopt(r.page);
    await attachMaster(r.page);
    await openDoc(r.page, "A Complaint.txt");
    r.log.dialogs.length = 0;
  };
  const after = async (r, how) => {
    const conf = r.log.dialogs.filter((d) => d.type === "confirm").map((d) => d.message);
    truthy(`${how}: the confirm names the other case's keeps (this one keeps nothing, its folder has no file)`, /It also comes off this reader's keeps for Case Other\. Left there/.test(conf[0] || "") && !/New Real Values/.test(conf[0] || ""));
    check("…which let it go", await storedKeeps(r.page, OTHER), []);
    check("…the master's row is emptied", await masterOnDisk(r.page), ["never:Clerk"]);
    check("…and nothing is owed here", await hasUnsaved(r.page), false);
    check("no page errors", r.log.errors, []);
  };
  {
    const r = await newReader({ presets });
    try {
      await setUp(r);
      await keepPn(r.page, "Corwin Ashdale", "unmaster");
      await r.page.waitForTimeout(800);
      await after(r, "the right-click");
    } finally { await r.close(); }
  }
  {
    const r = await newReader({ presets });
    try {
      await setUp(r);
      // The pseudonym selected: the pop-up offers Remove from Master Keep.
      await r.page.evaluate(() => {
        const pn = [...document.querySelectorAll("#pages .tpage .page-body .pn")].find((el) => (el.dataset.wholeReal || el.dataset.real) === "Corwin Ashdale");
        pn.scrollIntoView({ block: "center" });
        const t = document.createTreeWalker(pn, NodeFilter.SHOW_TEXT).nextNode();
        const rg = document.createRange(); rg.setStart(t, 0); rg.setEnd(t, t.data.length);
        const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(rg);
      });
      await r.page.waitForFunction(() => !document.getElementById("flag-pop").hidden && !document.getElementById("flag-pop-master").hidden, null, { timeout: 4000 });
      await r.page.evaluate(() => document.getElementById("flag-pop-master").click());
      await r.page.waitForTimeout(800);
      await after(r, "the selection's button");
    } finally { await r.close(); }
  }
});

// ── 29. two reader tabs on one folder ──────────────────────────────────────
test(29, "two reader tabs on one folder: a stale tab's list never loses a keep, nor puts back one withdrawn", async () => {
  {
    // Tab B was opened before tab A took the keep; B's list, stored over A's
    // by a flag, lacks it. That is not a withdrawal: A, opening the folder
    // again, reads the keep back from the file, and hands it over again.
    const p = await newPair();
    try {
      await writeFolder(p.a.page);
      await setReel(p.b.page, false);
      await setReel(p.a.page, false);
      await adopt(p.b.page);
      await openDoc(p.b.page, "A Complaint.txt");
      await adopt(p.a.page);
      await openDoc(p.a.page, "A Complaint.txt");
      await keepPn(p.a.page, "Corwin Ashdale", "never");
      await save(p.a.page);
      check("A's keep is handed over", nrvLines(await readFolder(p.a.page)), ["never: Corwin Ashdale"]);
      await flagWord(p.b.page, "restitution");
      check("B's list, stored over A's, lacks it", await storedKeeps(p.a.page), []);
      await adopt(p.a.page);
      await openDoc(p.a.page, "A Complaint.txt");
      check("A opens the folder again: the keep, never withdrawn, is read back from the file", await storedKeeps(p.a.page), ["never: Corwin Ashdale"]);
      await save(p.a.page);
      check("…and A's next save hands it over with B's flag", nrvLines(await readFolder(p.a.page)), ["restitution", "never: Corwin Ashdale"]);
      check("no page errors", [...p.a.log.errors, ...p.b.log.errors], []);
    } finally { await p.close(); }
  }
  {
    // Both tabs hold the keep; A withdraws it. B lets it go at once (the
    // storage event), so B's next stored list does not put it back for A's
    // next save to hand over again.
    const p = await newPair();
    try {
      await writeFolder(p.a.page);
      await setReel(p.a.page, false);
      await setReel(p.b.page, false);
      await adopt(p.a.page);
      await openDoc(p.a.page, "A Complaint.txt");
      await keepPn(p.a.page, "Corwin Ashdale", "no");
      await save(p.a.page);
      await adopt(p.b.page);
      await openDoc(p.b.page, "A Complaint.txt");
      check("B, opened after the keep was taken, holds it", await keepsShown(p.b.page), ["Corwin Ashdale"]);
      await unkeep(p.a.page, "Corwin Ashdale");
      await p.b.page.waitForTimeout(400);
      check("A withdraws it: B lets it go at once", await keepsShown(p.b.page), []);
      await flagWord(p.b.page, "restitution");
      check("…so B's list, stored, does not put it back", await storedKeeps(p.a.page), []);
      await adopt(p.a.page);
      await openDoc(p.a.page, "A Complaint.txt");
      check("A opens the folder again: the withdrawn keep is not read back from the file", await storedKeeps(p.a.page), []);
      await save(p.a.page);
      check("…and the save takes it out of the file", nrvLines(await readFolder(p.a.page)), ["restitution"]);
      check("no page errors", [...p.a.log.errors, ...p.b.log.errors], []);
    } finally { await p.close(); }
  }
});

// ── 30. a copy of the case under the same name ──────────────────────────────
test(30, "a keep written into a same-named copy of the case folder is not spent in the original", async () => {
  const r = await newReader();
  try {
    await writeFolderAs(r.page, CASE, { parent: "Copies" });
    await writeFolderAs(r.page, CASE, { parent: "Originals" });
    await setReel(r.page, false);
    await adoptNamed(r.page, CASE, { parent: "Copies" });
    await openDoc(r.page, "A Complaint.txt");
    await keepPn(r.page, "Corwin Ashdale", "never");
    await save(r.page);
    check("the keep goes into the copy", linesOf(await nrvOf(r.page, CASE, { parent: "Copies" })), ["never: Corwin Ashdale"]);
    r.log.toasts.length = 0;
    await adoptNamed(r.page, CASE, { parent: "Originals" });
    await openDoc(r.page, "A Complaint.txt");
    check("the original opened: its file never had the line, so the keep is not spent there", await storedKeeps(r.page), ["never: Corwin Ashdale"]);
    check("…it is owed to this folder", [await hasUnsaved(r.page), /New Real Values\.txt to write/.test(await stDirty(r.page))], [true, true]);
    check("…and nothing is said of PDF-Linker taking it", r.log.toasts.some((t) => /off this case's keeps/.test(t)), false);
    await save(r.page);
    check("Save hands it to the folder PDF-Linker runs on", linesOf(await nrvOf(r.page, CASE, { parent: "Originals" })), ["never: Corwin Ashdale"]);
    // PDF-Linker runs on the original and spends the line: spent there now.
    await r.page.evaluate(async (CASE) => { const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("Originals")).getDirectoryHandle(CASE); await d.removeEntry("New Real Values.txt"); }, CASE);
    await adoptNamed(r.page, CASE, { parent: "Originals" });
    check("…where the run then spends it, it is spent", [await storedKeeps(r.page), await hasUnsaved(r.page)], [[], false]);
    // Back in the copy, whose file still carries the line it was given.
    await adoptNamed(r.page, CASE, { parent: "Copies" });
    check("…and the copy, whose file still carries the line, owes nothing and spends nothing", [await storedKeeps(r.page), await hasUnsaved(r.page)], [["never: Corwin Ashdale"], false]);
    check("no page errors", r.log.errors, []);
  } finally { await r.close(); }
});

// ── 31. the folder refusing the write ───────────────────────────────────────
test(31, "a list saved by the picker or a download, the folder refusing it, is not taken for what the folder holds", async () => {
  // The folder refuses New Real Values.txt (and gives it back once asked to stop).
  const refuse = (page) => page.evaluate(() => {
    const d = window.__case;
    const orig = d.getFileHandle.bind(d);
    window.__origGetFileHandle = orig;
    d.getFileHandle = (name, opts) => (opts && opts.create && name === "New Real Values.txt" ? Promise.reject(new DOMException("refused", "NotAllowedError")) : orig(name, opts));
  });
  const allow = (page) => page.evaluate(() => { window.__case.getFileHandle = window.__origGetFileHandle; });
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await writeMaster(r.page, MASTER_PLAIN);
      await setReel(r.page, false);
      await adopt(r.page);
      await attachMaster(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await keepPn(r.page, "Corwin Ashdale", "no");
      // With no save picker, the Flagged panel's Save downloads it.
      await refuse(r.page);
      await r.page.evaluate(() => { window.showSaveFilePicker = undefined; });
      r.log.toasts.length = 0;
      await r.page.evaluate(() => document.getElementById("flags-save").click());
      await r.page.waitForTimeout(1200);
      check("the folder refused it, and it went to a download", [r.log.toasts.some((t) => /Could not write into the folder/.test(t)), r.log.downloads.includes("New Real Values.txt"), NRV(await readFolder(r.page))], [true, true, null]);
      truthy("…said to be a copy outside the folder, which is still owed it", r.log.toasts.some((t) => /^Saved a copy of New Real Values\.txt outside Case Harness — PDF-Linker reads only the case folder's own, so the list is still owed there/.test(t)));
      check("…and the status bar goes on saying so", [await hasUnsaved(r.page), /New Real Values\.txt to write/.test(await stDirty(r.page))], [true, true]);
      await allow(r.page);
      r.log.toasts.length = 0;
      await adopt(r.page);
      await r.page.waitForTimeout(800);
      check("opened again: the keep, never in the folder, is not spent", await storedKeeps(r.page), ["no: Corwin Ashdale"]);
      check("…nothing is said of PDF-Linker taking it", r.log.toasts.some((t) => /off this case's keeps/.test(t)), false);
      check("…and it is owed to the folder", [await hasUnsaved(r.page), /New Real Values\.txt to write/.test(await stDirty(r.page))], [true, true]);
      await save(r.page);
      check("the next Save writes it into the folder", nrvLines(await readFolder(r.page)), ["no: Corwin Ashdale"]);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    // What the folder WAS given still counts: written, then a later list
    // downloaded, then the run spends the folder's file — the keep it took is
    // spent, and the flag only the download had is owed.
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await writeMaster(r.page, MASTER_PLAIN);
      await setReel(r.page, false);
      await adopt(r.page);
      await attachMaster(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await keepPn(r.page, "Corwin Ashdale", "no");
      await save(r.page);
      check("the keep is handed to the folder", nrvLines(await readFolder(r.page)), ["no: Corwin Ashdale"]);
      await flagWord(r.page, "restitution");
      await refuse(r.page);
      await r.page.evaluate(() => { window.showSaveFilePicker = undefined; });
      await r.page.evaluate(() => document.getElementById("flags-save").click());
      await r.page.waitForTimeout(1200);
      await allow(r.page);
      await consume(r.page); // the run takes the folder's file…
      await writeMaster(r.page, MASTER_KEEPS_NO); // …and records the keep on the master
      r.log.toasts.length = 0;
      await adopt(r.page);
      await r.page.waitForTimeout(800);
      check("opened again: the keep the folder was given, and the run took, is spent", await storedKeeps(r.page), []);
      check("…the master holding it, nothing is said", r.log.toasts.some((t) => /off this case's keeps/.test(t)), false);
      check("…and the flag only the download carried is owed to the folder", [await hasUnsaved(r.page), /New Real Values\.txt to write/.test(await stDirty(r.page))], [true, true]);
      await save(r.page);
      check("…which Save writes, without the spent keep", nrvLines(await readFolder(r.page)), ["restitution"]);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    // The save picker pointed at the folder's own file: that is the folder write.
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await setReel(r.page, false);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await keepPn(r.page, "Corwin Ashdale", "no");
      await refuse(r.page);
      await r.page.evaluate(() => {
        window.showSaveFilePicker = async () => window.__origGetFileHandle("New Real Values.txt", { create: true });
      });
      r.log.toasts.length = 0;
      await r.page.evaluate(() => document.getElementById("flags-save").click());
      await r.page.waitForTimeout(1200);
      await allow(r.page);
      check("the picker wrote the folder's own file", nrvLines(await readFolder(r.page)), ["no: Corwin Ashdale"]);
      check("…which is the folder written: nothing is owed, nothing said of a copy", [await hasUnsaved(r.page), r.log.toasts.some((t) => /Saved a copy/.test(t))], [false, false]);
      await consume(r.page);
      await adopt(r.page);
      check("…so the run taking it spends the keep", await storedKeeps(r.page), []);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
});

// ── 32. the Flagged panel's own Save ────────────────────────────────────────
test(32, "the Flagged panel's Save after PDF-Linker spent the file: the keep named, and the status bar in step", async () => {
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await writeMaster(r.page, MASTER_PLAIN);
      await setReel(r.page, false);
      await adopt(r.page);
      await attachMaster(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await keepPn(r.page, "Corwin Ashdale", "no");
      await save(r.page);
      await consume(r.page); // the run took it, and the master does not keep it
      r.log.toasts.length = 0;
      await r.page.evaluate(() => document.getElementById("flags-save").click());
      await r.page.waitForTimeout(1200);
      check("the spent keep is off the list", await storedKeeps(r.page), []);
      truthy("…and the panel's Save names it, the master not keeping it", r.log.toasts.some((t) => /^“Corwin Ashdale” is off this case's keeps: PDF-Linker has taken its line out of New Real Values\.txt, and master_leaks\.xlsx does not keep it/.test(t)));
      check("…never \"nothing flagged yet\"", r.log.toasts.some((t) => /Nothing flagged yet/.test(t)), false);
      check("…and writes nothing", NRV(await readFolder(r.page)), null);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    const r = await newReader();
    try {
      await writeFolder(r.page);
      await setReel(r.page, false);
      await adopt(r.page);
      await openDoc(r.page, "A Complaint.txt");
      await keepPn(r.page, "Corwin Ashdale", "no");
      await save(r.page);
      await consume(r.page);
      await unkeep(r.page, "Corwin Ashdale");
      check("withdrawn after the run took its line: owed, as far as the reader knows", /New Real Values\.txt to write/.test(await stDirty(r.page)), true);
      r.log.toasts.length = 0;
      await r.page.evaluate(() => document.getElementById("flags-save").click());
      await r.page.waitForTimeout(1200);
      truthy("the panel's Save finds the file already as the list is", r.log.toasts.some((t) => /already reads as the list does/.test(t)));
      check("…and the status bar says so too", [/New Real Values\.txt to write/.test(await stDirty(r.page)), await hasUnsaved(r.page)], [false, false]);
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
});

// ── 33. Remove from Master Keep, in the other case folders ──────────────────
test(33, "Remove from Master Keep takes the line out of another folder's file it can reach, and names one it cannot", async () => {
  const THIRD = "Case Third";
  const presets = {
    [`textReader.values.${THIRD}`]: { values: [], keeps: [{ control: "never", value: "Corwin Ashdale" }], phrases: [], noOcr: [], ocrAgain: [], textFixed: [] },
    // …which this reader wrote into Case Third's file in a session long gone,
    // the folder no longer remembered.
    [`textReader.valuesSaved.${THIRD}`]: "# New Real Values\nnever: Corwin Ashdale\n",
  };
  const r = await newReader({ presets });
  try {
    if (!(await r.page.evaluate(() => typeof window.__textReaderAdoptMaster === "function"))) throw new Error("no master hook");
    const OTHER = "Case Other";
    await writeFolderAs(r.page, OTHER);
    await setReel(r.page, false);
    await adoptNamed(r.page, OTHER);
    await openDoc(r.page, "A Complaint.txt");
    await keepPn(r.page, "Corwin Ashdale", "never");
    await save(r.page);
    check("Case Other keeps it, and its file carries it", linesOf(await nrvOf(r.page, OTHER)), ["never: Corwin Ashdale"]);
    await writeFolder(r.page, { docs: { ...BASE, "A Complaint.txt": A_LEAK } });
    await writeMaster(r.page, MASTER_KEEPS_NEVER); // recorded on the master by a run in Case Other
    await adopt(r.page);
    await openDoc(r.page, "A Complaint.txt", { settle: 1200 });
    await attachMaster(r.page);
    await r.page.waitForFunction(() => [...document.querySelectorAll("#master-list li")].some((li) => li.firstChild.textContent === "Corwin Ashdale"), null, { timeout: 8000 });
    r.log.dialogs.length = 0;
    r.log.toasts.length = 0;
    await r.page.evaluate(() => [...document.querySelectorAll("#master-list li")].find((li) => li.firstChild.textContent === "Corwin Ashdale").querySelector(".x").click());
    await r.page.waitForTimeout(1500);
    const conf = (r.log.dialogs.find((d) => d.type === "confirm") || {}).message || "";
    truthy("the confirm says the line comes out of Case Other's file", /It also comes off this reader's keeps for Case Other, Case Third, and out of New Real Values\.txt in Case Other\./.test(conf));
    truthy("…and names Case Third's, out of reach, for the operator to save", /New Real Values\.txt in Case Third still carries it, out of the reader's reach now: open Case Third here and Save before PDF-Linker runs there\. Left there, PDF-Linker's next run would put it back on the Master Keep\./.test(conf));
    check("the master's row is emptied", await masterOnDisk(r.page), ["never:Clerk"]);
    check("Case Other's file no longer hands it to PDF-Linker", linesOf(await nrvOf(r.page, OTHER)), []);
    check("…its list and the record of what was written there let it go", [await storedKeeps(r.page, OTHER), await r.page.evaluate((k) => /Corwin Ashdale/.test(JSON.parse(localStorage.getItem(k) || '""')), `textReader.valuesSaved.${OTHER}`)], [[], false]);
    truthy("the toast says what was done, and warns of Case Third, in red", r.log.toasts.some((t) => /It is out of New Real Values\.txt in Case Other\. ⚠ New Real Values\.txt in Case Third still carries it: open Case Third here and Save before PDF-Linker runs there, or the run puts it back on the Master Keep\./.test(t)));
    // Case Third opened later, its file still carrying the line.
    await writeFolderAs(r.page, THIRD, { nrv: "# New Real Values\nnever: Corwin Ashdale\n" });
    await adoptNamed(r.page, THIRD);
    check("Case Third opened: the line in its file is not read back", await storedKeeps(r.page, THIRD), []);
    check("…the file is owed the change", [await hasUnsaved(r.page), /New Real Values\.txt to write/.test(await stDirty(r.page))], [true, true]);
    await save(r.page);
    check("…which Save writes with nothing PDF-Linker reads", linesOf(await nrvOf(r.page, THIRD)), []);
    await adoptNamed(r.page, THIRD);
    check("…and opened again, nothing comes back and nothing is owed", [await storedKeeps(r.page, THIRD), await hasUnsaved(r.page)], [[], false]);
    check("no page errors", r.log.errors, []);
  } finally { await r.close(); }
});

// ── 34. a master workbook remembered but not read ───────────────────────────
test(34, "a spent keep says the master could not be checked where the workbook is remembered but not read", async () => {
  // Kept, handed over, attached master remembered; the run spends the file.
  const setUp = async (r) => {
    await writeFolder(r.page);
    await writeMaster(r.page, MASTER_PLAIN);
    await setReel(r.page, false);
    await adopt(r.page);
    await attachMaster(r.page);
    await openDoc(r.page, "A Complaint.txt");
    await keepPn(r.page, "Corwin Ashdale", "no");
    await save(r.page);
    check("the keep handed over", nrvLines(await readFolder(r.page)), ["no: Corwin Ashdale"]);
    await consume(r.page);
  };
  {
    const r = await newReader();
    try {
      await setUp(r);
      // A browser restarted: the grant on the workbook is gone until renewed.
      await r.context.addInitScript(() => {
        const q = FileSystemHandle.prototype.queryPermission;
        FileSystemHandle.prototype.queryPermission = function (d) {
          return this.kind === "file" && this.name === "master_leaks.xlsx" ? Promise.resolve("prompt") : q.call(this, d);
        };
      });
      await reload(r);
      check("the workbook is remembered and waits for the browser's leave", (await masterState(r.page)).needs, true);
      r.log.toasts.length = 0;
      await adopt(r.page);
      await r.page.waitForTimeout(800);
      check("the spent keep is retired", await storedKeeps(r.page), []);
      truthy("…and said, with the master not checked", r.log.toasts.some((t) => /^“Corwin Ashdale” is off this case's keeps: PDF-Linker has taken its line out of New Real Values\.txt, and whether master_leaks\.xlsx keeps it could not be checked — the browser wants its leave to read the workbook again/.test(t)));
      check("no page errors", r.log.errors, []);
    } finally { await r.close(); }
  }
  {
    const r = await newReader();
    try {
      await setUp(r);
      // The workbook gone from where it was chosen.
      await r.page.evaluate(async (name) => { await (await navigator.storage.getDirectory()).removeEntry(name); }, MASTER);
      await reload(r);
      r.log.toasts.length = 0;
      await adopt(r.page);
      await r.page.waitForTimeout(800);
      check("the spent keep is retired", await storedKeeps(r.page), []);
      truthy("…and said, the workbook unread", r.log.toasts.some((t) => /whether master_leaks\.xlsx keeps it could not be checked — the workbook could not be read/.test(t)));
      check("no page errors", r.log.errors.filter((e) => !/NotFoundError|could not be found/i.test(e)), []);
    } finally { await r.close(); }
  }
});

// ── 35. a remembered folder that is gone ──────────────────────────────────
test(35, "Remove from Master Keep names a remembered folder that is no longer where it was, rather than taking its file for empty", async () => {
  const r = await newReader();
  try {
    const GONE = "Case Moved";
    await writeFolderAs(r.page, GONE);
    await setReel(r.page, false);
    await adoptNamed(r.page, GONE);
    await openDoc(r.page, "A Complaint.txt");
    await keepPn(r.page, "Corwin Ashdale", "never");
    await save(r.page);
    check("the keep is written into the folder", linesOf(await nrvOf(r.page, GONE)), ["never: Corwin Ashdale"]);
    // Moved away (or deleted) since: the handle the reader remembers finds nothing.
    await r.page.evaluate(async (n) => { await (await navigator.storage.getDirectory()).removeEntry(n, { recursive: true }); }, GONE);
    await writeFolder(r.page, { docs: { ...BASE, "A Complaint.txt": A_LEAK } });
    await writeMaster(r.page, MASTER_KEEPS_NEVER);
    await adopt(r.page);
    await openDoc(r.page, "A Complaint.txt", { settle: 1200 });
    await attachMaster(r.page);
    await r.page.waitForFunction(() => [...document.querySelectorAll("#master-list li")].some((li) => li.firstChild.textContent === "Corwin Ashdale"), null, { timeout: 8000 });
    r.log.dialogs.length = 0;
    await r.page.evaluate(() => [...document.querySelectorAll("#master-list li")].find((li) => li.firstChild.textContent === "Corwin Ashdale").querySelector(".x").click());
    await r.page.waitForTimeout(1500);
    const conf = (r.log.dialogs.find((d) => d.type === "confirm") || {}).message || "";
    truthy("the confirm names it as out of reach", /New Real Values\.txt in Case Moved still carries it, out of the reader's reach now: open Case Moved here and Save before PDF-Linker runs there\./.test(conf));
    check("…and its list lets the value go", await storedKeeps(r.page, GONE), []);
    check("no page errors", r.log.errors.filter((e) => !/NotFoundError|could not be found/i.test(e)), []);
  } finally { await r.close(); }
});

// ── run ─────────────────────────────────────────────────────────────────────
srv = await startServer();
try {
  browser = await chromium.launch({ executablePath: CHROME });
  for (const c of cases) {
    if (ONLY && c.n !== ONLY) continue;
    console.log(`${c.n}. ${c.title}`);
    try { await c.fn(); }
    catch (e) { fails++; console.log(`  FAIL  threw: ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e}`); }
  }
} finally {
  if (browser) await browser.close();
  srv.stop();
}
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
