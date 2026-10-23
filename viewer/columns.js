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
//   .cx     a cell or a line beside a SECOND column, placed for the font
//           (alignColumns): off the PDF's grid the column stands at one place
//           down every line beside it, a gutter clear of the widest text to
//           its left, however far past the grid that text runs.
//   .cb     a form's checkbox mark, one piece, drawn as a box over its own
//           characters (dressCheckboxes).
//   .fc     a run of a line beside its PDF set in a face of the PDF's that is
//           not the line's — bold, italic, on a form a piece's own family —
//           inside whatever holds the run (faceLine; pdfsync.faceRuns).
//
// The cells are wrappers and nothing else: the text, the pseudonym spans and
// the rule spans are inside them as they were, so serializeNodes, a copy and
// every offset into the page read exactly what they did. On the PDF's grid
// (side by side) pleading paper keeps its columns, measured in the PDF's own
// body type at the grid's scale, since every line there starts at the body
// margin; a page with no numbers is cut wherever one of its PDF's items begins
// as well, and each piece set where the PDF prints it, at its size and in its
// face (placeLine; text-reader.js, placePages). Every matched page, numbered
// or not, draws each run of its text in the PDF's weight and slant (faceLine).
// Like the rule spans they are re-derived on every pass — but a line already
// dressed as its text says is left exactly as it is, so the editor's caret
// text node on any other line is never replaced.

import { checkboxRanges, checkboxState, columnBands, columnCuts, columnWidths, lineIndent, placeColumns, serializeNodes, COLUMN_GUTTER } from "./textdoc.js";

/** A node's length in the file: a pseudonym span counts its fake, as the cuts were made on. */
const fileLength = (n) => (n.nodeType === 3 ? n.data.length : n.nodeType === 1 ? serializeNodes(n).length : 0);

// ---- a form's checkboxes, drawn ----------------------------------------------
//
// PDF-Linker writes a form's checkbox as "[   ]", "[ X ]" or "[ ? ]" ("[ ]",
// "[X]", "[?]" in older exports; textdoc.checkboxRanges). In the reader's font
// that was two brackets with a gap between them — and the empty one's three
// spaces were a gap between columns, so the page's columns cut it in half: a
// "[" closing one cell and a "]" opening the next. Each mark is wrapped in a
// span (.cb, its state in data-cb: "x" ticked, "?" unread, none empty) that
// the stylesheet draws as a small square at the line's own type size, a mark
// in it for X and for ?, over the mark's own text, which stays underneath
// unseen — so the box takes exactly the room its text does, and every width
// worked out from the text (the cells, placeColumns, a prefix side by side)
// is the box's. Like the rule spans it carries no data-fake and no
// contenteditable: serializeNodes, a copy, Find, the LEAKS walk and every
// offset read the mark's characters as they always did, and in the editor the
// mark is drawn as the text it is, to be typed into. Re-derived on every pass:
// a span whose text an edit has made something else is text again.
const BOX_INSIDE = ".cb, .pn, [data-here], .rb, .rh";
/** Text nodes of a line a mark may be wrapped in: not a mark already, a pseudonym, a spot keep or a rule glyph. */
function boxableTexts(lt) {
  const out = [];
  const visit = (parent) => {
    for (const n of parent.childNodes) {
      if (n.nodeType === 3) { if (n.data.includes("[")) out.push(n); continue; }
      if (n.nodeType === 1 && !n.matches(BOX_INSIDE)) visit(n);
    }
  };
  visit(lt);
  return out;
}
/** A line's checkbox marks wrapped as boxes (.cb). Returns whether it changed anything. */
export function dressCheckboxes(lt) {
  const had = lt.querySelectorAll(".cb");
  if (!had.length && !lt.textContent.includes("[")) return false;
  let changed = false;
  for (const c of had) {
    const state = checkboxState(c.textContent);
    if (state == null || (c.parentElement && c.parentElement.closest(".pn, [data-here]"))) { c.replaceWith(...c.childNodes); changed = true; continue; }
    if ((c.getAttribute("data-cb") || "") !== state) {
      if (state) c.setAttribute("data-cb", state); else c.removeAttribute("data-cb");
      changed = true;
    }
  }
  for (const n of boxableTexts(lt)) {
    const marks = checkboxRanges(n.data);
    // From the right, so the offsets of the marks before each one hold.
    for (let r = marks.length - 1; r >= 0; r--) {
      const [a, b, state] = marks[r];
      if (b < n.data.length) n.splitText(b);
      const mark = a > 0 ? n.splitText(a) : n;
      const box = document.createElement("span");
      box.className = "cb";
      if (state) box.setAttribute("data-cb", state);
      mark.replaceWith(box);
      box.appendChild(mark);
      changed = true;
    }
  }
  return changed;
}

