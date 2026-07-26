import type { FeatureVector } from "../ranking/featureLayout.ts"
import type {
  AcousticFeatureVector,
  EmotionalIntent,
  PatchCandidate,
  Provenance,
} from "../schema/tonemap.ts"
import { TRAINING_RECORD_SCHEMA_VERSION } from "../schema/version.ts"

/**
 * Training records.
 *
 * Every confirmed (or rejected) assignment can become a training example for
 * the later small model. Negative examples matter as much as positive ones,
 * and a *happy accident* is neither: `serendipitous-alternative` keeps the
 * "wrong but better" cases instead of throwing them away as errors.
 */

export const JUDGEMENT_TAGS = [
  "good-fit",
  "wrong-instrument",
  "right-melody-wrong-timbre",
  "right-pitch-wrong-register-feel",
  "background-too-dominant",
  "serendipitous-alternative",
  "better-than-original",
  "technically-correct-emotionally-wrong",
] as const
export type JudgementTag = (typeof JUDGEMENT_TAGS)[number]

export interface HumanJudgement {
  rating?: number
  tags?: (JudgementTag | string)[]
  notes?: string
  accepted: boolean
}

export interface ToneMapTrainingRecord {
  schemaVersion: string
  id: string
  sourcePairId: string
  segmentRef: string
  motifRef?: string
  inputFeatures: number[]
  featureMask: number[]
  featureLayoutVersion: string
  candidates: PatchCandidate[]
  selectedCandidate?: string
  requestedIntent?: EmotionalIntent
  observedResult?: AcousticFeatureVector
  humanJudgement?: HumanJudgement
  provenance: Provenance
}

export function createTrainingRecord(options: {
  id: string
  sourcePairId: string
  segmentRef: string
  motifRef?: string
  features: FeatureVector
  candidates: PatchCandidate[]
  selectedCandidate?: string
  requestedIntent?: EmotionalIntent
  observedResult?: AcousticFeatureVector
  humanJudgement?: HumanJudgement
  provenance: Provenance
}): ToneMapTrainingRecord {
  return {
    schemaVersion: TRAINING_RECORD_SCHEMA_VERSION,
    id: options.id,
    sourcePairId: options.sourcePairId,
    segmentRef: options.segmentRef,
    motifRef: options.motifRef,
    inputFeatures: options.features.values,
    featureMask: options.features.mask,
    featureLayoutVersion: options.features.layoutVersion,
    candidates: options.candidates,
    selectedCandidate: options.selectedCandidate,
    requestedIntent: options.requestedIntent,
    observedResult: options.observedResult,
    humanJudgement: options.humanJudgement,
    provenance: options.provenance,
  }
}

/** True when the record teaches "this was right". */
export function isPositiveExample(record: ToneMapTrainingRecord): boolean {
  const judgement = record.humanJudgement
  if (!judgement) return false
  if (judgement.accepted) return true
  return (judgement.tags ?? []).includes("serendipitous-alternative")
}

/**
 * A wrong assignment that sounded good is kept as its own class: it is not a
 * label error, it is a discovery.
 */
export function isSerendipitous(record: ToneMapTrainingRecord): boolean {
  return (record.humanJudgement?.tags ?? []).includes(
    "serendipitous-alternative",
  )
}

export function exportTrainingRecordsAsJsonl(
  records: ToneMapTrainingRecord[],
): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
}

export function parseTrainingRecordsJsonl(
  text: string,
): ToneMapTrainingRecord[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ToneMapTrainingRecord)
}

export interface TrainingSetSummary {
  total: number
  positive: number
  negative: number
  serendipitous: number
  byLayoutVersion: Record<string, number>
  unlabelled: number
}

export function summarizeTrainingSet(
  records: ToneMapTrainingRecord[],
): TrainingSetSummary {
  const byLayoutVersion: Record<string, number> = {}
  let positive = 0
  let negative = 0
  let serendipitous = 0
  let unlabelled = 0

  for (const record of records) {
    byLayoutVersion[record.featureLayoutVersion] =
      (byLayoutVersion[record.featureLayoutVersion] ?? 0) + 1
    if (!record.humanJudgement) {
      unlabelled++
      continue
    }
    if (isSerendipitous(record)) serendipitous++
    if (isPositiveExample(record)) positive++
    else negative++
  }

  return {
    total: records.length,
    positive,
    negative,
    serendipitous,
    byLayoutVersion,
    unlabelled,
  }
}
