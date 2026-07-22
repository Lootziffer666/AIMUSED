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

## 8a. Status (Stand: erste Ausführungs-Runde dieses Plans)

Diese erste Runde hat Schritte 2, 3 (teilweise), 5 und 6 (teilweise) umgesetzt und real verifiziert (Build/Typecheck/Lint/Test grün). Im Detail:

**Erledigt:**

- **Schritt 2 — `packages/orchestration-core`**: MUSEs `src/lib/{analysis,orchestration,variants}` sowie `id.ts`/`seed-random.ts`/`bytes.ts` 1:1 portiert (Verhalten unverändert, nur Import-Pfade angepasst). Tests von `bun:test` auf `vitest` umgestellt, alle grün.
  - **Abweichung vom Plan**: `commands/` (der Command-Reducer) wurde **nicht** in `orchestration-core`, sondern in `packages/midi-project` platziert. Grund: `commands/reducer.ts` braucht zwingend `createProjectFromMidiBytes`/`MuseMidiProject` aus dem MIDI-Projekt-Paket (echte Werte, keine reinen Typen), während `midi-project` bereits umgekehrt von `orchestration-core` abhängt (für `MuseAnalysisResult`/`MuseArrangementPlan`/Varianten-Typen). Beide Pakete gegenseitig voneinander abhängig zu machen, ist zur Laufzeit über ESM zwar technisch oft lösbar, aber **Turbo verweigert grundsätzlich zyklische Workspace-Abhängigkeiten** (`Invalid package dependency graph: Cyclic dependency detected`) — `npm test`/`npm run build` liefen damit nicht mehr. Die Auflösung: harte, einseitige Abhängigkeit `midi-project -> orchestration-core`; `orchestration-core` dupliziert die kleinen, reinen MIDI-Domänentypen (`midi-types.ts`, `project-types.ts`, `tick-time.ts` — reine Typdeklarationen bzw. eine winzige zustandslose Funktion, kein Zustand, keine Logik) statt sie zu importieren. TypeScripts strukturelle Typisierung macht die echten `MuseMidiProject`/`MuseMidiTrack`-Werte aus `midi-project` weiterhin klaglos kompatibel. `exportArrangedMidi` (der einzige Schritt, der wirklich `buildMidiFromTracks`/`midi-file` braucht) liegt jetzt ebenfalls in `midi-project` (`arranged-export.ts`); `buildArrangedExportTracks` (reine Datenaufbereitung, keine MIDI-Byte-Serialisierung) bleibt in `orchestration-core`.
  - Zusätzlich: `orchestration-core` exportiert einen schmalen `./shared`-Subpfad (nur `id.ts`/`seed-random.ts`/`bytes.ts`) — den nutzt `midi-project` für die drei kleinen Utility-Funktionen, die es von `orchestration-core` braucht, ohne dafür das komplette `orchestration-core`-Barrel (das selbst wieder `midi-project` importiert) zu laden. Damit ist der Laufzeit-Modulgraph garantiert azyklisch.
- **Schritt 3 — `packages/midi-project`**: MUSEs `src/lib/{midi,persistence,project}` **plus** `commands/` (s.o.) und ein neues `arranged-export.ts` portiert. Adapter `Song ⇄ MuseMidiProject` (`app/src/services/orchestration/songAdapter.ts`) geschrieben und getestet — round-trip über echte MIDI-Bytes (`songToMidi` → `createProjectFromMidiBytes`), wie im Plan empfohlen.
- **Schritt 5 — `OrchestrationStore`**: MobX-Store mit MUSEs Snapshot-Undo/Redo-Verhalten (50 Einträge) portiert, in `RootStore` verdrahtet. `dispatch()` lässt `MuseCommandError` bewusst durchschlagen (kein catch-and-store-lastError wie im zustand-Original), damit die UI sie als Toast zeigen kann.
- **Schritt 6 (teilweise) — UI**: `OrchestrationDialog` gebaut (Analyse-Button, Rollenliste mit Konfidenz/Beleg, Rezept-Auswahl aus allen 5 Katalog-Rezepten, Ergebnis-Liste mit Instrument/Origin/Reason, „Auf Song anwenden"-Button, Undo/Redo). Menüeintrag in `EditMenu.tsx`, neuer Dialog-Atom in `useRootView.tsx`, Lokalisierungs-Schlüssel in allen 6 vorhandenen Sprachblöcken (en/fr/ja/zh-Hans/zh-Hant/sk — Nicht-Englisch nutzt den englischen Text als Platzhalter). **Noch nicht umgesetzt**: WebGL-Origin-Badge-Overlay in der Piano Roll (s. „Nicht erledigt" unten).

