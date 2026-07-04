// pdf-edit.js
//
// PDF *writing* — the read/write layer on top of PDF.js's read-only rendering.
// Uses the vendored pdf-lib (pure JS, CSP-safe) to produce a new PDF with
// in-viewer edits baked in. Kept deliberately small: callers pass plain data
// (highlight rectangles already in PDF points, extra PDFs to append) and get
// back bytes ready to write to disk.

import {
  PDFDocument,
  rgb,
  BlendMode,
} from "./vendor/pdf-lib/pdf-lib.esm.min.js";

// Yellow, matching the on-screen highlight. Multiply blend keeps the text
// underneath readable instead of painting an opaque block over it.
const HIGHLIGHT_RGB = rgb(1, 0.85, 0);

// Build an edited copy of a PDF.
//   srcBytes:        Uint8Array/ArrayBuffer of the original PDF.
//   highlightsByPage: Map<pageNumber(1-based), Array<{x,y,w,h}>> in PDF points
//                     (origin bottom-left), already converted by the caller.
//   appendBytes:     Array<Uint8Array> of further PDFs to merge in after the
//                     current document's pages (Combine / merge).
// Returns a Uint8Array of the saved PDF.
export async function buildEditedPdf({ srcBytes, highlightsByPage = new Map(), appendBytes = [] }) {
  const doc = await PDFDocument.load(srcBytes);
  const pages = doc.getPages();

  for (const [pageNumber, rects] of highlightsByPage) {
    const page = pages[pageNumber - 1];
    if (!page || !rects || !rects.length) continue;
    for (const r of rects) {
      if (r.w <= 0 || r.h <= 0) continue;
      page.drawRectangle({
        x: r.x,
        y: r.y,
        width: r.w,
        height: r.h,
        color: HIGHLIGHT_RGB,
        opacity: 0.4,
        blendMode: BlendMode.Multiply,
      });
    }
  }

  for (const bytes of appendBytes) {
    if (!bytes) continue;
    const other = await PDFDocument.load(bytes);
    const copied = await doc.copyPages(other, other.getPageIndices());
    for (const p of copied) doc.addPage(p);
  }

  return doc.save();
}

// Page count of a PDF (used to report merge results).
export async function pageCount(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}
