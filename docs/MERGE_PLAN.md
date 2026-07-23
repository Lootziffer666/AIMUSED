# AIMUSED × MUSE — Plan zur Verschmelzung

Status: Entwurf, basierend auf dem AIMUSED-Cleanup (Branch `claude/aimused-signal-cleanup-dvq1bp`), das Firebase, Community, Accounts, Sharing, Marketing-Rewrites und die reinen Cloud-Pakete entfernt hat.

## 0. Ausgangslage in einem Satz

AIMUSED (Signal-Fork) ist die **Ausführungs- und Editier-Engine**: WebGL-Piano-Roll, Arrange View, echtes MIDI-I/O, SoundFont-Synthese, Electron-Desktop, lokales Dateisystem. MUSE ist die **musikalische Intelligenz- und Agenten-Schicht**: Analyse, Rollen-/Motiverkennung, Orchestrierungs-Rezepte, Dramaturgie, Varianten, Humanisierung, und ein validierender Command-Reducer, der bereits für Agentensteuerung (BARD) gebaut ist. Keines der beiden Projekte dupliziert das, was das andere gut kann — sie ergänzen sich fast exakt komplementär. Die Verschmelzung ist kein Rewrite, sondern eine **Portierung von MUSEs framework-unabhängiger `src/lib/**`-Logik in AIMUSEDs Monorepo**, plus ein Neubau der MUSE-UI auf AIMUSEDs bestehenden Komponenten (Piano Roll statt HTML-Tabellen).

## 1. Komplementaritätsmatrix

| Fähigkeit | AIMUSED (bereinigt) | MUSE | Nach Merge |
|---|---|---|---|
| Notendarstellung/-editing | WebGL Piano Roll, Arrange View, Control Pane, Tempo Graph | HTML-Tabellen (kein Canvas, bekanntes Perf-Risiko bei großen Dateien) | AIMUSEDs Piano Roll wird alleinige Darstellung — löst MUSEs dokumentierte Tech-Schuld direkt |
| MIDI-Datenmodell | `Song`/`Track`/`TrackEvent` (packages/core) | `MuseMidiProject` (eigenes Modell, Tempo-Map, Format 0/1 Import/Export, byteidentischer Re-Export) | Ein Adapter-Layer verbindet beide (s. Abschnitt 3), langfristig ein gemeinsames Modell |
| Audio-Synthese | spessasynth-basierter SoundFont-Synth, produktionsreif, an Transport/MIDI-Out gekoppelt (`@signal-app/player`) | `OscillatorRenderer` (deterministisch, headless, Test-Fallback) + `SoundFontRenderer` (soundfont-player, Web-Audio, browserpflichtig) | `@signal-app/player` wird kanonischer hörbarer Renderer; `OscillatorRenderer` bleibt nur als Test-Double |
| Transport/Playback | RootStore-Transport (Play/Pause/Loop/Seek), MIDI-Out | eigener `playbackStore` (zustand), A/B Original/Arrangement | Ein Transport; A/B-Umschaltung wird ein zusätzlicher Modus des bestehenden Transports |
| Musikalische Analyse | keine | deterministische Pipeline (Rollen, Motive, Sections, Tonart, Dichte) mit Konfidenz + Klartext-Beleg | 1:1 übernommen, reine Logik, keine Anpassung nötig |
| Orchestrierung | keine | Instrumentenkatalog, 5 Rezepte, Plan-Builder, Dramaturgie, Register-/Artikulationsregeln | 1:1 übernommen |
| Varianten/Adaptive-Vorbereitung | keine | 6 Basisvarianten, Cue-Points/Loop-Regionen für Adaptive-Pathos | 1:1 übernommen |
| Undo/Redo | vorhanden (vermutlich Editor-lokal) | Snapshot-basiert, 50 Einträge, im Command-Reducer verankert | MUSEs Reducer-Pattern wird für Orchestrierungs-State genutzt; Note-Editing bleibt bei AIMUSEDs bestehendem Undo |
| Persistenz | lokales Dateisystem (.mid via File System Access API), kein Cloud mehr | `.museproj.json` (schemaVersion, Original-MIDI als Base64, Analyse/Plan/Varianten), IndexedDB-Autosave | `.museproj.json` wird zusätzlicher Dateityp in AIMUSEDs lokalem Open/Save; IndexedDB-Autosave bleibt |
| Agentensteuerung | keine (nur MobX-Actions, UI-getrieben) | `MuseCommand` + validierender, reiner Reducer — bereits BARD-fähig | Wird die **kanonische AI-native Schnittstelle** des Gesamtprodukts |
| Desktop/Native | Electron (Menüs, Dateizugriff, BLE-MIDI) | keine (reines Next.js/Browser) | Electron bleibt alleinige Desktop-Hülle |
| Externe Integration | Hardware-MIDI-I/O, BLE-MIDI | Cubase-14-Adapter (MIDI Remote), optionaler Windows-MIDI-Loopback | Beides bleibt bestehen, unabhängig nebeneinander (kein Konflikt) |
| Framework | Vite, React 18, MobX, Emotion | Next.js 16, React 19, zustand, Tailwind | Ziel: AIMUSEDs Stack (Vite/React/MobX) — MUSEs UI-Komponenten werden neu gebaut, nicht 1:1 portiert (s. Abschnitt 4) |

