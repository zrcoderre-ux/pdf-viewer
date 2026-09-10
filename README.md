# Legal Citation Linker — Chrome Extension

A Chrome extension version of `pdf_linker.py`. Open any PDF in Chrome and the
extension renders it with PDF.js, runs the same citation detection algorithm
your Python script uses, and overlays clickable links on every detected
citation. The PDF itself is **not modified** — overlays disappear when the
tab closes.

## Viewer Features

In addition to citation linking, the viewer supports:

- **Text selection and copy** — click and drag to select text, then Ctrl+C
  (Cmd+C on macOS) to copy. Selection geometry now correctly aligns with the
  rendered glyphs at every zoom level.
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
- **Persistent highlighting** — select any text and release the mouse to
  apply a yellow highlight. Right-click a highlight to remove it. Highlights
  persist across zoom changes; for editable documents they can be saved into
  the file and stay removable after reopening (see below), otherwise they vanish
  when the tab closes.
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
- **OCR** scanned PDFs on demand with the toolbar **⛶ OCR** button — text
  becomes selectable and citations get linked. Enable "Automatically OCR
  scanned documents" in Options to run it without the button.
- **Rotate pages** — the **⟳ Rotate pages** tool (or the **R** key) turns a
  sideways scan or an upside-down page the right way up, on any document. The
  rotation is on screen straight away; writing it into the file is a separate
  click, and is offered for web PDFs too (as a copy). See below.
The tools live in an Adobe-Acrobat-style **tools rail** down the left margin:
annotation tools (Highlight, Box select, Text area, OCR) and **Rotate pages**
are always there, and
for editable documents an **Edit** section adds every document operation
(Combine, Add images, Organize pages, Split, Bates, Header/Footer, Watermark).
Click **TOOLS** at the top of the rail to collapse it to an icon-only strip.
Editable documents also show **💾 Save** in the top toolbar. The **☀ / 🌙**
button toggles between dark (default) and light themes; the choice is remembered.

- **Edit &amp; save — local documents only.** For a PDF you've already
  downloaded — opened from disk (`file://` in the extension) or via the app —
  the toolbar replaces **Download** with **💾 Save** (writes your highlights into
  the PDF) and adds **⧉ Combine** (merges other PDFs onto the end, then saves).
  Highlights are saved as real **PDF highlight annotations** (the same kind Adobe
  uses), not baked-in drawings, so they stay editable: reopen the file and they
  come back as removable highlights (right-click to delete, then Save again), and
  Adobe/Preview can delete them too. In the app, Save writes back to the same
  file in place using its file handle; otherwise it goes through the browser's
  save dialog. Both are powered by the bundled `pdf-lib` writer. Web PDFs you're
  only viewing stay read-only — edit access is granted only to documents you've
  already downloaded.
- **Organize pages — local documents only.** The **▦ Pages** button turns the
  page panel into an editor: drag thumbnails to reorder, rotate or delete
  individual pages, or check pages and **Extract** them to a new PDF. **Apply &
  Save** rewrites the document (your highlights ride along with their pages).
- **Bates numbering — local documents only.** The **▤ Bates** button stamps a
  sequential number on every page — set a prefix, starting number, digit count,
  and corner. Placement is exact on standard pages and rotation-aware.
- **Header / footer — local documents only.** The **🔖 Header/Footer** button
  adds text to any of six slots (header/footer × left/center/right); use `{n}`
  for the page number and `{N}` for the total (e.g. `Page {n} of {N}`).
- **Watermark — local documents only.** The **🌊 Watermark** button stamps
  translucent text (e.g. `CONFIDENTIAL`) diagonally across every page, with
  adjustable size, opacity, and color.
- **Split — local documents only.** The **✂ Split** button breaks the document
  into several PDFs — every N pages, one page per file, or custom ranges like
  `1-3, 4-8, 9-`. Parts save into a folder you pick (or as downloads), and each
  part keeps the highlights on its pages.
- **Add images as pages — local documents only.** The **🖼 Images** button adds
  image files (JPG/PNG, plus WebP/GIF/BMP via automatic conversion) as new pages
  at the end, each sized to fit US Letter. Reorder them afterward with **▦
  Pages**.
- **Fill forms — local documents only.** When a PDF has fillable AcroForm
  fields, **📝 Fill form** appears in the tools rail's Edit section and lays editable controls
  over the fields (text, checkbox, radio, dropdown). Fill them in, then **Save
  filled** (fields stay editable) or **Save &amp; flatten** (entries baked in
  permanently, fields removed).
- **Zoom in / out** with the toolbar buttons.
- **Download** the original PDF with a smart filename (see below).
- **Open original** in Chrome's built-in PDF viewer (skips the linker).

## Shift + Space = middle click

Chrome opens a link in an unfocused background tab when you click it with the
scroll wheel. **Shift + Space** does the same thing from the keyboard:

- **Rest the mouse on a link** and press Shift + Space — it opens behind the
  page you're reading, right after the current tab (and in the same tab group,
  if there is one). Focus never leaves what you were doing.
- **Select text first** and Shift + Space opens *every* link the selection
  covers, in reading order — sweep a paragraph of citations and pull all of
  them at once, into a **tab group** of their own named `Links` rather than
  strung along the tab strip. A selection is one act, so all of them means all
  of them: the ceiling is 120, high enough to be a guard against a runaway
  selection rather than a budget. A brief note says how many opened.
- If the mouse is resting on a link *outside* the selection, that link wins —
  the pointer is what a middle click would have acted on.

It works on **every website** and in the PDF viewer, on the page's own
hyperlinks and on the citation underlines this extension adds — both alike. A
citation that wraps across two lines is two underline strips but still one tab,
and a selection that runs past the bottom of the screen still opens the links
scrolled out of view, not just the ones you can see.

