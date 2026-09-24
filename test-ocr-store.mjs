// Node-runnable tests: the decisions behind saved OCR (viewer/ocr-store.js).
// Run: node test-ocr-store.mjs
//
// A scan OCR'd once is saved in IndexedDB so reopening it shows its text
// without recognizing it again. What's pinned here is what that saving
// decides: a document is known by its bytes, a saved page is trusted only
// within the keep window and at the current record version, the words come
// back exactly as they went in, and an edit that moves or turns pages carries
// each page's words to where the page went — or drops them where the page
// turned. The IndexedDB calls around these are thin and fail soft.

import {
  documentKey, makeRecord, wordsFromRecord, isExpired, carriedPages, keepDaysFrom,
  recordId, OCR_RECORD_VERSION, DEFAULT_KEEP_DAYS,
} from "./viewer/ocr-store.js";

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

const DAY = 24 * 60 * 60 * 1000;

console.log("A document is known by its bytes");
{
  const a = new TextEncoder().encode("%PDF-1.7 scan one");
  const b = new TextEncoder().encode("%PDF-1.7 scan two");
  const ka = await documentKey(a);
  check("same bytes, same key", await documentKey(a.slice()), ka);
  check("ArrayBuffer and Uint8Array agree", await documentKey(a.buffer.slice(0)), ka);
  check("different bytes, different key", (await documentKey(b)) !== ka, true);
  check("hex SHA-256", /^[0-9a-f]{64}$/.test(ka), true);
  check("one record per page of a document", recordId(ka, 3), `${ka}|3`);
}

console.log("Words round-trip through a record");
{
  const words = [
    { text: "Smith", x0: 72, y0: 90.5, x1: 110, y1: 102, eol: false, par: 0 },
    { text: "v.", x0: 112, y0: 90.5, x1: 120, y1: 102, eol: false, par: 0 },
    { text: "Jones", x0: 122, y0: 90.5, x1: 160, y1: 102, eol: true, par: 0 },
    { text: "(2001)", x0: 72, y0: 120, x1: 110, y1: 132, eol: true, par: 1 },
  ];
  const now = 1_000 * DAY;
  const rec = makeRecord("k", 2, words, now);
  check("record stamps page, doc, version, use", [rec.doc, rec.page, rec.v, rec.usedAt], ["k", 2, OCR_RECORD_VERSION, now]);
  check("words come back as they went in", wordsFromRecord(rec, now, 30), words);
  check("survives structured cloning", wordsFromRecord(structuredClone(rec), now, 30), words);
  check("an empty page is still a saved page", wordsFromRecord(makeRecord("k", 1, [], now), now, 30), []);
}

console.log("A saved page is trusted only inside the keep window");
{
  const now = 1_000 * DAY;
  const rec = (usedAt) => makeRecord("k", 1, [{ text: "x", x0: 0, y0: 0, x1: 1, y1: 1, eol: true, par: 0 }], usedAt);
  check("used yesterday, kept 30 days", isExpired(rec(now - DAY), now, 30), false);
  check("used 29 days ago", isExpired(rec(now - 29 * DAY), now, 30), false);
  check("used exactly 30 days ago", isExpired(rec(now - 30 * DAY), now, 30), true);
  check("used 31 days ago", isExpired(rec(now - 31 * DAY), now, 30), true);
  check("keeping off expires everything", isExpired(rec(now), now, 0), true);
  check("expired record yields nothing", wordsFromRecord(rec(now - 31 * DAY), now, 30), null);
  const old = { ...rec(now), v: OCR_RECORD_VERSION - 1 };
  check("another version's record yields nothing", wordsFromRecord(old, now, 30), null);
  check("missing record yields nothing", wordsFromRecord(undefined, now, 30), null);
}

console.log("Keep days from the Options value");
{
  check("default", keepDaysFrom(undefined), DEFAULT_KEEP_DAYS);
  check("garbage → default", keepDaysFrom("abc"), DEFAULT_KEEP_DAYS);
  check("0 stays 0", keepDaysFrom(0), 0);
  check("negative → 0", keepDaysFrom(-5), 0);
  check("capped at a year", keepDaysFrom(9999), 365);
  check("string number", keepDaysFrom("14"), 14);
}

console.log("An edit carries each page's words to where the page went");
{
  const at = (m) => Object.fromEntries(m);
  check("identity plan keeps every page",
    at(carriedPages([{ srcIndex: 0, rotate: 0 }, { srcIndex: 1, rotate: 0 }])), { 1: 1, 2: 2 });
  check("reordered pages follow their page",
    at(carriedPages([{ srcIndex: 2, rotate: 0 }, { srcIndex: 0, rotate: 0 }, { srcIndex: 1, rotate: 0 }])),
    { 1: 3, 2: 1, 3: 2 });
  check("a deleted page leaves nothing behind",
    at(carriedPages([{ srcIndex: 0, rotate: 0 }, { srcIndex: 2, rotate: 0 }])), { 1: 1, 2: 3 });
  check("a turned page is recognized again",
    at(carriedPages([{ srcIndex: 0, rotate: 90 }, { srcIndex: 1, rotate: -90 }, { srcIndex: 2, rotate: 180 }])),
    { 1: null, 2: null, 3: null });
  check("a full turn is no turn",
    at(carriedPages([{ srcIndex: 0, rotate: 360 }, { srcIndex: 1, rotate: -360 }])), { 1: 1, 2: 2 });
  check("missing rotate means upright",
    at(carriedPages([{ srcIndex: 1 }])), { 1: 2 });
}

if (fails) {
  console.log(`\n${fails} failure(s)`);
  process.exit(1);
}
console.log("\nAll passed.");
