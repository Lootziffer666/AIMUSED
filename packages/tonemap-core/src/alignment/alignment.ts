import type { AudioFeatureResult } from "../audio/features.ts"
import { detectOnsets } from "../audio/features.ts"
import type { MidiGraph } from "../midi/eventGraph.ts"
import { tickToSeconds, totalTicks } from "../midi/eventGraph.ts"

/**
 * MIDI ⇄ audio alignment.
 *
 * Stage 1 (implemented): a global offset found by correlating the MIDI note
 * onsets with the audio onsets, refined per anchor, honouring a known offset
 * from the manifest and any anchor a human placed by hand.
 *
 * Stage 2 (prepared, not implemented): piecewise alignment / DTW for drifting
 * tempi. `AlignmentMap.segments` and `problematicRegions` already carry the
 * shape those results need, and `alignSeconds` interpolates between anchors,
 * so a better estimator only has to produce more anchor points.
 *
 * Low confidence is never dressed up as certainty: everything below
 * `LOW_CONFIDENCE` is reported as a problematic region.
 */

export const LOW_CONFIDENCE = 0.45

export interface AlignmentPoint {
  midiTick: number
  midiBeat: number
  audioTimeSeconds: number
  confidence: number
  method: string
  /** Manual anchors are never overwritten by an automatic pass */
  manual?: boolean
}

export interface AlignmentSegment {
  startTick: number
  endTick: number
  /** seconds = offset + tick * scale (scale in seconds per tick) */
  offsetSeconds: number
  scale: number
  confidence: number
}

export interface ProblematicRegion {
  startTick: number
  endTick: number
  reason: string
  confidence: number
}

export interface AlignmentMap {
  sourcePairId?: string
  method: string
  globalConfidence: number
  points: AlignmentPoint[]
  segments: AlignmentSegment[]
  problematicRegions: ProblematicRegion[]
  /** Regions of audio with no MIDI counterpart (e.g. a longer intro) */
  unmatchedAudioRegions: { startSeconds: number; endSeconds: number }[]
  createdAt: string
}

export interface AlignOptions {
  /** From the paired-source manifest, in milliseconds */
  knownOffsetMs?: number | null
  manualAnchors?: AlignmentPoint[]
  /** Maximum offset the search considers, in seconds */
  maxOffsetSeconds?: number
  sourcePairId?: string
  now?: string
}

/** MIDI note starts in seconds, deduplicated to chord level. */
export function midiOnsetSeconds(graph: MidiGraph): number[] {
  const ticks = [...new Set(graph.notes.map((note) => note.startTick))].sort(
    (a, b) => a - b,
  )
  return ticks.map((tick) => tickToSeconds(graph, tick))
}

function beatOf(graph: MidiGraph, tick: number): number {
  return tick / graph.ticksPerQuarterNote
}

/**
 * Cross-correlates two onset lists over candidate offsets.
 * Returns the offset in seconds and a 0..1 score.
 */
export function estimateGlobalOffset(
  midiOnsets: number[],
  audioOnsets: number[],
  options: { maxOffsetSeconds?: number; toleranceSeconds?: number } = {},
): { offsetSeconds: number; score: number } {
  if (midiOnsets.length === 0 || audioOnsets.length === 0) {
    return { offsetSeconds: 0, score: 0 }
  }
  const maxOffset = options.maxOffsetSeconds ?? 10
  const tolerance = options.toleranceSeconds ?? 0.06
  // The score peak is only as wide as the tolerance window, so the search
  // grid has to be clearly finer than the tolerance or it steps over it.
  const step = tolerance / 8

  const nearest = (target: number): number | null => {
    let best: number | null = null
    for (const candidate of audioOnsets) {
      if (
        best === null ||
        Math.abs(candidate - target) < Math.abs(best - target)
      ) {
        best = candidate
      }
    }
    return best
  }

  // Distance weighted score: a plateau of "equally good" offsets is the
  // classic failure mode on periodic music, so every MIDI onset contributes
  // 1 at a perfect hit and 0 at the tolerance edge instead of a flat 1.
  const scoreAt = (
    offset: number,
  ): { score: number; matched: number; residual: number } => {
    let score = 0
    let matched = 0
    let residual = 0
    for (const midiTime of midiOnsets) {
      const target = midiTime + offset
      const hit = nearest(target)
      if (hit === null) continue
      const delta = hit - target
      if (Math.abs(delta) > tolerance) continue
      score += 1 - Math.abs(delta) / tolerance
      residual += delta
      matched++
    }
    return {
      score: score / midiOnsets.length,
      matched,
      residual: matched > 0 ? residual / matched : 0,
    }
  }

  let best = { offsetSeconds: 0, score: 0, matched: 0, residual: 0 }
  for (let offset = -maxOffset; offset <= maxOffset; offset += step) {
    const evaluated = scoreAt(offset)
    const better =
      evaluated.score > best.score + 1e-9 ||
      // exact ties go to the smaller shift: the least assumption that fits
      (Math.abs(evaluated.score - best.score) <= 1e-9 &&
        Math.abs(offset) < Math.abs(best.offsetSeconds))
    if (better) best = { offsetSeconds: offset, ...evaluated }
  }
  if (best.matched === 0) return { offsetSeconds: 0, score: 0 }

  // correct by the mean residual of the matched pairs, twice: the first
  // correction can pull additional onsets into the tolerance window
  let refined = best.offsetSeconds
  let verified = scoreAt(refined)
  for (let pass = 0; pass < 3; pass++) {
    const next = refined + verified.residual
    const evaluated = scoreAt(next)
    if (evaluated.score < verified.score - 1e-9) break
    refined = next
    verified = evaluated
    if (Math.abs(verified.residual) < 1e-4) break
  }
  const matchedFraction = verified.matched / midiOnsets.length

  return {
    offsetSeconds: Number(refined.toFixed(6)),
    score: Number(Math.min(1, matchedFraction).toFixed(4)),
  }
}