**Nicht erledigt (bewusst zurückgestellt, siehe Scope der Aufgabe):**

- **Audio-Adapter (Schritt 4)**: `@signal-app/player` hinter `MuseRenderer` zu kapseln (für WAV-Mix-/Stem-Export) ist nicht gebaut. Orchestriertes Ergebnis wird stattdessen als normaler `Song`/`Track` über `applyRenderResultToSong` erzeugt und läuft durch den bestehenden Player — funktional ausreichend zum Anhören/Editieren, aber kein eigenständiger Offline-Renderer.
- **WebGL-Origin-Badge-Overlay** in der Piano Roll (Teil von Schritt 6): nicht gebaut. Die Herkunft (`MuseDecision.origin`) ist nur im `OrchestrationDialog` als Text sichtbar, nicht als Overlay auf den Noten selbst.
- **`.museproj.json`-Dateityp** in `app/src/actions/file.ts` (Schritt 7): nicht verdrahtet. Es gibt noch kein Open/Save/Autosave für `.museproj.json` über AIMUSEDs lokale Dateiaktionen — `idb-store.ts` (IndexedDB-Autosave) wurde zwar 1:1 portiert und getestet, aber nicht an AIMUSEDs `AutoSaveService` angeschlossen.
- **Cubase-Bridge** (Schritt 8): nicht übernommen — außerhalb des Scopes dieser Runde.
- **Humming-Pipeline** (Schritt 9): nicht übernommen — außerhalb des Scopes dieser Runde, MUSEs eigene Roadmap verschiebt das ohnehin auf M8.
- **Alte MUSE-Next.js-App stilllegen** (Schritt 10): nicht relevant, solange die AIMUSED-Panels dem MUSE-Funktionsumfang noch nicht gleichwertig sind (u. a. wegen der drei obigen Punkte).
- Undo/Redo-Buttons im `OrchestrationDialog` wurden entgegen der ursprünglichen „nice-to-have, nicht erforderlich"-Einschätzung doch umgesetzt, da der Store sie bereits unterstützt und der Aufwand gering war.

**Build/Test-Status dieser Runde**: `npx turbo build`, `npx turbo test` und `npx turbo lint` laufen grün für alle sechs Workspace-Pakete (`@signal-app/core`, `@signal-app/player`, `dialog-hooks`, `@signal-app/orchestration-core`, `@signal-app/midi-project`, `signal`/`app`) — mit einer vorbestehenden, nicht mit dieser Änderung zusammenhängenden Lint-Abweichung in `packages/dialog-hooks` (Prettier-Formatierung, unberührt von dieser Aufgabe). Die neu portierten Pakete führen zu ca. 42 zusätzlichen Biome-*Warnungen* (kein Build-/CI-Abbruch, `exit 0`) gegenüber der Baseline — praktisch ausschließlich `noNonNullAssertion` in portierten Testdateien (MUSEs eigener, idiomatischer Teststil) plus zwei `noExplicitAny` in einem Negativ-Test, der absichtlich ungültige Objekte konstruiert. Diese wurden bewusst nicht "wegrefactored", um das Verhalten der portierten Tests nicht anzufassen.

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
