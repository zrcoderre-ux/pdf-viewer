// PDF+ — the bridge between the pages and the main process.
//
// Runs sandboxed, in the top frame of each window, before the page. It gives
// the page (shim.js, really) exactly this much and nothing else: read and
// write a file Windows handed the app, open a link in the browser, the path
// of a File the user picked (to tell whether two handles are one file), the
// files Windows hands over while the app runs, Home's update button and
// app-files setting, and the names of the folders in Downloads that changed
// today (Home's Case folders list). main.js checks every
// path against the files it was given; a page cannot name one of its own.

"use strict";

const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("pdfplusNative", {
  platform: process.platform,
  readFile: (p) => ipcRenderer.invoke("pdfplus:read", String(p)),
  writeFile: (p, bytes) => ipcRenderer.invoke("pdfplus:write", String(p), bytes),
  openExternal: (url) => ipcRenderer.invoke("pdfplus:open-external", String(url)),
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || ""; } catch { return ""; }
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
