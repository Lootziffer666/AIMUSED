import type {
  InstrumentLibraryManifest,
  InstrumentPatch,
} from "../libraries/manifest.ts"
import {
  type Articulation,
  clamp01,
  type MusicalFunction,
  type PatchCandidate,
  type RegisterProfile,
  TIMBRE_AXES,
  type TimbreVector,
} from "../schema/tonemap.ts"
import { FEATURE_LAYOUT_VERSION } from "../schema/version.ts"
import {
  type EncodeInput,
  encodeFeatures,
  type FeatureVector,
} from "./featureLayout.ts"

/**
 * Patch ranking.
 *
 * `PatchRanker` is the seam a small ONNX model will later slot into. What
 * ships today is a heuristic baseline that works without any model, explains
 * every score in words, and produces exactly the inputs/outputs a model
 * would need – so swapping it in changes no callers.
 */

export interface RankRequest {
  musicalFunction?: MusicalFunction
  register?: RegisterProfile
  desiredTimbre?: TimbreVector
  articulation?: Articulation
  /** Encoded features, for model based rankers */
  features?: FeatureVector
  limit?: number
}

export interface PatchRanker {
  readonly name: string
  rank(
    request: RankRequest,
    libraries: InstrumentLibraryManifest[],
  ): PatchCandidate[]
}

/** Family preferences per musical function – the "obvious" orchestration knowledge. */
const FUNCTION_FAMILY_BIAS: Partial<Record<MusicalFunction, string[]>> = {
  "primary-melody": ["strings", "woodwinds", "brass", "keys", "choir"],
  "counter-melody": ["woodwinds", "strings", "brass"],
  bass: ["strings", "brass", "keys", "synth"],
  harmony: ["strings", "keys", "choir", "synth"],
  pulse: ["percussion", "plucked", "keys"],
  ostinato: ["plucked", "keys", "strings", "percussion"],
  texture: ["synth", "strings", "choir"],
  drone: ["synth", "strings", "brass"],
  percussion: ["percussion"],
  accent: ["percussion", "brass"],
  transition: ["percussion", "synth"],
  effect: ["synth", "percussion"],
}

/** Fallback timbre per family for patches without a measured vector. */
const FAMILY_TIMBRE: Record<string, TimbreVector> = {
  strings: {
    brightness: 0.45,
    warmth: 0.7,
    softness: 0.6,
    sustain: 0.8,
    weight: 0.5,
  },
  woodwinds: {
    brightness: 0.55,
    warmth: 0.6,
    softness: 0.6,
    breathy: 0.6,
    sustain: 0.7,
  },
  brass: {
    brightness: 0.7,
    warmth: 0.5,
    softness: 0.3,
    metallic: 0.6,
    weight: 0.6,
  },
  percussion: {
    brightness: 0.6,
    attackSharpness: 0.9,
    sustain: 0.2,
    decay: 0.8,
  },
  keys: { brightness: 0.5, attackSharpness: 0.7, sustain: 0.5, softness: 0.5 },
  plucked: { brightness: 0.6, attackSharpness: 0.8, sustain: 0.3, decay: 0.7 },
  choir: {
    brightness: 0.4,
    warmth: 0.8,
    softness: 0.8,
    breathy: 0.5,
    sustain: 0.9,
  },
  synth: { brightness: 0.5, sustain: 0.6, movement: 0.4 },
  folk: { brightness: 0.5, warmth: 0.6, woody: 0.6 },
  other: {},
}

function timbreOf(patch: InstrumentPatch): TimbreVector {
  if (patch.timbre && Object.keys(patch.timbre).length > 0) return patch.timbre
  return FAMILY_TIMBRE[patch.family] ?? {}
}

/** 1 = identical on every axis both sides define, 0 = maximally different. */
export function timbreSimilarity(a: TimbreVector, b: TimbreVector): number {
  let sum = 0
  let count = 0
  for (const axis of TIMBRE_AXES) {
    const left = a[axis]
    const right = b[axis]
    if (left === undefined || right === undefined) continue
    sum += 1 - Math.abs(left - right)
    count++
  }
  return count === 0 ? 0.5 : sum / count
}

