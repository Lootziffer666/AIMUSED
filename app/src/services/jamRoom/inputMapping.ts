export const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11]
export const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10]

export function intervalsForMode(mode: "major" | "minor"): number[] {
  return mode === "major" ? MAJOR_INTERVALS : MINOR_INTERVALS
}

// Real pointer velocity: px/ms -> MIDI velocity
export function velocityFromPointerSpeed(speedPxPerMs: number): number {
  return Math.round(Math.min(127, Math.max(25, 25 + speedPxPerMs * 45)))
}

export function quantizeTick(tick: number, grid: number): number {
  return Math.round(tick / grid) * grid
}

// Builds `count` scale notes starting at baseOctave, in scientific pitch
// notation (baseOctave 4 => C4 = MIDI 60), matching `noteName` below.
export function buildScaleNotes(
  keyRoot: number,
  mode: "major" | "minor",
  count: number,
  baseOctave = 3,
): number[] {
  const intervals = intervalsForMode(mode)
  const notes: number[] = []
  let octave = 0
  while (notes.length < count) {
    for (const iv of intervals) {
      notes.push((baseOctave + 1 + octave) * 12 + keyRoot + iv)
      if (notes.length >= count) break
    }
    octave++
  }
  return notes
}

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
]

export function noteName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[pc]}${octave}`
}

export function keyName(root: number, mode: "major" | "minor"): string {
  return `${NOTE_NAMES[((root % 12) + 12) % 12]} ${mode === "major" ? "dur" : "moll"}`
}

export function handleMicError(error: unknown): string {
  const e = error as { name?: string }
  if (!e || !e.name) return "Mikrofonfehler – Jam läuft ohne Stimme weiter."
  if (e.name === "NotAllowedError") return "Mikrofonzugriff verweigert."
  if (e.name === "NotFoundError") return "Kein Mikrofon gefunden."
  return "Mikrofonfehler – Jam läuft ohne Stimme weiter."
}
