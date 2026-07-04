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
  StandardFonts,
  degrees,
  rgb,
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

// Reorder / rotate / delete pages in one pass. `plan` is the desired final page
// list: an array of { srcIndex, rotate } where srcIndex is the 0-based page in
// the source and rotate is extra clockwise rotation in degrees (0/90/180/270).
// Pages omitted from the plan are dropped; the plan's order is the new order.
// copyPages carries each page's annotations (e.g. our highlights) along, and a
// page's /Rotate applies to its annotations too, so highlights stay put.
// Extracting a subset is just a plan that lists only the wanted pages.
export async function applyPagePlan({ srcBytes, plan }) {
  if (!plan || !plan.length) throw new Error("A document must keep at least one page.");
  const src = await PDFDocument.load(srcBytes);
  const pageCount = src.getPageCount();
  const out = await PDFDocument.create();
  const indices = plan.map((p) => p.srcIndex);
  if (indices.some((i) => !Number.isInteger(i) || i < 0 || i >= pageCount)) {
    throw new Error("Page plan references a page that doesn't exist.");
  }
  const copied = await out.copyPages(src, indices);
  copied.forEach((pg, i) => {
    const delta = ((plan[i].rotate || 0) % 360 + 360) % 360;
    if (delta) {
      const base = pg.getRotation().angle || 0;
      pg.setRotation(degrees((base + delta) % 360));
    }
    out.addPage(pg);
  });
  return out.save();
}

// Map a text slot in a page's *displayed* box to unrotated page coordinates for
// drawText, plus the counter-rotation that keeps the text upright.
//   angle:  the page's /Rotate (0/90/180/270).
//   halign: "l" | "c" | "r";  valign: "top" | "bottom".
// The displayed box swaps width/height on 90°/270°; the (Xd, Yd) point picked
// there is mapped back through the /Rotate viewing transform. For unrotated
// pages this is just the geometric position.
function placeInBox({ angle, W, H, tw, fontSize, margin, halign, valign }) {
  const rotated = angle === 90 || angle === 270;
  const Wd = rotated ? H : W;
  const Hd = rotated ? W : H;
  const Xd = halign === "l" ? margin
    : halign === "r" ? Wd - margin - tw
    : (Wd - tw) / 2;
  const Yd = valign === "bottom" ? margin : Hd - margin - fontSize;
  let x, y;
  if (angle === 90)       { x = W - Yd; y = Xd; }
  else if (angle === 180) { x = W - Xd; y = H - Yd; }
  else if (angle === 270) { x = Yd;     y = H - Xd; }
  else                    { x = Xd;     y = Yd; }
  return { x, y, rot: angle };
}

const norm360 = (a) => ((a || 0) % 360 + 360) % 360;

// Stamp a Bates number on every page (bottom-right by default). Numbers run
// `start`, `start+1`, … zero-padded to `digits`, with an optional `prefix`
// (e.g. "ABC" → "ABC000123"). Placement is corrected for each page's /Rotate so
// the label lands in the requested visual corner even on rotated pages.
//   position: one of "br","bl","tr","tl" (bottom/top × right/left).
export async function stampBates({
  srcBytes, prefix = "", start = 1, digits = 6,
  position = "br", margin = 24, fontSize = 10,
}) {
  const doc = await PDFDocument.load(srcBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  let n = Math.max(0, Math.floor(start));
  for (const page of pages) {
    const label = `${prefix}${String(n).padStart(digits, "0")}`;
    n++;
    const { width: W, height: H } = page.getSize();
    const angle = norm360(page.getRotation().angle);
    const tw = font.widthOfTextAtSize(label, fontSize);
    const { x, y, rot } = placeInBox({
      angle, W, H, tw, fontSize, margin,
      halign: position.endsWith("r") ? "r" : "l",
      valign: position.startsWith("b") ? "bottom" : "top",
    });
    page.drawText(label, { x, y, size: fontSize, font, color: rgb(0, 0, 0), rotate: degrees(rot) });
  }
  return doc.save();
}

// Stamp custom header/footer text. `slots` maps any of six positions to text:
//   hl hc hr — header left / center / right   (top of page)
//   fl fc fr — footer left / center / right   (bottom of page)
// Each string may contain the tokens {n} (page number) and {N} (page count).
// Placement is /Rotate-aware, matching Bates.
export async function stampHeaderFooter({ srcBytes, slots = {}, fontSize = 9, margin = 24 }) {
  const doc = await PDFDocument.load(srcBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;
  const layout = [
    ["hl", "l", "top"], ["hc", "c", "top"], ["hr", "r", "top"],
    ["fl", "l", "bottom"], ["fc", "c", "bottom"], ["fr", "r", "bottom"],
  ];
  pages.forEach((page, i) => {
    const n = i + 1;
    const { width: W, height: H } = page.getSize();
    const angle = norm360(page.getRotation().angle);
    for (const [key, halign, valign] of layout) {
      const raw = slots[key];
      if (!raw) continue;
      const text = String(raw).replace(/\{n\}/g, n).replace(/\{N\}/g, total);
      if (!text) continue;
      const tw = font.widthOfTextAtSize(text, fontSize);
      const { x, y, rot } = placeInBox({ angle, W, H, tw, fontSize, margin, halign, valign });
      page.drawText(text, { x, y, size: fontSize, font, color: rgb(0, 0, 0), rotate: degrees(rot) });
    }
  });
  return doc.save();
}

// Stamp a translucent watermark across every page — big text centered on the
// page, diagonal by default. Meant for "CONFIDENTIAL", "DRAFT", etc.
export async function stampWatermark({
  srcBytes, text, fontSize = 60, opacity = 0.15,
  color = [0.5, 0.5, 0.5], diagonal = true,
}) {
  if (!text) throw new Error("Watermark text is required.");
  const doc = await PDFDocument.load(srcBytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const [r, g, b] = color;
  for (const page of doc.getPages()) {
    const { width: W, height: H } = page.getSize();
    const tw = font.widthOfTextAtSize(text, fontSize);
    // Diagonal along the page's own diagonal (bottom-left → top-right).
    const angleDeg = diagonal ? Math.atan2(H, W) * 180 / Math.PI : 0;
    const rad = angleDeg * Math.PI / 180;
    // Anchor so the baseline's midpoint sits at the page center.
    const x = W / 2 - (tw / 2) * Math.cos(rad) - (fontSize / 3) * Math.sin(rad);
    const y = H / 2 - (tw / 2) * Math.sin(rad) + (fontSize / 3) * Math.cos(rad);
    page.drawText(text, {
      x, y, size: fontSize, font,
      color: rgb(r, g, b), opacity, rotate: degrees(angleDeg),
    });
  }
  return doc.save();
}

// Page count of a PDF (used to report merge results).
export async function pageCount(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}
