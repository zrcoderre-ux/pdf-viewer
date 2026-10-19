// Browser test for comments on a text export (viewer/text-reader.js, "comments
// on the document"; textdoc.js commentsBlock / parseComments / findPassage):
// a passage selected and commented on (C, or 💬 Comment) is marked and
// counted, a real name typed into the comment is written as its pseudonym and
// shown as the real one, the save writes the block after the last page, and
// reopened the comment is read, changed and deleted from its passage; a block
// PDF-Linker wrote comes back byte for byte from a save that changed nothing
// else, and Combined Text.txt takes no comment.
//
// Run: node test-comments.mjs   (from the repo root)
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
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "comments-")), "pseudonym_key.xlsx");
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

const CASE = "Case Comments";
const HEAD = "====== Comments (not part of the document) ======";
const A = [
  "====== Page 1 ======",
  " 1  DECLARATION OF TOBIAS WRENFIELD",
  " 2  I met the buyer in",
  " 3  Los Angeles on Friday.",
  "====== Page 2 ======",
  " 1  Further, the buyer paid.",
].join("\n") + "\n";
// An export a run wrote with a comment from the PDF in it.
const B = [
  "====== Page 1 ======",
  "The letter of May 4.",
  "",
  HEAD,
  '[c1] Page 1, on "letter of May 4": Is this the "right" date? [id pdfv-abc123]',
].join("\n") + "\n";
const COMBINED = [
  "#### DOCUMENT 1 OF 1 IN THIS COMBINED FILE: B Letter.txt ####",
  "====== Page 1 ======",
  "The letter of May 4.",
  "",
  HEAD,
  '[c1] Page 1, on "letter of May 4": Is this the "right" date? [id pdfv-abc123]',
].join("\n") + "\n";

