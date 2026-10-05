#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 NetRing Tech Services, LLC
"""Draws the RingCast Player artwork from the logo (docs/brand/ringcast-player-logo.svg):

    app/icon.png                     80x80     app icon (appinfo.json "icon")
    app/largeIcon.png                130x130   large app icon (appinfo.json "largeIcon")
    app/splash.png                   1920x1080 splash background (appinfo.json "splashBackground")
    docs/store/icon-400.png          400x400   app icon for the LG Seller Lounge
    docs/store/splash-1920x1080.png  1920x1080 the splash, for the store package

The app's mark: the ring and nodes of NetRing's N logo around a faceted metal "R" whose bowl is a
play button. The splash also carries the N logo itself next to "by NetRing". Icons are full bleed on TILE, the colour of appinfo.json "iconColor"/"bgColor" and the
Seller Lounge "App Tile Color", so they blend into the tile on every webOS version.

Needs cairosvg (pip) and Pillow. Run again only to change the design: python3 tools/make_icons.py
"""
import io
import math
from pathlib import Path

import cairosvg
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
STORE = ROOT / "docs" / "store"
BRAND = ROOT / "docs" / "brand"
TILE = "#0A101A"
FONTS = ["/usr/share/fonts/opentype/inter/Inter-SemiBold.otf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
FONTS_REG = ["/usr/share/fonts/opentype/inter/Inter-Regular.otf",
             "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]

DEFS = """<defs>
<linearGradient id="teal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#12909B"/><stop offset="1" stop-color="#0B6F79"/></linearGradient>
<linearGradient id="nteal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A6670"/><stop offset="1" stop-color="#08545C"/></linearGradient>
<linearGradient id="metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8A8F96"/><stop offset=".55" stop-color="#5E636B"/><stop offset="1" stop-color="#454A52"/></linearGradient>
<linearGradient id="nmetal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#606368"/><stop offset="1" stop-color="#474B52"/></linearGradient>
<linearGradient id="metal2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7C8189"/><stop offset="1" stop-color="#4C5159"/></linearGradient>
<linearGradient id="nmetal2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5A5E64"/><stop offset="1" stop-color="#454950"/></linearGradient>
<pattern id="grid" width="15" height="15" patternUnits="userSpaceOnUse"><path d="M15 0H0V15" fill="none" stroke="#0F1822" stroke-width="1"/></pattern>
<pattern id="pgrid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#0F1A26" stroke-width="2"/></pattern>
</defs>"""


def n_svg(background=True, grid=False):
    """NetRing's N logo, redrawn as vectors from the original artwork (240x240 units)."""
    def pt(a, r=97, cx=119, cy=110):
        return cx + r * math.cos(math.radians(a)), cy - r * math.sin(math.radians(a))
    (x1, y1), (x2, y2) = pt(52), pt(220)
    bg = f'<rect x="-1" y="-10" width="240" height="240" fill="{TILE}"/>' if background else ""
    if background and grid:
        bg += '<rect x="-1" y="-10" width="240" height="240" fill="url(#grid)"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -10 240 240" width="512" height="512">{DEFS}{bg}'
            '<circle cx="119" cy="110" r="97" fill="none" stroke="url(#nteal)" stroke-width="11"/>'
            f'<circle cx="{x1:.1f}" cy="{y1:.1f}" r="16" fill="url(#nteal)"/>'
            f'<circle cx="{x2:.1f}" cy="{y2:.1f}" r="16" fill="url(#nteal)"/>'
            '<polygon points="72,50 78,50 154,116 154,52 174,70 174,170 72,74" fill="url(#nmetal)"/>'
            '<polygon points="72,87 92,105 92,171 72,153" fill="url(#nmetal2)"/>'
            '</svg>')


def logo_svg(background=True, grid=False):
    """The RingCast Player mark: the N logo's ring and nodes around a faceted metal R whose bowl
    is a play button (512x512 units)."""
    def pt(a, r=200, c=256):
        return c + r * math.cos(math.radians(a)), c - r * math.sin(math.radians(a))
    (x1, y1), (x2, y2) = pt(58), pt(217)
    bg = f'<rect width="512" height="512" fill="{TILE}"/>' if background else ""
    if background and grid:
        bg += '<rect width="512" height="512" fill="url(#pgrid)"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">{DEFS}{bg}'
            '<circle cx="256" cy="256" r="200" fill="none" stroke="url(#teal)" stroke-width="26"/>'
            f'<circle cx="{x1:.1f}" cy="{y1:.1f}" r="34" fill="url(#teal)"/>'
            f'<circle cx="{x2:.1f}" cy="{y2:.1f}" r="34" fill="url(#teal)"/>'
            '<g transform="translate(256 261) scale(1.12) translate(-262 -261)">'
            '<polygon points="168,196 214,150 214,372 168,372" fill="url(#metal)"/>'
            '<polygon points="230,150 344,214 230,278" fill="url(#metal2)"/>'
            '<polygon points="248,292 296,292 352,372 302,372" fill="url(#metal)"/>'
            '</g></svg>')


def render(svg, size):
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def font(px, files=FONTS):
    for f in files:
        try:
            return ImageFont.truetype(f, px)
        except OSError:
            continue
    return ImageFont.load_default()


def splash():
    w, h = 1920, 1080
    img = Image.new("RGBA", (w, h), TILE)
    d = ImageDraw.Draw(img)
    for x in range(0, w, 48):                      # the faint grid of the NetRing artwork
        d.line([(x, 0), (x, h)], fill="#0F1A26", width=2)
    for y in range(0, h, 48):
        d.line([(0, y), (w, y)], fill="#0F1A26", width=2)
    s = 400
    img.alpha_composite(render(logo_svg(background=False), s), ((w - s) // 2, 190))
    title, sub = "RingCast Player", "by NetRing"
    ft, fs = font(76), font(38, FONTS_REG)
    tw = d.textlength(title, font=ft)
    d.text(((w - tw) / 2, 640), title, font=ft, fill="#D7DBE0")
    n = 64                                          # the NetRing N next to "by NetRing"
    sw = d.textlength(sub, font=fs)
    x0 = (w - (n + 16 + sw)) / 2
    img.alpha_composite(render(n_svg(background=False), n), (int(x0), 752))
    d.text((x0 + n + 16, 762), sub, font=fs, fill="#9AA3AC")
    return img.convert("RGB")


if __name__ == "__main__":
    BRAND.mkdir(parents=True, exist_ok=True)
    (BRAND / "ringcast-player-logo.svg").write_text(logo_svg(grid=True) + "\n")
    (BRAND / "ringcast-player-mark.svg").write_text(logo_svg(background=False) + "\n")
    (BRAND / "netring-n-logo.svg").write_text(n_svg(grid=True) + "\n")
    render(logo_svg(background=False), 1024).save(BRAND / "ringcast-player-mark-1024.png", optimize=True)
    for size, path in ((80, APP / "icon.png"), (130, APP / "largeIcon.png"), (400, STORE / "icon-400.png")):
        render(logo_svg(), size).convert("RGB").save(path, optimize=True)
    sp = splash()
    sp.save(APP / "splash.png", optimize=True)
    sp.save(STORE / "splash-1920x1080.png", optimize=True)
    print("done")
