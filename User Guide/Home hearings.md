# Hearings on Home

Home lists your upcoming hearings from your own Excel sheet and shows, for
each one, whether its case is downloaded yet.

## Linking the sheet

Open the settings menu (the sliders button at the right of the tab strip, beside
the light/dark button, while Home is shown) and
choose **Link hearings sheet…**, then pick the workbook (`.xlsx` or `.xlsm`).
**Link Downloads…** is in the same menu. While either still needs setting up,
the button shows an orange dot, and the empty list offers the same button. You link it once. Home reads it again each time you save
it in Excel. If the browser asks for leave to read it again in a later session,
the button reads **Allow hearings sheet**.

The sheet needs a header row with these columns, in any order:

| Column | What Home does with it |
|---|---|
| **Date** | The hearing date. A row left blank takes the date of the row above. |
| **Motion Type** | Shown under the case name. |
| **Case Name** | The case. Its hyperlink to eCourt is the **eCourt** button; a row with no link borrows one from another row of the same case, or from the calendar E-Court Suite reads (the next ten court days). |
| **Date Submitted** | Shown as "Submitted 11/12". |

Fill a row (or its case name cell) **green** when it is done, and **red** when
it is off calendar or you otherwise don't have to work on it. Those rows drop
out of the list. **Show done and off** brings them back, struck through.

## Done, Off calendar and On calendar

Each hearing has a **✓ Done** button. It fills the hearing's **Motion Type**
and **Case Name** cells green in your sheet, and a green ✓ appears before the
case name on Home. A done hearing stays on the list until its date has passed.
It no longer says Not downloaded (or Zip in Downloads): there is nothing left to
fetch for it.
Press ✓ again (Not done) to take the green off.

**Off calendar** fills the same two cells red, and the hearing leaves the list.
**Show off calendar** brings those back, with **On calendar** to take the red
off.

**Show previous**, beside it, adds the hearings of the last 60 days under the
upcoming ones, newest first, and scrolls down to them, under a "Previous hearings" heading, each with its
case folder, briefing and buttons as before. Off-calendar ones among them show
only with Show off calendar too. Press it again (**Hide previous**) to put them
away. The counts at the top stay about what is ahead.

If the workbook is open in Excel, Windows won't let anything else write to it.
Home still shows the change, says it is waiting, and writes it into the sheet
as soon as Excel closes the workbook. It doesn't overwrite what you saved in
the meantime.

## Notes

A hearing with a note has a yellow **sticky note** before its case number. On
a hearing with none, an outlined note appears there when you point at the row
or select it; click it to write one. A yellow, filled-in note
means there is one; click it to read or change it, or **Remove note** to take
it out. **Save** (or Ctrl+Enter) writes the note into the case's **Date** cell
in your sheet, where you keep notes by hand. A row whose Date cell holds the
date keeps it in front ("11/20/2026 · Check POS"), so the rows under it keep
their date. While Excel has the workbook open, the note waits, like Off calendar
does.

Anything you type in a Date cell yourself that isn't just a date is also a
note. The hearing keeps the date written above it, or the date the note names
("Continued to 1/5/27").

## Download status

Each hearing is matched to its case by the case number, in the case name or in
the eCourt link. When its case folder is found, in Downloads or among the
folders opened in the app, the hearing row *is* that folder:

- A hearing you have marked **Done** whose case folder is **still in
  Downloads** has an amber stripe down its row and a download icon by its
  name: those are the ones left to file. (A case still being worked shows
  none.) Drag the row onto a folder on the left to file it.
- The pill says what PDF-Linker has done in it (Not run yet, Running — ETA …,
  Finished …). Hover over the row for the folder's name and where it is.
