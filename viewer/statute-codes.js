// Statute code patterns, ported verbatim from pdf_linker.py STATUTE_CODES.
// Each entry is [regex_source_string, abbreviation]. Long forms first, then
// CSM short forms. Sorted by pattern length (longest first) so alternation
// prefers more specific matches.

export const STATUTE_CODES_RAW = [
  // Long forms
  [String.raw`Code of Civil Procedure`, "CCP"],
  [String.raw`Civil Code`, "CIV"],
  [String.raw`Penal Code`, "PEN"],
  [String.raw`Evidence Code`, "EVID"],
  [String.raw`Business (?:and|&) Professions Code`, "BPC"],
  [String.raw`Family Code`, "FAM"],
  [String.raw`Government Code`, "GOV"],
  [String.raw`Health (?:and|&) Safety Code`, "HSC"],
  [String.raw`Labor Code`, "LAB"],
  [String.raw`Probate Code`, "PROB"],
  [String.raw`Vehicle Code`, "VEH"],
  [String.raw`Welfare (?:and|&) Institutions Code`, "WIC"],
  [String.raw`Corporations Code`, "CORP"],
  [String.raw`Insurance Code`, "INS"],
  [String.raw`Revenue (?:and|&) Taxation Code`, "RTC"],
  [String.raw`Education Code`, "EDC"],
  [String.raw`Elections Code`, "ELEC"],
  [String.raw`Financial Code`, "FIN"],
  [String.raw`Fish (?:and|&) Game Code`, "FGC"],
  [String.raw`Food (?:and|&) Agricultural Code`, "FAC"],
  [String.raw`Harbors (?:and|&) Navigation Code`, "HNC"],
  [String.raw`Military (?:and|&) Veterans Code`, "MVC"],
  [String.raw`Public Contract Code`, "PCC"],
  [String.raw`Public Resources Code`, "PRC"],
  [String.raw`Public Utilities Code`, "PUC"],
  [String.raw`Streets (?:and|&) Highways Code`, "SHC"],
  [String.raw`Unemployment Insurance Code`, "UIC"],
  [String.raw`Water Code`, "WAT"],
  [String.raw`Commercial Code`, "COM"],

  // CSM short forms
  [String.raw`Code Civ\.\s*Proc\.`, "CCP"],
  [String.raw`Civ\.\s*Code`, "CIV"],
  [String.raw`Pen\.\s*Code`, "PEN"],
  [String.raw`Evid\.\s*Code`, "EVID"],
  [String.raw`Bus\.\s*(?:&|and)\s*Prof\.\s*Code`, "BPC"],
  [String.raw`Fam\.\s*Code`, "FAM"],
  [String.raw`Gov\.\s*Code`, "GOV"],
  [String.raw`Health\s*(?:&|and)\s*Saf\.\s*Code`, "HSC"],
  [String.raw`Lab\.\s*Code`, "LAB"],
  [String.raw`Prob\.\s*Code`, "PROB"],
  [String.raw`Veh\.\s*Code`, "VEH"],
  [String.raw`Welf\.\s*(?:&|and)\s*Inst\.\s*Code`, "WIC"],
  [String.raw`Corp\.\s*Code`, "CORP"],
  [String.raw`Ins\.\s*Code`, "INS"],
  [String.raw`Rev\.\s*(?:&|and)\s*Tax\.\s*Code`, "RTC"],
  [String.raw`Educ\.\s*Code`, "EDC"],
  [String.raw`Elec\.\s*Code`, "ELEC"],
  [String.raw`Fin\.\s*Code`, "FIN"],
  [String.raw`Fish\s*(?:&|and)\s*Game Code`, "FGC"],
  [String.raw`Food\s*(?:&|and)\s*Agric\.\s*Code`, "FAC"],
  [String.raw`Harb\.\s*(?:&|and)\s*Nav\.\s*Code`, "HNC"],
  [String.raw`Mil\.\s*(?:&|and)\s*Vet\.\s*Code`, "MVC"],
  [String.raw`Pub\.\s*Cont(?:ract)?\.?\s*Code`, "PCC"],
  [String.raw`Pub\.\s*Res(?:ources)?\.?\s*Code`, "PRC"],
  [String.raw`Pub\.\s*Util(?:ities)?\.?\s*Code`, "PUC"],
  [String.raw`Sts\.\s*(?:&|and)\s*Hy\.\s*Code`, "SHC"],
  [String.raw`Unemp\.\s*Ins\.\s*Code`, "UIC"],
  [String.raw`Wat\.\s*Code`, "WAT"],
  [String.raw`Com\.\s*Code`, "COM"],

  // Extra variants validated by content.js's REWRITE_LONG_FORM list
  [String.raw`Govt\.\s*Code`, "GOV"],
  [String.raw`Fish\s*(?:&|and)\s*G\.\s*Code`, "FGC"],
  [String.raw`Food\s*(?:&|and)\s*Agr\.\s*Code`, "FAC"],

  // Practitioner-style "X Code" reorderings of multi-word codes. The CSM
  // short forms above use "Code Civ. Proc." (Code first), but California
  // briefs frequently write "Cal. Civ. Proc. Code" (Code last). Add the
  // reversed orderings so both word orders match.
  [String.raw`Civ\.\s*Proc\.\s*Code`, "CCP"],
  [String.raw`Civil\s+Procedure\s+Code`, "CCP"],

  // Bare uppercase abbreviations as written in practice ("CCP § 664.6",
  // "PEN § 187", "BPC § 17200"). These mirror the canonical output
  // abbreviations and also accept dotted forms ("C.C.P."). The required
  // §/section + number after the name (enforced by the statute regex) keeps
  // false positives low. Listed shortest-last so longer named forms above
  // always win when both could match.
  [String.raw`C\.?C\.?P\.?`, "CCP"],
  [String.raw`CIV`, "CIV"],
  [String.raw`PEN`, "PEN"],
  [String.raw`EVID`, "EVID"],
  [String.raw`BPC`, "BPC"],
  [String.raw`FAM`, "FAM"],
  [String.raw`GOV`, "GOV"],
  [String.raw`HSC`, "HSC"],
  [String.raw`LAB`, "LAB"],
  [String.raw`PROB`, "PROB"],
  [String.raw`VEH`, "VEH"],
  [String.raw`WIC`, "WIC"],
  [String.raw`CORP`, "CORP"],
  [String.raw`INS`, "INS"],
  [String.raw`RTC`, "RTC"],
  [String.raw`EDC`, "EDC"],
  [String.raw`ELEC`, "ELEC"],
  [String.raw`FIN`, "FIN"],
  [String.raw`FGC`, "FGC"],
  [String.raw`HNC`, "HNC"],
  [String.raw`MVC`, "MVC"],
  [String.raw`PCC`, "PCC"],
  [String.raw`PRC`, "PRC"],
  [String.raw`PUC`, "PUC"],
  [String.raw`SHC`, "SHC"],
  [String.raw`UIC`, "UIC"],
  [String.raw`WAT`, "WAT"],
  [String.raw`COM`, "COM"],
];

export const STATUTE_CODES_SORTED = [...STATUTE_CODES_RAW].sort(
  (a, b) => b[0].length - a[0].length
);
