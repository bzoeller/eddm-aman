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
- **EuroScope-Plugin:** Wird die Seite vom Plugin unter `http://127.0.0.1:8471/` ausgeliefert, holt sie den Verkehr alle 5 Sekunden von `/api/traffic`. Die Rolle (APP, TWR, CTR) folgt aus dem eigenen Callsign. Optional kann das Plugin pro Flieger `route` (Flugplanroute), `trk` (Kurs über Grund) und `stream` (`DISUN`, `SOTOV`, `AMADI`, `REDBU`) sowie eine Liste `controllers` der eingeloggten Callsigns mitschicken.

## CTR-Ansichten und Ströme

| Ansicht | Callsign | zeigt |
|---|---|---|
| CTR NDG (ROKIL) | `EDMM_NDG_CTR` | Anflüge über ROKIL |
| CTR RDG (LANDU) | `EDMM_RDG_CTR` | Anflüge über LANDU |
| CTR FUE | `EDMM_FUE_CTR` | BETOS-Strom DISUN T103 |
| CTR STA | `EDMM_STA_CTR` | BETOS-Strom SOTOV T101 |
| CTR FUE+STA combined | FUE oder STA, wenn der andere Sektor nicht besetzt ist | beide BETOS-Ströme |
| Wien LOVV_B (NAPSA) | `LOVV_B_CTR` | NAPSA-Ströme AMADI Q113 und REDBU Q112 |

Label-Farben (Box = IAF, Schrift = Strom):

| Strom | Box | Schrift |
|---|---|---|
| DISUN T103 BETOS | gelb | weiß |
| SOTOV T101 BETOS | gelb | gelb |
| AMADI Q113 NAPSA | rot | weiß |
| REDBU Q112 NAPSA | rot | rot |

Den Strom erkennt das AMAN aus der Flugplanroute (Feld `route`, z. B. `... DISUN T103 BETOS`). Fehlt die Route, schätzt es den Strom bei BETOS aus der Peilung vom IAF (DISUN 220° bis 360°, SOTOV 90° bis 220°, einstellbar in `eddm.json` unter `iafs.BETOS.streams`). Bei NAPSA gibt es keine Schätzung: Ohne Route bleibt die Schrift weiß. Combined wird automatisch gewählt, wenn das Plugin `controllers` liefert. Sonst stellt man die Ansicht im Menü (EXIT) fest ein.

In der hellen Version (EXIT → Darstellung) wird weiße Schrift schwarz, Gelb und Weiß werden für den Kontrast abgedunkelt.

## Bedienung (als APP)

- Klick auf ein Label (oder einen Flieger im Hold-Feld): Menü mit
  - **CHANGE RWY**: auf die andere Bahn, dort nach ETA einsortiert
  - **HOLD**: aus der Sequenz ins Hold-Feld
  - **RECOMPUTE**: Hold, manuelle Bahn und manuelle Position aufheben und neu nach ETA einplanen
- Label ziehen: Reihenfolge tauschen oder auf die andere Bahn setzen. Ins Hold-Feld ziehen: aus der Sequenz nehmen. Aus dem Hold-Feld auf eine Bahn ziehen: an dieser Stelle einplanen.
- `static` / `dynamic`: Planung vor dem IAF einfrieren oder laufen lassen.
- FLOW: Abstand in NM pro Bahn.
- EXIT: Einstellungen (Datenquelle, Ansicht, Darstellung hell oder dunkel, Staffelung, Bahnsperre, Simulation).

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
