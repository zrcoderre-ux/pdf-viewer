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
//   PDF-Linker reads on its next pass and then deletes — the file gone is the
//   run saying it applied the list, and the reader clears those values.
//   LEAKS. PDF-Linker's LEAKS.xlsx, the leak-triage worksheet, is worked row
//   by row: the row in a bar above the text, the text opened at its page and
//   line, the decision written into the row's own Fix? cell.
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
import * as LK from "./leaks.js";
import * as XW from "./xlsx-write.js";
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
const SPOTS_PREFIX = "textReader.spots.";
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
let handed = [];             // …and what the last save into the case folder handed the run
let spots = [];              // spot keeps for the open document: [{ page, value, nth }]
let masterKeeps = [];        // standing keeps from PDF-Linker's master workbook (its KEEP sheet)
let masterInfo = null;       // { name, sheet, rows, partial } once it is attached
let masterHandle = null;     // its file handle, remembered between sessions
let masterNeeds = null;      // …the same handle, when the browser wants it re-authorised first
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
const SIDE_TABS = [["tab-docs", "side-docs"], ["tab-flags", "side-flags"], ["tab-leaks", "side-leaks"]];
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

// Every keep in force: this case's own, and the standing ones the master
// workbook carries between cases (see attachMaster). The master's are consulted
// wherever a keep is consulted and written nowhere — PDF-Linker already holds
// them, and New Real Values.txt is for this case's decisions.
function allKeeps() { return masterKeeps.length ? keeps.concat(masterKeeps) : keeps; }
/** Which list a value is kept by: "case", "master", or "". */
function keptBy(value) {
  if (TD.keptControl(keeps, value)) return "case";
  return TD.keptControl(masterKeeps, value) ? "master" : "";
}
// The key with the kept values taken out of its FORWARD side: a value the
// operator has said was wrongly faked may stand in the text as itself, so a
// save neither rewrites it to the fake nor refuses over it. The reverse side
// is untouched — the fake still in the file still shows as the real value.
function keyLessKeeps(k) {
  const kept = allKeeps();
  if (!k || !kept.length) return k;
  return Object.assign({}, k, { warn: (k.warn || []).filter((w) => !TD.keptControl(kept, w.real)) });
}
// An occurrence of a kept value is blanked (same length, a non-word
// character) before the forward side looks at the text, so a kept
// "Helen Rasho" is not rewritten through its own "Helen" and "Rasho" rows.
// One matcher per set of keeps, not per call: the master workbook can hold
// hundreds of values, the matcher over them is a big alternation to compile,
// and a save or a repaint asks for it once per page. Both lists are replaced
// rather than edited in place whenever they change, so their identity is the
// whole test.
let keptRxMemo = { keeps: null, master: null, rx: null };
function keptMatcher() {
  if (keptRxMemo.keeps !== keeps || keptRxMemo.master !== masterKeeps) {
    const kept = allKeeps();
    keptRxMemo = { keeps, master: masterKeeps, rx: kept.length ? PK.buildMatcher(kept.map((k) => k.value)) : null };
  }
  return keptRxMemo.rx;
}
// Does a kept value carry anything the key binds? `reals` cannot answer it —
// the kept values are taken out of the key's forward side, which is the whole
// point of a keep — so the question goes to the key's own warning rows, every
// one of them, through a matcher of their own.
//
// CONTAINS, not equals: a keep is usually a phrase around the bound word, and
// the phrase is what makes it safe. The master workbook keeps "David W.
// Slayton" while the key binds "David"; that keep is worth marking exactly
// because the "David" inside it would otherwise have been faked.
let keyBindsMemo = { key: null, rx: null };
function keyBinds(value) {
  if (keyBindsMemo.key !== key) {
    const reals = ((key && key.warn) || []).map((w) => w.real).filter(Boolean);
    keyBindsMemo = { key, rx: reals.length ? PK.buildMatcher(reals) : null };
  }
  const rx = keyBindsMemo.rx;
  if (!rx) return false;
  rx.lastIndex = 0; // a global matcher carries its place between tests
  return rx.test(String(value == null ? "" : value));
}
// The keeps worth MARKING: the ones the key binds. A keep is worth seeing
// because it says "this name was left alone on purpose" — which only means
// something where the name would otherwise have been faked or flagged. The
// master workbook carries the settled decisions of every other matter too
// ("Court", "Clerk", "County"), and marking those here would underline half
// the page to no purpose: nothing was ever going to flag them in this case.
// Masking (see maskKept) still covers every keep; only the marks are narrowed.
let keptMarkMemo = { keeps: null, master: null, key: null, rx: null };
function keptMarkMatcher() {
  if (keptMarkMemo.keeps !== keeps || keptMarkMemo.master !== masterKeeps || keptMarkMemo.key !== key) {
    const mine = allKeeps().filter((k) => keyBinds(k.value));
    keptMarkMemo = { keeps, master: masterKeeps, key, rx: mine.length ? PK.buildMatcher(mine.map((k) => k.value)) : null };
  }
  return keptMarkMemo.rx;
}
function maskKept(text) {
  const rx = keptMatcher();
  return rx ? text.replace(rx, (m) => "\u0000".repeat(m.length)) : text;
}
/**
 * real → fake over `text`, kept occurrences left exactly as they stand: the
 * values kept for the whole case, and the ranges `held` names — the spot keeps,
 * whose places in this very text the caller read off the page.
 */
