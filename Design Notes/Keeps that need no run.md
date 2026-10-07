## Keeps that ask nothing of PDF-Linker (`textdoc.keepNeedsRun`)

A keep says *do not fake this value*. Where the run **faked** it, only
PDF-Linker can put the real name back, so the keep goes into
`New Real Values.txt` and a run has to happen. Where the value **stands in the
clear**, the files already read the way the keep wants them to: there is
nothing to un-fake, and the keep is a note to the reader, not an instruction.

A keep carries one `state`:

| `state` | in `New Real Values.txt`? | meaning |
|---|---|---|
| *(none)* | yes | owed on the evidence |
| `"local"` | no | the case already carries it out |
| `"pending"` | yes | looks local, but the folder has not been read yet |

`owedKeeps` / `formatValuesFile` drop only `local`, and `valuesDirty` counts
only what is owed — so a local keep raises no "not written yet" and no closing
prompt.

**The question is the case's, not the document's.** A keep applies to every
export in the folder, so `fakeStandsInCase` asks the folder: `caseFakes.set`
holds every pseudonym standing anywhere in it, folded. That set is collected by
the pass `sweepFolder` already makes over each export (`pseudo-key.compileFakes`
alongside the existing `compileReals` pass, over the **raw** text — a fake is
standing whatever has been kept, and a cited decision's party was faked too).
Only `w.fake` is read off a row, never `w.real`, which is the half an ambiguous
fake cannot answer for. `fakeStandsInFile` covers the open document, which the
sweep skips.

`caseFakes` is deliberately **not** part of `sweep`. The sweep is an answer
about the keeps and `dropSweep` throws it away on every decision; what the run
wrote on disk does not change when a keep is taken, so the fakes index is keyed
on `{ key, folderDocs }` and survives a walk through the names. It is committed
only when the reading ran to the end **and** every document opened — one
unreadable export reads as "this pseudonym stands nowhere", which is the one
wrong answer that costs a name.

`setKeep` decides at the moment the keep is taken, marking it `pending` when
`caseIsRead()` is false, and kicks `sweepFolder`. `refreshKeepLocality` re-reads
every stated keep when a document opens, a worksheet attaches, or the sweep
finishes. `owe` (→ owed) needs no evidence; `settleLocal` (`pending` → `local`)
needs the folder actually read and refuses a keep already written out.

`fakeStandsInFile` asks the **key's own matcher**, not a plain search, so a
pseudonym wrapped at the margin with a gutter number between its halves still
counts as standing.

**Owed is not for ever.** A keep owed (no state, or `pending`, and every
`never`) is written into `New Real Values.txt` until PDF-Linker spends its
line: the run records it on the master workbook's KEEP sheet and takes the line
out of the file. From then on it is spent, and retired from the case's list
when the folder is opened or the file next written (`TD.spendLines`; see "A
keep PDF-Linker has spent" in `Design Notes/Text reader.md`) — a keep still
owed after its line was spent was written again on every save, and put back on
the master a row the operator had removed there. Spent only in the folder the
line was written into: a same-named copy of the case, or a list saved by a
download, spends nothing ("Only what was written HERE is spent here" in
`Design Notes/Text reader.md`). A `local` keep is never written, so it is
never spent: it stays as the note it always was.
