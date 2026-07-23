import type { MuseId } from "../midi-types";

export type MuseVariantKind =
  | "full"
  | "reduced"
  | "exploration"
  | "danger"
  | "combat"
  | "finale";

export interface MuseArrangementOverride {
  layerId: MuseId;
  active: boolean;
  intensityMultiplier: number;
}

export interface MuseArrangementVariant {
  id: MuseId;
  name: string;
  kind: MuseVariantKind;
  baseArrangementId: MuseId;
  intensity: number;
  enabledLayers: MuseId[];
  overrides: MuseArrangementOverride[];
  transitionCompatibility: MuseVariantKind[];
}

/**
 * Metadata prepared for the downstream Adaptive Pathos system.
 * MUSE only *prepares* this data — it never runs adaptive playback logic itself.
 */
export interface MuseAdaptiveCuePoint {
  id: MuseId;
  tick: number;
  kind: "intro" | "mainLoopStart" | "transition" | "outro" | "stinger";
  compatibleVariantIds: MuseId[];
}

export interface MuseAdaptiveLoopRegion {
  id: MuseId;
  startTick: number;
  endTick: number;
  variantId: MuseId;
  barAligned: boolean;
}

export interface MuseAdaptiveMetadata {
  cuePoints: MuseAdaptiveCuePoint[];
  loopRegions: MuseAdaptiveLoopRegion[];
  intensityLevels: number[];
}
