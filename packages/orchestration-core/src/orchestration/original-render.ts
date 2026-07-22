import type { MuseMidiProject } from "../project-types";
import { ticksToSeconds } from "../tick-time";
import type { MuseRenderNote, MuseRenderableProject } from "./types";

/** Rough General-MIDI-program -> MUSE-catalog-instrument guess, used only to preview the untouched original with plausible timbres. */
const GM_PROGRAM_TO_INSTRUMENT: Record<number, string> = {
  0: "piano",
  1: "piano",
  40: "solo_violin",
  41: "viola",
  42: "solo_cello",
  43: "double_bass",
  46: "orchestral_harp",
  47: "timpani",
  48: "string_ensemble",
  49: "string_ensemble",
  52: "choir_pad",
  56: "trumpet",
  57: "trombone",
  58: "tuba",
  60: "french_horn",
  68: "oboe",
  70: "bassoon",
  71: "clarinet",
  73: "flute",
  24: "acoustic_guitar",
};

const PERCUSSION_CHANNEL = 9;

/**
 * Builds a renderable project straight from the untouched source tracks — no
 * arrangement, no humanization — so the UI can play "Original" through the
 * exact same MuseRenderer interface used for the arrangement.
 */
export function buildOriginalRenderableProject(
  project: MuseMidiProject,
): MuseRenderableProject {
  const notes: MuseRenderNote[] = [];
  const groupId = "original";
  let maxEndSeconds = 0;

  for (const track of project.tracks) {
    const isPercussion = track.channel === PERCUSSION_CHANNEL;
    const programNumber = track.programChanges[0]?.program ?? 0;
    const instrumentId = isPercussion
      ? "orchestral_percussion"
      : (GM_PROGRAM_TO_INSTRUMENT[programNumber] ?? "piano");

    for (const note of track.notes) {
      const startSeconds = ticksToSeconds(
        note.startTick,
        project.timeline.ticksPerQuarterNote,
        project.timeline.tempoMap,
      );
      const endSeconds = ticksToSeconds(
        note.startTick + note.durationTicks,
        project.timeline.ticksPerQuarterNote,
        project.timeline.tempoMap,
      );
      maxEndSeconds = Math.max(maxEndSeconds, endSeconds);
      notes.push({
        id: note.id,
        pitch: note.pitch,
        velocity: note.velocity,
        startTick: note.startTick,
        durationTicks: note.durationTicks,
        startSeconds,
        durationSeconds: Math.max(0.01, endSeconds - startSeconds),
        channel: note.channel,
        instrumentId,
        articulation: "sustain",
        groupId,
      });
    }
  }

  return {
    id: `${project.id}:original`,
    ticksPerQuarterNote: project.timeline.ticksPerQuarterNote,
    totalSeconds: Math.max(project.timeline.totalSeconds, maxEndSeconds) + 1.5,
    notes,
    groups: [{ id: groupId, name: "Original", family: "other" }],
  };
}
