// Node-runnable tests: a case citation the document gives without a year.
// Run: node test-yearless-citations.mjs
//
//   "Doe v. City of Los Angeles, 42 Cal.4th 531, 550"
//
// A table of authorities is written this way, and so is a brief that leaves
// the year out on a later reference. Every other tail the linker knows is
// anchored by a year parenthetical — "(2007) 42 Cal.4th 531" or "42 Cal.4th
// 531 (2007)" — and without one, none of them matched: a whole table of
// authorities went unlinked.
//
// The year is what usually proves a reporter cite is a citation, so this tail
// is a FALLBACK, tried only where no year-bearing tail matched, and the proof
// falls to the reporter table instead: "42 Cal.4th 531" is a citation because
// Cal.4th is a reporter, and "5 March 2020" is not because March is not.

import { findAllCitations, resolveUrl } from "./viewer/citation-linker.js";

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

const cases = (text) =>
  findAllCitations(text).filter((c) => c.kind === "case").map((c) => [c.matchText, c.key]);

console.log("\n--- a citation with no year links on its own ---");
check(
  "the California comma form",
  cases("Doe v. City of Los Angeles, 42 Cal.4th 531, 550 is the rule."),
  [["Doe v. City of Los Angeles, 42 Cal.4th 531, 550", "Doe v. City of Los Angeles 42 Cal.4th 531"]]
);
check(
  "no comma before the volume either",
  cases("Doe v. City of Los Angeles 42 Cal.4th 531 is the rule."),
  [["Doe v. City of Los Angeles 42 Cal.4th 531", "Doe v. City of Los Angeles 42 Cal.4th 531"]]
);
check(
  "a federal reporter",
  cases("See Erickson v. Pardus, 551 U.S. 89, 94."),
  [["Erickson v. Pardus, 551 U.S. 89, 94", "Erickson v. Pardus 551 U.S. 89"]]
);
check(
  "a pin-cite range",
  cases("Committee on Children's Television v. General Foods Corp., 35 Cal.3d 197, 213-214."),
  [["Committee on Children's Television v. General Foods Corp., 35 Cal.3d 197, 213-214",
    "Committee on Children's Television v. General Foods Corp. 35 Cal.3d 197"]]
);

console.log("\n--- the year-bearing forms still win where they appear ---");
check(
  "California Style Manual",
  cases("Doe v. City of Los Angeles (2007) 42 Cal.4th 531, 550."),
  [["Doe v. City of Los Angeles (2007) 42 Cal.4th 531, 550", "Doe v. City of Los Angeles (2007) 42 Cal.4th 531"]]
);
check(
  "Bluebook",
  cases("Doe v. City of Los Angeles, 42 Cal.4th 531, 550 (2007)."),
  [["Doe v. City of Los Angeles, 42 Cal.4th 531, 550 (2007)", "Doe v. City of Los Angeles (2007) 42 Cal.4th 531"]]
);

console.log("\n--- one case, one key ---");
{
  const text =
    "Doe v. City of Los Angeles (2007) 42 Cal.4th 531, 550 is the rule.\n\n" +
    "Cases\n\nDoe v. City of Los Angeles, 42 Cal.4th 531, 550";
  check(
    "the table entry takes the key of the full citation above it",
    cases(text).map(([, key]) => key),
    [
      "Doe v. City of Los Angeles (2007) 42 Cal.4th 531",
      "Doe v. City of Los Angeles (2007) 42 Cal.4th 531",
    ]
  );
}
check(
  "...and a yearless citation anchors the short forms that follow it",
  findAllCitations(
    "Careau & Co. v. Security Pacific Business Credit, Inc., 222 Cal.App.3d 1371, 1395. " +
    "Later, Careau & Co. v. Security Pacific was distinguished."
  ).filter((c) => c.isShortForm).map((c) => [c.matchText, c.key]),
  [["Careau & Co. v. Security Pacific",
    "Careau & Co. v. Security Pacific Business Credit, Inc. 222 Cal.App.3d 1371"]]
);

console.log("\n--- what a missing year must not turn into a citation ---");
check(
  "a date in a sentence",
  cases("The parties met on 5 March 2020 in Los Angeles and never spoke again."),
  []
);
check(
  "a case named with no citation at all",
  cases("Smith v. Jones was decided last year."),
  []
);
check(
  "a short-form reference the supra pass owns",
  cases("Doe v. Roe, supra, 42 Cal.4th 531, 550."),
  []
);
check(
  "an unknown reporter",
  cases("Doe v. City of Los Angeles, 42 Widgets 531, 550."),
  []
);
check(
  "a sentence that runs on into a reporter cite",
  cases("The court in Doe v. Roe held, at 42 Cal.4th 531, that the rule applies."),
  []
);
check(
  "...and one that reads as a caption",
  cases("Plaintiff v. Defendant arguments aside, the 12 Cal.App.5th 1 volume is not cited."),
  []
);

console.log("\n--- a string cite, each one taken on its own ---");
check(
  "two yearless cites in one parenthetical",
  cases("(See Doe v. Roe, 42 Cal.4th 531, 535-536; see also Smith v. Jones, 12 Cal.App.5th 1, 5.)"),
  [
    ["Doe v. Roe, 42 Cal.4th 531, 535-536", "Doe v. Roe 42 Cal.4th 531"],
    ["Smith v. Jones, 12 Cal.App.5th 1, 5", "Smith v. Jones 12 Cal.App.5th 1"],
  ]
);
check(
  "a table's page numbers stay out of the link",
  cases("Doe v. City of Los Angeles, 42 Cal.4th 531 ................ 12, 14"),
  [["Doe v. City of Los Angeles, 42 Cal.4th 531", "Doe v. City of Los Angeles 42 Cal.4th 531"]]
);

console.log("\n--- the search URL is built from the reporter cite alone ---");
{
  const [cite] = findAllCitations("Doe v. City of Los Angeles, 42 Cal.4th 531, 550.");
  check("Westlaw", decodeURIComponent(resolveUrl(cite, {}, "westlaw")).includes("cite=42 Cal.4th 531"), true);
  check("Lexis+", decodeURIComponent(resolveUrl(cite, {}, "lexis"))
    .includes("Doe v. City of Los Angeles 42 Cal.4th 531"), true);
}

console.log("\n" + "=".repeat(60));
console.log(`FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
