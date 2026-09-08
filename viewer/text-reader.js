// text-reader.js
//
// The text reader: PDF-Linker's scrubbed .txt exports, read like a document.
//
// What it does, and the one rule under all of it:
//
//   PAGES. The export's "====== Page N ======" headers lay the text out as
//   sheets, in a font the reader chooses, with the pleading gutter numbers
//   dimmed into a margin.
//   CITATIONS. The same detector the PDF viewer runs (citation-linker.js)
//   underlines every authority and links it to Lexis+ or Westlaw; the Table
//   of Authorities panel lists them.
//   THE KEY. pseudonym_key.xlsx puts the real names back ON SCREEN: every fake
//   is rendered as a marked span showing the real value, with the fake on
//   hover. The document is editable, and a save writes each span's FAKE — so
//   the real names exist only inside this page and never reach the file.
//   Type a real name and it is written to disk as its pseudonym. That is the
//   rule: nothing this page saves may carry a real value the key binds, and
//   the save refuses rather than break it.
//   FLAGGING. A name the run left in the clear is selected and flagged; the
//   list is written to New Real Values.txt in the case folder, which
//   PDF-Linker reads on its next pass.
//   THE PDF. The PDF an export came from sits in the case folder under its
//   real name; the reader finds it through the key and shows it either SIDE
//   BY SIDE, page for page, the two scrolling together, or SWAPPED IN for
//   the pages whose text is not worth reading (a badly scanned exhibit) —
//   the PDF page standing in the text's place while the rest stays text.
//
// The decisions are in viewer/textdoc.js and viewer/pseudo-key.js (tested
// from Node); this file is the DOM around them.

import "./web-shim.js";
import { findAllCitations, resolveUrl } from "./citation-linker.js";
import { createToaPanel } from "./toa.js";
import { parseXlsx } from "./xlsx-read.js";
import * as PK from "./pseudo-key.js";
import * as TD from "./textdoc.js";
import * as PS from "./pdfsync.js";
import * as pdfjsLib from "../pdfjs/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdfjs/build/pdf.worker.mjs");

const $ = (id) => document.getElementById(id);
const toolbar = $("toolbar");
const pagesEl = $("pages");
const emptyEl = $("empty");
const stageEl = $("stage");
const saveBtn = $("save");
const keySelect = $("key-select");
const fontSelect = $("font-select");
const fontCustom = $("font-custom");
const sizeLabel = $("size-label");
const lhRange = $("lh-range");
const widthRange = $("width-range");
const marksToggle = $("marks-toggle");
const markColorEl = $("mark-color");
const markAlphaEl = $("mark-alpha");
const fakesToggle = $("fakes-toggle");
const providerEl = $("provider");
const docsList = $("docs-list");
const docsHint = $("docs-hint");
const flagsList = $("flags-list");
const flagCount = $("flag-count");
const flagsNote = $("flags-note");
const flagPop = $("flag-pop");
const flagPopBtn = $("flag-pop-btn");
const flagPopNote = $("flag-pop-note");
const tipEl = $("pn-tip");
const toastEl = $("toast");

// ── state ──────────────────────────────────────────────────────────────────
// The reading defaults — font, size, leading, page width, whether pseudonyms
// are marked — live in chrome.storage.sync so they are REMEMBERED: the font
// and leading chosen once are what every text file opens in from then on,
// the Options page can set them without a document open, and every reader
// tab follows a change at once. (In the hosted app the shim backs sync with
// localStorage, so the same key works there.) An older build kept them in
// localStorage under the key below; that copy is adopted once.
const SETTINGS_KEY = "textReaderSettings";
const LEGACY_SETTINGS_KEY = "textReader.settings";
const KEYS_KEY = "textReader.keys";
const VALUES_PREFIX = "textReader.values.";
const MAX_KEYS = 12;

let doc = null;              // TD.parseExport result
let fileName = "";
let fileHandle = null;       // FileSystemFileHandle for in-place save
let dirHandle = null;        // the case folder, when one was opened
let folderName = "";
let folderDocs = [];         // [{ name, handle, quarantined }]
let folderPdfs = [];         // [{ name, handle }] — the case folder's PDFs
let key = null;              // parsed key (PK.parseKey)
let rev = null, fwd = null, reals = null; // compiled matchers
let settings = loadSettings();
let flagged = [];            // New Real Values list: names to fake next run
let keeps = [];              // …and the keeps: values wrongly faked, left alone next run
let dirty = false;
let editing = false;         // a document opens protected; ✎ Edit lifts it
let provider = "lexis";
let citationRepo = {};
let toaOn = false;
let lastCites = [];

// ── small helpers ───────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, { error = false, ms = 3200 } = {}) {
  toastEl.textContent = msg;
  toastEl.classList.toggle("error", !!error);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, error ? Math.max(ms, 6000) : ms);
}
function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function lsGet(k, dflt) {
  try { const v = localStorage.getItem(k); return v == null ? dflt : JSON.parse(v); } catch { return dflt; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or off */ }
}

// ── settings ─────────────────────────────────────────────────────────────────
// The legacy local copy is the starting point until the synced defaults
// arrive (below); "Show fakes" is a view, not a default, and opens off.
function loadSettings() {
  const s = TD.normalizeSettings(lsGet(LEGACY_SETTINGS_KEY, null));
  s.showFakes = false;
  return s;
}
// What is REMEMBERED: everything but the show-fakes view.
function persistable(s) {
  const out = Object.assign({}, s);
  delete out.showFakes;
  return out;
}
function saveSettings() {
  chrome.storage.sync.set({ [SETTINGS_KEY]: persistable(settings) });
}
function loadSyncedSettings() {
  chrome.storage.sync.get({ [SETTINGS_KEY]: null }, (got) => {
    const stored = got && got[SETTINGS_KEY];
    if (stored) {
      settings = Object.assign(TD.normalizeSettings(stored), { showFakes: settings.showFakes });
    } else if (localStorage.getItem(LEGACY_SETTINGS_KEY)) {
      saveSettings(); // migrate the older build's local copy, once
    }
    applySettings();
    relayout();
  });
}
// Defaults changed elsewhere — the Options page, another reader tab — apply
// here too, so what the reader shows is always the current default.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes[SETTINGS_KEY]) return;
  const merged = Object.assign(TD.normalizeSettings(changes[SETTINGS_KEY].newValue || null), { showFakes: settings.showFakes });
  if (JSON.stringify(persistable(merged)) === JSON.stringify(persistable(settings))) return;
  settings = merged;
  applySettings();
  relayout();
});

function applySettings() {
  const root = document.documentElement.style;
  root.setProperty("--reader-font", TD.fontCss(settings));
  root.setProperty("--reader-size", settings.fontSize + "px");
  root.setProperty("--reader-lh", String(settings.lineHeight));
  root.setProperty("--reader-width", settings.pageWidth + "px");
  const mark = TD.markCss(settings);
  root.setProperty("--pn-bg", mark.bg);
  root.setProperty("--pn-bg-hover", mark.hover);
  root.setProperty("--pn-ring", mark.ring);
  markColorEl.value = settings.markColor;
  markAlphaEl.value = String(settings.markAlpha);
  markColorEl.disabled = markAlphaEl.disabled = !settings.marks;
  document.body.classList.toggle("marks-off", !settings.marks);
  document.body.classList.toggle("show-fakes", settings.showFakes);
  document.body.classList.toggle("gutter-off", !settings.gutter);
  fontSelect.value = settings.font;
  fontCustom.hidden = settings.font !== "custom";
  fontCustom.value = settings.customFont;
  sizeLabel.textContent = String(settings.fontSize);
  lhRange.value = String(settings.lineHeight);
  widthRange.value = String(settings.pageWidth);
  marksToggle.checked = settings.marks;
  fakesToggle.checked = settings.showFakes;
}

for (const p of TD.FONT_PRESETS) {
  const o = document.createElement("option");
  o.value = p.id;
  o.textContent = p.label;
  fontSelect.appendChild(o);
}
fontSelect.addEventListener("change", () => {
  settings.font = fontSelect.value;
  saveSettings(); applySettings(); relayout();
  if (settings.font === "custom") fontCustom.focus();
});
fontCustom.addEventListener("input", () => {
  settings.customFont = fontCustom.value;
  saveSettings(); applySettings(); relayout();
});
$("size-down").addEventListener("click", () => { settings.fontSize = Math.max(9, settings.fontSize - 1); saveSettings(); applySettings(); relayout(); });
$("size-up").addEventListener("click", () => { settings.fontSize = Math.min(40, settings.fontSize + 1); saveSettings(); applySettings(); relayout(); });
lhRange.addEventListener("input", () => { settings.lineHeight = Number(lhRange.value); saveSettings(); applySettings(); relayout(); });
widthRange.addEventListener("input", () => { settings.pageWidth = Number(widthRange.value); saveSettings(); applySettings(); relayout(); });
marksToggle.addEventListener("change", () => { settings.marks = marksToggle.checked; saveSettings(); applySettings(); hideTip(); });
markColorEl.addEventListener("input", () => { settings.markColor = markColorEl.value; saveSettings(); applySettings(); });
markAlphaEl.addEventListener("input", () => { settings.markAlpha = Number(markAlphaEl.value); saveSettings(); applySettings(); });
fakesToggle.addEventListener("change", () => { settings.showFakes = fakesToggle.checked; saveSettings(); applySettings(); showFakes(settings.showFakes); });

// ── theme (shared with the PDF viewer) ───────────────────────────────────────
const themeToggle = $("theme-toggle");
function applyTheme(theme) {
  const light = theme === "light";
  document.documentElement.setAttribute("data-theme", light ? "light" : "dark");
  themeToggle.textContent = light ? "🌙" : "☀";
  themeToggle.title = light ? "Switch to dark" : "Switch to light";
}
let currentTheme = "dark";
try { if (localStorage.getItem("pdfViewerTheme") === "light") currentTheme = "light"; } catch { /* ok */ }
applyTheme(currentTheme);
themeToggle.addEventListener("click", () => {
  currentTheme = currentTheme === "light" ? "dark" : "light";
  try { localStorage.setItem("pdfViewerTheme", currentTheme); } catch { /* ok */ }
  applyTheme(currentTheme);
});

