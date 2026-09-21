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
import { dressLines, fitRuleRows, placeholderIn } from "./rules.js";
import * as PS from "./pdfsync.js";
import * as LK from "./leaks.js";
import { keyLibrary, storeKey, fillKeySelect, keyIds } from "./key-library.js";
import * as RD from "./redact.js";
import { buildRedactedPdf } from "./pdf-edit.js";
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
const marksToggle = $("marks-toggle");
const markColorEl = $("mark-color");
const markAlphaEl = $("mark-alpha");
const fakesToggle = $("fakes-toggle");
const reelToggle = $("reel-toggle");
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
// The redaction bar, up here with the other chrome because the bar stack is
// measured (setBarHeight) long before the redaction tool below is reached.
const redactBar = $("redact-bar");
// …and the find bar, measured with them.
const findBar = $("find-bar");

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
const SETTINGS_AT_KEY = "textReader.settingsAt"; // when the local copy was written
const VALUES_PREFIX = "textReader.values.";
// …and what was last WRITTEN to the case folder, so the list can tell whether
// PDF-Linker has been handed what is in it.
const VALUES_SAVED_PREFIX = "textReader.valuesSaved.";
const SPOTS_PREFIX = "textReader.spots.";

let doc = null;              // TD.parseExport result
let fileName = "";
let fileHandle = null;       // FileSystemFileHandle for in-place save
let dirHandle = null;        // the case folder, when one was opened
let folderName = "";
let folderDocs = [];         // [{ name, handle, quarantined }]
let folderPdfs = [];         // [{ name, handle }] — the case folder's PDFs
let key = null;              // parsed key (PK.parseKey)
let rev = null, fwd = null, reals = null, ahead = null; // compiled matchers
let fakesRx = null;          // …and one over the key's FAKES: which pseudonyms stand
let settings = loadSettings();
let flagged = [];            // New Real Values list: names to fake next run
let flagsFor = null;         // …the storage key that list was read from, while a folder is being adopted
let keeps = [];              // …and the keeps: values wrongly faked, left alone next run
let spots = [];              // spot keeps for the open document: [{ page, value, nth }]
let masterKeeps = [];        // standing keeps from PDF-Linker's master workbook (its KEEP sheet)
let masterInfo = null;       // { name, sheet, rows, partial } once it is attached
let masterHandle = null;     // its file handle, remembered between sessions
let masterNeeds = null;      // …the same handle, when the browser wants it re-authorised first
let dirty = false;

// ── the same names, matched once ───────────────────────────────────────────────
//
// Matching a name through the key — an export to its PDF, a LEAKS File cell to
// its export — runs the key FORWARD over every candidate, every time it is
// asked (pdfsync.matchPdf). Asked once per document that is nothing. Asked
// once per row of a worksheet with thousands of rows in it, against a folder
// with hundreds of documents in it, it is hundreds of thousands of
// translations on every open and after every decision — seconds of arithmetic
// at a time, which is a tab that never finishes opening a file.
//
// So the matchers are built once and kept. Each translates its candidates ONCE
// and answers from a map (pdfsync.pdfMatcher, leaks.exportMatcher).
//
// And they are built from the WHOLE key, keeps and all — which is both the
// cheaper thing and the truer one. PDF-Linker named these files from their
// stems run through the key, before anybody had decided to keep anything; the
// names on disk are what they are. Translating them through the key as the
// keeps have left it would make the folder's own names stop matching the
// moment a name in one of them was kept, and would throw the index away on
// every decision — a folder of PDFs costs a translation each to index.
let nameFwdMemo = { key: null, fwd: null };
/** real → fake over a file NAME, through the whole key; null where there is none. */
function fwdName() {
  if (nameFwdMemo.key !== key) nameFwdMemo = { key, fwd: key ? PK.compileForward(key) : null };
  const f = nameFwdMemo.fwd;
  return f ? (s) => PK.forwardRuns(f, s).map((r) => (r.t === "swap" ? r.to : r.s)).join("") : null;
}
let nameMatch = null;
function nameMatchers() {
  if (!nameMatch || nameMatch.key !== key || nameMatch.docs !== folderDocs || nameMatch.pdfs !== folderPdfs) {
    nameMatch = { key, docs: folderDocs, pdfs: folderPdfs, fwdName: fwdName(), pdfFor: null, exportFor: null };
  }
  return nameMatch;
}
/** The folder's PDF an export (or a File cell's name) belongs to, or null. */
function pdfForName(name) {
  const m = nameMatchers();
  if (!m.pdfFor) m.pdfFor = PS.pdfMatcher(folderPdfs.map((p) => p.name), m.fwdName);
  return m.pdfFor(name);
}
/** The folder's export a File cell's name belongs to, or null. */
function exportForName(name) {
  const m = nameMatchers();
  if (!m.exportFor) m.exportFor = LK.exportMatcher(folderDocs.map((d) => d.name), m.fwdName);
  return m.exportFor(name);
}
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
// The browser's own answer to "how long may I keep the thread?" — the way the
// long passes over a document are cut up. A page of a long export under a key
// of a few thousand names is ten milliseconds to read or to build; a hundred
// and fifty of them in one go is a second and a half in a single task, which
// is a page that cannot answer a click. So a pass takes a clock and gives the
// thread back before it runs out.
const SLICE_LEFT = 12; // ms that must be left on the clock to start another page

// ── when the reader holds the thread, it says which pass did it ────────────────
//
// A pass that runs for seconds is a page that answers nothing — no scrolling,
// no buttons, and eventually the browser offering to kill it — and from the
// outside one such pass looks exactly like another. The browser reports the
// tasks (PerformanceObserver, "longtask"); what it cannot say is WHICH pass, so
// the heavy ones write their name down while they run and the report names it.
const passes = [];   // the last few heavy passes: { what, from, to }
const blocked = [];  // …and the long tasks, with the pass each one fell in
function notePass(what, from) {
  passes.push({ what, from, to: performance.now() });
  if (passes.length > 40) passes.shift();
}

// A pass that never ENDS cannot be reported by the page it has stopped: the
// bar cannot be painted, the observer cannot run, and the browser offers to
// kill the tab. So a pass writes its name down BEFORE it starts and rubs it
// out when it finishes — in localStorage, which is written there and then. A
// name still standing when the reader next opens is a pass that did not come
// back, and the reader says so.
const DOING_KEY = "textReader.doing";
const doingStack = [];
function markDoing() {
  try {
    const top = doingStack[doingStack.length - 1];
    if (top) localStorage.setItem(DOING_KEY, JSON.stringify({ what: top.what, file: fileName || "", at: Date.now() }));
    else localStorage.removeItem(DOING_KEY);
  } catch { /* a browser with no storage says nothing, and that is all */ }
}
// Passes that await overlap rather than nest, so an entry is taken out by
// identity, not by being the last one in.
function startDoing(what) { const e = { what }; doingStack.push(e); markDoing(); return e; }
/** Say more precisely what a pass already running is doing. */
function noteDoing(e, what) { if (e) { e.what = what; markDoing(); } }
function endDoing(e) {
  const i = doingStack.lastIndexOf(e);
  if (i >= 0) doingStack.splice(i, 1);
  markDoing();
}
/** Run `fn` under a name: for the long-task report, and for the breadcrumb. */
function during(what, fn) {
  const from = performance.now();
  const e = startDoing(what);
  try { return fn(); } finally { endDoing(e); notePass(what, from); }
}
/** The same for a pass that awaits: it names the whole of itself. */
async function duringAsync(what, fn) {
  const from = performance.now();
  const e = startDoing(what);
  try { return await fn(e); } finally { endDoing(e); notePass(what, from); }
}
/** A slice of a pass already named: the report wants it, the breadcrumb does not. */
function duringSlice(what, fn) {
  const from = performance.now();
  try { return fn(); } finally { notePass(what, from); }
}
// PLAIN READING. A reader that will not come back is no use at all, and the
// operator cannot wait on a diagnosis: this turns off everything the document
// does not strictly need — the marks over the text, the citation underlines,
// the PDF beside it, anything read ahead — and leaves the words on the page.
// It lasts as long as the tab does, and the bar says it is on.
let plain = false;
function setPlain(on) {
  plain = !!on;
  document.body.classList.toggle("plain-reading", plain);
  if (plain) {
    if (sbsOn) setSideBySide(false, { remember: false });
    dropWarmPages();
    dropReady();
    try { CSS.highlights.delete("flagged"); CSS.highlights.delete("leak"); CSS.highlights.delete("kept"); } catch { /* none to clear */ }
  }
  updatePlainStatus();
  if (doc) { paintHighlights(); placeCitationsSoon(); }
}
function updatePlainStatus() {
  const el = $("st-plain");
  if (el) el.textContent = plain ? "Plain reading: the marks, the citation links and the PDF are off" : "";
  const box = $("plain-toggle");
  if (box) box.checked = plain;
}

/** What the reader was in the middle of when it last stopped, if it did. */
function reportLastStuck() {
  let stuck = null;
  try {
    const raw = localStorage.getItem(DOING_KEY);
    if (raw) stuck = JSON.parse(raw);
    localStorage.removeItem(DOING_KEY);
  } catch { /* nothing to report */ }
  window.__textReaderLastStuck = stuck;
  if (!stuck || !stuck.what) return;
  // Not a toast: a toast is gone in a few seconds and under the document, and
  // this is the one line that says what to fix. It stands in the offer bar
  // until it is read, and the button puts it on the clipboard.
  const line = `Last time, the reader stopped while ${stuck.what}${stuck.file ? " — " + stuck.file : ""}, and did not finish.`;
  showKeyOffer(line + " Read plainly to get past it?", "Read plainly", async () => {
    setPlain(true);
    try { await navigator.clipboard.writeText(line); toast("Plain reading is on, and that line is on the clipboard."); }
    catch { toast("Plain reading is on."); }
  });
}
function passAt(start, end) {
  let best = "";
  for (const p of passes) if (p.from <= end && p.to >= start) best = p.what;
  return best;
}
if (typeof PerformanceObserver === "function") {
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const ms = Math.round(e.duration);
        if (ms < 200) continue;
        const what = passAt(e.startTime, e.startTime + e.duration);
        blocked.push({ ms, what, at: new Date().toLocaleTimeString() });
        if (blocked.length > 60) blocked.shift();
        // Long enough that the operator felt it: say so, and say what it was.
        if (ms >= 2500) {
          const line = `The reader held the page for ${(ms / 1000).toFixed(1)} seconds${what ? " — " + what : ""}.`;
          if (!plain) {
            showKeyOffer(line + " Read plainly instead?", "Read plainly", async () => {
              setPlain(true);
              try { await navigator.clipboard.writeText(line); toast("Plain reading is on, and that line is on the clipboard."); }
              catch { toast("Plain reading is on."); }
            });
          }
        }
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch { /* a browser that does not report them */ }
}
/** Every long task since the page was opened, worst first — for a bug report. */
window.__textReaderBlocked = () => blocked.slice().sort((a, b) => b.ms - a.ms);
function idleClock() {
  return new Promise((res) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(res, { timeout: 250 });
    else setTimeout(() => res({ timeRemaining: () => SLICE_LEFT + 1, didTimeout: true }), 0);
  });
}
function lsGet(k, dflt) {
  try { const v = localStorage.getItem(k); return v == null ? dflt : JSON.parse(v); } catch { return dflt; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or off */ }
}

// ── settings ─────────────────────────────────────────────────────────────────
//
// TWO COPIES, AND THE LOCAL ONE CANNOT FAIL. The settings live in
// chrome.storage.sync, so the Options page, a second reader tab and another
// machine all read the same defaults — and a synced write is RATE LIMITED:
// Chrome takes 120 of them a minute and rejects the rest, reporting it in
// `chrome.runtime.lastError` and writing nothing. The mark colour and the
// intensity are set by dragging (an <input type="color"> and a range fire
// `input` the whole way), which used to mean a write per pixel of the drag:
// hundreds in a few seconds, the quota gone in the first second, and the
// colour finally settled on the one most likely to be REJECTED. The screen
// showed it, because the screen is painted from the object in hand, and the
// next session opened yellow again.
//
// So a change is written to localStorage AT ONCE — no quota, no callback,
// the copy the next session opens from — and the synced copy follows a beat
// after the dragging stops, once, with the value settled on. Each copy
// carries when it was written, and the newer wins when they disagree: a
// synced write that never landed cannot undo the choice, and a change made in
// the Options page while this tab was closed still arrives.
//
// "Show fakes" is a view, not a default, and opens off.
function loadSettings() {
  const s = TD.normalizeSettings(lsGet(LEGACY_SETTINGS_KEY, null));
  s.showFakes = false;
  return s;
}
// What is REMEMBERED: everything but the show-fakes view and the stamp, which
// is carried beside the settings rather than in them — a comparison of what
// the reader is showing against what arrived must not turn on the clock.
function persistable(s) {
  const out = Object.assign({}, s);
  delete out.showFakes;
  delete out.savedAt;
  return out;
}
let settingsAt = Number(lsGet(SETTINGS_AT_KEY, 0)) || 0;
function saveSettings() {
  settingsAt = Date.now();
  lsSet(LEGACY_SETTINGS_KEY, persistable(settings));
  lsSet(SETTINGS_AT_KEY, settingsAt);
  syncSettingsSoon();
}
// The synced copy: once the dragging stops, and again as the tab goes away,
// so a change made in the last half second is not left behind.
const syncSettingsSoon = debounce(() => pushSettings(), 400);
function pushSettings() {
  syncSettingsSoon.cancel();
  const body = Object.assign(persistable(settings), { savedAt: settingsAt });
  try {
    chrome.storage.sync.set({ [SETTINGS_KEY]: body }, () => {
      const err = chrome.runtime && chrome.runtime.lastError;
      // Nothing to put right here: the local copy has it, carries the later
      // stamp, and is pushed again by the next change or the next open.
      if (err) console.warn("settings not synced (" + err.message + ") — the local copy stands");
    });
  } catch (e) { console.warn("settings not synced (" + (e.message || e) + ") — the local copy stands"); }
}
window.addEventListener("pagehide", pushSettings);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") pushSettings(); });
function loadSyncedSettings() {
  chrome.storage.sync.get({ [SETTINGS_KEY]: null }, (got) => {
    const stored = got && got[SETTINGS_KEY];
    // The newer copy wins. An older build's synced copy carries no stamp and
    // reads as 0, which is right: a local copy written since is newer, and
    // where there is no local copy at all the synced one still comes in.
    const theirs = stored ? Number(stored.savedAt) || 0 : -1;
    if (stored && theirs >= settingsAt) {
      settings = Object.assign(TD.normalizeSettings(stored), { showFakes: settings.showFakes });
      settingsAt = theirs;
      lsSet(LEGACY_SETTINGS_KEY, persistable(settings));
      lsSet(SETTINGS_AT_KEY, settingsAt);
    } else if (localStorage.getItem(LEGACY_SETTINGS_KEY)) {
      // A write that never landed, or an older build's local copy: push it.
      pushSettings();
    }
    applySettings();
    relayout();
  });
}
// Defaults changed elsewhere — the Options page, another reader tab — apply
// here too, so what the reader shows is always the current default. This
// reader's own writes come back through here as well, and match what it is
// already showing, so they stop at the comparison.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes[SETTINGS_KEY]) return;
  const arrived = changes[SETTINGS_KEY].newValue || null;
  const merged = Object.assign(TD.normalizeSettings(arrived), { showFakes: settings.showFakes });
  if (JSON.stringify(persistable(merged)) === JSON.stringify(persistable(settings))) return;
  settings = merged;
  settingsAt = Number(arrived && arrived.savedAt) || Date.now();
  lsSet(LEGACY_SETTINGS_KEY, persistable(settings));
  lsSet(SETTINGS_AT_KEY, settingsAt);
  applySettings();
  relayout();
});

function applySettings() {
  const root = document.documentElement.style;
  root.setProperty("--reader-font", TD.fontCss(settings));
  root.setProperty("--reader-size", (settings.fontSize * zoomNow()) + "px");
  root.setProperty("--reader-lh", String(settings.lineHeight));
  // The EFFECTIVE size is what the pages use: the size set here, less
  // whatever a page has had to give up to hold its words (shapePages). The
  // width is the paper's and belongs to applyPageWidth, not to any setting.
  root.setProperty("--reader-size-eff", (settings.fontSize * zoomNow()) + "px");
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
  sizeLabel.textContent = Math.round(zoomNow() * 100) + "%";
  lhRange.value = String(settings.lineHeight);
  marksToggle.checked = settings.marks;
  fakesToggle.checked = settings.showFakes;
  reelToggle.checked = settings.reel !== false;
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
$("size-down").addEventListener("click", () => zoomText(-1));
$("size-up").addEventListener("click", () => zoomText(1));

// ── zoom: the words, not the window ──────────────────────────────────────────
//
// Ctrl+wheel and Ctrl+plus are what a reader reaches for when the type is too
// small, and the browser answers them by scaling the whole window — the
// toolbar, the tools panel, the status bar, the bar over the leaks worksheet
// — which is the part nobody wanted bigger. The tools are furniture; the
// words are the work. So the gesture is caught and spent on the READING SIZE
// instead: the size the pages are drawn at, the size that sets the scale both
// sheets take side by side, the size remembered with the rest of the
// settings. Ctrl+0 puts it back to the built-in default.
//
// Caught over the whole window, not just the pages, so a pointer that happens
// to be over the panel does not zoom the panel; and caught in the capture
// phase, before anything else reads the key.
// A step of a tenth each way, the way a PDF viewer steps, and Ctrl+0 back to
// the page at its own size.
function zoomText(step) {
  const now = zoomNow();
  const next = step === 0 ? 1 : Math.min(5, Math.max(0.25, Math.round(now * Math.pow(1.1, step) * 100) / 100));
  if (Math.abs(next - now) < 0.001) return;
  settings.zoom = next;
  saveSettings();
  applySettings();
  relayout();
}
// A trackpad pinch arrives as a few dozen small wheel deltas; a step per tick
// would take the type from nine to forty in one gesture, so the deltas are
// added up and spent a step at a time.
const ZOOM_STEP_PX = 50;
let zoomRoll = 0;
window.addEventListener("wheel", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault(); // …and the browser's own zoom with it
  zoomRoll += e.deltaY;
  const steps = Math.trunc(zoomRoll / ZOOM_STEP_PX);
  if (!steps) return;
  zoomRoll -= steps * ZOOM_STEP_PX;
  zoomText(-steps); // a wheel away from the reader (negative) is bigger type
}, { passive: false });
window.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  const k = e.key;
  if (k === "+" || k === "=") { e.preventDefault(); zoomText(1); }
  else if (k === "-") { e.preventDefault(); zoomText(-1); }
  else if (k === "0") { e.preventDefault(); zoomText(0); }
}, true);
lhRange.addEventListener("input", () => { settings.lineHeight = Number(lhRange.value); saveSettings(); applySettings(); relayout(); });
marksToggle.addEventListener("change", () => { settings.marks = marksToggle.checked; saveSettings(); applySettings(); hideTip(); });
markColorEl.addEventListener("input", () => { settings.markColor = markColorEl.value; saveSettings(); applySettings(); });
markAlphaEl.addEventListener("input", () => { settings.markAlpha = Number(markAlphaEl.value); saveSettings(); applySettings(); });
fakesToggle.addEventListener("change", () => { settings.showFakes = fakesToggle.checked; saveSettings(); applySettings(); showFakes(settings.showFakes); });
// The grid is asked for, not assumed: a page laid on its PDF's geometry is a
// different page to read — another width, another type size, every line moved
// to its number's height — and the reader's first business is the words. Side
// by side without it is the PDF beside the text, scrolling together, the text
// exactly as it reads with the pane closed. applyMatchedLayout lifts the grid
// the moment this goes off, the way closing the pane does.
reelToggle.addEventListener("change", () => {
  settings.reel = reelToggle.checked;
  saveSettings();
  if (settings.reel) { reelDone = false; reelDoneUp = false; reelMaybeExtend(); }
  else toast("The reel is off — this document ends where it ends, at both ends. What is already hanging off it stays until the next one is opened.");
});
// ── print ────────────────────────────────────────────────────────────────────
// The pages as they are shown, to paper or to a PDF — the browser's own
// dialog, where "Save as PDF" is a destination. What prints is the display:
// the font and leading in force, the boxes drawn, one sheet per page. The
// chrome around the pages is dropped in the print stylesheet, nothing is
// re-laid, and the citation strips are left off, being overlays measured for
// the screen.
//
// THE NAMES ARE THE ONE THING THE PRINTOUT DOES NOT TAKE FROM THE SCREEN. A
// printout leaves the room, and a copy of the screen would carry whatever the
// screen shows — with Show fakes off, the real names. So a print does to the
// pages what a save does to the file: the forward pass over every page (the
// values kept for the case and the spot keeps left exactly as they read, as
// always), and then the pseudonyms on show, whichever way the toggle sits.
// Paper and PDF carry the scrubbed copy without anyone having to remember,
// and Ctrl+P is the button by another name.
//
// The document itself is not touched. The pages go back as they were the
// moment the dialog closes, nothing is written, the file on disk is the file
// it was, and the undo stack never hears of it: a real name standing unfaked
// is still standing, still orange, still there to be dealt with before a save.
$("print-btn").addEventListener("click", () => window.print());

const PRINT_WIDTH_PX = 700;
let printPut = null; // while a print is being prepared: how the pages go back

/** Every real name the key binds shown as its pseudonym, for the printout only. */
function fakesForPrint() {
  if (!doc || printPut) return; // a dialog over another: the first put-back stands
  const bodies = pageBodies();
  const was = { html: bodies.map((b) => b.innerHTML), fakes: document.body.classList.contains("show-fakes") };
  let moved = false;
  if (fwd && fwd.rx) {
    during("scrubbing the pages for print", () => {
      for (const body of bodies) {
        const { text, held } = TD.serializeHeld(body);
        const fw = forwardText(text, held);
        if (!fw.swaps) continue;
        buildBody(body, fw.text, pageIndexOf(body));
        moved = true;
      }
    });
  }
  if (!settings.showFakes) {
    for (const s of pagesEl.querySelectorAll(".pn")) s.textContent = s.dataset.fake;
    document.body.classList.add("show-fakes");
    moved = true;
  }
  printPut = moved ? was : null;
}

/** …and the pages as they were, the moment the dialog closes. */
function pagesBackAfterPrint() {
  const was = printPut;
  printPut = null;
  if (!was) return;
  pageBodies().forEach((b, i) => { if (was.html[i] != null) b.innerHTML = was.html[i]; });
  document.body.classList.toggle("show-fakes", was.fakes);
  afterTextChange(); // the marks and the underlines are ranges into the old nodes
}

// The sheets keep their screen width in print, so nothing re-wraps, and the
// widest one is zoomed to the paper's printable width (letter and A4 alike) —
// measured after the names are swapped, that being what goes to paper.
// THE NAME THE PRINT IS SAVED UNDER is the document's title, so for the length
// of the print the title is the document's own name and nothing else.
//
// Two things were wrong with it. The reading title carries " — Text Reader",
// which is not part of any filename anybody wants; and in the hosted app the
// reader is an iframe, where a print is a print of the SHELL — whose title was
// the app's name, so every "Save as PDF" came out called PDF Viewer whatever
// was open. The shell is same-origin, so it is told too, and both are put back
// afterwards.
//
// The stem, not the file name: the browser appends ".pdf", and
// "Rasho v Quillmark - MTC.txt.pdf" is a filename with a lie in the middle.
let titleBeforePrint = null;
function printTitle() {
  const m = typeof reelCurrent === "function" ? reelCurrent() : null;
  const n = (m && m.name) || fileName || "document";
  return n.replace(/\.txt(\.LEAK)?$/i, "").trim() || "document";
}
window.addEventListener("beforeprint", () => {
  fakesForPrint();
  let w = 0;
  for (const t of pagesEl.querySelectorAll(".tpage")) w = Math.max(w, t.offsetWidth);
  document.documentElement.style.setProperty("--print-zoom", String(w > PRINT_WIDTH_PX ? PRINT_WIDTH_PX / w : 1));
  const name = printTitle();
  titleBeforePrint = { self: document.title, top: null, had: false };
  document.title = name;
  try {
    if (window.top !== window && window.top.document) {
      titleBeforePrint.top = window.top.document.title;
      titleBeforePrint.had = true;
      window.top.document.title = name;
    }
  } catch { /* another origin above us: its own title stands */ }
});
window.addEventListener("afterprint", () => {
  document.documentElement.style.removeProperty("--print-zoom");
  pagesBackAfterPrint();
  if (titleBeforePrint) {
    document.title = titleBeforePrint.self;
    if (titleBeforePrint.had) { try { window.top.document.title = titleBeforePrint.top; } catch { /* gone */ } }
    titleBeforePrint = null;
  }
});

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
/**
 * A decision was taken that the Flagged list now holds — a value flagged, a
 * pseudonym kept. The list is where it went, so the panel SHOWS it: but only
 * if the panel is already open.
 *
 * It used to open the panel to say so. That is the panel deciding it knows
 * better than the reader: flagging is done while reading, often several in a
 * row, and having the page narrow and re-lay itself each time — the PDF pane
 * with it — is the reading interrupted to be told something the toast already
 * said. What the decision actually needs is not to be SHOWN but not to be
 * LOST, and that is the save prompt's job, not the panel's.
 */
function noteInFlagged() {
  if (!document.body.classList.contains("side-hidden")) showSideTab("tab-flags");
}
$("panel-toggle").addEventListener("click", () => showSidePanel(document.body.classList.contains("side-hidden"), { remember: true }));
$("side-collapse").addEventListener("click", () => showSidePanel(false, { remember: true }));

// The tools rail down the left margin — the PDF viewer's, with the reading,
// pseudonym, review and PDF tools on it. It collapses to an icon strip rather
// than away, so a tool is always one click off; the choice is remembered.
{
  const railBtn = $("tools-rail-collapse");
  const applyTools = (collapsed) => {
    document.body.classList.toggle("tools-collapsed", collapsed);
    railBtn.setAttribute("aria-expanded", String(!collapsed));
    railBtn.title = collapsed ? "Expand the tools panel" : "Collapse the tools panel";
  };
  applyTools(lsGet("textReader.tools", false) === true);
  railBtn.addEventListener("click", () => {
    const collapsed = !document.body.classList.contains("tools-collapsed");
    applyTools(collapsed);
    lsSet("textReader.tools", collapsed);
    relayout();
  });
}
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
// The keys themselves live in key-library.js: one library in storage, shared
// with the PDF viewer, so a key loaded here is the key a redaction runs on.
const fillKeys = (selectedId) => fillKeySelect(keySelect, selectedId);

// Every keep in force: this case's own, and the standing ones the master
// workbook carries between cases (see attachMaster). The master's are consulted
// wherever a keep is consulted and written nowhere — PDF-Linker already holds
// them, and New Real Values.txt is for this case's decisions.
// The two as one list — and the same list each time they have not moved, since
// what is asked of it is asked thousands of times over and textdoc.keptControl
// indexes a list by its identity; a fresh array per call would be indexed
// again on every call.
let allKeepsMemo = { keeps: null, master: null, all: [] };
function allKeeps() {
  if (allKeepsMemo.keeps !== keeps || allKeepsMemo.master !== masterKeeps) {
    allKeepsMemo = { keeps, master: masterKeeps, all: masterKeeps.length ? keeps.concat(masterKeeps) : keeps };
  }
  return allKeepsMemo.all;
}
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
//
// ONLY THE KEEPS THE KEY BINDS. A keep exists to stop a value being faked,
// and a value the key does not bind was never going to be: the master
// workbook carries the settled decisions of every other matter — "Court",
// "Clerk", "County", a hundred names from cases this one has nothing to do
// with — and blanking those changes nothing at all, the forward side having
// no row that could reach them. What it costs is real: an alternation over
// hundreds of values, compiled and run over every page on every save and
// every repaint. So the matcher is the keeps that do work, which is the same
// list the marks are drawn from (keptMarkMatcher, one and the same now).
//
// One matcher per set of keeps, not per call. Both lists are replaced rather
// than edited in place whenever they change, and so is the key, so their
// identity is the whole test.
function keptMatcher() { return keptMarkMatcher(); }
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
    // …and the answers, since the question is asked of every keep on every
    // repaint and the matcher is an alternation of the whole key.
    keyBindsMemo = { key, rx: reals.length ? PK.buildMatcher(reals) : null, seen: new Map() };
  }
  const rx = keyBindsMemo.rx;
  if (!rx) return false;
  const v = String(value == null ? "" : value);
  if (!keyBindsMemo.seen.has(v)) {
    rx.lastIndex = 0; // a global matcher carries its place between tests
    keyBindsMemo.seen.set(v, rx.test(v));
  }
  return keyBindsMemo.seen.get(v);
}
// The keeps that DO WORK: the ones the key binds. A keep is worth seeing —
// and worth blanking the text for — because it says "this name was left alone
// on purpose", which only means something where the name would otherwise have
// been faked or flagged. Marking the rest would underline half the page to no
// purpose, and masking the rest is work done to prevent something that was
// never going to happen.
let keptMarkMemo = { keeps: null, master: null, key: null, rx: null };
function keptMarkMatcher() {
  if (keptMarkMemo.keeps !== keeps || keptMarkMemo.master !== masterKeeps || keptMarkMemo.key !== key) {
    const mine = allKeeps().filter((k) => keyBinds(k.value));
    keptMarkMemo = { keeps, master: masterKeeps, key, rx: mine.length ? PK.buildMatcher(mine.map((k) => k.value)) : null };
  }
  return keptMarkMemo.rx;
}
// The flagged values, matched: one matcher per list, not one per reading. The
// list is replaced whenever it changes, so its identity is the whole test —
// and building one is a small pattern per value, which a long list makes a
// cost worth paying once.
let flagRxMemo = { flagged: null, rx: null };
function flaggedMatcher() {
  if (flagRxMemo.flagged !== flagged) {
    flagRxMemo = { flagged, rx: flagged.length ? PK.buildMatcher(flagged) : null };
  }
  return flagRxMemo.rx;
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
  // The names of decided cases are blanked with the keeps: a party of a
  // decision this brief cites is that decision's, not this matter's, and a
  // save that wrote a pseudonym over it would put out a citation to a case
  // that does not exist (textdoc.citedNameSpans).
  const spared = (held || []).concat(TD.citedNameSpans(text));
  const runs = PK.forwardRuns(fwd, TD.blankRanges(maskKept(text), spared));
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
  const out = during("compiling the key", () => compileKeyNow());
  dropSweep(); // the folder was read under the key that has just changed
  dropFlagsNowFaked();
  return out;
}
/**
 * A flagged value the key now fakes comes off the list: the run did the job.
 *
 * The flag was the job — "this name is in the clear, fake it" — and the key
 * coming back with the name in it is the run's answer. Left on the list it
 * would go into the next New Real Values.txt and be handed over again, and it
 * would go on wearing the red mark in a document where it no longer stands in
 * the clear. This runs wherever the key is compiled, which is wherever the key
 * or the keeps move: a folder opened after a run, a key chosen by hand, a keep
 * withdrawn.
 */
