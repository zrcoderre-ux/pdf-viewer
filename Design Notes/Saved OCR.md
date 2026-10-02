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
