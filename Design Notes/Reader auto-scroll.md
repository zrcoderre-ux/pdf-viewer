## The reader's auto-scroll (`text-reader.js`, "auto-scroll while reading")

The same engine `viewer/autoscroll.js` runs for the viewer, rebuilt around
`#stage` instead of the window and around a text page instead of a rendered
one. It replaced a px/s counter that stepped in whole pixels and turned itself
off on the first wheel notch. The parts that carry their weight:

- **The pace is pages per minute; the pixels are derived.** Each `.tpage`'s
  rendered height is measured from the DOM, and the speed under the reading
  line is `height * ppm / 60`, so every page crosses it in `60 / ppm` seconds.
  Because the height is measured in the pixels the layout actually uses, the
  zoom, the leading, the page width and the PDF grid need no special handling
  at all. The range is 0.2–5 ppm in 0.1 steps; a pace saved under the old
  `textReader.autoWpm` key carries over at 300 words to the page.
- **The ceiling is a SCREEN figure** — `clientHeight / MAX_SCREEN_SECONDS` —
  rather than a pixel one, so "fast" means the same on any window.
- **Manual scroll suspends; it does not stop.** The reliable signal is not the
  event but `autoWritten`: the tick compares `scrollTop` against the integer
  it last wrote, so the scrollbar, a find, a leak row being scrolled to, and
  the PDF pane pulling the text along beside it are all caught without a
  listener each. `autoBusy()` is the indefinite hold (selection, keep menu,
  swap popup, the LEAKS and names bars, the redaction tool); the resume asks it
  again rather than timing out.
- **Sub-pixel motion is snapped to the device grid.** Whole pixels to
  `scrollTop`, the remainder to a transform on `#pages`. Free-floating would
  resample the type onto a half pixel and leave it soft — the same reason the
  viewer snaps. Writing the same integer twice fires no scroll event, so the
  PDF pane's own sync runs at the stepping rate, not once a frame.

`autoRemeasure()` is the one hook the rest of the reader needs: `afterTextChange`
and `relayout` call it (the pages moved), and `render`/`showPages` call it with
`newDoc` (a new document: its pause and suspension are cleared).
