// Node-runnable tests for Shift+Space = middle click.
// Run: node test-shift-space-open.mjs
//
// Three pieces have to agree: the shortcut script that finds the links
// (viewer/shift-space-open.js), the background worker that opens the tabs
// (background.js), and the wiring that puts the script on every page
// (manifest.json, viewer.html, options.*). None of them run outside Chrome, so
// each is driven here against a stubbed environment — a vm context with just
// enough DOM and chrome.* to execute the real files unmodified.

import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.dirname(fileURLToPath(import.meta.url)) + "/";
const read = (rel) => fs.readFileSync(SRC + rel, "utf8");

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

// ---------------------------------------------------------------------------
// A DOM small enough to reason about, real enough to run the script
// ---------------------------------------------------------------------------

const BASE = "https://site.test/page";

const rect = (left, top, width, height) => ({
  left, top, width, height, right: left + width, bottom: top + height,
});

// Supports exactly the selectors the script uses: "a[href]", "a[href]:hover",
// and the comma-separated overlay list ("a.citation-link, a.pdf-link, …").
// ":hover" matches an element the test marked as being under the cursor.
function matchesOne(el, sel) {
  const m = /^([a-z]+)?((?:\.[\w-]+)*)(\[[\w-]+\])?(:hover)?$/i.exec(sel.trim());
  if (!m) throw new Error(`test stub: unsupported selector ${sel}`);
  const [, tag, classes, attr, hover] = m;
  if (hover && !el.hovered) return false;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  const own = String(el.className || "").split(/\s+/);
  for (const c of (classes || "").split(".").filter(Boolean)) {
    if (!own.includes(c)) return false;
  }
  if (attr && el.getAttribute(attr.slice(1, -1)) == null) return false;
  return true;
}
const matches = (el, sel) => sel.split(",").some((s) => matchesOne(el, s));

function walk(el, fn) {
  for (const c of el.children) { fn(c); walk(c, fn); }
}

function makeEl(tag, opts = {}) {
  const el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    className: opts.className || "",
    attrs: opts.attrs || {},
    rects: opts.rects || [],
    children: [],
    parent: null,
    isContentEditable: !!opts.contentEditable,
    hovered: false,
    style: {},
    textContent: "",
    isConnected: true,
    getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; },
    getClientRects() { return this.rects; },
    getBoundingClientRect() { return this.rects[0] || rect(0, 0, 0, 0); },
    closest(sel) {
      let n = this;
      while (n) { if (matches(n, sel)) return n; n = n.parent; }
      return null;
    },
    querySelectorAll(sel) {
      const out = [];
      walk(this, (n) => { if (matches(n, sel)) out.push(n); });
      return out;
    },
    appendChild(child) { child.parent = this; child.isConnected = true; this.children.push(child); return child; },
    remove() {
      this.isConnected = false;
      if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    },
  };
  if (el.tagName === "A") {
    Object.defineProperty(el, "href", {
      get() {
        const raw = this.getAttribute("href");
        if (raw == null) return "";
        try { return new URL(raw, BASE).href; } catch (e) { return raw; }
      },
    });
  }
  for (const c of opts.children || []) el.appendChild(c);
  return el;
}

const link = (href, rects, opts = {}) =>
  makeEl("a", { attrs: { href }, rects, className: opts.className || "" });

// A page: an <article> of ordinary links, plus our own overlay layer painted
// outside it — the arrangement both the viewer and the content script produce.
function makePage() {
  // line 1 (y 100–120)
  const a1 = link("https://a.test/", [rect(10, 100, 100, 20)]);
  const a2 = link("https://b.test/", [rect(200, 100, 100, 20)]);
  const grazed = link("https://grazed.test/", [rect(290, 100, 100, 20)]);
  const outside = link("https://outside.test/", [rect(420, 100, 100, 20)]);
  const jsLink = link("javascript:void(0)", [rect(10, 200, 50, 20)]);
  const fragLink = link("#", [rect(70, 200, 50, 20)]);
  // line 2 (y 130–150): one citation, wrapped, so two strips share a URL
  const strip1 = link("https://cite.test/1", [rect(10, 130, 150, 20)], { className: "cl-citation-link" });
  const strip2 = link("https://cite.test/1", [rect(170, 130, 30, 20)], { className: "cl-citation-link" });

  const article = makeEl("article", { children: [a1, a2, grazed, outside, jsLink, fragLink] });
  const overlay = makeEl("div", { children: [strip1, strip2] });
  const body = makeEl("body", { children: [article, overlay] });
  const html = makeEl("html", { children: [body] });
  return { html, body, article, overlay, a1, a2, grazed, outside, jsLink, fragLink, strip1, strip2 };
}