function forwardText(text, held) {
  const runs = PK.forwardRuns(fwd, TD.blankRanges(maskKept(text), held || []));
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
  ahead = k ? PK.compileTypeahead(k, allKeeps().map((x) => x.value)) : null;
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
const FILES_STORE = "files"; // single files the reader keeps between sessions: the master workbook

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("no IndexedDB"));
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DIRS_STORE)) db.createObjectStore(DIRS_STORE);
      if (!db.objectStoreNames.contains(FILES_STORE)) db.createObjectStore(FILES_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function rememberFile(name, handle) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(FILES_STORE, "readwrite");
      tx.objectStore(FILES_STORE).put(handle, name);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* simply not remembered */ }
}
async function rememberedFile(name) {
  try {
    const db = await openDb();
    const out = await new Promise((resolve, reject) => {
      const req = db.transaction(FILES_STORE, "readonly").objectStore(FILES_STORE).get(name);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return out && out.kind === "file" ? out : null;
  } catch { return null; }
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
  const found = { keyHandle: null, valuesHandle: null, leaksHandle: null, combined: null, textDir: null, docs: [], rootDocs: [], pdfs: [] };
  for await (const [name, entry] of h.entries()) {
    if (entry.kind === "file") {
      if (/\.pdf$/i.test(name) && !/_temp\.pdf$/i.test(name)) found.pdfs.push({ name, handle: entry });
      else if (TD.isKeyName(name) && !found.keyHandle) found.keyHandle = entry;
      // The leak worksheet: the current name over the legacy one PDF-Linker still reads.
      else if (LK.isLeaksName(name) && (!found.leaksHandle || LK.leaksRank(name) < LK.leaksRank(found.leaksHandle.name))) found.leaksHandle = entry;
      // Combined Text.txt sits in the case folder itself, not in Text Files.
      else if (TD.isCombinedName(name)) found.combined = { name, handle: entry, combined: true };
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
  // The combined file, when the folder has one, listed first: it is the one
  // file holding every export, and the one the drafting model was handed.
  folderDocs = found.combined ? [found.combined].concat(found.docs) : found.docs;
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
  handed = stored.handed;
  let applied = [];
  if (found.valuesHandle) {
    try {
      const onDisk = TD.parseReaderFile(await (await found.valuesHandle.getFile()).text());
      for (const v of onDisk.values) flagged = TD.addValue(flagged, v);
      for (const k of onDisk.keeps) if (!TD.keptControl(keeps, k.value)) keeps = TD.addKeep(keeps, k.control, k.value);
    } catch { /* unreadable: the in-memory list stands */ }
  } else if (handed.length) {
    // The file was written into this folder and is not there now: PDF-Linker
    // deletes it on the run that applies it, so those values are faked in the
    // exports and come off the list. Anything flagged since that save stays.
    const after = TD.valuesApplied({ values: flagged, keeps, handed });
    flagged = after.values;
    keeps = after.keeps;
    applied = after.applied;
    handed = [];
  }
  persistValues();
  compileKey();
  renderFlags();
  renderDocList();
  // Said even on a quiet attach: the list emptying is the operator's own
  // work being retired, not folder housekeeping to pass over in silence.
  if (applied.length) {
    toast(`PDF-Linker has taken ${TD.VALUES_FILE} from ${folderName}: ${applied.length} flagged value${applied.length === 1 ? " is" : "s are"} faked in these exports now, and off the list.`,
      { ms: 6000 });
  }
  // The folder's own leak worksheet, attached as its key is; one from
  // another folder is dropped, since its rows name that folder's files.
  if (found.leaksHandle) {
    try {
      const f = await found.leaksHandle.getFile();
      const parsed = await attachLeaks(new Uint8Array(await f.arrayBuffer()), f.name, found.leaksHandle, { quiet: true, folder: folderName });
      if (parsed && !quiet) {
        const und = LK.undecidedCount(parsed.rows);
        toast(`${f.name}: ${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"}` + (und ? `, ${und} undecided — ⚠ Leaks to review them.` : ", every row decided."));
      }
    } catch (e) { toast("The folder's LEAKS.xlsx could not be read: " + (e.message || e), { error: true }); }
  } else if (leaks && leaks.folder && leaks.folder !== folderName) {
    persistLeaks(); // remembered for the folder it belongs to
    dropLeaks();
  }
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
  spots = TD.normalizeSpots(lsGet(spotStoreKey(), []));
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
    await openFolderDoc(folderDocs.find((d) => d.quarantined) || folderDocs.find((d) => !d.combined) || folderDocs[0]);
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
    if (d.combined) {
      const t = document.createElement("span");
      t.className = "tag combined";
      t.textContent = "all";
      t.title = "Every export in one file, each behind its own DOCUMENT banner — its PDFs are matched document by document";
      li.appendChild(t);
    }
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
      } else if (LK.isMasterName(f.name)) {
        try { await readMasterBytes(new Uint8Array(await f.arrayBuffer()), f.name); }
        catch (err) { toast(String(err.message || err), { error: true }); }
      } else if (LK.isLeaksName(f.name)) {
        // A dropped worksheet is attached, with its handle where the drop carries one.
        let h = null;
        try { h = await handles[files.indexOf(f)]; } catch { h = null; }
        try { if (await attachLeaks(new Uint8Array(await f.arrayBuffer()), f.name, h && h.kind === "file" ? h : null)) await goToLeak(Math.max(0, LK.nextUndecided(leakRows(), null))); }
        catch (err) { toast(String(err.message || err), { error: true }); }
      }
    }
    // Dropped PDFs are the ones to show beside (or inside) the open document
    // — several at once for a combined file, each matched to its member.
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (pdfs.length && doc) await usePickedPdfs(pdfs);
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
    buildBody(body, p.lines.join("\n"), i);
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
function buildBody(body, text, page) {
  body.innerHTML = "";
  body.classList.toggle("numbered", TD.pageIsNumbered(text.split("\n")));
  const runs = rev ? PK.translateRuns(rev, text) : [{ t: "text", s: text }];
  // The page's spot keeps, as places in the text it is being built from. `at`
  // follows the same text as the runs are laid out, so each spot's own
  // characters go into a span of their own — carrying no fake, so the value
  // stays as it reads here while every other occurrence is faked as usual.
  const holds = TD.spotRanges(text, TD.spotsOnPage(spots, page));
  let at = 0;
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
  // Text into the line, any spot keep inside it in a span of its own.
  const appendText = (s, from) => {
    if (!s) return;
    let i = 0;
    for (const [a, b] of holds) {
      if (b <= from + i || a >= from + s.length) continue;
      const lo = Math.max(a - from, i), hi = Math.min(b - from, s.length);
      if (hi <= lo) continue;
      if (lo > i) lt.appendChild(document.createTextNode(s.slice(i, lo)));
      lt.appendChild(makeHeld(s.slice(lo, hi)));
      i = hi;
    }
    if (i < s.length) lt.appendChild(document.createTextNode(s.slice(i)));
  };
  newLine();
  runs.forEach((r, ri) => {
    if (r.t === "swap") {
      lt.appendChild(makePn(r.from, r.to, r));
      at += r.from.length;
      lineStart = false;
      return;
    }
    const pieces = r.s.split("\n");
    pieces.forEach((piece, i) => {
      if (i > 0) { newLine(); at += 1; }
      if (!piece) return;
      // A gutter number is followed by text; where that text is the pseudonym
      // span the NEXT run supplies, the number still opens the line.
      const last = i === pieces.length - 1 && ri + 1 < runs.length;
      const g = lineStart ? TD.gutterPrefix(last ? piece + "\u0001" : piece) : null;
      if (g && g.gutter.length <= piece.length) {
        line.insertBefore(makeGutter(g.gutter), lt);
        line.classList.add("num");
        appendText(piece.slice(g.gutter.length), at + g.gutter.length);
      } else appendText(piece, at);
      at += piece.length;
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

/**
 * A SPOT KEEP's span: the value as it reads, at this one place, with no fake
 * under it — so the disk text carries the real value here like any other plain
 * text, while the same value goes on being faked everywhere else. Not editable,
 * for the same reason a pseudonym span is not: typing inside it would move the
 * place the keep names.
 */
function makeHeld(text) {
  const span = document.createElement("span");
  span.className = "held";
  span.dataset.here = "";
  span.contentEditable = "false";
  span.textContent = text;
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
  const real = pnReal(span);
  const c = TD.keptControl(allKeeps(), real);
  span.classList.toggle("kept", !!c);
  if (c) span.dataset.kept = c; else delete span.dataset.kept;
  const by = keptBy(real);
  if (by === "master") span.dataset.keptBy = "master"; else delete span.dataset.keptBy;
}
function remarkKept() {
  for (const s of pagesEl.querySelectorAll(".pn")) markKept(s);
  updateCounts();
}

function pageBodies() { return [...pagesEl.querySelectorAll(".page-body")]; }

/** Re-translate every page under the current key, keeping the edits. */
function retranslate() {
  for (const body of pageBodies()) buildBody(body, TD.serializeNodes(body), pageIndexOf(body));
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
  textAnchors = null; textLineTops = null;
  applyMatchedLayout();
  applyLineLock();
  placeCitations();
  paintHighlights();
}
const afterTextChangeSoon = debounce(afterTextChange, 400);
const relayout = debounce(() => { textAnchors = null; textLineTops = null; applyMatchedLayout(); applyLineLock(); placeCitations(); refitPdf(); if (sbsOn) syncScroll("text", true); }, 150);
window.addEventListener("resize", relayout);

function updateCounts() {
  const all = [...pagesEl.querySelectorAll(".pn")].filter((s) => !s.dataset.piece || s.dataset.piece.startsWith("0/"));
  const n = all.length;
  const k = all.filter((s) => s.classList.contains("kept")).length;
  const h = pagesEl.querySelectorAll("[data-here]").length;
  $("st-pn").textContent = key
    ? `${n} pseudonym${n === 1 ? "" : "s"} shown as real names`
      + (k ? ` · ${k} kept (un-faked on the next run)` : "")
      + (h ? ` · ${h} kept where ${h === 1 ? "it stands" : "they stand"}` : "")
    : "";
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
  if (!pt || pt.container.nodeType !== 3 || (pt.container.parentElement && pt.container.parentElement.closest(".pn, .gutter, [data-here]"))) return;
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
  // The page's spot keeps travel with its text: they are part of how the page
  // stands, and a redo that brought the text back without them would leave the
  // value in the clear with nothing saying so — which the next save would write
  // back to its pseudonym.
  const page = pageIndexOf(body);
  return { page, text: TD.serializeNodes(body), caret: caretOffsetIn(body), spots: spotsFromBody(body, page) };
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
  // The page's keeps as that snapshot had them, so buildBody can put the spans
  // back where the text it is building from carries them.
  spots = spots.filter((x) => x.page !== snap.page).concat(snap.spots || []);
  buildBody(body, snap.text, snap.page);
  doc.pages[snap.page].lines = snap.text.split("\n");
  // …and what actually landed is what is remembered.
  syncSpots(body);
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
    acceptNode: (n) => (n.parentElement && n.parentElement.closest(".pn, [data-here]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
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
  // Each page as it will be written, and the same text with its spot keeps
  // blanked — what the standing assertion below is allowed to look at.
  const scan = [];
  bodies.forEach((body, i) => {
    let { text, held } = TD.serializeHeld(body);
    if (fwd && fwd.rx) {
      const fw = forwardText(text, held);
      if (fw.swaps) {
        snapshot(body, true);
        forwarded += fw.swaps;
        buildBody(body, fw.text, i);
        ({ text, held } = TD.serializeHeld(body)); // the rebuilt page, its spots found again
      }
    }
    doc.pages[i].lines = text.split("\n");
    scan[i] = TD.blankRanges(text, held).split("\n");
  });
  const out = TD.serializeExport(doc);
  // The standing assertion. Nothing above should let a bound real value
  // through, and if something did the save must not. A value kept where it
  // stands is the one thing that may: it is in the file because the operator
  // put it there, so the assertion reads the export with those places blanked.
  if (reals) {
    const held = TD.serializeExport(Object.assign({}, doc, {
      pages: doc.pages.map((p, i) => Object.assign({}, p, { lines: scan[i] || p.lines })),
    }));
    const left = PK.findReals(reals, maskKept(held));
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
      // scan: the real name inside it is on top of the file, not in it. So is
      // a spot keep's, for the opposite reason — the real value IS in the file
      // there, and deliberately, so it is not a leak to report.
      const p = n.parentElement;
      const blank = (blankGutters && p && p.closest(".gutter")) || (blankPn && p && p.closest(".pn, [data-here]"));
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
  // The page a citation fell on, by binary search over the pages' offsets
  // rather than a walk from the first page for each one: a thousand-page
  // export has thousands of citations, and the walk makes that a product.
  const pageAt = (s, e) => {
    let lo = 0, hi = maps.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const m = maps[mid];
      if (s < m.base) hi = mid - 1;
      else if (s >= m.base + m.len + 2) lo = mid + 1;
      else return e <= m.base + m.len ? m : null; // a span across two pages is neither's
    }
    return null;
  };
  // Each page measured ONCE, however many citations land on it: its own box,
  // and the gutter numbers a wrapped citation may run across. Reading them
  // per citation measured every number on the page again for each one.
  const measure = (m) => {
    if (!m.rect) {
      m.rect = m.body.getBoundingClientRect();
      m.gutters = [...m.body.querySelectorAll(".gutter")].map((g) => ({ el: g, box: g.getBoundingClientRect() }));
    }
    return m;
  };
  // EVERY measurement first, the underlines after. An underline is a box the
  // layout has to account for, so measuring one page, drawing its links, then
  // measuring the next makes the browser lay the document out again for each
  // page in turn — on a long export, most of the time the open takes. One
  // read pass, then one write pass, and the layout is done once.
  const plans = [];
  for (const c of found) {
    const url = resolveUrl(c, citationRepo, provider);
    if (!url) continue;
    if (!seen.has(c.key)) seen.set(c.key, { key: c.key, kind: c.kind, url });
    const [s, e] = c.span;
    const m = pageAt(s, e);
    if (!m) continue;
    const range = rangeFor(m.segs, s - m.base, e - m.base);
    if (!range) continue;
    const bodyRect = measure(m).rect;
    // A cite that wraps onto a numbered line spans the gutter number it was
    // detected across; the number is not part of the citation and gets no
    // underline.
    const gutters = m.gutters.filter((g) => range.intersectsNode(g.el)).map((g) => g.box);
    const strips = [];
    for (const r of range.getClientRects()) {
      if (r.width < 1) continue;
      if (gutters.some((g) => r.left >= g.left - 0.5 && r.right <= g.right + 0.5 && r.top >= g.top - 0.5 && r.bottom <= g.bottom + 0.5)) continue;
      strips.push({ left: r.left - bodyRect.left, top: r.bottom - bodyRect.top - 6, width: r.width });
    }
    if (strips.length) {
      plans.push({
        layer: m.body.nextElementSibling,
        kind: c.isSupra || c.isShortForm ? "supra" : c.kind,
        url, key: c.key, strips,
      });
    }
    linked++;
  }
  for (const p of plans) {
    for (const r of p.strips) {
      const a = document.createElement("a");
      a.className = "cite-link kind-" + p.kind;
      a.href = p.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.title = p.key;
      a.style.left = r.left + "px";
      a.style.top = r.top + "px";
      a.style.width = r.width + "px";
      p.layer.appendChild(a);
    }
  }
  lastCites = [...seen.values()];
  $("st-cites").textContent = linked ? `${linked} citation${linked === 1 ? "" : "s"} linked` : "";
  renderToa();
}
function renderToa() { if (toaOn) toaPanel.render(lastCites, provider); }

// ── highlights: flagged values and real names standing in the clear ─────────────
/**
 * A highlight over a list of ranges, added one at a time — NOT
 * `new Highlight(...ranges)`. That spreads the whole list into a single call,
 * and a hundred thousand marks (a master workbook's worth of standing keeps,
 * matched across a case file of a thousand pages — "Court", "Clerk", "County"
 * are on every page of it) overflows the stack: "Maximum call stack size
 * exceeded", thrown before the page has drawn anything. The same list added one
 * by one costs nothing, and the marks themselves have no such limit.
 */
function highlightOf(ranges) {
  const h = new Highlight();
  for (const r of ranges) h.add(r);
  return h;
}
function paintHighlights() {
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
  const flaggedRanges = [];
  const leakRanges = [];
  leakHits = [];
  let leaks = 0;
  const bodies = pageBodies();
  const flagRx = flagged.length ? PK.buildMatcher(flagged) : null;
  // A value KEPT stands in the clear like any other word, and with the orange
  // mark gone (it is not a leak) nothing said it was a decision rather than an
  // oversight. It carries the same dotted mark a kept pseudonym does, so a
  // page read later shows which names were left alone on purpose.
  const keptRx = keptMarkMatcher();
  const keptRanges = [];
  keptSeen = new Set();
  for (const body of bodies) {
    // Over the whole page, pseudonym spans blanked, so a real name wrapped
    // over a line break and its gutter number is found as one. The spots kept
    // where they stand are blanked with them: they carry their own mark.
    const flat = reals || keptRx ? flatten(body, { blankPn: true }) : null;
    if (reals) {
      const { text, segs } = flat;
      for (const h of PK.findRealSpans(reals, maskKept(text))) {
        const r = rangeFor(segs, h.start, h.end);
        if (!r) continue;
        leakRanges.push(r);
        leakHits.push({ range: r, real: h.real, fake: h.fake });
        leaks++;
      }
    }
    if (keptRx) {
      const { text, segs } = flat;
      keptRx.lastIndex = 0;
      let m;
      while ((m = keptRx.exec(text))) {
        const r = rangeFor(segs, m.index, m.index + m[0].length);
        if (r) keptRanges.push(r);
        keptSeen.add(TD.foldValue(PK.foldGaps(m[0])));
        if (m.index === keptRx.lastIndex) keptRx.lastIndex++;
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
  CSS.highlights.set("flagged", highlightOf(flaggedRanges));
  CSS.highlights.set("leak", highlightOf(leakRanges));
  CSS.highlights.set("kept", highlightOf(keptRanges));
  // The LEAKS bar's current row, wherever its value stands.
  leakRowRanges = [];
  if (leakRowValue) for (const body of bodies) for (const r of leakMatches(body, leakRowValue)) leakRowRanges.push({ body, range: r });
  CSS.highlights.set("leakrow", highlightOf(leakRowRanges.map((x) => x.range)));
  markLeakHere();
  $("st-leaks").textContent = leaks ? `⚠ ${leaks} real name${leaks === 1 ? "" : "s"} from the key standing unfaked — written as pseudonyms on save; right-click one to keep it` : "";
  const nk = keptRanges.length;
  $("st-kept").textContent = nk ? `${nk} kept value${nk === 1 ? "" : "s"} standing as ${nk === 1 ? "it reads" : "they read"}` : "";
}
let leakHits = []; // where each real name from the key stands unfaked: [{ range, real, fake }], from the last paint
let keptSeen = new Set(); // the kept values that actually stand in this document, folded — from the last paint
/** The unfaked real name under a point, or null. */
function leakAt(x, y) {
  let node = null, offset = 0;
  try {
    if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { node = p.offsetNode; offset = p.offset; } }
    else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (r) { node = r.startContainer; offset = r.startOffset; } }
  } catch { return null; }
  if (!node) return null;
  for (const h of leakHits) { try { if (h.range.isPointInRange(node, offset)) return h; } catch { /* a range from a page since rebuilt */ } }
  return null;
}
/** The unfaked real name a selection touches, or null. */
function leakIn(range) {
  for (const h of leakHits) {
    try {
      if (h.range.compareBoundaryPoints(Range.END_TO_START, range) < 0 && h.range.compareBoundaryPoints(Range.START_TO_END, range) > 0) return h;
    } catch { /* a range from a page since rebuilt */ }
  }
  return null;
}

// ── pseudonym tooltip ──────────────────────────────────────────────────────────────────
pagesEl.addEventListener("mouseover", (e) => {
  const here = e.target.closest && e.target.closest("[data-here]");
  if (here && settings.marks) {
    tipEl.innerHTML = "";
    const f = TD.fakeFor(fwd, here.textContent);
    tipEl.append("Kept where it stands: the file carries it as it reads here");
    if (f) {
      const b = document.createElement("b");
      b.textContent = f;
      tipEl.append(document.createElement("br"), "Elsewhere it is still ", b, ". Right-click to change.");
    } else tipEl.append(". Right-click to change.");
    tipEl.hidden = false;
    const hr = here.getBoundingClientRect();
    tipEl.style.left = Math.max(4, Math.min(window.innerWidth - tipEl.offsetWidth - 4, hr.left)) + "px";
    tipEl.style.top = (hr.top > 40 ? hr.top - tipEl.offsetHeight - 6 : hr.bottom + 6) + "px";
    return;
  }
  const pn = e.target.closest && e.target.closest(".pn");
  if (!pn || !settings.marks) { hideTip(); return; }
  tipEl.innerHTML = "";
  const b = document.createElement("b");
  b.textContent = settings.showFakes ? pnReal(pn) : pnFake(pn);
  tipEl.append(settings.showFakes ? "Real name: " : "Pseudonym: ", b);
  if (pn.dataset.piece) tipEl.append(` (wrapped over ${pn.dataset.piece.split("/")[1]} lines; this line: ${settings.showFakes ? pn.dataset.real : pn.dataset.fake})`);
  if (pn.dataset.keptBy === "master") {
    tipEl.append(document.createElement("br"), `Kept by ${masterInfo ? masterInfo.name : "the master workbook"} — left alone in every case, and not flagged as a leak. Withdraw it in that workbook's KEEP sheet.`);
  } else if (pn.dataset.kept) {
    tipEl.append(document.createElement("br"), `Kept (${pn.dataset.kept === "never" ? "every case" : "this case"}): PDF-Linker leaves it un-faked on its next run. Right-click to change.`);
  }
  tipEl.hidden = false;
  const r = pn.getBoundingClientRect();
  const tw = tipEl.offsetWidth;
  tipEl.style.left = Math.max(4, Math.min(window.innerWidth - tw - 4, r.left)) + "px";
  tipEl.style.top = (r.top > 40 ? r.top - tipEl.offsetHeight - 6 : r.bottom + 6) + "px";
});
pagesEl.addEventListener("mouseout", (e) => { if (e.target.closest && e.target.closest(".pn, [data-here]")) hideTip(); });
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
  // A value kept where it stands: the question about it is the keep, not the flag.
  const inHere = frag.querySelector ? frag.querySelector("[data-here]") : null;
  let here = (range.startContainer.parentElement && range.startContainer.parentElement.closest("[data-here]"))
    || (range.endContainer.parentElement && range.endContainer.parentElement.closest("[data-here]")) || null;
  if (!here && inHere) here = [...body.querySelectorAll("[data-here]")].find((el) => range.intersectsNode(el)) || null;
  return { text: sel.toString(), touches, range, pn, here };
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
// The other way round, an unfaked real name (orange: the key binds it and
// the file carries it in the clear) is kept the same way, from a right
// click on it or the Keep… beside a selection touching it: the mark goes,
// the save leaves it as it stands, and PDF-Linker's next run skips it.
const keepMenu = $("keep-menu");
let keepMenuFor = null; // { real, fake, leak, span, range, here }
function showKeepMenu(target, x, y) {
  const t = target instanceof Element
    ? (target.dataset.here != null
      ? { real: target.textContent, fake: TD.fakeFor(fwd, target.textContent) || "", leak: false, span: target, here: true }
      : { real: pnReal(target), fake: pnFake(target), leak: false, span: target })
    : target;
  keepMenuFor = t;
  const by = keptBy(t.real);
  const c = by === "case" ? TD.keptControl(keeps, t.real) : "";
  const master = by === "master";
  $("keep-menu-lead").textContent = master ? "Kept by the master workbook:"
    : t.here ? "Kept where it stands:" : t.leak ? "Standing unfaked:" : "Wrongly faked?";
  $("keep-menu-value").textContent = t.real;
  $("keep-menu-fake").textContent = t.fake || "its pseudonym";
  $("keep-menu-sub").childNodes[0].nodeValue = master ? "Left alone in every case by " + (masterInfo ? masterInfo.name : "the master workbook") + "; "
    : t.here ? "The file carries it as it reads here; elsewhere " : t.leak ? "Written as " : "The file carries ";
  $("keep-menu-sub").childNodes[2].nodeValue = master ? " — withdraw it there, not here."
    : t.here ? " still stands for it." : t.leak ? " on save, unless it is kept." : " until PDF-Linker re-runs.";
  if (master) $("keep-menu-fake").textContent = "its KEEP sheet says so";
  // The narrowest keep: this occurrence, and no other. Already one, or already
  // kept for the whole case (or by the master), and there is nothing narrower
  // to ask for.
  $("keep-menu-here").hidden = !!t.here || !!c || master;
  $("keep-menu-no").hidden = c === "no" || master;
  $("keep-menu-never").hidden = c === "never" || master;
  $("keep-menu-undo").hidden = (!c && !t.here) || master;
  $("keep-menu-undo").textContent = t.here && !c ? "Fake it here after all" : "It is a pseudonym after all";
  keepMenu.hidden = false;
  keepMenu.style.left = Math.max(4, Math.min(window.innerWidth - keepMenu.offsetWidth - 4, x)) + "px";
  keepMenu.style.top = Math.max(4, Math.min(window.innerHeight - keepMenu.offsetHeight - 4, y)) + "px";
}
function hideKeepMenu() { keepMenu.hidden = true; keepMenuFor = null; }
pagesEl.addEventListener("contextmenu", (e) => {
  const pn = e.target.closest && e.target.closest(".pn, [data-here]");
  const target = pn || (() => { const h = leakAt(e.clientX, e.clientY); return h ? { real: h.real, fake: h.fake, leak: true, range: h.range } : null; })();
  if (!target) return;
  e.preventDefault();
  hideTip();
  showKeepMenu(target, e.clientX, e.clientY);
});
document.addEventListener("mousedown", (e) => { if (!keepMenu.hidden && !keepMenu.contains(e.target)) hideKeepMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { hideKeepMenu(); flagPop.hidden = true; } });

// ── the master workbook: the keeps that hold in every case ─────────────────────────
//
// PDF-Linker keeps one workbook across every matter, and its KEEP sheet is the
// settled answer to "leave this alone": the Clerk's name, a cited decision's
// party, every value an operator has already ruled on. The reader reads that
// sheet and holds those values kept WITHOUT being asked again — so it stops
// flagging as leaks the very things the operator has decided are not.
//
// The browser will not read a path on its own, so the workbook is chosen once
// and its handle remembered here (IndexedDB keeps file handles); from then on
// every reader tab attaches it at startup. Where the browser wants the grant
// renewed — after it is restarted, usually — the Flagged panel offers it in one
// click rather than asking silently.
const MASTER_FILE = "master";

async function readMaster(handle, { quiet = false } = {}) {
  const file = await handle.getFile();
  const wb = await parseXlsx(new Uint8Array(await file.arrayBuffer()));
  if (!LK.sheetsLookLikeMaster(wb.sheets)) {
    throw new Error(file.name + ' has no "KEEP" sheet — PDF-Linker\'s master workbook holds the standing keeps there.');
  }
  const m = LK.parseMasterKeeps(wb.sheets, file.name);
  masterKeeps = m.keeps.map((k) => TD.makeKeep(k.control, k.value));
  masterInfo = { name: file.name, sheet: m.sheet, rows: m.rows, partial: m.partial.length };
  masterHandle = handle;
  masterNeeds = null;
  compileKey();
  if (doc) { remarkKept(); paintHighlights(); }
  renderFlags();
  if (!quiet) {
    toast(`${masterInfo.name}: ${masterKeeps.length} standing keep${masterKeeps.length === 1 ? "" : "s"} in force`
      + (masterInfo.partial ? ` (${masterInfo.partial} keep${masterInfo.partial === 1 ? "" : "s"} of part of a value left to PDF-Linker)` : "") + ".");
  }
}
/** Choose the master workbook: read now, and attached from now on. */
async function attachMaster() {
  let handle = null;
  if (window.showOpenFilePicker) {
    try {
      [handle] = await window.showOpenFilePicker({
        types: [{ description: "PDF-Linker master workbook", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }],
      });
    } catch (e) {
      if (e && e.name === "AbortError") return;
      handle = null;
    }
  }
  if (!handle) { $("master-input").click(); return; }
  try {
    await readMaster(handle);
    await rememberFile(MASTER_FILE, handle);
  } catch (e) { toast(String(e.message || e), { error: true }); }
}
/** The workbook chosen in an earlier session, attached again. */
async function restoreMaster() {
  const handle = await rememberedFile(MASTER_FILE);
  if (!handle) return;
  const perm = await permissionOf(handle, "read");
  if (perm === "granted") {
    try { await readMaster(handle, { quiet: true }); } catch (e) { console.warn(e); }
    return;
  }
  // Not silently: the grant is asked for on a click.
  masterNeeds = handle;
  masterInfo = null;
  renderFlags();
}
async function renewMaster() {
  const handle = masterNeeds;
  if (!handle) return;
  try {
    const perm = await handle.requestPermission({ mode: "read" });
    if (perm !== "granted") { toast("The master workbook stays unattached.", { error: true }); return; }
    await readMaster(handle);
  } catch (e) { toast(String(e.message || e), { error: true }); }
}
/** A master workbook opened as plain bytes (dropped, or through the file input): read, not remembered. */
async function readMasterBytes(bytes, name) {
  const wb = await parseXlsx(bytes);
  if (!LK.sheetsLookLikeMaster(wb.sheets)) throw new Error(name + ' has no "KEEP" sheet.');
  const m = LK.parseMasterKeeps(wb.sheets, name);
  masterKeeps = m.keeps.map((k) => TD.makeKeep(k.control, k.value));
  masterInfo = { name, sheet: m.sheet, rows: m.rows, partial: m.partial.length, loose: true };
  compileKey();
  if (doc) { remarkKept(); paintHighlights(); }
  renderFlags();
  toast(`${name}: ${masterKeeps.length} standing keep${masterKeeps.length === 1 ? "" : "s"} in force for this session.`);
}

// ── spot keeps: this one occurrence, left as it reads ─────────────────────────────
//
// The page's spans are the truth: after any change to them the page's spots are
// read back off it, so a spot is never remembered in a place the text no longer
// has. Which occurrence each one is, is counted in the DISK text — the text the
// file carries and the reader opens again — because that is what both halves
// agree on (see textdoc.js).
function spotsFromBody(body, page) {
  const { text, held } = TD.serializeHeld(body);
  return held.map(([a, b]) => {
    const value = text.slice(a, b);
    const at = TD.occurrencesOf(text, value).findIndex(([s]) => s === a);
    return TD.makeSpot(page, value, at < 0 ? 0 : at);
  });
}
function syncSpots(body) {
  const page = pageIndexOf(body);
  spots = spots.filter((x) => x.page !== page).concat(spotsFromBody(body, page));
  persistSpots();
}
/** The spans of the wrapped name one piece belongs to — just the one piece's span where it stands whole. */
function wrappedPieces(span) {
  if (span.dataset.wholeFake == null) return [span];
  const all = [...span.closest(".page-body").querySelectorAll(".pn")];
  const same = (el) => el.dataset.wholeFake === span.dataset.wholeFake && el.dataset.wholeReal === span.dataset.wholeReal;
  const pieceOf = (el) => Number(String(el.dataset.piece || "0/1").split("/")[0]) || 0;
  const count = Number(String(span.dataset.piece || "0/1").split("/")[1]) || 1;
  const mine = pieceOf(span);
  const at = all.indexOf(span);
  const out = [span];
  for (let i = at - 1, want = mine - 1; i >= 0 && want >= 0; i--, want--) {
    if (!same(all[i]) || pieceOf(all[i]) !== want) break;
    out.unshift(all[i]);
  }
  for (let i = at + 1, want = mine + 1; i < all.length && want < count; i++, want++) {
    if (!same(all[i]) || pieceOf(all[i]) !== want) break;
    out.push(all[i]);
  }
  return out;
}
/** Keep a pseudonym span where it stands: the real value takes its place, here only. */
function keepSpanHere(span) {
  const body = span.closest(".page-body");
  if (!body) return;
  const real = pnReal(span);
  snapshot(body, true);
  // A name wrapped over two numbered lines is one name: every piece of it is
  // kept, or half of it would go on reading as a pseudonym.
  for (const el of wrappedPieces(span)) el.replaceWith(makeHeld(el.dataset.real));
  afterSpotChange(body, real);
}
/** Keep an unfaked real name where it stands: the save leaves this one as it reads. */
function keepRangeHere(range, real) {
  const parts = [];
  const root = range.commonAncestorContainer;
  const add = (n) => {
    if (n.nodeType !== 3 || !range.intersectsNode(n)) return;
    // The gutter number a wrapped name runs across is the file's own, not part of the name.
    if (n.parentElement && n.parentElement.closest(".gutter, [data-here]")) return;
    const from = n === range.startContainer ? range.startOffset : 0;
    const to = n === range.endContainer ? range.endOffset : n.data.length;
    if (to > from) parts.push({ node: n, from, to });
  };
  if (root.nodeType === 3) add(root);
  else { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) add(n); }
  if (!parts.length) return;
  const body = parts[0].node.parentElement.closest(".page-body");
  if (!body) return;
  snapshot(body, true);
  // Back to front, so the offsets of the earlier parts stay good as nodes split.
  for (const part of parts.reverse()) {
    const node = part.node;
    if (part.to < node.data.length) node.splitText(part.to);
    const mid = part.from > 0 ? node.splitText(part.from) : node;
    mid.replaceWith(makeHeld(mid.data));
  }
  afterSpotChange(body, real);
}
/** Put a spot keep back: the value is a pseudonym again at that place. */
function undoSpotHere(span) {
  const body = span.closest(".page-body");
  if (!body) return;
  const real = span.textContent;
  const fake = TD.fakeFor(fwd, real);
  snapshot(body, true);
  if (fake) span.replaceWith(makePn(fake, real));
  else span.replaceWith(document.createTextNode(real)); // unbound now: plain text, and the save decides
  afterSpotChange(body, real, { undone: true });
}
function afterSpotChange(body, real, { undone = false } = {}) {
  syncSpots(body);
  setDirty(true);
  afterTextChange();
  renderFlags();
  toast(undone
    ? `"${real}" is a pseudonym again at that place`
    : `"${real}" kept where it stands — here only; every other occurrence is still faked`);
}

function setKeep(real, control, { leak = false } = {}) {
  keeps = control ? TD.addKeep(keeps, control, real) : TD.removeKeep(keeps, real);
  persistValues();
  compileKey();
  remarkKept();
  renderFlags();
  paintHighlights();
  showSidePanel(true);
  showSideTab("tab-flags");
  toast(!control ? `"${real}" is a pseudonym again`
    : leak ? `"${real}" kept${control === "never" ? " in every case" : " in this case"} — left as it stands, on save and on PDF-Linker's next run (save the list to the case folder first).`
    : `"${real}" kept${control === "never" ? " in every case" : " in this case"} — un-marked here now; PDF-Linker un-fakes it in the file on its next run (save the list to the case folder first).`);
}
const keepChosen = (control) => { const t = keepMenuFor; hideKeepMenu(); if (t) setKeep(t.real, control, { leak: t.leak }); };
$("keep-menu-here").addEventListener("click", () => {
  const t = keepMenuFor;
  hideKeepMenu();
  if (!t) return;
  if (t.span) keepSpanHere(t.span);
  else if (t.range) keepRangeHere(t.range, t.real);
});
$("keep-menu-no").addEventListener("click", () => keepChosen("no"));
$("keep-menu-never").addEventListener("click", () => keepChosen("never"));
$("keep-menu-undo").addEventListener("click", () => {
  const t = keepMenuFor;
  // A spot keep with no wider keep over it is undone where it stands; the
  // wider keeps are withdrawn as they always were.
  if (t && t.here && !TD.keptControl(keeps, t.real)) { hideKeepMenu(); undoSpotHere(t.span); return; }
  keepChosen("");
});
$("keep-menu-cancel").addEventListener("click", hideKeepMenu);

$("master-load").addEventListener("click", attachMaster);
$("master-renew").addEventListener("click", renewMaster);
$("master-input").addEventListener("change", async () => {
  const f = $("master-input").files[0];
  $("master-input").value = "";
  if (!f) return;
  try { await readMasterBytes(new Uint8Array(await f.arrayBuffer()), f.name); }
  catch (e) { toast(String(e.message || e), { error: true }); }
});

const showFlagPopSoon = debounce(showFlagPop, 120);
document.addEventListener("selectionchange", showFlagPopSoon);
function showFlagPop() {
  const s = currentSelection();
  if (!s) { flagPop.hidden = true; return; }
  const problem = TD.flagProblem(s.text, s.touches);
  flagPopBtn.disabled = !!problem;
  flagPopNote.textContent = problem || "";
  // A pseudonym in the selection: the question is the other one. An
  // unfaked real name in it: whether to leave it so.
  const pnIn = s.pn;
  const hereIn = pnIn ? null : s.here;
  const leak = pnIn || hereIn ? null : leakIn(s.range);
  $("flag-pop-keep").hidden = !pnIn && !hereIn && !leak;
  if (hereIn) {
    flagPopBtn.disabled = true;
    flagPopNote.textContent = "\u201c" + hereIn.textContent + "\u201d is kept where it stands. Change it?";
    $("flag-pop-keep").onclick = (e) => { e.preventDefault(); flagPop.hidden = true; showKeepMenu(hereIn, e.clientX, e.clientY); };
  } else if (pnIn) {
    flagPopNote.textContent = "Wrongly faked? Keep \u201c" + pnIn.dataset.real + "\u201d:";
    $("flag-pop-keep").onclick = (e) => { e.preventDefault(); flagPop.hidden = true; showKeepMenu(pnIn, e.clientX, e.clientY); };
  } else if (leak) {
    flagPopBtn.disabled = true;
    flagPopNote.textContent = "\u201c" + leak.real + "\u201d is in the key and stands unfaked. Leave it so?";
    $("flag-pop-keep").onclick = (e) => { e.preventDefault(); flagPop.hidden = true; showKeepMenu({ real: leak.real, fake: leak.fake, leak: true, range: leak.range }, e.clientX, e.clientY); };
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
// Spot keeps belong to ONE document, not to the case: they name a place in it.
// Remembered per document, like its swapped pages.
function spotStoreKey() { return SPOTS_PREFIX + (folderName || "") + "/" + (fileName || ""); }
function persistSpots() { lsSet(spotStoreKey(), spots); }
// Stored as { values, keeps, handed }; an older build stored the values list
// bare, and one before `handed` stored no record of what a save handed over.
function readStoredValues(k) {
  const v = lsGet(k, null);
  if (Array.isArray(v)) return { values: v, keeps: [], handed: [] };
  return { values: (v && v.values) || [], keeps: (v && v.keeps) || [], handed: (v && v.handed) || [] };
}
function loadValuesFor() { const st = readStoredValues(valuesStoreKey()); flagged = st.values; keeps = st.keeps; handed = st.handed; compileKey(); renderFlags(); }
function persistValues() { lsSet(valuesStoreKey(), { values: flagged, keeps, handed }); }

function renderFlags() {
  flagsList.innerHTML = "";
  flagCount.textContent = String(flagged.length + keeps.length + spots.length);
  renderSpots();
  renderMaster();
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
    ? `Saves to ${folderName}/${TD.VALUES_FILE}; PDF-Linker deletes the file on the run that applies it, and the list clears here.`
    : "No case folder is open: the list is remembered here and can be saved anywhere or copied.";
}

// The master workbook's standing keeps: how many there are, and — the useful
// part when reading — which of them are actually holding a value in THIS
// document, the ones that would otherwise be flagged.
function renderMaster() {
  const hint = $("master-hint");
  const list = $("master-list");
  list.innerHTML = "";
  $("master-renew").hidden = !masterNeeds;
  $("master-load").textContent = masterInfo ? "Load another…" : "Load master workbook…";
  if (masterNeeds) {
    hint.textContent = "The master workbook is remembered but needs authorising again — its standing keeps are not in force until it is.";
    return;
  }
  if (!masterInfo) {
    hint.textContent = "No master workbook attached. PDF-Linker's own (Master Leaks.xlsx) holds a KEEP sheet of every value you have said to leave alone; attached here, the reader stops flagging them as leaks — in this case and every other.";
    return;
  }
  const here = masterKeeps.filter((k) => keptSeen.has(TD.foldValue(k.value)));
  hint.textContent = `${masterInfo.name} · ${masterKeeps.length} standing keep${masterKeeps.length === 1 ? "" : "s"}`
    + (masterInfo.partial ? `, ${masterInfo.partial} of part of a value left to PDF-Linker` : "")
    + (masterInfo.loose ? " (this session only — choose it with the button to keep it attached)" : "")
    + (here.length ? ` · ${here.length} standing in this document:` : " · none of them stands in this document.");
  for (const k of here.slice(0, 60)) {
    const li = document.createElement("li");
    li.textContent = k.value;
    const t = document.createElement("span");
    t.className = "tag keep";
    t.textContent = "master";
    t.title = "Kept by the master workbook, in every case — withdraw it there, not here";
    li.appendChild(t);
    li.title = "Click to find it in the document";
    li.addEventListener("click", () => findInPages(k.value));
    list.appendChild(li);
  }
  if (here.length > 60) {
    const li = document.createElement("li");
    li.className = "more";
    li.textContent = `…and ${here.length - 60} more`;
    list.appendChild(li);
  }
}

// The document's spot keeps, each one findable and withdrawable: a keep made by
// right-clicking one word in one place is otherwise hard to find again.
function renderSpots() {
  const list = $("spots-list");
  list.innerHTML = "";
  $("spots-block").hidden = !spots.length;
  for (const sp of spots.slice().sort((a, b) => a.page - b.page || a.nth - b.nth)) {
    const li = document.createElement("li");
    li.textContent = sp.value;
    const t = document.createElement("span");
    t.className = "tag keep";
    t.textContent = "p. " + (sp.page + 1);
    t.title = "Kept where it stands on page " + (sp.page + 1) + " of this document";
    li.appendChild(t);
    li.title = "Click to go to it";
    li.addEventListener("click", () => goToSpot(sp));
    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "×";
    x.title = "Fake it here after all";
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      const span = spanForSpot(sp);
      if (span) undoSpotHere(span);
    });
    li.appendChild(x);
    list.appendChild(li);
  }
}
/**
 * The span a stored spot stands in, or null where the text no longer has it.
 * The page's spots come back in the order its spans stand, which is the order
 * the document gives them, so one list indexes the other.
 */
function spanForSpot(sp) {
  const body = pageBodies()[sp.page];
  if (!body) return null;
  const at = spotsFromBody(body, sp.page).findIndex((x) => TD.sameSpot(x, sp));
  if (at < 0) return null;
  return [...body.querySelectorAll("[data-here]")].filter((el) => el.textContent.length)[at] || null;
}
function goToSpot(sp) {
  const span = spanForSpot(sp);
  if (!span) { toast(`"${sp.value}" is no longer kept on page ${sp.page + 1}`); return; }
  const r = document.createRange();
  r.selectNodeContents(span);
  const sel = document.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  const rect = span.getBoundingClientRect();
  stageEl.scrollBy({ top: rect.top - stageEl.getBoundingClientRect().top - stageEl.clientHeight / 3, behavior: "smooth" });
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
      handed = flagged.slice();
      persistValues();
      toast(`Wrote ${TD.VALUES_FILE} (${flagged.length} to fake, ${keeps.length} to keep) into ${folderName} — re-run PDF-Linker to apply them to the files. The run deletes the file when it has; the reader reads that as done and clears the list.`,
        { ms: 6000 });
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

// ── the LEAKS worksheet ───────────────────────────────────────────────────────────
//
// PDF-Linker's leak triage is a worksheet, LEAKS.xlsx in the case folder: one
// row per flagged value with a Fix? cell the operator answers (yes / no /
// never / phrase, ~CORRECT SPELLING, *CORRECT TEXT, a [kept part], or the
// exact replacement), and Apply Leak Fixes reads the cells back. Answering
// it in Excel means reading a sentence in a cell and guessing at the page.
// Here the worksheet is attached — from the case folder on open, or loaded
// by hand — and worked ROW BY ROW: the current row stands in a bar above the
// text (value, type, where, both Context quotes, the Fix? controls), the
// reader opens the row's own document, scrolls to its page and line, and
// marks the value wherever it stands; the text stays editable underneath,
// and the PDF beside it follows as it always does on a scroll. A decision
// is the exact text PDF-Linker will read, written into that row's Fix? cell
// and nowhere else (xlsx-write.js copies every other part of the workbook
// through byte for byte); it is remembered here until saved, and Save
// writes LEAKS.xlsx back in place. Then Apply Leak Fixes does the rest.
// A `no` or `never` on a value the key binds is mirrored as one of the
// reader's own keeps, so the orange mark goes and a save of the document
// leaves the value as it stands — the two channels agreeing on the one
// thing they both say. A `yes` is the worksheet's alone: it is never also
// flagged into New Real Values.txt, which would hand PDF-Linker the same
// value twice under two different rules.
const leaksBar = $("leaks-bar");
let leaks = null;          // { parsed, bytes, name, handle, folder, at, mirrored: Set }
let leakRowValue = "";     // the current row's value, marked wherever it stands
let leakRowRanges = [];    // where it stands, from the last paint: [{ body, range }]
let leakHere = null;       // the occurrence the bar scrolled to

function leaksStoreKey() { return LK.decisionsKey(leaks.folder || folderName || fileName, leaks.name); }
function persistLeaks() { if (leaks) lsSet(leaksStoreKey(), LK.packDecisions(leaks.parsed.rows)); }
function leaksDirty() { return !!leaks && leaks.parsed.rows.some((r) => r.fix !== r.fix0); }
function leakRows() { return leaks ? leaks.parsed.rows : []; }

/** Attach a worksheet: its bytes (kept for the rewrite), its handle (for the save in place). */
async function attachLeaks(bytes, name, handle, { quiet = false, folder = "" } = {}) {
  const wb = await parseXlsx(bytes);
  if (!LK.sheetsLookLikeLeaks(wb.sheets)) throw new Error(`${name} has no "Value" / "Fix?" header — not a LEAKS worksheet.`);
  const parsed = LK.parseLeaks(wb.sheets, name);
  if (!parsed.part) throw new Error(`${name}: the LEAKS sheet could not be placed in the workbook.`);
  // Unsaved decisions are never lost to a re-attach: they are remembered
  // per worksheet (folder and name) and laid back over the rows below.
  if (leaks) persistLeaks();
  leaks = { parsed, bytes, name, handle: handle || null, folder: folder || folderName || "", at: -1, mirrored: new Set() };
  const remembered = LK.unpackDecisions(parsed.rows, lsGet(leaksStoreKey(), null));
  for (const r of parsed.rows) if (r.fix !== r.fix0) mirrorLeakKeep(r);
  leakRowValue = "";
  leakHere = null;
  renderLeaksTab();
  updateLeaksButton();
  if (!leaksBar.hidden) { const i = LK.nextUndecided(parsed.rows, null); await goToLeak(i >= 0 ? i : 0, { locate: false }); }
  else paintHighlights();
  const und = LK.undecidedCount(parsed.rows);
  if (!quiet) toast(`${name}: ${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"}, ${und} undecided` + (remembered ? `, ${remembered} decided here and not yet saved` : "") + " — ⚠ Leaks to review them.");
  return parsed;
}
function dropLeaks() {
  leaks = null;
  leakRowValue = "";
  leakHere = null;
  showLeaksBar(false);
  renderLeaksTab();
  updateLeaksButton();
}

function updateLeaksButton() {
  const rows = leakRows();
  const badge = $("leaks-count");
  badge.hidden = !leaks;
  badge.textContent = String(LK.undecidedCount(rows));
  badge.title = leaks ? `${LK.undecidedCount(rows)} of ${rows.length} rows undecided` : "";
  $("leaks-btn").setAttribute("aria-pressed", String(!leaksBar.hidden));
  $("leaks-tab-count").textContent = String(rows.length);
}

/** Whether the key binds this value (so an unfaked occurrence is an orange leak). */
function boundByKey(value) { return !!(reals && reals.map && reals.map.get(PK.fold(PK.foldGaps(value)))); }
/** A `no` / `never` on a bound value becomes one of the reader's keeps; withdrawn, it is withdrawn here too. */
function mirrorLeakKeep(row) {
  const kind = LK.classifyFix(row.fix, row.value).kind;
  const f = PK.fold(row.value);
  const want = LK.isKeepKind(kind) && boundByKey(row.value);
  if (want) { keeps = TD.addKeep(keeps, kind, row.value); leaks.mirrored.add(f); }
  else if (leaks.mirrored.has(f)) { keeps = TD.removeKeep(keeps, row.value); leaks.mirrored.delete(f); }
  else return false;
  persistValues();
  compileKey();
  remarkKept();
  renderFlags();
  return true;
}

// The bar: shown and hidden by the toolbar button and its own ×; it takes
// its own height above the stage (--bar-h), so the first lines of the text
// are never under it.
function setBarHeight() {
  document.documentElement.style.setProperty("--bar-h", leaksBar.hidden ? "0px" : leaksBar.offsetHeight + "px");
}
if (typeof ResizeObserver !== "undefined") new ResizeObserver(setBarHeight).observe(leaksBar);
function showLeaksBar(on) {
  const was = !leaksBar.hidden;
  leaksBar.hidden = !on;
  setBarHeight();
  updateLeaksButton();
  if (was !== !!on) relayout();
  if (!on) { leakRowValue = ""; leakHere = null; paintHighlights(); }
}

function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
/** The quote with the value bolded, as the worksheet's Context cell bolds it. */
function quoteNodes(text, value) {
  const frag = document.createDocumentFragment();
  const v = TD.normalizeValue(value);
  if (!v || !text) { frag.append(text || ""); return frag; }
  const rx = new RegExp(escRe(v).replace(/ /g, "\\s+"), "gi");
  let at = 0, m;
  while ((m = rx.exec(text))) {
    if (m.index > at) frag.append(text.slice(at, m.index));
    const b = document.createElement("b");
    b.textContent = m[0];
    frag.append(b);
    at = m.index + m[0].length;
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  if (at < text.length) frag.append(text.slice(at));
  return frag;
}
function typeClass(type) {
  const t = String(type || "").toUpperCase();
  return t === "LEAK" ? "leak" : t.startsWith("REID") ? "reid" : "";
}

function renderLeaksBar() {
  if (!leaks || leaks.at < 0 || leaks.at >= leakRows().length) return;
  const rows = leakRows(), row = rows[leaks.at];
  const und = LK.undecidedCount(rows);
  $("lb-count").textContent = `Row ${leaks.at + 1} of ${rows.length}` + (und ? ` · ${und} undecided` : " · all decided");
  const tt = $("lb-type");
  tt.textContent = row.type || "review";
  tt.className = "lb-type " + typeClass(row.type);
  $("lb-value").textContent = row.value;
  const files = LK.parseFiles(row.file);
  $("lb-where").textContent = [files.length ? files.join(", ") : row.file, row.where].filter(Boolean).join(" · ");
  const ctx = $("lb-context");
  ctx.innerHTML = "";
  const halves = LK.splitContext(row.context);
  if (halves.original) ctx.append(quoteNodes(halves.original, row.value));
  else { const i = document.createElement("i"); i.textContent = "(no context quoted)"; ctx.append(i); }
  if (halves.exported) {
    const ex = document.createElement("div");
    ex.className = "lb-export";
    const tag = document.createElement("span");
    tag.className = "lb-tag";
    tag.textContent = "export";
    ex.append(tag, quoteNodes(halves.exported, row.value));
    ctx.append(ex);
  }
  $("lb-notes").textContent = row.notes || "";
  const c = LK.classifyFix(row.fix, row.value);
  const ans = $("lb-answer");
  ans.textContent = c.label + (row.fix !== row.fix0 ? " (unsaved)" : "");
  ans.className = "lb-answer" + (c.kind ? "" : " undecided");
  for (const b of leaksBar.querySelectorAll("button[data-fix]")) b.classList.toggle("on", c.kind === b.dataset.fix);
  const typed = $("lb-typed");
  if (document.activeElement !== typed) typed.value = LK.CONTROLS.includes(c.kind) || !c.kind ? "" : row.fix;
  const n = rows.filter((r) => r.fix !== r.fix0).length;
  $("lb-save").disabled = !n;
  $("lb-save").textContent = n ? `💾 Save LEAKS.xlsx (${n})` : "💾 Save LEAKS.xlsx";
  $("lb-prev").disabled = $("lb-next").disabled = rows.length < 2;
  $("lb-next-open").disabled = !und;
}

function renderLeaksTab() {
  const list = $("leaks-list");
  list.innerHTML = "";
  const rows = leakRows();
  $("leaks-hint").textContent = leaks
    ? `${leaks.name}${leaks.folder ? " · " + leaks.folder : ""} · ${rows.length} row${rows.length === 1 ? "" : "s"}, ${LK.undecidedCount(rows)} undecided. Click a row: the text opens at it.`
    : "Open a case folder with a LEAKS.xlsx in it, or load one, to review its rows here.";
  $("leaks-actions").hidden = !leaks;
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = i === (leaks ? leaks.at : -1) ? "current" : "";
    const t = document.createElement("span");
    t.className = "tag type " + typeClass(r.type);
    t.textContent = typeClass(r.type) === "leak" ? "LEAK" : typeClass(r.type) === "reid" ? "REID" : "review";
    t.title = r.type;
    const v = document.createElement("span");
    v.className = "lv";
    v.textContent = r.value;
    const c = LK.classifyFix(r.fix, r.value);
    const f = document.createElement("span");
    f.className = "tag fix " + (c.kind ? (LK.isKeepKind(c.kind) ? "no" : "") : "open");
    f.textContent = c.kind ? (LK.CONTROLS.includes(c.kind) ? c.kind : c.kind === "error" ? "?" : "typed") : "?";
    f.title = c.label + (r.fix !== r.fix0 ? " (unsaved)" : "");
    li.append(t, v, f);
    li.title = `${r.value} — ${r.type} — ${r.file} — ${r.where}`;
    li.addEventListener("click", () => goToLeak(i));
    list.appendChild(li);
  });
  const n = rows.filter((r) => r.fix !== r.fix0).length;
  $("leaks-save").disabled = !n;
  $("leaks-note").textContent = !leaks ? "" : n
    ? `${n} decision${n === 1 ? "" : "s"} not yet saved (remembered here until then).`
    : leaks.handle || dirHandle ? `Saves into ${leaks.folder || folderName || "the folder"}/${leaks.name}. After saving, double-click Apply Leak Fixes.bat, or re-run PDF-Linker.` : "No folder is open: a save asks where to write the worksheet.";
}

/** Show row `i` in the bar and take the text to it. */
async function goToLeak(i, { locate = true } = {}) {
  const rows = leakRows();
  if (!rows.length) return;
  leaks.at = ((i % rows.length) + rows.length) % rows.length;
  const row = rows[leaks.at];
  leakRowValue = row.value;
  leakHere = null;
  showLeaksBar(true);
  renderLeaksBar();
  renderLeaksTab();
  if (locate) await locateLeak(row);
  else paintHighlights();
}

/** Every place `value` stands on a page body: DOM ranges, the value's own spelling or a bare substring of it. */
function leakMatches(body, value) {
  const out = [];
  const v = TD.normalizeValue(value);
  if (!v) return out;
  // Pseudonym spans blanked: a span SHOWS the real name, and a worksheet
  // value standing inside one is the faked occurrence, not the leak.
  const { text, segs } = flatten(body, { blankPn: true });
  const push = (s, e) => { const r = rangeFor(segs, s, e); if (r) out.push(r); };
  const rx = PK.buildMatcher([v]);
  if (rx) {
    let m;
    rx.lastIndex = 0;
    while ((m = rx.exec(text))) { push(m.index, m.index + m[0].length); if (m.index === rx.lastIndex) rx.lastIndex++; }
  }
  if (!out.length && v.length >= 3) {
    // A welded or reduced finding has no bounded occurrence by construction.
    const low = text.toLowerCase(), needle = v.toLowerCase();
    let at = 0;
    while ((at = low.indexOf(needle, at)) >= 0) { push(at, at + needle.length); at += needle.length; }
  }
  return out;
}
function gutterOf(range) {
  const el = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const line = el && el.closest && el.closest(".line");
  const gn = line && line.querySelector(".gutter .gn");
  const n = gn ? parseInt(gn.textContent, 10) : NaN;
  return isFinite(n) ? n : null;
}

/**
 * Open the row's document (the first of its files that has an export in
 * the folder, unless the open one is among them), scroll to the page and
 * line its Where names, and mark the occurrence there.
 */
async function locateLeak(row) {
  const files = LK.parseFiles(row.file);
  const fwdName = fwd ? (s) => forwardText(s).text : null;
  const here = (name) => name && files.some((f) => LK.matchExport(f, [name], fwdName));
  let target = null;
  if (files.length && !here(fileName)) {
    const names = folderDocs.map((d) => d.name);
    for (const f of files) {
      const e = LK.matchExport(f, names, fwdName);
      if (e) { target = folderDocs.find((d) => d.name === e); break; }
    }
    // A combined file already open holds every member: stay in it.
    if (target && doc && PS.combinedMembers(doc.pages).some((m) => here(m))) target = null;
  }
  if (target && target.name !== fileName) {
    // openFile asks about unsaved edits; a refusal leaves the open document.
    const wasEditing = editing;
    await openFolderDoc(target);
    if (!doc || fileName !== target.name) { paintHighlights(); return; }
    if (wasEditing) setEditing(true);
  } else if (files.length && !target && !here(fileName)) {
    toast(`${files[0]}: no export in ${folderName || "the folder"} matches it — searching ${fileName || "the open document"} instead.`);
  }
  paintHighlights();
  if (!doc) return;
  // The occurrence to stand at: on the page Where names (its own number,
  // under the row's own member in a combined file), on the line it names
  // where the page carries gutter numbers, else the first anywhere.
  const wheres = LK.parseWhere(row.where);
  const members = PS.pageSources(doc.pages, fileName);
  const memberOk = (i) => !files.length || here(members[i]) || members[i] === fileName;
  let best = null, bestScore = -1;
  for (const hit of leakRowRanges) {
    const sec = hit.body.closest(".tpage");
    const i = Number(sec.dataset.index);
    const page = doc.pages[i] && doc.pages[i].number;
    const g = gutterOf(hit.range);
    let score = 0;
    for (const w of wheres) {
      let s = 0;
      if (w.page != null && page === w.page && memberOk(i)) s = 2;
      else if (w.page == null && page == null) s = 1;
      if (s && w.line != null && g != null && g >= w.line && g <= (w.lineEnd != null && w.lineEnd >= w.line ? w.lineEnd : w.line)) s += 3;
      score = Math.max(score, s);
    }
    if (score > bestScore) { bestScore = score; best = hit; }
  }
  if (!best) {
    $("lb-where").textContent += " — not found in " + fileName;
    toast(`"${row.value}" is not in ${fileName}` + (files.length ? ` (the row names ${files.join(", ")})` : ""), { error: true });
    return;
  }
  leakHere = best.range;
  markLeakHere();
  const sec = best.body.closest(".tpage");
  let rect = best.range.getBoundingClientRect();
  if (!rect.height) rect = sec.getBoundingClientRect(); // the page is swapped for its PDF page
  const st = stageEl.getBoundingClientRect();
  stageEl.scrollTo({ top: stageEl.scrollTop + rect.top - st.top - Math.max(40, stageEl.clientHeight / 3), behavior: "smooth" });
  if (bestScore < 2 && wheres.length) toast(`Found "${row.value}" on ${TD.pageLabel(doc.pages[Number(sec.dataset.index)]) || "the page"}, not at ${row.where}.`);
}
function markLeakHere() {
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
  if (leakHere && leakHere.startContainer.isConnected) CSS.highlights.set("leakrow-here", new Highlight(leakHere));
  else CSS.highlights.delete("leakrow-here");
}

/** Write a decision into the current row's Fix? cell (remembered until saved). */
function decideLeak(text, { advance = false } = {}) {
  if (!leaks || leaks.at < 0) return;
  const row = leakRows()[leaks.at];
  row.fix = String(text == null ? "" : text).trim();
  persistLeaks();
  mirrorLeakKeep(row);
  renderLeaksBar();
  renderLeaksTab();
  updateLeaksButton();
  paintHighlights();
  if (!advance) return;
  const n = LK.nextUndecided(leakRows(), leaks.at);
  if (n >= 0 && n !== leaks.at) goToLeak(n);
  else if (n < 0) toast("Every row is decided — save the worksheet, then Apply Leak Fixes.");
}

/** Write the decisions into the workbook: the same file, the Fix? cells changed, read back before it is written. */
async function saveLeaks() {
  if (!leaks) { toast("No LEAKS.xlsx is loaded.", { error: true }); return; }
  const edits = LK.fixEdits(leaks.parsed);
  if (!edits.length) { toast("Nothing to save — no decision has changed."); return; }
  let out;
  try {
    out = await XW.writeSheetCells(leaks.bytes, leaks.parsed.part, edits);
    // The standing check: what was written reads back as what was decided.
    const back = LK.parseLeaks((await parseXlsx(out)).sheets, leaks.name);
    const byRow = new Map(back.rows.map((r) => [r.n, r]));
    for (const r of leaks.parsed.rows) {
      const b = byRow.get(r.n);
      if (!b || b.value !== r.value || b.fix !== r.fix) throw new Error(`row ${r.n} (${r.value}) did not read back as decided`);
    }
    if (back.rows.length !== leaks.parsed.rows.length) throw new Error("the row count changed");
  } catch (e) {
    toast("Not saved: " + (e.message || e), { error: true });
    return;
  }
  let handle = leaks.handle;
  if (!handle && dirHandle) {
    try { handle = await dirHandle.getFileHandle(leaks.name, { create: true }); } catch { handle = null; }
  }
  const ok = await writeBlob(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), leaks.name, handle,
    { description: "LEAKS worksheet", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } });
  if (!ok) return;
  leaks.bytes = out;
  if (handle) leaks.handle = handle;
  for (const r of leaks.parsed.rows) r.fix0 = r.fix;
  try { localStorage.removeItem(leaksStoreKey()); } catch { /* fine */ }
  renderLeaksBar();
  renderLeaksTab();
  const und = LK.undecidedCount(leaks.parsed.rows);
  toast(`Saved ${leaks.name} — ${edits.length} decision${edits.length === 1 ? "" : "s"} written` + (und ? `, ${und} row${und === 1 ? "" : "s"} still undecided` : "") + ". Double-click Apply Leak Fixes.bat (or re-run PDF-Linker) to apply them to the files.", { ms: 6000 });
}

/** Write bytes: in place through the handle, else the Save picker, else a download. */
async function writeBlob(blob, name, handle, type) {
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
      const h = await window.showSaveFilePicker({ suggestedName: name, types: [type] });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
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

async function pickLeaks() {
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: "LEAKS worksheet", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }] });
      const f = await h.getFile();
      if (await attachLeaks(new Uint8Array(await f.arrayBuffer()), f.name, h)) await goToLeak(Math.max(0, LK.nextUndecided(leakRows(), null)));
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
      if (!(e && /picker|not allowed|SecurityError|TypeError/i.test(String(e)))) { toast(String(e.message || e), { error: true }); return; }
    }
  }
  $("leaks-input").click();
}
$("leaks-input").addEventListener("change", async () => {
  const f = $("leaks-input").files[0];
  $("leaks-input").value = "";
  if (!f) return;
  try { if (await attachLeaks(new Uint8Array(await f.arrayBuffer()), f.name, null)) await goToLeak(Math.max(0, LK.nextUndecided(leakRows(), null))); }
  catch (e) { toast(String(e.message || e), { error: true }); }
});
$("leaks-btn").addEventListener("click", async () => {
  if (!leaks) { await pickLeaks(); return; }
  if (!leaksBar.hidden) { showLeaksBar(false); return; }
  await goToLeak(leaks.at >= 0 ? leaks.at : Math.max(0, LK.nextUndecided(leakRows(), null)));
});
$("lb-close").addEventListener("click", () => showLeaksBar(false));
$("lb-open").addEventListener("click", pickLeaks);
$("leaks-load").addEventListener("click", pickLeaks);
$("lb-prev").addEventListener("click", () => goToLeak(leaks.at - 1));
$("lb-next").addEventListener("click", () => goToLeak(leaks.at + 1));
$("lb-next-open").addEventListener("click", () => { const n = LK.nextUndecided(leakRows(), leaks.at); if (n >= 0) goToLeak(n); });
$("lb-find").addEventListener("click", () => { if (leaks && leaks.at >= 0) locateLeak(leakRows()[leaks.at]); });
$("lb-save").addEventListener("click", saveLeaks);
$("leaks-save").addEventListener("click", saveLeaks);
for (const b of leaksBar.querySelectorAll("button[data-fix]")) b.addEventListener("click", () => decideLeak(b.dataset.fix, { advance: true }));
$("lb-apply").addEventListener("click", () => { const t = $("lb-typed").value.trim(); if (t) decideLeak(t, { advance: true }); else toast("Type the replacement, ~CORRECT SPELLING, *CORRECT TEXT or [part to keep] first.", { error: true }); });
$("lb-clear").addEventListener("click", () => { $("lb-typed").value = ""; decideLeak(""); });
$("lb-typed").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("lb-apply").click(); }
  if (e.key === "Escape") { e.preventDefault(); $("lb-typed").blur(); }
});
// Alt+↓/↑ walk the rows (Alt+←/→ are the browser's own Back and Forward),
// Alt+Y / Alt+N decide the current one — from the page, never from a field
// being typed in.
document.addEventListener("keydown", (e) => {
  if (!leaks || leaksBar.hidden) return;
  const t = e.target;
  const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); saveLeaks(); return; }
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === "ArrowDown") { e.preventDefault(); goToLeak(leaks.at + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); goToLeak(leaks.at - 1); }
  else if (!typing && e.key.toLowerCase() === "y") { e.preventDefault(); decideLeak("yes", { advance: true }); }
  else if (!typing && e.key.toLowerCase() === "n") { e.preventDefault(); decideLeak("no", { advance: true }); }
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
let pickedPdfs = new Map(); // PDFs picked by hand for a combined file, by name: { name, file }
let pickedByMember = new Map(); // …and the member each was matched to by ORDER, where names could not
let swaps = new Set();      // "<pdf name>|<page>" swapped in
const pdfCache = new Map(); // name → Promise<{ pdf, count, sizes, name }>

