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
} from "./citation-linker.js";
import {
  clearAllHighlights,
  attachHighlightHandlers,
  repaintHighlightsForPage,
} from "./highlights.js";
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

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
  "pdfjs/build/pdf.worker.mjs"
);

const params = new URLSearchParams(location.search);
const fileUrl = params.get("file");

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
const zoomLevelEl = document.getElementById("zoom-level");
const highlightToggleEl = document.getElementById("highlight-toggle");

let currentScale = 1.5;
let totalLinks = 0;
let pdfDoc = null;
let provider = "lexis";
let citationRepo = {};
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
  const next = perDocOverride || globalNamingMode;
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

function simplifyName(raw) {
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
    display = simplifyName(withoutExt) || withoutExt || "PDF";
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
    if (sourceDisplayName) paintDisplayName(sourceDisplayName);
  }
}

// Initial display from the URL. Marked non-definitive because URL-derived
// names are often UUIDs or query-string slugs — we want a real name from
// Content-Disposition or the footer to override this without the Download
// button preferring this one.
setDisplayName(filenameFromUrl(fileUrl), { definitive: false });

// Read stored prefs and any saved citation_repo.json.
chrome.storage.sync.get(
  { provider: "lexis", namingMode: "source" },
  async ({ provider: storedProvider, namingMode: storedNamingMode }) => {
    provider = storedProvider;
    providerEl.value = provider;
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
  if (area === "local" && changes.citationRepo) {
    citationRepo = changes.citationRepo.newValue || {};
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

async function loadAndRender() {
  if (!fileUrl) {
    statusEl.textContent = "No file specified.";
    return;
  }
  // New PDF -> drop any highlights from a previously loaded document.
  // (renderAllPages is also called on zoom, where we DO want them retained;
  // hence clearing here, not there.)
  clearAllHighlights();
  // Clear stashed bytes from any prior PDF. If the new fetch fails, the
  // Download button has nothing stale to save.
  pdfBytes = null;
  // Fresh document → fresh chance for footer/header extraction to win.
  userOverrodeName = false;
  // Drop any cached footer result from a previously-loaded PDF in this
  // tab and clear our session-registry entry. The new doc will register
  // its own entry once the footer pass completes; until then we don't
  // want stale collision data influencing other tabs.
  footerExtraction = null;
  _footerByPage.clear();
  unregisterEntry();
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
    // Stash a copy for the Download handler. PDF.js takes ownership of the
    // buffer it's handed (some versions transfer it), so we keep our own.
    pdfBytes = buf.slice(0);
    const loadingTask = pdfjsLib.getDocument({ data: buf });
    pdfDoc = await loadingTask.promise;
    statusEl.textContent = `Rendering ${pdfDoc.numPages} pages…`;
    await renderAllPages();
    statusEl.textContent = "Done";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Error: " + err.message;
  }
}

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
    if (r) repaintHighlightsForPage(pn, r.textLayerDiv, r.highlightLayerDiv);
  };
  for (const refs of pageRefs) {
    if (signal.aborted) return;
    attachHighlightHandlers(
      refs.pageNumber, refs.pageWrapper, refs.textLayerDiv,
      refs.highlightLayerDiv, () => highlightMode, repaintCb
    );
    repaintHighlightsForPage(refs.pageNumber, refs.textLayerDiv, refs.highlightLayerDiv);
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
function tryResolveFooterTitle() {
  const p1 = _footerByPage.get(1) || [];
  const p2 = _footerByPage.get(2) || [];
  const rawTitle = chooseTitleFromFooters(p1, p2);
  if (!rawTitle) return;

  // "TYPE OR PRINT" (and spacing/case variants like "Type or Print", "TYPEORPRINT")
  // is a form-field label that appears as the footer on blank court forms.
  // It's not a document title, so silently fall back to the source name.
  if (/^type\s*or\s*print\b/i.test(rawTitle)) return;

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
  const entry = {
    url:         fileUrl,
    sourceTitle: sourceDisplayName || "",
    footerTitle: footerExtraction ? (footerExtraction.raw || "") : "",
    timestamp:   new Date().toISOString(),
  };
  chrome.storage.local.get({ pdfHistory: [] }, ({ pdfHistory }) => {
    // Update existing entry for this URL, or prepend a new one.
    const idx = pdfHistory.findIndex(e => e.url === fileUrl);
    if (idx !== -1) {
      pdfHistory[idx] = entry;
    } else {
      pdfHistory.unshift(entry);
      if (pdfHistory.length > 500) pdfHistory.length = 500;
    }
    chrome.storage.local.set({ pdfHistory });
  });
}

function updateLinkCount() {
  const providerLabel = provider === "lexis" ? "Lexis+" : "Westlaw";
  linkCountEl.textContent = totalLinks > 0
    ? `· ${totalLinks} citation${totalLinks === 1 ? "" : "s"} → ${providerLabel}`
    : "";
}

async function renderPageCanvasAndText(pageNumber) {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: currentScale });
  // We use a scale=1 viewport for footer math so coordinates match the
  // PDF user-space units that page.getTextContent() returns by default.
  const userSpaceViewport = page.getViewport({ scale: 1 });

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

  pagesEl.appendChild(wrapper);

  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;

  const textContent = await page.getTextContent();
  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container: textLayerDiv,
    viewport,
  });
  await textLayer.render();

  return { pageNumber, textContent, textLayerDiv, linkLayerDiv, highlightLayerDiv, pageWrapper: wrapper, viewport: userSpaceViewport };
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
      chosen = serverFilename; // already simplified
    } else {
      const raw = filenameFromUrl(fileUrl) || "document";
      chosen = simplifyName(raw.replace(/\.pdf$/i, "")) || raw;
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
