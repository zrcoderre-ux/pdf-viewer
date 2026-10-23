"""What a PDF prints, word by word, for audit/layout-audit.mjs: read by PyMuPDF,
which shares nothing with the reader's own reading of the PDF (pdf.js), so the
audit's ground truth is not the reader grading itself.

    python3 audit/layout-truth.py FILE.pdf [FIRST LAST]

Writes JSON to stdout: { pages: [{ n, w, h, scan, words: [{ t, x0, top, x1,
bottom, size, bold, italic }] }] }, page numbers from 1, coordinates in PDF
points from the page's top left as the page is shown (its rotation applied).
`scan` is a page whose text is mostly invisible (an OCR layer over a picture)
or set in a font that names no face (Tesseract's GlyphLessFont): its sizes
and faces are an OCR's and are not graded.
"""
import json
import re
import sys

import pymupdf

FACE_BOLD = re.compile(r"bold|black|heavy|demi|semibold", re.I)
FACE_ITALIC = re.compile(r"italic|oblique|-it$|,it$|-ital", re.I)
# Monotype's short forms ("TimesNewRomanBdMS", "TimesNewRomanItMS"): a font
# not embedded is drawn by MuPDF in a stand-in whose flags say nothing.
SHORT_BOLD = re.compile(r"[a-z]Bd(?:It)?(?:MS|MT|PS)?$")
SHORT_ITALIC = re.compile(r"(?:[a-z]|Bd)It(?:MS|MT|PS)?$")
NO_FACE = re.compile(r"glyphless|^t3font|^type3", re.I)


def words_of(page):
    out = []
    rot = page.rotation_matrix
    raw = page.get_text("rawdict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE)
    for block in raw.get("blocks", []):
        for line in block.get("lines", []):
            # Only text running left to right across the page.
            d = pymupdf.Point(line.get("dir", (1, 0))) * pymupdf.Matrix(rot.a, rot.b, rot.c, rot.d, 0, 0)
            if abs(d.y) > 0.1 or d.x <= 0:
                continue
            for span in line.get("spans", []):
                font = re.sub(r"^[A-Z]{6}\+", "", span.get("font", ""))
                flags = span.get("flags", 0)
                bold = bool(flags & 16) or bool(FACE_BOLD.search(font)) or bool(SHORT_BOLD.search(font))
                italic = bool(flags & 2) or bool(FACE_ITALIC.search(font)) or bool(SHORT_ITALIC.search(font))
                size = span.get("size", 0)
                word, box = "", None
                for ch in span.get("chars", []) + [None]:
                    c = ch["c"] if ch else " "
                    if c.isspace():
                        if word.strip():
                            out.append({"t": word, "x0": box[0], "top": box[1], "x1": box[2], "bottom": box[3],
                                        "size": round(size, 2), "bold": bold, "italic": italic, "font": font})
                        word, box = "", None
                        continue
                    # (In the page as shown: text is read in the page's own,
                    # unrotated frame, and a /Rotate turns it.)
                    r = pymupdf.Rect(ch["bbox"]) * rot
                    b = (r.x0, r.y0, r.x1, r.y1)
                    word += c
                    box = list(b) if box is None else [min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3])]
    return out


def is_scan(page, words):
    if not words:
        return False
    fonts = sum(len(w["t"]) for w in words if NO_FACE.search(w["font"]))
    chars = sum(len(w["t"]) for w in words) or 1
    if fonts >= 0.8 * chars:
        return True
    try:
        trace = page.get_texttrace()
    except Exception:
        return False
    hidden = sum(len(s.get("chars", ())) for s in trace if s.get("type") == 3 or s.get("opacity", 1) == 0)
    total = sum(len(s.get("chars", ())) for s in trace) or 1
    return hidden >= 0.8 * total


def main():
    path = sys.argv[1]
    doc = pymupdf.open(path)
    first = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    last = int(sys.argv[3]) if len(sys.argv) > 3 else doc.page_count
    pages = []
    for n in range(max(1, first), min(doc.page_count, last) + 1):
        page = doc[n - 1]
        words = words_of(page)
        r = page.rect
        pages.append({"n": n, "w": r.width, "h": r.height, "scan": is_scan(page, words),
                      "words": [{k: v for k, v in w.items() if k != "font"} for w in words]})
    json.dump({"count": doc.page_count, "pages": pages}, sys.stdout)


if __name__ == "__main__":
    main()
