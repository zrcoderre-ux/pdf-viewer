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
column (`#pages-end`) carries the scroll width on: from the room's left edge
as far as the pages are wide (the widest page, or two side by side the widest
left and the widest right page with the 14px gap between them;
`notePageWidth`, `measurePageWidths`), and on by the side rail and any open
panel (`--right-cur`), so scrolled all the way the page's right edge meets the
side rail or the panel. It moves no page: at every `scrollX` the window reaches
without it, every layout shows exactly what it shows without it, and a page
that reaches only into the margin gets no sideways scroll. With it:

- A page whose right edge would stand under the side rail or the panel has a
  sideways scroll as far as that edge, with classic scroll bars (Windows) a
  15px bar under the pages. At 1280px with the rail open, a Letter page at 150%
  reaches 1px into the margin and has none, at 155% 4px and at 160% 34px; with
  the panel open, 205px at 150%. The widest page sets it for every page: a
  landscape exhibit in a document fitted to its portrait pages gives them all
  the scroll and the bar.
- `setPagesWidth` writes the width on the box itself. As a custom property on
  the container it was inherited by every span of every page's text layer, and
  each change had all their styles worked out again (about 20ms against 0.1ms,
  on a 20-page and a 150-page document alike), which on a slow machine pushed
  the zoom when leaving a presentation late enough for the refit timer to fire
  during the padding's transition and keep a wrong fit.
- In a fit mode, from the room changing until the refit timer fires 200ms
  later, `body.refitting` (from `refitSoon`) takes the box away, so the old fit
  slides under the panel for those frames and the box adds no sideways scroll
  bar (a window narrowed past the old fit still has the window's own until the
  refit). A view scrolled past the window's own range is pulled back to its end
  meanwhile. In one column that is held, not taken as the reader's
  (`noteSideways`), and when the timer fires without a zoom change (in Fit
  width, a height-only resize) the hold puts the place back with the box; two
  side by side the view stays where it was pulled back. Dragging the panel's
  edge refits too, once, when the drag ends (the `#thumb-resize` handler; the
  drag holds `refitting` meanwhile), or a fit left under the panel would keep a
  bar. A refit on every move started a rebuild at each pause in the drag, and
  the next one read the page in view from a column still filling: in Fit width
  a 1000-page document dragged with two 300ms pauses landed on page 1-3. The password-locked message and a presentation have no box.
- ← and → ask whether the pages' own right edge is past the window
  (`sidewaysColumn()`), not the window's `scrollWidth`, which counts the box.
  Where it is not, they turn the page. Where it is, they scroll sideways, and
  in one column, at the edge, a fresh press turns the page and the new page
  keeps `scrollX`, so the edge the reader was at stays in view; a held key
  (`e.repeat`) stops at the edge. Two side by side and the cover keep the key
  to scrolling there, as before: a turn would land as the page buttons land it
  (`scrollIntoView`), at 200% from the left edge with 203px of the left page
  under the tools rail.

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
container sees the room and the window change, every frame of the 0.16s padding
transition, so the page eases aside as the panel opens or the rail collapses.
While a rebuild lands its pages the observer is off and the hold is asked once
a frame from `requestAnimationFrame` (`holdWhileBuilding`), until the pages are
in place, the rebuild is abandoned or a page fails to load (the `finally`
around pass 1a in `renderAllPages`). The hold writes only `scrollX`. A scroll
is the reader's, and moves the point, only where the widths (`sidewaysSig`)
have not moved since the last hold and no refit is pending (`body.refitting`);
otherwise it is the browser clamping, and is held. The left edge
(`edge = "start"`, `scrollX` 0, where a pleading's line numbers are) is held
for a new document (`resetForNewDocument`), a switch into one column from the
More menu, and, after a rebuild, a page being read that fits the room, so a
zoom past the room, or a room narrowed past that page, keeps its left edge in
view and puts its right side out. A presentation is not held
(`sideways.presenting`, from its zoom to the one it ends with, since its class
comes off before the layout is put back; one left before its zoom never sets
it), and as it ends the widths the hold last saw are forgotten
(`sideways.sig`), so the first scroll after it holds rather than reads and
leaving it brings back the place held before it. A jump to a page is
`scrollIntoView`, and the hold takes where it lands (`readSideways`), except
while a rebuild is landing its pages (`sideways.building`), when the place
held before it is put back: leaving a presentation jumps back to its page
after starting the rebuild, and page 1, whose wrapper is in place by then
(`getPage(1)` is cached), would otherwise give the jump's landing for the
place. A smooth jump is waited for until `scrollend` (`sideways.jump`), since a
scroll write would stop it short.

Limits (measured at 1280px with classic scroll bars; "between the rails" is
from the tools rail's right edge to the side rail's or the open panel's left
edge; "the window's own range" is the sideways scroll the window has with the
box taken away):

- Two-up and the cover keep their own code paths: `scrollX` 0 at open,
  `scrollIntoView`, a zoom anchored on the window's centre (`xfrac`), the pages
  sliding under a panel or rail change, ← and → only scrolling a spread wider
  than the window. The box and the refit on a panel-edge drag apply there too,
  and the box's longer range clamps less: scrolled to the right end of a spread
  at 100%, collapsing the tools rail leaves 0.87 of the left page between the
  rails where the window's own range would pull the view back to 0.95, and
  closing the panel 0.57 where it would leave 0.65. A zoom's anchor is in reach
  where the window's own range would hold the spread at the room's left edge:
  at 1024px with the panel open, 100% to 110% puts the left page's edge 14px
  under the tools rail, where the window's own range would keep it 28px clear.
- A jump lines a page whose edge is out of the window up with the window's
  edge, under a rail, as `scrollIntoView` does, and from the right end that
  takes in a page narrower than the window: Letter at 200%, the next page lands
  at `scrollX` 272 with 244px of it under the tools rail, where from the end
  of the window's own range it would stay at 231 with 203px under it (0.80
  between the rails either way).
