// Tests for Home's Case folders list (viewer/case-folders.js; pwa/app-web.js,
// "Home: case folders"): what PDF-Linker is doing in a folder, read off its
// ETA and DONE markers, key, log, LEAKS.xlsx and quarantined exports; which
// folders in Downloads are today's; and, in the app (the site
// pwa/build-site.sh assembles), the list itself — today's case folders from a
// linked Downloads, a run going listed first, a click opening the whole
// folder in one reader, and the folder then listed once, as both.
//
// Run: node test-case-folders.mjs   (from the repo root)
//
// The browser part needs Playwright (/opt/node-tools), Chromium
// (/opt/pw-browsers/chromium) and a free port in 8130-8199 for python3's
// http.server, and is skipped where any is missing. Downloads is a folder of
// the origin's private file system. Every name in it is invented.

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  folderStatus, statusText, isCaseListing, isToday, signalFile, sortRows, startOfDay, RUN_STALE_MS,
} from "./viewer/case-folders.js";

const REPO = path.dirname(fileURLToPath(import.meta.url));
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

const NOW = new Date(2026, 9, 29, 15, 0).getTime();
const MIN = 60000;
const f = (name, ago, size = 0) => ({ name, size, at: NOW - ago });

console.log("1. the run's state, off its markers");
check("an ETA marker newer than DONE is a run going",
  folderStatus({ files: [f("ETA ~6.04PM (6 of 13).txt", 2 * MIN), f("pseudonym_key.xlsx", 3 * 24 * 60 * MIN, 900)] }, NOW),
  { leaks: false, held: 0, key: true, state: "running", label: "~6:04 PM (6 of 13)", at: NOW - 2 * MIN });
check("…untouched past the stale age, it may be a dead run's",
  folderStatus({ files: [f("ETA ~1.10PM (2 of 9).txt", RUN_STALE_MS + MIN)] }, NOW).state, "stalled");
check("a DONE stamp newer than the ETA marker is a finished run",
  folderStatus({ files: [f("ETA ~1.10PM (2 of 9).txt", 90 * MIN), f("DONE 2.40PM.txt", 20 * MIN)] }, NOW).state, "done");
check("a marker that is not empty is the operator's own file, not a marker",
  folderStatus({ files: [f("ETA notes.txt", MIN, 120)] }, NOW).state, "new");
check("a key with no marker standing: run before",
  folderStatus({ files: [f("pseudonym_key.xlsx", 60 * MIN, 900), f("pdf_linker.log", 30 * MIN, 5000)] }, NOW),
  { leaks: false, held: 0, key: true, state: "ran", label: "", at: NOW - 30 * MIN });
check("documents alone: not run yet", folderStatus({ files: [f("Complaint.pdf", MIN, 5000)] }, NOW).state, "new");
check("the worksheet and the quarantined exports are said with it",
  (({ leaks, held }) => ({ leaks, held }))(folderStatus({ files: [f("DONE 2.40PM.txt", 20 * MIN), f("LEAKS.xlsx", 20 * MIN, 800)], held: 2 }, NOW)),
  { leaks: true, held: 2 });

console.log("2. as Home says it");
const done = folderStatus({ files: [f("DONE 2.40PM.txt", 20 * MIN), f("LEAKS.xlsx", 20 * MIN, 800)], held: 2 }, NOW);
const doneSaid = statusText(done, NOW);
check("finished, with what still needs a look", [doneSaid.text.startsWith("Finished "), doneSaid.text.endsWith(" · 2 held as .LEAK · LEAKS.xlsx to answer"), doneSaid.tone], [true, true, "warn"]);
check("a clean finish reads as one", statusText(folderStatus({ files: [f("DONE 2.40PM.txt", 20 * MIN)] }, NOW), NOW).tone, "ok");
check("a run going", statusText(folderStatus({ files: [f("ETA ~6.04PM (6 of 13).txt", 2 * MIN)] }, NOW), NOW).text, "Running — ETA ~6:04 PM (6 of 13)");
check("not run yet", statusText(folderStatus({ files: [] }, NOW), NOW).text, "Not run yet");

