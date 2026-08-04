import type {
  InstrumentLibraryManifest,
  InstrumentPatch,
} from "../libraries/manifest.ts"
import { LibraryPathError, resolvePatchPath } from "../libraries/manifest.ts"
import type { OrchestrationPlan } from "../orchestration/plan.ts"
import type { PatchCandidate } from "../schema/tonemap.ts"
import {
  type PlanMidiResult,
  type PlanToMidiOptions,
  planToMidi,
  planToStemMidi,
} from "./renderPlan.ts"

/**
 * Rendering adapters.
 *
 * An adapter turns a plan into *jobs*: the files to write, the command to run
 * and the outputs to expect. It never spawns anything itself – the host owns
 * process execution, and keeping that out of here is what makes a render
 * plannable, reviewable and testable without a renderer installed.
 */

export interface RenderFile {
  /** Relative to the render directory */
  path: string
  bytes: Uint8Array
  kind: "midi" | "sfz" | "text"
}

export interface RenderCommand {
  /** Executable name, resolved by the host on PATH */
  program: string
  args: string[]
  /** Human readable, for logs and for a dry run */
  display: string
}

export interface RenderJob {
  id: string
  label: string
  /** Which plan part this renders, or undefined for the full mix */
  partId?: string
  inputs: RenderFile[]
  command?: RenderCommand
  outputPath: string
  /** What could not be resolved – a job with issues is still described */
  issues: string[]
}

export interface RenderRequest {
  plan: OrchestrationPlan
  libraries: InstrumentLibraryManifest[]
  /** Chosen patch per part id */
  patches: Record<string, PatchCandidate>
  outputDirectory: string
  sampleRate?: number
  /** Only for the SoundFont adapter */
  soundFontPath?: string
  /** Conductor data from the imported file, so stems line up with it */
  source?: PlanToMidiOptions["source"]
}

export interface RenderAdapter {
  readonly name: string
  /** Formats this adapter can play, purely informational */
  readonly renders: string[]
  plan(request: RenderRequest): RenderJob[]
}

function midiFile(path: string, result: PlanMidiResult): RenderFile {
  return { path, bytes: result.bytes, kind: "midi" }
}

function slugify(label: string, fallback: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return slug.length > 0 ? slug : fallback
}

/**
 * Stem file names, disambiguated.
 *
 * Two parts may carry the same label – duplicating a voice is a normal
 * orchestration move – and two stems writing to one path would silently
 * overwrite each other. So a repeated name gets a counter.
 */
function stemNames(
  stems: { partId: string; label: string }[],
): Map<string, string> {
  const used = new Map<string, number>()
  const names = new Map<string, string>()
  for (const stem of stems) {
    const base = slugify(stem.label, stem.partId)
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    names.set(stem.partId, seen === 0 ? base : `${base}-${seen + 1}`)
  }
  return names
}

function findPatch(
  libraries: InstrumentLibraryManifest[],
  candidate: PatchCandidate | undefined,
): { library: InstrumentLibraryManifest; patch: InstrumentPatch } | undefined {
  if (!candidate) return undefined
  for (const library of libraries) {
    if (library.id !== candidate.libraryId) continue
    const patch = library.patches.find(
      (entry) => entry.id === candidate.patchId,
    )
    if (patch) return { library, patch }
  }
  return undefined
}

/**
 * The adapter that always works: writes MIDI and nothing else.
 *
 * Every other adapter builds on its output, and a host with no renderer
 * installed can still take the result into any DAW.
 */
export class MidiRenderAdapter implements RenderAdapter {
  readonly name = "midi"
  readonly renders = ["mid"]

  plan(request: RenderRequest): RenderJob[] {
    const full = planToMidi(request.plan, {
      patches: request.patches,
      source: request.source,
    })
    const jobs: RenderJob[] = [
      {
        id: "mix",
        label: "full arrangement",
        inputs: [midiFile(`${request.outputDirectory}/arrangement.mid`, full)],
        outputPath: `${request.outputDirectory}/arrangement.mid`,
        issues: full.warnings,
      },
    ]
    const stems = planToStemMidi(request.plan, {
      patches: request.patches,
      source: request.source,
    })
    const names = stemNames(stems)
    for (const stem of stems) {
      const name = names.get(stem.partId) ?? stem.partId
      jobs.push({
        id: `stem-${stem.partId}`,
        label: stem.label,
        partId: stem.partId,
        inputs: [
          midiFile(`${request.outputDirectory}/${name}.mid`, stem.result),
        ],
        outputPath: `${request.outputDirectory}/${name}.mid`,
        issues: stem.result.warnings,
      })
    }
    return jobs
  }
}

/**
 * sfizz: one SFZ instrument plus one MIDI file per stem.
 *
 * The SFZ path comes from the library manifest and is resolved against its
 * configurable root, so no absolute path is ever baked into a manifest.
 */
export class SfizzRenderAdapter implements RenderAdapter {
  readonly name = "sfizz"
  readonly renders = ["wav"]

