// text-reader.js
//
// The text reader: PDF-Linker's scrubbed .txt exports, read like a document.
//
// What it does, and the one rule under all of it:
//
//   PAGES. The export's "====== Page N ======" headers lay the text out as
//   sheets, in a font the reader chooses. A page numbered down its margin
//   (pleading paper) is laid out as one: the numbers stand in a ruled
//   margin of their own and each numbered line hangs under its number.
//   LINE LOCK keeps every numbered line on one screen line — first by
//   taking the white space beside the page, then the page's own side
//   margins, then the font — and never by touching the numbers: the
//   numbers shown are the file's own, and nothing moves between them.
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
const lockToggle = $("lock-toggle");
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
let rev = null, fwd = null, reals = null, ahead = null; // compiled matchers
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
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
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
  // The EFFECTIVE size and width are what the pages use: the settings'
  // own, unless line lock has had to take something off them (below).
  root.setProperty("--reader-size-eff", settings.fontSize + "px");
  root.setProperty("--reader-width-eff", settings.pageWidth + "px");
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
  lockToggle.checked = settings.lineLock;
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
lockToggle.addEventListener("change", () => { settings.lineLock = lockToggle.checked; saveSettings(); applySettings(); relayout(); });

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
  // A kept value is never offered, and a real that opens one stays partial.
  ahead = k ? PK.compileTypeahead(k, keeps.map((x) => x.value)) : null;
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
  typeDismissed = null;
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

/**
 * Fill a page body from its on-disk text: one `.line` block per line, each
 * holding its gutter span (the number, and the spacing after it, which is
 * kept in the DOM for the round trip and hidden from the layout) and a
 * `.lt` span with the line's text and pseudonym spans. A block per line is
 * what lets a numbered page lay its numbers out in a margin of their own:
 * the text of a line hangs under its number, and a wrapped continuation
 * never crosses the rule. serializeNodes reads a DIV as a line break, so
 * the file comes back byte for byte.
 */
function buildBody(body, text) {
  body.innerHTML = "";
  body.classList.toggle("numbered", TD.pageIsNumbered(text.split("\n")));
  const runs = rev ? PK.translateRuns(rev, text) : [{ t: "text", s: text }];
  let line = null, lt = null, lineStart = true;
  const newLine = () => {
    line = document.createElement("div");
    line.className = "line";
    lt = document.createElement("span");
    lt.className = "lt";
    line.appendChild(lt);
    body.appendChild(line);
    lineStart = true;
  };
  newLine();
  runs.forEach((r, ri) => {
    if (r.t === "swap") {
      lt.appendChild(makePn(r.from, r.to, r));
      lineStart = false;
      return;
    }
    const pieces = r.s.split("\n");
    pieces.forEach((piece, i) => {
      if (i > 0) newLine();
      if (!piece) return;
      // A gutter number is followed by text; where that text is the pseudonym
      // span the NEXT run supplies, the number still opens the line.
      const last = i === pieces.length - 1 && ri + 1 < runs.length;
      const g = lineStart ? TD.gutterPrefix(last ? piece + "\u0001" : piece) : null;
      if (g && g.gutter.length <= piece.length) {
        line.insertBefore(makeGutter(g.gutter), lt);
        line.classList.add("num");
        const rest = piece.slice(g.gutter.length);
        if (rest) lt.appendChild(document.createTextNode(rest));
      } else lt.appendChild(document.createTextNode(piece));
      lineStart = false;
    });
    lineStart = r.s.endsWith("\n") || (lineStart && r.s === "");
  });
  for (const l of body.querySelectorAll(".line > .lt")) placeholderIn(l);
}
/** An empty slot carries a <br> so the caret can stand in it; one with text does not need it. */
function placeholderIn(lt) {
  // A <br> is only ever the placeholder: Enter and a paste never insert one
  // (plaintext-only types "\n"), so with text present every <br> goes.
  if (!lt.textContent.length) { if (!lt.querySelector("br")) lt.appendChild(document.createElement("br")); }
  else for (const br of [...lt.querySelectorAll("br")]) br.remove();
}
/** The gutter span: the number (shown in the margin) and the spacing after it (kept, not shown). The numbers are fixed: the span takes no edit. */
function makeGutter(prefix) {
  const m = prefix.match(/^( ?\d{1,2})( *)$/) || [null, prefix, ""];
  const span = document.createElement("span");
  span.className = "gutter";
  span.contentEditable = "false";
  const num = document.createElement("span");
  num.className = "gn";
  num.textContent = m[1];
  span.appendChild(num);
  if (m[2]) {
    const sp = document.createElement("span");
    sp.className = "gs";
    sp.textContent = m[2];
    span.appendChild(sp);
  }
  return span;
}

function makePn(fake, real, run) {
  const span = document.createElement("span");
  span.className = "pn";
  span.contentEditable = "false";
  span.dataset.fake = fake;
  span.dataset.real = real;
  // A piece of a name wrapped across lines: the whole name rides on each
  // piece, for the tooltip, the keep menu and the count.
  if (run && run.whole) {
    span.dataset.wholeFake = run.whole.from;
    span.dataset.wholeReal = run.whole.to;
    span.dataset.piece = run.piece + "/" + run.pieces;
  }
  span.textContent = settings.showFakes ? fake : real;
  markKept(span);
  return span;
}
/** The real value a span stands for — the whole name where the span is one line's piece of it. */
function pnReal(span) { return span.dataset.wholeReal != null ? PK.foldGaps(span.dataset.wholeReal) : span.dataset.real; }
function pnFake(span) { return span.dataset.wholeFake != null ? PK.foldGaps(span.dataset.wholeFake) : span.dataset.fake; }
// A kept value's spans carry the mark that says so: the highlight goes, a
// dotted underline says "left alone on the next run", and the tooltip says
// what the file still carries until then.
function markKept(span) {
  const c = TD.keptControl(keeps, pnReal(span));
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
  textAnchors = null;
  applyMatchedLayout();
  applyLineLock();
  placeCitations();
  paintHighlights();
}
const afterTextChangeSoon = debounce(afterTextChange, 400);
const relayout = debounce(() => { textAnchors = null; applyMatchedLayout(); applyLineLock(); placeCitations(); refitPdf(); if (sbsOn) syncScroll("text", true); }, 150);
window.addEventListener("resize", relayout);

function updateCounts() {
  const all = [...pagesEl.querySelectorAll(".pn")].filter((s) => !s.dataset.piece || s.dataset.piece.startsWith("0/"));
  const n = all.length;
  const k = all.filter((s) => s.classList.contains("kept")).length;
  $("st-pn").textContent = key ? `${n} pseudonym${n === 1 ? "" : "s"} shown as real names` + (k ? ` · ${k} kept (un-faked on the next run)` : "") : "";
}

