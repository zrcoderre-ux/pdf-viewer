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

import { caseMemo } from "./citation-linker.js";

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

  function clear() {
    cases.clear();
    auth.clear();
  }

  return {
    get url() { return key; },
    get size() { return auth.size; },

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
      }
      const memo = caseMemo(cite);
      if (memo && !cases.has(memo.key)) cases.set(memo.key, memo);
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
