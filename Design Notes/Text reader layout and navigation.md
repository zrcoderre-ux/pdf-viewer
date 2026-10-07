# Text reader: layout and navigation

### A PDF's SIZE, not just how many there are

Counting documents cannot tell a folder of pleadings from a folder of scanned
exhibits. A scan is forty megabytes a file, and what it costs while it is open
is far more than that: the bytes, the worker's parse of them, and — the large
one — every page that has been DRAWN, since pdf.js decodes a page's image at
the resolution it was scanned at (fifteen megabytes for a letter page at 300
dpi) whatever size the canvas it goes into. Measured in Chromium over four
19 MB / 100-page scans, rendering a hundred pages and never handing them back
costs 677 MB; handing each back as it goes costs 62 MB.

So, past the window above:

- **A budget of bytes.** `pdfBytes` remembers what each PDF weighed (kept
  after it is closed, like `pdfSizes`), `pdfSize` guesses an unopened one at
  the heaviest seen in this folder, and `pdfsInUse` takes the window in
  priority order — on screen, then the worksheet's next pages, then what the
  reading is near — stopping at `PDF_BYTES` (48 MB), with the first always let
  in since a document cannot be read without its PDF. `trimPdfs` keeps the
  `PDF_HELD` spares only while the budget still holds, so a folder of scans
  holds none and a folder of pleadings holds three as before. A folder of
  40 MB exhibit sets ends up with ONE PDF open while it is read.
- **A cap on pages drawn at once** (`DRAWN_MAX`, 6). The observer's margin
  normally keeps three or four, but reading fast down a long document leaves
  more behind than it lets go of — fourteen, measured. `noteDrawn` counts them
  oldest-first and gives back the oldest ones nothing is looking at, never one
  on screen and never one being drawn again.
- **Pages handed back to pdf.js** (`releasePage` → `page.cleanup()`). It
  refuses, by answering false, while a page is still drawing, so a page that
  will not go joins `pagesToRelease` and is asked again when the scrolling
  settles. `releasePagesIn` hands back every page a box is holding before the
  box is thrown away — a pane rebuilt at every document is otherwise the whole
  case kept a page at a time — and `readPdfGridNow` hands each page back as
  soon as it has read its text, since the grid reads every page of the PDF.
  `trimPdfs` also tells an open PDF with nothing of its own on screen to put
  down what it was holding (`pdf.cleanup()`), swallowing the refusal it
  answers with while a page is drawing.
- **A reel ceiling in PAGES** (`REEL_MAX_PAGES`, 600) beside the one in
  documents: twenty-five one-page proofs of service and twenty-five
  hundred-page exhibit sets are not the same reel. `reelTrim` now sheds
  between TWO members as well, which is where two two-hundred-page documents
  live.

Measured over four 38 MB / 200-page scans read end to end: peak 1335 MB → 1163
MB and two PDFs open → one; over six 34 MB files: 898 MB → 644 MB and six open
→ two. `__textReaderPdfQueue` reports the bytes against the budget and the
pages drawn against the cap; `__textReaderReel` reports what the reel is
carrying.

### Side by side, drawn in the order it is looked at

Measured in Chromium against a generated case folder — a 300-page pleading
export and its PDF, a 100-page 38 MB scanned exhibit, and forty 8-page filings
with a `Combined Text.txt` naming them all — with side by side on. Five things
stood between the reader and the PDF page they had scrolled to:

1. **The PDFs' fonts relaid the whole text column.** pdf.js loads a PDF's
   fonts as FontFaces into `document.fonts`, and Chrome answers any change to
   that set (a font added as a page is first drawn, the fonts removed by
   `cleanup()` and `destroy()`) by laying out every line of the document again
   — sixty thousand layout objects on the combined file, a third of a second
   each time. Every hop to another member's PDF, and every trim that told a
   PDF off the screen to put its fonts down, paid it. pdf.js now gets a hidden
   same-origin iframe's document as its `ownerDocument` (`viewer/pdf-fonts.js`,
   `fontDocument`, shared with the viewer): the fonts go into THAT set, and a
   page is drawn on a canvas of that document and copied onto the pane's
   (`renderPageOnto`). Checked pixel for pixel against a plain render,
   embedded and non-embedded fonts, in the hosted page and in the unpacked
   extension. **Every pdf.js `page.render` must draw on a canvas of that
   document** — on one of the page's own, a font embedded in the PDF is not
   found and its text comes out in a fallback (27,000 pixels of difference on
   a one-page test; see "Things to know").
2. **A new pdf.js worker per PDF.** `getDocument` starts (and `destroy`
   ends) a worker for every document it opens unless handed one: two
   megabytes of script compiled into a new thread, 95 ms an open. One
   `PDFWorker` is shared (`sharedPdfWorker`), 4 ms an open.
3. **The pages beside the screen were drawn before the page on it.** Every
   slot within `PDF_MARGIN` asked at once, in DOM order, and pdf.js serves
   in order: a jump to page 50 of the scan decoded pages 48 and 49 first.
   A slot ON screen now draws at once and one only near it waits its turn
   (`drawTurn`, `DRAW_AHEAD` = 1, nearest first, below before above). Whether
   a slot is on screen comes from the observers, never from a layout read:
   the pane and inline observers' own entries (`entryOnScreen`, since the
   order two observers report in is not promised) and `screenObserver`. And
   `releaseCanvas` now clears `data-want`: the mark outlived the release, and
   `fitSlot` redraws every slot carrying it, so a resize redrew every page the
   reading had ever passed.
4. **What could wait did not.** The measuring and the grid queued behind a
   PDF's open ran while the page on screen was still drawing, and the sizes
   landing laid the whole document out again first (400 ms on the 300-page
   export). Those jobs are `later`: while a page on screen is drawing
   (`drawingSeen`) the queue runs only opens (`nextPdfJob`), up to
   `DRAW_WAIT_MAX`. The measuring is a job per batch of 32, so a thousand-page
   PDF no longer holds the queue while another PDF's page waits to be opened,
   and `sizeSlotsFor` asks for the layout pass only where a slot's height
   actually changed.