console.log("3. which folders are case folders, and today's");
check("documents make a case folder", isCaseListing({ files: [{ name: "Motion.PDF" }], dirs: [] }), true);
check("…so does a Text Files folder", isCaseListing({ files: [], dirs: ["Text Files"] }), true);
check("pictures and an installer do not", isCaseListing({ files: [{ name: "IMG_0412.jpg" }, { name: "setup.exe" }], dirs: ["sub"] }), false);
check("a file written today makes the folder today's", isToday("Case A", { files: [f("Complaint.pdf", 30 * MIN, 1)] }, NOW), true);
check("…and nothing written since midnight does not", isToday("Case A", { files: [{ name: "Complaint.pdf", size: 1, at: startOfDay(NOW) - MIN }] }, NOW), false);
check("…unless the zip it came out of came down today", isToday("Case A", { files: [{ name: "Complaint.pdf", size: 1, at: startOfDay(NOW) - 9 * 24 * 60 * MIN }] }, NOW, new Set(["case a"])), true);
check("the files whose times are read", ["ETA x.txt", "DONE 1.00PM.txt", "pdf_linker.log", "pseudonym_key.xlsx", "LEAKS.xlsx", "A.pdf", "B.docx", "notes.txt", "photo.jpg"].map(signalFile),
  [true, true, true, true, true, true, true, false, false]);

console.log("4. the order of the list");
check("a run going first, then the newest",
  sortRows([
    { name: "Older", opened: NOW - 60 * MIN, status: { state: "done", at: NOW - 90 * MIN } },
    { name: "Going", opened: 0, status: { state: "running", at: NOW - 200 * MIN } },
    { name: "Newer", opened: NOW - 5 * MIN, status: { state: "new", at: 0 } },
  ]).map((r) => r.name),
  ["Going", "Newer", "Older"]);

// ── the list in the app ──────────────────────────────────────────────────────
const PW = "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = "/opt/pw-browsers/chromium";

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
async function startServer(cwd) {
  let port = 0;
  for (let p = 8130; p <= 8199; p++) if (await portFree(p)) { port = p; break; }
  if (!port) return null;
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd, stdio: "ignore" });
  await waitPort(port);
  return { base: `http://127.0.0.1:${port}`, stop: () => { try { proc.kill("SIGTERM"); } catch { /* gone */ } } };
}

const EXPORT = "====== Page 1 ======\nThe declaration of Corwin Ashdale.\n";

