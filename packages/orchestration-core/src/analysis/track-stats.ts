import type { MuseMidiTrack } from "../midi-types";

export interface MuseTrackRawStats {
  trackId: string;
  name: string | null;
  channel: number;
  noteCount: number;
  pitchRange: { low: number; high: number };
  meanPitch: number;
  spanTicks: number;
  noteDensity: number;
  polyphony: number;
  overlapFraction: number;
  isMonophonic: boolean;
  rhythmicActivity: number;
  averageVelocity: number;
  longNoteRatio: number;
  shortNoteRatio: number;
  repetitionScore: number;
  onBeatRatio: number;
}

const LONG_NOTE_BEATS = 0.9;
const SHORT_NOTE_BEATS = 0.4;
const ON_BEAT_TOLERANCE_BEATS = 0.06;
const NGRAM_SIZE = 4;

export function computeTrackStats(
  track: MuseMidiTrack,
  ticksPerQuarterNote: number,
): MuseTrackRawStats {
  const notes = [...track.notes].sort((a, b) => a.startTick - b.startTick);
  const noteCount = notes.length;

  if (noteCount === 0) {
    return {
      trackId: track.id,
      name: track.name,
      channel: track.channel,
      noteCount: 0,
      pitchRange: { low: 0, high: 0 },
      meanPitch: 0,
      spanTicks: 0,
      noteDensity: 0,
      polyphony: 0,
      overlapFraction: 0,
      isMonophonic: true,
      rhythmicActivity: 0,
      averageVelocity: 0,
      longNoteRatio: 0,
      shortNoteRatio: 0,
      repetitionScore: 0,
      onBeatRatio: 0,
    };
  }

  const low = Math.min(...notes.map((n) => n.pitch));
  const high = Math.max(...notes.map((n) => n.pitch));
  const meanPitch = notes.reduce((s, n) => s + n.pitch, 0) / noteCount;
  const averageVelocity = notes.reduce((s, n) => s + n.velocity, 0) / noteCount;

  const firstStart = notes[0].startTick;
  const lastEnd = Math.max(...notes.map((n) => n.startTick + n.durationTicks));
  const spanTicks = Math.max(1, lastEnd - firstStart);
  const spanBeats = spanTicks / ticksPerQuarterNote;
  const noteDensity = noteCount / spanBeats;

  const { polyphony, overlapFraction } = computePolyphony(notes);
  const isMonophonic = polyphony <= 1 || overlapFraction < 0.05;

  const rhythmicActivity = computeRhythmicActivity(
    notes,
    ticksPerQuarterNote,
    firstStart,
    lastEnd,
  );

  const longThreshold = LONG_NOTE_BEATS * ticksPerQuarterNote;
  const shortThreshold = SHORT_NOTE_BEATS * ticksPerQuarterNote;
  const longNoteRatio =
    notes.filter((n) => n.durationTicks >= longThreshold).length / noteCount;
  const shortNoteRatio =
    notes.filter((n) => n.durationTicks <= shortThreshold).length / noteCount;

  const onBeatTolerance = ON_BEAT_TOLERANCE_BEATS * ticksPerQuarterNote;
  const onBeatCount = notes.filter((n) => {
    const posInBeat = n.startTick % ticksPerQuarterNote;
    return (
      posInBeat <= onBeatTolerance ||
      ticksPerQuarterNote - posInBeat <= onBeatTolerance
    );
  }).length;
  const onBeatRatio = onBeatCount / noteCount;

  const repetitionScore = computeRepetitionScore(notes.map((n) => n.pitch));

  return {
    trackId: track.id,
    name: track.name,
    channel: track.channel,
    noteCount,
    pitchRange: { low, high },
    meanPitch,
    spanTicks,
    noteDensity,
    polyphony,
    overlapFraction,
    isMonophonic,
    rhythmicActivity,
    averageVelocity,
    longNoteRatio,
    shortNoteRatio,
    repetitionScore,
    onBeatRatio,
  };
}

function computePolyphony(
  notes: { startTick: number; durationTicks: number }[],
): { polyphony: number; overlapFraction: number } {
  type Boundary = { tick: number; delta: number; isEnd: boolean };
  const boundaries: Boundary[] = [];
  for (const n of notes) {
    boundaries.push({ tick: n.startTick, delta: 1, isEnd: false });
    boundaries.push({
      tick: n.startTick + n.durationTicks,
      delta: -1,
      isEnd: true,
    });
  }
  boundaries.sort(
    (a, b) => a.tick - b.tick || (a.isEnd === b.isEnd ? 0 : a.isEnd ? -1 : 1),
  );

  let active = 0;
  let maxActive = 0;
  let overlapTicks = 0;
  let prevTick = boundaries.length > 0 ? boundaries[0].tick : 0;
  for (const b of boundaries) {
    if (active >= 2) overlapTicks += Math.max(0, b.tick - prevTick);
    active += b.delta;
    if (active > maxActive) maxActive = active;
    prevTick = b.tick;
  }
  const totalDuration = notes.reduce((s, n) => s + n.durationTicks, 0) || 1;
  return {
    polyphony: maxActive,
    overlapFraction: overlapTicks / totalDuration,
  };
}

function computeRhythmicActivity(
  notes: { startTick: number }[],
  ticksPerQuarterNote: number,
  firstStart: number,
  lastEnd: number,
): number {
  const gridSize = ticksPerQuarterNote / 4; // sixteenth-note grid
  const totalSlots = Math.max(1, Math.round((lastEnd - firstStart) / gridSize));
  const occupied = new Set<number>();
  for (const n of notes) {
    occupied.add(Math.round((n.startTick - firstStart) / gridSize));
  }
  return Math.min(1, occupied.size / totalSlots);
}

function computeRepetitionScore(pitches: number[]): number {
  if (pitches.length < NGRAM_SIZE + 1) return 0;
  const intervals: number[] = [];
  for (let i = 1; i < pitches.length; i++)
    intervals.push(pitches[i] - pitches[i - 1]);

  const grams = new Map<string, number>();
  for (let i = 0; i + NGRAM_SIZE <= intervals.length; i++) {
    const key = intervals.slice(i, i + NGRAM_SIZE).join(",");
    grams.set(key, (grams.get(key) ?? 0) + 1);
  }
  const totalGrams = grams.size;
  if (totalGrams === 0) return 0;
  const repeated = [...grams.values()].filter((count) => count > 1).length;
  return repeated / totalGrams;
}
