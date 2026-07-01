// Web-only glue for the PWA shell. Runs after viewer/viewer.js (which exposes
// window.__pdfViewerLoadLocal). Responsibilities:
//   1. Register the service worker (installability + offline + auto-update).
//   2. Feed local PDFs into the viewer: OS file handler (launchQueue), the
//      Open button, and drag-and-drop.
//   3. Manage the empty-state drop zone.
// It touches nothing the extension relies on; it only ever runs on the web.

const dropzone = document.getElementById("dropzone");
const viewerContainer = document.getElementById("viewer-container");
const openBtn = document.getElementById("open-btn");
const fileInput = document.getElementById("file-input");
const openOriginal = document.getElementById("open-original");

// "Open original" needs a source URL (extension redirect). Not meaningful for a
// locally opened file, so hide it on the web.
if (openOriginal) openOriginal.hidden = true;

// If the viewer was navigated to with ?file=<url> (e.g. an extension redirect
// pointing at the hosted app), viewer.js fetches it — hide the empty state.
const hasUrlParam = new URLSearchParams(location.search).has("file");
if (hasUrlParam) hideDropzone();

function hideDropzone() { if (dropzone) dropzone.hidden = true; }

// Defense in depth: hide the empty state as soon as any page is rendered, no
// matter how the PDF got loaded.
const pagesEl = document.getElementById("pages");
if (pagesEl && dropzone) {
  new MutationObserver(() => { if (pagesEl.childElementCount > 0) hideDropzone(); })
    .observe(pagesEl, { childList: true });
}

async function openFile(file) {
  if (!file) return;
  hideDropzone();
  // viewer.js assigns this synchronously during its module evaluation, which
  // runs before this module — but guard just in case.
  let tries = 0;
  while (!window.__pdfViewerLoadLocal && tries++ < 50) {
    await new Promise((r) => setTimeout(r, 20));
  }
  if (window.__pdfViewerLoadLocal) window.__pdfViewerLoadLocal(file);
  else console.error("viewer not ready");
}

// Open button — prefer the native File System Access picker (PDF-filtered),
// fall back to a hidden <input>.
async function pickFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }],
        multiple: false,
      });
      openFile(await handle.getFile());
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return; // user cancelled
    }
  }
  fileInput.click();
}

if (openBtn) openBtn.addEventListener("click", pickFile);
if (dropzone) dropzone.addEventListener("click", pickFile);
if (fileInput) {
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) openFile(fileInput.files[0]);
  });
}

// Drag-and-drop anywhere over the page area.
["dragenter", "dragover"].forEach((ev) =>
  viewerContainer?.addEventListener(ev, (e) => {
    e.preventDefault();
    viewerContainer.classList.add("dragging");
  })
);
["dragleave", "drop"].forEach((ev) =>
  viewerContainer?.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "dragleave" && viewerContainer.contains(e.relatedTarget)) return;
    viewerContainer.classList.remove("dragging");
  })
);
viewerContainer?.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) openFile(file);
});

// OS file handler — fires when the installed app is launched to open a file.
if ("launchQueue" in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params || !params.files || !params.files.length) return;
    const handle = params.files[0];
    openFile(await handle.getFile());
  });
}

// Service worker: installability, offline shell, and auto-update when online.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) =>
      console.warn("SW registration failed:", e)
    );
  });
}
