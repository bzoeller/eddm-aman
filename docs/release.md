# Releases und Updates (für Betreuer)

## Wie ein Update zu den Lotsen kommt

1. GitHub baut beim Release unter Windows DLL und Installer und schreibt die Liste der Dateien mit Prüfsummen (`manifest.txt`).
2. Diese Liste wird mit einem geheimen Schlüssel signiert (`manifest.sig`, ECDSA P-256).
3. Jedes installierte Plugin prüft beim Start von EuroScope zuerst die Signatur mit dem eingebauten öffentlichen Schlüssel (`tools/update-public-key.txt`), dann jede Datei per Prüfsumme. Erst dann ersetzt es die Webseite (sofort) und die DLL (beim nächsten Start).

Ohne gültige Signatur wird nichts eingespielt. Wer nur ein Release auf GitHub anlegen kann, etwa über einen gestohlenen Zugang oder eine manipulierte Abhängigkeit, kann deshalb keinen Code auf die Rechner der Lotsen bringen.

Der geheime Schlüssel liegt nur bei GitHub, im Environment **release**. Der Build-Job kommt erst an ihn heran, wenn du den Release freigegeben hast.

## Einmalig einrichten

1. SDK-Secrets: `powershell -ExecutionPolicy Bypass -File tools\set-sdk-secrets.ps1` (siehe `plugin/README.md`).
2. Signierschlüssel: `powershell -ExecutionPolicy Bypass -File tools\new-update-key.ps1`. Das Skript
   - legt das Environment `release` an, mit dir als Freigeber, nur für `main` und Tags `v*`,
   - erzeugt das Schlüsselpaar auf deinem Rechner,
   - speichert den geheimen Teil als Secret `UPDATE_SIGNING_KEY` in diesem Environment,
   - zeigt den öffentlichen Schlüssel an und legt ihn in `tools\update-public-key.txt` ab. Er gehört ins Repo.

   Nur einmal ausführen. Ein neuer Schlüssel passt nicht zu den schon installierten Plugins: Die bekommen dann keine Updates mehr und müssen den Installer neu laden.

## Jede neue Version

1. Nummer in `VERSION` erhöhen und committen.
2. Auf GitHub **Actions → Release → Run workflow**, Tag `v<Nummer>` eintragen.
3. Erst laufen alle Tests. Dann wartet der Build auf dich: Im Lauf erscheint **Review deployments**. Dort `release` anhaken und **Approve and deploy** klicken.
4. Nach etwa 10 Minuten steht das Release unter https://github.com/bzoeller/eddm-aman/releases. Die Plugins holen es beim nächsten Start von EuroScope.

## Was die Workflows sonst absichert

- Rechte: Alle Jobs haben nur Lesezugriff. Nur der Build-Job im Environment `release` darf das Release anlegen.
- Secrets werden einzeln und nur an den Schritt gegeben, der sie braucht.
- Fremde Actions sind auf einen festen Commit gepinnt, nicht auf eine verschiebbare Versionsnummer.
- Abhängigkeiten kommen fest aus den Lockfiles (`npm ci`).
- Der Sync-Server wird nur von `main` aus veröffentlicht. Der Cloudflare-Token sollte nur „Workers Scripts: Edit“ für dein eines Konto dürfen (siehe `docs/sync.md`).
