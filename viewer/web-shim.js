// web-shim.js
//
// The `chrome.*` shim for running the viewer pages as HOSTED pages (the
// installed PWA on GitHub Pages), where the extension APIs don't exist. It is
// installed as a side effect of importing this module, so a page's entry
// module imports it FIRST and every module evaluated after it sees
// `chrome.storage` / `chrome.runtime.getURL` exactly as it would inside the
// extension. Inside the extension `chrome.storage` exists and the whole thing
// is skipped, so extension behaviour is untouched.
//
// Shared by viewer.js (the PDF viewer) and text-reader.js (the text reader);
// it used to live at the top of viewer.js and moved here unchanged when the
// second page needed it.
// ---------------------------------------------------------------------------
// Web (PWA) shim. This is the citation-linking viewer from the Chrome
// extension. When it is served as a hosted page instead — the installed PWA on
// GitHub Pages — the `chrome.*` extension APIs don't exist. Define a minimal
// shim, backed by Web Storage, so the identical viewer code runs unchanged in
// both places. Inside the extension `chrome.storage` exists and this whole
// block is skipped, so extension behavior is untouched.
if (typeof chrome === "undefined" || !(chrome && chrome.storage)) {
  const ROOT = new URL("../", import.meta.url).href; // dir holding viewer/ & pdfjs/
  const listeners = [];
  const notify = (changes, area) => {
    if (!changes || !Object.keys(changes).length) return;
    for (const fn of listeners) {
      try { fn(changes, area); } catch (e) { console.error(e); }
    }
  };
  const makeArea = (store, areaName) => {
    const read = (k) => {
      const raw = store.getItem(k);
      if (raw == null) return undefined;
      try { return JSON.parse(raw); } catch { return undefined; }
    };
    return {
      get(query, cb) {
        const out = {};
        if (query == null) {
          for (let i = 0; i < store.length; i++) { const k = store.key(i); out[k] = read(k); }
        } else if (typeof query === "string") {
          const v = read(query); if (v !== undefined) out[query] = v;
        } else if (Array.isArray(query)) {
          for (const k of query) { const v = read(k); if (v !== undefined) out[k] = v; }
        } else {
          for (const k of Object.keys(query)) { const v = read(k); out[k] = v === undefined ? query[k] : v; }
        }
        if (cb) return void cb(out);
        return Promise.resolve(out);
      },
      set(items, cb) {
        const changes = {};
        for (const k of Object.keys(items)) {
          const oldValue = read(k);
          store.setItem(k, JSON.stringify(items[k]));
          changes[k] = { oldValue, newValue: items[k] };
        }
        notify(changes, areaName);
        if (cb) return void cb();
        return Promise.resolve();
      },
      remove(keys, cb) {
        const arr = Array.isArray(keys) ? keys : [keys];
        const changes = {};
        for (const k of arr) { const oldValue = read(k); store.removeItem(k); changes[k] = { oldValue, newValue: undefined }; }
        notify(changes, areaName);
        if (cb) return void cb();
        return Promise.resolve();
      },
    };
  };
  // `session` is backed by real sessionStorage, which sibling viewer iframes in
  // the PWA's tab bar SHARE (it belongs to the enclosing browser tab, and it
  // clears when that tab closes — the right lifetime for session state). This
  // sharing is what lets same-named documents in different PWA tabs see each
  // other and disambiguate ("Vol. 1" / "Vol. 2"). Each iframe gets a unique
  // synthetic tab id so per-tab keys never collide; per-document keys (naming
  // overrides, keyed by URL) are shared deliberately. `local`/`sync` stay on
  // localStorage so settings persist across sessions.
  const SYNTH_TAB_ID = (() => {
    const buf = new Uint32Array(1);
    (self.crypto || { getRandomValues: (b) => { b[0] = Math.floor(Math.random() * 2 ** 31); } })
      .getRandomValues(buf);
    return buf[0] % 2 ** 31 || 1;
  })();
  window.chrome = {
    __pwaShim: true,
    runtime: { getURL: (p) => new URL(String(p).replace(/^\/+/, ""), ROOT).href },
    storage: {
      local: makeArea(localStorage, "local"),
      sync: makeArea(localStorage, "sync"),
      session: makeArea(sessionStorage, "session"),
      onChanged: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
      },
    },
    tabs: {
      getCurrent: (cb) => cb({ id: SYNTH_TAB_ID }),
      query: (_q, cb) => cb([{ id: SYNTH_TAB_ID }]),
      remove: () => {},
    },
  };
  // A `storage` event fires in every OTHER same-origin window when session/
  // local storage changes (the writer notifies itself via makeArea's notify).
  // Translate sessionStorage events into chrome.storage.onChanged so a sibling
  // PWA tab registering its document triggers this tab's collision recompute.
  window.addEventListener("storage", (e) => {
    if (!e || e.key == null || e.storageArea !== sessionStorage) return;
    const parse = (v) => {
      if (v == null) return undefined;
      try { return JSON.parse(v); } catch { return undefined; }
    };
    notify({ [e.key]: { oldValue: parse(e.oldValue), newValue: parse(e.newValue) } }, "session");
  });
}
