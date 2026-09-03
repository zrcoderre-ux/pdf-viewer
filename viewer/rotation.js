// rotation.js
//
// Page rotation — sideways scans, landscape exhibits, and the one upside-down
// page in an otherwise upright filing.
//
// Rotation here is a *view* state first: turning a page costs one re-render and
// nothing on disk, so a read-only web PDF can be straightened just to read it.
// The tool then offers to write the rotation into the file, which is the same
// operation Organize pages performs (pdf-lib bumps each page's /Rotate), so the
// two agree — entering Organize with an unsaved rotation carries it into the
// page plan rather than showing the page the old way up.
//
// The module owns the per-page angles, the floating rotate bar, and the
// keyboard shortcuts. Everything that has to touch PDF.js — building a rotated
// viewport, re-rendering, writing the file — is a callback supplied by
// viewer.js, so this file stays free of the render pipeline (and importable in
// Node for the geometry tests).

// Clockwise degrees, always one of 0/90/180/270.
export function normalizeAngle(deg) {
  const n = Math.round((Number(deg) || 0) / 90) * 90;
  return ((n % 360) + 360) % 360;
}

// Where a run of text that sits at (x0,y0)-(x1,y1) in the page's *unrotated*
// display space lands once the page is turned `angle` degrees clockwise.
//
// Coordinates are top-left origin (the convention OCR word boxes arrive in),
// `pageW`/`pageH` are the unrotated display size in the same units, and `scale`
// is the zoom the caller is painting at. The returned left/top is the image of
// the run's top-left corner — the anchor a span needs when it carries
// `transform-origin: 0 0; transform: rotate(<angle>deg)`, because that rotation
// sends the span's own +x (reading direction) and +y (descent) the same way the
// page went. runWidth/runHeight stay in reading order, so the caller still sets
// the font size from the height and stretches along the width.
export function rotatedRunPlacement({ x0, y0, x1, y1, pageW, pageH, angle, scale = 1 }) {
  const a = normalizeAngle(angle);
  let left, top;
  if (a === 90)       { left = pageH - y0; top = x0; }
  else if (a === 180) { left = pageW - x0; top = pageH - y0; }
  else if (a === 270) { left = y0;         top = pageW - x0; }
  else                { left = x0;         top = y0; }
  return {
    left: left * scale,
    top: top * scale,
    runWidth: (x1 - x0) * scale,
    runHeight: (y1 - y0) * scale,
    angle: a,
  };
}

// Which pages a scope covers, 1-based. Scopes mirror how scanned exhibits go
// wrong: one page, the whole document, or every other page from a duplex feed.
export function pagesInScope(scope, currentPage, numPages) {
  const total = Math.max(0, Number(numPages) || 0);
  const all = [];
  for (let i = 1; i <= total; i++) all.push(i);
  if (scope === "all") return all;
  if (scope === "odd") return all.filter((n) => n % 2 === 1);
  if (scope === "even") return all.filter((n) => n % 2 === 0);
  const pn = Number(currentPage) || 1;
  return pn >= 1 && pn <= total ? [pn] : [];
}

// ── The tool ────────────────────────────────────────────────────────────────

const noop = () => {};

let barEl = null;
let scopeEl = null;
let stateEl = null;
let saveEl = null;
let toolBtn = null;

let active = false;                 // is the rotate bar showing?
const angles = new Map();           // pageNumber -> 0/90/180/270 (0 entries dropped)
let busy = false;                   // a re-render or save is in flight

let onStatus = noop;
let rerender = async () => {};
let saveToFile = async () => {};
let canSave = () => false;
let currentPage = () => 1;
let numPages = () => 0;
let beforeOpen = noop;
// While Organize pages is open it owns the page order and angles (its own
// thumbnails carry rotate buttons), so this tool stands down rather than
// turning pages behind it.
let blocked = () => false;

