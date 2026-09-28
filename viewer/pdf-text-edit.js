// pdf-text-edit.js
//
// Editing a PDF's own text, the way Acrobat's Edit PDF does: a paragraph is
// found on the page, retyped (it reflows inside its box), and on save its old
// glyphs are taken OUT of the page's content stream and the new words are
// written in as real text. Nothing is covered or hidden: the file afterwards
// holds only the new words, so search, copy and every other reader see them.
//
// Four parts, all pure (pdf-lib objects in, pdf-lib objects out; no DOM), so
// Node tests drive them on real documents:
//
//   findTextBlocks   pdf.js text items → paragraphs, with their geometry, the
//                    runs of bold / italic / superscript they are set in, line
//                    spacing, first-line indent and alignment.
//   layoutText       a paragraph's runs → lines, with the standard fonts'
//                    metrics. The viewer lays the edited text out on screen
//                    with this very function, so the lines break where the
//                    saved file breaks them.
//   removeGlyphs     the content-stream side: every glyph whose centre falls
//                    in a paragraph's area is dropped from its Tj / TJ, with a
//                    kerning offset in its place so the glyphs that stay on
//                    the line do not move. Form XObjects are followed (and
//                    copied for this page before they are changed).
//   applyTextEdits   the edits of a document, page by page: remove, then
//                    write the new paragraphs in the standard font family
//                    closest to the original (Times, Helvetica or Courier,
//                    each in bold / italic).

import {
  PDFName, PDFDict, PDFArray, PDFNumber, PDFRawStream,
  StandardFonts, StandardFontEmbedder, decodePDFRawStream,
} from "./vendor/pdf-lib/pdf-lib.esm.min.js";

const N = (s) => PDFName.of(s);

// ── Geometry conventions ─────────────────────────────────────────────────────
//
// A text box's top edge is its first baseline plus ASCENT em; its bottom is
// the last baseline less DESCENT em. The screen and the writer both place the
// first baseline from the top edge with ASCENT, so they agree.
export const ASCENT = 0.8;
export const DESCENT = 0.25;
export const SUP_SCALE = 0.65;   // a superscript's size, as a share of the text's
export const SUP_RISE = 0.33;    // …and how far it is raised, in em

// ── Fonts ────────────────────────────────────────────────────────────────────

const STD = {
  serif: ["TimesRoman", "TimesRomanBold", "TimesRomanItalic", "TimesRomanBoldItalic"],
  sans: ["Helvetica", "HelveticaBold", "HelveticaOblique", "HelveticaBoldOblique"],
  mono: ["Courier", "CourierBold", "CourierOblique", "CourierBoldOblique"],
};
/** The standard font (a StandardFonts key) for a family and style. */
export function standardFontKey(family, { bold = false, italic = false } = {}) {
  const set = STD[family] || STD.sans;
  return set[(bold ? 1 : 0) + (italic ? 2 : 0)];
}
const embedders = new Map();
function embedderFor(key) {
  if (!embedders.has(key)) embedders.set(key, StandardFontEmbedder.for(StandardFonts[key]));
  return embedders.get(key);
}

/** What a PDF font is set in, from its name and pdf.js's generic family. */
const SERIF_RE = /times|roman|serif|garamond|georgia|cambria|book|century|palatino|minion|baskerville|bodoni|caslon|charter|goudy|constantia|schoolbook|antiqua|bembo|sabon|janson|tinos|liberationserif|nimbusrom/i;
const SANS_RE = /arial|helvetica|calibri|verdana|tahoma|segoe|gothic|futura|univers|frutiger|myriad|gill|sans|franklin|trebuchet|lato|roboto|aptos|arimo|nimbussan/i;
export function fontStyleFromName(name, { generic = "", bold = false, italic = false } = {}) {
  const n = String(name || "").replace(/^[A-Z]{6}\+/, "");
  const isBold = !!bold || /bold|black|heavy|semibold|demibold|demi\b|[-,](bd|b)$/i.test(n);
  const isItalic = !!italic || /italic|oblique|[-,](it|i|bi|bdit)$/i.test(n);
  let family;
  if (/courier|mono|consol|typewriter/i.test(n) || /monospace/i.test(generic)) family = "mono";
  else if (SERIF_RE.test(n) && !/sans/i.test(n)) family = "serif";
  else if (SANS_RE.test(n)) family = "sans";
  else if (/serif/i.test(generic) && !/sans/i.test(generic)) family = "serif";
  else family = "sans";
  return { family, bold: isBold, italic: isItalic };
}

// Everything the standard fonts can write (WinAnsi). A character outside it is
// written as the nearest thing it has, or "?".
const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const FOLD = { "−": "-", "‐": "-", "‑": "-", "‒": "-", "―": "—", " ": " ", " ": " ", " ": " ", " ": " ", " ": " ", " ": " ", " ": " ", "′": "'", "″": '"', "‛": "'", "‟": '"', "․": ".", "‧": "·", "ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl" };
export function toWinAnsi(text) {
  let out = "";
  for (const ch of String(text || "")) {
    const c = ch.codePointAt(0);
    if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WINANSI_EXTRA.includes(ch)) out += ch;
    else if (FOLD[ch] != null) out += FOLD[ch];
    else if (c === 9) out += " ";
    else if (c === 10) out += "\n";
    else out += "?";
  }
  return out;
}

/** Width of `text` in points, set in the standard font for `style` at `size`. */
export function measureText(text, family, style, size) {
  const e = embedderFor(standardFontKey(family, style));
  const t = toWinAnsi(text).replace(/\n/g, "");
  return t ? e.widthOfTextAtSize(t, size) : 0;
}

// ── Layout ───────────────────────────────────────────────────────────────────

const sameStyle = (a, b) => !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.sup === !!b.sup;
const styleOf = (r) => ({ bold: !!r.bold, italic: !!r.italic, sup: !!r.sup });

