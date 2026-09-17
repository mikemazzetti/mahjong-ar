# Mahjong Fan Planner (AR web app)

Point your phone camera at your Hong Kong mahjong tiles, choose the minimum fan your
table plays, and see ranked ways to reach it: which pattern to aim for, what to discard,
which tiles to draw, and how many tiles away each option is. Everything runs on the
phone (offline PWA); tile recognition uses a small YOLO model in the browser via
ONNX Runtime Web.

```
web/   Vite + TypeScript PWA
  src/engine/tiles.ts     tile ids, parsing, names
  src/engine/shanten.ts   constrained "tiles away" calculator (shape, suit mask, forced sets)
  src/engine/scoring.ts   Hong Kong fan scoring for complete hands (configurable RuleSet)
  src/engine/planner.ts   enumerates target patterns, ranks options, discards/draws
  src/vision/detector.ts  ONNX Runtime Web YOLO inference, NMS, stabiliser
  src/vision/camera.ts    rear camera
  src/main.ts             UI
  test/engine.test.ts     vitest suite for the engine
ml/    synthetic data generation, training, export
  gen_synthetic.py        renders public-domain tile faces into photo-like scenes (YOLO labels)
  train.py                Ultralytics YOLO11n training (Apple MPS)
  export.py               exports best.pt -> web/public/models/tiles.onnx
```

## Run the app

```bash
cd web
npm install          # also copies ONNX Runtime wasm files into public/ort
npm run dev          # https://mahjong.local/ on the phone (or https://<your-mac-ip>/)
```

`npm run dev` serves on port 443, so the phone address needs no port number (macOS lets
ordinary users bind it; use `PORT=5173 npm run dev` elsewhere). On macOS it also
advertises the server under the Bonjour name `mahjong.local` (some routers do not pass
Bonjour between wired and Wi-Fi devices; the IP address always works). On the phone,
"Add to Home Screen" installs the app so no address has to be typed at all.
Camera access needs HTTPS. Without a certificate the dev server falls back to a
self-signed one (accept it on the phone; the browser keeps showing "Not Secure").
`npm run dev:http` serves plain HTTP on port 5174 for desktop testing without a camera.
`npm run build` produces an installable offline PWA in `web/dist` (serve it over HTTPS).

### HTTPS without warnings (phone on the same Wi-Fi)

