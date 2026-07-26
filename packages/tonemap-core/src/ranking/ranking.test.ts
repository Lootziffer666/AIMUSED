import { describe, expect, it } from "vitest"
import {
  createLibraryManifest,
  type InstrumentLibraryManifest,
  type InstrumentPatch,
  LibraryPathError,
  mergePatchMetadata,
  resolvePatchPath,
  validateLibraryManifest,
} from "../libraries/manifest.ts"
import { parseNoteValue, scanSfzLibrary } from "../libraries/sfzScanner.ts"
import { createProvenance } from "../schema/tonemap.ts"
import {
  createTrainingRecord,
  exportTrainingRecordsAsJsonl,
  isPositiveExample,
  isSerendipitous,
  parseTrainingRecordsJsonl,
  summarizeTrainingSet,
} from "../training/records.ts"
import {
  assertLayoutVersion,
  decodeFeatures,
  encodeFeatures,
  FEATURE_FIELDS,
  FEATURE_LAYOUT,
  FeatureLayoutError,
} from "./featureLayout.ts"
import {
  HeuristicPatchRanker,
  OnnxPatchRanker,
  timbreSimilarity,
} from "./ranker.ts"

function patch(
  overrides: Partial<InstrumentPatch> & { id: string },
): InstrumentPatch {
  return {
    displayName: overrides.id,
    family: "strings",
    instrument: "violin",
    range: { lowMidi: 55, highMidi: 100 },
    articulation: "sustain",
    ...overrides,
  }
}

function library(patches: InstrumentPatch[]): InstrumentLibraryManifest {
  return createLibraryManifest({ id: "test-lib", name: "Test", patches })
}

