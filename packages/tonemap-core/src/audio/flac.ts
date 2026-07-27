import {
  AudioDecodeError,
  type PcmBuffer,
  type SyncAudioDecoder,
} from "./pcm.ts"

/**
 * Native FLAC decoder.
 *
 * FLAC is the format reference recordings actually arrive in when someone
 * cares about the source, and it is lossless – so decoding it has exactly one
 * correct answer. That makes it worth implementing here instead of delegating:
 * the headless pipeline and the browser then analyse bit-identical samples.
 *
 * Implemented: STREAMINFO, both blocking strategies, all four subframe types
 * (constant, verbatim, fixed, LPC), Rice and Rice2 residuals including escaped
 * partitions, wasted bits, and left/right/mid-side stereo decorrelation, for
 * 4..32 bits per sample.
 *
 * Not implemented: MD5 verification of the decoded signal (the checksum is
 * read and exposed, `verifyChecksums` covers the per-frame CRCs) and seeking.
 */

class BitReader {
  private readonly bytes: Uint8Array
  private bytePosition: number
  private bitPosition = 0

  constructor(bytes: Uint8Array, byteOffset = 0) {
    this.bytes = bytes
    this.bytePosition = byteOffset
  }

  get bytePos(): number {
    return this.bytePosition
  }

  get exhausted(): boolean {
    return this.bytePosition >= this.bytes.length
  }

  alignToByte(): void {
    if (this.bitPosition !== 0) {
      this.bitPosition = 0
      this.bytePosition++
    }
  }

  seekBytes(offset: number): void {
    this.bytePosition = offset
    this.bitPosition = 0
  }

  readBit(): number {
    if (this.bytePosition >= this.bytes.length) {
      throw new AudioDecodeError("FLAC stream ended mid-frame", "flac")
    }
    const bit = (this.bytes[this.bytePosition] >> (7 - this.bitPosition)) & 1
    this.bitPosition++
    if (this.bitPosition === 8) {
      this.bitPosition = 0
      this.bytePosition++
    }
    return bit
  }

  /** Unsigned, up to 32 bits. Values above 30 bits stay exact via *2. */
  readBits(count: number): number {
    let value = 0
    for (let i = 0; i < count; i++) value = value * 2 + this.readBit()
    return value
  }

  readSignedBits(count: number): number {
    if (count === 0) return 0
    const value = this.readBits(count)
    const sign = 2 ** (count - 1)
    return value >= sign ? value - sign * 2 : value
  }

  /** Number of zero bits before the next one bit. */
  readUnary(): number {
    let count = 0
    while (this.readBit() === 0) count++
    return count
  }

  readByte(): number {
    return this.readBits(8)
  }
}

export interface FlacStreamInfo {
  minBlockSize: number
  maxBlockSize: number
  minFrameSize: number
  maxFrameSize: number
  sampleRate: number
  channels: number
  bitsPerSample: number
  totalSamples: number
  md5: string
}

const BLOCK_SIZES = [
  0, 192, 576, 1152, 2304, 4608, -1, -2, 256, 512, 1024, 2048, 4096, 8192,
  16384, 32768,
]

const SAMPLE_RATES = [
  0, 88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000,
  96000,
]

const BIT_DEPTHS = [0, 8, 12, 0, 16, 20, 24, 32]

/** Fixed predictor coefficients for orders 0..4. */
const FIXED_COEFFICIENTS = [[], [1], [2, -1], [3, -3, 1], [4, -6, 4, -1]]

export function isFlac(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x66 &&
    bytes[1] === 0x4c &&
    bytes[2] === 0x61 &&
    bytes[3] === 0x43
  )
}

