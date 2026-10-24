// The text reader's layout beside its PDF, measured over a PDF-Linker case
// folder: each export opened in the reader as the operator opens it (the
// folder's key read, its PDF matched by the reader itself, side by side), each
// page laid on its PDF's grid, and what the reader draws compared with what
// the PDF prints, word by word, as PyMuPDF reads it (audit/layout-truth.py:
// a reading that shares nothing with the reader's own, pdf.js).
//
//   node audit/layout-audit.mjs CASE_FOLDER [--pages 1-12] [--doc TEXT] [--out FILE.json] [--lines] [--shots DIR]
//
// CASE_FOLDER is a folder PDF-Linker has run on: its PDFs, `Text Files/`, its
// `pseudonym_key.xlsx` and `pdf_linker.log` (which names each PDF's export).
// Each export is read in an origin-private folder of its own holding it, its
// PDF and the key, so no document hangs on another's reel.
//
// Per page, graded (a scan's OCR sizes and faces are not):
//   overlap    two lines' type drawn over each other (their text boxes cross
//              by more than a quarter of the smaller's height)
//   size       a word drawn more than 15% off the size the PDF prints it at
//   bold+ / bold-, ital+ / ital-
//              a word drawn bold (italic) the PDF does not set so, or not
//              drawn so where the PDF does
//   register   a line's words standing more than 6 points above or below the
//              PDF's (centre to centre)
//   overflow   a line's text running past the PDF's furthest-right type by
//              more than 6 points
//   grown      the page taller than its paper
// The report names each document's counts and the worst lines, with their
// text: it is real text, and stays on this machine (write --out outside any
// shared folder).
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium),
// python3 with PyMuPDF.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "../browser-for-tests.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PW = "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = "/opt/pw-browsers/chromium";

const args = process.argv.slice(2);
const opt = (name, dflt = null) => { const k = args.indexOf(name); return k >= 0 ? args[k + 1] : dflt; };
const CASE = args.find((a, k) => !a.startsWith("--") && !(k > 0 && args[k - 1].startsWith("--")));
if (!CASE || !fs.existsSync(CASE)) { console.error("usage: node audit/layout-audit.mjs CASE_FOLDER [--pages 1-12] [--doc TEXT] [--out FILE.json]"); process.exit(2); }
const [P0, P1] = String(opt("--pages", "1-12")).split("-").map(Number);
const ONLY = opt("--doc");
const OUT = opt("--out");
const SETTLE = Number(opt("--settle", "700"));
const LINES = args.includes("--lines"); // each page's lines as drawn (text, top, bottom, size), in the report
const SHOTS = opt("--shots"); // a folder: each graded page as the reader draws it, and its PDF beside it, as PNGs

// ── the folder: each PDF and its export, from the run's own log ───────────────
function pairs(folder) {
  const log = path.join(folder, "pdf_linker.log");
  const out = [];
  if (fs.existsSync(log)) {
    let pdf = null;
    for (const line of fs.readFileSync(log, "utf8").split(/\r?\n/)) {
      const p = line.match(/Processing: (.+\.pdf)\s*$/i);
      if (p) { pdf = p[1]; continue; }
      const t = line.match(/Wrote pseudonymized text version: (?:Text Files[\\/])?(.+\.txt)\s*$/i) || line.match(/Wrote text version: (?:Text Files[\\/])?(.+\.txt)\s*$/i);
      if (t && pdf) { out.push({ pdf, txt: t[1] }); pdf = null; }
    }
  }
  // (The last run's pairs win: a folder run twice names each pair twice.)
  const seen = new Map();
  for (const p of out) seen.set(p.pdf, p);
  return [...seen.values()].filter((p) => fs.existsSync(path.join(folder, p.pdf)) && fs.existsSync(path.join(folder, "Text Files", p.txt)));
}

function truth(pdfPath) {
  const r = spawnSync("python3", ["-W", "ignore", path.join(REPO, "audit", "layout-truth.py"), pdfPath, String(P0), String(P1)], { encoding: "utf8", maxBuffer: 256 << 20 });
  if (r.status !== 0) throw new Error("layout-truth.py: " + r.stderr.slice(-400));
  return JSON.parse(r.stdout);
}

