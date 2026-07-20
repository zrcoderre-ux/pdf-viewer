// Cross-tab disambiguation registry.
//
// Each viewer tab registers its document's parsed footer attributes
// (canonical, target, party, partyLabel) in chrome.storage.session under
// a per-tab key.
// All viewer tabs subscribe to changes; when another tab's canonical
// collides with this tab's, the disambiguator runs and the display name
// is recomputed.
//
// chrome.storage.session is used (not sync, not local) because:
//   - Session storage clears when Chrome restarts, matching the "this is
//     a per-session display-only feature" semantics. We don't want stale
//     entries from closed tabs polluting future disambiguation.
//   - It's faster than sync and doesn't have a quota that matters here.
//   - It's per-profile so it correctly covers all viewer tabs the user
//     can see simultaneously.
//
// Stale entries from crashed/force-closed tabs are cleaned up on the next
// registration: we list all session keys and remove any that don't
// correspond to a currently-existing tab. (chrome.tabs.query is available
// to the viewer because the extension holds the "tabs" permission.)

import { disambiguate } from "./footer-naming.js";

const KEY_PREFIX = "titledoc:";

function key(tabId) {
  return `${KEY_PREFIX}${tabId}`;
}

// Get this tab's id. Wrapped in a memoized promise because chrome.tabs
// is async and the value never changes for the life of the page. The resolved
// value is also cached synchronously for teardown paths (see unregisterEntry).
let _myTabIdPromise = null;
let _myTabIdCached = null;
function getMyTabId() {
  if (_myTabIdPromise) return _myTabIdPromise;
  _myTabIdPromise = new Promise((resolve) => {
    chrome.tabs.getCurrent((tab) => {
      _myTabIdCached = tab ? tab.id : null;
      resolve(_myTabIdCached);
    });
  });
  return _myTabIdPromise;
}

// Sweep stale entries — any session-storage key whose tabId no longer
// corresponds to an open tab. Called on register; cheap because session
// storage is small (one entry per open viewer tab).
async function sweepStale() {
  // Under the PWA shim, chrome.tabs.query only knows about THIS viewer iframe,
  // so the sweep would wrongly purge every sibling tab's entry. The PWA cleans
  // up differently: the shell purges the registry on boot and unregisters a
  // tab's entry when it closes it.
  if (chrome.__pwaShim) return;
  const all = await chrome.storage.session.get(null);
  const openTabIds = new Set(
    await new Promise((res) =>
      chrome.tabs.query({}, (tabs) => res(tabs.map((t) => t.id)))
    )
  );
  const stale = [];
  for (const k of Object.keys(all)) {
    if (!k.startsWith(KEY_PREFIX)) continue;
    const id = Number(k.slice(KEY_PREFIX.length));
    if (!openTabIds.has(id)) stale.push(k);
  }
  if (stale.length) await chrome.storage.session.remove(stale);
}

// Register this tab's parsed footer entry. `entry` is
// { canonical, target, party }. Call once per document load (after the
// footer pass resolves). Subsequent calls overwrite — which is what we
// want if the user navigates the same tab to a different PDF.
export async function registerEntry(entry) {
  const tabId = await getMyTabId();
  if (tabId == null) return;
  await sweepStale();
  await chrome.storage.session.set({ [key(tabId)]: entry });
}

// Unregister on tab close. Wired via beforeunload from viewer.js and called
// by the PWA shell right before it removes a tab's iframe. When the tab id is
// already cached, skip the await: a document being torn down never gets
// another microtask, and under the PWA shim the storage removal itself runs
// synchronously inside the call — so the fast path is what makes close-time
// cleanup actually happen.
export function unregisterEntry() {
  if (_myTabIdCached != null) {
    return chrome.storage.session.remove(key(_myTabIdCached));
  }
  return (async () => {
    const tabId = await getMyTabId();
    if (tabId == null) return;
    await chrome.storage.session.remove(key(tabId));
  })();
}

// Read all currently-registered entries and run the disambiguator across
// them. Returns the display name this tab should show, or null if this
// tab isn't registered yet.
export async function computeDisplayForThisTab() {
  const tabId = await getMyTabId();
  if (tabId == null) return null;
  const all = await chrome.storage.session.get(null);
  const entries = [];
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith(KEY_PREFIX)) continue;
    if (!v || typeof v !== "object") continue;
    entries.push({
      id: Number(k.slice(KEY_PREFIX.length)),
      canonical: v.canonical,
      target: v.target,
      party: v.party,
      partyLabel: v.partyLabel,
      partyName: v.partyName,
      partVol: v.partVol,
    });
  }
  if (entries.length === 0) return null;
  const map = disambiguate(entries);
  return map.get(tabId) || null;
}

// Subscribe to changes in any tab's session entry. Caller's callback is
// invoked with the new computed display name for THIS tab whenever any
// other tab registers, updates, or unregisters.
export function onCollisionUpdate(cb) {
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "session") return;
    // Was any titledoc:* key affected?
    let touched = false;
    for (const k of Object.keys(changes)) {
      if (k.startsWith(KEY_PREFIX)) { touched = true; break; }
    }
    if (!touched) return;
    const name = await computeDisplayForThisTab();
    if (name) cb(name);
  });
}