/**
 * Lay a paragraph's runs out in lines.
 *   runs    [{ text, bold, italic, sup }] ("\n" in a text is a line break)
 *   width   the box's width in points
 *   indent  the first line's offset from the box's left (negative: hanging)
 *   align   "left" | "justify" | "center" | "right"
 * Returns [{ segs: [{ text, bold, italic, sup }], width, spaces, x, wordSpacing, hard }]:
 * `x` from the box's left edge, `wordSpacing` the extra per space (justify).
 */
export function layoutText({ runs, width, size, family = "serif", indent = 0, align = "left" }, measure = measureText) {
  const m = (text, st) => measure(text, family, st, st.sup ? size * SUP_SCALE : size);
  // Tokens: words (possibly spanning runs: "Aguilar" in italics then ","),
  // single spaces, and hard breaks.
  const toks = [];
  let word = null;
  const endWord = () => { if (word) { toks.push(word); word = null; } };
  for (const r of runs || []) {
    const st = styleOf(r);
    const text = String(r.text || "").replace(/\r\n?/g, "\n").replace(/[\t ]/g, " ");
    for (const piece of text.split(/(\n| )/)) {
      if (!piece) continue;
      if (piece === "\n") { endWord(); toks.push({ br: true }); continue; }
      if (piece === " ") { endWord(); toks.push({ space: true, st, w: m(" ", st) }); continue; }
      if (!word) word = { parts: [], w: 0 };
      const last = word.parts[word.parts.length - 1];
      if (last && sameStyle(last, st)) last.text += piece; else word.parts.push({ text: piece, ...st });
      word.w += m(piece, st);
    }
  }
  endWord();

  const lines = [];
  let line = null;
  const open = (first) => { line = { items: [], first, w: 0 }; };
  const close = (hard) => {
    while (line.items.length && line.items[line.items.length - 1].space) line.w -= line.items.pop().w;
    lines.push({ ...line, hard });
  };
  open(true);
  for (const t of toks) {
    const avail = width - (line.first ? indent : 0);
    if (t.br) { close(true); open(true); continue; }
    if (t.space) {
      if (!line.items.length && !line.first) continue; // a wrapped line does not start with the space it wrapped at
      line.items.push(t); line.w += t.w; continue;
    }
    // The spaces before the word are on the line if the word is; if it does
    // not fit, the line closes and they go with it.
    const hasWord = line.items.some((x) => !x.space);
    if (hasWord && line.w + t.w > avail + 0.01) {
      close(false); open(false);
    }
    line.items.push(t); line.w += t.w;
  }
  close(true);

  return lines.map((l) => {
    const segs = [];
    let spaces = 0;
    for (const it of l.items) {
      const parts = it.space ? [{ text: " ", ...it.st }] : it.parts;
      if (it.space) spaces++;
      for (const p of parts) {
        const last = segs[segs.length - 1];
        if (last && sameStyle(last, p)) last.text += p.text; else segs.push({ ...p });
      }
    }
    const lead = l.first ? indent : 0;
    const avail = width - lead;
    let x = lead, wordSpacing = 0;
    if (align === "center") x = lead + (avail - l.w) / 2;
    else if (align === "right") x = lead + avail - l.w;
    else if (align === "justify" && !l.hard && spaces > 0 && l.w < avail) wordSpacing = (avail - l.w) / spaces;
    return { segs, width: l.w, spaces, x, wordSpacing, hard: l.hard };
  });
}

/** The lines of a text edit, and the box they fill (rect: [x0, y0, x1, y1]). */
export function layoutEdit(edit, measure = measureText) {
  const [x0, , x1, top] = edit.rect;
  const size = edit.fontSize || 12;
  const lh = edit.lineHeight || size * 1.2;
  const lines = layoutText({
    runs: edit.runs, width: x1 - x0, size, family: edit.font || "serif",
    indent: edit.indent || 0, align: edit.align || "left",
  }, measure);
  const first = top - ASCENT * size;
  const n = Math.max(1, lines.length);
  const bottom = first - (n - 1) * lh - DESCENT * size;
  return { lines, firstBaseline: first, lineHeight: lh, rect: [x0, bottom, x1, top] };
}

// ── Finding paragraphs ───────────────────────────────────────────────────────

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };

/**
 * Paragraphs on a page from pdf.js text items ({ str, transform, width,
 * fontName }). `fontInfo(fontName)` → { family, bold, italic }. Only text set
 * upright in the page's own space is taken; rotated or vertical text is left.
 */