// ── provider / repo / TOA (the viewer's own settings) ─────────────────────────
const toaPanel = createToaPanel({
  providerLabel: (p) => (p === "westlaw" ? "Westlaw" : "Lexis+"),
  top: "calc(var(--toolbar-height, 44px) + 8px)",
});
toaPanel.setEnabled(false);
chrome.storage.sync.get({ provider: "lexis", toaEnabledText: false }, (s) => {
  provider = s.provider === "westlaw" ? "westlaw" : "lexis";
  providerEl.value = provider;
  toaOn = !!s.toaEnabledText;
  $("toa-toggle").setAttribute("aria-pressed", String(toaOn));
  toaPanel.setEnabled(toaOn);
  if (doc) placeCitations();
});
chrome.storage.local.get({ citationRepo: {} }, ({ citationRepo: r }) => { citationRepo = r || {}; if (doc) placeCitations(); });
providerEl.addEventListener("change", () => {
  provider = providerEl.value;
  chrome.storage.sync.set({ provider });
  placeCitations();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.provider) { provider = changes.provider.newValue; providerEl.value = provider; placeCitations(); }
  if (area === "local" && changes.citationRepo) { citationRepo = changes.citationRepo.newValue || {}; placeCitations(); }
});
$("toa-toggle").addEventListener("click", () => {
  toaOn = !toaOn;
  $("toa-toggle").setAttribute("aria-pressed", String(toaOn));
  toaPanel.setEnabled(toaOn);
  chrome.storage.sync.set({ toaEnabledText: toaOn });
  if (toaOn) renderToa();
});
// The side panel collapses to nothing — a chevron on the panel, the toolbar
// button, or Esc-free: the choice is remembered, and until one is made the
// panel stays closed and opens itself the first time it has something to
// show (a folder's documents, a flag).
let sideChoice = lsGet("textReader.side", null); // true/false once chosen, else null
function showSidePanel(on, { remember = false } = {}) {
  document.body.classList.toggle("side-hidden", !on);
  $("panel-toggle").setAttribute("aria-pressed", String(!!on));
  if (remember) { sideChoice = !!on; lsSet("textReader.side", sideChoice); }
  relayout();
}
function autoShowSidePanel() { if (sideChoice !== false) showSidePanel(true); }
$("panel-toggle").addEventListener("click", () => showSidePanel(document.body.classList.contains("side-hidden"), { remember: true }));
$("side-collapse").addEventListener("click", () => showSidePanel(false, { remember: true }));
// The Options page holds the same reading defaults; the button is shown only
// where there is an Options page to open (the extension, not the hosted app).
{
  const btn = $("defaults-btn");
  const canOpen = typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.openOptionsPage === "function" && !chrome.__pwaShim;
  btn.hidden = !canOpen;
  btn.addEventListener("click", () => { try { chrome.runtime.openOptionsPage(); } catch { /* not an extension page */ } });
}
const SIDE_TABS = [["tab-docs", "side-docs"], ["tab-flags", "side-flags"]];
function showSideTab(tab) {
  for (const [t, b] of SIDE_TABS) {
    const on = t === tab;
    $(t).classList.toggle("active", on);
    $(t).setAttribute("aria-pressed", String(on));
    $(b).hidden = !on;
  }
}
for (const [tab] of SIDE_TABS) $(tab).addEventListener("click", () => showSideTab(tab));

// ── the key library ────────────────────────────────────────────────────────────
function keyLibrary() { return lsGet(KEYS_KEY, {}); }

function storeKey(parsed, folder) {
  const lib = keyLibrary();
  let id = null;
  for (const k of Object.keys(lib)) if (PK.sameCaseKey(lib[k], parsed)) { id = k; break; }
  if (!id) id = PK.fold(parsed.name) + "#" + PK.keySignature(parsed);
  const prev = lib[id] || {};
  lib[id] = Object.assign({}, parsed, { folder: folder || prev.folder || "", savedAt: Date.now() });
  // The oldest fall off; a key is one folder-pick away from being recent again.
  const ids = Object.keys(lib).sort((a, b) => (lib[b].savedAt || 0) - (lib[a].savedAt || 0));
  for (const old of ids.slice(MAX_KEYS)) delete lib[old];
  lsSet(KEYS_KEY, lib);
  return id;
}

function fillKeySelect(selectedId) {
  const lib = keyLibrary();
  keySelect.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "(no key)";
  keySelect.appendChild(none);
  const ids = Object.keys(lib).sort((a, b) => (lib[b].savedAt || 0) - (lib[a].savedAt || 0));
  for (const id of ids) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = PK.keyTitle(lib[id]) + " · " + lib[id].rows + " rows";
    keySelect.appendChild(o);
  }
  keySelect.value = selectedId || "";
  if (keySelect.value !== (selectedId || "")) keySelect.value = "";
}

// The key with the kept values taken out of its FORWARD side: a value the
// operator has said was wrongly faked may stand in the text as itself, so a
// save neither rewrites it to the fake nor refuses over it. The reverse side
// is untouched — the fake still in the file still shows as the real value.
function keyLessKeeps(k) {
  if (!k || !keeps.length) return k;
  return Object.assign({}, k, { warn: (k.warn || []).filter((w) => !TD.keptControl(keeps, w.real)) });
}
// An occurrence of a kept value is blanked (same length, a non-word
// character) before the forward side looks at the text, so a kept
// "Helen Rasho" is not rewritten through its own "Helen" and "Rasho" rows.
function keptMatcher() { return keeps.length ? PK.buildMatcher(keeps.map((k) => k.value)) : null; }
function maskKept(text) {
  const rx = keptMatcher();
  return rx ? text.replace(rx, (m) => "\u0000".repeat(m.length)) : text;
}
/** real → fake over `text`, kept occurrences left exactly as they stand. */
function forwardText(text) {
  const runs = PK.forwardRuns(fwd, maskKept(text));
  let off = 0, swaps = 0;
  const out = runs.map((r) => {
    const len = r.t === "swap" ? r.from.length : r.s.length;
    const piece = r.t === "swap" ? (swaps++, r.to) : text.slice(off, off + len);
    off += len;
    return piece;
  }).join("");
  return { text: out, swaps };
}
function compileKey() {
  const k = keyLessKeeps(key);
  rev = key ? PK.compile(key) : null;
  fwd = k ? PK.compileForward(k) : null;
  reals = k ? PK.compileReals(k) : null;
}
function setKey(parsed) {
  key = parsed || null;
  compileKey();
  $("st-key").textContent = key ? "Key: " + PK.keyTitle(key) + (key.dropped.ambiguous ? ` (${key.dropped.ambiguous} ambiguous fake${key.dropped.ambiguous === 1 ? "" : "s"} retired)` : "") : "";
  if (doc) { retranslate(); refreshPdf(); }
}

keySelect.addEventListener("change", () => {
  const lib = keyLibrary();
  setKey(keySelect.value ? lib[keySelect.value] : null);
});

async function loadKeyFromBytes(bytes, name, folder, { quiet = false } = {}) {
  const wb = await parseXlsx(bytes);
  if (!PK.sheetsLookLikeKey(wb.sheets)) throw new Error(`${name} has no "Real Value" / "Replacement" header — not a pseudonym key.`);
  const parsed = PK.parseKey(wb.sheets, name);
  const id = storeKey(parsed, folder);
  fillKeySelect(id);
  setKey(keyLibrary()[id]);
  if (!quiet) toast(`Key loaded: ${PK.keyTitle(key)} — ${key.pairs.length} reversible binding${key.pairs.length === 1 ? "" : "s"}` +
    (key.dropped.ambiguous ? `, ${key.dropped.ambiguous} ambiguous retired` : ""));
}

async function pickKey() {
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: "Pseudonym key", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }] });
      const f = await h.getFile();
      await loadKeyFromBytes(new Uint8Array(await f.arrayBuffer()), f.name, "");
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
      if (!(e && /picker|not allowed|SecurityError/i.test(String(e)))) { toast(String(e.message || e), { error: true }); return; }
    }
  }
  $("key-input").click();
}
$("load-key").addEventListener("click", pickKey);
$("key-input").addEventListener("change", async () => {
  const f = $("key-input").files[0];
  $("key-input").value = "";
  if (!f) return;
  try { await loadKeyFromBytes(new Uint8Array(await f.arrayBuffer()), f.name, ""); }
  catch (e) { toast(String(e.message || e), { error: true }); }
});

