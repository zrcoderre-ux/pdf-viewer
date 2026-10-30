// split.js — split.html: the extension's viewer, side by side.
//
// The viewer in a tab of its own has no host to put a second PDF beside it,
// so its ⫴ Side by side button comes here (viewer.js, toggleSideBySide):
// ?file= the address it was showing, or ?stash=1 for a file dropped on it,
// which split-view.js kept in IndexedDB. The left frame opens that PDF again;
// the split opens at once, with its card asking what goes on the right.
// Closing the split leaves the one viewer filling the page.

import { createSplit, takeStash } from "./split-view.js";

const params = new URLSearchParams(location.search);
const stage = document.getElementById("stage");
const left = document.createElement("iframe");
left.title = "PDF";
const file = params.get("file");
left.src = file ? `viewer.html?file=${encodeURIComponent(file)}` : "viewer.html";
stage.appendChild(left);

const split = createSplit({ stage, scope: left, primary: () => left.contentWindow });

// The page wears the left document's name, as the viewer's own tab did: a
// print is named after the top document's title.
function watchTitle(w) {
  const apply = () => { document.title = w.document.title || "PDF Viewer"; };
  apply();
  const t = w.document.querySelector("title");
  if (t) new MutationObserver(apply).observe(t, { childList: true });
}

left.addEventListener("load", async () => {
  const w = left.contentWindow;
  for (let t = 0; typeof w.__pdfViewerLoadLocal !== "function"; t++) {
    if (t > 400) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  split.attach(w);
  watchTitle(w);
  if (params.get("stash")) {
    const item = await takeStash().catch(() => null);
    if (item && item.file) await w.__pdfViewerLoadLocal(item.file, item.handle || null);
  }
  split.begin();
}, { once: true });