## 2. Zielarchitektur (Monorepo-Layout)

```
AIMUSED/
  app/                     # bestehende Signal-App (Piano Roll, Arrange View, ...)
    src/orchestration/      # NEU: React-Views für Quelle/Analyse/Orchestrierung/Ergebnis/Varianten,
                            #      gebaut auf bestehenden dialog-hooks + MobX-Pattern
  packages/
    core/                   # bestehend: Song/Track/TrackEvent
    player/                 # bestehend: SoundFont-Synth, Transport
    dialog-hooks/           # bestehend
    orchestration-core/      # NEU: Portierung von MUSE src/lib/{analysis,orchestration,variants,commands}
                            #      100% framework-unabhängig, 1:1 aus MUSE übernehmbar
    midi-project/           # NEU: Portierung von MUSE src/lib/{midi,persistence,project}
                            #      inkl. .museproj.json Schema + Migration + Adapter zu @signal-app/core Song
  electron/                 # bestehend, unverändert
  tools/cubase-bridge/      # aus MUSE übernommen (optionaler Transport, kein Startzwang)
  cubase-remote/            # aus MUSE übernommen (Steinberg MIDI Remote Skript)
```

Die vier neuen/portierten Pakete sind bewusst so geschnitten, dass sie **keine** React-Abhängigkeit haben (`orchestration-core`, `midi-project`) — das ist exakt das Versprechen aus MUSEs eigener Architektur ("Alle Kernlogik lebt unter src/lib/\*\*, framework-unabhängig"). Dadurch entfällt das React-18-vs-19-Problem für die Logik komplett; nur die UI-Schicht wird neu gebaut.

## 3. Datenmodell-Brücke

Kern-Entscheidung: **`Song` (AIMUSED/packages/core) bleibt das kanonische, editierbare Modell** (weil die Piano-Roll-Editierung darauf aufsetzt), **`MuseMidiProject` bleibt der Träger für Analyse-/Orchestrierungs-Metadaten**, die pro `Song` mitgeführt werden.

- `midi-project`-Adapter übersetzt `Song ⇄ MuseMidiProject` in beide Richtungen:
  - Import: `.mid`-Datei → wie bisher `songFromMidi()` (AIMUSED) UND parallel `MuseMidiProject`-Import (für Analyse). Beide teilen sich künftig denselben SMF-Parser — MUSEs `midi/import.ts` (inkl. Format-0-Kanalaufteilung, Tempo-Map, stabile Noten-UUIDs) ist strikter/vollständiger getestet als AIMUSEDs bestehender Import und sollte der gemeinsame Parser werden; `songFromMidi` wird auf MUSEs Parser umgestellt statt umgekehrt.
  - Analyse/Orchestrierung arbeitet weiterhin auf `MuseMidiProject`/`MuseRenderableProject`, referenziert aber Track-/Note-IDs, die 1:1 mit `Song`/`Track`-IDs übereinstimmen (gemeinsame ID-Domäne statt zweier paralleler ID-Räume).
  - Ergebnis (`render-project.ts`-Output) wird zurück in einen `Song` projiziert, damit die Piano Roll das orchestrierte Arrangement direkt darstellen und der Nutzer es dort manuell nachbearbeiten kann (statt nur Tabellen/Read-only).
- `.museproj.json` wird ein neuer Dateityp in AIMUSEDs lokalen Open/Save-Actions (`app/src/actions/file.ts`), analog zu `.mid`: enthält Original-MIDI (Base64, byteidentisch), den `Song`-Snapshot, sowie Analyse/Plan/Varianten. Kein Cloud-Storage nötig — das ist bereits reines Lokal-Dateiformat.

## 4. UI-Verschmelzung

MUSEs "vier Zonen" (Quelle/Analyse/Orchestrierung/Ergebnis) plus Transportleiste werden **nicht** aus Next.js übernommen, sondern als neue Views/Panels im AIMUSED-App-Shell nachgebaut:

- Neue Route/Panel-Familie unter `app/src/components/Orchestration/*`, im selben MobX/RootStore-Pattern wie bestehende Panels (ControlPane, EventEditor, InstrumentBrowser).
- **Ergebnis-Zone** wird kein separates Panel, sondern eine Ansicht der bestehenden Piano Roll/Arrange View mit einem Overlay, das pro Note/Spur die Entscheidungs-Herkunft zeigt (Quelle/Analyse/Rezept/manuell/Agent-Badge — MUSEs `MuseDecision.origin`), umgesetzt als zusätzlicher WebGL-Layer analog zum bestehenden Velocity/CC-Rendering.
- **Analyse-/Orchestrierungs-Zone**: reine Formulare/Listen (Rollen, Rezept-Auswahl, Register-/Artikulations-Overrides) — kann relativ direkt aus MUSEs Komponentenlogik übernommen werden (State-Zugriff über neue MobX-Wrapper statt zustand-Hooks), da UI-Komplexität hier gering ist (Radix/Emotion statt Tailwind).
- `ConfidenceBar.tsx` (Konfidenz-Balken für Rollen-/Motiv-Erkennung) ist trivial nach Emotion/Radix zu portieren.
- Tailwind/Next.js-spezifischer Code (Routing, `src/app/*`) wird verworfen; nur `src/components/*` als Referenz-Implementierung für die neuen AIMUSED-Panels genutzt.

