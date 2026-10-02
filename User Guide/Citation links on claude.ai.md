## Citation links on claude.ai

The same citation engine also runs on **claude.ai**. When Claude mentions a
case, statute, or California rule of court in a response, the extension overlays
a clickable underline that opens it in your selected provider (Westlaw or
Lexis+) — handy when you're using Claude to find authority and want to pull the
source.

It's **non-destructive**: claude.ai is a React app, so the extension never
edits Claude's DOM. It overlays a clickable link over each citation in a
separate layer and repositions it as the page scrolls or new text streams in.
Each link covers the whole citation (an easy click target) but is transparent
except for a colored bottom border, so it reads as an underline; the color
reflects the active provider (blue = Westlaw, red = Lexis+). It honors the same
provider toggle and `citation_repo.json` as the PDF viewer. Citations inside
hidden or collapsed regions (e.g. a "thinking" panel) are skipped, and links
for text scrolled out of a clipped container are suppressed, so they never land
over unrelated chat text.

**The page is read as one document.** Short-form references point backward —
`Aguilar, supra`, an italicized `Market Lofts` — and the full citation they
resolve against is usually in an earlier paragraph, so detection runs over the
whole page at once rather than paragraph by paragraph. Paragraphs are separated
by a hard break in that text, and a match that runs from one block into the next
is discarded, because no reader sees one citation there.

**What the page has shown you stays.** A chat page is not a document: it mounts
and unmounts its own messages as you scroll, so a Table of Authorities rebuilt
from the live DOM would drop cases as you scrolled past them — the panel
emptying itself behind you. The extension keeps a per-URL memory instead
(`viewer/citation-memory.js`), and two things follow. The Table of Authorities
is cumulative: an authority stays listed for as long as you stay on that
conversation, whether or not the message it came from is still in the page. And
a case cited in a message that has since been unmounted is still available for
an italicized short name further down to resolve against. In-text underlines
are still painted only over text that is actually on the page. The memory is
scoped to one URL — a query string or `#fragment` is the same conversation —
and is cleared when the app navigates to another one, since a different
conversation has different authorities. Switching providers re-derives the
remembered links rather than dropping them.

**A refresh is not a new conversation.** The memory is written to
`chrome.storage.local` under that conversation's own key — a beat after the last
citation is found, and again as the page unloads — and read back on the way in,
so reloading restores the table rather than emptying it, and an italicized short
name still reaches a case the page read before the refresh. What is stored stays
bounded: the 40 most recently read conversations, and nothing untouched for a
fortnight.

**Carry-forward inheritance:** a bare `§ N` / `section N` reference (no code
name of its own) inherits the most recently *named* code before it in reading
order — named in a citation or simply in prose, so "Chapter 12 of Title 10 of
Part 2 of the Code of Civil Procedure … a manufacturer election under section
871.29" links that section to the Code of Civil Procedure even though the code
was never cited with a section of its own. So after "Civil Code § 1671(b)", a
later "§ 1671" links to Civil Code;
if "CCP § 664.6" is then named, a following "§ 664.6" links to the Code of Civil
Procedure. A bare section that appears before any code is named is left unlinked.
(The single-named-code case is just the special case where everything follows
one code.) A bare hyphenated section (`§ 3-310`) needs no code context — the
hyphen identifies it as the model UCC — while a `§§ 1542-1543` range is left for
carry-forward as a span of state-code sections.

**Where it runs.** `claude.ai` is built in. On the Options page, **Link
citations on all websites** turns the same overlay on for the rest of the web,
and an **exceptions** list below it names the sites to leave alone. Westlaw,
WestlawNext, Lexis and LexisNexis are pre-listed there: they link their own
citations, so ours would sit on top and take the click. An exception covers
`http` and `https` both, applies whether or not the all-sites box is checked,
and overrides `claude.ai` too. With the box unchecked, a separate list names
the individual sites to link on (`chatgpt.com`, `*.courtlistener.com`, …).
Adding an exception takes its links down immediately; every other change
applies on the next page load.

A line covers less than it looks like it does in two ways, and both are easy to
write by accident: **a path narrows it to that path**
(`civil.lacourt.org/ecourt/ecms` leaves every other page of the site linked —
name the site alone to cover the site), and **naming a scheme narrows it to
that scheme**. Neither is visible in the box, so the Options page writes out
what every line reaches, under the box, as it is typed:

```
*://civil.lacourt.org/*                   —  civil.lacourt.org, every page, http and https
https://civil.lacourt.org/ecourt/ecms*    —  civil.lacourt.org, only pages under /ecourt/ecms, https only
*://*.westlaw.com/*                       —  westlaw.com and its subdomains, every page, http and https
```


An exception also reaches the PDF viewer, through the URL the PDF was served
from: a document downloaded from an excepted site opens with no citation links
and no Table of Authorities, and the toolbar says so where the citation count
would be. Taking the exception off (or adding one) applies to the open document
right away. A document opened from disk came from no website, so no exception
covers it.

In addition to the in-text underlines, a **Table of Authorities** panel appears
in the right margin whenever at least one citation is found. It is a list of
those links and nothing else, so it never appears where they don't — on an
excepted site, or on a PDF one served. It lists each
unique authority once, grouped into Cases / Statutes / Regulations /
Administrative Guidance / Rules, as a regular blue
hyperlink on the citation text itself (opening Westlaw or Lexis+). The panel can
be minimized to just its header bar and maximized again, **moved** by dragging
its header, and **resized** by dragging the grip in its bottom-left corner; the
minimized state, position, and custom dimensions are remembered.

**Open all cases.** A button in the panel's header — `Open 12 cases`, so the
count is known before the click — opens every case in the table, each in its
own background tab (one per destination, as Shift+Space opens a selection's
links). Only the cases: a statute, rule, regulation or jury instruction is read in place, and
ten code sections in ten tabs is not what the reader came for. The tabs open
behind the page, so the button reports what happened (`Opened 12`) rather than
leaving the click unanswered, and a hosted page whose pop-ups are blocked says
that instead. The worker's twenty-tab cap is for a gesture that named no
count — one link under the pointer; this button carries its count in its own
label, as a selection carries its own extent, so what it asks for is what the
reader asked for, and only a far higher ceiling (120) stands behind it. The tabs arrive as one **tab group**
named `Cases` — a set asked for as a set should not land as three dozen loose
tabs — rather than joining whatever group the page they were asked from sits
in. A browser that won't group them has still opened every one. The same report, with the URLs and the reason any
tab was refused, is logged to the console of the page the panel is on, since
the button's own copy is gone in a few seconds. The button is hidden when the
table holds no cases.

A remembered position is measured against the window it was set in, so it is
re-clamped to the current window every time the panel is shown and whenever the
window resizes. Without that, a panel parked on a wide monitor lands entirely
off screen the next time the same profile opens a PDF in a narrower window —
still enabled, still counting authorities, just nowhere the user can see it,
which looks exactly like the Table of Authorities having switched itself off.
Only the applied position is clamped, never the saved one, so widening the
window again puts the panel back where you left it.
