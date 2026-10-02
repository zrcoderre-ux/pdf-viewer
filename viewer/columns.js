// columns.js
//
// The columns an export lays out with spaces, laid out. PDF-Linker writes a
// page on a character grid, and a two-column page (a Westlaw printout, a
// caption, a stamp beside the attorney block) keeps its second column apart
// with a run of spaces: the column is where it is because of how many spaces
// stand before it. That is a layout only in a monospace font (textdoc.js,
// "columns laid out with spaces"). In the reader's own font every run of
// spaces drew at half the width the grid meant it to, so the right-hand column
// began wherever the left-hand text on that line happened to end — a ragged
// edge where the page has a straight one — and the indents and the centred
// headings all drew at half their depth.
//
// So each line is cut where its spaces lay it out (textdoc.columnCuts), and
// the grid's character is the reader font's own average one (--col-n ems,
// from charWidth; --col-sp-n is the font's space), measured in the page's
// body type so a line set in a smaller size keeps the page's columns:
//
//   .lt.ci  an indented line: its text stands --ind grid characters in from
//           the body margin. The --lead spaces it opens with stay as they
//           are and a text-indent makes up the rest — no element, since most
//           indented lines are nothing else and it costs the layout nothing.
//           On pleading paper a numbered line's spaces belong to its number
//           and are drawn in the margin (none of them is the line's), so its
//           indent is all text-indent: the centred heading, the "Plaintiff,"
//           under the party's name, the caption's right-hand column on a
//           number of its own, each where the export set it.
//   .cc     a piece of a line before a gap between columns — its text and
//           the gap — drawn at least as wide as the characters it spans on
//           the grid (--cols of them). The column after it then begins at its
//           own column on every line, and a piece too wide for its cell —
//           capitals run wide — pushes the rest of ITS line on rather than
//           run into it.
//   .cg     the gap's own spaces, the last thing in a cell. The cell's width
//           spaces the columns, so out of the editor these take no room: a
//           piece too wide for its cell is followed by the cell's margin, two
//           characters, not by every space the grid gave it as well. In the
//           editor they are drawn, so what is typed into one is seen.
//
// The cells are wrappers and nothing else: the text, the pseudonym spans and
// the rule spans are inside them as they were, so serializeNodes, a copy and
// every offset into the page read exactly what they did. On the PDF's grid
// (side by side) pleading paper keeps its columns, measured in the PDF's own
// body type at the grid's scale, since every line there starts at the body
// margin; a page with no numbers places each line at its PDF row's own left,
// and the cells are inert on it.
// Like the rule spans they are re-derived on every pass — but a line already
// dressed as its text says is left exactly as it is, so the editor's caret
// text node on any other line is never replaced.

import { columnCuts, columnStops, columnWidths, hasFirmColumn, lineIndent, serializeNodes } from "./textdoc.js";

/** A node's length in the file: a pseudonym span counts its fake, as the cuts were made on. */
const fileLength = (n) => (n.nodeType === 3 ? n.data.length : n.nodeType === 1 ? serializeNodes(n).length : 0);

/**
 * Where a line's spans stand in the file, [from, to) each: a pseudonym, a
 * spot keep. A line is split between columns only in its text nodes
 * (splitAt), so these are the stretches no cut may fall inside. A line dressed
 * already is read through its cells.
 */
function spanRanges(lt) {
  const out = [];
  let off = 0;
  const visit = (parent) => {
    for (const n of parent.childNodes) {
      if (n.nodeType === 1 && (n.classList.contains("cc") || n.classList.contains("cg"))) { visit(n); continue; }
      const len = fileLength(n);
      if (n.nodeType === 1 && len) out.push([off, off + len]);
      off += len;
    }
  };
  visit(lt);
  return out;
}

/** The cells and the indent taken back off a line. */
export function undressColumns(lt) {
  for (const c of [...lt.querySelectorAll(".cc, .cg")]) c.replaceWith(...c.childNodes);
  if (lt.classList.contains("ci")) { lt.classList.remove("ci"); lt.style.removeProperty("--lead"); lt.style.removeProperty("--ind"); }
}
const indentOf = (lt) => (lt.classList.contains("ci") ? lt.style.getPropertyValue("--ind") + "/" + lt.style.getPropertyValue("--lead") : "");

/**
 * Whether the line is already dressed as `shape` says: the same indent, and
 * the same cells — each where it should start, as long, as wide, its gap the
 * spaces it should be — one after the other.
 */
