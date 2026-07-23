import type { MuseId } from "../midi/types";
import type {
  MuseArrangementVariant,
  MuseArticulation,
  MuseMusicalRole,
} from "@signal-app/orchestration-core";

export type MuseMidiImportSource =
  | { kind: "file"; fileName: string; bytesBase64: string }
  | { kind: "fixture"; fixtureId: string };

export type MuseCommand =
  | { type: "IMPORT_MIDI"; source: MuseMidiImportSource }
  | { type: "SET_TRACK_ROLE"; trackId: MuseId; role: MuseMusicalRole }
  | { type: "ASSIGN_INSTRUMENT"; targetId: MuseId; instrumentId: string }
  | {
      type: "TOGGLE_DOUBLING";
      targetId: MuseId;
      instrumentId: string;
      enabled: boolean;
    }
  | { type: "SET_OCTAVE_SHIFT"; targetId: MuseId; octaveShift: number }
  | {
      type: "SET_ARTICULATION_OVERRIDE";
      targetId: MuseId;
      articulation: MuseArticulation;
    }
  | { type: "SET_TRACK_MUTED"; targetId: MuseId; muted: boolean }
  | {
      type: "APPLY_RECIPE";
      recipeId: string;
      preserveUserOverrides: boolean;
      seed?: number;
    }
  | { type: "SET_SECTION_INTENSITY"; sectionId: MuseId; intensity: number }
  | {
      type: "SET_LAYER_ACTIVE_RANGE";
      layerId: MuseId;
      startTick: number;
      endTick: number;
    }
  | { type: "LOCK_MELODY"; sourceTrackId: MuseId }
  | { type: "CREATE_VARIANT"; variant: MuseArrangementVariant }
  | { type: "DELETE_VARIANT"; variantId: MuseId }
  | { type: "UNDO" }
  | { type: "REDO" };

export interface MuseCommandValidationError {
  ok: false;
  message: string;
}

export interface MuseCommandValidationOk {
  ok: true;
}

export type MuseCommandValidationResult =
  | MuseCommandValidationOk
  | MuseCommandValidationError;

export interface MuseCommandLogEntry {
  id: MuseId;
  command: MuseCommand;
  appliedAt: string;
}
