// Auto-scroll: hands-free reading for long PDFs.
//
// Ported from the reading auto-scroll in the Inbox Cleaner PWA and rebuilt for
// a desktop viewer. The idea is the same — the document creeps upward at your
// reading pace so you stop reaching for the wheel — but everything around it is
// different here:
//
//   * The window is the scroller (see viewer.css: "Body owns scroll"), not an
//     inner element or an iframe body.
//   * Speed is set in PAGES PER MINUTE and converted page by page: each page
//     crosses the reading line in 60 / ppm seconds, whatever height it renders
//     at. A landscape exhibit and a portrait brief page take the same time, and
//     the zoom takes care of itself, since heights are re-measured on render.
//   * Interruption is mouse/keyboard-shaped: wheel, trackpad, scrollbar drag,
//     arrows/PageDown. Auto-scroll yields instantly and resumes ~1.2s after you
//     stop — and it will not resume while you're holding a text selection or a
//     modal is open, so the page never slides out from under what you're doing.
//   * Sub-pixel motion is quantized to the DISPLAY's pixel grid. Reading pace
//     works out to ~10 px/s, so whole-pixel stepping would ratchet. The email
//     reader renders the remainder with a free-floating GPU transform; here that
//     would resample the page canvas and leave PDF text permanently soft, so the
//     remainder is snapped to a whole device pixel instead — half-steps on a
//     HiDPI screen, and on a 1x screen exactly the stepping we'd have anyway.
//     Never blurry either way.
//
// The mode is sticky: turn it on and it stays on for the next document you
// open, so a reading session doesn't need re-arming per file.

const PPM_KEY = "pdfViewerAutoScrollPpm";
const OLD_WPM_KEY = "pdfViewerAutoScrollWpm"; // the words-per-minute pace this replaced
const ON_KEY = "pdfViewerAutoScrollOn";
const MIN_PPM = 0.2;
const MAX_PPM = 5;
const PPM_STEP = 0.1;
const DEFAULT_PPM = 1;
// What an old words-per-minute setting is carried over as: a page of body text
// holds about this many words, so 300 wpm opens as 1 page a minute.
const WORDS_PER_PAGE = 300;

// Pixels/second guard rails: the low end keeps a slow pace at a small zoom from
// stalling to a standstill; the high end keeps a fast one at a big zoom from
// flinging pages past.
const MIN_PX_PER_SEC = 6;
const MAX_PX_PER_SEC = 600;

// How far down the viewport the "reading line" sits. The page under this line
// is the one whose height sets the current speed.
const READING_LINE = 0.45;

// A frame longer than this (GC, a tab switch, a slow re-render) is capped so
// the document doesn't lurch when the clock catches up.
const MAX_FRAME_MS = 48;

// Quiet time after the last manual scroll before auto-scroll takes back over.
// Long enough that wheel notches and trackpad momentum read as one gesture.
const RESUME_DELAY_MS = 1200;

// Fade the control bar down while the mouse is still, so it stops competing
// with the page you're reading. Any pointer movement brings it back.
const BAR_IDLE_MS = 2500;

let enabled = false;   // the mode itself (persisted, sticky across documents)
let paused = false;    // explicit play/pause inside the mode
let suspended = false; // temporary yield to a manual scroll
let held = false;      // frozen while pages re-render (zoom, new document)
let ppm = DEFAULT_PPM;

let raf = 0;
let lastTs = 0;
let pos = 0;          // fractional scroll position we're driving
let lastWritten = null;
let resumeTimer = 0;
let idleTimer = 0;
let curPxPerSec = 0;  // eased toward the target so page changes don't jolt
let appliedFrac = 0;  // sub-pixel remainder currently carried by the transform

let metrics = null;          // { pages: [{ top, bottom, height }] }

let onStatus = () => {};
let pagesEl = null;

// Toolbar button + floating control bar.
let btnEl, barEl, playEl, slowerEl, fasterEl, sliderEl, ppmEl, closeEl;

const scroller = () => document.scrollingElement || document.documentElement;
const maxScroll = () =>
  Math.max(scroller().scrollHeight - window.innerHeight, 0);

// ── Persistence ─────────────────────────────────────────────────────────────
// localStorage, like the theme toggle: it works identically in the extension
// page and in the hosted PWA, with no chrome.storage round-trip.
const clampPpm = (v) =>
  Math.max(MIN_PPM, Math.min(MAX_PPM, Math.round(Number(v) * 10) / 10));

function loadPrefs() {
  try {
    const p = parseFloat(localStorage.getItem(PPM_KEY) || "");
    if (p >= MIN_PPM && p <= MAX_PPM) ppm = clampPpm(p);
    else {
      const w = parseInt(localStorage.getItem(OLD_WPM_KEY) || "", 10);
      if (w > 0) ppm = clampPpm(w / WORDS_PER_PAGE);
    }
  } catch { /* ok */ }
  try { enabled = localStorage.getItem(ON_KEY) === "1"; } catch { /* ok */ }
}

function savePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ok */ }
}

// ── Speed model ─────────────────────────────────────────────────────────────
// Rendered page heights, page by page. At P pages/minute a page of height H
// crosses the reading line in 60 / P seconds, so the speed over it is
// H * P / 60 pixels per second — independent of window size, and correct
// whatever the zoom.
function refreshMetrics() {
  metrics = null;
  if (!pagesEl) return;
  const wrappers = pagesEl.querySelectorAll(".page-wrapper");
  if (!wrappers.length) return;

  const pages = [];
  wrappers.forEach((w) => {
    const top = w.offsetTop;
    const height = w.offsetHeight || 1;
    pages.push({ top, bottom: top + height, height });
  });
  metrics = { pages };
}

function pageHeightAt(y) {
  if (!metrics || !metrics.pages.length) return null;
  const pages = metrics.pages;
  let lo = 0, hi = pages.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pages[mid].bottom < y) lo = mid + 1; else hi = mid;
  }
  return pages[lo].height || null;
}

function targetPxPerSec() {
  const height = pageHeightAt(pos + window.innerHeight * READING_LINE);
  if (!height) return null;
  const px = height * ppm / 60;
  return Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, px));
}

// ── Engine ──────────────────────────────────────────────────────────────────
function running() {
  return enabled && !paused && !suspended && !held;
}

function ensureTicking() {
  // Nothing to scroll (a one-page document, or one that fits at this zoom):
  // stay armed but idle rather than instantly declaring "reached the end".
  if (maxScroll() <= 4) return;
  if (running() && !raf) {
    lastTs = 0;
    lastWritten = null;
    pos = scroller().scrollTop;
    if (pagesEl) pagesEl.style.willChange = "transform";
    raf = requestAnimationFrame(tick);
  }
}

function stopTicking() {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  lastTs = 0;
  clearFrac();
}

function tick(ts) {
  raf = 0;
  if (!running()) return;

  const s = scroller();
  // The reliable manual-override signal: the position moved somewhere we didn't
  // put it. Catches the scrollbar, a middle-drag, find-in-page, anything.
  if (lastWritten != null && Math.abs(s.scrollTop - lastWritten) > 3) {
    interrupt();
    return;
  }
  // Selecting text is reading with intent — hold still until the selection goes.
  if (hasSelection()) {
    interrupt();
    return;
  }

  if (!lastTs) lastTs = ts;
  let dt = ts - lastTs;
  lastTs = ts;
  if (dt > MAX_FRAME_MS) dt = MAX_FRAME_MS;

  const target = targetPxPerSec();
  if (target == null) { raf = requestAnimationFrame(tick); return; }
  // Ease toward the new page's speed over ~half a second instead of stepping,
  // so crossing a page boundary isn't a visible gear change.
  if (!curPxPerSec) curPxPerSec = target;
  else curPxPerSec += (target - curPxPerSec) * Math.min(1, dt / 500);

  const limit = maxScroll();
  pos = Math.min(pos + curPxPerSec * dt / 1000, limit);
  write();

  if (pos >= limit - 0.5) { finish(); return; }
  raf = requestAnimationFrame(tick);
}

// Whole pixels go to scrollTop (browsers round it — Chrome has no fractional
// scroll offset); the remainder is carried by a transform on the page column,
// snapped to the device-pixel grid so the canvases stay pixel-aligned and crisp.
// Writing the same integer twice fires no scroll event, so the viewer's
// per-scroll work (page indicator, active thumbnail) runs at the stepping rate,
// not once per frame.
function write() {
  const s = scroller();
  const whole = Math.floor(pos);
  s.scrollTop = whole;
  lastWritten = s.scrollTop;
  setFrac(pos - whole);
}

function setFrac(frac) {
  if (!pagesEl) return;
  const dpr = window.devicePixelRatio || 1;
  const q = Math.round(frac * dpr) / dpr;
  if (q === appliedFrac) return;
  appliedFrac = q;
  pagesEl.style.transform = q ? `translate3d(0, ${-q}px, 0)` : "";
}

// Drop the sub-pixel offset (and the compositing hint) whenever motion stops,
// so a manual scroll starts from a clean, untransformed page column.
function clearFrac() {
  if (!pagesEl) return;
  appliedFrac = 0;
  pagesEl.style.transform = "";
  pagesEl.style.willChange = "";
}

function hasSelection() {
  const sel = window.getSelection();
  return !!(sel && sel.rangeCount && !sel.isCollapsed && String(sel).trim());
}

