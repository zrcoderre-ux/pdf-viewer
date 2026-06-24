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
- **Persistent highlighting** — select any text and release the mouse to
  apply a yellow highlight. Click an existing highlight to remove it.
  Highlights persist across zoom changes but vanish when the tab closes
  (no cross-session storage).
- **Zoom in / out** with the toolbar buttons.
- **Download** the original PDF with a smart filename (see below).
- **Open original** in Chrome's built-in PDF viewer (skips the linker).

## Citation links on claude.ai

The same citation engine also runs on **claude.ai**. When Claude mentions a
case, statute, or California rule of court in a response, the extension overlays
a clickable underline that opens it in your selected provider (Westlaw or
Lexis+) — handy when you're using Claude to find authority and want to pull the
source.

It's **non-destructive**: claude.ai is a React app, so the extension never
edits Claude's DOM. It draws thin, clickable underline strips in a separate
overlay layer and repositions them as the page scrolls or new text streams in.
The underline color reflects the active provider (blue = Westlaw, red = Lexis+),
and it honors the same provider toggle and `citation_repo.json` as the PDF
viewer. Text underneath stays fully selectable.

**Carry-forward inheritance:** a bare `§ N` / `section N` reference (no code
name of its own) inherits the most recently *named* code before it in reading
order. So after "Civil Code § 1671(b)", a later "§ 1671" links to Civil Code;
if "CCP § 664.6" is then named, a following "§ 664.6" links to the Code of Civil
Procedure. A bare section that appears before any code is named is left unlinked.
(The single-named-code case is just the special case where everything follows
one code.)

In addition to the in-text underlines, a **Table of Authorities** panel appears
in the right margin whenever at least one citation is found. It lists each
unique authority once, grouped into Cases / Statutes / Rules, as a regular blue
hyperlink on the citation text itself (opening Westlaw or Lexis+). The panel can
be minimized to just its header bar and maximized again, and **resized** by
dragging the grip in its bottom-left corner; the minimized state and custom
dimensions are remembered.

## Smart PDF Naming

The extension supports two filename-source modes, set on the Options page
(right-click extension icon → Options → "Default filename source"):

- **Source filename (default).** Uses the original filename as the
  server / URL / Content-Disposition supplies it. No transformation.
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
- `In re` cases (separate pattern, no `v.` anchor).
- `Cal. Rules of Court` / `California Rules of Court`, `rule` or `rules`,
  with nested subsections.
- Both **CSM** and **Bluebook** case forms — chosen by whichever tail
  pattern matches first within 200 chars after the `v.` anchor.
- Pin-cite ranges including em-dash forms (`, 110-12`, `, 110–12`).
- Document-wide supra resolution using **first-seen** short name (matches
  `setdefault` semantics).
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
maps citation keys to hand-verified URLs. The extension supports the same
file: load it on the **Options** page (right-click extension icon → Options).
The repo is stored in `chrome.storage.local`. Resolution priority matches
the Python:

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

## What it does not do

- It does **not** write a `*_linked.pdf` file. (That's the whole point of
  the extension version.) Keep using `pdf_linker.py` if you need a
  permanent linked PDF.
- It does **not** OCR PDFs without a text layer. The Python script can,
  via Tesseract; the extension assumes PDFs are already OCR'd.
- It does **not** run any code on remote servers. Everything happens
  locally in the browser. The only network requests are the PDF fetch
  itself and any Westlaw / Lexis link the user clicks.

## Files

```
manifest.json                        MV3 manifest
background.js                        webNavigation -> viewer redirect
popup.html / popup.js                Toolbar popup (provider toggle + legend)
options.html / options.js            Options page (provider + repo upload)
viewer/viewer.html                   PDF viewer shell
viewer/viewer.css                    Page + textLayer + linkLayer styles
viewer/viewer.js                     PDF.js loader, two-pass renderer
viewer/citation-linker.js            Detection + URL resolution
viewer/footer-naming.js              Footer-derived naming rule engine
viewer/disambiguation.js             Cross-tab collision registry
viewer/reporters.js                  Reporter list (port of REPORTERS_RAW)
viewer/statute-codes.js              Code patterns (port of STATUTE_CODES)
viewer/code-tables.js                WL / Lexis search prefix tables
fetch-pdfjs.sh                       One-time PDF.js download
```