/**
 * Stage 1 alignment: tempo map + global offset, verified per anchor against
 * the audio onsets, with manual anchors taking precedence.
 */
export function alignMidiToAudio(
  graph: MidiGraph,
  features: AudioFeatureResult,
  options: AlignOptions = {},
): AlignmentMap {
  const now = options.now ?? new Date().toISOString()
  const audioOnsets = detectOnsets(features)
  const midiOnsets = midiOnsetSeconds(graph)
  const manual = (options.manualAnchors ?? []).map((point) => ({
    ...point,
    manual: true,
    method: point.method || "manual-anchor",
  }))

  const knownOffsetSeconds =
    typeof options.knownOffsetMs === "number"
      ? options.knownOffsetMs / 1000
      : null

  let offsetSeconds: number
  let score: number
  let method: string

  if (manual.length > 0) {
    // Anchors win: derive the offset from the first one
    const anchor = manual[0]
    offsetSeconds =
      anchor.audioTimeSeconds - tickToSeconds(graph, anchor.midiTick)
    score = Math.max(anchor.confidence, 0.9)
    method = "manual-anchor"
  } else if (knownOffsetSeconds !== null) {
    offsetSeconds = knownOffsetSeconds
    score = 0.8
    method = "known-offset"
  } else {
    const estimate = estimateGlobalOffset(midiOnsets, audioOnsets, {
      maxOffsetSeconds: options.maxOffsetSeconds,
    })
    offsetSeconds = estimate.offsetSeconds
    score = estimate.score
    method = "onset-correlation"
  }

  const end = totalTicks(graph)
  const points: AlignmentPoint[] = []
  const seenTicks = new Set<number>()

  for (const anchor of manual) {
    points.push(anchor)
    seenTicks.add(anchor.midiTick)
  }

  // one anchor per bar-ish grid: every 4 beats, plus the ends
  const stride = graph.ticksPerQuarterNote * 4
  const candidateTicks = [0]
  for (let tick = stride; tick < end; tick += stride) candidateTicks.push(tick)
  candidateTicks.push(end)

  const firstOnset = audioOnsets[0]
  const lastOnset = audioOnsets[audioOnsets.length - 1]

  for (const tick of candidateTicks) {
    if (seenTicks.has(tick)) continue
    const expected = tickToSeconds(graph, tick) + offsetSeconds
    const nearest = nearestOnset(audioOnsets, expected)
    const distance =
      nearest === null ? Number.POSITIVE_INFINITY : Math.abs(nearest - expected)
    // An anchor past the last (or before the first) onset is extrapolated
    // from the fit, not measured. That is less certain, but it is not
    // evidence of a *wrong* alignment – only a missing local check.
    const extrapolated =
      audioOnsets.length === 0 ||
      expected > lastOnset + 0.25 ||
      expected < firstOnset - 0.25
    const localConfidence = extrapolated
      ? score * 0.7
      : clamp01(score * (1 - Math.min(1, distance / 0.25)))
    points.push({
      midiTick: tick,
      midiBeat: beatOf(graph, tick),
      audioTimeSeconds: Number(expected.toFixed(6)),
      confidence: Number(localConfidence.toFixed(4)),
      method: extrapolated ? `${method}+extrapolated` : method,
    })
  }

  points.sort((a, b) => a.midiTick - b.midiTick)

  const segments = buildSegments(points)
  const problematicRegions: ProblematicRegion[] = []
  for (const segment of segments) {
    if (segment.confidence < LOW_CONFIDENCE) {
      problematicRegions.push({
        startTick: segment.startTick,
        endTick: segment.endTick,
        reason:
          "few or no matching audio onsets in this region – alignment is a guess",
        confidence: segment.confidence,
      })
    }
  }

  const globalConfidence = points.length
    ? clamp01(points.reduce((sum, p) => sum + p.confidence, 0) / points.length)
    : 0

  return {
    sourcePairId: options.sourcePairId,
    method,
    globalConfidence: Number(globalConfidence.toFixed(4)),
    points,
    segments,
    problematicRegions,
    unmatchedAudioRegions: unmatchedAudio(features, graph, offsetSeconds),
    createdAt: now,
  }
}

