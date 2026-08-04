import { TONEMAP_SCHEMA_VERSION, type VersionedDocument } from "./version.ts"

/**
 * MUSE ToneMap IR.
 *
 * The point of this format is separation: *what is played* (identity),
 * *what it does musically* (function), *how it sounds* (timbre),
 * *what it means dramatically* (intent) and *how it is realised*
 * (implementation) are four different things and are never collapsed into a
 * single "instrument name" field. Every automatically derived statement
 * carries its evidence and confidence.
 */

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export type ProvenanceStatus =
  | "manually-confirmed"
  | "derived"
  | "assumed"
  | "unresolved"

export type EvidenceKind =
  | "midi-event"
  | "midi-metadata"
  | "symbolic-feature"
  | "audio-feature"
  | "alignment"
  | "user-input"
  | "heuristic"
  | "model"

export interface EvidenceRef {
  kind: EvidenceKind
  /** Points at whatever produced the claim: event ids, feature names, ... */
  ref: string
  detail?: string
  weight?: number
}

export interface Provenance {
  source: string
  status: ProvenanceStatus
  confidence: number
  extractionMethod: string
  evidence: EvidenceRef[]
  createdAt: string
  updatedAt?: string
}

/** Wraps any derived value together with the reason it is believed. */
export interface Claim<T> {
  value: T
  provenance: Provenance
}

// ---------------------------------------------------------------------------
// Musical function and prominence
// ---------------------------------------------------------------------------

export const MUSICAL_FUNCTIONS = [
  "primary-melody",
  "counter-melody",
  "bass",
  "harmony",
  "pulse",
  "ostinato",
  "texture",
  "accent",
  "transition",
  "drone",
  "percussion",
  "effect",
  "unknown",
] as const
export type MusicalFunction = (typeof MUSICAL_FUNCTIONS)[number]

export const PROMINENCE_STATES = [
  "foreground",
  "midground",
  "background",
  "hidden",
  "emerging",
  "receding",
] as const
export type ProminenceState = (typeof PROMINENCE_STATES)[number]

export interface EnvelopePoint {
  /** Musical time in ticks; seconds are derived through the tempo map */
  tick: number
  value: number
  curve?: "linear" | "hold" | "ease"
}

export interface Envelope {
  points: EnvelopePoint[]
}

