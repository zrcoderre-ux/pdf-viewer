## Text reader for PDF-Linker's exports

PDF-Linker scrubs a case's filings into `Text Files/*.txt` and writes
`pseudonym_key.xlsx`, the real↔fake map. The **text reader**
(`viewer/text-reader.html`) reads those exports the way this viewer reads a
PDF — and puts the real names back **on screen only**. Open it from the
toolbar popup (**📝 Open text reader**), or open a `.txt` in the installed
app, which routes it to the reader tab.

- **A whole matter in one pick (the installed app).** PDF-Linker leaves a case
  in one shape: the folder holds `pseudonym_key.xlsx`, the PDFs, `LEAKS.xlsx`
  and — where the run made one — `Combined Text.txt`, with the exports
  themselves in a **Text Files** subfolder under it. So the app opens the
  **folder**, not the files: **📁 Case folder** on the tab strip, or the button
  on the empty page with nothing open yet. **One pick, one tab.** The combined
  file where the run made one — it *is* every export, in one document — else
  the first export, and it comes up with the case folder already attached: its
  key in force, its PDFs matched, its worksheet and flagged list to hand,
  because the folder is handed to the reader with the document instead of
  being asked for afterwards. The rest of the matter is inside that one
  reader, which is where it belongs: every export is listed in its Documents
  panel and built ahead of the click, the folder reads **on** so the next one
  hangs under the last as the page reaches it, the leak walk steps out of one
  document and into the next by itself, and Find reads the whole folder. A tab
  per export gave none of that — forty readers each compiling the same key,
  each knowing only its own document, and the tab strip to hunt through for
  whichever file the walk had just named. **Files still open as files**,
  by every route they ever did: the **+** tab and the empty page's own click
  (a multi-select picker), a drop anywhere on the window, and the system's
  own "open with" — `.pdf`, `.txt` and a quarantined `.txt.LEAK` alike. A
  folder picked with no exports in it offers the file picker rather than
  leaving a dead end.
- **The tools stand down the left margin.** The reading, pseudonym, review and
  PDF tools are in a **Tools** panel on the left — the same rail the PDF viewer
  carries — in labelled groups: *Reading* (font, size, leading, width, line
  lock), *Pseudonyms* (key, mark and its colour and intensity, show fakes, key terms),
  *Review* (flag a real value, the LEAKS worksheet, auto-scroll) and *PDF*
  (side by side, PDF pages). The top bar keeps only the document's own
  actions — open a file or a case folder, Edit, Save — and the settings that
  belong to the window: the citation provider, **§ Authorities**, **▤ Panel**
  and the theme. **Tools** at the head of the rail collapses it to an icon
  strip and back, and that choice is remembered.
- **Pages, in your font.** Each `====== Page N ======` block is laid out as a
  sheet, with the printed page number and any REVIEW clause on its label. A
  page numbered down its margin — pleading paper — is laid out as one: the
  numbers stand in a **ruled margin** of their own, a vertical rule and a gap
  between them and the body, and each numbered line hangs under its number
  so a wrapped continuation never crosses the rule. Pick the font (Georgia,
  Times, Charter, Palatino, system sans, Arial, Verdana, Courier, Consolas, or
  any installed family by name), size and leading. **There is no page width to
  set:** the sheet is 8.5 inches of paper and nothing the reader does moves
  it. Those are
  **remembered as the defaults**: the font and leading chosen once are what
  every text file opens in from then on — set them in the reader's Tools panel
  or under Options → "Text reader — default font and leading", and every open
  reader tab follows at once. Display only: the text file itself is never
  changed. Light and dark chrome follow the viewer's own theme toggle.
- **Zoom magnifies the page, the way a PDF does.** **Ctrl+wheel**,
  **Ctrl+plus/minus** and the **Zoom** buttons draw the page **larger**, and
  nothing on it moves or changes size in relation to it: the layout at 200% is
  the layout at 100% under a magnifying glass — the same words on the same
  lines, in the same places on the paper — and what no longer fits the window
  is scrolled to. A PDF gives you no way to reflow its text when you zoom, and
  neither does this. **Ctrl+0** puts the page back to its own size, and the
  percentage between the **Zoom** buttons is a field: type a number ("150" or
  "150%") and press **Enter** for that zoom, from 25% to 500%; **Escape** or
  clicking away puts back the zoom in force. The
  gesture is caught before the browser can scale the whole window — toolbar,
  tools panel, status bar — which is the part nobody wanted bigger, and a
  trackpad pinch is added up and spent a step at a time. The scale is applied
  in the page's own pixels rather than as a picture blown up, so the type is
  drawn at its real size and stays sharp at any magnification, and everything
  the reader measures goes on being measured in one space.
- **The page you are reading stays on the screen.** Zooming, Side by side,
  the font, the leading, a panel or a bar opening, the window resized, a page
  fitted or laid on the PDF's grid as the reading comes near it, a page shown
  from its PDF — each of these lays pages out again, and every page above the
  reading that changes height used to move the reading with it, a zoom on
  page 12 leaving you on page 11 or 14. The line at the top of the window is
  noted as you scroll and held there while the pages settle, the PDF pane
  following it side by side. Scrolling, a jump to a word, and auto-scroll
  each take the scroll back at once.
- **A page is a page.** Each sheet takes the **shape of the PDF page it came
  from** — its proportions at whatever width you are reading at — so an export
  reads as the document it was filed as instead of a stack of notes: a caption
  page half the height of the one after it, a short exhibit page a strip, a
  banner page a band. The words are untouched: they flow as they always did,
  in your font at your size, and it is the paper under them that changes. A
  floor, never a ceiling — a page whose text wants more room than the shape
  gives it (a large reading size against a dense page) grows, because the
  words come first. Nothing is read from a PDF until the pane is opened, so
  until then the document's prevailing shape stands in, and US Letter portrait
  behind that; a landscape exhibit reads portrait until its PDF is opened and
  takes its own shape the moment the sizes land.
- **The paper never gives; the type does.** The sheet is a page — 8.5 inches
  at 96 to the inch, or the stage where that is narrower, since a page that
  will not fit the screen is no use — and **zooming makes the type bigger and
  the paper not at all.** **Nothing leaves the paper**, either: a numbered
  line is never wrapped (its tail would fall on a screen line with no number,
  one line off from the PDF), so it runs past its column — and is **cut where
  the sheet ends** rather than painted out over the gap beside it. Cut, not
  shrunk: one runaway line does not take the whole page's type down with it.
  What widened the page for such a line was **Line lock**, and that is why it
  is gone.
- **The shape is a ceiling: the type gives way, not the page.** A page whose
  words want more room than its PDF page gave them — the reading size is
  yours, and the filing was set in whatever it was set in — is **drawn
  smaller** until they fit, the way the PDF itself is at that zoom: the
  **largest** size that holds the page, searched for, so a dense page whose
  long lines wrap at the reading size is taken down only until they stop
  wrapping and the words fill the sheet, not halved to the floor. A page shown
  from its PDF (⇄ PDF) or as the file has it (⇄ Raw) keeps its fit, and
  comes back at that size. Display
  only: the file is one size. **The fit is measured at the default size, not
  at the size you have zoomed to** — measured at the zoomed size it would take
  back exactly what the zoom had just added, and zooming in would do nothing —
  so at the default every page holds its words, and from there zooming in
  makes them bigger and lets the page run on past the foot of the paper. The
  floor is half that size; past it the page grows instead, because a sheet the
  right shape with nothing legible on it is no use.
- **The PDF's own type sizes, where they are known.** On a page the PDF sets
  in more than one size — an order's caption, a heading, an exhibit's small
  print, a footnote — each line takes **its own row's size**, as a multiple of
  the body size, so the page reads with the filing's own shape to it while the
  words still flow in your font at your size. Pleading paper is one size down
  its column and is left alone. This needs the PDF's text layer, which is read
  when the pane is first opened, so a document read without ever opening the
  pane is set in one size throughout.
- **The export's own trailer is clipped beside the PDF.** PDF-Linker ends an
  export with a `====== Authorities cited (public verification links) ======`
  rule and a line per authority. It is part of the file — it round-trips, it
  saves, it is translated under the key like everything else — and no part of
  the filed document, and the PDF beside it has no such page. While the pane
  is open those lines are hidden, so the last sheet keeps the shape the rest
  of them hold; with the pane closed they are shown, and the page carrying
  them is left to flow rather than have the filing squeezed to make room for
  the links. Hidden, never removed: a save still writes it.
- **The boxes are drawn, whatever the font.** PDF-Linker draws a page's
  line art — a court form's caption box, a pleading's caption divider, a
  section rule, an underline — into its export with the box-drawing glyphs
  (`─`, `│`, the corners and tees), which is a box only in a monospace font at
  single spacing: any other font puts one column's bars at different places on
  different lines, and any leading cuts a vertical rule into a stack of short
  strokes. The reader draws the box instead. A line carrying bars is laid out
  as a row of cells split at its bars, consecutive lines whose bars stand at
  the same character positions share one table, so a bar column is one
  unbroken line down the page in Georgia at any leading exactly as in
  Consolas; a line that is nothing but rules (a box's top, a divider) is a
  hairline at half a line's height, and an underline inside a row is a line
  under its own width. The glyphs stay underneath — a save and a copy read
  exactly what the file says, and the bars are located in the file's own
  text, so a row whose real name is longer than its fake is still a row of
  the same box. A box never wraps — a wrapped cell is a box with a hole in it
  — and it **never widens its sheet** either: a box wider than its paper is
  **drawn smaller** until it ends at the page's right margin, its columns
  squared up again at that size and the numbered margin beside it left at its
  own. (A sheet widened for one wide table put every other page in the
  document off centre, in a column as wide as that table, with the stage
  scrolled sideways into grey.) Two boxes stacked with
  different widths keep their own columns; the one row between them that
  belongs to neither is drawn on its own and sized to the box under it. A
  page laid on its PDF's grid (side by side) positions every line on its own,
  so there each box's rows are measured together after every layout pass —
  every column set to its widest cell, the rows given one left edge, and each
  row made as tall as the gap to the next so the bars meet — the box is a box
  there too. **Text inside a box keeps the export's indent**: on pleading
  paper "Plaintiff," under the party's name, "vs." and "Defendants." used to
  stand flush against the side of the caption box; they now stand as far in
  as the export sets them, on the same grid as the page's other indented
  lines, in the reading view and side by side. A box or a rule the export
  draws in from the margin is drawn that far in too, and a box drawn smaller
  to fit its paper takes its indents down with its type.
- **Columns stand where the export put them, whatever the font.** A
  two-column page — a Westlaw printout, a caption with the case number beside
  the parties, the clerk's filing stamp beside the attorney block — reaches the
  export as one character grid, its second column held apart by a run of
  spaces. That is a layout only in a monospace font: in Georgia a space is
  about half as wide as a letter, so the right-hand column used to begin
  wherever the text to its left happened to end, a different place on every
  line, and indents and centred headings drew at half their depth. The reader
  now lays the grid out in the font it is reading in: a gap of three spaces or
  more (or two, where the lines around it begin a column at the same place)
  starts a column, every column stands at its own place on every line,
  an indent is as deep as the export made it, and a sentence's double space is
  left alone. A left-hand piece too wide for its share of the grid — capitals
  run wide — pushes only its own line's right-hand column on, by a small
  margin, and never runs into it. **A page set in two columns reads as two
  columns.** Its right-hand column stands at one place on every line beside
  it, set out past the widest line of the left-hand column with a gutter of
  four characters' width, so a justified left column or a page in capitals no
  longer runs into the column beside it or leaves it ragged. The lines of a
  justified column that reach the right-hand one with a single space or two
  are split there too, above and below the lines that fall short of it, and a
  column an OCR'd page sets a character off on some lines is still one column.
  A page in columns is set no larger than its widest column line fits across
  the paper, so a column never wraps back to the left margin. On pleading paper the columns are counted from the body margin,
  and a numbered line now keeps its indent too — the spaces after the number
  used to be dropped with the number, so a centred heading sat at the margin
  and a line of the caption's right-hand column alone on its number (a cause
  of action, "DEMAND FOR JURY TRIAL") fell back to the left side of the page.
  The caption's columns hold side by side as well, measured in the PDF's body
  type, so the list of causes of action stands in one column down the caption
  there too. Side by side, a page whose every line has both columns takes its
  grid from where the PDF prints the right-hand halves, so that column stands
  where the PDF has it instead of wherever each left-hand line ends. Display only: the spaces are all still there, and a save, a copy, Find and
  the LEAKS walk read exactly what the file says. In the editor the gaps' own
  spaces are drawn, so what is typed into one is seen, and a line is laid out
  again once the typing stops.
