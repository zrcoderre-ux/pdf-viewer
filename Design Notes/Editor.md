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

**The top bar is a three-column grid** (`#toolbar` in `viewer.css`): the
document's name, status and link pill on the left, page navigation and zoom
in the middle, the actions on the right. The middle group is centred while
both sides fit in equal halves beside it. The right column's floor is its
min-content, so where half the bar is too little for the actions the middle
group moves left; with a floor of 0 the actions slid left under zoom instead
(at 1280px a click on zoom-in was Redo or Undo). The side groups' icon
buttons take their 32px as a flex-basis with `width: auto`: they can still
give up their padding, down to the icon, before the middle group moves, and
the right group's min-content is that squeezed size, so wherever the
actions fitted their half the bar is laid out exactly as before.

The left column has no floor, so its group must fit whatever it is given.
The name and status shorten with an ellipsis, and the link pill shortens
with an ellipsis once the rest of the group would have less than
`--name-room` (the floor and some 70px of the name; just the floor while
renaming). What cannot shrink is budgeted in the name's box: it keeps
`--name-floor` (its icon, menu button and padding, or those and 160px of
input while it is being renamed), or less where the group is too narrow,
namely what is left beside 40px for the panel button's icon, the gaps and
the margins, and `--pill-floor`, the pill's 29px of padding while it is
shown. Without that last term, while the name was being renamed, the
pill's bare padding was pushed out of the column: 9px into the gap at
1181px with a five-digit page total, and over the page navigation had the
right group's floor been a little wider (the icon buttons' 32px kept as a
width).

The window-width rules below the top bar's CSS (at 1180px and narrower the
status and the button labels go, at 1100 the pill, at 960 the provider and
auto-scroll, at 800 the zoom and theme buttons) choose what is shown; they
do not decide whether controls overlap. Just above 1180 the Download and
Save as… labels come back before the right group fits its half again (at
about 1380 for a web PDF), so there the middle group sits up to about 100px
left of centre, and it steps back to the centre when the window narrows
past 1180. Moving the label rule up to 1380 would keep it centred, but
would take the labels away at 1280 and 1366, the common laptop widths.

**The page area** is `#viewer-container` around the `#pages` column, and the
window is its only scroller. The container reserves the fixed regions as
padding, the tools rail on the left and the side rail and any open panel on the
right, with a 28px margin beside each; what is left is the room
(`sidewaysRoom()` in `viewer.js`). A page wider than the room stands at the
room's left edge at `scrollX` 0 (`safe center`), and a narrower one is centred
in it. The window's own scroll width ends at the widest page's right edge, so
scrolled all the way that edge would stand at the window's edge, 48px under the
side rail, or 280px under it and the open panel. A box 1px tall after the
column (`#viewer-container::after`) carries the scroll width on: from the
room's left edge as far as the pages are wide (`--pages-w`: the widest page, or
two side by side the widest left and the widest right page with the 14px gap
between them; `notePageWidth`, `measurePageWidths`), and on by the side rail
and any open panel (`--right-cur`), so scrolled all the way the page's right
edge meets the side rail or the panel. It moves no page: at every `scrollX` the
window reaches without it, every layout shows exactly what it shows without it,
and a page that reaches only into the margin gets no sideways scroll. With it:

- A page whose right edge would stand under the side rail or the panel has a
  sideways scroll as far as that edge, with classic scroll bars (Windows) a
  15px bar under the pages. At 1280px with the rail open, a Letter page at 150%
  reaches 1px into the margin and has none, at 155% 4px and at 160% 34px; with
  the panel open, 205px at 150%. The widest page sets it for every page: a
  landscape exhibit in a document fitted to its portrait pages gives them all
  the scroll and the bar.
- In a fit mode, from the room changing until the refit lands 200ms later,
  `body.refitting` (from `refitSoon`) takes the box away, so the old fit slides
  under the panel for those frames and brings no sideways scroll bar. Dragging
  the panel's edge refits too (`setThumbPanelWidth`), or a fit left under the
  panel would keep one. The password-locked message and a presentation have no
  box.
