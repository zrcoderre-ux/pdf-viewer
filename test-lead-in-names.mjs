// Node-runnable tests: a party name that opens with a court or jurisdiction
// word keeps that word.
// Run: node test-lead-in-names.mjs
//
// Walk-back from "v." strips the words a sentence puts in front of a case
// name. "court", "supreme", "federal", "state" and "california" were stripped
// with the signals ("See", "In", "the"), which is right for a lead-in ("as held
// by the Supreme Court. Smith v. Jones", "In California, Smith v. Jones") and
// wrong for the many names that begin with them. The reported miss was
// "State of California v. Superior Court (Flynn) (2016) 4 Cal.App.5th 94":
// every word of its plaintiff was stripped and it was not linked at all. A
// name like "State Farm Mut. Auto. Ins. Co." lost its first word instead, and
// linked from "Farm".
//
// Those words now go only through a run that ends in its own period or comma.
// The same change reaches the short references: "Flynn, supra" and an
// italicized *Flynn* name the case by its real party in interest, and "State
// Farm, supra" (read by the supra pattern as "Farm, supra") still resolves.

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

// [linked text, key] of every case link in `text`.
function caseLinks(text, italicWords = []) {
  const italicRanges = [];
  for (const w of italicWords) {
    for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + 1)) {
      italicRanges.push([i, i + w.length]);
    }
  }
  return findAllCitations(text, { italicRanges })
    .filter((c) => c.kind === "case")
    .map((c) => [c.matchText, c.key]);
}

const FLYNN = "State of California v. Superior Court (Flynn) (2016) 4 Cal.App.5th 94";
const STATE_FARM = "State Farm Mut. Auto. Ins. Co. v. Campbell (2003) 538 U.S. 408";
const CTA = "California Teachers Assn. v. State of California (1999) 20 Cal.4th 327";

console.log("\n--- a name that opens with a court or jurisdiction word ---");
check("State of California, bare", caseLinks(FLYNN), [[FLYNN, FLYNN]]);
check(
  "State of California, after a signal and with a pin cite",
  caseLinks("(See " + FLYNN + ", 100.)"),
  [[FLYNN + ", 100", FLYNN]]
);
check(
  "State of California, after a sentence ending in Court.",
  caseLinks("That was affirmed by the Court. " + FLYNN + "."),
  [[FLYNN, FLYNN]]
);
check("State Farm", caseLinks("See also " + STATE_FARM + "."), [[STATE_FARM, STATE_FARM]]);
check("California Teachers Assn.", caseLinks(CTA + "."), [[CTA, CTA]]);
check(
  "Federal Deposit Ins. Corp.",
  caseLinks("Federal Deposit Ins. Corp. v. Mmahat (5th Cir. 1990) 907 F.2d 546"),
  [["Federal Deposit Ins. Corp. v. Mmahat (5th Cir. 1990) 907 F.2d 546",
    "Federal Deposit Ins. Corp. v. Mmahat (1990) 907 F.2d 546"]]
);
check(
  "Supreme Court of Virginia",
  caseLinks("Supreme Court of Virginia v. Consumers Union (1980) 446 U.S. 719"),
  [["Supreme Court of Virginia v. Consumers Union (1980) 446 U.S. 719",
    "Supreme Court of Virginia v. Consumers Union (1980) 446 U.S. 719"]]
);

console.log("\n--- a lead-in set off by its own period or comma is still dropped ---");
const SMITH = "Smith v. Jones (2010) 50 Cal.4th 1";
check("the Supreme Court.", caseLinks("as decided by the Supreme Court. " + SMITH), [[SMITH, SMITH]]);
check("In California,", caseLinks("In California, " + SMITH), [[SMITH, SMITH]]);
check("the State.", caseLinks("against the State. " + SMITH), [[SMITH, SMITH]]);
check("California Supreme Court,", caseLinks("California Supreme Court, " + SMITH), [[SMITH, SMITH]]);
check(
  "People of the State of California ex rel. (regression)",
  caseLinks("People of the State of California ex rel. Department of Transportation v. " +
    "Quillmark Industries, Inc. (2019) 31 Cal.App.5th 1121"),
  [["People of the State of California ex rel. Department of Transportation v. " +
      "Quillmark Industries, Inc. (2019) 31 Cal.App.5th 1121",
    "People of the State of California ex rel. Department of Transportation v. " +
      "Quillmark Industries, Inc. (2019) 31 Cal.App.5th 1121"]]
);

console.log("\n--- short references to those cases ---");
check(
  "Flynn, supra (the real party in interest)",
  caseLinks("(" + FLYNN + ", 99.) Later: (Flynn, supra, 4 Cal.App.5th at p. 100.)").slice(1),
  [["Flynn, supra", FLYNN]]
);
check(
  "italic Flynn",
  caseLinks("(" + FLYNN + ", 99.) The court in Flynn held.", ["Flynn"]).slice(1),
  [["Flynn", FLYNN]]
);
check(
  "People v. Superior Court (Romero): Romero, supra",
  caseLinks("People v. Superior Court (Romero) (1996) 13 Cal.4th 497. (Romero, supra, at p. 500.)")
    .slice(1),
  [["Romero, supra", "People v. Superior Court (Romero) (1996) 13 Cal.4th 497"]]
);
check(
  "State Farm, supra links as before, from Farm",
  caseLinks(STATE_FARM + ". Later, State Farm, supra, 538 U.S. at p. 410.").slice(1),
  [["Farm, supra", STATE_FARM]]
);
check(
  "italic State Farm links both words",
  caseLinks(STATE_FARM + ". The court in State Farm held.", ["State Farm"]).slice(1),
  [["State Farm", STATE_FARM]]
);
check(
  "italic California Teachers links both words",
  caseLinks(CTA + ". In California Teachers the court held.", ["California Teachers"]).slice(1),
  [["California Teachers", CTA]]
);
check(
  "a bare italic State names nothing",
  caseLinks(FLYNN + ". The State argued.", ["State"]).slice(1),
  []
);

console.log("\n" + "=".repeat(60));
console.log(`FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