- **Print what you see — in its pseudonyms.** **🖨 Print** (Ctrl+P) sends the
  pages as they are shown to the browser's print dialog, where "Save as PDF"
  keeps a copy: the font and leading in force, the drawn boxes, the pseudonym
  marks, one sheet per printed page, each sheet at its screen width and the
  lot scaled to the paper so nothing re-wraps. The chrome around the pages and
  the citation underlines are left off. **The names are the one thing the
  printout does not take from the screen.** A printout leaves the room, so a
  print does to the pages what a save does to the file: the forward pass over
  every page — the values kept for the case and the spot keeps left exactly as
  they read — and then the pseudonyms on show, whichever way *Show fakes*
  sits. Paper and PDF carry the scrubbed copy without anyone having to
  remember. The document itself is not touched: the pages go back as they were
  when the dialog closes, nothing is written, and a real name standing unfaked
  is still standing and still orange, to be dealt with before a save.
- **Screenshot the window, for the design.** **📷 Screenshot** saves the
  whole reader window as it stands — toolbar, panels, bars, the PDF pane and
  the pages — as a PNG in Downloads, named after the document and the time.
  It is a picture of the screen for looking at the layout, not a copy of the
  document. **It is taken in the pseudonyms**, whichever way *Show fakes*
  sits: a screenshot is made to be shown to somebody, so for the moment of
  the capture every real name the key binds that is on screen is shown as
  its fake — on the pages (names the run missed included), in the bars and
  panels, in the Find box, and over the PDF in the pane, where each name is
  covered with its fake. The values kept for the case, the spot keeps and the
  parties of cited decisions read as they stand, as in the print. The screen
  goes back the moment the picture is taken; nothing is written. A PDF page
  with no text (a scan) cannot be read for names and keeps them. In the
  extension the tab is taken directly; in the hosted app the browser asks to
  share this tab, keeps one frame and stops, and the names change only once
  the share is allowed.
- **Citations linked.** The same detector the PDF viewer runs underlines every
  case, statute, rule, regulation and CACI instruction and links it to Lexis+
  or Westlaw (the provider setting is shared), with the **§ Authorities**
  panel listing them once. A cite that wraps onto a numbered line is read
  across the gutter number, as `pdf_linker.py` reads it. **Under Match PDF
  grid the links are off.** An underline is a strip measured off the line it
  sits under, and the grid moves that line — against a body it has shifted,
  and again as each PDF's sizes arrive — so the strips land beside the words
  as often as under them. The authorities are still read, so **§ Authorities**
  fills as always and a cite opened from the panel opens the same page; the
  status bar says the links are off, and they come back the moment the grid
  does. Side by side without the grid leaves every line where it flows, so
  there the links are drawn and are right.
- **A name wrapped across lines is one name.** A pseudonym or a real value
  whose halves sit on two numbered lines — the line break, the next line's
  gutter number and any blank line between — is matched as one: the reader
  shows the real name half on each line (the tooltip names the whole), a
  wrapped real is one leak, and a save writes the fake line by line with
  the numbers untouched. A name wrapped inside a COLUMN — a caption's
  party name with the `)` and the case number beside its first half, or a
  name at the end of a line of a page set in two columns — is read the same
  way, half on each line and the other column left where it stands: a
  pseudonym shows the real name, and a real name standing in the clear is
  marked orange as one leak (both halves), walked to, kept or faked like any
  other, and written as its fake piece by piece when you save. A real name that should stay — a cited decision
  bearing a party's surname — is **kept** from the orange mark itself:
  right-click it (or select it and take **Keep…**), and *keep in this case*
  or *never fake it* leaves it as it stands, on save and on PDF-Linker's
  next run, the same keep a wrongly faked pseudonym takes. The same
  right-click offers **Fake it**, the names bar's answer: every occurrence of
  the name is written as its pseudonym on the next save. It reaches a name
  the walk has gone past, or one it does not stop on because the LEAKS
  worksheet has a row for it.
- **Real names from the key.** **Open case folder** picks the matter's folder
  and takes only `pseudonym_key.xlsx` and the exports out of it (a
  `*.txt.LEAK` quarantined by PDF-Linker's leak gate is listed too, marked,
  and opened first — it is the one to read). The reader **remembers every case
  folder it is shown**, so a document opened on its own afterwards — from the
  file picker, a drop, or the installed app's file handler — is matched to the
  folder it sits in (its own folder, or the one above `Text Files`) and that
  folder's key is attached automatically; where the browser wants the folder
  re-authorised first, a bar offers it in one click, and a file from a folder
  the reader has never seen gets an offer to open it once — **and the picker
  opens where the file is**, so the case folder is already on screen and the
  pick is one click. (A page cannot walk up from a file to the folder holding
  it: the browser hands over a file and nothing above it, which is why the
  first folder is picked at all. After that it is remembered.) **Picking the
  Text Files folder by mistake is caught**: it is where the exports are, so it
  looks like the place, and everything that makes a case folder one — the key,
  the PDFs, the worksheet, the flagged list — is the level above. The reader
  says so and opens the picker there again, with the folder above one click
  away. Every fake is shown as its real value in the case the fake was written
  in, **lightly highlighted**, and hovering shows the pseudonym underneath.
  The highlight's **colour and intensity** are yours to set (the swatch and
  slider beside "Mark pseudonyms", or under Options), and are remembered like
  the font — **written the moment you choose them.** Every reading setting is
  kept in two places: the local copy, written at once and the one the next
  session opens from, and the synced copy the Options page and a second tab
  read, written a beat after the dragging stops. The synced store takes 120
  writes a minute and rejects the rest, and a colour is chosen by DRAGGING: a
  write per pixel spent that quota in the first second, so the colour finally
  settled on was the one most likely to be refused — on screen for the
  session, yellow again the next morning. Each copy carries when it was
  written and the newer one wins, so a synced write the browser refuses cannot
  undo the choice, and a colour set in Options while the reader was closed
  still arrives. **Mark pseudonyms** turns the highlight and the hover off;
  **Show fakes** shows the document as it is on disk. The key is read the way
  `DeAnonymize.bas` and the Claude extension read it: columns by header name,
  operator keeps skipped, alt spellings forward-only, an ambiguous fake
  retired, the pinned tab out of the reversal. **A pseudonym that is an
  ordinary word is shown as written.** An older PDF-Linker could cut a
  surname's stand-in down to a word ("We"), and nothing in the text says which
  "we" the run wrote, so the reader used to paint the surname over every "we"
  in the case. It now leaves those words as they are, says so in the status
  bar and in a message naming the pair, and keeps writing the name as the key
  says when you type it. A full **Re-run PDF-Linker** gives the name a
  stand-in of its own (current PDF-Linker repairs such a key as it reads it).
  The last few keys are
  remembered, so a lone `.txt` can be read under a key already loaded. A real
  name from the key standing **unfaked** in an export is counted in the status
  bar and underlined — that is a leak the run missed. **The names of decided
  cases are not.** Most of what a key matches in a brief belongs to the
  decisions it cites, not to the matter: a pleading names Slaybaugh, Semole
  and Renoir a dozen times each, and a key that binds a surname of this case
  which happens to be one of theirs used to mark every one of them, burying
  the leak that matters under a page of orange. A case **name** carrying the
  **citation** that makes it one — a year in parentheses, a volume and
  reporter, or *supra*, and the short form "Semole, supra" with it — is read
  as a decision, and a bound value standing inside it is that decision's
  party. It is not marked, and **the save writes no pseudonym over it**, which
  is what would have put out a citation to a case that does not exist. That
  was the classic **keep**, made automatic. The citation is the whole test: a
  caption has no reporter, so "Rasho v. Quillmark, Defendant" at the head of a
  pleading is still a leak — the one that matters most. **The count opens a
  bar over the text**, the same one the LEAKS worksheet gets: counting them is
  not finding them, and on a forty-page export they are wherever they are.
  Clicking it (or **Alt+L**, with **Shift** for the one before) goes to each
  in the order they stand in the document, marks it, and gives the decisions
  as buttons — **keep just this one**, **keep in this case**, **never fake it
  anywhere**, **fake it**, or leave it for now, which the save leaves as it
  stands until you decide. The buttons and the arrows are one row at the top
  of the bar that holds still from one name to the next, as the worksheet's
  does; between documents the decisions go out of sight and › stays where it
  was. Under them the bar
  says which of how many, and the page and line it stands on, and the walk
  wraps at the end. Where the case folder has no `LEAKS.xlsx` that is the
  whole review: the key is attached, the names it binds are underlined, and
  this walks them one at a time. Where the worksheet's own bar is up, this one
  sits under it. **And it walks the folder, not the document.** The marks read
  the document that is open; the folder holds the other forty, and a name left
  in the clear in one of them is exactly as much of a leak. Once a document
  has been read, the rest of the folder is **swept** on idle — each export
  read once, under the same key, past the same keeps, the names of cited
  decisions spared as on the page — and the count says what they are carrying.
  Step past the last name here and the reader **opens the next document that
  has one** and goes on there; a document with none of its own still steps
  into the folder. The sweep is thrown away whenever the key or the keeps
  move, being an answer about them, and a document that has been saved is
  struck from it once nothing undecided is left in it. **fake it** is the
  other half of the bar: the keeps answer the names that must stay, and this
  answers the ones that must go. **The save fakes only what has been decided.**
  The name is settled, the walk stops offering it, and the next save writes
  the pseudonym. By value and not by place, since a save fakes every
  occurrence of a name alike. The count says how many are settled and waiting
  on the save, the bar counts what has been answered here, and the settling
  holds for the session — through keeps taken on other names — and is dropped
  when another case's key is chosen or the folder is forgotten. Where there IS a worksheet the bar above
  the text is still the way through its rows; this steps what is standing in
  the text, which is not the same list (a worksheet is one row per value, and
  a value leaks wherever it leaks).
- **The key, term by term.** **🗝 Key terms** in the tools panel (or a click
  on the pseudonym count in the status bar) puts a bar over the text that
  walks the pseudonym key as it stands on the page. A **term** is one row of
  the key — its real name and the pseudonym the file carries, however the case
  is written — and the terms come in the order each first appears; the list on
  the bar names every one with how many times it stands, and picking one goes
  to it. **Term ‹ ›** (Alt+J, Shift+Alt+J back) goes to the next term's first
  appearance; **Appearance ‹ ›** (Alt+K, Shift+Alt+K back) goes to the place the
  current term next stands, round to its first after its last, a name wrapped
  across two lines being one place. The bar says which appearance of how many,
  which term of how many, and the page and line; the term is underlined
  wherever it stands and the one in front is marked solidly. It opens on the
  first name at the top of the window, so it starts where you are reading. It
  walks the pages on screen — this document, and with the folder read on, what
  hangs under it — and only the pseudonyms: the names the run left in the
  clear are the names walk's (Alt+L).
