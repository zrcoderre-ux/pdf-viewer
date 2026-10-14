// rules.js
//
// The boxes an export draws, drawn. PDF-Linker writes a page's line art into
// its text with the box-drawing glyphs, which is a box only in a monospace
// font at single spacing (textdoc.js, "rule glyphs"). Here each line's rule
// glyphs are wrapped in spans the stylesheet draws as lines, and a line
// carrying vertical bars is made a ROW OF CELLS split at those bars:
//
//   .line.rl        display: table-row — consecutive rows share one anonymous
//                   table, so a bar column is one column whatever the font.
//   .line.rl.rt     a row whose bars stand at different offsets from the row
//                   above it: its own table, or it would take the columns of a
//                   box it is not part of.
//   .line.rr        a line that is nothing but rules: drawn at half height,
//                   the way the page prints a hairline.
//   .rc             a cell of text between two bars; .rc.hf a cell that is one
//                   `─` run, drawn as a line across the whole cell.
//   .rb             a bar glyph: a cell one pixel wide, filled to the row's
//                   full height (data-v says how much of it a corner draws).
//   .rh             a `─` run inside a text cell or an ordinary line (an
//                   underline), drawn as a line at its own width.
//   .line.rl.gridfit  side by side on the export's grid read off the PDF: a
//                   row whose bars stand on that grid, a fixed table the width
//                   its cells add up to (fitRuleRows, planStack).
//
// The glyphs stay in the DOM as the spans' own text, so serializeNodes and a
// copy read exactly what the file says. The spans are re-derived on every
// pass (undressed first), because an edit can split or join a cell.

import { ruleParts, ruleShape, serializeNodes } from "./textdoc.js";
import { undressColumns } from "./columns.js";

/** An empty slot carries a <br> so the caret can stand in it; one with text does not need it. */
export function placeholderIn(lt) {
  // A <br> is only ever the placeholder: Enter and a paste never insert one
  // (plaintext-only types "\n"), so with text present every <br> goes.
  if (!lt.textContent.length) { if (!lt.querySelector("br")) lt.appendChild(document.createElement("br")); }
  else for (const br of [...lt.querySelectorAll("br")]) br.remove();
}

/** The rule spans taken back out of a line's text: cells opened, glyph spans back to text. */
export function undress(lt) {
  // A line with no rule span is left exactly as it is: the editor may be
  // holding one of its text nodes for the caret.
  if (!lt.querySelector(".rc, .rb, .rh")) return;
  for (const c of [...lt.querySelectorAll(".rc")]) c.replaceWith(...c.childNodes);
  for (const g of [...lt.querySelectorAll(".rb, .rh")]) g.replaceWith(document.createTextNode(g.textContent));
}

function ruleSpan(part) {
  const span = document.createElement("span");
  span.className = part.t === "bar" ? "rb" : "rh";
  if (part.v) span.dataset.v = part.v;
  span.contentEditable = "false";
  span.textContent = part.s;
  return span;
}

function closeCell(cell) {
  const kids = cell.childNodes;
  if (kids.length === 1 && kids[0].nodeType === 1 && kids[0].classList.contains("rh")) cell.classList.add("hf");
  return cell;
}

/** A line's text with its rule glyphs wrapped; cells where it carries bars. Returns whether it carried any. */
export function dressRules(lt) {
  const parts = [];
  for (const n of [...lt.childNodes]) {
    if (n.nodeType !== 3 || !/[\u2500\u2502\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c]/.test(n.data)) { parts.push(n); continue; }
    for (const p of ruleParts(n.data)) parts.push(p.t === "text" ? document.createTextNode(p.s) : ruleSpan(p));
  }
  const bars = parts.some((x) => x.nodeType === 1 && x.classList.contains("rb"));
  lt.replaceChildren();
  if (!bars) { for (const x of parts) lt.appendChild(x); return false; }
  let cell = document.createElement("span");
  cell.className = "rc";
  for (const x of parts) {
    if (x.nodeType === 1 && x.classList.contains("rb")) {
      lt.appendChild(closeCell(cell));
      lt.appendChild(x);
      cell = document.createElement("span");
      cell.className = "rc";
    } else cell.appendChild(x);
  }
  lt.appendChild(closeCell(cell));
  return true;
}

