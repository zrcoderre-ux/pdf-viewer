// Node-runnable tests for a case name whose "v." is written without its
// period, or as "vs.". Run: node test-v-separator.mjs
//
// "Branick v Downey Savings & Loan Assn (2006) 39 Cal.4th 235" went unlinked:
// every case cite was found from its " v. " anchor, so a cite written with a
// bare "v" had no anchor at all. Each spelling must link, and must take the
// same key as the Style Manual spelling, so the Table of Authorities holds one
// entry and the supra and short-form passes find the case.

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
const cases = (t) => findAllCitations(t).filter((c) => c.kind === "case");

console.log("\n--- full cites with v, vs. or vs ---");
const KEY = "Branick v. Downey Savings & Loan Assn (2006) 39 Cal.4th 235";
for (const t of [
  "(Branick v Downey Savings & Loan Assn (2006) 39 Cal.4th 235, 240.)",
  "(Branick vs. Downey Savings & Loan Assn (2006) 39 Cal.4th 235, 240.)",
  "(Branick vs Downey Savings & Loan Assn (2006) 39 Cal.4th 235, 240.)",
  "Branick v Downey Savings & Loan Assn, 39 Cal.4th 235, 240 (2006).",
]) {
  const c = cases(t);
  check(`${t} — one cite`, c.length, 1);
  check(`${t} — key`, c[0] && c[0].key, KEY);
  check(`${t} — span opens on the plaintiff`, c[0] && c[0].matchText.startsWith("Branick "), true);
}

console.log("\n--- other reporters ---");
for (const [t, key] of [
  ["See Smith v Jones Co. (2010) 180 Cal.App.4th 1, 5.",
   "Smith v. Jones Co. (2010) 180 Cal.App.4th 1"],
  ["See Doe v Roe Corp. (2023) 15 Cal.5th 100.",
   "Doe v. Roe Corp. (2023) 15 Cal.5th 100"],
  ["See Lee v Bank of America (2019) 31 Cal.App.5th 1009.",
   "Lee v. Bank of America (2019) 31 Cal.App.5th 1009"],
]) {
  const c = cases(t);
  check(`${t} — key`, c.map((x) => x.key), [key]);
}

console.log("\n--- one key for both spellings; supra and short form ---");
{
  const t = "Branick v. Downey Savings & Loan Assn (2006) 39 Cal.4th 235. " +
    "See Branick v Downey Savings & Loan Assn (2006) 39 Cal.4th 235, 241. " +
    "In Branick v Downey the court held so. (Branick, supra, at p. 242.)";
  const c = cases(t);
  check("every reference keyed to the case", c.map((x) => x.key),
    [KEY, KEY, KEY, KEY]);
  check("short form matched", c.some((x) => x.matchText === "Branick v Downey"), true);
}

console.log("\n--- no tail, no link ---");
check("a lone v in prose", cases("Under part v of the plan, Smith v Jones settled."), []);

console.log(`\nFAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
