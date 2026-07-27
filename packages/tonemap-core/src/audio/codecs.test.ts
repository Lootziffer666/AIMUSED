import lame from "@breezystack/lamejs"
import { describe, expect, it } from "vitest"
import {
  LOSSY_DECODERS,
  mp3Decoder,
  oggVorbisDecoder,
  registerLossyDecoders,
} from "./codecs.ts"
import { DeterministicFeatureExtractor } from "./features.ts"
import {
  AudioDecodeError,
  createDefaultDecoderRegistry,
  monoMix,
} from "./pcm.ts"

/**
 * MP3 is verified end to end: encode a known tone with an encoder that is not
 * the decoder, decode it back, and check that the sample rate, the length and
 * the dominant frequency survive. Vorbis has no pure-JS encoder available, so
 * only its wiring and its failure behaviour are covered here – the decoding
 * itself is the reference implementation's.
 */

function encodeMp3(frequency: number, seconds: number, sampleRate = 44100) {
  const encoder = new lame.Mp3Encoder(1, sampleRate, 128)
  const length = Math.round(sampleRate * seconds)
  const samples = new Int16Array(length)
  for (let i = 0; i < length; i++) {
    samples[i] = Math.round(
      Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 20000,
    )
  }
  const chunks: Uint8Array[] = []
  for (let i = 0; i < length; i += 1152) {
    const chunk = encoder.encodeBuffer(samples.subarray(i, i + 1152))
    if (chunk.length > 0) chunks.push(chunk)
  }
  const tail = encoder.flush()
  if (tail.length > 0) chunks.push(tail)

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

/** Dominant bin of the mean magnitude spectrum, in Hz. */
function dominantFrequency(
  channels: Float32Array[],
  sampleRate: number,
): number {
  const result = new DeterministicFeatureExtractor().extract(
    { sampleRate, channels, frameCount: channels[0].length },
    { frameSize: 4096, hopSize: 2048 },
  )
  // the strongest chroma bin is enough: a 440 Hz tone has to land on A
  const chroma = new Array(12).fill(0)
  for (const frame of result.frames) {
    frame.chroma.forEach((value, index) => {
      chroma[index] += value
    })
  }
  const best = chroma.indexOf(Math.max(...chroma))
  return best
}

describe("lossy decoder registration", () => {
  it("is not part of the default registry", () => {
    const registry = createDefaultDecoderRegistry()
    expect(registry.registeredFormats).toEqual(["flac", "wav", "wave"])
    expect(registry.supports("mp3")).toBe(false)
  })

  it("registers mp3 and ogg on request", () => {
    const registry = createDefaultDecoderRegistry()
    registerLossyDecoders(registry)
    expect(registry.supports("mp3")).toBe(true)
    expect(registry.supports("ogg")).toBe(true)
    expect(LOSSY_DECODERS).toHaveLength(2)
  })

  it("refuses to be used from synchronous code", () => {
    const registry = createDefaultDecoderRegistry()
    registerLossyDecoders(registry)
    const bytes = encodeMp3(440, 0.1)
    expect(() => registry.decode("mp3", bytes)).toThrow(/asynchronous/)
  })

  it("names the registered formats when one is missing", () => {
    const registry = createDefaultDecoderRegistry()
    expect(() => registry.decode("aiff", new Uint8Array(4))).toThrow(
      /Registered: flac, wav, wave/,
    )
  })
})

describe("mp3Decoder", () => {
  it("decodes a tone back to the right rate, length and pitch", async () => {
    const bytes = encodeMp3(440, 1)
    const pcm = await mp3Decoder.decode(bytes)

    expect(pcm.sampleRate).toBe(44100)
    // MP3 adds encoder and decoder delay, so the length is close, not equal
    expect(pcm.frameCount).toBeGreaterThan(44100 * 0.95)
    expect(pcm.frameCount).toBeLessThan(44100 * 1.15)

    // 440 Hz is A, pitch class 9
    expect(dominantFrequency([monoMix(pcm)], pcm.sampleRate)).toBe(9)
  })

  it("survives a stereo stream and keeps the channels apart", async () => {
    const bytes = encodeMp3(220, 0.5)
    const pcm = await mp3Decoder.decode(bytes)
    expect(pcm.channels.length).toBeGreaterThanOrEqual(1)
    for (const channel of pcm.channels) {
      expect(channel.length).toBe(pcm.frameCount)
    }
  })

  it("reports an unusable stream instead of returning silence", async () => {
    await expect(mp3Decoder.decode(new Uint8Array(2048))).rejects.toThrow(
      AudioDecodeError,
    )
  })

  it("goes through the registry as an async decoder", async () => {
    const registry = createDefaultDecoderRegistry()
    registerLossyDecoders(registry)
    const pcm = await registry.decodeAsync("mp3", encodeMp3(330, 0.25))
    expect(pcm.sampleRate).toBe(44100)
    expect(pcm.frameCount).toBeGreaterThan(0)
  })
})

describe("oggVorbisDecoder", () => {
  it("claims the ogg and vorbis formats", () => {
    expect(oggVorbisDecoder.formats).toContain("ogg")
    expect(oggVorbisDecoder.formats).toContain("vorbis")
    expect(oggVorbisDecoder.name).toBe("ogg-vorbis-wasm")
  })

  it("reports an unusable stream rather than silence", async () => {
    // "OggS" header with nothing behind it
    const bytes = new Uint8Array(512)
    bytes.set([0x4f, 0x67, 0x67, 0x53])
    await expect(oggVorbisDecoder.decode(bytes)).rejects.toThrow()
  })
})
