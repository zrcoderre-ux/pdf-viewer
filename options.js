// Options page: provider toggle (synced) + citation_repo.json upload (local).
//
// The repo lives in chrome.storage.local rather than .sync because it can
// exceed the 8 KB per-item sync quota. Open viewer tabs subscribe to local
// changes and re-render when the repo updates.

const radios = document.querySelectorAll('input[name="provider"]');
const namingRadios = document.querySelectorAll('input[name="namingMode"]');
const fileInput  = document.getElementById("repo-file");
const clearBtn   = document.getElementById("repo-clear");
const repoInfo   = document.getElementById("repo-info");
const repoStatus = document.getElementById("repo-status");

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

// Table of Authorities panel toggle (synced; default on). Open viewer tabs and
// the claude.ai content script subscribe to this key and show/hide live.
const toaEnabledEl = document.getElementById("toa-enabled");
if (toaEnabledEl) {
  chrome.storage.sync.get({ toaEnabled: true }, ({ toaEnabled }) => {
    toaEnabledEl.checked = toaEnabled !== false;
  });
  toaEnabledEl.addEventListener("change", () => {
    chrome.storage.sync.set({ toaEnabled: toaEnabledEl.checked });
  });
}

// Init repo info
function refreshRepoInfo() {
  chrome.storage.local.get({ citationRepo: null, citationRepoMeta: null }, (res) => {
    const meta = res.citationRepoMeta;
    if (!res.citationRepo || !meta) {
      repoInfo.textContent = "No repository loaded.";
      return;
    }
    repoInfo.textContent =
      `Loaded ${meta.filename || "repo"} — ` +
      `${meta.cases || 0} cases, ${meta.statutes || 0} statutes, ` +
      `${meta.rules || 0} rules.`;
  });
}
refreshRepoInfo();

fileInput.addEventListener("change", () => {
  const f = fileInput.files && fileInput.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch (e) {
      repoStatus.textContent = "Could not parse JSON: " + e.message;
      repoStatus.className = "status error";
      return;
    }
    const meta = {
      filename: f.name,
      cases:    Object.keys(parsed.cases    || {}).length,
      statutes: Object.keys(parsed.statutes || {}).length,
      rules:    Object.keys(parsed.rules    || {}).length,
    };
    chrome.storage.local.set(
      { citationRepo: parsed, citationRepoMeta: meta },
      () => {
        repoStatus.textContent = "Repository loaded.";
        repoStatus.className = "status";
        refreshRepoInfo();
      }
    );
  };
  reader.readAsText(f);
});

clearBtn.addEventListener("click", () => {
  chrome.storage.local.remove(["citationRepo", "citationRepoMeta"], () => {
    repoStatus.textContent = "Repository cleared.";
    repoStatus.className = "status";
    refreshRepoInfo();
  });
});

// ---------- Extra PDF URL patterns ----------

const patternsTextarea = document.getElementById("patterns");
const patternsSaveBtn  = document.getElementById("patterns-save");
const patternsStatus   = document.getElementById("patterns-status");

chrome.storage.sync.get({ pdfUrlPatterns: [] }, ({ pdfUrlPatterns }) => {
  patternsTextarea.value = (pdfUrlPatterns || []).join("\n");
});

patternsSaveBtn.addEventListener("click", () => {
  const lines = patternsTextarea.value
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  chrome.storage.sync.set({ pdfUrlPatterns: lines }, () => {
    patternsStatus.textContent =
      lines.length === 0
        ? "Cleared."
        : `Saved ${lines.length} pattern${lines.length === 1 ? "" : "s"}.`;
    patternsStatus.className = "status";
    setTimeout(() => { patternsStatus.textContent = ""; }, 2500);
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
