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
//   .line.rl.fit    a row set on its page's column grid (fitRuleRows): a
//                   table of its own, fixed at the widths the grid gives its
//                   cells, so each bar stands at its column's place.
//   .rg             a cell of `─` runs and spaces in such a row, or the text
//                   of a line of nothing but runs: each run drawn where the
//                   grid puts its ends, a hairline at the middle of the row.
//
// The glyphs stay in the DOM as the spans' own text, so serializeNodes and a
// copy read exactly what the file says. The spans are re-derived on every
// pass (undressed first), because an edit can split or join a cell.

import { ruleParts, ruleShape, captionParens, serializeNodes } from "./textdoc.js";
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

/**
 * The `)` a caption's side is drawn with (textdoc.captionParens), made a bar
 * where it stands among the line's own text: the `k`th `)` of the line, read
 * off its text nodes, since the file's offsets are the fakes' and the screen
 * holds the real names. Its text stays `)`, so the file is unchanged. `under`:
 * the underscore run before it is the box's foot, drawn as a rule across its
 * cell, and the side stops there. False where the line's text does not hold
 * that `)` (an edit moved it, or it is inside a name).
 */
function markParen(lt, k, under) {
  let seen = 0;
  for (const n of [...lt.childNodes]) {
    if (n.nodeType !== 3) { seen += (n.textContent.match(/\)/g) || []).length; if (seen > k) return false; continue; }
    for (let i = n.data.indexOf(")"); i >= 0; i = n.data.indexOf(")", i + 1)) {
      if (seen++ !== k) continue;
      const bar = document.createElement("span");
      bar.className = "rb paren";
      bar.contentEditable = "false";
      bar.textContent = ")";
      if (under) bar.dataset.v = "up";
      const rest = n.splitText(i);
      rest.data = rest.data.slice(1);
      n.after(bar);
      if (under) {
        const m = /^(\s*)(_+)(\s*)$/.exec(n.data);
        if (m) {
          const run = document.createElement("span");
          run.className = "rh";
          run.contentEditable = "false";
          run.textContent = m[2];
          n.data = m[1];
          n.after(run);
          if (m[3]) run.after(document.createTextNode(m[3]));
          if (!n.data) n.remove();
        }
      }
      return true;
    }
  }
  return false;
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
  const lines = [...body.querySelectorAll(".line")];
  // The bars are located in the line as the FILE writes it — the fakes
  // underneath, not the real names on screen: the file's columns are the
  // ones PDF-Linker aligned, and a row whose real name is three letters
  // longer than its fake is still a row of the same box. Read once, for the
  // caption's `)` side too, which is a column of the page, not of a line.
  const texts = lines.map((line) => { const lt = line.querySelector(":scope > .lt"); if (lt) undress(lt); return serializeNodes(line); });
  const parens = captionParens(texts);
  for (const [li, line] of lines.entries()) {
    const lt = line.querySelector(":scope > .lt");
    if (!lt) continue;
    // Its cells are made afresh, with no widths: a table fixed at the width
    // the last fit gave it would share that out among them until the next.
    if (line.classList.contains("fit")) { line.classList.remove("fit"); line.style.width = ""; }
    line.classList.remove("rl", "rt", "rr");
    placeholderIn(lt);
    const text = texts[li];
    let shape = ruleShape(text);
    const paren = shape ? null : parens[li];
    if (paren) shape = { bars: [paren.col], rule: false };
    if (!shape) { prevKey = null; continue; }
    // The glyphs are wrapped where they stand among the line's own nodes, so
    // the column cells (columns.js) come off first and go back on after.
    undressColumns(lt);
    if (paren && !markParen(lt, (text.slice(0, paren.at).match(/\)/g) || []).length, paren.under)) { prevKey = null; continue; }
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
/** A row's bar offsets as dressLines recorded them. */
const barsOf = (line) => String(line.dataset.rk || "").split(",").filter((s) => s !== "").map(Number);

// How far apart two rule glyphs may stand and still be the same rule, in the
// characters of the file's own text. The art is drawn to fixed columns, and
// what moves a bar off them is a row whose text would not fit inside them —
// a character or two, never a column of its own. A rule that ends a character
// short of the box above it is the same edge as the box's.
const RULE_COL_SLOP = 3;

