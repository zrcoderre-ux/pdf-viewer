## Faithful port of pdf_linker.py

The detection logic is a line-by-line port of `pdf_linker.py`. Output has
been verified citation-for-citation against the Python on the sample
memorandum (10/10 match, identical keys). The port includes:

- The full reporter list — all CA reporters, federal reporters, and 13
  out-of-state regional reporters (P., A., N.E., N.W., S.E., S.W., So., N.Y.,
  spaced and compact forms).
- The walk-back-from-`v.` algorithm for accurate party-name boundaries —
  honors sentence punctuation, paragraph breaks, name-connector words
  (`of`, `the`, `and`, `&`, `de`, `la`, `du`, `von`, `van`), and corporate
  suffixes (`Co.`, `Inc.`, `Corp.`, `Ltd.`, `Ass'n.`).

  Signal words in front of the name (`See`, `In`, `the`) are dropped. Court
  and jurisdiction words (`State`, `California`, `Federal`, `Supreme`,
  `Court`) are dropped only when their own period or comma sets them off from
  the name (`as held by the Supreme Court. Smith v. Jones`, `In California,
  Smith v. Jones`). Otherwise they begin it: `State of California v. Superior
  Court (Flynn) (2016) 4 Cal.App.5th 94`, `State Farm Mut. Auto. Ins. Co.`,
  `California Teachers Assn.`, `Federal Deposit Ins. Corp.`. Before this, the
  first of those went unlinked because every word of its plaintiff was
  stripped, and the rest lost their first word.
- All 29 California codes (long forms, CSM short forms, and bare uppercase
  abbreviations such as `CCP § 664.6`, `PEN § 187`, `BPC § 17200`), section
  number shapes including `437c` and `1714.45(b)(1)`.
- Model **Uniform Commercial Code** cites (`U.C.C. § 3-310`, `Uniform
  Commercial Code § 2-207`) — distinguished from California's Commercial Code
  by the hyphenated section number, and resolved to the model UCC on each
  provider (`U.C.C. § 3-310` on Lexis+, `Unif.Commercial Code § 3-310` on
  Westlaw).
- **Federal regulations**: the C.F.R. by title (`29 C.F.R. § 2560.503-1`,
  `45 CFR 164.512(a)`, and part cites like `40 C.F.R. pt. 60`), plus named
  series where the agency stands in for the title — `Treas. Reg. § 1.125` is
  searched as `26 C.F.R. § 1.125`. A **proposed** regulation is the exception:
  `Prop. Treas. Reg. § 1.125-1` is searched as written, because a proposed
  regulation has not been adopted into the C.F.R. and the converted cite would
  point at a section that does not exist. Temporary regulations are in the
  C.F.R. and convert normally.
- **Federal codes**: the U.S. Code (`42 U.S.C. § 1983`, bare `42 USC 1983`,
  annotated `5 U.S.C.A. § 552`, appendix `9 U.S.C. App. § 1`), including the
  code spelled out the way the California Style Manual writes it —
  `50 United States Code section 3931(b)(1)`, `Title 50 of the United States
  Code, section 3931`, and the `42 U.S. Code § 1983` form a web lookup gives.
  Spelled out or abbreviated, the citation is keyed as
  `50 U.S.C. § 3931(b)(1)`, so the two spellings are one authority in the
  Table of Authorities rather than two. Named codes and acts are read as
  well — `Internal Revenue Code section 9801(f)` / `I.R.C. § 61` / `IRC
  § 501(c)(3)`, `Bankruptcy Code § 362(a)`, `ERISA § 502(a)`, `FLSA`, `NLRA`,
  the `Securities Exchange Act of 1934`.

  Named codes split on whether the act was codified section-for-section. The
  Internal Revenue Code and the Bankruptcy Code were, so `I.R.C. § 9801` is
  searched as `26 U.S.C. § 9801` — a citation both providers resolve directly.
  ERISA and the rest were not (`ERISA § 701` is `29 U.S.C. § 1181`, a
  section-by-section lookup table rather than a formula), so those keep the
  act's own numbering and are found by popular name. Either way the citation is
  listed in the Table of Authorities in the form the document used.

  Federal section numbers carry dots and hyphens *inside* one number —
  `2560.503-1`, `2000e-2`, `1.125-4T` — so they are matched with a wider
  pattern than the California codes. A hyphen between two plain integers stays
  a range: `29 U.S.C. §§ 1181-1185` links section 1181 rather than inventing a
  section "1181-1185".

  A federal search runs on the section, not the subdivision the document cited
  it down to: `50 U.S.C. § 3931(b)(1)` is searched as `50 U.S.C. § 3931`, and
  `45 C.F.R. § 164.512(a)` as `45 C.F.R. § 164.512`. The subdivision is a
  paragraph of the section rather than a document either provider indexes, so
  the shorter cite lands on the same page with less to fail on. Only the
  search is shortened — the Table of Authorities still lists the pinpoint the
  writer gave. California statutes keep their subdivisions in the search term.
