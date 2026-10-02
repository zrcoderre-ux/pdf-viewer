# Legal Citation Linker — Chrome Extension

A PDF editor for Chrome and the web, built around a port of `pdf_linker.py`:
every legal citation in a PDF becomes a clickable link to Westlaw or Lexis+.
Beyond reading, it covers the everyday work of Adobe Acrobat Pro — comments
and markup, signatures, form filling, text edits, page organizing,
redaction, password protection, Bates numbering, compression, comparison
and export to Word. The Chrome extension opens PDFs from the web in the
viewer; the web app (`pwa/`) opens files from disk in tabs, in as many
windows as you like, and saves back to the same file.

Nothing is written into a PDF until you save, and citation links are never
written into it — they are overlays, drawn fresh each time.

## PDF editor

The window has three parts: the **top bar** (document name, page and zoom
controls, undo / redo, Find, Print and Save), the **tools rail** down the left
(every tool, grouped, with a *Find a tool* search box at the top; the button
at the far left of the top bar collapses it to icons, and a narrow window
starts it collapsed), and the **side rail** on the right (page thumbnails,
bookmarks, the comments list and attachments).

| Group | Tools |
|---|---|
| Comment | Highlight, Underline, Strikethrough, Sticky note, Text box, Draw, Rectangle, Ellipse, Line, Arrow, Stamp |
| Fill & Sign | Fill form fields (when the PDF has them), Add text, Signature, Initials, Checkmark, Cross, Date |
| Edit PDF | Edit text, Add image, Whiteout, Add link |
| Organize Pages | Organize pages, Insert blank page, Insert from file, Add images as pages, Extract pages, Split, Crop pages, Rotate pages |
| Protect | Redact, Protect with password, Remove password, Remove hidden info, Flatten |
| Numbering & Marks | Bates numbering, Page numbers, Header & footer, Watermark |
| Export & Optimize | Export to Word, Export to text, Export as images, Compress PDF |
| Read & Review | Box select, Selectable text area, Recognize text (OCR), Compare files, Read aloud |

**Comments are real PDF annotations.** Highlights, notes, text boxes, shapes,
ink, stamps, signatures and links are saved as the standard annotation types
(`/Highlight`, `/Text`, `/FreeText`, `/Ink`, `/Square`, `/Line`, `/Stamp`, …),
each with its own appearance stream, so Acrobat, Preview and Chrome show them
exactly as drawn here, and reopening the file here brings them back editable.
Comments another program made show up in the comments list and can be
edited or deleted the same way.

- **Comment.** Pick a markup tool and drag across text, or select text first
  and choose Highlight / Underline / Strikethrough / Comment from the small
  toolbar that appears under the selection (Comment highlights the passage and
  opens its note to type in). Click a comment to select it: drag to move, pull
  a handle to resize, arrow keys to nudge (Shift for ×10), Delete to remove,
  double-click to edit its text or note. The bar at the top of the page sets
  colour, line width, opacity, font and size for the selection or the next
  one. Right-click a comment for more (change markup type, colour, duplicate,
  delete). **Undo / Redo** (Ctrl Z / Ctrl Y) cover every change.
- **Comments list.** The speech-bubble button on the right lists every
  comment by page, with its author, date and text; search it, and click one to
  go to it. The author name is set under Document properties.
- **Fill & Sign.** Signatures and initials can be drawn, typed (in a choice of
  script fonts) or taken from an image, and are remembered for next time.
  Add text types straight onto the page (for flat forms); Checkmark, Cross and
  Date drop in with one click. PDFs with real form fields get **Fill form
  fields**, with Save (fields stay editable) or Save & flatten.
- **Edit PDF.** **Edit text** (E) edits the document's own text. The page's
  paragraphs are outlined; click one and type — it rewraps inside its box,
  keeps its first-line indent, line spacing and alignment (left, justified,
  centred), and keeps its bold, italic and superscript runs (an italicized
  case name stays italic; Ctrl+B / Ctrl+I, or the **B** / **I** buttons,
  change them). Drag the box's side handles to rewrap it wider or narrower,
  or drag it to move it; Delete empties a paragraph; right-click → *Restore
  original text* takes an edit back. On save the paragraph's old glyphs are
  taken **out** of the page's content (including text inside form XObjects),
  and the new words are written in as real, searchable text — nothing is
  covered up, so search, copy and every other reader see only the new words.
  **Whiteout** hides whatever is under it; **Add image** places a picture;
  **Add link** makes a region link to a page or a web address.
- **Organize pages.** Reorder by dragging thumbnails, rotate, delete, or
  extract; insert blank pages or another PDF's pages at any position; add
  images as new pages; split into several files; crop margins (with *Remove
  white margins* detecting them for you). Comments move with their pages.
