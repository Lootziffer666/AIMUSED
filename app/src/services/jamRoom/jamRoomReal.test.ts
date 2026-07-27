import { describe, expect, it } from "vitest"
import type {
  MusePerformanceNote,
  MusePerformanceTake,
} from "../../entities/performance/MusePerformanceTake"
import { LoopScheduler } from "./audio/LoopScheduler"
import {
  autoCorrelate,
  hzToMidi,
  stabilityConfidence,
} from "./audio/pitchDetect"
import { MelodyTracker } from "./audio/VoiceAnalyzer"
import {
  buildScaleNotes,
  handleMicError,
  quantizeTick,
  velocityFromPointerSpeed,
} from "./inputMapping"
import { generateAccompaniment } from "./music/AccompanimentGenerator"
import {
  chooseChord,
  detectKey,
  pitchClassHistogram,
} from "./music/KeyAndChords"
import { hasMelodicTake, undoLastTake, wrapTick } from "./takeOps"

function sine(hz: number, sampleRate = 48000, n = 2048): Float32Array {
  const buf = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    buf[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / sampleRate)
  }
  return buf
}

describe("Pitch detection (real DSP)", () => {
  it("detects A4 = 440 Hz as MIDI 69", () => {
    const hz = autoCorrelate(sine(440), 48000)
    expect(hz).toBeGreaterThan(0)
    expect(Math.abs(hzToMidi(hz) - 69)).toBeLessThan(0.5)
  })

  it("detects A3 = 220 Hz as MIDI 57", () => {
    const hz = autoCorrelate(sine(220), 48000)
    expect(Math.abs(hzToMidi(hz) - 57)).toBeLessThan(0.5)
  })

  it("returns -1 for silence", () => {
    expect(autoCorrelate(new Float32Array(2048), 48000)).toBe(-1)
  })

  it("rates stable pitch more confident than jittery pitch", () => {
    const stable = new Array(20).fill(440)
    const jittery = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? 420 : 460,
    )
    expect(stabilityConfidence(stable)).toBeGreaterThan(0.9)
    expect(stabilityConfidence(jittery)).toBeLessThan(0.8)
  })
})

describe("Melody tracker (real segmentation)", () => {
  it("splits two sung notes separated by a gap", () => {
    const tracker = new MelodyTracker()
    const fps = 60
    // 0.30 s of A4, 0.15 s silence, 0.30 s of E4
    for (let i = 0; i < 0.3 * fps; i++) {
      tracker.addFrame({ time: i / fps, hz: 440, midi: 69, rms: 0.2 })
    }
    for (let i = 0; i < 0.15 * fps; i++) {
      tracker.addFrame({
        time: (0.3 * fps + i) / fps,
        hz: null,
        midi: null,
        rms: 0.005,
      })
    }
    const t0 = 0.45
    for (let i = 0; i < 0.3 * fps; i++) {
      tracker.addFrame({ time: t0 + i / fps, hz: 329.6, midi: 64, rms: 0.2 })
    }
    const notes = tracker.finish()
    expect(notes).toHaveLength(2)
    expect(Math.round(notes[0].midi)).toBe(69)
    expect(Math.round(notes[1].midi)).toBe(64)
    expect(notes[0].endSec - notes[0].startSec).toBeGreaterThan(0.2)
  })

  it("drops notes shorter than minimum duration", () => {
    const tracker = new MelodyTracker()
    for (let i = 0; i < 4; i++) {
      tracker.addFrame({ time: i / 60, hz: 440, midi: 69, rms: 0.2 })
    }
    expect(tracker.finish()).toHaveLength(0)
  })
})

describe("Key detection (Krumhansl-Schmuckler)", () => {
  it("detects C major from a C major melody", () => {
    const notes: MusePerformanceNote[] = [
      60, 60, 64, 64, 67, 67, 60, 62, 65, 69, 71,
    ].map((n, i) => ({
      tick: i * 240,
      duration: 240,
      noteNumber: n,
      velocity: 80,
    }))
    const key = detectKey(pitchClassHistogram(notes))
    expect(key.root).toBe(0)
    expect(key.mode).toBe("major")
  })

  it("detects A minor from an A minor melody", () => {
    const notes: MusePerformanceNote[] = [
      69, 69, 72, 72, 76, 76, 69, 71, 74, 69, 67,
    ].map((n, i) => ({
      tick: i * 240,
      duration: 240,
      noteNumber: n,
      velocity: 80,
    }))
    const key = detectKey(pitchClassHistogram(notes))
    expect(key.root).toBe(9)
    expect(key.mode).toBe("minor")
  })
})

describe("Chord choice", () => {
  it("chooses tonic for a bar full of tonic notes", () => {
    const weights = new Array(12).fill(0)
    weights[0] = 4 // C
    weights[4] = 3 // E
    weights[7] = 3 // G
    expect(chooseChord(weights, 0, "major").name).toBe("I")
  })

  it("chooses dominant when melody emphasizes G-B-D", () => {
    const weights = new Array(12).fill(0)
    weights[7] = 4 // G
    weights[11] = 3 // B
    weights[2] = 3 // D
    expect(chooseChord(weights, 0, "major").name).toBe("V")
  })
})

