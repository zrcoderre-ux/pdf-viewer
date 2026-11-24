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
  The text reader's PDF pane, swapped-in pages and redaction sweep build the
  same layers and load only `text-reader.css`, which carries the same three
  rules; it lacked them once, and every name it marked or covered on a
  `/Rotate` page landed in the wrong place (Design Notes/Redaction.md, "Turned
  pages").

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

**The plan is applied INSIDE the source document** (2026-11-20; the owner:
"before I updated, I noticed that the bookmarks in my pdf were not working
when I clicked them, and post update the bookmarks are gone it says this
document has no bookmarks"). `applyPagePlan` used to copy the planned pages
into a NEW document (`PDFDocument.create` + `copyPages`), which carries each
page and its annotations (highlights, PDF-Linker's citation links) and nothing
of the document: its bookmarks, named destinations, form, attachments, page
labels and metadata. So every 💾 Save with a page turned on screen, every Save
rotation, every Organize and every deleted page wrote a file without its
bookmarks, for good. Now the source's own pages are taken off its page tree
and put back in the plan's order (`removePage`, `addPage`), turned where the
plan says; a page the plan lists twice is copied (`copyPages` from the
document itself) for its later places; and where the plan drops pages,
`pruneOutline` takes out each bookmark whose destination (`/Dest`, or a
`/GoTo` action's `/D`) is a dropped page, relinking `/Prev`, `/Next`,
`/First`, `/Last` and the `/Count` (its sign kept), and points one with live
children at its first child's page; a bookmark to a page by NAME is left. 
`test-page-plan.mjs` pins it (rotation, reorder, deletion, a page twice, the
refusals); against the old writer six of its thirteen checks fail.

A bookmark that names its page by NUMBER rather than by reference (`[4 /XYZ
…]`, which some producers write and pdf.js hands through as it stands) did
nothing when clicked: `destToPageNum` asked `getPageIndex` of a number. It is
read now as the 0-based page it counts.

**A page range, and the place kept** (2026-11-24; the owner: "Add the ability
to use a pagerange with rotate pages", and "when I use the page rotate button
on a single page, it moves me back up to the top of the document"). The scope
box's **Pages…** (`range`) shows `#rot-range`; `rangeScope` reads it through
`parsePageRanges`, now in `viewer/page-ranges.js` so the text reader's page
swap (re-exported by `pdfsync.js`) and the rotate tool read a range one way. A
range with anything it cannot use (a word, page 0, a page past the end)
turns NOTHING and says what it could not read, rather than turning the pages
it could and leaving the rest silently the wrong way up. Enter / Shift+Enter
in the box turn it, as R / Shift+R do on the page.

The jump: `rerenderKeepingPlace` called `scrollToPage` only after
`renderAllPages` returned, and that waits on every page's text (and a scan's
OCR) and the link pass; emptying `#pages` had dropped the window to page 1 in
the meantime, and the scroll at the end put the reader at the TOP of their
page, not where on it they were. It now sets `restoreScroll = captureScroll()`
as a zoom does, so the place goes back the moment the page being read is
rebuilt, and `renderAllPages` holds `#pages` at its old height
(`min-height`) through pass 1a whenever a `restoreScroll` is pending, so the
window never collapses to the top while the earlier pages are rebuilt (zoom
gains this too). A Save rotation reload (`reloadEditedBytes` with a plan and
`keepPlace`) takes the same path. `test-rotate-range.mjs` pins it in the
browser: three of its checks fail on the old code.
