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
//
// The decisions are in viewer/textdoc.js and viewer/pseudo-key.js (tested
// from Node); this file is the DOM around them.

import "./web-shim.js";
import { findAllCitations, resolveUrl } from "./citation-linker.js";
import { createToaPanel } from "./toa.js";
import { parseXlsx } from "./xlsx-read.js";
import * as PK from "./pseudo-key.js";
import * as TD from "./textdoc.js";

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
const SETTINGS_KEY = "textReader.settings";
const KEYS_KEY = "textReader.keys";
const VALUES_PREFIX = "textReader.values.";
const MAX_KEYS = 12;

let doc = null;              // TD.parseExport result
let fileName = "";
let fileHandle = null;       // FileSystemFileHandle for in-place save
let dirHandle = null;        // the case folder, when one was opened
let folderName = "";
let folderDocs = [];         // [{ name, handle, quarantined }]
let key = null;              // parsed key (PK.parseKey)
let rev = null, fwd = null, reals = null; // compiled matchers
let settings = loadSettings();
let flagged = [];            // New Real Values list
let dirty = false;
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
function loadSettings() { return TD.normalizeSettings(lsGet(SETTINGS_KEY, null)); }
function saveSettings() { lsSet(SETTINGS_KEY, settings); }

function applySettings() {
  const root = document.documentElement.style;
  root.setProperty("--reader-font", TD.fontCss(settings));
  root.setProperty("--reader-size", settings.fontSize + "px");
  root.setProperty("--reader-lh", String(settings.lineHeight));
  root.setProperty("--reader-width", settings.pageWidth + "px");
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
$("panel-toggle").addEventListener("click", () => {
  const hidden = document.body.classList.toggle("side-hidden");
  $("panel-toggle").setAttribute("aria-pressed", String(!hidden));
  relayout();
});
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

function setKey(parsed) {
  key = parsed || null;
  rev = key ? PK.compile(key) : null;
  fwd = key ? PK.compileForward(key) : null;
  reals = key ? PK.compileReals(key) : null;
  $("st-key").textContent = key ? "Key: " + PK.keyTitle(key) + (key.dropped.ambiguous ? ` (${key.dropped.ambiguous} ambiguous fake${key.dropped.ambiguous === 1 ? "" : "s"} retired)` : "") : "";
  if (doc) retranslate();
}

keySelect.addEventListener("change", () => {
  const lib = keyLibrary();
  setKey(keySelect.value ? lib[keySelect.value] : null);
});

async function loadKeyFromBytes(bytes, name, folder) {
  const wb = await parseXlsx(bytes);
  if (!PK.sheetsLookLikeKey(wb.sheets)) throw new Error(`${name} has no "Real Value" / "Replacement" header — not a pseudonym key.`);
  const parsed = PK.parseKey(wb.sheets, name);
  const id = storeKey(parsed, folder);
  fillKeySelect(id);
  setKey(keyLibrary()[id]);
  toast(`Key loaded: ${PK.keyTitle(key)} — ${key.pairs.length} reversible binding${key.pairs.length === 1 ? "" : "s"}` +
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

// ── opening documents ───────────────────────────────────────────────────────────
async function openFile(file, handle) {
  if (!file) return;
  if (dirty && !confirm("Discard unsaved edits to " + fileName + "?")) return;
  const text = await file.text();
  openText(text, file.name, handle || null);
}

function openText(text, name, handle) {
  doc = TD.parseExport(text);
  fileName = name;
  fileHandle = handle;
  dirty = false;
  document.title = name + " — Text Reader";
  if (!dirHandle) loadValuesFor(name);
  render();
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
  dirHandle = h;
  folderName = h.name;
  folderDocs = [];
  let keyHandle = null, valuesHandle = null, textDir = null;
  const rootDocs = [];
  for await (const [name, entry] of h.entries()) {
    if (entry.kind === "file") {
      if (TD.isKeyName(name) && !keyHandle) keyHandle = entry;
      else if (name.toLowerCase() === TD.VALUES_FILE.toLowerCase()) valuesHandle = entry;
      else if (TD.isExportName(name)) rootDocs.push({ name, handle: entry, quarantined: TD.isQuarantinedName(name) });
    } else if (entry.kind === "directory" && name.toLowerCase() === TD.TEXT_SUBFOLDER.toLowerCase()) {
      textDir = entry;
    }
  }
  if (textDir) {
    for await (const [name, entry] of textDir.entries()) {
      if (entry.kind === "file" && TD.isExportName(name)) folderDocs.push({ name, handle: entry, quarantined: TD.isQuarantinedName(name) });
    }
  }
  // Under the older single-folder layout the exports sit in the case folder
  // itself; with a Text Files folder present, a root .txt is somebody's note.
  if (!folderDocs.length) folderDocs = rootDocs;
  folderDocs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  if (keyHandle) {
    try {
      const f = await keyHandle.getFile();
      await loadKeyFromBytes(new Uint8Array(await f.arrayBuffer()), f.name, folderName);
    } catch (e) { toast("The folder's key could not be read: " + (e.message || e), { error: true }); }
  } else {
    toast("No pseudonym_key.xlsx in " + folderName + " — the documents will read in their fakes.");
  }
  // The flagged list on disk is the durable one; anything remembered here for
  // this folder is merged in.
  flagged = lsGet(VALUES_PREFIX + folderName, []);
  if (valuesHandle) {
    try {
      const onDisk = TD.parseValuesFile(await (await valuesHandle.getFile()).text());
      for (const v of onDisk) flagged = TD.addValue(flagged, v);
    } catch { /* unreadable: the in-memory list stands */ }
  }
  persistValues();
  renderFlags();
  renderDocList();
  if (folderDocs.length) {
    const first = folderDocs.find((d) => d.quarantined) || folderDocs[0];
    await openFolderDoc(first);
  } else {
    doc = null; pagesEl.hidden = true; emptyEl.hidden = false;
    toast("No text exports in " + folderName + (textDir ? "" : " (no Text Files folder)"), { error: true });
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
      sec.appendChild(lab);
    }
    const inner = document.createElement("div");
    inner.className = "page-inner";
    const body = document.createElement("div");
    body.className = "page-body";
    body.contentEditable = "plaintext-only";
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
  return span;
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
const relayout = debounce(() => { placeCitations(); }, 150);
window.addEventListener("resize", relayout);

function updateCounts() {
  const n = pagesEl.querySelectorAll(".pn").length;
  $("st-pn").textContent = key ? `${n} pseudonym${n === 1 ? "" : "s"} shown as real names` : "";
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
  saveBtn.disabled = !doc;
  $("st-dirty").textContent = dirty ? "● Unsaved edits" : "";
}
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
  const segs = plainSegments(body);
  const hits = TD.findRealsInPlain(fwd, segs);
  // Last hit first, so the offsets of the earlier ones in the same node
  // stay valid as the node is split.
  hits.reverse();
  let made = 0;
  for (const h of hits) {
    if (h.node === caretNode && caretOff >= h.start && caretOff <= h.end) continue;
    const node = h.node;
    if (!node.isConnected) continue;
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
      const runs = PK.forwardRuns(fwd, text);
      if (runs.some((r) => r.t === "swap")) {
        text = runs.map((r) => (r.t === "swap" ? r.to : r.s)).join("");
        forwarded += runs.filter((r) => r.t === "swap").length;
        buildBody(body, text);
      }
    }
    doc.pages[i].lines = text.split("\n");
  });
  const out = TD.serializeExport(doc);
  // The standing assertion. Nothing above should let a bound real value
  // through, and if something did the save must not.
  if (reals) {
    const left = PK.findReals(reals, out);
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
      for (const h of TD.findRealsInPlain(fwd, segs)) {
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
  const touches = !!(frag.querySelector && frag.querySelector(".pn")) ||
    !!(range.startContainer.parentElement && range.startContainer.parentElement.closest(".pn")) ||
    !!(range.endContainer.parentElement && range.endContainer.parentElement.closest(".pn"));
  return { text: sel.toString(), touches, range };
}

const showFlagPopSoon = debounce(showFlagPop, 120);
document.addEventListener("selectionchange", showFlagPopSoon);
function showFlagPop() {
  const s = currentSelection();
  if (!s) { flagPop.hidden = true; return; }
  const problem = TD.flagProblem(s.text, s.touches);
  flagPopBtn.disabled = !!problem;
  flagPopNote.textContent = problem || "";
  const rects = s.range.getClientRects();
  const r = rects.length ? rects[rects.length - 1] : s.range.getBoundingClientRect();
  flagPop.hidden = false;
  const w = flagPop.offsetWidth;
  flagPop.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, r.right + 8)) + "px";
  flagPop.style.top = Math.max(toolbar.offsetHeight + 4, r.bottom + 6) + "px";
}
flagPopBtn.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
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
  document.body.classList.remove("side-hidden");
  $("panel-toggle").setAttribute("aria-pressed", "true");
  showSideTab("tab-flags");
  toast(flagged.length > before ? `Flagged "${v}" — ${flagged.length} value${flagged.length === 1 ? "" : "s"} to hand to PDF-Linker` : `"${v}" is already flagged`);
}

