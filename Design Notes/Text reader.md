## The text reader (`viewer/text-reader.html`)

A second page in the same extension and the same PWA: PDF-Linker's scrubbed
`.txt` exports, read like a document. `text-reader.js` is wiring over three
pure, Node-tested modules — `textdoc.js` (the export as pages by its
`====== Page N ======` headers, byte-exact round trip; the DOM walk that
serializes a pseudonym span as its FAKE; the `New Real Values.txt` list),
`pseudo-key.js` (a port of the Claude extension's `src/pseudo.js`: parseKey
by header name, keeps dropped, control words held as instructions, pinned tab
out of the reversal, ambiguous fake retired, a fake that is an ordinary word
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
toggle reads the folder again. Find looks for the query as typed in the
text as the screen shows it, never for the key's other face of it: the page
is read off the DOM, and the folder scan reads each other export through
`findTextOf`, which gives the file as it is with Show fakes on and
`PK.translate(rev, …)` of it (the run `buildBody` lays out) with it off. So
a real name with Show fakes on is hit only where it stands unfaked, and a
pseudonym with it off only where the key leaves it standing (an ambiguous
fake). The translated texts are kept in `findShown` per file handle, by
`fileKeyOf` stamp, and dropped when `rev` or `folderDocs` changes: a pass of
the key costs about 200 ms a megabyte under a 3,000-name key, and the folder
is asked again at each word typed. `findScanFor.fakes` carries the view, and
a scan whose question went stale while it ran (`findScanStale`, the view or
the key turned) starts again rather than keeping counts that would walk into
documents with no hit on screen.

**A typed real name, and only a typed one** (`convertTypedReals`): the
debounced converter marks a real name standing in a page's plain text as a
pseudonym only where an edit wrote it. `buildBody` keeps the text the page
was built from as `body.__built` (the round trip is exact, so it is also the
page's disk text until something is typed), and a save sets it to what it
wrote. `textdoc.typedReals` reads the page now with `serializeMapped` (the
disk text, and each text node's offset in it) and keeps a hit only where
`editedSpans(__built, now)` puts something of the edit in it (`spanEdited`:
text put in that overlaps it, or text taken out of its middle) and it stands
outside every `citedNameSpans`. `editedSpans` trims the common head and tail,
then runs Myers line by line and again character by character inside the
changed lines, so an Enter on pleading paper (the numbers stay, the text moves
a slot) writes only the break and the numbers. Past `maxD` the changed region
counts as written whole. It used to mark every real name in the page on any
edit, a missed name and a cited party with it. The Space prompt (`offerAtCaret`,
`acceptTyped`) still marks the name the caret has just finished, before the
citation it may open has been typed; so the converter also asks
`typedPseudonymsCited` (`serializeMapped` gives each pseudonym span's offset
as `pn`) for the marks an edit made that now stand in a cited name, and puts
each back as the name typed (`dataset.real`), one undo step, with a toast. The
same catches a short form the converter marked in a pause before "supra". A
mark the page was built with is never one of them, so an undo that restores
one leaves it.

**A name wrapped inside a column** (`pseudo-key.columnHits`): a caption sets
the parties in a column beside the case number, and the export writes each
line whole — "…; and QUARRY", the blank, ")  Case No.: 25STCV59720" — with
"OPALRIDGE DOVEWOOD CASCADIA, an" on the next line. The value's gap (a run of
blank, a line break, the next gutter number) cannot cross the other column, so
the halves were two words no row binds: a fake stood on screen as itself, and a
REAL name wrapped that way was neither marked nor faked by the save. Every
reading now goes through one scan, `hitsFrom`, which can also read each line in
cells (`rawCells`, `pageCells`): cut at a caption's ")" standing in a blank or a
box's bar, at three spaces or more, or at two where a line beside it has a
column starting at the same place (so two spaces after a full stop are not a
column). A cell with another cell beside it is read on into the cell under it:
the next line with text (up to CELL_BLANKS blank lines passed over), its first
cell in the same drawn column (`col`, the marks before it) that starts no more
than CELL_SLACK further in, measured from its mark (`rel`). Following the mark
rather than the character position matters because a name swapped earlier on a
line moves the ")" with it. Only the last `mostWords - 1` words of the first
cell are read, since nothing earlier can cross, and a seam whose cell ends or
starts in a blanked stretch (a fake, a keep) is not crossed. A column name takes
its words from whatever the plain pass made of them (a surname token): the
plain hits it touches are dropped (`touchesPieces`), and two column names that
share a word keep the earlier. It comes out as a range per cell (`ranges`, and
`start`/`end` spanning the other column between them), and the column names are
memoised per text (`columnNames`) so the marks' handfuls read them once.

The cells are read off a LAYOUT, the text as it stands in the file, because
the readings that find real names blank the fakes and spot keeps to spaces
(`diskReading`), and a blanked fake would otherwise look like a wide gap and
cut a false column. The display (`translateRuns`, `translate`) uses its own
text. The save's forward pass (`forwardSwaps`, `forwardRuns(..., { layout })`),
`standingSpans`, the save's final check (`findReals` against the export about
to be written), the folder sweep (`textdoc.clearReading`, `mask(flat, raw)`),
the ⇄ Raw marks (`fillRaw`) and `maskKept` (a kept value wrapped down a column
is masked piece by piece, `findColumnSpans`) all pass the unblanked text. The
orange marks (`scanPassNow`) now read the DISK text exactly as `standingSpans`
does, through `serializeHeld(body, { mapped: true })`, whose `segs` map each
hit's pieces back to the page's text nodes. Read off the screen instead, a real
name painted over a fake moves the rest of its line, and the save would find a
column name the marks did not. Each leak hit carries `pieces`
(`piecesOf`): the highlight, `leakAt`/`leakIn` (right-click, selection), the
walk's current stop (`leakHerePieces`) and keep-here (`keepRangeHere` takes a
list) use the pieces, so the other column's words are never marked or kept.
The screenshot reads the disk text the same way. `forwardText` counts names,
not pieces. Because another column's names can sit between the pieces of one
name, `keyTerms` collects later pieces by name, not by the previous span, and
`wrappedPieces` passes over other spans. Cost: about 6 ms on 567 KB of prose
under a 3,000-name key for the display, and a few ms for the leak reading,
because a line with no wide blank or bar past its gutter is one cell
(`MAY_CUT_RE`) and is never cut. Not read in columns: the LEAKS worksheet's row
marks (`leakMatches`), the flagged values' red marks, and the redaction sweep
over a PDF's text layer, whose text has no column gaps to read.