// ── editing ──────────────────────────────────────────────────────────────────────
pagesEl.addEventListener("input", (e) => {
  const body = e.target && e.target.closest && e.target.closest(".page-body");
  if (!body) return;
  normalizeLines(body);
  setDirty(true);
  offerAtCaret(body);
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


// ── the numbers are the paper: editing between fixed slots ──────────────────────
//
// A page numbered down its margin is edited the way it is read: the numbers
// never move, the TEXT moves between them. Enter sends the text after the
// caret down into the next slot, the slot below takes what was there, and so
// on until an empty slot absorbs the shift (or a new unnumbered line at the
// foot of the page takes the last of it — the file gains a line, nothing is
// lost). Backspace at the start of a line joins it to the line above and
// pulls the run of text below up one slot. Delete at the end of a line is
// the same join from the other side. The decisions are textdoc.shiftDown /
// shiftUp; here they are applied to the DOM by MOVING nodes, so a pseudonym
// span travels intact and the numbers' own spans are never touched. Every
// such edit is saveable: a numbered line that gains text gains the two
// spaces PDF-Linker writes after its number (fixGutterSpacing), so the file
// parses back to the same numbered line — an empty "  7" opened and typed
// into is written " 7  typed text", never " 7typed text".
// A page with no numbered margin edits as plain lines: Enter makes a new
// line block, Backspace at a line's start removes one.
function lineOfNode(body, n) {
  const el = n && (n.nodeType === 1 ? n : n.parentElement);
  const line = el && el.closest && el.closest(".line");
  return line && body.contains(line) ? line : null;
}
/**
 * The caret's line and its point inside that line's .lt. A caret on the
 * page body itself (between lines, or after the last — where a click below
 * the text or a select-all-and-collapse leaves it) is taken to the line it
 * stands beside: the start of the line after it, else the end of the last.
 */
function caretLine(body) {
  const pt = caretIn(body);
  if (!pt) return null;
  let line = lineOfNode(body, pt.container);
  if (line) return { line, pt: pointInLt(line, pt) };
  if (pt.container !== body) return null;
  const lines = [...body.querySelectorAll(":scope > .line")];
  if (!lines.length) return null;
  const kids = [...body.childNodes];
  const next = kids.slice(pt.offset).find((k) => k.nodeType === 1 && k.classList.contains("line"));
  line = next || lines[lines.length - 1];
  const lt = ltOf(line);
  return { line, pt: next ? { container: lt, offset: 0 } : { container: lt, offset: lt.childNodes.length } };
}
function ltOf(line) { return line.querySelector(":scope > .lt"); }
function caretIn(body) {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!sel.isCollapsed || !body.contains(r.startContainer)) return null;
  return { container: r.startContainer, offset: r.startOffset };
}
/** The caret as a point INSIDE a line's .lt: a caret on the number, or on the line itself, is put at the text's edge. */
function pointInLt(line, pt) {
  const lt = ltOf(line);
  if (lt.contains(pt.container)) return pt;
  const before = pt.container === line ? pt.offset <= [...line.childNodes].indexOf(lt) : !!(pt.container.parentElement && pt.container.parentElement.closest(".gutter"));
  return before ? { container: lt, offset: 0 } : { container: lt, offset: lt.childNodes.length };
}
function placeCaret(node, offset) {
  try {
    const r = document.createRange();
    r.setStart(node, offset); r.collapse(true);
    const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  } catch { /* nothing to place in */ }
}
function extractAll(lt) {
  const r = document.createRange(); r.selectNodeContents(lt);
  const frag = r.extractContents();
  for (const br of [...frag.querySelectorAll("br")]) br.remove();
  return frag;
}
function newLineAfter(ref) {
  const line = document.createElement("div");
  line.className = "line";
  const lt = document.createElement("span");
  lt.className = "lt";
  line.appendChild(lt);
  placeholderIn(lt);
  ref.after(line);
  return line;
}
/** A numbered line that has text carries PDF-Linker's two spaces after its number; the DOM keeps that true. */
function fixGutterSpacing(body) {
  for (const line of body.querySelectorAll(".line.num")) {
    const lt = ltOf(line), g = line.querySelector(":scope > .gutter");
    if (!lt || !g || !lt.textContent.length) continue;
    let gs = g.querySelector(".gs");
    if (!gs) { gs = document.createElement("span"); gs.className = "gs"; g.appendChild(gs); }
    if (gs.textContent.length < 2) gs.textContent = "  ";
  }
}
/**
 * Chrome types into whatever box the caret was put in: a click on an empty
 * slot can leave the caret on the LINE rather than its .lt, and the text
 * node then lands beside the .lt instead of inside it; a block emptied by
 * deletion may gain a placeholder <br>, which would serialize as a line. Both
 * are put right, the caret with them.
 */
function normalizeLines(body) {
  const pt = caretIn(body);
  let moved = false;
  for (const line of [...body.querySelectorAll(".line")]) {
    let lt = ltOf(line);
    if (!lt) { lt = document.createElement("span"); lt.className = "lt"; line.appendChild(lt); }
    for (const n of [...line.childNodes]) {
      if (n === lt || (n.nodeType === 1 && n.classList.contains("gutter"))) continue;
      if (n.nodeType === 1 && n.nodeName === "BR") { n.remove(); continue; }
      const before = [...line.childNodes].indexOf(n) < [...line.childNodes].indexOf(lt);
      if (before) lt.insertBefore(n, lt.firstChild); else lt.appendChild(n);
      moved = true;
    }
    placeholderIn(lt);
  }
  for (const n of [...body.childNodes]) {
    // Text typed straight into the body (a page with no line yet) gets a line.
    if (n.nodeType === 1 && n.classList.contains("line")) continue;
    if (n.nodeType === 1 && n.nodeName === "BR") { n.remove(); continue; }
    const line = document.createElement("div"); line.className = "line";
    const lt = document.createElement("span"); lt.className = "lt";
    n.replaceWith(line); line.appendChild(lt); lt.appendChild(n);
    moved = true;
  }
  fixGutterSpacing(body);
  if (moved && pt && pt.container.isConnected) placeCaret(pt.container, Math.min(pt.offset, pt.container.nodeType === 3 ? pt.container.data.length : pt.container.childNodes.length));
}

/** Enter: the text after the caret goes down a slot. */
function enterAtCaret(body, { snap = true } = {}) {
  const cl = caretLine(body);
  if (!cl) return false;
  const { line, pt: at } = cl;
  if (snap) snapshot(body, true);
  const lt = ltOf(line);
  const r = document.createRange();
  r.setStart(at.container, at.offset);
  r.setEnd(lt, lt.childNodes.length);
  let carry = r.extractContents();
  for (const br of [...carry.querySelectorAll("br")]) br.remove();
  let target = null;
  if (!body.classList.contains("numbered")) {
    target = newLineAfter(line);
    ltOf(target).appendChild(carry);
  } else {
    let cur = line.nextElementSibling, placed = false;
    while (cur) {
      const clt = cur.classList.contains("line") ? ltOf(cur) : null;
      if (clt) {
        if (!target) target = cur;
        if (!clt.textContent.length) { clt.appendChild(carry); placed = true; break; }
        const displaced = extractAll(clt);
        clt.appendChild(carry);
        carry = displaced;
      }
      cur = cur.nextElementSibling;
    }
    if (!placed) {
      const foot = newLineAfter(body.lastElementChild);
      ltOf(foot).appendChild(carry);
      if (!target) target = foot;
    }
  }
  for (const l of body.querySelectorAll(".line > .lt")) placeholderIn(l);
  fixGutterSpacing(body);
  placeCaret(ltOf(target), 0);
  setDirty(true);
  afterTextChange();
  return true;
}
/** Backspace at the start of a line: join it to the line above, the run below moves up. */
function joinLineUp(body, line) {
  const prev = line.previousElementSibling;
  if (!prev || !prev.classList.contains("line")) return false;
  snapshot(body, true);
  const plt = ltOf(prev);
  const joinAt = plt.textContent.length;
  plt.appendChild(extractAll(ltOf(line)));
  if (!body.classList.contains("numbered")) line.remove();
  else {
    let cur = line;
    for (;;) {
      const next = cur.nextElementSibling;
      const nlt = next && next.classList.contains("line") ? ltOf(next) : null;
      if (!nlt || !nlt.textContent.length) {
        if (!next && !cur.classList.contains("num")) cur.remove();
        break;
      }
      ltOf(cur).appendChild(extractAll(nlt));
      cur = next;
    }
  }
  for (const l of body.querySelectorAll(".line > .lt")) placeholderIn(l);
  fixGutterSpacing(body);
  const at = pointAtOffset(plt, joinAt);
  placeCaret(at.node, at.offset);
  setDirty(true);
  afterTextChange();
  return true;
}
function backspaceAtCaret(body) {
  const cl = caretLine(body);
  if (!cl) return false;
  const { line, pt: at } = cl;
  const lt = ltOf(line);
  if (offsetOfPoint(lt, at.container, at.offset) !== 0) return false;
  return joinLineUp(body, line) || true; // at the first line there is nothing to join: the number stays
}
function deleteAtCaret(body) {
  const cl = caretLine(body);
  if (!cl) return false;
  const { line, pt: at } = cl;
  const lt = ltOf(line);
  if (offsetOfPoint(lt, at.container, at.offset) !== lt.textContent.length) return false;
  const next = line.nextElementSibling;
  if (!next || !next.classList.contains("line")) return true; // the last line: nothing after it to join
  return joinLineUp(body, next);
}
/** A selection reaching across a line number: an edit over it would take the number with it, so it is refused. */
function selectionCrossesGutter(body) {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  if (!body.contains(r.commonAncestorContainer)) return false;
  for (const g of body.querySelectorAll(".gutter")) if (r.intersectsNode(g)) return true;
  return false;
}
pagesEl.addEventListener("keydown", (e) => {
  if (!editing || e.ctrlKey || e.metaKey || e.altKey) return;
  const body = e.target && e.target.closest && e.target.closest(".page-body");
  if (!body) return;
  if (e.key === "Enter") { e.preventDefault(); hideTypeTip(); enterAtCaret(body); }
  else if (e.key === "Backspace") { if (backspaceAtCaret(body)) e.preventDefault(); }
  else if (e.key === "Delete") { if (deleteAtCaret(body)) e.preventDefault(); }
});
// A paste is typed in line by line, each line break an Enter, so pasted text
// moves between the slots as typed text does.
pagesEl.addEventListener("paste", (e) => {
  const body = e.target && e.target.closest && e.target.closest(".page-body");
  if (!body || !editing) return;
  const text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
  e.preventDefault();
  if (!text) return;
  snapshot(body, true);
  batchEdit = true;
  try {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    lines.forEach((piece, i) => {
      if (piece) document.execCommand("insertText", false, piece);
      if (i < lines.length - 1) enterAtCaret(body, { snap: false });
    });
  } finally { batchEdit = false; }
});

// ── the as-you-type prompt (the Claude extension's, for the page) ────────────────
//
// The moment the caret sits at the end of a just-typed REAL value a prompt
// at the caret names the pseudonym it will carry. Space marks it as an
// autocorrect — the name becomes a pseudonym span (the real name shown, the
// fake underneath and in the file) and the space lands after it; ArrowRight
// marks it without the space; Escape leaves that one alone. A real that
// OPENS a longer real in the key ("Helen" beside "Helen Rasho") is never
// space-swapped — the space may be the middle of the longer name, which is
// offered whole the moment it is finished (PK.swapsOnSpace). The debounced
// converter below stays the net for everything the caret is not on — a
// paste, a name typed and left — and skips the spot Escape dismissed.
const typeTip = $("type-tip");
let typeHit = null;      // { body, node, offset, hit } while the prompt shows
let typeDismissed = null; // { body, end, real } the user Escaped — `end` a text offset in the page, so it survives a rebuild
function textBeforeCaret(pt) {
  if (pt.container.nodeType !== 3) return "";
  let t = pt.container.data.slice(0, pt.offset);
  // Plain text in the same line before this node, up to the last pseudonym span.
  for (let n = pt.container.previousSibling; n && n.nodeType === 3; n = n.previousSibling) t = n.data + t;
  return t;
}
function offerAtCaret(body) {
  hideTypeTip();
  if (!ahead || !editing) return;
  const pt = caretIn(body);
  if (!pt || pt.container.nodeType !== 3 || (pt.container.parentElement && pt.container.parentElement.closest(".pn, .gutter"))) return;
  const tb = textBeforeCaret(pt);
  const hit = PK.endingReal(ahead, tb);
  if (!hit || hit.matched.length > pt.offset) return;
  // The name just typed completes a KEPT value ("Rasho" closing a kept "Helen Rasho"): left as it stands.
  const krx = keptMatcher();
  if (krx) { krx.lastIndex = 0; let m; while ((m = krx.exec(tb))) { if (m.index + m[0].length === tb.length) return; if (m.index === krx.lastIndex) krx.lastIndex++; } }
  if (typeDismissed && typeDismissed.body === body && typeDismissed.end === offsetOfPoint(body, pt.container, pt.offset) && typeDismissed.real === hit.real) return;
  typeHit = { body, node: pt.container, offset: pt.offset, hit };
  typeTip.innerHTML = "";
  const b = document.createElement("b");
  b.textContent = PK.mirrorCase(hit.matched, hit.fake);
  typeTip.append("Pseudonym: ", b);
  const k = document.createElement("span");
  k.className = "keys";
  k.textContent = hit.partial ? " — → marks it; Space types on (it may open a longer name)" : " — Space or → marks it, Esc leaves it";
  typeTip.append(k);
  const rect = document.getSelection().getRangeAt(0).getBoundingClientRect();
  typeTip.hidden = false;
  const w = typeTip.offsetWidth;
  typeTip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left)) + "px";
  typeTip.style.top = (rect.bottom + 6) + "px";
}
function hideTypeTip() { typeTip.hidden = true; typeHit = null; }
/** Mark the value the prompt names as a pseudonym span, `tail` (a space) after it. */
function acceptTyped(tail) {
  const t = typeHit;
  if (!t || !t.node.isConnected) { hideTypeTip(); return false; }
  const { body, node, offset, hit } = t;
  hideTypeTip();
  snapshot(body, true);
  const start = offset - hit.matched.length;
  node.splitText(offset);
  const mid = node.splitText(start);
  const pn = makePn(PK.mirrorCase(hit.matched, hit.fake), hit.matched);
  mid.replaceWith(pn);
  let after = pn.nextSibling;
  if (!after || after.nodeType !== 3) { after = document.createTextNode(""); pn.after(after); }
  if (tail) after.insertData(0, tail);
  placeCaret(after, tail.length);
  setDirty(true);
  afterTextChange();
  toast(`Marked as ${pn.dataset.fake} — the file carries the pseudonym`);
  return true;
}
pagesEl.addEventListener("keydown", (e) => {
  if (!typeHit || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === " " && PK.swapsOnSpace(typeHit.hit)) { if (acceptTyped(" ")) e.preventDefault(); }
  else if (e.key === "ArrowRight") { if (acceptTyped("")) e.preventDefault(); }
  else if (e.key === "Escape") { typeDismissed = { body: typeHit.body, end: offsetOfPoint(typeHit.body, typeHit.node, typeHit.offset), real: typeHit.hit.real }; hideTypeTip(); e.preventDefault(); }
});
document.addEventListener("selectionchange", () => {
  if (!typeHit) return;
  const pt = caretIn(typeHit.body);
  if (!pt || pt.container !== typeHit.node || pt.offset !== typeHit.offset) hideTypeTip();
});
stageEl.addEventListener("scroll", () => { if (typeHit) hideTypeTip(); }, { passive: true });

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
let batchEdit = false; // one snapshot covers a multi-step edit (a paste)

