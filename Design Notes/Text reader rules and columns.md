# Text reader: rule glyphs and columns

### Rule glyphs drawn as boxes (`viewer/rules.js`)

PDF-Linker writes a page's line art into its export as box-drawing glyphs,
which read as a box only in a monospace font at single spacing. `rules.js`
re-derives, on every page fill and every line-restructuring edit, a set of
spans over each line's rule glyphs: a line with vertical bars becomes
`.line.rl` (`display: table-row`; its `.lt` `display: contents`) holding
`.rc` cells split at `.rb` bar cells (one pixel wide, filled to the row's
height), consecutive lines whose bar offsets agree (measured on the whole
line, gutter included — a numbered row and its unnumbered continuation
agree) share one anonymous table, and a line whose offsets differ from the
row above is `.rt` (`display: table`, its own columns) so two stacked boxes
never share columns. A line of nothing but rules is `.rr`, half a line tall;
a `─` run is `.rh`, a line at its own width, or `.rc.hf` when it is a whole
cell, a line across the cell. Every span carries the glyph as its text and no
`data-fake`, so `serializeNodes` and the clipboard are unchanged (pinned in
`test-textdoc.mjs`); `ruleParts` / `ruleShape` in `textdoc.js` are the pure
half. `undress` runs first on each pass and touches only lines that carry a
rule span, so the editor's caret text node on any other line is never
replaced.

What the table layout cannot do is done by `fitRuleRows` at the end of each
layout pass: a box's rows are squared up as a STACK — every consecutive rule
row, not only the run whose bars fall at the same offsets — against one
column grid (`ruleGrid`, pure, `test-rules.mjs`). Bar offsets within three
characters of each other are one column, never two of one row's own, and
each column is set far enough right for every cell that ends there. Without
it the art's own wobble shows: a notice line too long for its box pushes
that row's closing bar a character or two out, and that row, measured alone,
was drawn at its own width — and side by side, where every line is
positioned on its own, at its own left as well. The stack takes one left
edge there and each row the height of the gap to the row below, so its bars
meet the next row's. `test-rules.html` reads the geometry back out of a page
in both views.

A box never widens its sheet. It used to (the line-lock rule, applied to
boxes), and since `#pages` is `width: max-content` with every sheet centred
in it, one wide table in an exhibit set put every other page of the document
off centre in a column thousands of pixels wide. `fitWide` draws a box wider
than its paper smaller instead: the rows' `.lt` (`display: contents`) take
one percentage font size, so only the cells shrink and the numbered margin
keeps its size, and the stack is squared up again at that size. Up to three
passes (the one-pixel bars do not shrink). Not on the grid: a matched sheet
is the PDF page's width and each row is at its PDF row's size. Every stack is
measured before any is written (`planStack` / `applyStack`), so a pass costs
a handful of layouts rather than one per box. The fit is redone when the
paper's width changes (`applyPageWidthNow`, which runs after the layout pass
on a zoom or resize) and for the pages `shapePages` has just fitted, whose
type may have given. `fitRuleRows` takes the column, a page, or a list of
pages.

### Columns laid out with spaces (`viewer/columns.js`)

