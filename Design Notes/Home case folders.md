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
folders each look anyway). **…and PDF-Linker now keeps the marker stamped**
(the owner: "Estimating tends to be the longest stretch, so i think the rule
is still going to have too many false positives"): one big scanned exhibit
in the estimating stretch can keep both the marker and the log silent past
any cutoff, which nothing on this side can tell from a dead run. Since
PDF-Linker's `_eta_heartbeat_on` (2026-11-03) a live run re-stamps its
marker's time every two minutes in every phase, so a live run never reaches
`RUN_STALE_MS`; a run that ended without clearing its marker stops stamping
it. The rule here is unchanged and still holds for an older PDF-Linker,
which stamps the marker only after each PDF. Tests: `test-case-folders.mjs` part 1 (a long run
by its log, a run late by its log, one quiet but short of its projected
finish, a log from the last run, the projected finish over midnight) and 2
(the stalled hover).

**A re-run started from the reader shows at once** (`textreader:run`,
`runsStarted`, `withRunStart`; 2026-11-03). The owner: "there is a bit of a
lag on the home screen between when the case folder closes and when it
recognizes that a re-run has started. Let's have the re-run button tell the
home screen directly." Home learned of a run only from its ETA marker, which
PDF-Linker writes once it is under way, and only on the next look
(`CASE_RECHECK_MS`). So the row went on saying the last run's "Finished …" after
the tab closed. Now `rerunLinker`, the moment PDF-Linker takes the run request
(`runRequestTaken`), posts `textreader:run` with the folder handle to the
shell. The shell takes it only from one of its own reader tabs and records
the start. Each look, `withRunStart` turns that folder's status into
"starting" ("Re-run started — waiting for its ETA", listed with the runs
going) until the folder's own traces confirm it: an ETA marker no older than
a minute before the start (PDF-Linker can stamp it before the reader's
half-second poll hears it was taken), or a DONE stamp after the start (the
last run's DONE, however recent, never counts). Unconfirmed after
`RUN_START_WAIT_MS` (ten minutes), the start is dropped. While a start waits,
the list is looked at every `RUN_START_RECHECK_MS` (3 s) rather than 15, so
the ETA appears as soon as it is written. A started folder in neither list is
still listed. In PDF+ the handle comes through the shim's `MessageEvent.data`
revival. Tests: `test-case-folders.mjs` parts 4b (the rule) and 9b (the list:
started, then its ETA, with no nudge).

**Take over (2026-11-04).** The owner: "can we make an easy way to do a
takeover run in pdf linker when the previous run is hung, as evidenced by the
stopped part way check in pdf+'s home screen?" PDF-Linker's launchers never
take over (its notes, "Diagnosing a run that stops": a second double-click on
a folder in flight is more often a misclick than a decision), so a hung run
was ended only by the command line its refusal wrote into `pdf_linker.log`.
Now a row whose status is "stalled" carries a **Take over** button beside it
(`takeOverButton`; rows are `.case-row` divs holding the folder's button and
this one, since a button cannot hold another). The misclick the launchers
guard against is answered twice over: the button stands only where Home
already reads the run as stopped part-way, and it acts only on a second click
within `TAKEOVER_ARM_MS` (6 s; the first asks for write access and arms it). A
second click rather than a `confirm()`, because Chrome opens an outside
program only on a click, and a dialog can outlast that.

`takeOverRun` looks at the folder afresh (a run that wrote since the last
look is no longer "stalled", and nothing is sent), reads the launcher's
folder token, opens the same `pdf-linker:` link the reader's Re-run opens
(`openAppLink`; the shell's `beforeunload` stands aside for it as the
reader's does), and writes the request file with state `"takeover"` where the
reader writes `"go"` (`run-request.js`, shared with `rerunLinker`). PDF-Linker
(`_serve_reader_request`, `_reader_take_over`) refuses where the folder's ETA
marker or log was written in the last ten minutes (a live run's heartbeat
stamps the marker every two minutes), else ends the run holding the folder's
lock (`_take_over_folder`, as `--takeover` does; nothing where the run died
and the lock went with it) and starts the folder's launcher as for "go". The
request taken, the row says "Taken over — waiting for its ETA"
(`withRunStart(..., "takeover")`) until the new run's marker replaces the
stuck one's. Not answered in 90 s (the computer not set up for the button,
the browser's question declined), the request file is taken back and the toast
names `Register Reader Button.bat` and the log's command line.

Residuals. A PDF-Linker from before 2026-11-04 reads `"takeover"` as
`"cancel"`: it logs "called off" and starts nothing, and the row says "Taken
over" until `RUN_START_WAIT_MS` lets it go and the run reads as stopped
part-way again. A folder whose launcher records no folder token (written
before the Re-run button) cannot be reached from here; the toast points to
the log's command line. Tests: `test-case-folders.mjs` part 4b (the taken-over
status and the stalled hover) and 14 (the button on a stalled row only, the
first click arming, the second sending the link and `"takeover"` with one
nonce, the row then taken over); PDF-Linker's side in its
`tests/test_reader_rerun_button.py`.

## PDF-Linker's line (2026-11-04)

The owner: "I want to add a way where I can, from the home screen on PDF+,
indicate the priority order of cases running or to be run with PDF Linker.
The higher priority indicates that i need it done sooner, and it should cut
the line for access to cores and whatever other processing it needs that is
in short supply." Each row (one Home can read) carries the line's controls
(`lineControls`): **Prioritize** on a row not in line puts the folder at the
end of it; a row in line shows its place ("1st", `ordinal`) with ▲, ▼ and ✕
(up, down, out; `changeLine`). The line is listed first, in its order, ahead
of the runs going (`sortRows`), and holds running folders and ones still to
be run alike: a place given before the run starts is waiting for it.

**Where the place lives.** A page cannot write anywhere machine-wide, and
each PDF-Linker run reads only its own folder, so each folder's place is
written into it as `PDF-Linker Priority.json`, `{"rank": n, "set": <ms>}`
(`PRIORITY_FILE`, `priorityText`; PDF-Linker's `_run_priority_read` reads
it, and the two change only in step). A change writes only the folders whose
place moved, after asking leave to write into each on the click (PDF+ grants
it; a browser may ask once per folder), and drops each from `downloadsSeen`
so the next look reads it again; `readListing` reads the file's words
(`parsePriority`), not just its time. A look that finds gaps (PDF-Linker
removes a folder's place when its run finishes) closes them where Home may
already write (`compactLine`; nothing is asked on a look), so each file says
the place Home shows. The buttons find their folder's row of the latest
look by `isSameEntry` (`currentRow`): a look that changes no text does not
redraw, and its rows are new objects.

**A place is spent once the folder finishes a run after it was given**
(`liveRank`): a DONE stamp newer than `set` means the case is done, here and
in PDF-Linker, and the finishing run also removes the file. A finished case
put in line again (to be re-run) stands until that run finishes.

**What PDF-Linker does with it** (its notes, "OCR", the line): a run ahead of
another takes OCR cores first whenever one of its passes is short of them
(the others narrow to one core between chunks, within about a page), and the
others drop to below-normal CPU priority while it lives, so it is served
first wherever the computer is short. A run with no place stands behind
every run that has one. Nobody is stopped. A run already going reads a
reorder within 15 seconds.

**Clear** forgets the folders opened here except those in line, which could
no longer be moved or taken out from Home once forgotten.

Residuals. A folder in line that drops out of the twelve kept (twelve newer
folders opened) is no longer listed and keeps its place until its run
finishes. A PDF-Linker from before 2026-11-04 ignores the file. Tests:
`test-case-folders.mjs` parts 4c (the file's words, spent places, the line's
moves, the order) and 15 (Prioritize, ▲, ✕, the files written and removed,
and a finish taking the case out).

## The log to share (2026-11-05)

The owner: "a tool into the homescreen of PDF+ that lets me open copy of
pdf_linker.log that has all real names removed that is free to share for
diagnostic purposes", and, on a first design that read the key: "We shouldn't
need a key, because structurally pdf linker knows where it places real
values". So PDF-Linker writes the copy itself (its `_SHARE_LOG_FILE`,
`PDF-Linker Log to Share.txt`, beside the log): every message keeps the wording
of the logging call that wrote it, read off PDF-Linker's own source, and each
value set into it keeps a word only where it cannot be a name (its notes,
"Diagnosing a run that stops"). It is written from the log as it stands at the
start of each run and then line by line, so a run still going can be read.
This side redacts nothing and reads no key: a row whose folder holds the file
(`hasShareLog`, `SHARE_LOG_FILE`) offers **Log to share**, which opens the
file's text in a dialog over Home (`showShareLog`), with Copy and Save. Never
in the text reader: a reader reads a lone `.txt` through a key it remembers,
and would put real names back. A folder last run by a PDF-Linker older than
the copy has no file and no button; PDF-Linker's `--share-log` writes one from
its log. Tests: `test-case-folders.mjs` part 16.

## Word documents (2026-11-05)

The owner: "Add a button to open the word document(s) inside that case folder
to the pdf+ home screen". A page cannot start Word, so the button stands only
in PDF+ (`canOpenWord`: the bridge's `openDocument`, absent from an installed
PDF+ older than the app files it runs). preload.js reads the file's path
(`webUtils.getPathForFile`, on a File the page holds) and main.js
(`pdfplus:open-document`) opens it with `shell.openPath` only where it is an
existing Word-type file (`WORD_DOC`: .docx .docm .doc .dotx .rtf), never
Word's `~$` lock file, and only for PDF+'s own pages. The documents are the
folder's own, not its subfolders' (`wordDocs`); one opens at the click,
several are listed under the button with Open all. The list stands on the
page (`position: fixed`), not inside the row, since the case list's box
clipped it; a scroll or a resize closes it. Tests: `test-case-folders.mjs`
part 17 (with a stand-in bridge; the desktop test does not cover it).

**It opened nothing (2026-11-06; the first build above is wrong on this).**
The owner: "Could not open … Petition to Confirm Minor's Compromise
11.9.2026.docx (PDF+ opens only a Word document this way.)". Home reads a
case folder through its handle, and a File read that way carries no path:
`getPathForFile` gives "", which main.js refused as no Word document. The
desktop test had handed the bridge files from an `<input>`, which do carry
one, so it passed while the button never worked. Now the page also says
where the folder may be (`wordDocPlaces`): its place under the Downloads
Home lists (`dl.resolve(handle)`, joined by main.js to the computer's own
Downloads) and the folder its PDF-Linker launcher records (`folderLauncher`,
`folderPathOfToken`, the Re-run button's token). main.js (`wordDocAt`) opens
the first such place where a Word document stands with the File's own name,
size and time to the second, so the page can point at nothing it did not
read; a folder part may not be "..", a separator or empty. A folder outside
Downloads that no PDF-Linker has run on has no place to name: the toast says
so and to open it from File Explorer. The desktop test now hands the bridge
a File with no path, opened through the launcher's folder and through
Downloads, and refused where the file there is another or the parts climb.

## When the run going started (2026-11-05)

The owner: "update the home screen case folders run to show what time the
run started and how long it has been going". Nothing Home read said so: the
ETA marker is renamed as the run goes and re-stamped every two minutes. Every
PDF-Linker opens its run with a "Run started for folder:" line in
pdf_linker.log, so the start is that line's time (`lastRunStart`), read only
while an ETA marker stands. `readRunStart` (app-web.js) reads the log from its
end in 512 KB pieces (up to 64 MB) until it finds one, then on later looks
only what the log added, by folder name and the log's size; a log that
shrank is read again from its end. A start older than the last DONE stamp is
the last run's and is not shown. The row's second line says it ("Started
1:04 PM · going 1h 15m", `runningSub`), for a run going and one stopped
part-way, whose hover says it too; the pill keeps the ETA, which a longer
pill cut off. Tests: `test-case-folders.mjs` parts 4b2 and 18. The test's
part 14 moves the clock two hours on, so run late in the evening it crosses
midnight and the folder is no longer "today": run it with `TZ` set to a zone
where it is daytime.

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
