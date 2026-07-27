import type { SendableEvent } from "@signal-app/player"
import type { MusePattern } from "../../entities/pattern/MusePattern"
import type {
  GainShapePoint,
  JamAudioEngine,
  SynthKind,
} from "../jamRoom/audio/JamAudioEngine"
import { sampleEnvelopeCurve } from "./envelope"
import {
  collectPatternEvents,
  effectiveVelocity,
  envelopeSteps,
  noteNumberFor,
  type ScheduledPatternNote,
} from "./patternPlayback"

/**
 * Look-ahead scheduler for a single pattern.
 *
 * Runs on the shared MUSE AudioContext clock (via JamAudioEngine, which
 * adopts the RootStore context) and routes notes through the existing
 * SoundFont player when one is loaded, otherwise through the engine's own
 * voices. It never touches the song: preview creates no tracks.
 */

export const PERCUSSION_CHANNEL = 9

/** Channels handed out to melodic layers, drum channel excluded. */
const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]

/** MIDI controllers used for the two event envelopes */
export const CC_EXPRESSION = 11
export const CC_MODULATION = 1

export interface PatternPlayerDeps {
  engine: JamAudioEngine
  /** delaySeconds is relative to the engine clock */
  sendEvent: (event: SendableEvent, delaySeconds: number) => void
  allSoundsOff: (channel: number) => void
  isSoundFontReady: () => boolean
  activate: () => void
}

const KIND_BY_PROGRAM = (program: number | undefined): SynthKind => {
  if (program === undefined) return "lead"
  if (program >= 32 && program <= 39) return "bass"
  if (program >= 88 && program <= 95) return "pad"
  if (program >= 24 && program <= 31) return "arp"
  return "lead"
}

export class PatternPlayer {
  pattern: MusePattern
  bpm: number
  loop = true
  onPosition?: (tick: number) => void
  onLoopComplete?: (index: number) => void
  onStop?: () => void

  private deps: PatternPlayerDeps
  private timer: number | null = null
  private loopStartTime = 0
  private nextTick = 0
  private loopIndex = 0
  private usedChannels = new Set<number>()
  private readonly lookAheadSec = 0.15
  private readonly intervalMs = 25

  constructor(deps: PatternPlayerDeps, pattern: MusePattern, bpm: number) {
    this.deps = deps
    this.pattern = pattern
    this.bpm = bpm
  }

  get isPlaying(): boolean {
    return this.timer !== null
  }

  get secondsPerTick(): number {
    return 60 / this.bpm / this.pattern.timebase
  }

  /** Channel a layer plays on – stable for the lifetime of the pattern. */
  channelForLayer(layerId: string): number {
    const layers = this.pattern.trackLayers
    const layer = layers.find((l) => l.id === layerId)
    if (!layer || layer.kind !== "melodic") return PERCUSSION_CHANNEL
    const melodicIndex = layers
      .filter((l) => l.kind === "melodic")
      .findIndex((l) => l.id === layerId)
    return MELODIC_CHANNELS[Math.max(0, melodicIndex) % MELODIC_CHANNELS.length]
  }

  start() {
    if (this.timer !== null) return
    this.deps.engine.ensureContext()
    this.deps.activate()
    this.loopStartTime = this.deps.engine.now() + 0.08
    this.nextTick = 0
    this.loopIndex = 0
    this.timer = window.setInterval(this.tick, this.intervalMs)
  }

  stop() {
    if (this.timer === null) return
    clearInterval(this.timer)
    this.timer = null
    for (const channel of this.usedChannels) this.deps.allSoundsOff(channel)
    this.usedChannels.clear()
    this.onStop?.()
  }

  setBpm(bpm: number) {
    this.bpm = bpm
  }

  currentTick(): number {
    if (this.timer === null) return 0
    const elapsed = this.deps.engine.now() - this.loopStartTime
    const length = this.pattern.lengthTicks
    const ticks = elapsed / this.secondsPerTick
    if (!this.loop) return Math.min(length, Math.max(0, ticks))
    return ((ticks % length) + length) % length
  }