The same character grid lays a page's columns out with SPACES: a Westlaw
printout's right-hand column, a caption's case number and causes of action, a
filing stamp, a centred heading, an indent. In a proportional font a space is
about half an average character, so a column began wherever the text to its
left ended — ragged where the page is straight. `textdoc.columnCuts` says
where a line's spaces cut it between columns: after each gap of `COLUMN_GAP`
(3) spaces or more, or a two-space gap landing on a column two lines of the
page begin at (`columnStops`), so a sentence's double space is never a column.
`lineIndent` says how deep its text stands from the body margin: its leading
spaces off pleading paper; on pleading paper, where the margin is `origin`
characters in (the narrowest number's prefix) and a numbered line's spaces
are all its number's (`GUTTER_RE`, drawn in the hidden `.gs`), `start + lead −
origin` — so a centred heading, "Plaintiff," under the party's name, and a
line of the caption's right-hand column alone on its number stand where the
export set them (they used to fall back to the margin with the number's
spaces). `columnWidths` gives each cell its width from past the indent. All
pure, tested in `test-textdoc.mjs`.

`dressColumns(body)` runs in `dressBody` after `dressLines`, after a replace
(`settleReplaced`, the next hit kept by text offset), and 400 ms after typing
stops (`recolumnSoon`, the caret kept by text offset when anything moved). The
grid's character is the reader font's average, measured on canvas
(`charWidth` → `--col-n`, with the font's space as `--col-sp-n`, both in ems).
An indented line gets `.lt.ci` with `--ind` (grid characters in) and `--lead`
(its own spaces, which stay drawn) and a `text-indent` making up the
difference — no element, since most indented lines are nothing else. Each
piece before a column gap is a `.cc` (`inline-block`, `white-space: pre`,
`min-width` of `--cols` grid characters, a two-character right padding), its
gap's spaces in a `.cg` that takes no width and no height out of the editor
(on the grid a line's leading is in pixels, which a sizeless span still stood
on, dropping the line's text below its number). Cells are measured in the
page's BODY type, `--body-em` (a registered `<length>` property, so `1em` on
`.page-body` reaches every line as pixels): a line set in its own row's size
keeps the page's columns. A line already dressed as its text says is left as
it is (`dressedAs`), and a line with no run of spaces and no indent is passed
over on its `textContent` without serializing it. `rules.js` takes the cells
off a line carrying rule glyphs before wrapping the glyphs, and box rows
(`.rl`) never get cells. A line with a column gap is `.line.cols`:
`shapePages` reads those unwrapped (`.cols-measure`, every page at once in
`columnCaps`) and starts the page's fit no larger than its widest column line
fits across the paper, since a wrapped column comes back at the left margin.

`columnCuts` cuts at a gap of 3+ spaces always; at 2 where two lines of the
page begin at that column; at 1 where the page's SECOND column is — a column
`COLUMN_FIRM` (3) lines begin at, `COLUMN_FIRM_AT` (12) characters in or more
(`hasFirmColumn`) — since a justified left-hand column runs right up to it.
`columnStops` returns column → lines. A page with a second column has every
line read, not only those with a run of spaces.

The grid unit is `--col-u`: in the flowing view and on pleading paper,
`--col-n` × `--body-em`; side by side `--body-em` is the PDF's body type at the
grid's scale (`--grid-em`, written with the grid). Pleading paper keeps all of
it there: every line starts at the body margin.

A page with NO numbers side by side is set on the export's own grid read back
off the PDF (`pdfsync.charGrid`): for each line whose matched row (`rowLayout`
now returns `rowOf`) begins with the line's first word, a pair (the column its
text begins at, the row's left), fitted Theil–Sen (median slope over pairs
4+ columns apart, then median intercept) to { x0, unit } in PDF units; no
grid with fewer than two lines 4+ columns in, a slope outside 1.5–15 pt, or
under 60% of the pairs within 1.5 units. With one (`.cgrid`, `--grid-col` =
unit × scale): every line's left is x0, its indent and cells are in the
grid's unit, so a right-hand column stands where the PDF prints it on every
line; a box row (`.rl`, not cut into columns) is set in by what its leading
spaces fall short of the grid. Without (`.rowleft`): each line at its row's
left as before, its leading spaces cancelled by a negative `text-indent` — the
row's left IS where its text begins, and the spaces on top of it set every
indented line in twice as far. On every grid page a cell whose text runs wider
than its cell (the reader's font set at the PDF's size runs wide) is squeezed
into it (`width` = its `min-width`, `scaleX`), measured and written for the
pages near the reading before the existing slide-back and line squeeze, so a
column is never pushed there; `clearMatched` undoes it.

Two more fixes made a two-column page stand where its PDF does. `pdfRows`
keeps an item out of a row when it shares no baseline with anything in it (by
1 pt or 0.15 of the type) and stands a gutter (1.5 × the type) from all of
it: the halves are set to their own leading and sat a few points apart, close
enough for the superscript tolerance to make them one row, which left one of
the export's two lines nothing to match. And `spreadTops` / `holdWithin` take
`spans` ([from, to) in the export's characters, per line): a line clears only
the lines it stands under, by more than `SPAN_SLOP` (3) characters or half the
shorter line, so the halves are never one line pushed under the other — that
push ran the page a third again past its PDF.

The cells are wrappers with no `data-fake`: serialization, Find, the LEAKS
walk and every offset into the page are unchanged. Cost: about 2.5 ms per
two-column page at open, about 0.4 ms per pleading page.

### The numbers never move on the grid (`pdfsync.spreadTops`)

`spreadTops(tops, box, fixed)` keeps lines from landing on each other; with
`fixed` (a pleading page's numbered lines) those lines are never moved, and the
lines between two of them are held above the next — spread evenly between
them where they cannot all have their room. On a numbered page the room a
line needs is its TYPE size, not `LINE_BOX` × it: a caption's single-spaced
lines between two numbers are set a type size apart, and a box apiece pushed
each a few points down into the next — and every number after them, until the
numbers down the side were out of step with the PDF's and two stood crowded
together where the push ran out. `holdWithin` takes the same room, or it
pulled the caption back up past its numbers from the foot. Tested in
`test-pdfsync.mjs`.
