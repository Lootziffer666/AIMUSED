/**
 * Pattern domain model.
 *
 * A pattern is a reusable, freely sized musical object. It owns a set of
 * independent track layers; every layer owns its own events. Nothing here
 * knows about React, MobX or the Web Audio API – see
 * `services/pattern/patternOps.ts` for the operations on these structures.
 */

/** Normalized bezier envelope: time and value both run from 0 to 1. */
export interface MuseEnvelopePoint {
  /** Position inside the event, 0 = event start, 1 = event end */
  t: number
  /** Normalized amount, 0 = silent / no pressure, 1 = full */
  v: number
}

export type MuseEnvelopePreset =
  | "direct"
  | "fade-in"
  | "fade-out"
  | "swell"
  | "decay"
  | "accent"
  | "custom"

/**
 * Cubic bezier envelope described by an ordered list of anchor points.
 * Segments between two anchors are shaped by a single curvature value so
 * that the UI only has to expose a handful of understandable handles.
 */
export interface MuseBezierEnvelope {
  preset: MuseEnvelopePreset
  points: MuseEnvelopePoint[]
  /** -1 = strongly concave, 0 = linear, 1 = strongly convex */
  curve: number
}

export type MusePatternLayerKind = "melodic" | "percussion" | "sample"

export interface MusePatternNote {
  id: string
  startTick: number
  durationTicks: number
  /** MIDI note number; for percussion layers the drum zone decides the sound */
  noteNumber: number
  velocity: number
  volumeEnvelope?: MuseBezierEnvelope
  expressionEnvelope?: MuseBezierEnvelope
}

export interface MusePatternTrackLayer {
  id: string
  name: string
  kind: MusePatternLayerKind
  /** CSS color used on the canvas and in the layer rail */
  color: string
  /** GM program for melodic layers */
  program?: number
  /** Drum zone id ("kick", "snare", …) for percussion layers */
  drumZoneId?: string
  /** Sample source identifier for sample layers */
  sampleId?: string
  /** Semitone transposition applied on playback and export */
  transpose?: number
  visible: boolean
  muted: boolean
  soloed: boolean
  locked: boolean
  notes: MusePatternNote[]
}

export interface MusePattern {
  id: string
  name: string
  startTick: number
  /** Active length; events beyond it are kept but neither played nor exported */
  lengthTicks: number
  /** Grid resolution as a note division: 4 = quarter, 8 = eighth, 16 = sixteenth */
  gridDivision: number
  /** Ticks per quarter note this pattern was written against */
  timebase: number
  trackLayers: MusePatternTrackLayer[]
  createdAt: string
  updatedAt: string
}

export function gridTicks(pattern: MusePattern): number {
  return Math.max(1, Math.round((pattern.timebase * 4) / pattern.gridDivision))
}

export function stepCount(pattern: MusePattern): number {
  return Math.max(1, Math.round(pattern.lengthTicks / gridTicks(pattern)))
}

/** Layers that should sound: solo wins over mute, muted layers stay silent. */
export function audibleLayers(pattern: MusePattern): MusePatternTrackLayer[] {
  const soloed = pattern.trackLayers.filter((l) => l.soloed)
  const candidates = soloed.length > 0 ? soloed : pattern.trackLayers
  return candidates.filter((l) => !l.muted)
}

/** A note counts as active when it starts inside the pattern length. */
export function isNoteActive(
  note: MusePatternNote,
  lengthTicks: number,
): boolean {
  return note.startTick < lengthTicks
}
