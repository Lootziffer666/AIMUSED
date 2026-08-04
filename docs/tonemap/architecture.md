# MUSE ToneMap – Architektur

## Was diese Schicht ist

Eine formatunabhängige Zwischenschicht, die vier Dinge auseinanderhält, die in
MIDI-Dateien und in DAWs üblicherweise zu einem einzigen „Instrumentnamen"
zusammenfallen:

| Ebene | Frage | Beispiel |
| --- | --- | --- |
| Identität | Was wird gespielt? | Motiv B, zweite Wiederholung, eine Quinte höher |
| Funktion | Was tut es musikalisch? | Gegenmelodie im Mittelgrund |
| Klang | Wie klingt es hörbar? | warm, dunkel, weiche Ansprache, wenig Raum |
| Umsetzung | Womit wird es realisiert? | VCSL Cello sustain, Keyswitch 24, Fallback Viola |

Erst diese Trennung erlaubt die eigentliche Zielfrage: „nimm dieses Motiv, mach
es zum dramaturgischen Mittelpunkt, warm und eine Oktave tiefer" – ohne dass
Komposition, Orchestrierung und Mix vermischt werden.

## Audit: worauf aufgebaut wird

Vor dieser Schicht existierten in MUSE bereits:

| Modul | Inhalt | Verhältnis zur ToneMap-Schicht |
| --- | --- | --- |
| `@signal-app/midi-project` | MIDI-Import in ein normalisiertes Projektmodell, Rohbytes bleiben erhalten, Export aus Noten | bleibt unangetastet; ToneMap ergänzt einen **zweiten, verlustarmen** Pfad für die Analyse |
| `@signal-app/orchestration-core` | Rollen-/Sektions-/Motivanalyse, Instrumentenkatalog, Register-Regeln, Rezepte, Plan-Builder, `variants/adaptive` | Vorbild und Nachbar; ToneMap dupliziert es nicht, sondern liefert die *Beleg-* und *Klang*-Ebene, die dort fehlt |
| `@signal-app/player` | SoundFont-Wiedergabe, zentrale AudioClock | bleibt die Audio-Engine; ToneMap bringt keine zweite mit |
| `app/src/services/pattern`, `jamRoom` | Pattern-Editor, Jam Room, Audio-Engine | unberührt |

Bewusste Entscheidung: der bestehende MIDI-Import ist **absichtlich
normalisierend** (er bündelt nach Kanälen, setzt Noten zusammen, verwirft, was
der Arranger nicht braucht). Für einen Goldstandard-Vergleich mit einer
Aufnahme brauchen wir das Gegenteil. Deshalb gibt es
`tonemap-core/src/midi/eventGraph.ts` zusätzlich – nicht als Ersatz.

## Paketaufbau

```
packages/tonemap-core/src/
  schema/       ToneMap IR, Versionierung, Migration, Validierung
  midi/         verlustarmer Event-Graph, Round-Trip, Debugformate
  pairing/      Paired-Source-Manifest, Schutz privater Assets
  audio/        PCM, Decoder-Registry (WAV + FLAC nativ, MP3/OGG lazy),
                deterministische Feature-Extraktion
  alignment/    MIDI/Audio-Alignment mit Ankern und Konfidenz
  motifs/       Stimmen, Phrasen, Motive, Beziehungen
  tonemap/      Zusammenführung: Observations
  orchestration/ nicht-destruktiver Transformationsplan
  libraries/    Library-Manifeste, SFZ-Scanner
  ranking/      Feature-Layout, heuristischer Ranker, ONNX-Runtime-Binding
  render/       Plan → MIDI, Render-Adapter (midi/sfizz/fluidsynth),
                Render-Manifest mit Plan-Fingerprint
  training/     Trainingsdatensätze
  cli/          muse-tonemap
schemas/tonemap/  JSON Schemas + feature-layout-v1.json
fixtures/tonemap/synthetic/  synthetische MIDI-/Audio-Fixtures
```

Das Paket hat genau eine Laufzeitabhängigkeit (`midi-file`, bereits im Repo),
kein DOM, kein React, kein ML-Framework. Die Hauptanwendung baut ohne es.

## Datenfluss

```
MIDI ──► Event-Graph (verlustarm) ──► Voices / Phrasen / Motive
                                          │
Audio ─► PCM ─► Frame-Features ─► Alignment Map
                                          │
                                          ▼
                                  ToneMap Observations
                                  (Funktion, Prominenz, Register,
                                   Klangachsen, Belege, Konfidenz)
                                          │
                      ┌───────────────────┼───────────────────┐
                      ▼                   ▼                   ▼
              MotifDirection      Orchestration-Plan     Feature-Vektor
              (Adaptive Pathos)   (nicht-destruktiv)     (ONNX-ready)
                                          │                   │
                                          ▼                   ▼
                                    Patch-Ranking      Trainingsdatensätze
```

## Prinzipien

1. **Jede automatische Aussage trägt ihren Beleg.** `Provenance` mit `source`,
   `status` (`manually-confirmed` / `derived` / `assumed` / `unresolved`),
   `confidence`, `extractionMethod` und `evidence`.
2. **Niedrige Sicherheit bleibt sichtbar.** Das Alignment meldet
   problematische Abschnitte, statt einen Wert zu behaupten.
3. **Nichts wird still gelöscht.** Unbekannte Felder überleben den Round Trip,
   die Original-MIDI wird nie überschrieben, Transformationen sind umkehrbar.
4. **Keine Modellpflicht.** Der heuristische Ranker funktioniert ohne ONNX;
   der Adapter fällt auf ihn zurück.
5. **Keine zweite Musikdomäne.** Wiedergabe, Song-Modell und Orchestrierungs-
   Rezepte bleiben dort, wo sie schon sind.

## Grenzen (bewusst)

- Strukturelle Rekonstruktion ist **nicht** klangidentische Rekonstruktion.
- Ein Stereo-Mix ohne Stems erlaubt keine eindeutige Instrumentzuordnung; die
  akustischen Werte eines Segments beschreiben die *Summe*, nicht die Stimme.
- Komposition, Orchestrierung und Mix bleiben getrennte Ebenen. Eine gute
  Orchestrierung repariert keinen Mix und umgekehrt.
- Library-Lizenzen lizenzieren nicht die Komposition.
- Referenzaufnahmen werden nie automatisch veröffentlicht.