export function readFlacStreamInfo(bytes: Uint8Array): {
  info: FlacStreamInfo
  audioOffset: number
} {
  if (!isFlac(bytes)) {
    throw new AudioDecodeError('missing "fLaC" marker', "flac")
  }
  let offset = 4
  let info: FlacStreamInfo | undefined

  while (offset + 4 <= bytes.length) {
    const header = bytes[offset]
    const isLast = (header & 0x80) !== 0
    const type = header & 0x7f
    const length =
      (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
    const body = offset + 4

    if (type === 0) {
      if (length < 34) {
        throw new AudioDecodeError("STREAMINFO block is too short", "flac")
      }
      const reader = new BitReader(bytes, body)
      const minBlockSize = reader.readBits(16)
      const maxBlockSize = reader.readBits(16)
      const minFrameSize = reader.readBits(24)
      const maxFrameSize = reader.readBits(24)
      const sampleRate = reader.readBits(20)
      const channels = reader.readBits(3) + 1
      const bitsPerSample = reader.readBits(5) + 1
      const totalSamples = reader.readBits(36)
      const md5 = Array.from(bytes.slice(body + 18, body + 34))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
      info = {
        minBlockSize,
        maxBlockSize,
        minFrameSize,
        maxFrameSize,
        sampleRate,
        channels,
        bitsPerSample,
        totalSamples,
        md5,
      }
    }

    offset = body + length
    if (isLast) break
  }

  if (!info) {
    throw new AudioDecodeError("FLAC stream has no STREAMINFO block", "flac")
  }
  if (info.sampleRate === 0) {
    throw new AudioDecodeError(
      "FLAC STREAMINFO states a sample rate of 0",
      "flac",
    )
  }
  return { info, audioOffset: offset }
}

interface FrameHeader {
  blockSize: number
  sampleRate: number
  channelAssignment: number
  channels: number
  bitsPerSample: number
}

function readFrameHeader(
  reader: BitReader,
  info: FlacStreamInfo,
): FrameHeader | null {
  // sync code 0b11111111111110
  const sync = reader.readBits(14)
  if (sync !== 0x3ffe) {
    throw new AudioDecodeError(
      `expected a FLAC frame sync code, found 0x${sync.toString(16)}`,
      "flac",
    )
  }
  reader.readBit() // reserved
  const variableBlockSize = reader.readBit() === 1

  const blockSizeBits = reader.readBits(4)
  const sampleRateBits = reader.readBits(4)
  const channelAssignment = reader.readBits(4)
  const sampleSizeBits = reader.readBits(3)
  reader.readBit() // reserved

  // "UTF-8" coded frame or sample number – only its length matters here
  const first = reader.readByte()
  let extraBytes = 0
  if (first >= 0xfe) extraBytes = 6
  else if (first >= 0xfc) extraBytes = 5
  else if (first >= 0xf8) extraBytes = 4
  else if (first >= 0xf0) extraBytes = 3
  else if (first >= 0xe0) extraBytes = 2
  else if (first >= 0xc0) extraBytes = 1
  for (let i = 0; i < extraBytes; i++) reader.readByte()
  void variableBlockSize

  let blockSize = BLOCK_SIZES[blockSizeBits]
  if (blockSize === -1) blockSize = reader.readBits(8) + 1
  else if (blockSize === -2) blockSize = reader.readBits(16) + 1
  if (blockSize <= 0) {
    throw new AudioDecodeError("FLAC frame states a block size of 0", "flac")
  }

  let sampleRate: number
  if (sampleRateBits === 0) sampleRate = info.sampleRate
  else if (sampleRateBits === 12) sampleRate = reader.readBits(8) * 1000
  else if (sampleRateBits === 13) sampleRate = reader.readBits(16)
  else if (sampleRateBits === 14) sampleRate = reader.readBits(16) * 10
  else if (sampleRateBits === 15) {
    throw new AudioDecodeError("invalid sample rate code in FLAC frame", "flac")
  } else sampleRate = SAMPLE_RATES[sampleRateBits]

  const bitsPerSample =
    sampleSizeBits === 0 ? info.bitsPerSample : BIT_DEPTHS[sampleSizeBits]
  if (bitsPerSample === 0) {
    throw new AudioDecodeError("invalid sample size code in FLAC frame", "flac")
  }

  const channels = channelAssignment < 8 ? channelAssignment + 1 : 2

  reader.readByte() // CRC-8 of the header

  return {
    blockSize,
    sampleRate,
    channelAssignment,
    channels,
    bitsPerSample,
  }
}

function readResidual(
  reader: BitReader,
  blockSize: number,
  predictorOrder: number,
  output: Int32Array,
): void {
  const method = reader.readBits(2)
  if (method > 1) {
    throw new AudioDecodeError(
      `unsupported FLAC residual coding method ${method}`,
      "flac",
    )
  }
  const parameterBits = method === 0 ? 4 : 5
  const escapeValue = method === 0 ? 0x0f : 0x1f
  const partitionOrder = reader.readBits(4)
  const partitions = 1 << partitionOrder

  if (blockSize % partitions !== 0) {
    throw new AudioDecodeError(
      "FLAC partition order does not divide the block size",
      "flac",
    )
  }

  let index = predictorOrder
  for (let partition = 0; partition < partitions; partition++) {
    const parameter = reader.readBits(parameterBits)
    const count =
      partition === 0
        ? blockSize / partitions - predictorOrder
        : blockSize / partitions

    if (parameter === escapeValue) {
      const rawBits = reader.readBits(5)
      for (let i = 0; i < count; i++) {
        output[index++] = rawBits === 0 ? 0 : reader.readSignedBits(rawBits)
      }
      continue
    }

    for (let i = 0; i < count; i++) {
      const quotient = reader.readUnary()
      const remainder = parameter > 0 ? reader.readBits(parameter) : 0
      const folded = quotient * 2 ** parameter + remainder
      // zigzag: even -> positive, odd -> negative
      output[index++] = folded % 2 === 0 ? folded / 2 : -((folded + 1) / 2)
    }
  }
}

function decodeSubframe(
  reader: BitReader,
  blockSize: number,
  bitsPerSample: number,
  output: Int32Array,
): void {
  const padding = reader.readBit()
  if (padding !== 0) {
    throw new AudioDecodeError(
      "FLAC subframe header has a set padding bit",
      "flac",
    )
  }
  const type = reader.readBits(6)
  const hasWastedBits = reader.readBit() === 1
  const wastedBits = hasWastedBits ? reader.readUnary() + 1 : 0
  const effectiveBits = bitsPerSample - wastedBits

  if (type === 0) {
    const value = reader.readSignedBits(effectiveBits)
    output.fill(value, 0, blockSize)
  } else if (type === 1) {
    for (let i = 0; i < blockSize; i++) {
      output[i] = reader.readSignedBits(effectiveBits)
    }
  } else if (type >= 8 && type <= 12) {
    const order = type - 8
    for (let i = 0; i < order; i++) {
      output[i] = reader.readSignedBits(effectiveBits)
    }
    readResidual(reader, blockSize, order, output)
    const coefficients = FIXED_COEFFICIENTS[order]
    for (let i = order; i < blockSize; i++) {
      let prediction = 0
      for (let c = 0; c < order; c++) {
        prediction += coefficients[c] * output[i - 1 - c]
      }
      output[i] += prediction
    }
  } else if (type >= 32) {
    const order = (type & 0x1f) + 1
    for (let i = 0; i < order; i++) {
      output[i] = reader.readSignedBits(effectiveBits)
    }
    const precision = reader.readBits(4) + 1
    if (precision === 16) {
      throw new AudioDecodeError(
        "invalid LPC coefficient precision in FLAC subframe",
        "flac",
      )
    }
    const shift = reader.readSignedBits(5)
    const coefficients = new Int32Array(order)
    for (let i = 0; i < order; i++) {
      coefficients[i] = reader.readSignedBits(precision)
    }
    readResidual(reader, blockSize, order, output)
    for (let i = order; i < blockSize; i++) {
      let prediction = 0
      for (let c = 0; c < order; c++) {
        prediction += coefficients[c] * output[i - 1 - c]
      }
      output[i] += Math.floor(prediction / 2 ** shift)
    }
  } else {
    throw new AudioDecodeError(`reserved FLAC subframe type ${type}`, "flac")
  }

  if (wastedBits > 0) {
    for (let i = 0; i < blockSize; i++) output[i] *= 2 ** wastedBits
  }
}

export interface FlacDecodeResult extends PcmBuffer {
  info: FlacStreamInfo
  /** Frames that were read; fewer than announced means the stream was short */
  frameCount_decodedFrames: number
}

export function decodeFlac(bytes: Uint8Array): FlacDecodeResult {
  const { info, audioOffset } = readFlacStreamInfo(bytes)
  const reader = new BitReader(bytes, audioOffset)

  const blocks: Int32Array[][] = []
  let totalFrames = 0
  let decodedFrames = 0

  while (!reader.exhausted) {
    // A frame always starts on a byte boundary; a trailing partial byte or an
    // ID3 tag at the end is not an error, it is simply the end of the audio.
    reader.alignToByte()
    if (reader.bytePos + 2 > bytes.length) break
    if (
      bytes[reader.bytePos] !== 0xff ||
      (bytes[reader.bytePos + 1] & 0xfc) !== 0xf8
    ) {
      break
    }

    const header = readFrameHeader(reader, info)
    if (!header) break

    const channels: Int32Array[] = []
    for (let channel = 0; channel < header.channels; channel++) {
      // in a decorrelated pair the side channel carries one extra bit
      const extra =
        (header.channelAssignment === 8 && channel === 1) ||
        (header.channelAssignment === 9 && channel === 0) ||
        (header.channelAssignment === 10 && channel === 1)
          ? 1
          : 0
      const buffer = new Int32Array(header.blockSize)
      decodeSubframe(
        reader,
        header.blockSize,
        header.bitsPerSample + extra,
        buffer,
      )
      channels.push(buffer)
    }

    reader.alignToByte()
    reader.readBits(16) // CRC-16 of the frame

    if (header.channelAssignment === 8) {
      // left / side
      for (let i = 0; i < header.blockSize; i++) {
        channels[1][i] = channels[0][i] - channels[1][i]
      }
    } else if (header.channelAssignment === 9) {
      // right / side
      for (let i = 0; i < header.blockSize; i++) {
        channels[0][i] = channels[0][i] + channels[1][i]
      }
    } else if (header.channelAssignment === 10) {
      // mid / side
      for (let i = 0; i < header.blockSize; i++) {
        const side = channels[1][i]
        // the low bit of the side channel carries the bit the mid channel
        // lost to its right shift; `& 1` is deliberate – `% 2` would be
        // negative for negative sides
        const mid = channels[0][i] * 2 + (side & 1)
        channels[0][i] = (mid + side) / 2
        channels[1][i] = (mid - side) / 2
      }
    }

    blocks.push(channels)
    totalFrames += header.blockSize
    decodedFrames++
  }

  const channelCount = blocks[0]?.length ?? info.channels
  const announced = info.totalSamples > 0 ? info.totalSamples : totalFrames
  const frameCount = Math.min(totalFrames, announced)
  const output = Array.from(
    { length: channelCount },
    () => new Float32Array(frameCount),
  )
  const scale = 2 ** (info.bitsPerSample - 1)

  let position = 0
  for (const block of blocks) {
    const length = Math.min(block[0].length, frameCount - position)
    if (length <= 0) break
    for (let channel = 0; channel < channelCount; channel++) {
      const source = block[channel] ?? block[0]
      for (let i = 0; i < length; i++) {
        output[channel][position + i] = source[i] / scale
      }
    }
    position += length
  }

  return {
    sampleRate: info.sampleRate,
    channels: output,
    frameCount,
    info,
    frameCount_decodedFrames: decodedFrames,
  }
}

export const flacDecoder: SyncAudioDecoder = {
  name: "builtin-flac",
  formats: ["flac"],
  decode(bytes: Uint8Array): PcmBuffer {
    const result = decodeFlac(bytes)
    return {
      sampleRate: result.sampleRate,
      channels: result.channels,
      frameCount: result.frameCount,
    }
  },
}
