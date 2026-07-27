import { describe, expect, it } from "vitest"
import { decodeFlac, flacDecoder, isFlac, readFlacStreamInfo } from "./flac.ts"
import {
  encodeFlac,
  type FlacStereoMode,
  type FlacSubframeMode,
  quantize,
} from "./flacEncode.ts"
import { AudioDecodeError, createDefaultDecoderRegistry } from "./pcm.ts"

/**
 * FLAC is lossless, so the test is the strongest one available: encode known
 * integer samples, decode them back and require them to be identical – for
 * every subframe type and every stereo decorrelation the decoder implements.
 */

function ramp(length: number, amplitude = 1000): Int32Array {
  return Int32Array.from({ length }, (_, i) =>
    Math.round(Math.sin((i / 16) * Math.PI) * amplitude),
  )
}

function roundTrip(
  channels: Int32Array[],
  options: {
    subframe?: FlacSubframeMode
    stereo?: FlacStereoMode
    bitsPerSample?: number
    blockSize?: number
    wastedBits?: number
  } = {},
) {
  const bitsPerSample = options.bitsPerSample ?? 16
  const bytes = encodeFlac(channels, {
    sampleRate: 44100,
    bitsPerSample,
    blockSize: options.blockSize ?? 256,
    subframe: options.subframe,
    stereo: options.stereo,
    wastedBits: options.wastedBits,
  })
  const decoded = decodeFlac(bytes)
  const scale = 2 ** (bitsPerSample - 1)
  return {
    bytes,
    decoded,
    asIntegers: decoded.channels.map((channel) =>
      Int32Array.from(channel, (value) => Math.round(value * scale)),
    ),
  }
}

describe("FLAC container", () => {
  it("recognizes the marker and reads STREAMINFO", () => {
    const bytes = encodeFlac([ramp(64)], {
      sampleRate: 48000,
      bitsPerSample: 24,
      blockSize: 32,
    })
    expect(isFlac(bytes)).toBe(true)

    const { info } = readFlacStreamInfo(bytes)
    expect(info.sampleRate).toBe(48000)
    expect(info.channels).toBe(1)
    expect(info.bitsPerSample).toBe(24)
    expect(info.totalSamples).toBe(64)
    expect(info.minBlockSize).toBe(32)
  })

  it("rejects a file without the marker instead of guessing", () => {
    expect(() => readFlacStreamInfo(new Uint8Array(64))).toThrow(
      AudioDecodeError,
    )
  })

  it("is reachable through the default registry", () => {
    const registry = createDefaultDecoderRegistry()
    expect(registry.registeredFormats).toContain("flac")

    const samples = ramp(128)
    const bytes = encodeFlac([samples], {
      sampleRate: 8000,
      bitsPerSample: 16,
      blockSize: 64,
    })
    const pcm = registry.decode("flac", bytes)
    expect(pcm.sampleRate).toBe(8000)
    expect(pcm.frameCount).toBe(128)
  })
})

describe("FLAC subframe types", () => {
  it("decodes verbatim subframes bit-exactly", () => {
    const samples = ramp(300)
    const { asIntegers } = roundTrip([samples], {
      subframe: { kind: "verbatim" },
    })
    expect(Array.from(asIntegers[0])).toEqual(Array.from(samples))
  })

  it("decodes a constant subframe", () => {
    const samples = new Int32Array(200).fill(-1234)
    const { asIntegers } = roundTrip([samples], {
      subframe: { kind: "constant" },
    })
    expect(Array.from(asIntegers[0])).toEqual(Array.from(samples))
  })

  it("decodes fixed predictors of every order", () => {
    const samples = ramp(300)
    for (const order of [0, 1, 2, 3, 4] as const) {
      const { asIntegers } = roundTrip([samples], {
        subframe: { kind: "fixed", order, riceParameter: 6 },
      })
      expect(Array.from(asIntegers[0])).toEqual(Array.from(samples))
    }
  })

  it("decodes an LPC subframe including the shift", () => {
    const samples = ramp(300)
    const { asIntegers } = roundTrip([samples], {
      subframe: {
        kind: "lpc",
        coefficients: [480, -240],
        shift: 8,
        precision: 12,
        riceParameter: 7,
      },
    })
    expect(Array.from(asIntegers[0])).toEqual(Array.from(samples))
  })

  it("restores wasted bits", () => {
    // every sample a multiple of 8, i.e. three wasted low bits
    const samples = Int32Array.from(ramp(200), (value) => value * 8)
    const { asIntegers } = roundTrip([samples], {
      subframe: { kind: "verbatim" },
      wastedBits: 3,
      bitsPerSample: 20,
    })
    expect(Array.from(asIntegers[0])).toEqual(Array.from(samples))
  })
})

