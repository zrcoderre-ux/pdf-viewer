// Viewer entry point. Renders the PDF with PDF.js, ingests text from every
// page into the citation linker, runs document-wide detection (so supra
// references can be resolved across pages), then places clickable overlays
// on each page's link layer.

import * as pdfjsLib from "../pdfjs/build/pdf.mjs";
import {
  resetDocument,
  ingestPage,
  runDetection,
  placeLinksForPage,
  getAuthorities,
} from "./citation-linker.js";
import { createToaPanel } from "./toa.js";
import {
  clearAllHighlights,
  attachHighlightHandlers,
  repaintHighlightsForPage,
  getHighlightRectGroups,
  addImportedHighlight,
} from "./highlights.js";
import { buildEditedPdf, applyPagePlan, stampBates, stampHeaderFooter, stampWatermark, splitPdf, appendImagesAsPages, fillForm, hasFormFields } from "./pdf-edit.js";
import { extractTitle } from "./footer-naming.js";
import {
  registerEntry,
  unregisterEntry,
  onCollisionUpdate,
  computeDisplayForThisTab,
} from "./disambiguation.js";
import {
  getOverride,
  setOverride,
  onOverrideChange,
} from "./naming-override.js";
import {
  pageNeedsOcr,
  ocrPageToTextLayer,
  resetOcr,
} from "./ocr.js";

// ---------------------------------------------------------------------------
// Web (PWA) shim. This is the citation-linking viewer from the Chrome
// extension. When it is served as a hosted page instead — the installed PWA on
// GitHub Pages — the `chrome.*` extension APIs don't exist. Define a minimal
// shim, backed by Web Storage, so the identical viewer code runs unchanged in
// both places. Inside the extension `chrome.storage` exists and this whole
// block is skipped, so extension behavior is untouched.
if (typeof chrome === "undefined" || !(chrome && chrome.storage)) {
  const ROOT = new URL("../", import.meta.url).href; // dir holding viewer/ & pdfjs/
  const listeners = [];
  const notify = (changes, area) => {
    if (!changes || !Object.keys(changes).length) return;
    for (const fn of listeners) {
      try { fn(changes, area); } catch (e) { console.error(e); }
    }
  };
  const makeArea = (store, areaName) => {
    const read = (k) => {
      const raw = store.getItem(k);
      if (raw == null) return undefined;
      try { return JSON.parse(raw); } catch { return undefined; }
    };
    return {
      get(query, cb) {
        const out = {};
        if (query == null) {
          for (let i = 0; i < store.length; i++) { const k = store.key(i); out[k] = read(k); }
        } else if (typeof query === "string") {
          const v = read(query); if (v !== undefined) out[query] = v;
        } else if (Array.isArray(query)) {
          for (const k of query) { const v = read(k); if (v !== undefined) out[k] = v; }
        } else {
          for (const k of Object.keys(query)) { const v = read(k); out[k] = v === undefined ? query[k] : v; }
        }
        if (cb) return void cb(out);
        return Promise.resolve(out);
      },
      set(items, cb) {
        const changes = {};
        for (const k of Object.keys(items)) {
          const oldValue = read(k);
          store.setItem(k, JSON.stringify(items[k]));
          changes[k] = { oldValue, newValue: items[k] };
        }
        notify(changes, areaName);
        if (cb) return void cb();
        return Promise.resolve();
      },
      remove(keys, cb) {
        const arr = Array.isArray(keys) ? keys : [keys];
        const changes = {};
        for (const k of arr) { const oldValue = read(k); store.removeItem(k); changes[k] = { oldValue, newValue: undefined }; }
        notify(changes, areaName);
        if (cb) return void cb();
        return Promise.resolve();
      },
    };
  };
  // `session` is backed by an in-memory store, not sessionStorage: when several
  // viewer instances run as sibling iframes (the PWA's tab bar) they share one
  // origin's sessionStorage, which would make their per-document session state
  // collide. In-memory keeps each viewer instance isolated. `local`/`sync` stay
  // on localStorage so settings persist and are shared across tabs.
  const memStore = (() => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, v); },
      removeItem: (k) => { m.delete(k); },
      get length() { return m.size; },
      key: (i) => Array.from(m.keys())[i],
    };
  })();
  const SYNTH_TAB_ID = 1; // one logical "tab" per viewer instance (per iframe)
  window.chrome = {
    runtime: { getURL: (p) => new URL(String(p).replace(/^\/+/, ""), ROOT).href },
    storage: {
      local: makeArea(localStorage, "local"),
      sync: makeArea(localStorage, "sync"),
      session: makeArea(memStore, "session"),
      onChanged: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
      },
    },
    tabs: {
      getCurrent: (cb) => cb({ id: SYNTH_TAB_ID }),
      query: (_q, cb) => cb([{ id: SYNTH_TAB_ID }]),
      remove: () => {},
    },
  };
}

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
  "pdfjs/build/pdf.worker.mjs"
);

const params = new URLSearchParams(location.search);
const fileUrl = params.get("file");
// Local-disk PDFs (file://) default to the source filename even when the global
// preference is "footer" — they're usually already named sensibly and footer
// extraction on them tends to be noise.
const isLocalFile = /^file:/i.test(fileUrl || "");

const filenameEl  = document.getElementById("filename");
const statusEl    = document.getElementById("status");
const linkCountEl = document.getElementById("link-count");
const providerEl  = document.getElementById("provider");
const namingModeEl = document.getElementById("naming-mode");
const pagesEl     = document.getElementById("pages");
const zoomInEl    = document.getElementById("zoom-in");
const zoomOutEl   = document.getElementById("zoom-out");
const downloadEl  = document.getElementById("download");
const openOriginalEl = document.getElementById("open-original");
const ocrRunEl    = document.getElementById("ocr-run");
const saveEditsEl = document.getElementById("save-edits");
const combineEl   = document.getElementById("combine-pdfs");
const organizeEl  = document.getElementById("organize-pages");
const batesEl     = document.getElementById("bates-number");
const headerFooterEl = document.getElementById("headerfooter-btn");
const watermarkEl = document.getElementById("watermark-btn");
const splitEl     = document.getElementById("split-btn");
const imagesEl    = document.getElementById("images-btn");
const editMenuBtn  = document.getElementById("edit-menu-btn");
const editMenuEl   = document.getElementById("edit-menu");
const editMenuWrap = document.getElementById("edit-menu-wrap");
const zoomLevelEl = document.getElementById("zoom-level");
const highlightToggleEl = document.getElementById("highlight-toggle");
const rectSelectToggleEl = document.getElementById("rect-select-toggle");
const pageIndicatorEl  = document.getElementById("page-indicator");

let currentScale = 1.5;
let totalLinks = 0;
// pageNumber -> PDF page height in points; used to map screen highlight rects
// into PDF coordinates when saving an edited copy.
const pageHeightPtsByNum = new Map();
let pdfDoc = null;
let provider = "lexis";
let citationRepo = {};
// Shared Table of Authorities panel (off when the user disables it in Options).
const toaPanel = createToaPanel({
  providerLabel: (p) => (p === "westlaw" ? "Westlaw" : "Lexis+"),
  // Sit just below the fixed toolbar (claude.ai keeps the default top).
  top: "calc(var(--toolbar-height, 48px) + 8px)",
});
// OCR runs on scanned pages only when enabled. Default is manual (the toolbar
// "OCR" button); the auto-OCR option flips the default to on.
let ocrEnabled = false;
// Raw bytes of the loaded PDF, stashed during loadAndRender so the Download
// button doesn't have to re-fetch from the server. eCMS-style URLs are slow
// and sometimes single-use; the second fetch failing was the source of the
// occasional "Failed to fetch" alert from the Download handler.
let pdfBytes = null;
// AbortController for the in-flight renderAllPages loop. The Download handler
// aborts before saving so PDF.js stops chewing through pages the user is no
// longer waiting on. Checking signal.aborted between pages is enough — we
// don't try to interrupt mid-page (one getPage/render is already in flight).
let renderAbort = null;
// Promise that resolves once renderAllPages has had a chance to extract the
// footer-derived title (after pages 1–2). The Download handler awaits this
// so a click during early rendering still gets the smart filename. Resolves
// whether or not a title was actually found — caller falls back gracefully.
let footerTitleResolved = null;
let _resolveFooterTitle = null;
// Highlight mode: when true, drag-selecting text on a page captures a
// yellow highlight on mouseup. When false (the default), drag-select
// produces a normal browser text selection that the user can copy with
// Ctrl+C — no highlight is created. Toggled by the toolbar button.
let highlightMode = false;
// Rectangle-select tool: when on, a left-drag sweeps a marquee box instead of
// a flowing text selection. Alt+drag does the same regardless of this toggle.
let rectSelectMode = false;
// Random id for this document's PDF-history entry, so the session can update
// its final name later without storing (or keying on) the document URL.
let currentHistoryId = null;
// Filename resolved from the server's Content-Disposition header, if any.
// This wins over any URL-derived guess (e-court URLs like
// "/PublicCaseAccess/CaseDocument?docId=123" don't carry a usable name).
let serverFilename = null;

// True once the user has manually edited the filename via the toolbar's
// click-to-rename affordance. Suppresses programmatic overwrites from later
// footer extraction or Content-Disposition reads — once you've named it,
// it stays named. Reset on each new PDF load.
let userOverrodeName = false;

// User preference for filename source. Two layers:
//   globalNamingMode  — the user's default, set in popup/options page.
//                       Lives in chrome.storage.sync.
//   perDocOverride    — per-document override, set via the toolbar
//                       dropdown. Keyed by file URL in chrome.storage.session.
//                       Survives a tab reload, dies when Chrome closes.
//   namingMode        — effective mode, derived as perDocOverride ?? globalNamingMode.
//                       This is what all the rendering logic reads.
// When the user has not set a per-doc override, the toolbar mirrors the
// global; setting one in the toolbar is what creates the override.
let globalNamingMode = "source";
let perDocOverride = null;
let namingMode = "source";

// Recompute the effective mode and (if it changed) re-paint. Called
// from anywhere a layer above might have updated.
function resolveEffectiveNamingMode() {
  // A per-document override (toolbar dropdown) always wins; otherwise local
  // files fall back to "source" regardless of the global default.
  const baseDefault = isLocalFile ? "source" : globalNamingMode;
  const next = perDocOverride || baseDefault;
  if (next === namingMode) return false;
  namingMode = next;
  return true;
}

// Footer extraction is run regardless of namingMode (so flipping the
// toggle is instant, no re-render needed). Cached here:
//   { displayName, canonical, target, party } | null
// Populated by tryResolveFooterTitle when pages 1-2 are done. Consumed
// by applyNamingMode and the cross-tab collision listener.
let footerExtraction = null;

// Source-derived display name (URL-based or Content-Disposition). Cached
// so we can switch back to it when namingMode flips from "footer" to
// "source" without re-running anything.
let sourceDisplayName = "";
// Raw source filename (extension stripped), kept so the source name can be
// recomputed when the "apply naming rules to source" option toggles.
let sourceRawName = "";
// When true, the source filename is run through the same name-altering rules
// as footer titles; when false (default), the raw source name is shown as-is.
let alterSource = false;

// Derive the source display name from the raw filename, honoring alterSource.
function computeSourceDisplay(rawNoExt) {
  if (alterSource) return simplifyName(rawNoExt) || rawNoExt || "PDF";
  return rawNoExt || "PDF";
}

// Best-effort filename derived purely from the URL. Used as fallback only.
//
// E-court URLs vary wildly — sometimes the real .pdf filename is the last
// path segment ("/.../Britton_Decl.pdf"), sometimes it's hidden in a query
// param ("?file=Britton_Decl.pdf&id=123"), and sometimes the path ends in a
// generic route ("/PublicCaseAccess/CaseDocument") with the docId in the
// query. We try, in order:
//   1. A .pdf-looking token anywhere in the path or query string.
//   2. The last non-empty path segment (even without an extension), as long
//      as it doesn't look like a server-side script name (.aspx/.php/.jsp).
//   3. Empty string — caller falls back to "document".
function filenameFromUrl(url) {
  if (!url) return "";
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return decodeURIComponent(url.split("/").pop().split("?")[0] || "");
  }

  // 1. Scan path AND every query-string value for a .pdf-looking token.
  //    A token is a run of non-/?&= characters ending in .pdf (case-insens).
  const haystacks = [parsed.pathname];
  for (const [, v] of parsed.searchParams) haystacks.push(v);
  const pdfRe = /([^\/\\?&=#]+\.pdf)(?:[?#]|$)/i;
  for (const h of haystacks) {
    let decoded;
    try { decoded = decodeURIComponent(h); } catch { decoded = h; }
    const m = pdfRe.exec(decoded);
    if (m) return m[1];
  }

  // 2. Last non-empty path segment, even without an extension. Skip
  //    obvious server-side script names — those won't make a good filename
  //    and the user would rather see "document" than "CaseDocument.aspx".
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length) {
    let last;
    try { last = decodeURIComponent(segments[segments.length - 1]); }
    catch { last = segments[segments.length - 1]; }
    if (last && !/\.(aspx|asp|php|jsp|do|cgi|html?)$/i.test(last)) {
      return last;
    }
  }

  return "";
}

