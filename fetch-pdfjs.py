"""
fetch-pdfjs.py — download the two PDF.js files the extension needs.

Run once before loading the extension:
    python fetch-pdfjs.py

Works on Windows, macOS, and Linux. Only requires Python 3.6+ (which you
already have for pdf_linker.py).

What this does:
  Downloads pdf.mjs and pdf.worker.mjs from the jsdelivr CDN (which mirrors
  the official pdfjs-dist npm package) into ./pdfjs/build/. That's all the
  extension needs — no zip, no extra files.
"""

import os
import shutil
import sys
import urllib.request
from pathlib import Path

# Pin a known-working version. To upgrade, change this and re-run.
# Latest is at https://www.npmjs.com/package/pdfjs-dist
VERSION = os.environ.get("PDFJS_VERSION", "4.6.82")

CDN_BASE = f"https://cdn.jsdelivr.net/npm/pdfjs-dist@{VERSION}/build"
FILES = ["pdf.mjs", "pdf.worker.mjs"]

SCRIPT_DIR = Path(__file__).resolve().parent
DEST = SCRIPT_DIR / "pdfjs" / "build"


def download(url: str, dest: Path) -> None:
    print(f"  {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "fetch-pdfjs"})
    with urllib.request.urlopen(req) as response, open(dest, "wb") as out:
        shutil.copyfileobj(response, out)


def main() -> int:
    print(f"Downloading PDF.js v{VERSION} into {DEST}...")
    DEST.mkdir(parents=True, exist_ok=True)

    for filename in FILES:
        url = f"{CDN_BASE}/{filename}"
        dest = DEST / filename
        try:
            download(url, dest)
        except Exception as e:
            print(f"\nERROR downloading {filename}: {e}", file=sys.stderr)
            print(
                "\nIf this is a network issue, try again. If the version is "
                "no longer on the CDN, set PDFJS_VERSION to a current one:\n"
                "  Windows:  set PDFJS_VERSION=5.7.284 && python fetch-pdfjs.py\n"
                "  macOS:    PDFJS_VERSION=5.7.284 python3 fetch-pdfjs.py",
                file=sys.stderr,
            )
            return 1

    # Sanity check.
    for filename in FILES:
        if not (DEST / filename).is_file():
            print(f"ERROR: {DEST / filename} missing after download.", file=sys.stderr)
            return 1

    print("\nDone. Next steps:")
    print("  1. Open chrome://extensions in Chrome")
    print("  2. Toggle 'Developer mode' on (top right)")
    print("  3. Click 'Load unpacked' and select this folder:")
    print(f"     {SCRIPT_DIR}")
    print("  4. Click 'Details' on the extension and enable 'Allow access to")
    print("     file URLs' if you want to open local PDFs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
