import type { MuseId } from "../midi-types";
import type { MuseMusicalRole } from "../analysis/types";

export type MuseInstrumentFamily =
  | "strings"
  | "woodwinds"
  | "brass"
  | "percussion"
  | "keys"
  | "choir"
  | "synth"
  | "folk"
  | "other";

export type MuseArticulation =
  | "sustain"
  | "legato"
  | "staccato"
  | "marcato"
  | "accent"
  | "pizzicato"
  | "tremolo"
  | "swell";

export interface MuseInstrumentRange {
  lowMidi: number;
  highMidi: number;
  preferredLowMidi: number;
  preferredHighMidi: number;
}

export interface MuseInstrumentDefinition {
  id: string;
  name: string;
  family: MuseInstrumentFamily;
  range: MuseInstrumentRange;
  capabilities: MuseArticulation[];
  roles: MuseMusicalRole[];
  weight: "light" | "medium" | "heavy";
  /** How many simultaneous voices this instrument can realistically sound (1 = solo/monophonic). */
  maxVoices: number;
  /** MVP renderer mapping only — orchestration logic never reasons about this directly. */
  generalMidiProgram: number;
  /** Instrument name key understood by soundfont-player / midi-js-soundfonts. */
  soundfontName: string;
  /** "percussion" routes to the General MIDI channel-10 drum map instead of a melodic program change. */
  channelHint: "melodic" | "percussion";
}

export type MuseDecisionOrigin =
  | "source"
  | "analysis"
  | "recipe"
  | "user"
  | "agent";

export interface MuseDecision<T> {
  value: T;
  origin: MuseDecisionOrigin;
  locked: boolean;
  reason: string;
}

export type MuseDramaturgyStage =
  | "intro"
  | "buildup"
  | "release"
  | "buildup2"
  | "climax"
  | "outro";

export interface MuseInstrumentAssignment {
  id: MuseId;
  targetTrackId: MuseId;
  role: MuseDecision<MuseMusicalRole>;
  instrumentId: MuseDecision<string>;
  doublingInstrumentIds: MuseDecision<string[]>;
  octaveShift: MuseDecision<number>;
  articulation: MuseDecision<MuseArticulation>;
  muted: MuseDecision<boolean>;
}

export interface MuseArrangementSection {
  id: MuseId;
  sourceSectionId: MuseId | null;
  startTick: number;
  endTick: number;
  label: string;
  dramaturgyStage: MuseDramaturgyStage;
}

export interface MuseDynamicPlan {
  sectionId: MuseId;
  intensity: MuseDecision<number>;
}

export interface MuseLayerPlan {
  id: MuseId;
  name: string;
  family: MuseInstrumentFamily;
  sourceTrackIds: MuseId[];
  activeRange: MuseDecision<{ startTick: number; endTick: number }>;
}

export interface MuseWarning {
  id: string;
  severity: "info" | "warning";
  message: string;
  targetId?: string;
}

export interface MuseArrangementPlan {
  id: MuseId;
  recipeId: string;
  sourceProjectId: MuseId;
  createdAt: string;
  seed: number;
  sections: MuseArrangementSection[];
  assignments: MuseInstrumentAssignment[];
  dynamics: MuseDynamicPlan[];
  layers: MuseLayerPlan[];
  warnings: MuseWarning[];
}

// ---- Recipes --------------------------------------------------------------

export interface MuseRecipeRolePreference {
  role: MuseMusicalRole;
  instrumentIds: string[];
  doubling?: { instrumentIds: string[]; condition: "always" | "climax" };
}

export interface MuseOrchestrationRecipe {
  id: string;
  name: string;
  description: string;
  preferredFamilies: MuseInstrumentFamily[];
  rolePreferences: MuseRecipeRolePreference[];
  dramaturgyIntensityByStage: Record<MuseDramaturgyStage, number>;
  maxDensity: number;
  percussionStrategy: "none" | "light" | "orchestral" | "driving";
  registerRules: { avoidLowClusters: boolean; maxVoicesPerRole: number };
  articulationBias: Partial<Record<MuseMusicalRole, MuseArticulation>>;
  humanization: {
    timingMs: number;
    velocityRange: number;
    durationPercent: number;
  };
  finaleBehavior: "full-tutti" | "restrained" | "motif-return";
  /** Optional id of a base recipe this one derives from (recipes stay combinable/derivable). */
  extends?: string;
}

// ---- Renderable project (flattened, ready for playback/export) -----------

export interface MuseRenderNote {
  id: MuseId;
  pitch: number;
  velocity: number;
  startTick: number;
  durationTicks: number;
  startSeconds: number;
  durationSeconds: number;
  channel: number;
  instrumentId: string;
  articulation: MuseArticulation;
  groupId: string;
}

export interface MuseRenderGroup {
  id: string;
  name: string;
  family: MuseInstrumentFamily;
}

export interface MuseRenderableProject {
  id: MuseId;
  ticksPerQuarterNote: number;
  totalSeconds: number;
  notes: MuseRenderNote[];
  groups: MuseRenderGroup[];
}
