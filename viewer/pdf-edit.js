// pdf-edit.js
//
// PDF *writing* — the read/write layer on top of PDF.js's read-only rendering.
// Uses the vendored pdf-lib (pure JS, CSP-safe) to produce a new PDF with
// in-viewer edits applied. Callers pass plain data (the annotation set, page
// plans, stamps, extra PDFs to merge) and get back bytes ready to write.
//
// Comments and markup are written as real PDF annotations (annot-pdf.js), NOT
// drawings baked into the page content. That matters because annotations stay
// *separable*: this viewer reloads them as editable ones when the file is
// reopened, and Acrobat / Preview / any annotation-aware viewer can edit or
// delete them too. Flatten (below) is the deliberate step that makes them
// permanent.

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
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  PDFRef,
  PDFStream,
  PDFHexString,
  PageSizes,
} from "./vendor/pdf-lib/pdf-lib.esm.min.js";
import { readAnnotations, writeAnnotations, flattenAnnotations } from "./annot-pdf.js";
import { applyTextEdits } from "./pdf-text-edit.js";

// Build an edited copy of a PDF.
//   srcBytes:    Uint8Array/ArrayBuffer of the original PDF.
//   annotations: { annots, removeRefs } from annotations.saveData() — the
//                comment/markup set to write (annot-pdf.js writes each as a
//                real annotation with its own appearance), and the ids of the
//                file's own annotations that were deleted or changed.
//   appendBytes: Array<Uint8Array> of further PDFs to merge in (Combine).
//   insertAt:    0-based page index the merged pages go in at (default: end).
// Returns a Uint8Array of the saved PDF.
export async function buildEditedPdf({ srcBytes, annotations = null, appendBytes = [], insertAt = null, report = null }) {
  const doc = await PDFDocument.load(srcBytes);
  if (annotations) {
    // Paragraphs edited in place are not annotations: their old glyphs come
    // out of the page and the new text goes in (pdf-text-edit.js).
    const all = annotations.annots || [];
    const edits = all.filter((a) => a.type === "textedit");
    if (edits.length) {
      const res = await applyTextEdits(doc, edits);
      if (report) report.covered = res.covered;
    }
    await writeAnnotations(doc, all.filter((a) => a.type !== "textedit"), { removeRefs: annotations.removeRefs || new Set() });
  }
  let at = insertAt == null ? doc.getPageCount() : Math.max(0, Math.min(doc.getPageCount(), insertAt));
  for (const bytes of appendBytes) {
    if (!bytes) continue;
    const other = await PDFDocument.load(bytes);
    const copied = await doc.copyPages(other, other.getPageIndices());
    for (const p of copied) doc.insertPage(at++, p);
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

function norm360(a) { return ((a || 0) % 360 + 360) % 360; }

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
// `fromPage` is the first page stamped (1-based) and `startAt` the number it
// gets, so a brief can number its body from 1 after an unnumbered cover.
// Placement is /Rotate-aware, matching Bates.
export async function stampHeaderFooter({ srcBytes, slots = {}, fontSize = 9, margin = 24, startAt = 1, fromPage = 1 }) {
  const doc = await PDFDocument.load(srcBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const first = Math.max(1, Math.floor(fromPage));
  const total = startAt + (pages.length - first);
  const layout = [
    ["hl", "l", "top"], ["hc", "c", "top"], ["hr", "r", "top"],
    ["fl", "l", "bottom"], ["fc", "c", "bottom"], ["fr", "r", "bottom"],
  ];
  pages.forEach((page, i) => {
    if (i + 1 < first) return;
    const n = startAt + (i + 1 - first);
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

// Split a PDF into several documents. `groups` is an array of page-index lists
// (0-based); each list becomes one output PDF, in order. copyPages carries each
// page's annotations (highlights) into its part. Returns an array of
// { indices, bytes } — indices is the (validated) page list actually used.
export async function splitPdf({ srcBytes, groups }) {
  const src = await PDFDocument.load(srcBytes);
  const total = src.getPageCount();
  const parts = [];
  for (const g of groups || []) {
    const indices = (g || []).filter((i) => Number.isInteger(i) && i >= 0 && i < total);
    if (!indices.length) continue;
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, indices);
    for (const p of copied) out.addPage(p);
    parts.push({ indices, bytes: await out.save() });
  }
  return parts;
}

// Append image files as new pages. `images` is an array of { bytes, format }
// where format is "jpg" or "png" (the caller normalizes other types to PNG via
// a canvas, since pdf-lib only embeds JPEG/PNG). Each image gets its own page,
// sized to the image but scaled down to fit within US Letter (612×792 pts) so a
// high-resolution photo doesn't produce an absurdly large page. Existing pages
// (and their annotations/highlights) are untouched.
export async function appendImagesAsPages({ srcBytes, images, position = "end" }) {
  const doc = await PDFDocument.load(srcBytes);
  let insertAt = position === "start" ? 0 : doc.getPageCount();
  for (const img of images || []) {
    if (!img || !img.bytes) continue;
    const embedded = img.format === "jpg"
      ? await doc.embedJpg(img.bytes)
      : await doc.embedPng(img.bytes);
    const wPx = embedded.width, hPx = embedded.height;
    const s = Math.min(1, 612 / wPx, 792 / hPx);
    const pw = Math.max(1, wPx * s), ph = Math.max(1, hPx * s);
    const page = doc.insertPage(insertAt, [pw, ph]);
    page.drawImage(embedded, { x: 0, y: 0, width: pw, height: ph });
    insertAt++;
  }
  return doc.save();
}

// Fill AcroForm fields and optionally flatten them. `values` maps a field's
// fully-qualified name to its new value:
//   text field      → string
//   checkbox        → boolean
//   radio group     → the chosen option's export value (string)
//   dropdown/list   → an option string (or array of strings for multi-select)
// Fields absent from `values` keep whatever they already had. When `flatten` is
// true the filled values are baked into the page content and the interactive
// fields are removed, so the result is no longer editable.
export async function fillForm({ srcBytes, values = {}, flatten = false }) {
  const doc = await PDFDocument.load(srcBytes);
  const form = doc.getForm();
  for (const field of form.getFields()) {
    const name = field.getName();
    if (!(name in values)) continue;
    const v = values[name];
    try {
      if (field instanceof PDFTextField) {
        field.setText(v == null ? "" : String(v));
      } else if (field instanceof PDFCheckBox) {
        if (v) field.check(); else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (v) {
          const opts = field.getOptions();
          let choice = String(v);
          // The value may be the option NAME (matches getOptions), or the raw
          // export/appearance-state value the UI read from the widget, which
          // for some forms is a positional index ("0","1"). Fall back to
          // treating it as an index into the options when it isn't a name.
          if (!opts.includes(choice)) {
            const idx = parseInt(choice, 10);
            if (Number.isInteger(idx) && idx >= 0 && idx < opts.length) choice = opts[idx];
          }
          field.select(choice);
        } else {
          field.clear();
        }
      } else if (field instanceof PDFDropdown) {
        if (v) field.select(String(v)); else field.clear();
      } else if (field instanceof PDFOptionList) {
        if (v && v.length) field.select(Array.isArray(v) ? v.map(String) : [String(v)]);
        else field.clear();
      }
    } catch {
      // A value the field rejects (e.g. an option not in its list) is skipped
      // rather than aborting the whole fill.
    }
  }
  if (flatten) form.flatten();
  return doc.save();
}

// Whether a PDF has any interactive AcroForm fields.
export async function hasFormFields(bytes) {
  try {
    const doc = await PDFDocument.load(bytes);
    return doc.getForm().getFields().length > 0;
  } catch {
    return false;
  }
}

// Everything the viewer wants to know about a document that pdf.js does not
// hand it directly, from ONE parse: whether it has form fields, the
// annotations the comment tools can edit, its attachments and its /Info.
// Returns null when pdf-lib cannot read the file (the viewer carries on with
// what pdf.js shows).
export async function inspectDocument(bytes) {
  let doc;
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false }); } catch { return null; }
  let hasForm = false;
  try { hasForm = doc.getForm().getFields().length > 0; } catch { hasForm = false; }
  let annotations = [];
  try { annotations = await readAnnotations(doc); } catch (e) { console.warn("[pdf-edit] annotations unreadable:", e); }
  let attachments = [];
  try { attachments = listAttachments(doc); } catch { attachments = []; }
  return { hasForm, annotations, attachments, info: readInfo(doc), pageCount: doc.getPageCount() };
}

function infoText(doc, key) {
  try {
    const v = doc.getInfoDict().get(PDFName.of(key));
    if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
  } catch { /* none */ }
  return "";
}
function readInfo(doc) {
  const d = (fn) => { try { const v = fn(); return v ? v.getTime() : null; } catch { return null; } };
  return {
    title: infoText(doc, "Title"),
    author: infoText(doc, "Author"),
    subject: infoText(doc, "Subject"),
    keywords: infoText(doc, "Keywords"),
    creator: infoText(doc, "Creator"),
    producer: infoText(doc, "Producer"),
    created: d(() => doc.getCreationDate()),
    modified: d(() => doc.getModificationDate()),
  };
}

// Write the document's Title / Author / Subject / Keywords. An empty value
// takes the entry out rather than leaving an empty one.
export async function setMetadata({ srcBytes, info }) {
  const doc = await PDFDocument.load(srcBytes, { updateMetadata: false });
  const dict = doc.getInfoDict();
  const put = (key, value) => {
    const v = String(value || "").trim();
    if (v) dict.set(PDFName.of(key), PDFHexString.fromText(v));
    else dict.delete(PDFName.of(key));
  };
  put("Title", info.title);
  put("Author", info.author);
  put("Subject", info.subject);
  put("Keywords", info.keywords);
  doc.setModificationDate(new Date());
  // Show the title, not the file name, in a reader's window bar.
  if (String(info.title || "").trim()) doc.setTitle(String(info.title).trim(), { showInWindowTitleBar: true });
  return doc.save();
}

// ── Attachments ──────────────────────────────────────────────────────────────
// Files embedded in the document: the catalog's /EmbeddedFiles name tree, and
// file-attachment annotations on the pages.

function walkNameTree(ctx, node, out) {
  if (!node) return;
  const names = node.lookupMaybe(PDFName.of("Names"), PDFArray);
  if (names) {
    for (let i = 0; i + 1 < names.size(); i += 2) {
      const k = names.lookup(i);
      const spec = names.lookup(i + 1);
      out.push({ key: k instanceof PDFString || k instanceof PDFHexString ? k.decodeText() : "", spec });
    }
  }
  const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
  if (kids) for (let i = 0; i < kids.size(); i++) walkNameTree(ctx, kids.lookup(i, PDFDict), out);
}
function fileSpecInfo(ctx, spec) {
  if (!(spec instanceof PDFDict)) return null;
  const nameObj = spec.lookup(PDFName.of("UF")) || spec.lookup(PDFName.of("F"));
  const name = nameObj && (nameObj instanceof PDFString || nameObj instanceof PDFHexString) ? nameObj.decodeText() : "attachment";
  const ef = spec.lookupMaybe(PDFName.of("EF"), PDFDict);
  const stream = ef && (ef.lookup(PDFName.of("UF")) || ef.lookup(PDFName.of("F")));
  let size = null;
  if (stream instanceof PDFStream) {
    const params = stream.dict.lookupMaybe(PDFName.of("Params"), PDFDict);
    const sz = params && params.get(PDFName.of("Size"));
    size = sz instanceof PDFNumber ? sz.asNumber() : null;
  }
  const descObj = spec.lookup(PDFName.of("Desc"));
  const desc = descObj && (descObj instanceof PDFString || descObj instanceof PDFHexString) ? descObj.decodeText() : "";
  return { name, size, desc, stream };
}
export function listAttachments(doc) {
  const out = [];
  const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const ef = names && names.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  const entries = [];
  if (ef) walkNameTree(doc.context, ef, entries);
  entries.forEach(({ spec }, i) => {
    const info = fileSpecInfo(doc.context, spec);
    if (info) out.push({ id: `ef${i}`, name: info.name, size: info.size, desc: info.desc });
  });
  doc.getPages().forEach((page, pi) => {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) return;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookupMaybe(i, PDFDict);
      if (!a || a.get(PDFName.of("Subtype")) !== PDFName.of("FileAttachment")) continue;
      const info = fileSpecInfo(doc.context, a.lookup(PDFName.of("FS")));
      if (info) out.push({ id: `fa${pi}_${i}`, name: info.name, size: info.size, desc: info.desc, page: pi + 1 });
    }
  });
  return out;
}
/** The bytes of one attachment (by the id listAttachments gave it). */
export async function readAttachment(bytes, id) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let spec = null;
  if (id.startsWith("ef")) {
    const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
    const ef = names && names.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
    const entries = [];
    if (ef) walkNameTree(doc.context, ef, entries);
    spec = entries[Number(id.slice(2))] && entries[Number(id.slice(2))].spec;
  } else {
    const [pi, i] = id.slice(2).split("_").map(Number);
    const annots = doc.getPages()[pi].node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    const a = annots && annots.lookupMaybe(i, PDFDict);
    spec = a && a.lookup(PDFName.of("FS"));
  }
  const info = fileSpecInfo(doc.context, spec);
  if (!info || !info.stream) return null;
  const { decodePDFRawStream } = await import("./vendor/pdf-lib/pdf-lib.esm.min.js");
  try { return { name: info.name, bytes: decodePDFRawStream(info.stream).decode() }; }
  catch { return { name: info.name, bytes: info.stream.getContents() }; }
}