function typingInto(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function describe() {
  if (!angles.size) return "No rotation.";
  const parts = [];
  for (const [pn, deg] of [...angles.entries()].sort((a, b) => a[0] - b[0])) {
    parts.push(`p. ${pn} ${deg}°`);
  }
  return parts.length <= 4
    ? parts.join(" · ")
    : `${parts.slice(0, 3).join(" · ")} · +${parts.length - 3} more`;
}

function refreshBar() {
  if (stateEl) stateEl.textContent = describe();
  if (saveEl) saveEl.disabled = busy || !angles.size;
}

function setAngle(pageNumber, deg) {
  const a = normalizeAngle(deg);
  if (a === 0) angles.delete(pageNumber);
  else angles.set(pageNumber, a);
}

// Turn the pages in `scope` by `delta` degrees and re-render; returns the pages
// it turned. Repeated clicks accumulate, and a page back at 0° drops out of the
// map so "any rotation?" stays honest (Save has nothing left to write once
// everything is upright again).
async function turn(scope, delta) {
  if (busy || blocked()) return [];
  const pages = pagesInScope(scope, currentPage(), numPages());
  if (!pages.length) return [];
  for (const pn of pages) setAngle(pn, (angles.get(pn) || 0) + delta);
  busy = true;
  refreshBar();
  try {
    await rerender();
  } finally {
    busy = false;
    refreshBar();
  }
  return pages;
}

async function reset() {
  if (busy || blocked() || !angles.size) return;
  angles.clear();
  busy = true;
  refreshBar();
  try {
    await rerender();
  } finally {
    busy = false;
    refreshBar();
  }
  onStatus("Rotation cleared.");
}

async function save() {
  if (busy || blocked() || !angles.size) return;
  busy = true;
  refreshBar();
  try {
    await saveToFile(new Map(angles));
  } finally {
    busy = false;
    refreshBar();
  }
}

function setMode(on) {
  // Opening tells the viewer to put away the other bars that share this strip
  // of screen (crop, form) so two of them never stack.
  if (on && !active) beforeOpen();
  active = !!on;
  if (barEl) barEl.hidden = !active;
  if (toolBtn) toolBtn.setAttribute("aria-pressed", String(active));
  if (saveEl) saveEl.hidden = !canSave();
  refreshBar();
}

function onKeyDown(e) {
  if (e.defaultPrevented || typingInto(e.target)) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key !== "r" && e.key !== "R") return;
  e.preventDefault();
  // R turns the page you're reading; Shift+R turns it back. The scope box
  // applies too, so "All pages" + R straightens a whole sideways scan. The key
  // works whether or not the bar is open, so say what happened — a page that
  // turns under a stray keypress should also say how to turn it back.
  const scope = scopeEl ? scopeEl.value : "page";
  turn(scope, e.shiftKey ? -90 : 90).then((pages) => {
    if (!pages.length) return;
    onStatus(pages.length === 1
      ? `Page ${pages[0]} rotated ${angles.get(pages[0]) || 0}° · Shift+R turns it back`
      : `Rotated ${pages.length} pages · Shift+R turns them back`);
  });
}

export const pageRotation = {
  // opts.rerender     — re-draw the pages at the new angles (viewer.js).
  // opts.save         — write the rotation into the document; gets a
  //                     Map<pageNumber, degrees> of the pages to turn.
  // opts.canSave      — whether saving is offered at all (bytes loaded).
  // opts.currentPage  — the page the reader is looking at, 1-based.
  // opts.numPages     — pages in the document.
  // opts.status       — short user-facing messages.
  // opts.beforeOpen   — called just before the bar opens.
  // opts.blocked      — true while another mode owns the pages.
  init(opts = {}) {
    onStatus = opts.status || noop;
    rerender = opts.rerender || rerender;
    saveToFile = opts.save || saveToFile;
    canSave = opts.canSave || canSave;
    currentPage = opts.currentPage || currentPage;
    numPages = opts.numPages || numPages;
    beforeOpen = opts.beforeOpen || beforeOpen;
    blocked = opts.blocked || blocked;

    barEl = document.getElementById("rotate-bar");
    scopeEl = document.getElementById("rot-scope");
    stateEl = document.getElementById("rot-state");
    saveEl = document.getElementById("rot-save");
    toolBtn = opts.toolButton || document.getElementById("rotate-pages");

    const left = document.getElementById("rot-left");
    const right = document.getElementById("rot-right");
    const resetBtn = document.getElementById("rot-reset");
    const doneBtn = document.getElementById("rot-done");

    if (toolBtn) toolBtn.addEventListener("click", () => setMode(!active));
    if (left) left.addEventListener("click", () => turn(scopeEl ? scopeEl.value : "page", -90));
    if (right) right.addEventListener("click", () => turn(scopeEl ? scopeEl.value : "page", 90));
    if (resetBtn) resetBtn.addEventListener("click", reset);
    if (saveEl) saveEl.addEventListener("click", save);
    if (doneBtn) doneBtn.addEventListener("click", () => setMode(false));
    window.addEventListener("keydown", onKeyDown);
    setMode(false);
  },

  // Extra clockwise rotation for a page, on top of the page's own /Rotate.
  delta(pageNumber) {
    return angles.get(pageNumber) || 0;
  },

  any() {
    return angles.size > 0;
  },

  // A copy, so callers (the organize page plan, the save path) can't mutate
  // the live state.
  deltas() {
    return new Map(angles);
  },

  active() {
    return active;
  },

  // Put the bar away without touching the angles — the pages stay rotated.
  close() {
    if (active) setMode(false);
  },

  // Called when the rotation has been written into the document (or a new
  // document replaced this one): the file now carries the angles, so the view
  // state has to go back to zero or the pages would turn twice.
  clear() {
    angles.clear();
    refreshBar();
  },

  resetDocument() {
    angles.clear();
    setMode(false);
  },
};