function dropFlagsNowFaked() {
  if (!flagged.length || !fwd) return;
  // …and only once the list in hand is the one this folder's storage holds. A
  // folder is adopted name first, key second, list third: between the key
  // being compiled and the list being read, `flagged` is still the LAST
  // folder's, and dropping from it here would write one matter's flags into
  // another's.
  if (flagsFor !== valuesStoreKey()) return;
  const { kept, dropped } = TD.dropFlagsInKey(flagged, fwd);
  if (!dropped.length) return;
  flagged = kept;
  persistValues();
  renderFlags();
  paintHighlights(); // the red marks go with the flags
  toast(`${dropped.length} flagged value${dropped.length === 1 ? " is" : "s are"} in the key now — ${dropped.slice(0, 3).join(", ")}${dropped.length > 3 ? "…" : ""} — and ${dropped.length === 1 ? "has" : "have"} come off the list.`);
}
function compileKeyNow() {
  const k = keyLessKeeps(key);
  rev = key ? PK.compile(key) : null;
  fwd = k ? PK.compileForward(k) : null;
  reals = k ? PK.compileReals(k) : null;
  // Over the WHOLE key, keeps and all. Taking a value out of the forward side
  // is what a keep does; the question this one answers is whether the run
  // faked that very value somewhere, and a matcher the keep had emptied could
  // only ever answer no.
  fakesRx = key ? PK.compileFakes(key) : null;
  // A kept value is never offered, and a real that opens one stays partial.
  ahead = k ? PK.compileTypeahead(k, allKeeps().map((x) => x.value)) : null;
  warmMatchers();
}
// A key's matcher is one alternation over every name in it, and the ENGINE
// does not build it until something is matched against it — a few thousand
// names is five seconds of that, once. The first thing to use it is the first
// document opened, which used to carry the whole cost and take twenty seconds
// to show a page. So the matchers are put to work here, on a scrap of text,
// while the operator is still looking at the folder list and nobody is
// waiting on them. Idle time, and never on the path of anything.
let warmingMatchers = 0;
function warmMatchers() {
  clearTimeout(warmingMatchers);
  const ready = [rev, fwd, reals];
  warmingMatchers = setTimeout(() => {
    const run = () => {
      for (const c of ready) {
        if (!c || !c.rx) continue;
        try { c.rx.lastIndex = 0; c.rx.exec("the quick brown fox"); c.rx.lastIndex = 0; } catch { /* nothing to warm */ }
      }
      try { const rx = keptMatcher(); if (rx) { rx.lastIndex = 0; rx.exec("the quick brown fox"); rx.lastIndex = 0; } } catch { /* the same */ }
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2000 });
    else run();
  }, 0);
}
function setKey(parsed) {
  key = parsed || null;
  // Pages built ahead of time carry this key's translation: under another one
  // they are simply wrong, so they go, and the window fills again.
  staleReady();
  compileKey();
  $("st-key").textContent = key ? "Key: " + PK.keyTitle(key) + (key.dropped.ambiguous ? ` (${key.dropped.ambiguous} ambiguous fake${key.dropped.ambiguous === 1 ? "" : "s"} retired)` : "") : "";
  // Another key binds other values: what the last one proposed over a PDF is
  // its reading, not this one's, and goes. Boxes drawn by hand stay — they
  // were never the key's to propose.
  redactKeyChanged();
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
  fillKeys(id);
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
  return duringAsync("reading the case folder", () => adoptFolderNow(h, { quiet }));
}
async function adoptFolderNow(h, { quiet = false } = {}) {
  // Another matter: the PDFs go, and with them any redaction proposed over
  // them — boxes are a thing you are in the middle of, and this folder's
  // pages are not that folder's.
  if (dirHandle !== h) { forgetPdfs(); dropReady(); clearRedactions("the case folder changed"); }
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
  flagsFor = valuesStoreKey();
  keeps = stored.keeps;
  if (found.valuesHandle) {
    try {
      const onDisk = TD.parseReaderFile(await (await found.valuesHandle.getFile()).text());
      // A value the key already fakes is not brought back in: the file on disk
      // is the list as it stood when it was last written, and PDF-Linker has
      // answered it since. Silently, because the file is not the operator's
      // own list moving — the list itself is pruned where it is compiled,
      // which says so once.
      for (const v of onDisk.values) if (!TD.fakeFor(fwd, v)) flagged = TD.addValue(flagged, v);
      for (const k of onDisk.keeps) if (!TD.keptControl(keeps, k.value)) keeps = TD.addKeep(keeps, k.control, k.value);
    } catch { /* unreadable: the in-memory list stands */ }
  }
  persistValues();
  compileKey();
  renderFlags();
  renderDocList();
  // The folder's own leak worksheet, attached as its key is; one from
  // another folder is dropped, since its rows name that folder's files.
  if (found.leaksHandle) {
    try {
      const f = await found.leaksHandle.getFile();
      const parsed = await attachLeaks(new Uint8Array(await f.arrayBuffer()), f.name, found.leaksHandle, { quiet: true, folder: folderName });
      if (parsed && !quiet) {
        const und = LK.undecidedCount(parsed.rows);
        toast(`${f.name}: ${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"}` + (und ? `, ${und} to answer — ⚠ Leaks to review them.` : ", every row answered."));
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
// The bar takes its own height above the stage (--offer-h), the way the LEAKS
// bar does, so it never covers the first lines or the head of the tools rail.
function syncOfferHeight() {
  document.documentElement.style.setProperty("--offer-h", keyOffer.hidden ? "0px" : keyOffer.offsetHeight + "px");
}
function showKeyOffer(text, action, onAct) {
  $("key-offer-text").textContent = text;
  const btn = $("key-offer-btn");
  btn.textContent = action;
  btn.onclick = async () => { hideKeyOffer(); await onAct(); };
  keyOffer.hidden = false;
  syncOfferHeight();
}
function hideKeyOffer() { keyOffer.hidden = true; syncOfferHeight(); }
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
    if (!key) showKeyOffer("No key attached. Open this file's case folder once — the picker opens where the file is — and its pseudonym_key.xlsx is attached by itself from then on.", "Open case folder…", () => openFolder(handle || null));
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
  return duringAsync("opening the document", () => openFileNow(file, handle));
}
async function openFileNow(file, handle) {
  if (!file) return;
  if (dirty && !confirm("Discard unsaved edits to " + fileName + "?")) return;
  hideKeyOffer();
  // The case folder first, so the document renders under its own key — and so
  // a document built ahead of time is judged against the key it will open under.
  try { await attachKeyForFile(handle || null); } catch (e) { console.warn(e); }
  const built = readyFor(file);
  if (built) {
    ready.delete(file.name); // the reader owns it from here: it is about to be edited
    openText("", file.name, handle || null, built);
    warmForLeaks();
    return;
  }
  openText(await file.text(), file.name, handle || null);
}

function openText(text, name, handle, built) {
  doc = built ? built.doc : TD.parseExport(text);
  fileName = name;
  fileHandle = handle;
  // A document opened is the head of a new reel, whatever was hanging off the
  // last one. `doc.pages` grows from here as the folder is read on.
  reelReset(doc, name, handle, []);
  reelJustOpened = true;
  dirty = false;
  editing = false;
  typeDismissed = null;
  clearHistory();
  document.body.classList.remove("editing");
  $("edit-toggle").setAttribute("aria-pressed", "false");
  document.title = name + " — Text Reader";
  leakStep = -1; // a new document, a new walk through what stands in its clear
  answered = 0;
  decidedHere = 0;
  if (!leakJump) showNamesBar(false); // …unless the walk is what opened it
  if (!dirHandle) loadValuesFor(name);
  spots = TD.normalizeSpots(lsGet(spotStoreKey(), []));
  if (reel[0]) reel[0].spots = spots;
  // A document built ahead of time goes up as it stands, unless its spot keeps
  // have moved since it was built — then its pages are built again from the
  // parse, which is already in hand.
  marksGetAnotherChance();
  if (built && JSON.stringify(built.spots) === JSON.stringify(spots)) showPages(built.nodes, built);
  else render();
  setupPdfForDoc();
  markDocList();
  renderReelState();
  // A keep taken because one document carried the value in the clear is read
  // again against this one: a folder's keeps are the case's, and a pseudonym
  // standing anywhere in it is a run the case folder is owed after all.
  refreshKeepLocality();
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

/**
 * The case folder, picked.
 *
 * A page cannot walk UP from a file to the folder it sits in — the browser
 * gives a file handle and nothing above it, and that is the whole reason this
 * is a pick at all. What it can do is open the picker AT the file: `startIn`
 * takes a handle, and for a file handle the picker opens in the folder
 * holding it, so the case folder (or the Text Files folder it sits in) is
 * already on screen and the pick is one click. After that the folder is
 * remembered and every document under it attaches its key by itself.
 */
async function openFolder(startIn) {
  if (!window.showDirectoryPicker) { toast("This browser cannot open a folder; open a file instead.", { error: true }); return; }
  let h;
  const opts = { mode: "readwrite" };
  if (startIn) opts.startIn = startIn;
  else if (fileHandle) opts.startIn = fileHandle; // the folder this document is in
  try { h = await window.showDirectoryPicker(opts); }
  catch (e) {
    if (e && e.name === "AbortError") return;
    // An unusable startIn is not worth failing over: ask again without it.
    if (opts.startIn) { try { h = await window.showDirectoryPicker({ mode: "readwrite" }); } catch (e2) { if (e2 && e2.name !== "AbortError") toast(String(e2.message || e2), { error: true }); return; } }
    else { toast(String(e.message || e), { error: true }); return; }
  }
  if (dirty && !confirm("Discard unsaved edits to " + fileName + "?")) return;
  hideKeyOffer();
  const found = await adoptFolder(h);
  // THE TEXT FILES FOLDER IS NOT THE CASE FOLDER. It is the easy mistake —
  // the documents are in it, so it looks like the place — and everything that
  // makes a case folder a case folder is one level up: the key, the PDFs, the
  // LEAKS worksheet, the flagged list. The reader cannot step up on its own
  // (no handle leads to its parent), so it says so and opens the picker there
  // again, where the folder above is one click away.
  if (looksLikeTextFiles(h, found)) {
    showKeyOffer(`${h.name} is the folder the exports live in, not the case folder: the key, the PDFs and the worksheet are the level above it.`,
      "Choose the folder above…", () => openFolder(h));
  }
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
$("open-folder").addEventListener("click", () => openFolder());

/**
 * Whether what was picked is the Text Files subfolder rather than the case
 * folder: named as PDF-Linker names it, or carrying exports and none of the
 * things that only a case folder has.
 */
function looksLikeTextFiles(h, found) {
  if (h.name.toLowerCase() === TD.TEXT_SUBFOLDER.toLowerCase()) return true;
  return !!found.rootDocs.length && !found.textDir && !found.keyHandle && !found.pdfs.length && !found.leaksHandle;
}

async function openFolderDoc(d) {
  try {
    const f = await d.handle.getFile();
    await openFile(f, d.handle);
  } catch (e) { toast("Could not open " + d.name + ": " + (e.message || e), { error: true }); }
}

function renderDocList() {
  docsList.innerHTML = "";
  for (const d of folderDocs) {
    const li = document.createElement("li");
    li.textContent = TD.docLabel(d.name);
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
    li.addEventListener("click", () => openFolderDoc(d));
    li.dataset.name = d.name;
    docsList.appendChild(li);
  }
  renderDocReady();
  markDocList();
  markDocAlerts();
}
function markDocList() {
  for (const li of docsList.children) li.classList.toggle("current", li.dataset.name === fileName);
}

// ── the ⚠ beside a document still carrying a real value ──────────────────────
//
// The marks answer the document that is OPEN, and the status bar counts what
// the rest of the folder is carrying as a number. Neither says WHICH of the
// forty it is without opening them, and the Documents list is where the
// operator chooses the next one — so what each one is carrying belongs beside
// its name.
//
// A document is marked where a real value is still standing in it: a name the
// key binds that the run left in the clear, or a value flagged for the next
// run. Both are the same thing to a reader — a real value that is really
// there — and both are the marks over the text, said document by document.
/**
 * What each document of the folder is carrying, by file name: { leaks, flags }.
 * The folder's documents come from the sweep, which reads each file's own
 * text; the ones ON THE PAGE are taken from the marks over them instead.
 * Where the marks are off — plain reading, or a document they cost too much
 * on — the page has no answer to give and the file's stands.
 */
function docAlerts() {
  const out = new Map();
  for (const r of sweep.rows) {
    const leaks = r.values.filter((v) => !isSettled(v)).length;
    const flags = r.flags || 0;
    if (leaks || flags) out.set(r.doc.name, { leaks, flags });
  }
  // …and the documents the last paint actually read answer for themselves:
  // the marks know the edits the file has not been given yet and the names
  // the walk has settled. Only the ones that were READ — with the folder read
  // on, the reel sheds the far end of itself, and a document off the page has
  // no count of its own to give.
  if (scanned && !marksOff && !plain) {
    const live = liveLeaks();
    for (const name of scannedDocs) {
      const leaks = live.filter((h) => h.doc === name).length;
      const flags = flaggedHits.get(name) || 0;
      if (leaks || flags) out.set(name, { leaks, flags });
      else out.delete(name);
    }
  }
  return out;
}
function alertTitle(a) {
  const bits = [];
  if (a.leaks) bits.push(`${a.leaks} name${a.leaks === 1 ? "" : "s"} the key binds standing unfaked`);
  if (a.flags) bits.push(`${a.flags} flagged value${a.flags === 1 ? "" : "s"} still in the clear`);
  return "Still carrying a real value: " + bits.join(" and ") + ". Open it to see where.";
}
/** The mark itself, put beside each document that has one and taken off the rest. */
function markDocAlerts() {
  const alerts = docAlerts();
  for (const li of docsList.children) {
    const a = alerts.get(li.dataset.name);
    let tag = li.querySelector(".tag.alert");
    if (!a) { if (tag) tag.remove(); continue; }
    if (!tag) {
      tag = document.createElement("span");
      tag.className = "tag alert";
      tag.textContent = "⚠";
      li.appendChild(tag);
    }
    tag.title = alertTitle(a);
  }
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
/**
 * A document's pages as DOM, built into `into` — `#pages` itself, or a
 * fragment held off the page (buildAhead). `from`/`to` build a slice of
 * them, so a long document can go up a piece at a time without the page
 * going unresponsive; `theirSpots` are that document's own spot keeps.
 */
function buildPages(into, pages, { from = 0, to = pages.length, spots: theirSpots = null, editable = false } = {}) {
  for (let i = from; i < to; i++) {
    const p = pages[i];
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
        // Read off the section at the click, never closed over: a document
        // hung ABOVE this one renumbers every page below it (reelShift).
        b.addEventListener("click", (e) => { e.preventDefault(); toggleSwap(Number(sec.dataset.index)); });
        lab.appendChild(b);
      }
      sec.appendChild(lab);
    }
    const inner = document.createElement("div");
    inner.className = "page-inner";
    const body = document.createElement("div");
    body.className = "page-body";
    body.contentEditable = editable ? "plaintext-only" : "false";
    body.spellcheck = false;
    buildBody(body, p.lines.join("\n"), i, theirSpots);
    const layer = document.createElement("div");
    layer.className = "link-layer";
    inner.append(body, layer);
    sec.appendChild(inner);
    into.appendChild(sec);
  }
}

function render() {
  pagesEl.innerHTML = "";
  emptyEl.hidden = true;
  pagesEl.hidden = false;
  during("building the document's pages", () => buildPages(pagesEl, doc.pages, { editable: editing }));
  stageEl.scrollTop = 0;
  afterTextChange();
  autoRemeasure({ newDoc: true });
}
/** The keeps as they stand, so a built document can tell whether they have moved. */
function keepsSignature() { return allKeeps().map((k) => k.control + ":" + k.value).join("|"); }
/**
 * A document built ahead of time, put on the page as it stands.
 *
 * Its pseudonym spans are brought up to date first — the keeps and the
 * fake/real toggle can both have moved since it was built, and neither is
 * worth building the document again for — and that is done while the pages
 * are still OFF the page, where a write costs nothing. The same writes made
 * after they are on it cost a second on a long document, which is more than
 * building the whole thing from scratch.
 */
function showPages(nodes, built) {
  const fakes = !!built && built.fakes !== settings.showFakes;
  const marks = !!built && built.keeps !== keepsSignature();
  if (fakes || marks) {
    for (const s of nodes.querySelectorAll(".pn")) {
      if (fakes) s.textContent = settings.showFakes ? s.dataset.fake : s.dataset.real;
      if (marks) markKept(s);
    }
  }
  pagesEl.innerHTML = "";
  emptyEl.hidden = true;
  pagesEl.hidden = false;
  pagesEl.appendChild(nodes);
  stageEl.scrollTop = 0;
  afterTextChange();
  autoRemeasure({ newDoc: true });
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
function buildBody(body, text, page, theirSpots) {
  body.innerHTML = "";
  body.classList.toggle("numbered", TD.pageIsNumbered(text.split("\n")));
  const runs = rev ? PK.translateRuns(rev, text) : [{ t: "text", s: text }];
  const pageSpots = theirSpots || spots;
  // The page's spot keeps, as places in the text it is being built from. `at`
  // follows the same text as the runs are laid out, so each spot's own
  // characters go into a span of their own — carrying no fake, so the value
  // stays as it reads here while every other occurrence is faked as usual.
  const holds = TD.spotRanges(text, TD.spotsOnPage(pageSpots, page));
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
  dressBody(body);
}
// PDF-Linker ends an export with a trailer of its own: a
// "====== Authorities cited (public verification links) ======" rule and a
// line per authority with its verification URL. It is part of the FILE — it
// round-trips, it saves, it is translated under the key like everything else
// — and no part of the filed document: the PDF beside it has no such page,
// and a tail the PDF never had pushes the last sheet out of the shape the
// rest of them hold. So the lines are marked here and hidden by the
// stylesheet while the PDF pane is open. Marked, never removed: the file
// still carries it and a save still writes it.
const TRAILER_RE = /^\s*=+\s*Authorities cited\b.*?=+\s*$/i;
function markTrailer(body) {
  let inside = false;
  for (const line of body.querySelectorAll(":scope > .line")) {
    if (!inside && TRAILER_RE.test(line.textContent)) inside = true;
    line.classList.toggle("trailer", inside);
  }
}
/** Everything a rebuilt page body needs before it is measured: the boxes, then the trailer. */
function dressBody(body) {
  dressLines(body);
  markTrailer(body);
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
  applyPageWidth();
  // The citations settle a beat after the edit rather than with it. Reading
  // a long export for citations is the one part of this that a long document
  // makes slow — the scan is of the whole text, since a short form ("Ibid.",
  // an italicized name) means what the cite BEFORE it means, wherever on the
  // way it stands — and doing it between keystrokes is what made a long
  // document feel stuck. Everything else here is the edit itself and stays
  // immediate; the underlines catch up once the typing stops.
  placeCitationsSoon();
  // The text moved, so what the document-wide pass found no longer stands and
  // it has to be made again — a beat later, like the citations and for the
  // same reason. Under a key of a few thousand names a long export is seconds
  // of scanning, and doing it inside the open is a document that takes seconds
  // to appear; doing it between keystrokes is an editor that will not type.
  // The marks catch up the moment the reader stops.
  textEpoch++;
  paintHighlights();
  refindSoon(); // …and the find's own ranges, which the rebuilt pages have dropped
  // The pages are where they are now: auto-scroll takes its pace from them
  // again rather than from the layout it started under.
  autoRemeasure();
}
const afterTextChangeSoon = debounce(afterTextChange, 400);
const placeCitationsSoon = debounce(() => placeCitations(), 450);
const relayout = debounce(() => { reelAllLive(); syncOfferHeight(); textAnchors = null; textLineTops = null; applyMatchedLayout(); applyPageWidth(); placeCitations(); refitPdf(); if (sbsOn) syncScroll("text", true); autoRemeasure(); reelTrimSoon(); }, 150);
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
  setDirty(true, pageIndexOf(body));
  offerAtCaret(body);
  convertTypedRealsSoon(body);
  afterTextChangeSoon();
});

function setDirty(on, pageIndex) {
  // A reel holds several files: the edit is the business of the one whose page
  // it was made in, and a save writes that file and not the rest.
  if (on) reelMarkDirty(pageIndex);
  else for (const m of reel) m.dirty = false;
  if (dirty !== on) { dirty = on; updateDirty(); }
}
/**
 * What a save would write besides the text, as names.
 *
 * A save is not only the document. Flagging a value the run missed, keeping
 * one it wrongly faked, answering a row of the LEAKS worksheet — each is a
 * decision that lives in the browser until it is written into the case folder,
 * and each is work PDF-Linker's next run will not see until it is. None of
 * them touches the text, so none of them makes the document dirty, and 💾 Save
 * used to sit greyed out over a whole review's worth of them — a state where
 * the button says there is nothing to save and there is.
 */
function pendingWrites() {
  const out = [];
  if (valuesDirty()) out.push(TD.VALUES_FILE);
  if (leaksDirty()) out.push(leaks ? leaks.name : "LEAKS.xlsx");
  return out;
}
/**
 * How many real names the key binds are standing in the clear on the page —
 * which is to say, HOW MUCH OF THE FILE A SAVE WOULD REWRITE without anybody
 * typing a character.
 *
 * A name the run left in the clear is work the save does on its own: the
 * forward pass swaps it for its pseudonym and the member it stands in is
 * written, edited or not (saveDocument's `touched`). The save has always done
 * that; what it did not do was SAY so — Save was lit by an edit, by the
 * document being unlocked, or by a decision owed to the case folder, and a
 * document whose only outstanding work was the run's own leftovers sat with
 * Save greyed. The operator had to press ✎ Edit, change nothing, and save:
 * unlocking a protected document to make the button work is exactly what the
 * protection exists to prevent.
 *
 * Every hit of the last paint, settled or not: "fake it" answers the WALK,
 * not the save, and a name nobody has looked at is rewritten just the same.
 * Kept values, spot keeps and the parties of cited decisions are not in this
 * count, because the save does not touch them either.
 */
function standingInTheClear() {
  return leakHits.filter((h) => h.range && h.range.startContainer && h.range.startContainer.isConnected).length;
}
function updateDirty() {
  const pending = pendingWrites();
  const clear = doc ? standingInTheClear() : 0;
  const names = `${clear} real name${clear === 1 ? "" : "s"}`;
  const asPn = clear === 1 ? "its pseudonym" : "pseudonyms";
  // Enabled whenever a save would DO something: the text edited, the document
  // unlocked for editing, a decision waiting to be written into the folder, or
  // a real name standing in the clear for the save to write as its pseudonym.
  saveBtn.disabled = !doc || !(editing || dirty || pending.length || clear);
  saveBtn.title = dirty || editing
    ? "Write your edits back to the file — pseudonyms underneath, never the real names (Ctrl+S)" +
      (pending.length ? ` · ${pending.join(" and ")} too` : "")
    : pending.length
      ? `Write ${pending.join(" and ")} into the case folder (Ctrl+S)` +
        (clear ? ` — and ${names} standing in the clear, written as ${asPn}` : " — the text is unchanged and is not rewritten")
      : clear
        ? `Write ${names} standing in the clear as ${asPn} (Ctrl+S) — the save does it on its own; nothing has to be edited first`
        : "Write your edits back to the file — pseudonyms underneath, never the real names (Ctrl+S)";
  $("edit-toggle").disabled = !doc;
  rawBtn.disabled = !doc;
  $("st-dirty").textContent = dirty ? "● Unsaved edits"
    : pending.length ? "● " + pending.join(" and ") + " to write" + (clear ? `, and ${names} to fake` : "")
    : clear ? `● ${names} to write as ${asPn} — Save does it`
    : (doc && !editing ? "Protected — ✎ Edit to change" : "");
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
  dressBody(body);
  fixGutterSpacing(body);
  placeCaret(ltOf(target), 0);
  setDirty(true, pageIndexOf(body));
  afterTextChange();
  return true;
}
/**
 * The rest of a paste: `pieces` laid into the slots after the caret, all at
 * once. What stands after the caret rides down with the last piece, and on
 * pleading paper the text below moves down by as many slots as there are
 * pieces — the blank slots it passes absorbing a piece each, exactly as each
 * Enter's cascade stopped at the first empty line below it.
 */
function insertLinesAtCaret(body, pieces) {
  const cl = caretLine(body);
  if (!cl || !pieces.length) return false;
  const { line, pt: at } = cl;
  const lt = ltOf(line);
  const r = document.createRange();
  r.setStart(at.container, at.offset);
  r.setEnd(lt, lt.childNodes.length);
  const tail = r.extractContents();
  for (const br of [...tail.querySelectorAll("br")]) br.remove();
  // The pieces as fragments; the last one carries the tail down with it, and
  // its own text node is where the caret is left.
  let caretNode = null;
  const frags = pieces.map((piece, i) => {
    const f = document.createDocumentFragment();
    if (piece) {
      const t = document.createTextNode(piece);
      f.appendChild(t);
      if (i === pieces.length - 1) caretNode = t;
    }
    return f;
  });
  frags[frags.length - 1].appendChild(tail);
  let caretSlot = null;
  if (!body.classList.contains("numbered")) {
    let after = line;
    frags.forEach((f, i) => {
      const nl = newLineAfter(after);
      ltOf(nl).appendChild(f);
      if (i === frags.length - 1) caretSlot = nl;
      after = nl;
    });
  } else {
    const below = [];
    for (let cur = line.nextElementSibling; cur; cur = cur.nextElementSibling) if (cur.classList.contains("line")) below.push(cur);
    const contents = below.map((l) => extractAll(ltOf(l)));
    let absorb = frags.length;
    const kept = [];
    for (const f of contents) {
      if (absorb > 0 && !f.textContent.length) { absorb--; continue; }
      kept.push(f);
    }
    const seq = frags.concat(kept);
    seq.forEach((f, i) => {
      const slot = below[i] || newLineAfter(body.lastElementChild);
      ltOf(slot).appendChild(f);
      if (i === frags.length - 1) caretSlot = slot;
    });
  }
  dressBody(body);
  fixGutterSpacing(body);
  if (caretNode) placeCaret(caretNode, caretNode.data.length);
  else if (caretSlot) placeCaret(ltOf(caretSlot), 0);
  setDirty(true, pageIndexOf(body));
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
  dressBody(body);
  fixGutterSpacing(body);
  const at = pointAtOffset(plt, joinAt);
  placeCaret(at.node, at.offset);
  setDirty(true, pageIndexOf(body));
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
const GUTTER_FIXED = "The line numbers are fixed: edit within a line, or join lines with Backspace at a line's start.";
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
// A paste goes in as ONE edit, its first piece typed where the caret stands
// (so it replaces a selection, and the line numbers keep their guard) and the
// rest laid into the slots below in a single pass.
//
// It used to be typed in line by line, an Enter per break, so that pasted
// text moved between the slots exactly as typed text does. It does still —
// but an Enter on pleading paper pushes EVERY line below it down a slot, and
// then re-reads the whole document: the counts, the matched layout, the line
// lock, the citations and the highlights, over every page. A multi-paragraph
// block pasted from the PDF beside it meant one cascade and one re-read per
// line, each dearer than the last, and the page stopped answering until the
// last of them was done. Now the cascade happens once and the document is
// re-read once, at the end.
pagesEl.addEventListener("paste", (e) => {
  const body = e.target && e.target.closest && e.target.closest(".page-body");
  if (!body || !editing) return;
  const text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
  e.preventDefault();
  if (!text) return;
  if (selectionCrossesGutter(body)) { toast(GUTTER_FIXED, { error: true }); return; }
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  snapshot(body, true);
  batchEdit = true;
  try {
    const sel = document.getSelection();
    if (lines[0]) document.execCommand("insertText", false, lines[0]);
    else if (sel && !sel.isCollapsed) document.execCommand("delete");
    if (lines.length > 1) insertLinesAtCaret(body, lines.slice(1));
  } finally { batchEdit = false; }
  // The document has just been read whole; the settle the typing itself asked
  // for would only read it again.
  afterTextChangeSoon.cancel();
  if (lines.length === 1) afterTextChange();
  convertTypedRealsSoon(body);
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
  setDirty(true, pageIndexOf(body));
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
  const body = bodyForPage(snap.page);
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
  setDirty(true, pageIndexOf(body));
  afterTextChange();
}
function undo() {
  const snap = undoStack.pop();
  if (!snap) return;
  const body = bodyForPage(snap.page);
  if (body) redoStack.push(snapshotOf(body));
  restoreSnapshot(snap);
  lastSnapPage = -1;
}
function redo() {
  const snap = redoStack.pop();
  if (!snap) return;
  const body = bodyForPage(snap.page);
  if (body) undoStack.push(snapshotOf(body));
  restoreSnapshot(snap);
  lastSnapPage = -1;
}
function clearHistory() { undoStack = []; redoStack = []; lastSnapPage = -1; }
pagesEl.addEventListener("beforeinput", (e) => {
  const body = e.target && e.target.closest && e.target.closest(".page-body");
  if (!body) return;
  if (e.inputType === "historyUndo" || e.inputType === "historyRedo") { e.preventDefault(); return; }
  if (selectionCrossesGutter(body)) { e.preventDefault(); toast(GUTTER_FIXED, { error: true }); return; }
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
// What a closing tab would leave behind: an edited document unsaved, a
// flagged list never written to the case folder, LEAKS decisions not yet in
// the workbook, or a real name the key binds still standing in the clear in
// the document on screen. The middle two survive the close — they are
// remembered here — but nothing downstream has them: PDF-Linker reads the
// folder, and the folder has not been told.
//
// THE LAST ONE IS THE FILE ITSELF. A name the run left in the clear is a real
// value sitting in a scrubbed export, and the save is what writes the
// pseudonym over it (standingInTheClear). Closing on one loses no decision —
// the name is still there to be found again — but it leaves the file carrying
// a real value while the operator believes the document has been read, and
// that is the mistake this whole tool exists to prevent. Better a prompt that
// sometimes says what you already knew than a close that quietly leaves a
// name in a filing.
//
// The browser's own dialog is all a page gets; which of the four it is, the
// panels and the status bar say.
window.addEventListener("beforeunload", (e) => {
  if (!dirty && !valuesDirty() && !leaksDirty() && !standingInTheClear()) return;
  e.preventDefault();
  e.returnValue = "";
});

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
//
// ONE FILE PER MEMBER. A reel is several documents read as one, and it is never
// written as one: each member's own pages are serialized on their own and go
// back through that member's own handle, under its own name. What is written is
// what was EDITED — a document scrolled past and not typed in is not rewritten,
// so reading forty documents does not put forty files' timestamps through a
// review that changed one line of one of them. A save with nothing edited at
// all still writes the document being read, which is what Ctrl+S has always
// meant for a document on its own.
/** Writes the document (and what the case folder is owed); false where it did not. */
async function saveDocument() {
  if (!doc) return false;
  let forwarded = 0;
  // Each page as it will be written, and the same text with its spot keeps
  // blanked — what the standing assertion below is allowed to look at.
  const scan = [];
  // The members the forward pass changed, on top of the ones already edited.
  const touched = new Set();
  for (const body of pageBodies()) {
    const i = pageIndexOf(body);
    let { text, held } = TD.serializeHeld(body);
    if (fwd && fwd.rx) {
      const fw = forwardText(text, held);
      if (fw.swaps) {
        snapshot(body, true);
        forwarded += fw.swaps;
        buildBody(body, fw.text, i);
        ({ text, held } = TD.serializeHeld(body)); // the rebuilt page, its spots found again
        touched.add(reelMemberOf(i));
      }
    }
    doc.pages[i].lines = text.split("\n");
    scan[i] = TD.blankRanges(text, held).split("\n");
  }
  let write = reel.filter((m) => m.dirty || touched.has(m));
  // Nothing about the TEXT changed. If the save was asked for because a flag,
  // a keep or a worksheet row is waiting, write those and leave every file's
  // bytes and timestamp alone; only an otherwise-empty Ctrl+S falls through to
  // rewriting the document being read, which is what it has always meant.
  if (!write.length && !pendingWrites().length && reelCurrent()) write = [reelCurrent()];
  // The standing assertion, per file. Nothing above should let a bound real
  // value through, and if something did the save must not — and it must not
  // write any of the others on the strength of this one being clean, so every
  // file about to be written is read first and one failure stops the lot. A
  // value kept where it stands is the one thing that may pass: it is in the
  // file because the operator put it there, so the assertion reads the export
  // with those places blanked.
  if (reals) {
    for (const m of write) {
      const held = TD.serializeExport(memberDoc(m, (p, i) => Object.assign({}, p, { lines: scan[i] || p.lines })));
      const left = PK.findReals(reals, TD.blankRanges(maskKept(held), TD.citedNameSpans(held)));
      if (left.length) {
        toast(`Not saved: ${m.name} still carries a real name the key binds — ` + left.slice(0, 4).map((w) => w.real).join(", ") + (left.length > 4 ? "…" : "") + ". Delete or retype it and save again.", { error: true });
        return false;
      }
    }
  }
  const wrote = [];
  for (const m of write) {
    const ok = await writeText(TD.serializeExport(memberDoc(m)), m.name, m.handle, { adopt: reel.length === 1 });
    if (!ok) {
      if (wrote.length) toast(`Saved ${wrote.join(", ")} — ${m.name} was not written.`, { error: true });
      return false;
    }
    m.dirty = false;
    wrote.push(m.name);
    // The save wrote every name that was standing in the clear in this one, so
    // the folder's answer for that document is that it has none.
    sweep.rows = sweep.rows.filter((r) => r.doc.handle !== m.handle);
  }
  setDirty(false);
  // THE LIST GOES WITH IT. The flags and keeps are half of the same decision
  // the document carries — a value kept is a value this save left standing —
  // and a list still sitting in the browser is a run's worth of work the next
  // run will not do. Written into the case folder without asking, that being
  // where PDF-Linker reads it; where there is no folder there is nobody to
  // write it for, and the save says so rather than opening a picker nobody
  // asked for.
  let alsoList = "";
  if (valuesDirty()) {
    alsoList = await saveValuesFile({ quiet: true, folderOnly: true })
      ? ` · ${TD.VALUES_FILE} written too (${flagged.length} to fake, ${keeps.length} to keep)`
      : " · the flagged list is still unwritten — no case folder is open, so save it from the Flagged panel";
  }
  // …and the worksheet, for the same reason: the rows answered while reading
  // this document are decisions about this document, and a decision left in
  // the browser is one PDF-Linker's next run will not see. Written in place,
  // through the worksheet's own handle or the case folder's; where there is
  // neither there is nobody to write it for, and the save says so.
  if (leaksDirty()) {
    const n = await saveLeaks({ quiet: true, folderOnly: true });
    alsoList += n
      ? ` · ${leaks.name} written too (${n} decision${n === 1 ? "" : "s"})`
      : " · the LEAKS decisions are still unwritten — save them from the ⚠ Leaks bar";
  }
  if (forwarded) afterTextChange();
  updateDirty();
  toast(!wrote.length
    ? (alsoList ? "Saved" + alsoList.replace(/^ · /, " ").replace(/ written too /g, " ") : "Nothing to save.")
    : (wrote.length > 1 ? `Saved ${wrote.length} documents: ` : "Saved ") + wrote.join(", ") +
      (forwarded ? ` · ${forwarded} real name${forwarded === 1 ? "" : "s"} written as pseudonym${forwarded === 1 ? "" : "s"}` : "") + alsoList);
  return true;
}
saveBtn.addEventListener("click", saveDocument);
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); saveDocument(); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); flagSelection(); }
});

/**
 * One member as a document in its own right: its own newline and its own
 * trailing newline, and its own run of pages out of the reel. `map` is for the
 * save's standing assertion, which reads the same pages with the spot keeps
 * blanked.
 */
function memberDoc(m, map) {
  const pages = doc.pages.slice(m.from, m.from + m.count);
  return {
    newline: m.newline, trailingNewline: m.trailingNewline,
    pages: map ? pages.map((p, i) => map(p, m.from + i)) : pages,
  };
}

/**
 * Write text: in place through the handle, else the Save picker, else a
 * download. `adopt` is for the DOCUMENT alone — a file chosen in the picker
 * becomes the file this reader saves to from then on, which is right for the
 * document and wrong for anything else. The flagged list goes through here
 * too, and saving it under its own suggested name used to make New Real
 * Values.txt the document's handle: the next Ctrl+S wrote the export over the
 * list.
 */
async function writeText(text, name, handle, { adopt = false } = {}) {
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
      if (adopt && handle == null && h && h.name === name) fileHandle = h;
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

// ── the page's own width ───────────────────────────────────────────────────────────────
//
// A PAGE IS A PAGE. The sheet is 8.5 inches of paper at 96 to the inch and
// nothing the reader does changes that: there is no width to set, no lock to
// widen it for a long line, and zooming makes the TYPE bigger and the paper
// not at all. What gives instead is the type — a line too long for the column
// or a page with more on it than the paper holds is drawn smaller (shapePages
// below) — because a filing that has to be scrolled sideways to be read is
// not a page, and a page whose borders move with the zoom is not paper.
//
// The one thing that does move it is the window: where the stage is narrower
// than a sheet, the sheet takes what there is, the alternative being a page
// that will not fit the screen it is read on.
//
// Pleading paper is read by its line numbers, and a numbered line that WRAPS
// puts its tail on a screen line with no number — read across to the PDF,
// that is one line off. Those lines are therefore never wrapped (the
// stylesheet holds them to one line), which makes them run past the column
// instead, and the type shrinking to fit is what brings them back. What was
// Line lock is the ordinary state of the page now, and costs nothing to say.
/**
 * ZOOM IS MAGNIFICATION, the way a PDF zooms: the page is drawn larger and
 * nothing on it moves or changes size in relation to it. The paper and the
 * type are scaled by the SAME number, so the layout at 200% is the layout at
 * 100% with a magnifying glass over it — the same words on the same lines, in
 * the same places on the page — and what does not fit the window is reached
 * by scrolling, as it is in a PDF viewer.
 *
 * Which is why the scale is in the page's own pixels rather than a CSS `zoom`
 * over the top: everything the reader measures — the fit, the PDF's grid, the
 * boxes an export draws, the two columns' scroll sync — goes on being measured
 * in one space, and the type is drawn at its real size rather than a bitmap
 * blown up, so it stays sharp at any magnification.
 */
function zoomNow() { return Math.min(5, Math.max(0.25, Number(settings.zoom) || 1)); }
/** The paper at 100%: a page of it, or the stage where that is narrower. */
function paperWidth() {
  return Math.max(280, Math.min(TD.PAGE_WIDTH, stageEl.clientWidth - 32));
}
/** …and as it is drawn, magnification and all. */
function pageWidthNow() {
  return Math.round(paperWidth() * zoomNow());
}
function applyPageWidth() {
  const root = document.documentElement.style;
  root.setProperty("--reader-size-eff", (settings.fontSize * zoomNow()) + "px");
  const w = pageWidthNow();
  root.setProperty("--reader-width", w + "px");
  root.setProperty("--reader-width-eff", w + "px");
  const st = $("st-lock");
  st.textContent = !doc ? ""
    : pagesEl.querySelector(".tpage.matched")
      ? "Side by side: the text in the PDF's own type sizes, on the PDF's own grid — the reading size has no say while the grid is on"
      : "";
  shapePages();
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
  return during("finding the citations", () => placeCitationsNow());
}
/** Every underline off the pages, wherever the links are not wanted. */
function clearCitationLinks() {
  for (const layer of pagesEl.querySelectorAll(".link-layer")) {
    if (layer.__cites === "") continue;
    layer.__cites = "";
    layer.innerHTML = "";
  }
}
function placeCitationsNow() {
  placeCitationsSoon.cancel();
  if (!doc) return;
  // Plain reading: no underlines, and the ones already drawn go with the rest
  // of what that mode turns off.
  if (plain) { clearCitationLinks(); return; }
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
  const seen = new Map();
  let linked = 0;
  // ON THE PDF'S GRID: the authorities are still read, and nothing is drawn
  // over the text. An underline is a strip measured off the line it sits
  // under, and the grid moves that line — against a body it has shifted, and
  // again as each PDF's sizes arrive — so the strips land beside the words as
  // often as under them. The pass stops at the reading while the grid is on:
  // the Table of Authorities is filled as always (its entries carry the links,
  // and a cite opened from there opens the same page), and the pages carry no
  // links until the grid comes off. The pane on its own leaves the lines where
  // they flow, so there the links are drawn and are right.
  if (gridOn()) {
    for (const c of found) {
      const url = resolveUrl(c, citationRepo, provider);
      if (url && !seen.has(c.key)) seen.set(c.key, { key: c.key, kind: c.kind, url });
    }
    clearCitationLinks();
    lastCites = [...seen.values()];
    $("st-cites").textContent = lastCites.length
      ? `${lastCites.length} authorit${lastCites.length === 1 ? "y" : "ies"} found — the links are off on the PDF's grid`
      : "";
    renderToa();
    return;
  }
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
    if (!m.rect) m.rect = m.body.getBoundingClientRect();
    return m;
  };
  // The numbers are measured only for a page that has a citation running
  // across one — a cite that stands within its own line draws a single strip
  // and can hold no number. On a pleading export that is nearly every cite,
  // and measuring all twenty-eight numbers of all two hundred pages (and
  // asking each of them, for each cite, whether the cite reaches it) was the
  // bulk of what a re-read cost.
  const gutters = (m) => {
    if (!m.gutters) m.gutters = [...m.body.querySelectorAll(".gutter")].map((g) => ({ el: g, box: g.getBoundingClientRect() }));
    return m.gutters;
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
    const rects = [...range.getClientRects()].filter((r) => r.width >= 1);
    const boxes = rects.length > 1 ? gutters(m).filter((g) => range.intersectsNode(g.el)).map((g) => g.box) : [];
    const strips = [];
    for (const r of rects) {
      if (boxes.some((g) => r.left >= g.left - 0.5 && r.right <= g.right + 0.5 && r.top >= g.top - 0.5 && r.bottom <= g.bottom + 0.5)) continue;
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
  // A page's underlines are rewritten only where they have CHANGED. Every
  // layer used to be emptied and redrawn on every pass, and a pass runs on
  // every settled edit: a two-hundred-page export threw away five thousand
  // links and built five thousand more for one typed character, which got
  // slower the longer the reader stayed on the document. The strips a page
  // wants are a short string; where it matches what that layer already
  // carries, the layer is left alone.
  const byLayer = new Map();
  for (const m of maps) byLayer.set(m.body.nextElementSibling, []);
  for (const p of plans) {
    const mine = byLayer.get(p.layer);
    if (mine) mine.push(p);
  }
  for (const [layer, mine] of byLayer) {
    const sig = mine.map((p) => p.kind + " " + p.url + " " + p.key + " " +
      p.strips.map((r) => Math.round(r.left) + "," + Math.round(r.top) + "," + Math.round(r.width)).join(";")).join("\n");
    if (layer.__cites === sig) continue;
    layer.__cites = sig;
    layer.innerHTML = "";
    for (const p of mine) {
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
        layer.appendChild(a);
      }
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
// The marks over the text come from TWO passes, and only one of them is
// expensive.
//
// The document-wide pass reads every page under the key's own matcher — every
// real name standing unfaked, every flagged value, every kept one. Under a key
// of a couple of thousand names, over a forty-page export, that is most of a
// second: it is the single most expensive thing the reader does, and a
// profile of a LEAKS review is three quarters findRealSpans.
//
// The row pass marks the value in the bar, wherever it stands. That is one
// value, and it is cheap.
//
// Answering a row changes the row, not the document: the same names are
// unfaked, the same values flagged. So the document-wide pass is made once for
// each state of what it reads — the text, the key, the flags, the keeps — and
// its ranges stand until one of those moves; stepping through a worksheet
// repaints the row alone. When one of them DOES move (a `no` mirrored as a
// keep), the pass is made again a beat later rather than between keystrokes,
// so a fast operator is never waiting on it.
let textEpoch = 0;   // bumped whenever the text under the marks changes
let scanned = null;  // what the last document-wide pass was made of
function scanStale() {
  return !scanned || scanned.epoch !== textEpoch || scanned.reals !== reals || scanned.flagged !== flagged
    || scanned.keeps !== keeps || scanned.master !== masterKeeps || scanned.spots !== spots;
}
function paintHighlights() {
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
  paintRowMarks();
  if (plain || marksOff) return; // the words, and nothing read over them
  if (scanStale()) scanSoon();
}
const scanSoon = debounce(() => { if (scanStale()) scanDocument(); }, 150);
let scanning = false;
/**
 * The document-wide pass, made a few pages at a time against the browser's own
 * idle clock: on a hundred-and-fifty-page export under a key of four thousand
 * names it is a second and a half of reading, and a second and a half in one
 * task is a reader that does not answer. Nothing is shown until the pass is
 * whole — the marks that are up are the last complete reading, which is the
 * right thing to leave standing — and a pass whose ground moves under it
 * (an edit, the key, a keep) gives up and is made again.
 */
async function scanDocument() {
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
  if (scanning) { scanSoon(); return; }
  scanning = true;
  try {
    if (!(await scanPass())) scanSoon();
  } finally { scanning = false; }
}
/**
 * The marks cost more than they are worth on this document: stop, leave the
 * words on the page, and say so where it will be read. The operator can turn
 * plain reading on from the bar or the rail; the marks come back with the next
 * document, or with the next key.
 */
function giveUpOnMarks(spent, page, pages) {
  marksOff = true;
  flaggedHits = new Map();
  scannedDocs = new Set();
  scanSoon.cancel();
  try { CSS.highlights.delete("flagged"); CSS.highlights.delete("leak"); CSS.highlights.delete("kept"); } catch { /* none to clear */ }
  $("st-leaks").textContent = "";
  $("st-kept").textContent = "";
  const line = `The marks over the text took more than ${Math.round(spent / 1000)} seconds on this document (page ${page} of ${pages}) and are off for it. The words are all here; the names are not marked.`;
  showKeyOffer(line + " Read plainly?", "Read plainly", async () => {
    setPlain(true);
    try { await navigator.clipboard.writeText(line); toast("Plain reading is on, and that line is on the clipboard."); }
    catch { toast("Plain reading is on."); }
  });
}

/** The current LEAKS row's value, marked wherever it stands. */
function paintRowMarks() {
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
  leakRowRanges = [];
  if (leakRowValue) for (const body of pageBodies()) for (const r of leakMatches(body, leakRowValue)) leakRowRanges.push({ body, range: r });
  CSS.highlights.set("leakrow", highlightOf(leakRowRanges.map((x) => x.range)));
  markLeakHere();
}
/** One reading of the whole document; false where it gave up part-way. */
async function scanPass() {
  return duringAsync("reading the marks over the text", (e) => scanPassNow(e));
}
// What the marks may cost before the reader stops trying. A pass that cannot
// finish is worse than no marks at all: the page it is reading is a page
// nobody can scroll, and the browser ends up offering to kill it. Past this,
// the reader gives up on the marks for this document, says so, and leaves the
// words on the page.
const MARK_BUDGET = 8000; // ms of work, added up across the slices
let marksOff = false;     // …and whether it has given up
async function scanPassNow(pass) {
  const mark = { epoch: textEpoch, reals, flagged, keeps, master: masterKeeps, spots };
  const moved = () => mark.epoch !== textEpoch || mark.reals !== reals || mark.flagged !== flagged
    || mark.keeps !== keeps || mark.master !== masterKeeps || mark.spots !== spots;
  const flaggedRanges = [];
  const leakRanges = [];
  const hits = [];
  const seen = new Set();
  // With the folder read on, one page list holds several documents, and a
  // mark belongs to the one whose page it stands on — not to the one at the
  // head of the reel. The Documents list says what EACH is carrying, so the
  // reading is kept per document from here rather than counted as one.
  const flagCounts = new Map();
  const docsSeen = new Set();
  let leaks = 0;
  const bodies = pageBodies();
  let clock = null;
  const flagRx = flaggedMatcher();
  // A value KEPT stands in the clear like any other word, and with the orange
  // mark gone (it is not a leak) nothing said it was a decision rather than an
  // oversight. It carries the same dotted mark a kept pseudonym does, so a
  // page read later shows which names were left alone on purpose.
  const keptRx = keptMarkMatcher();
  const keptRanges = [];
  let markFrom = performance.now();
  let spent = 0;
  let page = 0;
  let gaveUp = false;
  // The thread is put down HERE — between handfuls of names, not between pages.
  // A PDF export is pages and could be read a page at a time; a Word export has
  // no page headers at all, so the whole of it is ONE page, and a page at a
  // time is the whole document in one go: the reader would hold the thread
  // until the browser offered to kill it. `breathe` is where it stops, wherever
  // it has got to, and where it gives up if the marks are costing too much.
  const breathe = async (what) => {
    if (clock && clock.timeRemaining() >= SLICE_LEFT) return true;
    spent += performance.now() - markFrom;
    notePass("reading the marks over the text", markFrom);
    if (spent > MARK_BUDGET) { giveUpOnMarks(spent, page, bodies.length); gaveUp = true; return false; }
    noteDoing(pass, what);
    clock = await idleClock();
    markFrom = performance.now();
    return !moved();
  };
  const HANDFUL = 250; // names read before the clock is looked at again
  for (const body of bodies) {
    page++;
    const dname = docNameOfBody(body);
    docsSeen.add(dname);
    const where = bodies.length > 1 ? ` (page ${page} of ${bodies.length})` : "";
    if (!(await breathe(`reading the marks over the text${where}`))) return gaveUp;
    // Over the whole page, pseudonym spans blanked, so a real name wrapped
    // over a line break and its gutter number is found as one. The spots kept
    // where they stand are blanked with them: they carry their own mark.
    //
    // ALL THREE READINGS ARE MADE OF IT — the names in the clear, the kept
    // values and the flagged ones. What a pseudonym span holds is the fake
    // that is IN THE FILE, with the real name painted over it for reading
    // only; no mark that says "this real value is still standing here" may
    // be drawn over one, whichever mark it is.
    const flat = reals || keptRx || flagRx ? flatten(body, { blankPn: true }) : null;
    if (reals) {
      const { text, segs } = flat;
      const masked = maskKept(text);
      // Most of what a key matches in a brief belongs to the decisions it
      // cites, not to this matter. Those are not leaks and are not marked:
      // see textdoc.citedNameSpans, which the save reads the same way.
      const cited = TD.citedNameSpans(text);
      let at = 0;
      for (;;) {
        const { spans, next } = PK.findRealSpansFrom(reals, masked, at, HANDFUL);
        for (const h of spans) {
          if (TD.insideSpans(cited, h.start, h.end)) continue; // a cited decision's party
          const r = rangeFor(segs, h.start, h.end);
          if (!r) continue;
          leakRanges.push(r);
          hits.push({ range: r, real: h.real, fake: h.fake, doc: dname });
          leaks++;
        }
        if (next < 0) break;
        at = next;
        if (!(await breathe(`reading the marks over the text${where} — the names from the key`))) return gaveUp;
      }
    }
    if (keptRx) {
      const { text, segs } = flat;
      keptRx.lastIndex = 0;
      let m, n = 0;
      while ((m = keptRx.exec(text))) {
        const r = rangeFor(segs, m.index, m.index + m[0].length);
        if (r) keptRanges.push(r);
        seen.add(TD.foldValue(PK.foldGaps(m[0])));
        if (m.index === keptRx.lastIndex) keptRx.lastIndex++;
        if (++n % HANDFUL === 0) {
          const held = keptRx.lastIndex;
          if (!(await breathe(`reading the marks over the text${where} — the kept values`))) return gaveUp;
          keptRx.lastIndex = held; // the clock does not move the reading on
        }
      }
    }
    if (flagRx) {
      // The same reading as the others, and for the reason above: the red
      // mark says the flagged value is standing in the clear and the next run
      // has yet to fake it, and inside a pseudonym span the run has already
      // faked it — the file carries the fake, and only the screen shows the
      // real name. A mark there says the opposite of what is true. (The
      // flag pop-up refuses such a selection for the same reason; see
      // textdoc.flagProblem.) A spot keep is blanked with them: the value
      // stands there because the operator put it back, and it carries its
      // own mark.
      const { text, segs: all } = flat;
      flagRx.lastIndex = 0;
      let m, n = 0, mine = 0;
      while ((m = flagRx.exec(text))) {
        const r = rangeFor(all, m.index, m.index + m[0].length);
        if (r) { flaggedRanges.push(r); mine++; }
        if (m.index === flagRx.lastIndex) flagRx.lastIndex++;
        if (++n % HANDFUL === 0) {
          const held = flagRx.lastIndex;
          if (!(await breathe(`reading the marks over the text${where} — the flagged values`))) return gaveUp;
          flagRx.lastIndex = held;
        }
      }
      if (mine) flagCounts.set(dname, (flagCounts.get(dname) || 0) + mine);
    }
  }
  noteDoing(pass, "reading the marks over the text — putting them on the page");
  // Whole, so it goes up: the ranges, what the right-click menu reads off them,
  // and the state this reading was made of.
  leakHits = hits;
  flaggedHits = flagCounts;
  scannedDocs = docsSeen;
  keptSeen = seen;
  scanned = mark;
  CSS.highlights.set("flagged", highlightOf(flaggedRanges));
  CSS.highlights.set("leak", highlightOf(leakRanges));
  CSS.highlights.set("kept", highlightOf(keptRanges));
  // The row's own marks stand on the same pages, so they are laid again over
  // the pass that has just been made.
  paintRowMarks();
  renderLeakStatus();
  sweepFolder(); // …and what the other documents of the folder are carrying
  const nk = keptRanges.length;
  $("st-kept").textContent = nk ? `${nk} kept value${nk === 1 ? "" : "s"} standing as ${nk === 1 ? "it reads" : "they read"}` : "";
  return true;
}
let leakHits = []; // where each real name from the key stands unfaked: [{ range, real, fake }], from the last paint
let flaggedHits = new Map(); // …and per document on the page, how many flagged values stand in its clear
let scannedDocs = new Set(); // …and which documents that paint actually read (the reel sheds the far end)
/** The document a page belongs to: the reel's member where the folder is read on, else the open file. */
function docNameOfBody(body) {
  if (reel.length < 2) return fileName;
  const sec = body.closest(".tpage");
  const i = sec ? Number(sec.dataset.index) : -1;
  const m = i >= 0 ? reelMemberOf(i) : null;
  return m ? m.name : fileName;
}
/**
 * The count of names standing in the clear, the folder's share of them, and
 * whatever the walk was waiting on. Called by the paint that counted them and
 * again by the folder sweep, which changes the second half of the sentence
 * without touching the page.
 */
function renderLeakStatus() {
  const leaks = liveLeaks().length;                       // still to answer
  const done = leakHits.length - leaks;                   // …and settled, still to be written
  const leakEl = $("st-leaks");
  const rest = restOfFolder();
  const restN = rest.reduce((t, r) => t + r.count, 0);
  const more = rest.length ? ` (and ${restN} in ${rest.length} other document${rest.length === 1 ? "" : "s"} of the folder)` : "";
  const settledSay = done ? `, ${done} settled and waiting on the save` : "";
  leakEl.textContent = leaks
    ? `⚠ ${leaks} real name${leaks === 1 ? "" : "s"} from the key standing unfaked${more}${settledSay} — written as pseudonyms on save; click to step through them, right-click one to keep it`
    : rest.length ? `⚠ none left here, and ${restN} in ${rest.length} other document${rest.length === 1 ? "" : "s"} — click to go on`
    : done ? `⚠ ${done} settled and waiting on the save — Save writes them` : "";
  leakEl.classList.toggle("step", !!leaks || rest.length > 0);
  if (leakJump && leaks) {
    // A document opened to go on with the walk: stand on its first name.
    leakJump = false;
    leakStep = -1;
    showNamesBar(true);
  } else if (!leaks) {
    if (leakJump) { leakJump = false; leakStep = -1; if (rest.length) stepLeak(1); else showNamesBar(false); }
    else if (walkOn && !folderPending()) {
      // The folder has been read again since the last decision: on to whatever
      // it turned out to be carrying, or down if it is carrying nothing.
      walkOn = false;
      leakStep = -1;
      if (rest.length) stepLeak(1);
      else { showNamesBar(false); toast("Nothing the key binds is standing in the clear now."); }
    }
    else if (!rest.length && !folderPending()) showNamesBar(false);
    else if (!namesBar.hidden) renderNamesBar(); // …else the bar says which document is next
  } else if (!namesBar.hidden) renderNamesBar(); // the paint moved the ranges under it
  if (leaks || rest.length) {
    leakEl.setAttribute("role", "button");
    leakEl.setAttribute("tabindex", "0");
    leakEl.title = leaks
      ? "Go to the next one (Alt+L; hold Shift for the one before)"
      : "Open the next document of the folder that has one";
  } else {
    leakEl.removeAttribute("role");
    leakEl.removeAttribute("tabindex");
    leakEl.title = "";
  }
  markDocAlerts(); // …and which documents of the folder are still carrying one
  updateDirty();   // …and whether a save would rewrite this one on its own
}

// ── stepping the names standing in the clear ─────────────────────────────────
//
// The status bar COUNTS the real names the key binds that the run left in the
// text, and counting them is not finding them: on a forty-page export they
// are wherever they are, in a page's worth of orange somewhere. So the count
// is a control. Click it — or Alt+L, and Shift for the one before — and the
// reader goes to the next one in the order they stand in the document, marks
// it the way the worksheet marks its current row, and says which of how many
// it is. It wraps at the end.
//
// Where the folder has no LEAKS.xlsx this is the whole review: the key is
// attached, the names it binds are underlined, and this walks them. Where
// there is a worksheet the bar above the text is still the way through its
// rows; this steps what is standing in the text, which is not the same list —
// a worksheet is one row per value, and a value leaks wherever it leaks.
let leakStep = -1;
let leakJump = false; // a document opened for the walk: stand on its first name
let walkOn = false;   // …and the walk waiting on the folder to say which document is next
function stepLeak(dir = 1) {
  // The ranges of the last paint, minus any whose page has been rebuilt under
  // them (an edit, a key change) before the next paint has caught up.
  const hits = liveLeaks();
  const rest = restOfFolder();
  if (!hits.length) {
    // Nothing here, but the folder is not this document: the walk goes on in
    // the next one that has something standing in the clear.
    if (rest.length) { jumpToDoc(dir < 0 ? rest[rest.length - 1] : rest[0]); return; }
    if (folderPending()) { walkOn = true; renderNamesBar(); toast("The rest of the folder is being read \u2014 the walk goes on as soon as it says what is next."); return; }
    showNamesBar(false);
    toast(marksOff
      ? "The marks are off for this document, so the names standing in the clear are not being read."
      : sweep.running ? "None here. The rest of the folder is still being read…"
      : dirHandle ? "No real name from the key is standing unfaked, here or anywhere else in the folder."
      : "No real name from the key is standing unfaked.");
    return;
  }
  // Off the end of this document, with another in the folder still carrying
  // one: the walk opens that document and goes on there rather than round
  // again. The names arrive with the paint, so where to stand is left as a
  // note for the paint to pick up (leakJump).
  const next = leakStep + dir;
  if ((next >= hits.length || next < 0) && rest.length) {
    jumpToDoc(dir < 0 ? rest[rest.length - 1] : rest[0]);
    return;
  }
  leakStep = (((leakStep + dir) % hits.length) + hits.length) % hits.length;
  const h = hits[leakStep];
  leakHere = h.range;
  markLeakHere();
  scrollRangeTo(h.range);
  if (namesBar.hidden) showNamesBar(true);
  else renderNamesBar();
}
/**
 * THE BAR OVER THE TEXT, for the names the key binds that the run left in the
 * clear. The LEAKS worksheet gets one; a case folder with no worksheet has the
 * same work to do and had nothing but a right-click to do it with. So it gets
 * the same bar, under the worksheet's where both are up: the name, where it
 * stands, which of how many, and the decisions as buttons — keep just this
 * one, keep it in this case, never fake it anywhere, or leave it to the save,
 * which writes the pseudonym.
 */
const namesBar = $("names-bar");
function showNamesBar(on) {
  const was = !namesBar.hidden;
  if (on && !was) reelAllLive(); // the walk looks at every page of the reel
  namesBar.hidden = !on;
  setBarHeight();
  if (was !== !!on) relayout();
  if (!on) { leakHere = null; walkOn = false; markLeakHere(); return; }
  if (leakStep < 0) stepLeak(1);
  else renderNamesBar();
  sweepFolder(); // …and what the rest of the folder is carrying
}
// ── Find, across the whole case folder ───────────────────────────────────────
//
// Ctrl+F. The browser's own find reads the DOM, and the DOM is this document —
// with the folder read on, not even all of it, since the reel sheds the far
// end of itself to stay scrollable. A matter is forty exports, and "where does
// this name appear" is a question about the matter. So Find is the reader's
// own: the open document marked and stepped like any review, and when the last
// hit here is passed the walk opens the next document of the folder that has
// one and stands on its first.
//
// THE FOLDER IS SEARCHED THROUGH THE KEY. What is on screen is the real names;
// what is on disk is the pseudonyms. A search for "Rasho" typed while reading
// must therefore look for "Rasho" in the open document (where it is what the
// page says) and for whatever the key writes instead of it in the forty files
// it has not opened — otherwise the answer would be "only in the document you
// happen to have open", which is worse than no answer. Both needles are put to
// every file, so a name standing in the clear in one and faked in another is
// found in both.
let findQuery = "";
let findHits = [];    // the open document's hits, in order: [{ range }]
let findStep = -1;
let findJump = false; // a document opened by the walk: stand on its first hit
let findRows = [];    // the rest of the folder: [{ doc, count }]
let findScanFor = null; // …the query and the folder that answer was about
let findScanning = false;

/** The needles a query stands for: as it reads, and as the key writes it. */
function findNeedles(q) {
  const t = String(q || "").trim();
  if (!t) return [];
  const out = [t];
  // The same words as the file carries them. `forwardText` is the save's own
  // translation, so what is looked for is exactly what a save would have
  // written — including a phrase only part of which the key binds.
  if (fwd) {
    try {
      const { text, swaps } = forwardText(t, []);
      if (swaps && text && PK.fold(text) !== PK.fold(t)) out.push(text);
    } catch { /* an odd query is searched as it reads */ }
  }
  return out;
}
// The page is searched for BOTH faces of the query too: with "Show fakes" on
// the text on screen is the pseudonyms, and a find that only knew the real
// name would come back empty on a page plainly carrying it.
function findMatcherFor(q) { return PK.buildFindMatcher(findNeedles(q)); }

/** The open document's hits, read off the page the way the marks are. */
function scanFindHere() {
  findHits = [];
  const rx = findMatcherFor(findQuery);
  if (!rx) { paintFind(); return; }
  for (const body of pageBodies()) {
    // The gutter numbers blanked, so a phrase wrapped at the margin is one
    // phrase; the pseudonym spans NOT blanked, because what the operator is
    // searching is what the page says.
    const { text, segs } = flatten(body, { blankGutters: true });
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(text))) {
      const r = rangeFor(segs, m.index, m.index + m[0].length);
      if (r) findHits.push({ range: r });
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
  }
  if (findStep >= findHits.length) findStep = findHits.length - 1;
  paintFind();
}
/** Stand on the first hit of a document just read, the way a find does as you type. */
function findLandHere() {
  if (findStep >= 0 || !findHits.length) return false;
  findStep = 0;
  paintFind();
  scrollRangeTo(findHits[0].range);
  return true;
}
function paintFind() {
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
  try {
    CSS.highlights.set("find", highlightOf(findHits.map((h) => h.range)));
    const here = findStep >= 0 && findHits[findStep] ? [findHits[findStep].range] : [];
    CSS.highlights.set("findhere", highlightOf(here));
  } catch { /* a range from a page since rebuilt */ }
}
function clearFindMarks() {
  try { CSS.highlights.delete("find"); CSS.highlights.delete("findhere"); } catch { /* none to clear */ }
}

/**
 * The rest of the folder, read once per query: which documents carry it and
 * how many times. Idle-sliced like the leak sweep, and thrown away whenever
 * the query, the folder or the key moves.
 */
function findScanStale() {
  return !findScanFor || findScanFor.q !== findQuery || findScanFor.docs !== folderDocs || findScanFor.key !== key;
}
async function scanFindFolder() {
  if (!dirHandle || !findQuery || findScanning || !findScanStale()) return;
  findScanning = true;
  const mine = { q: findQuery, docs: folderDocs, key };
  findScanFor = mine;
  const rows = [];
  const rx = PK.buildFindMatcher(findNeedles(findQuery));
  try {
    await duringAsync("reading the rest of the folder for what you are looking for", async () => {
      let clock = await idleClock();
      for (const d of folderDocs) {
        if (findScanFor !== mine) return; // the query moved under it
        // The open one is READ HERE TOO, though its hits come from the page:
        // the walk moves from document to document, and a row set that left
        // out whichever was open when it was made would send the walk back
        // into the document it had just left. The row is filtered out of the
        // "rest" instead, at the moment it is asked for (findRest).
        try {
          const text = await (await d.handle.getFile()).text();
          const n = rx ? countMatches(rx, text) : 0;
          if (n) rows.push({ doc: d, count: n });
        } catch { /* unreadable: it is not a document this search can answer */ }
        if (!clock || clock.timeRemaining() < SLICE_LEFT) clock = await idleClock();
      }
    });
  } finally { findScanning = false; }
  if (findScanFor !== mine) return;
  findRows = rows;
  renderFindBar();
  // A find that opened on a document with nothing in it waits for this answer
  // before saying there is nothing anywhere (findJump), and goes on once it is in.
  if (findJump && !findHits.length && findRest().length) { findJump = false; stepFind(1); }
}

/** The documents of the folder that carry it — the open one excepted. */
function findRest() {
  return roundFromHere(findRows.filter((r) => r.doc.handle !== fileHandle));
}
/** The bar: which hit of how many, where it stands, and what the folder holds. */
function renderFindBar() {
  if (findBar.hidden) return;
  const n = findHits.length;
  const others = findRest();
  const rest = others.reduce((t, r) => t + r.count, 0);
  $("fb-count").textContent = !findQuery ? ""
    : n ? `${Math.min(Math.max(findStep, 0) + 1, n)} of ${n} here`
    : findScanning ? "reading the folder…"
    : "none here";
  const h = n && findStep >= 0 ? findHits[findStep] : null;
  $("fb-where").textContent = h ? whereInText(h.range) : "";
  $("fb-rest").textContent = !findQuery ? ""
    : findScanning ? `· reading ${folderName || "the folder"}…`
    : others.length ? `· ${rest} in ${others.length} other document${others.length === 1 ? "" : "s"}${n ? "" : ` — › opens ${TD.docLabel(others[0].doc.name)}`}`
    : dirHandle ? "· nowhere else in the folder" : "";
  $("fb-prev").disabled = $("fb-next").disabled = !findQuery || (n < 2 && !others.length);
}
/**
 * Where a range stands, as a reader would say it: the page's own label and its
 * numbered line — and, with the folder read on, which document's page it is,
 * since the page list then holds several. Both walks say it the same way.
 */
function whereInText(range) {
  const node = range && range.startContainer;
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  const sec = el && el.closest && el.closest(".tpage");
  if (!sec || !doc) return "";
  const at = Number(sec.dataset.index);
  const line = el.closest(".line");
  const gn = line && line.querySelector(".gn");
  const label = TD.pageLabel(doc.pages[at]) || `Page ${at + 1}`;
  const m = reel.length > 1 ? reelMemberOf(at) : null;
  return (m && m.name !== fileName ? TD.docLabel(m.name) + " · " : "") + label + (gn ? ":" + gn.textContent.trim() : "");
}

/**
 * On to the next hit — and out of this document when it runs out. The same
 * shape as the leak walk: the hits arrive with the next paint, so where to
 * stand in a document just opened is left as a note for it (findJump).
 */
function stepFind(dir = 1) {
  if (!findQuery) return;
  const n = findHits.length;
  const others = findRest();
  if (!n) {
    if (others.length) { jumpToFind(dir < 0 ? others[others.length - 1] : others[0]); return; }
    if (findScanning) { findJump = true; toast(`Reading ${folderName || "the folder"} for “${findQuery}”…`); return; }
    toast(dirHandle ? `“${findQuery}” is nowhere in ${folderName || "the folder"}.` : `“${findQuery}” is not in this document.`);
    return;
  }
  const next = findStep + dir;
  if ((next >= n || next < 0) && others.length) {
    jumpToFind(dir < 0 ? others[others.length - 1] : others[0]);
    return;
  }
  findStep = (((findStep + dir) % n) + n) % n;
  const h = findHits[findStep];
  paintFind();
  scrollRangeTo(h.range);
  renderFindBar();
}
function jumpToFind(row) {
  findJump = true;
  findStep = -1;
  toast(`${TD.docLabel(row.doc.name)} — ${row.count} hit${row.count === 1 ? "" : "s"} for “${findQuery}”.`);
  openFolderDoc(row.doc);
}

/**
 * The pages were rebuilt under the find — an edit, a key, the reel hanging the
 * next document on — so its ranges name nodes the document no longer has. The
 * page is read again a beat later, and a document the walk opened stands on
 * its first hit (findJump).
 */
const refindSoon = debounce(() => {
  if (findBar.hidden || !findQuery) return;
  scanFindHere();
  findJump = false;
  findLandHere();
  renderFindBar();
  scanFindFolder();
}, 200);
/** The query changed: the page again, and the folder behind it. */
const findSoon = debounce(() => {
  scanFindHere();
  findJump = false;
  findLandHere();
  renderFindBar();
  scanFindFolder();
}, 180);
function setFindQuery(q) {
  const t = String(q || "");
  if (t.trim() === findQuery) return;
  findQuery = t.trim();
  findStep = -1;
  findRows = [];
  findScanFor = null;
  if (!findQuery) { findHits = []; clearFindMarks(); renderFindBar(); return; }
  findSoon();
}
function showFindBar(on) {
  const was = !findBar.hidden;
  if (on && !was) reelAllLive(); // the search looks at every page of the reel
  findBar.hidden = !on;
  setBarHeight();
  if (was !== !!on) relayout();
  if (!on) { findHits = []; findStep = -1; findJump = false; clearFindMarks(); return; }
  const input = $("fb-input");
  // Opened over a selection, that is what is being looked for.
  const sel = String(document.getSelection() || "").trim();
  if (sel && sel.length <= 120 && !sel.includes("\n")) input.value = sel;
  input.focus();
  input.select();
  setFindQuery(input.value);
  renderFindBar();
}
$("fb-input").addEventListener("input", (e) => setFindQuery(e.target.value));
$("fb-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
  else if (e.key === "Escape") { e.preventDefault(); showFindBar(false); }
});
$("fb-prev").addEventListener("click", () => stepFind(-1));
$("fb-next").addEventListener("click", () => stepFind(1));
$("fb-close").addEventListener("click", () => showFindBar(false));
$("find-btn").addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection to search for
$("find-btn").addEventListener("click", () => showFindBar(findBar.hidden));
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "f") return;
  e.preventDefault(); // the reader's find, not the browser's: the browser's cannot leave this document
  showFindBar(true);
});

// ── the rest of the folder ───────────────────────────────────────────────────
//
// The marks read the document that is OPEN. A case folder holds the other
// forty, and a name left in the clear in one of them is exactly as much of a
// leak — the operator should not have to open each in turn to find that out.
//
// So the folder is swept: each export read once, under the same key, past the
// same keeps, with the names of cited decisions spared as on the page. It is
// text work and no DOM, but it is the expensive pass done forty times over,
// so it waits for the review to start (the bar opening is what asks for it),
// gives the thread back between documents, and is thrown away whenever the
// key or the keeps move, being an answer about them.
let sweep = { stamp: null, rows: [], at: 0, running: false };
// Which PSEUDONYMS stand anywhere in the folder, folded. Collected by the same
// reading the sweep does, but kept apart from it: the sweep is an answer about
// the keeps and is thrown away whenever one is taken, while this is an answer
// about what the RUN wrote, which a keep does not change. Rebuilt only when the
// key or the folder's list of documents moves.
let caseFakes = { key: null, docs: null, set: null };
function sweepStale() {
  return !sweep.stamp || sweep.stamp.reals !== reals || sweep.stamp.keeps !== keeps
    || sweep.stamp.master !== masterKeeps || sweep.stamp.docs !== folderDocs
    || sweep.stamp.flagged !== flagged;
}
function dropSweep() {
  sweep = { stamp: null, rows: [], at: 0, running: false };
  settled = new Set(); // the question has changed; so have the answers to it
}
/**
 * Rows of the folder in the order a walk meets them: the document AFTER the
 * open one first, round the folder, and the one before it last. A walk that
 * took them in the folder's own order would leave the third document for the
 * first, and go round the folder backwards from wherever it was started.
 */
function roundFromHere(rows) {
  if (rows.length < 2) return rows;
  const at = folderDocs.findIndex((d) => d.handle === fileHandle);
  if (at < 0) return rows;
  const n = folderDocs.length;
  const pos = (r) => {
    const i = folderDocs.indexOf(r.doc);
    return i < 0 ? Infinity : ((i - at) % n + n) % n;
  };
  return rows.slice().sort((a, b) => pos(a) - pos(b));
}
/** How many times a matcher stands in a text. */
function countMatches(rx, text) {
  rx.lastIndex = 0;
  let n = 0, m;
  while ((m = rx.exec(text))) {
    n++;
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return n;
}
/**
 * The other documents of the folder that carry a NAME THE KEY BINDS standing
 * in the clear — the walk's own list, so a row carrying nothing but flagged
 * values is not a stop on it (there is nothing in it for the walk to stand
 * on: `leakHits` is the key's names).
 */
function restOfFolder() {
  const out = [];
  for (const r of sweep.rows) {
    if (r.doc.handle === fileHandle) continue;
    const count = r.values.filter((v) => !isSettled(v)).length;
    if (count) out.push({ doc: r.doc, count, values: r.values });
  }
  return roundFromHere(out);
}
function folderRest() {
  if (!dirHandle || !reals) return "";
  if (sweep.running) return `reading the rest of ${folderName}\u2026 (${sweep.at} of ${folderDocs.length})`;
  const rest = restOfFolder();
  if (!rest.length) return sweep.stamp ? "nothing standing in the clear in the rest of the folder" : "";
  const n = rest.reduce((t, r) => t + r.count, 0);
  return `\u00b7 ${n} more in ${rest.length} other document${rest.length === 1 ? "" : "s"}`;
}
// How long a BIG folder is left alone after the operator does something
// before it is read again.
//
// The sweep is an answer about the keeps and the flags, so taking either
// throws it away and the next paint asks for it again. In a folder of a dozen
// that is a dozen files read in the gaps between keystrokes and nobody
// notices. In one of three hundred it is three hundred files opened, read and
// matched for every decision of a walk that takes one every few seconds — the
// folder read over and over, and never finishing before the next decision
// drops it. So there it waits for a gap, as the documents built ahead do, and
// what the bar says in the meantime is the last reading's answer.
const SWEEP_QUIET = 1200;
let sweepTimer = 0;
async function sweepFolder() {
  if (!dirHandle || !reals || sweep.running || !sweepStale()) return;
  if (oneDocAtATime()) {
    const quiet = Date.now() - busyAt;
    clearTimeout(sweepTimer);
    if (quiet < SWEEP_QUIET) { sweepTimer = setTimeout(sweepFolder, SWEEP_QUIET - quiet); return; }
  }
  sweep = { stamp: { reals, keeps, master: masterKeeps, docs: folderDocs, flagged }, rows: [], at: 0, running: true };
  const mine = sweep.stamp;
  // …and the fakes, only where the folder has not already been read for them
  // under this key. A walk through the names drops the sweep at every decision;
  // re-reading forty documents each time for an answer that cannot have changed
  // would be the walk's whole cost.
  const fakesFor = fakesIndexStale() ? { key, docs: folderDocs, set: new Set() } : null;
  const flagRx = flaggedMatcher();
  // …and whether every one of them was actually read. A document that would
  // not open leaves the leak count a little short, which is a worse count; it
  // leaves the FAKES index saying a pseudonym stands nowhere, which is a keep
  // held back from a run that was the only thing able to undo it. So one
  // unreadable document is enough to withhold the index entirely, and the
  // keeps waiting on it stay owed.
  let readAll = true;
  await duringAsync("reading the rest of the folder for names in the clear", async () => {
    let clock = await idleClock();
    for (const d of folderDocs) {
      if (sweep.stamp !== mine) return; // the key moved under it: this answer is stale
      sweep.at++;
      renderNamesBar();
      // The open one is read here TOO, though the walk and the marks read it
      // from the page: the page's count goes with the page, and the ⚠ beside
      // it in the Documents list has to stand after the operator moves on to
      // the next document. What the file holds is the right answer for a
      // document nobody is looking at. Its pseudonyms are still left to
      // fakeStandsInFile, which reads the page.
      const open = d.handle === fileHandle;
      try {
        const text = await (await d.handle.getFile()).text();
        const masked = TD.blankRanges(maskKept(text), TD.citedNameSpans(text));
        const found = PK.findReals(reals, masked);
        // …and the values flagged for the next run, counted the way the page
        // counts them: over the file's own text, where a value that stands is
        // really standing — a fake is a fake on disk, with no real name
        // painted over it.
        const flags = flagRx ? countMatches(flagRx, text) : 0;
        if (found.length || flags) sweep.rows.push({ doc: d, values: found.map((f) => f.real), flags });
        // …and, from the same reading, which PSEUDONYMS stand here. That is
        // the other half of the folder's answer: a name in the clear is a leak,
        // and a name the run faked is work only a run can undo. Over the raw
        // text, not the masked one — a fake is standing whatever has been kept,
        // and a party of a cited decision is not spared either, the run having
        // faked it all the same. Only `fake` is read off the row: an ambiguous
        // fake cannot say whose it is, and does not have to.
        if (fakesFor && fakesRx && !open) for (const w of PK.findReals(fakesRx, text)) fakesFor.set.add(PK.fold(w.fake));
      } catch { readAll = false; /* unreadable: it is not a document this review can answer */ }
      if (!clock || clock.timeRemaining() < SLICE_LEFT) clock = await idleClock();
    }
  });
  if (sweep.stamp !== mine) return;
  // Only a reading that ran to the end is an answer; a partial set would say a
  // pseudonym stands nowhere when the document carrying it was never opened.
  if (fakesFor && readAll) caseFakes = fakesFor;
  sweep.running = false;
  renderNamesBar();
  renderLeakStatus(); // the count says what the rest of the folder is carrying
  // The folder has been read, so the keeps taken while it had not been can be
  // decided on the evidence rather than held owed for want of it.
  refreshKeepLocality();
}
/**
 * On to a document of the folder that is carrying one, and stand on its first
 * — THE DOCUMENT BEING LEFT WRITTEN FIRST.
 *
 * The walk arrives here having finished this document: every name answered,
 * or stepped past the last of them. What that work amounts to is a save — the
 * names settled are written as their pseudonyms, the keeps taken go into
 * New Real Values.txt, a worksheet row answered on the way goes into
 * LEAKS.xlsx — and none of it had happened. The operator moved on with a
 * document still carrying real values and nothing on screen to say so, since
 * the count and the bar are about the document now in front. A review that
 * walks the folder has to write each document as it leaves it.
 *
 * A save that does NOT happen holds the walk here: the standing assertion
 * refusing, or a file that would not be written, is exactly the moment not to
 * move on. Nothing owed, nothing written — an untouched document is left as
 * it stands, bytes and timestamp alike.
 */
async function jumpToDoc(row) {
  if (!(await saveOnTheWayOut())) return;
  leakJump = true;
  toast(`Opening ${row.doc.name} — ${row.count} name${row.count === 1 ? "" : "s"} standing in the clear there.`);
  openFolderDoc(row.doc);
}
// What has been DECIDED in the document on screen: a name answered in the
// names walk, a Fix? cell answered in the worksheet review. Not an edit, not a
// step past a name, not a row merely looked at — a save on the way out is the
// writing-up of decisions, and a document nobody decided anything in has
// nothing to write up. Reset with the document, like `answered`.
let decidedHere = 0;
/** The open document written before a review leaves it; false where it was not. */
async function saveOnTheWayOut() {
  if (!doc) return true;
  if (!decidedHere) return true;
  const owed = dirty || pendingWrites().length > 0 || standingInTheClear() > 0;
  if (!owed) return true;
  const ok = await saveDocument();
  if (!ok) {
    // saveDocument has said why. All this adds is that the walk stopped here
    // because of it, which is not obvious from a message about a save.
    leakJump = false;
    toast(`${fileName} was not written, so the walk has stayed here. Answer that first.`, { error: true });
  }
  return ok;
}
/** The hits of the last paint whose pages are still on the page. */
function liveLeaks() {
  return leakHits.filter((h) => !isSettled(h.real) && h.range && h.range.startContainer && h.range.startContainer.isConnected);
}
/** Where a name stands, as a reader would say it: the page's own label, and its line. */
function leakWhere(h) { return whereInText(h.range); }
function renderNamesBar() {
  if (namesBar.hidden) return;
  const hits = liveLeaks();
  // NOTHING LEFT HERE IS NOT THE END OF THE WALK. The document runs out long
  // before the folder does, and the bar used to go down with it — leaving the
  // walk to be picked up again from the count in the status bar, at the other
  // end of the window, once per document. The walk is one walk. So the bar
  // stays up, says which document is next, and › goes on to it.
  if (!hits.length) {
    const rest = restOfFolder();
    if (rest.length) { renderOnward(rest); return; }
    // …and a folder whose answer is not in yet is not a folder with nothing
    // left in it. A keep or a fake throws the sweep away — it was an answer
    // about the keeps — so the moment AFTER the last name here is answered is
    // exactly the moment the folder cannot say what is next. The bar waits for
    // it, and goes on by itself when it arrives (walkOn).
    if (folderPending()) { renderWaiting(); return; }
    showNamesBar(false);
    return;
  }
  setOnward(false);
  const i = Math.min(Math.max(leakStep, 0), hits.length - 1);
  const h = hits[i];
  $("nb-count").textContent = `${i + 1} of ${hits.length}` + (answered ? ` · ${answered} answered here` : "");
  $("nb-value").textContent = h.real;
  $("nb-value").title = "A real name from the key, standing in the clear";
  $("nb-where").textContent = leakWhere(h);
  $("nb-answer").textContent = h.fake ? `the save writes \u201c${h.fake}\u201d` : "the save writes its pseudonym";
  $("nb-fake").disabled = !h.fake;
  $("nb-prev").disabled = $("nb-next").disabled = hits.length < 2 && !restOfFolder().length;
  $("nb-rest").textContent = folderRest();
}
/** Whether the folder has still to say what it is carrying. */
function folderPending() {
  return !!dirHandle && !!reals && (sweep.running || sweepStale());
}
/** The bar while the folder is being read: the walk is not over, it is waiting. */
function renderWaiting() {
  setOnward(true);
  $("nb-count").textContent = "none left here" + (answered ? ` · ${answered} answered here` : "");
  $("nb-type").textContent = "reading";
  $("nb-value").textContent = folderName || "the folder";
  $("nb-value").title = "The rest of the folder is being read for names standing in the clear";
  $("nb-where").textContent = sweep.running ? `${sweep.at} of ${folderDocs.length}\u2026` : "\u2026";
  $("nb-rest").textContent = "";
  $("nb-prev").disabled = $("nb-next").disabled = true;
}
/** The bar between documents: what is next, and the arrows that go there. */
function renderOnward(rest) {
  const n = rest.reduce((t, r) => t + r.count, 0);
  const next = rest[0];
  setOnward(true);
  $("nb-count").textContent = "none left here" + (answered ? ` · ${answered} answered here` : "");
  $("nb-type").textContent = "on to";
  $("nb-value").textContent = TD.docLabel(next.doc.name);
  $("nb-value").title = `${next.count} name${next.count === 1 ? "" : "s"} standing in the clear in ${next.doc.name}`;
  $("nb-where").textContent = `${next.count} standing in the clear`;
  $("nb-rest").textContent = rest.length > 1
    ? `· ${n} in ${rest.length} documents of ${folderName || "the folder"}`
    : "";
  $("nb-prev").disabled = $("nb-next").disabled = false;
}
/** Which of the bar's two faces is up: the name in front, or the document next. */
let onward = false;
function setOnward(on) {
  if (onward === !!on) return;
  onward = !!on;
  namesBar.classList.toggle("onward", onward);
  if (!onward) $("nb-type").textContent = "unfaked";
  setBarHeight(); // the decide row goes with it, and the stage sits under both
}
/** A decision taken on the name in front, and on to the next. */
function decideName(what) {
  const hits = liveLeaks();
  if (!hits.length) { showNamesBar(false); return; }
  const h = hits[Math.min(Math.max(leakStep, 0), hits.length - 1)];
  // The walk is told at once. A repaint follows a beat later and reads the
  // text again; until it lands, this keeps the walk honest — a name just kept
  // is not one still standing in the clear.
  const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  answered++;
  decidedHere++;
  if (what === "here") {
    keepRangeHere(h.range, h.real);
    leakHits = leakHits.filter((x) => x !== h);
  } else if (what === "no" || what === "never") {
    setKeep(h.real, what, { leak: true });
    leakHits = leakHits.filter((x) => !same(x.real, h.real));
  }
  const left = liveLeaks();
  if (!left.length) {
    // Answered the last one HERE: the walk goes straight on to the next
    // document of the folder rather than putting the bar down and leaving the
    // operator to pick it up again from the status bar. Where the decision
    // just taken threw the folder's answer away, the walk says so and goes on
    // the moment it is read again.
    leakStep = -1;
    if (restOfFolder().length) { stepLeak(1); return; }
    if (folderPending()) { walkOn = true; renderNamesBar(); return; }
    showNamesBar(false);
    toast("Nothing the key binds is standing in the clear now.");
    return;
  }
  leakStep = Math.min(leakStep, left.length - 1) - 1; // …and the step takes it on
  stepLeak(1);
}
$("nb-prev").addEventListener("click", () => stepLeak(-1));
$("nb-next").addEventListener("click", () => stepLeak(1));
$("nb-find").addEventListener("click", () => { const h = liveLeaks()[Math.max(0, leakStep)]; if (h) scrollRangeTo(h.range); });
$("nb-close").addEventListener("click", () => showNamesBar(false));
/**
 * "Fake it": the decision, not the deed.
 *
 * A save writes every name standing in the clear — that is what the forward
 * pass is for — so this one was always going to be faked. What the walk is
 * missing is a way to SAY so: the keeps answer the names that must stay, and
 * without an answer for the rest the operator has no way to tell the ones
 * they have looked at from the ones they have not, and circles back over the
 * same names. So this settles the name, the walk stops offering it, and the
 * save writes the pseudonym in its own time, along with everything else.
 *
 * By VALUE, not by place: the save fakes every occurrence of a name alike, so
 * a decision about one is a decision about all of them. Held for the session
 * and dropped whenever the key or the keeps move, both of which change what
 * the question was.
 */
let settled = new Set(); // folded values the operator has said to fake
function settledKey(v) { return String(v == null ? "" : v).trim().toLowerCase(); }
function isSettled(v) { return settled.has(settledKey(v)); }
function fakeName() {
  const hits = liveLeaks();
  if (!hits.length) { showNamesBar(false); return; }
  const h = hits[Math.min(Math.max(leakStep, 0), hits.length - 1)];
  settled.add(settledKey(h.real));
  answered++;
  decidedHere++;
  const n = leakHits.filter((x) => settledKey(x.real) === settledKey(h.real)).length;
  toast(`“${h.real}” will be written as ${h.fake ? `“${h.fake}”` : "its pseudonym"} on save`
    + (n > 1 ? ` — all ${n} of them here` : "") + ". Noted; the walk moves on.");
  renderLeakStatus();
  const left = liveLeaks();
  if (!left.length) { stepLeak(1); return; }
  leakStep = Math.min(leakStep, left.length - 1) - 1;
  stepLeak(1);
}
let answered = 0; // what the walk has answered in this document, for the bar to say
$("nb-fake").addEventListener("click", fakeName);
$("nb-here").addEventListener("click", () => decideName("here"));
$("nb-no").addEventListener("click", () => decideName("no"));
$("nb-never").addEventListener("click", () => decideName("never"));
$("nb-skip").addEventListener("click", () => stepLeak(1));
// The count opens the bar on the first name; once it is open, it steps.
function leaksFromCount(e) {
  if (namesBar.hidden) showNamesBar(true);
  else stepLeak(e && e.shiftKey ? -1 : 1);
}
$("st-leaks").addEventListener("click", leaksFromCount);
$("st-leaks").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  leaksFromCount(e);
});
document.addEventListener("keydown", (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.key.toLowerCase() !== "l") return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return; // a field being typed in
  e.preventDefault();
  stepLeak(e.shiftKey ? -1 : 1);
});
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
  setDirty(true, pageIndexOf(body));
  afterTextChange();
  renderFlags();
  toast(undone
    ? `"${real}" is a pseudonym again at that place`
    : `"${real}" kept where it stands — here only; every other occurrence is still faked`);
}