// ── the case folders the reader has been shown ─────────────────────────────────
//
// A file handle knows nothing about the folder it sits in, so a document
// opened on its own could not find its key. The reader therefore REMEMBERS
// every case folder it is shown (Open case folder, or the offer below) as a
// directory handle in IndexedDB — handles persist there — and when a lone
// file is opened it asks each remembered folder whether the file is inside
// it. Where one is, the case folder is the file's own folder, or the folder
// ABOVE "Text Files" where the file sits in that, and its pseudonym_key.xlsx
// is attached without being asked. Reading a remembered folder may need the
// browser's permission again; that is asked on a click, never silently.
const DB_NAME = "textReader";
const DIRS_STORE = "dirs";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("no IndexedDB"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(DIRS_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function rememberDir(handle) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DIRS_STORE, "readwrite");
      tx.objectStore(DIRS_STORE).put(handle, handle.name);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* the folder simply is not remembered */ }
}
async function rememberedDirs() {
  try {
    const db = await openDb();
    const out = await new Promise((resolve, reject) => {
      const req = db.transaction(DIRS_STORE, "readonly").objectStore(DIRS_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return out.filter((h) => h && h.kind === "directory");
  } catch { return []; }
}
async function permissionOf(handle, mode) {
  try { return handle.queryPermission ? await handle.queryPermission({ mode }) : "granted"; } catch { return "granted"; }
}

/**
 * The case folder a file handle sits in, from the remembered folders:
 * { dir, needs } — `needs` true where the folder must be re-authorised on a
 * click before it can be read — or null where no remembered folder holds it.
 */
async function caseFolderFor(fileHandle) {
  if (!fileHandle || typeof fileHandle.isSameEntry !== "function") return null;
  for (const dir of await rememberedDirs()) {
    let path = null;
    try { path = await dir.resolve(fileHandle); } catch { path = null; }
    if (!path) continue;
    // The file's own folder, or the folder above a "Text Files" it sits in.
    let up = path.length - 1;
    if (up >= 1 && path[up - 1].toLowerCase() === TD.TEXT_SUBFOLDER.toLowerCase()) up -= 1;
    let caseDir = dir;
    try {
      for (const seg of path.slice(0, up)) caseDir = await caseDir.getDirectoryHandle(seg);
    } catch { continue; }
    const perm = await permissionOf(caseDir, "readwrite");
    return { dir: caseDir, needs: perm !== "granted" };
  }
  return null;
}

/** Read a case folder: its key, its exports and its flagged values. */
async function scanFolder(h) {
  const found = { keyHandle: null, valuesHandle: null, textDir: null, docs: [], rootDocs: [], pdfs: [] };
  for await (const [name, entry] of h.entries()) {
    if (entry.kind === "file") {
      if (/\.pdf$/i.test(name) && !/_temp\.pdf$/i.test(name)) found.pdfs.push({ name, handle: entry });
      else if (TD.isKeyName(name) && !found.keyHandle) found.keyHandle = entry;
      else if (name.toLowerCase() === TD.VALUES_FILE.toLowerCase()) found.valuesHandle = entry;
      else if (TD.isExportName(name)) found.rootDocs.push({ name, handle: entry, quarantined: TD.isQuarantinedName(name) });
    } else if (entry.kind === "directory" && name.toLowerCase() === TD.TEXT_SUBFOLDER.toLowerCase()) {
      found.textDir = entry;
    }
  }
  if (found.textDir) {
    for await (const [name, entry] of found.textDir.entries()) {
      if (entry.kind === "file" && TD.isExportName(name)) found.docs.push({ name, handle: entry, quarantined: TD.isQuarantinedName(name) });
    }
  }
  // Under the older single-folder layout the exports sit in the case folder
  // itself; with a Text Files folder present, a root .txt is somebody's note.
  if (!found.docs.length) found.docs = found.rootDocs;
  found.docs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  found.pdfs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  return found;
}

/** Make `h` the current case folder: key attached, documents listed, flags loaded. */
async function adoptFolder(h, { quiet = false } = {}) {
  if (dirHandle !== h) forgetPdfs();
  dirHandle = h;
  folderName = h.name;
  await rememberDir(h);
  const found = await scanFolder(h);
  folderDocs = found.docs;
  folderPdfs = found.pdfs;
  if (found.keyHandle) {
    try {
      const f = await found.keyHandle.getFile();
      await loadKeyFromBytes(new Uint8Array(await f.arrayBuffer()), f.name, folderName, { quiet });
    } catch (e) { toast("The folder's key could not be read: " + (e.message || e), { error: true }); }
  } else if (!quiet) {
    toast("No pseudonym_key.xlsx in " + folderName + " — the documents will read in their fakes.");
  }
  const stored = readStoredValues(VALUES_PREFIX + folderName);
  flagged = stored.values;
  keeps = stored.keeps;
  if (found.valuesHandle) {
    try {
      const onDisk = TD.parseReaderFile(await (await found.valuesHandle.getFile()).text());
      for (const v of onDisk.values) flagged = TD.addValue(flagged, v);
      for (const k of onDisk.keeps) if (!TD.keptControl(keeps, k.value)) keeps = TD.addKeep(keeps, k.control, k.value);
    } catch { /* unreadable: the in-memory list stands */ }
  }
  persistValues();
  compileKey();
  renderFlags();
  renderDocList();
  if (folderDocs.length) { autoShowSidePanel(); showSideTab("tab-docs"); }
  if (doc) refreshPdf();
  return found;
}

// The offer bar: a lone file whose case folder is known but needs a click to
// read, or is not known at all.
const keyOffer = $("key-offer");
function showKeyOffer(text, action, onAct) {
  $("key-offer-text").textContent = text;
  const btn = $("key-offer-btn");
  btn.textContent = action;
  btn.onclick = async () => { hideKeyOffer(); await onAct(); };
  keyOffer.hidden = false;
}
function hideKeyOffer() { keyOffer.hidden = true; }
$("key-offer-close").addEventListener("click", hideKeyOffer);

/**
 * A document opened on its own: attach the key of the case folder it sits
 * in, if the reader has been shown that folder; else say how to.
 */
async function attachKeyForFile(handle) {
  if (dirHandle) {
    // Already inside a case folder: a file from that folder needs nothing.
    try { if (handle && (await dirHandle.resolve(handle))) return; } catch { /* not ours */ }
  }
  const at = await caseFolderFor(handle);
  if (!at) {
    if (!key) showKeyOffer("No key attached. Open this file's case folder once and its pseudonym_key.xlsx is attached automatically from then on.", "Open case folder…", openFolder);
    return;
  }
  const attach = async () => {
    if (at.needs) {
      try {
        const perm = await at.dir.requestPermission({ mode: "readwrite" });
        if (perm !== "granted") { toast("Access to " + at.dir.name + " was not granted; the key stays unattached.", { error: true }); return; }
      } catch (e) { toast("Could not reopen " + at.dir.name + ": " + (e.message || e), { error: true }); return; }
    }
    await adoptFolder(at.dir, { quiet: true });
    if (doc) retranslate();
    markDocList();
    toast(key ? "Attached the key from " + at.dir.name : "No pseudonym_key.xlsx in " + at.dir.name);
  };
  if (at.needs) showKeyOffer("This file is in " + at.dir.name + ". Attach its pseudonym key?", "Attach key", attach);
  else await attach();
}

// ── opening documents ───────────────────────────────────────────────────────────
async function openFile(file, handle) {
  if (!file) return;
  if (dirty && !confirm("Discard unsaved edits to " + fileName + "?")) return;
  hideKeyOffer();
  const text = await file.text();
  // The case folder first, so the document renders under its own key.
  try { await attachKeyForFile(handle || null); } catch (e) { console.warn(e); }
  openText(text, file.name, handle || null);
}

function openText(text, name, handle) {
  doc = TD.parseExport(text);
  fileName = name;
  fileHandle = handle;
  dirty = false;
  editing = false;
  clearHistory();
  document.body.classList.remove("editing");
  $("edit-toggle").setAttribute("aria-pressed", "false");
  document.title = name + " — Text Reader";
  if (!dirHandle) loadValuesFor(name);
  render();
  setupPdfForDoc();
  markDocList();
  $("st-file").textContent = name + (TD.isQuarantinedName(name) ? " (quarantined by PDF-Linker's leak gate)" : "") + " · " + doc.pages.length + " page" + (doc.pages.length === 1 ? "" : "s");
  updateDirty();
}

async function pickFile() {
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: "Text export", accept: { "text/plain": [".txt", ".LEAK"] } }] });
      await openFile(await h.getFile(), h);
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
      if (!(e && /picker|not allowed|SecurityError|TypeError/i.test(String(e)))) { toast(String(e.message || e), { error: true }); return; }
    }
  }
  $("file-input").click();
}
$("open-file").addEventListener("click", pickFile);
$("file-input").addEventListener("change", async () => {
  const f = $("file-input").files[0];
  $("file-input").value = "";
  if (f) await openFile(f, null);
});

async function openFolder() {
  if (!window.showDirectoryPicker) { toast("This browser cannot open a folder; open a file instead.", { error: true }); return; }
  let h;
  try { h = await window.showDirectoryPicker({ mode: "readwrite" }); }
  catch (e) { if (e && e.name !== "AbortError") toast(String(e.message || e), { error: true }); return; }
  if (dirty && !confirm("Discard unsaved edits to " + fileName + "?")) return;
  hideKeyOffer();
  const found = await adoptFolder(h);
  if (folderDocs.length) {
    // A file already open from this folder just takes the key; otherwise the
    // quarantined export, the one to read, else the first.
    if (fileHandle && folderDocs.some((d) => d.handle === fileHandle)) { if (doc) retranslate(); markDocList(); return; }
    let mine = null;
    if (fileHandle) { try { mine = (await h.resolve(fileHandle)) ? fileHandle : null; } catch { mine = null; } }
    if (mine && doc) { retranslate(); markDocList(); return; }
    await openFolderDoc(folderDocs.find((d) => d.quarantined) || folderDocs[0]);
  } else {
    doc = null; pagesEl.hidden = true; emptyEl.hidden = false;
    toast("No text exports in " + folderName + (found.textDir ? "" : " (no Text Files folder)"), { error: true });
  }
}
$("open-folder").addEventListener("click", openFolder);

async function openFolderDoc(d) {
  try {
    const f = await d.handle.getFile();
    await openFile(f, d.handle);
  } catch (e) { toast("Could not open " + d.name + ": " + (e.message || e), { error: true }); }
}

function renderDocList() {
  docsList.innerHTML = "";
  docsHint.textContent = folderDocs.length ? folderName + " · " + folderDocs.length + " document" + (folderDocs.length === 1 ? "" : "s") : "Open a case folder to list its exports here.";
  for (const d of folderDocs) {
    const li = document.createElement("li");
    li.textContent = d.name.replace(/\.txt(\.LEAK)?$/i, "");
    if (d.quarantined) {
      const t = document.createElement("span");
      t.className = "tag";
      t.textContent = "LEAK";
      t.title = "Quarantined by PDF-Linker's leak gate — read it to find what leaked";
      li.appendChild(t);
    }
    li.title = d.name;
    li.addEventListener("click", () => openFolderDoc(d));
    li.dataset.name = d.name;
    docsList.appendChild(li);
  }
  markDocList();
}
function markDocList() {
  for (const li of docsList.children) li.classList.toggle("current", li.dataset.name === fileName);
}