function forgetPdfs() {
  cancelPdfJobs();
  for (const p of pdfCache.values()) p.then((info) => { try { info.pdf.destroy(); } catch { /* gone */ } }).catch(() => {});
  pdfCache.clear();
  pdfPicked = null;
  pickedPdfs = new Map();
  pickedByMember = new Map();
}

// ── opening the PDFs: ONE AT A TIME, in the order they appear ─────────────────────
//
// A Combined Text.txt names two dozen documents, each with a PDF of its own, and
// side by side asks every slot for its page size as the pane is built. Every one
// of those asks used to open its PDF there and then: two dozen files read whole
// into memory, parsed, every page measured and its text read for the line grid,
// all at once and all competing, before a single page could be looked at.
//
// They go through a queue instead. One document is opened at a time, in the
// order the pane asked — which is the order the combined file lists them — so
// the first member's pages are ready while the twenty-first is still waiting its
// turn. Whatever the reader has actually scrolled to jumps the queue: a slot
// coming into view asks with `now`, which moves that PDF (and the reading of its
// grid) to the front.
const pdfJobs = [];        // queued work, each tagged with the PDF it is for
let pdfJobBusy = false;
function pumpPdfJobs() {
  if (pdfJobBusy) return;
  pdfJobBusy = true;
  (async () => {
    try {
      while (pdfJobs.length) {
        const job = pdfJobs.shift();
        try { await job.run(); } catch { /* whoever asked for it reports it */ }
      }
    } finally { pdfJobBusy = false; }
  })();
}
/** Everything queued for one PDF to the front, keeping the order it was asked in. */
function bumpPdfJobs(name) {
  const mine = [];
  for (let i = pdfJobs.length - 1; i >= 0; i--) if (pdfJobs[i].name === name) mine.unshift(pdfJobs.splice(i, 1)[0]);
  if (mine.length) pdfJobs.unshift(...mine);
}
/** Drop what is still queued — the document being read has changed under it. */
function cancelPdfJobs() {
  for (const job of pdfJobs.splice(0, pdfJobs.length)) if (job.cancel) job.cancel();
}