// ── a keep that asks nothing of PDF-Linker ───────────────────────────────────
//
// Keeping a value that the run FAKED is work for PDF-Linker: a file carries
// the pseudonym and only a run can put the real name back. Keeping a value
// that stands in the clear is not. Nothing faked it, so there is nothing to
// un-fake — the files already read the way the keep wants them to, the save
// simply leaves the value alone, and the whole of the decision is "stop
// marking this, it was left alone on purpose."
//
// Such a keep stays here. It is not written into New Real Values.txt, it does
// not make the list one the case folder is owed, and it asks for no re-run.
//
// AND THE QUESTION IS THE CASE'S, NOT THE DOCUMENT'S. A keep applies to every
// export in the folder, so "was it faked?" has to be asked of every export in
// the folder: a pseudonym standing in one of the other forty is a name the
// next run is the only thing that can restore, whatever the document on
// screen happens to say. The folder sweep already reads each export once, and
// writes down which pseudonyms stand in it as it goes (sweepFolder); this
// reads that index, plus the open document, which the sweep skips because the
// page itself is the better copy of it.
//
// Until the sweep has answered there is no evidence, and a keep held back for
// want of evidence is a name the run never restores with nothing to say so.
// So a keep taken then is `pending`: owed like any other, and re-decided the
// moment the folder has been read. The rule itself is textdoc.keepNeedsRun.

