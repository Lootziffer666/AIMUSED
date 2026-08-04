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

### Audioformate und Decoder

Unterstützte Formate laut Manifest: WAV, FLAC, MP3, OGG, Opus.

| Format | Decoder | Woher |
| --- | --- | --- |
| WAV | `wavDecoder` | nativ in `audio/pcm.ts`, PCM 8/16/24/32 Bit und Float |
| FLAC | `flacDecoder` | nativ in `audio/flac.ts` |
| MP3 | `mp3Decoder` | `mpg123-decoder` (MIT, WASM), lazy geladen |
| OGG Vorbis | `oggVorbisDecoder` | `@wasm-audio-decoders/ogg-vorbis` (MIT, WASM), lazy geladen |
| Opus | – | im Browser über die Web-Audio-Adapter der App |

Die **verlustfreien** Formate werden selbst dekodiert. Das ist kein Ehrgeiz:
verlustfrei heißt, es gibt genau eine richtige Antwort, und die lässt sich
prüfen – der FLAC-Decoder wird gegen einen eigenen Encoder bit-genau
round-trip-getestet, über alle Subframe-Typen (constant, verbatim, fixed 0–4,
LPC), Rice- und Rice2-Residuen, wasted bits, 8/16/24 Bit und alle drei
Stereo-Dekorrelationen.

Die **verlustbehafteten** Formate gehen bewusst an die Referenz-Implementierungen.
Ein selbstgeschriebener MP3-Decoder, der fast richtig ist, klingt gut und misst
falsch – das schlechteste denkbare Verhalten für eine Analysepipeline.

`createDefaultDecoderRegistry()` enthält nur die verlustfreien Decoder.
`registerLossyDecoders(registry)` ergänzt MP3 und OGG; die CLI tut das, die App
registriert stattdessen Web-Audio-Adapter und lädt die WASM-Pakete nie.
Asynchrone Decoder erreicht man über `decodeAsync`; `decode` bleibt synchron
und sagt es deutlich, wenn ein Decoder asynchron ist.

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

### Ein Modell benutzen

```
node --experimental-strip-types packages/tonemap-core/src/cli/main.ts \
  rank projekt.json --library manifest.json --model modell.onnx
```

`loadOnnxSession` löst die ONNX Runtime zur Laufzeit auf – erst
`onnxruntime-node`, dann `onnxruntime-web`. Keins von beiden ist eine
Abhängigkeit dieses Pakets: fehlt die Runtime, nennt die Fehlermeldung die zu
installierenden Pakete und weist darauf hin, dass Ranking auch ohne Modell
funktioniert.

Vor der ersten Inferenz wird geprüft:

- die Feature-Layout-Version des Contracts gegen die des Builds
- ob das Modell die Eingänge `features` und `mask` und den Ausgang `scores` hat
- ob die Anzahl der zurückgegebenen Scores zu den Kandidaten passt

Die Tensoren sind `float32` mit der Form `[1, 97]`. Das Modell **sortiert nur
um**: die Kandidatenliste kommt vom heuristischen Ranker, `rankAsync` bewertet
sie neu. `rank` bleibt synchron und liefert bewusst das heuristische Ergebnis.
Fällt das Modell aus, wird nicht geworfen – die heuristische Reihenfolge bleibt
und jeder Kandidat trägt `model unavailable: <Grund>` in seinen Begründungen.

### Das Referenzmodell

`fixtures/tonemap/synthetic/reranker-v1.onnx` (3,6 kB) erfüllt genau diesen
Vertrag: Eingänge `features` und `mask` als `float32 [1, 97]`, Ausgang `scores`
als `float32 [1, 8]`. Erzeugt wird es reproduzierbar von
`fixtures/tonemap/synthetic/make-reranker.py` (fester Seed).

