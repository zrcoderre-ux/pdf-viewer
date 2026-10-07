## Redaction (`viewer/redact.js`, `pdf-edit.buildRedactedPdf`)

The **▬ Redact** tool marks what has to go and saves a flattened copy with it
blacked out. Three things are load-bearing and should not be traded away:

1. **The copy is a raster, not the original with rectangles on it.** A
   rectangle drawn over text leaves the text in the file. `saveRedactedCopy`
   re-renders **every** page to an offscreen canvas at the chosen dpi, fills
   the boxes black on that canvas, encodes it, and `buildRedactedPdf` assembles
   the images into a document created fresh (`PDFDocument.create`). Every page,
   not just the marked ones: a copy searchable everywhere except over the
   boxes tells a reader where to look.
2. **No metadata.** `create({ updateMetadata: false })` stops pdf-lib stamping
   its own Producer and dates; `stripMetadata` deletes any `/Info` and the
   catalog's XMP `/Metadata` outright, and `pruneEmptyPageEntries` takes out
   the empty `/Annots`, `/Font` and `/ExtGState` a new page is built with. The
   guarantee does not rest on the flag alone. `test-redact.mjs` inflates the
   saved bytes and asserts all of it, because pdf-lib writes into compressed
   object streams — an assertion made against the raw text would pass for the
   wrong reason.
3. **It never writes the open file.** `writeOutPdf` is called without
   `inPlace`, so the local-file-handle branch is unreachable from here. The
   toolbar's 💾 Save is the in-place one, and they must stay separate.

Boxes live in **PDF user-space points**, not screen pixels: a zoom rebuilds
every layer from scratch and the rotate tool changes the frame, and points are
what survives both. `pageUserBoxByNum` holds the page's own box from
`page.view` for clamping — deliberately not `pageHeightPtsByNum`, which is the
*displayed* size and is wrong for a page carrying `/Rotate 90`.

The key-driven pass (`scanForKeyValues`) reads a page's spans as one string
(`redact.pageTextFromSpans`, joined by what the geometry says the gap is:
newline, space, or nothing for a word cut in two), runs
`pseudo-key.findRealSpans` over it, and maps each match back to a DOM range
(`redact.spanRangeFor`) for its rectangles. `applySelectableArea` empties the
spans of the pleading gutter and anything outside a crop region, so the page's
span texts are captured before that (`capturePageSpans`, text only — no layout
read) and put back for the length of the measurement. A name is no less
printed on the page for being unselectable.

