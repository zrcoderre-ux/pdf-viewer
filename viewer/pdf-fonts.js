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
