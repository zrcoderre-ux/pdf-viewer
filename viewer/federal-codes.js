// Federal regulations and codes.
//
// Three families live here, each with its own linking strategy. What separates
// them is whether the citation carries enough information to name a place in
// the U.S. Code or the C.F.R. on its own:
//
//   C.F.R.        "29 C.F.R. § 2560.503-1", "40 C.F.R. pt. 60". The title
//                 number is in the cite, so nothing needs rewriting.
//
//   Named regs    "Treas. Reg. § 1.125". The agency name stands in for the
//                 C.F.R. title — Treasury regulations are title 26 — so the
//                 key keeps the practitioner's form and the URL builder
//                 substitutes the title. PROPOSED regulations are the
//                 exception: they have not been adopted into the C.F.R. at
//                 all, so a "Prop." cite is searched by name instead of being
//                 rewritten to a C.F.R. section that does not yet exist.
//                 Temporary regulations ARE in the C.F.R. (with the "T"
//                 suffix the section number already carries), so they convert
//                 like a final regulation.
//
//   Named codes   "Internal Revenue Code section 9801(f)", "ERISA § 701".
//                 Two sub-kinds, distinguished by `uscTitle`:
//
//                 uscTitle set — the act was codified section-for-section, so
//                 the act's own section number IS the U.S. Code section
//                 number (Internal Revenue Code § 9801 = 26 U.S.C. § 9801;
//                 Bankruptcy Code § 362 = 11 U.S.C. § 362). The URL builder
//                 rewrites these to the U.S.C. form, which both providers
//                 resolve directly.
//
//                 uscTitle null — the act is numbered independently of its
//                 codification (ERISA § 701 is 29 U.S.C. § 1181; FLSA § 7 is
//                 29 U.S.C. § 207). That correspondence is a lookup table
//                 section by section, not a formula, so rather than ship a
//                 table that would be wrong wherever it is incomplete, these
//                 are searched by popular name — a form both Westlaw and
//                 Lexis index.
//
// In every case the KEY preserves the citation as the writer wrote it
// ("Treas. Reg. § 1.125", "I.R.C. § 9801"), so the Table of Authorities reads
// back the way a lawyer would expect. The rewriting happens only in
// code-tables.js, when a search URL is built.

// Section-number shape for federal materials. Wider than the California
// pattern in two ways that matter:
//
//   dots     C.F.R. sections are part-and-section ("1.125", "2560.503").
//   hyphens  Both codes use them inside a single section number —
//            "2560.503-1", "2000e-2", "1395w-4", "1.125-4T".
//
// The hyphen is only allowed after a base that is dotted or letter-suffixed.
// A hyphen between two plain integers is a RANGE of sections ("§§ 1181-1185"),
// not one section number, and matching it as a section would invent a
// citation that does not exist. The plain-integer alternative comes last so
// the richer forms are tried first.
export const FED_SECTION =
  String.raw`(?:` +
  String.raw`\d+(?:\.\d+)+[A-Za-z]{0,3}(?:-\d+[A-Za-z]{0,3})*` +
  String.raw`|\d+[A-Za-z]{1,3}(?:-\d+[A-Za-z]{0,3})*` +
  String.raw`|\d+` +
  String.raw`)(?:\([A-Za-z0-9]+\))*`;

// Named regulation series whose agency name replaces the C.F.R. title.
// `name` is the canonical form the key is built from; `cfrTitle` is the
// C.F.R. title the URL builder substitutes.
export const FEDERAL_REGULATIONS = [
  {
    pattern: String.raw`Treas(?:ury)?\.?\s*Reg(?:ulations?|s)?\.?`,
    name: "Treas. Reg.",
    cfrTitle: "26",
  },
];

// Named federal codes and acts. See the header for what `uscTitle` means.
export const FEDERAL_CODES = [
  // Codified section-for-section into the U.S. Code.
  {
    pattern: String.raw`Internal\s+Revenue\s+Code(?:\s+of\s+\d{4})?`,
    name: "I.R.C.",
    uscTitle: "26",
  },
  { pattern: String.raw`I\.\s*R\.\s*C\.`, name: "I.R.C.", uscTitle: "26" },
  { pattern: String.raw`IRC`, name: "I.R.C.", uscTitle: "26" },
  {
    pattern: String.raw`Bankruptcy\s+Code`,
    name: "Bankr. Code",
    uscTitle: "11",
  },
  { pattern: String.raw`Bankr\.\s*Code`, name: "Bankr. Code", uscTitle: "11" },

  // Numbered independently of their codification — searched by popular name.
  {
    pattern: String.raw`Employee\s+Retirement\s+Income\s+Security\s+Act(?:\s+of\s+1974)?`,
    name: "ERISA",
    uscTitle: null,
  },
  { pattern: String.raw`ERISA`, name: "ERISA", uscTitle: null },
  {
    pattern: String.raw`Fair\s+Labor\s+Standards\s+Act(?:\s+of\s+1938)?`,
    name: "FLSA",
    uscTitle: null,
  },
  { pattern: String.raw`FLSA`, name: "FLSA", uscTitle: null },
  {
    pattern: String.raw`National\s+Labor\s+Relations\s+Act`,
    name: "NLRA",
    uscTitle: null,
  },
  { pattern: String.raw`NLRA`, name: "NLRA", uscTitle: null },
  {
    pattern: String.raw`Securities\s+Exchange\s+Act(?:\s+of\s+1934)?`,
    name: "Securities Exchange Act",
    uscTitle: null,
  },
  {
    pattern: String.raw`Securities\s+Act\s+of\s+1933`,
    name: "Securities Act of 1933",
    uscTitle: null,
  },
];

// Longest pattern first, so "Employee Retirement Income Security Act" is
// preferred over any shorter alternative that could also start at the same
// position. Mirrors STATUTE_CODES_SORTED.
export const FEDERAL_CODES_SORTED = [...FEDERAL_CODES].sort(
  (a, b) => b.pattern.length - a.pattern.length
);

// name -> C.F.R. title, for the URL builders.
export const CFR_TITLE_BY_REG = new Map(
  FEDERAL_REGULATIONS.map((r) => [r.name, r.cfrTitle])
);

// name -> U.S.C. title, only for the codes whose numbering is parallel.
export const USC_TITLE_BY_CODE = new Map(
  FEDERAL_CODES.filter((c) => c.uscTitle).map((c) => [c.name, c.uscTitle])
);

// Every canonical named-code prefix, parallel-numbered or not. Used to
// recognise a key like "ERISA § 701" as federal when only the key survives
// (the carry-over passes rebuild keys from a prefix and a section number).
export const FEDERAL_CODE_NAMES = new Set(FEDERAL_CODES.map((c) => c.name));
