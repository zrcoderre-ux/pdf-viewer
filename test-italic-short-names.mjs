// Node-runnable tests: an italicized fragment of a case name already cited in
// full gets the same link the full citation got.
// Run: node test-italic-short-names.mjs
//
// Case names are italicized and nearly nothing else in a brief or an opinion
// is, so a later italic "Market Lofts" is a reference to the case, not
// emphasis. The safety rule is the reader's own: link only when the fragment
// can mean exactly one case already cited earlier. Two cases answering to
// "Smith" make the bare word ambiguous, and it stays unlinked even though a
// longer fragment naming either of them still links.
//
// Italic ranges reach the linker as character spans: from PDF font posture in
// the viewer, from computed font-style in the web content script. Tests write
// them inline with «guillemets», which the helper strips back out.

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

// Strip «...» markers, returning the plain text plus the italic ranges.
function markup(src) {
  let text = "";
  const ranges = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("«", i);
    if (open === -1) { text += src.slice(i); break; }
    text += src.slice(i, open);
    const close = src.indexOf("»", open);
    const start = text.length;
    text += src.slice(open + 1, close);
    ranges.push([start, text.length]);
    i = close + 1;
  }
  return { text, ranges };
}

// [linked text, resolved case key] for every italic short-name link.
function italicLinks(src) {
  const { text, ranges } = markup(src);
  return findAllCitations(text, { italicRanges: ranges })
    .filter((c) => c.isItalicShort)
    .map((c) => [c.matchText, c.key]);
}

// Every citation of any kind, as [text, key] — for checking that the italic
// pass doesn't disturb what the other passes already found.
function allLinks(src) {
  const { text, ranges } = markup(src);
  return findAllCitations(text, { italicRanges: ranges }).map((c) => [c.matchText, c.key]);
}

const MARKET_LOFTS =
  "Market Lofts Community Assn. v. 9th Street Market Lofts, LLC (2014) 222 Cal.App.4th 924";
const AGUILAR = "Aguilar v. Atlantic Richfield Co. (2001) 25 Cal.4th 826";
const DAVIS = "In re Marriage of Davis (2015) 61 Cal.4th 846";

console.log("\n--- a numeric first word in the defendant (the reported miss) ---");
check(
  "the full citation is found at all",
  allLinks(`The court in ${MARKET_LOFTS}, 930, held the easement was not exclusive.`),
  [[`${MARKET_LOFTS}, 930`, MARKET_LOFTS]]
);

console.log("\n--- an italicized fragment links to the case cited earlier ---");
check(
  "the announced short name",
  italicLinks(`${MARKET_LOFTS}, 930 (Market Lofts). «Market Lofts» controls here.`),
  [["Market Lofts", MARKET_LOFTS]]
);
check(
  "the plaintiff's first word, with no parenthetical to announce it",
  italicLinks(`${AGUILAR}, 850. «Aguilar» states the standard.`),
  [["Aguilar", AGUILAR]]
);
check(
  "a leading word-prefix of the plaintiff",
  italicLinks(`${MARKET_LOFTS}, 930. «Market Lofts» controls here.`),
  [["Market Lofts", MARKET_LOFTS]]
);
check(
  "the defendant, where the plaintiff is the People",
  italicLinks("People v. Smith (2004) 33 Cal.4th 1, 5. «Smith» applies.",),
  [["Smith", "People v. Smith (2004) 33 Cal.4th 1"]]
);
check(
  "an In re name, whole and in part",
  italicLinks(`${DAVIS}, 850. «Davis» says so, and «In re Marriage of Davis» again.`),
  [["Davis", DAVIS], ["In re Marriage of Davis", DAVIS]]
);
check(
  "the same fragment linked every time it appears",
  italicLinks(`${AGUILAR}, 850. «Aguilar» said it; «Aguilar» said it twice.`),
  [["Aguilar", AGUILAR], ["Aguilar", AGUILAR]]
);

