#!/usr/bin/env python3
"""Synthetic training data generator for mahjong tile detection (YOLO format).

Public-domain tile face artwork is composited onto procedurally rendered tile bodies,
arranged the way a player sees them (a row of 13-14 tiles, exposed melds, flowers,
scattered tiles), placed on random table-like backgrounds, and then geometrically and
photometrically augmented so the detector generalises to phone photos.

Class order matches web/src/engine/tiles.ts (0..41).
"""
import argparse
import math
import random
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
CLASSES = (
    [f"m{i}" for i in range(1, 10)] + [f"p{i}" for i in range(1, 10)] + [f"s{i}" for i in range(1, 10)]
    + ["E", "S", "W", "N", "C", "F", "P"] + [f"f{i}" for i in range(1, 5)] + [f"g{i}" for i in range(1, 5)]
)
FACE_H_OVER_W = 1.38  # tile face aspect (height / width)
BONUS_P = 0.06  # base probability that a hand slot is a flower/season


def samoheen_map():
    d = ASSETS / "samoheen" / "hongkong" / "png"
    m = {}
    for i in range(9):
        m[i] = d / f"{8 + i:02d}-characters-{i + 1}.png"
        m[9 + i] = d / f"{17 + i:02d}-circles-{i + 1}.png"
        m[18 + i] = d / f"{26 + i:02d}-bamboos-{i + 1}.png"
    for i, n in enumerate(["04-east-wind", "05-south-wind", "06-west-wind", "07-north-wind"]):
        m[27 + i] = d / f"{n}.png"
    m[31] = d / "03-red-dragon.png"
    m[32] = d / "02-green-dragon.png"
    m[33] = d / "01-white-dragon.png"
    for i, n in enumerate(["39-plum", "40-orchid", "41-chrysanthemum", "42-bamboo"]):
        m[34 + i] = d / f"{n}.png"
    for i, n in enumerate(["35-spring", "36-summer", "37-autumn", "38-winter"]):
        m[38 + i] = d / f"{n}.png"
    return m


def fluffy_map(variant="Regular"):
    d = ASSETS / "fluffystuff" / "Export" / variant
    m = {}
    for i in range(9):
        m[i] = d / f"Man{i + 1}.png"
        m[9 + i] = d / f"Pin{i + 1}.png"
        m[18 + i] = d / f"Sou{i + 1}.png"
    for i, n in enumerate(["Ton", "Nan", "Shaa", "Pei"]):
        m[27 + i] = d / f"{n}.png"
    m[31] = d / "Chun.png"
    m[32] = d / "Hatsu.png"
    return m  # Haku (white dragon) is blank in this set; HK white dragon comes from samoheen


def load_face(path, max_w=240):
    im = Image.open(path).convert("RGBA")
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    if im.width > max_w:
        im = im.resize((max_w, max(1, round(im.height * max_w / im.width))), Image.LANCZOS)
    return im


_STYLES = None

# Unicode "Mahjong Tiles" block, rendered with a system font as a fourth face style
# (different calligraphy for honours, a different 1-bamboo bird, frame-style white dragon).
FONT_CANDIDATES = ["/System/Library/Fonts/Apple Symbols.ttf", "/usr/share/fonts/truetype/noto/NotoSansSymbols2-Regular.ttf"]
INK = {
    "black": [(20, 20, 20), (35, 30, 30), (10, 10, 30)],
    "red": [(190, 30, 30), (160, 20, 40), (210, 50, 40)],
    "green": [(20, 110, 50), (30, 130, 60), (10, 90, 40)],
    "blue": [(20, 50, 160), (30, 70, 180), (10, 40, 120)],
}


def font_codepoint(cls):
    if cls < 9:
        return 0x1F007 + cls
    if cls < 18:
        return 0x1F019 + (cls - 9)  # circles
    if cls < 27:
        return 0x1F010 + (cls - 18)  # bamboos
    if cls < 34:
        return 0x1F000 + (cls - 27)  # E S W N, red, green, white
    return {34: 0x1F022, 35: 0x1F023, 36: 0x1F025, 37: 0x1F024, 38: 0x1F026, 39: 0x1F027, 40: 0x1F028, 41: 0x1F029}[cls]


