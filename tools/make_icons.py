#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 NetRing Tech Services, LLC
"""Draws the app's artwork with Pillow (original artwork, no third-party images):

    app/icon.png            80x80     app icon (appinfo.json "icon")
    app/largeIcon.png       130x130   large app icon (appinfo.json "largeIcon")
    app/splash.png          1920x1080 splash background (appinfo.json "splashBackground")
    docs/store/icon-400.png 400x400   app icon for the LG Seller Lounge

The mark: a cyan ring with a light dot and two short arcs cast from it, on a full-bleed square
of the tile colour TILE (the same colour as appinfo.json "iconColor"/"bgColor" and the "App Tile
Color" chosen in the Seller Lounge), so the icon blends into its tile on every webOS version.
The splash is the tile colour with a soft lighter centre (never black), the mark and the name.

Run again only to change the design: python3 tools/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
STORE = ROOT / "docs" / "store"
TILE = "#0A1A2F"
NAVY, CYAN, SOFT = (10, 26, 47, 255), (0, 198, 255, 255), (230, 238, 248, 255)
FONTS = ["/usr/share/fonts/opentype/inter/Inter-SemiBold.otf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]


def mark(d, x0, y0, s):
    """The ring and its arcs inside the square (x0, y0, s)."""
    cx, cy = x0 + s * 0.43, y0 + s * 0.57          # a little low and left
    r, w = s * 0.2, s * 0.085
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=CYAN, width=int(w))
    d.ellipse((cx - s * 0.055, cy - s * 0.055, cx + s * 0.055, cy + s * 0.055), fill=SOFT)
    for rr in (s * 0.32, s * 0.43):                # two "cast" arcs towards the upper right
        d.arc((cx - rr, cy - rr, cx + rr, cy + rr), start=-80, end=-10, fill=SOFT, width=int(s * 0.06))


def icon(size):
    k = 8
    s = size * k
    img = Image.new("RGBA", (s, s), NAVY)          # full bleed: the tile colour to every edge
    mark(ImageDraw.Draw(img), 0, 0, s)
    return img.resize((size, size), Image.LANCZOS).convert("RGB")


def font(px):
    for f in FONTS:
        if Path(f).exists():
            return ImageFont.truetype(f, px)
    raise SystemExit("no font found: install Inter or DejaVu Sans")


def splash():
    w, h = 1920, 1080
    # a soft radial lift from the tile colour towards the panel colour in the middle
    small = Image.new("RGB", (192, 108))
    px = small.load()
    for y in range(108):
        for x in range(192):
            dx, dy = (x - 96) / 96.0, (y - 50) / 60.0
            t = max(0.0, 1.0 - (dx * dx + dy * dy) ** 0.5)
            px[x, y] = (int(10 + 14 * t), int(26 + 26 * t), int(47 + 38 * t))
    img = small.resize((w, h), Image.BICUBIC).convert("RGBA")
    k = 4
    s = 360
    m = Image.new("RGBA", (s * k, s * k), (0, 0, 0, 0))
    mark(ImageDraw.Draw(m), 0, 0, s * k)
    m = m.resize((s, s), Image.LANCZOS)
    img.alpha_composite(m, ((w - s) // 2 - 15, 250))    # the ring and arcs centred together
    d = ImageDraw.Draw(img)
    f = font(96)
    text = "RingCast"
    tw = d.textlength(text, font=f)
    d.text(((w - tw) / 2, 660), text, font=f, fill=SOFT)
    return img.convert("RGB")


if __name__ == "__main__":
    STORE.mkdir(parents=True, exist_ok=True)
    icon(80).save(APP / "icon.png", optimize=True)
    icon(130).save(APP / "largeIcon.png", optimize=True)
    icon(400).save(STORE / "icon-400.png", optimize=True)
    splash().save(APP / "splash.png", optimize=True)
    print("wrote app/icon.png, app/largeIcon.png, app/splash.png, docs/store/icon-400.png; tile colour", TILE)