// ── a server for the reader and the folder ───────────────────────────────────
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".pdf": "application/pdf", ".svg": "image/svg+xml", ".png": "image/png", ".xlsx": "application/octet-stream", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm", ".bcmap": "application/octet-stream", ".pfb": "application/octet-stream", ".ttf": "font/ttf" };
function serve() {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = u.startsWith("/__case/") ? path.join(path.resolve(CASE), u.slice(8)) : path.join(REPO, u);
    const root = u.startsWith("/__case/") ? path.resolve(CASE) : REPO;
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve(srv)));
}

// ── the reader's page, as drawn ──────────────────────────────────────────────
async function readerPages(page) {
  return page.evaluate(async ({ P0, P1, SETTLE, LINES }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = [];
    const secs = [...document.querySelectorAll("#pages .tpage:not(.shed)")];
    for (const sec of secs) {
      const lab = sec.querySelector(":scope > .page-label");
      const m = lab && lab.textContent.match(/Page (\d+)/);
      const n = m ? Number(m[1]) : null;
      if (!n || n < P0 || n > P1) continue;
      sec.scrollIntoView({ block: "start" });
      const t0 = performance.now();
      // (A plan made before the PDF's rows were read has no tops: not laid yet.)
      while (performance.now() - t0 < 20000 && !(sec.__plan && sec.__plan.tops && sec.classList.contains("matched"))) await sleep(100);
      await sleep(SETTLE);
      const body = sec.querySelector(".page-body");
      if (!body) continue;
      const br = body.getBoundingClientRect();
      const lines = [];
      for (const [k, l] of [...body.querySelectorAll(":scope > .line")].entries()) {
        if (l.classList.contains("lead") || getComputedStyle(l).display === "none") continue;
        const lt = l.querySelector(":scope > .lt") || l;
        const words = [];
        const walk = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (t.parentElement.closest(".gn, .rb, .rh, .cb") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
        for (let t = walk.nextNode(); t; t = walk.nextNode()) {
          const cs = getComputedStyle(t.parentElement);
          if (cs.visibility === "hidden" || cs.color === "rgba(0, 0, 0, 0)") continue;
          for (const w of t.data.matchAll(/\S+/g)) {
            const r = document.createRange();
            r.setStart(t, w.index);
            r.setEnd(t, w.index + w[0].length);
            const b = r.getClientRects()[0];
            if (!b || !b.width) continue;
            words.push({ t: w[0], x0: b.left - br.left, x1: b.right - br.left, top: b.top - br.top, bottom: b.bottom - br.top, size: parseFloat(cs.fontSize), bold: Number(cs.fontWeight) >= 600, italic: cs.fontStyle === "italic" });
          }
        }
        if (words.length) lines.push({ k, words });
      }
      // (With --lines, the reader's own plan for the page too: each line's top, size and box in PDF units.)
      const pl = LINES && sec.__plan ? { tops: sec.__plan.tops, sizes: sec.__plan.sizes, boxes: sec.__plan.boxes, texts: [...body.querySelectorAll(":scope > .line")].map((l) => l.textContent.slice(0, 40)) } : null;
      out.push({ n, index: Number(sec.dataset.index), width: br.width, height: br.height, fixed: body.classList.contains("fixed"), lines, plan: pl });
    }
    return out;
  }, { P0, P1, SETTLE, LINES });
}

/** Each graded page as the reader draws it, and the PDF page the reader shows
 * beside it: "<export> p<N> reader.png" and "<export> p<N> pdf.png" in --shots.
 * Real text: keep the folder off anything shared, as the report. */
async function shoot(page, p, rp) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const stem = p.txt.replace(/\.txt$/i, "");
  for (const r of rp) {
    const sel = `#pages .tpage[data-index="${r.index}"]`;
    const el = await page.$(sel);
    if (!el) continue;
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(SETTLE);
    await el.screenshot({ path: path.join(SHOTS, `${stem} p${r.n} reader.png`) }).catch(() => {});
    const slot = await page.$(`#pdf-pane .pdf-slot[data-index="${r.index}"]`);
    if (slot) await slot.screenshot({ path: path.join(SHOTS, `${stem} p${r.n} pdf.png`) }).catch(() => {});
  }
}

