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
