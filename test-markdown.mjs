// Browser test for My-Macros' Markdown export in the text reader (textdoc.js
// isMarkdownName): a .md in its pseudonyms opens like a lone .txt — the real
// values from the key on screen, the name without its extension in the bar —
// and a save writes it back in its pseudonyms under its own name, an edit
// with it — except a value kept, which the save of a .md being edited writes
// as itself (clearKeptIn): no PDF-Linker run will ever un-fake it. In the app (the site pwa/build-site.sh
// assembles) a .md picked opens in the reader's tab. And it is drawn as a
// Word document (dressMarkdown, TD.markdownLines): Times New Roman at 12
// points on an 8.5-inch sheet with an inch of margin each side, its marks
// hidden and its headings, bold, italics and list items drawn, the text under
// them the file's; with Edit on, the marks show.
//
// Run: node test-markdown.mjs   (from the repo root)
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
async function startServer(cwd = REPO) {
  let port = 0;
  for (let p = 8130; p <= 8199; p++) if (await portFree(p)) { port = p; break; }
  if (!port) skip("no free port in 8130-8199");
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd, stdio: "ignore" });
  await waitPort(port);
  return { base: `http://127.0.0.1:${port}`, stop: () => { try { proc.kill("SIGTERM"); } catch { /* gone */ } } };
}

// ── the key, as a real .xlsx ────────────────────────────────────────────────
// On disk the exports carry the FAKES; the key turns them back on screen.
// "Ashdale" is bound on its own, so a name typed as "Ashdale" is offered.
function buildKey(rows, pinned = []) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "md-")), "pseudonym_key.xlsx");
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
  ["person", "Ashdale", "Wrenfield", "", "", "spreadsheet", 2],
  ["person", "Careau", "Halvorsen", "", "", "spreadsheet", 1],
]);
// "Careau" is a street, faked by mistake: the keep is what the save carries out.
const MD = "# Tentative Ruling\n\n**Plaintiff Tobias Wrenfield** moves to *compel*.\n\nThe store on Halvorsen Street.\n\n- Wrenfield's first request\n";

/** The .md in the origin's private file system, opened in the reader in `w` as a lone file. */
async function openMd(w) {
  await w.evaluate(async ({ MD, keyBytes }) => {
    const top = await navigator.storage.getDirectory();
    const h = await top.getFileHandle("Draft Order.md", { create: true });
    const f = await h.createWritable(); await f.write(MD); await f.close();
    await window.__textReaderLoadKey(keyBytes, "pseudonym_key.xlsx");
    await window.__textReaderLoadLocal(await h.getFile(), h);
  }, { MD, keyBytes: Array.from(KEY_BYTES) });
  await w.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0, null, { timeout: 20000 });
  await w.waitForTimeout(800);
}
const bodyText = (w) => w.evaluate(() => document.querySelector("#pages .tpage .page-body").innerText);
const onDisk = (w) => w.evaluate(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle("Draft Order.md")).getFile()).text());

