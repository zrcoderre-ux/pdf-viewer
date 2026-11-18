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

A folder is recognised by the case number in its name, or by the Register of
Actions the E-Court Export saves into it. Name case folders with their case
number for the surest match.

## Case folders not on the hearings list

Above the hearings, Home lists only the case folders that match no hearing on
the list: a case whose hearing is past or marked done or off, one not on the
sheet, or one the matching missed. Each says its hearing where the sheet has
one, with the same buttons. When every folder is on a hearing, the list is not
shown. **Link Downloads…** is in the Hearings heading.
