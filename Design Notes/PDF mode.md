# PDF mode (`text-reader.js`, "PDF mode")

**📑 PDF mode** (`#pdf-mode-btn`, Ctrl+Shift+M) shows the case folder's PDFs in
the PDF viewer in the reader's own tab, and the same button goes back to the
text. The code is the "PDF mode" section of `viewer/text-reader.js`, after
`openPdfInTab`; the test is `test-pdf-mode.mjs`.

## A viewer frame per PDF

Each PDF opened is `viewer.html` in an iframe under `#pdf-mode`, handed the
file and its folder handle through `__pdfViewerLoadLocal`, as the app's shell
hands a PDF to a tab. So every tool works, and Save writes the folder's file
in place with the viewer's own check against a newer copy. `pmFrames` keeps
the frames by PDF name: switching PDFs or going back to the text hides a
frame without closing it, so its page, zoom and unsaved changes are kept. At
most `PM_FRAMES_MAX` (8) are open; the one shown longest ago with nothing
unsaved is closed to make room. A new folder (`pmTakeList`, when
`folderPdfs` is another array) drops the old frames, after asking if any of
them has unsaved changes.

- **Hidden by `visibility`, not `display`.** A `display: none` viewer has no
  size, so its overlays are measured at zero. Even with `visibility: hidden`,
  Chromium was seen putting a hidden frame back at its top, so `pmShow`
  records each frame's scroll as it hides it and puts it back when it shows it
  again without a page.
- **Auto-scroll.** A hidden frame's auto-scroll is paused
  (`autoScroll.pause()`). `autoscroll.js` fires `autoscroll-end` on the
  frame's window when it reaches the end. PDF mode opens the next PDF on that
  event and calls `autoScroll.resume()` there. The reader's own auto-scroll
  stands down while PDF mode is on (`autoRunning` checks `pdfModeOn`).
- **Keys.** A capture `keydown` on the reader's window keeps the reader's
  shortcuts from acting on the hidden text and hands focus back to the frame.
  The frame gets a capture listener of its own for Ctrl+Shift+M and
  Alt+PageUp/PageDown.

## Continuous scroll

`pmWire` listens for `wheel` on each frame's window. Wheel turned past either
end of the document (`PM_OVERSCROLL` px, within 700 ms) opens the next PDF at
page 1, or the previous one at its foot. The pill `#pm-edge` shows the next
PDF's name while the wheel is turning. The listener is not passive: for a
moment after a switch (`pmQuietUntil`) it uses up the rest of the wheel's
movement, so the new PDF does not scroll straight back out of where it
landed.

## Find through the folder

`find.js`'s `createFind` takes `onEdge(dir, query)` and `edgeOn()`. When a
step would run off either end of this document's matches, or there are none,
the viewer asks `window.__pdfFolderFind`, which only the reader sets.
`pmFolderFind` goes through the folder from the current PDF in that
direction. For each PDF it reads the text on the reader's side (`pmPdfText`:
pdf.js `getTextContent`, joined as the text layer joins it and folded by
`find.js`'s `normalize`). It opens the first PDF with a match, waits for that
page's text layer (`pmTextReady`), and calls `Find.openAt` (through
`__pdfViewerFind`) to stand on the page's first match, or its last when going
back. If no other PDF has a match, it comes back round to this one. A page
with no text is read from the viewer's saved OCR (`ocr-store.js`, by the
bytes' SHA-256), so a scan is found once the viewer has recognized it.
`pmText` caches each PDF's text by size and modified time. `pmFindSummary`
counts the matches through the folder for the top bar whenever the viewer's
find input changes.

## Only while the folder is read on

Going on from one PDF into the next, by wheel, by auto-scroll or by Find,
happens only while ↕ Read folder on (`settings.reel`) is on (`pmFolderOn`).
The frame's `__pdfFolderFindOn` hook gives the viewer's `edgeOn` that
answer, so with the setting off the viewer's Find goes round its own matches
as it does outside PDF mode. The reader's own Find follows the same setting
(`findFolderWide`): off, `scanFindFolder` does not read the folder as you
type, `findRest` and `findCombined` are empty, so Enter and › stay in the
document, and the bar says "this document only". Replace all is not a search
and keeps its reach: `replaceAllEverywhere` asks `findRest({ all: true })`,
and `awaitFolderScan` reads the folder for it with `scanFindFolder({ all:
true })`. Turning the toggle restarts an open find.

## Back to the text

`exitPdfMode` reads the shown frame's page and calls `pmBackToText`. That
finds the text page whose `PS.pdfPageOf` is the nearest at or before it,
among the pages `pdfSources` matches to that PDF, opening the PDF's export
(`pdfForName`) if the document on screen has none. A PDF whose file changed
while PDF mode was on (saved in the viewer) is dropped from `pdfCache` and
`pdfSizes`, and `refreshPdf` reads it again. The theme is read back from
`localStorage`, since the viewer can change it.
