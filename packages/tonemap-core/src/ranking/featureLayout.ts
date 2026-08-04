import {
  type AcousticFeatureVector,
  clamp01,
  EMOTION_AXES,
  type EmotionalIntent,
  MUSICAL_FUNCTIONS,
  type MusicalFunction,
  type RegisterProfile,
  type SymbolicFeatureVector,
  TIMBRE_AXES,
  type TimbreVector,
} from "../schema/tonemap.ts"
import { FEATURE_LAYOUT_VERSION } from "../schema/version.ts"

/**
 * Stable numeric layout for a later small ONNX model.
 *
 * Two rules make this useful as a contract:
 * 1. the field order never changes within a version – new fields go into a
 *    new layout version, never in the middle
 * 2. every field has a documented range and a companion mask bit, so
 *    "missing" is different from "zero"
 */

export interface FeatureField {
  name: string
  /** Inclusive range the raw value is expected in, before normalization */
  min: number
  max: number
  description: string
}

function scalar(
  name: string,
  min: number,
  max: number,
  description: string,
): FeatureField {
  return { name, min, max, description }
}

const FUNCTION_FIELDS: FeatureField[] = MUSICAL_FUNCTIONS.map((fn) =>
  scalar(`function.${fn}`, 0, 1, `one-hot: musical function is ${fn}`),
)

const REGISTER_FIELDS: FeatureField[] = [
  scalar("register.lowest", 0, 127, "lowest MIDI note"),
  scalar("register.highest", 0, 127, "highest MIDI note"),
  scalar("register.centroid", 0, 127, "duration weighted centre"),
  scalar("register.span", 0, 88, "highest minus lowest"),
]

const SYMBOLIC_FIELDS: FeatureField[] = [
  scalar("symbolic.noteCount", 0, 512, "notes in the segment"),
  scalar("symbolic.density", 0, 16, "notes per beat"),
  scalar("symbolic.meanDuration", 0, 3840, "mean sounding length in ticks"),
  scalar("symbolic.pitchRange", 0, 88, "pitch range in semitones"),
  scalar("symbolic.meanInterval", 0, 24, "mean absolute interval"),
  scalar("symbolic.polyphony", 1, 8, "simultaneous notes"),
  scalar("symbolic.monophonic", 0, 1, "1 when the voice is monophonic"),
  scalar("symbolic.syncopation", 0, 1, "share of off-beat onsets"),
  scalar("symbolic.restRatio", 0, 1, "share of silence"),
  scalar("symbolic.repetition", 0, 1, "share of repeated pitches"),
  scalar("symbolic.velocityMean", 0, 127, "mean velocity"),
  scalar("symbolic.velocityVariance", 0, 4096, "velocity variance"),
  scalar("symbolic.sustainPedal", 0, 1, "share of pedal-down events"),
  scalar("symbolic.legato", 0, 1, "share of connected notes"),
]

const ACOUSTIC_FIELDS: FeatureField[] = [
  scalar("acoustic.rms", 0, 1, "mean RMS"),
  scalar("acoustic.peak", 0, 1, "peak sample"),
  scalar("acoustic.loudnessDb", -80, 0, "mean loudness in dBFS"),
  scalar("acoustic.centroid", 0, 12000, "spectral centroid in Hz"),
  scalar("acoustic.bandwidth", 0, 12000, "spectral bandwidth in Hz"),
  scalar("acoustic.rolloff", 0, 20000, "85 % roll-off in Hz"),
  scalar("acoustic.flatness", 0, 1, "spectral flatness"),
  scalar("acoustic.zcr", 0, 1, "zero crossing rate"),
  scalar("acoustic.onset", 0, 1, "mean onset strength"),
  scalar("acoustic.transient", 0, 1, "attack energy share"),
  scalar("acoustic.sustain", 0, 1, "sustained energy share"),
  scalar("acoustic.low", 0, 1, "energy below 250 Hz"),
  scalar("acoustic.mid", 0, 1, "energy 250 Hz .. 4 kHz"),
  scalar("acoustic.high", 0, 1, "energy above 4 kHz"),
  scalar("acoustic.stereoWidth", 0, 1, "side/mid ratio"),
  scalar("acoustic.balance", -1, 1, "left/right balance"),
  scalar("acoustic.silenceRatio", 0, 1, "share of silent frames"),
  ...Array.from({ length: 12 }, (_, i) =>
    scalar(`acoustic.chroma${i}`, 0, 1, `pitch class energy ${i}`),
  ),
]

