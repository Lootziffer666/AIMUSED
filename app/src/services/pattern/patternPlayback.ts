import {
  audibleLayers,
  type MusePattern,
  type MusePatternNote,
  type MusePatternTrackLayer,
} from "../../entities/pattern/MusePattern"
import { sampleEnvelopeCurve } from "./envelope"

/**
 * Pure playback model: turns a pattern into the events a scheduler has to
 * fire inside a tick window. Kept free of audio APIs so the loop behaviour
 * (pattern end, mute/solo, held notes, envelopes) is unit testable.
 */

export interface ScheduledPatternNote {
  layer: MusePatternTrackLayer
  note: MusePatternNote
  startTick: number
  /** Clipped so a held note never rings past the pattern end */
  durationTicks: number
}

export interface EnvelopeStep {
  /** Offset from the note start, in ticks */
  tick: number
  /** 0..127, ready to be sent as a MIDI controller value */
  value: number
}

/**
 * Notes starting inside `[fromTick, toTick)`. Layers that are muted, silenced
 * by another layer's solo, or notes beyond the end marker are left out.
 */
export function collectPatternEvents(
  pattern: MusePattern,
  fromTick: number,
  toTick: number,
): ScheduledPatternNote[] {
  const result: ScheduledPatternNote[] = []
  for (const layer of audibleLayers(pattern)) {
    for (const note of layer.notes) {
      if (note.startTick >= pattern.lengthTicks) continue // overhang
      if (note.startTick < fromTick || note.startTick >= toTick) continue
      const maxDuration = pattern.lengthTicks - note.startTick
      result.push({
        layer,
        note,
        startTick: note.startTick,
        durationTicks: Math.max(1, Math.min(note.durationTicks, maxDuration)),
      })
    }
  }
  return result.sort((a, b) => a.startTick - b.startTick)
}

export function noteNumberFor(
  layer: MusePatternTrackLayer,
  note: MusePatternNote,
): number {
  return Math.min(127, Math.max(0, note.noteNumber + (layer.transpose ?? 0)))
}

/**
 * Converts an event envelope into controller steps across the note duration.
 * Returns an empty list when the note carries no envelope, so unshaped notes
 * cost nothing at playback time.
 */
export function envelopeSteps(
  scheduled: ScheduledPatternNote,
  which: "volumeEnvelope" | "expressionEnvelope",
  resolution = 12,
): EnvelopeStep[] {
  const envelope = scheduled.note[which]
  if (!envelope) return []
  return sampleEnvelopeCurve(envelope, resolution).map((point) => ({
    tick: Math.round(point.t * scheduled.durationTicks),
    value: Math.round(Math.min(1, Math.max(0, point.v)) * 127),
  }))
}

/**
 * Velocity actually sent for an event. The expression envelope colours the
 * attack, while the volume envelope shapes the sounding note via controllers
 * (see PatternPlayer), so it must not be baked into the velocity twice.
 */
export function effectiveVelocity(scheduled: ScheduledPatternNote): number {
  const expression = scheduled.note.expressionEnvelope
  const start = expression ? sampleEnvelopeCurve(expression, 5)[0].v : 1
  const scaled = scheduled.note.velocity * (0.55 + 0.45 * start)
  return Math.min(127, Math.max(1, Math.round(scaled)))
}

/** Loop position helper shared by the scheduler and the playhead UI. */
export function wrapPatternTick(tick: number, lengthTicks: number): number {
  if (lengthTicks <= 0) return 0
  return ((tick % lengthTicks) + lengthTicks) % lengthTicks
}
