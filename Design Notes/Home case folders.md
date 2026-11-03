# Home's Case folders list (`pwa/app-web.js`, `viewer/case-folders.js`)

Home lists the matters in hand, each with what PDF-Linker is doing in it, and
a click on a row opens the whole case folder in one reader, as Open a case
folder does (`openCaseFolder`, split out of `pickCaseFolder`; a tab already
reading that folder, by `isSameEntry` on its `__textReaderSource().dir`, is
brought to the front instead of a second reader).

## Which folders

- **Opened here.** Every case folder opened from Home or the strip, or from a
  row, and every one a reader tab attaches however it came to it: the reader
  posts `textreader:folder` with the handle from `adoptFolderNow` (never for a
  Text Files folder), and the shell takes it only from one of its own tabs.
  Kept in the `pdfviewer-folders` IndexedDB (`folders`, newest twelve, one per
  folder by `isSameEntry`), a database of its own so no other window's open
  connection to `pdfviewer-recent` blocks an upgrade. **Clear** forgets them.
  One that cannot be read is not listed (it used to say "Not found — moved or
  deleted?"; the owner: "it should just stop listing that case"), and one the
  disk answers `NotFoundError` for (moved, renamed or deleted) is forgotten
  too, so it does not hold one of the twelve places. Any other failure, a
  synced or network drive away for now, only leaves it out of that look.
- **In Downloads today.** A page cannot read a folder by its path, so
  Downloads is linked once through a dialog that starts there
  (`startIn: "downloads"`), with read leave only, and the handle kept in the
  same database (`places`, `downloads`). A browser may want the leave given
  again next session, on a click ("Allow Downloads"); PDF+ grants it.
  A subfolder of it is listed where it is a case folder (`isCaseListing`: a
  PDF or Word document, a key, a run marker, the log, an export or a Text
  Files folder) and is today's (`isToday`): a file in it written since local
  midnight, or a `.zip` of its name that came down today, since Windows'
  Extract All keeps the times the files had in the zip.

**In PDF+ only the day's folders are read.** Reading every folder of
Downloads for its files' times was slow on a Downloads holding years of
cases, and the list showed nothing until it finished; and the files' times
miss a case copied or extracted today, since Windows keeps the times a file
had. So the main process lists Downloads' own folders by the FOLDERS' times
(`pdfplus:downloads-today`: the later of created and modified, which moves
when anything in it is added, renamed or removed, a run's ETA marker
included) and hands back their names and times only, never a path; the page
opens each through the linked handle (`getDirectoryHandle`) and keeps those
that are case folders. Where the linked folder is not the Downloads it lists
(compared by name), or the installed PDF+ predates the call (app files run
from a newer checkout), every folder is read as in a browser.

A folder in both is one row ("In Downloads today · Opened 3:14 PM").

## Status

`folderStatus` reads the run's own traces as the reader's run bar does
(`runMarkersIn`, `checkRun`): an empty ETA marker newer than any DONE stamp
is a run going, "stalled" only where the run looks dead (`runLooksStalled`,
below); a DONE stamp is a finish, shown at the stamp file's time (the stamp's
name has a clock and no date); a key or log with no marker is an earlier run
whose stamp is gone; nothing at all is "Not run yet". `LEAKS.xlsx` standing
and quarantined exports (`Text Files/*.txt.LEAK`) are said beside a finish.
Runs going are listed first, then by the newest of opened, the run's trace
and today's files (`sortRows`).

**Stopped part-way? (2026-11-03).** The owner: "For large case folders that
take a long time to finish, the home screen falsely flags them as Stopped
part-way". The rule was the ETA marker's age alone (30 minutes), but
PDF-Linker rewrites the marker only after each PDF (`_write_eta_marker` in
its run loop), and before the first it OCRs the whole folder
(`_pre_ocr_folder`): a large folder, or one long scanned filing, holds the
marker still for an hour or more while the run writes `pdf_linker.log` file
by file. Now a run is "stalled" only where neither the marker nor the log has
been written for `RUN_STALE_MS` (a log older than the marker is the last
run's and does not count) AND the finish the marker projects
(`projectedFinish`: its clock, on the first day from the marker's time, so
"~1:10 AM" written at 11:40 PM is the next day) is `RUN_STALE_MS` past; a
marker with no clock ("(estimating...)") goes by the writing alone. Home's
hover says when the log was last written, and the stalled one says why it is
thought so. The reader's run bar asks the same (`runMarkersIn` reads the
log's time; `showRunning`). In a browser, a Downloads folder with a run going
is read again on every look, since its names hold still through a long PDF
and only the log's time moves (`todayInDownloads`; PDF+ reads the day's
folders each look anyway). Tests: `test-case-folders.mjs` part 1 (a long run
by its log, a run late by its log, one quiet but short of its projected
finish, a log from the last run, the projected finish over midnight) and 2
(the stalled hover).

## Cost

Every `getFile` is a trip to the disk, so a listing reads times only off the
files that say something (`signalFile`: the markers, log, run record, key,
worksheet, and the first `DOC_STATS_MAX` documents). Downloads holds every
case ever downloaded, so each of its folders is read by its names first and
read again only where the names changed (a run renames its ETA marker after
every PDF, and DONE replaces it) or the day did (`downloadsSeen`); a zip's
time is read once (`zipTimes`). The list is looked at again every
`CASE_RECHECK_MS` while Home is up and the window visible, and on focus, and
redrawn only where a row's text changed, so a hover or a keyboard focus is
not knocked off it.

Tests: `test-case-folders.mjs` (the rules in node; the list in the assembled
site over an OPFS stand-in for Downloads, a folder deleted from it dropping
out of the list).
