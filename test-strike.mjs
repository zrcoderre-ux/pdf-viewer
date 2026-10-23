// Browser test for words struck through (viewer/text-reader.js, "words struck
// through"; textdoc.js strikeEdit / strikeRuns): words selected and struck
// (S̶ Strike, Ctrl+Shift+X or K) are written ~~like this~~ in the file and
// shown struck with the marks hidden; a selection that reaches into a name
// takes the name whole; a selection over two lines strikes each line's piece
// and over two columns each column's; pressed on struck words it takes the
// strike off them, leaving the run either side; Ctrl+Z takes it back; marks a
// run wrote come back byte for byte from a save that changed nothing else; and
// Combined Text.txt takes no strike.
//
// Run: node test-strike.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium),
// python3 with openpyxl (to build the key) and a free port in 8130-8199 for
// python3's http.server; exits 0 with SKIP where any is missing. Every name
// in it is invented.

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
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "strike-")), "pseudonym_key.xlsx");
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

const CASE = "Case Strike";
const A = [
  "====== Page 1 ======",
  " 1  DECLARATION OF TOBIAS WRENFIELD",
  " 2  I met the buyer in",
  " 3  Los Angeles on Friday.",
  " 4  LESSOR SIGNS HERE        LESSEE SIGNS HERE",
  "====== Page 2 ======",
  " 1  Further, the buyer paid.",
].join("\n") + "\n";
// An export a run wrote with a strike from the PDF in it.
const B = [
  "====== Page 1 ======",
  "The ~~letter of May 4~~ was sent.",
].join("\n") + "\n";
// A name a struck passage wraps, as PDF-Linker writes it: a run a line.
const W = [
  "====== Page 1 ======",
  "The deposit was ~~paid by Tobias~~",
  "~~Wrenfield on Friday~~ in cash.",
].join("\n") + "\n";
const COMBINED = [
  "#### DOCUMENT 1 OF 1 IN THIS COMBINED FILE: B Letter.txt ####",
  "====== Page 1 ======",
  "The letter of May 4 was sent.",
].join("\n") + "\n";

let srv = null, browser = null;
async function openDoc(page, name) {
  await page.evaluate((n) => window.__textReaderOpenDoc(n), name);
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.waitForTimeout(800);
}
async function newReader({ doc = "A Decl.txt" } = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const log = { errors: [] };
  page.on("pageerror", (e) => log.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) log.errors.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto(srv.base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
  await page.evaluate(async ({ CASE, A, B, W, COMBINED, keyBytes }) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(CASE, { create: true });
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    await put(text, "A Decl.txt", A);
    await put(text, "B Letter.txt", B);
    await put(text, "W Wrapped.txt", W);
    await put(dir, "Combined Text.txt", COMBINED);
    window.__case = dir;
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, A, B, W, COMBINED, keyBytes: Array.from(KEY_BYTES) });
  await page.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event("change")); } });
  await openDoc(page, doc);
  return { context, page, log, close: () => context.close() };
}
const readFile = (page, name) => page.evaluate(async (n) => {
  const text = await window.__case.getDirectoryHandle("Text Files");
  return (await (await text.getFileHandle(n)).getFile()).text();
}, name);
/** Select from `from` to `to` (the text of two places on the pages, `to` taken through its last character), as a drag would. */
const selectText = (page, i, from, to) => page.evaluate(({ i, from, to }) => {
  const body = document.querySelectorAll("#pages .tpage")[i].querySelector(".page-body");
  const find = (what, end) => {
    const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.parentElement.closest(".gutter, .sk")) continue;
      const at = n.data.indexOf(what);
      if (at >= 0) return [n, end ? at + what.length : at];
    }
    return null;
  };
  const a = find(from, false), b = find(to, true);
  if (!a || !b) return false;
  const r = document.createRange();
  r.setStart(a[0], a[1]); r.setEnd(b[0], b[1]);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  return true;
}, { i, from, to });
/** What page `i` shows struck: each wrapper's text as it reads on screen, the marks hidden. */
const struck = (page, i) => page.evaluate((i) => {
  const body = document.querySelectorAll("#pages .tpage")[i].querySelector(".page-body");
  const out = [];
  for (const st of body.querySelectorAll(".st")) {
    if (getComputedStyle(st).textDecorationLine !== "line-through") return ["not drawn struck: " + st.textContent];
    const shown = [...st.childNodes].filter((n) => !(n.nodeType === 1 && n.classList.contains("sk"))).map((n) => n.textContent).join("");
    if (shown) out.push(shown);
  }
  for (const sk of body.querySelectorAll(".sk")) if (getComputedStyle(sk).display !== "none") return ["a mark shows: " + sk.textContent];
  return out;
}, i);
/** The page's text as it reads on screen. */
const shownText = (page, i) => page.evaluate((i) => document.querySelectorAll("#pages .tpage")[i].querySelector(".page-body").innerText, i);
const toastText = (page) => page.evaluate(() => document.getElementById("toast").textContent);

