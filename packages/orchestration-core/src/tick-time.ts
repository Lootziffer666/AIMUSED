import type { MuseTempoEvent } from "./midi-types";

/**
 * Duplicate of `@signal-app/midi-project`'s `midi/tempo-map.ts` ->
 * `ticksToSeconds`. See `midi-types.ts` for why: this is a tiny, pure,
 * dependency-free function (no `midi-file` package involved), so
 * duplicating it here — rather than depending on `@signal-app/midi-project`
 * for it and creating a cyclic workspace dependency — is the cheapest fix.
 * Keep in sync with the original if the tempo-map segment-walking logic
 * ever changes.
 */
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