// Selection over both lines: x 10–310 on line 1, x 10–210 on line 2.
function selectionOverBothLines(page) {
  return {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => ({
      commonAncestorContainer: page.article,
      getClientRects: () => [rect(10, 100, 300, 20), rect(10, 130, 200, 20)],
    }),
  };
}

function load(page, { selection = null, storage = {}, chromeApi = true, sources = [] } = {}) {
  const sent = [];
  const openedWindows = [];
  const doc = {
    baseURI: BASE,
    documentElement: page.html,
    activeElement: null,
    createElement: (tag) => makeEl(tag),
    querySelectorAll: (sel) => page.html.querySelectorAll(sel),
    addEventListener() {},
    elementFromPoint(x, y) {
      let hit = null; // later in tree order = painted on top
      walk(page.html, (n) => {
        for (const r of n.rects) {
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hit = n;
        }
      });
      return hit;
    },
  };
  let storageListener = null;
  const ctx = {
    console, setTimeout, clearTimeout, URL,
    document: doc,
    getSelection: () => selection,
    addEventListener() {},
    open: (url) => openedWindows.push(url),
  };
  if (chromeApi) {
    ctx.chrome = {
      runtime: {
        id: "test",
        lastError: undefined,
        sendMessage: (msg, cb) => { sent.push(msg); cb && cb({ opened: msg.urls.length }); },
      },
      storage: {
        sync: {
          get: (defaults, cb) => cb(Object.fromEntries(
            Object.entries(defaults).map(([k, v]) => [k, k in storage ? storage[k] : v]))),
        },
        onChanged: { addListener: (fn) => { storageListener = fn; } },
      },
    };
  }
  ctx.__shiftSpaceLinkSources = sources;
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("viewer/shift-space-open.js"), ctx);
  // Point at a link the way a real cursor does — through the browser's own
  // :hover state, which is what the script reads.
  const hover = (el) => {
    walk(page.html, (n) => { n.hovered = false; });
    if (el) el.hovered = true;
  };
  return {
    api: ctx.ShiftSpaceOpen,
    sent,
    openedWindows,
    doc,
    hover,
    fireStorage: (changes) => storageListener && storageListener(changes, "sync"),
  };
}

const keyEvent = (over = {}) => {
  const e = {
    shiftKey: true, ctrlKey: false, altKey: false, metaKey: false,
    code: "Space", key: " ", repeat: false, defaultPrevented: false,
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    ...over,
  };
  return e;
};

// ---------------------------------------------------------------------------
// Which links are worth a tab
// ---------------------------------------------------------------------------

console.log("\n--- openable links ---");
{
  const page = makePage();
  const { api } = load(page);
  check("http(s) link", api.isOpenableLink(page.a1), true);
  check("javascript: is not a middle-click target", api.isOpenableLink(page.jsLink), false);
  check("a bare # (the viewer's go-to-page links) is not either",
    api.isOpenableLink(page.fragLink), false);
  check("an in-page fragment is not either",
    api.isOpenableLink(link("#part-2", [rect(0, 0, 10, 10)])), false);
  check("mailto: is not either",
    api.isOpenableLink(link("mailto:a@b.test", [rect(0, 0, 10, 10)])), false);
  check("a local file is", api.isOpenableLink(link("file:///tmp/a.pdf", [rect(0, 0, 10, 10)])), true);
  check("so is the extension's own viewer",
    api.isOpenableLink(link("chrome-extension://abc/viewer/viewer.html", [rect(0, 0, 10, 10)])), true);
  check("an <a> with no href is not a link", api.isOpenableLink(makeEl("a")), false);
  check("a non-anchor is not a link", api.isOpenableLink(page.article), false);
}

console.log("\n--- how much of a link the selection covers ---");
{
  const page = makePage();
  const { api } = load(page);
  const target = link("https://x.test/", [rect(0, 0, 100, 20)]);
  check("fully swept", api.coverage(target, [rect(0, 0, 100, 20)]), 1);
  check("untouched", api.coverage(target, [rect(200, 0, 100, 20)]), 0);
  check("half", api.coverage(target, [rect(0, 0, 50, 20)]), 0.5);
  check("merely abutting its first character", api.coverage(target, [rect(-50, 0, 50, 20)]), 0);
}

