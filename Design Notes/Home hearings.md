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

## Matched by name where a number cannot decide (2026-11-18)

The owner, on 0.2.88: "The consolidation didn't work ... I am still seeing
both the case folder and hearing entries for the same cases ... the word, log
share and prioritize buttons are still only on the case folders." The rule
was by case number alone wherever the sheet's row gave one, so a folder named
for its parties (no number in its name, no Register of Actions in it) matched
no hearing, stayed in Case folders with its buttons, and its hearing said Not
downloaded. Now (`placeMatches`) the numbers decide only where both sides have
one (and a place carrying another case's number is never the case); else the
names do (`namesMatch`): every word of the place's name that says anything
stands in the case name or the motion ("ACME Demurrer"), two of them the case
name's or one of four letters or more. A folder's own filler ("case", "copy",
"new", "motion") is no word. The hover now says the case number read off each
hearing, and on an unmatched folder the numbers it carries, so a miss can be
read off the screen.

## The Folders list: drag a case into a folder (2026-11-18)

The owner: "I want to add the ability to drag and drop them into another
folder straight from the hearings menu. Can you add a file explorer style
folder list to the left side?" And: "They should still remain in the Hearing
list until the hearing date has passed."

- **The list** (`#folder-tree`, left of Home; above it under 960px) holds
  Downloads once linked and the folders added with **+ Add** (handles in
  `places` → `"treeRoots"`, write leave asked at the pick; ✕ takes one off the
  list, nothing on disk changes). A folder opens a level at a time on a click;
  one whose name carries a case number is a case folder and opens no further,
  and is no drop target. Held over a closed folder for `SPRING_OPEN_MS`, a drag
  opens it. Redrawn only where it changed, and never under a drag.
- **The drag.** A row carrying a case folder (a hearing's, or one in Case
  folders) is `draggable`; dropped on a folder of the list, the move bar asks
  ("Move “…” into Filed › November?"), and **Move** moves it: the click is the
  one write leave is asked on, for the folder, the one holding it and the
  target. The shell's own file-drop overlay stands aside while a case is
  dragged (`caseDrag`).
- **The move** (`viewer/case-move.js`, `moveFolder`). Chrome moves FILES on
  the disk (FileSystemFileHandle.move(), Chrome 111) but not folders (the
  launch left directory moves out; MDN marks Chrome's move() partial), so a
  folder of the same name is made at the target and each file moved into it
  (on one drive, a rename), subfolders the same way, and the emptied folder
  taken away through the folder holding it, or its own remove(), else left
  (and said). Nothing is copied. Refused before anything moves where a file
  would land on another (`collisions`), into the folder itself or one inside
  it, where it already is, while PDF-Linker runs in it or a run looks stopped
  part-way, and while a reader tab holds it (`moveBlocker`, `inReader`). A
  move stopped part-way is finished by dragging it onto the same folder again
  (a same-named folder there is used, not a clash). Opened-here records of
  the folder are pointed at its new place.
- **PDF-Linker's launcher.** It records the folder's path (the Re-run token,
  and the run's own command line), so a moved folder's Re-run would ask
  PDF-Linker for the old place. In PDF+, main.js answers where the folder now
  is (`pdfplus:folder-path`: the list root's name, the folders from it down,
  and the launcher's name and size, answered only where exactly one place it
  knows fits) and the launcher is rewritten (`retargetLauncher`: the token,
  and every mention of the old path as a whole path, either slash, any case on
  Windows). In a browser the move bar says the launcher still names the old
  place.
- **Still on its hearing's row.** `treeIndex` looks through the list's own
  folders for case folders (each one's folders, and one level further under
  any whose name carries no case number: a folder per judge or month), names
  only, every `TREE_INDEX_MS` and at once after a move; `hearingItems` matches
  them as it matches Downloads, so the hearing keeps its folder, status and
  buttons ("… (in November)") until the hearing has passed.

Tests: `test-case-move.mjs` (the launcher rewrite and the refusals in node;
the move itself over OPFS: a Text Files subfolder with it, a clash refused, a
move finished, never into itself) and `test-hearing-sheet.mjs` parts 15–16
(the list, a drag onto a folder, the hearing keeping its folder, a move refused
while a run goes).

## Done and off folders, and the room for the name (2026-11-18)

The owner: "cases that are done and off don't need to be shown in the Case
Folders rows", and "the new Hearings section is too narrow, it basically only
shows the case number. Let's switch some of the buttons to icons to add more
room".

- **Case folders** leaves out a folder whose hearing (`hearingForPlace`: the
  next for its case, else the latest) is marked done or off calendar, in the
  sheet or by a toggle still waiting to be written, unless a run is going in
  it (`settledMark`): a run still wants watching.
- **Icons.** Word (`file-word`, with the count where there are several), Log
  to share (`file-text`), Prioritize (`chevrons-up`), Off and On calendar
  (`calendar-x`, `calendar-check`) and eCourt (`external`) are icon buttons
  (`iconise`), each keeping its name as its `aria-label` and the start of its
  hover. Take over keeps its words: it is rare and it ends a run. The tests
  read the labels.
- **Width.** Home's column beside the Folders list is no longer held to 760px
  (`.home-layout` up to 1340px), so the case name has the row.

## Done, two cells, a ✓; the status as a dot; several folders at once (2026-11-18)

- **Done.** The owner: "Add a button for me to indicate that I am done
  (turning the hearing type and case name cells green in the excel sheet (the
  off calendar should turn only those cells red.) There should be a checkmark
  next to it on the home screen indicating it is done." Each hearing row has
  **Done** (`doneButton`, a ✓; pressed again, **Not done**). `markHearing`
  now takes "done", "off" or "": done fills the Motion Type and Case Name
  cells green (the sheet's own green where it has one, else Excel's Light
  Green, 92D050), off fills those same two red, and either takes the other
  mark off the rest of the row and the row's own style; "" takes both off.
  The Date and Date Submitted cells are no longer coloured. A done hearing now
  STAYS listed, with a green ✓ before its name (`ci-done-mark`), until it has
  passed, and its pill says the folder's status as for any other; only one off
  calendar is set aside, behind **Show off calendar** (was Show done and off).
  The summary counts the done. Its folder is on its row, so Case folders never
  lists it.
  A done hearing with no folder found shows no pill at all (the owner: "If a
  case folder is done, remove the not downloaded button"): Not downloaded, Zip
  in Downloads and Files in Downloads say what is still to fetch, and a done
  case needs nothing fetched. One with a folder keeps its PDF-Linker dot.
- **The status as a dot.** The owner: "The finished time takes up too much
  space. It should be much smaller and expand to give that detail when
  pressed." PDF-Linker's status, on a hearing row and in Case folders, is a dot
  in its tone's colour (pulsing for a run going; `compactStatus`), opened to
  its words on a press and closed on a second, kept open across redraws
  (`statusOpen`). Where the case stands (Not downloaded, Zip in Downloads),
  Off calendar and Click to allow keep their words: they are what the row is
  read for. REVERSED 2026-11-20 ("The status in its words again", below): the
  status is spelled out again and `compactStatus` is gone.
- **Several folders at once.** The owner: "Can you make it so that I can
  select multiple folders to add at once? I can't add my entire OneDrive
  folder, because it holds system files." The folder dialog picks one folder,
  and Chrome refuses one holding system folders, but folders dropped on a page
  come as handles (`DataTransferItem.getAsFileSystemHandle`, asked for in the
  drop itself). So the folders selected in File Explorer are dropped on the
  Folders list (`addTreeRoots`): each added once, files and refused ones left
  out and said, and the shell's own file drop stands aside there.

## Find a case's folder from its hearing; the Folders list at the edge (2026-11-18)

- The owner: "Instead of clicking the case name for a not downloaded case
  sending me to e-court (I can use the ecourt button for that) it should let
  me try to locate the file (because I might have just moved it to another
  folder)." A click on a hearing with no folder found (Not downloaded, Zip in
  Downloads, Files in Downloads) asks for its folder (`locateCase`; the
  dialog's id "locate", so it starts where the last was found). The folder
  picked becomes that hearing's LINK, by its case number or else its case
  name's words (`linkKey`), kept in `places` → `"hearingLinks"` for
  HEARING_LINK_KEEP_MS (120 days) and looked at before any matching in
  `hearingItems`, whatever the folder's name. Refused: a folder carrying
  another case's number, and one with no case papers (`isCaseListing`). Then
  it opens as a found case does. A linked folder moved from the Folders list
  keeps its link. eCourt is only the eCourt button now.
- The owner: "move the folders menu to the left a bit more, everything is
  clumped up right now." The Folders list stands at the window's left edge,
  and the rest is centred in the room beside it (up to 1120px).

## Home as a workspace (the design review, 2026-11-19)

The owner asked for "a professional UI design review on the home page ...
what can you do to make it look easier on the eyes and more professional?",
on a large monitor (2560 wide), and then "Do all of it". The findings: sized
for a laptop (13px rows in a 1,120px column, two thirds of the window empty);
the top third a welcome page; colour on everything (yellow and blue icons,
filled date bands, a three-colour summary) so the colours that mean something
did not stand out; secondary text and 55%-opacity icons too faint; a box round
every icon, and controls that moved from row to row; setup links as loud as
the work; the case number glued to the name; a decorative glow. What changed
(pwa/index.html, the "Home as a workspace" block at the end of app-web.css):

- **Layout.** `.home-app`: the Folders list a full-height sidebar against the
  window's edge on its own ground (`--c-app`), sticky; the work area beside it
  (`.home-main`), up to 1,880px, starting at the sidebar. Under 960px the
  sidebar stands above, as before.
- **The bar** (`.home-top`, still `.home-hero` with its `h1`, which PDF+'s
  shim renames): a small logo and title, the four ways to open as plain
  buttons (their descriptions now their hovers), and a settings menu
  (`#home-settings`) holding Link hearings sheet and Link Downloads, with a
  dot while either wants setting up. An empty Hearings list offers the same
  button where it is wanted, and the summary's Downloads note is one. The
  tagline and the "drop files anywhere" line are gone from view (the line
  stays in the page, hidden, for the shim, which rewrites its words).
- **Order.** Hearings first. Where the screen is 1,760px or more and there is
  something to show, Case folders and Recent stand in a 440px column beside
  it (`:has`), the help and PDF+'s update box (which the shim puts before
  `.home-more`, a child of `.home-inner` still) with them.
- **Type.** Sizes scale with the window (`--fs-name` 14–16px,
  `--fs-meta` 12.5–14px, `--fs-label`); secondary text brighter in both
  themes; no background glow.
- **Rows.** The case number in a column of its own (`.ci-num`, fixed width,
  tabular figures) and the name beside it as the sheet has it (`.ci-case`; the
  owner's ALL-CAPS captions are left as written, since a guess at title case
  would get "LLC" and "McDONALD" wrong); the details under the name. The
  buttons are borderless icons in fixed slots (`.ci-actions`: files, line,
  take over, Done, calendar, eCourt), an empty slot keeping its room, so each
  stands in one column down the list. Date headers are a label over a rule,
  with no band. Icons are neutral; colour is for state only (Not downloaded,
  running, done, off calendar, the place in line). In the summary only "not
  downloaded" is coloured.
- ## Opposition and reply status from E-Court Suite (2026-11-19)

The owner: "integrate it with e-court suite so that it can do updates on the
status of oppositions and replies." PDF+ has no network, and eCourt wants the
browser's sign-in, so the E-Court Suite extension is the one that looks. It
already works each hearing's briefing out on its case page and beside each case
on its day's agenda. Since its 3.49.29 it also states each paper as the case
page colours it (its `lib/case-status.js`, `briefingSummary`: filed, late,
missing, personal, pending; "Not Filed" or "Not Posted Yet"; picked by hand),
its service worker keeps the latest per hearing for a week, and its native host
writes them all to `E-Court Briefing Status.json` in Downloads
(`writeBriefingStatus`).

Home reads that file through the linked Downloads each look, again only where
its size or time moved (`readBriefing`), finds each hearing's entry by case
number and day, and, where two motions are set that day, by the words of the
Motion Type (`briefingFor`). It shows Mot, Opp and Rep chips in a column of
their own (`briefingCell`, `briefingChips`): green ✓ filed on time, red ! filed
late, red ✗ not filed, amber ! timely only if personally served, plain not due,
dashed ? not posted yet. An OSC re default judgment is one Defaults chip. Each
chip's hover says due and filed dates and when the extension last looked; the
row fades past BRIEFING_STALE_MS (12 h). A hearing the extension has not
reported yet shows a dash whose hover says how to fetch it (the eCourt button,
or the day's agenda). The summary counts the hearings with a paper not filed.
The status now sits in a fixed column too (`.ci-status-col`), so the chips line
up whatever the pill beside them. ## The background refresh, and the bar's buttons (2026-11-19)

- The owner: "Is there a way to add a background refresh?" … "E-court
  typically stays open all day after I log in in the morning. Next 5. hourly
  works". E-Court Suite 3.49.30 checks the next five court days' agendas once
  an hour on weekdays, 8 AM to 6 PM, inside the open eCourt tab (its
  `refresh/run.js`), and writes how it went into the file's `refresh`. Home
  reads it (`parseBriefingFile`) and the summary says it (`refreshText`):
  "Briefing checked 3:05 PM", or a warning: "eCourt sign-in needed", "no eCourt
  tab open", "open the eCourt agenda once" (the extension learns the agenda's
  address from it). **Refresh briefing** in the Hearings heading opens
  `https://civil.lacourt.org/#lac-refresh-briefing` in Chrome (REFRESH_URL):
  the extension runs the check in that tab and closes it when done, or leaves
  it open where eCourt wants a sign-in. The page is eCourt's front page, never
  the agenda, whose own script would copy the day to the clipboard.
- The owner: "the open a file open a case folder combine files can go ... I
  already have a file opener and a case folder buttons in the tool bar. Also
  Idk if I even need pdf from images, but if I do, we should move it up next to
  the case folder button". The bar holds the title and the settings menu;
  PDF from images (`#images-to-pdf`) is in the tab strip after Case folder. The
  strip's Case folder opens the case in a window of its own while Home is
  showing (Home's own button did), and in the window it is in from a document.

## Room for the name; the sidebar's foot; a Claude run for the case (2026-11-19)

- The owner: names "cut off on the home page pretty early on, while most could
  probably fit the entire case name without moving anything else, just by
  reducing the buffer between them and the status marker". The briefing column
  is as wide as the most chips any hearing shows (`--brief-w`), and takes no room
  where no hearing has any; the status column is 132px and starts at its left
  edge; Case folders stands beside Hearings only from 2200px.
- The owner: "move the check for updates to the bottom left corner. same with
  the app files: and how Home works". `#home-foot`, at the bottom of the Folders
  sidebar, holds PDF+'s version, Check for updates and App files (the shim puts
  `.pdfplus-about` there; `footAbout` moves it there from where an older shim put
  it) and How Home's lists work, which opens as a panel beside the sidebar.
- The owner: "Let's add integration with my Claude extension too ... press a
  button to open the options tab and have it automatically bring the hearing date
  and files up for me while I select the workflow run" ... "make sure that I can
  continue using the options page normally too. Also make sure that this new
  method respects all existing safeguards against accidental uploads." A
  **Claude** button (`claudeButton`, `askClaude`) on each hearing that carries
  its folder, in PDF+ only: PDF+'s main process says where the folder is
  (`pdfplus:folder-path`, now also for a folder by its own name, an empty chain,
  checked by one of its files), Home writes `Claude Run Request.json` into
  Downloads (the case, its hearing date, the folder's name and path) and opens
  `https://claude.ai/#cum-pdfplus-run`, the marker only, never the case (main.js
  trusts claude.ai). The Claude extension (its `src/pdfplus-run.js`) opens its
  Options on Workflows with the case named; Create run on a workflow brings the
  folder over through the E-Court Suite's native host (which serves only that
  request's folder, read-only) and into the run's editor through the same door,
  and every check, as Choose folder…: the LEAKS gate, the case-folder split (Text
  Files only, the key attached), the PDF question. Its README says how to set the
  host up for it.

Tests: `test-hearing-sheet.mjs` parts 5b (the
file, the matching, the chips) and 14c (the chips on Home, a dash, the count,
and the file written again updating the row).

Tests: `test-hearing-sheet.mjs` part 9b (at 2560: names at 15px or more,
  numbers, names, Done and eCourt each in one column, the sidebar the window's
  height from its edge, Case folders beside Hearings) and the settings menu
  in part 9. Hearing-row locators match the name with `:has-text`, since the
  number and the name are two spans.

Tests: `test-hearing-sheet.mjs` (the rules in node over a workbook built with
`viewer/zip.js`; the list in the assembled site over an OPFS Downloads).

## Sticky notes, Downloads marked, the drag fixed (2026-11-19)

- **Sticky notes.** The owner: "Change the * to a sticky note icon, and give
  them all one. When it is transparent that means there is not currently a
  note, but by clicking it, I can add a note. When there is a note, it is
  colored in and I can view and edit the note by clicking on it." Every row
  has `.ci-note` (icons.js `sticky-note`, its paper filled `#fde047` with
  `.has`) before the case number; a click opens a panel under the row (in the
  list only while open) with a textarea, Save (Ctrl+Enter), Remove note and
  Cancel. Saving is an edit in the `hearingEdits` queue (an entry with `note`
  rather than `mark`; `isNoteEdit`), written by `setHearingNote`
  (hearing-sheet.js) into the row's Date cell: alone where the cell is blank,
  after the date where it holds one (`"11/20/2026 · Check POS"`,
  `splitNoteLead`, `NOTE_SEP`), so neither the row nor the rows below lose the
  date; `readHearings` reads that form as date + note and passes the date
  down. Removing gives the cell its date back as a serial where its style is
  a date's (`dateToSerial`). The list is not redrawn while a note's textarea
  has focus (`noteEditing`).
- **In Downloads.** The owner: "It should be visually obvious which case
  folders on the hearings table are in the downloads folder." `hearingItems`
  asks Downloads whether it holds each row's folder (`isInDownloads`,
  `FileSystemDirectoryHandle.resolve`); such a row gets `.in-downloads` (an
  amber stripe) and a Downloads chip by the name.
- **The drag.** The owner found today's and tomorrow's cases would not drag
  onto a folder: those are the folders opened here, and after a restart their
  handles want the leave again (`row.locked`), which left them undraggable;
  folders on the Folders list in the same state took no drop. Both now do,
  and the move bar's Move asks the leave (`moveCase` already did). A case open
  in its own window (`caseWindows`) counted as nowhere; `caseWindowHolding`
  finds it and the bar offers Close window and move.
- **A reader bug the calendar's tests found.** `parseSheetCells` matched an
  empty row with attributes (`<row r="4" ht="28" customHeight="1"/>`) as
  opening a row that ran to the NEXT row's `</row>`, so that row's cells were
  read one row up: Done, Off calendar and notes could land on the blank row
  above the case. The row pattern is lazy now. (`xlsx-read.js` has the same
  pattern; it reads only the pseudonym key, which openpyxl writes without
  empty rows, and is kept in step with the Claude extension, so it is left.)

Tests: `test-hearing-sheet.mjs` parts 13 (the sticky note, a note written and
removed) and 14f (In Downloads); `test-calendar-sync.mjs` part 10 (notes).
The sheet kept up to date from eCourt is its own note: Home calendar.md.

## At a glance, and the buttons under the case selected (2026-11-19)

The owner: "I think that it looks too busy and I think it goes too far to the
right. We should free up a margin on the side. ... we need to distinguish
between information that I want ready at a glance for all cases, and buttons
that I want available for the case I am currently working on. For the latter I
could click on the case first to select it, and only then would all the
buttons appear." And: "we can probably change the downloads button to just the
icon."

- **The row** keeps only what is read down the list: the sticky note, number,
  name, ✓, the Downloads icon (`.ci-dl-chip`, an amber disc; the stripe stays),
  motion and folder, the briefing chips, PDF-Linker's status dot, and the
  folder's place in PDF-Linker's line (`.ci-place-glance`, inside the status
  column so the chips stay in one column).
- **Selecting.** A click on the row selects it (`selectHearing`,
  `selectedHearing` by `noteKey`, kept across redraws); its bar
  (`.hearing-tools`, built by `row.__tools`) opens inside the row, under the
  name, with each button labelled (`labelTools` adds the aria-label as words):
  Open case folder / Find its folder…, eCourt, Done, Off/On calendar, Claude
  run, Word, Log to share, the line controls, Take over. A second click or
  Escape closes it; a double click (`e.detail >= 2`) opens the folder. Only
  the selection changes the DOM: no redraw on a click. The old fixed button
  slots (`.ci-actions`, `.s-*`) stay for the Case folders list only.
- **The margin.** The work area keeps 72px on the right and is at most 1560px
  wide (`--work-max`), 2040px where the side column of case folders and Recent
  stands beside Hearings.

Tests: `test-hearing-sheet.mjs` parts 8 (no buttons until selected, the
labels, Escape), 9b (one column for the status, the right margin) and every
part that presses a row's button (`pick` first).

## Claude runs on Home (2026-11-19)

The owner: "I'd like to have the dashboard display include the current status
of any claude run going." The Claude extension (`src/pdfplusstatus.js`, wired
in its `background.js`, "PDF+'s Home: the runs") summarizes each run going or
ended in the last 18 hours — its matter (the case folder's name, so the case
number), workflow, the runs list's own progress words, hold or failure, and
the chat it last worked in; nothing it sent or received — and sends it to the
E-Court Suite's native host (`writeClaudeRuns`), which writes
`Claude Run Status.json` into Downloads. It writes on every run change and
every five minutes while one is going.

Home reads it each look (`readClaudeRuns`, again only where it moved;
`viewer/claude-runs.js`: `parseClaudeRuns`, `runsForHearing` by case number,
else the folder's name in the run's, `runState`, `runLine`, `stepLines`).
First a box at the top of Hearings; the owner then: "I was thinking more like
having a simplified version of the options page runs history (for the most
recent run of that case) like what time it finished or what step it was on.
Similar to the E-court motion opposition reply display." So each row has a
**Claude** column beside the briefing (`runCell`, `.ci-run`, shown only where a
row has a run, `has-runs`): the case's newest run as a bar of its steps (the
extension now sends each step's label, chat, state done / here / next / failed
/ todo, and how long it took: `stepsOf` in its `src/pdfplusstatus.js`) and a
line (`runLine`: "Step 3 of 7", "Finished 3:10 PM", "Held: usage limit",
"Failed at step 3"). The hover is the runs list's history a line a step
(`stepLines`); a click opens the chat. The summary counts the runs going,
those on no hearing included. A run "running" in a file older than `QUIET_MS`
(15 minutes) reads "No word since …". Only a claude.ai address is ever opened.

Tests: `test-claude-runs.mjs`; `test-hearing-sheet.mjs` part 14g.

## The Claude button finds the folder's place (2026-11-19)

The owner: "PDF+ could not tell where [case folder] is on this computer ...
it didn't work even when I opened the folder. Second, if it already has the
ability to open the case folder, doesn't it already have the folder location,
or at least have the ability to get that information?"

A page holds a folder by handle and is never told its path. The button had
asked the main process for the case folder by its own name, which it knew
only where the session's permission handler had once named that very folder
(`rememberFolder`), and a case folder in Downloads read through Downloads'
own leave never passes through it. What Home does know is enough to find it,
so `askClaude` now asks with all of it, in order, each believed by the main
process only where one place holds a file of the folder at its size
(`desktop/folder-place.js`, `placeFolder`):

1. the path the folder's PDF-Linker launcher records (`folderLauncher`,
   `folderPathOfToken`), whose last part must be the folder's name;
2. where it sits under Downloads or each folder of the Folders list, asked of
   those folders' handles (`FileSystemDirectoryHandle.resolve`), against
   Downloads' own path or the remembered folders of that name;
3. the hearing's place (`r.root`, `r.chain`);
4. its name, searched for (`findFoldersNamed`: Downloads, Desktop,
   Documents, now also `%OneDrive%` / `%OneDriveCommercial%` and the home
   folder, AppData skipped, four levels, five seconds).

Two places that both pass are no answer. The place found is remembered, as
before. `folder-place.js` is in desktop/package.json's `files`.

Tests: `test-folder-place.mjs` (node, over a temporary tree);
`test-hearing-sheet.mjs` part 14e.

## The status in its words again; long names cut short (2026-11-20)

The owner: "Since the reorganization, there is now more room for the pdf
linker status, so lets make them full size again. Also you can cut off any
case name that runs too long to avoid anything being pushed off the edge."
With the buttons moved under the selected case, the row has the room the dot
was saving. PDF-Linker's status is its words again, on hearing rows and in
Case folders (`compactStatus`, `statusOpen` and the `.compact` styles
removed), with the status itself as the pill's hover. The status column
(`.ci-status-col`) is 290px (230px at 1300px and under), wide enough for
"Finished 11:42 AM · LEAKS.xlsx to answer"; a longer one ends in "…", and the
column clips, so nothing past it moves. A case name that runs long is cut by
`.ci-case`'s ellipsis. `test-hearing-sheet.mjs` (section 8) sets one row's
name very long and checks that it ends in an ellipsis, that every row's cells
stay inside it, and that the status beside it is still whole. (Since 2026-11-24 the name wraps to two lines before it is cut, and the
status column is as wide as its widest row: see "Readability" below.)

### Due dates under Mot, Opp and Rep (2026-11-20)

The owner: "Also expand the Motion Opposition Reply labels to include due
dates underneath." `briefingChips` gives each slot `due` ("Due 11/14", from
the slot's `due` in the briefing file; "" without one, none on an OSC chip),
and `briefingCell` writes the chip as two lines, `.cc-label` over `.cc-due`.
Where any chip of the hearing has a date, every chip of it takes the second
line (a blank one where it has none), so the chips stay one height. A chip is
66px wide (`--brief-w` counts 66 a chip), wide enough for "Due 12/31". The
filed date stays in the hover. `test-hearing-sheet.mjs` checks the dates (part
1 and section 14c) and that each sits under its label inside the chip.

### Date headers as a band (2026-11-20)

The owner: "it might make the hearings home page more readable if we broke up
the colors a bit more, for example, on my calendar sheet the date rows were a
different color" ... "It's just an example. I want a color that makes sense
with this theme." Each date header (`.hearing-day`) is a band of its own: a
slate drawn from the theme's neutrals with a little of its blue
(`--c-day-band`, `--c-day-text`, `--c-day-rule`, one set per theme), ruled
above and below. It was first the accent's own blue, which in the light theme
read too close to the selected row's tint; the slate keeps the two apart. Not
the sheet's colour: the sheet was only the example.

### Light and dark from Home (2026-11-20)

The owner: "How do I switch between light and dark mode?" ... "yes, add it to
home". Home's bar has its own ☀/🌙 (`#home-theme`, `applyHomeTheme` in
app-web.js), left of the settings button. It writes the same
`pdfViewerTheme` the viewer's and the text reader's toggles write, and every
page now follows a change made in another (a `storage` listener in
app-web.js, viewer.js and text-reader.js; before, a viewer tab took a new
theme only when it next loaded). `test-ocr-button.mjs` (7) switches from Home
and from a PDF tab and checks both follow.