/**
 * A line as it reads on screen against the file it writes: `fileAt(d)`, the
 * offset in the file of place d in what it shows (-1 inside a pseudonym or a
 * spot keep, whose real name has no place in its fake), and those stretches
 * (`atoms`, [from, to) in what it shows). The PDF prints what the page shows;
 * the cells are cut in the file.
 */
export function lineMap(lt) {
  const atoms = [];
  const fakes = []; // [shown from, file from] of each stretch whose file text is not what it shows
  let d = 0, f = 0;
  const visit = (parent) => {
    for (const n of parent.childNodes) {
      if (n.nodeType === 3) { d += n.data.length; f += n.data.length; continue; }
      if (n.nodeType !== 1 || n.nodeName === "BR") continue;
      const fake = n.getAttribute("data-fake");
      if (fake != null || n.hasAttribute("data-here")) {
        const shown = n.textContent.length;
        atoms.push([d, d + shown]);
        fakes.push([d, f, d + shown, f + (fake != null ? fake.length : serializeNodes(n).length)]);
        d += shown;
        f = fakes[fakes.length - 1][3];
        continue;
      }
      visit(n);
    }
  };
  visit(lt);
  const fileAt = (at) => {
    let dd = 0, ff = 0; // the last stretch's end, shown and in the file
    for (const [ds, fs, de, fe] of fakes) {
      if (at < ds) break;
      if (at === ds) return fs;
      if (at < de) return -1;
      dd = de; ff = fe;
    }
    return at <= d ? ff + (at - dd) : -1;
  };
  return { fileAt, atoms };
}

/**
 * Where a line's spans stand in the file, [from, to) each: a pseudonym, a
 * spot keep. A line is split between columns only in its text nodes
 * (splitAt), so these are the stretches no cut may fall inside. A line dressed
 * already is read through its cells, and a faced one through its runs' wrappers.
 */
function spanRanges(lt) {
  const out = [];
  let off = 0;
  const visit = (parent) => {
    for (const n of parent.childNodes) {
      if (n.nodeType === 1 && (n.classList.contains("cc") || n.classList.contains("cg") || n.classList.contains("fc"))) { visit(n); continue; }
      const len = fileLength(n);
      if (n.nodeType === 1 && len) out.push([off, off + len]);
      off += len;
    }
  };
  visit(lt);
  return out;
}

