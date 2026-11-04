# Abgleich zwischen Lotsen (V2)

Mit V2 teilen sich alle AMANs einen gemeinsamen Plan. Jede Eingabe von APP erscheint nach 1 bis 2 Sekunden bei allen anderen (APP, TWR, CTR):

- Reihenfolge und von Hand platzierte Flieger
- HOLD, CHANGE RWY, RECOMPUTE
- Bahnsperren, Runway Change, Betriebsrichtung
- static/dynamic mit den eingefrorenen Zeiten, FLOW und Landerate
- UNDO

## APP plant, alle anderen folgen

- **Ändern:** Jeder APP darf alles ändern, auf beiden Bahnen.
- **Automatische Reihenfolge** (neue Flieger nach ETA, Tausch nach dem Überholen): Die verteilt genau ein AMAN, sonst würde sie zwischen zwei APPs mit leicht anderen ETAs hin und her springen. Das ist der erste online APP nach Callsign (z. B. EDDM_F_APP vor EDDM_N_APP), höchstens alle 5 Sekunden.
  - Alle anderen AMANs, auch die der anderen APPs, sortieren nicht selbst um. Sie zeigen diese Reihenfolge, bis jemand von Hand eingreift.
- **static:** Die eingefrorenen Zeiten kommen von APP, so passen die Delay-Balken der CTR genau zu dem, was APP verlangt.
- **ETA:** Rechnet jeder AMAN selbst aus seinen EuroScope-Daten. Die können sich um einige Sekunden unterscheiden, die Reihenfolge und die Sollzeiten sind trotzdem für alle gleich.
- **Im Status (MENU):** steht, wessen AMAN die automatische Reihenfolge verteilt: „SYNC online, auto order EDDM_F_APP, last change …“.

## Flieger außerhalb der eigenen Reichweite

Jeder AMAN sieht von sich aus nur, was sein EuroScope in der eingestellten Reichweite empfängt. Bei APP tauchen die Flieger deshalb spät auf, bei CTR viel früher. Darum ergänzt jeder AMAN sein Bild:

- **Von anderen Lotsen:** Jeder eingeloggte Lotse (APP, TWR, CTR) gibt seine EuroScope-Flieger alle 10 Sekunden über den Sync-Server an die anderen weiter. So sieht APP die Flieger, sobald ein CTR sie sieht, samt Tracking und Route.
- **Aus dem VATSIM-Datenfeed:** Jeder AMAN holt alle 30 Sekunden selbst die Anflüge nach EDDM im Umkreis von 250 NM. Das klappt auch, wenn gerade kein CTR online ist.
- **Vorrang:** zuerst die eigenen EuroScope-Daten, dann die frischesten Daten eines anderen Lotsen, dann der Feed. Ältere Positionen (Feed etwa 15 bis 30 s) werden mit Kurs und Geschwindigkeit hochgerechnet. Kommt der Flieger in die eigene Reichweite, gelten wieder die eigenen, genauen Daten.
- **Schutz:** Verkehr verteilen kann nur, wer laut VATSIM-Feed als Lotse online ist. Der Server nimmt nur Flieger an, die laut Feed wirklich als Pilot verbunden sind, also keine erfundenen.
- **Im Status (MENU):** „62 aircraft tracked (40 from other controllers, 3 from VATSIM)“.
- Ein- und ausschalten in `web/eddm.json` unter `sync`: `shareTraffic`, `feed`, `feedRangeNm`.

## Wer darf ändern

Nur APP (`^EDDM_.*APP$`, dieselbe Regel wie `roles.APP` in `web/eddm.json`). Der Server prüft bei jeder Änderung im öffentlichen VATSIM-Datenfeed, ob dieses Callsign gerade wirklich als Lotse online ist.

- **Direkt nach dem Login:** Es kann bis zu einer Minute dauern, bis das Callsign im Feed steht. Bis dahin bleiben die Eingaben in einer Warteschlange und gehen automatisch raus, sobald es so weit ist. Am Rand steht so lange „SYNC: 1 change(s) not shared yet …“.
- **Dasselbe APP-Callsign zweimal verbunden** (zweites AMAN-Fenster, oder jemand gibt sich als dieser Lotse aus): Der Server nimmt von diesem Callsign keine Änderungen an, und am Rand erscheint eine Warnung. Das zweite Fenster schließen.
- **Grenze der Prüfung:** Das Callsign meldet der AMAN selbst. Wer gerade nicht verbunden ist, dessen Callsign kann ein anderer benutzen. Dagegen hilft später ein VATSIM-Login (OAuth).

## Wenn zwei gleichzeitig ändern

- Der Plan besteht aus einzelnen Teilen: Nordbahn, Südbahn, Hold-Feld, jede Bahnsperre, jeder Flieger, Richtung, static. Ändern N-APP und S-APP gleichzeitig verschiedene Teile, bleibt beides erhalten.
- Ändern zwei im selben Moment denselben Teil, gewinnt der Schnellere. Der andere sieht am Rand „Change by EDDM_N_APP arrived first: your change was not applied, please redo it“, und sein AMAN zeigt den Plan des Schnelleren. Es geht nichts still verloren.
- Eingaben von Kollegen erscheinen kurz am Rand („EDDM_S_APP: HOLD EZY12“), der Flieger ist 5 Sekunden markiert.
- UNDO nimmt nur die eigene letzte Eingabe zurück. Hat ein Kollege denselben Teil inzwischen geändert, geht UNDO nicht und sagt das.

