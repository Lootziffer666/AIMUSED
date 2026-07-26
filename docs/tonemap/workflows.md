# ToneMap – Arbeitsabläufe

## CLI

Aus dem Repository-Wurzelverzeichnis:

```bash
node --experimental-strip-types packages/tonemap-core/src/cli/main.ts <befehl> [optionen]
```

Node 22 führt TypeScript direkt aus; es gibt keinen Build-Schritt und keine
zusätzliche Laufzeitabhängigkeit. (`npm run tonemap -w @signal-app/tonemap-core --`
funktioniert ebenfalls, arbeitet dann aber relativ zum Paketverzeichnis.)

| Befehl | Zweck |
| --- | --- |
| `import-midi <datei.mid> [--out p.json] [--debug jsonl\|tsv]` | verlustarmer Import, ToneMap-Projekt oder Debugansicht |
| `export-midi <datei.mid> --out <datei.mid>` | Round-Trip-Prüfung; Exit-Code 1, wenn nicht bytegleich |
| `pair --id ID --midi PATH [--audio PATH] --out m.json` | Paired-Source-Manifest anlegen |
| `validate <datei.json>` | Manifest oder Projekt prüfen, inkl. Asset-Ablage |
| `analyze <manifest.json> --out a.json` | Audio-Features extrahieren |
| `align <manifest.json> --out al.json` | Alignment Map erzeugen |
| `motifs <datei.mid> --out m.json` | Stimmen, Phrasen, Motive |
| `tonemap <manifest.json> --out p.json` | kompletter Durchlauf |
| `orchestrate <datei.mid> --out plan.json [--octave-double] [--transpose N]` | Transformationsplan |
| `rank <p.json> --library <lib.json>` | Patch-Ranking je Observation |
| `export-training <p.json> --library <lib.json> --out r.jsonl` | Trainingsdatensätze |

### Beispiel mit den mitgelieferten Fixtures

```bash
R="node --experimental-strip-types packages/tonemap-core/src/cli/main.ts"
$R export-midi fixtures/tonemap/synthetic/reference-events.mid --out /tmp/rt.mid
# -> written: /tmp/rt.mid (byte identical round trip)

$R tonemap fixtures/tonemap/synthetic/pair.json --out /tmp/project.json
$R rank /tmp/project.json --library fixtures/tonemap/synthetic/example-library.json
```

## MIDI-Round-Trip

`midiToGraph` → `graphToMidi` ist bytegleich für die mitgelieferten Fixtures.
Erhalten bleiben: Tickpositionen, PPQ, Tempo-Map, Taktarten, Tonarten,
Tracknamen, Kanäle (auch mehrere pro Track), Program Changes, Note-on/-off
getrennt, Velocity, Controller inkl. Sustain/Expression/Volume/Pan/Reverb/
Chorus, Pitch Bend, Channel- und Note-Aftertouch, Marker, Text/Lyrics und
SysEx als opakes Ereignis.

Zwei Regeln, die den Unterschied machen:

- **Notendauer ist niemals der Abstand zur nächsten Note.** Note-on und
  Note-off bleiben eigene Ereignisse und werden explizit gepaart (FIFO je
  Kanal und Tonhöhe), damit überlappende gleiche Tonhöhen korrekt bleiben.
- **Identische Ereignisse am selben Tick behalten ihre Reihenfolge**
  (`order`-Feld je Track).

Debugformate (`--debug jsonl`, `--debug tsv`) sind *abgeleitete Ansichten*,
nicht die Quelle der Wahrheit.

## Paired-Source-Workflow

1. Referenzaufnahme und handrekonstruiertes MIDI lokal nach `private-assets/`
   legen (gitignored).
2. `pair` erzeugt das Manifest; nur das Manifest wird committet.
3. `validate` prüft Rechte und Ablage und warnt, wenn eine Datei außerhalb der
   privaten Verzeichnisse liegt.
4. `align` erzeugt die Alignment Map, `tonemap` das Projekt.

Unterstützte Audioformate laut Manifest: WAV, FLAC, MP3, OGG, Opus.
**Mitgeliefert ist nur ein WAV-Decoder.** Für alles andere meldet die
Decoder-Registry verständlich, dass kein Decoder registriert ist – ein Host
(Electron, Browser, ffmpeg-Adapter) kann jederzeit einen ergänzen, ohne dass
die Analyse angefasst wird.

## Alignment

Stufe 1 (implementiert): Tempo-Map + globaler Offset aus der Korrelation von
MIDI- und Audio-Onsets, verfeinert über das mittlere Residuum, mit
Ankerpunkten pro Takt. Bekannter Offset aus dem Manifest und manuelle Anker
haben Vorrang.

Genauigkeit: die Onset-Erkennung arbeitet auf Analysefenstern (2048 Samples,
Hop 512), also **etwa ein bis zwei Frames (20–50 ms)**. Für engere Ausrichtung
setzt man manuelle Anker (`withManualAnchor`).

Stufe 2 (vorbereitet, nicht implementiert): abschnittsweises Alignment, DTW,
Drift-Korrektur. Die Datenstruktur (`segments`, `problematicRegions`,
`unmatchedAudioRegions`) trägt bereits, was ein besserer Schätzer liefern muss.

Alles unter `LOW_CONFIDENCE` (0,45) landet als problematischer Abschnitt im
Ergebnis – niedrige Sicherheit wird nie als Gewissheit dargestellt.

## Orchestration-Plan

`createPlanFromGraph` erzeugt je Stimme ein Part. Operationen:
duplizieren, Motiv extrahieren, Instrument zuweisen, Oktav-/Unisono-Verdopplung,
Register verschieben, Melody-Handoff, Akkord aufteilen, Artikulation und
Prominenz setzen.

