// Node-runnable tests: a citation that follows a quotation must not drag the
// quoted sentence into the case name.
// Run: node test-quote-before-citation.mjs
//
// walkBackForName stops at a sentence boundary by testing whether a token ends
// in "." with a lowercase letter before it. A closing quote HIDES that mark: a
// quotation ending a sentence reads `English.”`, whose last character is the
// quote, so the test was false and the walk-back sailed on through the sentence
// before the citation. The whole sentence came back as the case name, and
// anything linking off that span hyperlinked the judge's own quoted prose.
//
// The `Co.”` case is the subtle one. Stripping the quote alone is not enough:
// "Co." is exactly the corporate abbreviation the end-of-sentence test is
// written to allow through, so the boundary is missed a second way. A closing
// quote after the period settles it — abbreviations inside a party name are
// never followed by one.

import { findAllCitations } from "./viewer/citation-linker.js";

let fails = 0;

function check(label, got, want) {
  const ok = got === want;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        got : ${JSON.stringify(got)}`);
    console.log(`        want: ${JSON.stringify(want)}`);
    fails++;
  }
}

// The literal text of the single case citation found in `text`.
function span(text) {
  const cites = findAllCitations(text).filter((c) => c.kind === "case");
  if (cites.length !== 1) {
    throw new Error(`expected 1 cite, got ${cites.length}: ${JSON.stringify(text)}`);
  }
  return text.slice(cites[0].span[0], cites[0].span[1]);
}

const PENILLA = "Penilla v. Westmont Corp. (2016) 3 Cal.App.5th 205, 209";

console.log("\n--- a quotation before the citation is not part of the name ---");
check(
  "curly quote",
  span(
    "An arbitration provision is procedurally unconscionable where it " +
      "“was neither provided in a Spanish-language copy nor explained " +
      "to respondents who did not understand written English.” " +
      "(" + PENILLA + ".)"
  ),
  PENILLA
);
check("straight quote", span('It was "one-sided." (' + PENILLA + ".)"), PENILLA);
check(
  "question mark inside the quotation",
  span("Who signed it?” (" + PENILLA + ".)"),
  PENILLA
);
check(
  "quotation ending in a corporate abbreviation",
  span("a claim against the Co.” (" + PENILLA + ".)"),
  PENILLA
);

console.log("\n--- plain sentence boundaries still stop it (regression) ---");
check("unquoted period", span("The court so held. (" + PENILLA + ".)"), PENILLA);
check("no preceding sentence at all", span(PENILLA + "."), PENILLA);

console.log("\n--- names that must survive the closing-punctuation strip ---");
check(
  "possessive plaintiff",
  span("See Farmers' Insurance Exchange v. Superior Court (1992) 2 Cal.4th 377, 383."),
  "Farmers' Insurance Exchange v. Superior Court (1992) 2 Cal.4th 377, 383"
);
check(
  "abbreviated party name mid-sentence",
  span("as stated in Ford Motor Co. v. Superior Court (1973) 35 Cal.App.3d 676, 679."),
  "Ford Motor Co. v. Superior Court (1973) 35 Cal.App.3d 676, 679"
);
check(
  "multi-word corporate name",
  span("Aguilar v. Atlantic Richfield Co. (2001) 25 Cal.4th 826, 850."),
  "Aguilar v. Atlantic Richfield Co. (2001) 25 Cal.4th 826, 850"
);

console.log("\n" + "=".repeat(60));
console.log(`FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
