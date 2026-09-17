#!/bin/sh
# Makes the dev server reachable without a port number (https://<mac-ip>/ and
# https://mahjong.local/) by forwarding port 443 to 5173 with the macOS packet filter.
# Needs admin rights and must be re-run after a reboot:
#     sudo sh scripts/port443.sh
# To undo:  sudo pfctl -f /etc/pf.conf
set -e
ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
[ -n "$ip" ] || { echo "No LAN address found"; exit 1; }
printf 'rdr pass inet proto tcp from any to %s port 443 -> %s port 5173\n' "$ip" "$ip" | pfctl -ef - 2>/dev/null
echo "Forwarding https://$ip/ (and https://mahjong.local/) to port 5173 until the next reboot."
