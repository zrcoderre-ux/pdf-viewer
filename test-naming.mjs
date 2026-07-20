// Node-runnable tests. Run: node test-naming.mjs
import { extractTitle, disambiguate, citationShortForm, extractPartVolume, appendPartVol } from "./viewer/footer-naming.js";

const tests = [
  // === The 14 spec examples ===
  {
    name: "spec-00 plaintiff's complaint for damages",
    raw: "Plaintiff's Complaint for Damages",
    expect: { canonical: "Complaint" },
  },
  {
    name: "spec-01 opp to MtS",
    raw: "PLAINTIFF'S OPPOSITION TO DEFENDANT STATEWIDE PHYSICIANS'SERVICE DBA PACIFIC INSURANCE OF CALIFORNIA'S MOTION TO STRIKE PUNITIVE DAMAGES IN PLAINTIFF JORDAN AVERY'S SECOND AMENDED COMPLAINT",
    expect: { canonical: "Opposition", target: "Mot." },
  },
  {
    name: "spec-02 opp to demurrer",
    raw: "PLAINTIFF'S OPPOSITION TO DEFENDANT'S DEMURRER TO SECOND AMENDED COMPLAINT",
    expect: { canonical: "Opposition", target: "Demurrer" },
  },
  {
    name: "spec-03 SAC",
    raw: "SECOND AMENDED COMPLAINT",
    expect: { canonical: "SAC" },
  },
  {
    name: "spec-04 demurrer to SAC",
    raw: "PACIFIC INSURANCE'S NOTICE OF DEMURRER AND DEMURRER TO PLAINTIFF'S SAC CASE NO. 30STCV12345",
    expect: { canonical: "Demurrer", target: "SAC" },
  },
  {
    name: "spec-05 motion to strike",
    raw: "DEFENDANT PACIFIC INSURANCE'S MOTION TO STRIKE PUNITIVE DAMAGES IN SECOND AMENDED COMPLAINT CASE NO. 30STCV12346",
    expect: { canonical: "Motion", target: "Mot. to Strike Punitive Damages" },
  },
  {
    name: "spec-06 experian's motion to compel arbitration",
    raw: "CREDITCO'S MOTION TO COMPEL ARBITRATION AND FOR A STAY",
    expect: { canonical: "Motion", target: "Mot. to Compel Arbitration and for a Stay" },
  },
  {
    name: "spec-07 smith decl ISO mot",
    raw: "SMITH DECL. I/S/O CREDITCO'S MOTION TO COMPEL ARBITRATION AND FOR A STAY",
    expect: { canonical: "Smith Decl. ISO Mot." },
  },
  {
    name: "spec-08 hroshovyk decl ISO opp",
    raw: "DECLARATION OF OLIVIA BENNETT IN SUPPORT OF PLAINTIFF'S OPPOSITION TO CREDITCO'S MOTION TO COMPEL ARBITRATION",
    expect: { canonical: "Bennett Decl. ISO Opp." },
  },
  {
    name: "spec-09 opp to mot. to compel arb",
    raw: "PLAINTIFF'S OPPOSITION TO CREDITCO'S MOTION TO COMPEL ARBITRATION",
    expect: { canonical: "Opposition", target: "Mot." },
  },
  {
    name: "spec-10 aranyi decl",
    raw: "CONNORS DECLARATION",
    expect: { canonical: "Connors Decl." },
  },
  {
    name: "spec-11 walder decl ISO opp",
    raw: "DECLARATION OF MARCUS WEBB IN SUPPORT OF PLAINTIFF'S OPPOSITION TO CREDITCO'S MOTION TO COMPEL ARBITRATION",
    expect: { canonical: "Webb Decl. ISO Opp." },
  },
  {
    name: "spec-12 demurrer to FAC",
    raw: "DEFENDANT THE BOARD OF TRUSTEES OF EXAMPLE UNIVERSITY'S NOTICE OF DEMURRER AND DEMURRER TO PLAINTIFF'S First Amended Complaint (FAC)",
    expect: { canonical: "Demurrer", target: "FAC" },
  },
  {
    name: "spec-13 singleton complaint",
    raw: "COMPLAINT FOR COMPENSATORY, PUNITIVE, AND LIQUIDATED DAMAGES, INJUNCTIVE RELIEF, AND CIVIL PENALTIES HOPKINS V. BRIGHT TUTORS LLC, ET AL",
    expect: { canonical: "Complaint", party: "Hopkins" },
  },

  // === New rules from follow-up conversation ===

  // Reply to opposition to motion to compel arbitration
  {
    name: "reply-to-opp-to-mca",
    raw: "Defendant's Reply to Opposition to Motion to Compel Arbitration",
    expect: { canonical: "Reply", target: "Opp. to Mot." },
  },
  // Reply to opposition to MSJ
  {
    name: "reply-to-opp-to-msj",
    raw: "Plaintiff's Reply to Opposition to Motion for Summary Judgment",
    expect: { canonical: "Reply", target: "Opp. to Mot." },
  },
  // Reply to opposition to demurrer
  {
    name: "reply-to-opp-to-demurrer",
    raw: "Defendant's Reply to Plaintiff's Opposition to Demurrer",
    expect: { canonical: "Reply", target: "Opp. to Demurrer" },
  },

  // Notice of Motion stripping
  {
    name: "notice-of-motion-and-motion-to-compel-arb",
    raw: "Defendant's Notice of Motion and Motion to Compel Arbitration",
    expect: { canonical: "Motion", target: "Mot. to Compel Arbitration" },
  },
  {
    name: "notice-of-motion-for-msj-bare",  // a Notice of Motion IS the motion
    raw: "Notice of Motion for Summary Judgment",
    expect: { canonical: "Motion", target: "Mot. for Summary Judgment" },
  },
  {
    name: "notice-of-motion-and-motion-to-strike",
    raw: "Plaintiff's Notice of Motion and Motion to Strike Defendant's Answer",
    expect: { canonical: "Motion", target: "Mot. to Strike Defendant's Answer" },
  },

  // Petitions
  {
    name: "petition-to-compel-arb",
    raw: "Petition to Compel Arbitration and for a Stay",
    expect: { canonical: "Petition", target: "Pet. to Compel Arbitration and for a Stay" },
  },
  {
    name: "petition-to-confirm-award",
    raw: "Petitioner's Petition to Confirm Arbitration Award",
    expect: { canonical: "Petition", target: "Pet. to Confirm Arbitration Award" },
  },
  {
    name: "petition-for-writ",
    raw: "Petition for Writ of Mandate",
    expect: { canonical: "Petition", target: "Pet. for Writ of Mandate" },
  },
  // Opposition to petition
  {
    name: "opp-to-petition",
    raw: "Respondent's Opposition to Petition to Compel Arbitration",
    expect: { canonical: "Opposition", target: "Pet." },
  },
  // Reply to opposition to petition
  {
    name: "reply-to-opp-to-petition",
    raw: "Petitioner's Reply to Opposition to Petition for Writ of Mandate",
    expect: { canonical: "Reply", target: "Opp. to Pet." },
  },

  // Declaration ISO Reply / Petition
  {
    name: "decl-iso-reply",
    raw: "Declaration of Jane Smith in Support of Reply to Opposition to Motion to Compel Arbitration",
    expect: { canonical: "Smith Decl. ISO Reply" },
  },
  {
    name: "decl-iso-petition",
    raw: "Declaration of John Doe in Support of Petition to Confirm Award",
    expect: { canonical: "Doe Decl. ISO Pet." },
  },
  // Declaration mustn't collapse to its supported doc type
  {
    name: "decl-iso-motion-not-motion",
    raw: "DECLARATION OF SOMEONE IN SUPPORT OF DEFENDANT'S MOTION TO STRIKE",
    expect: { canonical: "Someone Decl. ISO Mot." },
  },
  // Hyphenated last name
  {
    name: "decl-hyphenated",
    raw: "DECLARATION OF MARIA GARCIA-LOPEZ IN SUPPORT OF OPPOSITION",
    expect: { canonical: "Garcia-Lopez Decl. ISO Opp." },
  },
  // Single-name "Declaration of Smith"
  {
    name: "decl-single-name",
    raw: "Declaration of Smith",
    expect: { canonical: "Smith Decl." },
  },

  // === Ex Parte Application ===
  {
    name: "ex-parte-app-standalone",
    raw: "Defendant's Ex Parte Application for Order Shortening Time",
    expect: { canonical: "Ex Parte Application", target: "Ex Parte App. for Order Shortening Time" },
  },
  {
    name: "opp-to-ex-parte",
    raw: "RECEIVER'S OPPOSITION TO DEFENDANTS' EX PARTE APPLICATION",
    expect: { canonical: "Opposition", target: "Ex Parte App.", partyLabel: "Receiver" },
  },
  {
    name: "reply-to-opp-to-ex-parte",
    raw: "Defendant Pacific Insurance's Reply to Opposition to Ex Parte Application",
    expect: { canonical: "Reply", target: "Opp. to Ex Parte App.", partyLabel: "Defendant", partyName: "Pacific Insurance" },
  },
  {
    name: "decl-iso-ex-parte",
    raw: "Declaration of Jane Smith in Support of Ex Parte Application",
    expect: { canonical: "Smith Decl. ISO Ex Parte App." },
  },

  // === partyLabel capture ===
  {
    name: "party-bare-plaintiff",
    raw: "Plaintiff's Complaint for Damages",
    expect: { canonical: "Complaint", partyLabel: "Plaintiff" },
  },
  {
    name: "party-labeled-defendant",
    raw: "Defendant Pacific Insurance's Demurrer to SAC",
    expect: { canonical: "Demurrer", target: "SAC", partyLabel: "Defendant", partyName: "Pacific Insurance" },
  },
  {
    name: "party-bare-receiver",
    raw: "Receiver's Opposition to Defendants' Ex Parte Application",
    expect: { canonical: "Opposition", target: "Ex Parte App.", partyLabel: "Receiver" },
  },
  {
    name: "party-bare-experian",
    raw: "Creditco's Motion to Compel Arbitration",
    expect: { canonical: "Motion", partyLabel: "Creditco" },
  },
  {
    name: "party-labeled-with-name",  // role wins; name kept as deep fallback
    raw: "Plaintiff Jordan Avery's Opposition to Defendant's Motion",
    expect: { canonical: "Opposition", target: "Mot.", partyLabel: "Plaintiff", partyName: "Jordan Avery" },
  },
  {
    name: "party-role-plus-person-name",
    raw: "Plaintiff John Doe's Motion to Compel Arbitration",
    expect: { canonical: "Motion", partyLabel: "Plaintiff", partyName: "John Doe" },
  },
  {
    name: "party-role-only-keeps-null-name",
    raw: "Plaintiff's Opposition to Demurrer",
    expect: { canonical: "Opposition", partyLabel: "Plaintiff", partyName: null },
  },
  // Declarations are the exception: the declarant's actual last name stays in
  // the canonical, regardless of any role possessive in the ISO clause.
  {
    name: "decl-keeps-declarant-name",
    raw: "Declaration of John Doe in Support of Plaintiff Jane Roe's Opposition to Motion for Summary Judgment",
    expect: { canonical: "Doe Decl. ISO Opp." },
  },
  {
    name: "party-llc-suffix",
    raw: "Acme Corp LLC's Motion to Dismiss",
    expect: { canonical: "Motion", partyLabel: "Acme Corp LLC" },
  },
  // === Request for Judicial Notice ===
  {
    name: "rjn-iso-opp-loose-in-support",
    raw: "Plaintiffs Req for Judicial Notice in Support Opp to Demurrer by Example & Partners TAC",
    expect: { canonical: "RJN ISO Opp.", target: "Opp. to Demurrer" },
  },
  {
    name: "rjn-iso-opp-full-form",
    raw: "Plaintiff's Request for Judicial Notice in Support of Opposition to Demurrer",
    expect: { canonical: "RJN ISO Opp.", target: "Opp. to Demurrer", partyLabel: "Plaintiff" },
  },
  {
    name: "rjn-iso-motion",
    raw: "RJN ISO Motion to Compel",
    expect: { canonical: "RJN ISO Mot." },
  },
  {
    name: "rjn-bare",
    raw: "Defendant's Request for Judicial Notice",
    expect: { canonical: "RJN", partyLabel: "Defendant" },
  },
  {
    name: "decl-iso-rjn",
    raw: "Smith Declaration ISO RJN",
    expect: { canonical: "Smith Decl. ISO RJN" },
  },
  {
    name: "rjn-abbrev-with-period",
    raw: "Req. for Judicial Notice in Support of Motion for Summary Judgment",
    expect: { canonical: "RJN ISO Mot." },
  },

  // === Separate Statement ===
  {
    name: "sep-stmt-reply",
    raw: "EXAMPLE BUILDING PRODUCTS, INC.'S SEPARATE STATEMENT IN REPLY TO PLAINTIFF'S ADDITIONAL MATERIAL FACTS RE: MOTION FOR SUMMARY JUDGMENT",
    expect: { canonical: "Reply Separate Statement" },
  },
  {
    name: "sep-stmt-opposition-becomes-umf",
    raw: "Plaintiff's Separate Statement in Opposition to Motion for Summary Judgment",
    expect: { canonical: "UMF", partyLabel: "Plaintiff" },
  },
  {
    name: "sep-stmt-standalone",
    raw: "Separate Statement of Undisputed Material Facts",
    expect: { canonical: "Separate Statement" },
  },

  // === AUMF / UMF (specific Separate Statement variants) ===
  {
    name: "aumf-plaintiff-iso-opp-to-msj",
    raw: "PLAINTIFF'S SEPARATE STATEMENT OF ADDITIONAL UNDISPUTED MATERIAL FACTS IN SUPPORT OF OPPOSITION TO MSJ",
    expect: { canonical: "AUMF", partyLabel: "Plaintiff" },
  },
  {
    name: "aumf-additional-material-facts-bare",
    raw: "Defendant's Separate Statement of Additional Material Facts",
    expect: { canonical: "AUMF", partyLabel: "Defendant" },
  },
  {
    name: "umf-plaintiff-response-to-defense-ss",
    raw: "PLAINTIFF'S RESPONSE TO DEFENSE SEPARATE STATEMENT OF UNDISPUTED MATERIAL FACTS",
    expect: { canonical: "UMF", partyLabel: "Plaintiff" },
  },
  {
    name: "umf-responses-plural",
    raw: "Plaintiff's Responses to Defendant's Separate Statement of Undisputed Material Facts",
    expect: { canonical: "UMF", partyLabel: "Plaintiff" },
  },
  {
    name: "moving-party-ss-of-umf-stays-bare",
    raw: "Plaintiff's Separate Statement of Undisputed Material Facts in Support of MSJ",
    expect: { canonical: "Separate Statement", partyLabel: "Plaintiff" },
  },

  // === Combined-document declaration footer (with intervening "and") ===
  // Tests that detectISOTarget reaches past "compendium of exhibits" to
  // find the actual ISO clause downstream.
  {
    name: "decl-combined-with-compendium",
    raw: "DECLARATION OF DANIEL FISHER, ESQ AND PLAINTIFF'S COMPENDIUM OF EXHIBITS IN SUPPORT OF PLAINTIFF'S OPPOSITION TO MOTION SUMMARY JUDGMENT",
    expect: { canonical: "Fisher Decl. ISO Opp." },
  },

  // === Notice of Motion → Motion when the footer contains "and Motion" ===
  {
    name: "nom-and-motion-adjacent",
    raw: "NOTICE OF MOTION AND MOTION TO COMPEL FURTHER RESPONSES",
    expect: { canonical: "Motion", target: "Mot. to Compel Further Responses" },
  },
  {
    name: "nom-and-motion-nonadjacent",  // "and Motion" trails other words
    raw: "Notice of Motion for Summary Judgment and Motion for Summary Adjudication",
    expect: { canonical: "Motion" },
  },
  {
    name: "nom-and-motion-with-party",
    raw: "Defendant's Notice of Motion and Motion to Strike Answer",
    expect: { canonical: "Motion", target: "Mot. to Strike Answer" },
  },
  {
    name: "nom-bare-becomes-motion",  // a Notice of Motion IS the motion
    raw: "Notice of Motion for Sanctions",
    expect: { canonical: "Motion" },
  },

  // === New doc-type rules derived from naming history ===
  { name: "objection-to-decl", raw: "OBJECTIONS TO ANDERSON DECL - MOTION TO VACATE DEFAULT", expect: { canonical: "Obj. to Anderson Decl." } },
  // Objections are their own type — never collapse to the objected-to document.
  { name: "objection-to-rjn", raw: "Defendant's Objection to Plaintiff's Request For Judicial Notice", expect: { canonical: "Obj. to RJN", partyLabel: "Defendant" } },
  { name: "objection-to-evidence", raw: "Plaintiff's Objection to Defendant's Evidence", expect: { canonical: "Obj. to Evidence", partyLabel: "Plaintiff" } },
  { name: "objection-to-motion", raw: "Defendant's Objections to Plaintiff's Motion to Compel Further Responses", expect: { canonical: "Obj. to Mot.", partyLabel: "Defendant" } },
  { name: "objection-to-declaration-of", raw: "Objection to Declaration of Jane Smith", expect: { canonical: "Obj. to Smith Decl." } },
  { name: "objection-to-evidence-iso", raw: "Defendant's Objection to Plaintiff's Evidence in Support of Opposition", expect: { canonical: "Obj. to Evidence" } },
  // Evidence / Compendium of Evidence — its own type, not the opp/motion it supports.
  { name: "evidence-iso-opp", raw: "Plaintiff's Evidence in Support of Opposition to Motion for Summary Judgment", expect: { canonical: "Evidence ISO Opp.", partyLabel: "Plaintiff" } },
  { name: "compendium-of-evidence", raw: "Defendant's Compendium of Evidence", expect: { canonical: "Evidence", partyLabel: "Defendant" } },
  { name: "evidence-iso-motion", raw: "Evidence in Support of Motion to Compel Arbitration", expect: { canonical: "Evidence ISO Mot." } },
  { name: "proposed-order", raw: "[PROPOSED] ORDER RE PLAINTIFF'S MOTION FOR LEAVE TO AMEND COMPLAINT", expect: { canonical: "Proposed Order" } },
  { name: "proposed-order-bare", raw: "[PROPOSED] ORDER", expect: { canonical: "Proposed Order" } },
  { name: "proof-of-service", raw: "PROOF OF SERVICE RE NOTICE OF MOTION AND MOTION TO VACATE", expect: { canonical: "Proof of Service" } },
  { name: "request-for-dismissal", raw: "REQUEST FOR DISMISSAL", expect: { canonical: "Request for Dismissal" } },
  { name: "amendment-to-complaint", raw: "AMENDMENT TO COMPLAINT", expect: { canonical: "Amendment to Complaint" } },
  { name: "glued-possessive-opposition", raw: "PLAINTIFF'SOPPOSITION TO DEFENDANT'SMOTION FOR SUMMARY ADJUDICATION", expect: { canonical: "Opposition" } },
  { name: "glued-declaration", raw: "YUDECLARATION IN SUPPORT OF PLAINTIFF'SOPPOSITION TO DEFENDANT'SMSA", expect: { canonical: "Yu Decl. ISO Opp." } },
  { name: "leading-case-number", raw: "25STCV32877 KOSLYNDECLARATION REDEMURRER", expect: { canonical: "Koslyn Decl." } },
  { name: "declarant-middle-initial-v", raw: "DECLARATION OF PAUL V. CARELLI IV IN SUPPORT OF DEFENDANT'S OPPOSITION", expect: { canonical: "Carelli Decl. ISO Opp." } },
];

