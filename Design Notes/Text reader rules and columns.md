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
cell, a line across the cell — until its page is set on its column grid, when
a fitted row is a table of its own (`.fit`) and a run is drawn where the grid
puts its ends (`.rg`; "A straight rule in the file is straight on the page",
below). Every span carries the glyph as its text and no
`data-fake`, so `serializeNodes` and the clipboard are unchanged (pinned in
`test-textdoc.mjs`); `ruleParts` / `ruleShape` in `textdoc.js` are the pure
half. `undress` runs first on each pass and touches only lines that carry a
rule span, so the editor's caret text node on any other line is never
replaced.

What the table layout cannot do is done by `fitRuleRows` at the end of each
layout pass. (Since the owner asked for every straight rule to be straight in
both views, the grid is the PAGE's, not a stack's, and `ruleGrid` is gone:
`pageGrid`, "A straight rule in the file is straight on the page", below. What
follows is the stack it replaced, for the wobble it was built for.) A box's
rows were squared up as a STACK — every consecutive rule
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

A box never widens its sheet (still so; the page grid tightens its columns
before it draws a page's rules smaller, below). It used to (the line-lock rule, applied to
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
type may have given. `fitRuleRows` takes the column, a page, a page's body,
or a list of them.

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
the PDF places a box row by its own left instead (below). Once its page is set
on its column grid, every text cell of a box row is set in this way, written
by `fitRuleRows` in px (`padsOf`: as far past the bar before it as the file
has it, the first cell from the margin), which overrides `.ci` until the
row's cells are made again — "A straight rule in the file is straight on the
page", below. Checked in
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
baseline of the row the PDF printed it on. Pleading paper is neither cut nor
placed: its lines stand on their numbers in the reader's own type, and take
the PDF's weight and slant alone, run by run (below).

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
a box row's cell (`.rc`) takes its own where it differs, and every other run
of the line set otherwise takes its own in a wrapper (below). No face for
a symbol font (Wingdings' "o" is a box), an OCR layer's GlyphLessFont or a
Type 3 font: the type is in the scan, and a line carrying no face is not cut
or placed either — an OCR's words, and the reader's own face, as before. A line
the PDF does not print keeps the reader's face, as the flowing view does.
Widths are kept per FONT (`textEm` keyed by weight, slant and family) and a
faced line or cell carries its face's own space as `--col-sp-n`, which its
indent and `fitCells` read.

**Bold and italic, run by run** (`pdfsync.faceRuns`, `columns.faceLine`,
`.fc`; `pdfsync.numberedRowOf`, `planCells` with `place` false). The owner,
in chat, asked for per-run faces on every matched page, pleading paper
included, having weighed a Markdown export against it and kept the exports
plain text: PDF-Linker's scrub, the key's round trip and leak scans, and this
reader's character grid all read plain lines, and the PDF beside the export
already carries the faces. Until then a face was a CELL's: a form line was
cut at each PDF item and each cell took its item's face, so a face that
changes in the middle of a word (a name in italics and its "'s", a footnote's
number) was lost in the piece before it, and a pleading line, never cut at
the PDF's items, had no face at all. Now the faces are the RUNS'. `faceRuns`
turns the items `lineItems` finds in a line, glued or not, into runs in file
offsets: each from its item's text to the next found item's, or to the end of
its own text where the next is more than two characters further on (an item
the line does not carry between them) or there is none, that end moved to the
nearer edge of a word it would fall inside, since pdf.js's spacing and the
export's differ by a character here and there and a face that stops a letter
short of a word's end reads worse than one that runs a letter long; a run
never begins or ends inside a pseudonym or a spot keep (one beginning inside
begins after it, which keeps the face before it), and one whose face is not
known is left out. `faceLine` wraps each run set otherwise than its line in a
`.fc` span carrying that face, INSIDE whatever holds the run (a cell, a
cell's gap): the wrapper holds text, pseudonym spans, spot keeps and checkbox
marks and never a cell, so the columns' arithmetic — the cells' widths side
by side — never sees it, and a line carrying a rule glyph keeps the line's
face throughout, since `dressRules` reads its glyphs off top-level text
nodes. The wrappers carry no `data-fake` and are re-derived on every pass
like the cells (`lt.__faced` keys the text and the runs, so a line faced as
its runs say is left exactly as it is); `undressColumns` strips them before
a line is cut again, `spanRanges` reads through them, `unplaceLine` takes
them off, and since facing moves text nodes `placePages` and `unplacePage`
put the caret back by its offset, as a recut does, and never while an input
method is composing. A box row's cells still carry their faces themselves:
`rules.js` makes the cells afresh on every pass. On a numbered page the row
for each line is its number's row, the row its words were matched to
(`offGridTops`, which now says which row), or the row at its half line
(`numberedRowOf`, which `pdfIndents` reads too), the margin's own numbers
left out of the pieces (`matchItems`' `skip`: a "12" in the body would be
found for one, and the line's real pieces, looked for past it, never found);
`planCells` with `place` false cuts and places nothing, and its faces carry
no family, which `putFace` reads as the weight and slant alone, a regular one
written explicitly so a regular run inside a bold line reads regular. So a
pleading's lines stand on their numbers in the reader's own type and at their
row's size, bold where the PDF is bold and italic where it is italic, and
`placePages` no longer gates on a page having lefts. The PDF's family is NOT
applied on pleading paper: the owner asked for bold and italics, and a
family change would move a caption's space-laid columns. Measured on the two
test pages: the form's pieces where they were to the pixel, the pleading's
28 tops unchanged, both pages planned in a few milliseconds. Residuals: an OCR
layer's type has no face (GlyphLessFont), so a scan takes none; an item
`lineItems` does not find (its first words not in the line) leaves its text
in the face of the run before it. Tested in `test-pdfsync.mjs` (`faceRuns`,
`numberedRowOf`, `offGridTops`' rows), `test-columns.html` (a run's wrapper
inside a cell; a numbered line's faces alone, nothing placed) and
`test-form-look.mjs` (the form's "Clerk" in italics with its glued ", by"
regular; the pleading's heading and party in bold and one word of its body
in italics, nothing moved, and the runs kept with the pane shut, since a
matched page keeps its side-by-side look there).

**A box's bars on the PDF's grid** (`rules.ruleGrid`'s `place`, `planStack`,
`needOnGrid`, `.gridfit`; since the page grid, `pageGrid`'s `place`,
`solvePage`, `needOnGrid` and `.fit`, the same rules for every row of the
page). On a page laid on the export's grid read off the PDF
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
sheet, once SUM-100 had a grid. (The flowing sheet shared one lead until the
page grid: there it drew SUM-100's notice 88 px in, under the court box, and
now each row's first bar stands at its own column in both views.) No column is placed more than a character
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
the court's box, is set small. (Where a cell's text BEGINS is the grid's
since the page grid — as far past its bar as the file sets it — so "SUMMONS"
now stands over its column rather than at the cell's left.) Cutting a cell
would go through `fitRuleRows`' measuring as well as `placeLine`.

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

**A piece is found in the text it is cut in** (`matchItems`, `planCells`).
The owner, in chat: "The grid layout should never cause extra space between
letters in a single word." A line the file numbers carries its gutter number
in front of its text (`.gutter`, then `.lt`), and the pieces were found in the
whole line's `textContent` — gutter and all — while the cuts and places are
offsets into `.lt` (`lineMap`). On a numbered page that is laid by its
numbers this never mattered (placePages leaves it alone), but a numbered
export beside a PDF whose margin numbers are not text (drawn, or a layer
without them) is laid by its words like a form, and every cut stood the
gutter's width early: "Mari|gold", "Pla|intiff", "Sep|tem|ber", each piece
placed and sized on its own, with a gap where the PDF's next piece began.
`matchItems` now reads `.lt`'s text (`shown`), and `planCells` and the line's
lead (in the plan and in `placePages`) read the same. `test-form-look.mjs`
holds a pleading whose PDF has no numbers in its text and splits two lines'
words into pieces: no gap between a word's letters, no cell ending inside a
word.

**The margin numbers hang in the margin on a page laid by its words.** A
numbered line is two grid tracks, the gutter's (`--body-x`, the PDF's body
margin) and the text's. On a page whose PDF's numbers could not be read, each
line is laid at its PDF row's left, which is where the row's TEXT begins, so
the gutter track was drawn from there: the number in the body and the text a
whole margin (57 px at a 480 px page) further in. Standing every line the
gutter's width to the left of its row fixed that and broke the margin on a
page laid row by row (`.rowleft`), where each line has its own row's left:
an indented paragraph took its number in with it, so the numbers jumped
right line by line. Now (`p.gut`, `rowInd` in the write pass): on a `.cgrid`
page every line has the grid's one left, its indent being the file's spaces
on the grid, and the line stands the gutter's width left of it; on a
`.rowleft` page the line stays at the page's left, its number in the
margin's one column, and its text is set in by the row's indent past the
margin through `.pind` / `--pdf-ind`, as a pleading's own indents are. The
spill pass passes such pages by (the squeeze brings an overrunning line
back). `test-form-look.mjs` checks both on pleadings whose PDFs have no
numbers in their text: the text where the PDF prints it, an indented
paragraph set in, every number in one column.

**Only a piece the PDF sets apart is put where the PDF puts it**
(`pdfsync.standApart`, `APART_EM`). The owner, in chat: "It shouldn't
exaggerate spaces between words. Indentation should be reserved for the
beginning of a sentence. Currently it is causing visual gaps between words
that don't appear in the pdfs." A PDF sets a line of prose in several items
wherever its face changes, a kerning run breaks or a justified line's words
are spread; each was a piece set at its item's x, so wherever the reader's
font ran a hair narrower than the PDF's, a gap opened between two words, and
the file layout (`autoLayPage`) wrote those gaps as spaces. Now a found item
starts a piece only where the PDF leaves a gap of at least one type height
(a column's) after the item before it: `planCells` places only those (the
line's first piece always), the rest following the word before them a space
on; `autoLayPage` writes only those, so a line's spaces between words are the
file's own; and the character grid (`charGrid`'s pairs) is read only off
those, a justified line's spread words being no evidence of where the file's
characters fall. And `pdfRows` joins two items that touch on the page, in one
size, without a space in the row's text: a word set as "Plain" "tiff" is one
word, or the line it is shares no word with its row and is matched to none
(a superscript against its word keeps its space). `test-form-look.mjs` holds
a justified line (word spaces of 0.8 type heights) and checks no two words a
space apart in the file are drawn more than a wide space apart.

**A pleading's caption: the attorney block at the margin, the clerk's stamp
at the right** (`pdfsync.captionAlign`, `.cap-r`, `.cap-split`). The owner:
"The law firm name, attorneys, emails, address, phone numbers are always left
aligned. But frequently PDF viewer is mistakenly heavily indenting them.
Likewise, the stamp in the top right is always right aligned." On a numbered
page that is its PDF's first, the lines above the court's title are read by
their words: one carrying a filing stamp's (Electronically FILED, Superior
Court of California, Clerk of Court, Deputy, By, a date and time …) is the
stamp's and stands against the right margin; one whose last column (after
`COLUMN_GAP` spaces) is the stamp's carries both, the attorney's words at the
margin and the stamp's at the right (a flex row, `space-between`); every other
is the attorney block's, flush at the margin. None takes an indent off the
PDF's rows: the stamp is printed over the same heights, and the row nearest a
number was as often its as the line's (`pdfIndents` read "TEASDALE-VANE LAW"
off the stamp's row, 270 px in). A lone clerk's name ("Edgecombe W. Slayton,")
is the stamp's too where it stands over the stamp's line of the clerk's
office ("Executive Officer/Clerk of Court"), as a stamp sets it: a person's
name alone (`PERSON_RE`), with nothing an attorney's line carries (`SBN`, an
email, a phone, a firm's LLP — `ATTORNEY_RE`). `test-form-look.mjs`
prints a stamp on the sample pleading, its second line at line 2's very
height with the firm's name under it. And `docBodyLeft` counts a PDF's rows
read as well as its numbers in what it keeps its answer by: a poor scan's
margin, read before any row had arrived, was kept as none for good.

**…and laid on the paper's numbers** (`scanGeom`, `geom.scan`). The owner,
next: "The added numbers from number lines are not uniformly spaced with the
half spaces baked in." Laid by its words, each line stood on whatever row of
the scan its words matched, so the numbers ran unevenly and a half line stood
wherever the OCR had put it. Such a page now takes the numbered path with a
grid of its own: `scanGeom` fits line 1's top and the pitch (`slotFit`) to the
rows the page's numbered lines' words matched (`rowLayout`), else pleading
paper's own (line 1 an inch down, 28 lines to an inch from the foot); every
number then stands a pitch below the last (`slotTops`), a half line halfway
between its two, with no line pulled onto the scan's rows (`offGridTops`
passed by), every line in the document's type, no face, and no indent but the
file's own spaces (`pdfIndents` passed by). `test-form-look.mjs` puts three
lines of each such test PDF a few points off the pitch and checks every
number a pitch below the last. The grid is kept on the paper (`PAPER_MARGIN`,
an inch): line 1 between half an inch and two inches down, and the pitch no
more than leaves the last line's foot an inch above the page's — the owner,
"The pleading goes too far down, it also needs an inch of margin at the
bottom" — checked in the same test.

**…and run down the length of it** (`SCAN_FIT_MIN`, and `rows` read but
empty). The owner: "The number lines should place the numbers through the
length of the text page, with margins at the top and bottom. I just had one
where the 1-28 only went halfway down the page, despite the page matching the
pdf size." A single-spaced filing numbered by # Number lines has a number on
every row of the scan, so `slotFit` read single spacing off those rows and the
28 numbers stopped halfway down the sheet. A fit whose pitch is under
`SCAN_FIT_MIN` (95%) of the paper's own (line 1 to an inch above the foot, in
28 lines) is now dropped for the paper's grid, so the numbers run from the top
margin to the bottom one. The same holds for a scan with no text layer at all,
which was laid flowing at the reader's leading and also stopped part of the
way down: it now takes the paper's grid too, its body at the paper's inch
(`geom.bodyX`) because no margin can be read from it. `test-form-look.mjs` lays
both (a scan's rows 12 points apart, and a PDF with no text) and checks line 1
within two inches of the top and line 28 within an inch and two lines of the
foot (before the fix: 286 px short on the single-spaced scan). That file's
poor-scan checks now read only the open document's page out of the reel.

**…drawn apart from the lines, which stay where their words put them**
(`marginNums`, `p.margin`, `.own-margin`). The owner, next: "Generally, when
there are no numbers, the text is placed at the correct spot. Adding the
numbers shouldnt move the text. It should only add the number margins." Laid
on the numbers, a poor scan's lines moved off the rows the PDF prints them on.
A poor scan with a text layer is now laid by its words exactly as the same page
without numbers is (`rowLayout`, the same tops and lefts; only the type is the
document's, as above), and `scanGeom`'s grid is no longer the lines' but the
margin's: `marginNums` draws 1 to 28 at one pitch in a `.margin-nums` column in
`.page-inner`, outside the page body (never selected, copied, saved or
edited), right-aligned where a numbered line's gutter puts its number, with the
paper's rule beside them. Each line keeps its own number in the DOM, since the
file writes it, and its gutter track, so the text does not move; `.own-margin`
only hides it. A line that is only its number takes no room (`room`), as a
blank line takes none on the page without numbers, or the single-spaced lines
under it were pushed down. A scan with no text at all has no rows to lay a line
on and is still laid on the paper's numbers (`geom.scan`). `test-form-look.mjs`
opens each poor scan's export without numbers beside the same PDF, then with
them, and checks every line's first character at the same place to 1.5 px, the
lines' own numbers hidden, and the drawn column 1 to 28 at one pitch down the
page between its margins.

**…but only where the numbers run as a margin does** (`marginRuns`). The
owner, of an exhibit's invoice: "some of the text is being pushed up off the
page", "it seems to just be this page". Three lines opening with a number make
a page `numbered` (`pageIsNumbered`), and the invoice had them: a "25" of its
days, a "1" and an "8" and a "3" of its quantities. With no margin numbers in
its PDF it took the path above, its "1" stood at line 1 an inch down, and the
forty lines the file has before it were crowded over the page's top. The path
is now taken only where at least `MARGIN_RUN_MIN` (5) numbers climb down the
page (`numberChain`) and they are at least half of the numbers from 1 to the
highest; any other numbered page is laid by its words as before.
`test-stray-numbers.mjs` lays such an invoice beside its PDF and checks every
line stands on the page, in order (before: the first 22 lines over the top).

**A numbered page whose PDF's numbers are no text is a poor scan, set in the
document's type** (`poorScan`, in the plan's rows path). The owner: "when I
use the add number margins button, it should apply the same font used
elsewhere in that document, rather than attempt to base it on the pdf. The
fact that the numbers didn't come through indicates that page was not a good
scan." Such a page (numbered in the file, by # Number lines or by hand, and
no `geom` read off its PDF) is laid by its words as before — each line on the
row it matched, its indent where that row starts — but every line takes the
document's body type (`base`) and no cells: no size, weight, slant or piece
from the OCR's reading of the scan, whose sizes come out a line at a time.
`test-form-look.mjs` checks every line of such a page in one size and the
reader's own face.

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

### A straight rule in the file is straight on the page (`rules.pageGrid`, `fitRuleRows`)

The owner, in chat: "Where the raw text has straight lines, those lines
should still be straight in the viewer. Like a form box, or a separate
statement. Parallel and perpendicular lines should still be parallel and
perpendicular. Also, this should remain true even when using side by side
view."

In the file a rule is straight because every glyph of it stands at one
character column. Eight Judicial Council forms (CIV-110, SUM-100, MC-011,
CM-010, PLD-050, LASC CIV 109, POS-010, MC-350EX) and a separate statement
on pleading paper, made into exports by PDF-Linker and read back out of the
reader in both views (52 pages), showed where they were not:

- the separate statement drew each rule between two facts in two halves at
  different heights — the half before the divider an inline run on the
  text's middle, the half after a whole cell's line on the row's — and side
  by side its divider jumped 23 px at every rule row (the rule row's first
  cell was measured with its `─` glyphs at their own width);
- a box's side stepped a pixel wherever a row with more bars met one with
  fewer (CIV-110 under its caption, PLD-050, MC-350EX): each bar is a cell a
  pixel wide, and every cell after one was as wide as its columns, so each
  bar before a column pushed it a pixel;
- a divider or signature line drew at its glyphs' width — 226 px past
  CIV-110's box flowing, wrapping onto a second line of its own; 32 px past
  it side by side;
- separate boxes down one column of the file stood wherever their own rows
  put them (MC-011's amounts, from 480 to 690 px);
- flowing, a stack of two boxes, one under the other's side, shared one lead
  (SUM-100's notice drawn 88 px in, under the court box);
- beside a PDF whose grid could not be read (`.rowleft`, LASC CIV 109's first
  and fourth pages), the rows were ragged and ran off the sheet.

Every rule glyph of a page — its boxes' rows, and its lines of nothing but
`─` runs (after the margin number, a numbered one too) — is now set on ONE
column grid (`pageGrid`, pure, `test-rules.mjs`): a column of the file is one
x on the page, whichever row, box or rule line a glyph of it stands in. The
columns are the bars' offsets and the runs' free ends (a run opening just
past a bar is drawn from it, one ending at a bar to it); offsets within
`RULE_COL_SLOP` (3) of the FIRST of a column are that column (counted from
the first, so a run of near offsets does not chain into one), never two of
one row's own. Each column stands at its place on the page's character grid
— `(offset − origin) × unit`, the unit the reader's average character in the
page's body type (`--col-n` × `--body-em`) and `origin` the margin number's
characters on pleading paper; side by side on a `.cgrid` page the export's
grid read off the PDF; on a `.rowleft` page the export's columns spread
across where the PDF's type stands, its first character where the type
begins and its last where it ends (`typeGrid`, from the `__typeBox`
applyMatchedLayout writes off the PDF's rows) — and further right only where
a cell's text needs it, and then that column's whole way down the page. A
cell needs its room PAST the bar before it, so a bar stands at its column
whatever number of bars come before it in its row. Each column moves on to
the screen's next whole pixel (`snap`, from where the page stands on the
screen and `devicePixelRatio`): fractional widths drew one row's bar two
device pixels wide and its neighbours' one.

Each row is a table of its own then (`.fit`, `table-layout: fixed`, where the
flowing sheet's rows shared anonymous tables) at exactly the widths the grid
gives; the cell after the last bar takes whatever the table has over, since a
table fixed at a width its columns miss by a sixty-fourth of a pixel shares
the difference out among them, the bars too. Each text cell is set where the
file sets it — as far past the bar before it as the file has it, its own
opening spaces taken back off (`padsOf`: a `padding-left` and a negative
`text-indent`; the first cell from the margin, as `indentBoxRow` sets it
before a fit) — so a centred label is centred, and its need is its text from
there, up to its last character and a space (`needOnGrid`). Every `─` run in
a cell of runs and spaces, and in a line of nothing but runs, is drawn where
the grid puts its ends (`.rg`: background layers, a hairline each at the
middle of the row, the glyphs at no size): from the bar it opens on, to the
bar it ends at, and a free end at its column — over a bar's own pixel where a
bar of another row stands in that column, so a divider under a box ends
where the box does. A rule line's glyphs take no room and no height (a glyph
of no size still stood a line's leading about the baseline, and the line grew
by half of one), so it never wraps; the layout's spill and squeeze
(text-reader.js) pass over such lines.

Side by side on a page with no numbers every rule line is given the page's
one left (the grid's), and each row of a box is as tall as the gap to the
row below it, as before. A flowing sheet whose rules run wider than its paper
tightens its grid first, down to `GRID_MIN` (0.5) of the page's — the columns
closer, the type the page's own, the boxes nearer their text, as the stacks
drew them — and only past that draws the rules' type smaller (`fitWide`, as
before); the grid on a page laid on its PDF is the PDF's and does not give,
so there a box whose text would push it off the sheet has the text in its
cells set smaller, no smaller than `BOX_TYPE_MIN` (0.6) (LASC CIV 109's table,
set in the reader's font, ran a column past its sheet). `body.__rules` says
what grid a page was set on.

Read back the same way, every bar down its column, every row's runs against
one another and their corners, every run against the bar beside it and every
column across the page agree on all 52 pages in both views, the bars to a
twentieth of a pixel and each on a whole pixel of the screen.
`test-straight-rules.mjs` (the real reader, both PDFs made in the page) holds
a form page and a separate statement on pleading paper to the same, and
passes at a device pixel ratio of 2 as well. Against origin/main no line of
the 52 pages moved up or down side by side. Flowing, a page's type is sized
now without rule glyphs drawn at their own width — a divider wrapping onto a
line of its own held a form's type down — so most form pages are set a
little larger, and a box row is one height whatever it carries.

Not changed: side by side, a rule line the PDF prints no text on is laid by
the line spacing from the line above it (`pdfsync.rowLayout`), so where the
PDF sets the next row closer than that the rule is drawn over that row's text
(MC-011, the underline under item 11b across 11c). Straight, and in its
order in the file, but on the wrong side of the text; laying it between its
neighbours instead would move the lines under it on every such page.
