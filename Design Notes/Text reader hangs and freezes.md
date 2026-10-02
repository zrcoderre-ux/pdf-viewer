# Text reader: hangs and freezes

### THE HANG: a page's text had no ceiling

Chrome's own code for it was `RESULT_CODE_HUNG` — the tab killed for not
answering, not for memory — and the breadcrumb named the place: the line grid,
page 2 of a 54-page Complaint.pdf.

A page's text layer is usually a few hundred items, a word or a line each. A
page set character by character is a different animal: a caption positioned
glyph by glyph, or a scan whose OCR wrote an item per letter, carries hundreds
of thousands. Nothing downstream was bounded against that. `getTextContent`
accumulates every one; the grid sorts and groups them; the selectable layer
builds a DOM node for each. Built as a test — a 54-page PDF whose page 2 holds
500,000 text items — the reader held the thread for 10.3 seconds on that one
page and the tab stopped answering for twelve, on a fast machine with nothing
else to do.

`textItemsOf` reads the text as the stream pdf.js already has and stops at a
ceiling. Past `PAGE_ITEMS_MAX` (20,000) the grid leaves the page off the grid
and the pane draws it without a selection layer — which is what a page with no
text layer at all already looks like — and the console says which page and
why. Same page, same test: no holds at all, and 19 ms the worst the tab took
to answer.

The redaction sweep takes the same reading through a far higher ceiling
(`REDACT_ITEMS_MAX`, 200,000) and REPORTS reaching it, because there the
question is different: text the sweep never read is a value never blacked out,
and a copy made to hide something must not quietly skip a page. Slow is the
right answer for a check the operator asked for and is watching; silently
short is not. Any such page is named in the toast, to be marked by hand.

### THE FREEZE: a party's words were unbounded

Four rounds of this were spent on memory, on the PDFs and on the passes, and
the answer was one regular expression.

`citedNameSpans` blanks the names of DECIDED CASES out of a document before
the folder sweep looks for names left in the clear — a party of a cited
decision is that decision's, not this matter's. A party was written as
capitalised words repeated without a bound:

    [A-Z][\w.'-]*(?:(?:\s+(?:of|the|and|…)\s+|\s+)[A-Z\d][\w.'-]*|…)*

A run of capitalised words that is NOT a case name is what that costs most.
From every word in the run the engine tries every length the party could have
been, and gives up on each only for want of a " v. " after it: the run
squared. A declaration is full of such runs — the jurat, the caption block,
the signature block, a list of exhibits — and a gap spans a newline and the
pleading gutter number with it, so a page of capitalised lines is ONE run, not
thirty. Measured: 2,000 words of a jurat in a second, 4,000 in four, 5,700 in
four and a quarter; a caption block of 400 pleading lines in 678 ms, growing
fourfold for every doubling. Extrapolated to a few thousand lines it is the
twenty-one-second task the operator's console reported, and the tab does not
come back from it.

The citation engine proper had this right — `citation-linker.js` writes
`(?:\s+${_PARTY_NEXT}){0,4}` and `{0,5}` — so the fix is the house's own:
`PARTY_WORDS` counts them. Eight, which is longer than the engine allows and
still a fixed handful of work from each place. The same bound goes on
`SUPRA_RE`, which has the same shape and the same appetite.

The result is linear: the jurat at 34 KB falls from 4,175 ms to 13 ms, 533 KB
of it reads in 252 ms, the caption block falls from 678 ms to 7 ms, and the
whole per-document sweep pass over a 419 KB declaration is 40 ms. A long
institutional party spans exactly what it spanned before — the pattern could
never cross the two small words of "of the State", whatever the count allowed,
so the bound took nothing away.

And the sweep names a document that took more than `SWEEP_DOC_SAY` to read.
Nothing said which file was being read when the reader went down, which is
most of why this took four rounds.

### A pass IN FLIGHT is a pass, and it is not an extension

The first report said `NOT one of the reader's own passes: something else on
the page (an extension, most likely)` for a twenty-two second hold that was
almost certainly the reader's own. `passes` holds the ones that FINISHED — a
pass records itself when it ends — so a task that ran inside a pass still in
flight matched nothing. On a reader whose heavy work is async by design that
is most of them, and the line sent the search after an extension that was not
there.

