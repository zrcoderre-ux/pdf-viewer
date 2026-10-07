// redact.js
//
// Redaction: what a redacted copy of a PDF hides, and how the copy is made.
//
// THE RULE UNDER ALL OF IT. A redaction you can undo is not a redaction. Black
// rectangles drawn over a page leave the words underneath them in the file,
// where anything that can select text can read them straight back out — which
// is how redacted filings have been un-redacted for as long as there have been
// redacted filings. So a redacted copy here is not this document with boxes on
// it. It is a NEW document, every page rendered to an image with the boxes
// painted into the pixels, carrying no text layer, no annotations, no form
// fields, no embedded fonts and no metadata. There is nothing left to read
// back, and nothing that says where the file came from.
//
// AND NEVER THE ORIGINAL. The save writes a copy — under the pseudonymized
// name where a key is in hand — and the document the viewer has open is not
// touched. The Save button that writes highlights into a file is a different
// button; this one has no in-place path at all.
//
// WHAT GETS REDACTED. Two sources, which is the whole feature:
//
//   THE KEY IS THE BASELINE. pseudonym_key.xlsx binds every real value in a
//     matter to the fake PDF-Linker wrote in its place. Run forward over a
//     page's own text (pseudo-key.findRealSpans), it says where every real
//     value STANDS on that page, and each of those places becomes a proposed
//     box. That is the same list the exports were scrubbed by, applied to the
//     PDF nobody scrubbed.
//   THE HAND ADDS THE REST. A drag over text proposes the text it covers; an
//     area drag proposes the box itself, for a signature, a photograph, an
//     exhibit stamp, a scanned page with no text layer to name anything in —
//     everything the key cannot reach.
//
// AND NOTHING IS HIDDEN UNTIL IT IS SAVED. A proposal is drawn as a
// translucent red box with the words still legible under it, so what is about
// to go can be read first and taken back off one box at a time. The boxes turn
// black only in the file the save writes. The document on screen never changes.
//
// GEOMETRY. A box is stored in PDF POINTS, not in screen pixels: the zoom
// changes, the page is re-rendered from scratch, the rotate tool turns the
// page, and the box has to stay on the words it was drawn over through all of
// it. Points are the one frame that survives, and the page's own viewport maps
// them back to pixels for the painting and forward to pixels again, at
// whatever resolution the save renders at, for the black.
//
// The decisions here are pure and tested from Node (test-redact.mjs); the
// store and the painting are the DOM around them.

// ── the page's text, and the way back to it ──────────────────────────────────

/**
 * How two neighbouring text-layer spans are joined, read off where they sit:
 *
 *   "\n"  the second starts a new line
 *   " "   a gap on the same line wide enough to be a space
 *   ""    one word cut in two — a font change or a kern mid-word
 *
 * PDF.js lays a page out as a span per text run, and a run ends wherever the
 * PDF's own operators end it: usually at a line or a font change, sometimes in
 * the middle of a word. Joining every span with a space would make "Hel"+"en"
 * into "Hel en"; joining them all bare would make "Helen"+"Rasho" into
 * "HelenRasho". Neither is a name the key can find, so the page itself decides
 * — and a newline rather than a space between lines because the key's matcher
 * reads a line break (and the pleading gutter number after it) as the gap
 * inside a wrapped name.
 *
 * Each span is { text, left, top, width, height } in any one consistent unit.
 */
export function spanGap(a, b) {
  if (!a || !b) return "";
  const at = String(a.text == null ? "" : a.text);
  const bt = String(b.text == null ? "" : b.text);
  if (!at || !bt) return "";
  // Along the first span's own line, where both say how they are turned
  // (spanFrame, below): exactly the reading underneath at no turn at all.
  const fa = spanFrame(a), fb = fa && spanFrame(b);
  if (fa && fb) {
    const h = fa.h > 0 ? fa.h : (fb.h > 0 ? fb.h : 1);
    const dx = fb.x - fa.x, dy = fb.y - fa.y;
    if (-dx * fa.sin + dy * fa.cos > h * 0.5) return "\n";
    if (/\s$/.test(at) || /^\s/.test(bt)) return "";
    return dx * fa.cos + dy * fa.sin - fa.w > h * 0.2 ? " " : "";
  }
  const h = a.height > 0 ? a.height : (b.height > 0 ? b.height : 1);
  // A new line: the next span has dropped by more than half a line.
  if ((b.top - a.top) > h * 0.5) return "\n";
  // Whitespace already written on either side of the join is the gap.
  if (/\s$/.test(at) || /^\s/.test(bt)) return "";
  const gap = b.left - (a.left + a.width);
  return gap > h * 0.2 ? " " : "";
}

// A SPAN READ ALONG ITS OWN LINE. The join above reads where spans sit on
// screen, and a span set at a slant does not sit where its line does: its box
// on screen (getBoundingClientRect, which is what `left`/`top`/`width`/
// `height` are) is the upright box round the turned one, its top the top of
// its highest corner. A slant of under a degree was taken as upright
// (UPRIGHT_SLACK_DEG, below), measured on full-width lines, whose boxes grow
// tall with their width and so raised the half-a-line a drop is measured
// against. A name in a short span of its own far to the right — a service
// list's right-hand column on a landscape page, at 11 pt on 14 — keeps a
// short box, and by the end of the line its top has sunk x·tan(θ), so the
// next row's first span, at the left margin, had dropped less than half a
// line below it: "Nadia QuillfeatherDated this day…", an "Odile" cover over
// "Nadia" and the surname readable in the PNG under "the names in their
// pseudonyms" from 0.85° to 0.99° (measured on 6303b39, as the review did on
// c45bde3).
//
// So where a span says how it is turned on screen (`turn`, degrees clockwise:
// the layer's turn and its own, as the screenshot's sidewaysOn reads them),
// the box it was turned from is worked back out of the upright box round it —
// for a box w by h turned through θ about its top-left corner, the box round
// it is w·cos θ + h·|sin θ| wide and w·|sin θ| + h·cos θ tall, and that
// top-left corner is the turned box's highest point (θ ≥ 0) or its leftmost
// (θ < 0) — and the next span's drop and gap are measured from that corner,
// across the line and along it. At θ = 0 that is the reading above to the letter; up to
// SPAN_FRAME_MAX_DEG it reads a slant's lines as lines. Past it (a page turned
// a quarter, a stamp up the margin) the box cannot be worked back reliably
// and the screen reading stands, as before — the screenshot leaves such a
// sheet out anyway (sidewaysSpans). A span with no `turn` (the redaction
// sweep's, the PDF viewer's) is read on screen as before.
export const SPAN_FRAME_MAX_DEG = 30;
/**
 * The box a span was turned from, and its line's direction, out of the
 * upright box round it and its `turn`: { x, y } its top-left corner, `w` and
 * `h` its own width and height, `cos` and `sin` of the turn — or null where it
 * says no turn, or one more than SPAN_FRAME_MAX_DEG off upright.
 */
