// Node-runnable tests for WHERE citation links appear on the web.
// Run: node test-citation-sites.mjs
//
// Three pieces have to agree: the matcher in citation-site-rules.js, the
// content-script registration the background worker builds from it, and the
// Options page that writes the settings. None of them run outside Chrome, so
// each is driven here against a stubbed extension environment — a vm context
// with just enough chrome.* and DOM to execute the real files unmodified.

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
// The matcher
// ---------------------------------------------------------------------------

const rulesCtx = vm.createContext({ console });
rulesCtx.self = rulesCtx;
vm.runInContext(read("citation-site-rules.js"), rulesCtx);
const Rules = rulesCtx.CitationSiteRules;
const DEFAULTS = Rules.DEFAULT_EXCEPTIONS;

console.log("\n--- exceptions: the pre-populated Westlaw / Lexis entries ---");
for (const url of [
  "https://1.next.westlaw.com/Document/I123/View/FullText.html",
  "https://westlaw.com/",
  "https://plus.lexis.com/search?pdsearchterms=x",
  "https://advance.lexis.com/document/",
  "https://www.lexisnexis.com/en-us/home.page",
]) {
  check(`excepted: ${url}`, Rules.isExcepted(url, DEFAULTS), true);
}
check("http counts too — an exception covers both schemes",
  Rules.isExcepted("http://westlaw.com/", DEFAULTS), true);
check("a lookalike domain is not excepted",
  Rules.isExcepted("https://mywestlaw.com.example.org/", DEFAULTS), false);
check("an unrelated site is not excepted",
  Rules.isExcepted("https://claude.ai/chat/1", DEFAULTS), false);

console.log("\n--- exceptions: user-written lines ---");
check("a bare domain covers its subdomains",
  Rules.isExcepted("https://docs.example.com/a", ["*.example.com"]), true);
check("a bare domain covers the domain itself",
  Rules.isExcepted("https://example.com/a", ["*.example.com"]), true);
check("a path prefix is honored",
  Rules.isExcepted("https://example.com/docs/a/b", ["example.com/docs/"]), true);
check("...and not beyond it",
  Rules.isExcepted("https://example.com/other", ["example.com/docs/"]), false);
check("claude.ai can be excepted like anything else",
  Rules.isExcepted("https://claude.ai/chat/1", ["claude.ai"]), true);
check("an empty list excepts nothing",
  Rules.isExcepted("https://westlaw.com/", []), false);

console.log("\n--- opt-in sites default to https, exceptions to either scheme ---");
check("site list", Rules.toMatchPatterns(["example.com", "*.foo.com/a", "", "   "]),
  ["https://example.com/*", "https://*.foo.com/a*"]);
check("exception list", Rules.exceptionPatterns(["example.com"]), ["*://example.com/*"]);

// ---------------------------------------------------------------------------
// The registration background.js builds
// ---------------------------------------------------------------------------

function runBackground(storage) {
  let registered = [];
  const logs = [];
  const ctx = {
    console: { log: (...a) => logs.push(a.join(" ")), warn() {}, error(...a) { logs.push("ERROR " + a.join(" ")); } },
    setTimeout,
    importScripts(rel) { vm.runInContext(read(rel), ctx); },
    chrome: {
      runtime: { id: "test", getURL: (p) => "chrome-extension://test/" + p,
                 onInstalled: { addListener() {} }, onStartup: { addListener() {} },
                 onMessage: { addListener() {} } },
      webNavigation: { onBeforeNavigate: { addListener() {} } },
      storage: {
        sync: { get: (defaults, cb) => cb(Object.fromEntries(
          Object.entries(defaults).map(([k, v]) => [k, k in storage ? storage[k] : v]))) },
        onChanged: { addListener() {} },
      },
      declarativeNetRequest: { getDynamicRules: async () => [], updateDynamicRules: async () => {} },
      scripting: {
        getRegisteredContentScripts: async () => [],
        unregisterContentScripts: async () => {},
        registerContentScripts: async (s) => { registered = s; },
      },
    },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("background.js"), ctx);
  return ctx.syncCitationSites().then(() => ({ script: registered[0] || null, logs }));
}