/** The cells and the indent taken back off a line — and its runs' face wrappers, since a line is cut in its top-level text nodes (splitAt); placeLine puts the faces back after. */
export function undressColumns(lt) {
  unfaceLine(lt);
  for (const c of [...lt.querySelectorAll(".cc, .cg")]) c.replaceWith(...c.childNodes);
  if (lt.classList.contains("ci")) { lt.classList.remove("ci"); lt.style.removeProperty("--lead"); lt.style.removeProperty("--ind"); }
  unplace(lt);
  lt.__colPlan = null;
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
    cell.__at = i ? cuts[i - 1] : lead; // where its piece begins in the file (text-reader.js, placeCells)
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
  const all = [], boxes = [];
  let origin = Infinity;
  let count = 0; // every line of the page, a box row too: how far apart lines are
  for (const line of body.querySelectorAll(":scope > .line")) {
    const at = count++;
    const lt = line.querySelector(":scope > .lt");
    if (!lt) continue;
    // A checkbox is one thing: wrapped before anything is cut, so no cut can
    // fall inside it (spanRanges reads it as one).
    if (dressCheckboxes(lt)) changed = true;
    const g = numbered && line.classList.contains("num") ? line.querySelector(":scope > .gutter") : null;
    const start = g ? g.textContent.length : 0;
    const shown = lt.textContent;
    if (g && shown.trim()) origin = Math.min(origin, start);
    if (line.classList.contains("rl")) {
      if (lt.querySelector(".cc") || lt.classList.contains("ci")) { undressColumns(lt); changed = true; }
      line.classList.remove("cols");
      lt.__colPlan = null;
      boxes.push({ lt, start });
      continue;
    }
    all.push({ line, lt, start, shown, at });
  }
  if (!numbered || origin === Infinity) origin = 0;
  // A box row is the box's (rules.js) and is not cut into columns, but its
  // first cell stands where the export indents it all the same.
  for (const b of boxes) indentBoxRow(b.lt, lineIndent(serializeNodes(b.lt), { start: b.start, origin }));
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
  // The columns each line stands in: where the lines around it begin, for as
  // far down the page as they run (textdoc.columnBands). A plain line begins
  // none, but still stands between the lines that do.
  const page = Array.from({ length: count }, () => ({ text: "" }));
  for (const l of lines) page[l.at] = { text: l.text, start: l.start };
  const bands = columnBands(page);
  // …and a plain line is read after all where it stands beside a second
  // column, which its left-hand half can run right up to with a single space
  // between. Only there: a form's column down its caption says nothing about
  // the prose under it. And where the PDF's grid cuts it (gridCuts, below).
  for (const l of plain) {
    if (bands[l.at].second.size || l.lt.__grid) { l.text = serializeNodes(l.lt); lines.push(l); }
    else { l.line.classList.remove("cols"); l.lt.__colPlan = null; }
  }
  for (const l of lines) {
    const { ind, lead } = lineIndent(l.text, { start: l.start, origin });
    const { stops, second } = bands[l.at];
    const atoms = spanRanges(l.lt);
    const own = columnCuts(l.text, { stops, second, start: l.start, atoms });
    const cuts = gridCuts(l.lt, l.text, own, atoms, lead);
    const gaps = cuts.map((c) => l.text.slice(0, c).replace(/ +$/, "").length);
    if (dressLineColumns(l.lt, { ind, lead, cuts, widths: columnWidths(cuts, lead), gaps })) changed = true;
    // What alignColumns needs to place the line's second columns, in the
    // page's own columns: where its text begins and each piece after a gap.
    // Not for a line the PDF's grid has cut as well: that is a page laid on
    // its PDF, where alignColumns has nothing to place.
    // …nor for a line the operator has set by hand on a ✓ Use my text page
    // (text-reader.js, markOwnLines: `.own`): its spaces say where its columns
    // stand, and nothing moves them for the font.
    l.lt.__colPlan = second.size && cuts === own && !l.line.classList.contains("own") ? { from: l.start + lead, cuts: cuts.map((c) => l.start + c), second, origin } : null;
    // A line with a gap between columns, not just an indent: what the page's
    // type has to be small enough to hold on one line (text-reader.js,
    // shapePages), since a column that wraps comes back at the left margin.
    l.line.classList.toggle("cols", own.length > 0);
  }
  // …and each second column placed for the font the page is read in.
  alignColumns([body]);
  return changed;
}

/**
 * A line's cuts with the PDF's own added: beside its PDF page a line is cut
 * wherever one of the PDF's items begins (text-reader.js, applyMatchedLayout,
 * which writes them on the line as `__grid`, { text, cuts }), so that each
 * piece can stand where the PDF prints it — a piece the export joins to the
 * one before with a single space as well as one three spaces off. Only while
 * the line is the text they were worked out for, never inside a pseudonym, a
 * spot keep or a checkbox, and never before the line's own text or at its
 * end. Returns `own` itself where nothing is added.
 */
function gridCuts(lt, text, own, atoms, lead) {
  const g = lt.__grid;
  if (!g || g.text !== text || !g.cuts.length) return own;
  const whole = atoms.concat(checkboxRanges(text));
  const all = new Set(own);
  for (const c of g.cuts) {
    if (c > lead && c < text.length && text[c] !== " " && !whole.some(([a, b]) => c > a && c < b)) all.add(c);
  }
  return all.size === own.length ? own : [...all].sort((a, b) => a - b);
}

/**
 * A box row's first cell set where the export indents its text: `ind` grid
 * characters in from the body margin, the `lead` spaces it opens with (an
 * unnumbered row's, which it draws) taken back off, as an indented line's
 * text-indent does. A numbered row's spaces are its number's and kept out of
 * the layout with it, so its text stood flush against the side of the box —
 * "Plaintiff," under the party's name, "vs.", "Defendants." — however far in
 * the caption set them. The cell itself carries it (--ind and --lead, .ci): a
 * row's cells are made afresh on every pass (rules.js), and this runs after.
 */
