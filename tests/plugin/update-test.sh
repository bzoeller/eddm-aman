#!/usr/bin/env bash
# Test des Plugin-Updaters unter Linux: ein lokaler Server spielt GitHub-Releases mit Version 9.9.9.
# Prueft: Webseite und DLL werden ersetzt, falsche Pruefsumme verwirft das Update, alte DLL wird beim naechsten Start entfernt.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"; fails=0
ok() { if [ "$1" = 1 ]; then echo "PASS $2"; else echo "FAIL $2"; fails=$((fails+1)); fi; }
g++ -std=c++17 -Wall -Wextra -Werror -O1 -I "$ROOT/tests/plugin/es_stub" -I "$ROOT/plugin/src" \
  "$ROOT/plugin/src/AmanPlugin.cpp" "$ROOT/plugin/src/HttpServer.cpp" "$ROOT/plugin/src/PluginMain.cpp" "$ROOT/plugin/src/Updater.cpp" \
  -DAMAN_VERSION="\"1.0.0\"" "$ROOT/tests/plugin/harness.cpp" -lpthread -o "$WORK/harness"

release() {  # $1 = Pruefsumme der DLL ueberschreiben (bad) oder leer
  rm -rf "$WORK/srv"; mkdir -p "$WORK/srv/releases/latest/download" "$WORK/srv/releases/download/v9.9.9"
  echo "NEUE DLL 9.9.9" > "$WORK/srv/releases/download/v9.9.9/EDDM-AMAN.dll"
  echo "<title>neu 9.9.9</title>" > "$WORK/srv/releases/download/v9.9.9/index.html"
  local dsum isum; dsum=$(sha256sum "$WORK/srv/releases/download/v9.9.9/EDDM-AMAN.dll" | cut -c1-64); isum=$(sha256sum "$WORK/srv/releases/download/v9.9.9/index.html" | cut -c1-64)
  [ "${1:-}" = bad ] && dsum=$(printf '0%.0s' {1..64})
  printf 'version 9.9.9\nweb index.html %s\ndll EDDM-AMAN.dll %s\n' "$isum" "$dsum" > "$WORK/srv/releases/latest/download/manifest.txt"
}
setup_plugin() {
  rm -rf "$WORK/plugin"; mkdir -p "$WORK/plugin/web"
  cp "$ROOT"/index.html "$ROOT"/app.js "$ROOT"/aman-core.js "$ROOT"/aman-sim.js "$ROOT"/eddm.json "$ROOT"/style.css "$WORK/plugin/web/"
  echo "ALTE DLL 1.0.0" > "$WORK/plugin/EDDM-AMAN.dll"
  : > "$WORK/traffic.txt"
}
run_plugin() {  # laeuft 6 s
  ( cd "$WORK" && AMAN_UPDATE_BASE="http://127.0.0.1:8098/releases" timeout 6 "$WORK/harness" "$WORK/plugin" "$WORK/traffic.txt" > "$WORK/log.txt" 2>&1 ) || true
}
( cd "$WORK" && exec python3 -m http.server 8098 -d "$WORK/srv" > /dev/null 2>&1 ) & SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
mkdir -p "$WORK/srv"; sleep 1

# 1) falsche Pruefsumme: nichts darf ersetzt werden
release bad; setup_plugin; run_plugin
ok "$(grep -q 'checksum of EDDM-AMAN.dll wrong' "$WORK/log.txt" && grep -q 'ALTE DLL' "$WORK/plugin/EDDM-AMAN.dll" && ! grep -q 'neu 9.9.9' "$WORK/plugin/web/index.html" && [ ! -e "$WORK/plugin/web/index.html.new" ] && echo 1 || echo 0)" "falsche Pruefsumme: Update verworfen, nichts ersetzt, nichts Halbes liegen geblieben"

# 2) gueltiges Update
release; setup_plugin; run_plugin
ok "$(grep -q 'updated to 9.9.9' "$WORK/log.txt" && echo 1 || echo 0)" "Meldung in EuroScope: updated to 9.9.9"
ok "$(grep -q 'neu 9.9.9' "$WORK/plugin/web/index.html" && echo 1 || echo 0)" "Webseite ersetzt"
ok "$(grep -q 'NEUE DLL' "$WORK/plugin/EDDM-AMAN.dll" && grep -q 'ALTE DLL' "$WORK/plugin/EDDM-AMAN.dll.old" && echo 1 || echo 0)" "DLL ersetzt, alte als .old daneben"
ok "$( [ -z "$(ls "$WORK/plugin" "$WORK/plugin/web" | grep '\.new$' || true)" ] && echo 1 || echo 0)" "keine halbfertigen .new-Dateien uebrig"

# 3) naechster Start: .old wird entfernt (Version gleich -> kein erneutes Update noetig, Harness meldet 1.0.0 aber Manifest 9.9.9 -> wuerde erneut laden; daher Manifest auf 1.0.0)
printf 'version 1.0.0\ndll EDDM-AMAN.dll %s\n' "$(printf '0%.0s' {1..64})" > "$WORK/srv/releases/latest/download/manifest.txt"
run_plugin
ok "$( [ ! -e "$WORK/plugin/EDDM-AMAN.dll.old" ] && echo 1 || echo 0)" "naechster Start: alte DLL entfernt"
ok "$(! grep -q 'updated to' "$WORK/log.txt" && echo 1 || echo 0)" "gleiche Version: kein Update"

echo "--- Meldungen:"; cat "$WORK/log.txt"
[ $fails = 0 ] && echo "alles gruen" || { echo "$fails Fehler"; exit 1; }
