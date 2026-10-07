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
whole, and asks before it reads the layer for names at all. It asked only
after names had been read, at first, and that is not the same guard: a missing
turn breaks the reading as surely as the placing. With the three rules taken
back off in Chromium and the surname at the end of a line, the next line under
it, the 90, 180 and 270 pages read no name, the screenshot's guard was never
asked, and the PNG kept the name (70 to 127 red pixels) under "the names in
their pseudonyms" while the sweep's guard, asked first, fired on the same
pages. What holds with the rules off now, on those pages and on the ones with
the name on a line of its own: the sweep boxes nothing there and names the page
to be marked by hand, a text drag marks the area drawn (0 red pixels in the
copy), a selection marks nothing, and the screenshot leaves the sheet out whole
whatever its reading found (0 in the PNG). The check costs two rectangles and
one computed style per page; it answers false for the frame between a pane
resize and the layer laid again at the new width, which is true then too, and a
screenshot taken in that frame leaves the sheet out.

**Text that runs sideways ON SCREEN** (`RD.offUpright`, `RD.sidewaysSpans`,
`sidewaysOn`) — portrait text on a page turned a quarter, a filing stamp set up
the margin, a page upside down, words set at a slant. `RD.pageTextFromSpans`
joins spans by the display-frame geometry, which reads such lines as columns:
a line's last word is welded to the next line's first ("QuillfeatherDated"),
and a name is found in part or not at all. Measured on an upright page with its
words set at a slant: 1° and 1.5° read every line apart, 2° ran a full-width
line into the one under it, 3° welded the surname at a line's end to the next
line, so `UPRIGHT_SLACK_DEG` is 1. That measure held for FULL-WIDTH lines only
(see "A slant under the slack" below: a short span at a line's far end welded
from 0.85°). A span's turn is the layer's computed one
plus its own (pdf.js writes a slant as `rotate()`), so a page turned a quarter
whose words read upright is upright, and the same page with its words still
portrait is a quarter off.

- **The screenshot leaves such a sheet out.** It has no check, so it said "the
  names in their pseudonyms" over a PNG with the name in it: on a portrait page
  under `/Rotate` 90, 60 red pixels of the surname and no cover; with the whole
  name on one line, an "Odile" cover over "Nadia" and "Quillfeather" readable
  beside it (98); upside down, 125. `pdfNamesOn` now leaves out whole, the toast
  counting it, a sheet with such words and a name in either reading of it: the
  join's, or each span on a line of its own, which finds a name inside one span
  or wrapped from one to the next whatever the welds. 0 red pixels on all of
  them and on slants from 1.5° to 45°; the upright pages, the pages turned a
  quarter whose words read upright and a 1° slant are covered as before, and a
  sideways sheet with no name on it is taken as it stands. The cost: a sheet
  with a stamp up its margin and a name in its body goes out whole although
  its body was read right, and so does a turned page whose join happened to
  read (portrait under 180 and 270, where it did). Reading 20,000 spans' turns
  costs about a tenth of measuring them, once a sheet, on a screenshot.
- **The sweep and the copy keep it.** A name there can be boxed only in part
  (the fixture: 150 red pixels left in the copy). The check reports it ("1 not
  found — review"), and an area drag over it is the answer. A join that reads
  each span along its own direction is now written (`RD.spanFrame`, below),
  but only the screenshot gives its spans their turns; the sweep's spans carry
  none and are read on screen as before.
- **Left for the screenshot:** a name split mid-word across two spans of
  sideways text, which neither reading finds, on a sheet with no other name.

**A slant under the slack** (`RD.spanFrame`, `SPAN_FRAME_MAX_DEG`, the
direction-aware branch of `RD.spanGap`; `pdfNamesOn` hands the join the turns
`sidewaysOn` reads). The 1° slack was measured on full-width lines. A turned
span's screen box (`getBoundingClientRect`) is the upright box round it, w·|sin
θ| + h·cos θ tall, so a long span's box is tall, its half-a-line threshold with
it, and a drop of under half a line is easy to clear. A name in a short span
of its own far to the right keeps a short box and a small threshold, and its
top has sunk x·tan θ by the end of the line: on a landscape service list at
11 pt on 14 with "Nadia Quillfeather" alone at x = 560 pt, the next row's first
span at the left margin read as the same line from 0.85° to 0.99°, the join
gave "…prepaid Nadia QuillfeatherDated this day…", an "Odile" cover went over
"Nadia" and about 40 red pixels of the surname went into the PNG under "the
names in their pseudonyms" (6303b39, as the review found on c45bde3; the page was taken for upright, so
nothing left it out); at 10 pt on 12 and 12 on 13, 0.99°, the same (36 and
39). Five harder sheets of the same kind (9 pt on 10 and 12 on 13, the name at
x = 600 to 680, in one span or two, from 0.6°) leaked 8 to 47 red pixels the
same way.