function pageIndexOf(body) { return Number(body.closest(".tpage").dataset.index); }
function caretOffsetIn(body) {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return -1;
  const r = sel.getRangeAt(0);
  if (!body.contains(r.startContainer)) return -1;
  return offsetOfPoint(body, r.startContainer, r.startOffset);
}
// The two walks below count the page's text the way flatten does — a line
// block is a "\n" — so a caret on an element boundary (an empty line, the
// end of a line) has an offset, and an offset has a place to put it.
const BLOCKISH = new Set(["DIV", "P", "LI"]);
function offsetOfPoint(body, container, offset) {
  let off = 0, found = -1;
  const rec = (n, atStart) => {
    if (found >= 0) return;
    if (n.nodeType === 3) { if (n === container) found = off + offset; else off += n.data.length; return; }
    if (n.nodeType !== 1) return;
    if (n.nodeName === "BR") { if (n.nextSibling) off += 1; return; }
    if (BLOCKISH.has(n.nodeName) && !atStart) off += 1;
    const kids = [...n.childNodes];
    for (let i = 0; i < kids.length; i++) {
      if (n === container && i === offset) { found = off; return; }
      rec(kids[i], i === 0 && atStart);
      if (found >= 0) return;
    }
    if (n === container) found = off;
  };
  rec(body, true);
  return found >= 0 ? found : off;
}
/** { node, offset } for a text offset, on an element boundary where no text node holds it. */
function pointAtOffset(body, target) {
  let off = 0, hit = null;
  const rec = (n, atStart) => {
    if (hit) return;
    if (n.nodeType === 3) {
      if (target >= off && target <= off + n.data.length) hit = { node: n, offset: target - off };
      off += n.data.length;
      return;
    }
    if (n.nodeType !== 1) return;
    if (n.nodeName === "BR") { if (n.nextSibling) off += 1; return; }
    if (BLOCKISH.has(n.nodeName) && !atStart) { off += 1; if (target === off) { hit = { node: n, offset: 0 }; return; } }
    let i = 0;
    for (const c of [...n.childNodes]) { rec(c, i === 0 && atStart); if (hit) return; i++; }
  };
  rec(body, true);
  return hit || { node: body, offset: body.childNodes.length };
}
function snapshotOf(body) {
  return { page: pageIndexOf(body), text: TD.serializeNodes(body), caret: caretOffsetIn(body) };
}
/** Record the page as it stands, before an edit; `force` skips coalescing. */
function snapshot(body, force) {
  if (batchEdit) return;
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
  convertTypedRealsSoon.cancel();
  hideTypeTip();
  buildBody(body, snap.text);
  doc.pages[snap.page].lines = snap.text.split("\n");
  if (snap.caret >= 0) {
    const at = pointAtOffset(body, snap.caret);
    try { const r = document.createRange(); r.setStart(at.node, at.offset); r.collapse(true); const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch { /* the caret is simply not restored */ }
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
  if (selectionCrossesGutter(body)) { e.preventDefault(); toast("The line numbers are fixed: edit within a line, or join lines with Backspace at a line's start.", { error: true }); return; }
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
    if (typeDismissed && typeDismissed.body === body && offsetOfPoint(body, h.node, h.end) === typeDismissed.end) continue;
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

// ── line lock ──────────────────────────────────────────────────────────────────────────
//
// Pleading paper is read by its line numbers, and a numbered line that
// WRAPS puts its tail on a screen line with no number — read across to the
// PDF, that is one line off. With the lock on every numbered line is held
// to one screen line, and the page is made AS WIDE AS THE LONGEST LINE
// NEEDS at the size the reader chose — past the window's edge if that is
// what it takes, with a horizontal scroll bar under it, the way a zoomed
// PDF behaves. The font is never touched: zooming in is the reader's to do,
// and the size is what they calibrate the page by. The numbers are never
// touched either — the gutter shows the file's own and nothing moves
// between them. Display only: the settings keep the width the reader
// chose, and the effective width lives in a CSS variable the pages read.
function applyLineLock() {
  const root = document.documentElement.style;
  root.setProperty("--reader-size-eff", settings.fontSize + "px");
  root.setProperty("--reader-width-eff", settings.pageWidth + "px");
  document.body.classList.toggle("line-lock", !!settings.lineLock);
  const st = $("st-lock");
  if (!doc) { st.textContent = ""; return; }
  // Side by side the PDF's own grid holds every line to one screen line
  // already, whatever the lock says: the page is drawn at the reading
  // size's scale and widened for its longest line.
  if (pagesEl.querySelector(".tpage.matched")) {
    st.textContent = "Side by side: the text in the PDF's own type sizes, the size zooming both sheets" + (matchedExtra ? `, ${matchedExtra}px wider for the longest line, scroll sideways` : "");
    return;
  }
  if (!settings.lineLock) { st.textContent = ""; return; }
  const bodies = pageBodies().filter((b) => b.classList.contains("numbered") && !b.closest(".tpage").classList.contains("swapped"));
  if (!bodies.length) { st.textContent = "Line lock: no numbered lines"; return; }
  // Measured line by line: a grid item's text overflow is not in the page
  // body's own scrollWidth.
  const lts = [];
  for (const b of bodies) lts.push(...b.querySelectorAll(".line.num > .lt"));
  const overflow = () => { let o = 0; for (const lt of lts) o = Math.max(o, lt.scrollWidth - lt.clientWidth); return o; };
  let width = settings.pageWidth;
  let over = overflow();
  for (let n = 0; over > 0 && n < 12; n++) {
    width = Math.ceil(width + over + 1);
    root.setProperty("--reader-width-eff", width + "px");
    over = overflow();
  }
  const wider = width > stageEl.clientWidth - 32;
  st.textContent = "Line lock" + (width !== settings.pageWidth ? `: page ${width}px wide for its longest line` + (wider ? " — scroll sideways" : "") : ": every numbered line fits");
}

// ── citations ────────────────────────────────────────────────────────────────────────
/**
 * A page body as one string with a map from offsets back to text nodes: the
 * same walk serializeNodes makes, on the DISPLAYED text, so a citation found
 * in the string can be turned into a DOM Range.
 */
function flatten(body, { blankGutters = false, blankPn = false } = {}) {
  const segs = [];
  let text = "";
  const rec = (n, atStart) => {
    if (n.nodeType === 3) {
      segs.push({ node: n, start: text.length, end: text.length + n.data.length });
      // For DETECTION the pleading gutter number is blanked, length for
      // length: a cite that wraps onto a numbered line otherwise carries a
      // digit run between its volume and its reporter, or between the code
      // and its section, and parses as nothing (the pdf_linker.py rule).
      // A pseudonym span's shown text is blanked the same way for the leak
      // scan: the real name inside it is on top of the file, not in it.
      const p = n.parentElement;
      const blank = (blankGutters && p && p.closest(".gutter")) || (blankPn && p && p.closest(".pn"));
      text += blank ? " ".repeat(n.data.length) : n.data;
      return;
    }
    if (n.nodeType !== 1) return;
    if (n.nodeName === "BR") { if (n.nextSibling) text += "\n"; return; }
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
    if (reals) {
      // Over the whole page, pseudonym spans blanked, so a real name wrapped
      // over a line break and its gutter number is found as one.
      const { text, segs } = flatten(body, { blankPn: true });
      for (const h of PK.findRealSpans(reals, maskKept(text))) {
        const r = rangeFor(segs, h.start, h.end);
        if (!r) continue;
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
  b.textContent = settings.showFakes ? pnReal(pn) : pnFake(pn);
  tipEl.append(settings.showFakes ? "Real name: " : "Pseudonym: ", b);
  if (pn.dataset.piece) tipEl.append(` (wrapped over ${pn.dataset.piece.split("/")[1]} lines; this line: ${settings.showFakes ? pn.dataset.real : pn.dataset.fake})`);
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
  const real = pnReal(pn);
  const c = TD.keptControl(keeps, real);
  $("keep-menu-value").textContent = real;
  $("keep-menu-fake").textContent = pnFake(pn);
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
$("keep-menu-no").addEventListener("click", () => { const r = keepMenuFor && pnReal(keepMenuFor); hideKeepMenu(); if (r) setKeep(r, "no"); });
$("keep-menu-never").addEventListener("click", () => { const r = keepMenuFor && pnReal(keepMenuFor); hideKeepMenu(); if (r) setKeep(r, "never"); });
$("keep-menu-undo").addEventListener("click", () => { const r = keepMenuFor && pnReal(keepMenuFor); hideKeepMenu(); if (r) setKeep(r, ""); });
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
    const info = { pdf, count: pdf.numPages, sizes, name: src.name, lines: sizes.map(() => null), geoms: sizes.map(() => null), rows: sizes.map(() => null) };
    // Where each page's FIRST printed line sits (the side-by-side anchor)
    // and its LINE GRID (pdfsync.pleadingGeometry, from the numbers down its
    // margin): read in the background, the pane re-aligning as it lands.
    (async () => {
      for (let i = 1; i <= pdf.numPages; i++) {
        try {
          const tc = await (await pdf.getPage(i)).getTextContent();
          const sz = sizes[i - 1];
          const items = [];
          let top = Infinity;
          for (const it of tc.items) {
            if (!it.str || !it.transform) continue;
            const t = sz.h - (it.transform[5] + (it.height || 0));
            if (it.str.trim() && t >= 0 && t < top) top = t;
            items.push({ str: it.str, x: it.transform[4], top: t, w: it.width || 0, h: it.height || 0 });
          }
          info.lines[i - 1] = isFinite(top) ? top : null;
          info.geoms[i - 1] = PS.pleadingGeometry(items, sz);
          info.rows[i - 1] = PS.pdfRows(items, sz);
        } catch { info.lines[i - 1] = null; }
      }
      if (sbsOn && !pdfPane.hidden) { applyMatchedLayout(); syncScroll("text", true); }
    })();
    return info;
  })();
  pdfCache.set(src.name, p);
  p.then((info) => { p.__info = info; }).catch(() => pdfCache.delete(src.name));
  return p;
}
const PDF_LINE_DEFAULT = 72 / 792; // an inch down a letter page, until the PDF says
/** A slot's first printed line, in px from the slot's top, from the PDF loaded so far. */
/** The loaded PDF behind a source, or null while it is still loading. */
function infoFor(src) {
  try { const p = src && pdfCache.get(src.name); return p && p.__info ? p.__info : null; } catch { return null; }
}
/** The box a slot renders its page into (under its label, where it has one). */
function sheetOf(el) { return el.querySelector(".pdf-sheet") || el; }
function pdfFirstLine(el) {
  const src = pdfSources[Number(el.dataset.index)];
  const page = Number(el.dataset.page);
  const sheet = sheetOf(el);
  const base = sheet === el ? 0 : sheet.offsetTop;
  const w = sheet.clientWidth || paneWidth();
  const info = infoFor(src);
  const sz = info && info.sizes[page - 1];
  const y = info && info.lines[page - 1];
  if (sz && y != null) return base + (y * w) / sz.w;
  return base + (sz ? (PDF_LINE_DEFAULT * sz.h * w) / sz.w : sheet.clientHeight * PDF_LINE_DEFAULT);
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
  const cssScale = cssWidth / base.width;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const vp = page.getViewport({ scale: cssScale * dpr });
  const sheet = sheetOf(el);
  const canvas = sheet.querySelector("canvas");
  if (el.__task) { try { el.__task.cancel(); } catch { /* done */ } }
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  canvas.style.width = cssWidth + "px";
  canvas.style.height = Math.round(vp.height / dpr) + "px";
  sheet.style.height = "";
  const task = page.render({ canvasContext: canvas.getContext("2d"), viewport: vp });
  el.__task = task;
  try { await task.promise; } catch (e) { if (!(e && e.name === "RenderingCancelledException")) console.warn(e); return; }
  finally { if (el.__task === task) el.__task = null; }
  if (el.dataset.want !== want) return;
  el.dataset.rendered = want;
  el.classList.add("ready");
  // The page's text, selectable over the bitmap (pdf.js's own text layer).
  const layer = sheet.querySelector(".textLayer");
  if (layer) {
    if (el.__text) { try { el.__text.cancel(); } catch { /* done */ } el.__text = null; }
    layer.innerHTML = "";
    layer.style.setProperty("--scale-factor", String(cssScale));
    layer.style.setProperty("--total-scale-factor", String(cssScale));
    try {
      const tl = new pdfjsLib.TextLayer({ textContentSource: await page.getTextContent(), container: layer, viewport: page.getViewport({ scale: cssScale }) });
      if (el.dataset.want !== want) return;
      el.__text = tl;
      await tl.render();
      if (el.__text === tl) el.__text = null;
      if (el.dataset.want === want) { blankLineNumbers(layer); bindSelection(layer); }
    } catch (e) { if (!(e && e.name === "AbortException")) console.warn(e); }
  }
}

// ── selecting in the PDF's text ──
//
// pdf.js lays a page's text out as absolutely positioned spans in an
// otherwise empty box, and the browser has nowhere sensible to put a
// selection that begins or ends BETWEEN them: a drag started in the margin
// before a sentence, or let go in the space after its period, anchors at
// an arbitrary place in the layer's DOM (Chrome walks its children by
// height, not by row), and the clipboard gets the line below, or the
// numbers down the side. So the drag is the reader's own. Every point the
// pointer visits is snapped to the nearest character ON ITS OWN ROW — into
// the span under it, or to the near edge of the closest span beside it —
// and the selection is set between the two snapped carets; a double click
// takes the word, a triple the row. The browser still paints the selection
// and Ctrl+C still copies it. A click with a modifier is left to the
// browser.
function bindSelection(layer) {
  if (layer.__selecting) return;
  layer.__selecting = true;
  layer.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = caretInLayer(layer, e.clientX, e.clientY);
    if (!a) return;
    e.preventDefault();
    const sel = document.getSelection();
    if (e.detail >= 2) { const r = e.detail === 2 ? wordAround(a) : rowAround(layer, a); if (r) sel.setBaseAndExtent(r.startContainer, r.startOffset, r.endContainer, r.endOffset); return; }
    sel.setBaseAndExtent(a.node, a.offset, a.node, a.offset);
    const box = layer.closest("#pdf-pane") || stageEl;
    const move = (ev) => {
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const at = (under && under.closest && under.closest(".textLayer")) || layer;
      const f = caretInLayer(at, ev.clientX, ev.clientY) || caretInLayer(layer, ev.clientX, ev.clientY);
      if (f) sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
      // Past the box's edge the page follows the pointer, as a native drag would.
      const br = box.getBoundingClientRect();
      if (ev.clientY > br.bottom - 16) box.scrollTop += 14;
      else if (ev.clientY < br.top + 16) box.scrollTop -= 14;
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
}
/** The text spans of a layer with their boxes, in DOM order: [{ span, node, rect }]. A span of bare space (pdf.js writes one for a gap) is nothing to snap to. */
function layerSpans(layer) {
  const out = [];
  for (const sp of layer.querySelectorAll("span")) {
    const node = sp.firstChild;
    if (!node || node.nodeType !== 3 || !node.data.trim()) continue;
    const rect = sp.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) out.push({ span: sp, node, rect });
  }
  return out;
}
/**
 * The caret nearest a point, on the point's own row: { node, offset } in a
 * span's text, or null where the layer has no text. The row is the span
 * whose box holds the point's height, else the nearest by height; the span
 * on it the one under the point, else the nearest beside it, entered at
 * the edge the point is on.
 */
function caretInLayer(layer, x, y) {
  const spans = layerSpans(layer);
  if (!spans.length) return null;
  const vdist = (r) => (y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0);
  let rowD = Infinity;
  for (const s of spans) rowD = Math.min(rowD, vdist(s.rect));
  const row = spans.filter((s) => vdist(s.rect) <= rowD + 0.5);
  const hdist = (r) => (x < r.left ? r.left - x : x > r.right ? x - r.right : 0);
  let best = row[0];
  for (const s of row) if (hdist(s.rect) < hdist(best.rect)) best = s;
  const { node, rect } = best;
  if (x <= rect.left) return { node, offset: 0 };
  if (x >= rect.right) return { node, offset: node.data.length };
  // Inside the span: the browser's own caret at the point, held to this span.
  const cy = rect.top + rect.height / 2;
  try {
    if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, cy); if (p && p.offsetNode === node) return { node, offset: p.offset }; }
    else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, cy); if (r && r.startContainer === node) return { node, offset: r.startOffset }; }
  } catch { /* fall through to the proportional guess */ }
  return { node, offset: Math.max(0, Math.min(node.data.length, Math.round(((x - rect.left) / rect.width) * node.data.length))) };
}
/** The word around a caret, as a Range. */
function wordAround(a) {
  const t = a.node.data;
  let s = a.offset, e = a.offset;
  while (s > 0 && /\S/.test(t[s - 1])) s--;
  while (e < t.length && /\S/.test(t[e])) e++;
  if (s === e) return null;
  const r = document.createRange(); r.setStart(a.node, s); r.setEnd(a.node, e);
  return r;
}
/** The row a caret is on — every span at that height, first to last — as a Range. */
function rowAround(layer, a) {
  const spans = layerSpans(layer);
  const me = spans.find((s) => s.node === a.node);
  if (!me) return null;
  const cy = me.rect.top + me.rect.height / 2;
  const row = spans.filter((s) => s.rect.top <= cy && cy <= s.rect.bottom).sort((p, q) => p.rect.left - q.rect.left);
  const r = document.createRange(); r.setStart(row[0].node, 0); r.setEnd(row[row.length - 1].node, row[row.length - 1].node.data.length);
  return r;
}
/**
 * Pleading paper's line numbers, blanked in the text layer so a drag across
 * the body never sweeps them in: the number spans stand between the body's
 * in DOM order, and a selection dragged from the margin runs through them —
 * "1 2 3 4" on the clipboard where the line was wanted. The numbers stay on
 * the bitmap. The PDF viewer's own rule (excludeLineNumberColumn), read the
 * same conservative way: a tall left-margin column of many bare 1–2 digit
 * numbers, never a stray number in the body.
 */
