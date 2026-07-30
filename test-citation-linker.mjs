// Node-runnable tests for the non-v. case-name family.
// Run: node test-citation-linker.mjs
//
// "Conservatorship of Whitley (2010) 50 Cal.4th 1206" has no "v." anchor, so
// it is only reachable through the NONV_PREFIX alternation in INRE_RE. This
// guards the whole family (In re / Estate of / Guardianship of /
// Conservatorship of / Adoption of / Marriage of): detection, the key the
// prefix is rebuilt into, the derived short name, and supra resolution.
//
// The nested-prefix case matters most. "In re Marriage of Bonds" is "In re" +
// "Marriage of" + "Bonds"; a single prefix strip leaves "Marriage of Bonds",
// whose first word makes every Marriage-of case share the short name
// "Marriage" — and findSupraCitations keeps only the FIRST cite per short
// name, so the second one would silently resolve every later supra to the
// first.

import { findAllCitations } from "./viewer/citation-linker.js";

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

// Return the single case citation found in `text`.
function onlyCase(text) {
  const cases = findAllCitations(text).filter((c) => c.kind === "case");
  if (cases.length !== 1) {
    throw new Error(`expected 1 case cite, got ${cases.length}: ${text}`);
  }
  return cases[0];
}

console.log("\n--- detection: every non-v. prefix ---");
const CASES = [
  ["Conservatorship of Whitley (2010) 50 Cal.4th 1206.",
   "Conservatorship of Whitley (2010) 50 Cal.4th 1206", "Whitley"],
  ["Estate of Bowles (2008) 169 Cal.App.4th 684.",
   "Estate of Bowles (2008) 169 Cal.App.4th 684", "Bowles"],
  ["Guardianship of Ann S. (2009) 45 Cal.4th 1110.",
   "Guardianship of Ann S. (2009) 45 Cal.4th 1110", "Ann"],
  ["Adoption of Kelsey S. (1992) 1 Cal.4th 816.",
   "Adoption of Kelsey S. (1992) 1 Cal.4th 816", "Kelsey"],
  ["In re Marriage of Bonds (2000) 24 Cal.4th 1.",
   "In re Marriage of Bonds (2000) 24 Cal.4th 1", "Bonds"],
  ["In re Doe (2009) 555 F.3d 100.",
   "In re Doe (2009) 555 F.3d 100", "Doe"],
];
for (const [text, wantKey, wantShort] of CASES) {
  const c = onlyCase(text);
  check(`${wantKey} — key`, c.key, wantKey);
  check(`${wantKey} — short`, c.short, wantShort);
}

console.log("\n--- OCR casing of 'In re' ---");
check("IN RE",
  onlyCase("IN RE DOE (2009) 555 F.3d 100.").key,
  "IN RE DOE (2009) 555 F.3d 100");

console.log("\n--- the linked span excludes the pinpoint page ---");
{
  const text = "The court in Conservatorship of Whitley (2010) 50 Cal.4th 1206, "
    + "1214 held otherwise.";
  const c = onlyCase(text);
  check("matchText", c.matchText,
    "Conservatorship of Whitley (2010) 50 Cal.4th 1206");
  check("span covers matchText", text.slice(c.span[0], c.span[1]), c.matchText);
}

console.log("\n--- Bluebook form ---");
check("bluebook key",
  onlyCase("Conservatorship of Whitley, 50 Cal.4th 1206 (2010).").key,
  "Conservatorship of Whitley (2010) 50 Cal.4th 1206");

console.log("\n--- supra resolves back to the full cite ---");
{
  const text = "Conservatorship of Whitley (2010) 50 Cal.4th 1206, 1214. "
    + "Later: Conservatorship of Whitley, supra, 50 Cal.4th at p. 1214.";
  const supras = findAllCitations(text).filter((c) => c.isSupra);
  check("one supra found", supras.length, 1);
  check("supra -> full cite", supras[0] && supras[0].key,
    "Conservatorship of Whitley (2010) 50 Cal.4th 1206");
}

console.log("\n--- nested prefixes don't collide on 'Marriage' ---");
{
  const text = "In re Marriage of Bonds (2000) 24 Cal.4th 1, 25. "
    + "In re Marriage of Davis (2015) 61 Cal.4th 846, 850. "
    + "See In re Marriage of Davis, supra, 61 Cal.4th at p. 850.";
  const supras = findAllCitations(text).filter((c) => c.isSupra);
  check("Davis supra -> Davis, not Bonds", supras[0] && supras[0].key,
    "In re Marriage of Davis (2015) 61 Cal.4th 846");
}

console.log("\n--- regression: v.-anchored and WL forms still parse ---");
{
  const text = "Aguilar v. Atlantic Richfield Co. (2001) 25 Cal.4th 826, 850. "
    + "In re Intuniv Antitrust Litig., Civil Action No. 1:16-cv-12653-ADB, "
    + "2021 WL 517386 (D. Mass. Feb. 11, 2021). "
    + "Ford Motor Warranty Cases (2025) 17 Cal.5th 1122. "
    + "See Aguilar, supra, 25 Cal.4th at p. 850.";
  const keys = findAllCitations(text)
    .filter((c) => c.kind === "case")
    .map((c) => c.key);
  check("Aguilar", keys.includes("Aguilar v. Atlantic Richfield Co. (2001) 25 Cal.4th 826"), true);
  check("Intuniv WL", keys.includes("In re Intuniv 2021 WL 517386"), true);
  check("Ford Motor Warranty Cases",
    keys.includes("Ford Motor Warranty Cases (2025) 17 Cal.5th 1122"), true);
  check("Aguilar supra resolves",
    findAllCitations(text).some((c) => c.isSupra && c.short === "Aguilar"), true);
}

console.log("\n" + "=".repeat(60));
console.log(`FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
