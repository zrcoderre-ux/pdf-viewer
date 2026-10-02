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