## Störungen

- **Server nicht erreichbar:** Am Rand steht rot „SYNC offline“. Der AMAN rechnet allein weiter wie in Version 1. Eingaben von APP bleiben in der Warteschlange und gehen nach dem Neuverbinden raus. Hat ein anderer in der Zeit denselben Teil geändert, gilt dessen Stand, mit Meldung.
- **Neu laden oder neu dazukommen:** Der AMAN holt sich den aktuellen Plan vom Server. Ein Plan, der seit 2 Stunden nicht geändert wurde, gilt als vorbei. Dann stellt der nächste APP seinen eigenen ein.
- **Verlauf:** Im MENU unter „Shared plan“ zeigt SHOW LAST CHANGES die letzten Änderungen mit Uhrzeit, Callsign und Text. APP kann mit RESTORE (zweimal klicken) einen früheren Stand für alle wiederherstellen, zum Beispiel nach einer Fehlbedienung oder einem Missbrauch.
- **Notschalter:** Der Server lässt sich auf „nur lesen“ stellen.
  - Cloudflare: im Dashboard beim Worker unter **Settings → Variables** die Variable `READONLY` mit Wert `1` anlegen.
  - Docker: Umgebungsvariable `READONLY=1`.
- **Schutz vor Überlastung:** höchstens 8 Verbindungen je IP-Adresse und etwa 2 Nachrichten pro Sekunde je Verbindung, sonst trennt der Server.
- In der Simulation ist der Abgleich aus.

Die Adresse des Servers steht in `web/eddm.json` unter `sync.url` (`null` = aus). Sie kommt mit dem normalen Update zu allen.

## Server auf Cloudflare (jetzt)

Der Server läuft kostenlos als Cloudflare Worker. GitHub veröffentlicht ihn bei jeder Änderung in `server/` auf `main` selbst (`.github/workflows/sync-deploy.yml`). Einmalig einrichten:

1. Konto auf https://dash.cloudflare.com anlegen. Im Menü **Workers & Pages** einmal öffnen, dabei legt Cloudflare die Adresse `<name>.workers.dev` an.
2. **Account ID** kopieren. Sie steht auf der Startseite von Workers & Pages rechts.
3. **API-Token** mit möglichst wenig Rechten anlegen:
   1. Oben rechts auf das Profil → **My Profile → API Tokens → Create Token** → ganz unten **Create Custom Token**.
   2. Name `eddm-aman-sync`.
   3. Permissions: **Account → Workers Scripts → Edit**.
   4. Account Resources: **Include → dein Konto**.
   5. **Continue to summary → Create Token**. Den Token kopieren, er wird nur einmal angezeigt.
4. Beides als Secrets ins Repo, in der PowerShell (jeweils den Wert einfügen und Enter):
   ```
   gh secret set CLOUDFLARE_ACCOUNT_ID --repo bzoeller/eddm-aman
   ```
   ```
   gh secret set CLOUDFLARE_API_TOKEN --repo bzoeller/eddm-aman
   ```
5. Auf GitHub unter **Actions → Sync-Server → Run workflow** starten. Am Ende steht im Log die Adresse, z. B. `https://eddm-aman-sync.<name>.workers.dev`. Für den AMAN wird daraus `wss://eddm-aman-sync.<name>.workers.dev/ws`.

## Server beim vACC (später)

Derselbe Server läuft als Docker-Container:

```bash
cd server
docker build -t eddm-aman-sync .
docker run -d --restart unless-stopped -p 8080:8080 -e TRUST_PROXY=1 -v aman-sync:/data eddm-aman-sync
```

Davor gehört ein Webserver mit HTTPS (z. B. nginx oder Caddy), der `/ws` als WebSocket an Port 8080 weiterreicht und die Client-Adresse in `X-Forwarded-For` mitgibt. Dann in `web/eddm.json` die neue Adresse eintragen (z. B. `wss://aman.example.org/ws`) und ein Update veröffentlichen.

## Technik

- `server/core.mjs`: Regeln, unabhängig vom Betrieb.
  - wer darf ändern, Prüfung im VATSIM-Feed, doppelte Verbindung
  - Revision je Teil und Konflikt, Verlauf, Ablauf nach 2 Stunden
  - Ratenbegrenzung, Notschalter
- `server/worker.mjs`: Cloudflare (Durable Object mit WebSocket, Ping ohne Aufwecken).
- `server/node.mjs`: eigenes Programm mit `ws`, für Docker.
- `web/aman-sync.js`: Client im AMAN. Er hält den Stand des Servers und die noch nicht bestätigten eigenen Änderungen, schickt sie nach und verbindet sich mit wachsender Pause bis 30 Sekunden neu. Bei fehlender Antwort trennt er nach 10 Sekunden.
- Zerlegung des Plans: `planToKeys` und `keysToPlan` in `web/aman-core.js`. Das Protokoll steht im Kopf von `web/aman-sync.js`.
- Tests:
  - `tests/sync.js`: Regeln, drei bis vier Clients über den Node-Server, zwei Schreiber gleichzeitig, offline nachsenden, Warten auf den Feed, Konflikt.
  - `tests/plugin/e2e.js`: zwei AMAN-Fenster. APP ändert, TWR sieht es, dazu dieselbe Reihenfolge, UNDO, Verlauf, Warnungen.
