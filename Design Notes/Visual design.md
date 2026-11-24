# Visual design (`pwa/app-web.css`, the last block; `viewer/viewer.css` and `viewer/text-reader.css` tokens)

The owner (2026-11-24): "Do a professionalism upgrade. I am trying to make it
look more like a professionally designed legal product, and less like it was
vibecoded." The rules below are the system; a new Home surface follows them
rather than picking its own colour or shape.

- **Colour says state, and only four states.** In progress is the accent,
  done is `--c-ok`, wants a look is `--c-warn` (`--c-warn-fill` where filled),
  wrong is `--c-bad` (`--c-bad-fill`). Everything else is a neutral. Claude's
  runs use the same four as PDF-Linker's: a running Claude run is the accent,
  not Claude's orange, so "going" reads the same in every column.
- **A status is a dot and words**, not a tinted capsule (`.ci-status::before`).
  The words take the state's colour only for warn, off and running; a
  finished or idle folder is neutral text with a green or grey dot.
- **Filled means a problem.** Briefing chips stay as the owner chose (solid
  for late, missing or personal-service only; outlined when filed), on the
  same radius as every other tag. The summary's filters are neutral buttons;
  the ones that want attention carry a coloured dot, not a coloured outline.
- **Shapes.** `--r-xs` 4px for tags and chips, `--r-sm` 6px for buttons,
  `--r-md` 8px for panels, menus and dialogs. No 999px capsules on Home.
  Every button in a section head, the summary and a selected case's tools is
  `--h-ctl` (28px) tall.
- **Type.** Section heads in sentence case at 15px semibold; the day heading
  is the one place for small capitals. Numbers are tabular everywhere.
- **Selection** is a 3px accent bar and a wash, never a ring; a case folder
  still in Downloads keeps its bar in the warning colour.
- **One palette across the app.** The accent (`#2b59b5` light, `#7aa5f0` dark,
  `#3f6fc9` as a fill) is set in all three stylesheets, and the text reader's
  chrome uses the shell's neutrals instead of its old Chrome-viewer greys.
