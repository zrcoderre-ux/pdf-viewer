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

The copy is named for the document it came from, the way PDF-Linker names
its text export: underscores and hyphens become spaces, the name is run
forward through the key where one is loaded, and it is marked redacted either
way. `Rasho v Quillmark - MTC.pdf` is saved as
`Strangeways v Melbury MTC (redacted).pdf`, and `Helen_Rasho_Decl.pdf` as
`Ingrid Strangeways Decl (redacted).pdf`. Names run together are read too:
`HelenRasho Decl.pdf` becomes `IngridStrangeways Decl (redacted).pdf`. A value
the key spells with a hyphen or an underscore is found however the name
separates its words, and faked whole: `Mary Kate_Olsen Decl.pdf`, where the
key binds `Mary-Kate Olsen`, is saved as `Ruth-Ann Pell Decl (redacted).pdf`,
and `23_cv_01234 Order.pdf` as `23-cv-05678 Order (redacted).pdf`.
Re-redacting a redacted copy marks it once, not twice.

**The name hides what the pages hide.** After faking, the name is checked for
anything the key binds, and where a real value would still stand in it — a
name welded to another word (`RashoDecl.pdf`, `RASHODECL.pdf`,
`Rashodecl.pdf`, `Rasho2023.pdf`), a possessive written without its
apostrophe (`RASHOS OPP.pdf`), a long name or a case number inside a word or
spaced out (`25STCV59720Complaint.pdf`, `25 STCV 59720 Complaint.pdf`), a name
typed without its accents or its apostrophe (`Jose Garcia`, `OBRIEN`,
`ObrienDecl`), a long surname run into a word (`KowalczykDecl.pdf`), a
name's words in another order or around an initial, where a word of it would
stand beside a pseudonym or the whole name would stand (`Rasho_Helen_Decl.pdf`,
`Helen M. Rasho Decl.pdf`, `Vrba, Tomas Decl.pdf`), an e-mail address spelled
otherwise than the key spells it, a value the key holds an instruction for
rather than a pseudonym — the copy is saved under a neutral name instead,
such as `document 3fa9c1 (redacted).pdf`. The same document always gets the
same neutral name. An e-mail address in the name is
faked whole, underscores and all: `Letter to helen_rasho@rashofamilylaw.com.pdf`
is saved as `Letter to quenby3@postbox9.org (redacted).pdf`.

The check errs toward the neutral name. With no dictionary to consult, a
capitalised word with a party's short name inside it is read as the name:
`Marketing Plan.pdf` in a matter with a party named Mark is saved as
`document … (redacted).pdf`; rename the copy yourself if you need a better one.
Three shapes are not caught: a short name run into another word with no
capital in the name itself (`rashodecl.pdf`, `Declrasho.pdf`, an e-mail
address typed without its `@`); a name of three letters or fewer run into
another word with no change of case to part it (`LEEDECL.pdf`, `Leedecl.pdf`
— `LeeDecl.pdf` is caught); and one word of a longer name standing alone
where the key binds only the whole name (`Vrba Decl.pdf` for `Tomas Vrba`) —
look at the name the Save dialog offers before you share the copy.

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
it and reported success.) In the PDF viewer, text turned across the page — a
diagonal watermark, a large stamp — is not boxed from a selection: its box is
the square around it, which covers the body text under it too. The tool says
so when a selection holds some, and lets that selection go; an area drag
covers it. A viewer drag that marks text and begins in blank space marks what
a selection from there takes (see Viewer features): begun under a running
footer that the PDF wrote before the body and dragged up, it marks the body
above the pointer too. Check the boxes before applying, or begin the drag on
the first word.

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

**Turned pages are marked where they are drawn.** A landscape exhibit, or a
page somebody turned in Acrobat (the file's own `/Rotate`), is swept, dragged
over and screenshotted where its words are on the page you see — in the text
reader this was not so until the reader's text layer was turned with the page,
and a sweep stored its box on the wrong part of the page while the check said
the name was covered. Two things are worth knowing. A page whose text runs
**sideways** on screen (portrait text on a page turned a quarter) is read in
columns rather than lines, so a name on it may be boxed only in part; the check
reports it as not found, and an area drag over it is the answer. The same goes
for a page set at a slant, even of under a degree, where a name stands in a
short run of its own at the far end of a line (a service list's right-hand
column): the sweep may box its first name alone, and the check reports the
rest. A screenshot
of the PDF pane leaves such a page out whole when a name is on it. And should a
page's text ever not stand over the page as it is drawn, the reader marks
nothing there rather than mark the wrong place: the sweep's message names the
page to be marked by hand, the check walks its values with that reason, a drag
on it marks the area drawn, and a screenshot leaves that page out.