function indentBoxRow(lt, { ind, lead }) {
  const cell = lt.firstElementChild;
  if (!cell || !cell.classList.contains("rc")) return;
  const want = ind || lead ? ind + "/" + lead : "";
  const had = cell.classList.contains("ci") ? cell.style.getPropertyValue("--ind") + "/" + cell.style.getPropertyValue("--lead") : "";
  if (want === had) return;
  if (!want) { cell.classList.remove("ci"); cell.style.removeProperty("--ind"); cell.style.removeProperty("--lead"); return; }
  cell.classList.add("ci");
  cell.style.setProperty("--ind", String(ind));
  cell.style.setProperty("--lead", String(lead));
}

/** A place alignColumns wrote taken back off: the line or cell is on the plain grid again. */
function unplace(el) {
  if (!el.classList.contains("cx")) return;
  el.classList.remove("cx");
  el.style.removeProperty("--cx");
  el.style.removeProperty("--ind-x");
}
function put(el, name, value) {
  const v = value.toFixed(3);
  if (el.style.getPropertyValue(name) !== v) el.style.setProperty(name, v);
  if (!el.classList.contains("cx")) el.classList.add("cx");
}

// A piece's width in ems of its font, read off the font's own metrics on a
// canvas: the same widths the page draws it at, and no layout asked for.
// Kept per FONT — the face, and its weight and slant in front of it ("italic
// 700 " + the family list) — since a page beside its PDF is drawn in the PDF's
// faces as well as the reader's own (pdfsync.pdfFace), and a width kept for
// one face and read back for another is a column in the wrong place. A
// page's pieces are mostly the same lines over and over.
let sizer = null, sizerFont = null;
const sizedBy = new Map(); // font → Map(text → width in em)
let sizedCount = 0;
function textEm(text, font, style = "") {
  const key = style + font;
  let sized = sizedBy.get(key);
  if (!sized) {
    if (sizedCount >= 50000) { sizedBy.clear(); sizedCount = 0; }
    sized = new Map();
    sizedBy.set(key, sized);
  }
  let w = sized.get(text);
  if (w == null) {
    sizer = sizer || document.createElement("canvas").getContext("2d");
    if (sizerFont !== key) { sizer.font = style + "100px " + font; sizerFont = key; }
    w = sizer.measureText(text).width / 100;
    sized.set(text, w);
    sizedCount++;
  }
  return w;
}
/** A face's CSS weight and slant as the canvas font shorthand puts them in front of the size. */
const faceStyle = (face) => (face ? (face.italic ? "italic " : "") + (face.bold ? "700 " : "") : "");
/** `text`'s width in ems of `face` (pdfsync.pdfFace: { family, bold, italic }). */
export function faceEm(text, face) { return textEm(text, face.family, faceStyle(face)); }
/** …and the face's own space, in ems: what a line's opening spaces are drawn at in it. */
export function faceSpace(face) { return textEm("          ", face.family, faceStyle(face)) / 10; }
/** A cell's text as the page shows it: a pseudonym as it reads, the gap's spaces left out. */
function pieceText(cell) {
  let s = "";
  for (const n of cell.childNodes) if (!(n.nodeType === 1 && n.classList.contains("cg"))) s += n.textContent;
  return s;
}

/**
 * Off the PDF's grid, each SECOND column placed where the reader's own font
 * needs it (textdoc.placeColumns): one place down every line beside it, clear
 * of the widest text to its left by a gutter. The grid's character is the
 * font's AVERAGE one, and a line's letters are not average: a justified
 * left-hand column runs up to the second with a space between, and a page in
 * capitals runs half as wide again, so each line's piece overran its cell by
 * its own amount and pushed its own right-hand half on by that much — a
 * column ragged by a word, run into the one beside it.
 *
 * Each piece is measured as it reads (a name as it is shown) in the page's
 * font, at its line's own size where the PDF set it apart, and the places are
 * written in the page's BODY type — --cx on a cell, its width; --ind-x on an
 * indented line, where its text begins — so the type fitted to the paper
 * afterwards takes them with it. The widths come off the font itself, not
 * the layout, so a page is placed as it is dressed (dressColumns) and again
 * when it is laid out (text-reader.js, shapePages: the names shown, a line's
 * size) at no cost to either. A line or cell placed before and not now is put
 * back on the grid. Nothing here touches the text.
 */