async function browserPart() {
  if (!fs.existsSync(PW) || !fs.existsSync(CHROME)) { console.log("\n(SKIP the app: Playwright or Chromium is missing)"); return; }
  const { chromium } = await import(PW);
  const { launchBrowser } = await import("./browser-for-tests.mjs");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "case-folders-site-"));
  execFileSync("bash", [path.join(REPO, "pwa", "build-site.sh"), out], { stdio: "ignore" });
  const site = await startServer(out);
  if (!site) { console.log("\n(SKIP the app: no free port in 8130-8199)"); return; }
  const browser = await launchBrowser(chromium, CHROME);
  try {
    const app = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const shell = await app.newPage();
    const errors = [];
    shell.on("pageerror", (e) => errors.push(e.message));
    shell.on("dialog", (d) => d.accept().catch(() => {}));
    await shell.goto(site.base + "/index.html");

    console.log("5. the list on Home, before Downloads is linked");
    await shell.waitForFunction(() => !document.getElementById("case-folders").hidden, null, { timeout: 10000 });
    check("it offers to link Downloads", await shell.textContent("#case-downloads"), "Show today's from Downloads…");
    check("…and says what it will list", (await shell.textContent("#case-list")).startsWith("Case folders you open here"), true);

    console.log("6. Downloads linked: today's case folders, a run going first");
    await shell.evaluate(async ({ EXPORT }) => {
      const top = await navigator.storage.getDirectory();
      try { await top.removeEntry("Downloads", { recursive: true }); } catch { /* none yet */ }
      const dl = await top.getDirectoryHandle("Downloads", { create: true });
      const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
      const beta = await dl.getDirectoryHandle("Case Beta", { create: true });
      await put(beta, "Decl Ashdale.pdf", "%PDF-1.4 stand-in");
      await put(beta, "pseudonym_key.xlsx", "stand-in");
      await put(beta, "LEAKS.xlsx", "stand-in");
      const text = await beta.getDirectoryHandle("Text Files", { create: true });
      await put(text, "Decl Ashdale.txt", EXPORT);
      await put(text, "Letter.txt.LEAK", EXPORT);
      await put(beta, "DONE 2.40PM.txt", "");
      await new Promise((r) => setTimeout(r, 30));
      const alpha = await dl.getDirectoryHandle("Case Alpha", { create: true });
      await put(alpha, "Complaint.pdf", "%PDF-1.4 stand-in");
      await put(alpha, "ETA ~6.04PM (6 of 13).txt", "");
      const pics = await dl.getDirectoryHandle("Holiday", { create: true });
      await put(pics, "IMG_0412.jpg", "jpeg stand-in");
      await put(dl, "notes.txt", "not a folder");
      // Linked as the app's dialog would link it.
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("pdfviewer-folders", 1);
        req.onupgradeneeded = () => { req.result.createObjectStore("folders", { keyPath: "key" }); req.result.createObjectStore("places"); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise((resolve) => { const tx = db.transaction("places", "readwrite"); tx.objectStore("places").put(dl, "downloads"); tx.oncomplete = resolve; });
      db.close();
      window.dispatchEvent(new Event("focus"));
    }, { EXPORT });
    await shell.waitForFunction(() => document.querySelectorAll("#case-list .case-item").length === 2, null, { timeout: 10000 });
    const rows = () => shell.$$eval("#case-list .case-item", (bs) => bs.map((b) => ({
      name: b.querySelector(".ri-name").textContent, where: b.querySelector(".ci-where").textContent, status: b.querySelector(".ci-status").textContent,
    })));
    let got = await rows();
    check("the case folders only, the run going first", got.map((r) => r.name), ["Case Alpha", "Case Beta"]);
    check("the run going, with its ETA", got[0].status, "Running — ETA ~6:04 PM (6 of 13)");
    check("the finished run, with what is left to answer", [got[1].status.startsWith("Finished "), got[1].status.endsWith("1 held as .LEAK · LEAKS.xlsx to answer")], [true, true]);
    check("…both found in Downloads today", got.map((r) => r.where), ["In Downloads today", "In Downloads today"]);
    check("the link now changes Downloads", await shell.textContent("#case-downloads"), "Change Downloads folder…");

    console.log("7. a click opens the whole folder in one reader");
    await shell.click("#case-list .case-item:nth-child(2)");
    await shell.waitForFunction(() => document.querySelectorAll("iframe.tab-view").length === 1, null, { timeout: 15000 });
    const reader = await (async () => { for (let k = 0; k < 100; k++) { const fr = shell.frames().find((x) => x.url().endsWith("/viewer/text-reader.html")); if (fr) return fr; await shell.waitForTimeout(100); } return null; })();
    await reader.waitForFunction(() => { const s = window.__textReaderSource && window.__textReaderSource(); return !!(s && s.dir && s.handle); }, null, { timeout: 20000 });
    check("the reader holds the case folder", await reader.evaluate(() => window.__textReaderSource().dir.name), "Case Beta");
    check("…open at its first export", await reader.evaluate(() => window.__textReaderSource().handle.name), "Decl Ashdale.txt");

    console.log("8. back at Home: the folder opened is one row, as both");
    await shell.click("#home-tab");
    await shell.waitForFunction(() => [...document.querySelectorAll("#case-list .case-item .ci-where")].some((e) => e.textContent.includes("Opened")), null, { timeout: 10000 });
    got = await rows();
    check("still two rows", got.length, 2);
    check("…Case Beta in Downloads today and opened here", got.find((r) => r.name === "Case Beta").where.startsWith("In Downloads today · Opened "), true);
    check("…and the Clear for opened folders is offered", await shell.isVisible("#case-clear"), true);

    console.log("9. a click on a folder already open goes to its tab");
    await shell.click("#case-list .case-item:has-text('Case Beta')");
    await shell.waitForTimeout(800);
    check("no second reader", await shell.evaluate(() => document.querySelectorAll("iframe.tab-view").length), 1);
    check("…its tab in front", await shell.evaluate(() => document.getElementById("dropzone").hidden), true);

    console.log("10. the run ends: the row says so on the next look");
    await shell.click("#home-tab");
    await shell.evaluate(async () => {
      const dl = await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads");
      const alpha = await dl.getDirectoryHandle("Case Alpha");
      await alpha.removeEntry("ETA ~6.04PM (6 of 13).txt");
      const w = await (await alpha.getFileHandle("DONE 3.12PM.txt", { create: true })).createWritable(); await w.close();
      window.dispatchEvent(new Event("focus"));
    });
    await shell.waitForFunction(() => [...document.querySelectorAll("#case-list .case-item")].some((b) => b.textContent.includes("Case Alpha") && b.querySelector(".ci-status").textContent.startsWith("Finished")), null, { timeout: 10000 });
    check("Case Alpha has finished", (await rows()).find((r) => r.name === "Case Alpha").status.startsWith("Finished "), true);

    console.log("11. in PDF+: only the folders its main process says changed today are read");
    await shell.evaluate(() => {
      window.__askedSince = null;
      window.pdfplusNative = {
        downloadsToday: async (since) => {
          window.__askedSince = since;
          return { name: "downloads", folders: [{ name: "Case Alpha", at: Date.now() }, { name: "Holiday", at: Date.now() }, { name: "Gone Since", at: Date.now() }] };
        },
      };
      window.dispatchEvent(new Event("focus"));
    });
    await shell.waitForFunction(() => window.__askedSince !== null, null, { timeout: 10000 });
    await shell.waitForFunction(() => [...document.querySelectorAll("#case-list .case-item")].every((b) => !b.textContent.includes("Case Beta") || !b.querySelector(".ci-where").textContent.includes("In Downloads")), null, { timeout: 10000 });
    got = await rows();
    check("asked from local midnight", await shell.evaluate(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return window.__askedSince === d.getTime(); }), true);
    check("Case Alpha, which it named, is today's; the pictures folder and a folder gone are not listed", got.filter((r) => r.where.includes("In Downloads")).map((r) => r.name), ["Case Alpha"]);
    check("Case Beta, which it did not name, is listed as opened here only", got.find((r) => r.name === "Case Beta").where.startsWith("Opened "), true);

    console.log("12. a PDF+ whose Downloads is not the linked folder: every folder is read, as before");
    await shell.evaluate(() => {
      window.pdfplusNative = { downloadsToday: async () => ({ name: "Elsewhere", folders: [] }) };
      window.dispatchEvent(new Event("focus"));
    });
    await shell.waitForFunction(() => [...document.querySelectorAll("#case-list .case-item")].some((b) => b.textContent.includes("Case Beta") && b.querySelector(".ci-where").textContent.includes("In Downloads")), null, { timeout: 10000 });
    check("Case Beta is today's again", (await rows()).find((r) => r.name === "Case Beta").where.startsWith("In Downloads today"), true);
    check("no page errors", errors, []);
    await app.close();
  } finally {
    await browser.close();
    site.stop();
  }
}
await browserPart();
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
