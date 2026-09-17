#!/usr/bin/env python3
"""Train the tile detector (YOLO11n by default) on the synthetic dataset."""
import argparse
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent

ap = argparse.ArgumentParser()
ap.add_argument("--data", default=str(ROOT / "data" / "synth" / "data.yaml"))
ap.add_argument("--model", default="yolo11n.pt")
ap.add_argument("--epochs", type=int, default=30)
ap.add_argument("--imgsz", type=int, default=640)
ap.add_argument("--batch", type=int, default=16)
ap.add_argument("--device", default="mps")
ap.add_argument("--name", default="tiles")
ap.add_argument("--workers", type=int, default=2)
ap.add_argument("--fraction", type=float, default=1.0)
a = ap.parse_args()

model = YOLO(a.model)
model.train(
    data=a.data, epochs=a.epochs, imgsz=a.imgsz, batch=a.batch, device=a.device, workers=a.workers,
    project=str(ROOT / "runs"), name=a.name, exist_ok=True,
    # tiles are never mirrored in real play; keep geometry realistic
    fliplr=0.0, flipud=0.0, degrees=8.0, scale=0.4, translate=0.1, perspective=0.0003,
    mosaic=1.0, close_mosaic=5, hsv_h=0.02, hsv_s=0.5, hsv_v=0.4,
    cos_lr=True, patience=100, plots=False, cache=False, seed=0, amp=False, verbose=True, fraction=a.fraction,
)
