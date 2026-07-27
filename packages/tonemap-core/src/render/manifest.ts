import { stableHash } from "../motifs/motifGraph.ts"
import type { OrchestrationPlan } from "../orchestration/plan.ts"
import type { PatchCandidate } from "../schema/tonemap.ts"
import {
  RENDER_MANIFEST_SCHEMA_VERSION,
  type VersionedDocument,
} from "../schema/version.ts"
import type { RenderJob } from "./adapters.ts"

/**
 * Render manifest: what was rendered, from which plan, with which patches.
 *
 * A rendered WAV on its own says nothing about where it came from. The
 * manifest is the record that makes a render traceable and repeatable – and,
 * through `planFingerprint`, lets a later run notice that the plan has moved
 * on since the audio was produced.
 */

export interface RenderedOutput {
  jobId: string
  label: string
  partId?: string
  path: string
  /** Files the job needed, relative to the render directory */
  inputs: string[]
  command?: string
  /** Anything the adapter could not resolve; an empty list means clean */
  issues: string[]
}

export interface RenderPatchRecord {
  partId: string
  patchId: string
  libraryId: string
  displayName: string
  /** Why this patch – copied from the ranker so the choice stays explainable */
  reasons: string[]
  score: number
}

export interface RenderManifest extends VersionedDocument {
  schemaVersion: string
  id: string
  createdAt: string
  adapter: string
  toneMapProjectId: string
  /** Changes whenever the plan changes, so a stale render is detectable */
  planFingerprint: string
  sampleRate?: number
  outputDirectory: string
  libraries: { id: string; name: string; version?: string }[]
  patches: RenderPatchRecord[]
  outputs: RenderedOutput[]
  /**
   * True when every job can actually produce its output: no unresolved
   * issues, and either a command to run or an input that *is* the output
   * (which is the case for the MIDI adapter).
   */
  complete: boolean
}

/**
 * Content hash of everything that changes the sound: parts, notes, chosen
 * instruments and the operations that produced them.
 */
export function planFingerprint(
  plan: OrchestrationPlan,
  patches: Record<string, PatchCandidate>,
): string {
  const parts = plan.parts.map((part) => ({
    id: part.id,
    family: part.family,
    instrument: part.instrument,
    articulation: part.articulation,
    muted: part.muted === true,
    prominence: part.prominence,
    patch: patches[part.id]?.patchId,
    notes: part.notes.map((note) => [
      note.startTick,
      note.endTick,
      note.noteNumber,
      note.velocity,
    ]),
  }))
  return stableHash(
    JSON.stringify({
      ppq: plan.ticksPerQuarterNote,
      parts,
      operations: plan.operations.map((operation) => operation.kind),
    }),
  )
}

export function createRenderManifest(options: {
  id?: string
  adapter: string
  plan: OrchestrationPlan
  patches: Record<string, PatchCandidate>
  jobs: RenderJob[]
  outputDirectory: string
  libraries: { id: string; name: string; version?: string }[]
  sampleRate?: number
  now?: string
}): RenderManifest {
  const fingerprint = planFingerprint(options.plan, options.patches)
  const outputs: RenderedOutput[] = options.jobs.map((job) => ({
    jobId: job.id,
    label: job.label,
    partId: job.partId,
    path: job.outputPath,
    inputs: job.inputs.map((file) => file.path),
    command: job.command?.display,
    issues: job.issues,
  }))

  const patches: RenderPatchRecord[] = Object.entries(options.patches).map(
    ([partId, candidate]) => ({
      partId,
      patchId: candidate.patchId,
      libraryId: candidate.libraryId,
      displayName: candidate.displayName ?? candidate.patchId,
      reasons: candidate.reasons,
      score: candidate.score,
    }),
  )

  return {
    schemaVersion: RENDER_MANIFEST_SCHEMA_VERSION,
    id: options.id ?? `render-${fingerprint}`,
    createdAt: options.now ?? new Date().toISOString(),
    adapter: options.adapter,
    toneMapProjectId: options.plan.toneMapProjectId,
    planFingerprint: fingerprint,
    sampleRate: options.sampleRate,
    outputDirectory: options.outputDirectory,
    libraries: options.libraries,
    patches,
    outputs,
    complete: options.jobs.every(
      (job) =>
        job.issues.length === 0 &&
        (job.command !== undefined ||
          job.inputs.some((file) => file.path === job.outputPath)),
    ),
  }
}

/** True when the plan has changed since this manifest was written. */
export function isStale(
  manifest: RenderManifest,
  plan: OrchestrationPlan,
  patches: Record<string, PatchCandidate>,
): boolean {
  return manifest.planFingerprint !== planFingerprint(plan, patches)
}