// --- runner ---

let pass = 0, fail = 0;
const failures = [];

for (const t of tests) {
  const got = extractTitle(t.raw);
  const checks = [];
  for (const [k, v] of Object.entries(t.expect)) {
    checks.push({ key: k, want: v, got: got[k] });
  }
  const ok = checks.every(c => c.got === c.want);
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push({ t, got, checks });
  }
}

console.log(`${pass}/${pass + fail} passing`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`\n  ${f.t.name}`);
    console.log(`    raw:    ${f.t.raw}`);
    for (const c of f.checks) {
      const mark = c.got === c.want ? "✓" : "✗";
      console.log(`    ${mark} ${c.key}: got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}`);
    }
  }
}

// --- disambiguation tests ---

console.log("\n--- disambiguation ---");

function dtest(name, entries, expected) {
  const result = disambiguate(entries);
  const ok = entries.every(e => result.get(e.id) === expected[e.id]);
  if (ok) {
    console.log(`✓ ${name}`);
  } else {
    console.log(`✗ ${name}`);
    for (const e of entries) {
      const mark = result.get(e.id) === expected[e.id] ? "✓" : "✗";
      console.log(`    ${mark} ${e.id}: got=${JSON.stringify(result.get(e.id))} want=${JSON.stringify(expected[e.id])}`);
    }
  }
}