**Flagging a name the run half faked**: a selection with a pseudonym in it
was refused outright (`flagProblem`'s second argument was "touches a
pseudonym"), and one with an orange leak in it had the flag button disabled,
so "Rosa Delgado" with "Delgado" faked or leaking could not be flagged at all.
`currentSelection` now answers `allFaked` (the selection less its `.pn` and
`.gutter` clones has no letter or digit; a selection inside one pseudonym's
text node clones no span, so it is read off `startPn`/`endPn`) and `text` as
`realTextOf` (each pseudonym as its real name, gutters out, lines joined), so
the flag is the real name. `flagProblem` refuses only `allFaked`; a leak
refuses only where the selection is the leak's own words (`sameWords`), in
the pop-up and in `flagSelection`. The value's red mark is read by
`flagReading` — the page with each `.pn` as `dataset.real` (whichever way
Show fakes sits; no `segs` inside a pseudonym) and `held` the pseudonyms',
spot keeps' and gutters' places — and drawn over `textdoc.clearPieces` only:
the match less what is held, trimmed, with a letter or digit, so "Rosa" is
marked and "Delgado" is not, and a match wholly inside a pseudonym is neither
marked nor counted, as before. The folder sweep (`clearReading`) counts flags
the same way, off the text with each fake translated to its real name and
spot keeps mapped into it. `flagSelection` tells the operator such a flag
takes a full re-run (`s.touches` or `phraseFakedInFile`), as `markPhrase`
does.

**A fake that is an ordinary word** (`parseKey`'s `wordFakes`,
`PK.wordFakesOf`, `PK.compile`): an older PDF-Linker's nickname rule cut a
surname's stand-in to "We" (the front of a longer name's fake, six letters
off) and the key bound it, so the reversal painted the surname over every
"we" of the case — case-insensitive and whole-word, which is right for a
stand-in and wrong for a word. Nothing in an export records where the run
wrote a stand-in, so the reader cannot tell the run's "We" from the word:
such a pair (its fake `isCommonReal`, whose list now carries the pronouns
and the rest of the two-letter words) is retired from the display like an
ambiguous one, and `compile` drops it too, for a key parsed and kept in the
library before the rule. The forward direction (`warn`, `compileForward`)
keeps it, so a real name typed is still written as the key says, and a
composed fake carrying the word ("Delacroix We") still reverses whole,
longest first. `setKey` says so in the status bar and a toast naming the
pairs, pointing at a full PDF-Linker run, which drops such rows on load
(PDF-Linker's `_pn_key_word_stand_ins`) and no longer draws them
(`_nick_front`, `fold_onto`).

**A control word in the key's Replacement cell** (`PK.keyCellKind`,
`parseKey`'s `control` and `dropped.controls`): the key's Replacement column
takes the LEAKS Fix? column's control words, and PDF-Linker's own notes tell
the operator to answer a leak there — "~" and the canonical spelling typed
over a misspelling's stand-in. `--fix-leaks` refuses a control typed in the
key, so the cell stands until a full run. `isKeepCell` knew "no", "never" and
a cell wholly bracketed or braced; every other control was read as the row's
PSEUDONYM. A save then wrote "~Rasho" for the real "Rashoe" — the canonical
real name, in the export, inside a `.pn` span that the marks and the save's
last check blank — and counted it "written as pseudonym"; "*Rasho" over a scan
error wrote the corrected real spelling, "(Cross River Bank)" the phrase, and
"n", "phrase" and "#NAME?" wrote rubbish, while on screen every "phrase" in
the case read as a party. Every cell is now read as PDF-Linker reads it back
for the reader's own text (`_pn_key_reverse_pairs`, whose `control()` is the
twin of `keyCellKind`) and applies it (`_pn_load_key`). A whole-value keep —
"no"/"n"/"never", or a keep-spec whose kept parts are the whole value
(`_pn_bracket_keep` → []) — is dropped as before. Any other instruction —
"yes"/"y", "phrase", a cell opening with ~ * = #, one wrapped whole in ( ),
[ ] or { }, and any cell carrying a [kept] or {kept} part (a keep-spec of PART
of the value, which PDF-Linker reads as keep-that, fake-the-rest; the old rule
dropped "[Law]" on "Alder Law, P.C." whole) — keeps its row in `warn` with
`fake: ""` and the cell as `control`: marked where it stands, refused by a
save that would write it, and out of the pairs, `compileFakes`, the forward
map and the typeahead. The kept parts are cut out of the value [bracketed]
first and {braced} after, as `_pn_keep_spec_parts` hands them over, so a
value holding one part's text twice ("{Law} [Law Firm]" on "Law Firm Law")
is a keep of the whole here as it is there. Never "~V forwarded to V's fake":
PDF-Linker gives a misspelling a SLIP of the canonical's fake, and two Real
Values on one Replacement cannot be reversed; the reader has no slip to give,
so the value waits for the run. A keep-spec naming text the value does not
hold is a literal replacement to `_pn_load_key` (with a warning that it was
surely not meant); the reader writes nothing for it, the text around a
mistyped bracket being usually the real value copied in. One sheet holding
both an instruction and a fake for one value: the instruction stands (applied
still beats pinned). Three things follow:

- Nothing writes the instruction's real through its own shorter words.
  `compileForward` MATCHES it and maps it to nothing: left out, "Helen" bound
  to "Ingrid" and "~Helen Rasho" over "Helen Rashoe" made the save (and the
  typed converter, `findRealsInPlain`) write "Ingrid Rashoe", a half-scrubbed
  name with nothing left to mark it. Matched longest first, the name is
  skipped whole, the same protection a keep has from `maskKept`;
  `compileTypeahead` counts it as a longer value too, so the space bar does
  not swap "Helen" on the way to typing it. That does not reach a name
  wrapped down a caption's COLUMN, for which no column hit is made with no
  fake to make it with, so `saveDocument` spares every standing name with no
  fake, settled or not: a LEAKS `yes` on "Jonathan Avery Smith Walker",
  wrapped "…and Jonathan" / "Avery Smith Walker, an" and holding an
  instruction, with "Walker" bound on its own, was saved as "Jonathan / Avery
  Smith Cascadia" and called done, the full name being gone from the text
  that the last check reads. Spared, it stands whole and the save refuses it
  (checked in Chromium, both ways).
- A key kept in the library from before is read the same way (`pairRows`,
  `warnRows`, and `wordFakesOf`, which had listed "n" and "yes" as fakes that
  are ordinary words): its instructions sit in its pairs and warning rows as
  fakes, and the compilers classify each row again. A key this parseKey made
  carries `dropped.controls` and is taken as it stands, so the compiles cost
  what they did (4,000 rows, every compiler ten times, three runs each:
  780–870 ms before, 760–860 ms after; an older key classified again on
  every compile, 810–950 ms), and `keyCellKind` answers a cell with no
  leading mark and no bracket of any kind with one test.