// Drag and drop.
["dragenter", "dragover"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add("dragging"); }));
["dragleave", "drop"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "dragleave" && e.relatedTarget) return; document.body.classList.remove("dragging"); }));
document.addEventListener("drop", (e) => {
  const dt = e.dataTransfer;
  if (!dt || !dt.files || !dt.files.length) return;
  // Everything on the DataTransfer is gone once this handler yields, so the
  // files and the handle promises are taken synchronously and awaited after.
  const files = [...dt.files];
  const handles = [...(dt.items || [])].map((i) => {
    try { return i.kind === "file" && i.getAsFileSystemHandle ? i.getAsFileSystemHandle() : null; } catch { return null; }
  });
  (async () => {
    for (const f of files) {
      if (TD.isKeyName(f.name)) {
        try { await loadKeyFromBytes(new Uint8Array(await f.arrayBuffer()), f.name, ""); }
        catch (err) { toast(String(err.message || err), { error: true }); }
      }
    }
    // A dropped PDF is the one to show beside (or inside) the open document.
    const pdf = files.find((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (pdf && doc) await usePickedPdf(pdf);
    const at = files.findIndex((f) => /\.(txt|leak)$/i.test(f.name) || f.type === "text/plain");
    if (at === -1) return;
    let handle = null;
    try { handle = await handles[at]; } catch { handle = null; }
    if (handle && handle.kind !== "file") handle = null;
    await openFile(files[at], handle);
  })();
});

// ── rendering ─────────────────────────────────────────────────────────────────────
function render() {
  pagesEl.innerHTML = "";
  emptyEl.hidden = true;
  pagesEl.hidden = false;
  doc.pages.forEach((p, i) => {
    const sec = document.createElement("section");
    sec.className = "tpage";
    sec.dataset.index = String(i);
    if (p.banner != null || p.header != null) {
      const lab = document.createElement("div");
      lab.className = "page-label" + (p.banner != null ? " doc" : "");
      lab.textContent = TD.pageLabel(p);
      if (p.review) {
        const r = document.createElement("span");
        r.className = "review";
        r.textContent = "— " + p.review;
        lab.appendChild(r);
      }
      lab.contentEditable = "false";
      if (PS.pdfPageOf(p)) {
        // Swap this page for its PDF page, or back (the PDF section below).
        const b = document.createElement("button");
        b.className = "swap-page";
        b.type = "button";
        b.addEventListener("click", (e) => { e.preventDefault(); toggleSwap(i); });
        lab.appendChild(b);
      }
      sec.appendChild(lab);
    }
    const inner = document.createElement("div");
    inner.className = "page-inner";
    const body = document.createElement("div");
    body.className = "page-body";
    body.contentEditable = editing ? "plaintext-only" : "false";
    body.spellcheck = false;
    buildBody(body, p.lines.join("\n"));
    const layer = document.createElement("div");
    layer.className = "link-layer";
    inner.append(body, layer);
    sec.appendChild(inner);
    pagesEl.appendChild(sec);
  });
  stageEl.scrollTop = 0;
  afterTextChange();
}

/** Fill a page body from its on-disk text: gutter spans, pseudonym spans. */
function buildBody(body, text) {
  body.innerHTML = "";
  const runs = rev ? PK.translateRuns(rev, text) : [{ t: "text", s: text }];
  let lineStart = true;
  runs.forEach((r, ri) => {
    if (r.t === "swap") {
      body.appendChild(makePn(r.from, r.to));
      lineStart = false;
      return;
    }
    const pieces = r.s.split("\n");
    pieces.forEach((piece, i) => {
      if (i > 0) { body.appendChild(document.createTextNode("\n")); lineStart = true; }
      if (!piece) return;
      // A gutter number is followed by text; where that text is the pseudonym
      // span the NEXT run supplies, the number still opens the line.
      const last = i === pieces.length - 1 && ri + 1 < runs.length;
      const g = lineStart ? TD.gutterPrefix(last ? piece + "\u0001" : piece) : null;
      if (g && g.gutter.length <= piece.length) {
        const span = document.createElement("span");
        span.className = "gutter";
        span.textContent = g.gutter;
        body.appendChild(span);
        const rest = piece.slice(g.gutter.length);
        if (rest) body.appendChild(document.createTextNode(rest));
      } else body.appendChild(document.createTextNode(piece));
      lineStart = false;
    });
    lineStart = r.s.endsWith("\n") || (lineStart && r.s === "");
  });
}

function makePn(fake, real) {
  const span = document.createElement("span");
  span.className = "pn";
  span.contentEditable = "false";
  span.dataset.fake = fake;
  span.dataset.real = real;
  span.textContent = settings.showFakes ? fake : real;
  markKept(span);
  return span;
}
// A kept value's spans carry the mark that says so: the highlight goes, a
// dotted underline says "left alone on the next run", and the tooltip says
// what the file still carries until then.
function markKept(span) {
  const c = TD.keptControl(keeps, span.dataset.real);
  span.classList.toggle("kept", !!c);
  if (c) span.dataset.kept = c; else delete span.dataset.kept;
}
function remarkKept() {
  for (const s of pagesEl.querySelectorAll(".pn")) markKept(s);
  updateCounts();
}

function pageBodies() { return [...pagesEl.querySelectorAll(".page-body")]; }

/** Re-translate every page under the current key, keeping the edits. */
function retranslate() {
  for (const body of pageBodies()) buildBody(body, TD.serializeNodes(body));
  afterTextChange();
}

function showFakes(on) {
  for (const s of pagesEl.querySelectorAll(".pn")) s.textContent = on ? s.dataset.fake : s.dataset.real;
  afterTextChange();
}

// Everything that reads the page text: the counts, the citation underlines, the
// flagged and leaked highlights. Cheap enough to run on every settled edit.
function afterTextChange() {
  updateCounts();
  placeCitations();
  paintHighlights();
}
const afterTextChangeSoon = debounce(afterTextChange, 400);
const relayout = debounce(() => { placeCitations(); refitPdf(); }, 150);
window.addEventListener("resize", relayout);

function updateCounts() {
  const n = pagesEl.querySelectorAll(".pn").length;
  const k = pagesEl.querySelectorAll(".pn.kept").length;
  $("st-pn").textContent = key ? `${n} pseudonym${n === 1 ? "" : "s"} shown as real names` + (k ? ` · ${k} kept (un-faked on the next run)` : "") : "";
}

// ── editing ──────────────────────────────────────────────────────────────────────
pagesEl.addEventListener("input", (e) => {
  const body = e.target && e.target.closest && e.target.closest(".page-body");
  if (!body) return;
  setDirty(true);
  convertTypedRealsSoon(body);
  afterTextChangeSoon();
});

function setDirty(on) { if (dirty !== on) { dirty = on; updateDirty(); } }
function updateDirty() {
  saveBtn.disabled = !doc || !(editing || dirty);
  $("edit-toggle").disabled = !doc;
  $("st-dirty").textContent = dirty ? "● Unsaved edits" : (doc && !editing ? "Protected — ✎ Edit to change" : "");
}

// ── edit protection ────────────────────────────────────────────────────────────────
//
// A document opens PROTECTED: the pages take no keystroke until ✎ Edit is
// on, so reading, selecting and flagging can never nudge a character into
// the file. Edits already made stay (and stay saveable) when protection is
// put back.
function setEditing(on) {
  editing = !!on && !!doc;
  document.body.classList.toggle("editing", editing);
  $("edit-toggle").setAttribute("aria-pressed", String(editing));
  for (const body of pageBodies()) body.contentEditable = editing ? "plaintext-only" : "false";
  updateDirty();
}
$("edit-toggle").addEventListener("click", () => setEditing(!editing));

// ── undo / redo ───────────────────────────────────────────────────────────────────────
//
// The reader's own history, because the browser's cannot be trusted here:
// a typed real name is rewritten into a pseudonym span by script, and a
// programmatic change breaks or empties the native undo stack. A snapshot is
// the page's on-disk text plus the caret, taken before an edit begins (and
// coalesced while typing runs on), and before every rewrite the reader makes
// itself; Ctrl+Z puts the page back to it, Ctrl+Y / Ctrl+Shift+Z forward.
const UNDO_COALESCE_MS = 800;
const UNDO_MAX = 200;
let undoStack = [], redoStack = [], lastSnapAt = 0, lastSnapPage = -1;

function pageIndexOf(body) { return Number(body.closest(".tpage").dataset.index); }
function caretOffsetIn(body) {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return -1;
  const r = sel.getRangeAt(0);
  if (!body.contains(r.startContainer)) return -1;
  const { segs } = flatten(body);
  const seg = segs.find((x) => x.node === r.startContainer);
  if (seg) return seg.start + r.startOffset;
  // The caret sits on an element boundary: count the text before it.
  const probe = document.createRange();
  probe.selectNodeContents(body);
  probe.setEnd(r.startContainer, r.startOffset);
  return probe.toString().length;
}
function snapshotOf(body) {
  return { page: pageIndexOf(body), text: TD.serializeNodes(body), caret: caretOffsetIn(body) };
}
/** Record the page as it stands, before an edit; `force` skips coalescing. */
function snapshot(body, force) {
  const now = Date.now();
  const i = pageIndexOf(body);
  if (!force && i === lastSnapPage && now - lastSnapAt < UNDO_COALESCE_MS) { lastSnapAt = now; return; }
  undoStack.push(snapshotOf(body));
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  redoStack = [];
  lastSnapAt = now; lastSnapPage = i;
}
function restoreSnapshot(snap) {
  const body = pageBodies()[snap.page];
  if (!body) return;
  buildBody(body, snap.text);
  doc.pages[snap.page].lines = snap.text.split("\n");
  if (snap.caret >= 0) {
    const { segs } = flatten(body);
    const r = rangeFor(segs, snap.caret, snap.caret);
    if (r) { const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(r); }
  }
  body.focus({ preventScroll: true });
  setDirty(true);
  afterTextChange();
}
function undo() {
  const snap = undoStack.pop();
  if (!snap) return;
  const body = pageBodies()[snap.page];
  if (body) redoStack.push(snapshotOf(body));
  restoreSnapshot(snap);
  lastSnapPage = -1;
}
function redo() {
  const snap = redoStack.pop();
  if (!snap) return;
  const body = pageBodies()[snap.page];
  if (body) undoStack.push(snapshotOf(body));
  restoreSnapshot(snap);
  lastSnapPage = -1;
}
function clearHistory() { undoStack = []; redoStack = []; lastSnapPage = -1; }
pagesEl.addEventListener("beforeinput", (e) => {
  const body = e.target && e.target.closest && e.target.closest(".page-body");
  if (!body) return;
  if (e.inputType === "historyUndo" || e.inputType === "historyRedo") { e.preventDefault(); return; }
  // A deletion after typing, or typing after a deletion, is its own step.
  const kind = /delete/i.test(e.inputType) ? "del" : "ins";
  snapshot(body, kind !== snapshot.lastKind);
  snapshot.lastKind = kind;
});
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
}, true);
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

/**
 * A real value typed into the plain text becomes a pseudonym span as soon as
 * the caret has left it — the real name stays on screen, the fake goes
 * underneath, exactly as if the document had carried it. A match the caret is
 * still inside is left alone (it may be the front of a longer name).
 */
const convertTypedRealsSoon = debounce(convertTypedReals, 250);
function convertTypedReals(body) {
  if (!fwd || !fwd.rx || !body.isConnected) return;
  body.normalize();
  const sel = document.getSelection();
  const caretNode = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
  const caretOff = sel && sel.rangeCount ? sel.getRangeAt(0).startOffset : -1;
  const segs = plainSegments(body).map((seg) => ({ node: seg.node, text: maskKept(seg.text) }));
  const hits = TD.findRealsInPlain(fwd, segs);
  // Last hit first, so the offsets of the earlier ones in the same node
  // stay valid as the node is split.
  hits.reverse();
  let made = 0;
  for (const h of hits) {
    if (h.node === caretNode && caretOff >= h.start && caretOff <= h.end) continue;
    const node = h.node;
    if (!node.isConnected) continue;
    if (!made) snapshot(body, true);
    node.splitText(h.end);
    const mid = node.splitText(h.start);
    mid.replaceWith(makePn(h.fake, h.matched));
    made++;
  }
  if (made) {
    toast(`${made} real name${made === 1 ? "" : "s"} marked — the file will carry the pseudonym${made === 1 ? "" : "s"}`);
    afterTextChange();
  }
}

/** Text nodes of a page body that are NOT inside a pseudonym span. */
function plainSegments(body) {
  const out = [];
  const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && n.parentElement.closest(".pn") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let n;
  while ((n = w.nextNode())) out.push({ node: n, text: n.data });
  return out;
}

