## Viewer Features

In addition to citation linking, the viewer supports:

- **Sharp type at any screen scaling** — pages are drawn in the screen's own
  pixels, so on a Retina or 125%/150%-scaled display, or in a window zoomed
  past 100%, the page is no longer stretched to fit and its type stays crisp.
  Moving the window to another screen, or changing the browser's zoom, draws
  the pages again at the new resolution.
- **A zoomed page can be scrolled clear of the panels** — a page zoomed wider
  than the room between the tools rail and the side rail (or the open Pages,
  Bookmarks, Comments or Attachments panel) scrolls sideways far enough to
  bring either edge clear of them. (A page only just wider than the room, such
  as a letter-size page at 150% in a 1280-pixel window with Windows' scroll
  bars, gets a short sideways scroll.) With one page to a row it also keeps
  its place: opening or closing the panel, dragging its edge, collapsing the
  tools rail, zooming or resizing the window keeps the same part of the page
  in the middle, and a page scrolled all the way to one edge stays at that
  edge. A document opens with the page's left edge in view, where a pleading's
  line numbers are, and so does a switch back to one page to a row. In Fit
  width and Fit page, dragging the panel's edge refits the page, as opening or
  closing the panel does. With two pages side by side the pages move as they
  always did. Where the pages differ in width, a page narrower than the widest
  can stand off-centre. **←** and **→** turn the page; where the pages are too
  wide for the window beside the tools rail they scroll sideways first, as
  they always did, and now turn the page once there is no more to scroll that
  way. Holding the key stops at the edge; press it again to turn the page.
- **Text selection and copy** — text is selectable as soon as a page is
  shown: click and drag, and a small toolbar opens under the selection with
  **Highlight**, **Underline**, **Strikethrough**, **Comment**, **Copy** and
  **Cite** (copy with a record citation). Ctrl+C (Cmd+C on macOS) copies too,
  and right-click offers the same and more. Selection geometry aligns with the
  rendered glyphs at every zoom level.
  - A drag may **start on a citation link** (or a link the PDF carries): once
    the pointer moves, it selects the words under the link, as a drag begun
    anywhere else does. A click that stays put still opens the link.
  - A PDF opened in a **background tab** of the app (several files or a case
    folder opened at once) has selectable text when you switch to it. pdf.js
    measures a "minimum font size" once per window, and a hidden tab measured
    0, which left every word a box of no size; `viewer/text-layer.js` writes
    the sizes back.
  - A **scanned page** has no text until it is recognized. Dragging over one
    while OCR is off says so once, with a **Recognize text** button.
- **Rectangle (marquee) selection** — sweep a box to select text by region
  (handy for columns and tables); the boxed text can then be copied or
  highlighted. Start a box either by holding **Alt** and dragging (either mouse
  button), or by turning on the **▭ Box select** tool in the toolbar and
  dragging with the left button. This is an alternative to the default flowing
  selection.
- **Selectable text area (crop)** — turn on the **⬚ Text area** tool and drag a
  box to define exactly what's selectable; text outside it (e.g. pleading line
  numbers in the margin) becomes non-selectable, so a normal drag can't sweep it
  in. The numbers stay visible on the page — they just don't join your selection
  or copy. The area is remembered and applied to every document until you change
  it or **Reset to full page**. (With no area set, the viewer still auto-detects
  and excludes a pleading line-number column.)
- **Redaction** — mark what has to go (every real value the pseudonym key
  binds, plus anything you drag over), check it while it is still only
  proposed, then save a flattened copy with it blacked out — no text layer, no
  metadata, and never over the original. In the viewer, and in the text reader
  from beside the export the PDF was scrubbed into. See below.
- **Highlighting** — select text and pick **Highlight** from the toolbar that
  appears under the selection (or turn on the Highlight tool, **H**, and every
  selection is highlighted as you release the mouse). Highlights are saved into
  the file as real PDF highlights and stay editable after reopening; see
  *PDF editor* above.
