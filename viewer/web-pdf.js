// Reading a PDF off the web when the link does not serve the PDF itself.
//
// The viewer fetches a link's bytes rather than navigating to it, and some
// links ending in ".pdf" answer a fetch with a web page. SharePoint and
// OneDrive are the common case: a "Copy link" address
// (".../:b:/r/sites/X/Shared Documents/Motion.pdf?csf=1&web=1&e=Ab12") and a
// "?web=1" address both serve SharePoint's own viewer page, which the browser
// shows as the PDF but which pdf.js reads as "Invalid PDF structure". So the
// bytes are checked before pdf.js gets them, a SharePoint page is asked for
// the file through its download endpoints, and a page that still is not a PDF
// is reported as such (the caller then opens the link the way the site serves
// it).
//
// Pure apart from the fetch it is handed; tests in test-web-pdf.mjs.

// pdf.js finds the "%PDF-" header anywhere in the first 1024 bytes, so this
// accepts exactly what it would.
export function looksLikePdf(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const end = Math.min(b.length, 1024) - 5;
  for (let i = 0; i <= end; i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) return true;
  }
  return false;
}

// SharePoint Online and OneDrive for work hosts. An on-premises farm has a
// host of its own, and is known instead by the header every SharePoint
// response carries (isSharePointResponse).
export function isSharePointHost(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return false; }
  return /(^|\.)sharepoint(-df)?\.(com|us|cn|de)$/.test(host) || /(^|\.)sharepoint-mil\.us$/.test(host);
}

export function isSharePointResponse(resp) {
  const h = resp && resp.headers;
  if (!h || typeof h.get !== "function") return false;
  return !!(h.get("MicrosoftSharePointTeamServices") || h.get("SPRequestGuid"));
}

// The file's server-relative path ("/sites/X/Shared Documents/Motion.pdf"),
// read off the shapes of link SharePoint hands out, or "" when the link names
// no path (an opaque sharing token: ".../:b:/s/X/EaBc...").
export function sharePointFilePath(url) {
  let u;
  try { u = new URL(url); } catch (e) { return ""; }
  const isPdf = (p) => /\.pdf$/i.test(p);
  // The library's own viewer and the download page name the file in a query
  // parameter ("AllItems.aspx?id=...", "download.aspx?SourceUrl=...").
  for (const [k, v] of u.searchParams) {
    if (/^(id|sourceurl)$/i.test(k) && v) {
      let p = v;
      if (/^https?:/i.test(p)) { try { p = new URL(p).pathname; p = decodeURIComponent(p); } catch (e) { continue; } }
      if (p.startsWith("/") && isPdf(p)) return p;
    }
  }
  let path;
  try { path = decodeURIComponent(u.pathname); } catch (e) { return ""; }
  // A "Copy link" address: "/:b:/r/" (a letter for the file type, r for a
  // path that follows) in front of the file's own path.
  path = path.replace(/^\/:[a-z]:\/r\//i, "/");
  if (/^\/:[a-z]:\//i.test(path)) return "";
  return isPdf(path) ? path : "";
}

// The addresses that hand back the file's bytes, best first: the site's
// download page for the file's path, then the link itself asked to download
// rather than view (which a sharing token answers too).
export function sharePointDownloadUrls(url) {
  let u;
  try { u = new URL(url); } catch (e) { return []; }
  const out = [];
  const path = sharePointFilePath(url);
  if (path) {
    // The download page sits under the site the file is in; the tenant root's
    // answers for any site the reader can open.
    const site = /^(\/(?:sites|teams|personal)\/[^/]+)\//i.exec(path);
    out.push(u.origin + (site ? site[1] : "") + "/_layouts/15/download.aspx?SourceUrl=" + encodeURIComponent(path));
  }
  const dl = new URL(u.href);
  dl.searchParams.delete("web");
  dl.searchParams.set("download", "1");
  if (!out.includes(dl.href) && dl.href !== u.href) out.push(dl.href);
  return out;
}

// Fetches the link and answers { resp, buf } when what came back is a PDF.
// When it is not, answers { notPdf: true, resp, buf } for the first answer, so
// the caller can say what came back. `fetchFn` is the page's fetch.
export async function fetchPdf(url, fetchFn) {
  const get = async (u) => {
    const resp = await fetchFn(u, { credentials: "include" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return { resp, buf: await resp.arrayBuffer() };
  };
  const first = await get(url);
  if (looksLikePdf(first.buf)) return first;
  if (isSharePointHost(url) || isSharePointResponse(first.resp)) {
    for (const alt of sharePointDownloadUrls(url)) {
      let got;
      try { got = await get(alt); } catch (e) { continue; }
      if (looksLikePdf(got.buf)) return got;
    }
  }
  return { notPdf: true, ...first };
}