async function run() {
  srv = await startServer();
  browser = await launchBrowser(chromium, CHROME);
  try {
    console.log("1. words struck through, on a line, across a name, over two lines and two columns; saved");
    {
      const r = await newReader();
      const p = r.page;
      truthy("words selected", await selectText(p, 1, "the buyer", "paid"));
      await p.keyboard.press("Control+Shift+X");
      await p.waitForTimeout(300);
      check("shown struck, the marks hidden", await struck(p, 1), ["the buyer paid"]);
      check("…and read without them", (await shownText(p, 1)).includes("~"), false);
      // On screen the name reads as the real one; half of it is selected.
      truthy("a selection into a name", await p.evaluate(() => {
        const body = document.querySelector("#pages .tpage .page-body");
        const pn = body.querySelector(".pn");
        const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode()) && !n.data.includes("OF ")) { /* on */ }
        if (!n || !pn) return false;
        const r = document.createRange();
        r.setStart(n, n.data.indexOf("OF ")); r.setEnd(pn.firstChild, 4);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        return true;
      }));
      await p.keyboard.press("Control+Shift+X");
      await p.waitForTimeout(300);
      truthy("passage over two lines", await selectText(p, 0, "met the buyer", "Los Angeles"));
      await p.click("#strike-btn");
      await p.waitForTimeout(300);
      truthy("two columns", await selectText(p, 0, "SIGNS HERE", "LESSEE SIGNS"));
      await p.keyboard.press("Control+Shift+X");
      await p.waitForTimeout(300);
      check("all of it shown struck", await struck(p, 0), ["OF CORWIN ASHDALE", "met the buyer in", "Los Angeles", "SIGNS HERE", "LESSEE SIGNS"]);
      truthy("the document is unsaved", await p.evaluate(() => !document.getElementById("save").disabled));
      await p.keyboard.press("Control+s");
      await p.waitForTimeout(1500);
      check("the file carries the marks, the name as its pseudonym, the margin numbers as they were", await readFile(p, "A Decl.txt"), [
        "====== Page 1 ======",
        " 1  DECLARATION ~~OF TOBIAS WRENFIELD~~",
        " 2  I ~~met the buyer in~~",
        " 3  ~~Los Angeles~~ on Friday.",
        " 4  LESSOR ~~SIGNS HERE~~        ~~LESSEE SIGNS~~ HERE",
        "====== Page 2 ======",
        " 1  Further, ~~the buyer paid~~.",
      ].join("\n") + "\n");
      console.log("2. the strike taken off part of a run, and put back by Ctrl+Z");
      truthy("a word inside a run", await selectText(p, 0, "buyer", "buyer"));
      await p.keyboard.press("Control+Shift+X");
      await p.waitForTimeout(300);
      check("the run either side stays struck", await struck(p, 0), ["OF CORWIN ASHDALE", "met the", "in", "Los Angeles", "SIGNS HERE", "LESSEE SIGNS"]);
      truthy("…and a toast says it came off", /taken off/.test(await toastText(p)));
      await p.evaluate(() => document.querySelector("#pages .tpage .page-body").focus());
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(400);
      check("Ctrl+Z puts it back", await struck(p, 0), ["OF CORWIN ASHDALE", "met the buyer in", "Los Angeles", "SIGNS HERE", "LESSEE SIGNS"]);
      truthy("nothing but spaces", await p.evaluate(() => {
        const body = document.querySelector("#pages .tpage .page-body");
        const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode()) && !/ {4}/.test(n.data)) { /* on */ }
        if (!n) return false;
        const at = n.data.indexOf("    ");
        const r = document.createRange();
        r.setStart(n, at); r.setEnd(n, at + 4);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        return true;
      }));
      await p.keyboard.press("Control+Shift+X");
      await p.waitForTimeout(300);
      truthy("…is refused, and says why", /Nothing there to strike/.test(await toastText(p)));
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("3. a strike a run wrote: shown struck, K takes it off, and a save of other edits leaves it byte for byte");
    {
      const r = await newReader({ doc: "B Letter.txt" });
      const p = r.page;
      check("shown struck", await struck(p, 0), ["letter of May 4"]);
      check("…read without its marks", (await shownText(p, 0)).trim(), "The letter of May 4 was sent.");
      // Typed at the end of the line, away from the run, with ✎ Edit on (a
      // strike, like a comment, is made with the document protected).
      await p.click("#edit-toggle");
      await p.evaluate(() => {
        const body = document.querySelector("#pages .tpage .page-body");
        const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        let last = null, n;
        while ((n = w.nextNode())) if (n.data.includes("sent")) last = n;
        const r = document.createRange(); r.setStart(last, last.data.length); r.collapse(true);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        body.focus();
      });
      await p.keyboard.type(" Twice.", { delay: 15 });
      await p.waitForTimeout(700);
      await p.keyboard.press("Control+s");
      await p.waitForTimeout(1500);
      check("the marks stand where they stood", await readFile(p, "B Letter.txt"), "====== Page 1 ======\nThe ~~letter of May 4~~ was sent. Twice.\n");
      truthy("the struck words selected", await selectText(p, 0, "letter", "May 4"));
      await p.evaluate(() => document.activeElement && document.activeElement.blur());
      await p.keyboard.press("k");
      await p.waitForTimeout(300);
      check("K takes the strike off", await struck(p, 0), []);
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("4. a name a struck passage wraps reads as the real name, struck, and saves as it was");
    {
      const r = await newReader({ doc: "W Wrapped.txt" });
      const p = r.page;
      check("both lines' runs struck, the name real on screen", await struck(p, 0), ["paid by Corwin", "Ashdale on Friday"]);
      check("…its pieces marked as the one name", await p.evaluate(() => [...document.querySelectorAll("#pages .pn")].map((s) => s.textContent)), ["Corwin", "Ashdale"]);
      truthy("other words selected", await selectText(p, 0, "in cash", "in cash"));
      await p.keyboard.press("Control+Shift+X");
      await p.waitForTimeout(300);
      await p.keyboard.press("Control+s");
      await p.waitForTimeout(1500);
      check("the file: the new strike joined to the run beside it, the fake as it was", await readFile(p, "W Wrapped.txt"),
        W.replace("~~Wrenfield on Friday~~ in cash.", "~~Wrenfield on Friday in cash~~."));
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("5. Combined Text.txt takes no strike");
    {
      const r = await newReader();
      const p = r.page;
      await p.evaluate(() => window.__textReaderOpenDoc("Combined Text.txt"));
      await p.waitForTimeout(1200);
      truthy("words selected", await selectText(p, 1, "The letter", "letter"));
      await p.keyboard.press("Control+Shift+X");
      await p.waitForTimeout(300);
      check("nothing struck", await struck(p, 1), []);
      truthy("…and a toast says why", /Combined Text\.txt/.test(await toastText(p)));
      check("no page errors", r.log.errors, []);
      await r.close();
    }
  } finally {
    if (browser) await browser.close();
    if (srv) srv.stop();
  }
}
await run();
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