/** Whether the OPEN document's file carries the value's pseudonym. */
function fakeStandsInFile(real, text) {
  if (!doc || !fwd) return false;
  const fake = TD.fakeFor(fwd, real);
  if (!fake) return false;
  // The key's own matcher, not a plain search: a pseudonym wrapped at the
  // margin — its halves two numbered lines apart — is still standing in this
  // file, and a keep taken as though it were not would be a name the next run
  // never restores.
  const rx = PK.buildMatcher([fake]);
  if (!rx) return false;
  rx.lastIndex = 0;
  return rx.test(text == null ? TD.serializeExport(doc) : text);
}

/** Whether the folder's fakes index is out of step with the key or the folder. */
function fakesIndexStale() {
  return !caseFakes.set || caseFakes.key !== key || caseFakes.docs !== folderDocs;
}

/** Whether the value's pseudonym stands anywhere in the case: the folder, or here. */
function fakeStandsInCase(real, text) {
  const fake = fwd ? TD.fakeFor(fwd, real) : "";
  if (fake && caseFakes.set && caseFakes.set.has(PK.fold(fake))) return true;
  // The sweep skips the open document, so it answers for itself.
  return fakeStandsInFile(real, text);
}

/**
 * Whether the case has actually been read for pseudonyms. With no folder open
 * there is nothing to read but the document, and the document is the case.
 */
function caseIsRead() {
  return !dirHandle || !reals ? true : !fakesIndexStale();
}

/** Whether PDF-Linker has raised this value on LEAKS.xlsx. */
function onLeaksSheet(real) {
  const want = LK.fold(real);
  return leakRows().some((r) => LK.fold(r.value) === want);
}

/**
 * Whether the keep has already gone to the case folder. Once its line is in
 * New Real Values.txt it is PDF-Linker's, and taking it back out is a change to
 * a file nobody asked to change — the run leaving a value alone that was
 * already standing costs nothing, so it is left there.
 */
function keepWasWrittenOut(k) {
  const line = `${k.control}: ${k.value}`;
  return lsGet(valuesSavedKey(), "").split(/\r?\n/).some((l) => l.trim() === line);
}

/**
 * Every keep read again against the facts as they now stand.
 *
 *   local → owed      an export of the folder turns out to carry the
 *                     pseudonym, or a worksheet arrives with the value on it.
 *   pending → local   the folder has now been read, and it does not.
 *
 * The second move is the only one made toward local, and it is made only from
 * `pending` and only once the folder has actually been read — and never for a
 * keep already written into New Real Values.txt, which is PDF-Linker's now.
 */
function refreshKeepLocality() {
  const watched = keeps.filter((k) => k.state);
  if (!watched.length) return;
  const text = doc ? TD.serializeExport(doc) : "";
  const read = caseIsRead();
  let moved = keeps;
  for (const k of watched) {
    const needsRun = TD.keepNeedsRun({
      control: k.control,
      faked: fakeStandsInCase(k.value, text),
      onLeaksSheet: onLeaksSheet(k.value),
    });
    if (needsRun) moved = TD.owe(moved, k.value);
    else if (k.state === "pending" && read && !keepWasWrittenOut(k)) moved = TD.settleLocal(moved, k.value);
  }
  if (moved === keeps) return;
  keeps = moved;
  persistValues();
  renderFlags();
}

function setKeep(real, control, { leak = false } = {}) {
  // A keep on a value standing in the clear anywhere in the case, for this
  // case only, that PDF-Linker has not itself raised, is a decision the files
  // already carry out. Anything else is work the case folder has to be handed
  // — and so, for now, is a keep taken before the folder has been read.
  let state = "";
  if (control && !TD.keepNeedsRun({
    control,
    faked: !leak || fakeStandsInCase(real),
    onLeaksSheet: onLeaksSheet(real),
  })) state = caseIsRead() ? "local" : "pending";
  keeps = control ? TD.addKeep(keeps, control, real, state) : TD.removeKeep(keeps, real);
  persistValues();
  compileKey();
  remarkKept();
  renderFlags();
  paintHighlights();
  noteInFlagged();
  sweepFolder(); // a pending keep is waiting on this
  toast(!control ? `"${real}" is a pseudonym again`
    : state === "local" ? `"${real}" left as it stands — nothing in ${dirHandle ? folderName : "this document"} fakes it, so there is nothing to hand over and nothing to re-run. It is simply no longer marked.`
    : state === "pending" ? `"${real}" left as it stands. Reading the rest of ${folderName} to see whether anything there fakes it — until that is known it stays on the list for PDF-Linker.`
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
  noteInFlagged();
  toast(flagged.length > before ? `Flagged "${v}" — ${flagged.length} value${flagged.length === 1 ? "" : "s"} to hand to PDF-Linker` : `"${v}" is already flagged`);
}

function valuesStoreKey() { return VALUES_PREFIX + (folderName || fileName || "loose"); }
function valuesSavedKey() { return VALUES_SAVED_PREFIX + (folderName || fileName || "loose"); }
/**
 * Whether the flagged values and the keeps have been written out since they
 * last moved. The list is remembered here whatever happens — closing the tab
 * loses nothing — but remembered here is not handed over: PDF-Linker reads
 * New Real Values.txt in the case folder and nothing else, so a list that has
 * not been written is a run's worth of work the next run will not do. The
 * file's own text is the signature; nothing else can be out of step with it.
 */
function valuesDirty() {
  // A local keep is not in the file and never will be, so a list that holds
  // nothing else is a list the case folder is owed nothing from.
  if (!flagged.length && !TD.owedKeeps(keeps).length) return false;
  return TD.formatValuesFile(flagged, keeps) !== lsGet(valuesSavedKey(), "");
}
/** …and the same list, as it stands, marked as written. */
function markValuesSaved(text) { lsSet(valuesSavedKey(), text); renderFlags(); }
// Spot keeps belong to ONE document, not to the case: they name a place in it.
// Remembered per document, like its swapped pages.
function spotStoreKey() { return SPOTS_PREFIX + (folderName || "") + "/" + (fileName || ""); }
// A spot names a page of its own DOCUMENT. The page numbers in hand are the
// reel's — one list holding several files — so they are written back rebased
// onto the member, which is what the file is opened with again whether it is
// opened on its own or hung anywhere on a reel.
function persistSpots() {
  const m = reelCurrent();
  lsSet(spotStoreKey(), m && m.from ? spots.map((x) => ({ ...x, page: x.page - m.from })) : spots);
}
/** …and the same list read back, as pages of the reel a member starts at `from` of. */
function spotsFrom(list, from) { return from ? list.map((x) => ({ ...x, page: x.page + from })) : list; }
// Stored as { values, keeps }; an older build stored the values list bare.
function readStoredValues(k) {
  const v = lsGet(k, null);
  if (Array.isArray(v)) return { values: v, keeps: [] };
  return { values: (v && v.values) || [], keeps: (v && v.keeps) || [] };
}
function loadValuesFor() { const st = readStoredValues(valuesStoreKey()); flagged = st.values; flagsFor = valuesStoreKey(); keeps = st.keeps; compileKey(); renderFlags(); }
function persistValues() { lsSet(valuesStoreKey(), { values: flagged, keeps }); }

function renderFlags() {
  updateDirty(); // a flag, a keep or one of them written is a save's business
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
    t.className = "tag keep" + (k.state === "local" ? " settled" : k.state === "pending" ? " pending" : "");
    t.textContent = k.control === "never" ? "never"
      : k.state === "local" ? "already so"
      : k.state === "pending" ? "checking" : "this case";
    t.title = k.control === "never" ? "Kept in every case (never)"
      : k.state === "local" ? "Kept in this case — and nothing in the case fakes it, so it is not written to " + TD.VALUES_FILE + " and needs no re-run."
      : k.state === "pending" ? "Kept in this case. Until the rest of the folder has been read for its pseudonym it stays on the list for PDF-Linker."
      : "Kept in this case (no)";
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
  const unsaved = valuesDirty();
  flagsNote.textContent = (dirHandle
    ? `Saves to ${folderName}/${TD.VALUES_FILE}.`
    : "No case folder is open: the list is remembered here and can be saved anywhere or copied.")
    + (unsaved ? " Not written yet — PDF-Linker reads the file, not this list." : "");
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
  // WHAT IS WORTH SAYING is what the workbook is HOLDING: a standing keep the
  // key binds, standing in this document, which the run would otherwise have
  // faked. The rest of the workbook — the settled decisions of every other
  // matter — does no work here and is not a list worth reading: it is a
  // number, and the button to load another.
  const here = masterKeeps.filter((k) => keptSeen.has(TD.foldValue(k.value)));
  hint.textContent = (here.length
    ? `${here.length} value${here.length === 1 ? "" : "s"} held against the key here, by ${masterInfo.name}:`
    : `${masterInfo.name} holds nothing the key would fake in this document.`)
    + (masterInfo.partial ? ` (${masterInfo.partial} of part of a value left to PDF-Linker.)` : "")
    + (masterInfo.loose ? " This session only — choose it with the button to keep it attached." : "");
  hint.title = `${masterKeeps.length} standing keep${masterKeeps.length === 1 ? "" : "s"} in all; the others name nothing this key binds.`;
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
  const body = bodyForPage(sp.page);
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

/**
 * The flagged list written out. `quiet` is for the save that carries it along
 * with the document — the document's own toast says so — and `folderOnly`
 * with it: a save of the text is not the moment to put a file picker in front
 * of somebody who never asked for one.
 */
async function saveValuesFile({ quiet = false, folderOnly = false } = {}) {
  if (!flagged.length && !keeps.length) {
    if (!quiet) toast("Nothing flagged yet — select an unfaked name and press Flag, or right-click a pseudonym to keep it.", { error: true });
    return false;
  }
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
      markValuesSaved(text);
      if (!quiet) toast(`Wrote ${TD.VALUES_FILE} (${flagged.length} to fake, ${keeps.length} to keep) into ${folderName} — re-run PDF-Linker to apply them to the files.`);
      return true;
    } catch (e) {
      if (quiet) return false;
      toast("Could not write into the folder (" + (e.message || e) + ") — choose where to save.", { error: true });
    }
  }
  if (folderOnly) return false;
  if (await writeText(text, TD.VALUES_FILE, null)) { markValuesSaved(text); return true; }
  return false;
}
$("flags-save").addEventListener("click", () => saveValuesFile());
$("flags-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(flagged.concat(keeps.map((k) => k.control + ": " + k.value)).join("\n") + "\n"); toast("Copied " + (flagged.length + keeps.length) + " line" + (flagged.length + keeps.length === 1 ? "" : "s")); }
  catch { toast("Copy failed", { error: true }); }
});

// ── the LEAKS worksheet ───────────────────────────────────────────────────────────
//
// PDF-Linker's leak triage is a worksheet, LEAKS.xlsx in the case folder: one
// row per flagged value with a Fix? cell the operator answers (yes / no /
// never / phrase, ~CORRECT SPELLING, *CORRECT TEXT, a [kept part], or the
// exact replacement), and Apply Fixes reads the cells back. Answering
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
// writes LEAKS.xlsx back in place. Then Apply Fixes does the rest.
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
  return duringAsync("reading LEAKS.xlsx", () => attachLeaksNow(bytes, name, handle, { quiet, folder }));
}
async function attachLeaksNow(bytes, name, handle, { quiet = false, folder = "" } = {}) {
  const wb = await parseXlsx(bytes);
  if (!LK.sheetsLookLikeLeaks(wb.sheets)) throw new Error(`${name} has no "Value" / "Fix?" header — not a LEAKS worksheet.`);
  const parsed = LK.parseLeaks(wb.sheets, name);
  if (!parsed.part) throw new Error(`${name}: the LEAKS sheet could not be placed in the workbook.`);
  // Unsaved decisions are never lost to a re-attach: they are remembered
  // per worksheet (folder and name) and laid back over the rows below.
  if (leaks) persistLeaks();
  leaks = { parsed, bytes, name, handle: handle || null, folder: folder || folderName || "", at: -1, mirrored: new Set() };
  const remembered = LK.unpackDecisions(parsed.rows, lsGet(leaksStoreKey(), null));
  mirrorLeakKeeps(parsed.rows.filter((r) => r.fix !== r.fix0));
  // A value PDF-Linker has now raised is a question asked on the worksheet, and
  // a keep that was answering nobody has a row to answer: it goes back on the
  // list the case folder is owed.
  refreshKeepLocality();
  leakRowValue = "";
  leakHere = null;
  renderLeaksTab();
  updateLeaksButton();
  if (!leaksBar.hidden) { const i = LK.nextUndecided(parsed.rows, null); await goToLeak(i >= 0 ? i : 0, { locate: false }); }
  else paintHighlights();
  warmForLeaks();
  const und = LK.undecidedCount(parsed.rows);
  if (!quiet) toast(`${name}: ${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"}, ${und} to answer` + (remembered ? `, ${remembered} answered here and not yet saved` : "") + " — ⚠ Leaks to review them.");
  return parsed;
}
function dropLeaks() {
  leaks = null;
  dropWarmPages();
  dropReady();
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
  badge.title = leaks ? `${LK.undecidedCount(rows)} of ${rows.length} rows still to answer` : "";
  $("leaks-btn").setAttribute("aria-pressed", String(!leaksBar.hidden));
  $("leaks-tab-count").textContent = String(rows.length);
}

/** Whether the key binds this value (so an unfaked occurrence is an orange leak). */
function boundByKey(value) { return !!(reals && reals.map && reals.map.get(PK.fold(PK.foldGaps(value)))); }
/** A `no` / `never` on a bound value becomes one of the reader's keeps; withdrawn, it is withdrawn here too. */
function mirrorLeakKeep(row) {
  if (!moveLeakKeep(row)) return false;
  settleKeeps();
  return true;
}
/**
 * The same for a whole worksheet at once — the decisions remembered from a
 * session that was not saved, laid back over the rows on attach. Settling is
 * what costs: the key is compiled again, every pseudonym span in the document
 * re-marked and the flags redrawn. Done per row, a worksheet with a thousand
 * answered rows in it settles a thousand times and the tab never comes back;
 * the rows move first, and it settles once.
 */
function mirrorLeakKeeps(rows) {
  let moved = false;
  for (const row of rows || []) if (moveLeakKeep(row)) moved = true;
  if (moved) settleKeeps();
  return moved;
}
/** The keeps list alone: whether this row's decision moved it. */
function moveLeakKeep(row) {
  const kind = LK.classifyFix(row.fix, row.value).kind;
  const f = PK.fold(row.value);
  const want = LK.isKeepKind(kind) && boundByKey(row.value);
  if (want) { keeps = TD.addKeep(keeps, kind, row.value); leaks.mirrored.add(f); }
  else if (leaks.mirrored.has(f)) { keeps = TD.removeKeep(keeps, row.value); leaks.mirrored.delete(f); }
  else return false;
  return true;
}
/** …and what a change to the keeps costs: the key, the marks, the lists. */
function settleKeeps() {
  persistValues();
  compileKey();
  remarkKept();
  renderFlags();
}

// The bar: shown and hidden by ⚠ Leaks in the tools rail and its own ×; it takes
// its own height above the stage (--bar-h), so the first lines of the text
// are never under it.
function setBarHeight() {
  const a = leaksBar.hidden ? 0 : leaksBar.offsetHeight;
  const b = namesBar.hidden ? 0 : namesBar.offsetHeight;
  const c = redactBar.hidden ? 0 : redactBar.offsetHeight;
  const d = findBar.hidden ? 0 : findBar.offsetHeight;
  const root = document.documentElement.style;
  root.setProperty("--bar-leaks", a + "px");          // where the second bar starts
  root.setProperty("--bar-names", a + b + "px");      // …and the third
  root.setProperty("--bar-redact", a + b + c + "px"); // …and the fourth
  root.setProperty("--bar-h", a + b + c + d + "px");  // …and what the four take together
}
if (typeof ResizeObserver !== "undefined") {
  const barSizes = new ResizeObserver(setBarHeight);
  barSizes.observe(leaksBar);
  barSizes.observe(namesBar);
  barSizes.observe(redactBar);
  barSizes.observe(findBar);
}
function showLeaksBar(on) {
  const was = !leaksBar.hidden;
  if (on && !was) reelAllLive(); // the walk looks at every page of the reel
  leaksBar.hidden = !on;
  setBarHeight();
  updateLeaksButton();
  if (was !== !!on) relayout();
  if (!on) { leakRowValue = ""; leakHere = null; paintHighlights(); }
  // The review starting is when reading ahead starts; the review closing is
  // when it stops and what it held goes.
  if (was !== !!on) warmForLeaks();
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
  // The walk is a document at a time, so how many are left in THIS one is
  // what says when the review moves on to the next.
  const here = rows.filter((r) => LK.fold(LK.rowFile(r)) === LK.fold(LK.rowFile(row)) && LK.isPending(r)).length;
  $("lb-count").textContent = `Row ${leaks.at + 1} of ${rows.length}` + (und ? ` · ${und} to answer` : " · all answered")
    + (und && here && here !== und ? ` (${here} in this document)` : "");
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
  $("lb-problem").textContent = leaks.problem || "";
  const c = LK.classifyFix(row.fix, row.value);
  const sug = LK.isSuggested(row);
  const ans = $("lb-answer");
  ans.textContent = c.label
    + (sug ? " — PDF-Linker's own reading, not yet accepted" : "")
    + (row.fix !== row.fix0 ? " (unsaved)" : "");
  // A pre-filled cell reads as answered and is not: it is marked like an empty
  // one until the operator has said so.
  ans.className = "lb-answer" + (c.kind && !sug ? "" : " undecided");
  $("lb-accept").hidden = !sug;
  for (const b of leaksBar.querySelectorAll("button[data-fix]")) b.classList.toggle("on", c.kind === b.dataset.fix);
  const typed = $("lb-typed");
  if (document.activeElement !== typed) typed.value = LK.CONTROLS.includes(c.kind) || !c.kind ? "" : row.fix;
  const n = rows.filter((r) => r.fix !== r.fix0).length;
  $("lb-save").disabled = !n;
  $("lb-save").textContent = n ? `💾 Save LEAKS.xlsx (${n})` : "💾 Save LEAKS.xlsx";
  $("lb-prev").disabled = $("lb-next").disabled = rows.length < 2;
  $("lb-next-open").disabled = !und;
}

// The Leaks tab's list is BUILT ONCE per worksheet and written on after that.
// A worksheet of a few dozen rows could be thrown away and made again on every
// decision; one of two and a half thousand is ten thousand elements, and
// making them again after every keystroke is a page that stops answering. So
// the rows are kept (`leakLis`), a decision writes on the one row it moved,
// and the click is read from the list rather than bound per row.
let leakLis = [];
const leaksList = $("leaks-list");
leaksList.addEventListener("click", (e) => {
  const li = e.target.closest && e.target.closest("li");
  const i = li && li.parentElement === leaksList ? Number(li.dataset.row) : -1;
  if (i >= 0) goToLeak(i);
});
/** One row's tags and title, from its decision as it stands. */
function paintLeakRow(i) {
  const li = leakLis[i], r = leakRows()[i];
  if (!li || !r) return;
  li.classList.toggle("current", i === (leaks ? leaks.at : -1));
  const c = LK.classifyFix(r.fix, r.value);
  const sug = LK.isSuggested(r);
  const f = li.lastElementChild;
  f.className = "tag fix " + (c.kind && !sug ? (LK.isKeepKind(c.kind) ? "no" : "") : "open");
  f.textContent = sug ? "~?" : c.kind ? (LK.CONTROLS.includes(c.kind) ? c.kind : c.kind === "error" ? "?" : "typed") : "?";
  f.title = c.label + (sug ? " — PDF-Linker's own reading, not yet accepted" : "") + (r.fix !== r.fix0 ? " (unsaved)" : "");
}
/** The hint, the note and the save button — what every decision changes. */
function renderLeaksTabState() {
  updateDirty(); // an answered row is a save's business too
  const rows = leakRows();
  $("leaks-hint").textContent = leaks
    ? `${leaks.name}${leaks.folder ? " · " + leaks.folder : ""} · ${rows.length} row${rows.length === 1 ? "" : "s"}, ${LK.undecidedCount(rows)} to answer. Click a row: the text opens at it.`
    : "Open a case folder with a LEAKS.xlsx in it, or load one, to review its rows here.";
  $("leaks-actions").hidden = !leaks;
  const n = rows.filter((r) => r.fix !== r.fix0).length;
  $("leaks-save").disabled = !n;
  $("leaks-note").textContent = !leaks ? "" : n
    ? `${n} decision${n === 1 ? "" : "s"} not yet saved (remembered here until then).`
    : leaks.handle || dirHandle ? `Saves into ${leaks.folder || folderName || "the folder"}/${leaks.name}. After saving, double-click Apply Fixes.bat, or re-run PDF-Linker.` : "No folder is open: a save asks where to write the worksheet.";
}
/** The whole list, from scratch: a worksheet attached, or dropped. */
function renderLeaksTab() {
  const rows = leakRows();
  const frag = document.createDocumentFragment();
  leakLis = rows.map((r, i) => {
    const li = document.createElement("li");
    li.dataset.row = String(i);
    const t = document.createElement("span");
    t.className = "tag type " + typeClass(r.type);
    t.textContent = typeClass(r.type) === "leak" ? "LEAK" : typeClass(r.type) === "reid" ? "REID" : "review";
    t.title = r.type;
    const v = document.createElement("span");
    v.className = "lv";
    v.textContent = r.value;
    const f = document.createElement("span");
    li.append(t, v, f);
    li.title = `${r.value} — ${r.type} — ${r.file} — ${r.where}`;
    frag.appendChild(li);
    return li;
  });
  leaksList.innerHTML = "";
  leaksList.appendChild(frag);
  for (let i = 0; i < leakLis.length; i++) paintLeakRow(i);
  renderLeaksTabState();
}

/** Show row `i` in the bar and take the text to it. */
async function goToLeak(i, { locate = true } = {}) {
  const rows = leakRows();
  if (!rows.length) return;
  const was = leaks.at;
  leaks.at = ((i % rows.length) + rows.length) % rows.length;
  const row = rows[leaks.at];
  leakRowValue = row.value;
  leakHere = null;
  leaks.problem = ""; // a new row is a new question; locateLeak answers it
  showLeaksBar(true);
  renderLeaksBar();
  paintLeakRow(was);
  paintLeakRow(leaks.at);
  renderLeaksTabState();
  if (locate) await locateLeak(row);
  else paintHighlights();
  warmForLeaks();
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
  // The stems this row's files answer to — their own and the ones the key
  // gives them — read once, since `here` is asked per member and per page.
  const wantStems = new Set();
  for (const f of files) for (const s of [PS.normalizeStem(f), PS.fakedStem(f, fwdName())]) if (s) wantStems.add(s);
  const here = (name) => !!name && wantStems.has(PS.normalizeStem(name));
  let target = null;
  if (files.length && !here(fileName)) {
    for (const f of files) {
      const e = exportForName(f);
      if (e) { target = folderDocs.find((d) => d.name === e); break; }
    }
    // A combined file already open holds every member: stay in it.
    if (target && doc && docMembers().some((m) => here(m))) target = null;
  }
  if (target && target.name !== fileName) {
    // The rows answered in the document being left are written before it is
    // left, exactly as the names walk writes its own (saveOnTheWayOut) — and a
    // save that will not happen holds the review here rather than carrying it
    // into the next document with the last one unwritten.
    if (!(await saveOnTheWayOut())) {
      leaks.problem = `${fileName} was not written, so the review has stayed here. ${TD.docLabel(target.name)} is where this row stands.`;
      $("lb-problem").textContent = leaks.problem;
      paintHighlights();
      return;
    }
    // openFile asks about unsaved edits; a refusal leaves the open document.
    const wasEditing = editing;
    await openFolderDoc(target);
    if (!doc || fileName !== target.name) { paintHighlights(); return; }
    if (wasEditing) setEditing(true);
  }
  // The row's own document is not in this folder. The reader still looks in
  // whatever is open — for a lone file that is the only document there is —
  // but it must SAY which document it looked in, or a "not found" reads as a
  // fact about the row's document when it is a fact about another one.
  const astray = !!files.length && !target && !here(fileName);
  paintHighlights();
  if (!doc) return;
  // The occurrence to stand at: on the page Where names (its own number,
  // under the row's own member in a combined file), on the line it names
  // where the page carries gutter numbers, else the first anywhere.
  const wheres = LK.parseWhere(row.where);
  const members = docPageSources();
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
    // WHY it is not marked, in one sentence that names every document in play.
    // This used to be two toasts — "no export matches it, searching X instead"
    // and then "not in X" — of which the second overwrote the first before it
    // could be read, so the only message left standing said the value was
    // missing from a document the row had never named. One message, and it
    // stays in the bar while the row is being decided.
    const open = fileName || "the open document";
    const mine = files.length ? files[0] : "";
    const pdf = mine ? pdfForName(mine) : null;
    leaks.problem = !files.length
      ? `“${row.value}” is not in ${open}.`
      : astray
        ? `“${row.value}” could not be looked for where the row puts it: no export in ${folderName || "the folder"} answers to ${mine}. ${open} was read instead and does not carry it.`
        : `“${row.value}” is not in ${open}${row.where ? `, where the row puts it (${row.where})` : ""}. `
          + (pdf ? `${pdf} still has it; the export does not. ` : "")
          + "The worksheet was written from the run, so a page edited or deleted since would account for the difference.";
    $("lb-problem").textContent = leaks.problem;
    toast(leaks.problem, { error: true, ms: 9000 });
    return;
  }
  leakHere = best.range;
  markLeakHere();
  const sec = best.body.closest(".tpage");
  scrollRangeTo(best.range);
  if (bestScore < 2 && wheres.length) toast(`Found "${row.value}" on ${TD.pageLabel(doc.pages[Number(sec.dataset.index)]) || "the page"}, not at ${row.where}.`);
}
/** A range brought onto the screen, a third of the way down the stage. */
function scrollRangeTo(range) {
  let rect = range.getBoundingClientRect();
  if (!rect.height) {
    // The page is swapped for its PDF page: the words are in the DOM and not
    // on the screen, so the sheet itself is what there is to scroll to.
    const node = range.startContainer;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const sec = el && el.closest(".tpage");
    if (sec) rect = sec.getBoundingClientRect();
  }
  const st = stageEl.getBoundingClientRect();
  stageEl.scrollTo({ top: stageEl.scrollTop + rect.top - st.top - Math.max(40, stageEl.clientHeight / 3), behavior: "smooth" });
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
  decidedHere++;
  persistLeaks();
  mirrorLeakKeep(row);
  renderLeaksBar();
  paintLeakRow(leaks.at);
  renderLeaksTabState();
  updateLeaksButton();
  paintHighlights();
  warmForLeaks();
  if (!advance) return;
  const n = LK.nextUndecided(leakRows(), leaks.at);
  if (n >= 0 && n !== leaks.at) goToLeak(n);
  else if (n < 0) toast("Every row is answered — save the worksheet, then Apply Fixes.");
}

/**
 * Accept the row as the sheet arrived: PDF-Linker's reading stands, and the
 * row stops coming back. Nothing is written to the workbook — the cell already
 * says this — so the acceptance is remembered here, with the decisions.
 */
function acceptLeak() {
  if (!leaks || leaks.at < 0) return;
  const row = leakRows()[leaks.at];
  if (!LK.isSuggested(row)) return;
  row.ok = true;
  decidedHere++;
  persistLeaks();
  renderLeaksBar();
  paintLeakRow(leaks.at);
  renderLeaksTabState();
  updateLeaksButton();
  warmForLeaks();
  const n = LK.nextUndecided(leakRows(), leaks.at);
  if (n >= 0 && n !== leaks.at) goToLeak(n);
  else if (n < 0) toast("Every row is answered — save the worksheet, then Apply Fixes.");
}

/** Write the decisions into the workbook: the same file, the Fix? cells changed, read back before it is written. */
/**
 * The worksheet written back. `quiet` is for the save that carries it along
 * with the document — the document's own line says so — and `folderOnly` with
 * it: a save of the text is not the moment to put a file picker in front of
 * somebody who never asked for one. Returns what was written, or false.
 */
async function saveLeaks({ quiet = false, folderOnly = false } = {}) {
  if (!leaks) { if (!quiet) toast("No LEAKS.xlsx is loaded.", { error: true }); return false; }
  const edits = LK.fixEdits(leaks.parsed);
  if (!edits.length) { if (!quiet) toast("Nothing to save — no decision has changed."); return false; }
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
    // The check the worksheet turns on: never quietly, whoever asked.
    toast("The worksheet was not saved: " + (e.message || e), { error: true });
    return false;
  }
  let handle = leaks.handle;
  if (!handle && dirHandle) {
    try { handle = await dirHandle.getFileHandle(leaks.name, { create: true }); } catch { handle = null; }
  }
  if (!handle && folderOnly) return false; // nowhere to put it without asking
  const ok = await writeBlob(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), leaks.name, handle,
    { description: "LEAKS worksheet", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } });
  if (!ok) return false;
  leaks.bytes = out;
  if (handle) leaks.handle = handle;
  for (const r of leaks.parsed.rows) r.fix0 = r.fix;
  try { localStorage.removeItem(leaksStoreKey()); } catch { /* fine */ }
  renderLeaksBar();
  for (let i = 0; i < leakLis.length; i++) paintLeakRow(i);
  renderLeaksTabState();
  const und = LK.undecidedCount(leaks.parsed.rows);
  if (!quiet) toast(`Saved ${leaks.name} — ${edits.length} decision${edits.length === 1 ? "" : "s"} written` + (und ? `, ${und} row${und === 1 ? "" : "s"} still to answer` : "") + ". Double-click Apply Fixes.bat (or re-run PDF-Linker) to apply them to the files.", { ms: 6000 });
  return edits.length;
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
// ‹ and › walk the review, not the worksheet: the next row is the next one
// DOWN THE DOCUMENT (leaks.js walkOrder), so stepping through a page's rows
// reads the page instead of hopping about it.
$("lb-prev").addEventListener("click", () => goToLeak(LK.stepFrom(leakRows(), leaks.at, -1)));
$("lb-next").addEventListener("click", () => goToLeak(LK.stepFrom(leakRows(), leaks.at, 1)));
$("lb-next-open").addEventListener("click", () => { const n = LK.nextUndecided(leakRows(), leaks.at); if (n >= 0) goToLeak(n); });
$("lb-accept").addEventListener("click", acceptLeak);
$("lb-find").addEventListener("click", () => { if (leaks && leaks.at >= 0) locateLeak(leakRows()[leaks.at]); });
$("lb-save").addEventListener("click", () => saveLeaks());
$("leaks-save").addEventListener("click", () => saveLeaks());
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
  if (e.key === "ArrowDown") { e.preventDefault(); goToLeak(LK.stepFrom(leakRows(), leaks.at, 1)); }
  else if (e.key === "ArrowUp") { e.preventDefault(); goToLeak(LK.stepFrom(leakRows(), leaks.at, -1)); }
  else if (!typing && e.key.toLowerCase() === "a") { e.preventDefault(); acceptLeak(); }
  else if (!typing && e.key.toLowerCase() === "y") { e.preventDefault(); decideLeak("yes", { advance: true }); }
  else if (!typing && e.key.toLowerCase() === "n") { e.preventDefault(); decideLeak("no", { advance: true }); }
});

// ── auto-scroll while reading ────────────────────────────────────────────────────────
//
// The Inbox Cleaner reader's creep, for the reader's own scroll box — the same
// engine the PDF viewer carries (viewer/autoscroll.js), rebuilt around #stage
// rather than the window, and around a text page rather than a rendered one.
//
// THE PACE IS A READING PACE, not a pixel speed. What a reader sets is words
// per minute, and the pixels follow from the page: a page of a dense
// block-quoted brief and a page of a caption with six lines on it have to move
// at very different speeds to be read at the same pace, and a filing is full of
// both. So each page's own DENSITY — the words it holds per rendered pixel — is
// measured, and the speed under the reading line is (wpm / 60) / density. It
// falls out of that arithmetic that the zoom, the leading, the page width and
// the PDF grid all take care of themselves: they change the pixels a page
// takes, the density is measured in those pixels, and the pace stays what was
// asked for.
//
// A MANUAL SCROLL IS NOT A STOP. Reading is not one-directional — a name is
// checked three lines back, a wheel notch overshoots — and the old creep
// treated every one of those as "turn it off", so the reader reached for the
// keyboard again each time. A scroll SUSPENDS it now, and it comes back on its
// own about a second after the scrolling settles, from wherever the reader left
// the page. Space is the pause that sticks.
//
// AND IT YIELDS TO ANYTHING THE READER IS IN THE MIDDLE OF: a selection being
// held (a value about to be flagged), a keep menu or a swap popup open over the
// text. The page never slides out from under a decision.
//
// SMOOTHNESS. At a reading pace this is ten or twenty pixels a second, and
// scrollTop only moves in whole ones — which at that speed is a visible
// ratchet. The whole pixels go to scrollTop and the remainder is carried by a
// transform on the page column, snapped to the DEVICE pixel grid so the type is
// never resampled onto a half pixel and left soft: half-steps on a HiDPI
// screen, and on a 1x screen exactly the stepping there would have been anyway.
const autoBtn = $("autoscroll");

const AUTO_WPM_KEY = "textReader.autoWpm";
const AUTO_ON_KEY = "textReader.autoOn";
const MIN_WPM = 80, MAX_WPM = 700, WPM_STEP = 25;
// The slowest it will go. A page dense enough to want less than this is being
// read a little faster than asked rather than appearing frozen — and ] is
// there for a reader who meant it.
const MIN_PX_PER_SEC = 4;
// …and the fastest, which is not a pixel figure but a SCREEN figure: however
// little a page holds, it may not go by faster than a reader can see it go by,
// and what "a screenful" is depends on the window.
const MAX_SCREEN_SECONDS = 1.5;
// A page holds at least this much attention whatever its word count says. A
// banner, a caption, a combined file's list of its own documents: little to
// read, still a page you look at rather than one to be teleported through.
const MIN_PAGE_WORDS = 8;
// What a page is taken to hold where its words cannot be counted at all,
// divided by that page's own rendered height so the guess tracks the layout.
const ASSUMED_WORDS_PER_PAGE = 350;
// How far down the box the reading line sits: the page under it sets the pace.
const READING_LINE = 0.45;
// A frame longer than this (a citation pass, a garbage collection, a tab
// switch) is capped, so the document does not lurch when the clock catches up.
const MAX_FRAME_MS = 48;
// Quiet after the last manual scroll before the creep takes back over. Long
// enough that a run of wheel notches and the trackpad momentum after them read
// as one gesture rather than a dozen.
const RESUME_DELAY_MS = 1200;

let autoOn = false;        // the mode itself, remembered between documents
let autoPaused = false;    // Space: an explicit pause, which does not time out
let autoSuspended = false; // a manual scroll, which does
let autoWpm = 250;
let autoRaf = 0, autoLast = 0;
let autoPos = 0;           // the fractional position the engine drives
let autoWritten = null;    // …and the whole one it last wrote, for the backstop
let autoResume = 0;
let autoPxPerSec = 0;      // eased toward the target, so a page change is not a gear change
let autoFrac = 0;          // the sub-pixel remainder the transform is carrying
let autoMetrics = null;    // [{ top, bottom, density }] down the document
let autoWords = null;      // { doc, counts } — the words each page holds

// Remembered, and the mode with it: turning it on is arming a reading
// session, not a document, so the next export opens already moving.
{
  const w = lsGet(AUTO_WPM_KEY, 0);
  if (typeof w === "number" && w >= MIN_WPM && w <= MAX_WPM) autoWpm = w;
  autoOn = lsGet(AUTO_ON_KEY, false) === true;
}

const autoMax = () => Math.max(stageEl.scrollHeight - stageEl.clientHeight, 0);

// ── how many words a page holds ──
//
// Counted off the parsed export rather than the DOM: the model is already in
// hand, a page of it is a handful of strings, and the DOM's own text carries
// the gutter numbers down a pleading margin — twenty-eight "words" a page that
// nobody reads and that would have the creep run a third too fast.
function wordCounts() {
  if (autoWords && autoWords.doc === doc) return autoWords.counts;
  const counts = (doc ? doc.pages : []).map((p) => {
    let n = 0;
    for (const line of p.lines || []) {
      const g = TD.gutterPrefix(line);
      const text = g ? g.rest : line;
      for (const w of String(text).trim().split(/\s+/)) if (w) n++;
    }
    return n;
  });
  autoWords = { doc, counts };
  return counts;
}

/**
 * The document as the engine reads it: where each page stands in the scroll
 * box and how many words a pixel of it is worth. Measured from the DOM, so it
 * is the pace of the layout actually on screen — the zoom, the leading, the
 * page width and the PDF grid are all already in these numbers.
 */