console.log("\n--- content-script registration ---");
{
  const { script } = await runBackground({ citationAllSites: true });
  check("all sites: matches the whole web", script.matches, ["http://*/*", "https://*/*"]);
  check("all sites: exceptions become excludeMatches", script.excludeMatches,
    ["*://*.westlaw.com/*", "*://*.westlawnext.com/*", "*://*.lexis.com/*", "*://*.lexisnexis.com/*"]);
  check("all sites: top frame only", script.allFrames, false);
}
{
  const { script } = await runBackground({ citationAllSites: true, citationSiteExceptions: [] });
  check("all sites, no exceptions: excludeMatches omitted", "excludeMatches" in script, false);
}
{
  const { script } = await runBackground({ citationSites: ["chatgpt.com", "*.courtlistener.com"] });
  check("listed sites only: those patterns", script.matches,
    ["https://chatgpt.com/*", "https://*.courtlistener.com/*"]);
  check("listed sites still honor the exceptions", script.excludeMatches.length, 4);
  check("listed sites: every frame", script.allFrames, true);
}
{
  const { script, logs } = await runBackground({});
  check("nothing enabled: no dynamic registration", script, null);
  check("...and it says so", logs.some((l) => l.includes("limited to claude.ai")), true);
}

// ---------------------------------------------------------------------------
// The Options page
// ---------------------------------------------------------------------------

const optionsHtml = read("options.html");
const optionIds = [...optionsHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);

function runOptions(store) {
  const els = new Map();
  for (const id of optionIds) {
    els.set(id, {
      id, value: "", checked: false, textContent: "", className: "", style: {},
      _handlers: {},
      addEventListener(ev, fn) { this._handlers[ev] = fn; },
      fire(ev) { this._handlers[ev] && this._handlers[ev](); },
    });
  }
  const writes = [];
  const ctx = {
    console, setTimeout,
    document: {
      getElementById: (id) => els.get(id) || null,
      querySelectorAll: () => [],
      createElement: () => ({ click() {}, style: {} }),
    },
    chrome: {
      storage: {
        sync: {
          get: (defaults, cb) => cb(Object.fromEntries(
            Object.entries(defaults).map(([k, v]) => [k, k in store ? store[k] : v]))),
          set: (obj, cb) => { writes.push(obj); Object.assign(store, obj); cb && cb(); },
        },
        local: { get: (d, cb) => cb(d), set: (o, cb) => cb && cb(), remove: (k, cb) => cb && cb() },
      },
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("citation-site-rules.js"), ctx);
  vm.runInContext(read("options.js"), ctx);
  return { el: (id) => els.get(id), writes, lastWrite: () => writes[writes.length - 1] };
}

console.log("\n--- Options page ---");
{
  const o = runOptions({});
  check("all-sites checkbox starts off", o.el("citation-all-sites").checked, false);
  check("exceptions box pre-populated with Westlaw and Lexis",
    o.el("citation-exceptions").value.split("\n"), DEFAULTS);
  check("per-site list shown while the checkbox is off",
    o.el("citation-sites-block").style.display, "");
}
{
  const o = runOptions({});
  const box = o.el("citation-all-sites");
  box.checked = true;
  box.fire("change");
  check("checking it saves the setting", o.lastWrite(), { citationAllSites: true });
  check("...and hides the now-moot per-site list",
    o.el("citation-sites-block").style.display, "none");
}
{
  const o = runOptions({ citationAllSites: true });
  o.el("citation-exceptions").value = "  westlaw.com \n\n mysite.example \n";
  o.el("citation-exceptions-save").fire("click");
  check("exceptions save trimmed and blank-free",
    o.lastWrite(), { citationSiteExceptions: ["westlaw.com", "mysite.example"] });

  o.el("citation-exceptions").value = "";
  o.el("citation-exceptions-save").fire("click");
  check("an emptied box saves empty", o.lastWrite(), { citationSiteExceptions: [] });

  o.el("citation-exceptions-reset").fire("click");
  check("restore defaults writes the seed list",
    o.lastWrite(), { citationSiteExceptions: DEFAULTS });
  check("...and refills the box", o.el("citation-exceptions").value.split("\n"), DEFAULTS);
}
{
  // The seed comes from the storage default, which applies only when the key is
  // absent — so a list the user deliberately emptied is not re-seeded.
  const o = runOptions({ citationSiteExceptions: [] });
  check("an emptied list stays empty on reopen", o.el("citation-exceptions").value, "");
}
{
  const o = runOptions({});
  o.el("citation-sites").value = "chatgpt.com\n";
  o.el("citation-sites-save").fire("click");
  check("the per-site list still saves", o.lastWrite(), { citationSites: ["chatgpt.com"] });
}

console.log("\n" + "=".repeat(60));
console.log(`FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
