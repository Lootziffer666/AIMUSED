import { describe, expect, it } from "vitest"
import { DeterministicFeatureExtractor } from "../audio/features.ts"
import { syntheticMotifAudio } from "../audio/synthetic.ts"
import { midiToGraph } from "../midi/eventGraph.ts"
import { syntheticMotifMidi } from "../midi/synthetic.ts"
import {
  alignMidiToAudio,
  alignSecondsToTick,
  alignTickToSeconds,
  estimateGlobalOffset,
  LOW_CONFIDENCE,
  midiOnsetSeconds,
  withManualAnchor,
} from "./alignment.ts"

const extractor = new DeterministicFeatureExtractor()
const graph = midiToGraph(syntheticMotifMidi())

function featuresFor(options: { leadingSilenceSeconds?: number } = {}) {
  return extractor.extract(
    syntheticMotifAudio({ sampleRate: 22050, ...options }),
  )
}

describe("Global offset estimation", () => {
  it("finds a zero offset for identical onset lists", () => {
    const midi = [0, 0.5, 1, 1.5]
    const estimate = estimateGlobalOffset(midi, midi)
    expect(estimate.offsetSeconds).toBeCloseTo(0, 2)
    expect(estimate.score).toBe(1)
  })

  it("finds a shifted offset", () => {
    const midi = [0, 0.5, 1, 1.5]
    const audio = midi.map((t) => t + 1.25)
    const estimate = estimateGlobalOffset(midi, audio)
    expect(estimate.offsetSeconds).toBeCloseTo(1.25, 2)
    expect(estimate.score).toBe(1)
  })

  it("reports a low score when nothing matches", () => {
    const estimate = estimateGlobalOffset([0, 0.5], [], { maxOffsetSeconds: 2 })
    expect(estimate.score).toBe(0)
  })
})

describe("Alignment of synthetic MIDI and audio", () => {
  it("aligns an identical pair with high confidence", () => {
    const map = alignMidiToAudio(graph, featuresFor())
    // stage 1 works on frame-quantized onsets, so it claims solid but not
    // perfect confidence even for an identical pair
    expect(map.globalConfidence).toBeGreaterThan(0.55)
    expect(map.globalConfidence).toBeGreaterThan(LOW_CONFIDENCE)
    expect(map.points.length).toBeGreaterThan(2)
    expect(map.points[0].audioTimeSeconds).toBeCloseTo(0, 1)
    expect(map.problematicRegions).toHaveLength(0)
  })

  it("recovers a leading silence as an offset", () => {
    const map = alignMidiToAudio(
      graph,
      featuresFor({ leadingSilenceSeconds: 1.5 }),
    )
    // frame based onset detection is accurate to about two analysis frames
    expect(Math.abs(map.points[0].audioTimeSeconds - 1.5)).toBeLessThan(0.1)
    expect(map.method).toBe("onset-correlation")
    expect(map.unmatchedAudioRegions[0]?.endSeconds).toBeCloseTo(1.5, 1)
  })

  it("uses a known offset from the manifest when given", () => {
    const map = alignMidiToAudio(graph, featuresFor(), { knownOffsetMs: 500 })
    expect(map.method).toBe("known-offset")
    expect(map.points[0].audioTimeSeconds).toBeCloseTo(0.5, 3)
  })

  it("maps ticks to seconds and back", () => {
    const map = alignMidiToAudio(
      graph,
      featuresFor({ leadingSilenceSeconds: 0.5 }),
    )
    const tick = graph.ticksPerQuarterNote * 4
    const seconds = alignTickToSeconds(map, tick)
    // 4 beats at 120 bpm + 0.5 s offset, within the frame accuracy
    expect(Math.abs(seconds - 2.5)).toBeLessThan(0.1)
    expect(alignSecondsToTick(map, seconds)).toBeCloseTo(tick, 0)
  })

  it("keeps low confidence visible instead of pretending", () => {
    const silence = extractor.extract({
      sampleRate: 22050,
      channels: [new Float32Array(22050 * 4)],
      frameCount: 22050 * 4,
    })
    const map = alignMidiToAudio(graph, silence)
    expect(map.globalConfidence).toBeLessThan(LOW_CONFIDENCE)
    expect(map.problematicRegions.length).toBeGreaterThan(0)
    expect(map.problematicRegions[0].reason).toContain("guess")
  })

  it("reports audio that reaches beyond the MIDI as unmatched", () => {
    const longer = extractor.extract(
      syntheticMotifAudio({ sampleRate: 22050, leadingSilenceSeconds: 0 }),
    )
    const shortGraph = midiToGraph(syntheticMotifMidi())
    const map = alignMidiToAudio(shortGraph, {
      ...longer,
      durationSeconds: longer.durationSeconds + 3,
    })
    expect(
      map.unmatchedAudioRegions.some((region) => region.startSeconds > 3),
    ).toBe(true)
  })
})

describe("Manual anchors", () => {
  it("takes precedence over the automatic estimate", () => {
    const map = alignMidiToAudio(graph, featuresFor(), {
      manualAnchors: [
        {
          midiTick: 0,
          midiBeat: 0,
          audioTimeSeconds: 2,
          confidence: 1,
          method: "manual-anchor",
        },
      ],
    })
    expect(map.method).toBe("manual-anchor")
    expect(alignTickToSeconds(map, 0)).toBeCloseTo(2, 3)
  })

  it("can be added afterwards and survives re-fitting", () => {
    const map = alignMidiToAudio(graph, featuresFor())
    const corrected = withManualAnchor(map, {
      midiTick: graph.ticksPerQuarterNote * 4,
      midiBeat: 4,
      audioTimeSeconds: 2.4,
      confidence: 1,
    })
    const anchor = corrected.points.find(
      (point) => point.midiTick === graph.ticksPerQuarterNote * 4,
    )
    expect(anchor?.manual).toBe(true)
    expect(anchor?.audioTimeSeconds).toBe(2.4)
    expect(
      alignTickToSeconds(corrected, graph.ticksPerQuarterNote * 4),
    ).toBeCloseTo(2.4, 3)
    expect(corrected.globalConfidence).toBeGreaterThanOrEqual(
      map.globalConfidence,
    )
  })

  it("keeps one anchor per tick", () => {
    const map = alignMidiToAudio(graph, featuresFor())
    const once = withManualAnchor(map, {
      midiTick: 0,
      midiBeat: 0,
      audioTimeSeconds: 1,
      confidence: 1,
    })
    const twice = withManualAnchor(once, {
      midiTick: 0,
      midiBeat: 0,
      audioTimeSeconds: 1.2,
      confidence: 1,
    })
    expect(twice.points.filter((point) => point.midiTick === 0)).toHaveLength(1)
    expect(twice.points[0].audioTimeSeconds).toBe(1.2)
  })
})

describe("MIDI onsets", () => {
  it("collapses a chord into one onset", () => {
    const onsets = midiOnsetSeconds(graph)
    // melody and bass start together on every beat
    expect(onsets.length).toBeLessThan(graph.notes.length)
    expect(onsets[0]).toBeCloseTo(0, 5)
  })
})
