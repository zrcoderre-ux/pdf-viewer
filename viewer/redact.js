// redact.js
//
// Redaction: what a redacted copy of a PDF hides, and how the copy is made.
//
// THE RULE UNDER ALL OF IT. A redaction you can undo is not a redaction. Black
// rectangles drawn over a page leave the words underneath them in the file,
// where anything that can select text can read them straight back out — which
// is how redacted filings have been un-redacted for as long as there have been
// redacted filings. So a redacted copy here is not this document with boxes on
// it. It is a NEW document, every page rendered to an image with the boxes
// painted into the pixels, carrying no text layer, no annotations, no form
// fields, no embedded fonts and no metadata. There is nothing left to read
// back, and nothing that says where the file came from.
//
// AND NEVER THE ORIGINAL. The save writes a copy — under the pseudonymized
// name where a key is in hand — and the document the viewer has open is not
// touched. The Save button that writes highlights into a file is a different
// button; this one has no in-place path at all.
//
// WHAT GETS REDACTED. Two sources, which is the whole feature:
//
//   THE KEY IS THE BASELINE. pseudonym_key.xlsx binds every real value in a
//     matter to the fake PDF-Linker wrote in its place. Run forward over a
//     page's own text (pseudo-key.findRealSpans), it says where every real
//     value STANDS on that page, and each of those places becomes a proposed
//     box. That is the same list the exports were scrubbed by, applied to the
//     PDF nobody scrubbed.
//   THE HAND ADDS THE REST. A drag over text proposes the text it covers; an
//     area drag proposes the box itself, for a signature, a photograph, an
//     exhibit stamp, a scanned page with no text layer to name anything in —
//     everything the key cannot reach.
//
// AND NOTHING IS HIDDEN UNTIL IT IS SAVED. A proposal is drawn as a
// translucent red box with the words still legible under it, so what is about
// to go can be read first and taken back off one box at a time. The boxes turn
// black only in the file the save writes. The document on screen never changes.
//
// GEOMETRY. A box is stored in PDF POINTS, not in screen pixels: the zoom
// changes, the page is re-rendered from scratch, the rotate tool turns the
// page, and the box has to stay on the words it was drawn over through all of
// it. Points are the one frame that survives, and the page's own viewport maps
// them back to pixels for the painting and forward to pixels again, at
// whatever resolution the save renders at, for the black.
//
// The decisions here are pure and tested from Node (test-redact.mjs); the
// store and the painting are the DOM around them.

// ── the page's text, and the way back to it ──────────────────────────────────

/**
 * How two neighbouring text-layer spans are joined, read off where they sit:
 *
 *   "\n"  the second starts a new line
 *   " "   a gap on the same line wide enough to be a space
 *   ""    one word cut in two — a font change or a kern mid-word
 *
 * PDF.js lays a page out as a span per text run, and a run ends wherever the
 * PDF's own operators end it: usually at a line or a font change, sometimes in
 * the middle of a word. Joining every span with a space would make "Hel"+"en"
 * into "Hel en"; joining them all bare would make "Helen"+"Rasho" into
 * "HelenRasho". Neither is a name the key can find, so the page itself decides
 * — and a newline rather than a space between lines because the key's matcher
 * reads a line break (and the pleading gutter number after it) as the gap
 * inside a wrapped name.
 *
 * Each span is { text, left, top, width, height } in any one consistent unit.
 */
export function spanGap(a, b) {
  if (!a || !b) return "";
  const at = String(a.text == null ? "" : a.text);
  const bt = String(b.text == null ? "" : b.text);
  if (!at || !bt) return "";
  const h = a.height > 0 ? a.height : (b.height > 0 ? b.height : 1);
  // A new line: the next span has dropped by more than half a line.
  if ((b.top - a.top) > h * 0.5) return "\n";
  // Whitespace already written on either side of the join is the gap.
  if (/\s$/.test(at) || /^\s/.test(bt)) return "";
  const gap = b.left - (a.left + a.width);
  return gap > h * 0.2 ? " " : "";
}

/**
 * A page's spans as one string, with a map from each character back to the
 * span it came from: `map[i] = { span, off }`, or null for a separator this
 * function put in. The map is what turns a match in the text back into a DOM
 * range over the page, which is what turns it into a rectangle.
 */
export function pageTextFromSpans(spans) {
  const list = spans || [];
  let text = "";
  const map = [];
  for (let i = 0; i < list.length; i++) {
    if (i > 0) {
      const sep = spanGap(list[i - 1], list[i]);
      for (let k = 0; k < sep.length; k++) map.push(null);
      text += sep;
    }
    const s = String(list[i] && list[i].text != null ? list[i].text : "");
    for (let off = 0; off < s.length; off++) map.push({ span: i, off });
    text += s;
  }
  return { text, map };
}