- Holding the middle moves the page: opening the panel takes it left by half
  the panel's width, where with `scrollX` kept it stands still and the panel
  covers its right side. With pages of mixed widths the point and the right
  edge are the column's, so a reader scrolled toward the widest page's right
  edge keeps that place on a narrower page through a width change: at 150%,
  from a landscape page's right edge on to a portrait page, opening the panel
  leaves 0.51 of the portrait page between the rails, where keeping `scrollX`
  would show 0.77.
- In one column, a sideways scroll (wheel, scroll bar) made within the 200ms
  after a fit mode's room changes is taken for the browser's clamp and undone
  (`noteSideways` while `body.refitting`), where it would move the view.
- Zoomed past the room from a page that fits, the page keeps its left edge
  where an anchor on the window's centre (`xfrac`) keeps the part of the page
  at the window's centre there: Letter from 150% to 175% shows 0.88 of the page
  between the rails where that anchor shows 0.91 with 33px of its left edge
  under the tools rail.

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

**A press in a page's blank space** (`isBlankTarget`, `blankDrag`). A press
that lands on no word (the bare `.textLayer`, its `endOfContent` block, the
page wrapper or its canvas, the grey of `#pages` and `#viewer-container`) gave
the browser nothing to anchor to: Chrome put the caret at an arbitrary child
index of the layer, armed the guard, and the first pixels of movement resolved
the end somewhere else. On select.pdf at 150% a dismiss click that wobbled 2px
selected 52-77% of the page and a drag from the margin onto a nearby word
55-63%; with the Highlight tool on, a 2px wobble in the margin made a
highlight half the page high, and with Redact on, a box the size of the page
(gesture-matrix rows J, X, A, M, KH3 and KR2-KR6).

