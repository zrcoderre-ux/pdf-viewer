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

**My-Macros' Markdown export opens as a lone file** (`TD.isMarkdownName`).
The re-anonymized `.md` My-Macros writes from a Word draft carries the
pseudonyms, as an export does, so it takes the `.txt` path unchanged: the
pickers, the drop, the file input, the PWA's `isTextFile` and its
`file_handlers` all accept `.md`/`.markdown`, and `parseExport` reads it as
it reads a headerless Word export, one page, round-tripped byte for byte. The
page is the file's text, and a save writes that text back.

**…and drawn as a Word document** (`TD.markdownLines`, `dressMarkdown`,
`.page-body.md`; 2026-10-28). The owner: "It should present the markdown like
it was a word document in times new roman", and "make sure that it has the
correct width. It currently has the document too wide." It was shown as
written, `#`, `**` and list markers and all, in the reader's font on the
reader's margins (48 pixels a side: a 7.5-inch column). Nothing is rendered
away: `markdownLines` reads each line's shown text for what it is (a heading,
an item and its level, a numbered item, a quotation, a rule, a fenced code
block, a table) and which characters are marks (`hide`) and which stretches are
bold, italic, code, a link or a tracked change (`runs`), CommonMark's
flanking rules deciding `*` and `_` (an `_` inside a word is text,
"Rasho_Helen_Decl"; a `*` between spaces is text), no mark read inside a
pseudonym or a spot keep (`atoms`), and `~~strike~~` left to `dressStrikes`.
`dressMarkdown` then marks each `.line` (`data-md`, `--md-depth`), hides the
marks in `.mk` spans (as a strike's are hidden in `.sk`) and wraps each stretch
in `.mdr` spans (`wrapStretch`: a name's span whole), the text unchanged, so
the save, a copy, Find and the names' matching read the file exactly as
before; it runs with `dressStrikes` (`dressBody`, `recolumnLater`, a strike),
and checks a line's dressing a character at a time (`mdWanted`,
`mdDressingOf`) so a line already dressed is not touched. `dressColumns` cuts
no columns on a Markdown document: a Word page is paragraphs. The stylesheet
makes the page Word's: `--md-in` is the sheet's width over 8.5, the margins an
inch, the type Times New Roman at a sixth of an inch (12 points), a list item's
text half an inch in a level with its bullet (•, o, ▪) or number a quarter inch
before it, so a narrower window draws the same page smaller and each line
breaks where Word's would. With ✎ Edit on the marks show, dimmed, and the
bullets and rules give way to them. Tables are left as written. Tests:
`test-markdown.mjs` (Times New Roman, 12 points, an inch each side and 6.5
inches of text at the sheet's scale; the marks out of sight, the heading, the
bold real name, the italic word and the bullet drawn; the text the file's; the
marks back with Edit on; the save byte for byte), `test-textdoc.mjs`
("a Markdown document read as a Word document"). It is not an export —
`isExportName` does not take it, so PDF-Linker's run, the LEAKS rows
(`exportForName`) and `looksLikeTextFiles` do not see it — and `renameFixed`
refuses it, there being no PDF to rename with it.

**…and listed in the case folder's Documents** (`scanFolder`'s `mdDocs`, the
`md` flag; 2026-10-29). The owner: "markdown files should also be included in
the case folder along with the text files in the documents menu". A `.md` in
the case folder or its Text Files folder is listed with the exports, in name
order, tagged MD (`.tag.md`), one of a name. A click opens it as the lone file
opens. An export is opened first when a folder is (`openFolderNow`), and the reel
passes a draft over and never runs from one (`reelNextDoc`, `reelPrevDoc`,
`reelOn`): `mdDoc` dresses the page by the head document's name, so a draft
among exports would be drawn as the wrong kind of page. Find, Replace in
folder and the leak sweep read it as they read an export. `TD.docLabel` (the bar, the print title, the reel divider) and
`PS.normalizeStem` drop `.md` with the other extensions, and the Save picker
offers a `.md` as Markdown. `test-markdown.mjs` covers it.

**A name is matched through Markdown's marks** (`pseudo-key.altFor`, `MARK`,
`foldMarks`). Shown as written, the Markdown puts marks inside names that
claude.ai renders away, so the extension swapped names the reader missed:
emphasis opening or closing inside one ("*Ingrid* Strangeways", a caption's
"**QUARRY FINCH**, an individual"), a tracked change ("Ingrid{++ ++}Strangeways",
a "{--Smith--}" between its words), and the escape My-Macros writes before
`*`, `_`, `\` and a backtick ("ingrid\_s@mail.org"). A value's pattern lets
`MARK` stand wherever one of its words meets a blank or punctuation, and lets
each mark of punctuation carry an escape; `foldGaps` takes the marks out of a
match before it is looked up (an escape keeps its character), and `lineRanges`
cuts a match at them as at a line break, so they stay in the text between the
pieces and "*Ingrid* Strangeways" reads "*Helen* Rasho". An underscore at a
word's edge is emphasis ("_Ingrid_"); one joining two words still makes one
word ("Rasho_Helen_Decl"), so the boundaries are `BEFORE`/`AFTER` rather than
a word class with `_` in it. Quote marks are matched and folded either way
(`fold`, `charPattern`), since a Word draft types "O’Dell" where the key has
"O'Dell", and `mirrorCase` writes the replacement in the text's own quotes
(the extension's `mirrorQuotes`). The same reading serves the save (a real
name among the marks is faked) and the leak check. `test-pseudo-key.mjs`,
"markdown: a name among Markdown's marks".

**A keep in a Markdown export is carried out by its save** (`clearKeptIn`).
In a PDF-Linker export a value kept where the run faked it stays faked on
disk until the next run un-fakes it through `New Real Values.txt`. Nothing
will ever rewrite a `.md`, so a save of one being edited (Edit on, or dirty)
first takes each `.pn.kept` span off the page and leaves its `data-real` as
plain text, one undo step a page, and adds the member to `touched` so it is
written. The forward pass and the last check already read past a kept value
in the clear (`maskKept`), so the save neither re-fakes it nor refuses it,
and the file opened again shows it as kept text. A `.txt` is untouched by this.

**A stand-in only the pinned sheet holds is named at the save**
(`PK.compilePinnedFakes`, `pinnedFakes`, `pinnedNote`). PDF-Linker puts a
binding no export carries on "Pinned (never in text)", which DeAnonymize.bas
does not read. The forward side writes a real name typed as its pseudonym
whichever sheet binds it (the applied sheet's fake where both do), so a
party named in no export yet, typed into one, went to the file as a stand-in
Word's macro could not turn back, and nothing said so: the failure the
project ranks above every visible leak, silent until a run. PDF-Linker's next
run finds an export carrying a pinned stand-in and moves its row onto the
Pseudonym Key sheet (its session's work on the bug search's fix 6), so the
reader keeps writing it and the save names it in red, from the texts it
wrote, until then: "run PDF-Linker … before the export goes out". Asked of
the texts written, not of the swaps, so a name the typing converter marked or
a paste carried is named too; an OCR fix's row (its Replacement the text's
own correct reading) and a stand-in the applied sheet also reverses are not.
`test-typed-cites.mjs` case 7 pins it; on the code before it the save said
nothing. The `# stand-in:` declaration line once planned for New Real
Values.txt (P3(a)) is not built: PDF-Linker reads the exports themselves.

**A document's name is SHOWN in the real names** (`shownDocName`,
`paintDocNames`; 2026-10-28). The owner: "when a case folder is open, the
document titles should show the real values instead of the pseudonymized
ones." An export's file name is in its pseudonyms (PDF-Linker scrubs it), and
the tab (`document.title`, which the PWA's shell reads for its tab label), the
top bar's name, the status bar, the Documents list, the reel's dividers and the
names bar showed it so. Now each runs the name through the key backward
(`rev`, as the pages are shown), with Show fakes off; with it on, the file's
name. Only the display changes: every lookup, the reel, the save and the
LEAKS rows go on keyed by the file's name (`m.name`, `d.name`, `li.dataset.name`).
`paintDocNames` paints them all again when the key is compiled and when Show
fakes is turned. The rename field opens on the name as shown, and `renameDoc`
writes a typed real name as its pseudonym as it always did
(`RD.scrubbedStem`). A screenshot fakes the titles with the rest of the
chrome, the shell's tab included (`swapChrome`), and a print is titled by the
file (`printTitle`). Tests: `test-rename-doc.mjs` (case 1: the titles real,
Show fakes, the screenshot in the pseudonyms; 4a: the field left as shown
renames nothing).

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
with its fake in the layer's type, under the redaction boxes. A sheet whose
layer does not stand over its bitmap (`layerOnSheet`: the same box, and the
quarter turn pdf.js asked for, see Design Notes/Redaction.md) has names that
cannot be placed, so it is covered whole (`whole`) before anything is read off
it, since words read off a layer standing elsewhere cannot vouch that it has
none, saying why, and the toast counts it (`shotLeftOut`) rather than say only
"in their pseudonyms". So is a sheet with words that do not run left to right
on screen (`sidewaysOn`: portrait text on a page turned a quarter, a stamp up
the margin, a slant past a degree) and a name in either of its readings — the
join welds such lines, so a name there is found in part or not at all (Design
Notes/Redaction.md, "Text that runs sideways ON SCREEN"). Under a degree the
join reads each span along its own line (`RD.spanFrame`, with the turns
`sidewaysOn` reads, which it now reads first): read by its box on screen, a
name alone in a short span at a line's far end ran into the next line's first
word from 0.85°, and its surname went into the PNG beside an "Odile" cover
(Design Notes/Redaction.md, "A slant under the slack"). A name only in an
annotation's appearance (a FreeText note, a filled form field) is drawn on the
page but is in no text layer, and is not covered (same file, the residual
after it). Only a sheet that is
covered name by name adds its `WITHHELD` names to the toast. A name
the key holds only an instruction for is covered with `WITHHELD`, on the pages,
in the chrome and over the PDF alike (`egressSwaps`, under **A control word in
the key's Replacement cell** below), and the toast names it (`shotWithheld`). Put
back: each node's own text, `afterTextChange()`, and the underlines at once. While
`shotPut` is set, `beforeinput` on the pages is refused and the reel hangs
nothing above. Hosted, the fakes go on only once the screen share is granted
(`shareThisTab` answers the frame-taker), and a share that sends no frame is
given up after five seconds, so the fakes never stay on.

**…and the Flagged panel's values covered** (`withFakes`, `body.shot-flags`,
`.fv`; 2026-10-30). The owner: "When a screenshot is taken, if Flagged is
open, it should hide the words listed there as spotted unfaked to be
pseudonymized." Those values are names the key does not bind yet, so no fake
stands for them and every pass above left them as they read: a screenshot
with the panel open carried the list of real names. Each value is its own
span in `#flags-list` now (`renderFlags`), and while the picture is taken the
stylesheet hides it and draws `WITHHELD`'s five blocks in its place, the
length the same whatever it covers. It is a class, not an edit of the nodes,
so a list drawn again while the fakes are up is covered too, and it is set in
`withFakes` around `fakesForShot`, so it holds with no key open as well. The
toast counts the values covered (`flagsOnScreen`). Only the panel: a flagged
value standing on a page, or typed into Find by a click on its row, still
reads as it stands in the picture. Test: `test-shot-fit.mjs` case 5.

**…and its lines kept on the page** (`shotFitRead`, `shotFitWrite`;
2026-10-28). Nothing is laid out again for the picture, and a fake is often
longer than the name it stands for: a line fitted to the sheet in the real
names ran past its edge in the pseudonyms, and a caption's party ran across its
`)` side into the case number (the owner, of such a screenshot: "The text is
going off the page here."). So before the fakes go in, each line, each column
piece (`.cc`) and each box row's cell (`.rc`) on the pages within a screen is
read for where its text ends; after, one that runs further than it did, past
the sheet's edge, the next bar (a space short of it, as `needOnGrid` has it) or
the next piece's text, is narrowed by a transform to end where it did, or at
the limit where that is further on. A line the layout had narrowed keeps its
origin; any other is narrowed toward its text's start. back() puts each
transform back before the text, and no node moves, so no highlight range is
disturbed. Test: `test-shot-fit.mjs` (fakes longer than the real names: on the
screen and in the picture nothing past the sheet or across the side, and the
screen as it was after).

**…and the PDF's names covered a line at a time, in the PDF's face**
(`pdfNamesOn`, `sheetFace`, `coverPdfNames`; 2026-10-28). The owner, of a
screenshot whose PDF pane had fakes drawn as slivers: "notice how cramped some
of the pseudonyms are drawn?" pdf.js draws a justified line as a span a word or
a few, and a name over two spans was two covers: its fake squeezed into the
first and the second left white beside it ("MEADOWGATE COBALT, INC." as a
17-pixel fake and a 41-pixel blank). The pieces of one name on one line are now
merged into one cover (`RD.mergeRects` with a gap of four line heights; a name
wrapped onto the next line is still a cover more, blank). And a cover took the
text layer span's family, which pdf.js sets to "serif" or "sans-serif" only, so
a Times page's names were covered in a wider sans and squeezed further: it
takes the family most of the PDF page's items are set in (`sheetFace`, off
`info.rows` and `info.faces`, the sheet's slot noting its PDF page in
`drawSlot`, `__pdfOf`). A fake longer than its name is still drawn narrower to
fit; that much is the cost of covering a picture. Test: `test-shot-fit.mjs`
case 3 (a name in two of the PDF's spans: one cover, in Times; on the code
before, a fake and a blank, in "serif").

**A page shown ⇄ Raw is a page, not chrome (`shotRaw`).** It was left to
`swapChrome`, which runs `egressSwaps` one text node at a time, and the raw
sheet's orange marks split a name into a node a piece: a name wrapped down a
caption's column ("…and Jonathan" / "Avery Smith Walker, an") was read as
"Jonathan", matching nothing, and "Avery Smith Walker", matching the bare
"Walker" row, so the PNG carried "Jonathan" / "Avery Smith Cascadia" — under
a toast saying the name was covered with `WITHHELD`, the cover having been
laid on the hidden `.page-body`. The same for a name with a pseudonym, under
"the names in their pseudonyms"; on main and before this branch too. Now each
near raw sheet is read whole before its page's body is touched
(`rawPageText`, its fakes and spot keeps in their places, after `fillRaw`
brings it up to date) and its swaps are made in its own text nodes by
`swapInNodes`, the marks and a selection in it standing; `swapChrome` skips
`.raw-sheet`. The print of a raw page already read it whole (`refreshRawPages`
rebuilds it from the covered body), and so did a copy (`copyOfRaw`).

**The window is live while the picture is taken (`shotHeldBack`).** The fakes
are up from `fakesForShot` until `back()`, the frame drawn 300 ms and two
frames after the share dialog closes, and anything that wrote into the window
meanwhile wrote past them. The flag pop-up: the fakes' own edits move the
selection and fire `selectionchange`, `showFlagPop` rewrote `#flag-pop-note`
from `leakIn(…).real`, and the PNG said "“Dana Okafor” is in the key and
stands unfaked here…" — or "“Gregorio Sarvinyan”…" for a name the toast said
was covered; with 🚩 on, a drag over an orange name leaves exactly that state
by design. The run bar: `checkRun`, on the focus coming back as the share
dialog closes or on its 30-second tick, found the bar's text (faked in place)
not what it would say and wrote the real one back — "PDF-Linker is running on
Rasho v Quillmark", a case folder being named for its parties. Both on main at
b0a2d0c too. Now the pop-up and the keep menu are hidden for the picture and
put back after it; `showFlagPop`, `showRunBar` and the typed-name converter
(`convertTypedReals`, whose `normalize()` would also take out the empty text
nodes a wrapped name leaves for the picture, which the put-back then cannot
find) hold what they would write while `shotPut` is set and write it in
`back()` (`flagPopHeld`, `runBarHeld`, `caretHeld`); a toast raised meanwhile
goes up through `egressText`; `saveDocument` and `flagSelection` refuse, the
page holding the picture's words; the hover tip shows nothing. Residual: a
writer into the window that is none of these and lands inside the capture
window writes past the fakes all the same; these are the ones found.

**🖨 Print and a page swapped for its PDF page.** `fakesForPrint` runs every
page body forward (`egressText`: a name the key holds only an instruction for
printed as `WITHHELD`, and named in a toast once the dialog closes) and shows
the pseudonyms, and the print is the display — in
which a swapped page's body is hidden (`.tpage.swapped .page-body`) and its
`.pdf-inline` sheet, the unscrubbed filing, is not. So a page shown through ⇄
PDF printed "Helen Rasho … Quillmark Holdings" in a printout that had faked
every other page; and the swaps are remembered per document
(`PS.swapStoreKey`) and ⊘ Did not OCR swaps its page by itself, so this was
any print of a document with a swap left on, not one click before Ctrl+P. Now
`beforeprint` sets `body.printing` where any page is swapped, and the
stylesheet shows the swapped bodies and hides their inline sheets for as long
as it stands (on screen behind the dialog too); `shapePages` passes over a
swapped page except under `body.printing`, so its text is fitted to the paper
with the rest (a page that opened swapped was never fitted at all), and
`afterprint` takes the class off. `holdReading()` goes first both ways, the
swapped sheets changing height. The print stylesheet repeats the rule on its
own — `.pdf-inline { display: none !important }` — so print media that no
`beforeprint` announced still carries no PDF page (the body then prints as the
screen shows it, like every other page in that case). Covering the inline
sheet's names, as the screenshot does, was the alternative and the weak one
here: a page is swapped because its OCR is mangled, which is the text layer
least likely to give its names up to a cover. A swapped page fitted for a
print keeps that fit, made at its own sheet's width; where the print faked
anything, `pagesBackAfterPrint`'s `afterTextChange` moves `textEpoch`, so
swapped back the page is fitted again to its real text (`shapeKey`).

**Copy, cut and drag carry the pseudonyms.** Nothing listened for them, so the
browser copied what the screen showed: with Show fakes off (the default) the
real names, as plain text, from an export whose file carries the fakes — a
passage copied off the reader and pasted into the drafting model took "Helen
Rasho … Quillmark Holdings" out with it. With Show fakes on the plain text
was clean and the HTML flavour was not: Chrome serializes each `.pn` with its
attributes, so every `data-real` rode along unseen. Now `copy`, `cut` and
`dragstart` on the document call `copyOfSelection`, which takes over wherever
the selection reaches a page (a box's own text, the PDF pane and a page
swapped for its PDF page copy as the browser copies them — the filing,
which is how a page is transcribed by hand), and the clipboard gets
`text/plain` alone: what the file says, run forward as the print and the
screenshot run it, whichever way the toggle sits. It is never the
selection's text run forward on its own: `citedNameSpans` spares a cited
decision's party only where the citation after the name is in the text it
reads, so "As this Court held in Varnell v. Ostrow Freight" — a selection
that stops before "(2019) 31 Cal.App.5th 200" — read alone fakes both
parties, a decision that does not exist pasted into the draft. Each page the
selection touches is read whole instead (`copyOfBody`):
`TD.serializeHeld(body, { mapped: true, points })` gives the disk text, its
spot keeps and fakes, and where the selection's two ends stand in it (`at`:
a text node's offset, an element boundary found by the walk's `child` hook,
and a point inside a `.pn` taking the span whole, its start for a start point
and its end for an end one); `forwardSwaps` fakes the page as the save reads
it (keeps masked, spot keeps and fakes blanked, cited parties spared) and
`TD.clipText` cuts the stretch out, a swap the stretch reaches written whole
(half of "Helen Rasho" goes as all of its fake) and the gutter's text left out
on a numbered page, where the stylesheet keeps it out of the selection.
Pages are joined with a line break. A page shown ⇄ Raw is cut out of
`rawPageText` (which now gives the fakes' places, `pns`, too) at the
selection's offsets in its `pre`, by `Range.toString()`, and goes whole if
the sheet is a beat behind the text. Undecided names standing in the clear
are faked (the screenshot's rule, not the save's, which leaves them for the
walk): the clipboard leaves the room. A name the key holds only an
instruction for (no fake) went as it stands, with a toast naming it after it
had left; it is withheld now, as in the print and the screenshot
(`egressSwaps`, and the toast names it from the swaps' `withheld`). A cut follows the
browser's own: read-only, it does nothing at all (Chrome writes no clipboard
there); in ✎ Edit the selection must begin in an editable page, the faked
text goes on the clipboard and `execCommand("delete")` takes the selection
away — which, like Chrome's `deleteByCut`, takes only the first page's part
of a selection running on into the next. That deletion fires `input` but not
`beforeinput`, so the cut asks the beforeinput handler's questions itself:
the gutter guard, `shotPut`, and `snapshot(body, true)` for one undo step. A
drag is the selection's where it starts on a Text node or on an element the
selection holds any of (`sel.containsNode(target, true)`). It first took only
a Text node, on the reading that a drag of the selection starts on its
words; but Chrome drags the selection wherever the press lands inside it,
and the drag's target is whatever the press hit — the `.line` past a line's
last word, the `.page-body` under the text, a line's `.lt` margin, a
citation link of the link layer under a Ctrl+A. Pressed and dragged at a
grid of points over a selected page, 2,027 of 2,087 drags started on such an
element and went out as Chrome's own, the real names in text/plain and every
`data-real` in text/html; every one of those elements is one the selection
holds. A link the selection does not reach drags as the link — unless its
address carries a real name the file holds as a pseudonym (`veiledUrls`, below).
A picture the
selection holds is no exception: pressed on an `<img>` in a selected line,
held 0 to 400 ms before the pointer moved, Chrome dragged the selection
from it every time (target the `<img>`, the real names in the text), so
sparing pictures, as the review proposed, would have kept the leak; one
outside the selection drags as itself. The cost is one forward pass per page
the selection touches — the save's own pass, named `copying the selection in its
pseudonyms` for the hold report; Ctrl+A over 200 pleading pages (810 KB, a
name and a cite on every line) copies in about 125 ms. What the reader puts out it can take back
(`lastCopy`, `ownCopy`): a paste in a page whose `text/plain` is exactly the
last text this reader wrote (newlines folded, under the same case's key —
`PK.sameCaseKey`) gets the real names back, which `convertTypedRealsSoon`
marks as pseudonyms as it marks any typed real, so a cut and paste writes
the bytes it wrote before; plain fakes pasted into a page would show the fake
where the name was, and a word of one the key binds would be faked inside
it by the next save. Find gets what the screen showed (`shown`), since Find
finds what the screen shows. No other box does: a real name pasted into a
LEAKS answer would be a real value written into the worksheet as a
replacement.

**A citation link built from names the file does not carry** (`veiledUrls`,
`veiledLinkAt`, `selectionHoldsVeiled`, `veiledLinkNote`). The citations are
found in the pages' SHOWN text (`flatten`), so with Show fakes off a citation
whose parties the export holds as pseudonyms — this case's own prior appeal,
which PDF-Linker fakes as the caption (`_side_is_trusted`) — gets an `href` and
a `title` built from the real names
(`…pdsearchterms=Rasho%20v.%20Quillmark%20Holdings…`). The click is the
operator's own lookup, in the operator's browser, and opens that. But the
drag handler let a link the selection does not reach go as itself, and it went
with that address in text/uri-list and text/plain and the title in its
text/html; the browser's "Copy link address" put the address on the clipboard;
and the § Authorities panel, filled from the same reading, carried the same
address and the names as its entry's text to a drag or a copy of the panel
(measured on 6303b39, and so on main, which had no drag handler at all). Now
`placeCitationsNow` notes where a pseudonym span shows a name other than its
fake (a binary search over those places per citation) and lists the address of
every citation that reaches one. A drag of such a link (an underline or a panel
entry) is refused, so is the browser's context menu on it (the keep menu, whose
listener runs first, still answers where it does), and a copy or drag of a
selection off the pages that takes in such an entry puts nothing on the
clipboard; each says why in a toast. A published decision's parties (the same
in the file), a spot keep, and every link with Show fakes on (built from the
fakes) go as before. Measured in Chromium: the prior appeal's underline drag
refused with Show fakes off and dragged as its pseudonyms with it on, its
context menu refused, a published decision beside it dragged and offered as
before, the panel's text copied to an empty clipboard and its entry's drag
refused.

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

Find's bar has a second row, Replace (`#fb-replace-row`, Ctrl+H). Replace
works on the page bodies on screen. With a case folder open in full
(`folderOpen()`), Replace all also replaces on shadow pages in every other
export that has a hit, and leaves each document it changed unsaved in the
store (`unsavedDocs`) until Save writes it. This reverses the earlier rule,
"it edits only the page bodies in the DOM; the folder is never written from
the bar", at the owner's direction. What still holds is that the bar writes
no file: Save is the only thing that writes an export. The store, the shadow
pages, the folder save and the undo journal are in `Design Notes/Unsaved
documents and the folder save.md`. `planReplace` maps a hit (`[start, end)`
of `flatten(body, { blankGutters: true })`) onto one part per line, skipping
the gutter spans, and returns null for a hit that covers only part of a
`.pn` or `[data-here]` span, or some but not all pieces of a name wrapped
across lines (`data-piece`). `applyReplace` deletes each part with a DOM
Range, last line first, trims the head of a continuation line, empties the
`.gs` of a numbered line it leaves blank, and puts the replacement in as a
plain text node; `settleBody` then runs what typing runs on the page
(`normalizeLines`, `convertTypedReals` quiet, `dressColumns`), and on screen
the bookkeeping follows: `syncSpots` whenever the page holds a `[data-here]`
(a replace can add or take away an earlier occurrence and move a spot's
ordinal), and `setDirty`. Replace all plans every hit before changing
anything (`planHere`), snapshots every page it touches under one `batch` id
(`snapshotPages`), so `stepHistory` undoes and redoes them as one step, and
applies each page's plans last first (`applyHere`) so the earlier hits' nodes
and offsets still hold. Match case (`#fb-case`, Alt+C) is
`buildFindMatcher(values, { caseSensitive })`, which drops the `i` flag;
`findMatcherFor` is the one place the page, the folder scan and Replace get
their matcher, and the folder scan's `findScanFor` carries the flag so a
toggle reads the folder again. Find looks for the query as typed in the text
as the screen shows it, never for the key's other face of it: the page is
read off the DOM, and the folder scan reads each other export PAGE BY PAGE
through `findPagesOf`, which is `TD.shownPages`: each page's lines as the
file has them with Show fakes on, and translated through `rev` page by page
(the run `buildBody` lays out) with it off, the margin numbers blanked. So a
real name with Show fakes on is hit only where it stands unfaked, and a
pseudonym with it off only where the key leaves it standing (an ambiguous
fake). Counted per page, a page header, a DOCUMENT banner or a margin number
is never a hit and a phrase is never counted across a page break, so the
folder's count is what Replace all replaces plus what it leaves standing (the
whole-file count used to differ on all three). Each document counts once:
the reel's members on the page only (`TD.splitFolderRows(findRows, onReel)`;
`findRest` used to drop only the open file, and counted a hung member twice),
and `Combined Text.txt` apart (`findCombined`, "left to PDF-Linker"). A
document with unsaved edits is read from the store (`readDoc`). The pages are
kept in `findShown` per file handle, by stamp (`fileKeyOf`, or
`unsaved:<seq>` for a stored document), and dropped when `rev`, `folderDocs`
or Show fakes changes: a pass of the key costs about 200 ms a megabyte under
a 3,000-name key, and the folder is asked again at each word typed.
`findScanFor` carries the view and `unsavedSeq`, and a scan whose question
went stale while it ran (`findScanStale`, the view or the key turned, the
store changed) starts again rather than keeping counts that would walk into
documents with no hit on screen; `findScanDone` names the question whose
count `findRows` holds, which is what `awaitFolderScan` waits for.