/**
 * Every line of a page body: its placeholder settled and its rules drawn.
 * Called wherever the lines have been rebuilt or moved — the page fill and
 * each edit that restructures lines — so the spans always describe the text
 * as it now stands.
 */
export function dressLines(body) {
  let prevKey = null;
  for (const line of body.querySelectorAll(".line")) {
    const lt = line.querySelector(":scope > .lt");
    if (!lt) continue;
    undress(lt);
    line.classList.remove("rl", "rt", "rr");
    placeholderIn(lt);
    // The bars are located in the line as the FILE writes it — the fakes
    // underneath, not the real names on screen: the file's columns are the
    // ones PDF-Linker aligned, and a row whose real name is three letters
    // longer than its fake is still a row of the same box.
    const shape = ruleShape(serializeNodes(line));
    if (!shape) { prevKey = null; continue; }
    // The glyphs are wrapped where they stand among the line's own nodes, so
    // the column cells (columns.js) come off first and go back on after.
    undressColumns(lt);
    const cells = dressRules(lt);
    if (shape.rule) line.classList.add("rr");
    if (!cells) { prevKey = null; continue; }
    const key = shape.bars.join(",");
    line.classList.add("rl");
    line.dataset.rk = key;
    if (prevKey !== null && prevKey !== key) line.classList.add("rt");
    prevKey = key;
  }
}

const cellsOf = (line) => [...line.querySelectorAll(":scope > .lt > .rc")];
/** A laid line's record: "top|left|size|box" (text-reader.js, applyMatchedLayout). */
const laidOf = (line) => String(line.__laid || "").split("|").map(parseFloat);

/**
 * What the table layout cannot supply, measured and set. Run at the end of
 * every layout pass (applyMatchedLayout), which is after the page fill, after
 * every settled edit, on every font change, and each time a PDF's grid lands.
 *
 * A box is drawn as a box: every consecutive rule row — a STACK, not only the
 * run of rows carrying their bars at the same offsets — is measured together
 * against one column grid, and each row's cells are set to it. The stack and
 * not the run, because the art's own columns wobble: one line of a notice too
 * long for the box pushes that row's closing bar a character or two out, and
 * measured on its own that row is drawn at its own width — a box with a step
 * in its side. It also covers what a row that is a table of its own (`.rt`)
 * could never size for itself: two stacked boxes meet at a bottom rule and a
 * top rule, and the top rule of the second, drawn alone, would take its `─`
 * glyphs' own width, right in a monospace font and not in any other.
 *
 * A box never wraps (a wrapped cell is a box with a hole in it), and the
 * sheet never widens for one either: every other page is centred in a column
 * as wide as the widest sheet, so one wide table in an exhibit set the whole
 * document off to the side of the stage in a field of grey. A box wider than
 * its paper is DRAWN SMALLER until it fits (fitWide) — its type, not its
 * sheet — the way the PDF itself holds that table on the page.
 *
 * On a page laid on its PDF's grid (side by side) every line is positioned on
 * its own, so no two rows share an anonymous table and nothing holds a box
 * together but this pass: there the stack is given one left edge as well, and
 * each row made as tall as the gap to the row below it, so its bar meets the
 * next row's.
 *
 * `root` is the column, a page, or a list of pages.
 */
export function fitRuleRows(root) {
  const roots = Array.isArray(root) ? root : [root];
  for (const line of roots.flatMap((r) => [...r.querySelectorAll(".line.rl")])) {
    const lt = line.querySelector(":scope > .lt");
    if (lt && lt.style.fontSize) { lt.style.fontSize = ""; lt.style.removeProperty("--box-fit"); } // measured at its own size again
    unfit(line);
  }
  const stacks = roots.flatMap((r) => ruleStacks(r));
  fitStacks(stacks);
  fitWide(stacks);
}

