## The editor (Acrobat-style tools)

The viewer's chrome is `viewer.html` + `viewer.css` (design tokens on `:root`,
dark by default, `[data-theme=light]` flips them) with icons from
`viewer/icons.js` (`<i data-icon="name">` placeholders filled by
`hydrateIcons`) and menus / toasts / dialogs from `viewer/ui.js`
(`openDialog`, `confirmDialog`, `promptDialog`, `contextMenu`, `toast`). Three
fixed regions: the top bar, the tools rail (`#tools-rail`, groups of
`.tool-btn`, searchable; `body.tools-collapsed` makes it an icon strip and a
window under 1100px starts it collapsed), and the side rail + panel
(thumbnails, bookmarks, comments, attachments). Floating property bars
(`.float-bar`: find, annotation properties, crop, rotate, redact, form) sit
under the top bar.

**Comments are a model in PDF user space** (`viewer/annotations.js`): one
array of plain objects (`{ id, page, type, rect, quads, color, … }`), drawn as
DOM in each page's `.annotLayer` by `paintPage`, with undo / redo as
snapshots of the array. Types: highlight underline strikeout note freetext
typewriter ink square circle whiteout line arrow stamp symbol image link.
`viewer/annot-pdf.js` is the file side: `readAnnotations` turns a document's
annotations into model objects (anything this viewer wrote carries an `/NM`
starting `pdfv-`; stamps, symbols and images keep their model as JSON in a
private `/PDFV` key), `writeAnnotations` writes each dirty one with an
appearance stream and removes what was deleted (`removeRefs`),
`flattenAnnotations` draws appearance streams into the page content. pdf.js
must not draw the annotations the model owns, or they would show twice:
pages render with `AnnotationMode.ENABLE_STORAGE` and every owned id is set
`{ noView: true, noPrint: true }` in `pdfDoc.annotationStorage`.

**Every document tool starts from `bakeCurrentEdits()`** — the document's
bytes with the current comments written in — so a tool never loses unsaved
comments. The tools in `viewer/features.js` go through its `applyEdit`: bake,
transform (pdf-lib functions in `pdf-edit.js`), write out in place
(`writeOutPdf` with `inPlace`), reload keeping the scroll place, and mark
saved; the older ones in `viewer.js` (Organize, Bates, header / footer,
watermark, insert from file, images, rotation) follow the same steps
inline. In place
means the file handle when there is one (the app); otherwise the save picker,
whose file then becomes the document (`adoptSavedFile`) — that is how a web
PDF in the extension becomes editable.

**Passwords** (`viewer/pdf-crypt.js`) are handled before pdf-lib ever sees
the file: `decryptPdf` hooks pdf-lib's parser to decrypt each top-level
object as it is parsed (before object streams are unpacked), so RC4-40/128,
AES-128 and AES-256 files load as plain documents. The document keeps its
security (`docSecurity`) and `protectForSave` re-encrypts on the way out, so
a file that came in protected is saved protected. `encryptPdf` always writes
AES-256 (V5 R6). Permission bits are honoured by `Features.guard(kind)`; the
owner password unlocks them.

**Selection vs. overlays.** Citation links, comments, redaction boxes and
form fields all sit above the text layer. While a text drag is in progress
(`body.text-dragging`, set on a left mousedown in a text layer) they take no
pointer events, so a drag across a link does not hand the selection to it,
and the text layer carries pdf.js's `endOfContent` guard so a drag past the
end of a line does not select the page. Keep both when adding a new overlay.

A drag can also START on a link (`a` in any `.linkLayer`): pressing there
lands on the link, which has no text, so the browser began no selection. A
`mousedown` on `#pages` takes that press (`preventDefault`), and once the
pointer has moved `LINK_DRAG_PX` it sets `text-dragging` and makes the
selection itself, `caretAtPoint` (caretPositionFromPoint, with the
`endOfContent` block read as the place before it) at the press and at the
pointer, `setBaseAndExtent` between them; the `click` that ends such a drag is
swallowed. A press that does not move is left to be a click on the link. It
stands down with Alt, Shift, Ctrl or Meta and in the drawing, box-select,
crop and redact-area modes.