export function findTextBlocks(items, { fontInfo = () => ({}), pageBox = null } = {}) {
  const glyphs = [];
  for (const it of items || []) {
    if (!it || typeof it.str !== "string" || !it.transform) continue;
    const [a, b, c, d, e, f] = it.transform;
    const size = Math.hypot(c, d);
    if (!(size > 0.5) || a <= 0 || d <= 0 || Math.abs(b) > a * 0.02 || Math.abs(c) > d * 0.02) continue;
    if (!it.str.trim()) continue;
    const info = fontInfo(it.fontName) || {};
    glyphs.push({ str: it.str, x0: e, x1: e + (it.width || 0), base: f, size, family: info.family || "serif", bold: !!info.bold, italic: !!info.italic });
  }
  if (!glyphs.length) return [];

  // Rows: items sharing a baseline. A superscript or a footnote mark sits a
  // little above it and still belongs to it.
  glyphs.sort((p, q) => q.size - p.size || q.base - p.base);
  const rows = [];
  for (const g of glyphs) {
    let best = null;
    for (const r of rows) {
      const tol = 0.5 * Math.max(r.size, g.size);
      const dy = g.base - r.base;
      if (dy > -0.2 * r.size && dy < tol && g.size <= r.size * 1.05 + 0.01) {
        if (!best || Math.abs(dy) < Math.abs(g.base - best.base)) best = r;
      }
    }
    if (best) best.items.push(g);
    else rows.push({ base: g.base, size: g.size, items: [g] });
  }

  // Segments: a row split where a gap is too wide to be a space (another
  // column, a tab, the pleading line numbers down the margin).
  const segs = [];
  for (const r of rows) {
    r.items.sort((p, q) => p.x0 - q.x0);
    let cur = null;
    for (const g of r.items) {
      if (cur && g.x0 - cur.x1 > 1.5 * r.size) { segs.push(cur); cur = null; }
      if (!cur) cur = { items: [], x0: g.x0, x1: g.x1, base: r.base, size: r.size };
      cur.items.push(g);
      cur.x1 = Math.max(cur.x1, g.x1);
      cur.x0 = Math.min(cur.x0, g.x0);
    }
    if (cur) segs.push(cur);
  }
  for (const s of segs) {
    // The row's size is its largest item; the text's size is the one most of
    // its characters are set in.
    const w = new Map();
    for (const g of s.items) w.set(g.size, (w.get(g.size) || 0) + g.str.length);
    s.size = [...w.entries()].sort((p, q) => q[1] - p[1])[0][0];
  }

  // Paragraphs: segments stacked at a steady spacing, sharing a left margin
  // (bar a first-line indent), in the same size of type.
  segs.sort((p, q) => q.base - p.base || p.x0 - q.x0);
  const blocks = [];
  for (const s of segs) {
    let best = null, bestGap = Infinity;
    for (const b of blocks) {
      const last = b.lines[b.lines.length - 1];
      const gap = last.base - s.base;
      if (gap <= 0.4 * s.size) continue;
      if (Math.abs(s.size - b.size) > 0.15 * b.size) continue;
      if (!(s.x0 < b.x1 && s.x1 > b.x0)) continue;
      // A line ends short of the margin only where its paragraph ends: if the
      // next line's first word would have fitted on it, that is where it did.
      const right = Math.max(b.right, s.x1);
      if (right - last.x1 > firstWordWidth(s) + 0.35 * b.size) continue;
      if (b.lines.length >= 2) {
        // Steady spacing; a line can sit a little lower than the rest (a
        // superscript makes it taller), never closer.
        if (gap < b.spacing - 0.25 * b.size || gap > b.spacing + 0.45 * b.size) continue;
        if (Math.abs(s.x0 - b.left) > 0.5 * b.size) continue;       // indented: a new paragraph
      } else {
        if (gap > 2.4 * b.size) continue;
        const first = b.lines[0];
        // A first-line indent is at most an inch or so.
        if (s.x0 > first.x0 + 0.5 * b.size || s.x0 < first.x0 - 6.5 * b.size) continue;
        // A heading in bold does not run on into plain text.
        if (boldShare(first) > 0.8 && boldShare(s) < 0.2) continue;
        // Nor does a line centred on the page into one set from the margin.
        if (pageBox && first.x0 - s.x0 > b.size) {
          const leftIn = first.x0 - pageBox[0], rightIn = pageBox[2] - first.x1;
          if (Math.abs(leftIn - rightIn) < b.size && first.x1 < pageBox[2] - (s.x0 - pageBox[0]) - 2 * b.size) continue;
        }
      }
      if (gap < bestGap) { best = b; bestGap = gap; }
    }
    if (best) {
      if (best.lines.length === 1 || bestGap < best.spacing) best.spacing = bestGap;
      best.lines.push(s);
      best.left = median(best.lines.slice(1).map((l) => l.x0));
      best.x0 = Math.min(best.x0, s.x0); best.x1 = Math.max(best.x1, s.x1);
      best.right = Math.max(best.right, s.x1);
    } else {
      blocks.push({ lines: [s], size: s.size, x0: s.x0, x1: s.x1, left: s.x0, right: s.x1, spacing: 0 });
    }
  }

  // The page's own habits: its usual line spacing and whether it justifies,
  // for a one-line paragraph that grows into several.
  const multi = blocks.filter((b) => b.lines.length >= 2);
  const spacingFor = (size) => {
    const near = multi.filter((b) => Math.abs(b.size - size) < 0.15 * size).map((b) => b.spacing / b.size);
    return (near.length ? median(near) : 1.2) * size;
  };
  const isJustified = (b) => b.lines.length >= 3 && b.lines.slice(0, -1).every((l) => l.x1 >= b.right - 0.5 * b.size);
  const tall = blocks.filter((b) => b.lines.length >= 3);
  const pageJustifies = tall.length > 0 && tall.filter(isJustified).length * 2 > tall.length;
  const columnRight = median(multi.map((b) => b.right)) || null;
  // …and its margin and paragraph indent, for a one-line paragraph that was
  // indented like the others.
  const columnLeft = median(multi.map((b) => b.left)) || null;
  const pageIndent = median(multi.filter((b) => b.lines[0].x0 - b.left > 0.3 * b.size).map((b) => b.lines[0].x0 - b.left)) || 0;
  const px0 = pageBox ? pageBox[0] : null, px1 = pageBox ? pageBox[2] : null;

  const out = [];
  for (const b of blocks) {
    const lines = b.lines;
    // A column of numbers down the margin (pleading line numbers) is not prose.
    if (lines.length >= 3 && lines.every((l) => l.items.every((g) => /^\s*\d{1,3}\s*$/.test(g.str)))) continue;
    const size = b.size;
    const first = lines[0], last = lines[lines.length - 1];
    const contLeft = lines.length >= 2 ? b.left : first.x0;
    let indent = first.x0 - contLeft;
    if (Math.abs(indent) < 0.3 * size) indent = 0;
    let left = contLeft, right = b.right;
    let align = "left";
    if (lines.length >= 3 ? isJustified(b) : lines.length === 2 && pageJustifies && first.x1 >= b.right - 0.5 * size) align = "justify";
    if (lines.length === 1 && px0 != null) {
      const cx = (first.x0 + first.x1) / 2, pageCx = (px0 + px1) / 2;
      if (Math.abs(cx - pageCx) < 0.6 * size && first.x0 - px0 > 0.15 * (px1 - px0)) {
        align = "center";
        const half = Math.max((first.x1 - first.x0) / 2, 0.4 * (px1 - px0 - 144));
        left = cx - half; right = cx + half;
      } else {
        if (columnRight && first.x0 < columnRight - 2 * size && columnRight > right) right = columnRight;
        else if (px1 != null) right = Math.max(right, Math.min(px1 - 72, first.x1 + 20 * size));
        if (columnLeft != null && pageIndent && Math.abs(first.x0 - (columnLeft + pageIndent)) < 0.5 * size) {
          left = columnLeft;
          indent = first.x0 - columnLeft;
        }
      }
    }

    // The words, in runs of one style. Lines are joined with a space, except
    // after a hyphen at the end of a line.
    const runs = [];
    let text = "";
    const push = (str, st) => {
      if (text.endsWith(" ")) str = str.replace(/^ +/, "");
      if (!str) return;
      const lastRun = runs[runs.length - 1];
      if (lastRun && sameStyle(lastRun, st)) lastRun.text += str; else runs.push({ text: str, ...st });
      text += str;
    };
    const prevStyle = (st) => (runs.length ? styleOf(runs[runs.length - 1]) : st);
    lines.forEach((l, li) => {
      const its = [...l.items].sort((p, q) => p.x0 - q.x0);
      its.forEach((g, gi) => {
        const st = { bold: g.bold, italic: g.italic, sup: g.size < l.size * 0.85 && g.base - l.base > 0.12 * l.size };
        if (gi === 0 && li > 0) {
          if (text && !/[ \u00ad-]$/.test(text)) push(" ", prevStyle(st));
        } else if (gi > 0 && g.x0 - its[gi - 1].x1 > 0.12 * l.size) push(" ", prevStyle(st));
        push(g.str.replace(/\s+/g, " "), st);
      });
    });
    // Trim the ends.
    if (runs.length) { runs[0].text = runs[0].text.replace(/^\s+/, ""); runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, ""); }
    const all = glyphsOf(lines);
    const top = Math.max(...all.map((g) => g.base + 0.9 * g.size));
    const bottom = Math.min(...all.map((g) => g.base - 0.3 * g.size));
    const orig = [Math.min(...all.map((g) => g.x0)) - 0.5, bottom, Math.max(...all.map((g) => g.x1)) + 0.5, top];
    const fam = new Map();
    for (const g of all) fam.set(g.family, (fam.get(g.family) || 0) + g.str.length);
    out.push({
      lines: lines.length,
      text: runs.map((r) => r.text).join(""),
      runs,
      font: [...fam.entries()].sort((p, q) => q[1] - p[1])[0][0],
      fontSize: Math.round(size * 100) / 100,
      lineHeight: Math.round((lines.length >= 2 ? b.spacing : spacingFor(size)) * 100) / 100,
      indent: Math.round(indent * 100) / 100,
      align,
      firstBaseline: first.base,
      lastBaseline: last.base,
      left, right,
      orig,
      rect: [left, last.base - DESCENT * size, right, first.base + ASCENT * size],
    });
  }
  return out;
}
function glyphsOf(lines) { return lines.flatMap((l) => l.items); }
function boldShare(seg) {
  let bold = 0, all = 0;
  for (const g of seg.items) { all += g.str.length; if (g.bold) bold += g.str.length; }
  return all ? bold / all : 0;
}
function firstWordWidth(seg) {
  const g = [...seg.items].sort((p, q) => p.x0 - q.x0)[0];
  const word = (g.str.trim().match(/^\S+/) || [""])[0];
  const per = g.str.length ? (g.x1 - g.x0) / g.str.length : seg.size * 0.5;
  return word.length * per;
}

