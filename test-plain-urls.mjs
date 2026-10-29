// Web addresses written out in a PDF's text made clickable (viewer/plain-urls.js).
//
// 1. findPlainUrls on texts alone: the punctuation after an address, www.
//    without a scheme, an address split across two items on one line, one
//    wrapped onto the next line, and the line ends that are not a wrap.
// 2. In the viewer (Chromium): a generated PDF's addresses get links that are
//    on top under the pointer and open the address; one the PDF already links
//    keeps only its own link.
//
// Run: node test-plain-urls.mjs   (from the repo root)
//
// Part 2 needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium)
// and a free port in 8130-8199 for python3's http.server; it is skipped where
// any is missing.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findPlainUrls, hrefFor } from "./viewer/plain-urls.js";

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

// ── 1. the texts ─────────────────────────────────────────────────────────────
console.log("1. findPlainUrls");
const one = (s) => findPlainUrls([s], () => null).map((u) => u.href);
check("a sentence's period left off", one("See https://www.courts.ca.gov/forms.htm."), ["https://www.courts.ca.gov/forms.htm"]);
check("www. given https://", one("at www.example.org, then"), ["https://www.example.org"]);
check("in parentheses", one("(https://example.com/a)"), ["https://example.com/a"]);
check("a path's own parentheses kept", one("https://en.wikipedia.org/wiki/Foo_(bar)."), ["https://en.wikipedia.org/wiki/Foo_(bar)"]);
check("two on a line", one("http://a.com and https://b.org/x?y=1"), ["http://a.com", "https://b.org/x?y=1"]);
check("the www. inside one not read twice", one("https://www.x.com"), ["https://www.x.com"]);
check("no host, no link", one("https:// and www. and www.."), []);
check("a bare number is not a host", one("www.123"), []);
check("quoted", one("“https://x.com/q”"), ["https://x.com/q"]);

const wrapAll = () => "wrap";
const joinAll = () => "join";
const texts = (arr, meet) => findPlainUrls(arr, meet).map((u) => [u.href, u.pieces.map((p) => [p.span, p.start, p.end])]);
check("wrapped after a /", texts(["see https://example.com/some/long/", "path/file.pdf and more"], wrapAll),
  [["https://example.com/some/long/path/file.pdf", [[0, 4, 34], [1, 0, 13]]]]);
check("wrapped mid-word onto a file name", texts(["https://courts.ca.gov/documents/cv", "100.pdf."], wrapAll),
  [["https://courts.ca.gov/documents/cv100.pdf", [[0, 0, 34], [1, 0, 7]]]]);
check("a sentence ends at the line's end", texts(["Visit https://a.com.", "The court then"], wrapAll),
  [["https://a.com", [[0, 6, 19]]]]);
check("a word after a line ending in a letter", texts(["at https://a.com/x", "and so on"], wrapAll),
  [["https://a.com/x", [[0, 3, 18]]]]);
check("an indented next line", texts(["https://a.com/b/", "   c/d.html"], wrapAll),
  [["https://a.com/b/c/d.html", [[0, 0, 16], [1, 3, 11]]]]);
check("two items on one line", texts(["go to https://exa", "mple.com/z now"], joinAll),
  [["https://example.com/z", [[0, 6, 17], [1, 0, 10]]]]);
check("items apart: not joined", texts(["https://a.com", "next"], () => null), [["https://a.com", [[0, 0, 13]]]]);
check("the scan goes on after a wrapped one", texts(["https://a.com/", "b/c.pdf or www.d.org"], wrapAll).map((u) => u[0]),
  ["https://a.com/b/c.pdf", "https://www.d.org"]);
check("hrefFor localhost", hrefFor("http://localhost:8080/x"), "http://localhost:8080/x");

// ── 2. the viewer ────────────────────────────────────────────────────────────
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

