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
