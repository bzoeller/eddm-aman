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
- **EuroScope-Plugin:** Wird die Seite vom Plugin unter `http://127.0.0.1:8471/` ausgeliefert, holt sie den Verkehr alle 5 Sekunden von `/api/traffic`. Die Rolle (APP, TWR, CTR) folgt aus dem eigenen Callsign. Optional kann das Plugin pro Flieger `arrRwy` (Landebahn aus Flugplan bzw. Tag), `route` (Flugplanroute), `trk` (Kurs über Grund) und `stream` (`DISUN`, `SOTOV`, `AMADI`, `REDBU`) sowie eine Liste `controllers` der eingeloggten Callsigns mitschicken.

## CTR-Ansichten und Ströme

| Ansicht | Callsign | zeigt |
|---|---|---|
| CTR NDG (ROKIL) | `EDMM_NDG_CTR` | Anflüge über ROKIL |
| CTR RDG (LANDU) | `EDMM_RDG_CTR` | LANDU-Ströme LULAR T105, NIRGO T108, VESUB T106 |
| CTR FUE | `EDMM_FUE_CTR` | BETOS-Strom DISUN T103 |
| CTR STA | `EDMM_STA_CTR` | BETOS-Strom SOTOV T101 |
| CTR FUE+STA combined | FUE oder STA, wenn der andere Sektor nicht besetzt ist | beide BETOS-Ströme |
| Wien LOVV_B (NAPSA) | `LOVV_B_CTR` | NAPSA-Ströme AMADI Q113 und REDBU Q112 |

Label-Farben (Box = IAF, Schrift = Strom):

| Strom | Box | Schrift |
|---|---|---|
| LULAR T105 LANDU | blau | weiß |
| NIRGO T108 LANDU | blau | weiß |
| VESUB T106 LANDU | blau | weiß |
| DISUN T103 BETOS | gelb | weiß |
| SOTOV T101 BETOS | gelb | gelb |
| AMADI Q113 NAPSA | rot | weiß |
| REDBU Q112 NAPSA | rot | rot |

Den Strom erkennt das AMAN aus der Flugplanroute (Feld `route`, z. B. `... DISUN T103 BETOS`). Fehlt die Route, nimmt es den Einflugpunkt, dessen Peilung vom IAF am besten zur Position passt (Koordinaten unter `fix`): BETOS mit DISUN 218° und SOTOV 185°, NAPSA mit AMADI 098° und REDBU 121°, LANDU mit LULAR 023°, VESUB 030° und NIRGO 038°. Bei LANDU liegen die Punkte nah beieinander, dort ist die Route deutlich zuverlässiger. Combined wird automatisch gewählt, wenn das Plugin `controllers` liefert. Sonst stellt man die Ansicht im MENU fest ein.

In der hellen Version (MENU → Darstellung) wird weiße Schrift schwarz, Gelb und Weiß werden für den Kontrast abgedunkelt.

## Bedienung (als APP)

- Klick auf ein Label (oder einen Flieger im Hold-Feld): Menü mit
  - **CHANGE RWY**: auf die andere Bahn, dort nach ETA einsortiert
  - **HOLD**: aus der Sequenz ins Hold-Feld
  - **RECOMPUTE**: Hold, manuelle Bahn und manuelle Position aufheben und neu nach ETA einplanen
- Label ziehen: Reihenfolge tauschen oder auf die andere Bahn setzen. Ins Hold-Feld ziehen: aus der Sequenz nehmen. Aus dem Hold-Feld auf eine Bahn ziehen: an dieser Stelle einplanen.
- `static` / `dynamic`: Planung vor dem IAF einfrieren oder laufen lassen.
- FLOW: Abstand in NM pro Bahn.
- Klick auf den RWY-Kasten: Runway Change und Bahnsperre (siehe unten).
- MENU: Einstellungen (Datenquelle, Ansicht, Darstellung hell oder dunkel, Staffelung, Simulation).
- UNDO (oder Strg+Z): nimmt den letzten Eingriff zurück (Verschieben, HOLD, CHANGE RWY, RECOMPUTE, static/dynamic, Sperre, Runway Change).

## Runway Change und Bahnsperre

Beides stellt APP über einen Klick auf den RWY-Kasten ein. Alle Zeiten sind UTC und werden als `HH:MM` oder vierstellig (`1420`) eingegeben.

- **Runway Change:** neue Richtung (26 oder 08) wählen, dann „ab jetzt“ oder „um HH:MM“.
  - Ein geplanter Wechsel steht als **grün gestrichelte Linie** am Zeitstrahl, darüber klein die neue Richtung (z. B. `RWY 08`). Im RWY-Kasten steht er zusätzlich als `→08 14:20`.
  - Wer nach dem Zeitpunkt landet, wird schon jetzt auf die neue Richtung geplant: Pfad, Restweg und Zeiten gelten für die neue Bahn. Erst landen alle Anflüge der alten Richtung (auf beiden Bahnen). Der erste Flieger der neuen Richtung ist erst bei 15 NM, wenn die letzte Landung der alten Richtung erfolgt ist, plus `rwyChangeBufferSec` (30 s) Puffer. Vor dem Zeitpunkt landet niemand in der neuen Richtung.
  - Flieger, die schon hinter dem IAF sind, behalten ihre Richtung.
  - Zum Zeitpunkt wechselt das AMAN automatisch die Richtung, und die Linie verschwindet. „LOESCHEN“ nimmt einen geplanten Wechsel zurück.
  - Die Betriebsrichtung kommt nur aus dem AMAN. Eine gedrehte Bahn in EuroScope ändert am AMAN nichts. Weicht sie ab, steht am Rand rot `RWY MISMATCH: EuroScope 08, AMAN 26`.
