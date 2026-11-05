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
  withRunStart, RUN_START_WAIT_MS,
  opensInPdfMode, SETTLED_MS, finishedOvernight, projectedFinish, runLooksStalled,
  PRIORITY_FILE, RANK_MAX, priorityText, parsePriority, liveRank, changeLine, ordinal, lineTitle,
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
  { leaks: false, held: 0, key: true, state: "running", label: "~6:04 PM (6 of 13)", at: NOW - 2 * MIN, alive: NOW - 2 * MIN });
check("…untouched past the stale age and its projected finish, it may be a dead run's",
  folderStatus({ files: [f("ETA ~2.10PM (2 of 9).txt", 60 * MIN)] }, NOW).state, "stalled");
check("…with no clock to go by, untouched past the stale age",
  folderStatus({ files: [f("ETA (estimating...).txt", RUN_STALE_MS + MIN)] }, NOW).state, "stalled");
// A large folder: the marker goes up before the whole folder is OCR'd, and is
// rewritten only after each PDF, so it stands for an hour and more while the
// run writes pdf_linker.log (the owner: "the home screen falsely flags them
// as Stopped part-way").
check("a long run: the marker an hour and a half old, the log written lately: running",
  folderStatus({ files: [f("ETA (estimating...).txt", 90 * MIN), f("pdf_linker.log", 2 * MIN, 90000)] }, NOW),
  { leaks: false, held: 0, key: false, state: "running", label: "(estimating...)", at: NOW - 90 * MIN, alive: NOW - 2 * MIN });
check("…running late, past its projected finish, the log still written: running",
  folderStatus({ files: [f("ETA ~2.10PM (2 of 9).txt", 60 * MIN), f("pdf_linker.log", 5 * MIN, 90000)] }, NOW).state, "running");
check("…nothing written for an hour, but its projected finish not come: running",
  folderStatus({ files: [f("ETA ~6.04PM (6 of 13).txt", 60 * MIN), f("pdf_linker.log", 60 * MIN, 90000)] }, NOW).state, "running");
check("…nor within half an hour of it",
  folderStatus({ files: [f("ETA ~2.40PM (6 of 13).txt", 60 * MIN)] }, NOW).state, "running");
check("…a log older than the marker is the last run's: the marker alone",
  folderStatus({ files: [f("ETA ~2.10PM (2 of 9).txt", 60 * MIN), f("pdf_linker.log", 3 * 24 * 60 * MIN, 90000)] }, NOW).state, "stalled");
const at2 = (h, m, dayShift = 0) => { const d = new Date(NOW); d.setDate(d.getDate() + dayShift); d.setHours(h, m, 0, 0); return d.getTime(); };
check("the projected finish: the marker's clock on its day",
  projectedFinish("~6:04 PM (6 of 13)", at2(14, 0)), at2(18, 4));
check("…past midnight, the next day", projectedFinish("~1:10 AM (2 of 9)", at2(23, 40)), at2(1, 10, 1));
check("…a clock a minute behind the marker (seconds dropped) is the same day",
  projectedFinish("~2:00 PM (8 of 9)", at2(14, 0) + 30000), at2(14, 0));
check("…none for an estimate with no clock", projectedFinish("(estimating...)", at2(14, 0)), 0);
check("runLooksStalled: nothing at all standing", runLooksStalled(null, 0, NOW), false);
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
const stalledSaid = statusText(folderStatus({ files: [f("ETA ~2.10PM (2 of 9).txt", 60 * MIN)] }, NOW), NOW);
check("stopped part-way, and why it is thought so",
  [stalledSaid.text, stalledSaid.tone, /Neither the ETA file nor pdf_linker\.log has been written for 60 minutes, and the finish it projected has passed/.test(stalledSaid.title)],
  ["Stopped part-way? ETA ~2:10 PM (2 of 9)", "warn", true]);
check("a long run says when the log was written",
  /pdf_linker\.log 2 minutes ago/.test(statusText(folderStatus({ files: [f("ETA (estimating...).txt", 90 * MIN), f("pdf_linker.log", 2 * MIN, 90000)] }, NOW), NOW).title), true);