When no link is involved — nothing under the pointer, nothing linked in the
selection — Shift + Space scrolls up a screen exactly as it always has. In a
text box it still types a space; a chat composer keeps the keyboard focus
almost all the time, so there the shortcut answers to the mouse pointer alone
and a selection behind the box is ignored. Turn the shortcut off entirely in
Options → "Shift + Space opens links".

## Auto-scroll while reading

Ported from the reading auto-scroll in the Inbox Cleaner PWA and rebuilt for a
desktop viewer. Turn it on with the **↓ Auto-scroll** toolbar button or the **A**
key and the page creeps upward continuously, so reading a long PDF costs no
scrolling at all.

Speed is set as a **reading pace in words per minute**, not pixels per second,
and the viewer converts it per page: it already extracts each page's text for
citation linking, so it knows how many words a page holds and how tall that page
renders. A dense block-quote page therefore creeps, a caption page or a scanned
exhibit divider slides past quickly, and both are on screen for about as long as
reading them takes. Change the zoom and the pace re-derives itself, because
density is measured per rendered pixel.

It stays out of the way:

- **Scroll whenever you like.** Wheel, trackpad, scrollbar, arrows, PageDown —
  auto-scroll yields instantly and picks back up about a second after you stop,
  from wherever you left the page.
- **It holds still while you're working.** It won't resume while you have text
  selected, or while a dialog, the highlight menu, or one of the mode bars
  (Text area, Fill form, Organize) is open.
- Motion is snapped to the display's pixel grid rather than floated with a
  transform, so page canvases are never resampled and PDF text stays crisp —
  half-pixel steps on a HiDPI screen.

| Key | |
|-----|---|
| **A** | Auto-scroll on / off |
| **Space** | Pause / resume (only while auto-scroll is on — otherwise it's the browser's page-down) |
| **[** / **]** | Slower / faster, in 25-wpm steps |
| **Esc** | Turn auto-scroll off |

The floating bar at the bottom has the same controls, and fades back to a
whisper while the mouse is still so it doesn't sit on top of what you're
reading. Speed and the on/off state are remembered, so a reading session doesn't
need re-arming for every file.

## Rotating pages

Scans arrive sideways, exhibits are landscape, and one page in a filing is
upside down. The **⟳ Rotate pages** tool in the tools rail turns them, on any
document — a web PDF you're only reading included, because turning a page to
read it shouldn't require downloading it first.

Rotation is a view state until you say otherwise. **↺** and **↻** turn the
pages in the scope you pick — **This page**, **All pages**, or **Odd** / **Even
pages**, which is what a duplex scanner's alternating sideways pages need — and
the bar keeps a running summary of which pages are turned. **Reset** puts
everything back.

**Save rotation** writes the angles into the PDF, the same way Organize pages
does. For a document you've downloaded that saves in place (highlights ride
along); for a web PDF it hands you a rotated copy. The toolbar's **💾 Save**
does the same thing for editable documents — a rotation you're looking at is
part of what gets saved.

| Key | |
|-----|---|
| **R** | Turn clockwise |
| **Shift + R** | Turn counter-clockwise |

The keys follow the bar's scope box, so "All pages" plus **R** straightens a
whole sideways scan in one press. Everything the viewer knows about the page
turns with it: citation links stay on their citations (the underline moves to
whichever edge is under the text now), highlights keep their place and save
into the file in the right position, and an OCR'd scan re-places its
recognized text without re-recognizing it. Line-number detection and the
selectable-text area go on reading the page in its own upright frame, so a
pleading keeps its `p. 4:12-18` references whichever way you're viewing it.

While **Organize pages** is open it owns the page angles — its thumbnails have
their own rotate buttons — and opening it carries over any rotation you had
pending.

## Citation links on claude.ai

The same citation engine also runs on **claude.ai**. When Claude mentions a
case, statute, or California rule of court in a response, the extension overlays
a clickable underline that opens it in your selected provider (Westlaw or
Lexis+) — handy when you're using Claude to find authority and want to pull the
source.

It's **non-destructive**: claude.ai is a React app, so the extension never
edits Claude's DOM. It overlays a clickable link over each citation in a
separate layer and repositions it as the page scrolls or new text streams in.
Each link covers the whole citation (an easy click target) but is transparent
except for a colored bottom border, so it reads as an underline; the color
reflects the active provider (blue = Westlaw, red = Lexis+). It honors the same
provider toggle and `citation_repo.json` as the PDF viewer. Citations inside
hidden or collapsed regions (e.g. a "thinking" panel) are skipped, and links
for text scrolled out of a clipped container are suppressed, so they never land
over unrelated chat text.

**The page is read as one document.** Short-form references point backward —
`Aguilar, supra`, an italicized `Market Lofts` — and the full citation they
resolve against is usually in an earlier paragraph, so detection runs over the
whole page at once rather than paragraph by paragraph. Paragraphs are separated
by a hard break in that text, and a match that runs from one block into the next
is discarded, because no reader sees one citation there.

**What the page has shown you stays.** A chat page is not a document: it mounts
and unmounts its own messages as you scroll, so a Table of Authorities rebuilt
from the live DOM would drop cases as you scrolled past them — the panel
emptying itself behind you. The extension keeps a per-URL memory instead
(`viewer/citation-memory.js`), and two things follow. The Table of Authorities
is cumulative: an authority stays listed for as long as you stay on that
conversation, whether or not the message it came from is still in the page. And
a case cited in a message that has since been unmounted is still available for
an italicized short name further down to resolve against. In-text underlines
are still painted only over text that is actually on the page. The memory is
scoped to one URL — a query string or `#fragment` is the same conversation —
and is cleared when the app navigates to another one, since a different
conversation has different authorities. Switching providers re-derives the
remembered links rather than dropping them.

**A refresh is not a new conversation.** The memory is written to
`chrome.storage.local` under that conversation's own key — a beat after the last
citation is found, and again as the page unloads — and read back on the way in,
so reloading restores the table rather than emptying it, and an italicized short
name still reaches a case the page read before the refresh. What is stored stays
bounded: the 40 most recently read conversations, and nothing untouched for a
fortnight.

