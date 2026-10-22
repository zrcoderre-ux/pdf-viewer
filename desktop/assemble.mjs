// Gather what PDF+ serves into desktop/app/: the PWA's shell and the
// canonical viewer and PDF.js, copied from the repo root as pwa/build-site.sh
// copies them for GitHub Pages — not kept twice in git. Run before starting
// or packaging the app (npm start and npm run dist do).
//
//   node desktop/assemble.mjs
//
// Left out: the service worker (PDF+ has nothing to fetch and nothing to
// update in place) and the PWA's build and icon scripts.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const out = path.join(here, "app");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const f of ["index.html", "manifest.webmanifest", "app-web.js", "app-web.css"]) {
  fs.copyFileSync(path.join(root, "pwa", f), path.join(out, f));
}
fs.cpSync(path.join(root, "pwa", "icons"), path.join(out, "icons"), { recursive: true });
fs.cpSync(path.join(root, "viewer"), path.join(out, "viewer"), { recursive: true });
fs.cpSync(path.join(root, "pdfjs"), path.join(out, "pdfjs"), { recursive: true });
// viewer.html loads this from the site root (which sites get citation links).
fs.copyFileSync(path.join(root, "citation-site-rules.js"), path.join(out, "citation-site-rules.js"));

console.log(`Assembled PDF+ -> ${out}`);
