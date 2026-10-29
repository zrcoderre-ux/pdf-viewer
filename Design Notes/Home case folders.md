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

A folder in both is one row ("In Downloads today · Opened 3:14 PM").

## Status

`folderStatus` reads the run's own traces as the reader's run bar does
(`runMarkersIn`, `checkRun`): an empty ETA marker newer than any DONE stamp
is a run going, "stalled" once untouched for `RUN_STALE_MS` (the reader's
age); a DONE stamp is a finish, shown at the stamp file's time (the stamp's
name has a clock and no date); a key or log with no marker is an earlier run
whose stamp is gone; nothing at all is "Not run yet". `LEAKS.xlsx` standing
and quarantined exports (`Text Files/*.txt.LEAK`) are said beside a finish.
Runs going are listed first, then by the newest of opened, the run's trace
and today's files (`sortRows`).

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
site over an OPFS stand-in for Downloads).