So a capture `mousedown` on `#viewer-container` (`onBlankPress`) takes a plain
left press there (`preventDefault`, and guardSelection skips that event,
`blankPressEvent`) and blurs a focused box as a press would. The grey outside
`#viewer-container` is `<body>` or `<html>`: all of it under a document shorter
than the window (one page below fit page, a landscape page at fit width, two-up
with few pages), and the strip under the last page. A capture `mousedown` on
`document` hands a press there to the same handler, except one outside
`documentElement`'s client box: a press on the window's scrollbar reaches the
page too, with `<html>` for its target. (Making `#viewer-container` at least
the window's height instead put a 15px scroll on every short document: pdf.js
appends its measuring canvas, `hiddenCanvasElement`, to `<body>` while text
layers are pending, and that inline box starts a line after the container.)
Before, a drag 60px up from there onto the page took the whole of it
(app005.pdf at 50%, 1,407-1,657 characters; CIV-110 two-up at 50%, 1,212), and
a 2px wobble in the strip under select.pdf's last page 362 characters. Under
`LINK_DRAG_PX` it is a click: the selection collapses to `caretAtPoint` at the
press, the same layer child index Chrome's own press leaves (measured at 25
points of a page), so a Shift+click after it extends from where it did; on the
grey there is no caret (Chrome's was at the nearest page's top, and a
Shift+click on a word then took half the page). Past `LINK_DRAG_PX` the viewer
makes the selection, with no snapping. Each move is read where it lands
(`elementFromPoint`), and nothing is selected until the pointer is over a span.
The anchor is the browser's caret (`caretOnWord`, caretPositionFromPoint) where
the pointer came onto that first word, read back along its way every
`DRAG_WALK_PX` on that word alone (where the move landed was a letter or two
in). After that the focus is the browser's caret wherever the pointer is over a
word, and over blank space it stays where it was, except that a move from a
word out into blank space ends at that word's edge, read the same way. A word
crossed between two moves, and never under the pointer when one landed, is not
taken: read along the whole way, a quick flick from under a page's footer took
the footer, which the PDF wrote before the body, and so the body above. A drag
begun in blank space so runs from a word the pointer was on to a word it was
on, and takes what the PDF wrote between the two, as any selection does: on a
page written in reading order, only text the pointer passed over; on one
written out of it, more (see "Written order" below). A point past the window or
over the toolbar is read at the nearest place the pages show. Within
`DRAG_EDGE_PX` of the window's edge the pages scroll, 0.85px a frame for every
pixel into the band, about Chromium's own pace for a drag begun on a word
(460-770px a second 15px into the band, 2,700-3,500 60px in, on select.pdf),
and on every `scroll` (that, or the wheel) the selection is read again where
the pointer is. `text-dragging` is set as for a link drag, and `blank-dragging`
with it (the selection bar stands aside, below). The drag ends on `mouseup`, on
a move with no button down, or on `blur`. The Highlight, Underline and
Strikethrough tools and Redact (text) read the selection it made on `mouseup`,
as they read the browser's.

Left to the browser, as before: a press on a span, a link, a comment or a form
field; Shift, Ctrl, Meta or Alt; any other button; presenting, organizing, the
drawing tools, box select, crop and area redaction. Left as they were: a drag
begun on a word that leaves the page (onto the grey, the next page's top, the
window's edge) or begins on a running header or footer still takes what the
browser gives it, and so does one whose end strays onto the selection bar,
which stands under the selection's last word as it did (select.pdf p2, a drag
from a word to the blank just under its line: 10,439 characters, to the bar's
own label after the pages); a triple-click is the browser's paragraph, which in
a text layer can be the page; a Shift+click in blank space is the browser's.
Ctrl+A is the browser's too, but takes less (see "Chrome is not text" below). A
drag that never reaches a word (margin to margin beside the lines) selects
nothing; the browser's took nothing or half the page (row B5: 0, 1,090 and
1,268 characters in three runs on main), never the lines beside it. To take
whole lines, begin on the first word.