function blankLineNumbers(layer) {
  const spans = layer.querySelectorAll("span");
  const W = layer.offsetWidth || 1, H = layer.offsetHeight || 1;
  if (spans.length < 8 || !layer.offsetHeight) return;
  const cand = [];
  for (const sp of spans) {
    const t = (sp.textContent || "").trim();
    if (!/^\d{1,2}$/.test(t) || sp.offsetLeft > W * 0.25) continue;
    cand.push({ sp, left: sp.offsetLeft, top: sp.offsetTop });
  }
  if (cand.length < 8) return;
  cand.sort((a, b) => a.left - b.left);
  let best = [], group = [];
  for (const c of cand) {
    if (group.length && c.left - group[0].left > 16) { if (group.length > best.length) best = group; group = []; }
    group.push(c);
  }
  if (group.length > best.length) best = group;
  if (best.length < 8) return;
  const tops = best.map((c) => c.top);
  if (Math.max(...tops) - Math.min(...tops) < H * 0.4) return;
  for (const c of best) c.sp.textContent = "";
}
function releaseCanvas(el) {
  if (!el.dataset.rendered) return;
  const sheet = sheetOf(el);
  const canvas = sheet.querySelector("canvas");
  // Keep the box its size, drop the bitmap and the text.
  sheet.style.height = canvas.style.height;
  canvas.width = canvas.height = 0;
  canvas.style.height = "0px";
  const layer = sheet.querySelector(".textLayer");
  if (el.__text) { try { el.__text.cancel(); } catch { /* done */ } el.__text = null; }
  if (layer) layer.innerHTML = "";
  delete el.dataset.rendered;
  el.classList.remove("ready");
}
/**
 * A slot: for the pane, a page label like the text page's (so the two are
 * the same size, label and all) over a sheet holding the bitmap and the
 * text layer; for a swapped-in page, the sheet alone with a corner tag.
 */
