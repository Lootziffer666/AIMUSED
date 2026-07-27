import { describe, expect, it } from "vitest"
import { alignMidiToAudio, withManualAnchor } from "./alignment/alignment.ts"
import { DeterministicFeatureExtractor } from "./audio/features.ts"
import { createDefaultDecoderRegistry, encodeWav } from "./audio/pcm.ts"
import { syntheticMotifAudio } from "./audio/synthetic.ts"
import {
  createLibraryManifest,
  type InstrumentPatch,
} from "./libraries/manifest.ts"
import { graphToMidi, midiToGraph } from "./midi/eventGraph.ts"
import { syntheticMotifMidi, syntheticReferenceMidi } from "./midi/synthetic.ts"
import { buildMotifGraph } from "./motifs/motifGraph.ts"
import {
  createPlanFromGraph,
  doublePart,
  extractMotif,
  transposePart,
  undoLastOperation,
} from "./orchestration/plan.ts"
import {
  createPairedSourceManifest,
  parsePairedSourceManifest,
} from "./pairing/pairedSource.ts"
import {
  checkAssetLocation,
  isPrivateAssetPath,
} from "./pairing/privateAssets.ts"
import { encodeFeatures } from "./ranking/featureLayout.ts"
import { HeuristicPatchRanker } from "./ranking/ranker.ts"
import { createProvenance } from "./schema/tonemap.ts"
import {
  parseToneMapProject,
  serializeToneMapProject,
} from "./schema/validate.ts"
import { buildToneMapProject } from "./tonemap/observations.ts"
import {
  createTrainingRecord,
  exportTrainingRecordsAsJsonl,
  parseTrainingRecordsJsonl,
  summarizeTrainingSet,
} from "./training/records.ts"

/**
 * End-to-end walk through the acceptance criteria of the ToneMap brief.
 * Everything runs on synthetic fixtures – no private or licensed material.
 */

const patches: InstrumentPatch[] = [
  {
    id: "lib:violin",
    displayName: "Violin",
    family: "strings",
    instrument: "violin",
    range: {
      lowMidi: 55,
      highMidi: 103,
      preferredLowMidi: 60,
      preferredHighMidi: 93,
    },
    articulation: "sustain",
    timbre: { brightness: 0.6, warmth: 0.6, sustain: 0.85 },
    sfzPath: "Strings/violin.sfz",
  },
  {
    id: "lib:cello",
    displayName: "Cello",
    family: "strings",
    instrument: "cello",
    range: {
      lowMidi: 36,
      highMidi: 81,
      preferredLowMidi: 40,
      preferredHighMidi: 72,
    },
    articulation: "sustain",
    timbre: { brightness: 0.35, warmth: 0.85, sustain: 0.9, weight: 0.7 },
    sfzPath: "Strings/cello.sfz",
  },
]
const libraries = [
  createLibraryManifest({ id: "lib", name: "Test Library", patches }),
]

