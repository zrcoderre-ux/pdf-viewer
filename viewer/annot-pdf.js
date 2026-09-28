// annot-pdf.js
//
// Annotations as the PDF holds them: read out of a document into the plain
// model annotations.js edits, and written back as real annotation objects —
// /Highlight, /Underline, /StrikeOut, /Text (sticky notes), /FreeText, /Ink,
// /Square, /Circle, /Line, /Stamp and /Link — each with its own appearance
// stream, so Acrobat, Preview, Chrome and pdf.js all draw them the same way and
// any of them can still select, move or delete them. Nothing here touches the
// DOM; the Node tests drive it directly.
//
// The model (one object per annotation, coordinates in PDF user space — points,
// origin bottom-left, the page's own unrotated frame):
//
//   { id, page, type, rect:[x1,y1,x2,y2], color:[r,g,b]|null, opacity, width,
//     contents, author, modified, created,
//     quads:[[8 numbers]…], textRot, quote            (text markup)
//     text, fontSize, font:"sans"|"serif"|"mono", fill, rotate   (freetext…)
//     inkList:[[x,y,x,y…]…]                           (ink)
//     line:[x1,y1,x2,y2]                              (line, arrow)
//     label                                           (stamp)
//     symbol:"check"|"cross"|"dot"                    (symbol)
//     image:{ data:dataURL, format:"png"|"jpg" }      (image, signature)
//     url | destPage                                  (link)
//     origRef                                         (read from the file) }
//
// `type` is one of highlight underline strikeout note freetext typewriter ink
// square circle whiteout line arrow stamp symbol image link.
//
// The file keeps what cannot be re-read from the standard keys in a private
// /PDFV entry (a short JSON string) and, for pictures, the original image bytes
// in a /PDFV_Img stream, so a signature placed here comes back as the same
// signature. Readers ignore keys they do not know.

import {
  PDFName,
  PDFArray,
  PDFDict,
  PDFNumber,
  PDFString,
  PDFHexString,
  PDFRef,
  PDFStream,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from "./vendor/pdf-lib/pdf-lib.esm.min.js";

export const NM_PREFIX = "pdfv-";

const N = (s) => PDFName.of(s);
const fmt = (n) => {
  const v = Math.round(n * 1000) / 1000;
  return Object.is(v, -0) ? "0" : String(v);
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** pdf.js names an annotation by its object reference: "12R", or "12R3" past generation 0. */
export function refId(ref) {
  if (!ref) return null;
  return ref.generationNumber ? `${ref.objectNumber}R${ref.generationNumber}` : `${ref.objectNumber}R`;
}

// ── Reading ──────────────────────────────────────────────────────────────────

function num(obj) {
  if (obj instanceof PDFNumber) return obj.asNumber();
  return undefined;
}
function nums(arr) {
  if (!(arr instanceof PDFArray)) return null;
  const out = [];
  for (let i = 0; i < arr.size(); i++) {
    const v = arr.get(i);
    out.push(v instanceof PDFNumber ? v.asNumber() : 0);
  }
  return out;
}
function text(obj) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    try { return obj.decodeText(); } catch { return ""; }
  }
  return "";
}
function colorOf(arr) {
  const c = nums(arr);
  if (!c || !c.length) return null;
  if (c.length === 1) return [c[0], c[0], c[0]];
  if (c.length === 3) return c.map(clamp01);
  if (c.length === 4) {
    const [C, M, Y, K] = c;
    return [(1 - C) * (1 - K), (1 - M) * (1 - K), (1 - Y) * (1 - K)];
  }
  return null;
}
function normRect(r) {
  if (!r || r.length < 4) return null;
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}
/** "D:20240131120000Z" → ms since the epoch (local time where the string has no zone). */
export function parsePdfDate(s) {
  if (!s) return null;
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+\-])?(\d{2})?'?(\d{2})?'?/.exec(String(s).trim());
  if (!m) return null;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", se = "00", tz, th = "00", tm = "00"] = m;
  if (!tz) return new Date(+y, +mo - 1, +d, +h, +mi, +se).getTime();
  let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  if (tz === "+" || tz === "-") {
    const off = (+th * 60 + +tm) * 60000;
    t += tz === "+" ? -off : off;
  }
  return t;
}
function borderWidth(dict) {
  const bs = dict.lookupMaybe(N("BS"), PDFDict);
  if (bs) {
    const w = num(bs.get(N("W")));
    if (w !== undefined) return w;
  }
  const b = nums(dict.lookupMaybe(N("Border"), PDFArray));
  if (b && b.length >= 3) return b[2];
  return 1;
}
function parseDA(da) {
  const out = { fontSize: 12, color: [0, 0, 0], font: "sans" };
  if (!da) return out;
  const tf = /\/([^\s/]+)\s+([\d.]+)\s+Tf/.exec(da);
  if (tf) {
    const size = parseFloat(tf[2]);
    if (size > 0) out.fontSize = size;
    const name = tf[1].toLowerCase();
    if (/^(tiro|times|ti)/.test(name) || name.includes("times") || name.includes("serif")) out.font = "serif";
    else if (/^(cour|co)/.test(name) || name.includes("courier") || name.includes("mono")) out.font = "mono";
  }
  const rg = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
  if (rg) out.color = [parseFloat(rg[1]), parseFloat(rg[2]), parseFloat(rg[3])];
  else {
    const g = /([\d.]+)\s+g(?:\s|$)/.exec(da);
    if (g) out.color = [parseFloat(g[1]), parseFloat(g[1]), parseFloat(g[1])];
  }
  return out;
}
/** The text direction a set of quads was written for: the angle of its top edge, snapped to a quarter turn. */
function quadTextRot(q) {
  const ang = Math.atan2(q[3] - q[1], q[2] - q[0]) * 180 / Math.PI;
  return ((Math.round(ang / 90) * 90) % 360 + 360) % 360;
}

