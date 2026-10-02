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
