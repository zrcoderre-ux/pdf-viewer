// Background service worker
//
// Uses declarativeNetRequest dynamic rules to redirect PDF URLs to the
// bundled PDF.js viewer. DNR rules are evaluated by Chrome's network stack
// itself, so the redirect fires even when the service worker is asleep —
// unlike webNavigation listeners, which require the worker to be awake.
//
// Two redirect rules:
//   1. Any URL whose path ends in .pdf (with optional query string).
//   2. Any URL matching a built-in or user-added pattern (eCMS etc.).

const VIEWER_URL = chrome.runtime.getURL("viewer/viewer.html");

// Optional routing: when the user turns on "Open web PDFs in the app", web PDF
// navigations are redirected to the installed PWA instead of this extension's
// bundled viewer. Off by default — the extension viewer stays the default
// because it can fetch cookie-gated / cross-origin PDFs that a hosted page
// can't. See the Options page.
const DEFAULT_APP_URL = "https://zrcoderre-ux.github.io/pdf-viewer/";

function getRoutingPrefs() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { routeToApp: false, appUrl: DEFAULT_APP_URL },
      ({ routeToApp, appUrl }) => {
        const url = (typeof appUrl === "string" && appUrl.trim()) || DEFAULT_APP_URL;
        resolve({ routeToApp: !!routeToApp, appUrl: url });
      }
    );
  });
}

// The redirect target base — the extension viewer, or the app when routing is
// on. The original PDF URL is appended as ?file=<url> by the rules below.
function redirectBase({ routeToApp, appUrl }) {
  if (!routeToApp) return VIEWER_URL;
  // Point at the app shell; it reads ?file= and opens the PDF in a new tab.
  return appUrl.replace(/[?#].*$/, "");
}

// Bypass token — when this query param is present in a URL, an allow rule
// (priority 100) overrides redirect rules (priority 1) and the navigation
// goes through to Chrome's built-in viewer. "Open original" in the viewer
// appends this token to the URL.
const BYPASS_TOKEN = "citationlinker=skip";

// Built-in patterns for document-management endpoints that serve PDFs without
// a .pdf in the URL. The user can add more in the Options page.
const BUILTIN_PATTERNS = [
  // LA Superior Court eCMS document viewer
  "https://civil.lacourt.org/ecourt/ecms/doc*",
];

// DNR rule IDs we own. We always rewrite all of them on update.
const RULE_ID_BYPASS           = 1;
const RULE_ID_PDF_SUFFIX       = 2;
const RULE_ID_ECMS_IMAGE_ALLOW = 3; // see buildEcmsImageAllowRule below
const RULE_ID_PATTERN_BASE     = 100; // built-in + user patterns occupy 100..N

function buildBypassRule() {
  return {
    id: RULE_ID_BYPASS,
    priority: 100, // Higher than redirect rules (priority 1) — wins
    action: { type: "allow" },
    condition: {
      regexFilter: BYPASS_TOKEN,
      resourceTypes: ["main_frame", "sub_frame"],
    },
  };
}

// LA Superior Court eCMS exposes two URL shapes under /ecms/:
//   - ecms/document?docId=...           — direct PDF stream (we WANT to redirect to our viewer)
//   - ecms/document/image?docId=...     — HTML viewer wrapper (we do NOT want to touch)
//
// The built-in glob "https://civil.lacourt.org/ecourt/ecms/doc*" matches
// both. To leave the in-portal HTML viewer alone, we add an allow rule at
// the same priority as the bypass (100) so it beats the priority-1
// redirect rules and the request goes through unmodified.
function buildEcmsImageAllowRule() {
  return {
    id: RULE_ID_ECMS_IMAGE_ALLOW,
    priority: 100,
    action: { type: "allow" },
    condition: {
      regexFilter: "^https?://civil\\.lacourt\\.org/ecourt/ecms/document/image\\b",
      resourceTypes: ["main_frame", "sub_frame"],
    },
  };
}

function buildPdfSuffixRule(base) {
  return {
    id: RULE_ID_PDF_SUFFIX,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        regexSubstitution: base + "?file=\\0",
      },
    },
    condition: {
      // Match http(s)://...path.pdf with optional query
      regexFilter: "^https?://.*\\.pdf(\\?.*)?$",
      resourceTypes: ["main_frame", "sub_frame"],
      // Don't redirect requests our viewer makes for the PDF itself.
      excludedInitiatorDomains: [chrome.runtime.id],
    },
  };
}

// declarativeNetRequest rules only fire for network requests; file:// URLs
// bypass the network stack entirely, so DNR never sees them. Instead we use
// webNavigation.onBeforeNavigate to catch file:// PDF navigations and
// immediately redirect the tab to our viewer. Requires "Allow access to file
// URLs" to be toggled on in chrome://extensions → PDF Viewer → Details.
chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    // Only intercept top-level navigations; ignore our viewer's own fetches.
    if (details.frameId !== 0) return;
    const url = details.url;
    if (!/^file:\/\/.*\.pdf$/i.test(url)) return;
    if (url.includes(BYPASS_TOKEN)) return;

    const viewerUrl = VIEWER_URL + "?file=" + encodeURIComponent(url);
    chrome.tabs.update(details.tabId, { url: viewerUrl });
  },
  { url: [{ schemes: ["file"] }] }
);

