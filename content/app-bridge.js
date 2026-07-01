// Bridge between the hosted PDF Viewer app (PWA) and this extension.
//
// A hosted page at github.io can't fetch cookie-gated / cross-origin court
// PDFs — CORS blocks it and its cookies aren't sent. This extension can (it has
// host permissions and its service-worker fetch bypasses CORS). So when the app
// wants a PDF by URL, it asks this bridge, the bridge relays to the background
// worker, and the fetched bytes come back to the page. The app then renders
// them exactly like a locally-opened file.
//
// Injected only into the app's top document (all_frames defaults to false), so
// it never runs inside the per-tab viewer iframes.

(function () {
  const NS = "pdfviewer-ext";

  function toPage(payload) {
    window.postMessage({ ns: NS, dir: "toPage", ...payload }, location.origin);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.ns !== NS || msg.dir !== "toExt") return;

    if (msg.type === "ping") {
      toPage({ type: "ready" });
      return;
    }

    if (msg.type === "fetch") {
      chrome.runtime.sendMessage({ type: "fetchPdf", url: msg.url }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          toPage({
            type: "error",
            requestId: msg.requestId,
            error:
              (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
              (resp && resp.error) ||
              "extension fetch failed",
          });
          return;
        }
        toPage({ type: "bytes", requestId: msg.requestId, b64: resp.b64, filename: resp.filename });
      });
    }
  });

  // Announce availability now (page may not be listening yet) and again once the
  // DOM is ready (by which point the app's message listener is registered).
  toPage({ type: "ready" });
  document.addEventListener("DOMContentLoaded", () => toPage({ type: "ready" }));
})();
