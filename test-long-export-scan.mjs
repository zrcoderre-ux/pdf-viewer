// Node-runnable tests: scanning a long export for citations stays proportional
// to its length, and ", et al." before the "v." still reads as part of the
// plaintiff's name.
// Run: node test-long-export-scan.mjs
//
// walkBackForName skips a trailing ", et al." before the "v." so that
// "Juan Carlos Meneses, et al. v. FCA US LLC" is not abandoned at "al.". It
// used to look for the phrase by slicing the text from its very beginning and
// matching an anchored pattern against that slice — one pass over everything
// before the citation, for every citation in the document. On a single-page
// brief that is free. On a Combined Text.txt of a thousand pages it is the
// bulk of the time the text reader spends opening the file, and the open
// crossed the point where Chrome offers to kill the page.
//
// The phrase is a dozen characters, so a window that cannot be outgrown gives
// the same answer at a fixed cost. These tests hold both halves of that: the
// phrase is still read, and the work grows with the document rather than with
// its square.

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
function checkThat(label, ok, note) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        ${note}`);
    fails++;
  }
}

/** The case name the scanner read out of `text`, from its one case citation. */
function caseName(text) {
  const cites = findAllCitations(text).filter((c) => c.kind === "case");
  if (cites.length !== 1) {
    throw new Error(`expected 1 cite, got ${cites.length}: ${JSON.stringify(text)}`);
  }
  return text.slice(cites[0].span[0], cites[0].span[1]);
}

console.log("\n--- \", et al.\" before the v. belongs to the plaintiff ---");
check(
  "et al. with the period",
  caseName("Juan Carlos Meneses, et al. v. FCA US LLC (2022) 78 Cal.App.5th 1137, 1142"),
  "Juan Carlos Meneses, et al. v. FCA US LLC (2022) 78 Cal.App.5th 1137, 1142"
);
check(
  "et al with no period",
  caseName("Meneses, et al v. FCA US LLC (2022) 78 Cal.App.5th 1137, 1142"),
  "Meneses, et al v. FCA US LLC (2022) 78 Cal.App.5th 1137, 1142"
);
check(
  "the phrase deep in a document reads the same as at its start",
  caseName(
    "The parties filed cross-motions, and the Court heard them together. ".repeat(40) +
      "Meneses, et al. v. FCA US LLC (2022) 78 Cal.App.5th 1137, 1142"
  ).trim(),
  "Meneses, et al. v. FCA US LLC (2022) 78 Cal.App.5th 1137, 1142"
);
check(
  "no et al., no change",
  caseName("Aguilar v. Atlantic Richfield Co. (2001) 25 Cal.4th 826, 850"),
  "Aguilar v. Atlantic Richfield Co. (2001) 25 Cal.4th 826, 850"
);

console.log("\n--- the scan grows with the document, not with its square ---");
// One "page" carrying several citations and several stray "v." tokens for the
// walk-back to work on — the shape of a brief, repeated.
const PAGE = [
  "Plaintiff moves for summary adjudication of the first cause of action.",
  "A party moving for summary judgment bears the burden of persuasion.",
  "(Aguilar v. Atlantic Richfield Co. (2001) 25 Cal.4th 826, 850.) The",
  "elements are the contract, performance, breach and damages. (Careau &",
  "Co. v. Security Pacific Business Credit, Inc. (1990) 222 Cal.App.3d",
  "1371, 1388.) Defendant cites Meneses, et al. v. FCA US LLC (2022) 78",
  "Cal.App.5th 1137, 1142, and the Aguilar court's own language. The",
  "motion is GRANTED in part and DENIED in part.",
  "",
].join("\n");

function timeScan(pages) {
  const text = PAGE.repeat(pages);
  const t0 = process.hrtime.bigint();
  const found = findAllCitations(text);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, cites: found.length, chars: text.length };
}

timeScan(40); // warm the engine so the first run's compilation isn't measured
const small = timeScan(100);
const large = timeScan(800); // eight times the text
const ratio = large.ms / Math.max(small.ms, 0.5);
console.log(
  `        ${small.chars} chars in ${small.ms.toFixed(0)} ms (${small.cites} cites), ` +
  `${large.chars} chars in ${large.ms.toFixed(0)} ms (${large.cites} cites) — ${ratio.toFixed(1)}x for 8x the text`
);
check("eight times the text finds eight times the citations", large.cites, small.cites * 8);
// Linear would be 8x. Quadratic would be 64x, and was: the slice-from-zero
// version ran ~40x here. Well clear of both, with room for a loaded machine.
checkThat(
  "eight times the text costs well under sixteen times the work",
  ratio < 16,
  `8x the text took ${ratio.toFixed(1)}x the time — the scan is growing faster than the document`
);

console.log(fails ? `\n${fails} FAILED\n` : "\nAll passed\n");
process.exit(fails ? 1 : 0);
