## The text reader (`viewer/text-reader.html`)

A second page in the same extension and the same PWA: PDF-Linker's scrubbed
`.txt` exports, read like a document. `text-reader.js` is wiring over three
pure, Node-tested modules — `textdoc.js` (the export as pages by its
`====== Page N ======` headers, byte-exact round trip; the DOM walk that
serializes a pseudonym span as its FAKE; the `New Real Values.txt` list),
`pseudo-key.js` (a port of the Claude extension's `src/pseudo.js`: parseKey
by header name, keeps dropped, pinned tab out of the reversal, ambiguous fake
retired, case-mirrored swaps in both directions) and `xlsx-read.js` (a port
of its `src/xlsxread.js`). It reuses `citation-linker.js` and `toa.js`
directly; citation underlines are painted as thin overlay strips from DOM
Ranges so the text stays editable, and the pleading gutter numbers are
blanked length-for-length before detection so a wrapped cite still parses.
The one rule: the real names exist only in the page. Every pseudonym is a
`contenteditable=false` span carrying `data-fake`; a save serializes the
fakes, forwards any real name typed into plain text to its pseudonym, and
refuses if a bound real value would still reach the file. `web-shim.js` is
the `chrome.*` shim that used to sit at the top of `viewer.js`, moved out so
both pages import it first. The PWA shell (`pwa/app-web.js`) routes a `.txt`
to a reader iframe and feeds it through `__textReaderLoadLocal`.

**📷 Screenshot** leaves the room like a print, so it is taken in the
pseudonyms whichever way Show fakes sits (`fakesForShot`, which answers the
function that puts the screen back). On the pages within a screen of the
window every `.pn` shows its `data-fake`, and the forward pass
(`forwardSwaps`, the places `forwardText` writes) is made in the text nodes
themselves by `swapInNodes`: nothing is rebuilt, so the grid, the columns and
the rule fits stand, and the fake goes in ahead of the name before the name
comes out (`insertData`, then `deleteData`), so a live highlight range over
the name (a leak, a find) ends up over the fake. Off the grid the underlines
are placed again over the faked words. `swapChrome` does the same to the
window's other text (everything outside `.page-body`, `.textLayer` and
`[hidden]`) and to typed `input`/`textarea` values, in the reader and in a
same-origin shell above it. The PDF pane shows the filing, which nothing
scrubbed: `pdfNamesOn` reads each drawn sheet's pdf.js text layer the way
`keyBoxesForPage` does, and `coverPdfNames` paints a white box over each name
with its fake in the layer's type, under the redaction boxes. Put back: each
node's own text, `afterTextChange()`, and the underlines at once. While
`shotPut` is set, `beforeinput` on the pages is refused and the reel hangs
nothing above. Hosted, the fakes go on only once the screen share is granted
(`shareThisTab` answers the frame-taker), and a share that sends no frame is
given up after five seconds, so the fakes never stay on.

The tools live in a left-margin rail (`#tools-rail`), the PDF viewer's
Acrobat-style panel carried over to this page: the top bar had grown to some
two dozen controls, so the reading, pseudonym, review and PDF tools moved into
labelled groups down the left side and the bar kept only the document's own
actions. It is a flex child of `#main`, so the stage simply narrows; `Tools`
at its head collapses it to an icon strip (`body.tools-collapsed`, remembered
under `textReader.tools`), and a checkbox tool wears a button's clothes — the
box itself is visually hidden and `:has(input:checked)` paints the pressed
state. The key-offer bar now takes its own height through `--offer-h`, the way
the LEAKS bar takes `--bar-h`, so neither covers the head of the rail.

Find's bar has a second row, Replace (`#fb-replace-row`, Ctrl+H). It edits
only the page bodies in the DOM; the folder is never written from the bar.
`planReplace` maps a hit (`[start, end)` of `flatten(body, { blankGutters:
true })`) onto one part per line, skipping the gutter spans, and returns null
for a hit that covers only part of a `.pn` or `[data-here]` span, or some but
not all pieces of a name wrapped across lines (`data-piece`). `applyReplace`
deletes each part with a DOM Range, last line first, trims the head of a
continuation line, empties the `.gs` of a numbered line it leaves blank, and
puts the replacement in as a plain text node; `settleReplaced` then runs what
typing runs (`normalizeLines`, `convertTypedReals`, `syncSpots`, `setDirty`).
Replace all plans every hit before changing anything, snapshots every page it
touches under one `batch` id (`snapshotPages`), so `stepHistory` undoes and
redoes them as one step, and applies each page's plans last first so the
earlier hits' nodes and offsets still hold. Match case (`#fb-case`, Alt+C)
is `buildFindMatcher(values, { caseSensitive })`, which drops the `i` flag;
`findMatcherFor` is the one place the page, the folder scan and Replace get
their matcher, and the folder scan's `findScanFor` carries the flag so a
toggle reads the folder again.

