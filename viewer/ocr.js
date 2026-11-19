// OCR fallback for pages that arrive with no (or near-empty) PDF.js text
// layer — i.e. scans and image-only exports, the same pages pdf_linker.py
// skips. The design goal is that the rest of the viewer can stay ignorant
// that OCR happened: this module produces (a) absolutely-positioned <span>s
// in the page's textLayerDiv, in the exact convention placeLinksForPage and
// highlights.js already consume, and (b) a minimal object shaped like a
// PDF.js textContent ({ items: [{ str, hasEOL }] }) for ingestPage.
//
// Once those two artifacts exist, runDetection / placeLinksForPage /
// repaintHighlights / footer naming all work unchanged.

import Tesseract from "./vendor/tesseract/tesseract.esm.min.js";
import { rotatedRunPlacement, normalizeAngle } from "./rotation.js";
import { renderPageOnto } from "./pdf-fonts.js";
import {
  documentKey, loadPage, savePages, hasDocument, sweep, carriedPages, keepDaysFrom,
  DEFAULT_KEEP_DAYS,
} from "./ocr-store.js";
const { createWorker } = Tesseract;

const V = (p) => chrome.runtime.getURL(`viewer/vendor/tesseract/${p}`);

// Render OCR input at a fixed scale, independent of the user's zoom. This
// keeps recognition quality constant and — crucially — lets us cache the
// result once per page and re-derive span geometry on every zoom without
// re-OCRing. 2.0 ≈ 144 DPI for a 72pt/in page, a good speed/accuracy point
// for typed legal documents. Bump toward 3.0 for faxed/low-DPI scans.
const OCR_SCALE = 2.0;

// A page is treated as "no text layer" when its PDF.js text content has
// fewer than this many non-whitespace characters. Pure scans return ~0;
// the threshold tolerates a stray watermark or stamp glyph without
// suppressing OCR on an otherwise-empty page.
const MIN_CHARS = 8;

let workerPromise = null;          // lazy singleton Tesseract worker
const cacheByPage = new Map();     // pageNumber -> { words, hadText:false }
// Pages being recognized right now. A zoom rebuilds every page while OCR is
// still working through them; the rebuilt page waits for the recognition
// already under way instead of queueing the same page again.
const inFlight = new Map();        // pageNumber -> Promise<words>
// The open document's content hash, under which recognized pages are saved
// between visits (ocr-store.js), and how many days they're kept. A null key
// saves nothing: the document isn't open yet, or keeping is off.
let docKey = null;
let keepDays = 0;

export function pageNeedsOcr(textContent) {
  if (!textContent || !textContent.items) return true;
  let n = 0;
  for (const it of textContent.items) {
    if (typeof it.str === "string") {
      for (const ch of it.str) if (!/\s/.test(ch)) { n++; if (n >= MIN_CHARS) return false; }
    }
  }
  return n < MIN_CHARS;
}