/** A row as the table layout would draw it on its own: what a fit wrote, taken off. */
function unfit(line) {
  line.classList.remove("fit", "gridfit");
  line.style.height = "";
  line.style.width = "";
  for (const c of cellsOf(line)) c.style.width = "";
  // The left a pass of its own put back: this one's is written over it
  // below, and a row that is no longer part of a stack keeps the layout's.
  const l = laidOf(line);
  if (!isNaN(l[0])) line.style.left = isNaN(l[1]) ? "" : l[1] + "px";
}

// How many times a box too wide for its paper is measured and drawn smaller.
// The first answer is nearly exact (only the one-pixel bars do not shrink with
// the type); the rest take up what rounding leaves over.
const WIDE_PASSES = 3;

/**
 * A box wider than its paper, drawn smaller until it fits.
 *
 * The TYPE in the box gives and the sheet does not: every row's cells take
 * one smaller size, so the box keeps its shape — its columns squared up
 * again at that size (fitStacks) — and ends at the page's right margin. The
 * numbered margin beside it is not part of the box and keeps its size. On
 * the PDF's grid (side by side) a sheet is the PDF page's width and every row
 * is set at its PDF row's own size, so nothing is changed there.
 *
 * Every stack is measured before any is written, so a pass lays the document
 * out once however many boxes it has.
 */
function fitWide(stacks) {
  let todo = stacks.map((lines) => ({ lines, f: 1 }));
  for (let pass = 0; pass < WIDE_PASSES && todo.length; pass++) {
    const over = [];
    for (const s of todo) {
      const m = overrun(s.lines);
      if (!m) continue;
      // Only the text shrinks with the type; the bars are a pixel at any size.
      const want = Math.floor(s.f * ((m.room - m.bars) / (m.need - m.bars)) * 1000) / 1000;
      if (want > 0 && want < s.f) { s.f = want; over.push(s); }
    }
    for (const s of over) {
      const size = (s.f * 100).toFixed(1) + "%";
      for (const line of s.lines) {
        const lt = line.querySelector(":scope > .lt");
        // …and the indent of its first cell (columns.js, indentBoxRow) with it.
        if (lt) { lt.style.fontSize = size; lt.style.setProperty("--box-fit", String(s.f)); }
        unfit(line); // its cells measured again at the new size, not at the widths they were given
      }
    }
    fitStacks(over.map((s) => s.lines));
    todo = over;
  }
}

/**
 * How far a box runs past its paper: `need`, the width from its first cell to
 * its right edge, against `room`, the width from there to the page's right
 * margin; `bars`, the pixels of it that are bars. Null for a box that fits,
 * or one on a page that is not a flowing sheet laid out on the screen.
 */
function overrun(lines) {
  const body = lines[0].closest(".page-body");
  const sec = body && body.closest(".tpage");
  if (!sec || sec.classList.contains("matched") || sec.classList.contains("swapped")) return null;
  const b = body.getBoundingClientRect();
  if (!b.width) return null; // not laid out
  const limit = b.right - parseFloat(getComputedStyle(body).paddingRight || 0);
  let right = -Infinity, left = Infinity, bars = 0;
  for (const line of lines) {
    right = Math.max(right, line.getBoundingClientRect().right);
    const first = line.querySelector(":scope > .lt > :first-child");
    if (first) left = Math.min(left, first.getBoundingClientRect().left);
    bars = Math.max(bars, line.querySelectorAll(":scope > .lt > .rb").length);
  }
  if (!(right - limit > 0.5) || !isFinite(left)) return null;
  const need = right - left, room = limit - left;
  if (room <= bars || need <= bars) return null;
  return { need, room, bars };
}