// Convert a glob like "https://example.com/path/*?id=*" to a DNR
// urlFilter substring rule. DNR's urlFilter has its own simple syntax:
//   * = wildcard, | = anchor, no escaping. Pipe-prefixed patterns anchor
// at the start. This matches what the user typed in the Options textarea.
function buildPatternRule(id, urlFilter, base) {
  return {
    id,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        // Use regexSubstitution \\0 to embed the ORIGINAL url in the
        // viewer URL. Note we need a regex match for \\0 to work, so we
        // also set regexFilter from the urlFilter glob.
        regexSubstitution: base + "?file=\\0",
      },
    },
    condition: {
      // Convert simple urlFilter-style glob to a regex.
      regexFilter: globToRegex(urlFilter),
      resourceTypes: ["main_frame", "sub_frame"],
      excludedInitiatorDomains: [chrome.runtime.id],
    },
  };
}

// Convert "https://civil.lacourt.org/ecourt/ecms/doc*" -> a regex that
// matches the entire URL. DNR's regexSubstitution \0 only contains the
// matched portion, so the regex MUST cover the whole URL or the redirect
// target loses everything after the match. We anchor with ^ and append
// .* before the end so the match always reaches the URL's end.
//
// Special syntax in the input glob:
//   *    matches any chars (including / and ?)
//   |    at the start, anchors to URL start (this was DNR convention; we
//        always anchor at start anyway, so it's accepted but ignored)
function globToRegex(glob) {
  let g = glob;
  if (g.startsWith("|")) g = g.slice(1);

  // Escape regex metachars except *
  const escaped = g.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  let pattern = escaped.replace(/\*/g, ".*");

  // Always anchor start; ensure the regex covers the entire URL by
  // appending .* if it doesn't already end with a wildcard.
  if (!pattern.startsWith("^")) pattern = "^" + pattern;
  if (!pattern.endsWith(".*") && !pattern.endsWith("$")) pattern += ".*";

  return pattern;
}

async function rebuildRules() {
  const userPatterns = await getUserPatterns();
  const allPatterns = [...BUILTIN_PATTERNS, ...userPatterns];
  const base = redirectBase(await getRoutingPrefs());

  const newRules = [
    buildBypassRule(),
    buildEcmsImageAllowRule(),
    buildPdfSuffixRule(base),
  ];
  allPatterns.forEach((p, i) => {
    try {
      newRules.push(buildPatternRule(RULE_ID_PATTERN_BASE + i, p, base));
    } catch (e) {
      console.warn(`[Citation Linker] Skipping bad pattern ${JSON.stringify(p)}: ${e.message}`);
    }
  });

  // Find existing rule IDs we own so we can remove them.
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = existing
    .filter((r) =>
      r.id === RULE_ID_BYPASS ||
      r.id === RULE_ID_PDF_SUFFIX ||
      r.id === RULE_ID_ECMS_IMAGE_ALLOW ||
      (r.id >= RULE_ID_PATTERN_BASE && r.id < RULE_ID_PATTERN_BASE + 1000)
    )
    .map((r) => r.id);

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: removeIds,
      addRules: newRules,
    });
    console.log(
      `[Citation Linker] Active redirect rules: 1 .pdf-suffix + ${allPatterns.length} pattern(s) (+ 2 allow).`
    );
  } catch (e) {
    console.error("[Citation Linker] Failed to install DNR rules:", e);
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: removeIds,
        addRules: [buildBypassRule(), buildEcmsImageAllowRule(), buildPdfSuffixRule(base)],
      });
      console.warn("[Citation Linker] Retried with .pdf-suffix rule only.");
    } catch (e2) {
      console.error("[Citation Linker] Even base rule failed:", e2);
    }
  }
}

function getUserPatterns() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ pdfUrlPatterns: [] }, ({ pdfUrlPatterns }) => {
      const arr = Array.isArray(pdfUrlPatterns) ? pdfUrlPatterns : [];
      resolve(arr.filter((s) => typeof s === "string" && s.trim().length > 0));
    });
  });
}

// Broker for the hosted app: fetch a PDF with the user's cookies + host
// permissions (bypassing CORS) and return the bytes. Requested by the app's
// content-script bridge (content/app-bridge.js). Only used when the user turns
// on "Open web PDFs in the app"; harmless otherwise.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "fetchPdf" || typeof msg.url !== "string") return;
  (async () => {
    try {
      const resp = await fetch(msg.url, { credentials: "include" });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const buf = await resp.arrayBuffer();
      sendResponse({
        ok: true,
        b64: arrayBufferToBase64(buf),
        filename: filenameFromContentDisposition(resp.headers.get("Content-Disposition")),
      });
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true; // keep the message channel open for the async sendResponse
});

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000; // build the binary string in chunks to avoid arg limits
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Minimal Content-Disposition filename parser (RFC 5987 filename*=UTF-8''… and
// the legacy filename="…" form). Returns null if nothing usable is found.
function filenameFromContentDisposition(cd) {
  if (!cd) return null;
  let m = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
  if (m) { try { return decodeURIComponent(m[1].trim()); } catch { return m[1].trim(); } }
  m = /filename\s*=\s*"([^"]+)"/i.exec(cd) || /filename\s*=\s*([^;]+)/i.exec(cd);
  return m ? m[1].trim() : null;
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("Legal Citation Linker installed.");
  rebuildRules();
});

chrome.runtime.onStartup.addListener(() => {
  rebuildRules();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.pdfUrlPatterns || changes.routeToApp || changes.appUrl) {
    rebuildRules();
  }
});