// ── the comparison ───────────────────────────────────────────────────────────
const norm = (t) => String(t).toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
function grade(rp, tp) {
  const scale = rp.width / tp.w;
  const pt = (v) => v / scale;
  const issues = [];
  const count = { overlap: 0, size: 0, "bold+": 0, "bold-": 0, "ital+": 0, "ital-": 0, register: 0, overflow: 0, grown: 0, words: 0, matched: 0 };
  // Each PDF word by its text, to be claimed once each, nearest first.
  const byText = new Map();
  for (const w of tp.words) { const k = norm(w.t); if (!k) continue; if (!byText.has(k)) byText.set(k, []); byText.get(k).push({ ...w, cy: (w.top + w.bottom) / 2, used: false }); }
  const right = Math.max(0, ...tp.words.map((w) => w.x1));
  const lineText = (l) => l.words.map((w) => w.t).join(" ");
  for (const l of rp.lines) {
    const offs = [];
    for (const w of l.words) {
      const k = norm(w.t);
      if (!k) continue; // (a dot leader's dots, a dash: no word to match)
      count.words++;
      const cands = byText.get(k);
      if (!cands) continue;
      const cy = pt((w.top + w.bottom) / 2), cx = pt(w.x0);
      let best = null, bd = Infinity;
      for (const c of cands) {
        if (c.used) continue;
        const d = Math.abs(c.cy - cy) + Math.abs(c.x0 - cx) * 0.25;
        if (d < bd) { bd = d; best = c; }
      }
      // Too far down the page to be the same word (a word repeated elsewhere).
      if (!best || Math.abs(best.cy - cy) > 40) continue;
      best.used = true;
      count.matched++;
      offs.push(best.cy - cy);
      if (!tp.scan) {
        const ratio = pt(w.size) / best.size;
        if (ratio < 0.85 || ratio > 1.15) { count.size++; issues.push({ kind: "size", line: lineText(l), word: w.t, drawn: +pt(w.size).toFixed(1), pdf: best.size }); }
        if (w.bold && !best.bold) { count["bold+"]++; issues.push({ kind: "bold+", line: lineText(l), word: w.t }); }
        if (!w.bold && best.bold) { count["bold-"]++; issues.push({ kind: "bold-", line: lineText(l), word: w.t }); }
        if (w.italic && !best.italic) { count["ital+"]++; issues.push({ kind: "ital+", line: lineText(l), word: w.t }); }
        if (!w.italic && best.italic) { count["ital-"]++; issues.push({ kind: "ital-", line: lineText(l), word: w.t }); }
      }
    }
    if (offs.length) {
      const med = offs.slice().sort((a, b) => a - b)[Math.floor(offs.length / 2)];
      if (Math.abs(med) > 6) { count.register++; issues.push({ kind: "register", line: lineText(l), off: +med.toFixed(1) }); }
    }
    const lr = pt(Math.max(...l.words.map((w) => w.x1)));
    if (right > 0 && lr > right + 6) { count.overflow++; issues.push({ kind: "overflow", line: lineText(l), past: +(lr - right).toFixed(1) }); }
  }
  // Lines drawn over each other: any two words of two lines whose boxes cross.
  const boxes = rp.lines.map((l) => l.words.map((w) => ({ ...w, l })));
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      let hit = null;
      for (const p of boxes[a]) {
        for (const q of boxes[b]) {
          const h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
          const w = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0);
          if (w > 2 && h > 0.25 * Math.min(p.bottom - p.top, q.bottom - q.top)) { hit = [p, q]; break; }
        }
        if (hit) break;
      }
      if (hit) { count.overlap++; issues.push({ kind: "overlap", line: lineText(rp.lines[a]), other: lineText(rp.lines[b]) }); }
    }
  }
  if (pt(rp.height) > tp.h + 2) { count.grown++; issues.push({ kind: "grown", by: +(pt(rp.height) - tp.h).toFixed(1) }); }
  return { count, issues };
}