- **The LEAKS worksheet, row by row, in the text.** PDF-Linker's leak triage
  is `LEAKS.xlsx` in the case folder: one row per flagged value with a
  **Fix?** cell to answer, and Apply Fixes reads the cells back. The
  reader attaches the folder's worksheet when the folder is opened (or **⚠
  Leaks** loads one; a dropped `LEAKS.xlsx` attaches too) and works it **one
  row at a time**: the current row stands in a bar above the text — value,
  type, file and page:line, both Context quotes with the value bolded, the
  Notes — and the text **opens the row's own document and scrolls to its page
  and line**, the value marked wherever it stands (the occurrence the bar went
  to strongest). The page stays editable underneath, and side by side the PDF
  follows as it always does. **yes / no / never / phrase** are buttons, in
  one row at the top of the bar with the walk's own (‹ ›, Next unanswered,
  Find in text, Save), and that row holds still: the row's value, Context
  and notes are under it at whatever length they run, so each button stays
  where it was as you click through. Anything else the cell takes — the
  replacement, `~CORRECT SPELLING`,
  `*CORRECT TEXT` (`**` in every folder), a `[part to keep]` — is typed and
  applied with Enter; **Alt+Y**, **Alt+N**, **Alt+↑/↓** work from the page.
  **A row PDF-Linker answered for you is still a row to answer.** Where the
  sheet arrives with a `~value` already in its Fix? cell — its own reading
  that this value is a misspelling of that one — the review stops on it
  exactly as it stops on an empty cell, and the bar says whose reading it is.
  The suggestion is usually right, which is why it is pre-filled; when it is
  wrong it is wrong in the way that matters most, since a `~Martin` over a
  real "Marin" writes a real name into the file as though it had been checked.
  **accept** (**Alt+A**) takes it as it stands and the row stops coming back;
  typing anything else overwrites it. An acceptance writes nothing to the
  workbook — the cell already says it — so it is remembered in the reader,
  beside the unsaved decisions, and a save does not clear it. A decision moves
  you to the next row still to answer; the **Leaks** tab lists every row with
  its state and jumps to any of them. A `no` or `never` on a value the key
  binds is mirrored as one of the reader's keeps, so the orange mark goes and
  a save of the document leaves the value as it stands. A `yes` or `phrase`
  on one is the names bar's **fake it**: the save writes its pseudonym, the
  walk stops offering it and the ⚠ count calls it settled, whether the cell
  was answered here or arrived in the sheet that way. It used to count for
  nothing in the reader, and since the walk does not stop on a name the
  worksheet has a row for, the name was answered on the worksheet and never
  in the walk: every save left it in the file and warned it was `not yet
  reviewed`. Clearing the cell makes the name undecided again. **A save of the
  document writes the worksheet too**: the rows answered while reading a
  document are decisions about that document, and a decision left in the
  browser is one PDF-Linker's next run will not see, so **Save** (or Ctrl+S)
  carries them along with it — in place, through the worksheet's own handle or
  the case folder's, and where there is neither the save says they are still
  unwritten rather than opening a picker. Otherwise they are remembered until
  **Save LEAKS.xlsx** (Ctrl+Shift+S) writes them **into the same workbook in
  place** — only the Fix? cells change; every other part of the file, the
  Context quotes, the column widths and the dropdown come back byte for byte,
  and the file is read back before it is written — after which Apply Fixes (or
  a re-run) applies them to the files. A `yes` here is never also flagged
  into `New Real Values.txt`.
- **Every row still to answer is orange before the review reaches it.** Only
  the row in front used to be marked, so a name the worksheet was already
  asking about stood unmarked until the review got there, and flagging it on
  the way was wasted work (and handed PDF-Linker a value it had raised
  itself). Now each value with a row still to answer is marked wherever it
  stands, in a lighter orange with a dashed underline; the row in front keeps
  its stronger mark. The marks show whenever a worksheet is attached, with the
  bar open or closed, and a value goes unmarked once its row is answered. A
  name the key binds is left to the key's own orange. Selecting one of these
  values on its own does not flag it (🚩 on, or Ctrl+Shift+F): the pop-up says
  the worksheet has a row for it, and **Answer its row…** opens that row in
  the bar without moving the text. A selection with more than the value in it
  is still flagged whole.
- **And through a document in the order the rows stand in it.** PDF-Linker
  writes one row per **value**, so the worksheet's own order is the order the
  values were first found — which sent a review to page 4, then page 31, then
  back to page 9, for no reason that means anything on the page. The walk
  takes a document's rows by **where they stand in it** (the page and line of
  the Where cell) instead, so a review reads a page and finishes with it. The
  **‹ ›** buttons and **Alt+↑/↓** follow the same order, not the sheet's; a
  row whose Where names no place — a sentinel, a tally — comes after the rows
  that do. The **Leaks** tab still lists the worksheet in its own order, that
  being what it is a list of.
- **A review goes through the folder one document at a time.** A row stands
  in a document — its File cell — and the rows are worked **document by
  document**: every row standing in the document in front is reached before
  any row of the next one, undecided first, so a decision keeps you where you
  are and the review moves on only when that document has nothing left. The
  bar says how many of the undecided rows are in the document in front. A
  value that leaked into several documents is still **one row and one
  decision**, made in the first of them. This is what lets a case folder of
  hundreds of text files be answered at all: the reader holds the document in
  front of you and reads the next one **only once you have finished this
  one** — never the folder at once, which is what used to take the tab down.
  (Under two dozen exports it keeps working further ahead, as it always has;
  there is nothing to protect you from in a folder that small.)
- **And a page is finished before the review leaves it.** The worksheet is one
  row per value; the orange on the page is every name the key binds that the
  run left in the clear, and most of those have no row. A review that answered
  a page's last row and moved on left them standing on a page just read. So
  **where you have opened the names bar yourself** (the count in the status
  bar, or **Alt+L**), a decision that would take the review **off** a page — to
  a later page, to another document, or to the end of the worksheet — first
  stands on each name still in the clear there, and on any page it would pass
  over on its way to the next row, in the names bar with its own buttons
  (**keep just this one**, **keep in this case**, **never fake it anywhere**,
  **fake it**). The bar says how many are left on the page and that the
  worksheet's next row comes after; when the page has none left the review
  goes on to that row. **With the names bar down the review never opens it for
  this**: the orange is the reader's own finding, not the worksheet's, and a
  decision goes straight on to the next row. **skip** leaves a name for the
  status bar's walk. Closing the names bar leaves the rest of the page and
  goes on to the worksheet's next row, and the review stops on no more names
  until you open the bar again. Opening another document closes the names bar
  as it always has, so once the review moves into the next document it stops
  on names there only after you open the bar in it. Not stopped on: a name the
  worksheet has a row for — that row is where it gets answered — and the red
  flagged values, which are answers already given. Moving by hand (‹ ›,
  Alt+↑/↓, the Leaks tab, **next open**) never stops; only a decision does. A
  Word export is one page, so its names come up when the review leaves the
  document.
- **A case of thousands of leaks, under a key of thousands of names, opens and
  answers.** The reader builds one matcher out of every name in the key, and it
  used to look for them the way you would with a list in your hand: at every
  word of the document, try every name. A key of a few thousand names then cost
  a couple of seconds *per page* — and the reader reads a whole document
  whenever it opens one, marks the text, or saves, which is why the tab would
  not scroll, would not answer a button, and was eventually offered up for
  killing. The names are filed under their first word now, so the word in front
  of the reader picks out the handful that could stand there: a hundred and
  fifty pages under a key of three thousand names went from 13.6 seconds to
  18 milliseconds, finding exactly the same names. (Past about three and a half
  thousand names the old matcher was also simply too big for the browser to
  run, and said so only when the first document was opened — which is why the
  file never appeared and the screen went back to asking for one. That is gone
  with it.) Around it, the things that were done again on every
  keystroke are done once: the marks over the text are scanned when the text,
  the key, the flags or the keeps move and not when you answer a row (and then
  a beat later, like the citation underlines); the keeps are indexed rather
  than searched, so the five hundredth `no` costs what the first did; a file
  name is matched through the key once rather than once per document in the
  folder; and the Leaks list is written on rather than rebuilt. On a case of
  200 exports of 150 pages, 2,500 leak rows and a key of 4,000 names: the first
  document opens in under two seconds where it used to take 17 or fail
  outright, and ten decisions take under a second and a half where they took
  nineteen. The two long passes the reader makes over a whole document — the
  marks over the text, and building the next document before you reach it — are
  cut against the browser's own clock now, so neither holds the page: nothing
  is read ahead while you are still answering rows, and a document left
  half-built is picked up where it stopped rather than started again. Sitting
  still after opening a document cost two freezes of over a second each; it
  costs none. If something does go wrong, the bar at the bottom now says so
  instead of the reader quietly stopping where it stood.
- **Nothing is read ahead until you start a review.** The reader used to begin
  reading, parsing and building the document your first undecided leak stands
  in — and opening that document's PDF — the moment a worksheet was attached,
  whether or not you had opened the review. Open a seven-page declaration in a
  folder of forty-eight documents and the tab would stop answering within
  seconds, for work you had not asked for and could not see. It waits for
  **⚠ Leaks** now: with the bar closed the reader does nothing but show you the
  document in front of you.
- **When something does hold the page, it says what.** The heavy passes name
  themselves, and a pass that holds the thread for more than a couple of
  seconds puts that in the bar at the bottom — "the reader held the page for
  4.2 seconds — reading the marks over the text" — so a slow reader can be
  asked where instead of guessed at. And if a pass never comes back at all —
  the page stops answering and the browser offers to kill it — the name is
  written down before the work starts, so the NEXT time the reader opens it
  says what it died in the middle of. A freeze you had to kill still tells you
  what it was. That message stands in the bar across the top until you dismiss
  it — not a toast that flashes past behind the document — and its button puts
  the line on the clipboard.
- **The marks give up rather than hold the page.** Reading the names over a
  document is the most expensive thing the reader does. It now stops for
  breath between handfuls of names rather than between pages — a Word export
  has no page breaks in it at all, so "a page at a time" was the whole file in
  one go — and if it has spent more than eight seconds on one document it stops
  altogether, says so in the bar, and leaves the words on the page. The next
  document gets a fresh start.
- **The pages a leak stands on are drawn before you reach them.** Every page
  a review will visit is named in the worksheet's rows before it gets to any
  of them, so with a worksheet attached the reader goes and gets them: the
  rows are read in the order the review will actually reach them, each row's
  PDF is opened, and its own page is drawn into a bitmap held ready. A page
  coming into view is painted from that bitmap at once, where a **Loading…**
  box used to stand, and pdf.js draws the sharp one over it a moment later.
  Only a window of pages is held (twelve), and the window moves with the
  review: what it leaves behind is closed, and nothing at all is held while
  the PDF side is put away. The **exports** the rows name are read ahead the
  same way, each held against the file it came from (name, size and
  modification time), so an export written since, by a save here or another
  run of PDF-Linker, is read again rather than remembered wrongly. **The PDFs
  behind them are closed again as the review walks past them** — a PDF holds
  its bytes, its pages and the line grid read off every one of them, and a
  folder of three hundred of them cannot all be open at once.
- **`Combined Text.txt` brings its PDFs with it.** The combined file PDF-Linker
  writes into the case folder is listed first among the documents, and its
  members — the `# Documents in this file:` list on its first page, in
  order — are each matched to their own PDF: the case folder's through the
  key, or PDFs picked by hand (**⇄ PDF pages… → Pick PDFs…**, or a drop),
  several at once, each matched to its member by name through the key and,
  where no name settles it, by the order the file lists them. The status bar
  says which members still have no PDF.
- **Editable — once you say so — and the file never learns the real names.**
  A document opens **protected**: reading, selecting and flagging can never
  nudge a character into it. **✎ Edit** lifts that for the document in front
  of you, **Ctrl+Z** and **Ctrl+Y** undo and redo through the reader's own
  history (the browser's cannot survive the pseudonym rewrites), and **Save**
  (Ctrl+S) writes the text back to the same file. A
  pseudonym span always writes its **fake**; a real name typed in is marked
  as its pseudonym as soon as the caret leaves it. **Only the name typed** —
  or pasted, or put in by Replace: typing on a page used to mark every real
  name standing in it, so a word added on line 1 marked line 2's missed name
  and turned a cited decision's party into a pseudonym, a citation to a case
  that does not exist. Now a name the page already had is left for the
  review, wherever the typing was and whatever an Enter moved, and a cited
  decision's party is never marked, typed or not (a citation pasted whole keeps
  its names). A party marked at the Space prompt before the rest of its
  citation was typed goes back to the name as typed once the citation is
  whole, and the toast says so; Ctrl+Z puts the mark back. After a save, what
  the file holds counts as already there. A
  real name the key binds that is standing in the clear and **not yet
  decided** is left exactly as it stands (see *A save before the review is
  over*, below); the save refuses outright rather than write one you **did**
  say to fake. Deleting a marked name deletes the fake.
