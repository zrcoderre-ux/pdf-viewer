// Browser test: side by side, a line placed on the grid never runs off the
// page; its indent gives way first (viewer/text-reader.js, applyMatchedLayout:
// giveOf, giveBack, ungive).
//
// The owner: "The grid side by side placement matching should never force
// text off the page, if it does, reduce the indentation until no text is off
// the page." A form page on the export's grid read off its PDF (.cgrid) puts
// an indented line's first piece where the PDF prints it; where the export
// carries more than the PDF prints (a real name, words the run added), the
// line ran past the PDF's right margin and was squeezed across from where it
// stood, its indent and all. Now the indent is what gives: the line's own
// first, then the blank in front of a piece placed out to the right, and only
// what is still over is squeezed.
//
// Run: node test-indent-give.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium) and a
// free port in 8130-8199 for python3's http.server; exits 0 with SKIP where any
// is missing. The PDF is made in the page with pdf-lib; every word is invented.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const PW = "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = "/opt/pw-browsers/chromium";

function skip(why) { console.log(`SKIP: ${why}`); process.exit(0); }
if (!fs.existsSync(PW)) skip("Playwright is not installed at " + PW);
if (!fs.existsSync(CHROME)) skip("Chromium is not installed at " + CHROME);
const { chromium } = await import(PW);

let fails = 0;
function check(label, ok, note = "") {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok && note) console.log(`        ${note}`);
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
let port = 0;
for (let p = 8130; p <= 8199; p++) if (await portFree(p)) { port = p; break; }
if (!port) skip("no free port in 8130-8199");
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: REPO, stdio: "ignore" });
await waitPort(port);
const BASE = `http://127.0.0.1:${port}`;

// A form page: each row its pieces [text, x], 9-point Helvetica, 20 points
// apart. The export writes each piece at its column (4.2 points a character
// from 36), and on three rows carries more than the PDF prints.
const U = 4.2, X0 = 36;
const FORM = [
  [["SAMPLE-200", 520]],
  [["NOTICE OF SAMPLE", 230]],
  [["1.", 36], ["Name:", 50.7], ["Case Number:", 430]],
  [["2.", 36], ["Address of the party:", 50.7], ["Dept.:", 430]],
  [["3.", 36], ["The court finds", 50.7], ["Room:", 430]],
  [["a.", 50.7], ["The parties agree that", 204]],
  [["b.", 50.7], ["Second item", 65.3], ["Third", 300]],
  [["The clerk will", 204]],
];
// What the export carries past what the PDF prints, by row: a little more
// (its indent alone gives the room), and far more (indent, gap and a squeeze).
const MORE = {
  5: " the matter be set for a further hearing on a date the clerk will choose and that all appear",
  7: " send notice of the hearing to every party who has appeared in this action and to counsel of record for each of them, by mail and by electronic service, at the addresses each has given",
};
const LINES = FORM.map((pieces, k) => {
  let s = "";
  for (const [t, x] of pieces) {
    let col = Math.round((x - X0) / U);
    if (s.length && col <= s.length) col = s.length + 1;
    s = s.padEnd(col) + t;
  }
  return s + (MORE[k] || "");
});
const TEXT = "====== Page 1 ======\n" + LINES.join("\n") + "\n";

