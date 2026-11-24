# The hearings sheet kept up to date from eCourt (`viewer/calendar-sync.js`, `pwa/app-web.js`)

The owner (2026-11-19): "Looking at the E-court repo notes regarding my
current process for copying the [agenda] into my excel sheet, is there a way
to automate that process? Ideally in a way that can update automatically if a
new case is moved or taken off calendar? (but notifies me it should never do
that silently)" … "I also want it to add to the sheet, for that I want to go
10 days forward." … "The excel is currently open all day, but with these
changes I won't need to have it open all the time."

The process it replaces: the agenda page auto-copies its cleaned rows (Copy
All: Motion Type, Case Name with its eCourt link, a blank row after each), the
owner pastes them into the sheet with a macro that keeps the destination's
look and the link, and the paste advances the agenda a day.

## Where the calendar comes from

E-Court Suite (3.49.32): its hourly background refresh (refresh/run.js) reads
the next ten court days' agendas into the rows Copy All would copy, built by
the one function both now share (`agendaCopyRow`, `calendarDayRows` in
lib/case-status.js), so a row is worded exactly as a paste would word it. It
remembers what it saw; a case seen on a day and no longer on that day's agenda
is looked up on its Hearings tab (`hearingGone`: "off" for vacated / taken off
calendar, "moved" with the next scheduled day for continued / rescheduled,
"unknown" otherwise). The service worker keeps each day's last good read (a
failed or signed-out day never replaces one) and writes it into the briefing
file Home already reads, `E-Court Briefing Status.json`, as `calendar`:

    { at, windowDays, days: [{ day: "YYYY-MM-DD", state: "ok" | "empty" |
      "failed" | "unread", rows: [{ motion, caseText, url, caseId, caseNumber }],
      at }], gone: [{ day, caseId, caseNumber, caseText, motion, reason,
      status, newDay }] }

`parseBriefingFile` passes it through.

## The plan (`planCalendar`)

Each look plans afresh against the sheet as it stands, so a plan that could not
be written is simply made again next look, and one written is a no-op after.
Only days from today on that E-Court read (`ok`, or `empty`: no agenda table)
count. A case is the same case by eCourt's id (the link's `?id=`), else the
case number, else the name (`sameCase`).

- An agenda row with no row of its case that day in the sheet: **add**.
- An unmarked sheet row that day whose case is not on the agenda: **off**
  where `gone` says off or moved; else **held** (listed, never changed).
- Marked rows (done, off) and past days are never touched.

`calendarLog` (the folders database, `places`) records every change and every
decision by its key (`changeKey`: day | id or number or name). A key added
once is never added again: a row the owner deleted by hand, or undid, stays
out. One marked off, kept, or undone is never marked again.

## Writing the rows (`addCalendarRows`)

