/**
 * MUSE ToneMap: a versioned intermediate representation that keeps musical
 * identity, musical function, audible timbre, dramatic intent and concrete
 * implementation apart – and can put them back together on purpose.
 *
 * Nothing in this package depends on the browser, on React or on a model.
 */

export * from "./alignment/alignment.ts"
export * from "./audio/features.ts"
export * from "./audio/pcm.ts"
export * from "./audio/synthetic.ts"
export * from "./libraries/manifest.ts"
export * from "./libraries/sfzScanner.ts"
export * from "./midi/debugFormat.ts"
export * from "./midi/eventGraph.ts"
export * from "./midi/synthetic.ts"
export * from "./motifs/motifGraph.ts"
export {
  addDirection,
  assignInstrument,
  checkRange,
  checkVoiceCrossing,
  createPlanFromGraph,
  doublePart,
  duplicatePart,
  extractMotif,
  melodyHandoff,
  type OrchestrationPlan,
  type PlanNote,
  type PlanOperation,
  type PlanOperationKind,
  type PlanPart,
  type PlanWarning,
  setArticulation,
  setProminence,
  splitChord,
  transposePart,
  undoLastOperation,
  // `InstrumentRange` is exported from ./libraries/manifest.ts – the plan
  // module declares the same shape locally, so only one of them is public.
} from "./orchestration/plan.ts"
export * from "./pairing/pairedSource.ts"
export * from "./pairing/privateAssets.ts"
export * from "./ranking/featureLayout.ts"
export * from "./ranking/ranker.ts"
export * from "./schema/tonemap.ts"
export * from "./schema/validate.ts"
export * from "./schema/version.ts"
export * from "./tonemap/observations.ts"
export * from "./training/records.ts"
