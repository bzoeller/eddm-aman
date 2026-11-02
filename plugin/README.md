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
- **Visual Studio 2022** (Community reicht) mit der Arbeitslast „Desktopentwicklung mit C++“
- **CMake** (ist in Visual Studio enthalten)
- das **EuroScope-Plugin-SDK**: die Dateien `EuroScopePlugIn.h` und `EuroScopePlugInDll.lib`. Sie sind nicht in diesem Repo, weil sie zu EuroScope gehören. Sie liegen dem EuroScope-Download bzw. der EuroScope-Installation bei (Ordner mit „PlugIn“ im Namen). Falls du sie dort nicht findest, gibt es sie auf der EuroScope-Webseite im Bereich für Plugin-Entwickler.

Schritte:
1. Kopiere `EuroScopePlugIn.h` und `EuroScopePlugInDll.lib` in den Ordner `plugin/sdk/` dieses Repos.
2. Öffne die „Developer PowerShell for VS 2022“ (Startmenü) und wechsle in den Repo-Ordner.
3. Konfigurieren, **32 Bit** (EuroScope ist ein 32-Bit-Programm):
   ```
   cmake -S plugin -B build -A Win32
   ```
4. Bauen:
   ```
   cmake --build build --config Release
   ```
5. Ergebnis in `build\Release\`: `EDDM-AMAN.dll` und daneben der Ordner `web\` mit der AMAN-Seite. Beides gehört zusammen.

Hinweis: Den Plugin-Code habe ich unter Linux gegen einen Nachbau der EuroScope-Schnittstelle gebaut und mit dem AMAN im Browser getestet (`tests/plugin/run.sh`). Gegen das echte SDK unter Windows ist er noch nicht gebaut worden. Falls der Compiler beim ersten Bauen über einzelne Funktionen meckert, schick mir die Fehlermeldung.

## Neue Version einspielen

1. Neue ZIP von GitHub laden und über den Repo-Ordner entpacken (Dateien ersetzen). Der Ordner `plugin\sdk` bleibt erhalten.
2. In der „Developer PowerShell for VS 2022/2026“ im Repo-Ordner: `cmake --build build --config Release`. Das kopiert auch die Webseite neu nach `build\Release\web`.
3. Den Ordner `build\Release\web` an den Plugin-Ort kopieren (Dateien ersetzen), dann die AMAN-Seite im Browser neu laden (F5).
4. Nur wenn sich die DLL geändert hat: EuroScope schließen, `EDDM-AMAN.dll` ersetzen, EuroScope starten. Solange EuroScope läuft, ist die DLL gesperrt.

## Installieren und öffnen

1. Kopiere `EDDM-AMAN.dll` und den Ordner `web` zusammen an einen festen Ort, z. B. `Dokumente\EuroScope\Plugins\EDDM-AMAN\`.
2. In EuroScope: **OTHER SET → Plug-ins… → Load** und `EDDM-AMAN.dll` auswählen. In der Nachrichtenzeile erscheint „AMAN running: http://127.0.0.1:8471/“.
3. AMAN öffnen: in der EuroScope-Befehlszeile `.aman` eingeben. Das öffnet ein eigenes Fenster (Edge im App-Modus, ohne Adressleiste). Alternativ im Browser `http://127.0.0.1:8471/` aufrufen. Am besten als halbes Fenster auf dem Zweitschirm.
4. Damit das Plugin beim nächsten Start automatisch geladen wird, im Plug-ins-Dialog das Profil speichern (wie bei anderen Plugins).

Meldet EuroScope „AMAN could not start: port 8471 is in use“, läuft schon ein anderes Programm (oder ein zweites EuroScope) auf diesem Port.

## Testen ohne EuroScope (Linux)

```bash
tests/plugin/run.sh
```

Baut den Plugin-Code gegen den Test-Nachbau in `tests/plugin/es_stub/`, füttert ihn mit Verkehr aus der AMAN-Simulation und prüft den AMAN im Browser im Plugin-Modus: Daten, Rolle aus dem Callsign, MISMATCH-Warnung, Bahnwechsel durch den Lotsen, Ausfall des Plugins (DATA STALE) und Schutz vor Dateizugriff außerhalb von `web`.