// ── saving ─────────────────────────────────────────────────────────────────────────
async function saveDocument() {
  if (!doc) return;
  let forwarded = 0;
  const bodies = pageBodies();
  bodies.forEach((body, i) => {
    let text = TD.serializeNodes(body);
    if (fwd && fwd.rx) {
      const fw = forwardText(text);
      if (fw.swaps) {
        snapshot(body, true);
        text = fw.text;
        forwarded += fw.swaps;
        buildBody(body, text);
      }
    }
    doc.pages[i].lines = text.split("\n");
  });
  const out = TD.serializeExport(doc);
  // The standing assertion. Nothing above should let a bound real value
  // through, and if something did the save must not.
  if (reals) {
    const left = PK.findReals(reals, maskKept(out));
    if (left.length) {
      toast("Not saved: the text still carries a real name the key binds — " + left.slice(0, 4).map((w) => w.real).join(", ") + (left.length > 4 ? "…" : "") + ". Delete or retype it and save again.", { error: true });
      return;
    }
  }
  const ok = await writeText(out, fileName, fileHandle);
  if (!ok) return;
  setDirty(false);
  if (forwarded) afterTextChange();
  toast("Saved " + fileName + (forwarded ? ` · ${forwarded} real name${forwarded === 1 ? "" : "s"} written as pseudonym${forwarded === 1 ? "" : "s"}` : ""));
}
saveBtn.addEventListener("click", saveDocument);
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); saveDocument(); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); flagSelection(); }
});

/** Write text: in place through the handle, else the Save picker, else a download. */
async function writeText(text, name, handle) {
  const blob = new Blob([text], { type: "text/plain" });
  if (handle && handle.createWritable) {
    try {
      if (handle.requestPermission) {
        const perm = await handle.requestPermission({ mode: "readwrite" });
        if (perm !== "granted") throw new Error("write permission denied");
      }
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return true;
    } catch (e) {
      if (e && e.name === "AbortError") return false;
      toast("Could not write in place (" + (e.message || e) + ") — choose where to save.", { error: true });
    }
  }
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: "Text", accept: { "text/plain": [".txt"] } }] });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      if (handle == null && h && h.name === name) fileHandle = h;
      return true;
    } catch (e) {
      if (e && e.name === "AbortError") return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

// ── citations ────────────────────────────────────────────────────────────────────────
/**
 * A page body as one string with a map from offsets back to text nodes: the
 * same walk serializeNodes makes, on the DISPLAYED text, so a citation found
 * in the string can be turned into a DOM Range.
 */
function flatten(body, { blankGutters = false } = {}) {
  const segs = [];
  let text = "";
  const rec = (n, atStart) => {
    if (n.nodeType === 3) {
      segs.push({ node: n, start: text.length, end: text.length + n.data.length });
      // For DETECTION the pleading gutter number is blanked, length for
      // length: a cite that wraps onto a numbered line otherwise carries a
      // digit run between its volume and its reporter, or between the code
      // and its section, and parses as nothing (the pdf_linker.py rule).
      text += blankGutters && n.parentElement && n.parentElement.classList.contains("gutter") ? " ".repeat(n.data.length) : n.data;
      return;
    }
    if (n.nodeType !== 1) return;
    if (n.nodeName === "BR") { text += "\n"; return; }
    if ((n.nodeName === "DIV" || n.nodeName === "P" || n.nodeName === "LI") && !atStart) text += "\n";
    let first = true;
    for (const c of n.childNodes) { rec(c, first && atStart); first = false; }
  };
  rec(body, true);
  return { text, segs };
}

function rangeFor(segs, start, end) {
  const find = (off, isEnd) => {
    // The last segment starting at or before `off`.
    let lo = 0, hi = segs.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid].start <= off) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (idx < 0) return null;
    let s = segs[idx];
    if (off > s.end) return null; // inside a <br>/<div> newline, which no node holds
    // A START on a segment's end is the next segment's start where one begins there.
    if (!isEnd && off === s.end && idx + 1 < segs.length && segs[idx + 1].start === off) s = segs[idx + 1];
    return { node: s.node, off: off - s.start };
  };
  const a = find(start, false), b = find(end, true);
  if (!a || !b) return null;
  const r = document.createRange();
  try { r.setStart(a.node, a.off); r.setEnd(b.node, b.off); } catch { return null; }
  return r;
}

function placeCitations() {
  if (!doc) return;
  const bodies = pageBodies();
  const parts = [];
  const maps = [];
  let base = 0;
  for (const body of bodies) {
    const { text, segs } = flatten(body, { blankGutters: true });
    maps.push({ body, base, segs, len: text.length });
    parts.push(text);
    base += text.length + 2;
  }
  const full = parts.join("\n\n");
  let found = [];
  try { found = findAllCitations(full); } catch (e) { console.error(e); }
  for (const m of maps) m.body.nextElementSibling.innerHTML = "";
  const seen = new Map();
  let linked = 0;
  for (const c of found) {
    const url = resolveUrl(c, citationRepo, provider);
    if (!url) continue;
    if (!seen.has(c.key)) seen.set(c.key, { key: c.key, kind: c.kind, url });
    const [s, e] = c.span;
    const m = maps.find((x) => s >= x.base && e <= x.base + x.len);
    if (!m) continue;
    const range = rangeFor(m.segs, s - m.base, e - m.base);
    if (!range) continue;
    const layer = m.body.nextElementSibling;
    const bodyRect = m.body.getBoundingClientRect();
    const kind = c.isSupra || c.isShortForm ? "supra" : c.kind;
    // A cite that wraps onto a numbered line spans the gutter number it was
    // detected across; the number is not part of the citation and gets no
    // underline.
    const gutters = [...m.body.querySelectorAll(".gutter")]
      .filter((g) => range.intersectsNode(g))
      .map((g) => g.getBoundingClientRect());
    for (const r of range.getClientRects()) {
      if (r.width < 1) continue;
      if (gutters.some((g) => r.left >= g.left - 0.5 && r.right <= g.right + 0.5 && r.top >= g.top - 0.5 && r.bottom <= g.bottom + 0.5)) continue;
      const a = document.createElement("a");
      a.className = "cite-link kind-" + kind;
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.title = c.key;
      a.style.left = (r.left - bodyRect.left) + "px";
      a.style.top = (r.bottom - bodyRect.top - 6) + "px";
      a.style.width = r.width + "px";
      layer.appendChild(a);
    }
    linked++;
  }
  lastCites = [...seen.values()];
  $("st-cites").textContent = linked ? `${linked} citation${linked === 1 ? "" : "s"} linked` : "";
  renderToa();
}
function renderToa() { if (toaOn) toaPanel.render(lastCites, provider); }

// ── highlights: flagged values and real names standing in the clear ─────────────
function paintHighlights() {
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
  const flaggedRanges = [];
  const leakRanges = [];
  let leaks = 0;
  const bodies = pageBodies();
  const flagRx = flagged.length ? PK.buildMatcher(flagged) : null;
  for (const body of bodies) {
    const segs = plainSegments(body);
    if (fwd) {
      const masked = segs.map((seg) => ({ node: seg.node, text: maskKept(seg.text) }));
      for (const h of TD.findRealsInPlain(fwd, masked)) {
        const r = document.createRange();
        r.setStart(h.node, h.start); r.setEnd(h.node, h.end);
        leakRanges.push(r);
        leaks++;
      }
    }
    if (flagRx) {
      const { text, segs: all } = flatten(body);
      flagRx.lastIndex = 0;
      let m;
      while ((m = flagRx.exec(text))) {
        const r = rangeFor(all, m.index, m.index + m[0].length);
        if (r) flaggedRanges.push(r);
        if (m.index === flagRx.lastIndex) flagRx.lastIndex++;
      }
    }
  }
  CSS.highlights.set("flagged", new Highlight(...flaggedRanges));
  CSS.highlights.set("leak", new Highlight(...leakRanges));
  $("st-leaks").textContent = leaks ? `⚠ ${leaks} real name${leaks === 1 ? "" : "s"} from the key standing unfaked — written as pseudonyms on save` : "";
}

// ── pseudonym tooltip ──────────────────────────────────────────────────────────────────
pagesEl.addEventListener("mouseover", (e) => {
  const pn = e.target.closest && e.target.closest(".pn");
  if (!pn || !settings.marks) { hideTip(); return; }
  tipEl.innerHTML = "";
  const b = document.createElement("b");
  b.textContent = settings.showFakes ? pn.dataset.real : pn.dataset.fake;
  tipEl.append(settings.showFakes ? "Real name: " : "Pseudonym: ", b);
  if (pn.dataset.kept) tipEl.append(document.createElement("br"), `Kept (${pn.dataset.kept === "never" ? "every case" : "this case"}): PDF-Linker leaves it un-faked on its next run. Right-click to change.`);
  tipEl.hidden = false;
  const r = pn.getBoundingClientRect();
  const tw = tipEl.offsetWidth;
  tipEl.style.left = Math.max(4, Math.min(window.innerWidth - tw - 4, r.left)) + "px";
  tipEl.style.top = (r.top > 40 ? r.top - tipEl.offsetHeight - 6 : r.bottom + 6) + "px";
});
pagesEl.addEventListener("mouseout", (e) => { if (e.target.closest && e.target.closest(".pn")) hideTip(); });
function hideTip() { tipEl.hidden = true; }

// ── flagging a real value ────────────────────────────────────────────────────────────────
function currentSelection() {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const body = range.commonAncestorContainer.nodeType === 1
    ? range.commonAncestorContainer.closest(".page-body")
    : range.commonAncestorContainer.parentElement && range.commonAncestorContainer.parentElement.closest(".page-body");
  if (!body) return null;
  const frag = range.cloneContents();
  const inFrag = frag.querySelector ? frag.querySelector(".pn") : null;
  const startPn = range.startContainer.parentElement && range.startContainer.parentElement.closest(".pn");
  const endPn = range.endContainer.parentElement && range.endContainer.parentElement.closest(".pn");
  const touches = !!(inFrag || startPn || endPn);
  // The live span (a fragment holds a copy): the one the selection starts in,
  // else the first one it covers.
  let pn = startPn || endPn || null;
  if (!pn && inFrag) pn = [...body.querySelectorAll(".pn")].find((el) => range.intersectsNode(el)) || null;
  return { text: sel.toString(), touches, range, pn };
}

