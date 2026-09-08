// pseudo-key.js
//
// The pseudonym key: reading pseudonym_key.xlsx and swapping fakes for real
// values (and back). PDF-Linker scrubs a case's filings and writes the key —
// the real↔fake map — and the text exports carry only the fakes. This module
// is what lets the text reader show the real names ON TOP of that text
// without ever writing them into it.
//
// A port of the decisions in src/pseudo.js of the Claude usage-meter
// extension, which translates claude.ai's pages with the same file. Same
// rules, in the same words where they matter:
//
//   parseKey        key workbook rows → the map. Columns are found by HEADER
//                   NAME, never position (the DeAnonymize.bas rule); an
//                   operator keep in the Replacement cell ("no", "never",
//                   "[bracketed]", "{braced}") is an instruction, not a
//                   pseudonym, and is dropped; an "alt spelling" row is
//                   forward-only (its fake belongs to the canonical row); a
//                   fake claimed by two canonical reals is ambiguous and is
//                   RETIRED from reversal rather than guessed at; and the
//                   reversible bindings come off the APPLIED sheet only, never
//                   the "Pinned (never in text)" tab — a pinned row can bind a
//                   real the applied sheet binds under a different fake, and
//                   reading both retires the live one.
//   compile / translate / translateRuns   fake → real for DISPLAY. Longest
//                   fake first, whole words only, case-insensitive, and the
//                   real is written in the case the fake was written in.
//   compileForward / forwardRuns   real → fake, the direction a SAVE needs:
//                   a real name typed into the reader is written to disk as
//                   its pseudonym, never as itself.
//   compileReals / findReals   which real values stand in a text.
//
// Pure: no DOM. Tested by test-pseudo-key.mjs.

const KEY_FILE_RE = /^pseudonym[ _-]?key.*\.xlsx$/i;

export function isKeyFileName(name) {
  if (!name) return false;
  const base = String(name).split(/[\\/]/).pop();
  return KEY_FILE_RE.test(base.trim());
}

export function fold(s) {
  return String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();
}

function trim(s) {
  return String(s == null ? "" : s).trim();
}

// Header row: the fingerprint is the headers every key layout shares —
// DeAnonymize scans for "real value"/"replacement" by name, and so do we.
export function headerIndex(rows) {
  const lim = Math.min(rows ? rows.length : 0, 8);
  for (let i = 0; i < lim; i++) {
    const cells = (rows[i] || []).map(fold);
    if (cells.indexOf("real value") !== -1 && cells.indexOf("replacement") !== -1) return i;
  }
  return -1;
}

export function sheetsLookLikeKey(sheets) {
  for (const s of sheets || []) if (headerIndex(s && s.rows) !== -1) return true;
  return false;
}

const KEY_SHEET_NAME = "pseudonym key";
const PINNED_SHEET_NAME = "pinned (never in text)";

export function isPinnedSheet(sheet) {
  return fold(sheet && sheet.name) === PINNED_SHEET_NAME;
}

/**
 * The ONE sheet whose rows were APPLIED to the exports, or null: the tab
 * titled "Pseudonym Key" wherever it sits, else the FIRST header-bearing tab
 * that is not the pinned one. One sheet, not "every sheet that isn't the
 * pinned one" — a second tab under any other name would otherwise be read as
 * applied, collide with the live rows, and retire them.
 */
export function appliedSheet(sheets) {
  const withHeader = (sheets || []).filter((s) => headerIndex((s && s.rows) || []) !== -1);
  for (const s of withHeader) if (fold(s && s.name) === KEY_SHEET_NAME) return s;
  for (const s of withHeader) if (!isPinnedSheet(s)) return s;
  return null;
}

// An operator KEEP typed into the Replacement cell — "no"/"never" (leave the
// Real Value verbatim), "[bracketed]"/"{braced}" keep-specs. Not a pseudonym.
export function isKeepCell(v) {
  const f = fold(v);
  if (f === "no" || f === "never") return true;
  const t = trim(v);
  return (
    (t.length > 1 && t[0] === "[" && t[t.length - 1] === "]") ||
    (t.length > 1 && t[0] === "{" && t[t.length - 1] === "}")
  );
}

const ALT_STATUS = "alt spelling"; // forward-only: fake belongs to the canonical row