- The operator is told. A settled value with no fake is refused by the save's
  last check (`saveDocument`), and the refusal — and the `stuck` warning, should
  that ever be reached — adds `instructionNote`: the key holds no pseudonym for
  it, only "~Rasho", an instruction to PDF-Linker that only a full run (not
  Apply Fixes) carries out; until then retype it, or keep it where it stands
  (right-click: Keep just this one). The spot keep is named because it is the
  narrowest way through: the first draft said "keep it", which reads as "Keep
  in this case", and that keep stops the marks and the refusal for the value
  in every export of the folder, for a value the operator had said to fake.
  The names bar (whose **Fake it** was already disabled for a hit with no
  fake) and the right-click menu say what the key holds (`keyInstruction`)
  instead of "fake it writes its pseudonym".

Measured: a sentence carrying one value of each kind was saved as "~Rasho
and *Rasho met #Name? at (Cross River Bank); N and Phrase of Alder {Law}
agreed." and the save's last check found nothing in it; now nothing is
written for any of them and each but the `n` keep is marked
(test-pseudo-key.mjs, "control words in the Replacement cell"). Where the two
still differ it is PDF-Linker's to close. `_pn_key_reverse_pairs` does not
read "n" or "y" as a control (`_pn_load_key` reads "n" as `no`, and has no
branch for "y" or "yes"), nor a cell carrying a keep-spec beside other text
("Alder {Law}"). The second is harmless — such a cell stands in no text the
reader writes. The first is not: with "n" typed over a row's stand-in, the
transcription a ✎ Use my text line hands it is read back with every
standalone "n" turned into that row's real value, a "(n)" subdivision
included, in the PDF's own text layer. The reader cannot mend that from its
side; reading "n" as a pseudonym again would only put the same word on
screen.

**Taking a value off the Master Keep** (`withdrawMaster`): a value the master
workbook (`Master Leaks.xlsx`, its KEEP sheet) keeps is left alone in every
case, so the reader does not mark it, the walk does not stop on it and the save
does not fake it. It can be withdrawn from the reader three ways: the × beside
it in the Flagged panel's list of values held against the key (`renderMaster`),
**Remove from Master Keep** in the selection pop-up when the selection stands
in one (`masterHeldIn`: a pseudonym whose real value it keeps, or a kept value
the key binds whose occurrence overlaps the selection), and **Remove from the
Master Keep** in the right-click menu over one. After a `confirm` (it is a
decision about every case; write access is asked for first, while the click is
fresh), the value leaves `masterKeeps` and the key is compiled again, so where
it stands in the clear it is marked and can be faked. The workbook is then
written where the reader can (`masterWritable`, `writeMasterWithdrawn`): the
file is read again as it is now, `leaks.masterWithdrawEdits` empties the Fix?
cell of each KEEP row that keeps the value whole, and `XW.writeSheetCells`
writes just those cells into the original zip. The result is read back, and
written only if every other keep is unchanged. The row and its history stay,
because removing a row would shift every row below it and the ranges
PDF-Linker hangs on the sheet. An empty Fix? is no decision, so PDF-Linker's
next run no longer keeps the value either. A workbook opened as a copy (the
file input, `masterInfo.loose`), a refused permission or a failed write leaves
the value off for this session only, and the toast says so. The list is drawn
again whenever a marks pass changes which kept values stand on the page
(`keptSeen`); it used to wait for the next `renderFlags`.

