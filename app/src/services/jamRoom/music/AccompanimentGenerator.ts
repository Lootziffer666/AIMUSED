import type {
  MusePerformanceNote,
  MusePerformanceTake,
} from "../../../entities/performance/MusePerformanceTake"
import { chooseChordsPerBar } from "./KeyAndChords"

export interface AccompanimentOptions {
  melodyNotes: MusePerformanceNote[]
  keyRoot: number
  mode: "major" | "minor"
  timebase: number
  loopLengthTicks: number
  intensity: 1 | 2 | 3
}

function makeTakeId(role: string): string {
  return `muse-${role}-${Math.random().toString(36).slice(2, 10)}`
}

// Intensity 1: bass only | 2: + pad | 3: + guitar arpeggio
export function generateAccompaniment(
  opts: AccompanimentOptions,
): MusePerformanceTake[] {
  const { melodyNotes, keyRoot, mode, timebase, loopLengthTicks, intensity } =
    opts
  const barTicks = timebase * 4
  const barCount = Math.max(1, Math.round(loopLengthTicks / barTicks))
  const chords = chooseChordsPerBar(
    melodyNotes,
    keyRoot,
    mode,
    barCount,
    barTicks,
  )
  const beat = timebase
  const takes: MusePerformanceTake[] = []
  const createdAt = new Date().toISOString()

  const base = {
    source: "accompaniment" as const,
    drumHits: [],
    controls: [],
    confidence: 1,
    generatedBy: "muse" as const,
    loopStartTick: 0,
    loopLengthTicks,
    createdAt,
  }

  // ---- Bass ----
  const bassNotes: MusePerformanceNote[] = []
  chords.forEach((ch, b) => {
    const barStart = b * barTicks
    const rootMidi = 36 + ((keyRoot + ch.rootOffset) % 12)
    const fifthMidi = rootMidi + 7
    if (intensity === 1) {
      bassNotes.push({
        tick: barStart,
        duration: barTicks,
        noteNumber: rootMidi,
        velocity: 78,
      })
    } else if (intensity === 2) {
      bassNotes.push(
        {
          tick: barStart,
          duration: beat * 2,
          noteNumber: rootMidi,
          velocity: 82,
        },
        {
          tick: barStart + beat * 2,
          duration: beat,
          noteNumber: rootMidi,
          velocity: 70,
        },
        {
          tick: barStart + beat * 3,
          duration: beat,
          noteNumber: fifthMidi,
          velocity: 74,
        },
      )
    } else {
      const pattern = [rootMidi, fifthMidi, rootMidi + 12, fifthMidi]
      for (let i = 0; i < 8; i++) {
        bassNotes.push({
          tick: barStart + i * (beat / 2),
          duration: beat / 2,
          noteNumber: pattern[i % 4],
          velocity: i % 2 === 0 ? 80 : 62,
        })
      }
    }
  })
  takes.push({
    ...base,
    id: makeTakeId("bass"),
    notes: bassNotes,
    role: "bass",
    program: 33,
  })

  // ---- Pad ----
  if (intensity >= 2) {
    const padNotes: MusePerformanceNote[] = []
    chords.forEach((ch, b) => {
      const barStart = b * barTicks
      const rootPc = (keyRoot + ch.rootOffset) % 12
      for (const iv of ch.intervals) {
        padNotes.push({
          tick: barStart,
          duration: barTicks,
          noteNumber: 60 + ((rootPc + iv) % 12),
          velocity: 42 + intensity * 4,
        })
      }
    })
    takes.push({
      ...base,
      id: makeTakeId("pad"),
      notes: padNotes,
      role: "pad",
      program: 89,
    })
  }

  // ---- Guitar arpeggio ----
  if (intensity >= 3) {
    const arpNotes: MusePerformanceNote[] = []
    chords.forEach((ch, b) => {
      const barStart = b * barTicks
      const rootPc = (keyRoot + ch.rootOffset) % 12
      const tones = ch.intervals.map((iv) => 72 + ((rootPc + iv) % 12))
      const order = [0, 1, 2, 1]
      for (let i = 0; i < 8; i++) {
        arpNotes.push({
          tick: barStart + i * (beat / 2),
          duration: beat / 2,
          noteNumber: tones[order[i % 4]],
          velocity: i % 4 === 0 ? 60 : 48,
        })
      }
    })
    takes.push({
      ...base,
      id: makeTakeId("guitar"),
      notes: arpNotes,
      role: "guitar",
      program: 25,
    })
  }

  return takes
}
