// pdf-edit.js
//
// PDF *writing* — the read/write layer on top of PDF.js's read-only rendering.
// Uses the vendored pdf-lib (pure JS, CSP-safe) to produce a new PDF with
// in-viewer edits applied. Kept deliberately small: callers pass plain data
// (highlight rectangles already in PDF points, extra PDFs to append) and get
// back bytes ready to write to disk.
//
// Highlights are written as real PDF **/Highlight annotations** (the same
// object type Adobe uses), NOT rectangles baked into the page content. That
// matters because annotations stay *separable*: this viewer reloads them as
// removable highlights when the file is reopened, and Adobe / Preview / any
// annotation-aware viewer can delete them too. Baked-in drawings would be
// permanent. Because we round-trip, every save first strips the highlight
// annotations already in the file and rewrites the current set — so the
// in-viewer highlights are the single source of truth (deletions stick).

import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFNumber,
  PDFString,
} from "./vendor/pdf-lib/pdf-lib.esm.min.js";

// Yellow, matching the on-screen highlight, at 40% so text stays readable.
const HL_SUBTYPE = PDFName.of("Highlight");
const HL_COLOR = [1, 0.85, 0];
const HL_OPACITY = 0.4;

// Remove any /Highlight annotations already on a page, so a re-save doesn't
// duplicate the highlights we're about to (re)write from the live set.
function stripHighlightAnnots(page) {
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) return;
  for (let i = annots.size() - 1; i >= 0; i--) {
    let a;
    try { a = annots.lookupMaybe(i, PDFDict); } catch { continue; }
    if (a && a.get(PDFName.of("Subtype")) === HL_SUBTYPE) annots.remove(i);
  }
}

// Add one /Highlight annotation covering `rects` (an array of {x,y,w,h} in PDF
// points, origin bottom-left) — a multi-line highlight becomes one annotation
// with several quadrilaterals.
function addHighlightAnnot(doc, page, rects) {
  const ctx = doc.context;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const quads = [];
  for (const r of rects) {
    if (!(r.w > 0 && r.h > 0)) continue;
    const left = r.x, right = r.x + r.w, bottom = r.y, top = r.y + r.h;
    // QuadPoints order per the PDF spec / Adobe convention: the four corners
    // as (x1 y1)=top-left, (x2 y2)=top-right, (x3 y3)=bottom-left,
    // (x4 y4)=bottom-right.
    quads.push(left, top, right, top, left, bottom, right, bottom);
    if (left < minX) minX = left;
    if (bottom < minY) minY = bottom;
    if (right > maxX) maxX = right;
    if (top > maxY) maxY = top;
  }
  if (!quads.length) return;

  const dict = ctx.obj({});
  dict.set(PDFName.of("Type"), PDFName.of("Annot"));
  dict.set(PDFName.of("Subtype"), HL_SUBTYPE);
  dict.set(PDFName.of("Rect"), ctx.obj([minX, minY, maxX, maxY]));
  dict.set(PDFName.of("QuadPoints"), ctx.obj(quads));
  dict.set(PDFName.of("C"), ctx.obj(HL_COLOR));
  dict.set(PDFName.of("CA"), PDFNumber.of(HL_OPACITY));
  dict.set(PDFName.of("F"), PDFNumber.of(4)); // Print flag
  dict.set(PDFName.of("T"), PDFString.of("PDF Viewer"));
  const ref = ctx.register(dict);

  let annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) {
    annots = ctx.obj([]);
    page.node.set(PDFName.of("Annots"), annots);
  }
  annots.push(ref);
}

// Build an edited copy of a PDF.
//   srcBytes:         Uint8Array/ArrayBuffer of the original PDF.
//   highlightsByPage: Map<pageNumber(1-based), Array<{rects:[{x,y,w,h}]}>> in
//                     PDF points (origin bottom-left), already converted by the
//                     caller — each entry is one highlight (its own annotation).
//   appendBytes:      Array<Uint8Array> of further PDFs to merge in after the
//                     current document's pages (Combine / merge).
// Returns a Uint8Array of the saved PDF.
export async function buildEditedPdf({ srcBytes, highlightsByPage = new Map(), appendBytes = [] }) {
  const doc = await PDFDocument.load(srcBytes);
  const pages = doc.getPages();

  // Rewrite highlights on every page that has (or had) any, so removed
  // highlights disappear and the current set is authoritative.
  const touched = new Set([
    ...highlightsByPage.keys(),
    ...pages.map((_, i) => i + 1),
  ]);
  for (const pageNumber of touched) {
    const page = pages[pageNumber - 1];
    if (!page) continue;
    stripHighlightAnnots(page);
    const list = highlightsByPage.get(pageNumber);
    if (!list) continue;
    for (const hl of list) {
      if (hl && hl.rects && hl.rects.length) addHighlightAnnot(doc, page, hl.rects);
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
