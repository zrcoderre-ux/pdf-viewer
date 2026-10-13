// Reporters list, ported verbatim from pdf_linker.py REPORTERS_RAW.
// Sorted longest-first so the regex alternation prefers specific over generic.

export const REPORTERS_RAW = [
  // California
  "Cal.5th", "Cal. 5th", "Cal.4th", "Cal. 4th", "Cal.3d", "Cal. 3d",
  "Cal.2d", "Cal. 2d", "Cal.",
  "Cal.App.5th Supp.", "Cal. App. 5th Supp.",
  "Cal.App.4th Supp.", "Cal. App. 4th Supp.",
  "Cal.App.3d Supp.", "Cal. App. 3d Supp.",
  "Cal.App.2d Supp.", "Cal. App. 2d Supp.",
  "Cal.App.5th", "Cal. App. 5th", "Cal.App.4th", "Cal. App. 4th",
  "Cal.App.3d", "Cal. App. 3d", "Cal.App.2d", "Cal. App. 2d",
  "Cal.App.", "Cal. App.",
  "Cal.Rptr.3d", "Cal. Rptr. 3d", "Cal.Rptr.2d", "Cal. Rptr. 2d",
  "Cal.Rptr.", "Cal. Rptr.",
  // Federal
  "U.S.", "S.Ct.", "S. Ct.", "L.Ed.2d", "L. Ed. 2d", "L.Ed.", "L. Ed.",
  "F.4th", "F. 4th", "F.3d", "F. 3d", "F.2d", "F. 2d", "F.",
  "F.Supp.3d", "F. Supp. 3d", "F.Supp.2d", "F. Supp. 2d", "F.Supp.", "F. Supp.",
  // F. App'x (Federal Appendix) — both straight apostrophe and curly U+2019.
  // PDF text extraction commonly produces the curly form; accept either.
  "F. App'x", "F. App\u2019x", "F.App'x", "F.App\u2019x",
  // Common out-of-state
  "N.Y.2d", "N.Y. 2d", "N.Y.3d", "N.Y. 3d",
  "P.3d", "P. 3d", "P.2d", "P. 2d", "P.",
  "A.3d", "A. 3d", "A.2d", "A. 2d",
  "N.E.3d", "N.E. 3d", "N.E.2d", "N.E. 2d",
  "N.W.2d", "N.W. 2d",
  "S.E.2d", "S.E. 2d",
  "S.W.3d", "S.W. 3d", "S.W.2d", "S.W. 2d",
  "So.3d", "So. 3d", "So.2d", "So. 2d",
];

export const REPORTERS_SORTED = [...REPORTERS_RAW].sort(
  (a, b) => b.length - a.length
);

// …and the reporters PDF-Linker's list carries that the linker above does not
// read (compact Style Manual forms, bankruptcy and federal-claims reporters,
// Massachusetts): what a citation's SHAPE is read by (textdoc.citedNameSpans),
// so the reader spares every name PDF-Linker's guard does. Kept out of the
// linker's list, which builds a link from the reporter it reads.
export const REPORTERS_MORE = [
  "C5th", "C4th", "C3d", "C2d", "CA5th", "CA4th", "CA3d", "CA2d", "CR3d", "CR2d", "CR",
  "U. S.", "B.R.", "B. R.", "Fed. Cl.", "Fed.Cl.", "Vet. App.", "Vet.App.", "T.C.",
  "Fed. Appx.", "Fed. Appx", "Fed.Appx.",
  "Mass. App. Ct.", "Mass.App.Ct.", "Mass. App. Div.", "Mass.App.Div.",
  "Mass. L. Rptr.", "Mass.L.Rptr.", "Mass.",
];
export const REPORTERS_ALL_SORTED = [...REPORTERS_RAW, ...REPORTERS_MORE].sort(
  (a, b) => b.length - a.length
);