const RUN_RE = /\u2500+/g;
/**
 * A cell's text as the file writes it, read for the grid. A cell of `─` runs
 * and spaces is { runs }, each run's [from, to) in the line; a cell of spaces
 * alone is { blank: true }; any other is { lead, t }: the spaces its text
 * opens with, and where its first character stands. `from` is where the cell
 * begins in the line.
 */
export function ruleCell(s, from = 0) {
  if (!/[^ ]/.test(s)) return { blank: true };
  if (/^[ \u2500]*$/.test(s)) {
    const runs = [];
    RUN_RE.lastIndex = 0;
    let m;
    while ((m = RUN_RE.exec(s))) runs.push([from + m.index, from + m.index + m[0].length]);
    return { runs };
  }
  const lead = s.length - s.replace(/^ +/, "").length;
  return { lead, t: from + lead };
}

/**
 * Every rule a page draws, on ONE column grid. In the file a rule is straight
 * because every glyph of it stands at one character column — a bar down the
 * lines it crosses, a run's ends across — and the page keeps that straight by
 * giving each column one place across the page. So does this: a column of
 * the file's characters is one x on the page, whichever row, box or rule line
 * a glyph of it stands in. Each row of a box is drawn to it, and a rule line
 * of its own (a signature line, a divider under a box) has its runs drawn to
 * it as well, so a divider spanning a box's columns spans the box, and the
 * boxes down a form's right margin (MC-011's amounts) stand one over another.
 *
 * `rows`, per line: { bars, cells }. `bars` are the offsets of its bar glyphs
 * in the file's text (none for a line of rules alone); `cells` are one more
 * than its bars — before the first bar, between each pair, after the last —
 * each { need }, the width its text needs from the cell's left, or { runs },
 * its `─` runs as [from, to) offsets, or empty.
 *
 * The columns are the bars' offsets and the runs' free ends (a run that opens
 * just past a bar, or ends at one, is drawn from or to that bar): offsets
 * within `slop` of the first of them are one column, except where that would
 * put two of one row's own in it. Each column stands at its `place` — (offset)
 * → px from the row's left, the page's character grid — and further right
 * only where a cell's text needs it: every cell ending at a column pushes it
 * as far as it must, and a column never stands left of the one before. A
 * cell's text needs its room PAST the bar before it, which is a pixel wide,
 * so a bar stands at its column whatever number of bars come before it in its
 * row. `reach` (with `slack`): no place further than that past the page's
 * type stands — the type's edge does. `snap`, where given, moves each column
 * on to the next whole pixel of the screen's (devicePixelRatio): every cell
 * then ends on one, and a bar a pixel wide is drawn the same pixel down every
 * row — a column of fractional widths had one row's bar drawn two pixels
 * wide, its neighbours' one.
 *
 * Returns { X, rows }: X, each column's place, px; per row { widths, runs,
 * bars, right } — each cell's width (its bar's place less the cell's left, the
 * last cell its text or runs), each cell's runs as [from, to) px from the
 * cell's left, each bar's place, and where the row's art ends.
 */