// Parse a filename out of a Content-Disposition header value. Handles both
// the modern RFC 5987 `filename*=UTF-8''...` form and the legacy
// `filename="..."` form. Returns "" if nothing usable is found.
function filenameFromContentDisposition(headerValue) {
  if (!headerValue) return "";
  // RFC 5987 extended form takes priority — it's how non-ASCII names are sent.
  const ext = /filename\*\s*=\s*([^;]+)/i.exec(headerValue);
  if (ext) {
    let v = ext[1].trim();
    // Format: charset'language'percent-encoded-value
    const m = /^([^']*)'[^']*'(.*)$/.exec(v);
    if (m) {
      try {
        return decodeURIComponent(m[2].replace(/^"|"$/g, ""));
      } catch {
        return m[2].replace(/^"|"$/g, "");
      }
    }
    return v.replace(/^"|"$/g, "");
  }
  const basic = /filename\s*=\s*("([^"]*)"|([^;]+))/i.exec(headerValue);
  if (basic) {
    return (basic[2] || basic[3] || "").trim();
  }
  return "";
}

// Strip anything that would make a filename invalid on Windows/macOS, and
// make sure it ends in .pdf.
function sanitizePdfFilename(name) {
  if (!name) return "document.pdf";
  let n = name.replace(/[\\/:*?"<>|\r\n]+/g, "_").trim();
  if (!/\.pdf$/i.test(n)) n += ".pdf";
  return n;
}

// --- Footer title extraction --------------------------------------------
//
// California court filings (and most court filings generally) repeat the
// document title in a running footer on every page — e.g.
//     REPLY TO PLAINTIFF'S SEPARATE STATEMENT OF GENUINE DISPUTES
// This is gold for filename recovery when the URL and Content-Disposition
// header are both useless (e-court does this a lot). We extract it by:
//
//   1. Looking at the bottom ~15% of pages 1 and 2.
//   2. Grouping text items into visual lines by y-coordinate.
//   3. Keeping lines that are mostly UPPERCASE and reasonably long.
//   4. Picking the line that appears in BOTH pages' footer regions (the
//      running footer), or — failing that — the longest uppercase line on
//      page 1's footer.
//
// We deliberately ignore page numbers, attorney block info, and bates
// stamps because they're either short, mixed case, or vary page-to-page.

// Group PDF.js text items into lines by their y position. Returns an
// array of {y, text} sorted top-to-bottom in PDF coordinates (smaller y
// = bottom of page in PDF.js item transform).
function groupItemsIntoLines(items) {
  // PDF.js item.transform is [a, b, c, d, e, f] where (e, f) is position.
  // We bin items by f (y) within a small tolerance. Items with empty/
  // whitespace-only text are skipped.
  const rows = [];
  const tol = 2; // pixels of vertical tolerance for "same line"
  for (const it of items) {
    const t = (it.str || "").trim();
    if (!t) continue;
    const y = it.transform ? it.transform[5] : 0;
    const x = it.transform ? it.transform[4] : 0;
    let row = rows.find(r => Math.abs(r.y - y) <= tol);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, text: it.str });
  }
  // Within each row, sort items left-to-right and join. We avoid inserting
  // a space when the next item starts with punctuation that "hugs" the
  // preceding word (apostrophes, commas, periods) — court PDFs commonly
  // emit "Plaintiff" and "'s" as separate text items.
  return rows.map(r => {
    r.items.sort((a, b) => a.x - b.x);
    let text = "";
    let lastEnd = -Infinity;
    for (const it of r.items) {
      const t = it.text;
      const startsWithHugger = /^['’,.;:!?)]/.test(t);
      const endsWithOpener = /[(\[]$/.test(text);
      if (text && it.x - lastEnd > 5 && !startsWithHugger && !endsWithOpener) {
        text += " ";
      }
      text += t;
      lastEnd = it.x + (t.length * 4); // rough; only used for spacing
    }
    return { y: r.y, text: text.replace(/\s+/g, " ").trim() };
  }).filter(r => r.text);
}

// Return the lines that fall within the bottom `bottomFrac` of the page,
// in normalized form suitable for comparison.
function footerLines(textContent, viewport, bottomFrac = 0.18) {
  const pageHeight = viewport ? viewport.height : 0;
  if (!pageHeight) return [];
  // PDF.js text item y is in PDF coordinates: (0,0) is bottom-left, so
  // "footer" means SMALL y values. The viewport height in user-space units
  // matches the coordinate system of item.transform[5] when no scale is
  // applied to getTextContent (which is the default).
  const cutoff = pageHeight * bottomFrac;
  const all = groupItemsIntoLines(textContent.items || []);
  return all.filter(r => r.y < cutoff);
}

// A line is a plausible title if it's mostly uppercase letters, has a
// reasonable length, and doesn't look like a page number or attorney info.
function looksLikeTitle(text) {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 12 || t.length > 200) return false;
  // Reject lines that are mostly digits/punctuation (page numbers, dates).
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length < 8) return false;
  // Reject lines with more than two lowercase letters in a row — running
  // footers in court filings are written in caps. ("Plaintiff's" has one
  // lowercase 's', which is fine; "Page 3 of 7" has many.)
  const lowerRuns = t.match(/[a-z]{3,}/g);
  if (lowerRuns && lowerRuns.length > 0) return false;
  // Reject obvious page-number patterns.
  if (/^\s*(page\s+)?\d+\s*(of\s+\d+)?\s*$/i.test(t)) return false;
  return true;
}

// Normalize a line for cross-page comparison. We strip whitespace entirely
// (so "PLAINTIFF 'S" matches "PLAINTIFF'S"), drop trailing page-number
// suffixes, and uppercase. Aggressive normalization is fine because we
// only use this for matching, not display.
function normalizeLine(text) {
  return text
    .replace(/\s*[-–—]?\s*page\s+\d+(\s+of\s+\d+)?\s*$/i, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

// Pick the best title from page 1's footer, optionally cross-checked
// against page 2's footer for a running-footer match. Returns "" if
// nothing plausible is found.
//
// Multi-line footer support: court filings sometimes wrap the document
// title across two or three lines in the footer ("DECLARATION OF
// DANIEL FISHER ... IN" / "SUPPORT OF PLAINTIFF'S OPPOSITION ..."). We
// detect adjacent title-candidate lines by their vertical proximity and
// concatenate them in reading order before returning. Without this, the
// rule engine sees only the first line and mis-classifies multi-line
// titles (e.g. a declaration ISO opposition gets classified as bare
// "Decl." because the "IN SUPPORT OF" clause is on the next line).
function chooseTitleFromFooters(page1Lines, page2Lines) {
  if (page1Lines.length === 0) return "";
  // Two-stage filtering:
  //   1. PERMISSIVE per-line filter: drop obvious junk (page numbers,
  //      lines with long lowercase runs that mark attorney/address text)
  //      but keep short or borderline lines that might be a continuation
  //      of a wrapped title on the next line.
  //   2. Group adjacent lines into multi-line title candidates.
  //   3. STRICT per-group filter: only keep groups that look like a
  //      whole title (proper length, mostly letters, etc).
  //
  // Filtering only with the strict predicate before grouping was the old
  // behavior; it dropped the second line of wrapped titles when that line
  // independently failed the heuristic (e.g. "SUPPORT OF PLAINTIFF'S
  // OPPOSITION..." can in some PDFs be split across more than one item).
  const permissive = page1Lines.filter(l => couldBeTitleLine(l.text));
  const grouped = groupAdjacentTitleLines(permissive);
  const cands1 = grouped.filter(g => looksLikeTitle(g.text));
  if (cands1.length === 0) return "";
  // Build a normalized array from page 2 for matching. We use containment
  // (substring either way) so that minor variations between pages — extra
  // case caption text, a page-number tail, soft hyphenation — don't break
  // the match.
  const page2Norms = (page2Lines || []).map(l => normalizeLine(l.text));
  function isRunning(line) {
    const n = normalizeLine(line.text);
    if (n.length < 12) return false;
    return page2Norms.some(p2 => p2.includes(n) || n.includes(p2));
  }
  const matched = cands1
    .filter(isRunning)
    .sort((a, b) => b.text.length - a.text.length);
  if (matched.length) return matched[0].text;
  // Fallback: longest plausible (grouped) title on page 1's footer alone.
  cands1.sort((a, b) => b.text.length - a.text.length);
  return cands1[0].text;
}

// Permissive per-line predicate. Lets through anything that could be a
// fragment of a wrapped title — even short fragments that look like
// "IN" or "SUPPORT OF" by themselves. Used BEFORE grouping, where the
// goal is to keep title pieces together; the strict `looksLikeTitle`
// check runs on the assembled group instead.
//
// Reject only obvious non-titles:
//   - Empty / very short non-letter lines (page numbers, dates).
//   - Lines with prose-shaped lowercase runs ≥ 4 chars (attorney text,
//     address blocks, narrative). Court-filing titles are all-caps;
//     the only common lowercase in them is "'s" possessives.
function couldBeTitleLine(text) {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;
  // Need at least 2 letters somewhere.
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return false;
  // Long lowercase runs disqualify (4+ chars = real word in prose).
  if (/[a-z]{4,}/.test(t)) return false;
  // Pure page-number / date lines.
  if (/^\s*(page\s+)?\d+\s*(of\s+\d+)?\s*$/i.test(t)) return false;
  return true;
}

// Group title-candidate lines that appear vertically adjacent in the
// footer band into multi-line title strings. Returns an array of
// { y, text } objects, where text may be a space-joined combination
// of multiple adjacent lines.
//
// Input lines come in arbitrary order from the line-extraction step.
// We sort by y descending (top-of-band first, since PDF y grows upward)
// and walk the sorted list, accumulating runs of lines whose y-gap is
// less than `maxGap` PDF units — that gap threshold is a multiple of
// typical line height for 10–12pt text.
//
// "Adjacent" here means visually close, not strictly consecutive in the
// page's text-item order. Two title lines from different footers (e.g.
// a page-number line between them) would not be grouped because they'd
// have a larger gap or would fail the looksLikeTitle filter and be
// excluded upstream.
function groupAdjacentTitleLines(lines) {
  if (lines.length === 0) return [];
  const maxGap = 20; // PDF units — ~1.5x line height at 12pt
  const sorted = [...lines].sort((a, b) => b.y - a.y); // top→bottom
  const groups = [];
  let cur = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curLine = sorted[i];
    const gap = prev.y - curLine.y; // positive because sorted desc
    if (gap >= 0 && gap <= maxGap) {
      cur.push(curLine);
    } else {
      groups.push(cur);
      cur = [curLine];
    }
  }
  groups.push(cur);
  return groups.map(g => ({
    y: g[0].y, // y of top line — used for sorting if needed
    text: g.map(l => l.text).join(" ").replace(/\s+/g, " ").trim(),
  }));
}

// ========== PDF Name Simplifier Logic (from pdf-renamer extension) ==========

// Words that stay lowercase (unless first, last, or after a break)
const LOWERCASE_WORDS = new Set([
  // Articles
  'a', 'an', 'the',
  // Coordinating conjunctions (FANBOYS)
  'for', 'and', 'nor', 'but', 'or', 'yet', 'so',
  // Prepositions of 4 letters or fewer
  'as', 'at', 'by', 'from', 'in', 'into', 'like', 'near', 'of', 'off',
  'on', 'onto', 'out', 'over', 'past', 'per', 'plus', 'than', 'thru',
  'till', 'to', 'up', 'upon', 'via', 'with', 'amid', 'anti', 're'
]);

// Protected acronyms — always rendered in their canonical form regardless
// of position. These are TRUE ACRONYMS / INITIALISMS whose canonical form
// is all-caps (each letter stands for a word, or the form is conventionally
// styled in caps).
const PROTECTED_ACRONYMS = new Map([
  ['fac',  'FAC'],  ['sac', 'SAC'],   ['tac',  'TAC'],  ['ceqa', 'CEQA'],
  ['cd',   'CD'],   ['ceo', 'CEO'],   ['iied', 'IIED'], ['llc',  'LLC'],
  ['llp',  'LLP'],  ['lp',  'LP'],    ['lllp', 'LLLP'], ['pc',   'PC'],
  ['gp',   'GP'],   ['feha','FEHA'],  ['iso',  'ISO'],  ['msj',  'MSJ'],
]);

// Graphical abbreviations whose canonical form is NOT all-caps — e.g. "Inc."
// is short for "Incorporated", not an initialism. These take their canonical
// form by default, BUT if the surrounding input is overall mixed-case and the
// user wrote the token in all-caps, we honor that intent and keep all-caps.
// (If the whole input is all-caps, all-caps carries no information, so we
// still emit canonical.)
const PROTECTED_ABBREVIATIONS = new Map([
  ['inc', 'Inc.'],
  ['mts', 'MtS'],
]);

// Statute-code DOTTED forms (Bluebook / CSM long-form-ish). These are
// contraction-style abbreviations like Inc. — each one truncates a single
// English word, not an initialism. They appear as part of phrases like
// "Civ. Code", "Code Civ. Proc.", "Bus. & Prof. Code", "Pen. Code § 273.5".
//
// Behavior parallels PROTECTED_ABBREVIATIONS: render canonical mixed-case
// by default, BUT if the surrounding input is mixed-case and the user wrote
// the token in all-caps, honor that intent.
//
// Match condition: the bare token (period stripped) must be in this map
// AND the original token must have ended with a period in the raw input.
// The trailing period is the signal that this is the contraction form
// rather than the all-caps initialism form (CCP, BPC, CIV-as-standalone).
const STATUTE_CODE_DOTTED_FORMS = new Map([
  ['civ',      'Civ.'],
  ['pen',      'Pen.'],
  ['evid',     'Evid.'],
  ['bus',      'Bus.'],
  ['prof',     'Prof.'],
  ['fam',      'Fam.'],
  ['gov',      'Gov.'],
  ['govt',     'Govt.'],
  ['saf',      'Saf.'],
  ['lab',      'Lab.'],
  ['prob',     'Prob.'],
  ['veh',      'Veh.'],
  ['welf',     'Welf.'],
  ['inst',     'Inst.'],
  ['corp',     'Corp.'],
  ['ins',      'Ins.'],
  ['rev',      'Rev.'],
  ['tax',      'Tax.'],
  ['educ',     'Educ.'],
  ['elec',     'Elec.'],
  ['fin',      'Fin.'],
  ['agric',    'Agric.'],
  ['agr',      'Agr.'],
  ['harb',     'Harb.'],
  ['nav',      'Nav.'],
  ['mil',      'Mil.'],
  ['vet',      'Vet.'],
  ['cont',     'Cont.'],
  ['contract', 'Contract.'],
  ['res',      'Res.'],
  ['util',     'Util.'],
  ['sts',      'Sts.'],
  ['hy',       'Hy.'],
  ['unemp',    'Unemp.'],
  ['wat',      'Wat.'],
  ['com',      'Com.'],
  ['proc',     'Proc.'],   // for "Code Civ. Proc."
]);

// Returns true if the raw input contains both meaningful upper and lower
// case letters — i.e. it's not "ALL CAPS" or "all lowercase" overall.
// Used to decide whether the user typing a single token in all-caps within
// a title carries intent (mixed-case context: yes) or is just the ambient
// style (all-caps context: no).
function isMixedCase(raw) {
  if (!raw) return false;
  const hasUpper = /[A-Z]/.test(raw);
  const hasLower = /[a-z]/.test(raw);
  return hasUpper && hasLower;
}

// Returns true if `bare` (already stripped of surrounding punctuation) was
// written entirely in uppercase letters in the raw input. Looks the word up
// via rawCasingMap (entries are objects with .original and .hadTrailingPeriod).
function wasOriginallyAllCaps(bare, rawCasingMap) {
  if (!rawCasingMap) return false;
  const entry = rawCasingMap.get(bare.toLowerCase());
  if (!entry) return false;
  const original = entry.original;
  return /^[^a-z]*$/.test(original) && /[A-Z]/.test(original);
}

// Returns true if `bare` was followed by a period in the raw input. Used by
// the dotted-statute-code rule, which fires only on the contraction form
// (Civ. Code) and not the bare initialism (CIV used standalone). The
// pipeline's pre-cleanup strips trailing periods from the whole string, so
// toTitleCase can't see the period directly — we stash this fact in the
// raw casing map at parse time.
function hadTrailingPeriodInRaw(bare, rawCasingMap) {
  if (!rawCasingMap) return false;
  const entry = rawCasingMap.get(bare.toLowerCase());
  return entry ? entry.hadTrailingPeriod : false;
}

// Returns true if a token looks like a dotted acronym: L.A., U.S.A., F.E.H.A.
function isDottedAcronym(tok) {
  if (tok.length < 2) return false;
  for (let i = 0; i < tok.length; i++) {
    if (i % 2 === 0) { if (!/[a-zA-Z]/.test(tok[i])) return false; }
    else             { if (tok[i] !== '.') return false; }
  }
  return true;
}

// Statute-code abbreviations from code-tables.js. Pulled in so a token like
// "BPC" or "CCP" inside a title is recognized as an acronym even when it's
// not in PROTECTED_ACRONYMS. This list is authoritative for legal codes.
const STATUTE_CODE_ACRONYMS = new Set([
  'bpc', 'com', 'civ', 'ccp', 'corp', 'edc', 'elec', 'evid', 'fam', 'fin',
  'fgc', 'fac', 'gov', 'hnc', 'hsc', 'ins', 'lab', 'mvc', 'pen', 'prob',
  'pcc', 'prc', 'puc', 'rtc', 'shc', 'uic', 'veh', 'wat', 'wic',
]);

// Doubled-letter pairs that DON'T signal an acronym in short words because
// they appear in common English words: "all"/"ill", "see"/"fee", "off"/"puff",
// "too", "add"/"odd", "egg", "ass"/"miss". We treat any other doubled letter
// in a short (≤5) token as an acronym signal — AA, BB, HH, JJ, KK, MM, NN,
// PP, RR, TT, VV, WW, XX, ZZ, plus CC, II, UU which are vanishingly rare in
// short English words. (Note: TT could appear in "putt"/"butt"/"matt" but
// those are uncommon enough that flagging them in a legal-doc title is
// acceptable; if it becomes an issue, add 'tt' here.)
const COMMON_ENGLISH_DOUBLES = new Set(['oo', 'ee', 'll', 'ss', 'dd', 'gg', 'ff']);

// Heuristic acronym detector — returns true if the token looks like an
// acronym based on its letter shape alone (i.e. without needing to see how
// it was capitalized in the input). Operates on the bare letters only;
// caller has already stripped surrounding punctuation.
//
// `wasAllCapsInRaw` is an optional flag: true when the token appeared in
// all-caps in the original input. Used by tier 4 (doubled-letter rule),
// which is too noisy on its own but solid when paired with positive
// all-caps evidence.
//
// Intentionally conservative: every rule here is one where the false-
// positive rate against ordinary English words is near zero. Order matters
// only for explanatory purposes; any hit returns true.
function looksLikeAcronymByShape(bare, wasAllCapsInRaw = false) {
  if (!bare || bare.length < 2) return false;
  const lower = bare.toLowerCase();

  // Tier 1: known statute-code acronym. Zero false positives by definition.
  if (STATUTE_CODE_ACRONYMS.has(lower)) return true;

  // Tier 2: short all-consonant token (≤5 letters, no a/e/i/o/u/y).
  // English words need vowels — this catches MSJ, MTS, BPC, MTD, PLF, etc.
  // "y" is counted as a vowel here so "TRY", "DRY", "WHY", "SKY", "FLY"
  // are excluded.
  if (bare.length <= 5 && /^[bcdfghjklmnpqrstvwxz]+$/i.test(bare)) {
    return true;
  }

  // Tier 3: mixed-case shape like MtS, PhD, McD, IoT — an uppercase letter,
  // one or two lowercase letters, then more uppercase. Essentially never
  // a real English word. Requires at least one uppercase on each side of
  // the lowercase island.
  if (/^[A-Z]+[a-z]{1,2}[A-Z]+$/.test(bare)) return true;

  // Tier 4: short token (≤5 letters) containing a doubled letter that
  // isn't one of the common English doublers — AND the user wrote it in
  // all-caps. The doubled-letter signal alone is too noisy: short common
  // English words are full of doubled rare letters ("apple", "happy",
  // "funny", "kitty", "dizzy", "hurry"). Pairing it with all-caps writing
  // gives positive evidence the user meant it as an acronym (e.g. "AAA",
  // "NAACP", "AAPL"). Without all-caps evidence we'd corrupt every
  // "Apple" in a title to "APPLE".
  if (wasAllCapsInRaw && bare.length <= 5) {
    for (let i = 0; i < bare.length - 1; i++) {
      const a = bare[i].toLowerCase();
      const b = bare[i + 1].toLowerCase();
      if (a === b && /[a-z]/.test(a) && !COMMON_ENGLISH_DOUBLES.has(a + b)) {
        return true;
      }
    }
  }

  return false;
}

// Build a map of lowercase-word → { original, hadTrailingPeriod } from the
// raw input. Used so that when a heuristic fires on a token in toTitleCase,
// we can preserve the user's original casing (MtS stays MtS) instead of
// forcing all-caps, AND so we can detect whether the user wrote the token
// with a trailing period in the raw input — needed because the pipeline's
// pre-cleanup strips trailing periods from the whole string, which means
// toTitleCase can't tell if "Proc" originally had a period or not.
//
// Words encountered multiple times keep the FIRST occurrence's casing —
// good enough for filenames where one casing dominates.
function buildRawCasingMap(raw) {
  const map = new Map();
  // Tokenize on the same rules as toTitleCase: words are runs of letters
  // (with possible internal periods/hyphens). We capture each token along
  // with whether it had a trailing period in the raw input.
  const tokens = raw.split(/[\s_]+/);
  for (const tok of tokens) {
    if (!tok) continue;
    // Look for the bare letter-run by stripping leading/trailing non-alpha,
    // and check whether the trailing punctuation included a period.
    const m = tok.match(/^([^a-zA-Z0-9]*)([a-zA-Z0-9.]+?)([^a-zA-Z0-9]*)$/);
    if (!m) continue;
    const trailRaw = m[3];
    const bareWithInternalDots = m[2];
    // Separate the trailing period from the bare word for our purposes.
    const trailingPeriod = bareWithInternalDots.endsWith('.');
    const bare = trailingPeriod
      ? bareWithInternalDots.slice(0, -1)
      : bareWithInternalDots;
    if (!bare || !/[a-zA-Z]/.test(bare)) continue;
    const key = bare.toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        original: bare,
        hadTrailingPeriod: trailingPeriod || trailRaw.includes('.'),
      });
    }
  }
  return map;
}

// Returns true if the token ends with a break that forces the next word to capitalize
function endsWithBreak(tok) {
  if (!tok) return false;
  const last = tok[tok.length - 1];
  if (last === ':') return true;
  if (last === '\u2014' || last === '\u2013') return true; // em/en dash
  if (tok.endsWith('--')) return true;
  return false;
}

function toTitleCase(str, rawCasingMap, rawInputIsMixedCase) {
  const tokens = str.split(/(\s+)/);
  const wordTokens = tokens.filter(t => !/^\s+$/.test(t) && t.length > 0);
  const totalWords = wordTokens.length;
  let wordIndex = 0;
  let capitalizeNext = true; // always capitalize first word

  return tokens.map(tok => {
    if (/^\s+$/.test(tok) || tok.length === 0) return tok;

    wordIndex++;
    const isFirst = wordIndex === 1;
    const isLast  = wordIndex === totalWords;

    // Dotted acronym — preserve exactly
    if (isDottedAcronym(tok)) {
      capitalizeNext = endsWithBreak(tok);
      return tok;
    }

    // Strip leading/trailing punctuation
    const leadMatch  = tok.match(/^[^a-zA-Z0-9]*/);
    const trailMatch = tok.match(/[^a-zA-Z0-9]*$/);
    const lead  = leadMatch  ? leadMatch[0]  : '';
    const trail = trailMatch ? trailMatch[0] : '';
    const bare  = tok.slice(lead.length, tok.length - trail.length);

    if (!bare) {
      capitalizeNext = endsWithBreak(tok);
      return tok;
    }

    // Check for connective hyphen
    const afterConnectiveHyphen = lead.endsWith('-') && !isFirst;

    const acronymKey = bare.toLowerCase();

    // True acronym (canonical form is all-caps): always emit canonical.
    if (PROTECTED_ACRONYMS.has(acronymKey)) {
      capitalizeNext = endsWithBreak(tok);
      return lead + PROTECTED_ACRONYMS.get(acronymKey) + trail;
    }

    // Graphical abbreviation (canonical form is NOT all-caps, e.g. "Inc.").
    // Default to canonical, BUT honor an explicit all-caps writing of the
    // token when the surrounding input is mixed-case (so the user's
    // all-caps choice carries intent rather than being ambient style).
    if (PROTECTED_ABBREVIATIONS.has(acronymKey)) {
      const canonical = PROTECTED_ABBREVIATIONS.get(acronymKey);
      const userWentAllCaps =
        rawInputIsMixedCase && wasOriginallyAllCaps(bare, rawCasingMap);
      capitalizeNext = endsWithBreak(tok);
      return lead + (userWentAllCaps ? bare.toUpperCase() : canonical) + trail;
    }

    // Statute-code DOTTED form (Bluebook/CSM short form, e.g. "Civ.",
    // "Pen.", "Bus.", "Veh."). These are contraction-style abbreviations,
    // not initialisms — canonical form is mixed-case. Two conditions to
    // fire: bare token (lowercased) is in the map AND the user wrote the
    // token with a trailing period in the RAW input. We can't just check
    // `trail` because Step 1 of simplifyName strips trailing periods from
    // the whole string before toTitleCase runs — so a "Proc." at the end
    // arrives here as "Proc" with no trail. The hadTrailingPeriodInRaw
    // helper consults the casing map (built from raw, before cleanup).
    //
    // The trailing period is what distinguishes the contraction form
    // ("Civ." in "Civ. Code") from the all-caps initialism form ("CIV"
    // used standalone, which gets caught by the heuristic detector below).
    // Same all-caps-intent override as PROTECTED_ABBREVIATIONS.
    if (
      STATUTE_CODE_DOTTED_FORMS.has(acronymKey) &&
      hadTrailingPeriodInRaw(bare, rawCasingMap)
    ) {
      const canonical = STATUTE_CODE_DOTTED_FORMS.get(acronymKey);
      const userWentAllCaps =
        rawInputIsMixedCase && wasOriginallyAllCaps(bare, rawCasingMap);
      capitalizeNext = endsWithBreak(tok);
      // canonical already includes its trailing period. Strip ours from
      // `trail` to avoid emitting "Civ.." — but preserve any other
      // trailing chars (comma, paren) that came after the period.
      const trailWithoutFirstPeriod = trail.replace('.', '');
      const replacement = userWentAllCaps
        ? bare.toUpperCase() + '.'
        : canonical;
      return lead + replacement + trailWithoutFirstPeriod;
    }

    // Heuristic acronym detection. If the token's letter shape says it's
    // an acronym, preserve the user's original casing if we have it
    // (so "MtS" stays "MtS"); otherwise default to all-caps. We also
    // pass through whether the user wrote this token in all-caps WITHIN
    // a mixed-case context — tier 4 (doubled-letter rule) needs that as
    // positive evidence to avoid mis-flagging words like "apple" or
    // "funny". An all-caps token in an all-caps document carries no
    // signal (it's just ambient style), so we don't count it.
    const userWroteAllCapsIntent =
      rawInputIsMixedCase && wasOriginallyAllCaps(bare, rawCasingMap);
    if (looksLikeAcronymByShape(bare, userWroteAllCapsIntent)) {
      const entry = rawCasingMap && rawCasingMap.get(acronymKey);
      const out = (entry && entry.original) || bare.toUpperCase();
      capitalizeNext = endsWithBreak(tok);
      return lead + out + trail;
    }

    let shouldCap;
    if (isFirst || isLast) {
      shouldCap = true;
    } else if (capitalizeNext) {
      shouldCap = true;
    } else if (afterConnectiveHyphen) {
      shouldCap = false;
    } else if (LOWERCASE_WORDS.has(bare.toLowerCase())) {
      shouldCap = false;
    } else {
      shouldCap = true;
    }

    capitalizeNext = endsWithBreak(tok);

    const cased = shouldCap
      ? bare[0].toUpperCase() + bare.slice(1).toLowerCase()
      : bare.toLowerCase();

    return lead + cased + trail;
  }).join('');
}

function countMatches(str, pattern) {
  return (str.match(pattern) || []).length;
}

// Special handler for "Declaration of [Name] In Support of X" → "[Last Name] Decl. ISO X"
// The format should be: "Declaration of [Blank Blank] In Support of X" → "Blank Decl. ISO X"
// where the name kept is the last word before "In" (hyphenated names count as one word)
function handleDeclaration(s) {
  // Match "Declaration of [Name] In Support of X" or "Declaration of [Name] ISO X"
  const declMatch = s.match(/\bDeclaration of\s+(.+?)\s+(?:In Support of|ISO)\s+(.+)$/i);
  if (!declMatch) return null;
  
  const namePart = declMatch[1].trim();
  const isoPart = declMatch[2].trim();
  
  // Extract the last word before "In" - split by spaces but treat hyphens as part of the word
  const nameWords = namePart.split(/\s+/);
  const lastName = nameWords[nameWords.length - 1];
  
  // Return formatted: "[LastName] Decl. ISO [X]"
  return `${lastName} Decl. ISO ${isoPart}`;
}

// Strip a trailing isolated "V" (a standalone single letter, optionally with a
// period) left over from a "v." case caption in the source filename — e.g.
// "Amended Complaint V" → "Amended Complaint", "Request for Dismissal V" →
// "Request for Dismissal". Only removed when it's its own word at the very end;
// a "V" inside or attached to a word (e.g. "TV", "Vol") is left untouched.
function stripTrailingIsolatedV(name) {
  return String(name || "").replace(/\s+[Vv]\.?$/, "").trimEnd();
}

function simplifyName(raw) {
  return stripTrailingIsolatedV(simplifyNameCore(raw));
}

function simplifyNameCore(raw) {
  let s = raw;

  // Check for Declaration pattern first, before any transformations
  const declResult = handleDeclaration(s);
  if (declResult) return declResult;

  // Notice of Non-Opposition is its own document type — must short-circuit
  // before the Opposition rules in Step 6/7 collapse it to "Opposition".
  // Match against a normalized copy of the raw input (underscores/hyphens
  // → spaces) so this fires on filenames like
  // "Notice_of_Non_Opposition_to_MSJ.pdf" as well as footer titles like
  // "NOTICE OF NON-OPPOSITION TO PLAINTIFF'S MOTION".
  const nonOppNorm = raw.replace(/[_\-]+/g, ' ');
  if (/\bNotice\s+of\s+Non\s*Opposition\b/i.test(nonOppNorm)) {
    return 'Notice of Non-Opposition';
  }

  // Normalize for pre-checks (underscores → spaces) without mutating s yet
  const rawNorm = raw.replace(/[_\-]+/g, ' ');

  // Detect special acronyms in raw input before cleanup can corrupt them
  const hasMtSRaw = /\bMtS\b/.test(rawNorm) || /\bMotion\s+to\s+Strike\b/i.test(rawNorm);
  const hasISORaw = /\bISO\b/.test(rawNorm);

  // Build a casing map from the raw input BEFORE any normalization.
  // toTitleCase consults this so that when its heuristic detector flags a
  // word as an acronym, we can preserve the user's original casing
  // (e.g. "MtS" stays "MtS" rather than becoming "MTS").
  const rawCasingMap = buildRawCasingMap(raw);
  // Whether the raw input contains both upper and lowercase letters. Used
  // to decide whether the user's all-caps writing of a graphical
  // abbreviation (e.g. "INC" within "Apple INC Annual Report") is
  // intentional or just ambient style.
  const rawInputIsMixedCase = isMixedCase(raw);

  // Step 1: Basic cleanup
  s = s.replace(/[_\-]+/g, ' ');
  s = s.replace(/[^a-zA-Z. ]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\.{2,}/g, '.').replace(/^\.+|\.+$/g, '');
  if (!s) return 'document';

  // Step 2: Title case (handles acronym protection, last-word cap, post-colon cap)
  s = toTitleCase(s, rawCasingMap, rawInputIsMixedCase);

  // Step 3: Remove consecutive duplicate words
  s = s.replace(/\b(\w+(?:\.\w+)*) \1\b/gi, '$1');
  s = s.replace(/\b(\w+(?:\.\w+)*) \1\b/gi, '$1');

  // Step 4: Phrase abbreviations (before repeat-word and override checks).
  // "Mot." is treated as a synonym for "Motion" so abbreviated CSM-style
  // captions like "Mot. for Summary Judgment" collapse the same way as
  // "Motion for Summary Judgment".
  s = s.replace(/\b(?:Motion|Mot\.) for Summary Judgment\b/gi, 'MSJ');
  s = s.replace(/\b(?:Motion|Mot\.) to Strike\b/gi, 'MtS');

  const hasMtS = hasMtSRaw || /\bMtS\b/.test(s);

  // Step 5: "In Support of" → "ISO". "Supp." is treated as a synonym for
  // "Support" so CSM short forms like "in supp. of" / "ISO" come out the
  // same as the long form. The bare "in support" (no "of") variant is also
  // kept for titles that elide the connector. Note: \b after "Supp." would
  // fail because "." is a non-word char with another non-word char (space
  // or end of string) on the other side — so we use a lookahead instead.
  s = s.replace(/\bIn Sup(?:port|p\.)\s+Of\b/gi, 'ISO');
  s = s.replace(/\bIn Sup(?:port|p\.)(?=\s|$)/gi, 'ISO');

  const hasISO = hasISORaw || /\bISO\b/.test(s);

  // Step 5b: Drop the "Memorandum of Points (and) Authorities ISO" prefix
  // entirely. By this point, "In Support of" / "In Supp. of" has already
  // been collapsed to "ISO" by Step 5, so we only need to match against
  // the ISO form. The "and" connector is optional because Step 1 strips
  // "&" (so "Points & Authorities" survives as "Points Authorities"),
  // while spelled-out "and" is preserved.
  //
  // Leading-word variants accepted: Memorandum, Mem., Memo., Mem, Memo.
  // The alternation is ordered longest-first so "Memorandum" wins over
  // "Memo" when both could match (regex alternation is left-to-right
  // first-match, not longest-match). Bare "Memo"/"Mem" forms are safe
  // against partial-match-of-Memorandum because the regex requires
  // \s+ immediately after, which "Memorandum" doesn't satisfy at "Memo".
  s = s.replace(
    /\b(?:Memorandum|Memo\.|Mem\.|Memo|Mem)\s+of\s+Points\s+(?:and\s+)?Authorities\s+ISO(?:\s+|$)/gi,
    ''
  ).trim();
  // Edge case: if the input was ONLY the prefix (e.g. "Memorandum of
  // Points and Authorities in Support" with no following object), the
  // line above leaves an empty string. Restore something sensible.
  if (!s) return 'Memo. P. & A.';

  // Step 6: Repeat-word overrides
  const replyCount      = countMatches(s, /\bReply\b/gi);
  const oppositionCount = countMatches(s, /\bOpposition\b/gi);
  const motionCount     = countMatches(s, /\bMotion\b/gi);

  if (replyCount > 1)      return hasMtS ? 'MtS Reply'      : 'Reply';
  if (oppositionCount > 1) return hasMtS ? 'MtS Opposition' : 'Opposition';
  if (motionCount > 1)     return 'Motion';

  // Step 7: Single-occurrence whole-name overrides
  if (/\bReply\b/i.test(s))                 return hasMtS ? 'MtS Reply'      : 'Reply';
  if (!hasISO && /\bOpposition\b/i.test(s)) return hasMtS ? 'MtS Opposition' : 'Opposition';

  // Step 8: Word/phrase abbreviations
  s = s.replace(/\bDeclaration\b/gi, 'Decl.');
  s = s.replace(/\bEvidentiary Objections\b/gi, 'Evid. Objs.');

  if (hasISO) {
    s = s.replace(/\bMotion\b/gi, 'Mot.');
    s = s.replace(/\bOpposition\b/gi, 'Opp.');
  }

  // Step 9: Party abbreviations — possessives first (more specific)
  s = s.replace(/\bPlaintiffs['']s?\b/gi, "Plfs.'");
  s = s.replace(/\bPlaintiffs\b/gi, 'Plfs.');
  s = s.replace(/\bPlaintiff['']s\b/gi, "Plf.'s");
  s = s.replace(/\bPlaintiff\b/gi, 'Plf.');

  s = s.replace(/\bDefendants['']s?\b/gi, "Defs.'");
  s = s.replace(/\bDefendants\b/gi, 'Defs.');
  s = s.replace(/\bDefendant['']s\b/gi, "Def.'s");
  s = s.replace(/\bDefendant\b/gi, 'Def.');

  // Step 10: Final cleanup
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

// Convert an extracted title to a sensible filename using the PDF renamer logic
function filenameFromTitle(title) {
  if (!title) return "";
  return simplifyName(title);
}

// Page-level holder of extracted footer lines, populated during render.
const _footerByPage = new Map();

// Single source of truth for "show this name everywhere visible to the
// user." Updates the toolbar filename element AND the browser tab title
// (which the user sees in the tab strip and window title bar).
//
// `raw` is anything filename-shaped: a URL last-segment, a Content-
// Disposition value, or a footer-extracted title. Pass through as-is —
// the pipeline strips .pdf, normalizes punctuation, and applies the
// abbreviation rules. If the input is empty/null we fall back to "PDF"
// so the UI never goes blank.
//
// `definitive` (default true) means the source is high-quality and
// `serverFilename` should be updated so the Download button reuses it.
// Pass false for low-quality sources like URL-derived names: the toolbar
// and tab title get updated for visibility, but serverFilename stays
// null so the Download button can prefer a better source (Content-
// Disposition read at click time, etc).
//
// `origin` (default "source") tags where the name came from. The
// namingMode preference gates which origin "wins" the display: when
// "source" is selected, footer-origin updates are cached but don't
// overwrite the visible name; when "footer" is selected, source-origin
// updates feed the cache so flipping the toggle keeps working.
function setDisplayName(raw, { definitive = true, origin = "source" } = {}) {
  // Once the user has manually renamed the document via click-to-edit,
  // their choice is the most-definitive source. Programmatic callers
  // (footer extraction, Content-Disposition reads) should not overwrite
  // it. Non-definitive callers (URL fallback) are already filtered out
  // by their own callers when serverFilename is set; we belt-and-suspenders
  // here too.
  if (userOverrodeName) return;
  let display;
  if (!raw) {
    display = fileUrl ? "PDF" : "(no file)";
  } else {
    // Strip .pdf before simplifying so the pipeline doesn't treat ".pdf"
    // as a meaningful token.
    const withoutExt = String(raw).replace(/\.pdf$/i, "");
    if (origin === "source") {
      sourceRawName = withoutExt;
      display = computeSourceDisplay(withoutExt);
    } else {
      display = simplifyName(withoutExt) || withoutExt || "PDF";
    }
    if (definitive) serverFilename = display;
  }
  // Cache by origin so applyNamingMode can swap between them later.
  if (origin === "source") sourceDisplayName = display;
  // Whether this update is visible depends on the active naming mode.
  // For "source" mode, only source-origin updates are visible. For
  // "footer" mode, footer-origin updates win — but if footer extraction
  // hasn't happened yet, fall back to the source name so the toolbar
  // isn't empty during loading.
  const visible = (namingMode === "footer" && origin === "footer")
               || (namingMode === "source" && origin === "source");
  if (visible) {
    paintDisplayName(display);
  } else if (namingMode === "footer" && origin === "source" && !footerExtraction) {
    // Footer mode but no footer result yet → show source as a placeholder.
    paintDisplayName(display);
  }
}

// Low-level paint: update toolbar + tab title to the given display name.
// Used by setDisplayName and by applyNamingMode (which doesn't re-run
// the simplification pipeline — the name is already simplified).
function paintDisplayName(display) {
  filenameEl.textContent = display;
  document.title = display
    ? `${display} — PDF Viewer`
    : "PDF Viewer";
  // Keep the history's "final name" in step with whatever we actually show,
  // whether that's the source name, the footer name, a disambiguated name,
  // or (via the rename flow) a manual revision.
  recordFinalName(display);
}

// Persist the currently-displayed name as the history entry's final name, so
// the log records which name we ended up using — not just the cases where the
// user manually revised it. No-ops until logPdfHistory has created this
// session's entry (that initial log captures the name itself).
function recordFinalName(name) {
  if (!currentHistoryId) return;
  chrome.storage.local.get({ pdfHistory: [] }, ({ pdfHistory }) => {
    const idx = pdfHistory.findIndex(e => e.id === currentHistoryId);
    if (idx === -1) return;
    if (pdfHistory[idx].finalName === name) return;
    pdfHistory[idx].finalName = name;
    chrome.storage.local.set({ pdfHistory });
  });
}

// Recompute the visible name from the currently-active mode. Called
// when namingMode changes (storage listener), when footer extraction
// resolves, and when a sibling tab's session entry changes (collision).
async function applyNamingMode() {
  if (userOverrodeName) return;
  if (namingMode === "footer") {
    if (footerExtraction && footerExtraction.displayName) {
      // Run disambiguation against any sibling viewer tabs.
      const disambiguated = await computeDisplayForThisTab();
      const name = disambiguated || footerExtraction.displayName;
      paintDisplayName(name);
      // Keep serverFilename in sync so Download reuses the name.
      serverFilename = name;
    } else if (sourceDisplayName) {
      // Footer mode but no extraction yet — show source as placeholder.
      paintDisplayName(sourceDisplayName);
    }
  } else {
    // Source mode.
    if (sourceDisplayName) {
      paintDisplayName(sourceDisplayName);
      serverFilename = sourceDisplayName;
    }
  }
}

// Initial display from the URL. Marked non-definitive because URL-derived
// names are often UUIDs or query-string slugs — we want a real name from
// Content-Disposition or the footer to override this without the Download
// button preferring this one.
setDisplayName(filenameFromUrl(fileUrl), { definitive: false });

// Read stored prefs and any saved citation_repo.json.
chrome.storage.sync.get(
  { provider: "lexis", namingMode: "source", toaEnabledPdf: false, autoOcr: false, alterSource: false },
  async ({ provider: storedProvider, namingMode: storedNamingMode, toaEnabledPdf, autoOcr, alterSource: storedAlterSource }) => {
    provider = storedProvider;
    providerEl.value = provider;
    toaPanel.setEnabled(!!toaEnabledPdf);
    if (autoOcr) { ocrEnabled = true; markOcrActive(); }
    alterSource = !!storedAlterSource;
    // Recompute any source name derived before the preference loaded.
    if (sourceRawName) sourceDisplayName = computeSourceDisplay(sourceRawName);
    globalNamingMode = storedNamingMode === "footer" ? "footer" : "source";
    // Look up any per-document override for this exact PDF URL.
    perDocOverride = await getOverride(fileUrl);
    resolveEffectiveNamingMode();
    // Toolbar dropdown mirrors the effective mode regardless of whether
    // that came from the global or an override — the user sees what's
    // active, not where it came from.
    if (namingModeEl) namingModeEl.value = namingMode;
    // Re-paint with the loaded mode now in effect. If a URL-derived name
    // was already set above, this picks the right one to display.
    applyNamingMode();
    chrome.storage.local.get({ citationRepo: {} }, ({ citationRepo: r }) => {
      citationRepo = r || {};
      loadAndRender();
    });
  }
);

providerEl.addEventListener("change", () => {
  provider = providerEl.value;
  chrome.storage.sync.set({ provider });
  if (pdfDoc) renderAllPages();
});

// Reflect that OCR is active for this document (manual run or auto-OCR option).
function markOcrActive() {
  if (!ocrRunEl) return;
  ocrRunEl.setAttribute("aria-pressed", "true");
  ocrRunEl.disabled = true;
  ocrRunEl.title = "OCR is active for this document";
}

// Manual OCR: recognize scanned pages on demand, then re-render so the text
// layer, citation links, and Table of Authorities pick up the OCR'd text.
if (ocrRunEl) {
  ocrRunEl.addEventListener("click", () => {
    if (ocrEnabled) return;
    ocrEnabled = true;
    markOcrActive();
    if (pdfDoc) renderAllPages();
  });
}

// ── Editing: save edits into the file (downloaded / local documents only) ───
//
// Editing is offered only for documents you've already downloaded — a PDF
// opened from disk: file:// in the extension, or handed in via
// __pdfViewerLoadLocal in the app. Web PDFs you're only viewing stay read-only.
// When editing is on, the toolbar shows Save (bakes the in-viewer highlights
// into the PDF via pdf-lib) and Combine (merges other PDFs in after it), and
// the Download button is replaced by Save. Save writes in place when we have a
// writable file handle (the app), otherwise through the Save-file picker.
let editingAllowed = false;
let localFileHandle = null; // FileSystemFileHandle for in-place save, if provided

function setEditingEnabled(on) {
  editingAllowed = on;
  // Save is a primary button; every other document-editing action lives in the
  // Edit ▾ dropdown, so we only need to gate those two entry points here.
  if (saveEditsEl) saveEditsEl.hidden = !on;
  if (editMenuBtn) editMenuBtn.hidden = !on;
  if (!on && editMenuEl) editMenuEl.hidden = true; // don't leave the menu open
  if (downloadEl)  downloadEl.hidden  = on; // Save stands in for Download when editable
}
// A file:// document in the extension is already a local/downloaded file.
setEditingEnabled(isLocalFile);

// Collect on-screen highlight rectangles converted to PDF points, per page.
// Collect the current highlights as PDF-space quads, grouped per highlight, so
// each becomes one /Highlight annotation. Inverse of the paint transform: layer
// px → PDF points via ÷ scale and a Y-flip about the page height.
function collectHighlightPdfRects() {
  const byPage = new Map();
  const wrappers = pagesEl.querySelectorAll(".page-wrapper");
  wrappers.forEach((w, i) => {
    const pn = i + 1;
    const tl = w.querySelector(".textLayer");
    const hlLayer = w.querySelector(".highlightLayer");
    const hPts = pageHeightPtsByNum.get(pn);
    if (!tl || !hlLayer || !hPts) return;
    const s = currentScale;
    const groups = getHighlightRectGroups(pn, tl, hlLayer, { scale: s, pageHeightPts: hPts });
    if (!groups.length) return;
    const out = [];
    for (const g of groups) {
      const rects = g.rects.map((r) => ({
        x: r.left / s,
        y: hPts - (r.top / s) - (r.height / s),
        w: r.width / s,
        h: r.height / s,
      }));
      if (rects.length) out.push({ rects });
    }
    if (out.length) byPage.set(pn, out);
  });
  return byPage;
}

// Write bytes to the document. Order of preference:
//   1. inPlace + a writable file handle (the app) → overwrite the same file.
//   2. the Save-file picker (lets the user choose / overwrite).
//   3. a normal blob download.
async function writeOutPdf(bytes, suggestedName, { inPlace = false } = {}) {
  const name = /\.pdf$/i.test(suggestedName) ? suggestedName : `${suggestedName}.pdf`;
  const blob = new Blob([bytes], { type: "application/pdf" });

  if (inPlace && localFileHandle && localFileHandle.createWritable) {
    try {
      if (localFileHandle.requestPermission) {
        const perm = await localFileHandle.requestPermission({ mode: "readwrite" });
        if (perm !== "granted") throw new Error("write permission denied");
      }
      const writable = await localFileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e) {
      if (e && e.name === "AbortError") return false;
      // fall through to the picker / download
    }
  }

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e) {
      if (e && e.name === "AbortError") return false; // user cancelled
      // otherwise fall through to the download path
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

async function saveEditedPdf() {
  if (!editingAllowed || !saveEditsEl) return;
  if (!pdfBytes) { statusEl.textContent = "PDF not loaded yet."; return; }
  saveEditsEl.disabled = true;
  try {
    statusEl.textContent = "Saving…";
    const edited = await buildEditedPdf({
      srcBytes: pdfBytes.slice(0),
      highlightsByPage: collectHighlightPdfRects(),
    });
    const ok = await writeOutPdf(edited, sanitizePdfFilename(serverFilename || "document"), { inPlace: true });
    statusEl.textContent = ok ? "Saved." : "";
  } catch (e) {
    console.error("[pdf-viewer] save failed:", e);
    statusEl.textContent = "Save failed.";
  } finally {
    saveEditsEl.disabled = false;
  }
}

async function combinePdfs() {
  if (!editingAllowed || !combineEl) return;
  if (!pdfBytes) { statusEl.textContent = "PDF not loaded yet."; return; }
  if (!window.showOpenFilePicker) { statusEl.textContent = "File picker unavailable here."; return; }
  let handles;
  try {
    handles = await window.showOpenFilePicker({
      multiple: true,
      types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }],
    });
  } catch (e) {
    if (e && e.name === "AbortError") return;
    throw e;
  }
  if (!handles || !handles.length) return;
  combineEl.disabled = true;
  try {
    statusEl.textContent = "Combining…";
    const appendBytes = [];
    for (const h of handles) {
      const f = await h.getFile();
      appendBytes.push(new Uint8Array(await f.arrayBuffer()));
    }
    const edited = await buildEditedPdf({
      srcBytes: pdfBytes.slice(0),
      highlightsByPage: collectHighlightPdfRects(),
      appendBytes,
    });
    const ok = await writeOutPdf(edited, "combined.pdf");
    statusEl.textContent = ok ? `Combined ${handles.length + 1} files.` : "";
  } catch (e) {
    console.error("[pdf-viewer] combine failed:", e);
    statusEl.textContent = "Combine failed.";
  } finally {
    combineEl.disabled = false;
  }
}

if (saveEditsEl) saveEditsEl.addEventListener("click", saveEditedPdf);
if (combineEl)   combineEl.addEventListener("click", combinePdfs);

// Toolbar naming-mode dropdown writes a per-document override. The
// override is keyed by file URL and lives in chrome.storage.session, so
// it survives tab reload but dies on browser close. The override always
// wins over the global default; setOverride(fileUrl, null) clears it,
// but since the dropdown has no "use default" option that path is only
// reachable programmatically.
if (namingModeEl) {
  namingModeEl.addEventListener("change", async () => {
    const v = namingModeEl.value === "footer" ? "footer" : "source";
    perDocOverride = v;
    await setOverride(fileUrl, v);
    if (resolveEffectiveNamingMode()) applyNamingMode();
  });
}

// React to override changes from other surfaces (e.g. a duplicate tab
// open on the same URL). The toolbar mirrors the new value.
onOverrideChange(fileUrl, (newOverride) => {
  perDocOverride = newOverride;
  if (resolveEffectiveNamingMode()) {
    if (namingModeEl) namingModeEl.value = namingMode;
    applyNamingMode();
  } else if (namingModeEl && namingModeEl.value !== namingMode) {
    namingModeEl.value = namingMode;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.provider) {
    provider = changes.provider.newValue;
    providerEl.value = provider;
    if (pdfDoc) renderAllPages();
  }
  if (area === "sync" && changes.namingMode) {
    const v = changes.namingMode.newValue;
    globalNamingMode = v === "footer" ? "footer" : "source";
    // Only re-paint if no per-doc override is hiding the global change.
    if (!perDocOverride && resolveEffectiveNamingMode()) {
      if (namingModeEl) namingModeEl.value = namingMode;
      applyNamingMode();
    }
  }
  if (area === "sync" && changes.alterSource) {
    alterSource = !!changes.alterSource.newValue;
    // Recompute the source name and re-show it if source naming is active.
    if (!userOverrodeName && sourceRawName) {
      sourceDisplayName = computeSourceDisplay(sourceRawName);
      if (namingMode === "source") {
        serverFilename = sourceDisplayName;
        paintDisplayName(sourceDisplayName);
      }
    }
  }
  if (area === "local" && changes.citationRepo) {
    citationRepo = changes.citationRepo.newValue || {};
    if (pdfDoc) renderAllPages();
  }
  if (area === "sync" && changes.toaEnabledPdf) {
    const on = changes.toaEnabledPdf.newValue !== false;
    toaPanel.setEnabled(on);
    // Re-show with the current document's authorities without a full re-render.
    if (on && pdfDoc) toaPanel.render(getAuthorities(citationRepo, provider), provider);
  }
  if (area === "sync" && changes.autoOcr && changes.autoOcr.newValue && !ocrEnabled) {
    ocrEnabled = true;
    markOcrActive();
    if (pdfDoc) renderAllPages();
  }
});

// Cross-tab disambiguation: when another viewer tab registers a doc with
// the same canonical type, recompute and re-paint our display name. Only
// matters in "footer" mode — source-mode names are file-derived and
// disambiguation doesn't apply.
onCollisionUpdate((newDisplay) => {
  if (userOverrodeName) return;
  if (namingMode !== "footer") return;
  if (!newDisplay) return;
  paintDisplayName(newDisplay);
  serverFilename = newDisplay;
});

// Best-effort cleanup when the tab is closing so we don't leave a stale
// session entry around. (sweepStale runs on register too, so this is
// belt-and-suspenders.)
window.addEventListener("beforeunload", () => {
  unregisterEntry();
});

// Reset per-document state before rendering a new PDF (whether it arrived by
// URL fetch or as a local file). Shared by loadAndRender and loadLocalFile.
function resetForNewDocument() {
  // New PDF -> drop any highlights from a previously loaded document.
  // (renderAllPages is also called on zoom, where we DO want them retained;
  // hence clearing here, not there.)
  clearAllHighlights();
  // New document → drop cached OCR boxes and tear down the recognizer worker.
  // (Deliberately here and not in renderAllPages, which also runs on zoom —
  // the per-page OCR cache is what makes zoom cheap, so it must survive zoom.)
  resetOcr();
  // Clear stashed bytes from any prior PDF. If the new load fails, the
  // Download button has nothing stale to save.
  pdfBytes = null;
  // Fresh document → fresh chance for footer/header extraction to win.
  userOverrodeName = false;
  // Allow thumbnails and bookmarks to re-render for the new document, and drop
  // any organize-mode state / cached thumbnails from the previous document.
  thumbsRendered = false;
  resetOrganizeState();
  exitFormMode();
  thumbDataUrlCache.clear();
  if (panelBookmarksEl) { panelBookmarksEl.innerHTML = ""; delete panelBookmarksEl.dataset.loaded; }
  if (tabBookmarksEl)   tabBookmarksEl.hidden = true;
  switchTab("pages");
  // Drop any cached footer result from a previously-loaded PDF in this
  // tab and clear our session-registry entry. The new doc will register
  // its own entry once the footer pass completes; until then we don't
  // want stale collision data influencing other tabs.
  footerExtraction = null;
  _footerByPage.clear();
  unregisterEntry();
}

// Load the document's existing /Highlight annotations into the removable
// highlight overlay. Only for editable (downloaded/local) docs — those are the
// ones we render annotations for ourselves and let the user delete/re-save.
// Read-only web PDFs let PDF.js draw their annotations on the canvas as usual.
const HIGHLIGHT_ANNOTATION_TYPE = 9; // pdfjsLib.AnnotationType.HIGHLIGHT
// True once we've imported at least one /Highlight annotation from the current
// document. Gates whether the canvas render skips annotations (so we own the
// highlights) — see renderPageCanvasAndText.
let docHasAnnotationHighlights = false;
async function importHighlightAnnotations() {
  docHasAnnotationHighlights = false;
  if (!editingAllowed || !pdfDoc) return;
  for (let pn = 1; pn <= pdfDoc.numPages; pn++) {
    let annots;
    try {
      const page = await pdfDoc.getPage(pn);
      annots = await page.getAnnotations({ intent: "display" });
    } catch {
      continue;
    }
    for (const a of annots) {
      if (!a || a.annotationType !== HIGHLIGHT_ANNOTATION_TYPE) continue;
      const q = a.quadPoints;
      if (!q || !q.length) continue;
      // PDF.js normalizes QuadPoints to 8 numbers per quad, laid out
      // [minX, maxY, maxX, maxY, minX, minY, maxX, minY]. Recover {x,y,w,h}
      // in PDF points (origin bottom-left).
      const pdfRects = [];
      for (let i = 0; i + 7 < q.length; i += 8) {
        const left = q[i], top = q[i + 1], right = q[i + 2], bottom = q[i + 5];
        const x = Math.min(left, right);
        const y = Math.min(top, bottom);
        const w = Math.abs(right - left);
        const h = Math.abs(top - bottom);
        if (w > 0 && h > 0) pdfRects.push({ x, y, w, h });
      }
      if (pdfRects.length) { addImportedHighlight(pn, pdfRects); docHasAnnotationHighlights = true; }
    }
  }
}

// Render a PDF from raw bytes. `sourceName`, when given (local files know their
// filename directly), seeds the source-mode display name.
async function renderBytes(buf, { sourceName } = {}) {
  if (sourceName) setDisplayName(sourceName);
  // Stash a copy for the Download handler. PDF.js takes ownership of the
  // buffer it's handed (some versions transfer it), so we keep our own.
  pdfBytes = buf.slice(0);
  const loadingTask = pdfjsLib.getDocument({ data: buf });
  pdfDoc = await loadingTask.promise;
  // Bring any existing /Highlight annotations into the removable overlay before
  // the first paint, so a saved-and-reopened file shows its highlights as
  // deletable ones (and we don't double-draw them — the canvas render skips
  // annotations for editable docs).
  await importHighlightAnnotations();
  // Does this document have fillable form fields? Gates the "Fill form" action.
  docHasForm = editingAllowed ? await hasFormFields(pdfBytes) : false;
  updateFormMenuItem();
  statusEl.textContent = `Rendering ${pdfDoc.numPages} pages…`;
  await renderAllPages();
  statusEl.textContent = "Done";
  updatePageIndicator();
}

async function loadAndRender() {
  if (!fileUrl) {
    statusEl.textContent = "No file specified.";
    return;
  }
  resetForNewDocument();
  try {
    statusEl.textContent = "Downloading…";
    // Fetch the PDF ourselves (instead of letting PDF.js fetch by URL) so we
    // can read the Content-Disposition header. Many sites — including
    // e-court systems — serve PDFs from URLs that don't contain the real
    // filename and only expose it via this header. Using `credentials:
    // include` ensures session cookies are sent, matching what the user's
    // browser would do for the original link.
    const resp = await fetch(fileUrl, { credentials: "include" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);

    const cd = resp.headers.get("Content-Disposition");
    const fromHeader = filenameFromContentDisposition(cd);
    if (fromHeader) {
      // Updates filenameEl, document.title, and serverFilename — see
      // setDisplayName for the contract.
      setDisplayName(fromHeader);
    }

    const buf = await resp.arrayBuffer();
    await renderBytes(buf);
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Error: " + err.message;
  }
}

// Render a local File object directly (no network). Used by the PWA shell when
// a PDF is opened from disk (OS file handler, Open button, or drag-and-drop),
// so cross-origin/CORS never enters the picture. Exposed on window for the
// web glue; unused (but harmless) inside the extension.
async function loadLocalFile(file, handle) {
  if (!file) return;
  resetForNewDocument();
  // A local/downloaded file → editable. Keep the writable handle (if the app
  // provided one) so Save can overwrite the same file in place.
  localFileHandle = handle || null;
  setEditingEnabled(true);
  try {
    statusEl.textContent = "Reading…";
    // Copy into a Uint8Array created in THIS realm. When the viewer runs in an
    // iframe (the PWA's tab bar), the File is handed in from the parent window,
    // so file.arrayBuffer() returns a parent-realm ArrayBuffer that PDF.js's
    // cross-realm instanceof checks would reject. A same-realm byte copy is
    // always accepted.
    const ab = await file.arrayBuffer();
    const bytes = new Uint8Array(ab.byteLength);
    bytes.set(new Uint8Array(ab));
    await renderBytes(bytes, { sourceName: file.name });
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Error: " + err.message;
  }
}
window.__pdfViewerLoadLocal = loadLocalFile;

async function renderAllPages() {
  // Cancel any previous in-flight render (zoom-while-rendering, or Download
  // clicked mid-render). The signal is checked between pages and passes; we
  // don't try to interrupt a single getPage()/render() that's already running.
  if (renderAbort) renderAbort.abort();
  renderAbort = new AbortController();
  const { signal } = renderAbort;

  // Fresh footer-title promise. The Download handler awaits this if the
  // user clicks before pages 1–2 have rendered. It always resolves (never
  // rejects) — if no title is found, callers fall back to Content-Disposition
  // or the URL-derived name.
  footerTitleResolved = new Promise((res) => { _resolveFooterTitle = res; });

  pagesEl.innerHTML = "";
  totalLinks = 0;
  _footerByPage.clear();

  resetDocument({ repo: citationRepo, provider });

  // Pass 1: render canvases + text layers, ingest text into the linker.
  // We hold per-page DOM refs so pass 2 can place overlays in the right divs.
  const pageRefs = [];
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    if (signal.aborted) return;
    const refs = await renderPageCanvasAndText(pageNum);
    if (signal.aborted) return;
    ingestPage(pageNum, refs.textContent);
    pageRefs.push(refs);
    // Capture the footer band of the first two pages so we can detect a
    // running-footer title. We only look at those — that's enough signal
    // and avoids slowing renders of long documents.
    if (pageNum <= 2 && refs.textContent && refs.viewport) {
      _footerByPage.set(pageNum, footerLines(refs.textContent, refs.viewport));
    }
    // Once we have page 1 (or pages 1 and 2), try to resolve a title.
    if (pageNum === 2 || (pageNum === 1 && pdfDoc.numPages === 1)) {
      tryResolveFooterTitle();
      logPdfHistory();
      // Whether or not a title was found, the footer pass is now complete.
      // Unblock any Download handler that's waiting.
      if (_resolveFooterTitle) { _resolveFooterTitle(); _resolveFooterTitle = null; }
    }
  }

  if (signal.aborted) return;

  // Pass 2: run document-wide detection (resolves supra across pages).
  const totalCites = runDetection();
  void totalCites;

  // Feed the Table of Authorities panel (deduped authorities for this doc).
  if (toaPanel) toaPanel.render(getAuthorities(citationRepo, provider), provider);

  // Pass 3: place links on each page.
  for (const refs of pageRefs) {
    if (signal.aborted) return;
    totalLinks += placeLinksForPage(
      refs.pageNumber, refs.textLayerDiv, refs.linkLayerDiv
    );
  }

  if (signal.aborted) return;

  // Pass 4: hook up text-highlight handlers and repaint any existing
  // highlights. After a zoom, renderAllPages re-creates all DOM from
  // scratch — but the in-memory highlight store survives, so this pass
  // restores them onto the freshly rendered pages.
  const repaintCb = (pn) => {
    const r = pageRefs.find((x) => x.pageNumber === pn);
    if (r) repaintHighlightsForPage(pn, r.textLayerDiv, r.highlightLayerDiv,
      { scale: currentScale, pageHeightPts: pageHeightPtsByNum.get(pn) });
  };
  for (const refs of pageRefs) {
    if (signal.aborted) return;
    attachHighlightHandlers(
      refs.pageNumber, refs.pageWrapper, refs.textLayerDiv,
      refs.highlightLayerDiv, () => highlightMode, repaintCb,
      () => rectSelectMode
    );
    repaintHighlightsForPage(refs.pageNumber, refs.textLayerDiv, refs.highlightLayerDiv,
      { scale: currentScale, pageHeightPts: pageHeightPtsByNum.get(refs.pageNumber) });
  }

  updateLinkCount();
}

// Extract and set the filename from the document footer. Whether this
// actually becomes the visible name depends on the namingMode preference:
// in "footer" mode it replaces the source-derived name; in "source" mode
// (the default) the extraction is still cached for the disambiguation
// registry but isn't shown.
// Extract the footer title from the cached footer-band text on pages 1-2,
// run it through the rule engine, cache the structured result, register
// it for cross-tab disambiguation, and re-paint if footer mode is active.
//
// Runs regardless of the user's naming-mode preference, because:
//   1. The structured result (canonical/target/party) is needed for the
//      disambiguation registry — sibling tabs need to know we exist even
//      if we're displaying our source name.
//   2. Flipping the toggle from "source" to "footer" should be instant,
//      not require re-rendering pages 1-2.
// Reject OCR-garbage footer titles so we fall back to the (clean) source name.
// On scanned / clerk-stamped PDFs the footer band sometimes yields gibberish —
// "c ,-/z!h 1 1 iUwN4QT", "I!%$(! $%#1 ...", run-together OCR words like
// "ANDINSTALLMENTPAYMENTS", or form codes like "SCLAC CIV 298 Rev." — that
// never make good document names. Signals:
//   1. letters are too small a share of the text (symbol/digit noise);
//   2. an implausibly long unbroken alphabetic run (merged OCR words; real
//      legal words top out around 16 chars);
//   3. too few vowels among the letters (consonant-soup OCR / form codes).
function looksLikeGibberishTitle(title) {
  const t = String(title || "").trim();
  const nonSpace = t.replace(/\s/g, "");
  if (!nonSpace) return true;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length / nonSpace.length < 0.55) return true;
  const longestRun = (t.match(/[A-Za-z]+/g) || [])
    .reduce((mx, w) => Math.max(mx, w.length), 0);
  if (longestRun > 20) return true;
  if (letters.length >= 6) {
    const vowels = (letters.match(/[aeiou]/gi) || []).length;
    if (vowels / letters.length < 0.30) return true;
  }
  return false;
}

