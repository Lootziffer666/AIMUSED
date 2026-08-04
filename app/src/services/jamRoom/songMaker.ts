import type {
  MusePerformanceDrumHit,
  MusePerformanceNote,
} from "../../entities/performance/MusePerformanceTake"
import { snapToScale } from "./jamRoomUtils"

export const SONG_MAKER_STEPS = 16
export const SONG_MAKER_MELODY_ROWS = 14
export const SONG_MAKER_DRUM_ROWS = 5
export const SONG_MAKER_DRUM_IDS = [
  "kick",
  "snare",
  "hihat",
  "clap",
  "tom",
] as const

export interface SongMakerPattern {
  melody: boolean[][]
  drums: boolean[][]
}

export interface SongMakerEvents {
  melodyNotes: MusePerformanceNote[]
  drumHits: MusePerformanceDrumHit[]
  loopLengthTicks: number
}

export function createEmptySongMakerPattern(): SongMakerPattern {
  return {
    melody: Array.from({ length: SONG_MAKER_MELODY_ROWS }, () =>
      Array.from({ length: SONG_MAKER_STEPS }, () => false),
    ),
    drums: Array.from({ length: SONG_MAKER_DRUM_ROWS }, () =>
      Array.from({ length: SONG_MAKER_STEPS }, () => false),
    ),
  }
}

export function toggleSongMakerCell(
  pattern: SongMakerPattern,
  lane: "melody" | "drums",
  row: number,
  step: number,
): SongMakerPattern {
  const source = pattern[lane]
  if (!source[row] || source[row][step] === undefined) return pattern

  return {
    ...pattern,
    [lane]: source.map((cells, rowIndex) =>
      rowIndex === row
        ? cells.map((active, stepIndex) =>
            stepIndex === step ? !active : active,
          )
        : [...cells],
    ),
  }
}

export function buildSongMakerEvents(
  pattern: SongMakerPattern,
  timebase: number,
  rootPitchClass = 0,
  scaleIntervals: number[] = [0, 2, 4, 5, 7, 9, 11],
): SongMakerEvents {
  const stepTicks = Math.max(1, Math.round(timebase / 4))
  const melodyNotes: MusePerformanceNote[] = []
  const drumHits: MusePerformanceDrumHit[] = []

  for (let row = 0; row < pattern.melody.length; row++) {
    for (let step = 0; step < SONG_MAKER_STEPS; step++) {
      if (!pattern.melody[row]?.[step]) continue
      const rawNote = 60 + (SONG_MAKER_MELODY_ROWS - 1 - row)
      melodyNotes.push({
        tick: step * stepTicks,
        duration: stepTicks,
        noteNumber: snapToScale(rawNote, rootPitchClass, scaleIntervals),
        velocity: 82,
      })
    }
  }

  for (let row = 0; row < pattern.drums.length; row++) {
    const zoneId = SONG_MAKER_DRUM_IDS[row]
    if (!zoneId) continue
    for (let step = 0; step < SONG_MAKER_STEPS; step++) {
      if (!pattern.drums[row]?.[step]) continue
      drumHits.push({
        tick: step * stepTicks,
        zoneId,
        velocity: row === 0 ? 112 : 96,
        confidence: 1,
      })
    }
  }

  return {
    melodyNotes,
    drumHits,
    loopLengthTicks: stepTicks * SONG_MAKER_STEPS,
  }
}

export function songMakerStepEvents(
  events: SongMakerEvents,
  step: number,
  timebase: number,
): Pick<SongMakerEvents, "melodyNotes" | "drumHits"> {
  const stepTicks = Math.max(1, Math.round(timebase / 4))
  const tick = Math.max(0, Math.min(SONG_MAKER_STEPS - 1, step)) * stepTicks
  return {
    melodyNotes: events.melodyNotes.filter((note) => note.tick === tick),
    drumHits: events.drumHits.filter((hit) => hit.tick === tick),
  }
}

export function hasSongMakerContent(pattern: SongMakerPattern): boolean {
  return (
    pattern.melody.some((row) => row.some(Boolean)) ||
    pattern.drums.some((row) => row.some(Boolean))
  )
}