export function registerFit(
  patch: InstrumentPatch,
  register: RegisterProfile,
): { score: number; reason: string } {
  const { lowMidi, highMidi, preferredLowMidi, preferredHighMidi } = patch.range
  if (register.lowestMidi < lowMidi || register.highestMidi > highMidi) {
    const missing =
      Math.max(0, lowMidi - register.lowestMidi) +
      Math.max(0, register.highestMidi - highMidi)
    return {
      score: clamp01(1 - missing / 24) * 0.4,
      reason: `${missing} semitones outside the playable range`,
    }
  }
  if (preferredLowMidi !== undefined && preferredHighMidi !== undefined) {
    const inside =
      register.centroidMidi >= preferredLowMidi &&
      register.centroidMidi <= preferredHighMidi
    return inside
      ? { score: 1, reason: "sits in the comfortable range" }
      : { score: 0.7, reason: "playable, but outside the comfortable range" }
  }
  return { score: 0.85, reason: "inside the playable range" }
}

export class HeuristicPatchRanker implements PatchRanker {
  readonly name = "heuristic-baseline-v1"

  rank(
    request: RankRequest,
    libraries: InstrumentLibraryManifest[],
  ): PatchCandidate[] {
    const candidates: PatchCandidate[] = []

    for (const library of libraries) {
      for (const patch of library.patches) {
        const reasons: string[] = []
        let score = 0
        let weight = 0

        if (request.register) {
          const fit = registerFit(patch, request.register)
          score += fit.score * 0.35
          weight += 0.35
          reasons.push(`register: ${fit.reason}`)
        }

        if (
          request.desiredTimbre &&
          Object.keys(request.desiredTimbre).length > 0
        ) {
          const similarity = timbreSimilarity(
            request.desiredTimbre,
            timbreOf(patch),
          )
          score += similarity * 0.3
          weight += 0.3
          reasons.push(
            `timbre similarity ${(similarity * 100).toFixed(0)} %${
              patch.timbre ? "" : " (family default)"
            }`,
          )
        }

        if (request.musicalFunction) {
          const preferred = FUNCTION_FAMILY_BIAS[request.musicalFunction] ?? []
          const rank = preferred.indexOf(patch.family)
          const familyScore =
            rank === -1
              ? 0.25
              : 1 - rank * (0.5 / Math.max(1, preferred.length))
          score += familyScore * 0.2
          weight += 0.2
          reasons.push(
            rank === -1
              ? `${patch.family} is unusual for ${request.musicalFunction}`
              : `${patch.family} is a common choice for ${request.musicalFunction}`,
          )
        }

        if (request.articulation) {
          const match = patch.articulation === request.articulation
          const hasKeyswitch = patch.keyswitches?.some(
            (entry) => entry.articulation === request.articulation,
          )
          const articulationScore = match ? 1 : hasKeyswitch ? 0.9 : 0.3
          score += articulationScore * 0.15
          weight += 0.15
          reasons.push(
            match
              ? `articulation ${request.articulation} is the patch itself`
              : hasKeyswitch
                ? `articulation ${request.articulation} available via keyswitch`
                : `patch only offers ${patch.articulation}`,
          )
        }

        const finalScore = weight > 0 ? clamp01(score / weight) : 0.5
        candidates.push({
          patchId: patch.id,
          libraryId: library.id,
          displayName: patch.displayName,
          family: patch.family,
          instrument: patch.instrument,
          articulation: patch.articulation,
          score: Number(finalScore.toFixed(4)),
          reasons,
          sfzPath: patch.sfzPath,
          soundFontPreset: patch.soundFontPreset,
          keyswitch: patch.keyswitches?.find(
            (entry) => entry.articulation === request.articulation,
          )?.noteNumber,
          fallbackPatchIds: patch.fallbackPatchIds,
        })
      }
    }

    const sorted = candidates.sort(
      (a, b) => b.score - a.score || a.patchId.localeCompare(b.patchId),
    )
    const limited = sorted.slice(0, request.limit ?? 5)

    // every candidate names its own fallbacks, so a missing patch is survivable
    return limited.map((candidate, index) => ({
      ...candidate,
      fallbackPatchIds:
        candidate.fallbackPatchIds ??
        sorted.slice(index + 1, index + 3).map((entry) => entry.patchId),
    }))
  }
}

