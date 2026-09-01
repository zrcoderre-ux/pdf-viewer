// Node-runnable tests for federal regulations and codes.
// Run: node test-federal-citations.mjs
//
// Four families, each linked differently (see viewer/federal-codes.js):
//
//   C.F.R.       the title number is in the cite, so nothing is rewritten
//   named regs   "Treas. Reg." stands in for C.F.R. title 26 — except a
//                PROPOSED regulation, which is not in the C.F.R. at all
//   named codes  "Internal Revenue Code" is 26 U.S.C. section-for-section;
//                "ERISA" is not (§ 701 is 29 U.S.C. § 1181), so it is
//                searched by popular name instead of being rewritten
//   rev. ruls.   IRS published guidance, whose number IS the citation — there
//                is no section, and nothing is rewritten
//
// Keys always preserve the citation as written, so the Table of Authorities
// reads back in the writer's own form; the rewriting happens at URL time.

import { findAllCitations, resolveUrl } from "./viewer/citation-linker.js";
import { federalSearchTerm } from "./viewer/code-tables.js";

let fails = 0;

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        got : ${JSON.stringify(got)}`);
    console.log(`        want: ${JSON.stringify(want)}`);
    fails++;
  }
}

// [key, kind] for every federal authority found, in document order.
function statuteHits(text) {
  return findAllCitations(text)
    .filter((c) => ["statute", "regulation", "guidance"].includes(c.kind))
    .map((c) => [c.key, c.kind]);
}

// The text each citation underlines, so a span that stops mid-cite shows up.
function spans(text) {
  return findAllCitations(text).map((c) => c.matchText);
}

console.log("\n--- the three forms from the original request ---");
check(
  "Treas. Reg. / Internal Revenue Code / ERISA in one line",
  statuteHits(
    "Treas. Reg. § 1.125, 4 Internal Revenue Code section 9801(f), ERISA § 701(f)"
  ),
  [
    ["Treas. Reg. § 1.125", "regulation"],
    ["I.R.C. § 9801(f)", "statute"],
    ["ERISA § 701(f)", "statute"],
  ]
);

console.log("\n--- C.F.R. ---");
check("with the section marker",
  statuteHits("See 29 C.F.R. § 2560.503-1."),
  [["29 C.F.R. § 2560.503-1", "regulation"]]);
check("bare, no marker and no periods",
  statuteHits("See 45 CFR 164.512(a)."),
  [["45 C.F.R. § 164.512(a)", "regulation"]]);
check("part cite",
  statuteHits("40 C.F.R. pt. 60 and 29 C.F.R. Part 1910."),
  [["40 C.F.R. pt. 60", "regulation"], ["29 C.F.R. pt. 1910", "regulation"]]);
check("chained sections",
  statuteHits("29 C.F.R. §§ 2560.503-1, 2560.503-2."),
  [["29 C.F.R. § 2560.503-1", "regulation"],
   ["29 C.F.R. § 2560.503-2", "regulation"]]);

console.log("\n--- the hyphen is part of the section, not a range ---");
// "42 U.S.C. § 2000e-2" is Title VII's discrimination section. Truncating at
// the hyphen produced "§ 2000e", which is the definitions section — a link to
// the wrong statute, not merely an imprecise one.
check("42 U.S.C. § 2000e-2 keeps its suffix",
  statuteHits("42 U.S.C. § 2000e-2(a)(1)."),
  [["42 U.S.C. § 2000e-2(a)(1)", "statute"]]);
// A hyphen between two plain integers is a RANGE of sections. Matching it as
// one section number would invent a citation that does not exist, so only the
// first section is linked.
check("§§ 1181-1185 is a range, not a section number",
  statuteHits("29 U.S.C. §§ 1181-1185."),
  [["29 U.S.C. § 1181", "statute"]]);

console.log("\n--- U.S.C. ---");
check("bare, no section marker",
  statuteHits("42 USC 1983."),
  [["42 U.S.C. § 1983", "statute"]]);
check("annotated edition",
  statuteHits("5 U.S.C.A. § 552(b)."),
  [["5 U.S.C. § 552(b)", "statute"]]);
check("appendix",
  statuteHits("9 U.S.C. App. § 1."),
  [["9 U.S.C. § 1", "statute"]]);
check("a reporter cite is not a U.S.C. cite",
  statuteHits("Anderson v. Liberty Lobby, Inc. (1986) 477 U.S. 242, 248."),
  []);

console.log("\n--- named federal codes ---");
check("Internal Revenue Code abbreviations",
  statuteHits("I.R.C. § 61; IRC § 501(c)(3)."),
  [["I.R.C. § 61", "statute"], ["I.R.C. § 501(c)(3)", "statute"]]);
check("Bankruptcy Code",
  statuteHits("Bankruptcy Code § 362(a)."),
  [["Bankr. Code § 362(a)", "statute"]]);
check("act spelled out",
  statuteHits("Employee Retirement Income Security Act § 502(a)(1)(B)."),
  [["ERISA § 502(a)(1)(B)", "statute"]]);
// The section marker is required for a named code: an act's name appears in
// ordinary prose often enough that a bare following number would be read as a
// citation far too often.
check("an act named in prose is not a citation",
  statuteHits("The Securities Exchange Act of 1934 requires 2004 disclosures."),
  []);

console.log("\n--- a chained section stops at the next citation ---");
// Both failures this guards were real: the chain invented "Treas. Reg. § 4"
// and then swallowed the "42" that "42 U.S.C. § 1983" needs.
check("federal cite after a federal cite",
  statuteHits("29 U.S.C. § 1132 and 42 U.S.C. § 1983."),
  [["29 U.S.C. § 1132", "statute"], ["42 U.S.C. § 1983", "statute"]]);
check("federal cite after a California cite",
  statuteHits("Civ. Code § 1542 and 42 U.S.C. § 1983."),
  [["CIV § 1542", "statute"], ["42 U.S.C. § 1983", "statute"]]);
check("genuine chains still chain",
  statuteHits("26 U.S.C. §§ 9801, 9802 and 9803."),
  [["26 U.S.C. § 9801", "statute"], ["26 U.S.C. § 9802", "statute"],
   ["26 U.S.C. § 9803", "statute"]]);
check("California chains are unaffected",
  statuteHits("Pen. Code §§ 187, 189, and 192."),
  [["PEN § 187", "statute"], ["PEN § 189", "statute"],
   ["PEN § 192", "statute"]]);

console.log("\n--- California detection is not disturbed ---");
check("CA codes still resolve",
  statuteHits("Code of Civil Procedure section 425.16; Civ. Code § 1542."),
  [["CCP § 425.16", "statute"], ["CIV § 1542", "statute"]]);
check("the model UCC still wins on a hyphenated section",
  statuteHits("Com. Code § 3-310."),
  [["UCC § 3-310", "statute"]]);

console.log("\n--- carry-over: a bare section inherits a federal code ---");
{
  const text = "29 C.F.R. § 2560.503-1 sets the deadline. Under § 2560.503-1(f), "
    + "the plan must decide within 45 days.";
  check("inherited reference keeps the whole section number",
    statuteHits(text),
    [["29 C.F.R. § 2560.503-1", "regulation"],
     ["29 C.F.R. § 2560.503-1(f)", "regulation"]]);
}

console.log("\n--- IRS revenue rulings ---");
check("abbreviated",
  statuteHits("Rev. Rul. 2013-17."),
  [["Rev. Rul. 2013-17", "guidance"]]);
check("spelled out",
  statuteHits("Revenue Ruling 2013-17."),
  [["Rev. Rul. 2013-17", "guidance"]]);
// Rulings before 2000 carry a two-digit year. The four-digit form has to be
// tried first, or "2013-17" reads as the two-digit "20" plus a stray "13-17".
check("two-digit year",
  statuteHits("Rev. Rul. 99-7; Rev. Rul. 83-137."),
  [["Rev. Rul. 99-7", "guidance"], ["Rev. Rul. 83-137", "guidance"]]);
check("an optional No.",
  statuteHits("Rev. Rul. No. 99-7."),
  [["Rev. Rul. 99-7", "guidance"]]);
check("plural, chained",
  statuteHits("See Rev. Ruls. 2003-102, 2003-103 and 2004-45."),
  [["Rev. Rul. 2003-102", "guidance"], ["Rev. Rul. 2003-103", "guidance"],
   ["Rev. Rul. 2004-45", "guidance"]]);

console.log("\n--- the bulletin cite is part of the citation ---");
// Bluebook T1.2 cites a ruling to the Cumulative Bulletin, or to its advance
// sheet the Internal Revenue Bulletin. The underline should cover the whole
// citation rather than stopping after the ruling number.
check("C.B. tail is underlined",
  spans("Rev. Rul. 83-137, 1983-2 C.B. 41."),
  ["Rev. Rul. 83-137, 1983-2 C.B. 41"]);
check("I.R.B. tail is underlined",
  spans("Rev. Rul. 96-55, 1996-49 I.R.B. 4."),
  ["Rev. Rul. 96-55, 1996-49 I.R.B. 4"]);
check("...but the key is the ruling number alone",
  statuteHits("Rev. Rul. 96-55, 1996-49 I.R.B. 4."),
  [["Rev. Rul. 96-55", "guidance"]]);
// PDF extraction turns the hyphen into whichever dash the typesetter used.
// Normalizing to ASCII keeps one authority from listing twice in the Table of
// Authorities.
check("an en dash is the same ruling",
  statuteHits("Rev. Rul. 96\u201355, 1996\u201349 I.R.B. 4."),
  [["Rev. Rul. 96-55", "guidance"]]);

console.log("\n--- a revenue ruling is not read out of ordinary prose ---");
check("no ruling number",
  statuteHits("The revenue rulings issued in 2013 were numerous."), []);
check("a year range is not a ruling",
  statuteHits("The court reviewed the 2013-2014 fiscal year."), []);
check("Revenue and Taxation Code still resolves",
  statuteHits("Revenue and Taxation Code section 23151."),
  [["RTC § 23151", "statute"]]);

console.log("\n--- search terms ---");
check("Treasury regulation becomes its C.F.R. section",
  federalSearchTerm("Treas. Reg. § 1.125"),
  { kind: "regulation", term: "26 C.F.R. § 1.125" });
// A proposed regulation has not been adopted into the C.F.R., so rewriting it
// would point at a section that does not exist. It is searched as written.
check("a proposed regulation is NOT rewritten",
  federalSearchTerm("Prop. Treas. Reg. § 1.125-1"),
  { kind: "regulation", term: "Prop. Treas. Reg. § 1.125-1" });
check("a temporary regulation is in the C.F.R. and converts",
  federalSearchTerm("Temp. Treas. Reg. § 1.125-4T"),
  { kind: "regulation", term: "26 C.F.R. § 1.125-4T" });
check("the Internal Revenue Code is 26 U.S.C. section-for-section",
  federalSearchTerm("I.R.C. § 9801(f)"),
  { kind: "statute", term: "26 U.S.C. § 9801(f)" });
// ERISA § 701 is 29 U.S.C. § 1181 — a section-by-section lookup table, not a
// formula — so the act keeps its own numbering and is found by popular name.
check("ERISA keeps the act's own numbering",
  federalSearchTerm("ERISA § 701"),
  { kind: "statute", term: "ERISA § 701" });
check("a revenue ruling is searched as written",
  federalSearchTerm("Rev. Rul. 2013-17"),
  { kind: "guidance", term: "Rev. Rul. 2013-17" });
check("California keys are not federal",
  federalSearchTerm("CCP § 425.16"), null);

console.log("\n--- URLs ---");
{
  const cite = { kind: "statute", key: "42 U.S.C. § 1983" };
  const wl = resolveUrl(cite, {}, "westlaw");
  // Westlaw's jurisdiction=CA filter scopes a search to California content and
  // would hide every federal result.
  check("federal statutes are not scoped to California",
    wl.includes("jurisdiction=CA"), false);
  check("...and search the statute databases",
    wl.includes("contentType=STATUTE"), true);
  check("Lexis gets the same term",
    decodeURIComponent(resolveUrl(cite, {}, "lexis").split("pdsearchterms=")[1]),
    "42 U.S.C. § 1983");
}
{
  const cite = { kind: "regulation", key: "Treas. Reg. § 1.125" };
  const wl = resolveUrl(cite, {}, "westlaw");
  check("a regulation searches the C.F.R. form",
    decodeURIComponent(wl.split("query=")[1]), "26 C.F.R. § 1.125");
  // Regulations are not statutes; the contentType=STATUTE filter would drop
  // them.
  check("...unfiltered by content type", wl.includes("contentType"), false);
}
{
  const cite = { kind: "guidance", key: "Rev. Rul. 2013-17" };
  const wl = resolveUrl(cite, {}, "westlaw");
  check("guidance is not scoped to California",
    wl.includes("jurisdiction=CA"), false);
  // A revenue ruling is not a statute; the contentType=STATUTE filter would
  // drop it.
  check("...nor filtered to the statute databases",
    wl.includes("contentType"), false);
  check("Westlaw gets the ruling number",
    decodeURIComponent(wl.split("query=")[1]), "Rev. Rul. 2013-17");
}
check("a curated repo entry still wins",
  resolveUrl(
    { kind: "regulation", key: "26 C.F.R. § 1.125" },
    { regulations: { "26 C.F.R. § 1.125": { westlaw_url: "https://example.test/x" } } },
    "westlaw"
  ),
  "https://example.test/x");

console.log("\n" + "=".repeat(60));
console.log(`FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
