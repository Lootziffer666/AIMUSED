import type { AcousticFeatureVector } from "../schema/tonemap.ts"
import { monoMix, type PcmBuffer } from "./pcm.ts"

/**
 * Deterministic audio feature extraction.
 *
 * No model, no randomness, no hidden state: the same PCM in always produces
 * the same numbers out. That is what makes the later training data usable and
 * the heuristics debuggable. Everything sits behind `AudioFeatureExtractor`
 * so a stronger backend can replace it without touching the callers.
 */

export interface FrameFeatures {
  index: number
  startSample: number
  startSeconds: number
  durationSeconds: number
  rms: number
  peak: number
  loudnessDb: number
  zeroCrossingRate: number
  spectralCentroidHz: number
  spectralBandwidthHz: number
  spectralRolloffHz: number
  spectralFlatness: number
  lowEnergy: number
  midEnergy: number
  highEnergy: number
  onsetStrength: number
  chroma: number[]
  stereoWidth: number
  balance: number
  isSilent: boolean
}

export interface AudioFeatureResult {
  sampleRate: number
  frameSize: number
  hopSize: number
  durationSeconds: number
  frames: FrameFeatures[]
  /** Regions below the silence threshold, in seconds */
  silenceRegions: { startSeconds: number; endSeconds: number }[]
}

export interface FeatureExtractionOptions {
  frameSize?: number
  hopSize?: number
  /** dBFS below which a frame counts as silence */
  silenceThresholdDb?: number
}

export interface AudioFeatureExtractor {
  readonly name: string
  extract(
    buffer: PcmBuffer,
    options?: FeatureExtractionOptions,
  ): AudioFeatureResult
}

const A4_HZ = 440
const SILENCE_DB = -60

// ---------------------------------------------------------------------------
// FFT (iterative radix-2, real input)
// ---------------------------------------------------------------------------

function nextPowerOfTwo(value: number): number {
  let result = 1
  while (result < value) result *= 2
  return result
}

