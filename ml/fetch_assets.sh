#!/bin/sh
# Fetches the CC0 tile artwork used by gen_synthetic.py (not committed to this repo).
set -e
cd "$(dirname "$0")/assets"
[ -d samoheen ] || git clone --depth 1 https://github.com/samoheen/mahjong-tiles.git samoheen
[ -d fluffystuff ] || git clone --depth 1 https://github.com/FluffyStuff/riichi-mahjong-tiles.git fluffystuff
echo "assets ready: $(ls -d samoheen fluffystuff | tr '\n' ' ')"