/**
 * The span-and-offset range a [start, end) character range covers, or null
 * where the range is nothing but separators. `endOffset` is exclusive, so it
 * drops straight into a DOM Range.
 */
export function spanRangeFor(map, start, end) {
  const m = map || [];
  const lo = Math.max(0, start | 0);
  const hi = Math.min(m.length, end | 0);
  let first = null, last = null;
  for (let i = lo; i < hi; i++) if (m[i]) { first = m[i]; break; }
  for (let i = hi - 1; i >= lo; i--) if (m[i]) { last = m[i]; break; }
  if (!first || !last) return null;
  return {
    startSpan: first.span, startOffset: first.off,
    endSpan: last.span, endOffset: last.off + 1,
  };
}

// ── the boxes ────────────────────────────────────────────────────────────────

const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

/**
 * Rectangles that are one line of text, merged into one box.
 *
 * A DOM range over a phrase reports a rectangle per line AND, within a line,
 * one per span it crosses — a name split across two spans comes back as two
 * boxes with a hairline of unredacted page between them. The boxes wanted are
 * the LINES: two rectangles merge when they sit on the same line (their
 * vertical extents overlap by more than half the shorter one) and touch or
 * nearly touch across the gap between them. Lines stay apart, so a wrapped
 * name does not black out the margin it wraps around.
 *
 * Rectangles are { x, y, w, h } in one consistent frame — PDF points with y up,
 * or layer pixels with y down; the arithmetic is the same either way.
 */
export function mergeRects(rects, gap = 2) {
  const out = [];
  for (const r of rects || []) {
    if (!r || !(r.w > 0) || !(r.h > 0)) continue;
    out.push({ x: r.x, y: r.y, w: r.w, h: r.h });
  }
  for (let again = true; again; ) {
    again = false;
    for (let i = 0; i < out.length && !again; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        const share = overlap(a.y, a.y + a.h, b.y, b.y + b.h);
        if (share <= Math.min(a.h, b.h) * 0.5) continue;          // different lines
        if (overlap(a.x, a.x + a.w, b.x, b.x + b.w) < -gap) continue; // too far apart
        const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
        out[i] = {
          x: x0, y: y0,
          w: Math.max(a.x + a.w, b.x + b.w) - x0,
          h: Math.max(a.y + a.h, b.y + b.h) - y0,
        };
        out.splice(j, 1);
        again = true;
        break;
      }
    }
  }
  return out;
}

/**
 * A box grown by `p` on every side. Glyphs overhang the rectangle their range
 * reports — descenders, italic tails, the antialiased edge of a stroke — and a
 * box drawn to the letter leaves a grey ghost of the word along its border.
 */
export function padRect(r, p) {
  return { x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p };
}

/**
 * A box held inside the page's own box, or null once there is nothing left of
 * it. `page` is { x, y, w, h } in user space — the PDF's own box, which is not
 * always anchored at the origin and is never the SIZE the page is displayed
 * at: a page carrying /Rotate 90 shows 792 wide and is still 612 wide in the
 * coordinates a box is stored in.
 */