// ── Pages ────────────────────────────────────────────────────────────────────

// Insert `count` blank pages at 0-based index `at`, each `size` = [w, h] in
// points (default: the size of the page they follow, or US Letter).
export async function insertBlankPages({ srcBytes, at, count = 1, size = null }) {
  const doc = await PDFDocument.load(srcBytes);
  const n = doc.getPageCount();
  let idx = Math.max(0, Math.min(n, at == null ? n : at));
  let dims = size;
  if (!dims) {
    const ref = doc.getPages()[Math.max(0, Math.min(n - 1, idx - 1))];
    if (ref) {
      const { width, height } = ref.getSize();
      const rot = norm360(ref.getRotation().angle);
      dims = rot % 180 ? [height, width] : [width, height];
    } else dims = PageSizes.Letter;
  }
  for (let i = 0; i < Math.max(1, count); i++) doc.insertPage(idx++, dims);
  return doc.save();
}

// Trim pages: `margins` = { top, right, bottom, left } in points, measured on
// the page as it is DISPLAYED (so "top" is the top the reader sees, whatever
// the page's /Rotate). `pages` is a Set of 1-based page numbers, or null for
// every page. The crop is a new /CropBox inside the page's current one; the
// content outside is hidden, not deleted.
export async function cropPages({ srcBytes, margins, pages = null, boxes = null }) {
  const doc = await PDFDocument.load(srcBytes);
  doc.getPages().forEach((page, i) => {
    if (pages && !pages.has(i + 1)) return;
    const cb = page.getCropBox();
    let x = cb.x, y = cb.y, w = cb.width, h = cb.height;
    if (boxes && boxes.get(i + 1)) {
      const b = boxes.get(i + 1); // already in user space
      x = b.x; y = b.y; w = b.width; h = b.height;
    } else {
      const rot = norm360(page.getRotation().angle);
      // Map the displayed edges onto the page's own ones.
      const m = { ...margins };
      // A page turned a quarter clockwise shows its own left edge at the top.
      const byEdge = rot === 90 ? { left: m.top, bottom: m.left, top: m.right, right: m.bottom }
        : rot === 180 ? { left: m.right, top: m.bottom, right: m.left, bottom: m.top }
        : rot === 270 ? { left: m.bottom, top: m.left, right: m.top, bottom: m.right }
        : m;
      x += byEdge.left || 0;
      y += byEdge.bottom || 0;
      w -= (byEdge.left || 0) + (byEdge.right || 0);
      h -= (byEdge.top || 0) + (byEdge.bottom || 0);
    }
    if (w < 18 || h < 18) return; // nothing sensible left: leave the page alone
    page.setCropBox(x, y, w, h);
  });
  return doc.save();
}