// Two Demurrers — should disambiguate to "Demurrer to SAC" and "Demurrer to FAC"
dtest("two demurrers", [
  { id: "a", canonical: "Demurrer", target: "SAC" },
  { id: "b", canonical: "Demurrer", target: "FAC" },
], { a: "Demurrer to SAC", b: "Demurrer to FAC" });

// Two Complaints — one with party, one without
dtest("two complaints (one with party)", [
  { id: "a", canonical: "Complaint", party: null },
  { id: "b", canonical: "Complaint", party: "Hopkins" },
], { a: "Complaint", b: "Hopkins Complaint" });

// Two Motions — one Strike, one Dismiss
dtest("two motions", [
  { id: "a", canonical: "Motion", target: "Mot. to Strike" },
  { id: "b", canonical: "Motion", target: "Mot. to Dismiss" },
], { a: "Mot. to Strike", b: "Mot. to Dismiss" });

// Two Oppositions — one to demurrer, one to motion
dtest("two oppositions", [
  { id: "a", canonical: "Opposition", target: "Demurrer" },
  { id: "b", canonical: "Opposition", target: "Mot." },
], { a: "Opposition to Demurrer", b: "Opposition to Mot." });

// Single Opposition — stays bare
dtest("single opposition stays bare", [
  { id: "a", canonical: "Opposition", target: "Mot." },
], { a: "Opposition" });