// ---------------------------------------------------------------------------
// The selection
// ---------------------------------------------------------------------------

console.log("\n--- every link the selection covers ---");
{
  const page = makePage();
  const { api } = load(page, { selection: selectionOverBothLines(page) });
  const urls = api.urlsOf(api.linksInSelection(selectionOverBothLines(page)));
  check("native links, then the overlay strips, in reading order", urls, [
    "https://a.test/", "https://b.test/", "https://cite.test/1",
  ]);
}
{
  const page = makePage();
  const { api } = load(page, { selection: selectionOverBothLines(page) });
  const hrefs = api.linksInSelection(selectionOverBothLines(page)).map((h) => h.url);
  check("the two strips of one wrapped citation are both found",
    hrefs.filter((h) => h === "https://cite.test/1").length, 2);
  check("...and collapse to one tab", api.urlsOf(api.linksInSelection(selectionOverBothLines(page)))
    .filter((h) => h === "https://cite.test/1").length, 1);
  check("a link the selection only grazes is left alone",
    hrefs.includes("https://grazed.test/"), false);
  check("a link past the selection is left alone",
    hrefs.includes("https://outside.test/"), false);
}
{
  // Two links on one line whose glyph rects differ by a pixel still open
  // left-to-right, not in whatever order the tops happen to sort.
  const right = link("https://right.test/", [rect(200, 101, 100, 20)]);
  const left = link("https://left.test/", [rect(10, 100, 100, 20)]);
  const article = makeEl("article", { children: [right, left] });
  const page = { html: makeEl("html", { children: [makeEl("body", { children: [article] })] }), article };
  const selection = {
    isCollapsed: false, rangeCount: 1,
    getRangeAt: () => ({ commonAncestorContainer: article, getClientRects: () => [rect(0, 95, 400, 30)] }),
  };
  const { api } = load(page, { selection });
  check("a pixel of line jitter doesn't reorder them",
    api.urlsOf(api.linksInSelection(selection)), ["https://left.test/", "https://right.test/"]);
}
{
  const page = makePage();
  const { api } = load(page);
  check("no selection, no links", api.linksInSelection(null), []);
  check("a caret is not a selection",
    api.linksInSelection({ isCollapsed: true, rangeCount: 1, getRangeAt: () => ({}) }), []);
}

// ---------------------------------------------------------------------------
// Pointer vs. selection
// ---------------------------------------------------------------------------

console.log("\n--- what the shortcut acts on ---");
{
  const page = makePage();
  const { api } = load(page);
  api.setPointer(50, 110); // over the first link, nothing selected
  check("the link under the pointer", api.collectUrls(), ["https://a.test/"]);
}
{
  const page = makePage();
  const { api } = load(page);
  api.setPointer(600, 400); // empty space
  check("pointing at nothing opens nothing", api.collectUrls(), []);
}
{
  const page = makePage();
  const { api } = load(page, { selection: selectionOverBothLines(page) });
  api.setPointer(250, 110); // resting on a link INSIDE the selection
  check("a pointer inside the selection means all of it", api.collectUrls(), [
    "https://a.test/", "https://b.test/", "https://cite.test/1",
  ]);
}
{
  const page = makePage();
  const { api } = load(page, { selection: selectionOverBothLines(page) });
  api.setPointer(450, 110); // resting on a link OUTSIDE the selection
  check("a pointer outside it means just that link",
    api.collectUrls(), ["https://outside.test/"]);
}
{
  const page = makePage();
  const { api } = load(page, { selection: selectionOverBothLines(page) });
  api.setPointer(null, null); // pointer left the window
  check("with the pointer gone, the selection still works", api.collectUrls(), [
    "https://a.test/", "https://b.test/", "https://cite.test/1",
  ]);
}

// ---------------------------------------------------------------------------
// The key itself
// ---------------------------------------------------------------------------

