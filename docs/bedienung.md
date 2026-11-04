# Bedienung des EDDM AMAN

Zeitstrahl für Nord- und Südbahn, Hold-Feld, Bahnsperren, Statistik und eigene Ansichten für die CTR-Sektoren. Die Anzeige rechnet und zeichnet alle 5 Sekunden neu. Die Oberfläche ist englisch, diese Anleitung deutsch.

Ohne EuroScope (zum Ausprobieren) läuft eine Simulation: Anflugverkehr über die vier IAFs, einstellbar im MENU (Rate, Tempo, Bodenwind). Standard sind 40 Anflüge pro Stunde. Ab etwa 50 pro Stunde ist das mehr, als zwei Bahnen mit FLOW 4,5 NM schaffen, und die Delays wachsen.

## Bedienung (als APP)

- Klick auf ein Label (oder einen Flieger im Hold-Feld): Menü mit
  - **CHANGE RWY**: auf die andere Bahn, dort nach ETA einsortiert
  - **HOLD**: aus der Sequenz ins Hold-Feld
  - **RECOMPUTE**: Hold, manuelle Bahn und manuelle Position aufheben und neu nach ETA einplanen
- Label ziehen: Reihenfolge tauschen oder auf die andere Bahn setzen. Ein von Hand platzierter Flieger bekommt eine grün ausgefüllte Pfeilspitze, RECOMPUTE gibt ihn wieder frei. Ins Hold-Feld ziehen: aus der Sequenz nehmen. Aus dem Hold-Feld auf eine Bahn ziehen: an dieser Stelle einplanen.
- `static` / `dynamic`: Planung vor dem IAF einfrieren oder laufen lassen.
- FLOW: Abstand in NM pro Bahn.
- Klick auf den RWY-Kasten: Runway Change und Bahnsperre (siehe unten).
- Unten rechts: Schnellauswahl für den Sektor (AUTO, APP, TWR, NDG, RDG, FUE, STA, FUE+STA, LOVV_B) und DAY oder NIGHT.
- MENU: Einstellungen (Datenquelle, Ansicht, Darstellung hell oder dunkel, Staffelung, Simulation).
- UNDO (oder Strg+Z): nimmt den letzten Eingriff zurück (Verschieben, HOLD, CHANGE RWY, RECOMPUTE, static/dynamic, Sperre, Runway Change).

## Abgleich zwischen Lotsen

Alle AMANs teilen sich einen Plan. Was APP ändert (Reihenfolge, HOLD, CHANGE RWY, RECOMPUTE, Sperren, Runway Change, static/dynamic, FLOW, UNDO), sehen alle anderen nach 1 bis 2 Sekunden. Ändern darf, wer als EDDM-APP im VATSIM-Netz online ist. Ist kein APP online, übernimmt ein EDMM-CTR top-down: Er bekommt die APP-Ansicht und darf planen. Flieger außerhalb der eigenen EuroScope-Reichweite kommen von anderen Lotsen (z. B. CTR) und aus dem VATSIM-Datenfeed, so erscheinen sie so früh wie möglich. Ist der Abgleich gestört, steht es rot am Rand, und die Eingaben gelten nur im eigenen AMAN. Details: [sync.md](sync.md).

## Runway Change und Bahnsperre

Beides stellt APP über einen Klick auf den RWY-Kasten ein. Alle Zeiten sind UTC und werden als `HH:MM` oder vierstellig (`1420`) eingegeben.

- **Runway Change:** neue Richtung (26 oder 08) wählen, dann „now“ oder „at HH:MM“, dann SET RWY CHANGE und CONFIRM.
  - Ein geplanter Wechsel steht als **grün gestrichelte Linie** am Zeitstrahl, darüber klein die neue Richtung (z. B. `RWY 08`). Im RWY-Kasten steht er zusätzlich als `→08 14:20`.
  - Wer nach dem Zeitpunkt landet, wird schon jetzt auf die neue Richtung geplant: Pfad, Restweg und Zeiten gelten für die neue Bahn. Erst landen alle Anflüge der alten Richtung (auf beiden Bahnen). Der erste Flieger der neuen Richtung ist erst bei 15 NM, wenn die letzte Landung der alten Richtung erfolgt ist, plus `rwyChangeBufferSec` (30 s) Puffer. Vor dem Zeitpunkt landet niemand in der neuen Richtung.
  - Flieger, die schon hinter dem IAF sind, behalten ihre Richtung.
  - Zum Zeitpunkt wechselt das AMAN automatisch die Richtung, und die Linie verschwindet. „DELETE“ nimmt einen geplanten Wechsel zurück. Beim Wechsel blinkt die neue Richtung im RWY-Kasten 10 Sekunden lang.
  - Beim Öffnen übernimmt der AMAN einmalig die aktive Richtung aus EuroScope. Danach kommt die Betriebsrichtung nur aus dem AMAN. Eine gedrehte Bahn in EuroScope ändert am AMAN nichts. Weicht sie ab, steht am Rand rot `RWY MISMATCH: EuroScope 08, AMAN 26`.