// ── Reading a content stream ─────────────────────────────────────────────────

const WS = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1;
const DELIM = new Uint8Array(256);
for (const ch of "()<>[]{}/%") DELIM[ch.charCodeAt(0)] = 1;
const td = new TextDecoder("latin1");

/**
 * The operations of a content stream: [{ op, args, start, end }], where
 * start..end is the byte range of the operands and the operator together (so
 * one operation can be replaced in place). Args are { t, v }: num, name, str
 * (bytes), hex (bytes), arr, dict, bool, null. Inline images are one "BI".
 */
export function parseContent(bytes) {
  const n = bytes.length;
  let i = 0;
  const ops = [];
  const skip = () => {
    for (;;) {
      while (i < n && WS[bytes[i]]) i++;
      if (i < n && bytes[i] === 37) { while (i < n && bytes[i] !== 10 && bytes[i] !== 13) i++; continue; }
      return;
    }
  };
  const readString = () => {
    // i at "("
    i++;
    const out = [];
    let depth = 1;
    while (i < n) {
      const c = bytes[i++];
      if (c === 92) { // backslash
        const e = bytes[i++];
        if (e === 110) out.push(10); else if (e === 114) out.push(13); else if (e === 116) out.push(9);
        else if (e === 98) out.push(8); else if (e === 102) out.push(12);
        else if (e === 13) { if (bytes[i] === 10) i++; }
        else if (e === 10) { /* line continuation */ }
        else if (e >= 48 && e <= 55) {
          let v = e - 48;
          for (let k = 0; k < 2 && bytes[i] >= 48 && bytes[i] <= 55; k++) v = v * 8 + (bytes[i++] - 48);
          out.push(v & 255);
        } else if (e !== undefined) out.push(e);
        continue;
      }
      if (c === 40) depth++;
      else if (c === 41) { depth--; if (!depth) break; }
      out.push(c);
    }
    return { t: "str", v: Uint8Array.from(out) };
  };
  const readHex = () => {
    i++; // "<"
    const hex = [];
    while (i < n && bytes[i] !== 62) {
      const c = bytes[i++];
      if (!WS[c]) hex.push(c);
    }
    i++; // ">"
    if (hex.length % 2) hex.push(48);
    const out = new Uint8Array(hex.length / 2);
    for (let k = 0; k < out.length; k++) out[k] = parseInt(String.fromCharCode(hex[2 * k], hex[2 * k + 1]), 16) || 0;
    return { t: "hex", v: out };
  };
  const readName = () => {
    i++; // "/"
    const s = i;
    while (i < n && !WS[bytes[i]] && !DELIM[bytes[i]]) i++;
    const raw = td.decode(bytes.subarray(s, i));
    return { t: "name", v: raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) };
  };
  const readValue = () => {
    skip();
    if (i >= n) return null;
    const c = bytes[i];
    if (c === 40) return readString();
    if (c === 60) {
      if (bytes[i + 1] === 60) { // dict
        i += 2;
        const v = [];
        for (;;) {
          skip();
          if (i >= n) break;
          if (bytes[i] === 62 && bytes[i + 1] === 62) { i += 2; break; }
          const x = readValue();
          if (!x) break;
          v.push(x);
        }
        return { t: "dict", v };
      }
      return readHex();
    }
    if (c === 91) { // array
      i++;
      const v = [];
      for (;;) {
        skip();
        if (i >= n) break;
        if (bytes[i] === 93) { i++; break; }
        const x = readValue();
        if (!x) break;
        v.push(x);
      }
      return { t: "arr", v };
    }
    if (c === 47) return readName();
    if (c === 93 || c === 41 || c === 62 || c === 123 || c === 125) { i++; return { t: "junk" }; }
    // A number or a keyword.
    const s = i;
    while (i < n && !WS[bytes[i]] && !DELIM[bytes[i]]) i++;
    if (i === s) { i++; return { t: "junk" }; }
    const word = td.decode(bytes.subarray(s, i));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: "num", v: parseFloat(word) };
    if (word === "true" || word === "false") return { t: "bool", v: word === "true" };
    if (word === "null") return { t: "null" };
    return { t: "kw", v: word };
  };

  let args = [];
  let argStart = -1;
  for (;;) {
    skip();
    if (i >= n) break;
    const at = i;
    const tok = readValue();
    if (!tok) break;
    if (tok.t !== "kw") {
      if (argStart < 0) argStart = at;
      args.push(tok);
      continue;
    }
    const start = argStart < 0 ? at : argStart;
    if (tok.v === "BI") {
      // Inline image: key/value pairs, ID, one white-space byte, the data, EI.
      for (;;) {
        skip();
        if (i >= n) break;
        const t = readValue();
        if (!t || (t.t === "kw" && t.v === "ID")) break;
      }
      i++;
      let j = i;
      while (j < n) {
        if (bytes[j] === 69 && bytes[j + 1] === 73 && (j === 0 || WS[bytes[j - 1]]) && (j + 2 >= n || WS[bytes[j + 2]] || DELIM[bytes[j + 2]])) break;
        j++;
      }
      i = Math.min(n, j + 2);
      ops.push({ op: "BI", args: [], start, end: i });
    } else {
      ops.push({ op: tok.v, args, start, end: i });
    }
    args = [];
    argStart = -1;
  }
  return ops;
}