function dressedAs(lt, { ind, lead, cuts, widths, gaps }) {
  if (indentOf(lt) !== (ind || lead ? ind + "/" + lead : "")) return false;
  if (lt.querySelectorAll(".cc").length !== cuts.length || lt.querySelectorAll(".cg").length !== cuts.length) return false;
  let off = 0, k = 0;
  for (const n of lt.childNodes) {
    const isCell = n.nodeType === 1 && n.classList.contains("cc");
    if (!isCell) {
      if (k > 0 && k < cuts.length) return false; // something between two cells
      off += fileLength(n);
      continue;
    }
    if (k >= cuts.length || off !== (k ? cuts[k - 1] : lead) || n.style.getPropertyValue("--cols") !== String(widths[k])) return false;
    const g = n.lastChild;
    if (!g || g.nodeType !== 1 || !g.classList.contains("cg") || g.textContent !== " ".repeat(cuts[k] - gaps[k])) return false;
    off += fileLength(n);
    if (off !== cuts[k]) return false;
    k++;
  }
  return k === cuts.length;
}

/**
 * A line's nodes split at `marks` (file offsets, ascending): one list of
 * nodes per stretch between them, the last running to the line's end. A mark
 * falls in a run of spaces, so in a text node, which is split there; one
 * inside a span (it never should) moves to the span's end.
 */
function splitAt(lt, marks) {
  const out = marks.map(() => []).concat([[]]);
  let k = 0, off = 0;
  for (let n of [...lt.childNodes]) {
    let len = fileLength(n);
    for (;;) {
      while (k < marks.length && marks[k] <= off) k++; // a mark at a node's start: the node is past it
      if (k === marks.length || n.nodeType !== 3 || marks[k] >= off + len) break;
      const tail = n.splitText(marks[k] - off);
      out[k].push(n);
      len -= marks[k] - off;
      off = marks[k];
      n = tail;
    }
    out[k].push(n);
    off += len;
  }
  return out;
}

/**
 * A line dressed as `shape` says: { ind, how many grid characters its text
 * stands in from the body margin; lead, the spaces its text opens with, which
 * stay where they are and are made up to that depth; cuts, the file offsets
 * at which each column after a gap begins; widths, each cell's width in
 * characters; gaps, where each cell's gap begins }. Returns whether it
 * changed anything.
 */
export function dressLineColumns(lt, shape) {
  if (dressedAs(lt, shape)) return false;
  undressColumns(lt);
  const { ind, lead, cuts, widths, gaps } = shape;
  if (ind || lead) { lt.classList.add("ci"); lt.style.setProperty("--ind", String(ind)); lt.style.setProperty("--lead", String(lead)); }
  if (!cuts.length) return true;
  const marks = [];
  if (lead) marks.push(lead);
  cuts.forEach((c, i) => { marks.push(gaps[i], c); });
  const parts = splitAt(lt, marks);
  const out = [];
  let p = 0;
  if (lead) out.push(...parts[p++]);
  cuts.forEach((c, i) => {
    const cell = document.createElement("span");
    cell.className = "cc";
    cell.style.setProperty("--cols", String(widths[i]));
    cell.append(...parts[p++]);
    const gap = document.createElement("span");
    gap.className = "cg";
    gap.append(...parts[p++]);
    cell.appendChild(gap);
    out.push(cell);
  });
  out.push(...parts[p]);
  lt.replaceChildren(...out);
  return true;
}

/**
 * Every line of a page body cut into its columns. A line that is a row of a
 * drawn box (.rl) is the box's (rules.js) and is left alone. On pleading paper
 * the margin number and the spaces after it are drawn in the margin, so the
 * grid is counted from the body margin there (`origin`, the narrowest
 * number's width) and each line is indented by where its text stands from
 * it. Returns whether any line was dressed afresh — whose text nodes may have
 * moved, so a caret or a range in it is to be put back by its place in the
 * text.
 */