function tryResolveFooterTitle() {
  const p1 = _footerByPage.get(1) || [];
  const p2 = _footerByPage.get(2) || [];

  // A footer line that begins with the word "Type" — ignoring any leading
  // punctuation, e.g. "(TYPE OR PRINT NAME)" — is a fillable signature-block
  // label. It marks this as a blank Judicial Council / court form rather than
  // a real filing, so we don't try to derive a title from it: fall back to the
  // source name.
  //
  // We scan the raw footer LINES rather than the single chosen title because
  // the form's running title (e.g. the repeated "MEMORANDUM OF COSTS
  // (SUMMARY)" band on an MC-010) would otherwise win and mask the label.
  const isTypeLabel = (l) => /^[^A-Za-z]*type\b/i.test((l.text || "").trim());
  if (p1.some(isTypeLabel) || p2.some(isTypeLabel)) return;

  const rawTitle = chooseTitleFromFooters(p1, p2);
  if (!rawTitle) return;

  // OCR-garbage footer text, or a blank Word template placeholder, is not a
  // real title — fall back to the source name rather than display nonsense.
  if (looksLikeGibberishTitle(rawTitle)) return;
  if (/^pleading title\b/i.test(rawTitle.trim())) return;

  // New rule engine first — produces structured output we can disambiguate
  // against sibling tabs. Falls back to the legacy simplifyName-only flow
  // when the new engine can't identify a document type (covers exotic
  // titles like cover-page memo headings that don't follow the canonical
  // motion/decl/complaint vocabulary).
  const parsed = extractTitle(rawTitle);
  let displayName;
  if (parsed.canonical) {
    // Default to canonical; disambiguation may upgrade this when sibling
    // tabs are open with colliding types.
    displayName = parsed.canonical;
  } else {
    // Legacy fallback path. The old simplifyName produced names for many
    // exotic footers (cover-page memo titles, etc.) that the new rule
    // engine intentionally doesn't handle. Use it as a safety net so
    // those documents still get sensible names rather than reverting to
    // the URL/source filename.
    const withoutExt = rawTitle.replace(/\.pdf$/i, "");
    displayName = simplifyName(withoutExt) || withoutExt || "PDF";
  }

  footerExtraction = {
    displayName,
    canonical: parsed.canonical,
    target: parsed.target,
    party: parsed.party,
    partyLabel: parsed.partyLabel,
    raw: rawTitle,
  };

  // Register for cross-tab collision. The disambiguation listener may
  // call back with an updated display name moments later.
  if (parsed.canonical) {
    registerEntry({
      canonical: parsed.canonical,
      target: parsed.target,
      party: parsed.party,
      partyLabel: parsed.partyLabel,
    });
  }

  // Tooltip always reflects the raw recovered footer text — useful for
  // sanity-checking the extraction even when the user isn't displaying
  // the footer-derived name.
  filenameEl.title = `Title recovered from document footer: ${rawTitle}`;

  // Paint if footer mode is active. applyNamingMode handles the await on
  // the disambiguation lookup.
  applyNamingMode();
}

