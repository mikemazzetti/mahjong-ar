#!/usr/bin/env python3
"""Crop tile faces from the Yellow Mountain Imports "Rouge Heritage" product photo
(data/ymi/ymi-6.jpg, a 12 x 12 top-down grid of the full set) into assets/ymi_faces/.

Grid (row-major): rows 1-4 = dots 1-9, red, green, white; rows 5-8 = bamboo 1-9, east,
south, flower 1-4 (one per row); rows 9-12 = characters 1-9, west, north, season 1-4.
Each standard tile therefore has four crops (<cls>_<k>.png); bonus tiles have one.
"""
import argparse
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument("--image", default=str(ROOT / "data" / "ymi" / "ymi-6.jpg"))
ap.add_argument("--out", default=str(ROOT / "assets" / "ymi_faces"))
ap.add_argument("--inset", type=float, default=0.04, help="fraction of a tile trimmed on each side")
ap.add_argument("--sheet", default=str(ROOT / "data" / "ymi" / "faces_sheet.jpg"))
a = ap.parse_args()

# Tile centres and size in the 2048 px photo (fitted from detector boxes; the photo has a
# little lens distortion so the rows are not perfectly evenly spaced).
COLS = [286, 416, 545, 672, 800, 926, 1053, 1179, 1304, 1431, 1554, 1680]
ROWS = [116, 289, 460, 631, 797, 965, 1130, 1295, 1458, 1619, 1780, 1940]
TILE_W, TILE_H = 127, 164

im = Image.open(a.image).convert("RGB")
out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)


def cls_at(r, c):
    block = r // 4  # 0 dots, 1 bamboo, 2 characters
    if c < 9:
        return [9, 18, 0][block] + c
    if block == 0:
        return {9: 31, 10: 32, 11: 33}[c]  # red, green, white dragon
    if block == 1:
        return {9: 27, 10: 28, 11: 34 + (r % 4)}[c]  # east, south, flowers
    return {9: 29, 10: 30, 11: 38 + (r % 4)}[c]  # west, north, seasons


count = {}
tiles = []
for r in range(12):
    for c in range(12):
        hw, hh = TILE_W / 2 * (1 - 2 * a.inset), TILE_H / 2 * (1 - 2 * a.inset)
        cx1, cy1 = COLS[c] - hw, ROWS[r] - hh
        cx2, cy2 = COLS[c] + hw, ROWS[r] + hh
        crop = im.crop((round(cx1), round(cy1), round(cx2), round(cy2)))
        k = cls_at(r, c)
        n = count.get(k, 0)
        count[k] = n + 1
        crop.save(out / f"{k}_{n}.png")
        tiles.append((k, crop))

# contact sheet in class order for a visual check
tiles.sort(key=lambda t: t[0])
tw, th = 60, 84
sheet = Image.new("RGB", (tw * 16 + 16, th * ((len(tiles) + 15) // 16) + 16), (40, 90, 60))
for i, (k, crop) in enumerate(tiles):
    sheet.paste(crop.resize((tw - 4, th - 4)), (8 + (i % 16) * tw, 8 + (i // 16) * th))
sheet.save(a.sheet, quality=85)
print(f"wrote {len(tiles)} crops for {len(count)} classes to {out}; check {a.sheet}")
