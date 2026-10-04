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
(`sidewaysRoom()` in `viewer.js`). The container and the column are `width:
max-content; min-width: 100%`, so a page wider than the room scrolls sideways
from its left edge clear of the tools rail to its right edge clear of the side
rail or the open panel. The window-wide container before it (`safe center` kept
the left edge reachable) left the right reserve out of the scroll width: at the
furthest scroll a page's right 48px stayed under the side rail, and 280px under
the open panel (300%, 1280px). In two-up the column's width is stated instead
(`measureTwoUp`, `noteTwoUpWidth`: `--two-up-left` and `--two-up-right`, the
widest left and right page, with the 14px gap what the grid's columns come to):
measured as `max-content` over every page at each layout as pages were added, a
zoom of two thousand pages took 13-17 s where the old viewer took 5-7 s;
stated, 4.6-7.6 s where it took 4.9-9.3 s. What the wider container brings with
it:

- `availableSize()` (fit width, fit page) measures the window, not the
  container, less a classic vertical scroll bar whether it shows yet or not
  (`scrollbarWidth()`, a probe). A document is fitted before its pages are
  there to overflow the window, and the bar that comes with them fires no
  resize, so the fit stayed 15px too wide, which the container would turn into
  a sideways scroll bar. Fit width is now 150% where it was 152% (Letter,
  1280px, classic scroll bars), and a document too short to scroll keeps the
  15px as margin.
- In a fit mode, from the room changing until the refit lands 200ms later,
  `body.refitting` (`setRefitting`, from `refitSoon`) holds the container and
  the column to the window's width as before, so the old fit slides under the
  panel for those frames rather than bring a sideways scroll bar with it. The
  class changes the column's width, which moves a page narrower than a wider
  one elsewhere, so the page in view is put back where it stood. Dragging the
  panel's edge refits too (`setThumbPanelWidth`): the old viewer kept the old
  fit there for good, which past the room now brought a sideways scroll bar.
- The password-locked message (`#pages:has(> .panel-empty)`) stays window-wide
  and wraps.
- ← and → asked whether the window scrolls sideways (its `scrollWidth`), which
  now counts the right reserve, so they ask whether the pages' own right edge
  is past the window's (the window's scroll width while `body.refitting`
  holds). Where it is not, they turn the page as before. Where it is, they
  scroll sideways as before, and turn the page once the window scrolls no
  further that way, where they went dead; a held key (`e.repeat`) stops at that
  edge as before, and the next press turns the page.
- A page wider than the room by no more than the right reserve (the margin and
  the side rail or open panel) had no sideways scroll in the old viewer, part
  of it standing in the margin or under the side rail or panel. It now gets a
  short one, with classic scroll bars a 15px bar under it: a Letter page at
  150% at 1280px has 1px of it, at 160% 62px where the old viewer hid 34px
  under the side rail; a landscape page in a fit-width document with the panel
  open, 202px where the old viewer left 174px of it under the panel.