export function pageGrid(rows, { place = null, slop = RULE_COL_SLOP, reach = Infinity, slack = 0, snap = null } = {}) {
  const bars = rows.map((r) => (r && r.bars) || []);
  const cells = rows.map((r) => (r && r.cells) || []);
  const own = rows.map(() => new Map()); // per row: offset → its anchor
  const anchors = [];
  rows.forEach((r, k) => {
    const add = (o, bar) => {
      if (own[k].has(o)) return;
      const a = { o, k, bar, col: -1 };
      own[k].set(o, a);
      anchors.push(a);
    };
    for (const o of bars[k]) add(o, true);
    cells[k].forEach((c, i) => {
      for (const [a, b] of (c && c.runs) || []) {
        if (!(i > 0 && a === bars[k][i - 1] + 1)) add(a, false);
        if (!(i < bars[k].length && b === bars[k][i])) add(b, false);
      }
    });
  });
  anchors.sort((x, y) => x.o - y.o || x.k - y.k);
  const first = []; // each column's leftmost offset
  const barred = []; // …and whether a bar stands in it
  let held = null;
  for (const a of anchors) {
    const j = first.length - 1;
    if (j < 0 || a.o - first[j] > slop || held.has(a.k)) { first.push(a.o); barred.push(false); held = new Set(); }
    held.add(a.k);
    a.col = first.length - 1;
    if (a.bar) barred[a.col] = true;
  }
  const J = first.length;
  // What each column must clear: [column before (-1, the row's left), px] per row reaching it.
  const into = Array.from({ length: J }, () => []);
  const need = (c) => (c && c.need > 0 ? c.need : 0);
  rows.forEach((r, k) => {
    const bs = bars[k], cs = cells[k];
    const as = [...own[k].values()].sort((x, y) => x.o - y.o);
    if (bs.length && need(cs[0])) into[own[k].get(bs[0]).col].push([-1, need(cs[0])]);
    for (let m = 0; m + 1 < as.length; m++) {
      const p = as[m], q = as[m + 1];
      let n = p.bar ? 1 : 0;
      if (p.bar && q.bar) {
        const c = cs[bs.indexOf(q.o)];
        n += need(c) + (c && c.runs && c.runs.length ? 1 : 0);
      } else n += 1; // a run, or the blank between two: a pixel at the least
      into[q.col].push([p.col, n]);
    }
  });
  const X = new Array(J).fill(0);
  for (let j = 0; j < J; j++) {
    let v = j ? X[j - 1] : 0;
    const f = place ? place(first[j]) : NaN;
    if (Number.isFinite(f)) v = Math.max(v, f > reach + slack ? reach : f);
    for (const [p, n] of into[j]) v = Math.max(v, (p < 0 ? 0 : X[p]) + n);
    X[j] = snap ? snap(v) : v;
  }
  const at = (k, o) => X[own[k].get(o).col];
  return {
    X,
    rows: rows.map((r, k) => {
      const bs = bars[k], cs = cells[k];
      const bx = bs.map((o) => at(k, o));
      const left = (i) => (i ? bx[i - 1] + 1 : 0);
      // A run drawn from the bar it opens on, to the bar it ends at; a free
      // end at its column — and over the bar's own pixel, where a bar of
      // another row stands in that column, so a divider under a box ends
      // where the box does.
      const runs = cs.map((c, i) => ((c && c.runs) || []).map(([a, b]) => {
        const x0 = i > 0 && a === bs[i - 1] + 1 ? bx[i - 1] + 1 : at(k, a);
        const x1 = i < bs.length && b === bs[i] ? bx[i] : at(k, b) + (barred[own[k].get(b).col] ? 1 : 0);
        return [x0 - left(i), Math.max(x0 + 1, x1) - left(i)];
      }));
      const widths = cs.map((c, i) => {
        if (i < bs.length) return Math.max(0, bx[i] - left(i));
        let w = need(c);
        for (const [, e] of runs[i]) w = Math.max(w, e);
        return w;
      });
      let right = bx.length ? bx[bx.length - 1] + 1 : 0;
      runs.forEach((rs, i) => { for (const [, e] of rs) right = Math.max(right, left(i) + e); });
      return { widths, runs, bars: bx, right };
    }),
  };
}

/**
 * What the table layout cannot supply, measured and set. Run at the end of
 * every layout pass (applyMatchedLayout), which is after the page fill, after
 * every settled edit, on every font change, and each time a PDF's grid lands.
 *
 * A rule straight in the file is straight on the page, in either view: every
 * rule a page draws — its boxes' rows and its lines of rules alone — is set
 * on one column grid (pageGrid), so a column of the file's characters is one
 * x on the page. The grid is the page's own character grid, the one its
 * columns of text stand on (columns.js): the reader's average character in
 * the page's body type (--col-u), counted from the body margin on pleading
 * paper; beside its PDF on a page laid on the export's grid read off the PDF,
 * that grid (.cgrid). A cell's text pushes its bar further only where it does
 * not fit, and the push is the column's down the whole page. Every cell's
 * text stands where the file sets it on the grid, as far past the bar before
 * it as the file has it, so a centred label is centred and "Plaintiff,"
 * stands under the party's name. Each row is a table of its own at exactly
 * those widths (.fit, a fixed table: the spaces a cell ends with run on
 * unseen), and every `─` run is drawn where the grid puts its ends, at the
 * middle of its row: two halves of one rule meet at the bar between them on
 * one line, and a rule line of its own never wraps or runs off the paper.
 *
 * A box never wraps (a wrapped cell is a box with a hole in it), and the
 * sheet never widens for one either: every other page is centred in a column
 * as wide as the widest sheet, so one wide table in an exhibit set the whole
 * document off to the side of the stage in a field of grey. A page whose rules
 * run wider than its paper has its grid TIGHTENED until they fit (solvePage),
 * as far as GRID_MIN, and past that its rules DRAWN SMALLER (fitWide) — their
 * type and their grid, not the sheet — the way the PDF itself holds a table
 * on the page.
 *
 * Side by side every line is positioned on its own: there the page's rules
 * are given one left edge as well (on a page with no numbers; a numbered
 * page's lines all begin at its margin already), and each row of a box made
 * as tall as the gap to the row below it, so its bar meets the next row's.
 *
 * `root` is the column, a page, a page's body, or a list of them.
 */
