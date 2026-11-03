#!/usr/bin/env bash
# Baut den Plugin-Code gegen den Test-Ersatz der EuroScope-Schnittstelle. Aufruf: build.sh <ausgabe> [weitere g++-Optionen]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$1"; shift
gcc -O1 -c "$ROOT/plugin/src/uecc_build.c" -o "$OUT.uecc.o"
g++ -std=c++17 -Wall -Wextra -Werror -O1 -I "$ROOT/tests/plugin/es_stub" -I "$ROOT/plugin/src" \
  "$ROOT/plugin/src/AmanPlugin.cpp" "$ROOT/plugin/src/HttpServer.cpp" "$ROOT/plugin/src/PluginMain.cpp" "$ROOT/plugin/src/Updater.cpp" \
  "$ROOT/plugin/src/Signature.cpp" "$OUT.uecc.o" \
  -DAMAN_TEST_BUILD "$@" "$ROOT/tests/plugin/harness.cpp" -lpthread -o "$OUT"
