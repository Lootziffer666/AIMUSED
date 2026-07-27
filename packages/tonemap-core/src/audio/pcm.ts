/**
 * PCM buffer plus the decoder interface.
 *
 * Analysis always runs on a single, boring representation: float samples per
 * channel. Decoding is behind an interface so a host that has ffmpeg, the Web
 * Audio API or a native decoder can register one without the analysis code
 * changing. The only decoder shipped here is WAV, because it is the one
 * format we can decode correctly without pulling in a binary dependency.
 */

export interface PcmBuffer {
  sampleRate: number
  /** One Float32Array per channel, all of the same length */
  channels: Float32Array[]
  frameCount: number
}

export interface AudioDecoder {
  readonly name: string
  /** Formats this decoder claims, e.g. ["wav"] */
  readonly formats: string[]
  decode(bytes: Uint8Array): PcmBuffer
}

export class AudioDecodeError extends Error {
  // Explicit fields instead of parameter properties: the CLI runs through
  // node --experimental-strip-types, which does not support them.
  format?: string

  constructor(message: string, format?: string) {
    super(message)
    this.name = "AudioDecodeError"
    this.format = format
  }
}

export class DecoderRegistry {
  private decoders: AudioDecoder[] = []

  register(decoder: AudioDecoder): void {
    this.decoders.push(decoder)
  }

  supports(format: string): boolean {
    return this.decoders.some((d) => d.formats.includes(format.toLowerCase()))
  }

  get registeredFormats(): string[] {
    return [...new Set(this.decoders.flatMap((d) => d.formats))].sort()
  }

  decode(format: string, bytes: Uint8Array): PcmBuffer {
    const decoder = this.decoders.find((d) =>
      d.formats.includes(format.toLowerCase()),
    )
    if (!decoder) {
      throw new AudioDecodeError(
        `no decoder registered for "${format}". Registered: ${
          this.registeredFormats.join(", ") || "none"
        }. Convert the file to WAV or register a decoder for this format.`,
        format,
      )
    }
    return decoder.decode(bytes)
  }
}

// ---------------------------------------------------------------------------
// WAV
// ---------------------------------------------------------------------------

/** Minimal RIFF/WAVE reader: PCM 8/16/24/32 bit and 32 bit float. */
export const wavDecoder: AudioDecoder = {
  name: "builtin-wav",
  formats: ["wav", "wave"],
  decode(bytes: Uint8Array): PcmBuffer {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const readTag = (offset: number) =>
      String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3),
      )

    if (
      bytes.byteLength < 12 ||
      readTag(0) !== "RIFF" ||
      readTag(8) !== "WAVE"
    ) {
      throw new AudioDecodeError("not a RIFF/WAVE file", "wav")
    }

    let offset = 12
    let format = 1
    let channels = 0
    let sampleRate = 0
    let bitsPerSample = 0
    let dataOffset = -1
    let dataLength = 0

    while (offset + 8 <= bytes.byteLength) {
      const id = readTag(offset)
      const size = view.getUint32(offset + 4, true)
      const body = offset + 8
      if (id === "fmt ") {
        format = view.getUint16(body, true)
        channels = view.getUint16(body + 2, true)
        sampleRate = view.getUint32(body + 4, true)
        bitsPerSample = view.getUint16(body + 14, true)
        if (format === 0xfffe && size >= 40) {
          format = view.getUint16(body + 24, true)
        }
      } else if (id === "data") {
        dataOffset = body
        dataLength = Math.min(size, bytes.byteLength - body)
      }
      offset = body + size + (size % 2)
    }

    if (dataOffset < 0 || channels <= 0 || sampleRate <= 0) {
      throw new AudioDecodeError("WAV file has no usable fmt/data chunk", "wav")
    }

    const bytesPerSample = bitsPerSample / 8
    const frameCount = Math.floor(dataLength / (bytesPerSample * channels))
    const output = Array.from(
      { length: channels },
      () => new Float32Array(frameCount),
    )

    for (let frame = 0; frame < frameCount; frame++) {
      for (let channel = 0; channel < channels; channel++) {
        const position =
          dataOffset + (frame * channels + channel) * bytesPerSample
        output[channel][frame] = readSample(
          view,
          position,
          bitsPerSample,
          format,
        )
      }
    }

    return { sampleRate, channels: output, frameCount }
  },
}

function readSample(
  view: DataView,
  position: number,
  bitsPerSample: number,
  format: number,
): number {
  if (format === 3) {
    return bitsPerSample === 64
      ? view.getFloat64(position, true)
      : view.getFloat32(position, true)
  }
  switch (bitsPerSample) {
    case 8:
      return (view.getUint8(position) - 128) / 128
    case 16:
      return view.getInt16(position, true) / 32768
    case 24: {
      const b0 = view.getUint8(position)
      const b1 = view.getUint8(position + 1)
      const b2 = view.getUint8(position + 2)
      let value = (b2 << 16) | (b1 << 8) | b0
      if (value & 0x800000) value -= 0x1000000
      return value / 8388608
    }
    case 32:
      return view.getInt32(position, true) / 2147483648
    default:
      throw new AudioDecodeError(
        `unsupported WAV sample width: ${bitsPerSample} bit`,
        "wav",
      )
  }
}

/** Encoder used by tests and by the CLI when it caches decoded audio. */
export function encodeWav(
  buffer: PcmBuffer,
  bitsPerSample: 16 | 32 = 16,
): Uint8Array {
  const channels = buffer.channels.length
  const bytesPerSample = bitsPerSample / 8
  const dataLength = buffer.frameCount * channels * bytesPerSample
  const bytes = new Uint8Array(44 + dataLength)
  const view = new DataView(bytes.buffer)

  const writeTag = (offset: number, tag: string) => {
    for (let i = 0; i < 4; i++) view.setUint8(offset + i, tag.charCodeAt(i))
  }

  writeTag(0, "RIFF")
  view.setUint32(4, 36 + dataLength, true)
  writeTag(8, "WAVE")
  writeTag(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true)
  view.setUint16(32, channels * bytesPerSample, true)
  view.setUint16(34, bitsPerSample, true)
  writeTag(36, "data")
  view.setUint32(40, dataLength, true)

  let position = 44
  for (let frame = 0; frame < buffer.frameCount; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, buffer.channels[channel][frame]))
      if (bitsPerSample === 16) {
        view.setInt16(position, Math.round(sample * 32767), true)
        position += 2
      } else {
        view.setInt32(position, Math.round(sample * 2147483647), true)
        position += 4
      }
    }
  }
  return bytes
}

export function createDefaultDecoderRegistry(): DecoderRegistry {
  const registry = new DecoderRegistry()
  registry.register(wavDecoder)
  return registry
}

export function monoMix(buffer: PcmBuffer): Float32Array {
  if (buffer.channels.length === 1) return buffer.channels[0]
  const mono = new Float32Array(buffer.frameCount)
  for (let frame = 0; frame < buffer.frameCount; frame++) {
    let sum = 0
    for (const channel of buffer.channels) sum += channel[frame]
    mono[frame] = sum / buffer.channels.length
  }
  return mono
}