**Carry-forward inheritance:** a bare `§ N` / `section N` reference (no code
name of its own) inherits the most recently *named* code before it in reading
order — named in a citation or simply in prose, so "Chapter 12 of Title 10 of
Part 2 of the Code of Civil Procedure … a manufacturer election under section
871.29" links that section to the Code of Civil Procedure even though the code
was never cited with a section of its own. So after "Civil Code § 1671(b)", a
later "§ 1671" links to Civil Code;
if "CCP § 664.6" is then named, a following "§ 664.6" links to the Code of Civil
Procedure. A bare section that appears before any code is named is left unlinked.
(The single-named-code case is just the special case where everything follows
one code.) A bare hyphenated section (`§ 3-310`) needs no code context — the
hyphen identifies it as the model UCC — while a `§§ 1542-1543` range is left for
carry-forward as a span of state-code sections.

**Where it runs.** `claude.ai` is built in. On the Options page, **Link
citations on all websites** turns the same overlay on for the rest of the web,
and an **exceptions** list below it names the sites to leave alone. Westlaw,
WestlawNext, Lexis and LexisNexis are pre-listed there: they link their own
citations, so ours would sit on top and take the click. An exception covers
`http` and `https` both, applies whether or not the all-sites box is checked,
and overrides `claude.ai` too. With the box unchecked, a separate list names
the individual sites to link on (`chatgpt.com`, `*.courtlistener.com`, …).
Adding an exception takes its links down immediately; every other change
applies on the next page load.

A line covers less than it looks like it does in two ways, and both are easy to
write by accident: **a path narrows it to that path**
(`civil.lacourt.org/ecourt/ecms` leaves every other page of the site linked —
name the site alone to cover the site), and **naming a scheme narrows it to
that scheme**. Neither is visible in the box, so the Options page writes out
what every line reaches, under the box, as it is typed:

```
*://civil.lacourt.org/*                   —  civil.lacourt.org, every page, http and https
https://civil.lacourt.org/ecourt/ecms*    —  civil.lacourt.org, only pages under /ecourt/ecms, https only
*://*.westlaw.com/*                       —  westlaw.com and its subdomains, every page, http and https
```


An exception also reaches the PDF viewer, through the URL the PDF was served
from: a document downloaded from an excepted site opens with no citation links
and no Table of Authorities, and the toolbar says so where the citation count
would be. Taking the exception off (or adding one) applies to the open document
right away. A document opened from disk came from no website, so no exception
covers it.

In addition to the in-text underlines, a **Table of Authorities** panel appears
in the right margin whenever at least one citation is found. It is a list of
those links and nothing else, so it never appears where they don't — on an
excepted site, or on a PDF one served. It lists each
unique authority once, grouped into Cases / Statutes / Regulations /
Administrative Guidance / Rules, as a regular blue
hyperlink on the citation text itself (opening Westlaw or Lexis+). The panel can
be minimized to just its header bar and maximized again, **moved** by dragging
its header, and **resized** by dragging the grip in its bottom-left corner; the
minimized state, position, and custom dimensions are remembered.

**Open all cases.** A button in the panel's header — `Open 12 cases`, so the
count is known before the click — opens every case in the table, each in its
own background tab, the way Shift+Space opens a selection's links. Only the
cases: a statute, rule, regulation or jury instruction is read in place, and
ten code sections in ten tabs is not what the reader came for. The tabs open
behind the page, so the button reports what happened (`Opened 12`) rather than
leaving the click unanswered, and a hosted page whose pop-ups are blocked says
that instead. The worker's twenty-tab cap is for a gesture that named no
count — one link under the pointer; this button carries its count in its own
label, as a selection carries its own extent, so what it asks for is what the
reader asked for, and only a far higher ceiling (120) stands behind it. The tabs arrive as one **tab group**
named `Cases` — a set asked for as a set should not land as three dozen loose
tabs — rather than joining whatever group the page they were asked from sits
in. A browser that won't group them has still opened every one. The same report, with the URLs and the reason any
tab was refused, is logged to the console of the page the panel is on, since
the button's own copy is gone in a few seconds. The button is hidden when the
table holds no cases.

A remembered position is measured against the window it was set in, so it is
re-clamped to the current window every time the panel is shown and whenever the
window resizes. Without that, a panel parked on a wide monitor lands entirely
off screen the next time the same profile opens a PDF in a narrower window —
still enabled, still counting authorities, just nowhere the user can see it,
which looks exactly like the Table of Authorities having switched itself off.
Only the applied position is clamped, never the saved one, so widening the
window again puts the panel back where you left it.

## Smart PDF Naming

The extension supports two filename-source modes, set on the Options page
(right-click extension icon → Options → "Default filename source"):

- **Source filename (default).** Uses the original filename as the
  server / URL / Content-Disposition supplies it. No transformation — unless
  you enable "Apply the same naming rules to the source filename" in Options,
  which runs the source name through the same abbreviation / title-case rules
  as footer mode (off by default).
- **Derive from document footer.** Reads the document title printed at
  the bottom of court filings and applies legal-document naming rules.

### Footer-mode naming rules

When footer mode is active, the title is parsed through an ordered set of
rules. The output is the bare canonical document type, with a
disambiguating qualifier added only when another open PDF would collide:

- Documents collapse to their canonical types: `Motion`, `Demurrer`,
  `Opposition`, `Reply`, `Complaint`, `Notice of Motion`, `Petition`,
  `FAC` / `SAC` / `TAC`.
- Declarations preserve the last name and what they support:
  `Smith Decl. ISO Mot.`, `Bennett Decl. ISO Opp.`,
  `Connors Decl.` for bare declarations. Generational suffixes and
  credentials are skipped when picking the surname (`Gregory Wayne Walton II`
  → `Walton Decl.`, not `Ii Decl.`).