describe("ToneMap pipeline", () => {
  const midiBytes = syntheticMotifMidi()
  const graph = midiToGraph(midiBytes)
  const extractor = new DeterministicFeatureExtractor()

  it("1/2: imports and re-exports MIDI losslessly", () => {
    const written = graphToMidi(midiToGraph(syntheticReferenceMidi()))
    expect(Array.from(written)).toEqual(Array.from(syntheticReferenceMidi()))
  })

  it("3: creates a versioned ToneMap project that validates", () => {
    const { project } = buildToneMapProject(graph, {
      id: "acc",
      name: "Acceptance",
    })
    const parsed = parseToneMapProject(
      JSON.parse(serializeToneMapProject(project)),
    )
    expect(parsed.ok).toBe(true)
    expect(parsed.value?.schemaVersion).toBe("muse.tonemap.v1")
  })

  it("4: registers a MIDI/audio pair through a manifest", () => {
    const manifest = createPairedSourceManifest({
      id: "pair-1",
      midiPath: "private-assets/theme.mid",
      audioPath: "private-assets/theme.wav",
    })
    const parsed = parsePairedSourceManifest(
      JSON.parse(JSON.stringify(manifest)),
    )
    expect(parsed.ok).toBe(true)
    expect(parsed.value?.audio?.format).toBe("wav")
    expect(parsed.value?.rights.publiclyRedistributable).toBe(false)
  })

  it("5: runs audio analysis behind a replaceable interface", () => {
    const registry = createDefaultDecoderRegistry()
    const buffer = registry.decode(
      "wav",
      encodeWav(syntheticMotifAudio({ sampleRate: 11025 })),
    )
    const features = extractor.extract(buffer)
    expect(extractor.name).toBe("deterministic-dsp-v1")
    expect(features.frames.length).toBeGreaterThan(0)
  })

  it("6: stores an alignment map and accepts manual corrections", () => {
    const features = extractor.extract(
      syntheticMotifAudio({ sampleRate: 22050 }),
    )
    const map = alignMidiToAudio(graph, features, { sourcePairId: "pair-1" })
    expect(map.points.length).toBeGreaterThan(1)

    const corrected = withManualAnchor(map, {
      midiTick: 960,
      midiBeat: 2,
      audioTimeSeconds: 1.02,
      confidence: 1,
    })
    const restored = JSON.parse(JSON.stringify(corrected))
    expect(
      restored.points.find(
        (point: { midiTick: number }) => point.midiTick === 960,
      ).manual,
    ).toBe(true)
  })

  it("7: gives motifs and voices stable ids across runs", () => {
    const first = buildMotifGraph(graph)
    const second = buildMotifGraph(midiToGraph(syntheticMotifMidi()))
    expect(second.motifs.map((motif) => motif.id)).toEqual(
      first.motifs.map((motif) => motif.id),
    )
    expect(second.voices.map((voice) => voice.id)).toEqual(
      first.voices.map((voice) => voice.id),
    )
  })

  it("8: duplicates, transposes and reassigns a motif non-destructively", () => {
    const motifGraph = buildMotifGraph(graph)
    const before = JSON.stringify(graph.notes)
    let plan = createPlanFromGraph(graph, motifGraph, {
      toneMapProjectId: "acc",
    })
    plan = extractMotif(plan, motifGraph, motifGraph.motifs[0].id, {
      label: "Theme",
    })
    const motifPart = plan.parts[plan.parts.length - 1]
    plan = transposePart(plan, motifPart.id, -12, { reason: "an octave lower" })
    plan = doublePart(plan, motifPart.id, {
      semitones: 12,
      instrument: "violin",
    })

    expect(plan.operations.map((operation) => operation.kind)).toEqual([
      "extract-motif",
      "transpose-register",
      "octave-double",
    ])
    expect(JSON.stringify(graph.notes)).toBe(before)

    const undone = undoLastOperation(plan)
    expect(undone.parts.length).toBe(plan.parts.length - 1)
  })

  it("9: stores a dramaturgical prominence curve", () => {
    const motifGraph = buildMotifGraph(graph)
    const { project } = buildToneMapProject(graph, {
      id: "acc",
      name: "Acceptance",
    })
    const withCurve = {
      ...project,
      directions: [
        {
          id: "dir-1",
          motifId: motifGraph.motifs[0].id,
          trigger: { type: "tick" as const, startTick: 1920 },
          preserve: { identity: true, rhythm: true },
          prominence: {
            points: [
              { tick: 1920, value: 0.2 },
              { tick: 3840, value: 0.9 },
            ],
          },
          freeTextIntent: "warm, etwas zu groß und leicht peinlich",
          provenance: createProvenance({
            source: "user",
            status: "manually-confirmed" as const,
            confidence: 1,
            extractionMethod: "motif-direction",
          }),
        },
      ],
    }
    const parsed = parseToneMapProject(
      JSON.parse(serializeToneMapProject(withCurve)),
    )
    expect(parsed.ok).toBe(true)
    expect(parsed.value?.directions[0].freeTextIntent).toContain("peinlich")
    expect(
      (parsed.value?.directions[0].prominence as { points: unknown[] }).points,
    ).toHaveLength(2)
  })

  it("10/11: ranks library patches without any model", () => {
    const { project } = buildToneMapProject(graph, {
      id: "acc",
      name: "Acceptance",
    })
    const ranker = new HeuristicPatchRanker()
    const melody = project.observations.find(
      (observation) => observation.register.centroidMidi > 55,
    )!
    // a bright, sustained melody in this register: the violin is the fit
    const candidates = ranker.rank(
      {
        musicalFunction: melody.musicalFunction.value,
        register: melody.register,
        desiredTimbre: {
          ...melody.timbreIntent,
          brightness: 0.65,
          warmth: 0.55,
        },
        limit: 2,
      },
      libraries,
    )
    expect(candidates[0].patchId).toBe("lib:violin")
    expect(candidates[0].reasons.length).toBeGreaterThan(0)

    // the same request with a dark, heavy timbre picks the cello instead
    const dark = ranker.rank(
      {
        register: {
          lowestMidi: 40,
          highestMidi: 60,
          centroidMidi: 48,
          medianMidi: 48,
        },
        desiredTimbre: { brightness: 0.3, warmth: 0.9, weight: 0.7 },
        limit: 1,
      },
      libraries,
    )
    expect(dark[0].patchId).toBe("lib:cello")
  })

  it("12: exports training examples for the later model", () => {
    const { project } = buildToneMapProject(graph, {
      id: "acc",
      name: "Acceptance",
    })
    const ranker = new HeuristicPatchRanker()
    const records = project.observations.map((observation) =>
      createTrainingRecord({
        id: `train-${observation.id}`,
        sourcePairId: "pair-1",
        segmentRef: observation.sourceRef,
        features: encodeFeatures({
          musicalFunction: observation.musicalFunction.value,
          register: observation.register,
          symbolic: observation.symbolicFeatures,
          timbre: observation.timbreIntent,
        }),
        candidates: ranker.rank(
          { register: observation.register, limit: 2 },
          libraries,
        ),
        humanJudgement: { accepted: true, tags: ["good-fit"] },
        provenance: createProvenance({
          source: "test",
          extractionMethod: "pipeline-test",
        }),
      }),
    )
    const parsed = parseTrainingRecordsJsonl(
      exportTrainingRecordsAsJsonl(records),
    )
    const summary = summarizeTrainingSet(parsed)
    expect(summary.total).toBe(records.length)
    expect(summary.positive).toBe(records.length)
    expect(summary.byLayoutVersion["muse.feature-layout.v1"]).toBe(
      records.length,
    )
  })

  it("13: keeps private material out of the repository", () => {
    expect(isPrivateAssetPath("private-assets/coMI/theme.flac")).toBe(true)
    expect(isPrivateAssetPath("reference-audio/theme.wav")).toBe(true)
    expect(isPrivateAssetPath("app/src/assets/theme.wav")).toBe(false)
    const check = checkAssetLocation("app/public/theme.flac")
    expect(check.isPrivateLocation).toBe(false)
    expect(check.message).toContain("must not be committed")
  })

  it("runs the whole chain on one pair", () => {
    const features = extractor.extract(
      syntheticMotifAudio({ sampleRate: 22050 }),
    )
    const alignment = alignMidiToAudio(graph, features, {
      sourcePairId: "pair-1",
    })
    const { project } = buildToneMapProject(graph, {
      id: "full",
      name: "Full pass",
      features,
      alignment,
      sourcePairId: "pair-1",
    })

    expect(
      project.observations.every((observation) => observation.acousticFeatures),
    ).toBe(true)
    expect(project.nodes.some((node) => node.kind === "motif")).toBe(true)

    const reparsed = parseToneMapProject(
      JSON.parse(serializeToneMapProject(project)),
    )
    expect(reparsed.ok).toBe(true)
    expect(
      reparsed.warnings.filter((issue) => issue.message.includes("no node")),
    ).toHaveLength(0)
  })
})
