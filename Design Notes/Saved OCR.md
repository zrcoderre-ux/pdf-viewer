## Saved OCR (`viewer/ocr-store.js`)

A scan OCR'd once is not recognized again when it is reopened. Each
recognized page's word boxes (PDF user space, the same thing `ocr.js` caches
in memory for zoom) go into IndexedDB (`ocrCache` / `pages`), one record per
page, keyed by a SHA-256 of the document's bytes plus the page number.

- **Keyed by bytes, not URL or name.** Court-portal URLs are often one-time
  links; the same file opened from the web, from disk, or renamed finds the
  same pages. A changed file is a different document.
- **Opening.** `renderBytes` calls `openOcrDocument(pdfBytes)` alongside the
  parse. It sweeps records past the keep window and returns whether this
  document has saved pages; if so, OCR is switched on for it (as if the
  button were clicked), and `ocrWords` reads each page from the store before
  falling back to Tesseract.
- **Keep window.** `ocrCacheDays` in `chrome.storage.sync` (default 30, max
  365), measured from last use — a hit re-stamps the record. 0 keeps nothing
  and sweeps everything. Options also has **Forget saved OCR**, which deletes
  the database (open viewers close their connection on `versionchange`).
- **Edits.** An in-place edit reloads without `resetOcr`, so the in-memory
  pages are saved under the new file's hash. Organize and saved rotation pass
  their page plan to `reloadEditedBytes`, and `remapOcrPages` moves each
  page's words to its new position, dropping pages the plan turned (their
  boxes were measured at the old stored angle). A highlight-only Save doesn't
  reload, so `rememberOcrFor` saves the pages under the written file's hash.
- **Versioning.** `OCR_RECORD_VERSION` is bumped when recognition changes
  (scale, engine, language data); older records are ignored and age out.

`test-ocr-store.mjs` pins the pure parts: the key, the record round trip,
expiry, and which pages survive a page plan.

## Which pages Recognize text reads (`viewer/ocr.js`, 2026-11-19)

The owner: "PDF+ OCR does not work … Yes, the recognize text button", then
"When the PDF is visibly garbled, that should be treated as if it is not
garbled. it is only when the invisible text layer is garbled …" and "it should
always produce a text file that looks like the visible PDF (so it shouldn't
produce invisible garbles, but should produce visible garbles)".

A page used to be read only where its text layer had under `MIN_CHARS` (8)
characters, so two kinds of page went unread:

- **A scan under an e-filing stamp.** eCourt sets "Electronically FILED by
  Superior Court of California …" over a scan as text. A page whose own text
  is under `SPARSE_CHARS` (400) and a picture covers half of it or more
  (`imageCoverage` over the operator list, the transform followed through
  save / restore / transform and form XObjects; `pageIsScan`) is read with the
  stamp KEPT (`refs.keepText`): PDF.js lays the stamp out first, the
  recognizer's words standing on it are dropped (`withoutKept`, the items'
  boxes in the page's view at scale 1), and the textContent is the stamp's
  items then the recognizer's.
- **A garbled invisible text layer.** Private-use code points, U+FFFD and
  control characters (`isGarbledChar`) in at least 12 characters and 3% of
  the page (`pageTextIsGarbled`), counted again over only the text drawn
  invisibly (render mode 3 or 7, `invisibleTextCounts` off the glyphs'
  `unicode` in the operator list; `invisibleTextGarbled`): the page is read
  and the recognizer's text replaces the layer. Garbled text drawn VISIBLY
  is the page's own appearance and is left: the text matches what the page
  shows, boxes and all.

`renderAllPages` decides per page; the operator list is asked only where the
text has garbled characters at all, or is a scrap. Tests:
`test-ocr-button.mjs` (a plain scan, a stamped scan, a garbled invisible
layer, visibly garbled text left, an ordinary page left, and the weighing).


## A page marked as having a bad text layer (`pdf-edit.js`, `BAD_LAYER_KEY`)

The owner (2026-11-25): "I need a way to indicate that the visible text for a
page is good, but that the original text layer for that page is garbage …
This should work inside PDF+ and go into PDF Linker." His example: a heading
that shows AMERICAN BAR ASSOCIATION over a layer reading
`-0&,$%-!'-,?$#,-#$"!'-@@"%$-#$"!`. That is a cipher of printable
punctuation, so no garble test here catches it (`pageTextIsGarbled` counts
private-use, control and replacement characters), and PDF-Linker's page-wide
measures pass a short page or a garbled heading among sound lines.

- **The control.** Right-click a page with nothing selected (not on an
  annotation, no tool on): **Page N: text layer is bad (read what the page
  shows)**, or on a marked page **Page N: text layer is fine after all**
  (`setBadLayer`, a listener on `pagesEl` that stands down where the
  selection's menu, an annotation's or Alt's browser menu took the event).
- **The mark is in the file.** `saveEditedPdf({ badLayer })` writes
  `/PDFLinkerBadTextLayer true` on the page's dictionary (or deletes it),
  saving at once, unsaved comments and an on-screen rotation with it, as Save
  does, behind the same check against a newer copy on disk. A page dictionary
  is where PDF-Linker keeps its own page facts (`/PDFLinkerDidNotOCR`): it
  travels with the PDF and survives Organize and rotation, which move page
  dictionaries whole. A document carrying a mark is saved without object
  streams (`buildEditedPdf`, `applyPagePlan`), so the name stands in the
  bytes where `mayHaveBadLayer` finds it without a parse.
- **The viewer.** `inspectDocument` reads the marks (`badLayerPagesOf`) into
  `docBadLayer`, and the render loop sends a marked page to the recognizer
  whatever Recognize text is set to, with no stamp kept: its text, for Find,
  selection, copy, links and naming, is what the page shows.
- **The reader's screenshot.** `shotPdfPrep` reads each PDF's marks once
  (`readBadLayerPages`, off the file `openPdfNow` keeps on the info), and
  `pdfNamesOn` leaves a marked page out of the picture whole, before
  `textPageClean` is asked: the page's layer, and the export page read off it,
  are no evidence that it holds no name. A PDF whose marks could not be read
  in time is left out the same way.
- **PDF-Linker.** The next full run rebuilds a marked page's text layer from
  its render with none of its own tests, then takes the mark off
  (`_reocr_garbled_pages`, its notes "OCR.md"). Saving the mark changes the
  PDF, so ▶ Re-run's `--auto` takes the full run. After it the page reads as
  any rebuilt page does, here and in the export (its REBUILT banner).

The key's name is a format the two programs share and changes only in step.
`test-bad-text-layer.mjs` pins the viewer's side; `test-shot-pictures.mjs`
case I the screenshot's.
