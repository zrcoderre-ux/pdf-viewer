## Shift + Space = middle click

Chrome opens a link in an unfocused background tab when you click it with the
scroll wheel. **Shift + Space** does the same thing from the keyboard:

- **Rest the mouse on a link** and press Shift + Space — it opens behind the
  page you're reading, right after the current tab (and in the same tab group,
  if there is one). Focus never leaves what you were doing.
- **Select text first** and Shift + Space opens *every* link the selection
  covers, in reading order — sweep a paragraph of citations and pull all of
  them at once, into a **tab group** of their own named `Links` rather than
  strung along the tab strip. A selection is one act, so all of them means all
  of them: the ceiling is 120, high enough to be a guard against a runaway
  selection rather than a budget. A brief note says how many opened.
- If the mouse is resting on a link *outside* the selection, that link wins —
  the pointer is what a middle click would have acted on.

It works on **every website**, in the PDF viewer and in the text reader, on
the page's own hyperlinks and on the citation underlines this extension adds —
both alike. In the text reader the underline is a thin strip under the words
(so the text stays selectable and editable), and Shift + Space treats the
words above it as the link: point anywhere on a citation, or select the lines
it sits on. With **Edit** on, a selection made in the text opens its citations
rather than typing a space over them, while a plain caret still types the space
even with the pointer resting on a citation — only the underline strip itself
opens then.
**One tab per destination**, always: a citation that wraps across two lines is
two underline strips but still one tab, a case cited three times in the
selection is one tab, and two links that differ only in the anchor they jump to
(`…/FullText?cite=42+Cal.4th+531#p550` and `#p552`) are one tab — the first
spelling is the one opened, anchor and all. A hash that *routes* (`#/matter/12`)
is the address rather than a place within a page, so those stay separate,
and a selection that runs past the bottom of the screen still opens the links
scrolled out of view, not just the ones you can see.

When no link is involved — nothing under the pointer, nothing linked in the
selection — Shift + Space scrolls up a screen exactly as it always has. In a
text box it still types a space; a chat composer keeps the keyboard focus
almost all the time, so there the shortcut answers to the mouse pointer alone
and a selection behind the box is ignored. Turn the shortcut off entirely in
Options → "Shift + Space opens links".

**In the PWA** (no extension to ask) the links open in new tabs in front of the
reader, because only the extension can open a tab that stays behind. Chrome also
lets a page open just **one** tab per keypress unless the site is allowed pop-ups,
so a selection over several links opens the first and the note says
`Opened 1 of 3 links in new tabs — allow pop-ups for this site to open them all`.
Allow pop-ups for the PWA's site once (the blocked-pop-up icon in the address
bar, or Site settings → Pop-ups and redirects) and every link opens. With the
extension installed in the same browser, the PWA gets background tabs like
everywhere else: the extension's copy of the shortcut runs on the PWA's pages
and hands the links to its worker.
