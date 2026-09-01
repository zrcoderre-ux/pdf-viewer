// Provider-specific search prefixes and URL builders.
//
// All values here come from the cross-opener extension's content.js, which is
// validated against live Westlaw and Lexis+ pages. Where pdf_linker.py and
// content.js disagreed, content.js wins.

import {
  CFR_TITLE_BY_REG,
  USC_TITLE_BY_CODE,
  FEDERAL_CODE_NAMES,
} from "./federal-codes.js";

export const WL_SEARCH_PREFIX = {
  BPC: "CA BUS & PROF", COM: "CA COML",       CIV: "CA CIVIL",
  CCP: "CA CIV PRO",    CORP: "CA CORP",      EDC: "CA EDUC",
  ELEC: "CA ELEC",      EVID: "CA EVID",      FAM: "CA FAM",
  FIN: "CA FIN",        FGC: "CA FISH & G",   FAC: "CA FOOD & AG",
  GOV: "CA GOVT",       HNC: "CA HARB & NAV", HSC: "CA HLTH & S",
  INS: "CA INS",        LAB: "CA LABOR",      MVC: "CA MIL & VET",
  PEN: "CA PENAL",      PROB: "CA PROBATE",   PCC: "CA PUB CONT",
  PRC: "CA PUB RES",    PUC: "CA PUB UTIL",   RTC: "CA REV & TAX",
  SHC: "CA STR & HWY",  UIC: "CA UNEMP INS",  VEH: "CA VEHICLE",
  WAT: "CA WATER",      WIC: "CA WELF & INST",
};

export const LEXIS_SEARCH_PREFIX = {
  BPC: "Cal Bus & Prof Code",    COM: "Cal U Com Code",
  CIV: "Cal Civ Code",           CCP: "Cal Code Civ Proc",
  CORP: "Cal Corp Code",         EDC: "Cal Ed Code",
  ELEC: "Cal Elec Code",         EVID: "Cal Evid Code",
  FAM: "Cal Fam Code",           FIN: "Cal Fin Code",
  FGC: "Cal Fish & G Code",      FAC: "Cal Food & Agr Code",
  GOV: "Cal Gov Code",           HNC: "Cal Harb & Nav Code",
  HSC: "Cal Health & Saf Code",  INS: "Cal Ins Code",
  LAB: "Lab Code",               MVC: "Cal Mil & Vet Code",
  PEN: "Cal Pen Code",           PROB: "Cal Prob Code",
  PCC: "Cal Pub Contract Code",  PRC: "Cal Pub Resources Code",
  PUC: "Cal Pub Util Code",      RTC: "Cal Rev & Tax Code",
  SHC: "Cal Sts & Hy Code",      UIC: "Cal Unemp Ins Code",
  VEH: "Cal Veh Code",           WAT: "Cal Wat Code",
  WIC: "Cal Welf & Inst Code",
};

// ---------- URL builders ----------
//
// Forms taken verbatim from content.js's injectFloatingButton (the URLs your
// cross-opener actually uses):
//
//   case (Westlaw):
//     https://1.next.westlaw.com/Link/Document/FullText?findType=Y&cite=<cite>
//   statute/rule (Westlaw):
//     https://1.next.westlaw.com/Search/Results.html?query=<term>
//                                         &jurisdiction=CA&contentType=STATUTE
//   case/statute/rule (Lexis+):
//     https://plus.lexis.com/search/?pdmfid=1530671&pdsearchterms=<term>

const LEXIS_PDMFID = "1530671";