5. **`fitSlot` opened a PDF to size a slot.** The layout pass fits every slot,
   and a slot whose page size was not known opened its PDF to find out — on
   the combined file, all forty PDFs queued at once (70+ jobs), each opened
   and closed again by `trimPdfs`, with the page on screen behind them. A slot
   nobody has asked to see now stands at the folder's paper
   (`pageRatioGuess`) until its PDF is opened for a reason of its own.

Two smaller ones: the PDF matching an export's own name is asked for before
its text is built (`openPdfAhead`), so the worker starts and the file is read
during the build (about 90 ms on the 300-page export); and `pdfTrimSoon` runs
at most every half second WHILE the reading moves instead of half a second
after it stops — with opens now cheap, reading straight down the combined
file without pausing held all forty PDFs open until the scroll stopped (41
open → 11 at most, 6 or 7 once it settles).

| side by side | before | after |
|---|---|---|
| 300-page export, first PDF page drawn | 2,592 ms | 1,510 ms |
| 300-page export, jump to a page | 86–94 ms | 25–37 ms |
| 38 MB scan, jump to a page | 1,043–1,259 ms | 351–382 ms |
| combined file of 40, jump to a page | 814–980 ms | 35–88 ms |

A scanned page's 350 ms is now the page itself: pdf.js 4.6 decoding a
300-dpi JPEG in its own worker.

### The PDF viewer draws what is looked at (`viewer.js`, `viewer.css`)

The viewer used to DRAW every page as a document opened, one after the other,
and keep every canvas: a 300-page brief was 300 bitmaps (well over a gigabyte
at 150%), and its citation links — which need only the text layers — waited
for the last of them. `renderAllPages` now builds each page's box, text layer,
links and highlights as before and leaves its canvas empty (0 × 0, so it holds
no bitmap; the wrapper's own size holds the page's place). Two observers with
the viewport as their root (`root: document`, so the margin also holds inside
the hosted app's iframe) draw a page when it comes within `DRAW_MARGIN` of the
screen and hand its bitmap back, with `page.cleanup()`, when it goes further.
A page on screen is drawn at once; the ones only near it wait until nothing on
screen is drawing and go one at a time, nearest first (`pumpPageDraws`).

The consequence the operator agreed to: **a print carries only the pages near
the screen drawn**; the rest print as their boxes. Printing from the viewer is
for looking at the page in front of you, which is always drawn.

Drawing late made the font problem above the viewer's too: a page far into a
document drawing with a font nothing before it used (an exhibit set in another
face) walked all 300 text layers — a 360 ms hold on the first visit to such a
page. The viewer opens its PDF into the same fonts' document
(`pdf-fonts.js`), so its page canvases, the thumbnails, the thumbnail cache,
the redacted copy and OCR's recognition image are all drawn by way of it.

`.page-wrapper` also takes `content-visibility: auto`: it carries its own
width and height, so a skipped page keeps its size, and a page is not painted
until it comes near the screen. The screen is byte-identical, a print carries
the same pages, and everything that floats over a page hangs off `<body>`, so
the containment has nothing to clip.

| PDF viewer | before | after |
|---|---|---|
| 300-page brief, page 1 drawn | 0.34–0.41 s | 0.40–0.47 s |
| 300-page brief, every page set up (links placed) | 17.3–19.7 s | 3.2–3.4 s |
| 100-page 38 MB scan, every page set up | 39.4 s | 1.3 s |
| 300-page brief, bitmaps held after opening | 300 | 2 |
| a jump to a page bringing new fonts, longest hold | 495 ms | none |

A jump to a far page of a SCAN now costs that page's decode (under a second
at 300 dpi), where before every page had been decoded up front.

What is left, largest first: opening a long export in the reader still holds
the thread about a second (300 pages) — the text is laid out once without the
pane and again beside it; and a scanned page's decode is pdf.js 4.6's own JPEG
decoder.

### The page is drawn in the screen's own pixels (`viewer.js`)

A page's canvas used to be sized to the page's CSS size, one bitmap pixel to
the CSS pixel, whatever the window's `devicePixelRatio` — the display's scaling
times the browser's zoom for the site. On any window not at exactly 1× (a
Retina or 150%-scaled screen, or a window zoomed to 110%) the browser stretched
that bitmap to fit, and every word on the page came out soft beside Acrobat.
The thumbnails and the text reader's page pane already drew at the ratio; the
viewer's own pages never had. `drawPage` now sizes the canvas at the page's
size times the ratio (`pageOutputScale`), shows it at the page's CSS size, and
has pdf.js draw through a matching `transform`. Past `MAX_PAGE_PIXELS`
(4096 × 4096, 64 MB of bitmap) the ratio is let down toward 1, never below it:
a page at 600% on a Retina screen would otherwise be a quarter of a gigabyte.
When the ratio changes — the window goes to a screen of another scaling, or the
browser's zoom is changed — every page drawn at the old one is drawn again
(`redrawForPixelRatio`).

The extension and the installed app draw the same bitmap at the same ratio,
checked pixel for pixel in Chromium; the app's iframe changes nothing. Chrome
keeps a zoom per site, though, so the two windows can sit at different ratios
on the same screen, and before this the one not at 1× was the soft one.

Measured in Chromium on a Letter page at 150% (918 CSS px wide); edge contrast
is the mean step in brightness between neighbouring screen pixels over the
type, and falls as type blurs:

| ratio | bitmap width before → after | edge contrast before → after |
|---|---|---|
| 1 | 918 → 918 | 8.86 → 8.86 (unchanged) |
| 1.25 | 918 → 1147 | 6.04 → 7.33 |
| 1.5 | 918 → 1377 | 5.05 → 5.83 |
| 2 | 918 → 1836 | 3.66 → 5.14 |