describe("Accompaniment generator (real arrangement)", () => {
  const melody: MusePerformanceNote[] = [60, 64, 67].map((n, i) => ({
    tick: i * 480,
    duration: 480,
    noteNumber: n,
    velocity: 80,
  }))
  const opts = {
    melodyNotes: melody,
    keyRoot: 0,
    mode: "major" as const,
    timebase: 480,
    loopLengthTicks: 7680,
  }

  it("intensity 1 produces bass only", () => {
    const takes = generateAccompaniment({ ...opts, intensity: 1 })
    expect(takes).toHaveLength(1)
    expect(takes[0].role).toBe("bass")
    expect(takes[0].generatedBy).toBe("muse")
  })

  it("intensity 2 adds pad", () => {
    const takes = generateAccompaniment({ ...opts, intensity: 2 })
    expect(takes.map((t) => t.role)).toEqual(["bass", "pad"])
  })

  it("intensity 3 adds guitar arpeggio", () => {
    const takes = generateAccompaniment({ ...opts, intensity: 3 })
    expect(takes.map((t) => t.role)).toEqual(["bass", "pad", "guitar"])
  })

  it("all generated notes stay inside the key", () => {
    const takes = generateAccompaniment({ ...opts, intensity: 3 })
    const scalePcs = new Set([0, 2, 4, 5, 7, 9, 11])
    for (const take of takes) {
      for (const n of take.notes) {
        expect(scalePcs.has(n.noteNumber % 12)).toBe(true)
      }
    }
  })
})

describe("Loop scheduler math", () => {
  it("computes correct timing at 120 bpm / 480 timebase", () => {
    const s = new LoopScheduler({} as never, 480, 120)
    expect(s.secondsPerTick).toBeCloseTo(60 / 120 / 480)
    expect(s.stepTicks).toBe(120)
    expect(s.stepsPerLoop).toBe(64)
    expect(s.loopSeconds).toBeCloseTo(8.0) // 4 bars at 120 bpm
  })
})

describe("Input mapping", () => {
  it("maps pointer speed to velocity with clamping", () => {
    expect(velocityFromPointerSpeed(0)).toBe(25)
    expect(velocityFromPointerSpeed(1)).toBe(70)
    expect(velocityFromPointerSpeed(10)).toBe(127)
  })

  it("quantizes ticks to grid", () => {
    expect(quantizeTick(500, 480)).toBe(480)
    expect(quantizeTick(1000, 480)).toBe(960)
  })

  it("builds scale-bound note lanes", () => {
    // baseOctave 4 == C4 == MIDI 60 (scientific pitch notation)
    const notes = buildScaleNotes(0, "major", 10, 4)
    expect(notes).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 74, 76])
    expect(buildScaleNotes(9, "minor", 3, 3)[0]).toBe(57) // A3
  })

  it("names a localization key for every mic error", () => {
    expect(handleMicError({ name: "NotAllowedError" })).toBe("mic-denied")
    expect(handleMicError({ name: "NotFoundError" })).toBe("mic-not-found")
    expect(handleMicError(null)).toBe("mic-error")
  })
})

describe("Take operations", () => {
  const userTake = (id: string): MusePerformanceTake => ({
    id,
    source: "voice",
    notes: [],
    drumHits: [],
    controls: [],
    confidence: 1,
    role: "melody",
    loopStartTick: 0,
    loopLengthTicks: 7680,
    createdAt: "",
    generatedBy: "user",
  })
  const museTake = (id: string): MusePerformanceTake => ({
    ...userTake(id),
    role: "bass",
    generatedBy: "muse",
  })

  it("undo removes last user take, keeps others", () => {
    const result = undoLastTake([userTake("a"), museTake("m1"), userTake("b")])
    expect(result.map((t) => t.id)).toEqual(["a", "m1"])
  })

  it("undo removes muse layers when no user take remains", () => {
    const result = undoLastTake([userTake("a"), museTake("m1")])
    expect(result).toHaveLength(0)
  })

  it("detects melodic takes", () => {
    expect(hasMelodicTake([{ ...userTake("a"), notes: [] }])).toBe(false)
    expect(
      hasMelodicTake([
        {
          ...userTake("a"),
          notes: [{ tick: 0, duration: 240, noteNumber: 60, velocity: 80 }],
        },
      ]),
    ).toBe(true)
    expect(hasMelodicTake([museTake("m")])).toBe(false)
    expect(hasMelodicTake([])).toBe(false)
  })

  it("wraps ticks into loop range", () => {
    expect(wrapTick(-10, 7680)).toBe(7670)
    expect(wrapTick(7700, 7680)).toBe(20)
  })
})