def font_ink(cls):
    if cls < 9:
        return ["black", "red", "blue"]
    if cls < 18:
        return ["blue", "green", "black"]
    if cls < 27:
        return ["green", "black", "blue"]
    if cls < 31:
        return ["black", "blue"]
    return {31: ["red"], 32: ["green"], 33: ["blue", "green", "black"]}.get(cls, ["red", "green", "blue", "black"])


def font_faces():
    """Returns {cls: [RGBA faces...]} or None when no suitable font is installed."""
    from PIL import ImageFont

    font = None
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            try:
                font = ImageFont.truetype(p, 300)
                break
            except OSError:
                continue
    if font is None:
        return None
    probe = Image.new("L", (600, 600), 0)
    ImageDraw.Draw(probe).text((20, 20), chr(0x1F007), font=font, fill=255)
    if probe.getbbox() is None:
        return None
    out = {}
    for cls in range(42):
        variants = []
        for ink in font_ink(cls):
            for col in INK[ink]:
                im = Image.new("RGBA", (600, 600), (0, 0, 0, 0))
                ImageDraw.Draw(im).text((20, 20), chr(font_codepoint(cls)), font=font, fill=col + (255,))
                x1, y1, x2, y2 = im.getbbox()
                if cls == 33:  # white dragon: the frame IS the face
                    im = im.crop((x1, y1, x2, y2))
                else:  # strip the glyph's own tile frame and keep the symbol
                    dx, dy = int((x2 - x1) * 0.075), int((y2 - y1) * 0.06)
                    im = im.crop((x1 + dx, y1 + dy, x2 - dx, y2 - dy))
                    bb = im.getbbox()
                    if bb:
                        im = im.crop(bb)
                variants.append(im)
        out[cls] = variants
    return out


def frame_face(rng, w=200, h=276):
    """A white dragon drawn as a plain rectangular frame (blue/green/black), as on many real sets."""
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    col = rng.choice(INK["blue"] + INK["green"] + INK["black"])
    inset = int(w * rng.uniform(0.04, 0.12))
    width = max(2, int(w * rng.uniform(0.02, 0.06)))
    d = ImageDraw.Draw(im)
    d.rectangle([inset, inset, w - inset, h - inset], outline=col + (255,), width=width)
    if rng.random() < 0.5:
        g = inset + width + int(w * rng.uniform(0.02, 0.05))
        d.rectangle([g, g, w - g, h - g], outline=col + (255,), width=max(1, width // 2))
    return im


def styles():
    global _STYLES
    if _STYLES is None:
        hk = {k: load_face(v) for k, v in samoheen_map().items()}
        ri = {k: load_face(v) for k, v in fluffy_map().items()}
        for k in list(range(34, 42)) + [33]:
            ri[k] = hk[k]
        front = Image.open(ASSETS / "fluffystuff" / "Export" / "Regular" / "Front.png").convert("RGBA")
        back = Image.open(ASSETS / "fluffystuff" / "Export" / "Regular" / "Back.png").convert("RGBA")
        faces = {"hk": hk, "riichi": ri}
        real_dir = ASSETS / "real_faces"
        if real_dir.exists() and len(list(real_dir.glob("*.png"))) == 42:
            # photographic full-tile crops (body included); rendered without a synthetic body
            faces["real"] = {k: Image.open(real_dir / f"{k}.png").convert("RGBA") for k in range(42)}
        ff = font_faces()
        if ff:
            faces["font"] = ff
        ymi_dir = ASSETS / "ymi_faces"  # the user's own set (see extract_ymi_faces.py): full-tile crops
        if ymi_dir.exists():
            ymi = {k: [Image.open(p).convert("RGBA") for p in sorted(ymi_dir.glob(f"{k}_*.png"))] for k in range(42)}
            if all(ymi[k] for k in range(42)):
                faces["ymi"] = ymi
        _STYLES = {"faces": faces, "front": front, "back": back}
    return _STYLES


FULL_TILE_STYLES = ("real", "ymi")  # photographic crops that already include the tile body


# ---------------------------------------------------------------- tile rendering
def make_body(w, h, rng, front=None):
    """Ivory tile body with rounded corners; optionally a coloured back band at the bottom."""
    if front is not None and rng.random() < 0.35:
        body = front.resize((w, h), Image.LANCZOS)
    else:
        body = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(body)
        base = (rng.randint(232, 255), rng.randint(226, 250), rng.randint(205, 240))
        r = max(2, int(min(w, h) * rng.uniform(0.06, 0.14)))
        d.rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=base + (255,), outline=(175, 165, 145, 255), width=1)
        arr = np.asarray(body).astype(np.float32)
        top, bot = rng.uniform(0.9, 1.0), rng.uniform(0.96, 1.08)
        grad = np.linspace(top, bot, h, dtype=np.float32)[:, None, None]
        arr[..., :3] = np.clip(arr[..., :3] * grad, 0, 255)
        body = Image.fromarray(arr.astype(np.uint8))
    if rng.random() < 0.45:
        band_h = int(h * rng.uniform(0.05, 0.22))
        colour = rng.choice([(40, 120, 70), (30, 80, 160), (200, 170, 60), (150, 40, 40), (60, 60, 60), (240, 240, 235)])
        band = Image.new("RGBA", (w, band_h), colour + (255,))
        mask = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=max(2, int(min(w, h) * 0.08)), fill=255)
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        layer.paste(band, (0, h - band_h))
        body = Image.composite(layer, body, Image.fromarray(np.minimum(np.asarray(mask), np.asarray(layer)[..., 3])))
    return body