// ── Which pages Recognize text reads ─────────────────────────────────────────
//
// The owner (2026-11-19): "PDF+ OCR does not work … Yes, the recognize text
// button." A page was read only where it had next to no text (pageNeedsOcr),
// and two kinds of page the owner gets every day have some:
//
//   A SCAN UNDER A STAMP. eCourt sets its e-filing stamp ("Electronically
//   FILED by Superior Court of California …") over a scanned page as text, so
//   the page had a line of text and its scanned body was never read. Such a
//   page is read where its own text is a scrap (fewer than SPARSE_CHARS) and
//   a picture covers most of it (imageCoverage, off the page's operator
//   list); the stamp keeps its own text, and the recognizer's reading of it is
//   left out (ocrPageToTextLayer's `keep`).
//
//   A PAGE WHOSE INVISIBLE TEXT IS GARBLED. The text layer laid over a scan
//   (drawn invisibly, render mode 3 or 7) can carry private-use code points,
//   control characters and U+FFFD instead of words, which show as boxes when
//   selected or copied, while the page itself reads right. Where enough of the
//   page's INVISIBLE characters are so (pageTextIsGarbled on the whole text,
//   then invisibleTextCounts off the operator list), the page is read from its
//   picture and the recognizer's text replaces the PDF's. Text drawn VISIBLY
//   garbled is left alone (the owner: "When the PDF is visibly garbled, that
//   should be treated as if it is not garbled. it is only when the invisible
//   text layer is garbled …"): the picture shows the same boxes, and reading
//   it gives nothing better.
export const SPARSE_CHARS = 400;
const GARBLED_MIN = 12, GARBLED_SHARE = 0.03;
const isGarbledChar = (c) => {
  const n = c.codePointAt(0);
  return (n >= 0xe000 && n <= 0xf8ff) || n === 0xfffd || (n < 0x20 && n !== 9 && n !== 10 && n !== 13) || (n >= 0x7f && n < 0xa0) || (n >= 0xf0000);
};
/** The page's characters that are not white space, and those of them that are garbled. */
export function textCounts(textContent) {
  let chars = 0, garbled = 0;
  for (const it of (textContent && textContent.items) || []) {
    if (typeof it.str !== "string") continue;
    for (const ch of it.str) {
      if (/\s/.test(ch)) continue;
      chars++;
      if (isGarbledChar(ch)) garbled++;
    }
  }
  return { chars, garbled };
}
/** Whether the page's text is too garbled to be its words (above). */
export function pageTextIsGarbled(textContent) {
  const { chars, garbled } = textCounts(textContent);
  return garbled >= GARBLED_MIN && garbled >= chars * GARBLED_SHARE;
}
/**
 * The characters of the text drawn INVISIBLY on a page (render mode 3 or 7),
 * and those of them garbled, from its operator list (`ops`, pdf.js's OPS as
 * `O`): each text-showing operation's glyphs carry their `unicode`.
 */
export function invisibleTextCounts(ops, O) {
  let chars = 0, garbled = 0;
  if (!ops || !O) return { chars, garbled };
  const show = new Set([O.showText, O.showSpacedText, O.nextLineShowText, O.nextLineSetSpacingShowText].filter((x) => x != null));
  let mode = 0;
  const stack = [];
  for (let k = 0; k < ops.fnArray.length; k++) {
    const fn = ops.fnArray[k];
    if (fn === O.save) stack.push(mode);
    else if (fn === O.restore) mode = stack.length ? stack.pop() : 0;
    else if (fn === O.setTextRenderingMode) mode = ops.argsArray[k][0];
    else if (show.has(fn) && (mode === 3 || mode === 7)) {
      const args = ops.argsArray[k] || [];
      const glyphs = Array.isArray(args[0]) ? args[0] : args;
      for (const g of glyphs) {
        if (!g || typeof g !== "object") continue;
        for (const ch of String(g.unicode || "")) {
          if (/\s/.test(ch)) continue;
          chars++;
          if (isGarbledChar(ch)) garbled++;
        }
      }
    }
  }
  return { chars, garbled };
}
/** Whether the page's INVISIBLE text is garbled, by the same measure as pageTextIsGarbled. */
export async function invisibleTextGarbled(page, O) {
  try {
    const { chars, garbled } = invisibleTextCounts(await page.getOperatorList(), O);
    return garbled >= GARBLED_MIN && garbled >= chars * GARBLED_SHARE;
  } catch { return false; }
}
/** Whether the page's own text is no more than a stamp's worth. */
export function sparseText(textContent) {
  return textCounts(textContent).chars < SPARSE_CHARS;
}
/**
 * The share of the page's area the largest picture drawn on it covers, from
 * its operator list (`ops`: { fnArray, argsArray }, pdf.js's OPS as `O`): the
 * current transform followed through save / restore / transform, and a
 * picture's area the unit square it is drawn into, so transformed. 0..1.
 */