## 5. State-Management-Brücke

- MUSEs `applyCommand(project, command) -> project` (reiner Reducer, wirft `MuseCommandError` statt zu mutieren) wird **unverändert** in `packages/orchestration-core` übernommen — das ist bereits framework-agnostisch und passt ohne Anpassung.
- Ein neuer MobX-Store `OrchestrationStore` (analog zu `SongStore`/`ControlStore` in AIMUSEDs RootStore) hält `project: MuseRenderableProject`, `past`/`future`-Snapshots (MUSEs 50-Einträge-Historie-Logik 1:1 übernommen) und ruft bei jeder Mutation `applyCommand` auf statt einer zustand-`set()`.
- `zustand` wird nicht in AIMUSED eingeführt — das bestehende MobX-Reactivity-Modell bleibt einheitlich für das Gesamtprodukt.
- Undo/Redo bleibt zweigeteilt nach Domäne: Noten-Editing (Piano Roll) nutzt weiterhin AIMUSEDs bestehenden Undo-Mechanismus; Orchestrierungs-Entscheidungen (Rolle, Instrument, Rezept, Variante) nutzen MUSEs Command-Historie. Das ist kein Kompromiss, sondern folgt der sauberen Trennung, die MUSE selbst schon vorsieht (Command-System owns Orchestrierung, nicht rohe Notenedits).

## 6. Audio/Playback-Konsolidierung

- `@signal-app/player` (spessasynth) wird der einzige hörbare Renderer für Original **und** orchestriertes Arrangement — ersetzt MUSEs `SoundFontRenderer`.
- MUSEs `MuseRenderer`-Interface (`prepare/play/pause/stop/seek/render/dispose`) bleibt als Abstraktion bestehen; `@signal-app/player` bekommt einen Adapter, der dieses Interface implementiert, damit Mix-/Stem-Export (WAV, gruppiert nach Instrumentenfamilie) unverändert funktioniert.
- `OscillatorRenderer` bleibt exakt wie in MUSE als **Test-Double** (headless, deterministisch, keine Web-Audio-Abhängigkeit) — wird nicht ersetzt, da AIMUSEDs Player ebenfalls browserpflichtig ist und Unit-Tests weiterhin einen Node-fähigen Fallback brauchen.
- SoundFont-Lizenzstatus/Attribution (aus MUSEs `docs/ATTRIBUTIONS.md`) wird unverändert übernommen; kein neuer Rechteklärungsbedarf, da AIMUSED bereits SoundFonts (spessasynth) einsetzt.

## 7. Agentensteuerung als AI-native Kernfunktion

Das ist der eigentliche strategische Gewinn der Verschmelzung: AIMUSED hatte bisher **keine** agentenfähige Steuerungs-API — nur MobX-Actions, gedacht für direkte UI-Bedienung. MUSEs `MuseCommand`-Modell liefert genau das fehlende Stück.

- Phase 1 (kurzfristig): `MuseCommand`-Reducer bleibt auf Orchestrierungs-Domäne beschränkt (Rolle setzen, Instrument zuweisen, Rezept anwenden, Section-Intensität, Variante erzeugen, Undo/Redo) — sofort nutzbar, kein Risiko für die Notenebene.
- Phase 2 (mittelfristig): Command-Set erweitern um Noten-/Track-Operationen (Note hinzufügen/verschieben/löschen, Quantisieren, Track anlegen), sodass ein Agent (BARD oder ein Claude-Agent) das komplette Editing über denselben validierten, seriellisierbaren Kanal steuert wie die UI — keine ungeprüfte Direktmutation, exakt wie im MUSE-Architekturprinzip ("Es gibt keinen separaten, ungeprüften Agenten-Pfad").
- Das macht die Command-API zum einzigen offiziellen Automatisierungs-/Scripting-Interface des Gesamtprodukts — nützlich weit über BARD hinaus (z. B. Batch-Verarbeitung, Tests, künftige Plugin-Schnittstellen).

## 8. Migrationsschritte (inkrementell, jeweils einzeln testbar)

1. **Cleanup verifizieren** (dieser Task): AIMUSED baut/lintet grün ohne Firebase/Community/Accounts.
2. `packages/orchestration-core` anlegen: MUSEs `src/lib/{analysis,orchestration,variants,commands}` 1:1 hinüberkopieren, Tests mitnehmen (`bun test` → `vitest`, da AIMUSED Vitest nutzt), Pfad-Aliase (`@/lib/...`) auf Package-Exports umstellen.
3. `packages/midi-project` anlegen: MUSEs `src/lib/{midi,persistence,project}` hinüberkopieren, Adapter `Song ⇄ MuseMidiProject` schreiben + testen.
4. Audio-Adapter: `@signal-app/player` hinter `MuseRenderer`-Interface kapseln, Mix-/Stem-Export gegen bestehenden Testsatz aus MUSE laufen lassen (`OscillatorRenderer` weiterhin als Fallback in Tests).
5. `OrchestrationStore` in AIMUSEDs RootStore verdrahten (Command-Reducer + Historie).
6. Neue UI-Panels bauen (Analyse/Orchestrierung/Varianten), Ergebnis-Ansicht in Piano Roll integrieren (Origin-Badges als WebGL-Overlay).
7. `.museproj.json` als Dateityp in `actions/file.ts` registrieren (Open/Save/Autosave via IndexedDB, wie in MUSE bereits gebaut).
8. Cubase-Bridge (`tools/cubase-bridge`, `cubase-remote`, `src/lib/integrations/cubase`) unverändert als optionales, nicht-startpflichtiges Feature übernehmen.
9. Humming/Live-Musikus-Pipeline (Pitch-Tracking, Onset-Detection) als Kernlogik übernehmen; Browser-Mikrofon-UI bleibt bewusst ein späterer Meilenstein (M8, wie in MUSEs eigener Roadmap).
10. Alte MUSE-Next.js-App stilllegen/archivieren, sobald die neuen AIMUSED-Panels funktional gleichwertig sind (Statusmatrix aus `docs/STATUS.md` als Abnahmekriterium je Feature).

