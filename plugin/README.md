# EDDM AMAN – EuroScope-Plugin

Das Plugin liest alle 5 Sekunden den Anflugverkehr nach EDDM aus EuroScope und stellt ihn dem AMAN bereit. Es startet dafür einen kleinen Webserver, der nur auf deinem eigenen Rechner erreichbar ist (127.0.0.1, Port 8471).

- `http://127.0.0.1:8471/`: die AMAN-Seite
- `http://127.0.0.1:8471/api/traffic`: die Verkehrsdaten

Pro Flieger liefert es Callsign, Typ, WTC, Position, Höhe, Groundspeed, Kurs, Route, STAR, die Landebahn aus dem Flugplan bzw. Tag (`arrRwy`), den IAF und, wenn EuroScope den IAF schon als überflogen führt, `passedIaf`. Dazu kommen dein Callsign, die eingeloggten Lotsen, die aktiven Landebahnen von EDDM (nur für die MISMATCH-Warnung) und das METAR von EDDM.

## Secrets für den automatischen Release (einmalig, für Betreuer)

GitHub baut die Releases unter Windows und braucht dafür die beiden SDK-Dateien, ohne dass sie ins Repo kommen. Weil ein Secret höchstens 48 KB groß sein darf, packt das Skript `tools/set-sdk-secrets.ps1` die Dateien und speichert sie in Stücken als `ES_SDK_H_1…` und `ES_SDK_LIB_1…`.

```
winget install --id GitHub.cli
gh auth login
powershell -ExecutionPolicy Bypass -File tools\set-sdk-secrets.ps1
```

Das Skript nimmt die Dateien aus `%APPDATA%\EuroScope\PlugIn`. Liegen sie woanders: `-SdkDir "C:\..."` anhängen.

## Bauen (einmalig, unter Windows)

Du brauchst:
- **Visual Studio 2022 oder neuer** (Community reicht) mit der Arbeitslast „Desktopentwicklung mit C++“
- **CMake** (ist in Visual Studio enthalten)
- das **EuroScope-Plugin-SDK**: die Dateien `EuroScopePlugIn.h` und `EuroScopePlugInDll.lib`. Sie sind nicht in diesem Repo, weil sie zu EuroScope gehören. Sie liegen dem EuroScope-Download bzw. der EuroScope-Installation bei (Ordner mit „PlugIn“ im Namen). Falls du sie dort nicht findest, gibt es sie auf der EuroScope-Webseite im Bereich für Plugin-Entwickler.

Schritte:
1. Kopiere `EuroScopePlugIn.h` und `EuroScopePlugInDll.lib` in den Ordner `plugin/sdk/` dieses Repos.
2. Öffne die „Developer PowerShell for VS“ (Startmenü) und wechsle in den Repo-Ordner.
3. Konfigurieren, **32 Bit** (EuroScope ist ein 32-Bit-Programm):
   ```
   cmake -S plugin -B build -A Win32
   ```
4. Bauen:
   ```
   cmake --build build --config Release
   ```
5. Ergebnis in `build\Release\`: `EDDM-AMAN.dll` und daneben der Ordner `web\` mit der AMAN-Seite. Beides gehört zusammen.

Den fertigen Installer baut GitHub beim Release (siehe [CONTRIBUTING.md](../CONTRIBUTING.md)). Lotsen installieren über die Setup-Datei, siehe [README](../README.md).

## Testen ohne EuroScope (Linux)

```bash
npm run test:plugin
```

Baut den Plugin-Code gegen den Test-Nachbau in `tests/plugin/es_stub/`, füttert ihn mit Verkehr aus der AMAN-Simulation und prüft den AMAN im Browser im Plugin-Modus: Daten, Rolle aus dem Callsign, MISMATCH-Warnung, Bahnwechsel durch den Lotsen, Ausfall des Plugins (DATA STALE) und Schutz vor Dateizugriff außerhalb von `web`.