console.log("\n--- the fragment is picked out of the run around it ---");
check(
  "a signal inside the italics",
  italicLinks(`${AGUILAR}, 850. See «see Aguilar», at 851.`),
  [["Aguilar", AGUILAR]]
);
check(
  "trailing punctuation and supra",
  italicLinks(`${MARKET_LOFTS}, 930. «Market Lofts, supra», at 932.`),
  [["Market Lofts", MARKET_LOFTS]]
);
check(
  "the longest matching fragment wins",
  italicLinks(
    `${MARKET_LOFTS}, 930. «Market Lofts Community Assn.» so held.`
  ),
  [["Market Lofts Community Assn.", MARKET_LOFTS]]
);

console.log("\n--- ambiguity leaves it alone ---");
check(
  "two cases answer to the bare word",
  italicLinks(
    "Smith v. Jones (2001) 25 Cal.4th 826, 830 and People v. Smith (2004) 33 Cal.4th 1, 5. " +
      "«Smith» said so."
  ),
  []
);
// The supra pass reaches this one first, so the link is a supra link rather
// than an italic one. Either way the fragment that names one case
// unambiguously is linked, where the bare "Smith" above is not.
check(
  "a longer fragment naming one of them still links",
  allLinks(
    "Smith v. Jones (2001) 25 Cal.4th 826, 830 and People v. Smith (2004) 33 Cal.4th 1, 5. " +
      "«Smith v. Jones, supra» said so."
  ),
  [
    ["Smith v. Jones (2001) 25 Cal.4th 826, 830", "Smith v. Jones (2001) 25 Cal.4th 826"],
    ["People v. Smith (2004) 33 Cal.4th 1, 5", "People v. Smith (2004) 33 Cal.4th 1"],
    ["Smith v. Jones, supra", "Smith v. Jones (2001) 25 Cal.4th 826"],
  ]
);
check(
  "the ambiguity is measured at the fragment, not the document",
  italicLinks(
    "Smith v. Jones (2001) 25 Cal.4th 826, 830. «Smith» said so. " +
      "People v. Smith (2004) 33 Cal.4th 1, 5. «Smith» said it again."
  ),
  [["Smith", "Smith v. Jones (2001) 25 Cal.4th 826"]]
);

console.log("\n--- what must NOT be linked ---");
check(
  "italics before the case has been cited in full",
  italicLinks(`«Aguilar» is the standard. ${AGUILAR}, 850.`),
  []
);
check(
  "ordinary emphasis",
  italicLinks(`${AGUILAR}, 850. The motion is «not» granted; «the moving party» bears it.`),
  []
);
check(
  "Id. and Ibid.",
  italicLinks(`${AGUILAR}, 850. «Id.» at 851; «Ibid.»; see «id.», at 852.`),
  []
);
check(
  "a case never cited in full",
  italicLinks(`${AGUILAR}, 850. «Reid» is not in this document.`),
  []
);
check(
  "a generic institutional party on its own",
  italicLinks("People v. Smith (2004) 33 Cal.4th 1, 5. The «People» disagree."),
  []
);

console.log("\n--- the italic pass leaves the other passes alone ---");
check(
  "an italicized full citation is linked once, as the full citation",
  allLinks(`«Aguilar v. Atlantic Richfield Co.» (2001) 25 Cal.4th 826, 850 is controlling.`),
  [[`${AGUILAR}, 850`, AGUILAR]]
);
check(
  "an italicized bare X v. Y stays a short-form link",
  allLinks(
    "Chillon v. Ford Motor Co. (2023) 90 Cal.App.5th 1, 5. Later, «Chillon v. Ford» explained."
  ),
  [
    ["Chillon v. Ford Motor Co. (2023) 90 Cal.App.5th 1, 5", "Chillon v. Ford Motor Co. (2023) 90 Cal.App.5th 1"],
    ["Chillon v. Ford", "Chillon v. Ford Motor Co. (2023) 90 Cal.App.5th 1"],
  ]
);
check(
  "no italic information at all changes nothing",
  findAllCitations(`${AGUILAR}, 850. Aguilar states the standard.`).map((c) => c.matchText),
  [`${AGUILAR}, 850`]
);

console.log("\n" + "=".repeat(60));
console.log(`FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