/** The consecutive rule rows of a page: one box, whatever its rows' own bars say. */
function ruleStacks(root) {
  const stacks = [];
  let run = null;
  for (const line of root.querySelectorAll(".line")) {
    const rl = line.classList.contains("rl");
    if (rl && run && run[run.length - 1].nextElementSibling === line) run.push(line);
    else if (rl) { run = [line]; stacks.push(run); }
    else run = null;
  }
  return stacks;
}

// How far apart two rows' bars may stand and still be the same rule, in the
// characters of the file's own text. The art is drawn to fixed columns, and
// what moves a bar off them is a row whose text would not fit inside them —
// a character or two, never a column of its own.
const RULE_COL_SLOP = 3;

/**
 * A stack of rule rows measured as one box. `rows` are each row's bar offsets
 * in the file's own text, `widths` the width each of its cells needs — one
 * more than its bars: the cell before the first bar, one between each pair,
 * and the cell after the last. Returns `lead`, the width before every row's
 * first bar, and `spans`, per row, the width of each cell between two bars.
 *
 * The bars stand in columns: offsets within `slop` of each other are one
 * column, except where that would put two of a row's own bars in it. Each
 * column is then set far enough right for every cell that ends there, a
 * column at a time, left to right — so a cell spanning three columns pushes
 * the third out where it must and leaves the ones between it alone, and every
 * row's bar at a given column stands at the same place.
 *
 * `place`, where it is given, says where a column of the file's text stands
 * on the page — (offset) → the width from the stack's left to it — and each
 * column of bars is set there at the least (its leftmost offset's place):
 * beside its PDF page, a box is the PDF's box, its edges and its inner rules
 * where the PDF draws them, however little of its width the text in it
 * fills. A cell too wide for that still pushes its column out. There each
 * row's first bar stands at ITS column too, `heads` (the width before it, per
 * row): a stack is often two boxes, one under the other's side (SUM-100's
 * notice under the court's box), and the one lead every row shares in the
 * flowing sheet would stand the notice's left side under the court box's.
 *   `reach`, where it is given, is the furthest right the PDF prints type on
 * the page, where its form number and its page count end — and its boxes
 * too. The grid is a fit, good to about a character (`slack`), and a place
 * further than that past the page's type is not the PDF's rule: the fit
 * running wide at the far side of the page (PLD-050's right side 8 px out),
 * or a bar PDF-Linker pushed out to hold a notice in small type (SUM-100's,
 * 37 px out, off the sheet). Such a column is placed at the type's edge
 * instead. A place within a character of it stands: a form whose type stops
 * short of its box's side (LASC CIV 109's, 5 pt) keeps the grid's side. A
 * cell too wide for either still pushes its column out.
 */
export function ruleGrid(rows, widths, slop = RULE_COL_SLOP, place = null, { reach = Infinity, slack = 0 } = {}) {
  const at = new Map();
  rows.forEach((bars, k) => bars.forEach((o) => { if (!at.has(o)) at.set(o, new Set()); at.get(o).add(k); }));
  const col = new Map();
  const first = []; // each column's leftmost offset
  let idx = -1, prev = null, held = null;
  for (const o of [...at.keys()].sort((a, b) => a - b)) {
    const here = at.get(o);
    const clash = held && [...here].some((k) => held.has(k));
    if (prev == null || o - prev > slop || clash) { idx++; held = new Set(here); first.push(o); }
    else for (const k of here) held.add(k);
    col.set(o, idx);
    prev = o;
  }
  const w = (k, i) => { const v = widths[k] && widths[k][i]; return v > 0 ? v : 0; };
  if (place) {
    if (idx < 0) return { lead: 0, heads: [], spans: [] };
    const X = new Array(idx + 1).fill(0);
    for (let j = 0; j <= idx; j++) {
      let v = j ? X[j - 1] : 0;
      const f = place(first[j]);
      if (Number.isFinite(f)) v = Math.max(v, f > reach + slack ? reach : f);
      rows.forEach((bars, k) => {
        if (col.get(bars[0]) === j) v = Math.max(v, w(k, 0));
        for (let i = 0; i + 1 < bars.length; i++) if (col.get(bars[i + 1]) === j) v = Math.max(v, X[col.get(bars[i])] + w(k, i + 1));
      });
      X[j] = v;
    }
    return {
      lead: X[0],
      heads: rows.map((bars) => X[col.get(bars[0])]),
      spans: rows.map((bars) => bars.slice(1).map((o, i) => X[col.get(o)] - X[col.get(bars[i])])),
    };
  }
  let lead = 0;
  rows.forEach((bars, k) => { lead = Math.max(lead, w(k, 0)); });
  const x = new Array(idx + 1).fill(0);
  for (let j = 1; j <= idx; j++) {
    let v = x[j - 1];
    rows.forEach((bars, k) => {
      for (let i = 0; i + 1 < bars.length; i++) {
        if (col.get(bars[i + 1]) !== j) continue;
        v = Math.max(v, x[col.get(bars[i])] + w(k, i + 1));
      }
    });
    x[j] = v;
  }
  const spans = rows.map((bars) => {
    const out = [];
    for (let i = 0; i + 1 < bars.length; i++) out.push(x[col.get(bars[i + 1])] - x[col.get(bars[i])]);
    return out;
  });
  return { lead, spans };
}