// ── Matrices ─────────────────────────────────────────────────────────────────

/** m1 × m2 (apply m1, then m2), PDF's row-vector convention. */
export function mul(m1, m2) {
  const [a, b, c, d, e, f] = m1, [A, B, C, D, E, F] = m2;
  return [a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F];
}
const apply = (m, x, y) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];

// ── Font widths from the file ────────────────────────────────────────────────

const WINANSI_HIGH = {
  128: "€", 130: "‚", 131: "ƒ", 132: "„", 133: "…", 134: "†", 135: "‡", 136: "ˆ", 137: "‰", 138: "Š", 139: "‹", 140: "Œ", 142: "Ž",
  145: "‘", 146: "’", 147: "“", 148: "”", 149: "•", 150: "–", 151: "—", 152: "˜", 153: "™", 154: "š", 155: "›", 156: "œ", 158: "ž", 159: "Ÿ",
};
const STD_BY_BASE = [
  [/^times.*bold.*italic|^times.*bolditalic/i, "TimesRomanBoldItalic"], [/^times.*bold/i, "TimesRomanBold"], [/^times.*italic/i, "TimesRomanItalic"], [/^times/i, "TimesRoman"],
  [/^helvetica.*bold.*oblique/i, "HelveticaBoldOblique"], [/^helvetica.*bold/i, "HelveticaBold"], [/^helvetica.*oblique/i, "HelveticaOblique"], [/^(helvetica|arial)/i, "Helvetica"],
  [/^courier.*bold.*oblique/i, "CourierBoldOblique"], [/^courier.*bold/i, "CourierBold"], [/^courier.*oblique/i, "CourierOblique"], [/^courier/i, "Courier"],
];

function numOf(o) { return o instanceof PDFNumber ? o.asNumber() : undefined; }

