#!/usr/bin/env python3
"""Write a combined dataset config that samples a fixed number of images from each
synthetic set (Ultralytics' `fraction` keeps only the first files after sorting, so it
cannot be used to thin a multi-directory dataset evenly).

Usage: python make_combo.py --out data/combo3.yaml synth=1500 synth2=800 synth3=1200 synth4=2500
"""
import argparse
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
CLASSES = (
    [f"m{i}" for i in range(1, 10)] + [f"p{i}" for i in range(1, 10)] + [f"s{i}" for i in range(1, 10)]
    + ["E", "S", "W", "N", "C", "F", "P"] + [f"f{i}" for i in range(1, 5)] + [f"g{i}" for i in range(1, 5)]
)

ap = argparse.ArgumentParser()
ap.add_argument("sets", nargs="+", help="name=count pairs, e.g. synth=1500 synth4=2500")
ap.add_argument("--out", default=str(DATA / "combo.yaml"))
ap.add_argument("--val", nargs="*", default=None, help="sets whose val split to use (default: all listed)")
ap.add_argument("--seed", type=int, default=0)
a = ap.parse_args()

rng = random.Random(a.seed)
train_files = []
names = []
for spec in a.sets:
    name, count = spec.split("=")
    names.append(name)
    files = sorted((DATA / name / "images" / "train").glob("*.jpg"))
    pick = files if int(count) >= len(files) else rng.sample(files, int(count))
    train_files += [str(p) for p in pick]
    print(f"{name}: {len(pick)}/{len(files)} train images")
rng.shuffle(train_files)
out = Path(a.out)
list_path = out.resolve().with_suffix(".train.txt")
list_path.write_text("\n".join(train_files) + "\n")
val_sets = a.val if a.val is not None else names
yaml = f"path: {DATA}\ntrain: {list_path}\nval:\n" + "".join(f"  - {v}/images/val\n" for v in val_sets)
yaml += "names:\n" + "".join(f"  {i}: {c}\n" for i, c in enumerate(CLASSES))
out.write_text(yaml)
print(f"{len(train_files)} train images -> {out}")