/** A row's bar offsets as dressLines recorded them. */
const barsOf = (line) => String(line.dataset.rk || "").split(",").filter((s) => s !== "").map(Number);
// A `─` run needs no width of its own: it is a line drawn across whatever its
// cell is given, and measured before the box is fitted it would ask for the
// width of ninety glyphs in a font that was never meant to draw them. One the
// export indents (columns.js, indentBoxRow) needs its indent: the rule starts
// that far in, and a cell is never narrower than its padding.
const needOf = (c) => {
  if (!c) return 0;
  if (!c.classList.contains("hf")) return c.getBoundingClientRect().width;
  return c.classList.contains("ci") ? parseFloat(getComputedStyle(c).paddingLeft) || 0 : 0;
};
// …and where the bars stand on the PDF's grid (planStack, `place`), what a
// cell's TEXT needs: up to its last character and a space more. The spaces
// the export ends a cell with only carry it to the next bar on the grid, and
// in the PDF's own face and size they run wider than the grid's characters
// (a notice in 9-point bold): measured with them, a cell pushed its closing
// bar out past the PDF's rule.
const needOnGrid = (c) => {
  if (!c || c.classList.contains("hf")) return 0;
  let last = null, at = -1;
  const walk = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) { const i = n.data.search(/\S\s*$/); if (i >= 0) { last = n; at = i; } }
  if (!last) return 0;
  const r = document.createRange();
  r.setStart(last, at);
  r.setEnd(last, at + 1);
  return r.getBoundingClientRect().right - c.getBoundingClientRect().left + 0.28 * (parseFloat(getComputedStyle(c).fontSize) || 0);
};

/**
 * Stacks squared up: every one MEASURED, then every one written. Measured
 * and written a stack at a time, each measure after the last one's writes
 * laid the whole document out again — a second and a half for a hundred
 * boxes in an exhibit set, on every layout pass.
 */
function fitStacks(stacks) {
  const plans = stacks.map(planStack);
  for (const plan of plans) if (plan) applyStack(plan);
}

