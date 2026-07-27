/**
 * Minimal FLAC encoder.
 *
 * Its job is fixtures and round-trip tests, not compression: it writes every
 * subframe type the decoder implements so the decoder is exercised against a
 * real bitstream instead of a mock. The output is a valid FLAC stream – any
 * player reads it – it just does not try to be small.
 */

export type FlacSubframeMode =
  | { kind: "verbatim" }
  | { kind: "constant" }
  | { kind: "fixed"; order: 0 | 1 | 2 | 3 | 4; riceParameter?: number }
  | {
      kind: "lpc"
      coefficients: number[]
      shift: number
      precision?: number
      riceParameter?: number
    }

export type FlacStereoMode =
  | "independent"
  | "left-side"
  | "right-side"
  | "mid-side"

export interface FlacEncodeOptions {
  sampleRate: number
  bitsPerSample: number
  blockSize?: number
  subframe?: FlacSubframeMode
  stereo?: FlacStereoMode
  /** Extra bits every sample is a multiple of, exercising the wasted-bits path */
  wastedBits?: number
}

class BitWriter {
  private bytes: number[] = []
  private current = 0
  private bitCount = 0

  writeBits(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) {
      const bit = Math.floor(value / 2 ** i) % 2
      this.writeBit(bit < 0 ? bit + 2 : bit)
    }
  }

  writeSignedBits(value: number, count: number): void {
    const normalized = value < 0 ? value + 2 ** count : value
    this.writeBits(normalized, count)
  }

  writeUnary(value: number): void {
    for (let i = 0; i < value; i++) this.writeBit(0)
    this.writeBit(1)
  }

  writeBit(bit: number): void {
    this.current = (this.current << 1) | (bit & 1)
    this.bitCount++
    if (this.bitCount === 8) {
      this.bytes.push(this.current & 0xff)
      this.current = 0
      this.bitCount = 0
    }
  }

  alignToByte(): void {
    while (this.bitCount !== 0) this.writeBit(0)
  }

  get byteLength(): number {
    return this.bytes.length
  }

  toUint8Array(): Uint8Array {
    this.alignToByte()
    return Uint8Array.from(this.bytes)
  }
}

function crc8(bytes: Uint8Array): number {
  let crc = 0
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff
    }
  }
  return crc
}

function crc16(bytes: Uint8Array): number {
  let crc = 0
  for (const byte of bytes) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc
}

function zigzag(value: number): number {
  return value >= 0 ? value * 2 : -value * 2 - 1
}

function writeRiceResidual(
  writer: BitWriter,
  residual: number[],
  parameter: number,
): void {
  writer.writeBits(0, 2) // method 0: 4-bit Rice parameters
  writer.writeBits(0, 4) // partition order 0
  writer.writeBits(parameter, 4)
  for (const value of residual) {
    const folded = zigzag(value)
    const quotient = Math.floor(folded / 2 ** parameter)
    writer.writeUnary(quotient)
    if (parameter > 0) writer.writeBits(folded % 2 ** parameter, parameter)
  }
}

const FIXED_COEFFICIENTS = [[], [1], [2, -1], [3, -3, 1], [4, -6, 4, -1]]

function writeSubframe(
  writer: BitWriter,
  samples: Int32Array,
  bitsPerSample: number,
  mode: FlacSubframeMode,
  wastedBits: number,
): void {
  const effectiveBits = bitsPerSample - wastedBits
  const values = Array.from(samples, (value) =>
    wastedBits > 0 ? value / 2 ** wastedBits : value,
  )

  writer.writeBit(0) // padding
  switch (mode.kind) {
    case "constant":
      writer.writeBits(0, 6)
      break
    case "verbatim":
      writer.writeBits(1, 6)
      break
    case "fixed":
      writer.writeBits(8 + mode.order, 6)
      break
    case "lpc":
      writer.writeBits(32 + (mode.coefficients.length - 1), 6)
      break
  }

  if (wastedBits > 0) {
    writer.writeBit(1)
    writer.writeUnary(wastedBits - 1)
  } else {
    writer.writeBit(0)
  }

  if (mode.kind === "constant") {
    writer.writeSignedBits(values[0], effectiveBits)
    return
  }

  if (mode.kind === "verbatim") {
    for (const value of values) writer.writeSignedBits(value, effectiveBits)
    return
  }

  if (mode.kind === "fixed") {
    const coefficients = FIXED_COEFFICIENTS[mode.order]
    for (let i = 0; i < mode.order; i++) {
      writer.writeSignedBits(values[i], effectiveBits)
    }
    const residual: number[] = []
    for (let i = mode.order; i < values.length; i++) {
      let prediction = 0
      for (let c = 0; c < mode.order; c++) {
        prediction += coefficients[c] * values[i - 1 - c]
      }
      residual.push(values[i] - prediction)
    }
    writeRiceResidual(writer, residual, mode.riceParameter ?? 8)
    return
  }

  const order = mode.coefficients.length
  for (let i = 0; i < order; i++) {
    writer.writeSignedBits(values[i], effectiveBits)
  }
  const precision = mode.precision ?? 12
  writer.writeBits(precision - 1, 4)
  writer.writeSignedBits(mode.shift, 5)
  for (const coefficient of mode.coefficients) {
    writer.writeSignedBits(coefficient, precision)
  }
  const residual: number[] = []
  for (let i = order; i < values.length; i++) {
    let prediction = 0
    for (let c = 0; c < order; c++) {
      prediction += mode.coefficients[c] * values[i - 1 - c]
    }
    // the decoder uses an arithmetic shift, which is a floor division
    residual.push(values[i] - Math.floor(prediction / 2 ** mode.shift))
  }
  writeRiceResidual(writer, residual, mode.riceParameter ?? 8)
}

