import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import type { InstrumentLibraryManifest } from "../libraries/manifest.ts"
import { LIBRARY_MANIFEST_SCHEMA_VERSION } from "../schema/version.ts"
import { encodeFeatures } from "./featureLayout.ts"
import {
  loadOnnxRuntime,
  loadOnnxSession,
  type OnnxRuntimeLike,
} from "./onnxSession.ts"
import { HeuristicPatchRanker, OnnxPatchRanker } from "./ranker.ts"

/**
 * The one test that uses a real ONNX Runtime and a real .onnx file.
 *
 * The runtime is 130 MB, so it is not a dependency of this package – nobody
 * should have to download that to run the suite. When it is absent these tests
 * skip with a note instead of pretending to pass:
 *
 *     npm i -D onnxruntime-web -w @signal-app/tonemap-core
 *     npm test -w @signal-app/tonemap-core
 *
 * `onnxSession.test.ts` covers the same code paths against an injected fake
 * runtime and always runs.
 */

const MODEL = resolve(
  import.meta.dirname,
  "../../../../fixtures/tonemap/synthetic/reranker-v1.onnx",
)

async function tryLoadRuntime(): Promise<OnnxRuntimeLike | null> {
  try {
    // the same resolution path production uses, so this covers it too
    const runtime = await loadOnnxRuntime()
    // single threaded: the suite runs in a worker without SharedArrayBuffer
    const env = (
      runtime as unknown as { env?: { wasm?: { numThreads: number } } }
    ).env
    if (env?.wasm) env.wasm.numThreads = 1
    return runtime
  } catch {
    return null
  }
}

const runtime = await tryLoadRuntime()
const withRuntime = runtime ? describe : describe.skip

if (!runtime) {
  console.warn(
    "onnxruntime-web is not installed – skipping the real-model tests (see onnxRuntime.test.ts)",
  )
}

function library(): InstrumentLibraryManifest {
  return {
    schemaVersion: LIBRARY_MANIFEST_SCHEMA_VERSION,
    id: "lib",
    name: "test",
    patches: ["violin", "cello", "flute", "horn"].map((id) => ({
      id,
      displayName: id,
      family: "strings" as const,
      instrument: id,
      articulation: "sustain",
      range: { lowMidi: 40, highMidi: 96 },
    })),
  }
}

const request = {
  musicalFunction: "primary-melody" as const,
  register: {
    lowestMidi: 60,
    highestMidi: 79,
    centroidMidi: 68,
    medianMidi: 68,
  },
  limit: 4,
}

withRuntime("ONNX Runtime with the reference model", () => {
  it("loads the committed model and satisfies the contract", async () => {
    const session = await loadOnnxSession({
      modelBytes: new Uint8Array(readFileSync(MODEL)),
      // biome-ignore lint/style/noNonNullAssertion: guarded by describe.skip
      runtime: runtime!,
    })
    expect(session.contract.featureLayoutVersion).toBe("muse.feature-layout.v1")

    const scores = await session.score(encodeFeatures(request), 4)
    expect(scores).toHaveLength(4)
    for (const score of scores) {
      expect(Number.isFinite(score)).toBe(true)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }
    await session.dispose()
  })

  it("is deterministic for identical input", async () => {
    const session = await loadOnnxSession({
      modelBytes: new Uint8Array(readFileSync(MODEL)),
      // biome-ignore lint/style/noNonNullAssertion: guarded by describe.skip
      runtime: runtime!,
    })
    const a = await session.score(encodeFeatures(request), 4)
    const b = await session.score(encodeFeatures(request), 4)
    expect(a).toEqual(b)
    await session.dispose()
  })

  it("respects the mask: a masked feature must not act like a zero", async () => {
    const session = await loadOnnxSession({
      modelBytes: new Uint8Array(readFileSync(MODEL)),
      // biome-ignore lint/style/noNonNullAssertion: guarded by describe.skip
      runtime: runtime!,
    })
    const sparse = encodeFeatures({ musicalFunction: "bass" })
    const rich = encodeFeatures({
      musicalFunction: "bass",
      register: {
        lowestMidi: 28,
        highestMidi: 52,
        centroidMidi: 40,
        medianMidi: 40,
      },
    })
    const a = await session.score(sparse, 4)
    const b = await session.score(rich, 4)
    expect(a).not.toEqual(b)
    await session.dispose()
  })

  it("reorders the heuristic shortlist through rankAsync", async () => {
    const session = await loadOnnxSession({
      modelBytes: new Uint8Array(readFileSync(MODEL)),
      // biome-ignore lint/style/noNonNullAssertion: guarded by describe.skip
      runtime: runtime!,
    })
    const ranker = new OnnxPatchRanker({ session })
    expect(ranker.isAvailable()).toBe(true)

    const heuristic = new HeuristicPatchRanker().rank(request, [library()])
    const ranked = await ranker.rankAsync(request, [library()])

    expect(ranked).toHaveLength(heuristic.length)
    // same candidates, scored by the model
    expect(ranked.map((c) => c.patchId).sort()).toEqual(
      heuristic.map((c) => c.patchId).sort(),
    )
    for (const candidate of ranked) {
      expect(candidate.reasons.join(" ")).toContain("model score")
    }
    // and sorted by the new score
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score)
    }
    await session.dispose()
  })

  it("rejects a model whose output name does not match the contract", async () => {
    await expect(
      loadOnnxSession({
        modelBytes: new Uint8Array(readFileSync(MODEL)),
        // biome-ignore lint/style/noNonNullAssertion: guarded by describe.skip
        runtime: runtime!,
        contract: { outputName: "probabilities" },
      }),
    ).rejects.toThrow(/no output "probabilities"/)
  })
})