// ── un-flagging a wrongly faked value ───────────────────────────────────────────
//
// A pseudonym that should never have been one — a word of a cited decision's
// name is the usual case. Right-click it: "keep in this case" is the
// worksheet's `no`, "never fake anywhere" its `never`, and either takes
// effect HERE at once (the mark goes, every occurrence) and reaches
// PDF-Linker through New Real Values.txt for the run that actually restores
// the file. Until that run the file still carries the fake, which the
// tooltip says.
const keepMenu = $("keep-menu");
let keepMenuFor = null;
function showKeepMenu(pn, x, y) {
  keepMenuFor = pn;
  const real = pn.dataset.real;
  const c = TD.keptControl(keeps, real);
  $("keep-menu-value").textContent = real;
  $("keep-menu-fake").textContent = pn.dataset.fake;
  $("keep-menu-no").hidden = c === "no";
  $("keep-menu-never").hidden = c === "never";
  $("keep-menu-undo").hidden = !c;
  keepMenu.hidden = false;
  keepMenu.style.left = Math.max(4, Math.min(window.innerWidth - keepMenu.offsetWidth - 4, x)) + "px";
  keepMenu.style.top = Math.max(4, Math.min(window.innerHeight - keepMenu.offsetHeight - 4, y)) + "px";
}
function hideKeepMenu() { keepMenu.hidden = true; keepMenuFor = null; }
pagesEl.addEventListener("contextmenu", (e) => {
  const pn = e.target.closest && e.target.closest(".pn");
  if (!pn) return;
  e.preventDefault();
  hideTip();
  showKeepMenu(pn, e.clientX, e.clientY);
});
document.addEventListener("mousedown", (e) => { if (!keepMenu.hidden && !keepMenu.contains(e.target)) hideKeepMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { hideKeepMenu(); flagPop.hidden = true; } });

function setKeep(real, control) {
  keeps = control ? TD.addKeep(keeps, control, real) : TD.removeKeep(keeps, real);
  persistValues();
  compileKey();
  remarkKept();
  renderFlags();
  paintHighlights();
  showSidePanel(true);
  showSideTab("tab-flags");
  toast(control
    ? `"${real}" kept${control === "never" ? " in every case" : " in this case"} — un-marked here now; PDF-Linker un-fakes it in the file on its next run (save the list to the case folder first).`
    : `"${real}" is a pseudonym again`);
}
$("keep-menu-no").addEventListener("click", () => { const r = keepMenuFor && keepMenuFor.dataset.real; hideKeepMenu(); if (r) setKeep(r, "no"); });
$("keep-menu-never").addEventListener("click", () => { const r = keepMenuFor && keepMenuFor.dataset.real; hideKeepMenu(); if (r) setKeep(r, "never"); });
$("keep-menu-undo").addEventListener("click", () => { const r = keepMenuFor && keepMenuFor.dataset.real; hideKeepMenu(); if (r) setKeep(r, ""); });
$("keep-menu-cancel").addEventListener("click", hideKeepMenu);

const showFlagPopSoon = debounce(showFlagPop, 120);
document.addEventListener("selectionchange", showFlagPopSoon);
function showFlagPop() {
  const s = currentSelection();
  if (!s) { flagPop.hidden = true; return; }
  const problem = TD.flagProblem(s.text, s.touches);
  flagPopBtn.disabled = !!problem;
  flagPopNote.textContent = problem || "";
  // A pseudonym in the selection: the question is the other one.
  const pnIn = s.pn;
  $("flag-pop-keep").hidden = !pnIn;
  if (pnIn) {
    flagPopNote.textContent = "Wrongly faked? Keep \u201c" + pnIn.dataset.real + "\u201d:";
    $("flag-pop-keep").onclick = (e) => { e.preventDefault(); flagPop.hidden = true; showKeepMenu(pnIn, e.clientX, e.clientY); };
  }
  const rects = s.range.getClientRects();
  const r = rects.length ? rects[rects.length - 1] : s.range.getBoundingClientRect();
  flagPop.hidden = false;
  const w = flagPop.offsetWidth;
  flagPop.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, r.right + 8)) + "px";
  flagPop.style.top = Math.max(toolbar.offsetHeight + 4, r.bottom + 6) + "px";
}
flagPopBtn.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
$("flag-pop-keep").addEventListener("mousedown", (e) => e.preventDefault());
flagPopBtn.addEventListener("click", flagSelection);
$("flag-btn").addEventListener("mousedown", (e) => e.preventDefault());
$("flag-btn").addEventListener("click", flagSelection);

function flagSelection() {
  const s = currentSelection();
  const problem = s ? TD.flagProblem(s.text, s.touches) : "Select the unfaked name first.";
  if (problem) { toast(problem, { error: true }); return; }
  const before = flagged.length;
  flagged = TD.addValue(flagged, s.text);
  const v = TD.normalizeValue(s.text);
  persistValues();
  renderFlags();
  paintHighlights();
  flagPop.hidden = true;
  // The list is where the flag went; show it growing.
  showSidePanel(true);
  showSideTab("tab-flags");
  toast(flagged.length > before ? `Flagged "${v}" — ${flagged.length} value${flagged.length === 1 ? "" : "s"} to hand to PDF-Linker` : `"${v}" is already flagged`);
}

function valuesStoreKey() { return VALUES_PREFIX + (folderName || fileName || "loose"); }
// Stored as { values, keeps }; an older build stored the values list bare.
function readStoredValues(k) {
  const v = lsGet(k, null);
  if (Array.isArray(v)) return { values: v, keeps: [] };
  return { values: (v && v.values) || [], keeps: (v && v.keeps) || [] };
}
function loadValuesFor() { const st = readStoredValues(valuesStoreKey()); flagged = st.values; keeps = st.keeps; compileKey(); renderFlags(); }
function persistValues() { lsSet(valuesStoreKey(), { values: flagged, keeps }); }

function renderFlags() {
  flagsList.innerHTML = "";
  flagCount.textContent = String(flagged.length + keeps.length);
  const keepsList = $("keeps-list");
  keepsList.innerHTML = "";
  $("keeps-block").hidden = !keeps.length;
  for (const k of keeps) {
    const li = document.createElement("li");
    li.textContent = k.value;
    const t = document.createElement("span");
    t.className = "tag keep";
    t.textContent = k.control === "never" ? "never" : "this case";
    t.title = k.control === "never" ? "Kept in every case (never)" : "Kept in this case (no)";
    li.appendChild(t);
    li.title = "Click to find it in the document";
    li.addEventListener("click", () => findInPages(k.value));
    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "×";
    x.title = "Make it a pseudonym again";
    x.addEventListener("click", (e) => { e.stopPropagation(); setKeep(k.value, ""); });
    li.appendChild(x);
    keepsList.appendChild(li);
  }
  for (const v of flagged) {
    const li = document.createElement("li");
    li.textContent = v;
    li.title = "Click to find it in the document";
    li.addEventListener("click", () => findInPages(v));
    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "×";
    x.title = "Withdraw this value";
    x.addEventListener("click", (e) => { e.stopPropagation(); flagged = TD.removeValue(flagged, v); persistValues(); renderFlags(); paintHighlights(); });
    li.appendChild(x);
    flagsList.appendChild(li);
  }
  flagsNote.textContent = dirHandle
    ? `Saves to ${folderName}/${TD.VALUES_FILE}.`
    : "No case folder is open: the list is remembered here and can be saved anywhere or copied.";
}

function findInPages(v) {
  const rx = PK.buildMatcher([v]);
  for (const body of pageBodies()) {
    const { text, segs } = flatten(body);
    rx.lastIndex = 0;
    const m = rx.exec(text);
    if (!m) continue;
    const r = rangeFor(segs, m.index, m.index + m[0].length);
    if (!r) continue;
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    const rect = r.getBoundingClientRect();
    stageEl.scrollBy({ top: rect.top - stageEl.getBoundingClientRect().top - stageEl.clientHeight / 3, behavior: "smooth" });
    return;
  }
  toast(`"${v}" is not in this document`);
}

async function saveValuesFile() {
  if (!flagged.length && !keeps.length) { toast("Nothing flagged yet — select an unfaked name and press Flag, or right-click a pseudonym to keep it.", { error: true }); return; }
  const text = TD.formatValuesFile(flagged, keeps);
  if (dirHandle) {
    try {
      if (dirHandle.requestPermission) {
        const perm = await dirHandle.requestPermission({ mode: "readwrite" });
        if (perm !== "granted") throw new Error("write permission denied");
      }
      const h = await dirHandle.getFileHandle(TD.VALUES_FILE, { create: true });
      const w = await h.createWritable();
      await w.write(new Blob([text], { type: "text/plain" }));
      await w.close();
      toast(`Wrote ${TD.VALUES_FILE} (${flagged.length} to fake, ${keeps.length} to keep) into ${folderName} — re-run PDF-Linker to apply them to the files.`);
      return;
    } catch (e) {
      toast("Could not write into the folder (" + (e.message || e) + ") — choose where to save.", { error: true });
    }
  }
  await writeText(text, TD.VALUES_FILE, null);
}
$("flags-save").addEventListener("click", saveValuesFile);
$("flags-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(flagged.concat(keeps.map((k) => k.control + ": " + k.value)).join("\n") + "\n"); toast("Copied " + (flagged.length + keeps.length) + " line" + (flagged.length + keeps.length === 1 ? "" : "s")); }
  catch { toast("Copy failed", { error: true }); }
});

// ── auto-scroll while reading ────────────────────────────────────────────────────────
//
// The PDF viewer's creep, for the reader's own scroll box: A toggles it,
// [ and ] slow and speed it, Space pauses; the pace is remembered. Stops at
// the foot of the document and on any wheel or drag by the reader.
const autoBtn = $("autoscroll");
let autoOn = false, autoSpeed = lsGet("textReader.autoscroll", 40), autoLast = 0, autoAcc = 0, autoRaf = 0;
function autoStep(ts) {
  if (!autoOn) return;
  if (autoLast) {
    autoAcc += (autoSpeed * (ts - autoLast)) / 1000;
    const px = Math.floor(autoAcc);
    if (px > 0) { stageEl.scrollTop += px; autoAcc -= px; }
    if (stageEl.scrollTop + stageEl.clientHeight >= stageEl.scrollHeight - 1) { setAutoScroll(false); return; }
  }
  autoLast = ts;
  autoRaf = requestAnimationFrame(autoStep);
}
function setAutoScroll(on) {
  autoOn = !!on && !!doc;
  autoBtn.setAttribute("aria-pressed", String(autoOn));
  autoBtn.title = (autoOn ? "Auto-scrolling at " : "Auto-scroll while reading (A) — ") + Math.round(autoSpeed) + " px/s; [ slower, ] faster, Space pauses";
  cancelAnimationFrame(autoRaf);
  autoLast = 0; autoAcc = 0;
  if (autoOn) autoRaf = requestAnimationFrame(autoStep);
}
function nudgeAutoSpeed(factor) {
  autoSpeed = Math.max(8, Math.min(400, autoSpeed * factor));
  lsSet("textReader.autoscroll", autoSpeed);
  setAutoScroll(autoOn);
  toast("Auto-scroll " + Math.round(autoSpeed) + " px/s");
}
autoBtn.addEventListener("click", () => setAutoScroll(!autoOn));
stageEl.addEventListener("wheel", () => { if (autoOn) setAutoScroll(false); }, { passive: true });
document.addEventListener("keydown", (e) => {
  // Not while typing in the document or a field.
  const t = e.target;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
  if (e.key === "a" || e.key === "A") { e.preventDefault(); setAutoScroll(!autoOn); }
  else if (e.key === "[") { e.preventDefault(); nudgeAutoSpeed(0.8); }
  else if (e.key === "]") { e.preventDefault(); nudgeAutoSpeed(1.25); }
  else if (e.key === " " && autoOn) { e.preventDefault(); setAutoScroll(false); }
});