async function viewer() {
  if (!fs.existsSync(PW) || !fs.existsSync(CHROME)) { console.log("2. SKIP: Playwright or Chromium is not installed"); return; }
  let port = 0;
  for (let p = 8130; p <= 8199; p++) if (await portFree(p)) { port = p; break; }
  if (!port) { console.log("2. SKIP: no free port in 8130-8199"); return; }
  const { chromium } = await import(PW);
  const { launchBrowser } = await import("./browser-for-tests.mjs");
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: REPO, stdio: "ignore" });
  let browser = null;
  try {
    await waitPort(port);
    const base = `http://127.0.0.1:${port}`;
    browser = await launchBrowser(chromium, CHROME);
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    // Nothing leaves the machine: a link that opens gets an empty page back.
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>ok</p>" }));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/viewer/viewer.html");
    await page.waitForFunction(() => typeof window.__pdfViewerLoadLocal === "function");
    await page.evaluate(async () => {
      const { PDFDocument, StandardFonts, PDFName, PDFString } = await import("/viewer/vendor/pdf-lib/pdf-lib.esm.min.js");
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const pg = pdf.addPage([612, 792]);
      const size = 12;
      pg.drawText("Forms are at https://www.courts.ca.gov/forms.htm for the public.", { x: 72, y: 700, size, font });
      pg.drawText("The rule is posted at https://example.com/rules/2026/", { x: 72, y: 680, size, font });
      pg.drawText("title-3/rule-3.1110.pdf and applies.", { x: 72, y: 666, size, font });
      // One address in two items: a change of face partway through.
      const a = "Also www.exam", b = "ple.org/page today.";
      pg.drawText(a, { x: 72, y: 640, size, font });
      pg.drawText(b, { x: 72 + font.widthOfTextAtSize(a, size), y: 640, size, font: bold });
      // An address the PDF itself links (to somewhere else): its own link stands.
      const linked = "https://linked.example.com/";
      pg.drawText(linked, { x: 72, y: 600, size, font });
      const w = font.widthOfTextAtSize(linked, size);
      const annot = pdf.context.obj({
        Type: "Annot", Subtype: "Link", Rect: [72, 597, 72 + w, 612], Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of("https://target.example.com/") },
      });
      pg.node.set(PDFName.of("Annots"), pdf.context.obj([pdf.context.register(annot)]));
      const bytes = await pdf.save();
      await window.__pdfViewerLoadLocal(new File([bytes], "Links.pdf", { type: "application/pdf" }));
    });
    await page.waitForFunction(() => document.querySelector("#pages > .page-wrapper .textLayer span"), null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelector(".pdfLinkLayer a.plain-url"), null, { timeout: 20000 });
    await page.waitForTimeout(500);

    console.log("2. in the viewer");
    const hrefs = await page.evaluate(() => [...new Set([...document.querySelectorAll(".pdfLinkLayer a.plain-url")].map((a) => a.href))]);
    check("the addresses linked", hrefs, [
      "https://www.courts.ca.gov/forms.htm",
      "https://example.com/rules/2026/title-3/rule-3.1110.pdf",
      "https://www.example.org/page",
    ]);
    check("the wrapped one is a link on each line",
      await page.evaluate(() => document.querySelectorAll('.pdfLinkLayer a.plain-url[href="https://example.com/rules/2026/title-3/rule-3.1110.pdf"]').length), 2);
    check("the PDF's own link kept, no second one over it",
      await page.evaluate(() => [...document.querySelectorAll(".pdfLinkLayer a.pdf-link")].filter((a) => a.href.includes("linked.example") || a.href.includes("target.example")).map((a) => a.href)),
      ["https://target.example.com/"]);
    const onTop = await page.evaluate(() => {
      const a = document.querySelector(".pdfLinkLayer a.plain-url");
      a.scrollIntoView({ block: "center" });
      const r = a.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === a;
    });
    check("the link is what the pointer finds", onTop, true);
    const box = await page.evaluate(() => {
      const r = document.querySelector(".pdfLinkLayer a.plain-url").getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const [popup] = await Promise.all([context.waitForEvent("page", { timeout: 5000 }), page.mouse.click(box.x, box.y)]);
    await popup.waitForLoadState().catch(() => {});
    check("a click opens the address", popup.url(), "https://www.courts.ca.gov/forms.htm");
    check("no page errors", errors, []);
  } finally {
    if (browser) await browser.close();
    try { proc.kill("SIGTERM"); } catch { /* gone */ }
  }
}
await viewer();

console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
