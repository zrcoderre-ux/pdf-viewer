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

## Download status

Each hearing is matched to its case by the case number, in the case name or in
the eCourt link. The pill says:

- **Downloaded**: a case folder for it is in Downloads or among the folders
  opened in the app. The line under the name gives the folder and what
  PDF-Linker has done in it. Click the row to open the folder.
- **Zip in Downloads**: the case's zip has not been extracted yet.
- **Not downloaded**: nothing for it yet. Click the row, or **eCourt**, to open
  the case in eCourt.

A folder is recognised by the case number in its name, or by the Register of
Actions the E-Court Export saves into it. Name case folders with their case
number for the surest match.

The Case folders list below shows each folder's hearing date and motion too,
with its own **eCourt** button.