export function dressColumns(body) {
  const numbered = body.classList.contains("numbered");
  let changed = false;
  const all = [];
  let origin = Infinity;
  for (const line of body.querySelectorAll(":scope > .line")) {
    const lt = line.querySelector(":scope > .lt");
    if (!lt) continue;
    if (line.classList.contains("rl")) {
      if (lt.querySelector(".cc") || lt.classList.contains("ci")) { undressColumns(lt); changed = true; }
      line.classList.remove("cols");
      continue;
    }
    const g = numbered && line.classList.contains("num") ? line.querySelector(":scope > .gutter") : null;
    const start = g ? g.textContent.length : 0;
    const shown = lt.textContent;
    if (g && shown.trim()) origin = Math.min(origin, start);
    all.push({ line, lt, start, shown });
  }
  if (!numbered || origin === Infinity) origin = 0;
  const lines = [], plain = [];
  for (const l of all) {
    // Most lines have no run of spaces and no indent — a pleading's body, a
    // letter — and are passed over on what they show: a name on screen is no
    // more a run of spaces than the fake it stands for. One dressed before is
    // dressed again.
    if (!l.shown.includes("  ") && l.shown[0] !== " " && !(l.start > origin && l.shown.trim()) && !l.lt.querySelector(".cc") && !l.lt.classList.contains("ci")) {
      plain.push(l);
      continue;
    }
    l.text = serializeNodes(l.lt);
    lines.push(l);
  }
  const stops = columnStops(lines);
  // …unless the page has a second column, which a line's left-hand half can
  // run right up to with a single space between: then every line is read.
  if (plain.length && hasFirmColumn(stops)) for (const l of plain.splice(0)) { l.text = serializeNodes(l.lt); lines.push(l); }
  for (const l of plain) l.line.classList.remove("cols");
  for (const l of lines) {
    const { ind, lead } = lineIndent(l.text, { start: l.start, origin });
    const cuts = columnCuts(l.text, { stops, start: l.start, atoms: spanRanges(l.lt) });
    const gaps = cuts.map((c) => l.text.slice(0, c).replace(/ +$/, "").length);
    if (dressLineColumns(l.lt, { ind, lead, cuts, widths: columnWidths(cuts, lead), gaps })) changed = true;
    // A line with a gap between columns, not just an indent: what the page's
    // type has to be small enough to hold on one line (text-reader.js,
    // shapePages), since a column that wraps comes back at the left margin.
    l.line.classList.toggle("cols", cuts.length > 0);
  }
  return changed;
}

/** The narrowest a piece before a column is drawn to hold its column (fitCells): three quarters of its width still reads. */
export const CELL_SQUEEZE_MIN = 0.75;

/**
 * Side by side, each piece before a column held to its cell on the grid
 * (text-reader.js, applyMatchedLayout), so the column after it stands where
 * the PDF prints it.
 *
 * ONLY WHERE IT WOULD RUN INTO SOMETHING. The cell's two characters of margin
 * are not a boundary; the next column's text, which begins at the cell's
 * edge, is. A piece that fits in the blank before that text with a space to
 * spare is drawn at its own width across the margin, and nothing moves. One
 * that does not is squeezed across into that blank — but no narrower than
 * CELL_SQUEEZE_MIN. The grid is the FILE's, so a cell is as wide as the fakes
 * in it, and a real name twice its fake's length squeezed into the fake's
 * room is letters drawn on top of one another. Past that the piece is drawn
 * at the narrowest that still reads and takes the room it needs, a space
 * short of its column, which it pushes: reading the words beats lining them
 * up.
 *
 * Every cell let out to its own width first, every cell read, then every one
 * written, so the page is laid out once whatever the number of cells.
 */
export function fitCells(cells) {
  const xs = [...cells].map((c) => ({ c }));
  for (const x of xs) if (x.c.style.width || x.c.style.transform) { x.c.style.width = ""; x.c.style.transform = ""; x.c.style.transformOrigin = ""; }
  for (const x of xs) {
    const cs = getComputedStyle(x.c);
    x.min = parseFloat(cs.minWidth) || 0;
    x.pad = parseFloat(cs.paddingRight) || 0;
    x.space = (parseFloat(cs.getPropertyValue("--col-sp-n")) || 0.25) * (parseFloat(cs.fontSize) || 0);
    x.w = x.c.offsetWidth;
  }
  for (const x of xs) {
    if (!(x.min > x.pad) || x.w <= x.min + 0.5) continue;
    const text = x.w - x.pad; // the piece's own width, without the margin
    const room = x.min - x.space; // up to the next column's text, a space short of it
    if (text <= room) { x.c.style.width = x.min + "px"; continue; } // fits: drawn as it is, the column held
    const fit = Math.max(CELL_SQUEEZE_MIN, room / text);
    x.c.style.width = Math.max(x.min, text * fit + x.space) + "px";
    x.c.style.transform = `scaleX(${fit.toFixed(4)})`;
    x.c.style.transformOrigin = "0 0";
  }
}

// A stretch of the kind of text a filing is made of, to take the font's
// average character from: the width a grid of N characters is drawn at.
const SAMPLE = "The Court has read the moving papers, the opposition and the reply. Defendants’ motion to compel "
  + "arbitration under 9 U.S.C. §§ 401-02 is DENIED; Plaintiff BARBARA DELO, No. 22-cv-9416 (RA), may proceed.";
let measurer = null;
/** `fontCss`'s average character and its space, in em: { char, space }. */
export function charWidth(fontCss) {
  try {
    measurer = measurer || document.createElement("canvas").getContext("2d");
    measurer.font = "100px " + fontCss;
    const char = measurer.measureText(SAMPLE).width / SAMPLE.length / 100;
    const space = measurer.measureText("          ").width / 10 / 100;
    if (!(char > 0.2 && char < 1.2)) return { char: 0.5, space: 0.25 };
    return { char, space: space > 0 && space <= char ? space : char / 2 };
  } catch {
    return { char: 0.5, space: 0.25 };
  }
}