const TIMBRE_FIELDS: FeatureField[] = TIMBRE_AXES.map((axis) =>
  scalar(`timbre.${axis}`, 0, 1, `requested timbre axis ${axis}`),
)

const EMOTION_FIELDS: FeatureField[] = EMOTION_AXES.map((axis) =>
  scalar(`emotion.${axis}`, 0, 1, `requested emotional axis ${axis}`),
)

const CONTEXT_FIELDS: FeatureField[] = [
  scalar("context.prominence", 0, 1, "requested prominence"),
  scalar("context.alignmentConfidence", 0, 1, "confidence of the alignment"),
  scalar("context.sectionPosition", 0, 1, "relative position inside the piece"),
  scalar("context.voiceCount", 1, 32, "voices sounding at the same time"),
]

export const FEATURE_FIELDS: FeatureField[] = [
  ...FUNCTION_FIELDS,
  ...REGISTER_FIELDS,
  ...SYMBOLIC_FIELDS,
  ...ACOUSTIC_FIELDS,
  ...TIMBRE_FIELDS,
  ...EMOTION_FIELDS,
  ...CONTEXT_FIELDS,
]

export const FEATURE_LAYOUT = {
  version: FEATURE_LAYOUT_VERSION,
  fields: FEATURE_FIELDS,
  length: FEATURE_FIELDS.length,
}

export interface FeatureVector {
  layoutVersion: string
  /** Normalized to 0..1 in the documented field order */
  values: number[]
  /** 1 = value present, 0 = unknown (the value is then 0 and must be ignored) */
  mask: number[]
}

export interface EncodeInput {
  musicalFunction?: MusicalFunction
  register?: RegisterProfile
  symbolic?: SymbolicFeatureVector
  acoustic?: AcousticFeatureVector
  timbre?: TimbreVector
  emotion?: EmotionalIntent
  context?: {
    prominence?: number
    alignmentConfidence?: number
    sectionPosition?: number
    voiceCount?: number
  }
}

function normalize(field: FeatureField, value: number): number {
  if (!Number.isFinite(value)) return 0
  const span = field.max - field.min
  if (span <= 0) return 0
  return clamp01((value - field.min) / span)
}

export function denormalize(field: FeatureField, value: number): number {
  return field.min + clamp01(value) * (field.max - field.min)
}