// Westlaw's findType=Y&cite= and Lexis's pdsearchterms= both expect a bare
// reporter citation like "13 Cal.App.5th 1152" or "2021 WL 1234567" — NOT the
// full key with case name and year. The extraction below pulls the reporter
// portion out of any of the case-key forms produced by findCaseCitations:
//   "Smith v. Jones (2017) 13 Cal.App.5th 1152"          (CSM)
//   "Anderson v. Liberty Lobby, Inc. (1986) 477 U.S. 242" (Bluebook)
//   "In re Doe (2009) 555 F.3d 100"                       (In re)
//   "Ford Motor Warranty Cases (2025) 17 Cal.5th 1122"    (Cases)
//   "Smith v. Jones 2021 WL 1234567"                      (Westlaw-only)
//   "Smith v. Jones 2024 U.S. Dist. LEXIS 12345"          (Lexis-only)
//
// Without this, the cite= or pdsearchterms= parameter receives the whole
// "Smith v. Jones (2017) 13 Cal.App.5th 1152" string, which Westlaw's
// findType=Y rejects as malformed and returns "page not found". Lexis is
// less strict but still gets better matches from the bare reporter alone.
const _CASE_TAIL_RE  = /\((\d{4})\)\s+(\d{1,4})\s+(\S+?)\s+(\d{1,5})\s*$/;
const _WL_TAIL_RE    = /(\d{4})\s+WL\s+(\d{4,8})\s*$/;
const _LEXIS_TAIL_RE = /(\d{4})\s+U\.S\.\s*Dist\.\s*LEXIS\s+(\d{4,8})\s*$/;

export function caseReporterCite(caseKey) {
  let m = caseKey.match(_CASE_TAIL_RE);
  if (m) {
    const [, _year, vol, reporter, page] = m;
    return `${vol} ${reporter} ${page}`;
  }
  m = caseKey.match(_WL_TAIL_RE);
  if (m) {
    const [, year, num] = m;
    return `${year} WL ${num}`;
  }
  m = caseKey.match(_LEXIS_TAIL_RE);
  if (m) {
    const [, year, num] = m;
    return `${year} U.S. Dist. LEXIS ${num}`;
  }
  return null;
}

// Lexis search term: the full case name (both parties) plus the reporter cite.
// The reporter cite (vol + reporter + page) is the unique anchor; including
// both party names — rather than just the first word of the plaintiff —
// improves accuracy when the lead party is generic ("People v. ...", "City of
// ...", "In re ...") and is more robust to a stray leading token from imperfect
// name extraction. It still disambiguates same-volume page collisions (e.g.
// Sheppard v. Maxwell, 384 U.S. 333, spanning page 346, vs. Miranda v. Arizona,
// 384 U.S. 346). Falls back to the bare reporter cite when no name is present,
// and to the full key when no reporter tail is recognised (WL/LEXIS-only and
// slip cites route through caseReporterCite separately).
export function disambiguatedLexisTerm(caseKey) {
  const m = caseKey.match(_CASE_TAIL_RE);
  if (!m) {
    return caseKey;
  }
  const [, _year, vol, reporter, page] = m;
  const reporterCite = `${vol} ${reporter} ${page}`;
  const namePart = caseKey.slice(0, m.index).trim().replace(/[,;]+$/, "");
  return namePart ? `${namePart} ${reporterCite}` : reporterCite;
}

// Slip-cite keys are shaped:
//   "<plaintiff> v. <defendant>[, ?]Case No. <docket> (<court>)"
// Strip the slip tail so the search term is just the case name; both
// Westlaw and Lexis return useful results from the name alone. Mirrors
// _slip_search_term in pdf_linker.py.
export function slipSearchTerm(caseKey) {
  const m = /,?\s*Case\s+No\.\s+/i.exec(caseKey);
  if (m) return caseKey.slice(0, m.index).trim();
  return caseKey;
}

export function westlawCaseUrl(cite) {
  // WL citations (e.g. "2015 WL 13626022") are unpublished decisions whose
  // findType=Y form is unreliable — Westlaw routes them through search instead.
  // Detected by " WL " in the cite (a space-bounded token, so we don't
  // mis-detect reporter names that happen to contain "WL").
  if (/ WL /.test(cite)) {
    return (
      "https://1.next.westlaw.com/Search/Results.html" +
      "?query=" + encodeURIComponent(cite) +
      "&jurisdiction=CA&contentType=CASE"
    );
  }
  return (
    "https://1.next.westlaw.com/Link/Document/FullText" +
    "?findType=Y&cite=" + encodeURIComponent(cite)
  );
}