async function readImageStream(stream) {
  try {
    if (stream instanceof PDFRawStream) {
      const bytes = stream.getContents();
      return bytes;
    }
  } catch { /* fall through */ }
  return null;
}
function bytesToDataUrl(bytes, mime) {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return `data:${mime};base64,${b64}`;
}

/**
 * Every annotation on every page this module knows how to edit, as model
 * objects carrying `origRef`. Annotations it does not model (form widgets,
 * popups, sounds, 3D, a stamp drawn by another program…) are left out: pdf.js
 * keeps drawing those itself, and a save never touches them.
 */
export async function readAnnotations(doc) {
  const out = [];
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const arr = page.node.lookupMaybe(N("Annots"), PDFArray);
    if (!arr) continue;
    for (let k = 0; k < arr.size(); k++) {
      const raw = arr.get(k);
      if (!(raw instanceof PDFRef)) continue;
      let dict;
      try { dict = doc.context.lookupMaybe(raw, PDFDict); } catch { dict = null; }
      if (!dict) continue;
      let a = null;
      try { a = await parseAnnot(doc, dict, i + 1); } catch (e) { a = null; }
      if (a) { a.origRef = refId(raw); out.push(a); }
    }
  }
  return out;
}

async function parseAnnot(doc, dict, pageNumber) {
  const sub = dict.get(N("Subtype"));
  if (!(sub instanceof PDFName)) return null;
  const subtype = sub.decodeText ? sub.decodeText() : sub.asString().replace(/^\//, "");
  const flags = num(dict.get(N("F"))) || 0;
  if (flags & 2) return null; // hidden
  const rect = normRect(nums(dict.lookupMaybe(N("Rect"), PDFArray)));
  if (!rect) return null;
  let priv = null;
  const pv = dict.get(N("PDFV"));
  if (pv) { try { priv = JSON.parse(text(pv)); } catch { priv = null; } }
  const nm = text(dict.get(N("NM")));
  const base = {
    id: nm && nm.startsWith(NM_PREFIX) ? nm.slice(NM_PREFIX.length) : null,
    page: pageNumber,
    rect,
    color: colorOf(dict.lookupMaybe(N("C"), PDFArray)),
    opacity: num(dict.get(N("CA"))) ?? 1,
    width: borderWidth(dict),
    contents: text(dict.get(N("Contents"))),
    author: text(dict.get(N("T"))),
    modified: parsePdfDate(text(dict.get(N("M")))),
    created: parsePdfDate(text(dict.get(N("CreationDate")))),
  };
  if (priv && priv.q) base.quote = priv.q;

  switch (subtype) {
    case "Highlight":
    case "Underline":
    case "StrikeOut": {
      const q = nums(dict.lookupMaybe(N("QuadPoints"), PDFArray));
      if (!q || q.length < 8) return null;
      const quads = [];
      for (let i = 0; i + 7 < q.length; i += 8) quads.push(q.slice(i, i + 8));
      const type = subtype === "Highlight" ? "highlight" : subtype === "Underline" ? "underline" : "strikeout";
      return {
        ...base, type, quads,
        textRot: priv && priv.tr != null ? priv.tr : quadTextRot(quads[0]),
        color: base.color || [1, 0.83, 0],
      };
    }
    case "Text":
      return { ...base, type: "note", color: base.color || [1, 0.83, 0], icon: dict.get(N("Name")) instanceof PDFName ? dict.get(N("Name")).decodeText() : "Comment" };
    case "FreeText": {
      const da = parseDA(text(dict.get(N("DA"))));
      const it = dict.get(N("IT"));
      const typewriter = (priv && priv.t === "typewriter") || (it instanceof PDFName && it.decodeText() === "FreeTextTypeWriter");
      const fill = priv && "fl" in priv ? priv.fl : colorOf(dict.lookupMaybe(N("IC"), PDFArray));
      return {
        ...base,
        type: typewriter ? "typewriter" : "freetext",
        text: base.contents,
        contents: priv && priv.c != null ? priv.c : "",
        fontSize: da.fontSize,
        font: (priv && priv.f) || da.font,
        color: da.color,
        borderColor: base.color,
        fill: fill || null,
        width: typewriter ? 0 : base.width,
        rotate: (priv && priv.r) || 0,
      };
    }
    case "Ink": {
      const list = dict.lookupMaybe(N("InkList"), PDFArray);
      if (!list) return null;
      const inkList = [];
      for (let i = 0; i < list.size(); i++) {
        const path = nums(doc.context.lookup(list.get(i)));
        if (path && path.length >= 2) inkList.push(path);
      }
      if (!inkList.length) return null;
      return { ...base, type: "ink", inkList, color: base.color || [0, 0, 0] };
    }
    case "Square":
    case "Circle": {
      const fill = colorOf(dict.lookupMaybe(N("IC"), PDFArray));
      const isWhiteout = priv && priv.t === "whiteout";
      return {
        ...base,
        type: isWhiteout ? "whiteout" : subtype === "Square" ? "square" : "circle",
        fill: fill || null,
        width: isWhiteout ? 0 : base.width,
        color: isWhiteout ? null : base.color,
      };
    }
    case "Line": {
      const l = nums(dict.lookupMaybe(N("L"), PDFArray));
      if (!l || l.length < 4) return null;
      const le = dict.lookupMaybe(N("LE"), PDFArray);
      let arrow = false;
      if (le) {
        for (let i = 0; i < le.size(); i++) {
          const v = le.get(i);
          if (v instanceof PDFName && /Arrow/.test(v.decodeText())) arrow = true;
        }
      }
      return { ...base, type: arrow ? "arrow" : "line", line: l.slice(0, 4), color: base.color || [0, 0, 0] };
    }
    case "Stamp": {
      // Only stamps this viewer made: another program's stamp is artwork this
      // model cannot redraw, so pdf.js keeps drawing it and a save leaves it.
      if (!priv) return null;
      if (priv.t === "stamp") return { ...base, type: "stamp", label: priv.l || "STAMP", rotate: priv.r || 0 };
      if (priv.t === "symbol") return { ...base, type: "symbol", symbol: priv.s || "check", rotate: priv.r || 0 };
      if (priv.t === "image") {
        const s = dict.lookupMaybe(N("PDFV_Img"), PDFStream);
        const bytes = s ? await readImageStream(s) : null;
        if (!bytes) return null;
        const format = priv.fmt === "jpg" ? "jpg" : "png";
        return {
          ...base, type: "image", role: priv.role || "image", rotate: priv.r || 0,
          image: { data: bytesToDataUrl(bytes, format === "jpg" ? "image/jpeg" : "image/png"), format },
        };
      }
      return null;
    }
    case "Link": {
      // Links are the PDF's own navigation; the viewer's link layer already
      // makes them work. Only the ones made here are editable.
      if (!priv || priv.t !== "link") return null;
      return { ...base, type: "link", url: priv.u || "", destPage: priv.d || null };
    }
    default:
      return null;
  }
}

// ── Appearance streams ───────────────────────────────────────────────────────

const rgbOp = (c, op) => (c ? `${fmt(c[0])} ${fmt(c[1])} ${fmt(c[2])} ${op}` : "");

function ellipsePath(x1, y1, x2, y2) {
  const k = 0.5522847498;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = (x2 - x1) / 2, ry = (y2 - y1) / 2;
  return [
    `${fmt(cx + rx)} ${fmt(cy)} m`,
    `${fmt(cx + rx)} ${fmt(cy + ry * k)} ${fmt(cx + rx * k)} ${fmt(cy + ry)} ${fmt(cx)} ${fmt(cy + ry)} c`,
    `${fmt(cx - rx * k)} ${fmt(cy + ry)} ${fmt(cx - rx)} ${fmt(cy + ry * k)} ${fmt(cx - rx)} ${fmt(cy)} c`,
    `${fmt(cx - rx)} ${fmt(cy - ry * k)} ${fmt(cx - rx * k)} ${fmt(cy - ry)} ${fmt(cx)} ${fmt(cy - ry)} c`,
    `${fmt(cx + rx * k)} ${fmt(cy - ry)} ${fmt(cx + rx)} ${fmt(cy - ry * k)} ${fmt(cx + rx)} ${fmt(cy)} c`,
  ].join("\n");
}
function roundRectPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const k = 0.5522847498 * r;
  return [
    `${fmt(x + r)} ${fmt(y)} m`,
    `${fmt(x + w - r)} ${fmt(y)} l`,
    `${fmt(x + w - r + k)} ${fmt(y)} ${fmt(x + w)} ${fmt(y + r - k)} ${fmt(x + w)} ${fmt(y + r)} c`,
    `${fmt(x + w)} ${fmt(y + h - r)} l`,
    `${fmt(x + w)} ${fmt(y + h - r + k)} ${fmt(x + w - r + k)} ${fmt(y + h)} ${fmt(x + w - r)} ${fmt(y + h)} c`,
    `${fmt(x + r)} ${fmt(y + h)} l`,
    `${fmt(x + r - k)} ${fmt(y + h)} ${fmt(x)} ${fmt(y + h - r + k)} ${fmt(x)} ${fmt(y + h - r)} c`,
    `${fmt(x)} ${fmt(y + r)} l`,
    `${fmt(x)} ${fmt(y + r - k)} ${fmt(x + r - k)} ${fmt(y)} ${fmt(x + r)} ${fmt(y)} c`,
    "h",
  ].join("\n");
}