- **Bahnsperre:** North, South oder Both, Beginn „now“ oder „at HH:MM“, Ende „Until HH:MM“. Gesperrte Zeiten sind orange schraffiert, Anflüge weichen auf die andere Bahn aus oder werden hinter die Sperre geplant. Aufheben geht in der Liste im Dialog (LIFT) oder per „LIFT CLOSURE“ am Schirm.

## CTR-Ansichten und Ströme

**Sektorvergabe automatisch:** Ein CTR-Lotse sieht jeden Strom, in dem er gerade mindestens einen Flieger vor dem IAF trackt. Die Daten dazu (wer trackt) kommen aus EuroScope. Damit folgt die Ansicht jeder Sektorkombination von selbst, ohne Tabelle: Arbeitet z. B. ALB auch RDG und trackt die LANDU-Flieger, heißt die Ansicht „CTR ALB (LULAR NIRGO VESUB)“. Übernimmt ZUG alles, sieht ZUG alle Ströme. Ein Strom bleibt nach dem letzten getrackten Flieger noch 10 Minuten in der Ansicht. Trackt gerade niemand Flieger eines Stroms, entscheidet die OWNER-Liste aus der EDMM-Sektordatei (`ctrOwners`, `ctrFeeders` in `web/eddm.json`): Der Strom gehört dem ersten Sektor der Liste, der online ist. Zubringer und Reihenfolge: ROKIL über NDG (NDG, TRU, WLD, ZUG, RDG), LANDU über RDG (RDG, EGG, ALB, WLD, ZUG), DISUN über FUE (FUE, ZUG, STA, TRU, RDG), SOTOV über STA (STA, FUE, TEG, TRU, ZUG, RDG), AMADI und REDBU über LOVV_B. Ein CTR-Lotse ohne Strom sieht eine leere Ansicht mit „no arrivals“.

Die Ansicht wird beim Öffnen immer automatisch nach dem Login gewählt. Eine Auswahl von Hand (MENU oder unten rechts) gilt, bis die Seite neu geladen wird. In der CTR-Ansicht steht jedes Label auf der geplanten Überflugzeit am IAF, die Balken zeigen die Minuten, die bis dorthin verloren werden müssen.

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

In der hellen Version (MENU → Theme) wird weiße Schrift schwarz, Gelb und Weiß werden für den Kontrast abgedunkelt.

## Bahn aus EuroScope und Wechsel auf den anderen Downwind

- **Standard:** Süd/Süd und Nord/Nord, also BETOS und NAPSA auf die Südbahn, ROKIL und LANDU auf die Nordbahn.
- **Änderung durch den Lotsen:** Ändert der Lotse in EuroScope die Landebahn eines Fliegers (Feld `arrRwy` vom Plugin, z. B. 08R → 08L), springt der Flieger im AMAN beim nächsten Update auf die neue Bahn und wird dort nach ETA eingeplant. Nur Änderungen zählen, nicht die Bahn, die EuroScope beim ersten Sehen einträgt.
- **Vektoren auf den anderen Downwind:** Ist der Flieger schon hinter dem IAF, rechnet das AMAN mit Vektoren auf den Downwind der neuen Bahn. Nord ist DM428–DM422 (08L) bzw. DM421–DM427 (26R), Süd ist DM458–DM452 (08R) bzw. DM452–DM457 (26L).
  - Bis dorthin zählt der direkte Weg nach Kurs (sonst der kürzeste Weg) zum Eintrittspunkt auf dem neuen Downwind. Base und Final sind als Eintritt ausgeschlossen.
  - Ab Erreichen des neuen Downwinds gilt das Standardprofil von dort.
- **Per Heading geführt, ohne den IAF zu überfliegen:** Zeigt der Kurs eines Fliegers im Anflugbereich (unter 45 NM vom Platz, unter FL160) mehr als 3 NM am IAF vorbei auf einen späteren Teil des Pfades (Downwind, Base, Final), gilt er sofort als von APP geführt. Das AMAN rechnet dann direkt bis zum Schnittpunkt und ab dort mit dem Standardprofil, wenn das mindestens 1 min spart (`vectorAreaNm`, `vectorMaxAltFt`, `vectorMissNm`).
- **Final erst ab 7000 ft:** Ein Flieger gilt erst ab 7000 ft oder darunter als auf dem Final (`profile.finalMaxAltFt`). Wer höher die Anfluglinie kreuzt, wird nicht aufs Final gerechnet.