- **Protect.** **Protect with password** encrypts with 256-bit AES, with an
  optional owner password that restricts printing, copying and editing.
  Password-protected PDFs open with a prompt (RC4 and AES files alike), and a
  document that came in protected is saved back protected. **Redact** removes
  text for good (see below); **Remove hidden info** strips metadata, scripts,
  attachments, comments, links and bookmarks; **Flatten** burns comments and
  form fields into the page.
- **Numbering & marks.** Bates numbers, page numbers (`Page {n} of {N}`),
  headers and footers in six positions, and diagonal watermarks.
- **Export & optimize.** **Export to Word** writes a `.docx` with the PDF's
  paragraphs, headings and page breaks; **Export to text** writes the page
  text in the text reader's page format; **Export as images** saves pages as
  PNG or JPEG (several pages as a folder or a `.zip`). **Compress PDF**
  re-encodes large images at a chosen quality and drops unused objects.
- **Compare files** lists every word-level change between this PDF and
  another version, page by page, and can save the report.
- **Find** (Ctrl F) highlights every match on every page, with match-case and
  whole-word options. **Print** (Ctrl P) prints every page, comments included.
- **View.** Fit width, fit page, actual size or any zoom (Ctrl + wheel);
  single page, two pages, or two pages with a cover; **Presentation mode**
  (Ctrl L) shows one page at a time full screen. **Document properties**
  (Ctrl D) edits the title, author, subject and keywords. **Read aloud** reads
  the document with the system voice.
- **Saving.** A file opened from disk in the app is saved in place (Ctrl S),
  with a dot on the Save button while there are unsaved changes. A PDF opened
  from the web shows **Download** (the original) and **Save as…**, which saves
  a copy with your changes and then keeps saving to that copy. Closing a tab
  with unsaved changes asks first. Press **?** for every keyboard shortcut.

## User guide

Each feature below has its own page in `User Guide/`.

- **[Viewer Features](User%20Guide/Viewer%20features.md)** — Beyond citation links, the viewer offers text selection with a toolbar to highlight, comment, copy or cite, box selection, a selectable text area that leaves out pleading line numbers, a Table of Authorities panel, on-demand OCR for scans and page rotation. Its document tools add Bates numbers, headers and footers, split files and fill form fields.
- **[Shift + Space = middle click](User%20Guide/Shift%20%2B%20Space.md)** — Shift + Space opens the link under the mouse, or every link in a selection, in background tabs, the way a middle click does. It works on any website, in the PDF viewer and in the text reader. With no link involved it scrolls as usual, and Options can turn it off.
- **[Auto-scroll while reading](User%20Guide/Auto-scroll%20while%20reading.md)** — The ↓ Auto-scroll button or the A key moves the document up at a speed set in pages per minute, so a long PDF reads without scrolling. It pauses while you scroll, select text or have a dialog open, then resumes; Space pauses it and [ and ] change the speed.
- **[Rotating pages](User%20Guide/Rotating%20pages.md)** — The ⟳ Rotate pages tool (or R and Shift + R) turns this page, all pages, or odd or even pages, on any document, including a web PDF. Rotation shows on screen first, and Save rotation writes it into the file, or into a copy for a web PDF. Citation links, highlights and OCR text turn with the page.
- **[Redaction](User%20Guide/Redaction.md)** — The ▬ Redact tool proposes a box over every real value in the case's pseudonym key, plus anything you drag over, for review before saving. Save redacted copy writes a new PDF of page images with no text layer, annotations or metadata, and never changes the original. A check against the text export points to values the sweep missed.
- **[Citation links on claude.ai](User%20Guide/Citation%20links%20on%20claude.ai.md)** — On claude.ai, the extension underlines cases, statutes and rules of court in Claude's responses and links each to Westlaw or Lexis+. A Table of Authorities panel lists every authority cited in the conversation. Options can turn linking on for other websites and list sites to leave alone.
- **[Smart PDF Naming](User%20Guide/Smart%20PDF%20naming.md)** — The extension names a web PDF from its source filename (the default) or from the title in a court filing's footer, shortened to a standard type such as Demurrer or Smith Decl. ISO Mot. Open tabs that would share a name get a qualifier to tell them apart, and a PDF opened from disk keeps its own name.
- **[Faithful port of pdf_linker.py](User%20Guide/Port%20of%20PDF-Linker.md)** — Citation detection is a line-by-line port of `pdf_linker.py`, verified against the Python on a sample memorandum. It reads California, federal and regional reporters, all 29 California codes, federal statutes and regulations, IRS revenue rulings and rules of court, plus supra references, italicized short names and case citations with no year.
- **[Text reader for PDF-Linker's exports](User%20Guide/Text%20reader.md)** — The text reader opens PDF-Linker's `.txt` exports and case folders and shows the real names from `pseudonym_key.xlsx` on screen only, with citations linked and the source PDF beside the text. It walks you through the LEAKS worksheet and any real names left unfaked, saves edits in pseudonyms, and flags missed names for PDF-Linker's next run.

## Provider toggle: Westlaw / Lexis+

A toggle in the popup, viewer toolbar, and options page lets you choose where
citations resolve to. Stored in `chrome.storage.sync` so it follows your
Chrome profile.

URL fallback construction uses the same dual-provider tables as the Python
script — `WL_SEARCH_PREFIX` for Westlaw (`CA CIVIL § 1542`) and
`LEXIS_SEARCH_PREFIX` for Lexis+ (`Cal Civ Code § 1542`). Lexis+ doesn't
expose a public citation-direct deep-link API (its permalinks need an
internal UUID), so Lexis URLs use the universal search endpoint
`https://plus.lexis.com/search?pdsearchterms=...`. Signed in, the cited
document is the top hit on the results page. For cases, the Lexis search term
combines the **full case name (both parties)** with the reporter cite (e.g.
`People v. Smith 13 Cal.App.5th 1152`) — the reporter cite is the unique anchor,
and both party names improve accuracy when the lead party is generic.

## citation_repo.json support

The Python script reads a curated JSON file from your SharePoint folder that
maps citation keys to hand-verified URLs. The extension resolves against the
same data when it's present in `chrome.storage.local` under `citationRepo`.
(The upload form was removed from the Options page; a repo already stored
there still applies.) Resolution priority matches the Python:

```
westlaw provider → westlaw_url > lexis_url > fallback_url > url > built
lexis provider   → lexis_url   > westlaw_url > fallback_url > url > built
```

(The Python is `lexis > westlaw > fallback > url`; the extension respects
the *active* provider's URL first, falling back across providers, which is
the behavior most users expect from a provider toggle.)

## Install

### 1. Get PDF.js

This downloads two files (`pdf.mjs` and `pdf.worker.mjs`) into `pdfjs/build/`.

**Windows:**
```
python fetch-pdfjs.py
```

**macOS / Linux:**
```bash
./fetch-pdfjs.sh
```
(Or `python3 fetch-pdfjs.py` — same result.)

### 2. Load the extension

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top right)
3. Click **Load unpacked** and select this folder