### An eCourt link for a row the sheet does not link (2026-11-20)

The owner: "I'm noticing some hearings missing ecourt buttons." The button
came only from the row's own link (a hyperlink on any cell of the row, or a
HYPERLINK formula), so a row typed in or pasted as plain text had none.
`fillEcourtLinks` (hearing-sheet.js), run each look once the briefing file is
read, gives every hearing with no web link of its own and a case number a
`ecourtUrl`: first another row of the sheet with the same case number that is
linked (`ecourtFrom: "sheet"`), then the calendar E-Court Suite read (the
next ten court days): its row's link where it is an lacourt.org address, else
`ECOURT_CASE_URL` + its case id (`"ecourt"`). `url` itself stays the sheet's,
since the calendar sync matches rows by the case id in it. Every place the
button is drawn or opened reads `ecourtUrlOf`, and its hover says where the
link came from. A row beyond the calendar's ten court days, whose case is on
no other linked row, still has none.

### A LEAKS badge by the name (2026-11-20)

The owner: "Update the home screen to show whether there is a LEAKS SHEET in
the folder." `folderStatus` already read LEAKS.xlsx in the folder's top level
(`leaks`), but it reached the row only as "· LEAKS.xlsx to answer" on a
finished or earlier run's status, and not at all while a run went. Now a red
**LEAKS** tag (`leaksChip`, `.ci-leaks-chip`) stands in the name line of a
hearing's row and of a Case folders row whenever `r.status.leaks`, whatever
the run's state (a folder waiting for leave to be read shows none: its files
are not known). `statusText` leaves the words out (the badge says it) but a
LEAKS sheet still turns a finished status amber, and its hover still names
it. Case folders rows now carry the same `.ci-name-line` as hearing rows.
`test-case-folders.mjs` (2, 6) and `test-hearing-sheet.mjs` (8: the sheet put
in and taken out of a hearing's folder) check it.

### The Claude button picks the workflow (2026-11-20)

The owner: "Let's change the claude run button to a drop down menu that lets
me select the workflow to run. That way it can initiate the full thing for
me, upload the documents and fill in the date I can just hit the save and
start this run button." The Claude extension now lists its workflows (id and
name only, `workflowList` in its src/pdfplusstatus.js) in Claude Run
Status.json, which `parseClaudeRuns` reads (`workflows`, ids checked). The
Claude button (`claudeButton`) opens a menu of them (`openMenu`, the Word
menu's look) and "Choose in the Claude extension…" last; with no list, it goes
straight to the old way. A pick writes `workflowId` and `workflowName` into
Claude Run Request.json (`askClaude(hg, r, wf)`); the extension's Options
presses that workflow's own Create run once a request (`autoCreate`), which
makes a draft and brings the papers and date in through `afterCreate` as
before. Starting the run stays the owner's press. `test-hearing-sheet.mjs`
14e (the menu, the request) and `test-claude-runs.mjs` (the list read) check
it; the extension's side is in its own tests.

### Several motions the same day (2026-11-20)

The owner: "Look at how e-court handles multiple motions on the same day and
make sure that a similar approach works for pdf home page for brief status."
E-Court's case page works each motion set the same day apart, under one day
(`groupWorkableHearings`), keyed by `hearingIdentityKey`, a standalone motion
to strike folded into the day's demurrer, with a "⚠ N motions set <date>"
badge; eCourt's agenda lists a case's motions in ONE row, and Copy All writes
them all into one Motion Type cell. Before, the agenda and the hourly refresh
reported only the row's first motion, and Home took the one entry of a case
and day for every row of it, so a second motion's row showed the first's
briefing.

- E-Court now reports every motion of an agenda row (`parseAgendaJobs`'
  `hearings`, the strike folded in the same way); the agenda page paints its
  first, as before, and reports the rest.
- `briefingsFor(hg, entries, sameDay)` (hearing-sheet.js): one sheet row of
  the case that day gets every entry of it, newest report of each motion, in
  the order the row names them, and only those it names where it names some
  (`motionWords`, abbreviations like MSJ, MTC, MJOP read as their words);
  several rows get one entry each, matched one to one by shared words, a
  motion-to-strike row beside a demurrer row taking the demurrer's, a lone row
  and entry left over pairing up. `briefingFor` is its first.
- `briefingCell` draws a line of chips a motion, each led by `motionTag`
  ("MSJ", "Demurrer", "Compel Discovery"); the column widens by the tag
  (`has-multi-brief`) and a row of one motion is indented so every row's chips
  start in one line on a wide screen. The name line carries "⚠ N motions"
  (`.ci-motions-chip`), its hover listing them. The summary's "briefing not
  filed" counts a row where any of its motions has a paper not filed.

Tests: `test-hearing-sheet.mjs` 1b2 (the matcher) and 14c (two lines, tags,
the badge, chips whole and aligned).

### Every case's last Claude run (2026-11-20)

The owner: "It should show in the home page the status of the current or most
recent claude run for each case (but only if there was one)" … "I have yet to
see a single one". The Claude extension sent only runs going or ended in the
last 18 hours, so a case whose run ended yesterday showed nothing; it now also
sends each other matter's most recent run of the last 90 days. Home already
shows the newest run of a case in its Claude column (`runCell`), words an
older finish with its day ("Finished Nov 15, 3:10 PM": `clockText`), and keeps
the column away where no case has one. That none ever showed points at the
file never being written: the extension's Options now says under its
Workflows toolbar whether its last write reached Home or why not (Chrome
refusing it the E-Court host until that host's install.ps1 is given its id,
the usual cause), with Try again. `test-hearing-sheet.mjs` 14g: a run five
days old on its case's row, with the day.

### The Claude column: the workflow, and a fraction for the lights (2026-11-20)

The owner: "replace the lights with the number out of blank like a fraction"
… "Also the name of the run … of the workflow". `runCell` no longer draws a
segment a step (`cr-bar`, `cr-seg` gone): it gives the workflow's name
(`r.template`, `.cr-name`) over a line of the steps done out of the run's
steps (`stepFraction` in claude-runs.js, pauses not counted; from `step` and
`total` where the run sends no steps) in the run's colour (`.cr-frac`) and
its status (`runLine`, whose running wording is now "Running step 2", since
"Step 2 of 3" beside "1/3" read as two counts). The step-by-step history
stays in the hover. `test-claude-runs.mjs` and `test-hearing-sheet.mjs` 14g
check it.

### The row's columns in the order things happen (2026-11-20)

The owner: "thinking chronologically, the order should go briefing status,
download status/pdf linker status, run status." The Claude column now stands
after the folder's status (`statusCol.after(runCell(…))` in renderHearings):
Mot/Opp/Rep, then where the case folder stands and what PDF-Linker did in
it, then the Claude run. `test-hearing-sheet.mjs` 14g checks the order.

### Show previous (2026-11-20)

The owner: "Add a button for showing previous motions next to the off
calendar button." `#hearings-past` stands right after `#hearings-all`, hidden
where the sheet has no hearing in the last `PAST_DAYS` (60). Pressed
(`hearingsPast`), `hearingItems` appends those hearings, newest first, after
the upcoming ones (off-calendar ones only with Show off calendar, as for the
upcoming), and `renderHearings` sets them under a `.hearing-past-head` heading;
each is matched to its folder and drawn as any other row. `all` and `open`
stay the upcoming ones, so the summary, calendar sync and the E-Court list
are as before. `test-hearing-sheet.mjs` 11b. The owner, after: "Show previous
doesn't seem to do anything": they came under every upcoming hearing, out of
sight on a long list. The press now scrolls the heading into view and lights
it for a moment (`.flash`); Hide previous scrolls back to the section's top.

### "Claude runs going" counts only runs moving now (2026-11-20)

The owner: "It says 16 Claude runs going when actually none are going." The
count took every run the extension had not finished or canceled (`isGoing`:
running, queued, held, paused, failed), and since the extension now sends each
case's most recent run, old failed and stalled ones came with them.
`isGoingNow` (claude-runs.js) counts a run as going only where it is running,
queued or held for a usage reset AND has moved within `STALE_MS` (12 hours);
the summary uses it, and `runsForHearing` ranks by it, so a case's newer
finished run is shown over one failed days ago. A run still saying running
(or queued, or held) but not moved in that time reads "Stalled since …" on its
row (`runState`'s `stale`), with the hover saying to continue or cancel it in
the extension. `test-claude-runs.mjs`; `test-hearing-sheet.mjs` 14g (a failed
and a days-old running run in the file, not counted).

### The case's buttons in the strip; the whole-folder ask removed (2026-11-20)

The owner: "Let's add the home page case buttons ecourt claude run word to the
header when the case folder is open" … "Both pdf mode and text mode". While
the tab in front is a case folder's reader (`activeCaseDir`), the tab strip
carries `#case-strip` after its spacer: eCourt (the hearing's link, or one
filled in), Claude run (`claudeButton`, the workflow menu) and Word
(`wordButton`), each only where it has something to open, as on the case's
hearing row. `updateCaseStrip` reads the folder (`readListing`), finds its
hearing in the sheet (`hearingForPlace`: the next, else the latest) and runs
on every `updateChrome` and window focus. The strip is outside the reader, so
it stands in text and PDF mode alike. `test-case-folders.mjs` 7.

And: "remove the open full case folder precaution, it triggers way to often".
The reader's ask (text-reader.js `askBeforeFolder`: after a session that went
down holding a whole folder, the next file came alone with its key and an
offer to "Read the whole folder") is gone; the whole folder comes every time,
an older build's stored flag is cleared, and the note saying what the last
session stopped in stays. `test-folder-save.mjs`.

### A case's Claude runs: the last week only (2026-11-20)

The owner: "For Claude runs, limit them to those from the last week.
Otherwise it usually refers to an earlier motion in that case."
`runsForHearing` (claude-runs.js) keeps a case's run only where it is going
now (`isGoingNow`) or finished, or last moved, within `RECENT_MS` (7 days).
The extension still sends 90 days; the summary's count is unchanged (it only
counts runs going now). `test-claude-runs.mjs`.

