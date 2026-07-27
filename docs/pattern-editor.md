# MUSE Pattern-Editor

Der Pattern-Editor ist die Weiterentwicklung des Song Makers: gleiche
Unmittelbarkeit (rechts = Zeit, oben = Tonhöhe, antippen = Musik), aber ohne
die Grenzen des 16-Step-Rasters.

Route: `/jam-grid` (Navigation: **Patterns**).

## Arbeitszustände

```
Pattern-Bibliothek
    ↓ Pattern öffnen
Pattern-Editor  (Canvas + schmale Leisten)
    ↓ Ereignis auswählen
Ereignis-Leiste (Lautstärke- und Ausdruckskurve)
```

Der Editor ist ein eigener Zustand: entweder Bibliothek **oder** Editor ist
sichtbar. Arrangement, Jam Room, Piano Roll und Mixer zeigen kein Pattern-UI –
weder Layer-Stack noch Notenraster noch Kurven.

## Was der Editor kann

- **Freie Pattern-Länge.** Der Endmarker ist auf dem Canvas greifbar, rastet
  auf das Raster ein und lässt sich zusätzlich numerisch setzen (13 Steps sind
  genauso gültig wie 16 oder 128).
- **Nicht-destruktives Kürzen.** Ereignisse hinter dem Endmarker bleiben
  erhalten, werden schraffiert dargestellt, klingen nicht und erscheinen beim
  Verlängern wieder. Ein bewusster Knopf schneidet sie endgültig ab.
- **Unabhängige Instrumentenebenen.** Jede Ebene hat Instrument bzw. Drum-Sound,
  Farbe, Sichtbarkeit, Mute, Solo und Lock. Mehrere Ebenen dürfen dieselbe
  Zeitposition belegen; innerhalb einer Ebene ist Polyphonie erlaubt.
- **Overlay.** Die aktive Ebene ist voll sichtbar und bearbeitbar, sichtbare
  Referenzebenen liegen transparent darunter, ausgeblendete verschwinden,
  gesperrte bleiben sichtbar, nehmen aber keine Änderungen an.
- **Töne als Blöcke.** Antippen erzeugt eine Note in Rasterlänge, Ziehen nach
  rechts erzeugt direkt eine gehaltene Note, Ziehen des Blocks verschiebt ihn in
  Zeit und Tonhöhe, Ziehen der Kanten ändert Beginn oder Dauer. Doppelklick,
  `Entf`/`Backspace` und der Knopf in der Ereignis-Leiste löschen.
- **Percussion und Samples** liegen kompakt in eigenen Lanes unter dem Raster,
  benutzen aber dasselbe Zeitmodell wie melodische Noten.
- **Zwei Bézierkurven pro Ereignis** – Lautstärke und Ausdruck – mit Presets
  (direkt, weich ein, weich aus, anschwellen, abschwellen, Akzent), frei
  ziehbaren Punkten und einem Bogen-Regler.
- **Undo/Redo** über alle Bearbeitungsschritte (`Cmd/Ctrl+Z`, `Shift+Cmd+Z`).
- **Wiedergabe** mehrerer Ebenen gleichzeitig, mit Loop auf den Endmarker,
  `Leertaste` startet und stoppt.

## Kurven: wie aus Bildern Klang wird

Kurven werden **normalisiert** gespeichert: Zeit relativ zur Ereignisdauer
(0…1), Wert 0…1. Eine Kurve bleibt damit gültig, wenn die Note später länger
oder kürzer wird – die absoluten Zeitpunkte ergeben sich erst beim Abspielen.

Bei der Wiedergabe werden sie tatsächlich angewendet:

| Kurve       | SoundFont-Pfad            | interner Synth / Drums          |
| ----------- | ------------------------- | ------------------------------- |
| Lautstärke  | CC 11 (Expression), gerampt über die Notendauer | Gain-Hüllkurve der Stimme; bei Drums die Spitzenlautstärke |
| Ausdruck    | CC 1 (Modulation) + Anschlagstärke am Notenanfang | Anschlagstärke |

Instrumente, die einen Parameter nicht unterstützen, fallen sauber auf
Lautstärke bzw. eine sichere Standardexpression zurück. Ohne Kurve wird gar
kein Controller gesendet – unbearbeitete Noten kosten nichts.

## Vertrag zum Song

`applyPatternToSong(song, pattern, binding)` schreibt das Pattern in den Song:

- eine Song-Spur pro exportierender Ebene,
- die Zuordnung `layerId → trackId` wird pro Pattern gespeichert,
- erneuter Export **aktualisiert** diese Spuren, statt neue anzulegen,
- Ereignisse hinter dem Endmarker werden nicht exportiert, gehaltene Noten am
  Endmarker abgeschnitten,
- Spurnamen tragen die Herkunft: `Pattern: <Name> – <Ebene>`,
- die Vorschau im Editor erzeugt **keine** Spuren.

## Migration aus dem alten Song Maker

`songMakerPatternToMusePattern()` überführt das klassische Raster:
Melodiezellen werden zu einer melodischen Ebene, jede belegte Drum-Zeile zu
einer eigenen Percussion-Ebene, die 16 Schritte zu einem Pattern gleicher
Länge. Das alte Datenmodell (`services/jamRoom/songMaker.ts`) und seine Tests
bleiben unverändert bestehen.

## Bedienung auf Touch

Griffbereiche der Notenkanten sind 12 px breit, Zellen und Lanes sind für
Finger dimensioniert, lange Patterns scrollen horizontal, und keine Aktion
braucht Hover oder die rechte Maustaste. Zoom und Oktavlage werden über Knöpfe
gesetzt statt über Pinch-Gesten.