/**
 * Open (once) the PDF behind a source: its page count and each page's size at
 * scale 1. `now` is for a page on screen — it goes to the head of the queue.
 */
function loadPdf(src, { now = false } = {}) {
  const held = pdfCache.get(src.name);
  if (held) { if (now) bumpPdfJobs(src.name); return held; }
  let settle = null;
  const p = new Promise((res, rej) => { settle = { res, rej }; });
  pdfCache.set(src.name, p);
  p.then((info) => { p.__info = info; }).catch(() => { if (pdfCache.get(src.name) === p) pdfCache.delete(src.name); });
  const job = {
    name: src.name,
    run: () => openPdf(src).then(settle.res, settle.rej),
    cancel: () => settle.rej(Object.assign(new Error("cancelled"), { cancelled: true })),
  };
  if (now) pdfJobs.unshift(job); else pdfJobs.push(job);
  pumpPdfJobs();
  return p;
}
async function openPdf(src) {
  const file = src.file || await src.handle.getFile();
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const sizes = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const v = (await pdf.getPage(i)).getViewport({ scale: 1 });
    sizes.push({ w: v.width, h: v.height });
  }
  const info = { pdf, count: pdf.numPages, sizes, name: src.name, lines: sizes.map(() => null), geoms: sizes.map(() => null), rows: sizes.map(() => null) };
  // The line grid comes after the documents already waiting: a page is worth
  // seeing before it is worth aligning, and the pane re-aligns as it lands.
  pdfJobs.push({ name: src.name, run: () => readPdfGrid(info) });
  pumpPdfJobs();
  return info;
}
/**
 * Where each page's FIRST printed line sits (the side-by-side anchor) and its
 * LINE GRID (pdfsync.pleadingGeometry, from the numbers down its margin).
 */
