import { describe, expect, it } from "vitest"
import { InstrumentLibraryManifest } from "../libraries/manifest.ts"
import { LIBRARY_MANIFEST_SCHEMA_VERSION } from "../schema/version.ts"
import { encodeFeatures, FEATURE_FIELDS } from "./featureLayout.ts"
import {
  loadOnnxRuntime,
  loadOnnxSession,
  type OnnxInferenceSessionLike,
  type OnnxRuntimeLike,
  type OnnxTensorLike,
  OnnxUnavailableError,
} from "./onnxSession.ts"
import { OnnxPatchRanker } from "./ranker.ts"

/**
 * The session is tested against a fake runtime that behaves like ONNX
 * Runtime: it records the feeds it was given, so the tensor shapes, dtypes and
 * input names are checked for real without shipping a model.
 */

class FakeTensor implements OnnxTensorLike {
  readonly data: Float32Array
  readonly dims: number[]
  readonly type: string

  constructor(type: string, data: Float32Array, dims: number[]) {
    this.type = type
    this.data = data
    this.dims = dims
  }
}

function fakeRuntime(options: {
  inputNames?: string[]
  outputNames?: string[]
  scores?: number[]
  onRun?: (feeds: Record<string, FakeTensor>) => void
  failCreate?: boolean
}): OnnxRuntimeLike {
  return {
    Tensor: FakeTensor as unknown as OnnxRuntimeLike["Tensor"],
    InferenceSession: {
      async create(): Promise<OnnxInferenceSessionLike> {
        if (options.failCreate) throw new Error("model file is corrupt")
        return {
          inputNames: options.inputNames ?? ["features", "mask"],
          outputNames: options.outputNames ?? ["scores"],
          async run(feeds) {
            options.onRun?.(feeds as Record<string, FakeTensor>)
            const scores = options.scores ?? [0.2, 0.9, 0.5]
            return {
              scores: new FakeTensor("float32", Float32Array.from(scores), [
                1,
                scores.length,
              ]),
            }
          },
          async release() {},
        }
      },
    },
  }
}

const features = () =>
  encodeFeatures({
    musicalFunction: "primary-melody",
    register: {
      lowestMidi: 60,
      highestMidi: 72,
      centroidMidi: 66,
      medianMidi: 66,
    },
  })

describe("loadOnnxRuntime", () => {
  it("says what to install when no runtime is present", async () => {
    // onnxruntime is deliberately not a dependency of this package
    await expect(loadOnnxRuntime()).rejects.toThrow(OnnxUnavailableError)
    await expect(loadOnnxRuntime()).rejects.toThrow(/onnxruntime-node/)
    await expect(loadOnnxRuntime()).rejects.toThrow(/heuristic ranker/)
  })
})