- OCR-garbage or template-placeholder footers (random symbols, run-together
  scan text, blank-form codes, `PLEADING TITLE`) are rejected so the clean
  source filename is used instead of nonsense.
- Hyphenated last names are kept whole (`Garcia-Lopez Decl. ISO Opp.`).
- Party identifiers (`Plaintiff's`, `Defendant Pacific Insurance's`,
  `Creditco's`) are stripped from the leading edge of the title.
- The `Notice of Motion and Motion to X` prefix is stripped to `Motion`
  (target captured as `Mot. to X`). A bare `Notice of Motion for X` is
  preserved as its own type (procedural notice).
- Case-number tails (`Case No. 30STCV12345`) and damages-blob descriptive
  tails (`for compensatory, punitive, ... damages`) are stripped.
- A declaration listed after a semicolon is treated as a *supporting*
  document and ignored, so a multi-document filing is named from its primary
  document (`Opposition ...; Declaration of Smith` → `Opposition`). A
  standalone declaration (no preceding semicolon) still names as a declaration.
- A trailing isolated `V` left over from a `v.` case caption is removed
  (`Amended Complaint V` → `Amended Complaint`); a `V` that's part of a word is
  kept.

### Cross-tab disambiguation

When two open viewer tabs would show the same canonical name, the
disambiguator adds the smallest available qualifier:

- Two demurrers → `Demurrer to SAC` and `Demurrer to FAC`
- Two complaints → `Complaint` and `Hopkins Complaint` (using the
  case-caption plaintiff)
- Two motions → `Mot. to Strike` and `Mot. to Compel Arbitration`
- Two oppositions → `Opposition to Demurrer` and `Opposition to Mot.`
- Two replies → `Reply to Opp. to Mot.` and `Reply to Opp. to Demurrer`

A single open viewer always shows the bare canonical name; the qualifier
appears live as soon as another tab opens with a colliding type, and
disappears again when that tab closes.

Source mode is recommended as the default because most court-filing PDFs
already arrive with sensible names, and the footer extraction is only as
good as the footer text PDF.js can recover. Switch to footer mode when
working with a corpus where the source names are unhelpful (eCMS UUID
filenames, scanned-document IDs, etc.).

### Documents opened from disk keep their name

A PDF opened from disk — `file://` in the extension, or opened in the app from
the file handler, the Open button, or drag-and-drop — is left alone. It shows
the filename it already has, exactly: no footer title, no naming rules applied
to the filename (even with "apply naming rules to source names" on), no
part/volume suffix, and no cross-tab disambiguation. Renaming is for PDFs you
read *before* downloading them, where the viewer picks the name it will be
saved under; once the file is on disk, its name is yours.

The toolbar dropdown still overrides this for one document: picking source or
footer naming there is a deliberate ask, and the rules apply again.

## Faithful port of pdf_linker.py

The detection logic is a line-by-line port of `pdf_linker.py`. Output has
been verified citation-for-citation against the Python on the sample
memorandum (10/10 match, identical keys). The port includes:

- The full reporter list — all CA reporters, federal reporters, and 13
  out-of-state regional reporters (P., A., N.E., N.W., S.E., S.W., So., N.Y.,
  spaced and compact forms).
- The walk-back-from-`v.` algorithm for accurate party-name boundaries —
  honors sentence punctuation, paragraph breaks, name-connector words
  (`of`, `the`, `and`, `&`, `de`, `la`, `du`, `von`, `van`), and corporate
  suffixes (`Co.`, `Inc.`, `Corp.`, `Ltd.`, `Ass'n.`).
- All 29 California codes (long forms, CSM short forms, and bare uppercase
  abbreviations such as `CCP § 664.6`, `PEN § 187`, `BPC § 17200`), section
  number shapes including `437c` and `1714.45(b)(1)`.
- Model **Uniform Commercial Code** cites (`U.C.C. § 3-310`, `Uniform
  Commercial Code § 2-207`) — distinguished from California's Commercial Code
  by the hyphenated section number, and resolved to the model UCC on each
  provider (`U.C.C. § 3-310` on Lexis+, `Unif.Commercial Code § 3-310` on
  Westlaw).
- **Federal regulations**: the C.F.R. by title (`29 C.F.R. § 2560.503-1`,
  `45 CFR 164.512(a)`, and part cites like `40 C.F.R. pt. 60`), plus named
  series where the agency stands in for the title — `Treas. Reg. § 1.125` is
  searched as `26 C.F.R. § 1.125`. A **proposed** regulation is the exception:
  `Prop. Treas. Reg. § 1.125-1` is searched as written, because a proposed
  regulation has not been adopted into the C.F.R. and the converted cite would
  point at a section that does not exist. Temporary regulations are in the
  C.F.R. and convert normally.
- **Federal codes**: the U.S. Code (`42 U.S.C. § 1983`, bare `42 USC 1983`,
  annotated `5 U.S.C.A. § 552`, appendix `9 U.S.C. App. § 1`), and named codes
  and acts — `Internal Revenue Code section 9801(f)` / `I.R.C. § 61` / `IRC
  § 501(c)(3)`, `Bankruptcy Code § 362(a)`, `ERISA § 502(a)`, `FLSA`, `NLRA`,
  the `Securities Exchange Act of 1934`.

  Named codes split on whether the act was codified section-for-section. The
  Internal Revenue Code and the Bankruptcy Code were, so `I.R.C. § 9801` is
  searched as `26 U.S.C. § 9801` — a citation both providers resolve directly.
  ERISA and the rest were not (`ERISA § 701` is `29 U.S.C. § 1181`, a
  section-by-section lookup table rather than a formula), so those keep the
  act's own numbering and are found by popular name. Either way the citation is
  listed in the Table of Authorities in the form the document used.

  Federal section numbers carry dots and hyphens *inside* one number —
  `2560.503-1`, `2000e-2`, `1.125-4T` — so they are matched with a wider
  pattern than the California codes. A hyphen between two plain integers stays
  a range: `29 U.S.C. §§ 1181-1185` links section 1181 rather than inventing a
  section "1181-1185".
