// Tests for moving a case folder from Home (viewer/case-move.js): the
// launcher rewritten to name the folder's new place, why a move is refused,
// and, in Chromium over the origin's private file system, the move itself —
// file by file into a folder of the same name, a Text Files subfolder with
// it, the emptied folder taken away, a clash refused before anything moves,
// a move stopped part-way finished by a second one, and a folder never moved
// into itself.
//
// Run: node test-case-move.mjs   (from the repo root)
// The browser part needs Playwright (/opt/node-tools), Chromium
// (/opt/pw-browsers/chromium) and a free port in 8130-8199, and is skipped
// where any is missing. Every name in it is invented.

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tokenOfPath, retargetLauncher, launcherPath, moveBlocker } from "./viewer/case-move.js";
import { folderPathOfToken } from "./viewer/run-request.js";

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

console.log("1. the launcher names the folder's new place");
const OLD = "C:\\Users\\Clerk\\Downloads\\25STCV12345 ACME";
const NEW = "C:\\Users\\Clerk\\Cases\\Filed\\25STCV12345 ACME";
check("a path as a token and back", folderPathOfToken(tokenOfPath("C:\\Users\\Clerk\\Downloads\\Caso Núñez")), "C:\\Users\\Clerk\\Downloads\\Caso Núñez");
const bat = [
  "@echo off",
  `REM Folder, for the text reader's Re-run button: ${tokenOfPath(OLD)}`,
  `"C:\\PDF-Linker\\python.exe" pdf_linker.py "${OLD}"`,
  `cd /d c:\\users\\clerk\\downloads\\25STCV12345 ACME`,
  `REM another case: "${OLD}2"`,
  `start "" "${OLD.replace(/\\/g, "/")}/Text Files"`,
  "",
].join("\r\n");
const out = retargetLauncher(bat, OLD, NEW);
check("the token names the new place", launcherPath(out), NEW);
check("the run's own command line too", out.includes(`pdf_linker.py "${NEW}"`), true);
check("…in any case, as Windows reads it", out.includes(`cd /d ${NEW}\r\n`), true);
check("…and with forward slashes", out.includes(`"${NEW.replace(/\\/g, "/")}/Text Files"`), true);
check("a longer path it only begins is left alone", out.includes(`"${OLD}2"`), true);
check("the line endings kept", out.split("\r\n").length, bat.split("\r\n").length);
check("a launcher naming no place is left as it was, but for the path", retargetLauncher("@echo off\r\nrun.exe\r\n", OLD, NEW), "@echo off\r\nrun.exe\r\n");

console.log("2. when a move is refused");
check("a run going", moveBlocker({ state: "running" }).startsWith("PDF-Linker is running"), true);
check("a re-run starting", moveBlocker({ state: "starting" }).startsWith("PDF-Linker is running"), true);
check("a run stopped part-way", moveBlocker({ state: "stalled" }).includes("stopped part-way"), true);
check("open in a reader", moveBlocker({ state: "done", inReader: true }).includes("reader tab"), true);
check("finished, closed: it moves", moveBlocker({ state: "done" }), "");

// ---- the move, in Chromium over OPFS --------------------------------------------

const REPO = path.dirname(fileURLToPath(import.meta.url));
const PW = "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = "/opt/pw-browsers/chromium";
const portFree = (port) => new Promise((resolve) => {
  const srv = net.createServer();
  srv.once("error", () => resolve(false));
  srv.once("listening", () => srv.close(() => resolve(true)));
  srv.listen(port, "127.0.0.1");
});
async function startServer(cwd) {
  let port = 0;
  for (let p = 8130; p <= 8199; p++) if (await portFree(p)) { port = p; break; }
  if (!port) return null;
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd, stdio: "ignore" });
  for (let k = 0; k < 80; k++) {
    const up = await new Promise((resolve) => { const s = net.connect(port, "127.0.0.1", () => { s.end(); resolve(true); }); s.on("error", () => resolve(false)); });
    if (up) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base: `http://127.0.0.1:${port}`, stop: () => { try { proc.kill("SIGTERM"); } catch { /* gone */ } } };
}

