# Legal Citation Linker — Project Context

A Chrome MV3 extension that intercepts PDF navigations, renders the PDF in a
bundled PDF.js viewer, detects legal citations (CA Bluebook + CSM), and
overlays clickable underlines that link to Westlaw or Lexis+. Faithful port
of an earlier Python script `pdf_linker.py`. The extension folder layout,
build steps, and feature list are in `README.md`; the citation grammar is
documented inline in `citation-linker.js`.

## Architecture in one paragraph

`background.js` uses declarativeNetRequest dynamic rules to redirect PDF URLs
to `viewer/viewer.html`. `viewer.js` loads PDF.js (4.6.82, downloaded by
`fetch-pdfjs.py` into `pdfjs/build/`), renders each page in two passes
(canvas + text layer), then calls into `citation-linker.js` to place
overlays in `linkLayer` and `highlights.js` to wire up text-selection
behaviors. Footer-derived naming is handled by `footer-naming.js` (rule
engine), `disambiguation.js` (cross-tab collision registry over
`chrome.storage.session`), and `naming-override.js` (per-document override).
Provider toggle, naming mode, the websites citation links run on, and extra
URL patterns live in `options.js`, `popup.js`, and the viewer toolbar with
`chrome.storage` (sync for global prefs, session for per-doc overrides and
cross-tab registry, local for the citation repo). `citation-site-rules.js`
holds the site defaults and the match-pattern matcher, shared by the Options
page, the background worker's content-script registration, and the content
script itself. Per-provider URL builders are in `code-tables.js`, which also decides whether
a statute key names federal authority — federal materials search nationally,
since the `jurisdiction=CA` filter that scopes a California statute search
hides them. `viewer/federal-codes.js` holds the tables that classification
runs on (C.F.R. titles for named regulation series, U.S.C. titles for the
federal codes numbered section-for-section with their codification, and the
number and bulletin shapes for IRS revenue rulings).
`content/claude-citations.js` reads a chat page as ONE string (short forms point
back to a full cite in an earlier paragraph, which a per-block scan cannot see)
and keeps a per-URL memory in `viewer/citation-memory.js`, because such a page
unmounts its own messages as the reader scrolls: without it the Table of
Authorities loses cases on the way down the page, and an italicized short name
loses the full cite it refers back to. The memory makes the panel cumulative for
as long as the reader stays on the conversation, and feeds the remembered cases
back into detection as `findAllCitations(text, { priorCases })`. It is cleared
when the app navigates to another conversation (origin + path; a query string or
`#fragment` is the same page), and it outlives a reload: each conversation's
record is written to `chrome.storage.local` under its own key (debounced, plus a
`pagehide` flush) and hydrated on the way back in, with `prunePageIndex()`
holding the stored history to the 40 most recent conversations and a fortnight.

`viewer/shift-space-open.js` is a third shared file — a classic script loaded
both by `viewer.html` and as an all-sites content script — that turns
Shift+Space into a middle click; it finds its targets geometrically (the
selection's rects vs. each link's rects) because our citation overlays are
never inside the selected DOM, and hands the URLs to `background.js`, which is
the only place that can open an unfocused tab (`chrome.tabs.create`,
`active: false`). Two things there are easy to get wrong and are commented at
the call site: the hovered link comes from `a[href]:hover` (the browser's own
hit-test state) rather than tracked mouse coordinates, and an overlay that
paints only part of what it knows — `claude-citations.js` skips citations
scrolled out of their container — registers a source on
`window.__shiftSpaceLinkSources` so a selection still reaches the undrawn ones.

## The text reader (`viewer/text-reader.html`)

