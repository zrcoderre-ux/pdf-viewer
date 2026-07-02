// citation-linker.js
//
// JavaScript port of pdf_linker.py's citation detection logic, adapted for
// in-browser overlays on a PDF.js text layer. The intent is that anything
// pdf_linker.py would link, this also links — same regexes, same walk-back
// algorithm, same code-name tables, same supra resolution semantics, same
// citation_repo.json schema.
//
// Detection is run on the WHOLE document text (joined across all pages) so
// supra references can resolve to first-seen full cites that appear on an
// earlier page. Overlays are placed page-by-page via DOM Range geometry
// on the rendered PDF.js text layer.

import {
  westlawCaseUrl,
  westlawStatuteUrl,
  westlawRuleUrl,
  westlawUccUrl,
  lexisSearchUrl,
  wlSearchTerm,
  lexisSearchTerm,
  caseReporterCite,
  disambiguatedLexisTerm,
  slipSearchTerm,
} from "./code-tables.js";
import { REPORTERS_SORTED } from "./reporters.js";
import { STATUTE_CODES_SORTED } from "./statute-codes.js";

// ============================================================================
// Regex pieces (ported from pdf_linker.py — keep these in sync)
// ============================================================================

const REPORTER_PATTERN = REPORTERS_SORTED
  .map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

// vol REPORTER page (with optional pin or pin-range). The dash class accepts
// every common PDF-extracted dash code point: ASCII hyphen-minus, figure dash
// (U+2012), en dash (U+2013), em dash (U+2014), and minus sign (U+2212).
// Missing any of these silently breaks otherwise-valid cites — the figure
// dash bug caused "Santana v. FCA US, LLC, 56 Cal.App.5th 324, 345‒46
// (2020)" to be undetected until U+2012 was added in pdf_linker.py.
const REPORTER_PART =
  String.raw`(\d{1,4})\s+(${REPORTER_PATTERN})\s+(\d{1,5})` +
  String.raw`(?:,\s*\d{1,5}(?:[\-\u2012\u2013\u2014\u2212]\d{1,5})?)?`;

// CSM tail: " (year) volume reporter page" — California Style Manual form.
// Parens normally contain just a 4-digit year, but federal cases reported in
// CSM-style format often include a court abbreviation before the year — e.g.
// "(C.D. Cal. 2012)", "(2d Cir. 1979)", "(N.D.Ga 1983)". Optional pre-year
// text inside parens uses the same `[^)]*?\b` non-greedy guard as BB_TAIL.
const CSM_TAIL_RE = new RegExp(
  String.raw`\s*\((?:[^)]*?\b)?(\d{4})\)\s+${REPORTER_PART}`
);

// Bluebook tail: ", REPORTER (court year)" — (...) may include a court
// abbreviation like (9th Cir. 2015), (S.D.N.Y. 2009), (Cal. 2004), or just
// the year (2001). Captures the 4-digit year regardless of preceding court
// text. An optional comma after the pin is allowed: some briefs write
// "108 Cal. App. 4th 773, 780, (2003)" with a trailing comma after the pin.
const BB_TAIL_RE = new RegExp(
  String.raw`,\s+${REPORTER_PART}\s*,?\s*\((?:[^)]*?\b)?(\d{4})\)`
);

// Flat tail: " REPORTER (court year)" — same as Bluebook WITHOUT the comma
// between the defendant and the volume. Common in California practitioner
// briefs and tables of authorities:
//   "Donlen v. Ford Motor Co. 217 Cal. App. 4th 138 (2013)"
//   "Rattagan v. Uber Technologies, Inc. 17 Cal. 5th 1 (2024)"
//   "LiMandri v. Judkins 52 Cal.App.4th 326 (1997)"
// Group order matches BB_TAIL so downstream code can treat them identically.
const FLAT_TAIL_RE = new RegExp(
  String.raw`\s+${REPORTER_PART}\s*,?\s*\((?:[^)]*?\b)?(\d{4})\)`
);

// Westlaw-only citation tail: ", YYYY WL NNNNNN, at *N (court date)".
// Used for unpublished decisions that exist only on Westlaw. The year in
// parens may include a court abbreviation and date like (C.D. Cal. Nov. 2,
// 2021). Optional footnote pin ("at *5 n.7" is common in S.D.N.Y. citations).
// Group layout: (1) year-of-cite, (2) WL number, (3) decision year.
const WL_TAIL_RE = new RegExp(
  String.raw`,\s+(\d{4})\s+WL\s+(\d{4,8})` +
  String.raw`(?:,\s*at\s+\*?\d+(?:\s+n\.\d+)?)?` +
  String.raw`\s*\((?:[^)]*?\b)?(\d{4})\)`
);

// Lexis-only citation tail: ", YYYY U.S. Dist. LEXIS NNNNN (court date)".
// Structural parallel to WL_TAIL — both encode an online-database number
// that isn't a real page in any printed reporter. Lexis-only cites get
// `lexisOnly=true` so URL resolution forces them through Lexis regardless
// of the active provider (Westlaw doesn't carry LEXIS database numbers).
// Group layout: (1) year-of-cite, (2) LEXIS number, (3) decision year.
const LEXIS_TAIL_RE = new RegExp(
  String.raw`,\s+(\d{4})\s+U\.S\.\s*Dist\.\s*LEXIS\s+(\d{4,8})` +
  String.raw`(?:,\s*at\s+\*?\d+(?:\s+n\.\d+)?)?` +
  String.raw`\s*\((?:[^)]*?\b)?(\d{4})\)`
);

// Slip-cite tail: "[, ]?Case No. <docket-id> (<court> [date])". Decisions
// that haven't been published in a reporter and don't have a WL/LEXIS number
// assigned yet — the brief identifies them by trial-court docket number and
// court parenthetical. URL resolution falls back to a case-name search.
//
// * Comma optional ("Lee v. Creditco Info. Sols., Inc. Case No. 30STCV12347").
// * Docket-id is letters, digits, and common docket punctuation
//   (BCV-30-123456, 30STCV12347, 1:16-cv-12653-ADB, 19-cv-01080).
// * The court parenthetical may or may not contain a date.
// Group layout: (1) docket id, (2) full parenthetical contents.
const SLIP_TAIL_RE = new RegExp(
  String.raw`,?\s+Case\s+No\.\s+([A-Z0-9][A-Z0-9:\-]{3,30})` +
  String.raw`\s*\(([^)]{3,80})\)`,
  "i"
);

// In re cases (no v. anchor). Three alternatives:
//   CSM:      " ... (year) vol REPORTER page"
//   Bluebook: " ..., vol REPORTER page (court year)" or "... vol ... (year)"
//   WL:       " ..., [docket text], YYYY WL NNNNNN (court year)"
// The WL alternative allows up to ~80 chars of docket filler before the WL
// number — federal district-court WL cites commonly carry docket info
// between the case name and the WL number.
const INRE_RE = new RegExp(
  String.raw`\bIn re\s+([A-Z][A-Za-z0-9.\-'\u2019&, ]+?)\s*` +
  String.raw`(?:` +
    // CSM form
    String.raw`\((?:[^)]*?\b)?(\d{4})\)\s+(\d{1,4})\s+(${REPORTER_PATTERN})\s+(\d{1,5})` +
  String.raw`|` +
    // Bluebook/flat form (allow optional comma)
    String.raw`,?\s+(\d{1,4})\s+(${REPORTER_PATTERN})\s+(\d{1,5})\s*\((?:[^)]*?\b)?(\d{4})\)` +
  String.raw`|` +
    // WL alternative with optional docket-text filler
    String.raw`[,\s][^\n]{0,80}?,\s+(\d{4})\s+WL\s+(\d{4,8})` +
    String.raw`(?:,\s*at\s+\*?\d+(?:\s+n\.\d+)?)?` +
    String.raw`\s*\((?:[^)]*?\b)?(\d{4})\)` +
  String.raw`)`,
  "g"
);

// Consolidated-litigation cases ending with "Cases", with no v./In re.
// Each prefix word must be Title Case (capital + at least one lowercase) so
// we don't match "TABLE OF AUTHORITIES Cases" headings. The first word is
// additionally guarded against common sentence-internal connectors that
// could precede a case-name reference in body text ("The Ford Motor Warranty
// Cases held...", "In Ford Motor Warranty Cases the court..."): without
// this guard the leading "The"/"In"/"See"/"Cf"/"But" gets glued onto the
// case name.
const _TITLE_WORD = String.raw`[A-Z][a-z][A-Za-z]*`;
const _CASES_FIRST = String.raw`(?!The\b|In\b|See\b|Cf\b|But\b)` + _TITLE_WORD;
const CASES_RE = new RegExp(
  String.raw`\b(${_CASES_FIRST}(?:\s+${_TITLE_WORD}){1,5}\s+Cases)\s*` +
  String.raw`(?:` +
    String.raw`\((?:[^)]*?\b)?(\d{4})\)\s+(\d{1,4})\s+(${REPORTER_PATTERN})\s+(\d{1,5})` +
    String.raw`|` +
    String.raw`,?\s+(\d{1,4})\s+(${REPORTER_PATTERN})\s+(\d{1,5})\s*\((?:[^)]*?\b)?(\d{4})\)` +
  String.raw`)`,
  "g"
);

