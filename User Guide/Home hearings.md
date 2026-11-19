# Hearings on Home

Home lists your upcoming hearings from your own Excel sheet and shows, for
each one, whether its case is downloaded yet.

## Linking the sheet

Open the settings menu (the sliders button at the top right of Home) and
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
| **Case Name** | The case. Its hyperlink to eCourt is the **eCourt** button. |
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

If the workbook is open in Excel, Windows won't let anything else write to it.
Home still shows the change, says it is waiting, and writes it into the sheet
as soon as Excel closes the workbook. It doesn't overwrite what you saved in
the meantime.

## Notes

Every hearing has a **sticky note** before the case number. An outlined note
means there is no note yet; click it to write one. A yellow, filled-in note
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

- A case folder that is **still in Downloads** has an amber stripe down its
  row and a **Downloads** chip by its name: those are the ones left to file.
  Drag the row onto a folder on the left to file it.
- The pill says what PDF-Linker has done in it (Not run yet, Running — ETA …,
  Finished …), and the line under the name names the folder.
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

Each row shows only what you want to see for every case at a glance: the sticky
note, case number and name, the ✓ when done, the Downloads icon, the motion and
folder, the briefing chips, PDF-Linker's status and the case's place in
PDF-Linker's line.

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

PDF-Linker's status is a small dot: green finished, amber something to answer
or a run that looks stopped, blue (pulsing) running, grey not run yet. Click
the dot to read it in full ("Finished 2:40 PM"), and again to close it.

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
and **Rep** chips, coloured as the eCourt case page colours them:

- green ✓ filed on time;
- red ! filed late, red ✗ not filed;
- amber ! late for electronic service but timely if personally served (check
  the proof of service);
- plain: not due yet; dashed ?: nothing on file yet, but eCourt may not have
  posted it.

Hover a chip for its due and filed dates and when it was last checked. The
extension checks whenever you open the case in eCourt (the eCourt button) or
open that day's agenda, and Home picks it up within seconds. A dash means the
extension has not looked at that hearing yet. The summary line counts hearings
with a paper not filed.

With E-Court Suite 3.49.30 or later the extension also checks by itself: once
an hour on weekdays, 8 AM to 6 PM, it reads the next five court days' agendas in
your open eCourt tab and works out every hearing on them. The summary line says
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
  Motion Type and Case Name cells turn red, as Off calendar does. A continued
  hearing is added under its new day once that day is within the ten.
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

## Setting up a Claude workflow run

In PDF+, each hearing whose case folder Home found has a **Claude** button.
Press it and your Claude extension's Options opens in Chrome on Workflows, with
the case named. Press **Create run** on the workflow you want: the run opens
with the hearing date as its run date and the case folder's papers added, exactly
as if you had picked the folder with Choose folder… (only its Text Files go up,
the key is attached, a folder marked LEAKS never uploads, a PDF asks first).

Once, to set it up: pull and reload the Claude extension, then run the E-Court
Suite's `native-host\install.ps1 -ExtensionId <e-court-id> -ExtraExtensionIds
<claude-extension-id>` and restart Chrome.