**Text layers made in a hidden tab** (`viewer/text-layer.js`). pdf.js's
TextLayer measures a minimum font size once per window (`#minFontSize`, the
height of a 1px "X") and keeps it. In a display:none frame — an app tab
opened behind another — that is 0, and every span pdf.js makes in that window
for the rest of its life has `font-size: …*0.00px`: no box to select, even
after the tab is shown and redrawn. `repairTextLayer(textLayer, items)`,
called after every `TextLayer.render()` in the viewer and the reader, finds
spans pdf.js sized at 0 and writes the item's own height
(`hypot(transform[2], transform[3])`) times the measure taken again now (1
when there is still no layout); `textDivs` has one span per item with a
`str`, so the two are walked together. A layer pdf.js sized properly is left
untouched. Pages of a scan, while OCR is off, carry `.no-text`; a drag over
one says once per document that it needs recognizing, with the OCR button
as the toast's action.

**A page is built before its text** (`renderAllPages`). Pass 1a builds every
page's box and layers (`buildPageShell`) and attaches the tools that need no
text (`attachPageTools`: selection handlers, comments, redaction boxes), so
the whole document is on screen at once. Pass 1b then gives each page its
text: PDF.js's own (`pageTextFromPdf`) where it has some, and OCR
(`pageTextFromOcr`) where it is a scan — those queued and taken nearest to
the page in view first, with `#ocr-progress` counting them. The linker is fed
(`ingestPage`) only after every page has text, in page order, because
`documentText` is built in call order; `pageStructures` is re-sorted by page
for the same reason. `ocr.js` shares a recognition already running for a
page (`inFlight`), so a zoom mid-OCR waits for it rather than reading the page
again. Before this, a scan appeared one page at a time as OCR finished each
page, since each page's shell waited on its own recognition.

**Edit text is not an annotation** (`viewer/pdf-text-edit.js`, the
`textedit` type in `annotations.js`). `findTextBlocks` turns pdf.js text items
into paragraphs (rows by baseline with superscripts kept in their row,
segments split at gaps wider than 1.5 em, lines stacked at a steady spacing
under one left margin; a line that ends where the next line's first word
would have fitted ends its paragraph, which is how word processors break),
with runs of bold / italic / superscript from the fonts' names. The edit
lives in the annotation set so undo, move and resize come free: `orig` is the
area whose glyphs go, `rect` is the new box. `layoutText` lays it out with
pdf-lib's standard-font metrics, and both the screen (`paintTextLines`) and
the save use it, so lines break in the same places. On save
(`buildEditedPdf` → `applyTextEdits`) `removeGlyphs` walks the page's content
with a small interpreter (CTM, text matrices, Tc/Tw/Tz/Ts, font widths from
/Widths, /W for Type0, standard metrics for the base 14) and replaces each
glyph whose centre is in `orig` with a TJ offset of its own advance, so the
glyphs left on the line do not move; a Form XObject with glyphs in the area
is copied for that page before it is changed. The new text is written after
the old content, wrapped in q/Q, in Times / Helvetica / Courier. An edit
whose old glyphs cannot be found (text drawn as outlines) is painted over and
the save says so. Tests: `test-pdf-text-edit.mjs`.

**Find** (`viewer/find.js`) searches the text layers' DOM and paints matches
with the CSS Custom Highlight API (`::highlight(find-match)`), so it never
touches the layer's spans. **Print** (`viewer/print.js`) renders every page
to an image in `#print-root` (comments baked in) and prints that, rather than
the browser's page, which would print only what has been drawn.

`textlayout.js` (lines, paragraphs, .docx parts, plain text, Myers word diff)
and `zip.js` are pure and tested in Node (`test-textlayout.mjs`), as are the
annotation writer and page tools (`test-annot-pdf.mjs`) and the ciphers and
password round trips (`test-pdf-crypt.mjs`, with pikepdf interop when
present).
