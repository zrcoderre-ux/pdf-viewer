#!/usr/bin/env python3
"""Generate flat PWA icons with no external libraries.

Draws a simple "document" glyph: a white page with a cut top-right corner and
a red PDF band. Pure-Python PNG encoder — solid colors only, no text
rendering; edges are smoothed by sampling each pixel on a grid.

Two layouts:
  icon-192.png, icon-512.png   the page alone, a letter sheet's proportions
                               (8.5 by 11) and nearly the icon's height, in a
                               thin dark outline, transparent around it — so
                               the icon IS the page, and the outline keeps it
                               visible against white ("any" purpose: desktop,
                               taskbar, the file icon set by
                               windows-file-icon.ps1).
  icon-maskable-512.png        the page inside the inner 80% safe zone on a
                               dark slate ground, so a platform that crops
                               icons to a circle or squircle does not cut the
                               page off (a maskable icon fills its square).

After changing the drawing, bump the ?v= on the icon URLs in
manifest.webmanifest, index.html and sw.js, and on the manifest's own URL in
index.html and sw.js: Chrome keeps an installed app's icon until the
manifest's icon URLs change, and a manifest at a new URL is never one a
browser kept from before.
"""
import math
import struct
import zlib

BG = (30, 41, 59)        # slate-800: the maskable icon's ground, and the outline
SHEET = (248, 250, 252)  # near-white
BAND = (220, 38, 38)     # red-600 (the "PDF" band)

SAMPLES = 4  # per axis: 16 samples per pixel

# The page as fractions of the icon: (left, top, right, bottom).
PAGE_H = 0.96                       # a sliver above and below, so the outline is whole
PAGE_W = PAGE_H * 8.5 / 11          # a letter sheet's proportions
FULL = ((1 - PAGE_W) / 2, (1 - PAGE_H) / 2, (1 + PAGE_W) / 2, (1 + PAGE_H) / 2)
LINE = 0.03                         # the outline, as a fraction of the icon
SAFE = (0.24, 0.216, 0.76, 0.784)   # inside the maskable safe zone


def color_at(x, y, box, line, ground):
    """The page's color at (x, y), or `ground` (None: transparent) off it."""
    left, top, right, bottom = box
    w, h = right - left, bottom - top
    cut = w * 0.32  # the top-right corner, cut away along a 45-degree line

    def inside(d):  # on the page, at least d in from every edge of it
        return (left + d <= x <= right - d and top + d <= y <= bottom - d
                and x - y <= right - cut - top - d * math.sqrt(2))

    if not inside(0):
        return ground
    if line and not inside(line):
        return BG
    # Red PDF band across the lower part of the page.
    band_top = top + h * 0.58
    if band_top <= y <= band_top + h * 0.20 and left + w * 0.08 <= x <= right - w * 0.08:
        return BAND
    return SHEET


def render(size, box, line=0.0, ground=None):
    """Rows of (r, g, b, a) pixels."""
    px_box = tuple(v * size for v in box)
    px_line = line * size
    n = SAMPLES * SAMPLES
    rows = []
    for py in range(size):
        row = []
        for px in range(size):
            acc = [0, 0, 0]
            hit = 0
            for sy in range(SAMPLES):
                for sx in range(SAMPLES):
                    c = color_at(px + (sx + 0.5) / SAMPLES, py + (sy + 0.5) / SAMPLES, px_box, px_line, ground)
                    if c is None:
                        continue
                    acc[0] += c[0]
                    acc[1] += c[1]
                    acc[2] += c[2]
                    hit += 1
            if hit:
                row.append(tuple(round(v / hit) for v in acc) + (round(255 * hit / n),))
            else:
                row.append((0, 0, 0, 0))
        rows.append(row)
    return rows


def write_png(path, px):
    """An RGBA PNG of `px`, rows of (r, g, b, a)."""
    height, width = len(px), len(px[0])
    raw = bytearray()
    for row in px:
        raw.append(0)  # filter type 0
        for p in row:
            raw += bytes(p)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


if __name__ == "__main__":
    for name, size, box, line, ground in (
        ("icon-192.png", 192, FULL, LINE, None),
        ("icon-512.png", 512, FULL, LINE, None),
        ("icon-maskable-512.png", 512, SAFE, 0.0, BG),
    ):
        write_png(f"icons/{name}", render(size, box, line, ground))
        print(f"wrote icons/{name}")
