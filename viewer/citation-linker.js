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
  westlawFederalStatuteUrl,
  westlawFederalSearchUrl,
  lexisSearchUrl,
  wlSearchTerm,
  lexisSearchTerm,
  caseReporterCite,
  disambiguatedLexisTerm,
  slipSearchTerm,
  federalSearchTerm,
  isRegulationKey,
} from "./code-tables.js";
import { REPORTERS_SORTED } from "./reporters.js";
import { STATUTE_CODES_SORTED } from "./statute-codes.js";
import {
  FED_SECTION,
  FEDERAL_REGULATIONS,
  FEDERAL_CODES_SORTED,
  REV_RUL_NUMBER,
  REV_RUL_BULLETIN,
  DASH_CLASS,
} from "./federal-codes.js";

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

// Probate, conservatorship, and family-law cases use "in the matter of"
// conventions instead of "X v. Y": "In re Marriage of Smith", "Estate of
// Bowles", "Guardianship of Doe", "Conservatorship of Whitley", "Adoption of
// Jones". All share the same citation-tail structure as In re, so one regex
// over a prefix alternation covers them. The prefix is NOT captured as its
// own group — that would shift the numeric group indices the consumer below
// depends on — so the consumer re-extracts it via NONV_PREFIX_RE.
// Mirrors _NONV_PREFIX in pdf_linker.py.
const NONV_PREFIX =
  // "In re" in any casing an OCR layer produces ("In Re", "IN RE").
  String.raw`In [Rr][Ee]|IN RE|` +
  String.raw`Estate of|` +
  String.raw`Guardianship of|` +
  String.raw`Conservatorship of|` +
  String.raw`Adoption of|` +
  String.raw`Marriage of`;

// Recovers which prefix matched, since the prefix isn't a numbered group.
// Anchored at start-of-match.
const NONV_PREFIX_RE = new RegExp(String.raw`^\s*(${NONV_PREFIX})\b`);