export function imageCoverage(ops, O, pageArea) {
  if (!ops || !O || !(pageArea > 0)) return 0;
  const paint = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject, O.paintImageXObjectRepeat, O.paintJpegXObject].filter((x) => x != null));
  let m = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  let best = 0;
  for (let k = 0; k < ops.fnArray.length; k++) {
    const fn = ops.fnArray[k];
    if (fn === O.save) stack.push(m);
    else if (fn === O.restore) m = stack.length ? stack.pop() : [1, 0, 0, 1, 0, 0];
    else if (fn === O.transform) m = mul(ops.argsArray[k], m);
    else if (fn === O.paintFormXObjectBegin && Array.isArray(ops.argsArray[k]) && Array.isArray(ops.argsArray[k][0])) { stack.push(m); m = mul(ops.argsArray[k][0], m); }
    else if (fn === O.paintFormXObjectEnd) m = stack.length ? stack.pop() : [1, 0, 0, 1, 0, 0];
    else if (paint.has(fn)) best = Math.max(best, Math.abs(m[0] * m[3] - m[1] * m[2]) / pageArea);
  }
  return Math.min(1, best);
}
/** Whether a page is a picture under a scrap of text: a picture over half of it at least. */
export async function pageIsScan(page, O) {
  try {
    const vp = page.getViewport({ scale: 1 });
    return imageCoverage(await page.getOperatorList(), O, vp.width * vp.height) >= 0.5;
  } catch { return false; }
}

// Tear down between documents: clears the per-page cache and terminates the
// worker so a new PDF doesn't inherit stale boxes or leak a worker per load.
export async function resetOcr() {
  cacheByPage.clear();
  inFlight.clear();
  docKey = null;
  if (workerPromise) {
    const w = await workerPromise.catch(() => null);
    workerPromise = null;
    if (w) { try { await w.terminate(); } catch { /* already gone */ } }
  }
}

function getKeepDays() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ ocrCacheDays: DEFAULT_KEEP_DAYS }, ({ ocrCacheDays }) => {
      resolve(keepDaysFrom(ocrCacheDays));
    });
  });
}

// Tell OCR which document is open, by its bytes, before its pages render.
// Sweeps out saved pages past the keep window, and returns true when this
// document has recognized pages to show — saved from an earlier visit, or
// carried over from the version of it just edited (see remapOcrPages) — so
// the viewer can turn OCR on for it without the button being clicked again.
export async function openOcrDocument(bytes) {
  docKey = null;
  let key = null;
  try {
    [key, keepDays] = await Promise.all([documentKey(bytes), getKeepDays()]);
  } catch { return cacheByPage.size > 0; }
  await sweep(keepDays);
  if (!keepDays) return cacheByPage.size > 0;
  docKey = key;
  // An in-place edit reloads the document without resetOcr, so the pages
  // already recognized are still in memory: they belong to the new file too.
  await savePages(key, [...cacheByPage].map(([n, { words }]) => [n, words]));
  return cacheByPage.size > 0 || await hasDocument(key);
}

// Before an edited file replaces the open one, carry recognized pages to where
// the edit put them. `plan` is the page plan the edit applied
// ([{ srcIndex, rotate }] per output page); a page the plan turns, or one new
// to the file, is recognized again. Edits that keep every page where it was
// (stamps, form fill, appended pages) don't need to call this.
export function remapOcrPages(plan) {
  const old = new Map(cacheByPage);
  cacheByPage.clear();
  // A recognition still running belongs to the page's old place.
  inFlight.clear();
  for (const [page, from] of carriedPages(plan)) {
    if (from != null && old.has(from)) cacheByPage.set(page, old.get(from));
  }
}

// Save the recognized pages under a file just written from this one without
// reloading it (Save with only highlights added), so reopening that file finds
// them. The pages are unchanged; only the bytes around them differ.
export async function rememberOcrFor(bytes) {
  if (!keepDays || !cacheByPage.size) return;
  try {
    const key = await documentKey(bytes);
    await savePages(key, [...cacheByPage].map(([n, { words }]) => [n, words]));
  } catch { /* recognized again next time */ }
}

function getWorker() {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const worker = await createWorker("eng", 1, {
      // All paths are bundled extension URLs — MV3 forbids fetching code
      // from a CDN, so nothing here points off-extension.
      workerPath: V("worker.min.js"),
      // Point directly at the non-SIMD .wasm.js file so Tesseract doesn't
      // probe for the SIMD variant (tesseract-core-relaxedsimd-lstm.wasm.js)
      // which is not bundled and would cause a NetworkError.
      corePath: V("tesseract-core-lstm.wasm.js"),
      langPath: V(""),            // dir containing eng.traineddata
      gzip: false,                // we vendored the uncompressed .traineddata
      workerBlobURL: false,       // load worker.min.js directly, not via blob:
      // legacyCore/legacyLang stay false: LSTM-only core + fast data.
    });
    return worker;
  })();
  return workerPromise;
}

