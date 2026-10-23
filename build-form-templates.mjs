// Builds viewer/form-templates/ from PDF-Linker's blank court forms, so the text
// reader knows each form's own type — its sizes, faces and line spacing — beside
// a SCAN of it (viewer/form-templates.js says how that is used).
//
// Run: node build-form-templates.mjs ["<PDF-Linker>/Form Templates"]
//      (from the repo root; the folder defaults to ../PDF-Linker/Form Templates,
//      the two checkouts side by side). Run it again whenever a blank is added
//      to, revised in or removed from PDF-Linker's folder, and commit what it
//      writes: one JSON per blank and index.json (form key → files, and each
//      blank's checksum). test-form-templates.mjs fails while the folder beside
//      this checkout holds a blank the data does not, or a different copy of one.
//
// Read with the pdf.js this repo pins (pdfjs/build), so a blank's items are
// exactly the items the reader would get from a born-digital copy of the form:
// what lineItems finds a line's pieces by. Per page that names its form id
// (footer, else header; a page naming none is a template of nothing, as in
// PDF-Linker's `_template_index_page`):
//   form, keys (every form key the page states), rev (its revision, folded),
//   w, h (the page in points),
//   items: [str, x, top, w, h, face, inField] — top-down, as the reader's items;
//     face an index into the file's `faces` ([font name, family]); inField 1 for
//     an item standing in a widget (a value's place, never a label to fit on),
//   fields: [x0, top, x1, bottom, size, face] — each text field, with the size
//     and face its /DA sets a value in (size 0: the viewer's own choice),
//   boxes: [x0, top, x1, bottom] — each checkbox and radio button.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "./pdfjs/build/pdf.mjs";
import { formKey, footerFormId, pageFormKeys, revisionOf, idBands, itemWords, MIN_MATCHED, FORM_ID_RE } from "./viewer/form-templates.js";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(process.argv[2] || path.join(REPO, "..", "PDF-Linker", "Form Templates"));
const OUT = path.join(REPO, "viewer", "form-templates");

const r2 = (v) => Math.round(v * 100) / 100;
/** A blank's bytes, summed: index.json keeps one per blank, so a revised blank shows. */
export const blankSum = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);

export async function indexBlank(bytes, source) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  const faces = [], faceIdx = new Map();
  const face = (name, generic) => {
    const k = `${name}|${generic}`;
    if (!faceIdx.has(k)) { faceIdx.set(k, faces.length); faces.push([name, generic]); }
    return faceIdx.get(k);
  };
  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const H = page.view[3] - page.view[1], W = page.view[2] - page.view[0];
      const tc = await page.getTextContent();
      await page.getOperatorList();
      const fontFace = new Map();
      for (const id of Object.keys(tc.styles || {})) {
        let name = "";
        try { const fo = page.commonObjs.get(id); name = String((fo && fo.name) || "").replace(/^[A-Z]{6}\+/, ""); } catch { /* the family alone */ }
        fontFace.set(id, face(name, tc.styles[id].fontFamily || "sans-serif"));
      }
      const annots = await page.getAnnotations();
      const widgets = annots.filter((a) => a.subtype === "Widget");
      const toTop = (r) => [r[0], H - r[3], r[2], H - r[1]];
      const wRects = widgets.map((a) => toTop(a.rect));
      const items = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim() || !it.transform) continue;
        const h = it.height || 0, x = it.transform[4], top = H - (it.transform[5] + h), w = it.width || 0;
        const cx = x + w / 2, cy = top + h / 2;
        const inField = wRects.some((r) => cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3]);
        items.push([it.str, r2(x), r2(top), r2(w), r2(h), fontFace.has(it.fontName) ? fontFace.get(it.fontName) : null, inField ? 1 : 0]);
      }
      const reader = items.map(([str, x, top, w, h]) => ({ str, x, top, w, h }));
      const { footer, header } = idBands(reader, W, H);
      let form = footerFormId(footer);
      if (!form) for (const line of header) {
        const m = new RegExp(FORM_ID_RE.source, "i").exec(line);
        if (m && m.index === 0 && m[1].length === line.length) { form = m[1]; break; }
      }
      if (!form) continue;
      const labels = itemWords(reader.map((it, i) => (items[i][6] ? { ...it, str: "" } : it)));
      if (labels.length < MIN_MATCHED) continue;
      const keys = pageFormKeys(footer, header);
      if (!keys.includes(formKey(form))) keys.push(formKey(form));
      const fields = widgets.filter((a) => a.fieldType === "Tx").map((a) => {
        const da = a.defaultAppearanceData || {};
        return [...toTop(a.rect).map(r2), r2(da.fontSize || 0), da.fontName ? face(String(da.fontName).replace(/^[A-Z]{6}\+/, ""), "sans-serif") : null];
      });
      const boxes = widgets.filter((a) => a.fieldType === "Btn" && (a.checkBox || a.radioButton)).map((a) => toTop(a.rect).map(r2));
      pages.push({ n, form, keys, rev: revisionOf(footer), w: r2(W), h: r2(H), items, fields, boxes });
      page.cleanup();
    }
  } finally { await doc.destroy(); }
  return { source, faces, pages };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(SRC)) { console.error(`No such folder: ${SRC}`); process.exit(1); }
  const blanks = fs.readdirSync(SRC).filter((f) => /\.pdf$/i.test(f)).sort();
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (/\.json$/i.test(f)) fs.unlinkSync(path.join(OUT, f));
  const keys = {}, sums = {};
  let pageCount = 0;
  for (const f of blanks) {
    const bytes = fs.readFileSync(path.join(SRC, f));
    sums[f] = blankSum(bytes);
    const data = await indexBlank(bytes, f);
    if (!data.pages.length) { console.log(`  (no template page) ${f}`); continue; }
    const name = f.replace(/\.pdf$/i, ".json");
    fs.writeFileSync(path.join(OUT, name), JSON.stringify(data));
    for (const p of data.pages) for (const k of p.keys) { keys[k] = keys[k] || []; if (!keys[k].includes(name)) keys[k].push(name); }
    pageCount += data.pages.length;
    console.log(`  ${data.pages.length} page(s)  ${f}`);
  }
  const sorted = Object.fromEntries(Object.keys(keys).sort().map((k) => [k, keys[k]]));
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ version: 1, blanks: sums, keys: sorted }, null, 1) + "\n");
  console.log(`${pageCount} template page(s) from ${blanks.length} blank(s) → ${path.relative(REPO, OUT)}`);
}