// "Smith, supra" or "Smith v. Jones, supra"
const SUPRA_RE = new RegExp(
  String.raw`\b((?:In re\s+)?[A-Z][A-Za-z0-9.\-'\u2019&]+(?:\s+v\.\s+[A-Z][A-Za-z0-9.\-'\u2019&]+)?)` +
  String.raw`,\s*supra\b`,
  "g"
);

// Statute pattern. Built from the dual-form code list. IGNORECASE so all-caps
// practitioner forms like "CAL. CIV. PROC. CODE § 1281.2" match alongside
// the conventional title-case forms; the required §/section after the code
// name keeps false-positive risk low.
function buildStatuteRegex() {
  const parts = STATUTE_CODES_SORTED.map(([pat, _abbrev], i) => `(?<c${i}>${pat})`);
  const codeAlt = parts.join("|");
  return new RegExp(
    String.raw`\b(?:Cal\.\s*|California\s+)?` +
    `(?:${codeAlt})` +
    String.raw`,?\s*` +
    String.raw`(?:§§?|sections?|secs?\.?)\s*` +
    String.raw`(?<sec>\d+(?:\.\d+)?[a-z]?(?:\([a-z0-9]+\))*)`,
    "gsi"
  );
}
const STATUTE_RE = buildStatuteRegex();

function statuteAbbrev(match) {
  for (let i = 0; i < STATUTE_CODES_SORTED.length; i++) {
    if (match.groups[`c${i}`]) return STATUTE_CODES_SORTED[i][1];
  }
  return null;
}

// Federal statutes: "9 U.S.C. § 1", "42 U.S.C. § 1983". Title number precedes
// the code abbreviation. Allow optional ", App." after "U.S.C." for appendix
// sections. PDFs sometimes render U.S.C. with intervening spaces between
// letters, so accept "U. S. C." too.
const USC_RE = new RegExp(
  String.raw`\b(?<title>\d{1,3})\s+U\.\s*S\.\s*C\.` +
  String.raw`(?:\s*App\.)?` +
  String.raw`\s*` +
  String.raw`(?:§§?|sections?|secs?\.?)\s*` +
  String.raw`(?<sec>\d+(?:\.\d+)?[a-z]?(?:\([a-z0-9]+\))*)`,
  "gi"
);

// Model Uniform Commercial Code — distinct from California's Commercial Code.
// The TELL is a HYPHENATED section ("3-310", "2-207(2)"): the model UCC uses
// article-section numbering with a hyphen, while California's Commercial Code
// omits it. We match the Commercial-Code family of names (U.C.C., UCC,
// Uniform/Unif. Commercial Code, Commercial Code, Com. Code) ONLY when the
// section is hyphenated; non-hyphenated sections fall through to the normal
// California statute pass.
const UCC_RE = new RegExp(
  String.raw`\b(?:U\.?\s*C\.?\s*C\.?` +
  String.raw`|Unif(?:orm)?\.?\s*Commercial\s+Code` +
  String.raw`|Commercial\s+Code` +
  String.raw`|Com\.\s*Code)` +
  String.raw`,?\s*` +
  String.raw`(?:§§?|sections?|secs?\.?)\s*` +
  String.raw`(?<sec>\d+-\d+(?:\([a-z0-9]+\))*)`,
  "gi"
);

// Chained additional sections that follow a primary statute match.
//   "Code of Civil Procedure sections 598 and 1048(b)"
//   "Civ. Code §§ 1542, 1543, and 1544"
//   "Pen. Code §§ 187, 189"
// Anchored at the end of the previous match. Each iteration extracts a single
// continuation; the caller loops until ADDL_SEC_RE no longer matches at the
// current scan position. The match MUST be anchored to scan_pos in source —
// JS doesn't have re.match-with-pos, so we use sticky (`y`) with lastIndex.
const ADDL_SEC_RE = new RegExp(
  String.raw`\s*(?:,\s*and|,|\s+and)\s+` +
  String.raw`(?<sec>\d+(?:\.\d+)?[a-z]?(?:\([a-z0-9]+\))*)`,
  "yi"
);

// Cal. Rules of Court rule N.N(letter)(digit)…
const RULE_RE = new RegExp(
  String.raw`\b(?:Cal\.\s*Rules?\s*of\s*Court|California\s*Rules?\s*of\s*Court),?\s*` +
  String.raw`rules?\s+(\d+(?:\.\d+)*(?:\([a-z0-9]+\))*)`,
  "gi"
);

// Rules of Professional Conduct: "Cal. Rules of Prof. Conduct, rule 1.9".
const RPC_RE = new RegExp(
  String.raw`\b(?:Cal(?:ifornia)?\.?\s+)?Rules?\s+of\s+(?:Prof(?:essional)?\.?\s+)?Conduct\s+` +
  String.raw`(\d+(?:\.\d+)*(?:\([a-z0-9]+\))*)`,
  "gi"
);

// "v." anchored — walk back from each occurrence to identify the plaintiff.
const ANCHOR_RE = /(?<=\s)v\.(?=\s)/g;

// Bare "X v. Y" (or "X v. Y, Inc.") — second-pass linker for short-form
// references to cases already cited in long form elsewhere in the document.
// Plaintiff: uppercase-leading token with internal letters/digits/'-./&.
// Defendant: same, plus optional ", Inc." / ", LLC" / etc.
const _PARTY_TOKEN = String.raw`[A-Z][A-Za-z0-9.\-'\u2019&]*`;
const SHORT_FORM_RE = new RegExp(
  String.raw`\b(${_PARTY_TOKEN}(?:\s+${_PARTY_TOKEN}){0,3})\s+v\.\s+` +
  String.raw`(${_PARTY_TOKEN}(?:\s+${_PARTY_TOKEN}){0,4}(?:,\s*(?:Inc|LLC|LLP|Ltd|Corp|Co)\.?)?)`,
  "g"
);

// Leading words to strip from a short-form plaintiff capture. Mirrors
// SIGNAL_PREFIXES but for the second-pass entry point — when a brief writes
// "In Smith v. Jones, ..." or "See Smith v. Jones, ...", these words would
// otherwise pollute the registry lookup.
const SHORTFORM_LEAD_RE =
  /^(?:In|See|Cf|Cf\.|Compare|Accord|But|Following|Per|Under|Like|Citing|Quoting)\s+/i;

// ============================================================================
// Walk-back for plaintiff name (port of _walk_back_for_name)
// ============================================================================

const SIGNAL_PREFIXES = new Set([
  "see", "cf", "cf.", "per", "in", "but", "compare", "accord", "e.g.",
  "also", "n", "of", "the", "and", "to", "by", "for", "with", "from",
  "as", "if", "when", "while", "since", "because", "though", "although",
  "court", "supreme", "federal", "state", "california",
]);

const NAME_CONNECTORS = new Set([
  "of", "the", "and", "&", "de", "la", "du", "von", "van", "re",
  // Latin connectors used in case captions:
  //   "People ex rel. [relator] v. [defendant]" — government suing in the
  //   name of an interested private party. Without these, walk-back stops
  //   at "rel." and the resulting key loses "People ex rel.".
  "ex", "rel",
]);

const ABBREV_OK = new Set([
  "co.", "inc.", "corp.", "ltd.", "ass'n.",
  // "rel." in "ex rel." — short lowercase abbreviation the cap-then-short
  // heuristic wouldn't accept on its own.
  "rel.",
]);

// Sentence-internal signal words that look like corporate abbreviations
// ("E.g.", "I.e.", "Cf.") and would otherwise pass the cap-then-short
// heuristic in walk-back. Without this guard, "Song Beverly Act. E.g., Noori
// v. Jaguar..." gets collected as "Song Beverly Act. E.g., Noori".
// Stored without trailing punctuation; matcher strips before comparing.
const STOPPER_ABBREVS = new Set([
  "e.g", "i.e", "cf", "etc", "viz", "supra",
  "eg", "ie", "see", "accord", "compare",
]);

// TOA section-header tokens. After newline normalization runs, a TOA layout
// that puts "Cases" on its own line directly above a citation looks like
// "Cases Smith v. Jones". The walk-back from "v." would otherwise pull
// "Cases" into the plaintiff name. Match is case-insensitive on the cleaned
// (punctuation-stripped) token.
const TOA_HEADERS = new Set([
  "cases", "statutes", "rules", "authorities", "treatises",
  "regulations", "constitutional", "miscellaneous",
]);