A second page in the same extension and the same PWA: PDF-Linker's scrubbed
`.txt` exports, read like a document. `text-reader.js` is wiring over three
pure, Node-tested modules — `textdoc.js` (the export as pages by its
`====== Page N ======` headers, byte-exact round trip; the DOM walk that
serializes a pseudonym span as its FAKE; the `New Real Values.txt` list),
`pseudo-key.js` (a port of the Claude extension's `src/pseudo.js`: parseKey
by header name, keeps dropped, pinned tab out of the reversal, ambiguous fake
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

The LEAKS review bar works PDF-Linker's `LEAKS.xlsx` row by row from the
text: `leaks.js` (pure) reads the worksheet by header name, classifies a
Fix? cell the way `_pn_parse_decision_rows` will read it, parses the Where
and File cells, and matches a File name to its export (the reverse of
`pdfsync.matchPdf`); `text-reader.js` shows the current row in a bar above
the stage (it takes its own height through `--bar-h`), opens the row's
document, scrolls to its page and gutter line and marks the value
(`::highlight(leakrow)`), mirrors a `no`/`never` on a bound value as a
reader keep, and saves through `xlsx-write.js`, which rewrites ONLY the
Fix? cells as inline strings inside the original zip — every other entry
copied through with its compressed bytes, CRC and stamp — and reads the
result back before it is written. A `Combined Text.txt` is listed first
among a folder's documents, and `pdfsync.combinedMembers` reads its
`# Documents in this file:` list so picked PDFs are matched member by
member, by name through the key or by order.

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
whenever the PDF side is put away. The exports the rows name are read ahead
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
fix. Its button turns on PLAIN READING (`setPlain`) and copies the line.

Plain reading is the way through a reader that will not answer: `plain` turns
off the document-wide mark pass, the citation underlines, the PDF pane and
everything read ahead, leaving the words on the page. It is offered by the bar
after a freeze and by the bar when a pass holds the thread for more than a
couple of seconds, and it sits in the tools rail (`#plain-toggle`) to be chosen
deliberately. It lasts as long as the tab.

And when a pass does hold the thread but comes back, the reader says which one: the heavy
passes name themselves while they run (`during`, `duringAsync`, `notePass`), a
`PerformanceObserver` on `longtask` attributes each blocked stretch to the pass
it fell in, anything past two and a half seconds goes to the toast bar in those
words, and `window.__textReaderBlocked()` hands back the whole ledger, worst
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
  happened and offers plain reading. The next document — or the next key —
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
window moves) destroys the PDFs nothing points at any more — `pdfsInUse` is
the open document's own sources, the swapped-in pages, the PDFs picked by
hand and the warm window — keeping the PDF_HELD most recently asked for
past those, since stepping back to the document just answered should not
read it again. `loadPdf` moves a PDF it hands back to the end of the map,
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

### Rule glyphs drawn as boxes (`viewer/rules.js`)

PDF-Linker writes a page's line art into its export as box-drawing glyphs,
which read as a box only in a monospace font at single spacing. `rules.js`
re-derives, on every page fill and every line-restructuring edit, a set of
spans over each line's rule glyphs: a line with vertical bars becomes
`.line.rl` (`display: table-row`; its `.lt` `display: contents`) holding
`.rc` cells split at `.rb` bar cells (one pixel wide, filled to the row's
height), consecutive lines whose bar offsets agree (measured on the whole
line, gutter included — a numbered row and its unnumbered continuation
agree) share one anonymous table, and a line whose offsets differ from the
row above is `.rt` (`display: table`, its own columns) so two stacked boxes
never share columns. A line of nothing but rules is `.rr`, half a line tall;
a `─` run is `.rh`, a line at its own width, or `.rc.hf` when it is a whole
cell, a line across the cell. Every span carries the glyph as its text and no
`data-fake`, so `serializeNodes` and the clipboard are unchanged (pinned in
`test-textdoc.mjs`); `ruleParts` / `ruleShape` in `textdoc.js` are the pure
half. `undress` runs first on each pass and touches only lines that carry a
rule span, so the editor's caret text node on any other line is never
replaced.