export function westlawStatuteUrl(query) {
  return (
    "https://1.next.westlaw.com/Search/Results.html" +
    "?query=" + encodeURIComponent(query) +
    "&jurisdiction=CA&contentType=STATUTE"
  );
}

export function westlawRuleUrl(query) {
  return (
    "https://1.next.westlaw.com/Search/Results.html" +
    "?query=" + encodeURIComponent(query) +
    "&jurisdiction=CA"
  );
}

// Model Uniform Commercial Code search (NOT California's Commercial Code).
// Westlaw indexes the model UCC nationally, so we omit the CA jurisdiction
// filter. Caller passes a term like "Unif.Commercial Code § 3-310".
export function westlawUccUrl(query) {
  return (
    "https://1.next.westlaw.com/Search/Results.html" +
    "?query=" + encodeURIComponent(query) +
    "&contentType=STATUTE"
  );
}

// Federal statutes (U.S. Code, and the named codes that rewrite into it).
// Deliberately NOT scoped with jurisdiction=CA the way westlawStatuteUrl is:
// the California filter would exclude the national statute databases where
// these live. Same reasoning as westlawUccUrl.
export function westlawFederalStatuteUrl(query) {
  return (
    "https://1.next.westlaw.com/Search/Results.html" +
    "?query=" + encodeURIComponent(query) +
    "&contentType=STATUTE"
  );
}

// Federal material that is not statutory: C.F.R. sections, the named
// regulation series, and IRS published guidance. No contentType filter —
// none of these live in the statute databases, and an unfiltered national
// search reliably surfaces them.
export function westlawFederalSearchUrl(query) {
  return (
    "https://1.next.westlaw.com/Search/Results.html" +
    "?query=" + encodeURIComponent(query)
  );
}

export function lexisSearchUrl(term) {
  return (
    "https://plus.lexis.com/search/" +
    "?pdmfid=" + LEXIS_PDMFID +
    "&pdsearchterms=" + encodeURIComponent(term)
  );
}

// Build a Westlaw native search term from an internal statute key.
// e.g. "CCP § 760.020" -> "CA CIV PRO § 760.020"
// Federal U.S.C. keys ("9 U.S.C. § 1") pass through unchanged — Westlaw
// accepts them directly as a search term.
export function wlSearchTerm(key) {
  if (/^\d+\s+U\.S\.C\.\s*§/.test(key)) return key;
  const m = key.match(/^([A-Z]+)\s*§\s*(.+)$/);
  if (!m) return key;
  const prefix = WL_SEARCH_PREFIX[m[1]];
  return prefix ? `${prefix} § ${m[2]}` : key;
}

// Build a Lexis native search term from an internal statute key.
// e.g. "CCP § 760.020" -> "Cal Code Civ Proc § 760.020"
// Federal U.S.C. keys pass through unchanged (same as Westlaw).
export function lexisSearchTerm(key) {
  if (/^\d+\s+U\.S\.C\.\s*§/.test(key)) return key;
  const m = key.match(/^([A-Z]+)\s*§\s*(.+)$/);
  if (!m) return key;
  const prefix = LEXIS_SEARCH_PREFIX[m[1]];
  return prefix ? `${prefix} § ${m[2]}` : key;
}

// ---------- Federal keys ----------
//
// Statute and regulation keys preserve the citation as the document wrote it
// ("Treas. Reg. § 1.125", "I.R.C. § 9801(f)"), so the Table of Authorities
// reads back in the writer's own form. The rewriting to a citation a search
// engine resolves happens here, at URL time.
//
// Splitting a key back into prefix and section is also what makes the
// carry-over passes work: they rebuild a key from a remembered prefix and a
// bare section number, so classification has to run off the key alone rather
// than off any flag set at detection time.

