#!/usr/bin/env bash
# fetch-pdfjs.sh — download the two PDF.js files the extension needs.
# For Windows, use fetch-pdfjs.py instead (or run this in WSL).

set -euo pipefail

VERSION="${PDFJS_VERSION:-4.6.82}"
CDN_BASE="https://cdn.jsdelivr.net/npm/pdfjs-dist@${VERSION}/build"
DEST="$(dirname "$0")/pdfjs/build"

mkdir -p "${DEST}"

echo "Downloading PDF.js v${VERSION} into ${DEST}..."
for f in pdf.mjs pdf.worker.mjs; do
  echo "  ${CDN_BASE}/${f}"
  curl -fsSL -o "${DEST}/${f}" "${CDN_BASE}/${f}"
done

# Sanity check
for f in pdf.mjs pdf.worker.mjs; do
  if [[ ! -f "${DEST}/${f}" ]]; then
    echo "ERROR: ${DEST}/${f} missing after download." >&2
    exit 1
  fi
done

echo
echo "Done. Load the extension in Chrome:"
echo "  1. chrome://extensions"
echo "  2. Toggle 'Developer mode' on"
echo "  3. Load unpacked -> select $(dirname "$(realpath "$0")")"
