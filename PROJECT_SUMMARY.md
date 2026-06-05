# Legal Citation Linker — Project Context

A Chrome MV3 extension that intercepts PDF navigations, renders the PDF in a
bundled PDF.js viewer, detects legal citations (CA Bluebook + CSM), and
overlays clickable underlines that link to Westlaw or Lexis+. Faithful port
of an earlier Python script `pdf_linker.py`. The extension folder layout,
build steps, and feature list are in `README.md`; the citation grammar is
documented inline in `citation-linker.js`.

## Architecture in one paragraph

`background.js` uses declarativeNetRequest dynamic rules to redirect PDF URLs
to `viewer/viewer.html`. `viewer.js` loads PDF.js (4.6.82, downloaded by
`fetch-pdfjs.py` into `pdfjs/build/`), renders each page in two passes
(canvas + text layer), then calls into `citation-linker.js` to place
overlays in `linkLayer` and `highlights.js` to wire up text-selection
behaviors. Footer-derived naming is handled by `footer-naming.js` (rule
engine), `disambiguation.js` (cross-tab collision registry over
`chrome.storage.session`), and `naming-override.js` (per-document override).
Provider toggle, naming mode, repo upload, and extra URL patterns live in
`options.js`, `popup.js`, and the viewer toolbar with `chrome.storage`
(sync for global prefs, session for per-doc overrides and cross-tab
registry, local for the citation repo). Per-provider URL builders are in
`code-tables.js`.

## Fixes applied in earlier sessions

All in `viewer/` unless noted. Each fix is documented inline at the call
site — read the comments there for the why, not just the what.

1. **viewer.css** — selection was invisible (and Chrome showed the no-drop
   cursor) because `.textLayer` had `opacity: 0`, which forced its
   `::selection` highlight to 0% alpha too. Replaced with transparent
   `color` + `caret-color`. Also added missing `#hl-ctx-menu` styles (the
   context menu was being created without any CSS).

2. **highlights.js** — right-click menu now offers Copy + Highlight on a
   selection (was Highlight only) and Remove on an existing highlight rect.
   On `mouseup` in normal mode, the same menu auto-appears near the cursor
   if a non-empty selection exists inside the page's textLayer. The
   ✏ Highlight toolbar toggle still bypasses the menu and converts
   selection straight to a highlight.

3. **citation-linker.js — `rectsForRange`** — the original code mapped
   citations to spans via `allSpans[itemRanges[k].itemIndex]`, but PDF.js
   4.x's TextLayer drops/folds/separates items relative to
   `textContent.items` (it emits `<br>` for EOL items, skips zero-length
   items, etc.), so the index mapping drifted further down the page with
   each skipped item. Symptom: links landed paragraphs below the actual
   citation, drift growing with page depth.

   Rewritten to ignore item indices entirely. Concatenates rendered span
   text into `domText` (with a single space inserted between adjacent
   spans — critical for citations that cross line breaks or span splits),
   normalizes whitespace, finds the citation's literal text directly,
   uses the joined-text offset only as a positional hint to pick the
   right occurrence when the same phrase appears more than once.

   Three additional features on top of the rewrite:
   - **Per-page `consumedDomStarts` Set**: when the same citation appears
     N times on a page, each `documentCites` entry binds to a different
     DOM occurrence so all visual occurrences get linked (not just one).
   - **Inter-span space insertion**: see above; lets "Civil Code" +
     "section 3287(a)" across spans match the needle "Civil Code section
     3287(a)" after whitespace normalization.
   - **Distinctive-substring fallback** (`extractDistinctiveSubstring`):
     if the full needle still finds zero matches (unusual whitespace,
     ligatures, soft hyphens), retry with just the section identifier
     (`§ 3287(a)`, `13 Cal.App.5th 1152`, `rule 3.1300(a)`, `9 U.S.C. § 1`,
     etc.). Underline is shorter than ideal but the citation gets linked
     rather than silently dropped.