describe("loadOnnxSession", () => {
  it("feeds features and mask with the documented shapes", async () => {
    let seen: Record<string, FakeTensor> = {}
    const session = await loadOnnxSession({
      modelPath: "model.onnx",
      runtime: fakeRuntime({ onRun: (feeds) => (seen = feeds) }),
    })

    const scores = await session.score(features(), 3)
    // float32 tensors, so the values come back with float32 precision
    expect(scores[0]).toBeCloseTo(0.2, 6)
    expect(scores[1]).toBeCloseTo(0.9, 6)
    expect(scores[2]).toBeCloseTo(0.5, 6)

    expect(Object.keys(seen).sort()).toEqual(["features", "mask"])
    expect(seen.features.dims).toEqual([1, FEATURE_FIELDS.length])
    expect(seen.mask.dims).toEqual([1, FEATURE_FIELDS.length])
    expect(seen.features.type).toBe("float32")
    // the mask is 1 exactly where a value was provided
    expect(
      seen.mask.data.filter((value) => value === 1).length,
    ).toBeGreaterThan(0)
    await session.dispose()
  })

  it("refuses a model whose inputs do not match the contract", async () => {
    await expect(
      loadOnnxSession({
        modelPath: "model.onnx",
        runtime: fakeRuntime({ inputNames: ["x"] }),
      }),
    ).rejects.toThrow(/no input "features"/)
  })

  it("refuses a model without the expected output", async () => {
    await expect(
      loadOnnxSession({
        modelPath: "model.onnx",
        runtime: fakeRuntime({ outputNames: ["logits"] }),
      }),
    ).rejects.toThrow(/no output "scores"/)
  })

  it("refuses a model trained on a different feature layout", async () => {
    await expect(
      loadOnnxSession({
        modelPath: "model.onnx",
        runtime: fakeRuntime({}),
        contract: { featureLayoutVersion: "muse.feature-layout.v0" },
      }),
    ).rejects.toThrow(/feature layout/)
  })

  it("needs a model to load", async () => {
    await expect(loadOnnxSession({ runtime: fakeRuntime({}) })).rejects.toThrow(
      /modelPath or modelBytes/,
    )
  })

  it("reports a model that returns too few scores", async () => {
    const session = await loadOnnxSession({
      modelPath: "model.onnx",
      runtime: fakeRuntime({ scores: [0.5] }),
    })
    await expect(session.score(features(), 3)).rejects.toThrow(
      /returned 1 scores for 3 candidates/,
    )
  })

  it("surfaces a broken model file", async () => {
    await expect(
      loadOnnxSession({
        modelPath: "model.onnx",
        runtime: fakeRuntime({ failCreate: true }),
      }),
    ).rejects.toThrow(/corrupt/)
  })
})

function library(): InstrumentLibraryManifest {
  return {
    schemaVersion: LIBRARY_MANIFEST_SCHEMA_VERSION,
    id: "lib",
    name: "test",
    patches: ["a", "b", "c"].map((id) => ({
      id,
      displayName: id,
      family: "strings" as const,
      instrument: id,
      articulation: "sustain",
      range: { lowMidi: 40, highMidi: 90 },
    })),
  }
}

describe("OnnxPatchRanker with a session", () => {
  it("reorders the heuristic shortlist", async () => {
    const session = await loadOnnxSession({
      modelPath: "model.onnx",
      runtime: fakeRuntime({ scores: [0.1, 0.95, 0.4] }),
    })
    const ranker = new OnnxPatchRanker({ session })
    expect(ranker.isAvailable()).toBe(true)

    const result = await ranker.rankAsync({ limit: 3 }, [library()])
    expect(result[0].score).toBeCloseTo(0.95, 6)
    expect(result[0].reasons.join(" ")).toContain("model score")
  })

  it("keeps the heuristic order when the model fails", async () => {
    const failing = {
      contract: new OnnxPatchRanker().contract,
      async score(): Promise<number[]> {
        throw new Error("session crashed")
      },
    }
    const ranker = new OnnxPatchRanker({ session: failing })
    const result = await ranker.rankAsync({ limit: 3 }, [library()])
    expect(result).toHaveLength(3)
    expect(result[0].reasons.join(" ")).toContain(
      "model unavailable: session crashed",
    )
  })

  it("without a model rankAsync equals rank", async () => {
    const ranker = new OnnxPatchRanker()
    const sync = ranker.rank({ limit: 3 }, [library()])
    const async = await ranker.rankAsync({ limit: 3 }, [library()])
    expect(async.map((c) => c.patchId)).toEqual(sync.map((c) => c.patchId))
  })

  it("takes its contract from the loaded session", async () => {
    const session = await loadOnnxSession({
      modelPath: "model.onnx",
      runtime: fakeRuntime({}),
    })
    const ranker = new OnnxPatchRanker({ session })
    expect(ranker.contract.featureLayoutVersion).toBe("muse.feature-layout.v1")
    expect(ranker.contract.outputName).toBe("scores")
  })
})