// Two Replies
dtest("two replies", [
  { id: "a", canonical: "Reply", target: "Opp. to Mot." },
  { id: "b", canonical: "Reply", target: "Opp. to Demurrer" },
], { a: "Reply to Opp. to Mot.", b: "Reply to Opp. to Demurrer" });

// === Iterative ladder tests ===

// Level 1 resolves: two Oppositions to different motion types
dtest("level1: opp to different targets", [
  { id: "a", canonical: "Opposition", target: "Demurrer", partyLabel: "Plaintiff" },
  { id: "b", canonical: "Opposition", target: "Mot.",     partyLabel: "Defendant" },
], { a: "Opposition to Demurrer", b: "Opposition to Mot." });

// Level 2 resolves: two Motions to Strike, different parties — target alone collides
dtest("level2: two mts different parties", [
  { id: "a", canonical: "Motion", target: "Mot. to Strike", partyLabel: "Plaintiff" },
  { id: "b", canonical: "Motion", target: "Mot. to Strike", partyLabel: "Defendant" },
], { a: "Plaintiff's Motion", b: "Defendant's Motion" });

// Level 2 resolves: two Demurrers both to SAC, by different defendants
dtest("level2: two demurrers same target different names", [
  { id: "a", canonical: "Demurrer", target: "SAC", partyLabel: "Pacific Insurance" },
  { id: "b", canonical: "Demurrer", target: "SAC", partyLabel: "Creditco" },
], { a: "Pacific Insurance's Demurrer", b: "Creditco's Demurrer" });

