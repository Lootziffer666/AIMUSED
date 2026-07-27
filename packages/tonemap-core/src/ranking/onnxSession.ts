import { FEATURE_LAYOUT_VERSION } from "../schema/version.ts"
import {
  assertLayoutVersion,
  FEATURE_FIELDS,
  type FeatureVector,
} from "./featureLayout.ts"
import type { InferenceContract } from "./ranker.ts"

/**
 * ONNX Runtime binding.
 *
 * The system has to work without a model, so the runtime is never a hard
 * dependency: it is resolved at call time, and a missing one produces a
 * sentence that says what to install instead of a stack trace. The runtime is
 * also injectable, which is how the tests exercise the real tensor and feed
 * handling without shipping a model.
 */

export interface OnnxTensorLike {
  readonly data: ArrayLike<number>
  readonly dims: readonly number[]
}

export interface OnnxInferenceSessionLike {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, OnnxTensorLike>>
  release?(): Promise<void>
}

export interface OnnxRuntimeLike {
  InferenceSession: {
    create(
      model: string | Uint8Array,
      options?: Record<string, unknown>,
    ): Promise<OnnxInferenceSessionLike>
  }
  Tensor: new (
    type: string,
    data: Float32Array,
    dims: number[],
  ) => OnnxTensorLike
}

export class OnnxUnavailableError extends Error {
  packages: string[]

  constructor(message: string, packages: string[]) {
    super(message)
    this.name = "OnnxUnavailableError"
    this.packages = packages
  }
}

const RUNTIME_PACKAGES = ["onnxruntime-node", "onnxruntime-web"]

/** Resolves whichever ONNX Runtime build is installed, node first. */
export async function loadOnnxRuntime(): Promise<OnnxRuntimeLike> {
  const failures: string[] = []
  for (const name of RUNTIME_PACKAGES) {
    try {
      const loaded = (await import(/* @vite-ignore */ name)) as {
        default?: OnnxRuntimeLike
      } & Partial<OnnxRuntimeLike>
      const runtime = loaded.InferenceSession ? loaded : loaded.default
      if (runtime?.InferenceSession && runtime.Tensor) {
        return runtime as OnnxRuntimeLike
      }
      failures.push(`${name}: loaded but exports no InferenceSession`)
    } catch (error) {
      failures.push(
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  throw new OnnxUnavailableError(
    `no ONNX Runtime available (${failures.join("; ")}). ` +
      `Install one of ${RUNTIME_PACKAGES.join(" or ")} to use a model – ` +
      `ranking works without it, the heuristic ranker is the fallback.`,
    RUNTIME_PACKAGES,
  )
}

export const DEFAULT_CONTRACT: InferenceContract = {
  featureLayoutVersion: FEATURE_LAYOUT_VERSION,
  batchSize: -1,
  inputName: "features",
  maskName: "mask",
  outputName: "scores",
}

export interface OnnxSession {
  readonly contract: InferenceContract
  /** One score per candidate, in the order the candidates were given. */
  score(features: FeatureVector, candidateCount: number): Promise<number[]>
  dispose(): Promise<void>
}

export interface LoadOnnxSessionOptions {
  modelPath?: string
  modelBytes?: Uint8Array
  contract?: Partial<InferenceContract>
  /** Injected for tests, or to reuse a runtime the host already loaded */
  runtime?: OnnxRuntimeLike
  sessionOptions?: Record<string, unknown>
}

/**
 * Loads a model and returns a session that speaks feature-layout v1.
 *
 * The model is checked against the layout before the first inference: a model
 * trained on a different field order would otherwise produce plausible
 * nonsense.
 */
export async function loadOnnxSession(
  options: LoadOnnxSessionOptions,
): Promise<OnnxSession> {
  const model = options.modelBytes ?? options.modelPath
  if (!model) {
    throw new Error("loadOnnxSession needs a modelPath or modelBytes")
  }

  const runtime = options.runtime ?? (await loadOnnxRuntime())
  const contract: InferenceContract = {
    ...DEFAULT_CONTRACT,
    ...options.contract,
  }

  if (contract.featureLayoutVersion !== FEATURE_LAYOUT_VERSION) {
    throw new Error(
      `model expects feature layout "${contract.featureLayoutVersion}", this build writes "${FEATURE_LAYOUT_VERSION}"`,
    )
  }

  const session = await runtime.InferenceSession.create(
    model,
    options.sessionOptions,
  )

  for (const name of [contract.inputName, contract.maskName]) {
    if (!session.inputNames.includes(name)) {
      throw new Error(
        `model has no input "${name}" (inputs: ${session.inputNames.join(", ") || "none"})`,
      )
    }
  }
  if (!session.outputNames.includes(contract.outputName)) {
    throw new Error(
      `model has no output "${contract.outputName}" (outputs: ${session.outputNames.join(", ") || "none"})`,
    )
  }

  return {
    contract,
    async score(features, candidateCount) {
      assertLayoutVersion(features)
      const length = FEATURE_FIELDS.length
      const feeds: Record<string, unknown> = {
        [contract.inputName]: new runtime.Tensor(
          "float32",
          Float32Array.from(features.values),
          [1, length],
        ),
        [contract.maskName]: new runtime.Tensor(
          "float32",
          Float32Array.from(features.mask),
          [1, length],
        ),
      }

      const output = (await session.run(feeds))[contract.outputName]
      if (!output) {
        throw new Error(`model produced no "${contract.outputName}" output`)
      }
      const scores = Array.from(output.data, Number)
      if (scores.length < candidateCount) {
        throw new Error(
          `model returned ${scores.length} scores for ${candidateCount} candidates`,
        )
      }
      return scores.slice(0, candidateCount)
    },
    async dispose() {
      await session.release?.()
    },
  }
}
