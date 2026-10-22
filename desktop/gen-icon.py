#!/usr/bin/env python3
"""Draw PDF+'s icon: the PDF Viewer's page, without its red band, with a red
plus in the middle.

The page and its outline are pwa/icons/icon-512.png as it stands, so the two
apps read as one family; the plus in place of the band is what tells them
apart in the taskbar and in "Open with" while both are installed. Writes
build/icon.png (512 px), which electron-builder turns into the Windows .ico
and which the window uses on Linux.

  python3 desktop/gen-icon.py        (needs Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / "pwa" / "icons" / "icon-512.png"
OUT = HERE / "build" / "icon.png"

SCALE = 4  # drawn at 4x and reduced, for smooth edges
RED = (220, 38, 38, 255)     # the band's red (pwa/gen-icons.py BAND)
SHEET = (248, 250, 252, 255)  # the page's white (pwa/gen-icons.py SHEET)


def main():
    page = Image.open(SRC).convert("RGBA")
    if page.size != (512, 512):
        raise SystemExit(f"{SRC} is {page.size}, expected 512x512")
    # The band (x 96-415, y 295-393 as pwa/gen-icons.py draws it) painted
    # over in the page's white, a pixel wider all round for its soft edge.
    ImageDraw.Draw(page).rectangle([94, 293, 417, 395], fill=SHEET)
    # The page's middle: its outline runs x 66-445, y 11-500.
    cx, cy = 256, 256
    arm = 112  # half the plus's span
    bar = 36   # half the stroke's width

    layer = Image.new("RGBA", (512 * SCALE, 512 * SCALE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    s = SCALE
    d.rectangle([(cx - arm) * s, (cy - bar) * s, (cx + arm) * s, (cy + bar) * s], fill=RED)
    d.rectangle([(cx - bar) * s, (cy - arm) * s, (cx + bar) * s, (cy + arm) * s], fill=RED)
    layer = layer.resize((512, 512), Image.LANCZOS)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    Image.alpha_composite(page, layer).save(OUT)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
