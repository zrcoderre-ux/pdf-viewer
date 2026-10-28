// Node-runnable tests: a case name that follows another citation's short-name
// parenthetical opens on its own first word.
// Run: node test-cite-after-short-name.mjs
//
// The reported miss: "... Inc. v. Larry Barrett, Inc. (1972) 7 Cal.3d 695
// (Gensler) and Truestone, Inc. v. Simi West Industrial Park II (1984) 163
// Cal.App.3d 715 (Truestone)." The walk-back for Truestone crossed "and" as a
// name connector, took "(Gensler)" for a name word, and -- the corp marker on
// "Inc." licensing bare numbers -- ran on to Gensler's "v.". Truestone's span
// overlapped Gensler's and it went unlinked.

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

const caseLinks = (text) => findAllCitations(text)
  .filter((c) => c.kind === "case")
  .map((c) => c.matchText);

const GENSLER = "M. Arthur Gensler, Jr. & Associates, Inc. v. Larry Barrett, Inc. " +
  "(1972) 7 Cal.3d 695";
const TRUESTONE = "Truestone, Inc. v. Simi West Industrial Park II (1984) 163 Cal.App.3d 715";

console.log("\n--- two cites joined after a short-name parenthetical ---");
check("joined by \"and\"",
  caseLinks(`Plaintiff relies on ${GENSLER} (Gensler) and ${TRUESTONE} (Truestone).`),
  [GENSLER, TRUESTONE]);
check("joined by a comma",
  caseLinks(`See ${GENSLER} (Gensler), ${TRUESTONE}.`),
  [GENSLER, TRUESTONE]);
check("after a pincite",
  caseLinks(`(${GENSLER}, 699 (Gensler), and ${TRUESTONE}.)`),
  [GENSLER + ", 699", TRUESTONE]);
check("joined by \"and\" after a bare page number",
  caseLinks(`See ${GENSLER} and ${TRUESTONE}.`),
  [GENSLER, TRUESTONE]);

console.log("\n--- parentheticals inside a party name are still crossed ---");
check("a union local's number is no page number",
  caseLinks("Carpenters Local 12 (AFL) v. Roe (2011) 2 Cal.5th 3."),
  ["Carpenters Local 12 (AFL) v. Roe (2011) 2 Cal.5th 3"]);
check("a parenthetical after a word",
  caseLinks("The court in Hernandez (Maria) v. Roe (2011) 2 Cal.5th 3 held"),
  ["Hernandez (Maria) v. Roe (2011) 2 Cal.5th 3"]);

console.log(fails ? `\n${fails} FAILED` : "\nAll passed.");
process.exit(fails ? 1 : 0);