async function browserPart() {
  if (!fs.existsSync(PW) || !fs.existsSync(CHROME)) { console.log("\n(SKIP the browser: Playwright or Chromium is missing)"); return; }
  const { chromium } = await import(PW);
  const { launchBrowser } = await import("./browser-for-tests.mjs");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "case-move-site-"));
  execFileSync("bash", [path.join(REPO, "pwa", "build-site.sh"), out], { stdio: "ignore" });
  const site = await startServer(out);
  if (!site) { console.log("\n(SKIP the browser: no free port in 8130-8199)"); return; }
  const browser = await launchBrowser(chromium, CHROME);
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(site.base + "/index.html");
    const run = (fn, arg) => page.evaluate(fn, arg);
    // Helpers in the page: a fresh tree, and a listing of a folder.
    await run(() => {
      window.__tree = async (d) => {
        const all = [];
        for await (const e of d.entries()) all.push(e);
        all.sort((a, b) => (a[0] < b[0] ? -1 : 1));
        const out = {};
        for (const [n, h] of all) out[n] = h.kind === "file" ? await (await h.getFile()).text() : await window.__tree(h);
        return out;
      };
      window.__put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
      window.__fresh = async () => {
        const top = await navigator.storage.getDirectory();
        for (const n of ["Downloads", "Filed"]) { try { await top.removeEntry(n, { recursive: true }); } catch { /* none */ } }
        const dl = await top.getDirectoryHandle("Downloads", { create: true });
        const filed = await top.getDirectoryHandle("Filed", { create: true });
        const acme = await dl.getDirectoryHandle("25STCV12345 ACME", { create: true });
        await window.__put(acme, "Demurrer.pdf", "%PDF demurrer");
        await window.__put(acme, "DONE 2.40PM.txt", "");
        const text = await acme.getDirectoryHandle("Text Files", { create: true });
        await window.__put(text, "Demurrer.txt", "the export");
        return { top, dl, filed, acme };
      };
      window.__lib = import("./viewer/case-move.js");
    });

    console.log("3. a folder moved, file by file");
    let got = await run(async () => {
      const lib = await window.__lib;
      const { dl, filed, acme } = await window.__fresh();
      const ticks = [];
      const res = await lib.moveFolder(acme, filed, { parent: dl, onFile: (i, n) => ticks.push(`${i}/${n}`) });
      return { res: { name: res.dir.name, moved: res.moved, left: res.left }, ticks, dl: await window.__tree(dl), filed: await window.__tree(filed) };
    });
    check("every file moved, the Text Files folder with them", got.filed, { "25STCV12345 ACME": { "DONE 2.40PM.txt": "", "Demurrer.pdf": "%PDF demurrer", "Text Files": { "Demurrer.txt": "the export" } } });
    check("the emptied folder taken away", got.dl, {});
    check("what the move says", got.res, { name: "25STCV12345 ACME", moved: 3, left: false });
    check("told as each file went", got.ticks, ["1/3", "2/3", "3/3"]);

    console.log("4. a clash refused before anything moves");
    got = await run(async () => {
      const lib = await window.__lib;
      const { dl, filed, acme } = await window.__fresh();
      const there = await filed.getDirectoryHandle("25STCV12345 ACME", { create: true });
      await window.__put(await there.getDirectoryHandle("Text Files", { create: true }), "Demurrer.txt", "another export");
      let msg = "";
      try { await lib.moveFolder(acme, filed, { parent: dl }); } catch (e) { msg = e.message; }
      return { msg, dl: await window.__tree(dl), filed: await window.__tree(filed) };
    });
    check("it says which file", got.msg, "Filed already has 25STCV12345 ACME/Text Files/Demurrer.txt");
    check("…and nothing moved", [Object.keys(got.dl["25STCV12345 ACME"]).sort(), got.filed["25STCV12345 ACME"]["Text Files"]["Demurrer.txt"]],
      [["DONE 2.40PM.txt", "Demurrer.pdf", "Text Files"], "another export"]);

    console.log("5. a move stopped part-way, finished by another");
    got = await run(async () => {
      const lib = await window.__lib;
      const { dl, filed, acme } = await window.__fresh();
      // As a first move would leave it: the PDF already across.
      const there = await filed.getDirectoryHandle("25STCV12345 ACME", { create: true });
      await (await acme.getFileHandle("Demurrer.pdf")).move(there);
      const res = await lib.moveFolder(acme, filed, { parent: dl });
      return { moved: res.moved, dl: await window.__tree(dl), filed: await window.__tree(filed) };
    });
    check("the rest moved into the folder already there", got.filed, { "25STCV12345 ACME": { "DONE 2.40PM.txt": "", "Demurrer.pdf": "%PDF demurrer", "Text Files": { "Demurrer.txt": "the export" } } });
    check("…and the emptied one taken away", [got.dl, got.moved], [{}, 2]);

    console.log("6. never into itself, nor where it already is");
    got = await run(async () => {
      const lib = await window.__lib;
      const { dl, acme } = await window.__fresh();
      const msgs = [];
      for (const [target, parent] of [[acme, dl], [await acme.getDirectoryHandle("Text Files"), dl], [dl, dl]]) {
        try { await lib.moveFolder(acme, target, { parent }); msgs.push("moved"); } catch (e) { msgs.push(e.message); }
      }
      return { msgs, dl: Object.keys(await window.__tree(dl)) };
    });
    check("refused each time", got.msgs, ["a folder cannot be moved into itself", "a folder cannot be moved into a folder inside it", "it is already in Downloads"]);
    check("…and left where it was", got.dl, ["25STCV12345 ACME"]);
  } finally {
    await browser.close();
    site.stop();
    fs.rmSync(out, { recursive: true, force: true });
  }
}
await browserPart();

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
