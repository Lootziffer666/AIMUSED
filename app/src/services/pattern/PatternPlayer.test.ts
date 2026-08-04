import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { JamAudioEngine } from "../jamRoom/audio/JamAudioEngine"
import { createEnvelope } from "./envelope"
import {
  CC_EXPRESSION,
  CC_MODULATION,
  PatternPlayer,
  type PatternPlayerDeps,
} from "./PatternPlayer"
import {
  addLayer,
  addNote,
  createPattern,
  setNoteEnvelope,
  setPatternSteps,
  toggleLayerFlag,
} from "./patternOps"

interface ChannelEvent {
  subtype?: string
  channel?: number
  noteNumber?: number
  velocity?: number
  controllerType?: number
  value?: number
}

function setup(options: { soundFont: boolean }) {
  let now = 0
  const engine = {
    ensureContext: vi.fn(),
    now: () => now,
    playDrumAt: vi.fn(),
    playSynthNoteAt: vi.fn(),
  } as unknown as JamAudioEngine

  const sent: { event: ChannelEvent; delay: number }[] = []
  const allSoundsOff = vi.fn()
  const deps: PatternPlayerDeps = {
    engine,
    sendEvent: (event, delay) =>
      sent.push({ event: event as ChannelEvent, delay }),
    allSoundsOff,
    isSoundFontReady: () => options.soundFont,
    activate: vi.fn(),
  }

  return {
    deps,
    engine,
    sent,
    allSoundsOff,
    advance(seconds: number) {
      // move the audio clock and let the look-ahead timer fire
      const stepMs = 25
      const steps = Math.max(1, Math.round((seconds * 1000) / stepMs))
      for (let i = 0; i < steps; i++) {
        now += stepMs / 1000
        vi.advanceTimersByTime(stepMs)
      }
    },
  }
}

function demoPattern() {
  // 4 steps at 1/16, timebase 480 -> 120 ticks per step
  let pattern = createPattern({ timebase: 480, steps: 4 })
  const piano = pattern.trackLayers[0].id
  pattern = addLayer(pattern, {
    name: "Kick",
    kind: "percussion",
    drumZoneId: "kick",
  })
  const kick = pattern.trackLayers[1].id
  const added = addNote(pattern, piano, {
    startTick: 0,
    durationTicks: 240,
    noteNumber: 60,
    velocity: 100,
  })
  pattern = added.pattern
  pattern = addNote(pattern, kick, { startTick: 0, noteNumber: 60 }).pattern
  return { pattern, piano, kick, noteId: added.noteId as string }
}