**Ctrl+Z on a decision** (`asDecision`, `decisionState`, `stepDecision`,
`decisionLabel`, `textdoc.decisionDelta`, `textdoc.applyDecisionDelta`), at
the owner's direction. The undo history held page snapshots only, so a flag,
a phrase, a keep, a "fake it" and a LEAKS answer were taken back only by
finding the value in a list. Each decision function is now its own name over
a `…Now` body run inside `asDecision` (`flagSelection`, `markPhrase`,
`unmarkPhrase`, `setKeep`, `settleName`, `decideLeak`, `acceptLeak`, and the
Flagged list's ×), which reads the decision state before and after —
`flagged`, `phrases`, `keeps`, `settled` and the worksheet rows' `[fix, ok]`
— and pushes `{ decision: { label, delta, store, sheet } }` onto `undoStack`
where anything moved; a decision inside another is the outer one's
(`deciding`). The delta holds only what moved, by value (by row for the
worksheet), and an undo moves those back over the state as it NOW stands, so
a value adoption merged in from the file since, or a keep the folder's
reading settled, is not undone with it. `stepHistory` pops a decision step
before any page logic; `stepDecision` refuses one taken on another case's
list (`store`, `flagsFor`) or a worksheet no longer attached (`sheet`) and
drops it, sets each row's `fix`/`ok` back and lets `moveLeakKeep` put its
mirrored keep and `leaks.mirrored` right, settles once (persist, compile,
re-mark, repaint), sends the review back to an answered row it took back
(`goToLeak`), and says what it did. `reelShift` and a member's shed pass over
decision steps, which name no page. The page lists (⊘ Did not OCR, ↻ OCR This
Page, ✎ Use my text) are not decisions here: a strip and its put-back stay page
steps as before. Checked in Chromium (Playwright, not committed): a flag and a
LEAKS answer undone and redone, the review back on the row.

**A typed real name, and only a typed one** (`convertTypedReals`): the
debounced converter marks a real name standing in a page's plain text as a
pseudonym only where an edit wrote it. `buildBody` keeps the text the page
was built from as `body.__built` (the round trip is exact, so it is also the
page's disk text until something is typed), and a save sets it to what it
wrote once the file is written (a save refused on the way keeps the text from
before it; see "The typing's marks, Esc and a refused save" below).
`textdoc.typedReals` reads the page now with `serializeMapped` (the
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
one leaves it — unless it carries `data-typed`, the typing's own mark, which
counts whatever the page was built from (below).

**A typed name never reaches the file, however quickly it is saved.** The
converter was the only thing that turned a typed name into a pseudonym, and
it could be outrun or passed by. It waits 250 ms after the last key, and it
was one timer for the reader holding only the page it was last asked about;
it passes over the name the caret is still in and the one Esc dismissed at
the prompt; it reads a text node at a time, so a name typed or pasted across
a line break is not one it can see. `saveDocument` serialized the page as the
typing had left it, wrote such a name in the clear as "not yet reviewed",
and then set `__built` to the text it wrote, so the name was the file's own
from then on and never typed again. Two worse cases came out of the same
gap. A party marked at the Space prompt and typed on into a whole citation
("See Jones" — Space — "v. Smith (2019) 30 Cal.App.5th 1.", Ctrl+S inside the
wait) was written as "See Pratt v. Smith", a renamed authority, and the
`__built` reset made the mark permanent. And a converter run overdue by the
time the save had read every page landed inside `await writeText` (a
permission asked, a picker, a slow synced folder): the page showed a
pseudonym where the file had the name, nothing was dirty, nothing was orange
and the tab closed without asking. Checked in Chromium on the old build:
each of these wrote the real name or the renamed cite. Now:

- The save cancels every page's wait and runs the converter (`quiet`, its
  `tally` counting what it did) on every page of every edited member before
  it reads a page, so a mark now standing in a cited name goes back first
  (`typedPseudonymsCited`). Then, of the names its own reading finds standing
  (`standingSpans`, a name wrapped over a line or down a column one hit),
  `TD.typedSpans` gives those an edit wrote — something of the edit in a piece
  of it, measured against `__built` as it stood before this save (a rebuild
  replaces it), outside every `citedNameSpans` read with the fakes standing,
  as `typedReals` reads it — and they go into the forward pass rather than
  into `left`: written as pseudonyms, not named as unreviewed. A typed name
  the key holds only an instruction for has no pseudonym to go as, so it is
  not left either: the last check refuses it, with `instructionNote`. Only
  a member that is dirty is asked; the rest have nothing typed. The caret
  and a line break are exceptions of the screen, not of the file, and after
  the save the page shows the pseudonym span the file carries. Esc was made
  one too, the guide then promising "the save still writes its pseudonym";
  that is reversed — Esc leaves the name in the file as well (below).
- One timer per page body (`debounceEach`): typing on page 2 inside the wait
  no longer throws page 1's away, and an undo, a strip or a put-back cancels
  its own page's wait only.
- A page whose name the converter passed over for the caret is remembered
  (`caretHeld`); `selectionchange` and `focusout` ask again a beat later, and
  a page that has lost the focus has no caret in it whatever the selection
  says (`body.contains(document.activeElement)`), so "a name typed and left
  is marked once the caret has moved off it" holds before any save — a click
  away, the arrow keys, the Find box. The same wait means "Helen" on its way
  to "Helen Rasho" is not marked in pieces.
- A converter hit that is a piece of a name wrapped over a line break
  (`standingSpans`, read once the first hit is about to be marked) is left
  for the save. Pasted out of the filing as "Served on Helen" / "Rasho by
  mail." under a key binding "Helen Rasho" and the surname token, the
  converter marked "Rasho" alone and the file read "Helen / Strangeways", a
  name half faked with "Helen" bound nowhere to mark it — a quarter second
  after the paste on the old build, and at once had the save's own converter
  run done it. Now it stands orange and the save writes "Ingrid /
  Strangeways", one name dealt over its pieces.
- The page the save rebuilds keeps its caret (`caretPoint`,
  `placeAfterSwaps`, `placeCaretOnDisk`), read as a place in the DISK text
  since a name and its pseudonym differ in length with Show fakes on. It used
  to go to the head of the page, where the next key landed; a save after a
  decided name did that before, a save while typing a name does it now.
- After the writes, a written page whose text is no longer what was written
  stays dirty, so a key typed during the write is not taken for saved.
- `fakesForPrint` keeps each page's `__built` and `pagesBackAfterPrint` puts
  it back with the nodes. It was left at the faked text, and every name the
  print had faked then read as typed: the converter marked the run's
  undecided leftovers on the next keystroke on that page, and the save would
  have written them.

The cost is the converter's pass on the pages that were typed on (a page
whose text is still `__built` returns before reading anything) and one
`editedSpans` per page of an edited member with a name standing on it, which
returns at once where the page is as it was built. A 200-page pleading
export under a 62-name key, one page typed on, saved in the same time as
before (6.9 s and 6.9 s from Ctrl+S to the write, the rest of the save being
what it was).

**The typing's marks, Esc and a refused save.** A review of the change above
found three ways it still let a typed name through, each checked in Chromium
on that build:

- *A save before the citation was finished made its mark permanent.* "See
  Jones" saved with the caret still at its end (or after a pause, or inside
  the wait) went to the file as "See Pratt", which is right — nobody can
  tell yet that it opens a citation. But the save rebuilt the page from the
  text it wrote and set `__built` to that text, and `typedPseudonymsCited`
  told the typing's marks from the page's own by `__built` alone: the
  " v. Smith (2019) 30 Cal.App.5th 1." typed after the save left "Pratt"
  standing in it, and the next save wrote "See Pratt v. Smith" with a toast
  that said only "Saved". The parent build had left "Jones" in the clear at
  the first save, named in red, and its second save was right. A name marked
  at the Space prompt or by the converter and then saved did the same before
  either change; the save had become one more way to mark it. Now every mark
  the typing makes carries `data-typed` (`acceptTyped`, `convertTypedReals`),
  and `typedPseudonymsCited` counts a span carrying it as the edit's whatever
  `built` says. The save's forward pass, rebuilding a page, finds the
  flagged marks again in the rebuilt page — by where each fake begins in the
  text written, carried over the names the pass writes (`placeAfterSwaps` of
  its offset in `serializeMapped`'s `pn`) — and flags the marks it writes for
  a TYPED name (`TD.typedSpans`) the same way; a mark it writes for a name the
  run left and the review settled is not the typing's and is not flagged. An undo builds from
  text and dropped the flag, as an undo that restores a mark leaves it — which
  is how one Ctrl+Z after a save, or of an unrelated typo, let the renamed
  authority through after all; it now carries the flag (and `__built`, and the
  Esc'd names) with its snapshot ("What was typed survives an undo", below).
- *Esc protected nothing in the file, and the prompt still said "Esc leaves
  it".* Where it matters is a citation the reader does not read as one. A
  short cite with no "supra" — "(Jones, 30 Cal.App.5th at p. 5.)" — is
  protected by PDF-Linker (`_pn_short_cite_follows`: the name, a comma, then
  the volume, reporter and "at" pin of the decision's own cite) and not by
  `citedNameSpans`, which returns nothing for it. The operator presses Esc
  because the name is a cited decision's, and the save wrote "(Pratt, 30
  Cal.App.5th at p. 5.)", a renamed authority, under "1 real name written as
  pseudonym"; the parent build left "Jones" and named it in red. The project
  ranks a renamed authority above an ordinary, visible leak, so the save now
  honours the Esc: the name ending where Esc was pressed (`typeDismissed`,
  found as a DOM point with `pointAtOffset`, read into the disk text as one
  of `serializeHeld`'s points, and carried over the names the pass writes) is
  left out of the typed set — one place, which "Every Esc is kept, by place"
  below replaced with every Esc'd name. It waits like any name nobody has
  decided: it stands in the file as typed, orange on the page, named in red
  by the save as not yet reviewed, asked about at the tab's close, and the
  review's to decide. The prompt says so ("Esc leaves it as typed, in the
  file too"). A name the review has already settled is written as its
  pseudonym all the same, as before either change: the answer covers every
  occurrence. The converter skips the same place, so the screen and the
  file agree.
- *A refused save's retry wrote what the first refused.* A typed name the key
  holds only an instruction for is refused by the last check; beside it, a
  typed name the pass wrote made the pass rebuild the page, and `buildBody`
  set `__built` to the pass's text. The refusal left that standing, so the
  next Ctrl+S found nothing typed on the page: the instruction's name fell
  back to "not yet reviewed", was blanked out of the last check, and was
  written in the clear ("Served on Quentin Vole and Ingrid Strangeways"). The
  pass now puts `__built` back to the text from before the save right after
  its rebuild; the write sets it to what it wrote, as it did, and a refused
  save leaves the edits measured from where they began. The same reset is
  what made a refused or cancelled save's marks the page's own.

Checked in Chromium, each failing on the build before and passing after: a
party saved with the caret at its end, the citation finished and saved (after
a pause, and inside the wait); a Space-marked party carried over a save that
rebuilt its page for a name typed on the next line, then cited; a party the
converter marked when the focus left, saved, then cited; Esc on "(Jones", the
short cite finished and saved (the file keeps "Jones", the toast names it in
red, the page keeps it orange); Esc, a save mid-citation, the citation
finished and saved; Esc on a name after a wrapped name the pass writes on the
same line (its place moves); an instruction-only name refused, refused again,
then deleted and the rest saved. `test-textdoc.mjs` pins `data-typed` in
`typedPseudonymsCited`.

Not done: `citedNameSpans` does not read the short cite with no "supra" that
PDF-Linker protects, so such a name typed and NOT dismissed is still marked
by the converter and written as its pseudonym, and one the run left in the
clear there is orange and, once settled, written over; matching PDF-Linker
needs its reporter list, a matcher change of its own to be measured under the
hang rules. (Since done: "The short cite with no supra is read", below.) An undo or a key change rebuilt a page from its text
(`restoreSnapshot`, `retranslate`), resetting `__built` and dropping
`data-typed`; both now carry what was typed ("What was typed survives an
undo", below). A member the reel sheds and builds again (`unshedMember`)
still loses its flags: it is shed only once saved, and its pages are built
from the file's text, so a mark typed and saved before its citation was
finished is the page's own when the member comes back, and a citation typed
round it then is written with the pseudonym in it. The Space prompt reads the
line it is on, so a surname typed at the head of a line under a given name on
the line before is offered, and marked, alone.

**What was typed survives an undo** (`typingOf`, `restoreTyping`, the
snapshot's `built`, `typed`, `left` and `esc`; `retranslate`; `data-left` in
`TD.typedPseudonymsCited`). Three things say which of a page's names the
operator wrote, and none is in its text: `__built` (what `TD.typedSpans` and
`TD.typedReals` measure an edit against), `data-typed` on the typing's marks,
and the Esc'd names. `restoreSnapshot` built the page from the snapshot's text
alone, which made `__built` that text and dropped the rest; the save's forward
pass is an undo step (`snapshot(body, true)` before its rebuild), so one Ctrl+Z
after a save broke three guarantees the User Guide gives. Measured in Chromium
on 6303b39 (`attack.mjs`, `attack2.mjs` of the final review): a name typed and
saved at once was written as its pseudonym, Ctrl+Z took the save's marking
off, and Ctrl+S wrote "Served on Helen Rasho" over the pseudonym already in the
file, saying in red that it "stands in the file as it did"; a save refused for
a typed name the key holds only an instruction for, Ctrl+Z, Ctrl+S wrote it and
the other typed name in the clear; "See Jones" Space-marked and saved, " x"
typed on another line and undone, then "v. Smith (2019) 30 Cal.App.5th 1."
typed and saved wrote "See Pratt v. Smith (2019) 30 Cal.App.5th 1." under a
plain "Saved", a renamed authority. And a name typed before the key was loaded
(`retranslate`) was written in the clear as "not yet reviewed".

Each snapshot (`snapshotOf`, so `snapshot`, `snapshotPages` and the other
stack's step in `stepHistory` alike) now carries the page's `__built`, the
places in its own text of its `data-typed` marks, and its Esc'd names (their
places noted by `escNote` first), and `restoreTyping` puts all three back once
`buildBody` has built the page from the same text: `__built` as it stood, the
flags on the marks at those places, the Esc'd names found again exactly there.
`putStrippedBack` (↻ OCR This Page from a strip of the reader's own) does the
same with the strip's step, and `retranslate` with the page as it stood, since
the file's text and what was typed into it are the same under any key. So the
page after an undo is measured, marked and Esc'd as it was when the step was
taken, and a redo brings back what the undo left. Putting `__built` back would,
alone, have turned an Esc'd short cite's party deleted and put back by Ctrl+Z
into a typed name, written as its pseudonym — "(Pratt, 30 Cal.App.5th at p.
5.)", where the old undo left it as the page's own; the Esc'd names coming back
with the step is what keeps it as typed (measured: Esc'd, the cite deleted,
Ctrl+Z, Ctrl+S writes "(Jones, …)" and names it in red; with the Esc'd names
left off the step, "(Pratt, 30 Cal.App.5th at p. 5.)" under "1 real name
written as pseudonym").

The one rule an undo kept by dropping the flags was the guide's "Ctrl+Z puts
the mark back": a party marked at the Space prompt and put back as the name
once its citation was typed (`typedPseudonymsCited`) came back as a mark, and
an undo that restores a mark leaves it. With the flag and `__built` restored,
that mark is the typing's and stands in an edited place, and the next pause or
save put it back again (measured: "See Pratt v. Smith" on the baseline, "See
Jones v. Smith" with the flags alone carried). So the put-back's own step
records which marks it took out (`left`), and `restoreTyping` gives each of
them `data-left`, the operator's: `TD.typedPseudonymsCited` passes over it
however the page reads, `typingOf` carries it, and the save's forward pass
flags it again after a rebuild as it does `data-typed`. Checked in Chromium,
each failing on 6303b39 and passing after: the three of the review, the key
loaded after the typing, and undo, redo and undo of a save. Each as on
6303b39: an Esc'd cite deleted and undone, and one with an unrelated edit
undone (both keep "(Jones, …)" and name it in red); the page's own undecided
name deleted, saved and undone (back in the clear, named in red, not faked);
and "Ctrl+Z puts the mark back" ("See Pratt v. Smith", an unrelated edit
undone after it too). `test-textdoc.mjs` pins `data-left`.

**Every Esc is kept, by place** (`escaped`, `escapeTyped`, `escapesIn`,
`escNote`, `escFindAgain`, `TD.withoutEscaped`; `TD.escapedPlaces`, since
replaced by `TD.escapedPlace`: "Found again by what moved it", below). The
change above remembered ONE dismissal, `typeDismissed`, as an offset into the
page's text, compared by its end alone. A review measured in Chromium what
that let through: two short cites in a row, each Esc'd — "(Jones, 30
Cal.App.5th at p. 5.)" and "(Vance, 31 …)" — and the second Esc replaced the
first, so the converter's next pause marked Jones and the save wrote "(Pratt,
30 Cal.App.5th at p. 5.)", the renamed authority the Esc was for, naming only
Vance in red; one Esc'd and "Also, " typed at the head of the page, and the
offset no longer reached the name: the same "(Pratt, …)" under a plain
"Saved". A different name retyped to end at the dismissed place (Jones
deleted, Vance typed) was taken for the Esc'd one and written as itself.

Now each Esc is kept, per page body (a WeakMap, reset as a document opens), as
a live `Range` over the name as typed, with the name and its key value. The
browser carries a Range with its text node — text typed earlier in the node,
a mark cut out beside it, `normalize` merging nodes — so typing elsewhere moves
nothing it does not move. Text typed against the name's front grows the Range
over it ("See Jones"), and `escState` cuts it back (where what was added ends
at a word boundary, as first written; glued or not since "Found again by what
moved it" below); letters typed into the name, or deleted from it, leave no
Esc'd name there ("gone"), and the prompt offers it afresh. What takes the
nodes away — Enter, Backspace and Delete moving lines (`enterAtCaret`,
`backspaceAtCaret`), a paste laying lines (`insertLinesAtCaret`), a rebuild
(`buildBody`), a print or a screenshot writing fakes into the nodes — first
notes each name's place in the page's DISK text (`escNote`); a rebuild that
writes names before it carries the place with the text (the save's forward
pass hands `buildBody` its `placeAfterSwaps`). A name whose nodes went is
found again there: exactly, after a rebuild or a print or screenshot put back
(`escFindAgain`), else — as this paragraph was first written — at the nearest
whole-word occurrence of the name anywhere on the page (`TD.escapedPlaces`),
passing over places another Esc'd name holds, nearest with no limit, and a
name not found was kept, its place noted, for any later occurrence. Both
halves of that were wrong (Enter's collapsed Range read as typed over, and a
deleted name taking the next one typed), and "Found again by what moved it",
below, replaces them: the reader moves a name with its node, the browser's
edits are settled one at a time, and a name is looked for only in the text
the edit that took its node wrote. The converter skips a hit whose node and offsets are an Esc'd
Range's exactly; the save reads every Esc'd name into the disk text as a pair
of `serializeHeld` points and leaves out of `TD.typedSpans`' answer the typed
spans that are EXACTLY one of them (`TD.withoutEscaped`) — a longer name ending
at the same place ("Bob Jones" over an Esc'd "Jones") or one wrapped over lines
is not the name dismissed. While a print or a screenshot has the fakes on the
page, nothing is dropped or moved: the names are put back the moment it ends.

Measured in Chromium. Failing on the build before and passing after: the two
short cites, each Esc'd (both keep their names, the toast names both);
"Also, " typed at the head of the page after an Esc; Jones Esc'd, deleted and
Vance typed in its place (Vance marked and written as Corbin); an Enter above
the Esc'd name, two lines pasted above it, "See " typed against its front, the
line it is on joined to the one above with Backspace; two Esc'd short cites to
the same Jones moved by a cascade beside a Jones typed as this case's party
(the cites keep Jones, the party goes as Pratt); and the name's letters typed
over (offered again). Passing before and after: a print and a screenshot
between the Esc and the save, and a save that rebuilt the line for a typed
name before it, then a second save. `test-textdoc.mjs` pins `withoutEscaped`
and `escapedPlaces` (now `escapedPlace`, below).

**Found again by what moved it, and nowhere else** (`escHold`, `escCutAt`,
`escCarry`, `escSeen`, `escapesIn`'s `after`, `TD.escapedPlace`). The final
review of the paragraph above measured two ways it still failed, in opposite
directions, on b6d82a6 (and the first on c528313 and main too):

- *Enter, or a two-line paste, at the head of the Esc'd short cite's own line
  renamed it.* `enterAtCaret` and `insertLinesAtCaret` take the text after
  the caret with `extractContents`, which CLONES the text node the caret
  stands in for the text after it and leaves the original the text before:
  the name's Range, in that original, was clamped to {0,0}, `escState` read
  "" there as the name typed over ("gone"), and the entry was dropped. The
  converter then marked "Jones" and the save wrote "(Pratt, 30 Cal.App.5th at
  p. 5.)" under a plain "Saved Doc.txt" — at the head of the line, with the
  caret between "Nothing else." and the cite, and with "Smith was served."
  and a line break pasted there — while the User Guide said the name went
  with its text through Enter.
- *A deleted Esc'd name took the next one typed, anywhere.* Its line selected
  (Shift+Home) and deleted with Backspace or Ctrl+X, the node went, the entry
  read "lost", and `TD.escapedPlaces` took the nearest "Jones" on the page,
  with no limit, whenever one appeared: "Jones was served." typed on line 1
  as this case's party was offered nothing, the converter skipped it, and the
  save wrote it into the file as itself, saying it "stands in the file as it
  did". c528313 and main offered the prompt and wrote "Pratt was served."

Now each way a name's nodes go is followed by what took them:

- The reader's own line moves carry the name by its NODE. `extractContents`
  moves a node it holds whole — the same node, into the line it is put in —
  but a live Range on it collapses the moment the node leaves its parent. So
  before the move `escHold` holds each live name's text node and its offset
  in it, and where the page has Esc'd names `escCutAt` splits the caret's
  text node at the caret first (a name held in its second half is held in
  the new node) and starts the extraction between nodes, so everything after
  the caret moves whole. After the move and the dressing (`dressBody`,
  `fixGutterSpacing`) `escCarry` finds each name in its node: where the
  node's text begins in the disk text (`serializeMapped`'s `at`) plus the
  offset, which holds even where `dressColumns` split the node into a column
  cell, since the halves stand together in the text. `enterAtCaret`,
  `insertLinesAtCaret` and `joinLineUp` (Backspace at a line's start, Delete
  at its end) all do this. A page with no Esc'd name is not cut: its moves
  extract exactly as before.
- The browser's own edits are settled ONE AT A TIME. `beforeinput` notes
  every name's place and the page's disk text (`escNote`, `escSeen`, marked
  `noted`), and so do the cut handler and the paste handler before their
  `execCommand`, which asks no `beforeinput`; the `input` event that follows
  settles them (`escapesIn(body, { after: "edit" })`) before anything else
  reads the page. A name whose node the edit took is asked of
  `TD.escapedPlace`, which compares the text before and after by the head and
  tail they share: a name wholly in what the edit left alone is the same
  characters, at its place moved by what was written before it; a name the
  edit reached was written over or taken out — deleted with its line, cut,
  typed over, a letter glued to it — and the entry goes with it. A cross-line
  delete on a page with no numbers, where Chrome rebuilds the second line's
  rest into the first, leaves the name in the shared tail, and it is carried.
  (Not where the deleted text repeats what stands beside the name: there the
  shared head ran into the name and the entry was dropped — "An edit that
  slides is unsure", below.)
- Anything else that takes a node without a note (nothing known does; a
  script moving one stands in for it) is asked the same question, but cannot
  tell a move from a deletion: where the change reached the name, EVERY
  whole-word occurrence of it in the text changed since the note is left as
  typed, each its own entry marked `unsure` (so is a reader move whose node
  did not carry the name), and the save adds to its red warning that the
  name was left as typed in N places because an edit moved it where the
  reader could not follow — check each, retype one that is this case's own
  and it is offered again. Where the changed text holds none, the name is
  gone. That is the direction the project ranks right: a name left as typed
  is a leak the save names, the party of a short cite written as its
  pseudonym a renamed authority.

`TD.escapedPlace` is bounded by the edit: an occurrence the edit did not
write is one the operator never pressed Esc on, however near, and it is never
taken for the Esc'd one. That holds because the settling is per edit — two
edits read as one (the deletion, then "Jones" typed on line 1) would span the
text between them, which is why the `input` event settles each before the next
can come. Each pass of `escapesIn` notes the live names' places afresh in the
text as it stands, so a name whose cells were laid again (`recolumnSoon`: the
nodes went, the text did not) is found at its place exactly, and a place
whose name the converter marked beside it moves by the mark's length.

Reading the names after every keystroke showed what reading them only when a
pause or a save asked had hidden: "See " typed before an Esc'd "Jones" passes
through "SJones", which `escState` read as the name typed over, and the save
wrote "See Pratt, 30 Cal.App.5th at p. 5." (`escmore.mjs` of the earlier
review). A Range grown by typing against its front is now cut back to the
name whether or not what was added ends at a word boundary: the same letters
at the same place are the name Esc was pressed on, and a hit the converter or
the save reads there is only ever the whole word (typing glued to its end
never grew the Range: the DOM moves a Range's end only past an insertion
strictly inside it).

Measured in Chromium. Failing on b6d82a6 and passing after: the review's
three Enter and paste cases (`esc-enter2.mjs`, `esc-enter.mjs`,
`esc-paste.mjs`) — the file keeps "(Jones, …)" and names it in red; the
line selected and deleted or cut, then "Jones" typed on line 1
(`esc-lost3.mjs` Backspace and Ctrl+X, `esc-lost.mjs` line-select-backspace
and cut) — offered "Pratt" and written as it, under a plain "Saved"; Enter
with the caret on the name's first letter; two Esc'd cites on one line with
Enter between them, then at the head of the page ("(Corbin, 31 …)" before);
Enter at the head of the cite's line on a page with no numbers, then a
selection from line 1 into line 2 deleted (Chrome merges the lines); three
lines pasted into the middle of the cite's line before it; Enter, Ctrl+Z,
Ctrl+Y. A node moved by script with "Jones was served." typed on the last
line keeps the cite's "Jones" and writes the party as "Pratt" both before
and after, and now the toast says the Esc could not be followed (before, the
nearest occurrence was taken, saying nothing). Passing before and after:
Backspace and Delete joins of the cite's line (`esc-key.mjs`, `esc-del.mjs`),
the other deletions of `esc-lost.mjs` and `esc-lost2.mjs`, Enter inside the
name (the halves are no name; "Jones" typed after is offered), Ctrl+X of
words before the name on its line, a deletion of its line undone, a cite
on a line laid in columns with Enter above it, and, on a page with no
numbers, a selection from line 1 into the cite's line deleted (the cite's
line merged up, then "Jones" typed below written as "Pratt"). The earlier reviews' scripts
(`escmore.mjs`, `escmore2.mjs`, `more.mjs`, `during.mjs`, and a37's
`attack.mjs`, `attack2.mjs`, `checks.mjs`, `fakes.mjs`, `undo-more.mjs`,
`x1b.mjs`, `x2.mjs`, `x2b.mjs`) give the same output as on b6d82a6, "See "
typed before the name included once `escState` was changed as above.
`test-textdoc.mjs` pins `escapedPlace`.

Left as it is: an Esc'd name cut and pasted elsewhere is a deletion and then a
name typed — the clipboard carries no Esc — so it is offered at the paste and
marked by the converter, as on main. (Since changed for the reader's own
copy: "…and carried through the reader's own cut and paste", below.) An `unsure` place is left as typed until
it is retyped; Esc cannot be taken back at it, since the prompt does not show
on an Esc'd place.

**The short cite with no supra is read** (`TD.citedNameSpans`,
`shortCiteNames`, `SHORT_TAIL_RE`, `SHORT_NAME_RE`). The last review of the
Esc tracking (0b35064) found three high-severity ways an Esc'd short cite
still went into the file as "(Pratt, 30 Cal.App.5th at p. 5.)" under a plain
"Saved", and one — a cite the FILE already carried — that predated the Esc
work altogether. Every one was a short cite with no "supra", and every one
needed the reader to follow an Esc, or to measure what was typed, through an
edit it could not measure exactly. The root of it is that the reader did not
know the cite was a cite. PDF-Linker does (`_pn_short_cite_follows`,
`_PN_SHORT_CITE_TAIL`: the name, a comma, a volume, a reporter, an "at" pin),
so the reader now reads it too, and the party is spared wherever it stands
and however it got there — typed with or without Esc, pasted, carried over a
line Chrome merged, or carried by the file — with no Esc to follow at all.

What is read, after the name and ", ":
- a VOLUME and a REPORTER from `reporters.js` (the citation linker's list,
  ported from PDF-Linker's `REPORTERS_RAW`), then a pin ("at p. 5", "at pp.
  5-6", "at 5") or a page ("30 Cal.App.5th 1", "30 Cal.App.5th, 5"). The
  reporter is what makes it a citation: "Jones, 2019", "DOES 1", a docket, a
  date ("12 March 2020") or a street ("30 Main Street") is not one;
- or the bare pin "(Jones, at p. 5)", the Style Manual's short form. This one
  is WIDER than PDF-Linker, whose pin needs the reporter before it: a name the
  run left there is its review's, as before, and the reader spares one typed
  there because faking it renames the authority, which the project ranks above
  a visible leak. With no reporter to say "citation" it is read only behind
  "(", ";" or a signal, only with "p." or "pp.", and never after a record word
  ("Jones Decl., at p. 3", "Smith Depo., at p. 12" — this case's own papers).

The span is the name alone, cut as PDF-Linker's `_pn_cite_run_start` cuts a
run read from the left: after the last citation signal ("See Jones" is
"Jones") and after the last full stop closing an ordinary word ("…served on
Helen Rasho. Jones, 30 …" is "Jones"; "Acme Corp." keeps its "Corp."). A span
too wide would spare a name of THIS case standing before the cite, unmarked
and unwarned. Residual, stated: a capitalised word opening the name run that
is neither a signal nor after a full stop ("Plaintiff Jones, 30 Cal.App.5th
at p. 5") is spanned with it — harmless unless the key binds that word too.

Under the hang rules ("Text reader hangs and freezes.md") it is FOUND FROM
THE TAIL: a global scan for ", <volume> <reporter>" or ", at p." — the
reporter alternation tried only where ", <digits> " has been read — and from
each tail the name is read backwards over a fixed window (160 characters)
with counted words, so the work is a constant per tail and the whole is
linear. Measured (`test-textdoc.mjs`): a text mixing a jurat's capitals,
near-miss tails (", 30 DAYS", "Jones, at times", "Quillmark, 12 March 2020")
and short cites reads 300 repeats in 7 ms and 1,200 in 26 ms; the jurat test
and `test-long-export-scan.mjs` are unchanged. `test-textdoc.mjs` pins the
shapes, positive and negative.

With it, the review's repros hold — the two-cite deletion across a line, the
cut and paste of an Esc'd cite, and a deletion beside a cite the file already
carried — and `test-typed-cites.mjs` (Chromium) pins them: a short cite typed
at once, after a pause (the converter's mark put back), and as the bare pin,
kept as typed; a name typed in prose, before "30 days" or in "(… Decl., at p.
3)" still faked. Each of those holds because the cite is read; the changes
below hold the same edits for an Esc'd name in a form the reader still does
not read as a citation, and that test runs them with a ", slip op." tail.

**The rest of what PDF-Linker keeps is read** (`TD.citedNameSpans`:
`NONV_RE`, `CITE_AFTER_RE`, `STRUNG_RE`, `nameRunStart`, `sideIsOwn`). The
bug search of Oct 7 measured the reader's spans against `pdf_linker.py`
sample by sample, and the harness was run again here: each name made a term
of the case on its own, PDF-Linker's output asked whether the name stood
verbatim, the reader's spans asked whether it was spared. Twenty-two of 47
disagreed. Where PDF-Linker kept a name the reader did not spare, the reader
marked a decided case's party and wrote its pseudonym at the save, renaming
a published authority. Where the reader spared a name PDF-Linker fakes, it
left this case's party unmarked and saved a typed one real. Now read:
- A matter with no " v. ", behind PDF-Linker's leads (its parser's
  `_NONV_PREFIX` and the shape guard's "In re" / "In the Matter of"): "In re
  Marriage of Hartwell (2008) …", "Estate of Bowles …", "Conservatorship
  of", "Guardianship of", "Adoption of". "Matter of" and "Ex parte" alone
  are left out, as PDF-Linker leaves them out (an owner decision there).
- A writ's real party in interest, "Rasho v. Superior Court (Quillmark)
  (2019) …": the parentheses are part of the name, and the year after them
  is the citation.
- The reporter read from PDF-Linker's whole list (`REPORTERS_ALL_SORTED`,
  the linker's list plus the compact, bankruptcy, federal-claims and
  Massachusetts forms the linker does not link), with its spaces flexed as
  `_flex_ws_reporter` flexes them: "30 Cal. App. 5th 1", "500 F. Supp. 2d
  100", "123 S. Ct. 456" were no reporter to the old shape, which read one
  capitalised word before the page. The year read as `_PN_CITE_YEAR` reads
  it too, the court before it: "(9th Cir. 2009)", "(N.D. Cal. 2007)".
- A name wrapped across a line, its gutter number between ("Rasho v.\n12
  Quillmark (2019) …"), and a cite whose name closes a page and whose year
  opens the next: every per-page reading is handed the next page's opening
  lines (`next`, `pageAfterHead`/`nextHeadOf` in the reader, the page loop's
  next page in `clearReading` and the off-screen save), joined behind a page
  header as the export prints one, with the next page's furniture stepped
  over before the year as `_PN_CITE_PAGE_FURNITURE` steps over it. Never
  across into another document of a reel.
- A STRUNG cite with no tail in reach ("…358, 373-374; Krongos v. Pacific
  Gas & Electric Co." closing a page), behind the string-cite seam as
  `_PN_STRING_CITE_SEAM_RE` reads it, its runs held to one line.
- The name cut as `nameRunStart` cuts it, for the full name, the strung
  one and the supra as for the short cite: after the last signal and the last
  full stop closing an ordinary word. "…served on Helen Rasho. See Jones v.
  Smith (2019) …" spanned from "Helen", sparing this case's party.
- This case's OWN CAPTION recited with a year, "In this action, Wrenfield v.
  Quarrow Motors, Inc. (2025)", is not a decision: both sides mostly words of
  the parties the key was built from (`sideIsOwn`, PDF-Linker's
  `_side_is_trusted` over `_trusted_party_tokens`: key rows whose Source is
  "spreadsheet" or "--term" and whose Category is a person or entity, alt
  spellings left out; `parseKey`'s `own`, set on each key compile through
  `setOwnPartyWords`). One side alone the case's is still a decision.

Three disagreements are left, each PDF-Linker's and named to its session
rather than copied: "Helen Rasho. Jones v. Smith (2019) …" with no signal
keeps "Helen Rasho" there (its stop rule asks whether "Rasho" is a word of
the language, the reader's whether it has a lower-case letter); in "In this
action, Wrenfield v. Quarrow (2025)" its defendant's half reads the lead
"In this action" into the plaintiff's side, finds it not mostly trusted and
keeps "Quarrow"; and a bare supra ("Gelman, supra, 30 Cal.App.5th at p. 5")
whose full cite is not in the same export has a term of the case faked in
it, where the reader spares it — a supra is always an authority, and the
reader does not rename one. PDF-Linker's session took the first two as its
leaks to fix (the run cut where it cannot rename an authority; the lead cut
at its last signal, stop or comma, G5j) and keeps the third, a recorded
difference: keeping the name there is in its "fakes less" group, which waits
on the owner's direction. `test-textdoc.mjs` pins every shape, the cut,
the page break and the caption, and a jurat-and-leads text read in step
with its length; `test-typed-cites.mjs` case 6 (Chromium) types each into a
document and saves: the cited party as typed, the case's own caption as its
pseudonyms, a name closing a page whose year is on the next as typed.

**An edit that slides is unsure, never a drop** (`TD.escapedPlace`'s
`unsure`; `escapesIn`). `escapedPlace` told an edit by the head and tail the
text before and after share, taking the HEAD first. A deletion of text that
repeats what stands beside the Esc'd name — "(Jones, 30 …)\nNothing else. "
deleted from before "(Jones, 31 …)", or "(Judge Whitaker so held).\nThe end. "
from before "(Jones, …" — reads the same whichever side of the repeat it was
taken from, and head first the shared head ran on into the name: "the edit
reached it", and since the edit was the browser's own (`sure`) the entry was
dropped and the converter marked the name. `escapedPlace` now tells the edit
both ways, head first and tail first; where the two disagree about whether it
reached the name, the name is UNSURE: every place either telling puts it, and
every whole-word occurrence in the widest region the edit could have written,
comes back with `unsure: true`, and `escapesIn` leaves each as typed, marked
`unsure`, which the save names in red ("left as typed in N places … cannot
tell which"), whatever `sure` says. An edit that does not slide is told as
before, exactly. `test-typed-cites.mjs` case 3, with a tail the reader does
NOT read as a citation (", slip op. 5.)"): the two-cite deletion across the
line keeps the second name with the red warning; the deletion that does not
slide keeps it with no such warning; and with the Esc'd name's line deleted,
a name typed later is offered and written as its pseudonym. `test-textdoc.mjs`
pins the two slides and the one that does not.

**…and carried through the reader's own cut and paste** (`lastCopy`'s
`esc`, `copyOfBody`, `isOwnCopy`, `escPasted`, `insertLinesAtCaret`'s `laid`).
A cut took the Esc with the name (by design: a deletion), and the paste of the
reader's own copy put "Jones" back as new text — the converter marked it and
the save wrote "(Pratt, …)"; a copy pasted as a second cite the same. The
reader knows the paste is exactly its own copy (`ownCopy`), so the copy now
notes where in its `real` text each live Esc'd name it takes stands (read into
the disk text with the selection's ends, then measured as the length of what
the copy takes before it), and a paste of that copy Esc's each one again
where it lands: in the first line at the selection's start plus its column,
in a later line at the node `insertLinesAtCaret` laid it in. Where the name
is not there exactly, each whole-word occurrence in that line is left as
typed, `unsure`. Text pasted from anywhere else is new text, offered and
marked as before. `test-typed-cites.mjs` case 4, with the ", slip op." tail:
the parenthetical cut and pasted on a plain page, and the line's text cut
with Shift+Home and pasted on another line of a numbered page, keep "(Ashdale,
…)"; a foreign paste of the name is still written as its pseudonym. The cut's
toast still says "Cut in the pseudonyms": the
clipboard carries the pseudonym for an Esc'd name, as for any real name,
since what leaves the reader is faked; only the reader's own paste takes it
back.

**Ctrl+Backspace and Ctrl+Delete keep the numbers** (`caretDeletesGutter`).
The keydown guard stands aside for Ctrl, and the `beforeinput` guard asked
only of a selection that is not collapsed, so Ctrl+Backspace at the head of a
numbered line's text deleted the word across the line break and the line's
number with it: " 2  Nothing else.(Jones, …)" and line 3's number gone (on
b6d82a6 and 0b35064). Chrome hands that deletion no target ranges
(`getTargetRanges()` is empty for `deleteWordBackward` there, measured), so the
caret is asked: a word or line deletion backward from offset 0 of a numbered
line's text, or forward from its end, is refused with the "line numbers are
fixed" toast. Mid-line the word goes as before. `test-typed-cites.mjs` case
5: Ctrl+Backspace at the head of line 3 and Ctrl+Delete at the end of line 2
are refused and said, Ctrl+Backspace mid-line deletes, and the file keeps
every number.

**What was typed is told the same way** (`TD.editedSpans`, `slidPoint`). The
save's measure of what was typed had the same head-first bias: a slide
deletion's point fell inside a name the FILE already carried, "took text out
of its middle", and the save wrote its pseudonym over a name nobody typed —
a short cite PDF-Linker shipped with its real name, under a plain "Saved"
(on b6d82a6 and 0b35064 alike). The cite is spared now
whatever `editedSpans` says, and for any other name a deletion's point is slid,
within the places that tell the same story (left while the character before
equals the last one taken, right while the first taken equals the one after),
to the first that splits no word of what is left; where every place splits
one, it stays where it was found. That is done for the trimmed edit and for
each pure deletion inside a changed line (`editHunks` places those
arbitrarily too). `test-typed-cites.mjs` case 2: "(Ashford so held).\n"
deleted from before a file's own "(Ashdale, slip op. 5.)" leaves "Ashdale",
named in red as not yet reviewed, and before "(Ashdale, 30 Cal.App.5th at p.
5.)" leaves the cite as it was; both wrote the pseudonym before.
`test-textdoc.mjs` pins it. Residual, stated: text PUT IN that repeats what
stands beside it ("(Jones agreed.) " pasted right before "(Jones agreed.)")
cannot say which copy is new, and is measured where it was found, head first:
one copy counts as typed and is written as its pseudonym, the other is left
and named in red; the reader's own paste of an Esc'd copy is Esc'd as above.

**A real name is written in the fake's case, never the key's caps**
(`pseudo-key.caseShape` / `applyCase` / `mirrorCase`, the extension's
`src/pseudo.js` #331–#334). The key stores a caption's spelling
("ZACHARY CODERRE", "CHRISTOPHER McALLISTER", "JOHN SMITH, Jr."), and the shape
read off the fake standing in the text decides how it reads. There is no
`mixed` shape any more: a fake with capitals of its own ("McAllister",
"Zenith Holdings, LLC", "Bank of Calderon") is prose, and the real is titled,
where `mixed` used to fall back on the key and put the caps into a sentence.
Titling keeps small words small ("Bank of America"), abbreviations, initials
and Roman numerals in capitals, and gets Mc, O' and accented names right. A
real value in both cases is left as written unless most of its capitalised
words are shouted (`mostlyShouted`): then the shouted words are titled and the
rest kept ("John Smith, Jr."), so "IBM Credit Corp" stays as it is. A
possessive row ("ZACHARY CODERRE's" → "John Doe's") is split the way a bare
name plus 's is (`lookup`, and `textdoc.lookupForward` for the typed span),
and a word the replacement shares with the fake takes the fake's spelling
("SILVERGATE., Inc." → "U.S.A., Inc."). `test-pseudo-key.mjs`, "case: the
fake's case, never the key's caps".

**…and a shout the key's own fake does not make is a slip** (`keySpelled`,
the owner's report of 2026-10-28). PDF-Linker writes a real acronym's fake word
in capitals ("ABC Supply Company" goes out as "TRUENORTH Hartland Company"), so
a key row binding "Meadowgate Cobalt Company" to "ACME Cobalt Company" has a
capitals slip in its Real Value, and the rule above left it as written:
"Meadowgate Cobalt Company" read "ACME Cobalt Company". Now, where the text is
prose and the value and the key's own spelling of what was matched have the
same number of words, a value word in capitals whose counterpart in the key's
spelling is not is titled (titleWord, so a listed abbreviation keeps its
capitals), unless the text shouts that word too or it has under four letters
(a label or a code: an older PDF-Linker's run-on label row binds "Odalys
Pellingrove DOB" under the pool word "Oxmoor", and "DOB:" read "Dob:"). "TRUENORTH Hartland Company"
and "Truenorth Hartland Company" still read "ABC". Both directions read it
(`compile` and `compileForward` keep the key's spelling as `spell`); the same
rule is in DeAnonymize.bas and the extension's `src/pseudo.js`. Residual: a key
typed by hand pairing an acronym with a title-case fake ("XYZ Holdings" for
"Meadowgate Holdings") titles the acronym ("Xyz") unless it is listed.
PDF-Linker's round-trip port carries the rule (`_rd_key_spelled`, pinned
under node by its `test_round_trip_check.py`). `test-pseudo-key.mjs`, "a shout
in the key's real that its own fake does not make".

**A one-word real PDF-Linker leaves in lower case is matched only where it is
capitalised** (`capOnlyReal`, `never-fake-words.js`; the owner's direction,
2026-10-28: every program that fakes from the key uses PDF-Linker's list of
words it does not fake). A key bound a party's bare word "Provision"; the run
left every "provision" of the contract as printed (a bare token is cap-only
there, `_pn_term_is_cap_only`), while the reader's save, its marks and the
typeahead took the word in any case. Now a one-word real that is a bare-token
row (Category `person-token`, `entity-token` or `short-name`, which parseKey
now keeps on the warning row) or whose word is on PDF-Linker's `Never Fake
Words.txt` (English that is no surname, and the vocabulary its bare-token
screens refuse) is neither marked, refused, offered nor written as its fake
where its first letter is lower case — PDF-Linker's own test. "Provision",
"PROVISION" and "Provision's" are still faked; a multi-word value is matched in
any case as before. The list is PDF-Linker's file, copied here as `Never Fake
Words.txt` and built into `viewer/never-fake-words.js` (a set made on first
use) by `node build-never-fake-words.mjs`; run it whenever PDF-Linker
regenerates the list. `test-never-fake-words.mjs` fails while the module, the
copy and the list beside this checkout disagree. Not changed: a file name's
scrub (`redact.boundValueStands`) reads `boundRows` with its own matcher.
`test-pseudo-key.mjs`, "a one-word real PDF-Linker leaves in lower case".

**…and a row PDF-Linker marks `full name only` is reversal alone**
(`FULL_NAME_ONLY_STATUS`; the owner's direction, 2026-10-29: what PDF-Linker
would not fake is not faked here either). PDF-Linker writes a key row for each
word of a composed name so a bare stand-in reverses ("Dawnfield" of "Dawnfield
Holdings, LLC"), and where its run never faked that word standing alone — it
pruned "Provision" as the papers' own prose, refused a word as a bare name, or
the word is a judge's bare surname — it now says so in the row's Status. Such a
row stays in `pairs`, so "Dawnfield" still reads "Provision", and is left out
of `warn`: never marked as a real left standing, never written as its fake by a
save, never offered as you type. The full name, and a live bare surname whose
Status is "no match", are faked as before. `test-pseudo-key.mjs`, "a row
PDF-Linker marks full name only".

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
(`MAY_CUT_RE`) and is never cut. A line whose one cell at the margin has
only a ")" or a bar after it ("…; and QUARRY   )", the case number's side empty
on that line) is still a column (`cells.marked`); it used to be taken for a
plain line and skipped.

The LEAKS worksheet's marks read columns too. The row in front (`leakMatches`)
keeps its whole-word reading off the page as it shows and adds, on a page that
carries the value's first and last words at all, the value wrapped down a
column off the disk text (`findColumnSpans` with a one-value key). Each match
is `{ range, pieces }`, so the row's mark and the walk's stop
(`leakHerePieces`) cover both halves. Before, the walk reported such a value as
"not in" the document and blamed an edit. The rows still to answer
(`sheetFound` in `scanPassNow`) add the same column reading with
`sheetCompiled`, the worksheet's values as a key, sharing the page's disk
reading (`pageDisk`) with the names in the clear. Both are additive: only names
that cross a column's line break are taken from the column reading. The
flagged values' red marks are not read in columns: a flag is a value handed to
the next run, and once the run puts it in the key, an occurrence it missed is a
leak, which the orange marks read in columns. The PDF readings (both Redact
tools and the screenshot's cover over the PDF pane) read columns of the page as
it is laid out; see `Design Notes/Redaction.md`.

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
does — and since PDF-Linker's one launcher (2026-10-14) its click finds the
same flag itself (`_rerun_half_faked_values`, reading the exports through the
key as this reader does) and does that full run, so the message says Re-run
PDF-Linker does one for it, never "not Apply Fixes".

**Flagging by selecting** (`setFlagMode`, `flagTakes`, `flagWhereReleased`):
🚩 in the tools rail is a switch (`aria-pressed`, `body.flag-mode`), not a
one-shot. On, a left press on `#pages` (taken on the document in the capture
phase, so the numbered margin's own mousedown cannot hide it; no Ctrl, Meta
or Alt; not a triple-click, whose line is more often a passage) sets
`flagDrag`, and the release flags the settled selection on a `setTimeout(0)`,
as the PDF pane's Redact text mark does. `showFlagPop` stays down while
`flagDrag` is set, so the pop-up does not flicker up mid-drag. `flagTakes` is
the pop-up's Flag button reduced to a yes or no — `flagProblem`, a spot keep,
the orange name alone (`sameWords`), and a value the Master Keep holds
(`masterHeldIn`), which `flagSelection` itself would flag but which the
pop-up puts a question to — and a selection it refuses is left selected with
the pop-up shown. A flagged one is collapsed to its end, which also takes the
pop-up down (its `selectionchange` finds no selection). Clicking the button
with a selection already made flags it as the click always did. The mode is
per tab and never stored, and `body.flag-mode` paints the page's
`::selection` in the flag's red. Ctrl+Shift+F is still `flagSelection` alone.

**A cited decision's party is asked about, never flagged on a release**
(`citedIn`, `CITED_FLAG`, `flagSelection({ asked })`). A flag is a line of
`New Real Values.txt`, which PDF-Linker reads as an authoritative `--term`: a
party of THIS case, whose words count toward `_trusted_party_tokens`. Where a
cited decision's other side is already this case's party — "Kremerman v. Ford
Motor Co. (2019) 30 Cal.App.5th 1" in a case against Ford, the key binding
"Ford Motor Company" — a flagged "Kremerman" makes `_side_is_trusted` clear
both sides, the cite is taken for this case's own caption, and the next run
writes "Sterling v. Crestline Emberly Co. (2019) …": a renamed authority,
measured against `pdf_linker.py`'s `_pn_build_terms`. Flagging both sides of
any cite ("Jones" and "Smith") does the same. The marks, the save, a copy and
a print all leave a cited name alone (`TD.citedNameSpans`); the flag paths
did not ask, and with 🚩 on a double-click flagged one with no question at
all. `citedIn` reads the selection into the page's disk text
(`serializeHeld` with its two ends as points) and asks whether it overlaps a
cited decision's name there, in the text as it stands and as the marks read
it (`diskReading`, fakes and spot keeps blanked). `flagTakes` refuses such a
selection, so the switch's release leaves it selected with the pop-up up;
`showFlagPop` puts the reason above its buttons; Ctrl+Shift+F refuses it and
says why; and only the pop-up's own 🚩 Flag (`asked`) flags it, for a name the
operator knows is this case's own. Checked in Chromium: a double-click on
"Kremerman" with 🚩 on (the pop-up asks, nothing flagged, the saved `New Real
Values.txt` holds no "Kremerman"); a drag over "Smith" and over "Jones" inside
"Jones v. Smith (2019) 30 Cal.App.5th 1" (neither flagged); Ctrl+Shift+F on
"Jones" there (refused); the pop-up's Flag on it (flagged); "Riverside County"
outside any cite (flagged on release, as before).

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
(`_pn_bracket_keep` → []) — is dropped as before, except on an e-mail address
or a website (below). Any other instruction —
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
  Apply Fixes) carries out — since PDF-Linker's one launcher (2026-10-14),
  "the next click of Re-run PDF-Linker carries it out", which decides on that
  full run itself; until then retype it, or keep it where it stands
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

Three gaps were left by that change, found by a review of it, and closed:

- **What leaves the room withholds such a name** (`egressSwaps`,
  `egressText`, `WITHHELD`). The print, the screenshot (its pages,
  `swapChrome`, `pdfNamesOn`) and a copy off the pages run the forward matcher
  to show every bound real as its fake, and `compileForward` maps an
  instruction's real to nothing, so it went out exactly as it stood: a print
  of "Dana Okafor" holding "phrase" put "Dana Okafor" on paper, where the build
  before had printed "Phrase" — rubbish, but no name, as "Yes", "#Name?" and
  "Alder {Law}" were. ("~Rasho" and "*Rasho" had printed a real spelling all
  along.) Nor did those passes take the save's spare, so a name holding an
  instruction wrapped down a caption's column, with its last word bound on its
  own, printed half faked: "…and Jonathan" / "Avery Smith Cascadia, an", the
  name half scrubbed that reads as finished. And a copy did the same under a
  toast saying the name went "as it stands". These passes, and only these,
  now spare every standing name with no fake (`standingSpans`, the column's
  pieces with it) and lay `WITHHELD` — five full blocks — on its first piece
  and nothing on the rest, as a fake that does not divide by words is dealt
  out; the toast after a print, a screenshot or a copy names each with what
  the key holds for it. The cover reads as no name, no key row reverses it,
  and it opens with no control mark: "[name withheld]" was the first thought,
  and pasted into a LEAKS answer or the key it is a keep-spec. It is the same
  five blocks whatever it covers, where a run the length of the name would
  give the length away. The SAVE never takes it — a file says what the case
  says, and the save refuses such a name by name (`instructionNote`) — and
  neither does the redacted copy's NAME, which never needed it:
  `RD.scrubbedStem` checks the faked stem against `PK.boundRows`, instruction
  rows included, and names a copy "document <hash> (redacted).pdf" wherever
  one still stands. The cost is one `standingSpans` a page in those passes,
  asked only where the key holds an instruction at all (`keyHasInstructions`):
  Ctrl+A over 200 pleading pages (700 KB, three names on every line) copies in
  131 ms under a key of pseudonyms only and 152 ms under one holding
  instructions.
  Checked in Chromium on the build before (the print, the column print, a
  copy of each, and a screenshot's pages, Find box and PDF pane all carried
  the names, the column half faked) and after (none did).
- **A possessive holding an instruction binds the bare name** (`parseKey`'s
  derived rows). "Rashoe's" over "~Rasho's" derived nothing, so "Rashoe"
  standing alone was bound nowhere: not marked, not refused, not named as
  unreviewed, and a save wrote it without a word — while a key kept in the
  library from before still derived and marked it (`warnRows` re-reading the
  derived "~Rasho" as an instruction), one workbook answering two ways. The
  bare row is derived with no fake and the possessive's `control`, unless the
  key binds the bare name itself; it owns no fake, so reversal is untouched.
- **A keep on an e-mail address or a website is no keep** (`PK.contactValue`,
  `_pn_contact_value`'s port). Every e-mail address and every website not
  ending in .gov is faked at the owner's direction, and `_pn_load_key` asks
  that of the real before reading a keep: "no", "n", "never" or a keep-spec
  there is "not honoured", the row is dropped and the run fakes the value
  afresh. Read here as a keep, the row was dropped and the address went
  unmarked into a save — and "n", a pseudonym to the parse before the cells
  were classified (and so a marked value), became a keep that unmarked it. A
  keep on such a value is now an instruction: marked, refused, named in the
  bar. The port carries PDF-Linker's lists (`_PN_PUBLIC_EMAILS`,
  `_PN_URL_WHITELIST`, `_PN_PUBLIC_HOSTS`), the url detector's dotted branches,
  the spellings with a dot missing (`_pn_url_dotless_parts`), an address's
  host with its dot lost before "com", and `_pn_url_fragmentary`; run against
  `_pn_contact_value` itself on 6,000 generated values and the test's own, it
  answered alike on every one. It is asked only of a cell that is a keep, so
  a key of thousands of pseudonyms never reaches it.

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
file input, `masterInfo.loose`) leaves the value off for this session only,
and the toast says so. A refused permission or a failed write (Excel holding
the file) is owed instead (`masterPending`): the status bar counts it, the
closing prompt asks, and the next save writes it once the workbook's grant is
in place (`Design Notes/Unsaved documents and the folder save.md`). The list
is drawn again whenever a marks pass changes which kept values stand on the
page (`keptSeen`); it used to wait for the next `renderFlags`.

**…and off the reader's own keeps** (`keepsHeldFor`, `dropKeepsFor`,
`keepsElsewhere`, `takeKeepLinesOut`, `heldNote`): PDF-Linker records every
keep it is handed on the master, so a case's own keep of the value — in any
case list the reader remembers, in the open folder's `New Real Values.txt`, or
in another case folder's — put back the very row a removal took off, on that
case's next run. Every entry point goes through `withdrawMaster`, which now
also takes the value off every stored case list (`textReader.values.*`, by
`storedValueKeys`; the list in hand with them where `flagsFor` is the open
case's), recording each keep it takes as WITHDRAWN in its case (below); where
the open folder's file still carries a keep line on it, records that line as
handed over (`TD.noteKeepLines` into `valuesSaved`) and withdrawn: the list
without it then differs from what was written, so the status bar counts `New
Real Values.txt` to write, the closing tab asks, and Save writes the file
without it — header only where nothing else is left — and opening the folder
before then does not read it back in. OTHER case folders' files are looked
for in every case the reader keeps a list for or wrote a keep line on the
value for (its `valuesSaved` record): where the reader remembers the folder
(`rememberDir`) and the browser's leave to write it already stands (asked,
never prompted for: the removal has its own question to put), the file is read
and the keep lines on the value are taken out at once, with the master (the
folder's `valuesSaved` with them), since no Save in this folder can reach
that one; where it does not — not remembered, no grant, or the folder gone
from where it was remembered (`dirStands`: a "not found" from a folder that is
gone says nothing of its file) — the record of what the reader wrote there is
all there is, and the folder is NAMED, in the confirm and in red in the toast:
"New Real Values.txt in Case Third still carries it, out of the reader's reach
now: open Case Third here and Save before PDF-Linker runs there." Its keeps are
recorded as withdrawn there, so that folder, opened later, does not read the
line back, owes the file the change, and Save takes it out. The confirm names
the case lists and the files ("It also comes off this reader's keeps for Case
Harness, Case Other, and out of Case Harness's New Real Values.txt, which still
carries it — Save writes that"; "…and out of New Real Values.txt in Case
Other"); the toast after says what was done. A folder out of reach is counted
as owed in that folder, when it is opened, not in this one's status bar: this
Save cannot write it. Not touched: a LEAKS worksheet's own Fix? cell on the
value, spot keeps (edits, never handed to PDF-Linker), and the lists of the
reader under another origin (the extension's and the installed app's keep
their own storage), whose next save there writes the keep again.
`test-folder-save.mjs` cases 27, 28, 33 and 35.

**A keep PDF-Linker has spent** (`TD.spendLines`, `spendFromDisk`,
`keepsSpentNote`): PDF-Linker consumes `New Real Values.txt`
(`_pn_consume_reader_file`): a keep line it applied goes onto the master's
KEEP sheet, under this folder's Origin, and out of the file, which is deleted
once nothing is left. The reader went on holding every keep taken in the case
(`setKeep`, and a LEAKS `no`/`never` on a bound value mirrored into the list),
counted a `never` and any keep on a faked value as owed for ever, and wrote
the list again on every save that found it changed — so the next run recorded
the keep again and re-created a master row the operator had emptied or deleted,
and the operator removed the same values over and over. Now the list is read
against the file as it stands, when the folder is opened (`adoptFolderNow`,
which reads the file once) and before every write of it (`saveValuesFile`,
after asking the folder's grant while the click is fresh). An entry is SPENT
where the reader wrote its line (`valuesSaved` carries it — for a keep, the
same control and value, `TD.carriesKeep`) and the file no longer carries a
line for it (none on the value, any control; the file gone counts): it is
retired from the case's list, the way a spent `text corrected:` line always
was (that pruning is now the same function, and runs at a save as well). A
line still in the file is not spent, whatever comment stands over it —
PDF-Linker writes back, under a `#` line, a keep whose master row it could not
write (#491) and one a typed `--fix-leaks` holds for the full run (the
launcher's click does that full run instead, since 2026-10-14) — and is written
again. A local keep is never written and never spent. The record of what was
written is trimmed to the keep and page lines the file still carries
(`spendLines`' `saved`), so a list PDF-Linker has spent does not read as owed:
no false "to write" on opening the folder (and where only that record moved,
the status bar is drawn again with it). Where the master workbook is
attached by its handle and, read as it now stands (`masterSettled`: the
startup reading, kept as `masterRestoring`, then `refreshMaster`, which hands a
second asker the look in progress), does not keep a spent value — the row
emptied or deleted by hand, or the run could not record it — the keep is
retired all the same and said by name ("“Corwin Ashdale” is off this case's
keeps: PDF-Linker has taken its line out of New Real Values.txt, and
master_leaks.xlsx does not keep it — removed there, or never recorded. It is
not sent again; keep it again if it should stand."): a toast when the folder is
opened, in red in the save's own toast (`valuesSpentNote`), and the Flagged
panel's own Save shows it too where nothing is left to write (never "Nothing
flagged yet" over a list it has just been through; with nothing to say, it
names the keeps PDF-Linker applied). A workbook REMEMBERED but not read — the
browser wants its leave again (`masterNeeds`: a restarted browser takes the
grant back unless "Allow on every visit" was chosen), or the file could not be
read (`masterLost`, set by `masterUnread`) — is not taken for no workbook: the
keeps are retired and named, saying the master could not be checked ("…and
whether master_leaks.xlsx keeps it could not be checked — the browser wants its
leave to read the workbook again (Allow, …). It is not sent again; if the
Master Keep does not have it, keep it again here."). Holding the note until the
renewal was the other way; a renewal that never comes would have said nothing.
With no workbook attached (or one opened as a copy), a consumed line is spent
with nothing to say. A save that finds everything it owed spent writes nothing
(`saveValuesFile` answers "spent", and the save's toast says no "written
too").

**A spent keep stays the reader's to take back** (`noteKeepsSpent`,
`keepsSpentHere`, `keepWorks`; the record under `SPENT_KEEPS_PREFIX` +
the case's state key, one of `STATE_PREFIXES.whole`). PDF-Linker retires the
key row a LOCAL keep corrects once it has applied it, so from that run on
the key binds the value no more — and the reader showed and offered only the
master keeps the key binds (`keyBinds`, the noise filter that keeps another
matter's settled keeps from underlining this case). The keep the case had
made was then unmarked, missing from the Master Keep panel, and out of the
selection's and the right-click's Remove from Master Keep: once spent, it
could be withdrawn only in Excel (the bug search's G1, and G5, Remove from
Master Keep with no mark to start from). Every keep `spendFromDisk` finds
spent is recorded for the case; `keepWorks` (the key binds it, or the case
spent it) replaces `keyBinds` in the kept marks, the mask, `masterMatcher` and
`masterHeldIn`, and the Master Keep panel lists the case's spent keeps
wherever they stand. A keep spent before this record existed is out of it,
as before.
**…and a case keep the master holds too** (G2): PDF-Linker spent its line
and put it on the KEEP sheet, and the folder has not been read since to say
so. The ×, or "It is a pseudonym after all", took it off the case's list
alone, and the master went on keeping it, in this case too, run after run.
`setKeepNow` now asks `withdrawMaster` as well wherever the attached master
holds the value (which says what it does, and asks first).
`test-folder-save.mjs` test 38 (Chromium) pins both; its negative control on
the code before shows neither the panel's line nor the selection's button,
and leaves the master's row standing after the ×. G3, G4, G6 and G7 are
PDF-Linker's (its session's keep-withdrawal work): a keep it records onto
another case's row, or holds, is carried back in New Real Values.txt under a
`#` comment, which the reader reads past.

**Only what was written HERE is spent here** (`rememberWritten`,
`writtenRecord`, `writtenWhere`, `TD.writtenBaseline`). `valuesSaved` was kept
by folder NAME, as every per-folder list was, and a name is not a folder: a
copy of the case under the same name (a `copy_to` destination, an archive)
shared it, and so did every case's `Text Files`. Read against the wrong folder,
a keep line written into one read as spent in the other, and the keep was
retired, silently where no master was attached, without ever reaching the
folder PDF-Linker runs on. Every per-folder record is now kept under the
folder's id (`stateFolder`, `dirIdFor`; see "Each folder is itself" in
`Design Notes/Text reader layout and navigation.md`), so a same-named
copy has a list and a record of its own; the name is the key only where
IndexedDB gave the folder no id. Beside that, every write into a folder
records WHICH folder took it — its handle, after a write and after the
no-write path that finds the folder already in step — kept in the `dirs`
store under a key no folder can have (`"\u0000written:" + stateFolder()`),
which `readDirRecords` passes over (it takes only ids and directory handles)
and which outlives a folder let go of, as its id does. `spendFromDisk` asks it
first (and stops there, spending nothing, where an adoption it runs in was
overtaken while it asked: `still`): the same folder (`isSameEntry`) is
spent as above; another folder is not spent at all — its own file becomes the
record (`writtenBaseline`: the list's own text where the file carries exactly
its lines, the file's text otherwise, "" with no file), so whatever the list
holds that this folder's file lacks reads as owed and Save writes it there, and
the record is this folder's from then on. No record at all (an older build's
writes, no IndexedDB) is read by the name, as before. **A list saved through
the picker or a download** — the Flagged panel's Save, the folder having
refused the write — is no write into the folder, and is not marked written
(`markValuesSaved`, which it used to be): the status bar goes on counting `New
Real Values.txt` to write, the closing tab asks, the toast says a copy went
outside the folder, and the record of what the folder was last given stays
what it was — so what a run then spends of THAT is still spent, and a keep
that never reached the folder is never taken for one the run took out (the
first version marked the fallback written, and the next opening retired the
keep, "PDF-Linker has taken its line out", without it ever having been
handed over). The picker pointed at the folder's own `New Real Values.txt`
(`writeText`'s `picked`, `isSameEntry` on the folder's file) is the folder
write after all, and counts as one. `test-folder-save.mjs` cases 30 and 31.

Two things keep the spent rule from eating a decision. **A keep taken
afresh** — a new keep, or its control changed (`setKeep`, `moveLeakKeep`) —
first lets go of the record of any keep line written for the value
(`forgetWrittenKeep`, `TD.forgetKeepLines`), so a keep withdrawn and taken
again after PDF-Linker spent its old line is handed over, not retired unsent.
And **a keep withdrawn is not read back** (`noteWithdrawn`, `keepWithdrawn`,
`trimWithdrawn`, `textReader.keepsWithdrawn.<name>`): opening a folder merges
the keep lines of its file into the list (a line written in another session,
the other reader's origin, or one another tab's list was stored over), but not
one the operator WITHDREW — its ×, "It is a pseudonym after all", a LEAKS
answer that is a keep no longer, Remove from Master Keep — which is recorded,
at that moment, as a keep line in the case's record of withdrawals (a local
keep, never written, is not). Such a line is the file's old copy of a decision
withdrawn: it is noted as handed over (`valuesSaved`), so the list without it
is owed out of the file, and the next save takes it out. A line leaves the
record when the keep is taken again (`forgetWithdrawn`), and when the folder's
file is seen without it — read at an opening or before a write, or written
(`TD.keepLinesCarried`) — so a line written there afterwards by another
session is read in again. The first version of this inferred a withdrawal from
the list lacking a line `valuesSaved` carried, and that is also what a stale
tab looks like: tab B, opened before tab A took a keep, stored its own list
over A's at its next flag, and A's next opening took the file's line for a
withdrawn one, did not read it back, and the save after wrote the file without
it — a keep lost, silently, that the older merge had restored. **Another tab's
withdrawal reaches this one at once** (`onWithdrawnElsewhere`, a `storage`
listener on the open case's record): a keep it holds that another tab has just
withdrawn — by its ×, or a Master Keep removal reaching every case's list —
comes off its list there and then, so its next stored list does not put the
keep back for the next save to hand over again. Only a withdrawal is followed:
nothing is added to a tab's list from another's, and nothing is stored. Not
covered: a flag withdrawn after it was written still comes back from the file
at the next opening (its own path, `dropFlagsNowFaked`, takes off a flag the
key now fakes); two tabs still write their lists over each other in every
other respect, as every per-folder list does; and a keep line in another folder's file that another origin
wrote is read back there, and is reached by Remove from Master Keep only where
this reader keeps a list for that folder. The record of withdrawals, and the
names said to be faked, are kept under the folder's id like the list, and
beside the list IN HAND (`listStateKey`, from `flagsFor`; `withdrawnKey`,
`settledStoreKey`): while an adoption has named its folder and not yet read
that folder's list, a decision taken in the last folder's document is that
case's, not the new one's. An older build's, kept under the bare
name, moves with the list (`STATE_PREFIXES`, `adoptLegacyState`). Remove from
Master Keep finds the other cases' folders by those ids among the remembered
folders (`keepsElsewhere`, `dirRecordsById`) and names each by its folder's
name (`caseLabel`), in the order of the names. `test-textdoc.mjs`
("what PDF-Linker has spent") and `test-folder-save.mjs` cases 25, 26, 29 and
32, and 34 for the workbook remembered but not read.

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

**A PDF-Linker run going in the case folder** (`checkRun`, `runMarkersIn`,
`showRunning`, `showRunEnded`, `readFolderAfterRun`, `textdoc.runMarker`; the
`#run-bar` under `#key-offer`, taking its own height through `--run-h`). A run
rewrites the case folder as it goes: every export in Text Files, one PDF after
another, then the key and LEAKS.xlsx at its end. A document opened meanwhile is
the last run's text, or text the run is part-way through, read under a key it
is about to replace, and a save made before it finishes can be overwritten by
it or overwrite what it has just written. PDF-Linker already says it is going,
to the operator in Explorer: a zero-byte `ETA <estimate>.txt` in the case
folder, rewritten after each PDF (`_write_eta_marker`), and replaced by
`DONE <clock>.txt` on a clean finish (`_write_done_marker`). So `openFileNow`
looks for one each time an export opens (not awaited: the document is never
held for it), as does the attach a click gives a folder that needed
re-authorising. Only EMPTY files count, as PDF-Linker scopes its own
(`_clear_eta_markers`, `_marker_mtime`), so a real "ETA notes.txt" is not a
run; and a run is going where the newest ETA is newer than any DONE stamp,
which is the test PDF-Linker makes of a copied folder (`_copy_is_ahead`). The
marker's clock is written colon-free for Windows ("6.04PM"); `runMarker` puts
the colon back for the bar. While the bar is up it looks again every
`RUN_RECHECK_MS` and on `focus` and becoming visible (as `refreshMaster`
does), so it says when the run has ended instead of warning about one that is
over — with the DONE time, or that it stopped without one (a crashed
`--fix-leaks` clears its marker and writes no stamp) — and offers **Read the
folder again** (`readFolderAfterRun`: the PDFs and built-ahead pages dropped,
the folder adopted again for the new key and worksheet, the open export
reopened, found again by its label where the run renamed it to or from
`.txt.LEAK`). A full run that dies leaves its ETA marker standing until the
next run clears it, and the reader cannot tell that from a slow OCR file; the
bar gives the marker's age past `RUN_STALE_MS` and points at
`pdf_linker.log` rather than guessing. **×** stops the rechecks; the next
export opened looks again and brings the bar back while the run is still
going. The ended bar stays up across exports opened after it, until the
folder is read again or put away: such an export is the run's new text, but
an open inside the folder held attaches no key (`attachKeyForFile` returns
early), so the key in hand is still the one read before the run. `runSeq`
lets only the latest look answer (a recheck with no bar up does not count,
or a focus landing during an open would silence it), and `forgetFolder` takes
the bar down with the folder it was about. Nothing is blocked: the bar warns
and the operator decides. The marker names are a format read outside
PDF-Linker, recorded in its CLAUDE.md beside the export headers and the key.

**Files a run changed under the reader** (`folderKeyState`, `lookForChange`,
`showFolderChanged`, `leaksOnDisk`, `TD.linesNotOurs`; `keyRead`,
`leaksSeen`, `valuesSeen`, `valuesWrote`). The run bar above warns only while
a run is going and only where an export is opened; a run that finished while
no bar was up left the reader holding what it read before, and the next save
wrote it back: the pre-run key's view of the text (a name the run had just
faked written real again — the bug search's first finding, "theo brackwell"
flagged, the run, then Ctrl+S), LEAKS.xlsx as it was attached (answers typed
in Excel since undone, or a worksheet the run had removed put back, which
reopened leak triage: `_pn_triage_pending`), and New Real Values.txt
rewritten from the lists alone (a page list "pages 3-5, 9" the lists cannot
hold, or a line typed into the file by hand, lost). Now nothing is written
over a newer copy:

- The KEY. `loadKeyFromBytes` notes the key read from a case folder
  (`keyRead`: the folder's handle, the file's name and a signature of its
  content — the reversal pairs, the instruction rows and the row count, not
  the bytes, which openpyxl rewrites on every save). `folderKeyState` reads
  the file's stamp, and its content only where the stamp moved: "same",
  "moved" (it binds otherwise), "new" (a folder with no key in hand has one
  now) or "unknown" (unreadable now: a run never deletes the key, so that is
  no news). `saveNow` refuses on "moved" before it reads a page — saved under
  the old key a name the new one binds would stay real, or be written as a
  pseudonym no row of the new key turns back — and puts up the bar.
- The LOOK. `checkRun`, with no bar up, now calls `lookForChange` (on the
  focus coming back, on becoming visible and on opening an export): the key
  as above and LEAKS.xlsx against the bytes held (`leaksOnDisk({ cheap })`, by
  stamp, `leaksSeen`), read permission only, one look at a time. A change seen
  while an ETA marker is newer than DONE is the run still going
  (`showRunning`). Otherwise `showFolderChanged` puts up the ended bar with
  what moved and **Read the folder again** (`readFolderAfterRun`, which now
  keeps a folder document's edits in the store and asks only about the ones
  with nowhere to be kept, and drops a worksheet the run removed). **×**
  remembers the bar's text (`folderChangeHidden`), so the same news is not put
  up again by the next look. No poll. Since PDF-Linker #517 it stamps DONE
  after its last writes (the worksheet, the key, the reader's file, the
  quarantine), so a change seen with DONE newer than every ETA is a finished
  run's; with nothing unsaved and nothing being opened or saved, the look
  reads the folder again itself (`readFolderAfterRun`) rather than putting up
  the bar — the owner's decision of Oct 13, "the reader re-reads changed
  files on focus, document open and save, with no 5-second poll". With
  something unsaved the bar asks, as before.
- LEAKS.xlsx. `saveLeaks` writes only over the bytes it read: changed on disk
  or gone, nothing is written, the answers stay remembered (`persistLeaks`),
  `leaksSaveNote` says why in the document save's toast, and the bar goes up.
  Where the folder's own file will not take the write (Excel holding it), it
  says so and writes nothing else (`writeBlob`'s `inPlaceOnly`): a copy picked
  elsewhere is not the file PDF-Linker reads. And only into the file it was
  read from: a worksheet loaded by hand with no handle while a case folder is
  open (dropped from a mail, read through the file input) is "foreign"
  (`leaksOnDisk`). The first version compared it with the folder's own file
  by name and called another matter's sheet "changed on disk", and before
  that the save made a handle for it (`getFileHandle(leaks.name, { create:
  true })`) and wrote it over the case's own: the re-check's repro 8 left
  `Odile Varnecke="no"`, another matter's row, where the case's rows had
  been, a `no` PDF-Linker would read as this case's keep. Now its save says
  it is not this case folder's worksheet, keeps its answers and puts up no
  bar. The case folder's OWN worksheet (`leaksOwn`: a file of the folder
  itself by `dirHandle.resolve`, asked when it was attached, and the folder
  still open) is written in place or not at all — never by the Save picker,
  whatever its state; a sheet picked by hand from elsewhere, changed or gone,
  is said as such ("load it again", "no longer where it was loaded from") and
  puts up no bar about the folder. The Text Files guard is asked before the
  disk, being the reason to give there. After a save the sheet's rows are
  stored again (`persistLeaks`) rather than removed: what is left to remember
  is its acceptances, which no save writes ("Acceptances are not answers",
  below). `test-stale-writes.mjs` case 7 pins the hand-loaded sheet.
- New Real Values.txt. The file is still written whole from the lists, the
  reader's own lines first (PDF-Linker and `parseReaderFile` take a value's
  first line), and then every other line of the file as it stands, verbatim,
  under "# Already in this file, not written by the text reader — kept as they
  stand:" (`TD.linesNotOurs`, `withLinesNotOurs`). A line PDF-Linker reads
  that the reader cannot parse (`valuesLineKey`'s `raw:`) is always kept. Any
  other line is kept only where this tab did not write it (`valuesWrote`, what
  THIS tab last wrote: the record in localStorage is every tab's) and did not
  see it as the folder was opened (`valuesSeen`, noted by `spendFromDisk` at
  adoption: read into the lists then, gone from them since, it was
  withdrawn), and it is not a keep the operator withdrew (`keepWithdrawn`).
  What is recorded as written is the reader's own text alone.
  A line the opening READ INTO the lists from the file (written by another
  browser, another session or by hand) is recorded as in the file
  (`TD.noteLinesRead`, after `spendFromDisk`, which reads the record as this
  tab left it). Unrecorded, withdrawing such a value left the list equal to the
  record: `valuesDirty` said nothing was owed, no save wrote the file, and
  PDF-Linker went on applying the flag. Recorded, the list without it reads as
  owed and the save takes it out (`valuesSeen` drops it from the lines kept);
  a folder whose file holds just what the list does reads in step on opening
  instead of owing a rewrite; and a keep or transcribed page so read that
  PDF-Linker later takes out reads as spent rather than owed again.
  `test-stale-writes.mjs` case 3 pins both.
  PDF-LINKER'S NOTES stay over their lines (`TD.notedBlocks`, written by
  `withLinesNotOurs` between the reader's own lines and the kept ones). A run
  writes lines back under a `#` note saying what they are — keeps it could
  not record on the master, keeps waiting for a full re-run, lines saved
  after it read the file, values it could not register, and (keep
  withdrawals, G3) a keep line carried back for this case whose master row
  is another case's, which the note tells the next run to apply without
  recording it again. The reader read those lines into its lists and wrote
  them among its own, the note dropped, so a carried keep line read as a
  fresh instruction and could put this case's `no` back over the other
  case's row. Now each note is written with the lines under it the reader
  still carries (a line withdrawn goes, and a note with none left goes with
  it); the reader's own header (whose first line has never changed), its
  kept-lines head and the set-aside page lines are not notes.
  `test-folder-save.mjs` test 25 pins the held keep's note.
  PAGE LINES PDF-LINKER SET ASIDE (`TD.spendLines`' `setAside`,
  `TD.setAsideLines`, `pagesSetAside`/`holdSetAside`/`releaseSetAside`, the
  `held` of `TD.pageListsAfter`). A `did not ocr:`, `ocr again:` or `text
  corrected:` line PDF-Linker refuses because the PDF's page count no longer
  matches its export (pages moved in the viewer) is written back as `#
  <the line>` under a `# not applied:` note, so no run applies it to a
  renumbered page. The reader kept the entry, and its page still reading
  [DID NOT OCR] put it back on the ⊘ list, so its next write handed the line
  over again and the run after it marked the wrong page. Now a page line
  written here and gone from the file as a line PDF-Linker reads (applied or
  set aside) comes off the lists and the record, as a spent keep and a spent
  transcription do; one set aside is held for the case (and said so), so
  neither the ⊘ list nor the automatic Use my text hands its page over
  again until the page is marked by hand — after the next full run has
  written the export again. `test-stale-writes.mjs` case 9 pins it.
- The EXPORTS. A clean document whose file moved under it (an empty Ctrl+S
  after a run rewrote it) is skipped and named (`staleClean`), not called a
  conflict of edits; and a document with no entry in the folder — a light
  attach, a lone file — gets the same content check before its handle is
  written (`diskStill`), so a run's rewrite is not written over and a file
  the run renamed to `.txt.LEAK` is not made again through the old handle.
  Its conflict says to copy what is needed and open it again: there is no
  disk's version to take for a document the folder's list does not hold.
- The FILES PICKED. `TD.isKeyName` refuses PDF-Linker's `.tmp.xlsx`, left by
  a save that crashed; `scanFolder` takes `pseudonym_key.xlsx` itself over a
  copy the folder lists first (`TD.keyRank`); `leaksRank` orders LEAKS.xlsx,
  its copies, the legacy name, its copies, as `_pn_existing_leak_xlsx` does.

The PDF viewer's Save has the same rule (`viewer.js`: `pdfDisk`, `pdfOnDisk`,
`askStaleWrite`, `pickedOverChanged`, `notePdfWritten`, `reopenFromDisk`):
PDF-Linker REPLACES a case folder's PDF when it adds its text layer, links and
bookmarks, or marks a page DID NOT OCR or TEXT CORRECTED, and the copy opened
before, saved in place over it, wiped all that. The viewer notes the file it
opened or last wrote (stamp, and a SHA-256 of the bytes, `documentKey`); a save
in place over a file that moved asks: Cancel, Overwrite it, Save as a copy…
(" (my changes).pdf", to be kept outside the case folder) or Reopen the new
file (the unsaved changes dropped). The Save picker pointed at the document's
own file asks the same. `test-stale-writes.mjs` (Chromium) pins each case;
`test-textdoc.mjs` and `test-leaks.mjs` the line keys and the file ranks.

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
shed slots (`rawSlots`), so the two columns stay level. Not persisted. Side by side, a raw page's scroll anchor is its PDF page's
(`firstLineOffset`: `pdfFirstLine` of its slot), so the pair scrolls as one,
page beside page; it was measured off the page's hidden lines, read as
nothing, and every page after it drifted off its PDF page (250 px by the next
page). `test-raw-sync.mjs` (Chromium) pins it, both columns leading.

**Backspace takes an indent off before it moves a line**
(`unindentAtCaret`, from `backspaceAtCaret`). The owner: "if I have something
indented on line [9] that should not be, backspace just pushes it up to 8.5
between 8 and 9. It should first go to non-indented, but still at 9. From
there, a second backspace would move it up to 8.5 … that way I can fix indent
mistakes, and correct line placement." At the head of a numbered line's text
whose gutter carries more than its two spaces (`.gs`, the indent, which takes
no typing), or after the opening spaces of an unnumbered line's text, one
Backspace sets the gutter's spaces to two and deletes the opening spaces, one
undo step, the caret at the text's head; the next Backspace does what it did
(into the half line above, then a join). On a ✓ Use my text page the line is
then the operator's (`markOwnLines`, `autoLayPage`), so the layout leaves it
unindented. `test-half-lines.mjs` section 2b.
**…one space a press** (2026-10-22, this narrows the paragraph above). The
owner: "if I make a series of spaces or indents, a single backspace removes
them all. It makes it very difficult to properly position things." Each
Backspace now takes ONE space: from the text's opening spaces where the caret
stands after them (the caret stays after what is left), else from the
gutter's (`.gs`, down to its two). The line still does not move until the
indent is gone. The PDF's indent beside the PDF (`fromPdf`, below) is no
spaces of the file's and still comes off whole, with the file's own opening
spaces, which it hides. `test-half-lines.mjs` section 2b (seven presses, seven
undo steps).
The indent the operator sees beside the PDF is often not the file's at all:
on a numbered page `pdfIndents` sets a line's text where the PDF's row at its
number starts (`.pind`, `--pdf-ind`), and on a page laid row by row the row's
left does (`rowInd`). The owner: "The backspace on a wrongly indented line is
still bringing it up to the previous half line." So the same Backspace takes
that indent off too: the line goes on the page's list of lines that take no
indent from the PDF (`noIndentOf`, `setNoIndent`; by the line's text as the
file writes it, indent taken off, `noIndentKey`; kept in localStorage,
`textReader.noIndent`, by the page's PDF page; carried by the undo history in
`snapshotOf` / `restoreSnapshot`), which `pdfIndents` and `rowInd` pass by and
the plan's key counts (`__noIndentSig`). `test-half-lines.mjs` section 3: a
line the PDF indents, one Backspace to the margin on its own number, a second
up to the half line, Ctrl+Z indented again.

**Typing into ⇄ Raw.** Under ✎ Edit the `pre.raw-text` is
`contenteditable="plaintext-only"` (set in `setRaw` and by `setEditing`); the
head (banner, header line) is a `span.raw-head` with `contenteditable=false`,
and `rawPageText` returns its length as `lead`. `commitRaw(sec)` reads the
sheet less its head (`rawSheetBody`), and where it differs from
`TD.serializeNodes(body)` takes an undo snapshot, `buildBody`s the page from
it, sets `doc.pages[i].lines`, `syncSpots`, `setDirty`, then
`convertTypedRealsSoon` and `afterTextChangeSoon`. It keeps the body's
`__built`, so a real name typed in the sheet is measured as typed and written
as its pseudonym. On a numbered page (`TD.pageIsNumbered`) the sheet's lines
go through `TD.tidyGutters` first: a margin number from 1 to `MARGIN_LAST`
(28) with ONE space after it, where it takes its place in the numbers
climbing down the page (`numberChain`), is set back to the export's
two-character number and two spaces (`GUTTER_RE` wants two or more), so the
line is the margin's again rather than an unnumbered line opening "9 37."
crowded in under the line above. The owner: "Raw and text view should be
connected such that an edit in one effects both" and "Margin lines only go up
to 28". A page whose file already carries such a line is set back the first
time ⇄ Raw is left under ✎ Edit, since the tidied text then differs from the
page. It runs 400 ms after the last input (`commitRawSoon`), on
focusout, in `setRaw(sec, false)`, at the top of `saveDocument` and before
`setEditing(false)` (`commitRawPages`). `fillRaw` leaves the sheet alone while
it has the focus (the corner tag still updates), so the caret survives the
commit; the focusout handler refills it. The pages' own `input`/`beforeinput`
handlers look for `.page-body` and pass the sheet by, and the global Ctrl+Z
handler leaves a contenteditable outside `.page-body` to the browser, so
Ctrl+Z in the sheet is the browser's per-keystroke undo. `test-raw-edit.mjs`
(Chromium) pins it.

**…and a line break typed into the sheet is a "\n" in it (`unbreakRaw`, in
the sheet's `input` handler, before `commitRawSoon`).** Chromium (153,
measured; a `<div>` with `pre-wrap` still takes a "\n") types Enter into a
plaintext-only `<pre>` as a `<br>`, and `execCommand("insertText", "\n")`
does the same, so a keydown handler would not help; any `<br>` is taken. A
`<br>` is no character of `textContent`, which `rawSheetBody`, the Tab
handling (`lineBeforeCaret`) and the copy all read: a line typed under
another was saved run onto it ("answered.Tobias Wrenfield agreed."), and the
page built from the sheet lost the break the same way. Each `<br>` is made the
"\n" it stands for as it is typed, the caret put back at its place in the text
(each `<br>` before it counted as one character). One ending the sheet is left:
it is what shows an empty last line, which a "\n" there does not, and it is
no text either way. `test-raw-edit.mjs` case 5.

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

**Renaming a document** (`#doc-title`, `startRename`, `renameDoc`). The top
bar shows the open document's name (`paintDocTitle`, from `renderReelState`)
and a click makes it a field, as the PDF viewer's `startRename` does. The
viewer only changes the name shown and offered on a download; here the file
is renamed on disk, and its PDF with it (`pdfForName`), since the pair is
found by name and PDF-Linker writes each export under its PDF's name run
through the key. The export's stem is `RD.scrubbedStem` of the name typed
(refused where it falls back to `document <digest>`, a real value still
standing); the PDF's is that stem turned back through `rev`, or the
export's own stem where the real form would not pair (`PS.pdfMatcher` is
asked before anything moves). `renameEntry` uses `move()` and falls back to
copy-and-remove, through a passing name for a change of case only, since on
a case-blind disk the copy would land on its own source. The export goes
first; if the PDF then fails, the export is moved back. The spot keeps and
page swaps kept under the export's name and the redaction boxes kept under
the PDF's move with them, and the folder is read again as after a run
(`adoptFolder`, then `openFolderDoc`, back at the page being read).
`renameBlocked` refuses while anything names the document by the old name
and is not the reader's to rewrite: unsaved edits, a run going
(`runMarkersIn`), entries on `noOcr` / `ocrAgain` / `textFixed`, LEAKS rows.
`renameFixed` covers what can never be renamed here (Combined Text.txt, a
`.txt.LEAK`, a document outside an open case folder). Tests in
`test-rename-doc.mjs`.

**The panels' rail** (`#side-rail`) replaced the tab strip across the head
of `#side`, which had grown to five tabs and a chevron and cut their names
short. As in the PDF viewer, a button per panel stands down the right edge
whether or not the panel is open: a click opens its panel (`showSideTab`,
then `showSidePanel(true)`), a click on the lit one or the head's **×**
closes it. The buttons keep the old tabs' ids (`tab-docs` … `tab-comments`)
and the counts theirs (`flag-count`, `leaks-tab-count`, `comments-count`),
set by `setRailCount`, which hides a count of nothing. `pressSideRail` lights
the button of the panel showing, and none while it is closed. The panel last
shown is kept in `textReader.sideTab`; at start-up `showSideTab` is called
with `draw: false`, since the Pages tab's state is declared further down and
`showSidePanel` draws it when the panel opens. The toolbar's ▤ Panel button
went with the strip: the rail does its job.

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
`refreshNocrButtons`) hands a page TRANSCRIBED by hand to PDF-Linker (which,
since Oct 20 at the owner's direction, KEEPS the page's text and writes its
export from it on every run, the PDF written too only where the page is a
scan: PDF-Linker's `Design Notes/Reader flags file.md`, "…and ✎ Use my text
is an instruction that lasts"; only the button's wording moved here):
`textFixed` (beside `noOcr` and `ocrAgain`, persisted with them) is written
by `formatValuesFile` as `text corrected: FILE | page N | sum XXXXXXXX`
(`textdoc.textFixedLine`) and read back by `parseReaderFile` into
`textFixed`, never into `values`. The sum is `textdoc.pageTextSum` — FNV-1a
over the UTF-8 bytes of the page's lines up to the authorities trailer
(`TRAILER_RE`), trailing blanks and the blank lines at the ends dropped —
which PDF-Linker's `_pn_page_text_sum` computes identically; both sides pin
the same values. (It cut at any rule line, "=… x …=", until the bug search
of Oct 7: a ruled line the operator typed, "= = = = =" or "== Exhibit A ==",
ended the page's text, and PDF-Linker's cut, the same rule, drew only the
text above it into the PDF and marked the page TEXT CORRECTED. Only the
trailer ends a page now, on both sides, pinned to the vectors 9b3e2d29 and
42fcfd5c beside 46d66a09, 811c9dc5 and a1d0b975.) A page carrying a line
shaped like PDF-Linker's own furniture — six "=" each side of a label, a
page header or a held page's heading pasted back with its text
(`TD.pageFurnitureLine`, PDF-Linker's `_pn_page_furniture_line`) — is not
handed over: `useMyText` says which line to take out, and `autoUseMyText`
passes it by, since PDF-Linker would refuse it. Never on Combined Text.txt
(`isCombinedHead`, the owner's decision of Oct 13): PDF-Linker reads the page
out of the document's own export, which a save there does not write.
`useMyText` takes the sum of the page as it reads at the click and notes the
page as pressed (`fixPressed`); the save then stamps each transcribed page of
a member it wrote with the text it wrote (`refreshTextFixedSums`, and the
same in the off-screen save, over `TD.fixedSumsFor`) — but ONLY where it
wrote the page (its sum moved from the file the write replaced, `m.base` /
`r.base` before the write) and the line was true of that file, or ✎ was
pressed there since the last save. It used to stamp every transcribed page
of every member written, and the bug search measured what that cost: a run
that could not apply the line (the PDF locked) rewrote the export from the
OCR, and the next save of that document — an empty Ctrl+S, an edit on
another page — stamped the OCR's reading as the operator's transcription,
which the next run burned into the PDF, marked TEXT CORRECTED, and spent the
line. The line now keeps its sum, PDF-Linker refuses it and says so, and ✎
pressed again hands over the page as it then reads. `test-stale-writes.mjs`
case 8 (Chromium) pins it; its negative control on the old code stamps the
run's text at the empty save. PDF-Linker applies a line only where the export's
page still sums to it, writes the page into the PDF's text layer, marks the
page (`_TEXT_FIXED_MARK_KEY`), spends the line, and exports the page under a
`TEXT CORRECTED` header (`headerSaysTextCorrected`). Adoption drops an entry
whose line was WRITTEN (it is in `valuesSavedKey`'s text with the same sum)
and is gone from the file on disk — spent by PDF-Linker — and takes in a
line on disk the list does not name; since the spent keeps, the same pruning
(`TD.spendLines`) also runs before every write of the file, and takes the
spent line off the record of what was written (see "A keep PDF-Linker has
spent", above) — and only where that record was written into this very folder
("Only what was written HERE is spent here"): a page line written into a
same-named copy, or saved by a download, is owed here, never spent. A page
that reads `[DID NOT OCR]` has
no transcription: the button is disabled there, `markDidNotOcr` withdraws an
entry for the page it strips, and `syncNoOcr` drops one for a page that
reads it. `#text-fixed-block` lists them.
**…and a page on the list leaves the operator's spacing alone** (`setFree`,
`markOwnLines`, `isFreePage`, `.page-body.free`, `.line.own`). The owner:
"I don't want use my text to change anything other than the spacial
correction when I try to line text up or indent it. Clicking the use my text
button alone should create no visible difference." (Three versions before
this one changed the page itself — off the PDF's grid, a fixed-pitch font,
its own type size — and each was turned down.) So pressing it changes nothing
on screen: `refreshFixButtons` (every `renderFlags`) calls `setFree(sec,
asked)`, which marks the body `.free` and notes its lines as they stand
(`__freeFrom`; for a page the save handed over after typing, its `typedFrom`),
kept per page in localStorage (`textReader.freeFrom`, keyed by the values
store, the document and its PDF page) so a reopened document still has them;
`buildPages` reads them back. `markOwnLines` (from the `dressLines` and
`dressColumns` wrappers, so every dressing pass, and from `afterTextChange`)
marks `.own` each line whose text is not one of those (matched as a multiset,
so a line moving up or down is not an edit). An own line is placed only by
its own spaces, a grid character each, as every line's spaces are: columns.js
gives it no `__colPlan` (alignColumns does not move its second column for the
font), and beside the PDF `applyMatchedLayoutNow` gives it no PDF places (its
cell spec keeps the row's face and size, `places: []`, so `placeLine` sets its
pieces on the page's character grid, `at(a)`), puts it at the page's text edge
(`charGridFit.x0`, else the least row left) rather than its row's, leaves it
out of the pairs `charGrid` is read from (it is evidence of where the operator
put words, not the PDF), and the spill pass passes it by. Its place down the
page, its size, its face, and every other line are as they were. Withdrawn,
the stored lines go and the page is dressed again as any page.
**…and its FILE laid out as its PDF lays it out** (`autoLayPage`,
`pdfsync.fileLayout`, `pdfsync.slotFit`; `textReader.autoLaid`). The owner,
later: "Let's have raw automatically update to match the layout, but my
manual editing should overwrite that", for the margin numbers, the indents,
each line's place on the numbers and the spacing within a line, on ✓ Use my
text pages only, as the page is laid out; and "I should also be able to
manually override any given indentation applied based on the match". This
supersedes "no visible difference" where the file was out of step with its
PDF: a line already where the PDF has it is left as it is, so a page whose
file matches its PDF still looks the same when pressed. After every layout
pass on the grid (`autoLaySoon`, debounced), under ✎ Edit, for each near page
that is `.free`, `.matched` and `.fixed`, not raw, swapped or shed, not
focused or composing and carrying no spot keep: the lines up to the trailer
are read (their one-space margin numbers set back first, `tidyGutters`),
matched to the PDF's rows by their words (`alignLines`), and each line's
pieces found (`lineItems`, past a number the line's text carried itself).
`fileLayout` writes them back: each piece at its column (`x0`, `unit`: the
character grid read off the page's pieces, `charGrid`, and kept with the
record so a page laid again never moves; with no grid to read, indents and
spacing are left alone), a column the file already has in one place within
two characters of the PDF's kept, a gap closer than `COLUMN_GAP` one space;
on a numbered page each line on the number its row stands at (the PDF's own
numbers, else `slotFit` over the rows the file's numbered lines matched),
never above a line before it, an empty half line dropped, the numbers written
to the page's last. The page is rebuilt like a raw edit (snapshot, so Ctrl+Z
puts it back; `buildBody`, `setDirty`), at most three times in five seconds.
A line the operator types after that (on the page or in ⇄ Raw) is not one of
the lines the record holds (matched as a multiset, by the file's text), so
`fileLayout` writes it back exactly as it stands and leaves it out of the
next record: laid out once, then the operator's. Lines Ctrl+Z puts back are
the operator's in the same way. A line's number put back on opening where
the line already carries it with one space (`restoreMarginNumbers`,
`numberedAs`) is read as that number. Tested in `test-pdfsync.mjs` and
`test-free-page.mjs` (section 9: drifted lines put back on their numbers, a
missing indent set, a one-space number, and an indent taken out by hand in
⇄ Raw staying out).

**# Number lines to 28 whatever the PDF's text carries** (`paperLast`). The
owner: "I had one only generate 1-23". With the PDF beside the page,
`numberPage` numbered to the last number the PDF's text layer carries
(`geom.last`), and an OCR that read the margin down to 23 and lost the rest at
the foot gave 23 lines; the layout then dropped any number past it. Both now
take `paperLast`: the highest number the PDF carries, and never fewer than 28
(`TD.MARGIN_LAST`) where line 28 still stands on the page at the PDF's own
pitch, as the ✓ Use my text layout (`autoLayPage`) already did.
`test-number-lines.mjs` section 3 numbers a page beside a PDF whose text has
only 1 to 23 and checks 1 to 28, each a pitch below the last.

**# Number lines on a poor scan** (`numberPage`, `TD.pageNumbersComplete`).
The owner: "I have a page where Number Lines is not available" and "number
lines should always create the lines in a single straight margin". The
button is offered until a page's numbers run complete (`pageNumbersComplete`:
the numbers climbing down it at least 80% of 1 to its highest, and on 60% of
its lines of text) — not only on a page with none, since an OCR that caught
three numbers made `pageIsNumbered` true and hid it. Pressed on a page with
some numbers, they come off and it is numbered from 1. Every line's text is
written flush after its number: the spaces a poor scan's OCR put in front of
a line are no indent of the filing's. And on a numbered page laid on the
export's grid read off the PDF, every line (one no row was matched to too)
has the grid's one left, so the numbers stand in one column.

**The walk through the key answers as the Leaks bar does** (`decideKey`,
`keyAnswerCell`, `setKeyAnswer`, `#answers-block`; `TD.setAnswer`,
`TD.answerFor`, `TD.answerLine`, `TD.FIX_RE`). The owner: "when I step
through the pseudonym key I should get the same yes no never, phrase and type
replacement options that I get for leaks." The bar was a reading only, its
keep and flag choices on each name's right-click. It now carries the Leaks
bar's Fix? row, one row at the top that never moves: yes, no, never, phrase,
the term's answer in words (`LK.classifyFix`, as a row's), a field for
anything else a Fix? cell takes, Apply and clear. An answer moves the walk on
to the next term, as Apply moves the review on.
- **no** and **never** are the right-click's keeps (`setKeepNow`): the mark
  goes here at once and the keep reaches PDF-Linker as its line.
- **yes** says the name is a pseudonym. Any case keep or answer on it is
  taken back, and nothing is written for it.
- **phrase** and a **typed answer** go as a new line of New Real Values.txt,
  `fix: VALUE | ANSWER`, kept in a list of their own (`answers`: stored with
  the flags, merged from the folder's file on adoption, spent once a run
  takes the line out, `TD.spendLines`, and one undo step each,
  `TD.decisionDelta`). PDF-Linker reads the line as the value's Fix? cell
  (its `_READER_FIX_RE`), so a new pseudonym, `~`, `*`, `**` and a kept part
  mean there what they mean in LEAKS.xlsx.

Phrase goes as an answer, not as the `phrase:` flag the selection pop-up
writes: a flag on a value the key already fakes whole comes off the list the
next time the key is compiled (`dropFlagsNowFaked`), and the answer must
stand until PDF-Linker spends it. A typed answer the same as the term's
pseudonym is a `yes`. One the same as the name itself is refused (a self-map
fakes nothing), and so is Excel's error text. A name the master workbook
keeps is answered only by taking it off the Master Keep. The name stays
marked as the key has it until PDF-Linker's run: a new pseudonym for a name
the exports carry moves a binding, which only its full run makes, and a
click of Re-run PDF-Linker does that run for it. The Flagged panel lists the
answers, each with a × to withdraw it. `test-key-answers.mjs`, and
`test-textdoc.mjs` for the line.

**A LEAKS row whose value the pages no longer carry is answered no**
(`answerGoneRows`, `liveTextOfDoc`, `liveTextOfFile`, `goneRowsSoon`). The
owner: "Clicking did not OCR should automatically mark no all flagged words
that appear only on did not OCR pages, same for when a use my text page has
deleted that word." The "flagged words" are the worksheet's rows (one row
per flagged value). Once the page carrying a value is stripped to DID NOT OCR
(`markDidNotOcr`), or the operator has typed it out of a ✓ Use my text page
(the `input` on a `.free` body, 1.5 s quiet), the export no longer carries
it: PDF-Linker never reads a DID NOT OCR page again, and writes a transcribed
page from the operator's text. Each row is checked if it is unanswered (no
cell typed, no pre-filled reading accepted) and names this document, or no
document at all. It is answered `no`, as one undo step, where its value
(whole words, `PK.buildMatcher`) stands nowhere else: on no other page of
the document as Save would write it, its DID NOT OCR pages left out, nor in
any other document the row names (every document of the folder where it
names none), read as Save would write them.

The exception is a name the key binds whose pseudonym stands elsewhere in
the case (`boundByKey`, `fakeStandsInCase`; or the folder not yet read for
pseudonyms, `caseIsRead`). A `no` is a keep: it retires the key's row, and
PDF-Linker's next run would un-fake the name wherever its pseudonym stands,
the failure that outranks a leak. Such a row is left unanswered and the
toast names it. Gone from the text, it is not asked about again after the
next run, which carries no decision for a value it finds nowhere.
`test-gone-rows.mjs`.

**Column boxes on a ✓ Use my text page** (`#colbox-btn`,
`makeColumnBoxAtSelection`, `boxKey`, `boxReflowSoon`; `TD.makeColumnBox`,
`TD.reflowBox`, `TD.boxBackspace`, `TD.isBoxRow`, `TD.boxAround`). The owner:
"Add the ability for me to insert column boxes when using use my text. That
way I can insulate the formatting changes for the causes of action from the
parties on a cover page" — written in box-drawing rules (as PDF-Linker writes
a form's), made from a selection with a button, a column's overflow wrapped
within it. ⊞ Column box makes the selected lines a two-column box, its divider
at the selection's start column (moved back to the start of a word it would
cut): each line keeps its number and its text split there into a left and a
right cell, a rule over and under as half lines (four spaces where a number
stands). Typing in a box row (`input`, 120 ms) sets the row back on the box's
rules (`reflowBox`: the top rule's joints, else another row's bars): a cell
whose text outgrows its width wraps word by word onto the column's next row —
in front of that row's text where it carries on in lower case, else the
column's rows move down one as far as its first empty row — and the box grows
at its foot, over the empty numbered line under its rule where there is one.
No other column moves. Enter in a cell breaks it onto a row of its own in that
column (`breakAt`), Backspace at a cell's head joins it to the cell above and
brings the column's rows below back up (`boxBackspace`; nothing on the first
row), and Delete at a row's end does nothing: the box is never joined across.
Each is a rebuild of the page from its text (`rebuildFromLines`), the caret
put back by its place in the file's text (`diskOffsetOfPoint`,
`placeCaretOnDisk`). The ✓ Use my text layout (`autoLayPage`) leaves box
lines as they stand. A box is drawn across the page's text (`across`, its
widest line past the margin number), so the right column is never only as
wide as what it holds; and its columns are sized by DRAGGING a divider or the
right edge (`boxDrag`, `TD.resizeBox`): the owner, "it created one tiny box
and one large box, but they are not adjustable". A rule is a pixel wide, so a
press within `BOX_GRAB` (6) px of one grabs it (`boxBarAt`, the cursor a
col-resize there); a dashed guide follows the pointer in whole characters
(read off the row: its outer rules and the file's columns between them), and
on letting go every rule of the box moves to the new column, every row is
set on it, and a cell's text that no longer fits wraps down its column (one
undo step). A column is never drawn narrower than `TD.BOX_MIN`; the left edge
does not move. Widening a column does not pull wrapped text back up: the file
does not say which rows were one item. Tested in `test-textdoc.mjs` and `test-free-page.mjs`
(section 10, a cover page's parties and causes of action).

**☐ Checkbox on a ✓ Use my text page** (`#checkbox-btn`, `insertCheckbox`,
`refreshCheckboxBtn`, `checkboxBody`). The owner: "add a check box insert for
text files that appears in the tool bar when I am in use my text." The button
stands in the top toolbar beside ✎ Edit, hidden unless the page the caret last
stood on is a ✓ Use my text page (`selectionchange`; a selection outside the
pages leaves it as it was, and `refreshFixButtons` hides it when the page is
withdrawn). Pressed, it writes `[   ]` at the caret, PDF-Linker's own empty
box (`TD.checkboxRanges`), so nothing new is needed to draw or save it
(`columns.dressCheckboxes`): a space after it unless one follows, a space
before it unless one is there or the caret is at the line's head. It goes in
by `insertText`, so the page's `input` paths run as for typing (a box row set
back on its rules, a numbered line's gutter spacing). With the caret on a box
(from its `[` to just past its `]`), the button ticks or clears it instead:
`[   ]` ↔ `[ X ]` (a `?` ticks), the same width, through `rebuildFromLines`.
That is the only way to tick one in the editor: an X typed into `[   ]` makes
a sixth character, which no longer reads as a box. Pressed with ✎ Edit off it
turns Edit on and puts the caret back. Each press is one undo step.
`test-free-page.mjs` section 11.

**A box's keys on every page, and a table ruled only between its columns**
(`boxKey`, `boxReflowSoon`; `TD.boxEdit`, `TD.openBoxAround`). The owner, of a
table of objections (Objection and Material │ Grounds Asserted │ Plaintiffs'
Response): "When editing in Text view, the column lines should not be broken
by backspace, and backspace should move only the text in that column up a
line. Likewise, enter should only move text in that column down." Two things
had kept the column-box keys off it. They answered only on a ✓ Use my text
page (`.free`), and only a box ruled on every side: PDF-Linker writes a table
the page rules only BETWEEN its columns (its rules starting and ending in a
`─`, each row a `│` between columns and none at either end), so a row read
as a box row but the caret in its first column stood left of every bar,
`boxBackspace` answered null and the browser joined the row onto the line
above across the table (the owner's screenshot: Backspace at "Exhibits"
broke every bar of the row). Now the keys answer on any page, and
`openBoxAround` finds such a table's open sides: the contiguous rows of the
same bars and the rule lines among them, the rule's first and last glyphs a
`─`, its joints the rows' bars. `boxEdit` makes the edit on the box CLOSED (a
`│` at the left where the rule starts, at the right past the longest row's
text, so no column is wrapped for the sentinel, the rules run on to it in
`─`) and takes the sides back off after, every rule put back as it stood
(found by its closed text, so a foot rule a grown box moved down comes back
too). Enter breaks the cell and sends the rest of that column down
(`reflowBox`, `breakAt`), Backspace at a cell's head joins it to the column's
row above (`boxBackspace`), Delete never takes a bar nor reaches past the
row's last cell, and a row typed in (`input`, 120 ms, any page) is set back
on its rules. Backspace or Delete inside a cell's text is the browser's, the
row then set back by the typing path. `boxBackspace` read the joined row back
off the line its own `put` had widened, so a join longer than the cell above
spliced a bar's worth of the old text into the next row ("depositionde" /
"position"); it reads off the row as it stood. Tested in `test-textdoc.mjs`
and `test-table-keys.mjs` (an ordinary page and a ✓ Use my text page).

The same table beside its PDF drew some of its lines between two numbers
smaller than the rest (the owner: "The pdf text is also all uniform in
size"). Measured on a table of the same shape: the export's rows, a row for
every column's own baseline (PDF-Linker's `_column_rows` note), put up to
three half lines between two numbers where the PDF prints one, and
`pdfsync.fitRuns` took those down to what the space holds (4.0 px beside
6.8 px). With the table written a column at a time no more half lines stand
between two numbers than the PDF prints there, and every row of it is drawn
at the PDF's own 11 pt against its 12 pt body (6.8 px), so nothing in the
reader changed for it: an export written before needs PDF-Linker run again.
`test-table-keys.mjs` section 3 pins it.

Each entry of `#text-fixed-list` goes to its page (`goToFixedPage`: found by
`pageEntryAt` on screen, or its document opened from `folderDocs` first, then
`goToPageFromList`); the Pages tab already tags such a page "Use my text".
`useMyText` turns ✎ Edit on (`setEditing(true)`) when it puts a page on the
list; withdrawing leaves it. `test-free-page.mjs` (Chromium) pins it, with a
control: on an ordinary form page beside its PDF the same spaces typed leave
the piece where the PDF prints it.

**↗ Open PDF in new tab** (`openPdfInTab`, `#pdf-tab-btn`, lit in
`refreshPdf` once `pdfSources` holds a PDF; app-web.js `__appOpenPdf`). The
owner asked, with a case folder open, for the corresponding PDF in a new tab,
"the pdf only, not the associated text file". The PDF is the reading page's
`pdfSources` entry (else the first one the export has, at page 1), and its
page is `PS.pdfPageOf`. Inside the app's shell the reader is an iframe tab, so
the shell opens it (`window.top.__appOpenPdf(file, handle, page)`: `newTab`,
the way a PDF opened from disk is). In the extension the reader is a browser
tab of its own: `window.open` on viewer.html, then the file is handed to the
new window's `__pdfViewerLoadLocal(file, handle)` once it has one (polled, as
the shell's `feedWhenReady` polls) and `__pdfViewerGoToPage`. The page is the
extension's, so its window is this one's to reach. The tab is opened BEFORE
the file is read: a browser lets a page open one only while the click is
fresh, and `getFile` is an await. The handle goes with the file, so the
viewer saves in place to the folder's PDF, behind its own check that the file
was not replaced since (`askStaleWrite`). `test-pdf-tab.mjs`
(Chromium) pins both paths: a browser tab on viewer.html at the page being
read with the folder's handle, and, on the site `pwa/build-site.sh` builds, a
viewer tab of the shell's and no browser tab; off for an export with no PDF.

**💬 Comments** (`commentSelection`, `openCommentPop`, `saveComment`,
`deleteComment`, `paintComments`, `docComments`, `commentSpan`; textdoc.js
`COMMENTS_HEAD`, `COMMENTS_RE`, `parseComments`, `commentLine`,
`commentsBlock`, `findPassage`). The owner asked for comments on the text
"like commenting on the pdf", preserved through successive runs, with any
real values in them faked. ✎ Use my text was the owner's first idea for
keeping them (the page's text, comment included, burned into the PDF's
layer); the owner chose instead to keep them as PDF comments. A full run
rebuilds every export from its PDF, so the PDF is the one place a comment
lasts: PDF-Linker writes each comment the reader made into the PDF as an
annotation, and every run writes the PDF's comments back into the export it
rebuilds (PDF-Linker's `_pn_sync_export_comments`, `_pn_comments_block`; its
notes, "Text reader comments"). The export carries them as a block after the
document's last page, `====== Comments (not part of the document) ======`
and one line a comment, `[c1] Page 3, on "passage": text [id rdc-…]`. That is
the My-Macros Markdown export's form for a Word document's comments, a
`[cN]` with the passage quoted (its `AddCommentEntry`): the quote is what
lets a reader, or a model reading the export, find the passage. The id is
the annotation's `/NM` (the viewer writes `pdfv-…`, the reader `rdc-` and ten
letters), which is how a run tells which PDF comment an edit is to.
**The block is the document's, not its last page's.** `parseExport` takes it
off the page's lines into `page.comments` (its raw lines, head first, up to
the next header or banner, so a Combined Text.txt member's block ends at the
next member), and `serializeExport` writes it back after them, byte for byte.
So the page's sum, Find, Replace all, the margin-number restore, the marks
and every other pass over `p.lines` never see it, and every save path, on
screen or off it, carries it, because each one writes
`serializeExport(memberDoc(m))` or a `cloneDoc` of it (`cloneDoc` copies the
array). `pageTextSum` and `pageFurnitureLine` cut at `COMMENTS_RE` as at the
trailer all the same (`pageCut`), for lines read some other way, since
PDF-Linker's `_pn_page_text_sum` and `_pn_page_furniture_line` do and the two
are pinned to each other under node. A comment changes the member's last
page of its span (`commentSpan`: its reel member, and within it a Combined
member) and marks that member dirty; the save's standing assertion reads the
whole member text, block included, so a bound real name left in the clear in
a comment stops the save as one on a page does.
**Disk text, shown through the key.** A comment's text and passage are stored
as the block writes them: what was typed is put through `forwardText` (each
bound real name as its pseudonym, kept values and cited decisions' names
spared, as the save's pass spares them) and folded onto one line
(`commentDisk`); it is shown through `translateRuns` as Show fakes says
(`commentShown`). The passage is the selection's disk text, margin numbers
dropped, folded (`passageOf`; first `COMMENT_ON_MAX`, 300, characters at a
word). On screen it is found again in the page's disk text by `findPassage`
(margin numbers skipped, whitespace one space, a wrap at the margin read
through), painted as the `comment` highlight a text node at a time with the
gutters left out (`diskRanges`), and a click on it opens the box
(`commentAtPoint`). Not on Combined Text.txt (`commentRefusal`), whose
comments are shown read-only, nor on a page with no PDF-Linker header. The
state is `var`, not `let`: `render` and `afterTextChange` reach it while the
module may still be loading. `test-comments.mjs` (Chromium) pins it: made,
marked across a margin number, saved with its real name as the fake,
reopened, read, changed and deleted from its passage; a block PDF-Linker
wrote shown and written back byte for byte by a save of other edits; refused
on Combined Text.txt. `test-textdoc.mjs` pins the block's parse, write and
`findPassage`.
**The author is the operator's own name** (`myName`, `setMyName`,
`AUTHOR_KEY`; textdoc.js `commentAuthor`, `commentAuthorRanges`). The owner
asked for their name on the comments they add, and for PDF-Linker not to fake
it there (2026-10-27). A comment's line carries it as `[by Name]` before its
id; the name is one line, no brackets, at most 80 characters. The setting is
the PDF viewer's "Your name on comments" (annotations.js, localStorage
`pdfViewerAuthor`): the reader and the viewer share an origin in the
extension, the desktop app and the site, so one name serves both, and a
`storage` listener in annotations.js takes up a change the reader makes while
the viewer is open. The box asks for it on a NEW comment only (`#comment-pop-me`,
filled from the setting, written back on Save comment); an edit keeps the
author the comment has. It is written as typed, not through `forwardText`, so
a name a party shares stays the operator's, and the save's standing assertion
reads past it (`realsLeftInExport` blanks `commentAuthorRanges` beside the page
headers), else a name the key binds would stop every save of that comment.
Only the author slot is spared: the same name in a comment's text is read as
any. PDF-Linker writes the slot only for the names its `comment_author`
setting gives, keeps them verbatim there, and leaves any other author out of
the export; it puts the slot's name on the PDF as `/T` for a comment the
reader made (its notes, "Text reader comments"). `test-comments.mjs` part 5
pins the box, the setting, the file and the save with a bound name;
`test-textdoc.mjs` the line and the blanking.

**S̶ Strike: words struck through** (`strikeSelection`, `applyStrikeOp`,
`dressStrikes`, `hideStrikeMark`, `atomStretches`; textdoc.js `STRIKE_MARK`,
`strikeRuns`, `strikeEdit`, `unstruck`). The owner asked for a way to mark
lines the PDF strikes through, since a strike "doesn't tend to OCR": in the
reader by hand ("where I highlight the text and press a button indicating where
the strike through was"), and from PDF-Linker only where it is very sure. The
owner chose the form, Markdown's `~~struck~~`, over a bracketed note, and the
PDF as the place it is kept, as a StrikeOut annotation, over a hidden
annotation or the text file alone (2026-10-23). Select the words and press
**S̶ Strike** (the Tools panel or the box beside a selection), Ctrl+Shift+X, or
K while the document is protected; pressed on words struck already, it takes
the strike off them.
**The file's form.** A run is on one line and never crosses a gap (two spaces
or more, a tab, a box-drawing rule); a `~~` opens a run where a character other
than a space or a `~` follows it and closes it where one precedes it; one that
pairs with nothing on its line is text (`strikeRuns`). PDF-Linker reads and
writes the same rule (`_strike_runs`, pinned to this one under node in its
`test_struck_text.py`). `strikeEdit` is the whole decision, in the page's text
as `flatten` reads it (the margin numbers blanked): each character of each line
the selection reaches is struck or not, the selection's are set (all struck
already, it takes them off; else it strikes them all), and the marks are
written again round each run of struck words, a run carried over one space and
stopped by anything else, so a strike beside a run joins it and one taken off
its middle leaves a run either side. A selection reaching into a name or a
spot keep takes it whole (`atomStretches`): a mark inside a name would part it
from its fake. It returns the marks to put in and take out, last first.
**The page's form.** The marks go in and out of the page's own text nodes,
where `strikeEdit` puts them (`applyStrikeOp`: an opening mark in the text
before the run's first character, a closing one after its last, beside a name
rather than in it), as a replace does: the names on the page, its spot keeps,
what was typed on it and its Esc'd names stand as they were, and the step is
one `snapshot`, one Ctrl+Z. Nothing reads the marks differently from any
other text, so the save is the file byte for byte. `dressStrikes` shows them:
each mark in a hidden span (`.sk`, `display: none`) and the run, marks and
all, in a wrapper drawing the line (`.st`, `line-through`), one wrapper a
stretch of the run's sibling nodes, so a run a face's wrapper parts still
reads struck. A wrapper and not a CSS highlight: the side-by-side layout wraps
and unwraps a line's text nodes for its faces and cells, which a live range
over them does not survive. columns.js reads a wrapper as one piece, and never
needs to cut inside one, since a run never crosses a gap. It runs in
`dressBody` and again after typing (`recolumnLater`), so a mark typed by hand,
or a partner typed away, is dressed or let go of once the typing stops.
**What a strike is not.** It is no word typed: the save hands a page over as ✎
Use my text only where its WORDS changed (`autoUseMyText` compares the two
texts through `TD.unstruck`), and PDF-Linker takes the marks out of a
transcription before it draws it into the PDF. It is made with the document
protected, as a comment is, being a command and never a stray keystroke. Not
on `Combined Text.txt`, which PDF-Linker writes again from the exports. A name
a struck passage wraps reads as the real name: PDF-Linker strikes a line at a
time, so the fake stands as "Ingrid~~" at one line's end and "~~Strangeways"
at the next line's head, and `~~` is one of pseudo-key.js's Markdown marks
(`MARK`, `MARK_STRIP_RE`, `MARK_CUT_RE`), which a name matches through and is
cut at, the marks staying in the text between its pieces. Its
residual: the four hidden characters stand in a struck line's text as the
side-by-side layout measures it, which shifts nothing measured on the
caption fixture (`test-caption-faces.mjs` with three runs struck: the sizes,
the faces and the spacing as they were). `test-strike.mjs` (Chromium) pins
it: struck on a line, into a name (the name whole, the file its fake), over
two lines and across two columns, saved; a name a struck passage wraps shown
real and struck; taken off a word in a run's middle
and put back by Ctrl+Z; refused on spaces; a run PDF-Linker wrote shown
struck, its marks hidden, and written back byte for byte by a save of other
typing; K taking a strike off; none on Combined Text.txt. `test-textdoc.mjs`
pins `strikeRuns`, `strikeEdit` and `unstruck`. (Since, 2026-10-25, the residual
above was measured wrong for every layout but the caption fixture's, and is
closed: the paragraph below.)

**A strike moves nothing** (`TD.strikeLayout`; columns.js `dressColumns`,
`pieceText`, `dressLineColumns`; rules.js `laidText`; `shownBlankingMarks`,
`planCells`, `placePages`, `autoLayPage`; pdfsync.js `fileLayout`). The owner:
"Strike through should not change the spacing in pdf viewer." The marks are
hidden and take no room, but every layout that places a line's pieces counted
them as characters. Measured on invented pages, struck words moved what stood
after them on their line: away from the PDF, a second column 25.6 px on and a
caption's ")" side 2.7 px; a ruled box's row its bar 5.3 px (the row then
read as a box of its own); beside the PDF, a struck item at the head of its
column (a "$500") 7 px short of the PDF's x, since the mark glued it to the
text before it. Now every one of them counts a line as it is laid out, its
struck runs' marks taken out (`strikeLayout`: the text, and its places carried back to the
file's, an opening mark going with the column it opens): the column cuts,
widths and bands (the cells are still cut in the file's own text), a box's
bars and a caption's side (`laidText`), the width a second column is placed
past (`pieceText` reads no `.sk`), the PDF's items found where a struck word
begins (`shownBlankingMarks` reads the marks as spaces, `planCells` starts the
piece at its mark), the grid fitted and each struck line set on it, and a
✓ Use my text page laid out as its PDF (`fileLayout`). Counted so, a strike
can leave a line's cells as they stand, and the place each begins in the
file is then set afresh on them (`dressLineColumns`): left as it was, the
PDF's x was looked up at the place before the marks, and two struck rows of
a schedule stood 15 px short (measured while this was made). The page is
also planned on its PDF again at once (`textEpoch`), not at the next scroll. The file is unchanged: the
marks stay where `strikeEdit` puts them, and the ⇄ Raw sheet, which shows
them, shows the line four characters longer. `test-strike-spacing.mjs`
(Chromium) pins it, read and edited, beside the PDF and away from it;
`test-textdoc.mjs` pins `strikeLayout`. (Taking the room out of the gap after
the struck words in the file instead was tried: it held the reading view and
the grid, but in the editor, where a gap's spaces are drawn, the next column
moved left by them.)

**A strike does not turn ✓ Use my text on** (tried and taken back, 2026-10-25).
At the owner's word ("Using the strike feature on a page should automatically
check Use my text") every strike put its page on the list for a while, and
PDF-Linker's nothing-typed refusal was narrowed to take such a page. Taken
back at the owner's direction the same day, once the scheme was set out: a
strike already outlives every run that rebuilds the export (PDF-Linker puts a
StrikeOut annotation on the words, and writes them back struck from it), and
✓ Use my text makes the operator's text the page's for good — kept, written
into a scan's layer, never OCR'd again — which a page only struck through
does not need. What stays: on a ✓ Use my text page a line struck after the
button was pressed is not taken for a line the operator set by hand
(`markOwnLines` reads each line without its marks; before, it lost its PDF's
placement). `test-strike-spacing.mjs` pins both.

**A half line under every margin number** (`halfAfter`, `pullUp`,
`moveIntoHalfAbove`, in `enterAtCaret`, `joinLineUp`, `backspaceAtCaret`,
`deleteAtCaret`). The numbered page's slots were its lines, so Enter stepped by
half a line only where an unnumbered line already stood between two numbers.
Now every numbered line has a half line under it: `halfAfter(line)` is true
for a numbered line followed by another (or by nothing), and that empty slot
is made a line (`newLineAfter`) only when text goes into it. Enter's cascade
stops there; Backspace at the head of a numbered line with an empty half line
above moves its text up into it (`moveIntoHalfAbove`), a second joins it to the
number; Delete at the end of a number is the first Backspace from the other
side. A half line emptied by any of them is taken out (`pullUp`, and Enter
and the join), so an empty half line is never a line of the file. Off the
grid a half line is a row, and the margin pitch (slotLines) spaces every
number for it; beside the PDF it stands between its numbers (`slotTops`,
`spreadTops`), which do not move. And beside the PDF a numbered page's lines
take their indents from the PDF BY SLOT (`pdfIndents`, `.line.pind`,
`--pdf-ind`): a numbered line's slot is its number's row, an unnumbered line
alone between 5 and 6 is 5.5 (two are 5⅓ and 5⅔), and the PDF row printed at
that height (within 0.3 of a pitch) gives the indent, its first piece right
of the margin less the margin (`bodyX`); CSS sets the line's text there and
takes the file's own indent back out (`--lead`). The owner, of the layout the
reader copies from the PDF: "it should do that when the indented line is
actually on 5.5". Display only: the file keeps its line numbers and its
spaces ("It is important that the text file has the correct line numbers").
A slot with no PDF row keeps the file's spacing, and so does a line set by
hand on a ✓ Use my text page. `test-half-lines.mjs` (Chromium) pins both.

**# Number lines** (`numberPage`, `.num-page` on every label with a page
header, shown only while the page is not `.numbered` and does not read
`[DID NOT OCR]`; `refreshNocrButtons` keeps it so). Writes pleading paper's
margin into a page whose export has none, as PDF-Linker writes it: " 7  text",
a bare " 7", an unnumbered half line behind four spaces. With the PDF open and
its printed numbers read (`geom`, its `rows`), each line is matched to its
PDF row (`PS.rowLayout`) and put on the nearest number, a tie within a
twentieth of a line of halfway to the upper (PDF-Linker's `_GUTTER_TIE_SHARE`);
a number claims the line nearest it and any other line between two numbers is
a half line (the rule the owner chose for PDF-Linker's export, #541); a line is
never put above the one before it; above line 1 or below the last number a
line is unnumbered furniture; the numbers run to `geom.last`. Without it, the
lines are numbered in order to 28 and the toast says so. The page's common left
margin and the blank lines above its text go, the Authorities cited trailer
stays after it, and it is one undo step (`snapshot`, `buildBody`, as
`markDidNotOcr`). `test-number-lines.mjs` (Chromium) pins both ways.

**…and ✓ Use my text with it** (`numberedUseMyText`, `handOver`,
`stepNumberedFix`). The owner: "checking number lines is supposed to
automatically check use my text". The numbers are the operator's, and a full
PDF-Linker run rebuilds the export from the PDF and would take them off, so
`numberPage` hands the page over as a press of ✎ Use my text does
(`handOver`, the press's own core), except where the press would refuse
(Combined Text.txt, no PDF page number, a furniture line) or the case
folder's list is not read yet; the toast says which. A page already on the
list stays on it. The numbering's undo step carries the entry it turned on
(`fixOn`), so Ctrl+Z takes ✓ Use my text off with the numbers and Ctrl+Y puts
it back with them (`stepHistory`); a withdrawal there is not a
`fixDeclined` one. Unlike a strike (tried and taken back, above), the
numbers are text PDF-Linker does not keep by itself. `test-number-lines.mjs`
section 1 pins the button, the undo and redo, and the save's `text
corrected` line.

**Tab indents** (`TAB_STOP`, `tabHost`, `gutterIndent`, `outdentGutter`). Tab
on an editable page or raw sheet puts in spaces to the next stop of four
(counted from the start of the line's text, after a margin number), and
Shift+Tab takes back up to that many before the caret; with a selection over
several lines each is indented or outdented at its start. The spaces go in by
`execCommand("insertText")`, which asks no `beforeinput`, so the handler takes
the undo step itself (`escNote`, `noteTyping`, `snapshot(body, true)`, under
`batchEdit`), as the paste does. A numbered line's indent, once the page is
built from the file, stands in its gutter (`TD.gutterPrefix` takes every
space before the text, `.gs`), out of the caret's reach: Shift+Tab at the
start of such a line's text takes it back from there, keeping the two spaces
the export writes after every number, and tells the page with an `input`
event. It used to move the focus off the page. `test-tab-indent.mjs`
(Chromium) pins it.
**…and without the click** (`autoUseMyText`, `noteTyping`, `forgetTyping`,
`fixDeclined`, `textdoc.wordsChanged`, `TD.AUTO_TEXT_FIXED_WORDS`), at the
owner's direction. A page's text just before the first keystroke on it is kept
on the page object as `typedFrom` (the `beforeinput` handler, after its own
refusals, and the paste handler), across saves, so two words corrected a save
apart count as two.
`saveDocument` takes each typed page's text as the typing left it (before the
forward pass writes a settled name as its pseudonym), and once the files are
written hands over every page of a written member whose words differ from
`typedFrom` in two or more (`wordsChanged`: the larger of the words taken out
and put in over a longest-common-run alignment, the common head and tail set
aside, so a line re-broken is no change), before `refreshTextFixedSums` and
the values file. Never a page that reads `[DID NOT OCR]`, one on `noOcr` or
`ocrAgain` (the operator's own word on the page stands), one already on the
list, or one in `fixDeclined` — the pages a click on ✓ Use my text took off
this session; the button itself asks again and clears that. ⊘ Did not OCR is
not swept in, at the owner's word: `markDidNotOcr`, `markDidNotOcrPages`,
`putStrippedBack` and `restoreSnapshot` of a step tagged `nocr` (the strip
undone or redone) each `forgetTyping`, so neither the strip nor the typing
before it hands a page over. Checked in Chromium (Playwright, not committed):
one word typed is not handed over, two are; a page typed on and stripped is
not; withdrawn, a page is not handed over again; a strip undone is no typing.

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

An answer not yet saved is remembered in `localStorage` (`leaks.decisionsKey`:
the case folder's id, and the worksheet's name) and laid back over the sheet
at the next attach. It used to be remembered by SHEET ROW NUMBER alone
(`{ row: { base, fix } }`) and laid back wherever that row's cell still read
as `base` — which, for a row nobody had answered, is `""` on every row of
every worksheet. PDF-Linker rewrites `LEAKS.xlsx` on every run and sorts it as
it writes (`_pn_write_leak_report`: undecided rows first, decided ones
sinking, a misspelling's family pulled together), so after a run a row number
names another value. Measured in Chromium: a `no` left unsaved on row 2,
"Riverside County", came back on the witness the run sorted into row 2, a name
the key binds. `mirrorLeakKeeps` made it one of the reader's keeps, so the
orange mark went; a one-space edit and Ctrl+S saved without a warning, wrote
`no` for the witness into `LEAKS.xlsx` and `no: <the name>` into
`New Real Values.txt`, and left the name in the export, where the next run
would keep it. The folder toast read "every row answered" on the strength of
answers given to other values. Two matters whose folders share a leaf name
share one store entry, so the same happened across cases. (The store is named
by the folder's own id now, not its leaf name — "Each folder is itself" in
Design Notes/Text reader layout and navigation.md.)

So `packDecisions` stores each answer with `id`, `leaks.rowIdentity` of its
row: a digest (two FNV-1a passes, one from each end, 64 bits) of the folded
Value, File and Context cells (the Context's original half only, since
2026-10-13: "Acceptances are not answers, and the export half is not the
row", below). Value is how PDF-Linker tells one row from
another (one row per value); File and Context are what tell one CASE's row for
a value from another's (below). It is a digest so that the store gains no real
text. The value and its sentence are what an export must not carry, and this
storage is the browser's, not the case folder's. `unpackDecisions` lays an
answer only on the row with that identity, wherever it now stands, and only
while its cell still reads `base`. Accepted suggestions
(`{ id, base, ok: true }`) get the same check, so an acceptance of "Vazqez"'s
pre-filled `~Vazquez` is not taken for a sibling spelling sorted into its row
with the same cell. Two rows of one sheet can share an identity: PDF-Linker
groups by lower case, the fold also collapses spaces. Those rows take answers
by row number, and only while every answer stored under that identity still
stands on one of them. It returns `{ laid, dropped, legacy }` (and an
`accepted` count since, below). An answer that
found no row of its own (the value gone, found in other files or quoted from
another sentence since, a different case's sheet read under the same store) is
`dropped`. One stored before identities existed, with no `id`, cannot be
checked at all and is `legacy`, discarded unread. `attachLeaksNow` writes the
store again at once with only what was laid back, so the leftovers are said
once and then gone, and leaves the sentence on `leaks.note`. `leaksNoteOnce`
hands it to whichever toast follows the attach: the attach's own, the folder's
(`adoptFolderNow`), the lone file's (`attachKeyForFile`) or Read the whole
folder's. A toast is a single element, and a notice made inside a quiet attach
was written over by the folder's own toast a moment later. The folder toast
also says how many answers are here and not yet saved (`leaks.carried`),
"every row answered" included, since an answer only the browser holds is one
the next run will not see. Losing an answer costs a click to give it again;
laying one on the wrong value keeps a real name in the clear.

The digest first held Value and File alone, on the ground that two matters
whose stores coincide and whose sheets flag one value in a file of the same
name are asking the same question. They are not: `no` is "leave it, in this
case" (`classifyFix`), and a keep on Jordan the country in one matter is not a
keep on Jordan the plaintiff in another. Nor does the File cell always name a
file: for a value found in more than three, `_pn_write_leak_report` writes "N
files", so any two sheets flagging one word in four files matched. The store
is named by the case folder's id now ("Each folder is itself" in Design
Notes/Text reader layout and navigation.md), which keeps two folders both
called Pleadings apart, but not every worksheet is read under one: a sheet
picked or dropped with no folder open is stored under the lone document's FILE
name (`leaksStoreKey`: `stateFolder() || fileName`), or under nothing with no
document open; one picked by hand while a folder is open, under that folder's
id; and without IndexedDB a folder is known by its name. Measured in Chromium
before this change, two matters each opening `Complaint.txt` and `LEAKS.xlsx`
on their own: matter A answered `no` on "Jordan" ("imports from the Kingdom of
Jordan") and did not save; matter B's sheet, through Open LEAKS…, flags its
plaintiff Jordan, whom its key binds, in `Complaint.pdf`. The `no` was laid on
him (the toast: "1 answered here and not yet saved"), `mirrorLeakKeeps` made
it a keep, the orange mark went, and a one-space edit and Ctrl+S saved without
a warning and wrote `Jordan = no` into B's `LEAKS.xlsx`. So the Context cell
is in the digest: the first sentence PDF-Linker found the value in, real half
and scrubbed half, which two matters practically never share. A re-run that
quotes the value from another sentence drops the answer and says so, the safe
direction. Same script after: B's row is undecided, no keep, the mark stands,
the toast says "1 unsaved answer from an earlier session was discarded", the
save warns "1 real name not yet reviewed was NOT faked — Jordan", and B's
`LEAKS.xlsx` is untouched. What can still go across is one value in one File
cell quoted from one sentence, read under one store: a form's boilerplate
printed alike in two cases, read without a folder.

The Context makes the digest dearer, and `packDecisions` runs on every
decision over every answered row: measured in Node with Contexts of 566
characters, a 300-row sheet answered row by row spent 1.7 s hashing (0.26 s
with Value and File alone), and at 20,000 answered rows a click cost 0.4 s.
`rowIdentity` remembers each row's digest on the row (a `WeakMap`, checked
against the three cells it was worked from, so a row changed under it is
hashed again): the same 300 decisions take 6 ms. `unpackDecisions` still
hashes every row once per attach where anything is stored — 0.4 s for 20,000
rows of such Contexts, about 10 ms for a sheet of 300 — and what it hashes is
remembered for the decisions after.

**Acceptances are not answers, and the export half is not the row**
(`unpackDecisions`' `accepted`; `rowIdentity` over `splitContext`'s
`original`; `wholeContextIdentity`; `saveLeaks`' `persistLeaks`). The
2026-10-13 re-check of the rules above found two ways an answer was lost, or
miscounted, and both are closed:

- An ACCEPTED suggestion writes nothing to the workbook (the cell already
  says it) and so is remembered in the store or nowhere, yet Save LEAKS.xlsx
  removed the store with the answers it wrote (`localStorage.removeItem`), and
  after a reload or a folder read the suggestion was asked again. It was also
  counted as an answer: in `laid` ("1 to answer, 1 answered here and not yet
  saved" of a sheet with nothing to save), and once its row had gone — most
  often because a run applied the very suggestion — in `dropped` ("1 unsaved
  answer from an earlier session was discarded … Answer it again"). Now
  `unpackDecisions` returns `{ laid, accepted, dropped, legacy }`: a laid-back
  acceptance counts in `accepted`, never `laid`; one that finds no row of its
  own is retired without a word, never `dropped` (nothing anybody gave is
  lost with it), and so is one among the legacy entries; the attach's toast
  and the folder's count `laid` alone as "not yet saved"; `attachLeaksNow`
  stores the sheet again whenever anything was stored, so what found no row
  is gone from the store; and `saveLeaks` stores the rows again once it has
  written them (`persistLeaks`), which leaves the acceptances.
- The Context cell stacks two quotes, the document's sentence above
  `CONTEXT_RULE` (from the cached unscrubbed text) and the export's below it,
  and the export's moves whenever something ELSE in the sentence is decided.
  Measured on PDF-Linker's own worksheets (a full run, a `yes` saved on "54",
  Apply Fixes, a full run): the rows "Halden Brookmere, 71," and "Odile
  Varnecke, 45," quoting one sentence came back with ", 49," below the rule
  and nothing else changed, and laid back, two of the three unsaved answers
  were thrown away as "changed or gone since". The digest now takes the
  ORIGINAL half only (`splitContext`, line breaks read as "\n" first; the whole
  cell where there is no rule, the two quotes being the same): the document's
  sentence, which no decision moves and which still tells two matters' rows
  apart as the whole cell did. For one release `unpackDecisions` also knows
  an answer by the identity the build before gave its row
  (`wholeContextIdentity`, the whole cell; worked out only where a stored
  answer matches no row's own), so the answers that build stored are laid
  back rather than thrown away once by the change, and the attach stores them
  again under the row's own identity. **Take `wholeContextIdentity` out in the
  release after this one.** PDF-Linker's half of the same finding — its File
  cell and Context sample taken in the order the files were met, which the
  full run and Apply Fixes walk differently — is its #516
  (`_pn_write_leak_report`, `_pn_natural_key`: one order whatever the run
  met), whose CLAUDE.md format line names the File and Context columns and the
  Context's original half as what names a row across runs.

`test-leaks.mjs` pins both (`3155cb140655299e` is e8df959's identity of its
fixture row, which `wholeContextIdentity` must reproduce);
`test-folder-save.mjs` case 36 pins the acceptance's toasts, the save, the
reload and the row gone quietly, and case 37 the answers kept through a
moved export half and one stored under the old whole-cell identity.

**The rows still to answer are marked before the walk reaches them**
(`sheetMatcher`, `pendingSheetRanges`, `::highlight(leakrows)`). Only the row
in front used to be marked (`leakrow`), so a value the worksheet was already
asking about stood unmarked on the page, was flagged as a find, and turned up
as a row a few clicks later: a flag handing PDF-Linker a value it had raised
itself. Every value with a row is now read in the document-wide pass
(`scanPassNow`, off `flatten(body, { blankPn: true })` as `leakMatches` reads
the row in front, under one `PK.buildMatcher` per worksheet, memoised on
`leaks.parsed`), and `scanStale` counts the worksheet's identity with the
text, key and keeps. The pass reads every row, answered or not, and keeps
`sheetHits` (`{ range, fold }`, a possessive and a gap folded back to the
row's value by `sheetFold`); which of them are pending is sorted out when the
marks are painted (`paintRowMarksNow`), so a decision repaints them without
reading the page again. Left out: the row in front (it has its own mark) and a
value the key binds (`boundByKey`), which standing unfaked is the key's
orange already and inside a cited decision is no leak. They show whenever a
worksheet is attached, the bar open or not, and go with `giveUpOnMarks`.
Lighter than the row in front, with a dashed underline. The flag follows the
mark: a selection that is a pending row's value word for word
(`pendingRowIn`, `wordsOf`) is not flagged by 🚩's release or Ctrl+Shift+F,
and the pop-up says so with **Answer its row…**, which opens that row in the
bar without moving the text (`goToLeak(i, { locate: false })`). A selection
with more than the value in it is still flagged whole, as with the key's
orange.

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

**‹ goes back the way the review came** (`leaks.trailBack`, `trailForward`,
`trailMove`, the trail on `leaks.trail`). A decision moves to `nextUndecided`,
which is seldom the next row down the walk: the rows between are answered, or
the walk wraps to the top of the document or goes on to the next. ‹ used to be
`stepFrom(-1)` from where the review had landed, so it went to whatever stood
before the new row, often a row still to answer in another document, and never
to the row just answered. `goToLeak` now records the row it leaves
(`trailMove`, which also drops the way forward) on every move but ‹ and ›
themselves (`trail: false`, `leakBack`/`leakForward`, the buttons and
Alt+↑/↓); ‹ goes back to that row and leaves the one it went back from for ›,
as a browser's Back and Forward do. With nothing to retrace each steps along
the walk as before (`stepFrom`), and records that step too, so ‹ then › comes
back to where it started. During a page sweep the bar still shows the row just
answered while the text stands on a name; ‹ goes to that row. The trail is one
per worksheet (every attach makes a new `leaks`), its entries being row
indices.

**Instance ‹ › steps the value in front through where it stands**
(`stepRowInstance`, `stepNameInstance`; Alt+, and Alt+.). Row ‹ › and the
names bar's Name ‹ › go from one value to the next, so the other places ONE
value stood — what a decision about it is a decision about — could only be
scrolled to by eye. In the LEAKS bar the instances are `leakRowRanges` (the
row's mark, every place it stands on the pages on screen) put in reading
order by `compareBoundaryPoints` (a value wrapped down a column is found
after the page's plain hits); stepping moves `rowHere`, `leakHere` and the
strong mark and leaves `leaks.at` and the trail alone, and `rowInstanceAt`
finds the one standing by where its range starts, since the ranges are made
again at every paint (`rowInst`, its number, where its page was rebuilt).
`renderRowInstance` writes `#lb-inst` after every paint. A page sweep in
progress ends, as ‹ ends it. In the names bar the instances are the stops of
`liveLeaks()` with the same `settledKey`; `stepNameInstance` sets `leakStep`
one short and calls `stepLeak`, so the walk stands where it lands (Name ›
goes on from there) and never leaves the document. The keys go to whichever
walk put the mark where it is: the names bar's when `leakHere` is not
`rowHere`. Each label and its arrows are one `.lb-pair`, so a narrow window
wraps them whole.

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

**PDF-Linker has one launcher, and the reader names only it** (2026-10-14).
PDF-Linker retired its `Apply Fixes` launcher: `Re-run PDF-Linker` now passes
`--auto` and decides for itself whether a click needs the full run (a new or
changed document, an updated PDF-Linker or setting, a keep on a name the
exports carry faked, an instruction typed into the key, a flag on a name half
faked) or only the text-only pass that `Apply Fixes` ran (PDF-Linker's notes,
*Launchers, deferral and copying*, "One button"). So every message that told
the operator which of the two to double-click — the LEAKS save's hint and
toasts, the Flagged panel's hint, the flag and phrase toasts, the combined
file's status note, `instructionNote`, the ordinary-word pseudonym toast —
names `Re-run PDF-Linker` alone, and where a full run is what it will take,
says so as what the click will do rather than as a choice. The header the
reader writes into `New Real Values.txt` (`VALUES_HEAD`) says the same; it is a
comment PDF-Linker skips, so no format moved. The ordinary-word toast names the
one way to force a full run where nothing else asks for one: deleting
`PDF-Linker Run Record.json` from the folder.

**The way back spares what the way out spared** (`TD.compileDisplay`,
`PK.compile(key, { spare })`, `PK.ownFakesOf`). The reverse matcher reversed
every fake, including one standing inside a cited decision's name that
PDF-Linker had spared: "Smith v. Jones (2010) 50 Cal.4th 100" in a case where
"Smith" is also the plaintiff's fake read "Coderre v. Jones" on the page, and a
copy carried the wrong citation in the real names, which no check for a fake
left in the text can find. `compileDisplay` gives the reader's `rev` a `spare`
that runs `citedNameSpans` over the page (with `next`, for a year on the
following page), and `runsWith` drops every hit touching one of its spans, so
the fake stays as text rather than becoming a pseudonym run. Every reverse
path goes through `rev` (buildBody, `laidOut` for Find and `pageScan`,
`clearReading`, `pageLinesShown`), so the page, Find, the folder's ⚠ and the
save read a cited name the same way. The caption exemption is asked of the
FAKES (`ownFakesOf`: the fakes the key's `own` rows went out under), since the
page holds those: PDF-Linker faked this case's own caption cited with a year,
and it reads back. The spare is computed only where a page has a fake to
swap. A matcher compiled without `spare` (`PK.compile(key)`) still reverses
everything, which is what the folder-save parity test used until it was
pointed at `compileDisplay`. Tests in `test-textdoc.mjs` ("cited names on the
way back"). The Claude extension does the same on claude.ai.

**▶ Re-run PDF-Linker** (`rerunLinker`, `folderLauncher`, `openLink`,
`saveAllForRun`, `closeForRun`, `letGoOfFolder`; `textdoc.launcherFolderToken`,
`rerunUrl`, `runRequestText`, `RUN_REQUEST_FILE`; owner's request, 2026-10-22).
A page can neither start a program nor learn the path of the folder it was
handed, so PDF-Linker does both halves: each launcher it writes records its
folder on a comment line (`Folder, for the text reader's Re-run button:
<base64url path>`, `_launcher_folder_line`), and `Register Reader Button.bat`
(PDF-Linker's `--register-reader-button`, a one-time setup at the owner's
direction: no run writes the registry) registers the `pdf-linker:` link for
the Windows user. The click opens `pdf-linker://run?f=<token>&d=<folder
name>&n=<nonce>` FIRST, because Chrome starts an outside program only on a
click and the save can outlast the click's activation by minutes; the link is
an anchor clicked with the beforeunload guard held off (`openingLink`), since
an unsaved document would otherwise put "Leave site?" in front of it. A
folder permission prompt answered at the click spends the activation, so the
button then asks to be pressed again (`navigator.userActivation`). PDF-Linker
(`_serve_reader_request`) waits up to 15 minutes for `PDF-Linker Run
Request.json` in the folder with the same nonce: "go" once `saveAllForRun`
has written everything (`saveDocument`, then `__pdfViewerSave` in each PDF
mode frame with unsaved changes, then `hasUnsaved()` must be false), "cancel"
otherwise, so a run never starts on a folder half saved. The nonce is also
the authority: any page can open the link, only one holding the folder can
answer it. PDF-Linker deletes the file as it starts the launcher, which is
the reader's sign the run began; only then is the folder closed: the app's
tab by a `textreader:close` message to the shell (which toasts what is
running), the extension's tab by `chrome.tabs.remove`, else the folder let
go of without being forgotten. Not taken within `RERUN_PICKUP_MS` (90 s), the
reader takes the file back and leaves the folder open. A launcher from an
older PDF-Linker records no folder, and the button says to double-click it
once. Tests: `test-textdoc.mjs` ("launcher folder token", "rerun link"), and
PDF-Linker's `tests/test_reader_rerun_button.py`.
