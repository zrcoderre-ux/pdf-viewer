// Node-runnable tests: a case already cited in full is linked again when the
// document names it in short form.
// Run: node test-short-form-names.mjs
//
// The reported miss was a table of authorities whose entries carry the party
// names and the reporter cite but no year. Eight entries out of twenty-one
// went unlinked, and each failure was a party name the capture couldn't hold
// whole — the names still have to be read correctly for such an entry to
// reach the key of the case cited in full elsewhere, and for a bare name with
// no cite of its own to link at all:
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

// Every case link's [text, key], in document order, from `at` onward.
const caseLinksFrom = (text, at) =>
  findAllCitations(text)
    .filter((c) => c.kind === "case" && c.span[0] >= at)
    .map((c) => [c.matchText, c.key]);

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
{
  // Each entry carries a reporter cite of its own, so it is read as a citation
  // in its own right; the key it resolves to is the one the full citation
  // earlier in the brief established, so the table adds no second entry to the
  // Table of Authorities.
  const text = brief(FULL, TABLE);
  const table = text.indexOf("\n\nCases\n\n");
  check(
    "every entry links, under the key of the case cited in full",
    caseLinksFrom(text, table),
    [
      [TABLE[0], "Committee on Children's Television, Inc. v. General Foods Corp. (1983) 35 Cal.3d 197"],
      [TABLE[1], "Four Star Electric, Inc. v. F & H Construction (1992) 7 Cal.App.4th 1375"],
      [TABLE[2], "Philipson & Simon v. Gulsvig (2007) 154 Cal.App.4th 347"],
      [TABLE[3], "PCO, Inc. v. Christensen, Miller, Fink, Jacobs, Glaser, Weil & Shapiro, LLP (2007) 150 Cal.App.4th 384"],
      [TABLE[4], "Holistic Supplements, L.L.C. v. Stark (2021) 61 Cal.App.5th 530"],
      [TABLE[5], "PacLink Communications Internat., Inc. v. Superior Court (2001) 90 Cal.App.4th 958"],
      [TABLE[6], "Careau & Co. v. Security Pacific Business Credit, Inc. (1990) 222 Cal.App.3d 1371"],
      [TABLE[7], "Pacific Bay Recovery, Inc. v. California Physicians' Services, Inc. (2017) 12 Cal.App.5th 200"],
    ]
  );
}

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
    "the link lands on the entry, not on the heading before it",
    caseLinksFrom(text, text.indexOf("\n\nCases\n\n")),
    [["Teselle v. McLoughlin, 173 Cal.App.4th 156, 179",
      "Teselle v. McLoughlin (2009) 173 Cal.App.4th 156"]]
  );
}
{
  // The same heading, with a name no citation follows: here the short-form
  // pass is the only thing that can link it, and it has to look past the
  // heading word its capture opened on.
  const text =
    "Teselle v. McLoughlin (2009) 173 Cal.App.4th 156, 179 is the rule.\n\n" +
    "Cases\n\nTeselle v. McLoughlin";
  check(
    "a bare name under the heading still links",
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
