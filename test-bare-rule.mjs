// Node-runnable tests for bare rule references.
// Run: node test-bare-rule.mjs
//
// A California brief names the rules of court once, if at all, and then cites
// them bare: "rule 3.1350(f)", "Rule 8.204". An unqualified rule number is
// read as a California rule of court. These tests pin what that assumption
// does and does not reach: it needs the word "rule", it needs a dotted rule
// number, it yields to a rule set the text actually names, and it stands down
// when the adjacent words point somewhere other than California.

import { findAllCitations } from "./viewer/citation-linker.js";

// Pages are joined with "\n\f\n" by ingestPage; mirror that here.
const page = (...pages) => pages.join("\n\f\n");

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

// Rule keys found in `text`, in document order.
function ruleKeys(text) {
  return findAllCitations(text).filter((c) => c.kind === "rule").map((c) => c.key);
}

// The text each rule cite highlights, in document order.
function ruleTexts(text) {
  return findAllCitations(text).filter((c) => c.kind === "rule").map((c) => c.matchText);
}

console.log("\n--- a bare rule is a California rule of court ---");
{
  const text = "The separate statement must comply with rule 3.1350(f).";
  check("bare rule linked to the rules of court",
    ruleKeys(text), ["Cal. Rules of Court, rule 3.1350"]);
  check("the span covers the subpart", ruleTexts(text), ["rule 3.1350(f)"]);
}
{
  const text = "Rule 8.204 governs the form of the brief.";
  check("sentence-initial capital", ruleKeys(text), ["Cal. Rules of Court, rule 8.204"]);
}
{
  const text = "Moving papers were served 16 court days before the hearing. Rule 3.1300(a).";
  check("a rule standing alone as its own sentence",
    ruleKeys(text), ["Cal. Rules of Court, rule 3.1300"]);
}
{
  const text =
    "Defendant cites California Rules of Court, rule 3.1345 for the format, and " +
    "rule 3.1345(c) for the content.";
  check("named cite first, bare cite after",
    ruleKeys(text),
    ["Cal. Rules of Court, rule 3.1345", "Cal. Rules of Court, rule 3.1345"]);
  check("the named cite keeps its full span",
    ruleTexts(text),
    ["California Rules of Court, rule 3.1345", "rule 3.1345(c)"]);
}

console.log("\n--- what the assumption does not reach ---");
{
  const text = "Section 5 of the lease and rule 5 of the club bylaws are not rules of court.";
  check("an undotted number is not a rule of court", ruleKeys(text), []);
}
{
  const text = "Dismissal is sought under rule 12(b)(6).";
  check("a federal rule number carries no dot either", ruleKeys(text), []);
}
{
  const text = "The court will rule 30 days after submission.";
  check("\"rule\" as a verb", ruleKeys(text), []);
}
{
  const text = "Removal was improper under the Federal Rules of Civil Procedure, rule 26.1.";
  check("a federal rule set named alongside the number", ruleKeys(text), []);
}
{
  const text = "Counsel violated local rule 3.57 of this court.";
  check("a local rule is not assumed Californian", ruleKeys(text), []);
}

console.log("\n--- rules of professional conduct keep their own set ---");
{
  const text = "Counsel is disqualified under Cal. Rules of Prof. Conduct, rule 1.9.";
  check("a named professional-conduct rule",
    ruleKeys(text), ["Cal. Rules of Prof. Conduct, rule 1.9"]);
  check("the span covers the whole cite",
    ruleTexts(text), ["Cal. Rules of Prof. Conduct, rule 1.9"]);
}
{
  const text = "The Rules of Professional Conduct 3.7 bar the advocate-witness.";
  check("the older bare-number form still works",
    ruleKeys(text), ["Cal. Rules of Prof. Conduct, rule 3.7"]);
}
{
  const text =
    "Counsel breached the Rules of Professional Conduct, 9 Cal.4th 275, 283.";
  check("a case cite after the rule set is not a rule number", ruleKeys(text), []);
}

