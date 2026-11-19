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

Anything you type in a case's **Date** cell that isn't just a date is a note.
A **\*** appears after the case name; click it to read the note, and click
again to close it. The hearing keeps the date written above it, or the date
the note names ("Continued to 1/5/27").

## Download status

Each hearing is matched to its case by the case number, in the case name or in
the eCourt link. When its case folder is found, in Downloads or among the
folders opened in the app, the hearing row *is* that folder:

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

## The row's buttons

The buttons on a row are icons; hover one for its name. From left to right:
Word (open the folder's Word documents), Log to share, Prioritize (PDF-Linker's
line), Done, Off calendar or On calendar, and eCourt.

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
a reader tab, or where a file of the same name is already there. In PDF+, the
folder's Re-run PDF-Linker launcher is updated to its new place.

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
sign-in needed", "no eCourt tab open"). **Refresh briefing** in the Hearings
heading asks for a check at once: Chrome opens an eCourt tab, the extension
checks, and the tab closes. Open the eCourt agenda once after updating, so the
extension learns your agenda's address. The extension's options page turns the
hourly check off.

After pulling E-Court Suite, reload the extension. Its native host writes the
status to **E-Court Briefing Status.json** in Downloads, which Home reads (so
Downloads must be linked).
