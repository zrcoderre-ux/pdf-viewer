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