/** The two points of an arrowhead's barbs for a shaft ending at (x1,y1). */
export function arrowHead(x0, y0, x1, y1, w) {
  const len = Math.max(7, w * 4.5);
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const spread = Math.PI / 7;
  return [
    [x1 - len * Math.cos(ang - spread), y1 - len * Math.sin(ang - spread)],
    [x1 - len * Math.cos(ang + spread), y1 - len * Math.sin(ang + spread)],
  ];
}

/** Which edge of a quad's box is the text's bottom, given the rotation the text is read at. */
export function markupEdge(textRot) {
  // User space as seen upright: min y is the bottom. Text read at a quarter
  // turn clockwise has its bottom at max x, and so on round.
  switch (((textRot % 360) + 360) % 360) {
    case 90: return "right";
    case 180: return "top";
    case 270: return "left";
    default: return "bottom";
  }
}

/** QuadPoints for a user-space box, corners in the order the text is read at `textRot`. */
export function quadForRect([x1, y1, x2, y2], textRot = 0) {
  switch (((textRot % 360) + 360) % 360) {
    case 90: return [x1, y1, x1, y2, x2, y1, x2, y2];
    case 180: return [x2, y1, x1, y1, x2, y2, x1, y2];
    case 270: return [x2, y2, x2, y1, x1, y2, x1, y1];
    default: return [x1, y2, x2, y2, x1, y1, x2, y1];
  }
}
export function quadBox(q) {
  const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Content-rotation matrix for a box drawn upright at display rotation `r`. */
export function rotMatrix(r) {
  switch (((r % 360) + 360) % 360) {
    case 90: return [0, 1, -1, 0, 0, 0];
    case 180: return [-1, 0, 0, -1, 0, 0];
    case 270: return [0, -1, 1, 0, 0, 0];
    default: return [1, 0, 0, 1, 0, 0];
  }
}
/** The upright width and height of a user-space rect drawn at rotation `r`. */
export function uprightSize(rect, r) {
  const w = rect[2] - rect[0], h = rect[3] - rect[1];
  return ((r || 0) % 180) ? [h, w] : [w, h];
}

/** Word-wrap `text` to `maxW` points with `measure(str)` → width. Hard newlines are kept. */
export function wrapLines(text, maxW, measure) {
  const out = [];
  for (const para of String(text || "").split(/\r\n|\r|\n/)) {
    if (!para) { out.push(""); continue; }
    const words = para.split(/(\s+)/);
    let line = "";
    for (const w of words) {
      if (!w) continue;
      const next = line + w;
      if (!line || measure(next.trimEnd()) <= maxW) { line = next; continue; }
      if (/^\s+$/.test(w)) { out.push(line.trimEnd()); line = ""; continue; }
      out.push(line.trimEnd());
      // A single word wider than the box is broken by characters.
      if (measure(w) > maxW) {
        let piece = "";
        for (const ch of w) {
          if (piece && measure(piece + ch) > maxW) { out.push(piece); piece = ""; }
          piece += ch;
        }
        line = piece;
      } else line = w;
    }
    out.push(line.trimEnd());
  }
  return out;
}

export const FREETEXT_PAD = { freetext: 4, typewriter: 1 };
export const LINE_HEIGHT = 1.18;
// Helvetica's ascent, as a fraction of the size: where the first baseline sits
// below the top of the text box.
const ASCENT = 0.8;

const FONT_FOR = { sans: StandardFonts.Helvetica, serif: StandardFonts.TimesRoman, mono: StandardFonts.Courier };
const BOLD_FOR = { sans: StandardFonts.HelveticaBold, serif: StandardFonts.TimesRomanBold, mono: StandardFonts.CourierBold };

class FontCache {
  constructor(doc) { this.doc = doc; this.fonts = new Map(); this.ok = new Map(); }
  async get(name) {
    if (!this.fonts.has(name)) this.fonts.set(name, await this.doc.embedFont(name));
    return this.fonts.get(name);
  }
  /** The text with anything the standard font's encoding cannot carry replaced by "?". */
  safe(font, s) {
    let okSet = this.ok.get(font);
    if (!okSet) { okSet = new Map(); this.ok.set(font, okSet); }
    let out = "";
    for (const ch of String(s)) {
      let ok = okSet.get(ch);
      if (ok === undefined) {
        try { font.encodeText(ch); ok = true; } catch { ok = false; }
        okSet.set(ch, ok);
      }
      out += ok ? ch : (ch === "’" || ch === "‘" ? "'" : ch === "“" || ch === "”" ? '"' : "?");
    }
    return out;
  }
}

function textShow(font, s) {
  return `${font.encodeText(s).toString()} Tj`;
}

async function buildAppearance(doc, fonts, a) {
  const ctx = doc.context;
  const res = {};
  const gs = {};
  let body = "";
  let bbox = a.rect.slice();
  let matrix = null;
  const w = a.width ?? 1;
  const opacity = a.opacity ?? 1;
  if (opacity < 1 || a.type === "highlight") {
    gs.GS0 = { Type: "ExtGState", CA: opacity, ca: opacity, ...(a.type === "highlight" ? { BM: "Multiply" } : {}) };
    body += "/GS0 gs\n";
  }

  switch (a.type) {
    case "highlight": {
      body += `${rgbOp(a.color, "rg")}\n`;
      for (const q of a.quads) {
        body += `${fmt(q[0])} ${fmt(q[1])} m ${fmt(q[2])} ${fmt(q[3])} l ${fmt(q[6])} ${fmt(q[7])} l ${fmt(q[4])} ${fmt(q[5])} l h f\n`;
      }
      break;
    }
    case "underline":
    case "strikeout": {
      const edge = markupEdge(a.textRot || 0);
      body += `${rgbOp(a.color, "RG")}\n`;
      for (const q of a.quads) {
        const [x1, y1, x2, y2] = quadBox(q);
        const vertical = edge === "left" || edge === "right";
        const thick = Math.max(0.6, (vertical ? x2 - x1 : y2 - y1) * 0.07);
        body += `${fmt(thick)} w\n`;
        if (a.type === "strikeout") {
          if (vertical) { const x = (x1 + x2) / 2; body += `${fmt(x)} ${fmt(y1)} m ${fmt(x)} ${fmt(y2)} l S\n`; }
          else { const y = (y1 + y2) / 2; body += `${fmt(x1)} ${fmt(y)} m ${fmt(x2)} ${fmt(y)} l S\n`; }
        } else {
          const off = thick * 1.2;
          if (edge === "bottom") body += `${fmt(x1)} ${fmt(y1 + off)} m ${fmt(x2)} ${fmt(y1 + off)} l S\n`;
          else if (edge === "top") body += `${fmt(x1)} ${fmt(y2 - off)} m ${fmt(x2)} ${fmt(y2 - off)} l S\n`;
          else if (edge === "right") body += `${fmt(x2 - off)} ${fmt(y1)} m ${fmt(x2 - off)} ${fmt(y2)} l S\n`;
          else body += `${fmt(x1 + off)} ${fmt(y1)} m ${fmt(x1 + off)} ${fmt(y2)} l S\n`;
        }
      }
      break;
    }
    case "square":
    case "whiteout":
    case "circle": {
      const [x1, y1, x2, y2] = a.rect;
      const inset = a.color && w > 0 ? w / 2 : 0;
      const path = a.type === "circle"
        ? ellipsePath(x1 + inset, y1 + inset, x2 - inset, y2 - inset)
        : `${fmt(x1 + inset)} ${fmt(y1 + inset)} ${fmt(x2 - x1 - 2 * inset)} ${fmt(y2 - y1 - 2 * inset)} re`;
      const fill = a.fill;
      const stroke = a.color && w > 0;
      if (!fill && !stroke) break;
      body += `${fill ? rgbOp(fill, "rg") : ""}\n${stroke ? `${rgbOp(a.color, "RG")} ${fmt(w)} w` : ""}\n${path}\n${fill && stroke ? "B" : fill ? "f" : "S"}\n`;
      break;
    }
    case "ink": {
      body += `${rgbOp(a.color, "RG")} ${fmt(w)} w 1 J 1 j\n`;
      for (const p of a.inkList) {
        if (p.length < 2) continue;
        body += `${fmt(p[0])} ${fmt(p[1])} m\n`;
        if (p.length === 2) body += `${fmt(p[0] + 0.01)} ${fmt(p[1])} l\n`;
        for (let i = 2; i + 1 < p.length; i += 2) body += `${fmt(p[i])} ${fmt(p[i + 1])} l\n`;
        body += "S\n";
      }
      break;
    }
    case "line":
    case "arrow": {
      const [x0, y0, x1, y1] = a.line;
      body += `${rgbOp(a.color, "RG")} ${fmt(w)} w 1 J 1 j\n${fmt(x0)} ${fmt(y0)} m ${fmt(x1)} ${fmt(y1)} l S\n`;
      if (a.type === "arrow") {
        const [[ax, ay], [bx, by]] = arrowHead(x0, y0, x1, y1, w);
        body += `${fmt(ax)} ${fmt(ay)} m ${fmt(x1)} ${fmt(y1)} l ${fmt(bx)} ${fmt(by)} l S\n`;
      }
      break;
    }
    case "note": {
      const [x1, y1, x2, y2] = a.rect;
      const W = x2 - x1, H = y2 - y1;
      const c = a.color || [1, 0.83, 0];
      body += `${rgbOp(c, "rg")} 0.3 0.3 0.3 RG 0.6 w\n${roundRectPath(x1 + 0.5, y1 + 0.5, W - 1, H - 1, 2.5)}\nB\n`;
      body += `0.25 0.25 0.25 RG 1 w\n`;
      for (let i = 0; i < 3; i++) {
        const y = y2 - H * (0.32 + i * 0.18);
        body += `${fmt(x1 + W * 0.22)} ${fmt(y)} m ${fmt(x2 - W * (i === 2 ? 0.4 : 0.22))} ${fmt(y)} l S\n`;
      }
      break;
    }
    case "freetext":
    case "typewriter": {
      const r = a.rotate || 0;
      const [W, H] = uprightSize(a.rect, r);
      bbox = [0, 0, W, H];
      matrix = rotMatrix(r);
      const font = await fonts.get(FONT_FOR[a.font] || StandardFonts.Helvetica);
      res.Font = { F1: font.ref };
      const pad = FREETEXT_PAD[a.type] ?? 4;
      const bw = a.type === "typewriter" ? 0 : (a.borderColor && a.width > 0 ? a.width : 0);
      if (a.fill) body += `${rgbOp(a.fill, "rg")}\n0 0 ${fmt(W)} ${fmt(H)} re f\n`;
      if (bw) body += `${rgbOp(a.borderColor, "RG")} ${fmt(bw)} w\n${fmt(bw / 2)} ${fmt(bw / 2)} ${fmt(W - bw)} ${fmt(H - bw)} re S\n`;
      const size = a.fontSize || 12;
      const measure = (s) => font.widthOfTextAtSize(fonts.safe(font, s), size);
      // Typed text runs on one line per line typed; only a text box wraps.
      const maxW = a.type === "typewriter" ? Infinity : Math.max(1, W - 2 * pad - bw * 2);
      const lines = wrapLines(a.text || "", maxW, measure);
      const lh = size * LINE_HEIGHT;
      body += `q 0 0 ${fmt(W)} ${fmt(H)} re W n\nBT\n/F1 ${fmt(size)} Tf ${rgbOp(a.color || [0, 0, 0], "rg")}\n`;
      let y = H - pad - bw - size * ASCENT - (lh - size) / 2;
      let first = true;
      for (const line of lines) {
        if (first) { body += `1 0 0 1 ${fmt(pad + bw)} ${fmt(y)} Tm\n`; first = false; }
        else body += `0 ${fmt(-lh)} Td\n`;
        if (line) body += `${textShow(font, fonts.safe(font, line))}\n`;
        y -= lh;
      }
      body += "ET\nQ\n";
      break;
    }
    case "stamp": {
      const r = a.rotate || 0;
      const [W, H] = uprightSize(a.rect, r);
      bbox = [0, 0, W, H];
      matrix = rotMatrix(r);
      const font = await fonts.get(StandardFonts.HelveticaBold);
      res.Font = { F1: font.ref };
      const c = a.color || [0.75, 0.1, 0.1];
      const bwid = Math.max(1.5, Math.min(W, H) * 0.07);
      body += `${rgbOp(c, "RG")} ${fmt(bwid)} w\n${roundRectPath(bwid / 2, bwid / 2, W - bwid, H - bwid, Math.min(W, H) * 0.18)}\nS\n`;
      const label = fonts.safe(font, a.label || "STAMP");
      const w1 = font.widthOfTextAtSize(label, 1) || 1;
      const size = Math.max(4, Math.min(H * 0.56, (W - bwid * 2 - H * 0.3) / w1));
      const tw = font.widthOfTextAtSize(label, size);
      body += `BT /F1 ${fmt(size)} Tf ${rgbOp(c, "rg")} 1 0 0 1 ${fmt((W - tw) / 2)} ${fmt(H / 2 - size * 0.36)} Tm ${textShow(font, label)} ET\n`;
      break;
    }
    case "symbol": {
      const r = a.rotate || 0;
      const [W, H] = uprightSize(a.rect, r);
      bbox = [0, 0, W, H];
      matrix = rotMatrix(r);
      const c = a.color || [0, 0, 0];
      const s = Math.min(W, H);
      const lw = Math.max(0.8, s * 0.12);
      if (a.symbol === "dot") {
        body += `${rgbOp(c, "rg")}\n${ellipsePath(W / 2 - s * 0.3, H / 2 - s * 0.3, W / 2 + s * 0.3, H / 2 + s * 0.3)}\nf\n`;
      } else if (a.symbol === "cross") {
        body += `${rgbOp(c, "RG")} ${fmt(lw)} w 1 J\n${fmt(W * 0.18)} ${fmt(H * 0.18)} m ${fmt(W * 0.82)} ${fmt(H * 0.82)} l S\n${fmt(W * 0.18)} ${fmt(H * 0.82)} m ${fmt(W * 0.82)} ${fmt(H * 0.18)} l S\n`;
      } else {
        body += `${rgbOp(c, "RG")} ${fmt(lw)} w 1 J 1 j\n${fmt(W * 0.14)} ${fmt(H * 0.52)} m ${fmt(W * 0.4)} ${fmt(H * 0.22)} l ${fmt(W * 0.88)} ${fmt(H * 0.84)} l S\n`;
      }
      break;
    }
    case "image": {
      const r = a.rotate || 0;
      const [W, H] = uprightSize(a.rect, r);
      bbox = [0, 0, W, H];
      matrix = rotMatrix(r);
      const bytes = dataUrlBytes(a.image.data);
      const img = a.image.format === "jpg" ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
      res.XObject = { Im0: img.ref };
      body += `q ${fmt(W)} 0 0 ${fmt(H)} 0 0 cm /Im0 Do Q\n`;
      break;
    }
    default:
      return null;
  }
  if (Object.keys(gs).length) res.ExtGState = gs;
  const dict = {
    Type: "XObject",
    Subtype: "Form",
    FormType: 1,
    BBox: bbox,
    Resources: ctx.obj(res),
  };
  if (matrix) dict.Matrix = matrix;
  return ctx.register(ctx.flateStream(body, dict));
}

export function dataUrlBytes(dataUrl) {
  const b64 = String(dataUrl).split(",")[1] || "";
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

const SUBTYPE = {
  highlight: "Highlight", underline: "Underline", strikeout: "StrikeOut", note: "Text",
  freetext: "FreeText", typewriter: "FreeText", ink: "Ink", square: "Square", whiteout: "Square",
  circle: "Circle", line: "Line", arrow: "Line", stamp: "Stamp", symbol: "Stamp", image: "Stamp", link: "Link",
};

/** The Rect a line annotation needs to hold its stroke and its arrowhead. */
export function lineRect(line, w, arrow) {
  const [x0, y0, x1, y1] = line;
  let xs = [x0, x1], ys = [y0, y1];
  if (arrow) {
    const [[ax, ay], [bx, by]] = arrowHead(x0, y0, x1, y1, w);
    xs.push(ax, bx); ys.push(ay, by);
  }
  const m = w + 1;
  return [Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m];
}
/** The Rect an ink annotation needs to hold every stroke. */
export function inkRect(inkList, w) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of inkList) for (let i = 0; i + 1 < p.length; i += 2) {
    x1 = Math.min(x1, p[i]); x2 = Math.max(x2, p[i]);
    y1 = Math.min(y1, p[i + 1]); y2 = Math.max(y2, p[i + 1]);
  }
  const m = (w || 1) / 2 + 1;
  return [x1 - m, y1 - m, x2 + m, y2 + m];
}