`redact.js` is the store and the painting; its decisions (span joining, char
range to span range, line merging, padding, clamping, the copy's name) are pure
and covered by `test-redact.mjs`.

### The same tool in the text reader (`text-reader.js`, "redacting the PDF beside the text")

Side by side, the reader shows the case folder's own PDF beside the export it
was scrubbed into; **▬ Redact PDF** marks that PDF and writes the copy from
there. The three load-bearing things above are unchanged — the copy is a
raster built by the same `buildRedactedPdf`, it carries no metadata, and the
save has no in-place path (`writeBlob` is called with a null handle, so it can
only reach the Save dialog or a download). What is different follows from
where it runs:

- **A store per document.** The viewer has one PDF open; the pane can hold the
  pages of two dozen, because a `Combined Text.txt` names a document per member
  and each has a PDF of its own. Page 3 of the motion is not page 3 of the
  reply, so the single module-level store became `redact.createRedactionStore()`
  and the reader keeps one per PDF name (the viewer's bare `addRedaction` etc.
  still stand for a default store, unchanged). The save writes one copy per PDF
  that carries boxes.
- **The sweep goes to the PDF, not to the pane.** Only the pages in view are
  ever drawn, and at the pane's width — but a copy is the whole document, so
  `keyBoxesForPage` lays each page's text out **off screen** with pdf.js's own
  `TextLayer` at scale 1 (one CSS pixel to the point), measures it
  (`redact.measureSpans`) and asks the browser for the rectangles, page by
  page, rendering no bitmap. Estimating the geometry from `getTextContent`
  instead is what this replaced: a text item there is usually a whole printed
  line with one origin and one width, and dividing that width by the line's
  characters put the box a letter or two off — `QUILLMARK` with the `QUI` still
  showing, which is not a redaction.
- **Keeps are respected.** The reader's `reals` is compiled from the key *less
  the keeps* (`keyLessKeeps`), and the sweep uses it: a value the review has
  kept is one already decided not to be this matter's to hide.
- **The boxes are the folder's, not the document's.** They outlast a hop
  between exports (that is how a folder is read) and are dropped when the case
  folder changes or Clear is pressed; a different key drops what the last key
  proposed and re-sweeps, leaving the hand's boxes alone. `pdfsInUse` counts a
  PDF carrying boxes as in use, so the review walking past it does not close it
  underneath the save.

The pane's slots carry a `.redactLayer` beside their text layer, repainted from
the store every time a page is drawn (they are recycled as they scroll out of
view, so the store — not the DOM — is where a box lives). While the tool marks
areas the reader's own selection drag stands down on the pane, and the boxes
take the pointer only while the tool is on.

## A redaction drag is geometric, never a selection (`text-reader.js`)

While the redaction tool is on, a drag over a PDF page belongs to the tool in
BOTH modes: `attachAreaDrag` is active whenever `redactOn`, and the reader's own
`bindSelection` stands down over the pane. That is not tidiness, it is a bug
fix. The reader's selection snaps to the nearest character **on its row** —
right for reading — so a drag over a signature returned a range over whatever
text was nearest, and the box landed on a line of text well above the
signature, silently redacting the wrong words and reporting success.

`textRectsUnder()` replaces it: each text-layer span whose vertical band the
drag crosses is clipped to the drag horizontally and kept whole vertically. No
spans crossed means no text there, which is the honest answer, and the drag
falls back to marking the rectangle itself (`kind: "area"`) with a toast saying
why. `markDraggedBox` is the one place that decides.

## Turned pages: the text layer's frame (`text-reader.css`, `layerOnSheet`, `layerTurned`)

pdf.js's `TextLayer` lays a page's words out in the page's own UNROTATED frame
— `setLayerDimensions` sizes the box from `rawDims` and only stamps the
viewport's turn on it as `data-main-rotation` — and leaves the turn to the
viewer's stylesheet (Design Notes/Page rotation.md). `viewer.css` has carried
the three `.textLayer[data-main-rotation]` rules from the start. The text
reader loads only `text-reader.css`, which did not, so on every `/Rotate`
90/180/270 page its layers stood upright over a bitmap drawn turned: on a
quarter turn a 465 × 602 box of words over a 602 × 465 picture. Three things
asked the browser where the PDF's words are and got the wrong page:

- **The key sweep.** `keyBoxesForPage` measured the off-screen layer in the
  unrotated frame and read the pixels through the ROTATED viewport's
  `convertToPdfPoint`, so every box was stored transposed or mirrored;
  `renderRedactedPageNow` painted it exactly where it was stored, and the copy
  saved with the name readable beside a black strip. The check compares words
  and labels, never places, so it passed.
- **The screenshot.** `pdfNamesOn` measured the pane's layer the same way and
  `coverPdfNames` painted the fakes where the layer was, with the name left in
  the PNG under "the names in their pseudonyms".
- **The hand.** `textRectsUnder` hit-tested the drag against the displaced
  spans and stored a strip somewhere else, labelled with the name and carrying
  its words, so the check counted it; `redactCurrentSelection` read a
  selection's rectangles off the same layer.

Measured with a red invented name on 0/90/180/270 fixtures: before, the copy
kept 210–244 red pixels of it and the screenshot 121–271 on every turned page,
with the check silent on all but one (where the sweep happened to break the
name); with the rules copied into `text-reader.css`, 0 and 0 on every page
whose text reads upright on screen, a hand drag over the name too. The rules turn the box with a
transform, so `offsetLeft`/`offsetTop` inside it stay in the page's frame
(`blankLineNumbers` reads those), and the sweep's off-screen box, a text layer
too, turns with the rest — measured in the rotated viewport's frame, which is
the one `convertToPdfPoint` reads.

**The guards make the next frame bug loud.** Nothing compared a box with the
page, which is why this was silent. `layerOnSheet(sheet, layer)` answers
whether a sheet's layer stands over its bitmap: the same box to within
`LAYER_SLACK_PX`, and turned as pdf.js asked (`layerTurned` reads the quarter
turns of the computed transform against `data-main-rotation`), since a page
turned half round has the bitmap's box exactly and only its words mirrored —
a box test alone passed it. Where it says no: `keyBoxesForPage` boxes nothing
on the page and answers `askew` (the same turn and the viewport's box), the
sweep's toast names the page to be marked by hand, and `whyNotFound` gives the
check's walk that reason (`sweptAskew`); `textRectsUnder` answers no words, so
a text drag marks the area drawn and says why; `redactCurrentSelection` marks
nothing and says why; `pdfNamesOn` leaves the sheet out of the screenshot
whole. Taking the three rules back off in Chromium, every one of those fired on
the 90, 180 and 270 fixtures and no real pixel reached the copy or the PNG. The
check costs two rectangles and one computed style per page; it answers false
for the frame between a pane resize and the layer laid again at the new width,
which is true then too.

**Residual: text that runs sideways ON SCREEN** — portrait text on a page
turned a quarter, a margin note set vertically. `RD.pageTextFromSpans` joins
spans by the display-frame geometry, which reads such lines as columns: a name
can be run into the line beside it and boxed only in part (the fixture: 150 red
pixels left in the copy, 98 in the screenshot). The check does report it ("1
not found — review"); the screenshot has no check and does not.

## Checking a redaction against the export (`text-reader.js`)

The sweep's blind spot is that it reads the PDF's text layer, which is not a
transcript — ligatures, line-broken names, OCR spellings, and anything that is
not text at all (a signature, a letterhead, a scan). A miss leaves no trace, so
the feature is not "find more boxes", it is "say what was not found".

`claimsFromExport()` reads every `.pn` span on every text page that maps to a
PDF page (`pdfTarget`) — a name wrapped across lines is several spans and ONE
claim, so only `data-piece` "1/n" counts — and keys them
`pdf|page|fold(real)`. `boxesFromSweep()` counts the `kind: "key"` boxes the
same way. `redactionShortfall()` is the difference, in reading order.

Three decisions worth keeping:

- **Coverage is by WORDS, and every box contributes what it covers.** A box
  stores `words` (what is under it) beside `label` (what it is called): a key
  box contributes its value, a hand box the text under the drag, an area box
  the text under the area — which is how blacking out a name in area mode is
  credited. Kept values are not claims at all (`reals` is the key less the
  keeps, so the sweep never boxes one). These were the "redacted but not
  recognised" reports: each was a real redaction the check could not see.
- **A miss carries its reason** (`whyNotFound`): no text on that page at all,
  boxed on a different page (page numbering out of step), or the text simply
  not yielding it. `sweptText` records the character count per swept page,
  which is what makes the first of those answerable.
- **It proposes no boxes.** The export knows the page, not the place: its text
  is its own layout, not the PDF's geometry. A guessed box over the wrong words
  would be worse than none, so the walk hands the question to the operator with
  the text and the PDF page side by side.
- **A short claim walks all its occurrences, but the SHORTFALL is what is
  outstanding.** Three claims against two boxes is one value still standing,
  not three: `missShort` holds `want - got` per group, the bar counts the sum
  of those, and `accountForMiss` decrements it. When it reaches zero the group's
  remaining entries are dropped in one go — the places are walked because which
  one went unboxed is unknowable, but once the outstanding count is met they
  are questions already answered and making the operator dismiss each is work
  for nothing.
- **An area drag on the walked page answers it** (`missAnsweredByBox`) — that
  is the gesture the walk exists to prompt, and asking for a second click to
  confirm would be asking twice. `Accounted for` covers the other good answer,
  that the value is not on that page at all. Both last as long as the marks do;
  a fresh sweep asks again.

The redaction tool keeps the whole reel live while it is open (`reelTrim`
skips, `reelAllLive` on open): a shed page carries no pseudonyms, and a claim
that cannot be read is a claim that would silently go unchecked.

## The copy's name (`redact.scrubbedStem`, `redactedName`)

The copy is the one file made to be handed on, and its name goes with it. It
used to be the PDF's stem run forward through the key as it stood, and the key
finds a value only standing as a whole word. A file name is not a sentence: an
underscore is a word character to the matcher (`WORD_CLASS` is
`[A-Za-z0-9_]`), so `Rasho_v_Quillmark_MTC` was one word with no name in it,
and `25STCV59720_Complaint` carried the docket the same way; and a weld
(`HelenRasho Decl`, `RashoDecl`) has no boundary at all. Every one of those
came out as it went in — the party's name on the outside of a copy whose pages
were black over it — in the text reader and the viewer alike, since both call
`redactedName`.

PDF-Linker had met the same names first, naming the exports
(`_pn_scrubbed_stem`), and the copy is now named its way. `scrubbedStem`:

1. **Separators are spaces.** Runs of `_` and `-` become one space
   (`pdfsync.spaceStem` is the same normalisation, used to match an export to
   its PDF), so every word of the stem is a word to the key, and the copy of
   `Rasho v Quillmark - MTC.pdf` is named as its export is: `Strangeways v
   Melbury MTC (redacted).pdf`. With no key the separators are still spaces:
   a document's name is written with spaces, never underscores.
2. **The stem is run forward** through the caller's key.
3. **Welds are unwelded** (`unweldNames`, `_pn_unweld_stem_names`): a run of
   six or more letters made only of two or three bound name words joined
   exactly is their fakes joined the same way, each in its own word's case —
   `HelenRasho` → `IngridStrangeways`, `HELENRASHO` → `INGRIDSTRANGEWAYS`.
   The words come from `nameWordFakes`: every row whose fake was composed word
   for word, words of three letters or more that the fake actually replaced.
   PDF-Linker reads only its person rows; the key as the reader parses it
   carries no category, so every row is read, and the concatenation is the
   corroboration — no ordinary word is two names end to end.
4. **The result is checked** (`boundValueStands`), and where any value the key
   binds still stands in it the copy takes a neutral name, `document 3fa9c1
   (redacted).pdf`.

The check asks **whole words, never letters.** The review proposed a
case-folded substring test for every bound word of three letters or more; it
would call `Release` a leak in a matter with a party named Lee and `Annual`
one with a party named Ann, and send a folder's copies to `document …` for
nothing. So the name is read three ways, each a reading PDF-Linker's own
check makes: as written, every run of letters and digits a word whatever
stands between them (`Rasho's`, `23 cv 01234`, `J. Smith`), a value found
where all its words stand in a row; with its welds parted where the case or
the digits turn (`partWelds`, PDF-Linker's hard seam — `RashoDecl` read as
`Rasho Decl`, `MSJRasho`, `Rasho2023`), a seam `Release` does not have; and a
value of eight letters and digits or more anywhere inside a word
(`HELENRASHODECL`, `25STCV59720Complaint`), PDF-Linker's long weld tier
(`_PN_WELD_CORE_MIN`). The rows are `pseudo-key.boundRows(key)`: the rows the
warning matcher is built from, so a row holding an instruction (`~Rasho`) is
in it with no fake — the forward writes nothing for it, the check finds it, and
the copy goes neutral. The same key fakes the name and checks it: the whole
key in the text reader (`fwdName`), the chosen key in the viewer.

**One departure from PDF-Linker, in step 1.** The reader's matcher reads a
value exactly as the key spells it — a space as any gap, but a hyphen as a
hyphen. A federal docket `23-cv-01234` spaced out was a docket the forward no
longer knew, which the check then sent to a neutral name — a useful name lost
for a value the key could fake. So `spacedStem` leaves the
hyphens inside a bound value spelled with them (found whole-word in the stem
by plain search, only when the stem carries a hyphen), and the docket is faked
whole: `23-cv-01234_Order.pdf` → `23-cv-05678 Order (redacted).pdf`.

**The neutral name's hash** (`stemDigest`) is FNV-1a over the stem, so the
same document always takes the same name and two documents rarely one — mixed
with the key's real values first. A hash of the stem alone would let anyone
holding the copy test a guess at the name it came from; the key is never a
file to share. Re-redacting a neutral copy keeps its name, marked once.

**Residual, pinned in `test-redact.mjs`:** a short name welded to a word no
key binds, all in one case, with no seam to part — `RASHODECL`. PDF-Linker
tells that from `MARKETING` with a dictionary the reader does not have, and
the only test left without one is the substring test above. The name is
offered in the Save dialog and named once it is saved.

A bare forward function (no rows) is still taken, the forward then being its
own check over the name as written and parted; both callers pass
`{ forward, rows }`. Filenames are a few words, so none of this is near the
per-page budget (Design Notes/Text reader hangs and freezes.md): the check is one pass
over the key's rows per saved copy, the unweld bounded at three words.