For local PDFs (`file://`), enable **Allow access to file URLs** on the
extension's details page.

## Tests for the editor

`node test-annot-pdf.mjs` writes every kind of comment, saves, reopens and
compares, checks the file holds standard annotation types with appearance
streams, and runs the page tools (blank pages, insert from file, crop on
plain and turned pages, properties, flatten, sanitize) on real output.
`node test-pdf-crypt.mjs` checks MD5 / RC4 / AES against published vectors
and Node's crypto, protects and reopens a document with user, owner and wrong
passwords, and — when Python's `pikepdf` is installed — opens RC4-40,
RC4-128, AES-128 and AES-256 files it made and has it open a file protected
here. `node test-textlayout.mjs` covers page reading, the Word and text
exports, Compare's diff, Find's matching and the zip writer.
`node test-text-layer.mjs` covers the text layer repair: spans laid out with
no layout get their items' heights back, and a sound layer is left alone.
`node test-pdf-text-edit.mjs` covers Edit text: the content-stream reader,
line layout, finding paragraphs, and edits saved and read back with pdf.js —
old words gone and new ones present on a standard-font page, inside a form
shared by two pages (only the edited page changes), in a kerned TJ line
(the words either side stay put) and in a composite (Type0) font.

## What it does not do

- It does **not** write citation links into the PDF (they are overlays).
  Keep using `pdf_linker.py` if you need a permanent linked PDF.
- **Edit text** works a paragraph at a time: an edited paragraph rewraps in
  its own box and the rest of the page does not move to make room, as in
  Acrobat. The new words are set in the standard font nearest the original
  (Times, Helvetica or Courier, each in bold and italic) rather than the
  document's own embedded font, whose subset seldom holds the letters a new
  word needs; characters outside the Western European set become "?". Text
  that is part of a scanned image has no text to edit (use Whiteout and Add
  text), and text set at an angle is left alone.
- It does **not** make digital (certificate) signatures. Signatures are
  images of your signature, as with Acrobat's Fill & Sign.
- It does **not** run any code on remote servers. Everything happens
  locally in the browser. The only network requests are the PDF fetch
  itself and any Westlaw / Lexis link the user clicks.

## Files