// Run OCR for one page (or return the cached result) and return word boxes
// in PDF user space (scale === 1), so callers can multiply by the current
// display scale. Each word: { text, x0, y0, x1, y1, eol, par }.
async function ocrWords(page, pageNumber, setStatus) {
  if (cacheByPage.has(pageNumber)) return cacheByPage.get(pageNumber).words;
  if (inFlight.has(pageNumber)) return inFlight.get(pageNumber);
  const job = recognizeWords(page, pageNumber, setStatus);
  inFlight.set(pageNumber, job);
  try {
    return await job;
  } finally {
    if (inFlight.get(pageNumber) === job) inFlight.delete(pageNumber);
  }
}

async function recognizeWords(page, pageNumber, setStatus) {

  // Recognized on an earlier visit? The key is captured now: if another
  // document opens while this page is being recognized, its words must not
  // land in that document's cache.
  const key = docKey;
  if (key) {
    const saved = await loadPage(key, pageNumber, keepDays);
    if (saved) {
      if (key === docKey) cacheByPage.set(pageNumber, { words: saved, hadText: false });
      return saved;
    }
  }

  const viewport = page.getViewport({ scale: OCR_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  // Drawn by way of the document the PDF's fonts are in (pdf-fonts.js), then
  // handed to the recognizer as a canvas of this one.
  await renderPageOnto(page, canvas, { viewport }).promise;

  if (setStatus) setStatus(`OCR page ${pageNumber}…`);
  const worker = await getWorker();
  // blocks:true is required in tesseract.js v7 to get word/line geometry.
  const { data } = await worker.recognize(canvas, {}, { blocks: true });

  const words = [];
  let parIndex = 0;
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      const lines = para.lines || [];
      for (let li = 0; li < lines.length; li++) {
        const ws = lines[li].words || [];
        for (let wi = 0; wi < ws.length; wi++) {
          const w = ws[wi];
          const b = w.bbox; // pixels in OCR_SCALE space
          words.push({
            text: w.text,
            x0: b.x0 / OCR_SCALE, y0: b.y0 / OCR_SCALE,
            x1: b.x1 / OCR_SCALE, y1: b.y1 / OCR_SCALE,
            eol: wi === ws.length - 1,      // last word of a visual line
            par: parIndex,                  // paragraph id for blank-line breaks
          });
        }
      }
      parIndex++;
    }
  }
  canvas.width = canvas.height = 0; // release the OCR bitmap
  if (key === docKey) cacheByPage.set(pageNumber, { words, hadText: false });
  if (key) await savePages(key, [[pageNumber, words]]);
  return words;
}

/**
 * The recognized words that do not stand on the page's own text (`keep`'s
 * items, each a box from its transform, width and height, in the page's own
 * view at scale 1 — its /Rotate taken, as the picture read was drawn).
 */
export function withoutKept(words, keep, page) {
  let vp;
  try { vp = page.getViewport({ scale: 1 }); } catch { return words; }
  const boxes = [];
  for (const it of keep.items || []) {
    if (!it || !it.transform || !String(it.str || "").trim()) continue;
    const [, , c, d, e, f] = it.transform;
    const h = Math.abs(it.height || Math.hypot(c, d)) || 1;
    const w = Math.abs(it.width || 0);
    const pts = [[e, f - h * 0.3], [e + w, f - h * 0.3], [e, f + h], [e + w, f + h]].map(([x, y]) => vp.convertToViewportPoint(x, y));
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    boxes.push({ x0: Math.min(...xs) - 1.5, x1: Math.max(...xs) + 1.5, y0: Math.min(...ys) - 1.5, y1: Math.max(...ys) + 1.5 });
  }
  if (!boxes.length) return words;
  return words.filter((w) => {
    const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2;
    return !boxes.some((b) => cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1);
  });
}

function getLeftMarginPct() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ ocrLeftMarginPct: 8 }, ({ ocrLeftMarginPct }) => {
      resolve(Math.min(30, Math.max(0, Number(ocrLeftMarginPct) || 0)));
    });
  });
}

