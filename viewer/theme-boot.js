// theme-boot.js
//
// The saved theme, applied before first paint so light mode doesn't flash
// dark while the page loads. Loaded by both the PDF viewer and the text
// reader, and a FILE rather than an inline <script> because the extension's
// content security policy is script-src 'self': an inline script is refused
// outright, which left every extension page opening dark and then correcting
// itself. viewer.js and text-reader.js keep this key in step with the toggle.
try {
  if (localStorage.getItem("pdfViewerTheme") === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  }
} catch (e) { /* storage blocked — the dark default stands */ }
