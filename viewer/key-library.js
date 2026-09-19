// key-library.js
//
// The pseudonym keys this browser has been shown, and the <select> that offers
// them.
//
// ONE LIBRARY, SHARED. The text reader reads PDF-Linker's scrubbed exports and
// the PDF viewer redacts the PDFs those exports came from, and both of them
// need the same file to do it. So the keys live in one place, under one
// storage key: a key loaded in the reader is the key the viewer redacts with,
// and neither page has to be handed the file twice.
//
// A key is filed under its name AND its signature (pseudo-key.keySignature),
// so the same key loaded again lands on the entry it already has rather than
// piling up beside it, and another matter's key never lands on this one's.
// The oldest fall off past MAX_KEYS; a key is one file-pick away from being
// recent again.

import { fold, keySignature, keyTitle, sameCaseKey } from "./pseudo-key.js";

export const KEYS_KEY = "textReader.keys";
const MAX_KEYS = 12;

function lsGet(k, dflt) {
  try { const v = localStorage.getItem(k); return v == null ? dflt : JSON.parse(v); } catch { return dflt; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or off */ }
}

/** Every key the library holds, as { id: parsedKey }. */
export function keyLibrary() { return lsGet(KEYS_KEY, {}); }

/** File a parsed key, and answer with the id it is filed under. */
export function storeKey(parsed, folder) {
  const lib = keyLibrary();
  let id = null;
  for (const k of Object.keys(lib)) if (sameCaseKey(lib[k], parsed)) { id = k; break; }
  if (!id) id = fold(parsed.name) + "#" + keySignature(parsed);
  const prev = lib[id] || {};
  lib[id] = Object.assign({}, parsed, { folder: folder || prev.folder || "", savedAt: Date.now() });
  // The oldest fall off; a key is one folder-pick away from being recent again.
  const ids = Object.keys(lib).sort((a, b) => (lib[b].savedAt || 0) - (lib[a].savedAt || 0));
  for (const old of ids.slice(MAX_KEYS)) delete lib[old];
  lsSet(KEYS_KEY, lib);
  return id;
}

/** The library's ids, most recently filed first. */
export function keyIds(lib) {
  const l = lib || keyLibrary();
  return Object.keys(l).sort((a, b) => (l[b].savedAt || 0) - (l[a].savedAt || 0));
}

/**
 * Fill a <select> with the library, `selectedId` chosen. A key that has since
 * fallen off the list leaves the select on "(no key)" rather than on nothing.
 */
export function fillKeySelect(selectEl, selectedId, noneLabel = "(no key)") {
  if (!selectEl) return;
  const lib = keyLibrary();
  selectEl.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = noneLabel;
  selectEl.appendChild(none);
  for (const id of keyIds(lib)) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = keyTitle(lib[id]) + " · " + lib[id].rows + " rows";
    selectEl.appendChild(o);
  }
  selectEl.value = selectedId || "";
  if (selectEl.value !== (selectedId || "")) selectEl.value = "";
}