/** { codeLen, width(code) in em } for a font dictionary. */
function fontMetrics(font, context) {
  const fallback = { codeLen: 1, width: () => 0.5 };
  if (!(font instanceof PDFDict)) return fallback;
  const sub = font.lookup(N("Subtype"));
  const subtype = sub ? sub.asString() : "";
  if (subtype === "/Type0") {
    const desc = font.lookup(N("DescendantFonts"));
    const d = desc instanceof PDFArray ? desc.lookup(0) : null;
    let dw = 1000;
    const w = new Map();
    if (d instanceof PDFDict) {
      dw = numOf(d.lookup(N("DW"))) ?? 1000;
      const W = d.lookup(N("W"));
      if (W instanceof PDFArray) {
        for (let k = 0; k < W.size();) {
          const c0 = numOf(W.lookup(k));
          const nx = W.lookup(k + 1);
          if (nx instanceof PDFArray) {
            for (let j = 0; j < nx.size(); j++) w.set(c0 + j, numOf(nx.lookup(j)) ?? dw);
            k += 2;
          } else {
            const c1 = numOf(nx), wv = numOf(W.lookup(k + 2));
            if (c0 != null && c1 != null && c1 - c0 < 70000) for (let c = c0; c <= c1; c++) w.set(c, wv ?? dw);
            k += 3;
          }
        }
      }
    }
    return { codeLen: 2, width: (code) => (w.has(code) ? w.get(code) : dw) / 1000 };
  }
  const first = numOf(font.lookup(N("FirstChar"))) ?? 0;
  const widths = font.lookup(N("Widths"));
  let scale = 0.001;
  if (subtype === "/Type3") {
    const fm = font.lookup(N("FontMatrix"));
    if (fm instanceof PDFArray) scale = numOf(fm.lookup(0)) ?? 0.001;
  }
  if (widths instanceof PDFArray && widths.size()) {
    const desc = font.lookup(N("FontDescriptor"));
    const missing = desc instanceof PDFDict ? numOf(desc.lookup(N("MissingWidth"))) ?? 0 : 0;
    const arr = [];
    for (let k = 0; k < widths.size(); k++) arr.push(numOf(widths.lookup(k)) ?? missing);
    return { codeLen: 1, width: (code) => ((code >= first && code - first < arr.length) ? arr[code - first] : missing) * scale };
  }
  // A standard font named without widths: its own metrics.
  const base = font.lookup(N("BaseFont"));
  const baseName = base ? base.asString().slice(1).replace(/^[A-Z]{6}\+/, "") : "";
  const hit = STD_BY_BASE.find(([re]) => re.test(baseName));
  if (hit) {
    const e = embedderFor(hit[1]);
    const cache = new Map();
    return {
      codeLen: 1,
      width: (code) => {
        if (cache.has(code)) return cache.get(code);
        const ch = code >= 32 && code <= 126 ? String.fromCharCode(code) : code >= 160 ? String.fromCharCode(code) : WINANSI_HIGH[code];
        let wv = 0.5;
        try { if (ch) wv = e.widthOfTextAtSize(ch, 1); } catch { /* not in the font */ }
        cache.set(code, wv);
        return wv;
      },
    };
  }
  void context;
  return fallback;
}

function streamBytes(stream) {
  if (!stream) return new Uint8Array();
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  if (typeof stream.getUnencodedContents === "function") return stream.getUnencodedContents();
  if (typeof stream.getContents === "function") return stream.getContents();
  return new Uint8Array();
}

const fmt = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};
const hexOf = (bytes) => "<" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") + ">";

function colorFrom(args, space) {
  const nums = args.filter((a) => a.t === "num").map((a) => a.v);
  if (nums.length === 1 && (!space || /Gray|CalGray/.test(space))) return [nums[0], nums[0], nums[0]];
  if (nums.length === 3) return nums;
  if (nums.length === 4) { const [c, m, y, k] = nums; return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]; }
  return null;
}

// ── Taking glyphs out ────────────────────────────────────────────────────────

/**
 * Walk a content stream and drop every glyph whose centre lies in one of
 * `rects` (user space of the page). Returns the byte edits for this stream,
 * form XObjects to swap for edited copies, and, per rect, how many glyphs
 * went and the colour they were painted in.
 */