def render_full_tile(face, w, h, rng):
    """A photographic full-tile crop: resize, jitter colour, and round the corners."""
    tile = face.resize((w, h), Image.LANCZOS)
    arr = np.asarray(tile).astype(np.float32)
    arr[..., :3] = np.clip(arr[..., :3] * rng.uniform(0.85, 1.12) + rng.uniform(-15, 15), 0, 255)
    tile = Image.fromarray(arr.astype(np.uint8))
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=max(2, int(min(w, h) * rng.uniform(0.05, 0.12))), fill=255)
    tile.putalpha(mask)
    return tile


def render_tile(face, w, h, rng, body):
    if body is None:
        return render_full_tile(face, w, h, rng)
    tile = body.copy()
    band = 0
    margin = rng.uniform(0.78, 0.92)
    fw, fh = int(w * margin), int((h - band) * margin)
    scale = min(fw / face.width, fh / face.height)
    fs = face.resize((max(1, int(face.width * scale)), max(1, int(face.height * scale))), Image.LANCZOS)
    if rng.random() < 0.5:  # slight ink colour jitter
        arr = np.asarray(fs).astype(np.float32)
        arr[..., :3] = np.clip(arr[..., :3] * rng.uniform(0.85, 1.1) + rng.uniform(-12, 12), 0, 255)
        fs = Image.fromarray(arr.astype(np.uint8))
    ox = (w - fs.width) // 2 + int(rng.uniform(-0.03, 0.03) * w)
    oy = (h - band - fs.height) // 2 + int(rng.uniform(-0.03, 0.03) * h)
    tile.alpha_composite(fs, (max(0, ox), max(0, oy)))
    return tile


# ---------------------------------------------------------------- background
PALETTE = [
    (30, 95, 55), (25, 80, 45), (40, 110, 70), (20, 60, 120), (35, 75, 140), (120, 80, 45), (150, 105, 60),
    (90, 60, 35), (200, 185, 160), (230, 225, 215), (245, 245, 240), (60, 60, 65), (30, 30, 35), (140, 30, 40),
    (180, 150, 110), (100, 100, 110), (210, 200, 180), (70, 90, 60),
]