- **Bahnsperre:** Bahn (Nord, Süd oder beide), Beginn „ab jetzt“ oder „um HH:MM“, Ende „um HH:MM“. Gesperrte Zeiten sind orange schraffiert, Anflüge weichen auf die andere Bahn aus oder werden hinter die Sperre geplant. Aufheben geht in der Liste im Dialog oder per „SPERRE AUFHEBEN“ am Schirm.

## Bahn aus EuroScope und Wechsel auf den anderen Downwind

- **Standard:** Süd/Süd und Nord/Nord, also BETOS und NAPSA auf die Südbahn, ROKIL und LANDU auf die Nordbahn.
- **Änderung durch den Lotsen:** Ändert der Lotse in EuroScope die Landebahn eines Fliegers (Feld `arrRwy` vom Plugin, z. B. 08R → 08L), springt der Flieger im AMAN beim nächsten Update auf die neue Bahn und wird dort nach ETA eingeplant. Nur Änderungen zählen, nicht die Bahn, die EuroScope beim ersten Sehen einträgt.
- **Vektoren auf den anderen Downwind:** Ist der Flieger schon hinter dem IAF, rechnet das AMAN mit Vektoren auf den Downwind der neuen Bahn. Nord ist DM428–DM422 (08L) bzw. DM421–DM427 (26R), Süd ist DM458–DM452 (08R) bzw. DM452–DM457 (26L).
  - Bis dorthin zählt der direkte Weg nach Kurs (sonst der kürzeste Weg) zum Eintrittspunkt auf dem neuen Downwind. Base und Final sind als Eintritt ausgeschlossen.
  - Ab Erreichen des neuen Downwinds gilt das Standardprofil von dort.
- **Final erst ab 7000 ft:** Ein Flieger gilt erst ab 7000 ft oder darunter als auf dem Final (`profile.finalMaxAltFt`). Wer höher die Anfluglinie kreuzt, wird nicht aufs Final gerechnet.

## Holdings

APP-Holdings (in `eddm.json` unter `holdings`): ROKIL 126 R, LANDU 213 L, NAPSA 273 L, BETOS 067 R (Inbound-Kurs und Kurvenrichtung). OTT und MIQ werden nicht geplant. In der Simulation fliegen Flieger, deren Delay sich auf dem Downwind nicht mehr aufnehmen lässt, dort echte Warteschleifen und verlassen sie am Fix, sobald das Rest-Delay passt.

## Schutz vor Fehlbedienung und Datenfehlern

- Ziehen beginnt erst ab 12 px Bewegung, beim Ziehen zeigt eine gestrichelte Linie die Einfügestelle. Ein verschobener Flieger ist danach 5 s markiert.
- Bahnsperre und Runway Change zeigen vor dem Setzen, was passiert (z. B. „Nord 26R gesperrt 11:20 bis 11:50. 9 Anflüge betroffen“), und brauchen einen zweiten Klick (BESTAETIGEN). Auch Aufheben braucht einen zweiten Klick.
- Daten vom Plugin werden geprüft: kaputte Datensätze werden verworfen, Callsigns und Texte werden nie als HTML eingesetzt. Abfrage mit 4 s Timeout, eine ältere Antwort überschreibt nie eine neuere. Kommen länger als 15 s keine Daten, steht groß „DATA STALE“ am Schirm und die Labels werden ausgegraut.
- Durchstart: Ein schon als gelandet gezählter Flieger, der wieder steigt, wird neu eingeplant und nicht mehr als Landung gezählt. Ein einzelner leerer Datentakt kurz vor der Schwelle löscht keinen Flieger mehr.
- Gespeicherte Einstellungen aus älteren Versionen werden geprüft, ungültige Werte durch Standardwerte ersetzt.
- In der CTR-Ansicht gibt es je Minute Delay einen Balken, bis 10 min (`ctrMaxDelayMin`). Ein rotes „+“ zeigt, dass mehr als 10 min nötig sind. Eine leere CTR-Ansicht zeigt „keine Anfluege“.
- In der Simulation steht „SIM“ an der Uhr.

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
| `tests/engine.js` | Rechenkern-Test mit der Simulation: Landeabstände, Runway Change mit 15-NM-Regel, Bahnwechsel aus EuroScope, 7000-ft-Grenze |

## Test

```bash
python3 -m http.server 8090 &
node tests/func.js
```

Braucht Node und Playwright (`npm install playwright`). Der Rechenkern-Test läuft ohne Browser und ohne Webserver:

```bash
node tests/engine.js
```

Hinweis: Nur für die Simulation und VATSIM, nicht für den echten Flugbetrieb.
