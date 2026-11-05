## The reel: the case folder read as one document (`text-reader.js`)

`doc.pages` is the whole reel, page after page, exactly as a combined file's
pages would be — that is the load-bearing choice. Everything that reads a page
by its index (the PDF pane, the citations, the rules, the leak rows, the spot
keeps) goes on working without knowing there is more than one file in it, and
`reel` — `[{ name, handle, newline, trailingNewline, from, count, dirty,
spots, d, base, editSeq, built, conflict }]` — is the only thing that does.
A member's `d` is its entry in `folderDocs` (null for a file that is not one
of the folder's; resolved as it is opened or hung, and, for a document opened
on its own before its folder was, when the folder is adopted —
`linkReelToFolder`, by the file itself), `base` the file it was read from (`{ text, stamp, opened
}`, what Save checks the disk against), `editSeq` a count `reelMarkDirty`
bumps on every edit (a save clears `dirty` only where it is unchanged, so
typing during a save stays unsaved), `built` its pages' typing baselines
where it came out of the store, and `conflict` its file written since its
edits began.

- **Appending never moves an index.** A member's pages are concatenated onto
  the end, so every index already handed out stays what it was. This is why
  trimming a member off the front is NOT implemented as removing its pages:
  that would shift every index below it. If the DOM ever needs dropping for
  memory, drop the DOM and keep a spacer — leave `doc.pages` alone (which is
  what shedding does).
- **The folder reads both ways, and going up is the expensive direction.**
  `reelPrepend` hangs the export BEFORE the head above it, which puts pages on
  the FRONT of `doc.pages` and moves every index below them. `reelShift(n)` is
  the one place that pays for it: the `.tpage` sections, the members' `from`,
  the spot keeps (moved by OBJECT — the open document's list and its member's
  are usually the same array, and sometimes the same objects in two arrays),
  the undo and redo snapshots and `lastSnapPage`, in one pass before the pages
  go in. Nothing is renumbered under a pass holding page numbers of its own
  (`reelCanRenumber`: the leak review, the names walk, the redaction misses, a
  print). Everything else is derived and simply rebuilt by `reelChanged`.
  Two consequences worth keeping in mind when touching this code: a page index
  may NOT be closed over across a prepend (the swap button reads its section's
  `data-index` at the click), and the scroll has to be put back by hand
  (`#stage` sets `overflow-anchor: none` and `reelPrepend` measures the old
  head page before and after the layout), or the reading jumps by the height
  of whatever went in above it.
- **Reading up is asked for, not assumed.** Downward extension runs off the
  scroll alone; `reelMaybePrepend` runs only when the reading is coming UP the
  column (`reelScrolled`), or off a wheel turned up or an up-key at the very
  top, where the scroll box has nothing left to give and fires no event. A
  document opening at its own first page does not pull the case in above it.
- **`docMembers()` / `docPageSources()`** are the two accessors the rest of the
  reader goes through. They answer from the reel when it has members and from
  the combined-file banners otherwise, which is how the pane, the pickers and
  the review became reel-aware in one move.
- **Never off a `Combined Text.txt`** (`reelOn`): that file already holds every
  export, so hanging the folder's exports under it is the case read twice.
- **Saving is one file per member** (`memberDoc`). What is written is what was
  edited: `setDirty(true, pageIndex)` marks the member holding the edited page,
  and every call site passes its own `body`'s index so an edit near a divider
  is filed against the page it was made in rather than the reading line. The
  standing "no real value may be written" assertion runs **per file, before any
  file is written**, so one member being clean can never let another out.
- **Leaving the reel keeps its edits.** Opening another document used to ask
  "Discard unsaved edits?" and drop every dirty member with a yes. With a case
  folder open in full, `stashReel` puts each dirty member that is one of the
  folder's documents into the store of unsaved documents first (its text as
  Save would write it, its spot keeps, its pages' `__built` baselines), and a
  document the reel hangs or opens from the store comes back dirty, with its
  edits (`hungFromStore`). A document's unsaved text is on the reel or in the
  store, never both. Save writes both. The store, and the folder-wide Replace
  all that fills it, are in `Design Notes/Unsaved documents and the folder
  save.md`. Nothing is hung while a save or a folder replace being prepared
  holds the members still (`saving`, `folderPass`).
- **A parse built ahead is used only where it is of the file as it now is.**
  `reelExtend` and `reelPrepend` take a `ready` parse only where its `fileKey`
  equals the file's stamp now (`readReelDoc`); a stale one, hung and saved,
  would write the old text back over whatever wrote the file since. The copy
  is cloned, and `buildAheadNow` keeps the text it was built from for `base`.
