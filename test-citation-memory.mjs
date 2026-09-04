// Node-runnable tests: the Table of Authorities does not shrink as you scroll,
// and a short name still links after the full cite has left the page.
// Run: node test-citation-memory.mjs
//
// A chat page is not a document. claude.ai mounts and unmounts its own messages
// as the reader scrolls, so a scan that reads only the live DOM loses citations
// the reader has already seen: cases drop out of the Table of Authorities on the
// way down the page, and an italicized short name loses the full cite it points
// back to. viewer/citation-memory.js is the fix — a memory scoped to one URL,
// cleared when the app navigates to another conversation.
//
// Two layers are tested here. The memory module is exercised directly, and the
// real content script is then run over a stubbed DOM: a vm-free harness that
// puts just enough document/window/chrome on the globals to execute
// content/claude-citations.js and viewer/toa.js unmodified, so what is asserted
// is what the extension actually paints and lists.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCitationMemory, pageKey, pageStoreKey, prunePageIndex, PAGE_INDEX_KEY,
} from "./viewer/citation-memory.js";
import { findAllCitations, caseMemo } from "./viewer/citation-linker.js";

const SRC = path.dirname(fileURLToPath(import.meta.url)) + "/";

let fails = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        got : ${JSON.stringify(got)}`);
    console.log(`        want: ${JSON.stringify(want)}`);
    fails++;
  }
}

const MARKET_LOFTS =
  "Market Lofts Community Assn. v. 9th Street Market Lofts, LLC (2014) 222 Cal.App.4th 924";
const AGUILAR = "Aguilar v. Atlantic Richfield Co. (2001) 25 Cal.4th 826";
const SMITH_JONES = "Smith v. Jones (1999) 20 Cal.4th 100";
const PEOPLE_SMITH = "People v. Smith (2003) 31 Cal.4th 200";

// ---------------------------------------------------------------------------
// The memory module on its own
// ---------------------------------------------------------------------------

console.log("\n--- what counts as the same page ---");
check("query strings and fragments are the same page", [
  pageKey("https://claude.ai/chat/abc") === pageKey("https://claude.ai/chat/abc?x=1"),
  pageKey("https://claude.ai/chat/abc") === pageKey("https://claude.ai/chat/abc#msg-9"),
  pageKey("https://claude.ai/chat/abc") === pageKey("https://claude.ai/chat/def"),
], [true, true, false]);

console.log("\n--- an authority is remembered until the page changes ---");
{
  const mem = createCitationMemory();
  mem.setUrl("https://claude.ai/chat/abc");
  const [aguilar] = findAllCitations(`See ${AGUILAR}.`);
  mem.remember(aguilar, "https://lexis.test/aguilar");
  check("recorded once", mem.authorities().map((a) => [a.kind, a.key]),
    [["case", AGUILAR]]);
  check("the same page (with a hash) keeps it", [
    mem.setUrl("https://claude.ai/chat/abc#deep"),
    mem.authorities().length,
  ], [false, 1]);
  check("another conversation clears it", [
    mem.setUrl("https://claude.ai/chat/def"),
    mem.authorities().length,
    mem.priorCases().length,
  ], [true, 0, 0]);
}

console.log("\n--- a remembered URL is re-derived when the provider changes ---");
{
  const mem = createCitationMemory();
  mem.setUrl("https://claude.ai/chat/abc");
  const [aguilar] = findAllCitations(`See ${AGUILAR}.`);
  mem.remember(aguilar, "https://lexis.test/aguilar");
  check(
    "the resolver supplies the current link",
    mem.authorities((c) => `https://westlaw.test/${c.kind}`).map((a) => a.url),
    ["https://westlaw.test/case"]
  );
  check(
    "a resolver that comes up empty leaves the last known link",
    mem.authorities(() => null).map((a) => a.url),
    ["https://westlaw.test/case"]
  );
  check(
    "a resolver that throws leaves the last known link",
    mem.authorities(() => { throw new Error("no repo"); }).map((a) => a.url),
    ["https://westlaw.test/case"]
  );
}

console.log("\n--- only full citations become case memos ---");
{
  const cites = findAllCitations(`${AGUILAR}, 850. Aguilar, supra, at 851.`);
  check("a supra reference carries no party names", caseMemo(cites[1]), null);
  check("the full cite does", caseMemo(cites[0]).plaintiff, "Aguilar");
}

// ---------------------------------------------------------------------------
// A DOM small enough to reason about, real enough to run the content script
// ---------------------------------------------------------------------------

const RECT = { left: 10, top: 20, width: 100, height: 16, right: 110, bottom: 36 };