`passesInFlight` answers it off the doing stack: which passes were open when
the task began, and how long each had been running. Where a completed pass
matches, the line names it and adds what was open beside it; where nothing
matches and nothing is open, the line says so, which is now a claim worth
something. The long-lived passes also say WHERE they are as they go
(`noteDoing`) — the line grid names the page and the PDF, the folder sweep and
the folder-wide find name the document — so both the report and the breadcrumb
point at a place rather than at a pass that has been open for a minute.

And the operator's own figures settled what the trouble is not: a tab at
221 MB with a 54-page document and a 15 MB heap is not short of memory. It is
one task that ran for 21.7 seconds.

### …and what KILLED it, at the next open

A hold that is reported after the fact is a hold that ended. The long-task
observer runs after a task, so a task that hangs the tab until the browser
kills it never has an after, and a killed tab writes nothing at all — which is
the failure the operator was actually hitting, and the reason the console
report above did not answer it.

The breadcrumb covers that case and always has: a pass writes its name to
localStorage BEFORE it starts (`markDoing`), so a name still standing at the
next open is a pass that did not come back. Three things make it answer:

- It is written to the CONSOLE at the next open, not only into the offer bar —
  `[Text Reader] LAST SESSION DID NOT FINISH: it stopped while …` — since the
  console is what can be copied out of a session that died.
- It carries what the reader was HOLDING (`noteCarrying`, refreshed at most
  every two seconds because asking costs a walk over the column): the pass
  alone does not say whether it went down under six hundred pages or two.
- The passes that were nameless are named, so the breadcrumb points at the
  right one: every page DRAWN says which page of which PDF, the pages drawn
  ahead for the worksheet say so, and `saveRedactedCopies` — every page of a
  PDF at 200 dpi, held as an image until the copy is assembled, which is the
  heaviest thing the reader does — says so too.

Driven in Chromium by killing a tab mid-pass and reopening it: the next open
says which pass it stopped in, on which file, carrying what, and how long ago.

### The reader says what held it, in the console

Three rounds of this were diagnosed from a synthetic folder, and each round
fixed something real that was not the thing the operator was hitting. The
report existed — `__textReaderBlocked()` — but asking somebody whose tab has
stopped answering to type a function call into a console is asking them to
diagnose it themselves.

So a hold says so where it can be copied. Past `HOLD_SAY` (300 ms) the long-
task observer writes one line, at most one every `HOLD_QUIET` (1.5 s) with the
rest collapsed into a count: the pass that did it and what the reader was
carrying at the time (`holding()`: pages live of pages held, members on the
reel, PDFs open, pages drawn, documents read ahead, the js heap where the
browser reports it, the worksheet's rows, the key's bindings). The line
distinguishes the two kinds of hold, which is the thing worth knowing:

    [Text Reader] held the thread 315 ms — opening the document · 200 of 200
    pages live, 1 on the reel, 0 PDFs open, 0 drawn, 0 read ahead, 14 MB of js,
    key 156

    [Text Reader] held the thread 700 ms — NOT one of the reader's own passes:
    something else on the page (an extension, most likely) · …

For the second line to mean anything, the reader's own heavy passes have to be
named, or one of them would be reported as somebody else's: `reelAllLive`
(which the leak review asks for, and which builds back every page of the reel),
`reelTrim`, `buildPdfPane`, `applySwaps`, `applyPageWidth`, `paintRowMarks`,
`renderDocList`, `markDocAlerts` and `renderLeaksTab` now run under `during`
with the rest.

And `oneDocAtATime` is size-aware, which is the count-versus-size mistake made
a third time: six two-hundred-page exhibit sets are four exports short of
`BIG_FOLDER` and carry six times the pages the number was drawn for, so the
leak walk fetching one document at a time, the reel's lower ceiling and the
sweep waiting for a gap all stayed off for exactly the folder that needed them.
`BIG_PAGES` (120 pages on screen) turns them on.

### The extension reading its own reader

The reader hosted over https is an ordinary website to this extension's own
citation content script. With citation links turned on for every site (or for
the site the reader is hosted on), `content/claude-citations.js` was injected
into the reader's own page — where the citation engine is already running —
and it does not scan a paragraph at a time: `scan()` walks the WHOLE document
into one string on every DOM change, debounced 400 ms, and `paint()` asks every
citation in the document for its rectangles on every scroll frame. The reader's
DOM is a case folder being built, laid out, shed and drawn continuously, so the
scan is re-armed by work it cannot see the end of.