4. **background.js** — LA Superior Court eCMS exposes both a PDF endpoint
   and an HTML in-portal viewer under `/ecourt/ecms/`; the built-in glob
   `ecms/doc*` matched both, hijacking the HTML viewer. Added
   `buildEcmsImageAllowRule` (priority 100, action `allow`) that lets
   `https://civil.lacourt.org/ecourt/ecms/document/image…` pass through
   unmodified.

5. **viewer.css** — toolbar `position: sticky; top: 0` wasn't sticking
   because `#viewer-container` had its own `overflow: auto`, creating a
   nested scroll context the toolbar couldn't see. Moved scroll to
   `<body>` (`overflow-y: auto`), removed it from the container. Sticky
   behavior now works as originally intended.

## Naming system (current session)

The viewer can name documents two ways:

- **Source mode (default).** Filename comes from the server / URL /
  Content-Disposition. No transformation. This is what most legitimate
  PDFs already provide.
- **Footer mode.** Reads the document title printed at the bottom of court
  filings, runs it through a rule engine in `footer-naming.js`, applies
  cross-tab disambiguation when sibling tabs would collide on the same
  canonical name.

### Three layers of control

| Layer | Storage | UI surfaces | Scope |
|---|---|---|---|
| Global default | `storage.sync.namingMode` | Popup + Options page | All viewer tabs that don't have a per-doc override |
| Per-document override | `storage.session.naming-override:{url}` | Viewer toolbar dropdown | Only the document at that URL; survives tab reload, dies on browser close |
| Effective mode | (derived) | What the toolbar actually shows | `override ?? global` |

The toolbar dropdown always mirrors the effective mode. Picking something
in the toolbar creates a per-doc override; until then the toolbar tracks
the global.

### Footer-naming rule engine (`footer-naming.js`)

Pipeline:

1. Normalize whitespace and curly quotes.
2. Capture case-caption party from a `X v. Y` tail and strip it. The
   captured party (e.g. `Hopkins`) is used as a Complaint disambiguator.
3. Strip case-number noise (`CASE NO. ...`) and trailing damages
   descriptive blobs (`for compensatory, punitive, ... damages`).
4. Collapse `Notice of Motion and Motion ...` to plain `Motion ...`. Bare
   `Notice of Motion for X` is preserved as its own type (a procedural
   notice).
5. Non-destructively capture the filing-party label from the leading
   possessive: `"Defendant Pacific Insurance's Demurrer"` → `"Pacific Insurance"`;
   `"Plaintiff's Complaint"` → `"Plaintiff"`; `"Receiver's Opposition"` →
   `"Receiver"`. Used as a disambiguation qualifier.
6. Walk the RULES list to identify the document type. Rules examine the
   full (still-possessive-prefixed) string and anchor on document-type
   keywords directly. Outermost wrapper wins.

Rule order (outermost wrapper first):

```
Declaration > Reply > Opposition > Demurrer > Notice of Motion >
Ex Parte Application > Motion > Petition > Amended Complaint > Complaint
```

Order constraints that matter:
- Declaration before everything else (a `Decl. ISO Reply` is a
  declaration, not a reply).
