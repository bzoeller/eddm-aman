# EDDM AMAN

Arrival Manager für München (EDDM) als Browser-Anzeige: Zeitstrahl für Nord- und Südbahn, Hold-Feld, Bahnsperren, Statistik und eine eigene Ansicht für die CTR-Sektoren (ROKIL, LANDU, BETOS, NAPSA).

## Starten

Die Seite braucht einen kleinen Webserver, weil sie `eddm.json` per `fetch` lädt. Im Repo-Ordner:

```bash
python3 -m http.server 8090
```

Danach im Browser `http://localhost:8090/` öffnen. Ohne EuroScope läuft automatisch der Simulationsmodus.

## Datenquellen

- **Simulation:** erzeugt Anflugverkehr über die vier IAFs, einstellbar im MENU (Rate, Tempo, Bodenwind).
- **EuroScope-Plugin:** Wird die Seite vom Plugin unter `http://127.0.0.1:8471/` ausgeliefert, holt sie den Verkehr jede Sekunde von `/api/traffic`. Die Rolle (APP, TWR, CTR) folgt aus dem eigenen Callsign.

## Bedienung (als APP)

- Label ziehen: Reihenfolge tauschen oder auf die andere Bahn setzen.
- Label ins Hold-Feld ziehen: Flieger aus der Sequenz nehmen. Aus dem Hold-Feld zurück auf eine Bahn ziehen: wieder einplanen.
- Klick auf ein Label: ETA, STA, Delay, IAF, Typ, Restweg. Dort auch INS HOLD, Bahnwechsel und AUTOMATIK.
- Doppelklick auf ein Label: manuelle Platzierung aufheben.
- `static` / `dynamic`: Sequenz einfrieren oder laufen lassen.
- FLOW: Abstand in NM pro Bahn.

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