A page that links its own citations now says so — `<meta name="citation-linker"
content="own">` on the reader, the PDF viewer and the PWA shell — and the
content script stands down where it finds it (`CitationSiteRules.isOwnLinker`).
Driven in Chromium with the real extension loaded and citation links on for all
sites, over a 200-page export: five long tasks of 229–361 ms that the reader's
own report could not name (they are not the reader's passes) become none, and
the overlay it laid over the reader's own goes with them.

### The sweep's masking: one pass, not one per name

`blankRanges` blanks the cited names out of a document's text before the folder
sweep looks for names in the clear. It rebuilt the whole string for each range
in turn, which is the text copied once per cited name: **1,111 ms for a single
439 KB export**, and the sweep does it to every document in the folder and
again whenever a keep moves. Under the profiler it was the largest single thing
the reader did — 1,166 ms of self time in a 25-second reading. The pieces are
cut once and joined instead: 6 ms for the same document, and it no longer
appears in the profile at all. The ranges are sorted and clamped inside the
function rather than trusted, so order, overlap and a range running past the
end of the text all give the same answer they always did.

### The thread, not the memory: "Loading…" and the freeze

A folder of huge PDFs held the tab still even where it did not fill it, and the
first slot sat on "Loading…" while nothing answered. Three passes were holding
the thread, all of them invisible on a twelve-page pleading and crippling on a
two-hundred-page exhibit set.

**The open measured every page before it answered.** `openPdfNow` got every
page's size first, because the pane needs a size to lay a slot out. Each is a
round trip to the worker, and after each one the idle deadline the loop was
holding had expired — so it waited for another, one idle callback per page, up
to a quarter-second each. Nothing about DRAWING a page needs those sizes (the
render asks the document for the page itself), so the document is handed back
as soon as pdf.js has it and `measurePdf` fills the sizes afterwards, in
batches of `SIZE_BATCH`, in the queue with everything else. Slots stand at the
folder's paper until their own page is measured. `pdfSizes` holds the same
array the measuring fills, so a slot sized later gets the pages as they land.

**The grid read the whole PDF, page 1 first, with no yields.** `readPdfGridNow`
now runs in READING ORDER (`gridOrder`: from the page the reader is at, on to
the end, then back over what is behind) and is paced off the clock rather than
off a spent idle deadline, laying the pages read so far on their grid at each
yield. Opening a 200-page exhibit set at page 150 no longer reads 149 pages
nobody is looking at first.

**The layout pass re-measured the whole document every time it was asked.**
`applyMatchedLayout` is asked again as each batch of sizes lands and as each
slice of grid does — twenty times over on a long document — and the pass held
the thread for 1.5 seconds at a time. Two memos and a window fix it:

- `shapePages` writes each page's shape (a write, no reading) but MEASURES the
  fit only within `FIT_SCREENS` of the reading, since the fit is four passes of
  reading every page's scrollHeight after writing every page's minHeight, and
  a read after a write lays out the whole document. `fitNearSoon` fits the
  pages the reading comes to, on the scroll; printing asks for `{all: true}`.
- A page remembers what it was shaped for (`__shapedFor`, `shapeKey`) and one
  shaped for this already is passed over. The key is the MEASURED width, not
  the width the settings ask for — they differ for a moment while a column is
  re-laid, and a fit measured in that moment must not be remembered as the
  answer — plus whether the page is beside the PDF, its ratio, `textEpoch`,
  the zoom, the leading and the font.
- A page's place on the PDF's grid is worked out once and kept (`__planFor`,
  `__plan`): aligning lines to the PDF's rows is the bulk of the pass, and
  nothing about a page's answer changes unless its width, text, type or grid
  does. `docTypeSize` is asked once per PDF per pass rather than once per page.

Measured on a 200-page, 38 MB scan: the first PDF page appears after 1.1 s
rather than 6.1 s, and the longest task that holds the thread falls from
1,507 ms to about 250 ms — one pass over the document rather than twenty. The
rendered result is unchanged: screenshots of the pane at the top of a document,
deep into it, after a zoom, after a leading change and with the pane closed
again are byte-identical to the build before.

Two more ceilings follow the folder's size. The reel stops at `REEL_MAX_BIG`
(8) rather than `REEL_MAX` (25) in a folder of more than `BIG_FOLDER` exports,
since nothing is shed under a review and every member there has a PDF behind
it. And the folder sweep, which is an answer about the keeps and so is thrown
away at every decision, waits `SWEEP_QUIET` for a gap in a big folder before
reading the folder again: three hundred files re-read for each decision of a
walk that takes one every few seconds is the folder read over and over while
the operator waits, and the bar shows the last reading's answer in the
meantime. `loadPdf` moves a PDF it hands back to the end of the map,
which makes the insertion order least-recently-used first, and destroys one
that was closed while it was still opening; `readPdfGrid` stops when its own
PDF is no longer the cached one.

The documents a review will visit are built BEFORE it reaches them. Opening
a document is read, parse and build, and the read and the parse cost a
millisecond between them: the building is the whole of it (a long export
under a full key, the best part of a second). So `buildPages` — the page
loop lifted out of `render()` — builds each document the LEAKS rows name
into a DocumentFragment that is nowhere in the page, where no style or
layout work happens at all, and `openFile` puts that fragment up
(`showPages`) instead of making it. Attaching it costs a couple of
milliseconds; what is left of an open is the settle, which is the browser
laying out the document it is now showing.

The window is kept by `planReadyDocs`, in the order `leaks.leakPages` says
the review will reach them: up to READY_DOCS documents and READY_PAGES
pages between them, one built at a time through `requestIdleCallback` and
in slices of READY_SLICE pages, nothing over READY_MAX_PAGES held at all
(the combined file), and whatever no longer fits dropped from the far end.
In a big folder `leakFileWindow` has already cut that list to one document —
and to none at all while the document in front still has rows to answer, so
the next is read at the moment this one is finished and not before.
A built document carries what it was built under — the file's size and
modification time, the key epoch, that document's own spot keeps, the
fake/real toggle and a keeps signature — and `readyFor` refuses one that no
longer matches. The toggle and the keeps are put right ON THE FRAGMENT
before it goes up: the same writes made after it is on the page cost a
second on a long document, which is more than building it from scratch.
`setKey` drops the lot, since built pages carry that key's translation;
`compileKey` does not, because `rev` is compiled from the whole key and a
keep changes only what is marked. Built and cold opens were compared
node for node, including 1,920 pseudonym spans and 960 citation
underlines: the same document either way.

`applyMatchedLayout` is asked for far more often than it can afford to run,
so the asks are coalesced: `applyMatchedLayoutSoon` collects them and runs
one pass on the next animation frame. `presize` asks once per slot as each
PDF page's size arrives and `readPdfGrid` asks again when the grid lands —
on a seventy-page complaint that was 144 passes over the whole document
(1,090 ms of pure matching, one task of a full second); it is 8 passes and
~150 ms now. Within a pass, the pane's slots are indexed by page once
instead of a `querySelector` per page, its width is read once instead of per
page, and each line remembers what the last pass wrote to it (`l.__laid`,
cleared by `clearMatched`) so a line already in place is not written again.
Measured on a 70-page complaint with its PDF beside it: 1.6-1.9 s of blocked
main thread before, 0.57-0.65 s after, worst task ~1,000 ms before and
~170 ms after, and nothing at all while scrolling. Alignment was checked
after the change — 70 of 70 pages matched, text sheet and slot the same
width, zero drift — and the lines still take a new scale when the reading
size changes.

Editing a LONG export stays responsive. A paste is one edit: its first
piece goes in through `insertText` (so it replaces a selection and the
line-number guard applies as it does to anything typed), and
`insertLinesAtCaret` lays the rest into the slots in a single pass — the
text below moves down once, the blank slots it passes absorbing a piece
each, exactly as each Enter's cascade did, which an A/B against the old
line-by-line path pins character for character. `afterTextChange` keeps the
counts, the matched layout, the line lock and the highlights immediate and
hands the citations to `placeCitationsSoon` (450 ms): the citation scan
reads the WHOLE document — a short form means what the cite before it
means, wherever that stands — so it belongs after the typing, not between
keystrokes. And `placeCitations` now rewrites a page's link layer only when
that page's strips have changed (`layer.__cites`, the strips as a string),
and measures a page's gutter numbers only for a cite that actually wraps
across one; redrawing all five thousand links on every pass was both the
bulk of a re-read and the reason the reader got slower the longer a
document stayed open. Thirty lines pasted into a two-hundred-page export:
22.6 s before, 13 ms after, with the same 4,824 underlines in the same
places.
