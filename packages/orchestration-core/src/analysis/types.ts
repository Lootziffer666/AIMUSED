import type { MuseId, MuseTimeSignatureEvent } from "../midi-types";

export type MuseMusicalRole =
  | "melody"
  | "counterMelody"
  | "harmony"
  | "chordPad"
  | "bass"
  | "rhythmicOstinato"
  | "percussion"
  | "pad"
  | "accent"
  | "effect"
  | "unknown";

export type MuseCertainty =
  | "erkannt"
  | "wahrscheinlich"
  | "unsicher"
  | "nicht erkannt";

export interface MuseRoleDetection {
  role: MuseMusicalRole;
  confidence: number;
  evidence: string[];
}

export interface MuseTrackAnalysis {
  trackId: MuseId;
  noteCount: number;
  pitchRange: { low: number; high: number };
  meanPitch: number;
  noteDensity: number;
  polyphony: number;
  isMonophonic: boolean;
  rhythmicActivity: number;
  averageVelocity: number;
  longNoteRatio: number;
  shortNoteRatio: number;
  repetitionScore: number;
  roles: MuseRoleDetection[];
}

export interface MuseSection {
  id: MuseId;
  startTick: number;
  endTick: number;
  label: string;
  certainty: MuseCertainty;
}

export interface MuseMotifOccurrence {
  startTick: number;
  endTick: number;
  transposition: number;
}

export interface MuseMotif {
  id: MuseId;
  sourceTrackId: MuseId;
  pitchIntervals: number[];
  anchorPitch: number;
  occurrences: MuseMotifOccurrence[];
  certainty: MuseCertainty;
}

export interface MuseGlobalAnalysis {
  totalDurationSeconds: number;
  tempoSummary: { minBpm: number; maxBpm: number; averageBpm: number };
  timeSignatures: MuseTimeSignatureEvent[];
  pitchHistogram: number[];
  estimatedKey: { tonic: number; scale: "major" | "minor"; confidence: number };
  rhythmicDensity: number;
  dynamicDensity: number;
  maxPolyphony: number;
  silenceRatio: number;
  phraseBoundaryTicks: number[];
  sections: MuseSection[];
}

export interface MuseAnalysisResult {
  schemaVersion: number;
  analyzedAt: string;
  global: MuseGlobalAnalysis;
  tracks: MuseTrackAnalysis[];
  motifs: MuseMotif[];
}