let srv = null, browser = null;
let savedA = A; // the file part 1 saves, which part 2 opens
async function openDoc(page, name) {
  await page.evaluate((n) => window.__textReaderOpenDoc(n), name);
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.waitForTimeout(800);
}
async function newReader({ a = A } = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const log = { errors: [] };
  page.on("pageerror", (e) => log.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) log.errors.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto(srv.base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
  await page.evaluate(async ({ CASE, A, B, COMBINED, keyBytes }) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(CASE, { create: true });
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    await put(text, "A Decl.txt", A);
    await put(text, "B Letter.txt", B);
    await put(dir, "Combined Text.txt", COMBINED);
    window.__case = dir;
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, A: a, B, COMBINED, keyBytes: Array.from(KEY_BYTES) });
  await page.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event("change")); } });
  await openDoc(page, "A Decl.txt");
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
      if (n.parentElement.closest(".gutter")) continue;
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
const marked = (page) => page.evaluate(() => { const h = CSS.highlights.get("comment"); return h ? [...h].map((r) => r.toString()) : []; });
const badge = (page, i) => page.evaluate((i) => { const b = document.querySelectorAll("#pages .tpage")[i].querySelector(".page-label .cmt-page"); return b ? b.textContent : null; }, i);
const pop = (page) => page.evaluate(() => {
  const p = document.getElementById("comment-pop");
  return p.hidden ? null : { where: document.getElementById("comment-pop-where").textContent, on: document.getElementById("comment-pop-on").textContent,
    text: document.getElementById("comment-pop-text").hidden ? null : document.getElementById("comment-pop-text").textContent,
    editing: !document.getElementById("comment-pop-input").hidden };
});
/** A click in the middle of the comment's mark. */
async function clickMark(page, k = 0) {
  const pt = await page.evaluate((k) => { const r = [...CSS.highlights.get("comment")][k].getClientRects()[0]; return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, k);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(150);
}

async function run() {
  srv = await startServer();
  browser = await chromium.launch({ executablePath: CHROME });
  try {
    console.log("1. a passage commented on, a real name in the comment, saved");
    {
      const r = await newReader();
      const p = r.page;
      truthy("passage selected", await selectText(p, 0, "met the buyer", "Los Angeles"));
      await p.keyboard.press("c");
      await p.waitForTimeout(200);
      const box = await pop(p);
      check("C opens the box to type in", box && [box.where, box.on, box.editing], ["💬 Page 1", "on \u201cmet the buyer in Los Angeles\u201d", true]);
      await p.keyboard.type("Ask Corwin Ashdale where.");
      await p.keyboard.press("Control+Enter");
      await p.waitForTimeout(400);
      check("the box closes", await pop(p), null);
      check("the passage is marked, across the margin", await marked(p), ["met the buyer in", "Los Angeles"]);
      check("the page's label counts it", await badge(p, 0), "💬 1");
      check("the tab counts it", await p.evaluate(() => document.getElementById("comments-count").textContent), "1");
      check("…and lists it as it reads", await p.evaluate(() => document.querySelector("#comments-list li .lv").textContent), "Ask Corwin Ashdale where.");
      truthy("the document is unsaved", await p.evaluate(() => !document.getElementById("save").disabled));
      await p.keyboard.press("Control+s");
      await p.waitForTimeout(1500);
      const file = await readFile(p, "A Decl.txt");
      const want = new RegExp("^" + A.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\n" + HEAD.replace(/[()]/g, "\\$&") + '\\n\\[c1\\] Page 1, on "met the buyer in Los Angeles": Ask Tobias Wrenfield where\\. \\[id rdc-[a-z]{10}\\]\\n$');
      truthy("the file has the block after the last page, the name as its pseudonym:\n" + file, want.test(file));
      savedA = file;
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("2. reopened: read from its passage, changed, deleted");
    {
      const r = await newReader({ a: savedA });
      const p = r.page;
      check("marked again", await marked(p), ["met the buyer in", "Los Angeles"]);
      await clickMark(p);
      check("a click on the passage opens the comment, the name real", await pop(p), { where: "💬 Page 1", on: "on \u201cmet the buyer in Los Angeles\u201d", text: "Ask Corwin Ashdale where.", editing: false });
      await p.click("#comment-pop-edit");
      check("Edit puts the comment in the box as it reads", await p.evaluate(() => document.getElementById("comment-pop-input").value), "Ask Corwin Ashdale where.");
      await p.fill("#comment-pop-input", "Ask Corwin Ashdale when, too.");
      await p.click("#comment-pop-save");
      await p.waitForTimeout(300);
      await p.keyboard.press("Control+s");
      await p.waitForTimeout(1500);
      truthy("changed in the file, its id kept", /: Ask Tobias Wrenfield when, too\. \[id rdc-[a-z]{10}\]\n$/.test(await readFile(p, "A Decl.txt")));
      await clickMark(p);
      await p.click("#comment-pop-delete");
      await p.waitForTimeout(300);
      check("deleted: no mark", await marked(p), []);
      check("…no count on the label", await badge(p, 0), null);
      await p.keyboard.press("Control+s");
      await p.waitForTimeout(1500);
      const file = await readFile(p, "A Decl.txt");
      check("…and no block in the file", file.includes(HEAD), false);
      check("…the document as it was", file.replace(/\n+$/, "\n"), A);
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("3. a block PDF-Linker wrote: shown, and a save of other edits leaves it byte for byte");
    {
      const r = await newReader();
      const p = r.page;
      await openDoc(p, "B Letter.txt");
      check("its comment is shown", await p.evaluate(() => document.querySelector("#comments-list li .lv").textContent), 'Is this the "right" date?');
      check("…on its passage", await marked(p), ["letter of May 4"]);
      check("…and the block is not on the page", await p.evaluate(() => document.querySelector("#pages .page-body").textContent.includes("Comments")), false);
      await p.evaluate(() => document.getElementById("edit-toggle").click());
      await p.waitForTimeout(200);
      await p.evaluate(() => {
        const body = document.querySelector("#pages .page-body");
        const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        let n; while ((n = w.nextNode())) if (n.data.includes("May 4")) break;
        const at = n.data.indexOf("May 4") + 5;
        const r = document.createRange(); r.setStart(n, at); r.collapse(true);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r); body.focus();
      });
      await p.keyboard.type(", 2024");
      await p.waitForTimeout(600);
      await p.keyboard.press("Control+s");
      await p.waitForTimeout(1500);
      check("the edit saved, the block as it was", await readFile(p, "B Letter.txt"), B.replace("The letter of May 4.", "The letter of May 4, 2024."));
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("4. Combined Text.txt shows its members' comments and takes none");
    {
      const r = await newReader();
      const p = r.page;
      await p.evaluate(() => window.__textReaderOpenDoc("Combined Text.txt"));
      await p.waitForTimeout(1200);
      check("its member's comment is shown", await marked(p), ["letter of May 4"]);
      truthy("passage selected", await selectText(p, 1, "The letter", "letter"));
      await p.keyboard.press("c");
      await p.waitForTimeout(200);
      check("no box opens", await pop(p), null);
      truthy("…and a toast says why", /Combined Text\.txt/.test(await p.evaluate(() => document.getElementById("toast").textContent)));
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
