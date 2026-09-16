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

import { ruleParts, ruleShape } from "./textdoc.js";

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
    const g = line.querySelector(":scope > .gutter");
    const shape = ruleShape((g ? g.textContent : "") + lt.textContent);
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

/**
 * The widths the table layout cannot supply, measured and set: asked after
 * layout and again whenever the font moves.
 *
 * A row that is a table of its own (`.rt`) has no text rows to size its
 * columns — two stacked boxes meet at a bottom rule and a top rule, and the
 * top rule of the second, drawn alone, would take its `─` glyphs' own width,
 * right in a monospace font and not in any other — so it is sized to the
 * block under it where that block shares its bars.
 *
 * And on a page laid on its PDF's grid (side by side) every line is
 * positioned on its own, so no two rows share an anonymous table at all:
 * there each box's rows are measured together, every column set to the
 * widest cell in it, and the rows given one left edge, so the box is a box
 * there too.
 */
export function fitRuleRows(root) {
  for (const line of root.querySelectorAll(".line.rt")) {
    line.classList.remove("fit");
    for (const c of cellsOf(line)) c.style.width = "";
  }
  const fixed = [];
  for (const line of root.querySelectorAll(".page-body.fixed .line.rl")) for (const c of cellsOf(line)) c.style.width = "";
  for (const block of ruleBlocks(root)) {
    const laid = block.lines[0].closest(".page-body.fixed");
    if (laid) { fixed.push(block); continue; }
    const line = block.lines[0];
    if (!line.classList.contains("rt") || block.lines.length < 2) continue;
    // The lone row's own widths are measured with it alone; the block's rows
    // share a table and are measured as a table.
    const cells = cellsOf(line), ncells = cellsOf(block.lines[1]);
    if (ncells.length !== cells.length) continue;
    const ws = ncells.map((c) => c.getBoundingClientRect().width);
    line.classList.add("fit");
    cells.forEach((c, i) => { c.style.width = ws[i] + "px"; });
  }
  for (const block of fixed) {
    if (block.lines.length < 2) continue;
    const rows = block.lines.map(cellsOf);
    const n = Math.max(...rows.map((r) => r.length));
    const ws = new Array(n).fill(0);
    for (const r of rows) r.forEach((c, i) => { ws[i] = Math.max(ws[i], c.getBoundingClientRect().width); });
    // The left the layout gave each row is in its own record (`__laid`,
    // "top|left|size|box"), never read back off the style this overrides.
    let left = null;
    for (const line of block.lines) {
      const l = parseFloat(String(line.__laid || "").split("|")[1]);
      if (!isNaN(l)) left = left == null ? l : Math.min(left, l);
    }
    for (const line of block.lines) {
      line.classList.add("fit");
      cellsOf(line).forEach((c, i) => { c.style.width = ws[i] + "px"; });
      if (left != null) line.style.left = left + "px";
    }
  }
}