`web/certs/dev.pem` + `dev-key.pem` (git-ignored) are picked up automatically by the dev
and preview servers. Create them once with [mkcert](https://github.com/FiloSottile/mkcert):

```bash
brew install mkcert
cd web && mkdir -p certs
mkcert -cert-file certs/dev.pem -key-file certs/dev-key.pem <your-mac-ip> localhost 127.0.0.1 ::1
cp "$(mkcert -CAROOT)/rootCA.pem" public/rootCA.pem      # served for the phone to download
mkcert -install                                          # (optional) trust it on the Mac too
```

Then trust the certificate authority on the phone, once:

- **iPhone**: open `http://<your-mac-ip>:5174/rootCA.pem` in Safari (start `npm run dev:http`
  first) and tap Allow. Settings > General > VPN & Device Management > "mkcert …" > Install.
  Then Settings > General > About > Certificate Trust Settings > enable full trust for it.
- **Android**: download the same file, then Settings > Security > Encryption & credentials >
  Install a certificate > CA certificate.

Re-run the `mkcert -cert-file …` command if the Mac's IP address changes (add the new one).

**No phone setup at all**: a public tunnel gives the dev server a real, trusted HTTPS address
(`brew install cloudflared`, then `npm run tunnel` while `npm run dev` is running; open the
`https://….trycloudflare.com` URL it prints). Both devices need internet, the URL changes on
every run, and anyone who guesses it can reach the app while the tunnel is up. The installed
PWA keeps working offline afterwards.

### Scanning

Start the camera and hold the phone over the tiles. Boxes whose size does not match the
other tiles (cards, boxes, chips) are ignored, and a second pass zooms into the area with
the tiles so small or faint faces (white dragons) are read. When 13 or 14 tiles have read
the same for a second the scan locks by itself: the frame freezes, the tiles go into your
hand and the options appear. Fix any misread tile by tapping it and picking the right one,
or tap Rescan. "Photo…" analyses a picture from the camera roll the same way.

Rules button: minimum fan, limit (10 or 13), seat wind, prevailing wind, Seven Pairs,
detector confidence. The minimum fan is also editable in the top bar.

No model yet? The app still works: type tiles (`123m 456p 77s EEE C f1`) or tap the picker.

Dev helpers: `npm run preview:http` serves the production build on port 4174 over HTTP, and
`?img=/samples/photo.jpg` in the URL analyses an image from `web/public/samples` without
the file picker (handy for testing the detector on a desktop).

## Tile recognition model

```bash
cd ml
python3.10 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
sh fetch_assets.sh                                  # clones the CC0 tile artwork into ml/assets
python gen_synthetic.py --train 6000 --val 400      # ~2 min, ml/data/synth
python train.py --epochs 20 --batch 8 --imgsz 512   # ~2 h on an M3 with 8 GB
python export.py --imgsz 512                        # writes web/public/models/tiles.onnx
```

`python eval_fullset.py --weights runs/<run>/weights/best.pt` scores a checkpoint on the
untouched full-set photo in `ml/data/real` (per-suit recall proxy), and `predict.py`
writes annotated copies of any images to `ml/data/pred`.

Classes 0..41 follow `web/src/engine/tiles.ts`: characters 1-9, dots 1-9, bamboo 1-9,
E S W N, red/green/white dragon, flowers 1-4 (plum, orchid, chrysanthemum, bamboo),
seasons 1-4 (spring, summer, autumn, winter).

The synthetic set uses CC0 artwork (samoheen/mahjong-tiles for the Hong Kong faces
including flowers and seasons, FluffyStuff/riichi-mahjong-tiles as a second style),
the Unicode Mahjong Tiles glyphs of the system font "Apple Symbols" (a fourth calligraphic
style, rendered on the fly), photographic tile faces cropped by `ml/extract_real_faces.py`
from "Mahjong eg HK.jpg" on Wikimedia Commons (Cangjie6, CC BY-SA 4.0), and the faces of
the set actually used at our table (Yellow Mountain Imports "Rouge Heritage"), cropped by
`ml/extract_ymi_faces.py` from the product photo in `ml/data/ymi` (© Yellow Mountain
Imports; kept out of git, for our own training only). `ml/make_combo.py` samples a
balanced training list across the generated sets, because Ultralytics' `fraction` only
keeps the first files of a sorted list.
Accuracy on real photos improves a lot by adding real labelled photos. Roboflow
Universe hosts two suitable public datasets ("Mahjong Vision", 43 classes, public
domain; "Chinese Mahjong Detection", 42 classes, CC BY 4.0) that require a free
Roboflow account to export in YOLO format; remap their class names to the order above,
merge with `ml/data/synth`, and re-run `train.py`.

### Current model (2026-09-17)

`web/public/models/tiles.onnx` is YOLO11n trained in four stages: 7 epochs on synthetic
scenes (`ml/runs/tiles`), 14 epochs on regenerated scenes with photographic tile crops
(`ml/runs/tiles2`), 8 epochs on a balanced mix that adds the font-rendered style and our
own set's faces (`ml/runs/tiles3`, `ml/data/combo3.yaml`), and 4 epochs with walls of
edge-on tiles as unlabelled distractors (`ml/runs/tiles4`, `ml/data/combo4.yaml`).
Exported at 640 px. With the app's two-pass detection it recovers 127 of 144 tiles on the
untouched full-set photo in `ml/data/real` (a different brand of tiles) and 13 of 16
scattered tiles on a product photo of our own set, with wall tiles almost never read as
tiles any more. Known weak spots: flower/season numbers, and rotated tiles.
In the browser it runs in about 100 ms per frame on WebGPU and a few hundred ms on
WebAssembly (two passes per frame when tiles are found).

To fine-tune again after changing the generator:

```bash
python gen_synthetic.py --out data/synth5 --train 2000 --val 150 --seed 5 --bonus-p 0.1
python make_combo.py --out data/combo4.yaml synth=1000 synth3=1000 synth4=2000 synth5=2000 --val synth3 synth4 synth5
python train.py --model runs/tiles3/weights/best.pt --data data/combo4.yaml --name tiles4 --epochs 4 --batch 8 --imgsz 512
python export.py --weights runs/tiles4/weights/best.pt --imgsz 640
```

## Scoring rules (defaults, all adjustable in `DEFAULT_RULES`)

Common Hand 1, All Triplets 3, Mixed One Suit 3, All One Suit 7, Mixed Orphans +1,
Small Three Dragons 5, Great Three Dragons 8, Small Four Winds 6, Great Four Winds 13,
All Honors 10, Seven Pairs 4 (optional), Thirteen Orphans 13, Nine Gates 10,
Four Concealed Triplets 10, All Kongs 13, dragon / seat wind / prevailing wind triplet 1
each, self-draw 1, concealed hand 1, no flowers 1, seat flower/season 1, all four
flowers or seasons 2, robbing the kong / last tile / kong replacement 1. Limit 13.

## Tests

```bash
cd web && npm test
```