Es ist **untrainiert** – die Gewichte sind eine feste Zufallsprojektion. Es
beweist, dass die Verdrahtung stimmt, nicht dass es musikalisch urteilt. Ein
Modell mit Urteilsvermögen kommt nur mit Trainingsdaten, und die entstehen aus
den Entscheidungen im Orchestrierungs-Vergleich.

Die ONNX Runtime ist **keine** Abhängigkeit dieses Pakets: 130 MB soll niemand
laden müssen, nur um die Tests laufen zu lassen. `onnxRuntime.test.ts` läuft
gegen die echte Runtime und das echte Modell und überspringt sich sonst
sichtbar:

```
npm i -D onnxruntime-web -w @signal-app/tonemap-core
npm test -w @signal-app/tonemap-core
```

`onnxSession.test.ts` deckt dieselben Codepfade gegen eine injizierte
Fake-Runtime ab und läuft immer.

### Grenze des aktuellen Vertrags

Das Modell sieht die **Anfrage**, nicht die Kandidaten. Es kann also lernen
„bei dieser Art Stimme nimm eher Position 2 der heuristischen Liste" – eine
schwache Umsortierung mit Positions-Prior, mehr nicht. Ein echter Re-Ranker
bräuchte Merkmale **pro Kandidat**; das wäre Feature-Layout v2 und damit eine
neue Layout-Version, keine stille Änderung dieser.

Es wird bewusst **kein trainiertes** Modell mitgeliefert.

## Rendering

Ein Plan wird nicht direkt zu Audio, sondern zu **Jobs**: welche Dateien
geschrieben, welcher Befehl ausgeführt und welche Ausgabe erwartet wird.
`tonemap-core` startet dabei bewusst **keinen Prozess** – das gehört dem Host.
Genau deshalb lässt sich ein Render planen, lesen und prüfen, ohne dass ein
Renderer installiert ist.

```
node --experimental-strip-types packages/tonemap-core/src/cli/main.ts \
  render projekt.json --plan plan.json --library manifest.json \
  [--adapter midi|sfizz|fluidsynth] [--out render/] [--soundfont gm.sf2] [--dry-run]
```

| Adapter | Braucht | Ergebnis |
| --- | --- | --- |
| `midi` | nichts | `arrangement.mid` plus ein Stem pro Stimme |
| `sfizz` | `sfizz_render`, SFZ-Bibliothek mit gesetztem `rootPath` | ein WAV pro Stimme |
| `fluidsynth` | `fluidsynth`, eine SoundFont | ein WAV für das ganze Arrangement |
| in der App | nichts | Plan-Spuren im Song, spielbar über MUSEs eigenen Player |

Gemeinsame Grundlage ist `planToMidi`: es vergibt die Kanäle (Kanal 10 bleibt
für Perkussion reserviert), schreibt Bank- und Programmwechsel des gewählten
Patches, hält Keyswitches über die gesamte Stimme und setzt eine
Prominenz-Hüllkurve als CC 7 um. Tempo, Takt- und Vorzeichnung werden aus der
Quelldatei übernommen, damit ein Stem zur Referenzaufnahme passt. **Die
Quelldatei selbst wird nie verändert.**

Ein Job, dessen Patch sich nicht auflösen lässt, verschwindet nicht – er wird
mit `issues` beschrieben: fehlender `rootPath`, Patch ohne SFZ, Stimme ohne
gewähltes Patch, mehr Stimmen als MIDI-Kanäle. Stems mit gleichem Namen
bekommen einen Zähler, damit keiner den anderen überschreibt.

### Render-Manifest

`render-manifest.json` hält fest, was gerendert wurde: Adapter, Plan-ID,
gewählte Patches **samt der Begründungen des Rankers**, Bibliotheksversionen,
Ausgabepfade und offene Punkte. Der `planFingerprint` ist ein Inhalts-Hash über
alles, was den Klang ändert – ändert sich der Plan danach, meldet `isStale`,
dass das Audio veraltet ist.

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
