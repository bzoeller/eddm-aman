# EDDM AMAN

Arrival Manager für München (EDDM) als Browser-Anzeige im Look des AMAN-Schirms am Arbeitsplatz: Zeitstrahl für Nord- und Südbahn, Hold-Feld, Bahnsperren, Statistik und eigene Ansichten für die CTR-Sektoren. Die Anzeige rechnet und zeichnet alle 5 Sekunden neu (`refreshSec` in `eddm.json`).

## Starten

Die Seite braucht einen kleinen Webserver, weil sie `eddm.json` per `fetch` lädt. Im Repo-Ordner:

```bash
python3 -m http.server 8090
```

Danach im Browser `http://localhost:8090/` öffnen. Ohne EuroScope läuft automatisch der Simulationsmodus.

## Datenquellen

- **Simulation:** erzeugt Anflugverkehr über die vier IAFs, einstellbar im MENU (Rate, Tempo, Bodenwind).
- **EuroScope-Plugin:** Wird die Seite vom Plugin unter `http://127.0.0.1:8471/` ausgeliefert, holt sie den Verkehr alle 5 Sekunden von `/api/traffic`. Die Rolle (APP, TWR, CTR) folgt aus dem eigenen Callsign. Optional kann das Plugin pro Flieger `trk` (Kurs über Grund) und `stream` (`W` oder `S` bei BETOS) sowie eine Liste `controllers` der eingeloggten Callsigns mitschicken.

## CTR-Ansichten

| Ansicht | Callsign | zeigt |
|---|---|---|
| CTR NDG (ROKIL) | `EDMM_NDG_CTR` | Anflüge über ROKIL |
| CTR RDG (LANDU) | `EDMM_RDG_CTR` | Anflüge über LANDU |
| CTR FUE (BETOS West) | `EDMM_FUE_CTR` | BETOS-Anflüge aus dem Westen |
| CTR STA (BETOS Süd) | `EDMM_STA_CTR` | BETOS-Anflüge aus dem Süden |
| CTR FUE+STA combined | FUE oder STA, wenn der andere Sektor nicht besetzt ist | beide BETOS-Ströme, im Label mit FUE oder STA markiert |
| Wien (NAPSA) | – | Anflüge über NAPSA |

Den Strom bestimmt das AMAN aus der Peilung vom IAF BETOS zum Flieger (West 220° bis 360°, Süd 90° bis 220°, einstellbar unter `iafs.BETOS.streams`). Ab 40 NM vor BETOS bleibt der Strom fest. Combined wird automatisch gewählt, wenn das Plugin `controllers` liefert. Sonst kann man die Ansicht im Menü (EXIT) fest einstellen.

## Bedienung (als APP)

- Klick auf ein Label (oder einen Flieger im Hold-Feld): Menü mit
  - **CHANGE RWY**: auf die andere Bahn, dort nach ETA einsortiert
  - **HOLD**: aus der Sequenz ins Hold-Feld
  - **RECOMPUTE**: Hold, manuelle Bahn und manuelle Position aufheben und neu nach ETA einplanen
- Label ziehen: Reihenfolge tauschen oder auf die andere Bahn setzen. Ins Hold-Feld ziehen: aus der Sequenz nehmen. Aus dem Hold-Feld auf eine Bahn ziehen: an dieser Stelle einplanen.
- `static` / `dynamic`: Planung vor dem IAF einfrieren oder laufen lassen.
- FLOW: Abstand in NM pro Bahn.
- EXIT: Einstellungen (Datenquelle, Ansicht, Staffelung, Bahnsperre, Simulation).

## Downwind und Final

Hinter dem IAF steht der Streifen auf der aktuellen Vorhersage. Werden Zeit und Meilen kürzer, rückt er sofort nach, auch im static-Modus. Das passiert etwa, wenn APP früh auf den Base oder direkt aufs Final dreht. Das AMAN erkennt das am Kurs: Schneidet er den Standardpfad weiter vorn und spart dabei mindestens 2 NM (`shortcutMinNm`), rechnet es mit dem kürzeren Weg. Ein Streifen rückt nie näher als die Mindeststaffelung an den Vordermann (2,5 NM oder Wirbelschleppe, `minRadarSepNm`). Überholt ein Flieger einen anderen wirklich, tauschen beide in der Sequenz. Manuell platzierte Flieger bleiben, wo sie sind.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Seite |
| `app.js` | Anzeige, Bedienung, Datenquellen |
| `aman-core.js` | Rechenkern (ETA, Sequenz, Staffelung), läuft auch in Node |
| `aman-sim.js` | Simulationsmodus |
| `eddm.json` | Flughafendaten: Bahnen, IAFs, Pfade, Speedprofil, Wirbelschleppen |
| `style.css` | Darstellung, dunkel und hell |
| `tests/func.js` | Browsertest mit Playwright |

## Test

```bash
python3 -m http.server 8090 &
node tests/func.js
```

Braucht Node und Playwright (`npm install playwright`).

Hinweis: Nur für die Simulation und VATSIM, nicht für den echten Flugbetrieb.