- **Spot keeps are stored per document, rebased.** A spot names a page of its
  own file, so `persistMemberSpots` writes `page - member.from` and
  `spotsFrom` adds it back as a member goes on the reel. Storing the reel's
  own numbering made a document's keeps depend on where it happened to be
  hung. **Every path that touches a page's keeps files them under the member
  that owns the page** (`spotsListOf(i)`, `setSpotsListOf(i, list)`,
  `persistMemberSpots(m)`): `buildBody`, `syncSpots`, `restoreSnapshot`, the
  ⊘ Did not OCR strips, Save's rebuild. They used to go into the open
  document's list and its store, rebased by the open document's `from`, which
  put a keep where there was none and lost the one there was.
- **Shedding keeps the history.** A shed member's undo steps used to go (the
  page had no body to put them back into), which made a Replace all across
  several members, saved and read away from, come back only in part on
  Ctrl+Z. Now a step for a shed page is put back into `doc.pages` and the
  member's spots (`restoreSnapshot` with no body), marked dirty, and built
  from there when the reading comes near it again; `reelShift` leaves a
  folder replace's marker (no `page`) alone.
- **Nothing is shed under a find.** The find bar counts the reel's documents
  off their pages and leaves them out of the folder's rows (`onReel`, so no
  document is counted twice); a member shed with the bar up was counted
  nowhere — "none here · nowhere else in the folder", Replace all off.
  `reelTrimNow` holds the reel while the find bar is open, as it does under
  the LEAKS and names bars and the redaction tool, and opening the bar builds
  every member back (`reelAllLive`).
- **`REEL_MAX = 25`,** either end. A folder can hold three hundred exports;
  read end to end that is a tab that stops answering. The ceiling degrades
  into a message.

### A long document is shed by the page (`LONG_DOC_PAGES`)

The reel lets go of a DOCUMENT at a time and never of the one being read, which
is the right piece for a folder of pleadings and the wrong one for a deposition
of 1,200 pages. Measured over a case folder holding one (and a few five-page
filings beside it), every page of it was built at the open — **15.1 s** of a tab
that answered nothing, two of them building the DOM and the rest the browser
laying out thirty thousand lines — and every pass that lays the pages out (the
grid, the fit, the citations) then ran over all twelve hundred: 5.4 s turning
side by side on, and 111 holds of up to 738 ms scrolling down it.

A member longer than `LONG_DOC_PAGES` (150) is shed a page at a time:

- **It goes up with `LONG_DOC_OPEN` (12) pages built** (`buildPages`'s `live`
  range; the reel's `reelExtend` and `reelPrepend` build the end nearest the
  reading the same way). The rest stand as shed sheets (`shellPage`): the
  section and its label, no body, at `height: var(--page-guess)`. The guess is
  the median height of the pages built (`guessPageHeight`), set once on
  `#pages` and re-read after every change, so a page never built is as tall as
  the run of the document. One body-building path serves the first build and a
  page built back (`fillPageInner`), so a page built back carries its restored
  margin numbers, its condensed sheet and its ✓ Use my text as it did; the old
  `unshedMember` built a bare body.
- **`reelTrimNow` trims it by the page** (`trimPagesOf`): built within
  `REEL_KEEP_SCREENS` of the screen, let go of past half as far again, so a
  page at the edge is not built and shed on alternate scrolls. The page the
  reading stands on is measured before and the scroll put back from where it
  stood after, since a page built above the reading comes up at its own height
  rather than the guess.
- **A page is never let go of where its body holds something the text does
  not** (`pageMustStay`): an edit (its text is not `__built`, which is what a
  typed real name is measured against), a name Esc left as typed, the caret
  while editing, a selection, or its PDF page swapped in. So the old rule
  "anything typed in stays" still holds, at the page. A document out of the
  store keeps its pages' baselines in `m.built`, and a page of it built later
  takes its own (`buildShedSections`).
- **Shed is a page's state, not only a member's.** `m.shed` still means a
  whole document let go of; a page shed out of a long one is `.tpage.shed` on
  its own (`pageShedAt`, `reelHasShed`). The undo history (`restoreSnapshot`,
  the redo side) and the save's "names to fake reach a shed member" ask the
  page. Spot keeps of a page let go of are filed through
  `spotsListOf`/`setSpotsListOf`, since the page may be the open document's.
- **A re-layout does not build it back** (`reelLiveForLayout`). The old
  answer to a resize or a setting — build every shed page, measure, shed again
  — is the fifteen seconds over again; a long document's shed pages are stood
  at the guess instead, re-measured once the layout has run. That moves every
  page above the reading at once, and the scroll clamped to the column's new
  foot let `holdReading` go as though the reader had scrolled: the reading
  landed 150 pages on. `keepReadingOver` measures the page being read before
  and after and puts the scroll back from where it stood.