## 8a. Status (Stand: dritte Ausführungs-Runde dieses Plans)

**Abschluss-Hinweis (dritte Runde):** Mit dieser Runde ist die geplante Merge-Kette **analyse → orchestrieren → auf Song anwenden → hörbar/editierbar in der bestehenden Engine → Audio-Export → Projekt-Persistenz → Herkunfts-Sichtbarkeit** vollständig umgesetzt. Alle in Runde 1 und 2 als offen vermerkten Punkte aus dieser Kette sind erledigt; die einzigen bewusst außerhalb des Scopes verbliebenen MUSE-Features sind **Humming/Live-Musikus-Pipeline** und die **Cubase-Bridge** — beide von Anfang an laut Aufgabenstellung und MUSEs eigener Roadmap (M8) explizit außerhalb des "AIMUSED fertigstellen"-Auftrags, nicht nur dieser Runde. Details unten unter „Dritte Runde" und im aktualisierten „Nicht erledigt"-Abschnitt.

Die erste Runde hat Schritte 2, 3 (teilweise), 5 und 6 (teilweise) umgesetzt. Die **zweite Runde** hat zwei der in der ersten Runde offen gelassenen Punkte aufgegriffen: Mix-/Stem-Audio-Export für das orchestrierte Arrangement (statt des im ursprünglichen Plan vorgesehenen MUSE-`MuseRenderer`-Ports, s. u.) sowie den `.museproj.json`-Dateityp (Schritt 7). Beides wurde real verifiziert (Build/Typecheck/Lint/Test grün, siehe unten). Im Detail, in Ausführungsreihenfolge:

**Erledigt:**

- **Schritt 2 — `packages/orchestration-core`**: MUSEs `src/lib/{analysis,orchestration,variants}` sowie `id.ts`/`seed-random.ts`/`bytes.ts` 1:1 portiert (Verhalten unverändert, nur Import-Pfade angepasst). Tests von `bun:test` auf `vitest` umgestellt, alle grün.
  - **Abweichung vom Plan**: `commands/` (der Command-Reducer) wurde **nicht** in `orchestration-core`, sondern in `packages/midi-project` platziert. Grund: `commands/reducer.ts` braucht zwingend `createProjectFromMidiBytes`/`MuseMidiProject` aus dem MIDI-Projekt-Paket (echte Werte, keine reinen Typen), während `midi-project` bereits umgekehrt von `orchestration-core` abhängt (für `MuseAnalysisResult`/`MuseArrangementPlan`/Varianten-Typen). Beide Pakete gegenseitig voneinander abhängig zu machen, ist zur Laufzeit über ESM zwar technisch oft lösbar, aber **Turbo verweigert grundsätzlich zyklische Workspace-Abhängigkeiten** (`Invalid package dependency graph: Cyclic dependency detected`) — `npm test`/`npm run build` liefen damit nicht mehr. Die Auflösung: harte, einseitige Abhängigkeit `midi-project -> orchestration-core`; `orchestration-core` dupliziert die kleinen, reinen MIDI-Domänentypen (`midi-types.ts`, `project-types.ts`, `tick-time.ts` — reine Typdeklarationen bzw. eine winzige zustandslose Funktion, kein Zustand, keine Logik) statt sie zu importieren. TypeScripts strukturelle Typisierung macht die echten `MuseMidiProject`/`MuseMidiTrack`-Werte aus `midi-project` weiterhin klaglos kompatibel. `exportArrangedMidi` (der einzige Schritt, der wirklich `buildMidiFromTracks`/`midi-file` braucht) liegt jetzt ebenfalls in `midi-project` (`arranged-export.ts`); `buildArrangedExportTracks` (reine Datenaufbereitung, keine MIDI-Byte-Serialisierung) bleibt in `orchestration-core`.
  - Zusätzlich: `orchestration-core` exportiert einen schmalen `./shared`-Subpfad (nur `id.ts`/`seed-random.ts`/`bytes.ts`) — den nutzt `midi-project` für die drei kleinen Utility-Funktionen, die es von `orchestration-core` braucht, ohne dafür das komplette `orchestration-core`-Barrel (das selbst wieder `midi-project` importiert) zu laden. Damit ist der Laufzeit-Modulgraph garantiert azyklisch.
