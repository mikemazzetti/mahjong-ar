#!/usr/bin/env python3
"""Score a checkpoint on the untouched full-set photo (HK_Mahjong_Tiles_with_equipment.jpg).

The photo shows a complete Hong Kong set: 4 copies of each of the 34 standard tiles and
1 of each of the 8 bonus tiles (144 tiles). Without box labels we still get a solid
per-class recall proxy: detections of class c, capped at its true count, over the true
count. Detections beyond the true count are counted as false positives.
"""
import argparse
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent
CLASSES = (
    [f"m{i}" for i in range(1, 10)] + [f"p{i}" for i in range(1, 10)] + [f"s{i}" for i in range(1, 10)]
    + ["E", "S", "W", "N", "C", "F", "P"] + [f"f{i}" for i in range(1, 5)] + [f"g{i}" for i in range(1, 5)]
)
TRUE = {c: (4 if i < 34 else 1) for i, c in enumerate(CLASSES)}

ap = argparse.ArgumentParser()
ap.add_argument("--weights", required=True)
ap.add_argument("--image", default=str(ROOT / "data" / "real" / "HK_Mahjong_Tiles_with_equipment.jpg"))
ap.add_argument("--imgsz", type=int, nargs="+", default=[640, 1280])
ap.add_argument("--conf", type=float, default=0.35)
a = ap.parse_args()

model = YOLO(a.weights)
for imgsz in a.imgsz:
    r = model.predict(a.image, imgsz=imgsz, conf=a.conf, device="cpu", verbose=False)[0]
    found = {c: 0 for c in CLASSES}
    for c in r.boxes.cls.tolist():
        found[model.names[int(c)]] += 1
    hit = sum(min(found[c], TRUE[c]) for c in CLASSES)
    fp = sum(max(0, found[c] - TRUE[c]) for c in CLASSES)
    total = sum(TRUE.values())
    groups = {"chars": CLASSES[0:9], "dots": CLASSES[9:18], "bamboo": CLASSES[18:27], "honors": CLASSES[27:34], "bonus": CLASSES[34:42]}
    print(f"\n=== {Path(a.weights).name} @ imgsz {imgsz}, conf {a.conf}: recall proxy {hit}/{total} = {hit / total:.1%}, extra detections {fp}")
    for g, cs in groups.items():
        h = sum(min(found[c], TRUE[c]) for c in cs)
        t = sum(TRUE[c] for c in cs)
        missing = [c for c in cs if found[c] == 0]
        print(f"  {g:7s} {h:3d}/{t:<3d} {h / t:5.1%}  never seen: {' '.join(missing) or '-'}")
