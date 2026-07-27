# ADR 0001 – Trennung von Pattern, Track-Layer und Ereignis

Status: angenommen · Kontext: Ausbau des Song Makers zum Pattern-Canvas

## Entscheidung

Wir führen drei getrennte Ebenen ein und halten sie strikt auseinander:

1. **`MusePattern`** – das wiederverwendbare musikalische Objekt: Name, Start,
   aktive Länge, Rastermaß, Timebase und seine Ebenen.
2. **`MusePatternTrackLayer`** – eine Instrumenten- oder Sample-Ebene innerhalb
   eines Patterns: Klangzuweisung, Farbe, Sichtbarkeit/Mute/Solo/Lock und die
   eigenen Ereignisse.
3. **`MusePatternNote`** – ein Ereignis mit Beginn, Dauer, Tonhöhe,
   Anschlagstärke und optional zwei normalisierten Hüllkurven.

Die Ebene besitzt ihre Ereignisse; das Pattern besitzt seine Ebenen. Es gibt
bewusst **keinen** globalen Layer-Stack über den ganzen Song.

## Begründung

- **Rasterposition ist nicht global.** Weil Ereignisse an der Ebene hängen und
  nicht an einer Zelle, können Klavier, Violine, Cello und Kick dieselbe
  Zeitposition belegen, und eine Ebene kann polyphon sein. Ein gemeinsames
  Raster hätte genau das verhindert.
- **Die Länge gehört zum Pattern, nicht zu den Ereignissen.** Dadurch kann der
  Endmarker vor bestehende Ereignisse geschoben werden, ohne sie zu zerstören:
  „aktiv" ist eine Eigenschaft der Beziehung zwischen Pattern-Länge und
  Ereignis, kein Löschvorgang.
- **Kurven gehören zum Ereignis.** Sie sind normalisiert, überleben deshalb
  jede Änderung der Notendauer und brauchen keine globale Automationsspur.
- **Der Song bleibt die Wahrheit für das Arrangement.** Patterns leben in einem
  eigenen Store und werden über eine Bindung `layerId → trackId` in Song-Spuren
  gespiegelt. Das Arrangement muss nichts über Ebenen oder Kurven wissen.

## Konsequenzen

- Alle Bearbeitungsoperationen liegen als reine Funktionen in
  `services/pattern/patternOps.ts` und sind ohne React und ohne Audio testbar;
  Undo/Redo ist damit ein einfacher Snapshot-Stack.
- Editorzustand (Auswahl, aktive Ebene, Zoom, Scroll, offene Leisten) wird
  ausschließlich in der Komponente gehalten und verschmutzt das Pattern-Modell
  nicht.
- Die Wiedergabe liest dasselbe Modell über eine reine Funktion
  (`collectPatternEvents`), sodass Loop-Grenzen, Mute/Solo und gehaltene Noten
  testbar sind, bevor irgendein Ton erklingt.
- Preis: Pattern-Daten und Song-Spuren können auseinanderlaufen, wenn ein Song
  extern verändert wird. Der Adapter fängt das ab, indem er verwaiste Bindungen
  erkennt und die Spur neu anlegt.
