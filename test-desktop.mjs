// Browser test for PDF+, the desktop app (desktop/): the PWA's shell and the
// viewer running in Electron, served from inside the app, with no network.
// A PDF handed over on the command line (as Windows does for Open with and a
// double-click) opens in a tab, takes a sticky note, and Save writes it back
// into the same file; it is in Home's Recent list and opens again from there
// (a stored PathFileHandle given its methods back); a second launch hands its
// file to the running window and exits; a text export opens in the text
// reader; the bridge reads and writes no file it was not given; nothing is
// fetched from the network; Westlaw links go to the browser at once, other
// links only after asking, and PDF-Linker's pdf-linker: link to PDF-Linker; a tab moved to a new window takes its file
// along and saves there; OCR runs under the Content-Security-Policy; closing
// a window with unsaved changes asks; and no page logs an error or a CSP
// refusal.
//
// Run: node test-desktop.mjs   (from the repo root; on Linux with no display
//                               it runs itself again under xvfb-run)
//
// Needs Playwright (/opt/node-tools, or PLAYWRIGHT_MODULE) and Electron
// installed in desktop/ (cd desktop && npm install); exits 0 with SKIP where
// either is missing (1 where PDFPLUS_REQUIRE_TEST is set, as in CI).

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.join(REPO, "desktop");
const PW = process.env.PLAYWRIGHT_MODULE || "/opt/node-tools/node_modules/playwright/index.mjs";

// CI sets PDFPLUS_REQUIRE_TEST: there a missing piece is a failure, not a skip.
function skip(why) { console.log(`SKIP: ${why}`); process.exit(process.env.PDFPLUS_REQUIRE_TEST ? 1 : 0); }
if (!fs.existsSync(PW)) skip("Playwright is not installed at " + PW);
let ELECTRON;
try { ELECTRON = createRequire(path.join(DESKTOP, "package.json"))("electron"); } catch { skip("Electron is not installed: cd desktop && npm install"); }
if (typeof ELECTRON !== "string" || !fs.existsSync(ELECTRON)) skip("Electron's binary is not installed in desktop/node_modules");

if (process.platform === "linux" && !process.env.DISPLAY && !process.env.PDFPLUS_UNDER_XVFB) {
  const r = spawnSync("xvfb-run", ["-a", process.execPath, ...process.argv.slice(1)], {
    stdio: "inherit", env: { ...process.env, PDFPLUS_UNDER_XVFB: "1" },
  });
  if (r.error) skip("no display, and xvfb-run is not installed");
  process.exit(r.status ?? 1);
}

const { _electron: electron } = await import(pathToFileURL(PW).href);
const { PDFDocument, PDFName } = await import(pathToFileURL(path.join(REPO, "viewer/vendor/pdf-lib/pdf-lib.esm.min.js")).href);

/** How many sticky notes (/Text annotations) the first page of a PDF has. */
async function notesIn(bytes) {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.Annots();
  let n = 0;
  for (let i = 0; annots && i < annots.size(); i++) {
    const a = annots.lookup(i);
    if (String(a.get(PDFName.of("Subtype"))) === "/Text") n++;
  }
  return n;
}

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000, step = 100) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = await fn(); } catch { v = undefined; }
    if (v || Date.now() - t0 > ms) return v;
    await sleep(step);
  }
}