- The folder's buttons are on the row: **Word**, **Log to share**,
  **Prioritize** (or its place in PDF-Linker's line with ▲ ▼ ✕) and **Take
  over** when a run stopped part-way.
- Click the row to open the folder in one reader, in a window of its own, so
  Home stays where it is. Clicking it again brings that window forward, and the
  window closes when you close its last tab.

Otherwise the pill says **Zip in Downloads** (not extracted yet) or **Not
downloaded**. If you know the folder is somewhere (you moved it, say), click
the row and pick it: Home keeps that folder as the hearing's from then on. Use
**eCourt** to open the case in eCourt.

An **Order Template Input** sheet in Downloads more than two days old does not
count toward Files in Downloads: it is most likely from an earlier motion in
the same case.

A folder is recognised by the case number in its name, or by the Register of
Actions the E-Court Export saves into it. Name case folders with their case
number for the surest match.

## A case's buttons

Each row shows only what you want to see for every case at a glance: the case
number and name, the motion as a tag beside the name (under it when the line
has no room for both), the sticky note where there is one, the ✓ when done,
the Downloads icon, the briefing chips, PDF-Linker's status, the case's place
in PDF-Linker's line and the Claude run. Every other case is shaded a little
darker, starting again under each day, so a row is easy to follow across.

**Click a case to select it.** Its buttons open in a bar under it, with their
names: **Open case folder** (or **Find its folder…** when Home hasn't found
it), **eCourt**, **Done**, **Off calendar** or **On calendar**, **Claude run**,
**Word**, **Log to share**, and **Prioritize** or ▲ ▼ ✕ for PDF-Linker's line.
Click the case again, or press Escape, to close the bar. **Double-click** a
case to open its folder at once. Only one case is selected at a time, and it
stays selected while Home refreshes.

**Prioritize** appears only while PDF-Linker is running on the case. Once you
use it, the case keeps its place in line for 24 hours, through any re-run, so
you don't have to press it again; ▲ ▼ ✕ change it at any time.

PDF-Linker's status is spelled out at the right of the row ("Finished 2:40
PM", "Running — ETA ~4.10PM"): green finished, amber something to answer or a
run that looks stopped, blue (pulsing) running, grey not run yet. One too long
for its column ends in "…"; hover over it to read it whole. The status and
Claude columns are only as wide as their widest row needs, so the case name
gets the rest. A case name too long for the row wraps onto a second line and
is cut short after that, so nothing is pushed off the edge.

## The summary and the days

The summary above the list counts what needs doing first (**not
downloaded**, **with briefing not filed**, **Claude runs going**), then **to
work up**, **downloaded** and **done**. Each count is a button: click it to
list only those hearings, and click it again (or **to work up**) to list them
all. Each day's heading says how far off it is and how many hearings it holds
("Thu, Nov 26 · in 2 days · 2 hearings"); Today and Tomorrow are marked in
blue.

A red **LEAKS** tag by the case name means the case folder has a LEAKS.xlsx:
PDF-Linker flagged values for you to answer in its Fix? column. It shows on
the hearing's row and in Case folders, during a run too, and goes once
PDF-Linker removes the sheet (when no row needs a look).

## Case folders not on the hearings list

Above the hearings, Home lists only the case folders that match no hearing on
the list: a case whose hearing is past or marked done or off, one not on the
sheet, or one the matching missed. Each says its hearing where the sheet has
one, with the same buttons. A folder whose hearing is marked done or off
calendar is not listed, unless PDF-Linker is running on it. When every folder
is on a hearing, the list is not shown. **Link Downloads…** is in the Hearings heading.

## Folders: moving a case into a folder

The **Folders** list on the left of Home shows Downloads and the folders you
add with **+ Add** (the folders you file cases into). To add several at once,
select them in File Explorer and drop them on the list. Click a folder to open
it, as in File Explorer.

Drag a case's row (a hearing with its folder, or a row in Case folders) onto a
folder. Home asks "Move … into …?" and **Move** moves the whole case folder
there. The hearing keeps its folder, its PDF-Linker status and its buttons
until the hearing date has passed.

Home won't move a folder while PDF-Linker is running on it, while it is open in
a reader tab, or where a file of the same name is already there. If the case is
open in its own window, the bar offers **Close window and move**. After PDF+
restarts, the browser wants your leave again for folders opened before; you can
still drag them, and **Move** asks for it. In PDF+, the folder's Re-run
PDF-Linker launcher is updated to its new place.

## Opposition and reply status

With E-Court Suite 3.49.29 or later, each hearing shows small **Mot**, **Opp**
and **Rep** chips, each with its due date underneath ("Due 11/14"), coloured
as the eCourt case page colours them:

- green outline ✓ filed on time;
- solid red ! filed late, solid red ✗ not filed;
- solid amber ! late for electronic service but timely if personally served
  (check the proof of service);
- plain: not due yet; dashed ?: nothing on file yet, but eCourt may not have
  posted it.

A problem is filled in solid so it stands out; a paper in order is only
outlined. Where every chip on a row is due the same day, the date is said once,
after the chips.

A case with more than one motion set the same day (eCourt and Copy All put
them on one row) shows a line of chips for each, led by the motion's short name
("MSJ", "Demurrer"), and a yellow **⚠ 2 motions** by the case name, as the
eCourt case page does. A motion to strike set with a demurrer is worked up with
it, as on the case page. If you split a day's motions onto rows of their own,
each row shows its own motion.

Hover a chip for its filed date as well and when it was last checked. You do
not need to open the case: the extension's hourly refresh (below) keeps every
upcoming hearing up to date, and opening the case in eCourt or its day's agenda
updates it at once too; Home picks it up within seconds. A dash means the
extension has not looked at that hearing yet. The summary line counts hearings
with a paper not filed.

With E-Court Suite 3.49.30 or later the extension also checks by itself: once
an hour on weekdays, 8 AM to 6 PM, it reads the next five court days' agendas in
your open eCourt tab and works out every hearing on them. From 3.49.36 it also
works out every other upcoming hearing on your sheet, however far out (from
each case's Hearings tab: every motion set that day), up to 80 an hour, each
again every three hours, so you need not open each case. A hearing needs its
eCourt link (on the row, or one Home found for it) to be checked this way. The summary line says
when it last checked ("Briefing checked 3:05 PM") or why it could not ("eCourt
sign-in needed", "no eCourt tab open"). **Refresh from eCourt** in the Hearings
heading asks for a check at once: Chrome opens an eCourt tab, the extension
checks, and the tab closes. Open the eCourt agenda once after updating, so the
extension learns your agenda's address. The extension's options page turns the
hourly check off.

After pulling E-Court Suite, reload the extension. Its native host writes the
status to **E-Court Briefing Status.json** in Downloads, which Home reads (so
Downloads must be linked).

## The sheet kept up to date from eCourt

With E-Court Suite 3.49.32 or later, you no longer need to paste the agenda.
The extension's hourly check also reads the next **ten court days'** agendas,
and Home writes them into your hearings sheet:

- **New hearing**: added on its day, in the same words, order and layout as
  Copy All and your paste would give it (its date row, blank rows and cell
  styles copied from your sheet), with the case name linked to eCourt.
- **Taken off or continued**: when a case leaves its day's agenda and its
  Hearings tab says why (vacated, taken off calendar, continued to …), its
  Motion Type and Case Name cells turn red, as Off calendar does.
- **Moved**: every upcoming hearing on your sheet, however far out, is also
  checked on its case's Hearings tab (Home writes the list to
  `PDF+ Hearings Sheet.json` in Downloads for the extension; up to 60 cases an
  hour, so a long sheet is covered over a few hours). A hearing continued or
  rescheduled turns red on its old day, which then reads **Moved to Jan 14**
  on Home, and is written under its new day at once, where its row reads
  **Moved from Dec 2**. One taken off calendar turns red. The case needs its
  eCourt link (on the row, or one Home found for it) to be checked.
- **Gone with no word why**: nothing changes in the sheet. Home lists it as
  "Check …" with **Off calendar** and **Keep** buttons.

Nothing changes silently. Every change is listed in **Calendar changes** at
the top of Hearings, with **Undo**: an added row is taken back out (and not
added again), and a red mark is taken off. A Windows notification from PDF+
(and one from E-Court Suite when eCourt's calendar changes) says what changed.
Rows you marked Done or Off calendar, and past days, are never touched. A day
eCourt could not be read (signed out, a failed page) changes nothing.

Home writes the sheet while Excel doesn't have it open. If it is open, the
changes wait ("waiting: … looks open in Excel") and are written once you close
it. **Refresh from eCourt** in the Hearings heading reads eCourt at once.

## Claude runs

With your Claude extension and E-Court Suite 3.49.33 or later (and the
extension let in to E-Court's native host, as for the Claude button below),
each hearing shows its case's latest Claude workflow run in a **Claude**
column at the right of the row, after the folder's status (a row reads in the
order things happen: briefing, the case folder and PDF-Linker, the Claude run):

- the workflow's name;
- under it, the steps done out of the run's steps (**2/7**), coloured as the
  run stands (orange running, green finished, amber held or paused, red
  failed), and a line: **Running step 3**, **Finished 3:10 PM**, **Held:
  usage limit**, **Paused before 4**, **Failed at step 3**, or **Queued**.

It shows the run going now, or else the case's most recent one from the last
week (an older run is usually for an earlier motion in the case); a case with
none shows nothing. If no run ever shows, open the Claude
extension's Options: a line under its Workflows toolbar says whether PDF+'s
Home is getting its runs, and if not, the one command that fixes it.

Hover the column for the run's history, a line per step with its chat and how
long it took, as in the extension's Options. Click it to open the chat the run
last worked in. The summary line counts the runs going now ("2 Claude runs
going": running, queued or held for a usage reset, and moved in the last 12
hours; hover it for each one, including runs whose case isn't on the list). A
run that failed or that you paused isn't counted, and one still listed as
running that hasn't moved in half a day reads **Stalled since …** on its row:
continue or cancel it in the Claude extension's Options.

The extension updates the file whenever a run changes, and every five minutes
while one is going. If a run says running but nothing has come from the
extension in a quarter of an hour, the line reads **No word since …** (is
Chrome open?).

## Setting up a Claude workflow run

In PDF+, each hearing whose case folder Home found has a **Claude** button.
Press it for a menu of your Claude extension's workflows and pick the one to
run: the extension opens in Chrome and sets the run up by itself, with the
hearing date as its run date and the case folder's papers added, exactly as if
you had picked the folder with Choose folder… (only its Text Files go up, the
key is attached, a folder marked LEAKS never uploads, a PDF asks first). Look
it over and press **Save and start this run**. **Choose in the Claude
extension…**, last on the menu, opens its Workflows with the case named for
you to press Create run yourself; it is also what the button does when the
extension has not yet listed its workflows (an older version of it).

PDF+ works out where the folder is on your computer by itself: from the path
its PDF-Linker launcher records, from where it sits in Downloads or a folder on
the Folders list, or by looking for its name under Downloads, Desktop,
Documents, OneDrive and your home folder. It only uses a place where a file of
the folder is there at the same size. If it still can't tell (say, two copies
of the folder), add the folder holding it to the Folders list.

Once, to set it up: pull and reload the Claude extension, then run the E-Court
Suite's `native-host\install.ps1 -ExtensionId <e-court-id> -ExtraExtensionIds
<claude-extension-id>` and restart Chrome.
