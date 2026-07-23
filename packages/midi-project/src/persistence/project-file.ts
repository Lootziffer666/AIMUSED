import {
  emptyAdaptiveMetadata,
  MUSE_PROJECT_SCHEMA_VERSION,
  type MuseMidiProject,
} from "../project/types";

export class MuseProjectFileError extends Error {}

export function serializeProjectFile(project: MuseMidiProject): string {
  return JSON.stringify(project, null, 2);
}

export function parseProjectFile(text: string): MuseMidiProject {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new MuseProjectFileError(
      `Die Projektdatei ist beschädigt: kein gültiges JSON (${err instanceof Error ? err.message : String(err)}).`,
    );
  }
  return migrateProject(data);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validates and upgrades a raw parsed project to the current schema.
 * Schema 1 is the only version so far; future bumps add sequential
 * `if (schemaVersion < N) data = upgradeToN(data);` steps ahead of validation.
 */
export function migrateProject(data: unknown): MuseMidiProject {
  if (!isRecord(data)) {
    throw new MuseProjectFileError(
      "Die Projektdatei ist beschädigt: erwartet wurde ein Projektobjekt.",
    );
  }

  let record: Record<string, unknown> = data;
  const schemaVersion =
    typeof record.schemaVersion === "number" ? record.schemaVersion : 0;
  if (schemaVersion > MUSE_PROJECT_SCHEMA_VERSION) {
    throw new MuseProjectFileError(
      `Diese Projektdatei wurde mit einer neueren MUSE-Version gespeichert (Schema ${schemaVersion}); diese Version unterstützt nur bis Schema ${MUSE_PROJECT_SCHEMA_VERSION}.`,
    );
  }

  if (schemaVersion < 2 && Array.isArray(record.tracks)) {
    record = {
      ...record,
      schemaVersion: 2,
      tracks: record.tracks.map((track) =>
        isRecord(track) ? { ...track, derivation: undefined } : track,
      ),
    };
  }
  validateProjectShape(record);

  const project = record as unknown as MuseMidiProject;
  return {
    ...project,
    schemaVersion: MUSE_PROJECT_SCHEMA_VERSION,
    variants: project.variants ?? [],
    adaptive: project.adaptive ?? emptyAdaptiveMetadata(),
  };
}

function validateProjectShape(data: Record<string, unknown>): void {
  for (const field of ["id", "name", "createdAt", "updatedAt"]) {
    if (typeof data[field] !== "string") {
      throw new MuseProjectFileError(
        `Die Projektdatei ist beschädigt: Pflichtfeld "${field}" fehlt oder hat den falschen Typ.`,
      );
    }
  }
  const source = data.source;
  if (!isRecord(source) || typeof source.rawBase64 !== "string") {
    throw new MuseProjectFileError(
      "Die Projektdatei ist beschädigt: die ursprüngliche MIDI-Quelle (source.rawBase64) fehlt.",
    );
  }
  const timeline = data.timeline;
  if (
    !isRecord(timeline) ||
    !Array.isArray(timeline.tempoMap) ||
    typeof timeline.ticksPerQuarterNote !== "number"
  ) {
    throw new MuseProjectFileError(
      "Die Projektdatei ist beschädigt: die musikalische Timeline fehlt oder ist ungültig.",
    );
  }
  if (!Array.isArray(data.tracks)) {
    throw new MuseProjectFileError(
      "Die Projektdatei ist beschädigt: das Spuren-Array fehlt.",
    );
  }
}