// Something the user did (or a dialog) should stop the page moving right now,
// with an automatic comeback once they're done.
function interrupt() {
  if (!enabled || paused) return;
  suspended = true;
  stopTicking();
  scheduleResume();
}

function scheduleResume() {
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => {
    resumeTimer = 0;
    if (!enabled || paused || held) return;
    // Still busy? Check again rather than pulling the page out from under them.
    if (hasSelection() || overlayOpen()) { scheduleResume(); return; }
    suspended = false;
    curPxPerSec = 0; // re-acquire pace where they left off
    ensureTicking();
    updateUi();
  }, RESUME_DELAY_MS);
}

// Anything the user is mid-way through: a dialog, one of the mode bars, or the
// highlight context menu. Auto-scroll waits these out rather than pulling the
// page along underneath them.
function overlayOpen() {
  if (document.querySelector(
    ".modal-backdrop:not([hidden]), #crop-bar:not([hidden]), #form-bar:not([hidden]), " +
    "#organize-bar:not([hidden]), #rotate-bar:not([hidden])"
  )) return true;
  const ctx = document.getElementById("hl-ctx-menu");
  return !!(ctx && ctx.style.display === "block");
}

// End of document: stop, but stay armed so Space picks it back up if the user
// scrolls back for a second read.
function finish() {
  paused = true;
  stopTicking();
  updateUi();
  onStatus("Auto-scroll reached the end");
}

// ── Mode / play / speed ─────────────────────────────────────────────────────
function setEnabled(on) {
  enabled = !!on;
  savePref(ON_KEY, enabled ? "1" : "0");
  paused = false;
  suspended = false;
  curPxPerSec = 0;
  if (!enabled) {
    stopTicking();
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = 0; }
  } else if (maxScroll() <= 4) {
    // Nothing to scroll (single short page) — say so instead of silently
    // appearing to do nothing.
    onStatus("Nothing to auto-scroll — the document fits on screen");
  } else {
    refreshMetrics();
    ensureTicking();
  }
  updateUi();
}

function togglePlay() {
  if (!enabled) { setEnabled(true); return; }
  paused = !paused;
  suspended = false;
  if (paused) {
    stopTicking();
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = 0; }
  } else {
    curPxPerSec = 0;
    ensureTicking();
  }
  updateUi();
}

function setPpm(next) {
  const p = clampPpm(Number(next) || DEFAULT_PPM);
  if (p === ppm) { updateUi(); return; }
  ppm = p;
  savePref(PPM_KEY, String(ppm));
  updateUi();
}

function nudgePpm(delta) {
  setPpm(ppm + delta);
  if (enabled) onStatus(`Auto-scroll ${ppmLabel()}`);
}

// "1.0 ppm", "0.5 ppm": always one decimal, so the readout doesn't jitter.
function ppmLabel() {
  return `${ppm.toFixed(1)} ppm`;
}

// ── UI ──────────────────────────────────────────────────────────────────────
const PLAY_ICON = "▶";
const PAUSE_ICON = "❙❙";

function updateUi() {
  if (!btnEl) return;
  btnEl.setAttribute("aria-pressed", String(enabled));
  btnEl.classList.toggle("active", enabled);
  barEl.hidden = !enabled;
  if (!enabled) return;

  // A temporary manual-scroll yield still reads as "playing" — it comes back on
  // its own — so the icon doesn't flicker while the user scrolls.
  playEl.textContent = paused ? PLAY_ICON : PAUSE_ICON;
  playEl.title = paused ? "Resume (Space)" : "Pause (Space)";
  playEl.setAttribute("aria-label", playEl.title);
  if (Number(sliderEl.value) !== ppm) sliderEl.value = String(ppm);
  ppmEl.textContent = ppmLabel();
  barEl.classList.toggle("paused", paused);
}

function markBarActive() {
  if (!barEl || barEl.hidden) return;
  barEl.classList.remove("idle");
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (barEl && !barEl.matches(":hover")) barEl.classList.add("idle");
  }, BAR_IDLE_MS);
}

// ── Input ───────────────────────────────────────────────────────────────────
function typingInto(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// Keys that scroll on their own. They aren't blocked — the user gets the normal
// jump — auto-scroll just gets out of the way and resumes after.
const SCROLL_KEYS = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "PageUp", "PageDown", "Home", "End",
]);

