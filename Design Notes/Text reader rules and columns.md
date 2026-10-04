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
keeps its size, and the stack is squared up again at that size; the first
cell's indent (`indentBoxRow`, below) shrinks by the same factor
(`--box-fit` on the `.lt`), or the first pass falls short of the margin by
the indent's share and three passes do not make it up. Up to three passes
(the one-pixel bars do not shrink). Not on the grid: a matched sheet
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
(3) spaces or more, or a two-space gap landing on a column two lines around
it begin at (`columnBands`), so a sentence's double space is never a column.
`lineIndent` says how deep its text stands from the body margin: its leading
spaces off pleading paper; on pleading paper, where the margin is `origin`
characters in (the narrowest number's prefix, a box row's included) and a numbered line's spaces
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
(`.rl`) never get cells. A box row's FIRST cell is still set in where the
export indents it (`indentBoxRow`, after the rows are counted for `origin`):
`.rc.ci` with `--ind` and `--lead` from `lineIndent`, drawn as a
`padding-left` of `--ind` grid characters with the `--lead` spaces an
unnumbered row opens with taken back off by `text-indent`. A numbered row's
spaces are its number's, so "Plaintiff," under the party's name, "vs." and
"Defendants." stood flush against the side of the caption box however far in
the export set them. Padding, not `text-indent`, so an empty first cell (a box
the export draws in from the margin) and a rule across its cell take it too:
an indented `.hf` draws its line over its content box only, and `needOf`
(`fitStacks`) counts its padding, since a cell is never narrower than that and
a row that is its own table (`.rt`) would push its bar out past the stack's.
Off the grid and on numbered pages beside the PDF; an unnumbered page beside
the PDF places a box row by its own left instead (below). Checked in
`test-rules.html` ("a caption on numbered paper"). A line with a column gap is `.line.cols`:
`shapePages` reads those unwrapped (`.cols-measure`, every page at once in
`columnCaps`) and starts the page's fit no larger than its widest column line
fits across the paper, since a wrapped column comes back at the left margin.