describe("Feature layout", () => {
  it("has a stable field order and length", () => {
    expect(FEATURE_LAYOUT.version).toBe("muse.feature-layout.v1")
    expect(FEATURE_LAYOUT.length).toBe(FEATURE_FIELDS.length)
    expect(FEATURE_FIELDS[0].name).toBe("function.primary-melody")
    const names = FEATURE_FIELDS.map((field) => field.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it("produces an identical vector for identical input", () => {
    const input = {
      musicalFunction: "bass" as const,
      register: {
        lowestMidi: 36,
        highestMidi: 55,
        centroidMidi: 44,
        medianMidi: 43,
      },
    }
    expect(encodeFeatures(input)).toEqual(encodeFeatures(input))
  })

  it("normalizes into 0..1 and marks known values", () => {
    const vector = encodeFeatures({
      register: {
        lowestMidi: 0,
        highestMidi: 127,
        centroidMidi: 63.5,
        medianMidi: 60,
      },
    })
    const decoded = decodeFeatures(vector)
    expect(decoded["register.centroid"]).toBeCloseTo(63.5, 3)
    expect(vector.values.every((value) => value >= 0 && value <= 1)).toBe(true)
  })

  it("distinguishes missing from zero", () => {
    const vector = encodeFeatures({ musicalFunction: "bass" })
    const index = FEATURE_FIELDS.findIndex(
      (field) => field.name === "acoustic.rms",
    )
    expect(vector.mask[index]).toBe(0)
    expect(decodeFeatures(vector)["acoustic.rms"]).toBeNull()

    const withZero = encodeFeatures({
      acoustic: {
        rms: 0,
        peak: 0,
        loudnessDb: -80,
        spectralCentroidHz: 0,
        spectralBandwidthHz: 0,
        spectralRolloffHz: 0,
        spectralFlatness: 0,
        zeroCrossingRate: 0,
        onsetStrength: 0,
        transientStrength: 0,
        sustainEstimate: 0,
        lowEnergy: 0,
        midEnergy: 0,
        highEnergy: 0,
        stereoWidth: 0,
        balance: 0,
        chroma: new Array(12).fill(0),
        silenceRatio: 0,
      },
    })
    expect(withZero.mask[index]).toBe(1)
    expect(decodeFeatures(withZero)["acoustic.rms"]).toBe(0)
  })

  it("rejects a vector from a different layout version", () => {
    const vector = encodeFeatures({ musicalFunction: "bass" })
    expect(() => assertLayoutVersion(vector)).not.toThrow()
    expect(() =>
      assertLayoutVersion({
        ...vector,
        layoutVersion: "muse.feature-layout.v0",
      }),
    ).toThrow(FeatureLayoutError)
    expect(() => assertLayoutVersion({ ...vector, values: [1, 2] })).toThrow(
      FeatureLayoutError,
    )
  })
})

describe("Heuristic patch ranker", () => {
  const ranker = new HeuristicPatchRanker()

  it("prefers a patch that covers the register", () => {
    const manifest = library([
      patch({ id: "violin", range: { lowMidi: 55, highMidi: 103 } }),
      patch({
        id: "double-bass",
        range: { lowMidi: 28, highMidi: 60 },
        instrument: "bass",
      }),
    ])
    const result = ranker.rank(
      {
        register: {
          lowestMidi: 72,
          highestMidi: 84,
          centroidMidi: 78,
          medianMidi: 78,
        },
      },
      [manifest],
    )
    expect(result[0].patchId).toBe("violin")
    expect(result[0].reasons.join(" ")).toContain("register")
  })

  it("prefers the family that fits the musical function", () => {
    const manifest = library([
      patch({
        id: "timpani",
        family: "percussion",
        instrument: "timpani",
        range: { lowMidi: 36, highMidi: 60 },
      }),
      patch({
        id: "cello",
        family: "strings",
        instrument: "cello",
        range: { lowMidi: 36, highMidi: 76 },
      }),
    ])
    const result = ranker.rank(
      {
        musicalFunction: "bass",
        register: {
          lowestMidi: 40,
          highestMidi: 55,
          centroidMidi: 46,
          medianMidi: 45,
        },
      },
      [manifest],
    )
    expect(result[0].patchId).toBe("cello")
  })

  it("prefers the closest timbre", () => {
    const manifest = library([
      patch({ id: "bright", timbre: { brightness: 0.9, warmth: 0.2 } }),
      patch({ id: "warm", timbre: { brightness: 0.2, warmth: 0.9 } }),
    ])
    const result = ranker.rank(
      { desiredTimbre: { brightness: 0.15, warmth: 0.95 } },
      [manifest],
    )
    expect(result[0].patchId).toBe("warm")
    expect(result[0].reasons.join(" ")).toContain("timbre similarity")
  })

  it("uses keyswitches when the articulation is not the patch itself", () => {
    const manifest = library([
      patch({
        id: "strings-ks",
        articulation: "sustain",
        keyswitches: [{ articulation: "pizzicato", noteNumber: 24 }],
      }),
      patch({ id: "plain", articulation: "sustain" }),
    ])
    const result = ranker.rank({ articulation: "pizzicato" }, [manifest])
    expect(result[0].patchId).toBe("strings-ks")
    expect(result[0].keyswitch).toBe(24)
  })

  it("explains every score and offers fallbacks", () => {
    const manifest = library([
      patch({ id: "a" }),
      patch({ id: "b" }),
      patch({ id: "c" }),
    ])
    const result = ranker.rank(
      {
        musicalFunction: "primary-melody",
        register: {
          lowestMidi: 60,
          highestMidi: 80,
          centroidMidi: 70,
          medianMidi: 70,
        },
        limit: 2,
      },
      [manifest],
    )
    expect(result).toHaveLength(2)
    expect(result[0].reasons.length).toBeGreaterThan(0)
    expect(result[0].fallbackPatchIds?.length).toBeGreaterThan(0)
  })

  it("works without any model", () => {
    expect(new HeuristicPatchRanker().name).toBe("heuristic-baseline-v1")
    expect(timbreSimilarity({ brightness: 0.5 }, { brightness: 0.5 })).toBe(1)
    expect(timbreSimilarity({}, {})).toBe(0.5)
  })
})

describe("ONNX adapter", () => {
  it("falls back to the heuristic ranker when no session is present", () => {
    const ranker = new OnnxPatchRanker()
    expect(ranker.isAvailable()).toBe(false)
    const result = ranker.rank({ articulation: "sustain" }, [
      library([patch({ id: "x" })]),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].patchId).toBe("x")
  })

  it("uses the session scores when one is injected", () => {
    const ranker = new OnnxPatchRanker({ session: () => [0.1, 0.99] })
    const result = ranker.rank({}, [
      library([patch({ id: "a" }), patch({ id: "b" })]),
    ])
    expect(result[0].score).toBe(0.99)
    expect(result[0].reasons.join(" ")).toContain("model score")
  })

  it("publishes an inference contract", () => {
    const contract = new OnnxPatchRanker().contract
    expect(contract.featureLayoutVersion).toBe("muse.feature-layout.v1")
    expect(contract.inputName).toBe("features")
    expect(contract.maskName).toBe("mask")
  })
})

describe("Library manifests", () => {
  it("reports missing metadata without failing", () => {
    const manifest = library([
      patch({
        id: "complete",
        timbre: { brightness: 0.5 },
        sfzPath: "a.sfz",
        range: {
          lowMidi: 40,
          highMidi: 80,
          preferredLowMidi: 45,
          preferredHighMidi: 75,
        },
      }),
      patch({ id: "sparse" }),
    ])
    const result = validateLibraryManifest(manifest)
    expect(result.ok).toBe(true)
    expect(result.gaps.some((gap) => gap.patchId === "sparse")).toBe(true)
    expect(result.gaps.some((gap) => gap.field === "locator")).toBe(true)
  })

  it("fails on duplicate ids and broken ranges", () => {
    const manifest = library([
      patch({ id: "dup" }),
      patch({ id: "dup" }),
      patch({ id: "broken", range: { lowMidi: 80, highMidi: 40 } }),
    ])
    const result = validateLibraryManifest(manifest)
    expect(result.ok).toBe(false)
    expect(result.errors.join(" ")).toContain("duplicate")
    expect(result.errors.join(" ")).toContain("range")
  })

  it("explains a missing library path instead of failing silently", () => {
    const manifest = library([patch({ id: "p", sfzPath: "Violin/sus.sfz" })])
    expect(() => resolvePatchPath(manifest, "p")).toThrow(LibraryPathError)
    try {
      resolvePatchPath(manifest, "p")
    } catch (error) {
      expect((error as Error).message).toContain("rootPath")
    }
    const configured = { ...manifest, rootPath: "/opt/VCSL/" }
    expect(resolvePatchPath(configured, "p")).toBe("/opt/VCSL/Violin/sus.sfz")
  })

  it("merges hand maintained metadata into scanned patches", () => {
    const scanned = [patch({ id: "vcsl:violin", timbre: {} })]
    const merged = mergePatchMetadata(scanned, [
      {
        id: "vcsl:violin",
        timbre: { warmth: 0.8 },
        range: {
          lowMidi: 55,
          highMidi: 100,
          preferredLowMidi: 60,
          preferredHighMidi: 90,
        },
      },
    ])
    expect(merged[0].timbre?.warmth).toBe(0.8)
    expect(merged[0].range.preferredLowMidi).toBe(60)
  })
})

describe("SFZ scanner", () => {
  it("reads key ranges, velocity layers and round robins", () => {
    const patches = scanSfzLibrary(
      [
        {
          path: "Strings/Violin/violin_sustain.sfz",
          content: `
            <group> lokey=55 hikey=100
            <region> sample=a.wav lovel=1 hivel=63 seq_length=2
            <region> sample=b.wav lovel=64 hivel=127 seq_length=2
          `,
        },
      ],
      "vcsl",
    )
    expect(patches).toHaveLength(1)
    expect(patches[0].range).toMatchObject({ lowMidi: 55, highMidi: 100 })
    expect(patches[0].velocityLayers).toBe(2)
    expect(patches[0].roundRobins).toBe(2)
    expect(patches[0].family).toBe("strings")
    expect(patches[0].articulation).toBe("sustain")
    expect(patches[0].sfzPath).toBe("Strings/Violin/violin_sustain.sfz")
  })

  it("derives articulation and family from the path", () => {
    const patches = scanSfzLibrary(
      [
        {
          path: "Strings/Cello/cello_pizzicato.sfz",
          content: "<region> lokey=36 hikey=76",
        },
        {
          path: "Brass/Horn/horn_stacc.sfz",
          content: "<region> lokey=41 hikey=77",
        },
      ],
      "vsco2",
    )
    // the scanner returns patches sorted by id, so look them up by name
    const cello = patches.find((entry) => entry.id.includes("cello"))!
    const horn = patches.find((entry) => entry.id.includes("horn"))!
    expect(cello.articulation).toBe("pizzicato")
    expect(cello.family).toBe("strings")
    expect(horn.family).toBe("brass")
    expect(horn.articulation).toBe("staccato")
  })

  it("understands note names and flags files without a range", () => {
    expect(parseNoteValue("c4")).toBe(60)
    expect(parseNoteValue("f#3")).toBe(54)
    expect(parseNoteValue("60")).toBe(60)
    const patches = scanSfzLibrary(
      [{ path: "Misc/thing.sfz", content: "<region> sample=x.wav" }],
      "lib",
    )
    expect(patches[0].knownLimitations?.[0]).toContain("no key range")
  })

  it("ignores files that are not SFZ", () => {
    expect(
      scanSfzLibrary([{ path: "readme.txt", content: "" }], "lib"),
    ).toHaveLength(0)
  })
})

describe("Training records", () => {
  const provenance = createProvenance({
    source: "user",
    extractionMethod: "manual-review",
    status: "manually-confirmed",
    confidence: 1,
  })

  function record(
    judgement?: Parameters<typeof createTrainingRecord>[0]["humanJudgement"],
  ) {
    return createTrainingRecord({
      id: `rec-${Math.random().toString(36).slice(2)}`,
      sourcePairId: "pair-1",
      segmentRef: "v-0-0-0",
      features: encodeFeatures({ musicalFunction: "primary-melody" }),
      candidates: [
        {
          patchId: "cello",
          libraryId: "vcsl",
          score: 0.8,
          reasons: ["register"],
        },
      ],
      selectedCandidate: "cello",
      humanJudgement: judgement,
      provenance,
    })
  }

  it("stores the feature vector together with its layout version", () => {
    const entry = record({ accepted: true, tags: ["good-fit"] })
    expect(entry.featureLayoutVersion).toBe("muse.feature-layout.v1")
    expect(entry.inputFeatures).toHaveLength(FEATURE_FIELDS.length)
    expect(entry.featureMask).toHaveLength(FEATURE_FIELDS.length)
  })

  it("keeps positive and negative examples apart", () => {
    expect(isPositiveExample(record({ accepted: true }))).toBe(true)
    expect(
      isPositiveExample(
        record({ accepted: false, tags: ["wrong-instrument"] }),
      ),
    ).toBe(false)
  })

  it("treats a happy accident as its own class", () => {
    const entry = record({
      accepted: false,
      tags: ["serendipitous-alternative"],
      notes: "wrong instrument, but dramatically better",
    })
    expect(isSerendipitous(entry)).toBe(true)
    expect(isPositiveExample(entry)).toBe(true)
  })

  it("round trips through JSONL", () => {
    const records = [record({ accepted: true }), record({ accepted: false })]
    const parsed = parseTrainingRecordsJsonl(
      exportTrainingRecordsAsJsonl(records),
    )
    expect(parsed).toHaveLength(2)
    expect(parsed[0].selectedCandidate).toBe("cello")
  })

  it("summarizes a training set", () => {
    const summary = summarizeTrainingSet([
      record({ accepted: true }),
      record({ accepted: false, tags: ["wrong-instrument"] }),
      record({ accepted: false, tags: ["serendipitous-alternative"] }),
      record(),
    ])
    expect(summary.total).toBe(4)
    expect(summary.positive).toBe(2)
    expect(summary.negative).toBe(1)
    expect(summary.serendipitous).toBe(1)
    expect(summary.unlabelled).toBe(1)
    expect(summary.byLayoutVersion["muse.feature-layout.v1"]).toBe(4)
  })
})
