#!/usr/bin/env bash
# Test des Plugin-Updaters unter Linux: ein lokaler Server spielt GitHub-Releases mit Version 9.9.9.
# Prueft: Webseite und DLL werden ersetzt, falsche Pruefsumme verwirft das Update, alte DLL wird beim naechsten Start entfernt.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"; fails=0
UPORT="${AMAN_UPDATE_PORT:-8098}"   # Port des Test-Release-Servers
ok() { if [ "$1" = 1 ]; then echo "PASS $2"; else echo "FAIL $2"; fails=$((fails+1)); fi; }
# Test-Schluesselpaar fuer die Update-Signatur (wie beim Release, nur mit eigenem Schluessel)
node -e "
const c=require('crypto'),fs=require('fs');const {privateKey,publicKey}=c.generateKeyPairSync('ec',{namedCurve:'P-256'});
const j=publicKey.export({format:'jwk'});
fs.writeFileSync(process.argv[1]+'/pub.txt',Buffer.concat([Buffer.from(j.x,'base64url'),Buffer.from(j.y,'base64url')]).toString('hex'));
fs.writeFileSync(process.argv[1]+'/priv.b64',privateKey.export({format:'der',type:'pkcs8'}).toString('base64'));
const o=c.generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey;
fs.writeFileSync(process.argv[1]+'/other.b64',o.export({format:'der',type:'pkcs8'}).toString('base64'));" "$WORK"
"$ROOT/tests/plugin/build.sh" "$WORK/harness" -DAMAN_VERSION="\"1.0.0\"" -DAMAN_UPDATE_PUBKEY="\"$(cat "$WORK/pub.txt")\""
sign() {  # Liste signieren wie im Release-Workflow; $1 = anderer (falscher) Schluessel
  local k="$WORK/priv.b64"; [ "${1:-}" = other ] && k="$WORK/other.b64"
  if [ "${1:-}" = other ]; then  # falscher Schluessel: Signatur von Hand, das Release-Skript wuerde ihn ablehnen
    node -e "const c=require('crypto'),fs=require('fs');const k=c.createPrivateKey({key:Buffer.from(fs.readFileSync(process.argv[1],'utf8'),'base64'),format:'der',type:'pkcs8'});fs.writeFileSync(process.argv[3],c.sign('sha256',fs.readFileSync(process.argv[2]),{key:k,dsaEncoding:'ieee-p1363'}).toString('hex'))" "$k" "$WORK/srv/releases/latest/download/manifest.txt" "$WORK/srv/releases/latest/download/manifest.sig"
  else
    UPDATE_SIGNING_KEY="$(cat "$k")" node "$ROOT/tools/sign-manifest.mjs" "$WORK/srv/releases/latest/download/manifest.txt" "$WORK/pub.txt" > /dev/null
  fi
}

release() {  # $1 = Pruefsumme der DLL ueberschreiben (bad) oder leer
  rm -rf "$WORK/srv"; mkdir -p "$WORK/srv/releases/latest/download" "$WORK/srv/releases/download/v9.9.9"
  echo "NEUE DLL 9.9.9" > "$WORK/srv/releases/download/v9.9.9/EDDM-AMAN.dll"
  echo "<title>neu 9.9.9</title>" > "$WORK/srv/releases/download/v9.9.9/index.html"
  local dsum isum; dsum=$(sha256sum "$WORK/srv/releases/download/v9.9.9/EDDM-AMAN.dll" | cut -c1-64); isum=$(sha256sum "$WORK/srv/releases/download/v9.9.9/index.html" | cut -c1-64)
  [ "${1:-}" = bad ] && dsum=$(printf '0%.0s' {1..64})
  printf 'version 9.9.9\nweb index.html %s\ndll EDDM-AMAN.dll %s\n' "$isum" "$dsum" > "$WORK/srv/releases/latest/download/manifest.txt"
  sign
}
setup_plugin() {
  rm -rf "$WORK/plugin"; mkdir -p "$WORK/plugin"
  cp -r "$ROOT/web" "$WORK/plugin/"
  echo "ALTE DLL 1.0.0" > "$WORK/plugin/EDDM-AMAN.dll"
  : > "$WORK/traffic.txt"
}
run_plugin() {  # laeuft 6 s
  ( cd "$WORK" && AMAN_UPDATE_BASE="http://127.0.0.1:$UPORT/releases" timeout 6 "$WORK/harness" "$WORK/plugin" "$WORK/traffic.txt" > "$WORK/log.txt" 2>&1 ) || true
}
( cd "$WORK" && exec python3 -m http.server $UPORT -d "$WORK/srv" > /dev/null 2>&1 ) & SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
mkdir -p "$WORK/srv"; sleep 1

