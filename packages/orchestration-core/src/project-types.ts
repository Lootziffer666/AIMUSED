import type {
  MuseId,
  MuseIsoDateTime,
  MuseMidiSource,
  MuseMidiTrack,
  MuseMusicalTimeline,
} from "./midi-types";
import type { MuseAnalysisResult } from "./analysis/types";
import type { MuseArrangementPlan } from "./orchestration/types";
import type {
  MuseAdaptiveMetadata,
  MuseArrangementVariant,
} from "./variants/types";

/**
 * Structural duplicate of `@signal-app/midi-project`'s `project/types.ts`
 * `MuseMidiProject` interface — see `midi-types.ts` in this package for why
 * this is duplicated rather than imported: `@signal-app/midi-project`
 * already depends on this package for `MuseAnalysisResult` /
 * `MuseArrangementPlan` / `MuseAdaptiveMetadata` / `MuseArrangementVariant`,
 * so a reverse dependency back onto `@signal-app/midi-project` here would be
 * a cyclic workspace dependency. Since all of `MuseMidiProject`'s fields are
 * plain data (this package's own analysis/orchestration/variant types, plus
 * the duplicated MIDI domain types from `./midi-types`), duplicating the
 * container type has zero runtime cost and TypeScript's structural typing
 * makes the real `MuseMidiProject` values produced by
 * `@signal-app/midi-project` freely assignable here.
 */
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
