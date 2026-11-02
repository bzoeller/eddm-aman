#!/usr/bin/env bash
# Plugin-Test unter Linux: baut den Plugin-Code gegen den Test-Ersatz der EuroScope-Schnittstelle,
# startet ihn mit Verkehr aus der Simulation und prueft den AMAN im Browser im Plugin-Modus.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$(mktemp -d)}"
WORK="$(mktemp -d)"
g++ -std=c++17 -Wall -Wextra -Werror -O1 -I "$ROOT/tests/plugin/es_stub" -I "$ROOT/plugin/src" \
  "$ROOT/plugin/src/AmanPlugin.cpp" "$ROOT/plugin/src/HttpServer.cpp" "$ROOT/plugin/src/PluginMain.cpp" \
  "$ROOT/tests/plugin/harness.cpp" -lpthread -o "$WORK/harness"
node "$ROOT/tests/plugin/feed.js" "$WORK/traffic.txt" 1 & FEED=$!
sleep 2
"$WORK/harness" "$ROOT" "$WORK/traffic.txt" > "$WORK/harness.log" 2>&1 & HAR=$!
trap 'kill $FEED $HAR 2>/dev/null || true' EXIT
sleep 6
node "$ROOT/tests/plugin/e2e.js" "$WORK/traffic.txt" "$HAR" "$OUT"
echo "--- EuroScope-Meldungen des Plugins:"; cat "$WORK/harness.log"
