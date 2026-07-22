import type {
  MuseMidiTrack,
  MuseMusicalTimeline,
  MuseNote,
} from "../midi-types";
import type { MuseGlobalAnalysis, MuseSection } from "./types";

const PERCUSSION_CHANNEL = 9;

// Krumhansl-Schmuckler key profiles.
const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

export function computeGlobalAnalysis(
  timeline: MuseMusicalTimeline,
  tracks: MuseMidiTrack[],
  sections: MuseSection[],
  phraseBoundaryTicks: number[],
): MuseGlobalAnalysis {
  const bpms = timeline.tempoMap.map((t) => t.bpm);
  const tempoSummary = {
    minBpm: Math.min(...bpms),
    maxBpm: Math.max(...bpms),
    averageBpm: bpms.reduce((s, b) => s + b, 0) / bpms.length,
  };

  const pitchedNotes: MuseNote[] = [];
  const allNotes: MuseNote[] = [];
  for (const track of tracks) {
    allNotes.push(...track.notes);
    if (track.channel !== PERCUSSION_CHANNEL) pitchedNotes.push(...track.notes);
  }

  const pitchHistogram = new Array(12).fill(0);
  for (const note of pitchedNotes) {
    pitchHistogram[((note.pitch % 12) + 12) % 12] += note.durationTicks;
  }

  const estimatedKey = estimateKey(pitchHistogram);

  const totalSeconds = Math.max(0.001, timeline.totalSeconds);
  const rhythmicDensity = Math.min(1, allNotes.length / totalSeconds / 8);
  const dynamicDensity =
    allNotes.length > 0
      ? allNotes.reduce((s, n) => s + n.velocity, 0) / allNotes.length / 127
      : 0;

  const maxPolyphony = computeMaxPolyphony(pitchedNotes);
  const silenceRatio = computeSilenceRatio(allNotes, timeline.totalTicks);

  return {
    totalDurationSeconds: timeline.totalSeconds,
    tempoSummary,
    timeSignatures: timeline.timeSignatureMap,
    pitchHistogram,
    estimatedKey,
    rhythmicDensity,
    dynamicDensity,
    maxPolyphony,
    silenceRatio,
    phraseBoundaryTicks,
    sections,
  };
}

function estimateKey(pitchHistogram: number[]): {
  tonic: number;
  scale: "major" | "minor";
  confidence: number;
} {
  const total = pitchHistogram.reduce((s, v) => s + v, 0);
  if (total === 0) return { tonic: 0, scale: "major", confidence: 0 };

  const normalized = pitchHistogram.map((v) => v / total);
  const candidates: {
    tonic: number;
    scale: "major" | "minor";
    correlation: number;
  }[] = [];

  for (let tonic = 0; tonic < 12; tonic++) {
    candidates.push({
      tonic,
      scale: "major",
      correlation: correlate(normalized, rotate(MAJOR_PROFILE, tonic)),
    });
    candidates.push({
      tonic,
      scale: "minor",
      correlation: correlate(normalized, rotate(MINOR_PROFILE, tonic)),
    });
  }

  candidates.sort((a, b) => b.correlation - a.correlation);
  const best = candidates[0];
  const worst = candidates[candidates.length - 1];
  const range = best.correlation - worst.correlation || 1;
  const confidence = Math.max(
    0,
    Math.min(1, (best.correlation - worst.correlation) / range),
  );

  return { tonic: best.tonic, scale: best.scale, confidence };
}

function rotate(profile: number[], amount: number): number[] {
  return profile.map((_, i) => profile[(i - amount + 12) % 12]);
}

function correlate(a: number[], b: number[]): number {
  const meanA = a.reduce((s, v) => s + v, 0) / a.length;
  const meanB = b.reduce((s, v) => s + v, 0) / b.length;
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  const denom = Math.sqrt(denomA * denomB);
  return denom === 0 ? 0 : numerator / denom;
}

function computeMaxPolyphony(notes: MuseNote[]): number {
  type Boundary = { tick: number; delta: number };
  const boundaries: Boundary[] = [];
  for (const n of notes) {
    boundaries.push({ tick: n.startTick, delta: 1 });
    boundaries.push({ tick: n.startTick + n.durationTicks, delta: -1 });
  }
  boundaries.sort((a, b) => a.tick - b.tick || a.delta - b.delta);
  let active = 0;
  let max = 0;
  for (const b of boundaries) {
    active += b.delta;
    if (active > max) max = active;
  }
  return max;
}

function computeSilenceRatio(notes: MuseNote[], totalTicks: number): number {
  if (totalTicks <= 0 || notes.length === 0) return 1;
  const intervals = notes
    .map((n) => [n.startTick, n.startTick + n.durationTicks] as const)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let curStart = intervals[0][0];
  let curEnd = intervals[0][1];
  for (const [start, end] of intervals.slice(1)) {
    if (start <= curEnd) {
      curEnd = Math.max(curEnd, end);
    } else {
      covered += curEnd - curStart;
      curStart = start;
      curEnd = end;
    }
  }
  covered += curEnd - curStart;
  return Math.max(0, Math.min(1, 1 - covered / totalTicks));
}

/** Rests of at least 3/4 of a beat in the given track are treated as candidate phrase boundaries. */
export function computePhraseBoundaries(
  track: MuseMidiTrack,
  ticksPerQuarterNote: number,
): number[] {
  const notes = [...track.notes].sort((a, b) => a.startTick - b.startTick);
  const restThreshold = ticksPerQuarterNote * 0.75;
  const boundaries: number[] = [];
  for (let i = 1; i < notes.length; i++) {
    const prevEnd = notes[i - 1].startTick + notes[i - 1].durationTicks;
    const gap = notes[i].startTick - prevEnd;
    if (gap >= restThreshold) boundaries.push(prevEnd);
  }
  return boundaries;
}
