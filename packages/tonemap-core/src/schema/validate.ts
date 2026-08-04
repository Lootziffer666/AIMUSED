import { clamp01, createProvenance, type ToneMapProject } from "./tonemap.ts"
import {
  MigrationRegistry,
  SchemaError,
  TONEMAP_SCHEMA_VERSION,
  toneMapMigrations,
} from "./version.ts"

/**
 * Hand written validation instead of a JSON-schema runtime.
 *
 * The published JSON Schemas under `schemas/tonemap/` are the interchange
 * contract for other tools; this validator is the in-process guard. Keeping
 * it dependency free avoids pulling a validator into every consumer, and it
 * lets us do the thing a plain schema cannot: keep unknown fields alive.
 */

export interface ValidationIssue {
  path: string
  message: string
}

export interface ValidationResult<T> {
  ok: boolean
  value?: T
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

const TONEMAP_ROOT_KEYS = [
  "schemaVersion",
  "id",
  "name",
  "createdAt",
  "updatedAt",
  "sourcePairId",
  "ticksPerQuarterNote",
  "nodes",
  "observations",
  "directions",
  "notes",
  "unknownFields",
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Validates and (if needed) migrates a raw ToneMap document.
 * Unknown top-level fields are preserved in `unknownFields`.
 */
export function parseToneMapProject(
  raw: unknown,
  registry: MigrationRegistry = toneMapMigrations,
): ValidationResult<ToneMapProject> {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  if (!isRecord(raw)) {
    return {
      ok: false,
      errors: [{ path: "$", message: "document must be an object" }],
      warnings,
    }
  }

  let document: Record<string, unknown>
  try {
    document = registry.migrate(raw)
  } catch (error) {
    const issue =
      error instanceof SchemaError
        ? error.message
        : `migration failed: ${String(error)}`
    return {
      ok: false,
      errors: [{ path: "$.schemaVersion", message: issue }],
      warnings,
    }
  }

  const require = (key: string, type: "string" | "number") => {
    const value = document[key]
    if (typeof value !== type) {
      errors.push({
        path: `$.${key}`,
        message: `missing or invalid "${key}" (expected ${type})`,
      })
      return false
    }
    return true
  }

  require("id", "string")
  require("name", "string")
  require("createdAt", "string")
  require("updatedAt", "string")
  if (require("ticksPerQuarterNote", "number")) {
    const ppq = document.ticksPerQuarterNote as number
    if (!Number.isInteger(ppq) || ppq <= 0) {
      errors.push({
        path: "$.ticksPerQuarterNote",
        message: "ticksPerQuarterNote must be a positive integer",
      })
    }
  }

  for (const key of ["nodes", "observations", "directions"] as const) {
    if (document[key] !== undefined && !Array.isArray(document[key])) {
      errors.push({ path: `$.${key}`, message: `"${key}" must be an array` })
    }
  }

  const nodes = Array.isArray(document.nodes) ? document.nodes : []
  const ids = new Set<string>()
  nodes.forEach((node, index) => {
    if (!isRecord(node)) {
      errors.push({
        path: `$.nodes[${index}]`,
        message: "node must be an object",
      })
      return
    }
    if (typeof node.id !== "string" || node.id.length === 0) {
      errors.push({
        path: `$.nodes[${index}].id`,
        message: "node needs a stable id",
      })
      return
    }
    if (ids.has(node.id)) {
      errors.push({
        path: `$.nodes[${index}].id`,
        message: `duplicate node id "${node.id}"`,
      })
    }
    ids.add(node.id)
    if (typeof node.kind !== "string") {
      errors.push({
        path: `$.nodes[${index}].kind`,
        message: "node needs a kind",
      })
    }
    if (!isRecord(node.provenance)) {
      warnings.push({
        path: `$.nodes[${index}].provenance`,
        message: "node without provenance is treated as assumed",
      })
    }
  })

  nodes.forEach((node, index) => {
    if (!isRecord(node)) return
    if (typeof node.parentId === "string" && !ids.has(node.parentId)) {
      warnings.push({
        path: `$.nodes[${index}].parentId`,
        message: `parent "${node.parentId}" is not part of this document`,
      })
    }
  })

  const observations = Array.isArray(document.observations)
    ? document.observations
    : []
  observations.forEach((observation, index) => {
    if (!isRecord(observation)) {
      errors.push({
        path: `$.observations[${index}]`,
        message: "observation must be an object",
      })
      return
    }
    if (typeof observation.sourceRef !== "string") {
      errors.push({
        path: `$.observations[${index}].sourceRef`,
        message: "observation needs a sourceRef",
      })
    } else if (!ids.has(observation.sourceRef)) {
      warnings.push({
        path: `$.observations[${index}].sourceRef`,
        message: `sourceRef "${observation.sourceRef}" has no node in this document`,
      })
    }
    if (typeof observation.confidence === "number") {
      const confidence = observation.confidence
      if (confidence < 0 || confidence > 1) {
        errors.push({
          path: `$.observations[${index}].confidence`,
          message: "confidence must be within 0..1",
        })
      }
    }
  })

  if (errors.length > 0) return { ok: false, errors, warnings }

  const unknownFields: Record<string, unknown> = isRecord(
    document.unknownFields,
  )
    ? { ...(document.unknownFields as Record<string, unknown>) }
    : {}
  for (const [key, value] of Object.entries(document)) {
    if (!TONEMAP_ROOT_KEYS.includes(key)) unknownFields[key] = value
  }

  const project: ToneMapProject = {
    schemaVersion: TONEMAP_SCHEMA_VERSION,
    id: document.id as string,
    name: document.name as string,
    createdAt: document.createdAt as string,
    updatedAt: document.updatedAt as string,
    sourcePairId:
      typeof document.sourcePairId === "string"
        ? document.sourcePairId
        : undefined,
    ticksPerQuarterNote: document.ticksPerQuarterNote as number,
    nodes: nodes as ToneMapProject["nodes"],
    observations: observations as ToneMapProject["observations"],
    directions: Array.isArray(document.directions)
      ? (document.directions as ToneMapProject["directions"])
      : [],
    notes: Array.isArray(document.notes)
      ? (document.notes as string[])
      : undefined,
  }
  if (Object.keys(unknownFields).length > 0)
    project.unknownFields = unknownFields

  return { ok: true, value: project, errors, warnings }
}

/** Serializes a project, writing preserved unknown fields back to the root. */
export function serializeToneMapProject(project: ToneMapProject): string {
  const { unknownFields, ...rest } = project
  return `${JSON.stringify({ ...unknownFields, ...rest }, null, 2)}\n`
}

/**
 * Confidence bookkeeping: an observation is never more confident than the
 * weakest evidence it rests on.
 */
export function combineConfidence(values: number[]): number {
  if (values.length === 0) return 0
  const product = values.reduce((acc, value) => acc * clamp01(value), 1)
  return clamp01(product ** (1 / values.length))
}

export function unresolvedProvenance(source: string, reason: string) {
  return createProvenance({
    source,
    status: "unresolved",
    confidence: 0,
    extractionMethod: reason,
  })
}
