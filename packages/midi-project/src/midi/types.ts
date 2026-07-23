/**
 * Core MIDI/timeline data model for MUSE.
 * This is the normalized, non-destructive representation of an imported
 * Standard MIDI File. The original bytes always remain recoverable via
 * `MuseMidiSource.rawBase64`.
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

export class MuseMidiImportError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid-file"
      | "unsupported-format"
      | "unsupported-time-division"
      | "empty-file",
  ) {
    super(message);
    this.name = "MuseMidiImportError";
  }
}
