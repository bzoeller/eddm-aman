# Abgleich zwischen Lotsen (V2)

Mit V2 teilen sich alle AMANs einen gemeinsamen Plan. Jede Eingabe von APP erscheint nach 1 bis 2 Sekunden bei allen anderen (APP, TWR, CTR):

- Reihenfolge und von Hand platzierte Flieger
- HOLD, CHANGE RWY, RECOMPUTE
- Bahnsperren, Runway Change, Betriebsrichtung
- static/dynamic, FLOW und Landerate
- UNDO

Die Zeiten (ETA, Delay) rechnet weiterhin jeder AMAN selbst aus seinen EuroScope-Daten. Weil alle denselben VATSIM-Verkehr sehen, kommen dieselben Zeiten heraus.

## Wer darf ändern

Nur APP (`EDDM_..._APP`). Der Server prüft bei jeder Änderung im öffentlichen VATSIM-Datenfeed, ob dieses Callsign gerade wirklich als Lotse online ist. Direkt nach dem Login kann das bis zu einer Minute dauern, bis dahin steht am Rand „SYNC: … is not online on VATSIM“ und die Eingaben gelten nur im eigenen AMAN.

Grenze dieser Prüfung: Das Callsign meldet der AMAN selbst. Wer es darauf anlegt, könnte sich als ein gerade eingeloggter APP ausgeben. Für einen stärkeren Schutz lässt sich später ein VATSIM-Login (OAuth) ergänzen.

## Was man sieht

- Im MENU unter dem Status: „SYNC online, last change by EDDM_N_APP“.
- Ist der Server nicht erreichbar, steht am Rand rot „SYNC offline: changes are not shared“. Der AMAN rechnet dann allein weiter wie in Version 1 und verbindet sich von selbst neu.
- Wer neu dazukommt oder die Seite neu lädt, bekommt den aktuellen Plan vom Server. Ein Plan, der seit 2 Stunden nicht geändert wurde, gilt als vorbei. Dann stellt der nächste APP seinen eigenen ein.
- In der Simulation ist der Abgleich aus.

Die Adresse des Servers steht in `web/eddm.json` unter `sync.url` (`null` = aus). Sie kommt mit dem normalen Update zu allen.

## Server auf Cloudflare (jetzt)

Der Server läuft kostenlos als Cloudflare Worker. GitHub veröffentlicht ihn bei jeder Änderung in `server/` selbst (`.github/workflows/sync-deploy.yml`). Einmalig einrichten:

1. Konto auf https://dash.cloudflare.com anlegen. Im Menü **Workers & Pages** einmal öffnen, dabei legt Cloudflare die Adresse `<name>.workers.dev` an.
2. **Account ID**: steht auf der Startseite von Workers & Pages rechts (oder im Menü unter „Account details“).
3. **API-Token**: oben rechts auf das Profil → **My Profile → API Tokens → Create Token** → Vorlage **„Edit Cloudflare Workers“** → Continue → Create Token. Den Token kopieren, er wird nur einmal angezeigt.
4. Beides als Secrets ins Repo, in der PowerShell:
   ```
   gh secret set CLOUDFLARE_ACCOUNT_ID --repo bzoeller/eddm-aman
   gh secret set CLOUDFLARE_API_TOKEN --repo bzoeller/eddm-aman
   ```
   (jeweils den Wert einfügen und Enter)
5. Auf GitHub unter **Actions → Sync-Server → Run workflow** starten. Am Ende steht im Log die Adresse, z. B. `https://eddm-aman-sync.<name>.workers.dev`. Für den AMAN wird daraus `wss://eddm-aman-sync.<name>.workers.dev/ws`.

## Server beim vACC (später)

Derselbe Server läuft als Docker-Container:

```bash
cd server
docker build -t eddm-aman-sync .
docker run -d --restart unless-stopped -p 8080:8080 -v aman-sync:/data eddm-aman-sync
```

Davor gehört ein Webserver mit HTTPS (z. B. nginx oder Caddy), der `/ws` als WebSocket an Port 8080 weiterreicht. Dann in `web/eddm.json` die neue Adresse eintragen (z. B. `wss://aman.vacc-germany.org/ws`) und ein Update veröffentlichen.

## Technik

- `server/core.mjs`: Regeln (wer darf, Prüfung im VATSIM-Feed, Ablauf nach 2 h), unabhängig vom Betrieb.
- `server/worker.mjs`: Cloudflare (Durable Object mit WebSocket).
- `server/node.mjs`: eigenes Programm mit `ws`, für Docker.
- `web/aman-sync.js`: Client im AMAN, verbindet sich neu mit wachsender Pause bis 30 s.
- Protokoll: siehe Kopf von `web/aman-sync.js`.
- Tests: `tests/sync.js` (Regeln, zwei Clients über den Node-Server, Neustart) und in `tests/plugin/e2e.js` zwei AMAN-Fenster (APP ändert, TWR sieht es).
