// Provider-specific search prefixes and URL builders.
//
// All values here come from the cross-opener extension's content.js, which is
// validated against live Westlaw and Lexis+ pages. Where pdf_linker.py and
// content.js disagreed, content.js wins.

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
