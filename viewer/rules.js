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
//
// The glyphs stay in the DOM as the spans' own text, so serializeNodes and a
// copy read exactly what the file says. The spans are re-derived on every
// pass (undressed first), because an edit can split or join a cell.

import { ruleParts, ruleShape, serializeNodes } from "./textdoc.js";

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

/** The consecutive lines of one box: runs of `.line.rl` siblings sharing a bar key. */
function ruleBlocks(root) {
  const blocks = [];
  let run = null;
  for (const line of root.querySelectorAll(".line")) {
    const rl = line.classList.contains("rl");
    if (rl && run && !line.classList.contains("rt") && run.key === line.dataset.rk && run.lines[run.lines.length - 1].nextElementSibling === line) run.lines.push(line);
    else if (rl) { run = { key: line.dataset.rk, lines: [line] }; blocks.push(run); }
    else run = null;
  }
  return blocks;
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
 * A box never wraps (a wrapped cell is a box with a hole in it), so a box
 * wider than its sheet has the SHEET widened for it, as line lock widens a
 * page for its longest numbered line; the stage scrolls sideways.
 *
 * On a page laid on its PDF's grid (side by side) every line is positioned on
 * its own, so no two rows share an anonymous table and nothing holds a box
 * together but this pass: there the stack is given one left edge as well, and
 * each row made as tall as the gap to the row below it, so its bar meets the
 * next row's.
 */
export function fitRuleRows(root) {
  for (const line of root.querySelectorAll(".line.rl")) {
    line.classList.remove("fit");
    line.style.height = "";
    for (const c of cellsOf(line)) c.style.width = "";
    // The left a pass of its own put back: this one's is written over it
    // below, and a row that is no longer part of a stack keeps the layout's.
    const l = laidOf(line);
    if (!isNaN(l[0])) line.style.left = isNaN(l[1]) ? "" : l[1] + "px";
  }
  for (const sec of root.querySelectorAll(".tpage")) {
    if (!sec.__ruleWide) continue;
    sec.__ruleWide = false;
    sec.style.width = ""; sec.style.maxWidth = "";
  }
  for (const stack of ruleStacks(root)) fitStack(stack);
  const widen = new Map();
  for (const block of ruleBlocks(root)) {
    const line = block.lines[0];
    const body = line.closest(".page-body");
    if (!body) continue;
    const sec = body.closest(".tpage");
    if (!sec || sec.classList.contains("matched")) continue;
    const limit = body.getBoundingClientRect().right - parseFloat(getComputedStyle(body).paddingRight || 0);
    let right = 0;
    for (const l of block.lines) right = Math.max(right, l.getBoundingClientRect().right);
    const over = right - limit;
    if (over > 0.5) widen.set(sec, Math.max(widen.get(sec) || 0, over));
  }
  for (const [sec, over] of widen) {
    sec.__ruleWide = true;
    sec.style.width = Math.ceil(sec.getBoundingClientRect().width + over) + "px";
    sec.style.maxWidth = "none";
  }
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
 */
export function ruleGrid(rows, widths, slop = RULE_COL_SLOP) {
  const at = new Map();
  rows.forEach((bars, k) => bars.forEach((o) => { if (!at.has(o)) at.set(o, new Set()); at.get(o).add(k); }));
  const col = new Map();
  let idx = -1, prev = null, held = null;
  for (const o of [...at.keys()].sort((a, b) => a - b)) {
    const here = at.get(o);
    const clash = held && [...here].some((k) => held.has(k));
    if (prev == null || o - prev > slop || clash) { idx++; held = new Set(here); }
    else for (const k of here) held.add(k);
    col.set(o, idx);
    prev = o;
  }
  const w = (k, i) => { const v = widths[k] && widths[k][i]; return v > 0 ? v : 0; };
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
// width of ninety glyphs in a font that was never meant to draw them.
const needOf = (c) => (!c || c.classList.contains("hf") ? 0 : c.getBoundingClientRect().width);

function fitStack(lines) {
  if (lines.length < 2) return;
  const rows = [], cells = [], kept = [];
  for (const line of lines) {
    const bars = barsOf(line), cs = cellsOf(line);
    // The bars are counted in the file's text and the cells in the line's
    // own: a row where they disagree is left to itself rather than fitted to
    // a grid its cells do not answer to.
    if (!bars.length || cs.length !== bars.length + 1) continue;
    rows.push(bars); cells.push(cs); kept.push(line);
  }
  if (kept.length < 2) return;
  const { lead, spans } = ruleGrid(rows, cells.map((cs) => cs.map(needOf)));
  // Side by side each row stands where the PDF's grid put it, so the stack is
  // squared up there as well: one left for all of them, and each row as tall
  // as the gap to the next. The left and top the layout gave a row are in its
  // own record, never read back off the style this overrides.
  const body = kept[0].closest(".page-body");
  const laid = body && body.classList.contains("fixed") ? kept.map(laidOf) : null;
  let left = null;
  if (laid) for (const l of laid) if (!isNaN(l[1])) left = left == null ? l[1] : Math.min(left, l[1]);
  kept.forEach((line, k) => {
    line.classList.add("fit");
    const cs = cells[k];
    cs[0].style.width = lead + "px";
    spans[k].forEach((v, i) => { cs[i + 1].style.width = v + "px"; });
    if (!laid) return;
    if (left != null) line.style.left = left + "px";
    const top = laid[k][0], next = k + 1 < laid.length ? laid[k + 1][0] : NaN;
    if (!isNaN(top) && !isNaN(next) && next > top) line.style.height = (next - top) + "px";
  });
}
