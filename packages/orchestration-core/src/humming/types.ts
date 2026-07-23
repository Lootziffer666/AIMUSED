/**
 * Ported from MUSE's `src/lib/humming/types.ts`. MUSE's own status doc
 * (`docs/STATUS.md`) describes this pipeline as implemented and tested
 * against synthetic audio, with the browser microphone-recording UI left as
 * a future milestone. AIMUSED builds that UI (see
 * `app/src/components/HummingDialog`), so these types are no longer
 * "prepared interfaces" for an unbuilt feature — they're the real thing.
 *
 * `MusePlannedHummingCommand` from the original file is intentionally NOT
 * ported: it was MUSE's own note-to-self for a future command-reducer
 * integration that was never built, and per docs/MERGE_PLAN.md's guiding
 * principle, adding fake `MuseCommand` variants without a real reducer path
 * would be exactly the misleading mockup the original brief warned against.
 * The humming UI dispatches to the pipeline functions and a dedicated store
 * directly, the same way `OrchestrationDialog` calls
 * `orchestrationStore.dispatch(...)` for real recipe commands but doesn't
 * need a fake command for every UI interaction.
 */

export interface MuseMicrophoneRecording {
  id: string;
  sampleRate: number;
  channelData: Float32Array;
  recordedAt: string;
}

export interface MusePitchDetectionFrame {
  timeSeconds: number;
  /** MIDI note number, fractional (before quantization). */
  detectedPitch: number | null;
  confidence: number;
}

export interface MuseOnsetEvent {
  timeSeconds: number;
  strength: number;
}

export interface MuseQuantizationSettings {
  /** 0 = no quantization (raw timing), 1 = fully snapped to the grid. */
  strength: number;
  gridSubdivision: number;
}

export interface MuseHummingImportResult {
  recordingId: string;
  detectedNotes: {
    pitch: number;
    startSeconds: number;
    durationSeconds: number;
    confidence: number;
    evidence: { frameCount: number; onsetStrength: number; medianPitch: number };
  }[];
  onsets: MuseOnsetEvent[];
  /** A draft must be reviewed/corrected before a command may add it to the project. */
  reviewStatus: "draft" | "approved";
  quantization: MuseQuantizationSettings;
}

export interface MuseHummingCorrection {
  noteIndex: number;
  pitch?: number;
  startSeconds?: number;
  durationSeconds?: number;
  discard?: boolean;
}

export type MuseHummingTargetRole = "melody" | "bass" | "percussion";