// ── the PDF beside the text ──────────────────────────────────────────────────────────
//
// PDF-Linker leaves the PDF in the case folder under its REAL name and names
// the export for the same stem SCRUBBED, so the pair is found by translating
// each PDF's stem forward through the key (pdfsync.matchPdf); a Combined
// Text.txt is matched member by member off its banners, and a document with
// no match (a lone file, a folder with no key) takes a PDF picked by hand.
// The PDF is read only when it is first shown, never on open.
//
// Two ways to look at it, and one at a time:
//   SIDE BY SIDE — the pane beside the stage holds one slot per text page,
//   the PDF page rendered into it as it scrolls into view, and the two
//   scroll boxes are held at the same page-and-fraction (scrollPosition /
//   scrollTopFor), so page 7 of the text sits beside page 7 of the PDF
//   whatever their heights. Remembered.
//   SWAPPED IN — with the pane off, a page (or "5, 12-18" of them) shows its
//   PDF page in the text's place: the page body is hidden, not removed, so
//   it still serializes on save and comes back with one click. Remembered
//   per document, by PDF page number.
// Canvases are dropped as their pages scroll far out of view: a 130-page
// PDF rendered whole is gigabytes of bitmap.
const pdfPane = $("pdf-pane");
const sbsBtn = $("sbs-toggle");
const swapBtn = $("swap-btn");
const swapPop = $("swap-pop");
const PDF_MARGIN = 800; // px beyond the viewport a page is kept rendered
let sbsOn = lsGet("textReader.sbs", false) === true;
let pdfSources = [];        // per text page: { name, handle?, file? } or null
let pdfPicked = null;       // a PDF chosen by hand for this document
let swaps = new Set();      // "<pdf name>|<page>" swapped in
const pdfCache = new Map(); // name → Promise<{ pdf, count, sizes, name }>

function forgetPdfs() {
  for (const p of pdfCache.values()) p.then((info) => { try { info.pdf.destroy(); } catch { /* gone */ } }).catch(() => {});
  pdfCache.clear();
  pdfPicked = null;
}

/** Open (once) the PDF behind a source: its page count and each page's size at scale 1. */
function loadPdf(src) {
  if (pdfCache.has(src.name)) return pdfCache.get(src.name);
  const p = (async () => {
    const file = src.file || await src.handle.getFile();
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const sizes = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const v = (await pdf.getPage(i)).getViewport({ scale: 1 });
      sizes.push({ w: v.width, h: v.height });
    }
    return { pdf, count: pdf.numPages, sizes, name: src.name };
  })();
  pdfCache.set(src.name, p);
  p.catch(() => pdfCache.delete(src.name));
  return p;
}

/** Which PDF each text page comes from, through the key and the folder's PDFs. */
function resolvePdfSources() {
  if (!doc) { pdfSources = []; return; }
  const names = PS.pageSources(doc.pages, fileName);
  const fwdName = fwd ? (s) => forwardText(s).text : null;
  const memo = new Map();
  pdfSources = names.map((n) => {
    if (!memo.has(n)) {
      const hit = PS.matchPdf(n, folderPdfs.map((p) => p.name), fwdName);
      memo.set(n, hit ? folderPdfs.find((p) => p.name === hit) : pdfPicked);
    }
    return memo.get(n) || null;
  });
}
function pdfSourceNames() { return [...new Set(pdfSources.filter(Boolean).map((s) => s.name))]; }
/** The PDF page a text page shows, with its source — or null. */
function pdfTarget(i) {
  const src = pdfSources[i], n = doc && PS.pdfPageOf(doc.pages[i]);
  return src && n ? { src, page: n, key: src.name + "|" + n } : null;
}

/** Everything the PDF side shows for the current document, from scratch. */
function setupPdfForDoc() {
  pdfPicked = null;
  swaps = new Set(lsGet(PS.swapStoreKey(folderName, fileName), []));
  refreshPdf();
}
/** Re-resolve the PDFs (the key or the folder changed) and redraw. */
function refreshPdf() {
  resolvePdfSources();
  const any = pdfSources.some(Boolean);
  sbsBtn.disabled = !doc;
  swapBtn.disabled = !doc;
  refreshSwapButtons();
  applySwaps();
  buildPdfPane();
  updatePdfStatus();
  if (!any && !doc) hideSwapPop();
}
function updatePdfStatus() {
  const names = pdfSourceNames();
  const n = [...swaps].filter((k) => pdfSources.some((s, i) => s && pdfTarget(i) && pdfTarget(i).key === k)).length;
  $("st-pdf").textContent = !doc ? "" : names.length ? "PDF: " + names.join(", ") + (n ? ` · ${n} page${n === 1 ? "" : "s"} shown from the PDF` : "") : "No matching PDF in the case folder";
}

// ── rendering a page into a canvas ──
async function renderInto(el, src, pageNo, cssWidth) {
  const want = src.name + "|" + pageNo + "|" + cssWidth + "|" + (window.devicePixelRatio || 1);
  if (el.dataset.rendered === want) return;
  el.dataset.want = want;
  let info;
  try { info = await loadPdf(src); }
  catch (e) { el.querySelector(".pdf-wait").textContent = "Could not open " + src.name + ": " + (e.message || e); return; }
  if (el.dataset.want !== want) return;
  if (pageNo > info.count) { el.querySelector(".pdf-wait").textContent = `The PDF has ${info.count} page${info.count === 1 ? "" : "s"}; there is no page ${pageNo}.`; return; }
  const page = await info.pdf.getPage(pageNo);
  if (el.dataset.want !== want) return;
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const vp = page.getViewport({ scale: (cssWidth / base.width) * dpr });
  const canvas = el.querySelector("canvas");
  if (el.__task) { try { el.__task.cancel(); } catch { /* done */ } }
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  canvas.style.width = cssWidth + "px";
  canvas.style.height = Math.round(vp.height / dpr) + "px";
  el.style.height = "";
  const task = page.render({ canvasContext: canvas.getContext("2d"), viewport: vp });
  el.__task = task;
  try { await task.promise; } catch (e) { if (!(e && e.name === "RenderingCancelledException")) console.warn(e); return; }
  finally { if (el.__task === task) el.__task = null; }
  if (el.dataset.want !== want) return;
  el.dataset.rendered = want;
  el.classList.add("ready");
}
function releaseCanvas(el) {
  if (!el.dataset.rendered) return;
  const canvas = el.querySelector("canvas");
  // Keep the box its size, drop the bitmap.
  el.style.height = canvas.style.height;
  canvas.width = canvas.height = 0;
  canvas.style.height = "0px";
  delete el.dataset.rendered;
  el.classList.remove("ready");
}
function slotShell(cls, tag) {
  const el = document.createElement("div");
  el.className = cls;
  const t = document.createElement("div");
  t.className = "pdf-tag";
  t.textContent = tag;
  const c = document.createElement("canvas");
  const w = document.createElement("div");
  w.className = "pdf-wait";
  w.textContent = "Loading…";
  el.append(t, c, w);
  return el;
}
/** The height a page box should have before its bitmap arrives, from the PDF's page sizes. */
async function presize(el, src, pageNo, cssWidth) {
  try {
    const info = await loadPdf(src);
    const sz = info.sizes[pageNo - 1];
    if (sz && !el.dataset.rendered) el.style.height = Math.round((cssWidth * sz.h) / sz.w) + "px";
  } catch { /* the render reports it */ }
}
const paneObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    const el = en.target;
    if (en.isIntersecting) renderInto(el, pdfSources[Number(el.dataset.index)], Number(el.dataset.page), paneWidth());
    else releaseCanvas(el);
  }
}, { root: pdfPane, rootMargin: PDF_MARGIN + "px 0px" });
const inlineObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    const el = en.target;
    const sec = el.closest(".tpage");
    if (en.isIntersecting) renderInto(el, pdfSources[Number(sec.dataset.index)], Number(el.dataset.page), inlineWidth(sec));
    else releaseCanvas(el);
  }
}, { root: stageEl, rootMargin: PDF_MARGIN + "px 0px" });

function paneWidth() { return Math.max(200, pdfPane.clientWidth - 32); }
function inlineWidth(sec) { return Math.max(200, sec.clientWidth); }

// ── side by side ──
function buildPdfPane() {
  pdfPane.innerHTML = "";
  pdfPane.hidden = !sbsOn || !doc;
  document.body.classList.toggle("sbs", sbsOn && !!doc);
  sbsBtn.setAttribute("aria-pressed", String(sbsOn && !!doc));
  if (pdfPane.hidden) return;
  if (!pdfSources.some(Boolean)) {
    const box = document.createElement("div");
    box.className = "pane-empty";
    box.innerHTML = `<p>No PDF in the case folder matches <b></b>${dirHandle ? "" : " (no case folder is open)"}.</p><p><button type="button">Pick the PDF…</button></p>`;
    box.querySelector("b").textContent = fileName;
    box.querySelector("button").addEventListener("click", pickPdf);
    pdfPane.appendChild(box);
    return;
  }
  const w = paneWidth();
  doc.pages.forEach((p, i) => {
    const t = pdfTarget(i);
    let el;
    if (!t) {
      el = document.createElement("div");
      el.className = "pdf-slot blank";
      el.textContent = p.banner != null ? TD.pageLabel(p) : (p.header != null ? "No PDF page for this part" : "");
    } else {
      el = slotShell("pdf-slot", "PDF p. " + t.page + (pdfSourceNames().length > 1 ? " · " + t.src.name : ""));
      el.dataset.page = String(t.page);
      el.style.height = Math.round(w * 11 / 8.5) + "px"; // letter, until the PDF says
      presize(el, t.src, t.page, w);
      paneObserver.observe(el);
    }
    el.dataset.index = String(i);
    el.style.width = t ? w + "px" : "";
    pdfPane.appendChild(el);
  });
  syncScroll("text", true);
}
function setSideBySide(on, { remember = true } = {}) {
  sbsOn = !!on;
  if (remember) lsSet("textReader.sbs", sbsOn);
  buildPdfPane();
  applySwaps();
  relayout();
}
sbsBtn.addEventListener("click", () => setSideBySide(!sbsOn));