// ── the run ──────────────────────────────────────────────────────────────────
const { chromium } = await import(PW);
const srv = await serve();
const BASE = `http://127.0.0.1:${srv.address().port}`;
const browser = await launchBrowser(chromium, CHROME);
const report = [];
const list = pairs(CASE).filter((p) => !ONLY || p.pdf.toLowerCase().includes(ONLY.toLowerCase()) || p.txt.toLowerCase().includes(ONLY.toLowerCase()));
if (!list.length) console.error("No PDF and export pairs in the folder's pdf_linker.log.");
const hasKey = fs.existsSync(path.join(CASE, "pseudonym_key.xlsx"));
try {
  for (const [k, p] of list.entries()) {
    const t0 = Date.now();
    let tr;
    try { tr = truth(path.join(CASE, p.pdf)); } catch (e) { report.push({ ...p, error: String(e.message || e) }); continue; }
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept().catch(() => {}));
    if (process.env.AUDIT_CONSOLE) page.on("console", (m) => { if (process.env.AUDIT_CONSOLE === "*" || m.text().startsWith(process.env.AUDIT_CONSOLE)) console.log("  [page]", m.text().slice(0, 600)); });
    await page.goto(BASE + "/viewer/text-reader.html");
    await page.waitForFunction(() => !!window.__textReaderAdoptFolder);
    let rp = [];
    try {
      await page.evaluate(async ({ k, p, hasKey }) => {
        const top = await navigator.storage.getDirectory();
        const name = "Audit " + k;
        try { await top.removeEntry(name, { recursive: true }); } catch { /* none yet */ }
        const dir = await top.getDirectoryHandle(name, { create: true });
        const put = async (d, file, src) => { const b = await (await fetch(src)).arrayBuffer(); const w = await (await d.getFileHandle(file, { create: true })).createWritable(); await w.write(b); await w.close(); };
        const enc = (s) => s.split("/").map(encodeURIComponent).join("/");
        await put(dir, p.pdf, "/__case/" + enc(p.pdf));
        await put(await dir.getDirectoryHandle("Text Files", { create: true }), p.txt, "/__case/" + enc("Text Files/" + p.txt));
        if (hasKey) await put(dir, "pseudonym_key.xlsx", "/__case/pseudonym_key.xlsx");
        await window.__textReaderAdoptFolder(dir);
        await window.__textReaderOpenDoc(p.txt);
      }, { k, p, hasKey });
      await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body").length > 0, null, { timeout: 30000 });
      const sbs = await page.$("#sbs-toggle");
      if (sbs && !(await sbs.evaluate((b) => b.getAttribute("aria-pressed") === "true"))) await sbs.click();
      await page.waitForFunction(() => !!document.querySelector("#pages .tpage.matched"), null, { timeout: 30000 }).catch(() => {});
      rp = await readerPages(page);
      if (SHOTS) await shoot(page, p, rp);
    } catch (e) { errors.push("audit: " + String(e.message || e).split("\n")[0]); }
    await ctx.close();
    const doc = { ...p, pages: [], total: {}, errors, scans: 0, ms: 0 };
    for (const r of rp) {
      const t = tr.pages.find((x) => x.n === r.n);
      if (!t) continue;
      const g = grade(r, t);
      if (t.scan) doc.scans++;
      const scale = r.width / t.w;
      const geometry = LINES ? r.lines.map((l) => ({ text: l.words.map((w) => w.t).join(" "), top: +(Math.min(...l.words.map((w) => w.top)) / scale).toFixed(1), bottom: +(Math.max(...l.words.map((w) => w.bottom)) / scale).toFixed(1), size: +(l.words[0].size / scale).toFixed(1), bold: l.words.some((w) => w.bold) })) : undefined;
      doc.pages.push({ n: r.n, scan: t.scan, fixed: r.fixed, ...g, geometry, plan: r.plan || undefined });
      for (const [key, v] of Object.entries(g.count)) doc.total[key] = (doc.total[key] || 0) + v;
    }
    doc.ms = Date.now() - t0;
    report.push(doc);
    const c = doc.total;
    console.log(`${p.txt}: ${doc.pages.length} page(s)${doc.scans ? `, ${doc.scans} scanned` : ""} — overlap ${c.overlap || 0}, size ${c.size || 0}, bold+ ${c["bold+"] || 0}, bold- ${c["bold-"] || 0}, ital+ ${c["ital+"] || 0}, ital- ${c["ital-"] || 0}, register ${c.register || 0}, overflow ${c.overflow || 0}, grown ${c.grown || 0} (${c.matched || 0}/${c.words || 0} words matched)${errors.length ? " — ERRORS: " + errors.slice(0, 2).join(" | ") : ""}`);
  }
} finally {
  await browser.close();
  srv.close();
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
const sum = {};
for (const d of report) for (const [k, v] of Object.entries(d.total || {})) sum[k] = (sum[k] || 0) + v;
console.log("\nALL: " + Object.entries(sum).map(([k, v]) => `${k} ${v}`).join(", "));