- **IRS revenue rulings**: `Rev. Rul. 2013-17` and `Revenue Ruling 2013-17`,
  with or without the bulletin the ruling was published in — Bluebook T1.2
  cites to the Cumulative Bulletin or its advance sheet the Internal Revenue
  Bulletin, and `Rev. Rul. 83-137, 1983-2 C.B. 41` is underlined whole rather
  than stopping after the number. Both number eras are read: the two-digit
  year used before 2000 (`Rev. Rul. 99-7`) and the four-digit one after it.
  Whatever dash a PDF renders — hyphen, en dash, em dash — normalizes to one
  authority, so `Rev. Rul. 96–55` and `Rev. Rul. 96-55` are not listed twice.
  A ruling has no section number, so nothing carries over to a later bare
  reference the way a statute's section does.
- Non-`v.` case names (separate pattern, no `v.` anchor): `In re`,
  `Estate of`, `Guardianship of`, `Conservatorship of`, `Adoption of`,
  `Marriage of` — e.g. `Conservatorship of Whitley (2010) 50 Cal.4th 1206`.
  Prefixes nest (`In re Marriage of Bonds`), and the short name used for
  supra resolution is the subject that follows them (`Bonds`, `Whitley`).
- `Cal. Rules of Court` / `California Rules of Court`, `rule` or `rules`,
  with nested subsections.