- ← and → ask whether the pages' own right edge is past the window
  (`sidewaysColumn()`), not the window's `scrollWidth`, which counts the box.
  Where it is not, they turn the page. Where it is, they scroll sideways, and
  at the edge a fresh press turns the page; a held key (`e.repeat`) stops at
  the edge. In one column the new page keeps `scrollX`, so the edge the reader
  was at stays in view; two side by side it lands as the page buttons land it
  (`scrollIntoView`).

**In one column the view holds its place sideways** (`holdSideways`,
`noteSideways`, `readSideways` in `viewer.js`), never in two-up or while
presenting (`sidewaysHeld()`). `sideways.mid` is how far the room's centre is
from the column's left edge, where every page wider than the room stands, in
the pages' own units (px divided by the zoom), so neither a zoom nor a page of
another width landing in a rebuild moves it; `sideways.edge` is `start` or
`end` while the view is at one side. A width change puts that point back at the
room's centre, or keeps the edge: the panel opening, closing or dragged, the
rail collapsing, the window resizing, and a zoom (`applyRestoreScroll` puts
back only the vertical place, and the hold the rest). Kept in pixels, `scrollX`
lets the room's centre move across the page by half the change (116px for the
panel at 1280px, 94px for the rail), and a zoom anchored on the window's centre
takes the left edge out (123px for a step from 300%). A ResizeObserver on the
container sees the room and the window change, every frame of the rails'
transition, so the page moves with the panel. While a rebuild lands its pages
the observer is off and the hold is asked once a frame from
`requestAnimationFrame` (`holdWhileBuilding`), until the pages are in place or
the rebuild is abandoned with none after it. The hold writes only `scrollX`. A
scroll is the reader's, and moves the point, only where the widths
(`sidewaysSig`) have not moved since the last hold; otherwise it is the browser
clamping, and is held. The left edge (`edge = "start"`, `scrollX` 0, where a
pleading's line numbers are) is held for a new document
(`resetForNewDocument`), a switch into one column from the More menu, and,
after a rebuild, a page being read that fits the room, so a zoom past the room,
or a room narrowed past that page, keeps its left edge in view and puts its
right side out. A presentation is not held (`sideways.presenting`, from its
zoom to the one it ends with, since its class comes off before the layout is
put back), so leaving it brings back the place held before it. A jump to a page
is `scrollIntoView`, and the hold takes where it lands (`readSideways`); a
smooth jump is waited for until `scrollend` (`sideways.jump`), since a scroll
write would stop it short.

What is left as it was, or worse (measured at 1280px with classic scroll bars;
"between the rails" is from the tools rail's right edge to the side rail's or
the open panel's left edge):

- Two-up and the cover keep their own code paths: `scrollX` 0 at open,
  `scrollIntoView`, a zoom anchored on the window's centre (`xfrac`), the pages
  sliding under a panel or rail change. The box and the arrows' turn are new
  there, and the longer range clamps less: scrolled to the right end of a
  spread at 100%, collapsing the tools rail leaves 0.87 of the left page
  between the rails where the shorter range pulls the view back to 0.95, and
  closing the panel 0.57 where the shorter range leaves 0.65. A zoom's anchor
  is in reach where the shorter range holds the spread at the room's left edge:
  at 1024px with the panel open, 100% to 110% puts the left page's edge 14px
  under the tools rail, where the shorter range keeps it 28px clear.
- A jump lines a page whose edge is out of the window up with the window's
  edge, under a rail, as `scrollIntoView` does, and from the right end that
  takes in a page narrower than the window: Letter at 200%, the next page lands
  at `scrollX` 272 with 244px of it under the tools rail, where from the
  shorter range's end it stays at 231 with 203px under it (0.80 between the
  rails either way).
- Holding the middle moves the page: opening the panel takes it left by half
  the panel's width, where with `scrollX` kept it stands still and the panel
  covers its right side. With pages of mixed widths the point and the right
  edge are the column's, so a reader scrolled toward the widest page's right
  edge keeps that place on a narrower page through a width change: at 150%,
  from a landscape page's right edge on to a portrait page, opening the panel
  leaves 0.51 of the portrait page between the rails, where with `scrollX` kept
  it shows 0.81.
- Zoomed past the room from a page that fits, the page keeps its left edge
  where an anchor on the window's centre puts the page's middle there: Letter
  from 150% to 175% shows 0.88 of the page between the rails where the centred
  view shows 0.91 with 33px of its left edge under the tools rail.

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
