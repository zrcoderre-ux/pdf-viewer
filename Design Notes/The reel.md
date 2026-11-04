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
- **What still builds every page:** the LEAKS walk, the names walk, the key
  bar, the redaction tool, Replace all and the save's names-to-fake pass. Each
  reads or edits page bodies throughout (`reelAllLive`), and on a long document
  that is the eleven seconds, paid when the tool opens rather than at every
  open.

Measured on the same folder after: the open 0.7–1.1 s, side by side 0.47 s,
the longest hold scrolling 145–195 ms, PDF mode unchanged (its viewer was
already `content-visibility: auto`). `test-long-document.mjs` drives it.
