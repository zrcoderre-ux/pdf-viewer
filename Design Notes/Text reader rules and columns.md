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
(`settleBody`, the next hit kept by text offset), and 400 ms after typing
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
fit and the page fell back to `.rowleft`, ragged as above. `pdfRows` kept, on
a row whose halves share a baseline, where each half after the first begins
(`breaks`), and the grid's pairs took a two-column line's right-hand half
too. Both are gone since the form look (below, "A form beside its PDF looks
like the PDF"): the grid's pairs are every piece of type a line carries
(`pdfsync.lineItems`), the right-hand half among them, and `pdfRows` keeps
each row's items in place of its breaks. That page gets a grid, and its
right-hand column stands where the PDF prints it.

The grid unit is `--col-u`: in the flowing view and on pleading paper,
`--col-n` × `--body-em`; side by side `--body-em` is the PDF's body type at the
grid's scale (`--grid-em`, written with the grid). Pleading paper keeps all of
it there: every line starts at the body margin.

A page with NO numbers side by side is set on the export's own grid read back
off the PDF (`pdfsync.charGrid`): for each piece of type a matched line
carries (`rowLayout` returns `rowOf`; `matchItems` finds the items of the
line's row and of the rows beside it in the line, `pdfsync.lineItems`), a pair
(the column the piece begins at, the item's x) — a box row's pieces too, not
one a checkbox leads or one glued to the text before it — fitted Theil–Sen
(median slope over pairs 4+ columns apart, then median intercept) to { x0,
unit } in PDF units; no grid with fewer than two pairs 4+ columns in, a slope
outside 1.5–15 pt, or under 60% of the pairs within 1.5 units. Until the form
look the pairs were each line's first word against its row's left, and a page
of boxes (CM-010's first, SUM-100) had too few of them for a grid. With one (`.cgrid`, `--grid-col` =
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

### A form beside its PDF looks like the PDF (`placePages`, `columns.placeLine`, `pdfsync.lineItems`, `pdfFace`)

The owner, in chat: "I want to use PDF viewer to compensate. Even if the
underlying text file has a wider row, I want PDF viewer to show me something
that looks as much like the pdf as possible. The underlying text file can
deviate as needed, so long as it is not misleading or confusing to the claude
model reading it." And, of everything here: "Line numbering is still
paramount in the text file and in the viewer." So the export stays laid out
for a model to read, and the reader, side by side, is what looks like the
form — without ever moving a line. Every export line is still one line, in
its order, on its own row: a piece of it moves ACROSS and takes its own size,
never up or down, and a smaller piece sits on the line's baseline, not on the
baseline of the row the PDF printed it on. Pleading paper is untouched.

**A checkbox is one piece, in both views** (`textdoc.checkboxRanges`,
`checkboxState`; `columns.dressCheckboxes`). PDF-Linker writes a box as
`[   ]`, `[ X ]` or `[ ? ]` (`[ ]`, `[X]`, `[?]` in older exports). The empty
one's three spaces are `COLUMN_GAP`, so the columns cut inside it — on CIV-110
"(TYPE OR PRINT NAME OF [   ] ATTORNEY" drew as "[" … "]ATTORNEY", and
"[   ] Plaintiff/Petitioner [   ] Defendant/Respondent" put a "[" at the end of
one cell and "] Plaintiff/Petitioner [" in the next. A mark is an atom of
`columnCuts` now, whoever asks (`columnBands`, the char grid's pairs, the
cells), so no cut and no column begins inside one. `dressColumns` wraps each
mark, on every line, a box row's too, in a `.cb` span (its state in
`data-cb`: `x`, `?`, none for empty) before anything is cut, and the
stylesheet draws it as a square 0.74 em on a side at the line's own type size,
from the baseline to about a capital's height, an X or a ? in it. The mark's
characters stay underneath, transparent: the box takes exactly the room its
text does, so every width worked out from the text (the cells' grid,
`placeColumns`, a prefix side by side) is the box's, and the span carries no
`data-fake`, so a save, a copy, Find and the LEAKS walk read the mark as they
always did. It is an inline-block, so no line wraps through it, and NOT
`contenteditable=false` like the rule spans: in the editor (`body.editing`)
the mark is drawn as the text it is, to be typed into — an X typed into a box
makes it a ticked box on the next pass, and a mark typed into something else
is text again (re-derived on every pass, like the rule spans). Tested in
`test-textdoc.mjs` and `test-columns.html`, in both views.

**Each piece where the PDF prints it, at its own size** (`pdfsync.rowItemsNear`,
`lineItems`; `text-reader.js`, `planCells`, `placePages`; `columns.placeLine`,
`lineMap`). pdf.js hands a page's text over as ITEMS, a run of type each — a
new one wherever the form leaves a gap or changes face — and a line's text
carries them in order. `pdfRows` keeps each row's items (with the item's font
id); a matched line's candidates are its row's and those of every row whose
span down the page overlaps it that no other line was matched to, less any
standing over one of its own across the page (a line above or below) — the
export writes CIV-110's "causes of … [   ] Plaintiff/Petitioner" as one line,
and the PDF prints the labels two points lower, a row of their own.
`lineItems` finds each item in what the line SHOWS (the real names, as the
PDF prints them; `lineMap` carries a place on screen to its place in the file,
under the fakes) by its first words, up to three, in order after the last one
found, so two items that open alike are told apart; where its text begins (its
"(" of "(date):" where the line has it too) and at what x; and where its piece
begins — the same place, or a checkbox a space before it, since the PDF draws
the box and its item is the label. A piece begins only after a space and never
inside a pseudonym or a spot keep: an item glued to the text before it (a
superscript, a link inside its parentheses) is marked `glued`, counts for the
line's face and begins nothing; an item of a row beside the line has to be
found by four letters or more. On CIV-110's first page it finds 133 pieces on
63 rows, every one where it belongs. The page's char grid is fitted from the
same pieces (above), so a page of boxes whose every line begins at the margin
— CM-010's first page, SUM-100 — has a grid now, and its boxes stand on it.

The line is cut wherever a piece begins (`planCells` writes the cuts on the
line as `__grid`, { text, cuts }; `dressColumns` adds them to the column cuts
while the line is the text they were planned for, `gridCuts`) — so a label the
export joins to the text before it with ONE space is a cell of its own (CIV-110
line 46: the 7-point footnote and, after a single space, the 9-point "Attorney
or party without attorney for" printed at 353.6). `placeLine` gives each cell
the min-width that puts the piece after it at its place (so `fitCells` still
squeezes a piece too wide for its room, unchanged), its own size and its own
face where they are not the line's; the piece after the last cut is no cell,
so the line takes ITS size and face on its `.lt` (the `.line`'s box, which the
spacing down the page is worked out from, stays the row's — `spreadTops` and
`holdWithin` get the same sizes as before), and the first piece is placed by
the line's own left. A piece no item claims (PDF-Linker's notes, a word the
run changed) keeps the grid's place: on the export's grid read off the PDF
(`.cgrid`) its column there, on a page without one the reader's grid on from
the piece before. Sizes: a piece's item's own, the line's within a fifth of
it — and the line's here is its ROW's own height, not the page's body that
`typeSizes` takes a row within a fifth of to be. A piece standing at the PDF's
x and drawn at a size not the PDF's is a width not the PDF's: SUM-100's body
is about 7.5 points, its 9-point "(For proof of service of this summons, use
Proof of Service of Summons (form POS-010).)" was drawn at 7.5 and came out
with gaps between its pieces.

A page laid on pleading numbers is not cut, faced or placed (`planCells` runs
only off the numbers), and nothing here touches `tops`. Checked in
`test-form-look.mjs` (the real reader, both PDFs made in the page): a form
page's lines read back in their order, stand down the page in it, and each is
one line high with every piece on its baseline; a pleading page's numbered
lines stand exactly at `pleadingGeometry`'s line tops. Against origin/main the
pleading's 28 numbered tops are the same to the last digit, and on seven forms
brought to the reading a page at a time — CIV-110 (115 lines), POS-010 (119),
CM-010 (214), SUM-100 (86), MC-011 (247, its numbered fourth page among them),
PLD-050 (69) and LASC CIV 109 (330) — every line's top, line height and order
is the same.

**The PDF's own face** (`pdfsync.pdfFace`, `faceKey`; `text-reader.js`,
`noteFaces`, `mostFace`, `boxCellFaces`). pdf.js's text content says only which
of three families a font falls in (`styles[fontName].fontFamily`: serif,
sans-serif, monospace); its NAME ("QZRSCC+Arial-BoldMT") is on the font object
pdf.js loads to draw the page, in `page.commonObjs`, and the weight and slant
are read off that name — pdf.js's own `bold`/`italic` are set only on a font it
put a system face in for. The page in the pane is normally drawn before its
grid is read, which loads its fonts; where it has not been, the page's
operator list is asked for once (`getOperatorList`, 4–76 ms of worker time a
page measured cold on six Judicial Council forms, the first page of a
document dearest; it was never needed opening those six), and each font id is
asked about once, kept on the PDF's reading (`info.faces`, since a PDF told to
put down what it holds lets its fonts go). The name maps to faces the machine
may have: Arial, Helvetica, Liberation Sans (cut to Arial's widths), Arimo,
then sans-serif; Times New Roman, Times, Liberation Serif, Tinos, serif;
Courier New, Courier, Liberation Mono, Cousine, monospace; a face a filing is
commonly set in (Calibri, Cambria, Garamond, Century Schoolbook, Book Antiqua…)
first where the machine may have it. A line takes the face most of what it
carries is set in (not its matched row's alone: CIV-110's caption line is three
of the PDF's rows, and was matched to "FOR COURT USE ONLY", in bold italics);
a cell or a box row's cell (`.rc`) takes its own where it differs. No face for
a symbol font (Wingdings' "o" is a box), an OCR layer's GlyphLessFont or a
Type 3 font: the type is in the scan, and a line carrying no face is not cut
or placed either — an OCR's words, and the reader's own face, as before. A line
the PDF does not print keeps the reader's face, as the flowing view does.
Widths are kept per FONT (`textEm` keyed by weight, slant and family) and a
faced line or cell carries its face's own space as `--col-sp-n`, which its
indent and `fitCells` read.

**A box's bars on the PDF's grid** (`rules.ruleGrid`'s `place`, `planStack`,
`needOnGrid`, `.gridfit`). On a page laid on the export's grid read off the PDF
(`.cgrid`, `body.__charGrid` in px) a bar the file sets at column c is the
PDF's rule at x0 + c × unit, to within half a character, so each column of
bars is set there at the least: the box is the PDF's box, however little of it
its text fills. Measured there, a cell needs its TEXT and a space, not the
spaces it ends with: in the PDF's own face at 9-point bold those ran wider than
the grid's characters and pushed CIV-110's notice past the PDF's rule. And a
`white-space: pre` table cell is never narrower than its text and those spaces,
whatever width it is given, so such a row is a fixed table (`.gridfit`) at the
width its cells and bars add up to, the spaces running on unseen.

There each row's first bar stands at its OWN column (`ruleGrid`'s `heads`): a
stack of rule rows is often two boxes, one under the other's side —
SUM-100's notice under the court's box, the case number's box under that —
and the one lead every row shares in the flowing sheet stood the notice's
left side under the court box's, 259 px in, and its right side off the
sheet, once SUM-100 had a grid. (The flowing sheet still shares one lead: it
is not laid on the PDF, and was left as it was.) No column is placed more than a character
(`slack`, the grid's unit) past the furthest right the PDF prints type on the
page (`reach`, `__charGrid.right`: a form's number and its page count end at
the right margin, where its boxes do): the grid is a fit and runs a little
wide at the far side of the page (PLD-050's right side stood 8 px past the
PDF's rule), and PDF-Linker widens a box to hold a notice in small type, so
the bar its text pushes out stands far past the PDF's rule on the grid
(SUM-100's, 37 px, off the sheet). A form whose type stops a little short of
its box's side keeps the grid's place (LASC CIV 109's table, 5 points). And a
stack whose every row the layout slid back into its indent before its box
was fitted (its `─` runs, at their glyphs' own width, ran past the sheet)
has no record of where its rows were laid; on the grid it now stands at the
left they were slid to and is squared up there (MC-011's TOTAL boxes, whose
sides missed their own top and foot by 47 px, on origin/main as well). A
slid row's top is still the one the layout wrote, so it is made as tall as
the gap to the next row like any other, and the box's sides meet.

Measured against the PDF's rules (read off its operator list for the
measuring, at 0.9837 px a point), left to right, px: CIV-110's caption 35,
389, 567 against 35.4, 389.5, 566.6 (it was ~461 px wide against the PDF's
~532, its inner column ~355 px in against ~389); SUM-100's notice 32, 565
against 35.6, 566.6, its court box 430, 565 against 424.5, 566.6, its case
number's 358, 565 against 357, 566.6; MC-011's SHORT TITLE box 35, 391, 567
against 35, 390, 567 (origin/main 36, 266, 403), its TOTAL boxes 483, 566
against 483, 567 (origin/main: their sides 436 to 501 and 483 to 549, no box
square); CM-010's 32, 216, 386, 567 against 35, 221, 390, 567; LASC CIV 109's
second page 32, 94, 197, 499, 565 against 35, 97, 195, 496, 567 (origin/main:
no grid, bars ragged to the sheet's edge); PLD-050's 33, 391, 566 against 35,
390, 567. Off the grid, and on pleading paper, a box is its cells' own as
before. Tested in `test-rules.mjs` and `test-rules.html`.

Refused: reading the rules off the operator list (`constructPath` and
rectangle ops) to set the bars exactly. It costs the page's operator list
(4–76 ms of worker time a page, on top of the draw's own) and a walk of the
transforms to bring each path to the page, and the grid, held to the page's
type, already lands within 5 px of the PDF's rules on these forms, most of
them within 2 — and a form's drawn rectangles are not always the boxes the
export drew (a widget's own frame, a shaded band).
Also refused: moving a piece up or down to the row the PDF printed it on (the
line rule), and a face on pleading paper (laid on its numbers; Times beside
Georgia would read closer, but nothing about the numbered margin is to move).
Not done yet: the text inside a drawn box's cells is not cut into pieces — a
box row is a table, and its cells take the PDF's faces but keep the export's
spaces — so CM-010's case-type list, inside its box, stands narrower than the
PDF's three columns, and SUM-100's "SUMMONS", in the first cell of a row of
the court's box, is set small and to the left of where the PDF centres it.
Cutting a cell would go through `fitRuleRows`' measuring as well as
`placeLine`.

Costs, measured in Chromium on CIV-110, POS-010, SUM-100, MC-011, CM-010,
LASC CIV 109 and PLD-050, every page brought to the reading in turn: finding
the pieces, fitting the grid on them and planning them (`matchItems`,
`charGrid`, `planCells`) 3.5–10 ms a page, the first page of a session (the
code and the faces new) counted in, 2–4 ms on a warm page — on top of the
page's existing `rowLayout`, 20–40 ms on these dense forms; the placing pass
(`placePages`) 1.5–6.5 ms a page a pass, the most the first time a page is
cut by its PDF's items (`dressColumns` again). The fonts' operator list was
asked for no time on any of them. `window.__textReaderFormLook()` reports
these. Fitting a laid page's boxes (`fitRuleRows`) is 1–37 ms a page, almost
all of it the browser laying the page's tables out again once their widths
are written — measuring every cell's text on the grid (`needOnGrid`) is
0.6 ms for CIV-110's 103 cells, 1.3 ms for LASC CIV 109's 251 — and stays
within 9 ms of origin/main's on the same page either way (CIV-110's
first 9.4 against 3.8, CM-010's 22.5 against 15.8, LASC CIV 109's second
36.6 against 27.7; MC-011's third 9.2 against 19.4, SUM-100 10.8 against
11.8): a page laid on the grid now has boxes to fit where origin/main left
it ragged.

What the export could do better, for the reader and for the model: two pieces
the form prints apart written three spaces apart or more (today a few are
joined by one — the reader cuts them where the PDF's items begin, but the
model reads them as one phrase); a label not written on the line of a
footnote set two points higher in a smaller size (CIV-110 line 46 — the line
rule keeps it on that line, at its own size); a box drawn at the PDF's width,
its small type wrapped to fit it, rather than the box widened for its text
(SUM-100's notice: its closing bar, and the court box's above it, at a column
the grid puts 37 px past the PDF's rule — the reader holds it to the page's
type). And what the reader cannot recover from the PDF's text: an AcroForm
field's value — a filled field is a widget annotation, not text content.
`page.getAnnotations()` gives each widget's `fieldValue` (or a checkbox's
`exportValue` and on/off state) and its `rect`, so a value could be placed
where the form prints it; the export carries PDF-Linker's reading of the same
field, and the reader shows the export.