Now, where a span says how it is turned on screen (`turn`, degrees clockwise,
the layer's and its own), `spanFrame` works the box it was turned from back out
of the box round it — for w by h turned through θ about its top-left corner the
box round it is w·cos θ + h·|sin θ| by w·|sin θ| + h·cos θ, solved for w and h,
and the corner is the turned box's highest point (θ ≥ 0) or its leftmost (θ < 0) — and `spanGap`
measures the next span's drop across the first span's line and its gap along
it, from that corner. At θ = 0 it is the screen reading to the letter (Node:
"…and at no turn the two readings are one"); a span with no `turn` (the sweep's,
the PDF viewer's), or one more than 30° off, is read on screen as before. The
slack stays a degree: past it the sheet is still left out (`sidewaysOn`), as
measured above. Measured in Chromium, 119 sheets before and after: the six
that leaked on the service list and the five harder ones each now a full "Odile
Brackenbury" cover and 0 red pixels; the other 108 (turned, upright, OCR word
by word, slants to 45° either way, a negative lean) gave the same covers, toast
and pixels as before. `test-redact.mjs` pins the working back, the service
list read both ways, a line's far word kept on its line, lines leaning a
little differently, and a word cut in two at a slant.

**Left for the screenshot: a name only in an annotation.** A FreeText note's
appearance, or a filled form field's, is drawn on the page by pdf.js but is not
in the text layer the screenshot reads, so it is not covered: the `ftext` and
`widg` fixtures put 260 red pixels of "Nadia Quillfeather" into the PNG under
"the names in their pseudonyms" (on this branch before and after these
changes). Covering it needs the annotations' own text read and placed, not
written.

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

The check reads the name four ways, each a reading PDF-Linker's own check
makes (`surviving_reals`, and `surviving_reals_reduced` as `_pn_scrubbed_stem`
asks it, spliced):

- **As written**, every run of letters and digits a word whatever stands
  between them, accents off (`Rasho's`, `23 cv 01234`, `J. Smith`, `Jose
  Garcia` for `José García`, as PDF-Linker's reduced scan folds them with
  `_pn_ascii_fold`): a value is found where all its words stand in a row, or
  run together as one word (`OBRIEN` for `O'Brien`, the apostrophe a file name
  drops). An e-mail address's **host** is a value of its own here as well: an
  address spelled any way but the key's (`helen.rasho@…` where the key binds
  `helen_rasho@…`, an `@` written `at`) has its handle faked word by word by
  the person rows and its host left standing.
- **With its welds parted** where the case or the digits turn (`partWelds`,
  PDF-Linker's hard seam): `RashoDecl` read as `Rasho Decl`, `MSJRasho`,
  `Rasho2023`.
- **A long value inside a word**, eight letters and digits or more, any case
  (`HELENRASHODECL`, `25STCV59720Complaint`), PDF-Linker's long weld tier
  (`_PN_WELD_CORE_MIN`) — or spaced out across whole words, starting and
  ending on a word's edge: `25 STCV 59720` (a docket PDF-Linker reads as one
  identity however it is spaced, and the forward knows only as the key
  spells it), `Mc Allister`.
- **A short name inside a word**: a one-word value of four to seven letters,
  or a name word of a longer value (`nameWordFakes`, the words the unweld
  reads), run into other letters where its own letters carry a capital —
  `RASHODECL`, `Rashodecl`, `RASHOS OPP` (a possessive written without its
  apostrophe). PDF-Linker's short weld tier (`_PN_WELD_SHORT_CORE_MIN`,
  `_pn_span_is_welded`, `_pn_span_is_cased`). The name words are in it
  because the forward reads a word as ASCII letters and parts `JoséGarcía` at
  the accent: the surname faked, `JoséVelarde`, and the given name of a party
  the key binds only whole left welded to its pseudonym. A value that runs
  together once its apostrophe is dropped (`O'Brien` as `OBRIEN`, four to
  seven letters) is in this tier too: it was found only as a whole word, and
  `OBRIENDECL`, `ObrienDecl` and `DSOUZADECL` went out as copies' names.