function slotShell(cls, tag, { label = false } = {}) {
  const el = document.createElement("div");
  el.className = cls;
  const sheet = document.createElement("div");
  sheet.className = "pdf-sheet";
  const t = document.createElement("div");
  if (label) {
    t.className = "page-label pdf-label";
    t.textContent = tag;
    el.appendChild(t);
  } else {
    t.className = "pdf-tag";
    t.textContent = tag;
    sheet.appendChild(t);
  }
  const c = document.createElement("canvas");
  const layer = document.createElement("div");
  layer.className = "textLayer";
  const w = document.createElement("div");
  w.className = "pdf-wait";
  w.textContent = "Loading…";
  sheet.append(c, layer, w);
  el.appendChild(sheet);
  return el;
}
/** The height a page box should have before its bitmap arrives, from the PDF's page sizes. */
async function presize(el, src, pageNo, cssWidth) {
  try {
    const info = await loadPdf(src);
    const sz = info.sizes[pageNo - 1];
    if (sz && !el.dataset.rendered) sheetOf(el).style.height = Math.round((cssWidth * sz.h) / sz.w) + "px";
    if (el.classList.contains("pdf-slot")) { applyMatchedLayout(); syncScroll("text", true); }
  } catch { /* the render reports it */ }
}
const paneObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    const el = en.target;
    // The slot's own width: beside a matched text page that is the PDF
    // page's scale, which the reading size sets, not the pane's.
    if (en.isIntersecting) renderInto(el, pdfSources[Number(el.dataset.index)], Number(el.dataset.page), parseFloat(el.style.width) || paneWidth());
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
      el = slotShell("pdf-slot", "PDF p. " + t.page + (pdfSourceNames().length > 1 ? " · " + t.src.name : ""), { label: true });
      el.dataset.page = String(t.page);
      sheetOf(el).style.height = Math.round(w * 11 / 8.5) + "px"; // letter, until the PDF says
      presize(el, t.src, t.page, w);
      paneObserver.observe(el);
    }
    el.dataset.index = String(i);
    el.style.width = t ? w + "px" : "";
    pdfPane.appendChild(el);
  });
  applyMatchedLayout();
  syncScroll("text", true);
}

