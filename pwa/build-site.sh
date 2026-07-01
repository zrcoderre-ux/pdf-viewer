#!/usr/bin/env bash
# Assemble the deployable PWA site into a single directory.
#
# The site is the PWA shell (this pwa/ folder) plus the CANONICAL viewer and
# PDF.js from the repo root — copied in, not duplicated in git. Run locally to
# preview, and by the GitHub Pages workflow to deploy.
#
#   pwa/build-site.sh [output-dir]   (default: repo-root/_site)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
out="${1:-$root/_site}"

rm -rf "$out"
mkdir -p "$out"

# PWA shell (skip dev-only files: build script, icon generator, README).
for f in index.html manifest.webmanifest sw.js app-web.js app-web.css; do
  cp "$here/$f" "$out/$f"
done
cp -r "$here/icons" "$out/icons"

# Canonical viewer + PDF.js (single source of truth lives at the repo root).
cp -r "$root/viewer" "$out/viewer"
cp -r "$root/pdfjs" "$out/pdfjs"

echo "Assembled site -> $out"