let browser = null;
try {
  browser = await chromium.launch({ executablePath: CHROME });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto(BASE + "/viewer/text-reader.html");
  await page.waitForFunction(() => !!window.__textReaderAdoptFolder && !!window.__textReaderOpenDoc && !!window.__textReaderPickPdfs);
  await page.evaluate(async ({ FORM, TEXT }) => {
    const { PDFDocument, StandardFonts } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
    const d = await PDFDocument.create();
    const p = d.addPage([612, 792]);
    const font = await d.embedFont(StandardFonts.Helvetica);
    FORM.forEach((pieces, k) => { for (const [t, x] of pieces) p.drawText(t, { x, y: 792 - (80 + k * 20), size: 9, font }); });
    const bytes = await d.save();
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry("Case Indent Give", { recursive: true }); } catch { /* none yet */ }
    const dir = await top.getDirectoryHandle("Case Indent Give", { create: true });
    const put = async (dd, n, data) => { const w = await (await dd.getFileHandle(n, { create: true })).createWritable(); await w.write(data); await w.close(); };
    await put(dir, "Sample Notice.pdf", bytes);
    await put(await dir.getDirectoryHandle("Text Files", { create: true }), "Sample Notice.txt", TEXT);
    await window.__textReaderAdoptFolder(dir);
    window.__givePdf = bytes;
  }, { FORM, TEXT });
  await page.evaluate((n) => window.__textReaderOpenDoc(n), "Sample Notice.txt");
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0);
  await page.evaluate(async () => { await window.__textReaderPickPdfs([new File([window.__givePdf], "Sample Notice.pdf", { type: "application/pdf" })]); });
  if (!(await page.evaluate(() => document.body.classList.contains("sbs")))) await page.click("#sbs-toggle");
  await page.waitForFunction(() => !!document.querySelector("#pages .tpage.matched .page-body.fixed"), null, { timeout: 15000 });
  await page.waitForTimeout(1500);

  /** Each line: where its first and last characters are drawn, its squeeze, and the page's margins, in px from the sheet's left. */
  const read = () => page.evaluate(() => {
    const body = document.querySelector("#pages .tpage .page-body.fixed");
    const sec = body.closest(".tpage");
    const L = sec.getBoundingClientRect().left;
    const edge = (lt, last) => {
      const nodes = [];
      const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) if (/\S/.test(n.data)) nodes.push(n);
      const n = last ? nodes[nodes.length - 1] : nodes[0];
      if (!n) return null;
      const i = last ? n.data.search(/\S\s*$/) : n.data.search(/\S/);
      const r = document.createRange();
      r.setStart(n, i); r.setEnd(n, i + 1);
      const b = r.getBoundingClientRect();
      return last ? b.right - L : b.left - L;
    };
    return {
      cgrid: body.classList.contains("cgrid"),
      width: sec.getBoundingClientRect().width,
      margin: [...body.querySelectorAll(":scope > .line")].map((l) => l.querySelector(".lt").getBoundingClientRect())[0].right - L,
      lines: [...body.querySelectorAll(":scope > .line")].map((l) => {
        const lt = l.querySelector(":scope > .lt");
        return { text: l.textContent.trim(), first: edge(lt, false), last: edge(lt, true), right: l.getBoundingClientRect().right - L, squeeze: lt.style.transform };
      }),
    };
  });
  const laid = await read();
  const scale = laid.width / 612;
  check("the form page is laid on the export's grid read off its PDF", laid.cgrid);
  const off = laid.lines.filter((l) => l.last != null && l.last > laid.width + 0.5);
  check("no line's text runs off the page", off.length === 0, off.map((l) => `${l.text.slice(0, 30)}: ${l.last.toFixed(1)} > ${laid.width}`).join(" | "));
  const past = laid.lines.filter((l) => l.last != null && l.last > l.right + 1);
  check("…nor past the PDF's right margin", past.length === 0, past.map((l) => `${l.text.slice(0, 30)}: ${l.last.toFixed(1)} > ${l.right.toFixed(1)}`).join(" | "));
  const a = laid.lines.find((l) => l.text.startsWith("a."));
  const xA = 50.7 * scale;
  check("a line a little too long gives back its indent and is not squeezed", !!a && a.first < xA - 2 && !a.squeeze,
    a ? `first at ${a.first.toFixed(1)} (its PDF place ${xA.toFixed(1)}), squeeze "${a.squeeze}"` : "no line");
  const clerk = laid.lines.find((l) => l.text.startsWith("The clerk"));
  const grid0 = laid.lines.find((l) => l.text.startsWith("1.")).first;
  check("a line far too long gives back all of its indent before it is squeezed",
    !!clerk && Math.abs(clerk.first - grid0) <= 1 && /scaleX/.test(clerk.squeeze),
    clerk ? `first at ${clerk.first.toFixed(1)} (the margin ${grid0.toFixed(1)}), squeeze "${clerk.squeeze}", last ${clerk.last.toFixed(1)} right ${clerk.right.toFixed(1)} ${JSON.stringify(clerk.text)}` : "no line");
  const b = laid.lines.find((l) => l.text.startsWith("b."));
  const third = await page.evaluate(() => {
    const body = document.querySelector("#pages .tpage .page-body.fixed");
    const L = body.closest(".tpage").getBoundingClientRect().left;
    const lt = [...body.querySelectorAll(":scope > .line > .lt")].find((x) => x.textContent.includes("Third"));
    const n = [...lt.querySelectorAll("*"), lt].flatMap((e) => [...e.childNodes]).find((x) => x.nodeType === 3 && x.data.includes("Third"));
    const r = document.createRange();
    const i = n.data.indexOf("Third");
    r.setStart(n, i); r.setEnd(n, i + 1);
    return r.getBoundingClientRect().left - L;
  });
  check("a line that fits keeps every piece where the PDF prints it", !!b && Math.abs(b.first - xA) <= 1.5 && Math.abs(third - 300 * scale) <= 1.5,
    `b. at ${b && b.first.toFixed(1)} vs ${xA.toFixed(1)}; Third at ${third.toFixed(1)} vs ${(300 * scale).toFixed(1)}`);
  // The file is untouched: the give is drawn, not written.
  const file = await page.evaluate(async () => (await import("/viewer/textdoc.js")).serializeNodes(document.querySelector("#pages .tpage .page-body")));
  check("the page reads back as the file", file === LINES.join("\n"), JSON.stringify(file).slice(0, 200));
  // Side by side shut and opened again: the give is worked out afresh, the same.
  await page.click("#sbs-toggle");
  await page.waitForTimeout(800);
  await page.click("#sbs-toggle");
  await page.waitForTimeout(1500);
  const again = await read();
  const offAgain = again.lines.filter((l) => l.last != null && l.last > l.right + 1);
  check("…and after side by side is shut and opened again, still no line past the margin", again.cgrid && offAgain.length === 0,
    offAgain.map((l) => `${l.text.slice(0, 30)}: ${l.last.toFixed(1)}`).join(" | "));
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  fails++;
  console.log(`  FAIL  the test itself threw: ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill("SIGTERM");
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