- **Bare rules.** A rule cited with no rule set named — `rule 3.1350(f)`,
  `Rule 8.204` — is read as a California rule of court, which is what an
  unqualified rule number means in a California brief. Every rule of court
  carries a dot in its number, so the undotted forms that would otherwise be
  swept in (`rule 12(b)(6)`, `rule 5 of the bylaws`) are left alone, as is a
  rule whose neighboring words name somebody else's rules (`Federal Rules of
  Civil Procedure, rule 26.1`, `local rule 3.57`). A rule set the text names
  outright still wins: `Cal. Rules of Prof. Conduct, rule 1.9` links to the
  professional conduct rule.
- **Rule-set carry-over.** A page that ties a rule number to a rule set hands
  that set to the page's bare references to the same number, so `Rules of
  Professional Conduct, rule 1.9 ... rule 1.9(a)` is one rule cited twice.
  This reads in both directions within the page — unlike the statute
  carry-over, which runs forward only, because an unplaced bare rule is not
  left unlinked but read as a rule of court, so declining to look backwards
  would make a worse guess rather than withhold one. A page that gives one
  number two different sets leaves its bare references unlinked rather than
  choosing. A page that names the professional conduct rules and never names
  the rules of court also reads its *other* bare rules as conduct rules — the
  weaker inference, so it runs forward only from the first conduct cite, and a
  number the document ties to the rules of court anywhere keeps that set (a
  disqualification motion still notices its own hearing under rule 3.1300).
- Both **CSM** and **Bluebook** case forms — chosen by whichever tail
  pattern matches first within 200 chars after the `v.` anchor.
- **Case citations with no year.** `Doe v. City of Los Angeles, 42 Cal.4th
  531, 550` — the form a table of authorities uses, and the one a brief falls
  into when the year is left out. Every other tail is anchored by a year
  parenthetical, so without one the whole table went unlinked. The year is
  what usually proves a reporter cite is a citation, so this form is a
  fallback, read only where no year-bearing tail matched, and the proof falls
  to two other things: the reporter has to be one in the table (`42 Cal.4th
  531` is a citation, `5 March 2020` is not), and every word of the
  defendant's name has to read as part of a name — otherwise a sentence that
  runs into a reporter cite (`Doe v. Roe held, at 42 Cal.4th 531`) would pass
  as one. `supra` fails that test, which leaves short-form references to the
  pass that owns them.

  Where the same case is also cited in full somewhere in the document, the
  yearless reading takes the full citation's key — the reporter cite says they
  are the same case — so the Table of Authorities carries one entry, not two,
  and both links go to the same place. Where it isn't, the citation stands on
  its own and its search URL is built from the reporter cite alone.
- Pin-cite ranges including em-dash forms (`, 110-12`, `, 110–12`).
- Document-wide supra resolution using **first-seen** short name (matches
  `setdefault` semantics).
- **Short-form `X v. Y` references.** A case cited in full anywhere in the
  document is linked again wherever the document names both its parties, even
  with no reporter cite alongside — the form a table of authorities uses, and
  the form a brief falls into on second reference. Either party may be given
  short: `Four Star Electric` for `Four Star Electric, Inc.`, `Ford` for `Ford
  Motor Co.`, `Christensen, Miller` for the rest of the firm. The match is by
  whole words, so `Smith` never answers for `Smithson`.

  A party name is not only capitalized words. It carries the ampersand of a
  firm (`Careau & Co.`, `F & H Construction`, `Philipson & Simon`), the comma
  before a corporate designator (`PCO, Inc.`), and the lowercase connectors a
  caption keeps (`Committee on Children's Television`, `Regents of Univ. of
  California`) — each of which used to end the name early and cost the link.
  A connector the sentence supplied rather than the name (`Chillon v. Ford and
  the trial court agreed`) is left out of the link, and a word the sentence
  put in front of the name — a heading on the line above, most often `Cases`
  above the first entry of a table — is dropped rather than taken as part of
  the plaintiff. That last one was worth a whole entry: a name read one word
  too wide doesn't just come out wrong, it takes the citation inside it down
  with it.
- **Italicized short names.** Case names are italicized and nearly nothing
  else in a brief or an opinion is, so once a case has been cited in full, a
  later italic fragment of its name — `Market Lofts`, `Aguilar`, `In re
  Marriage of Davis` — gets the same link the full citation got. The fragment
  may be the plaintiff's first word, any leading run of the plaintiff's name,
  the whole case name, the short name a court announced in a parenthetical
  (`... 222 Cal.App.4th 924 (Market Lofts)`), the real party in interest a
  writ caption names (`Flynn` for `State of California v. Superior Court
  (Flynn)`, which also answers `Flynn, supra`), or the defendant where the
  plaintiff is an institution the short form is never built from (`People v.
  Smith` is `Smith`). Signals and pin cites caught inside the same italic run
  (`see Aguilar`, `Market Lofts, supra`) are stepped over, and the longest
  fragment that names a case wins, so the reader's whole phrase is underlined
  rather than its first word.

  The safety rule is the reader's own: a fragment links only when exactly one
  case cited **earlier** in the document answers to it. Where two do — `Smith`
  after both `Smith v. Jones` and `People v. Smith` — the bare word stays
  unlinked, though a longer fragment naming one of them still links.

  Posture comes from the PDF's own fonts in the viewer (`italic` on the font
  PDF.js resolved, or an italic face name like `TimesNewRomanPS-ItalicMT`) and
  from computed `font-style` in the web content script. Text with no font
  information behind it — plain strings, OCR'd scans — simply skips the pass.

  A caller that no longer holds the text the full cite appeared in can pass the
  cases it remembers as `findAllCitations(text, { priorCases })`. They join the
  registry as though cited before the first character, so an italicized short
  name still links after a chat app has unmounted the message carrying its full
  citation; they never become citations of their own, and the ambiguity rule
  holds across them.
- Span deduplication so overlapping detections don't double-link.