export function fitRuleRows(root) {
  const roots = (Array.isArray(root) ? root : [root]).filter(Boolean);
  const bodies = new Set();
  for (const r of roots) {
    if (r.classList && r.classList.contains("page-body")) bodies.add(r);
    else if (r.querySelectorAll) for (const b of r.querySelectorAll(".page-body")) bodies.add(b);
  }
  const pages = [];
  for (const body of bodies) { const p = readPage(body); if (p) pages.push(p); }
  if (!pages.length) return;
  fitPages(pages);
  fitWide(pages);
}

/** A page's rules read off it (reads only): its rows, its grid's character and where the grid is counted from. */
function readPage(body) {
  const fixed = body.classList.contains("fixed");
  const numbered = body.classList.contains("numbered");
  const rows = [], loose = [];
  let originChars = Infinity;
  for (const line of body.querySelectorAll(":scope > .line")) {
    const lt = line.querySelector(":scope > .lt");
    const g = line.classList.contains("num") ? line.querySelector(":scope > .gutter") : null;
    const glen = g ? g.textContent.length : 0;
    // On pleading paper the grid is counted from the body margin: the
    // narrowest number's own characters in (columns.js, dressColumns).
    if (numbered && g && lt && lt.textContent.trim()) originChars = Math.min(originChars, glen);
    const row = lt ? readRow(line, lt, glen) : null;
    if (row) rows.push(row);
    else if (line.__ruled || line.classList.contains("fit") || (lt && lt.classList.contains("rg"))) loose.push(line);
  }
  if (!rows.length && !loose.length) return null;
  if (!numbered || originChars === Infinity) originChars = 0;
  // The grid's character: the reader font's average one (text-reader.js
  // writes it on the root) in the page's body type — on the PDF's grid the
  // PDF's body type at the grid's scale (--body-em) — or, on a page laid on
  // the export's grid read back off the PDF, that grid's own.
  const cs = getComputedStyle(body);
  const be = cs.getPropertyValue("--body-em").trim();
  const em = /px$/.test(be) ? parseFloat(be) : parseFloat(cs.fontSize) || 16;
  const colN = parseFloat(document.documentElement.style.getPropertyValue("--col-n"))
    || parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--col-n")) || 0.5;
  let cg = fixed && body.classList.contains("cgrid") && body.__charGrid ? body.__charGrid : null;
  // Beside a PDF whose grid could not be read off it (.rowleft), the export's
  // lines still span the type the PDF prints, from its leftmost character to
  // its rightmost, as PDF-Linker read them off that page: the rules are set
  // on that span (text-reader.js writes where the type stands, __typeBox).
  if (fixed && !numbered && !cg && body.__typeBox) cg = typeGrid(body, body.__typeBox, colN * em);
  const sec = body.closest(".tpage");
  return {
    body, fixed, numbered, rows, loose, originChars, cg, unit: cg ? cg.unit : colN * em, f: 1, g: 1,
    // Side by side on a page with no numbers each line stands at a left of its
    // own, so its rules are given one: the grid's left, or where its rows'
    // text says the grid begins.
    moves: fixed && !numbered,
    // A box wider than its paper is drawn smaller — on a flowing sheet only:
    // beside its PDF a sheet is the PDF page's width and each row is set at
    // its PDF row's own size.
    wide: !fixed && !!sec && !sec.classList.contains("matched") && !sec.classList.contains("swapped"),
    origin: 0,
  };
}

/**
 * The grid of a page whose PDF gave none: { x0, unit, right }, the export's
 * columns spread across where the PDF's type stands (`box`, px) — its first
 * character where the type begins, its last where it ends — or null where
 * that makes no character a font could have (`guess` is the reader's own).
 */