export interface Prominence {
  state: ProminenceState
  /** Continuous 0..1 companion to the discrete state */
  level: number
  envelope?: Envelope
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export interface RegisterProfile {
  lowestMidi: number
  highestMidi: number
  /** Duration-weighted centre of gravity */
  centroidMidi: number
  medianMidi: number
}

export interface RegisterDirection {
  targetLowMidi?: number
  targetHighMidi?: number
  octaveShift?: number
  preferredCentroidMidi?: number
  forbiddenRanges?: { lowMidi: number; highMidi: number }[]
  allowedRanges?: { lowMidi: number; highMidi: number }[]
}

// ---------------------------------------------------------------------------
// Timbre
// ---------------------------------------------------------------------------

/**
 * Canonical, instrument independent timbre axes, each 0..1.
 *
 * Only *independent* axes are stored. The brief also names darkness,
 * hardness, smoothness, stability and distance – these are strict
 * complements and are derived (see `deriveTimbreComplements`) rather than
 * stored, so the two halves of a pair can never contradict each other.
 */
export const TIMBRE_AXES = [
  "brightness",
  "warmth",
  "softness",
  "roughness",
  "metallic",
  "airy",
  "woody",
  "breathy",
  "density",
  "attackSharpness",
  "sustain",
  "decay",
  "movement",
  "intimacy",
  "stereoWidth",
  "reverberance",
  "presence",
  "weight",
  "tension",
] as const
export type TimbreAxis = (typeof TIMBRE_AXES)[number]

export type TimbreVector = Partial<Record<TimbreAxis, number>>

export const DERIVED_TIMBRE_AXES = {
  darkness: "brightness",
  hardness: "softness",
  smoothness: "roughness",
  stability: "movement",
  distance: "intimacy",
} as const
export type DerivedTimbreAxis = keyof typeof DERIVED_TIMBRE_AXES

export type FullTimbreVector = TimbreVector &
  Partial<Record<DerivedTimbreAxis, number>>

/** Adds the complementary axes (`x_complement = 1 - x`) for consumers. */
export function deriveTimbreComplements(
  vector: TimbreVector,
): FullTimbreVector {
  const full: FullTimbreVector = { ...vector }
  for (const [derived, base] of Object.entries(DERIVED_TIMBRE_AXES) as [
    DerivedTimbreAxis,
    TimbreAxis,
  ][]) {
    const value = vector[base]
    if (typeof value === "number") full[derived] = 1 - value
  }
  return full
}

/** Accepts complement axes on input and folds them back onto the canonical ones. */
export function normalizeTimbreVector(
  raw: Record<string, number | undefined>,
): TimbreVector {
  const vector: TimbreVector = {}
  for (const axis of TIMBRE_AXES) {
    const value = raw[axis]
    if (typeof value === "number") vector[axis] = clamp01(value)
  }
  for (const [derived, base] of Object.entries(DERIVED_TIMBRE_AXES) as [
    DerivedTimbreAxis,
    TimbreAxis,
  ][]) {
    const value = raw[derived]
    if (typeof value === "number" && vector[base] === undefined) {
      vector[base] = clamp01(1 - value)
    }
  }
  return vector
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

// ---------------------------------------------------------------------------
// Articulation
// ---------------------------------------------------------------------------

/**
 * Known articulations. The type stays open (`| string`) on purpose: no
 * sample library implements the same set, and an unknown articulation must
 * survive a round trip instead of being dropped.
 */
export const KNOWN_ARTICULATIONS = [
  "legato",
  "sustain",
  "staccato",
  "marcato",
  "accent",
  "tremolo",
  "pizzicato",
  "spiccato",
  "swell",
  "crescendo",
  "decrescendo",
  "mute",
  "flutter",
  "roll",
  "unknown",
] as const
export type KnownArticulation = (typeof KNOWN_ARTICULATIONS)[number]
export type Articulation = KnownArticulation | (string & {})

export interface ArticulationDirection {
  articulation: Articulation
  /** Used when the target library cannot provide the requested articulation */
  fallbacks?: Articulation[]
}

// ---------------------------------------------------------------------------
// Dynamics and mix
// ---------------------------------------------------------------------------

export interface DynamicProfile {
  meanVelocity: number
  minVelocity: number
  maxVelocity: number
  /** 0..1 spread of the velocity distribution */
  variability: number
  envelope?: Envelope
}

export interface MixDirection {
  /** Target loudness in dBFS (negative), library independent */
  loudnessTargetDb?: number
  relativeProminence?: number
  pan?: number
  width?: number
  depth?: number
  reverbSend?: number
  chorusSend?: number
  /** Voices that duck when this one is in the foreground */
  duckingTargets?: string[]
  foregroundPriority?: number
}

// ---------------------------------------------------------------------------
// Emotional intent
// ---------------------------------------------------------------------------

export const EMOTION_AXES = [
  "valence",
  "arousal",
  "dominance",
  "tension",
  "vulnerability",
  "dignity",
  "menace",
  "wonder",
  "comedy",
  "heroism",
  "intimacy",
  "urgency",
  "melancholy",
  "absurdity",
] as const
export type EmotionAxis = (typeof EMOTION_AXES)[number]

export interface EmotionalIntent {
  axes: Partial<Record<EmotionAxis, number>>
  /**
   * Free-language tags such as "unangenehm würdevoll". Stored verbatim; no
   * interpreter is required at write time and none is assumed at read time.
   */
  tags: string[]
  note?: string
}

// ---------------------------------------------------------------------------
// Implementation (kept strictly apart from the semantic layer)
// ---------------------------------------------------------------------------

export type InstrumentFamily =
  | "strings"
  | "woodwinds"
  | "brass"
  | "percussion"
  | "keys"
  | "plucked"
  | "choir"
  | "synth"
  | "folk"
  | "other"

export interface PatchCandidate {
  /** Stable id of a patch inside a library manifest */
  patchId: string
  libraryId: string
  displayName?: string
  family?: InstrumentFamily
  instrument?: string
  articulation?: Articulation
  /** 0..1 ranking score with the reason it was ranked that way */
  score: number
  reasons: string[]
  keyswitch?: number
  bank?: number
  program?: number
  sfzPath?: string
  soundFontPreset?: { bank: number; program: number }
  controllerMapping?: Record<string, number>
  fallbackPatchIds?: string[]
}

export interface ImplementationTarget {
  family?: InstrumentFamily
  instrument?: string
  libraryId?: string
  patchId?: string
  articulation?: Articulation
  keyswitch?: number
  controllerMapping?: Record<string, number>
  fallbackCandidates: PatchCandidate[]
}

// ---------------------------------------------------------------------------
// Identity graph: song / section / track / voice / phrase / motif / event
// ---------------------------------------------------------------------------

export type ToneMapNodeKind =
  | "song"
  | "section"
  | "track"
  | "voice"
  | "phrase"
  | "motif"
  | "motif-occurrence"
  | "note-event"

export interface TimeRange {
  startTick: number
  endTick: number
  startSeconds?: number
  endSeconds?: number
}

export interface ToneMapNode {
  id: string
  kind: ToneMapNodeKind
  label?: string
  parentId?: string
  childIds: string[]
  range?: TimeRange
  /** Motif variants point at the motif they are a variant of */
  variantOfId?: string
  /** e.g. transposition in semitones for a motif variant */
  variantTransform?: { transposeSemitones?: number; timeScale?: number }
  provenance: Provenance
}

// ---------------------------------------------------------------------------
// Observation: the actual tone mapping statement
// ---------------------------------------------------------------------------

export interface SymbolicFeatureVector {
  noteCount: number
  noteDensityPerBeat: number
  meanDurationTicks: number
  pitchRange: number
  meanIntervalAbs: number
  polyphony: number
  isMonophonic: boolean
  syncopation: number
  restRatio: number
  repetitionScore: number
  velocityMean: number
  velocityVariance: number
  sustainPedalRatio: number
  legatoRatio: number
}

export interface AcousticFeatureVector {
  rms: number
  peak: number
  loudnessDb: number
  spectralCentroidHz: number
  spectralBandwidthHz: number
  spectralRolloffHz: number
  spectralFlatness: number
  zeroCrossingRate: number
  onsetStrength: number
  transientStrength: number
  sustainEstimate: number
  lowEnergy: number
  midEnergy: number
  highEnergy: number
  stereoWidth: number
  balance: number
  chroma: number[]
  silenceRatio: number
}

export interface ToneMapObservation {
  id: string
  /** Node id in the identity graph this observation talks about */
  sourceRef: string
  timeRange: TimeRange
  musicalFunction: Claim<MusicalFunction>
  prominence: Claim<Prominence>
  register: RegisterProfile
  symbolicFeatures?: SymbolicFeatureVector
  acousticFeatures?: AcousticFeatureVector
  timbreIntent: TimbreVector
  articulation?: Claim<Articulation>
  dynamics?: DynamicProfile
  mix?: MixDirection
  emotionalIntent?: EmotionalIntent
  implementation?: ImplementationTarget
  implementationHints: PatchCandidate[]
  confidence: number
  evidence: EvidenceRef[]
}

// ---------------------------------------------------------------------------
// Dramaturgy: motif direction (Adaptive Pathos bridge)
// ---------------------------------------------------------------------------

export type MotifTrigger =
  | { type: "time"; startBeat: number }
  | { type: "tick"; startTick: number }
  | { type: "section"; sectionId: string }
  | { type: "game-state"; state: string }
  | { type: "dramatic-event"; event: string }

export interface InstrumentDirection {
  family?: InstrumentFamily
  instrument?: string
  patchId?: string
  libraryId?: string
  /** Hand the motif over to another instrument at this point */
  handoffFromNodeId?: string
  doubling?: {
    family?: InstrumentFamily
    instrument?: string
    octaveShift?: number
  }[]
}

export interface MotifDirection {
  id: string
  motifId: string
  trigger: MotifTrigger
  preserve: {
    identity: boolean
    rhythm?: boolean
    harmony?: boolean
    contour?: boolean
    register?: boolean
    instrumentation?: boolean
  }
  prominence?: number | Envelope
  register?: RegisterDirection
  instrumentation?: InstrumentDirection
  articulation?: ArticulationDirection
  mix?: MixDirection
  emotionalIntent?: EmotionalIntent
  /** Kept verbatim even when no intent translator exists yet */
  freeTextIntent?: string
  provenance: Provenance
}

// ---------------------------------------------------------------------------
// Document root
// ---------------------------------------------------------------------------

export interface ToneMapProject extends VersionedDocument {
  schemaVersion: typeof TONEMAP_SCHEMA_VERSION | string
  id: string
  name: string
  createdAt: string
  updatedAt: string
  /** Reference to the paired source manifest this project was built from */
  sourcePairId?: string
  ticksPerQuarterNote: number
  nodes: ToneMapNode[]
  observations: ToneMapObservation[]
  directions: MotifDirection[]
  /** Free notes the user made that no automation may overwrite */
  notes?: string[]
}

export function createToneMapProject(options: {
  id: string
  name: string
  ticksPerQuarterNote: number
  sourcePairId?: string
  now?: string
}): ToneMapProject {
  const now = options.now ?? new Date().toISOString()
  return {
    schemaVersion: TONEMAP_SCHEMA_VERSION,
    id: options.id,
    name: options.name,
    createdAt: now,
    updatedAt: now,
    sourcePairId: options.sourcePairId,
    ticksPerQuarterNote: options.ticksPerQuarterNote,
    nodes: [],
    observations: [],
    directions: [],
  }
}

export function createProvenance(options: {
  source: string
  status?: ProvenanceStatus
  confidence?: number
  extractionMethod: string
  evidence?: EvidenceRef[]
  now?: string
}): Provenance {
  return {
    source: options.source,
    status: options.status ?? "derived",
    confidence: clamp01(options.confidence ?? 0.5),
    extractionMethod: options.extractionMethod,
    evidence: options.evidence ?? [],
    createdAt: options.now ?? new Date().toISOString(),
  }
}