**⇄ Raw** (`.raw-page`, on every page label, between `.swap-page` and
`.nocr-page`; it replaced the toolbar's 📄 File as text panel) puts the page's
own text in the page's place, the way ⇄ PDF puts its PDF page there.
`setRaw(sec, on)` adds `.tpage.raw` and a `.raw-sheet` (a corner `.raw-tag`
and a `pre.raw-text`) to `.page-inner`; CSS hides the body and the link layer,
which stay in the DOM and still save. `rawPageText` is the save's own text:
the banner or header line, then `TD.serializeHeld(body)` (fakes, never the
real names), with the spot keeps' places shifted past the head so `fillRaw`
can mark the names standing in the clear as `scanPassNow` does (keeps
masked, spot keeps blanked, cited parties out). `fillRaw` rewrites only when
its signature (tag, text, marks) moved, so a selection made in it survives;
`refreshRawPages` runs it over `rawPages` from `paintHighlights` (every text,
key or keep change) and `updateDirty` (the corner's unsaved note), and from
`fakesForPrint`, so a print reads the scrubbed bodies. State lives on the
section, not in an index, so `reelShift` leaves it alone; `shedMember` drops
it with the rest of the page's contents. The sheet's `minHeight` is the
page's height at the click, so nothing below moves. One view at a time:
`toggleRaw` deletes the page's PDF swap (and persists that), and
`applySwapsNow` turns raw off on a page it swaps in. `shapePages` passes over
a raw page as it does a swapped one, and `applyMatchedLayoutNow` takes it off
the grid (`clearMatched`) and holds its slot to the page's height with the
shed slots (`rawSlots`), so the two columns stay level. Not persisted.

**⊘ Did not OCR** (`.nocr-page` on every label with a page header, beside
the ⇄ PDF swap) replaces the page's lines with `textdoc.didNotOcrLines`:
`[DID NOT OCR]` alone, except that PDF-Linker's "Authorities cited" trailer
(`TD.TRAILER_RE`, now shared with `markTrailer`) and the blank lines before it
stay. `markDidNotOcr` makes the edit the way `restoreSnapshot` puts a page
back: `snapshot(body, true)`, the page's spot keeps dropped, `buildBody` from
the new text, `doc.pages[i].lines` set, `syncSpots`, `setDirty`. One undo step;
the page index is read off the section at the click, as the swap button's is.
The page is also handed to PDF-Linker, whose next full run would otherwise
rebuild the export from the PDF and OCR the page again: `noOcr` (beside
`flagged` and `keeps`, persisted with them, merged from the file on disk at
adoption) is written by `formatValuesFile` as `did not ocr: FILE | page N`
(`textdoc.noOcrLine`; FILE is `pdfForName(doc) || doc`, N `PS.pdfPageOf`) and
read back by `parseReaderFile` into `noOcr`, never into `values`.
`syncNoOcr(indices, { drop })` keeps the list following the PAGES: a page
reading `[DID NOT OCR]` (`readsDidNotOcr`, the trailer aside) under a header
PDF-Linker did not write is owed; one whose header PDF-Linker wrote as DID NOT
OCR (`headerSaysDidNotOcr`) is the run's and comes off; with `drop`, a page
that no longer reads it comes off too. Asked by `markDidNotOcr`, by
`restoreSnapshot` (with `drop`, so an undo takes the entry back), by
`openText` and adoption, and by `saveDocument` — with `drop` for the pages of
the files it writes, since those are the text's last word. Entries are equal
by page and by either name (`sameNoOcr`), so a line read back naming the PDF
and one made from the open export are one. `#nocr-block` in the Flagged
panel lists them. PDF-Linker marks the page in the PDF (`_NO_OCR_MARK_KEY`)
and spends the line.

The button toggles (`nocrButtonClick`, `setNocrButton`, `refreshNocrButtons`):
on a page that reads `[DID NOT OCR]` (`pageReadsDidNotOcr` — the lines, or a
short page's live body while it is typed into) it is **↻ OCR This Page**
(`ocrPageAgain`). Where the header is not PDF-Linker's DID NOT OCR one and the
page's `did not ocr` line never reached the folder (it is not in the saved
file's text, `valuesSavedKey`), the text the strip took is put back
(`strippedTextOf`: the newest undo snapshot of that page tagged `nocr` by
`markDidNotOcr`, whose text does not read `[DID NOT OCR]`; `stepHistory`
carries the tag to the other stack) by `putStrippedBack`, one undo step.
Otherwise the page's `noOcr` entry comes off and an `ocrAgain` entry goes on
(persisted, merged at adoption only for a page neither list names, written by
`formatValuesFile` as `ocr again: FILE | page N`, `textdoc.ocrAgainLine`, and
read back into `ocrAgain`); the button then reads **✓ OCR This Page** (`.on`,
`aria-pressed`) and a click withdraws it. `syncNoOcr` keeps both lists: a page
with a request is not also owed as not to OCR, and the request comes off once
the page reads as read under a header that is not DID NOT OCR (PDF-Linker's
full run has taken the mark off). `markDidNotOcr` withdraws a request for the
page it strips. `#ocr-again-block` lists them.

**✎ Use my text** (`.fix-page`, beside `.nocr-page` on every label with a
page header; `useMyText`, `setFixButton`, `refreshFixButtons`, called from
`refreshNocrButtons`) hands a page TRANSCRIBED by hand to PDF-Linker:
`textFixed` (beside `noOcr` and `ocrAgain`, persisted with them) is written
by `formatValuesFile` as `text corrected: FILE | page N | sum XXXXXXXX`
(`textdoc.textFixedLine`) and read back by `parseReaderFile` into
`textFixed`, never into `values`. The sum is `textdoc.pageTextSum` — FNV-1a
over the UTF-8 bytes of the page's lines up to the first rule line, trailing
blanks and the blank lines at the ends dropped — which PDF-Linker's
`_pn_page_text_sum` computes identically; both sides pin the same values.
`useMyText` takes the sum of the page as it reads at the click, and
`saveDocument` refreshes every entry's sum off the lines it just wrote
(`refreshTextFixedSums`) before the values file is written, so the line
names the text on disk. PDF-Linker applies a line only where the export's
page still sums to it, writes the page into the PDF's text layer, marks the
page (`_TEXT_FIXED_MARK_KEY`), spends the line, and exports the page under a
`TEXT CORRECTED` header (`headerSaysTextCorrected`). Adoption drops an entry
whose line was WRITTEN (it is in `valuesSavedKey`'s text with the same sum)
and is gone from the file on disk — spent by PDF-Linker — and takes in a
line on disk the list does not name. A page that reads `[DID NOT OCR]` has
no transcription: the button is disabled there, `markDidNotOcr` withdraws an
entry for the page it strips, and `syncNoOcr` drops one for a page that
reads it. `#text-fixed-block` lists them.

The LEAKS review bar works PDF-Linker's `LEAKS.xlsx` row by row from the
text: `leaks.js` (pure) reads the worksheet by header name, classifies a
Fix? cell the way `_pn_parse_decision_rows` will read it, parses the Where
and File cells, and matches a File name to its export (the reverse of
`pdfsync.matchPdf`); `text-reader.js` shows the current row in a bar above
the stage (it takes its own height through `--bar-h`), opens the row's
document, scrolls to its page and gutter line and marks the value
(`::highlight(leakrow)`), mirrors a `no`/`never` on a bound value as a
reader keep, and saves through `xlsx-write.js`, which rewrites ONLY the
Fix? cells as inline strings inside the original zip — every other entry
copied through with its compressed bytes, CRC and stamp — and reads the
result back before it is written. A `Combined Text.txt` is listed first
among a folder's documents, and `pdfsync.combinedMembers` reads its
`# Documents in this file:` list so picked PDFs are matched member by
member, by name through the key or by order.

The review walks the folder ONE DOCUMENT AT A TIME. A row stands in the
document its File cell names first (`leaks.rowFile` — one row is one
decision, made where the reader opens it), and `leaks.reviewOrder` puts the
rows in the order the review will reach them: the row in front, the rest of
ITS document — undecided first, in sheet order, wrapping — then the next
document's, the documents coming in the order the rows first name them and
those with something left to answer before those without. `nextUndecided`
walks that order, so a decision keeps the operator in the document in front
until it is answered; `leakFileOrder` and `fileDone` say which document that
is and when it is done. What the reader HOLDS follows the same walk:
`leakFileWindow` hands `leaks.leakPages` the document in front alone — and,
once `fileDone`, it and the next — so a folder of three hundred exports is
never asked for at once. Past BIG_FOLDER (24) exports that window is one
document; under it the reader works further ahead as it always has, since a
case of a dozen exports can hold every document with a leak in it.

The pages those rows name are drawn BEFORE the review reaches them.
`leaks.leakPages` lists every page a row names in that walk order, held to
the documents the window allows, and `text-reader.js` keeps a
window of twelve of them open and drawn into `ImageBitmap`s, queued through
the same one-PDF-at-a-time queue the pane uses and at the BACK of it, so
whatever is on screen is still served first. A slot coming into view paints
the held bitmap (`data-preview`, cleared when its own render lands), so the
`Loading…` box never stands on a page the worksheet already named; the
window moves with the review, closing what it leaves behind, and is emptied
when no walk is running. The names walk (the bar for real values from the key
standing in the clear) feeds the same window: `namesWarmTargets` reads the
pages of the name in front and the next ones in the direction the walk is
going (`leakDir`) off the last paint's hits, and the two walks take turns in
it. It is held whether or not the PDF is showing, because side by side and the
⇄ PDF swap are turned on AT the stop the operator has reached; with neither
showing, the window is the stop in front and the next (`WARM_AWAY`, 2) per
walk rather than twelve pages. The exports the rows name are read ahead
the same way — held against name, size and modification time, so a file
written since is read again — and an open takes the text from there instead
of going to disk; in a big folder that is the ONE document the walk will
reach next, read while the operator is still answering the last rows of this
one.

A worksheet of THOUSANDS of rows, in a case whose key holds thousands of
names, was a different animal again, and five things in the reader turned out
to be quadratic or worse in it. Each was measured in Chromium against a
generated case — 200 exports of 150 pages, 2,500 leak rows, a key of 4,000 —
before and after.

0. **The key's matcher ran at the speed of the whole key.** One alternation
   over every value means the engine tries the values IN ORDER at every
   position it cannot rule out, so a key whose names begin with all sorts of
   words is an attempt per name at every word of the document: four thousand
   names over a single page of pleading paper measured at 2.4 SECONDS, ten and
   a half for a hundred and fifty pages — and the reader reads a document
   whenever it opens one, marks the text or saves. That is a tab that does not
   scroll, does not answer a button, and is eventually offered up for killing.
   `buildMatcher` now files the values under their FIRST WORD: a name can only
   stand where its own first word stands, so the words of the text are walked
   once (a plain character-class scan, the one thing the engine does quickly),
   each is looked up in a map, and only the handful filed under that word —
   longest first, so a full name still beats its own surname token — are tried,
   each by its own small sticky pattern. The same key and text, 150 pages, the
   same 8,400 matches either way:

   | names in the key | one alternation | indexed by first word |
   |---|---|---|
   | 500 | 546 ms | 21 ms |
   | 1,000 | 1,861 ms | 18 ms |
   | 2,000 | 6,383 ms | 20 ms |
   | 3,000 | 13,578 ms | 18 ms |

   The old cost grows with the key; the new one does not. A differential test
   walks a matcher of ONE value at a time as the oracle, since that is still a
   plain regex, and the answers match position for position — over wrapped
   names, possessives, punctuation, digits, case, and a name standing inside a
   longer one. The shape the index cannot help with is a key whose names all
   begin with the SAME word ("Doe 1", "Doe 2", …): those all land in one
   bucket and are tried in turn, which is still the old behaviour and no
   worse.
1. **The key's matcher was too big to run.** Every space in a value is written
   as a fifty-character gap, so a few thousand names make an alternation of
   half a megabyte; the engine accepts the pattern and then throws *Invalid
   regular expression: too large* the FIRST time anything is matched against
   it. That first time was inside the first document opened, so the document
   never appeared and the empty screen stayed up — "the file is not even
   opening". `buildMatcher` now cuts a pattern past MAX_PATTERN into several
   regexes and works them as one (`Matcher`: `exec` with `lastIndex`, `test`,
   and `String.replace` through `Symbol.replace`), leftmost first and the
   longer match where two start together — which is what the one alternation's
   longest-value-first order meant. (The word index above subsumes this: a
   pattern per value is never too big. What remains of it is the small
   alternation for values that begin with punctuation, which no first word can
   file.)
2. **The engine compiles a matcher on first use, not when it is built** — five
   seconds for a key of four thousand names, paid by whoever opened the first
   document. `warmMatchers` runs each one against a scrap of text in idle time
   as soon as the key is compiled. First open: 17.4 s → 2.4 s.
3. **The marks were scanned again on every keystroke.** `paintHighlights` read
   every page under the key's matcher — three quarters of a profile of a leak
   review was `findRealSpans`. What it finds changes only when the text, the
   key, the flags or the keeps change, and answering a row changes none of
   them, so the pass is made once per state of those (`scanStale`, `textEpoch`)
   and a row step repaints the row alone (`paintRowMarks`). When it IS stale it
   settles a beat later (`scanSoon`), like the citation underlines and for the
   same reason. Ten `yes` decisions: 4.5 s → 0.44 s.
4. **Every keep was a scan of every keep.** `textdoc.keptControl` walked the
   list folding each value, and it is asked once per pseudonym span on the page
   (`remarkKept`) and once per key row (`keyLessKeeps`) — with a thousand keeps
   on a long document that is tens of millions of comparisons, and a leak
   review makes a keep every time the operator says "no", so the reader got
   slower the further through the worksheet it went. The list is now indexed by
   identity in a `WeakMap` (it is always replaced, never edited in place), and
   `allKeeps` memoises the concatenation so the index survives. Ten `no`
   decisions: 19 s → 1.5 s.
5. **Matching a name through the key ran the key over every candidate.**
   `matchPdf` translates each candidate for each name it is asked about, and
   `leakDocNames` asked it once per worksheet entry: hundreds of thousands of
   translations on every open and after every decision. `pdfsync.pdfMatcher`
   and `leaks.exportMatcher` translate their candidates once and answer from a
   map (400 ms → 3 ms per pass), and they are built from the WHOLE key rather
   than the key as the keeps have left it — which is both stable and true, the
   names on disk having been written before anybody kept anything.

Reading ahead now happens only while a REVIEW IS RUNNING. `planReadyDocs` and
`planWarmPages` used to start on any worksheet being attached, so opening a
seven-page declaration in a folder of forty-eight documents sent the reader off
to read, parse and build a DIFFERENT one — the document the first undecided row
stands in — and to open that document's PDF and measure its line grid. The
operator had asked for none of it and could see none of it; what they saw was a
tab that stopped answering within seconds of opening a small file. Both passes
are now gated on `leaksBar.hidden`: with the bar closed nothing is read ahead,
and `showLeaksBar` starts and stops the reading with the review itself.
`openPdf`'s per-page size loop takes the idle clock too — its `await`s resolve
from an already-parsed document, so they are no yield at all, and five hundred
pages of them was a task of a second or more.

A pass that never ENDS cannot be reported by the page it has stopped — the bar
cannot be painted and the observer cannot run — so a named pass also writes its
name to `localStorage` before it starts (`startDoing`) and rubs it out when it
finishes. A name still standing when the reader next opens is a pass that did
not come back, and `reportLastStuck` says so in the bar: "Last time, the reader
stopped while reading the marks over the text (Exhibit 12.txt) and did not
finish." That survives the freeze, the kill and the reload, which is the whole
point of it. It goes in the OFFER BAR rather than the toast: a toast is gone in
seconds and sits behind the document, and this is the one line that says what to
fix. Its button copies the line (`offerToCopy`). (A "plain reading" mode that
turned everything but the words off was offered here too; it went unused and
was removed.) The same breadcrumb records whether a whole case folder was open
(`whole`): a session that went down holding one makes the next file opened on
its own come in with its key alone and ASK before reading the rest
(`askBeforeFolder`), until the operator chooses the whole folder again.

And when a pass does hold the thread but comes back, the reader says which one: the heavy
passes name themselves while they run (`during`, `duringAsync`, `notePass`), a
`PerformanceObserver` on `longtask` attributes each blocked stretch to the pass
it fell in, each hold goes to the console in those words (the bar no longer
interrupts for one), and `window.__textReaderBlocked()` hands back the whole ledger, worst
first. A reader that is slow can now be asked where.

Two long passes were also being made in ONE TASK each, which is a reader that
cannot answer a click while it runs — the measure of that is the browser's own
`longtask` count, and sitting still after opening a document used to cost two
of them and 1.2 seconds. Both now take the browser's idle clock and give the
thread back before it runs out (`idleClock`, `SLICE_LEFT`):

- The document-wide mark pass (`scanPass`) reads, looks at the clock, and
  yields; nothing is shown until the reading is whole, so what stands on the
  page is always the last complete one, and a pass whose ground moves under it
  (an edit, the key, a keep) gives up and is made again. It yields between
  HANDFULS OF NAMES rather than between pages, because a page is not a bound on
  anything: a PDF export is pages, but a WORD export has no page headers at all
  (`textdoc.parseExport`), so the whole file is one page and "a page at a time"
  is the whole document in one go — which is what the reader was doing on a
  declaration it could never finish. `pseudo-key.findRealSpansFrom` reads a
  handful and says where to carry on from; the kept and flagged loops count
  their own and put the thread down the same way.
- And it gives up rather than hang. Past MARK_BUDGET of work on one document
  the marks stop (`giveUpOnMarks`), the highlights are cleared, `marksOff`
  keeps the pass from starting again for that document, and the bar says what
  happened, with the line to copy. The next document — or the next key —
  gets another chance (`marksGetAnotherChance`). A pass that cannot finish is
  worse than no marks at all, since the page it is reading is a page nobody can
  scroll.
- Building the next document ahead (`buildAhead`) built eight pages between
  yields — most of a tenth of a second under a big key — and did it WHILE the
  operator was answering rows, so the review kept moving the window, throwing
  the work away and starting another document. It now waits for READY_QUIET of
  quiet before it starts, builds a page at a time against the clock, and stops
  where it stands when the operator comes back, picking up in the next gap
  rather than starting the document again. Sitting still after an open: 2 long
  tasks and 1.2 s blocked → none at all.

Two smaller ones: `compileTypeahead` asked "does this real open a longer one"
by scanning every value per value, and now reads each value's own word edges in
one pass (`openingsOf`, 212 ms → 13 ms at 2,000 names beside 2,500 keeps); and
the Leaks tab's list is built once and written on (`leakLis`, `paintLeakRow`)
rather than thrown away and made again — ten thousand elements per keystroke on
a worksheet of two and a half thousand rows. An uncaught error now also reaches
the toast bar, since the failure above was silent.

The PDFs behind them are closed again behind the review. `pdfCache` used to
hold every PDF opened for as long as the folder was open, which is right for
a case of a document or two and fatal for a folder of three hundred: each
holds its bytes, its pages as pdf.js holds them and the line grid read off
every one of them, and a review that hops from document to document opened
them all. `trimPdfs` (called as the document changes and as the worksheet's
window moves, and as the reading scrolls) destroys the PDFs nothing points at
any more, keeping the PDF_HELD most recently asked for past those, since
stepping back to the document just answered should not read it again.

`pdfsInUse` is WHAT THE READING HAS REACHED, not what the document names.
Naming the open document's every source pinned the whole case again by
another road: the reel hangs twenty exports off one document and a
`Combined Text.txt` names three hundred, so every PDF the reader had ever
scrolled past stayed open and the trim had nothing left to close. The window
is `pdfsync.pdfsNear` instead — the page the reading line sits on
(`readingPage`, the same line the reel reads "which document" from), out to
`PDF_REACH` pages either side and `PDF_NEAR` documents at the most — plus
whatever an IntersectionObserver says is on screen (`pdfInView`, so a page is
never closed under the drawing), the swapped-in pages, the warm window and
any PDF carrying redaction boxes. A PDF picked by hand is no longer pinned:
the File it was picked from is still held, so closing it costs a re-read and
nothing else. A folder of three hundred holds four to seven open, whatever it
holds: 40 open → 4 on a combined file of forty documents read end to end.

The pane no longer asks every slot for its page size as it is built. That ask
was a `loadPdf` per slot, so a combined file of a big folder read, parsed and
measured the whole case folder before a page could be looked at. `buildPdfPane`
opens only what `pdfsInUse` already allows; the rest stand at letter until the
reading comes near (`renderInto` opens the PDF of a slot coming into view) or
their PDF is opened for something else. Page sizes are then kept by name in
`pdfSizes` AFTER the PDF is closed — two numbers a page, and a page's size
cannot change under a reader who is only reading — so a PDF read once leaves
the pane its geometry for the session and `sizeSlotsFor` gives every slot of
it its height at once. A slot with nothing known about its own page stands at
`pageRatioGuess`: the paper the first PDF of this folder actually had, since a
case folder's filings are printed on one paper, and the slots standing at the
wrong guess are restood on it once, as that first PDF lands — never again,
because a slot the reader has scrolled past is holding the column up under
them. On a combined file of forty documents that is every slot at the real
page shape with four PDFs open, where it used to take forty.