- **Schritt 3 — `packages/midi-project`**: MUSEs `src/lib/{midi,persistence,project}` **plus** `commands/` (s.o.) und ein neues `arranged-export.ts` portiert. Adapter `Song ⇄ MuseMidiProject` (`app/src/services/orchestration/songAdapter.ts`) geschrieben und getestet — round-trip über echte MIDI-Bytes (`songToMidi` → `createProjectFromMidiBytes`), wie im Plan empfohlen.
- **Schritt 5 — `OrchestrationStore`**: MobX-Store mit MUSEs Snapshot-Undo/Redo-Verhalten (50 Einträge) portiert, in `RootStore` verdrahtet. `dispatch()` lässt `MuseCommandError` bewusst durchschlagen (kein catch-and-store-lastError wie im zustand-Original), damit die UI sie als Toast zeigen kann.
- **Schritt 6 (teilweise) — UI**: `OrchestrationDialog` gebaut (Analyse-Button, Rollenliste mit Konfidenz/Beleg, Rezept-Auswahl aus allen 5 Katalog-Rezepten, Ergebnis-Liste mit Instrument/Origin/Reason, „Auf Song anwenden"-Button, Undo/Redo). Menüeintrag in `EditMenu.tsx`, neuer Dialog-Atom in `useRootView.tsx`, Lokalisierungs-Schlüssel in allen 6 vorhandenen Sprachblöcken (en/fr/ja/zh-Hans/zh-Hant/sk — Nicht-Englisch nutzt den englischen Text als Platzhalter). **Noch nicht umgesetzt**: WebGL-Origin-Badge-Overlay in der Piano Roll (s. „Nicht erledigt" unten).

**Zweite Runde — zusätzlich erledigt:**

- **Mix-/Stem-Audio-Export für das orchestrierte Arrangement (Ersatz für Schritt 4)**: Statt MUSEs eigene `MuseRenderer`/`SoundFontRenderer`-Abstraktion zu portieren (das hätte AIMUSEDs bereits vorhandene, reifere Offline-Rendering-Pipeline dupliziert), nutzt der neue Export `packages/player/src/renderAudio.ts` + `app/src/helpers/encodeAudio.ts`'s `encodeWAV` exakt so wie das bestehende `useExport.tsx`/`ExportProgressDialog` — nur auf die Track-Teilmenge beschränkt, die die letzte „Auf Song anwenden"-Aktion erzeugt hat.
  - Neue, dependency-freie Hilfsfunktionen `app/src/services/orchestration/orchestrationExport.ts`: `filterEventsByTrackIds` (filtert `Song.allEvents`/`PlayerEvent[]` nach `trackId` — jedes Event trägt bereits ein `trackId`-Feld, s. `packages/core/src/entities/song/collectAllEvents.ts`) und `groupAppliedTracksByFamily` (gruppiert nach MUSEs Instrumentenfamilie). Beide mit echten Unit-Tests (`orchestrationExport.test.ts`) abgedeckt. Die eigentliche `OfflineAudioContext`-Renderung selbst ist in dieser Umgebung nicht unit-testbar (kein echtes Audio-Backend) — das wurde bewusst nicht erzwungen.
  - `MuseExportTrackInput` (`packages/orchestration-core/src/orchestration/render-project.ts`, strukturell dupliziert in `packages/midi-project/src/midi/export.ts`) bekam zwei neue Felder, `groupId`/`groupName`, befüllt von `buildArrangedExportTracks` aus derselben `familyGroupId`/`FAMILY_GROUP_LABELS`-Logik, die schon `buildRenderableProject` für die Render-Gruppen (Strings/Woodwinds/Brass/Percussion/Keys/Choir/Additional) nutzt — rein additiv, keine bestehenden Tests angefasst.
  - Neuer Hook `app/src/hooks/useOrchestrationExport.tsx` (eigene Jotai-Atome, bewusst getrennt von `useExport.tsx`, um den bestehenden Song-Export nicht zu berühren) plus `OrchestrationExportProgressDialog.tsx` (Fortschrittsbalken + Cancel, gleiche UX wie `ExportProgressDialog`). Zwei neue Buttons in `OrchestrationDialog` („Export mix as WAV“ / „Export stems as WAV“), aktiv sobald mindestens eine „Auf Song anwenden“-Aktion stattgefunden hat.
  - **Entscheidung Stems-Download**: sequentielle Einzel-Downloads über das bestehende `downloadBlob` (kein Zip — es gibt keine Zip-Bibliothek im Repo, wurde für dieses v1 bewusst nicht hinzugefügt), mit 400 ms Pause zwischen den Downloads, da Browser (v. a. Chrome) mehrere programmatische Downloads aus einem einzigen Klick ohne Nutzergeste pro Datei drosseln/blockieren können.