**Written order.** A blank drag's two ends are words the pointer was on, but
what lies between them is the order the PDF wrote the page in, as for a drag
begun on a word, so on a page written out of reading order it takes text the
pointer never passed over. The cases all come down to the first word the
pointer reaches being running furniture (a header, a footer, a caption) that
the PDF wrote at the far end of the page's text from where it stands: a drag
begun outside the body, above the header or under the footer, crosses it
first and is anchored on it. Main's anchor for such presses was not
arbitrary: a press inside the text layer's box under the text (the bottom
margin, under the last line) anchored at the end of the page's text (the
start of the annotation layer after it), and one on the canvas or the grey
around the page at the page's first written word. Where a footer is written
first or a header last, those ends lie next to the pointer, so in these rows
main took less. Measured (blank-drag sweeps, select.pdf at 150% unless named;
"main" is the browser's own drag from the same press; "outside" is characters
whose line lies more than a line beyond the pointer's vertical travel):

- A running footer written before the body, crossed by a drag up from under
  it (the bottom margin, the gap under the last line, the gap between pages).
  The drag is anchored on the footer and takes the page from its first word
  down to the pointer: the body above the pointer. 220px up on select.pdf p1
  and p2 that is 1,190-1,818 characters, nearly all above the pointer's
  travel, about what main took there (1,226-2,055). On CIV-110 p1 (footer
  "REQUEST FOR DISMISSAL" written first), drags 220-400px up from under the
  footer took 1,556-2,681 of its 2,952 characters, 1,503-2,300 of them
  outside; main took 65-1,202, 0-89 outside (`p1.bd.bm.U220s12`: 2,439, 2,300
  outside; main 322, none). It takes a short drag at a small zoom: select.pdf
  at 50%, a press in the gap above page 3 dragged 60px up crosses page 2's
  footer and takes page 2 to the pointer, 1,977 characters, 1,910 outside
  (main 58); above page 2, 1,373, 1,308 outside (main 119).
- Redact (text) reads the same selection, so it marks the same text: on
  CIV-110 p1 drags up from under the footer made 67-101 boxes, 65-87 of them
  outside the pointer's travel, in 9 rows, where main made 5-40 boxes, none
  outside (`p1.bd.bm.U220s12`: 93 boxes, 87 outside; main 14, none). The
  boxes are only marks until applied, and Clear takes them off.
- A running header written after the body, crossed by a drag down from above
  it (the top margin, the gap above the page). The drag is anchored on the
  header, so it runs from the pointer's word to the page's end, below the
  pointer. order.pdf p1 (header "SMITH v. JONES" written last), a press 6px
  above the page dragged 220px down-left or down-right: 2,293 and 2,378
  characters, 2,236 outside; main 248 and 164, 11 outside. op-wm.pdf (header
  "Vantreas v. Harborview Tile Co." written after each page's body):
  `p1.bd.gapt.D220s12` 1,864, 1,746 outside (main 143, none);
  `p2.bd.ul.D220s12` 725, 560 outside (main 131-456, none);
  `p2.bd.bm.DL220s12` 735-832, 560-656 outside (main none).
- A footer written first, or a header or caption block written after the
  body, as the drag's end. One let go of on such a footer takes from its
  first word to the end of the body: from the grey beside the middle of
  select.pdf p2, 1,684 characters (1,432 outside), where main took 22. With
  autoscroll, one whose end passes over the previous or next page's footer
  does the same (p2 `ch.eol.winT` 2,527 characters, main 991;
  `au.bl.dnBack` 1,259, main 503). brief.pdf p1, whose "POINTS AND
  AUTHORITIES / Date / Time / Dept." items come last: a drag that ends on
  them takes the body after the first word (p1 `bd.bl.UR400s16` 925
  characters, 546 outside, main 51; six rows worse than main).
- Two columns, or footnotes written after the columns. A drag that reaches
  words of both takes everything between (select.pdf p3 from its margins,
  across both columns or up to the toolbar: 49-71% of the page, main 0-34%;
  in two-up at 75%, 22 rows worse than main, 15 of them on the two-column
  p3, e.g. `p4.ch.lm.winL` 2,745 characters where main took none).
- A watermark written over the words. A drag let go of on it ends in it
  (op-wm.pdf: 56% of the page, main under 1%), and Redact (text) boxes the
  words between (30-65 boxes over body text, where main made one box the
  size of the page).

Accidents (over 120 characters outside the pointer's travel, any text from a
press that never moved 4px, or a Redact box outside the travel or the size of
the page) fell over a verifier's sweep of 26,666 viewer rows (select.pdf at
50%, 150% and 200%, two-up at 75% and 150%, CIV-110, MC-050, table2, cols2,
op-wm, brief, r2, order.pdf, Redact on three of them, autoscroll and wheel)
from 12,435 on main to 883. 306 rows are worse than main, the cases above:
of a verifier's 304, 271 a page's written order and 24 a drag let go of on a
watermark.
Taken by where the press is: for presses under all of a page's text dragged
up, main 587 accidents and here 170 of 1,350 rows, 33 of them here only; for
presses above the text dragged down, main 308 and here 69 of 612, 13 here
only. The rows here only are on pages with a footer written first or a header
written last.

An earlier draft kept the anchor off a footer written first (`fromEdge`: a
press under, or over, all of a page's text began the selection at that end of
the written text once that was the shorter way to the pointer's word), which
brought the select.pdf, CIV-110 and order.pdf blank-drag accidents from 49, 12
and 18 to 11, 0 and 4. It was left out: it anchored at text the pointer never
passed over in its own cases (a header written last, at the top: a drag up
from under the page took its 49 characters; lines written bottom to top; a
drag up the margin from under the text, in at mid-page and down, took the
lines below the pointer to the page's end instead of those it passed, 159 and
103 characters where this design takes the 642 and 306 it passed), and it is
the kind of rule the minimal design set out to avoid. A narrower form (switch
only while the pointer's word lies past the first word, away from the press,
and for presses above the text too) kept its gains on the footer drags in a
verifier's sweep and took the passed lines in the last case, but not the
lines written bottom to top; whether to add it is the owner's call, and it
would need re-measuring against the sweeps above. Until then: to take lines
under a running header, or above a running footer, begin the drag on the
first word, not in the margin beyond the header or footer.

**Selection paint** (`glyphRects`, `pageSized`). The tint
(`repaintSelectionOverlay`), the record-citation bands
(`buildCitationReference`) and Redact (text) (`redactCurrentSelection`) read
the selection's client rects without the `endOfContent` block's (the whole
layer while a drag is under way, and inside the selection once the drag's end
resolved past it: the page turned blue under a drag that took one line) and
without any rect over a quarter of the page both ways (a layer or canvas that
a selection crossing a page sweeps up). Text turned across the page, a
watermark or a large stamp, has such a box too: it is not tinted and not
marked, and Redact (text) says so and points to Area (`turnedTextIn`).

The selection bar (`updateCitePopover`) is placed as before, from the
selection's last client rect, the end-of-content block's included. Placed
from the glyphs instead, it stood 8px under the end of a drag let go of in
blank space (the right margin, a line's end, the gap between lines), over the
start of the next line, and the Shift+click or click that followed there hit
the bar's Comment or Highlight button instead of extending the selection or
placing the caret (select.pdf p2-p3, 20 rows; CIV-110 p1, 18 of 30). While a
blank drag is under way (`body.blank-dragging`) the bar takes no pointer
events: it stands under the selection's last word, where the drag is going,
and over it the drag found no word. The class is the blank drag's own, set
and cleared by `blankDrag`. Keyed to `text-dragging` instead, which is cleared
only on `pointerup`, the rule left the bar click-through after a native drag
of selected text (`pointercancel`, no `pointerup`) or a touch tap on a word
(its `mousedown` comes after the `pointerup`), and a click on its Highlight
button fell through to the page and dropped the selection.

**Chrome is not text** (viewer.css). The toolbar, the tools and side rails,
the side panel, menus, the float bars, `#ocr-progress` and the toasts are
`user-select: none`: a drag from a page that strayed onto one took the
buttons' labels, and since they stand before the pages (or after them), page 1
or everything to the end with them. Boxes to type in, a comment's text and
quote in the side panel, the Table of Authorities panel (`#__cl_toa`, whose
citations are copied) and dialogs stay selectable. The selection bar is left
selectable, as it was. Made `user-select: none`, it still caught a drag begun
on a word that strayed onto it, and the browser then held that drag at the end
of the page's text, with the bar standing still under the pointer: a drag from
mid-page into the grey 40px right of select.pdf p3 took 7,821 characters in 4
runs of 4, where the browser's own, its end moving into the bar and the bar
moving off, came back to 1,622 (CIV-110 p1: 2,922 against 1,312 or 2,929).
A plain press on the bar's own padding or a separator (`.sel-sep`), between its
buttons, is the viewer's (a `mousedown` on `#cite-popover`): it drops the
selection and begins none. The bar stands 8px under the selection's last word,
where a click to dismiss it lands, about a third of it is padding, and the
browser's press there began a selection in the bar, which hangs off `<body>`
after the pages: with a 3px wobble 32 of 33 such presses on select.pdf p1-p3
took over 500 characters, up to 12,606, everything from the selection's end to
the end of the document (2px: 15 of 33). Now none does; in the blank-press
sweeps (17,116 rows over ten configurations) those were the last presses under
4px that took text, 14 rows, up to 11,757 characters, and now there are none
(main 728). The buttons keep the selection (each `preventDefault`s its own
`mousedown`), and a drag begun on a word that strays onto the bar is no press
on it, so it meets the bar as before.

Ctrl+A is the browser's, but with the chrome unselectable it no longer starts
in the toolbar: it takes the pages' text (select.pdf: 13,141 characters from
page 1, where main took 13,944 from the toolbar's labels), so it is a page
selection like any other, tinted, with the selection bar and a record citation
("(Opp. at pp. 1:1-6:28.)"). The bar is placed by `updateCitePopover`'s own
rule, above the selection's first line when its end is off screen, and no
higher than 8px from the window's top: there it covers the lower half of the
toolbar's Download and Save as buttons until a click dismisses the
selection or Escape hides the bar. Main showed no tint and no bar, since its
selection began outside the pages.

In the text reader the PDF pane is as it was, except that a press on its grey
around the pages (`#pdf-pane` itself, its scrollbar aside) or on a page's
label over its sheet (`.pdf-label`, "Page 3": half the band between two
pages) selects nothing. Presses under 4px there selected text in 12 of 126
rows of a sweep on main (p3 `dis.gapt.0_0` 2,716 characters); now none.

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