// Level 3 resolves: two oppositions with same target AND same partyLabel
// won't happen in real life (would mean two Defendants with same name).
// But here's a case where level 1 alone doesn't work and level 2 alone
// doesn't work — needs both.
dtest("level3: complex three-way needing both", [
  { id: "a", canonical: "Opposition", target: "Ex Parte App.", partyLabel: "Receiver" },
  { id: "b", canonical: "Opposition", target: "Demurrer",      partyLabel: "Receiver" },
  { id: "c", canonical: "Opposition", target: "Ex Parte App.", partyLabel: "Defendant" },
], {
  // Level 1 (target only): a,c collide on Ex Parte; b unique. Fail.
  // Level 2 (party only): a,b collide on Receiver; c unique. Fail.
  // Level 3: target + party. All unique.
  a: "Receiver's Opposition to Ex Parte App.",
  b: "Receiver's Opposition to Demurrer",
  c: "Defendant's Opposition to Ex Parte App.",
});

// User's original 3-way example
dtest("user spec: receiver / plaintiff / blue shield oppositions", [
  { id: "a", canonical: "Opposition", target: "Ex Parte App.", partyLabel: "Receiver" },
  { id: "b", canonical: "Opposition", target: "Demurrer",      partyLabel: "Plaintiff" },
  { id: "c", canonical: "Opposition", target: "Ex Parte App.", partyLabel: "Pacific Insurance" },
], {
  // Level 1: a,c collide on Ex Parte. Fail.
  // Level 2: all three party labels unique. Done.
  a: "Receiver's Opposition",
  b: "Plaintiff's Opposition",
  c: "Pacific Insurance's Opposition",
});

