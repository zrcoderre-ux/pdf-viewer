## Unsaved documents and the folder save (`text-reader.js`)

With a case folder open in full, the reader holds every document the
operator has changed, on screen or not, until one Save writes them all, and
counts every decision about what is faked or kept as unsaved until that
Save. Replace all reaches every export of the folder.

### Why

The operator asked for three things, in order:

1. "Also, for a find and replace, if I do replace all, I shouldn't have to go
   document by document. It should do every document if the case folder is
   open."
2. "Also, saving needs to apply to all files in an open keep folder. I
   shouldn't miss things because of that." (The open case folder: Save
   writes every document of it with unsaved edits, moving between documents
   never drops an edit, the status bar counts them, and closing the tab
   warns.)
3. "And by edited in that includes decisons about what to fake or not."
   (Every decision about what is faked or kept is unsaved until the same
   Save writes it.)

Until then Replace all replaced on the pages on screen only (the open
document and whatever the reel had hung under it), and the notes recorded
that on purpose: "It edits only the page bodies in the DOM; the folder is
never written from the bar." The owner reversed that. Opening another
document asked "Discard unsaved edits?", so a Replace all followed by
Replace walking on into the next document lost the first document's
replacements unless the operator saved between documents. A "fake it"
decision lived in memory alone and reached only the documents on the reel.

What still holds: **the find bar writes no file.** Replace all changes text
and leaves it unsaved; Save is the only thing that writes an export.

### The store and its invariants

`unsavedDocs: Map<name, Entry>`, beside the reel's dirty members:

```
Entry = { name, d, handle, base: { text, stamp, opened }, doc, spots, built, seq, conflict }
```

- `d` is the document's entry in `folderDocs`; `handle` is `d.handle`.
- `doc` is `{ newline, trailingNewline, pages }` in the file's face (fakes),
  with restored margin numbers and `p.restored` kept.
- `spots` are the document's spot keeps, page numbers relative to the
  document.
- `built` is each page's `__built` baseline: what an edit is still measured
  against when the page comes back (`convertTypedReals` marks only what an
  edit wrote).
- `base.text` is the disk text the edits started from, and what Save checks
  the disk against; `base.opened` is `serializeExport(readExport(base.text))`,
  which tells when an undo has taken the document back to its file.
- `unsavedSeq` goes up on every change to the store, and every cache that
  reads a document through the store keys on it (`findScanStale`,
  `sweepStale`, `fakesIndexStale`, `findShown` by the stamp `unsaved:<seq>`).

