// Court forms read against their own BLANKS: PDF-Linker's `Form Templates`.
//
// The owner, in chat: "Use the forms in pdf-linker form templates in PDF+ such
// that it knows the correct font size and spacing for those forms." Beside its
// PDF a form page is drawn the way the PDF prints it — each piece at its item's
// x, at its own size and in its own face (text-reader.js, planCells; columns.js,
// placeLine). That needs the PDF to SAY its type, and a scan does not: its text
// is an OCR layer over a picture, set in Tesseract's GlyphLessFont, which names
// no face (pdfsync.pdfFace answers null), and in sizes the recogniser rounded to
// whole points line by line (a 6-point label beside a 9-point value reads 8). So
// a scanned form was drawn in the reader's own type, uncut and unplaced.
//
// A Judicial Council form has a predetermined layout: the same labels at the
// same places, in the same type, on every copy ever filed. PDF-Linker keeps the
// blank official forms in `Form Templates/` and reads a scan against them
// (pdf_linker.py, `_template_recognise`); this is the same recognition, asked of
// the page the reader is laying out, and what it hands back is the BLANK'S TYPE:
//
//   - the blank's own text items (pdf.js's, as the reader reads a born-digital
//     page), carried onto the scan by the fit, in place of the OCR's words that
//     stand on them — each label at the size and in the face the form prints it,
//     and its rows the form's rows, so the line spacing is the form's too;
//   - the OCR's other words (a typed value, a stamp, a note) kept as read, and a
//     value standing in one of the blank's text FIELDS given the size and face the
//     field sets its value in (its /DA), where the field names one.
//
// Recognition is asked three ways, as PDF-Linker asks it, and all must answer:
// the page states the form's id (footer, or header; folded for the slips a scan
// makes of one, `formKey`), a revision the footer prints does not plainly differ,
// and the blank's label words FIT the scan's — a scale-and-offset per axis on
// words reading exactly alike and unique on both sides (`fitWords`) — with a
// share of them found at their mapped places (`matchShare`). The share is asked
// of the TEMPLATE's words, so a page of typed values cannot vote a form in. A
// page after a recognised page of the same form is tried as that form's next
// page at a lower share, seeded with the page before's fit (`recognise`'s `seq`).
//
// The data is `viewer/form-templates/`, made from PDF-Linker's committed blanks
// by `build-form-templates.mjs` (repo root): `index.json` (form key → files) and
// one JSON per blank. A blank added to PDF-Linker's folder is in PDF+ once that
// is run again. Pure: no DOM, no pdf.js — the reader hands in its items and a
// way to fetch the data; tested in test-form-templates.mjs.

// ---- form ids --------------------------------------------------------------

// The loose shape of a form id as a scan reads it — a digit read for a letter in
// the prefix ("P0S"), a letter for a digit in the number ("O40") — and a Los
// Angeles local form's id ("LASC CIV 109", "SCLAC CIV 109", "LACIV 109").
// pdf_linker.py, `_TEMPLATE_LOOSE_ID_RE`.
export const LOOSE_ID_RE = new RegExp(
  String.raw`(?<![\w-])(?:[A-Z0-9]{2,4}(?:-[A-Z0-9]{1,3})?-[0-9OIlS]{3}(?:EX)?` +
  String.raw`(?:\([A-Z0-9]{1,2}\))?(?:-INFO)?` +
  String.raw`|(?:[S5]C[L1I|]AC[ \t]+|[L1I|]A[S5]C[ \t]+|[L1I|]A[ \t]?)C[I1l|]V` +
  String.raw`[ \t]*[0-9OIlS]{3})(?![\w-])`,
  "gi");
// The strict shape a born-digital blank prints (pdf_linker.py, `_JC_FORM_NO_RE`).
export const FORM_ID_RE = /(?<![\w-])([A-Z]{2,4}(?:-[A-Z]{1,3})?-\d{3}(?:EX)?(?:\([A-Z0-9]{1,2}\))?(?:-INFO)?|(?:(?:SCLAC|LASC)[ \t]+CIV|LACIV)[ \t]*\d{3})(?![\w-])/gi;
// "Instead of Form MC-350": a footer names another form in prose.
const MENTION_RE = /\bforms?\s*$/i;
const LASC_PREFIX_RE = /^(?:sciacciv|iascciv|iaciv)(?=\d)/;