- **The numbers are the paper.** On a numbered page the line numbers are
  fixed and the text moves between them. **Enter** sends the text after the
  caret down into the next numbered slot, and the slot below takes what was
  there, on down until an empty slot absorbs the shift — with no empty slot
  left, the last line's text lands on a new unnumbered line at the foot of
  the page, so nothing is lost. **Backspace** at the start of a line joins it
  to the line above and pulls the run below up a slot; **Delete** at the end
  of a line is the same join from the other side; a **paste of several lines
  goes in as one edit** — its first line typed where the caret stands, the
  rest laid into the slots below in a single pass, the text below moving
  down once. So where the export left line 7 empty and the PDF has text on it,
  click line 7 and type: the file gets ` 7  ` and your text, and PDF-Linker's
  next run reads it as line 7. A selection that reaches across a number is
  refused an edit, and the numbers never take a keystroke.
- **The documents with leaks in them are ready before you open them.** Open a
  case folder with a `LEAKS.xlsx` in it and the reader starts getting the
  documents its rows name — whichever document you came in on, and whether or
  not you ever click them in the list. Each is read, parsed and its pages
  **built off the page**, in the order the review will actually reach them
  (the row in front, the undecided rows after it, then the rest), and opening
  one is then putting those pages up rather than making them. The **Documents**
  tab marks the ones that are ready and says how many (`3 of 3 with leaks
  ready to open`).