export function spanFrame(s) {
  const t = s && typeof s.turn === "number" ? s.turn : NaN;
  if (!Number.isFinite(t)) return null;
  let d = ((t % 360) + 360) % 360;
  if (d > 180) d -= 360;
  if (Math.abs(d) > SPAN_FRAME_MAX_DEG) return null;
  const th = (d * Math.PI) / 180;
  const cos = Math.cos(th), sin = Math.sin(th), as = Math.abs(sin);
  const W = Number(s.width) || 0, H = Number(s.height) || 0;
  const det = cos * cos - as * as;
  const w = Math.max(0, (W * cos - H * as) / det);
  const h = (H * cos - W * as) / det;
  if (!(h > 0)) return null; // a box too small to work back: read on screen
  const left = Number(s.left) || 0, top = Number(s.top) || 0;
  return sin >= 0
    ? { x: left + h * sin, y: top, w, h, cos, sin }
    : { x: left, y: top - w * sin, w, h, cos, sin };
}

/**
 * A page's spans as one string, with a map from each character back to the
 * span it came from: `map[i] = { span, off }`, or null for a separator this
 * function put in. The map is what turns a match in the text back into a DOM
 * range over the page, which is what turns it into a rectangle.
 */
export function pageTextFromSpans(spans) {
  const list = spans || [];
  let text = "";
  const map = [];
  for (let i = 0; i < list.length; i++) {
    if (i > 0) {
      const sep = spanGap(list[i - 1], list[i]);
      for (let k = 0; k < sep.length; k++) map.push(null);
      text += sep;
    }
    const s = String(list[i] && list[i].text != null ? list[i].text : "");
    for (let off = 0; off < s.length; off++) map.push({ span: i, off });
    text += s;
  }
  return { text, map };
}

/**
 * The span-and-offset range a [start, end) character range covers, or null
 * where the range is nothing but separators. `endOffset` is exclusive, so it
 * drops straight into a DOM Range.
 */
export function spanRangeFor(map, start, end) {
  const m = map || [];
  const lo = Math.max(0, start | 0);
  const hi = Math.min(m.length, end | 0);
  let first = null, last = null;
  for (let i = lo; i < hi; i++) if (m[i]) { first = m[i]; break; }
  for (let i = hi - 1; i >= lo; i--) if (m[i]) { last = m[i]; break; }
  if (!first || !last) return null;
  return {
    startSpan: first.span, startOffset: first.off,
    endSpan: last.span, endOffset: last.off + 1,
  };
}

// ── text that does not run across the screen ─────────────────────────────────
//
// spanGap reads where the spans sit on SCREEN: a new line is a span that has
// dropped, a word gap is a span that has moved right. That is the geometry of
// text running left to right, and it is the only geometry it knows. Text that
// runs down the screen — portrait words on a page turned a quarter in Acrobat,
// a filing stamp up the margin — has its lines side by side, at one top, and
// the join welds the last word of one line onto the first of the next: on a
// /Rotate 90 fixture "Counsel for Ms. Quillfeather" and "Dated this day…" read
// as "QuillfeatherDated", which no key finds. Upside down it is the same
// weld, and text set at a slant is not far behind: measured on an upright
// page, a slant of 1.5° still read every line apart, 2° ran a full-width line
// into the one under it and 3° welded the name at a line's end to the next.
// Until the join learns each span's own direction, the reader has to know
// which text it cannot read — offUpright and sidewaysSpans are that.

/**
 * How far a run of text stands from upright ON SCREEN, 0 to 180 degrees: the
 * turns it is drawn through, summed — a pdf.js text layer's own, which the
 * stylesheet gives it on a /Rotate page, and the span's, which pdf.js gives
 * text the PDF sets at an angle — with the full turns taken off. A turn that
 * could not be read is no evidence of upright, and answers 180.
 */
export function offUpright(...turns) {
  let d = 0;
  for (const t of turns) {
    const n = typeof t === "number" ? t : NaN;
    if (!Number.isFinite(n)) return 180;
    d += n;
  }
  d = ((d % 360) + 360) % 360;
  return Math.min(d, 360 - d);
}
/**
 * How far off upright the join still reads lines apart (measured above).
 * Where an OCR layer gives its words the paper's lean, a sheet fed straight
 * stays under it and one fed crooked past it is taken for the slant it is; a
 * stamp, a margin note or a page turned in Acrobat is past it by a long way.
 */
export const UPRIGHT_SLACK_DEG = 1;
/**
 * The spans whose words do not run left to right across the screen — `turn`
 * (their summed turn, as offUpright reads it) more than `slack` off upright —
 * and that hold a letter. A name can be set a letter to a span, so one letter
 * counts; a sideways page number or Bates stamp, all digits, cannot be a name.
 */
export function sidewaysSpans(spans, slack = UPRIGHT_SLACK_DEG) {
  return (spans || []).filter((s) => s && offUpright(s.turn) > slack
    && /\p{L}/u.test(String(s.text == null ? "" : s.text)));
}

// ── the boxes ────────────────────────────────────────────────────────────────

const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

/**
 * Rectangles that are one line of text, merged into one box.
 *
 * A DOM range over a phrase reports a rectangle per line AND, within a line,
 * one per span it crosses — a name split across two spans comes back as two
 * boxes with a hairline of unredacted page between them. The boxes wanted are
 * the LINES: two rectangles merge when they sit on the same line (their
 * vertical extents overlap by more than half the shorter one) and touch or
 * nearly touch across the gap between them. Lines stay apart, so a wrapped
 * name does not black out the margin it wraps around.
 *
 * Rectangles are { x, y, w, h } in one consistent frame — PDF points with y up,
 * or layer pixels with y down; the arithmetic is the same either way.
 */
export function mergeRects(rects, gap = 2) {
  const out = [];
  for (const r of rects || []) {
    if (!r || !(r.w > 0) || !(r.h > 0)) continue;
    out.push({ x: r.x, y: r.y, w: r.w, h: r.h });
  }
  for (let again = true; again; ) {
    again = false;
    for (let i = 0; i < out.length && !again; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        const share = overlap(a.y, a.y + a.h, b.y, b.y + b.h);
        if (share <= Math.min(a.h, b.h) * 0.5) continue;          // different lines
        if (overlap(a.x, a.x + a.w, b.x, b.x + b.w) < -gap) continue; // too far apart
        const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
        out[i] = {
          x: x0, y: y0,
          w: Math.max(a.x + a.w, b.x + b.w) - x0,
          h: Math.max(a.y + a.h, b.y + b.h) - y0,
        };
        out.splice(j, 1);
        again = true;
        break;
      }
    }
  }
  return out;
}

