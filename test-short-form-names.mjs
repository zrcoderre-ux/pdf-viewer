// Node-runnable tests: a case already cited in full is linked again when the
// document names it in short form.
// Run: node test-short-form-names.mjs
//
// The reported miss was a table of authorities whose entries carry the party
// names and the reporter cite but no year — not a full citation, so each line
// is linked only if the short-form pass recognizes the two parties. Eight
// entries out of twenty-one went unlinked, and each failure was a party name
// the capture couldn't hold whole:
//
//   "Careau & Co."                  the ampersand ended the name at "Co."
//   "F & H Construction"            same, on the defendant's side
//   "PCO, Inc."                     the comma before "Inc." ended it at "Inc."
//   "Committee on Children's ..."   the lowercase "on" ended it
//
// and one more that nothing in the name explains: the FIRST entry under the
// "Cases" heading, whose capture opened on the heading word itself, failed
// the registry lookup, and took the citation inside it down with it.

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

// The text each short-form link landed on, in document order.
const shortLinks = (text) =>
  findAllCitations(text).filter((c) => c.isShortForm).map((c) => c.matchText);

// Every link's [text, key].
const allLinks = (text) =>
  findAllCitations(text).map((c) => [c.matchText, c.key]);

// A brief that cites each case in full, then lists it in its table.
function brief(fullCites, tableLines) {
  return (
    fullCites.map((c) => `The court said as much in ${c}.`).join("\n\n") +
    "\n\nCases\n\n" +
    tableLines.join("\n\n")
  );
}

const FULL = [
  "Committee on Children's Television, Inc. v. General Foods Corp. (1983) 35 Cal.3d 197, 213-214",
  "Four Star Electric, Inc. v. F & H Construction (1992) 7 Cal.App.4th 1375, 1379",
  "Philipson & Simon v. Gulsvig (2007) 154 Cal.App.4th 347, 363",
  "PCO, Inc. v. Christensen, Miller, Fink, Jacobs, Glaser, Weil & Shapiro, LLP (2007) 150 Cal.App.4th 384, 395",
  "Holistic Supplements, L.L.C. v. Stark (2021) 61 Cal.App.5th 530, 542",
  "PacLink Communications Internat., Inc. v. Superior Court (2001) 90 Cal.App.4th 958, 964",
  "Careau & Co. v. Security Pacific Business Credit, Inc. (1990) 222 Cal.App.3d 1371, 1395",
  "Pacific Bay Recovery, Inc. v. California Physicians' Services, Inc. (2017) 12 Cal.App.5th 200, 214",
];
const TABLE = [
  "Committee on Children's Television v. General Foods Corp., 35 Cal.3d 197, 213-214",
  "Four Star Electric v. F & H Construction, 7 Cal.App.4th 1375, 1379",
  "Philipson & Simon v. Gulsvig, 154 Cal.App.4th 347, 363",
  "PCO, Inc. v. Christensen, Miller, 150 Cal.App.4th 384, 395",
  "Holistic Supplements v. Stark, 61 Cal.App.5th 530, 542",
  "PacLink Communications v. Superior Court, 90 Cal.App.4th 958, 964",
  "Careau & Co. v. Security Pacific, 222 Cal.App.3d 1371, 1395",
  "Pacific Bay Recovery v. California Physicians' Services, 12 Cal.App.5th 200, 214",
];

console.log("\n--- the eight table entries that went unlinked ---");
check(
  "every entry links back to the case cited in full",
  shortLinks(brief(FULL, TABLE)),
  [
    "Committee on Children's Television v. General Foods Corp.",
    "Four Star Electric v. F & H Construction",
    "Philipson & Simon v. Gulsvig",
    // The underline stops at the comma inside the firm's name: what follows a
    // comma there is as often the volume number as the next partner.
    "PCO, Inc. v. Christensen",
    "Holistic Supplements v. Stark",
    "PacLink Communications v. Superior Court",
    "Careau & Co. v. Security Pacific",
    "Pacific Bay Recovery v. California Physicians' Services",
  ]
);

console.log("\n--- the name the full citation itself is keyed under ---");
check(
  "a lowercase connector stays inside the plaintiff's name",
  allLinks("Committee on Children's Television, Inc. v. General Foods Corp. (1983) 35 Cal.3d 197, 213."),
  [[
    "Committee on Children's Television, Inc. v. General Foods Corp. (1983) 35 Cal.3d 197, 213",
    "Committee on Children's Television, Inc. v. General Foods Corp. (1983) 35 Cal.3d 197",
  ]]
);
check(
  "...but a connector that is only a lead-in is not",
  allLinks("The trial court relied on Gervase v. Superior Court (1995) 31 Cal.App.4th 1218, 1224."),
  [[
    "Gervase v. Superior Court (1995) 31 Cal.App.4th 1218, 1224",
    "Gervase v. Superior Court (1995) 31 Cal.App.4th 1218",
  ]]
);

console.log("\n--- the heading above the first entry ---");
{
  const text =
    "Teselle v. McLoughlin (2009) 173 Cal.App.4th 156, 179 is the rule.\n\n" +
    "Cases\n\nTeselle v. McLoughlin, 173 Cal.App.4th 156, 179";
  check(
    "the link lands on the case name, not on the heading before it",
    shortLinks(text),
    ["Teselle v. McLoughlin"]
  );
}

console.log("\n--- what the short form is allowed to shorten ---");
{
  const full = "Four Star Electric, Inc. v. F & H Construction (1992) 7 Cal.App.4th 1375, 1379";
  const say = (s) => `${full}. Later, ${s} was distinguished.`;
  check("a dropped corporate tail on the plaintiff",
    shortLinks(say("Four Star Electric v. F & H Construction")), ["Four Star Electric v. F & H Construction"]);
  check("a dropped word on the defendant",
    shortLinks(say("Four Star Electric, Inc. v. F & H")), ["Four Star Electric, Inc. v. F & H"]);
}

console.log("\n--- names that only look alike ---");
{
  const full = "Smith v. Jones (1990) 1 Cal.5th 1, 5";
  check("a longer word is not the same party",
    shortLinks(`${full}. Later, Smithson v. Jonesboro reached the opposite result.`), []);
  check("an unrelated case is not linked to it",
    shortLinks(`${full}. Later, Harper v. Wells said otherwise.`), []);
}

console.log("\n--- a connector the sentence, not the name, supplied ---");
{
  const full = "Chillon v. Ford Motor Co. (2023) 90 Cal.App.5th 1, 5";
  check("the trailing word is left out of the link",
    shortLinks(`${full}. Later, Chillon v. Ford and the trial court agreed.`),
    ["Chillon v. Ford"]);
  check("...and a following word is not read as the defendant's",
    shortLinks(`${full}. Later, Chillon v. Ford explained.`), ["Chillon v. Ford"]);
}

console.log("\n" + "=".repeat(60));
console.log(`FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