`columnCuts` cuts at a gap of 3+ spaces always; at 2 where two lines begin at
that column; at 1 where the line stands beside a SECOND column — since a
justified left-hand column runs right up to it. Both are read per line from
`columnBands(lines)`: a column is where lines begin (text start, or after a
3+ gap, counted from the page's edge), and it runs down the lines that begin
at it, across `COLUMN_REACH` (3) lines or fewer that do not, and stops; a run
of two lines or more covers every line from its first to its last (`stops`,
column → the run's lines). It is a second column there (`second`) with
`COLUMN_FIRM` (3) lines, `COLUMN_FIRM_AT` (12) in or further, and text on both
sides of it on one of them at least. A form's columns are pieces of its page
— the box beside the caption, the party boxes beside a signature — and lines
that only START at a column are an indent, not a column beside another. They
used to be counted down the whole page (`columnStops`, `hasFirmColumn`), and
on the 49 Judicial Council forms in the user's templates (145 pages through
`pdftotext -layout`) that cut prose at a single space 652 times
("ATTORNEY OR PARTY | WITHOUT ATTORNEY", the caption run across the checkbox
items' column 18 thirty lines below); by bands, 8, the cuts at 3+ spaces
(2,313) unchanged. `dressColumns` builds the bands over every line in page
order (a plain line, which begins nothing, still counts for distance) and
reads a plain line only where its own band has a second column. No cut falls inside a span
(`atoms`: the line's pseudonym and spot-keep spans, from `spanRanges` in
columns.js) — `splitAt` splits text nodes only, so a cut inside a name put the
whole name in a cell sized for the characters before the cut, and side by side
squeezed it to a smear.

A JUSTIFIED page in two columns (the user's contract terms: a left-hand
column filling its width, the second at 62) reaches its second column with a
space or two on most lines, and those begin nothing there; the run is only the
lines that fall short of it. Its first three lines were above the first such
line, so out of the band, and were drawn as one line, the right-hand column
straight on from the left. So a second column's band now runs on past its run
(`columnBands`, the `close` of a run): over each line, one at a time, that
LANDS on it — text at the column, one or two spaces before it, text before
those — where the column is TIGHT (a line of its run comes within
`COLUMN_TIGHT`, 4, of it, or a line inside the run lands on it), and over a
line within `reach` that begins a character either side of it (an OCR'd page
sets the column a character off on some lines). A blank line, or one that
does not land, ends it. A form's box, whose labels stand well clear of their
column, is not tight, so the prose beside it is not cut on a space that
happens to fall there; landings PAST the ends do not make a column tight
either, since one line of prose beside a box can put a word on its column by
chance (tested both ways in `test-textdoc.mjs`).

Off the PDF's grid the cells' widths on the font's AVERAGE character did not
hold such a page: a justified left-hand piece runs up to its column, and
capitals run half as wide again, so each piece overran its cell by its own
amount and pushed its own line's right-hand column on — ragged, and run into
the left. Each SECOND column is now placed for the font (`textdoc.placeColumns`,
pure; `columns.alignColumns`): columns within `COLUMN_SNAP` (2) of each other
are one, a line's cut a character either side of one is on it, and the column
stands at the same place down every line beside it — its place on the grid,
or the widest text to its left plus a gutter of `COLUMN_GUTTER` (4) grid
characters, whichever is further, but no further than `COLUMN_STRETCH` (1.5)
times its place on the grid (a line far past that pushes only itself). Every
other place on such a line keeps its grid distance from the column before it,
so a gap or an indent in the right-hand column moves with it; a third column
is placed past the second the same way. The widths are the pieces' own, read
off the font on a canvas (`textEm`, cached per font; a name as it is shown,
the gap's spaces left out, a line the PDF set apart at its own size), so a
pass costs no layout: about a millisecond for a page, where reading them off
the page cost five. `dressColumns` places a page as it dresses it, and
`shapePages` places the pages it fits (after their line sizes, which
`applyPdfTypeSizes` sets there) and the trailer's page it leaves to flow.
The places are written in the page's body type, `--cx` on a cell (its width)
and `--ind-x` on an indented line (where its text begins), both under `.cx`,
which `.page-body:not(.fixed)` reads, so the fit to the paper scales them and
side by side ignores them. A line or cell placed before and not now is put
back on the grid (`unplace`), and `undressColumns` takes the place off with
the cells. `test-columns.html` checks the straight column, the gutter with a
line of capitals beside it, the page set smaller, and a line put back.

Side by side, a page whose every line has both halves begins no line anywhere
but the margin, so `pdfsync.charGrid` had no two lines four columns apart to
fit and the page fell back to `.rowleft`, ragged as above. `pdfRows` now keeps,
on a row whose halves share a baseline, where each half after the first
begins (`breaks`: an item a gutter of 1.5 × the type clear of everything
before it, and its first word), and the grid's pairs take a two-column line's
right-hand half too: the break whose word the half begins with, or the row
itself where the line was matched to its right-hand half. That page gets a
grid, and its right-hand column stands where the PDF prints it.

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
than its cell (the reader's font set at the PDF's size runs wide) is held to
it by `columns.fitCells`: where the text fits in the blank before the next
column's text a space short of it (`min-width` less one space), it keeps its
own width over the cell's margin and `width` = `min-width` holds the column;
past that it is squeezed into that blank (`scaleX`, no narrower than
`CELL_SQUEEZE_MIN`, 0.75; past the floor `width` is what the squeezed text and
a space need, which pushes the column). Measured and written for the pages
near the reading before the existing slide-back and line squeeze; every cell
with a `width` or a transform is let out before it is measured, and
`clearMatched` undoes both. `test-columns.html` checks each case in a page.

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
