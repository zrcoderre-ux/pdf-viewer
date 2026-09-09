// Node-runnable tests for chained section lists.
// Run: node test-section-lists.mjs
//
// A citation list is written with whatever connector the sentence wants:
// "sections 1010.6 or 1013 and 1170.7" is three citations, not one. The chain
// used to know only "and", so it stopped at the first "or" and left the rest of
// the list unlinked. These tests pin the connectors it accepts — comma, "and",
// "or", "and/or", "&", in any mixture — and the two things that still end a
// chain: the next citation, and a number that counts days rather than naming a
// section.

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

// Statute and regulation keys found in `text`, in document order.
function keys(text) {
  return findAllCitations(text)
    .filter((c) => c.kind === "statute" || c.kind === "regulation")
    .map((c) => c.key);
}

console.log("\n--- California sections in the alternative ---");
check("the reported case: 'or' no longer ends the list",
  keys("Code of Civil Procedure sections 1010.6 or 1013 and 1170.7."),
  ["CCP § 1010.6", "CCP § 1013", "CCP § 1170.7"]);
check("comma before the 'or'",
  keys("Civ. Code §§ 1542, 1543, or 1544."),
  ["CIV § 1542", "CIV § 1543", "CIV § 1544"]);
check("and/or",
  keys("Code of Civil Procedure section 1013 and/or 1013a."),
  ["CCP § 1013", "CCP § 1013a"]);
check("ampersand",
  keys("Gov. Code §§ 12940 & 12945."),
  ["GOV § 12940", "GOV § 12945"]);
check("'and' still chains (regression)",
  keys("Pen. Code §§ 187, 189, and 192."),
  ["PEN § 187", "PEN § 189", "PEN § 192"]);

console.log("\n--- the same connectors federally ---");
check("federal sections in the alternative",
  keys("26 U.S.C. §§ 9801, 9802 or 9803."),
  ["26 U.S.C. § 9801", "26 U.S.C. § 9802", "26 U.S.C. § 9803"]);
check("a chain still stops at the next citation",
  keys("29 U.S.C. § 1132 or 42 U.S.C. § 1983."),
  ["29 U.S.C. § 1132", "42 U.S.C. § 1983"]);

console.log("\n--- a chain after a carried-over bare reference ---");
check("the inherited code carries down the whole list",
  keys("Civil Code sections 1542, 1543. Later, §§ 1542, 1543, or 1544 recur."),
  ["CIV § 1542", "CIV § 1543", "CIV § 1542", "CIV § 1543", "CIV § 1544"]);

console.log("\n--- a number that counts days is not a section ---");
// The cost of accepting "or": "section 1013, or 10 court days" reads as a
// two-section list unless the unit word after the number stops it.
check("'or 10 court days' ends the list",
  keys("Service was complete under Code of Civil Procedure section 1013, or 10 court days later."),
  ["CCP § 1013"]);
check("'or 30 days' ends it too",
  keys("The motion was filed under Code of Civil Procedure section 1005 or 30 days before the hearing."),
  ["CCP § 1005"]);
check("'and 15 days' ends it",
  keys("Notice under Gov. Code § 12965 and 15 days after."),
  ["GOV § 12965"]);
check("a real section is not mistaken for a quantity",
  keys("Code of Civil Procedure sections 1005 and 1013 govern."),
  ["CCP § 1005", "CCP § 1013"]);

console.log("\n============================================================");
console.log(`FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