// ── Resize pages ─────────────────────────────────────────────────────────────
//
// A filing portal refuses a page over its size ("exceeds the maximum size of
// 18 inches X 18 inches on page number 1"). Cropping cuts the page down;
// resizing SCALES it: the page becomes the paper size asked for and what it
// shows is scaled to fit inside it, centred, as a printer's "fit to page"
// does — but in the file, so the text stays text (searchable, selectable)
// rather than a picture of it. One affine map moves everything that stands on
// the page: the content (one scale and one shift wrapped round its streams),
// every annotation's coordinates (its Rect, quads, vertices, ink, lines) and
// every bookmark or link destination that points at a place on the page.

/** The part of a page that shows: its crop box, inside its media box. */
function visibleBox(page) {
  const m = page.getMediaBox(), c = page.getCropBox();
  const x0 = Math.max(m.x, c.x), y0 = Math.max(m.y, c.y);
  const x1 = Math.min(m.x + m.width, c.x + c.width), y1 = Math.min(m.y + m.height, c.y + c.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : { x: m.x, y: m.y, width: m.width, height: m.height };
}

/**
 * How a page of `box` (points, the page's own unrotated space) goes onto
 * paper of `width` × `height`: { s, tx, ty, w, h } — a point (x, y) of the
 * page lands at (s·x + tx, s·y + ty) on a new page of w × h — or null where
 * nothing is to be done. The paper is turned to the page's own way (a page
 * wider than it is tall gets it landscape), so a turned page is fitted, not
 * shrunk to a sliver. `onlyLarger`: a page that already fits is left alone,
 * and one that does not is only ever made smaller.
 */
export function resizePlan(box, width, height, { onlyLarger = true } = {}) {
  if (!box || !(box.width > 0) || !(box.height > 0) || !(width > 0) || !(height > 0)) return null;
  const wide = box.width > box.height;
  const w = wide ? Math.max(width, height) : Math.min(width, height);
  const h = wide ? Math.min(width, height) : Math.max(width, height);
  const fits = box.width <= w + 0.5 && box.height <= h + 0.5;
  if (onlyLarger && fits) return null;
  const s = Math.min(w / box.width, h / box.height);
  if (!onlyLarger && Math.abs(s - 1) < 1e-3 && Math.abs(box.width - w) < 0.5 && Math.abs(box.height - h) < 0.5 && !box.x && !box.y) return null;
  const tx = (w - s * box.width) / 2 - s * box.x;
  const ty = (h - s * box.height) / 2 - s * box.y;
  return { s, tx, ty, w, h };
}

/** Each page's visible size in points, in its own space, and its turn, as the dialog counts them: [{ width, height, rotate }]. */
export async function pageBoxes(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map((p) => { const b = visibleBox(p); return { width: b.width, height: b.height, rotate: norm360(p.getRotation().angle) }; });
}

/**
 * Pages over `width` × `height` points (or all of `pages`, with `onlyLarger`
 * off) scaled onto paper of that size. `report.resized` is given the 1-based
 * numbers of the pages it changed.
 */
export async function resizePages({ srcBytes, width = 612, height = 792, pages = null, onlyLarger = true, report = null }) {
  const doc = await PDFDocument.load(srcBytes);
  const ctx = doc.context;
  const moved = new Map(); // a page's ref → its plan, for the destinations
  const done = [];
  const num = (v) => (v instanceof PDFNumber ? v.asNumber() : null);
  // An array of x, y pairs, mapped where it is: Rect, QuadPoints, Vertices, L, CL, an ink path.
  const mapPairs = (arr, p) => {
    if (!(arr instanceof PDFArray)) return;
    for (let k = 0; k + 1 < arr.size(); k += 2) {
      const x = num(arr.get(k)), y = num(arr.get(k + 1));
      if (x == null || y == null) continue;
      arr.set(k, PDFNumber.of(p.s * x + p.tx));
      arr.set(k + 1, PDFNumber.of(p.s * y + p.ty));
    }
  };
  doc.getPages().forEach((page, i) => {
    if (pages && !pages.has(i + 1)) return;
    const p = resizePlan(visibleBox(page), width, height, { onlyLarger });
    if (!p) return;
    // Two wraps, the scale outside the shift: s · (x + tx/s) = s·x + tx.
    page.translateContent(p.tx / p.s, p.ty / p.s);
    page.scaleContent(p.s, p.s);
    page.setMediaBox(0, 0, p.w, p.h);
    page.setCropBox(0, 0, p.w, p.h);
    for (const k of ["TrimBox", "BleedBox", "ArtBox"]) page.node.delete(PDFName.of(k));
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (annots) {
      for (let k = 0; k < annots.size(); k++) {
        const a = annots.lookup(k);
        if (!(a instanceof PDFDict)) continue;
        for (const key of ["Rect", "QuadPoints", "Vertices", "L", "CL"]) mapPairs(a.lookup(PDFName.of(key)), p);
        const ink = a.lookup(PDFName.of("InkList"));
        if (ink instanceof PDFArray) for (let j = 0; j < ink.size(); j++) mapPairs(ink.lookup(j), p);
        // RD is a set of margins inside the Rect: scaled, not moved.
        const rd = a.lookup(PDFName.of("RD"));
        if (rd instanceof PDFArray) for (let j = 0; j < rd.size(); j++) { const v = num(rd.get(j)); if (v != null) rd.set(j, PDFNumber.of(v * p.s)); }
      }
    }
    moved.set(page.ref.toString(), p);
    done.push(i + 1);
  });
  if (moved.size) moveDestinations(doc, moved);
  if (report) report.resized = done;
  if (!done.length) return null;
  return doc.save();
}

/**
 * Every destination that names a place on a resized page, moved with it:
 * bookmarks, link annotations, GoTo actions, and the catalog's named
 * destinations (its /Dests dictionary and /Names /Dests tree). A destination
 * is [page /XYZ left top zoom], [page /FitH top], [page /FitV left],
 * [page /FitR left bottom right top] and the /FitB… forms; a null coordinate
 * means "keep the current one" and stays null.
 */
function moveDestinations(doc, moved) {
  const seen = new Set();
  const look = (v) => (v instanceof PDFRef ? doc.context.lookup(v) : v);
  const fixArray = (arr) => {
    if (!(arr instanceof PDFArray) || seen.has(arr) || arr.size() < 2) return;
    seen.add(arr);
    const target = arr.get(0);
    const p = target instanceof PDFRef ? moved.get(target.toString()) : null;
    if (!p) return;
    const kind = arr.get(1) instanceof PDFName ? arr.get(1).asString().replace(/^\//, "") : "";
    const at = (k, axis) => {
      const v = arr.get(k);
      if (v instanceof PDFNumber) arr.set(k, PDFNumber.of(p.s * v.asNumber() + (axis === "x" ? p.tx : p.ty)));
    };
    if (kind === "XYZ") { at(2, "x"); at(3, "y"); }
    else if (kind === "FitH" || kind === "FitBH") at(2, "y");
    else if (kind === "FitV" || kind === "FitBV") at(2, "x");
    else if (kind === "FitR") { at(2, "x"); at(3, "y"); at(4, "x"); at(5, "y"); }
  };
  // A destination as an array, or a dictionary carrying it under /D.
  const fixDest = (d) => {
    d = look(d);
    if (d instanceof PDFDict) d = look(d.get(PDFName.of("D")));
    fixArray(d);
  };
  const fixHolder = (dict) => {
    if (!(dict instanceof PDFDict)) return;
    fixDest(dict.get(PDFName.of("Dest")));
    const act = look(dict.get(PDFName.of("A")));
    if (act instanceof PDFDict) fixDest(act.get(PDFName.of("D")));
  };
  // Link annotations and their actions, on every page.
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (annots) for (let k = 0; k < annots.size(); k++) fixHolder(annots.lookup(k));
  }
  const cat = doc.catalog;
  // Bookmarks, walked by their siblings and children (a visited set guards a cycle).
  const walked = new Set();
  const walk = (ref) => {
    for (let n = ref; n && !walked.has(String(n));) {
      walked.add(String(n));
      const item = look(n);
      if (!(item instanceof PDFDict)) break;
      fixHolder(item);
      const first = item.get(PDFName.of("First"));
      if (first) walk(first);
      n = item.get(PDFName.of("Next"));
    }
  };
  const outlines = look(cat.get(PDFName.of("Outlines")));
  if (outlines instanceof PDFDict && outlines.get(PDFName.of("First"))) walk(outlines.get(PDFName.of("First")));
  // Named destinations: the old /Dests dictionary, and the /Names tree.
  const dests = look(cat.get(PDFName.of("Dests")));
  if (dests instanceof PDFDict) for (const [, v] of dests.entries()) fixDest(v);
  const names = look(cat.get(PDFName.of("Names")));
  const tree = names instanceof PDFDict ? look(names.get(PDFName.of("Dests"))) : null;
  const nodes = new Set();
  const walkTree = (node) => {
    node = look(node);
    if (!(node instanceof PDFDict) || nodes.has(node)) return;
    nodes.add(node);
    const list = look(node.get(PDFName.of("Names")));
    if (list instanceof PDFArray) for (let k = 1; k < list.size(); k += 2) fixDest(list.get(k));
    const kids = look(node.get(PDFName.of("Kids")));
    if (kids instanceof PDFArray) for (let k = 0; k < kids.size(); k++) walkTree(kids.get(k));
  };
  walkTree(tree);
}

// ── Flatten, sanitize ────────────────────────────────────────────────────────

// Make comments, drawings, stamps, signatures (and, with `forms`, form
// entries) a permanent part of the page. Links stay links.
export async function flattenPdf({ srcBytes, annotations = true, forms = true }) {
  const doc = await PDFDocument.load(srcBytes);
  if (forms) { try { doc.getForm().flatten(); } catch { /* no usable form */ } }
  if (annotations) flattenAnnotations(doc);
  return doc.save();
}

// Remove hidden information. Each option removes one kind:
//   metadata    — /Info and the XMP packet
//   attachments — embedded files and file-attachment annotations
//   scripts     — document JavaScript, open actions, additional actions
//   comments    — every annotation except links and form fields
//   forms       — flatten the form (entries become page content)
//   bookmarks   — the outline
//   links       — link annotations
//   hiddenText  — text drawn invisibly (render mode 3), e.g. an OCR layer
// Returns { bytes, removed: [labels] }.
export async function sanitizePdf({ srcBytes, options = {} }) {
  const doc = await PDFDocument.load(srcBytes, { updateMetadata: false });
  const ctx = doc.context;
  const removed = [];
  const cat = doc.catalog;
  const N = (s) => PDFName.of(s);

  if (options.metadata) {
    const had = !!(ctx.trailerInfo.Info || cat.get(N("Metadata")));
    stripMetadata(doc);
    // A page or image can carry its own XMP packet and piece info.
    for (const page of doc.getPages()) {
      page.node.delete(N("Metadata"));
      page.node.delete(N("PieceInfo"));
    }
    cat.delete(N("PieceInfo"));
    if (had) removed.push("metadata");
  }
  if (options.scripts) {
    let n = 0;
    const names = cat.lookupMaybe(N("Names"), PDFDict);
    if (names && names.get(N("JavaScript"))) { names.delete(N("JavaScript")); n++; }
    if (cat.get(N("OpenAction"))) { cat.delete(N("OpenAction")); n++; }
    if (cat.get(N("AA"))) { cat.delete(N("AA")); n++; }
    for (const page of doc.getPages()) {
      if (page.node.get(N("AA"))) { page.node.delete(N("AA")); n++; }
      const annots = page.node.lookupMaybe(N("Annots"), PDFArray);
      if (!annots) continue;
      for (let i = 0; i < annots.size(); i++) {
        const a = annots.lookupMaybe(i, PDFDict);
        if (!a) continue;
        if (a.get(N("AA"))) { a.delete(N("AA")); n++; }
        const act = a.lookupMaybe(N("A"), PDFDict);
        const s = act && act.get(N("S"));
        if (s && (s === N("JavaScript") || s === N("Launch") || s === N("SubmitForm") || s === N("ImportData"))) { a.delete(N("A")); n++; }
      }
    }
    try {
      const acro = cat.lookupMaybe(N("AcroForm"), PDFDict);
      for (const f of acro ? doc.getForm().getFields() : []) {
        for (const w of f.acroField.getWidgets()) { if (w.dict.get(N("AA"))) { w.dict.delete(N("AA")); n++; } }
        if (f.acroField.dict.get(N("AA"))) { f.acroField.dict.delete(N("AA")); n++; }
      }
    } catch { /* no form */ }
    if (n) removed.push("scripts and actions");
  }
  if (options.attachments) {
    let n = 0;
    const names = cat.lookupMaybe(N("Names"), PDFDict);
    if (names && names.get(N("EmbeddedFiles"))) { names.delete(N("EmbeddedFiles")); n++; }
    if (cat.get(N("AF"))) { cat.delete(N("AF")); n++; }
    for (const page of doc.getPages()) {
      const annots = page.node.lookupMaybe(N("Annots"), PDFArray);
      if (!annots) continue;
      for (let i = annots.size() - 1; i >= 0; i--) {
        const a = annots.lookupMaybe(i, PDFDict);
        if (a && a.get(N("Subtype")) === N("FileAttachment")) { annots.remove(i); n++; }
      }
    }
    if (n) removed.push("attachments");
  }
  if (options.forms) {
    try {
      const form = doc.getForm();
      if (form.getFields().length) { form.flatten(); removed.push("form fields (flattened)"); }
    } catch { /* no usable form */ }
  }
  if (options.comments) {
    let n = 0;
    for (const page of doc.getPages()) {
      const annots = page.node.lookupMaybe(N("Annots"), PDFArray);
      if (!annots) continue;
      for (let i = annots.size() - 1; i >= 0; i--) {
        const a = annots.lookupMaybe(i, PDFDict);
        const st = a && a.get(N("Subtype"));
        if (!a || st === N("Link") || st === N("Widget")) continue;
        annots.remove(i);
        n++;
      }
      if (annots.size() === 0) page.node.delete(N("Annots"));
    }
    if (n) removed.push(`${n} comment${n === 1 ? "" : "s"}`);
  }
  if (options.links) {
    let n = 0;
    for (const page of doc.getPages()) {
      const annots = page.node.lookupMaybe(N("Annots"), PDFArray);
      if (!annots) continue;
      for (let i = annots.size() - 1; i >= 0; i--) {
        const a = annots.lookupMaybe(i, PDFDict);
        if (a && a.get(N("Subtype")) === N("Link")) { annots.remove(i); n++; }
      }
    }
    if (n) removed.push(`${n} link${n === 1 ? "" : "s"}`);
  }
  if (options.bookmarks && cat.get(N("Outlines"))) {
    cat.delete(N("Outlines"));
    removed.push("bookmarks");
  }
  // Thumbnails embedded per page are old renders of the page, and can show
  // what the page used to say.
  for (const page of doc.getPages()) if (page.node.get(N("Thumb"))) page.node.delete(N("Thumb"));
  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, removed };
}