function typeGrid(body, box, guess) {
  let lo = Infinity, hi = -Infinity;
  for (const line of body.querySelectorAll(":scope > .line")) {
    const t = serializeNodes(line);
    const a = t.search(/\S/);
    if (a < 0) continue;
    lo = Math.min(lo, a);
    hi = Math.max(hi, t.trimEnd().length);
  }
  const unit = hi > lo ? (box.right - box.left) / (hi - lo) : NaN;
  if (!(unit > 0.25 * guess && unit < 4 * guess)) return null;
  return { x0: box.left - lo * unit, unit, right: box.right };
}

/**
 * A line's rules as the file writes them, or null for a line that has none to
 * set: a box row (.rl) and its cells' text, or a line of `─` runs and spaces
 * and nothing else (after its margin number).
 */
function readRow(line, lt, glen) {
  if (line.classList.contains("rl")) {
    const bars = barsOf(line), cells = cellsOf(line);
    // The bars are counted in the file's text and the cells in the line's
    // own: a row where they disagree is left to the table layout rather than
    // set on a grid its cells do not answer to.
    if (!bars.length || cells.length !== bars.length + 1) return null;
    const text = serializeNodes(line);
    const segs = cells.map((c, i) => {
      const from = i ? bars[i - 1] + 1 : glen;
      return ruleCell(text.slice(from, i < bars.length ? bars[i] : text.length), from);
    });
    return { line, lt, bars, cells, segs };
  }
  if (!lt.querySelector(".rh")) return null;
  const text = serializeNodes(line).slice(glen);
  if (!/^[ \u2500]*\u2500[ \u2500]*$/.test(text)) return null;
  return { line, lt, bars: [], cells: [lt], segs: [ruleCell(text, glen)], free: true };
}

/** Pages set: every one prepared, then every one measured, then every one written — a pass lays the document out once. */
function fitPages(pages) {
  for (const p of pages) prepPage(p);
  for (const p of pages) measurePage(p);
  for (const p of pages) applyPage(p, solvePage(p));
}

const setPx = (el, prop, v) => {
  const want = +v.toFixed(4) + "px";
  if (el.style.getPropertyValue(prop) !== want) el.style.setProperty(prop, want);
};

/** A line this pass no longer sets, given back to the layout: whatever a pass before wrote taken off it. */
function loosen(line) {
  line.classList.remove("fit");
  if (line.style.width) line.style.width = "";
  if (line.style.height) line.style.height = "";
  if (line.__ruled) {
    // …its left the one the layout laid it at (side by side on a page with no
    // numbers the page's rules were given one of their own).
    const l = laidOf(line);
    line.style.left = !isNaN(l[0]) && !isNaN(l[1]) ? l[1] + "px" : "";
    line.__ruled = false;
  }
  const lt = line.querySelector(":scope > .lt");
  if (lt) {
    lt.classList.remove("rg");
    clearRuns(lt);
    if (lt.style.getPropertyValue("--box-fit")) { lt.style.fontSize = ""; lt.style.removeProperty("--box-fit"); }
  }
  for (const c of cellsOf(line)) {
    c.classList.remove("rg");
    clearRuns(c);
    for (const prop of ["width", "padding-left", "text-indent", "font-size"]) if (c.style.getPropertyValue(prop)) c.style.removeProperty(prop);
  }
}

/**
 * A page made ready to be measured (writes): each box row at the size it is
 * drawn at, and each cell's text set where the file sets it on the grid —
 * as far past the bar before it as the file has it, its own opening spaces
 * taken back off — so what is measured next is what is drawn.
 */
