import type {
  Articulation,
  InstrumentFamily,
  TimbreVector,
} from "../schema/tonemap.ts"
import {
  LIBRARY_MANIFEST_SCHEMA_VERSION,
  type VersionedDocument,
} from "../schema/version.ts"

/**
 * Instrument library manifests.
 *
 * The sample libraries themselves are never committed. A manifest describes
 * what a locally installed library offers, with paths that are configurable
 * per machine. VCSL and VSCO 2 CE are prepared through the SFZ scanner plus
 * hand maintainable metadata – no invented catalogues.
 */

export interface InstrumentRange {
  lowMidi: number
  highMidi: number
  preferredLowMidi?: number
  preferredHighMidi?: number
}

export interface InstrumentPatch {
  id: string
  displayName: string
  family: InstrumentFamily
  instrument: string
  range: InstrumentRange
  articulation: Articulation
  /** Dynamic layers the patch offers, e.g. ["p", "mf", "f"] */
  dynamics?: string[]
  velocityLayers?: number
  roundRobins?: number
  timbre?: TimbreVector
  /** Locator inside the library: SFZ path, SoundFont preset, ... */
  sfzPath?: string
  soundFontPreset?: { bank: number; program: number }
  keyswitches?: { articulation: Articulation; noteNumber: number }[]
  controllers?: Record<string, number>
  supportedSampleRates?: number[]
  knownLimitations?: string[]
  fallbackPatchIds?: string[]
}

export interface InstrumentLibraryManifest extends VersionedDocument {
  schemaVersion: string
  id: string
  name: string
  version?: string
  /** Configurable per machine; never committed with an absolute path */
  rootPath?: string
  license?: string
  homepage?: string
  patches: InstrumentPatch[]
}

export interface MetadataGap {
  patchId: string
  field: string
  severity: "warning" | "info"
  message: string
}

export interface ManifestValidation {
  ok: boolean
  errors: string[]
  gaps: MetadataGap[]
}

export function createLibraryManifest(options: {
  id: string
  name: string
  rootPath?: string
  license?: string
  patches?: InstrumentPatch[]
}): InstrumentLibraryManifest {
  return {
    schemaVersion: LIBRARY_MANIFEST_SCHEMA_VERSION,
    id: options.id,
    name: options.name,
    rootPath: options.rootPath,
    license: options.license,
    patches: options.patches ?? [],
  }
}

/**
 * Validates a manifest and reports missing metadata separately from errors:
 * an incomplete manifest is still usable, it just ranks worse.
 */
export function validateLibraryManifest(
  manifest: InstrumentLibraryManifest,
): ManifestValidation {
  const errors: string[] = []
  const gaps: MetadataGap[] = []

  if (manifest.schemaVersion !== LIBRARY_MANIFEST_SCHEMA_VERSION) {
    errors.push(
      `unexpected schema version "${manifest.schemaVersion}" (expected "${LIBRARY_MANIFEST_SCHEMA_VERSION}")`,
    )
  }
  if (!manifest.id) errors.push("manifest needs an id")
  if (!manifest.name) errors.push("manifest needs a name")

  const seen = new Set<string>()
  for (const patch of manifest.patches) {
    if (!patch.id) {
      errors.push("every patch needs a stable id")
      continue
    }
    if (seen.has(patch.id)) errors.push(`duplicate patch id "${patch.id}"`)
    seen.add(patch.id)

    if (!patch.range || patch.range.lowMidi >= patch.range.highMidi) {
      errors.push(`patch "${patch.id}" has no usable range`)
    }
    if (!patch.family) {
      gaps.push({
        patchId: patch.id,
        field: "family",
        severity: "warning",
        message: "no instrument family: ranking falls back to name matching",
      })
    }
    if (!patch.timbre || Object.keys(patch.timbre).length === 0) {
      gaps.push({
        patchId: patch.id,
        field: "timbre",
        severity: "info",
        message: "no timbre vector: ranking uses family defaults",
      })
    }
    if (!patch.articulation) {
      gaps.push({
        patchId: patch.id,
        field: "articulation",
        severity: "warning",
        message: "no articulation: assumed to be sustain",
      })
    }
    if (!patch.sfzPath && !patch.soundFontPreset) {
      gaps.push({
        patchId: patch.id,
        field: "locator",
        severity: "warning",
        message: "no SFZ path and no SoundFont preset: cannot be rendered",
      })
    }
    if (
      patch.range?.preferredLowMidi === undefined ||
      patch.range?.preferredHighMidi === undefined
    ) {
      gaps.push({
        patchId: patch.id,
        field: "range.preferred",
        severity: "info",
        message: "no comfortable range: register warnings are less precise",
      })
    }
  }

  return { ok: errors.length === 0, errors, gaps }
}

export class LibraryPathError extends Error {
  libraryId: string

  constructor(libraryId: string, message: string) {
    super(message)
    this.name = "LibraryPathError"
    this.libraryId = libraryId
  }
}

/** Resolves a patch to an absolute locator, with a readable error when it cannot. */
export function resolvePatchPath(
  manifest: InstrumentLibraryManifest,
  patchId: string,
): string {
  const patch = manifest.patches.find((entry) => entry.id === patchId)
  if (!patch) {
    throw new LibraryPathError(
      manifest.id,
      `library "${manifest.id}" has no patch "${patchId}"`,
    )
  }
  if (!patch.sfzPath) {
    throw new LibraryPathError(
      manifest.id,
      `patch "${patchId}" has no SFZ path – set one in the manifest or pick a SoundFont preset`,
    )
  }
  if (!manifest.rootPath) {
    throw new LibraryPathError(
      manifest.id,
      `library "${manifest.id}" has no rootPath configured. Set it to the directory where the samples are installed on this machine.`,
    )
  }
  const root = manifest.rootPath.replace(/\/+$/, "")
  const relative = patch.sfzPath.replace(/^\/+/, "")
  return `${root}/${relative}`
}

/** Merges hand maintained metadata into scanned patches, by patch id. */
export function mergePatchMetadata(
  scanned: InstrumentPatch[],
  overrides: Partial<InstrumentPatch>[],
): InstrumentPatch[] {
  const byId = new Map(overrides.filter((o) => o.id).map((o) => [o.id!, o]))
  return scanned.map((patch) => {
    const override = byId.get(patch.id)
    if (!override) return patch
    return {
      ...patch,
      ...override,
      range: { ...patch.range, ...(override.range ?? {}) },
      timbre: { ...(patch.timbre ?? {}), ...(override.timbre ?? {}) },
    }
  })
}