- **Find reads the pages not built off their text** (`scanFindHere`): a hit
  there is `{ page, nth }` in its place in the order, counted on the page as
  it would read (`shownPageText`, `textdoc.shownPages`, kept per page while
  its lines, the key and the face stay). Standing on one builds the page and
  finds its `nth` hit on it (`hitRangeOf`); `ensurePageLive` builds a page
  either side of it, not the document. Under the find bar the long document is
  still built as the reading comes to it and nothing of it let go of, since a
  hit's range is a place in a body. Ctrl+F was 11.2 s with every page built
  back for it; it is now a hold of about 0.7 s for the first query (the pages'
  shown text read once).
- **What still builds every page:** the key bar, the redaction tool, Replace
  all, and a save's names-to-fake pass outside a long document (in one, that
  pass builds only the pages carrying a name in the clear,
  `buildReviewPagesNow`). Each reads or edits page bodies throughout
  (`reelAllLive`). The LEAKS and names walks no longer do: below.

Measured on the same folder after: the open 0.7–1.1 s, side by side 0.47 s,
the longest hold scrolling 145–195 ms, PDF mode unchanged (its viewer was
already `content-visibility: auto`). `test-long-document.mjs` drives it.

### A long document under the review (`reviewPreload`, `pageReview`)

The LEAKS walk and the names walk read their document off its pages, and both
had the whole reel built as they opened. On the 1,200-page deposition with a
worksheet of three rows: 24 s to the first row, the tab held for 4.8 s at a
time and the row's mark not on screen when it settled, 4.9 s more opening the
names walk, and holds of up to 358 ms scrolling under the review, every pass
laying out all twelve hundred pages. Building them in batches would have ended
the freeze and kept the last of those, so the review builds what it reads:

- **A page not built is read off its text** (`pageReview`, kept per page while
  its lines, the key, the flags and the keeps stay): the real names from the
  key in the clear and the flagged values standing in the clear, by
  `textdoc.clearReading` over that one page (the folder sweep's reading of a
  file, which is the page's own by construction), and the kept values the
  master's list asks about. Spot keeps are not subtracted, so the answer is
  never short of what the page built would say.
- **The marks pass reads them too** (`scanPassNow`, after the bodies): the
  names in the clear on pages not built go into `shedLeakHits`, the flags into
  the Documents list's counts and the kept values into what the master's list
  sees. So the status bar's count is the document's, not the dozen pages built
  (the page-by-page shedding had left it counting only those, and with none
  near the reading the count was empty and could not start the walk), and
  `settledInTheClear` and `decidedOwed` light the save for a name said to be
  faked on a page not built.
- **The review's pages are built in batches** (`reviewPreload`; removed
  since: the names walk now builds its next stop's pages as it comes to
  them, "The names walk builds its next stop's pages" below). With either
  bar up over a reel holding a long document, the pages not built are asked
  `pageNeedsReview` nearest the reading first, and those carrying something are
  built `REVIEW_BATCH` (8) at a time on the idle clock, the reading held
  through each (`keepReadingOver`) and the pages shaped once a second rather
  than at every batch. It starts as a bar opens, and again from
  `paintHighlights` whenever its answer is stale (a new document, key, flag or
  keep: `reviewKey`). Under the review the trim still builds and lets go of
  pages with the reading, but never one the review reads, one a mark stands in
  (`reviewHitSections`), or the row in front's (`rowHold`).
- **The document is not read until the batches are in and read**
  (`reviewPending`, in `readHere`). A count made of part of the document would
  send the walk out of it early: walking in from a short document, the bar
  stood on "1 of 4" and ran off the end of the four into the next document.
  `reviewPre.painted` is set only by a marks pass begun after the last batch
  went up. A step off the end, or the walk's first stop, waits
  (`awaitReviewPages`: the names bar opened if it is not, a page with a name
  still not built built at once) and is taken from `renderLeakStatus` once the
  reading is in (`stepAfterReview`); the bar says "+ (reading the rest)" in the
  meantime. After each pass the walk is put back on the name it stands on, by
  its range, since pages built above it put names before it in the count.
- **The row in front is built where its value stands** (`buildRowPages`, from
  `locateLeak` after its document is open): a page whose text has the value as
  a whole word, or a name wrapped over its line with its first and last words
  on it; inside a word only where no page has it whole, as `rowRanges` reads
  it; nearest the row's Where first, `ROW_PAGES_MAX` (150) at most. A value
  standing inside a pseudonym is the faked occurrence there, and the file
  carries the fake, so the text as the file has it is the right one to read.
- **One preload loop fix worth remembering**: `paintHighlights` starts a
  preload only where the batches are not in (`reviewPreloaded`), never where
  only the reading after them is owed. Asking on `reviewPending` started a new
  preload at every paint, each one cleared `painted`, and the walk waited for
  ever on "reading the rest".