**A document's unsaved text is in exactly one place: on the reel (its pages
in the DOM and `doc.pages`, the member dirty) or in the store, never both.**
`stashReel` moves every dirty member that is one of the folder's documents
(`m.d`) into the store before the reel is let go of: each live page's typed
real names are marked first (`convertTypedReals(body, { quiet, caret: false
})`, since the caret the converter waits on is going), its text is read back
with `serializeNodes`, and its spots and `built` go with it. A member hung
or opened from the store takes the entry out (`hungFromStore`, `openText`
with `{ stash }`) and is dirty from the start. A dirty member with no `d` (a
file that is not one of the folder's) has nowhere to be kept, and opening
something else still asks "Discard unsaved edits to …?", as a lone file and
a light attach do.

Every reader of a document goes through `readDoc(d)`, the store first:
`findPagesOf`, the sweep, `reelExtend`/`reelPrepend` (a stored document is
hung with its edits), the off-screen prepare and the save. `buildAheadNow`
skips a stored document ("unsaved edits"), and `readyFor` gives null for one,
so a page built off the file can never go up over the edits.

Reel members gained `d` (resolved once: the same object, else `isSameEntry`,
`folderDocOf`), `base` (captured wherever the file is read), `editSeq`
(bumped by every `reelMarkDirty`), `built` (carried from a store entry) and
`conflict`. `adoptFolderNow` re-links `d` and `handle` of members, store
entries and the journal's documents by name when the same folder is adopted
again (`relinkFolderDocs`); another folder clears the journal, the whole undo
history (both stacks), `seenDocs` and `confirmedDocs`. Any adoption then links
every member not linked to the new list by the file itself
(`linkReelToFolder`: the same handle, else `isSameEntry`), reading its `base`
from the file where it has none: a document opened on its own and then joined
by its folder (Open case folder over it, an attach for its key, the adopt
hook) is one of the folder's from then on. Left unlinked, as it first was, its
edits counted as a loose file's — opening another document asked "Discard
unsaved edits?", `stashReel` passed it by, and Save wrote it through
`writeText` with no content check. A member of another folder loses its `d`.

**Moving between documents asks nothing inside the folder**: the Documents
list, the find walk, Replace walking on, a reel divider's "Open on its own",
a LEAKS row, the names walk, a picker or a drop of one of the folder's
files. **Leaving the folder** (another folder picked, Forget this folder, a
file of another remembered case folder) with documents unsaved asks
`leaveFolderAsk`. Its first confirm's OK saves it all and goes on only if
everything was written; its Cancel saves nothing and leads to a second
confirm, whose OK leaves without saving and whose Cancel stays. Each says
what its buttons do: the first used to say "Cancel — stay", and then asked
whether to drop everything, with OK the answer that did. Decisions alone do
not ask; they are remembered per folder. `adoptFolder` returns null where the
operator stays, and its callers stop.

Leaving without saving (`dropAllUnsaved`) empties the store and puts every
dirty member back on the page as its file reads (`putMemberToFile`: its
`base` text parsed and laid in by `putMemberBack`, its typing baseline and
own undo steps reset), so what is on screen is what is on disk. It used to
clear the dirty flags only: the edits stayed on the page with nothing saying
so, and the next plain Ctrl+S — the empty-save rule writes the document being
read — wrote what had just been "dropped". A member with no `base` is kept,
unlinked (a loose file's question from then on). The journal is told
(`journalDropped`), as it is by `dropUnsaved` and `takeDiskVersion`.

An opened or hung store entry is checked against its file
(`checkStashConflict`, `hungFromStore`: the stamp first, then the text). One
written since its edits began is tagged `conflict`, the offer bar says so,
and "Take the disk's version" drops the edits after a confirm
(`takeDiskVersion`). The Documents list tags each unsaved document `unsaved`
(amber), or `changed on disk`. The tag is a label — a click on it opens the
document, as the row does — and one not on screen has a × after it that drops
its edits after a confirm (`dropUnsaved`). The tag itself used to drop them, so
a click meant to open the document landed on a prompt to throw the work away.
Not a ●: that already marks a document built ahead.

### Shadow pages

A document off the screen is worked on pages built by the reader's own code
in `#shadow-pages`, a hidden container ON the page (so `convertTypedReals`,
which returns 0 for a body that is not connected, marks a real name typed as
the replacement, exactly as it does on screen) and OUTSIDE `#stage`/`#pages`
(so nothing that walks the pages on screen meets it). `shadowPage(pages, i,
spots, built)` builds one page with `buildPages(shadowEl, pages, { from: i,
to: i + 1, spots })`: `spots` is ALWAYS an array, since a null falls back to
the open document's spots and would file another document's keeps on this
one. Each page is worked synchronously under `batchEdit = true`
(try/finally), so `snapshot()` pushes nothing onto the open document's
history; `syncSpots` and `snapshot` also return early on a shadow body, and
`snapshotPages` skips one (`isShadow`). The page's spots are read back with
`spotsFromBody` and kept with the document, never with
`syncSpots`/`persistSpots`. The container is emptied after every page
(`clearShadow`). The thread is given back between pages, never in the middle
of one.

`settleReplaced` became `settleBody(body)` (`normalizeLines`,
`convertTypedReals` quiet, `dressColumns`; how many names it marked) plus the
on-screen bookkeeping (`syncSpots`, `setDirty`), so the shadow page runs what
a page on screen runs, and nothing else. `replaceAll` became `planHere(rx)`
and `applyHere(edits, withText)`, and keeps its old behavior for a lone file,
a light attach, an open `Combined Text.txt`, and a folder with nothing off
screen.

### Counting per page

The folder's count reads each document page by page as the screen reads a
page (`TD.shownPages`, through `findPagesOf`): the lines translated through
`rev` with Show fakes off (as they are with it on), each line's margin
number blanked. A page header, a DOCUMENT banner and a margin number are
never a hit, and a phrase is never counted across a page break, so the count
is what Replace all replaces plus what it leaves standing. `TD.shownPages` was
checked equal to `flatten(body, { blankGutters: true })` on every fixture
page, both faces (`test-folder-save.mjs` case 13). Each document counts once:
the reel's members on the page only (`TD.splitFolderRows(findRows, onReel)`),
and `Combined Text.txt` apart, as "left to PDF-Linker". "On the page" has to
stay true while the bar is up, so nothing is shed under a find (`reelTrimNow`
returns while the find bar is open, as it does under the LEAKS and names
bars; opening the bar builds every member back, `reelAllLive`). A member the
reel shed with the bar up was counted in neither place: "none here · nowhere
else in the folder", Replace all off, Replace walking on past it
(`test-folder-save.mjs` case 17).

### Prepare, confirm, commit

`replaceAllEverywhere`, with `folderOpen()` and the head not the combined
file:

1. The stamp of the question: query, Match case, Show fakes, `rev`, `fwd`,
   `keepsSignature()`, the reel's member names, `unsavedSeq`.
2. The folder's count in (`awaitFolderScan`, waiting however long a big
   folder takes; `findScanDone` names the question whose count `findRows`
   holds). The note reads `Reading <folder> for “q”…`, the button `Stop`.
3. With nothing off screen, the on-screen Replace all, no confirm.
4. Each document off screen with a hit prepared in folder order, one at a
   time, in idle slices, under `folderPass` (`prepareDocReplace`): only the
   pages whose shown text has a hit are built; per page `shadowPage` →
   `flatten` → `planReplace` → apply last first → `settleBody` → lines from
   `serializeNodes` → its spots from `spotsFromBody`. Nothing outside the
   copy changes. Esc, Stop or closing the bar stops it: "Replace all stopped
   — nothing was changed." A change of the stamp stops it too.
5. The screen planned again (typing went on meanwhile), then one confirm
   naming the documents on and off screen, the hits left standing, the real
   names in the replacement (by name: "“Corwin Ashdale” in the replacement is
   a real name"), and the combined file. The toast after counts the places
   those names went in as places ("6 occurrences of 1 real name marked",
   `markedNote(n, names)`): the confirm used to count names and the toast
   occurrences, each as "real names", so the two disagreed about one act.
6. `commitFolderReplace`, one synchronous step under one batch id: the
   on-screen members' before journalled, `snapshotPages(onScreen, id)`,
   `applyHere`, their after journalled; each prepared document put in the
   store and journalled; the marker `{ batch: id, folderReplace: id }` on the
   undo stack; the record on `replaceJournal`. Nothing is written.

While a replace is being prepared or a save runs, opening a document, Replace
all, undo and the reel's hanging are refused (`refuseWhileBusy`: "Wait for
the replace to be prepared (Esc stops it)." / "Wait for the save to finish.").

### Save's pass over the folder

`saveDocument({ offscreen = true })`:

0. Before any await: the folder's grant asked
   (`dirHandle.requestPermission`, while the click or key still counts as a
   user gesture; no prompt where it is granted), and each member's `editSeq`
   recorded.
1. On screen, each page through `savePage(body, i, rebuild)` (the old loop:
   `serializeHeld`, `standingSpans`, `forwardText`), with
   `TD.spotsAfterSwaps` moving the page's spot keeps to where the forward
   pass put them — held in hand (`spots`, `m.spots`) and stored only once
   that member is written (`spotsMoved`). Stored at once, a save that then
   wrote nothing (the assertion, the grant, Esc, the content check) left the
   store counting occurrences the file did not have yet: once the edits went
   (a reload, leaving without saving), a keep made at the third "Corwin
   Ashdale" moved to the first, and the next save kept the one said to be
   faked and faked the one kept (`test-folder-save.mjs` case 16).
2. Off screen: every store entry not on the reel, and every document where
   a name said to be faked still stands (`settledElsewhere({ fresh: true })`
   after `sweepNow()`, which waits for a sweep running and skips the quiet
   delay). A document never opened or hung this session and named by no
   confirm before is asked about first; Cancel leaves it out of this save.
   Where the folder will not read fresh even so, the toast says the names
   were written nowhere off the screen (`elsewhereUnread`), rather than pass
   for a save that found none.
3. `prepareOffscreenSave`, a document at a time, Esc stopping it with
   nothing written: per page `TD.pageScan(raw, { rev, reals, spots, mask })`
   says whether a real stands (cited ones included, or a spot keep
   overlapping a swap or a margin number, as a safety valve); only those
   pages, and a page an edit changed, are built and put through `savePage`.
   The rest go as they are, read through `scan` (spots, swaps and cited
   names blanked). A document only a decided name brought in is written only
   where the pass changed something in it; a stored one always.
4. The key moved meanwhile: nothing written.
5. The standing assertion over every document about to be written, on
   screen and off (`TD.realsLeftInExport(plain, held, { reals, mask:
   maskKept })`). One failure writes nothing.
6. `await grant`; refused, nothing written.
7. In folder mode, for each document: the disk read again through its
   handle and compared with `base.text` (`diskStill`); a mismatch is a
   conflict, kept unsaved and named, and a missing file fails "no longer in
   the folder". Then `writeInPlace` (createWritable, write, close, abort on
   error): never a Save picker, never a download. A file that will not take
   the write is named; the others are written. A member with no `d`, or a
   lone file, still goes through `writeText`.

   The toast says first what went wrong (a conflict, a file that would not
   take the write, names not reviewed), then the documents written, in the
   folder's order and six by name at most (`inFolderOrder`, `nameList`): a
   warning after forty names was a warning nobody saw.
8. The bookkeeping: a written member's `base` becomes what was written and
   its dirty flag clears only where its `editSeq` is unchanged (typing during
   the save stays unsaved); a member the forward pass changed and the save
   did not then write (the assertion, the grant, Esc, the key, a conflict, a
   failed write) is marked unsaved as the save ends (`saveTouched`), since its
   pages now say what its file does not — left clean, its names stood on the
   page as pseudonyms, counted nowhere, and the next save, finding nothing
   left to swap, passed it by; a written store entry leaves the store only where
   its `seq` is unchanged; its spots are stored under its own name; its page
   lists follow the file (`TD.pageListsAfter`, `TD.fixedSumsFor`); its find
   and ready caches go; a journal record whose document was written with the
   text the replace left (or a save of it wrote before) learns
   `writtenText`, and one written with other text — edited on top of the
   replace and saved — learns `savedOther`. After anything off screen, the
   sweep and `caseFakes` are dropped, and the find scan starts again.
9. The decision files, then a Master Keep removal still owed.

`saveOnTheWayOut` (the walks) calls `saveDocument({ offscreen: false })`:
the reel and the decision files, as it always did, nothing off screen in the
middle of a walk — but in folder mode all the same, so a member with `d` is
checked against the disk and written in place. It first came as `{ folder:
false }`, which turned folder mode off with the off-screen pass: the walk's
save then went through `writeText`, so a document brought back from the store
tagged "changed on disk" was written over the file PDF-Linker had rewritten
(the banner had just said Save would not), and a file that would not take the
write went to a Save picker or a download while the save said it was saved
and the document left the count. A conflict or a failed write now holds the
walk on the document, its toast in front of the save's own
(`test-folder-save.mjs` case 15).

### Decisions

- **Flags, phrases, keeps and page lists** were already remembered per
  folder and written by Save into `New Real Values.txt`; they now also count
  in the closing prompt and the shell's `__textReaderHasUnsaved`.
- **The last flag withdrawn reaches the file.** `valuesDirty` returned false
  once every list was empty, and `saveValuesFile` refused, so PDF-Linker went
  on applying a flag nobody wanted. Now the list is owed where it differs
  from what was last written and either holds lines or the last write did
  (`TD.readerFileHasLines`); with everything withdrawn, the header-only file
  is written where the disk still has lines, and the list is simply marked in
  step where it has none. PDF-Linker reads a file of `#` lines as empty
  (`_pn_reader_value_lines`), so no change there.
- **"Fake it" is kept for the case** (`textReader.settled.<folder>`, read
  back when the folder is adopted; `setKey` and `forgetFolder` clear only the
  set in hand). Save writes the name in every document of the folder where it
  stands, and the status bar counts where it still does
  (`settledElsewhere`, off the sweep's rows). LEAKS `yes`/`phrase` answers
  count the same way (`sheetFakes`, part of `isSettled`). Kept for the case,
  a mistaken one no longer goes away with the tab, so it can be withdrawn:
  the Flagged panel lists the case's decisions as they were spelled
  (`settledShown`, `renderSettled`), each with a × (`unsettleName`) that takes
  it out of the set and the store. What a save wrote stays written; where the
  name still stands in the clear it is the review's again. Stored under the
  folder's name, as the flags, the spot keeps and the LEAKS answers are, so
  folders of one name share them as they share those.
- **A Master Keep removal the workbook refused** (Excel holding it, the grant
  not given) is owed (`masterPending`), counted, and tried again by the next
  save where the workbook's grant is already in place. A removal from a loose
  copy still holds for the session only: the reader cannot write that file.
- **A Master Keep removal takes the value off the reader's own keeps too**:
  every case list it remembers at once (stored per folder, like the flags), and
  the open folder's `New Real Values.txt` through this Save — the line it still
  carries is recorded as handed over (`TD.noteKeepLines`), so the list without
  it is owed, counted in the status bar and the closing prompt as any change
  to the list is, and written by Save (header only where nothing is left).
  Another case folder's file is no Save's here: where the reader holds that
  folder and may write it, its keep lines on the value come out at once, with
  the master workbook, which is written at once too (`takeKeepLinesOut`);
  where it cannot, the confirm and the toast name the folder for the operator
  to open and save there, and that folder's file reads as owed when it is
  (its keeps recorded as withdrawn). A keep PDF-Linker has SPENT (its line
  written into this very folder and since taken out of the file) is not a
  decision owed: `saveValuesFile` reads the file first and retires it
  (`spendFromDisk`), and where that leaves nothing to write it answers
  `"spent"` and the save's toast says no "written too"; a spent keep the
  attached master does not hold is named there, in red — on the Flagged
  panel's own Save as well. A list the Flagged panel saved through the picker
  or a download (the folder refusing the write) is no longer marked written
  while a folder is open: the folder's own file is still owed it, so the
  status bar goes on counting it and the closing tab asks — unless the
  picker was pointed at that very file. See "A keep PDF-Linker has spent" and
  "Only what was written HERE is spent here" in
  `Design Notes/Text reader.md`.
- `owedNow()` is what `#st-dirty`, its tooltip and the Save button read: the
  unsaved documents, the decision files, the decided names here and
  elsewhere, a Master Keep removal, and the conflicts. `hasUnsaved()` (the
  closing prompt, with `standingInTheClear()`, and the shell's
  `__textReaderHasUnsaved`) asks the same things.

### The journal and the marker

A folder replace is one step of the history wherever its documents go:
`replaceJournal` holds `{ id, q, withText, folder, state, docs: [{ name, d,
base, beforeDoc, beforeText, beforeSpots, afterDoc, afterText, afterSpots,
writtenText, writtenSpots, savedOther, dropped }] }`, at most three records and about 32 MB of
text (`trimJournal`; a record dropped takes its markers off the history).
`clearHistory` keeps the markers when another document opens, and
`stepHistory` hands the marker to `revertFolderReplace(id, dir, { skip })`
after putting back the pages it holds itself. Each document is found where it
now is, and changed only where it still reads as the replace left it
(`writtenText ?? afterText` for undo, `beforeText` for redo): in the store,
its entry set to the other side (and deleted where that is its file's text);
on the reel, its member's pages rebuilt (`putMemberBack`); saved since and in
neither place, re-stored with its old text and `base = writtenText`, so Save's
content check writes it only where the disk still reads exactly what this
reader wrote; in neither place because its edits were dropped (`dropped`, set
by `journalDropped` from `dropUnsaved`, `dropAllUnsaved` and
`takeDiskVersion`), nothing to do; redone after its entry was let go of,
re-stored on its old `base`. Anything else is left and named — above all a
document saved with more edits on top of the replace (`savedOther`), whose
file still carries the replace: an undo used to take "in neither place, never
written" for "its edits were dropped", count it done, and say "Put back 3
documents" while its file still read "automobile" (`test-folder-save.mjs`
case 18). The replace row's note then says what became of the replace ("Put
back: 2 documents (unsaved); left as it is: …"), not the counts of a replace
that has come back. `↶ Undo replace in folder` (`#fb-undo-folder`) does the
same from the replace row for the newest record of this folder, and takes its
steps off both stacks (no redo).

**Ctrl+Z does not take a replace back unseen.** The marker outlives the
document the replace was made in, so a Ctrl+Z pressed in another document —
one the replace never touched, protected, with no steps of its own — reached
it: every document of the replace went back, saved ones included, nothing on
the page moved, nothing was said, and the next Ctrl+S wrote the old text back
into all of them. Now `stepHistory` asks first (`askFolderStep`, the ↶
button's question) where none of the replace's documents is on screen to be
seen changing (no page of the step live, no member of the record live on the
reel) or one of them has been written since; and it always says what it put
back, and that Ctrl+Y does it again. And the keydown handler leaves a field's
own undo alone: Ctrl+Z in the Replace-with box (or any text field, or an
editable outside the pages) is the box's — it used to be `preventDefault`ed
and take back the whole folder replace instead (`test-folder-save.mjs` case
21). A checkbox or button just clicked is no field: the key there is still
the reader's.

Shedding a member no longer drops its undo steps: a step for a shed page is
put back into `doc.pages` and the member's spots (`restoreSnapshot` with no
body), and the page is built from there when the reading comes near again.
Dropping them made a Replace all across several members, saved and read
away from, come back only in part on Ctrl+Z, and say nothing.

### Conflicts: there is no "write over it"

A document whose file changed after its edits began is never written over:
the save names it and keeps it unsaved, opening it shows the banner, and the
only way forward is the operator's own (keep editing and copy across, or take
the disk's version). The likeliest writer is PDF-Linker itself, and its run
may have faked names the operator's older text still carries in the clear;
writing over it would put them back. A sync client rewriting identical bytes
is not a conflict: the check is the content, not the timestamp.

### Restored margin numbers are written

A document Save writes off screen is read through `readExport`, like an
opened one, so the margin numbers the OCR missed go into the file with it,
as opening and saving always did (and the `✎ Use my text` sums are taken
of the text as written). The alternative, parsing without restoring for a
smaller diff, would write the same document two ways depending on whether
it was on screen.

### What is never done

- The bar never writes a file; nothing but Save writes an export.
- A reel member is never edited or written off screen (`onReel`, by `m.d`).
- `Combined Text.txt` is never edited by the folder replace or by Save's pass
  for decided names; it is counted apart, and the save's toast says it is
  behind the exports until PDF-Linker's next run.
- A document is never written in folder mode without passing the standing
  assertion, the content check, and through its own handle — the walks' save
  on the way out of a document included.
- The reel's ceilings (`reelRoom`, `REEL_MAX_PAGES`) and `reelCanRenumber`
  are unchanged: the folder is never hung whole to reach it.
- A lone file keeps today's Replace all, discard prompt and Save exactly.
- Not built: carrying a stored document's own undo history (history already
  ends at every switch), keeping the journal across reloads, and the optional
  crash store (an IndexedDB `textReader.unsaved` keeping the store across a
  crash); the store is in memory, and the closing prompt guards it.

### The experiments

- At 40b530a, the harness folder (A, B hung; C, D off screen): Replace all
  wrote only A and B on save, C kept all three hits, and the bar read "1 of 3
  here · 4 in 2 other documents" — seven for six, because `findRest`
  counted the hung member twice.
- Shadow replace against "open it on its own, Replace all, Save": identical
  bytes for vehicle → automobile, vehicle → "" (an emptied numbered line),
  vehicle → a real name (marked, written as its fake), Ashdale →
  Ashdale-Brook (one hit left inside a longer name), and Show fakes on; the
  undo stack untouched. `test-folder-save.mjs` case 3 pins these, Match case,
  the pleading-page fixture (missing margin number, a line of only the
  query, a wrapped name) and a decided name with a spot keep after it: the
  file, its stored spot keeps and `New Real Values.txt` byte for byte.
- Save's per-page pass on shadow pages matched "open it, Ctrl+S" with a
  decided name, an undecided one and a citation.
- A bug found on the way, on screen at 40b530a: a spot keep after
  occurrences the forward pass fakes kept an ordinal (`nth`) counted before
  the pass, which then pointed past the end; the rebuild dropped the kept
  span, the name stood as decided, and the save refused the file. Fixed by
  `TD.spotsAfterSwaps`; a folder save would have hit it in every document of
  that shape, and one refusal writes nothing.
- The reader never writes `pseudonym_key.xlsx`; there are no key edits to
  save.
- After the change, the same harness folder: the bar read "1 of 3 here · 3 in
  1 other document", the confirm named A and B on screen and C off it, and
  Save wrote A, B and C with D untouched. With every document hung on the
  reel, Replace all asked nothing (nothing off screen) and › stayed off, where
  it used to walk into a document already hung.

### Not chosen

- **Stretching the reel to hold every document:** the ceilings exist because
  a fuller reel took the tab down (`Design Notes/The reel.md`,
  `Design Notes/Text reader hangs and freezes.md`), and batching would lose
  undo at every re-open.
- **Writing at Replace all:** one action would leave documents in two commit
  states, some written and some not.
- **Staging the documents' pages in `doc.pages`:** touches too much of the
  reel's index space.
- **A text-only replace engine:** `findRealsInPlain` runs per text node, so
  the result depends on how the DOM is split; the shadow pages run the very
  code the screen runs.
- **"Write over it" on a conflict:** could undo PDF-Linker's scrubbing.
- **Editing `Combined Text.txt`:** a second, divergent write of the same text.