// Main entry. Recognizes the page if needed, paints transparent spans into
// textLayerDiv positioned over the rendered glyphs at the current display
// scale, and returns a textContent-shaped object for ingestPage. Geometry
// derives from the cached user-space boxes, so this is cheap to re-run on
// zoom (only the first call per page actually OCRs) — and on a rotate, which
// turns the spans with the page instead of re-recognizing it.
//
// `rotation` is the rotate tool's extra clockwise angle. Recognition always
// runs on the page as the PDF stores it, so the cached boxes stay valid and
// only their placement changes.
export async function ocrPageToTextLayer({
  page, pageNumber, displayScale, userHeight, userWidth, rotation = 0,
  textLayerDiv, setStatus, keep = null,
}) {
  let allWords = await ocrWords(page, pageNumber, setStatus);
  // `keep`: the page's own text (a stamp over a scan), laid out already. The
  // recognizer read it off the picture too; its words there are left out.
  if (keep && keep.items && keep.items.length) allWords = withoutKept(allWords, keep, page);

  // Filter words in the left-margin exclusion zone. The cutoff is a
  // percentage of the page's user-space width, read from storage each call
  // so the Options-page slider takes effect on the next zoom without reload.
  const leftMarginPct = await getLeftMarginPct();
  const pageWidth = page.getViewport({ scale: 1 }).width;
  const cutoff = pageWidth * (leftMarginPct / 100);
  const words = cutoff > 0 ? allWords.filter(w => w.x0 >= cutoff) : allWords;

  const s = displayScale;
  const angle = normalizeAngle(rotation);
  // The unrotated display box the OCR boxes live in — what a rotated placement
  // measures against.
  const pageH = userHeight || page.getViewport({ scale: 1 }).height;
  const pageW = userWidth || pageWidth;

  const items = [];
  let lastPar = words.length ? words[0].par : 0;

  // Accumulate words into lines; emit one <span> per line so that text
  // selection highlights in clean line-sized blocks instead of per-word chunks.
  let lineWords = [];

  const flushLine = () => {
    if (!lineWords.length) return;
    const x0 = lineWords[0].x0;
    const x1 = lineWords[lineWords.length - 1].x1;
    const y0 = Math.min(...lineWords.map(w => w.y0));
    const y1 = Math.max(...lineWords.map(w => w.y1));
    const text   = lineWords.map(w => w.text).join(" ");
    // On a rotated page the line starts where its top-left corner ended up and
    // runs in the direction the page was turned; upright, this is just x0/y0.
    const { left, top, runWidth: width, runHeight: height } = rotatedRunPlacement({
      x0, y0, x1, y1, pageW, pageH, angle, scale: s,
    });

    const span = document.createElement("span");
    span.textContent = text;
    span.style.left       = `${left}px`;
    span.style.top        = `${top}px`;
    span.style.fontSize   = `${Math.max(height, 1)}px`;
    span.style.fontFamily = "sans-serif";
    if (angle) span.style.transformOrigin = "0 0";
    textLayerDiv.appendChild(span);
    // Stretch to fit so getClientRects() lines up with the rendered image. The
    // rotation goes on the same transform, applied before the stretch so the
    // stretch still runs along the line of text.
    const natural = span.getBoundingClientRect().width;
    const scaleX = natural > 0 && width > 0 ? width / natural : 1;
    const parts = [];
    if (angle) parts.push(`rotate(${angle}deg)`);
    if (scaleX !== 1) parts.push(`scaleX(${scaleX})`);
    if (parts.length) span.style.transform = parts.join(" ");
    lineWords = [];
  };

  for (const w of words) {
    if (!w.text) continue;

    // textContent items stay word-by-word so citation detection works normally.
    // A paragraph change emits a blank-line break (two EOLs) so walk-back
    // boundaries in the detector fire the same way as a native text layer.
    if (w.par !== lastPar) {
      items.push({ str: "", hasEOL: true });
      lastPar = w.par;
    }
    items.push({
      str: w.eol ? w.text : w.text + " ",
      hasEOL: w.eol,
      transform: [1, 0, 0, 1, w.x0, (userHeight || 0) - w.y1],
      width: w.x1 - w.x0,
      height: w.y1 - w.y0,
    });

    lineWords.push(w);
    if (w.eol) flushLine();
  }
  flushLine(); // trailing line with no eol marker

  return { items };
}