// Bare opposition (no info) alongside an informed one
dtest("bare opposition stays bare when sibling has info", [
  { id: "a", canonical: "Opposition", target: "Demurrer", partyLabel: "Plaintiff" },
  { id: "b", canonical: "Opposition", target: null,       partyLabel: null },
], {
  // Level 1: a→"Opposition to Demurrer", b→"Opposition". Unique. Done.
  a: "Opposition to Demurrer",
  b: "Opposition",
});

// Two bare oppositions — truly indistinguishable
dtest("two bare oppositions remain identical", [
  { id: "a", canonical: "Opposition", target: null, partyLabel: null },
  { id: "b", canonical: "Opposition", target: null, partyLabel: null },
], {
  // No level resolves; both stay bare.
  a: "Opposition", b: "Opposition",
});

// One Defendant named, one not
dtest("two defendants one named one not", [
  { id: "a", canonical: "Motion", target: "Mot. to Strike", partyLabel: "Defendant" },
  { id: "b", canonical: "Motion", target: "Mot. to Strike", partyLabel: "Pacific Insurance" },
], {
  a: "Defendant's Motion",
  b: "Pacific Insurance's Motion",
});

// Ex Parte App as standalone type, collisions
dtest("two ex parte apps", [
  { id: "a", canonical: "Ex Parte Application", target: "Ex Parte App. for Order Shortening Time", partyLabel: "Plaintiff" },
  { id: "b", canonical: "Ex Parte Application", target: "Ex Parte App. to Seal Records",            partyLabel: "Defendant" },
], {
  a: "Ex Parte App. for Order Shortening Time",
  b: "Ex Parte App. to Seal Records",
});

// Two RJNs supporting different Opposition targets
dtest("two rjns iso opp to different things", [
  { id: "a", canonical: "RJN ISO Opp.", target: "Opp. to Demurrer", partyLabel: "Plaintiff" },
  { id: "b", canonical: "RJN ISO Opp.", target: "Opp. to Mot.",     partyLabel: "Defendant" },
], {
  // Level 1: a→"RJN ISO Opp to Demurrer", b→"RJN ISO Opp to Mot.". Unique. Done.
  a: "RJN ISO Opp to Demurrer",
  b: "RJN ISO Opp to Mot.",
});

// Two RJNs supporting same Opp but different parties (level 2)
dtest("two rjns same target different parties", [
  { id: "a", canonical: "RJN ISO Opp.", target: "Opp. to Demurrer", partyLabel: "Plaintiff" },
  { id: "b", canonical: "RJN ISO Opp.", target: "Opp. to Demurrer", partyLabel: "Defendant" },
], {
  // Level 1: both "RJN ISO Opp to Demurrer". Fail.
  // Level 2: party labels distinguish. Done.
  a: "Plaintiff's RJN ISO Opp.",
  b: "Defendant's RJN ISO Opp.",
});

// Two objections to the same thing, different parties → party disambiguates.
dtest("two objections to rjn different parties", [
  { id: "a", canonical: "Obj. to RJN", target: null, partyLabel: "Defendant" },
  { id: "b", canonical: "Obj. to RJN", target: null, partyLabel: "Plaintiff" },
], {
  a: "Defendant's Obj. to RJN",
  b: "Plaintiff's Obj. to RJN",
});

// A single objection stays bare (no needless party qualifier).
dtest("single objection stays bare", [
  { id: "a", canonical: "Obj. to RJN", target: null, partyLabel: "Defendant" },
], { a: "Obj. to RJN" });

