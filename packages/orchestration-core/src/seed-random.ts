/**
 * Deterministic PRNG (mulberry32) used everywhere MUSE needs "randomness":
 * humanization, seeded id derivation for reproducible arrangements, etc.
 * Same seed + same inputs -> same output, always.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Maps a string to a stable 32-bit seed, so text seeds are supported too. */
export function hashStringToSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Returns a value in [min, max) using the provided PRNG. */
export function randomInRange(
  rand: () => number,
  min: number,
  max: number,
): number {
  return min + rand() * (max - min);
}