def make_background(W, H, rng):
    base = np.array(rng.choice(PALETTE), dtype=np.float32) * rng.uniform(0.7, 1.15)
    img = np.ones((H, W, 3), np.float32) * base[None, None, :]
    # smooth low-frequency lighting / cloth variation
    lo = rng.uniform(0.75, 1.25, size=(rng.randint(2, 6), rng.randint(2, 6), 1)).astype(np.float32)
    img *= cv2.resize(lo, (W, H), interpolation=cv2.INTER_CUBIC)[..., None] if lo.shape[2] == 1 else 1
    # fine texture
    if rng.random() < 0.8:
        noise = rng.normal(0, rng.uniform(2, 10), size=(H, W, 1)).astype(np.float32)
        img += noise
    # wood grain / stripes
    if rng.random() < 0.3:
        ys = np.arange(H, dtype=np.float32)[:, None]
        xs = np.arange(W, dtype=np.float32)[None, :]
        ang = rng.uniform(0, math.pi)
        f = rng.uniform(0.02, 0.12)
        stripes = np.sin((xs * math.cos(ang) + ys * math.sin(ang)) * f + rng.uniform(0, 6)) * rng.uniform(3, 14)
        img += stripes[..., None]
    # piles of scoring chips / dice (common on real tables; must not look like tiles)
    if rng.random() < 0.35:
        cx, cy = rng.randint(0, W), rng.randint(0, H)
        for _ in range(rng.randint(8, 40)):
            col = rng.choice([(40, 160, 90), (230, 200, 40), (200, 50, 50), (60, 90, 200), (240, 240, 240), (20, 20, 20)])
            r = rng.randint(max(4, W // 90), max(6, W // 30))
            cv2.circle(img, (cx + rng.randint(-W // 6, W // 6), cy + rng.randint(-H // 8, H // 8)), r, [float(v) for v in col], -1)
            cv2.circle(img, (cx + rng.randint(-W // 6, W // 6), cy + rng.randint(-H // 8, H // 8)), r, (255.0, 255.0, 255.0), 1)
    # random other objects
    for _ in range(rng.randint(0, 4)):
        col = np.array(rng.choice(PALETTE), np.float32) * rng.uniform(0.6, 1.3)
        x, y = rng.randint(0, W), rng.randint(0, H)
        if rng.random() < 0.5:
            cv2.rectangle(img, (x, y), (x + rng.randint(20, W // 2), y + rng.randint(20, H // 2)), col.tolist(), -1)
        else:
            cv2.circle(img, (x, y), rng.randint(10, W // 4), col.tolist(), -1)
    return np.clip(img, 0, 255)


# ---------------------------------------------------------------- scene layout
def sample_classes(rng, n, bonus_p=None):
    if bonus_p is None:
        bonus_p = BONUS_P
    counts = [0] * 42
    out = []
    while len(out) < n:
        if rng.random() < bonus_p:
            c = rng.randint(34, 41)
            if counts[c] >= 1:
                continue
        else:
            # bias towards realistic hands: a few suits/values repeated
            c = rng.randint(0, 33)
            if counts[c] >= 4:
                continue
        counts[c] += 1
        out.append(c)
    return out


def place_row(rng, classes, x0, y0, tw, th, gap, jitter, rot, out):
    x = x0
    for c in classes:
        out.append(dict(cls=c, x=x, y=y0 + rng.uniform(-jitter, jitter) * th, w=tw, h=th, angle=rng.uniform(-rot, rot)))
        x += tw + gap
    return x


def layout(rng, W, H):
    """Returns a list of tile placements (dict with cls, x, y, w, h, angle) and unlabeled distractors."""
    tiles = []
    kind = rng.choices(["hand", "hand_melds", "scatter", "rows", "closeup"], weights=[4, 3, 2, 2, 2])[0]
    if kind in ("hand", "hand_melds", "rows"):
        n = rng.randint(8, 14)
        span = W * rng.uniform(0.55, 0.98)
        gap = rng.uniform(0, 0.08)
        tw = max(14, int(span / (n * (1 + gap))))
        tw = min(tw, int(W / 6))
        th = int(tw * FACE_H_OVER_W * rng.uniform(0.92, 1.12))
        gap_px = int(tw * gap)
        x0 = rng.uniform(0, max(1, W - n * (tw + gap_px)))
        y0 = rng.uniform(H * 0.25, max(H * 0.25, H - th - 2))
        place_row(rng, sample_classes(rng, n), x0, y0, tw, th, gap_px, 0.03, 3, tiles)
        if kind == "hand_melds":
            for _ in range(rng.randint(1, 3)):
                m = rng.randint(3, 4)
                c = rng.randint(0, 33)
                if rng.random() < 0.5:
                    cls = [c] * m
                else:
                    c = rng.choice([s * 9 + r for s in range(3) for r in range(7)])
                    cls = [c, c + 1, c + 2] + ([c] if m == 4 else [])
                mx = rng.uniform(0, max(1, W - m * (tw + gap_px + 2)))
                my = rng.uniform(0, max(1, y0 - th * 1.3)) if y0 > th * 1.5 else rng.uniform(0, H - th)
                place_row(rng, cls, mx, my, tw, th, gap_px + 2, 0.03, 3, tiles)
                if rng.random() < 0.4 and len(tiles) >= m:  # claimed tile turned sideways
                    tiles[-rng.randint(1, m)]["angle"] += rng.choice([-90, 90])
        if kind == "rows":
            k = rng.randint(1, 8)
            ry = rng.uniform(0, max(1, y0 - th * 1.2)) if y0 > th * 1.3 else rng.uniform(0, H - th)
            place_row(rng, sample_classes(rng, k, bonus_p=0.5), rng.uniform(0, max(1, W - k * (tw + gap_px))), ry, tw, th, gap_px, 0.03, 3, tiles)
    elif kind == "closeup":
        n = rng.randint(1, 7)
        tw = int(W / rng.uniform(n + 0.5, n + 3))
        th = int(tw * FACE_H_OVER_W * rng.uniform(0.92, 1.12))
        gap_px = int(tw * rng.uniform(0, 0.1))
        place_row(rng, sample_classes(rng, n, bonus_p=0.15), rng.uniform(0, max(1, W - n * (tw + gap_px))), rng.uniform(0, max(1, H - th)), tw, th, gap_px, 0.05, 6, tiles)
    else:  # scatter
        n = rng.randint(1, 12)
        tw = int(W / rng.uniform(6, 16))
        th = int(tw * FACE_H_OVER_W)
        tries = 0
        while len(tiles) < n and tries < 200:
            tries += 1
            x, y = rng.uniform(0, W - tw), rng.uniform(0, H - th)
            if all(abs(x - t["x"]) > tw * 0.9 or abs(y - t["y"]) > th * 0.9 for t in tiles):
                tiles.append(dict(cls=sample_classes(rng, 1, bonus_p=0.15)[0], x=x, y=y, w=tw, h=th, angle=rng.uniform(-180, 180)))
    return tiles


# ---------------------------------------------------------------- augmentation
def photometric(img, rng):
    img = img.astype(np.float32)
    gains = np.array([rng.uniform(0.85, 1.15) for _ in range(3)], np.float32)
    img = img * gains[None, None, :]
    img = img * rng.uniform(0.6, 1.35) + rng.uniform(-35, 35)
    if rng.random() < 0.5:
        g = rng.uniform(0.7, 1.4)
        img = 255.0 * np.power(np.clip(img, 0, 255) / 255.0, g)
    img = np.clip(img, 0, 255)
    if rng.random() < 0.4:  # vignette
        H, W = img.shape[:2]
        ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
        d = np.sqrt(((xs - W / 2) / W) ** 2 + ((ys - H / 2) / H) ** 2)
        img *= (1 - rng.uniform(0.2, 0.6) * d)[..., None]
    if rng.random() < 0.45:  # soft shadow polygon
        H, W = img.shape[:2]
        mask = np.zeros((H, W), np.float32)
        pts = np.array([[rng.uniform(-0.2, 1.2) * W, rng.uniform(-0.2, 1.2) * H] for _ in range(rng.randint(3, 6))], np.int32)
        cv2.fillPoly(mask, [pts], 1.0)
        mask = cv2.GaussianBlur(mask, (0, 0), rng.uniform(5, 40))
        img *= (1 - mask * rng.uniform(0.2, 0.55))[..., None]
    if rng.random() < 0.2:  # glare
        H, W = img.shape[:2]
        glare = np.zeros((H, W), np.float32)
        cv2.ellipse(glare, (rng.randint(0, W), rng.randint(0, H)), (rng.randint(W // 10, W // 3), rng.randint(H // 12, H // 3)), rng.uniform(0, 180), 0, 360, 1.0, -1)
        glare = cv2.GaussianBlur(glare, (0, 0), rng.uniform(10, 50))
        img += (glare * rng.uniform(40, 120))[..., None]
    img = np.clip(img, 0, 255)
    r = rng.random()
    if r < 0.35:
        img = cv2.GaussianBlur(img, (0, 0), rng.uniform(0.3, 1.6))
    elif r < 0.5:
        k = rng.randint(3, 9)
        kern = np.zeros((k, k), np.float32)
        kern[k // 2, :] = 1.0 / k
        M = cv2.getRotationMatrix2D((k / 2 - 0.5, k / 2 - 0.5), rng.uniform(0, 180), 1)
        kern = cv2.warpAffine(kern, M, (k, k))
        kern /= max(kern.sum(), 1e-6)
        img = cv2.filter2D(img, -1, kern)
    if rng.random() < 0.55:
        img += rng.normal(0, rng.uniform(1, 9), size=img.shape).astype(np.float32)
    return np.clip(img, 0, 255).astype(np.uint8)


def occlude(img, boxes, rng):
    """Finger-like occluders; drops labels that are mostly covered."""
    H, W = img.shape[:2]
    keep = [True] * len(boxes)
    for _ in range(rng.randint(1, 3)):
        skin = (rng.randint(150, 230), rng.randint(110, 180), rng.randint(90, 150))
        x, y = rng.randint(0, W), rng.randint(0, H)
        ax, ay = rng.randint(W // 20, W // 5), rng.randint(H // 5, H // 2)
        ang = rng.uniform(0, 180)
        mask = np.zeros((H, W), np.uint8)
        cv2.ellipse(mask, (x, y), (ax, ay), ang, 0, 360, 255, -1)
        img[mask > 0] = np.array(skin, np.uint8)
        for i, (x1, y1, x2, y2) in enumerate(boxes):
            xa, ya, xb, yb = map(int, (max(0, x1), max(0, y1), min(W, x2), min(H, y2)))
            if xb <= xa or yb <= ya:
                continue
            frac = (mask[ya:yb, xa:xb] > 0).mean()
            if frac > 0.55:
                keep[i] = False
    return img, keep


def draw_wall(canvas, W, H, rng):
    """Unlabelled distractor: a wall of edge-on / face-down tiles (coloured back band over an
    ivory body), one or two tiles high, as seen around a mahjong table. Never a tile face."""
    d = ImageDraw.Draw(canvas)
    tw = rng.randint(max(12, W // 30), max(16, W // 10))
    th = int(tw * rng.uniform(0.45, 0.8))
    band = rng.choice([(90, 150, 60), (60, 120, 50), (30, 80, 160), (200, 170, 60), (40, 40, 45), (150, 40, 40)])
    band = tuple(int(v * rng.uniform(0.8, 1.15)) for v in band)
    ivory = (rng.randint(225, 250), rng.randint(222, 248), rng.randint(205, 240))
    split = rng.uniform(0.35, 0.6)
    n = rng.randint(4, 24)
    layers = rng.choice([1, 1, 2])
    vertical = rng.random() < 0.3
    length = n * (tw + 1)
    if vertical:
        x0 = rng.randint(0, max(1, W - th * layers))
        y0 = rng.randint(-length // 2, H - length // 2)
    else:
        x0 = rng.randint(-length // 2, W - length // 2)
        y0 = rng.randint(0, max(1, H - th * layers))
    for layer in range(layers):
        for i in range(n):
            if vertical:
                x1, y1 = x0 + layer * th, y0 + i * (tw + 1)
                x2, y2 = x1 + th, y1 + tw
                bx = x1 + int(th * split)
                d.rectangle([x1, y1, x2, y2], fill=ivory + (255,), outline=(120, 110, 95, 255))
                d.rectangle([x1, y1, bx, y2], fill=band + (255,))
            else:
                x1, y1 = x0 + i * (tw + 1), y0 + layer * th
                x2, y2 = x1 + tw, y1 + th
                by = y1 + int(th * split)
                d.rectangle([x1, y1, x2, y2], fill=ivory + (255,), outline=(120, 110, 95, 255))
                d.rectangle([x1, y1, x2, by], fill=band + (255,))
                if rng.random() < 0.5:  # fine grain lines on the back, like many real sets
                    for gx in range(x1 + 2, x2 - 1, 3):
                        d.line([gx, y1 + 1, gx, by - 1], fill=tuple(int(v * 0.85) for v in band) + (255,))


# ---------------------------------------------------------------- scene
def compose(rng, W, H):
    st = styles()
    weights = {"hk": 2, "riichi": 1, "real": 3, "font": 2, "ymi": 4}
    style_names = [s for s in weights if s in st["faces"] for _ in range(weights[s])]
    style = rng.choice(style_names)
    faces = st["faces"][style]
    bg = make_background(W, H, rng)
    canvas = Image.fromarray(bg.astype(np.uint8)).convert("RGBA")
    tiles = layout(rng, W, H)
    body_cache = {}
    quads = []  # 4 corners per tile in canvas coordinates
    # optional rack / table edge under the main row
    if tiles and rng.random() < 0.4:
        y = max(t["y"] + t["h"] for t in tiles)
        col = tuple(int(v) for v in np.array(rng.choice(PALETTE)) * rng.uniform(0.4, 0.9))
        ImageDraw.Draw(canvas).rectangle([0, int(y) - rng.randint(0, 4), W, int(y) + rng.randint(6, 40)], fill=col + (255,))
    # walls of edge-on tiles (drawn before the hand, so labelled tiles stay on top)
    for _ in range(rng.randint(1, 2) if rng.random() < 0.4 else 0):
        draw_wall(canvas, W, H, rng)
    # face-down distractors
    for _ in range(rng.randint(0, 2) if rng.random() < 0.3 else 0):
        tw = rng.randint(W // 16, W // 6)
        th = int(tw * FACE_H_OVER_W)
        back = st["back"].resize((tw, th), Image.LANCZOS).rotate(rng.uniform(-180, 180), expand=True, resample=Image.BICUBIC)
        canvas.alpha_composite(back, (rng.randint(-tw // 2, W - tw // 2), rng.randint(-th // 2, H - th // 2)))
    for t in tiles:
        w, h = int(t["w"]), int(t["h"])
        key = (w, h)
        if key not in body_cache:
            body_cache[key] = None if style in FULL_TILE_STYLES else make_body(w, h, rng, st["front"])
        face = faces[t["cls"]]
        if isinstance(face, list):
            face = rng.choice(face)
        if t["cls"] == 33 and style not in FULL_TILE_STYLES and rng.random() < 0.5:
            face = frame_face(rng)
        tile = render_tile(face, w, h, rng, body_cache[key])
        ang = t["angle"]
        rot = tile.rotate(ang, expand=True, resample=Image.BICUBIC)
        cx, cy = t["x"] + w / 2, t["y"] + h / 2
        px, py = int(round(cx - rot.width / 2)), int(round(cy - rot.height / 2))
        # drop shadow
        if rng.random() < 0.6:
            sh = Image.new("RGBA", rot.size, (0, 0, 0, 0))
            sh.putalpha(rot.getchannel("A").point(lambda a: int(a * 0.45)))
            sh = sh.filter(ImageFilter.GaussianBlur(max(1, w * 0.04)))
            canvas.alpha_composite(sh, (px + int(w * 0.04), py + int(h * 0.05)))
        canvas.alpha_composite(rot, (px, py))
        a = math.radians(-ang)
        corners = []
        for dx, dy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
            corners.append((cx + dx * math.cos(a) - dy * math.sin(a), cy + dx * math.sin(a) + dy * math.cos(a)))
        quads.append((t["cls"], corners))
    img = np.asarray(canvas.convert("RGB"))
    # global perspective / rotation
    src = np.float32([[0, 0], [W, 0], [W, H], [0, H]])
    k = rng.uniform(0.0, 0.12)
    dst = src + np.float32([[rng.uniform(-k, k) * W, rng.uniform(-k, k) * H] for _ in range(4)])
    if rng.random() < 0.7:
        M = cv2.getPerspectiveTransform(src, dst)
        ang = rng.uniform(-10, 10)
        R = cv2.getRotationMatrix2D((W / 2, H / 2), ang, rng.uniform(0.85, 1.1))
        R = np.vstack([R, [0, 0, 1]]).astype(np.float32)
        M = R @ M
        border = tuple(int(v) for v in bg.reshape(-1, 3).mean(0))
        img = cv2.warpPerspective(img, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=border)
    else:
        M = np.eye(3, dtype=np.float32)
    boxes, labels = [], []
    for cls, corners in quads:
        pts = cv2.perspectiveTransform(np.float32([corners]).reshape(-1, 1, 2), M).reshape(-1, 2)
        x1, y1 = pts.min(0)
        x2, y2 = pts.max(0)
        full = (x2 - x1) * (y2 - y1)
        cx1, cy1, cx2, cy2 = max(0, x1), max(0, y1), min(W, x2), min(H, y2)
        if cx2 <= cx1 or cy2 <= cy1:
            continue
        vis = (cx2 - cx1) * (cy2 - cy1) / max(full, 1e-6)
        if vis < 0.45 or (cx2 - cx1) < 8 or (cy2 - cy1) < 8:
            continue
        boxes.append((cx1, cy1, cx2, cy2))
        labels.append(cls)
    img = np.array(img, copy=True)
    keep = [True] * len(boxes)
    if boxes and rng.random() < 0.3:
        img, keep = occlude(img, boxes, rng)
    img = photometric(img, rng)
    out = [(c, b) for c, b, k in zip(labels, boxes, keep) if k]
    return img, out


SIZES = [(640, 480), (480, 640), (640, 640), (720, 405), (405, 720), (576, 768), (768, 576)]


def make_one(args):
    idx, split, out_dir, seed, bonus_p = args
    global BONUS_P
    BONUS_P = bonus_p  # workers are spawned, so the flag travels with the job
    rng = random.Random(seed)
    np_rng = np.random.default_rng(seed)
    # bridge numpy rng into helper functions expecting .uniform/.normal with size
    class R(random.Random):
        pass
    r = R(seed)
    r.normal = np_rng.normal  # type: ignore[attr-defined]
    _orig_uniform = r.uniform
    def uniform(a, b, size=None):
        return np_rng.uniform(a, b, size=size) if size is not None else _orig_uniform(a, b)
    r.uniform = uniform  # type: ignore[assignment]
    W, H = rng.choice(SIZES)
    img, labels = compose(r, W, H)
    q = rng.randint(45, 95)
    img_path = out_dir / "images" / split / f"{idx:06d}.jpg"
    lbl_path = out_dir / "labels" / split / f"{idx:06d}.txt"
    cv2.imwrite(str(img_path), cv2.cvtColor(img, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, q])
    with open(lbl_path, "w") as f:
        for cls, (x1, y1, x2, y2) in labels:
            f.write(f"{cls} {(x1 + x2) / 2 / W:.6f} {(y1 + y2) / 2 / H:.6f} {(x2 - x1) / W:.6f} {(y2 - y1) / H:.6f}\n")
    return len(labels)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "data" / "synth"))
    ap.add_argument("--train", type=int, default=6000)
    ap.add_argument("--val", type=int, default=400)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--bonus-p", type=float, default=0.06, help="probability a hand slot is a flower/season")
    a = ap.parse_args()
    out = Path(a.out)
    for split in ("train", "val"):
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)
    jobs = [(i, "train", out, a.seed * 1_000_000 + i, a.bonus_p) for i in range(a.train)] + [(i, "val", out, a.seed * 1_000_000 + 900_000 + i, a.bonus_p) for i in range(a.val)]
    total = 0
    with ProcessPoolExecutor(a.workers) as ex:
        for n, k in enumerate(ex.map(make_one, jobs, chunksize=16)):
            total += k
            if n % 500 == 0:
                print(f"{n}/{len(jobs)} images, {total} boxes", flush=True)
    names = "\n".join(f"  {i}: {c}" for i, c in enumerate(CLASSES))
    (out / "data.yaml").write_text(f"path: {out}\ntrain: images/train\nval: images/val\nnames:\n{names}\n")
    print(f"done: {len(jobs)} images, {total} boxes -> {out / 'data.yaml'}")


if __name__ == "__main__":
    main()
