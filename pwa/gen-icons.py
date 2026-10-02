#!/usr/bin/env python3
"""Generate flat PWA icons with no external libraries.

Draws a simple "document" glyph (white sheet with a cut top-right corner and a
red PDF band) on a dark slate background. Pure-Python PNG encoder — solid
colors only, no text rendering; edges are smoothed by sampling each pixel on a
grid.

Two layouts:
  icon-192.png, icon-512.png   the sheet fills the square, leaving a narrow
                               slate border ("any" purpose: desktop, taskbar,
                               the file icon set by windows-file-icon.ps1).
  icon-maskable-512.png        the sheet kept inside the inner 80% safe zone,
                               so a platform that crops icons to a circle or
                               squircle does not cut the sheet off.

After changing the drawing, bump the ?v= on the icon URLs in
manifest.webmanifest, index.html and sw.js: Chrome keeps an installed app's
icon until the manifest's icon URLs change.
"""
import struct
import zlib

BG = (30, 41, 59)        # slate-800
SHEET = (248, 250, 252)  # near-white
BAND = (220, 38, 38)     # red-600 (the "PDF" band)

SAMPLES = 4  # per axis: 16 samples per pixel

# Sheet box as fractions of the icon: (left, top, right, bottom).
FULL = (0.06, 0.06, 0.94, 0.94)          # narrow border
SAFE = (0.24, 0.216, 0.76, 0.784)        # inside the maskable safe zone


def color_at(x, y, box):
    left, top, right, bottom = box
    if not (left <= x <= right and top <= y <= bottom):
        return BG
    w, h = right - left, bottom - top
    # Top-right corner cut away along a 45-degree line.
    fold = w * 0.32
    if (x - (right - fold)) > (y - top):
        return BG
    # Red PDF band across the lower part of the sheet.
    band_top = top + h * 0.58
    if band_top <= y <= band_top + h * 0.20 and left + w * 0.08 <= x <= right - w * 0.08:
        return BAND
    return SHEET


def render(size, box):
    px_box = tuple(v * size for v in box)
    n = SAMPLES * SAMPLES
    rows = []
    for py in range(size):
        row = []
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(SAMPLES):
                for sx in range(SAMPLES):
                    c = color_at(px + (sx + 0.5) / SAMPLES, py + (sy + 0.5) / SAMPLES, px_box)
                    acc[0] += c[0]
                    acc[1] += c[1]
                    acc[2] += c[2]
            row.append(tuple(round(v / n) for v in acc))
        rows.append(row)
    return rows


def write_png(path, px):
    size = len(px)
    raw = bytearray()
    for row in px:
        raw.append(0)  # filter type 0
        for (r, g, b) in row:
            raw += bytes((r, g, b))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


for name, size, box in (
    ("icon-192.png", 192, FULL),
    ("icon-512.png", 512, FULL),
    ("icon-maskable-512.png", 512, SAFE),
):
    write_png(f"icons/{name}", render(size, box))
    print(f"wrote icons/{name}")