// Two evidence compendia, different parties.
dtest("two evidence iso opp different parties", [
  { id: "a", canonical: "Evidence ISO Opp.", target: null, partyLabel: "Plaintiff" },
  { id: "b", canonical: "Evidence ISO Opp.", target: null, partyLabel: "Defendant" },
], {
  a: "Plaintiff's Evidence ISO Opp.",
  b: "Defendant's Evidence ISO Opp.",
});

// === Multiple same-role filers fall back to party names ===

// Two plaintiffs, same document type and target: role label collides at every
// role level, so their NAMES distinguish (level 4).
dtest("two plaintiffs distinguished by name", [
  { id: "a", canonical: "Opposition", target: "Mot.", partyLabel: "Plaintiff", partyName: "Jordan Avery" },
  { id: "b", canonical: "Opposition", target: "Mot.", partyLabel: "Plaintiff", partyName: "Jane Roe" },
], {
  a: "Jordan Avery's Opposition",
  b: "Jane Roe's Opposition",
});

// A named plaintiff and an unnamed one: the unnamed entry keeps its role label
// at the name level, which is already distinct.
dtest("named vs unnamed plaintiff", [
  { id: "a", canonical: "Motion", target: "Mot. to Strike", partyLabel: "Plaintiff", partyName: "Jordan Avery" },
  { id: "b", canonical: "Motion", target: "Mot. to Strike", partyLabel: "Plaintiff", partyName: null },
], {
  a: "Jordan Avery's Motion",
  b: "Plaintiff's Motion",
});

// Different roles still resolve at the cheaper role level — names never used.
dtest("different roles stay role-labeled", [
  { id: "a", canonical: "Motion", target: "Mot. to Strike", partyLabel: "Plaintiff", partyName: "Jordan Avery" },
  { id: "b", canonical: "Motion", target: "Mot. to Strike", partyLabel: "Defendant", partyName: "Pacific Insurance" },
], {
  a: "Plaintiff's Motion",
  b: "Defendant's Motion",
});

// === Part / volume designators ===

// Two volumes of the same filing: same type, target, AND party — only the
// volume number can tell them apart.
dtest("two volumes of same evidence appendix", [
  { id: "a", canonical: "Evidence ISO Opp.", target: null, partyLabel: "Plaintiff", partVol: "Vol. 1" },
  { id: "b", canonical: "Evidence ISO Opp.", target: null, partyLabel: "Plaintiff", partVol: "Vol. 2" },
], {
  a: "Evidence ISO Opp. Vol. 1",
  b: "Evidence ISO Opp. Vol. 2",
});

// The designator sticks even when the document is alone (durable: the name
// doesn't change when a sibling tab closes).
dtest("single volume keeps its designator", [
  { id: "a", canonical: "Evidence ISO Opp.", target: null, partyLabel: "Plaintiff", partVol: "Vol. 1" },
], { a: "Evidence ISO Opp. Vol. 1" });

// Parts on a motion.
dtest("two parts of same motion", [
  { id: "a", canonical: "Motion", target: "Mot. to Compel", partyLabel: "Defendant", partVol: "Part 1" },
  { id: "b", canonical: "Motion", target: "Mot. to Compel", partyLabel: "Defendant", partVol: "Part 2" },
], { a: "Motion Part 1", b: "Motion Part 2" });

// Same volume number from different parties → ladder still differentiates,
// with the designator appended after.
dtest("same volume different parties", [
  { id: "a", canonical: "Evidence ISO Opp.", target: null, partyLabel: "Plaintiff", partVol: "Vol. 1" },
  { id: "b", canonical: "Evidence ISO Opp.", target: null, partyLabel: "Defendant", partVol: "Vol. 1" },
], {
  a: "Plaintiff's Evidence ISO Opp. Vol. 1",
  b: "Defendant's Evidence ISO Opp. Vol. 1",
});

// Declarations (no ladder) get volumes too.
dtest("two volumes of same declaration", [
  { id: "a", canonical: "Smith Decl. ISO Mot.", partVol: "Vol. 1" },
  { id: "b", canonical: "Smith Decl. ISO Mot.", partVol: "Vol. 2" },
], { a: "Smith Decl. ISO Mot. Vol. 1", b: "Smith Decl. ISO Mot. Vol. 2" });

// AUMF/UMF participate in disambiguation
dtest("aumf collision uses partyLabel", [
  { id: "a", canonical: "AUMF", target: null, partyLabel: "Plaintiff" },
  { id: "b", canonical: "AUMF", target: null, partyLabel: "Cross-Plaintiff" },
], {
  a: "Plaintiff's AUMF",
  b: "Cross-Plaintiff's AUMF",
});

// --- citation short-form tests ---

console.log("\n--- citation short form ---");