function logPdfHistory() {
  if (!fileUrl) return;
  // The document URL is intentionally NOT recorded. Each opened PDF gets a
  // random in-memory id so this session can update its finalName later
  // (rename / naming-mode change); it is not derived from or tied to the URL.
  currentHistoryId = (crypto.randomUUID && crypto.randomUUID()) ||
    String(Date.now()) + Math.random().toString(36).slice(2);
  const entry = {
    id:          currentHistoryId,
    sourceTitle: sourceDisplayName || "",
    footerName:  footerExtraction ? (footerExtraction.displayName || "") : "",
    footerTitle: footerExtraction ? (footerExtraction.raw || "") : "",
    finalName:   filenameEl.textContent || "",
    timestamp:   new Date().toISOString(),
  };
  chrome.storage.local.get({ pdfHistory: [] }, ({ pdfHistory }) => {
    pdfHistory.unshift(entry);
    if (pdfHistory.length > 500) pdfHistory.length = 500;
    chrome.storage.local.set({ pdfHistory });
  });
}

function updateLinkCount() {
  const providerLabel = provider === "lexis" ? "Lexis+" : "Westlaw";
  linkCountEl.textContent = totalLinks > 0
    ? `· ${totalLinks} citation${totalLinks === 1 ? "" : "s"} → ${providerLabel}`
    : "";
}