What the table layout cannot do is done by `fitRuleRows` at the end of each
layout pass: a box's rows are squared up as a STACK — every consecutive rule
row, not only the run whose bars fall at the same offsets — against one
column grid (`ruleGrid`, pure, `test-rules.mjs`). Bar offsets within three
characters of each other are one column, never two of one row's own, and
each column is set far enough right for every cell that ends there. Without
it the art's own wobble shows: a notice line too long for its box pushes
that row's closing bar a character or two out, and that row, measured alone,
was drawn at its own width — and side by side, where every line is
positioned on its own, at its own left as well. The stack takes one left
edge there and each row the height of the gap to the row below, so its bars
meet the next row's. `test-rules.html` reads the geometry back out of a page
in both views.

## Fixes applied in earlier sessions

All in `viewer/` unless noted. Each fix is documented inline at the call
site — read the comments there for the why, not just the what.

1. **viewer.css** — selection was invisible (and Chrome showed the no-drop
   cursor) because `.textLayer` had `opacity: 0`, which forced its
   `::selection` highlight to 0% alpha too. Replaced with transparent
   `color` + `caret-color`. Also added missing `#hl-ctx-menu` styles (the
   context menu was being created without any CSS).

2. **highlights.js** — right-click menu now offers Copy + Highlight on a
   selection (was Highlight only) and Remove on an existing highlight rect.
   On `mouseup` in normal mode, the same menu auto-appears near the cursor
   if a non-empty selection exists inside the page's textLayer. The
   ✏ Highlight toolbar toggle still bypasses the menu and converts
   selection straight to a highlight.

3. **citation-linker.js — `rectsForRange`** — the original code mapped
   citations to spans via `allSpans[itemRanges[k].itemIndex]`, but PDF.js
   4.x's TextLayer drops/folds/separates items relative to
   `textContent.items` (it emits `<br>` for EOL items, skips zero-length
   items, etc.), so the index mapping drifted further down the page with
   each skipped item. Symptom: links landed paragraphs below the actual
   citation, drift growing with page depth.

   Rewritten to ignore item indices entirely. Concatenates rendered span
   text into `domText` (with a single space inserted between adjacent
   spans — critical for citations that cross line breaks or span splits),
   normalizes whitespace, finds the citation's literal text directly,
   uses the joined-text offset only as a positional hint to pick the
   right occurrence when the same phrase appears more than once.

   Three additional features on top of the rewrite:
   - **Per-page `consumedDomStarts` Set**: when the same citation appears
     N times on a page, each `documentCites` entry binds to a different
     DOM occurrence so all visual occurrences get linked (not just one).
   - **Inter-span space insertion**: see above; lets "Civil Code" +
     "section 3287(a)" across spans match the needle "Civil Code section
     3287(a)" after whitespace normalization.
   - **Distinctive-substring fallback** (`extractDistinctiveSubstring`):
     if the full needle still finds zero matches (unusual whitespace,
     ligatures, soft hyphens), retry with just the section identifier
     (`§ 3287(a)`, `13 Cal.App.5th 1152`, `rule 3.1300(a)`, `9 U.S.C. § 1`,
     etc.). Underline is shorter than ideal but the citation gets linked
     rather than silently dropped.

4. **background.js** — LA Superior Court eCMS exposes both a PDF endpoint
   and an HTML in-portal viewer under `/ecourt/ecms/`; the built-in glob
   `ecms/doc*` matched both, hijacking the HTML viewer. Added
   `buildEcmsImageAllowRule` (priority 100, action `allow`) that lets
   `https://civil.lacourt.org/ecourt/ecms/document/image…` pass through
   unmodified.

5. **viewer.css** — toolbar `position: sticky; top: 0` wasn't sticking
   because `#viewer-container` had its own `overflow: auto`, creating a
   nested scroll context the toolbar couldn't see. Moved scroll to
   `<body>` (`overflow-y: auto`), removed it from the container. Sticky
   behavior now works as originally intended.

## Naming system (current session)

The viewer can name documents two ways:

- **Source mode (default).** Filename comes from the server / URL /
  Content-Disposition. No transformation. This is what most legitimate
  PDFs already provide.
- **Footer mode.** Reads the document title printed at the bottom of court
  filings, runs it through a rule engine in `footer-naming.js`, applies
  cross-tab disambiguation when sibling tabs would collide on the same
  canonical name.