// A POSSESSIVE is the party's own name, not a second party. Both marks,
// because the spreadsheet exports the straight one and Word the typographic.
const POSS_TAIL_RE = /['’]s$/i;
const POSS_MATCH_RE = /['’][sS]$/;

/**
 * Key workbook → the map. `sheets` is what parseXlsx returns.
 *
 * Returns { name, sheet, rows, pairs, warn, hint, dropped }:
 *   pairs — [{fake, real}] for display reversal, unambiguous APPLIED owners
 *   warn  — [{real, fake, pinned}] every real value the key binds, with the
 *           stand-in to write instead. A real bound on BOTH tabs keeps the
 *           APPLIED fake, whatever order the sheets came in.
 */
export function parseKey(sheets, name) {
  const entries = [];
  let keeps = 0;
  const applied = appliedSheet(sheets);
  for (const sheet of sheets || []) {
    const rows = (sheet && sheet.rows) || [];
    const hi = headerIndex(rows);
    if (hi === -1) continue;
    const pinned = sheet !== applied;
    const heads = (rows[hi] || []).map(fold);
    const realCol = heads.indexOf("real value");
    const fakeCol = heads.indexOf("replacement");
    const statusCol = heads.indexOf("status");
    const occCol = heads.indexOf("occurrences");
    for (let i = hi + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const real = trim(row[realCol]);
      const fake = trim(row[fakeCol]);
      if (!real || !fake) continue;
      if (isKeepCell(fake)) {
        keeps++;
        continue;
      }
      const occ = occCol !== -1 ? parseInt(row[occCol], 10) : 0;
      entries.push({
        real,
        fake,
        alt: statusCol !== -1 && fold(row[statusCol]) === ALT_STATUS,
        occ: isFinite(occ) && occ > 0 ? occ : 0,
        pinned,
      });
    }
  }

  // A row bound in the POSSESSIVE binds the bare name too: "Zachary's ->
  // John's" means Zachary IS John, so a derived base row is added unless the
  // key already carries one.
  const haveReal = new Set(entries.map((e) => fold(e.real)));
  const derived = [];
  for (const e of entries) {
    if (!POSS_TAIL_RE.test(e.real)) continue;
    const baseReal = e.real.replace(POSS_TAIL_RE, "");
    const baseFake = e.fake.replace(POSS_TAIL_RE, "");
    if (!baseReal || !baseFake || haveReal.has(fold(baseReal))) continue;
    haveReal.add(fold(baseReal));
    derived.push({ real: baseReal, fake: baseFake, alt: e.alt, occ: 0, pinned: e.pinned });
  }
  for (const d of derived) entries.push(d);

  // Reversal: exactly one row may own each fake. Pinned rows are out of this
  // direction entirely. Alt-spelling rows never own. What is left is the
  // macro's own guard: two CANONICAL rows claiming one fake, and the mapping
  // is retired rather than restored to a coin flip.
  const byFake = new Map();
  for (const e of entries) {
    if (e.pinned) continue;
    const k = fold(e.fake);
    if (!byFake.has(k)) byFake.set(k, []);
    byFake.get(k).push(e);
  }
  const pairs = [];
  let ambiguous = 0;
  for (const group of byFake.values()) {
    const owners = group.filter((e) => !e.alt);
    // A group that is ALL synthetic promotes one row, exactly as write_key
    // does — a fake with no owner at all would reverse to nothing.
    const own = owners.length ? owners : [group[0]];
    // Ambiguous only when the REALS actually differ (the macro's own test):
    // "GARDELLA" from the caption and "Gardella" from the body are one name
    // and restore identically, since the swap recases from the matched text.
    if (new Set(own.map((e) => fold(e.real))).size > 1) {
      ambiguous++;
      continue;
    }
    const e = own[0];
    if (fold(e.fake) === fold(e.real)) continue; // never map a value onto itself
    pairs.push({ fake: e.fake, real: e.real });
  }

  // The warning / forward list: every real value the key binds, alt
  // spellings and pinned rows included. A real bound on both tabs takes the
  // APPLIED row's fake.
  const warn = [];
  const seenReal = new Map();
  for (const e of entries) {
    const k = fold(e.real);
    const at = seenReal.get(k);
    if (at === undefined) {
      seenReal.set(k, warn.length);
      warn.push({ real: e.real, fake: e.fake, pinned: !!e.pinned });
      continue;
    }
    if (warn[at].pinned && !e.pinned) {
      warn[at].fake = e.fake;
      warn[at].pinned = false;
    }
  }

  // Which CASE this key belongs to, in one value: the real name the exports
  // used most, off the APPLIED rows only.
  let hint = "";
  let hintOcc = -1;
  for (const e of entries) {
    if (!e.pinned && !e.alt && !isCommonReal(e.real) && e.occ > hintOcc) {
      hint = e.real;
      hintOcc = e.occ;
    }
  }

  return {
    name: name || "",
    sheet: (applied && trim(applied.name)) || "",
    rows: entries.length,
    pairs,
    warn,
    hint,
    dropped: {
      keeps,
      ambiguous,
      pinned: entries.filter((e) => e.pinned).length,
    },
  };
}

/** What a key is CALLED: the case folder it came out of, else its hint. */
export function keyTitle(key) {
  const k = key || {};
  const folder = trim(k.folder);
  if (folder) return folder;
  const hint = trim(k.hint);
  const name = trim(k.name);
  if (hint && name) return hint + " — " + name;
  return hint || name || "pseudonym key";
}

function pairSet(key) {
  return ((key && key.pairs) || []).map((p) => fold(p.real) + ">" + fold(p.fake));
}

/** A short content signature over the reversal pairs (FNV-1a, order-free). */
export function keySignature(key) {
  const pairs = pairSet(key).sort();
  let h = 2166136261;
  for (const s of pairs) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 10;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/**
 * Are these the SAME CASE's key — one perhaps refreshed by a re-run that added
 * rows? A re-run only ever grows a key, so the older key's pairs survive into
 * the newer one nearly whole; two different cases share at most incidental
 * bindings.
 */
export function sameCaseKey(a, b) {
  const A = new Set(pairSet(a));
  const B = pairSet(b);
  if (!A.size || !B.length) return false;
  let shared = 0;
  for (const s of B) if (A.has(s)) shared++;
  return shared >= Math.max(3, Math.ceil(Math.min(A.size, B.length) * 0.6));
}

// ---- matching ---------------------------------------------------------------

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// One alternation, longest value first (the engine tries alternatives in
// order, so the full name beats its own surname token). A literal space in the
// value matches any whitespace run, so a name wrapped over a line still
// matches. Boundaries are alphanumeric lookarounds rather than \b, because a
// fake can end in a digit ("Deverell5") or hold an @ ("quenby3@postbox9.org").
export function buildMatcher(values) {
  const sorted = values
    .filter((v) => v)
    .slice()
    .sort((a, b) => b.length - a.length);
  if (!sorted.length) return null;
  const alts = sorted
    .map((v) => escapeRe(v).replace(/ /g, "\\s+") + (POSS_TAIL_RE.test(v) ? "" : "(?:['’][sS])?"))
    .join("|");
  return new RegExp("(?<![A-Za-z0-9_])(?:" + alts + ")(?![A-Za-z0-9_])", "gi");
}

/**
 * The shape a name is written in: upper / lower / title / mixed / none.
 * `mixed` — deliberate case inside it ("McDonald", "LLC") — is a shape no
 * transform can be derived from, so text of that shape is left as written.
 */
export function caseShape(s) {
  const t = String(s == null ? "" : s);
  if (!/[A-Za-z]/.test(t)) return "none";
  if (t === t.toUpperCase()) return "upper";
  if (t === t.toLowerCase()) return "lower";
  const words = t.match(/[A-Za-z]+/g) || [];
  return words.every((w) => /^[A-Z][a-z]*$/.test(w)) ? "title" : "mixed";
}

const KEEP_UPPER = new Set(
  (
    "usa esq dba aka fka hoa ada eeoc inc " +
    "irs dmv fbi cia epa doj dhs faa atf dea sec fda fcc ftc osha ssa nlrb ibm aol"
  ).split(" ")
);

function looksAbbrev(word) {
  const letters = word.replace(/[^A-Za-z]/g, "");
  if (!letters) return false;
  if (letters.length <= 2) return true;
  if (KEEP_UPPER.has(letters.toLowerCase())) return true;
  return letters.length <= 4 && !/[AEIOUY]/i.test(letters);
}

const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

function titleWord(w, deliberate) {
  const up = w === w.toUpperCase();
  const low = w === w.toLowerCase();
  if (!up && !low) return w;
  if (up && (deliberate || looksAbbrev(w))) return w;
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

/** Write `value` in `shape`. */
export function applyCase(shape, value) {
  const v = String(value == null ? "" : value);
  if (shape === "upper") return v.toUpperCase();
  if (shape === "lower") return v.toLowerCase();
  if (shape === "title") {
    const deliberate = v !== v.toUpperCase();
    return v.replace(WORD_RE, (w) => titleWord(w, deliberate));
  }
  return v;
}

/** The replacement in the matched text's own voice. */
export function mirrorCase(sample, value) {
  return applyCase(caseShape(sample), value);
}

function casedSuffix(shape, suffix) {
  if (!suffix) return "";
  if (shape === "upper") return suffix.toUpperCase();
  if (shape === "lower") return suffix.toLowerCase();
  return suffix;
}

// Ordinary English a key row can end up binding (a harvested token, a one-word
// business short form) but that a person types in NORMAL USE. A real value
// that IS one of these words, standing alone, is left out of the forward
// direction: rewriting "and" on save would wreck the sentence.
const COMMON_WORDS = new Set(
  (
    "a an the and or but nor so if then than as at by for from in into of on onto to with " +
    "without under over is are was were be been being am do does did done has have had " +
    "having will would can could shall should may might must not no yes it its he she they " +
    "them his her their this that these those there here who whom whose which what when " +
    "where why how all any each every some most more less few both other another same such " +
    "only also very just about above below between during before after again further once " +
    "per via etc et al mr mrs ms dr jr sr no. vs v"
  ).split(/\s+/)
);

export function isCommonReal(value) {
  const f = fold(value);
  return f.length < 2 || (COMMON_WORDS.has(f) && f.indexOf(" ") === -1);
}

/** Reversal matcher: fake → real. */
export function compile(key) {
  const pairs = (key && key.pairs) || [];
  const map = new Map(pairs.map((p) => [fold(p.fake), p.real]));
  const rx = buildMatcher(pairs.map((p) => p.fake));
  return { rx, map };
}

/**
 * FORWARD matcher: real → fake, the ReAnonymize direction. Built from the
 * same rows the warning watches (alt spellings included — real→fake is exactly
 * what they are for; keeps and common words excluded), longest real first.
 */
export function compileForward(key) {
  const warn = ((key && key.warn) || []).filter((w) => !isCommonReal(w.real));
  const map = new Map();
  for (const w of warn) if (!map.has(fold(w.real))) map.set(fold(w.real), w.fake);
  const rx = buildMatcher(warn.map((w) => w.real));
  return { rx, map };
}

/** Warning matcher over the REAL values — common English left out. */
export function compileReals(key) {
  const warn = ((key && key.warn) || []).filter((w) => !isCommonReal(w.real));
  const map = new Map();
  for (const w of warn) if (!map.has(fold(w.real))) map.set(fold(w.real), w);
  const rx = buildMatcher(warn.map((w) => w.real));
  return { rx, map };
}

// Look a match up in a compiled map, a possessive of a bare value included.
function lookup(compiled, m) {
  let mapped = compiled.map.get(fold(m));
  let suffix = "";
  if (mapped == null) {
    const mp = m.match(POSS_MATCH_RE);
    if (mp) {
      mapped = compiled.map.get(fold(m.slice(0, -mp[0].length)));
      if (mapped != null) suffix = mp[0];
    }
  }
  return mapped == null ? null : { mapped, suffix };
}

/**
 * Text → runs, the swap made but kept apart from the text around it:
 *   { t: "text", s }                          untouched text
 *   { t: "swap", from, to }                   `from` as it stood in the text,
 *                                             `to` written in its case
 * A single pass — replaced text is never re-scanned. The reader renders a
 * `swap` as a marked span and writes `from` back to disk, which is how the
 * real names live on top of the file and never in it.
 */
function runsWith(compiled, text) {
  const out = [];
  if (!text) return out;
  if (!compiled || !compiled.rx) return [{ t: "text", s: text }];
  const rx = compiled.rx;
  rx.lastIndex = 0;
  let at = 0;
  let m;
  while ((m = rx.exec(text))) {
    const hit = lookup(compiled, m[0]);
    if (!hit) {
      if (m.index === rx.lastIndex) rx.lastIndex++;
      continue;
    }
    if (m.index > at) out.push({ t: "text", s: text.slice(at, m.index) });
    const core = hit.suffix ? m[0].slice(0, -hit.suffix.length) : m[0];
    const shape = caseShape(core);
    out.push({ t: "swap", from: m[0], to: applyCase(shape, hit.mapped) + casedSuffix(shape, hit.suffix) });
    at = m.index + m[0].length;
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  if (at < text.length) out.push({ t: "text", s: text.slice(at) });
  return out;
}

/** fake → real, as runs. The reader's display. */
export function translateRuns(compiled, text) {
  return runsWith(compiled, text);
}

/** real → fake, as runs. What a save writes. */
export function forwardRuns(compiledForward, text) {
  return runsWith(compiledForward, text);
}

/** Display translation as one string. Returns { text, count }. */
export function translate(compiled, text) {
  const runs = runsWith(compiled, text);
  let count = 0;
  let out = "";
  for (const r of runs) {
    if (r.t === "swap") {
      count++;
      out += r.to;
    } else out += r.s;
  }
  return { text: out, count };
}

/**
 * Which real values stand in `text` — distinct, in first-seen order, each
 * with the fake to write instead. Longest-first matching means a full name
 * standing whole reports once, not once more per surname token.
 */
export function findReals(compiledReals, text) {
  if (!compiledReals || !compiledReals.rx || !text) return [];
  const seen = new Set();
  const out = [];
  const rx = compiledReals.rx;
  rx.lastIndex = 0;
  let m;
  while ((m = rx.exec(text))) {
    const hit = lookup(compiledReals, m[0]);
    const w = hit && hit.mapped;
    if (w && !seen.has(fold(w.real))) {
      seen.add(fold(w.real));
      out.push(w);
    }
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return out;
}
