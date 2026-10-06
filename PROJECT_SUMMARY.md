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
The text reader's citation links are six-pixel strips at the foot of each line
(the text above stays selectable and editable), so each strip carries
`data-text-height`, the height of the line it underlines, and the shortcut
measures it as the whole line fragment for the pointer and the selection. That
contract is a DOM attribute rather than a source, because the extension's copy
of the script, running in the PWA's pages in an isolated world, can't see the
page's own `window`. Without a worker the links open by `window.open`, counted
from each call's answer (not `noopener`, which answers null either way): Chrome
lets a page open one tab per keypress unless the site is allowed pop-ups, and
the toast says so when the rest were blocked.

## Design notes

The detail behind each area is in `Design Notes/`, one file per area, moved word for word from this file. Read the file for the area you are changing; search them by function or file name.

- **[The editor (Acrobat-style tools)](Design%20Notes/Editor.md)** — The PDF viewer's editor: chrome (the top bar's three columns) and tools rail, the comment model (`annotations.js`, `annot-pdf.js`), passwords (`pdf-crypt.js`), Edit text (`pdf-text-edit.js`), Find, Print, link drags, blank-space presses (`blankDrag`) and `repairTextLayer`. Every document tool starts from `bakeCurrentEdits()` so unsaved comments survive, and pdf.js must not draw annotations the model owns.
- **[The text reader (`viewer/text-reader.html`)](Design%20Notes/Text%20reader.md)** — `viewer/text-reader.html` over pure `textdoc.js`, `pseudo-key.js` and `xlsx-read.js`: Find/Replace, the ⇄ Raw page view, the Did not OCR, OCR This Page and Use my text lines, the Pages tab (`renderPagesTab`: pictures of each page, drag-to-tick, `markDidNotOcrPages` for several pages at once), margin numbers the OCR missed put back (`readExport`, `restoreMarginNumbers`), the numbered margin kept out of a selection, the screenshot's fakes, flagging a name the run half faked (`clearPieces`), the LEAKS review walk, a name wrapped inside a caption's column (`columnHits`, shown, marked and saved), taking a value off the Master Keep (`withdrawMaster`), and scaling fixes (`buildMatcher` by first word). Real names exist only in the page; a save writes the fakes and refuses if a bound real value would reach the file.
- **[Text reader: layout and navigation](Design%20Notes/Text%20reader%20layout%20and%20navigation.md)** — The reader's PDF pane under load (`PDF_BYTES`, `DRAWN_MAX`, `releasePage`, draw order) and the `pdf-fonts.js` font document every `page.render` must draw on; the viewer drawing only near pages, at `devicePixelRatio`; side by side, each pair one size (label levelling, shed pages) and the PDF in the screen's own pixels (`sizeCanvas`, `pageOutputScale`); the numbered margin, and only the numbers in their order on the grid (`numberChain`); a key value's blank run read as one gap; the runaway walk (`leaks.walkStep`); light adoption; `forgetFolder`; only the folder's own key takes its flags off (`keyFolder`).
- **[Text reader: hangs and freezes](Design%20Notes/Text%20reader%20hangs%20and%20freezes.md)** — Each reader hang and its bound: `PAGE_ITEMS_MAX` on a page's text items, `PARTY_WORDS` on the cited-party regex, a one-pass `blankRanges`, and coalesced or deferred layout, grid and citation passes. Also the `localStorage` breadcrumb and console hold lines that name the pass, and the extension's citation script standing down on the reader.
- **[Text reader: rule glyphs and columns](Design%20Notes/Text%20reader%20rules%20and%20columns.md)** — How `viewer/rules.js` draws PDF-Linker's box-drawing glyphs as table rows (`fitRuleRows`, `ruleGrid`, `fitWide`) and `viewer/columns.js` sets space-separated columns on a character grid (`textdoc.columnCuts`, `columnBands`, `pdfsync.charGrid`), a second column placed for the font with a gutter (`placeColumns`, `alignColumns`), and a box row's first cell set in where the export indents it (`indentBoxRow`); `spreadTops` keeps numbered lines fixed. The wrapper spans carry no `data-fake`, so serialization is unchanged.
- **[Fixes applied in earlier sessions](Design%20Notes/Earlier%20fixes.md)** — Five older fixes, each explained at its call site: invisible text selection in `viewer.css`, the highlight context menu in `highlights.js`, `rectsForRange` in `citation-linker.js` matching citations by DOM text instead of item index, the eCMS allow rule in `background.js`, and the sticky toolbar's scroll container.
- **[Naming system (current session)](Design%20Notes/Naming.md)** — How the viewer names documents: source mode or footer mode, with a global default, a per-document override (`naming-override.js`, `resolveNaming()`) and cross-tab disambiguation (`disambiguation.js`). Covers the rule order in `footer-naming.js` (outermost wrapper first) and why a PDF opened from disk keeps its own filename.
- **[Saved OCR (`viewer/ocr-store.js`)](Design%20Notes/Saved%20OCR.md)** — `viewer/ocr-store.js` saves each OCR'd page's word boxes in IndexedDB, keyed by a SHA-256 of the document's bytes plus the page number, so a scan is not recognized again. Covers the keep window (`ocrCacheDays`), moving pages after edits (`remapOcrPages`) and `OCR_RECORD_VERSION`; tests in `test-ocr-store.mjs`.
- **[Page rotation (`viewer/rotation.js`)](Design%20Notes/Page%20rotation.md)** — `viewer/rotation.js` turns pages on screen and saves the angles through `applyPagePlan`. Covers the display frame versus the page frame (cross between them through the cached viewport, not `currentScale`), citation underlines and OCR spans on turned pages, and why anything reloading edited bytes must call `pageRotation.clear()`.
- **[Redaction (`viewer/redact.js`, `pdf-edit.buildRedactedPdf`)](Design%20Notes/Redaction.md)** — The Redact tool (`viewer/redact.js`, `buildRedactedPdf`) and its text-reader version: the copy is a fresh raster of every page, carries no metadata and never overwrites the open file. Also covers boxes in PDF user space, the key sweep, per-PDF stores, geometric drags (`textRectsUnder`) and the shortfall check against the export.
- **[The reel: the case folder read as one document (`text-reader.js`)](Design%20Notes/The%20reel.md)** — How `text-reader.js` reads a case folder as one document: `doc.pages` holds every member's pages and `reel` tracks the members. Appending never moves an index, a prepend pays through `reelShift`, there is no reel off a `Combined Text.txt`, saves write one file per member after checking all of them for real values, and `REEL_MAX` is 25.
- **[The reader's auto-scroll (`text-reader.js`, "auto-scroll while reading")](Design%20Notes/Reader%20auto-scroll.md)** — The text reader's auto-scroll: a pace in pages per minute, turned into pixels by each `.tpage`'s measured height; a per-screen speed ceiling; manual scrolling that suspends rather than stops (caught via `autoWritten`; `autoBusy()` holds it); sub-pixel motion snapped to the device grid. `autoRemeasure()` must run when pages move or a document opens.
- **[Keeps that ask nothing of PDF-Linker (`textdoc.keepNeedsRun`)](Design%20Notes/Keeps%20that%20need%20no%20run.md)** — When a keep needs a PDF-Linker run (`textdoc.keepNeedsRun`): a keep on a value already standing in the clear is `local` and is not written to `New Real Values.txt`. Covers the `local` and `pending` states, the folder-wide `caseFakes` index built by `sweepFolder`, and the rule that a keep is settled local only after every export is read.

## Things to know before changing code

- **No browser storage in artifact-style limits here**; this is a real
  Chrome extension. `chrome.storage.sync` for global prefs/patterns,
  `chrome.storage.session` for per-doc overrides and cross-tab
  disambiguation, `chrome.storage.local` for the citation repo.
  Comments live in the document model until saved; they are written into
  the PDF as annotations, never kept in browser storage.
- **PDF.js version is pinned** in `fetch-pdfjs.py` (currently 4.6.82). The
  rectsForRange rewrite specifically works around 4.x TextLayer behavior.
  If upgrading PDF.js, re-verify the placement logic against a long
  document.
- **A PDF's fonts are not in the page's own document** — in the viewer or
  the reader. pdf.js is handed `fontDocument()` (`viewer/pdf-fonts.js`, a
  hidden iframe's document) as `ownerDocument`, so every `page.render` must
  draw on a canvas of that document: `renderPageOnto` for one that is shown
  (it draws there and copies onto yours), `fontCanvas` for one that is read
  back (toBlob, toDataURL, createImageBitmap). A canvas of the page's own
  document renders an embedded font in a fallback. A new render site that
  forgets this looks right on a PDF with system fonts and wrong on one with
  embedded ones — test with both. The text layer (`pdfjsLib.TextLayer`) is
  unaffected: it sets generic families only.
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
viewer/shift-space-open.js           Shift+Space = middle click (viewer, text reader + every site)
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
test-lead-in-names.mjs               Node-runnable party names opening with State / California / Court, writ real-party short names
test-sentence-openers.mjs            Node-runnable sentence-opening words (Discussing, Citing, However,) kept out of case names
test-redact.mjs                      Node-runnable redaction tests: span mapping, box merging, a store per document, and the saved copy read back for text and metadata
test-annot-pdf.mjs                   Node-runnable comment round trips (write, save, read back, edit, flatten) + page tools
test-pdf-crypt.mjs                   Node-runnable cipher vectors + protect/open round trips (+ pikepdf interop when installed)
test-textlayout.mjs                  Node-runnable page reading, Word/text export, Compare diff, Find matching, zip
test-text-layer.mjs                  Node-runnable text layer repair: zero-size spans resized from their items
test-pdf-text-edit.mjs               Node-runnable Edit text: content parsing, layout, paragraphs, edits saved and read back
viewer/viewer.html                   Viewer shell (toolbar has naming-mode dropdown)
viewer/text-reader.html / .js / .css   Text reader for PDF-Linker's exports
viewer/textdoc.js                        Its document model (pure; test-textdoc.mjs)
viewer/columns.js                        Its space-aligned columns laid out on the font's own grid (cuts pure in textdoc.js)
viewer/pdfsync.js                        Its PDF pane: which PDF an export came from, page ranges, scroll sync (pure; test-pdfsync.mjs)
viewer/pseudo-key.js                     pseudonym_key.xlsx reader, fake<->real swaps (pure; test-pseudo-key.mjs)
viewer/xlsx-read.js                      Minimal .xlsx reader (pure; test-xlsx-read.mjs)
viewer/xlsx-write.js                     Fix? cells written back into the same .xlsx (pure; test-xlsx-write.mjs)
viewer/leaks.js                          LEAKS.xlsx model for the review bar (pure; test-leaks.mjs)
viewer/web-shim.js                       chrome.* shim for the hosted pages (was inline in viewer.js)
viewer/viewer.css                    Design tokens (dark/light), chrome, page / textLayer / linkLayer / annotLayer styles; body owns scroll
viewer/viewer.js                     PDF.js loader, two-pass renderer (pages drawn as they near the screen), naming plumbing, zoom, panels, saving, app wiring
viewer/pdf-fonts.js                  The document pdf.js loads fonts into, drawing a page by way of it, and the screen-pixel scale it is drawn at (viewer + reader)
viewer/text-layer.js                 pdf.js text layer spans given their size back when laid out in a hidden tab (viewer + reader)
viewer/autoscroll.js                 Auto-scroll: ppm-paced reading scroll + its control bar
viewer/rotation.js                   Page rotation: per-page angles, rotate bar, rotated geometry
viewer/ocr-store.js                  Saved OCR: recognized pages in IndexedDB by file hash, kept N days since last use
viewer/citation-linker.js            Detection + placement + URL resolution
viewer/citation-memory.js            Per-URL memory: cumulative TOA + remembered cases, saved across reloads
viewer/highlights.js                 Selection, markup from a selection, box select
viewer/icons.js                      SVG icon set + [data-icon] hydration
viewer/ui.js                         Menus, context menus, toasts, dialogs
viewer/annotations.js                Comment model on screen: tools, drawing, selection, editing, undo, comments list
viewer/annot-pdf.js                  Comment model <-> PDF annotations; appearance streams; flatten (test-annot-pdf.mjs)
viewer/features.js                   Document tools (applyEdit): password, pages, crop, numbering, sanitize, flatten, export, compress, compare, properties, presentation
viewer/pdf-crypt.js                  Standard security handler: open RC4/AES, protect AES-256 (test-pdf-crypt.mjs)
viewer/find.js                       Find in document (CSS Custom Highlight API)
viewer/print.js                      Print: every page rendered to an image, then window.print()
viewer/signature.js                  Signature / initials dialog, saved signatures
viewer/textlayout.js                 Lines/paragraphs, .docx and text export, word diff (pure; test-textlayout.mjs)
viewer/zip.js                        Zip writer (deflate-raw via CompressionStream)
viewer/pdf-text-edit.js              Edit text: paragraphs, layout, glyph removal from content streams, new text (pure; test-pdf-text-edit.mjs)
viewer/redact.js                     Redaction: the boxes, a store per document, the copy's name (pure parts; test-redact.mjs)
viewer/key-library.js                The pseudonym keys in storage, shared by the reader and the viewer
viewer/pdf-edit.js                   PDF writing via pdf-lib: comments, page plans, stamps, crop, blank pages, metadata, sanitize, the redacted copy
viewer/footer-naming.js              Footer-title rule engine + iterative disambiguator
viewer/disambiguation.js             Cross-tab collision registry (storage.session)
viewer/naming-override.js            Per-document naming-mode override (storage.session)
viewer/reporters.js                  REPORTERS_RAW port
viewer/statute-codes.js              STATUTE_CODES port
viewer/federal-codes.js              C.F.R. / U.S.C. / named federal codes, rev. ruls.
viewer/code-tables.js                WL / Lexis URL builders
pdfjs/build/pdf.mjs                  PDF.js main module (downloaded)
pdfjs/build/pdf.worker.mjs           PDF.js worker (downloaded)
Design Notes/                        How the code works and why, one file per area (linked above)
User Guide/                          The README's feature pages, one per feature
```