/**
 * A box grown by `p` on every side. Glyphs overhang the rectangle their range
 * reports — descenders, italic tails, the antialiased edge of a stroke — and a
 * box drawn to the letter leaves a grey ghost of the word along its border.
 */
export function padRect(r, p) {
  return { x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p };
}

/**
 * A box held inside the page's own box, or null once there is nothing left of
 * it. `page` is { x, y, w, h } in user space — the PDF's own box, which is not
 * always anchored at the origin and is never the SIZE the page is displayed
 * at: a page carrying /Rotate 90 shows 792 wide and is still 612 wide in the
 * coordinates a box is stored in.
 */
export function clampRect(r, page) {
  const px = (page && page.x) || 0, py = (page && page.y) || 0;
  const pw = (page && page.w) || 0, ph = (page && page.h) || 0;
  const x0 = Math.max(px, Math.min(r.x, px + pw));
  const y0 = Math.max(py, Math.min(r.y, py + ph));
  const x1 = Math.max(px, Math.min(r.x + r.w, px + pw));
  const y1 = Math.max(py, Math.min(r.y + r.h, py + ph));
  if (!(x1 - x0 > 0.2) || !(y1 - y0 > 0.2)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ── a page nobody has drawn ──────────────────────────────────────────────────
//
// The viewer marks the page it has on screen: pdf.js has laid its text out as
// spans, the browser knows where every glyph of them sits, and a match turns
// into rectangles by asking it. The text reader has no such page. Beside an
// export it draws only the PDF pages in view, at the pane's width, and the key
// has to be run over the WHOLE document — every page of it, including the ones
// the export has no text for and the ones nobody will scroll to.
//
// The answer is not to guess the geometry from the PDF's text content. A run
// there is usually a whole printed line with one origin and one width, and a
// name inside it would have to be found by dividing that width by the line's
// characters — which for proportional type is wrong by a letter or two either
// way. Wrong by a letter is "QUILLMARK" with the QUI still showing. So the
// page's text is LAID OUT, off screen, by the same pdf.js text layer the
// viewer measures, and the browser is asked where the words are. The bitmap is
// never drawn: a layout is cheap where a render is not, and it is the layout
// that knows where a glyph sits.
//
// What is laid out at scale 1 is measured in points already — one CSS pixel to
// the point — and the page's own viewport carries the rest (a /Rotate, a box
// that does not start at the origin) back into the coordinates a box is stored
// in, exactly as it does for the page on screen.

/** The page's spans as `pageTextFromSpans` wants them, measured in the box they were laid out in. */
export function measureSpans(container) {
  const base = container.getBoundingClientRect();
  const out = [];
  for (const el of container.querySelectorAll("span")) {
    const r = el.getBoundingClientRect();
    out.push({
      text: el.textContent || "",
      left: r.left - base.left, top: r.top - base.top,
      width: r.width, height: r.height,
    });
  }
  return out;
}

/** A page's own box as `clampRect` wants it, from the page's `view`. */
export function pageBoxFromView(view) {
  const v = view || [0, 0, 0, 0];
  return { x: v[0] || 0, y: v[1] || 0, w: (v[2] || 0) - (v[0] || 0), h: (v[3] || 0) - (v[1] || 0) };
}

// ── is a value covered? ──────────────────────────────────────────────────────
//
// The check against the export asks, per page: the export says this real value
// stands here — did the sweep box it? Asked as "is there a box labelled with
// this exact value", the answer is wrong twice over, and both wrongs raise an
// alarm about a redaction that is in fact complete.
//
// A NAME CAN BE BOXED IN PIECES. The key usually binds a full name AND its
// parts, and a PDF's text is not a clean transcript: where "Zachary Coderre"
// is split across runs, or line-broken, or kerned oddly, the full-name matcher
// misses and the two shorter ones hit. The result is two boxes, "Zachary" and
// "Coderre", sitting side by side and blacking out the whole name — which is
// the job done. Only the label is unequal.
//
// AND NOT EVERY WORD OF A VALUE IS A VALUE. "Zachary Coderre, Esq." is faked
// as "Rushton, Greenhalgh, Esq." — the Esq. is carried straight through,
// because it is not a thing to hide. A redaction that leaves it standing is
// correct, and a check that demanded a box over it would be demanding a
// mistake. The same goes for "Department", "of", "Inc." and every other word a
// name is built around.
//
// Both fall out of one rule, and it needs no list of words to ignore: the
// words a redaction OWES are the words the run actually replaced — the words
// of the real value that are NOT in the fake that stands in its place. What it
// has is the words of every value boxed on that page, whoever boxed them. A
// claim is covered when the words it owes are all there.

/** A value as its significant words, folded. One-character tokens are dropped. */
export function valueWords(s) {
  const out = [];
  for (const w of String(s == null ? "" : s).toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length > 1) out.push(w);
  }
  return out;
}

/**
 * The words a redaction owes for a value: those of the REAL value that the
 * FAKE does not carry. With no fake in hand (a value from the key rather than
 * from a pseudonym on the page) every word is owed.
 */
export function wordsOwed(real, fake) {
  const carried = new Set(valueWords(fake));
  const out = [];
  for (const w of valueWords(real)) if (!carried.has(w)) out.push(w);
  // A value whose every word survives into the fake is not a value: rather
  // than call it covered by nothing, it owes itself.
  return out.length ? out : valueWords(real);
}

/**
 * Which claims on ONE page the boxes cover.
 *
 * `claims` are `{ real, fake }` in document order; `labels` are the real values
 * the sweep boxed on that page, one string per box. Answers a boolean per
 * claim, in the same order.
 *
 * Each box's words are spent once: two claims of one name on a page need two
 * boxes' worth of words, so a second claim is not covered by the first's box.
 * The longest claims are matched FIRST — a page carrying both "Zachary
 * Coderre" and a bare "Coderre" would otherwise let the short one spend the
 * word the long one needs, and report the full name as unredacted.
 */
export function coveredClaims(claims, labels) {
  const pool = new Map();
  for (const l of labels || []) for (const w of valueWords(l)) pool.set(w, (pool.get(w) || 0) + 1);
  const order = (claims || []).map((c, i) => ({ i, need: wordsOwed(c.real, c.fake) }));
  order.sort((a, b) => b.need.length - a.need.length || a.i - b.i);
  const out = new Array((claims || []).length).fill(false);
  for (const { i, need } of order) {
    if (!need.length) continue;
    if (!need.every((w) => (pool.get(w) || 0) > 0)) continue;
    for (const w of need) pool.set(w, pool.get(w) - 1);
    out[i] = true;
  }
  return out;
}

// ── the name the copy is saved under ────────────────────────────────────────
//
// THE NAME GOES WHERE THE COPY GOES. A redacted copy is the one file made to
// be handed on — attached to a letter, uploaded to a court, given to a drafting
// model — and its name travels with it. A copy with every party blacked out of
// its pages and "Helen_Rasho_Decl (redacted).pdf" on the outside has hidden
// nothing.
//
// The name used to be the stem run forward through the key as it stood, and
// the key only finds a name standing as a WORD. A file name is not a sentence:
//
//   AN UNDERSCORE IS A LETTER to the matcher (a word character, like \w), so
//     "Rasho_v_Quillmark_MTC" was one word with no name in it, and
//     "25STCV59720_Complaint" carried the docket the same way.
//   A WELD HAS NO BOUNDARY AT ALL. People drop the space between names in a
//     file name as a matter of course — "HelenRasho Decl", "RashoDecl" — and a
//     whole-word match cannot land inside one.
//
// Each came out exactly as it went in, the party's name and the case number on
// the outside of a copy whose pages were black over both. PDF-Linker met the
// same file names first, naming the exports (_pn_scrubbed_stem: "the family's
// surname rode out in the name of the one file that is shared"), and the copy
// is named the way it names an export:
//
//   1. Runs of _ and - are spaces, so every word of the stem is a word to the
//      key (pdfsync.spaceStem is the same normalisation, for matching an export
//      to its PDF). Spaces, never underscores: the name of a document is
//      written with spaces.
//   2. The stem is run forward through the key.
//   3. A run of letters made only of two or three bound name words joined
//      exactly — "HelenRasho", "HELENRASHO" — is their fakes joined the same
//      way (unweldNames, _pn_unweld_stem_names).
//   4. And then the name is CHECKED: where a bound value still stands in it,
//      the copy takes a neutral name instead, "document 3fa9c1 (redacted).pdf".
//      A useful name is worth having. It is not worth a party's name.
//
// ONE DEPARTURE FROM PDF-LINKER, in step 1. The reader's matcher reads a value
// exactly as the key spells it — a space as any gap, but a hyphen as a hyphen
// and an underscore as an underscore — so a federal docket "23-cv-01234"
// spaced out is a docket the forward no longer knows, and the check would send
// the copy to the neutral name for a value the key could have faked. A bound
// value spelled WITH either is found however the stem separates its words,
// written back as the key spells it, and faked whole (spacedStem).
//
// The underscore was left out at first, and that was worse than a lost name.
// An e-mail address whose handle carries one ("helen_rasho@rashofamilylaw.com")
// spaced out is no address the key binds, but its handle is two words the key
// DOES bind, so the forward faked the person and left the host: "Letter to
// ingrid strangeways@rashofamilylaw.com (redacted).pdf", the surname riding
// out in the firm's domain under a name that reads as scrubbed. The check did
// not see it either — the row's words no longer stood in a row, and the host
// is no value of its own — so the address's host is now read as one too
// (boundValueStands). PDF-Linker fakes an address whole or not at all.

const SEPARATORS_RE = /[_-]+/g;
// The separators a bound value may carry and keep (spacedStem).
const KEPT_SEPARATOR_RE = /[_-]/;
const WORDS_RE = /[\p{L}\p{N}]+/gu;
const ALNUM_RE = /[\p{L}\p{N}]/u;
// PDF-Linker's own reach: a weld of at least six letters, ASCII as there.
const WELD_RUN_RE = /[A-Za-z]{6,}/g;
const NAME_WORD_RE = /^\p{L}{3,}$/u;
const LETTERS_RE = /^\p{L}+$/u;
// PDF-Linker's _PN_WELD_CORE_MIN: a value this long (letters and digits) does
// not turn up inside an ordinary word by coincidence.
const WELD_CORE_MIN = 8;
// PDF-Linker's _PN_WELD_SHORT_CORE_MIN: the floor of its short weld tier. Under
// it a name is too short to tell from the letters of an ordinary word: "Ann"
// is in "Annual".
const WELD_SHORT_CORE_MIN = 4;
const CAPITAL_RE = /\p{Lu}/u;

// A letter's accents off, so "Garcia" in a name is the "García" the key binds,
// as it is to PDF-Linker's reduced scan (_pn_ascii_fold): a file name is
// typed, and typed without its accents as often as with them.
const MARKS_RE = /\p{M}+/gu;
function unmarked(s) {
  return String(s == null ? "" : s).normalize("NFD").replace(MARKS_RE, "");
}

/** A text's words: every run of letters and digits, folded, whatever stands between them. */
function wordsOf(s) {
  return unmarked(s).toLowerCase().match(WORDS_RE) || [];
}

/**
 * The stem with its separators spaced (step 1), save inside a bound value whose
 * own spelling carries them. `rows` as scrubbedStem takes them.
 *
 * A value spelled with a hyphen or an underscore is found in the stem with ANY
 * run of spaces, underscores and hyphens standing where the key's spelling has
 * a separator, and written back as the key spells it, so the forward fakes it
 * whole. It was found at first only where the stem spelled it exactly as the
 * key does, its spaces included, and the stem is a file name: "Mary-Kate_Olsen
 * _Decl" carries the key's own hyphen, but the underscore where the key has a
 * space defeated the search, the hyphen was spaced with the rest, and the
 * forward, finding no "Mary-Kate Olsen", faked the surname by its own row and
 * left the given names: "Mary Kate Pell Decl (redacted).pdf", a half-scrubbed
 * name under a name that reads as finished. "Mary Kate Olsen", the hyphen
 * typed as a space, came out the same. Written back, both are "Ruth-Ann Pell
 * Decl", and "23_cv_01234 Order" (a docket typed with underscores) is the
 * docket the key binds, "23-cv-05678 Order", as PDF-Linker reads every
 * spelling of a docket as one identity. A value found this way that the key
 * holds an instruction for has no fake; the forward writes nothing there, and
 * the check finds it standing.
 *
 * Every other character of the value is matched as the key spells it,
 * whole-word, any case; the stem's own letters are kept and only its
 * separators take the key's. A file name is a few words and every row is asked
 * with indexOf on its first piece before a pattern is built for it, so this is
 * one cheap pass over the key per saved copy.
 */
function spacedStem(stem, rows) {
  const s = String(stem == null ? "" : stem);
  const low = s.toLowerCase();
  // (A letter whose lower case is longer than itself puts every place after it
  // out by one; such a stem is simply spaced.)
  const hits = [];
  if (low.length === s.length) {
    for (const w of rows) {
      const v = String((w && w.real) || "").replace(/^[\s_-]+|[\s_-]+$/g, "");
      if (!KEPT_SEPARATOR_RE.test(v)) continue;
      // Alternating pieces and the separators between them, as the key spells them.
      const parts = v.split(/([\s_-]+)/);
      if (low.indexOf(parts[0].toLowerCase()) === -1) continue;
      let src = "(?<![\\p{L}\\p{N}])";
      for (let i = 0; i < parts.length; i++) {
        src += i % 2 ? "[\\s_-]+" : "(" + parts[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")";
      }
      src += "(?![\\p{L}\\p{N}])";
      let rx;
      try { rx = new RegExp(src, "giu"); } catch { continue; }
      for (let m = rx.exec(s); m; m = rx.exec(s)) {
        if (!m[0]) { rx.lastIndex++; continue; }
        // The stem's own pieces (its letters, its case), the key's separators,
        // a space for any run of whitespace the key carries.
        let text = "";
        for (let i = 0; i < parts.length; i++) {
          text += i % 2 ? (/^\s+$/.test(parts[i]) ? " " : parts[i].replace(/\s+/g, " ")) : m[(i >> 1) + 1];
        }
        hits.push({ at: m.index, end: m.index + m[0].length, text });
      }
    }
  }
  // The longest first where two values overlap; each place written once.
  hits.sort((a, b) => (b.end - b.at) - (a.end - a.at) || a.at - b.at);
  const taken = [];
  for (const h of hits) if (!taken.some((t) => h.at < t.end && t.at < h.end)) taken.push(h);
  taken.sort((a, b) => a.at - b.at);
  const spaced = (piece) => piece.replace(SEPARATORS_RE, " ");
  let out = "";
  let at = 0;
  for (const t of taken) { out += spaced(s.slice(at, t.at)) + t.text; at = t.end; }
  out += spaced(s.slice(at));
  return out.replace(/\s+/g, " ").trim();
}

/**
 * The stem with its welds PARTED where a person leaves a seam running two words
 * together: where the case turns ("RashoDecl", "MSJRasho") and where letters
 * meet digits ("Rasho2023"). PDF-Linker's hard seam (_pn_span_has_hard_seam).
 * Read by the check, never written: "McDonald" parted is no name of anyone's.
 */
export function partWelds(s) {
  return String(s == null ? "" : s)
    .replace(/(\p{Ll})(?=\p{Lu})/gu, "$1 ")
    .replace(/(\p{Lu})(?=\p{Lu}\p{Ll})/gu, "$1 ")
    .replace(/(\p{L})(?=\p{N})/gu, "$1 ")
    .replace(/(\p{N})(?=\p{L})/gu, "$1 ");
}

/**
 * {folded real word → its fake word} for every row whose fake was composed
 * word for word: "Helen Rasho" → "Ingrid Strangeways" gives helen → Ingrid and
 * rasho → Strangeways. Words of three letters or more, letters only, and only
 * where the word was actually replaced — firm furniture carried into the fake
 * ("Holdings") is no name. PDF-Linker's _pn_name_token_fakes, which reads only
 * the person rows: the key as the reader has it carries no category, so every
 * row composed word for word is read, and the corroboration below is what holds.
 */
export function nameWordFakes(rows) {
  const out = new Map();
  for (const w of rows || []) {
    if (!w || !w.fake || w.control) continue;
    const reals = String(w.real).trim().split(/\s+/);
    const fakes = String(w.fake).trim().split(/\s+/);
    if (reals.length !== fakes.length) continue;
    reals.forEach((r, i) => {
      const f = fakes[i];
      const k = r.toLowerCase();
      if (NAME_WORD_RE.test(r) && LETTERS_RE.test(f) && k !== f.toLowerCase() && !out.has(k)) out.set(k, f);
    });
  }
  return out;
}

/**
 * `stem` with every run of letters that is two or three bound name words run
 * together replaced by their fakes run together the same way, each in its own
 * word's case: "HelenRasho" → "IngridStrangeways", "HELENRASHO" →
 * "INGRIDSTRANGEWAYS". PDF-Linker's _pn_unweld_stem_names.
 *
 * The corroboration is the CONCATENATION: the run is nothing but bound words,
 * joined exactly, and no ordinary word is two names end to end. A run that is
 * ONE bound word is the forward's business and is left to it; a run with any
 * letter no bound word accounts for ("RashoDecl") is left whole, for the check.
 */
export function unweldNames(stem, words) {
  const s = String(stem == null ? "" : stem);
  if (!words || !words.size) return s;
  // Three words at most, so no run longer than three of the longest is one.
  let longest = 0;
  for (const k of words.keys()) if (k.length > longest) longest = k.length;
  const split = (run, left) => {
    const low = run.toLowerCase();
    if (!low) return [];
    if (left === 0) return null;
    for (let k = low.length - 2; k > 2; k--) {
      const head = low.slice(0, k);
      if (!words.has(head)) continue;
      const rest = split(run.slice(k), left - 1);
      if (rest) return [[run.slice(0, k), words.get(head)], ...rest];
    }
    return words.has(low) ? [[run, words.get(low)]] : null;
  };
  return s.replace(WELD_RUN_RE, (run) => {
    if (run.length > 3 * longest || words.has(run.toLowerCase())) return run;
    const parts = split(run, 3);
    if (!parts || parts.length < 2) return run;
    return parts.map(([real, fake]) => (real === real.toUpperCase() ? fake.toUpperCase()
      : real === real.toLowerCase() ? fake.toLowerCase() : fake)).join("");
  });
}

/**
 * Whether a bound value still stands in a (scrubbed) stem. `rows` as
 * scrubbedStem takes them.
 *
 * The name is asked four ways, each the reader's own form of a reading
 * PDF-Linker's check makes (surviving_reals, and surviving_reals_reduced as
 * _pn_scrubbed_stem calls it, spliced):
 *
 *   AS WRITTEN, every run of letters and digits a word whatever stands between
 *     them, accents off: "Rasho's", "23 cv 01234" (a docket that lost its
 *     hyphens), "J. Smith", "Jose Garcia". A value is found where all its
 *     words stand in a row, or run together as one word ("OBRIEN" for
 *     "O'Brien", the apostrophe dropped as a file name drops it). An e-mail
 *     address's HOST is read as a value of its own as well: an address spelled
 *     any way but the key's — a handle with a dot for its underscore, an "@"
 *     written "at" — had its handle faked word by word and its host left, and
 *     "ingrid strangeways@rashofamilylaw.com" reads as scrubbed.
 *   WITH ITS WELDS PARTED (partWelds): "RashoDecl" read as "Rasho Decl", where
 *     the case or the digits turn (PDF-Linker's hard seam).
 *   A LONG VALUE INSIDE A WORD: eight letters and digits or more, anywhere in
 *     one, any case — "HELENRASHODECL", "25STCV59720Complaint". PDF-Linker's
 *     long weld tier, and for the same reason: a core that long is not a
 *     coincidence. Or spaced out across whole words, edge to edge: "25 STCV
 *     59720", "Mc Allister" — PDF-Linker reads a spaced docket as the docket
 *     (one canonical identity for every spelling), and the forward does not.
 *   A SHORT NAME INSIDE A WORD: a one-word value of four to seven letters, or
 *     a name word of a longer one, run into other letters, where the letters
 *     it stands on carry a capital — "RASHODECL", "Rashodecl", "RASHOS OPP"
 *     (the possessive written without its apostrophe). PDF-Linker's short
 *     weld tier (_PN_WELD_SHORT_CORE_MIN, _pn_span_is_welded,
 *     _pn_span_is_cased).
 *
 * The short tier was left out at first, and "RASHODECL (redacted).pdf" was
 * pinned in the tests as the expected name, on the reasoning that a test for
 * a name inside a word would call "Release" a leak for a party named Lee. It
 * would not — "release" has no "lee" in it — and "Annual" for Ann is under the
 * four-letter floor. What the tier does cost is a name the reader cannot tell
 * from a word: PDF-Linker screens a capitalised hit through its dictionary
 * (_pn_span_in_vocab_word, so "Marketing" is a word and not Mark), and the
 * reader has no dictionary. So "Marketing Plan" in a matter with a party
 * named Mark takes the neutral name. Measured over 134 words that name legal
 * documents ("Declaration", "Opposition", "Summary", "Billing" …) and 204
 * common American given names and surnames of four to seven letters: in title
 * case one name hits one word (Mark, "Marketing"); in capitals three (Mary in
 * "SUMMARY", Ross in "CROSS", Mark). A name lost is the right side of that:
 * the copy is the file that is handed on.
 *
 * and two more readings PDF-Linker has no need of, since it fakes every word of
 * a person's name as its own token (one word, one fake) and the reader's key
 * carries only the rows a run wrote:
 *
 *   A NAME'S WORDS IN ANY ORDER: two words of one multi-word value, or one of
 *     its words beside a word of that row's own fake, standing anywhere in the
 *     name — "Strangeways Helen Decl" (the stem "Rasho_Helen_Decl", the
 *     surname faked by its own row and the given name left), "Helen M.
 *     Strangeways", "Mary Kate Pell" (a key spelling "Mary-Kate Olsen"),
 *     "Vrba, Tomas" and "Tomas J Vrba" (a key binding "Tomas Vrba" and nothing
 *     shorter). Each passed as finished: the check found a value only where
 *     its words stood in the key's order, and the forward had faked what it
 *     could. A half-scrubbed name that reads as done is the failure this check
 *     exists to stop. The words read are the ones a row's fake REPLACED (a
 *     word the fake carries, "Holdings", "de", "Dr", corroborates nothing),
 *     letters only, and a pair of them must hold a word of three letters or
 *     more ("de la" is no name). An e-mail address or a website is left to
 *     the readings above: its pieces ("law", "com") are no name's words.
 *   A NAME WORD OF EIGHT LETTERS OR MORE, anywhere in a word, any case, as a
 *     long value is: "KowalczykDecl", "KOWALCZYKDECL" for a key binding
 *     "Helena Kowalczyk". Only the words of four to seven letters were read
 *     inside a word (the short tier), and the long ones fell between it and
 *     the long tier, which held whole values only.
 *
 * A value whose words run together once its apostrophe is dropped ("O'Brien"
 * as "OBRIEN") is in the short tier as well when it is four to seven letters:
 * it was found only as a whole word, and "OBRIENDECL", "ObrienDecl" and
 * "DSOUZADECL" went out as their copies' names.
 *
 * Still not caught, as PDF-Linker does not catch them: a short name welded in
 * lower case ("rashodecl", "Declrasho"), and a name of three letters or fewer
 * welded at all ("LEEDECL", "Leedecl"). The capital is what keeps a four-letter
 * name out of ordinary lower-case letters, and under four letters a name
 * cannot be told from the letters of a word ("Ann" in "Annual", "Lee" in
 * "Leeward") — though one welded at a seam, "LeeDecl", is read parted. Nor a
 * lone word of a longer value standing by itself ("Vrba Decl" for a key
 * binding only "Tomas Vrba"): the key does not bind it, as the reader does not
 * mark it on the page. The name is offered in the Save dialog and named once
 * it is saved.
 */
export function boundValueStands(stem, rows) {
  const byFirst = new Map();
  const cores = [];
  const shorts = new Set();
  const joined = new Set();
  // Rows whose name's words are read in any order: { own, fake } — the words
  // the fake replaced, and the fake's words that replaced them.
  const scattered = [];
  const add = (words) => {
    if (!words.length) return;
    const list = byFirst.get(words[0]);
    if (list) list.push(words); else byFirst.set(words[0], [words]);
    const core = words.join("");
    if (core.length >= WELD_CORE_MIN) cores.push(core);
    else if (core.length < WELD_SHORT_CORE_MIN) return;
    else if (words.length > 1) {
      joined.add(core);
      // "O'Brien" run together, "OBRIENDECL": the short tier, as one word.
      if (LETTERS_RE.test(core)) shorts.add(core);
    } else if (LETTERS_RE.test(core)) shorts.add(core);
  };
  for (const w of rows || []) {
    const real = String((w && w.real) || "");
    const words = wordsOf(real);
    add(words);
    const at = real.lastIndexOf("@");
    if (at > 0) add(wordsOf(real.slice(at + 1)));
    else if (words.length > 1 && !/[@/]/.test(real)) {
      const fakeWords = new Set(wordsOf((w && w.fake) || ""));
      const realWords = new Set(words);
      const own = [...realWords].filter((x) => x.length >= 2 && LETTERS_RE.test(x) && !fakeWords.has(x));
      const fake = [...fakeWords].filter((x) => x.length >= 2 && LETTERS_RE.test(x) && !realWords.has(x));
      if (own.length && (own.length > 1 || fake.length)) scattered.push({ own, fake });
    }
  }
  // …and each NAME WORD of a longer value, as the unweld reads them
  // (nameWordFakes: a word the fake replaced, never furniture it carried).
  // The forward reads a word as ASCII letters, so it parts "JoséGarcía" at
  // the accent and fakes the surname alone: "JoséVelarde", the given name of
  // a party the key binds only whole, welded to a pseudonym. Eight letters
  // or more, the long tier: "KowalczykDecl".
  for (const k of nameWordFakes(rows).keys()) {
    const c = unmarked(k);
    if (c.length >= WELD_CORE_MIN) cores.push(c);
    else if (c.length >= WELD_SHORT_CORE_MIN) shorts.add(c);
  }
  // A name's words in any order (above): two of its own words, one of them
  // three letters or more, or one of its own beside one of its fake's.
  const scatteredIn = (words) => {
    if (!scattered.length) return false;
    const have = new Set(words);
    for (const { own, fake } of scattered) {
      const here = own.filter((x) => have.has(x));
      if (!here.length) continue;
      if (here.length > 1 && here.some((x) => x.length >= 3)) return true;
      if (fake.some((x) => have.has(x))) return true;
    }
    return false;
  };
  const standsIn = (words) => {
    for (let i = 0; i < words.length; i++) {
      for (const want of byFirst.get(words[i]) || []) {
        let k = 0;
        while (k < want.length && words[i + k] === want[k]) k++;
        if (k === want.length) return true;
      }
    }
    return false;
  };
  // Read off the stem as written, for its case: a run of letters and digits
  // longer than the name (so the name runs into something), the name's own
  // letters carrying a capital. (A run whose lower case is longer than itself
  // cannot have its places read back; it counts as cased.)
  const weldedShort = () => {
    if (!shorts.size) return false;
    for (const run of unmarked(stem).match(WORDS_RE) || []) {
      const low = run.toLowerCase();
      for (const c of shorts) {
        if (low.length <= c.length) continue;
        for (let at = low.indexOf(c); at !== -1; at = low.indexOf(c, at + 1)) {
          if (low.length !== run.length || CAPITAL_RE.test(run.slice(at, at + c.length))) return true;
        }
      }
    }
    return false;
  };
  const plain = wordsOf(stem);
  // The words as the welds part them as well: "Case25 STCV 59720" is the
  // docket spaced out once "Case25" is read "Case 25", and was a copy's name.
  const parted = wordsOf(partWelds(stem));
  // The stem's words run together, and where each one starts: a long value
  // read across words must start and end on a word's edge.
  const acrossIn = (words) => {
    const run = words.join("");
    const edges = new Set([run.length]);
    for (let i = 0, at = 0; i < words.length; at += words[i].length, i++) edges.add(at);
    return (c) => {
      for (let at = run.indexOf(c); at !== -1; at = run.indexOf(c, at + 1)) {
        if (edges.has(at) && edges.has(at + c.length)) return true;
      }
      return false;
    };
  };
  const acrossPlain = acrossIn(plain);
  const acrossParted = acrossIn(parted);
  return standsIn(plain) || plain.some((w) => joined.has(w)) || standsIn(parted)
    || parted.some((w) => joined.has(w))
    || cores.some((c) => plain.some((w) => w.length >= c.length && w.indexOf(c) !== -1)
      || acrossPlain(c) || acrossParted(c))
    || weldedShort() || scatteredIn(plain) || scatteredIn(parted);
}

/**
 * The neutral name's few characters: FNV-1a over the stem — the same document
 * always takes the same one, two documents rarely one — MIXED WITH THE KEY'S
 * REAL VALUES. A hash of the stem alone would let anyone holding the copy test
 * a guess at the name it came from ("is it Rasho_Decl?"); the key is never a
 * file to share, so with it folded in a guess has nothing to be tested against.
 */
function stemDigest(stem, rows) {
  let h = 2166136261;
  const eat = (s) => {
    for (const b of new TextEncoder().encode(s)) { h ^= b; h = Math.imul(h, 16777619) >>> 0; }
  };
  for (const w of rows) eat(String((w && w.real) || "") + "\n");
  eat(String(stem));
  return h.toString(16).padStart(8, "0").slice(0, 6);
}

/**
 * A document's stem made fit to name a shared copy: steps 1 to 4 above.
 *
 * `scrub` is `{ forward, rows }`: `forward(text)` writes real → fake (the
 * caller's compiled key), and `rows` are the values the key binds as
 * pseudo-key.boundRows gives them (`{ real, fake }`, an instruction row with no
 * fake) — what the welds are read against and what the check looks for. A bare
 * function is a forward with no rows: its own reading of the name, as written
 * and parted, is then the check. No key, no forward and no check, but the
 * separators are spaces all the same.
 */
export function scrubbedStem(stem, scrub) {
  const { forward, rows } = typeof scrub === "function" ? { forward: scrub, rows: null } : (scrub || {});
  const bound = Array.isArray(rows) ? rows : [];
  const fwd = typeof forward === "function" ? forward : null;
  let s = spacedStem(stem, bound);
  if (!s) return "";
  if (fwd) {
    try { const faked = fwd(s); if (faked) s = faked; } catch { /* the name it has */ }
  }
  s = unweldNames(s, nameWordFakes(bound)).replace(/\s+/g, " ").trim();
  const stands = bound.length ? boundValueStands(s, bound)
    : fwd ? [s, partWelds(s)].some((t) => { try { return fwd(t) !== t; } catch { return false; } })
    : false;
  return stands || !s ? "document " + stemDigest(stem, bound) : s;
}

/**
 * The name a redacted copy is saved under: the document's own stem made fit to
 * share (scrubbedStem) — a copy of "Helen_Rasho_Decl.pdf" is saved as "Ingrid
 * Strangeways Decl (redacted).pdf", one of "RashoDecl.pdf" as "document 3fa9c1
 * (redacted).pdf" — and marked redacted either way, so the copy is never
 * mistaken for the file it came from. The mark is written once however many
 * times a copy is copied. `scrub` as scrubbedStem takes it.
 */
export function redactedName(name, scrub, mark = "redacted") {
  let stem = String(name == null ? "" : name).split(/[\\/]/).pop().replace(/\.pdf$/i, "").trim();
  stem = stem.replace(new RegExp("\\s*\\(\\s*" + mark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\)\\s*$", "i"), "").trim();
  return (scrubbedStem(stem, scrub) || "document") + " (" + mark + ").pdf";
}

/** How many pages and how many boxes, said the way a bar says it. */
export function countLabel(boxes, pages) {
  if (!boxes) return "Nothing marked.";
  return `${boxes} box${boxes === 1 ? "" : "es"} on ${pages} page${pages === 1 ? "" : "s"}.`;
}

// ── the store ────────────────────────────────────────────────────────────────
//
// pageNumber → [{ id, rects: [{x,y,w,h}] in PDF points, kind, label }]
//   kind   "key"     proposed from the pseudonym key
//          "text"    a drag over text
//          "area"    a drag over a region
//   label  the real value, for a key box; what the drag covered, otherwise —
//          shown on hover, so a box can be read before it is kept.
//
// In memory only, like the highlights: closing the tab drops them. A proposal
// is a thing you are in the middle of, not a thing you keep.
//
// ONE STORE PER DOCUMENT. The viewer has one PDF open and marks that; the text
// reader's pane can hold the pages of two dozen, because a Combined Text.txt
// names a document per member and each has a PDF of its own. A redacted copy
// is a copy of ONE document, so the boxes cannot all live in one pile keyed by
// page: page 3 of the motion and page 3 of the reply are different pages. Each
// document gets a store of its own (`createRedactionStore`), and the viewer's
// single document uses the default one these functions stand for.

export function createRedactionStore() {
  const byPage = new Map();
  let nextId = 1;
  return {
    add(pageNumber, rects, { kind = "area", label = "", words = "" } = {}) {
      const clean = (rects || []).filter((r) => r && r.w > 0 && r.h > 0);
      if (!clean.length) return null;
      if (!byPage.has(pageNumber)) byPage.set(pageNumber, []);
      // `words` is what the box actually COVERS on the page, which is not the
      // same as what it is called. An area drawn over a name is labelled "this
      // area" — that is what the hand asked for — but it hides those words as
      // surely as a box the key proposed, and anything asking "is this value
      // redacted" has to be able to see that.
      const box = { id: nextId++, rects: clean, kind, label, words: words || "" };
      byPage.get(pageNumber).push(box);
      return box;
    },
    remove(pageNumber, id) {
      const list = byPage.get(pageNumber);
      if (!list) return false;
      const i = list.findIndex((b) => b.id === id);
      if (i < 0) return false;
      list.splice(i, 1);
      if (!list.length) byPage.delete(pageNumber);
      return true;
    },
    for(pageNumber) { return byPage.get(pageNumber) || []; },
    pages() {
      return [...byPage.keys()].sort((a, b) => a - b)
        .map((pageNumber) => ({ pageNumber, boxes: byPage.get(pageNumber) }))
        .filter((p) => p.boxes && p.boxes.length);
    },
    count() {
      let boxes = 0, pages = 0;
      for (const list of byPage.values()) if (list && list.length) { boxes += list.length; pages++; }
      return { boxes, pages };
    },
    clear(kind) {
      if (!kind) { byPage.clear(); nextId = 1; return; }
      for (const [pn, list] of [...byPage]) {
        const kept = list.filter((b) => b.kind !== kind);
        if (kept.length) byPage.set(pn, kept); else byPage.delete(pn);
      }
    },
  };
}

// The store the bare functions below work on: the one document a viewer has open.
const _store = createRedactionStore();

export function addRedaction(pageNumber, rects, meta) { return _store.add(pageNumber, rects, meta); }
export function removeRedaction(pageNumber, id) { return _store.remove(pageNumber, id); }
export function redactionsFor(pageNumber) { return _store.for(pageNumber); }
/** Every box, page by page: [{ pageNumber, boxes }], in page order. */
export function redactionPages() { return _store.pages(); }
/** { boxes, pages } — what the bar counts. */
export function redactionCount() { return _store.count(); }
export function clearRedactions(kind) { return _store.clear(kind); }

// ── painting ─────────────────────────────────────────────────────────────────

/**
 * Draw a page's proposals into its layer. `viewport` is the page's display
 * viewport — the stored points go through it, so the boxes sit on the same
 * words at every zoom and at every angle the rotate tool leaves the page at.
 * `onRemove(box)` is called when one is clicked, so a proposal can be taken
 * back off before it is committed to. `store` is the document's own store,
 * where there is more than one document on screen.
 */
export function repaintRedactionsForPage(pageNumber, layerDiv, viewport, { onRemove, store } = {}) {
  if (!layerDiv) return;
  while (layerDiv.firstChild) layerDiv.removeChild(layerDiv.firstChild);
  const held = store || _store;
  const list = held.for(pageNumber);
  if (!list || !list.length || !viewport) return;
  for (const box of list) {
    for (const r of box.rects) {
      const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([r.x, r.y, r.x + r.w, r.y + r.h]);
      const div = document.createElement("div");
      div.className = "redact-rect" + (box.kind === "key" ? " from-key" : "");
      div.dataset.redactId = String(box.id);
      div.style.left = `${Math.min(x1, x2)}px`;
      div.style.top = `${Math.min(y1, y2)}px`;
      div.style.width = `${Math.abs(x2 - x1)}px`;
      div.style.height = `${Math.abs(y2 - y1)}px`;
      div.title = (box.label ? `Will be blacked out: ${box.label}\n` : "Will be blacked out.\n")
        + "Click to take this box back off.";
      div.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
      div.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (held.remove(pageNumber, box.id) && onRemove) onRemove(box);
      });
      layerDiv.appendChild(div);
    }
  }
}

// ── the area drag ────────────────────────────────────────────────────────────

let _marquee = null;
function ensureMarquee() {
  if (_marquee) return _marquee;
  _marquee = document.createElement("div");
  _marquee.id = "redact-marquee";
  document.body.appendChild(_marquee);
  return _marquee;
}

/**
 * Left-drag over a page, while the area tool is on, proposes the box drawn.
 * Alt is left alone: that gesture belongs to the highlight tool's own marquee,
 * and two tools fighting over one drag is worse than either of them.
 *
 * The drag is anchored in DOCUMENT coordinates so a page scrolled mid-drag
 * keeps the box over the same words, exactly as the crop tool does.
 */
export function attachAreaDrag({ pageNumber, pageWrapper, getActive, onBox }) {
  pageWrapper.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.altKey || !getActive()) return;
    if (e.target && e.target.classList && e.target.classList.contains("redact-rect")) return;
    e.preventDefault();
    const startX = e.pageX, startY = e.pageY;
    const box = ensureMarquee();
    box.style.display = "block";
    const paint = (x, y) => {
      box.style.left = `${Math.min(startX, x)}px`;
      box.style.top = `${Math.min(startY, y)}px`;
      box.style.width = `${Math.abs(x - startX)}px`;
      box.style.height = `${Math.abs(y - startY)}px`;
    };
    paint(startX, startY);
    const onMove = (ev) => paint(ev.pageX, ev.pageY);
    const onUp = (ev) => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      box.style.display = "none";
      const r = pageWrapper.getBoundingClientRect();
      const docLeft = r.left + window.scrollX, docTop = r.top + window.scrollY;
      const left = Math.min(startX, ev.pageX) - docLeft;
      const top = Math.min(startY, ev.pageY) - docTop;
      const width = Math.abs(ev.pageX - startX);
      const height = Math.abs(ev.pageY - startY);
      if (width < 4 || height < 4) return; // a click, not a drag
      onBox(pageNumber, { left, top, width, height });
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  });
}