console.log("\n--- the cursor, as the browser reports it ---");
{
  // :hover is the browser's own hit-test state — no coordinates to go stale,
  // and it survives an overlay repainting itself under a still cursor.
  const page = makePage();
  const loaded = load(page);
  loaded.hover(page.a1);
  check("the hovered link is the target", loaded.api.collectUrls(), ["https://a.test/"]);
  loaded.hover(page.strip1);
  check("a citation strip counts the same", loaded.api.collectUrls(), ["https://cite.test/1"]);
  loaded.hover(null);
  check("hovering nothing opens nothing", loaded.api.collectUrls(), []);
}
{
  const page = makePage();
  const loaded = load(page);
  loaded.hover(page.jsLink);
  check("a javascript: link under the cursor is still not a target",
    loaded.api.collectUrls(), []);
}

console.log("\n--- links an overlay knows about but hasn't drawn ---");
{
  // The website overlay only paints citations currently scrolled into view. A
  // selection running off the screen has to reach the rest anyway, so their
  // owner reports them with live rects.
  const page = makePage();
  const offScreen = [
    { url: "https://offscreen.test/1", rects: [rect(10, 800, 120, 20)] },
    { url: "https://offscreen.test/2", rects: [rect(10, 2400, 120, 20)] },
    { url: "https://cite.test/1", rects: [rect(10, 130, 150, 20)] }, // already painted
  ];
  const selection = {
    isCollapsed: false, rangeCount: 1,
    getRangeAt: () => ({
      commonAncestorContainer: page.article,
      // one long drag: the visible lines and everything scrolled past
      getClientRects: () => [rect(10, 100, 300, 20), rect(10, 130, 200, 20), rect(0, 700, 400, 2000)],
    }),
  };
  const { api } = load(page, { selection, sources: [() => offScreen] });
  const urls = api.urlsOf(api.linksInSelection(selection));
  check("off-screen links open too, in reading order", urls, [
    "https://a.test/", "https://b.test/", "https://cite.test/1",
    "https://offscreen.test/1", "https://offscreen.test/2",
  ]);
  check("a reported link that was also painted opens once",
    urls.filter((u) => u === "https://cite.test/1").length, 1);
}
{
  const page = makePage();
  const selection = {
    isCollapsed: false, rangeCount: 1,
    getRangeAt: () => ({ commonAncestorContainer: page.article, getClientRects: () => [rect(10, 100, 300, 20)] }),
  };
  const source = () => [{ url: "https://far.test/", rects: [rect(10, 5000, 120, 20)] }];
  const { api } = load(page, { selection, sources: [source] });
  check("a reported link the selection never reaches stays shut",
    api.urlsOf(api.linksInSelection(selection)).includes("https://far.test/"), false);
}
{
  const page = makePage();
  const boom = () => { throw new Error("overlay mid-rebuild"); };
  const { api } = load(page, {
    selection: selectionOverBothLines(page),
    sources: [boom, () => [{ url: "https://ok.test/", rects: [rect(10, 100, 100, 20)] }]],
  });
  check("a source that throws doesn't take the others down with it",
    api.urlsOf(api.linksInSelection(selectionOverBothLines(page))).includes("https://ok.test/"), true);
}
{
  const page = makePage();
  const { api } = load(page, { selection: selectionOverBothLines(page), sources: [] });
  check("no sources registered is the ordinary case",
    api.urlsOf(api.linksInSelection(selectionOverBothLines(page))).length, 3);
}

