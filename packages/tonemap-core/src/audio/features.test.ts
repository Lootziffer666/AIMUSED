import { describe, expect, it } from "vitest"
import {
  aggregateSegment,
  DeterministicFeatureExtractor,
  detectOnsets,
} from "./features.ts"
import {
  AudioDecodeError,
  createDefaultDecoderRegistry,
  encodeWav,
  monoMix,
} from "./pcm.ts"
import { midiToHz, renderTones, syntheticMotifAudio } from "./synthetic.ts"

const extractor = new DeterministicFeatureExtractor()

describe("WAV decoding", () => {
  it("round trips through the built-in encoder and decoder", () => {
    const buffer = renderTones({
      tones: [{ startSeconds: 0, durationSeconds: 0.5, frequency: 440 }],
      durationSeconds: 0.5,
      sampleRate: 8000,
    })
    const registry = createDefaultDecoderRegistry()
    const decoded = registry.decode("wav", encodeWav(buffer))

    expect(decoded.sampleRate).toBe(8000)
    expect(decoded.frameCount).toBe(buffer.frameCount)
    for (let i = 0; i < decoded.frameCount; i += 97) {
      expect(decoded.channels[0][i]).toBeCloseTo(buffer.channels[0][i], 3)
    }
  })

  it("keeps stereo channels apart", () => {
    const buffer = renderTones({
      tones: [
        { startSeconds: 0, durationSeconds: 0.2, frequency: 440, pan: -1 },
      ],
      durationSeconds: 0.2,
      sampleRate: 8000,
      channels: 2,
    })
    const decoded = createDefaultDecoderRegistry().decode(
      "wav",
      encodeWav(buffer),
    )
    expect(decoded.channels).toHaveLength(2)
    const leftEnergy = decoded.channels[0].reduce((a, b) => a + b * b, 0)
    const rightEnergy = decoded.channels[1].reduce((a, b) => a + b * b, 0)
    expect(leftEnergy).toBeGreaterThan(rightEnergy * 4)
  })

  it("explains clearly which formats have no decoder", () => {
    const registry = createDefaultDecoderRegistry()
    expect(registry.supports("wav")).toBe(true)
    expect(registry.supports("flac")).toBe(false)
    expect(() => registry.decode("flac", new Uint8Array())).toThrow(
      AudioDecodeError,
    )
    try {
      registry.decode("flac", new Uint8Array())
    } catch (error) {
      expect((error as Error).message).toContain("no decoder registered")
      expect((error as Error).message).toContain("wav")
    }
  })

  it("rejects data that is not a RIFF file", () => {
    expect(() =>
      createDefaultDecoderRegistry().decode(
        "wav",
        new Uint8Array([1, 2, 3, 4]),
      ),
    ).toThrow(AudioDecodeError)
  })
})