/**
 * Contract a model based ranker has to fulfil. Deliberately synchronous
 * shape-wise but async in execution, so an ONNX session can be loaded lazily.
 */
export interface InferenceContract {
  /** Layout the model was trained against */
  featureLayoutVersion: string
  /** Number of candidates the model scores at once, or -1 for variable */
  batchSize: number
  inputName: string
  maskName: string
  outputName: string
}

export interface ModelBackedRanker extends PatchRanker {
  readonly contract: InferenceContract
  isAvailable(): boolean
}

/** A loaded model. `onnxSession.ts` produces one from an ONNX Runtime. */
export interface ScoringSession {
  readonly contract: InferenceContract
  score(features: FeatureVector, candidateCount: number): Promise<number[]>
}

/**
 * Model backed ranker.
 *
 * The model only ever *reorders* the heuristic shortlist, and it can only do
 * that through `rankAsync` – inference is asynchronous, so the synchronous
 * `rank` deliberately returns the heuristic result. That keeps every caller
 * working with or without a model, which is the whole point: the system must
 * not require one.
 */
export class OnnxPatchRanker implements ModelBackedRanker {
  readonly name = "onnx-adapter-v1"
  readonly contract: InferenceContract

  private session: ScoringSession | null
  private syncSession: ((input: FeatureVector) => number[]) | null
  private fallback: PatchRanker

  constructor(
    options: {
      /** Asynchronous model, e.g. from `loadOnnxSession` */
      session?: ScoringSession
      /** Pre-computed or in-process scorer, used by `rank` as well */
      syncSession?: (input: FeatureVector) => number[]
      fallback?: PatchRanker
      contract?: InferenceContract
    } = {},
  ) {
    this.session = options.session ?? null
    this.syncSession = options.syncSession ?? null
    this.fallback = options.fallback ?? new HeuristicPatchRanker()
    this.contract = options.contract ??
      options.session?.contract ?? {
        featureLayoutVersion: FEATURE_LAYOUT_VERSION,
        batchSize: -1,
        inputName: "features",
        maskName: "mask",
        outputName: "scores",
      }
  }

  isAvailable(): boolean {
    return this.session !== null || this.syncSession !== null
  }

  private featuresFor(request: RankRequest): FeatureVector {
    return (
      request.features ??
      encodeFeatures({
        musicalFunction: request.musicalFunction,
        register: request.register,
        timbre: request.desiredTimbre,
      } satisfies EncodeInput)
    )
  }

  private applyScores(
    baseline: PatchCandidate[],
    scores: number[],
  ): PatchCandidate[] {
    return baseline
      .map((candidate, index) => ({
        ...candidate,
        score: scores[index] ?? candidate.score,
        reasons: [...candidate.reasons, `model score from ${this.name}`],
      }))
      .sort((a, b) => b.score - a.score || a.patchId.localeCompare(b.patchId))
  }

  rank(
    request: RankRequest,
    libraries: InstrumentLibraryManifest[],
  ): PatchCandidate[] {
    const baseline = this.fallback.rank(
      { ...request, limit: request.limit ?? 5 },
      libraries,
    )
    if (!this.syncSession) return baseline
    return this.applyScores(
      baseline,
      this.syncSession(this.featuresFor(request)),
    )
  }

  /**
   * Ranks with the model when one is loaded. A model that fails is not fatal:
   * the heuristic result is returned and the reason is attached to every
   * candidate, so a broken model degrades visibly instead of silently.
   */
  async rankAsync(
    request: RankRequest,
    libraries: InstrumentLibraryManifest[],
  ): Promise<PatchCandidate[]> {
    const baseline = this.rank(request, libraries)
    if (!this.session || baseline.length === 0) return baseline
    try {
      const scores = await this.session.score(
        this.featuresFor(request),
        baseline.length,
      )
      return this.applyScores(baseline, scores)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return baseline.map((candidate) => ({
        ...candidate,
        reasons: [...candidate.reasons, `model unavailable: ${message}`],
      }))
    }
  }
}