Jede Operation speichert `inputPartIds`, `outputPartIds`, `parameters`,
`reason`, `confidence` und einen Undo-Schnappschuss. Die Quell-MIDI wird nie
verändert; `undoLastOperation` stellt den Zustand wieder her.

Warnungen: Bereichsüberschreitung, unbequemes Register, Stimmkreuzung,
fehlende Quelle.

## Adaptive-Pathos-Anbindung

`MotifDirection` ist die Schnittstelle zur dramaturgischen Regie:

```jsonc
{
  "motifId": "m-3f2a",
  "trigger": { "type": "tick", "startTick": 1920 },   // oder time/section/game-state/dramatic-event
  "preserve": { "identity": true, "rhythm": true },
  "prominence": { "points": [ { "tick": 1920, "value": 0.2 }, { "tick": 3840, "value": 0.9 } ] },
  "register": { "octaveShift": -1 },
  "instrumentation": { "family": "strings", "instrument": "cello" },
  "articulation": { "articulation": "legato" },
  "mix": { "loudnessTargetDb": -4 },
  "freeTextIntent": "warm, etwas zu groß und leicht peinlich"
}
```

Präzise und vage Anweisungen liegen im selben Objekt. Der freie Text bleibt
erhalten, auch wenn kein Intent-Übersetzer existiert – ein späteres LLM ist
eine Option, keine Laufzeitvoraussetzung.

Das bestehende `@signal-app/orchestration-core` (`variants/adaptive`,
`orchestration/dramaturgy`) bleibt der Ort für Rezepte und Varianten;
`MotifDirection` liefert ihm die motivgenaue Regieanweisung.

## Instrument-Library-Manifeste

Sample-Bibliotheken werden **nicht** eingecheckt. Der Ablauf:

1. `scanSfzLibrary()` liest vorhandene SFZ-Verzeichnisse und übernimmt, was
   dort wirklich steht (Key-Ranges, Velocity-Layer, `seq_length`).
2. Familie und Artikulation werden aus Pfad und Namen über eine sichtbare
   Schlüsselworttabelle abgeleitet – nachvollziehbar und korrigierbar.
3. `mergePatchMetadata()` legt handgepflegte Metadaten darüber.
4. `validateLibraryManifest()` trennt echte Fehler von fehlenden Metadaten und
   liefert einen Missing-Metadata-Bericht.
5. `rootPath` ist maschinenspezifisch; fehlt er, erklärt `LibraryPathError`
   genau das, statt still zu scheitern.

Für VCSL und VSCO 2 CE sind damit Adapter vorbereitet, ohne einen erfundenen
Katalog zu behaupten. `fixtures/tonemap/synthetic/example-library.json` ist ein
kleines Beispielmanifest ohne Samples.

## ONNX-Inference-Contract

`schemas/tonemap/feature-layout-v1.json` (97 Felder) ist der Vertrag:

- feste Feldreihenfolge, dokumentierte Wertebereiche
- alle Werte auf 0…1 normalisiert
- `mask`-Array je Feld: 1 = bekannt, 0 = fehlt (unterscheidet „fehlt" von „null")
- neue Felder kommen in eine neue Layout-Version, nie in die Mitte dieser

Der Contract des Adapters:

```ts
{ featureLayoutVersion: "muse.feature-layout.v1",
  batchSize: -1, inputName: "features", maskName: "mask", outputName: "scores" }
```

Das Modell verarbeitet **keine Audiodateien**, sondern aggregierte Features.
Ohne Modell rankt `HeuristicPatchRanker` – `OnnxPatchRanker` fällt darauf
zurück, solange keine Session injiziert ist. Es wird bewusst **kein** Modell
mittrainiert oder mitgeliefert.

## Training-Record-Format

Eine JSONL-Zeile je Beispiel (`schemas/tonemap/training-record-v1.schema.json`).
Neben positiven und negativen Beispielen gibt es die Klasse, die sonst verloren
geht:

| Tag | Bedeutung |
| --- | --- |
| `good-fit` | passt |
| `wrong-instrument` | falsches Instrument |
| `right-melody-wrong-timbre` | richtige Melodie, falsche Klangfarbe |
| `right-pitch-wrong-register-feel` | richtige Tonhöhe, falsches Registergefühl |
| `background-too-dominant` | Hintergrundspur zu dominant |
| `serendipitous-alternative` | unerwartet, aber musikalisch interessant |
| `better-than-original` | dramaturgisch besser als das Original |
| `technically-correct-emotionally-wrong` | technisch korrekt, emotional falsch |

`serendipitous-alternative` zählt als positives Beispiel, obwohl `accepted`
false ist: ein glücklicher Fehlgriff ist kein Labelfehler, sondern ein Fund.

## Der spätere Monkey-Island-Fall

Ohne Architekturänderung nötig:

1. Originalaufnahme lokal registrieren (`private-assets/`)
2. handrekonstruiertes MIDI registrieren
3. `align` – Ergebnis prüfen, Anker korrigieren
4. Spuren und Motive bestätigen (`status: manually-confirmed`)
5. ToneMap korrigieren
6. VCSL oder VSCO 2 CE als Library-Manifest einhängen (`rootPath` setzen)
7. `orchestrate` – Transformationsplan erzeugen
8. rendern (Renderer-Adapter, siehe „offene Punkte")
9. menschliche Bewertung als Trainingsdatensatz speichern

Offen bleibt für diesen Fall nur Schritt 8: ein Render-Adapter (sfizz/
FluidSynth) ist als optionaler externer Prozess vorgesehen, aber in diesem
Durchgang nicht implementiert.
