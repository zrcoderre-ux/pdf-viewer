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

**A name wrapped down a caption's column** (`redact.pageLayoutFromSpans`,
`columnNamesOver`). `pageTextFromSpans` keeps the order the PDF DRAWS its
text in. A caption drawn a line at a time across its columns comes out as
"…; and JONATHAN ) Case No.: 25STCV59720" then "AVERY SMITH WALKER, an )", so
the name is two halves with the other column between, and the sweep boxed
only what the key binds on its own (the surname). Drawn a column at a time (a
Word caption table usually is), the left column's lines are consecutive and
the drawing order finds the name as before. So each sweep also writes the page
out the way it LOOKS: lines by where the spans' middles stand, each span at
the column its left edge stands at, counted in the page's median character
width, a word gap at least one blank, and a wide vertical gap as enough blank
lines that nothing is read down a column across it. `pseudo-key.findColumnSpans`
reads names down a column of that transcript exactly as it does in an export
(the ")" and the bars are column marks; a line with only the ")" beside the
name counts). `columnNamesOver` merges the two readings by the characters they
stand on (`charKeys`, "span:offset"): a column name the drawing order already
found whole is not taken twice, one it did not comes in with a piece per span
(`spanPiecesFor`; a range from the first span to the last would take in
everything drawn between), and a drawing-order name wholly inside it (the
surname token) goes. Both Redact tools use it. The screenshot's cover over the
PDF pane (`pdfNamesOn`) reads the same transcript the forward way
(`forwardSwaps(..., { columnsOnly: true })`), so each half gets its own fake.
`test-pdf-columns.html` checks all of this against pages made with pdf-lib and
laid out by pdf.js: the caption drawn a line at a time, a column at a time, and
with only the ")" beside the first half.

`redact.js` is the store and the painting; its decisions (span joining, char
range to span range, line merging, padding, clamping, the copy's name, the
page as it is laid out) are pure and covered by `test-redact.mjs`.

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