function prepPage(p) {
  for (const line of p.loose) loosen(line);
  p.loose = [];
  const u = gridUnit(p, p.g);
  // Beside its PDF the grid is the PDF's and does not give; a box whose text
  // would push it off the sheet has its text set smaller instead (fitWide).
  const cellSize = p.fixed && p.f < 1 ? (p.f * 100).toFixed(1) + "%" : "";
  for (const row of p.rows) {
    if (row.free) continue;
    const { lt, cells, segs, bars } = row;
    if (p.wide) {
      const size = p.f < 1 ? (p.f * 100).toFixed(1) + "%" : "";
      if (lt.style.fontSize !== size) lt.style.fontSize = size;
      if (p.f < 1) lt.style.setProperty("--box-fit", String(p.f)); else lt.style.removeProperty("--box-fit");
    } else if (lt.style.getPropertyValue("--box-fit")) { lt.style.fontSize = ""; lt.style.removeProperty("--box-fit"); }
    const pads = padsOf(p, row, u);
    row.padded = pads;
    segs.forEach((s, i) => {
      const c = cells[i];
      c.classList.toggle("rg", !!s.runs);
      if (!s.runs) clearRuns(c);
      const indent = s.t != null && s.lead ? `calc(${s.lead} * var(--col-sp-n, 0.25) * -1em)` : "0px";
      setPx(c, "padding-left", pads[i] || 0);
      if (c.style.textIndent !== indent) c.style.textIndent = indent;
      const size = s.t != null ? cellSize : "";
      if (c.style.fontSize !== size) c.style.fontSize = size;
    });
  }
}

/**
 * The px a column of the file's text stands apart on a page: its grid's —
 * on a flowing sheet whose rules run wider than its paper, tightened (`g`)
 * and then drawn smaller with their type (`f`; fitWide).
 */
const gridUnit = (p, g = 1) => p.unit * (p.wide ? p.f * g : 1);
// The furthest a flowing sheet's grid is tightened before its rules' type is
// drawn smaller instead: past it, a rule ending in the open is too short to
// read as the line it is in the file.
const GRID_MIN = 0.5;

/**
 * Where each cell's text is set in from its left, px, on a grid of `u`: as far
 * past the bar before it as the file sets it (the bar is a pixel wide), the
 * first cell from the body margin (a numbered row's own spaces are its
 * number's, in the margin with it). Null for a cell with no text.
 */
function padsOf(p, row, u) {
  return row.segs.map((s, i) => (s.t == null ? null
    : Math.max(0, i ? (s.t - row.bars[i - 1]) * u - 1 : (s.t - p.originChars) * u)));
}

/**
 * What a page's rows need (reads): each cell's text, up to its last
 * character and a space more — the spaces the export ends a cell with only
 * carry it to its bar on the grid, and in a wide face they run past it — and
 * where the rows begin.
 */
function measurePage(p) {
  for (const row of p.rows) {
    if (row.free) continue;
    // What the text needs past where it is set in: the same at any grid.
    row.ext = row.segs.map((s, i) => (s.t != null ? needOnGrid(row.cells[i]) - (row.padded[i] || 0) : 0));
    // A numbered row's first cell begins past the margin's: its table is that much wider.
    row.gutter = Math.max(0, row.cells[0].getBoundingClientRect().left - row.line.getBoundingClientRect().left);
  }
  if (p.fixed) {
    p.width = p.body.clientWidth;
    const box = p.rows.find((row) => !row.free);
    p.gutter0 = box ? box.gutter : 0;
  }
  // Where the page and its rows stand on the screen: the grid is set on the
  // screen's own pixels (solvePage).
  const b = p.body.getBoundingClientRect();
  const first = p.rows[0];
  p.bodyAt = b.left;
  p.rowsAt = first ? (first.free ? first.lt : first.cells[0]).getBoundingClientRect().left : b.left;
  if (p.wide) p.room = b.width ? b.right - (parseFloat(getComputedStyle(p.body).paddingRight) || 0) - p.rowsAt : 0;
}

/** Where the rule rows of a page with no grid begin: where their text says, the grid's character on from it. */
function rowleftOrigin(p, u) {
  const est = [], lefts = [];
  for (const row of p.rows) {
    const l = laidOf(row.line)[1];
    if (isNaN(l)) continue;
    lefts.push(l);
    let t = Infinity;
    for (const s of row.segs) if (s.t != null) { t = s.t; break; }
    if (Number.isFinite(t)) est.push(l - t * u);
  }
  if (est.length) { est.sort((a, b) => a - b); return Math.max(0, est[est.length >> 1]); }
  return lefts.length ? Math.max(0, Math.min(...lefts)) : 0;
}

