// Node-runnable tests: the Table of Authorities' "Open all" button.
// Run: node test-toa-open-all.mjs
//
// The panel lists a whole table's worth of authorities, and a reader working
// through it opens the cases one at a time. The button opens them in one go —
// the CASES only. A statute or a rule is read in place, and nobody wants ten
// code sections in ten tabs alongside the cases they came to read.
//
// Inside the extension the tabs are opened by the background worker (only it
// can open a tab that doesn't steal focus), which is also what caps how many
// one gesture may open — so the button reports back what actually opened.
//
// toa.js is browser code: it reads `document`, `window` and `chrome` when the
// panel is built, so the fakes below are installed before the module loads.

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

// ── A DOM, in as much as the panel touches one ──────────────────────────────

function makeEl(tag) {
  const el = {
    tagName: tag, className: "", id: "", type: "", title: "", href: "",
    rel: "", target: "", hidden: false, disabled: false,
    style: {}, dataset: {}, children: [], isConnected: true,
    _text: "",
    _handlers: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    addEventListener(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); },
    append(...kids) { for (const k of kids) this.children.push(k); },
    appendChild(k) { this.children.push(k); return k; },
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ width: 420, height: 460, top: 80, right: 1268, bottom: 540, left: 848 }),
    querySelector(sel) {
      const want = sel.replace(/^\./, "");
      for (const k of this.descendants()) if (k.className === want) return k;
      return null;
    },
    descendants() {
      const out = [];
      for (const k of this.children) { out.push(k, ...k.descendants()); }
      return out;
    },
    fire(ev, e) {
      for (const fn of this._handlers[ev] || []) {
        fn(e || { preventDefault() {}, stopPropagation() {} });
      }
    },
  };
  Object.defineProperty(el, "textContent", {
    get() { return this._text; },
    set(v) { this._text = String(v); this.children.length = 0; },
  });
  return el;
}

const root = makeEl("html");
globalThis.document = {
  documentElement: root,
  head: makeEl("head"),
  getElementById: () => null,
  createElement: (tag) => makeEl(tag),
};
globalThis.window = {
  innerWidth: 1280, innerHeight: 720,
  addEventListener() {},
  open() { throw new Error("the extension path must not fall back to window.open"); },
};

let sent = null;          // the last message the panel sent the worker
let respond = (urls) => ({ opened: urls.length });
globalThis.chrome = {
  runtime: {
    id: "test",
    lastError: null,
    sendMessage(msg, cb) { sent = msg; cb(respond(msg.urls)); },
  },
  storage: { local: { get: (defaults, cb) => cb(defaults), set() {} } },
};

const { createToaPanel } = await import("./viewer/toa.js");

const panel = createToaPanel({ providerLabel: () => "Lexis+" });
const el = () => root.children.find((c) => c.id === "__cl_toa");
const button = () => el().querySelector(".cl-toa-open-all");

const CASES = [
  { key: "Doe v. Roe (2007) 42 Cal.4th 531", kind: "case", url: "https://x/doe" },
  { key: "Guz v. Bechtel National, Inc. (2000) 24 Cal.4th 317", kind: "case", url: "https://x/guz" },
  { key: "Lazar v. Superior Court (1996) 12 Cal.4th 631", kind: "case", url: "https://x/lazar" },
];
const OTHERS = [
  { key: "CCP § 425.16", kind: "statute", url: "https://x/ccp425" },
  { key: "Cal. Rules of Court, rule 3.1300", kind: "rule", url: "https://x/rule3.1300" },
  { key: "26 C.F.R. § 1.125", kind: "regulation", url: "https://x/cfr" },
  { key: "CACI No. 3710", kind: "caci", url: "https://x/caci" },
];

console.log("\n--- the button counts the cases, and only the cases ---");
panel.render([...CASES, ...OTHERS], "lexis");
check("the label says how many will open", button().textContent, "Open 3 cases");
check("...and the panel's own count still counts everything",
  el().querySelector(".cl-toa-count").textContent, "7");

console.log("\n--- clicking opens the cases in tabs ---");
button().fire("click");
check("the worker is asked to open the case URLs, in listed order", sent,
  { type: "open-background-tabs", urls: ["https://x/doe", "https://x/guz", "https://x/lazar"] });
check("the button reports back", button().textContent, "Opened 3");

console.log("\n--- a table with no cases has nothing to open ---");
panel.render(OTHERS, "lexis");
check("the button is hidden", button().hidden, true);
check("...and clicking it sends nothing", (sent = null, button().fire("click"), sent), null);

console.log("\n--- one case reads as one ---");
panel.render([CASES[0], ...OTHERS], "lexis");
check("singular", button().textContent, "Open 1 case");

console.log("\n--- the worker's cap is reported, not hidden ---");
respond = () => ({ opened: 2 });
panel.render([...CASES, ...OTHERS], "lexis");
button().fire("click");
check("short of what was asked", button().textContent, "Opened 2 of 3");
respond = () => ({ opened: 0 });
button().fire("click");
check("nothing opened at all", button().textContent, "Couldn't open");

console.log("\n--- a repeated render doesn't paint over the result ---");
respond = (urls) => ({ opened: urls.length });
panel.render([...CASES, ...OTHERS], "lexis");
button().fire("click");
panel.render([...CASES, ...OTHERS], "lexis");   // the same set, scanned again
check("the report survives the re-render", button().textContent, "Opened 3");

console.log("\n" + "=".repeat(60));
console.log(`FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