// Build a REDACTED copy: a new document made of page images, carrying nothing
// else at all.
//
// This is deliberately not "the original with black rectangles added". A
// rectangle drawn over text leaves the text in the file, and a redaction that
// can be selected, copied or extracted is not a redaction. So the caller hands
// us each page already rendered to an image with its black boxes painted into
// the pixels, and we assemble those images into a document that has never held
// anything else: no text, no fonts, no annotations, no form fields, no
// outlines, no attachments — and no metadata, because a document's /Info and
// its XMP packet carry the author, the software, the times and often the
// original filename, none of which belongs in a copy made to hide things.
//
//   pages: [{ bytes, format: "jpg"|"png", widthPts, heightPts }] in page order,
//          each image covering its whole page.
//
// `updateMetadata: false` is what stops pdf-lib stamping its own Producer and
// CreationDate onto the way out; stripMetadata takes care of anything that got
// in anyway, so the guarantee does not rest on that flag alone.
export async function buildRedactedPdf({ pages = [] }) {
  if (!pages.length) throw new Error("A redacted copy needs at least one page.");
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const p of pages) {
    if (!p || !p.bytes) continue;
    const img = p.format === "png" ? await doc.embedPng(p.bytes) : await doc.embedJpg(p.bytes);
    const w = Math.max(1, p.widthPts), h = Math.max(1, p.heightPts);
    const page = doc.addPage([w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
    pruneEmptyPageEntries(page);
  }
  stripMetadata(doc);
  return doc.save();
}

// A new page is built with an empty /Annots array and empty /Font and
// /ExtGState resource dictionaries, ready for things this document will never
// have. Left in, they are what someone auditing the file would find where they
// were looking for exactly those words. They hold nothing, so they go.
function pruneEmptyPageEntries(page) {
  const node = page.node;
  const annots = node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (annots && annots.size() === 0) node.delete(PDFName.of("Annots"));
  const res = node.lookupMaybe(PDFName.of("Resources"), PDFDict);
  if (!res) return;
  for (const key of ["Font", "ExtGState", "Shading", "Pattern"]) {
    const sub = res.lookupMaybe(PDFName.of(key), PDFDict);
    if (sub && sub.keys().length === 0) res.delete(PDFName.of(key));
  }
}

// Take every trace of provenance out of a document: the /Info dictionary (Title,
// Author, Subject, Keywords, Creator, Producer, the two dates) and the catalog's
// XMP /Metadata stream, which carries the same things again in a form some
// readers prefer. Both objects are deleted outright rather than blanked, so
// there is no empty shell left saying what used to be filled in.
export function stripMetadata(doc) {
  const ctx = doc.context;
  const info = ctx.trailerInfo && ctx.trailerInfo.Info;
  if (info) {
    try { ctx.delete(info); } catch { /* already gone */ }
    delete ctx.trailerInfo.Info;
  }
  try {
    const md = doc.catalog.get(PDFName.of("Metadata"));
    if (md) {
      try { ctx.delete(md); } catch { /* already gone */ }
      doc.catalog.delete(PDFName.of("Metadata"));
    }
  } catch { /* no catalog entry to take out */ }
}

// Page count of a PDF (used to report merge results).
export async function pageCount(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}
