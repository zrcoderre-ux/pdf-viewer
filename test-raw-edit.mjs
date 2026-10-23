// Browser test for typing into a page shown ⇄ Raw (viewer/text-reader.js:
// commitRaw, fillRaw's `.raw-head`): under ✎ Edit the file's text takes
// typing, the page is built again from it, a pseudonym typed reads as its
// real name on the page, a real name typed is written as its pseudonym, the
// page header takes no edit, Ctrl+Z on the pages takes the typing back, a save writes what was typed, a line break typed is one in the file, and with ✎ Edit
// off the sheet takes nothing.
//
// Run: node test-raw-edit.mjs   (from the repo root)
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
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "raw-edit-")), "pseudonym_key.xlsx");
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
  ["person-token", "Ashdale", "Wrenfield", "", "", "spreadsheet", 4],
]);

const CASE = "Case Raw";
const A = [
  "====== Page 1 ======",
  "Plaintiff filed the complaint.",
  "Tobias Wrenfield answered.",
  "====== Page 2 ======",
  "Nothing else.",
].join("\n") + "\n";

let srv = null, browser = null;
async function newReader({ edit = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const log = { errors: [], toasts: [] };
  page.on("pageerror", (e) => log.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) log.errors.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto(srv.base + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
  await page.evaluate(async ({ CASE, A, keyBytes }) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle(CASE, { create: true });
    const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
    const text = await dir.getDirectoryHandle("Text Files", { create: true });
    await put(text, "A Complaint.txt", A);
    window.__case = dir;
    await window.__textReaderAdoptFolder(dir);
  }, { CASE, A, keyBytes: Array.from(KEY_BYTES) });
  await page.evaluate(() => { const t = document.getElementById("reel-toggle"); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event("change")); } });
  await page.evaluate((n) => window.__textReaderOpenDoc(n), "A Complaint.txt");
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.waitForTimeout(800);
  if (edit) { await page.evaluate(() => document.getElementById("edit-toggle").click()); await page.waitForTimeout(200); }
  return { context, page, log, close: () => context.close() };
}
const fileText = (page) => page.evaluate(async () => {
  const t = await window.__case.getDirectoryHandle("Text Files");
  return (await (await t.getFileHandle("A Complaint.txt")).getFile()).text();
});
const screenText = (page, i) => page.evaluate((i) => [...document.querySelectorAll("#pages .tpage")[i].querySelectorAll(".page-body .line")]
  .map((l) => (l.querySelector(".lt") || l).textContent).join("\n"), i);
