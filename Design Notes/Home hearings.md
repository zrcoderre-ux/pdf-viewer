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

The pill says PDF-Linker's status where a folder is found (below), else **Zip in
Downloads**, **Files in Downloads**, or **Not downloaded**. A click opens the case folder in one
reader, or, not downloaded, the case in eCourt; the **eCourt** button opens it
either way.

## The list

From today on, unmarked, by date, grouped under their days, at most
`HEARING_ROWS_MAX`; the summary counts the hearings to work up, the downloaded
and the not. **Show done and off** adds the marked rows, set apart and struck
through. Past hearings are not listed.

**An old Order Template Input sheet is no sign (2026-11-18).** The E-Court
Export leaves `Order_Template_Input_<case number>.xlsx` loose in Downloads,
where its Word macro looks for it, and it stays there once that motion is
worked up. The owner: get rid of the Files in Downloads detection for those
"more than 2 days old", since one is most likely left over from a previous
motion in the same case: its case number matches, but it says nothing of this
hearing's papers. `looseFileCounts` (`ORDER_TEMPLATE_RE`, `LOOSE_STALE_MS`):
`downloadsIndex` reads the time of those sheets only, and leaves out one more
than two days old (or one whose time cannot be read). Every other loose file
counts at any age.

## One list: the hearing carries its case folder (2026-11-18)

The owner: "lets integrate the Hearings and Casefolders. Move Casefolder up to
the top, and only if there are some that don't match (ideally this will never
happen) then add the word, log to share and prioritize buttons to the hearings
instead." So a hearing whose case folder is found IS that folder's row:

- `hearingItems` matches every hearing on the list (the unmarked ones from
  today on, or all of them with **Show done and off**) before the folders'
  statuses are read. A Downloads folder it matches that the Case folders list
  did not hold (not today's, not opened here) joins the look's `rows`, so its
  status, place in PDF-Linker's line and run start are read like any other.
- The hearing's pill is PDF-Linker's status (`statusText`), its second line
  names the folder (and a run's start, `runningSub`), its icon is the folder's,
  and it carries the folder's own buttons (`folderControls`: Word, Log to
  share, Prioritize or its place with ▲ ▼ ✕, Take over). Only the first
  hearing of a case carries them, so a case heard twice shows its line
  controls once. A hearing with no folder keeps the pill of where its case
  stands (Not downloaded, Zip in Downloads, Files in Downloads), and one marked
  green or red says Done or Off calendar.
- **Case folders** now stands above the hearings and lists only the folders no
  hearing on the list is matched to (headed "Case folders not on the hearings
  list"): a folder whose hearing is past or marked done or off, one whose case
  is not on the sheet, one the matching missed. Each still says its hearing
  where the sheet has one (`hearingForPlace`: the next for its case, else the
  latest before, "(done)" or "(off calendar)" where marked) and carries an
  **eCourt** button where the sheet links it. It is hidden when there is none,
  and lists every folder, as before, while no sheet is linked.
- PDF-Linker's line is every row in line, not only those the Case folders list
  shows (`line`, `lineShown`), and `rowsShown` holds both lists' rows, so ▲ ▼ ✕
  on a hearing row move the same line.
- The Downloads link moved into the Hearings heading ("Link Downloads…"),
  since the Case folders list may be hidden and Downloads serves the matching.

## Off calendar and On calendar (2026-11-18)

The owner: "Add off calendar and on calendar toggles. These would change the
color of the excel sheet accordingly." Each hearing row carries **Off
calendar** (or, on a row marked off, **On calendar**). `markHearing`
(hearing-sheet.js) rewrites only `xl/styles.xml` and the row's sheet,
copying every other part through (`xlsx-write.js`, `replaceParts`):

- The row is found afresh in the file as it now stands, at its row where its
  case name still stands there, else by case name and date in that sheet;
  neither, and the change is dropped with a word.
- **Off** fills the Date, Motion Type, Case Name and Date Submitted cells (a
  missing one is added, empty), and any other cell of the row already marked,
  with the red the sheet's own off rows use (the first fill `markOfColor`
  reads as off), else a plain FF0000 added once. **On** takes the off fills
  off every cell of the row and off the row's own style, and leaves any other
  fill be (a yellow highlight stays).
- A new cell style is a copy of the cell's own `<xf>` with only `fillId` (and
  `applyFill`) changed, so a date keeps its number format and a link its font;
  an identical style already there is reused.

**Excel holds the file.** Windows refuses another program's write to a
workbook Excel has open. So a toggle is an EDIT, kept in the folders database
(`places` → `"hearingEdits"`) and written at once where it can be
(`writeEdits`, asked for write leave on the click). Refused, it waits: the
list shows the row as marked (`withEdits`, a dashed pill), the summary says
how many changes wait for Excel to close the sheet, and every look (`loadSheet`,
with the leave already given) tries again, applying the change to whatever
Excel saved meanwhile. Tested by refusing `createWritable` and letting it
through.

## Notes in the Date column

The owner: "I sometimes write notes in the date column next to the case. Those
should get an * that expands when clicked." `dateNote`: the Date cell's text is
a note where it holds words beyond a date (month and day names and ordinals
are a date's own words). The row takes the date the note names ("Continued to
1/5/27"), else the one above it, else is listed under "No date"; only a plain
date is passed down to the rows below. The row shows a * after the case name
(inside the row's button, its click its own); a click opens the note under the
row and a second closes it, and which are open survives redraws (`notesOpen`).

Tests: `test-hearing-sheet.mjs` (the rules in node over a workbook built with
`viewer/zip.js`; the list in the assembled site over an OPFS Downloads).
