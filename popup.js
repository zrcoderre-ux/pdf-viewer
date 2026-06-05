// Popup behaviour: reflect the stored provider and naming-mode preferences
// in the radio buttons, and persist any change back to chrome.storage.sync.
// Open viewer tabs subscribe to storage.onChanged and re-render automatically.
//
// Both controls write to the GLOBAL preferences in chrome.storage.sync.
// Per-document overrides set via the viewer toolbar live in
// chrome.storage.session and are not exposed here — they only affect the
// document the user clicks in.

const providerRadios = document.querySelectorAll('input[name="provider"]');
const namingRadios   = document.querySelectorAll('input[name="namingMode"]');

chrome.storage.sync.get(
  { provider: "lexis", namingMode: "source" },
  ({ provider, namingMode }) => {
    for (const r of providerRadios) r.checked = (r.value === provider);
    const v = namingMode === "footer" ? "footer" : "source";
    for (const r of namingRadios) r.checked = (r.value === v);
  }
);

for (const r of providerRadios) {
  r.addEventListener("change", () => {
    if (r.checked) chrome.storage.sync.set({ provider: r.value });
  });
}

for (const r of namingRadios) {
  r.addEventListener("change", () => {
    if (r.checked) chrome.storage.sync.set({ namingMode: r.value });
  });
}