- **A name's words in any order**: two words of one multi-word value, or one
  of its words beside a word of that row's own fake, anywhere in the name,
  as written or parted. PDF-Linker needs no such reading, since it fakes every
  word of a person's name as its own token (one word, one fake); the reader's
  key carries only the rows a run wrote, and the forward fakes what they bind
  where it stands. So `Rasho_Helen_Decl.pdf`, the surname faked by its own row,
  came out `Strangeways Helen Decl (redacted).pdf`; `Helen M. Rasho Decl.pdf`
  `Helen M. Strangeways Decl`; with the key binding `Mary-Kate Olsen`,
  `Mary Kate Olsen Decl.pdf` `Mary Kate Pell Decl`; and with nothing shorter
  than `Tomas Vrba` bound, `Vrba, Tomas Decl.pdf` and `Tomas_J_Vrba.pdf` went
  out whole — each a name half scrubbed that reads as finished, which is the
  failure the check exists for, and in both readers (Chromium, Redact →
  Save's `suggestedName`). The check had found a value only where its words
  stood in the key's order. The words read are the ones a row's fake
  REPLACED — a word the fake carries (`Holdings`, `de`, `Dr`) corroborates
  nothing — letters only, a pair holding a word of three letters or more
  (`de la` is no name); an e-mail address or a website is left to the
  readings above, its pieces (`law`, `com`) being no name's words. They go to
  the neutral name rather than being faked word by word: a word faked outside
  what the key binds could as easily be a cited decision's party in a file
  named for the decision.
- **A name word of eight letters or more** of a longer value, anywhere in a
  word, any case, as a long value is: `KowalczykDecl`, `KOWALCZYKDECL`, and
  `Kowalczyk Decl`, for a key binding `Helena Kowalczyk`. The name words went
  only to the short tier, under eight letters, and the long tier held whole
  values, so the long ones fell between the two.
- A long value spaced out is read across the PARTED words as well:
  `Case25_STCV_59720.pdf` was `Case25 STCV 59720 (redacted).pdf`, the docket
  standing once `Case25` is read `Case 25`.

The short tier was left out at first, and `RASHODECL (redacted).pdf` was
pinned in `test-redact.mjs` as the expected name, on the reasoning that a test
for a name inside a word would call `Release` a leak in a matter with a party
named Lee. It would not — `release` has no `lee` in it — and `Annual` for a
party named Ann is under the four-letter floor. A review caught the
rationale, and `Rashodecl`, `RASHOS OPP` and `Rashos_Opp` all came out as
their copies' names in both readers. What the tier does cost is a name the
reader cannot tell from a word. PDF-Linker screens a capitalised hit through
its dictionary (`_pn_span_in_vocab_word`: `Marketing` is a word, not Mark);
the reader has no dictionary, so `Marketing Plan.pdf` in a matter with a party
named Mark takes the neutral name, as does `Billing Statement.pdf` with one
named Bill — and so does a pseudonym the forward wrote with a party's short
name inside it (`Hartwell`, in a matter with a party named Hart), as it does
to PDF-Linker's own reduced scan. Measured over 134 words that name legal documents (`Declaration`,
`Opposition`, `Summary`, `Billing`, `Settlement` …) against 204 common
American given names and surnames of four to seven letters: in title case one
name hits one word (Mark, `Marketing`); in capitals three (Mary in `SUMMARY`,
Ross in `CROSS`, Mark). Against PDF-Linker's own list of surnames that are
also English words (`Word Lists/Surname Words.txt`, 4,038 of four to seven
letters), 21 hit one of those 134 words in title case and 58 in capitals. A
name lost costs the operator a rename; a party's name kept goes out with the
one file made to be handed on.

The rows are `pseudo-key.boundRows(key)`: the rows the warning matcher is
built from, so a row holding an instruction (`~Rasho`) is in it with no fake —
the forward writes nothing for it, the check finds it, and the copy goes
neutral. The same key fakes the name and checks it: the whole key in the text
reader (`fwdName`), the chosen key in the viewer.