- **Repeated section numbers** — a brief that names a code once ("Code of Civil
  Procedure section 425.16") and then drops it gets its later bare references
  linked too: on that page, `§ 425.16(b)` and `section 425.16` resolve to the
  same statute. Inheritance runs forward only, stops at the page break, and
  stands down where one page ties the same number to two different codes
  (`Civ. Code § 1542` and `Pen. Code § 1542`), leaving those bare references
  unlinked rather than guessing.
- **Lists of sections** — a code named once carries down the whole list,
  however it is punctuated: `Code of Civil Procedure sections 1010.6 or 1013
  and 1170.7` links all three, and so do `Civ. Code §§ 1542, 1543, or 1544`,
  `section 1013 and/or 1013a`, and `Gov. Code §§ 12940 & 12945`. The list ends
  where the next citation begins, and where the number counts something rather
  than naming a section (`section 1013, or 10 court days later` links 1013
  alone).
- **CACI jury instructions** — references like **CACI No. 3710** (also
  `CACI 3710`, `CACI Nos. 3710, 3711`, verdict forms `CACI No. VF-3900`) link to
  the instruction on your provider.
- **Federal regulations and codes** — `29 C.F.R. § 2560.503-1`, `45 CFR
  164.512(a)`, `40 C.F.R. pt. 60`, `Treas. Reg. § 1.125`, `42 U.S.C. § 2000e-2`,
  `Internal Revenue Code section 9801(f)`, `Bankruptcy Code § 362(a)` and
  `ERISA § 502(a)` all link, and are searched nationally rather than through
  the California filter that scopes a state-code search. See below.
- **IRS revenue rulings** — `Rev. Rul. 2013-17`, `Revenue Ruling 2013-17`,
  `Rev. Rul. 83-137, 1983-2 C.B. 41`, and chained lists (`Rev. Ruls. 2003-102,
  2003-103 and 2004-45`) link to the ruling on your provider.
- **Table of Authorities** — a side panel listing every detected case,
  statute, regulation, revenue ruling, rule, and CACI instruction once, as a
  clickable link to your provider; minimizable and drag-resizable. The same panel appears for
  claude.ai, where it is cumulative: an authority stays listed for the rest of
  your time on that conversation, even after the message it came from has
  scrolled out of the page and been unmounted. Options →
  "Table of Authorities" has separate checkboxes for the PDF viewer and
  websites (default: **off** for PDFs, **on** for websites); in-text links are
  unaffected either way.
- **Auto-scroll while reading** — the **↓ Auto-scroll** toolbar button (or the
  **A** key) creeps the document upward at your reading pace, so a long brief
  reads without touching the wheel. See below.
- **OCR** scanned PDFs on demand with **Recognize text (OCR)** in the tools
  rail — text becomes selectable and citations get linked. Enable
  "Automatically OCR scanned documents" in Options to run it without the
  button. The whole document stays on screen while it is read: every page is
  shown at once, the page you are looking at is recognized next (scroll ahead
  and OCR follows you), each page's text becomes selectable as soon as that
  page is done, and a progress chip in the lower left counts the pages.
  Comments can be added while it runs. Citation links appear once every page
  has been read, since a short cite can point back to any earlier page. Recognized
  pages are saved in the browser, so reopening the same scan (same file, any
  URL or name) brings its text straight back without recognizing it again;
  a scan not opened for 30 days is forgotten (Options → "Keep OCR results
  for", 0 = don't keep; "Forget saved OCR" clears them now).
- **Rotate pages** — the **⟳ Rotate pages** tool (or the **R** key) turns a
  sideways scan or an upside-down page the right way up, on any document. The
  rotation is on screen straight away; writing it into the file is a separate
  click, and is offered for web PDFs too (as a copy). See below.
The **☀ / 🌙** button in the top bar toggles between dark (default) and light
themes; the choice is remembered. The **document name** menu renames the file,
sets how it is named, shows its properties, and (for a web PDF) opens the
original in Chrome's built-in viewer, skipping the linker. For a web PDF,
**Download** saves the original with a smart filename (see below).

Every document tool works on any PDF. For a file opened from disk the result is
written back into it; for a web PDF the first save asks where to put the copy,
and later saves go to that copy. Bates numbering, header / footer, watermark,
split, organize, insert and add-images are described under *PDF editor* above;
a few details:

- **Bates numbering** — prefix, starting number, digit count and corner;
  placement is exact on standard pages and rotation-aware.
- **Header / footer** — six slots (header/footer × left/center/right); `{n}` is
  the page number and `{N}` the total (e.g. `Page {n} of {N}`).
- **Split** — every N pages, one page per file, or ranges like `1-3, 4-8, 9-`.
  Parts save into a folder you pick (or as downloads), and each part keeps the
  comments on its pages.
- **Add images as pages** — JPG/PNG, plus WebP/GIF/BMP by automatic
  conversion, each sized to fit US Letter.
- **Fill form fields** — appears when the PDF has AcroForm fields; lays
  editable controls over them (text, checkbox, radio, dropdown). **Save
  filled** keeps the fields editable; **Save &amp; flatten** bakes the entries
  in and removes the fields.