// The two boxes at one place: whichever the reader scrolls leads, and the
// other follows to the same page and fraction of it. A follow lands a
// scroll event of its own, which is ignored while the lead is fresh.
let syncLead = null, syncTimer = 0;
function pageGeometry(box, sel) {
  const els = [...box.querySelectorAll(sel)];
  return { tops: els.map((e) => e.offsetTop), heights: els.map((e) => e.offsetHeight) };
}
function syncScroll(from, force) {
  if (!sbsOn || pdfPane.hidden) return;
  if (!force && syncLead && syncLead !== from) return;
  syncLead = from;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncLead = null; }, 120);
  const [a, b, sa, sb] = from === "text" ? [stageEl, pdfPane, ".tpage", ".pdf-slot"] : [pdfPane, stageEl, ".pdf-slot", ".tpage"];
  const ga = pageGeometry(a, sa), gb = pageGeometry(b, sb);
  if (!ga.tops.length || !gb.tops.length) return;
  const target = PS.scrollTopFor(PS.scrollPosition(a.scrollTop, ga.tops, ga.heights), gb.tops, gb.heights);
  if (Math.abs(b.scrollTop - target) > 1) b.scrollTop = target;
}
stageEl.addEventListener("scroll", () => syncScroll("text"), { passive: true });
pdfPane.addEventListener("scroll", () => syncScroll("pdf"), { passive: true });

/** Widths changed (a resize, the panel): re-fit every shown PDF page. */
function refitPdf() {
  if (!doc) return;
  if (!pdfPane.hidden) {
    const w = paneWidth();
    for (const el of pdfPane.querySelectorAll(".pdf-slot:not(.blank)")) {
      el.style.width = w + "px";
      if (el.dataset.rendered) renderInto(el, pdfSources[Number(el.dataset.index)], Number(el.dataset.page), w);
      else presize(el, pdfSources[Number(el.dataset.index)], Number(el.dataset.page), w);
    }
  }
  for (const el of pagesEl.querySelectorAll(".pdf-inline")) {
    const sec = el.closest(".tpage");
    if (el.dataset.rendered) renderInto(el, pdfSources[Number(sec.dataset.index)], Number(el.dataset.page), inlineWidth(sec));
  }
}

// ── swapping pages in ──
function isSwapped(i) { const t = pdfTarget(i); return !!(t && swaps.has(t.key)); }
function refreshSwapButtons() {
  for (const sec of pagesEl.querySelectorAll(".tpage")) {
    const b = sec.querySelector(".swap-page");
    if (!b) continue;
    const i = Number(sec.dataset.index);
    const t = pdfTarget(i);
    const on = isSwapped(i);
    b.classList.toggle("nopdf", !t);
    b.textContent = on ? "⇄ Text" : "⇄ PDF";
    b.title = !t ? "No PDF matched this document — ⇄ PDF pages… in the toolbar picks one" : on ? "Back to the text of this page" : `Show PDF page ${t.page} here instead of its text`;
  }
}
/** Show or hide the PDF page inside each swapped text page (never while side by side). */
function applySwaps() {
  for (const sec of pagesEl.querySelectorAll(".tpage")) {
    const i = Number(sec.dataset.index);
    const t = pdfTarget(i);
    const on = !sbsOn && !!t && swaps.has(t.key);
    sec.classList.toggle("swapped", on);
    let inline = sec.querySelector(".pdf-inline");
    if (on) {
      if (!inline) {
        inline = slotShell("pdf-inline", "PDF p. " + t.page);
        sec.querySelector(".page-inner").appendChild(inline);
      }
      if (inline.dataset.page !== String(t.page) || inline.dataset.src !== t.src.name) {
        inline.dataset.page = String(t.page);
        inline.dataset.src = t.src.name;
        delete inline.dataset.rendered;
        inline.classList.remove("ready");
        inline.querySelector(".pdf-tag").textContent = "PDF p. " + t.page;
        presize(inline, t.src, t.page, inlineWidth(sec));
      }
      inlineObserver.observe(inline);
    } else if (inline) {
      inlineObserver.unobserve(inline);
      if (inline.__task) { try { inline.__task.cancel(); } catch { /* done */ } }
      inline.remove();
    }
  }
  refreshSwapButtons();
  updatePdfStatus();
  placeCitations();
}
function persistSwaps() { lsSet(PS.swapStoreKey(folderName, fileName), [...swaps]); }
function setSwaps(indices, on) {
  for (const i of indices) { const t = pdfTarget(i); if (t) { if (on) swaps.add(t.key); else swaps.delete(t.key); } }
  persistSwaps();
  if (sbsOn) { toast(on ? "Those pages show from the PDF once Side by side is off." : "Back to text"); }
  applySwaps();
}
function toggleSwap(i) {
  const t = pdfTarget(i);
  if (!t) { showSwapPop(); toast("No PDF matched this document — pick it first.", { error: true }); return; }
  if (sbsOn) { setSideBySide(false); }
  setSwaps([i], !swaps.has(t.key));
}

// The swap popover: "5, 12-18" of the PDF the page in view comes from.
function sourceInView() {
  const g = pageGeometry(stageEl, ".tpage");
  const pos = PS.scrollPosition(stageEl.scrollTop, g.tops, g.heights);
  for (let i = pos.index; i < pdfSources.length; i++) if (pdfSources[i]) return pdfSources[i];
  return pdfSources.find(Boolean) || null;
}
function indicesForPages(src, pages) {
  const want = new Set(pages);
  const out = [];
  pdfSources.forEach((s, i) => { const t = pdfTarget(i); if (s && t && s.name === src.name && want.has(t.page)) out.push(i); });
  return out;
}
async function showSwapPop() {
  if (!doc) return;
  const src = sourceInView();
  const head = $("swap-pop-head");
  const note = $("swap-pop-note");
  if (src) {
    head.innerHTML = "";
    head.append("PDF: ");
    const b = document.createElement("b"); b.textContent = src.name; head.appendChild(b);
    try { const info = await loadPdf(src); head.append(` · ${info.count} page${info.count === 1 ? "" : "s"}`); } catch { /* the render reports it */ }
    const mine = [...swaps].filter((k) => k.startsWith(src.name + "|")).map((k) => parseInt(k.split("|")[1], 10));
    $("swap-range").value = PS.formatPageRanges(mine);
    note.textContent = mine.length ? `Shown from the PDF now: pages ${PS.formatPageRanges(mine)}.` + (sbsOn ? " (Side by side is on; they show once it is off.)" : "") : "PDF page numbers — the export's own \"Page N\" — a page, or a run of pages: a badly scanned exhibit read from the PDF while the rest stays text.";
  } else {
    head.textContent = dirHandle ? `No PDF in ${folderName} matches ${fileName}.` : "No case folder is open, so no PDF was matched.";
    $("swap-range").value = "";
    note.textContent = "Pick the PDF this export came from; its pages can then be shown in place of the text.";
  }
  const r = swapBtn.getBoundingClientRect();
  swapPop.style.left = Math.max(8, Math.min(window.innerWidth - 356, r.left)) + "px";
  swapPop.style.top = (r.bottom + 6) + "px";
  swapPop.hidden = false;
  $("swap-range").focus();
  $("swap-range").select();
}
function hideSwapPop() { swapPop.hidden = true; }
function applyRange(on) {
  const src = sourceInView();
  if (!src) { pickPdf(); return; }
  const text = $("swap-range").value;
  const max = (() => { const m = $("swap-pop-head").textContent.match(/· (\d+) page/); return m ? parseInt(m[1], 10) : null; })();
  const { pages, bad } = PS.parsePageRanges(text, max);
  if (bad.length) { toast("Not a page or a range: " + bad.join(", ") + (max ? ` (the PDF has ${max} pages)` : ""), { error: true }); return; }
  if (!pages.length) { toast("Type the PDF pages to show, e.g. 5, 12-18", { error: true }); return; }
  const idx = indicesForPages(src, pages);
  if (!idx.length) { toast("None of those pages is in this document's text.", { error: true }); return; }
  if (on) {
    // "Show these" states the whole set: pages not named go back to text.
    const keep = new Set(idx.map((i) => pdfTarget(i).key));
    for (const k of [...swaps]) if (k.startsWith(src.name + "|") && !keep.has(k)) swaps.delete(k);
  }
  setSwaps(idx, on);
  if (on && sbsOn) setSideBySide(false);
  hideSwapPop();
  if (on && idx.length) { const sec = pagesEl.querySelector(`.tpage[data-index="${idx[0]}"]`); if (sec) stageEl.scrollTo({ top: sec.offsetTop - 12, behavior: "smooth" }); }
}
swapBtn.addEventListener("click", () => { if (swapPop.hidden) showSwapPop(); else hideSwapPop(); });
$("swap-show").addEventListener("click", () => applyRange(true));
$("swap-text").addEventListener("click", () => applyRange(false));
$("swap-clear").addEventListener("click", () => { swaps.clear(); persistSwaps(); applySwaps(); hideSwapPop(); });
$("swap-close").addEventListener("click", hideSwapPop);
$("swap-range").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyRange(true); } else if (e.key === "Escape") hideSwapPop(); });
document.addEventListener("mousedown", (e) => { if (!swapPop.hidden && !swapPop.contains(e.target) && e.target !== swapBtn) hideSwapPop(); });

// A PDF picked by hand stands in for every document the folder gave none.
async function usePickedPdf(file) {
  if (!file) return;
  pdfPicked = { name: file.name, file };
  pdfCache.delete(file.name);
  refreshPdf();
  toast("Using " + file.name + " for this document.");
}
async function pickPdf() {
  hideSwapPop();
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }] });
      await usePickedPdf(await h.getFile());
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
      if (!(e && /picker|not allowed|SecurityError|TypeError/i.test(String(e)))) { toast(String(e.message || e), { error: true }); return; }
    }
  }
  $("pdf-input").click();
}
$("pdf-pick").addEventListener("click", pickPdf);
$("pdf-input").addEventListener("change", async () => {
  const f = $("pdf-input").files[0];
  $("pdf-input").value = "";
  await usePickedPdf(f);
});

// ── hooks for the PWA tab shell ───────────────────────────────────────────────────────
window.__textReaderLoadLocal = (file, handle) => openFile(file, handle);
window.__textReaderRememberDir = (h) => rememberDir(h);
window.__textReaderReflow = () => { if (doc) placeCitations(); };
window.__pdfViewerUnregister = () => {};

// ── boot ───────────────────────────────────────────────────────────────────────────────────
applySettings();
loadSyncedSettings();
showSidePanel(sideChoice === true);
fillKeySelect("");
// The most recent key is offered on a lone file straight away: a folder pick
// replaces it with the folder's own.
{
  const lib = keyLibrary();
  const ids = Object.keys(lib).sort((a, b) => (lib[b].savedAt || 0) - (lib[a].savedAt || 0));
  if (ids.length) { keySelect.value = ids[0]; setKey(lib[ids[0]]); }
}
updateDirty();
renderFlags();