function refreshAutoMetrics() {
  autoMetrics = null;
  const secs = pagesEl.querySelectorAll(".tpage");
  if (!secs.length) return;
  const counts = wordCounts();
  const pages = [];
  let totalWords = 0, totalHeight = 0;
  for (const sec of secs) {
    const height = sec.offsetHeight || 1;
    const words = counts[Number(sec.dataset.index)];
    pages.push({ top: sec.offsetTop, bottom: sec.offsetTop + height, height, words: words == null ? null : words });
    if (words != null) { totalWords += words; totalHeight += height; }
  }
  // A page the model has no count for at all is read at the document's own
  // average, where there is one. A page it counts as nearly empty is NOT: a
  // caption page really does hold nine words, and a reader really does cross it
  // in a second or two. It is held to MIN_PAGE_WORDS so that "nearly empty"
  // does not become "instantaneous", and the screen cap above does the rest.
  const median = pages[Math.floor(pages.length / 2)].height;
  const fallback = totalWords > 0 && totalHeight > 0
    ? totalWords / totalHeight
    : ASSUMED_WORDS_PER_PAGE / median;
  for (const p of pages) {
    p.density = p.words == null ? fallback : Math.max(p.words, MIN_PAGE_WORDS) / p.height;
  }
  autoMetrics = pages;
}

function autoDensityAt(y) {
  if (!autoMetrics || !autoMetrics.length) return null;
  let lo = 0, hi = autoMetrics.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (autoMetrics[mid].bottom < y) lo = mid + 1; else hi = mid;
  }
  return autoMetrics[lo].density || null;
}

function autoTarget() {
  const d = autoDensityAt(autoPos + stageEl.clientHeight * READING_LINE);
  if (!d) return null;
  const ceiling = Math.max(MIN_PX_PER_SEC * 4, stageEl.clientHeight / MAX_SCREEN_SECONDS);
  return Math.max(MIN_PX_PER_SEC, Math.min(ceiling, (autoWpm / 60) / d));
}

// ── the engine ──
function autoRunning() { return autoOn && !!doc && !autoPaused && !autoSuspended; }

function autoStart() {
  if (autoMax() <= 4) return; // a short document: armed, and nothing to do
  if (!autoRunning() || autoRaf) return;
  if (!autoMetrics) refreshAutoMetrics();
  autoLast = 0;
  autoWritten = null;
  autoPos = stageEl.scrollTop;
  pagesEl.style.willChange = "transform";
  autoRaf = requestAnimationFrame(autoTick);
}

function autoStop() {
  if (autoRaf) { cancelAnimationFrame(autoRaf); autoRaf = 0; }
  autoLast = 0;
  autoClearFrac();
}

function autoTick(ts) {
  autoRaf = 0;
  if (!autoRunning()) return;
  // The backstop, and the reason a manual scroll never has to be caught as an
  // event to be obeyed: the position is somewhere the engine did not put it, so
  // something else is driving — the scroll bar, a find, the PDF pane pulling
  // the text along beside it, a click on a leak row.
  if (autoWritten != null && Math.abs(stageEl.scrollTop - autoWritten) > 3) { autoInterrupt(); return; }
  // Holding a selection is reading with intent — a value about to be flagged,
  // a passage about to be copied — and so is a menu standing open over the text.
  if (autoBusy()) { autoInterrupt(); return; }

  if (!autoLast) autoLast = ts;
  let dt = ts - autoLast;
  autoLast = ts;
  if (dt > MAX_FRAME_MS) dt = MAX_FRAME_MS;

  const target = autoTarget();
  if (target == null) { autoRaf = requestAnimationFrame(autoTick); return; }
  // Eased over about half a second, so crossing into a denser page slows the
  // document rather than shifting gear under the eye.
  if (!autoPxPerSec) autoPxPerSec = target;
  else autoPxPerSec += (target - autoPxPerSec) * Math.min(1, dt / 500);

  const limit = autoMax();
  autoPos = Math.min(autoPos + (autoPxPerSec * dt) / 1000, limit);
  autoWrite();
  if (autoPos >= limit - 0.5) { autoFinish(); return; }
  autoRaf = requestAnimationFrame(autoTick);
}

// The whole pixels to scrollTop, the remainder to a transform on the column.
// Writing the same integer twice fires no scroll event, so the per-scroll work
// beside this — the PDF pane held page for page, the citation bookkeeping —
// runs at the stepping rate rather than once a frame.
function autoWrite() {
  const whole = Math.floor(autoPos);
  stageEl.scrollTop = whole;
  autoWritten = stageEl.scrollTop;
  autoSetFrac(autoPos - whole);
}

function autoSetFrac(frac) {
  const dpr = window.devicePixelRatio || 1;
  const q = Math.round(frac * dpr) / dpr;
  if (q === autoFrac) return;
  autoFrac = q;
  pagesEl.style.transform = q ? `translate3d(0, ${-q}px, 0)` : "";
}

/** The column back where it stands, so a manual scroll starts from a clean page. */
function autoClearFrac() {
  if (!autoFrac && !pagesEl.style.transform && !pagesEl.style.willChange) return;
  autoFrac = 0;
  pagesEl.style.transform = "";
  pagesEl.style.willChange = "";
}

function autoHasSelection() {
  const sel = window.getSelection();
  return !!(sel && sel.rangeCount && !sel.isCollapsed && String(sel).trim());
}

/**
 * Something the reader is in the middle of, which the page may not move under.
 *
 * A selection being held is a value about to be flagged or a passage about to
 * be copied; a menu or a popup stands over a place in the text and belongs to
 * it. And a review is the same thing at the scale of the document: the LEAKS
 * worksheet and the names walk both put the text at a row and ask a question
 * about that row, and the redaction tool is a hand over a page. Creeping under
 * any of them would carry the answer off the screen.
 *
 * Unlike the yield to a manual scroll this one does not time out — the resume
 * asks again and keeps waiting — so the creep picks up when the work is put
 * down, not a second and a bit later regardless.
 */
function autoBusy() {
  if (autoHasSelection()) return true;
  if (redactOn) return true;
  for (const id of ["keep-menu", "flag-pop", "swap-pop", "leaks-bar", "names-bar"]) {
    const el = $(id);
    if (el && !el.hidden) return true;
  }
  return false;
}

/** Yield now, and come back once they are done. */
function autoInterrupt() {
  if (!autoOn || autoPaused) return;
  autoSuspended = true;
  autoStop();
  autoScheduleResume();
}

function autoScheduleResume() {
  clearTimeout(autoResume);
  autoResume = setTimeout(() => {
    autoResume = 0;
    if (!autoOn || autoPaused || !doc) return;
    // Still busy: ask again rather than pulling the page out from under them.
    if (autoBusy()) { autoScheduleResume(); return; }
    autoSuspended = false;
    autoPxPerSec = 0; // take the pace up again where they left the page
    autoStart();
    updateAutoUi();
  }, RESUME_DELAY_MS);
}

/**
 * The foot of what is on screen. On a reel that is not the end of the reading
 * — the next document is read and hung underneath, and the creep carries into
 * it — so it only stops where the folder itself runs out.
 */
function autoFinish() {
  if (reelOn() && !reelDone) {
    autoInterrupt(); // hold while the next one is read; the resume picks it up
    reelMaybeExtend();
    return;
  }
  autoPaused = true;
  autoStop();
  updateAutoUi();
  toast(reel.length > 1
    ? "Auto-scroll reached the end of the case folder — Space reads on from wherever you scroll back to."
    : "Auto-scroll reached the end — Space reads on from wherever you scroll back to.");
}

function setAutoScroll(on) {
  autoOn = !!on && !!doc;
  lsSet(AUTO_ON_KEY, autoOn);
  autoPaused = false;
  autoSuspended = false;
  autoPxPerSec = 0;
  clearTimeout(autoResume);
  autoResume = 0;
  if (!autoOn) autoStop();
  else if (autoMax() <= 4) toast("Nothing to auto-scroll — the document fits on screen.");
  else { refreshAutoMetrics(); autoStart(); }
  updateAutoUi();
}

/** Space: a pause that sticks, against the manual-scroll one that does not. */
function toggleAutoPlay() {
  if (!autoOn) { setAutoScroll(true); toast(`Auto-scroll on · ${autoWpm} wpm`); return; }
  autoPaused = !autoPaused;
  autoSuspended = false;
  clearTimeout(autoResume);
  autoResume = 0;
  if (autoPaused) autoStop();
  else { autoPxPerSec = 0; autoStart(); }
  updateAutoUi();
}

function setAutoWpm(next) {
  const w = Math.max(MIN_WPM, Math.min(MAX_WPM, Math.round(Number(next) || 250)));
  if (w === autoWpm) return;
  autoWpm = w;
  lsSet(AUTO_WPM_KEY, autoWpm);
  updateAutoUi();
}

function nudgeAutoSpeed(delta) {
  setAutoWpm(Math.round((autoWpm + delta) / WPM_STEP) * WPM_STEP);
  toast(`Auto-scroll ${autoWpm} wpm` + (autoOn ? "" : " (off — A starts it)"));
}

// ── the pill ──
//
// A reading pace is not a thing you can see: 250 and 400 look the same until
// the page moves, so a wpm engine with no readout is a setting you cannot aim.
// The pill is that readout and the controls beside it, over the text because
// that is where the eye already is — and draggable, because it will cover
// something eventually, with the spot remembered as fractions of the free
// space so it lands the same way on any window.
const AS_PILL_KEY = "textReader.autoPill";
const asPill = $("as-pill");
let asPillPos = null;
{
  const p = lsGet(AS_PILL_KEY, null);
  if (p && isFinite(p.fx) && isFinite(p.fy)) asPillPos = { fx: clamp01(p.fx), fy: clamp01(p.fy) };
}
function clamp01(v) { return Math.min(1, Math.max(0, Number(v) || 0)); }

/** The room the pill has: the stage's box, less the pill itself. */
function asPillFree() {
  const r = stageEl.getBoundingClientRect();
  if (!asPill.offsetWidth) return null;
  return { left: r.left, top: r.top,
           x: Math.max(r.width - asPill.offsetWidth - 12, 0),
           y: Math.max(r.height - asPill.offsetHeight - 12, 0) };
}
function placePill(x, y) {
  asPill.style.left = Math.round(x) + "px";
  asPill.style.top = Math.round(y) + "px";
}
/** Back where it was left — and, with nothing remembered, low and centred. */
function applyPillPos() {
  const free = asPillFree();
  if (!free) return;
  const at = asPillPos || { fx: 0.5, fy: 0.94 };
  placePill(free.left + 6 + at.fx * free.x, free.top + 6 + at.fy * free.y);
}
{
  let drag = null;
  asPill.addEventListener("pointerdown", (e) => {
    // The controls are controls, not grab handles.
    if (e.target.closest("button, input")) return;
    const free = asPillFree();
    if (!free) return;
    const r = asPill.getBoundingClientRect();
    drag = { id: e.pointerId, free, moved: false, dx: e.clientX - r.left, dy: e.clientY - r.top };
    try { asPill.setPointerCapture(e.pointerId); } catch { /* fine */ }
    asPill.classList.add("dragging");
    e.preventDefault();
  });
  asPill.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const f = drag.free;
    const x = Math.min(Math.max(e.clientX - drag.dx, f.left + 6), f.left + 6 + f.x);
    const y = Math.min(Math.max(e.clientY - drag.dy, f.top + 6), f.top + 6 + f.y);
    drag.moved = true;
    placePill(x, y);
    asPillPos = { fx: f.x ? (x - f.left - 6) / f.x : 0, fy: f.y ? (y - f.top - 6) / f.y : 0 };
    e.preventDefault();
  });
  const end = (e) => {
    if (!drag || (e.pointerId != null && e.pointerId !== drag.id)) return;
    if (drag.moved) lsSet(AS_PILL_KEY, asPillPos);
    try { asPill.releasePointerCapture(drag.id); } catch { /* gone */ }
    drag = null;
    asPill.classList.remove("dragging");
  };
  asPill.addEventListener("pointerup", end);
  asPill.addEventListener("pointercancel", end);
  window.addEventListener("resize", () => { if (!asPill.hidden) applyPillPos(); }, { passive: true });

  $("asp-play").addEventListener("click", () => { toggleAutoPlay(); pillAwake(); });
  $("asp-slower").addEventListener("click", () => { nudgeAutoSpeed(-WPM_STEP); pillAwake(); });
  $("asp-faster").addEventListener("click", () => { nudgeAutoSpeed(WPM_STEP); pillAwake(); });
  $("asp-close").addEventListener("click", () => { setAutoScroll(false); toast("Auto-scroll off"); });
  $("asp-speed").addEventListener("input", (e) => { setAutoWpm(e.target.value); pillAwake(); });
}

// It sits over the reading, so it fades while the pointer is still and comes
// back on any movement — the viewer's own bar does the same.
const PILL_IDLE_MS = 2500;
let pillIdleTimer = 0;
function pillAwake() {
  if (asPill.hidden) return;
  asPill.classList.remove("idle");
  clearTimeout(pillIdleTimer);
  pillIdleTimer = setTimeout(() => {
    if (!asPill.matches(":hover")) asPill.classList.add("idle");
  }, PILL_IDLE_MS);
}
document.addEventListener("mousemove", pillAwake, { passive: true });

function updateAutoUi() {
  const show = autoOn && !!doc;
  if (asPill.hidden !== !show) {
    asPill.hidden = !show;
    if (show) { applyPillPos(); pillAwake(); }
  }
  if (show) {
    // A yield to a manual scroll still reads as playing — it comes back on its
    // own — so the icon does not flicker while the reader scrolls.
    $("asp-play").textContent = autoPaused ? "▶" : "❙❙";
    $("asp-play").title = autoPaused ? "Resume (Space)" : "Pause (Space)";
    const sl = $("asp-speed");
    if (Number(sl.value) !== autoWpm) sl.value = String(autoWpm);
    $("asp-wpm").textContent = autoWpm + " wpm";
    asPill.classList.toggle("paused", autoPaused);
  }
  autoBtn.setAttribute("aria-pressed", String(autoOn));
  const state = !autoOn ? `Auto-scroll while reading (A) — ${autoWpm} wpm`
    : !doc ? `Auto-scroll is on at ${autoWpm} wpm — it starts with the next document`
    : autoPaused ? `Auto-scroll paused at ${autoWpm} wpm — Space reads on`
    : `Auto-scrolling at ${autoWpm} wpm`;
  autoBtn.title = state +
    "; [ slower, ] faster, Space pauses. The pace is a reading pace: each page moves at the speed its own text needs.";
}

// ── what the reader does ──
autoBtn.addEventListener("click", () => {
  setAutoScroll(!autoOn);
  toast(autoOn ? `Auto-scroll on · ${autoWpm} wpm` : "Auto-scroll off");
});
// Observed, never blocked: the browser scrolls as it always would and the
// creep gets out of the way. On the document rather than on the stage, because
// a wheel over the PDF pane pulls the text along beside it and is the reader
// scrolling as much as the other is — and because a click on a button is
// something being done too, and the creep comes back a second later anyway.
for (const evt of ["wheel", "mousedown", "touchstart"]) {
  document.addEventListener(evt, (e) => {
    // …but not the pill's own: pausing, or dragging the speed slider, is
    // working the creep rather than scrolling away from it.
    if (e.target && e.target.closest && e.target.closest("#as-pill")) return;
    autoInterrupt();
  }, { passive: true, capture: true });
}
// The keys that scroll on their own: the reader gets the jump, and the creep
// steps aside and comes back after it.
const AUTO_SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);
document.addEventListener("keydown", (e) => {
  // Not while typing in the document or a field.
  const t = e.target;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
  if (e.key === "a" || e.key === "A") {
    e.preventDefault();
    setAutoScroll(!autoOn);
    toast(autoOn ? `Auto-scroll on · ${autoWpm} wpm` : "Auto-scroll off");
  } else if (e.key === "[") { e.preventDefault(); nudgeAutoSpeed(-WPM_STEP); }
  else if (e.key === "]") { e.preventDefault(); nudgeAutoSpeed(WPM_STEP); }
  // Shift+Space belongs to the link opener, as it does in the viewer.
  else if (e.key === " " && !e.shiftKey && autoOn) { e.preventDefault(); toggleAutoPlay(); }
  else if (AUTO_SCROLL_KEYS.has(e.key)) autoInterrupt();
});

/**
 * A document went up, or the layout under one moved (the panes, the grid, the
 * reading size, a window resize). The pages are where they are now, so the
 * pace is taken from them again — and the engine's own position with it, since
 * the scroll box it was driving has been re-laid underneath it.
 */
function autoRemeasure({ newDoc = false } = {}) {
  // A short document does not fill the box, and nothing will ever scroll to
  // ask for the next one: the reel reaches once as the document goes up.
  if (newDoc && reelJustOpened) { reelJustOpened = false; setTimeout(reelMaybeExtend, 0); }
  if (newDoc) { autoWords = null; autoPaused = false; autoSuspended = false; }
  autoMetrics = null;
  updateAutoUi();
  if (!autoOn || !doc) return;
  autoStop(); // the column back to clean before it is measured again
  refreshAutoMetrics();
  autoPxPerSec = 0;
  autoStart();
}
updateAutoUi();

// ── the reel: the folder read as one document ────────────────────────────────────────
//
// A case folder is one filing read in pieces. PDF-Linker writes a document per
// export and a Combined Text.txt beside them holding every one of them, and the
// combined file is what you read when you want to read the CASE rather than a
// motion — but it is a file somebody has to have built, it is stale the moment
// a single export is re-run, and a save of it writes every document at once.
//
// The reel is that reading without that file. The document on screen is the one
// that was opened; as the foot of it comes into view the NEXT export in the
// Documents list is read, parsed and hung underneath it, with a divider naming
// it, and so on down the folder. Nothing is combined on disk, nothing is
// written that was not edited, and each document goes back to its own file
// under its own name.
//
// AND IT READS BACK UP. The export you open is rarely the first paper in the
// case, and the papers BEFORE it are as much of the reading as the papers
// after it, so coming up to the head of the reel hangs the previous export
// above it, and so on back up the folder. Reading up is asked for rather than
// assumed — a document opens at its own first page, and pulling the whole
// case above it in the moment it opens is not what anybody asked for — so it
// waits for the reading to come UP the column (and at the very top, where the
// scroll box has nothing left to give and fires no event, for the wheel or the
// key that meant it).
//
// THE TWO DIRECTIONS COST DIFFERENTLY. Hanging a document underneath moves
// nothing: its pages go on the end and every index already handed out is the
// index it was. Hanging one above moves EVERYTHING below it, so `reelShift`
// renumbers the page sections, the members' runs, the spot keeps and the undo
// history in one pass before the pages go in — and the scroll is then put back
// by exactly the height that went in, so the reading does not move while the
// folder grows above it.
//
// WHAT A MEMBER IS. `doc.pages` is the whole reel, page after page, exactly as
// a combined file's pages would be — which is the point: everything that reads
// a page by its index (the pane, the citations, the rules, the leak rows, the
// spot keeps) goes on working without knowing there is more than one file in
// it. `reel` says which RUN of those pages came from which file, and that is
// the only thing that knows.
//
// AND THE CURRENT DOCUMENT FOLLOWS THE READING. The status bar, the Documents
// list, the spot keeps and the file a save adopts are all "this document", and
// with four of them on screen the one you mean is the one you are looking at.
// It changes as the reading line crosses a divider, which is the same event as
// scrolling into it.
//
// A save writes EVERY member that was edited, each to its own handle, and names
// them. Nothing else is touched: a document scrolled past and not typed in is
// not rewritten, so a reel of forty documents does not put forty files' mtimes
// through a review that changed one line of one of them.

// How close to the foot the reading has to come before the next document is
// read: two screens, so it is already there when it is reached rather than
// arriving as a jolt under the eye. The head of the reel is given the same
// two screens for the document before it.
const REEL_AHEAD_SCREENS = 2;
// How many documents may hang off one reel. A page of a long export is not
// free — its lines, its pseudonym spans, its citation underlines — and a case
// folder can hold three hundred of them: read end to end that is a tab that
// stops answering. At the ceiling the reel stops and says so, and opening the
// next document on its own starts a fresh reel from there.
//
// FEWER IN A BIG FOLDER. A dozen exports of a small case are a reel a reader
// can hold in mind and a tab can hold in memory. A folder of hundreds is a
// document with a PDF behind it every time, and a review holds every page of
// the reel live (nothing is shed under one). So the ceiling there is the few
// documents either side of the one being read, which is as far as a reading
// goes before it wants a different document anyway.
const REEL_MAX = 25;
const REEL_MAX_BIG = 8;
function reelMax() { return oneDocAtATime() ? REEL_MAX_BIG : REEL_MAX; }
// …and in PAGES, which is what a reel actually costs. Counting documents says
// a folder of one-page proofs of service and a folder of hundred-page exhibit
// sets are the same reel; the first is twenty-five pages and the second two
// and a half thousand, each with its lines, its pseudonym spans and its
// citation underlines. Either ceiling stops the reel, and it says which.
const REEL_MAX_PAGES = 600;

let reel = [];          // [{ name, handle, newline, trailingNewline, from, count, dirty, spots }]
let reelAt = 0;         // the member being read: an index into `reel`
let reelBusy = false;   // one append at a time — the scroll asks many times
let reelDone = false;   // the folder is read out downward
let reelDoneUp = false; // …and back up: nothing before the head of the reel
let reelJustOpened = false; // a document went up: the first reach happens without a scroll
let reelLastTop = 0;    // the scroll the last event saw, for which way the reading is going

/** The reel as one member: a document opened on its own, or the head of a folder read. */
function reelReset(parsed, name, handle, theirSpots) {
  reel = [{
    name, handle,
    newline: parsed.newline, trailingNewline: parsed.trailingNewline,
    from: 0, count: parsed.pages.length,
    dirty: false, spots: theirSpots || [],
  }];
  reelAt = 0;
  reelBusy = false;
  reelDone = false;
  reelDoneUp = false;
  reelLastTop = 0; // the document goes up at its own first page
}

/** The member a page belongs to, by its index into `doc.pages`. */
function reelMemberOf(pageIndex) {
  for (let i = reel.length - 1; i >= 0; i--) if (pageIndex >= reel[i].from) return reel[i];
  return reel[0] || null;
}
/** …and its place in the reel. */
function reelIndexOf(pageIndex) {
  for (let i = reel.length - 1; i >= 0; i--) if (pageIndex >= reel[i].from) return i;
  return 0;
}
function reelCurrent() { return reel[reelAt] || null; }

/**
 * The documents on screen, in order — the reel's members, or a combined file's
 * own. Everything that already knew how to put several documents beside one
 * page list (the pane, the pickers, the leak review) asks this, and a reel
 * reads to it exactly as a Combined Text.txt does.
 */
function docMembers() {
  if (reel.length > 1) return reel.map((m) => m.name);
  return doc ? PS.combinedMembers(doc.pages) : [];
}
/** …and per page, which of them it belongs to. */
function docPageSources() {
  if (!doc) return [];
  return reel.length > 1 ? reelPageNames() : PS.pageSources(doc.pages, fileName);
}

/** Per page, the name of the document it came from — what the PDF pane matches on. */
function reelPageNames() {
  const out = new Array(doc ? doc.pages.length : 0).fill("");
  for (const m of reel) for (let i = m.from; i < m.from + m.count; i++) out[i] = m.name;
  return out;
}

/** The next export down the Documents list, or null at the end of it. */
function reelNextDoc() {
  if (!reel.length || !folderDocs.length) return null;
  const last = reel[reel.length - 1];
  const at = folderDocs.findIndex((d) => d.name === last.name);
  if (at < 0) return null;
  for (let i = at + 1; i < folderDocs.length; i++) {
    const d = folderDocs[i];
    // The combined file is every other document over again: reading it INTO a
    // reel of those documents would be the folder read twice.
    if (d.combined) continue;
    if (reel.some((m) => m.name === d.name)) continue;
    return d;
  }
  return null;
}

/** The export before the head of the reel, or null at the top of the folder. */
function reelPrevDoc() {
  if (!reel.length || !folderDocs.length) return null;
  const first = reel[0];
  const at = folderDocs.findIndex((d) => d.name === first.name);
  if (at < 0) return null;
  for (let i = at - 1; i >= 0; i--) {
    const d = folderDocs[i];
    if (d.combined) continue; // as below: the case read twice
    if (reel.some((m) => m.name === d.name)) continue;
    return d;
  }
  return null;
}

/** Whether another document may go on the reel at all — either end of it. */
function reelRoom() {
  const pages = doc ? doc.pages.length : 0;
  if (reel.length < reelMax() && pages < REEL_MAX_PAGES) return true;
  reelDone = true;
  reelDoneUp = true;
  toast(pages >= REEL_MAX_PAGES
    ? `${pages} pages is as far as one reel goes — open another from the Documents list to read on from there.`
    : `${reelMax()} documents is as far as one reel goes${oneDocAtATime() ? " in a folder this size" : ""} — open another from the Documents list to read on from there.`,
  { ms: 6000 });
  renderReelState();
  return false;
}

/** The divider between two documents: what is ending, and what is starting. */
function reelDivider(m, { back = false } = {}) {
  const el = document.createElement("div");
  el.className = "reel-divider";
  el.dataset.name = m.name;
  const label = document.createElement("span");
  label.className = "rd-name";
  label.textContent = m.name.replace(/\.txt(\.LEAK)?$/i, "");
  const note = document.createElement("span");
  note.className = "rd-note";
  note.textContent = TD.isQuarantinedName(m.name) ? "quarantined by the leak gate"
    : back ? "earlier in the case folder" : "next in the case folder";
  const only = document.createElement("button");
  only.type = "button";
  only.className = "rd-only";
  only.title = "Open this document on its own, from its first page";
  only.textContent = "Open on its own";
  only.addEventListener("click", (e) => {
    e.preventDefault();
    const d = folderDocs.find((x) => x.name === m.name);
    if (d) openFolderDoc(d);
  });
  el.append(label, note, only);
  return el;
}

/**
 * Hang the next document under the last. Answers whether one went up.
 *
 * A document the leak review has already built off the page goes up as it
 * stands; otherwise it is read and parsed here. Either way its pages are
 * APPENDED to `doc.pages`, so every index already handed out stays the index
 * it was — nothing above moves when something is added below it.
 */
async function reelExtend() {
  if (reelBusy || reelDone || !doc || !dirHandle) return false;
  if (!reelRoom()) return false;
  const next = reelNextDoc();
  if (!next) { reelDone = true; return false; }
  reelBusy = true;
  const was = doc; // a document opened while the file was being read is another reel
  try {
    let parsed = null;
    const built = ready.get(next.name);
    if (built && built.doc && built.epoch === readyEpoch) parsed = built.doc;
    if (!parsed) parsed = TD.parseExport(await (await next.handle.getFile()).text());
    if (doc !== was) return false;
    const from = doc.pages.length;
    const theirSpots = spotsFrom(TD.normalizeSpots(lsGet(SPOTS_PREFIX + (folderName || "") + "/" + next.name, [])), from);
    const m = {
      name: next.name, handle: next.handle,
      newline: parsed.newline, trailingNewline: parsed.trailingNewline,
      from, count: parsed.pages.length, dirty: false, spots: theirSpots,
    };
    doc.pages = doc.pages.concat(parsed.pages);
    reel.push(m);
    const frag = document.createDocumentFragment();
    m.divider = reelDivider(m);
    frag.appendChild(m.divider);
    during("hanging the next document on the reel", () =>
      buildPages(frag, doc.pages, { from, to: from + m.count, spots: theirSpots, editable: editing }));
    pagesEl.appendChild(frag);
    reelChanged();
    // …and the far end is let go of once this one has been LAID OUT. Never
    // here: a page appended this instant has not been through applyPageWidth
    // yet, and shedding it (or anything measured in the same frame) would pin
    // a height the sheet is about to stop having.
    reelTrimSoon();
    return true;
  } catch (e) {
    console.error("[text-reader] the reel could not hang " + next.name + ":", e);
    toast("Could not read " + next.name + ": " + (e.message || e), { error: true });
    reelDone = true; // do not sit in a loop asking for a file that will not open
    return false;
  } finally { reelBusy = false; }
}

/** The reel grew: everything measured off the document is measured again. */
function reelChanged() {
  textAnchors = null; textLineTops = null;
  autoWords = null;
  applyMatchedLayout();
  applyPageWidth();
  placeCitationsSoon();
  textEpoch++;
  paintHighlights();
  refindSoon(); // the pages hung on the end are pages the find has not read
  refreshPdf();
  autoRemeasure();
  renderReelState();
}

/**
 * Near the foot: read the next one. Asked on every scroll, so it is cheap
 * until it is not — and while one is being read the rest of the asks fall on
 * `reelBusy` rather than starting a second.
 */
function reelMaybeExtend() {
  if (!reelOn() || reelBusy || reelDone) return;
  const left = stageEl.scrollHeight - (stageEl.scrollTop + stageEl.clientHeight);
  if (left > stageEl.clientHeight * REEL_AHEAD_SCREENS) return;
  reelExtend().then((added) => {
    // A short document can leave the foot still in view: keep going until the
    // reading has two screens in front of it again.
    if (added) reelMaybeExtend();
  });
}

/**
 * Every page number in hand moves down by `n`: a document went in above.
 *
 * `doc.pages` is ONE list and a page is named by its place in it, which is
 * what makes the reel invisible to everything that reads a page — the pane,
 * the citation strips, the leak rows, the spot keeps, the undo history. The
 * price of reading backwards is that those numbers are not stable, and this is
 * the one place that pays it: everything holding one is renumbered here, in a
 * single pass, before the pages themselves go in.
 *
 * The spot keeps are moved IN PLACE. The open document's list and its member's
 * are usually the same array and sometimes the same objects in two arrays (an
 * edit rebuilds the list around the page it touched and keeps the rest), so
 * each spot is moved once, by object, rather than once per list it is in.
 */
function reelShift(n) {
  if (!n) return;
  for (const sec of pagesEl.querySelectorAll(".tpage")) sec.dataset.index = String(Number(sec.dataset.index) + n);
  const moved = new Set();
  const bump = (list) => { for (const x of list || []) if (!moved.has(x)) { moved.add(x); x.page += n; } };
  for (const m of reel) { m.from += n; bump(m.spots); }
  bump(spots);
  for (const sn of undoStack) { sn.page += n; bump(sn.spots); }
  for (const sn of redoStack) { sn.page += n; bump(sn.spots); }
  if (lastSnapPage >= 0) lastSnapPage += n;
  autoWords = null;        // counted per page, by the numbers that just moved
  textAnchors = null; textLineTops = null;
}

/**
 * Whether a document may be hung ABOVE the reading at this moment.
 *
 * A pass that is holding page numbers of its own — the leak review, the names
 * walk, the redaction's misses, a print being prepared — would be holding the
 * numbers of OTHER pages a moment later, so nothing goes in above one while it
 * is open. Reading down is never held up this way: nothing moves under it.
 */
function reelCanRenumber() {
  return leaksBar.hidden && namesBar.hidden && !redactOn && !missWalk.length && !printPut;
}

/**
 * The head of the reel, given the seam it never needed. A reel opens with its
 * head at the top of the column and nothing above it to be divided from; the
 * first document hung above it puts something there.
 */
function markHeadDivider(m) {
  if (!m || m.divider) return;
  const sec = pagesEl.querySelector(`.tpage[data-index="${m.from}"]`);
  if (!sec) return;
  m.divider = reelDivider(m);
  pagesEl.insertBefore(m.divider, sec);
}

/**
 * Hang the document BEFORE the head of the reel above it. Answers whether one
 * went up.
 *
 * Its pages go on the FRONT of `doc.pages` and everything below is renumbered
 * with them (`reelShift`), which is the whole difference from hanging one
 * underneath. And the reading must not move: pages going in above the window
 * push the window down the column, so the page that was at the head is
 * measured before and after and the scroll put back by the difference — after
 * the layout has run, so the height it is put back by is the height the new
 * pages are going to keep.
 */
async function reelPrepend() {
  if (reelBusy || reelDoneUp || !doc || !dirHandle) return false;
  if (!reelCanRenumber()) return false;
  const prev = reelPrevDoc();
  if (!prev) { reelDoneUp = true; renderReelState(); return false; }
  if (!reelRoom()) return false;
  reelBusy = true;
  const was = doc, head = reel[0]; // …and the reel may not be this reel by then
  try {
    let parsed = null;
    const built = ready.get(prev.name);
    if (built && built.doc && built.epoch === readyEpoch) parsed = built.doc;
    if (!parsed) parsed = TD.parseExport(await (await prev.handle.getFile()).text());
    if (doc !== was || reel[0] !== head || !reelCanRenumber()) return false;
    const n = parsed.pages.length;
    // Where the reading stands, before anything goes in above it.
    const anchor = pagesEl.querySelector(".tpage");
    const wasTop = stageEl.scrollTop;
    const wasAt = anchor ? anchor.offsetTop : 0;
    reelShift(n);
    doc.pages = parsed.pages.concat(doc.pages);
    // Its own spots are already the reel's numbering: it starts the reel.
    const theirSpots = TD.normalizeSpots(lsGet(SPOTS_PREFIX + (folderName || "") + "/" + prev.name, []));
    const m = {
      name: prev.name, handle: prev.handle,
      newline: parsed.newline, trailingNewline: parsed.trailingNewline,
      from: 0, count: n, dirty: false, spots: theirSpots,
    };
    reel.unshift(m);
    reelAt++; // the member being READ is the one it was; its place in the reel is not
    markHeadDivider(reel[1]);
    const frag = document.createDocumentFragment();
    m.divider = reelDivider(m, { back: true });
    frag.appendChild(m.divider);
    during("hanging the document before this one on the reel", () =>
      buildPages(frag, doc.pages, { from: 0, to: n, spots: theirSpots, editable: editing }));
    pagesEl.insertBefore(frag, pagesEl.firstChild);
    reelChanged();
    if (anchor) {
      stageEl.scrollTop = wasTop + (anchor.offsetTop - wasAt);
      reelLastTop = stageEl.scrollTop; // put back, not scrolled: not a reading going down
    }
    reelTrimSoon();
    return true;
  } catch (e) {
    console.error("[text-reader] the reel could not hang " + prev.name + ":", e);
    toast("Could not read " + prev.name + ": " + (e.message || e), { error: true });
    reelDoneUp = true; // do not sit in a loop asking for a file that will not open
    return false;
  } finally { reelBusy = false; }
}

/**
 * Near the head: read the one before it. The same two screens the foot is
 * given, and the same one at a time.
 */
function reelMaybePrepend() {
  if (!reelOn() || reelBusy || reelDoneUp) return;
  if (stageEl.scrollTop > stageEl.clientHeight * REEL_AHEAD_SCREENS) return;
  reelPrepend().then((added) => {
    // A short document can leave the head still in view: keep going back until
    // the reading has two screens behind it again.
    if (added) reelMaybePrepend();
  });
}

/**
 * Which way the reading is going. Only a reading coming UP the column asks for
 * the document before this one — a scroll down past the two screens at the top
 * is not a request for the rest of the case.
 */
function reelScrolled() {
  const top = stageEl.scrollTop;
  const up = top < reelLastTop;
  reelLastTop = top;
  if (up) reelMaybePrepend();
}
// At the very top there is no scroll left to make and no event to hear, so the
// wheel turned up and the keys that mean up are heard for themselves.
stageEl.addEventListener("wheel", (e) => { if (e.deltaY < 0) reelMaybePrepend(); }, { passive: true });
const REEL_BACK_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);
document.addEventListener("keydown", (e) => {
  // Not from a field, and not from a page being TYPED in: there the keys move
  // a caret, and a caret that actually moves the reading scrolls the box,
  // which is heard above.
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
  if (REEL_BACK_KEYS.has(e.key)) reelMaybePrepend();
});

/**
 * Whether the reel runs at all: a case folder, another document in it either
 * side of this one, and the reading set to go on.
 *
 * Never off a Combined Text.txt. That file already holds every export in the
 * folder, so hanging the folder's exports under it would be the case read
 * twice — and it is the one document that is a reel already.
 */
function reelOn() {
  if (!doc || !dirHandle || folderDocs.length < 2 || settings.reel === false) return false;
  const head = reel[0];
  return !!head && !folderDocs.some((d) => d.name === head.name && d.combined);
}

/**
 * The page the reading line sits on — a third of the way down the stage,
 * where the eye is. Which document is being read and which PDFs are in use
 * are both asked from here, so both mean the same page.
 */
function readingPage() {
  const line = stageEl.scrollTop + stageEl.clientHeight * 0.35;
  let at = 0;
  for (const sec of pagesEl.querySelectorAll(".tpage")) {
    if (sec.offsetTop > line) break;
    at = Number(sec.dataset.index) || 0;
  }
  return at;
}

/**
 * The document being read, from where the reading line sits. The status bar,
 * the Documents list, the spot keeps and the file a save adopts all mean "this
 * document", and with several on screen the one meant is the one being looked
 * at.
 */
function reelSyncCurrent() {
  if (reel.length < 2) return;
  const at = reelIndexOf(readingPage());
  if (at === reelAt) return;
  // The one being left keeps its own spot keeps; the one being entered brings
  // its own back, and becomes the document a save adopts and the list marks.
  const was = reel[reelAt];
  if (was) was.spots = spots;
  reelAt = at;
  const now = reel[reelAt];
  fileName = now.name;
  fileHandle = now.handle;
  spots = now.spots;
  document.title = now.name + " — Text Reader";
  renderSpots();
  markDocList();
  renderReelState();
  refreshKeepLocality();
}

/** What the status bar says about a reel: which document, and how much of the folder is on. */
function renderReelState() {
  const m = reelCurrent();
  if (!m) { $("st-file").textContent = "No document"; return; }
  const pages = m.count;
  $("st-file").textContent = m.name + (TD.isQuarantinedName(m.name) ? " (quarantined by PDF-Linker's leak gate)" : "") +
    " · " + pages + " page" + (pages === 1 ? "" : "s") +
    (reel.length > 1 ? ` · ${reelAt + 1} of ${reel.length} on the reel` + reelEndNote() : "");
  updateDirty();
}

/**
 * What the reel has left, for the status bar. Asked of the FOLDER rather than
 * of the flags: a reader who has only read downward has never asked for the
 * document before this one, and the answer is the same either way.
 */
function reelEndNote() {
  if (reel.length >= reelMax() || (doc && doc.pages.length >= REEL_MAX_PAGES)) return " (as far as one reel goes)";
  const on = !!reelNextDoc(), back = !!reelPrevDoc();
  if (!on && !back) return " (the folder is read out)";
  if (!on) return " (read to the end of the folder)";
  if (!back) return " (read back to the start of the folder)";
  return "";
}

/** Every member the reading has edited, in reel order. */
function reelDirtyMembers() { return reel.filter((m) => m.dirty); }

/** The member holding a page, marked edited — the file a save has to write. */
function reelMarkDirty(pageIndex) {
  const m = pageIndex == null ? reelCurrent() : reelMemberOf(pageIndex);
  if (m) m.dirty = true;
}


