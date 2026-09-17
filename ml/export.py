#!/usr/bin/env python3
"""Export trained weights to ONNX and install them into the web app."""
import argparse
import shutil
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument("--weights", default=str(ROOT / "runs" / "tiles" / "weights" / "best.pt"))
ap.add_argument("--imgsz", type=int, default=640)
ap.add_argument("--dest", default=str(ROOT.parent / "web" / "public" / "models" / "tiles.onnx"))
a = ap.parse_args()

model = YOLO(a.weights)
out = model.export(format="onnx", imgsz=a.imgsz, opset=17, simplify=True, dynamic=False, nms=False, half=False)
dest = Path(a.dest)
dest.parent.mkdir(parents=True, exist_ok=True)
shutil.copy(out, dest)
print(f"exported {out} -> {dest} ({dest.stat().st_size / 1e6:.1f} MB)")
