import type { AudioDecoder, PcmBuffer } from "@signal-app/tonemap-core"
import {
  AudioDecodeError,
  createDefaultDecoderRegistry,
  type DecoderRegistry,
} from "@signal-app/tonemap-core"

/**
 * Browser decoders for the tone map pipeline.
 *
 * `tonemap-core` decodes WAV and FLAC on its own so it works headless. In the
 * app the platform already has decoders for the rest, so the registry gets one
 * thin adapter per format instead of a bundled codec.
 */

const WEB_AUDIO_FORMATS = ["mp3", "ogg", "opus"] as const

function createWebAudioDecoder(
  format: string,
  getContext: () => BaseAudioContext,
): AudioDecoder {
  return {
    name: `web-audio-${format}`,
    formats: [format],
    async decode(bytes: Uint8Array): Promise<PcmBuffer> {
      // decodeAudioData detaches the buffer it is handed, so the caller's
      // bytes stay usable for a checksum or a second decoder.
      const copy = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(copy).set(bytes)
      let audioBuffer: AudioBuffer
      try {
        audioBuffer = await getContext().decodeAudioData(copy)
      } catch (error) {
        throw new AudioDecodeError(
          `the browser could not decode this ${format} file: ${
            error instanceof Error ? error.message : String(error)
          }`,
          format,
        )
      }
      const channels: Float32Array[] = []
      for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        channels.push(audioBuffer.getChannelData(i).slice())
      }
      return {
        sampleRate: audioBuffer.sampleRate,
        channels,
        frameCount: audioBuffer.length,
      }
    },
  }
}

/** Container sniffing – the file extension is a hint, the bytes are the truth. */
export function sniffAudioFormat(bytes: Uint8Array): string | undefined {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.slice(offset, offset + length))
  if (bytes.length < 36) return undefined
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "wav"
  if (ascii(0, 4) === "fLaC") return "flac"
  if (ascii(0, 4) === "OggS") {
    // Opus and Vorbis share the Ogg container; the codec is in the first packet
    return ascii(28, 8) === "OpusHead" ? "opus" : "ogg"
  }
  if (ascii(0, 3) === "ID3") return "mp3"
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3"
  return undefined
}

/**
 * Registry with the platform decoders on top of the ones the package brings
 * itself. WAV and FLAC stay with the pure decoders so results are identical
 * to a headless run.
 */
export function createBrowserDecoderRegistry(
  getContext: () => BaseAudioContext,
): DecoderRegistry {
  const registry = createDefaultDecoderRegistry()
  for (const format of WEB_AUDIO_FORMATS) {
    registry.register(createWebAudioDecoder(format, getContext))
  }
  return registry
}
