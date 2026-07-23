# MUSE

MUSE ist eine lokale, plattformübergreifende MIDI-Workstation für Komposition,
Analyse und Orchestrierung. Das Projekt verbindet einen schnellen Piano-Roll- und
Arrange-Editor mit deterministischer musikalischer Analyse, Rezepten,
Arrangement-Varianten, Humming-Import und SoundFont-Wiedergabe. Eine
Cubase-Anbindung ist derzeit ausdrücklich **nicht** Bestandteil des fertigen
Funktionsumfangs.

## Funktionsumfang

- MIDI importieren, bearbeiten und wieder exportieren
- Piano Roll, Arrange View, Tempo- und Controller-Bearbeitung
- deterministische Rollen-, Motiv-, Tonart-, Dichte- und Abschnittsanalyse
- Orchestrierungsrezepte, Varianten, Undo/Redo und Herkunftskennzeichnung
- Arrangement auf den editierbaren Song anwenden sowie Mix/Stems als Audio exportieren
- lokale `.museproj.json`-Projektdateien und IndexedDB-Autosave
- Mikrofonaufnahme mit Pitch-/Onset-Erkennung und Review vor dem Song-Import
- Web/PWA sowie Electron-Desktop-Hülle; keine Accounts und keine Cloud-Pflicht

## Voraussetzungen

- Node.js 22 oder neuer
- npm 11 (die im Repository deklarierte Version ist maßgeblich)
- Für Mikrofon, Web MIDI und File System Access: ein Browser, der die jeweilige
  Web-API unterstützt, und ein sicherer Kontext (`https` oder `localhost`)

## Installation und Entwicklung

```sh
git clone https://github.com/Lootziffer666/MUSE.git
cd MUSE
npm ci
npm run build
npm start
```

Die Web-App läuft standardmäßig unter <http://localhost:3000/edit>. Der einmalige
Build vor `npm start` erzeugt die von abhängigen Workspaces benötigten Artefakte.

### Electron

```sh
npm run dev:electron
npm run build:electron
```

Plattformspezifische Pakete werden mit `npm run make:darwin` beziehungsweise
`npm run make:win` erzeugt.

### Docker

```sh
docker compose up --build
```

Danach ist MUSE unter <http://localhost:3000/edit> erreichbar.

## Qualitätssicherung

```sh
npm test
npm run build
npm run lint
npm run typecheck -w app   # nach dem Workspace-Build
```

Das detaillierte Abschluss-Audit, bekannte Einschränkungen und die geprüfte
Abgrenzung der Cubase-Integration stehen in [`docs/AUDIT.md`](docs/AUDIT.md).
Die historische Zusammenführung ist in [`docs/MERGE_PLAN.md`](docs/MERGE_PLAN.md)
dokumentiert.

## Architektur

- `app/`: React-/Vite-Web-App und Benutzeroberfläche
- `packages/core/`: Song-, Track-, Event- und MIDI-Domänenmodell
- `packages/player/`: Transport, SoundFont-Synthese und Audio-Rendering
- `packages/orchestration-core/`: Analyse, Orchestrierung, Varianten und Humming
- `packages/midi-project/`: Projektformat, MIDI-Import/-Export und Command-Reducer
- `packages/dialog-hooks/`: gemeinsame Dialog-, Prompt- und Toast-Hooks
- `electron/`: native Desktop-Hülle

## Datenschutz und Datenhaltung

MUSE arbeitet local-first. Songs, Projekte und Autosaves bleiben im lokalen
Dateisystem beziehungsweise Browser-Speicher. Externe Abrufe sind auf
Anwendungsressourcen wie die standardmäßig konfigurierte SoundFont-Datei und
optionale Fehlertelemetrie beschränkt; es gibt keine Benutzerkonten.

## Lizenz

MIT, siehe [`LICENSE`](LICENSE).
