#!/usr/bin/env python3
"""Generate flat PWA icons with no external libraries.

Draws a simple "document" glyph (white sheet with a folded corner and a red
PDF band) on a dark slate background. Pure-Python PNG encoder — solid colors
only, no text rendering. Emits maskable-safe icons (glyph kept within the
inner 80% safe zone) at 192 and 512 px.
"""
import struct
import zlib

BG = (30, 41, 59)       # slate-800
SHEET = (248, 250, 252)  # near-white
FOLD = (203, 213, 225)   # slate-300 (folded corner shadow)
BAND = (220, 38, 38)     # red-600 (the "PDF" band)


def blend(dst, src, a):
    return tuple(round(d + (s - d) * a) for d, s in zip(dst, src))


def render(size):
    px = [[BG for _ in range(size)] for _ in range(size)]

    # Document sheet occupies the central safe zone.
    m = size * 0.24            # outer margin
    left, right = m, size - m
    top, bottom = m * 0.9, size - m * 0.9
    fold = (right - left) * 0.32   # folded-corner leg length

    for y in range(size):
        for x in range(size):
            if not (left <= x <= right and top <= y <= bottom):
                continue
            # Folded top-right corner: the triangle x+y beyond the fold line
            # is cut away (shows background), and a small inner triangle is the
            # darker fold.
            fold_line = (right - fold) + (y - top)
            if x >= fold_line and y <= top + fold:
                # distance into the corner decides fold vs cut
                if x - (right - fold) <= (y - top):
                    px[y][x] = FOLD
                else:
                    px[y][x] = BG
                continue
            px[y][x] = SHEET

    # Red PDF band across the lower third of the sheet.
    band_top = top + (bottom - top) * 0.58
    band_bot = band_top + (bottom - top) * 0.20
    bx0, bx1 = left + (right - left) * 0.08, right - (right - left) * 0.08
    for y in range(size):
        for x in range(size):
            if band_top <= y <= band_bot and bx0 <= x <= bx1:
                px[y][x] = BAND

    return px


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


for s in (192, 512):
    write_png(f"icons/icon-{s}.png", render(s))
    print(f"wrote icons/icon-{s}.png")