- **IRS revenue rulings**: `Rev. Rul. 2013-17` and `Revenue Ruling 2013-17`,
  with or without the bulletin the ruling was published in — Bluebook T1.2
  cites to the Cumulative Bulletin or its advance sheet the Internal Revenue
  Bulletin, and `Rev. Rul. 83-137, 1983-2 C.B. 41` is underlined whole rather
  than stopping after the number. Both number eras are read: the two-digit
  year used before 2000 (`Rev. Rul. 99-7`) and the four-digit one after it.
  Whatever dash a PDF renders — hyphen, en dash, em dash — normalizes to one
  authority, so `Rev. Rul. 96–55` and `Rev. Rul. 96-55` are not listed twice.
  A ruling has no section number, so nothing carries over to a later bare
  reference the way a statute's section does.
- Non-`v.` case names (separate pattern, no `v.` anchor): `In re`,
  `Estate of`, `Guardianship of`, `Conservatorship of`, `Adoption of`,
  `Marriage of` — e.g. `Conservatorship of Whitley (2010) 50 Cal.4th 1206`.
  Prefixes nest (`In re Marriage of Bonds`), and the short name used for
  supra resolution is the subject that follows them (`Bonds`, `Whitley`).
- `Cal. Rules of Court` / `California Rules of Court`, `rule` or `rules`,
  with nested subsections.