# 1) falsche Pruefsumme: nichts darf ersetzt werden
release bad; setup_plugin; run_plugin
ok "$(grep -q 'checksum of EDDM-AMAN.dll wrong' "$WORK/log.txt" && grep -q 'ALTE DLL' "$WORK/plugin/EDDM-AMAN.dll" && ! grep -q 'neu 9.9.9' "$WORK/plugin/web/index.html" && [ ! -e "$WORK/plugin/web/index.html.new" ] && echo 1 || echo 0)" "falsche Pruefsumme: Update verworfen, nichts ersetzt, nichts Halbes liegen geblieben"

# 1b) Signatur fehlt, ist von einem fremden Schluessel oder die Liste wurde danach veraendert: nichts passiert
unchanged() { grep -q 'ALTE DLL' "$WORK/plugin/EDDM-AMAN.dll" && ! grep -q 'neu 9.9.9' "$WORK/plugin/web/index.html"; }
release; rm "$WORK/srv/releases/latest/download/manifest.sig"; setup_plugin; run_plugin
ok "$(grep -q 'signature missing' "$WORK/log.txt" && unchanged && echo 1 || echo 0)" "Signatur fehlt: Update abgelehnt"
release; sign other; setup_plugin; run_plugin
ok "$(grep -q 'signature invalid' "$WORK/log.txt" && unchanged && echo 1 || echo 0)" "Signatur mit fremdem Schluessel: Update abgelehnt"
release; echo "web app.js $(printf '1%.0s' {1..64})" >> "$WORK/srv/releases/latest/download/manifest.txt"; setup_plugin; run_plugin
ok "$(grep -q 'signature invalid' "$WORK/log.txt" && unchanged && echo 1 || echo 0)" "Liste nach dem Signieren veraendert: Update abgelehnt"
ok "$(UPDATE_SIGNING_KEY="$(cat "$WORK/other.b64")" node "$ROOT/tools/sign-manifest.mjs" "$WORK/srv/releases/latest/download/manifest.txt" "$WORK/pub.txt" > /dev/null 2>&1 && echo 0 || echo 1)" "Release-Skript lehnt einen Schluessel ab, der nicht zum eingebauten passt"

# 2) gueltiges Update
release; setup_plugin; run_plugin
ok "$(grep -q 'updated to 9.9.9' "$WORK/log.txt" && echo 1 || echo 0)" "Meldung in EuroScope: updated to 9.9.9"
ok "$(grep -q 'neu 9.9.9' "$WORK/plugin/web/index.html" && echo 1 || echo 0)" "Webseite ersetzt"
ok "$(grep -q 'NEUE DLL' "$WORK/plugin/EDDM-AMAN.dll" && grep -q 'ALTE DLL' "$WORK/plugin/EDDM-AMAN.dll.old" && echo 1 || echo 0)" "DLL ersetzt, alte als .old daneben"
ok "$( [ -z "$(ls "$WORK/plugin" "$WORK/plugin/web" | grep '\.new$' || true)" ] && echo 1 || echo 0)" "keine halbfertigen .new-Dateien uebrig"

# 3) naechster Start: .old wird entfernt (Version gleich -> kein erneutes Update noetig, Harness meldet 1.0.0 aber Manifest 9.9.9 -> wuerde erneut laden; daher Manifest auf 1.0.0)
printf 'version 1.0.0\ndll EDDM-AMAN.dll %s\n' "$(printf '0%.0s' {1..64})" > "$WORK/srv/releases/latest/download/manifest.txt"
sign; run_plugin
ok "$( [ ! -e "$WORK/plugin/EDDM-AMAN.dll.old" ] && echo 1 || echo 0)" "naechster Start: alte DLL entfernt"
ok "$(! grep -q 'updated to' "$WORK/log.txt" && echo 1 || echo 0)" "gleiche Version: kein Update"

echo "--- Meldungen:"; cat "$WORK/log.txt"
[ $fails = 0 ] && echo "alles gruen" || { echo "$fails Fehler"; exit 1; }
