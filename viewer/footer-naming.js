// Footer-derived document naming.
//
// Public API:
//   extractTitle(rawFooter) -> { canonical, target, party, raw }
//   disambiguate(entries)   -> Map<entryId, displayName>
//
// canonical:  bare default ("Motion", "Demurrer", "Opposition", "Complaint",
//             "Reply", "Smith Decl. ISO Mot.", ...).
// target:     short form of the doc being responded to, captured for use
//             during disambiguation only ("Mot.", "Demurrer", "SAC", ...).
// party:      case-caption plaintiff from a "X v. Y" tail, used only as a
//             Complaint disambiguator.
//
// Pipeline (order matters, comments below explain why):
//   1. Normalize whitespace & quote characters.
//   2. Capture caption party from "X v. Y" tail, strip the tail.
//   3. Strip case-number noise and trailing descriptive damages blobs.
//   4. Handle "Notice of Motion and Motion ..." prefix — strip it so the
//      Motion rule sees the real motion. A bare "Notice of Motion ..."
//      (no "and Motion") is its own document type and is preserved.
//   5. Walk the RULES list to identify the document type. Rules examine
//      the FULL (still-noisy) string and self-confine their target
//      extraction. Outermost wrapper always wins.
//
// Type identification happens BEFORE party stripping. Earlier attempts
// stripped party up front but the lazy bare-possessive pattern walked
// past document-type words like Opposition/Demurrer to find the next 's.
// Type-rule regexes don't care about party labels — they anchor on the
// document-type keywords directly — so stripping isn't actually needed.
//
// Rule order (outermost wrapper first):
//   Declaration > Reply > Opposition > Demurrer > Notice of Motion >
//   Motion > Petition > Amended Complaint > Complaint
//
// Notice of Motion comes BEFORE Motion because "Notice of Motion for X"
// contains "Motion for X" as a substring — the Motion rule would otherwise
// misfire on the inner reference. The "Notice of Motion AND Motion ..."
// form was already collapsed to plain "Motion ..." in step 4.
//
// Insurance: if input mentioned DECLARATION/DECL. but a non-declaration
// rule matched, recover a "Decl." label rather than mislabel.

// === normalization helpers ===