function updatePageIndicator() {
  if (!pdfDoc || !pageIndicatorEl) return;
  const total = pdfDoc.numPages;
  // Find the page wrapper whose midpoint is closest to the viewport center.
  const wrappers = pagesEl.querySelectorAll(".page-wrapper");
  if (!wrappers.length) return;
  const mid = window.scrollY + window.innerHeight / 2;
  let closest = 1, minDist = Infinity;
  wrappers.forEach((w, i) => {
    const rect = w.getBoundingClientRect();
    const pageMid = window.scrollY + rect.top + rect.height / 2;
    const dist = Math.abs(pageMid - mid);
    if (dist < minDist) { minDist = dist; closest = i + 1; }
  });
  pageIndicatorEl.textContent = `${closest} / ${total}`;
}

document.addEventListener("scroll", updatePageIndicator, { passive: true });

// Overlay clickable elements for the PDF's own link annotations (external URLs
// and internal go-to-page links), so the document's native hyperlinks work here
// the way they do in Acrobat. `viewport` is the display viewport (current zoom);
// convertToViewportRectangle maps the annotation's PDF-space rect to layer px.
const LINK_ANNOTATION_TYPE = 2; // pdfjsLib.AnnotationType.LINK
async function placeNativeLinksForPage(page, viewport, layerDiv) {
  let annots;
  try {
    annots = await page.getAnnotations({ intent: "display" });
  } catch {
    return;
  }
  for (const a of annots) {
    if (!a || a.annotationType !== LINK_ANNOTATION_TYPE || !a.rect) continue;
    const hasUrl = typeof a.url === "string" && a.url;
    const hasDest = a.dest != null;
    if (!hasUrl && !hasDest) continue; // skip links with no navigable target
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect);
    const left = Math.min(x1, x2), top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1), height = Math.abs(y2 - y1);
    if (width < 1 || height < 1) continue;
    const el = document.createElement("a");
    el.className = "pdf-link";
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    if (hasUrl) {
      el.href = a.url;
      el.target = "_blank";
      el.rel = "noopener noreferrer";
      el.title = a.url;
    } else {
      el.href = "#";
      el.title = "Go to linked page";
      const dest = a.dest;
      el.addEventListener("click", async (e) => {
        e.preventDefault();
        const pn = await destToPageNum(dest);
        if (pn) scrollToPage(pn);
      });
    }
    layerDiv.appendChild(el);
  }
}