```
manifest.json                        MV3 manifest
background.js                        webNavigation -> viewer redirect
popup.html / popup.js                Toolbar popup (provider toggle + legend)
options.html / options.js            Options page (provider, naming, sites, OCR)
viewer/reader-options.js             Options page: the text reader's default font and leading (module)
citation-site-rules.js               Where web citation links may run (shared)
viewer/shift-space-open.js           Shift+Space = middle click (viewer, text reader + all sites)
viewer/viewer.html                   PDF viewer shell
viewer/text-reader.html / .js / .css Text reader for PDF-Linker's exports (pages, cites, key)
viewer/textdoc.js                    Text reader's document model (pure; test-textdoc.mjs)
viewer/pdfsync.js                    Text reader's PDF pane decisions: matching, ranges, scroll sync (pure; test-pdfsync.mjs)
viewer/rules.js                      Text reader's box-drawing glyphs drawn as boxes (column grid pure; test-rules.mjs)
viewer/columns.js                    Text reader's space-aligned columns laid out on the font's own grid (cuts pure in textdoc.js; test-textdoc.mjs)
viewer/pseudo-key.js                 pseudonym_key.xlsx reader + fake↔real swaps (pure; test-pseudo-key.mjs)
viewer/xlsx-read.js                  Minimal .xlsx reader (pure; test-xlsx-read.mjs)
viewer/xlsx-write.js                 Writes cells back into an .xlsx, the rest copied through (pure; test-xlsx-write.mjs)
viewer/leaks.js                      Text reader's LEAKS.xlsx model: rows, Fix? cells, where a row points (pure; test-leaks.mjs)
viewer/web-shim.js                   chrome.* shim for the hosted (PWA) pages
viewer/theme-boot.js                 Saved theme applied before first paint (viewer + reader)
viewer/viewer.css                    Design tokens (dark / light), chrome, page + textLayer + linkLayer styles
viewer/viewer.js                     PDF.js loader, two-pass renderer, top bar, panels, zoom, saving, app wiring
viewer/icons.js                      SVG icon set; [data-icon] placeholders filled on load
viewer/ui.js                         Menus, context menus, toasts, dialogs
viewer/annotations.js                Comment tools on screen: drawing, selecting, moving, editing, undo, comments list
viewer/annot-pdf.js                  Comments as PDF annotations: read, write with appearance streams, flatten (test-annot-pdf.mjs)
viewer/features.js                   Document tools: password, pages, crop, numbering, sanitize, flatten, export, compress, compare, properties, presentation
viewer/pdf-crypt.js                  PDF password security: RC4 / AES-128 / AES-256 open, AES-256 protect (test-pdf-crypt.mjs)
viewer/find.js                       Find in document over the text layers (matching pure; test-textlayout.mjs)
viewer/print.js                      Print every page at print resolution
viewer/signature.js                  Signature / initials dialog: draw, type, image; saved signatures
viewer/textlayout.js                 Page text as lines and paragraphs; Word / text export; Compare's word diff (pure; test-textlayout.mjs)
viewer/zip.js                        Small zip writer for .docx and image exports (test-textlayout.mjs)
viewer/pdf-text-edit.js              Edit text: paragraphs from pdf.js text, line layout, glyphs taken out of content streams, new text written (pure; test-pdf-text-edit.mjs)
viewer/autoscroll.js                 Auto-scroll engine + control bar
viewer/rotation.js                   Page rotation: angles, bar, geometry
viewer/ocr-store.js                  Saved OCR: recognized pages kept by file hash for N days (pure parts; test-ocr-store.mjs)
viewer/redact.js                     Redaction: boxes in PDF points, a store per document, the key sweep's decisions, the copy's name (pure parts; test-redact.mjs)
viewer/pdf-edit.js                   PDF writing (pdf-lib): comments, page plans, stamps, crop, blank pages, metadata, sanitize, the flattened redacted copy
viewer/key-library.js                The pseudonym keys this browser has been shown — one library, reader and viewer
viewer/highlights.js                 Selection, markup from a selection, box select
viewer/text-layer.js                 pdf.js text layer spans given their size back when laid out in a hidden tab (test-text-layer.mjs)
viewer/citation-linker.js            Detection + URL resolution
viewer/footer-naming.js              Footer-derived naming rule engine
viewer/disambiguation.js             Cross-tab collision registry
viewer/reporters.js                  Reporter list (port of REPORTERS_RAW)
viewer/statute-codes.js              Code patterns (port of STATUTE_CODES)
viewer/federal-codes.js              C.F.R. / U.S.C. / named federal codes
viewer/code-tables.js                WL / Lexis search prefix tables
fetch-pdfjs.sh                       One-time PDF.js download
User Guide/                          One page per feature, linked from this README
Design Notes/                        How the code works and why, one file per area (see PROJECT_SUMMARY.md)
```