console.log("2b. which folders open in PDF mode");
const pm = (files, held = 0) => opensInPdfMode(folderStatus({ files, held }, NOW), NOW);
check("done over an hour ago with no leaks: PDF mode", pm([f("DONE 1.40PM.txt", SETTLED_MS + MIN), f("pseudonym_key.xlsx", 2 * SETTLED_MS, 900)]), true);
check("…done within the hour: the text", pm([f("DONE 2.40PM.txt", SETTLED_MS - MIN)]), false);
check("…with LEAKS.xlsx standing: the text", pm([f("DONE 1.40PM.txt", SETTLED_MS + MIN), f("LEAKS.xlsx", SETTLED_MS + MIN, 800)]), false);
check("…with an export held as .LEAK: the text", pm([f("DONE 1.40PM.txt", SETTLED_MS + MIN)], 1), false);
check("…a run going since: the text", pm([f("DONE 1.40PM.txt", SETTLED_MS + MIN), f("ETA ~6.04PM (1 of 3).txt", 2 * MIN)]), false);
// NOW is 3:00 PM; a stamp at a clock time, `daysBack` days before it.
const at = (h, m, daysBack = 0) => { const d = new Date(NOW); d.setDate(d.getDate() - daysBack); d.setHours(h, m, 0, 0); return d.getTime(); };
const pmAt = (t) => opensInPdfMode(folderStatus({ files: [{ name: "DONE x.txt", size: 0, at: t }] }, NOW), NOW);
check("finished overnight, 9:00 PM to before 8:00 AM: the text, for a final review",
  [pmAt(at(21, 0, 1)), pmAt(at(23, 30, 1)), pmAt(at(0, 15)), pmAt(at(7, 59))], [false, false, false, false]);
check("…finished in the day, 8:00 AM to before 9:00 PM: PDF mode",
  [pmAt(at(8, 0)), pmAt(at(12, 30)), pmAt(at(20, 59, 1))], [true, true, true]);
check("…overnight stays overnight days later", pmAt(at(22, 0, 3)), false);
check("the overnight hours, by the clock", [finishedOvernight(at(20, 59)), finishedOvernight(at(21, 0)), finishedOvernight(at(7, 59)), finishedOvernight(at(8, 0))], [false, true, true, false]);
check("…a run with its stamp gone, or none: the text", [pm([f("pseudonym_key.xlsx", 2 * SETTLED_MS, 900)]), pm([f("Complaint.pdf", MIN, 5000)])], [false, false]);

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

console.log("4b. a re-run the reader has just started (withRunStart)");
{
  const lastDone = folderStatus({ files: [f("DONE 2.40PM.txt", 30 * MIN)] }, NOW);
  const started = withRunStart(lastDone, NOW - MIN, NOW);
  check("the last run's DONE standing: shown as started, and kept", [started.status.state, started.keep], ["starting", true]);
  check("…said so on Home", statusText(started.status, NOW).text, "Re-run started — waiting for its ETA");
  check("…and listed first", sortRows([{ name: "Older", opened: NOW, status: lastDone }, { name: "Started", opened: 0, status: started.status }]).map((r) => r.name), ["Started", "Older"]);
  const eta = folderStatus({ files: [f("ETA (estimating...).txt", 0)] }, NOW);
  check("its ETA written: the folder's own status, and let go", [withRunStart(eta, NOW - MIN, NOW).status.state, withRunStart(eta, NOW - MIN, NOW).keep], ["running", false]);
  check("…an ETA from before the start does not count", withRunStart(folderStatus({ files: [f("ETA ~1.10PM (2 of 9).txt", 20 * MIN)] }, NOW), NOW - MIN, NOW).status.state, "starting");
  check("…a DONE after it: finished already", withRunStart(folderStatus({ files: [f("DONE 3.12PM.txt", 0)] }, NOW), NOW - MIN, NOW).status.state, "done");
  check("…the last run's DONE, written a moment before the start, does not", withRunStart(folderStatus({ files: [f("DONE 3.10PM.txt", 2 * MIN)] }, NOW), NOW - MIN, NOW).status.state, "starting");
  check("…never confirmed: let go after the wait", withRunStart(lastDone, NOW - RUN_START_WAIT_MS - MIN, NOW), { status: lastDone, keep: false });
  // Home's Take over, on a run stopped part-way: its ETA stays until the new run's replaces it.
  const stalled = folderStatus({ files: [f("ETA ~2.10PM (2 of 9).txt", 60 * MIN)] }, NOW);
  const took = withRunStart(stalled, NOW - MIN, NOW, "takeover");
  check("a take over: the stuck run's ETA still standing, shown as taken over",
    [took.status.state, took.keep, statusText(took.status, NOW).text], ["starting", true, "Taken over — waiting for its ETA"]);
  check("…the stalled row's hover offers it", /Take over ends the run/.test(statusText(stalled, NOW).title), true);
}

