import { createSeededRandom, randomInRange } from "../seed-random";

export interface HumanizationParams {
  timingMs: number;
  velocityRange: number;
  durationPercent: number;
}

export interface HumanizableNote {
  startTick: number;
  durationTicks: number;
  velocity: number;
}

/**
 * Applies deterministic, seeded jitter to timing/velocity/duration.
 * Same seed + same notes + same params always produce the same result —
 * humanization must never introduce unreproducible randomness.
 */
export function humanizeNotes<T extends HumanizableNote>(
  notes: T[],
  params: HumanizationParams,
  seed: number,
  ticksPerMs: number,
): T[] {
  const rand = createSeededRandom(seed);
  return notes.map((note) => {
    const timingJitterTicks =
      randomInRange(rand, -params.timingMs, params.timingMs) * ticksPerMs;
    const durationScale =
      1 +
      randomInRange(rand, -params.durationPercent, params.durationPercent) /
        100;
    const velocityJitter = randomInRange(
      rand,
      -params.velocityRange,
      params.velocityRange,
    );

    const startTick = Math.max(
      0,
      Math.round(note.startTick + timingJitterTicks),
    );
    const durationTicks = Math.max(
      1,
      Math.round(note.durationTicks * durationScale),
    );
    const velocity = Math.max(
      1,
      Math.min(127, Math.round(note.velocity + velocityJitter)),
    );

    return { ...note, startTick, durationTicks, velocity };
  });
}
