## Auto-scroll while reading

Ported from the reading auto-scroll in the Inbox Cleaner PWA and rebuilt for a
desktop viewer. Turn it on with the **↓ Auto-scroll** toolbar button or the **A**
key and the page creeps upward continuously, so reading a long PDF costs no
scrolling at all.

Speed is set in **pages per minute** (0.2 to 5), not pixels per second, and the
viewer converts it per page from the height that page renders at: at 1 ppm every
page takes a minute to cross the screen, whether it is a landscape exhibit or a
portrait brief page. Change the zoom and the pace re-derives itself, because
page heights are re-measured after every render. A pace set in words per minute
by an earlier version carries over at 300 words to the page.

It stays out of the way:

- **Scroll whenever you like.** Wheel, trackpad, scrollbar, arrows, PageDown —
  auto-scroll yields instantly and picks back up about a second after you stop,
  from wherever you left the page.
- **It holds still while you're working.** It won't resume while you have text
  selected, or while a dialog, the highlight menu, or one of the mode bars
  (Text area, Fill form, Organize) is open.
- Motion is snapped to the display's pixel grid rather than floated with a
  transform, so page canvases are never resampled and PDF text stays crisp —
  half-pixel steps on a HiDPI screen.

| Key | |
|-----|---|
| **A** | Auto-scroll on / off |
| **Space** | Pause / resume (only while auto-scroll is on — otherwise it's the browser's page-down) |
| **[** / **]** | Slower / faster, in 0.1-ppm steps |
| **Esc** | Turn auto-scroll off |

The floating bar at the bottom has the same controls, and fades back to a
whisper while the mouse is still so it doesn't sit on top of what you're
reading. Speed and the on/off state are remembered, so a reading session doesn't
need re-arming for every file.