function buildDict(doc, a, pageRef, apRef, allPageRefs) {
  const ctx = doc.context;
  const d = ctx.obj({});
  const set = (k, v) => d.set(N(k), v);
  const sub = SUBTYPE[a.type];
  set("Type", N("Annot"));
  set("Subtype", N(sub));
  set("Rect", ctx.obj(a.rect.map((v) => Math.round(v * 1000) / 1000)));
  set("NM", PDFString.of(NM_PREFIX + (a.id || Math.random().toString(36).slice(2))));
  set("F", PDFNumber.of(4));
  if (pageRef) set("P", pageRef);
  const now = new Date(a.modified || Date.now());
  set("M", PDFString.fromDate(now));
  const priv = {};

  if (sub !== "Link") {
    set("CreationDate", PDFString.fromDate(new Date(a.created || a.modified || Date.now())));
    if (a.author) set("T", PDFHexString.fromText(a.author));
    const contents = a.type === "freetext" || a.type === "typewriter" ? (a.text || "") : (a.contents || "");
    if (contents) set("Contents", PDFHexString.fromText(contents));
    if ((a.opacity ?? 1) < 1) set("CA", PDFNumber.of(a.opacity));
  }
  const colorKey = (c) => ctx.obj(c.map((v) => Math.round(v * 1000) / 1000));

  switch (a.type) {
    case "highlight":
    case "underline":
    case "strikeout":
      set("C", colorKey(a.color || [1, 0.83, 0]));
      set("QuadPoints", ctx.obj(a.quads.flat().map((v) => Math.round(v * 1000) / 1000)));
      if (a.textRot) priv.tr = a.textRot;
      if (a.quote) priv.q = a.quote.slice(0, 500);
      break;
    case "note":
      set("C", colorKey(a.color || [1, 0.83, 0]));
      set("Name", N("Comment"));
      set("Open", ctx.obj(false));
      break;
    case "freetext":
    case "typewriter": {
      const fontTag = a.font === "serif" ? "TiRo" : a.font === "mono" ? "Cour" : "Helv";
      const c = a.color || [0, 0, 0];
      set("DA", PDFString.of(`/${fontTag} ${fmt(a.fontSize || 12)} Tf ${fmt(c[0])} ${fmt(c[1])} ${fmt(c[2])} rg`));
      set("Q", PDFNumber.of(0));
      if (a.type === "typewriter") {
        set("IT", N("FreeTextTypeWriter"));
        set("BS", ctx.obj({ W: 0 }));
        priv.t = "typewriter";
      } else {
        set("BS", ctx.obj({ W: a.borderColor ? (a.width ?? 1) : 0 }));
        if (a.borderColor) set("C", colorKey(a.borderColor));
      }
      if (a.fill) { set("IC", colorKey(a.fill)); priv.fl = a.fill; }
      if (a.rotate) { set("Rotate", PDFNumber.of(a.rotate)); priv.r = a.rotate; }
      if (a.font && a.font !== "sans") priv.f = a.font;
      if (a.contents) priv.c = a.contents;
      break;
    }
    case "ink":
      set("C", colorKey(a.color || [0, 0, 0]));
      set("BS", ctx.obj({ W: a.width ?? 1 }));
      set("InkList", ctx.obj(a.inkList.map((p) => p.map((v) => Math.round(v * 100) / 100))));
      break;
    case "square":
    case "circle":
    case "whiteout":
      if (a.color && (a.width ?? 1) > 0) set("C", colorKey(a.color));
      else set("C", ctx.obj([]));
      set("BS", ctx.obj({ W: a.color ? (a.width ?? 1) : 0 }));
      if (a.fill) set("IC", colorKey(a.fill));
      if (a.type === "whiteout") priv.t = "whiteout";
      break;
    case "line":
    case "arrow":
      set("C", colorKey(a.color || [0, 0, 0]));
      set("BS", ctx.obj({ W: a.width ?? 1 }));
      set("L", ctx.obj(a.line.map((v) => Math.round(v * 1000) / 1000)));
      set("LE", ctx.obj([N("None"), N(a.type === "arrow" ? "OpenArrow" : "None")]));
      break;
    case "stamp":
      set("Name", N("PDFVStamp"));
      if (a.color) set("C", colorKey(a.color));
      priv.t = "stamp"; priv.l = a.label || "STAMP";
      if (a.rotate) priv.r = a.rotate;
      break;
    case "symbol":
      set("Name", N("PDFVSymbol"));
      if (a.color) set("C", colorKey(a.color));
      priv.t = "symbol"; priv.s = a.symbol || "check";
      if (a.rotate) priv.r = a.rotate;
      break;
    case "image": {
      set("Name", N(a.role === "signature" ? "PDFVSignature" : "PDFVImage"));
      priv.t = "image"; priv.fmt = a.image.format; if (a.role) priv.role = a.role;
      if (a.rotate) priv.r = a.rotate;
      const bytes = dataUrlBytes(a.image.data);
      set("PDFV_Img", ctx.register(ctx.stream(bytes, {})));
      break;
    }
    case "link": {
      set("Border", ctx.obj([0, 0, 0]));
      priv.t = "link";
      if (a.url) {
        priv.u = a.url;
        set("A", ctx.obj({ S: "URI", URI: PDFString.of(a.url) }));
      } else if (a.destPage && allPageRefs[a.destPage - 1]) {
        priv.d = a.destPage;
        set("Dest", ctx.obj([allPageRefs[a.destPage - 1], N("XYZ"), null, null, null]));
      }
      break;
    }
    default:
      return null;
  }
  if (Object.keys(priv).length) set("PDFV", PDFString.of(JSON.stringify(priv)));
  if (apRef) set("AP", ctx.obj({ N: apRef }));
  return d;
}

