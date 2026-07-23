import type { MuseTempoEvent } from "./types";

export const DEFAULT_MICROSECONDS_PER_BEAT = 500000; // 120 BPM

export function bpmFromMicrosecondsPerBeat(
  microsecondsPerBeat: number,
): number {
  return 60_000_000 / microsecondsPerBeat;
}

/**
 * Builds a sorted, deduplicated tempo map that always starts at tick 0,
 * defaulting to 120 BPM if the file contains no explicit tempo event.
 */
export function buildTempoMap(
  rawEvents: { tick: number; microsecondsPerBeat: number }[],
): MuseTempoEvent[] {
  const sorted = [...rawEvents].sort((a, b) => a.tick - b.tick);
  const withStart: { tick: number; microsecondsPerBeat: number }[] =
    sorted.length > 0 && sorted[0].tick === 0
      ? sorted
      : [
          {
            tick: 0,
            microsecondsPerBeat:
              sorted[0]?.microsecondsPerBeat ?? DEFAULT_MICROSECONDS_PER_BEAT,
          },
          ...sorted,
        ];

  const deduped: MuseTempoEvent[] = [];
  for (const ev of withStart) {
    const bpm = bpmFromMicrosecondsPerBeat(ev.microsecondsPerBeat);
    if (deduped.length > 0 && deduped[deduped.length - 1].tick === ev.tick) {
      deduped[deduped.length - 1] = {
        tick: ev.tick,
        microsecondsPerBeat: ev.microsecondsPerBeat,
        bpm,
      };
    } else {
      deduped.push({
        tick: ev.tick,
        microsecondsPerBeat: ev.microsecondsPerBeat,
        bpm,
      });
    }
  }
  return deduped;
}

/** Converts an absolute tick position into seconds, walking the tempo map's segments. */
export function ticksToSeconds(
  tick: number,
  ticksPerQuarterNote: number,
  tempoMap: MuseTempoEvent[],
): number {
  if (tick <= 0) return 0;
  let seconds = 0;
  for (let i = 0; i < tempoMap.length; i++) {
    const segStart = tempoMap[i].tick;
    const segEnd = i + 1 < tempoMap.length ? tempoMap[i + 1].tick : Infinity;
    if (tick <= segStart) break;
    const effectiveEnd = Math.min(tick, segEnd);
    const ticksInSegment = effectiveEnd - segStart;
    seconds +=
      (ticksInSegment / ticksPerQuarterNote) *
      (tempoMap[i].microsecondsPerBeat / 1_000_000);
    if (tick <= segEnd) break;
  }
  return seconds;
}

/** Inverse of ticksToSeconds — used for scrubbing/seek by time. */
export function secondsToTicks(
  seconds: number,
  ticksPerQuarterNote: number,
  tempoMap: MuseTempoEvent[],
): number {
  if (seconds <= 0) return 0;
  let remaining = seconds;
  for (let i = 0; i < tempoMap.length; i++) {
    const segStart = tempoMap[i].tick;
    const segEnd = i + 1 < tempoMap.length ? tempoMap[i + 1].tick : Infinity;
    const segSeconds =
      segEnd === Infinity
        ? Infinity
        : ((segEnd - segStart) / ticksPerQuarterNote) *
          (tempoMap[i].microsecondsPerBeat / 1_000_000);
    if (remaining <= segSeconds) {
      const ticksInSegment =
        (remaining / (tempoMap[i].microsecondsPerBeat / 1_000_000)) *
        ticksPerQuarterNote;
      return segStart + ticksInSegment;
    }
    remaining -= segSeconds;
  }
  return tempoMap[tempoMap.length - 1]?.tick ?? 0;
}