async function readPdfGrid(info) {
  const { pdf, sizes } = info;
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
  // A combined file's members, in the order its header lists them: each
  // is matched to a PDF on its own — the folder's, then one picked by hand
  // (by name through the key, else by order) — never to one PDF for all.
  const members = PS.combinedMembers(doc.pages);
  const memo = new Map();
  pdfSources = names.map((n) => {
    if (!memo.has(n)) {
      const hit = PS.matchPdf(n, folderPdfs.map((p) => p.name), fwdName);
      let src = hit ? folderPdfs.find((p) => p.name === hit) : null;
      if (!src && pickedPdfs.size) { const p = PS.matchPdf(n, [...pickedPdfs.keys()], fwdName); if (p) src = pickedPdfs.get(p); }
      if (!src && pickedByMember.has(n)) src = pickedByMember.get(n);
      if (!src && pdfPicked && members.length <= 1) src = pdfPicked;
      memo.set(n, src || null);
    }
    return memo.get(n) || null;
  });
}
/** The combined file's members with no PDF yet, in order ([] for a lone export). */
function membersWithoutPdf() {
  if (!doc) return [];
  const names = PS.pageSources(doc.pages, fileName);
  const out = [];
  for (const m of PS.combinedMembers(doc.pages)) {
    const i = names.indexOf(m);
    if (i >= 0 && !pdfSources[i] && !out.includes(m)) out.push(m);
  }
  return out;
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
  const members = doc ? PS.combinedMembers(doc.pages) : [];
  const missing = membersWithoutPdf();
  let text = "";
  if (!doc) text = "";
  else if (members.length > 1) {
    text = `PDFs: ${members.length - missing.length} of ${members.length} documents matched`;
    if (missing.length) text += ` — none for ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""} (⇄ PDF pages… → Pick PDFs…)`;
    else if (names.length) text += ": " + names.join(", ");
  } else text = names.length ? "PDF: " + names.join(", ") : "No matching PDF in the case folder";
  if (n) text += ` · ${n} page${n === 1 ? "" : "s"} shown from the PDF`;
  $("st-pdf").textContent = text;
}

