// Bare-bones PDF viewer for the PWA shell.
//
// This deliberately does NOT do citation linking, OCR, etc. — it just renders
// a PDF with PDF.js. Its whole point is to be the *dedicated app window*: once
// the PWA is installed, PDFs opened from the OS ("Open with") or captured by
// the companion extension land here in a standalone window instead of a
// browser tab.
//
// It can receive a PDF three ways:
//   1. launchQueue  — the OS file handler (double-click / "Open with").
//   2. ?file=<url>  — a URL query param (how the extension would redirect).
//   3. file input / drag-and-drop — manual, so the app is usable on its own.

import * as pdfjsLib from "./vendor/pdfjs/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "./vendor/pdfjs/pdf.worker.mjs",
  import.meta.url
).href;

const filenameEl = document.getElementById("filename");
const statusEl = document.getElementById("status");
const pagesEl = document.getElementById("pages");
const viewerEl = document.getElementById("viewer");
const dropzoneEl = document.getElementById("dropzone");
const zoomInEl = document.getElementById("zoom-in");
const zoomOutEl = document.getElementById("zoom-out");
const zoomLevelEl = document.getElementById("zoom-level");
const openBtnEl = document.getElementById("open-btn");
const fileInputEl = document.getElementById("file-input");

let currentDoc = null;
let scale = 1.0;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4.0;

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function renderData(data, name) {
  try {
    setStatus("Rendering…");
    dropzoneEl.classList.add("hidden");
    // getDocument consumes the buffer, so hand it a fresh copy each load.
    const task = pdfjsLib.getDocument({ data });
    const doc = await task.promise;
    currentDoc = doc;
    filenameEl.textContent = name || "";
    document.title = name ? `${name} — PDF Viewer` : "PDF Viewer";
    zoomInEl.disabled = zoomOutEl.disabled = false;
    await renderAllPages();
    setStatus(`${doc.numPages} page${doc.numPages === 1 ? "" : "s"}`);
  } catch (err) {
    console.error(err);
    setStatus("Failed to open PDF");
    dropzoneEl.classList.remove("hidden");
  }
}

async function renderAllPages() {
  if (!currentDoc) return;
  pagesEl.textContent = "";
  const dpr = window.devicePixelRatio || 1;
  for (let n = 1; n <= currentDoc.numPages; n++) {
    const page = await currentDoc.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    // Render at device resolution for crispness, then scale down via CSS.
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    pagesEl.appendChild(canvas);
    await page.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    }).promise;
  }
}

function setZoom(next) {
  scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
  zoomLevelEl.textContent = `${Math.round(scale * 100)}%`;
  renderAllPages();
}

// --- Input plumbing --------------------------------------------------------

async function loadFile(file) {
  if (!file) return;
  const buf = await file.arrayBuffer();
  await renderData(buf, file.name);
}

async function loadUrl(url) {
  try {
    setStatus("Fetching…");
    // Note: cross-origin PDFs will hit CORS here — that's the job the
    // companion extension takes over (it fetches the bytes with host
    // permissions and hands them in). Same-origin / CORS-open URLs work.
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = await resp.arrayBuffer();
    const name = decodeURIComponent(url.split("/").pop().split("?")[0] || "document.pdf");
    await renderData(buf, name);
  } catch (err) {
    console.error(err);
    setStatus("Could not fetch that PDF (CORS?)");
    dropzoneEl.classList.remove("hidden");
  }
}

// 1. OS file handler — fires when the PWA is launched to open a file.
if ("launchQueue" in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params || !params.files || !params.files.length) return;
    const handle = params.files[0];
    const file = await handle.getFile();
    await loadFile(file);
  });
}

// 2. ?file= query param.
const fileParam = new URLSearchParams(location.search).get("file");
if (fileParam) loadUrl(fileParam);

// 3a. Manual open — browse your computer for a PDF. Prefer the modern native
// file picker (nicer dialog, PDF-filtered); fall back to a hidden <input> on
// browsers without the File System Access API.
async function pickFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }],
        multiple: false,
      });
      await loadFile(await handle.getFile());
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return; // user cancelled the dialog
      // Any other error: fall through to the <input> fallback.
    }
  }
  fileInputEl.click();
}

openBtnEl.addEventListener("click", pickFile);
// The empty-state panel is a big click target for the same action.
dropzoneEl.addEventListener("click", pickFile);
fileInputEl.addEventListener("change", () => {
  if (fileInputEl.files.length) loadFile(fileInputEl.files[0]);
});

// 3b. Drag and drop.
["dragenter", "dragover"].forEach((ev) =>
  viewerEl.addEventListener(ev, (e) => {
    e.preventDefault();
    viewerEl.classList.add("dragging");
  })
);
["dragleave", "drop"].forEach((ev) =>
  viewerEl.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "dragleave" && viewerEl.contains(e.relatedTarget)) return;
    viewerEl.classList.remove("dragging");
  })
);
viewerEl.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

// Zoom controls (buttons + Ctrl/Cmd +/- and Ctrl+scroll).
zoomInEl.addEventListener("click", () => setZoom(scale + 0.2));
zoomOutEl.addEventListener("click", () => setZoom(scale - 0.2));
window.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === "=" || e.key === "+") { e.preventDefault(); setZoom(scale + 0.2); }
  else if (e.key === "-") { e.preventDefault(); setZoom(scale - 0.2); }
  else if (e.key === "0") { e.preventDefault(); setZoom(1.0); }
});
viewerEl.addEventListener("wheel", (e) => {
  if (!(e.ctrlKey || e.metaKey) || !currentDoc) return;
  e.preventDefault();
  setZoom(scale + (e.deltaY < 0 ? 0.1 : -0.1));
}, { passive: false });
