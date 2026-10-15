// Node-runnable tests for reading a PDF off a link that serves a web page
// (viewer/web-pdf.js): the header check pdf.js applies, the file's path read
// off SharePoint's link shapes, the download addresses tried, and the order
// fetchPdf tries them in.
//
// Run: node test-web-pdf.mjs

import { looksLikePdf, isSharePointHost, sharePointFilePath, sharePointDownloadUrls, fetchPdf } from "./viewer/web-pdf.js";

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

const bytes = (s) => new TextEncoder().encode(s);
const T = "https://contoso.sharepoint.com";

console.log("looksLikePdf");
check("a PDF header", looksLikePdf(bytes("%PDF-1.7\n...")), true);
check("a header after leading junk, within 1024 bytes", looksLikePdf(bytes(" ".repeat(900) + "%PDF-1.4")), true);
check("a header past 1024 bytes", looksLikePdf(bytes(" ".repeat(1100) + "%PDF-1.4")), false);
check("an HTML page", looksLikePdf(bytes("<!DOCTYPE html><html>")), false);
check("an empty body", looksLikePdf(new ArrayBuffer(0)), false);

console.log("isSharePointHost");
check("tenant", isSharePointHost(T + "/x.pdf"), true);
check("OneDrive for work", isSharePointHost("https://contoso-my.sharepoint.com/x.pdf"), true);
check("a look-alike", isSharePointHost("https://sharepoint.com.example.org/x.pdf"), false);
check("a court site", isSharePointHost("https://civil.example.gov/x.pdf"), false);

console.log("sharePointFilePath");
check("Copy link (/:b:/r/)", sharePointFilePath(T + "/:b:/r/sites/Lit/Shared%20Documents/Opp%20Brief.pdf?csf=1&web=1&e=Ab12Cd"), "/sites/Lit/Shared Documents/Opp Brief.pdf");
check("direct path with ?web=1", sharePointFilePath(T + "/sites/Lit/Shared%20Documents/Motion.pdf?web=1"), "/sites/Lit/Shared Documents/Motion.pdf");
check("library viewer ?id=", sharePointFilePath(T + "/sites/Lit/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2FLit%2FShared%20Documents%2FMotion.pdf"), "/sites/Lit/Shared Documents/Motion.pdf");
check("opaque sharing token", sharePointFilePath(T + "/:b:/s/Lit/EaBcDeFg?e=xyz"), "");
check("not a PDF", sharePointFilePath(T + "/sites/Lit/Shared%20Documents/Notes.docx"), "");

console.log("sharePointDownloadUrls");
check("Copy link: the site's download page, then the link asked to download",
  sharePointDownloadUrls(T + "/:b:/r/sites/Lit/Shared%20Documents/Motion.pdf?csf=1&web=1&e=Ab12"),
  [T + "/sites/Lit/_layouts/15/download.aspx?SourceUrl=%2Fsites%2FLit%2FShared%20Documents%2FMotion.pdf",
   T + "/:b:/r/sites/Lit/Shared%20Documents/Motion.pdf?csf=1&e=Ab12&download=1"]);
check("OneDrive personal site",
  sharePointDownloadUrls("https://contoso-my.sharepoint.com/personal/dana_contoso_com/Documents/Order.pdf")[0],
  "https://contoso-my.sharepoint.com/personal/dana_contoso_com/_layouts/15/download.aspx?SourceUrl=%2Fpersonal%2Fdana_contoso_com%2FDocuments%2FOrder.pdf");
check("sharing token: only the download form",
  sharePointDownloadUrls(T + "/:b:/s/Lit/EaBcDeFg?e=xyz"), [T + "/:b:/s/Lit/EaBcDeFg?e=xyz&download=1"]);

console.log("fetchPdf");
function server(routes) {
  const asked = [];
  const fetchFn = async (url, opts) => {
    asked.push(url);
    if (!opts || opts.credentials !== "include") throw new Error("cookies not sent");
    const r = routes(url);
    if (!r) return { ok: false, status: 404, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) };
    const headers = new Map(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { ok: true, status: 200, headers: { get: (k) => headers.get(k.toLowerCase()) || null }, arrayBuffer: async () => bytes(r.body).buffer };
  };
  return { fetchFn, asked };
}
{
  const s = server(() => ({ body: "%PDF-1.7 plain" }));
  const got = await fetchPdf("https://court.example.gov/doc.pdf", s.fetchFn);
  check("a PDF link: one fetch, the bytes", [got.notPdf || false, s.asked.length], [false, 1]);
}
{
  const link = T + "/:b:/r/sites/Lit/Shared%20Documents/Motion.pdf?csf=1&web=1&e=Ab12";
  const s = server((u) => u.includes("download.aspx") ? { body: "%PDF-1.7 file", headers: { "Content-Disposition": 'attachment; filename="Motion.pdf"' } }
    : { body: "<html>SharePoint viewer</html>", headers: { "Content-Type": "text/html", SPRequestGuid: "x" } });
  const got = await fetchPdf(link, s.fetchFn);
  check("SharePoint viewer page: the file read through download.aspx",
    [got.notPdf || false, s.asked.length, got.resp.headers.get("Content-Disposition")], [false, 2, 'attachment; filename="Motion.pdf"']);
}
{
  const s = server((u) => u.endsWith("download=1") ? { body: "%PDF-1.5" } : u.includes("download.aspx") ? null : { body: "<html>", headers: { MicrosoftSharePointTeamServices: "16.0" } });
  const got = await fetchPdf("https://dms.example.org/sites/Lit/Docs/Order.pdf?web=1", s.fetchFn);
  check("on-premises farm (known by its header): falls through to ?download=1", [got.notPdf || false, s.asked.length], [false, 3]);
}
{
  const s = server(() => ({ body: "<html>Sign in</html>", headers: { "Content-Type": "text/html; charset=utf-8" } }));
  const got = await fetchPdf(T + "/sites/Lit/Shared%20Documents/Motion.pdf", s.fetchFn);
  check("still a page after every try: notPdf, the first answer kept",
    [got.notPdf, got.resp.headers.get("Content-Type"), s.asked[0]], [true, "text/html; charset=utf-8", T + "/sites/Lit/Shared%20Documents/Motion.pdf"]);
}
{
  const s = server(() => ({ body: "<html>", headers: { "Content-Type": "text/html" } }));
  const got = await fetchPdf("https://other.example.com/a.pdf", s.fetchFn);
  check("a page off another site: no SharePoint tries", [got.notPdf, s.asked.length], [true, 1]);
}

console.log(fails ? `\n${fails} failure(s)` : "\nAll passed");
process.exit(fails ? 1 : 0);
