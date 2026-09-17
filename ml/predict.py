#!/usr/bin/env python3
"""Run a trained checkpoint on images and write annotated copies (quick visual check)."""
import argparse
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument("images", nargs="+")
ap.add_argument("--weights", default=str(ROOT / "runs" / "tiles" / "weights" / "last.pt"))
ap.add_argument("--imgsz", type=int, default=512)
ap.add_argument("--conf", type=float, default=0.35)
ap.add_argument("--out", default=str(ROOT / "data" / "pred"))
a = ap.parse_args()

model = YOLO(a.weights)
names = model.names
out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)
for path in a.images:
    for r in model.predict(path, imgsz=a.imgsz, conf=a.conf, device="cpu", verbose=False):
        labels = [(names[int(c)], float(s)) for c, s in zip(r.boxes.cls.tolist(), r.boxes.conf.tolist())]
        print(f"{Path(path).name}: {len(labels)} boxes: {' '.join(f'{n}({s:.2f})' for n, s in labels)}")
        r.save(filename=str(out / Path(path).name))
print(f"annotated images in {out}")
