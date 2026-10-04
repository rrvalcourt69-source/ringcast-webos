#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 NetRing Tech Services, LLC
"""Draws the app icons (app/icon.png 80x80, app/largeIcon.png 130x130) with Pillow.

A navy rounded tile with a cyan ring and two short arcs cast from it. Drawn large and scaled
down for smooth edges. Run again only to change the design: python3 tools/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

APP = Path(__file__).resolve().parent.parent / "app"
NAVY, CYAN, SOFT = (10, 26, 47, 255), (0, 198, 255, 255), (230, 238, 248, 255)


def icon(size):
    k = 8
    s = size * k
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=NAVY)
    cx, cy = s * 0.43, s * 0.57                  # the ring, a little low and left
    r, w = s * 0.2, s * 0.085
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=CYAN, width=int(w))
    d.ellipse((cx - s * 0.055, cy - s * 0.055, cx + s * 0.055, cy + s * 0.055), fill=SOFT)
    for rr in (s * 0.32, s * 0.43):              # two "cast" arcs towards the upper right
        d.arc((cx - rr, cy - rr, cx + rr, cy + rr), start=-80, end=-10, fill=SOFT, width=int(s * 0.06))
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    icon(80).save(APP / "icon.png", optimize=True)
    icon(130).save(APP / "largeIcon.png", optimize=True)
    print("wrote", APP / "icon.png", APP / "largeIcon.png")