/**
 * Write the annotation set into `doc`.
 *   annots       — the full current set (model objects).
 *   removeRefs   — pdf.js ids ("12R") of annotations read from this file that
 *                  were deleted or changed; they are taken out of the page's
 *                  /Annots (with their popups) before the new ones go in.
 * Untouched annotations read from the file are neither removed nor re-written,
 * so whatever another program stored on them survives the save.
 */
export async function writeAnnotations(doc, annots, { removeRefs = new Set() } = {}) {
  const pages = doc.getPages();
  const pageRefs = pages.map((p) => p.ref);
  const ctx = doc.context;

  if (removeRefs.size) {
    for (const page of pages) {
      const arr = page.node.lookupMaybe(N("Annots"), PDFArray);
      if (!arr) continue;
      const drop = new Set();
      for (let i = 0; i < arr.size(); i++) {
        const r = arr.get(i);
        if (r instanceof PDFRef && removeRefs.has(refId(r))) {
          drop.add(refId(r));
          const d = ctx.lookupMaybe(r, PDFDict);
          const popup = d && d.get(N("Popup"));
          if (popup instanceof PDFRef) drop.add(refId(popup));
        }
      }
      if (!drop.size) continue;
      for (let i = arr.size() - 1; i >= 0; i--) {
        const r = arr.get(i);
        if (r instanceof PDFRef && drop.has(refId(r))) arr.remove(i);
      }
    }
  }

  const fonts = new FontCache(doc);
  for (const a of annots) {
    if (a.origRef && !a.dirty) continue; // untouched, already in the file
    const page = pages[a.page - 1];
    if (!page) continue;
    let apRef = null;
    if (a.type !== "link") apRef = await buildAppearance(doc, fonts, a);
    const dict = buildDict(doc, a, page.ref, apRef, pageRefs);
    if (!dict) continue;
    const ref = ctx.register(dict);
    let arr = page.node.lookupMaybe(N("Annots"), PDFArray);
    if (!arr) { arr = ctx.obj([]); page.node.set(N("Annots"), arr); }
    arr.push(ref);
  }
}

