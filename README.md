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
- **Redaction** — mark what has to go (every real value the pseudonym key
  binds, plus anything you drag over), check it while it is still only
  proposed, then save a flattened copy with it blacked out — no text layer, no
  metadata, and never over the original. In the viewer, and in the text reader
  from beside the export the PDF was scrubbed into. See below.
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
hyperlinks and on the citation underlines this extension adds — both alike.
**One tab per destination**, always: a citation that wraps across two lines is
two underline strips but still one tab, a case cited three times in the
selection is one tab, and two links that differ only in the anchor they jump to
(`…/FullText?cite=42+Cal.4th+531#p550` and `#p552`) are one tab — the first
spelling is the one opened, anchor and all. A hash that *routes* (`#/matter/12`)
is the address rather than a place within a page, so those stay separate,
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

## Redaction

A redacted copy of a filing, with the pseudonym key doing the first pass.

Open **▬ Redact** in the tools rail. The key is the baseline: choose the case's
`pseudonym_key.xlsx` in the bar — every key the text reader has been shown is
already offered there — and the viewer sweeps the document for every real value
the key binds and proposes a box over each one, wherever it stands. That is the
same list PDF-Linker scrubs the case's text exports by, applied to the PDF
nobody scrubbed. Anything the key cannot reach you mark by hand: with **Drag
marks text** a drag over the page proposes the words it covers, and with **Drag
marks an area** it proposes the box itself — a signature, a photograph, an
exhibit stamp, a scanned page whose text layer knows nothing.

**Nothing is hidden until you save.** A proposal is a translucent red box with
the words still legible underneath, so you can read what is about to go and
take any box back off with a click. Boxes the key proposed are outlined in
dashes and the ones you drew are solid, so a sweep of the document shows which
are the run's and which are yours. They stay put through zoom and through the
rotate tool, because a box is stored in the page's own coordinates rather than
in screen pixels.

**Save redacted copy** writes a new file, and never the one you have open. The
redaction tool has no in-place path at all — the toolbar's 💾 Save is a
different button, for highlights and rotation.

What it writes is not this document with black rectangles added. A rectangle
drawn over text leaves the text in the file, where anything that can select
text can read it straight back out; that is how redacted filings have been
un-redacted for as long as there have been redacted filings. Instead every page
is rendered to an image with the boxes painted into the pixels, and those
images become a new document that has never held anything else:

- **no text layer** — on any page, not just the marked ones. A copy that kept
  its unmarked pages as they were would be searchable everywhere except over
  the black boxes, which tells a reader where to look and hands them the rest
  of the document besides;
- **no annotations, no form fields, no outlines, no embedded fonts**;
- **no metadata** — no `/Info` dictionary and no XMP packet, so nothing in the
  file carries the author, the software, the times, or the original filename.

The copy is named for the document it came from, run forward through the key
where one is loaded and marked redacted either way:
`Rasho v Quillmark - MTC.pdf` is saved as
`Strangeways v Melbury - MTC (redacted).pdf`. Re-redacting a redacted copy
marks it once, not twice.

Pages render at **200 dpi** by default; 150 makes a smaller file and 300 a
sharper one. Because the result is images, it is larger than the original and
no longer searchable — which is the point.

**Checking the sweep against the export.** The key is run over the PDF's *own*
text, and a PDF's text is not a clean transcript: a name can be broken across
two lines, set with a ligature, spelled differently by the OCR, kerned into one
run with the word beside it — or not be text at all, as in a signature, a
letterhead, or a scanned exhibit. Each of those is a real value the sweep does
not box, and nothing on screen would say so. **A redaction you cannot check is
a redaction you cannot rely on.**

So the export is read as a second opinion. PDF-Linker read the same PDF and
wrote a **pseudonym wherever a real value stood**, so every pseudonym on a text
page is a claim that *this page of the PDF carries this real value* — and it
knows that even where the PDF's text will not give it up. **Check against the
export** compares those claims against the boxes the sweep actually made, and
the sweep says so by itself: its message ends with how many more the export
places than it could find, and the button turns orange with the count.

It does not guess *where*. The export says the value is on the page, not where
on the paper, so nothing is proposed. Instead it **walks you to each unmatched
claim in the text** — the occurrence underlined in the reader, the PDF pane
carried alongside to the same page — so you can look at the PDF and see what
was missed. Mark it with an area drag and the walk takes it as answered and
moves on; **Accounted for** does the same for a claim that turns out not to be
on the page at all.

**Anything that covers the words counts, whoever drew it.** A box the key
proposed, a drag over the words, and an **area** drawn over them all answer the
same claim — an area box carries what it covers, so blacking out a name in area
mode is credited exactly as a swept box is. (An area over a *signature* covers
no words and answers for nothing, which is right; it answers the walk the other
way, by being drawn on the page the walk is standing on.) A value the review
has **kept** raises nothing at all: the sweep is run on the key *less* the
keeps, so a kept value is never boxed, and counting it would have asked for a
box nothing was ever going to draw.

**And a miss says why.** "Not found" on its own teaches nothing, so each one
carries its reason: *that PDF page carries no text at all* (a scan — one fact,
not thirty), *it IS boxed, but on PDF p. 4 — this export's page numbers and the
PDF's may not line up*, or *the PDF's own text does not yield it: a ligature, a
line break, an OCR spelling, or it is part of a picture*.

**What is outstanding is the shortfall, not the number of places.** A name the
export carries three times on a page that the sweep boxed twice is **one** value
still standing, and the bar counts it as one. All three places are still walked,
because which of the three went unboxed is not knowable from here — but the
moment you find that one and account for it, **the whole group closes**: the
other two are questions already answered, and dismissing them one at a time
would be work for nothing. Where two are outstanding the walk stays open after
the first, and the row keeps count as you go: *3 here, 1 boxed — 1 still to
find among 2 places*. That is the honest shape of it: the export can say
something was missed, and only a person can say where it stands on the paper.

**A drag marks what is under it — and where nothing is, the area.** The **Drag
marks** setting reads *the words it covers* or *the area drawn*. On the words
it boxes the text under the drag, tight to the lines it crosses; but where
nothing under the drag **is** text — a signature, an exhibit stamp, a
photograph, a scanned page whose text layer knows nothing — it marks the
rectangle you drew, since that is plainly what the hand meant, and says so. The
words under a drag are found by **geometry, not by a selection**: a selection
snaps to the nearest character on a row, which is right for reading and wrong
for marking, and a drag over a signature would hand back words nowhere near the
pointer. (It used to. A drag over a signature blacked out a line of text above
it and reported success.)