/** A page's grid worked out (pure, but for reading the records the layout left). */
function solvePage(p) {
  // Every column on a whole pixel of the screen: the rows' left (given them
  // here where the page moves them) and each place from it.
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  if (p.moves) p.origin = Math.round((p.bodyAt + (p.cg ? p.cg.x0 : rowleftOrigin(p, p.unit))) * dpr) / dpr - p.bodyAt;
  const at0 = p.moves ? p.bodyAt + p.origin : p.rowsAt;
  const snap = (v) => Math.ceil((at0 + v) * dpr - 0.001) / dpr - at0;
  // No bar a character past the page's type (its form number, its page count
  // end at the right margin, where its boxes do) or past its sheet: the grid
  // is a fit, and runs a little wide at the far side of the page.
  const reach = p.cg ? Math.min(Number.isFinite(p.cg.right) ? p.cg.right : Infinity, p.width || Infinity) - p.origin - 1 : Infinity;
  const at = (g) => {
    const u = gridUnit(p, g);
    const grid = pageGrid(p.rows.map((row) => {
      const pads = padsOf(p, row, u);
      return { bars: row.bars, cells: row.segs.map((s, i) => (s.runs ? { runs: s.runs } : { need: s.t != null ? pads[i] + row.ext[i] : 0 })) };
    }), { place: (o) => (o - p.originChars) * u, reach, slack: p.cg ? u : 0, snap });
    grid.u = u;
    grid.right = grid.rows.reduce((m, r) => Math.max(m, r.right), 0);
    return grid;
  };
  // A flowing sheet's rules wider than its paper: the grid gives first, as
  // far as GRID_MIN — the columns drawn closer, the type in them the page's
  // own — and only past that the type (fitWide), the one size the boxes
  // were drawn at before they stood on the page's grid. Every rule of the page
  // gives together, so they still meet.
  const fits = (grid) => grid.right <= p.room + 0.5;
  p.g = 1;
  const grid = at(1);
  if (!p.wide || !(p.room > 0) || fits(grid)) return grid;
  let lo = GRID_MIN, hi = 1, best = at(GRID_MIN);
  p.g = GRID_MIN;
  if (!fits(best)) return best;
  for (let k = 0; k < 10; k++) {
    const mid = (lo + hi) / 2, g = at(mid);
    if (fits(g)) { lo = mid; best = g; } else hi = mid;
  }
  p.g = lo;
  return best;
}

/** A cell or a line's `─` runs drawn where the grid puts them: a hairline each, at the middle of its row. */
function drawRuns(el, runs) {
  if (!runs || !runs.length) { clearRuns(el); return; }
  const s = el.style;
  const img = runs.map(() => "linear-gradient(currentColor, currentColor)").join(", ");
  const pos = runs.map(([a]) => `${+a.toFixed(4)}px 50%`).join(", ");
  const size = runs.map(([a, b]) => `${+Math.max(1, b - a).toFixed(4)}px 1px`).join(", ");
  if (s.backgroundImage !== img) s.backgroundImage = img;
  if (s.backgroundPosition !== pos) s.backgroundPosition = pos;
  if (s.backgroundSize !== size) s.backgroundSize = size;
  if (s.backgroundRepeat !== "no-repeat") s.backgroundRepeat = "no-repeat";
}
function clearRuns(el) {
  const s = el.style;
  if (!s.backgroundImage && !s.backgroundSize) return;
  s.backgroundImage = ""; s.backgroundPosition = ""; s.backgroundSize = ""; s.backgroundRepeat = "";
}

const topOf = (line) => { const l = laidOf(line); return isNaN(l[0]) ? parseFloat(line.style.top) : l[0]; };

