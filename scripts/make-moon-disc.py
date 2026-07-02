#!/usr/bin/env python3
"""Project the near side of an equirectangular Moon map into a square
orthographic disc with transparent corners.

Source: Solar System Scope 2k_moon.jpg (CC-BY-4.0) — same source & license as
the Earth textures; credited in the HUD tip. Downloaded on first run and
cached next to this script (cache is gitignored).

Output: public/textures/moon-disc.webp, 1024x1024 RGBA.
Usage:  python3 scripts/make-moon-disc.py
Requires: Pillow (pip install Pillow)
"""
import math, os, urllib.request
from PIL import Image

SRC_URL = 'https://www.solarsystemscope.com/textures/download/2k_moon.jpg'
CACHE = os.path.join(os.path.dirname(__file__), '.cache-2k_moon.jpg')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'textures', 'moon-disc.webp')
SIZE = 1024   # output edge (px)
SS = 2        # supersampling factor (renders at 2048, LANCZOS down to 1024)

def load_map():
    if not os.path.exists(CACHE):
        print('downloading', SRC_URL)
        req = urllib.request.Request(SRC_URL, headers={'User-Agent': 'crewlu-globe asset build'})
        tmp = CACHE + '.tmp'
        with urllib.request.urlopen(req) as r, open(tmp, 'wb') as f:
            f.write(r.read())
        os.replace(tmp, CACHE)
    return Image.open(CACHE).convert('RGB')

def main():
    src = load_map()
    sw, sh = src.size
    px = src.load()
    big = SIZE * SS
    out = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    opx = out.load()
    r = big / 2
    for j in range(big):
        y = (j + 0.5 - r) / r        # -1..1, screen-down
        for i in range(big):
            x = (i + 0.5 - r) / r    # -1..1, screen-right
            d2 = x * x + y * y
            if d2 > 1.0:
                continue             # outside the limb -> stays transparent
            z = math.sqrt(1.0 - d2)  # toward viewer
            lat = math.asin(-y)      # screen-up = +latitude
            lon = math.atan2(x, z)   # near side centered on lon 0
            u = (lon / (2 * math.pi) + 0.5) * (sw - 1)
            v = (0.5 - lat / math.pi) * (sh - 1)
            opx[i, j] = px[int(u), int(v)] + (255,)
    out = out.resize((SIZE, SIZE), Image.LANCZOS)  # supersample -> anti-aliased limb
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    out.save(OUT, 'WEBP', quality=88, method=6)
    print('wrote', os.path.abspath(OUT), os.path.getsize(OUT), 'bytes')

if __name__ == '__main__':
    main()
