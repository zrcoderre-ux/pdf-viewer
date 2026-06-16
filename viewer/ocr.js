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

// Tear down between documents: clears the per-page cache and terminates the
// worker so a new PDF doesn't inherit stale boxes or leak a worker per load.
export async function resetOcr() {
  cacheByPage.clear();
  if (workerPromise) {
    const w = await workerPromise.catch(() => null);
    workerPromise = null;
    if (w) { try { await w.terminate(); } catch { /* already gone */ } }
  }
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

  const viewport = page.getViewport({ scale: OCR_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

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
  cacheByPage.set(pageNumber, { words, hadText: false });
  canvas.width = canvas.height = 0; // release the OCR bitmap
  return words;
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
// zoom (only the first call per page actually OCRs).
export async function ocrPageToTextLayer({ page, pageNumber, displayScale, userHeight, textLayerDiv, setStatus }) {
  const allWords = await ocrWords(page, pageNumber, setStatus);

  // Filter words in the left-margin exclusion zone. The cutoff is a
  // percentage of the page's user-space width, read from storage each call
  // so the Options-page slider takes effect on the next zoom without reload.
  const leftMarginPct = await getLeftMarginPct();
  const pageWidth = page.getViewport({ scale: 1 }).width;
  const cutoff = pageWidth * (leftMarginPct / 100);
  const words = cutoff > 0 ? allWords.filter(w => w.x0 >= cutoff) : allWords;

  const s = displayScale;

  const items = [];
  let lastPar = words.length ? words[0].par : 0;

  for (const w of words) {
    if (!w.text) continue;

    const left = w.x0 * s;
    const top = w.y0 * s;
    const width = (w.x1 - w.x0) * s;
    const height = (w.y1 - w.y0) * s;

    const span = document.createElement("span");
    span.textContent = w.text;
    span.style.left = `${left}px`;
    span.style.top = `${top}px`;
    span.style.fontSize = `${Math.max(height, 1)}px`;
    span.style.fontFamily = "sans-serif";
    textLayerDiv.appendChild(span);
    // Stretch the glyph box to the OCR word width so getClientRects() (used
    // by the link/highlight layers to build Ranges) lines up with the image.
    const natural = span.getBoundingClientRect().width;
    if (natural > 0 && width > 0) {
      span.style.transform = `scaleX(${width / natural})`;
    }

    // Synthetic textContent item. A paragraph change emits a blank-line
    // break (two EOLs) so the detector's walk-back boundaries fire the way
    // they do on a real text layer.
    if (w.par !== lastPar) {
      items.push({ str: "", hasEOL: true });
      lastPar = w.par;
    }
    // Geometry mirrors PDF.js textContent items: transform is [a,b,c,d,e,f]
    // with (e,f) the position in PDF user space (origin bottom-left), so f =
    // pageHeight - y1. This lets footerLines() detect a running-footer title
    // on scanned pages exactly as it does on native text layers.
    items.push({
      str: w.text,
      hasEOL: w.eol,
      transform: [1, 0, 0, 1, w.x0, (userHeight || 0) - w.y1],
      width: w.x1 - w.x0,
      height: w.y1 - w.y0,
    });
  }

  return { items };
}
