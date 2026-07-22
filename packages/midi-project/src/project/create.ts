import { createId } from "@signal-app/orchestration-core/shared";
import { importMidiFile } from "../midi/import";
import {
  emptyAdaptiveMetadata,
  MUSE_PROJECT_SCHEMA_VERSION,
  type MuseMidiProject,
} from "./types";

export function createProjectFromMidiBytes(
  fileName: string,
  bytes: Uint8Array,
): MuseMidiProject {
  const imported = importMidiFile(fileName, bytes);
  const now = new Date().toISOString();
  const name = fileName.replace(/\.[^/.]+$/, "") || "Unbenanntes Projekt";

  return {
    schemaVersion: MUSE_PROJECT_SCHEMA_VERSION,
    id: createId("project"),
    name,
    source: imported.source,
    timeline: imported.timeline,
    tracks: imported.tracks,
    analysis: null,
    arrangement: null,
    variants: [],
    adaptive: emptyAdaptiveMetadata(),
    createdAt: now,
    updatedAt: now,
  };
}
