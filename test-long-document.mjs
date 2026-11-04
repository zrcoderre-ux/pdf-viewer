// Browser test for a long document in a case folder (viewer/text-reader.js,
// "a long document by the page"): an export longer than LONG_DOC_PAGES goes
// up with a dozen pages built and the rest shed, and the reel builds and lets
// go of its pages as the reading moves — where before every page was built at
// the open (fifteen seconds holding the tab for a 1,200-page deposition) and
// every layout pass ran over all of them on every scroll. Checked: what is on
// screen is always built; a jump far into it; scrolling back up through pages
// built at the guessed height without the reading jumping; side by side, every
// page level with its PDF page; a page typed in kept built and its edit saved,
// the rest of the file byte for byte; a resize not building the whole of it;
// Find counting the hits on pages not built, standing on them, Replace on one;
// and the folder's other, ordinary documents beside it.
//
// Run: node test-long-document.mjs   (from the repo root)
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
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "long-doc-")), "pseudonym_key.xlsx");
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

const CASE = "Case Long";
const PAGES = 400;
const LONG = Array.from({ length: PAGES }, (_, k) => `====== Page ${k + 1} ======\n` + Array.from({ length: 28 }, (_, j) => String(j + 1).padStart(2) + `  Deposition page ${k + 1} line ${j + 1}, Tobias Wrenfield testified.`).join("\n")).join("\n") + "\n";
const SHORT = (who) => Array.from({ length: 5 }, (_, k) => `====== Page ${k + 1} ======\n` + Array.from({ length: 30 }, (_, j) => `${who} page ${k + 1}, line ${j + 1}.`).join("\n")).join("\n") + "\n";

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
    await p.evaluate(async ({ CASE, LONG, docs, keyBytes, PAGES }) => {
      const top = await navigator.storage.getDirectory();
      try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
      const dir = await top.getDirectoryHandle(CASE, { create: true });
      const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
      await put(dir, "pseudonym_key.xlsx", new Uint8Array(keyBytes));
      const text = await dir.getDirectoryHandle("Text Files", { create: true });
      await put(text, "B Depo.txt", LONG);
      for (const [name, t] of docs) await put(text, name + ".txt", t);
      const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
      const mk = async (name, n, line) => {
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.TimesRoman);
        for (let k = 0; k < n; k++) { const pg = pdf.addPage([612, 792]); for (let j = 0; j < 28; j++) pg.drawText(line(k, j), { x: 72, y: 720 - j * 22, size: 11, font }); }
        await put(dir, name, await pdf.save());
      };
      await mk("B Depo.pdf", PAGES, (k, j) => `${j + 1}  Deposition page ${k + 1} line ${j + 1}, Corwin Ashdale testified.`);
      for (const [name] of docs) await mk(name + ".pdf", 5, (k, j) => `${name} page ${k + 1}, line ${j + 1}.`);
      window.__dir = dir;
      await window.__textReaderAdoptFolder(dir);
    }, { CASE, LONG, docs: [["A Brief", SHORT("A Brief")], ["C Motion", SHORT("C Motion")], ["D Order", SHORT("D Order")], ["E Notice", SHORT("E Notice")]], keyBytes: Array.from(KEY_BYTES), PAGES });

    const state = () => p.evaluate(() => {
      const r0 = document.getElementById("stage").getBoundingClientRect();
      const vis = [...document.querySelectorAll("#pages .tpage")].filter((s) => { const r = s.getBoundingClientRect(); return r.bottom > r0.top && r.top < r0.bottom; });
      return { live: document.querySelectorAll("#pages .tpage:not(.shed)").length, visShed: vis.filter((s) => s.classList.contains("shed")).map((s) => Number(s.dataset.index)), vis: vis.map((s) => Number(s.dataset.index)) };
    });
    // The reel may hang the folder's other documents before and after the
    // deposition, which moves its pages' indexes: page n of it is found by
    // where the deposition starts on the reel.
    const at = (n) => p.evaluate((n) => window.__textReaderReel().members.find((m) => m.name === "B Depo.txt").from + n - 1, n);
    const goPage = async (n) => { const i = await at(n); await p.evaluate((i) => { document.getElementById("stage").scrollTop = document.querySelector(`#pages .tpage[data-index="${i}"]`).offsetTop; }, i); };
    const secShed = async (n) => { const i = await at(n); return p.evaluate((i) => document.querySelector(`#pages .tpage[data-index="${i}"]`).classList.contains("shed"), i); };
    const bodyText = async (n) => { const i = await at(n); return p.evaluate((i) => { const b = document.querySelector(`#pages .tpage[data-index="${i}"] .page-body`); return b ? b.textContent : null; }, i); };
    const fbCount = () => p.evaluate(() => document.getElementById("fb-count").textContent);
    const disk = () => p.evaluate(async () => (await (await (await window.__dir.getDirectoryHandle("Text Files")).getFileHandle("B Depo.txt")).getFile()).text());

    // An ordinary document first: built whole, as it always was.
    await p.evaluate((n) => window.__textReaderOpenDoc(n), "A Brief.txt");
    await p.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length === 5);
    check("an ordinary document: every page built", (await state()).live, 5);

    await p.evaluate((n) => window.__textReaderOpenDoc(n), "B Depo.txt");
    await p.waitForFunction((n) => document.querySelectorAll("#pages .tpage").length === n, PAGES, { timeout: 30000 });
    await p.waitForTimeout(1200);
    let st = await state();
    check(`the long document: all ${PAGES} pages stand, a few built`, [await p.evaluate(() => document.querySelectorAll("#pages .tpage").length), st.live < 40], [PAGES, true]);
    check("…nothing on screen shed", st.visShed, []);

    await goPage(251); await p.waitForTimeout(1200);
    st = await state();
    check("a jump to page 251: on screen and built", [st.vis.includes(await at(251)), st.visShed], [true, []]);
    check("…its text, through the key", /Deposition page 251 line 1, Corwin Ashdale testified/.test(await bodyText(251)), true);
    check("…and still only a few built", st.live < 40, true);

    // Back up through pages that stood at the guess: the reading does not jump.
    const topPage = () => p.evaluate(() => { const r0 = document.getElementById("stage").getBoundingClientRect(); for (const s of document.querySelectorAll("#pages .tpage")) if (s.getBoundingClientRect().bottom > r0.top + 1) return Number(s.dataset.index); return -1; });
    const jumps = [];
    for (let k = 0; k < 24; k++) {
      const a = await topPage();
      await p.mouse.move(300, 500); await p.mouse.wheel(0, -400); await p.waitForTimeout(400);
      const b = await topPage();
      if (a - b > 1 || b > a) jumps.push([a, b]);
    }
    check("scrolling back up a wheel at a time, the reading never jumps", jumps.slice(0, 3), []);
    check("…and on screen nothing shed", (await state()).visShed, []);

    // A resize lays the document out again without building the whole of it.
    const before = await topPage();
    await p.setViewportSize({ width: 1000, height: 800 });
    await p.waitForTimeout(1500);
    st = await state();
    check("a resize: still a few built, nothing on screen shed", [st.live < 40, st.visShed], [true, []]);
    check("…the reading kept its page", Math.abs((await topPage()) - before) <= 1, true);
    await p.setViewportSize({ width: 1400, height: 900 });
    await p.waitForTimeout(1500);

    // Side by side: every page level with its PDF page, down and up.
    await p.click("#sbs-toggle");
    await p.waitForFunction(() => !!document.querySelector("#pages .tpage.matched"), null, { timeout: 30000 });
    await p.waitForTimeout(1500);
    const offLevel = () => p.evaluate(() => {
      const pane = document.getElementById("pdf-pane"), out = [];
      for (const sec of document.querySelectorAll("#pages .tpage")) {
        const a = sec.getBoundingClientRect();
        if (a.bottom < 0 || a.top > innerHeight) continue;
        const sl = pane.querySelector(`.pdf-slot[data-index="${sec.dataset.index}"]`);
        if (sl && Math.abs(a.top - sl.getBoundingClientRect().top) > 1) out.push([Number(sec.dataset.index), Math.round(a.top), Math.round(sl.getBoundingClientRect().top)]);
      }
      return out;
    });
    const sweep = async (dy, n) => { const bad = []; for (let k = 0; k < n; k++) { await p.mouse.move(300, 500); await p.mouse.wheel(0, dy); await p.waitForTimeout(350); for (const b of await offLevel()) bad.push(b); } return bad.slice(0, 4); };
    check("side by side down through it: every page level with its PDF page", await sweep(500, 24), []);
    check("…and back up", await sweep(-500, 24), []);
    st = await state();
    check("…on screen nothing shed, a few built", [st.visShed, st.live < 50], [[], true]);
    await goPage(381); await p.waitForTimeout(1500);
    check("side by side, a jump to page 381: built and level", [(await state()).visShed, await offLevel()], [[], []]);
    await p.click("#sbs-toggle"); await p.waitForTimeout(800);

    // Typed in, read away from, saved.
    await goPage(301); await p.waitForTimeout(1200);
    // Typed for real (✎ Edit on, the caret put at the end of a line, keys
    // pressed), so the edit is an undo step as a reader's would be.
    await p.click("#edit-toggle");
    await p.waitForTimeout(400);
    check("typed on page 301", await p.evaluate((i) => {
      const b = document.querySelector(`#pages .tpage[data-index="${i}"] .page-body`);
      const lt = b && b.querySelector(".line .lt");
      if (!lt) return false;
      const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT); let n, last = null;
      while ((n = w.nextNode())) if (!n.parentElement.closest(".pn")) last = n;
      if (!last) return false;
      b.focus();
      const r = document.createRange(); r.setStart(last, last.data.length); r.collapse(true);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      return true;
    }, await at(301)), true);
    await p.keyboard.type("XYZZY");
    // The caret taken off it: what keeps the page built is the edit alone.
    await p.evaluate(() => { if (document.activeElement) document.activeElement.blur(); getSelection().removeAllRanges(); });
    await p.waitForTimeout(800);
    await goPage(41); await p.waitForTimeout(1500);
    await goPage(121); await p.waitForTimeout(1500);
    check("the page typed in is never let go of; a page read and left is", [await secShed(301), await secShed(251)], [false, true]);
    await p.evaluate(() => document.getElementById("save").click());
    await p.waitForTimeout(3000);
    let text = await disk();
    check("saved: the edit in the file", (text.match(/XYZZY/g) || []).length, 1);
    check("…and every other page as it was", text.replace("XYZZY", ""), LONG);

    // Saved, the page is like any other and is let go of; Ctrl+Z from far
    // away reaches it there (restoreSnapshot on a page shed out of a long
    // document), and it is built back as the undo left it.
    await p.evaluate(() => { if (document.activeElement) document.activeElement.blur(); getSelection().removeAllRanges(); });
    await goPage(41); await p.waitForTimeout(1500);
    await goPage(121); await p.waitForTimeout(1500);
    check("saved, and the caret gone from it, the page typed in is let go of like the rest", await secShed(301), true);
    await p.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await p.keyboard.press("Control+z"); await p.waitForTimeout(800);
    await goPage(301); await p.waitForTimeout(1500);
    check("Ctrl+Z reached it while it was let go of: built back without the edit", [await secShed(301), /XYZZY/.test(await bodyText(301))], [false, false]);
    await p.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await p.keyboard.press("Control+y"); await p.waitForTimeout(800);
    check("…and Ctrl+Y puts the edit back", /XYZZY/.test(await bodyText(301)), true);

    // Find counts the pages not built, and stands on them.
    await p.locator("#pages .tpage:not(.shed) .page-body").first().click({ position: { x: 5, y: 5 } }).catch(() => {});
    await p.evaluate(() => document.getSelection().removeAllRanges());
    await p.keyboard.press("Control+f");
    await p.waitForSelector("#fb-input", { state: "visible" });
    check("opening Find builds none of it back", (await state()).live < 50, true);
    await p.fill("#fb-input", "Deposition page 350 line 7,");
    await p.waitForTimeout(3000);
    check("Find: the hit on a page not built is counted", await fbCount(), "1 of 1 here");
    st = await state();
    check("…stood on: page 350 on screen, built, its hit marked", [st.vis.includes(await at(350)), st.visShed, await p.evaluate(() => CSS.highlights.get("findhere").size)], [true, [], 1]);
    check("…and said where", await p.evaluate(() => document.getElementById("fb-where").textContent), "Page 350:7");
    await p.fill("#fb-input", "line 7, Corwin");
    await p.waitForTimeout(2500);
    check("Find through the key, a hit a page", await fbCount(), `1 of ${PAGES} here`);
    for (let k = 0; k < 3; k++) { await p.keyboard.press("Enter"); await p.waitForTimeout(700); }
    check("…Enter three times: the fourth", await fbCount(), `4 of ${PAGES} here`);
    for (let k = 0; k < 4; k++) { await p.keyboard.press("Shift+Enter"); await p.waitForTimeout(700); }
    await p.waitForTimeout(4000);
    check("…back past the first: the last, on screen and marked", [await fbCount(), (await state()).vis.includes(await at(PAGES)), await p.evaluate(() => CSS.highlights.get("findhere").size)], [`${PAGES} of ${PAGES} here`, true, 1]);
    await p.keyboard.press("Escape"); await p.waitForTimeout(800);
    await p.keyboard.press("Control+h");
    await p.waitForSelector("#fb-with", { state: "visible" });
    await p.fill("#fb-input", "Deposition page 200 line 3,");
    await p.waitForTimeout(2500);
    await p.fill("#fb-with", "Deposition page 200 line three,");
    await p.click("#fb-replace"); await p.waitForTimeout(1200);
    check("Replace on a page built for it", /page 200 line three,/.test(await bodyText(200)), true);
    await p.keyboard.press("Escape"); await p.waitForTimeout(1500);
    await p.mouse.move(300, 500); await p.mouse.wheel(0, 200); await p.waitForTimeout(1500);
    check("Find closed: let go of again", (await state()).live < 60, true);
    await p.evaluate(() => document.getElementById("save").click());
    await p.waitForTimeout(3000);
    text = await disk();
    check("saved: both edits, and the rest byte for byte", [text.includes("page 200 line three,"), text.replace("XYZZY", "").replace("page 200 line three,", "page 200 line 3,") === LONG], [true, true]);

    // Back to an ordinary document of the folder.
    await p.evaluate((n) => window.__textReaderOpenDoc(n), "D Order.txt");
    await p.waitForFunction(() => document.querySelectorAll("#pages .tpage").length === 5, null, { timeout: 15000 });
    check("an ordinary document after it: five pages, every one built", (await state()).live, 5);
    check("no page errors", errors, []);
  } finally {
    await browser.close();
    srv.stop();
  }
}

await run();
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