/** Encodes into the fixed layout; unknown values stay masked out. */
export function encodeFeatures(input: EncodeInput): FeatureVector {
  const values = new Array<number>(FEATURE_FIELDS.length).fill(0)
  const mask = new Array<number>(FEATURE_FIELDS.length).fill(0)
  const index = new Map(FEATURE_FIELDS.map((field, i) => [field.name, i]))

  const set = (name: string, raw: number | undefined) => {
    if (raw === undefined || raw === null || !Number.isFinite(raw)) return
    const i = index.get(name)
    if (i === undefined) return
    values[i] = normalize(FEATURE_FIELDS[i], raw)
    mask[i] = 1
  }

  if (input.musicalFunction) {
    for (const fn of MUSICAL_FUNCTIONS) {
      set(`function.${fn}`, fn === input.musicalFunction ? 1 : 0)
    }
  }

  if (input.register) {
    set("register.lowest", input.register.lowestMidi)
    set("register.highest", input.register.highestMidi)
    set("register.centroid", input.register.centroidMidi)
    set("register.span", input.register.highestMidi - input.register.lowestMidi)
  }

  if (input.symbolic) {
    const s = input.symbolic
    set("symbolic.noteCount", s.noteCount)
    set("symbolic.density", s.noteDensityPerBeat)
    set("symbolic.meanDuration", s.meanDurationTicks)
    set("symbolic.pitchRange", s.pitchRange)
    set("symbolic.meanInterval", s.meanIntervalAbs)
    set("symbolic.polyphony", s.polyphony)
    set("symbolic.monophonic", s.isMonophonic ? 1 : 0)
    set("symbolic.syncopation", s.syncopation)
    set("symbolic.restRatio", s.restRatio)
    set("symbolic.repetition", s.repetitionScore)
    set("symbolic.velocityMean", s.velocityMean)
    set("symbolic.velocityVariance", s.velocityVariance)
    set("symbolic.sustainPedal", s.sustainPedalRatio)
    set("symbolic.legato", s.legatoRatio)
  }

  if (input.acoustic) {
    const a = input.acoustic
    set("acoustic.rms", a.rms)
    set("acoustic.peak", a.peak)
    set("acoustic.loudnessDb", a.loudnessDb)
    set("acoustic.centroid", a.spectralCentroidHz)
    set("acoustic.bandwidth", a.spectralBandwidthHz)
    set("acoustic.rolloff", a.spectralRolloffHz)
    set("acoustic.flatness", a.spectralFlatness)
    set("acoustic.zcr", a.zeroCrossingRate)
    set("acoustic.onset", a.onsetStrength)
    set("acoustic.transient", a.transientStrength)
    set("acoustic.sustain", a.sustainEstimate)
    set("acoustic.low", a.lowEnergy)
    set("acoustic.mid", a.midEnergy)
    set("acoustic.high", a.highEnergy)
    set("acoustic.stereoWidth", a.stereoWidth)
    set("acoustic.balance", a.balance)
    set("acoustic.silenceRatio", a.silenceRatio)
    a.chroma.forEach((value, i) => set(`acoustic.chroma${i}`, value))
  }

  if (input.timbre) {
    for (const axis of TIMBRE_AXES) set(`timbre.${axis}`, input.timbre[axis])
  }

  if (input.emotion) {
    for (const axis of EMOTION_AXES)
      set(`emotion.${axis}`, input.emotion.axes[axis])
  }

  if (input.context) {
    set("context.prominence", input.context.prominence)
    set("context.alignmentConfidence", input.context.alignmentConfidence)
    set("context.sectionPosition", input.context.sectionPosition)
    set("context.voiceCount", input.context.voiceCount)
  }

  return { layoutVersion: FEATURE_LAYOUT_VERSION, values, mask }
}

/** Reads a vector back into named values – used for debugging and tests. */
export function decodeFeatures(
  vector: FeatureVector,
): Record<string, number | null> {
  const result: Record<string, number | null> = {}
  FEATURE_FIELDS.forEach((field, i) => {
    result[field.name] =
      vector.mask[i] === 1 ? denormalize(field, vector.values[i]) : null
  })
  return result
}

export class FeatureLayoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FeatureLayoutError"
  }
}

export function assertLayoutVersion(vector: FeatureVector): void {
  if (vector.layoutVersion !== FEATURE_LAYOUT_VERSION) {
    throw new FeatureLayoutError(
      `feature vector was written for layout "${vector.layoutVersion}", this build uses "${FEATURE_LAYOUT_VERSION}"`,
    )
  }
  if (vector.values.length !== FEATURE_FIELDS.length) {
    throw new FeatureLayoutError(
      `feature vector has ${vector.values.length} values, layout "${FEATURE_LAYOUT_VERSION}" expects ${FEATURE_FIELDS.length}`,
    )
  }
}