/** A stack's grid, measured (reads only). Null for one left to the table layout. */
function planStack(lines) {
  if (lines.length < 2) return null;
  const rows = [], cells = [], kept = [];
  for (const line of lines) {
    const bars = barsOf(line), cs = cellsOf(line);
    // The bars are counted in the file's text and the cells in the line's
    // own: a row where they disagree is left to itself rather than fitted to
    // a grid its cells do not answer to.
    if (!bars.length || cs.length !== bars.length + 1) continue;
    rows.push(bars); cells.push(cs); kept.push(line);
  }
  if (kept.length < 2) return null;
  // Side by side each row stands where the PDF's grid put it, so the stack is
  // squared up there as well: one left for all of them, and each row as tall
  // as the gap to the next. The left and top the layout gave a row are in its
  // own record, never read back off the style this overrides.
  const body = kept[0].closest(".page-body");
  const onPdfGrid = !!body && body.classList.contains("cgrid");
  // A row that ran past the sheet before its box was fitted (its `─` runs at
  // their glyphs' own width) was slid back into its indent and gave up its
  // record (text-reader.js, the spill) — its left, that is: its top is the
  // one the layout wrote this pass. On the PDF's grid such a row is as tall
  // as the gap to the next one all the same, so the box's sides meet.
  const laid = body && body.classList.contains("fixed") ? kept.map((line) => {
    const l = laidOf(line);
    if (onPdfGrid && isNaN(l[0])) l[0] = parseFloat(line.style.top);
    return l;
  }) : null;
  let left = null;
  if (laid) for (const l of laid) if (!isNaN(l[1])) left = left == null ? l[1] : Math.min(left, l[1]);
  // …and a stack whose every row was slid back — a small box at the right
  // margin, MC-011's "TOTAL 1." — stands at the left those rows were slid to
  // THIS pass (the layout writes every row without a record again before it
  // slides it) and is squared up there, its bars on the grid; left to itself
  // it was a box whose sides missed its top and its foot. Off the grid (and on
  // pleading paper) such a stack is left as it was.
  if (laid && left == null && onPdfGrid) for (const line of kept) { const v = parseFloat(line.style.left); if (!isNaN(v)) left = left == null ? v : Math.min(left, v); }
  // …and where the page is laid on the export's own grid read back off the
  // PDF (.cgrid; text-reader.js writes it on the body as `__charGrid`, px),
  // its bars stand on it: a bar the file sets at column c is the PDF's rule at
  // x0 + c × unit, to within half a character. The text in a box set in the
  // PDF's own face fills it as the PDF's does; the box is the PDF's width
  // whatever it holds.
  const cg = laid && left != null && body.classList.contains("cgrid") ? body.__charGrid : null;
  const place = cg ? (o) => cg.x0 + o * cg.unit - left : null;
  // No bar a character past the page's type (`right`, ruleGrid's `reach`)
  // or past its sheet: the widths are the cells', so a row's bars, a pixel
  // each, come off it.
  const reach = place ? Math.min(Number.isFinite(cg.right) ? cg.right : Infinity, body.clientWidth) - left - Math.max(...rows.map((b) => b.length)) : Infinity;
  const { lead, heads, spans } = ruleGrid(rows, cells.map((cs) => cs.map(place ? needOnGrid : needOf)), RULE_COL_SLOP, place, { reach, slack: place ? cg.unit : 0 });
  return { kept, cells, lead, heads, spans, laid, left, onGrid: !!place };
}

/** …and written. */
function applyStack({ kept, cells, lead, heads, spans, laid, left, onGrid }) {
  kept.forEach((line, k) => {
    line.classList.add("fit");
    const cs = cells[k];
    const head = heads ? heads[k] : lead;
    cs[0].style.width = head + "px";
    spans[k].forEach((v, i) => { cs[i + 1].style.width = v + "px"; });
    // On the PDF's grid the cells are the widths the grid gives and not a
    // pixel more: a cell set "white-space: pre" is never narrower than its
    // text and the spaces the export ends it with, and those, in the PDF's
    // own face and size, pushed its bar out past the PDF's rule. The row is
    // laid out as a fixed table at the width its cells and bars add up to,
    // and the spaces run on unseen.
    if (onGrid) {
      line.classList.add("gridfit");
      line.style.width = (head + spans[k].reduce((a, b) => a + b, 0) + barsOf(line).length) + "px";
    }
    if (!laid) return;
    if (left != null) line.style.left = left + "px";
    const top = laid[k][0], next = k + 1 < laid.length ? laid[k + 1][0] : NaN;
    if (!isNaN(top) && !isNaN(next) && next > top) line.style.height = (next - top) + "px";
  });
}
