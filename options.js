// Options page. Every setting here is synced (chrome.storage.sync) so it
// follows the Chrome profile; the background worker and the content script
// subscribe to the keys they care about and re-apply live.

const radios = document.querySelectorAll('input[name="provider"]');
const namingRadios = document.querySelectorAll('input[name="namingMode"]');

// Init provider radios
chrome.storage.sync.get({ provider: "lexis" }, ({ provider }) => {
  for (const r of radios) r.checked = (r.value === provider);
});
for (const r of radios) {
  r.addEventListener("change", () => {
    if (r.checked) chrome.storage.sync.set({ provider: r.value });
  });
}

// Init filename-source radios. Default is "source" — the source filename
// as the server sent it. Open viewer tabs subscribe to changes on this
// key and re-paint the toolbar immediately.
chrome.storage.sync.get({ namingMode: "source" }, ({ namingMode }) => {
  const v = namingMode === "footer" ? "footer" : "source";
  for (const r of namingRadios) r.checked = (r.value === v);
});
for (const r of namingRadios) {
  r.addEventListener("change", () => {
    if (r.checked) chrome.storage.sync.set({ namingMode: r.value });
  });
}

// "Apply naming rules to the source filename" (synced; default off → the raw
// source name is shown as-is). Open viewer tabs subscribe and re-derive live.
const alterSourceEl = document.getElementById("alter-source");
if (alterSourceEl) {
  chrome.storage.sync.get({ alterSource: false }, ({ alterSource }) => {
    alterSourceEl.checked = !!alterSource;
  });
  alterSourceEl.addEventListener("change", () => {
    chrome.storage.sync.set({ alterSource: alterSourceEl.checked });
  });
}

// Table of Authorities panel toggles (synced; default on). Separate switches
// for the PDF viewer and for websites (claude.ai); open viewer tabs and the
// content script subscribe to these keys and show/hide live.
const toaPdfEl = document.getElementById("toa-enabled-pdf");
const toaWebEl = document.getElementById("toa-enabled-web");
chrome.storage.sync.get(
  { toaEnabledPdf: false, toaEnabledWeb: true },
  ({ toaEnabledPdf, toaEnabledWeb }) => {
    if (toaPdfEl) toaPdfEl.checked = !!toaEnabledPdf;
    if (toaWebEl) toaWebEl.checked = toaEnabledWeb !== false;
  }
);
if (toaPdfEl) {
  toaPdfEl.addEventListener("change", () => {
    chrome.storage.sync.set({ toaEnabledPdf: toaPdfEl.checked });
  });
}
if (toaWebEl) {
  toaWebEl.addEventListener("change", () => {
    chrome.storage.sync.set({ toaEnabledWeb: toaWebEl.checked });
  });
}

// ---------- Citation links on websites ----------
//
// Three synced keys drive this:
//   citationAllSites        link on every http/https site
//   citationSites           the sites to link on when that's off
//   citationSiteExceptions  never link on these, in either mode
// The background worker watches all three and re-registers the content script;
// the content script watches the exceptions and stands down where it must.

const SiteRules = window.CitationSiteRules;

// Show a "Saved."-style message and clear it a moment later.
function flashStatus(el, message, isError) {
  el.textContent = message;
  el.className = isError ? "status error" : "status";
  setTimeout(() => { el.textContent = ""; }, 2500);
}

