# eddm.json

Flughafendaten und Einstellungen für den AMAN. Der Rechenkern prüft beim Start, ob alle Pflichtwerte da sind, und meldet fehlende Felder mit Namen. Standardwerte stehen nur hier, nicht im Code.

## Ströme (`iafs.<IAF>.streams`)

- `route`: Punkte oder Airways, an denen der Strom in der Flugplanroute erkannt wird.
- `fix`: Koordinaten des Einflugpunkts. Ohne passende Route entscheidet die Peilung vom IAF zum nächsten Fix.
- `text`: Schriftfarbe im Label. `fg` = weiß (hell: schwarz), `box` = Farbe der Box.

## Pfade (`paths.<IAF>.<Bahn>`)

- `aipTrackMiles`: durchschnittliche Flugentfernung ab IAF laut AIP AD 2 EDDM 1-30 (01 OCT 2026). Danach wird gerechnet.
- `path`: Geometrie aus den RNAV-Transitions. Sie dient nur dazu, den Fortschritt eines Fliegers zu verfolgen. Die Strecke vor dem 15-NM-Final wird auf den AIP-Wert skaliert.

## CTR (`ctrViews`, `ctrOwners`, `ctrFeeders`)

- `ctrViews`: feste Ansichten je Sektor. `sector` ist der Name im Callsign (`EDMM_<sector>_CTR`), `combine` die Sektoren einer kombinierten Ansicht.
- `ctrOwners`: aus den OWNER-Zeilen der EDMM-Sektordatei. Wer einen Zubringer-Sektor übernimmt, in dieser Reihenfolge.
- `ctrFeeders`: Zubringer-Sektor je Strom (bzw. IAF ohne Ströme).

## Pflichtwerte

`profile`: `belowFL100`, `downwind`, `fap`, `final` (IAS in kt), `finalSlowNm`, `finalNm`, `finalMaxAltFt`.

`defaults`: `spacingNm`, `ratePerRwy`, `timelineMin`, `captureNm`, `hysteresisSec`, `ctrMaxDelayMin`, `fixedFinalGs`, `bentLineBelowMin`, `lostAfterSec`, `shortcutMinNm`, `refreshSec`, `rwyChangeBufferSec`, `vectorAreaNm`, `vectorMaxAltFt`, `vectorMissNm`, `finalInterceptMinNm`.