function normalize(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    // Repair run-together words from PDF text extraction that drops spaces \u2014
    // they otherwise defeat the \b-anchored type keywords below.
    //   "PLAINTIFF'SOPPOSITION" \u2192 "PLAINTIFF'S OPPOSITION"  (glued possessive;
    //     only split before an UPPERCASE letter so names like O'Sullivan/D'Souza
    //     are left intact)
    //   "YUDECLARATION"         \u2192 "YU DECLARATION"          (name glued to type)
    //   "INSUPPORT OF"          \u2192 "IN SUPPORT OF"
    .replace(/(['\u2019]s)(?=[A-Z])/gi, "$1 ")
    .replace(/([A-Za-z])(declarations?)\b/gi, "$1 $2")
    .replace(/\binsupport\b/gi, "in support")
    .replace(/\s+/g, " ")
    .trim();
}

// A declaration listed after a semicolon is a *supporting* document within a
// multi-document filing (e.g. "Opposition to Motion; Declaration of Smith").
// It isn't the primary document, so drop such declaration clauses and let the
// filing be named from the primary document instead. The first clause (the
// primary document) is always kept \u2014 a standalone "Declaration of X" with no
// preceding semicolon is untouched, so it still names as a declaration.
function stripSupportingDeclaration(s) {
  if (!s.includes(";")) return s;
  const isDecl = (p) => /\bdeclaration\b|\bdecl\./i.test(p);
  const kept = s.split(";").filter((p, i) => i === 0 || !isDecl(p));
  const out = kept.join(";").replace(/[;\s]+$/, "").trim();
  return out || s;
}

// Generational suffixes and post-nominal credentials that are never the
// surname. Without this, "Declaration of Gregory Wayne Walton II" yields the
// surname "II" ("Ii Decl.") instead of "Walton".
const NAME_TAIL_NOISE = new Set([
  "jr", "sr", "ii", "iii", "iv", "v", "vi",
  "esq", "esquire", "mscj", "phd", "md", "jd", "llm", "cpa",
]);

// Capitalize each hyphen-separated segment; "SMITH" → "Smith",
// "GARCIA-LOPEZ" → "Garcia-Lopez". Picks the surname as the last *real* token,
// skipping trailing generational suffixes ("II"), credentials ("MSCJ", "Esq."),
// lone initials, and OCR noise (stray digits/single letters).
function titleCaseLastWord(name) {
  const parts = name.trim().split(/\s+/);
  while (parts.length > 1) {
    const bare = parts[parts.length - 1].replace(/[.,]/g, "").toLowerCase();
    if (bare === "" || /^\d+$/.test(bare) || bare.length === 1 || NAME_TAIL_NOISE.has(bare)) {
      parts.pop();
    } else {
      break;
    }
  }
  const last = parts[parts.length - 1] || "";
  return last
    .split("-")
    .map(seg => seg ? seg[0].toUpperCase() + seg.slice(1).toLowerCase() : "")
    .join("-");
}

const LOWER_CONNECTORS = new Set([
  "a","an","the","and","or","but","for","nor","yet","so",
  "as","at","by","in","of","off","on","per","to","up","via","with",
]);
function titleCasePhrase(s) {
  return s.trim().split(/\s+/).map((w, i) => {
    const lower = w.toLowerCase();
    if (i > 0 && LOWER_CONNECTORS.has(lower)) return lower;
    return lower ? lower[0].toUpperCase() + lower.slice(1) : "";
  }).join(" ");
}

// === step 2: caption party capture ===
//
// "...Hopkins v. Bright Tutors LLC, et al" → party = "Hopkins".
// Both sides of v. need uppercase first letter (so lowercase prose "v" doesn't trip).
// We take the LAST v.-match in the string — case captions are at the tail.
function capturePartyFromCaptionTail(s) {
  // A declaration is named after its declarant, never the case caption — and a
  // declarant's middle initial "V." ("Paul V. Carelli") looks exactly like a
  // caption "v." connector, which would wrongly truncate the name. So skip
  // caption-party capture entirely for declarations.
  if (/\bdecl(?:aration|\.)\s+of\b/i.test(s)) return { stripped: s, party: null };
  // [Vv]\. for the connector — case captions use either V. or v.
  // Surrounding tokens require uppercase first letter so lowercase prose
  // "guns v cars" doesn't trip.
  const matches = [...s.matchAll(/\b([A-Z][A-Za-z'-]+)\s+[Vv]s?\.?\s+[A-Z][A-Za-z'-]+/g)];
  if (matches.length === 0) return { stripped: s, party: null };
  const m = matches[matches.length - 1];
  const party = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return { stripped: s.slice(0, m.index).replace(/[,\s]+$/, "").trim(), party };
}

// === step 3: noise stripping ===

function stripCaseNumberNoise(s) {
  // Leading California case number token, e.g. "25STCV32877 ..." or
  // "30STCV12345 ..." printed at the top of a caption — strip it so it doesn't
  // become the leading word of the name.
  s = s.replace(/^\s*\d{2}[A-Z]{2,6}\d{3,}\b\s*/i, "").trim();
  // "CASE NO. 30STCV12345" → strip from here to end.
  s = s.replace(/\bcase\s+(?:no\.?|number)\s+\S.*$/i, "").trim();
  // Trailing comma-laden descriptive blobs like "for compensatory, punitive,
  // and liquidated damages, injunctive relief, and civil penalties". Anchored
  // on damages-vocabulary openers so we don't strip "Motion for Summary Judgment".
  s = s.replace(/\bfor\s+(?:damages|compensatory|punitive|liquidated|injunctive|civil|monetary|equitable|declaratory)\b[^.]*$/i, "").trim();
  s = s.replace(/[,.\s]+$/, "").trim();
  return s;
}

// === step 4: "Notice of Motion ... and Motion ..." prefix collapse ===
//
// A "Notice of Motion" whose footer also contains the phrase "and Motion" is
// the combined notice+motion filing, so it's really a Motion. Strip the
// "Notice of Motion ... and " lead-in (up to the "and" before that Motion) so
// the Motion rule sees the actual motion. This fires whether "and Motion"
// immediately follows "Notice of Motion" ("Notice of Motion and Motion to X")
// or trails other words ("Notice of Motion for Summary Judgment and Motion for
// Adjudication"). A bare "Notice of Motion for X" with no "and Motion" is left
// alone — it's its own procedural-notice type.
//
// Accepts an optional leading party possessive in the same step so the
// bare-possessive party-strip never sees this construction. Eliminates a
// class of misfires where the lazy 's regex walked past Motion words.
function stripNoticeOfMotionAndMotion(s) {
  return s.replace(
    /^(?:[a-z][a-z\s.'&,-]+?'s\s+)?notice\s+of\s+motion\b[\s\S]*?\band\s+(?=motion\b)/i,
    ""
  );
}

// === filing-party capture (non-destructive) ===
//
// Looks at the leading possessive on the string and returns the filing
// party as a single display label. Examples:
//
//   "Plaintiff's Complaint"             → "Plaintiff"
//   "Defendant Pacific Insurance's Demurrer"  → "Pacific Insurance"
//   "Receiver's Opposition"             → "Receiver"
//   "Creditco's Motion"                 → "Creditco"
//   "Plaintiff Jordan Avery's Opp."      → "Jordan Avery"
//
// Returns null when nothing party-shaped is at the front. The result is
// used only as a disambiguation qualifier — when two documents of the
// same type collide and the user needs to tell them apart.
//
// Non-destructive: doesn't modify the input string. The type rules
// anchor on document-type keywords directly, so the leading possessive
// stays in place for them.
//
// Implementation notes:
// - When a standard procedural role (Plaintiff/Defendant/etc.) is
//   followed by additional content before the 's, that content is the
//   more distinguishing piece — return it instead of the role label.
//   "Defendant Pacific Insurance's" → "Pacific Insurance" because the role alone
//   ("Defendant") isn't distinguishing in a case with multiple defendants.
// - When the leading possessive is just a role with no name
//   ("Plaintiff's"), or when it's not a recognized role at all
//   ("Receiver's", "Creditco's"), use the captured phrase as-is.
// - The bare-possessive pattern is lazy and could in principle walk
//   past document-type keywords to find an 's later in the string;
//   guard against that with looksLikeDocTypeKeyword.

const KNOWN_ROLES_RE = new RegExp(
  "^(?:" +
  "plaintiffs?|defendants?|petitioners?|respondents?|" +
  "cross-?plaintiffs?|cross-?defendants?|cross-?complainants?|cross-?respondents?|" +
  "counter-?plaintiffs?|counter-?defendants?|counter-?claimants?|" +
  "third-?party\\s+plaintiffs?|third-?party\\s+defendants?" +
  ")\\b",
  "i"
);

function capturePartyLabel(s) {
  // Pattern 1: "{KnownRole} {Name}'s ..." — return the name part.
  // The role is matched non-greedily; everything between it and the 's
  // is the name (which may be multiple tokens for corporate names).
  const labeledWithName = s.match(
    /^(?:plaintiffs?|defendants?|petitioners?|respondents?|cross-?plaintiffs?|cross-?defendants?|cross-?complainants?|cross-?respondents?|counter-?plaintiffs?|counter-?defendants?|counter-?claimants?|third-?party\s+plaintiffs?|third-?party\s+defendants?)\s+([a-z][a-z\s.'&,-]*?)'s\b/i
  );
  if (labeledWithName) {
    const name = labeledWithName[1].trim();
    if (name) return titleCasePartyLabel(name);
    // Fall through to the role-only branch if the capture was empty.
  }

  // Pattern 2: "{KnownRole}'s ..." — return the role itself.
  const roleOnly = s.match(
    /^(plaintiffs?|defendants?|petitioners?|respondents?|cross-?plaintiffs?|cross-?defendants?|cross-?complainants?|cross-?respondents?|counter-?plaintiffs?|counter-?defendants?|counter-?claimants?|third-?party\s+plaintiffs?|third-?party\s+defendants?)'s\b/i
  );
  if (roleOnly) {
    return titleCasePartyLabel(roleOnly[1]);
  }

  // Pattern 3: bare leading possessive — not a recognized role label,
  // so the captured phrase IS the party label. Covers "Receiver's",
  // "Trustee's", "Creditco's", "Pacific Insurance's", etc. Guard against
  // greedy backtracking onto document-type keywords.
  const bare = s.match(/^([a-z][a-z\s.'&,-]+?)'s\b/i);
  if (bare) {
    const candidate = bare[1].trim();
    if (looksLikeDocTypeKeyword(candidate)) return null;
    return titleCasePartyLabel(candidate);
  }

  return null;
}

function looksLikeDocTypeKeyword(phrase) {
  return /^(?:opposition|reply|motion|petition|declaration|decl|demurrer|complaint|notice|memorandum|memo|brief|answer|application|ex\s+parte)\b/i.test(phrase);
}

// Title-case a party label. Preserves common short-form corporate
// suffixes in all-caps (LLC, Inc, Co, etc.). Hyphens preserved.
function titleCasePartyLabel(name) {
  // Acronyms that are conventionally all-caps in legal writing. "Corp",
  // "Inc", "Co", "Ltd" are title-case in practice ("Acme Corp."), so we
  // let normal title-casing handle them.
  const SHORT_UPPER = new Set(["llc","llp","lllp","lp","pc","gp","plc","na"]);
  return name.split(/\s+/).map((tok, i) => {
    const stripped = tok.replace(/\.+$/, "");
    const lower = stripped.toLowerCase();
    const hadDot = tok.endsWith(".");
    if (SHORT_UPPER.has(lower)) return lower.toUpperCase() + (hadDot ? "." : "");
    if (i > 0 && LOWER_CONNECTORS.has(lower)) return lower;
    return tok
      .split("-")
      .map(seg => seg ? seg[0].toUpperCase() + seg.slice(1).toLowerCase() : "")
      .join("-");
  }).join(" ");
}

// === step 5: type identification rules ===

// Declaration name extraction.
//   "Declaration of [First] [Middle?] [Last]" — captures up to ISO clause
//   or punctuation; last token in the captured slice is the surname.
//   "[Last] Declaration" or "[Last] Decl[.]"
function lastNameFromOf(s) {
  // Accept the abbreviated "Decl. of {name}" (common in filenames) as well as
  // the spelled-out "Declaration of {name}".
  const m = s.match(
    /\b(?:declaration|decl\.?)\s+of\s+([A-Za-z][A-Za-z'\-.]*(?:\s+[A-Za-z][A-Za-z'\-.]*)*?)(?=\s+(?:in\s+support(?:\s+of)?|in\s+supp\.?|i\/?s\/?o|iso)\b|\s*[,.]|$)/i
  );
  if (!m) return null;
  return titleCaseLastWord(m[1]);
}
function lastNameFromNameDecl(s) {
  const m = s.match(/\b([A-Za-z][A-Za-z'\-.]*)\s+decl(?:aration|\.?)\b/i);
  if (!m) return null;
  return titleCaseLastWord(m[1]);
}

// Detect what's being supported by an ISO clause.
// "...ISO Plaintiff's Opposition to Motion..." → "opposition" (outermost wins).
//
// Accepts loose ISO connectors: "in support of" (canonical), "in support"
// (missing "of" — seen in real footers), "in supp." / "in supp",
// "i/s/o", "iso". Without one of these, no ISO target is detected.
function detectISOTarget(s) {
  const m = s.match(/(?:in\s+support(?:\s+of)?|in\s+supp\.?|i\/?s\/?o|iso)\b(.*)$/i);
  if (!m) return null;
  const tail = m[1].toLowerCase();
  if (/\breply\b/.test(tail))                       return "reply";
  if (/\bopposition\b|\bopp\.?\b/.test(tail))       return "opposition";
  if (/\bex\s+parte\s+application\b/.test(tail))    return "exparte";
  if (/\brjn\b|\brequest\s+for\s+judicial\s+notice\b|\breq\.?\s+for\s+judicial\s+notice\b/.test(tail)) return "rjn";
  if (/\bmotion\b|\bmot\.?\b/.test(tail))           return "motion";
  if (/\bpetition\b|\bpet\.?\b/.test(tail))         return "petition";
  return null;
}

const RULES = [
  // 0. Objection to a declaration. Must precede the declaration rules, which
  // would otherwise name it after the declarant ("Anderson Decl.") instead of
  // as the objection to that declaration.
  {
    name: "objection-to-decl",
    test(s) {
      if (!/^\s*objections?\s+to\b/i.test(s)) return null;
      if (!/\bdeclaration\b|\bdecl\.?\b/i.test(s)) return null;
      const last = lastNameFromOf(s) || lastNameFromNameDecl(s);
      if (!last) return null;
      return { canonical: `Objection to ${last} Decl.` };
    },
  },

  // 1. Declaration ISO {Reply | Opposition | Motion | Petition}
  {
    name: "decl-iso",
    test(s) {
      if (!/\bdeclaration\b|\bdecl\.?\b/i.test(s)) return null;
      const iso = detectISOTarget(s);
      if (!iso) return null;
      const last = lastNameFromOf(s) || lastNameFromNameDecl(s);
      if (!last) return null;
      const suffix = {
        reply:      "Decl. ISO Reply",
        opposition: "Decl. ISO Opp.",
        motion:     "Decl. ISO Mot.",
        petition:   "Decl. ISO Pet.",
        exparte:    "Decl. ISO Ex Parte App.",
        rjn:        "Decl. ISO RJN",
      }[iso];
      return { canonical: `${last} ${suffix}` };
    },
  },

  // 2. Bare Declaration (no ISO clause)
  {
    name: "decl-bare",
    test(s) {
      if (!/\bdeclaration\b|\bdecl\.?\b/i.test(s)) return null;
      const last = lastNameFromOf(s) || lastNameFromNameDecl(s);
      if (!last) return null;
      return { canonical: `${last} Decl.` };
    },
  },

  // 2.2. Court orders. Must precede Reply/Opposition/Demurrer/Motion because an
  // order's title references the underlying motion ("[PROPOSED] ORDER RE …
  // MOTION"). Only fires when "order" is the document's own leading type.
  {
    name: "order",
    test(s) {
      if (!/^\s*(?:\[?\s*proposed\s*\]?\s*)?order\b/i.test(s)) return null;
      const proposed = /\bproposed\b/i.test(s) || /^\s*\[/.test(s);
      if (/\border\s+of\s+dismissal\b/i.test(s)) {
        return { canonical: proposed ? "Proposed Order" : "Order of Dismissal" };
      }
      return { canonical: proposed ? "Proposed Order" : "Order" };
    },
  },

  // 2.3. Proof of service. Precedes the motion/notice rules so a "PROOF OF
  // SERVICE RE NOTICE OF MOTION …" is named for what it is, not the motion.
  {
    name: "proof-of-service",
    test(s) {
      if (!/\bproof\s+of\s+service\b/i.test(s)) return null;
      return { canonical: "Proof of Service" };
    },
  },

  // 2.4. Request for dismissal (distinct from a request for judicial notice or
  // for entry of default judgment).
  {
    name: "request-for-dismissal",
    test(s) {
      if (!/\brequest\s+for\s+dismissal\b/i.test(s)) return null;
      return { canonical: "Request for Dismissal" };
    },
  },

  // 2.5. Request for Judicial Notice — a procedural support doc, like a
  // Declaration. Must come before Reply/Opposition/Motion/Demurrer
  // because an RJN ISO clause mentions those types but isn't them.
  //
  // Recognized forms (all collapse to "RJN"):
  //   "Request for Judicial Notice"
  //   "Req for Judicial Notice"   / "Req. for Judicial Notice"
  //   "RJN"
  //
  // Canonical:
  //   bare              → "RJN"
  //   "...ISO Opp..."   → "RJN ISO Opp."
  //   "...ISO Mot..."   → "RJN ISO Mot."
  //   (same suffix map as Declaration)
  //
  // Target captured for disambiguation: same deeper-target form as Reply's
  // "Opp. to Demurrer" / "Opp. to Mot." etc. — so two colliding RJNs ISO
  // Oppositions can be told apart by what their oppositions oppose.
  {
    name: "rjn",
    test(s) {
      const isRjn =
        /\brjn\b/i.test(s) ||
        /\brequest\s+for\s+judicial\s+notice\b/i.test(s) ||
        /\breq\.?\s+for\s+judicial\s+notice\b/i.test(s);
      if (!isRjn) return null;

      const iso = detectISOTarget(s);
      let canonical = "RJN";
      if (iso && iso !== "rjn") {
        // An RJN supports another doc, not another RJN. If detectISOTarget
        // returned "rjn" the footer is malformed; stay bare.
        const suffix = {
          reply:      "ISO Reply",
          opposition: "ISO Opp.",
          motion:     "ISO Mot.",
          petition:   "ISO Pet.",
          exparte:    "ISO Ex Parte App.",
        }[iso];
        canonical = `RJN ${suffix}`;
      }

      // Deeper target: when the RJN supports an Opposition, what does
      // the opposition oppose? Mirrors the Reply rule's logic.
      let target = null;
      const isoMatch = s.match(/(?:in\s+support(?:\s+of)?|in\s+supp\.?|i\/?s\/?o|iso)\b(.*)$/i);
      if (isoMatch) {
        const tail = isoMatch[1];
        // "ISO Opp. to {X}" or "ISO Opposition to {X}"
        const oppToX = /\b(?:opposition|opp\.?)\s+(?:to|of)\s+(.+)$/i.exec(tail);
        if (oppToX) {
          const deepest = oppToX[1];
          if (/\bdemurrer\b/i.test(deepest))                    target = "Opp. to Demurrer";
          else if (/\bex\s+parte\s+application\b/i.test(deepest)) target = "Opp. to Ex Parte App.";
          else if (/\bpetition\b/i.test(deepest))               target = "Opp. to Pet.";
          else if (/\bmotion\b/i.test(deepest))                 target = "Opp. to Mot.";
          else                                                  target = "Opp.";
        }
      }

      return { canonical, target };
    },
  },

  // 2.7. Separate Statement — a procedural support doc that accompanies
  // a Motion for Summary Judgment (and similar discovery motions),
  // listing material facts. Several forms (most-specific first):
  //
  //   "...Separate Statement of Additional [...] Material Facts"   → AUMF
  //   "...Separate Statement in Opposition..."                     → UMF
  //   "Response(s) to ... Separate Statement of UMF"               → UMF
  //   "Separate Statement in Reply…"                               → Reply Separate Statement
  //   bare "Separate Statement"                                    → Separate Statement
  //
  // AUMF (Statement of Additional Undisputed Material Facts) is what the
  // opposing party files to introduce new facts. The "Additional" anchor
  // distinguishes it from a plain responsive UMF.
  //
  // UMF covers both phrasings of the responsive document: "Separate
  // Statement in Opposition to MSJ" (the opposing party's responsive
  // statement, addressing each of the moving party's facts) and
  // "Response(s) to [Party's] Separate Statement of UMF" (the same
  // document under a different name convention). They're functionally
  // identical so both collapse to UMF.
  //
  // The moving party's ORIGINAL filing — "Separate Statement of
  // Undisputed Material Facts in Support of MSJ" with no "in Opposition"
  // or "Response to" anchor — stays as bare "Separate Statement"
  // (per user preference: only responsive ones get short forms).
  //
  // Must precede Reply/Opposition/Motion in rule order because the
  // footer contains those keywords but the doc is none of them.
  {
    name: "separate-statement",
    test(s) {
      if (!/\bseparate\s+statement\b/i.test(s)) return null;

      // AUMF: "Separate Statement of [...] Additional [...] Material Facts".
      // The "Additional" word must appear inside the SS-of-Material-Facts
      // phrase, not anywhere in the footer — otherwise unrelated mentions
      // of "additional" elsewhere would trip the rule. Checked first
      // because AUMF footers often also contain "in Opposition" /
      // "in Support of Opposition" which would otherwise match UMF.
      if (/\bseparate\s+statement\s+of\s+[a-z\s]*\badditional\b[a-z\s]*\bmaterial\s+facts\b/i.test(s)) {
        return { canonical: "AUMF" };
      }

      // UMF: either "Separate Statement in Opposition" (the standard
      // responsive form) or "Response(s) to ... Separate Statement of
      // UMF" (alternate naming convention). Both produce UMF.
      if (/\bseparate\s+statement\s+in\s+opposition\b/i.test(s)) {
        return { canonical: "UMF" };
      }
      if (/\bresponses?\s+to\b[\s\S]*\bseparate\s+statement\s+of\s+[a-z\s]*\bundisputed\s+material\s+facts\b/i.test(s)) {
        return { canonical: "UMF" };
      }

      // Reply variant (still has its own canonical).
      if (/\bseparate\s+statement\s+in\s+reply\b/i.test(s)) {
        return { canonical: "Reply Separate Statement" };
      }

      // Bare "Separate Statement" (the moving party's original).
      return { canonical: "Separate Statement" };
    },
  },

  // 3. Reply — must precede Opposition since Reply contains "Opposition to ...".
  {
    name: "reply",
    test(s) {
      if (!/\breply\b/i.test(s)) return null;
      // What's after "reply to / in support of"? That's what's being replied to.
      const afterReply = /\breply\s+(?:to|in\s+support(?:\s+of)?|in\s+supp\.?|i\/?s\/?o|iso)\s+(.+)$/i.exec(s);
      if (!afterReply) return { canonical: "Reply", target: null };
      const inner = afterReply[1];

      // Most common: "Reply to [Party's] Opposition to [Motion/Petition/Demurrer/Ex Parte App]"
      const oppInner = /\b(?:[a-z][a-z\s.'&,-]+?'s\s+)?opposition\s+(?:to|of)\s+(.+)$/i.exec(inner);
      if (oppInner) {
        const deepest = oppInner[1];
        // Order: demurrer/ex-parte are specific; motion last.
        if (/\bdemurrer\b/i.test(deepest))                    return { canonical: "Reply", target: "Opp. to Demurrer" };
        if (/\bex\s+parte\s+application\b/i.test(deepest))    return { canonical: "Reply", target: "Opp. to Ex Parte App." };
        if (/\bpetition\b/i.test(deepest))                    return { canonical: "Reply", target: "Opp. to Pet." };
        if (/\bmotion\b/i.test(deepest))                      return { canonical: "Reply", target: "Opp. to Mot." };
        return { canonical: "Reply", target: "Opp." };
      }

      // Direct: "Reply in support of Motion to X" (no opposition layer).
      if (/\bdemurrer\b/i.test(inner))                 return { canonical: "Reply", target: "Demurrer" };
      if (/\bex\s+parte\s+application\b/i.test(inner)) return { canonical: "Reply", target: "Ex Parte App." };
      if (/\bpetition\b/i.test(inner))                 return { canonical: "Reply", target: "Pet." };
      if (/\bmotion\b/i.test(inner))                   return { canonical: "Reply", target: "Mot." };
      return { canonical: "Reply", target: null };
    },
  },

  // 4. Opposition (with target = what's opposed)
  {
    name: "opposition",
    test(s) {
      if (!/\bopposition\b/i.test(s)) return null;
      // "Opposition to [Party's] [Motion/Petition/Demurrer/Ex Parte App]" —
      // allow the intervening party possessive.
      const m = /\bopposition\s+(?:to|of)\s+(?:[a-z][a-z\s.'&,-]+?'s\s+)?(.+)$/i.exec(s);
      let target = null;
      if (m) {
        const inner = m[1];
        // Order matters: check ex parte BEFORE motion/petition because
        // "ex parte application" doesn't contain the word "motion" but
        // an "ex parte motion" does. Demurrer is unique and goes first.
        if (/\bdemurrer\b/i.test(inner))           target = "Demurrer";
        else if (/\bex\s+parte\s+application\b/i.test(inner)) target = "Ex Parte App.";
        else if (/\bpetition\b/i.test(inner))      target = "Pet.";
        else if (/\bmotion\b/i.test(inner))        target = "Mot.";
      }
      return { canonical: "Opposition", target };
    },
  },

  // 5. Demurrer (covers "Notice of Demurrer and Demurrer" wrapper).
  // Target captures "to [Party's] [N] Amended Complaint" or "to [Party's] SAC/FAC/TAC/Answer".
  {
    name: "demurrer",
    test(s) {
      if (!/\bdemurrer\b/i.test(s)) return null;
      let target = null;
      let tm = s.match(
        /\bto\s+(?:[a-z][a-z\s.'&,-]+?'s\s+)?(?:the\s+)?(first|second|third|1st|2nd|3rd)\s+amended\s+complaint\b/i
      );
      if (tm) {
        const ord = tm[1].toLowerCase();
        target = (ord === "first" || ord === "1st") ? "FAC"
               : (ord === "second" || ord === "2nd") ? "SAC"
               : "TAC";
      } else {
        tm = s.match(/\bto\s+(?:[a-z][a-z\s.'&,-]+?'s\s+)?(sac|fac|tac|answer)\b/i);
        if (tm) {
          target = tm[1].toUpperCase() === "ANSWER" ? "Answer" : tm[1].toUpperCase();
        }
      }
      return { canonical: "Demurrer", target };
    },
  },

  // 6. Bare Notice of Motion (the "and Motion ..." form was collapsed in step 4).
  // Must come BEFORE the Motion rule, otherwise "Notice of Motion for Summary
  // Judgment" matches the Motion rule on the "motion for" substring inside.
  // Captures target = which motion this notice is for.
  {
    name: "notice-of-motion",
    test(s) {
      if (!/\bnotice\s+of\s+motion\b/i.test(s)) return null;
      let target = null;
      const toM  = s.match(/\bnotice\s+of\s+motion\s+to\s+([a-z][a-z\s']+?)(?:\s+in\b|\s*[,.;]|\s*$)/i);
      const forM = s.match(/\bnotice\s+of\s+motion\s+for\s+([a-z][a-z\s']+?)(?:\s+in\b|\s*[,.;]|\s*$)/i);
      if (toM)       target = "Mot. to "  + titleCasePhrase(toM[1].trim());
      else if (forM) target = "Mot. for " + titleCasePhrase(forM[1].trim());
      // A "Notice of Motion" IS the motion for naming purposes — the filed
      // document is the notice+motion. (Confirmed across the naming history:
      // every "Notice of Motion …" the user kept was named "Motion".)
      return { canonical: "Motion", target };
    },
  },

  // 7. Ex Parte Application — must precede Motion because "ex parte
  // application for X" / "to X" structurally overlaps with Motion forms.
  // Like Motion, all variants collapse to "Ex Parte Application"; the
  // "to X"/"for X" form is captured as target for disambiguation only.
  {
    name: "ex-parte",
    test(s) {
      if (!/\bex\s+parte\s+application\b/i.test(s)) return null;
      let target = null;
      // "ex parte application to/for X" with the same target-capture
      // strategy as Motion. The LAST occurrence in the string wins.
      const toMs  = [...s.matchAll(/\bex\s+parte\s+application\s+to\s+([a-z][a-z\s']+?)(?:\s+in\b|\s*[,.;]|\s*$)/gi)];
      const forMs = [...s.matchAll(/\bex\s+parte\s+application\s+for\s+([a-z][a-z\s']+?)(?:\s+in\b|\s*[,.;]|\s*$)/gi)];
      const all = [...toMs.map(m => ({ m, kind: "to" })), ...forMs.map(m => ({ m, kind: "for" }))];
      all.sort((a, b) => b.m.index - a.m.index);
      if (all.length) {
        const winner = all[0];
        target = (winner.kind === "to" ? "Ex Parte App. to " : "Ex Parte App. for ")
               + titleCasePhrase(winner.m[1].trim());
      }
      return { canonical: "Ex Parte Application", target };
    },
  },

  // 8. Motion — collapses to bare "Motion". Target = "Mot. to X" / "Mot. for X"
  // for disambiguation. Uses the LAST "motion to/for X" in the string because
  // the doc's own type usually comes after wrapper noise.
  {
    name: "motion",
    test(s) {
      if (!/\bmotion\b/i.test(s)) return null;
      const toMs  = [...s.matchAll(/\bmotion\s+to\s+([a-z][a-z\s']+?)(?:\s+in\b|\s*[,.;]|\s*$)/gi)];
      const forMs = [...s.matchAll(/\bmotion\s+for\s+([a-z][a-z\s']+?)(?:\s+in\b|\s*[,.;]|\s*$)/gi)];
      const all = [...toMs.map(m => ({ m, kind: "to" })), ...forMs.map(m => ({ m, kind: "for" }))];
      all.sort((a, b) => b.m.index - a.m.index);
      let target = null;
      if (all.length) {
        const winner = all[0];
        target = (winner.kind === "to" ? "Mot. to " : "Mot. for ")
               + titleCasePhrase(winner.m[1].trim());
      }
      return { canonical: "Motion", target };
    },
  },

  // 8. Petition — parallels Motion.
  {
    name: "petition",
    test(s) {
      if (!/\bpetition\b/i.test(s)) return null;
      const toMs  = [...s.matchAll(/\bpetition\s+to\s+([a-z][a-z\s']+?)(?:\s+in\b|\s*[,.;]|\s*$)/gi)];
      const forMs = [...s.matchAll(/\bpetition\s+for\s+([a-z][a-z\s']+?)(?:\s+in\b|\s*[,.;]|\s*$)/gi)];
      const all = [...toMs.map(m => ({ m, kind: "to" })), ...forMs.map(m => ({ m, kind: "for" }))];
      all.sort((a, b) => b.m.index - a.m.index);
      let target = null;
      if (all.length) {
        const winner = all[0];
        target = (winner.kind === "to" ? "Pet. to " : "Pet. for ")
               + titleCasePhrase(winner.m[1].trim());
      }
      return { canonical: "Petition", target };
    },
  },

  // 9. Amended complaints — FAC/SAC/TAC are their own canonical name.
  // Must come before the bare Complaint rule.
  {
    name: "amended-complaint",
    test(s) {
      if (/\b(?:third|3rd)\s+amended\s+complaint\b/i.test(s))  return { canonical: "TAC" };
      if (/\b(?:second|2nd)\s+amended\s+complaint\b/i.test(s)) return { canonical: "SAC" };
      if (/\b(?:first|1st)\s+amended\s+complaint\b/i.test(s))  return { canonical: "FAC" };
      return null;
    },
  },

  // 9.5. Amendment to a complaint (e.g. correcting a fictitious/incorrect name)
  // is NOT the complaint itself — must precede the Complaint catchall.
  {
    name: "amendment-to-complaint",
    test(s) {
      if (!/\bamendment\s+to\s+(?:the\s+)?complaint\b/i.test(s)) return null;
      return { canonical: "Amendment to Complaint" };
    },
  },

  // 10. Complaint (catchall — runs after FAC/SAC/TAC).
  {
    name: "complaint",
    test(s) {
      if (!/\bcomplaint\b/i.test(s)) return null;
      return { canonical: "Complaint" };
    },
  },
];

// === main extractor ===

export function extractTitle(raw) {
  const result = {
    canonical: null,
    target: null,
    party: null,          // case-caption party ("Hopkins" from "X v. Y")
    partyLabel: null,     // filing-party label ("Receiver", "Pacific Insurance", "Plaintiff")
    raw: raw || "",
  };
  if (!raw) return result;

  let s = normalize(raw);
  // Drop a declaration that trails a semicolon — it's a supporting document,
  // not the primary one this filing should be named after. Done before sRaw is
  // captured so the "recover a Decl." insurance below doesn't re-introduce it.
  s = stripSupportingDeclaration(s);
  const sRaw = s;  // for the post-match insurance check

  // 2. Caption party (and strip the tail).
  const cap = capturePartyFromCaptionTail(s);
  s = cap.stripped;
  result.party = cap.party;

  // 3. Case-number / damages-blob noise.
  s = stripCaseNumberNoise(s);

  // 4. Collapse "Notice of Motion and Motion ..." prefix.
  s = stripNoticeOfMotionAndMotion(s);

  // 4.5 Capture filing-party label from the head of the string. Done
  // non-destructively — the type rules anchor on document-type keywords
  // and don't care about the leading possessive, so we leave it in place.
  result.partyLabel = capturePartyLabel(s);

  // 5. Walk type rules.
  let matched = null;
  for (const rule of RULES) {
    const r = rule.test(s);
    if (r) { matched = r; break; }
  }
  if (matched) {
    result.canonical = matched.canonical;
    if (matched.target) result.target = matched.target;
  }

  // Insurance: if input contained DECLARATION/DECL. but we matched a
  // non-declaration rule, the declaration rules' name regex must have
  // failed. Recover a bare "{Last} Decl." rather than mislabeling.
  if (
    result.canonical &&
    !/\bDecl\.?/.test(result.canonical) &&
    /\b(?:declaration|decl\.?)\b/i.test(sRaw)
  ) {
    const last = lastNameFromOf(sRaw) || lastNameFromNameDecl(sRaw);
    if (last) {
      result.canonical = `${last} Decl.`;
      result.target = null;
    }
  }

  return result;
}

// === disambiguation ===
//
// Input:  entries — each { id, canonical, target, party, partyLabel }
//   canonical:  bare document type ("Opposition", "Demurrer", ...)
//   target:     what the doc is responding to ("Mot.", "Demurrer", "SAC", ...)
//   party:      case-caption plaintiff ("Hopkins") — Complaint disambiguator
//   partyLabel: filing-party label ("Receiver", "Pacific Insurance", "Plaintiff")
//
// Output: Map<id, displayName>
//
// Unique canonicals stay bare. For colliding groups, the algorithm walks
// a ladder from cheapest qualifier to most-detailed, stopping when the
// group is fully unique:
//
//   Level 1: target only           → "Demurrer to SAC" / "Opposition to Demurrer"
//   Level 2: partyLabel only       → "Receiver's Opposition" / "Pacific Insurance's Demurrer"
//   Level 3: target + partyLabel   → "Receiver's Opposition to Ex Parte App."
//
// An entry with neither target nor partyLabel stays bare at every level
// (no info to add). If two such entries collide, they remain visually
// identical — there's no synthetic suffix and the user must rename manually.
//
// Declarations and FAC/SAC/TAC have their own disambiguation already
// baked into their canonical names (last name + ISO suffix; ordinal
// prefix); they stay as-is.
//
// Complaints use a different model: the case-caption party (from the
// "X v. Y" tail) is the natural disambiguator, not the filing-party
// label. Most Complaints are filed by "Plaintiff" with no name, which
// makes partyLabel useless, but the case caption is reliable.

const TYPES_WITH_LADDER = new Set([
  "Demurrer", "Motion", "Petition", "Notice of Motion",
  "Opposition", "Reply", "Ex Parte Application",
  "Separate Statement", "Reply Separate Statement",
  "AUMF", "UMF",
]);

// True if this canonical participates in the iterative disambiguation
// ladder. RJN variants (e.g. "RJN ISO Opp.") aren't enumerated above
// because the suffix varies with the supported doc type — but they all
// follow the ladder.
function hasLadder(canonical) {
  if (TYPES_WITH_LADDER.has(canonical)) return true;
  if (canonical === "RJN") return true;
  if (canonical.startsWith("RJN ISO ")) return true;
  return false;
}

// Format an entry given a level + a type. Returns the display name string.
function formatAtLevel(e, level) {
  const c = e.canonical;
  switch (level) {
    case 0: // bare canonical
      return c;
    case 1: // target only
      return formatWithTarget(c, e.target) || c;
    case 2: // partyLabel only
      return e.partyLabel ? `${possessive(e.partyLabel)} ${c}` : c;
    case 3: // target + partyLabel
      {
        const withT = formatWithTarget(c, e.target);
        if (withT && e.partyLabel) return `${possessive(e.partyLabel)} ${withT}`;
        if (withT) return withT;
        if (e.partyLabel) return `${possessive(e.partyLabel)} ${c}`;
        return c;
      }
  }
  return c;
}

// Type-specific "{canonical} + {target}" formatting. Returns null when
// the target isn't usable for this type.
function formatWithTarget(canonical, target) {
  if (!target) return null;
  switch (canonical) {
    case "Demurrer":          return `Demurrer to ${target}`;
    case "Opposition":        return `Opposition to ${target}`;
    case "Reply":             return `Reply to ${target}`;
    case "Notice of Motion":  return `Notice of ${target}`;
    case "Motion":            return target;  // target already starts with "Mot."
    case "Petition":          return target;  // target already starts with "Pet."
    case "Ex Parte Application": return target;  // already starts with "Ex Parte App."
  }
  // RJN variants: target is the deeper "Opp. to X" form. Append it to
  // the canonical so "RJN ISO Opp." becomes "RJN ISO Opp. to Demurrer".
  if (canonical === "RJN" || canonical.startsWith("RJN ISO ")) {
    // Strip a trailing period before appending, then re-add for tidiness.
    const base = canonical.replace(/\.$/, "");
    return `${base} to ${target.replace(/^Opp\.\s+to\s+/, "")}`;
  }
  return null;
}

// Possessive form. "Receiver" → "Receiver's"; "Pacific Insurance" → "Pacific Insurance's";
// "James" → "James's"; "Jones" → "Jones's" (CMS style — we don't try to
// detect "ends in s" and switch to bare apostrophe).
function possessive(s) {
  return `${s}'s`;
}

export function disambiguate(entries) {
  const out = new Map();
  const groups = new Map();
  for (const e of entries) {
    if (!e.canonical) { out.set(e.id, ""); continue; }
    if (!groups.has(e.canonical)) groups.set(e.canonical, []);
    groups.get(e.canonical).push(e);
  }

  for (const [canonical, group] of groups) {
    if (group.length === 1) {
      out.set(group[0].id, canonical);
      continue;
    }

    // Special cases that don't use the ladder.
    if (/\bDecl\.?\b/.test(canonical) || canonical === "FAC" || canonical === "SAC" || canonical === "TAC") {
      for (const e of group) out.set(e.id, canonical);
      continue;
    }
    if (canonical === "Complaint") {
      for (const e of group) {
        out.set(e.id, e.party ? `${e.party} Complaint` : "Complaint");
      }
      continue;
    }

    if (!hasLadder(canonical)) {
      // No known disambiguator — leave bare.
      for (const e of group) out.set(e.id, canonical);
      continue;
    }

    // Walk the ladder. At each level, format every entry; if the result
    // is unique across the group, commit. Otherwise advance to the next
    // level. Level 0 (bare) is skipped — we're here because the group
    // collides on the bare form.
    let chosenLevel = 3;  // fallback if nothing makes it unique
    for (let level = 1; level <= 3; level++) {
      const names = group.map(e => formatAtLevel(e, level));
      if (new Set(names).size === names.length) {
        chosenLevel = level;
        break;
      }
    }
    for (const e of group) {
      out.set(e.id, formatAtLevel(e, chosenLevel));
    }
  }
  return out;
}