- **Bare rules.** A rule cited with no rule set named — `rule 3.1350(f)`,
  `Rule 8.204` — is read as a California rule of court, which is what an
  unqualified rule number means in a California brief. Every rule of court
  carries a dot in its number, so the undotted forms that would otherwise be
  swept in (`rule 12(b)(6)`, `rule 5 of the bylaws`) are left alone, as is a
  rule whose neighboring words name somebody else's rules (`Federal Rules of
  Civil Procedure, rule 26.1`, `local rule 3.57`). A rule set the text names
  outright still wins: `Cal. Rules of Prof. Conduct, rule 1.9` links to the
  professional conduct rule.
- **Rule-set carry-over.** A page that ties a rule number to a rule set hands
  that set to the page's bare references to the same number, so `Rules of
  Professional Conduct, rule 1.9 ... rule 1.9(a)` is one rule cited twice.
  This reads in both directions within the page — unlike the statute
  carry-over, which runs forward only, because an unplaced bare rule is not
  left unlinked but read as a rule of court, so declining to look backwards
  would make a worse guess rather than withhold one. A page that gives one
  number two different sets leaves its bare references unlinked rather than
  choosing. A page that names the professional conduct rules and never names
  the rules of court also reads its *other* bare rules as conduct rules — the
  weaker inference, so it runs forward only from the first conduct cite, and a
  number the document ties to the rules of court anywhere keeps that set (a
  disqualification motion still notices its own hearing under rule 3.1300).
- Both **CSM** and **Bluebook** case forms — chosen by whichever tail
  pattern matches first within 200 chars after the `v.` anchor.
- **Case citations with no year.** `Doe v. City of Los Angeles, 42 Cal.4th
  531, 550` — the form a table of authorities uses, and the one a brief falls
  into when the year is left out. Every other tail is anchored by a year
  parenthetical, so without one the whole table went unlinked. The year is
  what usually proves a reporter cite is a citation, so this form is a
  fallback, read only where no year-bearing tail matched, and the proof falls
  to two other things: the reporter has to be one in the table (`42 Cal.4th
  531` is a citation, `5 March 2020` is not), and every word of the
  defendant's name has to read as part of a name — otherwise a sentence that
  runs into a reporter cite (`Doe v. Roe held, at 42 Cal.4th 531`) would pass
  as one. `supra` fails that test, which leaves short-form references to the
  pass that owns them.

  Where the same case is also cited in full somewhere in the document, the
  yearless reading takes the full citation's key — the reporter cite says they
  are the same case — so the Table of Authorities carries one entry, not two,
  and both links go to the same place. Where it isn't, the citation stands on
  its own and its search URL is built from the reporter cite alone.
- Pin-cite ranges including em-dash forms (`, 110-12`, `, 110–12`).
- Document-wide supra resolution using **first-seen** short name (matches
  `setdefault` semantics).
- **Short-form `X v. Y` references.** A case cited in full anywhere in the
  document is linked again wherever the document names both its parties, even
  with no reporter cite alongside — the form a table of authorities uses, and
  the form a brief falls into on second reference. Either party may be given
  short: `Four Star Electric` for `Four Star Electric, Inc.`, `Ford` for `Ford
  Motor Co.`, `Christensen, Miller` for the rest of the firm. The match is by
  whole words, so `Smith` never answers for `Smithson`.

  A party name is not only capitalized words. It carries the ampersand of a
  firm (`Careau & Co.`, `F & H Construction`, `Philipson & Simon`), the comma
  before a corporate designator (`PCO, Inc.`), and the lowercase connectors a
  caption keeps (`Committee on Children's Television`, `Regents of Univ. of
  California`) — each of which used to end the name early and cost the link.
  A connector the sentence supplied rather than the name (`Chillon v. Ford and
  the trial court agreed`) is left out of the link, and a word the sentence
  put in front of the name — a heading on the line above, most often `Cases`
  above the first entry of a table — is dropped rather than taken as part of
  the plaintiff. That last one was worth a whole entry: a name read one word
  too wide doesn't just come out wrong, it takes the citation inside it down
  with it.
- **Italicized short names.** Case names are italicized and nearly nothing
  else in a brief or an opinion is, so once a case has been cited in full, a
  later italic fragment of its name — `Market Lofts`, `Aguilar`, `In re
  Marriage of Davis` — gets the same link the full citation got. The fragment
  may be the plaintiff's first word, any leading run of the plaintiff's name,
  the whole case name, the short name a court announced in a parenthetical
  (`... 222 Cal.App.4th 924 (Market Lofts)`), or the defendant where the
  plaintiff is an institution the short form is never built from (`People v.
  Smith` is `Smith`). Signals and pin cites caught inside the same italic run
  (`see Aguilar`, `Market Lofts, supra`) are stepped over, and the longest
  fragment that names a case wins, so the reader's whole phrase is underlined
  rather than its first word.

  The safety rule is the reader's own: a fragment links only when exactly one
  case cited **earlier** in the document answers to it. Where two do — `Smith`
  after both `Smith v. Jones` and `People v. Smith` — the bare word stays
  unlinked, though a longer fragment naming one of them still links.

  Posture comes from the PDF's own fonts in the viewer (`italic` on the font
  PDF.js resolved, or an italic face name like `TimesNewRomanPS-ItalicMT`) and
  from computed `font-style` in the web content script. Text with no font
  information behind it — plain strings, OCR'd scans — simply skips the pass.

  A caller that no longer holds the text the full cite appeared in can pass the
  cases it remembers as `findAllCitations(text, { priorCases })`. They join the
  registry as though cited before the first character, so an italicized short
  name still links after a chat app has unmounted the message carrying its full
  citation; they never become citations of their own, and the ambiguity rule
  holds across them.
- Span deduplication so overlapping detections don't double-link.

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

## Text reader for PDF-Linker's exports

PDF-Linker scrubs a case's filings into `Text Files/*.txt` and writes
`pseudonym_key.xlsx`, the real↔fake map. The **text reader**
(`viewer/text-reader.html`) reads those exports the way this viewer reads a
PDF — and puts the real names back **on screen only**. Open it from the
toolbar popup (**📝 Open text reader**), or open a `.txt` in the installed
app, which routes it to the reader tab.

- **Pages, in your font.** Each `====== Page N ======` block is laid out as a
  sheet, with the printed page number and any REVIEW clause on its label. A
  page numbered down its margin — pleading paper — is laid out as one: the
  numbers stand in a **ruled margin** of their own, a vertical rule and a gap
  between them and the body, and each numbered line hangs under its number
  so a wrapped continuation never crosses the rule. Pick the font (Georgia,
  Times, Charter, Palatino, system sans, Arial, Verdana, Courier, Consolas, or
  any installed family by name), size, leading and page width. Those are
  **remembered as the defaults**: the font and leading chosen once are what
  every text file opens in from then on — set them in the reader's toolbar or
  under Options → "Text reader — default font and leading", and every open
  reader tab follows at once. Display only: the text file itself is never
  changed. Light and dark chrome follow the viewer's own theme toggle.
- **Line lock.** Pleading paper is read by its line numbers, and a numbered
  line that wraps puts its tail on a screen line with no number — one line
  off from the PDF. **Line lock** (toolbar, remembered) holds every numbered
  line to one screen line by making the page **as wide as its longest line
  needs** at the size you chose — past the window's edge if it must, with a
  horizontal scroll bar under it, the way a zoomed PDF behaves. Zoom in as
  far as you like: the font is never touched, so the size is yours to
  calibrate the page by, and the numbers are never touched either — the
  gutter shows the file's own and nothing moves between them. Display only:
  the width you set comes back when the lock is off. Side by side the PDF's
  own grid holds every line to one screen line already, whatever the lock
  says.
- **Citations linked.** The same detector the PDF viewer runs underlines every
  case, statute, rule, regulation and CACI instruction and links it to Lexis+
  or Westlaw (the provider setting is shared), with the **§ Authorities**
  panel listing them once. A cite that wraps onto a numbered line is read
  across the gutter number, as `pdf_linker.py` reads it.
- **A name wrapped across lines is one name.** A pseudonym or a real value
  whose halves sit on two numbered lines — the line break, the next line's
  gutter number and any blank line between — is matched as one: the reader
  shows the real name half on each line (the tooltip names the whole), a
  wrapped real is one leak, and a save writes the fake line by line with
  the numbers untouched. A real name that should stay — a cited decision
  bearing a party's surname — is **kept** from the orange mark itself:
  right-click it (or select it and take **Keep…**), and *keep in this case*
  or *never fake it* leaves it as it stands, on save and on PDF-Linker's
  next run, the same keep a wrongly faked pseudonym takes.
- **Real names from the key.** **Open case folder** picks the matter's folder
  and takes only `pseudonym_key.xlsx` and the exports out of it (a `*.txt.LEAK`
  quarantined by PDF-Linker's leak gate is listed too, marked, and opened
  first — it is the one to read). The reader **remembers every case folder it
  is shown**, so a document opened on its own afterwards — from the file
  picker, a drop, or the installed app's file handler — is matched to the
  folder it sits in (its own folder, or the one above `Text Files`) and that
  folder's key is attached automatically; where the browser wants the folder
  re-authorised first, a bar offers it in one click, and a file from a folder
  the reader has never seen gets an offer to open it once. Every fake is shown as its real value in
  the case the fake was written in, **lightly highlighted**, and hovering
  shows the pseudonym underneath. The highlight's **colour and intensity**
  are yours to set (the swatch and slider beside "Mark pseudonyms", or under
  Options), and are remembered like the font; **Mark pseudonyms** turns the
  highlight and the hover off; **Show fakes** shows the document as it is on
  disk. The key
  is read the way `DeAnonymize.bas` and the Claude extension read it: columns
  by header name, operator keeps skipped, alt spellings forward-only, an
  ambiguous fake retired, the pinned tab out of the reversal. The last few
  keys are remembered, so a lone `.txt` can be read under a key already
  loaded. A real name from the key standing **unfaked** in an export is
  counted in the status bar and underlined — that is a leak the run missed.
- **The LEAKS worksheet, row by row, in the text.** PDF-Linker's leak triage
  is `LEAKS.xlsx` in the case folder: one row per flagged value with a
  **Fix?** cell to answer, and Apply Leak Fixes reads the cells back. The
  reader attaches the folder's worksheet when the folder is opened (or
  **⚠ Leaks** loads one; a dropped `LEAKS.xlsx` attaches too) and works it
  **one row at a time**: the current row stands in a bar above the text —
  value, type, file and page:line, both Context quotes with the value
  bolded, the Notes — and the text **opens the row's own document and
  scrolls to its page and line**, the value marked wherever it stands (the
  occurrence the bar went to strongest). The page stays editable underneath,
  and side by side the PDF follows as it always does. **yes / no / never /
  phrase** are buttons; anything else the cell takes — the replacement,
  `~CORRECT SPELLING`, `*CORRECT TEXT` (`**` in every folder), a `[part to
  keep]` — is typed and applied with Enter; **Alt+Y**, **Alt+N**, **Alt+↑/↓**
  work from the page. A decision moves you to the next undecided row; the
  **Leaks** tab lists every row with its state and jumps to any of them. A
  `no` or `never` on a value the key binds is mirrored as one of the reader's
  keeps, so the orange mark goes and a save of the document leaves the value
  as it stands. Decisions are remembered until **Save LEAKS.xlsx**
  (Ctrl+Shift+S) writes them **into the same workbook in place** — only the
  Fix? cells change; every other part of the file, the Context quotes, the
  column widths and the dropdown come back byte for byte, and the file is
  read back before it is written — after which Apply Leak Fixes (or a
  re-run) applies them to the files. A `yes` here is the worksheet's alone:
  it is never also flagged into `New Real Values.txt`.
- **`Combined Text.txt` brings its PDFs with it.** The combined file PDF-Linker
  writes into the case folder is listed first among the documents, and its
  members — the `# Documents in this file:` list on its first page, in
  order — are each matched to their own PDF: the case folder's through the
  key, or PDFs picked by hand (**⇄ PDF pages… → Pick PDFs…**, or a drop),
  several at once, each matched to its member by name through the key and,
  where no name settles it, by the order the file lists them. The status bar
  says which members still have no PDF.
- **Editable — once you say so — and the file never learns the real names.**
  A document opens **protected**: reading, selecting and flagging can never
  nudge a character into it. **✎ Edit** lifts that for the document in front
  of you, **Ctrl+Z** and **Ctrl+Y** undo and redo through the reader's own
  history (the browser's cannot survive the pseudonym rewrites), and **Save**
  (Ctrl+S) writes the text back to the same file. A
  pseudonym span always writes its **fake**; anything typed as a real name
  and left plain is written as its pseudonym on save. The save refuses
  outright rather than write a real value the key binds. Deleting a marked
  name deletes the fake.
- **The numbers are the paper.** On a numbered page the line numbers are
  fixed and the text moves between them. **Enter** sends the text after the
  caret down into the next numbered slot, and the slot below takes what was
  there, on down until an empty slot absorbs the shift — with no empty slot
  left, the last line's text lands on a new unnumbered line at the foot of
  the page, so nothing is lost. **Backspace** at the start of a line joins it
  to the line above and pulls the run below up a slot; **Delete** at the end
  of a line is the same join from the other side; a paste is typed in line
  by line. So where the export left line 7 empty and the PDF has text on it,
  click line 7 and type: the file gets ` 7  ` and your text, and PDF-Linker's
  next run reads it as line 7. A selection that reaches across a number is
  refused an edit, and the numbers never take a keystroke.
- **The pseudonym at the caret.** Finish typing a real value the key binds
  and a prompt at the caret names its pseudonym — the Claude extension's
  as-you-type correction, for the page. **Space** marks it as an autocorrect
  (the real name stays on screen, the fake goes underneath and into the
  file, and the space lands after it); **→** marks it without the space;
  **Esc** leaves that one plain, and the save still writes its pseudonym. A
  real that opens a longer name in the key ("Helen" beside "Helen Rasho"),
  or a kept one, is never space-marked: the space types on, and the whole
  name is offered the moment it is finished. A name typed and left is
  marked by the reader on its own once the caret has moved off it.
- **Flag what the run missed — and un-flag what it got wrong.** The point of
  reading the real names is to spot the ones that are *not* marked. Select
  such a name and press **🚩 Flag real value** (or Ctrl+Shift+F); the
  **Flagged** panel collects them and **Save list to case folder** writes
  `New Real Values.txt` beside the key, which PDF-Linker reads on its next
  run — and on Apply Leak Fixes — as if each line had been given with
  `--term`. The opposite mistake, a value that should never have been faked
  (a word of a cited decision's name, usually), is **right-clicked**: "Keep in
  this case" is PDF-Linker's `no`, "Never fake it anywhere" its `never`. The
  keep takes effect in the reader **at once** — every occurrence loses its
  highlight and shows a dotted underline, the tooltip says the file still
  carries the fake, and a save neither rewrites the kept value to its fake nor
  refuses over it — and goes into the same file as a `no: VALUE` / `never:
  VALUE` line, which PDF-Linker reads as the worksheet's own decision on the
  run that actually restores the files. The **Flagged** panel lists both
  kinds, each withdrawable.
- **Reading tools from the PDF viewer.** **↓ Auto-scroll** (or **A**) creeps
  the document at a reading pace, **[** and **]** slow and speed it, Space
  pauses; **Shift + Space** opens the citation under the pointer, or every
  citation in the selection, in background tabs, as on a PDF; the theme
  toggle and the Authorities panel are the viewer's own. The Documents /
  Flagged panel collapses on its **»** chevron (or **▤ Panel**), stays closed
  until it has something to show, and remembers your choice.
- **The PDF it came from, beside the text or swapped into it.** PDF-Linker
  leaves the PDF in the case folder under its real name and names the export
  for the same stem scrubbed, so the reader finds the pair by running each
  PDF's name forward through the key (a `Combined Text.txt` is matched member
  by member off its banners); where nothing matches — a lone file, a folder
  with no key — **⇄ PDF pages…** offers **Pick PDF…**, and a dropped `.pdf`
  is taken the same way. The PDF is read only when it is first shown.
  **⇔ Side by side** opens the PDF in a pane beside the text, one PDF page
  per text page, and lays each text page out on **its PDF page's own
  geometry**: the same width and height, label and all, and — where the
  PDF's text layer carries the pleading numbers down its margin — every
  numbered line at its number's own height, the body starting at the PDF's
  text margin, the leading the PDF's pitch, so line 7 stands beside line 7.
  A page with no numbers (an exhibit, a letter, an order) is laid out on
  the PDF's printed **rows** instead: each text line is matched to the row
  carrying its words and takes its top and left, so paragraphs and headings
  sit where the PDF's do. **The size is the zoom, and the PDF's type sets
  the text's.** A page is a page: the type keeps its own spacing at any
  size, the way a PDF does. The reading size is the size of the *body*
  type — the PDF's body drawn at that size fixes the scale, and the sheet,
  the grid, the margins and the PDF page beside it are all drawn at it, so
  the two are one size to the eye at any zoom without a hand adjustment —
  and where the PDF's type varies, each line takes its own row's size: a
  heading larger, a footnote or an exhibit's small print smaller, so a
  page of tight rows fits them. (The leading setting has no say here; the
  PDF's rows are the leading.) Setting the size up **grows both sheets**
  instead of pushing the lines together. A page too wide for its pane runs
  past the edge with a horizontal scroll bar under it, and a line too long
  for the PDF's own column is never wrapped either: the sheets widen by
  what the longest one needs. Each pane scrolls sideways on its own — the
  text sheet is wider and its margins are not the PDF's. **Never on top of
  itself:** where the PDF's own rows sit closer than a line of type is tall
  (a scan's text layer, a signature under its rule) the line is pushed down
  to clear the one above, a line out of register with the PDF and legible
  — reading the text beats lining it up. The two panes scroll together,
  anchored on each page's first printed line. **The PDF's text is
  selectable and copies**, in the pane and on a swapped-in page: drag from
  the margin, from the space before a word, or let go after the period —
  every point snaps to the nearest character on its own row, so the
  clipboard carries the passage under the pointer and never the line
  numbers down the side (they are blanked in the text layer, as the PDF
  viewer blanks them); a double click takes the word, a triple the row.
  Display only — the layout lifts when the pane closes; remembered. With it off, a page whose text is not
  worth reading (an exhibit the OCR mangled) is **swapped**: the **⇄ PDF**
  button on the page's label shows the PDF page in the text's place, the
  rest staying text, and **⇄ PDF pages…** takes a run — `5, 12-18` — of the
  export's own page numbers. The swapped text is hidden, not removed: a
  save still writes it, and ⇄ Text puts it back. Swaps are remembered per
  document by PDF page number. Rendered pages are dropped as they scroll far
  out of view, so a long PDF costs no more than the pages in reach.

The decisions live in `viewer/textdoc.js` (the page model, the DOM-to-disk
walk, the values file), `viewer/pseudo-key.js` (the key, a port of the
Claude extension's `src/pseudo.js`) and `viewer/pdfsync.js` (which PDF an
export came from, page ranges, where "the same place" is in two scroll
boxes), with `viewer/xlsx-read.js` reading the workbook;
`viewer/leaks.js` (the LEAKS worksheet: rows by header, what a Fix? cell
means, where a row points) and `viewer/xlsx-write.js` (the Fix? cells
written back into the same workbook, every other part copied through);
`node test-textdoc.mjs`, `node test-pseudo-key.mjs`, `node test-pdfsync.mjs`,
`node test-xlsx-read.mjs`, `node test-xlsx-write.mjs` and `node test-leaks.mjs`
cover them.

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

## What it does not do

- It does **not** write a `*_linked.pdf` file. (That's the whole point of
  the extension version.) Keep using `pdf_linker.py` if you need a
  permanent linked PDF.
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
viewer/shift-space-open.js           Shift+Space = middle click (viewer + all sites)
viewer/viewer.html                   PDF viewer shell
viewer/text-reader.html / .js / .css Text reader for PDF-Linker's exports (pages, cites, key)
viewer/textdoc.js                    Text reader's document model (pure; test-textdoc.mjs)
viewer/pdfsync.js                    Text reader's PDF pane decisions: matching, ranges, scroll sync (pure; test-pdfsync.mjs)
viewer/pseudo-key.js                 pseudonym_key.xlsx reader + fake↔real swaps (pure; test-pseudo-key.mjs)
viewer/xlsx-read.js                  Minimal .xlsx reader (pure; test-xlsx-read.mjs)
viewer/xlsx-write.js                 Writes cells back into an .xlsx, the rest copied through (pure; test-xlsx-write.mjs)
viewer/leaks.js                      Text reader's LEAKS.xlsx model: rows, Fix? cells, where a row points (pure; test-leaks.mjs)
viewer/web-shim.js                   chrome.* shim for the hosted (PWA) pages
viewer/viewer.css                    Page + textLayer + linkLayer styles
viewer/viewer.js                     PDF.js loader, two-pass renderer
viewer/autoscroll.js                 Auto-scroll engine + control bar
viewer/rotation.js                   Page rotation: angles, bar, geometry
viewer/citation-linker.js            Detection + URL resolution
viewer/footer-naming.js              Footer-derived naming rule engine
viewer/disambiguation.js             Cross-tab collision registry
viewer/reporters.js                  Reporter list (port of REPORTERS_RAW)
viewer/statute-codes.js              Code patterns (port of STATUTE_CODES)
viewer/federal-codes.js              C.F.R. / U.S.C. / named federal codes
viewer/code-tables.js                WL / Lexis search prefix tables
fetch-pdfjs.sh                       One-time PDF.js download
```
