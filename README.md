# EDDM AMAN

Arrival Manager für München (EDDM) auf VATSIM: ein EuroScope-Plugin und eine Anzeige im eigenen Fenster, im Look des AMAN-Schirms am Arbeitsplatz. Nur für VATSIM und Simulation, nicht für den echten Flugbetrieb.

## Installieren

1. Unter [Releases](https://github.com/bzoeller/eddm-aman/releases/latest) die Datei **EDDM-AMAN-Setup.exe** laden und starten. Sie braucht keine Admin-Rechte und installiert nach `Dokumente\EuroScope\Plugins\EDDM-AMAN`.
2. Einmalig in EuroScope: **OTHER SET → Plug-ins… → Load** und `EDDM-AMAN.dll` aus diesem Ordner wählen. Beim Beenden die Einstellungen speichern, dann lädt EuroScope das Plugin künftig selbst.
3. In der EuroScope-Befehlszeile **`.aman`** eingeben: Der AMAN öffnet sich in einem eigenen Fenster. Am besten auf den Zweitschirm, halbe Breite.

**Updates** kommen automatisch: Beim Start von EuroScope prüft das Plugin, ob es eine neue Version gibt. Die Seite ist sofort neu (im AMAN-Fenster F5), das Plugin selbst nach dem nächsten EuroScope-Start. Von Hand prüfen: `.aman update`.

Meldet EuroScope „AMAN could not start: port 8471 is in use“, läuft schon ein zweites EuroScope oder ein anderes Programm auf diesem Port.

## Kurz zur Bedienung

- Die Ansicht folgt deinem Login: APP sieht beide Bahnen, TWR die Landefolge, CTR die eigenen Ströme mit Delay-Balken (eine Minute je Balken, bis 10 min).
- Als APP: Klick auf ein Label öffnet **CHANGE RWY**, **HOLD**, **RECOMPUTE**. Label ziehen ändert die Reihenfolge. UNDO nimmt den letzten Eingriff zurück.
- Klick auf den RWY-Kasten: Runway Change (sofort oder zu einer Uhrzeit) und Bahnsperre.
- Unten rechts: Sektor von Hand wählen und DAY oder NIGHT.
- Alle AMANs teilen sich einen Plan: Was APP ändert, sehen alle anderen nach 1 bis 2 Sekunden ([docs/sync.md](docs/sync.md)).

Alles im Detail: [docs/bedienung.md](docs/bedienung.md).

## Mitmachen

Bauen, Testen und Veröffentlichen: [CONTRIBUTING.md](CONTRIBUTING.md). Lizenz: [MIT](LICENSE).