function nearestOnset(onsets: number[], target: number): number | null {
  if (onsets.length === 0) return null
  let best = onsets[0]
  for (const onset of onsets) {
    if (Math.abs(onset - target) < Math.abs(best - target)) best = onset
  }
  return best
}

function buildSegments(points: AlignmentPoint[]): AlignmentSegment[] {
  const segments: AlignmentSegment[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const tickSpan = b.midiTick - a.midiTick
    if (tickSpan <= 0) continue
    const scale = (b.audioTimeSeconds - a.audioTimeSeconds) / tickSpan
    segments.push({
      startTick: a.midiTick,
      endTick: b.midiTick,
      offsetSeconds: a.audioTimeSeconds - a.midiTick * scale,
      scale,
      confidence: Math.min(a.confidence, b.confidence),
    })
  }
  return segments
}

function unmatchedAudio(
  features: AudioFeatureResult,
  graph: MidiGraph,
  offsetSeconds: number,
): { startSeconds: number; endSeconds: number }[] {
  const midiStart = offsetSeconds
  const midiEnd = tickToSeconds(graph, totalTicks(graph)) + offsetSeconds
  const regions: { startSeconds: number; endSeconds: number }[] = []
  if (midiStart > 0.25) regions.push({ startSeconds: 0, endSeconds: midiStart })
  if (features.durationSeconds > midiEnd + 0.25) {
    regions.push({
      startSeconds: midiEnd,
      endSeconds: features.durationSeconds,
    })
  }
  return regions
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Maps a MIDI tick to audio seconds by interpolating between anchors. */
export function alignTickToSeconds(map: AlignmentMap, tick: number): number {
  if (map.segments.length === 0) {
    const point = map.points[0]
    return point ? point.audioTimeSeconds : 0
  }
  const segment =
    map.segments.find((s) => tick >= s.startTick && tick <= s.endTick) ??
    (tick < map.segments[0].startTick
      ? map.segments[0]
      : map.segments[map.segments.length - 1])
  return segment.offsetSeconds + tick * segment.scale
}

/** Inverse of `alignTickToSeconds`. */
export function alignSecondsToTick(map: AlignmentMap, seconds: number): number {
  for (const segment of map.segments) {
    const start = segment.offsetSeconds + segment.startTick * segment.scale
    const end = segment.offsetSeconds + segment.endTick * segment.scale
    if (seconds >= start && seconds <= end && segment.scale !== 0) {
      return (seconds - segment.offsetSeconds) / segment.scale
    }
  }
  const last = map.segments[map.segments.length - 1]
  if (!last || last.scale === 0) return 0
  return (seconds - last.offsetSeconds) / last.scale
}

/**
 * Adds or replaces a manual anchor and recomputes the interpolation.
 * Automatic points between two manual anchors are re-fitted, manual ones are
 * never touched.
 */
export function withManualAnchor(
  map: AlignmentMap,
  anchor: Omit<AlignmentPoint, "manual" | "method"> & { method?: string },
): AlignmentMap {
  const point: AlignmentPoint = {
    ...anchor,
    manual: true,
    method: anchor.method ?? "manual-anchor",
    confidence: Math.max(anchor.confidence, 0.95),
  }
  const points = map.points
    .filter((existing) => existing.midiTick !== point.midiTick)
    .concat(point)
    .sort((a, b) => a.midiTick - b.midiTick)

  const segments = buildSegments(points)
  const problematicRegions = map.problematicRegions.filter(
    (region) =>
      point.midiTick < region.startTick || point.midiTick > region.endTick,
  )
  const globalConfidence = clamp01(
    points.reduce((sum, p) => sum + p.confidence, 0) / points.length,
  )

  return {
    ...map,
    points,
    segments,
    problematicRegions,
    globalConfidence: Number(globalConfidence.toFixed(4)),
    method:
      map.method === "manual-anchor" ? map.method : `${map.method}+manual`,
  }
}