export function clampRect(r, page) {
  const px = (page && page.x) || 0, py = (page && page.y) || 0;
  const pw = (page && page.w) || 0, ph = (page && page.h) || 0;
  const x0 = Math.max(px, Math.min(r.x, px + pw));
  const y0 = Math.max(py, Math.min(r.y, py + ph));
  const x1 = Math.max(px, Math.min(r.x + r.w, px + pw));
  const y1 = Math.max(py, Math.min(r.y + r.h, py + ph));
  if (!(x1 - x0 > 0.2) || !(y1 - y0 > 0.2)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ── a page nobody has drawn ──────────────────────────────────────────────────
//
// The viewer marks the page it has on screen: pdf.js has laid its text out as
// spans, the browser knows where every glyph of them sits, and a match turns
// into rectangles by asking it. The text reader has no such page. Beside an
// export it draws only the PDF pages in view, at the pane's width, and the key
// has to be run over the WHOLE document — every page of it, including the ones
// the export has no text for and the ones nobody will scroll to.
//
// The answer is not to guess the geometry from the PDF's text content. A run
// there is usually a whole printed line with one origin and one width, and a
// name inside it would have to be found by dividing that width by the line's
// characters — which for proportional type is wrong by a letter or two either
// way. Wrong by a letter is "QUILLMARK" with the QUI still showing. So the
// page's text is LAID OUT, off screen, by the same pdf.js text layer the
// viewer measures, and the browser is asked where the words are. The bitmap is
// never drawn: a layout is cheap where a render is not, and it is the layout
// that knows where a glyph sits.
//
// What is laid out at scale 1 is measured in points already — one CSS pixel to
// the point — and the page's own viewport carries the rest (a /Rotate, a box
// that does not start at the origin) back into the coordinates a box is stored
// in, exactly as it does for the page on screen.

/** The page's spans as `pageTextFromSpans` wants them, measured in the box they were laid out in. */
export function measureSpans(container) {
  const base = container.getBoundingClientRect();
  const out = [];
  for (const el of container.querySelectorAll("span")) {
    const r = el.getBoundingClientRect();
    out.push({
      text: el.textContent || "",
      left: r.left - base.left, top: r.top - base.top,
      width: r.width, height: r.height,
    });
  }
  return out;
}

/** A page's own box as `clampRect` wants it, from the page's `view`. */
export function pageBoxFromView(view) {
  const v = view || [0, 0, 0, 0];
  return { x: v[0] || 0, y: v[1] || 0, w: (v[2] || 0) - (v[0] || 0), h: (v[3] || 0) - (v[1] || 0) };
}

/**
 * The name a redacted copy is saved under: the document's own stem run FORWARD
 * through the key where one is in hand — a copy of "Rasho v Quillmark - MTC.pdf"
 * is saved as "Strangeways v Melbury - MTC (redacted).pdf" — and marked
 * redacted either way, so the copy is never mistaken for the file it came from.
 * The mark is written once however many times a copy is copied.
 */
export function redactedName(name, forward, mark = "redacted") {
  let stem = String(name == null ? "" : name).split(/[\\/]/).pop().replace(/\.pdf$/i, "").trim();
  if (typeof forward === "function") {
    try { const faked = forward(stem); if (faked) stem = faked; } catch { /* the name it has */ }
  }
  stem = stem.replace(new RegExp("\\s*\\(\\s*" + mark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\)\\s*$", "i"), "").trim();
  return (stem || "document") + " (" + mark + ").pdf";
}

/** How many pages and how many boxes, said the way a bar says it. */
export function countLabel(boxes, pages) {
  if (!boxes) return "Nothing marked.";
  return `${boxes} box${boxes === 1 ? "" : "es"} on ${pages} page${pages === 1 ? "" : "s"}.`;
}

// ── the store ────────────────────────────────────────────────────────────────
//
// pageNumber → [{ id, rects: [{x,y,w,h}] in PDF points, kind, label }]
//   kind   "key"     proposed from the pseudonym key
//          "text"    a drag over text
//          "area"    a drag over a region
//   label  the real value, for a key box; what the drag covered, otherwise —
//          shown on hover, so a box can be read before it is kept.
//
// In memory only, like the highlights: closing the tab drops them. A proposal
// is a thing you are in the middle of, not a thing you keep.
//
// ONE STORE PER DOCUMENT. The viewer has one PDF open and marks that; the text
// reader's pane can hold the pages of two dozen, because a Combined Text.txt
// names a document per member and each has a PDF of its own. A redacted copy
// is a copy of ONE document, so the boxes cannot all live in one pile keyed by
// page: page 3 of the motion and page 3 of the reply are different pages. Each
// document gets a store of its own (`createRedactionStore`), and the viewer's
// single document uses the default one these functions stand for.

export function createRedactionStore() {
  const byPage = new Map();
  let nextId = 1;
  return {
    add(pageNumber, rects, { kind = "area", label = "" } = {}) {
      const clean = (rects || []).filter((r) => r && r.w > 0 && r.h > 0);
      if (!clean.length) return null;
      if (!byPage.has(pageNumber)) byPage.set(pageNumber, []);
      const box = { id: nextId++, rects: clean, kind, label };
      byPage.get(pageNumber).push(box);
      return box;
    },
    remove(pageNumber, id) {
      const list = byPage.get(pageNumber);
      if (!list) return false;
      const i = list.findIndex((b) => b.id === id);
      if (i < 0) return false;
      list.splice(i, 1);
      if (!list.length) byPage.delete(pageNumber);
      return true;
    },
    for(pageNumber) { return byPage.get(pageNumber) || []; },
    pages() {
      return [...byPage.keys()].sort((a, b) => a - b)
        .map((pageNumber) => ({ pageNumber, boxes: byPage.get(pageNumber) }))
        .filter((p) => p.boxes && p.boxes.length);
    },
    count() {
      let boxes = 0, pages = 0;
      for (const list of byPage.values()) if (list && list.length) { boxes += list.length; pages++; }
      return { boxes, pages };
    },
    clear(kind) {
      if (!kind) { byPage.clear(); nextId = 1; return; }
      for (const [pn, list] of [...byPage]) {
        const kept = list.filter((b) => b.kind !== kind);
        if (kept.length) byPage.set(pn, kept); else byPage.delete(pn);
      }
    },
  };
}

// The store the bare functions below work on: the one document a viewer has open.
const _store = createRedactionStore();

export function addRedaction(pageNumber, rects, meta) { return _store.add(pageNumber, rects, meta); }
export function removeRedaction(pageNumber, id) { return _store.remove(pageNumber, id); }
export function redactionsFor(pageNumber) { return _store.for(pageNumber); }
/** Every box, page by page: [{ pageNumber, boxes }], in page order. */
export function redactionPages() { return _store.pages(); }
/** { boxes, pages } — what the bar counts. */
export function redactionCount() { return _store.count(); }
export function clearRedactions(kind) { return _store.clear(kind); }

// ── painting ─────────────────────────────────────────────────────────────────

/**
 * Draw a page's proposals into its layer. `viewport` is the page's display
 * viewport — the stored points go through it, so the boxes sit on the same
 * words at every zoom and at every angle the rotate tool leaves the page at.
 * `onRemove(box)` is called when one is clicked, so a proposal can be taken
 * back off before it is committed to. `store` is the document's own store,
 * where there is more than one document on screen.
 */
export function repaintRedactionsForPage(pageNumber, layerDiv, viewport, { onRemove, store } = {}) {
  if (!layerDiv) return;
  while (layerDiv.firstChild) layerDiv.removeChild(layerDiv.firstChild);
  const held = store || _store;
  const list = held.for(pageNumber);
  if (!list || !list.length || !viewport) return;
  for (const box of list) {
    for (const r of box.rects) {
      const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([r.x, r.y, r.x + r.w, r.y + r.h]);
      const div = document.createElement("div");
      div.className = "redact-rect" + (box.kind === "key" ? " from-key" : "");
      div.dataset.redactId = String(box.id);
      div.style.left = `${Math.min(x1, x2)}px`;
      div.style.top = `${Math.min(y1, y2)}px`;
      div.style.width = `${Math.abs(x2 - x1)}px`;
      div.style.height = `${Math.abs(y2 - y1)}px`;
      div.title = (box.label ? `Will be blacked out: ${box.label}\n` : "Will be blacked out.\n")
        + "Click to take this box back off.";
      div.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
      div.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (held.remove(pageNumber, box.id) && onRemove) onRemove(box);
      });
      layerDiv.appendChild(div);
    }
  }
}

// ── the area drag ────────────────────────────────────────────────────────────

let _marquee = null;
function ensureMarquee() {
  if (_marquee) return _marquee;
  _marquee = document.createElement("div");
  _marquee.id = "redact-marquee";
  document.body.appendChild(_marquee);
  return _marquee;
}

/**
 * Left-drag over a page, while the area tool is on, proposes the box drawn.
 * Alt is left alone: that gesture belongs to the highlight tool's own marquee,
 * and two tools fighting over one drag is worse than either of them.
 *
 * The drag is anchored in DOCUMENT coordinates so a page scrolled mid-drag
 * keeps the box over the same words, exactly as the crop tool does.
 */
export function attachAreaDrag({ pageNumber, pageWrapper, getActive, onBox }) {
  pageWrapper.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.altKey || !getActive()) return;
    if (e.target && e.target.classList && e.target.classList.contains("redact-rect")) return;
    e.preventDefault();
    const startX = e.pageX, startY = e.pageY;
    const box = ensureMarquee();
    box.style.display = "block";
    const paint = (x, y) => {
      box.style.left = `${Math.min(startX, x)}px`;
      box.style.top = `${Math.min(startY, y)}px`;
      box.style.width = `${Math.abs(x - startX)}px`;
      box.style.height = `${Math.abs(y - startY)}px`;
    };
    paint(startX, startY);
    const onMove = (ev) => paint(ev.pageX, ev.pageY);
    const onUp = (ev) => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      box.style.display = "none";
      const r = pageWrapper.getBoundingClientRect();
      const docLeft = r.left + window.scrollX, docTop = r.top + window.scrollY;
      const left = Math.min(startX, ev.pageX) - docLeft;
      const top = Math.min(startY, ev.pageY) - docTop;
      const width = Math.abs(ev.pageX - startX);
      const height = Math.abs(ev.pageY - startY);
      if (width < 4 || height < 4) return; // a click, not a drag
      onBox(pageNumber, { left, top, width, height });
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  });
}