The layout is learned from the sheet's latest day (`sheetLayout`): whether the
date sits on a row of its own above the cases (`heading`), in the first case's
Date cell (`first`), or in every case's (`every`); the commonest number of
blank rows between two cases of a day and between days; and the rows whose
look to copy (each cell's style index, the row's height): an unmarked case,
the date row, a blank row. A day goes after its last case where the day is in
the sheet, else before the first later day's start, else after the last row
with anything in it. Empty rows in the way at the end are taken over, so a new
day at the end moves nothing. Elsewhere the rows below are moved down
(`shiftRows`: row and cell numbers, the dimension, hyperlinks, merged cells,
conditional formats, validations, the selection and pane, filters, page
breaks); formulas are not rewritten, so a sheet with formulas below (other
than `HYPERLINK`), shared formulas, a drawing or comments refuses rows there
(`shiftBlocker`) and Home says "Not added: … Paste it by hand." An Excel table
(Format as Table) no longer refuses (owner, 2026-11-24): its range lives in a
part of its own (`xl/tables/tableN.xml`, found through the sheet's
`<tablePart r:id>`, `tablePartNames`), and `shiftTable` moves or stretches
every range in it (the table, its filter, its sort) with the rows, as
`shiftRows` moves the sheet; rows added right under a table, or over its empty
last rows, join it (`growTable`; not past a totals row). Undo shrinks it back,
and refuses where it would take out the table's header, totals or last data
row. A table part that cannot be found or read still refuses, as before.
A calculated column's formula is not copied into the new rows.
Text goes in as inline strings, the date as a serial (1900 or 1904 system),
and the Case Name gets a `<hyperlink>` with an external rel (a sheet with no
rels part gets one: `replaceParts`'s `add`). Off is `markHearing(…, "off")`,
the Off calendar button's own writer. Everything is one write, after which
the sheet is read again.

## On Home

`syncCalendar` runs each look after the briefing is read, when the sheet read
cleanly, no mark or note of the owner's waits (`hearingEdits`), and PDF+ may
write the workbook without asking. Without that leave, the list says how many
changes wait, with Allow; with Excel holding the file, that they wait for it
to close. Every change made goes to the toast, a system notification (`calNotify`;
the leave is asked on Refresh from eCourt's click) and the **Calendar changes**
box at the top of Hearings (`renderCalendarChanges`): the last two days'
changes with **Undo** (`undoCalendar`: `removeCalendarRow` takes an added row
out with the blank row above it, and a date row left with no case; an off is
marked "" again), and every held one with **Off calendar** and **Keep**.
Clear takes the made changes off the list. **Refresh from eCourt** (was
Refresh briefing) opens `#lac-refresh-briefing`, which now reads the calendar
too.

Tests: `test-calendar-sync.mjs` (the plan; the layout; references moved and
refusals; a day at the end, into a day, between days; Undo; the three date
layouts; notes) and `test-hearing-sheet.mjs` part 14f (in the browser: the file
arrives, the sheet gains the row and the red, the list, Undo, not added again).
Not run here: E-Court Suite's hourly read in real Chrome against eCourt, and
Excel opening a workbook PDF+ wrote rows into (the parts are the ones Excel
itself writes: inline strings, styles by index, hyperlink rels).

## Moves found on the sheet's own hearings (2026-11-20)

The owner: "Let's also add detection for when the hearing date has moved."
A move was found only for a hearing E-Court had seen on a day's agenda (in
the ten court days) that later left it, and its new day was added only once
it came within the ten. Rows from before E-Court kept track, moves to a later
date, and hearings set past the ten were missed.

- **Home hands E-Court the sheet.** Each look, `writeSheetHearings` writes
  `sheetHearingsList` (calendar-sync.js: every unmarked hearing from today on
  with a case id, from its link or `ecourtUrl`, one per case and day) to
  `SHEET_HEARINGS_FILE`, "PDF+ Hearings Sheet.json" in Downloads, only where
  the list changed. E-Court's native host reads it (`readSheetHearings`) into
  the service worker before each refresh run.
- **E-Court checks each on its Hearings tab** (refresh/run.js, `hearingCheck`
  in lib/case-status.js): skipped where that run's agenda shows it on its day;
  else "scheduled" where a hearing of its kind is still Scheduled that day,
  else `hearingGone`'s off / moved + new day / unknown. Off or moved joins
  the calendar's `gone` with `from: "sheet"`. At most 60 Hearings tabs a run,
  the longest unchecked first (`lacSheetChecked`).
- **planCalendar** now also reads a `gone` entry for a day E-Court did not
  read (past the ten, or unread): the sheet's unmarked row of that case and
  day is marked off. And every move with a new day is written under it at once
  (`movedFrom` on the add), wherever the sheet has no row of the case that day
  and the new day is not one E-Court read (that day's agenda adds it). "unknown"
  past the ten changes nothing: there is no agenda to contradict the sheet.
- **Home says it.** The change list words a move "Moved Dec 2 → Jan 14: …";
  the old row's pill reads "Moved to Jan 14" (not Off calendar) and the new
  row's second line "Moved from Dec 2" (`movedOf`, from the calendar log by
  `changeKey`). Undo works on each as before.

Tests: `test-calendar-sync.mjs` part 2 (past the ten: marked, added once, not
where the case is already that day, off, unknown, the list) and
`test-hearing-sheet.mjs` 14f (the list file written, a move 40 days out
written into the sheet, both rows labelled, both undone). E-Court's
`hearingCheck` was checked in node against Hearings-tab rows (moved with a new
day, vacated, still scheduled, none that day). Not run here: the refresh in
real Chrome against eCourt.