function decorrelate(
  channels: Int32Array[],
  mode: FlacStereoMode,
): { channels: Int32Array[]; assignment: number } {
  if (mode === "independent" || channels.length !== 2) {
    return { channels, assignment: channels.length - 1 }
  }
  const [left, right] = channels
  const length = left.length
  const a = new Int32Array(length)
  const b = new Int32Array(length)

  for (let i = 0; i < length; i++) {
    switch (mode) {
      case "left-side":
        a[i] = left[i]
        b[i] = left[i] - right[i]
        break
      case "right-side":
        a[i] = left[i] - right[i]
        b[i] = right[i]
        break
      case "mid-side":
        a[i] = (left[i] + right[i]) >> 1
        b[i] = left[i] - right[i]
        break
    }
  }
  const assignment = mode === "left-side" ? 8 : mode === "right-side" ? 9 : 10
  return { channels: [a, b], assignment }
}

/** Encodes integer samples (already at `bitsPerSample`) into a FLAC stream. */
export function encodeFlac(
  channels: Int32Array[],
  options: FlacEncodeOptions,
): Uint8Array {
  const {
    sampleRate,
    bitsPerSample,
    blockSize = 512,
    subframe = { kind: "verbatim" },
    stereo = "independent",
    wastedBits = 0,
  } = options

  const totalSamples = channels[0]?.length ?? 0
  const output: number[] = [0x66, 0x4c, 0x61, 0x43] // "fLaC"

  // STREAMINFO
  const info = new BitWriter()
  info.writeBits(blockSize, 16)
  info.writeBits(blockSize, 16)
  info.writeBits(0, 24)
  info.writeBits(0, 24)
  info.writeBits(sampleRate, 20)
  info.writeBits(channels.length - 1, 3)
  info.writeBits(bitsPerSample - 1, 5)
  info.writeBits(Math.floor(totalSamples / 2 ** 18), 18)
  info.writeBits(totalSamples % 2 ** 18, 18)
  for (let i = 0; i < 16; i++) info.writeBits(0, 8) // md5: unknown
  const infoBytes = info.toUint8Array()

  output.push(0x80, 0, 0, infoBytes.length) // last block, type 0
  output.push(...infoBytes)

  let frameNumber = 0
  for (let start = 0; start < totalSamples; start += blockSize) {
    const length = Math.min(blockSize, totalSamples - start)
    const block = channels.map((channel) =>
      Int32Array.from(channel.slice(start, start + length)),
    )
    const { channels: coded, assignment } = decorrelate(block, stereo)

    const header = new BitWriter()
    header.writeBits(0x3ffe, 14)
    header.writeBit(0) // reserved
    header.writeBit(0) // fixed block size
    header.writeBits(7, 4) // block size follows as 16 bit
    header.writeBits(0, 4) // sample rate from STREAMINFO
    header.writeBits(assignment, 4)
    header.writeBits(0, 3) // sample size from STREAMINFO
    header.writeBit(0) // reserved
    header.writeBits(frameNumber & 0x7f, 8) // one-byte "UTF-8" frame number
    header.writeBits(length - 1, 16)
    const headerBytes = header.toUint8Array()

    const frame = new BitWriter()
    for (const byte of headerBytes) frame.writeBits(byte, 8)
    frame.writeBits(crc8(headerBytes), 8)

    for (let channel = 0; channel < coded.length; channel++) {
      const extra =
        (assignment === 8 && channel === 1) ||
        (assignment === 9 && channel === 0) ||
        (assignment === 10 && channel === 1)
          ? 1
          : 0
      const mode: FlacSubframeMode =
        subframe.kind === "constant" &&
        coded[channel].some((value) => value !== coded[channel][0])
          ? { kind: "verbatim" }
          : subframe
      writeSubframe(
        frame,
        coded[channel],
        bitsPerSample + extra,
        mode,
        wastedBits,
      )
    }
    frame.alignToByte()

    const frameBytes = frame.toUint8Array()
    output.push(...frameBytes)
    const crc = crc16(frameBytes)
    output.push((crc >> 8) & 0xff, crc & 0xff)
    frameNumber++
  }

  return Uint8Array.from(output)
}

/** Float samples in −1..1 quantized to the given depth, for fixtures. */
export function quantize(
  channels: Float32Array[],
  bitsPerSample: number,
): Int32Array[] {
  const scale = 2 ** (bitsPerSample - 1)
  return channels.map((channel) =>
    Int32Array.from(channel, (value) =>
      Math.max(-scale, Math.min(scale - 1, Math.round(value * scale))),
    ),
  )
}