**In one column the view holds its place sideways** (`holdSideways`,
`noteSideways`, `readSideways`, `showSideways` in `viewer.js`), never in two-up
or while presenting (`sidewaysHeld()`). `sideways.mid` is the fraction of the
column at the room's centre and `sideways.edge` is `start` or `end` while the
view is at one side. A width change puts that part of the column back in the
middle of the new room, or keeps the edge: opening or closing the panel,
dragging its edge, collapsing the rail and resizing the window, where the old
viewer kept `scrollX` and the page slid by half the change (116px for the panel
at 1280px, 94px for the rail). ResizeObservers watch the container, both boxes
(while the page fits, the panel changes the content box; once it overflows,
only the border box), and `<html>` (a window resize, a classic scroll bar);
they fire every frame of the rails' transition, so the page moves with the
panel. While a rebuild lands its pages they rest and the hold is asked once a
frame from `requestAnimationFrame` (`holdWhileBuilding`, until the pages are in
place or the rebuild is abandoned with none after it): watching the growing
column, they made the browser lay out twice a frame, and a zoom of two thousand
pages took 4.5-6.1 s where the old viewer took 2.8-3.4 s; resting, six zooms of
two thousand pages take 22-33 s where it took 19-34 s (medians 25.8 and 23.3 s,
on a machine shared with other runs). The hold writes only `scrollX`. A scroll
is the reader's, and moves the middle, only where the widths (`sidewaysSig`)
have not moved since the last hold; otherwise it is the browser clamping, and
is held. A zoom keeps the held view (`captureScroll`; a column that fits comes
back centred) and `applyRestoreScroll` puts back only the vertical place, so a
zoom anchors on the room's centre or keeps its edge, where the old viewer
anchored on the window's centre and a zoom step at 300% took the left edge
123px out. A jump to a page is `scrollIntoView` as before, and where it lands
is held from then on (`readSideways`); a smooth jump is waited for until
`scrollend` (`sideways.jump`), since a scroll write would stop it short, and
the view it ends on is held, so a panel or rail change on its way is not (as
before): held then, the old place undid the jump's own sideways move, and with
pages of mixed widths left 0.29-0.63 of the page jumped to in the room where
0.46-0.80 was. A new document shows its first page where the old viewer did
(`sideways.open`, asked at each hold until its pages are all in place, or in an
app tab built hidden until it is first shown): one wider than the room with its
left edge at the room's left edge, in a column of one width at `scrollX` 0,
where a pleading's line numbers are; one narrower centred in the room. A switch
to one column (the More menu) shows the page being read the same way, so at
200% the line numbers are in view where the old viewer lined the page's right
edge up with the window's (0.77 of the page in the room against 0.80). A
presentation keeps the old viewer's ways from its zoom until the zoom it ends
with (`sideways.presenting`), since leaving it puts the layout back only after
its class comes off; leaving it for one column, a page that fit the window
comes back centred in the room (at 200% 126px out on each side, where the old
viewer left 16px of the left edge out and 235px of the right; at 300% its place
varied by 140px between runs, with the frame of the rails' transition it read).

What is left as it was, or worse. Two-up and the cover keep the old viewer's
code paths: open at `scrollX` 0, `scrollIntoView`, a zoom anchored on the
window's centre (`xfrac`), the pages sliding under a panel or rail change; only
the reachable edge, the arrows, the fit's 15px and the drag refit are new
there. The wider scroll range clamps less: when the tools rail collapses, the
panel closes or the window widens, a spread at 100% or 110% scrolled right
stays where the old viewer's narrower range pulled the view back over its left
page, 0.60-0.83 of that page in the room where 0.78-0.95 was. In one column a
jump is `scrollIntoView` as before, so it still lines a page wider than the
window up with the window's edge, under a rail, and the hold keeps that view;
holding the place instead would show the margin's width less of such a page,
and could leave a page narrower than the column out of the room. Scrolled all
the way right, a page's right edge now stands at the margin where it stood
under the side rail, so at 200% 0.77 of the page is in the room where 0.80 was
(0.58 against 0.61 with the panel open). With pages of mixed widths the middle
is a fraction of the column, which the widest page sets, and a narrower page is
centred in the column rather than in the room: from the left edge of a
landscape page, a portrait page reached by scrolling stands at 163/-108 from
the rails at 150% (0.88 of it in the room; the old viewer 28/27, all of it),
208/-459 at 200% (0.63; 0.77) and 253/-810 at 250% (0.47; 0.62), and a jump to
it from there with the panel open leaves 0.70 of it in the room (0.78). A
reader at the column's right edge stays at it, and a narrower page stands left
of the room's middle: in fit width, through the refit when the panel opens,
0.89 of the portrait page in the room, where the old viewer, its sideways
scroll gone, centred it; at 200% with a page turned to landscape, 0.69 of the
next portrait page where the old viewer showed 0.80.

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