console.log("4c. PDF-Linker's line");
{
  check("the file is the name PDF-Linker reads", PRIORITY_FILE, "PDF-Linker Priority.json");
  check("its words, as PDF-Linker's _run_priority_read takes them", JSON.parse(priorityText(2, NOW)), { rank: 2, set: NOW });
  check("…read back", parsePriority(priorityText(3, NOW)), { rank: 3, set: NOW });
  check("a file that says no place is none",
    ["", "x", "[]", '{"rank":0,"set":1}', `{"rank":${RANK_MAX + 1},"set":1}`, '{"rank":"2","set":1}', '{"rank":2.5,"set":1}', '{"rank":2}'].map(parsePriority),
    [null, null, null, null, null, null, null, null]);
  const ranked = (set, ...files) => ({ files, priority: { rank: 2, set } });
  check("a place given after the last finish stands (a finished case to be run again)",
    liveRank(ranked(NOW - MIN, f("DONE 2.40PM.txt", 20 * MIN))), 2);
  check("…one given before it is spent: the case left the line when its run finished",
    liveRank(ranked(NOW - 30 * MIN, f("DONE 2.40PM.txt", 20 * MIN))), 0);
  check("…a run going leaves it standing", liveRank(ranked(NOW - 30 * MIN, f("ETA ~6.04PM (6 of 13).txt", MIN))), 2);
  check("…a DONE file that is not a stamp (not empty) does not spend it", liveRank(ranked(NOW - 30 * MIN, f("DONE notes.txt", MIN, 40))), 2);
  check("no file, no place", liveRank({ files: [f("DONE 2.40PM.txt", MIN)] }), 0);
  const L = ["a", "b", "c"];
  check("Prioritize puts a folder at the end", changeLine(L, "d", "add"), ["a", "b", "c", "d"]);
  check("…once", changeLine(L, "b", "add"), L);
  check("up and down swap with the neighbour", [changeLine(L, "c", "up"), changeLine(L, "a", "down")], [["a", "c", "b"], ["b", "a", "c"]]);
  check("…and stop at the ends", [changeLine(L, "a", "up"), changeLine(L, "c", "down")], [L, L]);
  check("out of the line", changeLine(L, "b", "remove"), ["a", "c"]);
  check("the line never passes RANK_MAX", changeLine(Array.from({ length: RANK_MAX }, (_, i) => i), "x", "add").length, RANK_MAX);
  check("places said as people say them", [1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
  check("the hover says what the place does and when it ends",
    [/2nd in PDF-Linker's line/.test(lineTitle(2, "Case X")), /below-normal CPU priority/.test(lineTitle(2, "Case X")), /leaves the line when a run of it finishes/.test(lineTitle(2, "Case X"))], [true, true, true]);
  const run = { state: "running", at: NOW - MIN };
  const done = { state: "done", at: NOW - 5 * MIN };
  check("the line first, in its order; then the runs going; then the newest",
    sortRows([
      { name: "Newest", status: done, opened: NOW },
      { name: "Second", status: done, rank: 2 },
      { name: "Going", status: run },
      { name: "First", status: run, rank: 1 },
    ]).map((r) => r.name), ["First", "Second", "Going", "Newest"]);
}

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
    await shell.click("#case-list .case-row:nth-child(2) .case-item");
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

    console.log("9b. Re-run PDF-Linker started: Home says so before the ETA is written");
    await reader.evaluate(() => window.parent.postMessage({ type: "textreader:run", dir: window.__textReaderSource().dir }, location.origin));
    await shell.click("#home-tab");
    await shell.waitForFunction(() => [...document.querySelectorAll("#case-list .case-item")].some((b) => b.textContent.includes("Case Beta") && b.querySelector(".ci-status").textContent.startsWith("Re-run started")), null, { timeout: 10000 });
    got = await rows();
    check("Case Beta: started, listed with the runs going", [got.find((r) => r.name === "Case Beta").status, got.findIndex((r) => r.name === "Case Beta") < 2], ["Re-run started — waiting for its ETA", true]);
    await shell.evaluate(async () => {
      const dl = await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads");
      const beta = await dl.getDirectoryHandle("Case Beta");
      const w = await (await beta.getFileHandle("ETA (estimating...).txt", { create: true })).createWritable(); await w.close();
    });
    // No focus or nudge: the list is looked at again on its own while a start waits.
    await shell.waitForFunction(() => [...document.querySelectorAll("#case-list .case-item")].some((b) => b.textContent.includes("Case Beta") && b.querySelector(".ci-status").textContent.startsWith("Running")), null, { timeout: 10000 });
    check("…then its ETA, as soon as PDF-Linker writes it", (await rows()).find((r) => r.name === "Case Beta").status, "Running — ETA (estimating...)");
    await shell.evaluate(async () => {
      const dl = await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads");
      const beta = await dl.getDirectoryHandle("Case Beta");
      await beta.removeEntry("ETA (estimating...).txt");
      const w = await (await beta.getFileHandle("DONE 3.20PM.txt", { create: true })).createWritable(); await w.close();
    });

    console.log("10. the run ends: the row says so on the next look");
    if (await shell.evaluate(() => document.getElementById("dropzone").hidden)) await shell.click("#home-tab");
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

    console.log("13. a folder opened here that is gone: no longer listed, and forgotten");
    await shell.evaluate(async () => {
      const dl = await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads");
      await dl.removeEntry("Case Beta", { recursive: true });
      window.dispatchEvent(new Event("focus"));
    });
    await shell.waitForFunction(() => ![...document.querySelectorAll("#case-list .case-item .ri-name")].some((e) => e.textContent === "Case Beta"), null, { timeout: 10000 });
    got = await rows();
    check("Case Beta's row is gone, Case Alpha's still there", got.map((r) => r.name), ["Case Alpha"]);
    check("…nothing says Not found", (await shell.textContent("#case-list")).includes("Not found"), false);
    check("…and it is no longer remembered as opened here", await shell.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const req = indexedDB.open("pdfviewer-folders"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      const n = await new Promise((resolve) => { const r = db.transaction("folders").objectStore("folders").count(); r.onsuccess = () => resolve(r.result); });
      db.close();
      return n;
    }), 0);
    console.log("14. a run stopped part-way: Take over asks PDF-Linker to end it and run again");
    await shell.evaluate(async () => {
      const dl = await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads");
      const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
      const gamma = await dl.getDirectoryHandle("Case Gamma", { create: true });
      await put(gamma, "Complaint.pdf", "%PDF-1.4 stand-in");
      await put(gamma, "ETA (estimating...).txt", "");
      await put(gamma, "Re-run PDF-Linker.bat", "@echo off\r\nREM Folder, for the text reader's Re-run button: QzpcQ2FzZSBHYW1tYQ\r\n");
      // Two hours on: nothing in Case Gamma has been written since.
      const real = Date.now.bind(Date);
      Date.now = () => real() + 2 * 3600000;
      // The pdf-linker: link, kept rather than handed to the system.
      window.__links = [];
      document.addEventListener("click", (e) => {
        const a = e.target.closest && e.target.closest("a[href^='pdf-linker:']");
        if (a) { window.__links.push(a.getAttribute("href")); e.preventDefault(); }
      }, true);
      // PDF-Linker's half: take the request file and keep what it said.
      window.__request = null;
      const poll = setInterval(async () => {
        try {
          const fh = await gamma.getFileHandle("PDF-Linker Run Request.json");
          window.__request = JSON.parse(await (await fh.getFile()).text());
          await gamma.removeEntry("PDF-Linker Run Request.json");
          clearInterval(poll);
        } catch { /* not yet */ }
      }, 200);
      window.dispatchEvent(new Event("focus"));
    });
    const gammaRow = "#case-list .case-row:has(.ri-name:text-is('Case Gamma'))";
    await shell.waitForSelector(`${gammaRow} .ci-takeover`, { timeout: 10000 });
    check("the row says stopped part-way, with Take over beside it",
      [(await shell.textContent(`${gammaRow} .ci-status`)).startsWith("Stopped part-way?"), await shell.textContent(`${gammaRow} .ci-takeover`)], [true, "Take over"]);
    check("…and no other row offers it", await shell.$$eval("#case-list .ci-takeover", (bs) => bs.length), 1);
    const readers = await shell.evaluate(() => document.querySelectorAll("iframe.tab-view").length);
    await shell.click(`${gammaRow} .ci-takeover`);
    await shell.waitForFunction(() => [...document.querySelectorAll("#case-list .ci-takeover")].some((b) => b.dataset.armed), null, { timeout: 5000 });
    check("the first click only asks again", [await shell.textContent(`${gammaRow} .ci-takeover`), await shell.evaluate(() => [window.__links.length, window.__request])], ["Click again to end it", [0, null]]);
    check("…and opens no reader", await shell.evaluate(() => document.querySelectorAll("iframe.tab-view").length), readers);
    await shell.click(`${gammaRow} .ci-takeover`);
    await shell.waitForFunction(() => window.__request !== null, null, { timeout: 10000 });
    const req = await shell.evaluate(() => window.__request);
    const link = await shell.evaluate(() => window.__links[0] || "");
    check("the second asks PDF-Linker to take over, by the launcher's folder token and one nonce",
      [req.state, link.startsWith("pdf-linker://run?f=QzpcQ2FzZSBHYW1tYQ&d=Case%20Gamma&n="), link.endsWith("&n=" + req.nonce)], ["takeover", true, true]);
    await shell.waitForFunction(() => [...document.querySelectorAll("#case-list .case-row")].some((r) => r.querySelector(".ri-name").textContent === "Case Gamma" && r.querySelector(".ci-status").textContent.startsWith("Taken over")), null, { timeout: 10000 });
    check("…and the row says so until the new run's ETA", [await shell.textContent(`${gammaRow} .ci-status`), await shell.$$eval("#case-list .ci-takeover", (bs) => bs.length)], ["Taken over — waiting for its ETA", 0]);

    console.log("15. PDF-Linker's line: Prioritize, move up, take out, spent by a finish");
    await shell.evaluate(() => { Date.now = () => new Date().getTime(); window.dispatchEvent(new Event("focus")); });
    const rowOf = (name) => `#case-list .case-row:has(.ri-name:text-is('${name}'))`;
    const readPlace = (name) => shell.evaluate(async (name) => {
      const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads")).getDirectoryHandle(name);
      try { return JSON.parse(await (await (await dir.getFileHandle("PDF-Linker Priority.json")).getFile()).text()).rank; }
      catch { return 0; }
    }, name);
    const order = () => shell.$$eval("#case-list .case-row", (rs) => rs.map((r) => [r.querySelector(".ri-name").textContent, (r.querySelector(".ci-place") || {}).textContent || ""]));
    await shell.waitForSelector(`${rowOf("Case Alpha")} .ci-line-add`, { timeout: 10000 });
    check("a row not in line offers Prioritize", await shell.textContent(`${rowOf("Case Alpha")} .ci-line-add`), "Prioritize");
    await shell.click(`${rowOf("Case Alpha")} .ci-line-add`);
    await shell.waitForSelector(`${rowOf("Case Alpha")} .ci-place`, { timeout: 10000 });
    check("Prioritize: 1st in line, its place written into the folder", [await shell.textContent(`${rowOf("Case Alpha")} .ci-place`), await readPlace("Case Alpha")], ["1st", 1]);
    check("…and the click opened no reader", await shell.evaluate(() => document.querySelectorAll("iframe.tab-view").length), readers);
    await shell.click(`${rowOf("Case Gamma")} .ci-line-add`);
    await shell.waitForSelector(`${rowOf("Case Gamma")} .ci-place`, { timeout: 10000 });
    check("a second: 2nd, listed after the first", await order(), [["Case Alpha", "1st"], ["Case Gamma", "2nd"]]);
    check("…the first can only go down, the last only up",
      await shell.evaluate(() => [...document.querySelectorAll("#case-list .ci-line-btn")].map((b) => b.disabled)), [true, false, false, false, true, false]);
    await shell.click(`${rowOf("Case Gamma")} .ci-line-btn[aria-label^='Move Case Gamma up']`);
    await shell.waitForFunction(() => document.querySelector("#case-list .case-row .ri-name").textContent === "Case Gamma", null, { timeout: 10000 });
    check("▲ swaps them, on Home and in the folders", [await order(), await readPlace("Case Gamma"), await readPlace("Case Alpha")], [[["Case Gamma", "1st"], ["Case Alpha", "2nd"]], 1, 2]);
    await shell.click(`${rowOf("Case Gamma")} .ci-line-btn[aria-label^='Take Case Gamma out']`);
    await shell.waitForSelector(`${rowOf("Case Gamma")} .ci-line-add`, { timeout: 10000 });
    check("✕ takes it out, its file removed, the one behind moved up to 1st",
      [await readPlace("Case Gamma"), await readPlace("Case Alpha"), await shell.textContent(`${rowOf("Case Alpha")} .ci-place`)], [0, 1, "1st"]);
    // PDF-Linker finishes Case Alpha: a DONE stamp newer than its place.
    await shell.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 20));
      const alpha = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads")).getDirectoryHandle("Case Alpha");
      await alpha.removeEntry("DONE 3.12PM.txt");
      const w = await (await alpha.getFileHandle("DONE 3.31PM.txt", { create: true })).createWritable(); await w.close();
      window.dispatchEvent(new Event("focus"));
    });
    await shell.waitForSelector(`${rowOf("Case Alpha")} .ci-line-add`, { timeout: 10000 });
    check("a run that finishes after its place was given takes the case out of the line", await shell.$$eval("#case-list .ci-place", (e) => e.length), 0);
    console.log("16. the log to share: offered where PDF-Linker wrote it, opened over Home as plain text");
    check("…no row offers it before the file is there", await shell.$$eval("#case-list .ci-share-log", (b) => b.length), 0);
    const SHARED = "2026-11-05 13:33:58,374 [INFO] Processing: Declaration of […].pdf\n2026-11-05 13:34:01,002 [INFO]   Pseudonymize: leak scans done in 6s\n";
    await shell.evaluate(async (body) => {
      const alpha = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads")).getDirectoryHandle("Case Alpha");
      const w = await (await alpha.getFileHandle("PDF-Linker Log to Share.txt", { create: true })).createWritable(); await w.write(body); await w.close();
      window.dispatchEvent(new Event("focus"));
    }, SHARED);
    await shell.waitForSelector(`${rowOf("Case Alpha")} .ci-share-log`, { timeout: 10000 });
    check("Case Alpha's row offers it, and only that row", [await shell.textContent(`${rowOf("Case Alpha")} .ci-share-log`), await shell.$$eval("#case-list .ci-share-log", (b) => b.length)], ["Log to share", 1]);
    const tabsBefore = await shell.evaluate(() => document.querySelectorAll("iframe.tab-view").length);
    await shell.click(`${rowOf("Case Alpha")} .ci-share-log`);
    await shell.waitForSelector("dialog.share-log-dialog[open]", { timeout: 5000 });
    check("…a click opens the file's text, as it is, in a dialog", await shell.textContent("dialog.share-log-dialog .sl-text"), SHARED);
    check("…and opens no reader", await shell.evaluate(() => document.querySelectorAll("iframe.tab-view").length), tabsBefore);
    await shell.click("dialog.share-log-dialog .sl-close");
    check("Close takes it away", await shell.$$eval("dialog.share-log-dialog", (d) => d.length), 0);
    console.log("17. Word: the folder's Word documents open in Word, in PDF+ only");
    await shell.evaluate(async () => {
      const dl = await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads");
      const put = async (d, name) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write("PK stand-in"); await w.close(); };
      const alpha = await dl.getDirectoryHandle("Case Alpha");
      await put(alpha, "Opposition draft.docx");
      await put(alpha, "Reply draft.docx");
      await put(alpha, "~$ply draft.docx");          // Word's lock file, while it has one open
      const gamma = await dl.getDirectoryHandle("Case Gamma");
      await put(gamma, "Notes.docx");
      window.dispatchEvent(new Event("focus"));
    });
    await shell.waitForTimeout(1500);
    check("…in a browser no row offers it: a page cannot start Word", await shell.$$eval("#case-list .ci-word-btn", (b) => b.length), 0);
    await shell.evaluate(() => {
      // PDF+'s bridge (desktop/preload.js), kept here rather than opening Word.
      window.__openedDocs = [];
      window.pdfplusNative = { openDocument: async (file) => { window.__openedDocs.push(file.name); return true; } };
      window.dispatchEvent(new Event("focus"));
    });
    await shell.waitForSelector(`${rowOf("Case Alpha")} .ci-word-btn`, { timeout: 10000 });
    check("in PDF+ each row with Word documents offers them, counted, the lock file left out",
      [await shell.textContent(`${rowOf("Case Alpha")} .ci-word-btn`), await shell.textContent(`${rowOf("Case Gamma")} .ci-word-btn`)], ["Word (2)", "Word"]);
    const tabsWord = await shell.evaluate(() => document.querySelectorAll("iframe.tab-view").length);
    await shell.click(`${rowOf("Case Gamma")} .ci-word-btn`);
    await shell.waitForFunction(() => window.__openedDocs.length === 1, null, { timeout: 5000 });
    check("one document opens at the click", await shell.evaluate(() => window.__openedDocs.slice()), ["Notes.docx"]);
    await shell.click(`${rowOf("Case Alpha")} .ci-word-btn`);
    await shell.waitForSelector(".ci-word-menu[data-folder='Case Alpha']", { timeout: 5000 });
    check("several are listed under the button, with Open all", await shell.$$eval(".ci-word-menu .ci-word-item", (xs) => xs.map((x) => x.textContent)), ["Opposition draft.docx", "Reply draft.docx", "Open all 2"]);
    check("…the list is on screen in full, under the button", await shell.evaluate(() => {
      const m = document.querySelector(".ci-word-menu").getBoundingClientRect();
      const b = document.querySelector(".ci-word-btn.open").getBoundingClientRect();
      const hit = document.elementFromPoint(m.left + 10, m.bottom - 6);
      return m.top >= b.bottom && m.bottom <= window.innerHeight && !!hit && !!hit.closest(".ci-word-menu");
    }), true);
    await shell.screenshot({ path: process.env.WORD_SHOT || "/dev/null" }).catch(() => {});
    await shell.click(".ci-word-menu .ci-word-item:text-is('Reply draft.docx')");
    await shell.waitForFunction(() => window.__openedDocs.length === 2, null, { timeout: 5000 });
    check("…one opens from the list, and the list closes", [await shell.evaluate(() => window.__openedDocs[1]), await shell.$$eval(".ci-word-menu", (m) => m.length)], ["Reply draft.docx", 0]);
    await shell.click(`${rowOf("Case Alpha")} .ci-word-btn`);
    await shell.click(".ci-word-menu .ci-word-all");
    await shell.waitForFunction(() => window.__openedDocs.length === 4, null, { timeout: 5000 });
    check("…Open all opens every one", await shell.evaluate(() => window.__openedDocs.slice(2)), ["Opposition draft.docx", "Reply draft.docx"]);
    check("…and no click opened a reader or a folder", await shell.evaluate(() => document.querySelectorAll("iframe.tab-view").length), tabsWord);
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