// ── shedding: the reel keeps the text and lets go of the DOM ─────────────────────────
//
// A page is cheap as text and expensive as DOM — a line element per line, a
// span per pseudonym, an anchor per citation, a mark per highlight — and a reel
// of twenty documents is thousands of them held for the sake of four hundred
// pixels somebody scrolled past an hour ago. So a document far enough from the
// reading is SHED: its text goes back into `doc.pages`, its spot keeps back
// into the member, and its pages are emptied.
//
// WHAT STAYS IS THE POINT. The `.tpage` sections themselves stay, each keeping
// its index and pinned to the height it had. That is what makes this safe
// rather than clever: the pages are still one element per page, in order, at
// the right heights, so the PDF pane beside them stays page-for-page, the
// scroll position does not move by a pixel, auto-scroll's density is still
// measured off the real heights, and every index already handed out still
// finds its page. Only the contents go.
//
// And it is reversible from what was kept: `doc.pages` holds the text, the
// member holds the spot keeps, and coming back within reach builds the pages
// again exactly as `buildPages` first did.
//
// TWO ARE NEVER SHED. The document being read, and any document with unsaved
// edits — an edit is work in progress, and a page that has been typed in is
// worth the memory it costs until it is written.

// How far from the window a document has to be before it is let go of, and
// come back within before it is built again. Generous: shedding what the
// reader is about to scroll back to is work done twice.
const REEL_KEEP_SCREENS = 4;

/** The page a body belongs to, and the body a page has — or null where it is shed. */
function bodyForPage(i) {
  const sec = pagesEl.querySelector(`.tpage[data-index="${i}"]`);
  return sec ? sec.querySelector(".page-body") : null;
}

/** A member's page sections, in order, from one pass over the column. */
function memberSections(m, byIndex) {
  const out = [];
  for (let i = m.from; i < m.from + m.count; i++) {
    const sec = byIndex.get(i);
    if (sec) out.push(sec);
  }
  return out;
}

function shedMember(m, secs) {
  if (m.shed) return;
  for (const sec of secs) {
    const inner = sec.querySelector(".page-inner");
    const body = inner && inner.querySelector(".page-body");
    if (!inner || !body) continue;
    const i = Number(sec.dataset.index);
    // Off the PDF's grid first, while the lines it laid out are still there.
    clearMatched(sec);
    // Everything the page knows, taken off it before it goes: the text as the
    // FILE carries it (serializeNodes writes the fakes, never the real names),
    // and the places this document keeps in the clear.
    m.spots = m.spots.filter((x) => x.page !== i).concat(spotsFromBody(body, i));
    doc.pages[i].lines = TD.serializeNodes(body).split("\n");
    sec.style.height = sec.offsetHeight + "px"; // measured before it is emptied
    inner.innerHTML = "";
    sec.classList.add("shed");
  }
  m.shed = true;
  // An undo step names a page that has no body to put back. The reading has
  // been four screens away from this document; the history of it is over.
  undoStack = undoStack.filter((sn) => sn.page < m.from || sn.page >= m.from + m.count);
  redoStack = redoStack.filter((sn) => sn.page < m.from || sn.page >= m.from + m.count);
}

function unshedMember(m, secs) {
  if (!m.shed) return;
  for (const sec of secs) {
    const inner = sec.querySelector(".page-inner");
    if (!inner || inner.firstChild) continue;
    const i = Number(sec.dataset.index);
    const body = document.createElement("div");
    body.className = "page-body";
    body.contentEditable = editing ? "plaintext-only" : "false";
    body.spellcheck = false;
    buildBody(body, doc.pages[i].lines.join("\n"), i, m.spots);
    const layer = document.createElement("div");
    layer.className = "link-layer";
    inner.append(body, layer);
    sec.classList.remove("shed");
    sec.style.height = "";
  }
  m.shed = false;
}

/** Build a shed page back because something is about to want it (a leak row, a jump). */
function ensurePageLive(i) {
  const m = reelMemberOf(i);
  if (!m || !m.shed) return;
  const byIndex = sectionsByIndex();
  unshedMember(m, memberSections(m, byIndex));
  afterShedChange();
}

function sectionsByIndex() {
  const byIndex = new Map();
  for (const sec of pagesEl.querySelectorAll(".tpage")) byIndex.set(Number(sec.dataset.index), sec);
  return byIndex;
}

/**
 * Let go of what is far away, and build back what has come near. Cheap enough
 * to run on a scroll: it is a pass over the members, and a member that is
 * already in the state it should be in costs a comparison.
 */
function reelTrim() {
  // Two documents are worth shedding between where the documents are long:
  // two exhibit sets of two hundred pages is four hundred sections held for
  // the sake of the one being read.
  if (!doc || reel.length < 2) return;
  // A review is a walk over the whole document: nothing is let go of under it.
  // The redaction tool is one too — its check reads every pseudonym the export
  // carries, and a shed page carries none.
  if (!leaksBar.hidden || !namesBar.hidden || redactOn) return;
  const top = stageEl.scrollTop;
  const bottom = top + stageEl.clientHeight;
  const pad = Math.max(stageEl.clientHeight * REEL_KEEP_SCREENS, 1200);
  const byIndex = sectionsByIndex();
  let changed = false;
  for (let k = 0; k < reel.length; k++) {
    const m = reel[k];
    const secs = memberSections(m, byIndex);
    if (!secs.length) continue;
    const last = secs[secs.length - 1];
    const a = secs[0].offsetTop;
    const b = last.offsetTop + last.offsetHeight;
    const far = b < top - pad || a > bottom + pad;
    // The one being read, and anything typed in, stay whatever the distance.
    const held = k === reelAt || m.dirty;
    if (far && !held && !m.shed) { shedMember(m, secs); changed = true; }
    else if ((!far || held) && m.shed) { unshedMember(m, secs); changed = true; }
  }
  if (changed) afterShedChange();
}

/**
 * Pages came back, or went.
 *
 * A page built back is a page that has never been SHAPED — `shapePages` gives
 * a sheet the height its width and its paper ratio ask for, and a body without
 * one is as tall as its words happen to be. Left unshaped it comes back
 * several hundred pixels shorter than the height it was shed at, and the whole
 * column below it jumps by the difference. So the layout runs before anything
 * else here, and the height a page comes back at is the height it left at.
 */
function afterShedChange() {
  applyMatchedLayout();
  applyPageWidth(); // …which shapes the sheets, which is what makes it stable
  textAnchors = null; textLineTops = null;
  textEpoch++;
  placeCitationsSoon();
  paintHighlights();
  autoRemeasure();
  renderReelState();
}

/**
 * Every page on the reel built and live again. Two things ask for this.
 *
 * A RE-LAYOUT, because a shed page's height is a number pinned when the layout
 * was something else — the reading size changed, the window was dragged — and
 * a column of stale heights is a document that jumps under the reader. The
 * whole thing goes live and the trim re-sheds from real measurements on the
 * next pass. It is the one moment the reel costs what it would cost unshed,
 * and it happens when a setting changes, not while reading.
 *
 * And a REVIEW OPENING. The LEAKS worksheet and the names walk both jump about
 * the whole document looking for a value, and a page with no body is a page
 * they would report as not holding what it holds. While either bar is open
 * nothing is shed at all (`reelTrim`), so this is asked once, as it opens.
 */
function reelAllLive() {
  if (!reel.some((m) => m.shed)) return false;
  const byIndex = sectionsByIndex();
  for (const m of reel) if (m.shed) unshedMember(m, memberSections(m, byIndex));
  afterShedChange();
  return true;
}

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
const pdfInView = new Set(); // text pages whose PDF page an observer says is on screen
// Every page's size, by PDF name, KEPT AFTER THE PDF IS CLOSED. Two numbers a
// page: what a slot needs to stand at the right height is nothing beside what
// it costs to open the file again for them, and a page's size cannot change
// under a reader who is only reading. So a PDF read once leaves the pane its
// geometry for the session, and a slot the reading has not reached yet is the
// only one still guessing.
const pdfSizes = new Map(); // name → [{ w, h }]

function forgetPdfs() {
  cancelPdfJobs();
  dropWarmPages();
  for (const p of pdfCache.values()) p.then((info) => { try { info.pdf.destroy(); } catch { /* gone */ } }).catch(() => {});
  pdfCache.clear();
  pdfInView.clear();
  pdfSizes.clear();
  pdfBytes.clear();
  pagesToRelease.clear(); // their documents are going with them
  pageRatioKnown = false; // another folder, another paper
  pdfPicked = null;
  pickedPdfs = new Map();
  pickedByMember = new Map();
}

