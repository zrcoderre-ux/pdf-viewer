// Browser test for names typed into the text reader where a citation stands
// (viewer/text-reader.js over textdoc.citedNameSpans, escapedPlace and
// editedSpans): a short cite with no "supra" ("(Ashdale, 30 Cal.App.5th at p.
// 5.)") keeps its party however it was typed or carried, a name Esc left as
// typed stays so through an edit that slides over it and through the reader's
// own cut and paste, a name the file already carried is not taken for typed
// by a deletion beside it, and Ctrl+Backspace never takes a line's number.
// Everything else typed is still written as its pseudonym.
//
// Run: node test-typed-cites.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium),
// python3 with openpyxl (to build the key) and a free port in 8130-8199 for
// python3's http.server; exits 0 with SKIP where any is missing. The case
// folder is an OPFS directory, as in test-folder-save.mjs. Every name in it is
// invented.

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

// ── the key, as a real .xlsx ────────────────────────────────────────────────
// On disk the exports carry the FAKES; the key turns them back on screen.
// "Ashdale" is bound on its own, so a name typed as "Ashdale" is offered.
function buildKey(rows) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "typed-cites-")), "pseudonym_key.xlsx");
  const py = `
import json, sys, openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Pseudonym Key"
ws.append(["Category", "Real Value", "Replacement", "Context", "Status", "Source", "Occurrences"])
for r in json.loads(sys.argv[2]): ws.append(r)
wb.save(sys.argv[1])
`;
  execFileSync("python3", ["-I", "-c", py, out, JSON.stringify(rows)]);
  return fs.readFileSync(out);
}
const KEY_BYTES = buildKey([
  ["person", "Corwin Ashdale", "Tobias Wrenfield", "", "", "spreadsheet", 4],
  ["person-token", "Ashdale", "Wrenfield", "", "", "spreadsheet", 4],
  ["entity", "Quarrow Motors", "Brindle Works", "", "", "spreadsheet", 2],
]);

// ── the case ────────────────────────────────────────────────────────────────
const CASE = "Case Cites";
// A plain page to type on, and two the FILE carries a real name on (a name
// the run left in the clear), each in a parenthetical after another that
// begins as it does — "(Ash…" — so that deleting the first slides.
const A = [
  "====== Page 1 ======",
  "Plaintiff filed the complaint.",
  "The court so held.",
  "Nothing else.",
  "====== Page 2 ======",
  "That was error (Ashford so held).",
  "(Ashdale, slip op. 5.)",
  "Signed.",
  "====== Page 3 ======",
  "That was error (Ashford so held).",
  "(Ashdale, 30 Cal.App.5th at p. 5.)",
  "Signed.",
].join("\n") + "\n";
// Pleading paper, for the line numbers.
const N = [
  "====== Page 1 ======",
  " 1  DECLARATION",
  " 2  Nothing else.",
  " 3  The vehicle was sold.",
  " 4  End.",
].join("\n") + "\n";

// A brief whose first page closes on a case name and whose second opens on
// its year.
const C = [
  "====== Page 1 ======",
  "The rule is settled.",
  "As held in",
  "====== Page 2 ======",
  "(2019) 30 Cal.App.5th 1, the rule stands.",
  "Signed.",
].join("\n") + "\n";