export function alignColumns(bodies) {
  // The grid's character and the reader's font as text-reader.js writes them
  // on the root (setColumnWidth, applySettings): read off its own style, so
  // placing a page asks for no style to be worked out.
  const rs = document.documentElement.style;
  const colN = parseFloat(rs.getPropertyValue("--col-n")) || 0.5;
  const readerFont = rs.getPropertyValue("--reader-font").trim();
  for (const body of bodies) {
    if (!body || body.classList.contains("fixed")) continue;
    const rows = [];
    for (const lt of body.querySelectorAll(":scope > .line > .lt")) {
      const plan = lt.__colPlan;
      if (!plan) continue;
      const cells = [...lt.children].filter((c) => c.classList.contains("cc"));
      if (cells.length === plan.cuts.length) rows.push({ lt, plan, cells });
    }
    const placed = body.querySelectorAll(".cx");
    if (!rows.length && !placed.length) continue;
    const keep = new Set();
    if (rows.length) {
      const font = readerFont || (body.isConnected && getComputedStyle(body).fontFamily) || "serif";
      const places = placeColumns(rows.map((r) => {
        const size = r.lt.parentElement.style.fontSize; // a line the PDF sets apart, in ems of the body
        const f = /em$/.test(size) ? parseFloat(size) || 1 : 1;
        return Object.assign({}, r.plan, { w: r.cells.map((c) => textEm(pieceText(c), font) * f) });
      }), { unit: colN, gutter: COLUMN_GUTTER * colN, pad: 2 * colN });
      rows.forEach((r, k) => {
        const p = places[k];
        if (!p) return;
        if (r.lt.classList.contains("ci")) { put(r.lt, "--ind-x", p.ind); keep.add(r.lt); }
        let from = p.ind;
        r.cells.forEach((c, j) => { put(c, "--cx", p.ends[j] - from); keep.add(c); from = p.ends[j]; });
      });
    }
    for (const el of placed) if (!keep.has(el)) unplace(el);
  }
}

/**
 * A face (pdfsync.pdfFace) written on an element, or taken off it: its family,
 * weight and slant, and its space for the cells' sums. A face with no family
 * (a numbered page's: the PDF's weight and slant in the reader's own type,
 * planCells) sets the weight and slant alone — a regular one explicitly, so a
 * regular run inside a bold line reads regular.
 */
function putFace(el, face) {
  const key = face ? "f:" + faceStyle(face) + (face.em ? face.em + "em" : "") + (face.family || "") : "";
  if ((el.__face || "") === key) return;
  el.__face = key;
  const s = el.style;
  // (A run's own size, in its line's: pdfsync.faceRuns' `em`. Taken off only
  // where it was put on, since a placed cell sets its size itself.)
  if (face && face.em) { s.fontSize = face.em + "em"; el.__em = true; }
  else if (el.__em) { s.removeProperty("font-size"); el.__em = false; }
  if (!face) { for (const p of ["font-family", "font-weight", "font-style", "--col-sp-n"]) s.removeProperty(p); return; }
  if (face.family) {
    s.fontFamily = face.family;
    s.setProperty("--col-sp-n", faceSpace(face).toFixed(4));
  } else {
    s.removeProperty("font-family");
    s.removeProperty("--col-sp-n");
  }
  s.fontWeight = face.bold ? "700" : "400";
  s.fontStyle = face.italic ? "italic" : "normal";
}
const sameFace = (a, b) => (a ? faceStyle(a) + (a.em || "") + (a.family || "") : "") === (b ? faceStyle(b) + (b.em || "") + (b.family || "") : "");

