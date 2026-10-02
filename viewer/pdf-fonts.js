// pdf-fonts.js
//
// THE PDFs' FONTS LIVE IN A DOCUMENT OF THEIR OWN. Shared by the PDF viewer
// and the text reader.
//
// pdf.js loads a PDF's fonts as FontFaces into `document.fonts`, and Chrome
// answers every change to that set — a font added as a page is first drawn,
// the fonts taken away again by `cleanup()` and `destroy()` — by walking EVERY
// piece of text in the document to lay it out again. On a page holding a lot
// of text that is the reading stopping: the text reader's column beside a
// combined file of forty filings is sixty thousand layout objects, a third of
// a second each time a hop to another member's PDF brought its fonts in; the
// viewer's three hundred text layers are the same again whenever a page far
// into a document draws with a font nothing before it used (an exhibit set in
// another face).
//
// So pdf.js is handed this frame's document instead (getDocument's
// `ownerDocument`): the fonts go into ITS set, which has nothing to lay out.
// The catch is that a canvas finds fonts only in the document that made it,
// so every page pdf.js draws for a document opened this way must be drawn on
// one of this document's canvases — `fontCanvas` for a bitmap that is read
// back (toBlob, toDataURL, createImageBitmap), `renderPageOnto` for one that
// is shown, which draws there and copies the result onto the caller's own.
// Drawn on a canvas of the page's own document, a font embedded in the PDF is
// not found and its text comes out in whatever the browser falls back to.
// Checked pixel for pixel against a plain render, embedded and system fonts,
// in the hosted page and in the unpacked extension.
//
// The frame is made once, on first use, and never replaced: a PDF opened into
// it keeps its fonts there for as long as it is open.

let frame = null;

/** The document pdf.js is to load fonts into (getDocument's `ownerDocument`). */
export function fontDocument() {
  if (!frame) {
    frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;left:-10px;top:-10px;width:1px;height:1px;border:0;visibility:hidden;pointer-events:none";
    document.body.appendChild(frame);
  }
  return frame.contentDocument;
}

/** A canvas of the fonts' document, for a bitmap that is read back rather than shown. */
export function fontCanvas(width, height) {
  const c = fontDocument().createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

// THE SCREEN'S OWN PIXELS. A page's bitmap is drawn at devicePixelRatio of them
// to the CSS pixel — the display's scaling times the browser's zoom — and shown
// at EXACTLY its own size over that ratio: `canvas.width / scale` CSS pixels,
// never a rounded CSS size. Drawn one to the CSS pixel, the bitmap was stretched
// to fit on any window not at exactly 1× (a Retina or 150%-scaled screen, a
// window zoomed to 110%), and every word on the page came out soft. Drawn at the
// ratio but shown at a rounded CSS size, it lands on a pixel more or fewer than
// it has wherever that size times the ratio is not a whole number — most sizes,
// at any ratio but a whole one — and the browser resamples the whole page to
// fit: one page sharp and the next soft, by where each falls on the screen's
// grid. Shown at its own size, the browser lays it on the screen's pixels one
// for one wherever it stands (checked in Chromium from 110% to 250%).
//
// Past MAX_PAGE_PIXELS (64 MB of bitmap) the ratio is let down toward 1, never
// below it: a page at 600% on a Retina screen would otherwise be a quarter of a
// gigabyte. Shared by the viewer and the text reader's PDF pane.
export const MAX_PAGE_PIXELS = 4096 * 4096;
/** The bitmap pixels per CSS pixel a page of this CSS size (a viewport, or { width, height }) is drawn at. */
export function pageOutputScale(viewport) {
  const dpr = window.devicePixelRatio || 1;
  return Math.min(dpr, Math.max(1, Math.sqrt(MAX_PAGE_PIXELS / (viewport.width * viewport.height))));
}
/**
 * Calls `onChange` whenever the screen's ratio changes — the window moved to a
 * screen of another scaling, or the browser's zoom changed — so a page drawn
 * at the old one can be drawn again at the new.
 */
export function watchPixelRatio(onChange) {
  matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    .addEventListener("change", () => { onChange(); watchPixelRatio(onChange); }, { once: true });
}

/**
 * `page.render(params)` onto `canvas` — a canvas of the caller's own document —
 * by way of one of the fonts' document at the same size. Answers a RenderTask's
 * shape: `promise` and `cancel`. The copy is skipped where the canvas has been
 * let go of, or sized for another drawing, while this one was under way.
 */
export function renderPageOnto(page, canvas, params) {
  const off = fontCanvas(canvas.width, canvas.height);
  const task = page.render(Object.assign({}, params, { canvasContext: off.getContext("2d") }));
  const promise = task.promise
    .then(() => {
      if (canvas.width === off.width && canvas.height === off.height) canvas.getContext("2d").drawImage(off, 0, 0);
    })
    .finally(() => { off.width = off.height = 0; });
  return { promise, cancel: () => task.cancel() };
}
