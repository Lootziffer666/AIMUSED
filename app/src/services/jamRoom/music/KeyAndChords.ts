import type { MusePerformanceNote } from "../../../entities/performance/MusePerformanceTake"

const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
]
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
]

function correlate(hist: number[], profile: number[]): number {
  const n = 12
  const meanH = hist.reduce((a, b) => a + b, 0) / n
  const meanP = profile.reduce((a, b) => a + b, 0) / n
  let num = 0
  let denH = 0
  let denP = 0
  for (let i = 0; i < n; i++) {
    const dh = hist[i] - meanH
    const dp = profile[i] - meanP
    num += dh * dp
    denH += dh * dh
    denP += dp * dp
  }
  return denH === 0 || denP === 0 ? 0 : num / Math.sqrt(denH * denP)
}

export interface DetectedKey {
  root: number // pitch class 0-11
  mode: "major" | "minor"
  score: number
}

export function detectKey(pitchClassHistogram: number[]): DetectedKey {
  let best: DetectedKey = { root: 0, mode: "major", score: -2 }
  for (let shift = 0; shift < 12; shift++) {
    const rotated = pitchClassHistogram.map(
      (_, i) => pitchClassHistogram[(i + shift) % 12],
    )
    const majScore = correlate(rotated, MAJOR_PROFILE)
    const minScore = correlate(rotated, MINOR_PROFILE)
    if (majScore > best.score)
      best = { root: shift, mode: "major", score: majScore }
    if (minScore > best.score)
      best = { root: shift, mode: "minor", score: minScore }
  }
  return best
}

export function pitchClassHistogram(notes: MusePerformanceNote[]): number[] {
  const hist = new Array<number>(12).fill(0)
  for (const n of notes) {
    hist[((n.noteNumber % 12) + 12) % 12] += n.duration
  }
  return hist
}

export interface Chord {
  rootOffset: number // scale degree of chord root relative to key
  intervals: number[]
  name: string
}

const MAJOR_KEY_CHORDS: Chord[] = [
  { rootOffset: 0, intervals: [0, 4, 7], name: "I" },
  { rootOffset: 2, intervals: [0, 3, 7], name: "ii" },
  { rootOffset: 4, intervals: [0, 3, 7], name: "iii" },
  { rootOffset: 5, intervals: [0, 4, 7], name: "IV" },
  { rootOffset: 7, intervals: [0, 4, 7], name: "V" },
  { rootOffset: 9, intervals: [0, 3, 7], name: "vi" },
]

const MINOR_KEY_CHORDS: Chord[] = [
  { rootOffset: 0, intervals: [0, 3, 7], name: "i" },
  { rootOffset: 3, intervals: [0, 4, 7], name: "III" },
  { rootOffset: 5, intervals: [0, 3, 7], name: "iv" },
  { rootOffset: 7, intervals: [0, 3, 7], name: "v" },
  { rootOffset: 8, intervals: [0, 4, 7], name: "VI" },
  { rootOffset: 10, intervals: [0, 4, 7], name: "VII" },
]

// Picks the diatonic chord with maximum pitch-class overlap
export function chooseChord(
  weights: number[],
  keyRoot: number,
  mode: "major" | "minor",
): Chord {
  const chords = mode === "major" ? MAJOR_KEY_CHORDS : MINOR_KEY_CHORDS
  let best = chords[0]
  let bestScore = -1
  for (const ch of chords) {
    const chRootPc = (keyRoot + ch.rootOffset) % 12
    let score = 0
    for (const iv of ch.intervals) {
      score += weights[(chRootPc + iv) % 12]
    }
    if (score > bestScore) {
      bestScore = score
      best = ch
    }
  }
  return best
}

export function chooseChordsPerBar(
  notes: MusePerformanceNote[],
  keyRoot: number,
  mode: "major" | "minor",
  barCount: number,
  barTicks: number,
): Chord[] {
  const chords: Chord[] = []
  for (let b = 0; b < barCount; b++) {
    const weights = new Array<number>(12).fill(0)
    for (const n of notes) {
      if (n.tick >= b * barTicks && n.tick < (b + 1) * barTicks) {
        weights[((n.noteNumber % 12) + 12) % 12] += n.duration
      }
    }
    chords.push(chooseChord(weights, keyRoot, mode))
  }
  return chords
}