// ── the browser ─────────────────────────────────────────────────────────────
let srv = null, browser = null;
async function newReader(docName = "A Complaint.txt") {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const log = { errors: [], toasts: [] };
  page.on("pageerror", (e) => log.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) log.errors.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto(srv.base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
  await page.exposeFunction("__testToast", (t) => log.toasts.push(t));
  await page.evaluate(() => {
    const el = document.getElementById("toast");
    new MutationObserver(() => { const t = el.textContent.trim(); if (t) window.__testToast(t); }).observe(el, { childList: true, characterData: true, subtree: true });
  });
  await page.evaluate(async ({ CASE, A, N, C, keyBytes }) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(CASE, { create: true });
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    await put(text, "A Complaint.txt", A);
    await put(text, "N Declaration.txt", N);
    await put(text, "C Brief.txt", C);
    window.__case = dir;
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, A, N, C, keyBytes: Array.from(KEY_BYTES) });
  await page.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event("change")); } });
  await page.evaluate((n) => window.__textReaderOpenDoc(n), docName);
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.waitForTimeout(800);
  await page.evaluate(() => document.getElementById("edit-toggle").click());
  await page.waitForTimeout(200);
  return { context, page, log, close: () => context.close() };
}
/** A file of the case's Text Files, as it now stands on disk. */
const fileText = (page, name) => page.evaluate(async (name) => {
  const t = await window.__case.getDirectoryHandle("Text Files");
  return (await (await t.getFileHandle(name)).getFile()).text();
}, name);
/** Page `i`'s lines as the screen has them (the real names), line text only, no margin numbers. */
const screenLines = (page, i) => page.evaluate((i) => [...document.querySelectorAll("#pages .tpage")[i].querySelectorAll(".page-body .line")]
  .map((l) => { const lt = l.querySelector(".lt"); return (lt || l).textContent; }), i);
// The page's text walked line by line, each line's text nodes in order: a
// flat string with "\n" between lines, and where each of its characters is.
const WALK = `
  const body = document.querySelectorAll("#pages .tpage")[pageIdx].querySelector(".page-body");
  const lines = [...body.querySelectorAll(".line")];
  let flat = ""; const map = [];
  lines.forEach((line, li) => {
    if (li) { flat += "\\n"; map.push(null); }
    const lt = line.querySelector(".lt") || line;
    const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) for (let k = 0; k < n.data.length; k++) { flat += n.data[k]; map.push({ n, k }); }
    map.push({ end: lt });
  });
`;
/** Select [from, to) of page `pageIdx`'s flat text — `what` and its `nth` occurrence, `len` characters (all of `what` by default). */
async function selectText(page, pageIdx, what, { nth = 0, len = null, from = 0 } = {}) {
  return page.evaluate(({ pageIdx, what, nth, len, from, WALK }) => {
    const f = new Function("pageIdx", WALK + "return { body, flat, map };");
    const { body, flat, map } = f(pageIdx);
    let at = flat.indexOf(what, from);
    for (let k = 0; k < nth && at >= 0; k++) at = flat.indexOf(what, at + 1);
    if (at < 0) return false;
    const end = at + (len == null ? what.length : len);
    const pt = (i) => {
      const m = map[i];
      if (m && m.n) return [m.n, m.k];
      for (let j = i - 1; j >= 0; j--) if (map[j] && map[j].n) return [map[j].n, map[j].k + 1];
      return [body, 0];
    };
    const [sn, so] = pt(at);
    const [en, eo] = end < map.length && map[end] && map[end].n ? [map[end].n, map[end].k] : pt(end);
    const r = document.createRange(); r.setStart(sn, so); r.setEnd(en, eo);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    body.focus();
    return true;
  }, { pageIdx, what, nth, len, from, WALK });
}
/**
 * Select `what` on page `pageIdx` as the keyboard selects it, Shift+→ a
 * character at a time from its start: across a line break the browser then
 * takes the break with it and joins the lines, as an operator's selection
 * does (a DOM range ending at the next line's start does not).
 */