## Holdings

**EAT im Hold-Feld:** Neben jedem Flieger im Hold-Feld steht die Expected Approach Time („EAT 14:32“). Zu dieser Zeit soll er den Holding-Fix verlassen, damit er in die nächste passende Lücke seiner Bahn passt, mit voller Staffelung zu Vorder- und Hintermann und unter Berücksichtigung von Sperren. Nie früher, als er ohnehin am Fix wäre.

**Delay-Anweisung für CTR:** In der CTR-Ansicht steht neben den Balken ein Vorschlag, wie das Delay bis zum IAF abgebaut werden kann:
- zuerst über die Geschwindigkeit, oberhalb FL245 als Mach (z. B. „M.76“), darunter als IAS (z. B. „250kt“, nicht unter 250 kt über FL100 bzw. 220 kt darunter),
- was dann noch fehlt, als Umweg oder Vektoren („+3min“),
- ab 8 Minuten Rest „HOLD“.

Das ist ein Vorschlag aus Restflugzeit und Geschwindigkeit, Wind ist grob berücksichtigt. Jeder Lotse kann ihn im MENU unter „CTR delay advice“ ein- oder ausblenden.


APP-Holdings (in `web/eddm.json` unter `holdings`): ROKIL 126 R, LANDU 213 L, NAPSA 273 L, BETOS 067 R (Inbound-Kurs und Kurvenrichtung). OTT und MIQ werden nicht geplant. In der Simulation fliegen Flieger, deren Delay sich auf dem Downwind nicht mehr aufnehmen lässt, dort echte Warteschleifen und verlassen sie am Fix, sobald das Rest-Delay passt.

## Downwind und Final

Der Streifen steht immer auf der geplanten Zeit mit voller Staffelung (FLOW, Wirbelschleppe, Landerate). Werden Zeit und Meilen kürzer, auch im static-Modus, rückt er nach, soweit der Vordermann es zulässt. Das passiert etwa, wenn APP früh auf den Base oder direkt aufs Final dreht. Das AMAN erkennt das am Kurs: Schneidet er den Standardpfad weiter vorn und spart dabei mindestens 2 NM (`shortcutMinNm`), rechnet es mit dem kürzeren Weg. Überholt ein Flieger einen anderen wirklich, tauschen beide in der Sequenz. Manuell platzierte Flieger bleiben, wo sie sind. Weil Schirm und Planung dieselbe Zeit nutzen, passen die CTR-Balken zu dem, was APP sieht: Wer eine Lücke vor sich hat, bekommt keinen Balken.

## Schutz vor Fehlbedienung und Datenfehlern

- Ziehen beginnt erst ab 12 px Bewegung, beim Ziehen zeigt eine gestrichelte Linie die Einfügestelle. Ein verschobener Flieger ist danach 5 s markiert.
- Bahnsperre und Runway Change zeigen vor dem Setzen, was passiert (z. B. „North closed 11:20-11:50. 9 arrivals affected.“), und brauchen einen zweiten Klick (CONFIRM). Auch Aufheben (LIFT) braucht einen zweiten Klick.
- Daten vom Plugin werden geprüft: kaputte Datensätze werden verworfen, Callsigns und Texte werden nie als HTML eingesetzt. Abfrage mit 4 s Timeout, eine ältere Antwort überschreibt nie eine neuere. Kommen länger als 15 s keine Daten, steht groß „DATA STALE“ am Schirm und die Labels werden ausgegraut.
- Durchstart: Ein schon als gelandet gezählter Flieger, der wieder steigt, wird neu eingeplant und nicht mehr als Landung gezählt. Ein einzelner leerer Datentakt kurz vor der Schwelle löscht keinen Flieger mehr.
- Gespeicherte Einstellungen aus älteren Versionen werden geprüft, ungültige Werte durch Standardwerte ersetzt.
- In der CTR-Ansicht gibt es je Minute Delay einen Balken, bis 10 min (`ctrMaxDelayMin`). Ein rotes „+“ zeigt, dass mehr als 10 min nötig sind. Eine leere CTR-Ansicht zeigt „no arrivals“.
- In der Simulation steht „SIM“ an der Uhr.

Hinweis: Nur für die Simulation und VATSIM, nicht für den echten Flugbetrieb.