Measured on the same folder after: the first LEAKS row's longest hold 120–148
ms (was 4.8 s, and 24 s to land), rows on pages 600 and 1150 under 100 ms,
opening the names walk at most 135–201 ms (was 4.9 s of holds), stepping it
under 110 ms, scrolling under the review at most 80–99 ms (was 358 ms), about
twenty pages built where it was all twelve hundred. `test-long-document.mjs`
drives the review on a 400-page document: the count with no bar up, a LEAKS row
on a far page, the walk from the count and into the long document from a short
one, every name stood on in turn, and fake it with the save writing every one.

### The worksheet alone builds only its row's pages (`reviewOpen`, `rowNeedles`)

The owner, 2026-11-05: "Leaks is still something of an issue, it makes
everything less responsive". The preload above ran under either bar, and what
it builds is every page carrying a name in the clear (`pageNeedsReview`). On a
deposition whose witness is named on every page that is the whole document:
measured on a 1,000-page export with a 400-row key and a 40-row worksheet, the
LEAKS bar opened onto 30 s of holds while all 1,000 pages were built (each
second's `afterShedChange` running "finding the citations" over every page
built, 220–280 ms at a time), and after it a scroll held the tab 16 times in
4 s and each row answered for about 300 ms.

The worksheet does not walk those names. Its row's pages are built for it
(`buildRowPages`), and a page's names are swept on the way to the next row only
with the names bar up (`pageSweepFor`). So `reviewOpen`, which the preload,
`reviewPending` and the trim's hold on review pages ask, now means the names
bar. Under the worksheet alone a long document is built and let go of with the
reading as with no bar up, and the trim holds only the row's pages and the
sections its marks stand in (`reviewHitSections({ names: false })`). The names
in the clear on pages not built are still counted off their text
(`shedLeakHits`). Opening the names bar over the worksheet started the preload
as before (the preload is gone since: below).

`rowRanges` also no longer flattens every built body for the row's value. A
body whose `textContent` lacks one of the ASCII word runs of the value's first
or last word is passed over (`rowNeedles`). Every reading `leakMatches` makes
needs those runs: the whole-word pattern writes a word run literally and folds
an ASCII letter only onto its own other case (no u flag); the reading inside
words looks for the value itself; the reading down a column is asked only
where the first and last words stand. `flatten`'s text is the body's text with
line breaks added and pseudonyms blanked, so it holds no run the
`textContent` does not. Runs in another script are not used as needles.

Measured on the same export: the bar up, no holds (was 30 s of them); scrolling
under it, none (was 16); a row answered, 0–2 holds of at most 80 ms (was about
300 ms); about 30 pages built (was 1,000). `test-long-document.mjs` checks that
a far page with a name in the clear stays unbuilt under the worksheet alone.

### The names walk builds its next stop's pages (`awaitShedNames`, `buildNamePages`)

The owner, 2026-11-05: "The pdf viewer warning click to go on is also very
slow." The status bar's "⚠ none left here, and N in 1 other document — click
to go on" opens that document and stands the walk on its first name. Into a
1,000-page export naming someone on every page, that took 48–72 s. The walk's
first stop waited for the preload to build every page carrying a name, and the
preload's once-a-second `afterShedChange` (citations over every page built)
held the tab 400–500 times on the way.

The preload is gone. The walk asks, at each step, whether the next name the
built pages offer comes before the nearest page not built that carries one
(`liveShedLeaks`, read off its text). Where the page not built comes first,
it and the next `WALK_AHEAD` (8) pages carrying a name in the step's direction
are built (`buildNamePages`). The step is then taken once the marks have been
read over them (`shedBuilt`: `reviewPending` is a build not yet read, and
`renderLeakStatus` takes `stepAfterReview`). The first stop is the document's
first name, a step goes to the next name wherever it stands, the walk goes
round from the end to the first page and back from the first to the last, and
the scan pass keeps the walk on the name it stands on as pages are built
around it. The bar counts the names on pages not built from the last reading,
filtered by page state, so a page built and not yet read is not counted twice
or left out.

The save that writes names said to be faked used to build every page carrying
a name (`buildReviewPagesNow`). It now builds only the pages carrying a settled
one (`buildSettledPagesNow`), unless a worksheet row's yes is to be written
too, since worksheet values are not read off pages not built.

A second click while a jump is still saving or opening is not a second save
(`jumpToDoc`, `jumpingTo`): it used to be refused under the first ("Wait for
the save to finish", "Wait for the document to open"), and the walk stopped
saying the document "was not written". It now says it is still opening.

Measured on the same export: the click to the first name 1.9–2.3 s (was
48–72 s), 12 pages built (was 1,000); each step 0.2–0.3 s, and 0.6–1.4 s
where it builds the next eight. Walked forward over 30 names, back over 12
across the wrap, and over a name every 37th page, each stop the next page in
order and the count right.
