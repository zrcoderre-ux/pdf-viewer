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

// Build an edited copy of a PDF.
//   srcBytes:    Uint8Array/ArrayBuffer of the original PDF.
//   annotations: { annots, removeRefs } from annotations.saveData() — the
//                comment/markup set to write (annot-pdf.js writes each as a
//                real annotation with its own appearance), and the ids of the
//                file's own annotations that were deleted or changed.
//   appendBytes: Array<Uint8Array> of further PDFs to merge in (Combine).
//   insertAt:    0-based page index the merged pages go in at (default: end).
// Returns a Uint8Array of the saved PDF.
export async function buildEditedPdf({ srcBytes, annotations = null, appendBytes = [], insertAt = null }) {
  const doc = await PDFDocument.load(srcBytes);
  if (annotations) {
    await writeAnnotations(doc, annotations.annots || [], { removeRefs: annotations.removeRefs || new Set() });
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
