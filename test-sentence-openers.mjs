// Node-runnable tests: the word a sentence opens on is not part of the case
// name that follows it.
// Run: node test-sentence-openers.mjs
//
// Walk-back from "v." takes any capitalized word for part of the plaintiff's
// name and strips only the signals it knows ("See", "In", "But"). The reported
// miss:
//
//   Discussing Quilala v. Securitas Security Services USA, Inc. (2025) 117
//   Cal.App.5th 75 (Quilala), the court stated: ...
//
// linked from "Discussing". Every participle or sentence adverb a ruling opens
// on did the same ("Citing", "Applying", "Relying on", "Under", "However,").
// They are signal prefixes now (SENTENCE_OPENERS). Words a party name opens on
// stay off that list, and the names here check that they still link whole.

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

// The text each case link covers, in document order.
const caseLinks = (text) =>
  findAllCitations(text).filter((c) => c.kind === "case").map((c) => c.matchText);

const QUILALA =
  "Quilala v. Securitas Security Services USA, Inc. (2025) 117 Cal.App.5th 75";

console.log("\n--- the reported sentence ---");
check(
  "Discussing",
  caseLinks(
    "Discussing " + QUILALA + " (Quilala), the court stated: “Thus, whether " +
      "the employee in Quilala alleged a claim of sexual harassment under FEHA " +
      "turned on whether his supervisors and coworkers harassed him because of " +
      "his sex, and not on whether they referred to him with vulgar or " +
      "sexualized language.”"
  ),
  [QUILALA]
);

console.log("\n--- other words a sentence opens on ---");
for (const lead of [
  "Citing", "Quoting", "Applying", "Following", "Relying on", "Construing",
  "Considering", "Distinguishing", "Rejecting", "Like", "Unlike", "Under",
  "After", "However,", "Similarly,", "Accordingly,", "Thus,", "Here,",
]) {
  check(lead, caseLinks(`${lead} ${QUILALA}, the court held.`), [QUILALA]);
}

console.log("\n--- short references after an opener ---");
check(
  "Discussing Quilala v. Securitas (short form)",
  caseLinks(QUILALA + ". Discussing Quilala v. Securitas, the court held.").slice(1),
  ["Quilala v. Securitas"]
);
check(
  "Discussing Quilala, supra",
  caseLinks(QUILALA + ". Discussing Quilala, supra, the court held.").slice(1),
  ["Quilala, supra"]
);

console.log("\n--- names that open on a word like these still link whole ---");
for (const cite of [
  "First American Title Ins. Co. v. Superior Court (2007) 146 Cal.App.4th 956",
  "Contra Costa County v. Smith (2010) 50 Cal.4th 1",
  "Building Industry Assn. v. City of Oceanside (1994) 27 Cal.App.4th 744",
  "In re Marriage of Bonds (2000) 24 Cal.4th 1",
]) {
  check(cite.split(" (")[0], caseLinks(`See ${cite}.`), [cite]);
}

console.log("\n" + "=".repeat(60));
console.log(`FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
