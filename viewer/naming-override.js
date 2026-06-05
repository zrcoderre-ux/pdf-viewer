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