- Reply before Opposition (a Reply's title contains `Opposition to ...`).
- Notice of Motion before Motion (`Notice of Motion for X` contains
  `Motion for X` as substring).
- Ex Parte Application before Motion (parallel structural overlap with
  `for X`/`to X` forms).
- FAC/SAC/TAC before Complaint (they contain `complaint` as substring).

Canonical types collapse aggressively. Standalone titles are bare:
`Motion`, `Demurrer`, `Opposition`, `Reply`, `Petition`, `Complaint`,
`Notice of Motion`, `Ex Parte Application`. The specific variant
(`Mot. to Strike`, `Demurrer to SAC`, `Opposition to Demurrer`) only
appears as a disambiguation qualifier when sibling tabs collide.

`extractTitle(raw)` returns `{ canonical, target, party, partyLabel, raw }`.

Insurance check: if input mentions `DECLARATION` or `DECL.` but a
non-declaration rule matched, recover a `{Last} Decl.` label rather than
mislabeling. Belt-and-suspenders against future rule edits.

### Cross-tab disambiguation

`disambiguation.js` writes each viewer's parsed footer attributes to
`chrome.storage.session` under a per-tab key. All viewer tabs subscribe
to changes and recompute their displayed name when siblings update.

`disambiguate(entries)` walks a 3-level ladder for colliding groups:

1. **Target only** — `Demurrer to SAC`, `Opposition to Demurrer`,
   `Mot. to Strike`.
2. **PartyLabel only** — `Receiver's Opposition`, `Pacific Insurance's
   Demurrer`, `Plaintiff's Motion`.
3. **Both** — `Receiver's Opposition to Ex Parte App.`

The algorithm stops at the first level that makes every entry in the
group unique. An entry with neither target nor partyLabel stays bare at
every level; its informed siblings move. Two bare entries that collide
remain visually identical (no synthetic numeric suffix) — the user
renames manually.

Exceptions to the ladder:
- Declarations and FAC/SAC/TAC are already distinct by name/ordinal; no
  ladder applied.
- Complaints use case-caption party (not partyLabel) as the qualifier:
  `Hopkins Complaint` vs `Complaint`.

Stale entry sweep: on `registerEntry`, the module enumerates all
`titledoc:*` session keys and removes any whose tabId no longer
corresponds to an open tab. Cheap because session storage is small.
`beforeunload` also unregisters; sweep is belt-and-suspenders.

### Per-document override (`naming-override.js`)

Tiny module: `getOverride(fileUrl)`, `setOverride(fileUrl, mode)`,
`onOverrideChange(fileUrl, cb)`. Keys session storage by file URL. The
toolbar dropdown is the only writer; the popup and options page write
only to the global key.

### State management in viewer.js

Three name variables coexist:
- `globalNamingMode` — mirror of `storage.sync.namingMode`
- `perDocOverride` — `getOverride(fileUrl)` result, null when unset
- `namingMode` — effective mode, derived as `perDocOverride || globalNamingMode`

`resolveEffectiveNamingMode()` recomputes the effective mode after any
layer changes; if it changed, `applyNamingMode()` re-paints the toolbar.

`setDisplayName` now takes an `origin` tag (`"source"` or `"footer"`)
and caches both forms separately. Flipping naming mode swaps between
them with no re-extraction.

Footer extraction (`tryResolveFooterTitle`) always runs regardless of
mode — the structured result is needed for the disambiguation registry,
and toggle-flipping should be instant.

## Things to know before changing code

- **No browser storage in artifact-style limits here**; this is a real
  Chrome extension. `chrome.storage.sync` for global prefs/patterns,
  `chrome.storage.session` for per-doc overrides and cross-tab
  disambiguation, `chrome.storage.local` for the citation repo.
  Highlights are intentionally in-memory only (closes-with-tab); the
  README documents this.
- **PDF.js version is pinned** in `fetch-pdfjs.py` (currently 4.6.82). The
  rectsForRange rewrite specifically works around 4.x TextLayer behavior.
  If upgrading PDF.js, re-verify the placement logic against a long
  document.
- **The citation-detection layer is a line-by-line port of `pdf_linker.py`**
  and has been validated citation-for-citation. Don't refactor regexes
  without a side-by-side diff against the Python.
- **The footer-naming rule engine is NOT a port** — it's a new design
  derived from a 14-example spec and refined across conversation. Tests
  in `test-naming.mjs` cover 41 extraction cases + 15 disambiguation
  scenarios. Run with `node test-naming.mjs` from the extension root.
  Edit rules with the tests open; new behavior should come with a new
  test case.
- **The legacy `simplifyName` function in viewer.js is still present**
  as a fallback when the new rule engine returns `canonical: null` (for
  exotic cover-page titles outside the canonical vocabulary). Don't
  remove it without auditing what footers it currently saves.
- **Both Westlaw findType=Y and Lexis pdsearchterms expect a bare reporter
  cite**, not the full key. `caseReporterCite` and `disambiguatedLexisTerm`
  in `code-tables.js` extract the right form; see comments there.
- **The extension does not OCR.** PDFs without a text layer get rendered
  (canvas works) but produce no citations, no footer extraction, no
  selectable text. The README documents this. If OCR is needed,
  Tesseract.js (WASM) is the path — render-to-canvas already happens,
  synthesize a text layer from OCR output, feed into existing pipeline.
- The previous session also briefly chased red-herring theories about
  PDF.js's `round()` CSS, `pointer-events` on `.highlightLayer`, and a
  missing `.highlightLayer` CSS rule. The actual fix in each case was
  different from the initial theory — diagnose with DevTools rather than
  jumping to plausible-sounding CSS fixes.

## Known good test cases (use these to spot regressions)

Citation linking:

- "Civil Code sections 3287(a) and 3289(b)" — both should link, with
  distinct underlines.
- "Civil Code" at end of one line / "section 3287(a)" on the next — should
  link (tests inter-span space repair).
- "§ 425.16" mentioned multiple times on one page — every occurrence links.
- Smith v. Jones-style case cites with `(2017) 13 Cal.App.5th 1152` tails —
  link should land on the case name, not somewhere else.
- eCMS `https://civil.lacourt.org/ecourt/ecms/document/image?…` URL — opens
  in the portal's viewer, not in our PDF viewer.
- Direct `.pdf` URL or eCMS PDF endpoint — opens in our PDF viewer with
  citation overlays and selectable text.

Naming (run `node test-naming.mjs` for the full set):

- `Plaintiff's Complaint for Damages` → `Complaint`
- `SECOND AMENDED COMPLAINT` → `SAC`
- `PACIFIC INSURANCE'S NOTICE OF DEMURRER AND DEMURRER TO PLAINTIFF'S SAC` →
  `Demurrer` (target: SAC)
- `Defendant's Reply to Opposition to Motion to Compel Arbitration` →
  `Reply` (target: `Opp. to Mot.`)
- `Notice of Motion and Motion to Compel Arbitration` → `Motion`
- `Notice of Motion for Summary Judgment` → `Notice of Motion`
- `RECEIVER'S OPPOSITION TO DEFENDANTS' EX PARTE APPLICATION` →
  `Opposition` (target: `Ex Parte App.`, partyLabel: `Receiver`)
- `DECLARATION OF OLIVIA BENNETT IN SUPPORT OF PLAINTIFF'S
  OPPOSITION TO ...` → `Bennett Decl. ISO Opp.`
- Two demurrers, one to SAC and one to FAC, open in two tabs → toolbar
  in each tab updates live to `Demurrer to SAC` / `Demurrer to FAC`.
- Three Oppositions (Receiver's to ex parte, Plf's to demurrer, Blue
  Shield's to ex parte) → `Receiver's Opposition` / `Plaintiff's
  Opposition` / `Pacific Insurance's Opposition` (level 2 of the ladder).

## Files

```
manifest.json                        MV3 manifest
background.js                        DNR redirect rules + eCMS exclusion
popup.html / popup.js                Provider toggle + naming mode + legend
options.html / options.js            Repo upload + extra URL patterns + naming default
fetch-pdfjs.py / .sh                 One-time PDF.js download
test-naming.mjs                      Node-runnable rule-engine tests
viewer/viewer.html                   Viewer shell (toolbar has naming-mode dropdown)
viewer/viewer.css                    Page / textLayer / linkLayer styles; body owns scroll
viewer/viewer.js                     PDF.js loader, two-pass renderer, naming plumbing
viewer/citation-linker.js            Detection + placement + URL resolution
viewer/highlights.js                 Selection, highlight, context menu
viewer/footer-naming.js              Footer-title rule engine + iterative disambiguator
viewer/disambiguation.js             Cross-tab collision registry (storage.session)
viewer/naming-override.js            Per-document naming-mode override (storage.session)
viewer/reporters.js                  REPORTERS_RAW port
viewer/statute-codes.js              STATUTE_CODES port
viewer/code-tables.js                WL / Lexis URL builders
pdfjs/build/pdf.mjs                  PDF.js main module (downloaded)
pdfjs/build/pdf.worker.mjs           PDF.js worker (downloaded)
```