/** In-place complex FFT; `re`/`im` must have a power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k]
        const aIm = im[i + k]
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe
        re[i + k] = aRe + bRe
        im[i + k] = aIm + bIm
        re[i + k + len / 2] = aRe - bRe
        im[i + k + len / 2] = aIm - bIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

function hann(size: number): Float64Array {
  const window = new Float64Array(size)
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)))
  }
  return window
}

function magnitudeSpectrum(
  samples: Float32Array,
  start: number,
  frameSize: number,
  window: Float64Array,
): Float64Array {
  const size = nextPowerOfTwo(frameSize)
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let i = 0; i < frameSize; i++) {
    const index = start + i
    re[i] = index < samples.length ? samples[index] * window[i] : 0
  }
  fft(re, im)
  const bins = size / 2
  const magnitude = new Float64Array(bins)
  for (let bin = 0; bin < bins; bin++) {
    magnitude[bin] = Math.hypot(re[bin], im[bin])
  }
  return magnitude
}

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export class DeterministicFeatureExtractor implements AudioFeatureExtractor {
  readonly name = "deterministic-dsp-v1"

  extract(
    buffer: PcmBuffer,
    options: FeatureExtractionOptions = {},
  ): AudioFeatureResult {
    const frameSize = options.frameSize ?? 2048
    const hopSize = options.hopSize ?? 512
    const silenceThresholdDb = options.silenceThresholdDb ?? SILENCE_DB
    const sampleRate = buffer.sampleRate
    const mono = monoMix(buffer)
    const window = hann(frameSize)
    const binCount = nextPowerOfTwo(frameSize) / 2
    const binHz = sampleRate / nextPowerOfTwo(frameSize)

    const frames: FrameFeatures[] = []
    let previousSpectrum: Float64Array | null = null

    const frameCount =
      mono.length === 0 ? 0 : Math.max(1, Math.ceil(mono.length / hopSize))

    for (let index = 0; index < frameCount; index++) {
      const startSample = index * hopSize
      const spectrum = magnitudeSpectrum(mono, startSample, frameSize, window)

      let sumSquares = 0
      let peak = 0
      let crossings = 0
      let previousSample = 0
      let counted = 0
      for (let i = 0; i < frameSize; i++) {
        const position = startSample + i
        if (position >= mono.length) break
        const sample = mono[position]
        sumSquares += sample * sample
        peak = Math.max(peak, Math.abs(sample))
        if (i > 0 && Math.sign(sample) !== Math.sign(previousSample))
          crossings++
        previousSample = sample
        counted++
      }
      const rms = counted > 0 ? Math.sqrt(sumSquares / counted) : 0
      const loudnessDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity

      let magnitudeSum = 0
      let weighted = 0
      let logSum = 0
      let low = 0
      let mid = 0
      let high = 0
      for (let bin = 1; bin < binCount; bin++) {
        const magnitude = spectrum[bin]
        const hz = bin * binHz
        magnitudeSum += magnitude
        weighted += magnitude * hz
        logSum += Math.log(magnitude + 1e-12)
        if (hz < 250) low += magnitude
        else if (hz < 4000) mid += magnitude
        else high += magnitude
      }
      const centroid = magnitudeSum > 0 ? weighted / magnitudeSum : 0

      let variance = 0
      for (let bin = 1; bin < binCount; bin++) {
        const hz = bin * binHz
        variance += spectrum[bin] * (hz - centroid) ** 2
      }
      const bandwidth =
        magnitudeSum > 0 ? Math.sqrt(variance / magnitudeSum) : 0

      let cumulative = 0
      let rolloff = 0
      const rolloffTarget = magnitudeSum * 0.85
      for (let bin = 1; bin < binCount; bin++) {
        cumulative += spectrum[bin]
        if (cumulative >= rolloffTarget) {
          rolloff = bin * binHz
          break
        }
      }

      const geometricMean = Math.exp(logSum / Math.max(1, binCount - 1))
      const arithmeticMean = magnitudeSum / Math.max(1, binCount - 1)
      const flatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 0

      // Spectral flux, half wave rectified: the classic onset proxy.
      // The first frame is compared against implicit silence, otherwise a
      // piece that starts loud on sample 0 would have no onset at all.
      let flux = 0
      for (let bin = 1; bin < binCount; bin++) {
        const delta =
          spectrum[bin] - (previousSpectrum ? previousSpectrum[bin] : 0)
        if (delta > 0) flux += delta
      }
      flux /= binCount
      previousSpectrum = spectrum

      const chroma = chromaFromSpectrum(spectrum, binHz)
      const { width, balance } = stereoMetrics(buffer, startSample, frameSize)

      frames.push({
        index,
        startSample,
        startSeconds: startSample / sampleRate,
        durationSeconds: frameSize / sampleRate,
        rms,
        peak,
        loudnessDb: Number.isFinite(loudnessDb) ? loudnessDb : -120,
        zeroCrossingRate: counted > 1 ? crossings / counted : 0,
        spectralCentroidHz: centroid,
        spectralBandwidthHz: bandwidth,
        spectralRolloffHz: rolloff,
        spectralFlatness: flatness,
        lowEnergy: magnitudeSum > 0 ? low / magnitudeSum : 0,
        midEnergy: magnitudeSum > 0 ? mid / magnitudeSum : 0,
        highEnergy: magnitudeSum > 0 ? high / magnitudeSum : 0,
        onsetStrength: flux,
        chroma,
        stereoWidth: width,
        balance,
        isSilent:
          (Number.isFinite(loudnessDb) ? loudnessDb : -120) <
          silenceThresholdDb,
      })
    }

    return {
      sampleRate,
      frameSize,
      hopSize,
      durationSeconds: buffer.frameCount / sampleRate,
      frames,
      silenceRegions: collectSilence(frames, hopSize, sampleRate),
    }
  }
}

function chromaFromSpectrum(spectrum: Float64Array, binHz: number): number[] {
  const chroma = new Array<number>(12).fill(0)
  let total = 0
  for (let bin = 1; bin < spectrum.length; bin++) {
    const hz = bin * binHz
    if (hz < 27.5 || hz > 5000) continue
    const midi = 69 + 12 * Math.log2(hz / A4_HZ)
    const pitchClass = ((Math.round(midi) % 12) + 12) % 12
    chroma[pitchClass] += spectrum[bin]
    total += spectrum[bin]
  }
  if (total > 0) for (let i = 0; i < 12; i++) chroma[i] /= total
  return chroma
}

function stereoMetrics(
  buffer: PcmBuffer,
  start: number,
  frameSize: number,
): { width: number; balance: number } {
  if (buffer.channels.length < 2) return { width: 0, balance: 0 }
  const [left, right] = buffer.channels
  let sumSide = 0
  let sumMid = 0
  let energyLeft = 0
  let energyRight = 0
  let counted = 0
  for (let i = 0; i < frameSize; i++) {
    const index = start + i
    if (index >= buffer.frameCount) break
    const l = left[index]
    const r = right[index]
    sumMid += ((l + r) / 2) ** 2
    sumSide += ((l - r) / 2) ** 2
    energyLeft += l * l
    energyRight += r * r
    counted++
  }
  if (counted === 0) return { width: 0, balance: 0 }
  const mid = Math.sqrt(sumMid / counted)
  const side = Math.sqrt(sumSide / counted)
  const width = mid + side > 0 ? side / (mid + side) : 0
  const total = energyLeft + energyRight
  const balance = total > 0 ? (energyRight - energyLeft) / total : 0
  return { width, balance }
}

function collectSilence(
  frames: FrameFeatures[],
  hopSize: number,
  sampleRate: number,
): { startSeconds: number; endSeconds: number }[] {
  const regions: { startSeconds: number; endSeconds: number }[] = []
  let start: number | null = null
  for (const frame of frames) {
    if (frame.isSilent && start === null) start = frame.startSeconds
    if (!frame.isSilent && start !== null) {
      regions.push({ startSeconds: start, endSeconds: frame.startSeconds })
      start = null
    }
  }
  if (start !== null && frames.length > 0) {
    const last = frames[frames.length - 1]
    regions.push({
      startSeconds: start,
      endSeconds: last.startSeconds + hopSize / sampleRate,
    })
  }
  return regions
}

// ---------------------------------------------------------------------------
// Segment aggregation
// ---------------------------------------------------------------------------

export interface SegmentRequest {
  startSeconds: number
  endSeconds: number
}

/** Aggregates frame features into the vector the ToneMap stores per segment. */
export function aggregateSegment(
  result: AudioFeatureResult,
  segment: SegmentRequest,
): AcousticFeatureVector {
  const frames = result.frames.filter(
    (frame) =>
      frame.startSeconds >= segment.startSeconds - 1e-9 &&
      frame.startSeconds < segment.endSeconds,
  )
  if (frames.length === 0) {
    return emptyAcousticVector()
  }

  const mean = (pick: (frame: FrameFeatures) => number) =>
    frames.reduce((sum, frame) => sum + pick(frame), 0) / frames.length

  const chroma = new Array<number>(12).fill(0)
  for (const frame of frames) {
    for (let i = 0; i < 12; i++) chroma[i] += frame.chroma[i]
  }
  const chromaSum = chroma.reduce((a, b) => a + b, 0)
  const normalizedChroma =
    chromaSum > 0 ? chroma.map((value) => value / chromaSum) : chroma

  const rmsValues = frames.map((frame) => frame.rms)
  const maxRms = Math.max(...rmsValues)
  const attackFrames = Math.max(1, Math.round(frames.length * 0.15))
  const attackEnergy =
    rmsValues.slice(0, attackFrames).reduce((a, b) => a + b, 0) / attackFrames
  const tailEnergy =
    rmsValues.slice(attackFrames).reduce((a, b) => a + b, 0) /
    Math.max(1, rmsValues.length - attackFrames)

  return {
    rms: mean((f) => f.rms),
    peak: Math.max(...frames.map((f) => f.peak)),
    loudnessDb: mean((f) => f.loudnessDb),
    spectralCentroidHz: mean((f) => f.spectralCentroidHz),
    spectralBandwidthHz: mean((f) => f.spectralBandwidthHz),
    spectralRolloffHz: mean((f) => f.spectralRolloffHz),
    spectralFlatness: mean((f) => f.spectralFlatness),
    zeroCrossingRate: mean((f) => f.zeroCrossingRate),
    onsetStrength: mean((f) => f.onsetStrength),
    transientStrength: maxRms > 0 ? Math.min(1, attackEnergy / maxRms) : 0,
    sustainEstimate: maxRms > 0 ? Math.min(1, tailEnergy / maxRms) : 0,
    lowEnergy: mean((f) => f.lowEnergy),
    midEnergy: mean((f) => f.midEnergy),
    highEnergy: mean((f) => f.highEnergy),
    stereoWidth: mean((f) => f.stereoWidth),
    balance: mean((f) => f.balance),
    chroma: normalizedChroma,
    silenceRatio: frames.filter((f) => f.isSilent).length / frames.length,
  }
}