### Side by side: one size beside its PDF page, drawn in the screen's own pixels (`text-reader.js`)

Two things let a text page and its PDF page stand at different sizes, and three
let the PDF page come out soft.

**The labels were levelled against themselves.** A text page's label can wrap
(a REVIEW clause on a narrow sheet) where the slot's "PDF p. N" does not, so
`applyMatchedLayout` levels the two to the taller. It read each label's height
with whatever height the pass before had written still on it: a slot label
levelled up read back as tall as it was made, the next pass found the pair equal
and took the levelling off, and the pass after put it back — every other pass a
line's height out of step. Once the wrap went away (a wider window, a zoom), the
stale height was the taller one and was handed across for good. Each pass now
clears what it set, reads both labels at their own heights with
`getBoundingClientRect` (a pixel rounded away per page drifts the columns), and
levels from there.

**A shed page was pinned at the wrong height, beside a slot of the wrong
width.** `shedMember` took the page off the grid (`clearMatched`) and THEN read
the height to pin, which was whatever its text came to flowing off the grid; and
`applyMatchedLayout`, which passes over shed pages, sent their slots back to the
pane's own width, which differs from the page's wherever the two columns differ
or the reader is zoomed. The height is now read before the grid comes off, and a
shed page's slot takes the page's width and, like a slot with no PDF page, the
page's pinned height (cleared again when the page is built back).

Measured in Chromium, a pleading with REVIEW clauses on two pages, and a reel of
four ten-page filings:

| side by side | before | after |
|---|---|---|
| narrow window, a REVIEW page (text / PDF height) | 498 / 482 | 498 / 498 |
| the window widened again | 561 / 530 | 530 / 530 |
| then zoomed in a step | 580 / 611 | 580 / 580 |
| reel of four, pairs of different size | 30 of 40 (a legal page pinned at 2,475 beside 906) | 0 of 40 |

