// text-layer.js
//
// pdf.js's text layer, with its glyph boxes the size of the words they cover
// whatever the window looked like when the first page was laid out. Shared by
// the PDF viewer and the text reader.
//
// pdf.js sizes every span of a text layer against a "minimum font size" it
// measures ONCE per window, the first time a TextLayer is made: the height of
// a one-pixel "X" put on the page. In a window with no layout — a tab of the
// app opened behind another, whose frame is display:none — that height is 0,
// and pdf.js keeps the 0 for as long as the window lives. Every span of every
// page, then and after, gets `font-size: …*0.00px`: a box of no size, which a
// drag cannot land in. The tab opened in the background never had selectable
// text, not even after it was brought forward and drawn again.
//
// The span's font size is the only thing the measure feeds. Its place on the
// page and its width (pdf.js's scaleX, measured on a canvas) come out right
// without layout, so the repair is to write the font size pdf.js would have
// written had the measure come back right: the item's own height, times the
// measure taken again now (1 where there is still no layout, which is what a
// window with no minimum font size set measures).

/** What pdf.js's probe measures in this window now: 0 with no layout. */
function minFontSizeNow() {
  const body = typeof document !== "undefined" && document.body;
  if (!body) return 0;
  const div = document.createElement("div");
  div.style.cssText = "opacity:0;line-height:1;font-size:1px;position:absolute";
  div.textContent = "X";
  body.append(div);
  const h = div.getBoundingClientRect().height;
  div.remove();
  return h;
}

const ZERO_SIZE_RE = /\*0\.00px\)$/;

/**
 * Give a rendered TextLayer's spans their font size back where pdf.js laid
 * them out against a zero measure. `items` is the textContent items the layer
 * was made from. pdf.js makes one span per item that has a `str` (textDivs, in
 * order), so the two are walked together. Returns how many spans were sized.
 */
export function repairTextLayer(textLayer, items) {
  const divs = textLayer && textLayer.textDivs;
  if (!divs || !divs.length || !items) return 0;
  // pdf.js sizes every span of a window against the same measure, so the
  // first with text says which this layer is; one laid out against a sound
  // measure is left exactly as pdf.js made it.
  const first = divs.find((d) => d.textContent);
  if (!first || !ZERO_SIZE_RE.test(first.style.fontSize)) return 0;
  const m = minFontSizeNow() || 1;
  let i = 0, n = 0;
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const d = divs[i++];
    if (!d) break;
    const t = item.transform;
    if (!t || !ZERO_SIZE_RE.test(d.style.fontSize)) continue;
    // pdf.js's own font height for the item: the length of its text matrix's
    // vertical axis, which is the same in the page's flipped frame.
    const fontHeight = Math.hypot(t[2], t[3]);
    d.style.fontSize = `calc(var(--scale-factor)*${(m * fontHeight).toFixed(2)}px)`;
    // A measure over 1 (a minimum font size set in the browser) is undone by a
    // scale, as pdf.js does it.
    if (m > 1) d.style.transform = `${d.style.transform || ""} scale(${1 / m})`.trim();
    n++;
  }
  return n;
}
