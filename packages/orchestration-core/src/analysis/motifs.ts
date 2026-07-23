import type { MuseMidiTrack } from "../midi-types";
import { createId } from "../id";
import type { MuseCertainty, MuseMotif, MuseRoleDetection } from "./types";

const CANDIDATE_ROLES = new Set([
  "melody",
  "counterMelody",
  "bass",
  "rhythmicOstinato",
]);
const WINDOW_LENGTHS = [8, 6, 5, 4];
const MIN_NOTES = 5;

/**
 * Finds repeated pitch-interval sequences ("motifs") in melodically-led
 * tracks. Because we compare *interval* sequences rather than absolute
 * pitches, transposed repeats of the same shape are detected automatically —
 * the interval sequence of a transposed phrase is identical.
 */
export function detectMotifs(
  tracks: MuseMidiTrack[],
  rolesByTrack: Map<string, MuseRoleDetection[]>,
): MuseMotif[] {
  const motifs: MuseMotif[] = [];

  for (const track of tracks) {
    const topRole = rolesByTrack.get(track.id)?.[0]?.role;
    if (!topRole || !CANDIDATE_ROLES.has(topRole)) continue;

    const notes = [...track.notes].sort((a, b) => a.startTick - b.startTick);
    if (notes.length < MIN_NOTES) continue;

    const motif = findRepeatingMotif(notes, track.id);
    if (motif) motifs.push(motif);
  }

  return motifs;
}

function findRepeatingMotif(
  notes: { pitch: number; startTick: number; durationTicks: number }[],
  trackId: string,
): MuseMotif | null {
  const pitches = notes.map((n) => n.pitch);
  const starts = notes.map((n) => n.startTick);
  const intervals: number[] = [];
  for (let i = 1; i < pitches.length; i++)
    intervals.push(pitches[i] - pitches[i - 1]);

  for (const windowLength of WINDOW_LENGTHS) {
    if (intervals.length < windowLength) continue;

    const occurrencesByKey = new Map<string, number[]>();
    for (let i = 0; i + windowLength <= intervals.length; i++) {
      const key = intervals.slice(i, i + windowLength).join(",");
      const list = occurrencesByKey.get(key) ?? [];
      list.push(i);
      occurrencesByKey.set(key, list);
    }

    let best: { key: string; startIndexes: number[] } | null = null;
    for (const [key, startIndexes] of occurrencesByKey) {
      if (
        startIndexes.length >= 2 &&
        (!best || startIndexes.length > best.startIndexes.length)
      ) {
        best = { key, startIndexes };
      }
    }

    if (best) {
      const pitchIntervals = best.key.split(",").map(Number);
      const anchorPitch = pitches[best.startIndexes[0]];
      const occurrences = best.startIndexes.map((startNoteIndex) => {
        const endNoteIndex = Math.min(
          startNoteIndex + windowLength,
          notes.length - 1,
        );
        return {
          startTick: starts[startNoteIndex],
          endTick: starts[endNoteIndex] + notes[endNoteIndex].durationTicks,
          transposition: pitches[startNoteIndex] - anchorPitch,
        };
      });
      const certainty: MuseCertainty =
        best.startIndexes.length >= 3 ? "erkannt" : "wahrscheinlich";
      return {
        id: createId("motif"),
        sourceTrackId: trackId,
        pitchIntervals,
        anchorPitch,
        occurrences,
        certainty,
      };
    }
  }

  return null;
}