// One page with a line of text on it.
function pdfWith(text) {
  const content = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdfplus-test-"));
const profile = path.join(tmp, "profile");
const files = path.join(tmp, "Case Files");
fs.mkdirSync(files, { recursive: true });
const brief = path.join(files, "Opening Brief.pdf");
const exhibit = path.join(files, "Exhibit B.pdf");
const notes = path.join(files, "Hearing Notes.txt");
const secret = path.join(files, "Not Given.pdf");
fs.writeFileSync(brief, pdfWith("People v. Anderson (1972) 6 Cal.3d 628"));
fs.writeFileSync(exhibit, pdfWith("Exhibit B"));
fs.writeFileSync(notes, "Page 1\n\nThe hearing is set for the morning.\n");
fs.writeFileSync(secret, pdfWith("Never handed to the app"));

const ENV = { ...process.env, PDFPLUS_USER_DATA: profile };
const SWITCHES = process.platform === "linux" ? ["--no-sandbox"] : [];

let app = null;
const log = { errors: [], csp: [] };
function watch(page) {
  // A beforeunload is main.js's to answer (will-prevent-unload), not
  // Playwright's: a listener here keeps Playwright from answering it.
  page.on("dialog", () => {});
  page.on("pageerror", (e) => log.errors.push(e.message));
  page.on("console", (m) => {
    const t = m.text();
    if (/Content Security Policy|Refused to/i.test(t)) log.csp.push(t);
    // The PWA's service worker is not part of PDF+ (assemble.mjs leaves it out).
    else if (m.type() === "error" && !/sw\.js|ServiceWorker|service worker/i.test(t)) log.errors.push("console: " + t);
  });
}

/** The shell's active tab's frame. */
async function activeFrame(win) {
  const el = await win.waitForSelector("iframe.tab-view.active", { state: "attached", timeout: 15000 });
  return el.contentFrame();
}
const tabLabels = (win) => win.evaluate(() => [...document.querySelectorAll("#tabs .tab .tab-label")].map((e) => e.textContent));

try {
  // ── 1. starts ──────────────────────────────────────────────────────────────
  console.log("1. PDF+ starts with a PDF from the command line, opened in a tab");
  app = await electron.launch({ executablePath: ELECTRON, args: [DESKTOP, ...SWITCHES, brief], cwd: DESKTOP, env: ENV });
  // Links the page opens, and the questions main.js asks, are recorded here
  // instead of reaching the desktop.
  await app.evaluate(({ shell, dialog }) => {
    globalThis.__opened = [];
    globalThis.__asked = [];
    globalThis.__answer = 1; // Cancel
    shell.openExternal = async (u) => { globalThis.__opened.push(u); };
    dialog.showMessageBox = async (...a) => {
      const o = a.find((x) => x && typeof x === "object" && "buttons" in x);
      globalThis.__asked.push(o ? o.detail || o.message : "");
      return { response: globalThis.__answer };
    };
  });
  const win = await app.firstWindow();
  watch(win);
  await win.waitForLoadState("load");
  check("Home says PDF+", await win.evaluate(() => document.querySelector(".home-hero h1").textContent), "PDF+");
  truthy("the PDF opened in a tab", await until(async () => (await tabLabels(win)).length === 1));
  let viewer = await activeFrame(win);
  truthy("…in the viewer", /\/viewer\/viewer\.html$/.test(viewer.url()));
  truthy("…served from inside the app", viewer.url().startsWith("pdfplus://app/"));
  const drawn = await until(() => viewer.evaluate(() => window.__pdfViewerPageCount?.() === 1 && [...document.querySelectorAll("#pages canvas")].some((c) => c.width > 0)), 30000);
  truthy("…and drawn", drawn);
  if (!drawn) {
    // What the viewer saw, for a failure on a CI runner that does not happen here.
    console.log("        state: " + JSON.stringify(await viewer.evaluate(() => ({
      pages: window.__pdfViewerPageCount?.(), canvases: [...document.querySelectorAll("#pages canvas")].map((c) => c.width),
      visibility: document.visibilityState, focus: document.hasFocus(), inner: [innerWidth, innerHeight], scrollY,
    }))) + " window: " + JSON.stringify(await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { visible: w.isVisible(), focused: w.isFocused(), minimized: w.isMinimized(), bounds: w.getBounds() };
    })));
  }
  truthy("the window wears the document's name", await until(async () => /— PDF\+$/.test(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()))));

  // ── 2. edit and save in place ─────────────────────────────────────────────
  console.log("2. a sticky note, saved into the same file with no picker");
  {
    const before = fs.readFileSync(brief);
    await viewer.evaluate(() => document.querySelector('[data-tool="note"]').click());
    const page = viewer.locator("#pages > .page-wrapper").first();
    await page.click({ position: { x: 200, y: 260 } });
    await sleep(500);
    await win.keyboard.type("Desktop note");
    await win.keyboard.press("Escape");
    await sleep(300);
    truthy("the note counts as a change", await until(() => viewer.evaluate(() => window.__pdfViewerHasUnsaved())));
    await viewer.evaluate(() => document.getElementById("save-edits").click());
    const saved = await until(() => { const b = fs.readFileSync(brief); return !b.equals(before) && b; });
    truthy("the file on disk was written", saved);
    check("…with the note in it as a PDF annotation", saved ? await notesIn(saved) : 0, 1);
    check("…and nothing left unsaved", await until(() => viewer.evaluate(() => !window.__pdfViewerHasUnsaved())), true);
    const left = fs.readdirSync(files).filter((f) => /pdfplus-tmp/.test(f));
    check("no temporary file left beside it", left, []);
  }

  // ── 3. Recent ─────────────────────────────────────────────────────────────
  console.log("3. Recent: the file is listed at Home and opens again from there");
  {
    await win.evaluate(() => document.querySelector("#tabs .tab .tab-close").click());
    truthy("the tab closed (nothing unsaved, nothing asked)", await until(async () => (await tabLabels(win)).length === 0));
    const names = await until(() => win.evaluate(() => {
      const els = [...document.querySelectorAll("#recent-list .recent-item .ri-name")];
      return els.length ? els.map((e) => e.textContent) : null;
    }));
    check("listed", names, ["Opening Brief.pdf"]);
    await win.evaluate(() => document.querySelector("#recent-list .recent-item").click());
    truthy("opened again from the list", await until(async () => (await tabLabels(win)).length === 1));
    viewer = await activeFrame(win);
    truthy("…drawn", await until(() => viewer.evaluate(() => window.__pdfViewerPageCount?.() === 1)));
    // And its Save still writes through the handle the list gave back.
    const before = fs.readFileSync(brief);
    await viewer.evaluate(() => document.querySelector('[data-tool="note"]').click());
    await viewer.locator("#pages > .page-wrapper").first().click({ position: { x: 260, y: 360 } });
    await sleep(500);
    await win.keyboard.type("Second note");
    await win.keyboard.press("Escape");
    await sleep(300);
    await viewer.evaluate(() => document.getElementById("save-edits").click());
    const saved = await until(() => { const b = fs.readFileSync(brief); return !b.equals(before) && b; });
    check("…and saves into the same file", saved ? await notesIn(saved) : 0, 2);
  }

  // ── 4. a second launch ────────────────────────────────────────────────────
  console.log("4. a second launch hands its files to the running window and exits");
  {
    const second = spawn(ELECTRON, [DESKTOP, ...SWITCHES, exhibit, notes], { cwd: DESKTOP, env: ENV, stdio: "ignore" });
    const code = await new Promise((resolve) => {
      const t = setTimeout(() => { second.kill(); resolve("still running"); }, 20000);
      second.on("exit", (c) => { clearTimeout(t); resolve(c); });
    });
    check("the second process exited", code, 0);
    const labels = await until(async () => { const l = await tabLabels(win); return l.length === 3 && l; });
    console.log("        tabs: " + JSON.stringify(labels));
    check("both files are tabs in the running window", labels && labels.length, 3);
    check("…still one window", await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    truthy("the text export is in the text reader, and the reader has it", await until(async () => {
      for (const f of win.frames()) {
        if (!/\/viewer\/text-reader\.html$/.test(f.url())) continue;
        if (/hearing is set/.test(await f.evaluate(() => document.body.innerText))) return true;
      }
      return false;
    }));
  }

  // ── 5. the bridge ─────────────────────────────────────────────────────────
  console.log("5. the bridge reads and writes only files PDF+ was given");
  {
    const r = await win.evaluate(async (p) => {
      const out = {};
      try { await window.pdfplusNative.readFile(p); out.read = "read"; } catch (e) { out.read = "refused"; }
      try { await window.pdfplusNative.writeFile(p, new Uint8Array([1, 2, 3])); out.write = "written"; } catch (e) { out.write = "refused"; }
      try { await window.pdfplusNative.readFile("relative.pdf"); out.relative = "read"; } catch (e) { out.relative = "refused"; }
      return out;
    }, secret);
    check("a file it was not given", r, { read: "refused", write: "refused", relative: "refused" });
    check("…left as it was", fs.readFileSync(secret).toString("latin1").includes("Never handed to the app"), true);
    const node = await win.evaluate(() => [typeof require, typeof process].join(","));
    check("no Node in the page", node, "undefined,undefined");
  }

  // ── 6. no network ─────────────────────────────────────────────────────────
  console.log("6. nothing is fetched from the network");
  {
    viewer = null;
    for (const f of win.frames()) if (/viewer\.html$/.test(f.url())) viewer = f;
    const r = await viewer.evaluate(async () => {
      const out = {};
      try { await fetch("https://example.com/"); out.web = "fetched"; } catch { out.web = "blocked"; }
      try { await fetch("http://127.0.0.1:9/"); out.local = "fetched"; } catch { out.local = "blocked"; }
      try { out.own = (await fetch("viewer.html")).ok ? "fetched" : "failed"; } catch { out.own = "blocked"; }
      return out;
    });
    check("the web and the local network are out of reach; the app's own files are not", r, { web: "blocked", local: "blocked", own: "fetched" });
    log.csp.length = 0; // those two refusals were the point
    const viaMain = await app.evaluate(async ({ BrowserWindow }) => {
      // Past the page's Content-Security-Policy: the session refuses it too.
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      return new Promise((resolve) => {
        wc.session.webRequest; // (the filter is installed in main.js)
        const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
        w.webContents.on("did-fail-load", (_e, code) => { resolve(code); w.destroy(); });
        w.webContents.on("did-finish-load", () => { resolve("loaded"); w.destroy(); });
        w.loadURL("https://example.com/").catch(() => {});
      });
    });
    check("a window sent to the web loads nothing", viaMain === "loaded" ? "loaded" : "refused", "refused");
  }

  // ── 7. links ──────────────────────────────────────────────────────────────
  console.log("7. links go to the default browser: Westlaw at once, others after asking");
  {
    const r = await viewer.evaluate(() => {
      const w1 = window.open("https://1.next.westlaw.com/Search/Results.html?query=6+Cal.3d+628", "_blank");
      const w2 = window.open("https://example.com/somewhere", "_blank");
      const w3 = window.open("file:///etc/hosts", "_blank");
      return [!!w1, !!w2, !!w3];
    });
    check("window.open answers as a browser does (file: refused)", r, [true, true, false]);
    await sleep(800);
    const main = await app.evaluate(() => ({ opened: globalThis.__opened.slice(), asked: globalThis.__asked.slice() }));
    check("Westlaw opened without a question", main.opened, ["https://1.next.westlaw.com/Search/Results.html?query=6+Cal.3d+628"]);
    check("the other link was asked about, and Cancel kept it closed", main.asked, ["https://example.com/somewhere"]);
    await app.evaluate(() => { globalThis.__answer = 0; globalThis.__opened.length = 0; globalThis.__asked.length = 0; });
    await viewer.evaluate(() => {
      const a = document.createElement("a");
      a.href = "https://example.org/followed";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    await sleep(800);
    const after = await app.evaluate(() => ({ opened: globalThis.__opened.slice(), asked: globalThis.__asked.slice() }));
    check("a link followed in place: asked, then opened in the browser", after, { opened: ["https://example.org/followed"], asked: ["https://example.org/followed"] });
    truthy("…and the viewer stayed where it was", /\/viewer\/viewer\.html$/.test(viewer.url()));
    // The text reader's Re-run PDF-Linker opens PDF-Linker's own link as a
    // clicked <a rel="noopener"> (text-reader.js openLink).
    await app.evaluate(() => { globalThis.__answer = 1; globalThis.__opened.length = 0; globalThis.__asked.length = 0; });
    await viewer.evaluate(() => {
      const a = document.createElement("a");
      a.href = "pdf-linker://run?f=QzpcQ2FzZQ&d=Case&n=1234";
      a.rel = "noopener";
      a.hidden = true;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    await sleep(800);
    check("PDF-Linker's pdf-linker: link goes to PDF-Linker without a question",
      await app.evaluate(() => ({ opened: globalThis.__opened.slice(), asked: globalThis.__asked.slice() })),
      { opened: ["pdf-linker://run?f=QzpcQ2FzZQ&d=Case&n=1234"], asked: [] });
    check("still one window", await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  }

  // ── 8. a handle sent between windows ─────────────────────────────────────
  console.log("8. a PathFileHandle sent by postMessage or stored keeps its methods");
  {
    const r = await win.evaluate(async () => {
      const got = await new Promise((resolve) => {
        window.addEventListener("message", function on(e) {
          if (!e.data || e.data.type !== "pdfplus-test") return;
          window.removeEventListener("message", on);
          resolve(e.data.items[0].handle);
        });
        const handle = { kind: "file", name: "Opening Brief.pdf", __pdfplusPath: "" };
        window.postMessage({ type: "pdfplus-test", items: [{ handle }] }, location.origin);
      });
      return [typeof got.getFile, typeof got.createWritable, typeof got.isSameEntry];
    });
    check("sent by postMessage", r, ["function", "function", "function"]);
  }

  // ── 9. a tab moved to a window of its own ─────────────────────────────────
  console.log("9. a tab moved to a new window goes with its file, and saves there");
  {
    const opened = app.waitForEvent("window", { timeout: 20000 });
    await win.evaluate(() => {
      const tab = [...document.querySelectorAll("#tabs .tab")].find((t) => /Opening Brief/.test(t.textContent));
      tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 20 }));
      document.querySelector('.shell-menu [data-act="window"]').click();
    });
    const win2 = await opened;
    watch(win2);
    await win2.waitForLoadState("load");
    const there = await until(async () => { const l = await tabLabels(win2); return l.length === 1 && l; });
    truthy("the new window has the document", there && /Opening Brief/.test(there[0]));
    check("…and it left this one", await until(async () => (await tabLabels(win)).length === 2), true);
    const moved = await activeFrame(win2);
    truthy("…drawn there", await until(() => moved.evaluate(() => window.__pdfViewerPageCount?.() === 1)));
    const before = fs.readFileSync(brief);
    await moved.evaluate(() => document.querySelector('[data-tool="note"]').click());
    await moved.locator("#pages > .page-wrapper").first().click({ position: { x: 300, y: 420 } });
    await sleep(500);
    await win2.keyboard.type("Third note");
    await win2.keyboard.press("Escape");
    await sleep(300);
    await moved.evaluate(() => document.getElementById("save-edits").click());
    const saved = await until(() => { const b = fs.readFileSync(brief); return !b.equals(before) && b; });
    check("…and saves into the same file from there", saved ? await notesIn(saved) : 0, 3);
    await win2.close();
    check("closed again: one window", await until(async () => (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 1), true);
  }

  // ── 10. OCR ────────────────────────────────────────────────────────────────
  console.log("10. OCR (WebAssembly in a worker) runs under the app's Content-Security-Policy");
  {
    const text = await viewer.evaluate(async () => {
      const { createWorker } = (await import("./vendor/tesseract/tesseract.esm.min.js")).default;
      const V = (p) => new URL("./vendor/tesseract/" + p, location.href).href;
      const w = await createWorker("eng", 1, {
        workerPath: V("worker.min.js"), corePath: V("tesseract-core-lstm.wasm.js"),
        langPath: V(""), gzip: false, workerBlobURL: false,
      });
      const c = document.createElement("canvas");
      c.width = 700; c.height = 140;
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#000"; g.font = "56px sans-serif"; g.fillText("Desktop reading", 24, 92);
      const r = await w.recognize(c);
      await w.terminate();
      return r.data.text;
    });
    truthy("recognized: " + JSON.stringify(text.trim()), /Desktop\s+reading/i.test(text));
  }

  // ── 11. closing with unsaved changes ──────────────────────────────────────
  console.log("11. closing a window with unsaved changes asks first");
  {
    // The PDF tab: one more note, not saved.
    await win.evaluate(() => {
      const tab = [...document.querySelectorAll("#tabs .tab")].find((t) => /Exhibit B/.test(t.textContent));
      tab.click();
    });
    viewer = await activeFrame(win);
    await until(() => viewer.evaluate(() => window.__pdfViewerPageCount?.() === 1));
    await viewer.evaluate(() => document.querySelector('[data-tool="note"]').click());
    await viewer.locator("#pages > .page-wrapper").first().click({ position: { x: 220, y: 300 } });
    await sleep(400);
    await win.keyboard.type("Unsaved");
    await win.keyboard.press("Escape");
    await until(() => viewer.evaluate(() => window.__pdfViewerHasUnsaved()));
    await app.evaluate(({ dialog }) => {
      globalThis.__unload = 0;
      dialog.showMessageBoxSync = () => { globalThis.__unload++; return 1; }; // Cancel
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await sleep(1500);
    check("asked", await app.evaluate(() => globalThis.__unload), 1);
    check("…and Cancel kept the window open", await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  }

  check("no page errors", log.errors, []);
  check("no Content-Security-Policy refusals", log.csp, []);
} catch (e) {
  fails++;
  console.log("  FAIL  " + (e && e.stack || e));
} finally {
  if (app) {
    try {
      await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 0; });
      await app.close();
    } catch { /* gone */ }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
