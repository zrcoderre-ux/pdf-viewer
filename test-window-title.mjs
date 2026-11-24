// Browser test for the reader's window title (viewer/text-reader.js
// paintWindowTitle, windowTitleName): with a case folder open the title is
// the CASE FOLDER's name whichever of its documents is on screen — the app's
// tab, its window and Windows' taskbar preview all wear it (pwa/app-web.js
// cleanTitle, desktop/main.js trackWindow). A Text Files folder opened on its
// own, or a document alone, titles the window by the document. And the shell
// and the desktop app turn it into "<case folder>" and "<case folder> — PDF+".
//
// Run: node test-window-title.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium) and
// a free port in 8130-8199 for python3's http.server; exits 0 with SKIP where
// any is missing. Every name in it is invented.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browser-for-tests.mjs";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const PW = "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = "/opt/pw-browsers/chromium";

function skip(why) { console.log(`SKIP: ${why}`); process.exit(0); }
if (!fs.existsSync(PW)) skip("Playwright is not installed at " + PW);
if (!fs.existsSync(CHROME)) skip("Chromium is not installed at " + CHROME);
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

// The shell's and the desktop app's own turns of the title, copied from
// pwa/app-web.js cleanTitle and desktop/main.js trackWindow (checked below
// against the source, so a change there fails here).
const shellTitle = (t) => (t || "").replace(/\s*[—-]\s*(PDF Viewer|Text Reader)\s*$/, "").trim() || "PDF";
const desktopTitle = (t) => { t = String(t || "").trim(); return !t || t === "PDF Viewer" || t === "PDF+" ? "PDF+" : `${t} — PDF+`; };
const appWeb = fs.readFileSync(path.join(REPO, "pwa/app-web.js"), "utf8");
const main = fs.readFileSync(path.join(REPO, "desktop/main.js"), "utf8");

const CASE = "Doe v. Roe Holdings";
const pageText = (s) => Array.from({ length: 30 }, (_, i) => `====== Page ${i + 1} ======\n${s} page ${i + 1}.\n` + "A line of text.\n".repeat(20)).join("");

let srv = null, browser = null;
async function run() {
  srv = await startServer();
  browser = await launchBrowser(chromium, CHROME);
  try {
    console.log("0. the shell and the desktop app turn the title as this test does");
    check("cleanTitle", appWeb.includes(`return (t || "").replace(/\\s*[—-]\\s*(PDF Viewer|Text Reader)\\s*$/, "").trim() || "PDF";`), true);
    check("trackWindow", main.includes("win.setTitle(!t || t === \"PDF Viewer\" || t === APP_NAME ? APP_NAME : `${t} — ${APP_NAME}`);"), true);

    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await page.goto(srv.base + "/viewer/text-reader.html");
    await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc);
    await page.evaluate(async ({ CASE, A, B }) => {
      const top = await navigator.storage.getDirectory();
      try { await top.removeEntry(CASE, { recursive: true }); } catch { /* none yet */ }
      const dir = await top.getDirectoryHandle(CASE, { create: true });
      const put = async (d, name, data) => { const f = await (await d.getFileHandle(name, { create: true })).createWritable(); await f.write(data); await f.close(); };
      const text = await dir.getDirectoryHandle("Text Files", { create: true });
      await put(text, "Complaint.txt", A);
      await put(text, "Opposition.txt", B);
      await window.__textReaderAdoptFolder(dir);
    }, { CASE, A: pageText("The complaint"), B: pageText("The opposition") });

    console.log("1. a case folder open: the title is the folder's, whichever document");
    await page.evaluate(() => window.__textReaderOpenDoc("Complaint.txt"));
    await page.waitForFunction(() => document.querySelectorAll("#pages .tpage").length > 0);
    await page.waitForTimeout(500);
    check("on the complaint", await page.title(), `${CASE} — Text Reader`);
    check("…the app's tab and window", shellTitle(await page.title()), CASE);
    check("…the desktop window and its taskbar preview", desktopTitle(shellTitle(await page.title())), `${CASE} — PDF+`);
    await page.evaluate(() => window.__textReaderOpenDoc("Opposition.txt"));
    await page.waitForTimeout(500);
    check("on the opposition", await page.title(), `${CASE} — Text Reader`);
    check("…while the reader's own line names the document", await page.evaluate(() => document.getElementById("doc-title").textContent), "Opposition");

    console.log("2. the Text Files folder opened on its own: the document titles the window");
    await page.evaluate(async (CASE) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(CASE);
      await window.__textReaderAdoptFolder(await dir.getDirectoryHandle("Text Files"));
    }, CASE);
    await page.evaluate(() => window.__textReaderOpenDoc("Opposition.txt"));
    await page.waitForTimeout(500);
    check("named by the document, not \"Text Files\"", await page.title(), "Opposition.txt — Text Reader");

    check("no page errors", errors, []);
  } finally {
    await browser.close();
    srv.stop();
  }
}

try { await run(); } catch (e) { console.error(e); fails++; }
console.log(`\n${fails ? fails + " failed, " : ""}${passes} passed`);
process.exit(fails ? 1 : 0);