### Three layers of control

| Layer | Storage | UI surfaces | Scope |
|---|---|---|---|
| Global default | `storage.sync.namingMode` | Popup + Options page | All viewer tabs that don't have a per-doc override |
| Per-document override | `storage.session.naming-override:{url}` | Viewer toolbar dropdown | Only the document at that URL; survives tab reload, dies on browser close |
| Effective mode | (derived) | What the toolbar actually shows | `override ?? per-document default` |

The toolbar dropdown always mirrors the effective mode. Picking something
in the toolbar creates a per-doc override; until then the toolbar tracks
the global.

### Documents opened from disk keep their name

A PDF opened from disk — `file://` in the extension, or a `File` handed to
`__pdfViewerLoadLocal` in the app — is already named, by whoever downloaded
or filed it. The naming rules exist for PDFs read *before* download, where
the name is still the viewer's to pick, so a local document is shown under
its own filename verbatim: no rule engine (not even with "apply naming rules
to source names" on), no footer title, no caption override, no part/volume
suffix, and no cross-tab disambiguation — it doesn't register in the
collision registry, so it can't push a sibling tab into qualifying its name
either. Picking a mode in the toolbar dropdown is a deliberate ask and lifts
the suppression for that one document.

`resolveNaming()` in `naming-override.js` is the one place that decides this
(`{ mode, keepSourceName }`); `viewer.js` mirrors it into `namingMode` /
`keepSourceNameAsIs`.

### Footer-naming rule engine (`footer-naming.js`)

Pipeline:

1. Normalize whitespace and curly quotes.
2. Capture case-caption party from a `X v. Y` tail and strip it. The
   captured party (e.g. `Hopkins`) is used as a Complaint disambiguator.
3. Strip case-number noise (`CASE NO. ...`) and trailing damages
   descriptive blobs (`for compensatory, punitive, ... damages`).
4. Collapse `Notice of Motion and Motion ...` to plain `Motion ...`. Bare
   `Notice of Motion for X` is preserved as its own type (a procedural
   notice).
5. Non-destructively capture the filing-party label from the leading
   possessive: `"Defendant Pacific Insurance's Demurrer"` → `"Pacific Insurance"`;
   `"Plaintiff's Complaint"` → `"Plaintiff"`; `"Receiver's Opposition"` →
   `"Receiver"`. Used as a disambiguation qualifier.
6. Walk the RULES list to identify the document type. Rules examine the
   full (still-possessive-prefixed) string and anchor on document-type
   keywords directly. Outermost wrapper wins.

Rule order (outermost wrapper first):

```
Self-titled (Errata / Notice of Ruling / Trial Brief / Memo of Costs /
Case Management Statement / …) > Response to Objections > Objection >
Declaration > Order > Proof of Service > RJN > Separate Statement >
Evidence > Notice of Non-Opposition > Reply > Opposition > Demurrer >
Notice of Motion > Ex Parte Application > Motion > Petition > Answer >
Cross-Complaint > Amended Complaint > Complaint > bare MPA
```

Order constraints that matter:
- Self-titled procedural docs first: a "NOTICE OF ERRATA RE: PLAINTIFF'S
  EVIDENCE IN OPPOSITION TO ... MOTION" is an errata notice, and would
  otherwise mislabel as Opposition.
- Response-to-objections before Objection (its title contains
  `Objections`), and Objection before every objected-to type — an
  "Objections to Declaration of X" is `Obj. to X Decl.`, not `X Decl.`
  Leading party possessives match both singular (`Defendant's`) and
  plural (`Defendants'`) forms.
- Declaration before the response/brief types (a `Decl. ISO Reply` is a
  declaration, not a reply).
- Reply before Opposition (a Reply's title contains `Opposition to ...`).
- Notice of Motion before Motion (`Notice of Motion for X` contains
  `Motion for X` as substring).
- Ex Parte Application before Motion (parallel structural overlap with
  `for X`/`to X` forms).
- FAC/SAC/TAC before Complaint (they contain `complaint` as substring).

Canonical types collapse aggressively. Standalone titles are bare:
`Motion`, `Demurrer`, `Opposition`, `Reply`, `Petition`, `Complaint`,
`Notice of Motion`, `Ex Parte Application`. The specific variant
(`Mot. to Strike`, `Demurrer to SAC`, `Opposition to Demurrer`) only
appears as a disambiguation qualifier when sibling tabs collide.

`extractTitle(raw)` returns `{ canonical, target, party, partyLabel, raw }`.

Insurance check: if input mentions `DECLARATION` or `DECL.` but a
non-declaration rule matched, recover a `{Last} Decl.` label rather than
mislabeling. Belt-and-suspenders against future rule edits.

### Cross-tab disambiguation

`disambiguation.js` writes each viewer's parsed footer attributes to
`chrome.storage.session` under a per-tab key. All viewer tabs subscribe
to changes and recompute their displayed name when siblings update.

`disambiguate(entries)` walks a 3-level ladder for colliding groups:

1. **Target only** — `Demurrer to SAC`, `Opposition to Demurrer`,
   `Mot. to Strike`.
2. **PartyLabel only** — `Receiver's Opposition`, `Pacific Insurance's
   Demurrer`, `Plaintiff's Motion`.
3. **Both** — `Receiver's Opposition to Ex Parte App.`

The algorithm stops at the first level that makes every entry in the
group unique. An entry with neither target nor partyLabel stays bare at
every level; its informed siblings move. Two bare entries that collide
remain visually identical (no synthetic numeric suffix) — the user
renames manually.

Exceptions to the ladder:
- Declarations and FAC/SAC/TAC are already distinct by name/ordinal; no
  ladder applied.
- Complaints use case-caption party (not partyLabel) as the qualifier:
  `Hopkins Complaint` vs `Complaint`.

Stale entry sweep: on `registerEntry`, the module enumerates all
`titledoc:*` session keys and removes any whose tabId no longer
corresponds to an open tab. Cheap because session storage is small.
`beforeunload` also unregisters; sweep is belt-and-suspenders.

### Per-document override (`naming-override.js`)

Tiny module: `getOverride(fileUrl)`, `setOverride(fileUrl, mode)`,
`onOverrideChange(fileUrl, cb)`. Keys session storage by file URL. The
toolbar dropdown is the only writer; the popup and options page write
only to the global key. Also holds `resolveNaming()`, the pure function that
turns (local-or-not, override, global) into the effective mode plus the
"keep the on-disk name" flag — covered by `test-naming.mjs`.

### State management in viewer.js

Four name variables coexist:
- `globalNamingMode` — mirror of `storage.sync.namingMode`
- `perDocOverride` — `getOverride(fileUrl)` result, null when unset
- `isLocalDocument` — opened from disk (`file://`, or the app's local-open path)
- `namingMode` / `keepSourceNameAsIs` — effective mode and suppression, from
  `resolveNaming()`

`resolveEffectiveNamingMode()` recomputes both after any layer changes; if
either changed, the source name is re-derived and `applyNamingMode()`
re-paints the toolbar.

`setDisplayName` now takes an `origin` tag (`"source"` or `"footer"`)
and caches both forms separately. Flipping naming mode swaps between
them with no re-extraction.

Footer extraction (`tryResolveFooterTitle`) always runs regardless of
mode — the structured result is needed for the disambiguation registry,
and toggle-flipping should be instant. Whether the result reaches the
registry is decided separately, by `syncDisambiguationEntry()`.

## Page rotation (`viewer/rotation.js`)

The **⟳ Rotate pages** tool turns pages on screen for any document, and writes
the angles into the file on request. `rotation.js` owns the per-page angles,
the floating bar, and the **R** / **Shift+R** keys; everything that touches
PDF.js is a callback from `viewer.js` (`rerender`, `save`), which also keeps the
module importable in Node for `test-page-rotation.mjs`.

Two frames exist once a page is turned, and most of the code in this area is
about keeping them straight:

- **Display frame** — what's on screen. `renderPageCanvasAndText` builds the
  viewport as `page.getViewport({ scale, rotation: page.rotate + delta })`, so
  the tool's angle rides on top of the page's own `/Rotate`. The rendered
  viewport is cached in `pageViewportByNum`.
- **Page frame** — the page as it is written. PDF.js's `TextLayer` builds spans
  in this frame regardless of rotation: it sizes the container from the
  unrotated page box and stamps `data-main-rotation` on it, leaving the turning
  to the viewer's CSS (`.textLayer[data-main-rotation="90"]` etc., rotate about
  the top-left and translate back). That is deliberate and useful — the
  line-number detection and the selectable-text region keep reading
  `offsetLeft` / `offsetTop` in the page's upright frame, unchanged by rotation.

Anything that crosses between the frames goes through the cached viewport
rather than through `currentScale`: `collectHighlightPdfRects`
(`convertToPdfPoint`), imported highlight annotations in `highlights.js`
(`convertToViewportRectangle`), and the selection bands in
`buildCitationReference`, which have to be fractions down the page in the page
frame because the line-number rows they're compared against were captured
there. All of these reduce to the old ÷ scale and Y-flip on an upright page.

Two things needed doing by hand:

- **Citation underlines** are the bottom border of a box over the citation, so
  the border moves to whichever edge is under the text now
  (`.linkLayer[data-rotation="90"]` → `border-left`). The key is the tool's
  delta, NOT the page's total angle: a page that ships with `/Rotate 90`
  already renders its text horizontally.
- **OCR spans.** Recognition runs on the page as stored (so the cached word
  boxes survive a rotate — turning never re-OCRs), and `rotatedRunPlacement`
  re-places each line: the anchor is the image of the run's top-left corner,
  paired with `transform-origin: 0 0; transform: rotate(<angle>deg)` so the
  span's own axes turn with the page. `test-page-rotation.mjs` pins that corner
  for each quarter turn.

Saving goes through `applyPagePlan` in `pdf-edit.js` — the same call Organize
pages makes, so both write the rotation identically. The toolbar's **💾 Save**
bakes a pending rotation along with the highlights; the bar's **Save rotation**
does it alone, in place for editable documents and as a copy for web PDFs.
Anything that reloads the document from edited bytes must call
`pageRotation.clear()`, or the new bytes (which already carry the angles) would
be turned a second time.

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

## Keeps that ask nothing of PDF-Linker (`textdoc.keepNeedsRun`)

A keep says *do not fake this value*. Where the run **faked** it, only
PDF-Linker can put the real name back, so the keep goes into
`New Real Values.txt` and a run has to happen. Where the value **stands in the
clear**, the file already reads the way the keep wants it to: there is nothing
to un-fake, and the keep is a note to the reader, not an instruction. Such a
keep is marked `local`, `formatValuesFile` leaves it out, and `valuesDirty`
does not count it — so it raises no "not written yet" and no closing prompt.

Two things disqualify it: `never` (which reaches the next matter through the
file and nowhere else) and a value PDF-Linker has raised on `LEAKS.xlsx` (whose
row is where it gets answered). `setKeep` decides at the moment the keep is
taken; `refreshKeepLocality` re-reads it when a document opens or a worksheet
attaches, and only ever in the safe direction — `textdoc.owe` turns a local
keep into an owed one and there is no call the other way.

`fakeStandsInFile` asks the **key's own matcher**, not a plain search, so a
pseudonym wrapped at the margin with a gutter number between its halves still
counts as standing.

## Things to know before changing code

- **No browser storage in artifact-style limits here**; this is a real
  Chrome extension. `chrome.storage.sync` for global prefs/patterns,
  `chrome.storage.session` for per-doc overrides and cross-tab
  disambiguation, `chrome.storage.local` for the citation repo.
  Highlights are intentionally in-memory only (closes-with-tab); the
  README documents this.
- **PDF.js version is pinned** in `fetch-pdfjs.py` (currently 4.6.82). The
  rectsForRange rewrite specifically works around 4.x TextLayer behavior.
  If upgrading PDF.js, re-verify the placement logic against a long
  document.
- **The citation-detection layer is a line-by-line port of `pdf_linker.py`**
  and has been validated citation-for-citation. Don't refactor regexes
  without a side-by-side diff against the Python.
- **The footer-naming rule engine is NOT a port** — it's a new design
  derived from a 14-example spec and refined across conversation. Tests
  in `test-naming.mjs` cover 41 extraction cases + 15 disambiguation
  scenarios. Run with `node test-naming.mjs` from the extension root.
  Edit rules with the tests open; new behavior should come with a new
  test case.
- **The legacy `simplifyName` function in viewer.js is still present**
  as a fallback when the new rule engine returns `canonical: null` (for
  exotic cover-page titles outside the canonical vocabulary). Don't
  remove it without auditing what footers it currently saves.
- **Both Westlaw findType=Y and Lexis pdsearchterms expect a bare reporter
  cite**, not the full key. `caseReporterCite` and `disambiguatedLexisTerm`
  in `code-tables.js` extract the right form; see comments there.
- **The extension does not OCR.** PDFs without a text layer get rendered
  (canvas works) but produce no citations, no footer extraction, no
  selectable text. The README documents this. If OCR is needed,
  Tesseract.js (WASM) is the path — render-to-canvas already happens,
  synthesize a text layer from OCR output, feed into existing pipeline.
- The previous session also briefly chased red-herring theories about
  PDF.js's `round()` CSS, `pointer-events` on `.highlightLayer`, and a
  missing `.highlightLayer` CSS rule. The actual fix in each case was
  different from the initial theory — diagnose with DevTools rather than
  jumping to plausible-sounding CSS fixes.

## Known good test cases (use these to spot regressions)

Citation linking:

- "Civil Code sections 3287(a) and 3289(b)" — both should link, with
  distinct underlines.
- "Civil Code" at end of one line / "section 3287(a)" on the next — should
  link (tests inter-span space repair).
- "§ 425.16" mentioned multiple times on one page — every occurrence links.
- "50 United States Code section 3931(b)(1)" — links, keys as
  "50 U.S.C. § 3931(b)(1)", and searches as "50 U.S.C. § 3931". The code
  spelled out is the California Style Manual form; the search drops the
  subdivision, which neither provider indexes as a document of its own.
- Smith v. Jones-style case cites with `(2017) 13 Cal.App.5th 1152` tails —
  link should land on the case name, not somewhere else.
- eCMS `https://civil.lacourt.org/ecourt/ecms/document/image?…` URL — opens
  in the portal's viewer, not in our PDF viewer.
- Direct `.pdf` URL or eCMS PDF endpoint — opens in our PDF viewer with
  citation overlays and selectable text.

Naming (run `node test-naming.mjs` for the full set):

- `Plaintiff's Complaint for Damages` → `Complaint`
- `SECOND AMENDED COMPLAINT` → `SAC`
- `PACIFIC INSURANCE'S NOTICE OF DEMURRER AND DEMURRER TO PLAINTIFF'S SAC` →
  `Demurrer` (target: SAC)
- `Defendant's Reply to Opposition to Motion to Compel Arbitration` →
  `Reply` (target: `Opp. to Mot.`)
- `Notice of Motion and Motion to Compel Arbitration` → `Motion`
- `Notice of Motion for Summary Judgment` → `Notice of Motion`
- `RECEIVER'S OPPOSITION TO DEFENDANTS' EX PARTE APPLICATION` →
  `Opposition` (target: `Ex Parte App.`, partyLabel: `Receiver`)
- `DECLARATION OF OLIVIA BENNETT IN SUPPORT OF PLAINTIFF'S
  OPPOSITION TO ...` → `Bennett Decl. ISO Opp.`
- Two demurrers, one to SAC and one to FAC, open in two tabs → toolbar
  in each tab updates live to `Demurrer to SAC` / `Demurrer to FAC`.
- Three Oppositions (Receiver's to ex parte, Plf's to demurrer, Blue
  Shield's to ex parte) → `Receiver's Opposition` / `Plaintiff's
  Opposition` / `Pacific Insurance's Opposition` (level 2 of the ladder).

## Files

```
manifest.json                        MV3 manifest
background.js                        DNR redirect rules + eCMS exclusion
popup.html / popup.js                Provider toggle + naming mode + legend
options.html / options.js            Web citation sites + URL patterns + naming default
citation-site-rules.js               Site defaults + match-pattern matcher (shared)
viewer/shift-space-open.js           Shift+Space = middle click (viewer + every site)
fetch-pdfjs.py / .sh                 One-time PDF.js download
test-naming.mjs                      Node-runnable rule-engine tests
test-citation-sites.mjs              Node-runnable web-citation-site tests
test-shift-space-open.mjs            Node-runnable Shift+Space tests (stubbed DOM)
test-italic-short-names.mjs          Node-runnable italic short-name linking tests
test-toa-position.mjs                Node-runnable TOA panel position-clamp tests
test-bare-rule.mjs                   Node-runnable bare-rule + rule-set carry-over tests
test-page-rotation.mjs               Node-runnable page-rotation geometry + scope tests
test-citation-memory.mjs             Node-runnable per-URL citation-memory tests (stubbed DOM)
test-section-lists.mjs               Node-runnable chained section-list tests (and / or / & connectors)
test-redact.mjs                      Node-runnable redaction tests: span mapping, box merging, and the saved copy read back for text and metadata
viewer/viewer.html                   Viewer shell (toolbar has naming-mode dropdown)
viewer/text-reader.html / .js / .css   Text reader for PDF-Linker's exports
viewer/textdoc.js                        Its document model (pure; test-textdoc.mjs)
viewer/pdfsync.js                        Its PDF pane: which PDF an export came from, page ranges, scroll sync (pure; test-pdfsync.mjs)
viewer/pseudo-key.js                     pseudonym_key.xlsx reader, fake<->real swaps (pure; test-pseudo-key.mjs)
viewer/xlsx-read.js                      Minimal .xlsx reader (pure; test-xlsx-read.mjs)
viewer/xlsx-write.js                     Fix? cells written back into the same .xlsx (pure; test-xlsx-write.mjs)
viewer/leaks.js                          LEAKS.xlsx model for the review bar (pure; test-leaks.mjs)
viewer/web-shim.js                       chrome.* shim for the hosted pages (was inline in viewer.js)
viewer/viewer.css                    Page / textLayer / linkLayer styles; body owns scroll
viewer/viewer.js                     PDF.js loader, two-pass renderer, naming plumbing
viewer/autoscroll.js                 Auto-scroll: wpm-paced reading scroll + its control bar
viewer/rotation.js                   Page rotation: per-page angles, rotate bar, rotated geometry
viewer/citation-linker.js            Detection + placement + URL resolution
viewer/citation-memory.js            Per-URL memory: cumulative TOA + remembered cases, saved across reloads
viewer/highlights.js                 Selection, highlight, context menu
viewer/redact.js                     Redaction: the boxes, their store, the copy's name (pure parts; test-redact.mjs)
viewer/key-library.js                The pseudonym keys in storage, shared by the reader and the viewer
viewer/pdf-edit.js                   PDF writing via pdf-lib: highlights, page plans, stamps, the redacted copy
viewer/footer-naming.js              Footer-title rule engine + iterative disambiguator
viewer/disambiguation.js             Cross-tab collision registry (storage.session)
viewer/naming-override.js            Per-document naming-mode override (storage.session)
viewer/reporters.js                  REPORTERS_RAW port
viewer/statute-codes.js              STATUTE_CODES port
viewer/federal-codes.js              C.F.R. / U.S.C. / named federal codes, rev. ruls.
viewer/code-tables.js                WL / Lexis URL builders
pdfjs/build/pdf.mjs                  PDF.js main module (downloaded)
pdfjs/build/pdf.worker.mjs           PDF.js worker (downloaded)
```
