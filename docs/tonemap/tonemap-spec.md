# ToneMap IR – Spezifikation (`muse.tonemap.v1`)

JSON Schema: `schemas/tonemap/tonemap-v1.schema.json`
TypeScript: `packages/tonemap-core/src/schema/tonemap.ts`

## Dokument

```jsonc
{
  "schemaVersion": "muse.tonemap.v1",
  "id": "coMI-theme",
  "name": "Curse of Monkey Island – Titel",
  "createdAt": "...", "updatedAt": "...",
  "sourcePairId": "coMI-theme",     // verweist auf das Paired-Source-Manifest
  "ticksPerQuarterNote": 480,
  "nodes": [ /* Identitätsgraph */ ],
  "observations": [ /* Aussagen über Knoten */ ],
  "directions": [ /* dramaturgische Anweisungen */ ]
}
```

## 1. Identität (`nodes`)

`song → section → track → voice → phrase → motif → motif-occurrence → note-event`

Jeder Knoten hat eine stabile `id`, `parentId`/`childIds` und eine
`provenance`. Motivvarianten zeigen über `variantOfId` auf ihr Motiv und
tragen die Transformation:

```json
{ "id": "o-m-3f2a-v-0-0-0-1920", "kind": "motif-occurrence",
  "variantOfId": "m-3f2a", "variantTransform": { "transposeSemitones": 7, "timeScale": 1 } }
```

Motiv-IDs sind **inhaltsabgeleitet** (Hash aus Intervall- und Rhythmusform).
Dasselbe Motiv bekommt in einer anderen Spur, einem anderen Instrument und
einer anderen Oktave dieselbe ID.

## 2. Funktion

`primary-melody · counter-melody · bass · harmony · pulse · ostinato · texture ·
accent · transition · drone · percussion · effect · unknown`

## 3. Prominenz

Diskreter Zustand (`foreground · midground · background · hidden · emerging ·
receding`), kontinuierlicher Wert `level` (0…1) und optional eine zeitabhängige
`envelope`.

## 4. Register

`lowestMidi`, `highestMidi`, `centroidMidi` (dauergewichtet), `medianMidi`.
Wünsche stehen getrennt davon in `RegisterDirection` (Zielbereich,
Oktavverschiebung, erlaubte/verbotene Bereiche).

## 5. Klangachsen

Gespeichert werden nur **unabhängige** Achsen, jeweils 0…1:

```
brightness warmth softness roughness metallic airy woody breathy density
attackSharpness sustain decay movement intimacy stereoWidth reverberance
presence weight tension
```

Die im Auftrag zusätzlich genannten Gegenachsen werden **abgeleitet, nicht
gespeichert** – so können sich die beiden Hälften eines Paares nie
widersprechen:

| abgeleitet | Formel |
| --- | --- |
| `darkness` | `1 - brightness` |
| `hardness` | `1 - softness` |
| `smoothness` | `1 - roughness` |
| `stability` | `1 - movement` |
| `distance` | `1 - intimacy` |

`deriveTimbreComplements()` ergänzt sie beim Lesen, `normalizeTimbreVector()`
faltet sie beim Schreiben auf die kanonische Achse zurück.

## 6. Artikulation

Bekannte Werte sind aufgezählt (`legato`, `staccato`, `pizzicato`, …), der Typ
bleibt aber offen (`string`): keine Bibliothek hat dieselbe Auswahl, und eine
unbekannte Artikulation muss den Round Trip überleben statt verworfen zu werden.

## 7. Dynamik und Mix

`DynamicProfile` (Velocity-Verteilung, Hüllkurve) und `MixDirection`
(Lautstärkeziel in dBFS, relative Prominenz, Pan, Breite, Tiefe, Reverb-/
Chorus-Send, Ducking-Ziele, Vordergrundpriorität).

## 8. Emotionaler Intent

Strukturierte Achsen (`valence`, `arousal`, `dominance`, `tension`,
`vulnerability`, `dignity`, `menace`, `wonder`, `comedy`, `heroism`,
`intimacy`, `urgency`, `melancholy`, `absurdity`) **und** freie Tags.

Freie Sprache wird wörtlich gespeichert und nie zur Interpretation gezwungen:

```json
{ "axes": { "dignity": 0.7, "comedy": 0.6 },
  "tags": ["unangenehm würdevoll", "zu früh triumphierend"] }
```

## 9. Umsetzung

Streng getrennt von der Semantik: `ImplementationTarget` mit `family`,
`instrument`, `libraryId`, `patchId`, `articulation`, `keyswitch`,
`controllerMapping` und `fallbackCandidates`. Die Absicht „warm, dunkel,
tragend, mittleres bis tiefes Register" kann so je nach installierter
Bibliothek auf Cello, Viola-Ensemble, Horn, Fagott oder ein Synth-Patch fallen.

## 10. Belege

```json
{ "source": "analysis", "status": "derived", "confidence": 0.75,
  "extractionMethod": "role-heuristics-v1",
  "evidence": [{ "kind": "symbolic-feature", "ref": "register",
                 "detail": "höchste monophone Stimme mit melodischer Bewegung" }],
  "createdAt": "..." }
```

`status` unterscheidet ausdrücklich `manually-confirmed`, `derived`, `assumed`
und `unresolved`.

## Versionierung

`MigrationRegistry` kennt den aktuellen Stand und die registrierten Schritte.
Eine **unbekannte, neuere** Version wird abgelehnt statt geraten; eine ältere
wird durch die Hooks migriert. Unbekannte Felder landen in `unknownFields` und
werden beim Schreiben wieder an die Wurzel gehoben.
