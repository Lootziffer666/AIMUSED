// ACF2+ autocorrelation pitch detection (Chris Wilson style)
// Returns frequency in Hz, or -1 if no stable pitch found.

export function autoCorrelate(buf: Float32Array, sampleRate: number): number {
  const SIZE = buf.length
  let rms = 0
  for (let i = 0; i < SIZE; i++) {
    const v = buf[i]
    rms += v * v
  }
  rms = Math.sqrt(rms / SIZE)
  if (rms < 0.01) return -1

  // Trim silence at edges
  let r1 = 0
  let r2 = SIZE - 1
  const thres = 0.2
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < thres) {
      r1 = i
      break
    }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < thres) {
      r2 = SIZE - i
      break
    }
  }
  const trimmed = buf.slice(r1, r2)
  const N = trimmed.length
  if (N < 32) return -1

  // Autocorrelation
  const c = new Array<number>(N).fill(0)
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N - i; j++) {
      c[i] += trimmed[j] * trimmed[j + i]
    }
  }

  // Find first dip, then peak after it
  let d = 0
  while (d < N - 1 && c[d] > c[d + 1]) d++
  let maxval = -1
  let maxpos = -1
  for (let i = d; i < N; i++) {
    if (c[i] > maxval) {
      maxval = c[i]
      maxpos = i
    }
  }
  let T0 = maxpos
  if (T0 <= 0) return -1

  // Parabolic interpolation
  const x1 = c[T0 - 1]
  const x2 = c[T0]
  const x3 = c[T0 + 1] ?? c[T0]
  const a = (x1 + x3 - 2 * x2) / 2
  const b = (x3 - x1) / 2
  if (a !== 0) T0 = T0 - b / (2 * a)
  if (T0 <= 0) return -1

  return sampleRate / T0
}

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440)
}

export function medianOf(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

// Confidence from pitch stability: low jitter = high confidence
export function stabilityConfidence(hzs: number[]): number {
  if (hzs.length < 2) return 0.5
  const mean = hzs.reduce((a, b) => a + b, 0) / hzs.length
  const devs = hzs.map((h) => Math.abs(12 * Math.log2(h / mean)))
  const std = Math.sqrt(devs.reduce((a, b) => a + b * b, 0) / devs.length)
  return Math.max(0.3, Math.min(0.98, 1 - std / 1.5))
}