async function selectByKeys(page, pageIdx, what, opts = {}) {
  if (!(await selectText(page, pageIdx, what, { ...opts, len: 0 }))) return false;
  for (let k = 0; k < what.length; k++) await page.keyboard.press("Shift+ArrowRight");
  return page.evaluate((w) => getSelection().toString() === w, what);
}
/** The caret at the end of line `lineIdx` of page `pageIdx` (its text, not its margin number), or at its head with `head`. */
async function caretAt(page, pageIdx, lineIdx, { head = false } = {}) {
  return page.evaluate(({ pageIdx, lineIdx, head }) => {
    const body = document.querySelectorAll("#pages .tpage")[pageIdx].querySelector(".page-body");
    const line = body.querySelectorAll(".line")[lineIdx];
    const lt = line.querySelector(".lt") || line;
    const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
    let n, first = null, last = null;
    while ((n = w.nextNode())) { if (!first) first = n; last = n; }
    const r = document.createRange();
    if (head) { if (first) r.setStart(first, 0); else r.setStart(lt, 0); }
    else if (last) r.setStart(last, last.data.length); else r.setStart(lt, lt.childNodes.length);
    r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    body.focus();
    return true;
  }, { pageIdx, lineIdx, head });
}
async function type(page, text, delay = 15) { await page.keyboard.type(text, { delay }); }
/** Type `name` and wait for the prompt that offers its pseudonym. */
async function typeToPrompt(page, name) {
  await type(page, name);
  await page.waitForFunction(() => !document.getElementById("type-tip").hidden, null, { timeout: 3000 }).catch(() => {});
  return page.evaluate(() => !document.getElementById("type-tip").hidden);
}
async function save(page) {
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !/^Saving/.test(document.getElementById("st-dirty").textContent), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
}
const lastSave = (log) => log.toasts.filter((t) => /Saved|Not saved|Nothing/.test(t)).slice(-1)[0] || "";
/** The synthetic clipboard: a cut or copy event's data, kept, and handed to a paste. */
async function clip(page, kind) {
  return page.evaluate((kind) => {
    const dt = window.__clip && kind === "paste" ? window.__clip : new DataTransfer();
    const ev = new ClipboardEvent(kind, { clipboardData: dt, bubbles: true, cancelable: true });
    const sel = getSelection();
    const at = sel.rangeCount ? sel.getRangeAt(0).startContainer : document.body;
    (at.nodeType === 1 ? at : at.parentElement).dispatchEvent(ev);
    if (kind !== "paste") window.__clip = dt;
    return dt.getData("text/plain");
  }, kind);
}