/** Drop every annotation this viewer's model covers — used before re-writing a whole set. */
export function removeModelAnnotations(doc, refs) {
  return writeAnnotations(doc, [], { removeRefs: refs });
}

// ── Flattening ───────────────────────────────────────────────────────────────

function mul(m, n) {
  return [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}
function apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

/**
 * Burn annotations into the page content: each one's normal appearance is
 * drawn where the annotation stands (PDF 32000 §12.5.5's mapping of BBox,
 * Matrix and Rect) and the annotation is removed. Links, popups and form
 * widgets are left alone — flatten a form with fillForm({ flatten: true }).
 * Returns the number flattened.
 */
export function flattenAnnotations(doc, { pages: only = null } = {}) {
  const ctx = doc.context;
  let count = 0;
  doc.getPages().forEach((page, idx) => {
    if (only && !only.has(idx + 1)) return;
    const arr = page.node.lookupMaybe(N("Annots"), PDFArray);
    if (!arr) return;
    const ops = [];
    for (let i = arr.size() - 1; i >= 0; i--) {
      const raw = arr.get(i);
      const d = raw instanceof PDFRef ? ctx.lookupMaybe(raw, PDFDict) : (raw instanceof PDFDict ? raw : null);
      if (!d) continue;
      const sub = d.get(N("Subtype"));
      const st = sub instanceof PDFName ? sub.decodeText() : "";
      if (st === "Link" || st === "Popup" || st === "Widget") continue;
      const flags = num(d.get(N("F"))) || 0;
      arr.remove(i);
      if (flags & 2 || flags & 32) continue; // hidden / no-view: gone, nothing to draw
      const ap = d.lookupMaybe(N("AP"), PDFDict);
      let n = ap ? ap.get(N("N")) : null;
      let stream = n ? ctx.lookup(n) : null;
      if (stream instanceof PDFDict) {
        // Appearance states (a checkbox-like stamp): the one AS names is drawn.
        const as = d.get(N("AS"));
        n = as instanceof PDFName ? stream.get(as) : null;
        stream = n ? ctx.lookup(n) : null;
      }
      if (!(stream instanceof PDFStream)) continue;
      if (!(n instanceof PDFRef)) n = ctx.register(stream);
      const rect = normRect(nums(d.lookupMaybe(N("Rect"), PDFArray)));
      if (!rect) continue;
      const sd = stream.dict;
      const bbox = normRect(nums(sd.lookupMaybe(N("BBox"), PDFArray))) || [0, 0, 1, 1];
      const matrix = nums(sd.lookupMaybe(N("Matrix"), PDFArray)) || [1, 0, 0, 1, 0, 0];
      const corners = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]].map(([x, y]) => apply(matrix, x, y));
      const tx1 = Math.min(...corners.map((c) => c[0])), tx2 = Math.max(...corners.map((c) => c[0]));
      const ty1 = Math.min(...corners.map((c) => c[1])), ty2 = Math.max(...corners.map((c) => c[1]));
      const sx = tx2 - tx1 ? (rect[2] - rect[0]) / (tx2 - tx1) : 1;
      const sy = ty2 - ty1 ? (rect[3] - rect[1]) / (ty2 - ty1) : 1;
      const A = [sx, 0, 0, sy, rect[0] - tx1 * sx, rect[1] - ty1 * sy];
      const name = page.node.newXObject("FlatAnnot", n);
      ops.unshift(`q ${A.map(fmt).join(" ")} cm ${name.asString()} Do Q`);
      count++;
    }
    if (arr.size() === 0) page.node.delete(N("Annots"));
    if (ops.length) {
      page.node.normalize();
      const s = ctx.register(ctx.flateStream(ops.join("\n") + "\n", {}));
      page.node.addContentStream(s);
    }
  });
  return count;
}