console.log("\n--- Shift+Space ---");
{
  const page = makePage();
  const { api, sent } = load(page);
  api.setPointer(50, 110);
  const e = keyEvent();
  api.onKeyDown(e);
  check("opens the hovered link", sent, [{ type: "open-background-tabs", urls: ["https://a.test/"] }]);
  check("...and takes the key from the page", [e.prevented, e.stopped], [true, true]);
}
{
  const page = makePage();
  const { api, sent } = load(page);
  api.setPointer(600, 400);
  const e = keyEvent();
  api.onKeyDown(e);
  check("with no link in play, nothing is opened", sent.length, 0);
  check("...and Shift+Space still scrolls the page", e.prevented, false);
}
{
  const page = makePage();
  const { api, sent } = load(page);
  api.setPointer(50, 110);
  for (const [label, over] of [
    ["Space alone", { shiftKey: false }],
    ["Ctrl+Shift+Space", { ctrlKey: true }],
    ["Alt+Shift+Space", { altKey: true }],
    ["Cmd+Shift+Space", { metaKey: true }],
    ["Shift+Enter", { code: "Enter", key: "Enter" }],
    ["a held-down Shift+Space", { repeat: true }],
    ["a key the page already handled", { defaultPrevented: true }],
  ]) {
    const e = keyEvent(over);
    api.onKeyDown(e);
    check(`${label} is not the shortcut`, [sent.length, e.prevented], [0, false]);
  }
}
{
  // Typing in a text box: the key has to keep producing a space. A chat
  // composer holds the focus almost all the time, so the selection path is off
  // there — but a cursor resting on a link is still unambiguous.
  const page = makePage();
  const loaded = load(page, { selection: selectionOverBothLines(page) });
  loaded.doc.activeElement = makeEl("input");
  const e = keyEvent();
  loaded.api.onKeyDown(e);
  check("in a text field, a selection behind it doesn't eat the space",
    [loaded.sent.length, e.prevented], [0, false]);

  loaded.doc.activeElement = makeEl("div", { contentEditable: true });
  const e2 = keyEvent();
  loaded.api.onKeyDown(e2);
  check("...nor in a rich-text composer", [loaded.sent.length, e2.prevented], [0, false]);

  loaded.hover(page.a1);
  const e3 = keyEvent();
  loaded.api.onKeyDown(e3);
  check("...but a link under the cursor still opens (the composer keeps focus)",
    [loaded.sent.length, e3.prevented], [1, true]);
}
{
  const page = makePage();
  const { api, sent } = load(page, { storage: { shiftSpaceOpenLinks: false } });
  api.setPointer(50, 110);
  const e = keyEvent();
  api.onKeyDown(e);
  check("turned off in Options, the key is left alone", [sent.length, e.prevented], [0, false]);
}
{
  const page = makePage();
  const loaded = load(page);
  loaded.api.setPointer(50, 110);
  loaded.fireStorage({ shiftSpaceOpenLinks: { newValue: false } });
  loaded.api.onKeyDown(keyEvent());
  check("unchecking it takes effect without a reload", loaded.sent.length, 0);
  loaded.fireStorage({ shiftSpaceOpenLinks: { newValue: true } });
  loaded.api.onKeyDown(keyEvent());
  check("...and so does re-checking it", loaded.sent.length, 1);
}
{
  // A selection sweeping a page of citations must not fill the tab strip.
  const many = [];
  for (let i = 0; i < 25; i++) {
    many.push(link(`https://cite.test/${i}`, [rect(10, 100 + i * 20, 100, 20)], { className: "citation-link" }));
  }
  const article = makeEl("article");
  const overlay = makeEl("div", { children: many });
  const body = makeEl("body", { children: [article, overlay] });
  const page = { html: makeEl("html", { children: [body] }), article };
  const selection = {
    isCollapsed: false, rangeCount: 1,
    getRangeAt: () => ({ commonAncestorContainer: article, getClientRects: () => [rect(0, 90, 200, 600)] }),
  };
  const { api, sent } = load(page, { selection });
  api.setPointer(null, null);
  check("all 25 are found", api.collectUrls().length, 25);
  api.onKeyDown(keyEvent());
  check("but only 20 tabs open", sent[0].urls.length, api.MAX_TABS);
  check("...starting from the top of the selection", sent[0].urls[0], "https://cite.test/0");
  const toast = page.html.children.find((c) => c.tagName === "DIV" && c.textContent);
  check("...and the count is reported", toast.textContent, "Opened 20 of 25 links in background tabs");
}
{
  // Outside the extension (the PWA build) there is no worker to ask.
  const page = makePage();
  const { api, openedWindows } = load(page, { chromeApi: false });
  api.setPointer(50, 110);
  api.onKeyDown(keyEvent());
  check("with no extension API it falls back to window.open",
    openedWindows, ["https://a.test/"]);
}

// ---------------------------------------------------------------------------
// The worker that opens the tabs
// ---------------------------------------------------------------------------

function runBackground() {
  const created = [];
  const grouped = [];
  let nextId = 500;
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, URL,
    importScripts(rel) { vm.runInContext(read(rel), ctx); },
    chrome: {
      runtime: {
        id: "test", getURL: (p) => "chrome-extension://test/" + p,
        onInstalled: { addListener() {} }, onStartup: { addListener() {} },
        onMessage: { addListener: (fn) => { ctx.__onMessage = fn; } },
      },
      webNavigation: { onBeforeNavigate: { addListener() {} } },
      storage: {
        sync: { get: (d, cb) => cb(d) },
        onChanged: { addListener() {} },
      },
      declarativeNetRequest: { getDynamicRules: async () => [], updateDynamicRules: async () => {} },
      scripting: {
        getRegisteredContentScripts: async () => [],
        unregisterContentScripts: async () => {},
        registerContentScripts: async () => {},
      },
      tabs: {
        create: async (props) => { created.push(props); return { id: nextId++ }; },
        group: async (props) => { grouped.push(props); return 7; },
      },
    },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("background.js"), ctx);
  return { ctx, created, grouped };
}