/** …and written. */
function applyPage(p, grid) {
  // The grid the page's rules were set on, for whatever reads them back: its
  // character in px, how far it was tightened and how small its type drawn.
  p.body.__rules = { unit: grid.u, g: p.g, f: p.f };
  p.right = 0;
  const boxes = [];
  p.rows.forEach((row, k) => {
    const out = grid.rows[k];
    p.right = Math.max(p.right, out.right);
    const { line, lt } = row;
    line.__ruled = true; // set here: given back whole when it no longer is (loosen)
    if (p.moves) setPx(line, "left", p.origin);
    if (row.free) {
      lt.classList.add("rg");
      // Laid out with its glyphs at their own width it may have been read as
      // too long for its sheet and narrowed (text-reader.js); the rule is the
      // grid's now, and is not.
      if (lt.style.transform) { lt.style.transform = ""; lt.style.transformOrigin = ""; }
      drawRuns(lt, out.runs[0]);
      return;
    }
    line.classList.add("fit");
    const pads = padsOf(p, row, grid.u);
    const last = row.cells.length - 1;
    row.cells.forEach((c, i) => {
      if (pads[i] != null) setPx(c, "padding-left", pads[i]);
      // The cell after the last bar takes whatever the table has over: a
      // table fixed at a width its columns do not add up to, to the last
      // sixty-fourth of a pixel, shares the difference out among them, and a
      // bar a pixel wide drawn at a pixel and a sixty-fourth is two pixels
      // wide on the screen.
      if (i < last) setPx(c, "width", out.widths[i]);
      else if (c.style.width) c.style.width = "";
      if (row.segs[i].runs) drawRuns(c, out.runs[i]);
    });
    setPx(line, "width", row.gutter + out.widths.reduce((a, b) => a + b, 0) + row.bars.length + 1);
    boxes.push(row);
  });
  // Side by side each row of a box as tall as the gap to the row below it, so
  // its bars meet the next row's; a row that is the last of its box keeps its own.
  if (!p.fixed) return;
  boxes.forEach((row, k) => {
    const next = boxes[k + 1];
    let h = "";
    if (next && next.line === row.line.nextElementSibling) {
      const top = topOf(row.line), below = topOf(next.line);
      if (!isNaN(top) && !isNaN(below) && below > top) h = (below - top) + "px";
    }
    if (row.line.style.height !== h) row.line.style.height = h;
  });
}

// How many times rules too wide for their paper are measured and drawn
// smaller. The first answer is nearly exact (only the one-pixel bars do not
// shrink with the type); the rest take up what rounding leaves over.
const WIDE_PASSES = 3;
// The smallest a box's text is set beside its PDF to keep its rules on the sheet.
const BOX_TYPE_MIN = 0.6;

/**
 * Rules wider than their paper, drawn smaller until they fit.
 *
 * The TYPE in the boxes gives, and the grid they are set on with it; the sheet
 * does not. Every rule of the page takes the one smaller size, so its boxes
 * keep their shape and their rules still meet one another, and the art ends at
 * the page's right margin. The numbered margin beside it is not part of it and
 * keeps its size. Beside its PDF the grid is the PDF's own and the sheet the
 * PDF page's width, so only the text in the boxes gives there, where it would
 * push a box past the sheet's edge, and no smaller than BOX_TYPE_MIN (the
 * reader's font is not the filing's, and runs wider in a cell than the PDF's
 * did). Every page is measured before any is written, so a pass lays the
 * document out once however many boxes it has.
 */
function fitWide(pages) {
  let todo = pages.filter((p) => p.wide || p.fixed);
  for (let pass = 0; pass < WIDE_PASSES && todo.length; pass++) {
    const over = [];
    for (const p of todo) {
      const room = p.wide ? p.room : p.width - (p.moves ? p.origin : p.gutter0);
      if (!(room > 0) || !(p.right - room > 0.5)) continue;
      // (a flowing sheet's grid has given all it does: GRID_MIN, solvePage)
      // Beside its PDF only the text gives, and only so far: past that the
      // box runs off its sheet rather than be set too small to read.
      let want = Math.floor(p.f * (room / p.right) * 1000) / 1000;
      if (p.fixed) want = Math.max(BOX_TYPE_MIN, want);
      if (want > 0 && want < p.f) { p.f = want; over.push(p); }
    }
    if (over.length) fitPages(over);
    todo = over;
  }
}

/**
 * What a cell's TEXT needs, from the cell's left: up to its last character and
 * a space more. The spaces the export ends a cell with only carry it to the
 * next bar on the grid, and in the PDF's own face and size they run wider than
 * the grid's characters (a notice in 9-point bold): measured with them, a cell
 * pushed its closing bar out past the PDF's rule.
 */
function needOnGrid(c) {
  if (!c) return 0;
  let last = null, at = -1;
  const walk = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) { const i = n.data.search(/\S\s*$/); if (i >= 0) { last = n; at = i; } }
  if (!last) return 0;
  const r = document.createRange();
  r.setStart(last, at);
  r.setEnd(last, at + 1);
  return r.getBoundingClientRect().right - c.getBoundingClientRect().left + 0.28 * (parseFloat(getComputedStyle(c).fontSize) || 0);
}