- **`.museproj.json`-Dateityp (Schritt 7)**: neue Actions `app/src/actions/projectFile.ts` mit `useOpenProjectFile`/`useSaveProjectFileAs`, analog zu `actions/file.ts`s Open/Save-Mustern (File-System-Access-API, gleiche Fehlerbehandlung).
  - **Open**: parst/migriert über `@signal-app/midi-project`s `parseProjectFile`, dekodiert die eingebettete Original-MIDI (`source.rawBase64`) über `songFromMidi` — exakt wie ein normales `.mid`-Open — und hydriert `OrchestrationStore` mit der gespeicherten Analyse/Arrangement/Varianten via `orchestrationStore.loadProject(project, mapping)`.
  - **Track-ID-Mapping**: `songAdapter.ts`s bisher nur intern genutzte `museTrackIdToSongTrackId`-Logik wurde in eine eigenständige, wiederverwendbare Funktion `buildMuseTrackMapping(song, project)` extrahiert (von `songToMuseProject` jetzt selbst genutzt) und beim Öffnen einer `.museproj.json`-Datei erneut aufgerufen — der frisch aus dem eingebetteten MIDI dekodierte `Song` bekommt neue Track-IDs, aber `MuseMidiTrack.index` bleibt stabil (gleiche Track-Reihenfolge in beiden Richtungen), sodass die Zuordnung 1:1 rekonstruierbar ist. `OrchestrationStore` bekam dafür ein neues `trackMapping`-Feld (`loadProject(project, mapping?)`).
  - **Save**: schreibt den aktuellen `Song` + `OrchestrationStore.project` (falls noch nicht analysiert: baut `useSaveProjectFileAs` das Projekt on-the-fly per `songToMuseProject`, da das Schema `analysis: null`/`arrangement: null` bereits zulässt) über `serializeProjectFile` in eine neue `.museproj.json`-Datei.
  - **Bewusst nicht** wird `song.fileHandle` auf die `.museproj.json`-Datei gesetzt: AIMUSEDs bestehendes „Save“ schreibt rohe MIDI-Bytes auf `song.fileHandle` — würde die Projektdatei sonst still korrumpieren. „Save Project As…“ ist deshalb eine bewusst eigenständige Aktion (kein „Save Project“ ohne „As“ in diesem Durchgang).
  - Menüeinträge „Open Project (.museproj.json)…“ / „Save Project As…“ in `FileMenu.tsx` (dem File-System-Access-API-Pfad, analog zu den bestehenden Einträgen dort — nicht in `LegacyFileMenu.tsx`, da `.museproj.json` inhärent die File-System-Access-API braucht; auch nicht in Electrons nativem Menü, da die Electron-Hülle laut Abschnitt 10 unverändert bleibt). Lokalisierungs-Schlüssel in allen 6 Sprachblöcken (Platzhalter-Muster wie bei Schritt 6).
  - **Autosave**: `OrchestrationStore` ruft `idb-store.ts`s `saveProjectToIdb` jetzt automatisch über eine MobX-`reaction` auf `this.project` auf — bei jedem `loadProject`/`dispatch`/`undo`/`redo`, fire-and-forget mit `console.warn` bei Fehlschlag. Bewusst **nicht** angefasst: AIMUSEDs bestehendes `AutoSaveService.ts` (localStorage-Autosave für den reinen Song) — komplett getrennter Pfad, wie im Plan vorgesehen.
    - **Bewusst vereinfacht — Restore-UX**: kein vollständiger „Autosave wiederherstellen“-Dialog. `OnInit.tsx` prüft beim Start via `listProjectsInIdb()`, ob IndexedDB-Autosaves existieren, und gibt nur eine `console.info`-Meldung aus (Anzahl + Name/Zeitstempel des jüngsten Projekts). Eine echte Restore-Prompt-UI wäre über den Scope dieser Runde hinausgegangen — bewusst zurückgestellt, siehe „Nicht erledigt“ unten.
  - **Tests**: Round-Trip-Test (`songAdapter.test.ts`) baut ein `MuseMidiProject` über `songToMuseProject`, serialisiert via `serializeProjectFile`, parst zurück und prüft strukturelle Gleichheit — je einmal mit und einmal ohne Analyse/Arrangement (`null`-Fall). Zusätzlicher Test rekonstruiert das Track-ID-Mapping nach einem simulierten Re-Open. `OrchestrationStore.test.ts` nutzt dieselbe `fake-indexeddb/auto`-Test-Infrastruktur wie das bereits portierte `idb-store.test.ts` (dafür `fake-indexeddb` als `devDependency` zu `app/package.json` hinzugefügt) und prüft, dass `loadProject`/`dispatch`/`undo` jeweils einen Autosave auslösen.

**Dritte Runde — Origin-Badge (letzter offene Punkt aus Schritt 6):**

