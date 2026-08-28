// Per-document naming-mode override.
//
// The toolbar dropdown lets the user pick a naming mode that applies
// only to the current document. The choice is keyed by the PDF's source
// URL and stored in chrome.storage.session, so it:
//   - Survives a tab reload (same URL → same override).
//   - Dies when Chrome closes — overrides don't pile up across days.
//   - Doesn't affect any other document the user opens.
//
// Resolution:
//   effective mode = perDocOverride(fileUrl) ?? global namingMode
//
// "No override" is the default state. The toolbar mirrors the effective
// mode when no override exists, and only stops tracking the global once
// the user actively makes a per-doc choice.

const KEY_PREFIX = "naming-override:";

function key(fileUrl) {
  return `${KEY_PREFIX}${fileUrl}`;
}

// Read the override for a specific file URL. Returns "source" | "footer"
// | null. null means "no override set — use the global default."
export async function getOverride(fileUrl) {
  if (!fileUrl) return null;
  const k = key(fileUrl);
  const got = await chrome.storage.session.get(k);
  const v = got[k];
  if (v === "source" || v === "footer") return v;
  return null;
}

// Write or clear the override. Pass null to clear.
export async function setOverride(fileUrl, mode) {
  if (!fileUrl) return;
  const k = key(fileUrl);
  if (mode === "source" || mode === "footer") {
    await chrome.storage.session.set({ [k]: mode });
  } else {
    await chrome.storage.session.remove(k);
  }
}

// Subscribe to changes for a specific file URL. Caller's callback is
// invoked with the new override value (or null if cleared) whenever the
// session entry for this URL changes. Used so multiple toolbars open
// on the same PDF stay in sync if the user toggles in one.
export function onOverrideChange(fileUrl, cb) {
  if (!fileUrl) return () => {};
  const k = key(fileUrl);
  const listener = (changes, area) => {
    if (area !== "session") return;
    if (!(k in changes)) return;
    const v = changes[k].newValue;
    cb(v === "source" || v === "footer" ? v : null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// Resolve which naming rules apply to the current document. Two inputs decide
// it: where the document came from, and whether the user has made a per-doc
// choice in the toolbar dropdown.
//
//   mode           — "source" | "footer": which name the viewer displays.
//   keepSourceName — true when the document's own filename is shown verbatim:
//                    no rule engine, no footer title, no caption override, no
//                    part/volume suffix, no cross-tab disambiguation.
//
// A PDF opened from disk (file:// in the extension, or a File handed to the
// app) already has a name — the one it was downloaded or filed under. Renaming
// is for PDFs read before download, where the name is still ours to pick; once
// a file lives on disk, its name is the user's. So a local document keeps its
// filename unless the user asks for something else in the toolbar dropdown,
// which lifts the suppression for that document.
export function resolveNaming({
  isLocalDocument = false,
  perDocOverride = null,
  globalNamingMode = "source",
} = {}) {
  const override =
    perDocOverride === "source" || perDocOverride === "footer" ? perDocOverride : null;
  const base = isLocalDocument
    ? "source"
    : (globalNamingMode === "footer" ? "footer" : "source");
  return { mode: override || base, keepSourceName: isLocalDocument && !override };
}
