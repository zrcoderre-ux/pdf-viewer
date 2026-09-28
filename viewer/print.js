// print.js
//
// Print the whole document, markup included.
//
// The viewer draws only the pages near the screen (viewer.js, "drawing the
// pages that are looked at"), so the browser's own print of the page carried
// a handful of drawn pages and a stack of empty boxes. A print here renders
// every page, from the document AS IT WOULD BE SAVED — comments, drawings,
// signatures and form entries in — into images in a print-only container,
// hands that to the browser's print dialog (which does the printer, the
// copies and the page ranges), and puts it all away afterwards.

import * as pdfjsLib from "../pdfjs/build/pdf.mjs";
import { fontDocument, fontCanvas } from "./pdf-fonts.js";

const PRINT_DPI = 150;
let busy = false;

/**
 * bytes      — the PDF to print (the viewer passes the document with its
 *              annotations written in)
 * rotations  — Map<pageNumber, degrees> of on-screen rotation to print with
 * onProgress — (done, total) as pages are prepared
 */
export async function printDocument({ bytes, rotations = new Map(), onProgress = () => {} }) {
  if (busy) return false;
  busy = true;
  const root = document.getElementById("print-root");
  const urls = [];
  let doc = null;
  try {
    doc = await pdfjsLib.getDocument({ data: bytes, ownerDocument: fontDocument() }).promise;
    root.textContent = "";
    const scale = PRINT_DPI / 72;
    for (let pn = 1; pn <= doc.numPages; pn++) {
      const page = await doc.getPage(pn);
      const rotation = (((page.rotate + (rotations.get(pn) || 0)) % 360) + 360) % 360;
      const vp = page.getViewport({ scale, rotation });
      const canvas = fontCanvas(Math.round(vp.width), Math.round(vp.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp, intent: "print", annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS }).promise;
      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
      canvas.width = canvas.height = 0;
      page.cleanup();
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const box = document.createElement("div");
      box.className = "print-page";
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      box.appendChild(img);
      root.appendChild(box);
      onProgress(pn, doc.numPages);
    }
    // Every image decoded before the dialog takes its snapshot.
    await Promise.all([...root.querySelectorAll("img")].map((im) => im.decode().catch(() => {})));
    document.body.classList.add("printing");
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; window.removeEventListener("afterprint", finish); resolve(); };
      window.addEventListener("afterprint", finish);
      window.print();
      // Some browsers return from print() only after the dialog closes and
      // never fire afterprint; the timeout covers them.
      setTimeout(finish, 1500);
    });
    return true;
  } finally {
    // Leave the images in place until the print has been spooled.
    setTimeout(() => {
      document.body.classList.remove("printing");
      root.textContent = "";
      for (const u of urls) URL.revokeObjectURL(u);
    }, 2000);
    if (doc) { try { await doc.destroy(); } catch { /* gone */ } }
    busy = false;
  }
}
