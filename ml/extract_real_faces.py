#!/usr/bin/env python3
"""Crop the 42 tile faces from the Wikimedia 'Mahjong eg HK' composite (a 9x5 grid) into
assets/real_faces/<cls>.png so the synthetic generator can use photographic tile faces."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent
src = ROOT / "data" / "real" / "Mahjong_eg_HK.jpg"
out = ROOT / "assets" / "real_faces"
out.mkdir(parents=True, exist_ok=True)
im = Image.open(src).convert("RGB")
W, H = im.size
cols, rows = 9, 5
cw, ch = W / cols, H / rows
# grid rows: dots 1-9, bamboo 1-9, characters 1-9, E S W N C F P (+2 blanks), seasons 一二三四 (g1-4) + flowers 1234 (f1-4) (+1 blank)
grid = [
    [9 + i for i in range(9)],
    [18 + i for i in range(9)],
    [0 + i for i in range(9)],
    [27, 28, 29, 30, 31, 32, 33, None, None],
    [38, 39, 40, 41, 34, 35, 36, 37, None],
]
inset = 0.03
n = 0
for r, row in enumerate(grid):
    for c, cls in enumerate(row):
        if cls is None:
            continue
        x1, y1 = (c + inset) * cw, (r + inset) * ch
        x2, y2 = (c + 1 - inset) * cw, (r + 1 - inset) * ch
        im.crop((int(x1), int(y1), int(x2), int(y2))).save(out / f"{cls}.png")
        n += 1
print(f"wrote {n} faces to {out}")