// ── closing the PDFs the review has walked past ────────────────────────────────
//
// An opened PDF is not small: its bytes, its pages as pdf.js holds them, and
// the line grid read off every one of them. That was fine while a case was a
// document or two — they were opened once and kept for as long as the folder
// was. A leak review walks a folder of three hundred exports, each with its
// own PDF behind it, and every hop opened another and closed none: the tab
// took the whole folder into memory a document at a time until it went down.
//
// So a PDF nothing points at any more is destroyed. What points at one: a
// page ON SCREEN (its bitmap is drawn from it), the pages the READING has
// reached either side of that, a page swapped into the text, the window of
// pages held ready for the worksheet, and a PDF carrying redaction boxes.
// Past those, the few most recently opened are kept — stepping back to the
// document just answered should not read it again — and the rest go.
//
// WHAT THE READING HAS REACHED, not what the document names. The reel hangs
// twenty exports off one document and a Combined Text.txt of a big case
// folder names three hundred; every page of every one of them named its own
// PDF here, so every PDF the reader ever scrolled past was pinned open and
// the trim had nothing to close. The window is what is near instead
// (pdfsync.pdfsNear): the page the reading line sits on, out to PDF_REACH
// pages either side, and PDF_NEAR documents at the most. A PDF picked by
// hand is not pinned either — the File it was picked from is still held, so
// closing it costs a re-read and nothing else.
// …AND WITHIN A BUDGET OF BYTES, which is the ceiling that actually binds.
// Four documents is nothing in a folder of pleadings and it is the tab in a
// folder of scanned exhibits: forty megabytes a file, held as bytes, as the
// worker's parse of them, and as the decoded image of every page that has
// been drawn. Counting documents cannot tell those folders apart. So the
// window is taken in order — what is on screen, then what the review is
// about to want, then what the reading is near — and stops at PDF_BYTES,
// with the first always let in, since a document cannot be read without it.
const PDF_HELD = 3;    // PDFs kept open past the ones in use
const PDF_REACH = 40;  // pages either side of the reading whose PDFs are in use
const PDF_NEAR = 4;    // …and the most documents that may come to
const PDF_BYTES = 48 * 1024 * 1024; // …and the most they may weigh between them
const pdfBytes = new Map(); // name → the file's size, kept after it is closed
/** What a PDF weighs: what it weighed when it was opened, else the heaviest so far. */
function pdfSize(name) {
  if (pdfBytes.has(name)) return pdfBytes.get(name);
  let most = 0;
  for (const n of pdfBytes.values()) if (n > most) most = n;
  return most; // a folder of scans is scans throughout; 0 while none is known
}
function pdfsInUse() {
  // Never let go of: a page an observer says is on screen (it is being drawn
  // from), a page swapped into the text, and a PDF carrying redaction boxes —
  // the copy is written from the pages themselves, and the review walking
  // past it is not a decision to drop them.
  const must = new Set();
  for (const i of pdfInView) { const s = pdfSources[i]; if (s) must.add(s.name); }
  const nameOf = (k) => k.slice(0, k.lastIndexOf("|"));
  for (const k of swaps) must.add(nameOf(k));
  for (const [name, store] of redactStores) if (store.count().boxes) must.add(name);
  // Then, in this order and while the budget lasts: the worksheet's next
  // pages, and the documents the reading has reached either side of it.
  const then = [];
  const want = (n) => { if (n && !must.has(n) && !then.includes(n)) then.push(n); };
  for (const k of warmWanted) want(nameOf(k));
  for (const n of PS.pdfsNear(pdfSources, readingPage(), PDF_REACH, PDF_NEAR)) want(n);
  const keep = new Set(must);
  let bytes = 0;
  for (const n of must) bytes += pdfSize(n);
  for (const n of then) {
    const size = pdfSize(n);
    if (keep.size && bytes + size > PDF_BYTES) break;
    keep.add(n);
    bytes += size;
  }
  return keep;
}
function trimPdfs() {
  const keep = pdfsInUse();
  const shown = new Set();
  for (const i of pdfInView) { const s = pdfSources[i]; if (s) shown.add(s.name); }
  let bytes = 0;
  for (const n of keep) bytes += pdfSize(n);
  // Insertion order is least-recently-used first: loadPdf moves a PDF it is
  // handed back to the end. The few kept past the window are kept from the
  // recent end and only while the budget holds — on a folder of scans it
  // holds none, and stepping back re-reads the file rather than the tab
  // carrying three more of them for the chance.
  const spare = [...pdfCache.keys()].filter((n) => !keep.has(n));
  const held = new Set();
  for (let i = spare.length - 1; i >= 0 && held.size < PDF_HELD; i--) {
    const size = pdfSize(spare[i]);
    if (bytes + size > PDF_BYTES) break;
    held.add(spare[i]);
    bytes += size;
  }
  for (const name of spare) {
    if (held.has(name)) continue;
    const p = pdfCache.get(name);
    pdfCache.delete(name);
    if (p) p.then((info) => { try { info.pdf.destroy(); } catch { /* gone */ } }).catch(() => {});
  }
  // …and the ones that stay, but with nothing of theirs on screen, are told
  // to put down what they were holding for the pages that WERE: the operator
  // lists, the fonts and the decoded images. The document stays open, so
  // coming back to it is a re-render and not a re-read; pdf.js refuses while
  // a page of it is still drawing, which is the answer we want.
  for (const [name, p] of pdfCache) {
    if (shown.has(name)) continue;
    // It ANSWERS by refusing — a rejected promise naming the page still
    // drawing — so the refusal is swallowed here and the next pass asks
    // again, rather than reaching the window's error handler as a fault.
    p.then((info) => info.pdf.cleanup()).catch(() => {});
  }
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
  if (held) {
    pdfCache.delete(src.name);   // asked for again: it goes to the end of the
    pdfCache.set(src.name, held); // queue trimPdfs closes from the front of
    if (now) bumpPdfJobs(src.name);
    return held;
  }
  let settle = null;
  const p = new Promise((res, rej) => { settle = { res, rej }; });
  pdfCache.set(src.name, p);
  p.then((info) => {
    p.__info = info;
    // Closed while it was still opening (trimPdfs): nothing is holding it, so
    // it is destroyed here rather than left open with no way back to it.
    if (pdfCache.get(src.name) !== p) { try { info.pdf.destroy(); } catch { /* gone */ } }
  }).catch(() => { if (pdfCache.get(src.name) === p) pdfCache.delete(src.name); });
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
  return duringAsync("opening a PDF", () => openPdfNow(src));
}
async function openPdfNow(src) {
  const file = src.file || await src.handle.getFile();
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  // Every page's size, which the pane needs before it can lay a slot out. The
  // pages come back from a document already parsed, so an `await` per page is
  // no yield at all — five hundred of them is one task of a second or more —
  // and the clock is looked at as it goes.
  const sizes = [];
  let clock = null;
  for (let i = 1; i <= pdf.numPages; i++) {
    if (!clock || clock.timeRemaining() < SLICE_LEFT) clock = await idleClock();
    const v = (await pdf.getPage(i)).getViewport({ scale: 1 });
    sizes.push({ w: v.width, h: v.height });
  }
  const info = { pdf, count: pdf.numPages, sizes, name: src.name, lines: sizes.map(() => null), geoms: sizes.map(() => null), rows: sizes.map(() => null) };
  pdfSizes.set(src.name, sizes); // kept after this PDF is closed: a slot's height, without the file
  pdfBytes.set(src.name, file.size || 0);
  noteRatio(sizes);
  sizeSlotsFor(src.name);
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
  return duringAsync("reading the PDF's line grid", () => readPdfGridNow(info));
}
async function readPdfGridNow(info) {
  const { pdf, sizes } = info;
  const gridFrom = performance.now();
  for (let i = 1; i <= pdf.numPages; i++) {
    // Closed behind the review (trimPdfs): there is nothing left to align to.
    const held = pdfCache.get(info.name);
    if (!held || (held.__info && held.__info !== info)) return;
    try {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      // Read and handed straight back. The grid reads EVERY page of the PDF,
      // and reading one leaves the worker holding what it parsed to answer —
      // on a three-hundred-page exhibit set, the whole document, for the sake
      // of where each page's first line sits. A page being DRAWN is left
      // alone: it is holding a bitmap somebody is looking at.
      if (!pageIsDrawn(page)) { try { page.cleanup(); } catch { /* it is drawing */ } }
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
  notePass("reading the PDF's line grid", gridFrom);
  if (sbsOn && !pdfPane.hidden) applyMatchedLayoutSoon();
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
  const names = docPageSources();
  // A combined file's members, in the order its header lists them: each
  // is matched to a PDF on its own — the folder's, then one picked by hand
  // (by name through the key, else by order) — never to one PDF for all.
  const members = docMembers();
  const memo = new Map();
  pdfSources = names.map((n) => {
    if (!memo.has(n)) {
      const hit = pdfForName(n);
      let src = hit ? folderPdfs.find((p) => p.name === hit) : null;
      if (!src && pickedPdfs.size) { const p = PS.matchPdf(n, [...pickedPdfs.keys()], fwdName()); if (p) src = pickedPdfs.get(p); }
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
  const names = docPageSources();
  const out = [];
  for (const m of docMembers()) {
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
  // The slots and the inline pages are both about to be made again, so what
  // was on screen is named by pages that are going: the observers fill this
  // back in as the new ones land.
  pdfInView.clear();
  trimPdfs(); // the document changed: the last one's PDFs are nobody's now
  const any = pdfSources.some(Boolean);
  sbsBtn.disabled = !doc;
  swapBtn.disabled = !doc;
  // Nothing to redact without a PDF matched to the export.
  redactBtn.disabled = !doc || !any;
  if (redactBtn.disabled && redactOn) setRedactMode(false);
  else if (redactOn) updateRedactBar();
  refreshSwapButtons();
  applySwaps();
  buildPdfPane();
  updatePdfStatus();
  if (!any && !doc) hideSwapPop();
}
function updatePdfStatus() {
  const names = pdfSourceNames();
  const n = [...swaps].filter((k) => pdfSources.some((s, i) => s && pdfTarget(i) && pdfTarget(i).key === k)).length;
  const members = docMembers();
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

// ── the pages a leak stands on, drawn before the row is reached ──────────────────
//
// Answering LEAKS.xlsx is a walk from page to page, and every one of those
// pages is named in the rows before the operator reaches any of them. So the
// reader goes and gets them. With a worksheet attached, the rows are read in
// the order the review will reach them (leaks.leakPages: the row in front,
// the rows still to answer after it, then the rest), each row's PDF is opened, and
// its own page is drawn into a bitmap held ready. A slot coming into view
// paints that bitmap at once — the page is THERE, where a "Loading…" box used
// to stand — and pdf.js, which by then holds the page, its fonts and its
// operator list, draws the sharp one over it a moment later.
//
// Bounded on purpose. A page held ready is a bitmap, so only a window of them
// is kept (WARM_PAGES), the window moving with the review: whatever falls
// outside it is closed. They are drawn at one screen's width and at one
// device pixel per css pixel, since the warmed page stands in for a moment
// rather than being the page anybody reads. And the drawing goes through the
// same queue as everything else (pdfJobs) and at the BACK of it, so whatever
// is actually in front of the reader is still served first.
const WARM_PAGES = 12;   // pages held ready at once
const WARM_WIDTH = 900;  // css px a held page is drawn at, at most
const warmPages = new Map();  // "<pdf name>|<page>" → ImageBitmap
const warmWanted = new Set(); // the keys the window holds, as it stands
const warmBusy = new Set();   // …and those being drawn for it now

function warmKey(name, page) { return name + "|" + page; }
function dropWarmPages() {
  // Nothing is wanted, so whatever is being drawn drops what it has when it
  // lands (warmPage checks the window at every step).
  warmWanted.clear();
  for (const bmp of warmPages.values()) { try { bmp.close(); } catch { /* gone */ } }
  warmPages.clear();
}
/** The width the held pages are drawn at: the box they will be shown in, within reason. */
function warmWidth() {
  const sec = pagesEl.querySelector(".tpage");
  const w = sbsOn && !pdfPane.hidden ? paneWidth() : sec ? inlineWidth(sec) : 0;
  return Math.max(400, Math.min(WARM_WIDTH, Math.round(w) || WARM_WIDTH));
}
/** Draw a held page into a slot as it stands, until its own render lands. */
function paintWarm(el, bmp, cssWidth) {
  if (!bmp || !cssWidth || el.dataset.rendered) return false;
  const sheet = sheetOf(el);
  const canvas = sheet.querySelector("canvas");
  if (!canvas) return false;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.round(cssWidth * dpr);
  const h = Math.round((w * bmp.height) / bmp.width);
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = cssWidth + "px";
  canvas.style.height = Math.round(h / dpr) + "px";
  sheet.style.height = "";
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  el.dataset.preview = "1";
  el.classList.add("ready");
  return true;
}
/** A slot already waiting on the page just warmed takes it now. */
function paintWarmInto(key) {
  for (const el of document.querySelectorAll("[data-warm]")) {
    if (el.dataset.warm === key && !el.dataset.rendered) paintWarm(el, warmPages.get(key), el.__warmWidth);
  }
}

// ── the documents the reader is willing to hold ─────────────────────────────────
//
// A worksheet's rows are spread over the folder's exports, and the walk takes
// them a document at a time (leaks.js). What the reader holds follows that
// walk: the document in front, and — once every row standing in it is
// answered — the next one, read and built while the operator is still looking
// at the last of this one.
//
// In a SMALL folder it keeps working further ahead, as it always has: a case
// of a dozen exports can hold every document with a leak in it, and holding
// them is what makes stepping between them instant. It is the big folder —
// hundreds of text files, each with a PDF behind it — that cannot be held at
// once and must not be asked for at once.
const BIG_FOLDER = 24; // exports past which the review goes one document at a time
function oneDocAtATime() { return folderDocs.length > BIG_FOLDER; }
/**
 * The documents the worksheet's pages may be fetched from, in visit order —
 * the document in front alone until its rows are answered, then it and the
 * next. `null` where there is nothing to hold back: a small folder holds
 * whatever fits, as it always has.
 */
function leakFileWindow() {
  if (!oneDocAtATime()) return null;
  const rows = leakRows();
  const files = LK.leakFileOrder(rows, leaks ? leaks.at : 0);
  if (!files.length) return null;
  return files.slice(0, LK.fileDone(rows, files[0]) ? 2 : 1);
}

/**
 * The PDF pages the worksheet points at, in the order the review will reach
 * them: [{ src, page }], at most `limit`, and none from a document outside
 * the window. A row's File cell holds the real name, which is the case
 * folder's own name for the PDF; a row naming no file — or one whose PDF the
 * folder does not hold — is taken as the open document's, where its page
 * belongs to it.
 */
function leakWarmTargets(limit) {
  const members = docPageSources();
  // The open document's own members, indexed the same way: which of them a
  // row's File cell names, worked out once per name rather than per page.
  const memberFor = LK.exportMatcher(members, fwdName());
  const out = [], seen = new Set();
  for (const t of LK.leakPages(leakRows(), leaks ? leaks.at : 0, leakFileWindow())) {
    if (t.page == null) continue;
    let src = null, page = t.page;
    const hit = t.file ? pdfForName(t.file) : null;
    if (hit) src = folderPdfs.find((p) => p.name === hit);
    else if (doc) {
      for (let i = 0; i < doc.pages.length; i++) {
        if (PS.pdfPageOf(doc.pages[i]) !== page) continue;
        if (t.file && members[i] !== t.file && memberFor(t.file) !== members[i]) continue;
        const tgt = pdfTarget(i);
        if (tgt) { src = tgt.src; page = tgt.page; break; }
      }
    }
    if (!src) continue;
    const k = warmKey(src.name, page);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ src, page });
    if (out.length >= limit) break;
  }
  return out;
}

/** Hold the worksheet's next pages ready — and close the ones the review has left behind. */
function planWarmPages() {
  // Nothing to hold where no review is running, or where the PDF side is put
  // away: a page nobody is going to be shown is a bitmap for nothing — and
  // the PDF it would be drawn from is a file to read and a grid to measure.
  if (plain || !leaks || leaksBar.hidden || !doc || (!(sbsOn && !pdfPane.hidden) && !swaps.size)) { dropWarmPages(); return; }
  const cssWidth = warmWidth();
  const targets = leakWarmTargets(WARM_PAGES);
  warmWanted.clear();
  for (const t of targets) warmWanted.add(warmKey(t.src.name, t.page));
  for (const [k, bmp] of [...warmPages]) {
    if (warmWanted.has(k)) continue;
    try { bmp.close(); } catch { /* gone */ }
    warmPages.delete(k);
  }
  for (const t of targets) {
    const key = warmKey(t.src.name, t.page);
    // Held already, or being drawn: a window that moves by one row leaves the
    // work it has already asked for alone.
    if (warmPages.has(key) || warmBusy.has(key)) continue;
    warmBusy.add(key);
    // The open is asked for HERE and so is queued ahead of the drawing, which
    // then never waits on the queue from inside a job the queue is running.
    const opened = loadPdf(t.src);
    pdfJobs.push({ name: t.src.name, run: () => warmPage(opened, key, t.page, cssWidth) });
  }
  pumpPdfJobs();
}
async function warmPage(opened, key, pageNo, cssWidth) {
  try {
    if (!warmWanted.has(key) || warmPages.has(key)) return;
    let info;
    try { info = await opened; } catch { return; } // whoever shows the page reports it
    if (!warmWanted.has(key) || pageNo > info.count) return;
    const page = await info.pdf.getPage(pageNo);
    if (!warmWanted.has(key)) return;
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: cssWidth / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    let bmp = null;
    try {
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      if (warmWanted.has(key)) bmp = await createImageBitmap(canvas);
    } catch (e) { if (!(e && e.name === "RenderingCancelledException")) console.warn(e); }
    canvas.width = canvas.height = 0; // the bitmap is the copy that is kept
    if (!bmp) return;
    if (!warmWanted.has(key)) { try { bmp.close(); } catch { /* gone */ } return; }
    warmPages.set(key, bmp);
    paintWarmInto(key);
  } finally { warmBusy.delete(key); }
}

// ── the documents the review will visit, built before it reaches them ───────────
//
// A case folder's leaks are spread over its exports, and the review walks from
// one to the next: a row names its own document, and stepping to that row
// opens it. Opening is the expensive part — and nearly all of that is BUILDING
// the page. Reading the file and parsing it into pages cost a millisecond
// between them; laying forty pages of pleading paper out as DOM costs a
// quarter of a second, and a long export the best part of a second.
//
// So the documents the worksheet names are built BEFORE the review reaches
// them, off the page: read, parsed, and their pages built into a fragment
// that is nowhere in the document yet — no layout, no paint, nothing on
// screen. Opening one is then putting that fragment on the page, which costs
// the settle (the counts, the layout, the highlights) and nothing else.
//
// Gradually, on purpose, and within a budget. Never the whole folder at once:
// the documents are taken in the order the review will reach them, one at a
// time, in idle time, each in slices of pages, so the building never stands
// between the reader and the page. How many are held is what FITS — up to
// READY_DOCS of them and READY_PAGES between them, which on a case of
// ordinary exports is every document with a leak in it and on a case of long
// ones is the next two or three. A document of more than READY_MAX_PAGES is
// never held: the combined file is that document, and holding it is what
// takes the tab down. What no longer fits is dropped, furthest from the row
// in front first.
const READY_DOCS = 6;         // documents held built at once
const READY_PAGES = 400;      // …and the pages between them
const READY_MAX_PAGES = 200;  // …and the most any one of them may have
const READY_SLICE = 1;        // pages built before the clock is looked at again
// Building ahead is a trade of work now against waiting later, and it must
// never be paid for out of the operator's own thread. Two rules keep it
// honest: nothing is read while they are still working (READY_QUIET after the
// last thing they did — a review that answers a row a second would otherwise
// start a long document, throw it away as the window moved, and start
// another, forever), and what is built is built against the browser's idle
// clock rather than in slices of a fixed size, since a page of a long export
// under a big key is ten milliseconds and eight of them is a task that shows.
const READY_QUIET = 1200;     // ms of quiet before the next document is read
const ready = new Map();      // export name → { name, handle, fileKey, doc, nodes, epoch, spots } | { name, skipped }
let readyWanted = [];         // the window, in the order the review will reach it
let readyBusy = false;
let readyEpoch = 0;           // bumped whenever a built page would no longer be right
let readyTimer = 0;           // the wait for quiet
let busyAt = 0;               // when the operator last did something

/** Built pages are translated under the key as it stood: a change makes them wrong. */
function dropReady() {
  readyWanted = [];
  ready.clear();
  renderDocReady();
}
function staleReady() { readyEpoch++; dropReady(); warmForLeaks(); }
/** A new document (or a new key) may be nothing like the one that was too slow. */
function marksGetAnotherChance() { marksOff = false; }
function fileKeyOf(file) { return file.name + "|" + file.size + "|" + file.lastModified; }

/**
 * The exports the worksheet points at, in visit order, that are not already
 * open — and, in a big folder, only the one the walk will reach next, once
 * the document in front has been answered (leakFileWindow).
 */
function leakDocNames() {
  if (!leaks || !folderDocs.length) return [];
  // A combined file already open holds every member: there is no hop to make.
  const open = [fileName, ...docMembers()].filter(Boolean);
  const openFor = LK.exportMatcher(open, fwdName());
  const out = [];
  for (const t of LK.leakPages(leakRows(), leaks.at, leakFileWindow())) {
    if (!t.file || openFor(t.file)) continue;
    const e = exportForName(t.file);
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

/** The pages held between them — the budget the window is kept inside. */
function heldPages() {
  let n = 0;
  for (const e of ready.values()) n += e.pages || 0;
  return n;
}
/** Hold the documents ahead of the row in front — and let go of what no longer fits. */
function planReadyDocs() {
  // Only while a review is actually running. Reading ahead is worth its cost
  // when the operator is stepping from row to row and the next document is a
  // keystroke away; with the bar closed there is no next document, and a
  // reader that opens a file and immediately goes off to read ANOTHER one —
  // parsing it, building it, opening its PDF — is a page that stops answering
  // for no reason the operator can see.
  if (plain || !leaks || leaksBar.hidden || !folderDocs.length) { dropReady(); return; }
  readyWanted = leakDocNames().slice(0, READY_DOCS);
  // In visit order, keep what fits; the rest go — the furthest from the row in
  // front being the ones the review will want last.
  let pages = 0;
  const keep = new Set();
  for (const name of readyWanted) {
    const e = ready.get(name);
    const cost = e ? e.pages || 0 : 0;
    if (e && pages + cost > READY_PAGES && keep.size) break;
    keep.add(name);
    pages += cost;
  }
  for (const name of [...ready.keys()]) if (!keep.has(name)) ready.delete(name);
  renderDocReady();
  pumpReady();
}
function pumpReady() {
  clearTimeout(readyTimer);
  if (readyBusy) return;
  if (heldPages() >= READY_PAGES) return; // full: the rest wait for the window to move
  const next = readyWanted.find((n) => !ready.has(n));
  const d = next ? folderDocs.find((x) => x.name === next) : null;
  if (!d) return;
  // Not while the operator is working: the next document waits for a gap.
  const quiet = Date.now() - busyAt;
  if (quiet < READY_QUIET) { readyTimer = setTimeout(pumpReady, READY_QUIET - quiet); return; }
  readyBusy = true;
  buildAhead(d).catch(() => { ready.set(d.name, { name: d.name, skipped: "unreadable" }); })
    .then(() => { readyBusy = false; renderDocReady(); pumpReady(); });
}
/** One document read, parsed and built off the page, a slice at a time. */
async function buildAhead(d) {
  return duringAsync("reading the next document ahead", () => buildAheadNow(d));
}
async function buildAheadNow(d) {
  const epoch = readyEpoch;
  const file = await d.handle.getFile();
  const text = await file.text();
  if (epoch !== readyEpoch || !readyWanted.includes(d.name)) return;
  const parsed = during("reading the next document ahead", () => TD.parseExport(text));
  if (parsed.pages.length > READY_MAX_PAGES) { ready.set(d.name, { name: d.name, skipped: `${parsed.pages.length} pages — too long to hold ready` }); return; }
  const theirSpots = TD.normalizeSpots(lsGet(SPOTS_PREFIX + (folderName || "") + "/" + d.name, []));
  const nodes = document.createDocumentFragment();
  let clock = null;
  for (let at = 0; at < parsed.pages.length; at += READY_SLICE) {
    if (!clock || clock.timeRemaining() < SLICE_LEFT) {
      clock = await idleClock();
      // The key changed, or the review moved on: what is built so far is dropped.
      if (epoch !== readyEpoch || !readyWanted.includes(d.name)) return;
      // The operator back at the keyboard stops it where it stands — and it
      // picks up there in the next gap rather than starting the document
      // again, which on a long one is work that never finishes.
      while (Date.now() - busyAt < READY_QUIET) {
        await new Promise((res) => setTimeout(res, READY_QUIET - (Date.now() - busyAt)));
        if (epoch !== readyEpoch || !readyWanted.includes(d.name)) return;
      }
    }
    duringSlice("reading the next document ahead", () =>
      buildPages(nodes, parsed.pages, { from: at, to: Math.min(at + READY_SLICE, parsed.pages.length), spots: theirSpots }));
  }
  ready.set(d.name, {
    name: d.name, handle: d.handle, fileKey: fileKeyOf(file), doc: parsed, nodes, epoch,
    spots: theirSpots, pages: parsed.pages.length,
    // What its spans were built under: a keep decided since, or the fake/real
    // toggle flipped since, is put right as the document goes up.
    fakes: settings.showFakes, keeps: keepsSignature(),
  });
}
/** The document built for this file, or null — the same file, under the same key. */
function readyFor(file) {
  const e = file ? ready.get(file.name) : null;
  if (!e || !e.nodes) return null;
  if (e.epoch !== readyEpoch || e.fileKey !== fileKeyOf(file)) {
    // Written since it was built (another PDF-Linker run, a save): what is
    // held is of the old file, so it goes and the window builds the new one.
    ready.delete(e.name);
    return null;
  }
  return e;
}
/** Which documents in the list are held ready, and how many. */
function renderDocReady() {
  const held = [...ready.values()].filter((e) => e.nodes);
  for (const li of docsList.children) {
    const e = ready.get(li.dataset.name);
    li.classList.toggle("ready", !!(e && e.nodes));
    li.title = li.dataset.name + (e && e.nodes ? " — built and waiting" : e && e.skipped ? " — not held (" + e.skipped + ")" : "");
  }
  const base = folderDocs.length ? folderName + " · " + folderDocs.length + " document" + (folderDocs.length === 1 ? "" : "s") : "Open a case folder to list its exports here.";
  const want = readyWanted.length;
  const note = !leaks ? ""
    : want ? ` · ${held.length} of ${want} with leaks ready to open` + (readyBusy ? ", building…" : "")
    : oneDocAtATime() ? " · leaks one document at a time: the next is read once this one is answered"
    : "";
  docsHint.textContent = base + note;
}

/** The worksheet's next pages and documents, held ready. Coalesced: the review moves in steps. */
const planForLeaks = debounce(() => {
  planWarmPages();
  planReadyDocs();
  trimPdfs(); // …and the PDFs the window has moved off are closed behind it
}, 200);
/** Something the operator did: the window follows it, and the quiet clock starts again. */
function warmForLeaks() {
  busyAt = Date.now();
  planForLeaks();
}

// ── rendering a page into a canvas ──
async function renderInto(el, src, pageNo, cssWidth) {
  const want = src.name + "|" + pageNo + "|" + cssWidth + "|" + (window.devicePixelRatio || 1);
  if (el.dataset.rendered === want) return;
  el.dataset.want = want;
  // A page warmed for the LEAKS worksheet is already drawn: it goes up now,
  // in place of the "Loading…" box, and the sharp one is drawn over it below.
  el.dataset.warm = warmKey(src.name, pageNo);
  el.__warmWidth = cssWidth;
  paintWarm(el, warmPages.get(el.dataset.warm), cssWidth);
  let info;
  try { info = await loadPdf(src, { now: true }); }
  catch (e) {
    if (e && e.cancelled) return; // the document being read changed under it
    el.querySelector(".pdf-wait").textContent = "Could not open " + src.name + ": " + (e.message || e);
    return;
  }
  if (el.dataset.want !== want) return;
  if (pageNo > info.count) { el.querySelector(".pdf-wait").textContent = `The PDF has ${info.count} page${info.count === 1 ? "" : "s"}; there is no page ${pageNo}.`; return; }
  // trimPdfs never closes a PDF this document is drawn from; a page asked for
  // as one is closed anyway (a pick withdrawn, the folder changed) is dropped.
  let page;
  try { page = await info.pdf.getPage(pageNo); } catch { return; }
  if (el.dataset.want !== want) return;
  el.__page = page; // …so the page can be let go of when the slot is released
  const base = page.getViewport({ scale: 1 });
  const cssScale = cssWidth / base.width;
  // What a redaction box is drawn through, and the page's own box it is held
  // inside: kept on the slot because the boxes are in the PDF's points and
  // the pane re-renders at a new width whenever the panes are resized.
  el.__view = page.view;
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
  delete el.dataset.preview;
  el.classList.add("ready");
  noteDrawn(el);
  // The page is up: its boxes go back on it at the width it was drawn at.
  // Before the text layer, which may yet fail — a page with no text layer can
  // still carry an area box over a signature.
  el.__vp = page.getViewport({ scale: cssScale });
  paintRedactions(el);
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
    // One drag, one tool. While the redaction tool is on, a drag over a PDF
    // page belongs to it and nothing selects under it — in EITHER mode, and
    // this is the whole of a bug worth remembering. The reader's selection
    // snaps to the nearest character ON ITS ROW, which is right for reading
    // and wrong for marking: dragged over a signature, a stamp, or any part of
    // a page with no text in it, it would snap to the nearest words instead —
    // so the drag that was meant to black out a signature blacked out a line
    // of text somewhere above it, and said it had worked.
    if (redactOn && layer.closest("#pdf-pane")) return;
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
// HOW MANY PAGES MAY BE DRAWN AT ONCE. A page of a scanned exhibit decodes to
// fifteen megabytes — the image at the resolution it was scanned, not the size
// it is drawn at — and it is held for as long as the bitmap is. The window
// beyond the viewport (PDF_MARGIN) usually keeps three or four, which is what
// makes scrolling smooth; reading fast down a long document leaves more than
// that behind, since the pages come into view faster than the observer lets
// them go. So the drawn pages are counted, oldest first, and the oldest ones
// nothing is looking at are given back until the count holds again.
const DRAWN_MAX = 6;
const drawnSlots = new Set(); // the slots holding a bitmap, oldest drawn first
/** The text page a slot belongs to — the pane's own index, or its section's. */
function slotIndex(el) {
  if (el.classList.contains("pdf-slot")) return Number(el.dataset.index);
  const sec = el.closest && el.closest(".tpage");
  return sec ? Number(sec.dataset.index) : -1;
}
/** A page went up: the ones drawn longest ago and out of sight come down. */
function noteDrawn(el) {
  drawnSlots.delete(el);
  drawnSlots.add(el);
  if (drawnSlots.size <= DRAWN_MAX) return;
  for (const old of drawnSlots) {
    if (drawnSlots.size <= DRAWN_MAX) break;
    if (old === el) continue;
    if (!old.isConnected) { drawnSlots.delete(old); continue; }
    // Never one on screen: a viewport showing more pages than the cap keeps
    // every one of them, and the cap simply does not bite. Never one being
    // drawn again either — emptying its canvas under the drawing would leave
    // a page that reports itself drawn and shows nothing.
    if (old.__task || pdfInView.has(slotIndex(old))) continue;
    releaseCanvas(old);
  }
}

/** Whether a page is holding a bitmap on screen, and so is not ours to clear. */
function pageIsDrawn(page) {
  for (const el of drawnSlots) if (el.__page === page) return true;
  return false;
}

const pagesToRelease = new Set(); // pages that refused, to be asked again
/**
 * A page drawn and scrolled past, given back to pdf.js.
 *
 * Dropping the bitmap is not the end of what a page costs. pdf.js holds the
 * page's operator list and its DECODED IMAGES — and a scanned exhibit's page
 * decodes to fifteen megabytes whatever the canvas it was drawn into — until
 * it is told the page is done with. `page.cleanup()` is that telling; it
 * answers false and keeps everything where a render is still running, so the
 * page being drawn right now is never pulled out from under it.
 */
function releasePage(el) {
  const page = el.__page;
  el.__page = null;
  if (!page) return;
  // It refuses while the page is still drawing — a render cancelled a moment
  // ago is still winding up — and refusing is an answer, not a failure. So a
  // page that will not go now is asked again when the scrolling settles.
  let done = false;
  try { done = page.cleanup(); } catch { done = true; /* the document is gone */ }
  if (!done) { pagesToRelease.add(page); releasePagesSoon(); }
}
/** The pages that would not go when they were let go of, asked again. */
function sweepPagesToRelease() {
  for (const page of [...pagesToRelease]) {
    let done = false;
    try { done = page.cleanup(); } catch { done = true; }
    if (done) pagesToRelease.delete(page);
  }
  if (pagesToRelease.size) releasePagesSoon();
}
/** Every page a slot is holding in this box, before the box is thrown away. */
function releasePagesIn(box) {
  if (!box) return;
  for (const el of box.querySelectorAll(".pdf-slot, .pdf-inline")) releasePage(el);
}
function releaseCanvas(el) {
  if (!el.dataset.rendered && !el.dataset.preview) { releasePage(el); return; }
  const sheet = sheetOf(el);
  const canvas = sheet.querySelector("canvas");
  // Keep the box its size, drop the bitmap and the text.
  sheet.style.height = canvas.style.height;
  canvas.width = canvas.height = 0;
  canvas.style.height = "0px";
  const layer = sheet.querySelector(".textLayer");
  if (el.__text) { try { el.__text.cancel(); } catch { /* done */ } el.__text = null; }
  if (layer) layer.innerHTML = "";
  // The boxes are drawn from the store every time the page is; what is on
  // screen now belongs to a bitmap that is going.
  const red = sheet.querySelector(".redactLayer");
  if (red) red.innerHTML = "";
  el.__vp = null;
  delete el.dataset.rendered;
  delete el.dataset.preview;
  delete el.dataset.warm;
  el.classList.remove("ready");
  drawnSlots.delete(el);
  releasePage(el);
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
  // Over the text layer, so a box is never hidden by a selection and can
  // always be clicked back off.
  const red = document.createElement("div");
  red.className = "redactLayer";
  const w = document.createElement("div");
  w.className = "pdf-wait";
  w.textContent = "Loading…";
  sheet.append(c, layer, red, w);
  el.appendChild(sheet);
  return el;
}
/**
 * The body type size of the PDF a page comes from, held on the info object.
 *
 * One scale for every page of a document: a page's OWN median is the wrong
 * reading on any page that is not mostly body text — an exhibit's title page
 * says "EXHIBIT A" and nothing else — and it also drew two pages of the same
 * filing at two sizes wherever their type happened to differ. The grid reads
 * a PDF page by page, so the answer is kept against how many pages have been
 * read and taken again as more land.
 */
function docTypeSize(info) {
  if (!info || !info.rows) return null;
  let filled = 0;
  for (const r of info.rows) if (r) filled++;
  if (info.__baseAt !== filled) {
    info.__baseAt = filled;
    info.__base = PS.docTypeSize(info.rows);
  }
  return info.__base;
}

/**
 * The shape a slot stands at before anything is known about its own page:
 * the last page this folder's PDFs actually had, else letter. A case folder's
 * filings are printed on one paper, so the guess is usually right — and the
 * pane no longer opens every PDF to find out (buildPdfPane), so the guess is
 * what a document the reading has not reached yet is laid out at.
 */
let pageRatioGuess = 11 / 8.5;
let pageRatioKnown = false;
function noteRatio(sizes) {
  const sz = sizes && sizes[0];
  if (!sz || !(sz.w > 0) || !(sz.h > 0)) return;
  const was = pageRatioGuess;
  pageRatioGuess = sz.h / sz.w;
  // The FIRST PDF read says what this folder's paper is, and the slots
  // standing at the wrong guess are restood on it — once, while the pane is
  // still being laid out. Never again: a slot the reader has scrolled past is
  // holding the column up under them, and restanding it moves the reading.
  if (pageRatioKnown) return;
  pageRatioKnown = true;
  if (Math.abs(was - pageRatioGuess) < 0.01) return;
  let any = false;
  for (const el of pdfPane.querySelectorAll(".pdf-slot:not(.blank)")) {
    const src = pdfSources[Number(el.dataset.index)];
    if (!src || pdfSizes.has(src.name) || el.dataset.rendered) continue;
    sheetOf(el).style.height = Math.round((parseFloat(el.style.width) || paneWidth()) * pageRatioGuess) + "px";
    any = true;
  }
  if (any) applyMatchedLayoutSoon();
}
/** The height a page box should have before its bitmap arrives, from sizes already in hand. */
function sizeFromKnown(el, src, pageNo, cssWidth) {
  const sizes = pdfSizes.get(src.name);
  const sz = sizes && sizes[pageNo - 1];
  if (!sz || el.dataset.rendered) return !!sz;
  sheetOf(el).style.height = Math.round((cssWidth * sz.h) / sz.w) + "px";
  return true;
}
/**
 * Every slot in the pane drawn from this PDF, at the height its page really
 * has. Asked once, as the PDF's sizes land: the pane no longer asks slot by
 * slot, so the slots that were standing at the letter default when it opened
 * are given their heights here.
 */
function sizeSlotsFor(name) {
  if (!pdfSizes.has(name)) return;
  let any = false;
  for (const el of pdfPane.querySelectorAll(".pdf-slot:not(.blank)")) {
    const src = pdfSources[Number(el.dataset.index)];
    if (!src || src.name !== name) continue;
    if (sizeFromKnown(el, src, Number(el.dataset.page), parseFloat(el.style.width) || paneWidth())) any = true;
  }
  if (any) applyMatchedLayoutSoon();
}
/** …and the same for one box, opening the PDF where its sizes are not in hand. */
async function presize(el, src, pageNo, cssWidth) {
  if (sizeFromKnown(el, src, pageNo, cssWidth)) { if (el.classList.contains("pdf-slot")) applyMatchedLayoutSoon(); return; }
  try {
    const info = await loadPdf(src);
    const sz = info.sizes[pageNo - 1];
    if (sz && !el.dataset.rendered) sheetOf(el).style.height = Math.round((cssWidth * sz.h) / sz.w) + "px";
    if (el.classList.contains("pdf-slot")) applyMatchedLayoutSoon();
  } catch { /* the render reports it */ }
}
const paneObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    const el = en.target;
    const i = Number(el.dataset.index);
    // The slot's own width: beside a matched text page that is the PDF
    // page's scale, which the reading size sets, not the pane's.
    if (en.isIntersecting) { pdfInView.add(i); renderInto(el, pdfSources[i], Number(el.dataset.page), parseFloat(el.style.width) || paneWidth()); }
    else { pdfInView.delete(i); releaseCanvas(el); }
  }
}, { root: pdfPane, rootMargin: PDF_MARGIN + "px 0px" });
const inlineObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    const el = en.target;
    const sec = el.closest(".tpage");
    if (en.isIntersecting) { pdfInView.add(Number(sec.dataset.index)); renderInto(el, pdfSources[Number(sec.dataset.index)], Number(el.dataset.page), inlineWidth(sec)); }
    else { pdfInView.delete(Number(sec.dataset.index)); releaseCanvas(el); }
  }
}, { root: stageEl, rootMargin: PDF_MARGIN + "px 0px" });

function paneWidth() { return Math.max(200, pdfPane.clientWidth - 32); }
function inlineWidth(sec) { return Math.max(200, sec.clientWidth); }

// ── side by side ──
function buildPdfPane() {
  // The slots about to be thrown away are holding pdf.js pages — their
  // operator lists and their decoded images, fifteen megabytes a page of a
  // scan. Dropped with the pane they would never be given back, and reading
  // on rebuilds this pane at every document: the case ends up in memory a
  // page at a time. So they are handed back before the pane goes.
  releasePagesIn(pdfPane);
  pdfPane.innerHTML = "";
  pdfInView.clear(); // the slots those indices named are gone with the pane
  pdfPane.hidden = !sbsOn || !doc;
  document.body.classList.toggle("sbs", sbsOn && !!doc);
  sbsBtn.setAttribute("aria-pressed", String(sbsOn && !!doc));
  if (pdfPane.hidden) return;
  const members = docMembers();
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
    if (of) of.addEventListener("click", () => openFolder());
    pdfPane.appendChild(box);
    return;
  }
  const w = paneWidth();
  // Which PDFs this pass may OPEN. A slot used to ask for its page's real
  // size as it was built, and a pane of three hundred slots asked three
  // hundred PDFs for theirs at once — the whole case folder read, parsed and
  // measured before a page could be looked at. Only what the reading has
  // reached is opened here; the rest stand at letter until it comes near
  // (renderInto, which opens the PDF of a slot coming into view) or until
  // their PDF is opened for something else, which gives every slot of it its
  // height at once (sizeSlotsFor).
  const mayOpen = pdfsInUse();
  // …and whether a slot's label has to name its PDF, asked once rather than
  // once per slot: it reads every page's source, and a combined file of a big
  // case folder has thousands of them.
  const manyPdfs = pdfSourceNames().length > 1;
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
      el = slotShell("pdf-slot", "PDF p. " + t.page + (manyPdfs ? " · " + t.src.name : ""), { label: true });
      el.dataset.page = String(t.page);
      sheetOf(el).style.height = Math.round(w * pageRatioGuess) + "px"; // the folder's paper, until this PDF says
      if (!sizeFromKnown(el, t.src, t.page, w) && mayOpen.has(t.src.name)) presize(el, t.src, t.page, w);
      paneObserver.observe(el);
      // While the redaction tool is on, a drag over the page is the TOOL's,
      // whichever way it is set to mark: the rectangle is drawn as it is
      // dragged, and what it becomes is decided when it is let go.
      RD.attachAreaDrag({
        pageNumber: t.page,
        pageWrapper: sheetOf(el),
        getActive: () => redactOn,
        onBox: (_pageNo, box) => markDraggedBox(el, box),
      });
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
// The columns are re-matched ONCE a frame, however many things ask for it.
// The pane asks a slot at a time as each PDF's page sizes arrive, and the
// grid asks again when it lands: on a seventy-page complaint that was a
// hundred and forty passes over the whole document, each laying out every
// line of every page against the PDF's grid, and the best part of two
// seconds in which the page answered nothing. One pass covers them all.
let matchQueued = false;
function applyMatchedLayoutSoon() {
  if (matchQueued) return;
  matchQueued = true;
  requestAnimationFrame(() => {
    matchQueued = false;
    if (!doc) return;
    applyMatchedLayout();
    if (sbsOn && !pdfPane.hidden) syncScroll("text", true);
  });
}
/**
 * Whether the text is being laid on the PDF's grid right now: the pane up and
 * the grid asked for. The pane alone changes nothing about the page, so what
 * turns on the grid — the lines' own positions, and the citation underlines
 * measured off them — asks this rather than asking whether the pane is open.
 */
// The grid IS side by side. The two were a toggle each for a while — the pane
// on its own, and the pane with the pages laid on the PDF's geometry — on the
// reasoning that a reader opening the pane to check one name does not want the
// document re-set around them. But a pane whose pages do not line up with the
// pages beside them is half of what it is for: the whole point of the second
// column is that line 7 stands beside line 7, and reaching for a second switch
// to get it was a step between the reader and the thing they opened the pane
// to do. One control, one result.
function gridOn() { return sbsOn && !pdfPane.hidden; }
function applyMatchedLayout() {
  return during("lining the text up with the PDF", () => applyMatchedLayoutNow());
}
function applyMatchedLayoutNow() {
  const on = sbsOn && !pdfPane.hidden;
  // The pane and the grid are one thing: a page beside its PDF page is laid on
  // that page's geometry, and with the pane closed it is not. So `grid` is
  // `on` — it is kept as its own name because everything below reads it, and
  // because a page can still fall out of the grid on its own account (no PDF
  // matched to it, or the PDF's sizes not read yet), which is what the pass
  // below decides page by page.
  const grid = gridOn();
  const plans = [];
  const matchedSlots = new Set();
  // The pane's slots by their page, and its width, read ONCE: asking the pane
  // for a slot page by page walks every slot each time, and asking it for its
  // width lays the whole box out again. Seventy pages made both a hundred-fold.
  const slots = new Map();
  if (on) for (const el of pdfPane.querySelectorAll(".pdf-slot:not(.blank)")) slots.set(Number(el.dataset.index), el);
  const paneW = on ? paneWidth() : 0;
  for (const sec of pagesEl.querySelectorAll(".tpage:not(.shed)")) {
    const i = Number(sec.dataset.index);
    const slot = grid ? slots.get(i) || null : null;
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
    // The body type: the DOCUMENT's, so every page of one filing is drawn at
    // one scale and a title page is not sized as though its heading were
    // body text; the page's own where the document has nothing read yet, and
    // (numbers with no body read) the reader's leading filling the pitch, as
    // it does off the grid.
    let base = docTypeSize(info) || PS.pageTypeSize(rows);
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
    // The scale is the sheet's, and the sheet is the paper: the write pass
    // below sets it from the page's own width (and the magnification with it),
    // so the grid is drawn at whatever size the paper is being read at.
    matchedSlots.add(slot);
    plans.push({ sec, slot, sz, body, lines, geom: numbered ? geom : null, tops, lefts, sizes, boxes, pitch, scale: 1 });
  }
  // Every slot the layout did not claim keeps the pane's own width, and gives
  // back whatever a grid before it levelled: its label's height, and the box
  // its sheet was held open to.
  if (on) for (const el of slots.values()) if (!matchedSlots.has(el)) { fitSlot(el, paneW); unlevelSlot(el); }
  document.body.classList.toggle("matched-pages", plans.length > 0);
  // THE SHEET IS THE PAGE, and the grid is drawn into it. The scale used to
  // come from the type — the PDF's body at the reading size — which made the
  // sheet whatever that asked for, half again the paper on a filing set in
  // large type. The paper does not move: the page is the width every other
  // page has, the scale is what draws the PDF page at that width, and the
  // type on it is the PDF's own at that scale. Zooming has nothing to say
  // here, the grid having taken the question over; the status bar says so.
  const pageW = pageWidthNow();
  for (const p of plans) {
    const w = pageW;
    p.scale = w / p.sz.w; // the sheet leads; the grid follows it
    p.w = w;
    fitSlot(p.slot, w);
    p.sec.classList.add("matched");
    p.sec.style.width = w + "px";
    // The page's height from the SAME arithmetic the bitmap is drawn by
    // (renderInto, presize), not from the scale again: a page height rounded
    // one way and a canvas height rounded the other is a pixel a page, and a
    // pixel a page is a centimetre by the fortieth — one column sliding under
    // the other with nothing visibly wrong on either.
    const pageH = Math.round((w * p.sz.h) / p.sz.w);
    // …or more, where a pushed line runs past the PDF's own foot. The slot
    // grows with it (below), so the two boxes stay the same box.
    let foot = 0;
    if (p.tops) p.tops.forEach((y, k) => { if (y != null) foot = Math.max(foot, y + p.boxes[k] + p.pitch); });
    p.h = Math.max(pageH, Math.round(foot * p.scale));
    p.sec.querySelector(".page-inner").style.height = p.h + "px";
    p.body.classList.toggle("fixed", !!p.tops);
    if (p.geom) p.sec.style.setProperty("--body-x", (p.geom.bodyX * p.scale) + "px");
    else p.sec.style.removeProperty("--body-x");
    // Only the lines that MOVE are written to. A pass over a seventy-page
    // complaint sets four properties on two thousand lines, and the passes
    // repeat — as each PDF's sizes arrive, as its grid lands, after every
    // settled edit — almost always to put every line back where it already
    // stands. What it would write is remembered on the line, and a line
    // already there is left alone.
    p.lines.forEach((l, k) => {
      const top = p.tops ? p.tops[k] : null;
      const want = top == null ? "" :
        (top * p.scale) + "|" + (p.lefts && p.lefts[k] != null ? p.lefts[k] * p.scale : "") + "|" +
        (p.sizes[k] * p.scale) + "|" + (p.boxes[k] * p.scale);
      if (l.__laid === want) return;
      l.__laid = want;
      if (top == null) { l.style.top = ""; l.style.left = ""; l.style.lineHeight = ""; l.style.fontSize = ""; return; }
      l.style.top = (top * p.scale) + "px";
      l.style.left = p.lefts && p.lefts[k] != null ? (p.lefts[k] * p.scale) + "px" : "";
      l.style.fontSize = (p.sizes[k] * p.scale) + "px";
      l.style.lineHeight = (p.boxes[k] * p.scale) + "px";
    });
  }
  // THE TWO COLUMNS ARE BOXES, NOT JUST PAGES. A text page's label can carry a
  // REVIEW clause, a document banner's own larger type, or a line that wraps;
  // the pane's label carries the page number and nothing else. A few pixels a
  // page is a centimetre by the tenth, and every page after it is that much
  // out of register — the sync holds the anchors together and the pages
  // between them slide. So the labels are levelled to the taller of the two,
  // and a page the grid has had to grow is matched by its slot.
  //
  // Read every pair, then write every pair: asking one page for its label
  // height after writing the last one lays the document out again each time.
  if (plans.length) {
    const pairs = plans.map((p) => ({
      p,
      lt: p.sec.querySelector(".page-label"),
      ls: p.slot.querySelector(".page-label"),
      sheet: p.slot.querySelector(".pdf-sheet"),
    }));
    for (const x of pairs) {
      x.hl = x.lt ? x.lt.offsetHeight : 0;
      x.hs = x.ls ? x.ls.offsetHeight : 0;
    }
    for (const x of pairs) {
      const lead = Math.max(x.hl, x.hs);
      for (const [el, h] of [[x.lt, x.hl], [x.ls, x.hs]]) {
        if (!el) continue;
        const want = lead && h !== lead ? lead + "px" : "";
        if (el.style.height !== want) el.style.height = want;
      }
      // The bitmap keeps its own height; the sheet holds the box open under it
      // where the text page has had to grow. `minHeight`, because renderInto
      // and presize both write `height` and would take this with it.
      if (x.sheet) {
        const want = x.p.h + "px";
        if (x.sheet.style.minHeight !== want) x.sheet.style.minHeight = want;
      }
    }
  }
  // The sheets take their page shape before anything reads their heights.
  shapePages();
  // A LINE THAT RUNS OFF THE PAGE COMES BACK ONTO IT. The reader's font is not
  // the filing's, and the same characters set in it run a little wider than
  // the column the PDF gave them; past the sheet's edge they are gone, and the
  // sheet does not grow past the width the reader chose. Where the row has
  // blank space in FRONT of the text — the indent the PDF put it at — the line
  // slides back into it, by what it overruns or by what the indent has to
  // give, whichever is less. Its top is untouched, so it still stands beside
  // its own row on the PDF; the indent is what gives, being the part of a line
  // nobody reads. This runs after the sheets have grown as far as the cap
  // allows, so a line is only ever moved when there was nowhere else to put it
  // (and a pleading page, whose lines all start at the body margin with the
  // numbers in front of them, has nothing to give and is left alone).
  const spill = [];
  for (const p of plans) {
    if (!p.tops || !p.lefts) continue;
    p.lines.forEach((l, k) => {
      const left = p.lefts[k] == null ? 0 : p.lefts[k] * p.scale;
      if (left < 1) return; // flush with the margin: nothing in front of it
      const lt = l.querySelector(":scope > .lt");
      if (lt) spill.push({ l, lt, left });
    });
  }
  if (spill.length) {
    for (const x of spill) x.over = x.lt.scrollWidth - x.lt.clientWidth;
    for (const x of spill) {
      const back = Math.min(Math.max(0, x.over), x.left);
      const want = (x.left - back) + "px";
      if (x.l.style.left === want) continue;
      x.l.style.left = want;
      // What the line was laid at no longer describes it: the next pass puts
      // it back at its own indent and measures it again from there.
      x.l.__laid = null;
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
  // The boxes the export draws: their columns and sheets, measured now that
  // every line stands where this pass put it (rules.js).
  fitRuleRows(pagesEl);
  textAnchors = null; textLineTops = null;
}
// ── the sheet as a page ──────────────────────────────────────────────────────
//
// A text page is a PAGE, and takes the shape of the PDF page it came from. An
// export's sheets used to be as tall as their words and no taller: a caption
// page half the height of the one after it, a short exhibit page a strip, a
// banner page a band — a stack of notes rather than a document, and, beside a
// PDF whose pages are all one size, two columns that agreed about nothing.
// Each sheet now takes its PDF page's PROPORTIONS at the width the reader is
// set to. The words are untouched: they flow as they always did, in the
// reader's own type at the reader's own width, and it is the paper under them
// that becomes the paper the thing was filed on.
//
// A FLOOR, NEVER A CEILING. A page whose text wants more room than its shape
// gives it — a large reading size against a dense page — grows, because the
// words come first and the alternative is to hide some of them.
//
// Where a PDF page's own size is not known, the document's prevailing shape
// stands in, and US Letter portrait behind that: nothing is read from a PDF
// until the pane is opened, and a page-shaped sheet is wanted before then. A
// landscape exhibit therefore reads portrait until its PDF is opened, and
// takes its own shape the moment the sizes land.
const PAGE_RATIO = 792 / 612; // US Letter portrait: what a court filing is
/** The height-over-width of the PDF page behind a text page, where it is known. */
function pdfRatioOf(i) {
  const t = pdfTarget(i);
  const info = t && infoFor(t.src);
  const sz = info && info.sizes[t.page - 1];
  return sz && sz.w > 0 ? sz.h / sz.w : null;
}
/**
 * The type sizes the PDF sets for one page's lines, put on the lines as
 * multiples of the body size (`em`) so they ride both the reading size and
 * the page's fit without being worked out again for either.
 *
 * Only where the PDF's rows have been read, and only on a page that VARIES: a
 * pleading page is one size down its column, and what this is for is the page
 * that is not — an order's caption, a heading, an exhibit's small print, a
 * footnote. The grid does the same thing with the same two helpers, where it
 * also has the positions to put the lines at.
 *
 * Once per page per state. The alignment is a diff of the page's lines against
 * the PDF's rows, and a layout pass that ran it again for every page would be
 * the whole cost of opening a long document.
 */
function applyPdfTypeSizes(sec, body) {
  const t = pdfTarget(Number(sec.dataset.index));
  const info = t && infoFor(t.src);
  const rows = info ? info.rows[t.page - 1] : null;
  const stamp = textEpoch + "|" + (rows ? info.name + "|" + t.page : "none");
  if (sec.__typeStamp === stamp) return;
  sec.__typeStamp = stamp;
  const lines = [...body.querySelectorAll(":scope > .line")];
  const base = rows && rows.length ? (docTypeSize(info) || PS.pageTypeSize(rows)) : null;
  const lay = base && !body.classList.contains("numbered")
    ? PS.rowLayout(lines.map((l) => l.textContent), rows)
    : null;
  const sizes = lay ? PS.typeSizes(lay.positions.map((p) => (p ? p.size : null)), base) : null;
  lines.forEach((l, k) => {
    const h = sizes ? sizes[k] : null;
    // Within a fiftieth of the body IS the body: a text layer's heights wobble.
    const want = h && Math.abs(h - base) > base * 0.02 ? (h / base).toFixed(3) + "em" : "";
    if (l.style.fontSize !== want) l.style.fontSize = want;
  });
}
// How far the type may be taken down to make a page hold its words, and how
// many passes it gets. Past the floor the page grows taller instead: a sheet
// the right shape with nothing legible on it is no use to anyone.
const MIN_FIT = 0.5;
const FIT_PASSES = 4;
// THE FIT IS MEASURED AT THE SIZE A PAGE IS MEANT TO HOLD, not at the size
// the reader has zoomed to. A fit measured at the zoomed size would shrink
// the type by exactly what the zoom had just added, and zooming in would do
// nothing at all. So the pages are measured with the type at its default, the
// fit that comes out belongs to the page, and the reading size multiplies it:
// at the default every page holds its words, and zooming in from there makes
// the words bigger and lets the page run on past the foot of the paper — the
// page growing to hold them, since the alternative is words nobody can see.
// The width never gives: the paper is the paper.
function withBaseSize(fn) {
  const root = document.documentElement.style;
  const held = root.getPropertyValue("--reader-size-eff");
  root.setProperty("--reader-size-eff", (TD.DEFAULT_SETTINGS.fontSize * zoomNow()) + "px");
  try { return fn(); } finally {
    if (held) root.setProperty("--reader-size-eff", held);
    else root.removeProperty("--reader-size-eff");
  }
}
function shapePages() {
  // A page the reel has shed carries a pinned height and no body: its shape is
  // the shape it had, and the moment it is built back it is shaped with the
  // rest. Touching it here is what would move the column under the reader.
  const secs = [...pagesEl.querySelectorAll(".tpage:not(.shed)")];
  // A page on the grid carries the PDF's own height and type already, and a
  // swapped page IS the PDF page. A page still showing the export's trailer
  // (the pane is closed, so nothing is clipped) is not one page of anything —
  // it is the last page with an appendix stapled under it — and is left to
  // flow rather than have the filing squeezed to make room for the links.
  const clipped = document.body.classList.contains("sbs");
  const shapes = [];
  for (const sec of secs) {
    const body = sec.querySelector(".page-body");
    const loose = sec.classList.contains("matched") || sec.classList.contains("swapped")
      || (!clipped && sec.querySelector(".line.trailer"));
    if (loose) {
      if (body.style.minHeight) body.style.minHeight = "";
      if (sec.style.getPropertyValue("--fit")) sec.style.removeProperty("--fit");
      continue;
    }
    shapes.push({ sec, body, ratio: pdfRatioOf(Number(sec.dataset.index)), fit: 1 });
  }
  if (!shapes.length) return;
  const width = shapes[0].sec.clientWidth; // one read: every free sheet is this wide
  if (!width) return;
  // The shape for the pages with no PDF page of their own — a combined file's
  // contents page, its banners, an export whose PDF is not open yet: the
  // commonest of the shapes that ARE known, so the odd page out is the same
  // paper as the filing around it.
  const counts = new Map();
  for (const s of shapes) if (s.ratio) counts.set(s.ratio, (counts.get(s.ratio) || 0) + 1);
  let common = PAGE_RATIO, most = 0;
  for (const [r, n] of counts) if (n > most) { most = n; common = r; }
  for (const s of shapes) {
    s.target = Math.round(width * (s.ratio || common));
    const want = s.target + "px";
    if (s.body.style.minHeight !== want) s.body.style.minHeight = want;
    if (s.sec.style.getPropertyValue("--fit")) s.sec.style.removeProperty("--fit"); // measured at its own size first
    applyPdfTypeSizes(s.sec, s.body);
  }
  // THE SHAPE IS A CEILING. A page whose words want more room than the PDF
  // page gave them — the reading size is the reader's own, and the filing was
  // set in whatever it was set in — is drawn smaller until they fit, the way
  // the PDF itself is at that zoom. Display only: the file is one size, and
  // the size in the Tools panel is still the size of a page that fits.
  //
  // Every page is measured, THEN every page is written. Shrinking one page and
  // measuring the next lays the whole document out again for each page in
  // turn, which on a long export is most of the time an open takes; this way
  // a pass costs one layout however many pages there are. Four of them
  // converge, the first guess always overshooting a little because the page's
  // margins do not shrink with its type.
  withBaseSize(() => {
    for (let pass = 0; pass < FIT_PASSES; pass++) {
      const over = [];
      for (const s of shapes) {
        if (!(s.target > 0)) continue;
        // Too tall for the paper: the type gives. Too WIDE is not the type's
        // fault and is not paid for by the whole page — one runaway line
        // would take every word on the sheet down with it — so a line that
        // runs past the edge is cut off there by the stylesheet instead.
        const h = s.body.scrollHeight;
        if (h > s.target + 0.5) over.push([s, s.target / h]);
      }
      if (!over.length) break;
      let moved = false;
      for (const [s, ratio] of over) {
        const want = Math.max(MIN_FIT, s.fit * ratio);
        if (want >= s.fit - 0.002) continue; // at the floor, or as close as it comes
        s.fit = want;
        s.sec.style.setProperty("--fit", want.toFixed(3));
        moved = true;
      }
      if (!moved) break;
    }
  });
}

/** A slot back as the pane built it: the levelling and the held-open box go. */
function unlevelSlot(el) {
  const lab = el.querySelector(".page-label");
  if (lab && lab.style.height) lab.style.height = "";
  const sheet = el.querySelector(".pdf-sheet");
  if (sheet && sheet.style.minHeight) sheet.style.minHeight = "";
}
function clearMatched(sec) {
  if (!sec.classList.contains("matched")) return;
  sec.classList.remove("matched");
  sec.__typeStamp = null; // the grid wrote the line sizes; the flowing pass owns them now
  const lab = sec.querySelector(".page-label");
  if (lab && lab.style.height) lab.style.height = "";
  sec.style.width = "";
  sec.style.removeProperty("--body-x");
  const inner = sec.querySelector(".page-inner");
  if (inner) inner.style.height = "";
  const body = sec.querySelector(".page-body");
  if (!body) return; // shed: there are no lines left to un-lay
  body.classList.remove("fixed");
  for (const l of body.querySelectorAll(":scope > .line")) { l.__laid = null; l.style.top = ""; l.style.left = ""; l.style.height = ""; l.style.lineHeight = ""; l.style.fontSize = ""; }
}
function setSideBySide(on, { remember = true } = {}) {
  sbsOn = !!on;
  if (remember) lsSet("textReader.sbs", sbsOn);
  // The redaction tool marks the pane's pages: with the pane shut there is
  // nothing under it to mark. The boxes already proposed are kept, and
  // opening the tool again opens the pane and puts them back on the pages.
  if (!sbsOn && redactOn) setRedactMode(false);
  // The underlines go as the panes open, not a layout pass later — the grid is
  // what is opening with them.
  if (sbsOn) clearCitationLinks();
  buildPdfPane();
  applySwaps();
  relayout();
}
sbsBtn.addEventListener("click", () => setSideBySide(!sbsOn));
$("plain-toggle").addEventListener("change", (e) => setPlain(e.target.checked));

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
stageEl.addEventListener("scroll", () => { syncScroll("text"); reelMaybeExtend(); reelScrolled(); reelSyncCurrent(); reelTrimSoon(); pdfTrimSoon(); }, { passive: true });
// Coalesced: a scroll fires continuously, and a pass over the members that
// builds pages back is not something to do sixty times a second.
const reelTrimSoon = debounce(reelTrim, 200);
// …and the PDFs behind the documents the reading has left: the window moves
// with the reading, so what falls out of it is closed as it does, and not
// only when the document changes.
const pdfTrimSoon = debounce(trimPdfs, 500);
// …and the pages that were still drawing when the reading left them.
const releasePagesSoon = debounce(sweepPagesToRelease, 700);
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
    const title = !t ? "No PDF matched this document — ⇄ PDF pages… in the tools panel picks one" : on ? "Back to the text of this page" : `Show PDF page ${t.page} here instead of its text`;
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
      releasePage(inline);
      inline.remove();
      moved = true;
    }
  }
  refreshSwapButtons();
  updatePdfStatus();
  warmForLeaks();
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
  // The button stands in the left rail, so the popover flies out beside it.
  const r = swapBtn.getBoundingClientRect();
  swapPop.style.left = Math.max(8, Math.min(window.innerWidth - 356, r.right + 8)) + "px";
  swapPop.style.top = Math.max(8, Math.min(window.innerHeight - 240, r.top)) + "px";
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
  const members = docMembers();
  if (members.length <= 1) { await usePickedPdf(list[0]); return; }
  const byName = [], unmatched = [];
  for (const f of list) {
    pdfCache.delete(f.name);
    const src = { name: f.name, file: f };
    pickedPdfs.set(f.name, src);
    const m = members.find((mm) => PS.matchPdf(mm, [f.name], fwdName()));
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

// ── redacting the PDF beside the text ─────────────────────────────────────────
//
// The same redaction the PDF viewer does (viewer/redact.js holds the rule and
// the decisions), reached from where a case folder is actually worked.
//
// WHY HERE. The export and the PDF it was made from are the same filing seen
// twice, and the reader already has both: the folder open, the key loaded, the
// PDF matched to the export and standing beside it. A redaction asks exactly
// what the review has just answered — which values in this matter are real —
// so it is asked here rather than by opening the PDF again in another tab and
// loading the key into it a second time.
//
// THE RULE IS UNCHANGED. Nothing is hidden until the copy is saved; the copy
// is a NEW file made of page images with the boxes painted into the pixels,
// carrying no text layer, no annotations and no metadata; and the PDF in the
// case folder is never written. This tool has no in-place path at all.
//
// WHAT IS MARKED, AND FOR WHICH DOCUMENT. The key is the baseline, run over
// the PDF's OWN text — not the export's. The export was scrubbed; the PDF is
// the file nobody scrubbed, which is the whole reason it needs redacting. And
// it is the reader's reading of the key: a value the review has KEPT is a
// value already decided not to be this matter's to hide, so it is not
// proposed. The hand adds the rest, a drag at a time, on the pages in the
// pane.
//
// A Combined Text.txt shows the pages of a document per member, each with a
// PDF of its own, so the boxes are filed per PDF (a store each) and the save
// writes one redacted copy per PDF that carries any. They outlast the
// document on screen — hopping between a folder's exports is how the folder is
// read — and are dropped when the folder changes or Clear is pressed.
const redactBtn = $("redact-btn");
const rbWhere = $("rb-where");
const rbState = $("rb-state");
const rbKey = $("rb-key");
const rbMark = $("rb-mark");
const rbScan = $("rb-scan");
const rbCheck = $("rb-check");
const rbClear = $("rb-clear");
const rbDpi = $("rb-dpi");
const rbSave = $("rb-save");
let redactOn = false;
let redactMark = "text";     // what a drag marks: "text" | "area"
let redactSaving = false;
let redactScanning = false;
const redactStores = new Map(); // PDF name → its own store of boxes

function redactStoreFor(name) {
  if (!redactStores.has(name)) redactStores.set(name, RD.createRedactionStore());
  return redactStores.get(name);
}
/** Every PDF carrying boxes: [{ name, boxes, pages }], the open document's first. */
function redactMarked() {
  const mine = pdfSourceNames();
  const out = [];
  for (const [name, store] of redactStores) {
    const { boxes, pages } = store.count();
    if (boxes) out.push({ name, boxes, pages });
  }
  return out.sort((a, b) => (mine.indexOf(b.name) >= 0) - (mine.indexOf(a.name) >= 0));
}
function redactTotals() {
  let boxes = 0, pages = 0, docs = 0;
  for (const m of redactMarked()) { boxes += m.boxes; pages += m.pages; docs++; }
  return { boxes, pages, docs };
}
/** Every box taken back off, and the pane redrawn without them. */
function clearRedactions(why) {
  const had = redactTotals().boxes;
  redactStores.clear();
  missWalk = []; missShort = new Map(); missAt = -1;
  if (typeof showMissRow === "function") showMissRow(false);
  repaintAllRedactions();
  updateRedactBar();
  if (had && why) toast(`${had} box${had === 1 ? "" : "es"} taken back off — ${why}.`);
  return had;
}

// ── painting the pane's slots ──
/**
 * The slot's own store and page, or null where there is nothing to mark.
 *
 * Pane slots only. A page swapped INTO the text is drawn by the same code but
 * is never on screen with this tool: the tool opens the pane, and a swapped-in
 * page shows only while the pane is closed.
 */
function slotRedaction(el, { create = false } = {}) {
  if (!el.classList.contains("pdf-slot")) return null;
  const src = pdfSources[Number(el.dataset.index)];
  const page = Number(el.dataset.page);
  if (!src || !page) return null;
  // A page merely drawn is not a document being redacted: a store is opened
  // when something is actually filed in it, not every time a slot scrolls by.
  const store = create ? redactStoreFor(src.name) : redactStores.get(src.name) || null;
  return { src, page, store };
}
function paintRedactions(el) {
  const layer = sheetOf(el).querySelector(".redactLayer");
  if (!layer) return;
  const at = slotRedaction(el);
  if (!at || !at.store || !el.__vp) { layer.innerHTML = ""; return; }
  RD.repaintRedactionsForPage(at.page, layer, el.__vp, {
    store: at.store,
    // One box is several rectangles where it wrapped, and redrawing the page
    // is what takes the rest of them off with it.
    onRemove: () => { paintRedactions(el); updateRedactBar(); },
  });
}
function repaintAllRedactions() {
  for (const el of pdfPane.querySelectorAll(".pdf-slot")) paintRedactions(el);
}

// ── what a drag marks ──
//
// Client rectangles → the boxes that get stored, in the PDF's own points.
// Merged into lines first (a name split across two text runs comes back as
// two rectangles with a hairline of page between them), then padded by a point
// so a descender or an antialiased edge does not survive along the border, and
// held inside the page's own box.
function storeBoxesFromClientRects(el, clientRects, meta) {
  const at = slotRedaction(el, { create: true });
  if (!at || !el.__vp || !el.__view) return 0;
  const base = sheetOf(el).getBoundingClientRect();
  const local = [];
  for (const cr of clientRects) {
    if (cr.width <= 0.5 || cr.height <= 0.5) continue;
    local.push({ x: cr.left - base.left, y: cr.top - base.top, w: cr.width, h: cr.height });
  }
  const pageBox = RD.pageBoxFromView(el.__view);
  const out = [];
  for (const r of RD.mergeRects(local, 2)) {
    const [x1, y1] = el.__vp.convertToPdfPoint(r.x, r.y);
    const [x2, y2] = el.__vp.convertToPdfPoint(r.x + r.w, r.y + r.h);
    const box = RD.clampRect(RD.padRect({
      x: Math.min(x1, x2), y: Math.min(y1, y2),
      w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
    }, 1), pageBox);
    if (box) out.push(box);
  }
  if (!out.length || !at.store.add(at.page, out, meta)) return 0;
  paintRedactions(el);
  updateRedactBar();
  return out.length;
}

/**
 * The words a drag actually covers, as client rectangles.
 *
 * Read off the page's GEOMETRY rather than out of a selection. A selection is
 * the wrong instrument here: it is snapped to the nearest character on a row,
 * because that is what a reader dragging over words wants, and it will happily
 * hand back words nowhere near the pointer when the pointer is over a part of
 * the page that has no words at all. Geometry cannot do that — a drag over a
 * signature covers no spans, and covering no spans is the answer.
 *
 * A span the drag crosses is clipped to the drag horizontally and kept whole
 * vertically, so a drag along a line boxes the run of words under it and a
 * drag down a column boxes each line it crosses.
 */
function textRectsUnder(el, box) {
  const layer = sheetOf(el).querySelector(".textLayer");
  if (!layer) return { rects: [], text: "" };
  const base = sheetOf(el).getBoundingClientRect();
  const x0 = base.left + box.left, y0 = base.top + box.top;
  const x1 = x0 + box.width, y1 = y0 + box.height;
  const rects = [];
  const words = [];
  for (const span of layer.querySelectorAll("span")) {
    const r = span.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    // Crossed vertically: the drag reaches into the line's own band.
    if (r.bottom <= y0 || r.top >= y1) continue;
    const left = Math.max(r.left, x0), right = Math.min(r.right, x1);
    if (right - left <= 0.5) continue;
    rects.push({ left, top: r.top, width: right - left, height: r.height });
    const t = (span.textContent || "").trim();
    if (t) words.push(t);
  }
  return { rects, text: words.join(" ").replace(/\s+/g, " ").slice(0, 120) };
}

/**
 * A drag let go of. What it marks depends on what is under it, not only on how
 * the tool is set: asked for TEXT it boxes the words the drag covers, and
 * where it covers none — a signature, a stamp, a photograph, a scanned page
 * whose text layer knows nothing — it marks the rectangle that was drawn,
 * which is what the hand plainly meant. Asked for an AREA it always marks the
 * rectangle, words or no words.
 */
function markDraggedBox(el, box) {
  const base = sheetOf(el).getBoundingClientRect();
  const whole = [{ left: base.left + box.left, top: base.top + box.top, width: box.width, height: box.height }];
  // What the drag covers is worked out either way, because an AREA box over a
  // name hides that name just as surely as a box the key proposed — and the
  // check has to be able to see that, or it goes on asking for a value the
  // operator has plainly just blacked out.
  const under = textRectsUnder(el, box);
  let n = 0, fellBack = false;
  if (redactMark === "text") {
    if (under.rects.length) n = storeBoxesFromClientRects(el, under.rects, { kind: "text", label: under.text || "these words", words: under.text });
    else { fellBack = true; n = storeBoxesFromClientRects(el, whole, { kind: "area", label: "this area — nothing under it is text" }); }
  } else {
    n = storeBoxesFromClientRects(el, whole, { kind: "area", label: "this area", words: under.text });
  }
  if (!n) return;
  if (fellBack) toast("Nothing under that drag is text, so the area itself is marked — which is what a signature or a stamp needs.", { ms: 5000 });
  // …and where the export said something was missed on this very page, that
  // drag is the answer to it.
  const at = slotRedaction(el);
  if (at) missAnsweredByBox(at.src.name, at.page);
}

/**
 * A selection made over the pane by something other than the drag (a double
 * click on a word, Ctrl+A). Kept because it is a real way to mark, but it is
 * no longer how a DRAG marks — see markDraggedBox.
 */
function redactCurrentSelection() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return 0;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const host = node.nodeType === 1 ? node : node.parentElement;
  const el = host && host.closest ? host.closest(".pdf-slot") : null;
  if (!el || !pdfPane.contains(el)) return 0;
  const label = sel.toString().replace(/\s+/g, " ").trim().slice(0, 120);
  const n = storeBoxesFromClientRects(el, [...range.getClientRects()], { kind: "text", label });
  if (n) sel.removeAllRanges();
  return n;
}

// The drag is taken on the document: a selection is only final once the
// browser has finished settling it.
document.addEventListener("mouseup", () => {
  if (!redactOn || redactMark !== "text") return;
  setTimeout(() => { if (redactOn && redactMark === "text") redactCurrentSelection(); }, 0);
});

// ── the key, over every page of the PDF ──
//
// The pane draws the pages in view, at the pane's width, and a document's
// later pages may never be drawn at all — but a copy is the WHOLE document, so
// the sweep goes to the PDF rather than to the pane. Each page's text is laid
// out OFF SCREEN by pdf.js's own text layer, at scale 1 so a CSS pixel is a
// point, and the browser is asked where the words are; nothing is rendered,
// and what the pane happens to be showing has no say in it.
//
// And it is the PDF's text, never the export's: the export was scrubbed, and
// it is the PDF that was not.
let sweepBox = null;
function sweepContainer() {
  if (!sweepBox) {
    sweepBox = document.createElement("div");
    sweepBox.className = "textLayer redact-sweep";
    document.body.appendChild(sweepBox);
  }
  return sweepBox;
}

/** Every place the key's real values stand on a page: [{ rects (in points), label }]. */
async function keyBoxesForPage(page) {
  const vp = page.getViewport({ scale: 1 });
  const box = sweepContainer();
  box.innerHTML = "";
  box.style.width = vp.width + "px";
  box.style.height = vp.height + "px";
  box.style.setProperty("--scale-factor", "1");
  box.style.setProperty("--total-scale-factor", "1");
  const tl = new pdfjsLib.TextLayer({ textContentSource: await page.getTextContent(), container: box, viewport: vp });
  await tl.render();
  const spans = box.querySelectorAll("span");
  const { text, map } = RD.pageTextFromSpans(RD.measureSpans(box));
  const chars = text.replace(/\s+/g, "").length;
  const pageBox = RD.pageBoxFromView(page.view);
  const base = box.getBoundingClientRect();
  const out = [];
  let missed = 0;
  for (const hit of PK.findRealSpans(reals, text)) {
    const r = RD.spanRangeFor(map, hit.start, hit.end);
    const a = r && spans[r.startSpan], b = r && spans[r.endSpan];
    const an = a && a.firstChild, bn = b && b.firstChild;
    if (!an || !bn) { missed++; continue; }
    const range = document.createRange();
    try {
      range.setStart(an, Math.max(0, Math.min(r.startOffset, an.length || 0)));
      range.setEnd(bn, Math.max(0, Math.min(r.endOffset, bn.length || 0)));
    } catch { missed++; continue; }
    const local = [];
    for (const cr of range.getClientRects()) {
      if (cr.width <= 0.5 || cr.height <= 0.5) continue;
      local.push({ x: cr.left - base.left, y: cr.top - base.top, w: cr.width, h: cr.height });
    }
    const rects = [];
    for (const m of RD.mergeRects(local, 2)) {
      const [x1, y1] = vp.convertToPdfPoint(m.x, m.y);
      const [x2, y2] = vp.convertToPdfPoint(m.x + m.w, m.y + m.h);
      const kept = RD.clampRect(RD.padRect({
        x: Math.min(x1, x2), y: Math.min(y1, y2),
        w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
      }, 1), pageBox);
      if (kept) rects.push(kept);
    }
    if (rects.length) out.push({ rects, label: hit.real });
    else missed++;
  }
  box.innerHTML = "";
  return { boxes: out, missed, chars };
}

// Per "pdf|page", how much text the sweep found on it. A page with none is a
// scan, or a page of pictures: the key cannot reach ANY value on it, and a
// walk that says "not found" thirty times over without saying that is thirty
// mysteries. With it, it is one fact.
let sweptText = new Map();

async function scanForKeyValues() {
  if (!reals) { toast("No pseudonym key is loaded — load one in the tools rail.", { error: true }); return; }
  const names = pdfSourceNames();
  // One sweep at a time: a second one running over the first would propose
  // every value twice. The tool opening with a key in hand starts one, and so
  // does the button and a key changed under it.
  if (redactScanning || !names.length) return;
  redactScanning = true;
  updateRedactBar();
  sweptText = new Map();
  let found = 0, missed = 0, pagesRead = 0;
  try {
    for (const name of names) {
      const src = pdfSourceFor(name);
      if (!src) continue;
      const store = redactStoreFor(name);
      store.clear("key"); // a re-sweep replaces the run's own, never the hand's
      let info;
      try { info = await loadPdf(src, { now: true }); }
      catch (e) { toast(`Could not open ${name}: ${e.message || e}`, { error: true }); continue; }
      for (let pn = 1; pn <= info.count; pn++) {
        rbState.textContent = `Reading ${name}, page ${pn} of ${info.count}…`;
        let page;
        try { page = await info.pdf.getPage(pn); } catch { continue; }
        pagesRead++;
        let hits;
        try { hits = await keyBoxesForPage(page); } catch { continue; }
        sweptText.set(name + "|" + pn, hits.chars);
        missed += hits.missed;
        for (const h of hits.boxes) {
          if (store.add(pn, h.rects, { kind: "key", label: h.label })) found++;
        }
        // A long document is a long loop: the tab breathes between pages.
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } finally { redactScanning = false; }
  repaintAllRedactions();
  // A sweep is only half the answer: the export is the other half, and a value
  // the PDF's text would not give up is exactly the thing nobody would notice.
  // So the check runs itself, and the count sits in the bar from then on.
  missWalk = doc && reals ? redactionShortfall() : [];
  missAt = -1;
  updateRedactBar();
  toast((found
    ? `Marked ${found} value${found === 1 ? "" : "s"} the key binds, over ${pagesRead} page${pagesRead === 1 ? "" : "s"} of the PDF` +
      (missed ? `; ${missed} could not be placed on the page.` : ".")
    : `The key binds nothing that stands in ${names.length === 1 ? "this PDF" : "these PDFs"} — ${pagesRead} page${pagesRead === 1 ? "" : "s"} read.`) +
    (missWalk.length
      ? ` The export places ${missOutstanding()} more that the sweep could not find — “Check against the export” walks ${missWalk.length === missOutstanding() ? "them" : `the ${missWalk.length} places they could be`}.`
      : ""),
    { ms: missWalk.length ? 9000 : 5000 });
}

/** The source behind a PDF name: the open document's, else one picked by hand, else the folder's. */
function pdfSourceFor(name) {
  for (const s of pdfSources) if (s && s.name === name) return s;
  if (pickedPdfs.has(name)) return pickedPdfs.get(name);
  for (const s of pickedByMember.values()) if (s && s.name === name) return s;
  return folderPdfs.find((p) => p.name === name) || null;
}

// ── the bar ──
function updateRedactBar() {
  if (redactBar.hidden) return;
  const marked = redactMarked();
  const { boxes, pages, docs } = redactTotals();
  const names = pdfSourceNames();
  rbWhere.textContent = names.length
    ? (names.length === 1 ? names[0] : `${names.length} documents beside this export`)
    : "No PDF is matched to this export.";
  rbState.textContent = !boxes ? "Nothing marked."
    : `${boxes} box${boxes === 1 ? "" : "es"} on ${pages} page${pages === 1 ? "" : "s"}` +
      (docs > 1 ? ` of ${docs} documents: ${marked.map((m) => `${m.name} (${m.boxes})`).join(", ")}` : "") + ".";
  rbState.classList.toggle("undecided", !boxes);
  rbKey.textContent = key
    ? `Key: ${PK.keyTitle(key)}${allKeeps().length ? ` — a sweep skips the ${allKeeps().length} value${allKeeps().length === 1 ? "" : "s"} you have kept` : ""}`
    : "No key loaded — the key is the baseline; load one under Pseudonyms.";
  const busy = redactSaving || redactScanning;
  const miss = missOutstanding();
  rbCheck.disabled = !reals || !names.length || busy;
  rbCheck.textContent = miss ? `${miss} not found — review` : "Check against the export";
  rbCheck.classList.toggle("warn", !!miss);
  rbScan.disabled = !reals || !names.length || busy;
  rbClear.disabled = !boxes || busy;
  rbSave.disabled = !boxes || busy;
  setBarHeight();
}

function setRedactMode(on) {
  redactOn = !!on && !!doc;
  redactBar.hidden = !redactOn;
  redactBtn.setAttribute("aria-pressed", String(redactOn));
  document.body.classList.toggle("redact-on", redactOn);
  document.body.classList.toggle("redact-area-mode", redactOn && redactMark === "area");
  if (redactOn) {
    // It is the pane's tool: the pages it marks are the pages the pane shows.
    if (!sbsOn) setSideBySide(true);
    // …and the export's own pseudonyms are what the check reads, so every page
    // of the reel is built while the tool is open.
    reelAllLive();
    updateRedactBar();
    // The key is the baseline, so opening the tool with one in hand and
    // nothing marked sweeps the PDF at once: the hand starts from what the
    // run already knows rather than from a blank page. Opening it again over
    // work already done leaves that work alone.
    if (reals && !redactTotals().boxes && pdfSourceNames().length) scanForKeyValues();
  } else {
    showMissRow(false);
    setBarHeight();
  }
  relayout();
}

// ── the copy ──
//
// A page's bytes, rendered at the saving resolution with its boxes painted in.
// The black goes on AFTER the page is drawn and BEFORE the pixels are encoded,
// which is the whole trick: what was under a box was never in this image.
async function renderRedactedPage(pdf, store, pageNumber, scale) {
  const page = await pdf.getPage(pageNumber);
  const vp = page.getViewport({ scale });
  const pts = page.getViewport({ scale: 1 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(vp.width));
  canvas.height = Math.max(1, Math.round(vp.height));
  const ctx = canvas.getContext("2d");
  // A page with no background of its own would encode as black otherwise.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  ctx.fillStyle = "#000000";
  for (const box of store.for(pageNumber)) {
    for (const r of box.rects) {
      const [x1, y1, x2, y2] = vp.convertToViewportRectangle([r.x, r.y, r.x + r.w, r.y + r.h]);
      // Outward to whole pixels: half a pixel of a letter left showing along
      // an edge is half a letter more than a redaction may leave.
      const x = Math.floor(Math.min(x1, x2)), y = Math.floor(Math.min(y1, y2));
      ctx.fillRect(x, y, Math.ceil(Math.max(x1, x2)) - x, Math.ceil(Math.max(y1, y2)) - y);
    }
  }
  const bytes = await canvasBytes(canvas, "image/jpeg", 0.92);
  canvas.width = canvas.height = 0; // let the bitmap go before the next page
  return { bytes, format: "jpg", widthPts: pts.width, heightPts: pts.height };
}

function canvasBytes(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("The page could not be rendered to an image.")); return; }
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
    }, type, quality);
  });
}