describe("FLAC stereo decorrelation", () => {
  const left = ramp(400, 900)
  const right = Int32Array.from(
    ramp(400, 700),
    (value, i) =>
      // deliberately not a multiple of the left channel, and odd in places
      value - (i % 3),
  )

  for (const stereo of [
    "independent",
    "left-side",
    "right-side",
    "mid-side",
  ] as const) {
    it(`round-trips ${stereo} channels`, () => {
      const { asIntegers } = roundTrip([left, right], {
        stereo,
        subframe: { kind: "verbatim" },
      })
      expect(Array.from(asIntegers[0])).toEqual(Array.from(left))
      expect(Array.from(asIntegers[1])).toEqual(Array.from(right))
    })
  }

  it("handles negative odd sides in mid/side", () => {
    const a = Int32Array.from([-5, -4, -3, 7, 9, -11, 0, 1])
    const b = Int32Array.from([2, -9, 4, -6, 8, 3, -1, 1])
    const { asIntegers } = roundTrip([a, b], {
      stereo: "mid-side",
      subframe: { kind: "verbatim" },
      blockSize: 8,
    })
    expect(Array.from(asIntegers[0])).toEqual(Array.from(a))
    expect(Array.from(asIntegers[1])).toEqual(Array.from(b))
  })
})

describe("FLAC framing", () => {
  it("stitches several blocks back together", () => {
    const samples = ramp(1000)
    const { decoded, asIntegers } = roundTrip([samples], {
      blockSize: 128,
      subframe: { kind: "fixed", order: 2, riceParameter: 6 },
    })
    expect(decoded.frameCount_decodedFrames).toBe(Math.ceil(1000 / 128))
    expect(decoded.frameCount).toBe(1000)
    expect(Array.from(asIntegers[0])).toEqual(Array.from(samples))
  })

  it("supports 8, 16 and 24 bit depths", () => {
    for (const bits of [8, 16, 24]) {
      const scale = 2 ** (bits - 1)
      const samples = Int32Array.from({ length: 128 }, (_, i) =>
        Math.round(Math.sin(i / 8) * (scale - 1) * 0.5),
      )
      const { asIntegers } = roundTrip([samples], {
        bitsPerSample: bits,
        subframe: { kind: "verbatim" },
      })
      expect(Array.from(asIntegers[0])).toEqual(Array.from(samples))
    }
  })

  it("quantizes float fixtures without clipping past full scale", () => {
    const float = Float32Array.from(
      { length: 64 },
      (_, i) => Math.sin(i / 4) * 2,
    )
    const [quantized] = quantize([float], 16)
    expect(Math.max(...quantized)).toBeLessThanOrEqual(32767)
    expect(Math.min(...quantized)).toBeGreaterThanOrEqual(-32768)

    const { asIntegers } = roundTrip([quantized], {
      subframe: { kind: "verbatim" },
    })
    expect(Array.from(asIntegers[0])).toEqual(Array.from(quantized))
  })

  it("exposes normalized floats through the decoder interface", () => {
    const bytes = encodeFlac([Int32Array.from([0, 16384, -16384, 32767])], {
      sampleRate: 8000,
      bitsPerSample: 16,
      blockSize: 4,
    })
    const pcm = flacDecoder.decode(bytes)
    expect(pcm.channels[0][0]).toBeCloseTo(0, 6)
    expect(pcm.channels[0][1]).toBeCloseTo(0.5, 6)
    expect(pcm.channels[0][2]).toBeCloseTo(-0.5, 6)
    expect(pcm.channels[0][3]).toBeCloseTo(1, 4)
  })
})