- **Scoping-Korrektur gegenüber dem ursprünglichen Plan**: Abschnitt 4/Schritt 6 hatten ursprünglich einen **WebGL-Overlay pro Note** vorgesehen ("Ergebnis-Zone ... als zusätzlicher WebGL-Layer analog zum bestehenden Velocity/CC-Rendering"). Recherche in dieser Runde ergab: MUSEs Orchestrierungs-Entscheidungen (Instrumentenzuweisung, Doubling, Oktavshift, Artikulation, Rolle) werden **pro Track/Part**, nicht pro einzelner Note, festgehalten (`MuseInstrumentAssignment` in `packages/orchestration-core/src/orchestration/types.ts`). Ein Per-Note-WebGL-Badge würde also eine Granularität erzwingen, die in den zugrunde liegenden Daten gar nicht existiert. Der richtige Integrationspunkt ist stattdessen `app/src/components/PianoRoll/InstrumentMark.tsx` — eine bestehende, reine DOM-Komponente (Emotion-`styled`, kein Canvas/WebGL), die AIMUSED bereits für jedes Program-Change-Event pro Spur in der Piano Roll einblendet. Gebaut wurde also ein **track-Level-DOM-Badge in `InstrumentMark`**, kein WebGL-Per-Note-Overlay — bewusste Abweichung vom Plan-Wortlaut, aber die tatsächlich passende Umsetzung für die vorhandene Datengranularität.
- **Datenfluss**: `MuseExportTrackInput` (strukturell dupliziert zwischen `packages/orchestration-core/src/orchestration/render-project.ts` und `packages/midi-project/src/midi/export.ts`, wie schon bei `groupId`/`groupName`) bekam ein neues Feld `assignmentId` (die erzeugende `MuseInstrumentAssignment.id`), befüllt in `buildArrangedExportTracks`. `AppliedOrchestrationTrack` (`app/src/services/orchestration/orchestrationExport.ts`, bereits die "vom letzten Apply erzeugte Tracks"-Struktur aus der zweiten Runde für den Export) bekam dasselbe Feld optional dazu — **keine zweite parallele Tracking-Struktur**, sondern Erweiterung der bestehenden.
  - Die Liste selbst (`appliedTracks`) wurde von lokalem `useState` in `OrchestrationDialog.tsx` in `OrchestrationStore` verschoben (`OrchestrationStore.appliedTracks` + `recordAppliedTracks(...)`), da `InstrumentMark` sie auch sehen muss, wenn der Dialog geschlossen/unmounted ist — Dialog-lokaler State hätte das nicht überlebt. Verhalten für den bestehenden Mix-/Stem-Export bleibt unverändert (derselbe Wert, nur aus dem Store statt aus `useState` gelesen).
  - Reine Lookup-Funktion `app/src/services/orchestration/orchestrationOrigin.ts`s `findTrackOrchestrationOrigin(appliedTracks, arrangement, trackId)`: bildet `TrackId -> { origin, reason, role } | undefined` ab, `undefined` sowohl für nie orchestrierte Tracks als auch für eine veraltete `assignmentId` (z. B. nach erneutem Analysieren/Undo, wenn der Plan gewechselt hat) — beides wird identisch als "kein Badge" behandelt. Mit echten Unit-Tests abgedeckt (`orchestrationOrigin.test.ts`, 5 Fälle).
  - Neuer Hook `useTrackOrchestrationOrigin(trackId)` in `app/src/hooks/useOrchestration.ts` (reaktiv über `useMobxSelector` mit `lodash.isEqual` als Vergleichsfunktion, da die Lookup-Funktion pro Aufruf ein frisches Objekt zurückgibt — derselbe Trick, den `usePianoRoll.tsx`s `ghostTrackIds` schon für abgeleitete Arrays nutzt, um einen Endlos-Re-Render-Loop mit `Object.is` zu vermeiden).
- **UI**: `InstrumentMark.tsx` rendert bei vorhandener Entscheidung einen kleinen farbigen Buchstaben-Badge neben dem Instrumentennamen — `S`/`A`/`R`/`U`/`Ag` für `source`/`analysis`/`recipe`/`user`/`agent`. Farben nutzen ausschließlich vorhandene Theme-Tokens (`var(--color-theme|green|yellow|red|text-secondary)` aus `GlobalCSS.tsx`/`Theme.ts`, keine neuen Hex-Werte); Vordergrundfarbe ist `var(--color-on-surface)`, in `Theme.ts` explizit als "content color on themeColor" dokumentiert — exakt der Anwendungsfall eines Textes auf einem akzentfarbenen Chip. Der `MuseDecision.reason`-Text erscheint als natives Tooltip über die bereits im Codebase vorhandene `Tooltip`-Komponente (`app/src/components/ui/Tooltip.tsx`, Radix-basiert, schon an mehreren Stellen wie `AutoScrollButton.tsx` verwendet) — kein natives `title`, da diese Komponente bereits existiert und konsistent genutzt wird.
- **Rolle/Doubling**: Der Lookup gibt zusätzlich `role` zurück (kostet nichts extra, sitzt auf derselben `MuseInstrumentAssignment`), wird aber aktuell nicht separat im Badge angezeigt — Instrument-Zuweisungs-Origin ist die geforderte Mindestanforderung und allein ausreichend; Rollen-/Doubling-Badges wären eine mögliche spätere Erweiterung, aber bewusst nicht Teil dieser Runde, um den Umfang klein zu halten.
- **Tests**: `orchestrationOrigin.test.ts` (5 Fälle: kein Arrangement, Track nie angewendet, fehlende `assignmentId`, veraltete `assignmentId`, erfolgreicher Lookup) sowie `InstrumentMark.test.tsx` (3 Fälle: kein Badge ohne Entscheidung, `R`-Badge für `recipe`, `Ag`-Badge für `agent`) — Component-Test mit React Testing Library, analog zum bestehenden Muster in `VolumeSlider.test.tsx` (Hooks gemockt statt echter Store/Provider-Aufbau; `InstrumentBrowser` komplett gemockt, da für das Badge-Verhalten irrelevant und mit eigenen Store-Abhängigkeiten behaftet).

**Nicht erledigt (bewusst zurückgestellt, siehe Scope der Aufgabe):**

