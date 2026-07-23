import type {
  MuseId,
  MuseIsoDateTime,
  MuseMidiSource,
  MuseMidiTrack,
  MuseMusicalTimeline,
} from "../midi/types";
import type { MuseAnalysisResult } from "@signal-app/orchestration-core";
import type { MuseArrangementPlan } from "@signal-app/orchestration-core";
import type {
  MuseAdaptiveMetadata,
  MuseArrangementVariant,
} from "@signal-app/orchestration-core";

export const MUSE_PROJECT_SCHEMA_VERSION = 2;

export interface MuseMidiProject {
  schemaVersion: number;
  id: MuseId;
  name: string;
  source: MuseMidiSource;
  timeline: MuseMusicalTimeline;
  tracks: MuseMidiTrack[];
  analysis: MuseAnalysisResult | null;
  arrangement: MuseArrangementPlan | null;
  variants: MuseArrangementVariant[];
  adaptive: MuseAdaptiveMetadata;
  createdAt: MuseIsoDateTime;
  updatedAt: MuseIsoDateTime;
}

export function emptyAdaptiveMetadata(): MuseAdaptiveMetadata {
  return {
    cuePoints: [],
    loopRegions: [],
    intensityLevels: [0, 0.33, 0.66, 1],
  };
}