async function renderPageCanvasAndText(pageNumber) {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: currentScale });
  // We use a scale=1 viewport for footer math so coordinates match the
  // PDF user-space units that page.getTextContent() returns by default.
  const userSpaceViewport = page.getViewport({ scale: 1 });
  // Remember the page height in PDF points so on-screen highlight rects can be
  // converted to PDF coordinates when saving an edited copy.
  pageHeightPtsByNum.set(pageNumber, userSpaceViewport.height);

  const wrapper = document.createElement("div");
  wrapper.className = "page-wrapper";
  wrapper.style.width  = `${viewport.width}px`;
  wrapper.style.height = `${viewport.height}px`;

  const canvas = document.createElement("canvas");
  canvas.width  = viewport.width;
  canvas.height = viewport.height;
  wrapper.appendChild(canvas);

  const textLayerDiv = document.createElement("div");
  textLayerDiv.className = "textLayer";
  textLayerDiv.style.width  = `${viewport.width}px`;
  textLayerDiv.style.height = `${viewport.height}px`;
  // PDF.js >= 3 requires --scale-factor on the textLayer container (or any
  // ancestor) so its internal glyph-positioning math matches the rendered
  // viewport. Without this, selection rectangles drift away from the painted
  // text and Ctrl+C copies the wrong characters. Newer 4.x also reads
  // --total-scale-factor; setting both is forward-compatible.
  textLayerDiv.style.setProperty("--scale-factor", String(viewport.scale));
  textLayerDiv.style.setProperty("--total-scale-factor", String(viewport.scale));
  wrapper.appendChild(textLayerDiv);

  // Highlight layer is appended AFTER the text layer so highlight rects sit
  // above textLayer in DOM order. Visually this is identical to "behind text"
  // because textLayer glyphs are transparent — but it means a click on a
  // highlight rect actually reaches the rect (and our delete handler) instead
  // of being absorbed by the textLayer's span. The layer container itself is
  // pointer-events: none, so it doesn't block text selection elsewhere.
  const highlightLayerDiv = document.createElement("div");
  highlightLayerDiv.className = "highlightLayer";
  highlightLayerDiv.style.width  = `${viewport.width}px`;
  highlightLayerDiv.style.height = `${viewport.height}px`;
  wrapper.appendChild(highlightLayerDiv);

  const linkLayerDiv = document.createElement("div");
  linkLayerDiv.className = "linkLayer";
  wrapper.appendChild(linkLayerDiv);

  // Separate layer for the PDF's OWN hyperlinks (link annotations), kept apart
  // from the citation overlay so the two never clobber each other.
  const pdfLinkLayerDiv = document.createElement("div");
  pdfLinkLayerDiv.className = "linkLayer pdfLinkLayer";
  wrapper.appendChild(pdfLinkLayerDiv);

  // Interactive form-field overlay (populated only in form-fill mode).
  const formLayerDiv = document.createElement("div");
  formLayerDiv.className = "formLayer";
  wrapper.appendChild(formLayerDiv);

  pagesEl.appendChild(wrapper);

  const ctx = canvas.getContext("2d");
  // When the document carries /Highlight annotations we've pulled into the
  // removable overlay, tell PDF.js NOT to paint annotations onto the canvas —
  // otherwise each highlight is drawn twice and the canvas copy can't be
  // deleted. We only do this when there ARE such highlights, so ordinary PDFs
  // (including local ones with form fields) keep PDF.js's normal annotation
  // rendering; the only tradeoff is a doc that has both highlights and other
  // annotations, where the latter won't paint.
  const annotationMode = docHasAnnotationHighlights
    ? pdfjsLib.AnnotationMode.DISABLE
    : pdfjsLib.AnnotationMode.ENABLE;
  await page.render({ canvasContext: ctx, viewport, annotationMode }).promise;

  // Make the PDF's own hyperlinks clickable (PDF.js paints their visuals but
  // doesn't wire up clicks unless we overlay them ourselves).
  await placeNativeLinksForPage(page, viewport, pdfLinkLayerDiv);

  // In form-fill mode, (re)build the editable field overlays for this page —
  // this also runs on zoom re-renders, prefilled from any in-progress edits.
  if (formMode) await renderFormOverlaysForPage(page, viewport, formLayerDiv);

  let textContent = await page.getTextContent();
  if (ocrEnabled && pageNeedsOcr(textContent)) {
    // No usable PDF.js text layer (scan / image-only export). Recognize the
    // page and synthesize both the textLayer spans and a textContent-shaped
    // object so the linker, highlights, and footer naming work unchanged.
    // ocrPageToTextLayer caches per page, so this only OCRs once even though
    // renderAllPages re-runs on every zoom.
    textContent = await ocrPageToTextLayer({
      page,
      pageNumber,
      displayScale: viewport.scale,
      userHeight: userSpaceViewport.height,
      textLayerDiv,
      setStatus: (msg) => { statusEl.textContent = msg; },
    });
  } else {
    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport,
    });
    await textLayer.render();
  }

  excludeLineNumberColumn(textLayerDiv);

  return { pageNumber, textContent, textLayerDiv, linkLayerDiv, highlightLayerDiv, pageWrapper: wrapper, viewport: userSpaceViewport };
}

// Pleadings print line numbers (1–28) down the left margin. Those number spans
// are DOM-adjacent to the body text, so a normal drag-selection over the body
// sweeps them in too — the selection appears to jump to "the numbers on the
// side." Detect that left-margin numeric column and mark it non-selectable so
// it's excluded from any selection (the numbers stay visible on the canvas).
// Conservative on purpose — it only fires for a tall column of many bare 1–2
// digit numbers hugging the left edge, which is specifically pleading line
// numbering, not ordinary content.
function excludeLineNumberColumn(textLayerDiv) {
  const spans = textLayerDiv.querySelectorAll("span");
  if (spans.length < 8) return;
  const width = textLayerDiv.offsetWidth || 1;
  const height = textLayerDiv.offsetHeight || 1;
  const marginX = width * 0.08; // left 8% of the page
  const cand = [];
  for (const s of spans) {
    const t = (s.textContent || "").trim();
    if (!/^\d{1,2}$/.test(t)) continue;      // a bare 1–2 digit number
    if (s.offsetLeft > marginX) continue;    // hugging the left edge
    cand.push(s);
  }
  if (cand.length < 8) return;
  let minTop = Infinity, maxTop = -Infinity;
  for (const s of cand) {
    const y = s.offsetTop;
    if (y < minTop) minTop = y;
    if (y > maxTop) maxTop = y;
  }
  // Must span most of the page vertically to be a line-number column.
  if (maxTop - minTop < height * 0.4) return;
  for (const s of cand) {
    s.style.userSelect = "none";
    s.style.webkitUserSelect = "none";
  }
}

// --- Zoom controls ---
function setZoom(newScale) {
  currentScale = Math.max(0.5, Math.min(4.0, newScale));
  zoomLevelEl.textContent = `${Math.round(currentScale * 100)}%`;
  if (pdfDoc) renderAllPages();
}
zoomInEl.addEventListener("click",  () => setZoom(currentScale + 0.25));
zoomOutEl.addEventListener("click", () => setZoom(currentScale - 0.25));

// --- Click-to-rename for the toolbar filename ---
//
// Clicking the filename swaps it for an <input>; Enter or blur saves the
// new name, Escape cancels. The saved name becomes serverFilename, so the
// next Download uses it verbatim — no re-running through simplifyName,
// since the user's intent is "use exactly what I typed."
//
// Once the user has saved a name, userOverrodeName locks setDisplayName
// against later programmatic overwrites (footer extraction, Content-
// Disposition reads on a slow connection). The lock resets when a new
// PDF loads.
//
// Sanitization happens at download time via sanitizePdfFilename, so the
// user can type whatever they want here — illegal chars get cleaned at
// the boundary. Newlines and tabs are stripped on save just to keep the
// UI sane.
function startRename() {
  if (filenameEl.dataset.editing === "1") return;
  filenameEl.dataset.editing = "1";

  const current = filenameEl.textContent || "";
  const input = document.createElement("input");
  input.type = "text";
  input.id = "filename-input";
  input.value = current;
  input.spellcheck = false;
  input.autocomplete = "off";

  // Size the input to roughly fit the current text, with a sensible floor
  // and ceiling so it doesn't crowd the rest of the toolbar.
  input.size = Math.max(12, Math.min(60, current.length + 2));

  let committed = false;
  function commit(save) {
    if (committed) return;
    committed = true;
    const newName = save
      ? input.value.replace(/[\r\n\t]+/g, " ").trim()
      : current;
    // Empty save → treat as cancel (revert). Friendlier than blanking out
    // the name and falling back to "document".
    const finalName = (save && newName) ? newName : current;
    input.replaceWith(filenameEl);
    filenameEl.textContent = finalName;
    delete filenameEl.dataset.editing;
    if (save && newName && newName !== current) {
      userOverrodeName = true;
      serverFilename = finalName;  // already sanitized lightly above
      document.title = `${finalName} — PDF Viewer`;
      filenameEl.title = "Click to rename (overridden by you)";
      // Persist the user's revision as the entry's final name so it appears
      // in the history. (commit() sets filenameEl.textContent directly rather
      // than going through paintDisplayName, so record it explicitly here.)
      recordFinalName(finalName);
    }
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(true); }
    else if (e.key === "Escape") { e.preventDefault(); commit(false); }
  });
  input.addEventListener("blur", () => commit(true));

  filenameEl.replaceWith(input);
  input.focus();
  input.select();
}

filenameEl.addEventListener("click", startRename);
if (!filenameEl.title) filenameEl.title = "Click to rename";

// Toggle highlight mode. We don't need to re-render — the handlers
// installed by attachHighlightHandlers read the mode through a getter on
// each mouseup, so the new value takes effect immediately.
//
// Guarded: viewer.html may not (yet) contain a #highlight-toggle button.
// Without this guard, a missing button throws at module top-level, which
// aborts the rest of viewer.js and silently kills every listener below
// (Download, Open Original). Skip-if-absent is safe because highlight
// mode just stays in its default (off) state.
if (highlightToggleEl) {
  highlightToggleEl.addEventListener("click", () => {
    highlightMode = !highlightMode;
    highlightToggleEl.setAttribute("aria-pressed", String(highlightMode));
    document.body.classList.toggle("highlight-mode", highlightMode);
  });
}

// Rectangle-select tool toggle. Same guard rationale as the highlight toggle:
// skip if the button is absent so the rest of the listeners still wire up. The
// body class drives the crosshair cursor; the mode getter is read live by the
// per-page marquee handler in highlights.js.
if (rectSelectToggleEl) {
  rectSelectToggleEl.addEventListener("click", () => {
    rectSelectMode = !rectSelectMode;
    rectSelectToggleEl.setAttribute("aria-pressed", String(rectSelectMode));
    document.body.classList.toggle("rect-select-mode", rectSelectMode);
  });
}