/**
 * The form id folded for comparison: case-insensitive, the confusable pairs
 * folded by POSITION — in a run mostly letters a digit is read as its letter, in
 * a run mostly digits a letter as its digit — the EX suffix a run of its own,
 * and every spelling of a Los Angeles local prefix one. "P0S-O40(P)" and
 * "POS-040(P)" are both "pos040p". pdf_linker.py, `_template_form_key`.
 */
export function formKey(id) {
  const s = String(id || "").toLowerCase();
  const runs = [];
  for (const run of s.match(/[a-z0-9]+/g) || []) {
    const m = /^(.+)(ex)$/.exec(run);
    if (m) runs.push(m[1], m[2]); else runs.push(run);
  }
  const out = runs.map((run) => {
    const letters = [...run].filter((c) => /[a-z]/.test(c)).length;
    return letters >= run.length - letters
      ? run.replace(/0/g, "o").replace(/1/g, "i").replace(/5/g, "s").replace(/l/g, "i")
      : run.replace(/o/g, "0").replace(/i/g, "1").replace(/l/g, "1").replace(/s/g, "5");
  });
  return out.join("").replace(LASC_PREFIX_RE, "iascciv");
}

/** True where the id at [a, b) of `text` stands inside a URL or a path. */
function inUrl(text, a, b) {
  while (a > 0 && !/\s/.test(text[a - 1])) a--;
  while (b < text.length && !/\s/.test(text[b])) b++;
  return text.slice(a, b).includes("/");
}

/**
 * The form id a footer band's `text` prints as its OWN, strictly (the blank's
 * own id; a candidate introduced by "form" is prose naming another and yields
 * to any other), or "". pdf_linker.py, `_footer_own_form_no`.
 */
export function footerFormId(text) {
  const s = String(text || "");
  let first = "";
  for (const m of s.matchAll(FORM_ID_RE)) {
    if (inUrl(s, m.index, m.index + m[1].length)) continue;
    first = first || m[1];
    if (!MENTION_RE.test(s.slice(0, m.index))) return m[1];
  }
  return first;
}

/**
 * Every form key a page states, most trusted first: the footer's own id, the
 * header's (alone on its line in the top right), then the loose shapes of both.
 * `footer` is the footer band's text, `header` the header band's right-half
 * lines. pdf_linker.py, `_form_page_ids`.
 */
export function pageFormKeys(footer, header = []) {
  const keys = [];
  const add = (id) => { const k = id ? formKey(id) : ""; if (k && !keys.includes(k)) keys.push(k); };
  add(footerFormId(footer));
  for (const line of header) {
    const m = new RegExp(FORM_ID_RE.source, "i").exec(line);
    if (m && m.index === 0 && m[1].length === line.length) { add(m[1]); break; }
  }
  const s = String(footer || "");
  let loose = "";
  for (const m of s.matchAll(LOOSE_ID_RE)) {
    if (inUrl(s, m.index, m.index + m[0].length)) continue;
    loose = loose || m[0];
    if (!MENTION_RE.test(s.slice(0, m.index))) { loose = m[0]; break; }
  }
  add(loose);
  for (const line of header) {
    const m = new RegExp(LOOSE_ID_RE.source, "i").exec(line);
    if (m && m.index === 0 && m[0].length === line.length) { add(m[0]); break; }
  }
  return keys;
}

/**
 * True when a page's key names a template's form: the same key, or the same with
 * ONE letter of its letter run misread as another letter ("MG-050" for MC-050);
 * the digits must agree. pdf_linker.py, `_template_key_near`.
 */
export function keyNear(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length !== b.length || a.length < 5) return false;
  const diff = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push([a[i], b[i]]);
  return diff.length === 1 && /[a-z]/.test(diff[0][0]) && /[a-z]/.test(diff[0][1]) && (b.match(/\d/g) || []).length >= 3;
}

