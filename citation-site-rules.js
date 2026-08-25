// citation-site-rules.js
//
// Where citation links are allowed to appear on the web — the defaults, the
// input normalizer, and the matcher. Three surfaces need the same answers:
//
//   background.js            registers the content script on the right sites
//   options.html/options.js  seeds and saves the lists
//   content/*.js             refuses to run on an excepted site
//
// The content script for claude.ai is declared statically in manifest.json, so
// the background worker can't un-register it. That's why the matcher ships to
// the content script too: an exception has to be enforceable from the inside.
//
// Loaded by importScripts(), by <script src>, and as a content script, so it
// must stay a classic script — no imports, no exports, one global.

(function (root) {
  // Seeded into the exceptions box the first time the Options page is opened.
  // Westlaw and Lexis+ already link every citation on their own pages; our
  // overlay there would sit on top of theirs and steal the click.
  const DEFAULT_EXCEPTIONS = [
    "*.westlaw.com",
    "*.westlawnext.com",
    "*.lexis.com",
    "*.lexisnexis.com",
  ];

  // Match patterns for "every website". http and https only — the extension
  // has nothing to say about file:// or chrome:// pages.
  const ALL_SITES = ["http://*/*", "https://*/*"];

  // Normalize flexible user input into a Chrome match pattern:
  //   "example.com"          -> "https://example.com/*"
  //   "example.com/docs/*"   -> "https://example.com/docs/*"
  //   "*.example.com"        -> "https://*.example.com/*"
  //   "https://ex.com/*"     -> unchanged
  //
  // `defaultScheme` fills in when the line names none. Sites the user opts IN
  // to default to https; exceptions pass "*" so that excepting a site takes it
  // out over http as well — an exception the user has to write twice isn't one.
  function toMatchPattern(raw, defaultScheme) {
    let s = String(raw || "").trim();
    if (!s) return null;
    let scheme = defaultScheme || "https";
    const schemeMatch = /^(\*|https?):\/\//i.exec(s);
    if (schemeMatch) { scheme = schemeMatch[1].toLowerCase(); s = s.slice(schemeMatch[0].length); }
    const slash = s.indexOf("/");
    const host = slash === -1 ? s : s.slice(0, slash);
    let path = slash === -1 ? "/*" : s.slice(slash);
    if (path === "" || path === "/") path = "/*";
    // A Chrome match pattern path matches literally unless it contains "*". A
    // path with no wildcard (e.g. "/v2/") would match ONLY that exact URL —
    // which on a single-page app means basically nothing. Append "*" so it
    // prefix-matches everything under that path, which is what users expect.
    else if (!path.includes("*")) path += "*";
    if (!host) return null;
    return `${scheme}://${host}${path}`;
  }

  function isValidMatchPattern(p) {
    // scheme://host/path, host may be "*", "*.domain", or a plain host.
    return /^(\*|https?):\/\/(\*|(\*\.)?[^/*\s]+)\/[^\s]*$/.test(p);
  }

  // Raw lines -> deduplicated, valid match patterns.
  function toMatchPatterns(lines, defaultScheme) {
    const out = [];
    for (const raw of Array.isArray(lines) ? lines : []) {
      const pat = toMatchPattern(raw, defaultScheme);
      if (pat && isValidMatchPattern(pat) && !out.includes(pat)) out.push(pat);
    }
    return out;
  }

  function escapeRe(s) {
    return s.replace(/[.+^${}()|[\]\\*?]/g, "\\$&");
  }

  // Compile a match pattern into a RegExp over a full URL, following Chrome's
  // own semantics: "*" as the scheme means http or https, a "*." host prefix
  // covers the bare domain AND its subdomains, and "*" in a path matches any
  // run of characters.
  function patternToRegExp(pattern) {
    const m = /^(\*|https?):\/\/(\*|(?:\*\.)?[^/*\s]+)(\/[^\s]*)$/.exec(pattern);
    if (!m) return null;
    const [, scheme, host, path] = m;
    const schemeRe = scheme === "*" ? "https?" : scheme;
    let hostRe;
    if (host === "*") hostRe = "[^/]+";
    else if (host.startsWith("*.")) hostRe = `(?:[^/]+\\.)?${escapeRe(host.slice(2))}`;
    else hostRe = escapeRe(host);
    const pathRe = escapeRe(path).replace(/\\\*/g, ".*");
    return new RegExp(`^${schemeRe}://${hostRe}${pathRe}$`, "i");
  }

  // True when `url` is covered by any of the raw lines.
  function matchesAny(url, lines, defaultScheme) {
    for (const pattern of toMatchPatterns(lines, defaultScheme)) {
      const re = patternToRegExp(pattern);
      if (re && re.test(url)) return true;
    }
    return false;
  }

  // The exception list, in the two forms its two enforcement points need:
  // match patterns for the background registration's excludeMatches, and a
  // straight yes/no for the content script deciding whether to run at all.
  const exceptionPatterns = (lines) => toMatchPatterns(lines, "*");
  const isExcepted = (url, lines) => matchesAny(url, lines, "*");

  root.CitationSiteRules = {
    DEFAULT_EXCEPTIONS,
    ALL_SITES,
    toMatchPattern,
    isValidMatchPattern,
    toMatchPatterns,
    matchesAny,
    exceptionPatterns,
    isExcepted,
  };
})(typeof self !== "undefined" ? self : this);
