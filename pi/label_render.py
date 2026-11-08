#!/usr/bin/env python3
"""Raklapcímke kirajzolása a nyomtató felbontásán, élsimítás nélkül.

A szöveg FreeType hintinggel, 1 bites módban készül (draw.fontmode = "1"),
így a betűk vonalai egyenletesek a B1 8 pont/mm-es fején, nem lépcsősek.
A QR-kód mintáját az oldal küldi (sorok '0'/'1' szövegként), így a Pi-n nem kell
külön QR-könyvtár.

Használat (teszt): label_render.py spec.json kimenet.png
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 352, 240  # a B1 címkéin látható terület (kalibrálva)

FONT_DIRS = ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/truetype/liberation",
             "/usr/share/fonts/truetype/freefont"]
BOLD = ["DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf", "FreeSansBold.ttf"]
REGULAR = ["DejaVuSans.ttf", "LiberationSans-Regular.ttf", "FreeSans.ttf"]


def _font(names, size):
    for d in FONT_DIRS:
        for n in names:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def bold(size):
    return _font(BOLD, size)


def regular(size):
    return _font(REGULAR, size)


def fit(draw, text, max_w, start, make=bold, minimum=11):
    size = start
    f = make(size)
    while draw.textlength(text, font=f) > max_w and size > minimum:
        size -= 1
        f = make(size)
    return f


def render_pallet(spec):
    img = Image.new("1", (W, H), 1)
    d = ImageDraw.Draw(img)
    d.fontmode = "1"  # élsimítás nélkül, a pontrácshoz igazítva

    # Keret és fejléc a címke széléig
    d.rectangle([0, 0, W - 1, H - 1], outline=0, width=4)
    d.rectangle([0, 0, W - 1, 43], fill=0)
    d.text((14, 22), "JEDBET", font=bold(26), fill=1, anchor="lm")
    d.text((W - 14, 22), f"{spec['panel_count']} db", font=bold(20), fill=1, anchor="rm")

    # QR-kód a megadott mintából, egész pontos modulmérettel
    rows = spec.get("qr") or []
    if rows:
        n = len(rows)
        cell = max(1, 108 // n)
        size = cell * n
        ox, oy = 14 + (108 - size) // 2, 58 + (108 - size) // 2
        for r, line in enumerate(rows):
            for c, ch in enumerate(line):
                if ch == "1":
                    d.rectangle([ox + c * cell, oy + r * cell, ox + (c + 1) * cell - 1, oy + (r + 1) * cell - 1], fill=0)

    x = 134
    max_w = W - x - 12
    d.text((x, 54), spec["serial"], font=fit(d, spec["serial"], max_w, 30), fill=0)
    d.text((x, 94), spec["template"], font=fit(d, spec["template"], max_w, 24), fill=0)
    d.text((x, 128), "Öntve", font=regular(15), fill=0)
    d.text((x, 145), spec["poured"], font=fit(d, spec["poured"], max_w, 18), fill=0)
    d.text((x, 170), "Kiforgatva", font=regular(15), fill=0)
    d.text((x, 187), spec["demolded"], font=fit(d, spec["demolded"], max_w, 18), fill=0)
    return img


def render(spec):
    kind = spec.get("kind")
    if kind == "pallet":
        return render_pallet(spec)
    raise ValueError(f"Ismeretlen címketípus: {kind}")


if __name__ == "__main__":
    with open(sys.argv[1]) as f:
        render(json.load(f)).save(sys.argv[2])
