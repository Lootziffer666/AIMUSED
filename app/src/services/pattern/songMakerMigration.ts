import type { MusePattern } from "../../entities/pattern/MusePattern"
import { snapToScale } from "../jamRoom/jamRoomUtils"
import {
  SONG_MAKER_DRUM_IDS,
  SONG_MAKER_MELODY_ROWS,
  SONG_MAKER_STEPS,
  type SongMakerPattern,
} from "../jamRoom/songMaker"
import { addNote, createLayer, createPattern } from "./patternOps"

const DRUM_LABELS: Record<string, string> = {
  kick: "Kick",
  snare: "Snare",
  hihat: "Hi-Hat",
  clap: "Clap",
  tom: "Tom",
}

const DRUM_COLORS: Record<string, string> = {
  kick: "#fb7185",
  snare: "#fbbf24",
  hihat: "#22d3ee",
  clap: "#f472b6",
  tom: "#34d399",
}

/**
 * Migrates a classic 16-step Song Maker pattern into the layered model:
 * the melody grid becomes one melodic layer, every drum row becomes its own
 * percussion layer. Empty drum rows are dropped so the rail stays readable.
 */
export function songMakerPatternToMusePattern(
  source: SongMakerPattern,
  options: {
    name?: string
    timebase?: number
    rootPitchClass?: number
    scaleIntervals?: number[]
  } = {},
): MusePattern {
  const timebase = options.timebase ?? 480
  const rootPitchClass = options.rootPitchClass ?? 0
  const scaleIntervals = options.scaleIntervals ?? [0, 2, 4, 5, 7, 9, 11]

  const usedDrumRows = source.drums
    .map((cells, row) => ({ row, used: cells.some(Boolean) }))
    .filter((entry) => entry.used)

  const melodyLayer = createLayer(
    { name: "Melodie", kind: "melodic", program: 0 },
    0,
  )
  const drumLayers = usedDrumRows.map((entry, index) => {
    const zoneId = SONG_MAKER_DRUM_IDS[entry.row] ?? "snare"
    return createLayer(
      {
        name: DRUM_LABELS[zoneId] ?? zoneId,
        kind: "percussion",
        drumZoneId: zoneId,
        color: DRUM_COLORS[zoneId],
      },
      index + 1,
    )
  })

  let pattern = createPattern({
    name: options.name ?? "Song Maker",
    timebase,
    gridDivision: 16,
    steps: SONG_MAKER_STEPS,
    layers: [melodyLayer, ...drumLayers],
  })

  const step = Math.max(1, Math.round(timebase / 4))

  for (let row = 0; row < source.melody.length; row++) {
    for (let stepIndex = 0; stepIndex < SONG_MAKER_STEPS; stepIndex++) {
      if (!source.melody[row]?.[stepIndex]) continue
      const rawNote = 60 + (SONG_MAKER_MELODY_ROWS - 1 - row)
      pattern = addNote(pattern, melodyLayer.id, {
        startTick: stepIndex * step,
        durationTicks: step,
        noteNumber: snapToScale(rawNote, rootPitchClass, scaleIntervals),
        velocity: 82,
      }).pattern
    }
  }

  usedDrumRows.forEach((entry, index) => {
    const layer = drumLayers[index]
    for (let stepIndex = 0; stepIndex < SONG_MAKER_STEPS; stepIndex++) {
      if (!source.drums[entry.row]?.[stepIndex]) continue
      pattern = addNote(pattern, layer.id, {
        startTick: stepIndex * step,
        durationTicks: step,
        noteNumber: 60,
        velocity: entry.row === 0 ? 112 : 96,
      }).pattern
    }
  })

  return pattern
}