**The PDF page in the screen's own pixels.** The pane drew at
`devicePixelRatio` already, but showed the bitmap at the page's CSS size. Where
that size times the ratio is not a whole number (most sizes, at any ratio but a
whole one), the bitmap lands on a pixel more or fewer than it has and the
browser resamples the whole page to fit; which pages that hits depends on where
each falls on the screen's grid. The ratio was also held to 3, and a page drawn
before the ratio changed (the window moved to a screen of another scaling, the
zoom changed) stayed drawn at the old one until it happened to be drawn again.
`drawPage` and `paintWarm` now size the canvas through `sizeCanvas`: the bitmap
at `pageOutputScale` (moved to `pdf-fonts.js` and shared with the viewer, so the
pixel cap is the viewer's 4096 × 4096 rather than a ratio of 3), shown at
exactly `canvas.width / scale`, never taller than the box. The box — the sheet —
is the page's height rounded, the arithmetic the text page beside it is given,
so the two columns still agree to the pixel. `watchPixelRatio` (also shared)
redraws every slot drawn or being drawn when the ratio changes.

| ratio | before | after |
|---|---|---|
| 1.1 | 2 pages of 10 shown resampled | 0 of 10 |
| 1.25 | 1 of 10 | 0 of 10 |
| 1.5 | 5 of 10 | 0 of 10 |
| 1.75 | 10 of 10 | 0 of 10 |
| 1 → 2, a 602 px page already drawn | bitmap 602 × 779, stretched 2× | redrawn at 1204 × 1558 |

"Resampled" is the screen's copy of the page differing from the bitmap at every
whole-pixel offset. **Measure this in a real screen's scaling, not an emulated
one:** Playwright's `deviceScaleFactor` (headless shell) snaps a canvas to whole
CSS pixels rather than to the screen's, so a canvas sized exactly right still
shows resampled there, and one sized wrong can look fine. Launch Chromium in its
new headless mode (`channel: "chromium"`) with `--force-device-scale-factor` and
a `--window-size`, and a one-pixel checkerboard canvas shows whole-pixel
placement the way a 125% Windows screen does.

### The numbered margin is the boundary

A pleading's PDF carries furniture its export does not: the firm's name
printed down the left margin, a seal, a filing stamp. Each of those is a ROW
like any other to `pdfRows`, and each begins further left than the body does.
`rowLayout` took the page's margin to be `Math.min` of every row's left — so
one sideways firm name put the body's margin out in the furniture, and every
line the reader had to place itself (a line the export carries that the page's
rows do not match, which on a scrubbed export is many) was drawn out there
with it, left of the numbered margin.

The numbered margin is the outer boundary of anything the grid does, and it
should be straight down the page and the same on every page. So:

- `bodyLeftOf` reads the margin the rows SHARE — the left most of them begin
  at, to the nearest few points — instead of the least left of any of them.
- `docBodyLeft` takes one margin for the WHOLE PDF, from its pages' read
  geometries (`pleadingGeometry.bodyX`, which already ignores anything at or
  left of the numbers) or from the rows where none has been read. `--body-x`
  and the layout's floor both come from it, so the numbers stand in one column
  down the document rather than wandering a point or two a page with the
  measurement.
- `rowLayout` holds every line at that floor, matched or not, and the spill
  pass — which slides a too-long line back into the blank in front of it —
  gives back the indent and not a pixel more.

Measured in Chromium on a pleading whose PDF has the firm printed down the
margin and whose export has lines the rows do not match: the text column
started 36 px into the left margin and now starts at the body margin, with
real indents still indented.

**…and the caption box obeys it too.** The first page of a pleading is the
one page with a box on it, and it went on being drawn out over the line
numbers after the rest of the page had come back to the margin. A box row is
not the numbered grid: `rules.js` makes it a TABLE, and the cell standing in
for the gutter is sized in the stylesheet — to `--gutter-w`, the reader's own
gutter, which on the PDF's grid is not the margin. So every ordinary line
began at `--body-x` and the box began 55 px to the left of it, with the
numbered rule jogging out to meet it and the line numbers drawn inside the
box.

The cell takes `--body-x` itself now, a plain width in the page's own pixels:

- Not `calc(var(--body-x) - 1.1em)` with the first cell's padding making up
  the rest, which is what the numbered grid does. The two ems are different
  sizes — the gutter is set at `0.8em` so the numbers are smaller than the
  text — so the padding never gave back what the width took, and a box
  squared up that way landed a pixel or two out, which down a caption is a
  visible step in its side. The first cell's padding goes to zero instead.
- The rule and the number keep their places INSIDE the cell: the rule drawn
  as a hairline `1.1em` in from its right edge, where the grid's own gutter
  margin puts it, and the number `1.6em` — so the numbered margin runs
  straight down past the box, and `gutter-off` (which sets the gutter at the
  text's own size) still moves both together.

Measured on the same pleading, its caption page: the box's first character
stood at x = 23.5 against the body's 70.9 and its bar column stepped between
261 and 265 down the page, with the numbered rule at 15.4 beside the rest of
the page's 64.4. It now starts at 70.9 like every other line, its bar column
is one value, and the rule is 64.4 on every line of the page.

**…and off the grid, the numbers stand one on top of the other.** The
flowing page had the same box rows with the old geometry: the gutter cell
`--gutter-w` wide with the rule as its right border and the number half an
em in from it, where every grid line has the rule a margin further in (a
table cell takes no margin). On a caption page the numbers of the box rows
stood 13 px right of the rest and the rule jogged out with them. The cell
draws what the grid's gutter does in both views now (the hairline and the
padding above, no longer only on `.fixed`), and the box's first cell has no
padding of its own. And the margin is measured in a unit of its own,
`--gutter-em`: the reading size off the grid, which no page's `--fit` to its
paper changes, so the rule and the numbers' right edge stand at one place on
every page of the document (a page fitted to 0.525 had its numbers 9 px left
of the next page's and its text 18 px); the PDF's body type at the grid's
scale beside it. The numbers are set in the page's body type (`0.8 *
--body-em`), never a line's own, so a line set larger or smaller keeps its
number in line, and a fitted page is not held open by its numbers' line
boxes.

**…and only the numbers in their order are the grid.** A numbered line is
`fixed` at its number's height (`slotTops`, `spreadTops`), so the number has to
be right. On an OCR'd pleading it is not always: line 17 read as 11 pinned its
line up at line 11's height, `spreadTops` and `holdWithin` squeezed every line
from 3 to 17 into the space above it, the page below stood empty, and the
unnumbered lines around it could not be matched to their PDF rows either
(`offGridTops` takes a match only between the numbered lines either side, and
"11" stood below them). Measured on a generated pleading with that one misread
and four numbers missing: lines 3-17 drawn 13 px apart against the PDF's 25.
`applyMatchedLayoutNow` now keeps a number only where it is in
`textdoc.numberChain` (the longest run climbing down the page, ties to the run
that steps with the lines) and not past `geom.last`, the last number the PDF's
own margin carries; any other is laid out as an unnumbered line, by its words.
The same page lays out line for line beside its PDF. The numbers themselves are
put back as the export is read (`readExport`, Text reader.md), so this matters
where too few were read to put any back.

### The hold: a key value carrying a run of blank

This is the one that took the tab down. The breadcrumb finally named it:

    Forsythe Decl..txt took 120518 ms to read for names in the clear (271 KB)
    — looking for the pseudonyms the run wrote

That step is `findReals(fakesRx, text)`: which of the key's pseudonyms stand
in this document. `altFor` builds a value's pattern by writing each SPACE in
it as a gap — and a gap is itself `(?:[ \t]|\r?\n<gutter>)+`, a `+` over
whitespace. So a value carrying a RUN of blank became a chain of those
quantifiers reading one run of blank between the same two words, which is
every way of cutting that run into that many pieces.

Measured on a page of pleading paper whose columns put a wide blank right
after the value's first word:

| spaces in the value | one page |
| --- | --- |
| 1 | 1 ms |
| 2 | 2 ms |
| 4 | 18 ms |
| 8 | 2,062 ms |

Each extra space roughly QUADRUPLES it. A key holds what the run captured,
and what the run captured is sometimes a name standing in two columns of a
caption or wrapped at the margin — the operator's key held `"Set"` and
`"Hepworth"` a line break and fifty-two spaces apart. Eight was two seconds;
fifty-two never finishes.

A run of blank is now ONE gap, which is what `fold` has always done on the
other side of the question — it reads every run as a single space before
looking a match up — so the two sides finally agree. The same change goes
through `buildFindMatcher` and `compileTypeahead`, which had the same chain,
and `buildMatcher` trims its values so one with a space in front of it is
still filed under its first word rather than falling to the loose alternation
the index exists to avoid.

It fixes a quiet wrong answer as well: a run holding a LINE BREAK was left in
the pattern as a literal newline, so such a value only ever matched text
broken in the very same place — which is to say, almost never. Three of the
new tests in `test-pseudo-key.mjs` fail on the old code for that reason
alone, before the timing guard does.

Measured on the operator's own declaration (238 KB) with a key the size of
theirs: the step ran **19 ms**, and the whole reading is linear in the key
again — 50 values 11 ms, 343 values 19 ms, 1,101 values 50 ms.

### The walk clicking through documents on its own

Reported from a real review: clicking through the real names standing unfaked,
and **towards the end** the reader starts opening one document after another by
itself, as fast as files open.

TWO READINGS say where the names are, and they are not the same reading. The
marks on the PAGE (`scanPassNow` → `leakHits`) answer for the document open:
they know the spot keeps taken in it, the names the walk has settled, and the
edits the file has not been given yet. The folder SWEEP (`sweepFolder` →
`sweep.rows`) answers for the FILES on disk, which know none of that — a
`keepRangeHere` in particular is one occurrence in one document and is not in
`maskKept`, so the file goes on carrying that name and the sweep goes on
counting it.

The walk read "what is here" off the first and "where next" off the second:

    stepLeak → no live hits → jumpToDoc(rest[0]) → leakJump = true
    renderLeakStatus → leakJump && no leaks → stepLeak → jumpToDoc(rest[0]) → …

`restOfFolder` leaves out the document that is open, so a document whose row
the page disagrees with is offered again the moment the walk is somewhere else.
Nothing broke the circuit: opening a document does not move `reals`, `keeps`,
`folderDocs` or `flagged`, so `sweepStale()` stays false and the row that sent
the walk there is still there next time round. Two such documents and it
ping-pongs between them for ever. It shows up at the END of a walk because by
then every document that really was carrying a name has been answered, and the
rows left over are exactly the ones the page disagrees with.

A second path drove the same loop faster: `renderLeakStatus` is called by the
SWEEP as well as by the paint, and between a document opening and its own paint
landing, `leakHits` still holds the document just LEFT — hanging off pages that
are gone, so `liveLeaks()` is empty. A sweep finishing in that window took that
for "nothing here" and sent the walk out of a document it had never read.

The decision is now one pure, tested place — `leaks.walkStops` and
`leaks.walkStep` (`test-leaks.mjs`, "the walk from one document to the next") —
and it is made off BOTH readings:

- The page's own verdict is kept (`pageEmpty`, written by the paint beside
  `scannedDocs`) and honoured: a document it has read and found nothing live in
  is not offered as a stop again. Held only as long as the question it answers —
  a new key or a new folder drops it, a keep deliberately does not, since a keep
  only ever takes a name OUT of the clear. The **⚠** in Documents still reports
  what the file itself carries; that is the honest place for it.

The two readings were also made of different TEXT, which is where most of the
disagreement came from, and which left documents marked **⚠** that the walk
found nothing in. The page blanks every pseudonym span and every spot keep
before it looks for names; the sweep read the raw file. So a key whose real
"Jones" is a word of another name's fake ("Mary Jones") found a leak in every
"Mary Jones" on disk, and a name kept just where it stood went on being counted
for as long as the file carried it. The sweep now reads each file through
`textdoc.clearReading` — page by page, as `buildBody` gets it: the fakes
`translateRuns` finds and the document's stored spot keeps blanked to spaces as
`flatten` blanks them, the case keeps masked, cited decisions' parties spared,
and every occurrence counted as the page counts them. The flagged values are
counted over the same text. The open document's spot keeps are part of the
sweep's stamp (`spotsSig`, by content, since the list is rebuilt on every
edit), so keeping a name here re-reads the folder's answer about it.

The SAVE read a third text, and disagreed with the marks the same two ways. It
read each page off `serializeHeld` with the run's fakes standing in it and
only the spot keeps held, so a real that is a word of a fake ("Volunteers" in a
fake "Volunteers of Columbia") was a name it found and the page never marked:
undecided, it was named in the "not yet reviewed" warning, which no walk could
step to; decided, the forward pass wrote a pseudonym into the middle of the
fake. And `citedNameSpans` over the text with the fakes in could read an orange
name and the fake beside it as a cited decision ("Volunteers v. Quillmark Corp.
(2019) …"), which the save spares: a name the page marked and the walk had
settled stayed in the file and stayed orange, out of the walk, save after save,
with nothing said. `serializeHeld` now returns the fakes' places too (`pns`),
and the save, the print and the warning read the page through `diskReading`
(text-reader.js): the fakes and spot keeps blanked to spaces as `flatten`
blanks them, cited names found in that, matches read off it
(`standingSpans`), and the forward pass run with those blanks as NULs so no
swap reaches into a fake. A settled name still standing once the pass is done
is named in the save's toast rather than left silently.
- A document whose own reading has not landed is not called empty at all
  (`readHere()`: `paintedSeq === docSeq`). The bar says it is being read and
  waits, rather than leaving a document nobody read.
- A document whose marks cannot run — one they gave up on
  (`marksCanRead()`) — has no answer to give either way, so the walk stops and
  says so. `giveUpOnMarks` tells a waiting walk directly, rather than leaving
  it on a bar that says "reading".
- And a run of documents opened one after another with nothing found in any of
  them stops at `WALK_BOUNCE_LIMIT` (8), whatever the reason: a disagreement
  nobody has thought of yet cannot walk the folder on its own.
- Stepping by hand is never a runaway, and none of it applies (`auto: false`):
  › goes where › says it goes.

A document that will not open is no longer left with `leakJump` set either —
`openFolderDoc` says whether it opened, and `jumpToDoc` stands the walk down
and stops offering that document rather than waiting on one that is not coming.

### The LEAKS review finishes a page before leaving it

The worksheet walk and the names walk were two lists that never met: the
worksheet is one row per VALUE, the orange is every key name standing in the
clear, and most of the orange has no row. Answering a page's last row moved the
review on and left that orange behind, to be found later from the status bar
(whose walk keeps its own place, `leakStep`, nowhere near the page just read).

Now `decideLeak` / `acceptLeak` go on through `advanceLeak`, not `goToLeak`.
`pageSweepFor` asks `leaks.sweepSpan` (pure, tested) which pages the move
leaves behind — the page in front and any passed over on the way to the next
row's page; the rest of the document for another document or for the end of
the worksheet; nothing for the same page, an unknown page, or a row further up
— and if live orange stands there, the names bar is walked over it first
(`goSweepStop` sets `leakStep` and calls `stepLeak`, so the bar and its buttons
are the ordinary ones). `decideName`, `fakeName` and **skip** hand back to
`continuePageSweep`, which takes the next name after a cursor kept as
[page index, text offset] — so a rescan replacing `leakHits` mid-sweep does not
lose the place — and `finishPageSweep` goes to `nextUndecided` from the row
that started it. Passed over: names with a worksheet row (answered there) and
flagged values (already answered). `goToLeak` by any other road cancels the
sweep. `rowHere` holds the worksheet row's own occurrence, since `leakHere` is
shared with the names walk.

Only a names bar the operator opened stops the review: `pageSweepFor` returns
null while `namesBar` is hidden, so with the bar down a decision goes straight
to `goToLeak` and the review never puts the bar up for a sweep (the sweep's
old `opened` flag, which put back down a bar the sweep had opened, went with
that). **×** on the names bar during a sweep closes the bar and then
`finishPageSweep`s on to the worksheet's next row, so the review stops on no
more names until the bar is opened again (`leaksFromCount`, Alt+L). `goToLeak`
dropping a sweep re-renders the bar, which is up, so its count stops reading
"left on page N".

### Opening ONE FILE is not opening its folder

A file opened on its own used to bring its whole folder with it: the reader
finds the folder it sits in among the ones it remembers, adopts it, and from
that moment every pass the folder makes possible is running — the sweep
reading every other export for names in the clear, the documents built ahead,
the reel hanging the next export under this one, the folder's PDFs matched by
name and opened, their line grids read. On a folder with something expensive
in it, the file the operator actually asked for is the one thing that is not
the trouble, and they never get as far as saying so.

So adoption comes in two weights. `adoptFolder(h, { light: true })` takes the
pseudonym key, the flagged values and the LEAKS worksheet — what belongs to
the CASE rather than to the document, and what the marks and the review need —
and stops: `scanFolder` collects no documents and no PDFs, so none of the
passes that run off them exist. `attachKeyForFile`, which is what a file
opened on its own goes through, takes that weight. "Open case folder" is still
the whole folder, and the Documents tab says which happened and offers **Read
the whole folder** when it was the light one.

Driven in Chromium over the operator's own 244 KB declaration and a 343-
binding key built from the names it carries: the whole folder lists 19
documents; the light attach lists none, holds the key and the worksheet, and
records no long task at all.

### Letting go of the case folder

Everything the reader does BESIDES the document in front of it hangs off
having a folder: the sweep that reads every other export for names in the
clear, the documents built ahead of a review, the reel hanging the next export
under this one, the PDFs matched by name. That is what a case folder is for —
and it is also every pass that can take a folder's worth of work on a file the
reader has not seen yet. Short of closing the tab there was no way to say
"this one file, and nothing else".

`forgetFolder` (the button under the Documents list) drops the folder and
everything read from it or through it, and KEEPS THE KEY: the marks are the
reason to use this reader at all, and they belong to the key, which the key
library holds. A reel of several documents collapses to the one being read,
since there is no longer anywhere to read on to. The folder is FORGOTTEN as
well as dropped (`forgetDir`) — the reader re-attaches a remembered folder as
soon as a file from it is opened, so one merely dropped would be back on the
next document.

### Only the folder's own key takes its flags off (`keyFolder`)

The key in hand outlives the folder it was read from. A folder with no
`pseudonym_key.xlsx` — or one whose key Excel is holding — leaves whatever key
was in hand where it was, usually the last case's, and the documents read
under it. That part is unchanged. What was wrong was the flags: adoption names
the folder, reads its key, then its flagged list, and compiles, and
`dropFlagsNowFaked` took off every flag the key in hand fakes. Under the last
case's key that is a name of THIS case which that case's run happened to fake:
nothing has faked it here, and the flag was the only thing still asking for
it. The merge of the folder's own `New Real Values.txt` on disk
(`TD.fakeFor(fwd, v)`) kept the same names out of the list, silently.

Three earlier designs moved the key itself — put it down, recalled the
folder's from the library, claimed a dropped one — and each round of checks
found the display moved with it somewhere main's did not (a folder whose key
Excel holds losing its own case's key, a newer key swapped for an older one).
So this one moves nothing but WHO MAY ANSWER THE FLAGS. The key in hand, what
the documents read in, the key library (`storeKey`), every key-attach path and
every toast but the note below are main's.

`keyFolder` records the flag list the key in hand belongs to, by the name the
list is stored under (`valuesStoreKey()`, the flag store's own identity):

- adoption reading the folder's key file sets it to that folder (`own`, taken
  as adoption names the folder, so an adoption overtaken by another still
  files its key as its own folder's and not the later one's);
- a key loaded by hand (Load key…, a key dropped ON ITS OWN or with a PDF or
  a workbook) or chosen in the Key list sets it to the list open at that
  moment (`handOwner`): the case folder's, or with no folder open the lone
  document's, or none with nothing open;
- a key dropped TOGETHER WITH an export (`.txt`/`.LEAK`) belongs to none: the
  drop loads the key first and opens the export after, while the folder open
  is still the last one, and the export may bring its own folder in. A PDF
  or a LEAKS or master workbook brings no folder in, so a key dropped with
  one is loaded by hand into the folder open, as one dropped alone is;
- adoption that finds no key file, or cannot read it, leaves it where it was —
  another folder, or none;
- the key offered at start belongs to none (it is initialised so, and boot
  calls `setKey` directly).

`TD.keyAnswersFlags(keyFolder, list)` — true only for a non-empty owner equal
to the list — gates `dropFlagsNowFaked` (against `valuesStoreKey()`, beside its
`flagsFor` check) and the on-disk merge (against the adopting folder's `own`,
the folder whose file it is). Where it says no, the flags simply stay: a flag
left on the list never exposes a name, it is only asked about again; a flag
wrongly taken off can let one ship.

The one visible change: where the key is already being spoken of —
adoption's "No pseudonym_key.xlsx" line (which, with a key in hand, now says
the documents read under it rather than "in their fakes") and its "could not
be read" line, the lone-file attach's summary toast and its ask-first offer
bar (which no longer calls the key "the folder's"), and "Key loaded" —
`notOwnKeyNote` adds one sentence when a folder is open and the key in hand is
not its own: none of the flags there come off under it, and loading the
case's own key with Load key… takes them off. It points at the case's OWN key,
not the key in hand: loading the key in hand by Load key… would make another
case's key the folder's. Where the folder's key file could not be read, the
remedy it names is that file read again — closed in Excel (or a damaged one
replaced) and the folder opened again — since Load key… on a file Excel is
holding fails the same way; and it adds the full stop an error message without
one lacks. Adoption, and the lone-file attach after it (on the `found` that
adoption returns), leave it out where the folder picked looks like the Text
Files subfolder (`looksLikeTextFiles`): there the remedy is the folder above,
which `openFolder`'s offer bar already says, and a key loaded into it would own
the one list every case's Text Files folder shares. (Since "Each folder is
itself" below, each Text Files folder has a list of its own, and the offer bar
is put up by adoption, `offerFolderAbove`, whichever way the folder came.)
Without the note each of these toasts and the offer line is main's word for
word.

Left as they are, on purpose (each keeps a flag main would have dropped,
never the other way):

- The key offered at start belongs to no list. In a new session a folder whose
  key file Excel is holding keeps its flags under the library's key, even when
  that key is the same case's, until the key is loaded by hand; so does a lone
  document opened under it.
- A key dropped together with the open folder's own export is nobody's until
  loaded or chosen by hand. Choosing it again in the Key list does nothing — a
  select fires no change for the option already chosen — so it is Load key…
  with that key. The detour through the list is "(no key)" and back, never
  another key: choosing a key with the folder open makes it the folder's and
  takes off every flag it binds, and choosing the first again does not put
  them back. "(no key)" also clears this session's names-bar "fake it" answers
  (`setKey(null)` resets `settled`); Load key… with the same case's key keeps
  them.
- After "Let go of the folder" the key keeps its owner, the folder: the lone
  document's own list is not answered until a key is chosen with it open.
- The identity is the folder's NAME, as the flag store's is: two case folders
  of one name share one list and one owner, exactly as they share the list. So
  does every case's Text Files folder (`textReader.values.Text Files`). (No
  longer: the store and the owner are the folder's own id now, and a KEEP
  shared this way was found to let a name ship — see "Each folder is itself"
  below.) A lone document's list is stored by its FILE name, so lone documents
  of one name from different cases (`Motion.txt`, `Complaint.txt`) share one
  list, and a key chosen while one was open answers the others too — as on
  main, which shares the list the same way. A key loaded with no folder open
  could have belonged to none; `handOwner` gives it the lone document's list
  instead, so that a lone document's flags can still come off under its case's
  key.

Measured in Chromium on PWA builds of main and of this change. A probe for
this design (19 scenarios: key-less B after A by Open case folder, through its
`New Real Values.txt`, as a lone file and ask-first; B's key file locked after
A, after B itself, and in the next session; B's own key loaded or chosen by
hand; a key dropped alone and with B's export; B with its own key; lone
files; overlapping adoptions; Let go) and the 22 probes of the earlier rounds
(195 scenarios): in all 214 the key shown, the Key list's choice and the
document text are main's, and no flag main kept is lost. What differs is
flags kept that main took off — Case A's key binding the invented "Jane Roe"
no longer takes B's flag off, by any path — and the toasts and offer line
above. A key from B's own case loaded or chosen by hand in B, and B's own key
file, take the flag off exactly as main does.

Measured again after the note was reworded and left out of the Text Files
folder: the probe, now 21 scenarios with the Text Files subfolder and a flat
key-less export folder picked after A (the toast there is main's word for
word, the key and the text main's), and the parity probe's 38 scenarios
seeded both ways (214 steps). The key shown, the Key list and its options, the
library and the document text match main at every step, and no flag main kept
is lost. One status line differs: two adoptions overlapping with no document
open, where main's drop repainted the marks (`paintHighlights`), which starts
the folder sweep, and the sweep counted Case A's "Jane Roe" standing in B's
export. Dropping nothing, the branch has not swept yet when the probe looks;
the paint of the first document opened sweeps in both.

Measured a third time after the note was left out of the lone-file attach in a
Text Files folder and the unreadable-key remedy reworded: the parity probe's 56
scenarios and its 69 later ones (PWA tabs among them), each seeded both ways.
The lone-file toast and the ask-first offer line from a remembered Text Files
folder are main's word for word, and so is the toast of a Text Files folder
picked in a new PWA tab; the "could not be read" line of a key that is not a
zip reads with its full stop. Key, Key list, library and document text match
main throughout; the status line of the overlapping adoptions above, and the
note's longer toast, are the only other differences.

### Each folder is itself: its state is kept by its id (`dirIdFor`)

Everything the reader keeps for a case folder — the flagged list, the keeps,
the phrases, the page lists, what was last written (`valuesSavedKey`), the
spot keeps, the swapped pages, the unsaved LEAKS answers — was kept in
`localStorage` under the folder's bare NAME, and the remembered folders in
IndexedDB were put under the name too. The paragraph above left that as it
was on purpose, on the ground that a flag shared by two same-named folders
only asks again. A KEEP does the opposite. Measured in Chromium over two
folders called Opposition under two clients: a `no` on Okafor in the first
was read into the second, where Okafor is the plaintiff. `keyLessKeeps` took
him out of the forward side, so the orange mark on the name standing in the
clear went; Ctrl+S wrote the export with it unrefused; and the second case's
`New Real Values.txt` was written `no: Okafor`, which its next run obeys —
the real name stays in its exports from then on. The store put by name had
its own half of it: the folder remembered was whichever of the two was opened
last, and a file from the other, opened on its own, found no case folder.

So each folder gets an id, kept beside its handle in the `dirs` store, and is
found again by asking the stored handles whether one IS the folder
(`isSameEntry`) — only those of its name, the same entry having the same name,
so it costs a read or two of IndexedDB and a call or two per adoption.
`stateFolder()` is the id while a folder is open, and every key above is built
on it (`valuesStoreKey`, `valuesSavedKey`, `spotKeyFor`, `PS.swapStoreKey`,
`leaksStoreKey` through `leaks.store`); `keyFolder` and `flagsFor`, which hold
`valuesStoreKey()`, follow with it, so only a key read from or chosen in THIS
folder answers its flags. The id begins with `/folder/`: no file or folder
name holds a "/", so it can never be read as a lone document's list (kept by
its file name, as before) nor as a name an older build used, and a name's keys
and an id's can be told apart by prefix (`TD.folderStateMoves`).

A record is `{ handle, role }`. `"case"` is offered to a file opened on its
own (`caseFolderFor`). `"text"` is a Text Files folder, kept for its id and
never remembered as a case folder (below). `"forgotten"` is a folder let go of
(`forgetFolder`, `forgetDir`): before, forgetting deleted the entry and the
list survived under the name; deleting an id would lose the list the next time
the folder is opened, so the record stays and is only not offered — nor is a
Text Files folder inside it, in its place: let go means the file on its own.
An older build's entry, a bare handle under the name, is given an id the first
time the store is read (`readDirRecords`), as a case folder. `dirIdFor` runs
one call at a time, or two adoptions of a folder never seen would each mint it
an id and split its state. Without IndexedDB there is no id, and the name is
the key, as it was.

**Moving an older build's state (`adoptLegacyState`).** A list under
"Opposition" was every Opposition's, so it cannot simply be given to the first
one opened. It moves to the id when exactly one remembered folder bears the
name (`sameName`, counting this one) and, where the reader kept the text it
last wrote, the folder's `New Real Values.txt` is that text. Anything else —
two of the name known, the file different, or no file (a run spends it, and
whose run cannot be told) — and the state is HELD ASIDE: moved to
`textReader.held.*`, read by nothing, and said once in the adoption's toast
with what it held, so the operator flags or keeps again what the case still
needs. A held keep costs a right-click; a keep read into the wrong case let a
name ship. The documents' spot keeps, swaps and LEAKS answers move or are held
with the list.

Left as they are: a lone document's list is still kept by its FILE name, so
lone `Motion.txt`s of two cases share one (no case folder is open, so nothing
is written for it without a picker). A Text Files folder's spot keeps and
swaps stay under its own id when its case folder takes its list up: a spot
keep left behind is a real value marked again, never one let through.

Measured in Chromium (Playwright, OPFS folders): two remembered folders called
Opposition each adopted from its own file opened alone; a keep in one leaves
Okafor marked in the other, its save warns and writes no `New Real Values.txt`;
forgotten and opened again, the folder's keep is there under the same id; an
older build's list moves where its folder is the one of the name and its file
matches, and is held aside, and said once, where two are known or the file
differs.

### Nothing the case is owed is written into Text Files (`textFolderOpen`)

The Text Files folder is the one uploaded to the drafting model, and
PDF-Linker reads `New Real Values.txt` from the case folder and nowhere else
(`_pn_reader_file_text`); a copy in Text Files it skips as a tool artifact, so
it is neither applied nor ever removed. With Text Files picked as the folder,
`saveValuesFile` wrote the list into it on every Ctrl+S and `markValuesSaved`
recorded it as handed over. Measured: the witness flagged was in `Text
Files/New Real Values.txt` after one save, and the case folder held nothing.
The file can hold real names the exports do not: a `phrase:` line over a
pseudonym writes the faked word's real name, an owed `no:` its real value.
The warning that should have stopped it was taken down by the first document
the folder opened (`openFileNow`'s `hideKeyOffer`), and a Text Files folder
remembered by name — every case's under the one name — was re-adopted for a
file opened on its own with only "Text Files · 1 document, key attached."

Now, while `textFolderOpen()` (the folder adoption read as Text Files, by
`looksLikeTextFiles`, or merely named so):

- `saveValuesFile` writes nothing, marks nothing saved and puts up no picker
  (one opens where it was last, which is that folder); the Ctrl+S toast says
  the list is still unwritten and why, the way the no-folder save does, and
  the Flagged panel says where it goes. A save that wrote nothing at all now
  leads with "Nothing saved" (it read "Saved the flagged list is still
  unwritten", in the no-folder save too). `saveLeaks` writes neither through
  the folder nor through a worksheet handle inside it — an earlier version's
  copy, which adoption attaches like any other.
- The offer bar (`offerFolderAbove`) is put up by adoption itself, whichever
  way the folder came — Open case folder, a remembered one for a lone file,
  the app's own pick — and stays while it is the folder open; a case folder
  adopted takes it down. It names a `New Real Values.txt` or `LEAKS.xlsx` an
  earlier version left there. Its button opens the picker INSIDE the folder (a
  child handle cannot open its parent), so it says to step up one level.
- The list made meanwhile is kept under the Text Files folder's own id, and
  when its case folder is adopted, the Text Files folder found in it
  (`isSameEntry`) gives its list up into the case's (`carryUpTextFiles`,
  `TD.mergeStoredLists`, nothing lost, the case's own winning), said in the
  toast; the next save writes it where PDF-Linker reads it.
- A Text Files folder is remembered as `"text"`, never as a case folder
  (`rememberDir`, and adoption once it has read the folder), and
  `caseFolderFor` takes a case folder holding the file before any Text Files
  folder — an older build's, remembered as a case folder by its name, too. A
  Text Files folder is the answer only where no case folder above it is
  known, and adoption then says what it is; one that wants re-authorising
  offers the folder above rather than "its key".

`scanFolder` counts a PDF even on a light attach (`anyPdf`), since having PDFs
is one of the things that make a case folder one: a key-less older-layout
folder read light no longer reads as Text Files and has its saves refused.

Measured in Chromium: a remembered Text Files folder, a file opened alone,
one flag, Ctrl+S — the bar up and still up after a second document, nothing
written into Text Files or the case folder, the Flagged panel's Save refused
without a picker; the bar's button, the case folder picked, the flag there,
and Ctrl+S writing it into the case folder's `New Real Values.txt`. Open case
folder on Text Files: the bar survives the first document and names the stray
file; a handle-less LEAKS attach and a stray `LEAKS.xlsx` are never written
there. With the case folder and its Text Files both remembered by an older
build, a file opened alone adopts the case folder.