### The Downloads marker only once done (2026-11-20)

The owner: "Change the still in download symbol to only show up after I mark
the item done." The `in-downloads` stripe and `.ci-dl-chip` now need
`hg.mark === "done"` as well as `inDl`: a case still being worked belongs in
Downloads; one done and still there is left to file. Dragging a row onto a
folder works as before, marked or not. `test-hearing-sheet.mjs` 14f.

## Readability (2026-11-24)

The owner asked for ideas to make Home more readable, then: "Do all of them
except 8 ... Also, I think adding a sublte color shift between cases would also
help readability." (Idea 8, moving Case folders below Hearings, was refused:
"when it does I want it visable.")

- **The name gets the room.** At 1200px the fixed status (230px) and Claude
  (150px) columns had cut "Doe v. Globex" to "Doe…". `fitColumns` now
  measures, once per redraw and while the list is on screen, the widest
  `.ci-status-col` and `.ci-run.has` at `max-content` (the list's `measuring`
  class), and sets `--status-w` (110 to 290px) and `--run-w` (96 to 210px) on
  the list, so each is still one column down the list. Off screen it measures
  nothing and clears `hearingsShown`, so the next look draws and measures
  again; the CSS defaults are the old widths. `.ci-case` wraps to two lines
  (`-webkit-line-clamp: 2`) before it is cut; the test checks the clamp, not
  an ellipsis. Under 1300px the main column's right margin drops to 32px.