function ctest(name, input, want) {
  const got = citationShortForm(input);
  if (got === want) {
    console.log(`✓ ${name}`);
  } else {
    console.log(`✗ ${name}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
    process.exitCode = 1;
  }
}

ctest("motion",                "Motion",                    "Mot.");
ctest("motion with party",     "Pacific Insurance's Motion","Mot.");
ctest("mot to strike",         "Mot. to Strike",            "Mot.");
ctest("opposition",            "Opposition",                "Opp.");
ctest("opp to demurrer",       "Opposition to Demurrer",    "Opp.");
ctest("reply",                 "Reply",                     "Reply");
ctest("reply to opp to mot",   "Reply to Opp. to Mot.",     "Reply");
ctest("demurrer",              "Demurrer to SAC",           "Demurrer");
ctest("decl bare",             "Smith Decl.",               "Smith Decl.");
ctest("decl iso opp",          "Doe Decl. ISO Opp.",        "Doe Decl.");
ctest("decl hyphen",           "Garcia-Lopez Decl. ISO Reply", "Garcia-Lopez Decl.");
ctest("objection to decl",     "Objection to Anderson Decl.", "Obj.");
ctest("obj. to rjn",           "Obj. to RJN",               "Obj.");
ctest("obj. to anderson decl", "Obj. to Anderson Decl.",    "Obj.");
ctest("obj. to evidence",      "Obj. to Evidence",          "Obj.");
ctest("evidence iso opp",      "Evidence ISO Opp.",         "Evid.");
ctest("evidence bare",         "Evidence",                  "Evid.");
ctest("complaint",             "Complaint",                 "Compl.");
ctest("complaint with party",  "Hopkins Complaint",         "Compl.");
ctest("FAC",                   "FAC",                       "FAC");
ctest("SAC",                   "SAC",                       "SAC");
ctest("petition",              "Pet. for Writ of Mandate",  "Pet.");
ctest("ex parte",              "Ex Parte App. for Order Shortening Time", "Ex Parte App.");
ctest("rjn",                   "RJN ISO Opp.",              "RJN");
ctest("umf",                   "UMF",                       "UMF");
ctest("aumf",                  "AUMF",                      "AUMF");
ctest("separate statement",    "Separate Statement",        "Sep. Stmt.");
ctest("proposed order",        "Proposed Order",            "Order");
ctest("proof of service",      "Proof of Service",          "POS");
ctest("short notice",          "Notice of Opposition",      "Notice");
ctest("unknown falls through", "Trial Brief",               "Trial Brief");

// --- part/volume extraction tests ---

console.log("\n--- part/volume extraction ---");

function pvtest(name, input, want) {
  const got = extractPartVolume(input);
  if (got === want) {
    console.log(`✓ ${name}`);
  } else {
    console.log(`✗ ${name}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
    process.exitCode = 1;
  }
}

pvtest("volume arabic",        "PLAINTIFF'S APPENDIX OF EVIDENCE VOLUME 1",     "Vol. 1");
pvtest("volume of N",          "COMPENDIUM OF EVIDENCE VOLUME 2 OF 4",          "Vol. 2");
pvtest("vol dot",              "APPENDIX OF EXHIBITS, VOL. 3",                  "Vol. 3");
pvtest("volume roman",         "EVIDENCE IN SUPPORT OF OPPOSITION VOLUME II",   "Vol. 2");
pvtest("volume word",          "DECLARATION OF JOHN DOE VOLUME ONE",            "Vol. 1");
pvtest("part arabic",          "MOTION TO COMPEL FURTHER RESPONSES PART 2",     "Part 2");
pvtest("part roman",           "SEPARATE STATEMENT PART III",                   "Part 3");
pvtest("part word",            "APPENDIX PART TWO",                             "Part 2");
pvtest("pt abbreviation",      "EXHIBITS PT. 4",                                "Part 4");
pvtest("volume no. N",         "APPENDIX VOLUME NO. 2",                         "Vol. 2");
pvtest("in-part prose no hit", "ORDER GRANTING IN PART AND DENYING IN PART MOTION", null);
pvtest("bare part no number",  "THIS DOCUMENT IS PART OF THE RECORD",           null);
pvtest("no designator",        "PLAINTIFF'S OPPOSITION TO MOTION",              null);
pvtest("bad roman rejected",   "PART IIX OF THE FILING",                        null);
pvtest("empty",                "",                                              null);

// appendPartVol double-append guard
{
  const a = appendPartVol("Evidence ISO Opp.", "Vol. 1");
  const b = appendPartVol(a, "Vol. 1");
  const ok = a === "Evidence ISO Opp. Vol. 1" && b === a &&
             appendPartVol("Motion", null) === "Motion" &&
             appendPartVol("Motion Part 1", "Part 2") === "Motion Part 1 Part 2";
  console.log(`${ok ? "✓" : "✗"} appendPartVol append + no-double-append`);
  if (!ok) process.exitCode = 1;
}

console.log("\nDone.");