/**
 * Side by side, a line's pieces each where its PDF prints them, at the size
 * and in the face the PDF prints them in (text-reader.js, applyMatchedLayout,
 * which finds them: pdfsync.lineItems). `spec`:
 *
 *   places   Map(file offset → { x, size, face }): the pieces the PDF placed,
 *            by where each begins in the file — x in px across the page, the
 *            line's own coordinates; size in px, null for the line's own; face
 *            null for the line's own.
 *   start    where the line's text begins, in px (its first piece's place).
 *   at       (offset, x, from) → where a piece the PDF did not place begins:
 *            the grid's place (x and from are where the piece before it
 *            begins, for a grid that runs on from there).
 *   face     the face of the row the line was matched to (planCells: the one
 *            most of the line is set in; on a numbered page one with no
 *            family, the reader's own type keeping its weight and slant).
 *   runs     the runs of the line set in faces of their own (pdfsync.faceRuns,
 *            file offsets), drawn by faceLine; null to leave the line's
 *            wrappers as they are (an input method is composing on the page).
 *
 * With no `start` (a numbered page) nothing is placed: the cells keep the
 * grid's own widths, and the line takes its face and its runs alone.
 *   size     the line's type in px.
 *   lead     where the line's text begins in the file (its one piece, where
 *            it has no cells).
 *   cellFaces  a box row's: each of its cells' faces (rules.js, .rc), null
 *            for the row's own.
 *
 * Each cell (.cc) is given the width that puts the piece after it at its
 * place (min-width, so fitCells still squeezes a piece too wide for it), and
 * its own size where it is not the line's. The piece after the last cut is
 * no cell: its size is the LINE's — so the line takes it (on its .lt; its
 * box, which the leading is worked out from, stays the row's), and a cell
 * that differs says so. The faces are the runs' (faceLine), the line's own on
 * its .lt and each run set otherwise in a wrapper of its own — a cell, which
 * is cut only where the export has a space, could not carry a face that
 * changes mid-word, and a numbered line, which is never cut at the PDF's
 * items, could carry none. Written only where it changes. Returns whether
 * facing the runs moved any text node (the caller puts the caret back by its
 * offset).
 */
export function placeLine(lt, spec) {
  lt.__placed = true;
  const cells = [];
  for (const c of lt.children) if (c.classList.contains("cc")) cells.push(c);
  const last = cells[cells.length - 1];
  const lead = cells.length ? cells[0].__at : null;
  const tailAt = last ? last.__at + fileLength(last) : null;
  const places = spec.places || new Map();
  const tail = (cells.length ? places.get(tailAt) : places.get(spec.lead)) || null;
  const face = spec.face || null;
  const size = tail && tail.size ? tail.size : spec.size;
  putFace(lt, face);
  const sz = size !== spec.size ? size.toFixed(2) + "px" : "";
  if (lt.style.fontSize !== sz) lt.style.fontSize = sz;
  // A box row's cells between its bars, each in its own face where it is not
  // the row's (rules.js makes the cells afresh on every pass, so a run's
  // wrapper inside one would not last; the cell carries the face).
  if (spec.cellFaces) {
    let i = 0;
    for (const c of lt.children) {
      if (!c.classList.contains("rc")) continue;
      const f = spec.cellFaces[i++];
      putFace(c, f && !sameFace(f, face) ? f : null);
    }
  }
  if (spec.start != null) {
    let x = spec.start, from = lead;
    cells.forEach((c, i) => {
      const own = places.get(c.__at) || null;
      const nextAt = i + 1 < cells.length ? cells[i + 1].__at : tailAt;
      const placed = places.get(nextAt);
      const next = placed ? placed.x : spec.at(nextAt, x, from);
      const want = next - x > 0.5 ? (next - x).toFixed(2) + "px" : "";
      if (c.style.minWidth !== want) c.style.minWidth = want;
      const cs = own && own.size && Math.abs(own.size - size) > 0.01 ? own.size.toFixed(2) + "px" : "";
      if (c.style.fontSize !== cs) c.style.fontSize = cs;
      x = next;
      from = nextAt;
    });
  } else {
    // Nothing placed: the cells are the export's own columns, on the grid's widths.
    for (const c of cells) {
      if (c.style.minWidth) c.style.minWidth = "";
      if (c.style.fontSize) c.style.fontSize = "";
    }
  }
  for (const c of cells) putFace(c, null); // the runs carry the faces
  if (spec.runs === null) return false;
  return faceLine(lt, spec.runs || [], face);
}
/**
 * A line put back as the grid left it: the PDF's cuts off it (`__grid`), its
 * runs' face wrappers off it, and whatever placeLine wrote taken back.
 * Returns { cut, whether it carried the PDF's cuts, so its cells are to be
 * cut again without them (dressColumns); faced, whether taking the wrappers
 * off moved a text node (the caller puts the caret back by its offset) }.
 */
export function unplaceLine(lt) {
  const cut = !!lt.__grid;
  lt.__grid = null;
  lt.__placed = false;
  putFace(lt, null);
  if (lt.style.fontSize && !(lt.parentElement && lt.parentElement.classList.contains("rl"))) lt.style.fontSize = "";
  for (const c of lt.querySelectorAll(".cc")) {
    if (c.style.minWidth) c.style.minWidth = "";
    if (c.style.fontSize) c.style.fontSize = "";
    putFace(c, null);
  }
  for (const c of lt.querySelectorAll(".rc")) putFace(c, null);
  return { cut, faced: unfaceLine(lt) };
}