/** One copy per PDF carrying boxes, each written through the Save dialog. */
async function saveRedactedCopies() {
  const marked = redactMarked();
  if (!marked.length) return;
  redactSaving = true;
  updateRedactBar();
  const written = [];
  try {
    const dpi = parseInt(rbDpi.value, 10) || 200;
    const scale = dpi / 72;
    const fwdN = fwdName();
    for (const m of marked) {
      const src = pdfSourceFor(m.name);
      if (!src) { toast(`${m.name} is no longer open — its boxes are still marked.`, { error: true }); continue; }
      const store = redactStoreFor(m.name);
      const info = await loadPdf(src, { now: true });
      const pages = [];
      // EVERY page, not only the marked ones. A copy that kept its unmarked
      // pages as they were would carry a text layer on those pages, and a
      // document searchable everywhere except over the black boxes tells a
      // reader exactly where to look and hands them the rest of it besides.
      for (let pn = 1; pn <= info.count; pn++) {
        rbState.textContent = `Redacting ${m.name}, page ${pn} of ${info.count}…`;
        pages.push(await renderRedactedPage(info.pdf, store, pn, scale));
        await new Promise((r) => setTimeout(r, 0));
      }
      rbState.textContent = `Writing the redacted copy of ${m.name}…`;
      const bytes = await buildRedactedPdf({ pages });
      // Forward through the key so the copy carries the pseudonymized name,
      // and never in place: this save has no path to the PDF in the folder.
      const name = RD.redactedName(m.name, fwdN);
      const ok = await writeBlob(new Blob([bytes], { type: "application/pdf" }), name, null,
        { description: "PDF", accept: { "application/pdf": [".pdf"] } });
      if (ok) written.push({ name, boxes: m.boxes });
    }
    toast(written.length
      ? `Saved ${written.map((w) => w.name).join(", ")} — ${written.reduce((n, w) => n + w.boxes, 0)} box${written.reduce((n, w) => n + w.boxes, 0) === 1 ? "" : "es"} blacked out, no text layer, no metadata. The case folder's own PDF${marked.length === 1 ? " is" : "s are"} untouched.`
      : "Nothing was written.", { ms: 7000 });
  } catch (e) {
    console.error("[text-reader] redaction failed:", e);
    toast("Redaction failed: " + (e && e.message ? e.message : e), { error: true });
  } finally {
    redactSaving = false;
    updateRedactBar();
  }
}

/** A different key: its own reading replaces the last one's, sweep and all. */
function redactKeyChanged() {
  if (!redactStores.size) return;
  for (const st of redactStores.values()) st.clear("key");
  repaintAllRedactions();
  updateRedactBar();
  if (redactOn && reals && pdfSourceNames().length) scanForKeyValues();
}

redactBtn.addEventListener("click", () => setRedactMode(!redactOn));
$("rb-close").addEventListener("click", () => setRedactMode(false));
rbMark.addEventListener("change", () => {
  redactMark = rbMark.value === "area" ? "area" : "text";
  document.body.classList.toggle("redact-area-mode", redactOn && redactMark === "area");
});
rbScan.addEventListener("click", scanForKeyValues);
rbClear.addEventListener("click", () => { if (!clearRedactions()) return; toast("Every box taken back off."); });
rbSave.addEventListener("click", saveRedactedCopies);


// ── checking the sweep against the export ────────────────────────────────────────────
//
// THE SWEEP CAN MISS, AND A MISS IS INVISIBLE. The key is run over the PDF's
// OWN text, and a PDF's text is not a clean transcript: a name can be broken
// across two lines, set with a ligature, spelled by the OCR a little
// differently, kerned into one run with the word beside it, or not be text at
// all — a signature, a letterhead, a scanned exhibit. Each of those is a real
// value the sweep does not box, and nothing on screen says so. A redaction you
// cannot check is a redaction you cannot rely on.
//
// THE EXPORT IS THE SECOND OPINION. PDF-Linker read the same PDF and wrote a
// PSEUDONYM wherever a real value stood, so the export knows where the values
// are on each page even where the PDF's own text will not give them up. Every
// pseudonym on a text page is therefore a claim: this page of the PDF carries
// this real value. The sweep's boxes on that PDF page are the answer, and
// anything the export claims that the sweep did not box is what this reports.
//
// IT DOES NOT GUESS WHERE. The export says the value is on the page, not where
// on the page — PDF-Linker's pages are the PDF's pages, but its text is its own
// layout. So this does not propose a box. It walks the operator to each
// unmatched claim in the TEXT, holds the PDF pane beside it at the same page,
// and leaves the eye and the area drag to finish the job. That is the honest
// shape of it: the export can say something was missed, and only a person can
// say where it stands on the paper.

let missWalk = [];   // [{ group, src, page, real, span, pageIndex, want, got }]
let missShort = new Map(); // …and per value-on-a-page, how many are still outstanding
let missAt = -1;
let missHere = null; // the occurrence the walk stands on, as a Range

/**
 * What the EXPORT claims, page by page: "pdf|page" → the claims on it, in
 * document order.
 *
 * Each carries its REAL value and the FAKE that stands in its place, because
 * the fake is what says which words a redaction actually owes (redact.js,
 * wordsOwed): "Zachary Coderre, Esq." faked as "Rushton, Greenhalgh, Esq."
 * owes the two names and not the Esq., which was never a thing to hide.
 *
 * A name wrapped across lines is several spans and ONE claim, so only the
 * first piece of a run is counted.
 */
function claimsFromExport() {
  const byPage = new Map();
  for (const sec of pagesEl.querySelectorAll(".tpage:not(.shed)")) {
    const i = Number(sec.dataset.index);
    const t = pdfTarget(i);
    if (!t) continue;
    for (const span of sec.querySelectorAll(".pn")) {
      if (span.dataset.piece && !/^1\//.test(span.dataset.piece)) continue;
      // A KEPT value is not a claim. The review decided this one is not this
      // matter's to hide, the sweep is run on the key LESS the keeps and so
      // never boxes it, and counting it here asked for a box that nothing was
      // ever going to draw — an alarm that could not be answered and would not
      // go away. It is the Esq. rule again: a value nobody is hiding is owed
      // no redaction.
      if (span.classList.contains("kept")) continue;
      const real = span.dataset.wholeReal || span.dataset.real;
      if (!real) continue;
      const fake = span.dataset.wholeFake || span.dataset.fake || "";
      const pk = t.src.name + "|" + t.page;
      if (!byPage.has(pk)) byPage.set(pk, []);
      byPage.get(pk).push({
        real, fake, span, pageIndex: i, src: t.src, page: t.page,
        group: pk + "|" + PK.fold(real),
      });
    }
  }
  return byPage;
}

/**
 * …and what is boxed on each: "pdf|page" → the words every box there covers.
 *
 * THE HAND'S BOXES COUNT. A box drawn over words is as much a redaction of
 * those words as one the key proposed, and it carries what it covered as its
 * label — so it answers a claim exactly as a swept box does. Leaving it out
 * was what made the check go on demanding a value the operator had just
 * blacked out by hand: the sweep had missed it (surname first, a comma in the
 * way, a spelling the key does not have), the drag dealt with it, and the
 * check kept asking.
 *
 * It is the WORDS that are compared, never the label, so a drag that ran on
 * over the comma after a name, or took the word beside it, or took the name
 * the other way round, covers it just the same.
 *
 * An AREA box carries no words — that is what an area is for — so it cannot
 * answer a claim here. It answers one the other way, by being drawn on the
 * page the walk is standing on (missAnsweredByBox).
 */
function labelsFromSweep() {
  const byPage = new Map();
  for (const [name, store] of redactStores) {
    for (const { pageNumber, boxes } of store.pages()) {
      for (const b of boxes) {
        // What the box COVERS, whoever drew it and whatever it is called: the
        // key's value for a swept box, the words under the drag for a hand
        // one — an area included, which is how a box drawn over a name in area
        // mode answers for that name. An area over a signature covers no words
        // and answers for nothing, which is right.
        const covered = b.kind === "key" ? b.label : (b.words || "");
        if (!covered) continue;
        const pk = name + "|" + pageNumber;
        if (!byPage.has(pk)) byPage.set(pk, []);
        byPage.get(pk).push(covered);
      }
    }
  }
  return byPage;
}

/**
 * The claims the sweep did not answer, in reading order.
 *
 * The answering is by WORDS, not by labels (redact.coveredClaims): a name the
 * PDF's text broke in two is boxed as "Zachary" and "Coderre" side by side and
 * is a name boxed, and a word the fake carries through — Esq., Department, of
 * — is owed no box at all. Both of those used to raise an alarm about a
 * redaction that was already complete, which is the worst thing a check like
 * this can do: cry wolf often enough and it stops being read.
 *
 * Where a value is claimed twice on a page and covered once, WHICH of the two
 * went unboxed is still not knowable — the export's places and the PDF's are
 * different geometries of one page — so both are walked, and the count says
 * how many of them are really outstanding.
 */
function redactionShortfall() {
  const claims = claimsFromExport();
  const labels = labelsFromSweep();
  const out = [];
  missShort = new Map();
  for (const [pk, list] of claims) {
    const covered = RD.coveredClaims(list, labels.get(pk) || []);
    const byGroup = new Map();
    list.forEach((c, i) => {
      if (!byGroup.has(c.group)) byGroup.set(c.group, { all: [], short: 0 });
      const g = byGroup.get(c.group);
      g.all.push(c);
      if (!covered[i]) g.short++;
    });
    for (const [gk, g] of byGroup) {
      if (!g.short) continue;
      missShort.set(gk, g.short);
      const why = whyNotFound(g.all[0], labels);
      for (const c of g.all) {
        out.push({ group: gk, src: c.src, page: c.page, real: c.real,
                   span: c.span, pageIndex: c.pageIndex,
                   want: g.all.length, got: g.all.length - g.short, why });
      }
    }
  }
  out.sort((a, b) => a.pageIndex - b.pageIndex);
  return out;
}

/**
 * Why the sweep could not find this one — so a miss is a fact rather than a
 * mystery. A check that only ever says "not found" teaches the operator
 * nothing, and the three answers below are the three real reasons.
 */
function whyNotFound(claim, labels) {
  const chars = sweptText.get(claim.src.name + "|" + claim.page);
  // The page is a picture. Nothing on it can be found by any key, and every
  // value the export puts here will be reported: that is one fact, not many.
  if (chars === 0) return "that PDF page carries no text at all — a scan or an image, so the key cannot reach anything on it";
  // It is boxed, but on another page: the export's page numbering and the
  // PDF's have come apart, which is worth knowing before marking anything.
  const need = RD.wordsOwed(claim.real, claim.fake);
  for (const [pk, list] of labels) {
    if (!pk.startsWith(claim.src.name + "|")) continue;
    const page = Number(pk.slice(pk.lastIndexOf("|") + 1));
    if (page === claim.page) continue;
    const pool = new Set();
    for (const l of list) for (const w of RD.valueWords(l)) pool.add(w);
    if (need.length && need.every((w) => pool.has(w))) {
      return `it IS boxed, but on PDF p. ${page} — this export's page numbers and the PDF's may not line up`;
    }
  }
  return chars == null
    ? "that PDF page was not swept — run “Mark from key” first"
    : "the PDF's own text on that page does not yield it: a ligature, a line break, an OCR spelling, or it is part of a picture";
}

/** How many values are really outstanding — what the bar counts. */
function missOutstanding() {
  let n = 0;
  for (const v of missShort.values()) n += v;
  return n;
}

/** Run the check and open the walk on what it found. */
function checkRedactionAgainstExport() {
  if (!doc) return;
  if (!reals) { toast("No pseudonym key is loaded — the export's pseudonyms cannot be read without one.", { error: true }); return; }
  reelAllLive(); // a shed page has no pseudonyms to claim anything
  missWalk = redactionShortfall();
  missAt = -1;
  if (!missWalk.length) {
    showMissRow(false);
    const marked = redactTotals().boxes;
    toast(marked
      ? "Every real value the export places on these pages is boxed. The hand still owns the signatures, the stamps and anything with no text under it."
      : "Nothing is marked yet — sweep from the key first.", { ms: 6000 });
    return;
  }
  goToMiss(0);
  // The count that matters is the VALUES outstanding, not the places to look:
  // it is what the bar shows and what the work actually is.
  const n = missOutstanding(), places = missWalk.length;
  toast(`${n} value${n === 1 ? "" : "s"} the export places on these pages ${n === 1 ? "was" : "were"} not found by the sweep` +
    (places > n ? `, somewhere among ${places} places it names` : "") +
    ". Walk them and mark what is really there by hand.", { ms: 8000 });
}

function showMissRow(on) {
  $("rb-miss-row").hidden = !on;
  if (!on) { missHere = null; paintMissHere(); }
  setBarHeight();
}

function goToMiss(i) {
  if (!missWalk.length) return;
  missAt = ((i % missWalk.length) + missWalk.length) % missWalk.length;
  const m = missWalk[missAt];
  showMissRow(true);
  $("rb-miss-count").textContent = `${missAt + 1} of ${missWalk.length}`;
  $("rb-miss-value").textContent = m.real;
  $("rb-miss-where").textContent =
    `${TD.pageLabel(doc.pages[m.pageIndex]) || "this page"} · PDF p. ${m.page}` +
    (pdfSourceNames().length > 1 ? ` of ${m.src.name}` : "") +
    (m.want > 1
      // …and the places LEFT to check, not the places there were: answering one
      // takes it off the list, and a row still naming the original count would
      // be counting somewhere the walk no longer goes.
      ? ` · ${m.want} here, ${m.got} boxed — ${missShort.get(m.group) || 1} still to find among ${missWalk.filter((x) => x.group === m.group).length} place${missWalk.filter((x) => x.group === m.group).length === 1 ? "" : "s"}`
      : "") +
    (m.why ? ` · ${m.why}` : "");
  findMissInText();
}

/** The text scrolled to the occurrence, the PDF pane carried to the same page. */
function findMissInText() {
  const m = missWalk[missAt];
  if (!m || !m.span.isConnected) return;
  const r = document.createRange();
  r.selectNodeContents(m.span);
  missHere = r;
  paintMissHere();
  scrollRangeTo(r);
  // The pane is held page for page with the text, so the PDF page this claim
  // is about comes alongside on its own — but only once the scroll lands.
  if (sbsOn) setTimeout(() => syncScroll("text", true), 350);
}

function paintMissHere() {
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
  if (missHere && missHere.startContainer.isConnected) CSS.highlights.set("redactmiss", new Highlight(missHere));
  else CSS.highlights.delete("redactmiss");
}

/**
 * One claim answered: struck off the walk and moved past.
 *
 * The walk is a list of QUESTIONS, not of defects, and there are two good
 * answers to each. Either the value really is on the page and has just been
 * boxed by hand — the signature, the letterhead, the stamp — or it is not
 * there at all, PDF-Linker having marked a page the value never printed on.
 * Both mean the same thing here: nothing further is owed on this one.
 *
 * It is a decision about this sitting, not about the file, so it lasts as long
 * as the marks do. A fresh sweep asks again.
 */
function accountForMiss(i) {
  if (i < 0 || i >= missWalk.length) return;
  const done = missWalk[i];
  const left = (missShort.get(done.group) || 1) - 1;
  let closed = 0;
  if (left > 0) {
    // More of this value is still unaccounted for on this page: this place is
    // answered, and the others are still worth a look.
    missShort.set(done.group, left);
    missWalk.splice(i, 1);
  } else {
    // The last one. Nothing is outstanding for this value on this page, so the
    // rest of its places go with it rather than being dismissed one by one — a
    // question already answered is not a question.
    missShort.delete(done.group);
    const before = missWalk.length;
    missWalk = missWalk.filter((m) => m.group !== done.group);
    closed = before - missWalk.length - 1;
  }
  updateRedactBar();
  if (!missWalk.length) {
    showMissRow(false);
    toast("Every value the export names is accounted for. What the key could not reach is marked or ruled out.", { ms: 6000 });
    return;
  }
  if (closed > 0) {
    toast(`“${done.real}” is dealt with on ${TD.pageLabel(doc.pages[done.pageIndex]) || "that page"} — the other ${closed} place${closed === 1 ? "" : "s"} there ${closed === 1 ? "was" : "were"} boxed by the sweep.`, { ms: 5000 });
  }
  goToMiss(Math.min(i, missWalk.length - 1));
}

/**
 * An area drawn on the very page the walk is standing on IS the answer to it:
 * that is the gesture the walk exists to prompt, and asking for a second click
 * to say so would be asking twice.
 */
function missAnsweredByBox(srcName, pageNumber) {
  if (missAt < 0 || $("rb-miss-row").hidden) return;
  const m = missWalk[missAt];
  if (!m || m.src.name !== srcName || m.page !== pageNumber) return;
  accountForMiss(missAt);
}

$("rb-check").addEventListener("click", checkRedactionAgainstExport);
$("rb-miss-done").addEventListener("click", () => accountForMiss(missAt));
$("rb-miss-prev").addEventListener("click", () => goToMiss(missAt - 1));
$("rb-miss-next").addEventListener("click", () => goToMiss(missAt + 1));
$("rb-miss-find").addEventListener("click", findMissInText);
$("rb-miss-close").addEventListener("click", () => showMissRow(false));


// ── the file as text ─────────────────────────────────────────────────────────────────
//
// Everything the reader does is a view: the fakes are shown as the REAL names,
// the lines are laid out as sheets, the margin numbers are given a ruled
// gutter of their own, the citations are underlined. That is the point of it.
// It is also the reason it is worth being able to see the file itself — because
// what goes to the court, to PDF-Linker, and to anyone the export is handed to
// is the bytes, not the view, and the two are meant to differ in exactly one
// way: the file carries the pseudonyms.
//
// So this is the file. Not a rendering of it — the same text a save writes,
// built the same way a save builds it (`serializeHeld` per page, which writes
// a pseudonym span's FAKE and never the real name it shows), through the same
// `serializeExport` that round-trips a document byte for byte. Opened on a
// document nobody has edited, what is on screen here is what is on the disk,
// character for character.
//
// WHERE THEY DIFFER IT SAYS SO. With edits not yet written the disk still
// holds the version before them, and the header says which this is. And a real
// value the key binds, typed in and not yet saved, stands here as itself —
// because it is what the document holds at this moment — with a line under it
// saying that a save would write the pseudonym instead. Both are the truth
// about a file that is in two states at once, which is a thing a reader should
// say rather than hide.
const rawModal = $("raw-modal");
const rawBtn = $("raw-btn");

/** One member's text exactly as a save would write it. */
function memberDiskText(m) {
  const pages = [];
  for (let i = m.from; i < m.from + m.count; i++) {
    // A page on screen is read off the page; one the reel has shed was read
    // off it as it was shed, and doc.pages has carried it since.
    const body = bodyForPage(i);
    const lines = body ? TD.serializeHeld(body).text.split("\n") : (doc.pages[i].lines || []);
    pages.push(Object.assign({}, doc.pages[i], { lines }));
  }
  return TD.serializeExport({ newline: m.newline, trailingNewline: m.trailingNewline, pages });
}

function showRawFile(on) {
  rawModal.hidden = !on;
  if (!on) return;
  const m = reelCurrent();
  if (!doc || !m) { rawModal.hidden = true; return; }
  const text = memberDiskText(m);
  $("raw-title").textContent = m.name;
  $("raw-text").textContent = text;
  $("raw-text").scrollTop = 0;
  $("raw-text").scrollLeft = 0;

  // What a reader of this ought to be told, in the order it matters.
  const notes = [];
  if (m.dirty) notes.push("● with your unsaved edits — the file on disk is still the version before them");
  const typed = reals ? PK.findReals(reals, TD.blankRanges(maskKept(text), TD.citedNameSpans(text))) : [];
  if (typed.length) {
    notes.push(`⚠ ${typed.length} real value${typed.length === 1 ? "" : "s"} the key binds stand${typed.length === 1 ? "s" : ""} here (${typed.slice(0, 3).map((w) => w.real).join(", ")}${typed.length > 3 ? "…" : ""}) — a save writes the pseudonym instead`);
  }
  $("raw-note").textContent = notes.join(" · ");

  const lines = text.length ? text.split(/\r\n|\n/).length : 0;
  const crlf = m.newline === "\r\n";
  $("raw-foot").textContent =
    `${lines.toLocaleString()} line${lines === 1 ? "" : "s"} · ${text.length.toLocaleString()} character${text.length === 1 ? "" : "s"} · ` +
    `${crlf ? "CRLF" : "LF"} line endings · UTF-8` +
    (m.trailingNewline ? " · ends with a newline" : " · no newline at the end") +
    (reel.length > 1 ? ` · this is ${m.name}, the document you are reading; the others on the reel are their own files` : "");
  $("raw-text").focus({ preventScroll: true });
}

rawBtn.addEventListener("click", () => showRawFile(true));
$("raw-close").addEventListener("click", () => showRawFile(false));
rawModal.addEventListener("mousedown", (e) => { if (e.target === rawModal) showRawFile(false); });
$("raw-wrap").addEventListener("change", (e) => rawModal.classList.toggle("wrap", e.target.checked));
$("raw-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("raw-text").textContent);
    toast("The file copied — pseudonyms and all, exactly as it sits on disk.");
  } catch { toast("The clipboard refused it — select the text and copy it by hand.", { error: true }); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !rawModal.hidden) { e.preventDefault(); showRawFile(false); }
}, true);

// ── hooks for the PWA tab shell ───────────────────────────────────────────────────────
// The shell hands a document in, and — where it opened a whole case folder —
// the folder with it: remembered first, so the document attaches its own key,
// its PDFs and its worksheet on the way up rather than asking to be shown the
// folder it plainly came from.
window.__textReaderLoadLocal = async (file, handle, dir) => {
  if (dir) { try { await rememberDir(dir); } catch (e) { console.warn(e); } }
  return openFile(file, handle);
};
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
window.__textReaderAdoptFolder = (h) => adoptFolder(h, { quiet: true });
window.__textReaderOpenDoc = (name) => { const d = folderDocs.find((x) => x.name === name); return d ? openFolderDoc(d) : null; };
window.__textReaderPickPdfs = (files) => usePickedPdfs(files);
window.__textReaderPdfSources = () => pdfSources.map((s) => (s ? s.name : null));
// The reel as it stands: which documents are hanging off it, how many pages
// each is carrying, and which of them have been shed. What a folder of long
// documents is actually holding, in one look.
window.__textReaderReel = () => ({
  members: reel.map((m) => ({ name: m.name, from: m.from, count: m.count, shed: !!m.shed, dirty: !!m.dirty })),
  at: reelAt, pages: doc ? doc.pages.length : 0, ceiling: { docs: reelMax(), pages: REEL_MAX_PAGES },
  held: !namesBar.hidden || !leaksBar.hidden || redactOn ? "a review is open: nothing is shed under one" : "",
});
window.__textReaderPdfQueue = () => ({
  queued: pdfJobs.map((j) => j.name),
  busy: pdfJobBusy,
  open: [...pdfCache.keys()].filter((n) => { const p = pdfCache.get(n); return !!(p && p.__info); }),
  // …and the window they are kept inside: what the reading has reached, what
  // an observer says is on screen, and which PDFs have left their page sizes
  // behind. A folder of three hundred should never show more than a handful
  // open, whatever it holds.
  inUse: [...pdfsInUse()],
  near: PS.pdfsNear(pdfSources, readingPage(), PDF_REACH, PDF_NEAR),
  inView: [...pdfInView],
  sized: [...pdfSizes.keys()],
  // …and what the ceilings are made of: the bytes the open ones weigh
  // against the budget, and the pages drawn against the cap.
  bytes: [...pdfCache.keys()].reduce((t, n) => t + pdfSize(n), 0),
  budget: PDF_BYTES,
  drawn: drawnSlots.size,
  drawnMax: DRAWN_MAX,
  releasing: pagesToRelease.size,
});
// …and what has been drawn ahead of the review: the pages held ready, the
// ones being drawn now, and the exports read ahead of the hop to them.
window.__textReaderWarm = () => ({
  held: [...warmPages.keys()], drawing: [...warmBusy], wanted: [...warmWanted],
  docs: { wanted: readyWanted.slice(), built: [...ready.values()].filter((e) => e.nodes).map((e) => e.name), skipped: [...ready.values()].filter((e) => e.skipped).map((e) => e.name + ": " + e.skipped), busy: readyBusy },
  // The walk: the documents the rows stand in, and the ones the reader will
  // go as far as fetching from — one at a time in a big folder.
  walk: { files: LK.leakFileOrder(leakRows(), leaks ? leaks.at : 0), window: leakFileWindow(), oneAtATime: oneDocAtATime() },
});
window.__textReaderMaster = (bytes, name) => readMasterBytes(new Uint8Array(bytes), name);
window.__textReaderMasterState = () => ({
  info: masterInfo, keeps: masterKeeps.map((k) => k.control + ":" + k.value),
  needs: !!masterNeeds, seen: [...keptSeen],
});

// An error nobody caught used to be a reader that simply stopped where it was
// — a document half open, the empty screen still up, and nothing said. It is
// said now: the message goes in the bar, where it can be read back to whoever
// has to fix it, and the console still has the stack.
window.addEventListener("error", (e) => {
  console.error(e.error || e.message);
  toast("Something went wrong: " + ((e.error && e.error.message) || e.message || "unknown error") + " — the console has the details.", { error: true });
});
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  console.error(r);
  toast("Something went wrong: " + ((r && r.message) || r || "unknown error") + " — the console has the details.", { error: true });
});

// ── boot ───────────────────────────────────────────────────────────────────────────────────
reportLastStuck();
applySettings();
loadSyncedSettings();
showSidePanel(sideChoice === true);
fillKeys("");
// The most recent key is offered on a lone file straight away: a folder pick
// replaces it with the folder's own.
{
  const lib = keyLibrary();
  const ids = keyIds(lib);
  if (ids.length) { keySelect.value = ids[0]; setKey(lib[ids[0]]); }
}
updateDirty();
renderFlags();
renderLeaksTab();
updateLeaksButton();
// The master workbook's standing keeps, in force before the first document is
// read — the whole point of them is that nobody has to be asked again.
restoreMaster();
