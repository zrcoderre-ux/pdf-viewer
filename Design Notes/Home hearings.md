# Home's Hearings list (`pwa/app-web.js`, `viewer/hearing-sheet.js`)

The owner (2026-11-18): "I want to change the pdf+ homepage into a central
hub ... integrate my excel sheet where I list the upcoming hearings under
these columns Date, Motion Type, Case Name, Date Submitted. I mark them green
when done and red if they are taken off calendar, or I otherwise don't have to
work on them ... it should attempt to match cases by the case number with
their row in Excel, and should indicate the download status ... It should also
add the corresponding dates from the excel sheet. That way I can tell at a
glance what I have downloaded and what I still need." And: "The cases are all
hyperlinked in the excel sheet, linking to E-court."

## The sheet

Linked once, as Downloads is (**Link hearings sheet…**, `showOpenFilePicker`,
the handle in the `pdfviewer-folders` database, `places` → `"hearings"`).
Read leave only: nothing writes to it. Each look (the case folders' own,
`CASE_RECHECK_MS`, and on focus) reads the File and parses it again only where
its size or time moved (`sheetSeen`), so a save in Excel shows on the next
look. A read that fails keeps the last one and says so (`state: "error"`). An
`.xls` is refused at the pick with a word to save it as `.xlsx`.

`readHearings` (`hearing-sheet.js`) reads the parts `xlsx-read.js` skips: that
reader is a port kept in step with another extension's and reads values only,
so this module uses its zip and shared-string pieces and parses the rest
itself.

- **Which sheets.** Every visible sheet whose first 20 rows hold a header row
  with a **Date** and a **Case Name** column (`headerColumns`: "Date" alone is
  the hearing date; any "submitted" heading is Date Submitted; "motion" the
  Motion Type). Each row under it with a case name is a hearing. A row with
  no date takes the one above it, as a list kept under a date written once
  does; a row with a date and no case name is such a heading.
- **Dates.** A number in a date column is an Excel serial (1900 or 1904
  system, `workbookPr date1904`); text is read as `11/20/2026`, `11/20`,
  `2026-11-20` or `Nov 20, 2026` (`textToDate`), else kept as text and listed
  last.
- **Marks.** The fill of the row's Case Name, Date or Motion Type cell, else
  the row's own style (`<row s= customFormat="1">`): styles.xml's `cellXfs` →
  `fills`, the colour given as rgb, a theme colour (theme1.xml, with its tint)
  or an indexed one. `markOfColor` reads the hue: green (70°–170°) is
  **done**, red or pink (325°–15°, Excel's "Bad" FFC7CE included) is **off**;
  yellow, orange, greys, white and black mean nothing. Conditional formatting
  and table styles are not read: a mark is a fill set on the cell or row.
- **The eCourt link.** The case name's own hyperlink (the sheet's
  `<hyperlinks>` through its rels), or a `HYPERLINK("…")` formula, else any
  other cell's link in the row; http(s) only (`isWebLink`). eCourt's case page
  is keyed by an internal id, not the case number, so the sheet's link is the
  only way Home can open the case. desktop/main.js trusts `civil.lacourt.org`,
  so PDF+ opens it in the browser without asking.
- **Case number.** The first in the case name, else the rest of the row, else
  the link's `caseNumber=` (`caseNumbersIn`: the E-Court extension's two LASC
  forms, spaces or dashes inside the year-first one tolerated).

## Where each case stands

`findPlace` matches a hearing against, in order of preference: the folders the
Case folders list holds (opened here, today's in Downloads), every folder in
Downloads, a zip in Downloads, and loose files in Downloads whose names carry a
case number (`downloadsIndex`: Downloads' own names only, no file opened, read
again every `DOWNLOADS_INDEX_MS`). With a case number, a place matches where
its name carries it, or, for the folders the list has read, one of its files
does (`listingNumbers`; the E-Court Export's "Register of Actions <case
number>.pdf" puts it in every case folder). Without one, by name: every
word of the folder's name that says which case it is (`nameWords`) stands in
the case name, two words at least. A Downloads folder with no case number in
its name is matched by its files only once it is in the Case folders list, since
reading every old folder of Downloads is what Home stopped doing for speed (Home
case folders.md, "In PDF+ only the day's folders are read").

The pill says **Downloaded** (a folder; the row's second line names it, with
PDF-Linker's status off `cachedListing`), **Zip in Downloads**, **Files in
Downloads**, or **Not downloaded**. A click opens the case folder in one
reader, or, not downloaded, the case in eCourt; the **eCourt** button opens it
either way.

## The list

From today on, unmarked, by date, grouped under their days, at most
`HEARING_ROWS_MAX`; the summary counts the hearings to work up, the downloaded
and the not. **Show done and off** adds the marked rows, set apart and struck
through. Past hearings are not listed.

## On the Case folders list

Each case folder's row starts its second line with its hearing
(`hearingForPlace`: the next one on or after today for its case, else the
latest before; "Hearing Fri, Nov 20 · Demurrer", "(done)" or "(off calendar)"
where marked) and carries an **eCourt** button where the sheet links it.

Tests: `test-hearing-sheet.mjs` (the rules in node over a workbook built with
`viewer/zip.js`; the list in the assembled site over an OPFS Downloads).