// Non-v. cases. Three alternatives:
//   CSM:      " ... (year) vol REPORTER page"
//   Bluebook: " ..., vol REPORTER page (court year)" or "... vol ... (year)"
//   WL:       " ..., [docket text], YYYY WL NNNNNN (court year)"
// The WL alternative allows up to ~80 chars of docket filler before the WL
// number — federal district-court WL cites commonly carry docket info
// between the case name and the WL number.
const INRE_RE = new RegExp(
  String.raw`\b(?:${NONV_PREFIX})\s+([A-Z][A-Za-z0-9.\-'\u2019&, ]+?)\s*` +
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
  String.raw`\b((?:(?:${NONV_PREFIX})\s+)?[A-Z][A-Za-z0-9.\-'\u2019&]+(?:\s+v\.\s+[A-Z][A-Za-z0-9.\-'\u2019&]+)?)` +
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

// A code NAMED without being cited: "Chapter 12 of Title 10 of Part 2 of the
// Code of Civil Procedure", "the Evidence Code forecloses it", "under ERISA".
// There is no section number, so this is not a citation and never becomes a
// link. It is context — the reader who then meets a bare "section 871.29" takes
// it to mean the code just named, and a carry-forward pass needs to be able to
// do the same. Without it a bare section can only inherit a code that was
// itself cited WITH a section, so a passage that names its code in prose leaves
// every later section unlinked.
//
// Used by the claude.ai content script, whose carry-forward is "the most recent
// code named before this point". The viewer's own pass (in
// findStatuteCitations) deliberately does NOT consult these: it inherits by
// section NUMBER, which is what lets it leave "Section 5 of the lease" alone on
// a page that also cites a code. Prose mentions can't tie a number to a code,
// so feeding them to that pass would sweep in exactly the references it is
// careful to skip.
const CODE_MENTION_RE = new RegExp(
  String.raw`\b(?:Cal\.\s*|California\s+)?(?:` +
  STATUTE_CODES_SORTED.map(([pat], i) => `(?<c${i}>${pat})`).join("|") + "|" +
  FEDERAL_CODES_SORTED.map((c, i) => `(?<f${i}>${c.pattern})`).join("|") +
  String.raw`)(?![A-Za-z])`,
  "gsi"
);

export function findCodeNameMentions(text) {
  const out = [];
  CODE_MENTION_RE.lastIndex = 0;
  let m;
  while ((m = CODE_MENTION_RE.exec(text)) !== null) {
    const code = statuteAbbrev(m) || federalCodeName(m);
    if (!code) continue;
    out.push({ pos: m.index, end: m.index + m[0].length, code, kind: "statute" });
  }
  return out;
}

// True when the text at `pos` begins with whitespace and then a capital
// letter — the guard every chained-section loop applies to the number it just
// matched. A chained number followed by a capitalized word is not another
// section in the list; it is the title number or lead word of the NEXT
// citation ("Treas. Reg. § 1.125, 4 Internal Revenue Code section 9801",
// "29 U.S.C. § 1132 and 42 U.S.C. § 1983"). Left unguarded the chain both
// invents a citation ("Treas. Reg. § 4") and swallows the title number the
// real following cite needs. Genuine chains end in punctuation or a lowercase
// word, so what this gives up is only a list running straight into a
// capitalized word with no punctuation between.
//
// Two reasons this is a JS check on the finished match rather than a lookahead
// inside the chain patterns. Those patterns carry the `i` flag, under which an
// inline [A-Z] matches lowercase too — it would end every chain at the first
// "and". And as a lookahead it would be satisfiable by BACKTRACKING to a
// shorter number, so "and 42 U.S.C." would quietly match just "4". Applied
// afterwards, it can only accept or reject the number the regex actually
// matched. Sticky so it anchors at `pos` without copying the document text.
const NEXT_CITE_RE = /\s+[A-Z]/y;
function startsNextCitation(text, pos) {
  NEXT_CITE_RE.lastIndex = pos;
  return NEXT_CITE_RE.test(text);
}

// ---------------------------------------------------------------------------
// Federal regulations and codes
// ---------------------------------------------------------------------------
//
// Section numbers here use FED_SECTION rather than the California shape: the
// U.S. Code and the C.F.R. both put dots and hyphens INSIDE a single section
// number ("2560.503-1", "2000e-2", "1.125-4T"), which the California pattern
// would truncate — "42 U.S.C. § 2000e-2" came out as "§ 2000e".
//
// Each of these three patterns makes the §/section marker optional in the one
// place it is safe to: when the number that follows is dotted. Every C.F.R.
// section is part-and-section, so "29 CFR 2560.503-1" is unambiguous, while
// requiring the marker everywhere else keeps "Treasury Regulations issued in
// 2004" from being read as a citation to section 2004.

// Federal statutes: "9 U.S.C. § 1", "42 U.S.C. § 2000e-2", "42 USC 1983".
// The title number precedes the code abbreviation. Allow an optional
// ", App." for appendix sections, and the annotated editions (U.S.C.A.,
// U.S.C.S.) practitioners cite from Westlaw and Lexis. PDFs sometimes render
// the abbreviation with intervening spaces, so "U. S. C." is accepted too.
const USC_RE = new RegExp(
  String.raw`\b(?<title>\d{1,3})\s+U\.?\s*S\.?\s*C\.?(?:\s*[AS]\.?)?(?![A-Za-z])` +
  String.raw`(?:,?\s*App\.)?` +
  String.raw`\s*` +
  String.raw`(?:(?:§§?|sections?|secs?\.?)\s*|(?=\d))` +
  `(?<sec>${FED_SECTION})`,
  "gi"
);

// Federal regulations by title: "29 C.F.R. § 2560.503-1", "45 CFR 164.512",
// and part-level cites ("40 C.F.R. pt. 60", "29 C.F.R. Part 1910"), which
// name a whole part and carry no section number at all.
const CFR_RE = new RegExp(
  String.raw`\b(?<title>\d{1,3})\s+C\.?\s*F\.?\s*R\.?(?![A-Za-z])` +
  String.raw`,?\s*` +
  String.raw`(?:(?:pts?\.|parts?)\s*(?<part>\d+)` +
  String.raw`|(?:(?:§§?|sections?|secs?\.?)\s*|(?=\d+\.))` +
  `(?<sec>${FED_SECTION}))`,
  "gi"
);

// Named regulation series, where the agency name stands in for the C.F.R.
// title: "Treas. Reg. § 1.125". The optional qualifier is captured because
// "Prop." changes where the regulation lives — a proposed regulation is not
// in the C.F.R. yet — and so has to survive into the key.
const FED_REG_RE = new RegExp(
  String.raw`\b(?:(?<qual>Prop(?:osed)?|Temp(?:orary)?)\.?\s*)?` +
  `(?:${FEDERAL_REGULATIONS.map((r, i) => `(?<g${i}>${r.pattern})`).join("|")})` +
  String.raw`,?\s*` +
  String.raw`(?:(?:§§?|sections?|secs?\.?)\s*|(?=\d+\.))` +
  `(?<sec>${FED_SECTION})`,
  "gi"
);

function federalRegName(match) {
  for (let i = 0; i < FEDERAL_REGULATIONS.length; i++) {
    if (match.groups[`g${i}`]) return FEDERAL_REGULATIONS[i].name;
  }
  return null;
}

// Named federal codes and acts: "Internal Revenue Code section 9801(f)",
// "I.R.C. § 61", "ERISA § 701", "Bankruptcy Code § 362". The §/section marker
// is REQUIRED here — an act's name is ordinary enough prose ("the Securities
// Exchange Act of 1934 requires...") that a bare number after it would be
// read as a citation far too often.
const FED_CODE_RE = new RegExp(
  String.raw`\b(?:${FEDERAL_CODES_SORTED.map((c, i) => `(?<f${i}>${c.pattern})`).join("|")})` +
  String.raw`(?![A-Za-z])` +
  String.raw`,?\s*` +
  String.raw`(?:§§?|sections?|secs?\.?)\s*` +
  `(?<sec>${FED_SECTION})`,
  "gi"
);

function federalCodeName(match) {
  for (let i = 0; i < FEDERAL_CODES_SORTED.length; i++) {
    if (match.groups[`f${i}`]) return FEDERAL_CODES_SORTED[i].name;
  }
  return null;
}

// IRS revenue rulings: "Rev. Rul. 2013-17", "Revenue Ruling 2013-17",
// "Rev. Rul. 83-137, 1983-2 C.B. 41". The plural forms ("Rev. Ruls.",
// "Revenue Rulings") are accepted so a list reads naturally; the chained
// numbers after the first are picked up by REV_RUL_ADDL_RE below.
//
// Unlike a statute or a regulation, a revenue ruling has no section number —
// its number IS the citation — so nothing here uses FED_SECTION and nothing
// carries over to a later bare reference.
const REV_RUL_RE = new RegExp(
  String.raw`\bRev(?:enue)?\.?\s*Rul(?:ings?|ing|s)?\.?\s*` +
  `(?:Nos?\\.?\\s*)?` +
  `(?<num>${REV_RUL_NUMBER})` +
  `(?:${REV_RUL_BULLETIN})?`,
  "gi"
);

// Chained rulings: "Rev. Ruls. 2003-102, 2003-103 and 2004-45". Each carries
// its own bulletin cite if the writer gave one.
const REV_RUL_ADDL_RE = new RegExp(
  String.raw`\s*(?:,\s*and|,|\s+and)\s+` +
  `(?<num>${REV_RUL_NUMBER})` +
  `(?:${REV_RUL_BULLETIN})?`,
  "yi"
);

// Canonicalize a ruling number for the key: whatever dash the PDF used becomes
// an ASCII hyphen, so "Rev. Rul. 96–55" and "Rev. Rul. 96-55" are one
// authority in the Table of Authorities rather than two.
const REV_RUL_DASH_RE = new RegExp(DASH_CLASS, "g");
function normalizeRevRulNum(raw) {
  return raw.replace(/\s+/g, "").replace(REV_RUL_DASH_RE, "-");
}

// Chained additional sections after a federal cite — the federal counterpart
// of ADDL_SEC_RE: "29 C.F.R. §§ 2560.503-1, 2560.503-2", "26 U.S.C. §§ 9801
// and 9802". Anchored to the previous match via the sticky flag.
const FED_ADDL_SEC_RE = new RegExp(
  String.raw`\s*(?:,\s*and|,|\s+and)\s+` +
  `(?<sec>${FED_SECTION})`,
  "yi"
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

// A section reference carrying no code name of its own: "§ 425.16",
// "section 1542", "§§ 1542, 1543". Meaningless in isolation — it is resolved
// only by the carry-over pass in findStatuteCitations, which hands it the code
// that the same section number was already given earlier on the same page.
// The optional hyphenated tail keeps a model-UCC section ("§ 3-310") whole
// instead of capturing a bare "3".
const BARE_SEC_RE = new RegExp(
  String.raw`(?:§§?|\b(?:sections?|secs?\.?))\s*` +
  String.raw`(?<sec>\d+(?:\.\d+)*[a-z]{0,3}(?:-\d+[a-z]{0,3})?(?:\([a-z0-9]+\))*)`,
  "gi"
);

// Cal. Rules of Court rule N.N(letter)(digit)…
const RULE_RE = new RegExp(
  String.raw`\b(?:Cal\.\s*Rules?\s*of\s*Court|California\s*Rules?\s*of\s*Court),?\s*` +
  String.raw`rules?\s+(\d+(?:\.\d+)*(?:\([a-z0-9]+\))*)`,
  "gi"
);

// Rules of Professional Conduct: "Cal. Rules of Prof. Conduct, rule 1.9",
// "Rules of Professional Conduct 3.7". Both forms are current, and the one
// carrying "rule" has to be accepted here so that a named professional-conduct
// rule claims its own span before the bare-rule pass below, which would
// otherwise read the number as a rule of court. A comma is allowed only in
// front of that "rule": without it, "Conduct, 9 Cal.4th 275" would read as a
// rule number rather than the case cite it is.
const RPC_RE = new RegExp(
  String.raw`\b(?:Cal(?:ifornia)?\.?\s+)?Rules?\s+of\s+(?:Prof(?:essional)?\.?\s+)?Conduct` +
  String.raw`(?:,?\s*rules?\s+|\s+)` +
  String.raw`(\d+(?:\.\d+)*(?:\([a-z0-9]+\))*)`,
  "gi"
);

// A rule reference that names no rule set of its own: "rule 3.1350",
// "Rule 8.204(a)(1)(C)". Read as a California rule of court — that is what an
// unqualified "rule" means in a California brief. Every rule of court is
// numbered with a dot (2.100, 3.1350, 8.204), and requiring the dot is what
// keeps a federal "rule 12(b)(6)" or a contract's "rule 5" out of the net.
const BARE_RULE_RE = new RegExp(
  String.raw`\brules?\s+(\d+(?:\.\d+)+(?:\([a-z0-9]+\))*)`,
  "gi"
);

// The run of words a rule-set name would occupy if one were there, anchored
// to the text immediately before a bare rule reference. Only an adjacent
// qualifier can disclaim California: the same word a sentence away cannot.
const RULE_QUALIFIER_RE = /(?:[A-Za-z][A-Za-z.'\u2019]*[\s,]+){0,5}$/;

// A qualifier naming somebody else's rules — "Federal Rules of Civil
// Procedure, rule 26.1", "local rule 3.57", "Rules of Professional Conduct,
// rule 1.9" where the set was named too far back for RPC_RE to reach. The
// reference is left unlinked rather than guessed at: a missed link costs the
// reader a click, a wrong one sends them to the wrong rule.
const FOREIGN_RULE_WORD_RE =
  /\b(?:fed|federal|f\.r\.|local|prof|professional|conduct|evid|evidence|bankr|bankruptcy|appellate|arbitration|jams|aaa)\b/i;

// CACI — Judicial Council of California Civil Jury Instructions.
//   "CACI No. 3710", "CACI 3710", "CACI Nos. 3710, 3711",
//   "(CACI) No. 3903A", "CACI No. VF-3900" (verdict form).
// Instruction numbers are 3–4 digits with an optional letter suffix (3903A);
// verdict forms carry a "VF-" prefix. The distinctive "CACI" token keeps the
// false-positive risk low, so a bare "CACI 3710" (no "No.") is accepted too.
const CACI_RE = new RegExp(
  String.raw`\bCACI\b[\s),]*(?:Nos?\.?\s*)?` +
  String.raw`(?<num>(?:VF[-\s]?)?\d{3,4}[A-Z]?)`,
  "gi"
);
// Chained additional instruction numbers after a primary CACI match:
//   "CACI Nos. 3710, 3711, and 3712". Anchored at the previous match's end
//   via the sticky (`y`) flag, exactly like ADDL_SEC_RE for statutes.
const CACI_ADDL_RE = new RegExp(
  String.raw`\s*(?:,\s*and|,|\s+and)\s+` +
  String.raw`(?<num>(?:VF[-\s]?)?\d{3,4}[A-Z]?)`,
  "yi"
);

// Normalize a captured CACI number: strip whitespace, upper-case the optional
// letter suffix, and canonicalize a verdict-form prefix to "VF-".
function normalizeCaciNum(raw) {
  return raw.replace(/\s+/g, "").toUpperCase().replace(/^VF-?/, "VF-");
}

// "v." anchored — walk back from each occurrence to identify the plaintiff.
const ANCHOR_RE = /(?<=\s)v\.(?=\s)/g;

// Bare "X v. Y" (or "X v. Y, Inc.") — second-pass linker for short-form
// references to cases already cited in long form elsewhere in the document.
// Plaintiff: uppercase-leading token with internal letters/digits/'-./&.
// Defendant: same, plus optional ", Inc." / ", LLC" / etc.
const _PARTY_TOKEN = String.raw`[A-Z][A-Za-z0-9.\-'\u2019&]*`;
// A defendant may open with a number — "9th Street Market Lofts, LLC",
// "3M Co.", "7-Eleven, Inc." — so its first token accepts digits followed by
// a letter (or a hyphen and a capital). Plaintiffs keep the capital-only
// rule: a leading number there is nearly always stray text, not a party.
const _DEF_FIRST_TOKEN =
  String.raw`(?:[A-Z]|\d+(?:[A-Za-z]|[\-\u2010-\u2015][A-Z]))[A-Za-z0-9.\-'\u2019&]*`;
const SHORT_FORM_RE = new RegExp(
  String.raw`\b(${_PARTY_TOKEN}(?:\s+${_PARTY_TOKEN}){0,3})\s+v\.\s+` +
  String.raw`(${_DEF_FIRST_TOKEN}(?:\s+${_PARTY_TOKEN}){0,4}(?:,\s*(?:Inc|LLC|LLP|Ltd|Corp|Co)\.?)?)`,
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

    // A closing quote HIDES the sentence-ending mark from both boundary tests
    // below. A quotation that ends a sentence reads `English.”`, whose last
    // character is the quote, not the period — so `tok.endsWith(".")` was false,
    // the walk-back sailed on through the sentence before the citation, and the
    // whole sentence came back as the case name:
    //     "An arbitration provision is procedurally unconscionable where it
    //      “was neither provided … written English.” (Penilla v. Westmont Corp.
    //      (2016) 3 Cal.App.5th 205, 209.)"
    // Strip the closers for the tests only: the token itself is recorded and
    // measured unchanged, so a possessive like `Farmers'` is unaffected.
    const tokCore = tok.replace(/[”’"')\]]+$/, "");
    const hadCloser = tokCore.length < tok.length;
    if (!tokCore) {
      // Nothing but closing punctuation — a quotation ended right here.
      if (tokens.length) break;
      return null;
    }

    const lastChar = tokCore[tokCore.length - 1];
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
      tokCore.endsWith(".") &&
      tokCore.length > 1 &&
      tokCore[tokCore.length - 2] >= "a" && tokCore[tokCore.length - 2] <= "z"
    ) {
      // `Co.”` — the closing quote says the QUOTATION ended here, so this is a
      // sentence boundary even though "Co." is exactly the abbreviation the
      // allowance below exists for. That allowance is for abbreviations INSIDE
      // a party name, and a name token is never followed by a closing quote.
      if (hadCloser) break;
      const inner = tokCore.replace(/\.+$/, "");
      const isShortCapAbbrev =
        inner.length >= 1 && inner.length <= 6 &&
        inner[0] >= "A" && inner[0] <= "Z";
      if (!isShortCapAbbrev && !ABBREV_OK.has(tokCore.toLowerCase())) break;
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

// Strip non-v. case-name prefixes ("In re", "Estate of", "Conservatorship
// of", etc.) plus "Ex parte" and "People v." so the short name is the
// distinguishing subject ("Whitley", not "Conservatorship"). The prefix group
// REPEATS ("+") because prefixes nest: "In re Marriage of Smith" is "In re" +
// "Marriage of" + "Smith", and a single strip leaves "Marriage of Smith",
// whose first word makes every Marriage-of case share the short name
// "Marriage" and never match its supra cites. Mirrors _short_name in
// pdf_linker.py.
const SHORT_NAME_PREFIX_RE = new RegExp(
  String.raw`^(?:(?:${NONV_PREFIX})\s+|Ex parte\s+|People v\.\s+)+`, "i");

function shortName(plaintiff) {
  let p = plaintiff.trim();
  p = p.replace(SHORT_NAME_PREFIX_RE, "");
  const parts = p.split(/\s+/);
  return parts[0] ? parts[0].replace(/[,.;:]+$/, "") : p;
}

// A parenthetical directly after a full citation that ANNOUNCES the short
// name the rest of the document will use: "... 222 Cal.App.4th 924 (Market
// Lofts)", "(hereafter Market Lofts)", '("Market Lofts")'. Most trailing
// parentheticals are something else entirely — subsequent history, an
// explanatory phrase, "citation omitted" — so anything carrying the
// vocabulary of those is rejected. Returns the announced name, or null.
const PAREN_NAME_RE = /^\s*\((?:here(?:in)?after,?\s+)?["'\u201c\u2018]?([A-Z][A-Za-z0-9.'\u2019&\-]*(?:\s+[A-Za-z0-9.'\u2019&\-]+){0,4})["'\u201d\u2019]?\)/;
const PAREN_NAME_REJECT_RE =
  /\b(?:omitted|added|emphasis|italics|quotation|quotations|citation|citations|internal|cleaned|banc|curiam|plurality|opn|dictum|dicta|modified|denied|granted|overruled|disapproved|superseded|affd|revd|aff|rev|cert|accord|quoting|citing|holding|noting|finding|conc|dis|see|supra|infra|fn|footnote|original|italic)\b/i;

function parentheticalShortName(text, endOfCite) {
  const m = PAREN_NAME_RE.exec(text.slice(endOfCite, endOfCite + 90));
  if (!m) return null;
  const name = m[1].replace(/[,.;:]+$/, "").trim();
  if (name.length < 3) return null;
  if (/\d/.test(name)) return null;              // "(2014)", "(9th Cir. 2015)"
  if (PAREN_NAME_REJECT_RE.test(name)) return null;
  return name;
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
    // A defendant normally opens with a capital, but plenty of real parties
    // open with a number — "9th Street Market Lofts, LLC", "3M Co.", "21st
    // Century Ins. Co.", "99 Cents Only Stores". Accept a leading digit too,
    // still requiring a capitalized word somewhere in the name so stray
    // numeric text between "v." and a reporter can't pass as a party.
    if (!defendantText) continue;
    if (!/^[A-Z0-9]/.test(defendantText) || !/[A-Z]/.test(defendantText)) continue;
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
      plaintiff: plaintiffClean,
      defendant: defendantClean,
      caseName: `${plaintiffClean} v. ${defendantClean}`,
      // A court that means to be short-cited says so right after the full
      // cite: "... 222 Cal.App.4th 924 (Market Lofts)". That parenthetical
      // is the name the rest of the document will italicize.
      parenName: parentheticalShortName(text, matchEnd),
      // WL-only unpublished decisions exist only on Westlaw.
      wlOnly:    kind === "wl",
      // U.S. Dist. LEXIS database numbers are Lexis-only.
      lexisOnly: kind === "lexis",
      // Slip cites have no reporter cite — fall back to name search.
      slipOnly:  kind === "slip",
    });
  }

  // In re / Estate of / Guardianship of / Conservatorship of / Adoption of /
  // Marriage of cases (no v. anchor)
  INRE_RE.lastIndex = 0;
  while ((m = INRE_RE.exec(text)) !== null) {
    const name = m[1].replace(/\s+/g, " ").trim();
    // Recover which prefix matched. INRE_RE doesn't capture the prefix as a
    // numbered group (that would shift the numbered captures the branch logic
    // below depends on), so re-extract it from the matched text.
    const prefixM = NONV_PREFIX_RE.exec(m[0]);
    const prefix = prefixM ? prefixM[1] : "In re";
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
      const fullName = `${prefix} ${name}`;
      const key = `${fullName} ${wlYear} WL ${wlNum}`;
      results.push({
        kind: "case",
        key,
        span: [m.index, m.index + m[0].length],
        matchText: m[0],
        short: shortName(fullName),
        caseName: fullName,
        parenName: parentheticalShortName(text, m.index + m[0].length),
        wlOnly,
      });
      continue;
    }
    const repCompact = reporter.replace(/\s+/g, "");
    const fullName = `${prefix} ${name}`;
    const key = `${fullName} (${year}) ${vol} ${repCompact} ${page}`;
    results.push({
      kind: "case",
      key,
      span: [m.index, m.index + m[0].length],
      matchText: m[0],
      short: shortName(fullName),
      caseName: fullName,
      parenName: parentheticalShortName(text, m.index + m[0].length),
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
      caseName: name,
      parenName: parentheticalShortName(text, m.index + m[0].length),
    });
  }

  return results;
}

// Split a statute key ("CCP § 425.16", "9 U.S.C. § 1", "UCC § 3-310") into
// its code prefix and its section number.
function splitStatuteKey(key) {
  const m = key.match(/^(.*) \u00a7 (.+)$/);
  return m ? { prefix: m[1], section: m[2] } : null;
}

// A section number stripped of its subparts: "425.16(b)(1)" -> "425.16". Two
// references to one statute differ only in how deep they point, so subparts
// are dropped when matching a bare reference against a code-named one.
function baseSectionNumber(section) {
  return section.replace(/\([^)]*\)/g, "").trim().toLowerCase();
}

// Page lookup for offsets into the detection text. ingestPage separates pages
// with "\n\f\n", so the form feeds preceding an offset count the page breaks
// crossed to reach it. Text handed straight to findAllCitations (tests,
// single-page callers) has none, leaving the whole string on page 0.
function makePageLookup(text) {
  const breaks = [];
  for (let i = 0; i < text.length; i++) if (text[i] === "\f") breaks.push(i);
  if (!breaks.length) return () => 0;
  return (offset) => {
    let lo = 0, hi = breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (breaks[mid] < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}

function findStatuteCitations(text) {
  const results = [];
  let m;

  // Federal regulations and codes run FIRST. Their section numbers are wider
  // than the California shape (dots and hyphens inside one number), so a
  // California pass that reached "26 C.F.R. § 1.125" or "42 U.S.C. § 2000e-2"
  // first would carve a truncated section out of the middle of it. Every
  // federal span is recorded and the later passes skip anything overlapping.
  const fedSpans = [];

  // Push a federal citation plus any sections chained onto it ("§§ 9801,
  // 9802"), all inheriting the same code prefix. Mirrors what the California
  // pass does with ADDL_SEC_RE. Returns the scan position to resume from, so
  // the caller's regex doesn't re-match text a chain already consumed.
  const pushFederal = (kind, prefix, section, start, end, matched) => {
    results.push({
      kind,
      key: `${prefix} § ${section}`,
      span: [start, end],
      matchText: matched,
    });
    fedSpans.push([start, end]);
    let scanPos = end;
    while (true) {
      FED_ADDL_SEC_RE.lastIndex = scanPos;
      const cont = FED_ADDL_SEC_RE.exec(text);
      if (!cont || cont.index !== scanPos) break;
      const contEnd = cont.index + cont[0].length;
      if (startsNextCitation(text, contEnd)) break;
      results.push({
        kind,
        key: `${prefix} § ${cont.groups.sec}`,
        span: [cont.index, contEnd],
        matchText: cont[0].replace(/^\s+/, ""),
      });
      fedSpans.push([cont.index, contEnd]);
      scanPos = contEnd;
    }
    return scanPos;
  };

  // IRS revenue rulings. Run before the section-based passes so the bulletin
  // tail ("1983-2 C.B. 41") is inside a claimed span and nothing else can
  // carve a citation out of its numbers.
  REV_RUL_RE.lastIndex = 0;
  while ((m = REV_RUL_RE.exec(text)) !== null) {
    let end = m.index + m[0].length;
    results.push({
      kind: "guidance",
      key: `Rev. Rul. ${normalizeRevRulNum(m.groups.num)}`,
      span: [m.index, end],
      matchText: m[0],
    });
    fedSpans.push([m.index, end]);
    // "Rev. Ruls. 2003-102, 2003-103 and 2004-45" — each later number is its
    // own ruling, inheriting only the "Rev. Rul." label.
    while (true) {
      REV_RUL_ADDL_RE.lastIndex = end;
      const cont = REV_RUL_ADDL_RE.exec(text);
      if (!cont || cont.index !== end) break;
      const contEnd = cont.index + cont[0].length;
      if (startsNextCitation(text, contEnd)) break;
      results.push({
        kind: "guidance",
        key: `Rev. Rul. ${normalizeRevRulNum(cont.groups.num)}`,
        span: [cont.index, contEnd],
        matchText: cont[0].replace(/^\s+/, ""),
      });
      fedSpans.push([cont.index, contEnd]);
      end = contEnd;
    }
    REV_RUL_RE.lastIndex = end;
  }

  // "29 C.F.R. § 2560.503-1", "40 C.F.R. pt. 60".
  CFR_RE.lastIndex = 0;
  while ((m = CFR_RE.exec(text)) !== null) {
    const prefix = `${m.groups.title} C.F.R.`;
    const start = m.index, end = m.index + m[0].length;
    if (m.groups.part !== undefined) {
      // A part cite names a whole part, so there is no section to chain onto.
      results.push({
        kind: "regulation",
        key: `${prefix} pt. ${m.groups.part}`,
        span: [start, end],
        matchText: m[0],
      });
      fedSpans.push([start, end]);
      continue;
    }
    CFR_RE.lastIndex = pushFederal("regulation", prefix, m.groups.sec, start, end, m[0]);
  }

  // "Treas. Reg. § 1.125", "Prop. Treas. Reg. § 1.125-1". The qualifier stays
  // in the key: a proposed regulation is not in the C.F.R., and the URL
  // builder has to be able to tell.
  FED_REG_RE.lastIndex = 0;
  while ((m = FED_REG_RE.exec(text)) !== null) {
    const start = m.index, end = m.index + m[0].length;
    if (fedSpans.some(([a, b]) => start < b && end > a)) continue;
    const name = federalRegName(m);
    if (!name) continue;
    const qual = m.groups.qual
      ? (/^prop/i.test(m.groups.qual) ? "Prop. " : "Temp. ")
      : "";
    FED_REG_RE.lastIndex =
      pushFederal("regulation", `${qual}${name}`, m.groups.sec, start, end, m[0]);
  }

  // "Internal Revenue Code section 9801(f)", "ERISA § 701".
  FED_CODE_RE.lastIndex = 0;
  while ((m = FED_CODE_RE.exec(text)) !== null) {
    const start = m.index, end = m.index + m[0].length;
    if (fedSpans.some(([a, b]) => start < b && end > a)) continue;
    const name = federalCodeName(m);
    if (!name) continue;
    FED_CODE_RE.lastIndex =
      pushFederal("statute", name, m.groups.sec, start, end, m[0]);
  }

  // "9 U.S.C. § 1", "42 U.S.C. § 2000e-2". The key keeps the title number
  // explicit: "9 U.S.C. § 1".
  USC_RE.lastIndex = 0;
  while ((m = USC_RE.exec(text)) !== null) {
    const start = m.index, end = m.index + m[0].length;
    if (fedSpans.some(([a, b]) => start < b && end > a)) continue;
    USC_RE.lastIndex =
      pushFederal("statute", `${m.groups.title} U.S.C.`, m.groups.sec, start, end, m[0]);
  }

  // Model Uniform Commercial Code (hyphenated section). Detected before the
  // general California pass below so that pass can skip the partial "... § 3"
  // it would otherwise grab from "U.C.C. § 3-310".
  const uccSpans = [];
  UCC_RE.lastIndex = 0;
  while ((m = UCC_RE.exec(text)) !== null) {
    const s0 = m.index, e0 = m.index + m[0].length;
    if (fedSpans.some(([a, b]) => s0 < b && e0 > a)) continue;
    results.push({
      kind: "statute",
      key: `UCC § ${m.groups.sec}`,
      span: [s0, e0],
      matchText: m[0],
    });
    uccSpans.push([s0, e0]);
  }

  // California statutes (and chained additional sections).
  STATUTE_RE.lastIndex = 0;
  while ((m = STATUTE_RE.exec(text)) !== null) {
    const s = m.index, e = m.index + m[0].length;
    if (uccSpans.some(([a, b]) => s < b && e > a)) continue; // part of a UCC cite
    if (fedSpans.some(([a, b]) => s < b && e > a)) continue; // part of a federal cite
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
      if (startsNextCitation(text, cont.index + cont[0].length)) break;
      results.push({
        kind: "statute",
        key: `${abbrev} § ${cont.groups.sec}`,
        span: [cont.index, cont.index + cont[0].length],
        matchText: cont[0].replace(/^\s+/, ""),
      });
      scanPos = cont.index + cont[0].length;
    }
  }

  // Carry-over: once a page ties a section number to a code name, later bare
  // references to that number on the same page belong to that code.
  //   "Code of Civil Procedure section 425.16 ... § 425.16(b) ... section 425.16"
  // The scope is deliberately tight. Only references AFTER the code-named one
  // inherit, only within the one page, and only when that page ties the number
  // to a single code — a page that gives the same number two different codes
  // leaves its bare references unlinked rather than guessing between them. A
  // bare reference that carries its own code name was already matched above,
  // so it never reaches this pass.
  const pageOf = makePageLookup(text);
  const namedSpans = results.map((r) => r.span);
  // "page|section" -> { prefix, from } for the first code-named occurrence,
  // or null once a second code claims the same number on that page.
  const byNumber = new Map();
  for (const r of results) {
    const parts = splitStatuteKey(r.key);
    if (!parts) continue;
    const slot = `${pageOf(r.span[0])}|${baseSectionNumber(parts.section)}`;
    const prior = byNumber.get(slot);
    if (prior === undefined) {
      byNumber.set(slot, { prefix: parts.prefix, from: r.span[1] });
    } else if (prior && prior.prefix !== parts.prefix) {
      byNumber.set(slot, null);
    }
  }
  if (byNumber.size) {
    BARE_SEC_RE.lastIndex = 0;
    while ((m = BARE_SEC_RE.exec(text)) !== null) {
      const s = m.index, e = m.index + m[0].length;
      if (namedSpans.some(([a, b]) => s < b && e > a)) continue; // has its own code
      const slot = `${pageOf(s)}|${baseSectionNumber(m.groups.sec)}`;
      const owner = byNumber.get(slot);
      if (!owner || s < owner.from) continue;
      const key = `${owner.prefix} \u00a7 ${m.groups.sec}`;
      const kind = isRegulationKey(key) ? "regulation" : "statute";
      results.push({
        kind,
        key,
        span: [s, e],
        matchText: m[0],
        inheritedCode: true,
      });
      // Chained sections after a carried-over reference ("§§ 1542, 1543") inherit
      // the same code, exactly as they do after a code-named cite.
      let scanPos = e;
      while (true) {
        ADDL_SEC_RE.lastIndex = scanPos;
        const cont = ADDL_SEC_RE.exec(text);
        if (!cont || cont.index !== scanPos) break;
        if (startsNextCitation(text, cont.index + cont[0].length)) break;
        results.push({
          kind,
          key: `${owner.prefix} \u00a7 ${cont.groups.sec}`,
          span: [cont.index, cont.index + cont[0].length],
          matchText: cont[0].replace(/^\s+/, ""),
          inheritedCode: true,
        });
        scanPos = cont.index + cont[0].length;
      }
      BARE_SEC_RE.lastIndex = scanPos;
    }
  }

  return results;
}

// Strip the parenthetical subparts from a rule number, leaving only the
// overall rule ("3.1300(a)(1)" -> "3.1300"). The link/search must target the
// rule as a whole: including a subpart derails the Westlaw/Lexis search.
function baseRuleNumber(ruleNum) {
  const m = ruleNum.match(/^\d+(?:\.\d+)*/);
  return m ? m[0] : ruleNum;
}

// The two California rule sets a bare rule reference can belong to.
const RULES_OF_COURT = "Cal. Rules of Court";
const RULES_OF_PROF_CONDUCT = "Cal. Rules of Prof. Conduct";

function findRuleCitations(text) {
  const results = [];
  // Every rule that named its own set, for the carry-over pass below.
  const named = [];
  let m;
  RULE_RE.lastIndex = 0;
  while ((m = RULE_RE.exec(text)) !== null) {
    // Link to the overall rule only — drop any (a)(1)-style subparts, which
    // otherwise break the search. The highlighted span still covers the full
    // citation, subparts included.
    const ruleNum = baseRuleNumber(m[1]);
    const span = [m.index, m.index + m[0].length];
    results.push({
      kind: "rule",
      key: `${RULES_OF_COURT}, rule ${ruleNum}`,
      span,
      matchText: m[0],
    });
    named.push({ set: RULES_OF_COURT, num: ruleNum, span });
  }
  RPC_RE.lastIndex = 0;
  while ((m = RPC_RE.exec(text)) !== null) {
    // Same as the Rules of Court: link to the overall rule, not the subpart.
    const ruleNum = baseRuleNumber(m[1]);
    const span = [m.index, m.index + m[0].length];
    results.push({
      kind: "rule",
      key: `${RULES_OF_PROF_CONDUCT}, rule ${ruleNum}`,
      span,
      matchText: m[0],
    });
    named.push({ set: RULES_OF_PROF_CONDUCT, num: ruleNum, span });
  }

  // Carry-over, the rule counterpart of the statute pass above. A page that
  // ties a rule number to a rule set hands that set to the page's bare
  // references to the same number: "Rules of Professional Conduct, rule 1.9
  // ... rule 1.9(a)" is one rule cited twice, not a conduct rule and a rule of
  // court. A page that gives one number two different sets leaves its bare
  // references unlinked rather than guessing between them.
  //
  // Unlike the statute pass this runs in both directions within the page. The
  // statute pass carries forward only because a bare section it cannot place
  // goes unlinked, which costs nothing; a bare rule this pass cannot place is
  // read as a rule of court, so declining to look backwards does not withhold
  // a guess, it makes a worse one.
  const pageOf = makePageLookup(text);
  // "page|number" -> { set }, or null once a second set claims the same
  // number on that page.
  const byNumber = new Map();
  // page -> { court: boolean, rpcFrom: number } — which sets the page names,
  // and where its first professional-conduct cite ends.
  const pageSets = new Map();
  // Every number the DOCUMENT ties to the rules of court, wherever it says so.
  const courtNumbers = new Set();
  for (const r of named) {
    const page = pageOf(r.span[0]);
    const slot = `${page}|${r.num}`;
    const prior = byNumber.get(slot);
    if (prior === undefined) byNumber.set(slot, { set: r.set });
    else if (prior && prior.set !== r.set) byNumber.set(slot, null);

    let ctx = pageSets.get(page);
    if (!ctx) pageSets.set(page, (ctx = { court: false, rpcFrom: Infinity }));
    if (r.set === RULES_OF_COURT) {
      ctx.court = true;
      courtNumbers.add(r.num);
    } else {
      ctx.rpcFrom = Math.min(ctx.rpcFrom, r.span[1]);
    }
  }

  // The set a bare reference falls back to when its own number was never
  // named on the page. Normally the rules of court — but a page that names
  // the Rules of Professional Conduct and never once names the rules of court
  // is a page arguing conduct, and its bare rules are read that way.
  //
  // This is the weaker of the two inferences: the number itself was never
  // named, so the page's subject is all there is to go on. It is fenced
  // accordingly. It runs forward only, from the first conduct cite on the
  // page, so a rule cited before the subject came up keeps the default; and a
  // number the document ties to the rules of court anywhere keeps that set,
  // since a disqualification motion still notices its own hearing under rule
  // 3.1300.
  function fallbackSet(page, num, start) {
    const ctx = pageSets.get(page);
    if (ctx && !ctx.court && start >= ctx.rpcFrom && !courtNumbers.has(num)) {
      return RULES_OF_PROF_CONDUCT;
    }
    return RULES_OF_COURT;
  }

  // Bare references — "rule 3.1350" with no rule set named. California briefs
  // cite the rules of court this way as a matter of course, so an unqualified
  // rule number is taken to be one unless the page says otherwise. Spans
  // already claimed above are skipped: the "rule 1.9" inside a
  // professional-conduct cite is that cite's, and the "rule 3.1300" inside
  // "Cal. Rules of Court, rule 3.1300" is already linked.
  const namedSpans = named.map((r) => r.span);
  BARE_RULE_RE.lastIndex = 0;
  while ((m = BARE_RULE_RE.exec(text)) !== null) {
    const s = m.index, e = m.index + m[0].length;
    if (namedSpans.some(([a, b]) => s < b && e > a)) continue;
    const lead = text.slice(Math.max(0, s - 60), s);
    if (FOREIGN_RULE_WORD_RE.test(lead.match(RULE_QUALIFIER_RE)[0])) continue;
    const num = baseRuleNumber(m[1]);
    const page = pageOf(s);
    const owner = byNumber.get(`${page}|${num}`);
    if (owner === null) continue; // one number, two sets on the page
    const set = owner ? owner.set : fallbackSet(page, num, s);
    results.push({
      kind: "rule",
      key: `${set}, rule ${num}`,
      span: [s, e],
      matchText: m[0],
      ...(owner ? { inheritedRuleSet: true } : { assumedRuleSet: true }),
    });
  }

  return results;
}

function findCaciCitations(text) {
  const results = [];
  let m;
  CACI_RE.lastIndex = 0;
  while ((m = CACI_RE.exec(text)) !== null) {
    const num = normalizeCaciNum(m.groups.num);
    results.push({
      kind: "caci",
      key: `CACI No. ${num}`,
      span: [m.index, m.index + m[0].length],
      matchText: m[0],
    });
    // Chained additional numbers ("CACI Nos. 3710, 3711, and 3712"): each
    // inherits the CACI context from the primary match. Anchored via sticky `y`.
    let scanPos = m.index + m[0].length;
    while (true) {
      CACI_ADDL_RE.lastIndex = scanPos;
      const cont = CACI_ADDL_RE.exec(text);
      if (!cont || cont.index !== scanPos) break;
      if (startsNextCitation(text, cont.index + cont[0].length)) break;
      results.push({
        kind: "caci",
        key: `CACI No. ${normalizeCaciNum(cont.groups.num)}`,
        span: [cont.index, cont.index + cont[0].length],
        matchText: cont[0].replace(/^\s+/, ""),
      });
      scanPos = cont.index + cont[0].length;
    }
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
// Italicized short names — "the court in *Market Lofts* held ..."
// ============================================================================
//
// Case names are italicized; nothing else in a brief or an opinion reliably
// is. So once a case has been cited in full, a later italic run carrying part
// of its name IS a reference to it, and gets the same link the full cite got.
//
// The safety rule is the one a reader applies: link only when the italicized
// fragment can mean exactly one case already cited earlier in the document.
// If two cases cited before it answer to the same fragment ("Smith" for both
// Smith v. Jones and People v. Smith), the fragment is ambiguous and stays
// unlinked, even though a longer fragment naming either of them would link.

// Words that identify nothing on their own. A fragment made only of these
// ("People", "the State", "Superior Court") is never enough to name a case.
const GENERIC_PARTY_WORDS = new Set([
  "people", "state", "states", "city", "county", "united", "us", "usa",
  "commissioner", "commission", "board", "department", "dept", "director",
  "estate", "marriage", "matter", "conservatorship", "guardianship",
  "adoption", "in", "re", "the", "of", "and", "a", "an", "co", "company",
  "corp", "corporation", "companies", "inc", "llc", "llp", "lp", "ltd",
  "court", "courts", "superior", "supreme", "appeal", "appeals",
  "government", "district", "association", "assn", "assoc", "committee",
  "bank", "insurance", "ins", "national", "american", "california",
  "general", "attorney", "employment", "industrial", "public", "division",
  "agency", "authority", "council", "bureau", "office", "service",
  "services", "systems", "group", "partners", "holdings", "trust", "et",
  "al", "defendant", "defendants", "plaintiff", "plaintiffs", "respondent",
  "appellant", "petitioner", "real",
]);

// Trailing corporate designators, dropped to produce a second alias so
// "*Ford Motor*" reaches "Ford Motor Co."
const CORP_SUFFIX_RE =
  /[,\s]+(?:Inc|LLC|L\.L\.C|LLP|L\.L\.P|LP|Ltd|Corp|Co|Company|N\.A|P\.C|PC|S\.A)\.?$/i;

// Signal and connective words an italic run carries alongside the name —
// "*See Market Lofts*", "*Market Lofts, supra*", "*accord Aguilar*". None of
// them ever stands alone as a case's short name.
const ITALIC_TRIM_WORDS = new Set([
  "see", "also", "cf", "but", "compare", "accord", "contra", "eg", "ie",
  "in", "quoting", "citing", "following", "id", "ibid", "supra", "infra",
  "at", "and", "with", "the", "of", "to", "e", "g", "i", "here",
  "generally", "post", "ante", "hereafter", "hereinafter",
]);

function allGeneric(aliasWords) {
  return aliasWords.every((w) => GENERIC_PARTY_WORDS.has(w));
}

// Alias forms for one party name: the whole name, the whole name without a
// corporate designator, and each leading word-prefix of it. Prefixes are how
// a two-word distinctive name gets recognized ("Market Lofts" out of "Market
// Lofts Community Assn."), so they're only generated when the name opens with
// a distinctive word — "City of Los Angeles" must not contribute "City".
function partyAliases(name) {
  const out = [];
  const push = (str) => {
    const norm = normalizeParty(str);
    if (!norm || norm.length < 3) return;
    const words = norm.split(" ");
    if (allGeneric(words)) return;
    out.push(norm);
  };
  const base = name.trim().replace(SHORT_NAME_PREFIX_RE, "").trim();
  if (!base) return out;
  push(base);
  const noCorp = base.replace(CORP_SUFFIX_RE, "").trim();
  if (noCorp !== base) push(noCorp);

  const words = noCorp.split(/\s+/);
  if (!words.length) return out;
  if (GENERIC_PARTY_WORDS.has(normalizeParty(words[0]))) return out;
  for (let n = 1; n < Math.min(words.length, 5); n++) {
    // A prefix ending on a generic word adds nothing the shorter one didn't
    // already say ("Farmers' Insurance" over "Farmers'"), so skip it — but
    // keep going, because the word after it may well be distinctive.
    if (GENERIC_PARTY_WORDS.has(normalizeParty(words[n - 1]))) continue;
    push(words.slice(0, n).join(" "));
  }
  return out;
}

// Every fragment that names this case. Plaintiff-side aliases come first
// because that's the convention; the defendant only supplies aliases when the
// plaintiff is an institution the short name would never be built from
// ("People v. Smith" is "Smith"). A parenthetical the court announced always
// counts, whichever side it came from.
function caseAliases(cite) {
  const out = new Set();
  const add = (a) => { if (a) out.add(a); };
  if (cite.caseName) add(normalizeParty(cite.caseName));
  const plaintiffSide = cite.plaintiff ? partyAliases(cite.plaintiff)
                      : cite.caseName  ? partyAliases(cite.caseName)
                      : [];
  for (const a of plaintiffSide) add(a);
  if (!plaintiffSide.length && cite.defendant) {
    for (const a of partyAliases(cite.defendant)) add(a);
  }
  if (cite.parenName) {
    for (const a of partyAliases(cite.parenName)) add(a);
    add(normalizeParty(cite.parenName));
  }
  out.delete("");
  return out;
}

// Italic character ranges arrive per text item, so one italicized name is
// usually several adjacent ranges. Join ranges separated by nothing but
// whitespace back into the single run the reader sees.
function mergeItalicRuns(text, ranges) {
  const sorted = [...ranges]
    .filter((r) => Array.isArray(r) && r[1] > r[0])
    .sort((a, b) => a[0] - b[0]);
  const runs = [];
  for (const [s, e] of sorted) {
    const last = runs[runs.length - 1];
    // Overlapping, adjacent, or separated only by the space or line break
    // between two text items — the reader sees one italic phrase either way.
    const gap = last ? text.slice(Math.min(last[1], s), s) : null;
    if (last && gap.length <= 3 && !/\S/.test(gap)) {
      last[1] = Math.max(last[1], e);
      continue;
    }
    runs.push([s, e]);
  }
  return runs;
}

// Words of a run, each with its span in the document, stripped of the
// punctuation that clings to a citation ("Lofts," / "(Aguilar" / "Smith's").
function runWords(text, start, end) {
  const words = [];
  const re = /\S+/g;
  re.lastIndex = 0;
  const slice = text.slice(start, end);
  let m;
  while ((m = re.exec(slice)) !== null) {
    let ws = start + m.index;
    let we = ws + m[0].length;
    // The period stays: it belongs to the abbreviations case names are full
    // of ("Assn.", "Co."), and normalizeParty drops it before any comparison.
    while (ws < we && !/[A-Za-z0-9]/.test(text[ws])) ws++;
    while (we > ws && !/[A-Za-z0-9.]/.test(text[we - 1])) we--;
    if (we > ws) words.push({ start: ws, end: we, text: text.slice(ws, we) });
  }
  return words;
}

// The record a caller keeps so a case cited in text it no longer holds can
// still be recognized later. A web page that unmounts what scrolls out of view
// (a chat transcript, a virtualized list) hands the linker only the text it has
// left, so the full cite an italicized short name refers back to may be gone
// from the string being scanned. Feeding these back in as `opts.priorCases`
// puts the case back in the registry without putting it back in the text.
//
// Short forms are not memos: only a full citation carries the party names the
// aliases are built from, which is what a case name is recognized by. A supra,
// short-form or italic reference carries the key alone and makes no memo.
export function caseMemo(cite) {
  if (!cite || cite.kind !== "case" || !cite.key || !cite.caseName) return null;
  if (cite.isSupra || cite.isShortForm || cite.isItalicShort) return null;
  return {
    kind: "case",
    key: cite.key,
    caseName: cite.caseName,
    plaintiff: cite.plaintiff,
    defendant: cite.defendant,
    parenName: cite.parenName,
    wlOnly: !!cite.wlOnly,
    lexisOnly: !!cite.lexisOnly,
    slipOnly: !!cite.slipOnly,
    span: [-1, -1],
  };
}

// Remembered cases sit before every offset in the text being scanned — they
// were cited earlier, in text this caller no longer has — so the "cited in full
// before this point" rule counts them. The span is forced rather than trusted:
// a memo carries whatever span it had in the text it came from, which indexes
// into a different string.
function normalizePriorCases(list) {
  if (!Array.isArray(list) || !list.length) return [];
  const out = [];
  const seen = new Set();
  for (const c of list) {
    if (!c || !c.key || seen.has(c.key)) continue;
    seen.add(c.key);
    out.push({ ...c, kind: "case", isShortForm: false, span: [-1, -1] });
  }
  return out;
}

function findItalicShortNames(text, fullCitesInOrder, italicRanges, claimedSpans) {
  if (!italicRanges || !italicRanges.length) return [];
  const cases = fullCitesInOrder.filter((c) => c.kind === "case");
  if (!cases.length) return [];

  // alias -> full cites (document order) that answer to it.
  const registry = new Map();
  for (const c of cases) {
    for (const alias of caseAliases(c)) {
      let arr = registry.get(alias);
      if (!arr) registry.set(alias, arr = []);
      arr.push(c);
    }
  }
  if (!registry.size) return [];

  const results = [];
  for (const [runStart, runEnd] of mergeItalicRuns(text, italicRanges)) {
    if (runEnd - runStart < 3 || runEnd - runStart > 200) continue;
    const words = runWords(text, runStart, runEnd);
    if (!words.length || words.length > 12) continue;

    // Longest fragment wins, so "*Market Lofts*" links as the two words the
    // reader sees rather than as "Market" alone.
    let best = null;
    for (let len = words.length; len >= 1 && !best; len--) {
      for (let i = 0; i + len <= words.length; i++) {
        const window = words.slice(i, i + len);
        // Only registered aliases match, so a signal word inside a longer
        // fragment is harmless. A LONE word is the risk — a case whose short
        // name happens to be "Contra" or "Accord" would otherwise capture
        // every italicized signal in the document.
        if (len === 1 && ITALIC_TRIM_WORDS.has(normalizeParty(window[0].text))) continue;
        const alias = normalizeParty(window.map((w) => w.text).join(" "));
        if (alias.length < 3) continue;
        const candidates = registry.get(alias);
        if (!candidates) continue;
        // Only cases already cited in full BEFORE this point can be meant,
        // and only if exactly one of them answers to the fragment.
        const earlier = candidates.filter((c) => c.span[1] <= window[0].start);
        if (!earlier.length) continue;
        const keys = new Set(earlier.map((c) => c.key));
        if (keys.size > 1) continue;                 // ambiguous — leave it alone
        best = { target: earlier[earlier.length - 1], window, alias };
        break;
      }
    }
    if (!best) continue;

    const start = best.window[0].start;
    const end = best.window[best.window.length - 1].end;
    let overlap = false;
    for (const [s, e] of claimedSpans) {
      if (start < e && end > s) { overlap = true; break; }
    }
    if (overlap) continue;

    const target = best.target;
    results.push({
      kind: "case",
      key: target.key,
      span: [start, end],
      matchText: text.slice(start, end),
      short: text.slice(start, end),
      isShortForm: true,
      isItalicShort: true,
      wlOnly:    !!target.wlOnly,
      lexisOnly: !!target.lexisOnly,
      slipOnly:  !!target.slipOnly,
    });
    claimedSpans.push([start, end]);
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

// `opts.italicRanges` — [start, end) character ranges of the ORIGINAL text
// that are set in italics. Optional: callers with no font information (plain
// strings, tests) simply skip the italic short-name pass.
//
// `opts.priorCases` — caseMemo() records for full case citations the caller saw
// earlier in text that is no longer part of `text` (see caseMemo). They join
// the italic pass's registry as though cited before the first character, so an
// italicized short name still links after its full cite has scrolled out of the
// page. They never become citations of their own, and the ambiguity rule holds
// across them: a fragment answering to a remembered case and a differently-keyed
// one on the page is ambiguous, and stays unlinked.
export function findAllCitations(text, opts = {}) {
  const norm = normalizeForDetection(text);
  const fullCases = findCaseCitations(norm);
  const statutes  = findStatuteCitations(norm);
  const rules     = findRuleCitations(norm);
  const caci      = findCaciCitations(norm);

  // Rewrite matchText to use the original text (preserves original
  // whitespace for any downstream consumer that tries to match characters).
  for (const c of [...fullCases, ...statutes, ...rules, ...caci]) {
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

  // Italic short-name pass. Runs last so it can stand clear of every span the
  // earlier passes already claimed — an italicized full cite is linked as the
  // full cite, not twice.
  const claimed = [...fullCases, ...supras, ...shortForms].map((c) => c.span);
  const prior = normalizePriorCases(opts.priorCases);
  const italics = findItalicShortNames(
    norm,
    prior.length ? [...prior, ...fullOrdered] : fullOrdered,
    opts.italicRanges,
    claimed
  );
  for (const c of italics) c.matchText = text.slice(c.span[0], c.span[1]);

  const all = [...fullCases, ...statutes, ...rules, ...caci, ...supras, ...shortForms, ...italics]
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
    cite.kind === "statute" ? "statutes" :
    cite.kind === "regulation" ? "regulations" :
    cite.kind === "guidance" ? "guidance" :
    cite.kind === "caci" ? "caci" : "rules";
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

  // CACI jury instructions — no direct-link citation form, so search by the
  // instruction number ("CACI 3710"). Both providers surface the instruction
  // from that term; Westlaw is scoped to California.
  if (cite.kind === "caci") {
    const num = cite.key.replace(/^CACI No\.\s*/, "");
    const term = `CACI ${num}`;
    return effectiveProvider === "lexis"
      ? lexisSearchUrl(term)
      : westlawRuleUrl(term);
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

  if (cite.kind === "statute" || cite.kind === "regulation" ||
      cite.kind === "guidance") {
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
    // Federal regulations and codes. Classified off the KEY rather than off
    // cite.kind, because the carry-over passes — here and in the claude.ai
    // content script — rebuild a citation from a remembered code prefix and a
    // bare section number, and a key is all they have. Westlaw's California
    // jurisdiction filter would hide every one of these, so they route to the
    // national search builders instead.
    const fed = federalSearchTerm(cite.key);
    if (fed) {
      if (effectiveProvider === "lexis") return lexisSearchUrl(fed.term);
      return fed.kind === "statute"
        ? westlawFederalStatuteUrl(fed.term)
        : westlawFederalSearchUrl(fed.term);
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
  let m = needle.match(
    new RegExp(String.raw`§§?\s*` + FED_SECTION + String.raw`(?:\s*,\s*` + FED_SECTION + String.raw`)?`, "i")
  );
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

  // U.S.C. and C.F.R.: "9 U.S.C. § 1", "29 C.F.R. § 2560.503-1".
  m = needle.match(
    new RegExp(String.raw`\d+\s+(?:U\.?\s*S\.?\s*C\.?|C\.?\s*F\.?\s*R\.?)[^a-z]*§§?\s*` + FED_SECTION, "i")
  );
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
let documentItalics = [];     // [start, end) ranges of italic text, doc-wide
let documentRepo = {};
let documentProvider = "lexis";

export function resetDocument({ repo = {}, provider = "lexis" } = {}) {
  documentText = "";
  documentCites = [];
  pageRanges = [];
  pageJoinedItemMaps = [];
  documentItalics = [];
  documentRepo = repo;
  documentProvider = provider;
}

// `opts.italicFontNames` — a Set of textContent.styles keys the caller has
// identified as italic faces. Every item drawn in one of them contributes an
// italic range, which is what lets the linker see an italicized short name.
export function ingestPage(pageNumber, textContent, opts = {}) {
  const { joined, itemRanges } = buildJoinedText(textContent);
  const startInDoc = documentText.length;
  const italicFonts = opts.italicFontNames;
  if (italicFonts && italicFonts.size) {
    const items = textContent.items || [];
    for (const { start, end, itemIndex } of itemRanges) {
      const item = items[itemIndex];
      if (item && italicFonts.has(item.fontName) && end > start) {
        documentItalics.push([startInDoc + start, startInDoc + end]);
      }
    }
  }
  documentText += joined;
  // Page break the detection regex won't cross at sentence boundaries.
  // pdf_linker.py uses "\n\f\n"; we use the same so newline-stop logic works.
  documentText += "\n\f\n";
  const endInDoc = documentText.length;

  pageRanges.push({ pageNumber, start: startInDoc, end: endInDoc });
  pageJoinedItemMaps.push({ pageNumber, joinedStart: startInDoc, itemRanges });
}

export function runDetection() {
  documentCites = findAllCitations(documentText, { italicRanges: documentItalics });
  return documentCites.length;
}

// True if document-wide detection found at least one CASE citation. Statutes,
// rules, and CACI don't count — a bare notice of motion routinely recites its
// statutory basis ("pursuant to CCP § 1005"), but only a memorandum cites
// cases. (Supra/short-form entries carry kind "case" too, but they only exist
// when a full case cite was detected, so this test is not widened by them.)
export function hasCaseCitation() {
  return documentCites.some((c) => c.kind === "case");
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