  private tick = () => {
    const length = this.pattern.lengthTicks
    // The horizon is recomputed every round: after a loop wrap `loopStartTime`
    // moves forward, and a stale horizon would keep the loop spinning.
    for (let guard = 0; guard < 256; guard++) {
      const horizonTicks =
        (this.deps.engine.now() + this.lookAheadSec - this.loopStartTime) /
        this.secondsPerTick
      if (this.nextTick >= horizonTicks) break

      const windowEnd = Math.min(this.nextTick + 24, horizonTicks, length)
      for (const event of collectPatternEvents(
        this.pattern,
        this.nextTick,
        windowEnd,
      )) {
        this.scheduleNote(event, this.loopStartTime)
      }
      this.nextTick = windowEnd

      if (this.nextTick >= length) {
        if (!this.loop) {
          this.onPosition?.(length)
          window.setTimeout(() => this.stop(), 200)
          return
        }
        this.nextTick = 0
        this.loopStartTime += length * this.secondsPerTick
        this.loopIndex += 1
        this.onLoopComplete?.(this.loopIndex)
      }
    }
    this.onPosition?.(this.currentTick())
  }

  private scheduleNote(event: ScheduledPatternNote, loopStart: number) {
    const spt = this.secondsPerTick
    const startTime = loopStart + event.startTick * spt
    const durationSec = Math.max(0.05, event.durationTicks * spt)
    const velocity = effectiveVelocity(event)

    if (event.layer.kind !== "melodic") {
      const volume = event.note.volumeEnvelope
        ? sampleEnvelopeCurve(event.note.volumeEnvelope, 9).reduce(
            (m, p) => Math.max(m, p.v),
            0,
          )
        : 1
      this.deps.engine.playDrumAt(
        startTime,
        event.layer.drumZoneId ?? "snare",
        Math.max(1, Math.round(velocity * volume)),
      )
      return
    }

    const channel = this.channelForLayer(event.layer.id)
    const noteNumber = noteNumberFor(event.layer, event.note)

    if (this.deps.isSoundFontReady()) {
      this.usedChannels.add(channel)
      const delay = Math.max(0, startTime - this.deps.engine.now())
      this.deps.sendEvent(
        {
          type: "channel",
          subtype: "programChange",
          channel,
          value: event.layer.program ?? 0,
        },
        delay,
      )
      this.sendEnvelope(event, channel, delay, "volumeEnvelope", CC_EXPRESSION)
      this.sendEnvelope(
        event,
        channel,
        delay,
        "expressionEnvelope",
        CC_MODULATION,
      )
      this.deps.sendEvent(
        { type: "channel", subtype: "noteOn", channel, noteNumber, velocity },
        delay,
      )
      this.deps.sendEvent(
        {
          type: "channel",
          subtype: "noteOff",
          channel,
          noteNumber,
          velocity: 0,
        },
        delay + durationSec,
      )
      // leave the channel at full expression for unshaped notes that follow
      if (event.note.volumeEnvelope) {
        this.deps.sendEvent(
          {
            type: "channel",
            subtype: "controller",
            channel,
            controllerType: CC_EXPRESSION,
            value: 127,
          },
          delay + durationSec + 0.01,
        )
      }
      return
    }

    // No SoundFont: the engine's own voices, shaped by the volume envelope
    const shape: GainShapePoint[] | undefined = event.note.volumeEnvelope
      ? sampleEnvelopeCurve(event.note.volumeEnvelope, 16)
      : undefined
    this.deps.engine.playSynthNoteAt(
      startTime,
      noteNumber,
      velocity,
      durationSec,
      KIND_BY_PROGRAM(event.layer.program),
      shape,
    )
  }

  private sendEnvelope(
    event: ScheduledPatternNote,
    channel: number,
    delay: number,
    which: "volumeEnvelope" | "expressionEnvelope",
    controllerType: number,
  ) {
    const steps = envelopeSteps(event, which)
    if (steps.length === 0) return
    const spt = this.secondsPerTick
    for (const step of steps) {
      this.deps.sendEvent(
        {
          type: "channel",
          subtype: "controller",
          channel,
          controllerType,
          value: step.value,
        },
        delay + step.tick * spt,
      )
    }
  }
}
