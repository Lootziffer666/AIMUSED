import type { MusePerformanceTake } from "../../../entities/performance/MusePerformanceTake"

// Returning `false` means "not handled" – the engine then falls back to
// its own DSP voices for that note.
export type SynthNotePlayer = (
  time: number,
  channel: number,
  noteNumber: number,
  velocity: number,
  duration: number,
) => boolean

export type SynthKind = "lead" | "bass" | "pad" | "arp"

/** Normalized gain curve point: t and v both run from 0 to 1 */
export interface GainShapePoint {
  t: number
  v: number
}

export const ROLE_CHANNEL: Record<string, number> = {
  melody: 0,
  guitar: 3,
  pad: 2,
  bass: 1,
  texture: 4,
}

export const ROLE_PROGRAM: Record<string, number> = {
  melody: 0,
  guitar: 25,
  pad: 89,
  bass: 33,
  texture: 92,
}

// GM program to set up on each jam channel before the first note
export const CHANNEL_PROGRAM: Record<number, number> = Object.fromEntries(
  Object.entries(ROLE_CHANNEL).map(([role, channel]) => [
    channel,
    ROLE_PROGRAM[role] ?? 0,
  ]),
)

const ROLE_KIND: Record<string, SynthKind> = {
  melody: "lead",
  guitar: "arp",
  pad: "pad",
  bass: "bass",
  texture: "pad",
}

function midiToHz(noteNumber: number): number {
  return 440 * 2 ** ((noteNumber - 69) / 12)
}

let shared: JamAudioEngine | null = null
export function getJamAudioEngine(): JamAudioEngine {
  if (!shared) shared = new JamAudioEngine()
  return shared
}

interface ThereminVoice {
  osc: OscillatorNode
  gain: GainNode
  filter: BiquadFilterNode
  vibrato: OscillatorNode
  vibratoGain: GainNode
}

