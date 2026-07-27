#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, extname, resolve } from "node:path"
import { alignMidiToAudio } from "../alignment/alignment.ts"
import { registerLossyDecoders } from "../audio/codecs.ts"
import { DeterministicFeatureExtractor } from "../audio/features.ts"
import { createDefaultDecoderRegistry } from "../audio/pcm.ts"
import { graphToJsonl, notesToTsv } from "../midi/debugFormat.ts"
import { graphToMidi, midiToGraph } from "../midi/eventGraph.ts"
import { buildMotifGraph } from "../motifs/motifGraph.ts"
import {
  createPlanFromGraph,
  doublePart,
  duplicatePart,
  transposePart,
} from "../orchestration/plan.ts"
import {
  createPairedSourceManifest,
  guessAudioFormat,
  parsePairedSourceManifest,
} from "../pairing/pairedSource.ts"
import { checkManifestAssets } from "../pairing/privateAssets.ts"
import { encodeFeatures } from "../ranking/featureLayout.ts"
import { loadOnnxSession } from "../ranking/onnxSession.ts"
import { HeuristicPatchRanker, OnnxPatchRanker } from "../ranking/ranker.ts"
import { createProvenance } from "../schema/tonemap.ts"
import {
  parseToneMapProject,
  serializeToneMapProject,
} from "../schema/validate.ts"
import { buildToneMapProject } from "../tonemap/observations.ts"
import {
  createTrainingRecord,
  exportTrainingRecordsAsJsonl,
} from "../training/records.ts"

/**
 * `muse-tonemap` – the developer entry point for the ToneMap pipeline.
 *
 * Runs on plain Node (no build step, no extra runtime): every artefact it
 * writes is a versioned file, so the steps can be inspected, diffed and
 * re-run individually.
 *
 *   npm run tonemap -w @signal-app/tonemap-core -- <command> [options]
 */

interface Args {
  command: string
  positional: string[]
  flags: Record<string, string | boolean>
}

function parseArgs(argv: string[]): Args {
  const [command = "help", ...rest] = argv
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (token.startsWith("--")) {
      const key = token.slice(2)
      const next = rest[i + 1]
      if (next && !next.startsWith("--")) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(token)
    }
  }
  return { command, positional, flags }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), "utf8"))
}

