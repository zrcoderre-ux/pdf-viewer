// reader-options.js
//
// The Options page's "Text reader — default font and leading" section (the
// pseudonym highlight's colour and intensity with them). The
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
const widthEl = $("reader-width");
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
    widthEl.value = String(settings.pageWidth);
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

  let statusTimer = null;
  function save(note) {
    const out = Object.assign({}, settings);
    delete out.showFakes; // a view, never a default
    chrome.storage.sync.set({ [KEY]: out }, () => {
      statusEl.textContent = note || "Saved — every text file opens this way from now on.";
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => { statusEl.textContent = ""; }, 2500);
    });
  }

  function read() {
    // Over the settings as stored: the reader's own toggles (line lock,
    // the gutter) are not on this page and must survive a save from it.
    settings = normalizeSettings(Object.assign({}, settings, {
      font: fontEl.value,
      customFont: customEl.value,
      fontSize: Number(sizeEl.value),
      lineHeight: Number(lhEl.value),
      pageWidth: Number(widthEl.value),
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
  for (const el of [fontEl, sizeEl, lhEl, widthEl, marksEl]) el.addEventListener("change", read);
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