// Download saves the original PDF to the user's Downloads folder. We trigger
// a regular browser download by creating an <a download> pointing at a blob
// built from the bytes we already fetched during initial load.
//
// Design intent: clicking Download means "save this file with the smart name
// and stop doing anything else." We use the cached bytes (no second fetch)
// and abort the in-flight render loop so PDF.js stops chewing through pages
// the user isn't waiting on. If the click lands before pages 1–2 have
// rendered (so the footer-derived filename isn't ready yet), we wait briefly
// for that pass to complete, then save with the better name.
downloadEl.addEventListener("click", async () => {
  if (!fileUrl) return;
  try {
    // If we haven't even fetched the bytes yet (Download clicked during the
    // initial fetch), fall back to a fresh fetch. This is the rare path.
    if (!pdfBytes) {
      statusEl.textContent = "Preparing download…";
      const resp = await fetch(fileUrl, { credentials: "include" });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      // If we still don't have a server-derived name, take this fetch's
      // Content-Disposition before we discard the response.
      if (!serverFilename) {
        const headerName = filenameFromContentDisposition(
          resp.headers.get("Content-Disposition")
        );
        if (headerName) setDisplayName(headerName);
      }
      pdfBytes = await resp.arrayBuffer();
    }

    // Wait briefly for the footer-title pass to complete if it hasn't yet.
    // The user explicitly chose "wait for the better name" over "save
    // immediately with whatever's available." Cap at 3s so a slow or
    // unusual PDF can't hang the download — past the timeout, we save
    // with whatever name is currently set.
    //
    // Important: we wait BEFORE aborting. If we aborted first, the render
    // loop would bail at the next signal check and never reach the footer
    // pass — so the promise we're waiting on would never resolve.
    if (footerTitleResolved) {
      statusEl.textContent = "Preparing download…";
      await Promise.race([
        footerTitleResolved,
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    }

    // Now stop the citation pipeline. Pages 1–2 have rendered (or the
    // 3s budget elapsed); we don't need pages 3+, link detection, or
    // link placement to finish. The user wants the file, not the links.
    if (renderAbort) renderAbort.abort();

    // Pick the best source name from this priority chain:
    //   1. serverFilename — already-simplified name set by setDisplayName
    //      (footer extraction or Content-Disposition pass).
    //   2. Name guessed from the URL.
    //   3. Literal "document".
    let chosen;
    if (serverFilename) {
      chosen = serverFilename; // already reflects the naming settings
    } else {
      const raw = filenameFromUrl(fileUrl) || "document";
      chosen = computeSourceDisplay(raw.replace(/\.pdf$/i, "")) || raw;
    }
    const filename = sanitizePdfFilename(chosen);

    // Build a blob from the cached bytes. .slice(0) so we don't transfer
    // ownership of pdfBytes — a subsequent Download click should still work.
    const blob = new Blob([pdfBytes.slice(0)], { type: "application/pdf" });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    statusEl.textContent = "Downloaded.";

    // Autoclose the viewer tab. The download is a separate Chrome
    // transaction by the time a.click() returns (the blob's been handed
    // off), so closing immediately doesn't cancel it. We try window.close()
    // first because it doesn't require the tabs permission, but Chrome
    // blocks it on tabs that weren't script-opened — which includes our
    // most common entry path (DNR redirect from a clicked PDF link). The
    // chrome.tabs.remove fallback always works since the tabs permission
    // is granted in manifest.json.
    //
    // We don't revokeObjectURL here on purpose: the tab going away tears
    // down the blob with it, so the usual 60s setTimeout cleanup would
    // never fire anyway. No leak.
    setTimeout(() => {
      window.close();
      // If window.close() was blocked, we'll still be here a tick later.
      chrome.tabs.getCurrent((tab) => {
        if (tab && tab.id != null) chrome.tabs.remove(tab.id);
      });
    }, 150);  // brief delay lets the user see "Downloaded." before the tab vanishes
  } catch (err) {
    console.error("Download failed:", err);
    statusEl.textContent = "Download failed: " + err.message;
    alert("Download failed: " + err.message);
  }
});

// Open in Chrome's built-in PDF viewer (no citation links). Useful when the
// user wants to print, fill a form, or use Chrome's PDF features. The
// extension's DNR rule will redirect again if the URL goes through the address
// bar, so we use #__nolink in the hash to bypass — the rule's regexFilter
// doesn't match URLs containing that fragment.
//
// Simpler: just window.open the file URL with a query that signals "skip our
// viewer". We add it via a tab navigation that bypasses our redirect by going
// through chrome.tabs API... but that needs a permission we don't have here.
// Easiest practical answer: open the original URL in a new tab and tell the
// user to use Chrome's "Always open PDFs in Adobe" or temporarily disable the
// extension. For now we just navigate to the file URL — Chrome's redirect
// will catch it again, but at least the user has the URL.
openOriginalEl.addEventListener("click", () => {
  if (!fileUrl) return;
  // Append the bypass token. The background script's high-priority allow
  // rule matches URLs containing this token and skips redirect, so the URL
  // opens in Chrome's built-in PDF viewer.
  const sep = fileUrl.includes("?") ? "&" : "?";
  const bypassUrl = fileUrl + sep + "citationlinker=skip";
  window.open(bypassUrl, "_blank");
});
zoomLevelEl.textContent = `${Math.round(currentScale * 100)}%`;

// ── Thumbnail / bookmark panel ─────────────────────────────────────────────

const thumbnailToggleEl = document.getElementById("thumbnail-toggle");
const thumbnailPanelEl  = document.getElementById("thumbnail-panel");
const panelPagesEl      = document.getElementById("panel-pages");
const panelBookmarksEl  = document.getElementById("panel-bookmarks");
const tabPagesEl        = document.getElementById("tab-pages");
const tabBookmarksEl    = document.getElementById("tab-bookmarks");
const THUMB_SCALE = 0.15;

let thumbsRendered = false;

async function renderThumbnails() {
  if (!pdfDoc || thumbsRendered) return;
  thumbsRendered = true;
  panelPagesEl.innerHTML = "";
  for (let pn = 1; pn <= pdfDoc.numPages; pn++) {
    const page = await pdfDoc.getPage(pn);
    const vp = page.getViewport({ scale: THUMB_SCALE });
    const item = document.createElement("div");
    item.className = "thumb-item";
    item.dataset.page = pn;
    const canvas = document.createElement("canvas");
    canvas.width  = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    const label = document.createElement("span");
    label.className = "thumb-label";
    label.textContent = pn;
    item.appendChild(canvas);
    item.appendChild(label);
    item.addEventListener("click", () => scrollToPage(pn));
    panelPagesEl.appendChild(item);
  }
  updateActiveThumbnail();
}

function scrollToPage(pn) {
  const wrappers = pagesEl.querySelectorAll(".page-wrapper");
  const target = wrappers[pn - 1];
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateActiveThumbnail() {
  if (!pdfDoc || !thumbnailPanelEl.classList.contains("open")) return;
  const wrappers = pagesEl.querySelectorAll(".page-wrapper");
  if (!wrappers.length) return;
  const mid = window.scrollY + window.innerHeight / 2;
  let activePage = 1;
  let minDist = Infinity;
  wrappers.forEach((w, i) => {
    const rect = w.getBoundingClientRect();
    const pageMid = window.scrollY + rect.top + rect.height / 2;
    const dist = Math.abs(pageMid - mid);
    if (dist < minDist) { minDist = dist; activePage = i + 1; }
  });
  panelPagesEl.querySelectorAll(".thumb-item").forEach(el => {
    el.classList.toggle("active", Number(el.dataset.page) === activePage);
  });
}

document.addEventListener("scroll", updateActiveThumbnail, { passive: true });

// Resolve a PDF.js outline destination to a 1-based page number.
async function destToPageNum(dest) {
  if (!dest) return null;
  try {
    const resolved = typeof dest === "string"
      ? await pdfDoc.getDestination(dest)
      : dest;
    if (!resolved || !resolved[0]) return null;
    const pageIndex = await pdfDoc.getPageIndex(resolved[0]);
    return pageIndex + 1;
  } catch {
    return null;
  }
}

function buildBookmarkTree(items, container) {
  for (const item of items) {
    const btn = document.createElement("button");
    btn.className = "bookmark-item";
    btn.textContent = item.title || "(untitled)";
    btn.title = item.title || "";
    btn.addEventListener("click", async () => {
      const pn = await destToPageNum(item.dest);
      if (pn) scrollToPage(pn);
    });
    container.appendChild(btn);
    if (item.items && item.items.length) {
      const children = document.createElement("div");
      children.className = "bookmark-children";
      buildBookmarkTree(item.items, children);
      container.appendChild(children);
    }
  }
}

async function loadBookmarks() {
  if (!pdfDoc || panelBookmarksEl.dataset.loaded) return;
  panelBookmarksEl.dataset.loaded = "1";
  const outline = await pdfDoc.getOutline();
  if (!outline || !outline.length) return;
  panelBookmarksEl.innerHTML = "";
  buildBookmarkTree(outline, panelBookmarksEl);
}

async function maybeShowBookmarksTab() {
  if (!pdfDoc || !tabBookmarksEl) return;
  const outline = await pdfDoc.getOutline();
  tabBookmarksEl.hidden = !outline || !outline.length;
}

function switchTab(tab) {
  const showPages = tab === "pages";
  tabPagesEl.classList.toggle("active", showPages);
  tabPagesEl.setAttribute("aria-pressed", String(showPages));
  tabBookmarksEl.classList.toggle("active", !showPages);
  tabBookmarksEl.setAttribute("aria-pressed", String(!showPages));
  panelPagesEl.hidden = !showPages;
  panelBookmarksEl.hidden = showPages;
}

if (tabPagesEl)     tabPagesEl.addEventListener("click",     () => switchTab("pages"));
if (tabBookmarksEl) tabBookmarksEl.addEventListener("click", async () => {
  switchTab("bookmarks");
  await loadBookmarks();
});

if (thumbnailToggleEl) {
  thumbnailToggleEl.addEventListener("click", async () => {
    const open = thumbnailPanelEl.classList.toggle("open");
    document.body.classList.toggle("thumbs-open", open);
    thumbnailToggleEl.setAttribute("aria-pressed", String(open));
    if (open) {
      await renderThumbnails();
      await maybeShowBookmarksTab();
    }
  });
}

// ── Organize pages: reorder / rotate / delete / extract ─────────────────────
//
// Turns the Pages panel into an editor. Changes are collected into a page
// "plan" (order + per-page rotation; omitted pages are deletions) and applied
// only on "Apply & Save": current highlights are baked into the file first,
// then the plan is applied with pdf-lib (which carries each page's annotations
// along), and the viewer reloads from the result. Extract writes the checked
// pages to a *new* file, leaving the current document untouched.
const organizeBarEl = document.getElementById("organize-bar");
const orgApplyEl    = document.getElementById("org-apply");
const orgExtractEl  = document.getElementById("org-extract");
const orgResetEl    = document.getElementById("org-reset");
const orgDoneEl     = document.getElementById("org-done");

let organizeMode = false;
let pagePlan = [];             // [{ id, srcIndex(0-based), rotate(0/90/180/270) }]
const organizeSel = new Set(); // plan-entry ids checked for extract
const thumbDataUrlCache = new Map(); // srcIndex -> dataURL
let _planSeq = 0;
let _dragId = null;

function saveNameForDoc() {
  return sanitizePdfFilename(serverFilename || "document");
}

async function bakeCurrentHighlights() {
  // Highlights → annotations in the bytes, so page moves/rotations carry them.
  return buildEditedPdf({ srcBytes: pdfBytes.slice(0), highlightsByPage: collectHighlightPdfRects() });
}

async function buildThumbCache() {
  if (!pdfDoc) return;
  for (let i = 0; i < pdfDoc.numPages; i++) {
    if (thumbDataUrlCache.has(i)) continue;
    const page = await pdfDoc.getPage(i + 1);
    const vp = page.getViewport({ scale: THUMB_SCALE });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    thumbDataUrlCache.set(i, c.toDataURL());
  }
}

function ctrlBtn(glyph, title, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "org-ctrl";
  b.textContent = glyph;
  b.title = title;
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function updateOrganizeButtons() {
  if (orgExtractEl) orgExtractEl.disabled = organizeSel.size === 0;
}

function renderOrganizeList() {
  panelPagesEl.innerHTML = "";
  pagePlan.forEach((entry, idx) => {
    const item = document.createElement("div");
    item.className = "thumb-item organize";
    item.draggable = true;
    item.dataset.id = String(entry.id);

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.className = "org-check";
    chk.checked = organizeSel.has(entry.id);
    chk.title = "Check to include in Extract";
    chk.addEventListener("click", (e) => e.stopPropagation());
    chk.addEventListener("change", () => {
      if (chk.checked) organizeSel.add(entry.id); else organizeSel.delete(entry.id);
      updateOrganizeButtons();
    });

    const box = document.createElement("div");
    box.className = "org-thumb-box";
    const img = document.createElement("img");
    img.className = "org-thumb";
    img.src = thumbDataUrlCache.get(entry.srcIndex) || "";
    img.style.transform = `rotate(${entry.rotate}deg)`;
    box.appendChild(img);

    const label = document.createElement("span");
    label.className = "thumb-label";
    label.textContent = entry.srcIndex + 1 === idx + 1
      ? `${idx + 1}`
      : `${idx + 1} · was ${entry.srcIndex + 1}`;

    const controls = document.createElement("div");
    controls.className = "org-controls";
    controls.append(
      ctrlBtn("↑", "Move up", () => moveEntry(idx, -1)),
      ctrlBtn("↓", "Move down", () => moveEntry(idx, 1)),
      ctrlBtn("⟳", "Rotate 90°", () => rotateEntry(idx)),
      ctrlBtn("✕", "Delete page", () => deleteEntry(idx)),
    );

    item.append(chk, box, label, controls);

    item.addEventListener("dragstart", (e) => {
      _dragId = entry.id;
      item.classList.add("dragging");
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragend", () => { _dragId = null; item.classList.remove("dragging"); });
    item.addEventListener("dragover", (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "move"; });
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      if (_dragId != null && _dragId !== entry.id) reorderPlan(_dragId, entry.id);
    });

    panelPagesEl.appendChild(item);
  });
  updateOrganizeButtons();
}

function moveEntry(idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= pagePlan.length) return;
  [pagePlan[idx], pagePlan[j]] = [pagePlan[j], pagePlan[idx]];
  renderOrganizeList();
}

function rotateEntry(idx) {
  pagePlan[idx].rotate = (pagePlan[idx].rotate + 90) % 360;
  renderOrganizeList();
}

function deleteEntry(idx) {
  if (pagePlan.length <= 1) { statusEl.textContent = "A document must keep at least one page."; return; }
  const [removed] = pagePlan.splice(idx, 1);
  organizeSel.delete(removed.id);
  renderOrganizeList();
}

function reorderPlan(dragId, targetId) {
  const from = pagePlan.findIndex((p) => p.id === dragId);
  if (from < 0) return;
  const [moved] = pagePlan.splice(from, 1);
  const to = pagePlan.findIndex((p) => p.id === targetId);
  pagePlan.splice(to < 0 ? pagePlan.length : to, 0, moved);
  renderOrganizeList();
}

function resetPlanToIdentity() {
  pagePlan = [];
  organizeSel.clear();
  for (let i = 0; i < (pdfDoc ? pdfDoc.numPages : 0); i++) {
    pagePlan.push({ id: ++_planSeq, srcIndex: i, rotate: 0 });
  }
}

function resetOrganizeState() {
  organizeMode = false;
  if (organizeBarEl) organizeBarEl.hidden = true;
  if (organizeEl) organizeEl.setAttribute("aria-pressed", "false");
  document.body.classList.remove("organize-mode");
  pagePlan = [];
  organizeSel.clear();
}

async function enterOrganize() {
  if (!editingAllowed || !pdfDoc || organizeMode) return;
  // Open the panel WITHOUT the toggle handler's normal-thumbnail render — that
  // runs async and would interleave with the organize list we build below.
  if (!thumbnailPanelEl.classList.contains("open")) {
    thumbnailPanelEl.classList.add("open");
    document.body.classList.add("thumbs-open");
    if (thumbnailToggleEl) thumbnailToggleEl.setAttribute("aria-pressed", "true");
  }
  switchTab("pages");
  statusEl.textContent = "Preparing pages…";
  await buildThumbCache();
  resetPlanToIdentity();
  organizeMode = true;
  if (organizeBarEl) organizeBarEl.hidden = false;
  if (organizeEl) organizeEl.setAttribute("aria-pressed", "true");
  document.body.classList.add("organize-mode");
  renderOrganizeList();
  statusEl.textContent = "";
}

async function exitOrganize() {
  resetOrganizeState();
  thumbsRendered = false;
  panelPagesEl.innerHTML = "";
  if (thumbnailPanelEl.classList.contains("open")) await renderThumbnails();
}

// Reload the viewer from freshly-edited bytes, refreshing pages, highlights,
// and thumbnails while leaving the display name/naming choice intact.
async function reloadEditedBytes(out) {
  resetOrganizeState();
  clearAllHighlights();
  thumbDataUrlCache.clear();
  thumbsRendered = false;
  panelPagesEl.innerHTML = "";
  await renderBytes(out.slice(0));
  if (thumbnailPanelEl.classList.contains("open")) await renderThumbnails();
}

async function applyOrganize() {
  if (!organizeMode || !pdfBytes) return;
  if (orgApplyEl) orgApplyEl.disabled = true;
  try {
    statusEl.textContent = "Applying page changes…";
    const baked = await bakeCurrentHighlights();
    const plan = pagePlan.map((p) => ({ srcIndex: p.srcIndex, rotate: p.rotate }));
    const out = await applyPagePlan({ srcBytes: baked, plan });
    const ok = await writeOutPdf(out, saveNameForDoc(), { inPlace: true });
    if (ok) { await reloadEditedBytes(out); statusEl.textContent = "Saved."; }
    else statusEl.textContent = "";
  } catch (e) {
    console.error("[pdf-viewer] organize failed:", e);
    statusEl.textContent = "Page changes failed.";
  } finally {
    if (orgApplyEl) orgApplyEl.disabled = false;
  }
}

async function extractSelectedPages() {
  const sel = pagePlan.filter((p) => organizeSel.has(p.id));
  if (!sel.length) { statusEl.textContent = "No pages checked to extract."; return; }
  if (!pdfBytes) return;
  if (orgExtractEl) orgExtractEl.disabled = true;
  try {
    statusEl.textContent = "Extracting…";
    const baked = await bakeCurrentHighlights();
    const out = await applyPagePlan({
      srcBytes: baked,
      plan: sel.map((p) => ({ srcIndex: p.srcIndex, rotate: p.rotate })),
    });
    const ok = await writeOutPdf(out, `${saveNameForDoc()} (extract).pdf`);
    statusEl.textContent = ok ? `Extracted ${sel.length} page${sel.length === 1 ? "" : "s"}.` : "";
  } catch (e) {
    console.error("[pdf-viewer] extract failed:", e);
    statusEl.textContent = "Extract failed.";
  } finally {
    if (orgExtractEl) orgExtractEl.disabled = false;
  }
}

if (organizeEl) organizeEl.addEventListener("click", () => {
  if (organizeMode) exitOrganize(); else enterOrganize();
});
if (orgApplyEl)   orgApplyEl.addEventListener("click", applyOrganize);
if (orgExtractEl) orgExtractEl.addEventListener("click", extractSelectedPages);
if (orgResetEl)   orgResetEl.addEventListener("click", () => { resetPlanToIdentity(); renderOrganizeList(); });
if (orgDoneEl)    orgDoneEl.addEventListener("click", exitOrganize);

// ── Bates numbering ─────────────────────────────────────────────────────────
const batesModalEl    = document.getElementById("bates-modal");
const batesPrefixEl   = document.getElementById("bates-prefix");
const batesStartEl    = document.getElementById("bates-start");
const batesDigitsEl   = document.getElementById("bates-digits");
const batesPositionEl = document.getElementById("bates-position");
const batesPreviewEl  = document.getElementById("bates-preview");
const batesCancelEl   = document.getElementById("bates-cancel");
const batesApplyEl    = document.getElementById("bates-apply");

function batesDigits() { return Math.min(12, Math.max(1, parseInt(batesDigitsEl.value, 10) || 6)); }
function batesStart()  { const n = parseInt(batesStartEl.value, 10); return Number.isFinite(n) && n >= 0 ? n : 1; }

function updateBatesPreview() {
  if (!batesPreviewEl) return;
  batesPreviewEl.textContent = `${batesPrefixEl.value || ""}${String(batesStart()).padStart(batesDigits(), "0")}`;
}

function openBatesModal() {
  if (!editingAllowed || !batesModalEl) return;
  updateBatesPreview();
  batesModalEl.hidden = false;
}
function closeBatesModal() { if (batesModalEl) batesModalEl.hidden = true; }

async function applyBates() {
  if (!pdfBytes) { statusEl.textContent = "PDF not loaded yet."; return; }
  if (batesApplyEl) batesApplyEl.disabled = true;
  try {
    statusEl.textContent = "Adding Bates numbers…";
    const baked = await bakeCurrentHighlights();
    const out = await stampBates({
      srcBytes: baked,
      prefix: batesPrefixEl.value || "",
      start: batesStart(),
      digits: batesDigits(),
      position: batesPositionEl.value || "br",
    });
    const ok = await writeOutPdf(out, saveNameForDoc(), { inPlace: true });
    if (ok) { closeBatesModal(); await reloadEditedBytes(out); statusEl.textContent = "Saved."; }
    else statusEl.textContent = "";
  } catch (e) {
    console.error("[pdf-viewer] bates failed:", e);
    statusEl.textContent = "Bates numbering failed.";
  } finally {
    if (batesApplyEl) batesApplyEl.disabled = false;
  }
}

if (batesEl)       batesEl.addEventListener("click", openBatesModal);
if (batesCancelEl) batesCancelEl.addEventListener("click", closeBatesModal);
if (batesApplyEl)  batesApplyEl.addEventListener("click", applyBates);
if (batesModalEl)  batesModalEl.addEventListener("click", (e) => { if (e.target === batesModalEl) closeBatesModal(); });
[batesPrefixEl, batesStartEl, batesDigitsEl].forEach((el) => {
  if (el) el.addEventListener("input", updateBatesPreview);
});

// Generic "stamp then save in place and reload" runner shared by the
// header/footer and watermark tools.
async function runStampAndSave(makeBytes, busyMsg, applyBtn) {
  if (!pdfBytes) { statusEl.textContent = "PDF not loaded yet."; return false; }
  if (applyBtn) applyBtn.disabled = true;
  try {
    statusEl.textContent = busyMsg;
    const baked = await bakeCurrentHighlights();
    const out = await makeBytes(baked);
    const ok = await writeOutPdf(out, saveNameForDoc(), { inPlace: true });
    if (ok) { await reloadEditedBytes(out); statusEl.textContent = "Saved."; }
    else statusEl.textContent = "";
    return ok;
  } catch (e) {
    console.error("[pdf-viewer] stamp failed:", e);
    statusEl.textContent = "Stamp failed.";
    return false;
  } finally {
    if (applyBtn) applyBtn.disabled = false;
  }
}

// ── Header / footer ─────────────────────────────────────────────────────────
const hfModalEl  = document.getElementById("hf-modal");
const hfCancelEl = document.getElementById("hf-cancel");
const hfApplyEl  = document.getElementById("hf-apply");
const hfInputs = {
  hl: document.getElementById("hf-hl"), hc: document.getElementById("hf-hc"), hr: document.getElementById("hf-hr"),
  fl: document.getElementById("hf-fl"), fc: document.getElementById("hf-fc"), fr: document.getElementById("hf-fr"),
};
function openHfModal()  { if (editingAllowed && hfModalEl) hfModalEl.hidden = false; }
function closeHfModal() { if (hfModalEl) hfModalEl.hidden = true; }
async function applyHeaderFooter() {
  const slots = {};
  let any = false;
  for (const k of Object.keys(hfInputs)) {
    const v = hfInputs[k] ? hfInputs[k].value.trim() : "";
    if (v) { slots[k] = v; any = true; }
  }
  if (!any) { statusEl.textContent = "Enter header or footer text first."; return; }
  const ok = await runStampAndSave(
    (baked) => stampHeaderFooter({ srcBytes: baked, slots }),
    "Adding header/footer…", hfApplyEl,
  );
  if (ok) closeHfModal();
}
if (headerFooterEl) headerFooterEl.addEventListener("click", openHfModal);
if (hfCancelEl)     hfCancelEl.addEventListener("click", closeHfModal);
if (hfApplyEl)      hfApplyEl.addEventListener("click", applyHeaderFooter);
if (hfModalEl)      hfModalEl.addEventListener("click", (e) => { if (e.target === hfModalEl) closeHfModal(); });

// ── Watermark ───────────────────────────────────────────────────────────────
const wmModalEl    = document.getElementById("watermark-modal");
const wmTextEl     = document.getElementById("wm-text");
const wmSizeEl     = document.getElementById("wm-size");
const wmOpacityEl  = document.getElementById("wm-opacity");
const wmColorEl    = document.getElementById("wm-color");
const wmDiagonalEl = document.getElementById("wm-diagonal");
const wmCancelEl   = document.getElementById("wm-cancel");
const wmApplyEl    = document.getElementById("wm-apply");
const WM_COLORS = { gray: [0.5, 0.5, 0.5], red: [0.8, 0.1, 0.1], blue: [0.1, 0.3, 0.8], black: [0, 0, 0] };
function openWmModal()  { if (editingAllowed && wmModalEl) wmModalEl.hidden = false; }
function closeWmModal() { if (wmModalEl) wmModalEl.hidden = true; }
async function applyWatermark() {
  const text = wmTextEl ? wmTextEl.value.trim() : "";
  if (!text) { statusEl.textContent = "Enter watermark text first."; return; }
  const fontSize = Math.min(200, Math.max(8, parseInt(wmSizeEl.value, 10) || 60));
  const opacity = Math.min(1, Math.max(0.01, (parseInt(wmOpacityEl.value, 10) || 15) / 100));
  const color = WM_COLORS[wmColorEl.value] || WM_COLORS.gray;
  const diagonal = !!(wmDiagonalEl && wmDiagonalEl.checked);
  const ok = await runStampAndSave(
    (baked) => stampWatermark({ srcBytes: baked, text, fontSize, opacity, color, diagonal }),
    "Adding watermark…", wmApplyEl,
  );
  if (ok) closeWmModal();
}
if (watermarkEl) watermarkEl.addEventListener("click", openWmModal);
if (wmCancelEl)  wmCancelEl.addEventListener("click", closeWmModal);
if (wmApplyEl)   wmApplyEl.addEventListener("click", applyWatermark);
if (wmModalEl)   wmModalEl.addEventListener("click", (e) => { if (e.target === wmModalEl) closeWmModal(); });

// ── Split into multiple PDFs ────────────────────────────────────────────────
const splitModalEl   = document.getElementById("split-modal");
const splitModeEl    = document.getElementById("split-mode");
const splitChunkEl   = document.getElementById("split-chunk");
const splitChunkRow  = document.getElementById("split-chunk-row");
const splitRangesEl  = document.getElementById("split-ranges");
const splitRangesRow = document.getElementById("split-ranges-row");
const splitSummaryEl = document.getElementById("split-summary");
const splitCancelEl  = document.getElementById("split-cancel");
const splitApplyEl   = document.getElementById("split-apply");

// Consecutive-index groups of at most `n` pages: [[0,1],[2,3],[4]] for n=2.
function chunkGroups(total, n) {
  const size = Math.max(1, Math.floor(n) || 1);
  const groups = [];
  for (let i = 0; i < total; i += size) {
    const g = [];
    for (let k = i; k < Math.min(i + size, total); k++) g.push(k);
    groups.push(g);
  }
  return groups;
}

// Parse "1-3, 5, 8-" into 0-based index groups (one group per token). An open
// end ("8-") runs to the last page; an open start ("-3") starts at page 1.
function parseRanges(str, total) {
  const groups = [];
  for (const tokRaw of String(str || "").split(",")) {
    const tok = tokRaw.trim();
    if (!tok) continue;
    let a, b;
    if (tok.includes("-")) {
      const [s, e] = tok.split("-");
      a = s.trim() === "" ? 1 : parseInt(s, 10);
      b = e.trim() === "" ? total : parseInt(e, 10);
    } else {
      a = b = parseInt(tok, 10);
    }
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    a = Math.max(1, Math.min(total, a));
    b = Math.max(1, Math.min(total, b));
    if (a > b) [a, b] = [b, a];
    const idx = [];
    for (let p = a; p <= b; p++) idx.push(p - 1);
    if (idx.length) groups.push(idx);
  }
  return groups;
}

function splitGroups() {
  const total = pdfDoc ? pdfDoc.numPages : 0;
  const mode = splitModeEl ? splitModeEl.value : "chunks";
  if (mode === "single") return chunkGroups(total, 1);
  if (mode === "ranges") return parseRanges(splitRangesEl ? splitRangesEl.value : "", total);
  return chunkGroups(total, parseInt(splitChunkEl ? splitChunkEl.value : "1", 10));
}

function updateSplitUi() {
  const mode = splitModeEl ? splitModeEl.value : "chunks";
  if (splitChunkRow)  splitChunkRow.hidden  = mode !== "chunks";
  if (splitRangesRow) splitRangesRow.hidden = mode !== "ranges";
  const n = splitGroups().length;
  if (splitSummaryEl) splitSummaryEl.textContent = n ? `${n} file${n === 1 ? "" : "s"}` : "—";
  if (splitApplyEl) splitApplyEl.disabled = n === 0;
}

function partName(base, indices) {
  const first = indices[0] + 1;
  const last = indices[indices.length - 1] + 1;
  const span = first === last ? `p${first}` : `p${first}-${last}`;
  return `${base} ${span}.pdf`;
}

function openSplitModal() {
  if (!editingAllowed || !splitModalEl) return;
  updateSplitUi();
  splitModalEl.hidden = false;
}
function closeSplitModal() { if (splitModalEl) splitModalEl.hidden = true; }

async function applySplit() {
  if (!pdfBytes) { statusEl.textContent = "PDF not loaded yet."; return; }
  const groups = splitGroups();
  if (!groups.length) { statusEl.textContent = "Nothing to split — check your ranges."; return; }
  // Ask for the destination folder FIRST, while the click's user activation is
  // still fresh (the pdf-lib work below is async and would consume it).
  if (splitApplyEl) splitApplyEl.disabled = true;
  try {
    const base = saveNameForDoc().replace(/\.pdf$/i, "");
    let dirHandle = null;
    let useFolder = false;
    if (window.showDirectoryPicker) {
      try {
        dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
        useFolder = true;
      } catch (e) {
        if (e && e.name === "AbortError") { statusEl.textContent = ""; return; }
      }
    }
    statusEl.textContent = "Splitting…";
    const baked = await bakeCurrentHighlights();
    const parts = await splitPdf({ srcBytes: baked, groups });
    if (!parts.length) { statusEl.textContent = "Nothing to split."; return; }
    let written = 0;
    for (const part of parts) {
      const name = partName(base, part.indices);
      const blob = new Blob([part.bytes], { type: "application/pdf" });
      if (useFolder && dirHandle) {
        const fh = await dirHandle.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = name; a.click();
        URL.revokeObjectURL(url);
      }
      written++;
    }
    closeSplitModal();
    statusEl.textContent = useFolder
      ? `Saved ${written} file${written === 1 ? "" : "s"} to the folder.`
      : `Downloaded ${written} file${written === 1 ? "" : "s"}.`;
  } catch (e) {
    console.error("[pdf-viewer] split failed:", e);
    statusEl.textContent = "Split failed.";
  } finally {
    if (splitApplyEl) splitApplyEl.disabled = false;
  }
}

if (splitEl)       splitEl.addEventListener("click", openSplitModal);
if (splitCancelEl) splitCancelEl.addEventListener("click", closeSplitModal);
if (splitApplyEl)  splitApplyEl.addEventListener("click", applySplit);
if (splitModalEl)  splitModalEl.addEventListener("click", (e) => { if (e.target === splitModalEl) closeSplitModal(); });
[splitModeEl, splitChunkEl, splitRangesEl].forEach((el) => {
  if (el) el.addEventListener("input", updateSplitUi);
});

// ── Add images as pages ─────────────────────────────────────────────────────
function loadImageEl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// Normalize an image File to bytes pdf-lib can embed. JPEG/PNG pass through
// untouched (no re-encode, no quality loss); anything else the browser can
// decode (WebP, GIF, BMP…) is drawn to a canvas and exported as PNG.
async function normalizeImageFile(file) {
  const ab = await file.arrayBuffer();
  const type = (file.type || "").toLowerCase();
  if (type === "image/jpeg" || type === "image/jpg") return { bytes: new Uint8Array(ab), format: "jpg" };
  if (type === "image/png") return { bytes: new Uint8Array(ab), format: "png" };
  const url = URL.createObjectURL(new Blob([ab], { type: type || "application/octet-stream" }));
  try {
    const img = await loadImageEl(url);
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return null;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0);
    const pngBlob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (!pngBlob) return null;
    return { bytes: new Uint8Array(await pngBlob.arrayBuffer()), format: "png" };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function addImagesAsPages() {
  if (!editingAllowed || !pdfBytes) return;
  if (!window.showOpenFilePicker) { statusEl.textContent = "File picker unavailable here."; return; }
  let handles;
  try {
    handles = await window.showOpenFilePicker({
      multiple: true,
      types: [{ description: "Images", accept: { "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"] } }],
    });
  } catch (e) {
    if (e && e.name === "AbortError") return;
    throw e;
  }
  if (!handles || !handles.length) return;
  if (imagesEl) imagesEl.disabled = true;
  try {
    statusEl.textContent = "Adding images…";
    const images = [];
    for (const h of handles) {
      const norm = await normalizeImageFile(await h.getFile());
      if (norm) images.push(norm);
    }
    if (!images.length) { statusEl.textContent = "No usable images."; return; }
    const baked = await bakeCurrentHighlights();
    const out = await appendImagesAsPages({ srcBytes: baked, images });
    const ok = await writeOutPdf(out, saveNameForDoc(), { inPlace: true });
    if (ok) {
      await reloadEditedBytes(out);
      const n = images.length;
      statusEl.textContent = `Added ${n} image page${n === 1 ? "" : "s"} at the end.`;
    } else statusEl.textContent = "";
  } catch (e) {
    console.error("[pdf-viewer] add images failed:", e);
    statusEl.textContent = "Adding images failed.";
  } finally {
    if (imagesEl) imagesEl.disabled = false;
  }
}

if (imagesEl) imagesEl.addEventListener("click", addImagesAsPages);

// ── Edit ▾ dropdown ─────────────────────────────────────────────────────────
// Houses every document-editing action (Combine, Organize, Split, Images,
// Bates, Header/Footer, Watermark). Each item keeps its own click handler
// (wired above); this just opens/closes the menu and closes it after a pick.
function closeEditMenu() {
  if (!editMenuEl || editMenuEl.hidden) return;
  editMenuEl.hidden = true;
  if (editMenuBtn) editMenuBtn.setAttribute("aria-expanded", "false");
  document.removeEventListener("mousedown", onEditMenuOutside, true);
  document.removeEventListener("keydown", onEditMenuKey, true);
}
function openEditMenu() {
  if (!editMenuEl) return;
  editMenuEl.hidden = false;
  if (editMenuBtn) editMenuBtn.setAttribute("aria-expanded", "true");
  document.addEventListener("mousedown", onEditMenuOutside, true);
  document.addEventListener("keydown", onEditMenuKey, true);
}
function onEditMenuOutside(e) {
  if (editMenuWrap && !editMenuWrap.contains(e.target)) closeEditMenu();
}
function onEditMenuKey(e) {
  if (e.key === "Escape") { closeEditMenu(); if (editMenuBtn) editMenuBtn.focus(); }
}
if (editMenuBtn) editMenuBtn.addEventListener("click", () => {
  if (editMenuEl && editMenuEl.hidden) openEditMenu(); else closeEditMenu();
});
// Close after any item is chosen (the item's own handler has already run in the
// target phase before this bubbling listener fires).
if (editMenuEl) editMenuEl.addEventListener("click", (e) => {
  if (e.target.closest('button[role="menuitem"]')) closeEditMenu();
});

// ── Fill form ───────────────────────────────────────────────────────────────
// Renders editable HTML controls over the PDF's AcroForm fields. Edits are kept
// in `formValues` (keyed by field name) so they survive zoom re-renders; on save
// they're written back with pdf-lib's form API, optionally flattened.
const fillFormEl   = document.getElementById("fill-form");
const formBarEl    = document.getElementById("form-bar");
const formSaveEl   = document.getElementById("form-save");
const formFlattenEl = document.getElementById("form-flatten");
const formCancelEl = document.getElementById("form-cancel");

let formMode = false;
let docHasForm = false;
const formValues = new Map(); // fieldName -> string | boolean | string[]
const WIDGET_ANNOTATION_TYPE = 20; // pdfjsLib.AnnotationType.WIDGET

function updateFormMenuItem() {
  if (fillFormEl) fillFormEl.hidden = !docHasForm;
}

async function renderFormOverlaysForPage(page, viewport, layerDiv) {
  layerDiv.innerHTML = "";
  let annots;
  try {
    annots = await page.getAnnotations({ intent: "display" });
  } catch {
    return;
  }
  for (const a of annots) {
    if (!a || a.annotationType !== WIDGET_ANNOTATION_TYPE || !a.fieldName || !a.rect) continue;
    if (a.fieldType === "Btn" && a.pushButton) continue; // action buttons have no value
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect);
    const left = Math.min(x1, x2), top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1), height = Math.abs(y2 - y1);
    if (width < 2 || height < 2) continue;
    const name = a.fieldName;
    const stored = formValues.has(name) ? formValues.get(name) : undefined;
    let ctrl = null;

    if (a.fieldType === "Tx") {
      ctrl = a.multiLine ? document.createElement("textarea") : document.createElement("input");
      if (!a.multiLine) ctrl.type = "text";
      const cur = stored !== undefined ? stored : (a.fieldValue || "");
      ctrl.value = cur == null ? "" : String(cur);
      if (a.maxLen) ctrl.maxLength = a.maxLen;
      ctrl.style.fontSize = `${Math.max(8, Math.min(height * 0.7, 16))}px`;
      ctrl.addEventListener("input", () => formValues.set(name, ctrl.value));
    } else if (a.fieldType === "Btn" && a.checkBox) {
      ctrl = document.createElement("input");
      ctrl.type = "checkbox";
      const cur = stored !== undefined ? stored : !!(a.fieldValue && a.fieldValue !== "Off");
      ctrl.checked = !!cur;
      ctrl.addEventListener("change", () => formValues.set(name, ctrl.checked));
    } else if (a.fieldType === "Btn" && a.radioButton) {
      ctrl = document.createElement("input");
      ctrl.type = "radio";
      ctrl.name = `radio-${name}`;
      ctrl.value = a.buttonValue == null ? "" : String(a.buttonValue);
      const sel = stored !== undefined ? stored : a.fieldValue;
      ctrl.checked = sel != null && String(sel) === ctrl.value;
      ctrl.addEventListener("change", () => { if (ctrl.checked) formValues.set(name, ctrl.value); });
    } else if (a.fieldType === "Ch" && a.options && a.options.length) {
      ctrl = document.createElement("select");
      if (a.multiSelect) ctrl.multiple = true;
      const cur = stored !== undefined ? stored : a.fieldValue;
      const curArr = Array.isArray(cur) ? cur.map(String) : (cur != null ? [String(cur)] : []);
      for (const opt of a.options) {
        const o = document.createElement("option");
        o.value = String(opt.exportValue);
        o.textContent = String(opt.displayValue != null ? opt.displayValue : opt.exportValue);
        if (curArr.includes(o.value)) o.selected = true;
        ctrl.appendChild(o);
      }
      ctrl.addEventListener("change", () => {
        formValues.set(name, ctrl.multiple
          ? Array.from(ctrl.selectedOptions).map((o) => o.value)
          : ctrl.value);
      });
    }
    if (!ctrl) continue;

    ctrl.classList.add("form-field");
    ctrl.style.left = `${left}px`;
    ctrl.style.top = `${top}px`;
    ctrl.style.width = `${width}px`;
    ctrl.style.height = `${height}px`;
    if (a.readOnly) ctrl.disabled = true;
    layerDiv.appendChild(ctrl);
  }
}

async function populateAllFormOverlays() {
  const wrappers = pagesEl.querySelectorAll(".page-wrapper");
  for (let i = 0; i < wrappers.length; i++) {
    const layer = wrappers[i].querySelector(".formLayer");
    if (!layer) continue;
    const page = await pdfDoc.getPage(i + 1);
    await renderFormOverlaysForPage(page, page.getViewport({ scale: currentScale }), layer);
  }
}

function clearAllFormOverlays() {
  for (const l of pagesEl.querySelectorAll(".formLayer")) l.innerHTML = "";
}

async function enterFormMode() {
  if (!editingAllowed || !docHasForm || formMode) return;
  formMode = true;
  formValues.clear();
  document.body.classList.add("form-mode");
  if (formBarEl) formBarEl.hidden = false;
  statusEl.textContent = "Fill the form fields, then Save.";
  await populateAllFormOverlays();
}

function exitFormMode() {
  formMode = false;
  document.body.classList.remove("form-mode");
  if (formBarEl) formBarEl.hidden = true;
  clearAllFormOverlays();
  formValues.clear();
}

async function saveFilledForm(flatten) {
  if (!formMode || !pdfBytes) return;
  if (formSaveEl) formSaveEl.disabled = true;
  if (formFlattenEl) formFlattenEl.disabled = true;
  try {
    statusEl.textContent = flatten ? "Flattening form…" : "Saving form…";
    const values = Object.fromEntries(formValues);
    const baked = await bakeCurrentHighlights();
    const out = await fillForm({ srcBytes: baked, values, flatten });
    const ok = await writeOutPdf(out, saveNameForDoc(), { inPlace: true });
    if (ok) {
      exitFormMode();
      await reloadEditedBytes(out); // recomputes docHasForm + refreshes pages
      statusEl.textContent = flatten ? "Form flattened and saved." : "Form saved.";
    } else statusEl.textContent = "";
  } catch (e) {
    console.error("[pdf-viewer] form save failed:", e);
    statusEl.textContent = "Form save failed.";
  } finally {
    if (formSaveEl) formSaveEl.disabled = false;
    if (formFlattenEl) formFlattenEl.disabled = false;
  }
}

if (fillFormEl)   fillFormEl.addEventListener("click", enterFormMode);
if (formSaveEl)   formSaveEl.addEventListener("click", () => saveFilledForm(false));
if (formFlattenEl) formFlattenEl.addEventListener("click", () => saveFilledForm(true));
if (formCancelEl) formCancelEl.addEventListener("click", exitFormMode);

// Drag the Pages / Bookmarks column's right edge to resize it. The panel is
// pinned to the left, so its width is just the pointer's x. --thumb-panel-width
// drives both the panel and the content offset; persist it across sessions.
const thumbResizeEl = document.getElementById("thumb-resize");
function setThumbPanelWidth(px) {
  const w = Math.max(100, Math.min(px, Math.round(window.innerWidth * 0.6)));
  document.documentElement.style.setProperty("--thumb-panel-width", `${w}px`);
  return w;
}
chrome.storage.local.get({ thumbPanelWidth: null }, ({ thumbPanelWidth }) => {
  if (thumbPanelWidth) setThumbPanelWidth(thumbPanelWidth);
});
if (thumbResizeEl) {
  thumbResizeEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    thumbResizeEl.setPointerCapture(e.pointerId);
    const onMove = (ev) => setThumbPanelWidth(ev.clientX);
    const onUp = (ev) => {
      thumbResizeEl.removeEventListener("pointermove", onMove);
      thumbResizeEl.removeEventListener("pointerup", onUp);
      chrome.storage.local.set({ thumbPanelWidth: setThumbPanelWidth(ev.clientX) });
    };
    thumbResizeEl.addEventListener("pointermove", onMove);
    thumbResizeEl.addEventListener("pointerup", onUp);
  });
}
