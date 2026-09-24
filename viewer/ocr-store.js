// Saved OCR: recognized pages kept between visits, so a scan you've OCR'd
// once opens with its text already there instead of being recognized again.
//
// A document is known by a SHA-256 of its bytes — not its URL, which for a
// court portal is often a one-time link, and not its name. The same file
// opened from the web, from disk, or under another name finds the same pages;
// a file that has changed is a different document and is recognized afresh.
//
// Each recognized page is one IndexedDB record holding its word boxes in PDF
// user space (what ocr.js caches in memory), stamped with when it was last
// used. Records unused for longer than the Options page's "Keep OCR results
// for N days" are swept when a document opens; 0 keeps nothing.
//
// The decisions — the record's shape, what has expired, which pages survive an
// edit — are pure functions below (test-ocr-store.mjs); the IndexedDB calls
// are thin and fail soft: any error just means the page is recognized again.

export const OCR_DB_NAME = "ocrCache";
const STORE = "pages";

// Bump when recognition changes in a way that makes saved boxes wrong or worse
// (the render scale, the engine, the language data). Older records are ignored
// and age out.
export const OCR_RECORD_VERSION = 1;

export const DEFAULT_KEEP_DAYS = 30;
export const MAX_KEEP_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export function keepDaysFrom(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_KEEP_DAYS;
  return Math.min(MAX_KEEP_DAYS, Math.max(0, n));
}

// Hex SHA-256 of the document's bytes (ArrayBuffer or typed array).
export async function documentKey(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function recordId(docKey, pageNumber) {
  return `${docKey}|${pageNumber}`;
}

// Words go in as compact rows — [text, x0, y0, x1, y1, eol, par] — since a
// dense page runs to several hundred of them.
export function makeRecord(docKey, pageNumber, words, now) {
  return {
    id: recordId(docKey, pageNumber),
    doc: docKey,
    page: pageNumber,
    v: OCR_RECORD_VERSION,
    usedAt: now,
    rows: words.map((w) => [w.text, w.x0, w.y0, w.x1, w.y1, w.eol ? 1 : 0, w.par]),
  };
}

// The words a record holds, or null when it can't be trusted: another
// version's output, or older than the keep window (a sweep may not have run).
export function wordsFromRecord(record, now, keepDays) {
  if (!record || record.v !== OCR_RECORD_VERSION || !Array.isArray(record.rows)) return null;
  if (isExpired(record, now, keepDays)) return null;
  return record.rows.map(([text, x0, y0, x1, y1, eol, par]) => ({
    text, x0, y0, x1, y1, eol: !!eol, par,
  }));
}

export function isExpired(record, now, keepDays) {
  return !(keepDays > 0) || !(record.usedAt > now - keepDays * DAY_MS);
}

// Which recognized pages still hold after the document is rewritten by a page
// plan ([{ srcIndex, rotate }] per output page, as pdf-edit.js's applyPagePlan
// takes it). Returns, per new page number, the old page number whose words
// carry over, or null where the page must be recognized again. A page turned
// by the plan is dropped: its boxes were measured on the page as it was
// stored, and the rewritten file stores it at a new angle.
export function carriedPages(plan) {
  const out = new Map();
  plan.forEach((p, i) => {
    const turned = ((Number(p.rotate) || 0) % 360 + 360) % 360 !== 0;
    out.set(i + 1, turned ? null : p.srcIndex + 1);
  });
  return out;
}

// ── IndexedDB ───────────────────────────────────────────────────────────────

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no IndexedDB"));
    const req = indexedDB.open(OCR_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("doc", "doc");
      store.createIndex("usedAt", "usedAt");
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another page (Options' "Forget saved OCR") wants the database gone:
      // step aside so the delete isn't blocked, and reopen on next use.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// The saved words for one page (touching its last-used stamp), or null.
export async function loadPage(docKey, pageNumber, keepDays, now = Date.now()) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    let words = null;
    const req = store.get(recordId(docKey, pageNumber));
    req.onsuccess = () => {
      const rec = req.result;
      words = wordsFromRecord(rec, now, keepDays);
      if (words) store.put({ ...rec, usedAt: now });
    };
    await done(tx);
    return words;
  } catch { return null; }
}

// Save many pages at once: [[pageNumber, words], ...].
export async function savePages(docKey, pages, now = Date.now()) {
  if (!pages.length) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const [pageNumber, words] of pages) store.put(makeRecord(docKey, pageNumber, words, now));
    await done(tx);
  } catch { /* not saved; recognized again next time */ }
}

// Does this document have any saved pages?
export async function hasDocument(docKey) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    let n = 0;
    const req = tx.objectStore(STORE).index("doc").count(docKey);
    req.onsuccess = () => { n = req.result; };
    await done(tx);
    return n > 0;
  } catch { return false; }
}

// Delete every record not used within the keep window (all of them at 0 days).
export async function sweep(keepDays, now = Date.now()) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const range = keepDays > 0 ? IDBKeyRange.upperBound(now - keepDays * DAY_MS) : null;
    const req = tx.objectStore(STORE).index("usedAt").openCursor(range);
    req.onsuccess = () => {
      const c = req.result;
      if (c) { c.delete(); c.continue(); }
    };
    await done(tx);
  } catch { /* try again next open */ }
}