const rawText = (page, i) => page.evaluate((i) => document.querySelectorAll("#pages .tpage")[i].querySelector(".raw-sheet .raw-text").textContent, i);
const toggleRaw = (page, i) => page.evaluate((i) => document.querySelectorAll("#pages .tpage")[i].querySelector(".page-label .raw-page").click(), i);
/** The caret in page `i`'s raw sheet, just after the first `what`. */
const caretAfter = (page, i, what) => page.evaluate(({ i, what }) => {
  const pre = document.querySelectorAll("#pages .tpage")[i].querySelector(".raw-sheet .raw-text");
  pre.focus();
  const w = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const k = n.data.indexOf(what);
    if (k >= 0) { const r = document.createRange(); r.setStart(n, k + what.length); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; }
  }
  return false;
}, { i, what });
async function save(page) {
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !/^Saving/.test(document.getElementById("st-dirty").textContent), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function run() {
  srv = await startServer();
  browser = await launchBrowser(chromium, CHROME);
  try {
    console.log("1. typing into a raw page under ✎ Edit");
    {
      const r = await newReader();
      const p = r.page;
      await toggleRaw(p, 0);
      await p.waitForTimeout(200);
      check("the sheet is the file's text", await rawText(p, 0), "====== Page 1 ======\nPlaintiff filed the complaint.\nTobias Wrenfield answered.");
      truthy("the sheet takes typing", await p.evaluate(() => document.querySelector(".raw-sheet .raw-text").isContentEditable));
      truthy("…and its header does not", await p.evaluate(() => !document.querySelector(".raw-sheet .raw-head").isContentEditable));
      truthy("caret placed", await caretAfter(p, 0, "complaint."));
      await p.keyboard.type(" Tobias Wrenfield signed it.", { delay: 10 });
      await p.waitForTimeout(700);
      check("the page is built from the sheet: the pseudonym reads as its real name",
        await screenText(p, 0), "Plaintiff filed the complaint. Corwin Ashdale signed it.\nCorwin Ashdale answered.");
      check("the caret is still in the sheet", await p.evaluate(() => document.activeElement && document.activeElement.classList.contains("raw-text")), true);
      truthy("💾 Save is lit", await p.evaluate(() => !document.getElementById("save").disabled));
      // A real name typed into the sheet is written as its pseudonym.
      await caretAfter(p, 0, "answered.");
      await p.keyboard.press("Enter");
      await p.keyboard.type("Corwin Ashdale agreed.", { delay: 10 });
      await p.waitForTimeout(200);
      await save(p);
      const a = await fileText(p);
      check("the save writes what was typed, the real name as its pseudonym", a,
        "====== Page 1 ======\nPlaintiff filed the complaint. Tobias Wrenfield signed it.\nTobias Wrenfield answered.\nTobias Wrenfield agreed.\n====== Page 2 ======\nNothing else.\n");
      // ⇄ Text puts the page back, with what was typed.
      await toggleRaw(p, 0);
      await p.waitForTimeout(300);
      check("back as text, the typing is the page's", await screenText(p, 0),
        "Plaintiff filed the complaint. Corwin Ashdale signed it.\nCorwin Ashdale answered.\nCorwin Ashdale agreed.");
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("2. typing under the header, committed on blur and undone from the pages");
    {
      const r = await newReader();
      const p = r.page;
      await toggleRaw(p, 1);
      await p.waitForTimeout(200);
      await caretAfter(p, 1, "else.");
      await p.keyboard.press("Enter");
      await p.keyboard.type("Signed.", { delay: 10 });
      await p.evaluate(() => document.activeElement.blur());
      await p.waitForTimeout(300);
      check("committed on blur", await screenText(p, 1), "Nothing else.\nSigned.");
      check("the header stands", (await rawText(p, 1)).split("\n")[0], "====== Page 2 ======");
      // Ctrl+Z on the page takes the typing back.
      await p.evaluate(() => document.querySelector("#pages .page-body").focus());
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(300);
      check("Ctrl+Z on the pages puts the page back", await screenText(p, 1), "Nothing else.");
      check("…and the sheet with it", await rawText(p, 1), "====== Page 2 ======\nNothing else.");
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("3. protected: the sheet takes nothing");
    {
      const r = await newReader({ edit: false });
      const p = r.page;
      await toggleRaw(p, 0);
      await p.waitForTimeout(200);
      truthy("not editable", await p.evaluate(() => !document.querySelector(".raw-sheet .raw-text").isContentEditable));
      await p.evaluate(() => document.getElementById("edit-toggle").click());
      await p.waitForTimeout(100);
      truthy("✎ Edit makes it editable", await p.evaluate(() => document.querySelector(".raw-sheet .raw-text").isContentEditable));
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("4. a narrow page: ⇄ Text stays in front, whatever wraps");
    {
      // The label's buttons wrap on a narrow page; the row that wrapped used
      // to hang under the label, covered by the sheet's "The file with your
      // unsaved edits" line (.page-label is a flow-root now).
      const r = await newReader();
      const p = r.page;
      await p.evaluate(() => document.documentElement.style.setProperty("--reader-width-eff", "260px"));
      await p.waitForTimeout(200);
      await toggleRaw(p, 0);
      await p.waitForTimeout(300);
      const seen = await p.evaluate(() => {
        const sec = document.querySelectorAll("#pages .tpage")[0];
        const lab = sec.querySelector(".page-label").getBoundingClientRect();
        return [...sec.querySelectorAll(".page-label button")].filter((b) => b.offsetParent).map((b) => {
          const r = b.getBoundingClientRect();
          const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { b: b.className, front: at === b || b.contains(at), inLabel: r.bottom <= lab.bottom + 0.5 };
        });
      });
      truthy("the buttons wrapped", seen.length > 2);
      check("every button in the label and in front", seen.filter((x) => !x.front || !x.inLabel), []);
      check("no page errors", r.log.errors, []);
      await r.close();
    }
    console.log("5. a line break typed into the sheet is a line break in the file");
    {
      // Chromium types Enter into the sheet (a plaintext-only <pre>) as a
      // <br>, which is no character of its text: the line typed after it ran
      // onto the line above (unbreakRaw).
      const r = await newReader();
      const p = r.page;
      await toggleRaw(p, 0);
      await p.waitForTimeout(200);
      await caretAfter(p, 0, "complaint.");
      await p.keyboard.press("Enter");
      await p.keyboard.press("Enter");
      await p.keyboard.type("Then a reply.", { delay: 10 });
      check("no <br> stands in the sheet", await p.evaluate(() => document.querySelectorAll(".raw-sheet .raw-text br").length), 0);
      check("the caret stays where the typing goes", await rawText(p, 0),
        "====== Page 1 ======\nPlaintiff filed the complaint.\n\nThen a reply.\nTobias Wrenfield answered.");
      await save(p);
      check("the save writes the blank line and the line typed", await fileText(p),
        "====== Page 1 ======\nPlaintiff filed the complaint.\n\nThen a reply.\nTobias Wrenfield answered.\n====== Page 2 ======\nNothing else.\n");
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
