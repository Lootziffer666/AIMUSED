# GESTURE.LIVE — Hand-Tracking UI für MUSE

Dieses Paket enthält den kompletten React-Hand-Tracking-Code im Stil des Videos, das du gefunden hast. Er rendert ein skelettartiges Hand-Overlay über die Kamera und bietet das volle GESTURE.LIVE-Interface.

## Installation

```bash
# In deinem MUSE-Projekt (app/)
npm install @mediapipe/hands @mediapipe/camera_utils @mediapipe/drawing_utils
```

## Dateien kopieren

```
gesture-live-muse/src/
├── components/
│   ├── GestureLive.tsx      # Hauptkomponente (das komplette UI)
│   └── HandTracker.tsx      # Canvas-Overlay mit MediaPipe-Skelett
├── hooks/
│   └── useHandTracking.ts   # Custom Hook für Kamera + Hands
├── types.ts                 # TypeScript-Typen & Konstanten
└── styles.css               # Komplettes Styling
```

Kopiere den `src/`-Ordner in dein MUSE-Projekt unter `app/src/gesture-live/` (oder wo immer du willst).

## Verwendung

```tsx
import { GestureLive } from './gesture-live/components/GestureLive';
import './gesture-live/styles.css';

// In deiner Route / App:
function GesturePage() {
  return <GestureLive />;
}
```

## Wichtige Hinweise

### 1. Kamera-Zugriff
Die Komponente fragt automatisch nach Kamera-Zugriff. MediaPipe lädt seine Modelle lazy von CDN (`cdn.jsdelivr.net`).

### 2. Hand-Pose → Chord-Mapping
In `GestureLive.tsx` findest du die `handleResults`-Callback:

```tsx
const handleResults = useCallback((left: HandData | null, right: HandData | null) => {
  // left: HandData mit 21 Landmarks (MediaPipe-Format)
  // right: gleiches für rechte Hand

  // Beispiel: Y-Position der linken Hand wählt Chord-Grade
  if (left) {
    const y = left.landmarks[9].y; // Mittelfinger-MCP
    const idx = Math.min(6, Math.max(0, Math.floor(y * 7)));
    setActiveGrade(idx);
  }
}, []);
```

**Landmark-Indizes (MediaPipe Hands):**
```
0  = WRIST
1-4  = THUMB (CMC, MCP, IP, TIP)
5-8  = INDEX (MCP, PIP, DIP, TIP)
9-12 = MIDDLE (MCP, PIP, DIP, TIP)
13-16= RING (MCP, PIP, DIP, TIP)
17-20= PINKY (MCP, PIP, DIP, TIP)
```

### 3. Verbindung mit MUSE-Player
Die Komponente ist noch "stumm" — sie rendert nur das UI. Um echte Musik zu machen, verbinde die State-Änderungen mit dem MUSE-Player:

```tsx
// In GestureLive.tsx — wo activeGrade sich ändert:
useEffect(() => {
  const grade = GRADES[activeGrade];
  const chord = is7th ? grade.chord + '7' : grade.chord;
  // → Dispatch an MUSE-Player
  // musePlayer.triggerChord(chord, grade.notes);
}, [activeGrade, is7th]);
```

### 4. Rechte Hand → Module-Steuerung
Die rechte Hand steuert das rechte Panel (Drums/Bass/Melody/FX). Aktuell ist das ein simpler Mode-Switch. Du kannst erweitern:

- **Pinch-Geste** (Daumen + Finger zusammen): Trigger FX / Melody-Note
- **Hand-Y-Position**: Moduliert Cutoff / Filter
- **Offene Hand vs Faust**: Start/Stop Transport

### 5. Performance
MediaPipe Hands läuft im WebWorker (via CDN). Für bessere Performance:
- `modelComplexity: 0` (schneller, weniger genau)
- `maxNumHands: 1` (nur eine Hand tracken)
- Canvas-Größe auf 640×360 reduzieren

## Anpassung

### Farben ändern
In `styles.css` — die CSS-Variablen am Anfang:
```css
.gesture-live {
  --gl-accent: #ff6b4a;   /* Haupt-Akzentfarbe (im Video: orange-rot) */
  --gl-bg: #0a0a0f;       /* Hintergrund */
}
```

### Chord-Mapping ändern
In `types.ts` — `GRADES`-Array anpassen:
```ts
export const GRADES: ChordGrade[] = [
  { num: 1, pose: [true,false,false], degree: 'I', chord: 'C', notes: 'C4 E4 G4' },
  // ...
];
```

### Neue Module hinzufügen
In `GestureLive.tsx` — im rechten Panel:
1. Neuen Mode in `rightMode` State hinzufügen
2. Render-Block für das neue Modul schreiben
3. Mode-Button in `gl-mode-sel` ergänzen

## Architektur-Übersicht

```
GestureLive (Container)
├── TopBar (Transport, BPM, Meter)
├── Left Panel (Chord Instrument)
│   └── GradeList + Controls
├── Center (Camera + Overlay)
│   ├── <video> (versteckt, MediaPipe-Input)
│   ├── HandTracker (Canvas-Overlay)
│   │   └── useHandTracking (Hook)
│   │       ├── @mediapipe/hands
│   │       └── @mediapipe/camera_utils
│   └── Big Chord Display
└── Right Panel (Module)
    ├── Drums (Step-Sequencer)
    ├── Bass
    ├── Melody
    └── FX/DJ
```

## Lizenz
MIT — wie MUSE selbst.