const _KEY_SPLIT_RE = /^(.*?)\s*§\s*(.+)$/;
const _CFR_PREFIX_RE = /^\d{1,3}\s+C\.F\.R\.$/;
const _USC_PREFIX_RE = /^\d{1,3}\s+U\.S\.C\.(?:,?\s*App\.)?$/;
// "Rev. Rul. 2013-17". The ruling number is the whole citation — both
// providers index it in that form, so nothing is rewritten.
const _REV_RUL_RE = /^Rev\. Rul\. (?:\d{4}|\d{2})-\d{1,3}$/;
// "40 C.F.R. pt. 60" — a part cite, which carries no § at all.
const _CFR_PART_RE = /^\d{1,3}\s+C\.F\.R\.\s+pt\.\s+\d+$/;
// A named regulation, optionally qualified: "Prop. Treas. Reg.".
const _REG_QUALIFIER_RE = /^(Prop\.|Temp\.)\s+(.*)$/;

// Classify a statute/regulation key and build the search term both providers
// should receive for it. Returns null when the key is not federal (California
// codes and the model UCC keep their own paths in resolveUrl).
//
//   "29 C.F.R. § 2560.503-1"  -> { kind: "regulation", term: unchanged }
//   "Treas. Reg. § 1.125"     -> { kind: "regulation", term: "26 C.F.R. § 1.125" }
//   "Prop. Treas. Reg. § 1.1" -> { kind: "regulation", term: unchanged }
//   "Rev. Rul. 2013-17"       -> { kind: "guidance",   term: unchanged }
//   "9 U.S.C. § 1"            -> { kind: "statute",    term: unchanged }
//   "I.R.C. § 9801(f)"        -> { kind: "statute",    term: "26 U.S.C. § 9801(f)" }
//   "ERISA § 701"             -> { kind: "statute",    term: unchanged }
export function federalSearchTerm(key) {
  // Revenue rulings and C.F.R. part cites carry no "§" to split on.
  if (_REV_RUL_RE.test(key)) return { kind: "guidance", term: key };
  if (_CFR_PART_RE.test(key)) return { kind: "regulation", term: key };

  const m = key.match(_KEY_SPLIT_RE);
  if (!m) return null;
  const prefix = m[1];
  const section = m[2];

  if (_CFR_PREFIX_RE.test(prefix)) return { kind: "regulation", term: key };
  if (_USC_PREFIX_RE.test(prefix)) return { kind: "statute", term: key };

  // A named regulation. A "Prop." qualifier is load-bearing: a proposed
  // regulation has not been adopted into the C.F.R., so rewriting it to a
  // C.F.R. section would point at something that does not exist. Search the
  // practitioner's form instead. Temporary regulations are in the C.F.R.
  // (their section numbers carry the "T"), so they convert normally.
  const qual = prefix.match(_REG_QUALIFIER_RE);
  const bareName = qual ? qual[2] : prefix;
  const cfrTitle = CFR_TITLE_BY_REG.get(bareName);
  if (cfrTitle) {
    if (qual && qual[1] === "Prop.") return { kind: "regulation", term: key };
    return { kind: "regulation", term: `${cfrTitle} C.F.R. § ${section}` };
  }

  if (FEDERAL_CODE_NAMES.has(prefix)) {
    const uscTitle = USC_TITLE_BY_CODE.get(prefix);
    // Parallel-numbered codes rewrite to the U.S.C. form, which resolves
    // directly. Independently numbered acts keep their own numbering — the
    // act-to-U.S.C. correspondence is a table, not a formula — and are found
    // by popular name.
    return {
      kind: "statute",
      term: uscTitle ? `${uscTitle} U.S.C. § ${section}` : key,
    };
  }

  return null;
}

// True when a key names federal authority in the C.F.R. family. The `kind`
// carried on a citation drives the Table of Authorities grouping and the
// underline color; this lets the carry-over passes, which only ever have a
// rebuilt key to go on, tag inherited references the same way.
export function isRegulationKey(key) {
  const fed = federalSearchTerm(key);
  return !!fed && fed.kind === "regulation";
}