const REV_RE = /(?:Rev(?:ised|\.)?|New)\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}\/\d{2,4})(?![\d/])/i;
/** The revision a footer prints, folded ("Rev. January 1, 2007" → "january12007"), or "". */
export function revisionOf(text) {
  // pdf.js reads a Los Angeles local form's "Rev. 04/26" as "Rev. 0 4 /2 6":
  // its digits and slash closed up before the date is read.
  const s = String(text || "").replace(/(\d) (?=\d ?\/)/g, "$1").replace(/(\d) ?\/ ?(?=\d)/g, "$1/").replace(/\/(\d) (?=\d(?!\d))/g, "/$1");
  const m = REV_RE.exec(s);
  return m ? m[1].toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

/** Optimal-string-alignment distance (an adjacent swap is one edit). */
export function osa(a, b) {
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d = Array.from({ length: n + 1 }, (_, i) => { const r = new Array(m + 1).fill(0); r[0] = i; return r; });
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[n][m];
}

// ---- words and the fit -------------------------------------------------------

const EDGES = /^[.,;:()[\]{}'"]+|[.,;:()[\]{}'"]+$/g;
/** A label word's comparison form: case-folded, the specks at its ends trimmed. */
export function wordKey(text) {
  return String(text || "").trim().replace(EDGES, "").toLowerCase();
}

/**
 * The words of a page's items, each boxed by its share of its item's width:
 * [{ key, text, box: [x0, y0, x1, y1], item, from, to }] in the top-down frame the
 * reader's items are in (`top` the item's top, `h` its height). An OCR layer sets
 * a word to an item, where the share is the word's own box.
 */
export function itemWords(items) {
  const out = [];
  (items || []).forEach((it, ii) => {
    const str = String(it.str || "");
    if (!str.trim()) return;
    const w = it.w > 0 ? it.w : 0, n = Math.max(1, str.length);
    for (const m of str.matchAll(/\S+/g)) {
      const key = wordKey(m[0]);
      if (!key) continue;
      const x0 = it.x + (w * m.index) / n, x1 = it.x + (w * (m.index + m[0].length)) / n;
      out.push({ key, text: m[0], box: [x0, it.top, x1, it.top + (it.h > 0 ? it.h : 0)], item: ii, from: m.index, to: m.index + m[0].length });
    }
  });
  return out;
}

export const MIN_SHARE = 0.6;      // of the template's label words matched
export const SEQ_MIN_SHARE = 0.4;  // a page expected after a recognised one
export const MIN_MATCHED = 8;      // and at least this many, whatever the share
export const MIN_ANCHORS = 4;      // exact, unique word pairs a fit needs
const ANCHOR_LEN = 4;              // letters an anchor word must carry
const MAX_SLIP = 0.34;             // edits allowed per letter of a label word
const FIT_TOL = 6;                 // pt: residual an anchor may leave the fit
const SCALE_RANGE = [0.85, 1.15];

const centre = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

/**
 * The least-squares fit { sx, sy, tx, ty } carrying the template's coordinates
 * onto the scan's over [template box, scan box] `pairs`, re-taken once without
 * any pair past FIT_TOL; null where too few pairs, a scale outside SCALE_RANGE
 * or a fit they still disagree with. pdf_linker.py, `_template_solve_pairs`.
 */
export function solvePairs(pairs) {
  const solve = (prs) => {
    if (prs.length < MIN_ANCHORS) return null;
    const fit = [];
    for (const axis of [0, 1]) {
      const tv = prs.map(([a]) => centre(a)[axis]), sv = prs.map(([, b]) => centre(b)[axis]);
      const tm = tv.reduce((s, v) => s + v, 0) / tv.length, sm = sv.reduce((s, v) => s + v, 0) / sv.length;
      let varT = 0, cov = 0;
      tv.forEach((t, i) => { varT += (t - tm) ** 2; cov += (t - tm) * (sv[i] - sm); });
      if (varT < 1e-6) return null;
      const scale = cov / varT;
      if (!(scale >= SCALE_RANGE[0] && scale <= SCALE_RANGE[1])) return null;
      fit.push([scale, sm - scale * tm]);
    }
    return { sx: fit[0][0], sy: fit[1][0], tx: fit[0][1], ty: fit[1][1] };
  };
  const residuals = (f, prs) => prs.map(([a, b]) => {
    const [ax, ay] = centre(a), [bx, by] = centre(b);
    return Math.max(Math.abs(f.sx * ax + f.tx - bx), Math.abs(f.sy * ay + f.ty - by));
  });
  let fit = solve(pairs);
  if (!fit) return null;
  const res = residuals(fit, pairs);
  if (Math.max(...res) > FIT_TOL) {
    const kept = pairs.filter((_, i) => res[i] <= FIT_TOL);
    fit = solve(kept);
    if (!fit || Math.max(...residuals(fit, kept)) > FIT_TOL) return null;
  }
  return fit;
}

/** The fit over words reading exactly alike and unique on both sides. */
export function fitWords(tWords, sWords) {
  const uniq = (words) => {
    const seen = new Map(), out = new Map();
    for (const w of words) {
      if (w.key.replace(/[^a-z]/g, "").length < ANCHOR_LEN) continue;
      seen.set(w.key, (seen.get(w.key) || 0) + 1);
      out.set(w.key, w);
    }
    for (const [k, n] of seen) if (n !== 1) out.delete(k);
    return out;
  };
  const tu = uniq(tWords), su = uniq(sWords);
  const pairs = [];
  for (const [k, w] of tu) if (su.has(k)) pairs.push([w.box, su.get(k).box]);
  return solvePairs(pairs);
}

const FOLDS = [["rn", "m"], ["vv", "w"], ["0", "o"], ["1", "l"], ["|", "l"], ["5", "s"], ["8", "b"], ["!", "i"]];
const fold = (k) => FOLDS.reduce((s, [a, b]) => s.split(a).join(b), k);
/**
 * True when scan word `a` reads as label word `b` with at most the slips a scan
 * makes: an edit per three letters, one at least, the confusable pairs folded
 * first ("whorn" is one slip from "whom"). pdf_linker.py, `_template_word_slip`.
 */
export function wordSlip(a, b) {
  if (a === b) return true;
  a = fold(a); b = fold(b);
  if (a === b) return true;
  const allow = Math.max(1, Math.floor(MAX_SLIP * Math.max(a.length, b.length)));
  if (Math.abs(a.length - b.length) > allow) return false;
  return osa(a, b) <= allow;
}

/** A box carried through a fit. */
export function mapBox(b, f) {
  return [f.sx * b[0] + f.tx, f.sy * b[1] + f.ty, f.sx * b[2] + f.tx, f.sy * b[3] + f.ty];
}
// Scan words banded down the page, so a label asks only its own neighbourhood.
const BAND = 8;
function banded(words) {
  const bands = new Map();
  for (const w of words) {
    const k = Math.floor(centre(w.box)[1] / BAND);
    if (!bands.has(k)) bands.set(k, []);
    bands.get(k).push(w);
  }
  return bands;
}
/**
 * The scan word standing ON a mapped template box: overlapping half the
 * narrower of the two across, its centre within the box's height (a point
 * either side, and a quarter of the box — an OCR sets a line's words in one
 * size, so a small label beside a large value sits a point off its box), and
 * reading within the slip rule where `slip` is asked. The widest overlap wins.
 */
function standingOn(bands, B, key, slip = true) {
  const cy = (B[1] + B[3]) / 2, pad = 1 + 0.25 * (B[3] - B[1]);
  let best = null, bestOv = 0;
  for (let k = Math.floor(cy / BAND) - 1; k <= Math.floor(cy / BAND) + 1; k++) {
    for (const w of bands.get(k) || []) {
      const wcy = (w.box[1] + w.box[3]) / 2;
      if (wcy < B[1] - pad || wcy > B[3] + pad) continue;
      const ov = Math.min(B[2], w.box[2]) - Math.max(B[0], w.box[0]);
      if (ov <= 0 || ov < 0.5 * Math.min(w.box[2] - w.box[0], B[2] - B[0])) continue;
      if (ov > bestOv && (!slip || wordSlip(w.key, key))) { best = w; bestOv = ov; }
    }
  }
  return best;
}

/**
 * How much of the template's labels the scan carries at their mapped places:
 * { matched, share, pairs } — the template's label words of two characters or
 * more with a scan word standing on them reading the same or within the slip
 * rule, and those [template box, scan box] pairs (a seeded fit is refined on
 * them). pdf_linker.py, `_template_match`.
 */
export function matchShare(tWords, fit, sWords) {
  const bands = banded(sWords);
  let matched = 0, asked = 0;
  const pairs = [];
  for (const t of tWords) {
    if (t.key.replace(/[^a-z0-9]/g, "").length < 2) continue;
    asked++;
    const hit = standingOn(bands, mapBox(t.box, fit), t.key);
    if (hit) { matched++; pairs.push([t.box, hit.box]); }
  }
  return { matched, share: asked ? matched / asked : 0, pairs };
}

// ---- the library -------------------------------------------------------------

/**
 * The template library over `fetchJson(name)` (a promise of the parsed JSON of
 * a file in viewer/form-templates/): `index.json` once, each blank's file the
 * first time a page names its form. A file that will not load is a form the
 * library does not hold, and is not asked for again.
 */
export function templateLibrary(fetchJson) {
  let index = null;
  const files = new Map();
  const loadIndex = () => (index = index || Promise.resolve().then(() => fetchJson("index.json")).catch(() => null));
  const loadFile = (name) => {
    if (!files.has(name)) files.set(name, Promise.resolve().then(() => fetchJson(name)).then((f) => prepareFile(f, name)).catch(() => null));
    return files.get(name);
  };
  return {
    /** The template pages whose form key is one of `keys`, or one letter off it. */
    async pagesFor(keys) {
      const idx = await loadIndex();
      if (!idx || !keys.length) return [];
      const names = new Set();
      for (const k of keys) for (const name of (idx.keys && idx.keys[k]) || []) names.add(name);
      if (!names.size) for (const [tk, list] of Object.entries(idx.keys || {})) if (keys.some((k) => keyNear(k, tk))) for (const name of list) names.add(name);
      const out = [];
      for (const name of names) {
        const f = await loadFile(name);
        if (f) for (const p of f.pages) if (p.keys.some((tk) => keys.some((k) => keyNear(k, tk)))) out.push(p);
      }
      return out;
    },
    /** A file's page n (1-based), or null. */
    async page(name, n) {
      const f = await loadFile(name);
      return (f && f.pages.find((p) => p.n === n)) || null;
    },
  };
}

/**
 * A blank's file made ready to ask: each page's items as the reader's
 * ({ str, x, top, w, h, face }), its text fields, and its LABEL words — the
 * words of its items standing outside every widget (a field is where a value
 * stands; pdf_linker.py, `_template_page_words`) — kept on the page.
 */
export function prepareFile(f, name) {
  if (!f || !Array.isArray(f.pages)) return null;
  const pages = f.pages.map((p) => {
    const items = (p.items || []).map(([str, x, top, w, h, face, inField]) => ({ str, x, top, w, h, face, inField: !!inField }));
    const fields = (p.fields || []).map(([x0, y0, x1, y1, size, face]) => ({ box: [x0, y0, x1, y1], size, face }));
    const boxes = p.boxes || [];
    const words = itemWords(items).filter((w) => !items[w.item].inField);
    return { file: name, source: f.source, n: p.n, form: p.form, keys: p.keys || [], rev: p.rev || "", width: p.w, height: p.h, items, fields, boxes, words, faces: f.faces || [] };
  });
  return { source: f.source, faces: f.faces || [], pages };
}

/**
 * The template page and fit a scanned page is recognised as, or null:
 * { tpl, fit, share }. `items` are the page's text items (the reader's, top-down,
 * in PDF units); `size` the page's { w, h }. `seq`, where given, is what the page
 * before it in the same PDF was recognised as ({ tpl, fit }): where the page's
 * own id finds nothing, it is tried as that form's next page, at SEQ_MIN_SHARE
 * and seeded with that page's fit — unless the page names another form outright.
 */
export async function recognise(library, items, size, { seq = null } = {}) {
  const H = size && size.h > 0 ? size.h : 792, W = size && size.w > 0 ? size.w : 612;
  const { footer, header } = idBands(items, W, H);
  const keys = pageFormKeys(footer, header);
  const rev = revisionOf(footer);
  const sWords = itemWords(items);
  let best = null;
  const tryPage = (tpl, minShare, seed) => {
    if (rev && tpl.rev && osa(rev, tpl.rev) > 2) return;
    const fits = [fitWords(tpl.words, sWords)];
    if (seed) fits.push(solvePairs(matchShare(tpl.words, seed, sWords).pairs) || seed);
    for (const fit of fits) {
      if (!fit) continue;
      const { matched, share } = matchShare(tpl.words, fit, sWords);
      if (share >= minShare && matched >= MIN_MATCHED && (!best || share > best.share)) best = { tpl, fit, share };
    }
  };
  if (keys.length) for (const tpl of await library.pagesFor(keys)) tryPage(tpl, MIN_SHARE, null);
  if (!best && seq && seq.tpl && (!keys.length || keys.some((k) => seq.tpl.keys.some((tk) => keyNear(k, tk))))) {
    const next = await library.page(seq.tpl.file, seq.tpl.n + 1);
    if (next) tryPage(next, SEQ_MIN_SHARE, seq.fit);
  }
  return best;
}

// What a form prints its id in: the foot of the page (its last 18%) and the
// header (its first 10%), the header's lines in the right half only. The
// footer's lines are read from the BOTTOM up: the form's own id is on its last
// lines, and a paragraph of instructions reaching into the band can name
// another ("such as form POS-020, POS-030, or POS-040", on PLD-050).
const FOOT_BAND = 0.18, HEAD_BAND = 0.10;
/** The footer band's text (bottom line first) and the header band's right-half lines, from items. */
export function idBands(items, W, H) {
  const lines = (sel) => {
    const its = (items || []).filter((it) => it.str && it.str.trim() && sel(it)).sort((a, b) => (a.top + a.h) - (b.top + b.h) || a.x - b.x);
    const rows = [];
    for (const it of its) {
      const base = it.top + it.h, last = rows[rows.length - 1];
      if (last && Math.abs(base - last.base) <= Math.max(2, 0.5 * Math.min(it.h || 6, last.h || 6))) last.items.push(it);
      else rows.push({ base, h: it.h, items: [it] });
    }
    return rows.map((r) => {
      const its2 = r.items.sort((a, b) => a.x - b.x);
      return { text: its2.map((i) => i.str.trim()).join(" "), x0: its2[0].x, x1: Math.max(...its2.map((i) => i.x + (i.w || 0))) };
    });
  };
  const footer = lines((it) => it.top + it.h / 2 >= H * (1 - FOOT_BAND)).map((l) => l.text).reverse().join("\n");
  const header = lines((it) => it.top + it.h / 2 <= H * HEAD_BAND)
    .filter((l) => (l.x0 + l.x1) / 2 >= W / 2)
    .map((l) => l.text.replace(/^[\s|.,:;'"`_~]+|[\s|.,:;'"`_~]+$/g, ""));
  return { footer, header };
}

// ---- the blank's type over the scan ------------------------------------------

/**
 * The page's items with the blank's type in them: every item the blank prints,
 * carried onto the scan by `fit` ({ str, x, top, w, h, font }, `font` the face id
 * `faceId(n)` names for the file's face n), and the scan's own words that stand
 * on none of them — a typed value, a stamp, a handwritten note — kept as read, in
 * runs of the item they came from. A scan word standing on a printed word of the
 * blank is that word's ink and gives way to it, unless it stands in one of the
 * blank's text fields and does not read as the word there (a value typed over a
 * word the field prints). A kept run whose middle stands in a text field that
 * names its type (/DA, a size above 0) takes that size and face, on its own
 * baseline. Only the OCR's words are asked (`isOcr(item)`): text the page sets
 * in a face of its own over the scan — a court's e-filing stamp — is the
 * page's own type and passes through as it is.
 */
export function formItems(tpl, fit, items, faceId, { isOcr = () => true } = {}) {
  const out = [];
  const fieldBoxes = tpl.fields.map((f) => ({ box: mapBox(f.box, fit), size: f.size, face: f.face }));
  const inField = (b) => {
    const [cx, cy] = centre(b);
    return fieldBoxes.find((f) => cx >= f.box[0] && cx <= f.box[2] && cy >= f.box[1] && cy <= f.box[3]) || null;
  };
  for (const it of tpl.items) {
    if (!String(it.str).trim()) continue;
    const [x0, y0, x1, y1] = mapBox([it.x, it.top, it.x + it.w, it.top + it.h], fit);
    out.push({ str: it.str, x: x0, top: y0, w: x1 - x0, h: y1 - y0, font: it.face == null ? null : faceId(it.face) });
  }
  // The blank's printed RUNS (every one, a field's too: "FOR COURT USE ONLY" is
  // ink wherever it stands), mapped, each with its words' keys, banded for the
  // scan's words to ask. Asked of the run and not of each word's share of it: a
  // word's share of a long run of Arial lands a few points off its ink, and a
  // short word ("be", "a") then stood on nothing and was kept twice over.
  const printed = tpl.items.filter((it) => String(it.str).trim()).map((it) => ({
    box: mapBox([it.x, it.top, it.x + it.w, it.top + it.h], fit),
    keys: (String(it.str).match(/\S+/g) || []).map(wordKey).filter(Boolean),
    field: !!it.inField,
  }));
  const pBands = banded(printed);
  // The blank's checkboxes, mapped, a point and a half wider each side: the
  // scan's reading of a drawn box ("[__]", "LJ") or of its mark is the box, and
  // the export carries the box's state already.
  const boxes = (tpl.boxes || []).map((b) => mapBox(b, fit));
  const inBox = (b) => {
    const [cx, cy] = centre(b);
    return boxes.some((r) => cx >= r[0] - 1.5 && cx <= r[2] + 1.5 && cy >= r[1] - 1.5 && cy <= r[3] + 1.5);
  };
  const onPrinted = (w) => {
    if (inBox(w.box)) return true;
    const cy = centre(w.box)[1], ww = w.box[2] - w.box[0];
    for (let k = Math.floor(cy / BAND) - 2; k <= Math.floor(cy / BAND) + 2; k++) {
      for (const p of pBands.get(k) || []) {
        const B = p.box, pad = 1 + 0.25 * (B[3] - B[1]);
        if (cy < B[1] - pad || cy > B[3] + pad) continue;
        const ov = Math.min(B[2], w.box[2]) - Math.max(B[0], w.box[0]);
        if (ov <= 0 || ov < 0.5 * Math.min(ww, B[2] - B[0])) continue;
        if (p.keys.some((k2) => wordSlip(w.key, k2)) || (!p.field && !inField(w.box))) return true;
      }
    }
    return false;
  };
  const own = items.filter((it) => !isOcr(it));
  const ocr = items.filter(isOcr);
  const sWords = itemWords(ocr);
  const keep = sWords.map((w) => !onPrinted(w));
  // Kept words back into runs of the item each came from.
  let run = null;
  const flush = () => {
    if (!run) return;
    const src = ocr[run.item];
    const str = String(src.str).slice(run.from, run.to);
    const box = [run.x0, src.top, run.x1, src.top + (src.h > 0 ? src.h : 0)];
    const field = inField(box);
    const item = { str, x: run.x0, top: src.top, w: run.x1 - run.x0, h: src.h, font: src.font || null };
    if (field && field.size > 0) {
      const base = src.top + (src.h > 0 ? src.h : 0), h = field.size * fit.sy;
      Object.assign(item, { top: base - h, h, font: field.face == null ? item.font : faceId(field.face) });
    }
    out.push(item);
    run = null;
  };
  sWords.forEach((w, i) => {
    if (!keep[i]) { flush(); return; }
    if (run && run.item === w.item) { run.to = w.to; run.x1 = w.box[2]; return; }
    flush();
    run = { item: w.item, from: w.from, to: w.to, x0: w.box[0], x1: w.box[2] };
  });
  flush();
  // Items carrying no word (a lone mark) the scan read are kept as they are,
  // but for a checkbox's.
  ocr.forEach((it) => {
    if (it.str && it.str.trim() && !wordKey(it.str) && !inBox([it.x, it.top, it.x + (it.w || 0), it.top + (it.h || 0)])) out.push({ ...it });
  });
  for (const it of own) out.push({ ...it });
  return out;
}
