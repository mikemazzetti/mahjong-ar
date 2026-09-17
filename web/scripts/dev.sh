#!/bin/sh
# Starts the dev server on port 443 (macOS lets ordinary users bind it), so the phone
# address is just https://<mac-ip>/ and, on macOS, https://mahjong.local/ (Bonjour name).
# Use PORT=5173 npm run dev for a different port.
cd "$(dirname "$0")/.." || exit 1
port=${PORT:-443}
suffix=""
[ "$port" = 443 ] || suffix=":$port"
ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
if [ -n "$ip" ] && command -v dns-sd >/dev/null 2>&1; then
  dns-sd -P Mahjong _https._tcp local "$port" mahjong.local "$ip" >/dev/null 2>&1 &
  advertiser=$!
  trap 'kill "$advertiser" 2>/dev/null' EXIT INT TERM
  echo "  ➜  Phone:   https://mahjong.local$suffix/  (also https://$ip$suffix/)"
fi
npx vite --host --port "$port" --strictPort "$@"