function processStream({ bytes, resources, ctm, gsIn, context, rects, stats, depth }) {
  const ops = parseContent(bytes);
  const edits = [];
  const xobjReplace = new Map();
  const fonts = new Map();
  const fontDictOf = (name) => {
    const fd = resources instanceof PDFDict ? resources.lookup(N("Font")) : null;
    return fd instanceof PDFDict ? fd.lookup(N(name)) : null;
  };
  const metricsFor = (name) => {
    if (!fonts.has(name)) fonts.set(name, fontMetrics(fontDictOf(name), context));
    return fonts.get(name);
  };
  let gs = { ...gsIn, ctm };
  const stack = [];
  let Tm = [1, 0, 0, 1, 0, 0], Tlm = [1, 0, 0, 1, 0, 0];
  const hitRect = (x, y) => {
    for (let r = 0; r < rects.length; r++) {
      const q = rects[r];
      if (x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3]) return r;
    }
    return -1;
  };
  const nextLine = () => { Tlm = mul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm.slice(); };

  // Show a list of elements (byte strings and TJ numbers); returns the list
  // to write in its place, or null when nothing on it went.
  const show = (elems) => {
    const m = metricsFor(gs.font);
    const size = gs.size, Th = gs.Th;
    const out = [];
    let cur = [];
    let changed = false;
    const flush = () => { if (cur.length) { out.push(Uint8Array.from(cur)); cur = []; } };
    const pushNum = (v) => {
      flush();
      if (out.length && typeof out[out.length - 1] === "number") out[out.length - 1] += v; else out.push(v);
    };
    for (const el of elems) {
      if (el.t === "num") {
        pushNum(el.v);
        Tm = mul([1, 0, 0, 1, (-el.v / 1000) * size * Th, 0], Tm);
        continue;
      }
      if (el.t !== "str" && el.t !== "hex") continue;
      const b = el.v;
      for (let k = 0; k + m.codeLen <= b.length; k += m.codeLen) {
        const code = m.codeLen === 2 ? (b[k] << 8) | b[k + 1] : b[k];
        const w0 = m.width(code);
        const isSpace = m.codeLen === 1 && code === 32;
        const adv = (w0 * size + gs.Tc + (isSpace ? gs.Tw : 0)) * Th;
        const trm = mul(mul([size * Th, 0, 0, size, 0, gs.rise], Tm), gs.ctm);
        const [cx, cy] = apply(trm, w0 / 2, 0.3);
        const r = size && Th ? hitRect(cx, cy) : -1;
        if (r >= 0 && !isSpace) {
          stats[r].count++;
          if (!stats[r].color && gs.fill) stats[r].color = gs.fill.slice();
          pushNum(-(adv / (size * Th)) * 1000);
          changed = true;
        } else if (r >= 0 && isSpace) {
          // A space inside the paragraph goes too (it prints nothing, but it
          // is text a search or a copy would find between the old words).
          pushNum(-(adv / (size * Th)) * 1000);
          changed = true;
        } else {
          for (let j = 0; j < m.codeLen; j++) cur.push(b[k + j]);
        }
        Tm = mul([1, 0, 0, 1, adv, 0], Tm);
      }
    }
    flush();
    return changed ? out : null;
  };
  const tjText = (list) => "[" + list.map((x) => (typeof x === "number" ? fmt(x) : hexOf(x))).join(" ") + "] TJ";

  for (const o of ops) {
    const a = o.args;
    const num = (k) => (a[k] && a[k].t === "num" ? a[k].v : 0);
    switch (o.op) {
      case "q": stack.push({ ...gs, ctm: gs.ctm.slice(), fill: gs.fill ? gs.fill.slice() : null }); break;
      case "Q": if (stack.length) gs = stack.pop(); break;
      case "cm": gs.ctm = mul([num(0), num(1), num(2), num(3), num(4), num(5)], gs.ctm); break;
      case "BT": Tm = [1, 0, 0, 1, 0, 0]; Tlm = [1, 0, 0, 1, 0, 0]; break;
      case "Tf": gs.font = a[0] && a[0].t === "name" ? a[0].v : gs.font; gs.size = num(1); break;
      case "Tc": gs.Tc = num(0); break;
      case "Tw": gs.Tw = num(0); break;
      case "Tz": gs.Th = num(0) / 100; break;
      case "TL": gs.TL = num(0); break;
      case "Ts": gs.rise = num(0); break;
      case "Td": Tlm = mul([1, 0, 0, 1, num(0), num(1)], Tlm); Tm = Tlm.slice(); break;
      case "TD": gs.TL = -num(1); Tlm = mul([1, 0, 0, 1, num(0), num(1)], Tlm); Tm = Tlm.slice(); break;
      case "Tm": Tlm = [num(0), num(1), num(2), num(3), num(4), num(5)]; Tm = Tlm.slice(); break;
      case "T*": nextLine(); break;
      case "g": gs.fill = [num(0), num(0), num(0)]; gs.fillSpace = "DeviceGray"; break;
      case "rg": gs.fill = [num(0), num(1), num(2)]; gs.fillSpace = "DeviceRGB"; break;
      case "k": gs.fill = colorFrom(a, "DeviceCMYK"); gs.fillSpace = "DeviceCMYK"; break;
      case "cs": gs.fillSpace = a[0] && a[0].t === "name" ? a[0].v : ""; gs.fill = null; break;
      case "sc": case "scn": gs.fill = colorFrom(a, gs.fillSpace); break;
      case "Tj": {
        const r = a[0] ? show([a[0]]) : null;
        if (r) edits.push({ start: o.start, end: o.end, text: tjText(r) });
        break;
      }
      case "TJ": {
        const r = a[0] && a[0].t === "arr" ? show(a[0].v) : null;
        if (r) edits.push({ start: o.start, end: o.end, text: tjText(r) });
        break;
      }
      case "'": {
        nextLine();
        const r = a[0] ? show([a[0]]) : null;
        if (r) edits.push({ start: o.start, end: o.end, text: "T* " + tjText(r) });
        break;
      }
      case "\"": {
        gs.Tw = num(0); gs.Tc = num(1);
        nextLine();
        const r = a[2] ? show([a[2]]) : null;
        if (r) edits.push({ start: o.start, end: o.end, text: `${fmt(num(0))} Tw ${fmt(num(1))} Tc T* ${tjText(r)}` });
        break;
      }
      case "Do": {
        if (depth > 6 || !a[0] || a[0].t !== "name") break;
        const xd = resources instanceof PDFDict ? resources.lookup(N("XObject")) : null;
        if (!(xd instanceof PDFDict)) break;
        const xo = xd.lookup(N(a[0].v));
        if (!xo || !xo.dict) break;
        const st = xo.dict.lookup(N("Subtype"));
        if (!st || st.asString() !== "/Form") break;
        const fm = xo.dict.lookup(N("Matrix"));
        const fmat = fm instanceof PDFArray && fm.size() === 6 ? [0, 1, 2, 3, 4, 5].map((k) => numOf(fm.lookup(k)) ?? 0) : [1, 0, 0, 1, 0, 0];
        const own = xo.dict.lookup(N("Resources"));
        const res = own instanceof PDFDict ? own : resources;
        let fbytes;
        try { fbytes = streamBytes(xo); } catch { break; }
        const sub = processStream({ bytes: fbytes, resources: res, ctm: mul(fmat, gs.ctm), gsIn: { ...gs }, context, rects, stats, depth: depth + 1 });
        if (!sub.edits.length && !sub.xobjReplace.size) break;
        const newRes = sub.xobjReplace.size ? withXObjects(res, sub.xobjReplace, context) : res;
        const entries = {};
        for (const [k, v] of xo.dict.entries()) {
          const key = k.asString().slice(1);
          if (key === "Length" || key === "Filter" || key === "DecodeParms") continue;
          entries[key] = v;
        }
        if (newRes !== res || own) entries.Resources = newRes;
        const copy = context.flateStream(applyByteEdits(fbytes, sub.edits), entries);
        xobjReplace.set(a[0].v, context.register(copy));
        break;
      }
      default: break;
    }
  }
  return { edits, xobjReplace };
}

function withXObjects(resources, replace, context) {
  const R = resources instanceof PDFDict ? resources.clone(context) : context.obj({});
  const old = R.lookup(N("XObject"));
  const X = old instanceof PDFDict ? old.clone(context) : context.obj({});
  for (const [name, ref] of replace) X.set(N(name), ref);
  R.set(N("XObject"), X);
  return R;
}