- **And which of them is still carrying a real value.** A document with a name
  the key binds standing unfaked in it, or a flagged value the next run has
  yet to reach, wears a **⚠** beside its name in the **Documents** tab, and
  its tooltip says how many of each. The status bar already counted what the
  rest of the folder was carrying, but a number does not say *which* of the
  forty it is, and the Documents tab is where the next one is chosen. The
  documents on the page are counted from the marks over them — which know the
  edits the file has not been given yet, and the names the walk has settled —
  and the rest from the folder sweep, which reads each file's own text. Where
  the marks are off (a document they cost too much on) the file's own
  reading stands.
  Gradually, and within a budget: one document at a time, in idle time, each
  built in slices of pages, so the building never stands between you and the
  page you are reading. How many are held is what fits — up to six of them and
  four hundred pages between them, which on a case of ordinary exports is
  every document with a leak in it and on a case of long ones is the next two
  or three. **A document of more than two hundred pages is never held**: that
  is the combined file, and holding it is what takes the tab down. What the
  window has passed is let go of, furthest from the row in front first. A key
  loaded or changed drops them all (their pages carry that key's translation);
  a keep decided since, or the pseudonym toggle flipped since, is put right as
  the document goes up rather than built again.
- **Opening a document with its PDF beside it does not lock the page.** The
  two columns are matched page by page — each text page laid on its PDF
  page's own grid — and that matching asks for a pass over the whole document
  every time anything about the PDF side changes. Each of a document's PDF
  pages reports its size as it is opened, and its line grid lands later
  still, so a seventy-page complaint asked for **a hundred and forty passes**,
  each laying out two thousand lines against the grid: the best part of two
  seconds in which the page answered nothing, and a single stretch of a full
  second inside it. The asks are now collected and answered **once a frame** —
  eight passes for that complaint instead of a hundred and forty — the pane is
  read once per pass rather than once per page, and a line already standing
  where the pass would put it is left alone. The same complaint now blocks
  **0.6 s in no stretch longer than 0.18 s**, and scrolling it with the PDF
  alongside blocks nothing at all. The columns line up exactly as before:
  every page matched, the two sheets the same width, no drift between them.
- **A long export keeps answering while you edit it.** A paste used to be
  typed in line by line, and each of those lines pushed the page's text down
  a slot and then had the whole document re-read after it — the counts, the
  matched layout, the line lock, the citations and the highlights, over every
  page. A block of thirty lines pasted out of the PDF into a two-hundred-page
  export locked the reader up for **twenty-two seconds**; the same paste now
  takes **thirteen milliseconds**, and puts the same text in the same slots
  with the same underlines on it. Two things got it there: the paste is one
  pass and one re-read instead of one per line, and the **citation underlines
  settle a beat after the edit rather than with it** — the scan has to read
  the whole document, since a short form ("*Ibid.*", an italicized name)
  means what the cite before it means, wherever on the way that cite stands,
  and doing that between keystrokes is what made a long document feel stuck.
  A page's underlines are rewritten only where they have actually changed,
  so an edit on one page no longer throws away and redraws every link in the
  file — which is what made the reader slower the longer you stayed in it.
- **The pseudonym at the caret.** Finish typing a real value the key binds
  and a prompt at the caret names its pseudonym — the Claude extension's
  as-you-type correction, for the page. **Space** marks it as an autocorrect
  (the real name stays on screen, the fake goes underneath and into the
  file, and the space lands after it); **→** marks it without the space;
  **Esc** leaves that one plain, and the save still writes its pseudonym. A
  real that opens a longer name in the key ("Helen" beside "Helen Rasho"),
  or a kept one, is never space-marked: the space types on, and the whole
  name is offered the moment it is finished. A name typed and left is
  marked by the reader on its own once the caret has moved off it.
- **A row that cannot be located says so, once, and keeps saying it.** A LEAKS
  row names the **PDF** the value was found in; the review has to open that
  PDF's **text export**, and the two names do not always agree. A stem ending
  in an abbreviation's own full stop — `Payee Supp. Decl. ISO Pet..pdf` — is
  written one dot shorter in the export beside it, and under an exact-stem
  match the row's document was simply not in the folder. The review then read
  whatever was open instead and reported the value missing from a document the
  row had never named. Two things now: a name differing from its export in
  **nothing but punctuation** still finds it (asked only after the exact stem,
  and only where exactly one export answers — an ambiguous name still gets no
  answer, because pointing the review at the wrong file is worse than pointing
  it at none); and the reason a value could not be marked is **one sentence in
  the bar**, where it stays while the row is being decided, naming every
  document in play. It used to be two toasts, of which the second overwrote
  the first before it could be read. Where the export really has lost the
  value — a page of corrupt OCR deleted since the run, say — the bar says
  that: *is not in <export>, where the row puts it (p.6:14); <PDF> still has
  it; the export does not.*
- **Ctrl+F reads the whole case folder, not the open document.** The browser's
  own find reads what is in the page, and what is in the page is this document
  — with the folder read on, not even all of it, since the reel sheds its far
  end to stay scrollable. A matter is forty exports, and *where does this name
  appear* is a question about the matter. So Find is the reader's own: a bar
  under the toolbar, every hit in this document marked and the one in front
  marked solidly, **Enter** for the next and **Shift+Enter** for the one
  before — and when this document runs out the walk **opens the next export
  that has one** and stands on its first hit, round the folder from wherever
  it was started and back again. The bar says which hit of how many is in
  front, where it stands, and how many are in how many other documents.
  **Find finds what the screen shows.** The query is looked for as typed:
  in this document as it reads, and in every other export as it would read
  if the walk opened it. With the real names on screen, the other exports
  are read **through the key**: the files carry the pseudonyms, so each is
  searched with its fakes turned back to the names, and a name standing in
  the clear in one export and faked in another is found in both. **With
  Show fakes on, a real name is found only where it stands unfaked** (a
  leak, or a value kept where it stands), and with it off a pseudonym is
  found only where the key leaves it standing. A hit on the other face
  would mark text that does not say what was typed. Esc closes; 🔍 Find in
  the tools rail opens it over whatever is selected.
- **Replace, under Find (Ctrl+H).** **Replace…** on the find bar, or
  **Ctrl+H**, opens a second row: what to put in place of the hit.
  **Replace** (or Enter in that box) replaces the hit in front and stands on
  the next; **Replace all** replaces every hit on the pages on screen. A
  replace is an edit like typing: one step of the undo history (**Replace all
  is one Ctrl+Z**, however many pages it touched), the document marked unsaved
  until it is saved, and a real name typed as the replacement marked as a
  pseudonym, so the file carries the fake. It works on a protected document
  and leaves it protected. It edits **only the pages on screen**: this
  document, and whatever the folder has hung under it, each saved to its own
  file. The other documents in the folder are counted from disk and never
  written from the bar; › opens the next one and Replace goes on there. **A
  pseudonym is replaced whole or not at all.** Find "Helen Rasho" and the
  name is replaced; find "Rasho" inside a span that fakes "Helen Rasho" as one
  name and that hit is left standing, and the bar says so, because what would
  remain is half a real name with no fake to write in its place. A value kept
  where it stands is treated the same way. On pleading paper the line numbers
  never move: a phrase wrapped across numbered lines loses its words on both
  lines, and the replacement goes where the phrase began.
- **Match case.** The checkbox on the find bar (or **Alt+C** in either box)
  finds only what is written in the same capitals: "Court" and not "court"
  or "COURT". It holds for the rest of the folder too, which is searched
  through the key, because the key writes each pseudonym in the capitals of
  the name it stands for. Replace and Replace all follow it. It is off when a
  reader opens, and off, case is ignored.
- **Flag what the run missed — and un-flag what it got wrong.** The point of
  reading the real names is to spot the ones that are *not* marked. Select
  such a name and flag it from the pop-up beside it (or Ctrl+Shift+F). **With
  many to flag, turn flagging on**: **🚩 Flag real value** in the tools panel
  is a switch, and while it is lit every name you select with the mouse — a
  drag or a double-click — is flagged as you let go, with no button in
  between. The selection shows red while it is on. A selection with a
  question to it (a passage, a pseudonym, the orange name alone, a value kept
  where it stands or by the Master Keep) is not flagged; it stays selected
  with the pop-up asking. Click the button again to turn it off; it is never
  on when a reader opens. The
  **Flagged** panel collects them and **Save list to case folder** writes `New
  Real Values.txt` beside the key, which PDF-Linker reads on its next run —
  and on Apply Fixes — as if each line had been given with `--term`. **A flag
  needs no full re-run.** The value is the operator's own instruction, so
  nothing has to re-read the PDFs to find it: double-clicking `Apply Fixes` in
  the case folder scrubs it straight into the `.txt` exports and writes its
  row into the key. That launcher sits beside `pseudonym_key.xlsx` whether or
  not the folder still has a `LEAKS.xlsx` to triage. **A name the run half
  faked is flagged whole.** Where the run faked one word of a name and missed
  the rest — "Rosa" in the clear beside "Delgado" faked, or beside "Delgado"
  standing orange — select the whole name and flag it: the selection is
  flagged as the real names read ("Rosa Delgado", never the fake), the red
  mark goes on the words standing in the clear and not on the pseudonym, and
  the pop-up still offers to keep the faked or orange word if that was the
  mistake. Only a selection that is nothing but a pseudonym, or nothing but
  the orange name, is refused: the first is faked already, and the second is
  the names bar's question (fake it, or keep it). A word of the name already
  faked means the export carries its fake, so that flag takes **Re-run
  PDF-Linker** rather than Apply Fixes, and the reader says so. **A flag the
  run has answered comes off the list.** The flag is a job: this name
  is in the clear, fake it. When the key comes back with the name in it — the
  folder opened after a run, a key chosen by hand — the job is done, and the
  value is dropped from the **Flagged** panel (the reader says which), takes
  its red mark off the text, and stops being handed over in the next `New Real
  Values.txt` — and a `New Real Values.txt` on disk still listing it from
  before the run does not bring it back. **Only the case's own key answers
  them**: the one read from the folder's `pseudonym_key.xlsx`, or one loaded
  (**Load key…**, a key dropped on its own or with a PDF or a workbook) or
  chosen in the Key list while the folder is open (with no folder open, while
  the lone document whose list it is is open). The key in hand stays when a
  folder with no key file — or one Excel is holding — is opened, and the
  documents read under it as before, but another case's key that happens to
  bind the same name takes none of this folder's flags off; the reader says so
  where it mentions the key (not in a Text Files folder, whose case folder is
  the one to open), and loading the case's own key with **Load key…** takes
  them off — or, where the folder's key file could not be read, closing it in
  Excel and opening the folder again. A key dropped together with an export
  (a `.txt` or `.LEAK` document), and the key offered when the reader
  starts, belong to no folder until loaded or chosen like that: use **Load
  key…** with it (choosing the key already shown in the list does nothing; to
  go through the list, choose "(no key)" and back — never another key, which
  would take off every flag it binds — though "(no key)" also forgets this
  session's **fake it** answers in the names bar). Folders of one name share
  one flag list, and so does every case's Text Files folder, and lone
  documents of one file name from different cases; a key chosen with one of
  them open answers them all. A flag kept for want of the case's key is only
  asked about again; a flag taken off wrongly could let the name ship. The
  whole value has to be in the key: a key that binds "David" has not
  pseudonymized a flagged "David W. Slayton",
  half of which would still be standing, and a value **kept** is not in the
  key's forward side at all — both stay flagged. **But a red mark never
  stands over a pseudonym.** The red mark says *this value is standing in the
  clear and the next run has yet to fake it*, and wherever the text on screen
  is a pseudonym the run has already faked it: the file carries the fake, and
  the real name is painted over it for reading only. So the marks read the
  page with the pseudonyms blanked — the same reading that finds the names in
  the clear — and a flagged "David W. Slayton" is marked where it really
  stands and not where the key's "David" has already been swapped out
  underneath it. (Selecting a pseudonym and flagging it was already refused
  for the same reason.) **Several words that go together are a phrase.**
  Select them — "Cross River Bank", where the key fakes or marks "River" on
  its own, a phrase around a value already flagged, or words flagged already
  as they stand — and the pop-up offers **Phrase** beside Flag. A value of
  several words already on the **Flagged** panel can be made one there too,
  without finding it again: its **+ phrase** tag makes it a phrase, and the
  lit **phrase** tag makes it an ordinary flag again. It is PDF-Linker's own `phrase`: the words
  faked **whole**, as one name, a keep on one of them notwithstanding (a
  `never: River` would otherwise ride through inside the bank's fake). It is
  read as the real names read, a pseudonym in it as the name it stands for,
  joins the **Flagged** panel tagged *phrase*, and is written into `New Real
  Values.txt` as `phrase: Cross River Bank`. Where the phrase stands in the
  clear, a save **holds it whole** — it does not fake the one word the key
  knows, which would leave "Cross Zed Bank" and nothing for Apply Fixes to
  find — and the orange mark on the word inside gives way to the phrase's
  red one. Where a word of it is already faked in the file — anywhere in the
  document, not only where it was selected — the export carries that fake,
  so it takes **Re-run PDF-Linker** rather than Apply Fixes, and the reader
  says so. The opposite mistake, a value
  that should never have been faked (a word of a cited decision's name,
  usually), is **right-clicked**: "Keep in this case" is PDF-Linker's `no`,
  "Never fake it anywhere" its `never`. The keep takes effect in the reader
  **at once** — every occurrence loses its highlight and shows a dotted
  underline, the tooltip says the file still carries the fake, and a save
  neither rewrites the kept value to its fake nor refuses over it — and goes
  into the same file as a `no: VALUE` / `never: VALUE` line, which PDF-Linker
  reads as the worksheet's own decision on the run that actually restores the
  files. The **Flagged** panel lists both kinds, each withdrawable. **A save
  of the document writes the list too.** The flags and keeps are half of the
  same decision the document carries — a value kept is a value that save left
  standing — so a **Save** (or Ctrl+S) that finds the list changed since it
  was last written puts it into the case folder with the document and says so
  in the same line. Without a folder there is nowhere to put it, and the save
  says that instead of opening a picker nobody asked for. **A list that has
  not been written is a closing prompt.** The flags and keeps are remembered
  here whatever happens, so closing the tab loses nothing — but remembered
  here is not handed over: PDF-Linker reads `New Real Values.txt` in the case
  folder and nothing else. While what is in the panel differs from what was
  last written, the panel says so and closing the tab asks first (the same
  prompt an edited document, an unsaved LEAKS decision or a real name standing
  in the clear raises; the browser's own dialog is all a page gets, and which
  of the four it is, the panels and the status bar say).
- **A keep the case already carries out asks nothing of PDF-Linker.** A keep
  says *do not fake this value*, and what that costs depends on what the files
  already say. Where the run faked it, a file carries the pseudonym and only
  PDF-Linker can put the real name back: the keep has to reach the case folder
  and the run has to happen. Where the value **stands in the clear**, nothing
  faked it — there is nothing to un-fake, the files already read the way the
  keep wants them to, and handing it over would ask a run to do what has
  already been done. So that keep stays in the reader. It is not written into
  `New Real Values.txt`, it does not make the list one the case folder is owed,
  it raises no closing prompt, and the whole of its effect is the one that was
  wanted: the value stops being marked. The **Flagged** panel tags it *already
  so* rather than *this case*.
- **And it writes each document as it leaves it.** Deciding a document's names
  is a save's worth of work: the names settled are written as their
  pseudonyms, the keeps taken go into `New Real Values.txt`, a worksheet row
  answered on the way goes into `LEAKS.xlsx`. None of it used to happen, so
  the walk moved on and left a document still carrying real values with
  nothing on screen to say so — the count and the bar are about the document
  now in front. The save happens on the way out, and **the ⚠ Leaks worksheet
  review does the same**: its rows are walked a document at a time too, and
  the rows answered in one are written before the next is opened.
  **Only after a decision, though.** Stepping past a name, skipping one,
  pressing ‹ to look back at a row — none of that is a decision, and a
  document nobody decided anything in is left exactly as it stands, bytes and
  timestamp and all. What counts is a name answered (kept, or *fake it*) or a
  Fix? cell written.
  And **a save that does not happen holds the review**: the standing assertion
  refusing, or a file that would not be written, is exactly the moment not to
  move on. The bar stays where it is and says why.
- **The walk does not stop at the end of a document.** The names standing in
  the clear are a folder's worth of work, and the bar over the text used to go
  down the moment the open document ran out of them — leaving the walk to be
  picked up again from the count in the status bar, at the other end of the
  window, once per document. It stays up now: answer the last name here and
  the walk opens the next export that has one and stands on its first, and ›
  does the same from the bar. Where the decision just taken threw the folder's
  reading away — a keep is a question about every export, so it does — the bar
  says the folder is being read and goes on by itself the moment it answers.
  And it goes round the folder in reading order, the document *after* this one
  first, rather than back to the top of the list each time.
- **And it does not walk the folder on its own.** Two readings say where the
  names are, and they are not the same reading: the marks answer for the
  document open — they know the spot keeps taken in it, the names the walk has
  settled, and the edits the file has not been given yet — while the folder
  sweep answers for the files on disk, which know none of that. Where the two
  disagreed about a document, the walk landed there, found nothing and went
  straight out again; and since opening a document does not change what the
  sweep read, the row that sent it there was still there the next time round.
  Two such documents and the reader clicked between them as fast as files
  open — at the *end* of a review, when every document that really was carrying
  a name had been answered and the rows left over were exactly the ones the
  page disagreed with. The page's own reading is kept and honoured now: a
  document it has read and found nothing standing in is not offered as a stop
  again until the key or the folder moves, and the **⚠** in **Documents** goes
  on saying what that file itself carries. A document whose reading has not
  landed yet is not called empty at all — the bar says it is being read and
  waits, rather than leaving a document nobody read. One whose marks cannot run
  (a document they cost too much on) has no answer to give
  either way, so the walk stops there and says so. And a run of documents
  opened one after another with nothing found in any of them stops at eight,
  whatever the reason. Stepping the walk by hand is never a runaway and none of
  it applies: › goes where › says it goes.
- **And the question is the case's, not the document's.** A keep applies to
  every export in the folder, so "was it faked?" is asked of every export in
  the folder: a pseudonym standing in one of the other forty is a name the next
  run is the only thing that can restore, whatever the document on screen
  happens to say. The folder sweep already reads each export once to find the
  names standing in the clear; the same reading writes down which pseudonyms
  stand, and that index — an answer about what the run wrote, which taking a
  keep does not change — is kept across decisions and rebuilt only when the key
  or the folder's list of documents moves. One document that will not open is
  enough to withhold it: a missing file reads as "this pseudonym stands
  nowhere", which is the one wrong answer that costs a name.
- **Until the folder has been read, a keep is owed.** A keep taken before the
  sweep has answered is tagged *checking* and goes into the list like any
  other, because a keep wrongly held back is a name the run never restores and
  nothing ever says so. When the reading finishes it is settled — or left owed,
  if a pseudonym turned up. The move toward *already so* is the only one that
  needs evidence, and it is never made for a keep already written into
  `New Real Values.txt`: that line is PDF-Linker's now, and a run leaving a
  value alone that was already standing costs nothing. Two other things keep a
  value on the list whatever the folder says: **Never fake it anywhere**
  reaches the next matter through the file and nowhere else, and a value
  PDF-Linker has itself raised on `LEAKS.xlsx` has a row waiting on an answer,
  which is where it gets answered. With no case folder open there is nothing
  to sweep, and the open document is the whole of the case the reader can see.
- **A keep stays visible.** A value kept is a decision, and with the orange
  mark gone (it is not a leak any more) nothing used to say so — the name read
  like any other word, and a page read a week later gave no sign which names
  had been left alone on purpose. Every kept value standing in the clear now
  carries the **same dotted mark a kept pseudonym** does, counted in the status
  bar ("3 kept values standing as they read"), for the rest of the session and
  every session after: the keeps themselves are remembered per case. Marked
  where the key binds something in it, which is where a keep means anything — a
  master workbook carries the settled decisions of every other matter too
  ("Court", "Clerk", "County"), and nothing in this case was going to fake
  those. The test is CONTAINS, not equals: the workbook keeps "David W.
  Slayton" where the key binds "David", and that keep is worth seeing exactly
  because the "David" inside it would otherwise have been faked. (Masking is
  untouched and still covers every keep; only the marks are narrowed.)
- **The master workbook, where it is holding something.** PDF-Linker keeps one
  workbook across every matter, whose KEEP sheet is every value you have ever
  said to leave alone. Attached here, those keeps are in force in this case
  too — but **only the ones the key binds are identified or shown**. A keep
  exists to stop a value being faked, and a value this key does not bind was
  never going to be: "Court", "Clerk", "County" and a hundred names from other
  matters do no work here, and listing them would bury the handful that do.
  The panel says what the workbook is **holding against the key in this
  document** and keeps the total as a tooltip; the marks over the text are the
  same handful; and the blanking that protects a keep from the forward pass is
  narrowed to them as well, which takes an alternation over hundreds of values
  out of every save and every repaint.
- **The master workbook is set up once.** Choose it once with **Load master
  workbook…** in the Flagged panel (or drop it on the window) and the reader
  remembers where it is: from then on it is read every time the reader opens,
  read again whenever you come back to the window after a PDF-Linker run has
  changed it, and written in place when you take a value off the Master Keep.
  The setup asks the browser for leave to read **and** write the file, so a
  later removal goes straight to it. In the installed app the browser keeps
  that leave; in a browser tab it may ask again after a restart, in a bar at the
  top (and on the panel's **Allow** button) — choose **Allow on every visit**
  and it does not ask again. If the file has been moved or deleted, the reader
  says so rather than going on without its keeps. The extension's reader and
  the installed app are set up separately.
- **Taking a value off the Master Keep.** A master keep that is wrong for this
  case stops the value being faked. Click the **×** beside it in that list,
  select it in the text and press **Remove from Master Keep**, or right-click
  it and choose **Remove from the Master Keep**. After you confirm, the reader
  stops keeping it at once: where it stands unfaked it is marked orange, ready
  to fake and save. The workbook is changed too, if it was attached with
  **Load master workbook…** or dropped on the window: that row's Fix? cell on
  the KEEP sheet is emptied (the row and its history stay, nothing else in the
  file is touched), so PDF-Linker's next run fakes it as well. A workbook
  opened as a copy, or one Excel is holding open, is not changed, and the
  reader says the value is off for this session only; it stays off when the
  reader reads the workbook again.
- **Or keep it at one place only.** Both of those keeps are decisions about a
  *value*, and neither fits the name on every document: the Clerk's own
  signature block. Fake the "David" of *David W. Slayton* and the pseudonym
  standing there also stands for a party's "David" — which tells the reader
  the party is a David too. Keep "David" for the whole case and every David
  in it comes back. So the menu's third, narrowest choice is **Keep just this
  one (here only)**: *this* occurrence reads as itself, and every other
  occurrence of the value goes on being faked. It is an edit, not an
  instruction for the next run — the value stands in the clear at that place,
  the save writes it as it reads, the orange leak mark leaves it alone and the
  save's own assertion lets it through, all at that place only. A name wrapped
  over two numbered lines is kept whole, both halves together. An **unfaked**
  real name takes the same choice from its own right-click, which is how one
  occurrence is left as it stands without keeping the value everywhere.
  Kept spots are marked with the same dotted underline a kept pseudonym
  carries, are listed under **Flagged** with their page (click to go to one,
  **×** to fake it there after all), ride along with **undo and redo**, and are
  **remembered per document**, so reopening the export finds them again — which
  is what keeps the reader from reading the value as a leak the next time. They
  go nowhere near `New Real Values.txt`: a place in one file is not something
  PDF-Linker's value-level rules can be told, so a re-run of PDF-Linker, which
  writes the exports again from the PDFs, fakes it once more.
- **⇄ Raw — the page as the file has it, in the page's place.** Everything
  the reader does is a view: the fakes are shown as the **real** names, the
  lines are laid out as sheets, the margin numbers get a ruled gutter, the
  citations are underlined. That is the point of it — and it is the reason it
  is worth being able to see what is actually *in* the file, because what goes
  to the court, to PDF-Linker and to anyone the export is handed to is the
  bytes, not the view, and the two are meant to differ in exactly one way: the
  file carries the pseudonyms. **⇄ Raw** on a page's label, between **⊘ Did
  not OCR** and **⇄ PDF**, works the way ⇄ PDF does: the page is replaced, in
  the reader, by its own text — fixed-pitch, wrapping off as a plain editor
  opens it, with the page header, the margin numbers and the spacing exactly
  as they sit on disk, and the pseudonyms as PDF-Linker wrote them. It is not
  a rendering of the file but the same text a save writes, built the same
  way, so on a page nobody has edited it *is* the disk, character for
  character; a line longer than the sheet scrolls rather than wraps. **⇄ Text**
  puts the page back. The page's text is hidden, not removed, and still saves.
  Where the page and the disk differ it says so: the corner reads *The file
  with your unsaved edits* while there are edits to write, and a real name
  from the key standing in the text (one the run missed) carries the same
  orange mark it has on the page. One view of a page at a time: ⇄ Raw on a
  page showing its PDF page takes the PDF page off (and out of the remembered
  swaps), and ⇄ PDF takes the raw text off. Beside the PDF the page leaves
  the grid while it is raw, at the height it stood at, with its PDF page held
  level beside it. A raw page prints and screenshots in its pseudonyms like
  every other. It is not remembered: reopening the document shows its text. A
  document with no page headers (a Word export) has no page label and so no
  ⇄ Raw.
- **A flag does not rearrange the page.** Flagging a value, or keeping a
  wrongly faked one, used to open the Documents / Flagged panel to show the
  list growing. Flagging is done *while reading*, often several in a row, and
  having the page narrow and re-lay itself each time — the PDF pane with it —
  is the reading interrupted to be told what the toast already said. The panel
  now switches to **Flagged** if it is open and stays shut if it is not. What a
  decision needs is not to be shown but not to be lost, and that is the save
  prompt's job: the Save button lights, the status bar names what is waiting,
  and closing the tab asks before it goes.
- **💾 Save is lit whenever a save would do something.** Flagging a value the
  run missed, keeping one it wrongly faked, answering a row of the LEAKS
  worksheet — each is a decision that lives in the browser until it is written
  into the case folder, and none of them touches the text. Save used to stay
  greyed out over a whole review's worth of them, so the button said there was
  nothing to save when there was, and you had to press **✎ Edit** to get at it.
  It now lights for any of them, the status bar names what is waiting
  (`● New Real Values.txt to write`), and such a save writes **only** those —
  the document's own bytes and timestamp are left alone, since its text never
  changed.
  **And a name you have said to fake is a save that would do something too.**
  A real value the run left unfaked and the walk settled with **fake it** is
  rewritten by the save on its own, and the file is written whether or not a
  character was typed. Save is lit by those names, and the status bar counts
  them (`● 3 decided names to write as pseudonyms — Save does it`), so there
  is no pressing **✎ Edit** and changing nothing just to get at the button.
  Values **kept**, the ones kept where they stand, and the parties of cited
  decisions are not counted, because the save does not touch them either.
  **A save before the review is over fakes nothing you have not decided.** It
  used to write every orange name as its pseudonym, looked at or not, so a
  save mid-review answered "fake" for every name the walk had not reached —
  a party's surname in a citation included. Now a name nobody has decided on
  (not kept, not settled with **fake it**) is left in the file exactly as it
  stood, and the save **warns** in red, by name: `⚠ 3 real names not yet
  reviewed were NOT faked — …; step through them from the ⚠ count, decide
  each, and save again.` Everything else — your edits, the decisions taken so
  far, the folder's lists — is written as usual. The ⚠ count and the names
  bar say the same thing: *undecided — the save leaves it as it stands*.
  Where the marks are off for a document (too expensive to read), nothing on
  it can be decided, so a save there fakes none of its names and says so.
  **The save reads the page as the orange marks do.** It used to read the
  text with the run's fakes standing in it, so it disagreed with the marks
  two ways: a real name that is a word of a fake (`Volunteers` inside a fake
  `Volunteers of Columbia`) was warned about as unreviewed though nothing on
  the page marked it, and once decided it was written into the middle of the
  fake; and an orange name beside a fake in a citation (`Volunteers v.
  Quillmark Corp. (2019) …`) read to the save as a cited decision's party and
  was left standing, still orange, after you had said to fake it. Now what
  is orange is what the save writes once decided, the run's fakes are never
  written into, and a name you said to fake that the save still cannot write
  is named in red rather than left silently.
  **And closing on one asks first.** Nothing is lost by the close — the name
  is still in the file, to be found again the next time the document is opened
  — but what is left behind is a scrubbed export carrying a real value, with
  the operator believing the document has been read. That is the mistake the
  whole tool exists to prevent, so it is worth a prompt that sometimes says
  what you already knew. Switching documents does **not** ask: the walk moves
  from export to export by design, and a prompt at every step would be a
  prompt nobody reads.
- **The case folder read on, without a combined file.** A case is one filing in
  pieces, and `Combined Text.txt` is the file you read when you want the case
  rather than the motion — but somebody has to have built it, it is stale the
  moment one export is re-run, and a save of it writes every document at once.
  **↕ Read folder on** (the PDF group, on by default, remembered) is that
  reading without that file: as the foot of the open document comes into view
  the **next export in the Documents list** is read and hung underneath it,
  with a divider naming it and an **Open on its own** button, and so on down
  the folder. Nothing is combined on disk and nothing is written that you did
  not edit.
  **It reads both ways.** The export you open is rarely the first paper in the
  case, so coming back up to the head of the reel hangs the export **before**
  it above, and so on back up the folder. Reading back is asked for rather than
  assumed — a document opens at its own first page, and the papers behind it
  are pulled in when the reading comes up the column, not the moment it opens.
  The reading itself does not move while they arrive: pages going in above the
  window would push it down, so the scroll is put back by exactly the height
  that went in. Going up is the more expensive direction — a page is named by
  its place in one page list, and a document hung above renumbers every page
  below it, the sections, the spot keeps and the undo history with them — so a
  document is never hung above while the leak review, the names walk or the
  redaction check is open, each of which is holding page numbers of its own.
  Everything that already knew how to put several documents beside one page
  list goes on working, because the pages ARE one list: the PDF pane matches
  each document to its own PDF through the key, the citation underlines and the
  Authorities panel run across the whole reel, and the leak review walks it.
  **The document you are reading is the one you are looking at** — the status
  bar, the Documents list, the spot keeps and the file a save adopts all follow
  the reading line across a divider. A save writes **every document you edited,
  each to its own file under its own name**, and names them; one you scrolled
  past and did not type in is not rewritten, so reading forty documents does
  not put forty timestamps through a review that changed one line of one of
  them. The reel never runs off a `Combined Text.txt` (that file is every other
  document over again, and is a reel already), and it stops after 25 documents
  in all, either end — a page of a long export is not free, and a folder can
  hold three hundred — saying so, with the next one a click away in the list.
  The **numbered margin is the boundary**: nothing the grid does puts a line
  left of it. A PDF carries margin furniture the export has not — the firm
  printed down the side, a seal, a stamp — and the body's margin is the one
  its rows share, not the leftmost thing on the page. One margin serves the
  whole document, so the numbers stand in a single straight column down it.
  **A caption box starts at that margin too**, and its column of bars runs
  straight down: a box is drawn as a table rather than on the numbered grid,
  and beside a PDF it used to take the reader's own gutter instead of the
  PDF's margin — the one page with a box on it drawn out over its own line
  numbers while every other line sat at the margin. **And the numbers stand
  one on top of the other**, in the flowing page as beside the PDF: the
  caption box's numbered rows had their numbers, and the margin's rule, a
  little to the right of the rest; and a page set smaller to fit its paper
  had its margin a little to the left of the next page's. The margin and
  the numbers' right edge are at one place on every line of every page.

  **A file opened on its own brings its whole folder, unless that crashed
  last time.** Where the reader knows the case folder a file sits in, opening
  that file adopts the folder as **Open case folder** does: the key, the
  flagged values, the LEAKS worksheet, the list of exports, the sweep, the
  reel and the PDFs matched by name. If a session **went down with a whole
  folder open**, the next file comes in on its own instead — the folder's
  **pseudonym key**, **flagged values** and **LEAKS worksheet** and nothing
  else — and the offer bar asks before reading the rest. **Read the whole
  folder** (there, or under the Documents list) brings it in and makes it the
  default again; if it goes down again, the reader is back to asking.

  The folder sweep — which reads every other export in the case for names
  standing in the clear — **is proportional to the folder, not to the key**.
  A key value holding a run of blank between its words (a name the run
  captured standing in two columns of a caption, or wrapped at the margin)
  used to be read as one gap per space, which on a page of columns quadrupled
  in cost with each space: eight of them took two seconds a page, and one
  export took **two minutes** and hung the tab. A run of blank is one gap.

  **Forget this folder** (under the Documents list) lets go of the case
  folder and reads whatever you open on its own: no sweep of the other
  exports, nothing read ahead, no reel reading on, no PDFs matched by name.
  **The key stays attached**, so the marks stand. The folder is not remembered
  either, so opening a file from it does not bring it back — **Open case
  folder** does, whenever you want it again.

  In a **big case folder** (more than two dozen exports) it stops at 8: there
  every document has a PDF behind it, and a review holds every page of the
  reel live. It also stops at **600 pages** however few documents that is,
  since twenty-five hundred-page exhibit sets are not the same reel as
  twenty-five proofs of service.
  The status bar says where the reel stands: `3 of 5 on the reel`, and where it
  has read the folder out at one end or both.
- **Auto-scroll in pages per minute, not a pixel speed.** **↓ Auto-scroll** (or
  **A**) creeps the document so you stop reaching for the wheel, and what you
  set is **pages per minute** — **[** and **]** by 0.1 at a time, remembered.
  The pixels follow from the page: each page's own rendered **height** sets the
  speed under the reading line, so every page crosses it in the same time. The
  zoom, the leading, the page width and the PDF grid then take care of
  themselves — they change the pixels a page takes, the height is measured in
  those pixels, and the pace stays put. Speeds ease over about half a second
  between pages, so a page boundary is not a gear change.
  **A scroll of your own is not a stop.** Reading is not one-directional — a
  name checked three lines back, a wheel notch that overshoots — so a wheel,
  a drag, a scroll key or the PDF pane pulling the text along beside it all
  **suspend** the creep and it picks up on its own about a second after the
  scrolling settles, from wherever you left the page. **Space** is the pause
  that sticks. It also holds still for anything you are in the middle of: a
  selection you are holding, a keep menu or a swap popup over the text, the
  LEAKS or names review (both put the text at a row and ask about that row),
  and the redaction tool — and that hold does not time out, it waits for the
  work to be put down. At the foot of the document it stops and stays armed,
  so Space reads on from wherever you scroll back to. The mode is **sticky**:
  turn it on and the next document opens already moving.
  Motion is sub-pixel. At a reading pace this is ten or twenty pixels a
  second, and `scrollTop` only moves in whole ones, which at that speed
  ratchets; the whole pixels go to `scrollTop` and the remainder is carried by
  a transform on the page column, snapped to the **device** pixel grid so the
  type is never left resampled onto a half pixel.
- **The rest of the reading tools from the PDF viewer.** **Shift + Space**
  opens the citation under the pointer, or every citation in the selection, in
  background tabs, as on a PDF; the theme toggle and the Authorities panel are
  the viewer's own. The Documents / Pages / Flagged panel collapses on its **»**
  chevron (or **▤ Panel**), stays closed until it has something to show, and
  remembers your choice.
- **The PDF it came from, beside the text or swapped into it.** PDF-Linker
  leaves the PDF in the case folder under its real name and names the export
  for the same stem scrubbed, so the reader finds the pair by running each
  PDF's name forward through the key (a `Combined Text.txt` is matched member
  by member off its banners); where nothing matches — a lone file, a folder
  with no key — **⇄ PDF pages…** offers **Pick PDF…**, and a dropped `.pdf`
  is taken the same way. A pane with nothing to show **says which of the
  three things is missing**, since "no PDF matches" read as a matching
  failure when usually there was nothing to match: no case folder open means
  no PDFs at all (and the pane offers to open one), no key means the names
  cannot be compared — a PDF keeps its real name and the export is named for
  the same stem scrubbed, so only the key can tell that
  `Rasho v Quillmark - MTC.pdf` is `Strangeways v Melbury - MTC.txt` — and
  with PDFs and a key in hand it says the names simply do not meet. The
  suffixes are never the difficulty: `.pdf`, `.txt` and `.txt.LEAK` all come
  off before the comparison, and a combined file's 21 members match their 21
  PDFs by name through the key. The PDF is read only when it is first shown.
  **⇔ Side by side** opens the PDF in a pane beside the text, one PDF page per
  text page, scrolling together — and each text page laid out on **its PDF
  page's own geometry**: the same width and height, label and all, and, where
  the PDF's text layer carries the pleading numbers down its margin, every
  numbered line at its number's own height, the body starting at the PDF's text
  margin, the leading the PDF's pitch, so **line 7 stands beside line 7**.
  The grid used to be a second switch, on the reasoning that a reader opening
  the pane to check one name does not want the document re-set around them. It
  is one control now: a pane whose pages do not line up with the pages beside
  them is half of what the second column is for, and reaching for another
  switch to get the other half was a step between the reader and the thing they
  opened the pane to do. Closing the pane puts every page back the moment it is
  switched — its own font, size, width and leading, every line where it flows.
  One thing the grid costs, and it is worth knowing: the **citation underlines
  are off while the pane is open**, being strips measured off lines the grid
  has moved. The **§ Authorities** panel still lists every authority in the
  document and its links still open, and the status bar says so; the underlines
  come back the moment the pane closes. What follows describes the grid.
  **The sheet is never wider than the page you are set to.** The scale comes
  from the type — the PDF's body drawn at the reading size — and on a filing
  set in large type, or at a large reading size, that asked for a sheet half
  again as wide as the page you chose and a document you had to scroll
  sideways to read. Your width caps it: past that the page is drawn at your
  own width and the scale follows the sheet, so the grid inside it still lands
  on the PDF, and the status bar says so.
  **The top margin is the PDF's, not the export's.** PDF-Linker writes a
  page's top margin as blank lines above its first line, and those used to be
  stacked at the head of the sheet a line's height apiece, pushing line 1 and
  everything under it down the page — a band of white above the text that the
  PDF beside it does not have — while the blank lines under the last line
  grew the sheet past its PDF page. An empty line (no words, no margin number)
  now takes no room on the grid, so the first line stands where the PDF's
  does and the two sheets are the same height. A page with no grid to lay
  its lines on (a scan with no text layer) hides those leading blank lines
  while the pane is open — they are still in the file and still saved — and
  starts its text where the PDF's first printed line is, or an inch down
  where the PDF cannot say.
  **A line too long for the page comes back onto it.** The reader's font is
  not the filing's, and the same characters set in it run a little wider than
  the column the PDF gave them; past the sheet's edge they are gone, and the
  sheet no longer grows past the width you chose. Where the row has blank
  space **in front of** the text — the indent the PDF put it at — the line
  slides back into it, by what it overruns or by what the indent has to give,
  whichever is less. Its top never moves, so it still stands beside its own
  row; the indent is what gives. **Whatever is still past the edge after that
  is narrowed, never cut**: the line is drawn squeezed across by what it
  overruns, in its own type and at its own height, the way pdf.js fits its
  text layer to the page — so pleading paper, whose lines all start at the
  body margin and have no indent to give, ends every line at the sheet's edge
  with its last words still on it.
  **A page wider than its column stays centred.** Zoomed in, or side by side
  on a narrow window, the page is scrolled to sideways — and each column now
  remembers where its middle is and puts it back whenever a width changes
  (zooming, the find bar, the grid landing, the window), where it used to keep
  a pixel position that drifted the page off to one side. A sideways scroll
  you make yourself is what moves that middle.
  **The grid follows the reading.** A page's line grid is read, and its lines
  laid on it, for the page the reading is on and the page either side —
  never the whole PDF at once, which on a long exhibit set or a combined file
  was work and memory the tab could go down under. A page keeps its placement
  once it has had it; one the reading has not reached yet stands at its PDF
  page's own size with its lines flowing, and is laid on its grid as the
  reading comes to it. Every page, laid or not, is its PDF page's height, and
  footer lines under the last numbered line (the page number, the document's
  title) go to the rows the PDF prints them on rather than running the sheet
  past the foot of the paper. **One scale for every page of a filing.** The scale is
  the PDF's body type drawn at the reading size, and the body was read off
  each page on its own — so an exhibit's **title page**, which carries
  "EXHIBIT A" and nothing else, was drawn to put a 36-point heading at fifteen
  pixels: a quarter-size sheet with the PDF beside it shrunk to match, and any
  two pages of one filing at two sizes wherever their type differed. The body
  is read over the **whole PDF** now. A title page is the size of the pages
  around it and shows a large heading on it, the way the PDF does. **And the
  two columns are boxes, not just pages.** A page's height comes from the same
  arithmetic the bitmap is drawn by, so a height rounded one way and a canvas
  rounded the other cannot put a pixel between them — a pixel a page is a
  centimetre by the fortieth, one column sliding under the other with nothing
  visibly wrong on either. Where a line pushed past the PDF's own foot makes
  the text page taller than its PDF page (an export's footer or stamp below
  the last numbered line), **the slot grows with it** rather than the columns
  parting; the bitmap keeps its size and the box is held open under it. The
  page labels are levelled to the taller of the two for the same reason, and
  measured afresh each time: a label that wraps (a REVIEW clause on a narrow
  sheet) used to hold its pair a line out of step every other time the layout
  ran, and for good once the wrap went away. A document the reel has put down
  keeps its pages at their PDF pages' size, beside slots of the same width, so
  the columns stay level past it. **The PDF page is drawn in your screen's own
  pixels**, the fix the PDF viewer had first: on a scaled screen (125%, 150%,
  a browser zoom) its bitmap is shown at exactly its own size, where a rounded
  size had the browser resample some pages and leave others sharp; it is drawn
  again when the window moves to a screen of another scaling or the zoom
  changes, where it used to stay stretched until it happened to be redrawn;
  and a Retina screen zoomed past 150% is no longer held at three times. **A
  text page with no PDF page keeps the pane level with it.** A combined file
  always has two kinds: its own list of the documents in it, at the top, and a
  banner page before each member. Each of those used to stand beside a stub of
  a slot — a 580px contents page against a 16px strip, a 148px banner page
  against 30px — so the two columns were out of step from the first page and
  ran three thousand pixels apart over a case's worth of documents: the PDF
  never sat beside the text being read, whichever side was scrolled. Such a
  slot now takes its text page's own height and its own anchor, nothing to
  show but the same amount of it, and the contents page's slot says what it
  is. The columns sit level to within a pixel at every scroll position, from
  either side. A page with no numbers (an exhibit, a letter, an order) is laid
  out on the PDF's printed **rows** instead: each text line is matched to the
  row carrying its words and takes its top and left, so paragraphs and
  headings sit where the PDF's do. **The size is the zoom, and the PDF's type
  sets the text's.** A page is a page: the type keeps its own spacing at any
  size, the way a PDF does. The reading size is the size of the *body* type —
  the PDF's body drawn at that size fixes the scale, and the sheet, the grid,
  the margins and the PDF page beside it are all drawn at it, so the two are
  one size to the eye at any zoom without a hand adjustment — and where the
  PDF's type varies, each line takes its own row's size: a heading larger, a
  footnote or an exhibit's small print smaller, so a page of tight rows fits
  them. (The leading setting has no say here; the PDF's rows are the leading.)
  Setting the size up **grows both sheets** instead of pushing the lines
  together. A page too wide for its pane runs past the edge with a horizontal
  scroll bar under it, and a line too long for the PDF's own column is never
  wrapped either: the sheets widen by what the longest one needs. Each pane
  scrolls sideways on its own — the text sheet is wider and its margins are
  not the PDF's. **Never on top of itself:** where the PDF's own rows sit
  closer than a line of type is tall (a scan's text layer, a signature under
  its rule) the line is pushed down to clear the one above, a line out of
  register with the PDF and legible — reading the text beats lining it up.
  **On pleading paper the numbers never move:** a numbered line stays at its
  number's height whatever stands between it and the one above, and the
  caption's single-spaced lines between two numbers clear each other by their
  type size, as the PDF sets them. (They used to be given a whole line's box
  apiece, which pushed each one a few points down into the next and the
  numbers with them, until the numbers down the side were out of step with the
  PDF's and two of them stood crowded together where the push ran out.) Lines
  with no room between two numbers share the space evenly. **Only the numbers
  in their order count**: a number the OCR misread out of its order (line 17
  read as 11) used to pin its line at the wrong height and cram every line
  from there to it into the space above, leaving the rest of the page empty;
  a number out of order, or past the last one the PDF's margin carries, is now
  laid out like an unnumbered line, by its words, and the page stands line
  for line beside its PDF.
  **A page with no numbers stands where the PDF prints it, columns and all.**
  An exhibit, a letter, a Westlaw printout is matched to the PDF's printed
  rows, and the export's character grid is read back off the PDF: where each
  line's text begins in characters, against where its row begins on the page,
  gives the grid's left edge and the width of one of its characters there. Every
  line is set on that grid, so an indent, a centred heading, a signature block
  and a two-column page's right-hand column stand where the PDF prints them —
  the right-hand column straight down the page, including the half of a line
  whose left-hand column runs up to it with a single space between. A column
  covers only the lines it runs down: a form's box beside its caption, or the
  party boxes beside a signature, say nothing about the prose above and below
  them, and an indent that several lines share (a form's checkbox items, an
  address block) is not a column at all. A piece of
  a line wider than its place in the reader's font is drawn at its own width
  wherever the blank before the next column has room for it, a space to spare,
  and nothing moves. Only a piece that would run into the next column's text is
  drawn narrower, by just what it would overrun, rather than push its column
  along — and never below three quarters of its width: a real name much longer
  than its fake takes the room it needs and moves the column over, a space
  clear of it, instead of being drawn with its letters on top of each other. A
  name is never cut between columns, even where one of its words happens to
  begin where the page's second column does. A page that gives no grid (no line begins
  anywhere but the margin) keeps each line at its own row's left, its leading
  spaces no longer added on top. The two halves of a two-column page are set to
  their own leading, a few points apart, and are now two rows and two lines that
  stand beside each other rather than one pushed under the other: the page no
  longer runs a third again past its PDF. The
  two panes scroll together, anchored on each page's first printed line. **The
  PDF's text is selectable and copies**, in the pane and on a swapped-in page:
  drag from the margin, from the space before a word, or let go after the
  period — every point snaps to the nearest character on its own row, so the
  clipboard carries the passage under the pointer and never the line numbers
  down the side (they are blanked in the text layer, as the PDF viewer blanks
  them); a double click takes the word, a triple the row. A click or a drag
  begun on the pane's grey, around and between the pages, or on a page's
  label above it, selects nothing (it used to start at some page's first word
  and take everything above the line the drag reached). Display only — the
  layout lifts when the pane closes; remembered. **The members' PDFs open one
  at a time, in the order the file lists them.** A combined export names two
  dozen documents, each with a PDF of its own, and asking for them all as the
  pane is built meant two dozen files read whole, parsed, every page measured
  and its text read for the line grid, all at once and all competing, before a
  single page could be looked at — about a second and a half on a 21-document
  case before anything was drawn, now a quarter of one. They go through a
  queue: one document at a time, the first member's pages ready while the
  twenty-first waits its turn, and whatever the reader has actually scrolled
  to **jumps ahead of the rest** (a page coming into view moves its PDF, and
  the reading of its grid, to the front). A page is worth seeing before it is
  worth aligning, so each PDF's line grid is read after the documents already
  waiting, and the pane re-aligns as it lands. With it off, a page whose text
  is not worth reading (an exhibit the OCR mangled) is **swapped**: the **⇄
  PDF** button on the page's label shows the PDF page in the text's place, the
  rest staying text, and **⇄ PDF pages…** takes a run — `5, 12-18` — of the
  export's own page numbers. The swapped text is hidden, not removed: a save
  still writes it, and ⇄ Text puts it back. Swaps are remembered per document
  by PDF page number. Rendered pages are dropped as they scroll far out of
  view, so a long PDF costs no more than the pages in reach.

- **⊘ Did not OCR strips a page's text for good.** Where ⇄ PDF hides a
  mangled page's text and still saves it, **⊘ Did not OCR** on the page's
  label (beside ⇄ Raw and ⇄ PDF) takes the text out and writes one line in
  its place,
  `[DID NOT OCR]`, so whoever reads the export next is told the page is there
  and its text is not, instead of being handed the noise. The page header
  stays, and so does PDF-Linker's *Authorities cited* list when it is the
  last page that is stripped. A page stripped while it shows its text turns
  to its PDF page (as ⇄ PDF would), since the mark is all its text now says;
  side by side the PDF page is beside it already, and a page shown raw stays
  raw. It is an edit like any other: Ctrl+Z puts the text back, on screen
  again rather than under the PDF page, and 💾 Save writes it.
  **And PDF-Linker is told, so the page stays stripped.** A full PDF-Linker
  run rebuilds every export from its PDF, so on its own the strip lasted until
  the next run, which OCR'd the page again and wrote the noise back. The page
  now also goes on `New Real Values.txt`, as a line `did not ocr: FILE | page
  N` — FILE is the PDF's name where the reader knows it (the side-by-side
  pane's own match) and the export's otherwise, N the PDF page — and 💾 Save
  writes it with the document. PDF-Linker's next run (or **Apply Fixes**)
  marks the page in the PDF itself, never OCRs it again, and exports it as
  `[DID NOT OCR]` under a header saying so; the line is spent from the file
  as the mark lands. The Flagged panel lists the pages waiting to be handed
  over, and a page comes off that list when Ctrl+Z puts its text back or
  when an export PDF-Linker wrote shows it as its own. The list is read off
  the pages, so a reload, an undo or another session's save cannot leave it
  saying something the text does not.
  **…and ↻ OCR This Page undoes it.** On a page that already reads
  `[DID NOT OCR]` the same button reads **↻ OCR This Page**, in red, so a page
  with no text in it stands out down the document. Where the strip
  is the reader's own and its line never reached the case folder, the page's
  text comes straight back (one undo step; Ctrl+Z strips it again), and shown,
  where the strip had turned the page to its PDF page. Otherwise
  PDF-Linker may already have marked the page in its PDF, so the page goes on
  `New Real Values.txt` as `ocr again: FILE | page N`: PDF-Linker takes the
  mark off and its next full run reads the page again and exports its text.
  Until then the page still reads `[DID NOT OCR]`, the button shows the
  request as made (**✓ OCR This Page**), and a second click withdraws it. The
  Flagged panel lists these pages too, and a page comes off that list once an
  export shows it read again.

- **The Pages tab: every page, and ⊘ Did not OCR on several at once.** The
  side panel's **Pages** tab (beside Documents) is the PDF viewer's Pages
  panel for a text export: a **picture of every page** with its label under
  it, and a tag where it reads **DID NOT OCR**, is asked to be **OCR'd
  again**, or is handed over as **Use my text**. Where the export's PDF is
  matched, the picture is that PDF page, so a scan the OCR made nothing of is
  plain at a glance; where none is, it is the text page drawn small. A click
  on a page goes to it, and the page you are reading is ringed as you scroll.
  A reel or a `Combined Text.txt` lists each document under its own name.
  **Drag over the pages that did not OCR** to tick them: press on one and
  drag onto another, and every page between is ticked; hold the drag past the
  top or foot of the list, or turn the wheel while you hold it, and the list
  scrolls on with the ticks following, so a run longer than the panel is one
  drag. A new drag starts the ticks again; **Ctrl+drag** (⌘ on a Mac) adds a
  run to the ones you have, **Shift+click** ticks a run from the last page,
  and a page's box (or **Ctrl+click**) ticks one. **Clear** unticks them all;
  there is no tick-everything, since a document that did not OCR from end to
  end is one not to run at all. **⊘ Did not OCR** at the head of the list
  strips every ticked page as the label button strips one: `[DID NOT OCR]` in
  its place, each page turned to its PDF page, each put on
  `New Real Values.txt` by 💾 Save. It is one step: Ctrl+Z puts every page
  back, and ↻ OCR This Page on any one of them puts that page's own text back.
  A ticked page that already reads `[DID NOT OCR]` is passed over. The
  pictures are blurred while 📷 Screenshot takes its picture, since its fakes
  cannot reach into them.

- **Margin numbers the OCR missed are put back.** On a scanned pleading the
  OCR loses some of the numbers down the margin: a line comes out with no
  number, an empty numbered line comes out blank or not at all, a 12 comes
  out as `l2`, or as another number out of its order. Where a page carries at
  least half of its numbers (and eight or more), the reader takes the missing
  ones for an OCR defect and puts them back as the file is opened: between
  two numbers it read, one to a line where the lines match the numbers
  missing, as bare numbers where no line stands for them, and `l2`, `I7` or a
  number out of order put right; above the first number and below the last,
  on the lines that stand against them, to the number the document's pages
  run to (28 on California pleading paper). Where it cannot tell which line a
  number belongs to — a caption's single-spaced lines between two numbers —
  it leaves the page as the OCR wrote it, since a number on the wrong line is
  worse than one missing. The numbers put back are in *italics* in the margin
  and a toast says how many; the file has them once you save, and closing
  without saving loses nothing (they are put back again next time). A page you
  hand over with ✎ Use my text is saved with them, so the text PDF-Linker is
  told to use is the text in the file.

- **The margin numbers stay out of a selection.** On pleading paper the line
  numbers are not selectable: drag across several lines and only the text is
  highlighted, and a copy is the passage without a number on a line of its own
  between every two. Press in the margin, on a number or beside it, to start
  the selection at the start of that line's text and drag from there, down the
  margin for whole lines; hold past the top or foot of the window and it
  scrolls. A double click on a number selects that line's text, Shift+click on
  one extends the selection to the start of its line, and in ✎ Edit a click on
  a number puts the caret at the start of the line.

- **✎ Use my text hands PDF-Linker a page you transcribed.** Beside ⊘ Did not
  OCR, for the other answer to a mangled page: the OCR was bad, so you type
  the page's text in by hand until it says what the page says, and the text
  is to replace what the PDF carries. A full PDF-Linker run rebuilds every
  export from its PDF, so on its own the transcription lasted until the next
  run, which read the bad text layer again and wrote it back over your work.
  **✎ Use my text** puts the page on `New Real Values.txt` as `text
  corrected: FILE | page N | sum …`, FILE and N as for a DID NOT OCR line, and
  💾 Save writes it with the document. PDF-Linker's next run (or **Apply
  Fixes**) reads the page out of the export you saved, puts the real names
  back where the export carries their pseudonyms (through the folder's own
  key), and writes the text into the PDF as the page's text layer, word by
  word where the old layer put its words; it marks the page so no OCR pass
  reads over it again, spends the line, and from then on exports the page
  off that layer under a header saying TEXT CORRECTED. The **sum** is the
  page's text as you last saved it: PDF-Linker applies the line only where
  the export's page still reads that way, so a line that outlived its text
  (the page typed over and not saved, or the export rewritten since) never
  writes the wrong text into the PDF — it stays in the file, and the page is
  saved and marked again. A transcription a run could not apply is kept in
  `Edited Pages Not Applied.txt` in the case folder before that run rewrites
  its export. The button reads **✓ Use my text** while the request stands, a
  second click withdraws it, ⊘ Did not OCR on the page withdraws it too, and
  it is off on a page that reads `[DID NOT OCR]`. ⊘ Did not OCR stays for the
  page you cannot read, or that is not worth the typing.

- **Redact the PDF from beside the export.** With the pane open, **▬ Redact
  PDF** (the PDF group of the Tools panel) marks the case folder's own PDF and
  saves a flattened copy with what has to go blacked out. It is the same
  redaction the PDF viewer does, in the place the folder is actually worked:
  the export and the PDF are the same filing seen twice, and the reader
  already has the folder open, the key loaded and the PDF matched to the
  export, so nothing has to be opened in another tab and handed the key a
  second time. Opening the tool with a key loaded **sweeps at once**: every
  real value the key binds is proposed wherever it stands in the PDF — over
  **every page of it**, including the pages the export has no text for and the
  pages nobody will scroll to, because a copy is the whole document. It is the
  PDF's own text that is read, never the export's: the export was scrubbed and
  the PDF is the file that was not. And it is the reader's reading of the key
  — a value you have **kept** is one the review has already said is not this
  matter's to hide, so a sweep does not propose it. Anything the key cannot
  reach you mark by hand on the pages in the pane: **the text** a drag covers,
  or **an area** for a signature, a photograph, an exhibit stamp. Every box is
  a proposal — translucent, the words legible under it, dashed where the key
  proposed it and solid where you drew it, and a click takes one back off.
  **Save redacted copy** writes a new file and never the PDF in the folder;
  what it writes is not the document with rectangles on it but page images
  with the boxes painted into the pixels, carrying no text layer, no
  annotations and no metadata — the rule and the reasons are under
  [Redaction](Redaction.md) above, unchanged. A `Combined Text.txt` shows a
  document per member, each with a PDF of its own, so the boxes are filed per
  PDF and the save writes **one copy per PDF that carries any**, each named
  through the key. Boxes outlast the document on screen — hopping between a
  folder's exports is how a folder is read — and are dropped when the case
  folder changes or you press Clear.

- **A long export opens in one go.** A `Combined Text.txt` carrying a whole
  case — a thousand pages, every citation in them underlined and every name
  from the key put back — is laid out, linked and highlighted in one pass,
  without Chrome offering to stop the page. Three things had made the open
  cost the square of the document's length rather than its length: the
  citation detector looked for a `", et al."` before each `v.` by scanning
  everything before it, and found the start of each line by scanning back
  over the line breaks it had already joined; the reader measured every page
  again for each citation on it, and drew each underline between two
  measurements, so the browser laid the whole document out again for every
  page; and a page's own `querySelector` walked that page's whole subtree,
  once per page, to find a button on it. Each is now done once, a window or a
  carried position rather than a scan, and every measurement is taken before
  the first underline is drawn. A thousand-page export that took half a
  minute opens in about four seconds, with byte-identical underlines, links,
  Table of Authorities, pseudonyms and counts. `node test-long-export-scan.mjs`
  holds the detector's cost to the document's length.

The decisions live in `viewer/textdoc.js` (the page model, the DOM-to-disk
walk, the values file), `viewer/pseudo-key.js` (the key, a port of the
Claude extension's `src/pseudo.js`) and `viewer/pdfsync.js` (which PDF an
export came from, page ranges, where "the same place" is in two scroll
boxes), with `viewer/xlsx-read.js` reading the workbook;
`viewer/leaks.js` (the LEAKS worksheet: rows by header, what a Fix? cell
means, where a row points) and `viewer/xlsx-write.js` (the Fix? cells
written back into the same workbook, every other part copied through);
`node test-textdoc.mjs`, `node test-pseudo-key.mjs`, `node test-pdfsync.mjs`,
`node test-xlsx-read.mjs`, `node test-xlsx-write.mjs`, `node test-rules.mjs`
and `node test-leaks.mjs` cover them, and `node test-long-export-scan.mjs`
covers what a long export costs to scan. `test-rules.html`, opened over http,
reads the drawn boxes' geometry back out of a page, and `test-columns.html`
where a two-column line's pieces stand side by side.
