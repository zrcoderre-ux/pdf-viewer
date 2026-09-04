// citation-memory.js
//
// What a page has already shown us, kept for as long as the reader stays on it.
//
// A chat page is not a document. claude.ai (and every app like it) mounts and
// unmounts its own text as the user scrolls, so a citation five screens up can
// leave the DOM entirely. A scan that reads only the live DOM therefore loses
// authorities the reader has, in every sense that matters, already seen — the
// Table of Authorities shrinks as you scroll, which is exactly backwards.
//
// This module is the memory that keeps them:
//
//   authorities(resolve)  every authority found on this page so far, deduped,
//                         in the shape the Table of Authorities panel renders.
//                         URLs are re-resolved on each call so a provider
//                         switch updates remembered entries too.
//   priorCases()          the full case citations found on this page so far, in
//                         the shape findAllCitations({ priorCases }) wants, so
//                         an italicized short name still links to its case
//                         after the full cite has scrolled out of the DOM.
//
// Both are scoped to one URL — origin + path, so a query string or a #hash is
// the same page — and cleared when the app navigates somewhere else, because a
// different conversation has different authorities.
//
// The memory also survives a reload. A refresh is not a new conversation, and
// coming back to a table that has forgotten the first half of the thread is the
// same loss as scrolling. toJSON() / hydrate() are the two ends of that: the
// content script writes the record to chrome.storage.local under this page's
// key and reads it back on the way in. Storage is bounded by prunePageIndex()
// rather than left to grow — a few dozen conversations, none of them stale.

import { caseMemo } from "./citation-linker.js";

// How much of the browsing history the memory carries. Enough that a reader
// moving between the conversations they are working in finds every table
// intact; not so much that the extension quietly hoards a reading history.
export const MAX_PAGES = 40;
export const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;   // a fortnight

// Where one page's record lives in chrome.storage.local. The index (which page
// was seen when) is one small key of its own, so a save writes back only the
// conversation being read rather than the whole history.
export const PAGE_INDEX_KEY = "toaPageIndex";
export function pageStoreKey(key) {
  return `toaPage:${key}`;
}

// The index, trimmed to what is worth keeping, plus the pages that fell out of
// it — their records are the caller's to delete. Pruning is by last sighting:
// anything untouched for MAX_AGE_MS goes, then the oldest beyond MAX_PAGES.
export function prunePageIndex(index, opts = {}) {
  const now = opts.now === undefined ? Date.now() : opts.now;
  const maxPages = opts.maxPages === undefined ? MAX_PAGES : opts.maxPages;
  const maxAge = opts.maxAge === undefined ? MAX_AGE_MS : opts.maxAge;

  const entries = Object.entries(index || {})
    .filter(([k, at]) => k && typeof at === "number" && Number.isFinite(at))
    .sort((a, b) => b[1] - a[1]);

  const kept = {};
  const dropped = [];
  for (const [k, at] of entries) {
    const stale = now - at > maxAge;
    if (stale || Object.keys(kept).length >= maxPages) dropped.push(k);
    else kept[k] = at;
  }
  return { index: kept, dropped };
}

// The identity of a page for memory purposes. A query string or fragment
// scrolls or filters the same conversation; the path is what changes when the
// reader moves to another one.
export function pageKey(href) {
  try {
    const u = new URL(href);
    return u.origin + u.pathname;
  } catch {
    return String(href || "");
  }
}

// The fields resolveUrl() needs to rebuild a link later, when the citation's
// text may be long gone from the page.
function descriptorOf(cite) {
  return {
    kind: cite.kind,
    key: cite.key,
    wlOnly: !!cite.wlOnly,
    lexisOnly: !!cite.lexisOnly,
    slipOnly: !!cite.slipOnly,
  };
}

export function createCitationMemory() {
  let key = null;
  const cases = new Map();  // case key -> memo for the italic short-name pass
  const auth = new Map();   // key -> { key, kind, cite, url }
  // Bumped whenever something is learned, so the caller can tell a memory worth
  // writing back from one that has only been read. Monotonic across pages.
  let revision = 0;

  function clear() {
    cases.clear();
    auth.clear();
  }

  return {
    get url() { return key; },
    get size() { return auth.size; },
    get revision() { return revision; },

    // Point the memory at a page. Returns true when that page is a new one —
    // everything remembered about the old one is dropped.
    setUrl(href) {
      const next = pageKey(href);
      if (next === key) return false;
      key = next;
      clear();
      return true;
    },

    clear,

    // Record one resolved citation. Later sightings of the same authority
    // refresh its URL (the provider may have changed) but never displace what
    // was learned about it — a short-form sighting must not overwrite the full
    // cite's memo.
    remember(cite, url) {
      if (!cite || !cite.key) return;
      const existing = auth.get(cite.key);
      if (existing) {
        if (url) existing.url = url;
      } else {
        auth.set(cite.key, {
          key: cite.key,
          kind: cite.kind,
          cite: descriptorOf(cite),
          url: url || "",
        });
        revision++;
      }
      const memo = caseMemo(cite);
      if (memo && !cases.has(memo.key)) { cases.set(memo.key, memo); revision++; }
    },

    // The page's record, for chrome.storage.local.
    toJSON() {
      return {
        authorities: [...auth.values()],
        cases: [...cases.values()],
      };
    },

    // Fold a stored record back in. Additive and idempotent: what the current
    // scan already knows wins, so a stale saved URL never displaces a link just
    // resolved, and re-hydrating the same record twice learns nothing new (which
    // is what stops a hydrate → save → hydrate loop). Anything malformed in
    // storage is skipped rather than trusted.
    hydrate(record) {
      if (!record || typeof record !== "object") return false;
      let learned = false;
      for (const a of Array.isArray(record.authorities) ? record.authorities : []) {
        if (!a || !a.key || !a.kind || !a.cite || auth.has(a.key)) continue;
        auth.set(a.key, {
          key: a.key,
          kind: a.kind,
          cite: descriptorOf({ ...a.cite, kind: a.cite.kind || a.kind, key: a.cite.key || a.key }),
          url: typeof a.url === "string" ? a.url : "",
        });
        learned = true;
      }
      for (const c of Array.isArray(record.cases) ? record.cases : []) {
        if (!c || !c.key || !c.caseName || cases.has(c.key)) continue;
        cases.set(c.key, { ...c, kind: "case", span: [-1, -1] });
        learned = true;
      }
      if (learned) revision++;
      return learned;
    },

    // Full case cites seen on this page, for findAllCitations({ priorCases }).
    priorCases() {
      return [...cases.values()];
    },

    // Everything seen on this page, as the TOA panel wants it. `resolve` is
    // optional; when given it re-derives each URL from the current provider
    // and repo, falling back to the URL the citation carried when first seen.
    authorities(resolve) {
      const out = [];
      for (const rec of auth.values()) {
        if (resolve) {
          let url = null;
          try { url = resolve(rec.cite); } catch { url = null; }
          if (url) rec.url = url;
        }
        if (!rec.url) continue;
        out.push({ key: rec.key, kind: rec.kind, url: rec.url });
      }
      return out;
    },
  };
}
