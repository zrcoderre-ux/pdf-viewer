// Node-runnable tests for same-page section-number carry-over.
// Run: node test-section-carryover.mjs
//
// Briefs name a code once and then drop it: "Code of Civil Procedure section
// 425.16" up top, "§ 425.16(b)" and "section 425.16" for the rest of the page.
// The later references are the same statute and must link to it. The pass that
// does this is deliberately narrow, and these tests pin the boundaries:
// carry-over runs FORWARD only, stops at the page break, and stands down when
// one page ties the same number to two different codes.

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

// Statute keys found in `text`, in document order.
function statuteKeys(text) {
  return findAllCitations(text).filter((c) => c.kind === "statute").map((c) => c.key);
}

// The text each statute cite highlights, in document order.
function statuteTexts(text) {
  return findAllCitations(text).filter((c) => c.kind === "statute").map((c) => c.matchText);
}

// Pages are joined with "\n\f\n" by ingestPage; mirror that here.
const page = (...pages) => pages.join("\n\f\n");

console.log("\n--- carry-over on the same page ---");
{
  const text =
    "Defendant moves under Code of Civil Procedure section 425.16. " +
    "The § 425.16(b) burden falls on plaintiff. Section 425.16 is broadly construed.";
  check("bare references inherit the code",
    statuteKeys(text),
    ["CCP § 425.16", "CCP § 425.16(b)", "CCP § 425.16"]);
  check("each reference keeps its own span",
    statuteTexts(text),
    ["Code of Civil Procedure section 425.16", "§ 425.16(b)", "Section 425.16"]);
}
{
  // The code-named cite points into a subpart; the bare one points at the
  // whole section. Subparts are ignored when matching the two up.
  const text = "Civil Code section 3287(a) governs. Interest under § 3287 accrues.";
  check("subparts don't block the match", statuteKeys(text),
    ["CIV § 3287(a)", "CIV § 3287"]);
}
{
  const text = "Plaintiff sues under 42 U.S.C. § 1983. The § 1983 claim is time-barred.";
  check("federal title carries over", statuteKeys(text),
    ["42 U.S.C. § 1983", "42 U.S.C. § 1983"]);
}
{
  const text = "See U.C.C. § 3-310, subdivision (b). The § 3-310 presumption applies.";
  check("model UCC hyphenated section carries over", statuteKeys(text),
    ["UCC § 3-310", "UCC § 3-310"]);
}
{
  const text = "Civil Code sections 1542, 1543. Later, §§ 1542, 1543, and 1544 recur.";
  check("chained sections after a carried-over reference inherit too",
    statuteKeys(text),
    ["CIV § 1542", "CIV § 1543", "CIV § 1542", "CIV § 1543", "CIV § 1544"]);
}

console.log("\n--- boundaries ---");
{
  const text = "Bare § 1542 appears first. Then Civil Code section 1542 names it.";
  check("a reference BEFORE the code-named cite stays unlinked",
    statuteKeys(text), ["CIV § 1542"]);
}
{
  const text = page(
    "Civil Code section 1542 is discussed on page one.",
    "On page two, § 1542 stands alone."
  );
  check("carry-over stops at the page break", statuteKeys(text), ["CIV § 1542"]);
}
{
  const text =
    "Civil Code section 1542 and Penal Code section 1542 are both cited. " +
    "The § 1542 reference could be either.";
  check("two codes, one number — bare reference left unlinked",
    statuteKeys(text), ["CIV § 1542", "PEN § 1542"]);
}
{
  const text =
    "Code of Civil Procedure section 425.16 applies. Section 5 of the lease and " +
    "§ 12 of the contract do not.";
  check("unrelated section numbers are not swept in",
    statuteKeys(text), ["CCP § 425.16"]);
}
{
  // A later reference that names its OWN code wins outright — no inheritance.
  const text = "Civil Code section 1542 first. Penal Code section 1542 second.";
  check("a reference with its own code keeps it",
    statuteKeys(text), ["CIV § 1542", "PEN § 1542"]);
}

console.log("\n" + "=".repeat(60));
console.log(`FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