export function emptyAcousticVector(): AcousticFeatureVector {
  return {
    rms: 0,
    peak: 0,
    loudnessDb: -120,
    spectralCentroidHz: 0,
    spectralBandwidthHz: 0,
    spectralRolloffHz: 0,
    spectralFlatness: 0,
    zeroCrossingRate: 0,
    onsetStrength: 0,
    transientStrength: 0,
    sustainEstimate: 0,
    lowEnergy: 0,
    midEnergy: 0,
    highEnergy: 0,
    stereoWidth: 0,
    balance: 0,
    chroma: new Array<number>(12).fill(0),
    silenceRatio: 1,
  }
}

/** Onset times in seconds, picked from the flux curve with a moving threshold. */
export function detectOnsets(
  result: AudioFeatureResult,
  options: { sensitivity?: number; minIntervalSeconds?: number } = {},
): number[] {
  const sensitivity = options.sensitivity ?? 1.5
  // Two peaks 20 ms apart are one attack, not two notes. Without this
  // debounce a single note produces a burst of onsets.
  const minInterval = options.minIntervalSeconds ?? 0.05
  const flux = result.frames.map((frame) => frame.onsetStrength)
  // A note *ending* also splatters energy across bins, so raw spectral flux
  // marks releases as onsets. Requiring the frame energy to rise as well
  // keeps only real attacks.
  const rms = result.frames.map((frame) => frame.rms)
  if (flux.length < 3) return []
  const windowSize = 8
  const onsets: number[] = []
  const strengths: number[] = []

  for (let i = 0; i < flux.length - 1; i++) {
    const from = Math.max(0, i - windowSize)
    const to = Math.min(flux.length, i + windowSize)
    let sum = 0
    for (let j = from; j < to; j++) sum += flux[j]
    const local = sum / (to - from)
    const energyRising = i === 0 ? rms[i] > 1e-5 : rms[i] > rms[i - 1] * 1.02
    if (
      flux[i] > local * sensitivity &&
      energyRising &&
      (i === 0 || flux[i] >= flux[i - 1]) &&
      flux[i] > flux[i + 1] &&
      flux[i] > 1e-6
    ) {
      const time = result.frames[i].startSeconds
      const previous = onsets[onsets.length - 1]
      if (previous !== undefined && time - previous < minInterval) {
        // keep the stronger of the two candidates
        if (flux[i] > strengths[strengths.length - 1]) {
          onsets[onsets.length - 1] = time
          strengths[strengths.length - 1] = flux[i]
        }
        continue
      }
      onsets.push(time)
      strengths.push(flux[i])
    }
  }
  return onsets
}
