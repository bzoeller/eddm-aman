# Mitmachen

## Aufbau

| Pfad | Inhalt |
|---|---|
| `web/` | die AMAN-Seite, einzige Quelle für Plugin, Installer und Release |
| `web/aman-core.js` | Rechenkern (ETA, Sequenz, Staffelung), läuft auch in Node |
| `web/aman-sim.js` | Simulation |
| `web/app.js` | Anzeige, Bedienung, Datenquellen |
| `web/eddm.json` | Flughafendaten und Einstellungen, erklärt in [docs/config.md](docs/config.md) |
| `plugin/` | EuroScope-Plugin (C++): liefert die Seite und `/api/traffic` auf 127.0.0.1:8471, Updater |
| `web/aman-sync.js` | Abgleich zwischen Lotsen (Client) |
| `server/` | Sync-Server für den Abgleich: Cloudflare Worker oder Docker, siehe [docs/sync.md](docs/sync.md) |
| `installer/` | Inno-Setup-Skript |
| `tests/` | Rechenkern-, Browser- und Plugin-Tests |

## Seite lokal starten

Die Seite lädt `eddm.json` per `fetch` und braucht deshalb einen kleinen Webserver:

```bash
python3 -m http.server 8090 -d web
```

Dann `http://localhost:8090/` öffnen. Ohne Plugin läuft die Simulation.

## Daten vom Plugin

- **Simulation:** erzeugt Anflugverkehr über die vier IAFs, einstellbar im MENU (Rate, Tempo, Bodenwind). Standard sind 40 Anflüge pro Stunde. Ab etwa 50 pro Stunde ist das mehr, als zwei Bahnen mit FLOW 4,5 NM schaffen, und die Delays wachsen.
- **EuroScope-Plugin** (Bauen und Installieren: siehe [plugin/README.md](plugin/README.md)): Wird die Seite vom Plugin unter `http://127.0.0.1:8471/` ausgeliefert, holt sie den Verkehr alle 5 Sekunden von `/api/traffic`. Die Rolle (APP, TWR, CTR) folgt aus dem eigenen Callsign. Optional kann das Plugin pro Flieger `arrRwy` (Landebahn aus Flugplan bzw. Tag), `route` (Flugplanroute), `trk` (Kurs über Grund) und `stream` (`DISUN`, `SOTOV`, `AMADI`, `REDBU`) sowie eine Liste `controllers` der eingeloggten Callsigns mitschicken.

## Tests

```bash
npm install
npm --prefix server install
npx playwright install chromium
npm test
```

`npm test` prüft den Rechenkern mit der Simulation (Landeabstände, Runway Change mit 15-NM-Regel, Bahnwechsel aus EuroScope, 7000-ft-Grenze, Heading direkt aufs Final) , den Sync-Server (`tests/sync.js`) und die Seite im Browser; der Browsertest startet selbst einen Webserver. `npm run test:plugin` baut unter Linux das Plugin gegen den Test-Nachbau der EuroScope-Schnittstelle (`tests/plugin/es_stub/`) und prüft es mit dem AMAN im Browser sowie den Updater. Die GitHub-Actions laufen bei jedem Push.

## Plugin unter Windows bauen

Siehe [plugin/README.md](plugin/README.md). Die EuroScope-SDK-Dateien kommen nie ins Repo (`plugin/sdk/` ist ignoriert).

## Neue Version veröffentlichen

Einmalig: die SDK-Dateien mit `tools/set-sdk-secrets.ps1` als GitHub-Secrets ablegen (siehe `plugin/README.md`).

Jede Version: Nummer in `VERSION` erhöhen, committen, Tag `v<Nummer>` pushen. GitHub führt zuerst alle Tests aus, baut dann unter Windows DLL und Installer, berechnet die Prüfsummen und veröffentlicht das Release. Danach holen sich alle Plugins die neue Version beim nächsten EuroScope-Start.
