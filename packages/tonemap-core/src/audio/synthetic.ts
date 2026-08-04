import type { PcmBuffer } from "./pcm.ts"

/** Synthetic audio fixtures – no copyrighted material ever enters the repo. */

export interface ToneSpec {
  startSeconds: number
  durationSeconds: number
  frequency: number
  amplitude?: number
  /** 0 = pure sine, 1 = bright saw-ish stack */
  brightness?: number
  pan?: number
}

export function renderTones(options: {
  tones: ToneSpec[]
  durationSeconds: number
  sampleRate?: number
  channels?: 1 | 2
  leadingSilenceSeconds?: number
}): PcmBuffer {
  const sampleRate = options.sampleRate ?? 22050
  const channelCount = options.channels ?? 1
  const offset = options.leadingSilenceSeconds ?? 0
  const frameCount = Math.round((options.durationSeconds + offset) * sampleRate)
  const channels = Array.from(
    { length: channelCount },
    () => new Float32Array(frameCount),
  )

  for (const tone of options.tones) {
    const start = Math.round((tone.startSeconds + offset) * sampleRate)
    const length = Math.round(tone.durationSeconds * sampleRate)
    const amplitude = tone.amplitude ?? 0.5
    const brightness = tone.brightness ?? 0
    const pan = tone.pan ?? 0

    for (let i = 0; i < length; i++) {
      const index = start + i
      if (index < 0 || index >= frameCount) continue
      const t = i / sampleRate
      // short attack/release so onsets are detectable and nothing clicks
      const attack = Math.min(1, i / (sampleRate * 0.005))
      const release = Math.min(1, (length - i) / (sampleRate * 0.02))
      const envelope = amplitude * attack * release

      let sample = Math.sin(2 * Math.PI * tone.frequency * t)
      if (brightness > 0) {
        sample +=
          brightness * 0.5 * Math.sin(2 * Math.PI * tone.frequency * 2 * t)
        sample +=
          brightness * 0.3 * Math.sin(2 * Math.PI * tone.frequency * 3 * t)
        sample +=
          brightness * 0.2 * Math.sin(2 * Math.PI * tone.frequency * 5 * t)
        sample /= 1 + brightness
      }
      sample *= envelope

      if (channelCount === 1) {
        channels[0][index] += sample
      } else {
        channels[0][index] += sample * (1 - Math.max(0, pan))
        channels[1][index] += sample * (1 + Math.min(0, pan))
      }
    }
  }

  return { sampleRate, channels, frameCount }
}

export function midiToHz(noteNumber: number): number {
  return 440 * 2 ** ((noteNumber - 69) / 12)
}

/**
 * Audio rendition of `syntheticMotifMidi`: the same notes at the same times,
 * so alignment has a ground truth it must reproduce.
 */
export function syntheticMotifAudio(
  options: {
    leadingSilenceSeconds?: number
    sampleRate?: number
    bpm?: number
  } = {},
): PcmBuffer {
  const bpm = options.bpm ?? 120
  const secondsPerBeat = 60 / bpm
  const tones: ToneSpec[] = []
  const motif = [0, 2, 4, 7]
  const transpositions = [60, 67]

  transpositions.forEach((base, index) => {
    motif.forEach((step, position) => {
      tones.push({
        startSeconds: (index * 4 + position) * secondsPerBeat,
        durationSeconds: secondsPerBeat * 0.875,
        frequency: midiToHz(base + step),
        amplitude: 0.4,
        brightness: 0.6,
      })
    })
  })
  for (let beat = 0; beat < 8; beat++) {
    tones.push({
      startSeconds: beat * secondsPerBeat,
      durationSeconds: secondsPerBeat * 0.5,
      frequency: midiToHz(36),
      amplitude: 0.3,
      brightness: 0,
    })
  }

  return renderTones({
    tones,
    durationSeconds: 8 * secondsPerBeat,
    sampleRate: options.sampleRate ?? 22050,
    leadingSilenceSeconds: options.leadingSilenceSeconds ?? 0,
  })
}