  plan(request: RenderRequest): RenderJob[] {
    const sampleRate = request.sampleRate ?? 48000
    const jobs: RenderJob[] = []

    const stems = planToStemMidi(request.plan, {
      patches: request.patches,
      source: request.source,
    })
    const names = stemNames(stems)
    for (const stem of stems) {
      const issues = [...stem.result.warnings]
      const name = names.get(stem.partId) ?? stem.partId
      const midiPath = `${request.outputDirectory}/${name}.mid`
      const outputPath = `${request.outputDirectory}/${name}.wav`
      const candidate = request.patches[stem.partId]
      const found = findPatch(request.libraries, candidate)

      let sfzPath: string | undefined
      if (!found) {
        issues.push(
          candidate
            ? `patch "${candidate.patchId}" is not in any of the given libraries`
            : "no patch chosen for this part",
        )
      } else if (!found.patch.sfzPath) {
        issues.push(
          `patch "${found.patch.id}" has no sfzPath – sfizz needs an SFZ instrument`,
        )
      } else {
        try {
          sfzPath = resolvePatchPath(found.library, found.patch.id)
        } catch (error) {
          issues.push(
            error instanceof LibraryPathError
              ? error.message
              : String(error instanceof Error ? error.message : error),
          )
        }
      }

      jobs.push({
        id: `sfizz-${stem.partId}`,
        label: stem.label,
        partId: stem.partId,
        inputs: [midiFile(midiPath, stem.result)],
        outputPath,
        command: sfzPath
          ? {
              program: "sfizz_render",
              args: [
                "--sfz",
                sfzPath,
                "--midi",
                midiPath,
                "--wav",
                outputPath,
                "--samplerate",
                String(sampleRate),
              ],
              display: `sfizz_render --sfz ${sfzPath} --midi ${midiPath} --wav ${outputPath} --samplerate ${sampleRate}`,
            }
          : undefined,
        issues,
      })
    }

    return jobs
  }
}

/**
 * FluidSynth: one SoundFont for everything, patches selected by bank/program.
 *
 * This is the adapter that works without a sample library installed, which is
 * why the MUSE SoundFont manifest states presets rather than SFZ paths.
 */
export class FluidSynthRenderAdapter implements RenderAdapter {
  readonly name = "fluidsynth"
  readonly renders = ["wav"]

  plan(request: RenderRequest): RenderJob[] {
    const sampleRate = request.sampleRate ?? 48000
    const issues: string[] = []
    if (!request.soundFontPath) {
      issues.push("no SoundFont given – set soundFontPath")
    }

    const full = planToMidi(request.plan, {
      patches: request.patches,
      source: request.source,
    })
    for (const assignment of full.assignments) {
      if (assignment.program === undefined) {
        const part = request.plan.parts.find(
          (entry) => entry.id === assignment.partId,
        )
        issues.push(
          `"${part?.label ?? assignment.partId}" has no SoundFont preset – it will play on the default program`,
        )
      }
    }

    const midiPath = `${request.outputDirectory}/arrangement.mid`
    const outputPath = `${request.outputDirectory}/arrangement.wav`

    return [
      {
        id: "fluidsynth-mix",
        label: "full arrangement",
        inputs: [midiFile(midiPath, full)],
        outputPath,
        command: request.soundFontPath
          ? {
              program: "fluidsynth",
              args: [
                "-ni",
                "-F",
                outputPath,
                "-r",
                String(sampleRate),
                request.soundFontPath,
                midiPath,
              ],
              display: `fluidsynth -ni -F ${outputPath} -r ${sampleRate} ${request.soundFontPath} ${midiPath}`,
            }
          : undefined,
        issues: [...full.warnings, ...issues],
      },
    ]
  }
}

export const RENDER_ADAPTERS: Record<string, () => RenderAdapter> = {
  midi: () => new MidiRenderAdapter(),
  sfizz: () => new SfizzRenderAdapter(),
  fluidsynth: () => new FluidSynthRenderAdapter(),
}

export function createRenderAdapter(name: string): RenderAdapter {
  const factory = RENDER_ADAPTERS[name.toLowerCase()]
  if (!factory) {
    throw new Error(
      `unknown render adapter "${name}" (available: ${Object.keys(RENDER_ADAPTERS).join(", ")})`,
    )
  }
  return factory()
}

/** Human readable dry run: what would be written and executed. */
export function describeJobs(jobs: RenderJob[]): string {
  return jobs
    .map((job) => {
      const lines = [`${job.id}  ${job.label}`]
      for (const file of job.inputs) {
        lines.push(`  write ${file.path} (${file.bytes.length} bytes)`)
      }
      lines.push(`  run   ${job.command?.display ?? "– nothing to run"}`)
      lines.push(`  out   ${job.outputPath}`)
      for (const issue of job.issues) lines.push(`  issue ${issue}`)
      return lines.join("\n")
    })
    .join("\n\n")
}