// ── the text page on the PDF page's own grid ──
//
// Beside its PDF page a text page takes that page's GEOMETRY: the sheet the
// same width and height (label and all, so the two are one size to the
// eye), and — where the PDF's text layer carries the pleading numbers down
// its margin — each numbered line placed at ITS number's own height on the
// PDF, the body starting at the PDF's text margin, the leading the PDF's
// own pitch. Line 7 of the text then stands exactly beside line 7 of the
// PDF, whatever the page's furniture. A page with no numbers (an exhibit, a
// letter, an order) is laid out on the PDF's printed ROWS instead: each
// text line is matched to the row that carries its words (pdfsync.rowLayout,
// in order, the way a diff matches) and takes that row's own top and left,
// so its paragraphs and headings sit where the PDF's do. Only where nothing
// matches at all (a scan with no text layer) does the page keep its flowing
// layout, inside a sheet of the PDF page's height.
//
// THE SIZE IS THE SCALE, AND THE PDF'S TYPE SETS THE TEXT'S. A page is a
// page: the type keeps its own spacing whatever size it is set at, the way
// a PDF does. The reading size is the size of the BODY type: the PDF's
// body drawn at that size fixes the scale (pdfsync.matchedScale), and the
// sheet, its margins, the line grid and the PDF page beside it are all
// drawn at that scale — so the two are one size to the eye at any zoom,
// and setting the size up GROWS BOTH SHEETS instead of pushing the lines
// together; a page too wide for its pane runs past the edge and the
// scroll bar underneath reaches it. Where the PDF's type varies, each line
// takes its own row's size (a heading larger, a footnote or an exhibit's
// small print smaller; pdfsync.typeSizes), so a page of tight rows fits
// them. The leading setting has no say here: the PDF's rows are the
// leading.
// A line too long for the PDF's own column is never wrapped either (a
// wrapped line would fall on the slot below it): the sheet widens by what
// the longest one needs, and the stage scrolls sideways.
// Display only — no line moves in the file, and the layout is lifted the
// moment the pane closes.
let matchedExtra = 0; // px the sheets were widened for their longest line
const LINE_BOX = 1.2;  // a line's box, in its own type size: what the next line must clear
/** A pane slot at a width: re-rendered where its bitmap is up, pre-sized where it is not. */
function fitSlot(el, w) {
  const prev = parseFloat(el.style.width);
  if (prev > 0 && Math.abs(prev - w) < 0.5) return;
  el.style.width = w + "px";
  const src = pdfSources[Number(el.dataset.index)];
  const page = Number(el.dataset.page);
  if (!src || !page) return;
  // A render already up, or on its way, is redone at the new width (the
  // one in flight lands at the old one otherwise, cropped by the sheet).
  if (el.dataset.rendered || el.dataset.want) renderInto(el, src, page, w);
  else presize(el, src, page, w);
}
function applyMatchedLayout() {
  const on = sbsOn && !pdfPane.hidden;
  const plans = [];
  const matchedSlots = new Set();
  for (const sec of pagesEl.querySelectorAll(".tpage")) {
    const i = Number(sec.dataset.index);
    const slot = on ? pdfPane.querySelector(`.pdf-slot[data-index="${i}"]:not(.blank)`) : null;
    const t = slot && pdfTarget(i);
    const info = t && infoFor(t.src);
    const sz = info && info.sizes[t.page - 1];
    if (!slot || !sz) { clearMatched(sec); continue; }
    const body = sec.querySelector(".page-body");
    const lines = [...body.querySelectorAll(":scope > .line")];
    const geom = info.geoms[t.page - 1];
    const rows = info.rows[t.page - 1];
    const numbered = !!geom && body.classList.contains("numbered");
    let tops = null, lefts = null, sizes = null, pitch = 0;
    // The body type: the page's own, else (numbers with no body read) the
    // reader's leading filling the pitch, as it does off the grid.
    let base = PS.pageTypeSize(rows);
    if (numbered) {
      tops = PS.slotTops(lines.map((l) => ({ num: l.classList.contains("num") ? parseInt(l.querySelector(".gn").textContent, 10) : null })), geom);
      pitch = geom.pitch;
      if (!base) base = pitch / (Number(settings.lineHeight) || 1.5);
      sizes = PS.typeSizes(lines.map(() => null), base);
    } else {
      const lay = rows && rows.length ? PS.rowLayout(lines.map((l) => l.textContent), rows) : null;
      if (lay) {
        tops = lay.positions.map((p) => (p ? p.top : null));
        lefts = lay.positions.map((p) => (p ? p.left : null));
        pitch = lay.pitch;
        if (!base) base = pitch / (Number(settings.lineHeight) || 1.5);
        sizes = PS.typeSizes(lay.positions.map((p) => (p ? p.size : null)), base);
      }
    }
    // Never on top of each other: a row the PDF (a scan's text layer, most
    // often) prints closer under the one above than that line's box is tall
    // is pushed down to clear it, and out of register with the PDF by that
    // much — reading the text beats lining it up (pdfsync.spreadTops).
    const boxes = sizes ? sizes.map((h) => h * LINE_BOX) : null;
    if (tops) tops = PS.spreadTops(tops, boxes);
    // No grid to draw to (a scan with no text layer): the page keeps its
    // flowing layout at the pane's own scale.
    const scale = PS.matchedScale(base, settings.fontSize) || paneWidth() / sz.w;
    matchedSlots.add(slot);
    plans.push({ sec, slot, sz, body, lines, geom: numbered ? geom : null, tops, lefts, sizes, boxes, pitch, scale });
  }
  // Every slot the layout did not claim keeps the pane's own width.
  if (on) for (const el of pdfPane.querySelectorAll(".pdf-slot:not(.blank)")) if (!matchedSlots.has(el)) fitSlot(el, paneWidth());
  document.body.classList.toggle("matched-pages", plans.length > 0);
  for (const p of plans) {
    const w = Math.round(p.sz.w * p.scale);
    fitSlot(p.slot, w);
    p.sec.classList.add("matched");
    p.sec.style.width = w + "px";
    // The PDF page's height — or more, where a pushed line runs past its foot.
    let foot = 0;
    if (p.tops) p.tops.forEach((y, k) => { if (y != null) foot = Math.max(foot, y + p.boxes[k] + p.pitch); });
    p.sec.querySelector(".page-inner").style.height = Math.round(Math.max(p.sz.h, foot) * p.scale) + "px";
    p.body.classList.toggle("fixed", !!p.tops);
    if (p.geom) p.sec.style.setProperty("--body-x", (p.geom.bodyX * p.scale) + "px");
    else p.sec.style.removeProperty("--body-x");
    p.lines.forEach((l, k) => {
      const top = p.tops ? p.tops[k] : null;
      if (top == null) { l.style.top = ""; l.style.left = ""; l.style.lineHeight = ""; l.style.fontSize = ""; return; }
      l.style.top = (top * p.scale) + "px";
      l.style.left = p.lefts && p.lefts[k] != null ? (p.lefts[k] * p.scale) + "px" : "";
      l.style.fontSize = (p.sizes[k] * p.scale) + "px";
      l.style.lineHeight = (p.boxes[k] * p.scale) + "px";
    });
  }
  // The longest line: the sheets grow by what it needs, all of them by the
  // same amount so the pages stay one size. Measured line by line — a grid
  // item's overflow is not in the page body's own scrollWidth.
  matchedExtra = 0;
  const laid = plans.filter((p) => p.tops);
  if (laid.length) {
    const lts = [];
    for (const p of laid) lts.push(...p.body.querySelectorAll(":scope > .line > .lt"));
    const overflow = () => { let o = 0; for (const lt of lts) o = Math.max(o, lt.scrollWidth - lt.clientWidth); return o; };
    let over = overflow();
    for (let n = 0; over > 0 && n < 6; n++) {
      matchedExtra = Math.ceil(matchedExtra + over + 1);
      for (const p of plans) p.sec.style.width = (Math.round(p.sz.w * p.scale) + matchedExtra) + "px";
      over = overflow();
    }
  }
  textAnchors = null;
}
function clearMatched(sec) {
  if (!sec.classList.contains("matched")) return;
  sec.classList.remove("matched");
  sec.style.width = "";
  sec.style.removeProperty("--body-x");
  sec.querySelector(".page-inner").style.height = "";
  const body = sec.querySelector(".page-body");
  body.classList.remove("fixed");
  for (const l of body.querySelectorAll(":scope > .line")) { l.style.top = ""; l.style.left = ""; l.style.lineHeight = ""; l.style.fontSize = ""; }
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
// other follows. The place is measured from each page's FIRST PRINTED LINE
// — the text page's first line of text below its label, the PDF page's
// first line of type below its top margin — so the two top lines line up,
// and between two pages' first lines the boxes move in proportion. A
// follow lands a scroll event of its own, which is ignored while the lead
// is fresh.
let syncLead = null, syncTimer = 0;
let textAnchors = null; // memo: the text pages' first lines, reset on any relayout
function pageGeometry(box, sel) {
  const els = [...box.querySelectorAll(sel)];
  return { tops: els.map((e) => e.offsetTop), heights: els.map((e) => e.offsetHeight) };
}
function firstLineOffset(sec) {
  const top = sec.getBoundingClientRect().top;
  for (const l of sec.querySelectorAll(".line")) {
    if (l.textContent.trim()) return l.getBoundingClientRect().top - top;
  }
  const body = sec.querySelector(".page-body");
  return body ? body.getBoundingClientRect().top - top : 0;
}
function textGeometry() {
  const secs = [...pagesEl.querySelectorAll(".tpage")];
  if (!secs.length) return { tops: [], heights: [] };
  if (!textAnchors || textAnchors.length !== secs.length) textAnchors = secs.map((sec) => sec.offsetTop + firstLineOffset(sec));
  const last = secs[secs.length - 1];
  return PS.anchorGeometry(textAnchors, last.offsetTop + last.offsetHeight);
}
function pdfGeometry() {
  const slots = [...pdfPane.querySelectorAll(".pdf-slot")];
  if (!slots.length) return { tops: [], heights: [] };
  const anchors = slots.map((el) => el.offsetTop + (el.classList.contains("blank") ? 0 : pdfFirstLine(el)));
  const last = slots[slots.length - 1];
  return PS.anchorGeometry(anchors, last.offsetTop + last.offsetHeight);
}
function syncScroll(from, force) {
  if (!sbsOn || pdfPane.hidden) return;
  if (!force && syncLead && syncLead !== from) return;
  syncLead = from;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncLead = null; }, 120);
  const [a, b] = from === "text" ? [stageEl, pdfPane] : [pdfPane, stageEl];
  const ga = from === "text" ? textGeometry() : pdfGeometry();
  const gb = from === "text" ? pdfGeometry() : textGeometry();
  if (!ga.tops.length || !gb.tops.length) return;
  const target = PS.scrollTopFor(PS.scrollPosition(a.scrollTop, ga.tops, ga.heights), gb.tops, gb.heights);
  if (Math.abs(b.scrollTop - target) > 1) b.scrollTop = target;
  // Not sideways: the text sheet is widened for its longest line and its
  // margins are not the PDF's, so one box's run is not the other's. Each
  // scrolls sideways on its own.
}
stageEl.addEventListener("scroll", () => syncScroll("text"), { passive: true });
pdfPane.addEventListener("scroll", () => syncScroll("pdf"), { passive: true });

/** Widths changed (a resize, the panel): re-fit every shown PDF page. */
function refitPdf() {
  if (!doc) return;
  // The pane's widths belong to the matched layout: beside a text page a
  // slot is drawn at the PDF page's own scale, and only a slot the layout
  // does not claim falls back to the pane's width.
  if (!pdfPane.hidden) applyMatchedLayout();
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
// For the smoke test: the geometry the side-by-side sync reads.
window.__textReaderSyncGeometry = () => ({ text: textGeometry(), pdf: pdfGeometry() });

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
