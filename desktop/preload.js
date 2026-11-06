// PDF+ — the bridge between the pages and the main process.
//
// Runs sandboxed, in the top frame of each window, before the page. It gives
// the page (shim.js, really) exactly this much and nothing else: read, write
// and rename (in its own folder) a file Windows handed the app, open a link in
// the browser, the path of a File the user picked (to tell whether two handles
// are one file), the files Windows hands over while the app runs, Home's
// update button and app-files setting, and the names of the folders in
// Downloads that changed today (Home's Case folders list). main.js checks
// every path against the files it was given; a page cannot name one of its
// own.

"use strict";

const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("pdfplusNative", {
  platform: process.platform,
  readFile: (p) => ipcRenderer.invoke("pdfplus:read", String(p)),
  writeFile: (p, bytes) => ipcRenderer.invoke("pdfplus:write", String(p), bytes),
  renameFile: (p, name) => ipcRenderer.invoke("pdfplus:rename", String(p), String(name)),
  openExternal: (url) => ipcRenderer.invoke("pdfplus:open-external", String(url)),
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || ""; } catch { return ""; }
  },
  // A Word document of a case folder, opened in the program Windows opens
  // .docx with (Home's Word button). A File read through a folder handle
  // carries no path (getPathForFile gives ""), so the page also says where
  // the file may be: its folders under Downloads, and the folder its
  // PDF-Linker launcher records. main.js opens only a Word document at one
  // of those places whose name, size and time are the File's own.
  openDocument: (file, where) => {
    let p = "";
    try { p = webUtils.getPathForFile(file) || ""; } catch { p = ""; }
    const w = where && typeof where === "object" ? where : {};
    return ipcRenderer.invoke("pdfplus:open-document", {
      path: p,
      name: String(file && file.name || ""),
      size: Number(file && file.size),
      mtime: Number(file && file.lastModified),
      downloads: Array.isArray(w.downloads) ? w.downloads.map(String) : null,
      folders: Array.isArray(w.folders) ? w.folders.map(String) : [],
      folder: typeof w.folder === "string" ? w.folder : "",
    });
  },
  version: () => ipcRenderer.invoke("pdfplus:version"),
  checkForUpdate: () => ipcRenderer.invoke("pdfplus:update-check"),
  downloadUpdate: () => ipcRenderer.invoke("pdfplus:update-download"),
  installUpdate: () => ipcRenderer.invoke("pdfplus:update-install"),
  onUpdateProgress: (cb) => { ipcRenderer.on("pdfplus:update-progress", (_e, pct) => cb(pct)); },
  downloadsToday: (since) => ipcRenderer.invoke("pdfplus:downloads-today", Number(since) || 0),
  source: () => ipcRenderer.invoke("pdfplus:source"),
  chooseSourceFolder: () => ipcRenderer.invoke("pdfplus:source-choose"),
  useBuiltInSource: () => ipcRenderer.invoke("pdfplus:source-builtin"),
  restart: () => ipcRenderer.invoke("pdfplus:restart"),
  onOpenFiles: (cb) => {
    ipcRenderer.on("pdfplus:open-files", (_e, files) => cb(files));
    ipcRenderer.send("pdfplus:open-files-ready");
  },
});