export class JamAudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private sfPlayer: SynthNotePlayer | null = null
  private theremin: ThereminVoice | null = null

  setSoundFontPlayer(p: SynthNotePlayer | null) {
    this.sfPlayer = p
  }

  // Lets the jam engine share the app's AudioContext so the look-ahead
  // scheduler and the SoundFont synth run on the very same clock.
  adoptContext(ctx: AudioContext) {
    if (this.ctx === ctx) return
    this.ctx = ctx
    this.master = null
    this.noiseBuf = null
    this.theremin = null
    this.ensureContext()
  }

  ensureContext(): AudioContext {
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      this.ctx = new AC()
    }
    if (!this.master) {
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.9
      const comp = this.ctx.createDynamicsCompressor()
      this.master.connect(comp)
      comp.connect(this.ctx.destination)
    }
    if (this.ctx.state === "suspended") void this.ctx.resume()
    return this.ctx
  }

  now(): number {
    return this.ensureContext().currentTime
  }

  private getNoise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuf) {
      const len = ctx.sampleRate
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    }
    return this.noiseBuf
  }

  // ---- Drums: pure DSP synthesis ----

  playDrumAt(time: number, zoneId: string, velocity: number) {
    const ctx = this.ensureContext()
    const t = Math.max(time, ctx.currentTime + 0.001)
    const v = Math.max(0.05, velocity / 127)
    const out = this.master as GainNode

    switch (zoneId) {
      case "kick": {
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = "sine"
        osc.frequency.setValueAtTime(160, t)
        osc.frequency.exponentialRampToValueAtTime(45, t + 0.09)
        g.gain.setValueAtTime(v, t)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
        osc.connect(g).connect(out)
        osc.start(t)
        osc.stop(t + 0.4)
        break
      }
      case "snare": {
        const noise = ctx.createBufferSource()
        noise.buffer = this.getNoise(ctx)
        const bp = ctx.createBiquadFilter()
        bp.type = "bandpass"
        bp.frequency.value = 1800
        bp.Q.value = 0.9
        const ng = ctx.createGain()
        ng.gain.setValueAtTime(v * 0.8, t)
        ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
        noise.connect(bp).connect(ng).connect(out)
        noise.start(t)
        noise.stop(t + 0.2)
        const body = ctx.createOscillator()
        body.type = "triangle"
        body.frequency.value = 190
        const bg = ctx.createGain()
        bg.gain.setValueAtTime(v * 0.5, t)
        bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.08)
        body.connect(bg).connect(out)
        body.start(t)
        body.stop(t + 0.1)
        break
      }
      case "hihat": {
        const noise = ctx.createBufferSource()
        noise.buffer = this.getNoise(ctx)
        const hp = ctx.createBiquadFilter()
        hp.type = "highpass"
        hp.frequency.value = 7500
        const g = ctx.createGain()
        g.gain.setValueAtTime(v * 0.45, t)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
        noise.connect(hp).connect(g).connect(out)
        noise.start(t)
        noise.stop(t + 0.08)
        break
      }
      case "tom": {
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = "sine"
        osc.frequency.setValueAtTime(130, t)
        osc.frequency.exponentialRampToValueAtTime(75, t + 0.12)
        g.gain.setValueAtTime(v * 0.9, t)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
        osc.connect(g).connect(out)
        osc.start(t)
        osc.stop(t + 0.32)
        break
      }
      case "clap": {
        for (let i = 0; i < 3; i++) {
          const noise = ctx.createBufferSource()
          noise.buffer = this.getNoise(ctx)
          const bp = ctx.createBiquadFilter()
          bp.type = "bandpass"
          bp.frequency.value = 1100
          bp.Q.value = 2
          const g = ctx.createGain()
          const st = t + i * 0.013
          g.gain.setValueAtTime(v * 0.6, st)
          g.gain.exponentialRampToValueAtTime(0.0001, st + 0.09)
          noise.connect(bp).connect(g).connect(out)
          noise.start(st)
          noise.stop(st + 0.12)
        }
        break
      }
      default: {
        this.playDrumAt(time, "hihat", velocity)
      }
    }
  }

  // ---- Melodic synth voices ----

  // Shapes a voice's gain: plain attack/release without a shape, or the
  // event's normalized envelope sampled onto the AudioParam timeline.
  private applyGainEnvelope(
    env: GainNode,
    t: number,
    durSec: number,
    peak: number,
    attack: number,
    release: number,
    shape?: GainShapePoint[],
  ) {
    const stopAt = t + durSec
    if (!shape || shape.length < 2) {
      env.gain.setValueAtTime(0.0001, t)
      env.gain.linearRampToValueAtTime(peak, t + attack)
      env.gain.setTargetAtTime(0.0001, stopAt, release)
      return
    }
    const level = (v: number) =>
      Math.max(0.0001, peak * Math.min(1, Math.max(0, v)))
    env.gain.setValueAtTime(level(shape[0].v), t)
    for (const point of shape.slice(1)) {
      env.gain.linearRampToValueAtTime(
        level(point.v),
        t + Math.min(1, Math.max(0, point.t)) * durSec,
      )
    }
    env.gain.setTargetAtTime(0.0001, stopAt, release)
  }

  playSynthNoteAt(
    time: number,
    noteNumber: number,
    velocity: number,
    durSec: number,
    kind: SynthKind,
    /** Optional normalized gain shape ({t, v} in 0..1) applied over the note */
    shape?: GainShapePoint[],
  ) {
    const ctx = this.ensureContext()
    const t = Math.max(time, ctx.currentTime + 0.001)
    const v = velocity / 127
    const f = midiToHz(noteNumber)
    const out = this.master as GainNode

    const env = ctx.createGain()
    env.connect(out)

    const stopAt = t + durSec

    if (kind === "bass") {
      const o1 = ctx.createOscillator()
      o1.type = "sine"
      o1.frequency.value = f
      const o2 = ctx.createOscillator()
      o2.type = "sawtooth"
      o2.frequency.value = f
      const o2g = ctx.createGain()
      o2g.gain.value = 0.25
      const lp = ctx.createBiquadFilter()
      lp.type = "lowpass"
      lp.frequency.value = 500
      o1.connect(lp)
      o2.connect(o2g).connect(lp)
      lp.connect(env)
      this.applyGainEnvelope(env, t, durSec, v * 0.85, 0.012, 0.06, shape)
      o1.start(t)
      o2.start(t)
      o1.stop(stopAt + 0.3)
      o2.stop(stopAt + 0.3)
    } else if (kind === "pad") {
      const lp = ctx.createBiquadFilter()
      lp.type = "lowpass"
      lp.frequency.value = 1400
      lp.connect(env)
      for (const det of [-8, 8]) {
        const o = ctx.createOscillator()
        o.type = "sawtooth"
        o.frequency.value = f
        o.detune.value = det
        o.connect(lp)
        o.start(t)
        o.stop(stopAt + 1.2)
      }
      this.applyGainEnvelope(env, t, durSec, v * 0.3, 0.35, 0.25, shape)
    } else if (kind === "arp") {
      const o = ctx.createOscillator()
      o.type = "square"
      o.frequency.value = f
      const lp = ctx.createBiquadFilter()
      lp.type = "lowpass"
      lp.frequency.value = 2200
      o.connect(lp).connect(env)
      this.applyGainEnvelope(env, t, durSec, v * 0.4, 0.004, 0.04, shape)
      o.start(t)
      o.stop(stopAt + 0.25)
    } else {
      // lead
      const o = ctx.createOscillator()
      o.type = "sawtooth"
      o.frequency.value = f
      const lp = ctx.createBiquadFilter()
      lp.type = "lowpass"
      lp.frequency.setValueAtTime(3200, t)
      lp.frequency.exponentialRampToValueAtTime(1400, t + Math.min(durSec, 0.4))
      o.connect(lp).connect(env)
      this.applyGainEnvelope(env, t, durSec, v * 0.5, 0.006, 0.05, shape)
      o.start(t)
      o.stop(stopAt + 0.3)
    }
  }

  // Routes through existing SoundFont playback when available,
  // falls back to internal synth on any failure.
  playMelodicNoteAt(
    time: number,
    take: MusePerformanceTake,
    noteNumber: number,
    velocity: number,
    durSec: number,
  ) {
    const kind = ROLE_KIND[take.role] ?? "lead"
    const channel = ROLE_CHANNEL[take.role] ?? 0
    if (this.sfPlayer) {
      try {
        if (
          this.sfPlayer(time, channel, noteNumber, velocity, durSec) !== false
        )
          return
      } catch {
        this.sfPlayer = null
      }
    }
    this.playSynthNoteAt(time, noteNumber, velocity, durSec, kind)
  }

  // ---- Theremin voice: persistent oscillator with portamento + vibrato ----

  thereminOn(noteNumber: number, velocity: number) {
    const ctx = this.ensureContext()
    this.thereminOff()
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = "sawtooth"
    osc.frequency.value = midiToHz(noteNumber)
    const filter = ctx.createBiquadFilter()
    filter.type = "lowpass"
    filter.frequency.value = 1600
    filter.Q.value = 2
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.linearRampToValueAtTime((velocity / 127) * 0.4, t + 0.03)
    const vibrato = ctx.createOscillator()
    vibrato.type = "sine"
    vibrato.frequency.value = 5.5
    const vibratoGain = ctx.createGain()
    vibratoGain.gain.value = 8 // cents
    vibrato.connect(vibratoGain).connect(osc.detune)
    osc
      .connect(filter)
      .connect(gain)
      .connect(this.master as GainNode)
    osc.start(t)
    vibrato.start(t)
    this.theremin = { osc, gain, filter, vibrato, vibratoGain }
  }

  thereminSet(noteNumber: number) {
    if (!this.theremin) return
    this.theremin.osc.frequency.setTargetAtTime(
      midiToHz(noteNumber),
      this.ensureContext().currentTime,
      0.035,
    )
  }

  thereminVibrato(cents: number) {
    if (!this.theremin) return
    this.theremin.vibratoGain.gain.setTargetAtTime(
      cents,
      this.ensureContext().currentTime,
      0.05,
    )
  }

  thereminOff() {
    if (!this.theremin) return
    const { osc, gain, vibrato } = this.theremin
    const t = this.ensureContext().currentTime
    gain.gain.setTargetAtTime(0.0001, t, 0.03)
    osc.stop(t + 0.2)
    vibrato.stop(t + 0.2)
    this.theremin = null
  }
}
