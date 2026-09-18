// reader-options.js
//
// The Options page's "Text reader — default font and leading" section (the
// pseudonym highlight's colour and intensity with them). There is no page
// width here or anywhere: the sheet is a page, and the type is what gives. The
// defaults are one synced object, `textReaderSettings` in chrome.storage.sync
// — the same one the reader's toolbar edits — so a font or a leading set here
// is what every text file opens in, and a change in either place shows in the
// other at once. Display only: nothing here touches a text file.
//
// A module so it can share textdoc.js's presets and normaliser with the
// reader; the rest of the Options page stays a classic script.

import { FONT_PRESETS, DEFAULT_SETTINGS, normalizeSettings, fontCss, markCss } from "./textdoc.js";

const KEY = "textReaderSettings";
const $ = (id) => document.getElementById(id);
const fontEl = $("reader-font");
const customEl = $("reader-font-custom");
const sizeEl = $("reader-size");
const lhEl = $("reader-lh");
const marksEl = $("reader-marks");
const markColorEl = $("reader-mark-color");
const markAlphaEl = $("reader-mark-alpha");
const markAlphaVal = $("reader-mark-alpha-val");
const sampleEl = $("reader-sample");
const statusEl = $("reader-status");

if (fontEl) {
  for (const p of FONT_PRESETS) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.label;
    fontEl.appendChild(o);
  }

  let settings = normalizeSettings(null);

  function show() {
    fontEl.value = settings.font;
    customEl.hidden = settings.font !== "custom";
    customEl.value = settings.customFont;
    sizeEl.value = String(settings.fontSize);
    lhEl.value = String(settings.lineHeight);
    marksEl.checked = settings.marks;
    markColorEl.value = settings.markColor;
    markAlphaEl.value = String(settings.markAlpha);
    markAlphaVal.textContent = Math.round(settings.markAlpha * 100) + "%";
    const mark = markCss(settings);
    sampleEl.style.setProperty("--pn-bg", mark.bg);
    sampleEl.style.setProperty("--pn-ring", mark.ring);
    sampleEl.classList.toggle("marks-off", !settings.marks);
    sampleEl.style.fontFamily = fontCss(settings);
    sampleEl.style.fontSize = settings.fontSize + "px";
    sampleEl.style.lineHeight = String(settings.lineHeight);
  }

  // A synced write is rate limited — Chrome takes 120 a minute and rejects the
  // rest, writing nothing — and the colour swatch and the intensity slider
  // fire `input` the whole way through a drag. A write per pixel spent the
  // quota in the first second and the value settled on was the one most
  // likely to be refused, which is how a colour chosen here came back yellow.
  // The write waits for the dragging to stop, and the page says so when the
  // browser refuses it rather than reporting a save that did not happen.
  let statusTimer = null, saveTimer = null, pending = null;
  function save(note) {
    pending = note || "Saved — every text file opens this way from now on.";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  }
  function flush() {
    clearTimeout(saveTimer);
    if (pending == null) return;
    const note = pending;
    pending = null;
    const out = Object.assign({}, settings, { savedAt: Date.now() });
    delete out.showFakes; // a view, never a default
    chrome.storage.sync.set({ [KEY]: out }, () => {
      const err = chrome.runtime && chrome.runtime.lastError;
      statusEl.textContent = err ? "Not saved — the browser refused the write (" + err.message + "). Try again in a moment." : note;
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => { statusEl.textContent = ""; }, 2500);
    });
  }
  window.addEventListener("pagehide", flush);

  function read() {
    // Over the settings as stored: the reader's own toggles (line lock,
    // the gutter) are not on this page and must survive a save from it.
    settings = normalizeSettings(Object.assign({}, settings, {
      font: fontEl.value,
      customFont: customEl.value,
      fontSize: Number(sizeEl.value),
      lineHeight: Number(lhEl.value),
      marks: marksEl.checked,
      markColor: markColorEl.value,
      markAlpha: Number(markAlphaEl.value),
    }));
    show();
    save();
  }

  chrome.storage.sync.get({ [KEY]: null }, (got) => {
    settings = normalizeSettings(got && got[KEY]);
    show();
  });
  for (const el of [fontEl, sizeEl, lhEl, marksEl]) el.addEventListener("change", read);
  for (const el of [customEl, markColorEl, markAlphaEl]) el.addEventListener("input", read);
  $("reader-reset").addEventListener("click", () => {
    settings = normalizeSettings(Object.assign({}, DEFAULT_SETTINGS));
    show();
    save("Restored the built-in defaults.");
  });
  // Keep in step with a reader tab that changes the same defaults.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes[KEY]) return;
    settings = normalizeSettings(changes[KEY].newValue);
    show();
  });
}