// Read a textarea as a trimmed, blank-free list of lines.
function linesOf(textarea) {
  return textarea.value
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const allSitesEl = document.getElementById("citation-all-sites");
const citationSitesEl = document.getElementById("citation-sites");
const citationSitesBlock = document.getElementById("citation-sites-block");
const citationSitesSaveBtn = document.getElementById("citation-sites-save");
const citationSitesStatus = document.getElementById("citation-sites-status");
const exceptionsEl = document.getElementById("citation-exceptions");
const exceptionsSaveBtn = document.getElementById("citation-exceptions-save");
const exceptionsResetBtn = document.getElementById("citation-exceptions-reset");
const exceptionsStatus = document.getElementById("citation-exceptions-status");

// The per-site list has nothing to say while every site is covered.
function syncSitesBlockVisibility() {
  if (citationSitesBlock) {
    citationSitesBlock.style.display = allSitesEl && allSitesEl.checked ? "none" : "";
  }
}

if (allSitesEl) {
  chrome.storage.sync.get({ citationAllSites: false }, ({ citationAllSites }) => {
    allSitesEl.checked = !!citationAllSites;
    syncSitesBlockVisibility();
  });
  allSitesEl.addEventListener("change", () => {
    chrome.storage.sync.set({ citationAllSites: allSitesEl.checked });
    syncSitesBlockVisibility();
  });
}

if (citationSitesEl && citationSitesSaveBtn) {
  chrome.storage.sync.get({ citationSites: [] }, ({ citationSites }) => {
    citationSitesEl.value = (citationSites || []).join("\n");
  });
  citationSitesSaveBtn.addEventListener("click", () => {
    const lines = linesOf(citationSitesEl);
    chrome.storage.sync.set({ citationSites: lines }, () => {
      flashStatus(
        citationSitesStatus,
        lines.length === 0 ? "Cleared." : `Saved ${lines.length} site${lines.length === 1 ? "" : "s"}.`
      );
    });
  });
}

// Exceptions. The Westlaw / Lexis+ defaults are seeded by the storage.get
// default, so they appear the first time this page is opened — and an empty
// box the user saves on purpose stays empty rather than being re-seeded.
if (exceptionsEl && exceptionsSaveBtn) {
  const defaults = (SiteRules && SiteRules.DEFAULT_EXCEPTIONS) || [];
  chrome.storage.sync.get(
    { citationSiteExceptions: defaults },
    ({ citationSiteExceptions }) => {
      exceptionsEl.value = (citationSiteExceptions || []).join("\n");
    }
  );
  exceptionsSaveBtn.addEventListener("click", () => {
    const lines = linesOf(exceptionsEl);
    chrome.storage.sync.set({ citationSiteExceptions: lines }, () => {
      flashStatus(
        exceptionsStatus,
        lines.length === 0
          ? "Cleared — citation links now run everywhere they're enabled."
          : `Saved ${lines.length} exception${lines.length === 1 ? "" : "s"}.`
      );
    });
  });
  if (exceptionsResetBtn) {
    exceptionsResetBtn.addEventListener("click", () => {
      exceptionsEl.value = defaults.join("\n");
      chrome.storage.sync.set({ citationSiteExceptions: defaults }, () => {
        flashStatus(exceptionsStatus, "Restored the default exceptions.");
      });
    });
  }
}

// ---------- Extra PDF URL patterns ----------

const patternsTextarea = document.getElementById("patterns");
const patternsSaveBtn  = document.getElementById("patterns-save");
const patternsStatus   = document.getElementById("patterns-status");

chrome.storage.sync.get({ pdfUrlPatterns: [] }, ({ pdfUrlPatterns }) => {
  patternsTextarea.value = (pdfUrlPatterns || []).join("\n");
});

patternsSaveBtn.addEventListener("click", () => {
  const lines = linesOf(patternsTextarea);
  chrome.storage.sync.set({ pdfUrlPatterns: lines }, () => {
    flashStatus(
      patternsStatus,
      lines.length === 0 ? "Cleared." : `Saved ${lines.length} pattern${lines.length === 1 ? "" : "s"}.`
    );
  });
});

// ---------- PDF History ----------

const historyContainer = document.getElementById("history-container");
const historyDownloadBtn = document.getElementById("history-download");
const historyClearBtn = document.getElementById("history-clear");
const historyStatus = document.getElementById("history-status");

function csvEscape(v) {
  const s = String(v ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

function renderHistory(entries) {
  if (!entries || entries.length === 0) {
    historyContainer.innerHTML = '<p class="history-empty">No PDFs recorded yet.</p>';
    return;
  }
  const rows = entries.map(e => `
    <tr>
      <td>${csvEscape(e.timestamp).replace(/T/, " ").replace(/\.\d+Z$/, "")}</td>
      <td>${e.sourceTitle ? escapeHtml(e.sourceTitle) : "<em style='color:#aaa'>—</em>"}</td>
      <td>${e.footerName  ? escapeHtml(e.footerName)  : "<em style='color:#aaa'>—</em>"}</td>
      <td>${e.footerTitle ? escapeHtml(e.footerTitle) : "<em style='color:#aaa'>—</em>"}</td>
      <td>${e.finalName   ? escapeHtml(e.finalName)   : "<em style='color:#aaa'>—</em>"}</td>
    </tr>`).join("");
  historyContainer.innerHTML = `
    <table id="history-table">
      <thead><tr><th>Opened</th><th>Source name</th><th>Footer name</th><th>Footer</th><th>Final name</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadHistory() {
  chrome.storage.local.get({ pdfHistory: [] }, ({ pdfHistory }) => {
    renderHistory(pdfHistory);
  });
}
loadHistory();

historyDownloadBtn.addEventListener("click", () => {
  chrome.storage.local.get({ pdfHistory: [] }, ({ pdfHistory }) => {
    if (!pdfHistory.length) {
      historyStatus.textContent = "No history to download.";
      historyStatus.className = "status";
      setTimeout(() => { historyStatus.textContent = ""; }, 2500);
      return;
    }
    const header = ["Opened", "Source name", "Footer name", "Footer", "Final name"];
    const csvRows = [header, ...pdfHistory.map(e => [
      e.timestamp,
      e.sourceTitle ?? "",
      e.footerName  ?? "",
      e.footerTitle ?? "",
      e.finalName   ?? "",
    ])].map(row => row.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csvRows], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pdf-history.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });
});

historyClearBtn.addEventListener("click", () => {
  chrome.storage.local.remove("pdfHistory", () => {
    historyStatus.textContent = "History cleared.";
    historyStatus.className = "status";
    setTimeout(() => { historyStatus.textContent = ""; }, 2500);
    renderHistory([]);
  });
});

// Auto-OCR toggle (synced; default off → manual OCR via the toolbar button).
const autoOcrEl = document.getElementById("auto-ocr");
if (autoOcrEl) {
  chrome.storage.sync.get({ autoOcr: false }, ({ autoOcr }) => {
    autoOcrEl.checked = !!autoOcr;
  });
  autoOcrEl.addEventListener("change", () => {
    chrome.storage.sync.set({ autoOcr: autoOcrEl.checked });
  });
}

// OCR left-margin cutoff
const ocrLeftMarginInput = document.getElementById("ocr-left-margin");
const ocrSaveBtn         = document.getElementById("ocr-save");
const ocrStatus          = document.getElementById("ocr-status");

chrome.storage.sync.get({ ocrLeftMarginPct: 8 }, ({ ocrLeftMarginPct }) => {
  ocrLeftMarginInput.value = ocrLeftMarginPct;
});

ocrSaveBtn.addEventListener("click", () => {
  const v = Math.min(30, Math.max(0, parseInt(ocrLeftMarginInput.value, 10) || 0));
  ocrLeftMarginInput.value = v;
  chrome.storage.sync.set({ ocrLeftMarginPct: v }, () => {
    ocrStatus.textContent = "Saved.";
    ocrStatus.className = "status";
    setTimeout(() => { ocrStatus.textContent = ""; }, 2000);
  });
});
