import type { JamAudioEngine } from "./JamAudioEngine"
import {
  autoCorrelate,
  hzToMidi,
  medianOf,
  stabilityConfidence,
} from "./pitchDetect"

export interface PitchFrame {
  time: number
  hz: number | null
  midi: number | null
  rms: number
}

export class VoiceAnalyzer {
  private stream: MediaStream
  private ctx: AudioContext
  private analyser: AnalyserNode
  private buf: Float32Array<ArrayBuffer>
  private raf = 0
  private midiHist: number[] = []
  onFrame: ((f: PitchFrame) => void) | null = null

  private constructor(stream: MediaStream, ctx: AudioContext) {
    this.stream = stream
    this.ctx = ctx
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 2048
    const src = ctx.createMediaStreamSource(stream)
    src.connect(this.analyser)
    this.buf = new Float32Array(this.analyser.fftSize)
  }

  static async start(engine: JamAudioEngine): Promise<VoiceAnalyzer> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
    const ctx = engine.ensureContext()
    const analyzer = new VoiceAnalyzer(stream, ctx)
    analyzer.run()
    return analyzer
  }

  private run() {
    const loop = () => {
      this.analyser.getFloatTimeDomainData(this.buf)
      let rms = 0
      for (let i = 0; i < this.buf.length; i++) rms += this.buf[i] * this.buf[i]
      rms = Math.sqrt(rms / this.buf.length)

      const rawHz = autoCorrelate(this.buf, this.ctx.sampleRate)
      const hz: number | null = rawHz > 50 && rawHz < 1400 ? rawHz : null
      let midi: number | null = null
      if (hz !== null) {
        this.midiHist.push(hzToMidi(hz))
        if (this.midiHist.length > 3) this.midiHist.shift()
        midi = medianOf(this.midiHist)
      } else {
        this.midiHist = []
      }

      this.onFrame?.({ time: this.ctx.currentTime, hz, midi, rms })
      this.raf = requestAnimationFrame(loop)
    }
    loop()
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.stream.getTracks().forEach((t) => t.stop())
  }
}

export interface RawVoiceNote {
  startSec: number
  endSec: number
  midi: number
  loudness: number
  confidence: number
}

// Segments a pitch stream into discrete notes:
// - onsets from voiced/unvoiced transitions
// - note splits on jumps > 4.5 semitones
// - minimum duration filter
export class MelodyTracker {
  private current: {
    start: number
    last: number
    midis: number[]
    hzs: number[]
    rmsSum: number
    rmsCount: number
  } | null = null
  private notes: RawVoiceNote[] = []
  private readonly minDur = 0.11
  private readonly gapTol = 0.12
  private readonly splitJump = 4.5

  addFrame(f: PitchFrame) {
    if (f.midi !== null && f.midi !== undefined) {
      if (!this.current) {
        this.current = {
          start: f.time,
          last: f.time,
          midis: [f.midi],
          hzs: [f.hz ?? 440],
          rmsSum: f.rms,
          rmsCount: 1,
        }
      } else {
        const prev = this.current.midis[this.current.midis.length - 1]
        if (Math.abs(f.midi - prev) > this.splitJump) {
          this.endAt(f.time)
          this.current = {
            start: f.time,
            last: f.time,
            midis: [f.midi],
            hzs: [f.hz ?? 440],
            rmsSum: f.rms,
            rmsCount: 1,
          }
        } else {
          this.current.midis.push(f.midi)
          this.current.hzs.push(f.hz ?? 440)
          this.current.last = f.time
          this.current.rmsSum += f.rms
          this.current.rmsCount += 1
        }
      }
    } else if (this.current && f.time - this.current.last > this.gapTol) {
      this.endAt(f.time)
    }
  }

  private endAt(_t: number) {
    const c = this.current
    if (!c) return
    const dur = c.last - c.start
    if (dur >= this.minDur) {
      this.notes.push({
        startSec: c.start,
        endSec: c.last,
        midi: medianOf(c.midis),
        loudness: c.rmsSum / c.rmsCount,
        confidence: stabilityConfidence(c.hzs),
      })
    }
    this.current = null
  }

  finish(): RawVoiceNote[] {
    if (this.current) this.endAt(this.current.last + this.minDur)
    return this.notes
  }
}