function onKeyDown(e) {
  if (e.defaultPrevented || typingInto(e.target)) return;
  const plain = !e.ctrlKey && !e.altKey && !e.metaKey;

  // Shift+Space belongs to the link opener (shift-space-open.js) — never ours.
  if (plain && !e.shiftKey && (e.code === "Space" || e.key === " ")) {
    if (!enabled) return; // auto-scroll off: leave Space as page-down
    e.preventDefault();
    togglePlay();
    markBarActive();
    return;
  }
  if (plain && !e.shiftKey && (e.key === "a" || e.key === "A")) {
    e.preventDefault();
    setEnabled(!enabled);
    onStatus(enabled ? `Auto-scroll on · ${ppmLabel()}` : "Auto-scroll off");
    markBarActive();
    return;
  }
  if (enabled && plain && !e.shiftKey && e.key === "Escape") {
    // Escape closes whatever is open first — a dialog, the highlight menu —
    // and only turns auto-scroll off when nothing else is claiming it.
    if (overlayOpen()) return;
    e.preventDefault();
    setEnabled(false);
    onStatus("Auto-scroll off");
    return;
  }
  if (enabled && plain && (e.key === "[" || e.key === "]")) {
    e.preventDefault();
    nudgePpm(e.key === "]" ? PPM_STEP : -PPM_STEP);
    markBarActive();
    return;
  }
  if (SCROLL_KEYS.has(e.key)) interrupt();
}

// ── Public API ──────────────────────────────────────────────────────────────
export const autoScroll = {
  // Wire up the toolbar button, the floating bar, and the input listeners.
  // `opts.pagesEl` is the container holding .page-wrapper elements; `opts.status`
  // gets short user-facing messages.
  init(opts = {}) {
    pagesEl = opts.pagesEl || document.getElementById("pages");
    if (opts.status) onStatus = opts.status;

    btnEl = document.getElementById("autoscroll-toggle");
    barEl = document.getElementById("autoscroll-bar");
    if (!btnEl || !barEl) return;
    playEl = document.getElementById("as-play");
    slowerEl = document.getElementById("as-slower");
    fasterEl = document.getElementById("as-faster");
    sliderEl = document.getElementById("as-speed");
    ppmEl = document.getElementById("as-ppm");
    closeEl = document.getElementById("as-close");

    loadPrefs();
    sliderEl.min = String(MIN_PPM);
    sliderEl.max = String(MAX_PPM);
    sliderEl.step = String(PPM_STEP);
    sliderEl.value = String(ppm);

    btnEl.addEventListener("click", () => {
      setEnabled(!enabled);
      markBarActive();
    });
    playEl.addEventListener("click", () => { togglePlay(); markBarActive(); });
    slowerEl.addEventListener("click", () => { nudgePpm(-PPM_STEP); markBarActive(); });
    fasterEl.addEventListener("click", () => { nudgePpm(PPM_STEP); markBarActive(); });
    closeEl.addEventListener("click", () => setEnabled(false));
    sliderEl.addEventListener("input", () => { setPpm(sliderEl.value); markBarActive(); });
    // The bar's own controls must not count as "the user scrolled".
    barEl.addEventListener("wheel", (e) => e.stopPropagation());
    barEl.addEventListener("mousedown", (e) => e.stopPropagation());

    // Manual-scroll signals. Passive listeners on window: they observe, they
    // never block the browser's own scrolling.
    for (const evt of ["wheel", "mousedown", "touchstart"]) {
      window.addEventListener(evt, () => interrupt(), { passive: true });
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", markBarActive, { passive: true });
    // Page heights (and therefore speed) change with the window. Debounced:
    // a resize drag fires continuously, and re-measuring every page is not free.
    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        refreshMetrics();
        pos = scroller().scrollTop;
        lastWritten = null;
      }, 150);
    }, { passive: true });

    // Restore the sticky mode. Pages aren't rendered yet, so the engine just
    // arms itself; endRender() starts the motion.
    updateUi();
    markBarActive();
  },

  // A new document is loading: forget the old one's page heights.
  resetDocument() {
    metrics = null;
    paused = false;
  },

  // renderAllPages() is about to tear down and rebuild #pages (a new document or
  // a zoom change). Freeze — the document height is about to collapse to zero,
  // and a running engine would read that as "reached the end".
  beginRender() {
    held = true;
    stopTicking();
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = 0; }
  },

  // Pages are on screen and measurable again: re-measure page heights (they
  // just changed with the zoom) and pick the motion back up if the mode is on.
  endRender() {
    held = false;
    refreshMetrics();
    pos = scroller().scrollTop;
    lastWritten = null;
    curPxPerSec = 0;
    // A re-render clears the pending resume timer, so a manual scroll that was
    // still in its cool-off when the zoom landed has to be re-armed here or the
    // engine would stay yielded forever.
    if (enabled && !paused) {
      if (suspended) scheduleResume(); else ensureTicking();
    }
    updateUi();
  },

  // Anything that changed the page heights.
  refresh() {
    refreshMetrics();
    pos = scroller().scrollTop;
    lastWritten = null;
  },

  isEnabled() { return enabled; },
};