function matchesSel(el, sel) {
  return sel.split(",").some((raw) => {
    const part = raw.trim();
    if (!part) return false;
    if (part[0] === "#") return el.id === part.slice(1);
    if (part[0] === ".") return String(el.className).split(/\s+/).includes(part.slice(1));
    if (part[0] === "[") {
      const m = /^\[([\w-]+)(?:=['"]?(.*?)['"]?)?\]$/.exec(part);
      if (!m) return false;
      const v = el.attrs[m[1]];
      return m[2] === undefined ? v !== undefined : v === m[2];
    }
    return el.tagName === part.toUpperCase();
  });
}

function makeEl(tag, opts = {}) {
  const el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id: opts.id || "",
    className: "",
    title: "",
    attrs: opts.attrs || {},
    italic: !!opts.italic || /^(EM|I)$/.test(tag.toUpperCase()),
    style: {},
    dataset: {},
    children: [],                       // elements AND text nodes, in order
    parentElement: null,
    isConnected: false,
    _text: "",
    classList: { toggle() {}, add() {}, remove() {} },
    get textContent() {
      return this.children.reduce(
        (acc, c) => acc + (c.nodeType === 3 ? c.nodeValue : c.textContent),
        this._text
      );
    },
    set textContent(v) {
      for (const c of this.children) c.parentElement = null;
      this.children = [];
      this._text = v;
    },
    appendChild(child) {
      child.parentElement = this;
      child.isConnected = this.isConnected;
      this.children.push(child);
      return child;
    },
    append(...kids) { for (const k of kids) this.appendChild(k); },
    remove() {
      if (!this.parentElement) return;
      this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
      this.parentElement = null;
      this.isConnected = false;
    },
    closest(sel) {
      let n = this;
      while (n) { if (matchesSel(n, sel)) return n; n = n.parentElement; }
      return null;
    },
    querySelector(sel) {
      let found = null;
      (function walk(node) {
        for (const c of node.children) {
          if (found) return;
          if (c.nodeType !== 1) continue;
          if (matchesSel(c, sel)) { found = c; return; }
          walk(c);
        }
      })(this);
      return found;
    },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect() { return { ...RECT }; },
    getClientRects() { return [{ ...RECT }]; },
  };
  for (const k of opts.children || []) el.appendChild(k);
  return el;
}

const text = (value) => ({ nodeType: 3, nodeValue: value, parentElement: null, isConnected: true });
// A paragraph of plain text, with «guillemets» marking the italic runs — the
// same convention test-italic-short-names.mjs uses, except that here italics
// become real <em> elements, since the content script reads posture off the DOM.
function para(src, tag = "p") {
  const kids = [];
  for (const [i, chunk] of src.split(/«|»/).entries()) {
    if (!chunk) continue;
    kids.push(i % 2 ? makeEl("em", { children: [text(chunk)] }) : text(chunk));
  }
  return makeEl(tag, { children: kids });
}

// Install the globals the content script and the panel expect, run the real
// script, and hand back the levers the tests need.
async function loadPage(href, blocks, store = {}) {
  const body = makeEl("body", { children: blocks });
  const html = makeEl("html");
  html.isConnected = true;
  html.appendChild(body);

  let observerCb = null;
  const doc = {
    readyState: "complete",
    body,
    documentElement: html,
    head: makeEl("head"),
    createElement: (t) => makeEl(t),
    createTreeWalker(root, mask) {
      const queue = [];
      (function push(node) {
        for (const c of node.children || []) { queue.push(c); push(c); }
      })(root);
      const want = (n) => (n.nodeType === 1 ? mask & 1 : mask & 4);
      return { nextNode() { while (queue.length) { const n = queue.shift(); if (want(n)) return n; } return null; } };
    },
    createRange() {
      return {
        setStart() {}, setEnd() {},
        getClientRects() { return [{ ...RECT }]; },
      };
    },
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };

  const listeners = new Map();
  globalThis.window = globalThis;
  globalThis.addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  };
  globalThis.removeEventListener = () => {};
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 720;
  globalThis.document = doc;
  globalThis.location = { href, host: new URL(href).host };
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  globalThis.NodeFilter = { SHOW_ELEMENT: 1, SHOW_TEXT: 4 };
  globalThis.getComputedStyle = (el) => ({
    fontStyle: el.italic ? "italic" : "normal",
    overflowX: "visible", overflowY: "visible", position: "static",
  });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.MutationObserver = class { constructor(cb) { observerCb = cb; } observe() {} };
  // A real (if tiny) chrome.storage.local: the same object can be handed to a
  // second loadPage() call, which is what a reload looks like from in here.
  globalThis.chrome = {
    runtime: { getURL: (p) => new URL(p, `file://${SRC}`).href, lastError: null },
    storage: {
      sync: { get: (defaults, cb) => cb(defaults) },
      local: {
        get(defaults, cb) {
          const out = {};
          for (const [k, v] of Object.entries(defaults)) {
            out[k] = k in store ? store[k] : v;
          }
          cb(out);
        },
        set(obj, cb) { Object.assign(store, obj); if (cb) cb(); },
        remove(keys, cb) {
          for (const k of [].concat(keys)) delete store[k];
          if (cb) cb();
        },
      },
      onChanged: { addListener: () => {} },
    },
  };
  globalThis.__claudeCitationsLoaded = false;
  globalThis.__shiftSpaceLinkSources = [];
  globalThis.__citationLinker = undefined;

  // Dynamic import() only resolves inside real module code, which a Function
  // body is — the script itself is run unmodified.
  new Function(fs.readFileSync(SRC + "content/claude-citations.js", "utf8"))();
  await settle();

  const panelBody = () => {
    const panel = html.children.find((c) => c.id === "__cl_toa");
    return panel ? panel.querySelector(".cl-toa-body") : null;
  };
  return {
    // Every authority the panel is showing, in the order it renders them
    // (alphabetically within each group). A hidden panel shows none.
    toaKeys() {
      const panel = html.children.find((c) => c.id === "__cl_toa");
      if (!panel || panel.style.display === "none") return [];
      const b = panelBody();
      if (!b) return [];
      return b.children.filter((c) => c.className === "cl-toa-link").map((c) => c.textContent);
    },
    // Every in-text link painted, by the authority it points at.
    linkKeys() {
      const overlay = html.children.find((c) => c.id === "__cl_overlay");
      if (!overlay) return [];
      return overlay.children.map((a) => a.title.replace(/ → .*$/, ""));
    },
    body,
    // Re-run the scan the way a DOM change does, debounce and all.
    async rescan() { observerCb && observerCb(); await settle(600); },
    async navigate(nextHref) {
      globalThis.location = { href: nextHref, host: new URL(nextHref).host };
      await this.rescan();
    },
    // What a reload does on the way out: flush the memory to storage.
    async unload() {
      for (const fn of listeners.get("pagehide") || []) fn();
      await settle(120);
    },
  };
}

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// The content script over that DOM
// ---------------------------------------------------------------------------

console.log("\n--- the table keeps what scrolling takes away ---");
{
  const first = para(`The court in ${AGUILAR}, 850, set the standard.`);
  const page = await loadPage("https://claude.ai/chat/abc", [
    first,
    para(`See also ${MARKET_LOFTS}, 930.`),
  ]);
  check("both authorities listed", page.toaKeys(), [AGUILAR, MARKET_LOFTS]);

  first.remove();                       // the app unmounts the message
  await page.rescan();
  check("still both listed after the message is unmounted", page.toaKeys(),
    [AGUILAR, MARKET_LOFTS]);
  check("but only the mounted one is underlined", page.linkKeys(), [MARKET_LOFTS]);
}

console.log("\n--- a different conversation starts a fresh table ---");
{
  const page = await loadPage("https://claude.ai/chat/abc", [
    para(`The court in ${AGUILAR}, 850, set the standard.`),
  ]);
  check("listed on the first page", page.toaKeys(), [AGUILAR]);

  await page.navigate("https://claude.ai/chat/abc?tab=2");
  check("a query string is the same conversation", page.toaKeys(), [AGUILAR]);

  page.body.children = [];
  await page.navigate("https://claude.ai/chat/def");
  check("another conversation drops it", page.toaKeys(), []);
}

console.log("\n--- an italicized short name reaches back to the full cite ---");
{
  const page = await loadPage("https://claude.ai/chat/abc", [
    para(`The court in ${MARKET_LOFTS}, 930, construed the easement.`),
    para("«Market Lofts» controls the question presented here."),
  ]);
  check(
    "the paragraph above is close enough — this is what a per-block scan missed",
    page.linkKeys(),
    [MARKET_LOFTS, MARKET_LOFTS]
  );

  page.body.children[0].remove();       // the full cite scrolls away
  await page.rescan();
  check("and it still links once that paragraph is unmounted", page.linkKeys(),
    [MARKET_LOFTS]);
  check("the authority stays listed too", page.toaKeys(), [MARKET_LOFTS]);
}

console.log("\n--- an ambiguous fragment stays unlinked ---");
{
  const page = await loadPage("https://claude.ai/chat/abc", [
    para(`Compare ${SMITH_JONES}, 105, with ${PEOPLE_SMITH}, 210.`),
    para("«Smith» does not say which one."),
  ]);
  check("two cases answer to it, so neither wins", page.linkKeys(),
    [SMITH_JONES, PEOPLE_SMITH]);

  page.body.children[0].remove();
  await page.rescan();
  check("still ambiguous from memory alone", page.linkKeys(), []);
  check("both remain listed", page.toaKeys(), [PEOPLE_SMITH, SMITH_JONES]);
}

console.log("\n--- a citation is not invented across two blocks ---");
{
  const page = await loadPage("https://claude.ai/chat/abc", [
    para("The plaintiff sued in Smith v."),
    para("Jones (1999) 20 Cal.4th 100, and lost."),
  ]);
  check("nothing spans the paragraph break", page.toaKeys(), []);
}

console.log("\n--- a stored record is folded back in, junk and all ---");
{
  const mem = createCitationMemory();
  mem.setUrl("https://claude.ai/chat/abc");
  const [aguilar] = findAllCitations(`See ${AGUILAR}.`);
  mem.remember(aguilar, "https://lexis.test/aguilar");
  const saved = JSON.parse(JSON.stringify(mem.toJSON()));

  const restored = createCitationMemory();
  restored.setUrl("https://claude.ai/chat/abc");
  check("what was saved comes back", [
    restored.hydrate(saved),
    restored.authorities().map((a) => a.key),
    restored.priorCases().map((c) => c.key),
  ], [true, [AGUILAR], [AGUILAR]]);
  check("re-hydrating the same record learns nothing new",
    restored.hydrate(saved), false);
  check("malformed storage is skipped, not trusted", [
    restored.hydrate(null),
    restored.hydrate({ authorities: "nonsense", cases: 7 }),
    restored.hydrate({ authorities: [{ key: "" }, null], cases: [{ key: "x" }] }),
    restored.authorities().length,
  ], [false, false, false, 1]);
}

console.log("\n--- the stored history stays bounded ---");
{
  const day = 24 * 60 * 60 * 1000;
  const now = 1_000 * day;
  check("a page untouched for a fortnight is dropped", prunePageIndex(
    { fresh: now - day, stale: now - 15 * day },
    { now }
  ), { index: { fresh: now - day }, dropped: ["stale"] });

  const many = {};
  for (let i = 0; i < 5; i++) many[`p${i}`] = now - i * 1000;
  check("the oldest beyond the cap are dropped", prunePageIndex(many, { now, maxPages: 3 }), {
    index: { p0: now, p1: now - 1000, p2: now - 2000 },
    dropped: ["p3", "p4"],
  });
  check("garbage entries are dropped too",
    prunePageIndex({ good: now, bad: "yesterday", worse: null }, { now }),
    { index: { good: now }, dropped: [] });
}

console.log("\n--- a reload does not empty the table ---");
{
  const store = {};
  const page = await loadPage("https://claude.ai/chat/abc", [
    para(`The court in ${AGUILAR}, 850, set the standard.`),
    para(`See also ${MARKET_LOFTS}, 930.`),
  ], store);
  check("found while reading", page.toaKeys(), [AGUILAR, MARKET_LOFTS]);
  await page.unload();
  check("written to storage under this conversation's key",
    Object.keys(store).sort(),
    [PAGE_INDEX_KEY, pageStoreKey("https://claude.ai/chat/abc")].sort());

  // The reload: the same URL, the same storage, and a page whose messages
  // haven't been rendered back yet.
  const reloaded = await loadPage("https://claude.ai/chat/abc", [], store);
  check("still listed after the reload", reloaded.toaKeys(), [AGUILAR, MARKET_LOFTS]);
  check("with nothing underlined, since nothing is on the page yet",
    reloaded.linkKeys(), []);

  // And an italic short name still reaches a case it read before the reload.
  const returning = await loadPage("https://claude.ai/chat/abc", [
    para("«Market Lofts» remains the closest authority."),
  ], store);
  check("a short name links to a case remembered from before the reload",
    returning.linkKeys(), [MARKET_LOFTS]);

  const other = await loadPage("https://claude.ai/chat/zzz", [], store);
  check("another conversation gets its own (empty) table", other.toaKeys(), []);
}

console.log("\n--- and it is written without waiting to be unloaded ---");
{
  // Nothing guarantees a pagehide (a crashed tab, a killed browser), so the
  // save also runs on its own a beat after the last thing was found.
  const store = {};
  await loadPage("https://claude.ai/chat/slow", [
    para(`The court in ${AGUILAR}, 850, set the standard.`),
  ], store);
  check("not written the instant it is found", Object.keys(store), []);
  await settle(1800);
  check("written once the page settles", [
    Object.keys(store[PAGE_INDEX_KEY] || {}).includes("https://claude.ai/chat/slow"),
    (store[pageStoreKey("https://claude.ai/chat/slow")] || {}).authorities.map((a) => a.key),
  ], [true, [AGUILAR]]);
}

console.log("\n" + "=".repeat(60));
console.log(`FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