**The master workbook, attached once** (`adoptMaster`, `restoreMaster`,
`offerMasterRenew`, `renewMaster`, `refreshMaster`): the workbook stands in one
place (beside `pdf_linker.config`), so it is chosen once — **Load master
workbook…** or a drop that carries the file's handle — and its handle is kept
in IndexedDB (`rememberFile`, the `files` store, key `master`). The setup asks
for write access as well as read while the click is fresh (`askMasterWrite`),
so a later withdrawal writes the file without a prompt; where the browser will
not ask then, `masterWritable` asks at the withdrawal as before. At startup
`restoreMaster` reads the file with nothing asked where read access stands —
Chrome 122+ keeps it for an installed app, and in a tab once "Allow on every
visit" has been chosen. Where it does not, the renewal is offered in the bar at
the top (`showKeyOffer`, marked `data-master` so that a renewal from the panel
takes it down and another offer is never covered) as well as by the panel's
**Allow** button, and asks for `readwrite` in one question; refused the write,
the file is still read where reading was allowed. A remembered file that is
gone or unreadable is said in a toast (`masterUnread`), not left in the
console. PDF-Linker writes the workbook too, so on `focus` and on becoming
visible `refreshMaster` compares the file's `lastModified` with
`masterInfo.modified` and reads it again only where it changed (a stat, no
read, no prompt). A value taken off for this session only (`masterOffHere`) is
held off through those re-reads, and a fresh choice of the workbook clears it.
The extension's reader and the installed app are different origins, so each is
set up once on its own.

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
A page stripped while it shows its text (not side by side, not ⇄ Raw, with a
PDF page matched) is then shown as its PDF page (`setPageSwap`, the ⇄ PDF
swap, remembered with the rest), and the undo step carries it as `view`
(`{ key, on }`, the swap the step left): `stepHistory` turns the swap back
with the text, taking it off BEFORE `restoreSnapshot` (the body must be on
screen to take the caret) and putting it on after, and carries `view` to the
other stack. `putStrippedBack` takes off a swap its strip's step made and
tags its own step the other way, so Ctrl+Z on the put-back shows the PDF
page again. Without that, an undo restored the text under the PDF page, and
the press looked like it did nothing — the complaint that started it, the
other way round.
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
(`ocrPageAgain`), red (`.stripped`) so a page with no text stands out,
whoever stripped it; asked (`.on`, below) it takes the accent instead. Where the header is not PDF-Linker's DID NOT OCR one and the
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

**The Pages tab** (`#side-pages`, `renderPagesTab`) lists every page of
`doc.pages` the way the PDF viewer's Pages panel lists a PDF's: a row per page
with a header or with text before the first one, each a picture of the page
(`.pr-thumb`) with its label and a tag under it read off the page lists
(`setPageRowTag`: `readsDidNotOcr(p.lines)`, `ocrAgain`, `textFixed`), and a
`.pages-doc` heading per reel member (`reelIndexOf`) and per combined-file
banner. Rows are keyed by the page OBJECT (`pagesRowOf`, `pagesPicked`), never
the index, since `reelShift` renumbers every page below a document hung above;
`pagesShape` is the list of objects the rows were built for, so the same pages
update in place and a changed list (another document, a reel member added) is
built again.

The pictures are drawn only as a row comes within 400px of the tab's view
(`pagesThumbObserver`, rooted on the tab; `pagesVisible`). A page with a PDF
matched (`pdfTarget`) is pictured as that PDF page (`fillPageThumb`): drawn by
`pumpPageThumbs` one at a time, the rows on screen first, through
`drawPdfThumb` — `loadPdf`, then a `later` job at the back of `pdfJobs`, so a
page on the stage is always drawn first — at `PAGES_THUMB_PX` (400) wide on a
`fontCanvas` (`renderPdfThumb`), read back as a JPEG and kept as an object URL
by PDF page (`pagesThumbs`, at most `PAGES_THUMB_HELD`, the longest unshown
revoked first and never one a row in view shows; `letGoOfPageThumbs`). The
page is handed back to pdf.js once pictured (`page.cleanup()`, unless
`pageIsDrawn`; a refusal joins `pagesToRelease`), since a scan decodes at its
scanned resolution whatever it is drawn at, and `pagesThumbBusy` is in
`pdfsInUse`'s must-keep set while its picture is drawn. A page with no PDF, or
whose PDF page could not be drawn (`pagesThumbFailed`, cleared by
`pageThumbsMoved` from `refreshPdf`), is pictured as its text
(`drawTextThumb`): `pageLinesShown`, the body's `.line`s as the screen shows
them (gutter dropped, so in real names where Show fakes is off; a page the reel
has shed reads its lines through `PK.translate(rev, …)`), drawn small on a
white sheet, redrawn only where its lines changed (`li.__text`) and let go of
as the row leaves the view (`dropTextThumb`). `forgetPdfs` revokes every
picture (`forgetPageThumbs`). A picture is pixels, so no fake reaches into it:
`fakesForShot` sets `body.shot-taking` and the stylesheet blurs them for the
screenshot.