function valuesStoreKey() { return VALUES_PREFIX + (folderName || fileName || "loose"); }
function loadValuesFor() { flagged = lsGet(valuesStoreKey(), []); renderFlags(); }
function persistValues() { lsSet(valuesStoreKey(), flagged); }

function renderFlags() {
  flagsList.innerHTML = "";
  flagCount.textContent = String(flagged.length);
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
  if (!flagged.length) { toast("Nothing flagged yet — select an unfaked name and press Flag.", { error: true }); return; }
  const text = TD.formatValuesFile(flagged);
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
      toast(`Wrote ${TD.VALUES_FILE} (${flagged.length} value${flagged.length === 1 ? "" : "s"}) into ${folderName} — run PDF-Linker or Apply Leak Fixes to pseudonymize them.`);
      return;
    } catch (e) {
      toast("Could not write into the folder (" + (e.message || e) + ") — choose where to save.", { error: true });
    }
  }
  await writeText(text, TD.VALUES_FILE, null);
}
$("flags-save").addEventListener("click", saveValuesFile);
$("flags-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(flagged.join("\n") + "\n"); toast("Copied " + flagged.length + " value" + (flagged.length === 1 ? "" : "s")); }
  catch { toast("Copy failed", { error: true }); }
});

// ── hooks for the PWA tab shell ───────────────────────────────────────────────────────
window.__textReaderLoadLocal = (file, handle) => openFile(file, handle);
window.__textReaderReflow = () => { if (doc) placeCitations(); };
window.__pdfViewerUnregister = () => {};

// ── boot ───────────────────────────────────────────────────────────────────────────────────
applySettings();
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