console.log("\n--- carry-over: the page names the set once ---");
{
  const text =
    "Counsel is disqualified under Cal. Rules of Prof. Conduct, rule 1.9. " +
    "Rule 1.9(a) reaches a substantially related matter.";
  check("a bare number the page already placed keeps that set",
    ruleKeys(text),
    ["Cal. Rules of Prof. Conduct, rule 1.9", "Cal. Rules of Prof. Conduct, rule 1.9"]);
}
{
  const text =
    "Rule 1.9(a) reaches a substantially related matter. That is what " +
    "Cal. Rules of Prof. Conduct, rule 1.9 provides.";
  check("carry-over reads backwards within the page too",
    ruleKeys(text),
    ["Cal. Rules of Prof. Conduct, rule 1.9", "Cal. Rules of Prof. Conduct, rule 1.9"]);
}
{
  const text =
    "The motion cites California Rules of Court, rule 3.1345 for the format. " +
    "Rule 3.1345(c) states what the separate statement must contain.";
  check("a rule of court named on the page carries the same way",
    ruleKeys(text),
    ["Cal. Rules of Court, rule 3.1345", "Cal. Rules of Court, rule 3.1345"]);
}
{
  const text =
    "Fees are set by California Rules of Court, rule 1.5, and conflicts by " +
    "the Rules of Professional Conduct, rule 1.5. Rule 1.5 is contested.";
  check("one number, two sets on the page — the bare reference is left alone",
    ruleKeys(text),
    ["Cal. Rules of Court, rule 1.5", "Cal. Rules of Prof. Conduct, rule 1.5"]);
}
{
  const text = page(
    "Counsel is disqualified under Cal. Rules of Prof. Conduct, rule 1.9.",
    "The prior representation is substantially related. Rule 1.9 applies."
  );
  check("carry-over stops at the page break",
    ruleKeys(text),
    ["Cal. Rules of Prof. Conduct, rule 1.9", "Cal. Rules of Court, rule 1.9"]);
}

console.log("\n--- a page arguing conduct reads its bare rules that way ---");
{
  const text =
    "Cal. Rules of Prof. Conduct, rule 1.9 bars the successive representation, " +
    "and rule 1.7 bars the concurrent one.";
  check("a second number on a conduct page follows the page",
    ruleKeys(text),
    ["Cal. Rules of Prof. Conduct, rule 1.9", "Cal. Rules of Prof. Conduct, rule 1.7"]);
}
{
  const text =
    "The hearing was noticed under rule 3.1300. Counsel is disqualified under " +
    "Cal. Rules of Prof. Conduct, rule 1.9.";
  check("a rule cited before the conduct discussion keeps the default",
    ruleKeys(text),
    ["Cal. Rules of Court, rule 3.1300", "Cal. Rules of Prof. Conduct, rule 1.9"]);
}
{
  const text =
    "Cal. Rules of Prof. Conduct, rule 1.9 governs. The motion was noticed " +
    "under California Rules of Court, rule 3.1300, and rule 3.1350 controls " +
    "the separate statement.";
  check("a page that names both sets flips nothing",
    ruleKeys(text),
    ["Cal. Rules of Prof. Conduct, rule 1.9", "Cal. Rules of Court, rule 3.1300",
     "Cal. Rules of Court, rule 3.1350"]);
}
{
  const text = page(
    "The motion is timely under California Rules of Court, rule 3.1300.",
    "Cal. Rules of Prof. Conduct, rule 1.9 governs the conflict, and the " +
    "hearing was set under rule 3.1300."
  );
  check("a number the document ties to the rules of court keeps that set",
    ruleKeys(text),
    ["Cal. Rules of Court, rule 3.1300", "Cal. Rules of Prof. Conduct, rule 1.9",
     "Cal. Rules of Court, rule 3.1300"]);
}

console.log("\n" + "=".repeat(60));
console.log(`FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
