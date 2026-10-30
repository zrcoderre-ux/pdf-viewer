# Side by side (`viewer/split-view.js`)

The viewer's **Side by side** button (`#split-toggle`, `toggleSideBySide` in
`viewer.js`) puts a second PDF to the right of the one on screen. The code is
`viewer/split-view.js`, shared by every page that holds a viewer; the test is
`test-side-by-side.mjs`; the user's page is *Two PDFs side by side* in
`User Guide/Viewer features.md`.

## A second viewer, not a second document

The viewer owns its window: the toolbar, the tools rail and the side rail are
`position: fixed`, the window scrolls (body owns scroll, propagated to the
viewport), and fit width, page turns, the sideways scroll and every overlay
read `window.innerWidth`, `window.scrollY` and the scroll width. Two documents
in one viewer would mean undoing all of that. So each side is `viewer.html`
in a frame of its own, with every tool, its own Save and its own unsaved
changes, and the page that holds the frames lays them out. The viewer knows
only two things: `window.__pdfSplitHost`, which its host sets and the button
calls (`toggle()`), and `window.__pdfViewerSplitShown(open, second)`, which
the host calls to press the button and say what it does.

## The hosts

`createSplit({ stage, scope, primary, choices, choicesLabel, wire, onLoad,
onChange })` makes one split. `attach(w)` hands a viewer window the host hook
and a scroll listener; the host calls it for every viewer it puts on the left.

- **PDF mode** (`text-reader.js`, `pmSplit`). `stage` and `scope` are
  `#pdf-mode`, so every frame of the folder is narrowed, whichever is shown;
  `pmMakeFrame` attaches each. `choices` is the folder's PDFs but the one
  shown. `wire` gives the frame beside PDF mode's keys (Ctrl+Shift+M,
  Alt+PageUp/PageDown). It is not in `pmFrames`: `pmShow` never hides it, and
  the wheel past its end, its auto-scroll and its Find stay in its own PDF.
  Its unsaved changes are owed like a PDF mode frame's (`pmSplitUnsaved`:
  `beforeunload`, the toast on the way back to the text), Re-run PDF-Linker
  saves it only when it is the folder's own file (`isSameEntry` against the
  folder's handle), and `exitPdfMode` re-reads it for the PDF pane if it saved
  a folder PDF (`pmSplitRec`, its stamp from `onLoad`). The reader's capture
  `keydown` stands down on the card (`.pdf-split-pick`), which is in the
  reader's own document.
- **The app's tab** (`pwa/app-web.js`, `splitFor`). One split per PDF tab,
  made when the tab is fed; `scope` is the tab's own frame and `stage` is
  `#tab-views`, which every tab shares, so each split's frame and divider are
  hidden by `setVisible(false)` (visibility, not display: a viewer out of
  display measures its overlays at zero) whenever its tab is not the one
  shown or Home is open (`updateChrome`). `choices` is the other PDF tabs, by
  their file as it is on disk (`tabChoice`; "as saved" where the tab holds
  changes). `tabHasUnsaved` counts the split's, so closing the tab and moving
  it to a window ask about it; a moved tab arrives without its split.
- **`split.html`** (`split.js`). The extension's viewer is a tab of its own
  with nothing around it, so `toggleSideBySide` moves it: to
  `split.html?file=<address>`, or with `?stash=1` after putting the dropped
  File (and its handle, if any) in IndexedDB (`stashFile`, `takeStash`; both
  are structured-cloneable, and it is one slot, so a cancelled move leaves
  only one behind). The left frame opens the PDF again and the split opens at
  once. The move is an ordinary navigation, so the viewer's `beforeunload`
  asks about unsaved changes. The page takes the left document's title, which
  is what a print is named after. `split.html`, `split.js` and
  `split-view.js` are in the manifest's web-accessible resources like the
  rest of the viewer's files.

## Layout

`scope` wears `pdf-split-on` and `--pdf-split-at` (a percentage of `stage`).
The injected stylesheet (`CSS`, `addStyle`) narrows `scope`'s frames, or
`scope` itself when it is a frame, to the left of the divider, and sets the
second frame and the card to its right. They are `!important` because each
host already places its frames with `inset: 0; width: 100%` (PDF mode's by
id). A frame is a replaced box and does not stretch between `left` and
`right`: its width and height are given, or it is 300 by 150. The divider
(`.pdf-split-bar`, 6px) drags with pointer capture; while it is held,
`pdf-split-dragging` takes pointer events off every frame of the stage so the
pointer is not lost to one. Double-click halves. The fraction is kept in
`localStorage` (`pdfSplitAt`), between 0.2 and 0.8. Each viewer refits on its
own resize, as it does for a window.

## The card

`begin()` opens the split at once with the card (`.pdf-split-pick`) where the
second viewer will be: the host's choices, then **Open a PDF…**. A handle
from `showOpenFilePicker` where there is one, so Save writes in place; a
plain `<input type=file>` where there is not (and in the tests, which cannot
answer the File System Access picker). The divider's folder button brings
the card back over a PDF already there; loading another asks first if that
one is unsaved, then reuses its viewer (`__pdfViewerLoadLocal` again, after
`__pdfViewerUnregister`). Close on an empty card closes the split.

## Scroll together

Off by default. Every attached viewer and the second one report `scroll`;
`last` keeps each window's last `scrollY`. With the link on, a scroll of the
left or right viewer moves the other by the same distance in pages: times the
ratio of the two `.page-wrapper` heights at mid-screen, so documents at
different zooms keep page for page. The position it moved the other to is
kept in `expect`, and the scroll event that comes back from it is recognized
and not passed on. In PDF mode the left viewer changes with ‹ ›; the first
scroll seen from a new one (`lastLeft`) is its landing, a new starting point,
not a scroll to pass on.
