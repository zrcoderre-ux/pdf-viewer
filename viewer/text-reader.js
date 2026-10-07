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
import { dressColumns, alignColumns, charWidth, fitCells } from "./columns.js";
import * as PS from "./pdfsync.js";
import * as LK from "./leaks.js";
import { keyLibrary, storeKey, fillKeySelect, keyIds } from "./key-library.js";
import * as RD from "./redact.js";
import { buildRedactedPdf } from "./pdf-edit.js";
import * as XW from "./xlsx-write.js";
import * as pdfjsLib from "../pdfjs/build/pdf.mjs";
import { fontDocument, fontCanvas, renderPageOnto, pageOutputScale, watchPixelRatio } from "./pdf-fonts.js";
import { repairTextLayer } from "./text-layer.js";

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
// Pages built OFF the screen: a hidden container on the page but outside
// #pages, where a document that is not on the reel is built a page at a time
// so the reader's own page code — the replace, the typed-name pass, the save's
// forward pass — runs on it exactly as it runs on a page on screen. On the
// page because convertTypedReals refuses a body that is not connected; outside
// #pages because nothing that walks the pages on screen may meet it.
const shadowEl = $("shadow-pages");
/** Whether a page body is one built off the screen (shadowPage). */
function isShadow(body) { return !!body && !!shadowEl && shadowEl.contains(body); }
// …and the key walk's, under Find.
const keyBar = $("key-bar");

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
// …and the keeps WITHDRAWN since, whose lines the folder's file may still
// carry: never read back in from it (noteWithdrawn).
const WITHDRAWN_PREFIX = "textReader.keepsWithdrawn.";
const SPOTS_PREFIX = "textReader.spots.";

let doc = null;              // TD.parseExport result
let fileName = "";
let fileHandle = null;       // FileSystemFileHandle for in-place save
let openedFile = null;       // the File the open document was read from (__textReaderSource)
let dirHandle = null;        // the case folder, when one was opened
let folderName = "";
let folderDocs = [];         // [{ name, handle, quarantined }]
let folderLight = false;     // …attached for its key alone, the whole folder having taken the reader down last time
// THE WHOLE FOLDER IS THE DEFAULT, UNTIL IT CRASHES. A file opened from a case
// folder the reader knows brings the whole folder with it — the other exports,
// their PDFs, the reel, the sweep — as it always did. A session that went down
// holding a whole folder says so at the next open (reportLastStuck, off the
// breadcrumb's `whole`), and from then on a file comes in on its own, with the
// key, and the reader ASKS before reading the rest. Choosing the whole folder
// again (the offer, or "Read the whole folder" in Documents) goes back to the
// default; if it goes down again, the next open is asking again.
const ASK_FOLDER_KEY = "textReader.askFolder";
function askBeforeFolder() { try { return !!localStorage.getItem(ASK_FOLDER_KEY); } catch { return false; } }
function setAskBeforeFolder(on) {
  try { if (on) localStorage.setItem(ASK_FOLDER_KEY, "1"); else localStorage.removeItem(ASK_FOLDER_KEY); } catch { /* no storage: the default stands */ }
}
let folderPdfs = [];         // [{ name, handle }] — the case folder's PDFs
let key = null;              // parsed key (PK.parseKey)
let rev = null, fwd = null, reals = null, ahead = null; // compiled matchers
let fakesRx = null;          // …and one over the key's FAKES: which pseudonyms stand
let settings = loadSettings();
let flagged = [];            // New Real Values list: names to fake next run
let pageSweep = null;        // the page a LEAKS review is finishing before it leaves (see advanceLeak)
let flagsFor = null;         // …the storage key that list was read from, while a folder is being adopted
let keyFolder = null;        // …the storage key of the list the key in hand was read from or chosen for; null, none (TD.keyAnswersFlags)
let phrases = [];            // …which of them are PHRASES: several words faked whole (`phrase:`)
let keeps = [];              // …and the keeps: values wrongly faked, left alone next run
let noOcr = [];              // …and the pages marked ⊘ Did not OCR: [{ doc, pdf, page }] (syncNoOcr)
let ocrAgain = [];           // …and the pages to read again, ↻ OCR This Page (ocrPageAgain)
let textFixed = [];          // …and the pages transcribed by hand, ✎ Use my text: [{ doc, pdf, page, sum }] (useMyText)
let spots = [];              // spot keeps for the open document: [{ page, value, nth }]
let masterKeeps = [];        // standing keeps from PDF-Linker's master workbook (its KEEP sheet)
let masterInfo = null;       // { name, sheet, rows, partial } once it is attached
let masterHandle = null;     // its file handle, remembered between sessions
let masterNeeds = null;      // …the same handle, when the browser wants it re-authorised first
let masterLost = null;       // …or its name, where the remembered workbook could not be read at all (masterUnread)
let dirty = false;
// ── the folder's unsaved documents ──
// A document of a case folder that has been edited and then left — another
// document opened, the find walk gone on, a folder-wide Replace all — keeps
// its edits HERE, as the file Save would write, until Save writes it. A
// document's unsaved text is in exactly one place at a time: on the reel (its
// pages on screen, its member dirty) or in this store. See "Unsaved documents
// and the folder save" in the design notes.
let unsavedDocs = new Map();   // export name → { name, d, handle, base, doc, spots, built, seq, conflict }
let unsavedSeq = 0;            // bumped on every change to the store
let saving = false;            // a save is running: nothing opens, replaces or undoes under it
let savePass = null;           // …its pass over documents off the screen, while one runs: { stop }
let saveNote = "";             // …and what the status bar says it is doing
let saveTouched = null;        // …the members its forward pass changed, and those it wrote: { touched, wrote }
let folderPass = null;         // a folder-wide Replace all being prepared: { stop }
let seenDocs = new Set();      // the documents opened or hung on the reel this session
let confirmedDocs = new Set(); // …and the ones a confirm has already named
let replaceJournal = [];       // the folder-wide replaces the reader holds, oldest first
let masterPending = [];        // values the Master Keep workbook would not let go of: owed to the next save
let masterRestoring = null;    // …the workbook's reading at startup (restoreMaster), awaited before a question is put to it
let valuesSpentNote = "";      // what the last write of New Real Values.txt retired that the master does not hold, for the save's toast
const rawPages = new Set();  // the page sections shown as the file has them, ⇄ Raw (setRaw)
let place = null;            // where the reading is, as last noted: { el, frac, sec, secFrac } (readingPlace)
let placeHold = null;        // …and the hold keeping it there through a re-layout, while one is (holdReading)

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
// …and WHAT IT WAS CARRYING while it did, which is the other half of the
// answer: the pass that did not come back means little without the pages, the
// PDFs and the rows it was holding when it went. Read at most every
// CARRYING_EVERY, since asking costs a walk over the column, and kept as a
// string so writing the breadcrumb stays one setItem.
const CARRYING_EVERY = 2000;
let carrying = "", carriedAt = 0;
function noteCarrying(force) {
  const now = Date.now();
  if (!force && now - carriedAt < CARRYING_EVERY) return carrying;
  carriedAt = now;
  try { carrying = holding(); } catch { carrying = ""; }
  return carrying;
}
function markDoing() {
  try {
    const top = doingStack[doingStack.length - 1];
    if (top) localStorage.setItem(DOING_KEY, JSON.stringify({ what: top.what, file: fileName || "", at: Date.now(), carrying: noteCarrying(), whole: !!dirHandle && !folderLight }));
    else localStorage.removeItem(DOING_KEY);
  } catch { /* a browser with no storage says nothing, and that is all */ }
}
// Passes that await overlap rather than nest, so an entry is taken out by
// identity, not by being the last one in.
function startDoing(what) { const e = { what, from: performance.now() }; doingStack.push(e); markDoing(); return e; }
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
/** A line in the offer bar with a button that puts it on the clipboard. */
function offerToCopy(line) {
  showKeyOffer(line, "Copy", async () => {
    try { await navigator.clipboard.writeText(line); toast("On the clipboard."); }
    catch { toast("The clipboard would not take it.", { error: true }); }
  });
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
  // Down with the whole of a case folder open: the next file asks first. A
  // breadcrumb from before `whole` was written cannot say, and is taken as yes.
  if (stuck && stuck.what && stuck.whole !== false) setAskBeforeFolder(true);
  if (!stuck || !stuck.what) {
    console.info("[Text Reader] opened; the last session closed cleanly (nothing left unfinished).");
    return;
  }
  // FIRST, IN THE CONSOLE. A pass that never came back could not report
  // itself — the observer runs after a task, and a task that hangs the tab
  // until the browser kills it never has an after. This line is written at
  // the next OPEN instead, when the thread is free, so a tab that died still
  // says what it died in, and says it somewhere that can be copied.
  console.warn(`[Text Reader] LAST SESSION DID NOT FINISH: it stopped while ${stuck.what}` +
    (stuck.file ? ` — ${stuck.file}` : "") +
    (stuck.carrying ? ` · carrying ${stuck.carrying}` : "") +
    (stuck.at ? ` · ${Math.round((Date.now() - stuck.at) / 1000)}s ago` : ""));
  // Not a toast: a toast is gone in a few seconds and under the document, and
  // this is the one line that says what to fix. It stands in the offer bar
  // until it is read, and the button puts it on the clipboard.
  offerToCopy(`Last time, the reader stopped while ${stuck.what}${stuck.file ? " — " + stuck.file : ""}, and did not finish.`);
}
function passAt(start, end) {
  let best = "";
  for (const p of passes) if (p.from <= end && p.to >= start) best = p.what;
  return best;
}
/**
 * The passes RUNNING while a task held the thread.
 *
 * `passes` holds the ones that finished, and a pass records itself when it
 * finishes — so a task that ran inside a pass still in flight matched nothing
 * and was reported as somebody else's. On a reader whose heavy work is async
 * by design that is most of them, and it sent an operator looking for an
 * extension that was not there. The stack of what is open answers it: what
 * was running when the task started, and how long each had been running.
 */
function passesInFlight(start) {
  const out = [];
  for (const e of doingStack) {
    if (!e || !e.what) continue;
    if (e.from != null && e.from > start) continue; // it began after the task did
    out.push(`${e.what} (${((start - (e.from || start)) / 1000).toFixed(1)}s in)`);
  }
  return out;
}
// …AND IT SAYS SO IN THE CONSOLE, WHERE IT CAN BE COPIED.
//
// The report has always been there to ask for (__textReaderBlocked), which is
// no use to somebody whose tab is the thing that has stopped answering — and
// asking an operator to type a function call into a console is asking them to
// diagnose it themselves. A tab that holds now writes a line per hold, with
// the pass that did it and what the reader was carrying at the time, so the
// console they can already copy says which of the two kinds it is: a pass of
// the reader's own, which is ours to fix, or a task with no pass of ours
// anywhere in it — something else on the page, an extension most often.
const HOLD_SAY = 300;      // ms a task has to hold before it is worth a line
const HOLD_QUIET = 1500;   // …and how long the console is left alone after one
let heldSaidAt = 0, heldSince = 0, heldRuns = 0;
function sayHeld(ms, what, inFlight) {
  heldSince += ms;
  heldRuns++;
  const now = Date.now();
  if (now - heldSaidAt < HOLD_QUIET) return;
  heldSaidAt = now;
  const runs = heldRuns > 1 ? ` (${heldRuns} holds, ${(heldSince / 1000).toFixed(1)}s in all)` : "";
  heldSince = 0;
  heldRuns = 0;
  const open = inFlight && inFlight.length ? `in flight: ${inFlight.join(", ")}` : "";
  const who = what || open ||
    "no pass of the reader's own was running or open — something else on the page";
  console.warn(`[Text Reader] held the thread ${ms} ms — ${who}` +
    (what && open ? ` · ${open}` : "") + runs + ` · ${holding()}`);
}
/** What the reader is carrying, for the line above: the sizes that explain it. */
function holding() {
  const live = pagesEl ? pagesEl.querySelectorAll(".tpage:not(.shed)").length : 0;
  const all = pagesEl ? pagesEl.querySelectorAll(".tpage").length : 0;
  const open = [...pdfCache.keys()].filter((n) => { const p = pdfCache.get(n); return !!(p && p.__info); }).length;
  const mem = performance.memory ? `, ${Math.round(performance.memory.usedJSHeapSize / 1e6)} MB of js` : "";
  return `${live} of ${all} pages live, ${reel.length} on the reel, ${open} PDF${open === 1 ? "" : "s"} open, ` +
    `${drawnSlots.size} drawn, ${ready.size} read ahead${mem}` +
    (leaks ? `, LEAKS ${leakRows().length} rows` : "") + (key ? `, key ${key.pairs.length}` : ", no key");
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
        if (ms >= HOLD_SAY) sayHeld(ms, what, passesInFlight(e.startTime));
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch { /* a browser that does not report them */ }
}
/** Every long task since the page was opened, worst first — for a bug report. */
window.__textReaderBlocked = () => blocked.slice().sort((a, b) => b.ms - a.ms);
/** …and what it was carrying, the line the holds are reported with. */
window.__textReaderHolding = () => holding();
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

// The grid an export's columns are laid out on (columns.js): its character is
// the reader font's own average one, and its space the font's own, measured
// again whenever the font changes or a font it names finishes loading.
function setColumnWidth() {
  const w = charWidth(TD.fontCss(settings));
  const root = document.documentElement.style;
  root.setProperty("--col-n", w.char.toFixed(4));
  root.setProperty("--col-sp-n", w.space.toFixed(4));
}
if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", () => setColumnWidth());

function applySettings() {
  const root = document.documentElement.style;
  root.setProperty("--reader-font", TD.fontCss(settings));
  setColumnWidth();
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
  // While the reader is typing a zoom, nothing overwrites it.
  if (document.activeElement !== sizeLabel) sizeLabel.value = Math.round(zoomNow() * 100) + "%";
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
// The percentage between them is a field as well as a label: type a number
// ("150", "150%"), Enter applies it (held to 25–500%), Escape or leaving the
// field puts back the zoom in force.
sizeLabel.addEventListener("focus", () => sizeLabel.select());
sizeLabel.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const pct = parseFloat(String(sizeLabel.value).replace(/[%\s]/g, ""));
    if (Number.isFinite(pct) && pct > 0) zoomTo(pct / 100);
    sizeLabel.blur();
  } else if (e.key === "Escape") {
    e.preventDefault();
    sizeLabel.blur();
  }
});
sizeLabel.addEventListener("blur", () => { sizeLabel.value = Math.round(zoomNow() * 100) + "%"; });

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
  zoomTo(step === 0 ? 1 : zoomNow() * Math.pow(1.1, step));
}
/** The zoom set to `z` (1 is 100%), held to 25–500% — a step's, or one typed. */
function zoomTo(z) {
  const next = Math.min(5, Math.max(0.25, Math.round(z * 100) / 100));
  if (Math.abs(next - zoomNow()) < 0.001) return;
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
        const { text, held, pns } = TD.serializeHeld(body);
        const fw = forwardText(text, held, pns);
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
  // A page shown as the file has it is read again off its scrubbed text: a
  // name the run missed stands in the file's text too.
  refreshRawPages();
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
  shapePages({ all: true }); // every page, not only the ones the reading is at

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

// ── screenshot ───────────────────────────────────────────────────────────────
// The whole window as it stands, for looking at the design: the toolbar, the
// panels, the bars, the PDF pane, the pages — what the eye gets, saved as a
// PNG. Not the print: the print is the pages alone.
//
// BUT IN ITS PSEUDONYMS, like the print. A screenshot is taken to be shown to
// somebody, and a picture of the screen with Show fakes off is a picture of
// the real names. So for the moment of the capture every real name the key
// binds that is on screen is shown as its fake, whichever way the toggle sits
// (fakesForShot), and the screen goes back the moment the picture is taken.
// It is the forward pass the save and the print make, with the same
// exceptions — the values kept for the case, the spot keeps and the parties
// of cited decisions read as they stand — and it reaches what the print never
// shows: the bars, the panels, the shell's tabs and the PDF pane, whose PDF is
// the filing itself and was never scrubbed.
//
// In the extension the background worker takes the tab (captureVisibleTab), no
// questions asked. Hosted, there is no such thing, so the browser's own screen
// share is asked for this tab, one frame is kept and the share is stopped —
// asked of the shell above the reader's iframe, the shell being the window.
// The names change only once the share is granted: a share declined leaves
// the screen exactly as it was.
function shotName() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const when = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}`;
  return `${doc ? printTitle() : "Text Reader"} - screenshot ${when}.png`;
}

/** Whether the extension's background worker is there to take the tab. */
function extensionShoots() {
  return typeof chrome !== "undefined" && !chrome.__pwaShim && !!(chrome.runtime && chrome.runtime.sendMessage);
}

/** The tab through the extension's background worker: a PNG blob, or null. */
async function shotByExtension() {
  const dataUrl = await new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "capture-visible-tab" }, (res) => {
        const err = chrome.runtime.lastError;
        resolve(!err && res && res.dataUrl ? res.dataUrl : null);
      });
    } catch { resolve(null); }
  });
  return dataUrl ? (await fetch(dataUrl)).blob() : null;
}

/**
 * This tab through the browser's screen share, asked for now: answers how to
 * take one frame of it (a PNG blob, the share stopped after), or null where
 * the browser has no screen share.
 */
async function shareThisTab() {
  let host = window;
  try { if (window.top !== window && window.top.navigator.mediaDevices) host = window.top; } catch { /* another origin above */ }
  const md = host.navigator.mediaDevices;
  if (!md || !md.getDisplayMedia) return null;
  const stream = await md.getDisplayMedia({ video: { displaySurface: "browser" }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include" });
  return async () => {
    try {
      const video = document.createElement("video");
      video.muted = true;
      video.srcObject = stream;
      // A share that never sends a frame is given up on: the fakes are on the
      // screen until this answers, and typing is held off with them.
      await Promise.race([
        video.play(),
        new Promise((_, no) => setTimeout(() => no(new Error("the screen share sent no picture")), 5000)),
      ]);
      // The share dialog has only just closed; give the tab a moment to be drawn without it.
      await new Promise((r) => setTimeout(r, 300));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const c = document.createElement("canvas");
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext("2d").drawImage(video, 0, 0);
      return await new Promise((r) => c.toBlob(r, "image/png"));
    } finally {
      for (const t of stream.getTracks()) t.stop();
    }
  };
}

let shotPut = null; // while a screenshot is being taken: how the screen goes back

/** An element within `margin` screens of the window, above or below. */
function nearWindow(rect, margin) {
  const h = window.innerHeight;
  return rect.width > 0 && rect.bottom > -h * margin && rect.top < h * (1 + margin);
}

/**
 * The screenshot's edits, made in the text nodes themselves and undone the
 * same way. Nothing is rebuilt: the lines, the columns and the grid stand as
 * they are. The new text goes in AHEAD of the old before the old comes out,
 * so a live range over the old — a leak's orange, a find — ends up over the
 * new, both ways: the picture shows the page marked as it is, and the marks
 * are still standing when the names come back. `edits` holds each as
 * [node, at, put in, taken out], in the order made.
 */
function shotEdit(edits, n, at, put, cut) {
  n.insertData(at, put);
  n.deleteData(at + put.length, cut.length);
  edits.push([n, at, put, cut]);
}
function undoShotEdits(edits) {
  // A node changed since (rewritten by the reader itself) is left as it is now.
  const now = new Map();
  for (const [n] of edits) if (!now.has(n)) now.set(n, n.data);
  const done = new Map(edits.map(([n]) => [n, now.get(n)]));
  for (let i = edits.length - 1; i >= 0; i--) {
    const [n, at, put, cut] = edits[i];
    if (n.data !== done.get(n)) continue;
    n.insertData(at, cut);
    n.deleteData(at + cut.length, put.length);
    done.set(n, n.data);
  }
}

/**
 * `swaps` ([{ start, end, to }] into the text `segs` was read as) made in the
 * text nodes, last first so the places before each still hold.
 */
function swapInNodes(segs, swaps, edits) {
  for (let k = swaps.length - 1; k >= 0; k--) {
    const s = swaps[k];
    let first = true;
    for (const g of segs) {
      const from = Math.max(s.start, g.start), to = Math.min(s.end, g.end);
      if (to <= from) continue;
      const n = g.node;
      const p = n.parentElement;
      if (p && p.closest(".pn, [data-here]")) continue; // a pseudonym, or a spot keep: not this pass's
      const put = first ? s.to : "";
      first = false;
      shotEdit(edits, n, from - g.start, put, n.data.slice(from - g.start, to - g.start));
    }
  }
}

/**
 * The window's own words — the bars, the panels, the lists, the status line,
 * the shell's tabs — with every real name in them as its fake, and the text
 * typed into its boxes. The pages are not read here (fakesForShot reads them
 * whole, which the citations need), and neither is anything hidden.
 */
function swapChrome(root, edits, fields) {
  const skip = ".page-body, .textLayer, script, style, [hidden]";
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.nodeType === 1
      ? (n.matches(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP)
      : (/\p{L}/u.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  for (const n of nodes) {
    const swaps = forwardSwaps(n.data);
    if (swaps.length) swapInNodes([{ node: n, start: 0, end: n.data.length }], swaps, edits);
  }
  for (const el of root.querySelectorAll("input, textarea")) {
    if (!(el.tagName === "TEXTAREA" || el.type === "text" || el.type === "search") || !el.value || el.closest("[hidden]")) continue;
    const fw = forwardText(el.value);
    if (!fw.swaps) continue;
    fields.push([el, el.value, fw.text]);
    el.value = fw.text;
  }
}

/**
 * Where a PDF page's real names stand, each with the fake to paint over it.
 *
 * The PDF is the filing, and nothing ever scrubbed it, so its names are read
 * where they stand in the page's own text layer, the way the redaction's key
 * sweep reads them (keyBoxesForPage). A page with no text — a scan — has
 * nothing to read, and keeps its names. Measuring only; coverPdfNames paints.
 */
function pdfNamesOn(sheet) {
  const layer = sheet.querySelector(".textLayer");
  const spans = layer ? layer.querySelectorAll("span") : [];
  if (!spans.length) return null;
  const { text, map } = RD.pageTextFromSpans(RD.measureSpans(layer));
  const swaps = forwardSwaps(text);
  if (!swaps.length) return null;
  const base = sheet.getBoundingClientRect();
  const out = [];
  for (const s of swaps) {
    const r = RD.spanRangeFor(map, s.start, s.end);
    const a = r && spans[r.startSpan], b = r && spans[r.endSpan];
    const an = a && a.firstChild, bn = b && b.firstChild;
    if (!an || !bn) continue;
    const range = document.createRange();
    try {
      range.setStart(an, Math.min(r.startOffset, an.length || 0));
      range.setEnd(bn, Math.min(r.endOffset, bn.length || 0));
    } catch { continue; }
    const local = [];
    for (const cr of range.getClientRects()) {
      if (cr.width > 0.5 && cr.height > 0.5) local.push({ x: cr.left - base.left, y: cr.top - base.top, w: cr.width, h: cr.height });
    }
    const cs = getComputedStyle(a);
    const rects = RD.mergeRects(local, 2);
    if (rects.length) out.push({ rects, to: s.to, font: cs.fontFamily, size: parseFloat(cs.fontSize) || 0 });
  }
  return out.length ? { sheet, names: out } : null;
}
/**
 * …and each painted over: a white box a pixel past the name all round, the
 * fake in it in the text layer's own type, drawn narrower where it is longer
 * than the name, the way pdf.js fits its own text to the page. Under the
 * redaction's boxes, which stay to be seen. Answers the layer, to be taken off.
 */
function coverPdfNames({ sheet, names }) {
  const box = document.createElement("div");
  box.className = "shot-covers";
  for (const n of names) {
    n.rects.forEach((m, k) => {
      const c = document.createElement("div");
      c.className = "shot-cover";
      c.style.left = (m.x - 1) + "px";
      c.style.top = (m.y - 1) + "px";
      c.style.width = (m.w + 2) + "px";
      c.style.height = c.style.lineHeight = (m.h + 2) + "px";
      c.style.fontFamily = n.font;
      c.style.fontSize = (n.size || m.h * 0.85) + "px";
      // A name the PDF wrapped is one name: its fake on the first line, the rest covered.
      if (k === 0 && n.to) {
        const t = document.createElement("span");
        t.textContent = n.to;
        c.appendChild(t);
      }
      box.appendChild(c);
    });
  }
  sheet.appendChild(box);
  return box;
}

/**
 * Every real name the key binds that is on screen, shown as its fake for the
 * picture; answers how to put the screen back.
 *
 * The pages near the window, not all of them: the picture holds a screen of
 * them, and the forward pass over a long reel is seconds. Their pseudonym
 * spans show the fake, as Show fakes would, and a real name standing in the
 * clear is written over in its text node; the citation underlines are laid
 * again over the words as they now read. The document is not touched — no
 * undo step, nothing dirty, nothing written — and typing is held off until
 * the screen is back.
 */
function fakesForShot() {
  hideTip();
  if (!key || shotPut) return () => {};
  // The Pages tab's pictures are pictures: no fake reaches into one, so they
  // are blurred for the shot.
  document.body.classList.add("shot-taking");
  const edits = [];  // see shotEdit
  const fields = []; // [input, its value, the value faked]
  const showed = document.body.classList.contains("show-fakes");
  const sel = window.getSelection();
  const caret = sel && sel.rangeCount ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset] : null;

  // Every page measured before any is written: one layout, not one a page.
  const near = [...pagesEl.querySelectorAll(".tpage:not(.shed)")].filter((sec) => nearWindow(sec.getBoundingClientRect(), 1));
  for (const sec of near) {
    const body = sec.querySelector(".page-body");
    if (!body) continue;
    for (const s of body.querySelectorAll(".pn")) {
      const t = s.firstChild;
      if (s.childNodes.length !== 1 || t.nodeType !== 3 || t.data === s.dataset.fake) continue;
      shotEdit(edits, t, 0, s.dataset.fake, t.data);
    }
    if (fwd && fwd.rx) {
      // The names the marks show, read as the save reads them: the disk text,
      // its fakes and spot keeps blanked, put back through its text nodes.
      const disk = TD.serializeHeld(body, { mapped: true });
      swapInNodes(disk.segs, forwardSwaps(disk.text, disk.held, disk.pns), edits);
    }
  }
  document.body.classList.add("show-fakes");
  const pagesMoved = edits.length > 0;
  const relink = pagesMoved && !gridOn();
  if (relink) placeCitations();

  if (fwd && fwd.rx) {
    swapChrome(document.body, edits, fields);
    try { if (window.top !== window && window.top.document.body) swapChrome(window.top.document.body, edits, fields); } catch { /* another origin above */ }
  }
  const plans = fwd && fwd.rx
    ? [...document.querySelectorAll(".pdf-sheet")].filter((s) => nearWindow(s.getBoundingClientRect(), 0)).map(pdfNamesOn).filter(Boolean)
    : [];
  const covers = plans.map(coverPdfNames);
  // A fake longer than its box: read every one, then write.
  const fits = [];
  for (const c of covers) for (const t of c.querySelectorAll(".shot-cover > span")) fits.push([t, t.parentElement.clientWidth / (t.offsetWidth || 1)]);
  for (const [t, f] of fits) if (f < 1) t.style.transform = `scaleX(${f})`;

  const back = () => {
    shotPut = null;
    document.body.classList.remove("shot-taking");
    for (const c of covers) c.remove();
    for (const [el, v, f] of fields) if (el.value === f) el.value = v;
    undoShotEdits(edits);
    document.body.classList.toggle("show-fakes", showed);
    const touched = new Set(edits.map(([n]) => n));
    if (caret && (touched.has(caret[0]) || touched.has(caret[2])) && caret[0].isConnected && caret[2].isConnected) {
      try { sel.setBaseAndExtent(...caret); } catch { /* moved on */ }
    }
    if (pagesMoved) {
      // Anything that read the pages while they were faked read the wrong
      // words: read again. The marks still standing stand until it has.
      afterTextChange();
      if (relink) placeCitations(); // …and the underlines go back under the real names now, not in a beat
    }
  };
  shotPut = back;
  return back;
}

/** One picture taken with the names in their pseudonyms, and the screen put back. */
async function withFakes(take) {
  const back = fakesForShot();
  try {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return await take();
  } finally { back(); }
}

function saveShot(blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = shotName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

let shooting = false;
$("shot-btn").addEventListener("click", async (e) => {
  e.currentTarget.blur(); // no focus ring on the button in the picture
  if (shooting) return;
  shooting = true;
  try {
    let blob = extensionShoots() ? await withFakes(shotByExtension) : null;
    if (!blob) {
      const take = await shareThisTab();
      if (take) blob = await withFakes(take);
    }
    if (!blob) { toast("This browser cannot take a screenshot of the page.", { error: true }); return; }
    saveShot(blob);
    toast(key ? "Screenshot saved to Downloads, the names in their pseudonyms." : "Screenshot saved to Downloads.");
  } catch (err) {
    if (err && err.name === "NotAllowedError") return; // the share was declined
    toast(`The screenshot failed: ${(err && err.message) || err}`, { error: true });
  } finally { shooting = false; }
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
  if (on && pagesStale) renderPagesTab();
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
const SIDE_TABS = [["tab-docs", "side-docs"], ["tab-pages", "side-pages"], ["tab-flags", "side-flags"], ["tab-leaks", "side-leaks"]];
function showSideTab(tab) {
  for (const [t, b] of SIDE_TABS) {
    const on = t === tab;
    $(t).classList.toggle("active", on);
    $(t).setAttribute("aria-pressed", String(on));
    $(b).hidden = !on;
  }
  if (tab === "tab-pages") renderPagesTab(); // drawn only while it is in sight (pagesTabSoon)
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
function keptMatcher() {
  const held = heldPhrases();
  if (!held.length) return keptMarkMatcher();
  if (maskMemo.keeps !== keeps || maskMemo.master !== masterKeeps || maskMemo.key !== key || maskMemo.phrases !== phrases || maskMemo.flagged !== flagged) {
    const mine = allKeeps().filter((k) => keyBinds(k.value)).map((k) => k.value);
    maskMemo = { keeps, master: masterKeeps, key, phrases, flagged, values: mine.concat(held), rx: PK.buildMatcher(mine.concat(held)) };
  }
  return maskMemo.rx;
}
// …and a flagged PHRASE the key binds only part of. The words go to PDF-Linker
// to be faked WHOLE, so a save must not fake the one word it knows on its own
// first: the file would carry "Cross Zed Bank", and the pass that fakes the
// phrase would find nothing left to fake. So the phrase is held in the clear
// the way a keep is — not faked by the save, not counted as a leak, not
// refused by the save's last check — and wears the red mark of any flag, until
// the key comes back with the whole phrase in it (dropFlagsNowFaked).
let maskMemo = { keeps: null, master: null, key: null, phrases: null, flagged: null, values: null, rx: null };
function heldPhrases() {
  if (!phrases.length || !key) return [];
  return phrases.filter((v) => TD.isPhrase(flagged, v) && keyBinds(v) && !TD.fakeFor(fwd, v));
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
let keptMarkMemo = { keeps: null, master: null, key: null, values: null, rx: null };
function keptMarkMatcher() {
  if (keptMarkMemo.keeps !== keeps || keptMarkMemo.master !== masterKeeps || keptMarkMemo.key !== key) {
    const mine = allKeeps().filter((k) => keyBinds(k.value)).map((k) => k.value);
    keptMarkMemo = { keeps, master: masterKeeps, key, values: mine, rx: mine.length ? PK.buildMatcher(mine) : null };
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
/**
 * `text` with every kept value blanked, the same length out as in. With
 * `layout` — the text as it stands, where `text` has things blanked out of it
 * — a kept value wrapped down a column is blanked too, piece by piece: kept as
 * the whole name, it is not left to be found again by its own surname token.
 */
function maskKept(text, layout) {
  const rx = keptMatcher();
  if (!rx) return text;
  const out = text.replace(rx, (m) => "\u0000".repeat(m.length));
  if (layout == null) return out;
  const cols = PK.findColumnSpans(keptCompiled(), out, layout);
  return cols.length ? TD.blankRanges(out, cols.flatMap((h) => h.ranges)) : out;
}
// The kept values as a key the column reading can look a match up in.
let keptColMemo = { rx: null, compiled: null };
function keptCompiled() {
  const rx = keptMatcher();
  if (keptColMemo.rx !== rx) {
    const values = (rx === maskMemo.rx ? maskMemo.values : keptMarkMemo.values) || [];
    keptColMemo = { rx, compiled: { rx, map: new Map(values.map((v) => [PK.fold(v), { real: v, fake: "" }])) } };
  }
  return keptColMemo.compiled;
}
/**
 * A page's DISK text read the way its marks read it — flatten with blankPn,
 * and the folder sweep's TD.clearReading: the run's pseudonyms (`pns`) and the
 * spot keeps (`held`) blanked to spaces, and the names of cited decisions
 * found in what is left. → { flat, blank, cited }
 *
 * The save used to read the text with the fakes standing in it, and so
 * disagreed with the orange marks both ways. A real the key binds that is a
 * word of a fake ("Volunteers" in a fake "Volunteers of Columbia") was a name
 * the save found and the page never marked: it warned about a name no walk
 * could reach, and once the name was decided it wrote a pseudonym into the
 * middle of the fake. And a fake beside an orange name could make the two read
 * as a cited decision's name ("Volunteers v. Quillmark (2019) …"), which the
 * save spares: a name the page marked and the walk had settled was left
 * standing, save after save, with nothing said.
 */
function diskReading(text, held, pns) {
  const blank = (held || []).concat(pns || []);
  const flat = blank.length ? TD.blankRanges(text, blank, " ") : text;
  return { flat, blank, cited: TD.citedNameSpans(flat) };
}
/**
 * real → fake over `text`, kept occurrences left exactly as they stand: the
 * values kept for the whole case, the ranges `held` names — the spot keeps,
 * whose places in this very text the caller read off the page — and the
 * run's own fakes (`pns`), which are never written into. `spare`: more ranges
 * to leave as they stand (the save's undecided names), which are not part of
 * how the page reads.
 */
function forwardText(text, held, pns, spare) {
  const swaps = forwardSwaps(text, held, pns, spare);
  let out = "", at = 0;
  for (const s of swaps) { out += text.slice(at, s.start) + s.to; at = s.end; }
  // Names, not places: a name wrapped over lines is written a piece a line.
  // …and the swaps themselves, which a spot keep after them is moved by (textdoc.spotsAfterSwaps).
  return { text: out + text.slice(at), swaps: swaps.filter((s) => !s.piece).length, places: swaps };
}
/** …and the same pass as places: [{ start, end, to, piece }] into `text`, in order — `piece` past the first of a wrapped name. */
function forwardSwaps(text, held, pns, spare) {
  // The names of decided cases are blanked with the keeps: a party of a
  // decision this brief cites is that decision's, not this matter's, and a
  // save that wrote a pseudonym over it would put out a citation to a case
  // that does not exist (textdoc.citedNameSpans). Which names those are is
  // read off the page as its marks read it (diskReading), and the blanks are
  // NULs here, so no match runs across a fake or a spot keep.
  const { flat, blank, cited } = diskReading(text, held, pns);
  const spared = blank.concat(cited, spare || []);
  const out = [];
  let off = 0;
  // A name wrapped down a column is written too, a fake per piece: its cells
  // are read off the text as it stands (`layout`), where the reading has its
  // fakes and keeps blanked out of it (see pseudo-key's columnHits).
  for (const r of PK.forwardRuns(fwd, TD.blankRanges(maskKept(flat, text), spared), { layout: text })) {
    const len = r.t === "swap" ? r.from.length : r.s.length;
    if (r.t === "swap") out.push({ start: off, end: off + len, to: r.to, piece: r.piece || 0 });
    off += len;
  }
  return out;
}
/**
 * Every name standing in the clear as the page reads it (diskReading) — the
 * orange marks, settled or not: every real name the key binds, past the values
 * kept for the case, the spot keeps (`held`), the run's fakes (`pns`) and the
 * parties of cited decisions. [{ start, end, real, fake, ranges }] — `ranges`
 * the name's pieces, which for one wrapped down a column have the other
 * column's text between them, inside `start` and `end`.
 *
 * THE SAVE FAKES ONLY WHAT HAS BEEN DECIDED. It used to write every one of
 * them as its pseudonym, looked at or not, which made a save before the review
 * was over a review answered "fake" throughout — a party's surname in a
 * citation the walk had not reached yet included. The ones not settled with
 * "fake it" are what it leaves exactly as they stand, and says so.
 */
function standingSpans(text, held, pns) {
  if (!reals) return [];
  const { flat, cited } = diskReading(text, held, pns);
  return PK.findRealSpans(reals, maskKept(flat, text), { layout: text }).filter((h) => !TD.insideCited(cited, h));
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
  // …and only under this folder's OWN key: one read from its key file, or
  // chosen by hand while it was open (keyFolder). The key in hand outlives the
  // folder it came from — a folder with no key file, or one Excel is holding,
  // reads under the last case's — and that key binds the last case's names. A
  // flag here it happens to bind is a name nothing has faked here.
  if (!TD.keyAnswersFlags(keyFolder, valuesStoreKey())) return;
  const { kept, dropped } = TD.dropFlagsInKey(flagged, fwd);
  if (!dropped.length) return;
  flagged = kept;
  phrases = phrases.filter((v) => TD.isPhrase(kept, v));
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
  // "Fake it" is a decision about a name in THIS case. A key refreshed by a
  // re-run is the same case and the decisions stand; another case's key
  // starts with none.
  if (key !== parsed && (!key || !parsed || !PK.sameCaseKey(key, parsed))) { settled = new Set(); renderSettled(); }
  key = parsed || null;
  // Pages built ahead of time carry this key's translation: under another one
  // they are simply wrong, so they go, and the window fills again.
  staleReady();
  compileKey();
  $("st-key").textContent = key ? "Key: " + PK.keyTitle(key) + (key.dropped.ambiguous ? ` (${key.dropped.ambiguous} ambiguous fake${key.dropped.ambiguous === 1 ? "" : "s"} retired)` : "") : "";
  // A fake that is an ordinary word ("We" for a surname): the reader cannot
  // tell the run's "We" from the word, so it shows every one as written
  // (PK.compile) — and says why, since the name it stands for is then shown
  // nowhere. A full PDF-Linker run gives the name a stand-in of its own.
  const wordy = PK.wordFakesOf(key);
  if (wordy.length) {
    const which = wordy.slice(0, 3).map((w) => `\u201c${w.fake}\u201d for \u201c${w.real}\u201d`).join(", ") + (wordy.length > 3 ? ` and ${wordy.length - 3} more` : "");
    $("st-key").textContent += ` (${wordy.length} pseudonym${wordy.length === 1 ? " is an ordinary word" : "s are ordinary words"}: shown as written)`;
    toast(`The key fakes ${which} — ${wordy.length === 1 ? "a pseudonym that is" : "pseudonyms that are"} an ordinary word, so nothing tells the run's from the word itself. The reader shows ${wordy.length === 1 ? "it" : "them"} as written rather than turning every one into the name. Re-run PDF-Linker (a full run, not Apply Fixes) to give ${wordy.length === 1 ? "that name a stand-in" : "those names stand-ins"} of ${wordy.length === 1 ? "its" : "their"} own.`, { ms: 12000 });
  }
  // Another key binds other values: what the last one proposed over a PDF is
  // its reading, not this one's, and goes. Boxes drawn by hand stay — they
  // were never the key's to propose.
  redactKeyChanged();
  if (doc) { retranslate(); refreshPdf(); }
}

// A key chosen by hand is the key of the list open at that moment: the case
// folder's, or with no folder open the lone document's; with nothing open, of
// none.
function handOwner() { return folderName || fileName ? valuesStoreKey() : null; }
// …and said, where the key is already being talked about, when the key in hand
// is not the open folder's own, so that none of its flags come off under it.
// `remedy`: what takes them off — the case's own key loaded by hand, or, where
// the folder's key file could not be read, that file read again.
function notOwnKeyNote(remedy = "load this case's own key with Load key… to take them off.") {
  if (!key || !folderName || TD.keyAnswersFlags(keyFolder, valuesStoreKey())) return "";
  return ` The key in hand was not read from ${folderName} or chosen with it open, so none of the flags here come off under it — ${remedy}`;
}

keySelect.addEventListener("change", () => {
  const lib = keyLibrary();
  keyFolder = handOwner();
  setKey(keySelect.value ? lib[keySelect.value] : null);
});

// `owner`: the list the key answers flags for (keyFolder), set before the key
// is compiled, since compiling it is what takes flags off.
async function loadKeyFromBytes(bytes, name, folder, { quiet = false, owner = null } = {}) {
  const wb = await parseXlsx(bytes);
  if (!PK.sheetsLookLikeKey(wb.sheets)) throw new Error(`${name} has no "Real Value" / "Replacement" header — not a pseudonym key.`);
  const parsed = PK.parseKey(wb.sheets, name);
  const id = storeKey(parsed, folder);
  fillKeys(id);
  keyFolder = owner;
  setKey(keyLibrary()[id]);
  const note = notOwnKeyNote();
  if (!quiet) toast(`Key loaded: ${PK.keyTitle(key)} — ${key.pairs.length} reversible binding${key.pairs.length === 1 ? "" : "s"}` +
    (key.dropped.ambiguous ? `, ${key.dropped.ambiguous} ambiguous retired` : "") + (note ? "." + note : ""), note ? { ms: 9000 } : undefined);
}

async function pickKey() {
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: "Pseudonym key", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }] });
      const f = await h.getFile();
      await loadKeyFromBytes(new Uint8Array(await f.arrayBuffer()), f.name, "", { owner: handOwner() });
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
  try { await loadKeyFromBytes(new Uint8Array(await f.arrayBuffer()), f.name, "", { owner: handOwner() }); }
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
/** …and the opposite: a folder the reader is to stop remembering. */
async function forgetDir(name) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DIRS_STORE, "readwrite");
      tx.objectStore(DIRS_STORE).delete(name);
      // …the folder its flagged list was last written into with it (rememberWritten).
      tx.objectStore(DIRS_STORE).delete(WRITTEN_KEY + name);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* it was not remembered, which is where we wanted to get to */ }
}
// WHICH FOLDER New Real Values.txt was last written into. What was written is
// remembered by folder NAME (valuesSavedKey), as every per-folder list is, and
// a name is not a folder: a copy of the case under the same name (a copy_to
// destination, an archive) shares it, and so does every case's Text Files.
// Read against the wrong folder, a keep line written into one reads as SPENT in
// the other — taken out by PDF-Linker — and the keep was retired without ever
// reaching the folder the run reads. So the folder that took the write is kept
// beside the name, by its handle ({ written: handle }); writtenWhere asks it.
// (A list saved through the picker or a download is no write into the folder,
// and records nothing: saveValuesFile.) Kept in the folders' store under a key
// no folder can have, and passed over by rememberedDirs, which takes only
// directory handles.
const WRITTEN_KEY = "\u0000written:";
async function rememberWritten(name, dir) {
  if (!name || !dir) return;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DIRS_STORE, "readwrite");
      tx.objectStore(DIRS_STORE).put({ written: dir }, WRITTEN_KEY + name);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* not remembered: the record is read by name alone, as before */ }
}
/** …and read back: { written: handle }, or null where none was kept. */
async function writtenRecord(name) {
  try {
    const db = await openDb();
    const out = await new Promise((resolve, reject) => {
      const req = db.transaction(DIRS_STORE, "readonly").objectStore(DIRS_STORE).get(WRITTEN_KEY + name);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return out && typeof out === "object" && out.written ? out : null;
  } catch { return null; }
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
async function scanFolder(h, { light = false } = {}) {
  const found = { keyHandle: null, valuesHandle: null, leaksHandle: null, combined: null, textDir: null, docs: [], rootDocs: [], pdfs: [] };
  for await (const [name, entry] of h.entries()) {
    if (entry.kind === "file") {
      if (/\.pdf$/i.test(name) && !/_temp\.pdf$/i.test(name)) { if (!light) found.pdfs.push({ name, handle: entry }); }
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
  if (found.textDir && !light) {
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

/**
 * Make `h` the current case folder: key attached, documents listed, flags
 * loaded. Null where it is another folder and the documents of this one that
 * are unsaved keep the reader here (leaveFolderAsk).
 */
async function adoptFolder(h, { quiet = false, light = false } = {}) {
  if (dirHandle && anyUnsavedDocs() && !(await sameFolder(h)) && !(await leaveFolderAsk())) return null;
  return duringAsync("reading the case folder", () => adoptFolderNow(h, { quiet, light }));
}
/**
 * TWO WEIGHTS OF ADOPTION, because opening ONE FILE is not the same act as
 * opening a case folder.
 *
 * A file opened on its own used to bring its whole folder with it: the reader
 * finds the folder it sits in (the remembered ones), adopts it, and from that
 * moment everything the folder makes possible is running — the sweep reading
 * every other export for names in the clear, the documents built ahead, the
 * reel hanging the next export under this one, the folder's PDFs matched by
 * name and opened. On a folder with something expensive in it, the file the
 * operator actually asked for is the one thing that is not the trouble, and
 * they never get as far as saying so.
 *
 * So there is a LIGHT attach: the pseudonym key, the flagged values, and the
 * LEAKS worksheet — the three things that belong to the case rather than to
 * the document, and that the marks and the review need. No list of documents,
 * no PDFs, and so none of the passes that run off them. A file opened on its
 * own still brings the whole folder by default; it takes the light attach
 * after a session went down holding a whole folder (askBeforeFolder), and the
 * offer bar and the Documents tab then ask before reading the rest.
 */
async function adoptFolderNow(h, { quiet = false, light = false } = {}) {
  const same = await sameFolder(h);
  // Another matter: the PDFs go, and with them any redaction proposed over
  // them — boxes are a thing you are in the middle of, and this folder's
  // pages are not that folder's.
  if (dirHandle !== h) { forgetPdfs(); dropReady(); clearRedactions("the case folder changed"); }
  // …and what the reader held of the last folder's documents: its replaces,
  // the history of its pages, which documents it had seen. Its unsaved
  // documents were saved or dropped on the way out (adoptFolder).
  if (dirHandle && !same) {
    replaceJournal = [];
    undoStack = [];
    redoStack = [];
    lastSnapPage = -1;
    seenDocs = new Set();
    confirmedDocs = new Set();
    unsavedDocs.clear();
    unsavedSeq++;
  }
  dirHandle = h;
  folderName = h.name;
  // The name this folder's flags are kept under, taken now: the key file read
  // below is this folder's own even should another folder be opened meanwhile.
  const own = valuesStoreKey();
  await rememberDir(h);
  const found = await scanFolder(h, { light });
  // The combined file, when the folder has one, listed first: it is the one
  // file holding every export, and the one the drafting model was handed.
  folderDocs = light ? [] : (found.combined ? [found.combined].concat(found.docs) : found.docs);
  folderPdfs = light ? [] : found.pdfs;
  folderLight = light;
  // The same folder read again: the documents on the reel and in the store
  // are its documents still, found again by name in the list just read.
  if (same && folderDocs.length) relinkFolderDocs();
  // …and a document opened on its own before its folder was — or a folder's
  // document still on screen as another folder comes in — is one of this
  // folder's documents or none, by the file itself (folderDocOf). Left without
  // its entry, its edits had nowhere to be kept: moving to another document
  // asked "Discard unsaved edits?", and Save wrote it without the disk check.
  await linkReelToFolder();
  // Not in the Text Files folder: its remedy is the folder above (openFolder's
  // offer bar), and every case's Text Files shares one flag list by name.
  const ownNote = (remedy) => (looksLikeTextFiles(h, found) ? "" : notOwnKeyNote(remedy));
  if (found.keyHandle) {
    try {
      const f = await found.keyHandle.getFile();
      await loadKeyFromBytes(new Uint8Array(await f.arrayBuffer()), f.name, folderName, { quiet, owner: own });
    } catch (e) {
      // Load key… on a file Excel is holding fails the same way: the remedy
      // here is the file read again, by opening the folder once it can be.
      const msg = String(e.message || e);
      const note = ownNote("close the key in Excel, or replace a damaged one, and open the folder again to take them off.");
      toast("The folder's key could not be read: " + msg + (note && !/[.!?]$/.test(msg) ? "." : "") + note, { error: true });
    }
  } else if (!quiet) {
    const note = ownNote();
    toast("No pseudonym_key.xlsx in " + folderName + (note ? " — the documents read under the key in hand." + note : " — the documents will read in their fakes."), note ? { ms: 9000 } : undefined);
  }
  // The names said to be faked in this case, kept for it — read after the key,
  // whose arrival from another case would otherwise clear them (setKey).
  loadSettled();
  const stored = readStoredValues(VALUES_PREFIX + folderName);
  flagged = stored.values;
  flagsFor = valuesStoreKey();
  keeps = stored.keeps;
  phrases = stored.phrases;
  noOcr = stored.noOcr;
  ocrAgain = stored.ocrAgain;
  textFixed = stored.textFixed;
  // The folder's New Real Values.txt as it stands, read once: null where there
  // is none (PDF-Linker deletes it once it has spent every line), undefined
  // where it cannot be read — which answers nothing, so nothing is taken as
  // spent and nothing is read in.
  let diskValues = null;
  if (found.valuesHandle) {
    try { diskValues = await found.valuesHandle.getFile().then((f) => f.text()); }
    catch { diskValues = undefined; }
  }
  if (typeof diskValues === "string") {
    try {
      const onDisk = TD.parseReaderFile(diskValues);
      // A value the key already fakes is not brought back in: the file on disk
      // is the list as it stood when it was last written, and PDF-Linker has
      // answered it since. Silently, because the file is not the operator's
      // own list moving — the list itself is pruned where it is compiled,
      // which says so once.
      // …by this folder's own key only (keyFolder, as dropFlagsNowFaked): another
      // case's key binds that case's names, and nothing has faked them here.
      const answers = TD.keyAnswersFlags(keyFolder, own);
      for (const v of onDisk.values) if (!answers || !TD.fakeFor(fwd, v)) flagged = TD.addValue(flagged, v);
      for (const v of onDisk.phrases) if (TD.isPhrase(flagged, v)) phrases = TD.addValue(phrases, v);
      // A keep line the list lacks is read in — one written in another session,
      // or one another reader tab's list was stored over — but never one the
      // operator WITHDREW since (its ×, "It is a pseudonym after all", Remove
      // from Master Keep: keepWithdrawn). That line is the file's old copy of a
      // decision withdrawn: it is recorded as written, so the list without it
      // reads as owed OUT of the file, and the next save takes it out. Read
      // back, it came back at every opening, and the save after handed it to
      // PDF-Linker again. (Asked of the record of withdrawals, never of the list
      // lacking a line the reader once wrote: a stale tab's list stored over
      // this one lacks it too, and that keep was never withdrawn.)
      const withdrawn = [];
      for (const k of onDisk.keeps) {
        if (TD.keptControl(keeps, k.value)) continue;
        if (keepWithdrawn(k.control, k.value)) withdrawn.push(k);
        else keeps = TD.addKeep(keeps, k.control, k.value);
      }
      if (withdrawn.length) {
        const was = lsGet(valuesSavedKey(), "");
        const now = TD.noteKeepLines(was, withdrawn);
        if (now !== was) lsSet(valuesSavedKey(), now);
      }
      // A page line on disk is the list as it was last written; the list in
      // hand is newer, so a page either list already names is left to it —
      // or a page asked to be read again since would come back as not to OCR.
      const named = (e) => noOcr.some((x) => TD.sameNoOcr(x, e)) || ocrAgain.some((x) => TD.sameNoOcr(x, e));
      for (const e of onDisk.noOcr) if (!named(e)) noOcr = TD.setNoOcr(noOcr, e, true);
      for (const e of onDisk.ocrAgain) if (!named(e)) ocrAgain = TD.setOcrAgain(ocrAgain, e, true);
      // …and a transcribed page the file names that the list does not is one
      // written in another session, owed until PDF-Linker spends it.
      for (const e of onDisk.textFixed) if (!named(e) && !textFixed.some((x) => TD.sameNoOcr(x, e))) textFixed = TD.setTextFixed(textFixed, e, true);
    } catch { /* unreadable: the in-memory list stands */ }
  }
  // WHAT PDF-LINKER HAS SPENT. A keep or a transcribed page is DONE once its
  // line has been written to the folder and is no longer there: PDF-Linker puts
  // a keep on the master workbook's KEEP sheet and takes its line out, and
  // spends a page's line the moment the text is in the PDF; it carries back a
  // line it could not apply — a keep whose master row it could not write, one
  // Apply Fixes holds for the full re-run — and such a line is not spent. (A
  // transcribed page's header says TEXT CORRECTED from that run on, but a page
  // already corrected can be typed over and marked again, so the header alone
  // cannot say the request is done.) A spent keep is retired from the case's
  // list: written again, it put back on the master a keep the operator had
  // emptied or deleted there, on every run (TD.spendLines). Only where the
  // line was written into THIS folder (spendFromDisk). Nothing just read in
  // from the file is spent: what is spent is not in it.
  let spentKeeps = [];
  if (diskValues !== undefined) {
    spentKeeps = await spendFromDisk(diskValues, { settle: false });
    trimWithdrawn(diskValues); // a withdrawn line the file no longer carries is nothing left to keep out
  }
  persistValues();
  if (doc) syncNoOcr(doc.pages.map((_, i) => i)); // the open document says what it carries
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
  // A spent keep the master workbook does not hold is said by name, once the
  // workbook has been read as it now stands: not left to vanish unremarked.
  if (spentKeeps.length) {
    keepsSpentNote(spentKeeps).then((note) => { if (note) toast(note, { error: true, ms: 12000 }); }, (e) => console.warn(e));
  }
  return found;
}

/**
 * The folder read again: each reel member, each document in the store and
 * each document of a folder replace's journal is linked to its entry in the
 * new list, by name. One no longer in the folder keeps the entry it had, and
 * its save fails with the reason.
 */
function relinkFolderDocs() {
  const byName = new Map(folderDocs.map((x) => [x.name, x]));
  for (const m of reel) {
    const x = byName.get(m.name);
    if (!x) continue;
    if (m.handle === fileHandle) fileHandle = x.handle;
    m.d = x;
    m.handle = x.handle;
  }
  for (const e of unsavedDocs.values()) {
    const x = byName.get(e.name);
    if (x) { e.d = x; e.handle = x.handle; }
  }
  // …so an undo still finds a document of the replace on the reel (matched by
  // its entry) rather than taking it for one in neither place.
  for (const rec of replaceJournal) {
    for (const j of rec.docs) { const x = byName.get(j.name); if (x) j.d = x; }
  }
}
/**
 * Each member of the reel that is not linked to an entry of the folder now
 * open, linked by the file itself (the same handle, else isSameEntry), or to
 * none: a document opened on its own and then joined by its folder becomes one
 * of the folder's — its edits kept in the store when another document opens,
 * checked against the disk when saved — with the file's text it was read from
 * as the base the content check compares, read now where it was not kept.
 */
async function linkReelToFolder() {
  for (const m of reel.slice()) {
    if (m.d && folderDocs.includes(m.d)) continue;
    const handle = m.handle;
    const x = folderDocs.length && handle ? await folderDocOf(handle) : null;
    if (!reel.includes(m)) continue; // the reel moved on meanwhile
    m.d = x;
    if (!x) continue;
    if (m.handle === fileHandle) fileHandle = x.handle;
    m.handle = x.handle;
    if (!m.base || typeof m.base.text !== "string") {
      try {
        const f = await x.handle.getFile();
        const text = await f.text();
        m.base = { text, stamp: fileKeyOf(f), opened: TD.serializeExport(readExport(text)) };
      } catch { /* unreadable: the save's content check says so */ }
    }
  }
  // (The Documents list and the status bar are drawn again by the adoption.)
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
  delete keyOffer.dataset.master; // whose offer it is (offerMasterRenew marks its own)
  keyOffer.hidden = false;
  syncOfferHeight();
}
function hideKeyOffer() { keyOffer.hidden = true; delete keyOffer.dataset.master; syncOfferHeight(); }
$("key-offer-close").addEventListener("click", hideKeyOffer);

// ── a PDF-Linker run going in the case folder ──────────────────────────────────
//
// A run rewrites the case folder as it goes: every export in Text Files, one
// PDF after another, then the key and LEAKS.xlsx at its end. A document opened
// meanwhile is the last run's text, or text this run is part-way through,
// read under a key it is about to replace; and whatever is saved before it
// finishes can be overwritten by it, or overwrite what it has just written.
// The run says it is going the way it says so in Explorer: a zero-byte
// `ETA <estimate>.txt` in the case folder, rewritten after each PDF and
// replaced by `DONE <clock>.txt` on a clean finish (TD.runMarker). So every
// export opened looks for one, and the bar says so while it stands.
//
// It is looked for again while the bar is up (RUN_RECHECK_MS, and on coming
// back to the tab), so the bar says when the run has ended rather than going
// on warning about one that is over, and offers the folder read again: what
// is open is what stood before it did. A run that died part-way leaves its
// marker behind until the next run clears it (a crashed --fix-leaks clears
// its own), so the bar gives the marker's age — it is rewritten after every
// PDF, and one untouched for a long while is that — and × puts it away until
// the next document is opened.
const runBar = $("run-bar");
const RUN_RECHECK_MS = 30000;
const RUN_STALE_MS = 30 * 60000; // untouched this long, the marker may be a dead run's
let runShown = null;  // { dir, state: "running" | "ended" } while the bar is up
let runTimer = 0;
let runSeq = 0;       // the latest look wins: an older one answering late says nothing
function syncRunHeight() {
  document.documentElement.style.setProperty("--run-h", runBar.hidden ? "0px" : runBar.offsetHeight + "px");
}
function hideRunBar() {
  runShown = null;
  clearInterval(runTimer);
  runTimer = 0;
  runBar.hidden = true;
  syncRunHeight();
}
$("run-bar-close").addEventListener("click", hideRunBar);

/**
 * The newest ETA and DONE markers in the case folder `dir`, each
 * { label, at }, or null where the folder cannot be read now. Empty files
 * only, as PDF-Linker scopes its own (`_marker_mtime`).
 */
async function runMarkersIn(dir) {
  let eta = null, done = null;
  try {
    for await (const [name, entry] of dir.entries()) {
      if (entry.kind !== "file") continue;
      const m = TD.runMarker(name);
      if (!m) continue;
      let f;
      try { f = await entry.getFile(); } catch { continue; }
      if (f.size !== 0) continue;
      const hit = { label: m.label, at: f.lastModified };
      if (m.kind === "ETA") { if (!eta || hit.at > eta.at) eta = hit; }
      else if (!done || hit.at > done.at) done = hit;
    }
  } catch { return null; }
  return { eta, done };
}

function agoText(ms) {
  const min = Math.floor(Math.max(0, ms) / 60000);
  if (min < 1) return "less than a minute ago";
  if (min < 90) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.round(min / 60);
  return `${h} hours ago`;
}

/**
 * Whether PDF-Linker is running on the case folder, said in the bar.
 * `opening`: an export has just been opened, so the bar comes up even where
 * it was put away; otherwise (the recheck) only a bar already up is updated.
 * An ETA marker newer than any DONE stamp is a run going — the test
 * PDF-Linker itself makes of a copied folder (`_copy_is_ahead`).
 */
async function checkRun({ opening = false } = {}) {
  const dir = dirHandle;
  if (!dir) { runSeq++; hideRunBar(); return; }
  // A recheck with no bar up asks nothing, and must not count as the latest
  // look either: a focus landing while an opening's look is reading the
  // folder would otherwise silence it.
  if (!opening && !(runShown && runShown.dir === dir)) return;
  const seq = ++runSeq;
  if ((await permissionOf(dir, "read")) !== "granted") return;
  const seen = await runMarkersIn(dir);
  if (seq !== runSeq || dir !== dirHandle || !seen) return;
  const { eta, done } = seen;
  if (eta && (!done || eta.at > done.at)) { showRunning(dir, eta); return; }
  // No run going. A bar that was warning about one says it has ended, and
  // stays up until the folder is read again or it is put away: an export
  // opened after the run is the new text, but the key in hand is still the
  // one read before it. A bar about another folder has nothing to say here.
  if (runShown && runShown.dir === dir) { if (runShown.state === "running") showRunEnded(dir, done); }
  else if (runShown) hideRunBar();
}

function showRunBar(dir, state, text, action) {
  runShown = { dir, state };
  // Set only when it changes: the bar is an alert, and a recheck saying the
  // same again is not news to a screen reader.
  if ($("run-bar-text").textContent !== text) $("run-bar-text").textContent = text;
  const btn = $("run-bar-btn");
  btn.hidden = !action;
  if (action) { btn.textContent = action.label; btn.onclick = action.run; }
  runBar.classList.toggle("done", state !== "running");
  runBar.hidden = false;
  syncRunHeight();
  clearInterval(runTimer);
  runTimer = state === "running" ? setInterval(() => { checkRun(); }, RUN_RECHECK_MS) : 0;
}

function showRunning(dir, eta) {
  const age = Date.now() - eta.at;
  const stale = age > RUN_STALE_MS
    ? ` Its ETA file was last updated ${agoText(age)}: a run that stopped part-way leaves it behind, and pdf_linker.log says whether one is still going.`
    : "";
  showRunBar(dir, "running",
    `⚠ PDF-Linker is running on ${dir.name} — ETA ${eta.label}. It is rewriting the exports, and then the key and LEAKS.xlsx: what you open now may be replaced while you read it, and anything you save before it finishes can be overwritten.${stale}`);
}

function showRunEnded(dir, done) {
  showRunBar(dir, "ended",
    done
      ? `PDF-Linker has finished on ${dir.name} — DONE ${done.label}. The key, the worksheet and the documents in hand were read while it was running.`
      : `PDF-Linker's run on ${dir.name} has stopped without a DONE stamp — pdf_linker.log says why. The key, the worksheet and the documents in hand were read while it was running.`,
    { label: "Read the folder again", run: readFolderAfterRun });
}

/**
 * The case folder read again after a run, and the open document with it: the
 * run wrote a new key, new exports and new PDFs, and the reader holds the old.
 * An export the run renamed (quarantined to .txt.LEAK, or released from it)
 * is found again by its name without the extension.
 */
async function readFolderAfterRun() {
  const dir = dirHandle;
  if (!dir) { hideRunBar(); return; }
  if (dirty && !confirm("Discard unsaved edits to " + fileName + "?")) return;
  dirty = false;
  hideRunBar();
  const name = fileName, was = fileHandle;
  forgetPdfs();
  dropReady();
  await adoptFolder(dir, { quiet: true, light: folderLight });
  if (!doc || !name) return;
  let f = null, h = was;
  try { f = h ? await h.getFile() : null; } catch { f = null; }
  if (!f) {
    const d = folderDocs.find((x) => TD.docLabel(x.name).toLowerCase() === TD.docLabel(name).toLowerCase());
    h = d ? d.handle : null;
    try { f = h ? await h.getFile() : null; } catch { f = null; }
  }
  if (f) { await openFile(f, h); return; }
  retranslate();
  toast(`${dir.name} is read again, but ${name} is not in it any more — open the document again from Documents.`, { ms: 7000 });
}
window.addEventListener("focus", () => { checkRun(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkRun(); });

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
    const ask = askBeforeFolder();
    const found = await adoptFolder(at.dir, { quiet: true, light: ask });
    if (!found) return; // the folder open has unsaved documents, and the reader stays in it
    checkRun({ opening: true }).catch((e) => console.warn(e));
    if (doc) retranslate();
    markDocList();
    // Left out of the Text Files folder, as adoption leaves it out (ownNote).
    const note = looksLikeTextFiles(at.dir, found) ? "" : notOwnKeyNote();
    if (!ask) {
      toast(key
        ? `${at.dir.name} · ${folderDocs.length} document${folderDocs.length === 1 ? "" : "s"}, key attached${leaks ? " with its LEAKS worksheet" : ""}.` + note
        : `${at.dir.name} · no pseudonym_key.xlsx in it.`, { ms: note ? 9000 : 5000 });
      return;
    }
    showKeyOffer(`Last time the reader went down with the whole of a case folder open, so this file came in on its own${key && !note ? `, with ${at.dir.name}'s key` : ""}.${note} Read the rest of the folder too?`,
      "Read the whole folder", readWholeFolder);
  };
  if (at.needs) showKeyOffer("This file is in " + at.dir.name + ". Attach its pseudonym key?", "Attach key", attach);
  else await attach();
}

// ── opening documents ───────────────────────────────────────────────────────────
//
// MOVING BETWEEN THE DOCUMENTS OF A CASE FOLDER NEVER DROPS AN EDIT. Opening
// another document used to ask "Discard unsaved edits?", which left two
// answers: lose the work, or stay put — and a find walk, a Replace walking on,
// a LEAKS row in another document or the names walk could not get past a
// document typed in without saving it first. With a case folder fully open,
// every document of it that is dirty on the reel is set aside first, its text
// as Save would write it, in the store of unsaved documents (stashReel); a
// document opened that is in the store comes back from it, unsaved; and Save
// writes every one of them. A lone file, a folder attached for its key alone,
// and a document that is not one of the folder's have nowhere to be kept, and
// keep the old question.
/** `opts.d`: the folder's entry for the file, where the caller knows it. */
async function openFile(file, handle, opts) {
  return duringAsync("opening the document", () => openFileNow(file, handle, opts));
}
async function openFileNow(file, handle, { d = null } = {}) {
  if (!file && !d) return;
  if (refuseWhileBusy()) return;
  // A file of another case folder leaves this one: its unsaved documents are
  // saved first, or dropped, or the reader stays.
  const where = await targetFolderOf(handle);
  if (where === "other" && anyUnsavedDocs() && !(await leaveFolderAsk())) return;
  // What has nowhere to be kept is asked about, as it always was.
  const loose = folderOpen() ? reel.filter((m) => m.dirty && !m.d).map((m) => m.name) : dirty ? [fileName] : [];
  if (loose.length && !confirm("Discard unsaved edits to " + loose.join(", ") + "?")) return;
  // From here the reel is about to be let go of: a save waits for it (saveDocument).
  opening++;
  try { await openFileTail(file, handle, d); } finally { opening--; }
}
let opening = 0; // documents being opened: a save does not start under one
async function openFileTail(file, handle, d) {
  openedFile = file;
  hideKeyOffer();
  // The case folder first, so the document renders under its own key — and so
  // a document built ahead of time is judged against the key it will open under.
  try { await attachKeyForFile(handle || null); } catch (e) { console.warn(e); }
  // …and whether a PDF-Linker run is rewriting that folder now. Not waited
  // for: the warning comes up beside the document, never in its way.
  checkRun({ opening: true }).catch((e) => console.warn(e));
  const td = d && folderDocs.includes(d) ? d : await folderDocOf(handle);
  // What is to be opened is read BEFORE anything on screen is let go of: a
  // file that will not read leaves the reel as it was. A document in the store
  // (or about to be: dirty on the reel) is not read at all.
  const fromStore = !!td && (unsavedDocs.has(td.name) || reel.some((m) => m.dirty && m.d === td));
  let src = file, built = null, text = null;
  if (!fromStore) {
    if (!src) src = await td.handle.getFile();
    built = readyFor(src);
    if (!built) { openPdfAhead(src.name); text = await src.text(); }
  }
  // Nothing holding the reel's documents may have started meanwhile.
  if (saving || folderPass) { refuseWhileBusy(); return; }
  if (folderOpen()) stashReel();
  // …and looked up only now, so a document that was dirty on the reel a
  // moment ago opens from the store with its edits.
  const e = td ? unsavedDocs.get(td.name) : null;
  if (e) {
    openText("", e.name, e.handle, null, { stash: e, d: td });
    checkStashConflict(td);
    return;
  }
  if (!src) { src = await td.handle.getFile(); text = await src.text(); }
  if (built) {
    ready.delete(src.name); // the reader owns it from here: it is about to be edited
    openText("", src.name, handle || null, built, { d: td, base: { text: built.text, stamp: built.fileKey } });
    warmForLeaks();
    return;
  }
  openText(text, src.name, handle || null, null, { d: td, base: { text, stamp: fileKeyOf(src) } });
}
/** Whether something holds the folder's documents, said where it does: a save, or a folder-wide replace being prepared. */
function refuseWhileBusy() {
  if (saving) { toast("Wait for the save to finish."); return true; }
  if (folderPass) { toast("Wait for the replace to be prepared (Esc stops it)."); return true; }
  return false;
}
/** Whether a case folder is open in full: listed, read, and the reel's to hang. A light attach is not. */
function folderOpen() { return !!dirHandle && !folderLight && folderDocs.length > 0; }
/** Whether the document at the head of the reel is Combined Text.txt. */
function isCombinedHead() {
  const h = reel[0];
  return !!h && (h.d ? !!h.d.combined : folderDocs.some((d) => d.combined && d.name === h.name));
}
/** Whether a document of the folder is on the reel: open, or hung on it. */
function onReel(d) { return reel.some((m) => (m.d ? m.d === d : m.name === d.name)); }
/** The documents of the folder with unsaved edits, by name, in the folder's order (the Documents list's): dirty on the reel, and in the store. */
function unsavedNames() {
  const out = reel.filter((m) => m.dirty && m.d).map((m) => m.name);
  for (const name of unsavedDocs.keys()) if (!out.includes(name)) out.push(name);
  return inFolderOrder(out);
}
/** Names of the folder's documents sorted as the Documents list has them; any it does not list, after, as they came. */
function inFolderOrder(names) {
  const at = new Map(folderDocs.map((d, i) => [d.name, i]));
  return names.map((n, i) => [n, at.has(n) ? at.get(n) : folderDocs.length + i]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
}
function anyUnsavedDocs() { return unsavedDocs.size > 0 || reel.some((m) => m.dirty && m.d); }
/** A list of names as a sentence carries one: six at most, and how many more. */
function nameList(names, max = 6) {
  return names.length <= max ? names.join(", ") : names.slice(0, max).join(", ") + `…, and ${names.length - max} more`;
}
/**
 * Where a file stands to the case folder open: "same" (one of its files),
 * "other" (in another case folder the reader remembers), or "loose".
 */
async function targetFolderOf(handle) {
  if (!dirHandle || !handle || typeof handle.isSameEntry !== "function") return "loose";
  try { if (await dirHandle.resolve(handle)) return "same"; } catch { /* not under it */ }
  const at = await caseFolderFor(handle);
  if (!at) return "loose";
  try { if (await at.dir.isSameEntry(dirHandle)) return "same"; } catch { /* another */ }
  return "other";
}
/** The folder's entry for a file handle: the same object, else the same file (isSameEntry, by name first). */
async function folderDocOf(handle) {
  if (!handle || !folderDocs.length) return null;
  const same = folderDocs.find((x) => x.handle === handle);
  if (same) return same;
  if (typeof handle.isSameEntry !== "function") return null;
  for (const x of folderDocs.filter((y) => y.name === handle.name)) {
    try { if (await x.handle.isSameEntry(handle)) return x; } catch { /* not this one */ }
  }
  return null;
}
/** Whether `h` is the case folder already open, by handle or by entry. */
async function sameFolder(h) {
  if (!dirHandle || !h) return false;
  if (dirHandle === h) return true;
  try { return await dirHandle.isSameEntry(h); } catch { return false; }
}
/** A document's text as Save would write it, from the store. */
function docText(e) { return TD.serializeExport(e.doc); }
/** A document of the folder read: from the store where it has unsaved edits, else from its file. → { text, stamp, entry } */
async function readDoc(d) {
  const e = unsavedDocs.get(d.name);
  if (e) return { text: docText(e), stamp: "unsaved:" + e.seq, entry: e };
  const file = await d.handle.getFile();
  return { text: await file.text(), stamp: fileKeyOf(file), entry: null };
}
/**
 * The folder's documents dirty on the reel, set aside in the store before the
 * reel is let go of: each page's text as the file will carry it (a real name
 * typed and not yet marked is marked now — the page is going, and the caret
 * the converter was waiting on goes with it), its spot keeps, and the text
 * each page was built from, which is what an edit is still measured against
 * when it comes back (convertTypedReals).
 */
function stashReel() {
  convertTypedRealsSoon.cancel();
  hideTypeTip();
  let moved = false;
  for (const m of reel) {
    if (!m.dirty || !m.d) continue;
    const list = m === reelCurrent() ? spots : m.spots || [];
    const built = [], rel = [];
    for (let k = 0; k < m.count; k++) {
      const i = m.from + k;
      const body = bodyForPage(i);
      if (body) {
        convertTypedReals(body, { quiet: true, caret: false });
        doc.pages[i].lines = TD.serializeNodes(body).split("\n");
        built.push(body.__built != null ? body.__built : doc.pages[i].lines.join("\n"));
        for (const s of spotsFromBody(body, i)) rel.push({ ...s, page: k });
      } else {
        built.push(m.built && m.built[k] != null ? m.built[k] : doc.pages[i].lines.join("\n"));
        for (const s of TD.spotsOnPage(list, i)) rel.push({ ...s, page: k });
      }
    }
    unsavedDocs.set(m.name, {
      name: m.name, d: m.d, handle: m.d.handle, base: m.base || null,
      doc: TD.cloneDoc(memberDoc(m)), spots: rel, built, seq: ++unsavedSeq, conflict: !!m.conflict,
    });
    m.dirty = false;
    moved = true;
  }
  if (moved) dirty = reel.some((m) => m.dirty);
}
/**
 * A document opened from the store, checked against its file: written since
 * the edits began (the stamp first, then the text), the offer bar says so and
 * offers the disk's version. Save will not write over it either way.
 */
async function checkStashConflict(d) {
  const m = reel[0];
  if (!m || !d || m.d !== d || !m.base) return;
  const base = m.base;
  let gone = false;
  try {
    const f = await d.handle.getFile();
    if (base.stamp && fileKeyOf(f) === base.stamp) return;
    if (typeof base.text === "string" && (await f.text()) === base.text) return;
  } catch { gone = true; }
  if (reel[0] !== m) return; // another document opened meanwhile
  m.conflict = true;
  markDocList();
  updateDirty();
  if (gone) {
    toast(`${m.name} is no longer in ${folderName}, so Save cannot write it back. What is on screen is your version.`, { error: true, ms: 9000 });
    return;
  }
  showKeyOffer(`${m.name} changed on disk after your edits — PDF-Linker or another window wrote it — so Save will not write over it. What is on screen is your version.`,
    "Take the disk's version", () => takeDiskVersion(m.name));
}
/** Drop the edits to a document and open it as its file now reads. */
async function takeDiskVersion(name) {
  if (refuseWhileBusy()) return;
  if (!confirm(`Drop your edits to ${name} and open it as it is on disk now?`)) return;
  unsavedDocs.delete(name);
  unsavedSeq++;
  journalDropped(name);
  for (const m of reel) if (m.name === name) { m.dirty = false; m.conflict = false; }
  dirty = reel.some((m) => m.dirty);
  storeChanged();
  const d = folderDocs.find((x) => x.name === name);
  if (d) await openFolderDoc(d);
}
/**
 * The journal of the folder replaces told that a document's unsaved edits
 * went: its file reads as it did before them, so an undo has nothing to put
 * back in it (revertFolderReplace) — where nothing was saved of it since.
 */
function journalDropped(name) {
  for (const rec of replaceJournal) for (const x of rec.docs) if (x.name === name) x.dropped = true;
}
/** One document of the store, not on screen, dropped: its file is left as it is. */
function dropUnsaved(name) {
  if (!unsavedDocs.has(name)) return;
  if (refuseWhileBusy()) return;
  if (!confirm(`Drop your unsaved edits to ${name}? The file stays as it is on disk.`)) return;
  unsavedDocs.delete(name);
  unsavedSeq++;
  journalDropped(name);
  storeChanged();
  toast(`Your edits to ${name} are dropped — the file is as it is on disk.`);
}
/**
 * Every unsaved document of the folder let go of: the store, and the reel's
 * dirty members — each put back on the page as its file reads (the text its
 * edits started from), so what is on screen is what is on disk. Merely marked
 * clean, the edits stayed on the page with nothing saying so, and the next
 * plain Ctrl+S wrote what had just been "dropped". A member whose file's text
 * is not in hand stays as it is, unsaved, as a file the folder does not hold.
 */
function dropAllUnsaved() {
  for (const name of unsavedDocs.keys()) journalDropped(name);
  unsavedDocs.clear();
  unsavedSeq++;
  let back = false;
  for (const m of reel) {
    if (!m.d) continue;
    m.conflict = false;
    if (!m.dirty) continue;
    journalDropped(m.name);
    if (putMemberToFile(m)) back = true;
    else m.d = null; // nowhere to put it back from: kept, and asked about as a loose file is
  }
  dirty = reel.some((m) => m.dirty);
  if (back && doc) afterTextChange();
  storeChanged();
}
/**
 * A member's pages put back to its file's text as it was read (`m.base`), its
 * own undo steps dropped with the edits they led to. False where that text is
 * not in hand.
 */
function putMemberToFile(m) {
  if (!m.base || typeof m.base.text !== "string") return false;
  const parsed = readExport(m.base.text);
  const rel = TD.normalizeSpots(lsGet(spotKeyOf(m.name), []));
  if (!putMemberBack(m, parsed, rel)) return false;
  for (let k = 0; k < m.count; k++) {
    const b = bodyForPage(m.from + k);
    if (b) b.__built = parsed.pages[k].lines.join("\n"); // typing is measured against the file again
  }
  m.dirty = false;
  m.built = null;
  const mine = (snap) => snap.page != null && snap.page >= m.from && snap.page < m.from + m.count;
  undoStack = undoStack.filter((snap) => !mine(snap));
  redoStack = redoStack.filter((snap) => !mine(snap));
  lastSnapPage = -1;
  return true;
}
/** What follows any change to the store: the status bar, the Documents list, the find's counts. */
function storeChanged() {
  updateDirty();
  markDocList();
  renderUndoFolder();
  if (!findBar.hidden && findQuery) { renderFindBar(); scanFindFolder(); }
}
/**
 * LEAVING THE CASE FOLDER with documents of it unsaved: save them all first,
 * or drop them, or stay. Decisions alone do not ask — the flags, the keeps
 * and the LEAKS answers are remembered for the folder whatever happens. True
 * where the reader may go on.
 */
async function leaveFolderAsk() {
  const names = unsavedNames();
  if (!names.length) return true;
  const labels = names.map((n) => TD.docLabel(n));
  const parts = [`${names.length} document${names.length === 1 ? "" : "s"} (${nameList(labels)})`].concat(pendingWrites());
  const owed = decidedOwed();
  if (owed.names) parts.push(`${owed.names} decided name${owed.names === 1 ? "" : "s"} to write`);
  // Two questions, each saying what its buttons do: the first's Cancel does
  // not save, and leads to the second — leave without saving, or stay — rather
  // than promising to stay and then asking whether to drop everything.
  if (confirm(`${folderName} has work not yet saved: ${parts.join(", ")}.\n\nOK — save it all first, then go on.\nCancel — do not save: next, choose between leaving without saving and staying in ${folderName}.`)) {
    const ok = await saveDocument();
    return ok && !anyUnsavedDocs();
  }
  if (!confirm(`Leave ${folderName} without saving? The unsaved edits to ${nameList(labels)} are dropped. (Flags, keeps and LEAKS answers stay remembered here.)\n\nOK — leave, and drop those edits.\nCancel — stay in ${folderName}; nothing is dropped.`)) return false;
  dropAllUnsaved();
  return true;
}
/**
 * The PDF beside an export, opened WHILE ITS TEXT IS BEING BUILT rather than
 * after. Building a long export's pages holds this thread for a second, and
 * the PDF used to be asked for only once they were up — so reading the file,
 * starting pdf.js's worker and parsing the document all came after that
 * second, one after the other. Asked for first, the worker starts and the
 * file is read on threads of their own while the pages are built, and the
 * PDF is open, or nearly, by the time the pane asks for it. Only side by side
 * (the pane is what wants it), and only the PDF the export's own name
 * matches: a combined file's members are not known until it is parsed.
 */
function openPdfAhead(name) {
  if (!sbsOn) return;
  sharedPdfWorker();
  const hit = pdfForName(name);
  const src = hit ? folderPdfs.find((p) => p.name === hit) : null;
  if (src) loadPdf(src, { now: true }).catch(() => { /* the pane reports it when it asks */ });
}

/**
 * The export as pages, with the margin numbers the OCR missed put back
 * (textdoc.readExport, where it lives now: a document the folder-wide Replace
 * all or Save works on off the screen is read the same way). The file is not
 * touched; a save writes the numbers.
 */
function readExport(text) { return TD.readExport(text); }

/**
 * A document up on the page: `text` read and parsed, a document `built` ahead
 * of time, or one out of the store of unsaved documents (`stash`), which comes
 * back exactly as it was left — unsaved, its spot keeps, each page's typing
 * still measured against the text it was built from — and leaves the store.
 * `d` is the folder's entry for it, `base` the file it was read from ({ text,
 * stamp }), which Save checks the disk against before it writes.
 */
function openText(text, name, handle, built, { stash = null, d = null, base = null } = {}) {
  doc = stash ? TD.cloneDoc(stash.doc) : built ? built.doc : readExport(text);
  fileName = name;
  fileHandle = handle;
  // A document opened is the head of a new reel, whatever was hanging off the
  // last one. `doc.pages` grows from here as the folder is read on.
  reelReset(doc, name, handle, [], {
    d,
    base: stash ? stash.base : base ? { text: base.text, stamp: base.stamp || null, opened: TD.serializeExport(doc) } : null,
  });
  reelJustOpened = true;
  dirty = false;
  editing = false;
  typeDismissed = null;
  clearHistory();
  document.body.classList.remove("editing");
  $("edit-toggle").setAttribute("aria-pressed", "false");
  document.title = name + " — Text Reader";
  docSeq++;      // …whose own reading of what stands in its clear has yet to be made
  leakStep = -1; // a new document, a new walk through what stands in its clear
  answered = 0;
  decidedHere = 0;
  if (!leakJump) showNamesBar(false); // …unless the walk is what opened it
  if (!dirHandle) { loadValuesFor(name); loadSettled(); }
  spots = stash ? TD.normalizeSpots(stash.spots) : TD.normalizeSpots(lsGet(spotStoreKey(), []));
  if (reel[0]) reel[0].spots = spots;
  // A document built ahead of time goes up as it stands, unless its spot keeps
  // have moved since it was built — then its pages are built again from the
  // parse, which is already in hand.
  marksGetAnotherChance();
  if (built && JSON.stringify(built.spots) === JSON.stringify(spots)) showPages(built.nodes, built);
  else render();
  if (stash) {
    // Unsaved, as it was left, and out of the store: its text is on the reel now.
    stash.built.forEach((t, k) => { const b = bodyForPage(k); if (b && t != null) b.__built = t; });
    reel[0].dirty = true;
    reel[0].conflict = !!stash.conflict;
    dirty = true;
    unsavedDocs.delete(name);
    unsavedSeq++;
  }
  seenDocs.add(name);
  const fixedUp = doc.restored;
  if (fixedUp && fixedUp.numbers) {
    toast(`${fixedUp.numbers} margin number${fixedUp.numbers === 1 ? "" : "s"} the OCR missed or misread ${fixedUp.numbers === 1 ? "is" : "are"} put back, on ${fixedUp.pages} page${fixedUp.pages === 1 ? "" : "s"} (in italics in the margin). The file has them once it is saved.`, { ms: 7000 });
  }
  setupPdfForDoc();
  markDocList();
  renderReelState();
  // A keep taken because one document carried the value in the clear is read
  // again against this one: a folder's keeps are the case's, and a pseudonym
  // standing anywhere in it is a run the case folder is owed after all.
  refreshKeepLocality();
  syncNoOcr(doc.pages.map((_, i) => i));
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
  // Another case folder is leaving this one: its unsaved documents are saved,
  // dropped, or the reader stays. Without a folder open in full, what is on
  // screen has nowhere to be kept, and the question is the old one.
  if (folderOpen() ? !(await sameFolder(h)) && !(await leaveFolderAsk()) : dirty && !confirm("Discard unsaved edits to " + fileName + "?")) return;
  hideKeyOffer();
  const found = await adoptFolder(h);
  if (!found) return;
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
 * LET GO OF THE CASE FOLDER, and read what is opened on its own.
 *
 * Everything the reader does BESIDES the document in front of it hangs off
 * having a folder: the sweep that reads every other export for names in the
 * clear, the documents built ahead of a review, the reel hanging the next
 * export under this one, the PDFs matched by name. That is the whole point of
 * a case folder — and it is also every pass that can take a folder's worth of
 * work on a file the reader has not seen yet. A reader who wants one file at
 * a time, because one file at a time is what is working, has no way to say so
 * short of closing the tab.
 *
 * So: the folder goes, and the KEY STAYS. The marks are the reason to use
 * this reader at all, and they are the key's, not the folder's — a key, once
 * loaded, is the key library's. What goes is the folder and everything read
 * from it or through it.
 *
 * It is forgotten as well as dropped. The reader re-attaches a folder it
 * remembers as soon as a file from it is opened (attachKeyForFile), so a
 * folder merely dropped would be back on the next document. Open case folder
 * brings it back when it is wanted.
 */
async function forgetFolder() {
  if (!dirHandle) return;
  if (refuseWhileBusy()) return;
  // Its unsaved documents are saved first, or dropped — or the folder stays.
  if (!(await leaveFolderAsk())) return;
  const was = folderName;
  await forgetDir(dirHandle.name);
  forgetPdfs();
  dropReady();
  dropSweep();
  settled = new Set();
  renderSettled();
  // What the reader held of this folder's documents goes with it.
  unsavedDocs.clear();
  unsavedSeq++;
  replaceJournal = [];
  undoStack = undoStack.filter((s) => !s.folderReplace);
  redoStack = redoStack.filter((s) => !s.folderReplace);
  seenDocs = new Set();
  confirmedDocs = new Set();
  renderUndoFolder();
  clearTimeout(sweepTimer);
  caseFakes = { key: null, docs: null, set: null };
  findRows = [];
  findScanFor = null;
  findShown = { rev: null, docs: null, texts: new Map() };
  dirHandle = null;
  folderName = "";
  folderDocs = [];
  folderPdfs = [];
  flagsFor = null;
  hideRunBar(); // the run is that folder's, and the reader no longer holds it
  // The reel is the folder read as one document: with no folder there is
  // nothing to read on to, so what is open becomes the whole of it. The pages
  // hanging off it belong to files this reader is no longer holding.
  if (doc && reel.length > 1) {
    const m = reelCurrent() || reel[0];
    await openFolderDocLike(m);
  } else {
    reelDone = true;
    reelDoneUp = true;
  }
  renderDocList();
  renderFlags();
  renderReelState();
  refreshPdf();
  renderNamesBar();
  renderLeakStatus();
  toast(`${was} is let go. The reader reads what you open, on its own — the key stays attached. “Open case folder” brings it back.`, { ms: 7000 });
}
/** The one member of a reel, opened on its own: what is left when the folder goes. */
async function openFolderDocLike(m) {
  if (!m || !m.handle) { reelDone = true; reelDoneUp = true; return; }
  try {
    const f = await m.handle.getFile();
    await openFile(f, m.handle);
  } catch { reelDone = true; reelDoneUp = true; }
}
$("forget-folder").addEventListener("click", () => { forgetFolder(); });
/** …and the other way: bring the rest of the folder in after all — the default again from here. */
async function readWholeFolder() {
  if (!dirHandle) return;
  setAskBeforeFolder(false);
  await adoptFolder(dirHandle, { quiet: true, light: false });
  toast(`${folderName} · ${folderDocs.length} document${folderDocs.length === 1 ? "" : "s"}. The reader reads the rest of the folder from here.`, { ms: 6000 });
}
$("read-folder").addEventListener("click", readWholeFolder);

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
    // A document with unsaved edits opens from the store: its file is not read.
    const stored = unsavedDocs.has(d.name) || reel.some((m) => m.dirty && m.d === d);
    await openFile(stored ? null : await d.handle.getFile(), d.handle, { d });
    return true;
  } catch (e) { toast("Could not open " + d.name + ": " + (e.message || e), { error: true }); return false; }
}

function renderDocList() {
  return during("listing the folder's documents", () => renderDocListNow());
}
function renderDocListNow() {
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
  const acts = $("docs-actions");
  if (acts) acts.hidden = !dirHandle;
  const read = $("read-folder");
  if (read) read.hidden = !dirHandle || !folderLight;
}
/**
 * The open document marked in the list, and beside every document with
 * unsaved edits an `unsaved` tag — `changed on disk` where its file has been
 * written since the edits began, which Save will not write over. The tag is a
 * label: a click on it opens the document, as a click anywhere on the row
 * does. Dropping the edits of a document in the store, not on screen, is its
 * own control, the × after the tag, which asks first. (The tag itself used to
 * drop them: a click meant to open the document landed on a prompt to throw
 * the work away, with OK the answer that does.)
 */
function markDocList() {
  const unsaved = new Map();
  for (const e of unsavedDocs.values()) unsaved.set(e.name, { conflict: !!e.conflict, stored: true });
  for (const m of reel) if (m.dirty && m.d) unsaved.set(m.name, { conflict: !!m.conflict, stored: false });
  for (const li of docsList.children) {
    li.classList.toggle("current", li.dataset.name === fileName);
    const u = unsaved.get(li.dataset.name);
    let tag = li.querySelector(".tag.unsaved");
    let drop = li.querySelector(".drop-unsaved");
    if (!u) { if (tag) tag.remove(); if (drop) drop.remove(); continue; }
    if (!tag) {
      tag = document.createElement("span");
      tag.className = "tag unsaved";
      li.appendChild(tag);
    }
    tag.classList.toggle("conflict", u.conflict);
    tag.textContent = u.conflict ? "changed on disk" : "unsaved";
    tag.title = u.conflict
      ? "Its file was written after your edits began (PDF-Linker, or another window), so Save will not write over it. Open it to see your version, or take the disk's."
      : "Edited and not yet saved — Save (Ctrl+S) writes it with the rest.";
    if (u.stored && !drop) {
      drop = document.createElement("button");
      drop.className = "x drop-unsaved";
      drop.textContent = "×";
      drop.title = "Drop your unsaved edits to this document (asks first) — the file stays as it is on disk";
      drop.setAttribute("aria-label", "Drop unsaved edits to " + TD.docLabel(li.dataset.name));
      drop.addEventListener("click", (e) => { e.stopPropagation(); dropUnsaved(li.dataset.name); });
      li.appendChild(drop);
    } else if (!u.stored && drop) drop.remove();
  }
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
 * Where the marks are off — a document they cost too much on — the page has
 * no answer to give and the file's stands.
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
  if (scanned && !marksOff) {
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
  return during('marking what each document carries', () => markDocAlertsNow());
}
function markDocAlertsNow() {
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
  // A key dropped WITH a document is nobody's until it is chosen by hand: the
  // document may bring its own case folder in, and the key is loaded first,
  // while the folder open is still the last one. On its own it is a key loaded
  // by hand, the open folder's.
  const isDoc = (f) => /\.(txt|leak)$/i.test(f.name) || f.type === "text/plain";
  const owner = files.some(isDoc) ? null : handOwner();
  (async () => {
    for (const f of files) {
      if (TD.isKeyName(f.name)) {
        try { await loadKeyFromBytes(new Uint8Array(await f.arrayBuffer()), f.name, "", { owner }); }
        catch (err) { toast(String(err.message || err), { error: true }); }
      } else if (LK.isMasterName(f.name)) {
        // Attached and remembered where the drop carries the file's handle, as
        // a pick does; read for the session only where it does not.
        let h = null;
        try { h = await handles[files.indexOf(f)]; } catch { h = null; }
        try { if (h && h.kind === "file") await adoptMaster(h); else await readMasterBytes(new Uint8Array(await f.arrayBuffer()), f.name); }
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
    const at = files.findIndex(isDoc);
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
      {
        // ⇄ Raw: this page as the file has it, in the page's place (a page as
        // the file has it, below); read off the section at the click for the
        // same reason.
        const b = document.createElement("button");
        b.className = "raw-page";
        b.type = "button";
        b.addEventListener("click", (e) => { e.preventDefault(); toggleRaw(Number(sec.dataset.index)); });
        setRawButton(b, false);
        lab.appendChild(b);
      }
      if (p.header != null) {
        // Strip this page's text for DID_NOT_OCR (a page that did not OCR,
        // below), or — on a page that already reads it — ask for it to be
        // read again; read off the section at the click for the same reason.
        const b = document.createElement("button");
        b.className = "nocr-page";
        b.type = "button";
        b.addEventListener("click", (e) => { e.preventDefault(); nocrButtonClick(Number(sec.dataset.index)); });
        lab.appendChild(b);
        // As the page reads; whether a request is already made is settled
        // once the document is up and its lists are in hand (syncNoOcr).
        setNocrButton(b, TD.readsDidNotOcr(p.lines), false, TD.headerSaysDidNotOcr(p));
        // ✎ Use my text beside it: the page's text, as typed in here, is to
        // become the PDF's own (a page transcribed by hand, below).
        const f = document.createElement("button");
        f.className = "fix-page";
        f.type = "button";
        f.addEventListener("click", (e) => { e.preventDefault(); useMyText(Number(sec.dataset.index)); });
        lab.appendChild(f);
        setFixButton(f, TD.readsDidNotOcr(p.lines), false, TD.headerSaysTextCorrected(p));
      }
      sec.appendChild(lab);
    }
    const inner = document.createElement("div");
    inner.className = "page-inner";
    const body = document.createElement("div");
    body.className = "page-body";
    body.contentEditable = editable ? "plaintext-only" : "false";
    body.spellcheck = false;
    // The margin numbers put back on this page (readExport), marked as the
    // body is built — and built again, since the body element stays.
    body.__restored = p.restored ? new Set(p.restored) : null;
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
  // The text the page was built from: what an edit is measured against when
  // a real name typed into it is marked (convertTypedReals). It is what the
  // page writes to disk until something is typed — the round trip is exact.
  body.__built = text;
  body.classList.toggle("numbered", TD.pageIsNumbered(text.split("\n")));
  const runs = rev ? PK.translateRuns(rev, text) : [{ t: "text", s: text }];
  // The spots of the member the page belongs to — on a reel, not always the
  // open document's — unless the caller hands a document's own.
  const pageSpots = theirSpots || spotsListOf(page);
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
        const gutter = makeGutter(g.gutter);
        if (body.__restored && body.__restored.has(parseInt(g.gutter, 10))) {
          gutter.classList.add("restored");
          gutter.title = "Put back: the OCR missed or misread this margin number. A save writes it into the file.";
        }
        line.insertBefore(gutter, lt);
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
const TRAILER_RE = TD.TRAILER_RE;
function markTrailer(body) {
  let inside = false;
  for (const line of body.querySelectorAll(":scope > .line")) {
    if (!inside && TRAILER_RE.test(line.textContent)) inside = true;
    line.classList.toggle("trailer", inside);
  }
}
/** Everything a rebuilt page body needs before it is measured: the boxes, the columns, then the trailer. */
function dressBody(body) {
  dressLines(body);
  dressColumns(body);
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
  rekeySoon(); // …and the key walk's, for the same reason
  pagesTabSoon(); // …and the Pages tab's rows: a page stripped, typed into, or hung on the reel
  // The pages are where they are now: auto-scroll takes its pace from them
  // again rather than from the layout it started under.
  autoRemeasure();
}
const afterTextChangeSoon = debounce(afterTextChange, 400);
const placeCitationsSoon = debounce(() => placeCitations(), 450);
// Whatever asks for the pages to be laid out again has the reading held
// through it (holdReading): the page being read stays the page on the screen.
function relayout() { holdReading(); relayoutSoon(); }
const relayoutSoon = debounce(() => { reelAllLive(); syncOfferHeight(); syncRunHeight(); textAnchors = null; textLineTops = null; applyMatchedLayout(); applyPageWidth(); placeCitations(); refitPdf(); if (sbsOn) syncScroll("text", true); autoRemeasure(); reelTrimSoon(); }, 150);
window.addEventListener("resize", relayout);

function updateCounts() {
  const all = [...pagesEl.querySelectorAll(".pn")].filter((s) => !s.dataset.piece || s.dataset.piece.startsWith("0/"));
  const n = all.length;
  const k = all.filter((s) => s.classList.contains("kept")).length;
  const h = pagesEl.querySelectorAll("[data-here]").length;
  const pnEl = $("st-pn");
  pnEl.textContent = key
    ? `${n} pseudonym${n === 1 ? "" : "s"} shown as real names`
      + (k ? ` · ${k} kept (un-faked on the next run)` : "")
      + (h ? ` · ${h} kept where ${h === 1 ? "it stands" : "they stand"}` : "")
    : "";
  // The count is the way into the key walk, while there is something to walk.
  const walk = !!key && n > 0;
  pnEl.classList.toggle("step", walk);
  if (walk) {
    pnEl.setAttribute("role", "button");
    pnEl.setAttribute("tabindex", "0");
    pnEl.title = "Step through the key: term by term (Alt+J) and appearance by appearance (Alt+K)";
  } else {
    pnEl.removeAttribute("role");
    pnEl.removeAttribute("tabindex");
    pnEl.title = "";
  }
  $("key-walk-btn").disabled = !walk;
}

// ── editing ──────────────────────────────────────────────────────────────────────
pagesEl.addEventListener("input", (e) => {
  const body = e.target && e.target.closest && e.target.closest(".page-body");
  if (!body) return;
  normalizeLines(body);
  setDirty(true, pageIndexOf(body));
  refreshNocrButtons([pageIndexOf(body)]); // typed onto a [DID NOT OCR] page, or down to one
  offerAtCaret(body);
  convertTypedRealsSoon(body);
  recolumnSoon(body, e.isComposing);
  afterTextChangeSoon();
});

// Typing changes where a line's spaces cut it into columns (columns.js) — a
// gap typed into, a gap closed up — and the cells it is laid out in are cut
// again once the typing stops, the caret kept at its place in the text: the
// cells are wrappers, so the text and its offsets are the same either side.
const recolumnPending = new Set();
const recolumnLater = debounce(() => {
  for (const body of recolumnPending) {
    if (!body.isConnected) continue;
    const at = caretOffsetIn(body);
    if (dressColumns(body) && at >= 0) { const pt = pointAtOffset(body, at); if (pt) placeCaret(pt.node, pt.offset); }
  }
  recolumnPending.clear();
}, 400);
function recolumnSoon(body, composing) {
  recolumnPending.add(body);
  if (!composing) recolumnLater();
}

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
  // …and a value taken off the Master Keep that the workbook refused to let go
  // of: owed, and the next save tries it again (withdrawMaster).
  if (masterPending.length) out.push("Master Keep removal");
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
 * Every hit of the last paint, settled or not — what a closing tab would
 * leave in the file. Kept values, spot keeps and the parties of cited
 * decisions are not in this count, because nothing is owed on them.
 */
function standingInTheClear() {
  return leakHits.filter((h) => h.range && h.range.startContainer && h.range.startContainer.isConnected).length;
}
/**
 * …and the share of them the SAVE will write: the ones the walk has settled
 * with "fake it". A name nobody has decided on is left as it stands
 * (standingSpans), so it is no work for the save and does not light it.
 */
function settledInTheClear() {
  return leakHits.filter((h) => isSettled(h.real) && h.range && h.range.startContainer && h.range.startContainer.isConnected).length;
}
/**
 * The names said to be faked that a save still has to write: standing in the
 * clear on screen (the last paint), and in the folder's other documents as
 * the sweep last read them (settledElsewhere). → { names, docs, list: [{ name,
 * docs }] } — `names` and `docs` how many of each.
 */
function decidedOwed() {
  const by = new Map();
  const add = (v, where) => {
    const k = settledKey(v);
    if (!by.has(k)) by.set(k, { name: String(v).trim(), docs: new Set() });
    by.get(k).docs.add(where);
  };
  if (doc) for (const h of leakHits) if (isSettled(h.real) && h.range && h.range.startContainer && h.range.startContainer.isConnected) add(h.real, h.doc || fileName);
  for (const x of settledElsewhere()) for (const v of x.names) add(v, x.d.name);
  const list = [...by.values()].map((x) => ({ name: x.name, docs: [...x.docs] }));
  return { names: list.length, docs: new Set(list.flatMap((x) => x.docs)).size, list };
}
/**
 * The folder's documents off the screen where a name said to be faked still
 * stands unfaked, from the sweep's rows: [{ d, names }]. `fresh`: only from a
 * sweep made of the folder as it now is (what a save writes from); otherwise
 * the last sweep's answer stands until the next is in (what the status bar
 * says).
 */
let elsewhereMemo = { key: null, out: [] };
function settledElsewhere({ fresh = false } = {}) {
  if (!folderOpen() || (!settled.size && !sheetFakes.size) || !sweep.stamp) return [];
  if (fresh && (sweep.running || sweepStale())) return [];
  // Asked on every repaint of the status bar: answered once per state of what
  // it rests on (the sweep's rows, the decisions, the reel).
  const memoKey = [sweep.rows, sweep.rows.length, settled, settled.size, sheetFakes, reel.map((m) => m.name).join("\n")];
  const k = elsewhereMemo.key;
  if (k && k.every((x, i) => x === memoKey[i])) return elsewhereMemo.out;
  const out = [];
  for (const r of sweep.rows) {
    if (!r.doc || r.doc.combined || onReel(r.doc)) continue;
    const names = [...new Set(r.values.filter((v) => isSettled(v)).map((v) => String(v).trim()))];
    if (names.length) out.push({ d: r.doc, names });
  }
  elsewhereMemo = { key: memoKey, out };
  return out;
}
// With names said to be faked, the folder is read for where else they stand —
// a beat after asking, and only where it has not been read as it now is.
const sweepForOwedSoon = debounce(() => { if (folderOpen() && (settled.size || sheetFakes.size)) sweepFolder(); }, 1500);
/**
 * Everything a save owes the files, in one place — what the status bar, the
 * Save button and the closing prompt read: the unsaved documents (`docs`; a
 * document that is not one of the folder's counts in `loose`), the decision
 * files to write, the decided names (here and elsewhere), a Master Keep removal
 * owed, and the documents whose files changed under their edits.
 */
function owedNow() {
  const docs = unsavedNames();
  const loose = folderOpen() ? reel.filter((m) => m.dirty && !m.d).length : dirty ? 1 : 0;
  const conflicts = [];
  for (const m of reel) if (m.dirty && m.conflict) conflicts.push(m.name);
  for (const e of unsavedDocs.values()) if (e.conflict && !conflicts.includes(e.name)) conflicts.push(e.name);
  return { docs, loose, files: pendingWrites(), decided: decidedOwed(), master: masterPending.slice(), conflicts };
}
/** The status bar's own line for what is owed, and the Save button's state and title. */
function updateDirty() {
  const o = owedNow();
  const pending = o.files;
  const nDocs = o.docs.length + o.loose;
  const clear = o.decided.names;
  const names = `${clear} decided name${clear === 1 ? "" : "s"}`;
  const asPn = clear === 1 ? "its pseudonym" : "pseudonyms";
  const inDocs = o.decided.docs > 1 || (o.decided.docs === 1 && settledElsewhere().length) ? ` (in ${o.decided.docs} document${o.decided.docs === 1 ? "" : "s"})` : "";
  const reading = folderOpen() && (settled.size || sheetFakes.size) && sweep.running ? " (reading the folder…)" : "";
  if (folderOpen() && (settled.size || sheetFakes.size) && !sweep.running && sweepStale()) sweepForOwedSoon();
  // Enabled whenever a save would DO something: the text edited (here or in
  // any document of the folder), the document unlocked for editing, a decision
  // waiting to be written into the folder, or a real name the walk has said to
  // fake, for the save to write as its pseudonym.
  saveBtn.disabled = saving || (!doc && !nDocs) || !(editing || dirty || nDocs || pending.length || clear);
  saveBtn.title = nDocs > 1 || (nDocs && (pending.length || clear))
    ? "Write every document you have changed and every decision you have taken — pseudonyms underneath; a real name you have not yet decided on is left as it stands, and the save warns you (Ctrl+S)"
    : dirty || editing || nDocs
      ? "Write your edits back to the file — pseudonyms underneath; a real name you have not yet decided on is left as it stands, and the save warns you (Ctrl+S)" +
        (pending.length ? ` · ${pending.join(" and ")} too` : "")
      : pending.length
        ? `Write ${pending.join(" and ")} into the case folder (Ctrl+S)` +
          (clear ? ` — and ${names} standing in the clear, written as ${asPn}` : " — the text is unchanged and is not rewritten")
        : clear
          ? `Write ${names} standing in the clear as ${asPn} (Ctrl+S) — the save does it on its own; nothing has to be edited first`
          : "Write your edits back to the file — pseudonyms underneath; a real name you have not yet decided on is left as it stands, and the save warns you (Ctrl+S)";
  $("edit-toggle").disabled = !doc;
  refreshRawPages(); // a raw page says whether it is the disk or the edits
  const st = $("st-dirty");
  st.textContent = saving ? (saveNote || "Saving…")
    // Several things owed, a document among them: all of it, in one line.
    : nDocs > 1 || (nDocs && (pending.length || clear))
      ? "● " + [`${nDocs} document${nDocs === 1 ? "" : "s"} unsaved`]
        .concat(pending.length ? [`${pending.join(" and ")} to write`] : [], clear ? [`${names} to write as pseudonyms${inDocs}`] : [])
        .join(" · ") + (nDocs > 1 && !pending.length && !clear ? " — Save writes them all" : " — Save writes it all") + reading
    // One document: the one on screen, as it always said, or one left unsaved
    // in the store, named.
    : nDocs && dirty ? "● Unsaved edits"
    : nDocs ? `● 1 document unsaved (${TD.docLabel(o.docs[0] || fileName)}) — Save writes it`
    : pending.length ? "● " + pending.join(" and ") + " to write" + (clear ? `, and ${names} to fake${inDocs}` : "") + reading
    : clear ? `● ${names} to write as ${asPn}${inDocs} — Save does it` + reading
    : (doc && !editing ? "Protected — ✎ Edit to change" : "");
  // …and the whole of it, an item a line, on hover.
  const tip = [];
  for (const n of o.docs) tip.push(`${TD.docLabel(n)} — unsaved${o.conflicts.includes(n) ? " (its file changed on disk since; Save will not write over it)" : ""}`);
  if (o.loose) tip.push(`${o.loose === 1 ? fileName : o.loose + " documents"} — unsaved`);
  if (pending.includes(TD.VALUES_FILE)) tip.push(`${TD.VALUES_FILE} to write — ${flagged.length} to fake, ${TD.owedKeeps(keeps).length} to keep${pageListsNote()}`);
  if (leaksDirty()) { const k = LK.fixEdits(leaks.parsed).length; tip.push(`${leaks.name} to write — ${k} decision${k === 1 ? "" : "s"}`); }
  for (const x of o.decided.list.slice(0, 12)) tip.push(`“${x.name}” to write as its pseudonym — in ${nameList(x.docs.map((n) => TD.docLabel(n)))}`);
  if (o.decided.list.length > 12) tip.push(`…and ${o.decided.list.length - 12} more decided names`);
  if (o.master.length) tip.push(`Master Keep removal to write — ${nameList(o.master.map((v) => `“${v}”`))}`);
  for (const n of o.conflicts) tip.push(`${TD.docLabel(n)} changed on disk after your edits — open it to see your version, or take the disk's`);
  st.title = tip.length ? tip.join("\n") + "\nSave (Ctrl+S) writes all of it." : "";
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
  // The caret's place in its line's text, read before the line is cut into
  // column cells (dressBody), which can split the node it stands in.
  const caretAt = caretNode && caretSlot ? offsetOfPoint(ltOf(caretSlot), caretNode, caretNode.data.length) : -1;
  dressBody(body);
  fixGutterSpacing(body);
  if (caretAt >= 0) { const pt = pointAtOffset(ltOf(caretSlot), caretAt); if (pt) placeCaret(pt.node, pt.offset); }
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

// ── the numbered margin is not text ───────────────────────────────────────────────────
//
// The pleading line numbers are the paper, not the filing's words, and a passage
// copied off a numbered page should come away as the passage — not as "3", the
// line, "4", the next line, a number on a line of its own between every two. So
// the margin is unselectable (the stylesheet: `user-select: none` on a numbered
// page's .gutter): a selection across lines paints and copies the text and none
// of the numbers. Unselectable, though, a press on a number began no selection
// at all, and a drag from the margin down across the lines — the usual way to
// take whole lines — took nothing. So a press in the margin is the reader's: the
// selection begins at the start of that line's text and follows the pointer as
// the browser's own drag would, a point over the margin standing for the start
// of its line's text; the stage scrolls under a drag held past its top or foot,
// or turned with the wheel; Shift extends the selection there was, and a double
// click takes the line's text whole.
const MARGIN_EDGE = 28; // px inside the stage's top and foot where a held drag scrolls it
/** The place in the text at a point on the pages, a point in the margin read as its line's start; null off the text. */
function textPointAt(x, y) {
  let node = null, offset = 0;
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) { node = r.startContainer; offset = r.startOffset; }
  } else if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) { node = p.offsetNode; offset = p.offset; }
  }
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  if (!el || !el.closest(".page-body") || !pagesEl.contains(el)) return null;
  const line = el.closest(".line");
  if (el.closest(".gutter")) { const lt = line && ltOf(line); return lt ? { node: lt, offset: 0 } : null; }
  if (line && node === line) {
    // On the line block itself, beside its text: the text's near edge.
    const lt = ltOf(line);
    if (!lt) return null;
    return offset <= [...line.childNodes].indexOf(lt) ? { node: lt, offset: 0 } : { node: lt, offset: lt.childNodes.length };
  }
  return { node, offset };
}
pagesEl.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey) return;
  const g = e.target.closest && e.target.closest(".page-body.numbered .gutter");
  const line = g && g.closest(".line");
  const lt = line && ltOf(line);
  if (!lt) return;
  e.preventDefault();
  const body = line.closest(".page-body");
  if (editing && document.activeElement !== body) body.focus({ preventScroll: true });
  const sel = document.getSelection();
  if (e.detail >= 2) { sel.setBaseAndExtent(lt, 0, lt, lt.childNodes.length); return; }
  const anchor = e.shiftKey && sel.rangeCount ? { node: sel.anchorNode, offset: sel.anchorOffset } : { node: lt, offset: 0 };
  sel.setBaseAndExtent(anchor.node, anchor.offset, lt, 0);
  // Followed sideways inside the sheet the drag began on: down the margin or
  // past the edge of the paper, a point is its line's start or end.
  const sheet = body.getBoundingClientRect();
  let x = e.clientX, y = e.clientY, raf = 0;
  const follow = () => {
    const st = stageEl.getBoundingClientRect();
    const f = textPointAt(Math.max(sheet.left + 1, Math.min(sheet.right - 1, x)), Math.max(st.top + 1, Math.min(st.bottom - 1, y)));
    if (f) { try { sel.setBaseAndExtent(anchor.node, anchor.offset, f.node, f.offset); } catch { /* a node gone under it */ } }
  };
  const speed = () => {
    const st = stageEl.getBoundingClientRect();
    if (y < st.top + MARGIN_EDGE) return -Math.min(40, Math.ceil((st.top + MARGIN_EDGE - y) / 2));
    if (y > st.bottom - MARGIN_EDGE) return Math.min(40, Math.ceil((y - (st.bottom - MARGIN_EDGE)) / 2));
    return 0;
  };
  const tick = () => {
    raf = 0;
    const v = speed();
    if (!v) return;
    stageEl.scrollTop += v; // the scroll reads the point again (onScroll)
    raf = requestAnimationFrame(tick);
  };
  const move = (ev) => {
    if (!(ev.buttons & 1)) { up(); return; }
    x = ev.clientX;
    y = ev.clientY;
    follow();
    if (!raf && speed()) raf = requestAnimationFrame(tick);
  };
  const onScroll = () => follow();
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    stageEl.removeEventListener("scroll", onScroll);
    if (raf) cancelAnimationFrame(raf);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  stageEl.addEventListener("scroll", onScroll, { passive: true });
});

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
// An edit of several pages at once (Replace all) is one snapshot per page, all
// carrying the same `batch`, and one Ctrl+Z puts every one of them back.
let batchSeq = 0;

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
/** Record the page as it stands, before an edit; `force` skips coalescing. A page built off the screen has no history. */
function snapshot(body, force) {
  if (batchEdit || isShadow(body)) return;
  const now = Date.now();
  const i = pageIndexOf(body);
  if (!force && i === lastSnapPage && now - lastSnapAt < UNDO_COALESCE_MS) { lastSnapAt = now; return; }
  undoStack.push(snapshotOf(body));
  trimHistory();
  redoStack = [];
  lastSnapAt = now; lastSnapPage = i;
}
/**
 * Record several pages before one edit that changes them all: one undo step.
 * `batch` is for a caller that adds a step of its own to the same one (a
 * folder-wide replace, whose documents off the screen ride on it).
 */
function snapshotPages(bodies, batch = ++batchSeq) {
  for (const body of bodies) if (!isShadow(body)) undoStack.push({ ...snapshotOf(body), batch });
  trimHistory();
  redoStack = [];
  lastSnapPage = -1;
  return batch;
}
/**
 * The history held to UNDO_MAX entries, the oldest going first — a whole step
 * at a time. A batch cut in half would have Ctrl+Z put back some of its pages
 * and not the rest; and the step just taken is never what goes.
 */
function trimHistory() {
  while (undoStack.length > UNDO_MAX) {
    const b = undoStack[0].batch;
    if (b == null) { undoStack.shift(); continue; }
    if (undoStack[undoStack.length - 1].batch === b) break;
    while (undoStack.length && undoStack[0].batch === b) undoStack.shift();
  }
}
function restoreSnapshot(snap, { settle = true, lists = true } = {}) {
  const body = bodyForPage(snap.page);
  if (!body) {
    // A page of a member the reel has shed: its text goes back where the reel
    // keeps it (`doc.pages`, the member's spots), and is built from there when
    // the reading comes near it again. Dirty, it is not shed again.
    const m = reelMemberOf(snap.page);
    if (!m || !m.shed || !doc.pages[snap.page]) return;
    doc.pages[snap.page].lines = snap.text.split("\n");
    m.spots = (m.spots || []).filter((x) => x.page !== snap.page).concat(snap.spots || []);
    persistMemberSpots(m);
    setDirty(true, snap.page);
    syncNoOcr([snap.page], { drop: true });
    return;
  }
  convertTypedRealsSoon.cancel();
  hideTypeTip();
  // The page's keeps as that snapshot had them, so buildBody can put the spans
  // back where the text it is building from carries them — in the list of the
  // member the page belongs to, which is not the open document's on a reel.
  setSpotsListOf(snap.page, spotsListOf(snap.page).filter((x) => x.page !== snap.page).concat(snap.spots || []));
  buildBody(body, snap.text, snap.page);
  doc.pages[snap.page].lines = snap.text.split("\n");
  // …and what actually landed is what is remembered.
  syncSpots(body);
  if (lists) syncNoOcr([snap.page], { drop: true }); // an undone ⊘ Did not OCR comes off the list
  if (snap.caret >= 0) {
    const at = pointAtOffset(body, snap.caret);
    try { const r = document.createRange(); r.setStart(at.node, at.offset); r.collapse(true); const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch { /* the caret is simply not restored */ }
  }
  body.focus({ preventScroll: true });
  setDirty(true, pageIndexOf(body));
  if (settle) afterTextChange();
}
/**
 * One step back (or forward): a page, or every page of a batch — and where
 * the batch is a folder-wide replace, every document it changed off the
 * screen too, through its journal (revertFolderReplace), wherever each
 * document now is.
 */
function stepHistory(from, to) {
  if (refuseWhileBusy()) return;
  const top = from[from.length - 1];
  if (!top) return;
  // A FOLDER REPLACE IS NOT TAKEN BACK BEHIND THE OPERATOR'S BACK. Its step
  // outlives the document it was made in, so a Ctrl+Z pressed in another
  // document — one the replace never touched, protected, with no steps of its
  // own — used to put back every document the replace changed, saved ones
  // included, with nothing on the page moving and nothing said; the next
  // Ctrl+S then wrote the old text back into all of them. Where none of its
  // pages is on screen to be seen coming back, or a document of it has been
  // written since, the question ↶ Undo replace in folder asks is asked first.
  if (top.batch) {
    let k = from.length;
    while (k > 0 && from[k - 1].batch === top.batch) k--;
    const step = from.slice(k);
    const mk = step.find((snap) => snap.folderReplace);
    if (mk && !askFolderStep(mk.folderReplace, from === undoStack ? "undo" : "redo", step.some((snap) => !snap.folderReplace && bodyForPage(snap.page)))) return;
  }
  const all = top.batch ? [] : [from.pop()];
  while (top.batch && from.length && from[from.length - 1].batch === top.batch) all.push(from.pop());
  const marker = all.find((snap) => snap.folderReplace);
  const pages = all.filter((snap) => !snap.folderReplace);
  // A step that also turned the page's PDF view on or off (⊘ Did not OCR,
  // ↻ OCR This Page) turns it back with the text, so what comes back is
  // seen: the text shown before it is put back (it takes the caret), the
  // PDF page after. A batch (⊘ Did not OCR on the Pages tab's ticked pages)
  // turns all of its views in one pass, not a pass of every page per page.
  const shown = (snap) => (snap.view ? (from === undoStack ? !snap.view.on : snap.view.on) : null);
  setPageSwaps(pages.filter((snap) => shown(snap) === false).map((snap) => snap.view.key), false);
  const restored = new Set();
  for (const snap of pages) {
    const body = bodyForPage(snap.page);
    // …with the strip's tag: the two sides of one step (strippedTextOf).
    if (body) to.push({ ...snapshotOf(body), batch: snap.batch, nocr: snap.nocr, view: snap.view });
    else {
      // A shed page: its other side is the text the reel keeps for it.
      const m = reelMemberOf(snap.page);
      if (m && m.shed && doc.pages[snap.page]) to.push({ page: snap.page, text: doc.pages[snap.page].lines.join("\n"), caret: -1, spots: TD.spotsOnPage(m.spots || [], snap.page), batch: snap.batch, nocr: snap.nocr, view: snap.view });
    }
    restoreSnapshot(snap, { settle: pages.length === 1, lists: pages.length === 1 });
    const m = reelMemberOf(snap.page);
    if (m) restored.add(m.name);
  }
  // …and a batch's pages go on or off the page lists in one pass: page by
  // page, a hundred stripped pages were a hundred passes over the lists.
  if (pages.length > 1) syncNoOcr(pages.map((snap) => snap.page), { drop: true });
  setPageSwaps(pages.filter((snap) => shown(snap) === true).map((snap) => snap.view.key), true);
  if (marker) {
    // The documents whose pages were just put back are done; the rest are
    // found by name in the store, on the reel, or saved since — and what
    // happened is always said, since most of it happens off the screen.
    const undoing = from === undoStack;
    const rec = replaceJournal.find((x) => x.id === marker.folderReplace);
    const r = revertFolderReplace(marker.folderReplace, undoing ? "undo" : "redo", { skip: restored });
    to.push(marker);
    if (r && rec) {
      const k = r.done.length;
      const docs = `${k} document${k === 1 ? "" : "s"}`;
      toast((undoing
        ? `Put back ${docs} as ${k === 1 ? "it was" : "they were"} before replacing “${rec.q}” — unsaved; Ctrl+S writes ${k === 1 ? "it" : "them"}, Ctrl+Y does the replace again.`
        : `Replaced “${rec.q}”${rec.withText ? ` with “${rec.withText}”` : ""} again in ${docs} — unsaved; Ctrl+S writes ${k === 1 ? "it" : "them"}, Ctrl+Z puts ${k === 1 ? "it" : "them"} back.`)
        + (r.left.length ? ` Left as ${r.left.length === 1 ? "it is" : "they are"}: ${nameList(r.left.map((n) => TD.docLabel(n)))} (changed since the replace).` : ""),
        { error: !!r.left.length, ms: 9000 });
    }
  }
  // A document of the folder taken back to the very text its file holds has
  // nothing unsaved in it: undoing an edit, or a whole Replace all, clears it.
  let cleaned = false;
  for (const m of reel) {
    if (!m.dirty || !m.d || !m.base || !restored.has(m.name)) continue;
    if (TD.serializeExport(liveMemberDoc(m)) === m.base.opened) { m.dirty = false; cleaned = true; }
  }
  if (cleaned) { dirty = reel.some((m) => m.dirty); updateDirty(); markDocList(); }
  if (pages.length > 1 || (marker && pages.length !== 1)) afterTextChange();
  lastSnapPage = -1;
}
function undo() { stepHistory(undoStack, redoStack); }
function redo() { stepHistory(redoStack, undoStack); }
/**
 * Whether a Ctrl+Z (or Ctrl+Y) may go on into a folder replace: asked where
 * none of its documents is on screen to be seen changing (`seen`: a page of
 * the step on the page; else a document of it live on the reel), or a
 * document of it has been written since — the same question ↶ Undo replace in
 * folder asks. True where the step goes ahead.
 */
function askFolderStep(id, dir, seen) {
  const rec = replaceJournal.find((x) => x.id === id);
  if (!rec) return true; // nothing held for it: the step's pages alone
  const written = rec.docs.some((x) => x.writtenText != null || x.savedOther);
  const onScreen = seen || rec.docs.some((x) => reel.some((m) => m.name === x.name && !m.shed && (!m.d || !x.d || m.d === x.d)));
  if (onScreen && !written) return true;
  const n = rec.docs.length;
  const docs = `${n} document${n === 1 ? "" : "s"}`;
  const what = `replacing “${rec.q}”${rec.withText ? ` with “${rec.withText}”` : ""}`;
  return confirm(dir === "undo"
    ? `Ctrl+Z here takes back a Replace all across the folder: put back the ${docs} changed by ${what}? They become unsaved; Save writes them.${written ? " Some were saved since: Save writes their old text back." : ""} A document changed since the replace is left as it is.`
    : `Ctrl+Y here does a Replace all across the folder again: ${what} in the ${docs} it changed? They become unsaved; Save writes them. A document changed since is left as it is.`);
}
// A document's own steps end with it; a folder replace's stays, one step of
// the history wherever its documents have gone (revertFolderReplace).
function clearHistory() {
  undoStack = undoStack.filter((s) => s.folderReplace);
  redoStack = redoStack.filter((s) => s.folderReplace);
  lastSnapPage = -1;
}
pagesEl.addEventListener("beforeinput", (e) => {
  const body = e.target && e.target.closest && e.target.closest(".page-body");
  if (!body) return;
  if (shotPut) { e.preventDefault(); return; } // the screenshot's fakes are on the page, not in it
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
  if (k !== "z" && k !== "y") return;
  // A field being typed in keeps its own undo: Ctrl+Z in the Replace-with box
  // takes back the letter typed there, not a Replace all across the folder.
  // The pages are the reader's — and so is a key pressed with nothing typed
  // into focused (the page as a whole, a button, a checkbox just ticked).
  const t = e.target;
  const typed = "textarea, input:not([type]), input[type=text], input[type=search], input[type=number], input[type=email], input[type=url], input[type=tel], input[type=password]";
  if (t && t.closest && (t.closest(typed) || (t.isContentEditable && !t.closest("#pages .page-body")))) return;
  if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
  else { e.preventDefault(); redo(); }
}, true);
// What a closing tab would leave behind: an edited document unsaved — the one
// on screen, or any document of the folder edited and left (the store), a
// flagged list never written to the case folder, LEAKS decisions not yet in
// the workbook, a name said to be faked that no save has written yet,
// anywhere in the folder, a Master Keep removal the workbook refused, or a
// real name the key binds still standing in the clear in the document on
// screen. The decisions survive the close — they are remembered here — but
// nothing downstream has them: PDF-Linker reads the folder, and the folder
// has not been told.
//
// THE LAST ONE IS THE FILE ITSELF. A name the run left in the clear is a real
// value sitting in a scrubbed export, and until someone decides it — fake it,
// or keep it — not even a save writes the pseudonym over it (standingSpans).
// Closing on one that was decided and not yet saved loses the decision;
// closing on one nobody decided loses nothing, but leaves the file carrying a
// real value while the operator believes the document has been read, and
// that is the mistake this whole tool exists to prevent. Better a prompt that
// sometimes says what you already knew than a close that quietly leaves a
// name in a filing.
//
// The browser's own dialog is all a page gets; which of the four it is, the
// panels and the status bar say.
window.addEventListener("beforeunload", (e) => {
  if (!hasUnsaved() && !standingInTheClear()) return;
  e.preventDefault();
  e.returnValue = "";
});
/** Whether anything is owed to the files: a document unsaved anywhere in the folder, a decision not yet written. */
function hasUnsaved() {
  return dirty || anyUnsavedDocs() || valuesDirty() || leaksDirty() || masterPending.length > 0 || decidedOwed().names > 0;
}

/**
 * A real value typed into the plain text becomes a pseudonym span as soon as
 * the caret has left it — the real name stays on screen, the fake goes
 * underneath, exactly as if the document had carried it. A match the caret is
 * still inside is left alone (it may be the front of a longer name).
 *
 * TYPED, AND ONLY TYPED. A real name the page already carried is not marked
 * because something else on the page was typed: one the run missed is the
 * review's to decide (the save leaves an undecided one where it stands), and
 * a cited decision's party is never faked, typed or not — the pseudonym would
 * be a citation to a case that does not exist. It used to mark every real
 * name in the page's plain text on any edit of the page, both of those with
 * it. What the edit wrote is read off the page's text against the text it was
 * built from (textdoc.typedReals).
 */
const convertTypedRealsSoon = debounce(convertTypedReals, 250);
/**
 * How many it marked; `quiet` leaves the toast and the re-read to the caller
 * (a replace). `caret: false` marks the name the caret is in too: the page is
 * being set aside (stashReel), and nothing more will be typed onto that name.
 */
function convertTypedReals(body, { quiet = false, caret = true } = {}) {
  if (!fwd || !fwd.rx || !body.isConnected) return 0;
  body.normalize();
  const sel = caret ? document.getSelection() : null;
  const caretNode = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
  const caretOff = sel && sel.rangeCount ? sel.getRangeAt(0).startOffset : -1;
  const segs = plainSegments(body).map((seg) => ({ node: seg.node, text: maskKept(seg.text) }));
  const found = TD.findRealsInPlain(fwd, segs);
  const hits = found.length ? TD.typedReals(found, TD.serializeMapped(body), body.__built) : found;
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
  // A name marked while the citation it belongs to was still being typed — at
  // the Space prompt, or in a pause before the "supra" — goes back to the name
  // typed once the citation is whole: a pseudonym there would be a citation to
  // a case that does not exist. Only a mark an edit made; the page's own stay.
  let back = 0;
  if (body.querySelector(".pn")) {
    for (const el of TD.typedPseudonymsCited(TD.serializeMapped(body), body.__built)) {
      if (!el.isConnected) continue;
      if (!made && !back) snapshot(body, true);
      el.replaceWith(document.createTextNode(el.dataset.real));
      back++;
    }
    if (back) body.normalize();
  }
  if ((made || back) && !quiet) {
    const notes = [];
    if (made) notes.push(`${made} real name${made === 1 ? "" : "s"} marked — the file will carry the pseudonym${made === 1 ? "" : "s"}`);
    if (back) notes.push(`${back} left as typed — ${back === 1 ? "a party" : "parties"} to a cited decision, never a pseudonym`);
    toast(notes.join(" · "));
    afterTextChange();
  }
  return made;
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
//
// EVERY DOCUMENT OF THE FOLDER, AND EVERY DECISION, IN ONE SAVE. With a case
// folder open in full, Save writes every document of it that is owed: the ones
// on screen that were edited, every one in the store (edited and left, or
// changed by a folder-wide Replace all), and every one where a name said to be
// faked still stands unfaked, opened or not — asked first about any never
// opened this session. The documents off the screen go through the same
// per-page pass as the ones on it (savePage), on pages built for them where a
// real name stands (textdoc.pageScan says which). Then the decision files:
// New Real Values.txt, LEAKS.xlsx, and a Master Keep removal still owed.
//
// Nothing is written until every document has passed the standing assertion;
// in folder mode each is then written in place through its own handle — no
// picker, no download — and only where the disk still reads the text the edits
// started from: a file PDF-Linker or another window has written since is not
// written over, and stays unsaved, named. One that cannot be written is named
// and the others are written. A save never clears an edit made while it ran.
/**
 * Writes what the files are owed; false where anything attempted was not
 * written. `offscreen: false` is the walks' save on the way out of a document:
 * the reel and the decision files, nothing off the screen — but written the
 * folder's way all the same (in place, after the content check, never a picker
 * or a download), since what it writes is one of the folder's documents.
 */
async function saveDocument({ offscreen = true } = {}) {
  const inFolder = folderOpen();
  if (!doc && !(inFolder && offscreen && unsavedDocs.size)) return false;
  if (refuseWhileBusy()) return false;
  if (opening) { toast("Wait for the document to open."); return false; }
  // Before anything awaits: the folder's grant, asked while the click or the
  // key still counts as one (there is no prompt where it is granted already),
  // and each member's count of edits, so one made while this runs stays unsaved.
  let grant;
  try { grant = inFolder && dirHandle.requestPermission ? dirHandle.requestPermission({ mode: "readwrite" }).catch(() => "denied") : Promise.resolve("granted"); }
  catch { grant = Promise.resolve("denied"); }
  const seqAt = new Map(reel.map((m) => [m, m.editSeq || 0]));
  saving = true;
  saveNote = "";
  updateDirty();
  try {
    return await saveNow({ inFolder, offscreen, grant, seqAt });
  } finally {
    saving = false;
    savePass = null;
    saveNote = "";
    clearShadow();
    // A member the forward pass changed and the save did not then write (the
    // assertion, the grant, Esc, a conflict, a file that would not take it)
    // has pages saying what its file does not: unsaved, so the status bar,
    // the closing prompt and the next save all know it. Left clean, its names
    // stood as pseudonyms on the page, counted nowhere, while the file still
    // carried them real — and the next save, finding nothing left to swap,
    // passed it by.
    if (saveTouched) {
      for (const m of saveTouched.touched) if (m && reel.includes(m) && !saveTouched.wrote.has(m)) m.dirty = true;
      saveTouched = null;
      dirty = reel.some((m) => m.dirty);
      markDocList();
    }
    updateDirty();
  }
}

/**
 * One page through the save: the decided names standing in its clear written
 * as their pseudonyms, the undecided ones left and named. `rebuild(text,
 * spots)` builds the page again from the forwarded text, with its spot keeps
 * moved to where the pass put them (textdoc.spotsAfterSwaps — counted before
 * the pass, a keep after a faked occurrence would point past the end). The
 * page may be on screen or built off it. → { text, swaps, left, stuck, scan,
 * pageSpots }: the text to write, the names written, the undecided names
 * standing ({ real, ranges }), the decided ones the pass could not reach, the
 * text the standing assertion reads, and the page's spots after the pass
 * (null where it made no swap).
 */
function savePage(body, i, rebuild) {
  let { text, held, pns } = TD.serializeHeld(body);
  let standing = standingSpans(text, held, pns);
  let left = standing.filter((h) => !isSettled(h.real));
  let swaps = 0, pageSpots = null;
  if (fwd && fwd.rx) {
    const fw = forwardText(text, held, pns, left.flatMap((h) => h.ranges));
    if (fw.swaps) {
      swaps = fw.swaps;
      pageSpots = TD.spotsAfterSwaps(i, text, held, fw.places, fw.text);
      rebuild(fw.text, pageSpots);
      ({ text, held, pns } = TD.serializeHeld(body)); // the rebuilt page, its spots and fakes found again
      standing = standingSpans(text, held, pns); // …and the names left, where they now stand
      left = standing.filter((h) => !isSettled(h.real));
    }
  }
  const stuck = standing.filter((h) => isSettled(h.real)).map((h) => h.real);
  // The undecided names are in the file because the save left them there, as
  // it leaves a kept one: the assertion reads past them too — and past the
  // run's fakes and the cited decisions' names, read as the page reads them,
  // which are what the forward pass left alone.
  const scan = TD.blankRanges(text, held.concat(pns, diskReading(text, held, pns).cited, left.flatMap((h) => h.ranges)));
  return { text, swaps, left, stuck, scan, pageSpots };
}

/**
 * A document off the screen made ready to write: from the store, or read off
 * its file for the names said to be faked. Page by page — a page where no real
 * stands (textdoc.pageScan) is written as it is, and only the rest are built
 * off the screen and put through savePage. → { d, entry, seq, parsed, base,
 * spots, scan, swaps, waiting, stuck, before, text }, or null where `pass`
 * was stopped.
 */
async function prepareOffscreenSave(t, pass) {
  const { d, entry } = t;
  let parsed, base, built, docSpots;
  if (entry) {
    parsed = TD.cloneDoc(entry.doc);
    base = entry.base;
    built = entry.built || [];
    docSpots = TD.normalizeSpots(entry.spots);
  } else {
    const r = await readDoc(d);
    parsed = readExport(r.text);
    base = { text: r.text, stamp: r.stamp, opened: TD.serializeExport(parsed) };
    built = parsed.pages.map((p) => p.lines.join("\n"));
    docSpots = TD.normalizeSpots(lsGet(spotKeyOf(d.name), []));
  }
  const before = TD.serializeExport(parsed);
  const scan = [];
  let swaps = 0;
  const waiting = [], stuck = [];
  let clock = await idleClock();
  for (let i = 0; i < parsed.pages.length; i++) {
    if (pass.stop) return null;
    const raw = parsed.pages[i].lines.join("\n");
    const ps = TD.pageScan(raw, { rev, reals, spots: TD.spotsOnPage(docSpots, i), mask: maskKept });
    // A page an edit changed goes through the page too, whatever the scan says.
    const edited = !!entry && built[i] != null && built[i] !== raw;
    if (!ps.needs && !edited) { scan.push(ps.scan); continue; }
    batchEdit = true;
    try {
      const body = shadowPage(parsed.pages, i, docSpots, built[i]);
      const r = savePage(body, i, (text, s) => buildBody(body, text, i, s));
      swaps += r.swaps;
      if (r.pageSpots) docSpots = docSpots.filter((x) => x.page !== i).concat(r.pageSpots);
      parsed.pages[i].lines = r.text.split("\n");
      scan.push(r.scan);
      for (const h of r.left) waiting.push(h.real);
      for (const v of r.stuck) stuck.push(v);
    } finally { batchEdit = false; clearShadow(); }
    if (!clock || clock.timeRemaining() < SLICE_LEFT) clock = await idleClock();
  }
  return { d, entry, seq: entry ? entry.seq : null, parsed, base, spots: docSpots, scan, swaps, waiting, stuck, before, text: TD.serializeExport(parsed) };
}

/** Write text into a file of the folder, in place: no picker and no download, whatever goes wrong. → { ok, why } */
async function writeInPlace(handle, text) {
  let w = null;
  try {
    w = await handle.createWritable();
    await w.write(new Blob([text], { type: "text/plain" }));
    await w.close();
    return { ok: true };
  } catch (e) {
    try { if (w) await w.abort(); } catch { /* gone already */ }
    return { ok: false, why: (e && e.name ? e.name + ": " : "") + ((e && e.message) || String(e)) };
  }
}
/** Whether a document's file still reads the text its edits started from: "ok", "changed", or "gone". */
async function diskStill(d, base) {
  if (!base || typeof base.text !== "string") return "ok";
  try { return (await (await d.handle.getFile()).text()) === base.text ? "ok" : "changed"; }
  catch { return "gone"; }
}

async function saveNow({ inFolder, offscreen, grant, seqAt }) {
  const keyAt = { rev, fwd, reals };
  // The names said to be faked reach a member the reel has let go of too: it
  // is built back, so the pass over the pages on screen covers it.
  if (doc && (settled.size || sheetFakes.size) && reel.some((m) => m.shed)) reelAllLive();
  let forwarded = 0;
  // Each page as it will be written, and the same text with its spot keeps
  // blanked — what the standing assertion below is allowed to look at.
  const scan = [];
  // The members the forward pass changed, on top of the ones already edited.
  const touched = new Set();
  saveTouched = { touched, wrote: new Set() };
  // The names left standing because nobody has decided on them (standingSpans):
  // by member, for the sweep, and all together, for the warning.
  const waitingIn = new Set();
  const waiting = [];
  // …and the names SETTLED that are standing all the same once the forward
  // pass is done. There should be none; a settled name the save could not
  // reach used to stay orange, out of the walk, save after save, with nothing
  // said. Now it is named.
  const stuck = [];
  // The documents a folder replace is holding, each member's text as it stood
  // before the pass: what a save of one tells the replace's journal.
  const journalled = new Set(replaceJournal.filter((r) => r.state === "done").flatMap((r) => r.docs.map((x) => x.name)));
  const textBefore = new Map();
  // The spot keeps the forward pass moves are held in hand until the member is
  // written, and stored only then (`m.spotsUnstored` — a save that writes
  // nothing leaves it set, for the save that does). Stored at once, a save
  // that then wrote nothing (the assertion, the grant, Esc, the content check)
  // left the store counting occurrences the file on disk does not have yet,
  // and a keep made at the third "Corwin Ashdale" moved to the first once the
  // edits went — so the next save kept the one said to be faked, and faked
  // the one kept.
  if (doc) {
    for (const m of reel) if (journalled.has(m.name)) textBefore.set(m, TD.serializeExport(liveMemberDoc(m)));
    for (const body of pageBodies()) {
      const i = pageIndexOf(body);
      const m = reelMemberOf(i);
      const r = savePage(body, i, (text, s) => {
        snapshot(body, true);
        setSpotsListOf(i, spotsListOf(i).filter((x) => x.page !== i).concat(s));
        buildBody(body, text, i, spotsListOf(i));
        if (m) m.spotsUnstored = true;
      });
      if (r.swaps) { forwarded += r.swaps; touched.add(m); }
      for (const v of r.stuck) stuck.push(v);
      if (r.left.length) {
        waitingIn.add(m);
        for (const h of r.left) waiting.push(h.real);
      }
      doc.pages[i].lines = r.text.split("\n");
      scan[i] = r.scan.split("\n");
    }
    // A page handed to PDF-Linker as typed in by hand (✎ Use my text) carries
    // its text's sum, and PDF-Linker applies it only where the file reads that
    // way: where the reader put margin numbers back on the page (readExport),
    // the file is written with them, or the two would never agree.
    if (textFixed.length) {
      const sources = docPageSources();
      doc.pages.forEach((p, i) => {
        if (!p.restored || !p.restored.length) return;
        const e = pageEntryAt(i, sources);
        if (e && textFixed.some((x) => TD.sameNoOcr(x, e))) touched.add(reelMemberOf(i));
      });
    }
  }
  let write = doc ? reel.filter((m) => m.dirty || touched.has(m)) : [];
  // OFF THE SCREEN: every document in the store, and every document where a
  // name said to be faked still stands — the folder read fresh for those first.
  let off = [];
  // …and whether the folder could be read for those names at all: a reading
  // that would not come fresh writes them nowhere off the screen, which the
  // save says rather than passing for one that found none.
  let elsewhereUnread = false;
  if (inFolder && offscreen) {
    for (const e of unsavedDocs.values()) if (e.d && !onReel(e.d)) off.push({ d: e.d, entry: e, names: [] });
    if (settled.size || sheetFakes.size) {
      if (sweep.running || sweepStale()) {
        saveNote = `Saving… reading ${folderName} for the names you said to fake`;
        updateDirty();
        await sweepNow();
      }
      elsewhereUnread = !!dirHandle && !!reals && (sweep.running || sweepStale());
      for (const x of settledElsewhere({ fresh: true })) {
        const t = off.find((y) => y.d === x.d);
        if (t) t.names = x.names;
        else off.push({ d: x.d, entry: null, names: x.names });
      }
    }
    // A document never opened or hung this session, and named by no confirm
    // before, is not written without the operator being told which and why.
    const unseen = off.filter((t) => !t.entry && !seenDocs.has(t.d.name) && !confirmedDocs.has(t.d.name));
    if (unseen.length) {
      const lines = unseen.slice(0, 6).map((t) => `• ${TD.docLabel(t.d.name)} — ${t.names.map((v) => `“${v}”`).join(", ")}`);
      if (unseen.length > 6) lines.push(`• …and ${unseen.length - 6} more`);
      const n = unseen.length;
      if (confirm(`Save also writes ${n} document${n === 1 ? "" : "s"} you have not opened, where names you said to fake still stand unfaked:\n${lines.join("\n")}\nEach name is written as its pseudonym, as saving an open document writes it (margin numbers the OCR missed go in with it).\n\nOK — write them too.\nCancel — save the rest; these stay to write.`)) {
        for (const t of unseen) confirmedDocs.add(t.d.name);
      } else off = off.filter((t) => !unseen.includes(t));
    }
    off.sort((a, b) => folderDocs.indexOf(a.d) - folderDocs.indexOf(b.d));
  }
  // The pages marked ⊘ Did not OCR follow the text that is about to be
  // written: a page in a file this save writes reads what the file will say.
  if (doc) {
    const writing = new Set(write);
    const all = doc.pages.map((_, i) => i);
    syncNoOcr(all.filter((i) => writing.has(reelMemberOf(i))), { drop: true });
    syncNoOcr(all.filter((i) => !writing.has(reelMemberOf(i))));
  }
  // Nothing about the TEXT changed. If the save was asked for because a flag,
  // a keep or a worksheet row is waiting, write those and leave every file's
  // bytes and timestamp alone; only an otherwise-empty Ctrl+S falls through to
  // rewriting the document being read, which is what it has always meant.
  if (doc && !write.length && !off.length && !pendingWrites().length && reelCurrent()) write = [reelCurrent()];
  // The documents off the screen, made ready one at a time; Esc stops it with
  // nothing written.
  const ready2 = [];
  const unreadable = [];
  if (off.length) {
    const pass = { stop: false };
    savePass = pass;
    for (let k = 0; k < off.length; k++) {
      const t = off[k];
      saveNote = `Saving… ${TD.docLabel(t.d.name)} (${k + 1} of ${off.length}) — Esc stops`;
      updateDirty();
      let r = null;
      try { r = await prepareOffscreenSave(t, pass); }
      catch (err) { console.warn(err); unreadable.push(t.d.name); continue; }
      if (pass.stop) { toast("Save stopped — nothing was written.", { error: true }); return false; }
      if (!r) continue;
      // A document only the names said to be faked brought in is written only
      // where the pass changed something in it.
      if (!r.entry && !r.swaps) continue;
      ready2.push(r);
      forwarded += r.swaps;
      for (const v of r.stuck) stuck.push(v);
      for (const v of r.waiting) waiting.push(`${v} (${TD.docLabel(r.d.name)})`);
    }
    savePass = null;
  }
  // The key moved while the folder was being read: what was made ready was made
  // under the other one.
  if (rev !== keyAt.rev || fwd !== keyAt.fwd || reals !== keyAt.reals) {
    toast("The key changed while the save was running — nothing was written. Save again.", { error: true, ms: 9000 });
    return false;
  }
  // The standing assertion, per file. Nothing above should let a DECIDED real
  // value through, and if something did the save must not — and it must not
  // write any of the others on the strength of this one being clean, so every
  // file about to be written is read first and one failure stops the lot. A
  // value kept where it stands may pass: it is in the file because the
  // operator put it there, so the assertion reads the export with those places
  // blanked. So may a name nobody has decided on yet, which the save left
  // where it found it and the warning below names.
  const many = write.length + ready2.length > 1;
  if (reals) {
    for (const m of write) {
      const held = TD.serializeExport(memberDoc(m, (p, i) => Object.assign({}, p, { lines: scan[i] || p.lines })));
      // …a name wrapped down a column included, its cells read off the file
      // as it is about to be written (the blanks above are the same length).
      const left = TD.realsLeftInExport(TD.serializeExport(memberDoc(m)), held, { reals, mask: maskKept });
      if (left.length) {
        toast(`Not saved: ${m.name} still carries a real name the key binds — ` + left.slice(0, 4).map((w) => w.real).join(", ") + (left.length > 4 ? "…" : "") + ". Delete or retype it and save again." + (many ? " Nothing was written." : ""), { error: true, ms: 12000 });
        return false;
      }
    }
    for (const r of ready2) {
      const held = TD.serializeExport({ newline: r.parsed.newline, trailingNewline: r.parsed.trailingNewline, pages: r.parsed.pages.map((p, k) => ({ ...p, lines: r.scan[k].split("\n") })) });
      const left = TD.realsLeftInExport(r.text, held, { reals, mask: maskKept });
      if (left.length) {
        toast(`Not saved: ${r.d.name} still carries a real name the key binds — ` + left.slice(0, 4).map((w) => w.real).join(", ") + (left.length > 4 ? "…" : "") + " (not on screen — open it from the Documents list). Delete or retype it and save again. Nothing was written.", { error: true, ms: 12000 });
        return false;
      }
    }
  }
  if (inFolder && (write.length || ready2.length) && (await grant) !== "granted") {
    toast(`Not saved: the browser did not let the reader write into ${folderName}. Nothing was written; your edits are kept.`, { error: true, ms: 9000 });
    return false;
  }
  const wrote = [];
  const conflicts = [], failed = [];
  const wroteMembers = [];
  let wroteOff = 0;
  // The journal of a folder replace learns what a save wrote of one of its
  // documents, so a Ctrl+Z after the save finds it (revertFolderReplace): the
  // text the replace left (or the text a save of it wrote before), written —
  // or other text, edited since, which an undo must leave as it is and name.
  const noteWritten = (name, before, written, spotsNow) => {
    for (const rec of replaceJournal) {
      if (rec.state !== "done") continue;
      const x = rec.docs.find((y) => y.name === name);
      if (!x) continue;
      x.dropped = false;
      if (before === x.afterText || (x.writtenText != null && before === x.writtenText)) {
        x.writtenText = written; x.writtenSpots = spotsNow; x.savedOther = false;
      } else { x.writtenText = null; x.writtenSpots = null; x.savedOther = true; }
    }
  };
  for (const m of write) {
    const text = TD.serializeExport(memberDoc(m));
    saveNote = `Saving… ${TD.docLabel(m.name)}`;
    updateDirty();
    if (inFolder && m.d) {
      const c = await diskStill(m.d, m.base);
      if (c !== "ok") {
        m.conflict = c === "changed";
        (c === "changed" ? conflicts : failed).push(c === "changed" ? m.name : { name: m.name, why: "no longer in the folder" });
        continue;
      }
      const w = await writeInPlace(m.d.handle, text);
      if (!w.ok) { failed.push({ name: m.name, why: w.why }); continue; }
    } else {
      const ok = await writeText(text, m.name, m.handle, { adopt: reel.length === 1 });
      if (!ok) {
        if (wrote.length) toast(`Saved ${wrote.join(", ")} — ${m.name} was not written.`, { error: true });
        return false;
      }
    }
    // Clean only where nothing was typed into it while the save ran.
    if ((m.editSeq || 0) === seqAt.get(m)) m.dirty = false;
    m.conflict = false;
    // Its spot keeps as the file now counts them, stored now that it does.
    if (m.spotsUnstored) { persistMemberSpots(m); m.spotsUnstored = false; }
    saveTouched.wrote.add(m);
    m.base = { text, stamp: null, opened: text };
    m.built = null;
    wrote.push(m.name);
    wroteMembers.push(m);
    // What was written is what each page of it now is: a real name typed and
    // left standing went into the file with it, and is the review's from here
    // on, not the typing's (convertTypedReals).
    for (let i = m.from; i < m.from + m.count; i++) {
      const b = bodyForPage(i);
      if (b) b.__built = doc.pages[i].lines.join("\n");
      // …and the margin numbers put back on it are the file's own now.
      if (doc.pages[i].restored) {
        doc.pages[i].restored = null;
        if (b) {
          b.__restored = null;
          for (const g of b.querySelectorAll(".gutter.restored")) { g.classList.remove("restored"); g.removeAttribute("title"); }
        }
      }
    }
    if (textBefore.has(m)) noteWritten(m.name, textBefore.get(m), text, memberSpotsRel(m));
    // The save wrote every DECIDED name standing in the clear in this one;
    // where that was all of them, the folder's answer for the document is that
    // it has none. Where undecided ones are left, its row stands — the walk
    // reads it past the settled names, which are the ones just written.
    if (!waitingIn.has(m)) sweep.rows = sweep.rows.filter((r) => r.doc.handle !== m.handle);
  }
  for (const r of ready2) {
    saveNote = `Saving… ${TD.docLabel(r.d.name)}`;
    updateDirty();
    const c = await diskStill(r.d, r.base);
    if (c !== "ok") {
      if (r.entry && c === "changed") r.entry.conflict = true;
      (c === "changed" ? conflicts : failed).push(c === "changed" ? r.d.name : { name: r.d.name, why: "no longer in the folder" });
      continue;
    }
    const w = await writeInPlace(r.d.handle, r.text);
    if (!w.ok) { failed.push({ name: r.d.name, why: w.why }); continue; }
    wrote.push(r.d.name);
    wroteOff++;
    const e = unsavedDocs.get(r.d.name);
    if (e && e === r.entry && e.seq === r.seq) { unsavedDocs.delete(r.d.name); unsavedSeq++; }
    // Its spot keeps under its own name, as pages of its own — where it has
    // any, or had a list stored already.
    if (r.swaps || r.spots.length || lsGet(spotKeyOf(r.d.name), null) != null) lsSet(spotKeyOf(r.d.name), r.spots);
    noteWritten(r.d.name, r.before, r.text, r.spots.slice());
    // Its page lists, as the file now reads.
    if (flagsFor === valuesStoreKey()) {
      const pdf = pdfForName(r.d.name) || "";
      const items = [], sums = [];
      for (const p of r.parsed.pages) {
        const page = PS.pdfPageOf(p);
        if (p.header == null || !page) continue;
        const entry = { doc: r.d.name, pdf, page };
        items.push({ entry, page: p });
        sums.push({ entry, lines: p.lines });
      }
      const next = TD.pageListsAfter({ noOcr, ocrAgain, textFixed }, items, { drop: true });
      const fixed = TD.fixedSumsFor(next.textFixed, sums);
      if (next.noOcr !== noOcr || next.ocrAgain !== ocrAgain || fixed !== textFixed) {
        noOcr = next.noOcr; ocrAgain = next.ocrAgain; textFixed = fixed;
        persistValues();
        renderFlags();
      }
    }
    findShown.texts.delete(r.d.handle);
    ready.delete(r.d.name);
  }
  saveNote = "";
  dirty = reel.some((m) => m.dirty);
  // A transcribed page's line carries the page's text as it was just WRITTEN
  // (TD.pageTextSum), so PDF-Linker applies the text the operator saved and
  // nothing older or newer — the pages of the documents written, and no others.
  if (wroteMembers.length) refreshTextFixedSums(wroteMembers);
  // Written off the screen: what the folder was read for is to be read again.
  if (wroteOff) {
    dropSweep();
    caseFakes = { key: null, docs: null, set: null };
  }
  if (wrote.length) { findScanFor = null; findRows = []; scanFindFolder(); }
  // THE LIST GOES WITH IT. The flags and keeps are half of the same decision
  // the document carries — a value kept is a value this save left standing —
  // and a list still sitting in the browser is a run's worth of work the next
  // run will not do. Written into the case folder without asking, that being
  // where PDF-Linker reads it; where there is no folder there is nobody to
  // write it for, and the save says so rather than opening a picker nobody
  // asked for.
  let alsoList = "";
  let filesOk = true;
  let spentWarn = "";
  if (valuesDirty()) {
    const ok = await saveValuesFile({ quiet: true, folderOnly: true });
    filesOk = filesOk && !!ok;
    // "spent": PDF-Linker had spent all the list still owed the file, and
    // nothing was left to write.
    alsoList = ok === "spent" ? ""
      : ok ? ` · ${TD.VALUES_FILE} written too (${flagged.length} to fake, ${keeps.length} to keep${pageListsNote()})`
        : " · the flagged list is still unwritten — no case folder is open, so save it from the Flagged panel";
    // A keep PDF-Linker took out of the file that the master workbook does not
    // hold is off the list, and the save says so where it is read.
    if (valuesSpentNote) spentWarn = " · ⚠ " + valuesSpentNote;
  }
  // …and the worksheet, for the same reason: the rows answered while reading
  // this document are decisions about this document, and a decision left in
  // the browser is one PDF-Linker's next run will not see. Written in place,
  // through the worksheet's own handle or the case folder's; where there is
  // neither there is nobody to write it for, and the save says so.
  if (leaksDirty()) {
    const n = await saveLeaks({ quiet: true, folderOnly: true });
    filesOk = filesOk && !!n;
    alsoList += n
      ? ` · ${leaks.name} written too (${n} decision${n === 1 ? "" : "s"})`
      : " · the LEAKS decisions are still unwritten — save them from the ⚠ Leaks bar";
  }
  // …and a value taken off the Master Keep that the workbook would not let go
  // of, where the workbook may be written now without asking.
  if (masterPending.length && masterHandle && (await permissionOf(masterHandle, "readwrite")) === "granted") {
    const w = await writeMasterWithdrawn(masterPending.slice());
    if (w.ok) {
      const n = masterPending.length;
      masterPending = [];
      alsoList += ` · the Master Keep removal written too (${n} value${n === 1 ? "" : "s"})`;
      try { await readMaster(masterHandle, { quiet: true }); } catch (e) { console.warn(e); }
    } else filesOk = false;
  }
  if (forwarded) afterTextChange();
  updateDirty();
  markDocList();
  // After a save of names said to be faked, the folder is read again for any
  // still standing, so the status bar can say.
  if (wroteOff && (settled.size || sheetFakes.size)) sweepFolder();
  // THE WARNING. A save before the review is over is allowed — the edits and
  // the decisions taken so far are worth having on disk — but it must not pass
  // for a finished one: the names nobody has looked at are still real names in
  // a scrubbed export, and the save says so, by name, in red.
  const names = [...new Set(waiting.map((v) => String(v).trim()))];
  const warn = waiting.length
    ? ` · ⚠ ${waiting.length} real name${waiting.length === 1 ? "" : "s"} not yet reviewed ${waiting.length === 1 ? "was" : "were"} NOT faked — `
      + names.slice(0, 4).join(", ") + (names.length > 4 ? "…" : "")
      + (waiting.length === 1
        ? ". It stands in the file as it did; step to it from the ⚠ count, decide it, and save again."
        : ". They stand in the file as they did; step through them from the ⚠ count, decide each, and save again.")
    : "";
  const stuckNames = [...new Set(stuck.map((v) => String(v).trim()))];
  const stuckWarn = stuck.length
    ? ` · ⚠ ${stuck.length} name${stuck.length === 1 ? "" : "s"} you said to fake could not be written as ${stuck.length === 1 ? "its pseudonym" : "pseudonyms"} where ${stuck.length === 1 ? "it stands" : "they stand"} — `
      + stuckNames.slice(0, 4).join(", ") + (stuckNames.length > 4 ? "…" : "")
      + ". Retype or keep " + (stuck.length === 1 ? "it" : "them") + " by hand."
    : "";
  const conflictWarn = conflicts.map((n) => ` · ⚠ ${TD.docLabel(n)} changed on disk after your edits (PDF-Linker or another window wrote it) — not written; still unsaved. Open it to see your version, or take the disk's.`).join("");
  const failWarn = failed.map((f) => ` · ⚠ ${TD.docLabel(f.name)} could not be written (${f.why}) — still unsaved.`).join("")
    + (unreadable.length ? ` · ⚠ ${nameList(unreadable.map((n) => TD.docLabel(n)))} could not be read, so ${unreadable.length === 1 ? "it was" : "they were"} not written.` : "");
  const combined = wrote.length && folderDocs.some((d) => d.combined) ? ` · ${TD.COMBINED_FILE} is behind the exports until PDF-Linker's next run (or Apply Fixes).` : "";
  const unreadWarn = elsewhereUnread ? ` · ⚠ ${folderName} could not be read through for the names you said to fake, so none was written off the screen — save again.` : "";
  const red = warn || stuckWarn || conflictWarn || failWarn || unreadWarn || spentWarn;
  // Named in the folder's order, six at most: a save of forty documents is not
  // a toast of forty names. And what went wrong first, where it is read — a
  // warning after a long list of names was a warning nobody saw.
  const order = inFolderOrder(wrote);
  const shown = wrote.length > 1 ? nameList(order.map((n) => TD.docLabel(n))) : order.join(", ");
  const said = (!wrote.length
    ? (alsoList ? "Saved" + alsoList.replace(/^ · /, " ").replace(/ written too /g, " ") : conflicts.length || failed.length ? "Nothing was written" : "Nothing to save.")
    : (wrote.length > 1 ? `Saved ${wrote.length} documents: ` : "Saved ") + shown +
      (forwarded ? ` · ${forwarded} real name${forwarded === 1 ? "" : "s"} written as pseudonym${forwarded === 1 ? "" : "s"}` : "") + alsoList)
    + combined;
  const reds = (conflictWarn + failWarn + unreadWarn + warn + stuckWarn + spentWarn).replace(/^ · /, "");
  toast(red ? reds + " — " + said : said, { error: !!red, ms: red ? 12000 : wrote.length > 1 ? 6000 : undefined });
  return !conflicts.length && !failed.length && !unreadable.length && filesOk;
}
saveBtn.addEventListener("click", () => saveDocument());
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
async function writeText(text, name, handle, { adopt = false, picked = null } = {}) {
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
      if (picked) picked(h); // …and where it went, for a caller that must know (saveValuesFile)
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
  return during('laying the pages out at their width', () => applyPageWidthNow());
}
function applyPageWidthNow() {
  const root = document.documentElement.style;
  root.setProperty("--reader-size-eff", (settings.fontSize * zoomNow()) + "px");
  const w = pageWidthNow();
  const was = getComputedStyle(document.documentElement).getPropertyValue("--reader-width-eff").trim();
  root.setProperty("--reader-width", w + "px");
  root.setProperty("--reader-width-eff", w + "px");
  const st = $("st-lock");
  st.textContent = !doc ? ""
    : pagesEl.querySelector(".tpage.matched")
      ? "Side by side: the text in the PDF's own type sizes, on the PDF's own grid — the reading size has no say while the grid is on"
      : "";
  shapePages();
  // The boxes were last fitted to the paper as it stood (the layout pass runs
  // before this on a zoom or a resize): paper of another width fits them again.
  if (doc && was !== w + "px") fitRuleRows(pagesEl);
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

/**
 * A page as the flagged values are read off it: its text with each pseudonym
 * as the real name it stands for, whichever way Show fakes sits, and `held` —
 * the places of the pseudonyms, the spot keeps and the margin numbers, which
 * no red mark is drawn over (textdoc.clearPieces). A flagged name with a
 * pseudonym in it ("Rosa" in the clear, "Delgado" faked) is found whole and
 * marked where it stands in the clear. A pseudonym's text is in `text` and
 * not in `segs`: nothing is ever put back inside one.
 */
function flagReading(body) {
  const segs = [], held = [];
  let text = "";
  const rec = (n, atStart) => {
    if (n.nodeType === 3) {
      const p = n.parentElement;
      const start = text.length;
      segs.push({ node: n, start, end: start + n.data.length });
      text += n.data;
      if (p && p.closest("[data-here], .gutter")) held.push([start, text.length]);
      return;
    }
    if (n.nodeType !== 1) return;
    if (n.classList && n.classList.contains("pn")) {
      const real = n.dataset.real || n.textContent;
      held.push([text.length, text.length + real.length]);
      text += real;
      return;
    }
    if (n.nodeName === "BR") { if (n.nextSibling) text += "\n"; return; }
    if ((n.nodeName === "DIV" || n.nodeName === "P" || n.nodeName === "LI") && !atStart) text += "\n";
    let first = true;
    for (const c of n.childNodes) { rec(c, first && atStart); first = false; }
  };
  rec(body, true);
  return { text, segs, held };
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
      strips.push({ left: r.left - bodyRect.left, top: r.bottom - bodyRect.top - 6, width: r.width, height: r.height });
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
      p.strips.map((r) => Math.round(r.left) + "," + Math.round(r.top) + "," + Math.round(r.width) + "," + Math.round(r.height)).join(";")).join("\n");
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
        // The strip is only the underline; Shift+Space (shift-space-open.js)
        // grows it up over the words by the height of the line it sits under,
        // so pointing at a citation, or selecting it, is enough.
        a.dataset.textHeight = String(Math.round(r.height));
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
    || scanned.phrases !== phrases || scanned.keeps !== keeps || scanned.master !== masterKeeps || scanned.spots !== spots
    || scanned.sheet !== sheetParsed();
}
function paintHighlights() {
  refreshRawPages(); // a raw page's text, and the names standing in it
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
  paintRowMarks();
  if (marksOff) return; // the words, and nothing read over them
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
 * words on the page, and say so where it will be read. The marks come back
 * with the next document, or with the next key.
 */
function giveUpOnMarks(spent, page, pages) {
  marksOff = true;
  leakHits = [];
  sheetHits = [];
  flaggedHits = new Map();
  scannedDocs = new Set();
  scanSoon.cancel();
  try { CSS.highlights.delete("flagged"); CSS.highlights.delete("leak"); CSS.highlights.delete("kept"); CSS.highlights.delete("leakrows"); } catch { /* none to clear */ }
  $("st-leaks").textContent = "";
  $("st-kept").textContent = "";
  // A walk waiting on this document's reading is waiting on one that is not
  // coming now. It is told so here rather than left on a bar saying "reading".
  if (leakJump || walkOn) { leakJump = false; walkOn = false; stepLeak(1, { auto: true }); }
  offerToCopy(`The marks over the text took more than ${Math.round(spent / 1000)} seconds on this document (page ${page} of ${pages}) and are off for it. The words are all here; the names are not marked.`);
}

/** The current LEAKS row's value, marked wherever it stands — and every other row still to answer. */
function paintRowMarks() {
  return during("marking the worksheet's rows", () => paintRowMarksNow());
}
function paintRowMarksNow() {
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
  leakRowRanges = rowRanges(leakRowValue);
  CSS.highlights.set("leakrow", highlightOf(leakRowRanges.map((x) => x.range)));
  CSS.highlights.set("leakrows", highlightOf(pendingSheetRanges()));
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
  const mark = { epoch: textEpoch, reals, flagged, phrases, keeps, master: masterKeeps, spots, sheet: sheetParsed() };
  const moved = () => mark.epoch !== textEpoch || mark.reals !== reals || mark.flagged !== flagged
    || mark.phrases !== phrases || mark.keeps !== keeps || mark.master !== masterKeeps || mark.spots !== spots
    || mark.sheet !== sheetParsed();
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
  // Every value the LEAKS worksheet has a row for, wherever it stands, so the
  // rows the walk has yet to reach are orange before it gets there. All of
  // them, answered or not: which are still to answer moves with every
  // decision, and is sorted out when the marks are painted
  // (pendingSheetRanges), which a decision does not make this pass again for.
  const sheetRx = sheetMatcher();
  const sheetFound = [];
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
    // NO MARK IS DRAWN OVER THEM — the names in the clear, the kept values or
    // the flagged ones. What a pseudonym span holds is the fake that is IN THE
    // FILE, with the real name painted over it for reading only; no mark that
    // says "this real value is still standing here" may be drawn over one,
    // whichever mark it is. The kept values are read off the page as it shows,
    // pseudonyms blanked; the flagged ones with each pseudonym as its real
    // name, marked only outside it (below); the names in the clear off the
    // disk text.
    const flat = keptRx || sheetRx ? flatten(body, { blankPn: true }) : null;
    if (reals) {
      // The names in the clear are read off the DISK text, exactly as the save
      // reads them (standingSpans): the run's fakes and the spot keeps blanked,
      // the keeps masked, and a name wrapped down a column found with its
      // cells read off the page as the file has it. Read off the screen
      // instead, a real name painted over a fake moves the rest of its line,
      // and a column the save finds the marks would not. Each piece is put
      // back on the page through the text nodes it stands in.
      const disk = TD.serializeHeld(body, { mapped: true });
      const { flat: diskFlat, cited } = diskReading(disk.text, disk.held, disk.pns);
      const masked = maskKept(diskFlat, disk.text);
      // Most of what a key matches in a brief belongs to the decisions it
      // cites, not to this matter. Those are not leaks and are not marked:
      // see textdoc.citedNameSpans, which the save reads the same way.
      let at = 0;
      for (;;) {
        const { spans, next } = PK.findRealSpansFrom(reals, masked, at, HANDFUL, { layout: disk.text });
        for (const h of spans) {
          if (TD.insideCited(cited, h)) continue; // a cited decision's party
          const pieces = h.ranges.map(([a, b]) => rangeFor(disk.segs, a, b));
          if (!pieces.length || pieces.some((r) => !r)) continue;
          for (const r of pieces) leakRanges.push(r);
          hits.push({ range: pieces[0], pieces, real: h.real, fake: h.fake, doc: dname });
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
    if (sheetRx) {
      // Off the page as it shows, pseudonyms blanked, as the row in front is
      // (leakMatches): a value standing inside a pseudonym is faked already.
      const { text, segs } = flat;
      sheetRx.lastIndex = 0;
      let m, n = 0;
      while ((m = sheetRx.exec(text))) {
        const fold = sheetFold(m[0]);
        const r = fold && rangeFor(segs, m.index, m.index + m[0].length);
        if (r) sheetFound.push({ range: r, fold });
        if (m.index === sheetRx.lastIndex) sheetRx.lastIndex++;
        if (++n % HANDFUL === 0) {
          const held = sheetRx.lastIndex;
          if (!(await breathe(`reading the marks over the text${where} — the worksheet's values`))) return gaveUp;
          sheetRx.lastIndex = held;
        }
      }
    }
    if (flagRx) {
      // For the reason above, the red mark is never drawn over a pseudonym:
      // it says the flagged value is standing in the clear and the next run
      // has yet to fake it, and inside a pseudonym span the run has already
      // faked it — the file carries the fake, and only the screen shows the
      // real name. But a flagged NAME may have a pseudonym in it — "Rosa
      // Delgado" flagged where the run faked "Delgado" and missed "Rosa" — so
      // the values are read with each pseudonym as its real name (flagReading)
      // and marked only where they stand in the clear (textdoc.clearPieces):
      // "Rosa", not "Delgado". One standing wholly inside a pseudonym is not
      // marked or counted. A spot keep is held with them: the value stands
      // there because the operator put it back, and it carries its own mark;
      // and so is a margin number a wrapped name runs across.
      const { text, segs: all, held } = flagReading(body);
      flagRx.lastIndex = 0;
      let m, n = 0, mine = 0;
      while ((m = flagRx.exec(text))) {
        const pieces = TD.clearPieces(text, m.index, m.index + m[0].length, held);
        let marked = false;
        for (const [a, b] of pieces) { const r = rangeFor(all, a, b); if (r) { flaggedRanges.push(r); marked = true; } }
        if (marked) mine++;
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
  sheetHits = sheetFound;
  flaggedHits = flagCounts;
  scannedDocs = docsSeen;
  // The master workbook's list says which of its keeps stand here, and this
  // reading is the answer: it is drawn again when the answer moved.
  const keptMoved = seen.size !== keptSeen.size || [...seen].some((v) => !keptSeen.has(v));
  keptSeen = seen;
  if (keptMoved && masterInfo) renderMaster();
  scanned = mark;
  paintedSeq = docSeq;
  // …AND WHICH OF THE DOCUMENTS READ ARE CARRYING NOTHING. Where the walk goes
  // next is the folder SWEEP's answer, read off the files; this is the PAGE's
  // own answer about the documents it has just read, and where the two
  // disagree — a spot keep taken here, a name settled, an edit the file has
  // not been given yet — the page is the one that knows. Without it the walk
  // is sent back to a document it has just finished, finds nothing, and is
  // sent on again: the folder walked in a loop, on its own (leaks.walkStops).
  if (marksCanRead()) {
    const empty = emptyHere();
    for (const name of docsSeen) {
      if (hits.some((h) => h.doc === name && !isSettled(h.real))) empty.delete(name);
      else empty.add(name);
    }
  }
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
let sheetHits = []; // …and each value the LEAKS worksheet has a row for: [{ range, fold }]
let flaggedHits = new Map(); // …and per document on the page, how many flagged values stand in its clear
let scannedDocs = new Set(); // …and which documents that paint actually read (the reel sheds the far end)
let docSeq = 0;              // documents opened, counted: what a reading was made OF
let paintedSeq = -1;         // …and the one the last whole paint was made of
/**
 * Whether the open document's own reading is in — or is never coming, the
 * marks being off for it. Until it is, "nothing here" is the LAST document's
 * answer, hanging off pages that are gone, and it is not an answer about this
 * one: a walk that acts on it leaves a document it never read.
 */
function readHere() { return paintedSeq === docSeq || !marksCanRead(); }
/** Whether the marks — the walk's only reading of the open document — can run here at all. */
function marksCanRead() {
  return !marksOff && "highlights" in CSS && typeof Highlight !== "undefined";
}
// The documents the page has read for itself and found nothing live in — the
// walk does not go back to them. Kept only as long as the question it answers:
// a new key makes every document's reading again, and a new folder is not this
// one. A KEEP does not clear it, and deliberately — a keep only ever takes a
// name out of the clear, so a document found carrying nothing is still
// carrying nothing, and re-opening it to prove that is the very walk this is
// here to stop.
let pageEmpty = new Set();
let emptyStamp = { reals: null, docs: null };
function emptyHere() {
  if (emptyStamp.reals !== reals || emptyStamp.docs !== folderDocs) {
    emptyStamp = { reals, docs: folderDocs };
    pageEmpty = new Set();
  }
  return pageEmpty;
}
let bounces = 0; // documents the walk has opened since it last found anything
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
    ? `⚠ ${leaks} real name${leaks === 1 ? "" : "s"} from the key standing unfaked${more}${settledSay} — the save leaves each as it stands until you decide it; click to step through them, right-click one to keep it`
    : rest.length ? `⚠ none left here, and ${restN} in ${rest.length} other document${rest.length === 1 ? "" : "s"} — click to go on`
    : done ? `⚠ ${done} settled and waiting on the save — Save writes them` : "";
  leakEl.classList.toggle("step", !!leaks || rest.length > 0);
  if (leaks) walkOn = false; // something is standing here: the walk waits on nothing
  if (leakJump && leaks) {
    // A document opened to go on with the walk: stand on its first name.
    leakJump = false;
    leakStep = -1;
    bounces = 0; // …and the walk is getting somewhere, so it is not bouncing
    showNamesBar(true);
  } else if (!leaks) {
    // A DOCUMENT IS NOT EMPTY UNTIL IT HAS BEEN READ. `leakHits` is the last
    // paint's, and between a document opening and its own paint landing the
    // hits in hand belong to the document just left, hanging off pages that
    // are gone — which counts here as none. This is called by the folder sweep
    // as well as by the paint, and a sweep finishing in that window used to
    // take that count for an answer and send the walk straight out of a
    // document it had never read; since opening a document does not change
    // what the sweep read, it went round the folder as fast as files open.
    // The jump waits for the reading made of THIS document (readHere).
    if (leakJump && !readHere()) renderNamesBar();
    else if (leakJump) { leakJump = false; leakStep = -1; stepLeak(1, { auto: true }); }
    else if (walkOn && readHere() && !folderPending()) {
      // The folder has been read again since the last decision: on to whatever
      // it turned out to be carrying, or down if it is carrying nothing.
      walkOn = false;
      leakStep = -1;
      if (rest.length) stepLeak(1, { auto: true });
      else { showNamesBar(false); toast("Nothing the key binds is standing in the clear now."); }
    }
    else if (!rest.length && !folderPending() && !walkOn && readHere()) showNamesBar(false);
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
  // The paint found the names again (an edit, a keep, a document opened for
  // the walk): the pages drawn ahead follow where they now stand.
  if (!namesBar.hidden) planForLeaks();
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
let leakDir = 1;      // which way the walk last went: its next stops are drawn ahead that way
let leakJump = false; // a document opened for the walk: stand on its first name
let walkOn = false;   // …and the walk waiting on the folder to say which document is next
function stepLeak(dir = 1, { auto = false } = {}) {
  // The ranges of the last paint, minus any whose page has been rebuilt under
  // them (an edit, a key change) before the next paint has caught up.
  const hits = liveLeaks();
  const rest = restOfFolder();
  if (!hits.length) {
    // Nothing here, but the folder is not this document: the walk goes on in
    // the next one that has something standing in the clear — as far as it is
    // this document's OWN reading that says there is nothing here. Where it is
    // not, leaks.walkStep says what to do instead of going on.
    const step = LK.walkStep({
      next: rest.length ? (dir < 0 ? rest[rest.length - 1] : rest[0]) : null,
      read: readHere(),
      marks: marksCanRead(),
      pending: folderPending(),
      bounces,
      auto,
    });
    if (step.go) { jumpToDoc(step.go); return; }
    if (step.wait) {
      // Waiting is not stopping: the bar stays up, says what is being read,
      // and the walk goes on by itself the moment the answer lands (walkOn,
      // and leakJump where a document was opened for it).
      walkOn = true;
      renderNamesBar();
      if (step.wait === "folder" && !auto) toast("The rest of the folder is being read \u2014 the walk goes on as soon as it says what is next.");
      return;
    }
    walkOn = false;
    showNamesBar(false);
    toast(step.stop === "marks"
      ? "The marks are off for this document, so the names standing in the clear are not being read \u2014 the walk has stopped here."
      : step.stop === "bounced"
      ? `The walk opened ${LK.WALK_BOUNCE_LIMIT} documents in a row without finding a name standing in the clear in any of them, so it has stopped here. The \u26a0 beside a document in the list says what its own text is still carrying.`
      : sweep.running ? "None here. The rest of the folder is still being read…"
      : dirHandle ? "No real name from the key is standing unfaked, here or anywhere else in the folder."
      : "No real name from the key is standing unfaked.", { error: step.stop === "bounced" });
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
  leakDir = dir < 0 ? -1 : 1;
  const h = hits[leakStep];
  leakHere = h.range;
  leakHerePieces = piecesOf(h);
  markLeakHere();
  scrollRangeTo(h.range);
  if (namesBar.hidden) showNamesBar(true);
  else renderNamesBar();
  warmForLeaks(); // …and the PDF pages of this stop and the next are drawn ahead
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
  if (on && !was) { reelAllLive(); bounces = 0; } // the walk looks at every page of the reel
  namesBar.hidden = !on;
  setBarHeight();
  if (was !== !!on) relayout();
  if (was !== !!on) warmForLeaks(); // the walk starting starts the drawing ahead; closing it lets go
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
// FIND LOOKS FOR WHAT THE SCREEN SHOWS. The query is looked for as typed,
// and only in text that says it: the open document's pages as they read, and
// every other export as it would read if the walk opened it. With the real
// names on screen that is a file read THROUGH THE KEY — what is on disk is the
// pseudonyms, so a search for "Rasho" is a search of each file with its fakes
// turned back, and a name standing in the clear in one export and faked in
// another is found in both. Otherwise the answer would be "only in the
// document you happen to have open", which is worse than no answer. With Show
// fakes on, the screen is the files as they are on disk, and they are read
// as they are.
//
// So a real name with Show fakes on is found only where it stands UNFAKED —
// a leak the run missed, or a value kept where it stands — and a pseudonym
// with it off only where the key leaves it standing. A hit on the other face
// would mark text that does not say what was typed (and bury the leaks among
// the names the key did its job on), and a folder counted that way would send
// the walk into documents with nothing on screen that matches.
let findQuery = "";
let findHits = [];    // the open document's hits, in order: [{ range }]
let findStep = -1;
let findJump = false; // a document opened by the walk: stand on its first hit
let findRows = [];    // the rest of the folder: [{ doc, count }]
let findScanFor = null; // …the query, the folder and the view that answer was about
let findScanning = false;

// MATCH CASE reads the text as shown. The key writes a real name back in the
// case of the pseudonym it replaces (mirrorCase), so a caption's "RASHO" is
// found by a case-sensitive "RASHO" in a file that carries the fake in
// capitals. Off (the default, and every new tab), case is ignored.
function matchCase() { return $("fb-case").checked; }
function findMatcherFor(q) { return PK.buildFindMatcher([String(q || "").trim()], { caseSensitive: matchCase() }); }

/**
 * Another document of the folder as the screen would show it, PAGE BY PAGE:
 * each page's text as its page body reads (textdoc.shownPages — the fakes as
 * the real names with Show fakes off, as they are with it on, the margin
 * numbers blanked), the way Find and Replace read a page on screen. Counted
 * that way, the folder's count is what Replace all replaces plus what it
 * leaves standing: a page header or a DOCUMENT banner is never a hit, nor a
 * phrase across a page break, nor a margin number. A document with unsaved
 * edits is read from the store. The turning back costs a pass of the key over
 * the whole file, so what it gives is kept per file while the file, the key,
 * the face and the folder stay as they were: a query asks every document
 * again at each word typed.
 */
let findShown = { rev: null, docs: null, fakes: null, texts: new Map() };
async function findPagesOf(d) {
  const r = await readDoc(d);
  if (findShown.rev !== rev || findShown.docs !== folderDocs || findShown.fakes !== settings.showFakes) findShown = { rev, docs: folderDocs, fakes: settings.showFakes, texts: new Map() };
  const had = findShown.texts.get(d.handle);
  if (had && had.stamp === r.stamp) return had.pages;
  const pages = TD.shownPages(r.entry ? r.entry.doc : readExport(r.text), { rev, showFakes: settings.showFakes });
  findShown.texts.set(d.handle, { stamp: r.stamp, pages });
  return pages;
}

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
 * the query, the folder, the key or Show fakes moves.
 */
function findScanStale() {
  return !findScanFor || findScanFor.q !== findQuery || findScanFor.docs !== folderDocs || findScanFor.key !== key || findScanFor.cs !== matchCase() || findScanFor.fakes !== settings.showFakes
    // …and the documents with unsaved edits, which it reads from the store.
    || findScanFor.unsaved !== unsavedSeq;
}
let findScanWaiters = []; // what is waiting on the folder's count being in (awaitFolderScan)
let findScanDone = null;  // the question whose count `findRows` holds: a reading that broke off holds none
async function scanFindFolder() {
  if (!dirHandle || !findQuery || findScanning || !findScanStale()) return;
  findScanning = true;
  // Counts made under another key or the other face of the names are no
  // answer to walk by while the new ones are read: they name documents with
  // nothing on screen that matches.
  if (findScanFor && (findScanFor.key !== key || findScanFor.fakes !== settings.showFakes)) findRows = [];
  const mine = { q: findQuery, docs: folderDocs, key, cs: matchCase(), fakes: settings.showFakes, unsaved: unsavedSeq };
  findScanFor = mine;
  const rows = [];
  const rx = findMatcherFor(findQuery);
  try {
    await duringAsync("reading the rest of the folder for what you are looking for", async (pass) => {
      let clock = await idleClock();
      for (const d of folderDocs) {
        noteDoing(pass, `searching the folder (${d.name})`);
        if (findScanFor !== mine || findScanStale()) return; // the question moved under it
        // The open one is READ HERE TOO, though its hits come from the page:
        // the walk moves from document to document, and a row set that left
        // out whichever was open when it was made would send the walk back
        // into the document it had just left. The row is filtered out of the
        // "rest" instead, at the moment it is asked for (findRest).
        try {
          // Page by page, as the screen reads a page: never across a break.
          let n = 0;
          if (rx) for (const p of await findPagesOf(d)) n += countMatches(rx, p);
          if (n) rows.push({ doc: d, count: n });
        } catch { /* unreadable: it is not a document this search can answer */ }
        if (!clock || clock.timeRemaining() < SLICE_LEFT) clock = await idleClock();
      }
    });
  } finally { findScanning = false; }
  // The question moved while this one was being read (a word typed, Match
  // case ticked, Show fakes turned): the new one could not start while this
  // held the folder, so it starts now.
  if (findScanFor !== mine || findScanStale()) { scanFindFolder(); return; }
  findRows = rows;
  findScanDone = mine;
  renderFindBar();
  const w = findScanWaiters;
  findScanWaiters = [];
  for (const res of w) res();
  // A find that opened on a document with nothing in it waits for this answer
  // before saying there is nothing anywhere (findJump), and goes on once it is in.
  if (findJump && !findHits.length && findRest().length) { findJump = false; stepFind(1); }
}
/**
 * The folder's count for the question as it stands, in: a reading running is
 * waited for however long a big folder takes, a stale one started. Gives up
 * where `pass` is stopped, `moved` says the question moved, or the question
 * goes (no folder, no query) — and where a reading breaks off three times
 * running without a count. True only where the count is in.
 */
async function awaitFolderScan(pass, moved = null) {
  let broke = 0;
  for (;;) {
    if (!dirHandle || !findQuery || (pass && pass.stop) || (moved && moved())) return false;
    const fresh = !findScanStale();
    if (!findScanning && fresh && findScanDone === findScanFor) return true;
    if (!findScanning) {
      // Stale, or read under this question and broken off before its count
      // was in: read again from the start.
      if (fresh) { if (++broke > 3) return false; findScanFor = null; }
      scanFindFolder();
    }
    await new Promise((res) => {
      findScanWaiters.push(res);
      // Woken whatever happens: a stop, or a reading that went stale and gave up.
      setTimeout(res, 250);
    });
  }
}

/**
 * The documents of the folder that carry it, off the screen: the documents on
 * the reel are counted on the page (a row for them too counted them twice, and
 * a walk past the last hit on screen would open one already hung), and the
 * combined file is apart (findCombined).
 */
function findRest() {
  return roundFromHere(TD.splitFolderRows(findRows, onReel).rest);
}
/** The combined file's count, when it has hits and is not the document on screen. */
function findCombined() {
  return TD.splitFolderRows(findRows, onReel).combined.reduce((t, r) => t + r.count, 0);
}
/** The bar: which hit of how many, where it stands, and what the folder holds. */
function renderFindBar() {
  if (findBar.hidden) return;
  const n = findHits.length;
  const others = findRest();
  const rest = others.reduce((t, r) => t + r.count, 0);
  const comb = findCombined();
  // The combined file is every export over again, and PDF-Linker writes it
  // from them: counted apart, and never replaced in.
  const combNote = comb ? ` · ${TD.COMBINED_FILE}: ${comb}, left to PDF-Linker` : "";
  $("fb-count").textContent = !findQuery ? ""
    : n ? `${Math.min(Math.max(findStep, 0) + 1, n)} of ${n} here`
    : findScanning ? "reading the folder…"
    : "none here";
  const h = n && findStep >= 0 ? findHits[findStep] : null;
  $("fb-where").textContent = h ? whereInText(h.range) : "";
  $("fb-rest").textContent = !findQuery ? ""
    : findScanning ? `· reading ${folderName || "the folder"}…`
    : others.length ? `· ${rest} in ${others.length} other document${others.length === 1 ? "" : "s"}${n ? "" : ` — › opens ${TD.docLabel(others[0].doc.name)}`}` + combNote
    : dirHandle ? "· nowhere else in the folder" + combNote : "";
  $("fb-prev").disabled = $("fb-next").disabled = !findQuery || (n < 2 && !others.length);
  $("fb-replace").disabled = !doc || !findQuery || (!n && !others.length);
  // Replace all: hits here, or — with the case folder open in full — hits in
  // its other documents, or a folder still being read for them.
  const folderWide = folderOpen() && !isCombinedHead();
  $("fb-replace-all").disabled = !folderPass && (!doc || !findQuery || !(n || (folderWide && (others.length || findScanning || findScanStale()))));
  if (!folderPass) {
    $("fb-replace-all").title = folderWide
      ? "Replace every hit in the case folder: the pages on screen and every other export that has one, each left unsaved until you save (Ctrl+S writes them all). A hit inside a longer name the key fakes as one is left as it stands. Combined Text.txt is left to PDF-Linker. Match case decides whether “court” also replaces “Court”. Ctrl+Z, or ↶ Undo replace in folder, puts it all back. Without a case folder open, the pages on screen only."
      : isCombinedHead()
        ? "Replace every hit in Combined Text.txt on screen. A replace here stays in it — PDF-Linker writes it again from the exports; open an export to replace across the folder. Ctrl+Z puts it back."
        : "Replace every hit on the pages on screen (no case folder is open in full, so the rest of the folder is not read). A hit inside a longer name the key fakes as one is left as it stands. Match case decides whether “court” also replaces “Court”. Ctrl+Z puts it all back.";
  }
  renderUndoFolder();
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
  restartFind();
}
/** The question changed — its words, or whether case counts: the page again, and the folder behind it. */
function restartFind() {
  findStep = -1;
  findRows = [];
  findScanFor = null;
  $("fb-rnote").textContent = "";
  if (!findQuery) { findHits = []; clearFindMarks(); renderFindBar(); return; }
  findSoon();
}
function showFindBar(on, { replace = false } = {}) {
  const was = !findBar.hidden;
  if (on && !was) reelAllLive(); // the search looks at every page of the reel
  findBar.hidden = !on;
  // Closing puts Replace away with it; Ctrl+H brings the bar back with it open.
  showReplaceRow(on && (replace || (was && replaceOpen())));
  setBarHeight();
  if (was !== !!on) relayout();
  // Closing the bar stops a folder replace being prepared: nothing is changed.
  if (!on && folderPass) folderPass.stop = true;
  if (!on) { findHits = []; findStep = -1; findJump = false; clearFindMarks(); return; }
  const input = $("fb-input");
  // Opened over a selection, that is what is being looked for.
  const sel = String(document.getSelection() || "").trim();
  if (sel && sel.length <= 120 && !sel.includes("\n")) input.value = sel;
  // Ctrl+H with something to look for already in the box goes straight to
  // what to put in its place.
  const box = replace && input.value.trim() ? $("fb-with") : input;
  box.focus();
  box.select();
  setFindQuery(input.value);
  renderFindBar();
}
$("fb-input").addEventListener("input", (e) => setFindQuery(e.target.value));
$("fb-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
  else if (e.key === "Escape") { e.preventDefault(); showFindBar(false); }
});
$("fb-case").addEventListener("change", restartFind);
// Alt+C flips Match case from either box of the bar. On a Mac, Option+C types
// "ç", which is left to type.
findBar.addEventListener("keydown", (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key.toLowerCase() !== "c") return;
  e.preventDefault();
  $("fb-case").checked = !$("fb-case").checked;
  restartFind();
});
$("fb-prev").addEventListener("click", () => stepFind(-1));
$("fb-next").addEventListener("click", () => stepFind(1));
$("fb-close").addEventListener("click", () => showFindBar(false));
$("find-btn").addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection to search for
$("find-btn").addEventListener("click", () => showFindBar(findBar.hidden));
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k !== "f" && !(k === "h" && e.ctrlKey)) return; // Cmd+H is the Mac's Hide, not ours
  e.preventDefault(); // the reader's find, not the browser's: the browser's cannot leave this document
  showFindBar(true, { replace: k === "h" });
});

// ── the key, term by term ────────────────────────────────────────────────────────
//
// THE PSEUDONYM KEY AS IT STANDS IN THE TEXT. The key is a list of names, and
// the question a reader brings to it is where each one is: every name the key
// fakes on these pages, one after another, and every place each of them
// stands. So the walk has two steps. A TERM is one row of the key — one
// pseudonym, whatever the case it is written in — and the terms come in the
// order each first appears, so stepping through them is reading down the
// document a name at a time; › on Term goes to the next one's first
// appearance (Alt+J). An APPEARANCE is one place a term stands, a name
// wrapped across two lines being one place; › on Appearance goes to the term's
// next one, round to its first after its last (Alt+K).
//
// What is walked is the pages on screen: this document, and with the folder
// read on, what the reel has hung under it. It reads the pseudonyms — the
// names the run faked. The ones it left standing in the clear are the names
// walk's (Alt+L), being a different question: not where a name is, but
// whether it should be.
let keyTerm = null;   // the term the walk stands on: its pseudonym, folded
let keyIdx = 0;       // …the appearance, by number
let keyAt = null;     // …and by its first span, which survives the list being read again
let keyDoc = null;    // the document all that is about
let keyPairsFor = null, keyPairs = null;

/** The key's own row for a term: its real value and fake as the key writes them. */
function keyPairOf(term) {
  if (keyPairsFor !== key) {
    keyPairsFor = key;
    keyPairs = new Map(((key && key.pairs) || []).map((p) => [PK.fold(p.fake), p]));
  }
  return keyPairs.get(term) || null;
}
/**
 * Every pseudonym on the pages, as terms in the order each first appears:
 * [{ term, real, fake, kept, at: [[span, …], …] }] — each appearance its
 * spans, more than one where a name is wrapped across lines.
 */
function keyTerms() {
  const terms = new Map();
  // A wrapped name: its later pieces belong to the place its first piece
  // opened. By name, because a name wrapped down a column can have the other
  // column's names between its pieces.
  const open = new Map();
  for (const s of pagesEl.querySelectorAll(".pn")) {
    const term = PK.fold(pnFake(s));
    const piece = s.dataset.piece;
    if (piece && !piece.startsWith("0/") && open.has(term)) { open.get(term).push(s); continue; }
    let t = terms.get(term);
    if (!t) {
      const p = keyPairOf(term);
      t = { term, real: p ? p.real : pnReal(s), fake: p ? p.fake : pnFake(s), kept: s.classList.contains("kept"), at: [] };
      terms.set(term, t);
    }
    const spans = [s];
    t.at.push(spans);
    if (piece) open.set(term, spans); else open.delete(term);
  }
  return [...terms.values()];
}
/** An appearance as a range, from its first piece to its last. */
function keyRange(spans) {
  const r = document.createRange();
  r.setStartBefore(spans[0]);
  r.setEndAfter(spans[spans.length - 1]);
  return r;
}
/** Where the walk stands in the terms just read: { ti, ai }, or null where it stands nowhere. */
function keyLocate(terms) {
  if (keyTerm == null || keyDoc !== doc) return null;
  const ti = terms.findIndex((t) => t.term === keyTerm);
  if (ti < 0) return null;
  const at = terms[ti].at;
  let ai = keyAt ? at.findIndex((a) => a[0] === keyAt) : -1;
  // Its page rebuilt by an edit: the same appearance by number, as near as there is one.
  if (ai < 0) ai = Math.min(keyIdx, at.length - 1);
  return { ti, ai };
}
/** The appearance at the reading — the first one at or under the top of the stage — or the first of all. */
function keyHere(terms) {
  if (!terms.length) return null;
  const first = new Map(); // span → { ti, ai }
  terms.forEach((t, ti) => t.at.forEach((a, ai) => first.set(a[0], { ti, ai })));
  const y = stageEl.getBoundingClientRect().top;
  for (const s of pagesEl.querySelectorAll(".pn")) {
    const at = first.get(s);
    if (!at) continue;
    const r = s.getBoundingClientRect();
    if (r.height && r.bottom > y) return at;
  }
  return { ti: 0, ai: 0 };
}
/** Stand on an appearance: mark it, scroll to it (`go`), and say so in the bar. */
function keyStand(terms, ti, ai, { go = true } = {}) {
  const t = terms[ti];
  if (!t) return;
  keyTerm = t.term;
  keyIdx = ai;
  keyAt = t.at[ai][0];
  keyDoc = doc;
  paintKey(terms);
  renderKeyBar(terms);
  if (go) scrollRangeTo(keyRange(t.at[ai]));
}
function paintKey(terms) {
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
  const loc = keyBar.hidden ? null : keyLocate(terms);
  try {
    const t = loc ? terms[loc.ti] : null;
    CSS.highlights.set("keyterm", highlightOf(t ? t.at.map(keyRange) : []));
    CSS.highlights.set("keyhere", highlightOf(t ? [keyRange(t.at[loc.ai])] : []));
  } catch { /* a span from a page since rebuilt */ }
}
function clearKeyMarks() {
  try { CSS.highlights.delete("keyterm"); CSS.highlights.delete("keyhere"); } catch { /* none to clear */ }
}
let keyListSig = "";
/** The bar: the term list, which appearance of how many, and where it stands. */
function renderKeyBar(terms) {
  if (keyBar.hidden) return;
  const sel = $("kb-term");
  const sig = terms.map((t) => t.term + ":" + t.at.length + (t.kept ? "k" : "")).join("|");
  if (sig !== keyListSig) {
    keyListSig = sig;
    sel.textContent = "";
    for (const t of terms) {
      const o = document.createElement("option");
      o.value = t.term;
      o.textContent = `${t.real} → ${t.fake} · ${t.at.length}${t.kept ? " · kept" : ""}`;
      sel.appendChild(o);
    }
  }
  const loc = keyLocate(terms);
  sel.value = loc ? terms[loc.ti].term : "";
  sel.disabled = !terms.length;
  const t = loc ? terms[loc.ti] : null;
  $("kb-count").textContent = !terms.length ? "no pseudonyms on these pages"
    : t ? `${loc.ai + 1} of ${t.at.length} · term ${loc.ti + 1} of ${terms.length}` : "";
  $("kb-where").textContent = t ? whereInText(keyRange(t.at[loc.ai])) : "";
  $("kb-term-prev").disabled = $("kb-term-next").disabled = terms.length < 2;
  $("kb-prev").disabled = $("kb-next").disabled = !t || t.at.length < 2;
  $("kb-find").disabled = !t;
}
/** The next term (dir 1) or the one before (dir -1), at its first appearance. */
function stepKeyTerm(dir) {
  if (keyBar.hidden) { showKeyBar(true); return; }
  const terms = keyTerms();
  if (!terms.length) { renderKeyBar(terms); return; }
  const loc = keyLocate(terms);
  const n = terms.length;
  const ti = loc ? (((loc.ti + dir) % n) + n) % n : (keyHere(terms) || { ti: 0 }).ti;
  keyStand(terms, ti, 0);
}
/** The term's next appearance (dir 1) or the one before (dir -1), round at either end. */
function stepKeyAppearance(dir) {
  if (keyBar.hidden) { showKeyBar(true); return; }
  const terms = keyTerms();
  if (!terms.length) { renderKeyBar(terms); return; }
  const loc = keyLocate(terms);
  if (!loc) { const h = keyHere(terms); keyStand(terms, h.ti, h.ai); return; }
  const n = terms[loc.ti].at.length;
  keyStand(terms, loc.ti, (((loc.ai + dir) % n) + n) % n);
}
function showKeyBar(on) {
  const was = !keyBar.hidden;
  if (on && !doc) return;
  if (on && !was) reelAllLive(); // the walk reads every page of the reel
  keyBar.hidden = !on;
  setBarHeight();
  if (was !== !!on) relayout();
  if (!on) { keyTerm = null; keyAt = null; clearKeyMarks(); return; }
  if (was) return;
  // Opened: it starts where the reading is, on the first name at or under the
  // top of the stage, rather than at the head of the document.
  keyListSig = "";
  const terms = keyTerms();
  const h = keyHere(terms);
  if (h) keyStand(terms, h.ti, h.ai);
  else renderKeyBar(terms);
}
// The pages were rebuilt (an edit, the key changed, Show fakes, a document
// opened or hung on the reel): the spans the walk held are gone, so it reads
// the terms again and stands where it stood — or, in another document, where
// the reading is, without moving it.
const rekeySoon = debounce(() => {
  if (keyBar.hidden) return;
  const terms = keyTerms();
  if (!keyLocate(terms)) {
    const h = keyHere(terms);
    if (h) { keyStand(terms, h.ti, h.ai, { go: false }); return; }
    keyTerm = null; keyAt = null;
  }
  paintKey(terms);
  renderKeyBar(terms);
}, 200);
$("kb-term").addEventListener("change", () => {
  const terms = keyTerms();
  const ti = terms.findIndex((t) => t.term === $("kb-term").value);
  if (ti >= 0) keyStand(terms, ti, 0);
});
$("kb-term-prev").addEventListener("click", () => stepKeyTerm(-1));
$("kb-term-next").addEventListener("click", () => stepKeyTerm(1));
$("kb-prev").addEventListener("click", () => stepKeyAppearance(-1));
$("kb-next").addEventListener("click", () => stepKeyAppearance(1));
$("kb-find").addEventListener("click", () => {
  const terms = keyTerms();
  const loc = keyLocate(terms);
  if (loc) keyStand(terms, loc.ti, loc.ai);
});
$("kb-close").addEventListener("click", () => showKeyBar(false));
keyBar.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); showKeyBar(false); }
});
$("key-walk-btn").addEventListener("click", () => showKeyBar(keyBar.hidden));
// The count of pseudonyms opens the walk on the name at the reading; once it
// is open, it steps on through the term.
function keyFromCount(e) {
  if (!$("st-pn").classList.contains("step")) return;
  if (keyBar.hidden) showKeyBar(true);
  else stepKeyAppearance(e && e.shiftKey ? -1 : 1);
}
$("st-pn").addEventListener("click", keyFromCount);
$("st-pn").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  keyFromCount(e);
});
// Alt+J for the next term, Alt+K for the next appearance, Shift for the one
// before. By the key's place on the keyboard (`code`), not the character it
// types: on a Mac, Option+J types "∆".
document.addEventListener("keydown", (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey || (e.code !== "KeyJ" && e.code !== "KeyK")) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return; // a field being typed in
  if (!doc || !key) return;
  e.preventDefault();
  if (e.code === "KeyJ") stepKeyTerm(e.shiftKey ? -1 : 1);
  else stepKeyAppearance(e.shiftKey ? -1 : 1);
});

// ── Replace ──────────────────────────────────────────────────────────────────
//
// Find's second row. It edits what Find marks. Replace works on the pages on
// screen — this document, and whatever the folder has hung under it, each of
// which is saved to its own file — and › opens the next document that has a
// hit, the edits of the one left kept in the store of unsaved documents rather
// than asked about. Replace all, with a case folder open in full, reaches
// every export of it (below): the documents off the screen are replaced on
// pages built for them by this same code and left unsaved, in the store. The
// bar writes no file; Save writes them all. (It used to replace on screen
// only and leave the folder alone, by design; the owner reversed that — see
// "Unsaved documents and the folder save" in the design notes.)
//
// A REPLACE IS TYPING. The words go into the page as plain text, where a real
// name the key binds is marked as a pseudonym exactly as a typed one is (the
// file carries the fake), the edit is one step of the undo history (a Replace
// all is one step however many pages and documents it touched), and the
// document is unsaved until it is saved. It works on a protected document
// without lifting the protection: the protection is against a stray keystroke
// in the page, and a replace is not one.
//
// A PSEUDONYM IS TAKEN WHOLE OR NOT AT ALL, the way the page itself treats
// one: its span takes no keystroke. A hit that covers a whole pseudonym (or
// every piece of one wrapped across lines) replaces it; a hit that is only
// part of one — "Rasho" inside a span that fakes "Helen Rasho" as one name —
// is left as it stands and said so, since what would be left of the span is a
// piece of a real name with no fake of its own to be written as. A spot keep
// (a value kept where it stands) is the same.
//
// The numbers of a pleading page are never touched: a phrase wrapped across
// a numbered line loses its words on both lines, the replacement goes where
// it began, and the line numbers stay where they are.
const replaceRow = $("fb-replace-row");
function replaceOpen() { return !replaceRow.hidden; }
function showReplaceRow(on) {
  replaceRow.hidden = !on;
  $("fb-replace-toggle").setAttribute("aria-pressed", String(!!on));
  if (!on) $("fb-rnote").textContent = "";
  setBarHeight();
}

/** The pseudonym or spot keep a text node is the text of, if it is one. */
function atomOf(n) { return n.parentElement ? n.parentElement.closest(".pn, [data-here]") : null; }
/**
 * What replacing [start, end) of a page would take out, line by line — or null
 * where the hit is only part of a pseudonym or a spot keep. `segs` are the
 * page's text nodes as flatten reads them.
 */
function planReplace(body, segs, start, end) {
  const parts = [];
  const wrapped = new Map(); // a name wrapped across lines: which of its pieces the hit covers
  let held = false;
  for (const g of segs) {
    if (g.end <= start || g.start >= end || g.end === g.start) continue;
    if (g.node.parentElement && g.node.parentElement.closest(".gutter")) continue;
    const atom = atomOf(g.node);
    if (atom && (g.start < start || g.end > end)) return null;
    if (atom && atom.dataset.piece) {
      const [k, n] = atom.dataset.piece.split("/").map(Number);
      const id = atom.dataset.wholeFake + "\u0000" + atom.dataset.wholeReal;
      if (!wrapped.has(id)) wrapped.set(id, { n, seen: new Set() });
      wrapped.get(id).seen.add(k);
    }
    if (atom && atom.hasAttribute("data-here")) held = true;
    const line = lineOfNode(body, g.node) || body;
    const last = parts[parts.length - 1];
    if (last && last.line === line) last.to = g;
    else parts.push({ line, from: g, to: g });
  }
  if (!parts.length) return null;
  // Every piece, or the name is only partly in the hit.
  for (const { n, seen } of wrapped.values()) if (!seen.has(0) || !seen.has(n - 1)) return null;
  return { body, start, end, parts, held };
}

/**
 * Carry a plan out: the hit's text off each of its lines, the replacement
 * where it began. Returns a collapsed range just after the replacement, which
 * the edits that follow (the typed-name pass) keep in its place.
 */
function applyReplace(plan, withText) {
  const { start, end, parts } = plan;
  let at = null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const { line, from, to } = parts[i];
    const r = document.createRange();
    const a = atomOf(from.node), b = atomOf(to.node);
    if (a) r.setStartBefore(a); else r.setStart(from.node, Math.max(0, start - from.start));
    if (b) r.setEndAfter(b); else r.setEnd(to.node, Math.min(end, to.end) - to.start);
    r.deleteContents();
    const lt = line !== plan.body ? ltOf(line) : null;
    if (i > 0) {
      // A wrapped phrase leaves the head of its next line bare: the space
      // that stood after it there goes too, so the line does not open on one.
      if (lt) {
        lt.normalize();
        // Its first text, which a column cell (columns.js) may hold.
        let f = lt.firstChild;
        while (f && f.nodeType === 1 && f.matches(".cc, .cg")) f = f.firstChild;
        if (f && f.nodeType === 3) f.data = f.data.replace(/^[ \t]+/, "");
      }
    }
    // A numbered line the replace has emptied is written as PDF-Linker writes
    // one, the number alone, without the two spaces that stood before its text.
    if (lt && !lt.textContent.length && !(i === 0 && withText)) {
      const gs = line.querySelector(":scope > .gutter > .gs");
      if (gs) gs.textContent = "";
    }
    if (i > 0) continue;
    if (withText) {
      const t = document.createTextNode(withText);
      r.insertNode(t);
      r.setStartAfter(t);
    }
    r.collapse(true);
    at = r;
  }
  return at;
}

/**
 * A page once its replacements are in, settled as typing settles one: the
 * line blocks put right, a real name typed as the replacement marked as its
 * pseudonym, the columns cut again. How many real names that marked. The page
 * may be one built off the screen (shadowPage): nothing here touches the
 * bookkeeping of the pages on screen.
 */
function settleBody(body) {
  normalizeLines(body);
  const marked = convertTypedReals(body, { quiet: true });
  dressColumns(body);
  return marked;
}
/**
 * …and a page ON SCREEN: what typing on it would have done, its spot keeps
 * read back — whenever it has one, since a replace can add or take away an
 * occurrence of a kept value before it and so move its ordinal — and its
 * member dirty.
 */
function settleReplaced(body) {
  const marked = settleBody(body);
  if (body.querySelector("[data-here]")) syncSpots(body);
  setDirty(true, pageIndexOf(body));
  return marked;
}
/**
 * The toast's word on the real names a replace put in. `names`: how many
 * distinct names the replacement carries, where known — then the count is of
 * the places, as "3 occurrences of 1 real name", the unit the confirm's names
 * and this count can both be read in.
 */
function markedNote(n, names = 0) {
  if (!n) return "";
  if (names && n !== names) return ` ${n} occurrences of ${names === 1 ? "1 real name" : `${names} real names`} marked — the file will carry the pseudonym${names === 1 ? "" : "s"}.`;
  return ` ${n} real name${n === 1 ? "" : "s"} marked — the file will carry the pseudonym${n === 1 ? "" : "s"}.`;
}

/** A hit's place in its page's text now, read off its live range — null where the page has moved under it. */
function hitNow(hit, rx) {
  const r = hit && hit.range;
  const body = r && r.startContainer.parentElement && r.startContainer.parentElement.closest(".page-body");
  if (!body || !body.isConnected) return null;
  const { text, segs } = flatten(body, { blankGutters: true });
  const a = segs.find((g) => g.node === r.startContainer);
  const b = segs.find((g) => g.node === r.endContainer);
  if (!a || !b) return null;
  const start = a.start + r.startOffset, end = b.start + r.endOffset;
  rx.lastIndex = start;
  const m = rx.exec(text);
  if (!m || m.index !== start || m.index + m[0].length !== end) return null;
  return { body, segs, start, end };
}

const PART_OF_NAME = "is part of a longer name the key fakes as one (or of a value kept where it stands), which is replaced whole or not at all";

/** Replace the hit in front and stand on the next; with none in front, go to one first. */
function replaceOne() {
  if (!doc || !findQuery) return;
  if (refuseWhileBusy()) return;
  const rx = findMatcherFor(findQuery);
  if (!rx) return;
  if (findStep < 0 || !findHits[findStep]) { stepFind(1); return; }
  const cur = findHits[findStep];
  const hit = hitNow(cur, rx);
  if (!hit) {
    // The page moved under the hit since it was read (an edit a beat ago):
    // read it again and show what is in front now, rather than guess.
    scanFindHere();
    if (!findLandHere() && findHits[findStep]) scrollRangeTo(findHits[findStep].range);
    renderFindBar();
    return;
  }
  const plan = planReplace(hit.body, hit.segs, hit.start, hit.end);
  if (!plan) {
    $("fb-rnote").textContent = `This one ${PART_OF_NAME} — left as it stands.`;
    stepFind(1);
    return;
  }
  snapshot(hit.body, true);
  let after, marked = 0;
  batchEdit = true;
  try {
    after = applyReplace(plan, $("fb-with").value);
    // Kept as a place in the text across the settling: the line may be cut
    // into its columns again (columns.js), which moves the node it stands in.
    const afterAt = after ? offsetOfPoint(hit.body, after.startContainer, after.startOffset) : -1;
    marked = settleReplaced(hit.body);
    if (afterAt >= 0) {
      const pt = pointAtOffset(hit.body, afterAt);
      after = document.createRange();
      after.setStart(pt.node, pt.offset);
      after.collapse(true);
    }
  } finally { batchEdit = false; }
  if (marked) toast(markedNote(marked).trim());
  lastSnapPage = -1; // what is typed next is its own step
  afterTextChange();
  // On to the hit after the one just replaced — past the replacement itself,
  // which may carry what is being looked for — and round to the top of the
  // document where that was the last.
  scanFindHere();
  const next = after ? findHits.findIndex((h) => { try { return h.range.compareBoundaryPoints(Range.START_TO_START, after) >= 0; } catch { return false; } }) : -1;
  findStep = next >= 0 ? next : findHits.length ? 0 : -1;
  paintFind();
  if (findStep >= 0) scrollRangeTo(findHits[findStep].range);
  $("fb-rnote").textContent = "";
  renderFindBar();
}

/**
 * Every hit on the pages on screen, planned and nothing changed yet:
 * { edits: [{ body, plans }], skipped, skippedIn: Map(document name → count) }.
 */
function planHere(rx) {
  reelAllLive(); // a page the reel has let go of is a page with no hit to replace
  const edits = [];
  let skipped = 0;
  const skippedIn = new Map();
  for (const body of pageBodies()) {
    const { text, segs } = flatten(body, { blankGutters: true });
    const plans = [];
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(text))) {
      if (!m[0].length) { rx.lastIndex++; continue; }
      const plan = planReplace(body, segs, m.index, m.index + m[0].length);
      if (plan) plans.push(plan);
      else {
        skipped++;
        const mm = reelMemberOf(pageIndexOf(body));
        const name = mm ? mm.name : fileName;
        skippedIn.set(name, (skippedIn.get(name) || 0) + 1);
      }
    }
    if (plans.length) edits.push({ body, plans });
  }
  return { edits, skipped, skippedIn };
}
/** …carried out: each page's plans last first, so each earlier hit's text nodes and offsets still stand, and each page settled. → { done, marked } */
function applyHere(edits, withText) {
  let done = 0, marked = 0;
  batchEdit = true;
  try {
    for (const { body, plans } of edits) {
      for (let i = plans.length - 1; i >= 0; i--) applyReplace(plans[i], withText);
      marked += settleReplaced(body);
      done += plans.length;
    }
  } finally { batchEdit = false; }
  return { done, marked };
}

/**
 * Every hit on the pages on screen, in one step of the undo history — the
 * Replace all of a lone file, of a folder attached for its key alone, of
 * Combined Text.txt, and of a case folder whose other documents have no hit.
 * `also`: what the toast adds. → { done, pages }, or null where nothing was.
 */
function replaceAll({ also = "" } = {}) {
  if (!doc || !findQuery) return null;
  if (refuseWhileBusy()) return null;
  const rx = findMatcherFor(findQuery);
  if (!rx) return null;
  const withText = $("fb-with").value;
  const { edits, skipped } = planHere(rx);
  const note = skipped ? `${skipped} left as ${skipped === 1 ? "it stands" : "they stand"}: ${skipped === 1 ? "it" : "each"} ${PART_OF_NAME}.` : "";
  $("fb-rnote").textContent = note;
  $("fb-rnote").title = "";
  if (!edits.length) {
    toast((skipped ? `Nothing replaced — ${note}` : `“${findQuery}” is not on the pages on screen.`) + also, { error: !!skipped });
    return null;
  }
  snapshotPages(edits.map((e) => e.body));
  const { done, marked } = applyHere(edits, withText);
  afterTextChange();
  findStep = -1;
  scanFindHere();
  findLandHere();
  renderFindBar();
  const pages = edits.length;
  toast(`Replaced ${done} in ${pages} page${pages === 1 ? "" : "s"} — Ctrl+Z puts ${done === 1 ? "it" : "them all"} back.` + markedNote(marked) + (skipped ? ` ${skipped} left as ${skipped === 1 ? "it stands" : "they stand"}.` : "") + also, also ? { ms: 7000 } : undefined);
  return { done, pages };
}

// ── Replace all across the case folder ──────────────────────────────────────
//
// THE BAR WRITES NO FILE, AND REPLACE ALL REACHES THE WHOLE FOLDER. With a case
// folder open in full, Replace all replaces in every export of it that has a
// hit: the pages on screen as before, and every other document on pages built
// for it off the screen (shadowPage) by the reader's own code — the same plan,
// the same replace, the same typed-name pass — so a document replaced here
// reads byte for byte as one opened, replaced and saved. Nothing is written:
// each changed document goes into the store of unsaved documents, and Save
// writes them all. It used to edit only the pages on screen and never touch
// the folder from the bar, deliberately; the owner reversed that. Combined
// Text.txt is counted and never replaced in: PDF-Linker writes it again from
// the exports.
//
// Order of work: the folder's count in; every document off the screen with a
// hit prepared, one at a time and in idle slices, with nothing changed (Esc
// stops it); the screen planned again; one confirm naming every document; then
// one synchronous commit under one batch id — the pages on screen snapshotted
// as any Replace all is, the documents off the screen journalled
// (replaceJournal) — so one Ctrl+Z puts every document back, wherever it has
// gone by then (revertFolderReplace).
const CHANGED_UNDER = "The search or the folder changed while the replace was being prepared — nothing was changed. Press Replace all again.";
const STOPPED = "Replace all stopped — nothing was changed.";
const COMBINED_STAYS = `Replace all from ${TD.COMBINED_FILE} stays in it — PDF-Linker writes it again from the exports. Open an export to replace across the folder.`;
/** A page of a document off the screen built in the hidden container: its own spots (always an array), its own typing baseline. */
function shadowPage(pages, i, theirSpots, built) {
  shadowEl.textContent = "";
  buildPages(shadowEl, pages, { from: i, to: i + 1, spots: theirSpots || [] });
  const body = shadowEl.querySelector(".page-body");
  if (body && built != null) body.__built = built;
  return body;
}
function clearShadow() { if (shadowEl) shadowEl.textContent = ""; }
/** A member's document with its live pages read off the screen, as a copy. */
function liveMemberDoc(m) {
  const d = TD.cloneDoc(memberDoc(m));
  for (let k = 0; k < m.count; k++) {
    const body = bodyForPage(m.from + k);
    if (body) d.pages[k].lines = TD.serializeNodes(body).split("\n");
  }
  return d;
}
/** A member's spot keeps as pages of its own document. */
function memberSpotsRel(m) {
  const list = m === reelCurrent() ? spots : m.spots || [];
  return list.filter((x) => x.page >= m.from && x.page < m.from + m.count).map((x) => ({ ...x, page: x.page - m.from }));
}
/** The Replace all button while a replace is being prepared: Stop. */
function setReplaceAllBusy(on) {
  const b = $("fb-replace-all");
  b.textContent = on ? "Stop" : "Replace all";
  if (on) { b.disabled = false; b.title = "Stop preparing the replace (Esc) — nothing has been changed yet"; }
}
function replaceAllClick() {
  if (folderPass) { folderPass.stop = true; return; }
  replaceAllEverywhere();
}

/**
 * One document off the screen, replaced on pages built for it — the pages with
 * a hit only, a page at a time, the thread given back between pages and never
 * in the middle of one. Nothing outside the copy is changed. → { d, before,
 * beforeSpots, parsed, spots, built, base, done, skipped, marked, entry }, or
 * null where `pass` was stopped.
 */
async function prepareDocReplace(d, rx, withText, pass) {
  const r = await readDoc(d);
  const e = r.entry;
  const parsed = e ? TD.cloneDoc(e.doc) : readExport(r.text);
  const before = TD.cloneDoc(parsed);
  const built = e && e.built ? e.built.slice() : parsed.pages.map((p) => p.lines.join("\n"));
  let docSpots = TD.normalizeSpots(e ? e.spots : lsGet(spotKeyOf(d.name), []));
  const beforeSpots = docSpots.slice();
  const base = e ? e.base : { text: r.text, stamp: r.stamp, opened: TD.serializeExport(parsed) };
  const shown = TD.shownPages(parsed, { rev, showFakes: settings.showFakes });
  let done = 0, skipped = 0, marked = 0;
  let clock = await idleClock();
  for (let i = 0; i < parsed.pages.length; i++) {
    if (pass.stop) return null;
    if (!countMatches(rx, shown[i])) continue;
    batchEdit = true; // the typed-name pass takes no snapshot of a page that has no history
    try {
      const body = shadowPage(parsed.pages, i, docSpots, built[i]);
      if (!body) continue;
      const { text, segs } = flatten(body, { blankGutters: true });
      const plans = [];
      rx.lastIndex = 0;
      let m;
      while ((m = rx.exec(text))) {
        if (!m[0].length) { rx.lastIndex++; continue; }
        const plan = planReplace(body, segs, m.index, m.index + m[0].length);
        if (plan) plans.push(plan); else skipped++;
      }
      if (plans.length) {
        for (let k = plans.length - 1; k >= 0; k--) applyReplace(plans[k], withText);
        marked += settleBody(body);
        parsed.pages[i].lines = TD.serializeNodes(body).split("\n");
        docSpots = docSpots.filter((x) => x.page !== i).concat(spotsFromBody(body, i));
        done += plans.length;
      }
    } finally { batchEdit = false; clearShadow(); }
    if (!clock || clock.timeRemaining() < SLICE_LEFT) clock = await idleClock();
  }
  return { d, before, beforeSpots, parsed, spots: docSpots, built, base, done, skipped, marked, entry: e };
}

/** Replace all, with a case folder open in full: every export of it. */
async function replaceAllEverywhere() {
  if (!doc || !findQuery) return;
  if (refuseWhileBusy()) return;
  if (opening) { toast("Wait for the document to open."); return; }
  if (!folderOpen()) {
    // A lone file, or a folder attached for its key alone: the pages on screen.
    const r = replaceAll();
    if (r && dirHandle && folderLight) {
      showKeyOffer(`Replace all changed only the pages on screen: only this file's key is attached; the rest of ${folderName} is not read.`, "Read the whole folder", readWholeFolder);
    }
    return;
  }
  if (isCombinedHead()) { replaceAll({ also: " " + COMBINED_STAYS }); return; }
  const rx = findMatcherFor(findQuery);
  if (!rx) return;
  const q = findQuery, withText = $("fb-with").value;
  const reelNames = () => reel.map((m) => m.name).join("\n");
  const stamp = { q, cs: matchCase(), fakes: settings.showFakes, rev, fwd, keeps: keepsSignature(), reel: reelNames(), unsaved: unsavedSeq };
  const moved = () => stamp.q !== findQuery || stamp.cs !== matchCase() || stamp.fakes !== settings.showFakes || stamp.rev !== rev
    || stamp.fwd !== fwd || stamp.keeps !== keepsSignature() || stamp.reel !== reelNames() || stamp.unsaved !== unsavedSeq;
  const pass = { stop: false };
  folderPass = pass;
  setReplaceAllBusy(true);
  const say = (t, title = "") => { $("fb-rnote").textContent = t; $("fb-rnote").title = title; };
  const halt = (t) => { say(t); toast(t, { error: t === CHANGED_UNDER }); };
  let committed = false;
  try {
    // The folder's count, for the question as it stands.
    if (findScanning || findScanStale() || findScanDone !== findScanFor) {
      say(`Reading ${folderName} for “${q}”…`);
      const inHand = await awaitFolderScan(pass, moved);
      if (pass.stop) { halt(STOPPED); return; }
      if (moved() || findScanStale()) { halt(CHANGED_UNDER); return; }
      if (!inHand) { halt(`${folderName} could not be read for “${q}” — nothing was changed.`); return; }
    }
    const targets = findRest().map((r) => r.doc).sort((a, b) => folderDocs.indexOf(a) - folderDocs.indexOf(b));
    const comb = findCombined();
    const combNote = comb ? ` Not touched: ${TD.COMBINED_FILE} (${comb}) — PDF-Linker writes it again from the exports.` : "";
    if (!targets.length) {
      // Nothing off the screen: the replace there always was, and no confirm.
      folderPass = null;
      setReplaceAllBusy(false);
      replaceAll({ also: combNote });
      return;
    }
    // Prepared, one document at a time; nothing changes yet.
    const prepared = [], unreadable = [];
    for (let k = 0; k < targets.length; k++) {
      const d = targets[k];
      say(`Preparing the replace: ${TD.docLabel(d.name)} (${k + 1} of ${targets.length})… Esc stops`);
      let p = null;
      try { p = await prepareDocReplace(d, rx, withText, pass); }
      catch (err) { console.warn(err); unreadable.push(d.name); }
      if (pass.stop) { clearShadow(); halt(STOPPED); return; }
      if (moved()) { clearShadow(); halt(CHANGED_UNDER); return; }
      if (p) prepared.push(p);
    }
    // The screen planned again: typing went on while the folder was prepared.
    const here = planHere(rx);
    const sum = folderReplaceSummary(q, withText, here, prepared, comb, unreadable);
    if (!sum.docs) {
      halt(sum.skipped ? `Nothing replaced — ${sum.skipped} left as ${sum.skipped === 1 ? "it stands" : "they stand"}: ${sum.skipped === 1 ? "it" : "each"} ${PART_OF_NAME}.` : `“${q}” is in no document that can be replaced in.`);
      return;
    }
    if (!confirm(sum.message)) { say(""); return; }
    if (moved()) { halt(CHANGED_UNDER); return; }
    commitFolderReplace({ q, withText, here, prepared, sum });
    committed = true;
  } finally {
    if (folderPass === pass) folderPass = null;
    setReplaceAllBusy(false);
    if (!committed) renderFindBar();
  }
}

/** What a folder replace is about to do, counted and said: the confirm, and the toast and the note after it. */
function folderReplaceSummary(q, withText, here, prepared, comb, unreadable) {
  const label = (n) => TD.docLabel(n);
  const hereBy = new Map(); // member name → hits replaced on screen
  for (const { body, plans } of here.edits) {
    const m = reelMemberOf(pageIndexOf(body));
    const name = m ? m.name : fileName;
    hereBy.set(name, (hereBy.get(name) || 0) + plans.length);
  }
  const hereN = [...hereBy.values()].reduce((t, n) => t + n, 0);
  const off = prepared.filter((p) => p.done);
  const offN = off.reduce((t, p) => t + p.done, 0);
  const skippedBy = new Map(here.skippedIn);
  for (const p of prepared) if (p.skipped) skippedBy.set(p.d.name, (skippedBy.get(p.d.name) || 0) + p.skipped);
  const skipped = [...skippedBy.values()].reduce((t, n) => t + n, 0);
  const docs = hereBy.size + off.length;
  // The real names the replacement carries, which the file gets as their
  // pseudonyms: named, and counted as names — the toast after counts the
  // places each was put in, and says so.
  const withNames = [];
  if (withText && fwd) {
    const seen = new Set();
    for (const h of TD.findRealsInPlain(fwd, [{ node: null, text: maskKept(withText) }])) {
      const k = PK.fold(h.matched);
      if (!seen.has(k)) { seen.add(k); withNames.push(h.matched); }
    }
  }
  const inWith = withNames.length;
  const s = (n) => (n === 1 ? "" : "s");
  const head = withText
    ? `Replace “${q}” with “${withText}” in ${docs} document${s(docs)} of ${folderName}?`
    : `Delete every “${q}” in ${docs} document${s(docs)} of ${folderName}?`;
  const bullets = [];
  if (hereN) bullets.push(`• On screen: ${hereN} in ${hereBy.size} document${s(hereBy.size)} (${nameList([...hereBy.keys()].map(label))})`);
  if (offN) bullets.push(`• Not on screen: ${offN} in ${off.length} document${s(off.length)} (${nameList(off.map((p) => label(p.d.name)))})`);
  if (skipped) bullets.push(`• Left as ${skipped === 1 ? "it stands" : "they stand"}: ${skipped} — part of a longer name the key fakes as one, or of a value kept where it stands (${nameList([...skippedBy.keys()].map(label))})`);
  if (inWith) bullets.push(`• ${nameList(withNames.map((v) => `“${v}”`))} in the replacement ${inWith === 1 ? "is a real name" : `are ${inWith} real names`}: wherever ${inWith === 1 ? "it goes" : "they go"} in, the file gets ${inWith === 1 ? "its pseudonym" : "their pseudonyms"}`);
  if (comb) bullets.push(`• Not touched: ${TD.COMBINED_FILE} (${comb}) — PDF-Linker writes it again from the exports`);
  if (unreadable.length) bullets.push(`• Could not be read, so not touched: ${nameList(unreadable.map(label))}`);
  const message = head + "\n\n" + bullets.join("\n") +
    "\n\nNothing is written yet. Every changed document stays unsaved until you save — Ctrl+S writes them all. Ctrl+Z, or ↶ Undo replace in folder, puts them all back.";
  return { message, docs, hereN, hereBy, offN, off, skipped, skippedBy, comb, inWith };
}

/**
 * The replace carried out, in one synchronous step under one batch id: the
 * pages on screen snapshotted and replaced as any Replace all, each prepared
 * document put in the store, unsaved, and every document's before and after
 * journalled, with a marker on the undo history that brings them all back.
 */
function commitFolderReplace({ q, withText, here, prepared, sum }) {
  const id = ++batchSeq;
  const rec = { id, q, withText, folder: folderName, state: "done", docs: [] };
  const members = [];
  for (const { body } of here.edits) { const m = reelMemberOf(pageIndexOf(body)); if (m && !members.includes(m)) members.push(m); }
  const before = new Map(members.map((m) => [m, { doc: liveMemberDoc(m), spots: memberSpotsRel(m) }]));
  let marked = 0;
  if (here.edits.length) {
    snapshotPages(here.edits.map((x) => x.body), id);
    marked += applyHere(here.edits, withText).marked;
  }
  for (const m of members) {
    if (!m.d) continue; // not one of the folder's: its page steps carry it
    const b = before.get(m), after = liveMemberDoc(m);
    rec.docs.push({ name: m.name, d: m.d, base: m.base, beforeDoc: b.doc, beforeText: TD.serializeExport(b.doc), beforeSpots: b.spots,
      afterDoc: after, afterText: TD.serializeExport(after), afterSpots: memberSpotsRel(m), writtenText: null, writtenSpots: null });
  }
  for (const p of prepared) {
    if (!p.done) continue;
    unsavedDocs.set(p.d.name, { name: p.d.name, d: p.d, handle: p.d.handle, base: p.base, doc: p.parsed, spots: p.spots, built: p.built, seq: ++unsavedSeq, conflict: !!(p.entry && p.entry.conflict) });
    confirmedDocs.add(p.d.name);
    rec.docs.push({ name: p.d.name, d: p.d, base: p.base, beforeDoc: p.before, beforeText: TD.serializeExport(p.before), beforeSpots: p.beforeSpots,
      afterDoc: TD.cloneDoc(p.parsed), afterText: TD.serializeExport(p.parsed), afterSpots: p.spots.slice(), writtenText: null, writtenSpots: null });
    marked += p.marked;
  }
  for (const m of members) confirmedDocs.add(m.name);
  undoStack.push({ batch: id, folderReplace: id });
  trimHistory();
  redoStack = [];
  lastSnapPage = -1;
  replaceJournal.push(rec);
  trimJournal();
  afterTextChange();
  findStep = -1;
  scanFindHere();
  findLandHere();
  storeChanged();
  // Said: how many where, that nothing is written, and how to take it back.
  const done = sum.hereN + sum.offN;
  const where = [];
  if (sum.hereN) where.push(`${sum.hereN} here`);
  for (const p of sum.off) where.push(`${p.done} in ${TD.docLabel(p.d.name)}`);
  const n = sum.docs;
  toast(`Replaced ${done} in ${n} document${n === 1 ? "" : "s"} (${nameList(where)}) — not saved yet: Ctrl+S writes ${n === 1 ? "it" : `all ${n}`}; Ctrl+Z puts ${n === 1 ? "it" : "them all"} back.`
    + markedNote(marked, sum.inWith) + (sum.skipped ? ` ${sum.skipped} left as ${sum.skipped === 1 ? "it stands" : "they stand"} (part of a longer name).` : ""), { ms: 9000 });
  const per = (name, k) => `${TD.docLabel(name)}: ${k} replaced` + (sum.skippedBy.get(name) ? `, ${sum.skippedBy.get(name)} left as ${sum.skippedBy.get(name) === 1 ? "it stands" : "they stand"}` : "");
  const offLines = sum.off.map((p) => per(p.d.name, p.done));
  const allLines = [...sum.hereBy].map(([name, k]) => per(name, k)).concat(offLines);
  $("fb-rnote").textContent = offLines.slice(0, 3).join("; ") + (offLines.length > 3 ? `; and ${offLines.length - 3} more` : "");
  $("fb-rnote").title = allLines.join("\n");
}

// The folder replaces the reader holds, for Ctrl+Z and ↶ Undo replace in
// folder: the last few, and no more text than a tab should carry for them.
const JOURNAL_MAX = 3;
const JOURNAL_CHARS = 16 * 1024 * 1024; // about 32 MB as the browser holds a string
function journalChars(rec) {
  return rec.docs.reduce((t, x) => t + x.beforeText.length + x.afterText.length + (x.writtenText ? x.writtenText.length : 0), 0);
}
/** The oldest records dropped past the caps — and their markers off the history with them. */
function trimJournal() {
  while (replaceJournal.length > JOURNAL_MAX || (replaceJournal.length > 1 && replaceJournal.reduce((t, r) => t + journalChars(r), 0) > JOURNAL_CHARS)) {
    const gone = replaceJournal.shift();
    undoStack = undoStack.filter((s) => s.folderReplace !== gone.id);
    redoStack = redoStack.filter((s) => s.folderReplace !== gone.id);
  }
  renderUndoFolder();
}
/**
 * A member's pages put back to a document of its own (`d2`, its spots `rel`),
 * the pages that differ rebuilt, the member dirty where it now differs from
 * the file it was opened from. False where the page count does not match.
 */
function putMemberBack(m, d2, rel) {
  if (!d2 || d2.pages.length !== m.count) return false;
  const list = (m === reelCurrent() ? spots : m.spots || []).filter((x) => x.page < m.from || x.page >= m.from + m.count)
    .concat((rel || []).map((x) => ({ ...x, page: x.page + m.from })));
  if (m === reelCurrent()) { spots = list; m.spots = list; } else m.spots = list;
  const changed = [];
  for (let k = 0; k < m.count; k++) {
    const i = m.from + k;
    const p = d2.pages[k];
    const body = bodyForPage(i);
    const now = body ? TD.serializeNodes(body) : doc.pages[i].lines.join("\n");
    doc.pages[i].lines = p.lines.slice();
    doc.pages[i].restored = p.restored ? p.restored.slice() : null;
    if (!body || now === p.lines.join("\n")) continue;
    const was = body.__built;
    body.__restored = doc.pages[i].restored ? new Set(doc.pages[i].restored) : null;
    buildBody(body, p.lines.join("\n"), i, list);
    if (was != null) body.__built = was; // the typing is measured against what the page was built from, as before
    changed.push(i);
  }
  persistMemberSpots(m);
  m.dirty = !m.base || TD.serializeExport(memberDoc(m)) !== m.base.opened;
  if (m.dirty) m.editSeq = (m.editSeq || 0) + 1;
  dirty = reel.some((x) => x.dirty);
  if (changed.length) syncNoOcr(changed, { drop: true });
  return true;
}
/**
 * A folder replace taken back (`dir` "undo") or done again ("redo"), document
 * by document, wherever each one is now — the store, the reel, or written
 * since — and only where it still reads as the replace left it (`skip`: the
 * documents whose pages the history has just put back itself). Taken back
 * after a save, a document is unsaved again with its old text, and Save writes
 * it only where the disk still reads exactly what the reader wrote.
 * → { done, left } (document names), or null where the replace is not held.
 */
function revertFolderReplace(id, dir, { skip = new Set() } = {}) {
  const rec = replaceJournal.find((r) => r.id === id);
  if (!rec) return null;
  const undoing = dir === "undo";
  const done = [], left = [];
  for (const x of rec.docs) {
    if (skip.has(x.name)) { done.push(x.name); continue; }
    const want = undoing ? [x.writtenText, x.afterText].filter((t) => t != null) : [x.beforeText];
    const toDoc = undoing ? x.beforeDoc : x.afterDoc;
    const toSpots = undoing ? x.beforeSpots : x.afterSpots;
    const e = unsavedDocs.get(x.name);
    const m = reel.find((mm) => mm.name === x.name && (!mm.d || !x.d || mm.d === x.d));
    if (e && want.includes(docText(e))) {
      e.doc = TD.cloneDoc(toDoc);
      e.spots = toSpots.slice();
      e.seq = ++unsavedSeq;
      if (e.base && docText(e) === e.base.opened) unsavedDocs.delete(x.name); // back to its file: nothing unsaved
      done.push(x.name);
      continue;
    }
    if (m && !e && want.includes(TD.serializeExport(liveMemberDoc(m))) && putMemberBack(m, toDoc, toSpots)) { done.push(x.name); continue; }
    if (!e && !m && x.d) {
      // In neither place. Taken back after a save: unsaved again with its old
      // text, Save writing it only where the disk still reads what the reader
      // wrote. Done again where it was put back to its file: unsaved again,
      // checked against that file. Taken back after its edits were dropped
      // (dropUnsaved, dropAllUnsaved, takeDiskVersion): the file reads as it
      // did, and there is nothing to do. Anything else — saved with more edits
      // on top (`savedOther`), or gone some way the journal did not see — is
      // left as it is and named: a document said to be put back while its
      // file still carries the replace is worse than one named.
      const restore = (toBase) => unsavedDocs.set(x.name, {
        name: x.name, d: x.d, handle: x.d.handle, base: toBase,
        doc: TD.cloneDoc(toDoc), spots: toSpots.slice(),
        built: toDoc.pages.map((p) => p.lines.join("\n")), seq: ++unsavedSeq, conflict: false,
      });
      if (undoing && x.writtenText != null) { restore({ text: x.writtenText, stamp: null, opened: x.writtenText }); done.push(x.name); continue; }
      if (!undoing && x.writtenText == null && !x.savedOther && x.base) { restore(x.base); done.push(x.name); continue; }
      if (undoing && x.writtenText == null && x.dropped && !x.savedOther) { done.push(x.name); continue; }
    }
    left.push(x.name);
  }
  rec.state = undoing ? "undone" : "done";
  unsavedSeq++;
  // The replace row said what the replace did; it says now what became of it,
  // rather than "3 replaced" beside counts that have all come back.
  const k = done.length, s = k === 1 ? "" : "s";
  $("fb-rnote").textContent = (undoing ? `Put back: ${k} document${s} (unsaved)` : `Replaced again: ${k} document${s} (unsaved)`)
    + (left.length ? `; left as ${left.length === 1 ? "it is" : "they are"}: ${nameList(left.map((n) => TD.docLabel(n)))}` : "");
  $("fb-rnote").title = "";
  if (doc) afterTextChange();
  storeChanged();
  return { done, left };
}
/** The newest folder replace still in force, which ↶ Undo replace in folder takes back. */
function latestFolderReplace() {
  for (let k = replaceJournal.length - 1; k >= 0; k--) {
    const r = replaceJournal[k];
    if (r.state === "done" && r.folder === folderName) return r;
  }
  return null;
}
function renderUndoFolder() {
  const b = $("fb-undo-folder");
  if (!b) return;
  const rec = folderOpen() ? latestFolderReplace() : null;
  b.hidden = !rec;
  if (rec) {
    const n = rec.docs.length;
    b.title = `Put back the ${n} document${n === 1 ? "" : "s"} changed by replacing “${rec.q}”${rec.withText ? ` with “${rec.withText}”` : ""}, wherever they are now — unsaved; Save writes them. A document changed since the replace is left as it is.`;
  }
}
function undoFolderReplace() {
  if (refuseWhileBusy()) return;
  const rec = latestFolderReplace();
  if (!rec) return;
  const n = rec.docs.length;
  if (!confirm(`Put back the ${n} document${n === 1 ? "" : "s"} changed by replacing “${rec.q}”${rec.withText ? ` with “${rec.withText}”` : ""}? They become unsaved; Save writes them. A document changed since the replace is left as it is.`)) return;
  const r = revertFolderReplace(rec.id, "undo");
  if (!r) return;
  // Taken back for good: its steps leave the history, and there is no redo.
  undoStack = undoStack.filter((s) => s.batch !== rec.id);
  redoStack = redoStack.filter((s) => s.batch !== rec.id);
  renderUndoFolder();
  const k = r.done.length;
  toast(`Put back ${k} document${k === 1 ? "" : "s"} as ${k === 1 ? "it was" : "they were"} before replacing “${rec.q}” — unsaved; Ctrl+S writes ${k === 1 ? "it" : "them"}.`
    + (r.left.length ? ` Left as ${r.left.length === 1 ? "it is" : "they are"}: ${nameList(r.left.map((x) => TD.docLabel(x)))} (changed since the replace).` : ""), { error: !!r.left.length, ms: 9000 });
}

$("fb-replace-toggle").addEventListener("click", () => {
  const on = !replaceOpen();
  showReplaceRow(on);
  (on ? $("fb-with") : $("fb-input")).focus();
});
$("fb-replace").addEventListener("click", replaceOne);
$("fb-replace-all").addEventListener("click", replaceAllClick);
$("fb-undo-folder").addEventListener("click", undoFolderReplace);
$("fb-with").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); replaceOne(); }
  else if (e.key === "Escape") { e.preventDefault(); showFindBar(false); }
});

// ── a page that did not OCR ──────────────────────────────────────────────────────
//
// ⊘ Did not OCR on a page's label: the page loses its text and carries
// TD.DID_NOT_OCR instead. It is an edit like any other — one undo step, the
// document dirty, a save writes it — and it is made the way an undo puts a
// page back: the body built again from its new text, the page's spot keeps
// with it.
function markDidNotOcr(i) {
  if (!doc) return;
  const p = doc.pages[i];
  // A page is a PDF page by its header; text before the first one, a combined
  // file's banner, or a Word export with no pages at all is not one, and its
  // label carries no button.
  if (!p || p.header == null) return;
  ensurePageLive(i);
  const body = bodyForPage(i);
  if (!body) return;
  const was = TD.serializeNodes(body);
  const lines = TD.didNotOcrLines(was.split("\n"));
  const text = lines.join("\n");
  const m = reel.length > 1 ? reelMemberOf(i) : null;
  const where = TD.pageLabel(p) + (m ? " of " + m.name : "");
  if (text === was) { toast(`${where} already reads ${TD.DID_NOT_OCR}.`); return; }
  snapshot(body, true);
  // The step remembers that it is a strip: its snapshot is the page's text as
  // it read BEFORE, which ↻ OCR This Page puts back (strippedTextOf).
  let top = undoStack[undoStack.length - 1];
  if (top && top.page === i) top.nocr = true;
  else top = null;
  // A request to read the page again is withdrawn by stripping it again —
  // and so is a transcription: the page's text is not worth keeping after all.
  const entry = pageEntryAt(i);
  if (entry && (ocrAgain.some((e) => TD.sameNoOcr(e, entry)) || textFixed.some((e) => TD.sameNoOcr(e, entry)))) {
    ocrAgain = TD.setOcrAgain(ocrAgain, entry, false);
    textFixed = TD.setTextFixed(textFixed, entry, false);
    persistValues();
    renderFlags();
  }
  convertTypedRealsSoon.cancel();
  hideTypeTip();
  setSpotsListOf(i, spotsListOf(i).filter((x) => x.page !== i));
  buildBody(body, text, i);
  doc.pages[i].lines = lines;
  syncSpots(body);
  setDirty(true, i);
  // …and PDF-Linker is told, through New Real Values.txt, or its next full run
  // rebuilds the export from the PDF and OCRs the page all over again.
  syncNoOcr([i]);
  lastSnapPage = -1; // what is typed next is its own step
  afterTextChange();
  // …and the page is shown as its PDF page, where it was showing its text: a
  // page that did not OCR reads as nothing but the mark, and the PDF page is
  // what there is to read. Side by side the PDF page stands beside it
  // already, and a page shown raw stays raw. The step carries the swap, so
  // Ctrl+Z puts the text back on screen and not under the PDF page.
  const t = pdfTarget(i);
  const sec = pagesEl.querySelector(`.tpage[data-index="${i}"]`);
  const swapped = !!t && !!sec && !sbsOn && !sec.classList.contains("raw") && !swaps.has(t.key);
  if (swapped) {
    if (top) top.view = { key: t.key, on: true };
    setPageSwap(t.key, true);
  }
  toast(`${where}: text stripped, ${TD.DID_NOT_OCR} in its place${swapped ? ", and its PDF page shown" : ""} — Save writes it, and puts the page on ${TD.VALUES_FILE} so PDF-Linker never OCRs it again. Ctrl+Z puts it back.`);
}
/** A page's ⇄ PDF swap turned on or off by `key`, remembered and shown (or held for when side by side closes). */
function setPageSwap(key, on) { setPageSwaps([key], on); }
/** …and several pages' at once, in one pass over the pages. */
function setPageSwaps(keys, on) {
  let moved = false;
  for (const key of keys) {
    if (swaps.has(key) === on) continue;
    if (on) swaps.add(key); else swaps.delete(key);
    moved = true;
  }
  if (!moved) return;
  persistSwaps();
  applySwaps();
}

// ── …and a page to read again ────────────────────────────────────────────────────
//
// On a page that already reads TD.DID_NOT_OCR the same button is ↻ OCR This
// Page, and it undoes the strip. Two cases, told apart by what PDF-Linker can
// already have been told.
//
//   The strip is the reader's own and never reached the case folder: its line
//   was never written to New Real Values.txt and the page's header is not
//   PDF-Linker's DID NOT OCR one. The reader still holds the text it stripped
//   (the strip's undo step, strippedTextOf), so it puts that text straight
//   back — one undo step, Ctrl+Z strips it again — and the page is off the list
//   of pages not to OCR. Nothing is owed to PDF-Linker: its PDF was never
//   marked.
//
//   Anything else — PDF-Linker marked the page (its header says so), the line
//   was written to the folder and may have been spent, or the text is no
//   longer in hand — only PDF-Linker can put the page back, since the mark may
//   be in the PDF. The page goes on New Real Values.txt as `ocr again: FILE |
//   page N` (TD.ocrAgainLine); PDF-Linker takes the mark off the page, and its
//   next full run reads it and exports its text. The page reads
//   TD.DID_NOT_OCR until then, so the button shows the request as made
//   (✓ OCR This Page), and a second click withdraws it. The request is done
//   once the page reads as read, off a header that is not DID NOT OCR
//   (syncNoOcr).
function ocrPageAgain(i) {
  if (!doc) return;
  const p = doc.pages[i];
  if (!p || p.header == null) return;
  const m = reel.length > 1 ? reelMemberOf(i) : null;
  const where = TD.pageLabel(p) + (m ? " of " + m.name : "");
  const entry = pageEntryAt(i);
  if (entry && ocrAgain.some((e) => TD.sameNoOcr(e, entry))) {
    ocrAgain = TD.setOcrAgain(ocrAgain, entry, false);
    persistValues();
    renderFlags();
    syncNoOcr([i]); // …and a strip of the reader's own is owed as not to OCR again
    toast(`${where}: the request to OCR it again is withdrawn — the page stays ${TD.DID_NOT_OCR}.`);
    return;
  }
  if (!TD.headerSaysDidNotOcr(p)) {
    const had = entry && noOcr.find((e) => TD.sameNoOcr(e, entry));
    const reached = !!had && lsGet(valuesSavedKey(), "").split("\n").includes(TD.noOcrLine(had));
    const sn = reached ? null : strippedTextOf(i);
    if (sn && putStrippedBack(i, sn)) {
      toast(`${where}: its text is back, as it read before ⊘ Did not OCR — the mark never reached the case folder, so PDF-Linker has nothing to undo. Ctrl+Z strips it again.`);
      return;
    }
  }
  if (!entry) {
    toast(`${where} carries no PDF page number, so PDF-Linker cannot be told which page to read again.`, { error: true });
    return;
  }
  if (flagsFor !== valuesStoreKey()) {
    toast("The case folder's list is still being read — try again in a moment.", { error: true });
    return;
  }
  noOcr = TD.setNoOcr(noOcr, entry, false);
  ocrAgain = TD.setOcrAgain(ocrAgain, entry, true);
  persistValues();
  renderFlags();
  toast(`${where}: asked to be OCR'd again — Save puts it on ${TD.VALUES_FILE}; PDF-Linker takes its DID NOT OCR mark off, and its next full run reads the page and exports its text. Click again to withdraw.`);
}

/** The page's text from before its latest ⊘ Did not OCR, while the undo history holds it. */
function strippedTextOf(i) {
  for (let k = undoStack.length - 1; k >= 0; k--) {
    const sn = undoStack[k];
    if (sn.page === i && sn.nocr && !TD.readsDidNotOcr(sn.text.split("\n"))) return sn;
  }
  return null;
}

/** Put a stripped page's text back, as an edit of its own: one undo step. */
function putStrippedBack(i, sn) {
  ensurePageLive(i);
  const body = bodyForPage(i);
  if (!body) return false;
  snapshot(body, true);
  // The PDF view the strip turned on comes off with it: the text is back, and
  // shown. Carried on the step, so Ctrl+Z strips it and shows the PDF again.
  const top = undoStack[undoStack.length - 1];
  const view = sn.view && sn.view.on && swaps.has(sn.view.key) ? { key: sn.view.key, on: false } : null;
  if (view && top && top.page === i) top.view = view;
  convertTypedRealsSoon.cancel();
  hideTypeTip();
  setSpotsListOf(i, spotsListOf(i).filter((x) => x.page !== i).concat(sn.spots || []));
  buildBody(body, sn.text, i);
  doc.pages[i].lines = sn.text.split("\n");
  syncSpots(body);
  setDirty(true, i);
  syncNoOcr([i], { drop: true }); // off the list of pages not to OCR
  lastSnapPage = -1;
  afterTextChange();
  if (view) setPageSwap(view.key, false);
  return true;
}

// ── …and a page transcribed by hand ───────────────────────────────────────────────
//
// ✎ Use my text, beside ⊘ Did not OCR, is for the page whose OCR was bad and
// whose text the operator has typed in here until it says what the page says.
// The export is the reader's to edit, but a full PDF-Linker run rebuilds every
// export from its PDF — so the page goes on New Real Values.txt as `text
// corrected: FILE | page N | sum …` (TD.textFixedLine), and PDF-Linker writes
// the page's text, as saved, into the PDF as its text layer (its pseudonyms
// read back through the key), marks the page so it is never OCR'd again, and
// from then on exports it off that layer under a TEXT CORRECTED header. The
// sum is the page's text as last saved (refreshTextFixedSums); PDF-Linker
// applies the line only where the export still reads that way. A second click
// withdraws the request. ⊘ Did not OCR stays for the page not worth the typing.
function useMyText(i) {
  if (!doc) return;
  const p = doc.pages[i];
  if (!p || p.header == null) return;
  const m = reel.length > 1 ? reelMemberOf(i) : null;
  const where = TD.pageLabel(p) + (m ? " of " + m.name : "");
  const entry = pageEntryAt(i);
  if (entry && textFixed.some((e) => TD.sameNoOcr(e, entry))) {
    textFixed = TD.setTextFixed(textFixed, entry, false);
    persistValues();
    renderFlags();
    toast(`${where}: no longer handed to PDF-Linker as text typed in by hand.`);
    return;
  }
  if (pageReadsDidNotOcr(i)) {
    toast(`${where} reads ${TD.DID_NOT_OCR} — type its text in first (or ↻ OCR This Page to have it read again).`, { error: true });
    return;
  }
  if (!entry) {
    toast(`${where} carries no PDF page number, so PDF-Linker cannot be told which page the text is for.`, { error: true });
    return;
  }
  if (flagsFor !== valuesStoreKey()) {
    toast("The case folder's list is still being read — try again in a moment.", { error: true });
    return;
  }
  const body = bodyForPage(i);
  const lines = body ? TD.serializeNodes(body).split("\n") : p.lines;
  noOcr = TD.setNoOcr(noOcr, entry, false);
  ocrAgain = TD.setOcrAgain(ocrAgain, entry, false);
  textFixed = TD.setTextFixed(textFixed, { ...entry, sum: TD.pageTextSum(lines) }, true);
  persistValues();
  renderFlags();
  toast(`${where}: your text is to be the page's own — Save writes the page and puts it on ${TD.VALUES_FILE}; PDF-Linker's next run writes the text into the PDF and never OCRs the page again. Click again to withdraw.`, { ms: 9000 });
}
/** Each transcribed page of the open document takes the sum of its text as it now stands — what a save just wrote. */
function refreshTextFixedSums(members = null) {
  if (!doc || !textFixed.length || flagsFor !== valuesStoreKey()) return;
  // `members`: the documents a save just wrote — a page of one it could not
  // write keeps the sum of what its file still says.
  const sources = docPageSources();
  const items = [];
  doc.pages.forEach((p, i) => {
    if (members && !members.includes(reelMemberOf(i))) return;
    const entry = pageEntryAt(i, sources);
    if (entry) items.push({ entry, lines: p.lines });
  });
  const list = TD.fixedSumsFor(textFixed, items);
  if (list !== textFixed) {
    textFixed = list;
    persistValues();
  }
}
function setFixButton(b, reads, asked, corrected) {
  b.classList.toggle("on", asked);
  b.setAttribute("aria-pressed", asked ? "true" : "false");
  b.disabled = reads && !asked;
  b.textContent = asked ? "✓ Use my text" : "✎ Use my text";
  b.title = asked
    ? `Asked: PDF-Linker's next run writes this page's text, as you saved it, into the PDF as the page's own and never OCRs the page again. ${TD.VALUES_FILE} carries the request once it is written — Save writes it. Click to withdraw.`
    : reads
      ? `The page reads ${TD.DID_NOT_OCR}: there is no text to hand over. Type the page's text in first.`
      : (corrected ? "PDF-Linker already uses your transcription for this page. Typed over it again? " : "The OCR was bad and you have typed this page's text in by hand? ")
        + `Hand it to PDF-Linker: Save puts the page on ${TD.VALUES_FILE}, and its next run writes the text into the PDF as the page's own and never OCRs the page again.`;
}
/** Set each page label's ✎ button from its page (`indices`, or every page on screen). */
function refreshFixButtons(indices) {
  if (!doc) return;
  const buttons = indices && indices.length <= 20
    ? indices.map((i) => pagesEl.querySelector(`.tpage[data-index="${i}"] > .page-label .fix-page`)).filter(Boolean)
    : [...pagesEl.querySelectorAll(".tpage > .page-label .fix-page")];
  if (!buttons.length) return;
  const sources = textFixed.length ? docPageSources() : null;
  for (const b of buttons) {
    const i = Number(b.closest(".tpage").dataset.index);
    const p = doc.pages[i];
    if (!p) continue;
    const e = sources ? pageEntryAt(i, sources) : null;
    setFixButton(b, pageReadsDidNotOcr(i), !!e && textFixed.some((x) => TD.sameNoOcr(x, e)), TD.headerSaysTextCorrected(p));
  }
}

/** The label's button: ⊘ Did not OCR on a page of text, ↻ OCR This Page on one that reads DID_NOT_OCR. */
function nocrButtonClick(i) {
  if (!doc || !doc.pages[i]) return;
  if (pageReadsDidNotOcr(i)) ocrPageAgain(i);
  else markDidNotOcr(i);
}
/**
 * Whether page `i` reads DID_NOT_OCR as it stands. Its lines are the text as
 * last settled; typing does not settle them, so a short page being edited is
 * read off its body (a page long enough not to be the one line is not, and
 * its lines answer — the Authorities cited trailer is what makes one long).
 */
function pageReadsDidNotOcr(i) {
  const p = doc && doc.pages[i];
  if (!p) return false;
  const body = bodyForPage(i);
  if (body && body.textContent.length < 400) return TD.readsDidNotOcr(TD.serializeNodes(body).split("\n"));
  return TD.readsDidNotOcr(p.lines);
}
function setNocrButton(b, reads, asked, marked) {
  const on = reads && asked;
  b.classList.toggle("on", on);
  // ↻ OCR This Page is red: a page with no text in it is the thing to see.
  b.classList.toggle("stripped", reads && !on);
  if (reads) b.setAttribute("aria-pressed", on ? "true" : "false");
  else b.removeAttribute("aria-pressed");
  if (!reads) {
    b.textContent = "⊘ Did not OCR";
    b.title = `Strip this page's text and write ${TD.DID_NOT_OCR} in its place — for a page the OCR mangled. The page header stays, and so does PDF-Linker's Authorities cited list at the end of the file. Save writes it, and puts the page on ${TD.VALUES_FILE} so PDF-Linker never OCRs it again and exports it as ${TD.DID_NOT_OCR}. Ctrl+Z puts the text back.`;
  } else if (on) {
    b.textContent = "✓ OCR This Page";
    b.title = `Asked: PDF-Linker takes this page's DID NOT OCR mark off, and its next full run reads the page again and exports its text. ${TD.VALUES_FILE} carries the request once it is written — Save writes it. Click to withdraw the request.`;
  } else {
    b.textContent = "↻ OCR This Page";
    b.title = marked
      ? `PDF-Linker marked this page DID NOT OCR in its PDF. Ask for it to be read again: the page goes on ${TD.VALUES_FILE}, PDF-Linker takes the mark off, and its next full run reads the page and exports its text.`
      : `Undo ⊘ Did not OCR. Where the reader still holds the page's text and the mark never reached the case folder, the text comes straight back; otherwise the page goes on ${TD.VALUES_FILE} and PDF-Linker's next full run reads it again.`;
  }
}
/** Set each page label's button from its page (`indices`, or every page on screen). */
function refreshNocrButtons(indices) {
  if (!doc) return;
  const buttons = indices && indices.length <= 20
    ? indices.map((i) => pagesEl.querySelector(`.tpage[data-index="${i}"] > .page-label .nocr-page`)).filter(Boolean)
    : [...pagesEl.querySelectorAll(".tpage > .page-label .nocr-page")];
  if (!buttons.length) return;
  const sources = ocrAgain.length ? docPageSources() : null;
  for (const b of buttons) {
    const i = Number(b.closest(".tpage").dataset.index);
    const p = doc.pages[i];
    if (!p) continue;
    const e = sources ? pageEntryAt(i, sources) : null;
    setNocrButton(b, pageReadsDidNotOcr(i), !!e && ocrAgain.some((x) => TD.sameNoOcr(x, e)), TD.headerSaysDidNotOcr(p));
  }
  refreshFixButtons(indices);
}

// ── several pages that did not OCR ────────────────────────────────────────────────
//
// ⊘ Did not OCR on every page ticked in the Pages tab (below): each page
// stripped as markDidNotOcr strips one — the text gone for TD.DID_NOT_OCR, a
// request to read it again or a transcription withdrawn, the page put on the
// list for PDF-Linker and shown as its PDF page — and the lot ONE step of the
// undo history (snapshotPages), each page's snapshot tagged as a strip so ↻ OCR
// This Page still puts that page's own text back. A page that already reads
// the mark is passed over.
function markDidNotOcrPages(indices) {
  if (!doc) return;
  const want = indices.filter((i) => doc.pages[i] && doc.pages[i].header != null);
  if (!want.length) return;
  for (const i of want) ensurePageLive(i);
  const todo = [];
  for (const i of want) {
    const body = bodyForPage(i);
    if (!body) continue;
    const was = TD.serializeNodes(body);
    const lines = TD.didNotOcrLines(was.split("\n"));
    const text = lines.join("\n");
    if (text !== was) todo.push({ i, body, lines, text });
  }
  if (!todo.length) { toast(`${want.length === 1 ? "That page already reads" : "Those pages already read"} ${TD.DID_NOT_OCR}.`); return; }
  // One page is the label button's own strip, toast and all.
  if (todo.length === 1) { markDidNotOcr(todo[0].i); return; }
  snapshotPages(todo.map((t) => t.body));
  const steps = new Map(undoStack.slice(-todo.length).map((sn) => [sn.page, sn]));
  for (const sn of steps.values()) sn.nocr = true;
  const sources = docPageSources();
  let again = ocrAgain, fixed = textFixed;
  for (const t of todo) {
    const e = pageEntryAt(t.i, sources);
    if (e) { again = TD.setOcrAgain(again, e, false); fixed = TD.setTextFixed(fixed, e, false); }
  }
  if (again !== ocrAgain || fixed !== textFixed) {
    ocrAgain = again;
    textFixed = fixed;
    persistValues();
    renderFlags();
  }
  convertTypedRealsSoon.cancel();
  hideTypeTip();
  // Each page's keeps off the list of the member it belongs to.
  for (const t of todo) setSpotsListOf(t.i, spotsListOf(t.i).filter((x) => x.page !== t.i));
  for (const t of todo) {
    buildBody(t.body, t.text, t.i);
    doc.pages[t.i].lines = t.lines;
    syncSpots(t.body);
    setDirty(true, t.i);
  }
  syncNoOcr(todo.map((t) => t.i));
  lastSnapPage = -1; // what is typed next is its own step
  afterTextChange();
  // Each page shown as its PDF page where it was showing its text, as one
  // strip does, and each step carries its swap so Ctrl+Z shows the text again.
  const shown = [];
  if (!sbsOn) {
    for (const t of todo) {
      const tg = pdfTarget(t.i);
      const sec = t.body.closest(".tpage");
      if (!tg || !sec || sec.classList.contains("raw") || swaps.has(tg.key)) continue;
      const sn = steps.get(t.i);
      if (sn) sn.view = { key: tg.key, on: true };
      shown.push(tg.key);
    }
  }
  setPageSwaps(shown, true);
  const passed = want.length - todo.length;
  toast(`${todo.length} pages: text stripped, ${TD.DID_NOT_OCR} in its place${shown.length ? `, and ${shown.length === todo.length ? "each" : shown.length} shown as its PDF page` : ""}${passed ? ` (${passed} already read it)` : ""} — Save writes them, and puts them on ${TD.VALUES_FILE} so PDF-Linker never OCRs them again. Ctrl+Z puts every one back.`, { ms: 9000 });
}

// ── the Pages tab ──────────────────────────────────────────────────────────────────
//
// Every page of the document on screen, in the side panel, the way the PDF
// viewer's Pages panel shows a PDF: a picture of each page with its label
// under it. The picture is the page of the PDF the export came from, where one
// is matched (pdfTarget), and a miniature of the text page where none is; the
// label carries what the page carries for PDF-Linker (DID NOT OCR, OCR again,
// Use my text). A click goes to the page, and the row of the page being read is
// marked as the stage scrolls.
//
// Ticked rows are a selection, made the way a list's rows are: a DRAG over the
// pictures ticks every page from the one it started on to the one under the
// pointer, and the list scrolls under it — held past the top or the foot of the
// list, or with the wheel — so a run of pages longer than the panel is one
// drag. Ctrl (⌘) adds the run to the ticks there were rather than starting
// again, Shift+click ticks a run from the last page, Ctrl+click or a page's box
// ticks one. ⊘ Did not OCR at the head of the list strips every ticked page at
// once (markDidNotOcrPages). There is no tick-everything: a document that did
// not OCR from end to end is one not to run at all.
//
// The rows are keyed by the PAGE OBJECT, not its index: a document hung above
// the reel renumbers every page below it (reelShift), and a tick held by number
// would then name another page. A picture is drawn only as its row comes into
// view, so a combined file of two thousand pages lists at once. The list is
// drawn only while it is in sight; a change made while it is not leaves it
// stale, and showing it draws it.
const pagesSideEl = $("side-pages");
const pagesListEl = $("pages-list");
let pagesPicked = new Set(); // the ticked pages: doc.pages objects
let pagesAnchor = null;      // the page a Shift+click runs from
let pagesShape = null;       // the doc.pages objects the rows were built for, in order
let pagesRowOf = new Map();  // page object → its row
let pagesStale = true;       // something moved while the tab was out of sight
let pagesHere = null;        // the row of the page being read
const pagesVisible = new Set(); // rows in or near the panel's view
const pagesThumbObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (en.isIntersecting) { pagesVisible.add(en.target); fillPageThumb(en.target); }
    else { pagesVisible.delete(en.target); dropTextThumb(en.target); }
  }
  pumpPageThumbs();
}, { root: pagesSideEl, rootMargin: "400px 0px" });

function pagesTabShown() {
  return !pagesSideEl.hidden && !document.body.classList.contains("side-hidden");
}
const renderPagesTabSoon = debounce(() => renderPagesTab(), 250);
function pagesTabSoon() {
  pagesStale = true;
  if (pagesTabShown()) renderPagesTabSoon();
}

function renderPagesTab() {
  if (!pagesTabShown()) { pagesStale = true; return; }
  renderPagesTabSoon.cancel();
  pagesStale = false;
  const hint = $("pages-hint");
  if (!doc) {
    pagesThumbObserver.disconnect();
    pagesVisible.clear();
    pagesListEl.innerHTML = "";
    pagesShape = null;
    pagesRowOf = new Map();
    pagesPicked.clear();
    pagesAnchor = null;
    pagesHere = null;
    hint.hidden = false;
    $("pages-bar").hidden = true;
    $("pages-how").hidden = true;
    return;
  }
  hint.hidden = true;
  $("pages-bar").hidden = false;
  $("pages-how").hidden = false;
  const pages = doc.pages;
  // A tick on a page no longer in the document (another one opened) goes.
  if (pagesPicked.size || pagesAnchor) {
    const inDoc = new Set(pages);
    for (const p of pagesPicked) if (!inDoc.has(p)) pagesPicked.delete(p);
    if (pagesAnchor && !inDoc.has(pagesAnchor)) pagesAnchor = null;
  }
  const same = !!pagesShape && pagesShape.length === pages.length && pagesShape.every((p, i) => p === pages[i]);
  if (!same) buildPagesRows();
  else updatePagesRows();
  updatePagesPicked();
  markPagesHere();
  pumpPageThumbs();
}

/** The rows from scratch: the document changed, or pages went on or came off it. */
function buildPagesRows() {
  pagesThumbObserver.disconnect();
  pagesVisible.clear();
  pagesListEl.innerHTML = "";
  pagesRowOf = new Map();
  pagesHere = null;
  pagesShape = doc.pages.slice();
  const frag = document.createDocumentFragment();
  const sources = docPageSources();
  let member = -1;
  doc.pages.forEach((p, i) => {
    // A reel's documents each under their own name; a combined file's banner
    // page names its member itself.
    if (reel.length > 1 && reelIndexOf(i) !== member) {
      member = reelIndexOf(i);
      frag.appendChild(pagesHeading(TD.docLabel(reel[member].name), p, reel[member].name));
    }
    if (p.banner != null) { frag.appendChild(pagesHeading(TD.pageLabel(p), p, p.banner)); return; }
    // Text before the first page header is listed only where there is some.
    if (p.header == null && !p.lines.some((l) => l.trim())) return;
    const li = document.createElement("li");
    li.className = "page-row";
    li.__page = p;
    li.classList.toggle("picked", pagesPicked.has(p));
    // The picture, standing at its page's shape until it is drawn.
    const thumb = document.createElement("div");
    thumb.className = "pr-thumb";
    thumb.style.aspectRatio = `1 / ${pageThumbRatio(i)}`;
    if (p.header != null) {
      const tick = document.createElement("input");
      tick.type = "checkbox";
      tick.className = "pr-tick";
      tick.setAttribute("aria-label", "Tick " + TD.pageLabel(p));
      tick.checked = pagesPicked.has(p);
      thumb.appendChild(tick);
    }
    const head = document.createElement("div");
    head.className = "pr-head";
    const label = document.createElement("span");
    label.className = "pr-label";
    label.textContent = p.header != null ? TD.pageLabel(p) : "Before the first page";
    const tag = document.createElement("span");
    tag.className = "tag pr-tag";
    head.append(label, tag);
    li.append(thumb, head);
    setPageRowTag(li, i, sources);
    pagesRowOf.set(p, li);
    frag.appendChild(li);
  });
  pagesListEl.appendChild(frag);
  for (const li of pagesRowOf.values()) pagesThumbObserver.observe(li);
}
function pagesHeading(text, p, title) {
  const li = document.createElement("li");
  li.className = "pages-doc";
  li.textContent = text;
  li.title = title + " — click to go to it";
  li.__page = p;
  return li;
}

/** The same pages as last time: each row's tag read again, its picture checked again as it is in view. */
function updatePagesRows() {
  const sources = docPageSources();
  doc.pages.forEach((p, i) => {
    const li = pagesRowOf.get(p);
    if (!li) return;
    setPageRowTag(li, i, sources);
    // A picture of the wrong page, or of the text where a PDF is now matched,
    // is drawn again; a text page's is read again (drawTextThumb redraws only
    // where its lines changed).
    const t = pdfTarget(i);
    const kind = t && !pagesThumbFailed.has(t.key) ? "pdf:" + t.key : "text";
    if (li.__thumb !== kind || kind === "text") li.__thumb = null;
  });
  for (const li of pagesVisible) fillPageThumb(li);
}

/** A row's tag: what the page carries for PDF-Linker, if anything. */
function setPageRowTag(li, i, sources) {
  const p = doc.pages[i];
  const tag = li.querySelector(".pr-tag");
  if (!tag) return;
  const e = (ocrAgain.length || textFixed.length) ? pageEntryAt(i, sources) : null;
  const reads = TD.readsDidNotOcr(p.lines);
  let cls = "", text = "", title = "";
  if (reads && e && ocrAgain.some((x) => TD.sameNoOcr(x, e))) {
    cls = "again"; text = "OCR again";
    title = `Asked to be OCR'd again — ${TD.VALUES_FILE} carries the request once it is saved.`;
  } else if (reads) {
    cls = "nocr"; text = "DID NOT OCR";
    title = TD.headerSaysDidNotOcr(p) ? "PDF-Linker marked this page DID NOT OCR." : `The page reads ${TD.DID_NOT_OCR}.`;
  } else if (e && textFixed.some((x) => TD.sameNoOcr(x, e))) {
    cls = "fixed"; text = "Use my text";
    title = "Handed to PDF-Linker as text typed in by hand.";
  }
  tag.className = "tag pr-tag" + (cls ? " " + cls : "");
  tag.textContent = text;
  tag.title = title;
  tag.hidden = !cls;
  li.classList.toggle("nocr", reads);
}

// ── its pictures ──
//
// A page with a PDF matched to it is pictured as that PDF page — what the PDF
// viewer's panel shows, and the way to see at a glance which pages are scans
// the OCR made nothing of. The picture is drawn once, at a fixed width, read
// back as a JPEG and kept by its PDF page (pagesThumbs): scrolling back up the
// list is the picture, not the page decoded again, and a scanned page decodes
// at the resolution it was scanned at whatever the size it is drawn. The
// drawing goes through the PDF queue at its back (`later`), so a page on the
// stage is always drawn first, one picture at a time and the rows on screen
// before the ones only near it; the page is handed back to pdf.js once it is
// pictured, unless the stage is showing it. A page with no PDF, or whose PDF
// page could not be drawn, is pictured as its text, drawn small: the lines as
// the screen shows them, so in real names where Show fakes is off.
//
// A picture is a picture: the screenshot's fakes cannot reach into it, so it
// is blurred while one is taken (fakesForShot, body.shot-taking).
const PAGES_THUMB_PX = 400;   // the width a PDF page is pictured at, in pixels (two to the CSS pixel)
const PAGES_THUMB_HELD = 600; // …and how many pictures are kept, the longest unshown let go first
const PAGES_TEXT_LINES = 80;  // the most lines a text page's picture draws
const pagesThumbs = new Map(); // "<pdf name>|<page>" → { url, ratio }, least recently shown first
const pagesThumbFailed = new Set(); // PDF pages that could not be drawn: pictured as text until the PDFs change
let pagesThumbBusy = null;    // the PDF a picture is being drawn from — trimPdfs leaves it open (pdfsInUse)
let pagesThumbPumping = false;

/** The shape a row's picture stands at: its PDF page's, where known, else the folder's paper. */
function pageThumbRatio(i) {
  const t = pdfTarget(i);
  const held = t && pagesThumbs.get(t.key);
  if (held) return held.ratio;
  const sz = t && pdfSizes.get(t.src.name);
  const s = sz && sz[t.page - 1];
  return s && s.w > 0 && s.h > 0 ? s.h / s.w : pageRatioGuess;
}

/** A row in view: its picture, drawn or held, or asked for (pumpPageThumbs). */
function fillPageThumb(li) {
  if (li.__thumb || !doc || !li.isConnected) return;
  const i = doc.pages.indexOf(li.__page);
  if (i < 0) return;
  const t = pdfTarget(i);
  if (t && !pagesThumbFailed.has(t.key)) {
    const held = pagesThumbs.get(t.key);
    if (held) showPdfThumb(li, t.key, held);
    else li.__want = t.key;
    return;
  }
  li.__want = null;
  drawTextThumb(li, i);
}

function showPdfThumb(li, key, held) {
  const box = li.querySelector(".pr-thumb");
  const cv = box.querySelector("canvas");
  if (cv) cv.remove();
  let img = box.querySelector("img");
  if (!img) {
    img = document.createElement("img");
    img.alt = "";
    img.draggable = false; // a drag over the pictures ticks them; it does not carry one off
    box.prepend(img);
  }
  if (img.src !== held.url) img.src = held.url;
  box.style.aspectRatio = `1 / ${held.ratio}`;
  li.__thumb = "pdf:" + key;
  li.__want = null;
  li.__text = null;
  pagesThumbs.delete(key); // shown: the most recent now
  pagesThumbs.set(key, held);
}

/** The pictures being drawn, one at a time: the rows on screen first, top down, then the ones near it. */
async function pumpPageThumbs() {
  if (pagesThumbPumping) return;
  pagesThumbPumping = true;
  try {
    for (;;) {
      const li = nextThumbRow();
      if (!li) break;
      const i = doc.pages.indexOf(li.__page);
      const t = i >= 0 ? pdfTarget(i) : null;
      // The PDFs moved under it since it asked: asked again, as it stands now.
      if (!t || t.key !== li.__want) { li.__want = null; li.__thumb = null; fillPageThumb(li); continue; }
      pagesThumbBusy = t.src.name;
      const held = await drawPdfThumb(t);
      pagesThumbBusy = null;
      if (held) {
        pagesThumbs.set(t.key, held);
        letGoOfPageThumbs();
      } else pagesThumbFailed.add(t.key);
      for (const row of pagesVisible) {
        if (row.__want !== t.key) continue;
        if (held) showPdfThumb(row, t.key, held);
        else { row.__want = null; row.__thumb = null; fillPageThumb(row); }
      }
      // Asked for and not answered (the row went out of view meanwhile): asked again when it is back.
      if (li.__want === t.key && !pagesVisible.has(li)) li.__want = null;
    }
  } finally {
    pagesThumbPumping = false;
    pagesThumbBusy = null;
  }
}
function nextThumbRow() {
  if (!doc || !pagesTabShown()) return null;
  const box = pagesSideEl.getBoundingClientRect();
  let best = null, bestAway = Infinity, bestTop = Infinity;
  for (const li of pagesVisible) {
    if (!li.__want || !li.isConnected) continue;
    const r = li.getBoundingClientRect();
    const away = r.bottom < box.top ? box.top - r.bottom : r.top > box.bottom ? r.top - box.bottom : 0;
    if (away < bestAway || (away === bestAway && r.top < bestTop)) { best = li; bestAway = away; bestTop = r.top; }
  }
  return best;
}

/** One PDF page pictured: { url, ratio }, or null where it could not be. */
async function drawPdfThumb(t) {
  let info;
  try { info = await loadPdf(t.src); } catch { return null; }
  if (t.page > info.count) return null;
  return new Promise((resolve) => {
    pdfJobs.push({
      name: t.src.name, later: true,
      run: () => renderPdfThumb(info, t.page).then(resolve, () => resolve(null)),
      cancel: () => resolve(null),
    });
    pumpPdfJobs();
  });
}
async function renderPdfThumb(info, pageNo) {
  return duringAsync(`picturing page ${pageNo} of ${info.name} for the Pages tab`, async () => {
    if (!stillOpen(info)) return null;
    const page = await info.pdf.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: PAGES_THUMB_PX / base.width });
    // Drawn where the PDF's fonts are and read back from there (pdf-fonts.js).
    const canvas = fontCanvas(Math.round(vp.width), Math.round(vp.height));
    try {
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
      return blob ? { url: URL.createObjectURL(blob), ratio: base.height / base.width } : null;
    } finally {
      canvas.width = canvas.height = 0; // the JPEG is the copy that is kept
      // …and the page given back, decoded scan and all — unless the stage is
      // showing it, where its own slot gives it back when it lets go.
      if (!pageIsDrawn(page)) {
        let done = false;
        try { done = page.cleanup(); } catch { done = true; }
        if (!done) { pagesToRelease.add(page); releasePagesSoon(); }
      }
    }
  });
}

/** Past PAGES_THUMB_HELD, the pictures shown longest ago go — never one a row in view is showing. */
function letGoOfPageThumbs() {
  if (pagesThumbs.size <= PAGES_THUMB_HELD) return;
  const shown = new Set();
  for (const li of pagesVisible) if (li.__thumb && li.__thumb.startsWith("pdf:")) shown.add(li.__thumb.slice(4));
  const gone = new Set();
  for (const [key, held] of pagesThumbs) {
    if (pagesThumbs.size - gone.size <= PAGES_THUMB_HELD) break;
    if (shown.has(key)) continue;
    gone.add(key);
    URL.revokeObjectURL(held.url);
  }
  for (const key of gone) pagesThumbs.delete(key);
  // A row out of view still holding one of them asks again when it is back.
  for (const li of pagesRowOf.values()) {
    if (!li.__thumb || !li.__thumb.startsWith("pdf:") || !gone.has(li.__thumb.slice(4))) continue;
    const img = li.querySelector(".pr-thumb img");
    if (img) img.remove();
    li.__thumb = null;
  }
}
/** Every picture let go of: the PDFs are another folder's now (forgetPdfs). */
function forgetPageThumbs() {
  for (const held of pagesThumbs.values()) URL.revokeObjectURL(held.url);
  pagesThumbs.clear();
  pagesThumbFailed.clear();
  for (const li of pagesRowOf.values()) {
    const img = li.querySelector(".pr-thumb img");
    if (img) img.remove();
    li.__thumb = null;
    li.__want = null;
  }
}
/** The PDFs matched to the pages changed (refreshPdf): every row's picture is looked at again. */
function pageThumbsMoved() {
  pagesThumbFailed.clear();
  pagesTabSoon();
}

/** A text page pictured: its lines as the screen shows them, drawn small on a sheet. */
function drawTextThumb(li, i) {
  const box = li.querySelector(".pr-thumb");
  const lines = pageLinesShown(i, PAGES_TEXT_LINES);
  const text = lines.join("\n");
  let cv = box.querySelector("canvas");
  if (cv && cv.width && li.__text === text) { li.__thumb = "text"; return; }
  const img = box.querySelector("img");
  if (img) img.remove();
  if (!cv) { cv = document.createElement("canvas"); box.prepend(cv); }
  box.style.aspectRatio = `1 / ${pageRatioGuess}`;
  const w = box.clientWidth || 180;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(w * dpr), H = Math.round(w * pageRatioGuess * dpr);
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  // As wide as its longest line, within reason, and as many lines as fit at
  // no tighter than the type's own height.
  const mx = W * 0.08, my = H * 0.06;
  let cols = 60;
  for (const l of lines) if (l.length > cols) cols = l.length;
  cols = Math.min(cols, 100);
  const fs = (W - 2 * mx) / (cols * 0.6);
  const lh = Math.min(fs * 2.2, Math.max(fs * 1.15, (H - 2 * my) / Math.max(lines.length, 1)));
  ctx.font = `${fs}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#3c4043";
  let y = my;
  for (const l of lines) {
    if (y + fs > H - my) break;
    if (l) ctx.fillText(l, mx, y, W - 2 * mx);
    y += lh;
  }
  li.__thumb = "text";
  li.__text = text;
}
/** A text page's picture let go of as its row leaves the view: it is cheap to draw again, and a bitmap is not. */
function dropTextThumb(li) {
  if (li.__thumb !== "text") return;
  const cv = li.querySelector(".pr-thumb canvas");
  if (cv) cv.width = cv.height = 0;
  li.__thumb = null;
  li.__text = null;
}
/** A page's lines as the screen shows them, line numbers and footer left off. */
function pageLinesShown(i, max) {
  const out = [];
  const tidy = (t) => t.replace(/\t/g, "    ").replace(/\s+$/, "");
  const body = bodyForPage(i);
  if (body) {
    for (const line of body.querySelectorAll(".line")) {
      if (line.classList.contains("trailer")) break;
      const g = line.querySelector(".gutter");
      let t = line.textContent;
      if (g && t.startsWith(g.textContent)) t = t.slice(g.textContent.length);
      out.push(tidy(t));
      if (out.length >= max) break;
    }
  } else {
    // A page the reel has let go of has no body: its lines, as the file has
    // them, through the key as the page would show them.
    for (const l of doc.pages[i].lines) {
      if (TRAILER_RE.test(l)) break;
      const g = TD.gutterPrefix(l);
      out.push(tidy(g ? g.rest : l));
      if (out.length >= max) break;
    }
    if (rev && !settings.showFakes && out.length) out.splice(0, out.length, ...PK.translate(rev, out.join("\n")).text.split("\n"));
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

// ── its ticks ──

/** The pages ticked, by index, in the document's order. */
function pagesPickedIndices() {
  const out = [];
  if (!doc || !pagesPicked.size) return out;
  doc.pages.forEach((p, i) => { if (pagesPicked.has(p)) out.push(i); });
  return out;
}
function setPagePicked(p, on) {
  if (!p || p.header == null) return;
  if (on) pagesPicked.add(p); else pagesPicked.delete(p);
  const li = pagesRowOf.get(p);
  if (!li) return;
  li.classList.toggle("picked", on);
  const tick = li.querySelector(".pr-tick");
  if (tick) tick.checked = on;
}
/** Every page from `from` to `to`, both ends in, ticked or not. */
function pickPagesRun(from, to, on) {
  let a = doc.pages.indexOf(from), b = doc.pages.indexOf(to);
  if (a < 0 || b < 0) { setPagePicked(to, on); return; }
  if (a > b) [a, b] = [b, a];
  for (let i = a; i <= b; i++) setPagePicked(doc.pages[i], on);
}
/** The head of the list: how many are ticked, and what ⊘ Did not OCR would strip. */
function updatePagesPicked() {
  if (!doc) return;
  let todo = 0;
  for (const p of pagesPicked) if (!TD.readsDidNotOcr(p.lines)) todo++;
  const n = pagesPicked.size;
  const read = n - todo;
  $("pages-picked").textContent = n
    ? `${n} ticked` + (read ? ` · ${read} already ${TD.DID_NOT_OCR}` : "")
    : "None ticked";
  $("pages-clear").hidden = !n;
  const btn = $("pages-nocr");
  btn.disabled = !todo;
  btn.textContent = todo ? `⊘ Did not OCR (${todo})` : "⊘ Did not OCR";
}
function clearPagesPicked() {
  for (const p of [...pagesPicked]) setPagePicked(p, false);
  pagesAnchor = null;
}

/** Go to a page from its row: its head at the top of the stage. */
function goToPageFromList(p) {
  const i = doc ? doc.pages.indexOf(p) : -1;
  if (i < 0) return;
  ensurePageLive(i);
  const sec = pagesEl.querySelector(`.tpage[data-index="${i}"]`);
  if (!sec) return;
  // A banner page goes to its divider where the reel hung one above it.
  const at = sec.previousElementSibling && sec.previousElementSibling.classList.contains("reel-divider") && reelMemberOf(i).from === i
    ? sec.previousElementSibling : sec;
  const r = document.createRange();
  r.selectNode(at);
  scrollRangeTo(r, { margin: 8 });
}

/** The row of the page being read, marked and kept in sight in the list. */
function markPagesHere() {
  if (!doc || !pagesShape || !pagesTabShown()) return;
  let i = readingPage();
  // A page with no row of its own (a banner, blank text before the first
  // header) marks the next one that has.
  let li = null;
  while (i < doc.pages.length && !(li = pagesRowOf.get(doc.pages[i]))) i++;
  if (li === pagesHere) return;
  if (pagesHere) pagesHere.classList.remove("here");
  pagesHere = li;
  if (!li) return;
  li.classList.add("here");
  if (pagesDrag) return; // the list is the drag's to scroll
  const box = pagesSideEl.getBoundingClientRect(), r = li.getBoundingClientRect();
  const under = $("pages-bar").getBoundingClientRect().bottom;
  if (r.top < under) pagesSideEl.scrollTop -= under - r.top + 6;
  else if (r.bottom > box.bottom) pagesSideEl.scrollTop += r.bottom - box.bottom + 6;
}
const markPagesHereSoon = debounce(markPagesHere, 80);
stageEl.addEventListener("scroll", () => { if (pagesShape && pagesTabShown()) markPagesHereSoon(); }, { passive: true });

// ── a drag over the pictures ticks them ──
//
// Pressed on a page and dragged onto another, every page between the two is
// ticked, the run following the pointer back and forth until it is let go. A
// press let go on the page it began on is a click (the click handler below
// goes to the page), so the drag starts only once the pointer is over another
// row — or held at the list's edge, which scrolls it. Held past the top of the
// list (under its sticky head) or past its foot, the list scrolls, faster the
// further out the pointer is; turned with the wheel, it scrolls too, and either
// way the run is read again against whatever row is under the pointer now.
const PAGES_EDGE = 36;   // px inside the list's top and foot where a held drag scrolls it
let pagesDrag = null;    // the drag in progress
let pagesDragged = false; // the click that ends a drag is the drag's, not a go-to

pagesListEl.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || !doc) return;
  // Shift+click on the list ticks a run (the click below); it is not a text selection.
  if (e.shiftKey) { e.preventDefault(); return; }
  const li = e.target.closest("li");
  if (!li || !li.__page) return;
  // No text selection and no picture carried off; a page's box still turns on its click.
  if (!e.target.closest(".pr-tick")) e.preventDefault();
  pagesDrag = {
    from: li.__page, row: li, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
    add: e.ctrlKey || e.metaKey, moved: false, on: true, base: null, lo: -1, hi: -1, v: 0, raf: 0, frame: 0,
  };
  window.addEventListener("mousemove", pagesDragMove);
  window.addEventListener("mouseup", pagesDragEnd);
  window.addEventListener("blur", pagesDragEnd);
  pagesSideEl.addEventListener("scroll", pagesDragFollow, { passive: true });
});
function pagesDragMove(e) {
  const d = pagesDrag;
  if (!d) return;
  if (!(e.buttons & 1)) { pagesDragEnd(); return; } // let go of outside the window
  d.x = e.clientX;
  d.y = e.clientY;
  if (!d.frame) d.frame = requestAnimationFrame(() => { if (pagesDrag === d) { d.frame = 0; pagesDragRead(); } });
}
/** The list scrolled under a held drag (the wheel, or the edge): the run read against the row under the pointer now. */
function pagesDragFollow() {
  if (pagesDrag) pagesDragRead();
}
function pagesDragRead() {
  const d = pagesDrag;
  const li = pagesRowAtY(d.y);
  const far = Math.abs(d.x - d.x0) > 8 || Math.abs(d.y - d.y0) > 8;
  if (!d.moved) {
    if (!(li && li !== d.row) && !(far && pagesDragSpeed(d.y))) return;
    d.moved = true;
    // Ctrl adds the run to the ticks there were (or takes it off them, from a
    // ticked page); a plain drag is a new selection.
    d.on = d.add ? !pagesPicked.has(d.from) : true;
    if (!d.add) clearPagesPicked();
    d.base = new Set(pagesPicked);
    pagesListEl.classList.add("dragging");
  }
  if (li) pagesDragRun(li.__page);
  d.v = pagesDragSpeed(d.y);
  if (d.v && !d.raf) d.raf = requestAnimationFrame(pagesDragTick);
}
/** Every page from where the drag began to `to` ticked; any the run has let go of since, as they were. */
function pagesDragRun(to) {
  const d = pagesDrag;
  const a = doc.pages.indexOf(d.from), b = doc.pages.indexOf(to);
  if (a < 0 || b < 0) return;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (lo === d.lo && hi === d.hi) return;
  const from = d.lo < 0 ? lo : Math.min(lo, d.lo), end = d.lo < 0 ? hi : Math.max(hi, d.hi);
  for (let i = from; i <= end; i++) {
    const p = doc.pages[i];
    setPagePicked(p, i >= lo && i <= hi ? d.on : d.base.has(p));
  }
  d.lo = lo;
  d.hi = hi;
  updatePagesPicked();
}
/** How fast a drag held at `y` scrolls the list: px a frame, up (-) or down (+), 0 inside it. */
function pagesDragSpeed(y) {
  const box = pagesSideEl.getBoundingClientRect();
  const bar = $("pages-bar");
  const top = bar.hidden ? box.top : bar.getBoundingClientRect().bottom;
  if (y < top + PAGES_EDGE) return -Math.min(40, Math.ceil((top + PAGES_EDGE - y) / 3));
  if (y > box.bottom - PAGES_EDGE) return Math.min(40, Math.ceil((y - (box.bottom - PAGES_EDGE)) / 3));
  return 0;
}
function pagesDragTick() {
  const d = pagesDrag;
  if (!d) return;
  d.raf = 0;
  d.v = pagesDragSpeed(d.y);
  if (!d.v) return;
  // The scroll event reads the run again (pagesDragFollow).
  pagesSideEl.scrollTop += d.v;
  d.raf = requestAnimationFrame(pagesDragTick);
}
/** The row at height `y` in the list, held inside what is in view — a gap between two reads the nearer. */
function pagesRowAtY(y) {
  const box = pagesSideEl.getBoundingClientRect();
  const bar = $("pages-bar");
  const top = bar.hidden ? box.top : bar.getBoundingClientRect().bottom;
  const at = Math.max(top + 2, Math.min(box.bottom - 2, y));
  const lr = pagesListEl.getBoundingClientRect();
  const x = lr.left + lr.width / 2;
  for (let k = 0; k <= 48; k += 6) {
    for (const yy of k ? [at + k, at - k] : [at]) {
      if (yy < top || yy > box.bottom) continue;
      const el = document.elementFromPoint(x, yy);
      const li = el && el.closest && el.closest("#pages-list li");
      if (li && li.__page) return li;
    }
  }
  return null;
}
function pagesDragEnd() {
  const d = pagesDrag;
  if (!d) return;
  pagesDrag = null;
  window.removeEventListener("mousemove", pagesDragMove);
  window.removeEventListener("mouseup", pagesDragEnd);
  window.removeEventListener("blur", pagesDragEnd);
  pagesSideEl.removeEventListener("scroll", pagesDragFollow);
  if (d.raf) cancelAnimationFrame(d.raf);
  if (d.frame) cancelAnimationFrame(d.frame);
  pagesListEl.classList.remove("dragging");
  if (!d.moved) return; // a click: the click handler has it
  pagesAnchor = d.from;
  pagesDragged = true;
  setTimeout(() => { pagesDragged = false; }, 0);
}

pagesListEl.addEventListener("click", (e) => {
  const tick = e.target.closest(".pr-tick");
  if (pagesDragged) {
    // A drag that began and ended on a page's box: the box is not turned by it.
    if (tick) e.preventDefault();
    return;
  }
  const li = e.target.closest("li");
  if (!li || !doc || !li.__page) return;
  const p = li.__page;
  // A document's heading only ever goes to it.
  const pick = !li.classList.contains("pages-doc") && (!!tick || ((e.ctrlKey || e.metaKey || e.shiftKey) && p.header != null));
  if (!pick) { goToPageFromList(p); return; }
  // A tick has turned itself already; Shift or Ctrl on the row turns it here.
  const on = tick ? tick.checked : e.shiftKey ? true : !pagesPicked.has(p);
  if (e.shiftKey && pagesAnchor) pickPagesRun(pagesAnchor, p, on);
  else setPagePicked(p, on);
  pagesAnchor = p;
  updatePagesPicked();
});
$("pages-clear").addEventListener("click", () => {
  clearPagesPicked();
  updatePagesPicked();
});
$("pages-nocr").addEventListener("click", () => {
  const picked = pagesPickedIndices();
  if (!picked.length) return;
  markDidNotOcrPages(picked);
  // Done with: the ticks come off, and Ctrl+Z is the way back.
  clearPagesPicked();
  renderPagesTab();
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
    || sweep.stamp.flagged !== flagged || sweep.stamp.spots !== spotsSig()
    // …and the documents with unsaved edits, which it reads from the store.
    || sweep.stamp.unsaved !== unsavedSeq;
}
// The open document's spot keeps as the sweep read them. By what they SAY and
// not by identity: the list is made again on every edit of a page, and a
// sweep thrown away per keystroke is the folder read per keystroke.
function spotsSig() { return spots.length ? JSON.stringify(spots) : ""; }
// The "fake it" answers are NOT thrown away with it. They used to be — the
// question had changed — but the save now fakes only what has been answered,
// so a keep taken on one name would have quietly un-decided every name faked
// before it. A name kept since is out of the key's reach and its answer moot;
// the rest still stand. Another case's key clears them (setKey).
function dropSweep() {
  sweep = { stamp: null, rows: [], at: 0, running: false };
}
/**
 * Rows of the folder in the order a walk meets them: the document AFTER the
 * open one first, round the folder, and the one before it last. A walk that
 * took them in the folder's own order would leave the third document for the
 * first, and go round the folder backwards from wherever it was started.
 */
function roundFromHere(rows) {
  if (rows.length < 2) return rows;
  // The document being read by its entry in the list, which a file opened
  // from a picker has even when its handle is another object than the list's.
  const cur = reelCurrent();
  let at = cur && cur.d ? folderDocs.indexOf(cur.d) : -1;
  if (at < 0) at = folderDocs.findIndex((d) => d.handle === fileHandle);
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
  return roundFromHere(LK.walkStops(sweep.rows, {
    isOpen: (d) => d.handle === fileHandle,
    empty: emptyHere(),
    settled: isSettled,
  }));
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
const SWEEP_DOC_SAY = 1500; // ms one document may take before the console names it
let sweepTimer = 0;
let sweepWaiters = []; // what is waiting on the sweep running to end (sweepNow)
/** `now`: not left for a gap in a big folder — a save is waiting on the answer. */
async function sweepFolder({ now = false } = {}) {
  if (!dirHandle || !reals || sweep.running || !sweepStale()) return;
  if (oneDocAtATime() && !now) {
    const quiet = Date.now() - busyAt;
    clearTimeout(sweepTimer);
    if (quiet < SWEEP_QUIET) { sweepTimer = setTimeout(sweepFolder, SWEEP_QUIET - quiet); return; }
  }
  try { await sweepFolderNow(); }
  finally { const w = sweepWaiters; sweepWaiters = []; for (const res of w) res(); }
}
/**
 * The folder swept, and the answer fresh, before going on: a sweep already
 * running is waited for, and one that went stale under it is run again. What
 * a save writes off the screen for the names said to be faked rests on it.
 */
async function sweepNow() {
  for (let k = 0; k < 4; k++) {
    if (!dirHandle || !reals) return;
    if (sweep.running) { await new Promise((res) => sweepWaiters.push(res)); continue; }
    if (!sweepStale()) return;
    await sweepFolder({ now: true });
  }
}
async function sweepFolderNow() {
  sweep = { stamp: { reals, keeps, master: masterKeeps, docs: folderDocs, flagged, spots: spotsSig(), unsaved: unsavedSeq }, rows: [], at: 0, running: true };
  const mine = sweep.stamp;
  // …and the fakes, only where the folder has not already been read for them
  // under this key. A walk through the names drops the sweep at every decision;
  // re-reading forty documents each time for an answer that cannot have changed
  // would be the walk's whole cost.
  const fakesFor = fakesIndexStale() ? { key, docs: folderDocs, set: new Set(), seq: unsavedSeq } : null;
  const flagRx = flaggedMatcher();
  // …and whether every one of them was actually read. A document that would
  // not open leaves the leak count a little short, which is a worse count; it
  // leaves the FAKES index saying a pseudonym stands nowhere, which is a keep
  // held back from a run that was the only thing able to undo it. So one
  // unreadable document is enough to withhold the index entirely, and the
  // keeps waiting on it stay owed.
  let readAll = true;
  await duringAsync("reading the rest of the folder for names in the clear", async (pass) => {
    let clock = await idleClock();
    for (const d of folderDocs) {
      noteDoing(pass, `reading the rest of the folder (${sweep.at + 1} of ${folderDocs.length}: ${d.name})`);
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
      const readFrom = performance.now();
      try {
        // EVERY STEP SAYS ITS OWN NAME. The pass alone said "reading the rest
        // of the folder", which names the file but not what was being done to
        // it — and what was being done to it is the fix. Each of these is a
        // whole-document pass over the text, any one of which can be the hold.
        const step = (what, size) => noteDoing(pass,
          `reading the rest of the folder (${sweep.at} of ${folderDocs.length}: ${d.name}${size ? ", " + Math.round(size / 1024) + " KB" : ""}) — ${what}`);
        step("opening the file");
        // A document with unsaved edits is read as Save will write it.
        const got = await readDoc(d);
        const text = got.text;
        // Read THE WAY THE PAGE READS IT (textdoc.clearReading): page by page,
        // the pseudonyms the run wrote and the spots kept where they stand
        // blanked, the keeps masked, the names of cited decisions spared. The
        // ⚠ beside a document is this reading, and the walk into it is the
        // page's; read differently, a document was marked that the walk found
        // nothing in — a real name that is a word of some other name's fake
        // ("Jones" in "Mary Jones"), or a name kept just there.
        step("looking for the key's real values and the flagged ones", text.length);
        const theirSpots = TD.normalizeSpots(got.entry ? got.entry.spots : lsGet(spotKeyOf(d.name), []));
        const { values, flags } = TD.clearReading(text, { rev, reals, flagRx, spots: theirSpots, mask: maskKept });
        if (values.length || flags) sweep.rows.push({ doc: d, values, flags });
        // …and, from the same reading, which PSEUDONYMS stand here. That is
        // the other half of the folder's answer: a name in the clear is a leak,
        // and a name the run faked is work only a run can undo. Over the raw
        // text, not the masked one — a fake is standing whatever has been kept,
        // and a party of a cited decision is not spared either, the run having
        // faked it all the same. Only `fake` is read off the row: an ambiguous
        // fake cannot say whose it is, and does not have to.
        if (fakesFor && fakesRx && !open) {
          step("looking for the pseudonyms the run wrote", text.length);
          for (const w of PK.findReals(fakesRx, text, { columns: true })) fakesFor.set.add(PK.fold(w.fake));
        }
      } catch { readAll = false; /* unreadable: it is not a document this review can answer */ }
      // A DOCUMENT THAT TOOK TOO LONG SAYS WHICH ONE IT WAS. The sweep reads
      // every file in the folder, and one file whose shape is expensive holds
      // the whole tab — which is how a declaration of capitals took the reader
      // down, and which took four rounds to find because nothing said which
      // file it had been reading. One line names it the first time now.
      const readMs = Math.round(performance.now() - readFrom);
      if (readMs > SWEEP_DOC_SAY) {
        console.warn(`[Text Reader] ${d.name} took ${readMs} ms to read for names in the clear ` +
          `(${Math.round(((await d.handle.getFile().catch(() => ({ size: 0 }))).size || 0) / 1024)} KB). ` +
          `A file that takes seconds here is the shape of it, not its size — say so if the reader stops on it.`);
      }
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
  bounces++; // …and nothing found in it yet: the walk counts the documents it opens
  toast(`Opening ${row.doc.name} — ${row.count} name${row.count === 1 ? "" : "s"} standing in the clear there.`);
  if (await openFolderDoc(row.doc)) return;
  // It would not open. The walk does not stand waiting on a document that is
  // not coming, and does not offer it again: openFolderDoc has said why.
  leakJump = false;
  emptyHere().add(row.doc.name);
  renderNamesBar();
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
  const owed = dirty || pendingWrites().length > 0 || settledInTheClear() > 0;
  if (!owed) return true;
  // The reel and the decision files, as this save always was: nothing off the
  // screen in the middle of a walk (the walk's next document keeps its own).
  // Written as every save in the folder writes, though: in place, and never
  // over a file changed under its edits — a document tagged "changed on disk"
  // holds the walk here rather than going over what PDF-Linker wrote.
  const ok = await saveDocument({ offscreen: false });
  if (!ok) {
    // saveDocument has said why. All this adds is that the walk stopped here
    // because of it, which is not obvious from a message about a save — kept
    // in front of the why rather than in its place, since a toast is one line.
    leakJump = false;
    const why = toastEl.hidden ? "" : toastEl.textContent.trim();
    toast(`${fileName} was not written, so the walk has stayed here.` + (why ? " " + why : " Answer that first."), { error: true, ms: why ? 12000 : 3200 });
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
    if (folderPending()) { renderWaiting("folder"); return; }
    // …nor is a document whose own reading has not landed a document with
    // nothing in it: the bar waits for that too rather than going down on an
    // answer about the document just left.
    if (!readHere()) { renderWaiting("document"); return; }
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
  $("nb-answer").textContent = "undecided — the save leaves it as it stands; " + (h.fake ? `fake it writes \u201c${h.fake}\u201d` : "fake it writes its pseudonym");
  $("nb-answer").title = $("nb-answer").textContent; // it takes the room there is, and a long one is cut short
  $("nb-fake").disabled = !h.fake;
  $("nb-prev").disabled = $("nb-next").disabled = hits.length < 2 && !restOfFolder().length;
  $("nb-rest").textContent = folderRest();
  if (pageSweep && pageSweep.seq === docSeq) {
    // Finishing the page: what is left on it, and what comes after.
    const k = sweepStops().length + 1;
    $("nb-count").textContent = `${k} left on ${pageSweep.label}` + (answered ? ` · ${answered} answered here` : "");
    $("nb-rest").textContent = "· then the worksheet\u2019s next row";
  }
}
/** Whether the folder has still to say what it is carrying. */
function folderPending() {
  return !!dirHandle && !!reals && (sweep.running || sweepStale());
}
/**
 * The bar while a reading is being made: the walk is not over, it is waiting —
 * on the rest of the folder, or on the open document's own marks.
 */
function renderWaiting(on = "folder") {
  const here = on === "document";
  setOnward(true);
  $("nb-count").textContent = "none left here" + (answered ? ` · ${answered} answered here` : "");
  $("nb-type").textContent = "reading";
  $("nb-value").textContent = here ? TD.docLabel(fileName) : folderName || "the folder";
  $("nb-value").title = here
    ? "This document is being read for names standing in the clear"
    : "The rest of the folder is being read for names standing in the clear";
  $("nb-where").textContent = here ? "\u2026" : sweep.running ? `${sweep.at} of ${folderDocs.length}\u2026` : "\u2026";
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
  setBarHeight(); // the stage sits under the bar, whatever its rows now hold
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
  bounces = 0;
  if (what === "here") {
    keepRangeHere(piecesOf(h), h.real);
    leakHits = leakHits.filter((x) => x !== h);
  } else if (what === "no" || what === "never") {
    setKeep(h.real, what, { leak: true });
    leakHits = leakHits.filter((x) => !same(x.real, h.real));
  }
  if (continuePageSweep()) return; // finishing a page: its next name, or the worksheet's next row
  const left = liveLeaks();
  if (!left.length) {
    // Answered the last one HERE: the walk goes straight on to the next
    // document of the folder rather than putting the bar down and leaving the
    // operator to pick it up again from the status bar. Where the decision
    // just taken threw the folder's answer away, the walk says so and goes on
    // the moment it is read again.
    leakStep = -1;
    if (restOfFolder().length) { stepLeak(1, { auto: true }); return; }
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
// Closing the bar puts the names walk away, a page being finished with it: the
// LEAKS review goes on to its next row, and stops on no more names until the
// bar is opened again (pageSweepFor).
$("nb-close").addEventListener("click", () => { const sweeping = !!pageSweep; showNamesBar(false); if (sweeping) finishPageSweep(); });
/**
 * "Fake it": the decision, and the save's licence to act on it.
 *
 * The keeps answer the names that must stay; this answers the ones that must
 * go. The save fakes ONLY names answered so — a name nobody has decided on is
 * left in the file exactly as it stands, and the save warns about it
 * (standingSpans) — so this settles the name, the walk stops offering it, and
 * the next save writes the pseudonym along with everything else.
 *
 * By VALUE, not by place: the save fakes every occurrence of a name alike, so
 * a decision about one is a decision about all of them. Held for the case
 * (below), through keeps taken on other names, and dropped from hand when
 * another case's key is chosen or the folder is forgotten.
 *
 * A LEAKS row answered `yes` or `phrase` is the same answer given on the
 * worksheet, and counts here for as long as the cell says it (sheetFakes): the
 * walk does not stop on a name the worksheet has a row for, so a name answered
 * there was otherwise never settled, and every save left it standing.
 */
let settled = new Set(); // folded values the operator has said to fake
let sheetFakes = new Set(); // …and the ones the LEAKS worksheet has (LK.fakeDecisions), LK.fold-ed
function settledKey(v) { return String(v == null ? "" : v).trim().toLowerCase(); }
function isSettled(v) { return settled.has(settledKey(v)) || sheetFakes.has(LK.fold(v)); }
// KEPT FOR THE CASE, NOT THE SESSION. "Fake it" used to live in memory alone:
// a tab closed on it lost it, and nothing asked, since the decision had not
// touched the text. Now it is remembered per case folder (per file with no
// folder), like the flags, and read back when the folder is opened again; the
// closing prompt and the status bar count every place, in any document of the
// folder, where a name so decided still stands unwritten (settledElsewhere),
// and Save writes them all. Once written everywhere the decision simply has
// nothing left to do — it stays, and holds for a name a later run leaves in
// the clear again. Another case's key still starts with none (setKey); that
// clears the set in hand, not the case's own.
//
// …AND WITHDRAWN THE SAME WAY. Kept for the case, a mistaken "fake it" no
// longer goes away with the tab: every later save would write the name as its
// pseudonym in every document of the folder where it stands. So the decisions
// are listed in the Flagged panel, each with a × that withdraws it (what a
// save has already written stays written; the name is the review's again).
// Kept under the folder's name, as the flags, the spot keeps and the LEAKS
// answers are.
const SETTLED_PREFIX = "textReader.settled.";
function settledStoreKey() { return SETTLED_PREFIX + (folderName || fileName || "loose"); }
// The decisions as they were spelled when taken, for the panel (the set holds
// them folded); an older build stored them folded, and they show so.
let settledShown = new Map();
/** The case's "fake it" decisions, read into the set in hand. */
function loadSettled() {
  const stored = lsGet(settledStoreKey(), []);
  const list = (Array.isArray(stored) ? stored : []).map((v) => String(v == null ? "" : v).trim()).filter(Boolean);
  settled = new Set(list.map(settledKey));
  settledShown = new Map(list.map((v) => [settledKey(v), v]));
  renderSettled();
}
/** …and one more of them remembered for the case, as it was spelled. */
function persistSettled(v) {
  const stored = lsGet(settledStoreKey(), []);
  const list = (Array.isArray(stored) ? stored : []).map((x) => String(x == null ? "" : x).trim()).filter(Boolean);
  const k = settledKey(v);
  if (!list.some((x) => settledKey(x) === k)) list.push(String(v).trim());
  lsSet(settledStoreKey(), list);
}
/**
 * A "fake it" withdrawn: out of the set in hand and out of the case's store.
 * What a save already wrote as the pseudonym stays written; where the name
 * still stands in the clear it is the review's again, and no save writes it.
 */
function unsettleName(k) {
  const key = settledKey(k);
  if (!settled.has(key)) return;
  const shown = settledShown.get(key) || key;
  settled.delete(key);
  settledShown.delete(key);
  const stored = lsGet(settledStoreKey(), []);
  lsSet(settledStoreKey(), (Array.isArray(stored) ? stored : []).filter((x) => settledKey(x) !== key));
  renderSettled();
  renderLeakStatus();
  updateDirty();
  paintHighlights();
  toast(`“${shown}” is no longer to be faked — no save writes it as its pseudonym now${sheetFakes.has(LK.fold(shown)) ? " (the LEAKS worksheet still answers it yes: change the cell there)" : ""}. Where it stands in the clear it is yours to decide again.`, { ms: 7000 });
}
/** The case's "fake it" decisions in the Flagged panel, each with its ×. */
function renderSettled() {
  const block = $("settled-block"), list = $("settled-list");
  if (!block || !list) return;
  list.innerHTML = "";
  const keys = [...settled];
  block.hidden = !keys.length;
  for (const k of keys) {
    const v = settledShown.get(k) || k;
    const li = document.createElement("li");
    li.textContent = v;
    li.title = "Click to find it in the document";
    li.addEventListener("click", () => findInPages(v));
    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "×";
    x.title = "Withdraw “fake it”: no save writes it as its pseudonym from now on (what is written stays written)";
    x.addEventListener("click", (e) => { e.stopPropagation(); unsettleName(k); });
    li.appendChild(x);
    list.appendChild(li);
  }
}
/** The worksheet's fakes read again off its rows: on attach, on every decision, on drop. True where they moved. */
function refreshSheetFakes() {
  const was = sheetFakes;
  sheetFakes = leaks ? LK.fakeDecisions(leaks.parsed.rows) : new Set();
  return was.size !== sheetFakes.size || [...was].some((v) => !sheetFakes.has(v));
}
/**
 * One name settled, from the names bar or from a right click on it: noted,
 * said, and counted. The right click is the way to it where the walk is not —
 * past it, closed, or stepping a worksheet that has a row for it.
 */
function settleName(real, fake, then = "") {
  settled.add(settledKey(real));
  settledShown.set(settledKey(real), String(real).trim());
  persistSettled(real);
  renderSettled();
  answered++;
  decidedHere++;
  bounces = 0;
  const n = leakHits.filter((x) => settledKey(x.real) === settledKey(real)).length;
  toast(`“${real}” will be written as ${fake ? `“${fake}”` : "its pseudonym"} on the next save`
    + (n > 1 ? ` — all ${n} of them here` : "") + "." + (then ? " " + then : ""));
  renderLeakStatus();
  // …and the rest of the folder read for where else it stands: Save writes it
  // there too, and the status bar counts it.
  if (folderOpen()) sweepFolder();
}
function fakeName() {
  const hits = liveLeaks();
  if (!hits.length) { showNamesBar(false); return; }
  const h = hits[Math.min(Math.max(leakStep, 0), hits.length - 1)];
  settleName(h.real, h.fake, "Noted; the walk moves on.");
  if (continuePageSweep()) return;
  const left = liveLeaks();
  if (!left.length) { stepLeak(1, { auto: true }); return; }
  leakStep = Math.min(leakStep, left.length - 1) - 1;
  stepLeak(1);
}
let answered = 0; // what the walk has answered in this document, for the bar to say
$("nb-fake").addEventListener("click", fakeName);
$("nb-here").addEventListener("click", () => decideName("here"));
$("nb-no").addEventListener("click", () => decideName("no"));
$("nb-never").addEventListener("click", () => decideName("never"));
$("nb-skip").addEventListener("click", () => { if (!continuePageSweep()) stepLeak(1); });
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
  for (const h of leakHits) { try { if (piecesOf(h).some((r) => r.isPointInRange(node, offset))) return h; } catch { /* a range from a page since rebuilt */ } }
  return null;
}
/** The unfaked real name a selection touches, or null. */
function leakIn(range) {
  for (const h of leakHits) {
    try {
      if (piecesOf(h).some((r) => r.compareBoundaryPoints(Range.END_TO_START, range) < 0 && r.compareBoundaryPoints(Range.START_TO_END, range) > 0)) return h;
    } catch { /* a range from a page since rebuilt */ }
  }
  return null;
}
/**
 * A name's pieces on the page: one range, or one per line or cell where it is
 * wrapped. A name wrapped down a column has the other column's words between
 * its pieces, and they are not part of it — not to point at, not to keep.
 */
function piecesOf(h) { return h.pieces && h.pieces.length ? h.pieces : [h.range]; }

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
    tipEl.append(document.createElement("br"), `Kept by ${masterInfo ? masterInfo.name : "the master workbook"} — left alone in every case, and not flagged as a leak. Right-click it to take it off the Master Keep.`);
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
  // What of it stands in the clear: the selection less its pseudonyms (and the
  // margin numbers). A selection that is pseudonyms through and through has
  // nothing to flag; one that is only partly faked is a name the run half
  // missed ("Rosa" in the clear beside "Delgado" faked), and is flagged whole.
  if (inFrag || startPn || endPn) {
    for (const el of frag.querySelectorAll(".pn, .gutter")) el.remove();
  }
  const clear = !startPn && !endPn ? !!(inFrag ? /[\p{L}\p{N}]/u.test(frag.textContent) : true)
    : (() => {
      // A selection that starts or ends inside a pseudonym holds a piece of it
      // as plain text in the fragment: what is left once the span's own text
      // is taken off its ends is what stands in the clear.
      const f = range.cloneRange();
      if (startPn) f.setStartAfter(startPn);
      if (endPn) f.setEndBefore(endPn);
      if (f.collapsed || (startPn && endPn && startPn === endPn)) return false;
      const rest = f.cloneContents();
      for (const el of rest.querySelectorAll(".pn, .gutter")) el.remove();
      return /[\p{L}\p{N}]/u.test(rest.textContent);
    })();
  return { text: realTextOf(range), touches, allFaked: touches && !clear, range, pn, here };
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
  $("keep-menu-sub").childNodes[2].nodeValue = master ? " — take it off the Master Keep to fake it."
    : t.here ? " still stands for it." : t.leak ? (isSettled(t.real) ? " on the next save — you said to fake it." : " once you say to fake it — until then the save leaves it as it stands.") : " until PDF-Linker re-runs.";
  if (master) $("keep-menu-fake").textContent = "its KEEP sheet says so";
  // The narrowest keep: this occurrence, and no other. Already one, or already
  // kept for the whole case (or by the master), and there is nothing narrower
  // to ask for.
  // A name standing unfaked can be faked from here too, as the names bar's
  // "fake it" fakes it: it was the one answer a right click could not give.
  $("keep-menu-fake-it").hidden = !t.leak || isSettled(t.real) || !t.fake;
  $("keep-menu-fake-it").textContent = `Fake it — write \u201c${t.fake}\u201d on the next save`;
  $("keep-menu-here").hidden = !!t.here || !!c || master;
  $("keep-menu-no").hidden = c === "no" || master;
  $("keep-menu-never").hidden = c === "never" || master;
  $("keep-menu-undo").hidden = (!c && !t.here) || master;
  $("keep-menu-unmaster").hidden = !master;
  $("keep-menu-undo").textContent = t.here && !c ? "Fake it here after all" : "It is a pseudonym after all";
  keepMenu.hidden = false;
  keepMenu.style.left = Math.max(4, Math.min(window.innerWidth - keepMenu.offsetWidth - 4, x)) + "px";
  keepMenu.style.top = Math.max(4, Math.min(window.innerHeight - keepMenu.offsetHeight - 4, y)) + "px";
}
function hideKeepMenu() { keepMenu.hidden = true; keepMenuFor = null; }
pagesEl.addEventListener("contextmenu", (e) => {
  const pn = e.target.closest && e.target.closest(".pn, [data-here]");
  const target = pn || (() => { const h = leakAt(e.clientX, e.clientY); return h ? { real: h.real, fake: h.fake, leak: true, range: h.range, pieces: piecesOf(h) } : null; })();
  if (!target) return;
  e.preventDefault();
  hideTip();
  showKeepMenu(target, e.clientX, e.clientY);
});
document.addEventListener("mousedown", (e) => { if (!keepMenu.hidden && !keepMenu.contains(e.target)) hideKeepMenu(); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  hideKeepMenu();
  flagPop.hidden = true;
  // Esc stops a pass over the folder's documents before it changes or writes anything.
  if (folderPass) folderPass.stop = true;
  if (savePass) savePass.stop = true;
});

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
// every reader tab attaches it at startup, from wherever it was chosen.
//
// SET UP ONCE. The workbook stands in one place (beside pdf_linker.config), and
// the operator should never have to find it again. Three things stood in the
// way, and each is answered here:
//
//   Reading was all that was asked for. A withdrawal (withdrawMaster) writes
//   the file, and the leave to write was asked for only then — or, where the
//   browser would not put the question, the withdrawal held for the session
//   only. So the write is asked for with the setup, while the click that chose
//   the file is fresh (askMasterWrite), and the renewal asks for both at once.
//
//   The renewal waited in the Flagged panel. A browser restarted wants the grant
//   renewed, and the button for it was where nobody was looking, so the keeps
//   were simply not in force. It is offered in the bar at the top as well
//   (offerMasterRenew). Chrome's own question then offers "Allow on every
//   visit", and once that is chosen — or in the installed app, which keeps the
//   grant by itself — restoreMaster finds the file granted and asks nothing.
//
//   PDF-Linker writes the workbook too: a run adds the keeps it was handed. The
//   reader read it once, at startup, and held that reading for as long as the
//   tab stood open. Coming back to the window it looks at the file's date
//   (refreshMaster) and reads it again where it has changed.
const MASTER_FILE = "master";

// Values taken off the Master Keep for this session only — the workbook could
// not be written — which a reading of the file must not put back.
const masterOffHere = new Set();

async function readMaster(handle, { quiet = false } = {}) {
  const file = await handle.getFile();
  const wb = await parseXlsx(new Uint8Array(await file.arrayBuffer()));
  if (!LK.sheetsLookLikeMaster(wb.sheets)) {
    throw new Error(file.name + ' has no "KEEP" sheet — PDF-Linker\'s master workbook holds the standing keeps there.');
  }
  const m = LK.parseMasterKeeps(wb.sheets, file.name);
  masterKeeps = m.keeps.filter((k) => !masterOffHere.has(LK.fold(k.value))).map((k) => TD.makeKeep(k.control, k.value));
  masterInfo = { name: file.name, sheet: m.sheet, rows: m.rows, partial: m.partial.length, modified: file.lastModified };
  masterHandle = handle;
  masterNeeds = null;
  masterLost = null;
  if (keyOffer.dataset.master) hideKeyOffer(); // renewed from the panel instead
  compileKey();
  if (doc) { remarkKept(); paintHighlights(); }
  renderFlags();
  if (!quiet) {
    toast(`${masterInfo.name}: ${masterKeeps.length} standing keep${masterKeeps.length === 1 ? "" : "s"} in force`
      + (masterInfo.partial ? ` (${masterInfo.partial} keep${masterInfo.partial === 1 ? "" : "s"} of part of a value left to PDF-Linker)` : "") + ".");
  }
}
/**
 * Leave to write the workbook, asked for while a click is fresh: a withdrawal
 * then goes straight to the file. Best effort — where the browser will not ask
 * now, the withdrawal asks again (masterWritable).
 */
async function askMasterWrite(handle) {
  try {
    if ((await permissionOf(handle, "readwrite")) === "granted") return true;
    return !!handle.requestPermission && (await handle.requestPermission({ mode: "readwrite" })) === "granted";
  } catch { return false; }
}
/** A workbook handle chosen or dropped: asked to write, read, and attached from now on. */
async function adoptMaster(handle) {
  await askMasterWrite(handle);
  masterOffHere.clear(); // chosen afresh: the file is the truth again
  await readMaster(handle);
  await rememberFile(MASTER_FILE, handle);
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
  try { await adoptMaster(handle); } catch (e) { toast(String(e.message || e), { error: true }); }
}
/** The workbook chosen in an earlier session, attached again. */
async function restoreMaster() {
  const handle = await rememberedFile(MASTER_FILE);
  if (!handle) return;
  const perm = await permissionOf(handle, "read");
  if (perm === "granted") {
    try { await readMaster(handle, { quiet: true }); } catch (e) { masterUnread(handle, e); }
    return;
  }
  // Not silently: the grant is asked for on a click.
  masterNeeds = handle;
  masterInfo = null;
  renderFlags();
  offerMasterRenew();
}
/** The renewal, offered in the bar at the top — unless something else is being offered there. */
function offerMasterRenew() {
  if (!masterNeeds || !keyOffer.hidden) return;
  showKeyOffer(`The master workbook (${masterNeeds.name}) needs the browser's leave again before its standing keeps are in force. Choose "Allow on every visit" and it will not ask again.`,
    "Allow", renewMaster);
  keyOffer.dataset.master = "1";
}
/** The remembered workbook could not be read: said, not swallowed — its keeps are not in force. */
function masterUnread(handle, e) {
  console.warn(e);
  const name = (handle && handle.name) || "The master workbook";
  masterLost = name; // …and a keep PDF-Linker has spent cannot be checked against it (keepsSpentNote)
  toast(e && e.name === "NotFoundError"
    ? `${name} is no longer where it was chosen, so its standing keeps are not in force. Load it again from the Flagged panel.`
    : `${name} could not be read (${(e && e.message) || e}), so its standing keeps are not in force.`, { error: true, ms: 9000 });
}
async function renewMaster() {
  const handle = masterNeeds;
  if (!handle) return;
  try {
    // Reading and writing in one question, so a withdrawal later asks nothing.
    // Refused the write, the file is still read where reading was allowed.
    const perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted" && (await permissionOf(handle, "read")) !== "granted") {
      toast("The master workbook stays unattached.", { error: true });
      return;
    }
    await readMaster(handle);
  } catch (e) { toast(String(e.message || e), { error: true }); }
}
/**
 * The workbook read again where it has changed since it was read — a run of
 * PDF-Linker's, which adds to its KEEP sheet. Only its date is looked at
 * otherwise, and nothing is asked: a grant the browser has taken back waits
 * for the renewal.
 */
// One look at a time; a second asker is handed the look in progress, so what it
// awaits is the file as it now stands (keepsSpentNote asks before it says a
// keep is not on the master).
let masterChecking = null;
function refreshMaster() {
  if (!masterChecking) masterChecking = refreshMasterNow().finally(() => { masterChecking = null; });
  return masterChecking;
}
async function refreshMasterNow() {
  const handle = masterHandle;
  if (!handle || !masterInfo || masterInfo.loose) return;
  try {
    if ((await permissionOf(handle, "read")) !== "granted") return;
    const file = await handle.getFile();
    if (masterHandle === handle && file.lastModified !== masterInfo.modified) await readMaster(handle, { quiet: true });
  } catch (e) { console.warn(e); }
}
/** The workbook as it stands: the reading at startup finished, and read again where a run has changed it since. */
async function masterSettled() {
  try { await masterRestoring; } catch { /* said where it failed (masterUnread) */ }
  await refreshMaster();
}
window.addEventListener("focus", () => { refreshMaster(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshMaster(); });
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

// ── taking a value off the Master Keep ──────────────────────────────────────────
//
// A standing keep is a decision made in some other matter, and sometimes it is
// the wrong one here: the master workbook keeps a name in every case, so the
// reader will not mark it, the walk will not stop on it and the save will not
// fake it — and PDF-Linker's next run un-fakes it. The operator used to be told
// to go and withdraw it in the workbook's KEEP sheet. It is withdrawn from here
// now: from the × beside it in the Flagged panel's list, from a selection that
// stands in it, or from the right-click menu over it.
//
// It goes from the reader at once — the key is compiled again without it, so a
// name it was holding in the clear is marked and can be faked — and from the
// workbook where the reader can write it (attached with Load master workbook…,
// and the browser allows the write): that row's Fix? cell is emptied, which is
// no decision at all, and nothing else in the file is touched (see
// leaks.masterWithdrawEdits). Where the workbook was opened as a copy, the
// reader says so: the keep is gone for this session only, and PDF-Linker still
// has it. Where it is attached but will not take the write now (Excel holding
// it, the grant not given), the removal is OWED: the status bar counts it and
// the next Save writes it once the workbook can be written (masterPending).

/** Take `values` off the Master Keep, asked first: it is a decision about every case. */
async function withdrawMaster(values) {
  const want = new Set((values || []).map((v) => LK.fold(v)).filter(Boolean));
  const named = masterKeeps.filter((k) => want.has(LK.fold(k.value))).map((k) => k.value);
  if (!named.length) return false;
  const name = masterInfo ? masterInfo.name : "the master workbook";
  const what = named.length === 1 ? `\u201c${named[0]}\u201d` : named.map((v) => `\u201c${v}\u201d`).join(", ");
  const it = named.length === 1 ? "it" : "them";
  // Leave to change the file is asked for FIRST, while the click that asked is
  // fresh: the browser will not put its own question once a dialog has stood
  // between the click and it.
  const writable = await masterWritable();
  // …and where the reader itself still holds them as keeps: a case's own keep
  // is handed to PDF-Linker in New Real Values.txt, and PDF-Linker records
  // every keep it is handed on the master — so a keep left in any case's list,
  // or in the open folder's file, put back the very row this takes off.
  const held = await keepsHeldFor(named);
  if (!confirm(`Remove ${what} from the Master Keep in ${name}?\n\n` +
    `${name} keeps ${it} in every case. Removed, ${it} ${named.length === 1 ? "is" : "are"} no longer left alone: ` +
    `here ${it} ${named.length === 1 ? "is" : "are"} marked wherever ${it} ${named.length === 1 ? "stands" : "stand"} unfaked, ready to fake, ` +
    `and PDF-Linker's next run fakes ${it} wherever a case's key binds ${it}.` + heldNote(held, it, { asking: true }))) return false;
  // Here and now: the reader stops holding them…
  masterKeeps = masterKeeps.filter((k) => !want.has(LK.fold(k.value)));
  // …in every case's list it remembers, and in the open folder's file at the
  // next save (dropKeepsFor) — and in the other folders' files it can reach,
  // now (takeKeepLinesOut).
  dropKeepsFor(named, held);
  compileKey();
  if (doc) { remarkKept(); paintHighlights(); }
  renderFlags();
  // Held off while the files are told, and for the session where the workbook
  // cannot be: a reading of it meanwhile (refreshMaster — the window regains
  // focus as the dialog closes) must not put them back while it still keeps
  // them. Before anything is awaited.
  for (const v of named) masterOffHere.add(LK.fold(v));
  const out = await takeKeepLinesOut(named, held.others.filter((o) => o.dir));
  out.unreached.push(...held.others.filter((o) => !o.dir).map((o) => o.name));
  // …and the workbook is told, where it can be.
  const w = writable.ok ? await writeMasterWithdrawn(named) : writable;
  if (w.ok) for (const v of named) masterOffHere.delete(LK.fold(v));
  const also = heldNote(held, it, out);
  if (w.ok) {
    toast(`${what} ${named.length === 1 ? "is" : "are"} off the Master Keep \u2014 ${name}'s KEEP sheet no longer keeps ${it} (the Fix? cell is empty; the row and its history stay). ` +
      `Where ${it} ${named.length === 1 ? "stands" : "stand"} unfaked here, ${named.length === 1 ? "it is" : "they are"} marked: fake ${it}, and save.` + also,
    // …in red where a folder out of reach still carries one: that is the operator's to do.
    out.unreached.length ? { error: true, ms: 12000 } : { ms: 9000 });
    // The file is the truth: read it again, a run that wrote it meanwhile included.
    if (masterHandle) { try { await readMaster(masterHandle, { quiet: true }); } catch (e) { console.warn(e); } }
  } else if (w.why === "loose") {
    toast(`${what} ${named.length === 1 ? "is" : "are"} off the Master Keep for this session only: ${name} was opened as a copy, so the reader cannot change it \u2014 attach it with Load master workbook\u2026 and remove ${it} again. Its KEEP sheet still keeps ${it}, and PDF-Linker's next run will too.` + also, { error: true, ms: 12000 });
  } else {
    // OWED, NOT DROPPED. The workbook would not take it now (Excel holding
    // it, the grant not given); the removal is a decision like any other, and
    // the next save tries it again, once the workbook may be written.
    for (const v of named) if (!masterPending.some((x) => LK.fold(x) === LK.fold(v))) masterPending.push(v);
    updateDirty();
    const why = w.why === "permission" ? `the browser did not let the reader change ${name}`
      : `${name} could not be changed (${(w.error && (w.error.message || w.error)) || "unknown error"}) \u2014 if Excel has it open, close it`;
    toast(`${what} ${named.length === 1 ? "is" : "are"} off the Master Keep here, and not yet in ${name}: ${why}. The removal is owed \u2014 Save writes it once the workbook can be written; until then PDF-Linker's next run still keeps ${it}.` + also, { error: true, ms: 12000 });
  }
  return true;
}
/**
 * Where the reader holds `values` as keeps of its own, for a Master Keep
 * removal to take them out of as well: { lists, file, others } \u2014 the case
 * lists it remembers that keep one of them ([{ k, name }]: the storage key, and
 * the folder it is kept for), the keep lines on them in the open folder's New
 * Real Values.txt ([{ control, value }]), and the other case folders whose file
 * carries such a line (keepsElsewhere).
 */
async function keepsHeldFor(values) {
  const want = new Set((values || []).map((v) => LK.fold(v)));
  const holds = (list) => (list || []).some((k) => k && want.has(LK.fold(k.value)));
  const lists = [];
  for (const k of storedValueKeys()) if (holds(readStoredValues(k).keeps)) lists.push({ k, name: k.slice(VALUES_PREFIX.length) });
  // The list in hand is the open case's (stored as it moves; asked all the same).
  const mine = valuesStoreKey();
  if (flagsFor === mine && holds(keeps) && !lists.some((l) => l.k === mine)) lists.push({ k: mine, name: mine.slice(VALUES_PREFIX.length) });
  const disk = await valuesFileText();
  const file = typeof disk === "string" ? TD.keepLines(disk).filter((k) => want.has(LK.fold(k.value))) : [];
  const others = await keepsElsewhere(values, lists.map((l) => l.name));
  return { lists, file, others };
}
/** The storage keys of every case list the reader remembers. */
function storedValueKeys(prefix = VALUES_PREFIX) {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
  } catch { /* no storage: nothing is remembered */ }
  return out;
}
/**
 * The OTHER case folders whose New Real Values.txt carries a keep line on one
 * of `values`: [{ name, dir, lines }]. PDF-Linker records every keep line it
 * reads on the master, so a line left in another case's file put a removed
 * value back on the next run THERE, whatever the reader had done here.
 *
 * Looked for in every case the reader keeps a list for (`listed`) or wrote a
 * keep line on one of them for (its record of what was written carries it).
 * Where the reader holds the folder (rememberDir) and the browser's leave to
 * write it stands — asked, never prompted for: one question is already put
 * by the removal — the file itself is read, and `dir` is the folder to take
 * the lines out of (takeKeepLinesOut). Where it does not, the record of what
 * the reader wrote there is all there is to go on, `dir` is null, and the
 * folder is NAMED, in the confirm and the toast: it is the operator who has
 * to open it and save before PDF-Linker runs there. A lone document's list
 * (kept under its file name, or "loose") has no folder, and no file.
 */
async function keepsElsewhere(values, listed) {
  const want = new Set((values || []).map((v) => TD.foldValue(v)).filter(Boolean));
  const on = (lines) => lines.filter((k) => want.has(TD.foldValue(k.value)));
  const wrote = new Map();
  for (const k of storedValueKeys(VALUES_SAVED_PREFIX)) {
    const lines = on(TD.keepLines(lsGet(k, "")));
    if (lines.length) wrote.set(k.slice(VALUES_SAVED_PREFIX.length), lines);
  }
  const names = [...new Set([...(listed || []), ...wrote.keys()])]
    .filter((n) => n && n !== folderName && n !== "loose" && !TD.isExportName(n));
  if (!names.length) return [];
  const dirs = await rememberedDirs();
  const out = [];
  for (const name of names) {
    const dir = dirs.find((d) => d.name === name);
    if (dir && (await permissionOf(dir, "readwrite")) === "granted") {
      // No file is no line — where the folder itself is still there: a folder
      // moved or deleted since it was remembered answers "not found" too, and
      // says nothing of the file wherever the folder went.
      let text = null;
      try { text = await (await (await dir.getFileHandle(TD.VALUES_FILE)).getFile()).text(); }
      catch (e) { if (!e || e.name !== "NotFoundError" || !(await dirStands(dir))) text = undefined; }
      if (text !== undefined) {
        const lines = text == null ? [] : on(TD.keepLines(text));
        if (lines.length) out.push({ name, dir, lines });
        continue;
      }
    }
    if (wrote.has(name)) out.push({ name, dir: null, lines: wrote.get(name) });
  }
  return out;
}
/** Whether a remembered folder is still where it was: one entry of it can be listed. */
async function dirStands(dir) {
  try {
    await dir.keys().next();
    return true;
  } catch { return false; }
}
/**
 * The keep lines on `values` taken out of the files of `others`
 * (keepsElsewhere) the reader can reach, at once — with the master workbook,
 * which is written now too, not left to a Save in a folder that is not open.
 * → { reached, unreached }: the folders' names. A folder's record of what was
 * written goes with its file, and one whose file a run has taken meanwhile has
 * nothing left to take out.
 */
async function takeKeepLinesOut(values, others) {
  const reached = [], unreached = [];
  for (const o of others || []) {
    let ok = false;
    if (o.dir) {
      try {
        const fh = await o.dir.getFileHandle(TD.VALUES_FILE);
        const was = await (await fh.getFile()).text();
        const now = TD.forgetKeepLines(was, values);
        if (now !== was) {
          const w = await fh.createWritable();
          await w.write(new Blob([now], { type: "text/plain" }));
          await w.close();
        }
        ok = true;
      } catch (e) {
        // Taken by a run meanwhile: nothing left to take out (the master is
        // written after this, so the row that run put back goes too).
        ok = !!e && e.name === "NotFoundError" && (await dirStands(o.dir));
        if (!ok) console.warn(e);
      }
    }
    if (!ok) { unreached.push(o.name); continue; }
    const k = VALUES_SAVED_PREFIX + o.name;
    const was = lsGet(k, null);
    if (typeof was === "string") {
      const now = TD.forgetKeepLines(was, values);
      if (now !== was) lsSet(k, now);
    }
    reached.push(o.name);
  }
  return { reached, unreached };
}
/**
 * `values` taken out of every case list in `held` (keepsHeldFor), the list in
 * hand included \u2014 and, where the open folder's file still carries a keep line
 * on one, that line recorded as handed over (TD.noteKeepLines): the list
 * without it then reads as owed to the file, so the status bar counts it, the
 * closing tab asks, and Save writes the file without it \u2014 with nothing in it,
 * where nothing else is left. Opening the folder again before then does not
 * read it back in (adoptFolderNow).
 */
function dropKeepsFor(values, held) {
  const want = new Set((values || []).map((v) => LK.fold(v)));
  const mine = valuesStoreKey();
  // Each list's keeps on them recorded as WITHDRAWN in its case (noteWithdrawn):
  // that case's file, opened again, does not hand them back, and another
  // reader tab holding the case's list lets them go (onWithdrawnElsewhere).
  for (const l of held.lists) {
    if (l.k === mine && flagsFor === mine) continue; // the list in hand, below
    const st = readStoredValues(l.k);
    const kept = st.keeps.filter((k) => !(k && want.has(LK.fold(k.value))));
    if (kept.length !== st.keeps.length) {
      noteKeepsWithdrawn(st.keeps, values, l.name);
      lsSet(l.k, { ...st, keeps: kept });
    }
  }
  if (flagsFor === mine) {
    const kept = keeps.filter((k) => !want.has(LK.fold(k.value)));
    if (kept.length !== keeps.length) {
      noteKeepsWithdrawn(keeps, values);
      keeps = kept;
      persistValues();
    }
  }
  if (held.file.length) {
    const was = lsGet(valuesSavedKey(), "");
    const now = TD.noteKeepLines(was, held.file);
    if (now !== was) lsSet(valuesSavedKey(), now);
    noteWithdrawn(held.file);
  }
  // …and the lines other folders' files carry, whether or not the reader can
  // take them out now (takeKeepLinesOut): withdrawn there too.
  for (const o of held.others || []) noteWithdrawn(o.lines, o.name);
}
/**
 * What a Master Keep removal does to the reader's own keeps, said \u2014 before it
 * (`asking`, the confirm) or after it (the toast) \u2014 or "" where it does nothing
 * to them.
 */
function heldNote(held, it, { asking = false, reached = null, unreached = null } = {}) {
  const one = it === "it";
  // A list is kept under its folder's name — or a lone file's, or "loose" for
  // the documents opened with neither.
  const lists = held.lists.length ? nameList(held.lists.map((l) => (l.name === "loose" ? "documents opened on their own" : l.name)), 4) : "";
  const file = held.file.length ? `${folderName}'s ${TD.VALUES_FILE}` : "";
  // Other folders' files: those the reader takes the lines out of now, and
  // those out of its reach — before the removal, by whether the folder can be
  // written; after it, by what was done.
  const others = held.others || [];
  const near = reached || others.filter((o) => o.dir).map((o) => o.name);
  const far = unreached || others.filter((o) => !o.dir).map((o) => o.name);
  const filesIn = (names) => (names.length === 1 ? `${TD.VALUES_FILE} in ${names[0]}` : `the ${TD.VALUES_FILE} files in ${nameList(names, 4)}`);
  const nearIn = near.length ? filesIn(near) : "";
  const farIn = far.length ? filesIn(far) : "";
  const farDo = far.length ? `${far.length === 1 ? `open ${far[0]}` : "open each of those folders"} here and Save before PDF-Linker runs there` : "";
  const carry = far.length === 1 ? "carries" : "carry";
  if (!lists && !file && !nearIn && !farIn) return "";
  if (asking) {
    const parts = [];
    if (lists) parts.push(`off this reader's keeps for ${lists}`);
    if (file) parts.push(`out of ${file}, which still carries ${it} \u2014 Save writes that`);
    if (nearIn) parts.push(`out of ${nearIn}`);
    return `\n\n` +
      (parts.length ? `${one ? "It also comes" : "They also come"} ${parts.join(", and ")}. ` : "") +
      (farIn ? `${farIn} still ${carry} ${it}, out of the reader's reach now: ${farDo}. ` : "") +
      `Left there, PDF-Linker's next run would put ${it} back on the Master Keep.`;
  }
  return (lists ? ` ${one ? "It is" : "They are"} off this reader's keeps for ${lists} too${file ? "," : "."}` : "") +
    (file ? `${lists ? " and" : ""} Save takes ${it} out of ${file}.` : "") +
    (nearIn ? ` ${one ? "It is" : "They are"} out of ${nearIn}.` : "") +
    (farIn ? ` \u26a0 ${farIn} still ${carry} ${it}: ${farDo}, or the run puts ${it} back on the Master Keep.` : "");
}
/** Whether the attached workbook may be written, asking the browser where it has to: { ok, why }. */
async function masterWritable() {
  const handle = masterHandle;
  if (!handle || !masterInfo || masterInfo.loose || !handle.createWritable) return { ok: false, why: "loose" };
  try {
    if (handle.queryPermission && (await handle.queryPermission({ mode: "readwrite" })) === "granted") return { ok: true };
    if (!handle.requestPermission || (await handle.requestPermission({ mode: "readwrite" })) === "granted") return { ok: true };
    return { ok: false, why: "permission" };
  } catch (e) {
    return { ok: false, why: "permission", error: e };
  }
}
/** The workbook with `values` taken off its KEEP sheet, written where it came from: { ok, why, error }. */
async function writeMasterWithdrawn(values) {
  const handle = masterHandle;
  if (!handle || !masterInfo || masterInfo.loose || !handle.createWritable) return { ok: false, why: "loose" };
  try {
    // The file as it is NOW, not as it was read: a run may have written it since.
    const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    const name = handle.name || masterInfo.name;
    const wb = await parseXlsx(bytes);
    const w = LK.masterWithdrawEdits(wb.sheets, name, values);
    if (!w.edits.length) return { ok: true }; // the file no longer keeps them
    if (!w.part) throw new Error("its KEEP sheet has no part to write");
    const out = await XW.writeSheetCells(bytes, w.part, w.edits);
    // Read back before it is written: these are no longer kept, every other
    // keep is exactly as it was.
    const gone = new Set(values.map((v) => LK.fold(v)));
    const was = LK.parseMasterKeeps(wb.sheets, name).keeps.map((k) => k.control + ":" + LK.fold(k.value)).filter((k) => !gone.has(k.slice(k.indexOf(":") + 1)));
    const now = LK.parseMasterKeeps((await parseXlsx(out)).sheets, name).keeps.map((k) => k.control + ":" + LK.fold(k.value));
    if (now.join("\n") !== was.join("\n")) throw new Error("the edited workbook did not read back as it should, so it was not written");
    const writer = await handle.createWritable();
    await writer.write(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    await writer.close();
    return { ok: true };
  } catch (e) {
    if (e && e.name === "NotAllowedError") return { ok: false, why: "permission" };
    return { ok: false, why: "error", error: e };
  }
}
/** The Master Keep's values the key binds, matched: what a selection may be standing in. */
let masterRxMemo = { master: null, key: null, rx: null };
function masterMatcher() {
  if (masterRxMemo.master !== masterKeeps || masterRxMemo.key !== key) {
    const mine = masterKeeps.filter((k) => keyBinds(k.value)).map((k) => k.value);
    masterRxMemo = { master: masterKeeps, key, rx: mine.length ? PK.buildMatcher(mine) : null };
  }
  return masterRxMemo.rx;
}
/**
 * The Master Keep's values that keep a selection from being faked: a pseudonym
 * whose real value it keeps, a kept value the selection takes in, or a kept
 * phrase standing around the words selected. Only values the key binds — a
 * keep of anything else is keeping nothing from being faked.
 */
function masterHeldIn(s) {
  if (!masterInfo || !masterKeeps.length || !s) return [];
  const out = [];
  const add = (v) => {
    const k = masterKeeps.find((x) => LK.fold(x.value) === LK.fold(v));
    if (k && keyBinds(k.value) && !out.includes(k.value)) out.push(k.value);
  };
  if (s.pn && keptBy(pnReal(s.pn)) === "master") add(pnReal(s.pn));
  const rx = masterMatcher();
  const at = s.range.commonAncestorContainer;
  const body = (at.nodeType === 1 ? at : at.parentElement) && (at.nodeType === 1 ? at : at.parentElement).closest(".page-body");
  if (rx && body) {
    const { text, segs } = flatten(body, { blankPn: true });
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(text))) {
      const r = rangeFor(segs, m.index, m.index + m[0].length);
      try {
        if (r && r.compareBoundaryPoints(Range.END_TO_START, s.range) < 0 && r.compareBoundaryPoints(Range.START_TO_END, s.range) > 0) add(PK.foldGaps(m[0]));
      } catch { /* a range from a page since rebuilt */ }
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
    rx.lastIndex = 0;
  }
  add(realTextOf(s.range));
  return out;
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
/**
 * The page's spots read back off it, into the list of the MEMBER the page
 * belongs to and that member's own store. On a reel the page may be another
 * document's than the open one, and filing its keeps under the open document
 * — rebased by the open document's first page — put a keep where there was
 * none and lost the one there was. A page built off the screen keeps its own.
 */
function syncSpots(body) {
  if (isShadow(body)) return;
  const page = pageIndexOf(body);
  setSpotsListOf(page, spotsListOf(page).filter((x) => x.page !== page).concat(spotsFromBody(body, page)));
  persistMemberSpots(reelMemberOf(page));
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
  // Another name can stand between two pieces — the other column's, where the
  // name is wrapped down a column — so those are passed over.
  for (let i = at - 1, want = mine - 1; i >= 0 && want >= 0; i--) {
    if (!same(all[i])) continue;
    if (pieceOf(all[i]) !== want) break;
    out.unshift(all[i]);
    want--;
  }
  for (let i = at + 1, want = mine + 1; i < all.length && want < count; i++) {
    if (!same(all[i])) continue;
    if (pieceOf(all[i]) !== want) break;
    out.push(all[i]);
    want++;
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
/**
 * Keep an unfaked real name where it stands: the save leaves this one as it
 * reads. `ranges`: the name, or its pieces where it is wrapped (piecesOf) — a
 * name wrapped down a column is kept piece by piece, and the other column's
 * words between them are left alone.
 */
function keepRangeHere(ranges, real) {
  const parts = [];
  for (const range of Array.isArray(ranges) ? ranges : [ranges]) {
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
  }
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

/** Whether the folder's fakes index is out of step with the key, the folder, or the documents edited off the screen. */
function fakesIndexStale() {
  return !caseFakes.set || caseFakes.key !== key || caseFakes.docs !== folderDocs || caseFakes.seq !== unsavedSeq;
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
  return TD.carriesKeep(lsGet(valuesSavedKey(), ""), k.value, k.control);
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
  // A keep taken afresh (or its control changed) is a decision not yet handed
  // over, whatever was written for the value before: that line may be one
  // PDF-Linker has spent, and this one would be retired with it unsent.
  if (control && TD.keptControl(keeps, real) !== control) forgetWrittenKeep(real);
  // …and is no longer withdrawn; a keep withdrawn is recorded as such, so the
  // folder's file, which may still carry its line, does not hand it back.
  if (control) forgetWithdrawn([real]);
  else noteKeepsWithdrawn(keeps, [real]);
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
  else if (t.range) keepRangeHere(t.pieces || t.range, t.real);
});
$("keep-menu-unmaster").addEventListener("click", () => {
  const t = keepMenuFor;
  hideKeepMenu();
  if (t) withdrawMaster([t.real]);
});
$("keep-menu-fake-it").addEventListener("click", () => {
  const t = keepMenuFor;
  hideKeepMenu();
  if (t) settleName(t.real, t.fake);
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
// A press on the pages with flagging on, not yet let go: the pop-up waits for
// the release, which flags the selection or asks its question then.
let flagDrag = false;
function showFlagPop() {
  const s = flagDrag ? null : currentSelection();
  if (!s) { flagPop.hidden = true; return; }
  const problem = TD.flagProblem(s.text, s.allFaked);
  flagPopBtn.disabled = !!problem;
  flagPopNote.textContent = problem || "";
  // A pseudonym in the selection: the question is the other one. An
  // unfaked real name in it: whether to leave it so. Either way, where more
  // of the selection stands in the clear than the name the question is
  // about, the selection is still flagged as it reads, whole: the name the
  // run half missed.
  const pnIn = s.pn;
  const hereIn = pnIn ? null : s.here;
  const leak = pnIn || hereIn ? null : leakIn(s.range);
  $("flag-pop-keep").hidden = !pnIn && !hereIn && !leak;
  if (hereIn) {
    flagPopBtn.disabled = true;
    flagPopNote.textContent = "\u201c" + hereIn.textContent + "\u201d is kept where it stands. Change it?";
    $("flag-pop-keep").onclick = (e) => { e.preventDefault(); flagPop.hidden = true; showKeepMenu(hereIn, e.clientX, e.clientY); };
  } else if (pnIn) {
    flagPopNote.textContent = s.allFaked
      ? "Wrongly faked? Keep \u201c" + pnIn.dataset.real + "\u201d:"
      : "\u201c" + pnIn.dataset.real + "\u201d is faked already; the flag hands PDF-Linker the whole name. Wrongly faked? Keep it:";
    $("flag-pop-keep").onclick = (e) => { e.preventDefault(); flagPop.hidden = true; showKeepMenu(pnIn, e.clientX, e.clientY); };
  } else if (leak) {
    // The leak alone is the names bar's question (fake it, or keep it); a
    // selection with more than the leak in it is a name to flag.
    const only = sameWords(s.text, leak.real);
    flagPopBtn.disabled = only || !!problem;
    flagPopNote.textContent = only
      ? "\u201c" + leak.real + "\u201d is in the key and stands unfaked. Leave it so?"
      : "\u201c" + leak.real + "\u201d is in the key and stands unfaked here; the flag hands PDF-Linker the whole name. Leave \u201c" + leak.real + "\u201d so?";
    $("flag-pop-keep").onclick = (e) => { e.preventDefault(); flagPop.hidden = true; showKeepMenu({ real: leak.real, fake: leak.fake, leak: true, range: leak.range, pieces: piecesOf(leak) }, e.clientX, e.clientY); };
  }
  // A value the worksheet has a row for, still to answer (orange, dashed): the
  // row is where it is answered, and the bar opens on it where the text stands.
  const row = pnIn || hereIn || leak ? -1 : pendingRowIn(s);
  $("flag-pop-row").hidden = row < 0;
  if (row >= 0) {
    const r = leakRows()[row];
    flagPopBtn.disabled = true;
    flagPopNote.textContent = "\u201c" + r.value + "\u201d has a row in " + leaks.name + " still to answer.";
    $("flag-pop-row").title = `Open row ${row + 1} in the worksheet's bar, without moving the text, and answer it there`;
    $("flag-pop-row").onclick = (e) => { e.preventDefault(); flagPop.hidden = true; goToLeak(row, { locate: false }); };
  }
  // Kept by the master workbook: that is what stands between it and a fake,
  // and the answer is to take it off the Master Keep.
  const held = hereIn ? [] : masterHeldIn(s);
  $("flag-pop-master").hidden = !held.length;
  if (held.length) {
    const what = held.map((v) => "\u201c" + v + "\u201d").join(", ");
    flagPopNote.textContent = `${what} ${held.length === 1 ? "is" : "are"} kept in every case by ${masterInfo ? masterInfo.name : "the master workbook"} \u2014 that is what keeps ${held.length === 1 ? "it" : "them"} from being faked.`;
    $("flag-pop-master").title = `Take ${what} off the Master Keep: ${held.length === 1 ? "it" : "they"} can then be faked here, and PDF-Linker fakes ${held.length === 1 ? "it" : "them"} on its next run`;
    $("flag-pop-master").onclick = (e) => { e.preventDefault(); flagPop.hidden = true; withdrawMaster(held); };
  }
  // Several words, one of which the key already fakes or flags on its own, or
  // one already flagged: the question may be whether they go TOGETHER.
  const phrase = hereIn ? null : phraseIn(s, leak);
  $("flag-pop-phrase").hidden = !phrase;
  if (phrase) {
    $("flag-pop-phrase").title = TD.isPhrase(phrases, phrase)
      ? `\u201c${phrase}\u201d is already flagged as one phrase`
      : `\u201c${phrase}\u201d is one name: fake the words whole, together (PDF-Linker's phrase)`;
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
$("flag-pop-master").addEventListener("mousedown", (e) => e.preventDefault());
$("flag-pop-row").addEventListener("mousedown", (e) => e.preventDefault());
$("flag-pop-phrase").addEventListener("mousedown", (e) => e.preventDefault());
$("flag-pop-phrase").addEventListener("click", phraseSelection);
flagPopBtn.addEventListener("click", flagSelection);

// ── flagging by selecting ───────────────────────────────────────────────────────
//
// 🚩 in the tools panel is a switch. On, a name selected on the page with the
// mouse is flagged as the button is let go — a drag or a double-click, then
// straight on to the next, with no button to reach for in between. Only what
// the pop-up's Flag would take without a question: a selection that asks one
// (kept where it stands, the orange name alone, held by the Master Keep, a
// pseudonym through and through, a passage) stays selected with the pop-up
// asking it. A flagged selection is let go of, the caret left at its end, so
// the red mark shows and the next drag starts clean. Ctrl+Shift+F still flags
// the one selection. The switch is not remembered: a reader never opens
// flagging what is only being read.
let flagMode = false;
const flagBtn = $("flag-btn");
const flagBtnTitle = flagBtn.title;
function setFlagMode(on) {
  flagMode = !!on;
  flagDrag = false;
  flagBtn.setAttribute("aria-pressed", String(flagMode));
  flagBtn.title = flagMode
    ? "Flagging is on: select a name on the page with the mouse and let go, and it is flagged. Click to turn flagging off."
    : flagBtnTitle;
  document.body.classList.toggle("flag-mode", flagMode);
}
/** Whether the selection is flagged as it stands, as the pop-up's Flag would flag it. */
function flagTakes(s) {
  if (TD.flagProblem(s.text, s.allFaked)) return false;
  const hereIn = s.pn ? null : s.here;
  if (hereIn) return false;
  const leak = s.pn ? null : leakIn(s.range);
  if (leak && sameWords(s.text, leak.real)) return false;
  if (!leak && pendingRowIn(s) >= 0) return false;
  return !masterHeldIn(s).length;
}
/** The selection flagged, or its question asked; whether it was flagged. */
function flagWhereReleased() {
  const s = currentSelection();
  if (!s) return false;
  if (!flagTakes(s)) { showFlagPop(); return false; }
  flagSelection();
  const sel = document.getSelection();
  if (sel && sel.rangeCount) sel.collapseToEnd();
  return true;
}
flagBtn.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
flagBtn.addEventListener("click", () => {
  if (flagMode) { setFlagMode(false); toast("Flagging off."); return; }
  setFlagMode(true);
  // A name selected before the click is flagged with it, as the button always did.
  if (!flagWhereReleased()) toast("Flagging on: select a name and let go to flag it. Click 🚩 again to stop.", { ms: 4500 });
});
// Taken on the document, in the capture phase, so the page's own handlers
// (the numbered margin's) cannot keep it from being seen.
document.addEventListener("mousedown", (e) => {
  // A triple-click's line is a passage more often than a name: the pop-up asks.
  flagDrag = flagMode && e.button === 0 && e.detail < 3 && !e.ctrlKey && !e.metaKey && !e.altKey && pagesEl.contains(e.target);
  if (flagDrag) flagPop.hidden = true;
}, true);
// The selection is only final once the browser has finished settling it.
document.addEventListener("mouseup", (e) => {
  if (!flagDrag || e.button !== 0) return;
  flagDrag = false;
  setTimeout(() => { if (flagMode) flagWhereReleased(); }, 0);
});

/** Whether two values are the same words, case, spacing and punctuation aside. */
function sameWords(a, b) {
  return wordsOf(a) === wordsOf(b);
}
/** A value's words, lowercased, one space between: what sameWords compares. */
function wordsOf(x) {
  return (String(x).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).join(" ");
}
function flagSelection() {
  const s = currentSelection();
  const problem = s ? TD.flagProblem(s.text, s.allFaked) : "Select the unfaked name first.";
  if (problem) { toast(problem, { error: true }); return; }
  // An unfaked name from the key, selected alone, is the names bar's to
  // decide (fake it, or keep it): a flag would hand PDF-Linker a name it
  // already has. With more of the name around it, it is flagged whole.
  const leak = s.pn || s.here ? null : leakIn(s.range);
  if (leak && sameWords(s.text, leak.real)) { toast(`"${leak.real}" is in the key already and stands unfaked here: fake it from the names bar, or keep it (right-click).`, { error: true }); return; }
  // A value the worksheet has a row for is answered on that row: a flag would
  // hand PDF-Linker the value it raised itself, under a second rule.
  const row = leak ? -1 : pendingRowIn(s);
  if (row >= 0) { toast(`"${leakRows()[row].value}" has a row in ${leaks.name} still to answer: answer it there (⚠ Leaks).`, { error: true }); return; }
  const before = flagged.length;
  flagged = TD.addValue(flagged, s.text);
  const v = TD.normalizeValue(s.text);
  persistValues();
  renderFlags();
  paintHighlights();
  flagPop.hidden = true;
  noteInFlagged();
  // A word of it already faked: the export carries that word's fake, so the
  // name is not there for Apply Fixes to find (as with a phrase, markPhrase).
  const faked = flagged.length > before && (!!s.touches || phraseFakedInFile(v));
  toast((flagged.length > before ? `Flagged "${v}" — ${flagged.length} value${flagged.length === 1 ? "" : "s"} to hand to PDF-Linker` : `"${v}" is already flagged`)
    + (faked ? ". A word of it is already faked in the file, so it takes Re-run PDF-Linker; Apply Fixes cannot find the name in the export." : ""), { ms: faked ? 7000 : 3200 });
}

/**
 * A selection as the real names read: each pseudonym as the name it stands
 * for (whole, where the selection starts or ends inside one), the gutter
 * numbers out, and a line break a space — a phrase wrapped at the margin is
 * still one phrase.
 */
function realTextOf(range) {
  const frag = range.cloneContents();
  for (const g of frag.querySelectorAll(".gutter")) g.remove();
  for (const pn of frag.querySelectorAll(".pn")) pn.textContent = pn.dataset.real || pn.textContent;
  const lines = frag.querySelectorAll(".line");
  return TD.normalizeValue(lines.length ? [...lines].map((l) => l.textContent).join(" ") : frag.textContent);
}
/** Whether `inner` stands in `outer` as whole words. */
function holdsWords(outer, inner) {
  const a = TD.foldValue(outer), b = TD.foldValue(inner);
  if (!b || a === b) return false;
  const esc = b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(?<![\\p{L}\\p{N}])" + esc + "(?![\\p{L}\\p{N}])", "u").test(a);
}
/**
 * The phrase a selection could be marked as, or null. Several words, and a
 * reason to ask: a word of them the key already fakes (a pseudonym), stands
 * unfaked and marked (a leak), or a value already flagged on its own.
 */
function phraseIn(s, leak) {
  if (!/\S\s+\S/.test(s.text) || s.text.length > 4 * TD.VALUE_MAX) return null;
  const v = realTextOf(s.range);
  if (TD.phraseProblem(v)) return null;
  // The key fakes these words whole already: there is nothing to put together.
  if (TD.fakeFor(fwd, v)) return null;
  const touches = s.pn || leak || leakIn(s.range) || flagged.some((f) => holdsWords(v, f));
  // …or the words ARE a value flagged already, and the question left is
  // whether that flag goes whole.
  return touches || TD.isPhrase(flagged, v) || TD.isPhrase(phrases, v) ? v : null;
}
/**
 * Whether the open document carries the phrase with a word of it already
 * faked — "Cross Zed Bank" where the key fakes "River" — which only a full
 * re-run puts back together: Apply Fixes reads the export, and the export
 * holds no phrase there to find.
 */
function phraseFakedInFile(v) {
  if (!doc || !fwd) return false;
  const words = TD.findRealsInPlain(fwd, [{ node: null, text: v }]);
  if (!words.length) return false;
  let carried = "", at = 0;
  for (const w of words) { carried += v.slice(at, w.start) + w.fake; at = w.end; }
  const rx = PK.buildMatcher([carried + v.slice(at)]);
  if (!rx) return false;
  rx.lastIndex = 0;
  return rx.test(TD.serializeExport(doc));
}
/**
 * Mark the selection as one phrase: flagged as a value like any other, and
 * written as `phrase: VALUE`, which PDF-Linker reads as the worksheet's own
 * `phrase` — the words faked whole, as one name, a word of them it fakes or
 * keeps on its own notwithstanding.
 */
function phraseSelection() {
  const s = currentSelection();
  const v = s ? realTextOf(s.range) : "";
  const problem = TD.phraseProblem(v);
  if (problem) { toast(problem, { error: true }); return; }
  flagPop.hidden = true;
  if (TD.isPhrase(phrases, v) && TD.isPhrase(flagged, v)) { toast(`"${v}" is already flagged as one phrase`); return; }
  // A word of it already faked in the file: the export carries that word's
  // fake, so the text-only pass has no real phrase left to find there.
  markPhrase(v, !!s.pn || phraseFakedInFile(v));
  noteInFlagged();
}
/**
 * The phrase marked, from a selection or from a value already on the Flagged
 * list: flagged if it is not yet, and written as `phrase:` from now on.
 */
function markPhrase(v, faked) {
  const was = TD.isPhrase(flagged, v);
  flagged = TD.addValue(flagged, v);
  phrases = TD.addValue(phrases, v);
  persistValues();
  renderFlags();
  paintHighlights();
  sweepFolder(); // a phrase held whole changes what the rest of the folder is carrying
  const alone = flagged.filter((f) => holdsWords(v, f));
  toast((was ? `"${v}" is flagged as one phrase now` : `Flagged "${v}" as one phrase`) + " — PDF-Linker fakes the words whole, together."
    + (faked ? " A word of it is already faked in the file, so it takes Re-run PDF-Linker; Apply Fixes cannot find the phrase in the export."
      : heldPhrases().includes(v) ? " Until then a save leaves it standing whole." : "")
    + (alone.length ? ` ${alone.map((f) => `"${f}"`).join(", ")} ${alone.length === 1 ? "is" : "are"} still flagged on ${alone.length === 1 ? "its" : "their"} own — withdraw ${alone.length === 1 ? "it" : "them"} in the Flagged list if ${alone.length === 1 ? "it" : "they"} only ever stood here.` : ""));
}
/** …and back to an ordinary flag: the words still faked, each as the key has it. */
function unmarkPhrase(v) {
  phrases = TD.removeValue(phrases, v);
  persistValues();
  renderFlags();
  paintHighlights();
  sweepFolder(); // a phrase no longer held whole is the folder's business too
  toast(`"${v}" is an ordinary flag again — PDF-Linker fakes it as a value, not as one phrase.`);
}

function valuesStoreKey() { return VALUES_PREFIX + (folderName || fileName || "loose"); }
function valuesSavedKey() { return VALUES_SAVED_PREFIX + (folderName || fileName || "loose"); }
/**
 * THE KEEPS WITHDRAWN, case by case (`textReader.keepsWithdrawn.<name>`): the
 * keep lines the operator took off the list — its ×, "It is a pseudonym after
 * all", a LEAKS answer that is a keep no longer, Remove from Master Keep —
 * that New Real Values.txt may still carry. Opening the folder merges the
 * file's keep lines into the list (a line written in another session, or one
 * another reader tab's list was stored over), but never a line recorded here:
 * that is the file's old copy of a decision withdrawn, owed OUT of the file at
 * the next save. Recorded at the moment it is withdrawn, never inferred from
 * the list lacking a line the reader once wrote — which is also what another
 * tab's stale list, stored over this one, looks like, and that keep was not
 * withdrawn. A line leaves the record when the keep is taken again
 * (forgetWithdrawn), and when the folder's file is seen, read or written,
 * without it (trimWithdrawn). Kept as keep lines (TD.noteKeepLines).
 */
function withdrawnKey(name = folderName || fileName || "loose") { return WITHDRAWN_PREFIX + name; }
function setWithdrawn(k, text) {
  if (String(text || "").trim()) { lsSet(k, text); return; }
  try { localStorage.removeItem(k); } catch { /* no storage: nothing was kept */ }
}
/**
 * `lines` ({ control, value }) recorded as withdrawn in the case kept under
 * `name` (the open one by default). Only a case FOLDER has a file to keep
 * them out of: a lone document's list (kept under its file name, or "loose")
 * records nothing, which nothing would ever read or trim.
 */
function noteWithdrawn(lines, name) {
  const n = name != null ? name : folderName;
  if (!n || n === "loose" || TD.isExportName(n)) return;
  const k = withdrawnKey(n);
  const was = lsGet(k, "");
  const now = TD.noteKeepLines(was, lines);
  if (now !== was) setWithdrawn(k, now);
}
/**
 * The keeps of `list` on `values` recorded as withdrawn in the case kept under
 * `name` — every one but a local keep, which was never written anywhere.
 */
function noteKeepsWithdrawn(list, values, name) {
  const want = new Set((values || []).map((v) => TD.foldValue(v)).filter(Boolean));
  const lines = (list || []).filter((k) => k && k.state !== "local" && want.has(TD.foldValue(k.value)));
  if (lines.length) noteWithdrawn(lines, name);
}
/** …and `values` taken again: their lines are no longer withdrawn. */
function forgetWithdrawn(values, name) {
  const k = withdrawnKey(name);
  const was = lsGet(k, "");
  const now = TD.forgetKeepLines(was, values);
  if (now !== was) setWithdrawn(k, now);
}
/** The open case's record held to what its file, as just read or written (`text`, null for none), still carries. */
function trimWithdrawn(text) {
  const k = withdrawnKey();
  const was = lsGet(k, "");
  if (!was) return;
  const now = TD.keepLinesCarried(was, text);
  if (now !== was) setWithdrawn(k, now);
}
/** Whether the keep line `control: value` is one the operator withdrew in the open case. */
function keepWithdrawn(control, value) {
  return TD.carriesKeep(lsGet(withdrawnKey(), ""), value, control);
}
// ANOTHER READER TAB withdrew a keep this one still holds — its ×, or a Master
// Keep removal reaching every case's list: it goes here too, at once. Two tabs
// on one case write their lists over each other, and a tab holding the list as
// it was before the withdrawal stored the keep straight back, for the next save
// to hand to PDF-Linker and the next run to put back on the master. Only a
// withdrawal is followed — nothing is added to this tab's list from another's
// — and nothing is stored: the tab that withdrew it has stored the list.
function onWithdrawnElsewhere(e) {
  if (!e.key || e.key !== withdrawnKey() || flagsFor !== valuesStoreKey()) return;
  let rec = "";
  try { rec = e.newValue == null ? "" : JSON.parse(e.newValue); } catch { rec = ""; }
  const gone = keeps.filter((k) => k && TD.carriesKeep(rec, k.value, k.control));
  if (!gone.length) return;
  keeps = keeps.filter((k) => !gone.includes(k));
  compileKey();
  if (doc) { remarkKept(); paintHighlights(); }
  renderFlags();
}
window.addEventListener("storage", onWithdrawnElsewhere);
/**
 * Whether the flagged values and the keeps have been written out since they
 * last moved. The list is remembered here whatever happens — closing the tab
 * loses nothing — but remembered here is not handed over: PDF-Linker reads
 * New Real Values.txt in the case folder and nothing else, so a list that has
 * not been written is a run's worth of work the next run will not do. The
 * file's own text is the signature; nothing else can be out of step with it.
 */
function valuesDirty() {
  const now = TD.formatValuesFile(flagged, keeps, phrases, noOcr, ocrAgain, textFixed);
  const saved = lsGet(valuesSavedKey(), "");
  if (now === saved) return false;
  // A local keep is not in the file and never will be, so a list that holds
  // nothing else is a list the case folder is owed nothing from — unless what
  // was last written still holds lines: the last flag withdrawn is owed too,
  // or PDF-Linker goes on applying a flag nobody wants any more.
  return valuesOwed() || TD.readerFileHasLines(saved);
}
/** Whether the list holds anything New Real Values.txt carries. */
function valuesOwed() {
  return !!(flagged.length || TD.owedKeeps(keeps).length || noOcr.length || ocrAgain.length || textFixed.length);
}
/** …and the same list, as it stands, marked as written. */
function markValuesSaved(text) { lsSet(valuesSavedKey(), text); renderFlags(); }
/**
 * New Real Values.txt in the open case folder as it stands: its text, null
 * where there is none, undefined where it cannot be read (or no folder is open).
 */
async function valuesFileText() {
  if (!dirHandle) return undefined;
  try { return await (await (await dirHandle.getFileHandle(TD.VALUES_FILE)).getFile()).text(); }
  catch (e) { return e && e.name === "NotFoundError" ? null : undefined; }
}
/**
 * Where the record of what was written (valuesSavedKey) went: "here" — into
 * the open case folder itself; "elsewhere" — into another folder under the
 * same name; or "unknown" — nothing kept to say (an older build's write, no
 * IndexedDB), which is read as here, by the name, as it always was
 * (rememberWritten).
 */
async function writtenWhere() {
  const dir = dirHandle, name = folderName;
  if (!dir) return "unknown";
  const rec = await writtenRecord(name);
  if (!rec) return "unknown";
  try { return (await dir.isSameEntry(rec.written)) ? "here" : "elsewhere"; }
  catch { return "elsewhere"; }
}
/**
 * The case's lists read against the folder's file as it stands (`disk`: its
 * text, or null where there is none): what PDF-Linker has spent comes off them
 * (TD.spendLines), and the record of what was written keeps only what the file
 * still holds. → the keeps retired. `settle`: the key, the marks and the lists
 * follow at once — not during an adoption, which does all of that itself.
 *
 * ONLY WHAT WAS WRITTEN HERE IS SPENT HERE. A line missing from the file is
 * spent only where the record says it was written into this very folder
 * (writtenWhere). A record written into another folder — a copy of the case
 * under the same name — says nothing about this one: a keep line "missing"
 * from it was never in it, and retiring the keep threw the decision away
 * unsent. There the folder's own file becomes the record (TD.writtenBaseline),
 * so whatever the list holds that the file does not reads as owed to it, and
 * nothing is spent.
 */
async function spendFromDisk(disk, { settle = true } = {}) {
  const where = await writtenWhere();
  const was = lsGet(valuesSavedKey(), "");
  if (where === "elsewhere") {
    const base = TD.writtenBaseline(TD.formatValuesFile(flagged, keeps, phrases, noOcr, ocrAgain, textFixed), disk);
    if (base !== was) lsSet(valuesSavedKey(), base);
    // …and from now on the record is this folder's.
    await rememberWritten(folderName, dirHandle);
    if (settle && base !== was) renderFlags();
    return [];
  }
  const s = TD.spendLines({ keeps, textFixed }, was, disk);
  if (s.saved !== was) lsSet(valuesSavedKey(), s.saved);
  if (s.keeps === keeps && s.textFixed === textFixed) {
    // Only the record moved (a keep withdrawn whose line the run took out
    // anyway): the status bar reads it again all the same.
    if (settle && s.saved !== was) renderFlags();
    return [];
  }
  keeps = s.keeps;
  textFixed = s.textFixed;
  persistValues();
  if (settle) {
    // A keep retired that the master workbook does not hold is no longer a keep
    // at all: the key, and the marks it lays, read it again.
    if (s.spentKeeps.length) { compileKey(); if (doc) { remarkKept(); paintHighlights(); } }
    renderFlags();
  }
  return s.spentKeeps;
}
/**
 * The spent keeps the attached master workbook does not hold, said by name —
 * or "" where it holds every one of them, or no workbook is attached (then the
 * file was the only place the reader could look, and a line PDF-Linker took out
 * of it is spent with nothing to say). Asked of the workbook as it now stands:
 * the startup reading finished, and read again where a run changed it since.
 * Retired all the same: the keep was emptied or deleted on the master (or the
 * run that took its line could not record it there), and writing it into the
 * file again is what put it back there, run after run.
 */
async function keepsSpentNote(spent) {
  if (!spent || !spent.length) return "";
  await masterSettled();
  const said = (off) => {
    const one = off.length === 1;
    return { one, what: off.map((v) => `“${v}”`).join(", "), it: one ? "it" : "them" };
  };
  // REMEMBERED, BUT NOT READ: the browser wants its leave again (a restarted
  // browser takes the grant back unless "Allow on every visit" was chosen), or
  // the file could not be read. Nothing can be checked against it, and that is
  // said rather than taken for "no workbook attached" — the keeps are retired
  // all the same, and the operator looks.
  const unread = !masterInfo && (masterNeeds ? masterNeeds.name : masterLost);
  if (unread) {
    const { one, what, it } = said(spent.map((k) => k.value));
    return `${what} ${one ? "is" : "are"} off this case's keeps: PDF-Linker has taken ${one ? "its line" : "their lines"} out of ${TD.VALUES_FILE}, ` +
      `and whether ${unread} keeps ${it} could not be checked — ` +
      (masterNeeds ? "the browser wants its leave to read the workbook again (Allow, in the bar at the top or the Flagged panel)" : "the workbook could not be read") + ". " +
      `${one ? "It is" : "They are"} not sent again; if the Master Keep does not have ${it}, keep ${it} again here.`;
  }
  if (!masterHandle || !masterInfo || masterInfo.loose) return "";
  const off = spent.filter((k) => !TD.keptControl(masterKeeps, k.value)).map((k) => k.value);
  if (!off.length) return "";
  const { one, what, it } = said(off);
  return `${what} ${one ? "is" : "are"} off this case's keeps: PDF-Linker has taken ${one ? "its line" : "their lines"} out of ${TD.VALUES_FILE}, ` +
    `and ${masterInfo.name} does not keep ${it} — removed there, or never recorded. ` +
    `${one ? "It is" : "They are"} not sent again; keep ${it} again if ${one ? "it" : "they"} should stand.`;
}
/**
 * A keep taken AFRESH: the record of a keep on the value written before is let
 * go of, so that line — which PDF-Linker may have spent — is not taken for this
 * decision, and the decision retired unsent.
 */
function forgetWrittenKeep(value) {
  const was = lsGet(valuesSavedKey(), "");
  const now = TD.forgetKeepLines(was, [value]);
  if (now !== was) lsSet(valuesSavedKey(), now);
}
// Spot keeps belong to ONE document, not to the case: they name a place in it.
// Remembered per document, like its swapped pages.
function spotStoreKey() { return SPOTS_PREFIX + (folderName || "") + "/" + (fileName || ""); }
/** …the store of any document of the folder, by name. */
function spotKeyOf(name) { return SPOTS_PREFIX + (folderName || "") + "/" + name; }
// A spot names a page of its own DOCUMENT. The page numbers in hand are the
// reel's — one list holding several files — so they are written back rebased
// onto the member, which is what the file is opened with again whether it is
// opened on its own or hung anywhere on a reel.
function persistSpots() { persistMemberSpots(reelCurrent()); }
/** The spot list a page's keeps are in: the open document's (`spots`) for its pages, else the member's own. */
function spotsListOf(i) {
  const m = reelMemberOf(i);
  return !m || m === reelCurrent() ? spots : m.spots || [];
}
/** …and set: the open document's list is the global one and its member's alike. */
function setSpotsListOf(i, list) {
  const m = reelMemberOf(i);
  if (!m || m === reelCurrent()) { spots = list; if (m) m.spots = list; }
  else m.spots = list;
}
/** A member's spots written to its own store, as pages of its own document. */
function persistMemberSpots(m) {
  if (!m) return;
  const list = m === reelCurrent() ? spots : m.spots || [];
  lsSet(spotKeyOf(m.name), m.from ? list.map((x) => ({ ...x, page: x.page - m.from })) : list);
}
/** …and the same list read back, as pages of the reel a member starts at `from` of. */
function spotsFrom(list, from) { return from ? list.map((x) => ({ ...x, page: x.page + from })) : list; }
// Stored as { values, keeps, phrases }; an older build stored the values list
// bare, and one before phrases stored no `phrases`.
function readStoredValues(k) {
  const v = lsGet(k, null);
  if (Array.isArray(v)) return { values: v, keeps: [], phrases: [], noOcr: [], ocrAgain: [], textFixed: [] };
  return { values: (v && v.values) || [], keeps: (v && v.keeps) || [], phrases: (v && v.phrases) || [], noOcr: (v && v.noOcr) || [], ocrAgain: (v && v.ocrAgain) || [], textFixed: (v && v.textFixed) || [] };
}
function loadValuesFor() { const st = readStoredValues(valuesStoreKey()); flagged = st.values; flagsFor = valuesStoreKey(); keeps = st.keeps; phrases = st.phrases; noOcr = st.noOcr; ocrAgain = st.ocrAgain; textFixed = st.textFixed; compileKey(); renderFlags(); }
function persistValues() { lsSet(valuesStoreKey(), { values: flagged, keeps, phrases, noOcr, ocrAgain, textFixed }); }

/**
 * The pages marked ⊘ Did not OCR, as the list PDF-Linker is owed follows them.
 *
 * The list is read off the PAGES rather than kept beside them, so an undo, a
 * reload or a document saved in another session cannot leave it saying
 * something the text does not: a page that reads [DID NOT OCR] under a header
 * PDF-Linker did not write is owed (the export says so, the PDF does not yet);
 * a page whose header PDF-Linker wrote as DID NOT OCR is the run's now and
 * comes off. `drop` is for the pages whose text is the document's last word —
 * the page an undo just put back, the pages a save writes — where a page that
 * no longer reads [DID NOT OCR] takes its entry off too. Elsewhere an entry
 * stands whatever the page shows, since the line may already be in the case
 * folder waiting on a run.
 */
function syncNoOcr(indices, { drop = false } = {}) {
  if (!doc) return;
  if (flagsFor === valuesStoreKey()) {
    // The rules are textdoc.pageListsAfter's — the same ones a save applies to
    // the documents it writes off the screen.
    const sources = docPageSources();
    const items = [];
    for (const i of indices) {
      const entry = pageEntryAt(i, sources);
      if (entry) items.push({ entry, page: doc.pages[i] });
    }
    const next = TD.pageListsAfter({ noOcr, ocrAgain, textFixed }, items, { drop });
    if (next.noOcr !== noOcr || next.ocrAgain !== ocrAgain || next.textFixed !== textFixed) {
      noOcr = next.noOcr;
      ocrAgain = next.ocrAgain;
      textFixed = next.textFixed;
      persistValues();
      renderFlags();
    }
  }
  refreshNocrButtons(indices);
}

/** A page's entry on the lists PDF-Linker is owed ({ doc, pdf, page }), or null for a page with no PDF page. */
function pageEntryAt(i, sources = docPageSources()) {
  const p = doc && doc.pages[i];
  const page = p && PS.pdfPageOf(p);
  if (!p || p.header == null || !page) return null;
  const name = sources[i] || fileName;
  return { doc: name, pdf: pdfForName(name) || "", page };
}
/** The page lists, as a save's toast counts them. */
function pageListsNote() {
  const parts = [];
  if (noOcr.length) parts.push(`${noOcr.length} page${noOcr.length === 1 ? "" : "s"} not to OCR`);
  if (ocrAgain.length) parts.push(`${ocrAgain.length} to OCR again`);
  if (textFixed.length) parts.push(`${textFixed.length} transcribed by hand`);
  return parts.length ? ", " + parts.join(", ") : "";
}

function renderFlags() {
  updateDirty(); // a flag, a keep or one of them written is a save's business
  pagesTabSoon(); // …and the Pages tab's tags read the page lists
  flagsList.innerHTML = "";
  flagCount.textContent = String(flagged.length + keeps.length + spots.length + noOcr.length + ocrAgain.length + textFixed.length + settled.size);
  const nocrList = $("nocr-list");
  nocrList.innerHTML = "";
  $("nocr-block").hidden = !noOcr.length;
  for (const e of noOcr) {
    const li = document.createElement("li");
    li.textContent = `${TD.docLabel(e.pdf || e.doc)} — page ${e.page}`;
    li.title = TD.noOcrLine(e);
    nocrList.appendChild(li);
  }
  const againList = $("ocr-again-list");
  againList.innerHTML = "";
  $("ocr-again-block").hidden = !ocrAgain.length;
  for (const e of ocrAgain) {
    const li = document.createElement("li");
    li.textContent = `${TD.docLabel(e.pdf || e.doc)} — page ${e.page}`;
    li.title = TD.ocrAgainLine(e);
    againList.appendChild(li);
  }
  const fixedList = $("text-fixed-list");
  fixedList.innerHTML = "";
  $("text-fixed-block").hidden = !textFixed.length;
  for (const e of textFixed) {
    const li = document.createElement("li");
    li.textContent = `${TD.docLabel(e.pdf || e.doc)} — page ${e.page}`;
    li.title = TD.textFixedLine(e);
    fixedList.appendChild(li);
  }
  refreshNocrButtons();
  renderSpots();
  renderMaster();
  renderSettled();
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
    // Several words can be made one phrase here, after they were flagged, as
    // well as from the selection — and made an ordinary flag again.
    const on = TD.isPhrase(phrases, v);
    if (on || !TD.phraseProblem(v)) {
      const t = document.createElement("button");
      t.className = "tag phrase" + (on ? "" : " off");
      t.textContent = on ? "phrase" : "+ phrase";
      t.setAttribute("aria-pressed", String(on));
      t.title = on
        ? "Faked whole, as one name (phrase) — a word of it the key fakes or keeps on its own notwithstanding. Click to make it an ordinary flag again."
        : "Make it one phrase: PDF-Linker fakes the words whole, together, as one name";
      t.addEventListener("click", (e) => { e.stopPropagation(); if (on) unmarkPhrase(v); else markPhrase(v, phraseFakedInFile(v)); });
      li.appendChild(t);
    }
    li.title = "Click to find it in the document";
    li.addEventListener("click", () => findInPages(v));
    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "×";
    x.title = "Withdraw this value";
    x.addEventListener("click", (e) => { e.stopPropagation(); flagged = TD.removeValue(flagged, v); phrases = TD.removeValue(phrases, v); persistValues(); renderFlags(); paintHighlights(); });
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
    hint.textContent = "The master workbook is remembered but needs the browser's leave again — its standing keeps are not in force until it has it. Choose \u201cAllow on every visit\u201d and it will not ask again.";
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
    t.title = "Kept by the master workbook, in every case — × takes it off the Master Keep";
    li.appendChild(t);
    li.title = "Click to find it in the document";
    li.addEventListener("click", () => findInPages(k.value));
    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "×";
    x.title = `Remove it from the Master Keep — ${masterInfo.name} keeps it in every case; removed, it can be faked here, and PDF-Linker fakes it on its next run`;
    x.addEventListener("click", (e) => { e.stopPropagation(); withdrawMaster([k.value]); });
    li.appendChild(x);
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
  scrollRangeTo(r);
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
    scrollRangeTo(r);
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
  valuesSpentNote = "";
  // The folder's leave to write, asked before anything awaits, while the click
  // still counts as one (there is no prompt where it is granted already): the
  // file is read first now.
  let grant = null;
  if (dirHandle && dirHandle.requestPermission) {
    try { grant = dirHandle.requestPermission({ mode: "readwrite" }).catch(() => "denied"); }
    catch { grant = Promise.resolve("denied"); }
  }
  // WHAT PDF-LINKER HAS SPENT since the list was last written comes off it
  // before it is written again: a keep whose line PDF-Linker has taken out of
  // the file is on the master workbook now, or was taken off it there, and
  // written again it put the master's row back on the next run (spendFromDisk;
  // the same reading the folder gets when it is opened). A line still in the
  // file is still owed, and is written as it was.
  let disk;
  if (dirHandle && flagsFor === valuesStoreKey()) {
    const owedBefore = valuesDirty();
    disk = await valuesFileText();
    if (disk !== undefined) {
      const spent = await spendFromDisk(disk);
      if (spent.length) valuesSpentNote = await keepsSpentNote(spent);
      trimWithdrawn(disk);
      // …and where all the list owed the file was what PDF-Linker has spent —
      // a keep retired, or one withdrawn whose line the run took out anyway —
      // the file already reads as the list does, and nothing is written. The
      // Flagged panel's own Save says so — the keeps retired by name, in red
      // where the master does not hold them — and never "nothing flagged yet"
      // over a list it has just been through.
      if ((owedBefore || spent.length) && !valuesDirty()) {
        if (!quiet) {
          const one = spent.length === 1;
          toast(valuesSpentNote
            || (spent.length
              ? `${spent.map((k) => `“${k.value}”`).join(", ")} ${one ? "is" : "are"} off this case's keeps: PDF-Linker has applied ${one ? "it" : "them"} and taken ${one ? "its line" : "their lines"} out of ${TD.VALUES_FILE}. Nothing to write.`
              : `${TD.VALUES_FILE} already reads as the list does: PDF-Linker has taken out the lines that differed. Nothing to write.`),
          valuesSpentNote ? { error: true, ms: 12000 } : undefined);
        }
        return "spent";
      }
    }
  }
  const owed = valuesOwed();
  const savedLines = TD.readerFileHasLines(lsGet(valuesSavedKey(), ""));
  if (!owed && !keeps.length && !savedLines) {
    if (!quiet) toast("Nothing flagged yet — select an unfaked name and press Flag, or right-click a pseudonym to keep it.", { error: true });
    return false;
  }
  const text = TD.formatValuesFile(flagged, keeps, phrases, noOcr, ocrAgain, textFixed);
  // EVERYTHING WITHDRAWN. The file is written with nothing in it (the header
  // alone, which PDF-Linker reads as empty) where it still carries lines; where
  // it carries none, or is not there, there is nothing to tell it, and the list
  // is simply in step with it. A line left standing would be read back as the
  // list the next time the folder is opened, and handed over again.
  const emptied = !owed;
  if (emptied && dirHandle) {
    const onDisk = disk !== undefined ? disk : await valuesFileText();
    if (onDisk == null || !TD.readerFileHasLines(onDisk)) {
      markValuesSaved(text);
      // …in step with THIS folder's file (writtenWhere), which carries no
      // withdrawn line any more.
      await rememberWritten(folderName, dirHandle);
      if (onDisk !== undefined) trimWithdrawn(onDisk);
      return true;
    }
  }
  if (dirHandle) {
    try {
      if (grant) {
        const perm = await grant;
        if (perm !== "granted") throw new Error("write permission denied");
      }
      const h = await dirHandle.getFileHandle(TD.VALUES_FILE, { create: true });
      const w = await h.createWritable();
      await w.write(new Blob([text], { type: "text/plain" }));
      await w.close();
      markValuesSaved(text);
      // Written into THIS folder: the record is trusted for what PDF-Linker
      // spends here, and nowhere else (writtenWhere). A withdrawn keep's line is
      // out of the file now.
      await rememberWritten(folderName, dirHandle);
      trimWithdrawn(text);
      if (!quiet) {
        toast((emptied
          ? `Wrote ${TD.VALUES_FILE} with nothing in it — the flags and keeps withdrawn are no longer handed to PDF-Linker.`
          : `Wrote ${TD.VALUES_FILE} (${flagged.length} to fake, ${keeps.length} to keep${pageListsNote()}) into ${folderName} — re-run PDF-Linker to apply them to the files.`)
          + (valuesSpentNote ? " " + valuesSpentNote : ""), valuesSpentNote ? { error: true, ms: 12000 } : undefined);
      }
      return true;
    } catch (e) {
      if (quiet) return false;
      toast("Could not write into the folder (" + (e.message || e) + ") — choose where to save.", { error: true });
    }
  }
  if (folderOnly) return false;
  let pickedFile = null;
  if (await writeText(text, TD.VALUES_FILE, null, { picked: (h) => { pickedFile = h; } })) {
    // SAVED — BUT INTO THE CASE FOLDER? With no folder open there is no other
    // place, and the list is written. With one open, the folder refused the
    // write and the list went to the save picker or a download: the folder's
    // own file, the only one PDF-Linker reads, is still owed it, so the list is
    // not marked written — the status bar goes on saying so, and the closing
    // tab asks — and the record of what the folder was last given stays what
    // it was, so what a run spends of THAT is still read as spent, and a keep
    // that never reached the folder is never taken for one it took out. Unless
    // the picker was pointed at the folder's own New Real Values.txt, which is
    // the folder write after all.
    let here = !dirHandle;
    if (dirHandle && pickedFile) {
      try { here = await (await dirHandle.getFileHandle(TD.VALUES_FILE)).isSameEntry(pickedFile); } catch { here = false; }
    }
    if (!here) {
      toast(`Saved a copy of ${TD.VALUES_FILE} outside ${folderName} — PDF-Linker reads only the case folder's own, so the list is still owed there: put the copy in ${folderName}, or Save again once the folder can be written.`, { error: true, ms: 12000 });
      return true;
    }
    markValuesSaved(text);
    if (dirHandle) {
      await rememberWritten(folderName, dirHandle);
      trimWithdrawn(text);
    }
    return true;
  }
  return false;
}
$("flags-save").addEventListener("click", () => saveValuesFile());
$("flags-copy").addEventListener("click", async () => {
  const n = flagged.length + keeps.length + noOcr.length + ocrAgain.length + textFixed.length;
  try { await navigator.clipboard.writeText(flagged.map((v) => (TD.isPhrase(phrases, v) ? "phrase: " + v : v)).concat(keeps.map((k) => k.control + ": " + k.value), noOcr.map(TD.noOcrLine), ocrAgain.map(TD.ocrAgainLine), textFixed.map(TD.textFixedLine)).join("\n") + "\n"); toast("Copied " + n + " line" + (n === 1 ? "" : "s")); }
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
// thing they both say. A `yes` (or `phrase`) on one is the names walk's "fake
// it" too, for the same reason (sheetFakes): the save writes its pseudonym
// rather than leaving it and warning that nobody has decided it. It is never
// also flagged into New Real Values.txt, which would hand PDF-Linker the same
// value twice under two different rules.
const leaksBar = $("leaks-bar");
let leaks = null;          // { parsed, bytes, name, handle, folder, at, trail, mirrored: Set }
let leakRowValue = "";     // the current row's value, marked wherever it stands
let leakRowRanges = [];    // where it stands, from the last paint: [{ body, range }]
let leakHere = null;       // the occurrence the bar scrolled to
let leakHerePieces = null; // …and, where the names walk put it there, every piece of that name
let rowHere = null;        // …the worksheet row's own, which the names walk does not move

function leaksStoreKey() { return LK.decisionsKey(leaks.folder || folderName || fileName, leaks.name); }
function persistLeaks() { if (leaks) lsSet(leaksStoreKey(), LK.packDecisions(leaks.parsed.rows)); }
function leaksDirty() { return !!leaks && leaks.parsed.rows.some((r) => r.fix !== r.fix0); }
function leakRows() { return leaks ? leaks.parsed.rows : []; }
/** The worksheet as parsed, or null: its identity is what the marks were read against. */
function sheetParsed() { return leaks ? leaks.parsed : null; }

// The rows the walk has yet to reach. Only the row in front used to be marked,
// so a name the worksheet was already asking about stood unmarked on the page,
// was flagged as a find, and turned up as a row a few clicks later — a flag
// that handed PDF-Linker a value it had raised itself. Every value with a row
// is now read with the document-wide marks (scanPassNow, one matcher per
// worksheet), and the ones still to answer are painted orange beside the row
// in front; a decision repaints them without reading the page again.
let sheetRxMemo = { parsed: null, values: new Map(), rx: null };
function sheetMatcher() {
  const parsed = sheetParsed();
  if (sheetRxMemo.parsed !== parsed) {
    const values = new Map(); // folded → as written
    for (const r of parsed ? parsed.rows : []) {
      const v = TD.normalizeValue(r.value);
      if (/[\p{L}\p{N}]/u.test(v)) values.set(TD.foldValue(v), v);
    }
    sheetRxMemo = { parsed, values, rx: values.size ? PK.buildMatcher([...values.values()]) : null };
  }
  return sheetRxMemo.rx;
}
/** The worksheet value a match is, folded: a gap read as a space, a possessive let go. "" if none. */
function sheetFold(found) {
  const { values } = sheetRxMemo;
  const f = TD.foldValue(PK.foldGaps(found));
  if (values.has(f)) return f;
  const bare = f.replace(/['’]s$/, "");
  return values.has(bare) ? bare : "";
}
/**
 * Where the rows still to answer stand, less the row in front (it has its own
 * mark) and the values the key binds: standing unfaked, those are the key's
 * orange already, and inside a cited decision they are no leak at all.
 */
function pendingSheetRanges() {
  if (!leaks || !sheetHits.length) return [];
  const open = new Set();
  for (const r of leakRows()) if (LK.isPending(r)) open.add(TD.foldValue(r.value));
  open.delete(TD.foldValue(leakRowValue));
  const bound = new Map();
  const out = [];
  for (const h of sheetHits) {
    if (!open.has(h.fold)) continue;
    let b = bound.get(h.fold);
    if (b === undefined) bound.set(h.fold, (b = boundByKey(h.fold)));
    if (!b) out.push(h.range);
  }
  return out;
}
/** The row still to answer whose value the selection is, word for word: its index, or -1. */
function pendingRowIn(s) {
  if (!leaks || !s || s.pn || s.here) return -1;
  const want = wordsOf(s.text);
  if (!want) return -1;
  return leakRows().findIndex((r) => LK.isPending(r) && wordsOf(r.value) === want);
}

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
  leaks = { parsed, bytes, name, handle: handle || null, folder: folder || folderName || "", at: -1, trail: LK.newTrail(), mirrored: new Set() };
  const remembered = LK.unpackDecisions(parsed.rows, lsGet(leaksStoreKey(), null));
  const faked = refreshSheetFakes(); // its `yes` rows, the sheet's own and the ones remembered
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
  if (faked && doc) renderLeakStatus();
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
  if (refreshSheetFakes() && doc) renderLeakStatus(); // its `yes` rows are undecided again, and the count says so
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
  if (want) {
    if (TD.keptControl(keeps, row.value) !== kind) forgetWrittenKeep(row.value); // a decision taken afresh (setKeep)
    forgetWithdrawn([row.value]);
    keeps = TD.addKeep(keeps, kind, row.value);
    leaks.mirrored.add(f);
  }
  else if (leaks.mirrored.has(f)) {
    noteKeepsWithdrawn(keeps, [row.value]); // withdrawn, as a × withdraws it (setKeep)
    keeps = TD.removeKeep(keeps, row.value);
    leaks.mirrored.delete(f);
  }
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
  const e = keyBar.hidden ? 0 : keyBar.offsetHeight;
  const root = document.documentElement.style;
  root.setProperty("--bar-leaks", a + "px");          // where the second bar starts
  root.setProperty("--bar-names", a + b + "px");      // …and the third
  root.setProperty("--bar-redact", a + b + c + "px"); // …and the fourth
  root.setProperty("--bar-find", a + b + c + d + "px"); // …and the fifth
  root.setProperty("--bar-h", a + b + c + d + e + "px"); // …and what the five take together
}
if (typeof ResizeObserver !== "undefined") {
  const barSizes = new ResizeObserver(setBarHeight);
  barSizes.observe(leaksBar);
  barSizes.observe(namesBar);
  barSizes.observe(redactBar);
  barSizes.observe(findBar);
  barSizes.observe(keyBar);
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
  ans.title = ans.textContent; // the slot is one width, and a long answer is cut short in it
  // A pre-filled cell reads as answered and is not: it is marked like an empty
  // one until the operator has said so.
  ans.className = "lb-answer" + (c.kind && !sug ? "" : " undecided");
  // Not offered, it keeps its place (.off): the controls never move.
  const acc = $("lb-accept");
  acc.classList.toggle("off", !sug);
  acc.disabled = !sug;
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
  return during("listing the worksheet's rows", () => renderLeaksTabNow());
}
function renderLeaksTabNow() {
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

/**
 * Show row `i` in the bar and take the text to it. The row left is the way
 * back for ‹ (LK.trailMove), except where ‹ and › are the ones moving
 * (`trail: false`): they keep the trail themselves.
 */
async function goToLeak(i, { locate = true, trail = true } = {}) {
  const rows = leakRows();
  if (!rows.length) return;
  // Going to a row by any road is leaving the page it was being finished on.
  if (pageSweep) { pageSweep = null; renderNamesBar(); }
  const was = leaks.at;
  leaks.at = ((i % rows.length) + rows.length) % rows.length;
  if (trail) LK.trailMove(leaks.trail, was, leaks.at);
  const row = rows[leaks.at];
  leakRowValue = row.value;
  leakHere = null;
  rowHere = null;
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

/**
 * Every place the row's `value` stands in the open text: [{ body, range }].
 * Whole words first — "Tim" is the "Tim" on page 4, never the "time" on page 1.
 * Only a document with no whole-word occurrence on any of its pages (each
 * member of a combined file counted on its own) is searched inside words, for
 * the welded or reduced finding that has no other kind. The fallback used to
 * be asked page by page, so any page without the whole word answered with the
 * word it sits inside, and the walk stood on the first of those instead.
 */
function rowRanges(value) {
  if (!value) return [];
  const sources = docPageSources();
  const per = pageBodies().map((body) => ({ body, member: sources[pageIndexOf(body)] || "", whole: leakMatches(body, value) }));
  const found = new Set(per.filter((p) => p.whole.length).map((p) => p.member));
  const out = [];
  for (const p of per) for (const range of found.has(p.member) ? p.whole : leakMatches(p.body, value, { inside: true })) out.push({ body: p.body, range });
  return out;
}
/** Every place `value` stands on a page body as DOM ranges: as a whole word, or (`inside`) as a bare substring of one. */
function leakMatches(body, value, { inside = false } = {}) {
  const out = [];
  const v = TD.normalizeValue(value);
  if (!v || (inside && v.length < 3)) return out;
  // Pseudonym spans blanked: a span SHOWS the real name, and a worksheet
  // value standing inside one is the faked occurrence, not the leak.
  const { text, segs } = flatten(body, { blankPn: true });
  const push = (s, e) => { const r = rangeFor(segs, s, e); if (r) out.push(r); };
  if (inside) {
    // A welded or reduced finding has no bounded occurrence by construction.
    const low = text.toLowerCase(), needle = v.toLowerCase();
    let at = 0;
    while ((at = low.indexOf(needle, at)) >= 0) { push(at, at + needle.length); at += needle.length; }
    return out;
  }
  const rx = PK.buildMatcher([v]);
  if (rx) {
    let m;
    rx.lastIndex = 0;
    while ((m = rx.exec(text))) { push(m.index, m.index + m[0].length); if (m.index === rx.lastIndex) rx.lastIndex++; }
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
  leakHere = rowHere = best.range;
  markLeakHere();
  const sec = best.body.closest(".tpage");
  scrollRangeTo(best.range);
  if (bestScore < 2 && wheres.length) toast(`Found "${row.value}" on ${TD.pageLabel(doc.pages[Number(sec.dataset.index)]) || "the page"}, not at ${row.where}.`);
}
/**
 * A range brought onto the screen, a third of the way down the stage — and
 * KEPT there until it has landed.
 *
 * Where the range stands is not known when the scroll sets off. The pages it
 * passes and the pages it arrives at are fitted (shapePages), laid on the
 * PDF's grid (applyMatchedLayout) and built back from the reel only as the
 * reading comes near them, and each of those moves everything below it. A
 * scroll aimed once at where the range stood when it was asked for arrives
 * where the range USED to be: past it, as a rule, since a page fitted on the
 * way is a page shorter than the height it stood at. That was the leak walk
 * overshooting, and Find having to be pressed once or twice more to land.
 *
 * So the aim is taken again every frame: the scroll is re-aimed whenever the
 * range has moved, and it is over once the range has stood at the mark for a
 * while (the grid arrives from the PDF a beat after the scroll does), or when
 * the reader takes the scroll over themselves.
 */
let landing = null;
function scrollRangeTo(range, { margin = null } = {}) {
  if (landing) landing.stop();
  releaseReading(); // going somewhere: the place held is not the place wanted
  const node = range.startContainer;
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  const sec = el && el.closest(".tpage");
  /** Where the stage has to stand for the range to sit at the mark, clamped to what it can scroll to. */
  const dest = () => {
    let rect = range.getBoundingClientRect();
    // The page is swapped for its PDF page: the words are in the DOM and not
    // on the screen, so the sheet itself is what there is to scroll to.
    if (!rect.height && sec) rect = sec.getBoundingClientRect();
    const st = stageEl.getBoundingClientRect();
    // A third of the way down, where the eye is — or `margin` from the top,
    // for a page gone to whole (the Pages tab).
    const top = stageEl.scrollTop + rect.top - st.top - (margin != null ? margin : Math.max(40, stageEl.clientHeight / 3));
    return Math.round(Math.max(0, Math.min(top, stageEl.scrollHeight - stageEl.clientHeight)));
  };
  let aim = dest();
  stageEl.scrollTo({ top: aim, behavior: "smooth" });
  const started = performance.now();
  let steadySince = 0, frame = 0, lastTop = -1, still = 0;
  const me = {};
  const quit = (e) => {
    // A modifier on its own is the start of a shortcut, not a scroll.
    if (e.type === "keydown" && /^(Alt|Control|Shift|Meta)$/.test(e.key)) return;
    me.stop();
  };
  const USER = ["wheel", "touchstart", "pointerdown", "keydown"];
  me.stop = () => {
    cancelAnimationFrame(frame);
    for (const t of USER) window.removeEventListener(t, quit, true);
    if (landing === me) landing = null;
  };
  for (const t of USER) window.addEventListener(t, quit, { capture: true, passive: true });
  const tick = (now) => {
    if (!range.startContainer.isConnected || !doc) { me.stop(); return; }
    const want = dest();
    if (Math.abs(want - aim) > 2) {
      // The range moved under the scroll: aim again, from wherever it has got to.
      aim = want;
      stageEl.scrollTo({ top: aim, behavior: "smooth" });
      steadySince = 0;
    } else if (Math.abs(stageEl.scrollTop - aim) <= 2) {
      if (!steadySince) steadySince = now;
      else if (now - steadySince > 500) { me.stop(); return; }
    } else {
      steadySince = 0;
      // Short of the mark and not moving: the smooth scroll was cut off (a
      // document hung above puts the scroll back by hand). Set it off again.
      if (stageEl.scrollTop === lastTop && ++still > 6) { stageEl.scrollTo({ top: aim, behavior: "smooth" }); still = 0; }
      else if (stageEl.scrollTop !== lastTop) still = 0;
    }
    lastTop = stageEl.scrollTop;
    if (now - started > 5000) { me.stop(); return; }
    frame = requestAnimationFrame(tick);
  };
  landing = me;
  frame = requestAnimationFrame(tick);
}

// ── the reading holds its place ─────────────────────────────────────────────────
/**
 * THE PAGE BEING READ STAYS ON THE SCREEN. A zoom, Side by side, the font, the
 * leading, a panel or a bar opening, the window resized, a page fitted or laid
 * on the PDF's grid as the reading comes near it, a page swapped for its PDF
 * page: each of these lays pages out again, and every page laid out again
 * above the reading moves the reading. The stage keeps the browser's own
 * scroll anchoring off (the reel does its own arithmetic: #stage in the
 * stylesheet), so nothing put it back, and a zoom on page 12 left the reader
 * on page 11 or 14.
 *
 * So the reading's place is noted each time the stage scrolls — the line at
 * the top of the stage, and how far into it the edge falls — and a change that
 * lays pages out again HOLDS it: every frame the line has moved, the stage is
 * scrolled by what it moved, until the layout has stood still for a while. The
 * place is noted on the scroll, not when the change is asked for, because most
 * changes are already made by then (a class toggled, the window resized) and a
 * place read then would be read off the new layout.
 *
 * Anything else that moves the stage — the reader, a jump to a word
 * (scrollRangeTo), the reel putting the scroll back after hanging a document
 * above, auto-scroll — is going somewhere on purpose, and ends the hold.
 */
const PLACE_STILL_MS = 700;  // the layout still this long: settled
const PLACE_MAX_MS = 8000;   // …and never held longer than this
const PLACE_QUIT = ["wheel", "touchstart", "pointerdown", "keydown"];
/** The line at the top edge of the stage and how far into it the edge falls — the page, where no line is there. */
function readingPlace() {
  if (!doc) return null;
  // The pages and the reel's dividers between documents, in order: the
  // column's own children, not a search of it — this is asked on every frame
  // of a scroll, and a query walks every line of every page.
  const kids = pagesEl.children;
  if (!kids.length) return null;
  const y = stageEl.getBoundingClientRect().top;
  let lo = 0, hi = kids.length - 1; // the first one whose foot is below the edge
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (kids[mid].getBoundingClientRect().bottom > y) hi = mid; else lo = mid + 1;
  }
  let sec = kids[lo];
  while (sec && !sec.classList.contains("tpage")) sec = sec.nextElementSibling; // a divider: the page under it
  if (!sec) return null;
  const sr = sec.getBoundingClientRect();
  if (!sr.height) return null;
  const at = { el: sec, frac: (y - sr.top) / sr.height, sec, secFrac: (y - sr.top) / sr.height };
  if (sr.top >= y) return at; // the edge is in the gap above it: the page is the place
  for (const l of sec.querySelectorAll(".page-body > .line")) {
    const r = l.getBoundingClientRect();
    if (!r.height || r.bottom <= y) continue;
    // The edge in the line, or just above it (the label, a gap between rows).
    if (r.top - y <= r.height) { at.el = l; at.frac = (y - r.top) / r.height; }
    break;
  }
  return at;
}
/** How far the place has moved from the stage's top edge: down the screen is positive; null where it is gone. */
function placeDrift(p) {
  let r = p.el.isConnected ? p.el.getBoundingClientRect() : null;
  let frac = p.frac;
  // The line put away (a margin line beside the PDF) or rebuilt: its page.
  if (!r || !r.height) {
    r = p.sec.isConnected ? p.sec.getBoundingClientRect() : null;
    frac = p.secFrac;
    if (!r || !r.height) return null;
  }
  return r.top + frac * r.height - stageEl.getBoundingClientRect().top;
}
let placeFrame = 0;
/** The place noted once the frame's scrolling is done — never while a hold has it. */
function notePlaceSoon() {
  if (placeHold || placeFrame) return;
  placeFrame = requestAnimationFrame(() => { placeFrame = 0; if (!placeHold) place = readingPlace(); });
}
/** Keep the reading where it is through whatever is about to lay the pages out again. */
function holdReading() {
  if (!doc || landing || autoRunning()) return;
  const now = performance.now();
  if (placeHold) { placeHold.touched = now; return; }
  const p = place && place.sec.isConnected ? place : readingPlace();
  if (!p) return;
  const me = { p, top: stageEl.scrollTop, started: now, touched: now, frame: 0 };
  me.quit = (e) => {
    // Ctrl or Cmd with it is a zoom or a shortcut, not a scroll; a modifier
    // on its own is the start of one.
    if (e.ctrlKey || e.metaKey) return;
    if (e.type === "keydown" && /^(Alt|Control|Shift|Meta)$/.test(e.key)) return;
    releaseReading();
  };
  for (const t of PLACE_QUIT) window.addEventListener(t, me.quit, { capture: true, passive: true });
  const tick = (t) => {
    if (placeHold !== me) return;
    if (!doc || landing || autoRunning()) { releaseReading(); return; }
    // Moved by something else: going somewhere on purpose. Its place is
    // wherever it has gone.
    if (Math.abs(stageEl.scrollTop - me.top) > 1) { releaseReading({ renote: true }); return; }
    const d = placeDrift(p);
    if (d == null) { releaseReading({ renote: true }); return; }
    if (Math.abs(d) >= 1) {
      const max = stageEl.scrollHeight - stageEl.clientHeight;
      const want = Math.max(0, Math.min(max, stageEl.scrollTop + d));
      if (Math.abs(want - stageEl.scrollTop) >= 1) {
        stageEl.scrollTop = want;
        me.top = stageEl.scrollTop;
        me.touched = Math.max(me.touched, t);
      }
    }
    if (t - me.touched > PLACE_STILL_MS || t - me.started > PLACE_MAX_MS) { releaseReading(); return; }
    me.frame = requestAnimationFrame(tick);
  };
  placeHold = me;
  me.frame = requestAnimationFrame(tick);
}
/** The hold let go: the place is where it held it, or — `renote` — wherever the reading is now. */
function releaseReading({ renote = false } = {}) {
  const me = placeHold;
  if (!me) return;
  placeHold = null;
  cancelAnimationFrame(me.frame);
  for (const t of PLACE_QUIT) window.removeEventListener(t, me.quit, true);
  place = renote ? readingPlace() : me.p;
}
function markLeakHere() {
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
  // The names walk stands on every piece of a wrapped name; the worksheet's
  // walk sets leakHere alone, and stands on that.
  const all = leakHerePieces && leakHerePieces[0] === leakHere ? leakHerePieces : [leakHere];
  if (leakHere && leakHere.startContainer.isConnected) CSS.highlights.set("leakrow-here", highlightOf(all));
  else CSS.highlights.delete("leakrow-here");
}

/** Write a decision into the current row's Fix? cell (remembered until saved). */
function decideLeak(text, { advance = false } = {}) {
  if (!leaks || leaks.at < 0) return;
  const row = leakRows()[leaks.at];
  row.fix = String(text == null ? "" : text).trim();
  decidedHere++;
  persistLeaks();
  // A `yes` settles the name for the save; withdrawn, it is undecided again.
  // Nothing on the page moves, so no paint follows to recount: the count, the
  // walk and the Save button are told here, as "fake it" tells them.
  const faked = refreshSheetFakes();
  mirrorLeakKeep(row);
  renderLeaksBar();
  paintLeakRow(leaks.at);
  renderLeaksTabState();
  updateLeaksButton();
  paintHighlights();
  if (faked && doc) renderLeakStatus();
  warmForLeaks();
  if (!advance) return;
  const n = LK.nextUndecided(leakRows(), leaks.at);
  if (n < 0 || n !== leaks.at) advanceLeak(n);
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
  if (n < 0 || n !== leaks.at) advanceLeak(n);
}

// ── finishing the page before the review leaves it ──────────────────────────
//
// The worksheet is one row per VALUE; the orange on the page is every name the
// key binds that the run left in the clear, and most of those have no row. A
// review that answered a page's last row and moved on left them standing on a
// page just read, to be found again from the status bar later — or not at all.
// So a decision that takes the review OFF a page first stands on the names
// still in the clear there (and on any page it would pass over on its way to
// the next row, LK.sweepSpan), in the names bar, with its buttons. When the
// page has nothing left the review goes on to its next row.
//
// ONLY WHERE THE OPERATOR HAS THE NAMES BAR UP. The names are the reader's own
// finding, not the worksheet's, and a review that is working the worksheet is
// working the worksheet: a decision there goes straight on to the next row.
// The bar opened by hand (the status bar's count, Alt+L) is the operator
// asking for the names as well, and then the page is finished before the
// review leaves it. The review never opens the bar for this itself.
//
// Not stopped on: a name the worksheet has a row for — that row is where it
// is answered, before or after — and the red flagged values, which are
// decisions already taken. A name skipped (the bar's skip) is left for the
// status bar's walk; closing the names bar leaves the rest of the page, and
// the review stops on no more names until it is opened again.
// pageSweep (declared at the head of the file): { from, doc, seq, lo, hi, label, rowVals, cursor: [page, offset] | null }
/** A range's place in the document: its page's index and its offset in that page's text. */
function rangePos(range) {
  const node = range && range.startContainer;
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  const sec = el && el.closest && el.closest(".tpage");
  if (!sec) return null;
  const body = el.closest(".page-body");
  let off = 0;
  try {
    const r = document.createRange();
    r.setStart(body, 0);
    r.setEnd(range.startContainer, range.startOffset);
    off = r.toString().length;
  } catch { /* a range from a page since rebuilt: the head of its page */ }
  return [Number(sec.dataset.index), off];
}
/** The names the sweep has still to stand on, in the order they stand. */
function sweepStops() {
  const sw = pageSweep;
  if (!sw || !doc || sw.seq !== docSeq) return [];
  const out = [];
  for (const h of liveLeaks()) {
    if (h.doc !== sw.doc || sw.rowVals.has(LK.fold(h.real))) continue;
    const p = rangePos(h.range);
    if (!p || p[0] < sw.lo || p[0] >= sw.hi) continue;
    const c = sw.cursor;
    if (c && (p[0] < c[0] || (p[0] === c[0] && p[1] <= c[1]))) continue;
    out.push(h);
  }
  return out;
}
/** What the review leaves behind going from the row in front to row `n` (-1: none left): a sweep, or null. */
function pageSweepFor(n) {
  if (namesBar.hidden) return null; // the names walk is not up: the worksheet alone
  if (!doc || !marksCanRead() || !reals || !readHere()) return null;
  if (!rowHere || !rowHere.startContainer.isConnected) return null;
  const rows = leakRows();
  const cur = rows[leaks.at];
  const at = rangePos(rowHere);
  if (!cur || !at) return null;
  const sec = pagesEl.querySelector(`.tpage[data-index="${at[0]}"]`);
  if (!sec) return null;
  const dname = docNameOfBody(sec);
  const pages = [...pagesEl.querySelectorAll(".tpage")]
    .filter((t) => docNameOfBody(t) === dname)
    .map((t) => { const i = Number(t.dataset.index); return { index: i, number: doc.pages[i] ? doc.pages[i].number : null }; });
  const next = rows[n];
  const same = !!next && LK.fold(LK.rowFile(next)) === LK.fold(LK.rowFile(cur));
  const place = same ? LK.rowPlace(next) : null;
  const span = LK.sweepSpan(pages, at[0], { same, page: place ? place.page : null });
  if (!span) return null;
  const pageName = (i) => TD.pageLabel(doc.pages[i]) || `Page ${i + 1}`;
  const last = pages.filter((q) => q.index < span.hi).pop();
  pageSweep = {
    from: leaks.at, doc: dname, seq: docSeq, lo: span.lo, hi: span.hi, cursor: null,
    label: last && last.index > span.lo ? `${pageName(span.lo)} to ${pageName(last.index)}` : pageName(span.lo),
    rowVals: new Set(rows.map((r) => LK.fold(r.value)).filter(Boolean)),
  };
  if (sweepStops().length) return pageSweep;
  pageSweep = null;
  return null;
}
/** On from the row just answered to row `n` — by way of the names still standing on the page it leaves. */
function advanceLeak(n) {
  if (pageSweepFor(n)) {
    const k = sweepStops().length;
    toast(`${k} name${k === 1 ? "" : "s"} from the key still standing in the clear on ${pageSweep.label} \u2014 answering ${k === 1 ? "it" : "them"} before the next row.`);
    goSweepStop(sweepStops()[0]);
    return;
  }
  if (n >= 0) goToLeak(n);
  else toast("Every row is answered — save the worksheet, then Apply Fixes.");
}
function goSweepStop(h) {
  const hits = liveLeaks();
  pageSweep.cursor = rangePos(h.range);
  leakStep = hits.indexOf(h) - 1;
  stepLeak(1);
}
/** After a name on the page is answered or skipped: the next one, or on to the worksheet's next row. */
function continuePageSweep() {
  if (!pageSweep) return false;
  if (pageSweep.seq !== docSeq) { pageSweep = null; return false; }
  const stops = sweepStops();
  if (stops.length) goSweepStop(stops[0]);
  else finishPageSweep();
  return true;
}
function finishPageSweep() {
  const sw = pageSweep;
  pageSweep = null;
  if (!sw) return;
  renderNamesBar();
  const n = LK.nextUndecided(leakRows(), sw.from);
  if (n >= 0) goToLeak(n);
  else toast("Every row is answered — save the worksheet, then Apply Fixes.");
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
// ‹ goes back the way the review came: after a decision has moved it on, to
// the row just answered, not to whatever row stands before the new one on the
// walk (leaks.js trailBack). › retraces what ‹ went back over. With nothing
// to retrace they walk the review, not the worksheet: the next row is the
// next one DOWN THE DOCUMENT (leaks.js walkOrder), so stepping through a
// page's rows reads the page instead of hopping about it.
function leakBack() {
  if (!leaks) return;
  // Finishing the page's names, the bar still shows the row just answered,
  // and the text has gone off it: back is back to that row.
  if (pageSweep) { goToLeak(leaks.at, { trail: false }); return; }
  goToLeak(LK.trailBack(leaks.trail, leakRows(), leaks.at), { trail: false });
}
function leakForward() {
  if (!leaks) return;
  goToLeak(LK.trailForward(leaks.trail, leakRows(), leaks.at), { trail: false });
}
$("lb-prev").addEventListener("click", leakBack);
$("lb-next").addEventListener("click", leakForward);
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
  if (e.key === "ArrowDown") { e.preventDefault(); leakForward(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); leakBack(); }
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
// THE PACE IS PAGES PER MINUTE, not a pixel speed. What a reader sets is how
// many pages go by in a minute, and the pixels follow from the page: each
// page's own rendered HEIGHT is measured, and the speed under the reading line
// is height * ppm / 60, so every page crosses it in the same 60 / ppm seconds.
// It falls out of that arithmetic that the zoom, the leading, the page width
// and the PDF grid all take care of themselves: they change the pixels a page
// takes, the height is measured in those pixels, and the pace stays what was
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

const AUTO_PPM_KEY = "textReader.autoPpm";
const AUTO_OLD_WPM_KEY = "textReader.autoWpm"; // the words-per-minute pace this replaced
const AUTO_ON_KEY = "textReader.autoOn";
const MIN_PPM = 0.2, MAX_PPM = 5, PPM_STEP = 0.1, DEFAULT_PPM = 1;
// What an old words-per-minute setting is carried over as: a page of a filing
// holds about this many words, so 300 wpm opens as 1 page a minute.
const WORDS_PER_PAGE = 300;
// The slowest it will go. A slow pace on a short page is read a little faster
// than asked rather than appearing frozen — and ] is there for a reader who
// meant it.
const MIN_PX_PER_SEC = 4;
// …and the fastest, which is not a pixel figure but a SCREEN figure: however
// tall a page is, it may not go by faster than a reader can see it go by, and
// what "a screenful" is depends on the window.
const MAX_SCREEN_SECONDS = 1.5;
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
let autoPpm = DEFAULT_PPM;
let autoRaf = 0, autoLast = 0;
let autoPos = 0;           // the fractional position the engine drives
let autoWritten = null;    // …and the whole one it last wrote, for the backstop
let autoResume = 0;
let autoPxPerSec = 0;      // eased toward the target, so a page change is not a gear change
let autoFrac = 0;          // the sub-pixel remainder the transform is carrying
let autoMetrics = null;    // [{ top, bottom, height }] down the document

// Remembered, and the mode with it: turning it on is arming a reading
// session, not a document, so the next export opens already moving.
const clampPpm = (v) => Math.max(MIN_PPM, Math.min(MAX_PPM, Math.round(Number(v) * 10) / 10));
const ppmLabel = () => autoPpm.toFixed(1) + " ppm";
{
  const p = lsGet(AUTO_PPM_KEY, 0);
  const w = lsGet(AUTO_OLD_WPM_KEY, 0);
  if (typeof p === "number" && p >= MIN_PPM && p <= MAX_PPM) autoPpm = clampPpm(p);
  else if (typeof w === "number" && w > 0) autoPpm = clampPpm(w / WORDS_PER_PAGE);
  autoOn = lsGet(AUTO_ON_KEY, false) === true;
}

const autoMax = () => Math.max(stageEl.scrollHeight - stageEl.clientHeight, 0);

/**
 * The document as the engine reads it: where each page stands in the scroll
 * box and how tall it renders. Measured from the DOM, so it is the pace of the
 * layout actually on screen — the zoom, the leading, the page width and the PDF
 * grid are all already in these numbers.
 */
function refreshAutoMetrics() {
  autoMetrics = null;
  const secs = pagesEl.querySelectorAll(".tpage");
  if (!secs.length) return;
  const pages = [];
  for (const sec of secs) {
    const height = sec.offsetHeight || 1;
    pages.push({ top: sec.offsetTop, bottom: sec.offsetTop + height, height });
  }
  autoMetrics = pages;
}

function autoPageHeightAt(y) {
  if (!autoMetrics || !autoMetrics.length) return null;
  let lo = 0, hi = autoMetrics.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (autoMetrics[mid].bottom < y) lo = mid + 1; else hi = mid;
  }
  return autoMetrics[lo].height || null;
}

function autoTarget() {
  const h = autoPageHeightAt(autoPos + stageEl.clientHeight * READING_LINE);
  if (!h) return null;
  const ceiling = Math.max(MIN_PX_PER_SEC * 4, stageEl.clientHeight / MAX_SCREEN_SECONDS);
  return Math.max(MIN_PX_PER_SEC, Math.min(ceiling, (h * autoPpm) / 60));
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
  // Eased over about half a second, so crossing into a shorter page slows the
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
  if (!autoOn) { setAutoScroll(true); toast(`Auto-scroll on · ${ppmLabel()}`); return; }
  autoPaused = !autoPaused;
  autoSuspended = false;
  clearTimeout(autoResume);
  autoResume = 0;
  if (autoPaused) autoStop();
  else { autoPxPerSec = 0; autoStart(); }
  updateAutoUi();
}

function setAutoPpm(next) {
  const p = clampPpm(Number(next) || DEFAULT_PPM);
  if (p === autoPpm) return;
  autoPpm = p;
  lsSet(AUTO_PPM_KEY, autoPpm);
  updateAutoUi();
}

// No toast for a change of pace: the pill's readout shows it while the creep
// is on (and the button's tooltip while it is off), and a toast for every step
// of [ / ] was a pop-up per keypress.
function nudgeAutoSpeed(delta) {
  setAutoPpm(autoPpm + delta);
}

// ── the pill ──
//
// A reading pace is not a thing you can see: 1 and 1.5 look the same until
// the page moves, so a ppm engine with no readout is a setting you cannot aim.
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
  $("asp-slower").addEventListener("click", () => { nudgeAutoSpeed(-PPM_STEP); pillAwake(); });
  $("asp-faster").addEventListener("click", () => { nudgeAutoSpeed(PPM_STEP); pillAwake(); });
  $("asp-close").addEventListener("click", () => { setAutoScroll(false); toast("Auto-scroll off"); });
  $("asp-speed").addEventListener("input", (e) => { setAutoPpm(e.target.value); pillAwake(); });
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
    if (Number(sl.value) !== autoPpm) sl.value = String(autoPpm);
    $("asp-ppm").textContent = ppmLabel();
    asPill.classList.toggle("paused", autoPaused);
  }
  autoBtn.setAttribute("aria-pressed", String(autoOn));
  const state = !autoOn ? `Auto-scroll while reading (A) — ${ppmLabel()}`
    : !doc ? `Auto-scroll is on at ${ppmLabel()} — it starts with the next document`
    : autoPaused ? `Auto-scroll paused at ${ppmLabel()} — Space reads on`
    : `Auto-scrolling at ${ppmLabel()}`;
  autoBtn.title = state +
    "; [ slower, ] faster, Space pauses. The pace is pages per minute: each page takes the same time to cross the screen.";
}

// ── what the reader does ──
autoBtn.addEventListener("click", () => {
  setAutoScroll(!autoOn);
  toast(autoOn ? `Auto-scroll on · ${ppmLabel()}` : "Auto-scroll off");
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
    toast(autoOn ? `Auto-scroll on · ${ppmLabel()}` : "Auto-scroll off");
  } else if (e.key === "[") { e.preventDefault(); nudgeAutoSpeed(-PPM_STEP); }
  else if (e.key === "]") { e.preventDefault(); nudgeAutoSpeed(PPM_STEP); }
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
  if (newDoc) { autoPaused = false; autoSuspended = false; }
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

// …each member also carrying `d` (its entry in the folder's list, null for a
// file that is not one of the folder's), `base` (the file it was read from:
// { text, stamp, opened } — what Save checks the disk against), `editSeq`
// (bumped by every edit, so a save that ran while typing went on does not
// clear the newer edit), `built` (its pages' typing baselines, where it came
// from the store) and `conflict` (its file written since the edits began).
let reel = [];          // [{ name, handle, newline, trailingNewline, from, count, dirty, spots, d, base, editSeq, built, conflict }]
let reelAt = 0;         // the member being read: an index into `reel`
let reelBusy = false;   // one append at a time — the scroll asks many times
let reelDone = false;   // the folder is read out downward
let reelDoneUp = false; // …and back up: nothing before the head of the reel
let reelJustOpened = false; // a document went up: the first reach happens without a scroll
let reelLastTop = 0;    // the scroll the last event saw, for which way the reading is going

/** The reel as one member: a document opened on its own, or the head of a folder read. */
function reelReset(parsed, name, handle, theirSpots, { d = null, base = null } = {}) {
  reel = [{
    name, handle,
    newline: parsed.newline, trailingNewline: parsed.trailingNewline,
    from: 0, count: parsed.pages.length,
    dirty: false, spots: theirSpots || [],
    d, base, editSeq: 0, built: null, conflict: false,
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
  // Not while a folder-wide pass holds the reel's members still.
  if (saving || folderPass) return false;
  if (!reelRoom()) return false;
  const next = reelNextDoc();
  if (!next) { reelDone = true; return false; }
  reelBusy = true;
  const was = doc; // a document opened while the file was being read is another reel
  try {
    const got = await readReelDoc(next);
    if (doc !== was || !got) return false;
    const { parsed, base, entry } = got;
    const from = doc.pages.length;
    const theirSpots = spotsFrom(entry ? TD.normalizeSpots(entry.spots) : TD.normalizeSpots(lsGet(SPOTS_PREFIX + (folderName || "") + "/" + next.name, [])), from);
    const m = {
      name: next.name, handle: next.handle,
      newline: parsed.newline, trailingNewline: parsed.trailingNewline,
      from, count: parsed.pages.length, dirty: false, spots: theirSpots,
      d: next, base, editSeq: 0, built: null, conflict: false,
    };
    doc.pages = doc.pages.concat(parsed.pages);
    reel.push(m);
    const frag = document.createDocumentFragment();
    m.divider = reelDivider(m);
    frag.appendChild(m.divider);
    during("hanging the next document on the reel", () =>
      buildPages(frag, doc.pages, { from, to: from + m.count, spots: theirSpots, editable: editing }));
    pagesEl.appendChild(frag);
    hungFromStore(m, entry);
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

/**
 * A document the reel is about to hang, read: out of the store where it has
 * unsaved edits (it is hung with them), else from its file — through the
 * parse built ahead of time only where that was built from the file as it now
 * is, since a stale one hung and saved would write the old text back over
 * whatever wrote the file since. → { parsed, base, entry }
 */
async function readReelDoc(d) {
  const r = await readDoc(d);
  if (r.entry) return { parsed: TD.cloneDoc(r.entry.doc), base: r.entry.base, entry: r.entry };
  const built = ready.get(d.name);
  // A copy: the parse held ready is the one a later open would use.
  const parsed = built && built.doc && built.epoch === readyEpoch && built.fileKey === r.stamp ? TD.cloneDoc(built.doc) : readExport(r.text);
  return { parsed, base: { text: r.text, stamp: r.stamp, opened: TD.serializeExport(parsed) }, entry: null };
}
/** A member just hung: seen, and — where it came out of the store — unsaved, as it was left. */
function hungFromStore(m, entry) {
  seenDocs.add(m.name);
  if (!entry) return;
  entry.built.forEach((t, k) => { const b = bodyForPage(m.from + k); if (b && t != null) b.__built = t; });
  m.built = entry.built.slice();
  m.dirty = true;
  m.conflict = !!entry.conflict;
  dirty = true;
  unsavedDocs.delete(m.name);
  unsavedSeq++;
  markDocList();
  updateDirty();
  // …checked against its file, as a document opened from the store is: one
  // written since its edits began is tagged, and Save will not write over it.
  const base = m.base;
  if (base && m.d && !m.conflict) {
    diskStill(m.d, base).then((c) => { if (c !== "ok" && m.base === base && m.dirty) { m.conflict = true; markDocList(); updateDirty(); } });
  }
}

/** The reel grew: everything measured off the document is measured again. */
function reelChanged() {
  refreshNocrButtons(); // a member hung is built with no list in hand
  textAnchors = null; textLineTops = null;
  applyMatchedLayout();
  applyPageWidth();
  placeCitationsSoon();
  textEpoch++;
  paintHighlights();
  refindSoon(); // the pages hung on the end are pages the find has not read
  rekeySoon(); // …nor the key walk
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
  // A folder replace's marker names no page (revertFolderReplace finds its documents by name).
  for (const sn of undoStack) { if (sn.page != null) sn.page += n; bump(sn.spots); }
  for (const sn of redoStack) { if (sn.page != null) sn.page += n; bump(sn.spots); }
  if (lastSnapPage >= 0) lastSnapPage += n;
  textAnchors = null; textLineTops = null;
}

/**
 * Whether a document may be hung ABOVE the reading at this moment.
 *
 * A pass that is holding page numbers of its own — the leak review, the names
 * walk, the redaction's misses, a print being prepared — would be holding the
 * numbers of OTHER pages a moment later, so nothing goes in above one while it
 * is open. Nor while a screenshot is being taken: the pages it has faked would
 * be pushed out of the picture by pages it has not. Reading down is never held
 * up this way: nothing moves under it.
 */
function reelCanRenumber() {
  return leaksBar.hidden && namesBar.hidden && !redactOn && !missWalk.length && !printPut && !shotPut;
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
  if (saving || folderPass) return false;
  if (!reelCanRenumber()) return false;
  const prev = reelPrevDoc();
  if (!prev) { reelDoneUp = true; renderReelState(); return false; }
  if (!reelRoom()) return false;
  reelBusy = true;
  const was = doc, head = reel[0]; // …and the reel may not be this reel by then
  try {
    const got = await readReelDoc(prev);
    if (!got || doc !== was || reel[0] !== head || !reelCanRenumber() || saving || folderPass) return false;
    const { parsed, base, entry } = got;
    const n = parsed.pages.length;
    // Where the reading stands, before anything goes in above it.
    const anchor = pagesEl.querySelector(".tpage");
    const wasTop = stageEl.scrollTop;
    const wasAt = anchor ? anchor.offsetTop : 0;
    reelShift(n);
    doc.pages = parsed.pages.concat(doc.pages);
    // Its own spots are already the reel's numbering: it starts the reel.
    const theirSpots = entry ? TD.normalizeSpots(entry.spots) : TD.normalizeSpots(lsGet(SPOTS_PREFIX + (folderName || "") + "/" + prev.name, []));
    const m = {
      name: prev.name, handle: prev.handle,
      newline: parsed.newline, trailingNewline: parsed.trailingNewline,
      from: 0, count: n, dirty: false, spots: theirSpots,
      d: prev, base, editSeq: 0, built: null, conflict: false,
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
    hungFromStore(m, entry);
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
  if (!m) return;
  const was = m.dirty;
  m.dirty = true;
  // Counted, so a save that was running meanwhile leaves this edit unsaved.
  m.editSeq = (m.editSeq || 0) + 1;
  if (!was && m.d) markDocList();
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
// scroll position does not move by a pixel, auto-scroll's pace is still
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
  // The height each page is pinned at is the height it STANDS at, read before
  // the grid comes off it. Side by side that is its PDF page's height, the
  // same as the slot beside it; read after, it was whatever its text came to
  // flowing off the grid, with nothing yet giving it its paper's shape — a
  // legal-size exhibit page pinned at 2,475 px beside a 906 px slot, a
  // landscape one at three times its slot — and every shed page put the two
  // columns that much further out of step. To the fraction of a pixel: a pixel
  // rounded away on every shed page is the columns sliding apart too. Read for
  // every page before any is touched, which is one layout rather than one a
  // page.
  const heights = secs.map((sec) => sec.getBoundingClientRect().height);
  secs.forEach((sec, k) => {
    const inner = sec.querySelector(".page-inner");
    const body = inner && inner.querySelector(".page-body");
    if (!inner || !body) return;
    const i = Number(sec.dataset.index);
    // Off the PDF's grid first, while the lines it laid out are still there.
    clearMatched(sec);
    // Everything the page knows, taken off it before it goes: the text as the
    // FILE carries it (serializeNodes writes the fakes, never the real names),
    // and the places this document keeps in the clear.
    m.spots = m.spots.filter((x) => x.page !== i).concat(spotsFromBody(body, i));
    doc.pages[i].lines = TD.serializeNodes(body).split("\n");
    sec.style.height = (Math.round(heights[k] * 100) / 100) + "px"; // measured before it is emptied
    inner.innerHTML = "";
    sec.classList.remove("raw"); // the file's text went with the rest; it comes back as text
    rawPages.delete(sec);
    sec.classList.add("shed");
  });
  m.shed = true;
  // Its undo steps stay. They used to go — the page had no body to put them
  // back into — which made a Replace all across several members, saved and
  // then read away from, come back only in part on Ctrl+Z, and say nothing.
  // A shed page is put back in `doc.pages` instead (restoreSnapshot), and
  // built from there when it comes near again.
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
  return during('letting go of the pages the reading has left', () => reelTrimNow());
}
function reelTrimNow() {
  // Two documents are worth shedding between where the documents are long:
  // two exhibit sets of two hundred pages is four hundred sections held for
  // the sake of the one being read.
  if (!doc || reel.length < 2) return;
  // A review is a walk over the whole document: nothing is let go of under it.
  // The redaction tool is one too — its check reads every pseudonym the export
  // carries, and a shed page carries none. So is a find: its count of the
  // reel's documents is read off their pages (the folder's rows leave them
  // out, onReel), and a member shed under it was counted nowhere — "none here
  // · nowhere else", Replace all off, and Replace walking on past it.
  if (!leaksBar.hidden || !namesBar.hidden || !findBar.hidden || redactOn) return;
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
 * nothing is shed at all (`reelTrim`), so this is asked once, as it opens —
 * and the find bar is the same, whose count of the reel reads its pages.
 */
function reelAllLive() {
  return during("building the reel's pages back for the review", () => reelAllLiveNow());
}
function reelAllLiveNow() {
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
  forgetPageThumbs(); // …and the Pages tab's pictures of them
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
  // …and the one the Pages tab is drawing a picture from, for as long as it is.
  if (pagesThumbBusy) must.add(pagesThumbBusy);
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
//
// …AND WHAT CAN WAIT FOR THE SCREEN, DOES. Opening a PDF queues two more jobs
// behind it: measuring every page and reading the grid of the pages the
// reading is at. Both were run the moment the open was, which is the moment
// the page on screen had just started to draw — so the sizes landed first,
// the whole document was laid out again for them (four hundred milliseconds
// on a three-hundred-page export, in one task), and the page the reader was
// waiting to see was drawn after that. Those jobs are marked `later`, and
// while a page on screen is still being drawn (drawingSeen) the queue runs
// only what is not: another PDF's OPEN goes ahead of them, since a page on
// screen may be waiting on it, and the rest wait for the drawing to finish
// (seenEnd pumps the queue again) — or for DRAW_WAIT_MAX, so reading down a
// document without stopping still gets its grid.
const pdfJobs = [];        // queued work, each tagged with the PDF it is for
let pdfJobBusy = false;
const DRAW_WAIT_MAX = 1500; // ms the `later` work waits on the screen at most
let pdfJobWake = 0;
function pumpPdfJobs() {
  if (pdfJobBusy) return;
  pdfJobBusy = true;
  (async () => {
    try {
      for (;;) {
        const k = nextPdfJob();
        if (k < 0) break;
        const job = pdfJobs.splice(k, 1)[0];
        try { await job.run(); } catch { /* whoever asked for it reports it */ }
      }
    } finally { pdfJobBusy = false; }
  })();
}
/** Which queued job runs next: the first, unless it can wait for the screen (-1: nothing now). */
function nextPdfJob() {
  if (!pdfJobs.length) return -1;
  if (!drawingSeen || performance.now() - drawingSeenSince > DRAW_WAIT_MAX) return 0;
  const k = pdfJobs.findIndex((j) => !j.later);
  if (k < 0) {
    // Everything left can wait: the drawing's end pumps again, and this is
    // the backstop in case it never says so.
    clearTimeout(pdfJobWake);
    pdfJobWake = setTimeout(pumpPdfJobs, Math.max(0, DRAW_WAIT_MAX - (performance.now() - drawingSeenSince)) + 20);
  }
  return k;
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
// ONE pdf.js WORKER FOR EVERY PDF. Left to itself, `getDocument` starts a
// worker of its own for each document — a thread, and two megabytes of
// script loaded and compiled into it — and `destroy` ends it. That is a
// tenth of a second on every open before a byte of the PDF is read, and the
// reader opens a lot of them: a combined file names a PDF per member, and
// trimPdfs closes what the reading has left, so reading back up the folder
// opens them again. Handed a worker, pdf.js leaves it running when the
// document is destroyed, and the next open talks to a worker that is
// already there: 95 ms an open → 4, measured in Chromium. The documents
// already went through one queue (pdfJobs) a document at a time; what one
// thread does cost is two documents DRAWN at once taking turns rather than
// running side by side, which is the seam between two members of a combined
// file, and there the page on screen is drawn first either way (drawTurn).
let pdfWorker = null;
function sharedPdfWorker() {
  if (!pdfWorker || pdfWorker.destroyed) pdfWorker = new pdfjsLib.PDFWorker();
  return pdfWorker;
}
/**
 * The PDF, HANDED BACK THE MOMENT IT IS OPEN.
 *
 * It used to measure every page before it answered — the pane needs a page's
 * size to lay its slot out, so the size of all of them was got first. Each
 * one is a round trip to the worker, and after every round trip the idle
 * deadline the loop was holding had expired, so it waited for another: one
 * idle callback per page, up to a quarter-second each. A pleading of a dozen
 * pages never showed it. A two-hundred-page exhibit set spends a MINUTE that
 * way, and the whole of it is a slot on screen saying "Loading…", because
 * nothing can be drawn until the document is handed back — and every other
 * PDF the pane asked for is behind it in the same queue.
 *
 * Nothing about drawing a page needs those sizes: the render asks the
 * document for the page itself. So the document is handed back as soon as
 * pdf.js has it, and the measuring goes on afterwards, in batches, in the
 * queue with everything else. Until a page has been measured its slot stands
 * at the folder's paper (pageRatioGuess), which is what it stood at anyway.
 */
async function openPdfNow(src) {
  const file = src.file || await src.handle.getFile();
  // The fonts go into a document of their own (pdf-fonts.js): loaded into this
  // one, every font a PDF brought in or took away laid the whole text column
  // out again — 620 ms → 60 ms a jump across a combined file of forty.
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer(), worker: sharedPdfWorker(), ownerDocument: fontDocument() }).promise;
  const n = pdf.numPages;
  const hole = () => new Array(n).fill(null);
  const info = { pdf, count: n, sizes: hole(), name: src.name, lines: hole(), geoms: hole(), rows: hole(), gridRead: new Set(), gridQueued: true };
  // The same array the measuring fills, so a slot sized from it later gets
  // the pages as they land — and keeps them after the PDF itself is closed.
  pdfSizes.set(src.name, info.sizes);
  pdfBytes.set(src.name, file.size || 0);
  pdfJobs.push({ name: src.name, later: true, run: () => measurePdf(info) });
  // The line grid comes after — for the pages the reading is at, and no
  // others (gridNear): a page is worth seeing before it is worth aligning,
  // and the pane re-aligns as it lands.
  pdfJobs.push({ name: src.name, later: true, run: () => readPdfGrid(info) });
  pumpPdfJobs();
  return info;
}

/** Whether this reading of a PDF is still the one the reader holds. */
function stillOpen(info) {
  const held = pdfCache.get(info.name);
  return !!held && (!held.__info || held.__info === info);
}

// Pages measured per task. The asks are the worker's work rather than this
// thread's, so they go together and the thread is given back between batches
// — measured off the clock, not off an idle deadline that every await spends.
const SIZE_BATCH = 32;
/** Every page's size at scale 1, filled in behind the open. */
async function measurePdf(info) {
  return duringAsync("measuring the PDF's pages", () => measurePdfNow(info));
}
// A BATCH IS A JOB. The measuring used to be one job for the whole document,
// every batch of it, with the idle waits between them — and the queue is one
// job at a time, so a page coming onto the screen from ANOTHER PDF waited for
// every page of this one to be measured before its PDF could even be opened:
// seconds, on an exhibit set of a thousand pages. Each batch is its own job
// now, and the next is queued (at the back, and `later`) once the thread has
// had its idle moment — outside the queue, which is free in the meantime.
async function measurePdfNow(info) {
  const { pdf, sizes } = info;
  if (!stillOpen(info)) return;
  const at = info.measured || 0;
  if (at >= info.count) return;
  const upto = Math.min(at + SIZE_BATCH, info.count);
  const want = [];
  for (let i = at; i < upto; i++) if (!sizes[i]) want.push(i);
  const got = await Promise.all(want.map((i) => pdf.getPage(i + 1).catch(() => null)));
  got.forEach((page, k) => {
    if (!page) return;
    const v = page.getViewport({ scale: 1 });
    sizes[want[k]] = { w: v.width, h: v.height };
  });
  info.measured = upto;
  if (at === 0) noteRatio(sizes); // the folder's paper, from the first page read
  sizeSlotsFor(info.name);
  if (upto < info.count) {
    idleClock().then(() => {
      if (!stillOpen(info)) return;
      pdfJobs.push({ name: info.name, later: true, run: () => measurePdf(info) });
      pumpPdfJobs();
    });
  }
}
/**
 * A page's text, WITH A CEILING ON HOW MUCH OF IT IS TAKEN.
 *
 * A page's text layer is usually a few hundred items — a line or a word each.
 * A page set character by character is a different animal: a caption page
 * positioned glyph by glyph, or a scan whose OCR wrote one item per letter,
 * carries hundreds of thousands. Nothing downstream is bounded against that.
 * `getTextContent` accumulates every one of them; the line grid then sorts
 * and groups them; the selectable layer builds a DOM node for each. Measured
 * on a page of 120,000 items, the drawing alone holds the thread for two and
 * a half seconds on a fast machine — and a page can carry several times that,
 * which is a tab the browser kills for not answering.
 *
 * So the text is read as the STREAM pdf.js already has, and the reading stops
 * at `cap`. A page over the cap is a page whose text is not usable as text
 * anyway: the grid leaves it off the grid and the pane draws it without a
 * selection layer, both of which are what the page already looks like where
 * there is no text layer at all.
 */
const PAGE_ITEMS_MAX = 20000;
// …and what the REDACTION sweep will take, which is a different question:
// there, text not read is a value not blacked out, so the ceiling is high and
// reaching it is reported.
const REDACT_ITEMS_MAX = 200000;
const hugePagesSaid = new Set();
async function textItemsOf(page, cap = PAGE_ITEMS_MAX) {
  const out = { items: [], styles: Object.create(null), truncated: false };
  let reader = null;
  try { reader = page.streamTextContent().getReader(); }
  catch { /* an older build with no stream: fall back below */ }
  if (!reader) {
    const tc = await page.getTextContent();
    return { items: tc.items || [], styles: tc.styles || Object.create(null), truncated: false };
  }
  for (;;) {
    let step;
    try { step = await reader.read(); } catch { break; }
    if (step.done) break;
    const v = step.value;
    if (v) {
      if (v.styles) Object.assign(out.styles, v.styles);
      for (const it of v.items || []) {
        if (out.items.length >= cap) { out.truncated = true; break; }
        out.items.push(it);
      }
    }
    if (out.truncated) { try { await reader.cancel(); } catch { /* it is done with */ } break; }
  }
  return out;
}
/** Said once per page: a page whose text the reader would not read to the end. */
function sayHugePage(name, pageNo) {
  const k = name + "|" + pageNo;
  if (hugePagesSaid.has(k)) return;
  hugePagesSaid.add(k);
  console.warn(`[Text Reader] ${name} page ${pageNo} carries more than ${PAGE_ITEMS_MAX} pieces of text — ` +
    "set character by character, most likely. It is drawn as a page, without the grid and without selectable text.");
}
/**
 * Where each page's FIRST printed line sits (the side-by-side anchor) and its
 * LINE GRID (pdfsync.pleadingGeometry, from the numbers down its margin).
 */
async function readPdfGrid(info) {
  return duringAsync("reading the PDF's line grid", (e) => readPdfGridNow(info, e));
}
// THE GRID IS READ WHERE THE READING IS, AND NOWHERE ELSE: the page the
// reading line sits on and the page either side of it (GRID_REACH).
//
// It used to be read for every page of every PDF, in reading order, behind the
// open. That is every page's text pulled through the worker, grouped into rows
// and kept — on a two-hundred-page exhibit set, or a combined file naming a
// case folder's worth of PDFs, work and memory the tab went down under. And
// the crash fixes that followed (trimPdfs closing what the reading has left)
// took each closed PDF's grid with it, so a page the reader came back to stood
// off its PDF's grid for good. Three pages is all the eye is on: those are
// read, laid on their grid and kept laid (applyMatchedLayout keeps a page's
// placement once worked out); the reading moving on asks for the next ones
// (gridNear, on the scroll).
const GRID_REACH = 1;
/** The text pages the grid is worth having for: the reading page and its neighbours. */
function nearPages() {
  if (!doc) return [];
  const r = readingPage(), out = [];
  for (let i = r - GRID_REACH; i <= r + GRID_REACH; i++) if (i >= 0 && i < doc.pages.length) out.push(i);
  return out;
}
/** The pages of this PDF the reading is at whose grid has not been read yet. */
function gridPagesFor(info) {
  const out = [];
  for (const i of nearPages()) {
    const t = pdfTarget(i);
    if (t && t.src.name === info.name && t.page <= info.count && !info.gridRead.has(t.page) && !out.includes(t.page)) out.push(t.page);
  }
  return out;
}
/**
 * Ask for the grid of the pages the reading is at: queued at the head of the
 * PDF queue for a PDF that is open, the PDF opened (which queues its grid)
 * for one that is not.
 */
function gridNear() {
  if (!doc || !gridOn()) return;
  const seen = new Set();
  for (const i of nearPages()) {
    const t = pdfTarget(i);
    if (!t || seen.has(t.src.name)) continue;
    seen.add(t.src.name);
    const info = infoFor(t.src);
    if (!info) { loadPdf(t.src, { now: true }).catch(() => {}); continue; }
    if (info.gridQueued || !gridPagesFor(info).length) continue;
    info.gridQueued = true;
    pdfJobs.unshift({ name: info.name, later: true, run: () => readPdfGrid(info) });
    pumpPdfJobs();
  }
}
const GRID_SLICE = 10; // ms of this thread's own work before it gives it back
async function readPdfGridNow(info, pass) {
  const { pdf, sizes } = info;
  const gridFrom = performance.now();
  // Paced off the CLOCK, not off an idle deadline: every await here is a
  // round trip to the worker, and a deadline taken before one has expired by
  // the time it comes back — which turned a page's worth of work into a wait
  // for the next idle callback, a page at a time, for as long as the PDF is.
  let since = performance.now();
  info.gridQueued = false; // a reading that moves on from here asks again
  for (const i of gridPagesFor(info)) {
    // Closed behind the review (trimPdfs): there is nothing left to align to.
    if (!stillOpen(info)) return;
    info.gridRead.add(i);
    if (performance.now() - since > GRID_SLICE) {
      // The pages read so far are laid on their grid now rather than when
      // the rest are. It is debounced, so asking often costs one pass.
      if (sbsOn && !pdfPane.hidden) applyMatchedLayoutSoon();
      await idleClock();
      since = performance.now();
    }
    try {
      // Which page of which PDF, for the breadcrumb: a reader that goes down
      // here should say what it was reading, not just that it was reading.
      noteDoing(pass, `reading the PDF's line grid (page ${i} of ${info.count}, ${info.name})`);
      const page = await pdf.getPage(i);
      const tc = await textItemsOf(page);
      // Read and handed straight back: reading a page leaves the worker
      // holding what it parsed to answer, and the reading moving on reads
      // the next ones. A page being DRAWN is left alone: it is holding a
      // bitmap somebody is looking at.
      if (!pageIsDrawn(page)) { try { page.cleanup(); } catch { /* it is drawing */ } }
      // …and the page's own size, where the measuring has not reached it yet:
      // the page is in hand here, so asking it costs nothing.
      let sz = sizes[i - 1];
      if (!sz) {
        const v = page.getViewport({ scale: 1 });
        sz = sizes[i - 1] = { w: v.width, h: v.height };
      }
      // Past the ceiling the text is not a page's text in any useful sense,
      // and grouping a few hundred thousand pieces into rows is the hold.
      if (tc.truncated) { info.lines[i - 1] = null; sayHugePage(info.name, i); continue; }
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
  pageThumbsMoved(); // the Pages tab pictures each page from its PDF, where it now has one
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
//
// The walk through the names standing in the clear (the names bar, the key's
// own detection of real values) is the same walk by another list: its stops
// are known the moment the paint has found them, so the page of the name in
// front and of the ones the walk reaches next are held the same way.
//
// And held whether or not the PDF is showing. The operator turns side by side
// on, or swaps the text page for its PDF page, AT the stop they have reached —
// that is the moment the page is wanted, and a page drawn only once the PDF
// side is already open was a "Loading…" box at exactly that moment. With the
// PDF side put away the window is the stop in front and the next (WARM_AWAY)
// for each walk that is running, rather than a dozen pages nobody may ask for.
const WARM_PAGES = 12;   // pages held ready at once
const WARM_AWAY = 2;     // …per walk, while neither side by side nor a swap is showing
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
  // The box the page drawn over it will have (sizeCanvas): the page's own
  // size where it is known, the held bitmap's shape where it is not.
  const at = el.dataset.warm ? el.dataset.warm.lastIndexOf("|") : -1;
  const sizes = at > 0 ? pdfSizes.get(el.dataset.warm.slice(0, at)) : null;
  const sz = sizes && sizes[Number(el.dataset.warm.slice(at + 1)) - 1];
  sizeCanvas(sheet, canvas, cssWidth, sz ? (cssWidth * sz.h) / sz.w : (cssWidth * bmp.height) / bmp.width);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
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
// A folder is big by its COUNT of exports or by the LENGTH of what is open —
// the same mistake as counting PDFs would be, made about documents. Six
// two-hundred-page exhibit sets is four exports short of "big" and carries six
// times the pages of the two dozen pleadings this number was drawn for, so
// every gate hanging off this question — the leak walk fetching one document
// at a time, the reel's lower ceiling, the folder sweep waiting for a gap —
// stayed off for exactly the folder that needed them.
const BIG_FOLDER = 24;  // exports past which the review goes one document at a time
const BIG_PAGES = 120;  // …or pages on screen, however few documents they are
function oneDocAtATime() {
  return folderDocs.length > BIG_FOLDER || !!(doc && doc.pages.length > BIG_PAGES);
}
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

/**
 * The PDF pages of the names walk's stops, in the order it will reach them:
 * the name in front, then the next ones in the direction it is going — round
 * again where the document is the whole walk, and only to its end where the
 * walk goes on into another document (whose names are not found until it is
 * opened and painted).
 */
function namesWarmTargets(limit) {
  const hits = liveLeaks();
  const n = hits.length;
  if (!n || !doc) return [];
  const wrap = !restOfFolder().length;
  const start = leakStep >= 0 ? Math.min(leakStep, n - 1) : leakDir < 0 ? n - 1 : 0;
  const out = [], seen = new Set();
  for (let k = 0; k < n && out.length < limit; k++) {
    const at = start + k * leakDir;
    if (!wrap && (at < 0 || at >= n)) break;
    const node = hits[((at % n) + n) % n].range.startContainer;
    const el = node.nodeType === 1 ? node : node.parentElement;
    const sec = el && el.closest(".tpage");
    const t = sec ? pdfTarget(Number(sec.dataset.index)) : null;
    if (!t || seen.has(t.key)) continue;
    seen.add(t.key);
    out.push({ src: t.src, page: t.page });
  }
  return out;
}

/** Hold the walks' next pages ready — and close the ones the review has left behind. */
function planWarmPages() {
  // Nothing to hold where no walk is running: with neither bar up there is no
  // next stop, and a page nobody is walking towards is a bitmap for nothing —
  // and the PDF it would be drawn from is a file to read and a grid to measure.
  const rowsOn = !!leaks && !leaksBar.hidden;
  const namesOn = !namesBar.hidden;
  if (!doc || (!rowsOn && !namesOn)) { dropWarmPages(); return; }
  const shown = (sbsOn && !pdfPane.hidden) || swaps.size > 0;
  const limit = shown ? WARM_PAGES : WARM_AWAY * (rowsOn + namesOn);
  // The two walks take turns, so the stop in front of each is drawn first
  // where both bars are up.
  const lists = [rowsOn ? leakWarmTargets(limit) : [], namesOn ? namesWarmTargets(limit) : []];
  const targets = [], seen = new Set();
  for (let k = 0; targets.length < limit && (k < lists[0].length || k < lists[1].length); k++) {
    for (const list of lists) {
      const t = list[k];
      if (!t || targets.length >= limit) continue;
      const key = warmKey(t.src.name, t.page);
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(t);
    }
  }
  const cssWidth = warmWidth();
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
    pdfJobs.push({ name: t.src.name, later: true, run: () => warmPage(opened, key, t.page, cssWidth) });
  }
  pumpPdfJobs();
}
async function warmPage(opened, key, pageNo, cssWidth) {
  return duringAsync(`drawing page ${pageNo} ahead for the worksheet`, () => warmPageNow(opened, key, pageNo, cssWidth));
}
async function warmPageNow(opened, key, pageNo, cssWidth) {
  try {
    if (!warmWanted.has(key) || warmPages.has(key)) return;
    let info;
    try { info = await opened; } catch { return; } // whoever shows the page reports it
    if (!warmWanted.has(key) || pageNo > info.count) return;
    const page = await info.pdf.getPage(pageNo);
    if (!warmWanted.has(key)) return;
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: cssWidth / base.width });
    const canvas = fontCanvas(Math.round(vp.width), Math.round(vp.height)); // where the PDF's fonts are (pdf-fonts.js)
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
  if (!leaks || leaksBar.hidden || !folderDocs.length) { dropReady(); return; }
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
  // A document with unsaved edits is opened from the store, never from a page
  // built off its file.
  if (unsavedDocs.has(d.name)) { ready.set(d.name, { name: d.name, skipped: "unsaved edits" }); return; }
  const file = await d.handle.getFile();
  const text = await file.text();
  if (epoch !== readyEpoch || !readyWanted.includes(d.name)) return;
  const parsed = during("reading the next document ahead", () => readExport(text));
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
    text, // the file it was built from: what a save checks the disk against once it is opened
    // What its spans were built under: a keep decided since, or the fake/real
    // toggle flipped since, is put right as the document goes up.
    fakes: settings.showFakes, keeps: keepsSignature(),
  });
}
/** The document built for this file, or null — the same file, under the same key. */
function readyFor(file) {
  const e = file ? ready.get(file.name) : null;
  if (!e || !e.nodes) return null;
  // Edits waiting in the store are the document now, not the file it was built from.
  if (unsavedDocs.has(e.name)) { ready.delete(e.name); return null; }
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
  const base = folderDocs.length ? folderName + " · " + folderDocs.length + " document" + (folderDocs.length === 1 ? "" : "s")
    : dirHandle && folderLight
      ? `${folderName}: the key${leaks ? ", its LEAKS worksheet" : ""} and the flagged values are attached. The rest of the folder is left alone — this file is read on its own.`
      : "Open a case folder to list its exports here.";
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
//
// THE BITMAP IS SHOWN AT ITS OWN SIZE, in the screen's own pixels — the fix the
// PDF viewer had first (pdf-fonts.js, pageOutputScale). The pane drew at the
// ratio already, but showed the bitmap at the page's CSS size: wherever that
// size times the ratio is not a whole number of the screen's pixels (most
// sizes, at any ratio but a whole one), the browser fitted the page to the
// pixels it landed on, a pixel more or fewer than the bitmap, and a page
// fitted by a pixel is every pixel on it resampled. Which pages that hit
// depended on where each fell on the screen's grid: measured in Chromium, two
// pages in ten at 110%, five in ten at 150%, every page at 175%. The ratio was
// also held to 3, so a Retina screen zoomed past 150% had its pages stretched
// outright; and a page drawn before the ratio changed (the window moved to a
// screen of another scaling, the zoom changed) stayed drawn at the old one,
// stretched to twice its bitmap going from 1× to 2×, until it happened to be
// drawn again.
//
// The BOX is the page's height rounded — the same arithmetic the text page
// beside it is given (applyMatchedLayout) and a slot not yet drawn stands at
// (sizeFromKnown) — and the canvas never runs past it: a sheet a fraction of a
// pixel taller than its text page is one column sliding under the other by
// the fortieth page.
/** Size a slot's canvas to show `width` × `height` css px in the screen's own pixels. Answers the scale. */
function sizeCanvas(sheet, canvas, width, height) {
  const s = pageOutputScale({ width, height });
  const boxH = Math.round(height);
  canvas.width = Math.max(1, Math.floor(width * s + 1e-6));
  canvas.height = Math.max(1, Math.floor(Math.min(height, boxH) * s + 1e-6));
  canvas.style.width = (canvas.width / s) + "px";
  canvas.style.height = (canvas.height / s) + "px";
  sheet.style.height = boxH + "px";
  return s;
}
/**
 * The screen's ratio changed — the window moved to a screen of another
 * scaling, or the browser's zoom changed — and every page drawn or being drawn
 * at the old one is drawn again at the new: the one on screen at once, the
 * rest in their turn (renderInto; the mark a drawing is made for carries the
 * ratio, so a page already drawn at the new one is left alone).
 */
watchPixelRatio(() => {
  for (const el of document.querySelectorAll(".pdf-slot[data-want], .pdf-inline[data-want]")) {
    const slot = el.classList.contains("pdf-slot");
    const sec = slot ? null : el.closest(".tpage");
    const src = pdfSources[Number(slot ? el.dataset.index : sec && sec.dataset.index)];
    if (!src) continue; // a slot the PDFs have moved out from under: its pane is being built again
    renderInto(el, src, Number(el.dataset.page), slot ? parseFloat(el.style.width) || paneWidth() : inlineWidth(sec));
  }
});
async function renderInto(el, src, pageNo, cssWidth) {
  // Named for the breadcrumb: a tab killed while a page was being drawn says
  // WHICH page of which PDF, which is the difference between "a scan did it"
  // and a guess.
  return duringAsync(`drawing page ${pageNo} of ${src && src.name}`, () => renderIntoNow(el, src, pageNo, cssWidth));
}
async function renderIntoNow(el, src, pageNo, cssWidth) {
  const want = src.name + "|" + pageNo + "|" + cssWidth + "|" + (window.devicePixelRatio || 1);
  if (el.dataset.rendered === want) return;
  // A page ON SCREEN counts as being drawn from the moment it is asked for,
  // not from the moment its bitmap starts: until then it is waiting for its
  // PDF to open, and the work queued behind that open (the measuring, the
  // grid) is exactly what must not go ahead of it (nextPdfJob).
  const seen = onScreen.has(el);
  if (seen) seenBegin();
  try { await drawSlot(el, src, pageNo, cssWidth, want, seen); }
  finally { if (seen) seenEnd(); }
}
async function drawSlot(el, src, pageNo, cssWidth, want, seen) {
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
  // A page only NEAR the screen waits here for the pages on it (drawTurn) —
  // before its canvas is touched, so whatever it is showing meanwhile (the
  // worksheet's held bitmap, the last drawing at another width) stays up.
  const done = seen ? null : await drawTurn(el);
  if (!seen && !done) return; // let go of while it waited
  try { await drawPage(el, src, pageNo, cssWidth, want, page); }
  finally { if (done) done(); }
}
async function drawPage(el, src, pageNo, cssWidth, want, page) {
  if (el.dataset.want !== want) return;
  const base = page.getViewport({ scale: 1 });
  const cssScale = cssWidth / base.width;
  // What a redaction box is drawn through, and the page's own box it is held
  // inside: kept on the slot because the boxes are in the PDF's points and
  // the pane re-renders at a new width whenever the panes are resized.
  el.__view = page.view;
  const vp = page.getViewport({ scale: cssScale });
  const sheet = sheetOf(el);
  const canvas = sheet.querySelector("canvas");
  if (el.__task) { try { el.__task.cancel(); } catch { /* done */ } }
  const s = sizeCanvas(sheet, canvas, vp.width, vp.height);
  // By way of the fonts' document (pdf-fonts.js), at the bitmap's own scale.
  const task = renderPageOnto(page, canvas, { viewport: vp, transform: s === 1 ? null : [s, 0, 0, s, 0, 0] });
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
  el.__vp = vp;
  paintRedactions(el);
  // The page's text, selectable over the bitmap (pdf.js's own text layer).
  const layer = sheet.querySelector(".textLayer");
  if (layer) {
    if (el.__text) { try { el.__text.cancel(); } catch { /* done */ } el.__text = null; }
    layer.innerHTML = "";
    layer.style.setProperty("--scale-factor", String(cssScale));
    layer.style.setProperty("--total-scale-factor", String(cssScale));
    try {
      const tc = await textItemsOf(page);
      if (tc.truncated) { sayHugePage(src.name, pageNo); return; } // drawn, but not laid out as text
      const tl = new pdfjsLib.TextLayer({ textContentSource: { items: tc.items, styles: tc.styles }, container: layer, viewport: vp });
      if (el.dataset.want !== want) return;
      el.__text = tl;
      await tl.render();
      repairTextLayer(tl, tc.items);
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
// A press on the PDF pane's grey, around and between the pages, begins no
// selection: the browser anchored it at some page's first word, or in the line
// numbers written first, and a drag from there onto a line took everything
// above it. The page's label over each sheet ("Page 3"), half the band between
// two pages, is the same. It drops the selection there was, as a click there
// did (Shift keeps it). A press on the pane's own scrollbar, whose target is
// the pane too, is left alone.
pdfPane.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target !== pdfPane && !(e.target.classList?.contains("pdf-label") && pdfPane.contains(e.target))) return;
  const r = pdfPane.getBoundingClientRect();
  const x = e.clientX - r.left - pdfPane.clientLeft, y = e.clientY - r.top - pdfPane.clientTop;
  if (x < 0 || y < 0 || x >= pdfPane.clientWidth || y >= pdfPane.clientHeight) return;
  e.preventDefault();
  if (document.activeElement && document.activeElement !== document.body && !pdfPane.contains(document.activeElement)) document.activeElement.blur();
  if (!e.shiftKey) document.getSelection()?.removeAllRanges();
});
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
// ── the page on screen is drawn first ──
//
// A slot is drawn when the pane's observer says it is NEAR the screen —
// within PDF_MARGIN of it, so the next page is ready before it is scrolled
// to. Every slot in that band asked at once, in the order they stand, and
// pdf.js serves the asks in the order they come: jump to page fifty of a
// scanned exhibit and pages 48 and 49, above the screen, were decoded first —
// a third of a second each at 300 dpi — and the page the reader jumped TO
// appeared a second after the jump, behind both of them.
//
// So a slot actually ON SCREEN is drawn at once, and one only near it waits
// its turn: while a page on screen is still being drawn none of the pages
// around it start, and then they go one at a time (DRAW_AHEAD), nearest the
// screen first and below it before above — so a page that scrolls on while it
// waits is never more than one page's drawing behind. What is on screen is
// the observers' answer, so knowing it costs no layout: the pane's and the
// inline pages' own say so as they ask for a page (entryOnScreen — the order
// the browser runs two observers' reports in is not promised), and
// screenObserver (no margin, the viewport as its root, which clips to the
// pane and to the stage) follows a page from near the screen onto it.
const onScreen = new Set();   // slots the screen shows some part of
let drawingSeen = 0;          // pages on screen being drawn (renderIntoNow)
let drawingSeenSince = 0;     // …since when: the backstop is DRAW_WAIT_MAX
let drawingAhead = 0;         // pages near the screen being drawn
const DRAW_AHEAD = 1;         // …and how many of those at once
const drawWaiting = [];       // [{ el, go }] near the screen, waiting their turn
let drawWake = 0;
const screenObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (en.isIntersecting) onScreen.add(en.target); else onScreen.delete(en.target);
  }
  if (drawWaiting.length) nextDraw();
});
/** Whether a report from an observer with PDF_MARGIN of margin shows its page on screen, margin aside. */
function entryOnScreen(en) {
  const r = en.boundingClientRect, rb = en.rootBounds;
  return !!rb && en.isIntersecting && r.height > 0 && r.bottom > rb.top + PDF_MARGIN && r.top < rb.bottom - PDF_MARGIN;
}
function seenBegin() { if (!drawingSeen++) drawingSeenSince = performance.now(); }
function seenEnd() {
  if (--drawingSeen > 0) return;
  drawingSeen = 0;
  nextDraw();
  if (pdfJobs.length) pumpPdfJobs(); // what waited for the screen goes now
}
/**
 * A page near the screen asks for its turn to draw. Answers the function
 * that hands the turn back — or null, where the slot was let go of while it
 * waited (dropDrawTurn).
 */
function drawTurn(el) {
  return new Promise((go) => { drawWaiting.push({ el, go }); nextDraw(); });
}
function dropDrawTurn(el) {
  for (let k = drawWaiting.length - 1; k >= 0; k--) {
    if (drawWaiting[k].el === el) drawWaiting.splice(k, 1)[0].go(null);
  }
}
/** The waiting page the reading is likeliest to want next: nearest the screen, below it before above. */
function nearestWaiting() {
  let lo = Infinity, hi = -Infinity;
  for (const el of onScreen) { const i = slotIndex(el); if (i < lo) lo = i; if (i > hi) hi = i; }
  let best = 0, bestD = Infinity;
  drawWaiting.forEach((w, k) => {
    const i = slotIndex(w.el);
    const d = !isFinite(lo) ? k : i > hi ? i - hi : i < lo ? lo - i + 0.5 : 0;
    if (d < bestD) { bestD = d; best = k; }
  });
  return best;
}
function nextDraw() {
  clearTimeout(drawWake);
  // A page that has come onto the screen while it waited goes now, as one on
  // screen — and one thrown away with its pane goes nowhere.
  for (let k = drawWaiting.length - 1; k >= 0; k--) {
    const w = drawWaiting[k];
    if (!w.el.isConnected) { drawWaiting.splice(k, 1); w.go(null); continue; }
    if (onScreen.has(w.el)) { drawWaiting.splice(k, 1); seenBegin(); w.go(seenEnd); }
  }
  const blocked = () => drawingSeen > 0 && performance.now() - drawingSeenSince <= DRAW_WAIT_MAX;
  while (drawWaiting.length && drawingAhead < DRAW_AHEAD && !blocked()) {
    const w = drawWaiting.splice(nearestWaiting(), 1)[0];
    drawingAhead++;
    let given = false;
    w.go(() => { if (given) return; given = true; drawingAhead--; nextDraw(); });
  }
  // Held back by a page on screen that is taking its time: the backstop.
  if (drawWaiting.length && drawingAhead < DRAW_AHEAD && blocked()) {
    drawWake = setTimeout(nextDraw, DRAW_WAIT_MAX - (performance.now() - drawingSeenSince) + 20);
  }
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
  for (const el of box.querySelectorAll(".pdf-slot, .pdf-inline")) {
    releasePage(el);
    dropDrawTurn(el);
    paneObserver.unobserve(el);
    screenObserver.unobserve(el);
    onScreen.delete(el);
  }
}
function releaseCanvas(el) {
  // No longer WANTED either. The mark used to outlive the release, and a
  // change of width redraws every slot carrying it (fitSlot) — every page
  // the reading had ever passed, on a long read, drawn again at once and far
  // off the screen. A drawing still on its way sees the mark gone and stops.
  delete el.dataset.want;
  dropDrawTurn(el);
  if (!el.dataset.rendered && !el.dataset.preview) { releasePage(el); return; }
  const sheet = sheetOf(el);
  const canvas = sheet.querySelector("canvas");
  // Keep the box its size (sizeCanvas gave the sheet it), drop the bitmap and the text.
  if (!sheet.style.height) sheet.style.height = canvas.style.height;
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
/**
 * The numbered margin for a WHOLE PDF, kept against how many of its pages have
 * been read, the way the body type is. One margin for the document means the
 * numbers stand in one column down the whole of it, which is the thing a
 * reader checks a pleading against without thinking about it.
 */
function docBodyLeft(info) {
  if (!info || !info.geoms) return null;
  let filled = 0;
  for (const g of info.geoms) if (g) filled++;
  if (info.__marginAt !== filled) {
    info.__marginAt = filled;
    info.__margin = PS.docBodyLeft(info.geoms, info.rows);
  }
  return info.__margin;
}
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
  const want = Math.round((cssWidth * sz.h) / sz.w) + "px";
  const sheet = sheetOf(el);
  if (sheet.style.height !== want) { sheet.style.height = want; slotMoved = true; }
  return true;
}
let slotMoved = false; // a slot's height was changed by sizeFromKnown
/**
 * Every slot in the pane drawn from this PDF, at the height its page really
 * has. Asked once, as the PDF's sizes land: the pane no longer asks slot by
 * slot, so the slots that were standing at the letter default when it opened
 * are given their heights here.
 *
 * …and the columns matched again ONLY WHERE A SLOT MOVED. The sizes land a
 * batch at a time, and a batch of pages the size the slots were already
 * standing at (the folder's paper, which is nearly every page of a filing)
 * changes nothing on the screen — but asking for the pass anyway laid the
 * whole document out again for every batch: ten passes on a three-hundred-
 * page export, the first of them standing between the reader and the first
 * page drawn.
 */
function sizeSlotsFor(name) {
  if (!pdfSizes.has(name)) return;
  slotMoved = false;
  for (const el of pdfPane.querySelectorAll(".pdf-slot:not(.blank)")) {
    const src = pdfSources[Number(el.dataset.index)];
    if (!src || src.name !== name) continue;
    sizeFromKnown(el, src, Number(el.dataset.page), parseFloat(el.style.width) || paneWidth());
  }
  if (slotMoved) applyMatchedLayoutSoon();
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
    if (en.isIntersecting) {
      if (entryOnScreen(en)) onScreen.add(el);
      pdfInView.add(i);
      renderInto(el, pdfSources[i], Number(el.dataset.page), parseFloat(el.style.width) || paneWidth());
    } else { onScreen.delete(el); pdfInView.delete(i); releaseCanvas(el); }
  }
}, { root: pdfPane, rootMargin: PDF_MARGIN + "px 0px" });
const inlineObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    const el = en.target;
    const sec = el.closest(".tpage");
    if (en.isIntersecting) {
      if (entryOnScreen(en)) onScreen.add(el);
      pdfInView.add(Number(sec.dataset.index));
      renderInto(el, pdfSources[Number(sec.dataset.index)], Number(el.dataset.page), inlineWidth(sec));
    } else { onScreen.delete(el); pdfInView.delete(Number(sec.dataset.index)); releaseCanvas(el); }
  }
}, { root: stageEl, rootMargin: PDF_MARGIN + "px 0px" });

function paneWidth() { return Math.max(200, pdfPane.clientWidth - 32); }
function inlineWidth(sec) { return Math.max(200, sec.clientWidth); }

// ── side by side ──
function buildPdfPane() {
  return during('building the PDF pane', () => buildPdfPaneNow());
}
function buildPdfPaneNow() {
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
      screenObserver.observe(el);
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
/** A line with nothing on it: no text and no margin number. */
function isEmptyLine(l) {
  return !l.classList.contains("num") && !l.textContent.trim();
}
/** How many of a page's lines are empty before the first that is not. */
function leadingEmpty(lines) {
  let n = 0;
  while (n < lines.length && isEmptyLine(lines[n])) n++;
  return n < lines.length ? n : 0; // an empty page keeps its lines
}
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
  // …and one nobody has asked to see takes its height from what is already
  // known, and NEVER OPENS ITS PDF to find out. This is asked of every slot
  // the layout pass touches, which on a combined file is a slot per page of
  // every member: opening the PDF of each one it did not know the size of
  // queued the whole case folder to be read — forty PDFs for a combined file
  // of forty, opened one after the other and closed again by trimPdfs — and
  // the PDF of the page on screen waited behind them. The folder's paper
  // stands in until the reading comes near (renderInto) or the PDF is opened
  // for something else (sizeSlotsFor).
  else if (sizeFromKnown(el, src, page, w)) applyMatchedLayoutSoon();
  else {
    const want = Math.round(w * pageRatioGuess) + "px";
    const sheet = sheetOf(el);
    if (sheet.style.height !== want) sheet.style.height = want;
  }
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
  holdReading(); // pages laid on the grid, or taken off it, move everything below them
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
  const bases = new Map(); // each open PDF's body type, asked once for the pass
  const margins = new Map(); // …and its numbered margin, for the same reason
  const w0 = pageWidthNow(); // …and the page width, which every plan is made at
  // THE GRID IS WORKED OUT WHERE THE READING IS: the reading page and the one
  // either side (nearPages). Every other page keeps the placement it was given
  // when the reading was last on it, or — never reached, or its text changed
  // since — stands at its PDF page's own size with its lines flowing, so the
  // two columns are the same pages whatever the grid has got to.
  const near = new Set(grid ? nearPages() : []);
  const lite = [textEpoch, w0, settings.lineHeight, settings.font, settings.customFont].join("|");
  // Pages shown as the file has them (⇄ Raw): the file's lines, fixed-pitch,
  // with no grid to lay them on. Each flows at the height it stood at, and its
  // slot is held to it the way a shed page's is, so the columns stay in step.
  const rawSlots = [];
  for (const sec of pagesEl.querySelectorAll(".tpage:not(.shed)")) {
    const i = Number(sec.dataset.index);
    if (sec.classList.contains("raw")) {
      clearMatched(sec);
      const el = on ? slots.get(i) : null;
      if (el) { matchedSlots.add(el); fitSlot(el, w0); rawSlots.push([el, sec]); }
      continue;
    }
    const slot = grid ? slots.get(i) || null : null;
    const t = slot && pdfTarget(i);
    if (!slot || !t) { clearMatched(sec); continue; }
    const info = infoFor(t.src);
    // The page's size from the PDF, open or not: the sizes are kept after a
    // PDF is closed (pdfSizes), and the folder's paper stands in before then.
    const known = pdfSizes.get(t.src.name);
    const sz = (info && info.sizes[t.page - 1]) || (known && known[t.page - 1]) || null;
    const body = sec.querySelector(".page-body");
    const lines = [...body.querySelectorAll(":scope > .line")];
    if (!near.has(i) || !info || !sz) {
      matchedSlots.add(slot);
      const had = sec.__plan;
      if (had && sz && sec.__planLite === lite) {
        plans.push({ sec, slot, sz, body, lines, geom: had.geom, tops: had.tops, lefts: had.lefts, sizes: had.sizes, boxes: had.boxes, room: had.room, pitch: had.pitch, bodyX: had.bodyX, base: had.base, grid: had.grid, firstY: had.firstY, scale: 1 });
        continue;
      }
      plans.push({ sec, slot, sz: sz || { w: 612, h: 612 * pageRatioGuess }, body, lines, geom: null, tops: null, lefts: null, sizes: null, boxes: null, room: null, pitch: 0, bodyX: 0, firstY: info ? info.lines[t.page - 1] : null, scale: 1 });
      continue;
    }
    const geom = info.geoms[t.page - 1];
    const rows = info.rows[t.page - 1];
    const numbered = !!geom && body.classList.contains("numbered");
    let tops = null, lefts = null, sizes = null, pitch = 0, fixed = null, charGridFit = null, spans = null;
    // The body type: the DOCUMENT's, so every page of one filing is drawn at
    // one scale and a title page is not sized as though its heading were
    // body text; the page's own where the document has nothing read yet, and
    // (numbers with no body read) the reader's leading filling the pitch, as
    // it does off the grid.
    //
    // Asked once per PDF rather than once per page: it reads every page's
    // rows to see how many have landed, and a pass over two hundred pages
    // asked it two hundred times for the same answer.
    if (!bases.has(info)) bases.set(info, docTypeSize(info));
    let base = bases.get(info) || PS.pageTypeSize(rows);
    // THE NUMBERED MARGIN, one for the whole PDF. Straight down the page and
    // the same on every page of it: a margin taken page by page wanders by a
    // point or two with the measurement, and a column of numbers that wanders
    // is the thing the eye notices first.
    if (!margins.has(info)) margins.set(info, docBodyLeft(info));
    const bodyX = margins.get(info);
    // WHERE THIS PAGE'S LINES GO, worked out once and kept on the page. The
    // pass is asked for again every time a batch of the PDF's sizes lands and
    // every time more of its grid does — twenty times over on a long exhibit
    // set — and aligning a page's lines to the PDF's rows (rowLayout) is the
    // bulk of what it costs. Nothing about a page's answer changes unless its
    // width, its text, its type or its grid does, so a page whose answer is in
    // hand is not worked out again.
    const planKey = [textEpoch, w0, info.name, t.page, base, bodyX, geom ? 1 : 0, rows ? rows.length : -1,
      settings.lineHeight, settings.font, settings.customFont].join("|");
    if (sec.__planFor === planKey && sec.__plan) {
      const had = sec.__plan;
      matchedSlots.add(slot);
      plans.push({ sec, slot, sz, body, lines, geom: had.geom, tops: had.tops, lefts: had.lefts, sizes: had.sizes, boxes: had.boxes, room: had.room, pitch: had.pitch, bodyX: had.bodyX, base: had.base, grid: had.grid, firstY: info.lines[t.page - 1], scale: 1 });
      continue;
    }
    if (numbered) {
      // The margin numbers in their order down the page, and only those
      // (TD.numberChain): a number the OCR misread out of its order — line 17
      // read as 11 — would pin its line up at line 11, cram every line between
      // into the space above it, and leave the lines it stands among no PDF row
      // to be matched to (offGridTops looks between the numbers either side).
      // It is a line like any unnumbered one here, placed by its words.
      // …and none past the last number the PDF's own margin carries: an 88
      // where 28 was printed is a line the grid would put off the paper.
      let nums = lines.map((l) => (l.classList.contains("num") ? parseInt(l.querySelector(".gn").textContent, 10) : null))
        .map((n) => (n > 0 && n <= geom.last ? n : null));
      const inOrder = TD.numberChain(nums);
      nums = nums.map((n, k) => (inOrder[k] && n > 0 ? n : null));
      fixed = nums.map((n) => n != null);
      tops = PS.slotTops(nums.map((num) => ({ num })), geom);
      // The lines off the grid — a footer, a stamp — on the rows that print them.
      const off = PS.offGridTops(lines.map((l) => l.textContent), nums, tops, rows, geom.pitch);
      tops = off.tops;
      pitch = geom.pitch;
      if (!base) base = pitch / (Number(settings.lineHeight) || 1.5);
      sizes = PS.typeSizes(off.sizes, base);
    } else {
      const texts = lines.map((l) => l.textContent);
      // Where across the page each line stands, in the export's characters:
      // a line only makes room for the lines above it that it stands under
      // (pdfsync.spreadTops), so a two-column page's halves, set to their own
      // leading, are never read as one line on top of another.
      spans = texts.map((t) => { const a = t.search(/\S/); return a < 0 ? null : [a, t.trimEnd().length]; });
      const lay = rows && rows.length ? PS.rowLayout(texts, rows, { bodyLeft: bodyX }) : null;
      if (lay) {
        tops = lay.positions.map((p) => (p ? p.top : null));
        lefts = lay.positions.map((p) => (p ? p.left : null));
        // THE EXPORT'S CHARACTER GRID, read back off the PDF (pdfsync.charGrid):
        // where each line's text begins in characters, against where its row
        // begins on the page, for the lines whose row begins with the same
        // word. A page with one — any page whose lines begin anywhere but the
        // margin — has every line set on it from the grid's own left edge:
        // its indent, a centred heading, a second column all stand where the
        // PDF prints them, and a two-column line's right-hand half (whose own
        // place no row says) on the same column as the lines that are nothing
        // else. A page without one keeps each line at its row's own left.
        const firstWord = (t) => (String(t).toLowerCase().match(/[a-z0-9]+/) || [""])[0];
        const pairs = [];
        lay.rowOf.forEach((j, k) => {
          if (j == null) return;
          const w = firstWord(texts[k]), rw = firstWord(rows[j].text);
          if (w && rw === w) pairs.push({ col: texts[k].search(/\S/), x: rows[j].left });
          // …and where a two-column line's right-hand half begins: a page
          // whose every line has both halves begins none of them anywhere but
          // the margin, and gave no grid — its right-hand column drawn wherever
          // the left-hand text ended. The PDF says where the half begins: the
          // row's break that prints its first word, or the row itself where
          // the line was matched to its right-hand half.
          for (const c of TD.columnCuts(texts[k])) {
            const cw = firstWord(texts[k].slice(c));
            if (!cw) continue;
            if (cw === rw && w !== rw) { pairs.push({ col: c, x: rows[j].left }); continue; }
            const b = (rows[j].breaks || []).find((x) => x.word === cw);
            if (b) pairs.push({ col: c, x: b.x });
          }
        });
        charGridFit = PS.charGrid(pairs);
        if (charGridFit) lefts = lefts.map((l) => (l == null ? null : charGridFit.x0));
        pitch = lay.pitch;
        if (!base) base = pitch / (Number(settings.lineHeight) || 1.5);
        sizes = PS.typeSizes(lay.positions.map((p) => (p ? p.size : null)), base);
        // A row of a drawn box (rules.js) is a table, not cut into columns,
        // and draws the spaces it opens with in its first cell at their own
        // width: it stands that much further in, by what they fall short of
        // the grid — the bar under a docket number where the PDF draws it.
        if (charGridFit) {
          const sp = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--col-sp-n")) || 0.25;
          lines.forEach((l, k) => {
            if (lefts[k] == null || !l.classList.contains("rl")) return;
            const lead = Math.max(0, texts[k].search(/\S/));
            lefts[k] = charGridFit.x0 + lead * Math.max(0, charGridFit.unit - sp * sizes[k]);
          });
        }
      }
    }
    // Never on top of each other: a row the PDF (a scan's text layer, most
    // often) prints closer under the one above than that line's box is tall
    // is pushed down to clear it, and out of register with the PDF by that
    // much — reading the text beats lining it up (pdfsync.spreadTops).
    const boxes = sizes ? sizes.map((h) => h * LINE_BOX) : null;
    // …but an EMPTY line holds no room. PDF-Linker writes the page's top
    // margin as blank lines above line 1 — six, ten, more — and stacked up
    // from the first numbered line they run off the top of the sheet, are
    // held at its edge, and were then each given a line's box: a column of
    // nothing that pushed line 1 and everything under it down the page, a
    // band of white at the top of the text that the PDF beside it does not
    // have. The blank lines under the last one did the same at the foot,
    // growing the sheet past its PDF page. A line with nothing on it — no
    // words and no margin number — is a gap, and a gap pushes nothing.
    const room = boxes ? boxes.map((b, k) => (isEmptyLine(lines[k]) ? 0 : b)) : null;
    // ON PLEADING PAPER THE NUMBERS ARE THE GRID, and a numbered line stays on
    // its number whatever stands between it and the one above (fixed). A
    // caption's single-spaced lines between two numbers are set a type size
    // apart, and they clear each other by that — their TYPE, as the PDF sets
    // it — not by a whole line's box apiece, which pushed each one down a few
    // points into the next, and the numbers down the side with them.
    const clear = fixed ? sizes.map((h, k) => (isEmptyLine(lines[k]) ? 0 : h)) : room;
    if (tops) tops = PS.spreadTops(tops, clear, fixed, spans);
    // …and nothing pushed past the foot of the paper: the page is the PDF
    // page's height, the same as the sheet beside it, and a line that would
    // run past it is brought back up (pdfsync.holdWithin). The page grows
    // only where its lines cannot all fit on it at all.
    if (tops) tops = PS.holdWithin(tops, clear, sz.h, spans);
    // No grid to draw to (a scan with no text layer): the page keeps its
    // flowing layout at the pane's own scale.
    // The scale is the sheet's, and the sheet is the paper: the write pass
    // below sets it from the page's own width (and the magnification with it),
    // so the grid is drawn at whatever size the paper is being read at.
    matchedSlots.add(slot);
    sec.__planFor = planKey;
    sec.__planLite = lite;
    sec.__plan = { geom: numbered ? geom : null, tops, lefts, sizes, boxes, room, pitch, bodyX, base, grid: charGridFit, firstY: info.lines[t.page - 1] };
    plans.push({ sec, slot, sz, body, lines, geom: numbered ? geom : null, tops, lefts, sizes, boxes, room, pitch, bodyX, base, grid: charGridFit, firstY: info.lines[t.page - 1], scale: 1 });
  }
  // A page the reel has SHED has no lines to lay and stands at the height it
  // was pinned at (shedMember). Its slot used to fall to the pane's width —
  // which is not the page's width wherever the two columns are not the same
  // size, or the reader is zoomed — and to its PDF page's height, beside a
  // page pinned at whatever it had been. A slot is the page beside it, built
  // or not: it takes the page's width here, and its height below with the
  // slots that have no PDF page at all.
  const shedSlots = [];
  if (on) {
    for (const sec of pagesEl.querySelectorAll(".tpage.shed")) {
      const el = slots.get(Number(sec.dataset.index));
      if (!el) continue;
      matchedSlots.add(el);
      fitSlot(el, w0);
      shedSlots.push([el, sec]);
    }
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
    if (p.slot.style.height) p.slot.style.height = ""; // held to a shed page's height, and the page is back
    p.sec.classList.add("matched");
    p.sec.style.width = w + "px";
    // The page's height from the SAME arithmetic the bitmap is drawn by
    // (renderInto, presize), not from the scale again: a page height rounded
    // one way and a canvas height rounded the other is a pixel a page, and a
    // pixel a page is a centimetre by the fortieth — one column sliding under
    // the other with nothing visibly wrong on either.
    const pageH = Math.round((w * p.sz.h) / p.sz.w);
    // …or more, only where the page's lines cannot all fit on it (holdWithin,
    // above, brings back everything that can). The slot grows with it
    // (below), so the two boxes stay the same box.
    let foot = 0;
    // An empty line is not something that runs past it (room, above).
    if (p.tops) p.tops.forEach((y, k) => { if (y != null && p.room[k] > 0) foot = Math.max(foot, y + p.room[k]); });
    p.h = Math.max(pageH, Math.round(foot * p.scale));
    p.sec.querySelector(".page-inner").style.height = p.h + "px";
    p.body.classList.toggle("fixed", !!p.tops);
    // A page with no grid to draw to (a scan with no text layer, a page
    // nothing on it matched) flows — and its first lines are the blank ones
    // PDF-Linker wrote for the top margin, each a full line at the reading
    // size, under the sheet's own padding: a band of white several inches
    // deep above text the PDF starts an inch down. So beside the PDF those
    // lines are put away (hidden, never removed: a save still writes them,
    // as with the trailer) and the text starts where the PDF's first printed
    // line does — read off its text layer, else an inch down, which is
    // where the scroll sync takes it to be (pdfFirstLine).
    const lead = p.tops ? 0 : leadingEmpty(p.lines);
    for (let k = 0; k < Math.max(lead, p.sec.__lead || 0) && k < p.lines.length; k++) p.lines[k].classList.toggle("lead", k < lead);
    p.sec.__lead = lead;
    const padTop = p.tops ? "" : ((p.firstY != null ? p.firstY : PDF_LINE_DEFAULT * p.sz.h) * p.scale) + "px";
    if (p.body.style.paddingTop !== padTop) p.body.style.paddingTop = padTop;
    if (p.bodyX > 0) p.sec.style.setProperty("--body-x", (p.bodyX * p.scale) + "px");
    else p.sec.style.removeProperty("--body-x");
    // The page's body type, which the grid's columns are measured in
    // (columns.js): each line is set in its own row's size, and a column
    // has to stand at one place down the page whatever size that is.
    const gridEm = p.tops && p.base > 0 ? (p.base * p.scale) + "px" : "";
    if (p.body.style.getPropertyValue("--grid-em") !== gridEm) {
      if (gridEm) p.body.style.setProperty("--grid-em", gridEm); else p.body.style.removeProperty("--grid-em");
    }
    // …and a page with no numbers, its lines set on the export's own grid
    // where the PDF gave one (.cgrid, its character --grid-col), else each at
    // its own row's left with the spaces it opens with taken back out of it
    // (.rowleft): the row's left IS where its text begins, and the spaces
    // drawn in front of it as well set every indented line in twice as far.
    const onGrid = !!(p.tops && !p.geom && p.grid);
    const gridCol = onGrid ? (p.grid.unit * p.scale) + "px" : "";
    p.body.classList.toggle("cgrid", onGrid);
    p.body.classList.toggle("rowleft", !!(p.tops && !p.geom && !p.grid));
    if (p.body.style.getPropertyValue("--grid-col") !== gridCol) {
      if (gridCol) p.body.style.setProperty("--grid-col", gridCol); else p.body.style.removeProperty("--grid-col");
    }
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
  //
  // EACH LABEL IS MEASURED AT ITS OWN HEIGHT. The height read used to be the
  // one this pass had written the time before, so a label levelled up to its
  // neighbour read back as tall as it had been made: the next pass found the
  // two equal and took the levelling off, the pass after put it back, and a
  // page whose label wraps (a REVIEW clause on a narrow sheet) stood beside
  // its PDF page a line's height out of step every other pass. And once the
  // wrap went away (a wider window, a zoom), the stale height was the taller
  // one and was handed to the other label for good. So whatever a pass before
  // set is taken off first, and both are read as their words make them — to
  // the fraction of a pixel, since a pixel rounded away on every levelled page
  // is the two columns sliding apart down the document.
  if (plans.length) {
    const pairs = plans.map((p) => ({
      p,
      lt: p.sec.querySelector(".page-label"),
      ls: p.slot.querySelector(".page-label"),
      sheet: p.slot.querySelector(".pdf-sheet"),
    }));
    for (const x of pairs) {
      if (x.lt && x.lt.style.height) x.lt.style.height = "";
      if (x.ls && x.ls.style.height) x.ls.style.height = "";
    }
    for (const x of pairs) {
      x.hl = x.lt ? x.lt.getBoundingClientRect().height : 0;
      x.hs = x.ls ? x.ls.getBoundingClientRect().height : 0;
    }
    for (const x of pairs) {
      const lead = Math.max(x.hl, x.hs);
      for (const [el, h] of [[x.lt, x.hl], [x.ls, x.hs]]) {
        if (!el) continue;
        const want = lead - h > 0.01 ? (Math.round(lead * 100) / 100) + "px" : "";
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
  // A COLUMN IS NOT PUSHED ON THE GRID. A piece of a line before a column
  // (columns.js) is as wide as the export's grid gives it, and the reader's
  // font is not the filing's: set at the PDF's own size it runs a little
  // wider, and a left-hand half too wide for its cell pushed its line's
  // right-hand half off the column the lines above and below it stand on.
  // Beside the PDF the column is the point, so the piece is held to its cell
  // instead: drawn across the cell's margin where the blank before the next
  // column has room for it, squeezed across only where it would run into that
  // column's text, the way an over-long line is below and the way pdf.js fits
  // its own text to the page — and only so far (columns.js, fitCells). The
  // reading page and its neighbours only.
  const cells = [];
  for (const p of plans) {
    if (!p.tops || !near.has(Number(p.sec.dataset.index))) continue;
    for (const c of p.body.querySelectorAll(".line > .lt > .cc")) cells.push(c);
  }
  fitCells(cells);
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
      // What it may give back is the indent IN FRONT of it — the blank
      // between the numbered margin and where this row starts — and not a
      // pixel more: the margin is the boundary, here as everywhere.
      const floor = p.bodyX > 0 ? p.bodyX * p.scale : 0;
      if (left - floor < 1) return; // already at the margin: nothing to give
      const lt = l.querySelector(":scope > .lt");
      if (lt) spill.push({ l, lt, left, floor });
    });
  }
  if (spill.length) {
    for (const x of spill) x.over = x.lt.scrollWidth - x.lt.clientWidth;
    for (const x of spill) {
      const back = Math.min(Math.max(0, x.over), x.left - x.floor);
      const want = (x.left - back) + "px";
      if (x.l.style.left === want) continue;
      x.l.style.left = want;
      // What the line was laid at no longer describes it: the next pass puts
      // it back at its own indent and measures it again from there.
      x.l.__laid = null;
    }
  }
  // A LINE STILL TOO LONG IS NARROWED, NEVER CUT. What overran the sheet after
  // giving back its indent used to be cut off at the edge, and the words at
  // the end of a line are words like any other. The line is drawn narrower
  // instead — its own type, its own height, squeezed across by what it
  // overruns, the way pdf.js fits its own text layer to the page — so it ends
  // at the sheet's edge and stays beside its row. Measured for the reading
  // page and its neighbours only (the rest keep what they were given there);
  // a line's own transform does not change what it measures, so a pass that
  // finds it already narrowed finds the same answer.
  const squeeze = [];
  for (const p of plans) {
    if (!near.has(Number(p.sec.dataset.index))) continue;
    for (const l of p.lines) {
      if (l.classList.contains("rl")) continue; // a ruled box is squared up by fitRuleRows
      const lt = l.querySelector(":scope > .lt");
      if (lt) squeeze.push({ lt });
    }
  }
  for (const x of squeeze) x.fit = x.lt.clientWidth > 0 && x.lt.scrollWidth > x.lt.clientWidth + 0.5 ? x.lt.clientWidth / x.lt.scrollWidth : 1;
  for (const x of squeeze) {
    const want = x.fit < 1 ? `scaleX(${x.fit.toFixed(4)})` : "";
    if (x.lt.style.transform === want) continue;
    x.lt.style.transform = want;
    x.lt.style.transformOrigin = want ? "0 0" : "";
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
  // taken their matched sizes above. A shed page's slot is held to that page's
  // pinned height the same way. To the fraction of a pixel: a page's height
  // rounded away on every such slot is the columns sliding apart down a
  // combined file.
  if (on) {
    const blanks = [];
    for (const el of pdfPane.querySelectorAll(".pdf-slot.blank")) {
      const sec = pagesEl.querySelector(`.tpage[data-index="${el.dataset.index}"]`);
      if (sec) blanks.push([el, sec]);
    }
    const held = blanks.concat(shedSlots, rawSlots).map(([el, sec]) => [el, sec.getBoundingClientRect().height]);
    for (const [el, h] of held) {
      const want = (Math.round(h * 100) / 100) + "px";
      if (el.style.height !== want) el.style.height = want;
    }
  }
  // The boxes the export draws: their columns and sheets, measured now that
  // every line stands where this pass put it (rules.js).
  fitRuleRows(pagesEl);
  textAnchors = null; textLineTops = null;
  // …and the grid asked for wherever the reading has come to without one.
  if (on) gridNear();
  // The slots have just taken their widths: the pane keeps its own middle.
  if (on) holdSideways(pdfPane);
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
// How close the fit comes to the largest size that holds the page: a
// hundredth of the type, which nobody reading can see. The search below
// usually lands in three or four passes; eight is the bound on a page whose
// lines keep wrapping and unwrapping on the way down.
const FIT_STEP = 0.01;
const FIT_PASSES = 8;
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
// WHAT A PAGE'S SHAPE DEPENDS ON, as one string. The fit is measured by
// reading every page's scrollHeight after writing every page's minHeight, four
// times over, and a read after a write lays the whole document out — which on
// a two-hundred-page exhibit set is a quarter of a second a pass, and the pass
// is asked for again as each batch of the PDF's page sizes lands. Almost every
// one of those asks would measure pages whose answer cannot have changed. So a
// page remembers what it was shaped for, and a page shaped for this already is
// passed over: the ask costs the pages that actually moved.
// The width is the MEASURED one, not the one the settings ask for: the two
// differ for a moment while a column is being re-laid (the pane closing, the
// window dragged), and a fit measured in that moment must not be remembered
// as the answer for the width that arrives a frame later. `clipped` is in it
// for the same reason — a page shaped beside the PDF is not shaped the way
// the same page is on its own.
function shapeKey(ratio, width, clipped) {
  return [
    Math.round(width), clipped ? 1 : 0, ratio || 0, textEpoch, zoomNow(),
    settings.lineHeight, settings.font, settings.customFont,
  ].join("|");
}
// How far either side of the reading a page is FITTED. The shape itself — the
// paper's height and the PDF's type — is written for every page, since it is
// a write and no reading; what costs is measuring whether the words fit, and
// that is worth knowing for the pages somebody is about to look at. The rest
// are fitted as the reading comes to them (fitNearSoon, on the scroll).
const FIT_SCREENS = 3;
function shapePages({ all = false } = {}) {
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
  const flowing = [];
  for (const sec of secs) {
    const body = sec.querySelector(".page-body");
    // A swapped page's text is put away under its PDF page, not re-laid, so
    // it keeps the shape it had: swapped back, it comes up at the size it was
    // fitted to. Taking the fit off it drew it at the full reading size the
    // moment it came back, and then the next pass shrank it again.
    if (sec.classList.contains("swapped") || sec.classList.contains("raw")) continue;
    const loose = sec.classList.contains("matched")
      || (!clipped && sec.querySelector(".line.trailer"));
    if (loose) {
      if (body.style.minHeight) body.style.minHeight = "";
      if (sec.style.getPropertyValue("--fit")) sec.style.removeProperty("--fit");
      // Its shape has just been taken off it, so what it was shaped for no
      // longer describes it: coming off the grid (the pane closed) has to
      // shape it again, whatever else is unchanged.
      sec.__shapedFor = null;
      // A page left to flow (the trailer's, with the pane closed) is not
      // fitted, but its columns are placed all the same (columns.js).
      if (!sec.classList.contains("matched")) flowing.push(sec);
      continue;
    }
    shapes.push({ sec, body, ratio: pdfRatioOf(Number(sec.dataset.index)), fit: 1 });
  }
  if (flowing.length) {
    const key = [textEpoch, settings.font, settings.customFont].join("|");
    const due = flowing.filter((sec) => sec.__placedFor !== key);
    if (due.length) {
      alignColumns(due.map((sec) => sec.querySelector(".page-body")));
      for (const sec of due) sec.__placedFor = key;
    }
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
  // The window the measuring is worth doing in, and the pages already shaped
  // for exactly this. Both are decided before anything is written, so the
  // geometry below is read once.
  const top = stageEl.scrollTop, seen = stageEl.clientHeight;
  const pad = Math.max(seen * FIT_SCREENS, 1500);
  const todo = [];
  for (const s of shapes) {
    s.key = shapeKey(s.ratio || common, width, clipped);
    if (s.sec.__shapedFor === s.key) continue; // its answer cannot have changed
    s.near = all || (s.sec.offsetTop + s.sec.offsetHeight > top - pad && s.sec.offsetTop < top + seen + pad);
    todo.push(s);
  }
  if (!todo.length) return;
  holdReading(); // a page above the reading changing height moves the reading
  for (const s of todo) {
    s.target = Math.round(width * (s.ratio || common));
    const want = s.target + "px";
    if (s.body.style.minHeight !== want) s.body.style.minHeight = want;
    if (s.sec.style.getPropertyValue("--fit")) s.sec.style.removeProperty("--fit"); // measured at its own size first
    applyPdfTypeSizes(s.sec, s.body);
    // Only a page that has been MEASURED is finished with: one written but
    // left unfitted is asked for again when the reading comes near it.
    s.sec.__shapedFor = s.near ? s.key : null;
  }
  const measure = todo.filter((s) => s.near);
  if (!measure.length) return;
  // THE SHAPE IS A CEILING. A page whose words want more room than the PDF
  // page gave them — the reading size is the reader's own, and the filing was
  // set in whatever it was set in — is drawn smaller until they fit, the way
  // the PDF itself is at that zoom. Display only: the file is one size, and
  // the size in the Tools panel is still the size of a page that fits.
  //
  // Every page is measured, THEN every page is written. Shrinking one page and
  // measuring the next lays the whole document out again for each page in
  // turn, which on a long export is most of the time an open takes; this way
  // a pass costs one layout however many pages there are.
  //
  // THE FIT IS THE LARGEST SIZE THAT HOLDS THE PAGE, searched for, not one cut
  // by how far over the page ran. Type taken down by that ratio is right only
  // while the page's height follows its type, and it does not where lines
  // wrap: a dense page whose long lines each wrap once at the reading size is
  // twice the paper's height, the ratio halves the type, and at half the size
  // nothing wraps and the words fill half the sheet — down to the floor, on a
  // page whose lines stop wrapping a few percent under the reading size. The
  // fit only ever went down, so the page stayed there. So each page keeps the
  // largest size seen to hold it and the smallest seen not to, and the next
  // size tried lies between them: the ratio's guess while nothing smaller has
  // been tried, half way between the two once the guess has fallen short.
  withBaseSize(() => {
    let live = measure.filter((s) => s.target > 0);
    for (const s of live) { s.lo = 0; s.hi = Infinity; }
    const put = (s, f) => { s.fit = Number(f.toFixed(3)); s.sec.style.setProperty("--fit", s.fit.toFixed(3)); };
    // THE COLUMNS ARE A CEILING TOO. A page laid out in columns (columns.js)
    // holds them only while each of its column lines fits across the paper:
    // one that wraps brings its right-hand column back at the left margin,
    // under the column it belongs beside. So such a page starts no larger than
    // the size its widest column line fits at, and the search below goes down
    // from there. Unlike one runaway line, this is the page's own layout, and
    // the type paying for it is the PDF's own answer: a two-column page is set
    // small.
    //
    // …and its columns are first placed where this font needs them (columns.js,
    // alignColumns): a second column one place down the lines beside it, a
    // gutter clear of the widest text to its left. Written in the body's type,
    // so the fit found below takes them with it.
    alignColumns(live.map((s) => s.body));
    const caps = columnCaps(live.map((s) => s.body));
    live.forEach((s, k) => { if (caps[k] < 1) put(s, caps[k]); });
    for (let pass = 0; pass < FIT_PASSES && live.length; pass++) {
      // Too tall for the paper: the type gives. Too WIDE is not the type's
      // fault and is not paid for by the whole page — one runaway line
      // would take every word on the sheet down with it — so a line that
      // runs past the edge is cut off there by the stylesheet instead.
      const heights = live.map((s) => s.body.scrollHeight);
      const next = [];
      live.forEach((s, k) => {
        const h = heights[k];
        const over = h > s.target + 0.5;
        if (over) s.hi = s.fit; else s.lo = s.fit;
        if (!over) {
          // It holds: done, unless a larger size not yet tried might too.
          if (s.hi === Infinity || s.hi - s.lo <= FIT_STEP) return;
          put(s, (s.lo + s.hi) / 2);
        } else if (!s.lo) {
          // Nothing smaller tried yet: the ratio's guess, down to the floor.
          if (s.fit <= MIN_FIT) return; // at the floor: the page grows instead
          put(s, Math.max(MIN_FIT, s.fit * (s.target / h)));
        } else if (s.hi - s.lo <= FIT_STEP) {
          put(s, s.lo); // as close as it comes: the size known to hold
          return;
        } else {
          // The ratio's guess, just under the size that ran over (the margins
          // do not shrink with the type, so the guess falls a little short of
          // fitting) — or half way, where the guess is no closer than that.
          const guess = Math.min(s.fit * (s.target / h), s.hi - FIT_STEP / 2);
          put(s, guess > s.lo + FIT_STEP / 2 ? guess : (s.lo + s.hi) / 2);
        }
        next.push(s);
      });
      live = next;
    }
    // Out of passes between two sizes: the larger one known to hold.
    for (const s of live) if (s.lo && s.fit !== s.lo) put(s, s.lo);
  });
  // A box too wide for its paper is drawn to fit it (rules.js), and it was
  // fitted at the type its page had before this: fitted again at the type the
  // page has now, so it still ends at the margin.
  const boxed = measure.filter((s) => s.sec.querySelector(".line.rl")).map((s) => s.sec);
  if (boxed.length) fitRuleRows(boxed);
}

/**
 * Per page body, the largest fit at which its widest column line is drawn on
 * one line (1 where every one fits, or there are none). The lines are read
 * unwrapped, every page at once, so the pass lays the document out once.
 */
function columnCaps(bodies) {
  const rows = bodies.map((b) => [...b.querySelectorAll(":scope > .line.cols > .lt")]);
  const on = bodies.filter((b, k) => rows[k].length);
  if (!on.length) return bodies.map(() => 1);
  for (const b of on) b.classList.add("cols-measure");
  const caps = rows.map((lts) => {
    let need = 0, room = 0;
    for (const lt of lts) { need = Math.max(need, lt.scrollWidth); room = room || lt.clientWidth; }
    return room > 0 && need > room + 0.5 ? Math.max(MIN_FIT, Math.floor((room / need) * 1000) / 1000) : 1;
  });
  for (const b of on) b.classList.remove("cols-measure");
  return caps;
}

/** A slot back as the pane built it: the levelling and the held-open box go. */
function unlevelSlot(el) {
  const lab = el.querySelector(".page-label");
  if (lab && lab.style.height) lab.style.height = "";
  const sheet = el.querySelector(".pdf-sheet");
  if (sheet && sheet.style.minHeight) sheet.style.minHeight = "";
  if (el.style.height) el.style.height = ""; // …and a shed page's height
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
  body.classList.remove("fixed", "cgrid", "rowleft");
  body.style.paddingTop = "";
  body.style.removeProperty("--grid-em");
  body.style.removeProperty("--grid-col");
  for (const c of body.querySelectorAll(".cc")) if (c.style.width || c.style.transform) { c.style.width = ""; c.style.transform = ""; c.style.transformOrigin = ""; }
  for (const l of body.querySelectorAll(":scope > .line.lead")) l.classList.remove("lead");
  sec.__lead = 0;
  for (const l of body.querySelectorAll(":scope > .line")) { l.__laid = null; l.style.top = ""; l.style.left = ""; l.style.height = ""; l.style.lineHeight = ""; l.style.fontSize = ""; }
  for (const lt of body.querySelectorAll(":scope > .line > .lt")) if (lt.style.transform) { lt.style.transform = ""; lt.style.transformOrigin = ""; }
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
  // While the reading is held through a re-layout the text leads: the PDF
  // pane moving as its own slots are re-sized is not the reader scrolling it.
  if (placeHold && from === "pdf") { from = "text"; force = true; }
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
stageEl.addEventListener("scroll", () => { notePlaceSoon(); noteSideways(stageEl); syncScroll("text"); reelMaybeExtend(); reelScrolled(); reelSyncCurrent(); reelTrimSoon(); pdfTrimSoon(); fitNearSoon(); gridNearSoon(); }, { passive: true });
// Coalesced: a scroll fires continuously, and a pass over the members that
// builds pages back is not something to do sixty times a second.
const reelTrimSoon = debounce(reelTrim, 200);
// …and the PDFs behind the documents the reading has left: the window moves
// with the reading, so what falls out of it is closed as it does, and not
// only when the document changes.
// At most every half second WHILE the reading moves, not half a second after
// it stops. Waiting for the scroll to settle was safe while opening a PDF was
// slow; with one worker for them all (sharedPdfWorker) an open is a few
// milliseconds, and reading straight down a combined file without pausing
// opened every member's PDF and closed none of them until the scrolling
// stopped: forty open at once in a folder of forty, which in a folder of
// scanned exhibits is the tab. The most open at once over that scroll: 41 → 11.
let pdfTrimTimer = 0;
function pdfTrimSoon() {
  if (!pdfTrimTimer) pdfTrimTimer = setTimeout(() => { pdfTrimTimer = 0; trimPdfs(); }, 500);
}
// The pages the reading is coming to, fitted before it gets there: shapePages
// measures only what is near (FIT_SCREENS) and passes over what it has already
// answered, so asking on the scroll costs the pages that have just come near.
const fitNearSoon = debounce(() => { if (doc) shapePages(); }, 150);
// …and the grid, which is worked out for the reading page and its neighbours
// only: the reading moving to another page lays that one (and asks for its
// grid where it has none).
let gridNearAt = -1;
const gridNearSoon = debounce(() => {
  if (!doc || !gridOn()) return;
  const r = readingPage();
  if (r === gridNearAt) return;
  gridNearAt = r;
  applyMatchedLayoutSoon();
}, 150);
// …and the pages that were still drawing when the reading left them.
const releasePagesSoon = debounce(sweepPagesToRelease, 700);
pdfPane.addEventListener("scroll", () => { syncScroll("pdf"); noteSideways(pdfPane); }, { passive: true });

// ── sideways: each column holds its own centre ──────────────────────────────────
//
// A page wider than its column (zoomed in, or side by side on a narrow window)
// is scrolled to sideways, and the column held its scrollLeft in PIXELS while
// the widths under it changed: zooming, the find bar re-laying the column, the
// grid landing, the window resizing. Each of those moved the page under a
// scroll position that no longer meant what it had — and a width that dipped
// for a moment clamped it to the edge, where it stayed when the width came
// back. The page wandered off centre without anybody touching the scroll bar.
//
// So each column remembers WHERE ITS MIDDLE IS, as a fraction of how wide its
// content is — centred until the reader scrolls it sideways — and whenever the
// width changes it is put back there. Only a sideways scroll made while the
// widths stood still is the reader's, and moves the remembered middle.
const sideways = new Map(); // box → { mid, w, cw }
function sidewaysOf(box) {
  if (!sideways.has(box)) sideways.set(box, { mid: 0.5, w: box.scrollWidth, cw: box.clientWidth });
  return sideways.get(box);
}
/** A scroll: where the widths have not moved, a sideways one is the reader's. */
function noteSideways(box) {
  const s = sidewaysOf(box);
  if (box.scrollWidth !== s.w || box.clientWidth !== s.cw) { holdSideways(box); return; }
  if (s.w > s.cw) s.mid = (box.scrollLeft + s.cw / 2) / s.w;
}
/** Put the column's middle back where it was, at whatever width it has now. */
function holdSideways(box) {
  const s = sidewaysOf(box);
  const w = box.scrollWidth, cw = box.clientWidth;
  s.w = w; s.cw = cw;
  if (w <= cw) return; // it all fits: there is no sideways to hold
  const want = Math.max(0, Math.min(w - cw, Math.round(s.mid * w - cw / 2)));
  if (Math.abs(box.scrollLeft - want) > 1) box.scrollLeft = want;
}
if (typeof ResizeObserver !== "undefined") {
  // The pages' own width (the zoom, the grid, the reel) and the stage's (the
  // window, the panel, the pane opening): either one is the column changing.
  const sidewaysWatch = new ResizeObserver(() => { holdSideways(stageEl); holdSideways(pdfPane); });
  sidewaysWatch.observe(pagesEl);
  sidewaysWatch.observe(stageEl);
  sidewaysWatch.observe(pdfPane);
}

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
  return during('putting the PDF pages into the text', () => applySwapsNow());
}
function applySwapsNow() {
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
    // One view of a page at a time: the PDF page shown takes the file's text off.
    if (on && sec.classList.contains("raw")) setRaw(sec, false);
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
      screenObserver.observe(inline);
      inlineObserver.observe(inline);
    } else if (inline) {
      inlineObserver.unobserve(inline);
      screenObserver.unobserve(inline);
      onScreen.delete(inline);
      dropDrawTurn(inline);
      if (inline.__task) { try { inline.__task.cancel(); } catch { /* done */ } }
      releasePage(inline);
      inline.remove();
      moved = true;
    }
  }
  refreshSwapButtons();
  updatePdfStatus();
  warmForLeaks();
  if (!moved) return;
  // A page coming back from its PDF page is fitted before it is drawn: one
  // the paper or the type has changed under while it was away would
  // otherwise show at the full reading size until the next pass.
  holdReading();
  shapePages();
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
  if (on && idx.length) { const sec = pagesEl.querySelector(`.tpage[data-index="${idx[0]}"]`); if (sec) { releaseReading(); stageEl.scrollTo({ top: sec.offsetTop - 12, behavior: "smooth" }); } }
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
  // A FAR HIGHER CEILING HERE, and a page that reaches it is reported rather
  // than passed over. This is the redaction sweep: it finds where the key's
  // values stand on the page so they can be blacked out, and a value it never
  // looked at is a value left in a copy made to hide it. Slow is the right
  // answer for a check the operator asked for and is watching the progress
  // of; silently short is not. The ceiling is here at all because the layout
  // is a node per piece of text, and a page can carry half a million.
  const tc = await textItemsOf(page, REDACT_ITEMS_MAX);
  const tl = new pdfjsLib.TextLayer({ textContentSource: { items: tc.items, styles: tc.styles }, container: box, viewport: vp });
  await tl.render();
  repairTextLayer(tl, tc.items);
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
  return { boxes: out, missed, chars, truncated: tc.truncated };
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
  // Pages whose text ran past what the sweep will lay out. Named in the toast:
  // a page the sweep did not read to the end is a page whose values it cannot
  // vouch for, and that is the operator's to know rather than ours to bury.
  const unchecked = [];
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
        if (hits.truncated) unchecked.push(`${name} p. ${pn}`);
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
      : "") +
    (unchecked.length
      ? ` ${unchecked.length} page${unchecked.length === 1 ? "" : "s"} carr${unchecked.length === 1 ? "ies" : "y"} more text than the sweep reads to the end (${unchecked.slice(0, 3).join(", ")}${unchecked.length > 3 ? ", and more" : ""}) — mark those by hand.`
      : ""),
    { ms: missWalk.length || unchecked.length ? 9000 : 5000 });
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
  return duringAsync(`rendering page ${pageNumber} for the redacted copy`, () => renderRedactedPageNow(pdf, store, pageNumber, scale));
}
async function renderRedactedPageNow(pdf, store, pageNumber, scale) {
  const page = await pdf.getPage(pageNumber);
  const vp = page.getViewport({ scale });
  const pts = page.getViewport({ scale: 1 });
  // A canvas of the document the PDF's fonts are in (pdf-fonts.js): drawn on
  // one of this document's, a font embedded in the PDF is not found and its
  // text comes out in whatever the browser falls back to.
  const canvas = fontCanvas(Math.max(1, Math.round(vp.width)), Math.max(1, Math.round(vp.height)));
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
  // The heaviest thing the reader does: every page of a PDF drawn at 200 dpi
  // and held as an image until the copy is assembled. If a tab dies here, the
  // breadcrumb says so rather than naming whatever ran before it.
  return duringAsync("writing the redacted copy", () => saveRedactedCopiesNow());
}
async function saveRedactedCopiesNow() {
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


// ── a page as the file has it (⇄ Raw) ──────────────────────────────────────────────
//
// Everything the reader does is a view: the fakes are shown as the REAL names,
// the lines are laid out as sheets, the margin numbers are given a ruled
// gutter of their own, the citations are underlined. That is the point of it.
// It is also the reason it is worth being able to see the file itself — because
// what goes to the court, to PDF-Linker, and to anyone the export is handed to
// is the bytes, not the view, and the two are meant to differ in exactly one
// way: the file carries the pseudonyms.
//
// So ⇄ Raw on a page's label puts that page's own text in the page's place,
// the way ⇄ PDF puts its PDF page there: the header line, the margin numbers
// and the spacing exactly as they sit in the file, fixed-pitch and wrapping
// off as a plain editor opens it, the pseudonyms as PDF-Linker wrote them.
// Not a rendering of the file: the text a save writes, built the way a save
// builds it (`serializeHeld`, which writes a pseudonym span's FAKE and never
// the real name it shows), so on a page nobody has edited it is the disk,
// character for character. The page's own text stays in the DOM under it,
// hidden, and still saves; ⇄ Text puts it back. One view of a page at a time:
// the PDF page shown takes the file's text off, and the file's text the PDF
// page. Beside the PDF the page leaves the grid while it is raw — the file's
// lines are the file's, and there is no grid to lay them on.
//
// WHERE THE PAGE AND THE DISK DIFFER IT SAYS SO. With edits not yet written the
// disk still holds the version before them, and the corner says which this is.
// A real value the key binds standing in the text — a name the run missed — is
// marked as it is on the page, because it is what the file carries now.

/** A page's text exactly as a save would write it — banner or header line, then its lines — and its spot keeps' places in it. */
function rawPageText(sec) {
  const p = (doc && doc.pages[Number(sec.dataset.index)]) || {};
  const body = sec.querySelector(".page-body");
  const own = body ? TD.serializeHeld(body) : { text: (p.lines || []).join("\n"), held: [] };
  const head = [p.banner, p.header].filter((l) => l != null);
  // A page that is its header alone writes no line under it.
  const parts = own.text === "" && !(p.lines || []).length ? head : head.concat(own.text);
  const lead = head.length && parts.length > head.length ? head.join("\n").length + 1 : 0;
  return { text: parts.join("\n"), held: own.held.map(([a, b]) => [a + lead, b + lead]) };
}

/** The ⇄ Raw button, as the page stands. */
function setRawButton(b, on) {
  const label = on ? "⇄ Text" : "⇄ Raw";
  if (b.textContent !== label) b.textContent = label;
  b.title = on
    ? "Back to the text of this page"
    : "This page as the file has it, in its place — the pseudonyms as PDF-Linker wrote them, the page header, the margin numbers and the spacing exactly as they sit on disk";
  b.setAttribute("aria-pressed", String(on));
}

/** A raw page's text, written again where the page, its edits or the names standing in it have moved. */
function fillRaw(sec) {
  const view = sec.querySelector(".page-inner > .raw-sheet");
  if (!view) return;
  const { text, held } = rawPageText(sec);
  const m = reelMemberOf(Number(sec.dataset.index));
  const tag = m && m.dirty
    ? "The file with your unsaved edits — the disk still has the version before them"
    : "The file as it is on disk";
  // The marks are the page's own leak marks (scanPassNow): every real name the
  // key binds, past the values kept for the case, the spot keeps and the
  // parties of cited decisions.
  const cited = TD.citedNameSpans(text);
  // A name wrapped down a column is marked piece by piece: the other column's
  // words between them are not part of it.
  const leaks = reals
    ? PK.findRealSpans(reals, TD.blankRanges(maskKept(text, text), held), { layout: text }).filter((h) => !TD.insideCited(cited, h))
    : [];
  const marks = leaks.flatMap((h) => h.ranges).sort((a, b) => a[0] - b[0]);
  // Nothing moved, nothing written: a selection being made in it to copy survives.
  const sig = [tag, text, marks.map(([a, b]) => a + "-" + b).join(",")].join("\u0000");
  if (view.__sig === sig) return;
  view.__sig = sig;
  view.querySelector(".raw-tag").textContent = tag;
  const pre = view.querySelector(".raw-text");
  pre.textContent = "";
  let at = 0;
  for (const [a, b] of marks) {
    if (a > at) pre.append(text.slice(at, a));
    const mark = document.createElement("span");
    mark.className = "raw-leak";
    mark.title = "A real name from the key, standing in the file — a save writes its pseudonym only once you have said to fake it";
    mark.textContent = text.slice(a, b);
    pre.append(mark);
    at = b;
  }
  pre.append(text.slice(at));
}
function refreshRawPages() {
  for (const sec of rawPages) {
    if (!sec.isConnected) rawPages.delete(sec); // a document closed, or built again
    else fillRaw(sec);
  }
}

/** Show a page as the file has it, or as text again. */
function setRaw(sec, on) {
  const inner = sec.querySelector(".page-inner");
  if (!inner || sec.classList.contains("raw") === on) return;
  let view = inner.querySelector(":scope > .raw-sheet");
  if (on) {
    // The sheet keeps the height the page had, so the pages below it stay put.
    const h = inner.getBoundingClientRect().height;
    if (!view) {
      view = document.createElement("div");
      view.className = "raw-sheet";
      const tag = document.createElement("div");
      tag.className = "raw-tag";
      const pre = document.createElement("pre");
      pre.className = "raw-text";
      view.append(tag, pre);
      inner.appendChild(view);
    }
    view.style.minHeight = h > 0 ? h + "px" : "";
    sec.classList.add("raw");
    rawPages.add(sec);
    fillRaw(sec);
  } else {
    if (view) view.remove();
    sec.classList.remove("raw");
    rawPages.delete(sec);
  }
  const b = sec.querySelector(":scope > .page-label .raw-page");
  if (b) setRawButton(b, on);
}
function toggleRaw(i) {
  const sec = pagesEl.querySelector(`.tpage[data-index="${i}"]`);
  if (!sec || sec.classList.contains("shed")) return;
  const on = !sec.classList.contains("raw");
  holdReading(); // the page changes size under the reading; the reading stays where it is
  setRaw(sec, on);
  // …and the PDF page off it, where it was showing one: the swap is undone
  // and forgotten, as ⇄ Text on it would.
  const t = on ? pdfTarget(i) : null;
  if (t && swaps.has(t.key)) { swaps.delete(t.key); persistSwaps(); applySwaps(); }
  textAnchors = null; textLineTops = null;
  if (gridOn()) applyMatchedLayout(); else shapePages();
  placeCitations(); // a raw page's text carries no underlines; back as text, it does again
  autoRemeasure();
}

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
// What a tab would lose if it went: the shell asks before closing one, and
// moves one to a window of its own only with nothing unsaved — a document
// unsaved anywhere in the folder, a decision not yet written (a flag, a keep,
// a LEAKS answer, a name said to be faked, a Master Keep removal). Removing
// the shell's iframe fires no unload, so this is the only question it gets.
window.__textReaderHasUnsaved = () => hasUnsaved();
// The documents with unsaved edits, and where each is: on the reel, or in the store.
window.__textReaderUnsaved = () => [
  ...reel.filter((m) => m.dirty).map((m) => ({ name: m.name, where: "reel", conflict: !!m.conflict })),
  ...[...unsavedDocs.values()].map((e) => ({ name: e.name, where: "store", conflict: !!e.conflict })),
];
// …and the folder replaces held for undo.
window.__textReaderJournal = () => replaceJournal.map((r) => ({
  id: r.id, q: r.q, withText: r.withText, state: r.state,
  docs: r.docs.map((x) => ({ name: x.name, written: x.writtenText != null })),
}));
// …and what to open in that new window: the document on screen (which may be
// one this reader opened itself, from Documents or its own picker), its file
// and the case folder it came from.
window.__textReaderSource = () => ({ file: openedFile && openedFile.name === fileName ? openedFile : null, handle: fileHandle, dir: dirHandle });
window.__textReaderReflow = () => { if (doc) placeCitations(); };
window.__pdfViewerUnregister = () => {};
// For the smoke test: the geometry the side-by-side sync reads.
window.__textReaderSyncGeometry = () => ({ text: textGeometry(), pdf: pdfGeometry() });
window.__textReaderSetKey = (parsed) => setKey(parsed);
// …and the leak worksheet's: attach, walk, decide, and the bytes a save
// would write (verified, not written), so the round trip into PDF-Linker's
// own reader can be checked from outside.
window.__textReaderLoadKey = (bytes, name) => loadKeyFromBytes(new Uint8Array(bytes), name, "", { quiet: true, owner: handOwner() });
window.__textReaderAttachLeaks = (bytes, name) => attachLeaks(new Uint8Array(bytes), name, null, { quiet: true });
window.__textReaderGoToLeak = (i) => goToLeak(i);
window.__textReaderDecide = (text, advance) => decideLeak(text, { advance: !!advance });
window.__textReaderLeaks = () => (leaks ? {
  at: leaks.at, barHidden: leaksBar.hidden, dirty: leaksDirty(),
  rows: leaks.parsed.rows.map((r) => ({ n: r.n, value: r.value, fix: r.fix, fix0: r.fix0 })),
  here: leakHere ? { text: leakHere.toString(), gutter: gutterOf(leakHere), page: Number(leakHere.startContainer.parentElement.closest(".tpage").dataset.index) } : null,
  marks: leakRowRanges.length, keeps: keeps.slice(), leakMarks: leakHits.length,
  pendingMarks: pendingSheetRanges().map((r) => r.toString()),
} : null);
window.__textReaderLeaksBytes = async () => Array.from(await XW.writeSheetCells(leaks.bytes, leaks.parsed.part, LK.fixEdits(leaks.parsed)));
window.__textReaderAdoptFolder = (h, opts) => adoptFolder(h, Object.assign({ quiet: true }, opts));
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
// …and attached by its handle, as Load master workbook… attaches it (written in
// place on a removal, read again where a run changed it).
window.__textReaderAdoptMaster = (handle) => adoptMaster(handle);
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
// read — the whole point of them is that nobody has to be asked again. Kept,
// so a question put to the workbook early waits for it (masterSettled).
masterRestoring = restoreMaster();