// ── rendering a page into a canvas ──
async function renderInto(el, src, pageNo, cssWidth) {
  const want = src.name + "|" + pageNo + "|" + cssWidth + "|" + (window.devicePixelRatio || 1);
  if (el.dataset.rendered === want) return;
  el.dataset.want = want;
  let info;
  try { info = await loadPdf(src, { now: true }); }
  catch (e) {
    if (e && e.cancelled) return; // the document being read changed under it
    el.querySelector(".pdf-wait").textContent = "Could not open " + src.name + ": " + (e.message || e);
    return;
  }
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
  const members = PS.combinedMembers(doc.pages);
  if (!pdfSources.some(Boolean)) {
    const box = document.createElement("div");
    box.className = "pane-empty";
    const what = members.length > 1 ? `the ${members.length} documents it lists` : "it";
    // Say which of the three things is actually missing. "No PDF matches" read
    // as a matching failure when usually there was nothing to match: no case
    // folder open means no PDFs at all, and without a key the names cannot be
    // compared — PDF-Linker leaves a PDF under its REAL name and names the
    // export for the same stem scrubbed, so only the key can tell that
    // "Rasho v Quillmark - MTC.pdf" is "Strangeways v Melbury - MTC.txt".
    // The suffixes are not the difficulty: .pdf, .txt and .txt.LEAK all come
    // off before the comparison.
    const haveAny = folderPdfs.length || pickedPdfs.size;
    const parts = [];
    if (!haveAny) {
      parts.push(`<p>No PDF is available to match ${what}: ` +
        (dirHandle ? `no PDF in <b class="fn"></b> to go with this export` : "no case folder is open, and none has been picked by hand") + ".</p>");
    } else if (!key) {
      parts.push(`<p>${folderPdfs.length ? `${folderPdfs.length} PDF${folderPdfs.length === 1 ? "" : "s"} in the case folder, but none matches ` + what : `None of the PDFs picked matches ${what}`}` +
        " — and <b>no pseudonym key is loaded</b>. The PDFs keep their real names and this export is named in pseudonyms, so the key is what tells the two apart.</p>");
    } else {
      parts.push(`<p>${haveAny} PDF${haveAny === 1 ? "" : "s"} available and none matches ${what} by name. ` +
        "Each PDF's own name is run forward through the key and compared with the export's — a PDF renamed since the run, or one of a document the key does not name, will not meet it.</p>");
    }
    parts.push(`<p><button type="button">${members.length > 1 ? "Pick their PDFs…" : "Pick the PDF…"}</button>` +
      (dirHandle ? "" : ` <button type="button" class="secondary openfolder">Open case folder…</button>`) + "</p>");
    parts.push(members.length > 1
      ? "<p>Select every member's PDF at once: each is matched to its document by name through the key, and where the names cannot say, by the order this file lists them.</p>"
      : "<p>Or pick the one PDF this export came from.</p>");
    box.innerHTML = parts.join("");
    const fn = box.querySelector(".fn");
    if (fn) fn.textContent = folderName;
    box.querySelector("button").addEventListener("click", pickPdf);
    const of = box.querySelector(".openfolder");
    if (of) of.addEventListener("click", openFolder);
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
      // The leading page of a combined file is its own list of the documents
      // in it — there is no PDF page for it, and saying so beats an empty box.
      el.textContent = p.banner != null ? TD.pageLabel(p)
        : p.header != null ? "No PDF page for this part"
        : i === 0 && members.length > 1 ? "The file's own list of its documents — no PDF page"
        : "No PDF page for this part";
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
  // A text page with NO PDF page keeps the pane level with it. A combined file
  // always has two kinds: its own contents page at the top, and a banner page
  // before each member — and each of those used to stand beside a stub of a
  // slot sixteen or thirty pixels tall. The columns were out of step from the
  // first page (a 580px contents page against a 16px strip) and ran a few
  // thousand pixels apart over a case's worth of documents, so neither the eye
  // nor the scroll sync could hold them together. The slot is given its text
  // page's own height instead: nothing to show, but the same amount of it.
  //
  // Read first, written after, so the heights come from pages that have already
  // taken their matched sizes above.
  if (on) {
    const blanks = [];
    for (const el of pdfPane.querySelectorAll(".pdf-slot.blank")) {
      const sec = pagesEl.querySelector(`.tpage[data-index="${el.dataset.index}"]`);
      if (sec) blanks.push([el, sec.offsetHeight]);
    }
    for (const [el, h] of blanks) el.style.height = h + "px";
  }
  textAnchors = null; textLineTops = null;
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
let textAnchors = null;  // memo: the text pages' first lines, reset on any relayout
let textLineTops = null; // …the same, measured from each page's own top
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
/** The text pages' anchors, measured once per layout: absolute, and per page. */
function textAnchorsNow() {
  const secs = [...pagesEl.querySelectorAll(".tpage")];
  if (!textAnchors || textAnchors.length !== secs.length) {
    textLineTops = secs.map((sec) => firstLineOffset(sec));
    textAnchors = secs.map((sec, i) => sec.offsetTop + textLineTops[i]);
  }
  return secs;
}
function textGeometry() {
  const secs = textAnchorsNow();
  if (!secs.length) return { tops: [], heights: [] };
  const last = secs[secs.length - 1];
  return PS.anchorGeometry(textAnchors, last.offsetTop + last.offsetHeight);
}
function pdfGeometry() {
  const slots = [...pdfPane.querySelectorAll(".pdf-slot")];
  if (!slots.length) return { tops: [], heights: [] };
  textAnchorsNow(); // the text pages' own offsets, for the slots that have no page
  const anchors = slots.map((el) => {
    if (!el.classList.contains("blank")) return el.offsetTop + pdfFirstLine(el);
    // A slot with no PDF page of its own stands level with its text page and is
    // the same height as it (see applyMatchedLayout), so it takes that page's
    // own anchor: the pair then scrolls as one rather than a page-height apart.
    const at = Number(el.dataset.index);
    return el.offsetTop + (textLineTops && textLineTops[at] != null ? textLineTops[at] : 0);
  });
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
function refreshSwapButtons() {
  // ONE query for every button, rather than asking each page for its own:
  // a page's own query walks that page's whole subtree, and a thousand of
  // those cost more than the rest of the open put together.
  for (const b of pagesEl.querySelectorAll(".swap-page")) {
    const sec = b.closest(".tpage");
    if (!sec) continue;
    const i = Number(sec.dataset.index);
    const t = pdfTarget(i);
    const on = !!t && swaps.has(t.key);
    b.classList.toggle("nopdf", !t);
    // Written only where it changed. Rewriting text that already reads the
    // same is not free: every live Range in the document — and a page of
    // citation underlines and highlighted names leaves thousands behind —
    // is asked to re-measure itself on each character-data change, so a
    // thousand idle rewrites cost more than drawing the underlines did.
    const label = on ? "⇄ Text" : "⇄ PDF";
    if (b.textContent !== label) b.textContent = label;
    const title = !t ? "No PDF matched this document — ⇄ PDF pages… in the toolbar picks one" : on ? "Back to the text of this page" : `Show PDF page ${t.page} here instead of its text`;
    if (b.title !== title) b.title = title;
  }
}
/** Show or hide the PDF page inside each swapped text page (never while side by side). */
function applySwaps() {
  // A PDF page coming into a text page, or leaving it, moves the text below
  // it and the citation underlines with it. Nothing swapped, nothing moved:
  // a document that opens with no pages swapped — which is most of them —
  // does not need its citations placed a second time, and on a long export
  // that second pass is as slow as the first.
  let moved = false;
  // The pages that already show a PDF page, found in one query for the same
  // reason (see refreshSwapButtons).
  const inlines = new Map();
  for (const el of pagesEl.querySelectorAll(".pdf-inline")) {
    const sec = el.closest(".tpage");
    if (sec) inlines.set(sec, el);
  }
  for (const sec of pagesEl.querySelectorAll(".tpage")) {
    const i = Number(sec.dataset.index);
    const t = pdfTarget(i);
    const on = !sbsOn && !!t && swaps.has(t.key);
    if (sec.classList.contains("swapped") !== on) moved = true;
    sec.classList.toggle("swapped", on);
    let inline = inlines.get(sec) || null;
    if (on) {
      if (!inline) {
        inline = slotShell("pdf-inline", "PDF p. " + t.page);
        sec.querySelector(".page-inner").appendChild(inline);
        moved = true;
      }
      if (inline.dataset.page !== String(t.page) || inline.dataset.src !== t.src.name) {
        inline.dataset.page = String(t.page);
        inline.dataset.src = t.src.name;
        delete inline.dataset.rendered;
        inline.classList.remove("ready");
        inline.querySelector(".pdf-tag").textContent = "PDF p. " + t.page;
        presize(inline, t.src, t.page, inlineWidth(sec));
        moved = true;
      }
      inlineObserver.observe(inline);
    } else if (inline) {
      inlineObserver.unobserve(inline);
      if (inline.__task) { try { inline.__task.cancel(); } catch { /* done */ } }
      inline.remove();
      moved = true;
    }
  }
  refreshSwapButtons();
  updatePdfStatus();
  if (moved) placeCitations();
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
/**
 * PDFs picked by hand. For a lone export the first is the document's. For a
 * combined file each is matched to a member: by NAME through the key first
 * (the export is the PDF's stem scrubbed), and where names settle nothing —
 * no key loaded — by ORDER, the picked PDFs against the members the header
 * lists that still lack one, which is what "select them all at once" means.
 */
async function usePickedPdfs(files) {
  const list = [...(files || [])].filter(Boolean);
  if (!list.length || !doc) return;
  const members = PS.combinedMembers(doc.pages);
  if (members.length <= 1) { await usePickedPdf(list[0]); return; }
  const fwdName = fwd ? (s) => forwardText(s).text : null;
  const byName = [], unmatched = [];
  for (const f of list) {
    pdfCache.delete(f.name);
    const src = { name: f.name, file: f };
    pickedPdfs.set(f.name, src);
    const m = members.find((mm) => PS.matchPdf(mm, [f.name], fwdName));
    if (m) byName.push(m); else unmatched.push(src);
  }
  resolvePdfSources();
  const open = membersWithoutPdf();
  let byOrder = 0;
  if (unmatched.length && unmatched.length === open.length) {
    open.forEach((m, i) => pickedByMember.set(m, unmatched[i]));
    byOrder = unmatched.length;
  }
  refreshPdf();
  const left = membersWithoutPdf();
  toast(`${members.length - left.length} of ${members.length} documents have a PDF` + (byName.length ? ` (${byName.length} matched by name` + (byOrder ? `, ${byOrder} by order)` : ")") : byOrder ? ` (${byOrder} matched by order)` : "") +
    (left.length ? ` — still none for ${left.slice(0, 3).join(", ")}${left.length > 3 ? "…" : ""}` : "") +
    (unmatched.length && !byOrder ? ` — ${unmatched.length} picked PDF${unmatched.length === 1 ? "" : "s"} matched no document (pick exactly the ${open.length} missing to match by order)` : "") + ".", { ms: 6000 });
}
async function pickPdf() {
  hideSwapPop();
  if (window.showOpenFilePicker) {
    try {
      const hs = await window.showOpenFilePicker({ multiple: true, types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }] });
      await usePickedPdfs(await Promise.all(hs.map((h) => h.getFile())));
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
  const fs = [...$("pdf-input").files];
  $("pdf-input").value = "";
  await usePickedPdfs(fs);
});

// ── hooks for the PWA tab shell ───────────────────────────────────────────────────────
window.__textReaderLoadLocal = (file, handle) => openFile(file, handle);
window.__textReaderRememberDir = (h) => rememberDir(h);
window.__textReaderReflow = () => { if (doc) placeCitations(); };
window.__pdfViewerUnregister = () => {};
// For the smoke test: the geometry the side-by-side sync reads.
window.__textReaderSyncGeometry = () => ({ text: textGeometry(), pdf: pdfGeometry() });
window.__textReaderSetKey = (parsed) => setKey(parsed);
// …and the leak worksheet's: attach, walk, decide, and the bytes a save
// would write (verified, not written), so the round trip into PDF-Linker's
// own reader can be checked from outside.
window.__textReaderLoadKey = (bytes, name) => loadKeyFromBytes(new Uint8Array(bytes), name, "", { quiet: true });
window.__textReaderAttachLeaks = (bytes, name) => attachLeaks(new Uint8Array(bytes), name, null, { quiet: true });
window.__textReaderGoToLeak = (i) => goToLeak(i);
window.__textReaderDecide = (text, advance) => decideLeak(text, { advance: !!advance });
window.__textReaderLeaks = () => (leaks ? {
  at: leaks.at, barHidden: leaksBar.hidden, dirty: leaksDirty(),
  rows: leaks.parsed.rows.map((r) => ({ n: r.n, value: r.value, fix: r.fix, fix0: r.fix0 })),
  here: leakHere ? { text: leakHere.toString(), gutter: gutterOf(leakHere), page: Number(leakHere.startContainer.parentElement.closest(".tpage").dataset.index) } : null,
  marks: leakRowRanges.length, keeps: keeps.slice(), leakMarks: leakHits.length,
} : null);
window.__textReaderLeaksBytes = async () => Array.from(await XW.writeSheetCells(leaks.bytes, leaks.parsed.part, LK.fixEdits(leaks.parsed)));
window.__textReaderPickPdfs = (files) => usePickedPdfs(files);
window.__textReaderPdfSources = () => pdfSources.map((s) => (s ? s.name : null));
window.__textReaderPdfQueue = () => ({
  queued: pdfJobs.map((j) => j.name),
  busy: pdfJobBusy,
  open: [...pdfCache.keys()].filter((n) => { const p = pdfCache.get(n); return !!(p && p.__info); }),
});
window.__textReaderMaster = (bytes, name) => readMasterBytes(new Uint8Array(bytes), name);
window.__textReaderMasterState = () => ({
  info: masterInfo, keeps: masterKeeps.map((k) => k.control + ":" + k.value),
  needs: !!masterNeeds, seen: [...keptSeen],
});

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
renderLeaksTab();
updateLeaksButton();
// The master workbook's standing keeps, in force before the first document is
// read — the whole point of them is that nobody has to be asked again.
restoreMaster();