- **The motion is a tag** (`.ci-motion`) in `.ci-title` beside the name, a
  wrapping flex box, so on a narrow row it drops under the name, aligned with
  it. The case folder's name left the line under the name for the row's hover
  ("Case folder: …"); `.ci-where` is hidden when empty (it keeps a case number
  not in the name, Moved from, Submitted and a run's start). Tests read the
  folder from the hover and pick a row by `.ci-num`, since `.ci-where` may be
  empty.
- **Chips.** Larger (`--fs-meta`), a problem filled solid (missing and late
  red, personal amber), a paper in order outlined; brighter green in dark
  mode. Where a row's chips (two or more) all share one due date it is said
  once after them (`.cc-due-once`), and `--brief-w` counts it (`chipsWide`).
- **Done and in Downloads** keeps the stripe and the icon; the row's amber
  tint is gone, since it made a finished row the loudest on the page.
- **Every other case shaded** (`.alt`, `--c-row-alt`, 3.5% white in dark,
  3.5% slate in light), counted from the top of each day so the first row
  under a heading is always plain. Hover and selection win over it.
- **The summary's counts are filter pills** (`hearingFilter`, in the redraw's
  signature): not downloaded, briefing not filed and Claude runs going lead,
  then to work up (no filter), downloaded and done. A pill clicked again, or
  to work up, clears it; a filter whose count falls to 0 clears itself; an
  empty result offers "Show every hearing". The Claude filter shows hearings
  with a run going now (`runsForHearing` + `isGoingNow`); the count still
  includes runs on no hearing.
- **Day headings** say how far off and how many: `daysAway`/`daysAwayText`
  (hearing-sheet.js; "" for today and tomorrow, which `dayText` names, else
  "in N days", "yesterday", "N days ago"), counted over the rows shown. Today
  and tomorrow get an accent bar and colour.
- **Fewer icons.** The folder/calendar icon before each hearing is gone (the
  pill says where the folder stands). An empty sticky note is drawn at
  opacity 0 until the row is hovered or selected (opacity, not visibility, so
  it keeps its place and Playwright can still click it); a note that exists,
  is open or is waiting shows as before.
- **No title bar.** `.home-top` (logo and "PDF Viewer", which PDF+'s shim
  renames) stays in the page for the shim and screen readers but is not
  drawn; the theme and settings buttons moved to `#home-strip-tools` in the
  tab strip, shown only while Home is (`updateChrome`). The strip is lifted
  above Home while the settings menu is open so the menu is not painted over,
  and the menu is `app-region: no-drag` in PDF+.