let srv = null, site = null, browser = null;
async function run() {
  srv = await startServer();
  browser = await launchBrowser(chromium, CHROME);
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await page.goto(srv.base + "/viewer/text-reader.html");
    await page.waitForFunction(() => !!window.__textReaderLoadLocal && !!window.__textReaderLoadKey);

    console.log("1. opened: the real values on screen, the Markdown drawn as a Word document");
    await openMd(page);
    const shown = await bodyText(page);
    truthy("the real name is shown", shown.includes("Plaintiff Corwin Ashdale moves to compel."));
    truthy("…in its possessive too", shown.includes("Ashdale's first request"));
    truthy("…and the pseudonym is not", !shown.includes("Wrenfield"));
    truthy("the heading reads without its #", shown.startsWith("Tentative Ruling"));
    truthy("no mark is seen: no #, no **, no *, no list's -", !/[#*]|^- /m.test(shown));
    const word = await page.evaluate(() => {
      const body = document.querySelector("#pages .tpage .page-body");
      const sheet = body.closest(".tpage").getBoundingClientRect().width;
      const cs = getComputedStyle(body);
      const lineOf = (t) => [...body.querySelectorAll(":scope > .line")].find((l) => l.textContent.includes(t));
      const styleOf = (t) => {
        const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) if (n.data.includes(t)) { const c = getComputedStyle(n.parentElement); return { weight: Number(c.fontWeight), italic: c.fontStyle === "italic" }; }
        return null;
      };
      const h = lineOf("Tentative Ruling"), li = lineOf("first request");
      return {
        md: body.classList.contains("md"), family: cs.fontFamily, size: parseFloat(cs.fontSize), sheet,
        left: parseFloat(cs.paddingLeft), right: parseFloat(cs.paddingRight), column: body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        h1: h && h.dataset.md, h1Weight: h && Number(getComputedStyle(h.querySelector(".lt")).fontWeight),
        ul: li && li.dataset.md, bullet: li && getComputedStyle(li.querySelector(".lt"), "::before").content,
        name: styleOf("Corwin Ashdale"), compel: styleOf("compel"), moves: styleOf("moves to"),
        text: body.textContent,
      };
    });
    truthy("the page is a Markdown document's", word.md);
    truthy("…in Times New Roman", /^"?Times New Roman/.test(word.family));
    const near = (a, b) => Math.abs(a - b) <= 1;
    truthy("…at 12 points: a sixth of an inch of an 8.5-inch sheet", near(word.size, word.sheet / 8.5 / 6) && word.size > 10);
    truthy("…an inch of margin each side", near(word.left, word.sheet / 8.5) && near(word.right, word.sheet / 8.5));
    truthy("…its text 6.5 inches wide", near(word.column, word.sheet * 6.5 / 8.5));
    truthy("the heading drawn as one, bold", word.h1 === "h1" && word.h1Weight >= 700);
    truthy("the bold party bold, its real name with it", !!word.name && word.name.weight >= 700);
    truthy("…the italic word in italics, the words between them neither", !!word.compel && word.compel.italic && !!word.moves && word.moves.weight < 700 && !word.moves.italic);
    truthy("the list item drawn with a bullet", word.ul === "ul" && /\u2022|•/.test(word.bullet));
    truthy("the text under it is the file's, marks and all", word.text.includes("**Plaintiff Corwin Ashdale** moves to *compel*.") && word.text.includes("# Tentative Ruling") && word.text.includes("- Ashdale's first request"));
    check("the bar names it without .md", await page.evaluate(() => document.getElementById("doc-title").textContent), "Draft Order");
    truthy("the status bar names the file", await page.evaluate(() => document.getElementById("st-file").textContent.startsWith("Draft Order.md")));

    console.log("2. saved: in its pseudonyms, under its own name");
    await page.click("#edit-toggle");
    await page.waitForTimeout(300);
    truthy("with Edit on, the marks show to type among", (await bodyText(page)).includes("**Plaintiff Corwin Ashdale**"));
    await page.click("#pages .tpage .page-body");
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" Granted.");
    await page.waitForTimeout(400);
    truthy("the document is unsaved", await page.evaluate(() => !document.getElementById("save").disabled));
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(1500);
    const saved = await onDisk(page);
    check("the edit saved, the pseudonyms kept, byte for byte", saved, MD.replace(/\n$/, " Granted.\n"));
    truthy("no real name reaches the file", !/Ashdale/.test(saved));

    console.log("3. a keep: Edit and Save write the kept value as itself");
    const ok = await page.evaluate(() => {
      const pn = [...document.querySelectorAll("#pages .tpage .page-body .pn")].find((el) => el.dataset.real === "Careau");
      if (!pn) return false;
      const r = pn.getBoundingClientRect();
      pn.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 2, clientY: r.top + r.height / 2 }));
      return true;
    });
    truthy("the faked street is a pseudonym on the page", ok);
    await page.waitForFunction(() => !document.getElementById("keep-menu").hidden, null, { timeout: 4000 });
    await page.evaluate(() => document.getElementById("keep-menu-no").click());
    await page.waitForTimeout(500);
    truthy("…kept, and marked so", await page.evaluate(() => !!document.querySelector('#pages .pn.kept[data-real="Careau"]')));
    check("the file still carries its fake until the save", (await onDisk(page)).includes("Halvorsen Street"), true);
    truthy("Edit is on", await page.evaluate(() => document.getElementById("edit-toggle").getAttribute("aria-pressed") === "true"));
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(1500);
    const kept = await onDisk(page);
    check("the kept value is written as itself, the rest as it was", kept, MD.replace("Halvorsen Street", "Careau Street").replace(/\n$/, " Granted.\n"));
    truthy("…the real name still in its pseudonym", kept.includes("Tobias Wrenfield") && !/Ashdale/.test(kept));
    truthy("…and the page shows it, no pseudonym under it", await page.evaluate(() => document.querySelector("#pages .tpage .page-body").innerText.includes("Careau Street") && !document.querySelector('#pages .pn[data-real="Careau"]')));

    console.log("4. opened again: the kept value reads in the clear");
    await page.evaluate(async () => {
      const h = await (await navigator.storage.getDirectory()).getFileHandle("Draft Order.md");
      await window.__textReaderLoadLocal(await h.getFile(), h);
    });
    await page.waitForTimeout(1000);
    truthy("Careau Street, with no pseudonym", await page.evaluate(() => document.querySelector("#pages .tpage .page-body").innerText.includes("Careau Street") && !document.querySelector('#pages .pn[data-real="Careau"]')));
    truthy("Corwin Ashdale still put back over its pseudonym", (await bodyText(page)).includes("Corwin Ashdale"));
    check("no page errors", errors, []);
    await context.close();

    console.log("5. in the app: a .md picked opens in the reader's tab");
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "md-site-"));
    execFileSync("bash", [path.join(REPO, "pwa", "build-site.sh"), out], { stdio: "ignore" });
    site = await startServer(out);
    const app = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const shell = await app.newPage();
    const appErrors = [];
    shell.on("pageerror", (e) => appErrors.push(e.message));
    shell.on("dialog", (d) => d.accept().catch(() => {}));
    await shell.goto(site.base + "/index.html");
    await shell.setInputFiles("#file-input", { name: "Draft Order.md", mimeType: "text/markdown", buffer: Buffer.from(MD) });
    await shell.waitForFunction(() => { const f = document.querySelector("iframe.tab-view"); return !!(f && f.contentWindow && f.contentWindow.__textReaderLoadLocal); }, null, { timeout: 20000 });
    const reader = shell.frames().find((f) => f.url().endsWith("/viewer/text-reader.html"));
    truthy("the tab is the text reader", reader);
    await reader.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0, null, { timeout: 20000 });
    truthy("…reading the Markdown, drawn as a Word document", await reader.evaluate(() => { const b = document.querySelector("#pages .tpage .page-body"); return b.classList.contains("md") && b.innerText.includes("Plaintiff Tobias Wrenfield moves") && !b.innerText.includes("**"); }));
    check("no page errors in the app", appErrors, []);
    await app.close();
  } finally {
    if (browser) await browser.close();
    if (srv) srv.stop();
    if (site) site.stop();
  }
}
await run();
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