const te = new TextEncoder();
function applyByteEdits(bytes, edits) {
  if (!edits.length) return bytes;
  const parts = [];
  let at = 0;
  for (const e of [...edits].sort((p, q) => p.start - q.start)) {
    parts.push(bytes.subarray(at, e.start), te.encode(e.text));
    at = e.end;
  }
  parts.push(bytes.subarray(at));
  const len = parts.reduce((t, p) => t + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function inheritedResources(page) {
  let node = page.node;
  for (let d = 0; node && d < 32; d++) {
    const r = node.lookup(N("Resources"));
    if (r instanceof PDFDict) return r;
    const parent = node.lookup(N("Parent"));
    node = parent instanceof PDFDict ? parent : null;
  }
  return null;
}

function pageContentBytes(page) {
  const c = page.node.lookup(N("Contents"));
  const list = c instanceof PDFArray ? [...Array(c.size()).keys()].map((k) => c.lookup(k)) : c ? [c] : [];
  const parts = list.map((s) => streamBytes(s));
  const len = parts.reduce((t, p) => t + p.length + 1, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; out[o++] = 10; }
  return out;
}

/**
 * Remove the glyphs inside `rects` from a page. Returns, per rect, { count,
 * color }, and the page's content with them gone (null when none were found).
 */
export function removeGlyphs(doc, page, rects) {
  const context = doc.context;
  const stats = rects.map(() => ({ count: 0, color: null }));
  const resources = inheritedResources(page);
  const bytes = pageContentBytes(page);
  const gs0 = { font: null, size: 0, Tc: 0, Tw: 0, Th: 1, TL: 0, rise: 0, fill: [0, 0, 0], fillSpace: "DeviceGray" };
  const { edits, xobjReplace } = processStream({ bytes, resources, ctm: [1, 0, 0, 1, 0, 0], gsIn: gs0, context, rects, stats, depth: 0 });
  let newResources = resources;
  if (xobjReplace.size) newResources = withXObjects(resources, xobjReplace, context);
  return {
    stats,
    content: edits.length || xobjReplace.size ? applyByteEdits(bytes, edits) : null,
    original: bytes,
    resources: newResources,
  };
}

// ── Writing the new text ─────────────────────────────────────────────────────

/**
 * Apply every text edit of a document. `edits` are the viewer's models:
 * { page (1-based), rect, orig, runs, font, fontSize, lineHeight, indent,
 * align, color, colorAuto }. Returns { covered } — edits whose old text was
 * not found in the page's content (drawn as outlines, or in a form this code
 * could not reach) and was painted over instead.
 */
export async function applyTextEdits(doc, edits) {
  const byPage = new Map();
  for (const e of edits || []) {
    if (!e || !e.orig) continue;
    const i = (e.page || 1) - 1;
    if (i < 0 || i >= doc.getPageCount()) continue;
    if (!byPage.has(i)) byPage.set(i, []);
    byPage.get(i).push(e);
  }
  let covered = 0;
  const fontRefs = new Map();
  const fontFor = async (key) => {
    if (!fontRefs.has(key)) fontRefs.set(key, await doc.embedFont(StandardFonts[key]));
    return fontRefs.get(key);
  };
  const context = doc.context;
  for (const [pi, list] of byPage) {
    const page = doc.getPage(pi);
    const rects = list.map((e) => [e.orig[0] - 0.5, e.orig[1] - 0.5, e.orig[2] + 0.5, e.orig[3] + 0.5]);
    const { stats, content, original, resources } = removeGlyphs(doc, page, rects);

    // This page's own resources: a copy, so a shared dictionary is not
    // changed under the other pages.
    const R = resources instanceof PDFDict ? resources.clone(context) : context.obj({});
    const oldFonts = R.lookup(N("Font"));
    const F = oldFonts instanceof PDFDict ? oldFonts.clone(context) : context.obj({});
    R.set(N("Font"), F);
    const names = new Map();
    const nameFor = async (key) => {
      if (names.has(key)) return names.get(key);
      const font = await fontFor(key);
      let k = 1, name;
      do { name = `PDFVte${k++}`; } while (F.has(N(name)));
      F.set(N(name), font.ref);
      names.set(key, { name, font });
      return names.get(key);
    };

    // The fonts the new text needs, named in this page's resources.
    const layouts = list.map((e) => layoutEdit(e));
    for (let k = 0; k < list.length; k++) {
      for (const line of layouts[k].lines) for (const seg of line.segs) {
        if (seg.text) await nameFor(standardFontKey(list[k].font || "serif", seg));
      }
    }

    let text = "q\n";
    for (let k = 0; k < list.length; k++) {
      if (stats[k].count) continue;
      covered++;
      const [x0, y0, x1, y1] = list[k].orig;
      text += `1 1 1 rg ${fmt(x0)} ${fmt(y0)} ${fmt(x1 - x0)} ${fmt(y1 - y0)} re f\n`;
    }
    text += "BT\n";
    for (let k = 0; k < list.length; k++) {
      const e = list[k];
      const layout = layouts[k];
      if (!layout.lines.some((l) => l.segs.some((sg) => sg.text.trim()))) continue;
      const color = e.colorAuto !== false && stats[k].color ? stats[k].color : (e.color || [0, 0, 0]);
      text += `${color.map((v) => fmt(Math.max(0, Math.min(1, v)))).join(" ")} rg\n`;
      const size = e.fontSize || 12;
      layout.lines.forEach((line, li) => {
        const y = layout.firstBaseline - li * layout.lineHeight;
        const x = e.rect[0] + line.x;
        text += `${fmt(line.wordSpacing)} Tw 1 0 0 1 ${fmt(x)} ${fmt(y)} Tm\n`;
        for (const seg of line.segs) {
          if (!seg.text) continue;
          const { name, font } = names.get(standardFontKey(e.font || "serif", seg));
          const sz = seg.sup ? size * SUP_SCALE : size;
          const enc = font.encodeText(toWinAnsi(seg.text).replace(/\n/g, ""));
          text += `/${name} ${fmt(sz)} Tf ${fmt(seg.sup ? size * SUP_RISE : 0)} Ts ${enc.toString()} Tj\n`;
        }
      });
    }
    text += "ET\nQ\n";
    const body = content || original;
    const head = te.encode("q\n");
    const tail = te.encode("\nQ\n" + text);
    const all = new Uint8Array(head.length + body.length + tail.length);
    all.set(head, 0); all.set(body, head.length); all.set(tail, head.length + body.length);
    const stream = context.flateStream(all);
    page.node.set(N("Contents"), context.register(stream));
    page.node.set(N("Resources"), R);
  }
  return { covered };
}