- **Autosave-Restore-UI** für `.museproj.json`/IndexedDB-Projekte: nur ein Start-Log (s. o.), keine „Projekt X wiederherstellen?“-Dialog-UI und kein automatisches Laden. Nutzer müssen eine `.museproj.json`-Datei explizit über „Open Project…“ öffnen; ein rein IndexedDB-natives Projekt (nie als Datei gespeichert) ist über die UI aktuell nicht erreichbar.
- **Cubase-Bridge** (Schritt 8): nicht übernommen — außerhalb des Scopes des gesamten "AIMUSED fertigstellen"-Auftrags, nicht nur dieser Runde.
- **Humming-Pipeline** (Schritt 9): nicht übernommen — außerhalb des Scopes des gesamten Auftrags, MUSEs eigene Roadmap verschiebt das ohnehin auf M8.
- **Alte MUSE-Next.js-App stilllegen** (Schritt 10): nicht relevant, solange die AIMUSED-Panels dem MUSE-Funktionsumfang noch nicht gleichwertig sind (u. a. wegen der zwei obigen Punkte).
- Undo/Redo-Buttons im `OrchestrationDialog` wurden entgegen der ursprünglichen „nice-to-have, nicht erforderlich"-Einschätzung doch umgesetzt, da der Store sie bereits unterstützt und der Aufwand gering war.
- **Bekannte Einschränkung**: `useSaveProjectFileAs` geht davon aus, dass `orchestrationStore.project` (falls vorhanden) zum übergebenen `Song` gehört — wechselt ein Nutzer den Song, ohne neu zu analysieren, kann das veraltete Analyse-/Arrangement-Daten in die neue `.museproj.json`-Datei schreiben. Für diese Runde nicht abgefangen (kein zusätzlicher State-Vergleich Song↔Projekt). Dieselbe Art von "veraltet nach Song-Wechsel"-Lücke gilt jetzt auch für den Origin-Badge (behandelt als "kein Badge", s. o. — kein falscher Badge, aber ein potenziell fehlender, wenn der Nutzer den Song wechselt ohne neu zu analysieren).

**Build/Test-Status dieser Runde**: `npx turbo build`, `npm run typecheck -w app` und `npx turbo test` laufen grün (`exit 0`) für alle sechs Workspace-Pakete (`@signal-app/core`, `@signal-app/player`, `dialog-hooks`, `@signal-app/orchestration-core`, `@signal-app/midi-project`, `signal`/`app`). `npx turbo test` stieg von 131 auf 139 grüne Tests (+8: `orchestrationOrigin.test.ts` 5, `InstrumentMark.test.tsx` 3). `npx turbo lint` schlägt weiterhin mit demselben vorbestehenden `dialog-hooks#lint`-Fehler fehl (Prettier-Formatierungsabweichung in `packages/dialog-hooks/src`) — per `git stash`/erneutem Lauf auf dem unveränderten Basis-Branch verifiziert, dass dieser Fehler identisch **ohne** die Änderungen dieser Runde auftritt, also nicht durch diese Aufgabe verursacht wurde. Die für dieses Projekt tatsächlich maßgebliche Prüfung, `npm run lint -w app` (Biome, das `package.json`-Kommando aus diesem CLAUDE.md), bleibt grün: 369 geprüfte Dateien (366 → 369, die drei neuen Dateien dieser Runde), unverändert 87 Warnungen und 13 Infos (keine einzige neue), `exit 0`. Der Top-Level-`npm run lint` (Biome über das gesamte Repo) ist ebenfalls `exit 0`.

## 9. Offene Entscheidungen / Risiken

- **SMF-Parser-Wahl**: MUSEs Importer ist nachweislich strenger getestet (Format-0-Split, SMPTE-Ablehnung, Stuck-Note-Handling) — Empfehlung: als gemeinsamer Parser übernehmen, `songFromMidi` darauf umstellen. Aufwand: mittel, Nutzen: hoch (ein Parser statt zwei).
- **Undo/Redo-Two-Track**: getrennte Historie für Noten vs. Orchestrierung ist bewusst, aber Nutzer könnten „ein Undo für alles" erwarten — UX-Entscheidung, ob beide Historien in der UI zusammengeführt angezeigt werden.
- **Command-Set-Erweiterung (Phase 2)**: Sicherheitsradius für Agenten-Zugriff auf rohe Notenedits sollte vor Ausbau bewusst festgelegt werden (z. B. Bestätigungspflicht bei destruktiven Commands).
- **SoundFont-Netzwerkabhängigkeit**: MUSEs Standard-Mirror (gleitz.github.io) war in der Sandbox nicht erreichbar; für Produktion ggf. selbst gehosteten Spiegel einplanen (in MUSEs `docs/STATUS.md` bereits als nächster Meilenstein vermerkt).
- **Next.js-Reste**: `next.config.ts`, `src/app/*`, Tailwind/PostCSS werden nicht migriert — sobald die AIMUSED-Panels den MUSE-Funktionsumfang erreichen, kann das MUSE-Repo als eigenständige Next.js-App archiviert oder auf die portierten Pakete reduziert werden.

## 10. Bewusst unverändert / außerhalb des Merge-Scopes

- Electron-Desktop-Hülle, Hardware-/BLE-MIDI-I/O — bleiben exakt wie in AIMUSED.
- Cubase-14-Integration, Windows-MIDI-Loopback — bleiben optionale, nicht startpflichtige Adapter aus MUSE.
- Keine VST-Hosting, kein Notensatz, keine Mastering-Suite, keine Cloud/Accounts — wie in MUSEs eigenem Auftrag bereits ausdrücklich ausgeschlossen und deckt sich mit dem AIMUSED-Cleanup.