// ---- a line's runs in the PDF's faces ----------------------------------------
//
// Beside its PDF a line's text is drawn in the faces the PDF sets it in, run by
// run (pdfsync.faceRuns): each run not in the line's own face is wrapped in a
// span (.fc) carrying that face — bold, italic, and on a form the piece's own
// family and nothing else. The wrapper stands INSIDE whatever holds the run (a
// cell, a cell's gap, the line) and holds only text, pseudonym spans, spot
// keeps and checkbox marks, never a cell: the columns' arithmetic, which is
// the cells' widths side by side, never sees it, a face that changes in the
// middle of a word (a name in italics and its "'s") is drawn where it changes,
// and a numbered page, whose lines are never cut at the PDF's items, takes its
// faces all the same with nothing moved. Like the cells it carries no data-fake
// and is re-derived on every pass: serializeNodes, a copy, Find, the LEAKS walk
// and every offset into the page read what they always did, and a line already
// faced as its text and runs say is left exactly as it is.

/** Taken whole: wrapped, never split, never entered. */
const FACE_LEAF = "[data-fake], [data-here], .cb, .rb, .rh";
/**
 * `lt`'s runs (pdfsync.faceRuns, file offsets) each wrapped in its face where
 * it differs from `face`, the line's own; the wrappers from before taken off
 * first. A line carrying a rule glyph (rules.js) keeps the line's face
 * throughout: dressRules reads a line's glyphs off its top-level text nodes.
 * Returns whether any text node moved.
 */
export function faceLine(lt, runs, face) {
  const want = (runs || []).filter((r) => r && r.face && r.to > r.from && !sameFace(r.face, face));
  if (want.length && lt.querySelector(".rb, .rh")) want.length = 0;
  const key = want.length ? serializeNodes(lt) + "\n" + want.map((r) => r.from + "-" + r.to + ":" + faceStyle(r.face) + (r.face.em || "") + (r.face.family || "")).join(",") : "";
  if ((lt.__faced || "") === key) return false;
  let changed = unfaceLine(lt);
  lt.__faced = key;
  if (!want.length) return changed;
  const state = { off: 0, k: 0, span: null, run: null };
  const runAt = () => { while (state.k < want.length && want[state.k].to <= state.off) state.k++; return state.k < want.length ? want[state.k] : null; };
  const wrap = (node, run) => {
    // Nodes of one run that follow one another under one parent share a wrapper.
    if (state.span && state.run === run && node.previousSibling === state.span) { state.span.appendChild(node); return; }
    const span = document.createElement("span");
    span.className = "fc";
    putFace(span, run.face);
    node.before(span);
    span.appendChild(node);
    state.span = span;
    state.run = run;
    changed = true;
  };
  const visit = (parent) => {
    for (let node of [...parent.childNodes]) {
      if (node.nodeType === 3) {
        for (;;) {
          const len = node.data.length;
          const r = len ? runAt() : null;
          if (!r || r.from >= state.off + len) { state.off += len; break; }
          if (r.from > state.off) { const tail = node.splitText(r.from - state.off); state.off = r.from; node = tail; continue; }
          if (r.to < state.off + len) { const tail = node.splitText(r.to - state.off); wrap(node, r); state.off = r.to; node = tail; continue; }
          wrap(node, r);
          state.off += len;
          break;
        }
        continue;
      }
      if (node.nodeType !== 1) continue;
      const len = fileLength(node);
      if (node.nodeName === "BR" || node.matches(FACE_LEAF)) {
        const r = runAt();
        if (r && node.nodeName !== "BR" && r.from <= state.off && r.to >= state.off + len) wrap(node, r);
        state.off += len;
        continue;
      }
      state.span = null; // a wrapper's nodes are siblings: none continues into a child
      visit(node);
      state.span = null;
    }
  };
  visit(lt);
  return changed;
}
/** The runs' face wrappers taken off a line. Returns whether there were any. */
export function unfaceLine(lt) {
  const had = lt.querySelectorAll(".fc");
  for (const c of had) c.replaceWith(...c.childNodes);
  lt.__faced = null;
  return had.length > 0;
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
