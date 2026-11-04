#!/usr/bin/env bash
# Plugin-Test unter Linux: baut den Plugin-Code gegen den Test-Ersatz der EuroScope-Schnittstelle,
# startet ihn mit Verkehr aus der Simulation und prueft den AMAN im Browser im Plugin-Modus.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$(mktemp -d)}"
WORK="$(mktemp -d)"
"$ROOT/tests/plugin/build.sh" "$WORK/harness" -DAMAN_VERSION="\"$(cat "$ROOT/VERSION")\"" -DAMAN_UPDATE_BASE="\"http://127.0.0.1:1/none\""
node "$ROOT/tests/plugin/feed.js" "$WORK/traffic.txt" 1 & FEED=$!
sleep 2
# Ordner wie im echten Einsatz: DLL-Ordner mit Unterordner web
mkdir -p "$WORK/plugin"
cp -r "$ROOT/web" "$WORK/plugin/"
"$WORK/harness" "$WORK/plugin" "$WORK/traffic.txt" > "$WORK/harness.log" 2>&1 & HAR=$!
# Sync-Server (V2) mit einem VATSIM-Feed aus einer Datei: online ist nur EDDM_N_APP
SYNC_PORT="${AMAN_SYNC_PORT:-8474}"
echo '{"controllers":[{"callsign":"EDDM_N_APP","facility":5}]}' > "$WORK/feed.json"
PORT=$SYNC_PORT DATA="$WORK/plan.json" FEED_FILE="$WORK/feed.json" node "$ROOT/server/node.mjs" > "$WORK/sync.log" 2>&1 & SYNC=$!
export AMAN_SYNC_URL="ws://127.0.0.1:$SYNC_PORT/ws" AMAN_FEED_FILE="$WORK/feed.json"
trap 'kill $FEED $HAR $SYNC 2>/dev/null || true' EXIT
sleep 6
node "$ROOT/tests/plugin/e2e.js" "$WORK/traffic.txt" "$HAR" "$OUT"
echo "--- EuroScope-Meldungen des Plugins:"; cat "$WORK/harness.log"
