import type { ValidationIssue, ValidationResult } from "../schema/validate.ts"
import {
  PAIRED_SOURCE_SCHEMA_VERSION,
  type VersionedDocument,
} from "../schema/version.ts"

/**
 * A paired source is one MIDI file plus the recording it belongs to.
 *
 * The manifest is the only thing that gets committed. It *references* local
 * files; the audio and the hand-built MIDI stay outside version control
 * (see `privateAssets.ts` and the repository .gitignore rules).
 */

export type AudioFormat = "wav" | "flac" | "mp3" | "ogg" | "opus"

export const SUPPORTED_AUDIO_FORMATS: AudioFormat[] = [
  "wav",
  "flac",
  "mp3",
  "ogg",
  "opus",
]

export interface PairedAudioRef {
  path: string
  format: AudioFormat
  sampleRate?: number
  channels?: number
  durationSeconds?: number
  /** Checksum of the referenced file, so a swapped file is noticed */
  sha256?: string
}

export interface PairedMidiRef {
  path: string
  sha256?: string
  /** "hand-reconstructed" is the Monkey-Island case: a human rebuilt it */
  origin?:
    | "hand-reconstructed"
    | "original-export"
    | "transcription"
    | "unknown"
}

export interface PairedRelationship {
  sameArrangement: boolean
  sameTempo: boolean
  sameLength: boolean
  /** Positive: audio starts later than the MIDI */
  knownOffsetMs: number | null
}

export interface PairedRights {
  publiclyRedistributable: boolean
  analysisAllowedLocally: boolean
  note?: string
}

export interface PairedSourceManifest extends VersionedDocument {
  schemaVersion: string
  id: string
  title?: string
  midi: PairedMidiRef
  audio?: PairedAudioRef
  relationship: PairedRelationship
  rights: PairedRights
  createdAt?: string
}

export function createPairedSourceManifest(options: {
  id: string
  midiPath: string
  audioPath?: string
  audioFormat?: AudioFormat
  title?: string
  now?: string
}): PairedSourceManifest {
  return {
    schemaVersion: PAIRED_SOURCE_SCHEMA_VERSION,
    id: options.id,
    title: options.title,
    midi: { path: options.midiPath, origin: "unknown" },
    audio: options.audioPath
      ? {
          path: options.audioPath,
          format:
            options.audioFormat ?? guessAudioFormat(options.audioPath) ?? "wav",
        }
      : undefined,
    relationship: {
      sameArrangement: true,
      sameTempo: true,
      sameLength: false,
      knownOffsetMs: null,
    },
    rights: { publiclyRedistributable: false, analysisAllowedLocally: true },
    createdAt: options.now ?? new Date().toISOString(),
  }
}

export function guessAudioFormat(path: string): AudioFormat | undefined {
  const extension = path.split(".").pop()?.toLowerCase()
  switch (extension) {
    case "wav":
    case "wave":
      return "wav"
    case "flac":
      return "flac"
    case "mp3":
      return "mp3"
    case "ogg":
      return "ogg"
    case "opus":
      return "opus"
    default:
      return undefined
  }
}

export function parsePairedSourceManifest(
  raw: unknown,
): ValidationResult<PairedSourceManifest> {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      errors: [{ path: "$", message: "manifest must be an object" }],
      warnings,
    }
  }
  const document = raw as Record<string, unknown>

  if (document.schemaVersion !== PAIRED_SOURCE_SCHEMA_VERSION) {
    errors.push({
      path: "$.schemaVersion",
      message: `expected "${PAIRED_SOURCE_SCHEMA_VERSION}", found "${String(document.schemaVersion)}"`,
    })
  }
  if (typeof document.id !== "string" || document.id.length === 0) {
    errors.push({ path: "$.id", message: "manifest needs an id" })
  }

  const midi = document.midi as Record<string, unknown> | undefined
  if (!midi || typeof midi.path !== "string") {
    errors.push({ path: "$.midi.path", message: "manifest needs a MIDI path" })
  }

  const audio = document.audio as Record<string, unknown> | undefined
  if (audio) {
    if (typeof audio.path !== "string") {
      errors.push({
        path: "$.audio.path",
        message: "audio reference needs a path",
      })
    }
    if (
      typeof audio.format !== "string" ||
      !SUPPORTED_AUDIO_FORMATS.includes(audio.format as AudioFormat)
    ) {
      errors.push({
        path: "$.audio.format",
        message: `unsupported audio format "${String(audio.format)}" (supported: ${SUPPORTED_AUDIO_FORMATS.join(", ")})`,
      })
    }
  } else {
    warnings.push({
      path: "$.audio",
      message: "no audio reference: only symbolic analysis will be available",
    })
  }

  const rights = document.rights as Record<string, unknown> | undefined
  if (!rights || typeof rights.analysisAllowedLocally !== "boolean") {
    errors.push({
      path: "$.rights",
      message: "rights.analysisAllowedLocally must be stated explicitly",
    })
  } else if (rights.analysisAllowedLocally === false) {
    warnings.push({
      path: "$.rights.analysisAllowedLocally",
      message: "analysis is not permitted for this pair",
    })
  }
  if (rights?.publiclyRedistributable === true) {
    warnings.push({
      path: "$.rights.publiclyRedistributable",
      message:
        "marked as redistributable – double check before committing anything derived from it",
    })
  }

  const relationship = document.relationship as
    | Record<string, unknown>
    | undefined
  if (!relationship) {
    warnings.push({
      path: "$.relationship",
      message: "no relationship stated, assuming same arrangement and tempo",
    })
  }

  if (errors.length > 0) return { ok: false, errors, warnings }

  const manifest: PairedSourceManifest = {
    schemaVersion: PAIRED_SOURCE_SCHEMA_VERSION,
    id: document.id as string,
    title: typeof document.title === "string" ? document.title : undefined,
    midi: midi as unknown as PairedMidiRef,
    audio: audio as unknown as PairedAudioRef | undefined,
    relationship: {
      sameArrangement: relationship?.sameArrangement !== false,
      sameTempo: relationship?.sameTempo !== false,
      sameLength: relationship?.sameLength === true,
      knownOffsetMs:
        typeof relationship?.knownOffsetMs === "number"
          ? (relationship.knownOffsetMs as number)
          : null,
    },
    rights: rights as unknown as PairedRights,
    createdAt:
      typeof document.createdAt === "string" ? document.createdAt : undefined,
  }
  return { ok: true, value: manifest, errors, warnings }
}
