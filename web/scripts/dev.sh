#!/bin/sh
# Starts the dev server and, on macOS, advertises it on the local network as
# https://mahjong.local:5173 (Bonjour proxy record; no admin rights needed).
cd "$(dirname "$0")/.." || exit 1
ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
if [ -n "$ip" ] && command -v dns-sd >/dev/null 2>&1; then
  dns-sd -P Mahjong _https._tcp local 5173 mahjong.local "$ip" >/dev/null 2>&1 &
  advertiser=$!
  trap 'kill "$advertiser" 2>/dev/null' EXIT INT TERM
  echo "  ➜  Phone:   https://mahjong.local:5173/  (also https://$ip:5173/)"
fi
npx vite --host "$@"