**The same tool from the case folder.** The text reader redacts too, from
beside the export: open a case folder, put the PDF beside the text with **⇔
Side by side**, and **▬ Redact PDF** marks that PDF and saves the copy without
opening it in a second tab or loading the key again. The rule above holds
exactly — the sweep, the proposals, the copy, the name, the untouched original
— with three differences that follow from where it is. The sweep reads the
PDF's own text off **every page of the document**, not only the pages drawn in
the pane. It skips the values the review has **kept**, which the reader knows
about and the viewer does not. And where a `Combined Text.txt` puts several
documents beside one export, the boxes are filed per PDF and the save writes a
copy of each that carries any.

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
own background tab (one per destination, as Shift+Space opens a selection's
links). Only the cases: a statute, rule, regulation or jury instruction is read in place, and
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
  annotated `5 U.S.C.A. § 552`, appendix `9 U.S.C. App. § 1`), including the
  code spelled out the way the California Style Manual writes it —
  `50 United States Code section 3931(b)(1)`, `Title 50 of the United States
  Code, section 3931`, and the `42 U.S. Code § 1983` form a web lookup gives.
  Spelled out or abbreviated, the citation is keyed as
  `50 U.S.C. § 3931(b)(1)`, so the two spellings are one authority in the
  Table of Authorities rather than two. Named codes and acts are read as
  well — `Internal Revenue Code section 9801(f)` / `I.R.C. § 61` / `IRC
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

  A federal search runs on the section, not the subdivision the document cited
  it down to: `50 U.S.C. § 3931(b)(1)` is searched as `50 U.S.C. § 3931`, and
  `45 C.F.R. § 164.512(a)` as `45 C.F.R. § 164.512`. The subdivision is a
  paragraph of the section rather than a document either provider indexes, so
  the shorter cite lands on the same page with less to fail on. Only the
  search is shortened — the Table of Authorities still lists the pinpoint the
  writer gave. California statutes keep their subdivisions in the search term.
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

- **A whole matter in one pick (the installed app).** PDF-Linker leaves a case
  in one shape: the folder holds `pseudonym_key.xlsx`, the PDFs, `LEAKS.xlsx`
  and — where the run made one — `Combined Text.txt`, with the exports
  themselves in a **Text Files** subfolder under it. So the app opens the
  **folder**, not the files: **📁 Case folder** on the tab strip, or the button
  on the empty page with nothing open yet. **One pick, one tab.** The combined
  file where the run made one — it *is* every export, in one document — else
  the first export, and it comes up with the case folder already attached: its
  key in force, its PDFs matched, its worksheet and flagged list to hand,
  because the folder is handed to the reader with the document instead of
  being asked for afterwards. The rest of the matter is inside that one
  reader, which is where it belongs: every export is listed in its Documents
  panel and built ahead of the click, the folder reads **on** so the next one
  hangs under the last as the page reaches it, the leak walk steps out of one
  document and into the next by itself, and Find reads the whole folder. A tab
  per export gave none of that — forty readers each compiling the same key,
  each knowing only its own document, and the tab strip to hunt through for
  whichever file the walk had just named. **Files still open as files**,
  by every route they ever did: the **+** tab and the empty page's own click
  (a multi-select picker), a drop anywhere on the window, and the system's
  own "open with" — `.pdf`, `.txt` and a quarantined `.txt.LEAK` alike. A
  folder picked with no exports in it offers the file picker rather than
  leaving a dead end.
- **The tools stand down the left margin.** The reading, pseudonym, review and
  PDF tools are in a **Tools** panel on the left — the same rail the PDF viewer
  carries — in labelled groups: *Reading* (font, size, leading, width, line
  lock), *Pseudonyms* (key, mark and its colour and intensity, show fakes),
  *Review* (flag a real value, the LEAKS worksheet, auto-scroll) and *PDF*
  (side by side, PDF pages). The top bar keeps only the document's own
  actions — open a file or a case folder, Edit, Save — and the settings that
  belong to the window: the citation provider, **§ Authorities**, **▤ Panel**
  and the theme. **Tools** at the head of the rail collapses it to an icon
  strip and back, and that choice is remembered.
- **Pages, in your font.** Each `====== Page N ======` block is laid out as a
  sheet, with the printed page number and any REVIEW clause on its label. A
  page numbered down its margin — pleading paper — is laid out as one: the
  numbers stand in a **ruled margin** of their own, a vertical rule and a gap
  between them and the body, and each numbered line hangs under its number
  so a wrapped continuation never crosses the rule. Pick the font (Georgia,
  Times, Charter, Palatino, system sans, Arial, Verdana, Courier, Consolas, or
  any installed family by name), size and leading. **There is no page width to
  set:** the sheet is 8.5 inches of paper and nothing the reader does moves
  it. Those are
  **remembered as the defaults**: the font and leading chosen once are what
  every text file opens in from then on — set them in the reader's Tools panel
  or under Options → "Text reader — default font and leading", and every open
  reader tab follows at once. Display only: the text file itself is never
  changed. Light and dark chrome follow the viewer's own theme toggle.
- **Zoom magnifies the page, the way a PDF does.** **Ctrl+wheel**,
  **Ctrl+plus/minus** and the **Zoom** buttons draw the page **larger**, and
  nothing on it moves or changes size in relation to it: the layout at 200% is
  the layout at 100% under a magnifying glass — the same words on the same
  lines, in the same places on the paper — and what no longer fits the window
  is scrolled to. A PDF gives you no way to reflow its text when you zoom, and
  neither does this. **Ctrl+0** puts the page back to its own size. The
  gesture is caught before the browser can scale the whole window — toolbar,
  tools panel, status bar — which is the part nobody wanted bigger, and a
  trackpad pinch is added up and spent a step at a time. The scale is applied
  in the page's own pixels rather than as a picture blown up, so the type is
  drawn at its real size and stays sharp at any magnification, and everything
  the reader measures goes on being measured in one space.
- **A page is a page.** Each sheet takes the **shape of the PDF page it came
  from** — its proportions at whatever width you are reading at — so an export
  reads as the document it was filed as instead of a stack of notes: a caption
  page half the height of the one after it, a short exhibit page a strip, a
  banner page a band. The words are untouched: they flow as they always did,
  in your font at your size, and it is the paper under them that changes. A
  floor, never a ceiling — a page whose text wants more room than the shape
  gives it (a large reading size against a dense page) grows, because the
  words come first. Nothing is read from a PDF until the pane is opened, so
  until then the document's prevailing shape stands in, and US Letter portrait
  behind that; a landscape exhibit reads portrait until its PDF is opened and
  takes its own shape the moment the sizes land.
- **The paper never gives; the type does.** The sheet is a page — 8.5 inches
  at 96 to the inch, or the stage where that is narrower, since a page that
  will not fit the screen is no use — and **zooming makes the type bigger and
  the paper not at all.** **Nothing leaves the paper**, either: a numbered
  line is never wrapped (its tail would fall on a screen line with no number,
  one line off from the PDF), so it runs past its column — and is **cut where
  the sheet ends** rather than painted out over the gap beside it. Cut, not
  shrunk: one runaway line does not take the whole page's type down with it.
  What widened the page for such a line was **Line lock**, and that is why it
  is gone.
- **The shape is a ceiling: the type gives way, not the page.** A page whose
  words want more room than its PDF page gave them — the reading size is
  yours, and the filing was set in whatever it was set in — is **drawn
  smaller** until they fit, the way the PDF itself is at that zoom. Display
  only: the file is one size. **The fit is measured at the default size, not
  at the size you have zoomed to** — measured at the zoomed size it would take
  back exactly what the zoom had just added, and zooming in would do nothing —
  so at the default every page holds its words, and from there zooming in
  makes them bigger and lets the page run on past the foot of the paper. The
  floor is half that size; past it the page grows instead, because a sheet the
  right shape with nothing legible on it is no use.
- **The PDF's own type sizes, where they are known.** On a page the PDF sets
  in more than one size — an order's caption, a heading, an exhibit's small
  print, a footnote — each line takes **its own row's size**, as a multiple of
  the body size, so the page reads with the filing's own shape to it while the
  words still flow in your font at your size. Pleading paper is one size down
  its column and is left alone. This needs the PDF's text layer, which is read
  when the pane is first opened, so a document read without ever opening the
  pane is set in one size throughout.
- **The export's own trailer is clipped beside the PDF.** PDF-Linker ends an
  export with a `====== Authorities cited (public verification links) ======`
  rule and a line per authority. It is part of the file — it round-trips, it
  saves, it is translated under the key like everything else — and no part of
  the filed document, and the PDF beside it has no such page. While the pane
  is open those lines are hidden, so the last sheet keeps the shape the rest
  of them hold; with the pane closed they are shown, and the page carrying
  them is left to flow rather than have the filing squeezed to make room for
  the links. Hidden, never removed: a save still writes it.
- **The boxes are drawn, whatever the font.** PDF-Linker draws a page's
  line art — a court form's caption box, a pleading's caption divider, a
  section rule, an underline — into its export with the box-drawing glyphs
  (`─`, `│`, the corners and tees), which is a box only in a monospace font at
  single spacing: any other font puts one column's bars at different places on
  different lines, and any leading cuts a vertical rule into a stack of short
  strokes. The reader draws the box instead. A line carrying bars is laid out
  as a row of cells split at its bars, consecutive lines whose bars stand at
  the same character positions share one table, so a bar column is one
  unbroken line down the page in Georgia at any leading exactly as in
  Consolas; a line that is nothing but rules (a box's top, a divider) is a
  hairline at half a line's height, and an underline inside a row is a line
  under its own width. The glyphs stay underneath — a save and a copy read
  exactly what the file says, and the bars are located in the file's own
  text, so a row whose real name is longer than its fake is still a row of
  the same box. A box never wraps — a wrapped cell is a box with a hole in it
  — so a box wider than its sheet widens the sheet, as line lock does for a
  long numbered line, and the stage scrolls sideways. Two boxes stacked with
  different widths keep their own columns; the one row between them that
  belongs to neither is drawn on its own and sized to the box under it. A
  page laid on its PDF's grid (side by side) positions every line on its own,
  so there each box's rows are measured together after every layout pass —
  every column set to its widest cell, the rows given one left edge, and each
  row made as tall as the gap to the next so the bars meet — the box is a box
  there too.
- **Print what you see — in its pseudonyms.** **🖨 Print** (Ctrl+P) sends the
  pages as they are shown to the browser's print dialog, where "Save as PDF"
  keeps a copy: the font and leading in force, the drawn boxes, the pseudonym
  marks, one sheet per printed page, each sheet at its screen width and the
  lot scaled to the paper so nothing re-wraps. The chrome around the pages and
  the citation underlines are left off. **The names are the one thing the
  printout does not take from the screen.** A printout leaves the room, so a
  print does to the pages what a save does to the file: the forward pass over
  every page — the values kept for the case and the spot keeps left exactly as
  they read — and then the pseudonyms on show, whichever way *Show fakes*
  sits. Paper and PDF carry the scrubbed copy without anyone having to
  remember. The document itself is not touched: the pages go back as they were
  when the dialog closes, nothing is written, and a real name standing unfaked
  is still standing and still orange, to be dealt with before a save.
- **Citations linked.** The same detector the PDF viewer runs underlines every
  case, statute, rule, regulation and CACI instruction and links it to Lexis+
  or Westlaw (the provider setting is shared), with the **§ Authorities**
  panel listing them once. A cite that wraps onto a numbered line is read
  across the gutter number, as `pdf_linker.py` reads it. **Under Match PDF
  grid the links are off.** An underline is a strip measured off the line it
  sits under, and the grid moves that line — against a body it has shifted,
  and again as each PDF's sizes arrive — so the strips land beside the words
  as often as under them. The authorities are still read, so **§ Authorities**
  fills as always and a cite opened from the panel opens the same page; the
  status bar says the links are off, and they come back the moment the grid
  does. Side by side without the grid leaves every line where it flows, so
  there the links are drawn and are right.
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
  and takes only `pseudonym_key.xlsx` and the exports out of it (a
  `*.txt.LEAK` quarantined by PDF-Linker's leak gate is listed too, marked,
  and opened first — it is the one to read). The reader **remembers every case
  folder it is shown**, so a document opened on its own afterwards — from the
  file picker, a drop, or the installed app's file handler — is matched to the
  folder it sits in (its own folder, or the one above `Text Files`) and that
  folder's key is attached automatically; where the browser wants the folder
  re-authorised first, a bar offers it in one click, and a file from a folder
  the reader has never seen gets an offer to open it once — **and the picker
  opens where the file is**, so the case folder is already on screen and the
  pick is one click. (A page cannot walk up from a file to the folder holding
  it: the browser hands over a file and nothing above it, which is why the
  first folder is picked at all. After that it is remembered.) **Picking the
  Text Files folder by mistake is caught**: it is where the exports are, so it
  looks like the place, and everything that makes a case folder one — the key,
  the PDFs, the worksheet, the flagged list — is the level above. The reader
  says so and opens the picker there again, with the folder above one click
  away. Every fake is shown as its real value in the case the fake was written
  in, **lightly highlighted**, and hovering shows the pseudonym underneath.
  The highlight's **colour and intensity** are yours to set (the swatch and
  slider beside "Mark pseudonyms", or under Options), and are remembered like
  the font — **written the moment you choose them.** Every reading setting is
  kept in two places: the local copy, written at once and the one the next
  session opens from, and the synced copy the Options page and a second tab
  read, written a beat after the dragging stops. The synced store takes 120
  writes a minute and rejects the rest, and a colour is chosen by DRAGGING: a
  write per pixel spent that quota in the first second, so the colour finally
  settled on was the one most likely to be refused — on screen for the
  session, yellow again the next morning. Each copy carries when it was
  written and the newer one wins, so a synced write the browser refuses cannot
  undo the choice, and a colour set in Options while the reader was closed
  still arrives. **Mark pseudonyms** turns the highlight and the hover off;
  **Show fakes** shows the document as it is on disk. The key is read the way
  `DeAnonymize.bas` and the Claude extension read it: columns by header name,
  operator keeps skipped, alt spellings forward-only, an ambiguous fake
  retired, the pinned tab out of the reversal. The last few keys are
  remembered, so a lone `.txt` can be read under a key already loaded. A real
  name from the key standing **unfaked** in an export is counted in the status
  bar and underlined — that is a leak the run missed. **The names of decided
  cases are not.** Most of what a key matches in a brief belongs to the
  decisions it cites, not to the matter: a pleading names Slaybaugh, Semole
  and Renoir a dozen times each, and a key that binds a surname of this case
  which happens to be one of theirs used to mark every one of them, burying
  the leak that matters under a page of orange. A case **name** carrying the
  **citation** that makes it one — a year in parentheses, a volume and
  reporter, or *supra*, and the short form "Semole, supra" with it — is read
  as a decision, and a bound value standing inside it is that decision's
  party. It is not marked, and **the save writes no pseudonym over it**, which
  is what would have put out a citation to a case that does not exist. That
  was the classic **keep**, made automatic. The citation is the whole test: a
  caption has no reporter, so "Rasho v. Quillmark, Defendant" at the head of a
  pleading is still a leak — the one that matters most. **The count opens a
  bar over the text**, the same one the LEAKS worksheet gets: counting them is
  not finding them, and on a forty-page export they are wherever they are.
  Clicking it (or **Alt+L**, with **Shift** for the one before) goes to each
  in the order they stand in the document, marks it, and gives the decisions
  as buttons — **keep just this one**, **keep in this case**, **never fake it
  anywhere**, or leave it, which the save writes as its pseudonym. The bar
  says which of how many, and the page and line it stands on, and the walk
  wraps at the end. Where the case folder has no `LEAKS.xlsx` that is the
  whole review: the key is attached, the names it binds are underlined, and
  this walks them one at a time. Where the worksheet's own bar is up, this one
  sits under it. **And it walks the folder, not the document.** The marks read
  the document that is open; the folder holds the other forty, and a name left
  in the clear in one of them is exactly as much of a leak. Once a document
  has been read, the rest of the folder is **swept** on idle — each export
  read once, under the same key, past the same keeps, the names of cited
  decisions spared as on the page — and the count says what they are carrying.
  Step past the last name here and the reader **opens the next document that
  has one** and goes on there; a document with none of its own still steps
  into the folder. The sweep is thrown away whenever the key or the keeps
  move, being an answer about them, and a document that has been saved is
  struck from it. **fake it** is the other half of the bar: the keeps answer
  the names that must stay, and this answers the rest. It is the decision and
  not the deed — a save writes every name standing in the clear anyway, so
  this one was always going to be faked; what the walk was missing was a way
  to **say so**. The name is settled, the walk stops offering it, and the save
  writes the pseudonym in its own time. By value and not by place, since a
  save fakes every occurrence of a name alike. The count says how many are
  settled and waiting on the save, the bar counts what has been answered here,
  and the settling is dropped whenever the key or the keeps move, both of
  which change what the question was. Where there IS a worksheet the bar above
  the text is still the way through its rows; this steps what is standing in
  the text, which is not the same list (a worksheet is one row per value, and
  a value leaks wherever it leaks).
- **The LEAKS worksheet, row by row, in the text.** PDF-Linker's leak triage
  is `LEAKS.xlsx` in the case folder: one row per flagged value with a
  **Fix?** cell to answer, and Apply Fixes reads the cells back. The
  reader attaches the folder's worksheet when the folder is opened (or **⚠
  Leaks** loads one; a dropped `LEAKS.xlsx` attaches too) and works it **one
  row at a time**: the current row stands in a bar above the text — value,
  type, file and page:line, both Context quotes with the value bolded, the
  Notes — and the text **opens the row's own document and scrolls to its page
  and line**, the value marked wherever it stands (the occurrence the bar went
  to strongest). The page stays editable underneath, and side by side the PDF
  follows as it always does. **yes / no / never / phrase** are buttons;
  anything else the cell takes — the replacement, `~CORRECT SPELLING`,
  `*CORRECT TEXT` (`**` in every folder), a `[part to keep]` — is typed and
  applied with Enter; **Alt+Y**, **Alt+N**, **Alt+↑/↓** work from the page.
  **A row PDF-Linker answered for you is still a row to answer.** Where the
  sheet arrives with a `~value` already in its Fix? cell — its own reading
  that this value is a misspelling of that one — the review stops on it
  exactly as it stops on an empty cell, and the bar says whose reading it is.
  The suggestion is usually right, which is why it is pre-filled; when it is
  wrong it is wrong in the way that matters most, since a `~Martin` over a
  real "Marin" writes a real name into the file as though it had been checked.
  **accept** (**Alt+A**) takes it as it stands and the row stops coming back;
  typing anything else overwrites it. An acceptance writes nothing to the
  workbook — the cell already says it — so it is remembered in the reader,
  beside the unsaved decisions, and a save does not clear it. A decision moves
  you to the next row still to answer; the **Leaks** tab lists every row with
  its state and jumps to any of them. A `no` or `never` on a value the key
  binds is mirrored as one of the reader's keeps, so the orange mark goes and
  a save of the document leaves the value as it stands. **A save of the
  document writes the worksheet too**: the rows answered while reading a
  document are decisions about that document, and a decision left in the
  browser is one PDF-Linker's next run will not see, so **Save** (or Ctrl+S)
  carries them along with it — in place, through the worksheet's own handle or
  the case folder's, and where there is neither the save says they are still
  unwritten rather than opening a picker. Otherwise they are remembered until
  **Save LEAKS.xlsx** (Ctrl+Shift+S) writes them **into the same workbook in
  place** — only the Fix? cells change; every other part of the file, the
  Context quotes, the column widths and the dropdown come back byte for byte,
  and the file is read back before it is written — after which Apply Fixes (or
  a re-run) applies them to the files. A `yes` here is the worksheet's alone:
  it is never also flagged into `New Real Values.txt`.
- **And through a document in the order the rows stand in it.** PDF-Linker
  writes one row per **value**, so the worksheet's own order is the order the
  values were first found — which sent a review to page 4, then page 31, then
  back to page 9, for no reason that means anything on the page. The walk
  takes a document's rows by **where they stand in it** (the page and line of
  the Where cell) instead, so a review reads a page and finishes with it. The
  **‹ ›** buttons and **Alt+↑/↓** follow the same order, not the sheet's; a
  row whose Where names no place — a sentinel, a tally — comes after the rows
  that do. The **Leaks** tab still lists the worksheet in its own order, that
  being what it is a list of.
- **A review goes through the folder one document at a time.** A row stands
  in a document — its File cell — and the rows are worked **document by
  document**: every row standing in the document in front is reached before
  any row of the next one, undecided first, so a decision keeps you where you
  are and the review moves on only when that document has nothing left. The
  bar says how many of the undecided rows are in the document in front. A
  value that leaked into several documents is still **one row and one
  decision**, made in the first of them. This is what lets a case folder of
  hundreds of text files be answered at all: the reader holds the document in
  front of you and reads the next one **only once you have finished this
  one** — never the folder at once, which is what used to take the tab down.
  (Under two dozen exports it keeps working further ahead, as it always has;
  there is nothing to protect you from in a folder that small.)
- **A case of thousands of leaks, under a key of thousands of names, opens and
  answers.** The reader builds one matcher out of every name in the key, and it
  used to look for them the way you would with a list in your hand: at every
  word of the document, try every name. A key of a few thousand names then cost
  a couple of seconds *per page* — and the reader reads a whole document
  whenever it opens one, marks the text, or saves, which is why the tab would
  not scroll, would not answer a button, and was eventually offered up for
  killing. The names are filed under their first word now, so the word in front
  of the reader picks out the handful that could stand there: a hundred and
  fifty pages under a key of three thousand names went from 13.6 seconds to
  18 milliseconds, finding exactly the same names. (Past about three and a half
  thousand names the old matcher was also simply too big for the browser to
  run, and said so only when the first document was opened — which is why the
  file never appeared and the screen went back to asking for one. That is gone
  with it.) Around it, the things that were done again on every
  keystroke are done once: the marks over the text are scanned when the text,
  the key, the flags or the keeps move and not when you answer a row (and then
  a beat later, like the citation underlines); the keeps are indexed rather
  than searched, so the five hundredth `no` costs what the first did; a file
  name is matched through the key once rather than once per document in the
  folder; and the Leaks list is written on rather than rebuilt. On a case of
  200 exports of 150 pages, 2,500 leak rows and a key of 4,000 names: the first
  document opens in under two seconds where it used to take 17 or fail
  outright, and ten decisions take under a second and a half where they took
  nineteen. The two long passes the reader makes over a whole document — the
  marks over the text, and building the next document before you reach it — are
  cut against the browser's own clock now, so neither holds the page: nothing
  is read ahead while you are still answering rows, and a document left
  half-built is picked up where it stopped rather than started again. Sitting
  still after opening a document cost two freezes of over a second each; it
  costs none. If something does go wrong, the bar at the bottom now says so
  instead of the reader quietly stopping where it stood.
- **Nothing is read ahead until you start a review.** The reader used to begin
  reading, parsing and building the document your first undecided leak stands
  in — and opening that document's PDF — the moment a worksheet was attached,
  whether or not you had opened the review. Open a seven-page declaration in a
  folder of forty-eight documents and the tab would stop answering within
  seconds, for work you had not asked for and could not see. It waits for
  **⚠ Leaks** now: with the bar closed the reader does nothing but show you the
  document in front of you.
- **When something does hold the page, it says what.** The heavy passes name
  themselves, and a pass that holds the thread for more than a couple of
  seconds puts that in the bar at the bottom — "the reader held the page for
  4.2 seconds — reading the marks over the text" — so a slow reader can be
  asked where instead of guessed at. And if a pass never comes back at all —
  the page stops answering and the browser offers to kill it — the name is
  written down before the work starts, so the NEXT time the reader opens it
  says what it died in the middle of. A freeze you had to kill still tells you
  what it was. That message stands in the bar across the top until you dismiss
  it — not a toast that flashes past behind the document — and its button puts
  the line on the clipboard.
- **The marks give up rather than hold the page.** Reading the names over a
  document is the most expensive thing the reader does. It now stops for
  breath between handfuls of names rather than between pages — a Word export
  has no page breaks in it at all, so "a page at a time" was the whole file in
  one go — and if it has spent more than eight seconds on one document it stops
  altogether, says so in the bar, and leaves the words on the page. The next
  document gets a fresh start.
- **Plain reading**, in the Review group of the tools rail: the words and
  nothing else. No marks over the text, no citation links, no PDF beside it,
  nothing read ahead — for a document too big for the rest of it, or a reader
  that will not answer. It is also what the bar offers you after a freeze, so
  there is always a way to get the file open and keep working.
- **The pages a leak stands on are drawn before you reach them.** Every page
  a review will visit is named in the worksheet's rows before it gets to any
  of them, so with a worksheet attached the reader goes and gets them: the
  rows are read in the order the review will actually reach them, each row's
  PDF is opened, and its own page is drawn into a bitmap held ready. A page
  coming into view is painted from that bitmap at once, where a **Loading…**
  box used to stand, and pdf.js draws the sharp one over it a moment later.
  Only a window of pages is held (twelve), and the window moves with the
  review: what it leaves behind is closed, and nothing at all is held while
  the PDF side is put away. The **exports** the rows name are read ahead the
  same way, each held against the file it came from (name, size and
  modification time), so an export written since, by a save here or another
  run of PDF-Linker, is read again rather than remembered wrongly. **The PDFs
  behind them are closed again as the review walks past them** — a PDF holds
  its bytes, its pages and the line grid read off every one of them, and a
  folder of three hundred of them cannot all be open at once.
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
  of a line is the same join from the other side; a **paste of several lines
  goes in as one edit** — its first line typed where the caret stands, the
  rest laid into the slots below in a single pass, the text below moving
  down once. So where the export left line 7 empty and the PDF has text on it,
  click line 7 and type: the file gets ` 7  ` and your text, and PDF-Linker's
  next run reads it as line 7. A selection that reaches across a number is
  refused an edit, and the numbers never take a keystroke.
- **The documents with leaks in them are ready before you open them.** Open a
  case folder with a `LEAKS.xlsx` in it and the reader starts getting the
  documents its rows name — whichever document you came in on, and whether or
  not you ever click them in the list. Each is read, parsed and its pages
  **built off the page**, in the order the review will actually reach them
  (the row in front, the undecided rows after it, then the rest), and opening
  one is then putting those pages up rather than making them. The **Documents**
  tab marks the ones that are ready and says how many (`3 of 3 with leaks
  ready to open`).
- **And which of them is still carrying a real value.** A document with a name
  the key binds standing unfaked in it, or a flagged value the next run has
  yet to reach, wears a **⚠** beside its name in the **Documents** tab, and
  its tooltip says how many of each. The status bar already counted what the
  rest of the folder was carrying, but a number does not say *which* of the
  forty it is, and the Documents tab is where the next one is chosen. The
  documents on the page are counted from the marks over them — which know the
  edits the file has not been given yet, and the names the walk has settled —
  and the rest from the folder sweep, which reads each file's own text. Where
  the marks are off (plain reading, or a document they cost too much on) the
  file's own reading stands.
  Gradually, and within a budget: one document at a time, in idle time, each
  built in slices of pages, so the building never stands between you and the
  page you are reading. How many are held is what fits — up to six of them and
  four hundred pages between them, which on a case of ordinary exports is
  every document with a leak in it and on a case of long ones is the next two
  or three. **A document of more than two hundred pages is never held**: that
  is the combined file, and holding it is what takes the tab down. What the
  window has passed is let go of, furthest from the row in front first. A key
  loaded or changed drops them all (their pages carry that key's translation);
  a keep decided since, or the pseudonym toggle flipped since, is put right as
  the document goes up rather than built again.
- **Opening a document with its PDF beside it does not lock the page.** The
  two columns are matched page by page — each text page laid on its PDF
  page's own grid — and that matching asks for a pass over the whole document
  every time anything about the PDF side changes. Each of a document's PDF
  pages reports its size as it is opened, and its line grid lands later
  still, so a seventy-page complaint asked for **a hundred and forty passes**,
  each laying out two thousand lines against the grid: the best part of two
  seconds in which the page answered nothing, and a single stretch of a full
  second inside it. The asks are now collected and answered **once a frame** —
  eight passes for that complaint instead of a hundred and forty — the pane is
  read once per pass rather than once per page, and a line already standing
  where the pass would put it is left alone. The same complaint now blocks
  **0.6 s in no stretch longer than 0.18 s**, and scrolling it with the PDF
  alongside blocks nothing at all. The columns line up exactly as before:
  every page matched, the two sheets the same width, no drift between them.
- **A long export keeps answering while you edit it.** A paste used to be
  typed in line by line, and each of those lines pushed the page's text down
  a slot and then had the whole document re-read after it — the counts, the
  matched layout, the line lock, the citations and the highlights, over every
  page. A block of thirty lines pasted out of the PDF into a two-hundred-page
  export locked the reader up for **twenty-two seconds**; the same paste now
  takes **thirteen milliseconds**, and puts the same text in the same slots
  with the same underlines on it. Two things got it there: the paste is one
  pass and one re-read instead of one per line, and the **citation underlines
  settle a beat after the edit rather than with it** — the scan has to read
  the whole document, since a short form ("*Ibid.*", an italicized name)
  means what the cite before it means, wherever on the way that cite stands,
  and doing that between keystrokes is what made a long document feel stuck.
  A page's underlines are rewritten only where they have actually changed,
  so an edit on one page no longer throws away and redraws every link in the
  file — which is what made the reader slower the longer you stayed in it.
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
- **A row that cannot be located says so, once, and keeps saying it.** A LEAKS
  row names the **PDF** the value was found in; the review has to open that
  PDF's **text export**, and the two names do not always agree. A stem ending
  in an abbreviation's own full stop — `Payee Supp. Decl. ISO Pet..pdf` — is
  written one dot shorter in the export beside it, and under an exact-stem
  match the row's document was simply not in the folder. The review then read
  whatever was open instead and reported the value missing from a document the
  row had never named. Two things now: a name differing from its export in
  **nothing but punctuation** still finds it (asked only after the exact stem,
  and only where exactly one export answers — an ambiguous name still gets no
  answer, because pointing the review at the wrong file is worse than pointing
  it at none); and the reason a value could not be marked is **one sentence in
  the bar**, where it stays while the row is being decided, naming every
  document in play. It used to be two toasts, of which the second overwrote
  the first before it could be read. Where the export really has lost the
  value — a page of corrupt OCR deleted since the run, say — the bar says
  that: *is not in <export>, where the row puts it (p.6:14); <PDF> still has
  it; the export does not.*
- **Ctrl+F reads the whole case folder, not the open document.** The browser's
  own find reads what is in the page, and what is in the page is this document
  — with the folder read on, not even all of it, since the reel sheds its far
  end to stay scrollable. A matter is forty exports, and *where does this name
  appear* is a question about the matter. So Find is the reader's own: a bar
  under the toolbar, every hit in this document marked and the one in front
  marked solidly, **Enter** for the next and **Shift+Enter** for the one
  before — and when this document runs out the walk **opens the next export
  that has one** and stands on its first hit, round the folder from wherever
  it was started and back again. The bar says which hit of how many is in
  front, where it stands, and how many are in how many other documents.
  **The folder is searched through the key.** What is on screen is the real
  names; what is on disk is the pseudonyms. A search for a party's real name
  therefore looks for the name as it reads in the open document, and for
  whatever the key writes instead of it in the forty files it has not opened
  — a name standing in the clear in one export and faked in another is found
  in both. Esc closes; 🔍 Find in the tools rail opens it over whatever is
  selected.
- **Flag what the run missed — and un-flag what it got wrong.** The point of
  reading the real names is to spot the ones that are *not* marked. Select
  such a name and press **🚩 Flag real value** (or Ctrl+Shift+F); the
  **Flagged** panel collects them and **Save list to case folder** writes `New
  Real Values.txt` beside the key, which PDF-Linker reads on its next run —
  and on Apply Fixes — as if each line had been given with `--term`. **A flag
  needs no full re-run.** The value is the operator's own instruction, so
  nothing has to re-read the PDFs to find it: double-clicking `Apply Fixes` in
  the case folder scrubs it straight into the `.txt` exports and writes its
  row into the key. That launcher sits beside `pseudonym_key.xlsx` whether or
  not the folder still has a `LEAKS.xlsx` to triage. **A flag the run has
  answered comes off the list.** The flag is a job: this name
  is in the clear, fake it. When the key comes back with the name in it — the
  folder opened after a run, a key chosen by hand — the job is done, and the
  value is dropped from the **Flagged** panel (the reader says which), takes
  its red mark off the text, and stops being handed over in the next `New Real
  Values.txt` — and a `New Real Values.txt` on disk still listing it from
  before the run does not bring it back. The whole value has to be in the key:
  a key that binds "David" has not pseudonymized a flagged "David W. Slayton",
  half of which would still be standing, and a value **kept** is not in the
  key's forward side at all — both stay flagged. **But a red mark never
  stands over a pseudonym.** The red mark says *this value is standing in the
  clear and the next run has yet to fake it*, and wherever the text on screen
  is a pseudonym the run has already faked it: the file carries the fake, and
  the real name is painted over it for reading only. So the marks read the
  page with the pseudonyms blanked — the same reading that finds the names in
  the clear — and a flagged "David W. Slayton" is marked where it really
  stands and not where the key's "David" has already been swapped out
  underneath it. (Selecting a pseudonym and flagging it was already refused
  for the same reason.) The opposite mistake, a value
  that should never have been faked (a word of a cited decision's name,
  usually), is **right-clicked**: "Keep in this case" is PDF-Linker's `no`,
  "Never fake it anywhere" its `never`. The keep takes effect in the reader
  **at once** — every occurrence loses its highlight and shows a dotted
  underline, the tooltip says the file still carries the fake, and a save
  neither rewrites the kept value to its fake nor refuses over it — and goes
  into the same file as a `no: VALUE` / `never: VALUE` line, which PDF-Linker
  reads as the worksheet's own decision on the run that actually restores the
  files. The **Flagged** panel lists both kinds, each withdrawable. **A save
  of the document writes the list too.** The flags and keeps are half of the
  same decision the document carries — a value kept is a value that save left
  standing — so a **Save** (or Ctrl+S) that finds the list changed since it
  was last written puts it into the case folder with the document and says so
  in the same line. Without a folder there is nowhere to put it, and the save
  says that instead of opening a picker nobody asked for. **A list that has
  not been written is a closing prompt.** The flags and keeps are remembered
  here whatever happens, so closing the tab loses nothing — but remembered
  here is not handed over: PDF-Linker reads `New Real Values.txt` in the case
  folder and nothing else. While what is in the panel differs from what was
  last written, the panel says so and closing the tab asks first (the same
  prompt an edited document, an unsaved LEAKS decision or a real name standing
  in the clear raises; the browser's own dialog is all a page gets, and which
  of the four it is, the panels and the status bar say).
- **A keep the case already carries out asks nothing of PDF-Linker.** A keep
  says *do not fake this value*, and what that costs depends on what the files
  already say. Where the run faked it, a file carries the pseudonym and only
  PDF-Linker can put the real name back: the keep has to reach the case folder
  and the run has to happen. Where the value **stands in the clear**, nothing
  faked it — there is nothing to un-fake, the files already read the way the
  keep wants them to, and handing it over would ask a run to do what has
  already been done. So that keep stays in the reader. It is not written into
  `New Real Values.txt`, it does not make the list one the case folder is owed,
  it raises no closing prompt, and the whole of its effect is the one that was
  wanted: the value stops being marked. The **Flagged** panel tags it *already
  so* rather than *this case*.
- **And it writes each document as it leaves it.** Deciding a document's names
  is a save's worth of work: the names settled are written as their
  pseudonyms, the keeps taken go into `New Real Values.txt`, a worksheet row
  answered on the way goes into `LEAKS.xlsx`. None of it used to happen, so
  the walk moved on and left a document still carrying real values with
  nothing on screen to say so — the count and the bar are about the document
  now in front. The save happens on the way out, and **the ⚠ Leaks worksheet
  review does the same**: its rows are walked a document at a time too, and
  the rows answered in one are written before the next is opened.
  **Only after a decision, though.** Stepping past a name, skipping one,
  pressing ‹ to look back at a row — none of that is a decision, and a
  document nobody decided anything in is left exactly as it stands, bytes and
  timestamp and all. What counts is a name answered (kept, or *fake it*) or a
  Fix? cell written.
  And **a save that does not happen holds the review**: the standing assertion
  refusing, or a file that would not be written, is exactly the moment not to
  move on. The bar stays where it is and says why.
- **The walk does not stop at the end of a document.** The names standing in
  the clear are a folder's worth of work, and the bar over the text used to go
  down the moment the open document ran out of them — leaving the walk to be
  picked up again from the count in the status bar, at the other end of the
  window, once per document. It stays up now: answer the last name here and
  the walk opens the next export that has one and stands on its first, and ›
  does the same from the bar. Where the decision just taken threw the folder's
  reading away — a keep is a question about every export, so it does — the bar
  says the folder is being read and goes on by itself the moment it answers.
  And it goes round the folder in reading order, the document *after* this one
  first, rather than back to the top of the list each time.
- **And it does not walk the folder on its own.** Two readings say where the
  names are, and they are not the same reading: the marks answer for the
  document open — they know the spot keeps taken in it, the names the walk has
  settled, and the edits the file has not been given yet — while the folder
  sweep answers for the files on disk, which know none of that. Where the two
  disagreed about a document, the walk landed there, found nothing and went
  straight out again; and since opening a document does not change what the
  sweep read, the row that sent it there was still there the next time round.
  Two such documents and the reader clicked between them as fast as files
  open — at the *end* of a review, when every document that really was carrying
  a name had been answered and the rows left over were exactly the ones the
  page disagreed with. The page's own reading is kept and honoured now: a
  document it has read and found nothing standing in is not offered as a stop
  again until the key or the folder moves, and the **⚠** in **Documents** goes
  on saying what that file itself carries. A document whose reading has not
  landed yet is not called empty at all — the bar says it is being read and
  waits, rather than leaving a document nobody read. One whose marks cannot run
  (plain reading, or a document they cost too much on) has no answer to give
  either way, so the walk stops there and says so. And a run of documents
  opened one after another with nothing found in any of them stops at eight,
  whatever the reason. Stepping the walk by hand is never a runaway and none of
  it applies: › goes where › says it goes.
- **And the question is the case's, not the document's.** A keep applies to
  every export in the folder, so "was it faked?" is asked of every export in
  the folder: a pseudonym standing in one of the other forty is a name the next
  run is the only thing that can restore, whatever the document on screen
  happens to say. The folder sweep already reads each export once to find the
  names standing in the clear; the same reading writes down which pseudonyms
  stand, and that index — an answer about what the run wrote, which taking a
  keep does not change — is kept across decisions and rebuilt only when the key
  or the folder's list of documents moves. One document that will not open is
  enough to withhold it: a missing file reads as "this pseudonym stands
  nowhere", which is the one wrong answer that costs a name.
- **Until the folder has been read, a keep is owed.** A keep taken before the
  sweep has answered is tagged *checking* and goes into the list like any
  other, because a keep wrongly held back is a name the run never restores and
  nothing ever says so. When the reading finishes it is settled — or left owed,
  if a pseudonym turned up. The move toward *already so* is the only one that
  needs evidence, and it is never made for a keep already written into
  `New Real Values.txt`: that line is PDF-Linker's now, and a run leaving a
  value alone that was already standing costs nothing. Two other things keep a
  value on the list whatever the folder says: **Never fake it anywhere**
  reaches the next matter through the file and nowhere else, and a value
  PDF-Linker has itself raised on `LEAKS.xlsx` has a row waiting on an answer,
  which is where it gets answered. With no case folder open there is nothing
  to sweep, and the open document is the whole of the case the reader can see.
- **A keep stays visible.** A value kept is a decision, and with the orange
  mark gone (it is not a leak any more) nothing used to say so — the name read
  like any other word, and a page read a week later gave no sign which names
  had been left alone on purpose. Every kept value standing in the clear now
  carries the **same dotted mark a kept pseudonym** does, counted in the status
  bar ("3 kept values standing as they read"), for the rest of the session and
  every session after: the keeps themselves are remembered per case. Marked
  where the key binds something in it, which is where a keep means anything — a
  master workbook carries the settled decisions of every other matter too
  ("Court", "Clerk", "County"), and nothing in this case was going to fake
  those. The test is CONTAINS, not equals: the workbook keeps "David W.
  Slayton" where the key binds "David", and that keep is worth seeing exactly
  because the "David" inside it would otherwise have been faked. (Masking is
  untouched and still covers every keep; only the marks are narrowed.)
- **The master workbook, where it is holding something.** PDF-Linker keeps one
  workbook across every matter, whose KEEP sheet is every value you have ever
  said to leave alone. Attached here, those keeps are in force in this case
  too — but **only the ones the key binds are identified or shown**. A keep
  exists to stop a value being faked, and a value this key does not bind was
  never going to be: "Court", "Clerk", "County" and a hundred names from other
  matters do no work here, and listing them would bury the handful that do.
  The panel says what the workbook is **holding against the key in this
  document** and keeps the total as a tooltip; the marks over the text are the
  same handful; and the blanking that protects a keep from the forward pass is
  narrowed to them as well, which takes an alternation over hundreds of values
  out of every save and every repaint.
- **Or keep it at one place only.** Both of those keeps are decisions about a
  *value*, and neither fits the name on every document: the Clerk's own
  signature block. Fake the "David" of *David W. Slayton* and the pseudonym
  standing there also stands for a party's "David" — which tells the reader
  the party is a David too. Keep "David" for the whole case and every David
  in it comes back. So the menu's third, narrowest choice is **Keep just this
  one (here only)**: *this* occurrence reads as itself, and every other
  occurrence of the value goes on being faked. It is an edit, not an
  instruction for the next run — the value stands in the clear at that place,
  the save writes it as it reads, the orange leak mark leaves it alone and the
  save's own assertion lets it through, all at that place only. A name wrapped
  over two numbered lines is kept whole, both halves together. An **unfaked**
  real name takes the same choice from its own right-click, which is how one
  occurrence is left as it stands without keeping the value everywhere.
  Kept spots are marked with the same dotted underline a kept pseudonym
  carries, are listed under **Flagged** with their page (click to go to one,
  **×** to fake it there after all), ride along with **undo and redo**, and are
  **remembered per document**, so reopening the export finds them again — which
  is what keeps the reader from reading the value as a leak the next time. They
  go nowhere near `New Real Values.txt`: a place in one file is not something
  PDF-Linker's value-level rules can be told, so a re-run of PDF-Linker, which
  writes the exports again from the PDFs, fakes it once more.
- **📄 File as text — the file itself, as Notepad would open it.** Everything
  the reader does is a view: the fakes are shown as the **real** names, the
  lines are laid out as sheets, the margin numbers get a ruled gutter, the
  citations are underlined. That is the point of it — and it is the reason it
  is worth being able to see what is actually *in* the file, because what goes
  to the court, to PDF-Linker and to anyone the export is handed to is the
  bytes, not the view, and the two are meant to differ in exactly one way: the
  file carries the pseudonyms. The panel is that text, fixed-pitch, wrapping
  off as a plain editor opens it, with the page headers and the gutter spacing
  exactly as they sit on disk — and it is not a rendering of the file but the
  same text a save writes, built the same way, so on a document nobody has
  edited it *is* the disk, character for character. The footer counts the lines
  and characters and names the line endings (CRLF or LF) and whether the file
  ends with a newline. Where the two states differ it says so: a document with
  unsaved edits is labelled as such, and a real value the key binds standing in
  the text is flagged with the note that a save would write the pseudonym
  instead. **Copy** takes the whole thing, pseudonyms and all.
- **A flag does not rearrange the page.** Flagging a value, or keeping a
  wrongly faked one, used to open the Documents / Flagged panel to show the
  list growing. Flagging is done *while reading*, often several in a row, and
  having the page narrow and re-lay itself each time — the PDF pane with it —
  is the reading interrupted to be told what the toast already said. The panel
  now switches to **Flagged** if it is open and stays shut if it is not. What a
  decision needs is not to be shown but not to be lost, and that is the save
  prompt's job: the Save button lights, the status bar names what is waiting,
  and closing the tab asks before it goes.
- **💾 Save is lit whenever a save would do something.** Flagging a value the
  run missed, keeping one it wrongly faked, answering a row of the LEAKS
  worksheet — each is a decision that lives in the browser until it is written
  into the case folder, and none of them touches the text. Save used to stay
  greyed out over a whole review's worth of them, so the button said there was
  nothing to save when there was, and you had to press **✎ Edit** to get at it.
  It now lights for any of them, the status bar names what is waiting
  (`● New Real Values.txt to write`), and such a save writes **only** those —
  the document's own bytes and timestamp are left alone, since its text never
  changed.
  **And a name standing in the clear is a save that would do something too.**
  A real value the run left unfaked is rewritten by the save on its own — that
  is what the forward pass is for, and the file is written whether or not a
  character was typed — but Save did not say so: a document whose only
  outstanding work was the run's own leftovers sat greyed, and the way to get
  at it was to press **✎ Edit**, change nothing, and save. Unlocking a
  protected document to make a button work is the one thing the protection
  exists to prevent. Save is lit by those names now, and the status bar counts
  them (`● 3 real names to write as pseudonyms — Save does it`). Every one of
  them, settled or not: **fake it** answers the *walk*, not the save, and a
  name nobody has looked at yet is rewritten just the same. Values **kept**,
  the ones kept where they stand, and the parties of cited decisions are not
  counted, because the save does not touch them either.
  **And closing on one asks first.** Nothing is lost by the close — the name
  is still in the file, to be found again the next time the document is opened
  — but what is left behind is a scrubbed export carrying a real value, with
  the operator believing the document has been read. That is the mistake the
  whole tool exists to prevent, so it is worth a prompt that sometimes says
  what you already knew. Switching documents does **not** ask: the walk moves
  from export to export by design, and a prompt at every step would be a
  prompt nobody reads.
- **The case folder read on, without a combined file.** A case is one filing in
  pieces, and `Combined Text.txt` is the file you read when you want the case
  rather than the motion — but somebody has to have built it, it is stale the
  moment one export is re-run, and a save of it writes every document at once.
  **↕ Read folder on** (the PDF group, on by default, remembered) is that
  reading without that file: as the foot of the open document comes into view
  the **next export in the Documents list** is read and hung underneath it,
  with a divider naming it and an **Open on its own** button, and so on down
  the folder. Nothing is combined on disk and nothing is written that you did
  not edit.
  **It reads both ways.** The export you open is rarely the first paper in the
  case, so coming back up to the head of the reel hangs the export **before**
  it above, and so on back up the folder. Reading back is asked for rather than
  assumed — a document opens at its own first page, and the papers behind it
  are pulled in when the reading comes up the column, not the moment it opens.
  The reading itself does not move while they arrive: pages going in above the
  window would push it down, so the scroll is put back by exactly the height
  that went in. Going up is the more expensive direction — a page is named by
  its place in one page list, and a document hung above renumbers every page
  below it, the sections, the spot keeps and the undo history with them — so a
  document is never hung above while the leak review, the names walk or the
  redaction check is open, each of which is holding page numbers of its own.
  Everything that already knew how to put several documents beside one page
  list goes on working, because the pages ARE one list: the PDF pane matches
  each document to its own PDF through the key, the citation underlines and the
  Authorities panel run across the whole reel, and the leak review walks it.
  **The document you are reading is the one you are looking at** — the status
  bar, the Documents list, the spot keeps and the file a save adopts all follow
  the reading line across a divider. A save writes **every document you edited,
  each to its own file under its own name**, and names them; one you scrolled
  past and did not type in is not rewritten, so reading forty documents does
  not put forty timestamps through a review that changed one line of one of
  them. The reel never runs off a `Combined Text.txt` (that file is every other
  document over again, and is a reel already), and it stops after 25 documents
  in all, either end — a page of a long export is not free, and a folder can
  hold three hundred — saying so, with the next one a click away in the list.
  The **numbered margin is the boundary**: nothing the grid does puts a line
  left of it. A PDF carries margin furniture the export has not — the firm
  printed down the side, a seal, a stamp — and the body's margin is the one
  its rows share, not the leftmost thing on the page. One margin serves the
  whole document, so the numbers stand in a single straight column down it.
  **A caption box starts at that margin too**, and its column of bars runs
  straight down: a box is drawn as a table rather than on the numbered grid,
  and beside a PDF it used to take the reader's own gutter instead of the
  PDF's margin — the one page with a box on it drawn out over its own line
  numbers while every other line sat at the margin.

  **A file opened on its own brings in its key, and nothing else.** Where the
  reader knows the case folder a file sits in, opening that file attaches the
  folder's **pseudonym key**, its **flagged values** and its **LEAKS
  worksheet** — the three things that belong to the case rather than to the
  document — and leaves the folder alone: no list of its exports, no sweep of
  the others for names in the clear, nothing read ahead, no reel reading on,
  no PDFs matched by name. **Read the whole folder** (under the Documents
  list) brings the rest in when you want it, and **Open case folder** still
  opens the whole thing as it always did.

  The folder sweep — which reads every other export in the case for names
  standing in the clear — **is proportional to the folder, not to the key**.
  A key value holding a run of blank between its words (a name the run
  captured standing in two columns of a caption, or wrapped at the margin)
  used to be read as one gap per space, which on a page of columns quadrupled
  in cost with each space: eight of them took two seconds a page, and one
  export took **two minutes** and hung the tab. A run of blank is one gap.

  **Forget this folder** (under the Documents list) lets go of the case
  folder and reads whatever you open on its own: no sweep of the other
  exports, nothing read ahead, no reel reading on, no PDFs matched by name.
  **The key stays attached**, so the marks stand. The folder is not remembered
  either, so opening a file from it does not bring it back — **Open case
  folder** does, whenever you want it again.

  In a **big case folder** (more than two dozen exports) it stops at 8: there
  every document has a PDF behind it, and a review holds every page of the
  reel live. It also stops at **600 pages** however few documents that is,
  since twenty-five hundred-page exhibit sets are not the same reel as
  twenty-five proofs of service.
  The status bar says where the reel stands: `3 of 5 on the reel`, and where it
  has read the folder out at one end or both.
- **Auto-scroll at a reading pace, not a pixel speed.** **↓ Auto-scroll** (or
  **A**) creeps the document so you stop reaching for the wheel, and what you
  set is **words per minute** — **[** and **]** by 25 at a time, remembered.
  The pixels follow from the page: each page's own **density**, the words it
  holds per rendered pixel, sets the speed under the reading line, so a dense
  block-quoted page of a brief goes slowly and a caption page with nine words
  on it is crossed in a second or two, both at the pace you asked for. The
  zoom, the leading, the page width and the PDF grid then take care of
  themselves — they change the pixels a page takes, the density is measured in
  those pixels, and the pace stays put. Speeds ease over about half a second
  between pages, so a page boundary is not a gear change.
  **A scroll of your own is not a stop.** Reading is not one-directional — a
  name checked three lines back, a wheel notch that overshoots — so a wheel,
  a drag, a scroll key or the PDF pane pulling the text along beside it all
  **suspend** the creep and it picks up on its own about a second after the
  scrolling settles, from wherever you left the page. **Space** is the pause
  that sticks. It also holds still for anything you are in the middle of: a
  selection you are holding, a keep menu or a swap popup over the text, the
  LEAKS or names review (both put the text at a row and ask about that row),
  and the redaction tool — and that hold does not time out, it waits for the
  work to be put down. At the foot of the document it stops and stays armed,
  so Space reads on from wherever you scroll back to. The mode is **sticky**:
  turn it on and the next document opens already moving.
  Motion is sub-pixel. At a reading pace this is ten or twenty pixels a
  second, and `scrollTop` only moves in whole ones, which at that speed
  ratchets; the whole pixels go to `scrollTop` and the remainder is carried by
  a transform on the page column, snapped to the **device** pixel grid so the
  type is never left resampled onto a half pixel.
- **The rest of the reading tools from the PDF viewer.** **Shift + Space**
  opens the citation under the pointer, or every citation in the selection, in
  background tabs, as on a PDF; the theme toggle and the Authorities panel are
  the viewer's own. The Documents / Flagged panel collapses on its **»**
  chevron (or **▤ Panel**), stays closed until it has something to show, and
  remembers your choice.
- **The PDF it came from, beside the text or swapped into it.** PDF-Linker
  leaves the PDF in the case folder under its real name and names the export
  for the same stem scrubbed, so the reader finds the pair by running each
  PDF's name forward through the key (a `Combined Text.txt` is matched member
  by member off its banners); where nothing matches — a lone file, a folder
  with no key — **⇄ PDF pages…** offers **Pick PDF…**, and a dropped `.pdf`
  is taken the same way. A pane with nothing to show **says which of the
  three things is missing**, since "no PDF matches" read as a matching
  failure when usually there was nothing to match: no case folder open means
  no PDFs at all (and the pane offers to open one), no key means the names
  cannot be compared — a PDF keeps its real name and the export is named for
  the same stem scrubbed, so only the key can tell that
  `Rasho v Quillmark - MTC.pdf` is `Strangeways v Melbury - MTC.txt` — and
  with PDFs and a key in hand it says the names simply do not meet. The
  suffixes are never the difficulty: `.pdf`, `.txt` and `.txt.LEAK` all come
  off before the comparison, and a combined file's 21 members match their 21
  PDFs by name through the key. The PDF is read only when it is first shown.
  **⇔ Side by side** opens the PDF in a pane beside the text, one PDF page per
  text page, scrolling together — and each text page laid out on **its PDF
  page's own geometry**: the same width and height, label and all, and, where
  the PDF's text layer carries the pleading numbers down its margin, every
  numbered line at its number's own height, the body starting at the PDF's text
  margin, the leading the PDF's pitch, so **line 7 stands beside line 7**.
  The grid used to be a second switch, on the reasoning that a reader opening
  the pane to check one name does not want the document re-set around them. It
  is one control now: a pane whose pages do not line up with the pages beside
  them is half of what the second column is for, and reaching for another
  switch to get the other half was a step between the reader and the thing they
  opened the pane to do. Closing the pane puts every page back the moment it is
  switched — its own font, size, width and leading, every line where it flows.
  One thing the grid costs, and it is worth knowing: the **citation underlines
  are off while the pane is open**, being strips measured off lines the grid
  has moved. The **§ Authorities** panel still lists every authority in the
  document and its links still open, and the status bar says so; the underlines
  come back the moment the pane closes. What follows describes the grid.
  **The sheet is never wider than the page you are set to.** The scale comes
  from the type — the PDF's body drawn at the reading size — and on a filing
  set in large type, or at a large reading size, that asked for a sheet half
  again as wide as the page you chose and a document you had to scroll
  sideways to read. Your width caps it: past that the page is drawn at your
  own width and the scale follows the sheet, so the grid inside it still lands
  on the PDF, and the status bar says so.
  **The top margin is the PDF's, not the export's.** PDF-Linker writes a
  page's top margin as blank lines above its first line, and those used to be
  stacked at the head of the sheet a line's height apiece, pushing line 1 and
  everything under it down the page — a band of white above the text that the
  PDF beside it does not have — while the blank lines under the last line
  grew the sheet past its PDF page. An empty line (no words, no margin number)
  now takes no room on the grid, so the first line stands where the PDF's
  does and the two sheets are the same height. A page with no grid to lay
  its lines on (a scan with no text layer) hides those leading blank lines
  while the pane is open — they are still in the file and still saved — and
  starts its text where the PDF's first printed line is, or an inch down
  where the PDF cannot say.
  **A line too long for the page comes back onto it.** The reader's font is
  not the filing's, and the same characters set in it run a little wider than
  the column the PDF gave them; past the sheet's edge they are gone, and the
  sheet no longer grows past the width you chose. Where the row has blank
  space **in front of** the text — the indent the PDF put it at — the line
  slides back into it, by what it overruns or by what the indent has to give,
  whichever is less. Its top never moves, so it still stands beside its own
  row; the indent is what gives. Whatever is still past the edge after that is
  cut off there. Pleading paper — whose lines all start at the body margin
  with the numbers in front of them — has nothing to give and is cut at the
  edge like any other. **One scale for every page of a filing.** The scale is
  the PDF's body type drawn at the reading size, and the body was read off
  each page on its own — so an exhibit's **title page**, which carries
  "EXHIBIT A" and nothing else, was drawn to put a 36-point heading at fifteen
  pixels: a quarter-size sheet with the PDF beside it shrunk to match, and any
  two pages of one filing at two sizes wherever their type differed. The body
  is read over the **whole PDF** now. A title page is the size of the pages
  around it and shows a large heading on it, the way the PDF does. **And the
  two columns are boxes, not just pages.** A page's height comes from the same
  arithmetic the bitmap is drawn by, so a height rounded one way and a canvas
  rounded the other cannot put a pixel between them — a pixel a page is a
  centimetre by the fortieth, one column sliding under the other with nothing
  visibly wrong on either. Where a line pushed past the PDF's own foot makes
  the text page taller than its PDF page (an export's footer or stamp below
  the last numbered line), **the slot grows with it** rather than the columns
  parting; the bitmap keeps its size and the box is held open under it. The
  page labels are levelled to the taller of the two for the same reason. **A
  text page with no PDF page keeps the pane level with it.** A combined file
  always has two kinds: its own list of the documents in it, at the top, and a
  banner page before each member. Each of those used to stand beside a stub of
  a slot — a 580px contents page against a 16px strip, a 148px banner page
  against 30px — so the two columns were out of step from the first page and
  ran three thousand pixels apart over a case's worth of documents: the PDF
  never sat beside the text being read, whichever side was scrolled. Such a
  slot now takes its text page's own height and its own anchor, nothing to
  show but the same amount of it, and the contents page's slot says what it
  is. The columns sit level to within a pixel at every scroll position, from
  either side. A page with no numbers (an exhibit, a letter, an order) is laid
  out on the PDF's printed **rows** instead: each text line is matched to the
  row carrying its words and takes its top and left, so paragraphs and
  headings sit where the PDF's do. **The size is the zoom, and the PDF's type
  sets the text's.** A page is a page: the type keeps its own spacing at any
  size, the way a PDF does. The reading size is the size of the *body* type —
  the PDF's body drawn at that size fixes the scale, and the sheet, the grid,
  the margins and the PDF page beside it are all drawn at it, so the two are
  one size to the eye at any zoom without a hand adjustment — and where the
  PDF's type varies, each line takes its own row's size: a heading larger, a
  footnote or an exhibit's small print smaller, so a page of tight rows fits
  them. (The leading setting has no say here; the PDF's rows are the leading.)
  Setting the size up **grows both sheets** instead of pushing the lines
  together. A page too wide for its pane runs past the edge with a horizontal
  scroll bar under it, and a line too long for the PDF's own column is never
  wrapped either: the sheets widen by what the longest one needs. Each pane
  scrolls sideways on its own — the text sheet is wider and its margins are
  not the PDF's. **Never on top of itself:** where the PDF's own rows sit
  closer than a line of type is tall (a scan's text layer, a signature under
  its rule) the line is pushed down to clear the one above, a line out of
  register with the PDF and legible — reading the text beats lining it up. The
  two panes scroll together, anchored on each page's first printed line. **The
  PDF's text is selectable and copies**, in the pane and on a swapped-in page:
  drag from the margin, from the space before a word, or let go after the
  period — every point snaps to the nearest character on its own row, so the
  clipboard carries the passage under the pointer and never the line numbers
  down the side (they are blanked in the text layer, as the PDF viewer blanks
  them); a double click takes the word, a triple the row. Display only — the
  layout lifts when the pane closes; remembered. **The members' PDFs open one
  at a time, in the order the file lists them.** A combined export names two
  dozen documents, each with a PDF of its own, and asking for them all as the
  pane is built meant two dozen files read whole, parsed, every page measured
  and its text read for the line grid, all at once and all competing, before a
  single page could be looked at — about a second and a half on a 21-document
  case before anything was drawn, now a quarter of one. They go through a
  queue: one document at a time, the first member's pages ready while the
  twenty-first waits its turn, and whatever the reader has actually scrolled
  to **jumps ahead of the rest** (a page coming into view moves its PDF, and
  the reading of its grid, to the front). A page is worth seeing before it is
  worth aligning, so each PDF's line grid is read after the documents already
  waiting, and the pane re-aligns as it lands. With it off, a page whose text
  is not worth reading (an exhibit the OCR mangled) is **swapped**: the **⇄
  PDF** button on the page's label shows the PDF page in the text's place, the
  rest staying text, and **⇄ PDF pages…** takes a run — `5, 12-18` — of the
  export's own page numbers. The swapped text is hidden, not removed: a save
  still writes it, and ⇄ Text puts it back. Swaps are remembered per document
  by PDF page number. Rendered pages are dropped as they scroll far out of
  view, so a long PDF costs no more than the pages in reach.

- **Redact the PDF from beside the export.** With the pane open, **▬ Redact
  PDF** (the PDF group of the Tools panel) marks the case folder's own PDF and
  saves a flattened copy with what has to go blacked out. It is the same
  redaction the PDF viewer does, in the place the folder is actually worked:
  the export and the PDF are the same filing seen twice, and the reader
  already has the folder open, the key loaded and the PDF matched to the
  export, so nothing has to be opened in another tab and handed the key a
  second time. Opening the tool with a key loaded **sweeps at once**: every
  real value the key binds is proposed wherever it stands in the PDF — over
  **every page of it**, including the pages the export has no text for and the
  pages nobody will scroll to, because a copy is the whole document. It is the
  PDF's own text that is read, never the export's: the export was scrubbed and
  the PDF is the file that was not. And it is the reader's reading of the key
  — a value you have **kept** is one the review has already said is not this
  matter's to hide, so a sweep does not propose it. Anything the key cannot
  reach you mark by hand on the pages in the pane: **the text** a drag covers,
  or **an area** for a signature, a photograph, an exhibit stamp. Every box is
  a proposal — translucent, the words legible under it, dashed where the key
  proposed it and solid where you drew it, and a click takes one back off.
  **Save redacted copy** writes a new file and never the PDF in the folder;
  what it writes is not the document with rectangles on it but page images
  with the boxes painted into the pixels, carrying no text layer, no
  annotations and no metadata — the rule and the reasons are under
  [Redaction](#redaction) above, unchanged. A `Combined Text.txt` shows a
  document per member, each with a PDF of its own, so the boxes are filed per
  PDF and the save writes **one copy per PDF that carries any**, each named
  through the key. Boxes outlast the document on screen — hopping between a
  folder's exports is how a folder is read — and are dropped when the case
  folder changes or you press Clear.

- **A long export opens in one go.** A `Combined Text.txt` carrying a whole
  case — a thousand pages, every citation in them underlined and every name
  from the key put back — is laid out, linked and highlighted in one pass,
  without Chrome offering to stop the page. Three things had made the open
  cost the square of the document's length rather than its length: the
  citation detector looked for a `", et al."` before each `v.` by scanning
  everything before it, and found the start of each line by scanning back
  over the line breaks it had already joined; the reader measured every page
  again for each citation on it, and drew each underline between two
  measurements, so the browser laid the whole document out again for every
  page; and a page's own `querySelector` walked that page's whole subtree,
  once per page, to find a button on it. Each is now done once, a window or a
  carried position rather than a scan, and every measurement is taken before
  the first underline is drawn. A thousand-page export that took half a
  minute opens in about four seconds, with byte-identical underlines, links,
  Table of Authorities, pseudonyms and counts. `node test-long-export-scan.mjs`
  holds the detector's cost to the document's length.

The decisions live in `viewer/textdoc.js` (the page model, the DOM-to-disk
walk, the values file), `viewer/pseudo-key.js` (the key, a port of the
Claude extension's `src/pseudo.js`) and `viewer/pdfsync.js` (which PDF an
export came from, page ranges, where "the same place" is in two scroll
boxes), with `viewer/xlsx-read.js` reading the workbook;
`viewer/leaks.js` (the LEAKS worksheet: rows by header, what a Fix? cell
means, where a row points) and `viewer/xlsx-write.js` (the Fix? cells
written back into the same workbook, every other part copied through);
`node test-textdoc.mjs`, `node test-pseudo-key.mjs`, `node test-pdfsync.mjs`,
`node test-xlsx-read.mjs`, `node test-xlsx-write.mjs`, `node test-rules.mjs`
and `node test-leaks.mjs` cover them, and `node test-long-export-scan.mjs`
covers what a long export costs to scan. `test-rules.html`, opened over http,
reads the drawn boxes' geometry back out of a page.

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
viewer/rules.js                      Text reader's box-drawing glyphs drawn as boxes (column grid pure; test-rules.mjs)
viewer/pseudo-key.js                 pseudonym_key.xlsx reader + fake↔real swaps (pure; test-pseudo-key.mjs)
viewer/xlsx-read.js                  Minimal .xlsx reader (pure; test-xlsx-read.mjs)
viewer/xlsx-write.js                 Writes cells back into an .xlsx, the rest copied through (pure; test-xlsx-write.mjs)
viewer/leaks.js                      Text reader's LEAKS.xlsx model: rows, Fix? cells, where a row points (pure; test-leaks.mjs)
viewer/web-shim.js                   chrome.* shim for the hosted (PWA) pages
viewer/theme-boot.js                 Saved theme applied before first paint (viewer + reader)
viewer/viewer.css                    Page + textLayer + linkLayer styles
viewer/viewer.js                     PDF.js loader, two-pass renderer
viewer/autoscroll.js                 Auto-scroll engine + control bar
viewer/rotation.js                   Page rotation: angles, bar, geometry
viewer/redact.js                     Redaction: boxes in PDF points, a store per document, the key sweep's decisions, the copy's name (pure parts; test-redact.mjs)
viewer/pdf-edit.js                   PDF writing (pdf-lib): highlights, page plans, stamps, the flattened redacted copy
viewer/key-library.js                The pseudonym keys this browser has been shown — one library, reader and viewer
viewer/highlights.js                 Selection, highlight, context menu
viewer/citation-linker.js            Detection + URL resolution
viewer/footer-naming.js              Footer-derived naming rule engine
viewer/disambiguation.js             Cross-tab collision registry
viewer/reporters.js                  Reporter list (port of REPORTERS_RAW)
viewer/statute-codes.js              Code patterns (port of STATUTE_CODES)
viewer/federal-codes.js              C.F.R. / U.S.C. / named federal codes
viewer/code-tables.js                WL / Lexis search prefix tables
fetch-pdfjs.sh                       One-time PDF.js download
```
