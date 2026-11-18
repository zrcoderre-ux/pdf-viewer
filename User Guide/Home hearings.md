# Hearings on Home

Home lists your upcoming hearings from your own Excel sheet and shows, for
each one, whether its case is downloaded yet.

## Linking the sheet

Click **Link hearings sheet…** in the Hearings heading and pick the workbook
(`.xlsx` or `.xlsm`). You link it once. Home reads it again each time you save
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

## Off calendar and On calendar

Each hearing has an **Off calendar** button. It fills the row red in your
sheet, just as you would by hand, and the hearing leaves the list. With **Show
done and off**, a red row has **On calendar**, which takes the red off.

If the workbook is open in Excel, Windows won't let anything else write to
it. Home still shows the change, says it is waiting, and writes it into the
sheet as soon as Excel closes the workbook. It doesn't overwrite what you saved
in the meantime.

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
- Click the row to open the folder in one reader.

Otherwise the pill says **Zip in Downloads** (not extracted yet) or **Not
downloaded**; click the row, or **eCourt**, to open the case in eCourt.

An **Order Template Input** sheet in Downloads more than two days old does not
count toward Files in Downloads: it is most likely from an earlier motion in
the same case.

A folder is recognised by the case number in its name, or by the Register of
Actions the E-Court Export saves into it. Name case folders with their case
number for the surest match.

## The row's buttons

The buttons on a row are icons; hover one for its name. From left to right:
Word (open the folder's Word documents), Log to share, Prioritize (PDF-Linker's
line), Off calendar or On calendar, and eCourt.

## Case folders not on the hearings list

Above the hearings, Home lists only the case folders that match no hearing on
the list: a case whose hearing is past or marked done or off, one not on the
sheet, or one the matching missed. Each says its hearing where the sheet has
one, with the same buttons. A folder whose hearing is marked done or off
calendar is not listed, unless PDF-Linker is running on it. When every folder
is on a hearing, the list is not shown. **Link Downloads…** is in the Hearings heading.

## Folders: moving a case into a folder

The **Folders** list on the left of Home shows Downloads and the folders you
add with **+ Add** (the folders you file cases into). Click a folder to open
it, as in File Explorer.

Drag a case's row (a hearing with its folder, or a row in Case folders) onto a
folder. Home asks "Move … into …?" and **Move** moves the whole case folder
there. The hearing keeps its folder, its PDF-Linker status and its buttons
until the hearing date has passed.

Home won't move a folder while PDF-Linker is running on it, while it is open in
a reader tab, or where a file of the same name is already there. In PDF+, the
folder's Re-run PDF-Linker launcher is updated to its new place.