describe("PatternPlayer", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("plays melodic and percussion layers together", () => {
    const { deps, engine, sent, advance } = setup({ soundFont: true })
    const { pattern } = demoPattern()
    const player = new PatternPlayer(deps, pattern, 120)

    player.start()
    advance(0.3)
    player.stop()

    const noteOns = sent.filter((s) => s.event.subtype === "noteOn")
    expect(noteOns.length).toBeGreaterThan(0)
    expect(noteOns[0].event.noteNumber).toBe(60)
    expect(engine.playDrumAt).toHaveBeenCalled()
  })

  it("ends every note it started and leaves nothing hanging on stop", () => {
    const { deps, sent, allSoundsOff, advance } = setup({ soundFont: true })
    const { pattern } = demoPattern()
    const player = new PatternPlayer(deps, pattern, 120)

    player.start()
    advance(0.4)
    player.stop()

    const ons = sent.filter((s) => s.event.subtype === "noteOn").length
    const offs = sent.filter((s) => s.event.subtype === "noteOff").length
    expect(offs).toBe(ons)
    expect(allSoundsOff).toHaveBeenCalled()
    expect(player.isPlaying).toBe(false)
  })

  it("sends the volume curve as expression controllers", () => {
    const { deps, sent, advance } = setup({ soundFont: true })
    const { pattern, piano, noteId } = demoPattern()
    const shaped = setNoteEnvelope(
      pattern,
      piano,
      noteId,
      "volumeEnvelope",
      createEnvelope("fade-in"),
    )
    const player = new PatternPlayer(deps, shaped, 120)

    player.start()
    advance(0.3)
    player.stop()

    const expression = sent.filter(
      (s) =>
        s.event.subtype === "controller" &&
        s.event.controllerType === CC_EXPRESSION,
    )
    expect(expression.length).toBeGreaterThan(4)
    const values = expression.map((s) => s.event.value ?? 0)
    expect(Math.min(...values)).toBeLessThan(20)
    expect(Math.max(...values)).toBe(127)
    // the ramp is spread across the note, not sent all at once
    expect(new Set(expression.map((s) => s.delay)).size).toBeGreaterThan(4)
  })

  it("sends the expression curve as modulation", () => {
    const { deps, sent, advance } = setup({ soundFont: true })
    const { pattern, piano, noteId } = demoPattern()
    const shaped = setNoteEnvelope(
      pattern,
      piano,
      noteId,
      "expressionEnvelope",
      createEnvelope("swell"),
    )
    const player = new PatternPlayer(deps, shaped, 120)

    player.start()
    advance(0.3)
    player.stop()

    expect(
      sent.some(
        (s) =>
          s.event.subtype === "controller" &&
          s.event.controllerType === CC_MODULATION,
      ),
    ).toBe(true)
  })

  it("shapes the internal voice when no SoundFont is loaded", () => {
    const { deps, engine, sent, advance } = setup({ soundFont: false })
    const { pattern, piano, noteId } = demoPattern()
    const shaped = setNoteEnvelope(
      pattern,
      piano,
      noteId,
      "volumeEnvelope",
      createEnvelope("fade-out"),
    )
    const player = new PatternPlayer(deps, shaped, 120)

    player.start()
    advance(0.3)
    player.stop()

    expect(sent).toHaveLength(0) // nothing goes to the SoundFont player
    expect(engine.playSynthNoteAt).toHaveBeenCalled()
    const call = (
      engine.playSynthNoteAt as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0]
    const shape = call[5] as { t: number; v: number }[]
    expect(shape.length).toBeGreaterThan(4)
    expect(shape[0].v).toBeGreaterThan(shape[shape.length - 1].v)
  })

  it("does not play muted layers or events behind the end marker", () => {
    const { deps, engine, sent, advance } = setup({ soundFont: true })
    let { pattern, kick, piano } = demoPattern()
    // an event beyond the (shortened) pattern end
    pattern = addNote(pattern, piano, {
      startTick: 120 * 10,
      noteNumber: 72,
    }).pattern
    pattern = setPatternSteps(pattern, 4)
    pattern = toggleLayerFlag(pattern, kick, "muted")

    const player = new PatternPlayer(deps, pattern, 120)
    player.start()
    advance(0.6)
    player.stop()

    expect(engine.playDrumAt).not.toHaveBeenCalled()
    expect(
      sent.some(
        (s) => s.event.subtype === "noteOn" && s.event.noteNumber === 72,
      ),
    ).toBe(false)
  })

  it("keeps looping on the pattern length", () => {
    const { deps, sent, advance } = setup({ soundFont: true })
    const { pattern } = demoPattern() // 4 steps at 120 bpm = 0.5 s
    const player = new PatternPlayer(deps, pattern, 120)
    const loops: number[] = []
    player.onLoopComplete = (index) => loops.push(index)

    player.start()
    advance(1.4)
    player.stop()

    expect(loops.length).toBeGreaterThanOrEqual(2)
    const noteOns = sent.filter((s) => s.event.subtype === "noteOn")
    expect(noteOns.length).toBeGreaterThanOrEqual(2)
  })

  it("gives each melodic layer its own channel", () => {
    const { deps } = setup({ soundFont: true })
    let { pattern, piano, kick } = demoPattern()
    pattern = addLayer(pattern, {
      name: "Violine",
      kind: "melodic",
      program: 40,
    })
    const violin = pattern.trackLayers[2].id
    const player = new PatternPlayer(deps, pattern, 120)

    expect(player.channelForLayer(piano)).not.toBe(
      player.channelForLayer(violin),
    )
    expect(player.channelForLayer(kick)).toBe(9)
  })
})