function writeOut(path: string | undefined, content: string): void {
  if (!path) {
    process.stdout.write(content)
    return
  }
  const target = resolve(path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
  console.log(`written: ${path}`)
}

function requireFlag(args: Args, name: string): string {
  const value = args.flags[name]
  if (typeof value !== "string") {
    throw new Error(`missing --${name}`)
  }
  return value
}

function loadMidi(path: string) {
  return midiToGraph(new Uint8Array(readFileSync(resolve(path))))
}

async function loadAudio(path: string, format?: string) {
  const registry = createDefaultDecoderRegistry()
  // headless runs have no platform decoders, so the lossy ones come along
  registerLossyDecoders(registry)
  const detected = format ?? guessAudioFormat(path) ?? extname(path).slice(1)
  return await registry.decodeAsync(
    detected,
    new Uint8Array(readFileSync(resolve(path))),
  )
}

const HELP = `muse-tonemap – MUSE ToneMap pipeline

  import-midi <file.mid> [--out project.json] [--name NAME] [--debug jsonl|tsv]
      Lossless import into the event graph and a ToneMap project.

  export-midi <project-source.mid> --out <file.mid>
      Round trip check: import and write the file back out.

  pair --id ID --midi PATH [--audio PATH] [--out manifest.json]
      Creates a paired-source manifest.

  validate <manifest.json|project.json>
      Validates a manifest or ToneMap project and checks asset locations.

  analyze <manifest.json> [--out analysis.json]
      Audio feature extraction for the audio side of a pair.

  align <manifest.json> [--out alignment.json]
      Aligns MIDI and audio and writes the alignment map.

  motifs <file.mid> [--out motifs.json]
      Voice, phrase and motif graph.

  tonemap <manifest.json> [--out project.json]
      Full pass: MIDI + audio -> ToneMap project with observations.

  orchestrate <file.mid> [--out plan.json] [--octave-double] [--transpose N]
      Creates a non-destructive orchestration plan.

  rank <project.json> --library <library.json> [--limit N] [--model model.onnx]
      Ranks library patches for every observation.

  export-training <project.json> --library <library.json> [--out records.jsonl]
      Writes training records for the later ONNX model.
`

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  const out = typeof args.flags.out === "string" ? args.flags.out : undefined

  switch (args.command) {
    case "import-midi": {
      const path = args.positional[0]
      if (!path) throw new Error("usage: import-midi <file.mid>")
      const graph = loadMidi(path)
      if (args.flags.debug === "jsonl") {
        writeOut(out, graphToJsonl(graph, { withSeconds: true }))
        return 0
      }
      if (args.flags.debug === "tsv") {
        writeOut(out, notesToTsv(graph))
        return 0
      }
      const { project } = buildToneMapProject(graph, {
        id: String(args.flags.id ?? `tonemap-${Date.now()}`),
        name: String(args.flags.name ?? path.split("/").pop()),
      })
      console.error(
        `tracks: ${graph.tracks.length}, notes: ${graph.notes.length}, warnings: ${graph.warnings.length}`,
      )
      writeOut(out, serializeToneMapProject(project))
      return 0
    }

    case "export-midi": {
      const path = args.positional[0]
      if (!path || !out)
        throw new Error("usage: export-midi <file.mid> --out <file.mid>")
      const graph = loadMidi(path)
      const bytes = graphToMidi(graph)
      const original = new Uint8Array(readFileSync(resolve(path)))
      const identical =
        bytes.length === original.length &&
        bytes.every((b, i) => b === original[i])
      mkdirSync(dirname(resolve(out)), { recursive: true })
      writeFileSync(resolve(out), bytes)
      console.log(
        identical
          ? `written: ${out} (byte identical round trip)`
          : `written: ${out} (WARNING: not byte identical – ${graph.warnings.join("; ")})`,
      )
      return identical ? 0 : 1
    }

    case "pair": {
      const manifest = createPairedSourceManifest({
        id: requireFlag(args, "id"),
        midiPath: requireFlag(args, "midi"),
        audioPath:
          typeof args.flags.audio === "string" ? args.flags.audio : undefined,
        title:
          typeof args.flags.title === "string" ? args.flags.title : undefined,
      })
      for (const check of checkManifestAssets(manifest)) {
        if (!check.isPrivateLocation) console.warn(`warning: ${check.message}`)
      }
      writeOut(out, `${JSON.stringify(manifest, null, 2)}\n`)
      return 0
    }

    case "validate": {
      const path = args.positional[0]
      if (!path) throw new Error("usage: validate <file.json>")
      const raw = readJson(path) as Record<string, unknown>
      const isPair = typeof raw.midi === "object"
      const result = isPair
        ? parsePairedSourceManifest(raw)
        : parseToneMapProject(raw)
      for (const issue of result.errors)
        console.error(`error ${issue.path}: ${issue.message}`)
      for (const issue of result.warnings)
        console.warn(`warn  ${issue.path}: ${issue.message}`)
      if (isPair && result.ok) {
        for (const check of checkManifestAssets(result.value as never)) {
          if (!check.isPrivateLocation)
            console.warn(`warn  assets: ${check.message}`)
        }
      }
      console.log(result.ok ? "valid" : "invalid")
      return result.ok ? 0 : 1
    }

    case "analyze": {
      const manifest = parsePairedSourceManifest(readJson(args.positional[0]))
      if (!manifest.ok || !manifest.value?.audio) {
        throw new Error("manifest is invalid or has no audio reference")
      }
      const buffer = await loadAudio(
        manifest.value.audio.path,
        manifest.value.audio.format,
      )
      const features = new DeterministicFeatureExtractor().extract(buffer)
      console.error(
        `frames: ${features.frames.length}, duration: ${features.durationSeconds.toFixed(2)} s`,
      )
      writeOut(
        out,
        `${JSON.stringify(
          {
            sampleRate: features.sampleRate,
            frameSize: features.frameSize,
            hopSize: features.hopSize,
            durationSeconds: features.durationSeconds,
            silenceRegions: features.silenceRegions,
            frames: features.frames,
          },
          null,
          2,
        )}\n`,
      )
      return 0
    }

    case "align": {
      const manifest = parsePairedSourceManifest(readJson(args.positional[0]))
      if (!manifest.ok || !manifest.value?.audio) {
        throw new Error("manifest is invalid or has no audio reference")
      }
      const graph = loadMidi(manifest.value.midi.path)
      const buffer = await loadAudio(
        manifest.value.audio.path,
        manifest.value.audio.format,
      )
      const features = new DeterministicFeatureExtractor().extract(buffer)
      const alignment = alignMidiToAudio(graph, features, {
        knownOffsetMs: manifest.value.relationship.knownOffsetMs,
        sourcePairId: manifest.value.id,
      })
      console.error(
        `method: ${alignment.method}, confidence: ${alignment.globalConfidence}, problematic regions: ${alignment.problematicRegions.length}`,
      )
      writeOut(out, `${JSON.stringify(alignment, null, 2)}\n`)
      return 0
    }

    case "motifs": {
      const graph = loadMidi(args.positional[0])
      const motifGraph = buildMotifGraph(graph)
      console.error(
        `voices: ${motifGraph.voices.length}, phrases: ${motifGraph.phrases.length}, motifs: ${motifGraph.motifs.length}`,
      )
      writeOut(out, `${JSON.stringify(motifGraph, null, 2)}\n`)
      return 0
    }

    case "tonemap": {
      const manifest = parsePairedSourceManifest(readJson(args.positional[0]))
      if (!manifest.ok || !manifest.value)
        throw new Error("manifest is invalid")
      const graph = loadMidi(manifest.value.midi.path)
      let features
      let alignment
      if (manifest.value.audio) {
        const buffer = await loadAudio(
          manifest.value.audio.path,
          manifest.value.audio.format,
        )
        features = new DeterministicFeatureExtractor().extract(buffer)
        alignment = alignMidiToAudio(graph, features, {
          knownOffsetMs: manifest.value.relationship.knownOffsetMs,
          sourcePairId: manifest.value.id,
        })
      }
      const { project } = buildToneMapProject(graph, {
        id: manifest.value.id,
        name: manifest.value.title ?? manifest.value.id,
        features,
        alignment,
        sourcePairId: manifest.value.id,
      })
      console.error(
        `nodes: ${project.nodes.length}, observations: ${project.observations.length}`,
      )
      writeOut(out, serializeToneMapProject(project))
      return 0
    }

    case "orchestrate": {
      const graph = loadMidi(args.positional[0])
      const motifGraph = buildMotifGraph(graph)
      let plan = createPlanFromGraph(graph, motifGraph, {
        toneMapProjectId: String(args.flags.project ?? "cli"),
      })
      if (args.flags["octave-double"] && plan.parts[0]) {
        plan = doublePart(plan, plan.parts[0].id, { semitones: -12 })
      }
      if (typeof args.flags.transpose === "string" && plan.parts[0]) {
        plan = transposePart(
          plan,
          plan.parts[0].id,
          Number(args.flags.transpose),
        )
      }
      if (args.flags.duplicate && plan.parts[0]) {
        plan = duplicatePart(plan, plan.parts[0].id)
      }
      console.error(
        `parts: ${plan.parts.length}, operations: ${plan.operations.length}, warnings: ${plan.warnings.length}`,
      )
      writeOut(out, `${JSON.stringify(plan, null, 2)}\n`)
      return 0
    }

    case "rank": {
      const parsed = parseToneMapProject(readJson(args.positional[0]))
      if (!parsed.ok || !parsed.value)
        throw new Error("ToneMap project is invalid")
      const libraries = [readJson(requireFlag(args, "library"))] as never[]
      const limit = Number(args.flags.limit ?? 3)

      // A model is optional. Without --model the heuristic ranker answers,
      // and it explains every score in words either way.
      const modelPath =
        typeof args.flags.model === "string" ? args.flags.model : undefined
      const session = modelPath
        ? await loadOnnxSession({ modelPath })
        : undefined
      const ranker = new OnnxPatchRanker({ session })
      console.error(
        session
          ? `ranker: ${ranker.name} (${modelPath})`
          : "ranker: heuristic-baseline-v1 (no model)",
      )

      const ranked = []
      for (const observation of parsed.value.observations) {
        const request = {
          musicalFunction: observation.musicalFunction.value,
          register: observation.register,
          desiredTimbre: observation.timbreIntent,
          articulation: observation.articulation?.value,
          limit,
        }
        ranked.push({
          observationId: observation.id,
          musicalFunction: observation.musicalFunction.value,
          candidates: await ranker.rankAsync(request, libraries),
        })
      }
      await session?.dispose()
      writeOut(out, `${JSON.stringify(ranked, null, 2)}\n`)
      return 0
    }

    case "export-training": {
      const parsed = parseToneMapProject(readJson(args.positional[0]))
      if (!parsed.ok || !parsed.value)
        throw new Error("ToneMap project is invalid")
      const libraries = [readJson(requireFlag(args, "library"))] as never[]
      const ranker = new HeuristicPatchRanker()
      const records = parsed.value.observations.map((observation) => {
        const candidates = ranker.rank(
          {
            musicalFunction: observation.musicalFunction.value,
            register: observation.register,
            desiredTimbre: observation.timbreIntent,
            limit: 5,
          },
          libraries,
        )
        return createTrainingRecord({
          id: `train-${observation.id}`,
          sourcePairId: parsed.value!.sourcePairId ?? parsed.value!.id,
          segmentRef: observation.sourceRef,
          features: encodeFeatures({
            musicalFunction: observation.musicalFunction.value,
            register: observation.register,
            symbolic: observation.symbolicFeatures,
            acoustic: observation.acousticFeatures,
            timbre: observation.timbreIntent,
            context: { prominence: observation.prominence.value.level },
          }),
          candidates,
          provenance: createProvenance({
            source: "cli",
            status: "derived",
            confidence: observation.confidence,
            extractionMethod: "export-training",
          }),
        })
      })
      console.error(
        `records: ${records.length} (unlabelled – add human judgement)`,
      )
      writeOut(out, exportTrainingRecordsAsJsonl(records))
      return 0
    }

    default:
      process.stdout.write(HELP)
      return args.command === "help" ? 0 : 1
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(
      `error: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
  })
