## Viewer Features

In addition to citation linking, the viewer supports:

- **Sharp type at any screen scaling** — pages are drawn in the screen's own
  pixels, so on a Retina or 125%/150%-scaled display, or in a window zoomed
  past 100%, the page is no longer stretched to fit and its type stays crisp.
  Moving the window to another screen, or changing the browser's zoom, draws
  the pages again at the new resolution.
- **A zoomed page can be scrolled clear of the panels** — a page zoomed wider
  than the room between the tools rail and the side rail (or an open panel)
  scrolls sideways until its right edge meets the side rail or the panel. A
  page that only reaches into the margin beside them does not scroll; one that
  reaches under them gets a short sideways scroll, such as a letter-size page
  at 160% in a 1280-pixel window, and where one page is wider than the rest,
  such as a landscape exhibit, every page scrolls as far as it. With one page
  to a row the view keeps its place sideways: opening or closing the panel,
  collapsing the tools rail, zooming or resizing the window keeps the same part
  of the page in the middle, or the edge you were at (with a landscape page
  among portrait ones that place is the widest page's, so after scrolling
  across it a narrower page can stand further left). A document opens at the
  page's left edge, where a pleading's line numbers are, and so does a switch
  back to one page to a row. With two pages side by side, opening the panel or
  collapsing the tools rail leaves the scroll position as it is, so the panel
  opens over the pages and they shift when the rail collapses; a zoom keeps
  the part of the pages at the window's centre. **←** and **→** turn the page;
  where the pages are too wide for the window they scroll sideways, and with
  one page to a row, at the edge, a fresh press turns the page and keeps that
  edge in view.
- **Text selection and copy** — text is selectable as soon as a page is
  shown: click and drag, and a small toolbar opens under the selection with
  **Highlight**, **Underline**, **Strikethrough**, **Comment**, **Copy** and
  **Cite** (copy with a record citation). Ctrl+C (Cmd+C on macOS) copies too,
  and right-click offers the same and more. Selection geometry aligns with the
  rendered glyphs at every zoom level.
  - A drag may **start on a citation link** (or a link the PDF carries): once
    the pointer moves, it selects the words under the link, as a drag begun
    anywhere else does. A click that stays put still opens the link.
  - A **click in blank space** (the margin, between lines, the grey around and
    below the pages, the selection bar's edge between its buttons) selects
    nothing, even if the mouse wobbles; it only clears the selection there
    was. A drag **begun in blank space** selects nothing until the pointer is
    on a word, and then runs from that word to the last word the pointer was
    on. Between the two it takes the text in the order the PDF wrote it, as
    any drag does. On most pages that is the text the pointer passed over, but
    not where the PDF wrote the page out of order, and the usual case is a
    running header or footer: a drag begun beyond one crosses it first and
    starts there. A drag up from under a footer that the PDF wrote before the
    body takes the body above the pointer, even a short one across the gap
    between two pages at a small zoom; a drag down from above a header that
    the PDF wrote after the body takes the body below the pointer, to the
    page's end. One let go of on such a footer, header or caption takes the
    body in between, and on a two-column page a drag that reaches both
    columns takes the rest of the one and the top of the other. To take lines
    under a header or above a footer, begin the drag on the first word. A drag
    that never reaches a word selects nothing. A drag begun on a word,
    Shift+click and double and triple clicks work as before, and a drag from a
    word that leaves the page, or runs onto the selection bar, can still run
    on past it.
  - The toolbar, rails, side panel, menus and notices are never part of a
    selection; boxes to type in, a comment's text and the Table of
    Authorities can still be selected and copied. So **Ctrl+A** takes the
    pages' text alone: it is tinted and gets the selection bar like any
    selection on a page, and the bar can sit over the toolbar's Download and
    Save as buttons until you click a page or press Escape.
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