describe("Deterministic feature extraction", () => {
  it("produces identical output for identical input", () => {
    const buffer = syntheticMotifAudio({ sampleRate: 11025 })
    const a = extractor.extract(buffer)
    const b = extractor.extract(buffer)
    expect(a.frames.length).toBe(b.frames.length)
    expect(a.frames.map((f) => f.rms)).toEqual(b.frames.map((f) => f.rms))
    expect(a.frames.map((f) => f.spectralCentroidHz)).toEqual(
      b.frames.map((f) => f.spectralCentroidHz),
    )
  })

  it("finds a higher spectral centroid for a brighter tone", () => {
    const dull = extractor.extract(
      renderTones({
        tones: [
          {
            startSeconds: 0,
            durationSeconds: 1,
            frequency: 220,
            brightness: 0,
          },
        ],
        durationSeconds: 1,
        sampleRate: 22050,
      }),
    )
    const bright = extractor.extract(
      renderTones({
        tones: [
          {
            startSeconds: 0,
            durationSeconds: 1,
            frequency: 220,
            brightness: 1,
          },
        ],
        durationSeconds: 1,
        sampleRate: 22050,
      }),
    )
    const centroid = (r: typeof dull) =>
      aggregateSegment(r, { startSeconds: 0.1, endSeconds: 0.9 })
        .spectralCentroidHz
    expect(centroid(bright)).toBeGreaterThan(centroid(dull) * 1.5)
  })

  it("locates the fundamental in the chroma vector", () => {
    // A4 = pitch class 9
    const result = extractor.extract(
      renderTones({
        tones: [
          { startSeconds: 0, durationSeconds: 1, frequency: midiToHz(69) },
        ],
        durationSeconds: 1,
        sampleRate: 22050,
      }),
    )
    const chroma = aggregateSegment(result, {
      startSeconds: 0.1,
      endSeconds: 0.9,
    }).chroma
    const strongest = chroma.indexOf(Math.max(...chroma))
    expect(strongest).toBe(9)
  })

  it("marks silence and reports silent regions", () => {
    const buffer = renderTones({
      tones: [{ startSeconds: 0.5, durationSeconds: 0.5, frequency: 440 }],
      durationSeconds: 1.5,
      sampleRate: 11025,
    })
    const result = extractor.extract(buffer)
    expect(result.frames.some((f) => f.isSilent)).toBe(true)
    expect(result.silenceRegions.length).toBeGreaterThan(0)
    expect(result.silenceRegions[0].startSeconds).toBeLessThan(0.5)
    const loud = aggregateSegment(result, {
      startSeconds: 0.6,
      endSeconds: 0.9,
    })
    expect(loud.silenceRatio).toBe(0)
  })

  it("detects onsets at the note starts", () => {
    const buffer = syntheticMotifAudio({ sampleRate: 22050 })
    const onsets = detectOnsets(extractor.extract(buffer))
    // notes start every 0.5 s at 120 bpm
    const expected = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
    for (const time of expected) {
      const nearest = onsets.reduce(
        (best, candidate) =>
          Math.abs(candidate - time) < Math.abs(best - time) ? candidate : best,
        Number.POSITIVE_INFINITY,
      )
      expect(Math.abs(nearest - time)).toBeLessThan(0.07)
    }
    // and it must not smear one attack into a burst of onsets
    expect(onsets.length).toBeLessThanOrEqual(expected.length * 2)
  })

  it("reports stereo width and balance", () => {
    const mono = extractor.extract(
      renderTones({
        tones: [{ startSeconds: 0, durationSeconds: 0.5, frequency: 440 }],
        durationSeconds: 0.5,
        sampleRate: 11025,
        channels: 2,
      }),
    )
    const wide = extractor.extract(
      renderTones({
        tones: [
          { startSeconds: 0, durationSeconds: 0.5, frequency: 440, pan: -1 },
          { startSeconds: 0, durationSeconds: 0.5, frequency: 660, pan: 1 },
        ],
        durationSeconds: 0.5,
        sampleRate: 11025,
        channels: 2,
      }),
    )
    const width = (r: typeof mono) =>
      aggregateSegment(r, { startSeconds: 0.05, endSeconds: 0.45 }).stereoWidth
    expect(width(mono)).toBeLessThan(width(wide))
  })

  it("aggregates an empty range without throwing", () => {
    const result = extractor.extract(syntheticMotifAudio({ sampleRate: 11025 }))
    const empty = aggregateSegment(result, {
      startSeconds: 99,
      endSeconds: 100,
    })
    expect(empty.rms).toBe(0)
    expect(empty.silenceRatio).toBe(1)
    expect(empty.chroma).toHaveLength(12)
  })

  it("mixes multi channel buffers down for analysis", () => {
    const buffer = renderTones({
      tones: [{ startSeconds: 0, durationSeconds: 0.1, frequency: 440 }],
      durationSeconds: 0.1,
      sampleRate: 8000,
      channels: 2,
    })
    expect(monoMix(buffer)).toHaveLength(buffer.frameCount)
  })
})