**One departure from PDF-Linker, in step 1.** The reader's matcher reads a
value exactly as the key spells it — a space as any gap, but a hyphen as a
hyphen and an underscore as an underscore. A federal docket `23-cv-01234`
spaced out was a docket the forward no longer knew, which the check then sent
to a neutral name — a useful name lost for a value the key could fake. So
`spacedStem` leaves the separators inside a bound value spelled with them
(found whole-word in the stem by plain search, only when the stem carries a
`-` or `_`), and the value is faked whole: `23-cv-01234_Order.pdf` →
`23-cv-05678 Order (redacted).pdf`. The underscore was left out of this at
first, and that cost more than a name: an address whose handle carries one,
`helen_rasho@rashofamilylaw.com`, spaced out was no address the key binds, but
its handle was two words it does, so the forward faked the person and left the
firm's domain — `Letter to ingrid strangeways@rashofamilylaw.com
(redacted).pdf`, the surname in the host, under a name that reads as
scrubbed, where the commit before had faked the whole address. The check did
not see it either: the row's words no longer stood in a row. Both are closed
— the address keeps its underscore and is faked whole (`Letter to
quenby3@postbox9.org (redacted).pdf`), and the host is read as a value of its
own. PDF-Linker fakes every e-mail address whole.

The value was still found only where the stem spelled it as the key does, its
spaces included, by plain search: `Mary-Kate_Olsen_Decl.pdf` carries the
key's own hyphen, but the underscore standing for the key's space defeated
the search, the hyphen was spaced with the rest, and the forward faked the
surname by its own row and left the given names — `Mary Kate Pell Decl
(redacted).pdf`; `Mary Kate Olsen Decl.pdf`, the hyphen typed as a space, the
same. Now `spacedStem` finds a value spelled with a `-` or `_` with ANY run of
spaces, underscores and hyphens where the key's spelling has a separator
(whole-word, any case, every other character as the key has it) and writes it
back as the key spells it, the stem's own letters kept: both are `Ruth-Ann
Pell Decl (redacted).pdf`, and `23_cv_01234 Order.pdf`, the docket typed with
underscores, is the docket the key binds, `23-cv-05678 Order` — PDF-Linker
reads every spelling of a docket as one identity — where it went neutral
before. The longest value wins where two overlap. A pattern is built only for
a row with such a separator whose first piece the stem holds (`indexOf`
first).

**The neutral name's hash** (`stemDigest`) is FNV-1a over the stem, so the
same document always takes the same name and two documents rarely one — mixed
with the key's real values first. A hash of the stem alone would let anyone
holding the copy test a guess at the name it came from; the key is never a
file to share. Re-redacting a neutral copy keeps its name, marked once.

**Residual:** a short name welded in lower case (`rashodecl`, `Declrasho`,
and an e-mail handle typed without its `@`, `hrasho_quillmark-law.com`, whose
host the forward fakes and whose handle is the surname welded in lower case),
and a name of three letters or fewer welded with no seam (`LEEDECL`,
`Leedecl`; `LeeDecl` is parted at its seam and caught), both of which
PDF-Linker's short tier leaves too — the capital is what keeps a four-letter
name out of the letters of ordinary words, and under four letters a name
cannot be told from a word's (`Ann` in `Annual`, `Lee` in `Leeward`). And a
lone word of a longer value standing by itself, under eight letters (`Vrba
Decl.pdf` for a key binding only `Tomas Vrba`): the key does not bind it, as
the reader does not mark it on the page, and a given name or surname that is
also a word (`Mark`, `Case`, `Price`) is in file names too often to send them
neutral. The name is offered in the Save dialog and named once it is saved.

A bare forward function (no rows) is still taken, the forward then being its
own check over the name as written and parted; both callers pass
`{ forward, rows }`. Filenames are a few words, so none of this is near the
per-page budget (Design Notes/Text reader hangs and freezes.md): the check is one pass
over the key's rows per saved copy, the unweld bounded at three words, every
search in the check a plain `indexOf` or a set lookup, and the only patterns
built from the key `spacedStem`'s, one for each row with a separator whose
first piece the stem holds, each a literal run of the key's pieces with
`[\s_-]+` between. Measured with the four readings: 15 ms a name, the forward
included, under a key of 6,112 rows; with the readings since, 26 ms a name
under 6,100 (19 ms before them, on the same machine).