The list is drawn only while it is in sight (`pagesTabShown`):
`afterTextChange`, `renderFlags` and `refreshPdf` call `pagesTabSoon`, which
marks it stale and, in sight, redraws it a beat later; `showSideTab` and
`showSidePanel` draw a stale one. The stage's scroll marks the row of
`readingPage()` (`.here`, `markPagesHere`) and keeps it in sight under the
sticky bar, except during a drag. A click goes to the page
(`goToPageFromList`, `scrollRangeTo` with a `margin` of 8 rather than the
reading third). Ticks are made as a list's rows are selected: a drag
(`pagesDrag`, from the row pressed) becomes one once the pointer is over
another row, or 8px out and held at the edge (`pagesDragRead`), and from there
`pagesDragRun` ticks every page from the one it began on to the one under the
pointer (`pagesRowAtY`, a gap read as the nearer row), putting back as they
were (`base`) the pages the run lets go of; held within `PAGES_EDGE` of the
list's top (under its sticky bar) or foot it scrolls the list
(`pagesDragTick`, faster the further out), and a scroll of the list from the
wheel reads the run again (`pagesDragFollow`). A plain drag starts a new set
of ticks, Ctrl/⌘ adds the run (or takes it off, from a ticked page); the click
that ends a drag is swallowed (`pagesDragged`, and a page's box it began and
ended on is not turned). Shift+click (a run from `pagesAnchor`), Ctrl/⌘+click
and the box tick as before. There is no tick-everything: the operator asked
for it to go, a document that did not OCR from end to end being one not to run
at all; **Clear** (`clearPagesPicked`) unticks. **⊘ Did not OCR** on the bar is
`markDidNotOcrPages`, `markDidNotOcr` for several pages: the pages built back
(`ensurePageLive`), one `snapshotPages` batch with every snapshot tagged
`nocr` (so `strippedTextOf` still finds each page's text for ↻ OCR This Page),
`ocrAgain` and `textFixed` withdrawn, each body built from `didNotOcrLines`,
one `syncNoOcr` and one `afterTextChange`, and every page turned to its PDF
page in one `setPageSwaps` with each step's `view` set. One page goes through
`markDidNotOcr` itself. `stepHistory` turns a batch's views in two passes
(off before the restores, on after) and asks `restoreSnapshot` to leave the
page lists (`lists: false`) for one `syncNoOcr` over the batch: page by page,
an undo of 153 stripped pages re-rendered the Flagged lists 153 times and
took six seconds; batched, under one.

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

**Margin numbers the OCR missed** are put back as the export is read:
`readExport` (every parse site: `openText`, the reel's `reelExtend` and
`reelPrepend`, `buildAheadNow`) runs `textdoc.restoreMarginNumbers` on each
page with a header, to `pleadingLast` — the highest last number that two or
more well-numbered pages reach (the OCR loses numbers at a page's foot and
never adds one past it; two, so one number misread high is not it). The
paper's own numbers are `numberChain`'s: the longest run climbing down the
page, ties going to the run whose numbers step with the lines, so a number
read out of its order (17 as 11) is a misreading. A page is touched only with
`RESTORE_MIN` (8) numbers in the chain and half of the numbers it should
carry (`RESTORE_SHARE`), and a number goes back only where it cannot be
anything else: between two chain numbers, one per line where the lines
between are exactly as many as the numbers missing (blank → bare number;
`misreadNumber` reads `l2`, `I7`, `2O` and is replaced only where it reads as
the number given); with no line between, bare lines, at most `RESTORE_BARE`
(4); with more lines than numbers (a caption's single-spaced lines), only
where exactly that many open with a misread number; above the first and below
the last (to `pleadingLast`), the run of lines against it and then the blank
lines beyond, never past text standing apart (a stamp, the footer). An
unnumbered line's four leading spaces are the number's place (`numberedAs`).
The Authorities trailer is never a page's. The page keeps the numbers put back
(`p.restored`); `buildPages` hands them to its body (`body.__restored`) and
`buildBody` marks those gutters `.restored` (italic, with a title). The file
is untouched and the document not dirty: a save writes the numbers, and
clears the marks of every member it wrote. One exception: a page handed over
by ✎ Use my text carries the sum of its text WITH the numbers, so
`saveDocument` writes the member of any such restored page (`touched`)
whether or not it was edited — otherwise a save that wrote only the values
file left the sum naming text that was never on disk, and PDF-Linker would
never apply it.

**The numbered margin is not text** (`.page-body.numbered .gutter` is
`user-select: none`): a selection across numbered lines paints the text only,
and Chrome leaves `user-select: none` content out of the clipboard, so a copy
is the passage without a number on a line of its own between every two (it
was `user-select: text` explicitly before; `getSelection().toString()` still
reads them, which only `realTextOf` and the like see, and those drop
`.gutter` themselves). Unselectable, a press on a number began no selection,
and a drag from the margin took nothing, so `pagesEl`'s `mousedown` on a
numbered gutter is the reader's: the selection starts at its line's `.lt`
(offset 0), Shift extends the one there was, a double click takes the line's
text, and the drag follows the pointer with `textPointAt` (`caretRangeFromPoint`,
a point in a `.gutter` or beside a line's text read as that text's near edge),
`x` held inside the sheet the drag began on so the margin and the grey beside
the sheet are whole lines, the stage scrolled within `MARGIN_EDGE` of its top
or foot and on the wheel. In Edit mode the body is focused first, so a click on
a number puts the caret at the start of its line's text.

The LEAKS review bar works PDF-Linker's `LEAKS.xlsx` row by row from the
text: `leaks.js` (pure) reads the worksheet by header name, classifies a
Fix? cell the way `_pn_parse_decision_rows` will read it, parses the Where
and File cells, and matches a File name to its export (the reverse of
`pdfsync.matchPdf`); `text-reader.js` shows the current row in a bar above
the stage (it takes its own height through `--bar-h`), opens the row's
document, scrolls to its page and gutter line and marks the value
(`::highlight(leakrow)`), mirrors a `no`/`never` on a bound value as a
reader keep and counts a `yes`/`phrase` as the names bar's "fake it"
(`LK.fakeDecisions` into `sheetFakes`, read by `isSettled`, so the save's
`standingSpans` fakes it; the walk skips a name with a row, so without this
it was never settled and every save warned about it), and saves through
`xlsx-write.js`, which rewrites ONLY the
Fix? cells as inline strings inside the original zip — every other entry
copied through with its compressed bytes, CRC and stamp — and reads the
result back before it is written. A `Combined Text.txt` is listed first
among a folder's documents, and `pdfsync.combinedMembers` reads its
`# Documents in this file:` list so picked PDFs are matched member by
member, by name through the key or by order.

The bar's controls are one row at its TOP (`.lb-controls`: Fix? yes no never
phrase accept, the answer, the typed cell, Apply, clear, then ‹ › Next
unanswered, Find in text, Save, open, close), with the row's own text under
them — count, type, value, where, the problem, the Context quotes and notes.
They used to be the last row, after all of that and after the answer in
words, so yes, no, never and phrase stood somewhere else on every worksheet
row and the hand clicking through had to find them again. Nothing in the
control row changes size from one worksheet row to the next: `#lb-answer`
has one width (`flex: 0 0 16em`, cut short, the whole of it as its title),
`#lb-accept` is put out of sight with `.off` (`visibility: hidden`, and
disabled) rather than `hidden`, which the stylesheet's `[hidden]` rule would
take out of the layout, and `#lb-save` is as wide as a three-figure count. A
window too narrow for the row wraps it at the same place on every worksheet
row, the last buttons right-aligned on their own line. The names bar is laid
out the same way: its decisions and arrows one row at the top, `#nb-answer`
taking the room between them (`flex: 1 1 0`, cut short, its title the whole),
and between documents (`.onward`) the decisions and Find in text, all
`.nb-decide`, go out of sight with `visibility` rather than `display`, so ›
stays where it was and the bar keeps its height.

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
