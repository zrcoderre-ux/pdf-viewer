// Browser test for My-Macros' Markdown export in the text reader (textdoc.js
// isMarkdownName): a .md in its pseudonyms opens like a lone .txt — the real
// values from the key on screen, the name without its extension in the bar —
// and a save writes it back in its pseudonyms under its own name, an edit
// with it. In the app (the site pwa/build-site.sh
// assembles) a .md picked opens in the reader's tab.
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
]);
const MD = "# Tentative Ruling\n\n**Plaintiff Tobias Wrenfield** moves to compel.\n\n- Wrenfield's first request\n";

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
  browser = await chromium.launch({ executablePath: CHROME });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await page.goto(srv.base + "/viewer/text-reader.html");
    await page.waitForFunction(() => !!window.__textReaderLoadLocal && !!window.__textReaderLoadKey);

    console.log("1. opened: the real values on screen, the Markdown as written");
    await openMd(page);
    const shown = await bodyText(page);
    truthy("the real name is shown", shown.includes("**Plaintiff Corwin Ashdale** moves to compel."));
    truthy("…in its possessive too", shown.includes("- Ashdale's first request"));
    truthy("…and the pseudonym is not", !shown.includes("Wrenfield"));
    truthy("the heading line stands as written", shown.startsWith("# Tentative Ruling"));
    check("the bar names it without .md", await page.evaluate(() => document.getElementById("doc-title").textContent), "Draft Order");
    truthy("the status bar names the file", await page.evaluate(() => document.getElementById("st-file").textContent.startsWith("Draft Order.md")));

    console.log("2. saved: in its pseudonyms, under its own name");
    await page.click("#edit-toggle");
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
    check("no page errors", errors, []);
    await context.close();

    console.log("3. in the app: a .md picked opens in the reader's tab");
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
    truthy("…reading the Markdown", (await reader.evaluate(() => document.querySelector("#pages .tpage .page-body").innerText)).includes("**Plaintiff"));
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