console.log("\n--- the tabs the worker opens ---");
{
  const { ctx, created } = runBackground();
  const opened = await ctx.openBackgroundTabs(
    ["https://a.test/", "https://b.test/"],
    { id: 42, windowId: 3, index: 5, groupId: -1 }
  );
  check("one tab per link", opened, 2);
  check("unfocused, as a middle click is", created.map((c) => c.active), [false, false]);
  check("stacked just after the tab that asked", created.map((c) => c.index), [6, 7]);
  check("and owned by it", created.map((c) => c.openerTabId), [42, 42]);
  check("in its window", created.map((c) => c.windowId), [3, 3]);
}
{
  const { ctx, created } = runBackground();
  await ctx.openBackgroundTabs(
    ["https://a.test/", "javascript:alert(1)", "mailto:a@b.test", "data:text/html,x",
     "https://a.test/", "file:///tmp/x.pdf", "", null, 7],
    { id: 1, windowId: 1, index: 0, groupId: -1 }
  );
  check("only real navigable URLs, deduplicated",
    created.map((c) => c.url), ["https://a.test/", "file:///tmp/x.pdf"]);
}
{
  const { ctx, created } = runBackground();
  const urls = [];
  for (let i = 0; i < 30; i++) urls.push(`https://x.test/${i}`);
  await ctx.openBackgroundTabs(urls, { id: 1, windowId: 1, index: 0, groupId: -1 });
  check("the worker caps the burst too", created.length, 20);
}
{
  const { ctx, grouped } = runBackground();
  await ctx.openBackgroundTabs(["https://a.test/"], { id: 1, windowId: 1, index: 0, groupId: 9 });
  check("a tab opened from a grouped tab joins its group",
    grouped, [{ groupId: 9, tabIds: 500 }]);
}
{
  const { ctx, grouped } = runBackground();
  await ctx.openBackgroundTabs(["https://a.test/"], { id: 1, windowId: 1, index: 0, groupId: -1 });
  check("an ungrouped opener groups nothing", grouped, []);
}
{
  const { ctx, created } = runBackground();
  const replies = [];
  const handled = ctx.__onMessage(
    { type: "open-background-tabs", urls: ["https://a.test/"] },
    { tab: { id: 1, windowId: 1, index: 0, groupId: -1 } },
    (r) => replies.push(r)
  );
  check("the message is answered asynchronously", handled, true);
  await new Promise((r) => setTimeout(r, 0));
  check("...with the count", replies, [{ opened: 1 }]);
  check("...having opened the tab", created.length, 1);
  check("someone else's message is not ours",
    ctx.__onMessage({ type: "something-else" }, {}, () => {}), undefined);
}

// ---------------------------------------------------------------------------
// Wiring: the shortcut has to reach every page
// ---------------------------------------------------------------------------

console.log("\n--- wiring ---");
{
  const manifest = JSON.parse(read("manifest.json"));
  const entry = manifest.content_scripts.find(
    (cs) => (cs.js || []).includes("viewer/shift-space-open.js"));
  check("injected as a content script", !!entry, true);
  check("on every website", entry.matches, ["http://*/*", "https://*/*"]);
  check("in every frame", entry.all_frames, true);
  check("before the page can bind Space itself", entry.run_at, "document_start");
  check("the PDF viewer loads it too",
    read("viewer/viewer.html").includes('<script src="shift-space-open.js">'), true);
  check("...before viewer.js",
    read("viewer/viewer.html").indexOf("shift-space-open.js") <
      read("viewer/viewer.html").indexOf('src="viewer.js"'), true);
}
{
  const optionsHtml = read("options.html");
  check("Options has the switch", optionsHtml.includes('id="shift-space-open"'), true);
  check("...on by default", /id="shift-space-open"[^>]*checked/.test(optionsHtml), true);
}

console.log("\n" + "=".repeat(60));
console.log(`FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
