import {
  AudioDecodeError,
  type AudioDecoder,
  type DecoderRegistry,
  type PcmBuffer,
} from "./pcm.ts"

/**
 * Lossy codecs: MP3 and Ogg Vorbis.
 *
 * WAV and FLAC are decoded natively (see `flac.ts`) because they are lossless
 * – there is one correct answer and no psychoacoustic model to get subtly
 * wrong. MP3 and Vorbis are a different matter: a hand-written decoder that is
 * *almost* right produces audio that sounds fine and analyses wrong, which is
 * the worst possible failure mode for a measurement pipeline. So these two go
 * through the reference implementations, compiled to WebAssembly.
 *
 * They are loaded lazily. Nothing is imported until a file of that format is
 * actually decoded, so the browser bundle and the CLI start-up stay unaffected
 * (the app registers the Web Audio decoders instead and never reaches these).
 */

interface DecodedChannels {
  channelData: Float32Array[]
  samplesDecoded: number
  sampleRate: number
  errors?: { message: string }[]
}

function toPcm(result: DecodedChannels): PcmBuffer {
  return {
    sampleRate: result.sampleRate,
    channels: result.channelData.map((channel) =>
      channel.length === result.samplesDecoded
        ? channel
        : channel.slice(0, result.samplesDecoded),
    ),
    frameCount: result.samplesDecoded,
  }
}

function missingPackage(
  format: string,
  packageName: string,
  cause: unknown,
): AudioDecodeError {
  return new AudioDecodeError(
    `cannot decode ${format}: the optional decoder "${packageName}" could not be loaded ` +
      `(${cause instanceof Error ? cause.message : String(cause)}). ` +
      `Install it, or convert the file to WAV or FLAC – both decode natively.`,
    format,
  )
}

export const mp3Decoder: AudioDecoder = {
  name: "mpg123-wasm",
  formats: ["mp3", "mpeg"],
  async decode(bytes: Uint8Array): Promise<PcmBuffer> {
    let MPEGDecoder: new () => {
      ready: Promise<unknown>
      decode(data: Uint8Array): DecodedChannels
      free(): void
    }
    try {
      ;({ MPEGDecoder } = await import("mpg123-decoder"))
    } catch (error) {
      throw missingPackage("MP3", "mpg123-decoder", error)
    }

    const decoder = new MPEGDecoder()
    await decoder.ready
    try {
      const result = decoder.decode(bytes)
      if (result.errors && result.errors.length > 0) {
        // decoding continues past a damaged frame; say so rather than
        // silently analysing a hole
        throw new AudioDecodeError(
          `MP3 stream has ${result.errors.length} damaged frame(s): ${result.errors[0].message}`,
          "mp3",
        )
      }
      if (result.samplesDecoded === 0) {
        throw new AudioDecodeError("MP3 stream decoded to no samples", "mp3")
      }
      return toPcm(result)
    } finally {
      decoder.free()
    }
  },
}

export const oggVorbisDecoder: AudioDecoder = {
  name: "ogg-vorbis-wasm",
  formats: ["ogg", "vorbis"],
  async decode(bytes: Uint8Array): Promise<PcmBuffer> {
    let OggVorbisDecoder: new () => {
      ready: Promise<unknown>
      decodeFile(data: Uint8Array): Promise<DecodedChannels>
      free(): void
    }
    try {
      ;({ OggVorbisDecoder } = await import("@wasm-audio-decoders/ogg-vorbis"))
    } catch (error) {
      throw missingPackage(
        "Ogg Vorbis",
        "@wasm-audio-decoders/ogg-vorbis",
        error,
      )
    }

    const decoder = new OggVorbisDecoder()
    await decoder.ready
    try {
      const result = await decoder.decodeFile(bytes)
      if (result.samplesDecoded === 0) {
        throw new AudioDecodeError(
          "Ogg Vorbis stream decoded to no samples",
          "ogg",
        )
      }
      return toPcm(result)
    } finally {
      decoder.free()
    }
  },
}

export const LOSSY_DECODERS: AudioDecoder[] = [mp3Decoder, oggVorbisDecoder]

/**
 * Adds the lossy decoders to a registry. Separate from
 * `createDefaultDecoderRegistry` on purpose: a host that already has platform
 * decoders (the browser does) should not pull these in at all.
 */
export function registerLossyDecoders(registry: DecoderRegistry): void {
  for (const decoder of LOSSY_DECODERS) registry.register(decoder)
}
