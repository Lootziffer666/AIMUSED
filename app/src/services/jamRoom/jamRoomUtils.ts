import type {
  MusePerformanceNote,
  MusePerformanceTake,
  MuseTrackRole,
  PerformanceSource,
} from "../../entities/performance/MusePerformanceTake"

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export function normalizeTake(take: MusePerformanceTake): MusePerformanceTake {
  return {
    ...take,
    notes: take.notes
      .filter(
        (note) =>
          Number.isFinite(note.tick) &&
          Number.isFinite(note.duration) &&
          note.duration > 0 &&
          note.velocity > 0,
      )
      .map((note) => ({
        ...note,
        tick: Math.max(0, Math.round(note.tick)),
        duration: Math.max(1, Math.round(note.duration)),
        noteNumber: clamp(Math.round(note.noteNumber), 0, 127),
        velocity: clamp(Math.round(note.velocity), 1, 127),
      })),
    drumHits: take.drumHits
      .filter((hit) => Number.isFinite(hit.tick) && hit.velocity > 0)
      .map((hit) => ({
        ...hit,
        tick: Math.max(0, Math.round(hit.tick)),
        velocity: clamp(Math.round(hit.velocity), 1, 127),
        confidence: clamp(hit.confidence, 0, 1),
      })),
    confidence: clamp(take.confidence, 0, 1),
    loopStartTick: Math.max(0, Math.round(take.loopStartTick)),
    loopLengthTicks: Math.max(1, Math.round(take.loopLengthTicks)),
  }
}

export interface DrumZone {
  id: string
  x: number
  y: number
  width: number
  height: number
  instrument: string
}

export function testDrumZoneHit(
  zone: DrumZone,
  handX: number,
  handY: number,
): boolean {
  return (
    handX >= zone.x &&
    handX <= zone.x + zone.width &&
    handY >= zone.y &&
    handY <= zone.y + zone.height
  )
}

export function calculateVelocityFromSpeed(speed: number): number {
  return clamp(Math.round(speed * 5), 1, 127)
}

export function snapToScale(
  note: number,
  rootPitchClass: number,
  scaleIntervals: number[],
): number {
  const root = ((Math.round(rootPitchClass) % 12) + 12) % 12
  const allowed = new Set(
    scaleIntervals.map((interval) => (root + interval + 120) % 12),
  )
  const rounded = clamp(Math.round(note), 0, 127)

  let best = rounded
  let bestDistance = Number.POSITIVE_INFINITY
  for (
    let candidate = Math.max(0, rounded - 12);
    candidate <= Math.min(127, rounded + 12);
    candidate++
  ) {
    if (!allowed.has(candidate % 12)) continue
    const distance = Math.abs(candidate - rounded)
    if (
      distance < bestDistance ||
      (distance === bestDistance && candidate < best)
    ) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

export function generateKeyBoundNotes(
  inputNotes: number[],
  keyRoot: number,
  scaleIntervals: number[],
): MusePerformanceNote[] {
  return inputNotes.map((note) => ({
    tick: 0,
    duration: 480,
    noteNumber: snapToScale(note, keyRoot, scaleIntervals),
    velocity: 80,
  }))
}

export function calculateLoopPosition(
  tick: number,
  loopLength: number,
): number {
  if (loopLength <= 0) return 0
  return ((Math.round(tick) % loopLength) + loopLength) % loopLength
}

export function millisecondsToLoopTick(
  milliseconds: number,
  bpm: number,
  timebase: number,
  loopLength: number,
): number {
  const ticks = (Math.max(0, milliseconds) / 1000) * (bpm / 60) * timebase
  return calculateLoopPosition(Math.round(ticks), loopLength)
}

export function layerTakeWithoutOverwriting(
  existing: MusePerformanceTake[],
  newTake: MusePerformanceTake,
): MusePerformanceTake[] {
  return [...existing, newTake]
}

export function undoLastTake(
  takes: MusePerformanceTake[],
): MusePerformanceTake[] {
  return takes.slice(0, -1)
}

export function assignRoleAutomatically(
  source: PerformanceSource,
  isPercussiveVoice: boolean,
): MuseTrackRole {
  if (source === "painted-drums") return "percussion"
  if (source === "voice") {
    return isPercussiveVoice ? "percussion" : "melody"
  }
  if (source === "accompaniment") return "bass"
  return "guitar"
}

export function shouldGenerateAccompaniment(
  takes: MusePerformanceTake[],
): boolean {
  return takes.some(
    (take) =>
      take.role === "melody" &&
      take.confidence > 0.5 &&
      take.notes.length > 0,
  )
}

export function protectOriginalTakes(
  original: MusePerformanceTake[],
  mutated: MusePerformanceTake[],
): MusePerformanceTake[] {
  const originalById = new Map(original.map((take) => [take.id, take]))
  const preserved = original.filter((take) =>
    mutated.some((candidate) => candidate.id === take.id),
  )
  const added = mutated.filter((take) => !originalById.has(take.id))
  return [...preserved, ...added]
}

export function handleCameraError(error: unknown): string {
  if (!(error instanceof DOMException)) {
    return "Kamerafehler. Jam Room läuft ohne Video weiter."
  }
  if (error.name === "NotAllowedError") return "Kamerazugriff verweigert."
  if (error.name === "NotFoundError") return "Keine Kamera gefunden."
  return "Kamerafehler. Jam Room läuft ohne Video weiter."
}

export function handleMicrophoneError(error: unknown): string {
  if (!(error instanceof DOMException)) {
    return "Mikrofonfehler. Gesten und Schlagflächen bleiben verfügbar."
  }
  if (error.name === "NotAllowedError") return "Mikrofonzugriff verweigert."
  if (error.name === "NotFoundError") return "Kein Mikrofon gefunden."
  return "Mikrofonfehler. Gesten und Schlagflächen bleiben verfügbar."
}
