/**
 * Schema versioning and migration hooks.
 *
 * Every persisted ToneMap artefact carries `schemaVersion`. Readers never
 * guess: an unknown *newer* version is refused, an older one is migrated
 * through the registered hooks, and unknown fields are preserved so a file
 * written by a newer MUSE never silently loses data on a round trip.
 */

export const TONEMAP_SCHEMA_VERSION = "muse.tonemap.v1"
export const PAIRED_SOURCE_SCHEMA_VERSION = "muse.paired-source.v1"
export const LIBRARY_MANIFEST_SCHEMA_VERSION = "muse.library-manifest.v1"
export const TRAINING_RECORD_SCHEMA_VERSION = "muse.training-record.v1"
export const RENDER_MANIFEST_SCHEMA_VERSION = "muse.render-manifest.v1"
export const FEATURE_LAYOUT_VERSION = "muse.feature-layout.v1"

export interface VersionedDocument {
  schemaVersion: string
  /** Fields written by a newer or foreign producer, kept verbatim. */
  unknownFields?: Record<string, unknown>
}

export type MigrationHook = (
  document: Record<string, unknown>,
) => Record<string, unknown>

export interface MigrationStep {
  from: string
  to: string
  migrate: MigrationHook
}

export class SchemaError extends Error {
  details: { found?: string; expected?: string }

  constructor(
    message: string,
    details: { found?: string; expected?: string } = {},
  ) {
    super(message)
    this.name = "SchemaError"
    this.details = details
  }
}

/** Ordered chain of migrations for one document kind. */
export class MigrationRegistry {
  private steps: MigrationStep[] = []
  currentVersion: string

  constructor(currentVersion: string, steps: MigrationStep[] = []) {
    this.currentVersion = currentVersion
    for (const step of steps) this.register(step)
  }

  register(step: MigrationStep): void {
    if (this.steps.some((s) => s.from === step.from)) {
      throw new SchemaError(`duplicate migration from ${step.from}`)
    }
    this.steps.push(step)
  }

  knowsVersion(version: string): boolean {
    return (
      version === this.currentVersion ||
      this.steps.some((s) => s.from === version || s.to === version)
    )
  }

  /**
   * Brings a document up to the current version. Throws for unknown versions
   * instead of guessing – a wrong guess would corrupt musical data.
   */
  migrate(document: Record<string, unknown>): Record<string, unknown> {
    const version = document.schemaVersion
    if (typeof version !== "string") {
      throw new SchemaError("document has no schemaVersion", {
        expected: this.currentVersion,
      })
    }
    if (version === this.currentVersion) return document
    if (!this.knowsVersion(version)) {
      throw new SchemaError(
        `unknown schema version "${version}" (this build writes "${this.currentVersion}")`,
        { found: version, expected: this.currentVersion },
      )
    }

    let current = document
    let guard = 0
    while (current.schemaVersion !== this.currentVersion) {
      const step = this.steps.find((s) => s.from === current.schemaVersion)
      if (!step) {
        throw new SchemaError(
          `no migration path from "${String(current.schemaVersion)}" to "${this.currentVersion}"`,
          {
            found: String(current.schemaVersion),
            expected: this.currentVersion,
          },
        )
      }
      current = { ...step.migrate(current), schemaVersion: step.to }
      if (++guard > 64) throw new SchemaError("migration loop detected")
    }
    return current
  }
}

export const toneMapMigrations = new MigrationRegistry(TONEMAP_SCHEMA_VERSION)

/**
 * Splits a raw document into the fields a reader understands and everything
 * else. The remainder travels with the document and is written back out.
 */
export function partitionKnownFields<T extends object>(
  raw: Record<string, unknown>,
  knownKeys: readonly (keyof T | "schemaVersion" | "unknownFields")[],
): { known: Record<string, unknown>; unknown: Record<string, unknown> } {
  const known: Record<string, unknown> = {}
  const unknown: Record<string, unknown> = {}
  const keys = new Set(knownKeys.map(String))
  for (const [key, value] of Object.entries(raw)) {
    if (key === "unknownFields") continue
    if (keys.has(key)) known[key] = value
    else unknown[key] = value
  }
  const carried = raw.unknownFields
  if (carried && typeof carried === "object") {
    Object.assign(unknown, carried as Record<string, unknown>)
  }
  return { known, unknown }
}