async function run() {
  srv = await startServer();
  browser = await chromium.launch({ executablePath: CHROME });
  try {
    // ── 1. a short cite typed ─────────────────────────────────────────────
    console.log("1. a short cite with no supra keeps its party, however it is typed");
    {
      const r = await newReader();
      const p = r.page;
      await caretAt(p, 0, 0);
      await type(p, " (Ashdale, 30 Cal.App.5th at p. 5.)");
      await save(p);
      let a = await fileText(p, "A Complaint.txt");
      truthy("typed at once and saved: the party as typed", a.includes("Plaintiff filed the complaint. (Ashdale, 30 Cal.App.5th at p. 5.)"));
      // …with a pause after the name: the converter marks it, and the cite
      // typed round it puts it back.
      await caretAt(p, 0, 1);
      await type(p, " (Ashdale,");
      await p.waitForTimeout(900);
      await type(p, " 31 Cal.App.5th at p. 9.)");
      await p.waitForTimeout(900);
      await save(p);
      a = await fileText(p, "A Complaint.txt");
      truthy("typed with a pause after the name: put back as typed", a.includes("The court so held. (Ashdale, 31 Cal.App.5th at p. 9.)"));
      // …the Style Manual's bare pin, behind "(".
      await caretAt(p, 0, 2);
      await type(p, " (Ashdale, at p. 5)");
      await save(p);
      a = await fileText(p, "A Complaint.txt");
      truthy("the bare pin, \"(Ashdale, at p. 5)\": as typed", a.includes("Nothing else. (Ashdale, at p. 5)"));
      check("nothing of it written as a pseudonym", /Wrenfield/.test(a), false);
      // Everything else typed is still faked.
      await caretAt(p, 0, 2);
      await type(p, " Ashdale agreed. Ashdale, 30 days later, signed. (Ashdale Decl., at p. 3)");
      await save(p);
      a = await fileText(p, "A Complaint.txt");
      truthy("a name typed in prose, before a number of days and in a record cite: its pseudonym",
        a.includes("(Ashdale, at p. 5) Wrenfield agreed. Wrenfield, 30 days later, signed. (Wrenfield Decl., at p. 3)"));
      check("no page errors", r.log.errors, []);
      await r.close();
    }

    // ── 2. a deletion beside a name the file carries ──────────────────────
    console.log("2. a deletion that slides over a name the file carries does not make it typed");
    {
      const r = await newReader();
      const p = r.page;
      // "(Ashford so held).\n" deleted from before "(Ashdale, …": the same
      // text is left whether it was taken from before "(Ash" or after it, and
      // read head first the deletion fell inside the name.
      truthy("selected", await selectByKeys(p, 1, "(Ashford so held).\n"));
      await p.keyboard.press("Backspace");
      await p.waitForTimeout(400);
      truthy("selected on page 3", await selectByKeys(p, 2, "(Ashford so held).\n"));
      await p.keyboard.press("Delete");
      await p.waitForTimeout(400);
      await save(p);
      const a = await fileText(p, "A Complaint.txt");
      truthy("a name with no citation after it stays as the file had it", a.includes("That was error (Ashdale, slip op. 5.)"));
      truthy("…and so does a short cite's party", a.includes("That was error (Ashdale, 30 Cal.App.5th at p. 5.)"));
      check("…neither written as a pseudonym", /Wrenfield/.test(a), false);
      truthy("…the one not read as a citation named in red, not yet reviewed", /not yet reviewed/.test(lastSave(r.log)) && /Ashdale/.test(lastSave(r.log)));
      check("no page errors", r.log.errors, []);
      await r.close();
    }

    // ── 3. Esc, and an edit that slides over the name ─────────────────────
    console.log("3. a name Esc left stays as typed when an edit slides over it");
    {
      const r = await newReader();
      const p = r.page;
      // Two parentheticals with a tail the reader does NOT read as a citation,
      // each name Esc'd at the prompt.
      await caretAt(p, 0, 0);
      truthy("the prompt offers the first", await typeToPrompt(p, " Nothing. (Ashdale"));
      await p.keyboard.press("Escape");
      await type(p, ", 30 slip op. 5.)");
      await caretAt(p, 0, 1);
      truthy("…and the second", await typeToPrompt(p, " End. (Ashdale"));
      await p.keyboard.press("Escape");
      await type(p, ", 31 slip op. 9.)");
      await p.waitForTimeout(600);
      // The first one deleted through to just before the second "(Ashdale":
      // what it took ends with ". " and the text after it begins "(Ash…" — it
      // slides.
      truthy("selected", await selectByKeys(p, 0, "(Ashdale, 30 slip op. 5.)\nThe court so held. End. "));
      await p.keyboard.press("Backspace");
      await p.waitForTimeout(600);
      check("the lines joined", (await screenLines(p, 0))[0], "Plaintiff filed the complaint. Nothing. (Ashdale, 31 slip op. 9.)");
      await save(p);
      const a = await fileText(p, "A Complaint.txt");
      truthy("the second keeps its name", a.includes("Nothing. (Ashdale, 31 slip op. 9.)"));
      check("…never its pseudonym", /Wrenfield/.test(a), false);
      truthy("…and the save says it was left as typed, its place not followed", /left as typed in/.test(lastSave(r.log)));
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    {
      // …the same with real short cites, which are read as citations now.
      const r = await newReader();
      const p = r.page;
      await caretAt(p, 0, 0);
      await typeToPrompt(p, " Nothing. (Ashdale");
      await p.keyboard.press("Escape");
      await type(p, ", 30 Cal.App.5th at p. 5.)");
      await caretAt(p, 0, 1);
      await typeToPrompt(p, " End. (Ashdale");
      await p.keyboard.press("Escape");
      await type(p, ", 31 Cal.App.5th at p. 9.)");
      await p.waitForTimeout(600);
      truthy("selected", await selectByKeys(p, 0, "(Ashdale, 30 Cal.App.5th at p. 5.)\nThe court so held. End. "));
      await p.keyboard.press("Backspace");
      await p.waitForTimeout(600);
      await save(p);
      const a = await fileText(p, "A Complaint.txt");
      truthy("short cites: the second keeps its party", a.includes("Nothing. (Ashdale, 31 Cal.App.5th at p. 9.)"));
      check("…never its pseudonym", /Wrenfield/.test(a), false);
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    {
      // A deletion that does not slide is followed exactly: no warning.
      const r = await newReader();
      const p = r.page;
      await caretAt(p, 0, 1);
      await typeToPrompt(p, " Then (Ashdale");
      await p.keyboard.press("Escape");
      await type(p, ", slip op. 5.)");
      await p.waitForTimeout(600);
      truthy("selected", await selectByKeys(p, 0, "complaint.\nThe court "));
      await p.keyboard.press("Backspace");
      await p.waitForTimeout(600);
      await save(p);
      const a = await fileText(p, "A Complaint.txt");
      truthy("a deletion that does not slide: the name as typed", a.includes("Plaintiff filed the so held. Then (Ashdale, slip op. 5.)"));
      // (The Esc'd name waits for the review, named with the rest; only the
      // warning that its place could not be followed is not said.)
      check("…and not said to be a place the reader could not follow", /left as typed in/.test(lastSave(r.log)), false);
      // The Esc'd name's line deleted whole: a name typed later is offered
      // and faked as any other, never taken for the one Esc left.
      truthy("selected the line", await selectByKeys(p, 0, "Plaintiff filed the so held. Then (Ashdale, slip op. 5.)"));
      await p.keyboard.press("Backspace");
      await p.waitForTimeout(500);
      await caretAt(p, 0, 1);
      await type(p, " Ashdale agreed.");
      await p.waitForTimeout(900);
      await save(p);
      truthy("…and a name typed after it is gone: its pseudonym", (await fileText(p, "A Complaint.txt")).includes("Nothing else. Wrenfield agreed."));
      check("no page errors", r.log.errors, []);
      await r.close();
    }

    // ── 4. the reader's own cut and paste ─────────────────────────────────
    console.log("4. a name Esc left goes with the reader's own cut and paste");
    {
      const r = await newReader();
      const p = r.page;
      await caretAt(p, 0, 0);
      truthy("the prompt offers it", await typeToPrompt(p, " (Ashdale"));
      await p.keyboard.press("Escape");
      await type(p, ", slip op. 5.)");
      await p.waitForTimeout(600);
      truthy("selected", await selectText(p, 0, "(Ashdale, slip op. 5.)"));
      const cut = await clip(p, "cut");
      check("the clipboard has the pseudonym, as everything that leaves the reader", cut, "(Wrenfield, slip op. 5.)");
      await p.waitForTimeout(400);
      await caretAt(p, 0, 2);
      await type(p, " ");
      await clip(p, "paste");
      await p.waitForTimeout(600);
      check("pasted, the name is back as typed", (await screenLines(p, 0))[2], "Nothing else. (Ashdale, slip op. 5.)");
      await save(p);
      const a = await fileText(p, "A Complaint.txt");
      truthy("…and the file has it as typed", a.includes("Nothing else. (Ashdale, slip op. 5.)"));
      check("…never its pseudonym", /Wrenfield/.test(a), false);
      // A paste from anywhere else is new text, offered and marked as before.
      await caretAt(p, 0, 1);
      await p.evaluate(() => { const dt = new DataTransfer(); dt.setData("text/plain", " Ashdale agreed."); window.__clip = dt; });
      await clip(p, "paste");
      await p.waitForTimeout(900);
      await save(p);
      truthy("a foreign paste of the name: its pseudonym", (await fileText(p, "A Complaint.txt")).includes("The court so held. Wrenfield agreed."));
      check("no page errors", r.log.errors, []);
      await r.close();
    }

    {
      // On pleading paper: the line's text taken with Shift+Home and Ctrl+X,
      // pasted at the end of another line.
      const r = await newReader("N Declaration.txt");
      const p = r.page;
      await caretAt(p, 0, 3);
      truthy("the prompt offers it", await typeToPrompt(p, " (Ashdale"));
      await p.keyboard.press("Escape");
      await type(p, ", 30 slip op. 5.)");
      await p.waitForTimeout(600);
      await caretAt(p, 0, 3);
      await p.keyboard.press("Shift+Home");
      check("Shift+Home takes the line's text", await p.evaluate(() => getSelection().toString()), "End. (Ashdale, 30 slip op. 5.)");
      check("cut, in the pseudonyms", await clip(p, "cut"), "End. (Wrenfield, 30 slip op. 5.)");
      await p.waitForTimeout(400);
      await caretAt(p, 0, 1);
      await type(p, " ");
      await clip(p, "paste");
      await p.waitForTimeout(600);
      await save(p);
      const n = await fileText(p, "N Declaration.txt");
      truthy("pasted on line 2: the name as typed", n.includes(" 2  Nothing else. End. (Ashdale, 30 slip op. 5.)"));
      check("…never its pseudonym", /Wrenfield/.test(n), false);
      check("no page errors", r.log.errors, []);
      await r.close();
    }

    // ── 5. Ctrl+Backspace and the line numbers ────────────────────────────
    console.log("5. Ctrl+Backspace and Ctrl+Delete never take a line's number");
    {
      const r = await newReader("N Declaration.txt");
      const p = r.page;
      await caretAt(p, 0, 2, { head: true });
      await p.keyboard.press("Control+Backspace");
      await p.waitForTimeout(300);
      await caretAt(p, 0, 1);
      await p.keyboard.press("Control+Delete");
      await p.waitForTimeout(300);
      check("both refused: every line as it was", await screenLines(p, 0), ["DECLARATION", "Nothing else.", "The vehicle was sold.", "End."]);
      truthy("…and said", r.log.toasts.some((t) => /line numbers are fixed/.test(t)));
      // Inside a line the word goes as before.
      await caretAt(p, 0, 2);
      await p.keyboard.press("Control+Backspace");
      await p.waitForTimeout(300);
      truthy("mid-line, Ctrl+Backspace takes the word: " + JSON.stringify((await screenLines(p, 0))[2]), /^The vehicle was (sold)?$/.test((await screenLines(p, 0))[2].trim()));
      await save(p);
      const n = await fileText(p, "N Declaration.txt");
      check("the file keeps every number", n.split("\n").slice(1, 5).map((l) => l.slice(0, 2)), [" 1", " 2", " 3", " 4"]);
      check("no page errors", r.log.errors, []);
      await r.close();
    }

    // ── 6. the cites PDF-Linker keeps that the reader did not read ────────
    console.log("6. a matter named without a v., a writ, a federal reporter and a cite across a page keep their party; the case's own caption does not");
    {
      const r = await newReader();
      const p = r.page;
      await caretAt(p, 0, 0);
      await type(p, " See In re Marriage of Ashdale (2008) 167 Cal.App.4th 562.");
      await caretAt(p, 0, 1);
      await type(p, " Ashdale v. Superior Court (Gelman) (2019) 30 Cal.App.5th 1. Gelman v. Ashdale, 500 F. Supp. 2d 100 (N.D. Cal. 2007).");
      await caretAt(p, 0, 2);
      await type(p, " In this action, Ashdale v. Quarrow Motors (2025), the plaintiff sued.");
      await save(p);
      const a = await fileText(p, "A Complaint.txt");
      truthy("In re Marriage of: as typed", a.includes("Plaintiff filed the complaint. See In re Marriage of Ashdale (2008) 167 Cal.App.4th 562."));
      truthy("a writ's real party and a federal reporter: as typed", a.includes("The court so held. Ashdale v. Superior Court (Gelman) (2019) 30 Cal.App.5th 1. Gelman v. Ashdale, 500 F. Supp. 2d 100 (N.D. Cal. 2007)."));
      truthy("the case's own caption recited with a year: its pseudonyms", a.includes("Nothing else. In this action, Wrenfield v. Brindle Works (2025), the plaintiff sued."));
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    {
      const r = await newReader("C Brief.txt");
      const p = r.page;
      await caretAt(p, 0, 1);
      await type(p, " Gelman v. Ashdale");
      await caretAt(p, 0, 0);
      await type(p, " Ashdale agreed.");
      await p.waitForTimeout(900);
      await save(p);
      const c = await fileText(p, "C Brief.txt");
      truthy("a name closing the page, its year on the next: as typed", c.includes("As held in Gelman v. Ashdale\n"));
      truthy("…and one in prose above it: its pseudonym", c.includes("The rule is settled. Wrenfield agreed."));
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
