/**
 * Structural duplicate of `@signal-app/midi-project`'s `midi/types.ts`.
 *
 * `@signal-app/midi-project` depends on `@signal-app/orchestration-core`
 * (for `MuseAnalysisResult`/`MuseArrangementPlan`/variant types embedded in
 * `MuseMidiProject`) — see `project-types.ts` in that package. MUSE's own
 * `analysis/orchestration/variants` logic (ported here 1:1) also needs the
 * MIDI domain shapes (`MuseMidiTrack`, `MuseMusicalTimeline`, `MuseNote`,
 * ...) that live in `midi-project`. A real package dependency in the other
 * direction (this package -> midi-project) would create a cyclic workspace
 * dependency, which Turbo's task graph rejects outright.
 *
 * Since these are plain data shapes with zero runtime code, duplicating the
 * type declarations here breaks the cycle at zero cost: TypeScript's
 * structural typing means the real `MuseMidiTrack`/`MuseMusicalTimeline`/...
 * values produced by `@signal-app/midi-project` are freely assignable to and
 * from these local types, as long as the shapes stay in sync. Keep this file
 * byte-for-byte identical (modulo import paths) to
 * `packages/midi-project/src/midi/types.ts` whenever either changes.
 */

export type MuseId = string;
export type MuseIsoDateTime = string;

export interface MuseTempoEvent {
  tick: number;
  microsecondsPerBeat: number;
  bpm: number;
}

export interface MuseTimeSignatureEvent {
  tick: number;
  numerator: number;
  denominator: number;
}

export interface MuseKeySignatureEvent {
  /** Number of sharps (positive) or flats (negative), matching the MIDI key-signature meta event. */
  key: number;
  /** 0 = major, 1 = minor */
  scale: 0 | 1;
  tick: number;
}

export interface MuseMarkerEvent {
  tick: number;
  text: string;
}

export interface MuseTextEvent {
  tick: number;
  text: string;
  kind: "text" | "lyric" | "cuePoint";
}

/**
 * Everything that is shared across all tracks: PPQ, tempo/time/key maps,
 * markers and derived absolute duration. This is the "musical truth" clock.
 */
export interface MuseMusicalTimeline {
  ticksPerQuarterNote: number;
  tempoMap: MuseTempoEvent[];
  timeSignatureMap: MuseTimeSignatureEvent[];
  keySignatureMap: MuseKeySignatureEvent[];
  markers: MuseMarkerEvent[];
  textEvents: MuseTextEvent[];
  totalTicks: number;
  totalSeconds: number;
}

export interface MuseNote {
  id: MuseId;
  pitch: number;
  velocity: number;
  startTick: number;
  durationTicks: number;
  channel: number;
  sourceTrackId: MuseId;
}

export interface MuseControlChangeEvent {
  tick: number;
  controller: number;
  value: number;
}

export interface MuseProgramChangeEvent {
  tick: number;
  program: number;
}

export interface MusePitchBendEvent {
  tick: number;
  value: number;
}

export interface MuseSustainEvent {
  tick: number;
  on: boolean;
}

export interface MuseMidiTrack {
  id: MuseId;
  index: number;
  name: string | null;
  instrumentName: string | null;
  /** Predominant MIDI channel for this track (0-15), or 9 for General MIDI percussion. */
  channel: number;
  notes: MuseNote[];
  controlChanges: MuseControlChangeEvent[];
  programChanges: MuseProgramChangeEvent[];
  pitchBends: MusePitchBendEvent[];
  sustainEvents: MuseSustainEvent[];
  /** True if this track was synthesized by splitting a Format-0 single-track file by channel. */
  splitFromFormatZero: boolean;
  /** Present when this logical part was derived from a channel containing program changes. */
  derivation?: MuseMidiPartDerivation;
}

export interface MuseMidiPartDerivation {
  sourceTrackId: MuseId;
  sourceTrackIndex: number;
  channel: number;
  program: number;
  startTick: number;
  endTick: number;
  reason: "program-change" | "percussion-channel" | "unchanged";
}

export interface MuseMidiSource {
  fileName: string;
  format: 0 | 1 | 2;
  originalNumTracks: number;
  /** The untouched original file bytes, base64-encoded, so it can always be re-exported byte-for-byte. */
  rawBase64: string;
  sizeBytes: number;
  importedAt: MuseIsoDateTime;
}
