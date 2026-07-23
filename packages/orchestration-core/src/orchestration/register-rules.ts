import type { MuseNote } from "../midi-types";
import type { MuseInstrumentDefinition } from "./types";

export interface RegisterFitResult {
  fitsAbsolute: boolean;
  fitsPreferred: boolean;
}

/** Finds the octave shift (in semitones, multiple of 12) that centers a track's mean pitch inside the instrument's preferred register. */
export function suggestOctaveShift(
  instrument: MuseInstrumentDefinition,
  meanPitch: number,
): number {
  const preferredCenter =
    (instrument.range.preferredLowMidi + instrument.range.preferredHighMidi) /
    2;
  let bestShift = 0;
  let bestDistance = Math.abs(meanPitch - preferredCenter);
  for (let shift = -36; shift <= 36; shift += 12) {
    const distance = Math.abs(meanPitch + shift - preferredCenter);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestShift = shift;
    }
  }
  return bestShift;
}

export function checkRegisterFit(
  instrument: MuseInstrumentDefinition,
  pitchRange: { low: number; high: number },
  octaveShiftSemitones: number,
): RegisterFitResult {
  const shiftedLow = pitchRange.low + octaveShiftSemitones;
  const shiftedHigh = pitchRange.high + octaveShiftSemitones;
  return {
    fitsAbsolute:
      shiftedLow >= instrument.range.lowMidi &&
      shiftedHigh <= instrument.range.highMidi,
    fitsPreferred:
      shiftedLow >= instrument.range.preferredLowMidi &&
      shiftedHigh <= instrument.range.preferredHighMidi,
  };
}

/**
 * Reduces a chord to at most `maxVoices` pitches, preserving the outer voices
 * first (soprano/bass motion carries the most perceptual weight), then
 * filling inward — a simple but musically defensible thinning strategy.
 */
export function limitChordVoices(
  pitches: number[],
  maxVoices: number,
): number[] {
  if (pitches.length <= maxVoices) return [...pitches].sort((a, b) => b - a);
  const sorted = [...pitches].sort((a, b) => b - a);
  const kept: number[] = [];
  let lo = 0;
  let hi = sorted.length - 1;
  let takeFromTop = true;
  while (kept.length < maxVoices && lo <= hi) {
    if (takeFromTop) {
      kept.push(sorted[lo]);
      lo++;
    } else {
      kept.push(sorted[hi]);
      hi--;
    }
    takeFromTop = !takeFromTop;
  }
  return kept.sort((a, b) => b - a);
}

/**
 * Converts a polyphonic note list into a single monophonic voice for
 * instruments that cannot play chords: at each attack, keeps only the
 * highest-pitched note, then truncates any note that would otherwise
 * overlap the next one (preventing stuck-note-style overlaps).
 */
export function extractTopVoice(notes: MuseNote[]): MuseNote[] {
  const byStart = new Map<number, MuseNote[]>();
  for (const note of notes) {
    const group = byStart.get(note.startTick) ?? [];
    group.push(note);
    byStart.set(note.startTick, group);
  }

  const picked = [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => group.reduce((a, b) => (b.pitch > a.pitch ? b : a)));

  for (let i = 0; i < picked.length - 1; i++) {
    const end = picked[i].startTick + picked[i].durationTicks;
    if (end > picked[i + 1].startTick) {
      picked[i] = {
        ...picked[i],
        durationTicks: Math.max(
          1,
          picked[i + 1].startTick - picked[i].startTick,
        ),
      };
    }
  }

  return picked;
}