// Corporate-suffix tokens that mark the end of a party name. Used by the
// digit-token rule in walk-back: a digit is only kept as part of the
// plaintiff if at least one of these has already been collected (otherwise
// the digit is almost certainly a page number bleeding in from a TOA layout).
const CORP_SUFFIX_LOWER = new Set([
  "inc", "co", "corp", "ltd", "grp", "ass'n", "assn", "lp",
]);
const CORP_SUFFIX_UPPER = new Set(["LLC", "LLP", "LP", "LLLP", "PLLC", "PC", "PLC"]);

function walkBackForName(text, vPos, minPos = 0) {
  // `minPos` clips the walk-back's leftmost reach. Callers use it to prevent
  // walk-back from one citation's `v.` scanning past an earlier citation's
  // `v.` (which would pull the earlier defendant into this plaintiff's name).
  let pos = vPos - 1;
  while (pos > minPos && text[pos] === " ") pos--;

  // Skip a trailing ", et al." if present immediately before v. — handles
  // "Juan Carlos Meneses, et al. v. FCA US LLC" without abandoning at "al.".
  const head = text.slice(0, pos + 1);
  const etAl = head.match(/,\s*et\s+al\.?\s*$/);
  if (etAl && etAl.index >= minPos) {
    pos = etAl.index - 1;
    while (pos > minPos && text[pos] === " ") pos--;
  }

  const tokens = []; // {start, end, tok}, closest-to-v.-first

  while (pos >= minPos) {
    // Track the size of the whitespace gap we skip over. A gap of 3+ chars
    // (or one containing a newline/tab) is a sentence boundary signal: real
    // citations don't have wide intra-citation whitespace, but normalized
    // line-wrapped text does ("…Ford Motor Co.\n    Anderson v. ..." → "…
    // Ford Motor Co.     Anderson v. ..."). When we step over such a gap
    // AND we've already collected a sensible plaintiff token, stop. Without
    // this guard, walk-back from Anderson's v. pulls "Ford Motor Co." in
    // from a preceding citation.
    const gapStart = pos;
    while (pos >= minPos && (text[pos] === " " || text[pos] === "\t")) pos--;
    const gapSize = gapStart - pos;
    if (pos < minPos) break;
    if (text[pos] === "\n") break;
    if (tokens.length && gapSize >= 3) break;

    const tokEnd = pos + 1;
    while (pos >= minPos && text[pos] !== " " && text[pos] !== "\n" && text[pos] !== "\t") pos--;
    const tokStart = pos + 1;
    const tok = text.slice(tokStart, tokEnd);
    if (!tok) break;

    const lastChar = tok[tok.length - 1];
    if (":;!?".includes(lastChar)) break;

    // Stopper-abbreviations check ("E.g.,", "I.e.,", "Cf.", "Supra,"). These
    // look superficially like corporate abbreviations (capital-then-lowercase
    // -with-dots) but are sentence-internal signal words that mark the END
    // of any case name we should still be collecting. Reject explicitly so
    // walk-back doesn't slurp text like "Song Beverly Act. E.g., Noori v.
    // ..." into a plaintiff name.
    const tokCleanLow = tok.replace(/^[(.,;:"']+/, "").replace(/[,.;:]+$/, "").toLowerCase();
    if (STOPPER_ABBREVS.has(tokCleanLow)) {
      if (tokens.length) break;
      return null;
    }

    // End-of-sentence: ends with "." preceded by lowercase. Allow any
    // capitalized-then-short-lowercase token like "Co.", "Inc.", "Ref.",
    // "Mfg.", "Sav.", "Bldg." as part of corporate names — these appear
    // constantly inside party names.
    if (
      tok.endsWith(".") &&
      tok.length > 1 &&
      tok[tok.length - 2] >= "a" && tok[tok.length - 2] <= "z"
    ) {
      const inner = tok.replace(/\.+$/, "");
      const isShortCapAbbrev =
        inner.length >= 1 && inner.length <= 6 &&
        inner[0] >= "A" && inner[0] <= "Z";
      if (!isShortCapAbbrev && !ABBREV_OK.has(tok.toLowerCase())) break;
    }

    // Strip leading punctuation. Also strip a leading hyphen because PDFs
    // sometimes render hyphenated party names like "Bigler-Engler" with a
    // stray space-hyphen-space sequence ("Bigler -Engler"), which the
    // tokenizer splits into "Bigler" and "-Engler". We want "-Engler" to
    // clean to "Engler" so walk-back keeps going.
    const clean = tok
      .replace(/^[(.,;:"'\u2010\u2011\u2012\u2013\u2014\u2212\-]+/, "")
      .replace(/[,.;:]+$/, "");
    if (!clean) break;

    // Pure-digit tokens: appear in real party names ("Studio 1220, Inc.")
    // but ALSO as page numbers in TOAs that bleed into the walk-back after
    // newline normalization (e.g. "...14, 16 McGee v. Mercedes-Benz..."). To
    // distinguish, accept the digit if EITHER:
    //   (a) a corporate-suffix token has already been collected closer to
    //       v. — "Studio 1220, Inc." reaches "Inc." first, then "1220"; OR
    //   (b) the digit is immediately preceded (in source order) by a
    //       "local number" introducer like "Local", "Loc.", "No.", or
    //       "Chapter" — these unambiguously mark the digit as part of a
    //       party name ("Service Employees Local 660").
    if (clean[0] >= "0" && clean[0] <= "9") {
      // Comma-suffixed digit (e.g. "16,") is a page-reference list item
      // after TOA newline normalisation — never a company number.
      if (tok.replace(/\s+$/, "").endsWith(",")) {
        if (tokens.length) break;
        return null;
      }
      const hasCorpMarker = tokens.some((t) => {
        const low = t.tok.replace(/[,.;:]+$/, "").toLowerCase();
        const up  = t.tok.toUpperCase();
        return CORP_SUFFIX_LOWER.has(low) || CORP_SUFFIX_UPPER.has(up);
      });
      let localIntro = false;
      const peekLeft = text.slice(0, tokStart).replace(/\s+$/, "");
      const lastTokMatch = /(\S+)$/.exec(peekLeft);
      if (lastTokMatch) {
        const prev = lastTokMatch[1].replace(/[,.;:]+$/, "").toLowerCase();
        if (["local", "loc", "no", "chapter", "ch"].includes(prev)) {
          localIntro = true;
        }
      }
      if (!(hasCorpMarker || localIntro)) {
        if (tokens.length) break;
        return null;
      }
      tokens.push({ start: tokStart, end: tokEnd, tok });
      continue;
    }

    const firstChar = clean[0];
    const isLower = firstChar >= "a" && firstChar <= "z";
    const isUpper = firstChar >= "A" && firstChar <= "Z";
    if (isLower && !NAME_CONNECTORS.has(clean.toLowerCase())) {
      if (tokens.length) break;
      return null;
    }
    if (!isUpper && !NAME_CONNECTORS.has(clean.toLowerCase())) {
      if (tokens.length) break;
      return null;
    }

    // Reject ALLCAPS tokens that are clearly heading text. Length ≥5 because
    // real party names sometimes have ALLCAPS abbreviations of 2-4 chars
    // ("OCM Principal", "FCA US LLC", "B.B.", "L.A. Times"); heading words
    // ("TABLE", "AUTHORITIES", "DEFENDANT", "MOTION", "SUMMARY", "JUDGMENT")
    // are almost always 5+ chars. Also rejects law-firm-letterhead tokens
    // like "EXAMPLE" that show up in page footers right above body text.
    const alphaChars = [...clean].filter((c) => /[A-Za-z]/.test(c));
    if (
      alphaChars.length >= 5 &&
      alphaChars.every((c) => c >= "A" && c <= "Z") &&
      !NAME_CONNECTORS.has(clean.toLowerCase())
    ) {
      if (tokens.length) break;
      return null;
    }

    // Law-firm-suffix tokens. Two scenarios:
    //   (a) Part of plaintiff name — "Smith LLC v. Jones". When walked
    //       backward from v., LLC is the FIRST token collected.
    //   (b) Page-footer artifact — "EXAMPLE COUNSEL GROUP LLP\n Santa
    //       Clara Valley Water Dist. v. ...". Here LLC/LLP appears AFTER
    //       several plaintiff tokens have been collected (real plaintiff is
    //       "Santa Clara Valley Water Dist.", LLP is upstream letterhead).
    // Allow (a) and reject (b): break if we've already collected tokens.
    if (["LLP", "LLC", "LLLP", "PLLC", "PC", "PLC"].includes(clean.toUpperCase())) {
      if (tokens.length) break;
      // Fall through for first-token case.
    }

    // Stop at TOA section-header words ("Cases", "Statutes", "Rules"…).
    // After newline normalization, "Cases\nSmith v. Jones" becomes "Cases
    // Smith v. Jones". Without this guard, "Cases" would get pulled into
    // the plaintiff name.
    if (TOA_HEADERS.has(clean.toLowerCase())) {
      if (tokens.length) break;
      return null;
    }

    tokens.push({ start: tokStart, end: tokEnd, tok });
  }

  if (!tokens.length) return null;
  tokens.reverse();

  // Strip leading signal words, but preserve "In re"
  while (tokens.length) {
    const first = tokens[0].tok
      .toLowerCase()
      .replace(/[(.,;:"']+$/, "")
      .replace(/^[(.,;:"']+/, "");
    if (SIGNAL_PREFIXES.has(first)) {
      if (first === "in" && tokens.length > 1) {
        const second = tokens[1].tok.toLowerCase().replace(/[,.;:]+$/, "");
        if (second === "re") break;
      }
      tokens.shift();
    } else break;
  }
  if (!tokens.length) return null;

  // Advance start past leading non-letter punctuation like "(" or quotation.
  let start = tokens[0].start;
  const end = tokens[0].end;
  while (start < end && !/[A-Za-z]/.test(text[start])) start++;
  return start;
}

// ============================================================================
// Citation finders
// ============================================================================

function shortName(plaintiff) {
  let p = plaintiff.trim();
  p = p.replace(/^(In re|Ex parte|People v\.\s+)/i, "");
  const parts = p.split(/\s+/);
  return parts[0] ? parts[0].replace(/[,.;:]+$/, "") : p;
}

function findCaseCitations(text) {
  const results = [];

  // v.-anchored. Track each v.'s end position so a later walk-back can't
  // scan past an earlier v. — that would pull the previous citation's
  // defendant into the current plaintiff name. The tail search is similarly
  // clipped to text before the next v.
  let m;
  ANCHOR_RE.lastIndex = 0;
  const vAnchors = [];
  while ((m = ANCHOR_RE.exec(text)) !== null) {
    vAnchors.push({ start: m.index, end: m.index + m[0].length });
  }

  for (let ai = 0; ai < vAnchors.length; ai++) {
    const { start: vStart, end: vEnd } = vAnchors[ai];
    const prevVEnd = ai > 0 ? vAnchors[ai - 1].end : 0;
    const nextVStart = ai + 1 < vAnchors.length ? vAnchors[ai + 1].start : text.length;

    const plaintiffStart = walkBackForName(text, vStart, prevVEnd);
    if (plaintiffStart === null) continue;
    const plaintiff = text.slice(plaintiffStart, vStart).trim();
    const rest = text.slice(vEnd, nextVStart);

    // Find first occurrence of each tail form in `rest`. Earliest wins.
    // Restrict to within ~80 chars of v. — with newline normalization a
    // single citation comfortably fits in this window; anything farther
    // is almost certainly a different case.
    const MAX_DIST = 80;
    const csmHit   = CSM_TAIL_RE.exec(rest);    CSM_TAIL_RE.lastIndex   = 0;
    const bbHit    = BB_TAIL_RE.exec(rest);     BB_TAIL_RE.lastIndex    = 0;
    const wlHit    = WL_TAIL_RE.exec(rest);     WL_TAIL_RE.lastIndex    = 0;
    const lexisHit = LEXIS_TAIL_RE.exec(rest);  LEXIS_TAIL_RE.lastIndex = 0;
    const flatHit  = FLAT_TAIL_RE.exec(rest);   FLAT_TAIL_RE.lastIndex  = 0;

    const candidates = [];
    if (csmHit   && csmHit.index   <= MAX_DIST) candidates.push(["csm",   csmHit]);
    if (bbHit    && bbHit.index    <= MAX_DIST) candidates.push(["bb",    bbHit]);
    if (wlHit    && wlHit.index    <= MAX_DIST) candidates.push(["wl",    wlHit]);
    if (lexisHit && lexisHit.index <= MAX_DIST) candidates.push(["lexis", lexisHit]);
    if (flatHit  && flatHit.index  <= MAX_DIST) candidates.push(["flat",  flatHit]);

    // Slip cite is a *fallback*: only consider it if no reporter-shaped tail
    // matched. Slip cites have no reporter to anchor a strong match, so
    // they're vulnerable to misreading "Case No." references in body text
    // that AREN'T citations.
    if (!candidates.length) {
      const slipHit = SLIP_TAIL_RE.exec(rest);
      SLIP_TAIL_RE.lastIndex = 0;
      if (slipHit && slipHit.index <= MAX_DIST) candidates.push(["slip", slipHit]);
    }
    if (!candidates.length) continue;

    // Earliest tail wins. FLAT_TAIL is a strict superset of BB_TAIL minus
    // the comma — they never tie because BB's comma takes a position FLAT
    // can't. CSM also can't tie BB/FLAT because CSM's "(year)" lead
    // disambiguates.
    candidates.sort((a, b) => a[1].index - b[1].index);
    const [kind, mm] = candidates[0];

    const defendantText = rest.slice(0, mm.index).replace(/[,\s]+$/, "").trim();
    if (!defendantText || !/[A-Z]/.test(defendantText[0])) continue;
    if (defendantText.length > 200) continue;

    let tailForKey;
    if (kind === "csm") {
      const [, year, vol, reporter, page] = mm;
      tailForKey = `(${year}) ${vol} ${reporter.replace(/\s+/g, "")} ${page}`;
    } else if (kind === "bb" || kind === "flat") {
      // Group layout is identical: (vol, reporter, page, year). The only
      // structural difference is the comma at the start of BB, which both
      // patterns absorb internally before the captured groups.
      const [, vol, reporter, page, year] = mm;
      tailForKey = `(${year}) ${vol} ${reporter.replace(/\s+/g, "")} ${page}`;
    } else if (kind === "wl") {
      tailForKey = `${mm[1]} WL ${mm[2]}`;
    } else if (kind === "lexis") {
      tailForKey = `${mm[1]} U.S. Dist. LEXIS ${mm[2]}`;
    } else {
      // slip: no reporter cite — the docket id and court parenthetical ARE
      // the citation. Encode both in the key so duplicate detection still
      // works and the repo can map them to specific URLs if added.
      const docket = mm[1];
      const courtParen = (mm[2] || "").trim();
      tailForKey = `Case No. ${docket} (${courtParen})`;
    }

    const plaintiffClean = plaintiff.replace(/\s+/g, " ").trim();
    const defendantClean = defendantText.replace(/\s+/g, " ").trim();
    const key = `${plaintiffClean} v. ${defendantClean} ${tailForKey}`;

    const matchEnd = vEnd + mm.index + mm[0].length;
    results.push({
      kind: "case",
      key,
      span: [plaintiffStart, matchEnd],
      matchText: text.slice(plaintiffStart, matchEnd),
      short: shortName(plaintiffClean),
      // WL-only unpublished decisions exist only on Westlaw.
      wlOnly:    kind === "wl",
      // U.S. Dist. LEXIS database numbers are Lexis-only.
      lexisOnly: kind === "lexis",
      // Slip cites have no reporter cite — fall back to name search.
      slipOnly:  kind === "slip",
    });
  }

  // In re cases
  INRE_RE.lastIndex = 0;
  while ((m = INRE_RE.exec(text)) !== null) {
    const name = m[1].replace(/\s+/g, " ").trim();
    // Group layout: m[1]=name, then EITHER m[2..5] (CSM), m[6..9] (Bluebook),
    // or m[10..12] (WL: year-of-cite, WL-number, decision-year).
    let year, vol, reporter, page;
    let wlOnly = false;
    if (m[2]) {
      year = m[2]; vol = m[3]; reporter = m[4]; page = m[5];
    } else if (m[6]) {
      vol = m[6]; reporter = m[7]; page = m[8]; year = m[9];
    } else {
      // WL alternative
      const wlYear = m[10], wlNum = m[11];
      wlOnly = true;
      const fullName = `In re ${name}`;
      const key = `${fullName} ${wlYear} WL ${wlNum}`;
      results.push({
        kind: "case",
        key,
        span: [m.index, m.index + m[0].length],
        matchText: m[0],
        short: shortName(fullName),
        wlOnly,
      });
      continue;
    }
    const repCompact = reporter.replace(/\s+/g, "");
    const fullName = `In re ${name}`;
    const key = `${fullName} (${year}) ${vol} ${repCompact} ${page}`;
    results.push({
      kind: "case",
      key,
      span: [m.index, m.index + m[0].length],
      matchText: m[0],
      short: shortName(fullName),
    });
  }

  // "[Subject] Cases" — consolidated-litigation case names with no v./In re.
  CASES_RE.lastIndex = 0;
  while ((m = CASES_RE.exec(text)) !== null) {
    const name = m[1].replace(/\s+/g, " ").trim();
    let year, vol, reporter, page;
    if (m[2]) {
      year = m[2]; vol = m[3]; reporter = m[4]; page = m[5];
    } else {
      vol = m[6]; reporter = m[7]; page = m[8]; year = m[9];
    }
    const repCompact = reporter.replace(/\s+/g, "");
    const key = `${name} (${year}) ${vol} ${repCompact} ${page}`;
    results.push({
      kind: "case",
      key,
      span: [m.index, m.index + m[0].length],
      matchText: m[0],
      short: name.split(/\s+/)[0],
    });
  }

  return results;
}

function findStatuteCitations(text) {
  const results = [];
  let m;

  // Model Uniform Commercial Code (hyphenated section). Detected first so the
  // general California pass below can skip the partial "... § 3" it would
  // otherwise grab from "U.C.C. § 3-310".
  const uccSpans = [];
  UCC_RE.lastIndex = 0;
  while ((m = UCC_RE.exec(text)) !== null) {
    results.push({
      kind: "statute",
      key: `UCC § ${m.groups.sec}`,
      span: [m.index, m.index + m[0].length],
      matchText: m[0],
    });
    uccSpans.push([m.index, m.index + m[0].length]);
  }

  // California statutes (and chained additional sections).
  STATUTE_RE.lastIndex = 0;
  while ((m = STATUTE_RE.exec(text)) !== null) {
    const s = m.index, e = m.index + m[0].length;
    if (uccSpans.some(([a, b]) => s < b && e > a)) continue; // part of a UCC cite
    const abbrev = statuteAbbrev(m);
    if (!abbrev) continue;
    const section = m.groups.sec;
    results.push({
      kind: "statute",
      key: `${abbrev} § ${section}`,
      span: [m.index, m.index + m[0].length],
      matchText: m[0],
    });
    // Chained additional sections: "§§ A, B, and C" or "sections A and B".
    // The first section grabs the code-name context; subsequent sections
    // inherit the same abbreviation. Anchored via the sticky `y` flag.
    let scanPos = m.index + m[0].length;
    while (true) {
      ADDL_SEC_RE.lastIndex = scanPos;
      const cont = ADDL_SEC_RE.exec(text);
      if (!cont || cont.index !== scanPos) break;
      results.push({
        kind: "statute",
        key: `${abbrev} § ${cont.groups.sec}`,
        span: [cont.index, cont.index + cont[0].length],
        matchText: cont[0].replace(/^\s+/, ""),
      });
      scanPos = cont.index + cont[0].length;
    }
  }

  // Federal statutes: "9 U.S.C. § 1", "42 U.S.C. § 1983".
  // Key form preserves the title number explicitly: "9 U.S.C. § 1".
  USC_RE.lastIndex = 0;
  while ((m = USC_RE.exec(text)) !== null) {
    const title = m.groups.title;
    const section = m.groups.sec;
    results.push({
      kind: "statute",
      key: `${title} U.S.C. \u00a7 ${section}`,
      span: [m.index, m.index + m[0].length],
      matchText: m[0],
    });
  }

  return results;
}

function findRuleCitations(text) {
  const results = [];
  let m;
  RULE_RE.lastIndex = 0;
  while ((m = RULE_RE.exec(text)) !== null) {
    const ruleNum = m[1];
    results.push({
      kind: "rule",
      key: `Cal. Rules of Court, rule ${ruleNum}`,
      span: [m.index, m.index + m[0].length],
      matchText: m[0],
    });
  }
  RPC_RE.lastIndex = 0;
  while ((m = RPC_RE.exec(text)) !== null) {
    const ruleNum = m[1];
    results.push({
      kind: "rule",
      key: `Cal. Rules of Prof. Conduct, rule ${ruleNum}`,
      span: [m.index, m.index + m[0].length],
      matchText: m[0],
    });
  }
  return results;
}

function findSupraCitations(text, fullCitesInOrder) {
  // First-seen short-name -> full cite (matches setdefault in pdf_linker.py).
  // Storing the whole cite (not just the key) lets us carry wlOnly/lexisOnly/
  // slipOnly through to supra references — "Smith, supra" of a WL-only
  // decision is still WL-only.
  const seen = new Map();
  for (const c of fullCitesInOrder) {
    if (c.kind === "case" && c.short && !seen.has(c.short)) {
      seen.set(c.short, c);
    }
  }

  const results = [];
  let m;
  SUPRA_RE.lastIndex = 0;
  while ((m = SUPRA_RE.exec(text)) !== null) {
    const sname = shortName(m[1]);
    if (seen.has(sname)) {
      const target = seen.get(sname);
      results.push({
        kind: "case",
        key: target.key,
        span: [m.index, m.index + m[0].length],
        matchText: m[0],
        short: sname,
        isSupra: true,
        wlOnly:    !!target.wlOnly,
        lexisOnly: !!target.lexisOnly,
        slipOnly:  !!target.slipOnly,
      });
    }
  }
  return results;
}

// ============================================================================
// Short-form (bare "X v. Y") second pass — port of _link_short_form_cases
// ============================================================================
//
// After full citations are detected, look for bare "X v. Y" references whose
// (plaintiff, defendant) normalize to one already in the registry, and emit
// link cites for those. Mirrors pdf_linker.py's behaviour where a brief
// introduces "Chillon v. Ford Motor Co., 2023 WL 3035369..." once and then
// refers to it as just "Chillon v. Ford" in surrounding discussion.

function normalizeParty(s) {
  return s.replace(/[.,;:'"\u2019]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function findShortFormCitations(text, fullCites) {
  // Build (plaintiff_norm, defendant_norm) -> full cite registry. Use
  // case-key parsing identical to pdf_linker._link_short_form_cases.
  const registry = new Map(); // key "p|d" -> { key, full }
  const allPairs = [];        // [{ pNorm, dNorm, full }] for relaxed match
  const caseKeyRe = /^(.+?)\s+v\.\s+(.+?)\s+(?:\(\d{4}\)|\d{4}\s+WL|\d{4}\s+U\.S\.\s*Dist\.\s*LEXIS|Case\s+No\.)/;
  for (const c of fullCites) {
    if (c.kind !== "case") continue;
    const km = caseKeyRe.exec(c.key);
    if (!km) continue;
    const pNorm = normalizeParty(km[1]);
    const dNorm = normalizeParty(km[2]);
    if (!pNorm || !dNorm) continue;
    const k = pNorm + "|" + dNorm;
    if (!registry.has(k)) {
      registry.set(k, { key: c.key, full: c });
      allPairs.push({ pNorm, dNorm, full: c });
    }
  }
  if (!registry.size) return [];

  // Build a span-overlap set from full cites so we don't double-link a
  // span already covered by a full citation's annotation.
  const fullSpans = fullCites
    .filter((c) => c.kind === "case")
    .map((c) => c.span);

  const results = [];
  let m;
  SHORT_FORM_RE.lastIndex = 0;
  while ((m = SHORT_FORM_RE.exec(text)) !== null) {
    const plaintiffRaw = m[1].trim();
    const defendant = m[2].trim();
    const plaintiff = plaintiffRaw.replace(SHORTFORM_LEAD_RE, "").trim();
    if (!plaintiff) continue;
    const pNorm = normalizeParty(plaintiff);
    const dNorm = normalizeParty(defendant);

    // Exact match first; then relaxed match where short defendant is a
    // prefix of registered (e.g. short "Ford" matches "Ford Motor Co.").
    let target = registry.get(pNorm + "|" + dNorm)?.full;
    if (!target) {
      for (const pair of allPairs) {
        if (pair.pNorm === pNorm &&
            (pair.dNorm.startsWith(dNorm) || dNorm.startsWith(pair.dNorm))) {
          target = pair.full;
          break;
        }
      }
    }
    if (!target) continue;

    // Compute the span of the cleaned "Plaintiff v. Defendant" portion only.
    // The raw match starts at m.index but may include a leading "In " / "See "
    // that we stripped from plaintiff. Find where the cleaned plaintiff
    // begins in the raw match text.
    const matchStartInDoc = m.index;
    const cleanedStartOffset = plaintiffRaw.length - plaintiff.length;
    const start = matchStartInDoc + cleanedStartOffset;
    const end = matchStartInDoc + m[0].length;

    // Skip if this span overlaps a full citation we already detected.
    let overlap = false;
    for (const [s, e] of fullSpans) {
      if (start < e && end > s) { overlap = true; break; }
    }
    if (overlap) continue;

    results.push({
      kind: "case",
      key: target.key,
      span: [start, end],
      matchText: text.slice(start, end),
      short: target.short,
      isShortForm: true,
      wlOnly:    !!target.wlOnly,
      lexisOnly: !!target.lexisOnly,
      slipOnly:  !!target.slipOnly,
    });
  }
  return results;
}

// ============================================================================
// Newline normalization (port of _normalize_for_detection)
// ============================================================================

// Replace single newlines (bare line wraps) with a single space while
// preserving paragraph breaks. PyMuPDF and PDF.js both emit paragraph breaks
// as \n with possible whitespace between two \n's, so we look through
// intervening whitespace when deciding. Output length matches input length
// so spans returned by detection still index into the original text.
//
// Also preserves newlines that follow a SECTION HEADING line — a short line
// like "Cases", "Statutes", "Rules", "Authorities", or "TABLE OF
// AUTHORITIES" that sits above a list of citations on a TOA page. Without
// this guard, the walk-back from "v." can grab the heading word as the
// start of the plaintiff name.
function looksLikeHeadingLine(text, lineStart, lineEnd) {
  let end = lineEnd;
  while (end > lineStart && /\s/.test(text[end - 1])) end--;
  if (end <= lineStart) return false;
  const line = text.slice(lineStart, end);
  // Headings are short. 35 chars covers "TABLE OF AUTHORITIES" (20),
  // "CALIFORNIA SUPREME COURT CASES" (30), "Statutes" (8), etc.
  if (line.length > 35) return false;
  // A real citation always contains either " v. " or a multi-digit reporter
  // volume followed by a reporter abbrev. If the line has either, it's not
  // a heading.
  if (/\sv\.\s/.test(line)) return false;
  if (/\d{1,4}\s+[A-Z]/.test(line)) return false;
  return true;
}

function normalizeForDetection(text) {
  const out = text.split("");
  const n = out.length;
  const hasNewlineWithin = (i, direction, maxWs = 3) => {
    let j = i + direction;
    let steps = 0;
    while (j >= 0 && j < n && steps <= maxWs) {
      const ch = out[j];
      if (ch === "\n" || ch === "\f") return true;
      if (!/\s/.test(ch)) return false;
      j += direction;
      steps += 1;
    }
    return false;
  };
  const prevNewline = (i) => {
    for (let j = i - 1; j >= 0; j--) {
      if (out[j] === "\n" || out[j] === "\f") return j;
    }
    return -1;
  };
  for (let i = 0; i < n; i++) {
    if (out[i] !== "\n") continue;
    if (hasNewlineWithin(i, -1) || hasNewlineWithin(i, +1)) continue;
    // Preserve newline if the preceding line looks like a section heading.
    const prev = prevNewline(i);
    if (looksLikeHeadingLine(text, prev + 1, i)) continue;
    out[i] = " ";
  }
  return out.join("");
}

export function findAllCitations(text) {
  const norm = normalizeForDetection(text);
  const fullCases = findCaseCitations(norm);
  const statutes  = findStatuteCitations(norm);
  const rules     = findRuleCitations(norm);

  // Rewrite matchText to use the original text (preserves original
  // whitespace for any downstream consumer that tries to match characters).
  for (const c of [...fullCases, ...statutes, ...rules]) {
    c.matchText = text.slice(c.span[0], c.span[1]);
  }

  const fullOrdered = [...fullCases].sort((a, b) => a.span[0] - b.span[0]);
  const supras = findSupraCitations(norm, fullOrdered);
  for (const c of supras) c.matchText = text.slice(c.span[0], c.span[1]);

  // Short-form second pass. Runs against the same normalized text and uses
  // the full case cites as its registry. Spans returned point into the
  // ORIGINAL text via the same offset-preserving normalization.
  const shortForms = findShortFormCitations(norm, fullOrdered);
  for (const c of shortForms) c.matchText = text.slice(c.span[0], c.span[1]);

  const all = [...fullCases, ...statutes, ...rules, ...supras, ...shortForms]
    .sort((a, b) => a.span[0] - b.span[0]);

  // Deduplicate overlapping spans. The short-form pass already self-filters
  // against full-cite spans, but a stray statute/rule could still overlap;
  // the longest cite at any given start position wins.
  const dedup = [];
  let lastEnd = -1;
  for (const c of all) {
    if (c.span[0] >= lastEnd) {
      dedup.push(c);
      lastEnd = c.span[1];
    }
  }
  return dedup;
}

// ============================================================================
// URL resolution (port of resolve_url)
// ============================================================================

export function resolveUrl(cite, repo, provider) {
  // WL-only and LEXIS-only override the active provider: each database has
  // its own unpublished-decision number space that the other can't serve.
  let effectiveProvider;
  if (cite.wlOnly)         effectiveProvider = "westlaw";
  else if (cite.lexisOnly) effectiveProvider = "lexis";
  else                     effectiveProvider = provider;

  const section =
    cite.kind === "case" ? "cases" :
    cite.kind === "statute" ? "statutes" : "rules";
  const entry = (repo[section] || {})[cite.key] || {};

  // Provider preference order:
  //   westlaw chosen -> westlaw_url > lexis_url > fallback_url > url > built
  //   lexis chosen   -> lexis_url > westlaw_url > fallback_url > url > built
  const order = effectiveProvider === "lexis"
    ? ["lexis_url", "westlaw_url", "fallback_url", "url"]
    : ["westlaw_url", "lexis_url", "fallback_url", "url"];
  for (const f of order) {
    if (entry[f]) return entry[f];
  }

  // Built search-URL fallback.
  if (cite.kind === "case") {
    if (cite.slipOnly) {
      // Slip cites have no reporter to anchor a direct-link URL — search by
      // case name only.
      const term = slipSearchTerm(cite.key);
      return effectiveProvider === "lexis"
        ? lexisSearchUrl(term)
        : westlawCaseUrl(term);
    }
    if (effectiveProvider === "lexis") {
      // Use the disambiguated form ("Miranda 384 U.S. 346") so a nearby
      // case in the same volume doesn't win the search.
      return lexisSearchUrl(disambiguatedLexisTerm(cite.key));
    }
    const reporterCite = caseReporterCite(cite.key) || cite.key;
    return westlawCaseUrl(reporterCite);
  }

  if (cite.kind === "statute") {
    // Model Uniform Commercial Code — provider-specific search terms:
    //   Lexis+   "U.C.C. § 3-310"
    //   Westlaw  "Unif.Commercial Code § 3-310"
    const ucc = cite.key.match(/^UCC § (.+)$/);
    if (ucc) {
      const sec = ucc[1];
      return effectiveProvider === "lexis"
        ? lexisSearchUrl(`U.C.C. § ${sec}`)
        : westlawUccUrl(`Unif.Commercial Code § ${sec}`);
    }
    return effectiveProvider === "lexis"
      ? lexisSearchUrl(lexisSearchTerm(cite.key))
      : westlawStatuteUrl(wlSearchTerm(cite.key));
  }

  // Rules
  return effectiveProvider === "lexis"
    ? lexisSearchUrl(cite.key)
    : westlawRuleUrl(cite.key);
}

// ============================================================================
// Geometry / DOM glue
// ============================================================================

function buildJoinedText(textContent) {
  // Concatenate PDF.js text items in document order. Use the item's
  // `hasEOL` flag (true when the item ends a visual line) to emit a newline
  // between items; otherwise emit a single space. This lets the citation
  // detector see paragraph breaks (visual blank lines become \n\n) and
  // treat them as walk-back boundaries.
  let joined = "";
  const itemRanges = [];
  const items = textContent.items;
  items.forEach((item, idx) => {
    if (typeof item.str !== "string") return;
    const start = joined.length;
    joined += item.str;
    itemRanges.push({ start, end: joined.length, itemIndex: idx });
    if (idx < items.length - 1) {
      joined += item.hasEOL ? "\n" : " ";
    }
  });
  return { joined, itemRanges };
}

function createLinkOverlayFromRects({ rects, url, kind, title, linkLayerDiv }) {
  for (const rect of rects) {
    if (rect.width < 2 || rect.height < 2) continue;
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.className = "citation-link";
    a.dataset.kind = kind;
    a.title = title || url;
    // Disable native drag-and-drop. Chrome treats <a href="…"> as draggable
    // by default — a mousedown on the link followed by motion is interpreted
    // as "drag this link," which shows the no-drop cursor and BLOCKS text
    // selection from starting. With many underline strips across the page
    // (especially after the short-form pass), the user often initiates a
    // drag-select with mousedown over a strip. draggable="false" alone is
    // sometimes ignored by Chrome on <a> with href, so we also preventDefault
    // on dragstart as a belt-and-suspenders fix.
    a.draggable = false;
    a.addEventListener("dragstart", (e) => e.preventDefault());
    // Cover the whole citation rect so the entire phrase is an easy click
    // target; the CSS makes it transparent with only a colored bottom border,
    // so it still reads as an underline.
    a.style.left   = `${rect.left}px`;
    a.style.top    = `${rect.top}px`;
    a.style.width  = `${rect.width}px`;
    a.style.height = `${rect.height}px`;
    linkLayerDiv.appendChild(a);
  }
}

// Build glyph-level rects for a citation by walking text-layer DOM and
// constructing a Range over the precise characters the citation occupies.
// Returns rects in coordinates relative to linkLayerDiv (not viewport),
// adjusted for scroll and the page-wrapper origin.
//
// IMPORTANT — why this doesn't use itemRanges[].itemIndex anymore:
//
//   The previous implementation looked up the rendered <span> via
//     allSpans[itemRanges[k].itemIndex]
//   assuming PDF.js renders one <span> per textContent.items entry in
//   the same order. That's not true: PDF.js 4.x's TextLayer skips
//   zero-length items, drops items it folds into adjacent runs, and
//   emits <br role="presentation"> elements for EOL items (which the
//   `allSpans = textLayerDiv.querySelectorAll("span")` collection
//   never sees). The result was a slowly accumulating drift — links
//   would land progressively further down the page from the actual
//   citation text, often a paragraph or two below.
//
//   The fix: ignore item indices entirely and resolve the citation's
//   position against the rendered DOM directly. We concatenate every
//   rendered span's textContent (in DOM order) to produce a
//   "domText" string and a parallel charOffset → {span, offsetInSpan}
//   index. We then locate the citation's literal text in domText
//   (using the citation's joined-text offset as a positional hint to
//   disambiguate when the same phrase appears more than once) and
//   build a Range over the precise glyphs.
//
//   This is robust to whatever filtering or merging PDF.js does on
//   the items list, because we trust only what we can see in the DOM.
//
//   Per-page duplicate handling: a citation that appears N times on the
//   same page (e.g. "§ 425.16" referenced throughout a section) produces
//   N entries in documentCites, each with a different joined-text span.
//   We track which DOM occurrences have already been claimed via the
//   `consumedDomStarts` Set (shared across all calls for one page) and
//   skip them — that way the second entry in documentCites lands on the
//   second occurrence in the DOM, not back on the first. Order is by
//   document position, matching reading order.

// Pull out the most distinctive portion of a citation phrase for fallback
// matching when the full phrase can't be located in the rendered DOM.
//
// Citations are detected and packaged with their full surrounding phrase
// ("Civil Code sections 3287(a)", "Smith v. Jones (2017) 13 Cal.App.5th
// 1152"), but the rendered PDF may break that phrase across line ends or
// spans in ways the normalization-and-search can't fully recover. The
// section number or reporter cite, in contrast, is dense with digits and
// punctuation and almost always sits in one span — making it a much more
// reliable secondary search target. Returns null if no distinctive
// substring can be identified.
function extractDistinctiveSubstring(needle) {
  // Statute: prefer the section number with the §-marker or "section"
  // keyword preceding it. The marker is what visually anchors the cite
  // for the reader; it's also rare enough not to false-match elsewhere
  // on the page. Capture up to two chained sections with §§.
  let m = needle.match(/§§?\s*\d+(?:\.\d+)?[a-z]?(?:\([a-z0-9]+\))*(?:\s*,\s*\d+(?:\.\d+)?[a-z]?(?:\([a-z0-9]+\))*)?/i);
  if (m) return m[0];

  // "sections? 12345" form (no § marker — e.g. when the cite is at the
  // start of a sentence: "Section 3287(a) provides...").
  m = needle.match(/sections?\s+\d+(?:\.\d+)?[a-z]?(?:\([a-z0-9]+\))*/i);
  if (m) return m[0];

  // Case: prefer the reporter cite, "VOL REPORTER PAGE" — e.g.
  // "13 Cal.App.5th 1152", "477 U.S. 242". This is unique enough on a
  // page that false matches are unlikely, and almost always survives
  // line breaks since reporter cites rarely wrap.
  m = needle.match(/\d{1,4}\s+(?:Cal|U\.S|F|S\.\s*Ct|L\.\s*Ed|P|A|N\.[YEW]|S\.[EW]|So)\.?(?:\s*(?:App|Rptr|Supp|2d|3d|4th|5th))*\.?\s*\d{1,5}/i);
  if (m) return m[0];

  // WL / LEXIS slip cites — also dense with digits.
  m = needle.match(/\d{4}\s+(?:WL|U\.S\.\s*Dist\.\s*LEXIS)\s+\d{4,8}/i);
  if (m) return m[0];

  // Rule of court: "rule 3.1300(a)".
  m = needle.match(/rules?\s+\d+(?:\.\d+)*(?:\([a-z0-9]+\))*/i);
  if (m) return m[0];

  // U.S.C.: "9 U.S.C. § 1".
  m = needle.match(/\d+\s+U\.\s*S\.\s*C\.[^a-z]*§§?\s*\d+(?:\.\d+)?[a-z]?(?:\([a-z0-9]+\))*/i);
  if (m) return m[0];

  return null;
}

function rectsForRange(start, end, _itemRanges, textLayerDiv, linkLayerDiv, citeText, consumedDomStarts) {
  const allSpans = Array.from(textLayerDiv.querySelectorAll("span"));
  if (!allSpans.length) return [];

  // Build domText (concatenation of every span's text) and a parallel
  // map from each character index in domText to its source span and
  // offset within that span. Spans in PDF.js text layers each have a
  // single text node child; we read .firstChild.data for speed.
  //
  // CRITICAL: insert a single SPACE between adjacent spans during the
  // concatenation. Without this, the rendered DOM concatenation reads
  // "Civil Codesection 3287(a)" when "Civil Code" and "section 3287(a)"
  // sit in different spans (the common case for line breaks and
  // mid-phrase splits), and the needle "Civil Code section 3287(a)"
  // — which still has its joined-text space — fails to match. The
  // single-space separator restores the word boundary the PDF reader
  // actually sees, and the `norm` function below collapses runs of
  // whitespace so this doesn't double-up where the span already starts
  // with a space.
  let domText = "";
  // spanStartOffsets[i] = where allSpans[i]'s text begins in domText.
  const spanStartOffsets = new Array(allSpans.length);
  for (let i = 0; i < allSpans.length; i++) {
    const node = allSpans[i].firstChild;
    if (i > 0) domText += " ";
    spanStartOffsets[i] = domText.length;
    if (node && typeof node.data === "string") domText += node.data;
  }

  // The PDF.js item-joined text and the DOM-concatenated text differ in
  // their inter-item separators (we add one space; joined text may add
  // a space or a newline depending on item positions). Both are then
  // collapsed by `norm` below into single-space runs, so the citation's
  // literal text — passed in as citeText — should match either way.
  if (!citeText || !citeText.length) return [];

  // Find all occurrences of citeText in domText, then pick the one
  // whose position best matches the hint. Hint mapping: positions in
  // domText vs. positions in joined text differ by roughly the number
  // of inter-item separators, but both grow monotonically with reading
  // order, so the nearest-by-position match is reliable.
  // Use a normalized comparison: collapse runs of whitespace in both
  // strings so a citation spanning a line break (joined: "Civil Code\n
  // section 3287(a)", DOM: "Civil Code   section 3287(a)") still matches.

  const matches = [];
  const norm = (s) => s.replace(/\s+/g, " ");
  const haystack = norm(domText);
  const needle = norm(citeText).trim();
  if (!needle) return [];

  // To get back from a haystack offset to a domText offset, build an
  // inverse map: haystackPos[i] = domText index that produced haystack
  // character i.
  const haystackPos = new Array(haystack.length);
  {
    let hi = 0;
    let inWs = false;
    for (let di = 0; di < domText.length; di++) {
      const ch = domText[di];
      if (/\s/.test(ch)) {
        if (!inWs) {
          if (hi < haystack.length) haystackPos[hi++] = di;
          inWs = true;
        }
      } else {
        if (hi < haystack.length) haystackPos[hi++] = di;
        inWs = false;
      }
    }
    // Trailing sentinel so we can compute end positions safely.
    while (hi < haystack.length) haystackPos[hi++] = domText.length;
  }

  let effectiveNeedle = needle;
  let searchFrom = 0;
  while (true) {
    const idx = haystack.indexOf(effectiveNeedle, searchFrom);
    if (idx < 0) break;
    matches.push(idx);
    searchFrom = idx + 1;
  }

  // Fallback: if the full citation phrase didn't match anywhere, retry
  // with the most distinctive substring. For statutes this is the
  // section identifier ("3287(a)", "§ 425.16", "§§ 1542"); for cases
  // it's the reporter portion ("13 Cal.App.5th 1152"). Both contain
  // enough digits/punctuation to be near-unique on a page, but they're
  // much more likely to sit in a single span and survive whitespace
  // quirks than the full phrase. The underline ends up covering just
  // the section/reporter rather than the whole phrase, but the link
  // still works and lands in the right place.
  if (!matches.length) {
    const fallback = extractDistinctiveSubstring(needle);
    if (fallback && fallback !== needle) {
      effectiveNeedle = norm(fallback).trim();
      searchFrom = 0;
      while (true) {
        const idx = haystack.indexOf(effectiveNeedle, searchFrom);
        if (idx < 0) break;
        matches.push(idx);
        searchFrom = idx + 1;
      }
    }
  }
  if (!matches.length) return [];

  // Filter out DOM occurrences that already received a link on this
  // page — each entry in documentCites should bind to its own visual
  // occurrence so duplicate citations on the same page all get linked.
  // Translation: matches.length is the number of times the literal
  // citation text appears on the page; documentCites contains one
  // entry per detected occurrence; the join is positional. If the
  // detection produced fewer entries than there are DOM matches (rare
  // — could happen if the detector deduplicates inside a tight range)
  // we just bind to the closest unused one. If detection produced
  // MORE entries than DOM matches (also rare; possible when a citation
  // is detected on the joined text but the underlying DOM glyphs
  // can't be located cleanly), the extra entries return [] here.
  const available = consumedDomStarts
    ? matches.filter((m) => {
        // Map haystack idx to domText idx for the consumed-set comparison
        // (consumedDomStarts stores domText offsets, not haystack offsets).
        const di = haystackPos[m];
        return !consumedDomStarts.has(di);
      })
    : matches;
  if (!available.length) return [];

  // Disambiguate by hint: pick the available match whose haystack
  // position is closest to the citation's joined-text offset. Both
  // domText and joined text grow monotonically with reading order, so
  // nearest-by-position reliably picks the correct occurrence. In
  // practice consecutive citation entries each consume the next match
  // in order, so the hint mainly matters when documentCites has gaps
  // (filtered overlaps, etc.).
  let chosenHaystackIdx;
  if (available.length === 1) {
    chosenHaystackIdx = available[0];
  } else {
    const approxHaystackTarget = Math.min(start, haystack.length - 1);
    let best = available[0];
    let bestDelta = Math.abs(available[0] - approxHaystackTarget);
    for (const m of available) {
      const d = Math.abs(m - approxHaystackTarget);
      if (d < bestDelta) { bestDelta = d; best = m; }
    }
    chosenHaystackIdx = best;
  }

  // Map back from haystack indices to domText indices. We use
  // effectiveNeedle.length (not the original needle.length) because the
  // fallback path may have substituted a shorter substring — using the
  // original length here would extend the underline past where the
  // matched text actually ends.
  const domStart = haystackPos[chosenHaystackIdx];
  const lastHIdx = Math.min(chosenHaystackIdx + effectiveNeedle.length - 1, haystack.length - 1);
  const domEndInclusive = haystackPos[lastHIdx];
  const domEnd = domEndInclusive + 1;

  // Claim this DOM occurrence so subsequent citations with the same
  // literal text are forced to bind to a different one. Keyed by
  // domStart since that's what `available`-filtering checks.
  if (consumedDomStarts) consumedDomStarts.add(domStart);

  // Resolve domStart / domEnd to (span, offset) pairs via binary search.
  const findSpan = (offset) => {
    let lo = 0, hi = allSpans.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (spanStartOffsets[mid] <= offset) { ans = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    return ans;
  };
  const startSpanIdx = findSpan(domStart);
  const endSpanIdx   = findSpan(Math.max(domEnd - 1, domStart));
  const startSpan = allSpans[startSpanIdx];
  const endSpan   = allSpans[endSpanIdx];
  if (!startSpan || !endSpan) return [];

  const startNode = startSpan.firstChild;
  const endNode   = endSpan.firstChild;
  if (!startNode || !endNode) return [];

  const startNodeLen = startNode.length || 0;
  const endNodeLen   = endNode.length   || 0;
  const startOffsetInSpan = Math.max(0, Math.min(domStart - spanStartOffsets[startSpanIdx], startNodeLen));
  const endOffsetInSpan   = Math.max(0, Math.min(domEnd   - spanStartOffsets[endSpanIdx],   endNodeLen));

  const range = document.createRange();
  try {
    range.setStart(startNode, startOffsetInSpan);
    range.setEnd(endNode,     endOffsetInSpan);
  } catch (e) {
    return [];
  }

  const clientRects = range.getClientRects();
  if (!clientRects.length) return [];

  const layerRect = linkLayerDiv.getBoundingClientRect();
  const out = [];
  for (const cr of clientRects) {
    const w = cr.width;
    const h = cr.height;
    if (w <= 0.5 || h <= 0.5) continue;
    out.push({
      left:   cr.left - layerRect.left,
      top:    cr.top  - layerRect.top,
      width:  w,
      height: h,
    });
  }
  return out;
}

// ============================================================================
// Document-wide state and per-page placement
// ============================================================================
//
// Detection needs the WHOLE document text (pdf_linker builds full_text by
// joining all pages). We mirror that: collect text up front, run detection
// once, then place overlays page-by-page.

let documentText = "";
let documentCites = [];
let pageRanges = [];          // [{ pageNumber, start, end }]
let pageJoinedItemMaps = [];  // [{ pageNumber, joinedStart, itemRanges }]
let documentRepo = {};
let documentProvider = "lexis";

export function resetDocument({ repo = {}, provider = "lexis" } = {}) {
  documentText = "";
  documentCites = [];
  pageRanges = [];
  pageJoinedItemMaps = [];
  documentRepo = repo;
  documentProvider = provider;
}

export function ingestPage(pageNumber, textContent) {
  const { joined, itemRanges } = buildJoinedText(textContent);
  const startInDoc = documentText.length;
  documentText += joined;
  // Page break the detection regex won't cross at sentence boundaries.
  // pdf_linker.py uses "\n\f\n"; we use the same so newline-stop logic works.
  documentText += "\n\f\n";
  const endInDoc = documentText.length;

  pageRanges.push({ pageNumber, start: startInDoc, end: endInDoc });
  pageJoinedItemMaps.push({ pageNumber, joinedStart: startInDoc, itemRanges });
}

export function runDetection() {
  documentCites = findAllCitations(documentText);
  return documentCites.length;
}

// Deduplicated authorities for a Table of Authorities: each detected citation
// once, with its resolved URL for the given repo/provider. Order of first
// appearance is preserved; the caller groups/sorts as needed.
export function getAuthorities(repo = {}, provider = "lexis") {
  const seen = new Map();
  for (const c of documentCites) {
    if (seen.has(c.key)) continue;
    const url = resolveUrl(c, repo, provider);
    if (!url) continue;
    seen.set(c.key, { key: c.key, kind: c.kind, url });
  }
  return [...seen.values()];
}

export function placeLinksForPage(pageNumber, textLayerDiv, linkLayerDiv) {
  const pageInfo = pageJoinedItemMaps.find((p) => p.pageNumber === pageNumber);
  if (!pageInfo) return 0;
  const { joinedStart, itemRanges } = pageInfo;

  const range = pageRanges.find((r) => r.pageNumber === pageNumber);
  const pageEnd = range ? range.end - 3 : documentText.length; // exclude "\n\f\n"

  let placed = 0;
  // Tracks which DOM character positions on this page have already been
  // assigned to a citation overlay. When the same citation text appears
  // multiple times on a page, each documentCites entry claims a different
  // DOM occurrence so all visual occurrences get linked.
  const consumedDomStarts = new Set();
  for (const cite of documentCites) {
    const [s, e] = cite.span;
    if (s < joinedStart || e > pageEnd) continue;
    const localStart = s - joinedStart;
    const localEnd = e - joinedStart;
    const citeText = documentText.slice(s, e);
    const rects = rectsForRange(localStart, localEnd, itemRanges, textLayerDiv, linkLayerDiv, citeText, consumedDomStarts);
    if (!rects.length) continue;
    const url = resolveUrl(cite, documentRepo, documentProvider);
    let kind;
    if (cite.isSupra) kind = "supra";
    else if (cite.isShortForm) kind = "shortform";
    else kind = cite.kind;
    let title;
    if (cite.isSupra) title = `${cite.short}, supra → ${cite.key}`;
    else if (cite.isShortForm) title = `${cite.short} (short form) → ${cite.key}`;
    else title = cite.key;
    createLinkOverlayFromRects({ rects, url, kind, title, linkLayerDiv });
    placed++;
  }
  return placed;
}
