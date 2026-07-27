import { describe, expect, it } from "vitest"
import {
  codesByNote,
  isBlackKey,
  keyLayout,
  labelForCode,
  noteForCode,
  semitoneForCode,
} from "./keyboardPiano"
import { PatternRecording, pressDuration, pressToNote } from "./patternRecorder"

describe("computer keyboard mapping", () => {
  it("puts a chromatic octave under the bottom two rows", () => {
    const white = ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM"]
    expect(white.map(semitoneForCode)).toEqual([0, 2, 4, 5, 7, 9, 11])
    const black = ["KeyS", "KeyD", "KeyG", "KeyH", "KeyJ"]
    expect(black.map(semitoneForCode)).toEqual([1, 3, 6, 8, 10])
  })

  it("starts the second row an octave up", () => {
    expect(semitoneForCode("KeyQ")).toBe(12)
    expect(semitoneForCode("KeyZ")).toBe(0)
  })

  it("ignores keys that are not part of the piano", () => {
    expect(semitoneForCode("Space")).toBeUndefined()
    expect(noteForCode("Escape", 60)).toBeUndefined()
  })

  it("stays inside the MIDI range", () => {
    expect(noteForCode("KeyZ", 0)).toBe(0)
    expect(noteForCode("BracketRight", 120)).toBeUndefined()
  })

  it("prefers the real key label over the US one", () => {
    const layout = new Map([["KeyZ", "y"]])
    expect(labelForCode("KeyZ", layout)).toBe("Y")
    expect(labelForCode("KeyZ", null)).toBe("Z")
    expect(labelForCode("Comma", null)).toBe(",")
    expect(labelForCode("Digit2", null)).toBe("2")
    expect(labelForCode("F13", null)).toBe("")
  })

  it("labels each note once, with the lower row winning the overlap", () => {
    const byNote = codesByNote(48)
    expect(byNote.get(48)).toBe("KeyZ")
    // 60 is reachable from Comma (lower row) and KeyQ (upper row)
    expect(byNote.get(60)).toBe("Comma")
  })
})

describe("keyLayout", () => {
  it("hangs a black key over every seam that has one", () => {
    const { white, blackAfter } = keyLayout(60, 1)
    expect(white).toEqual([60, 62, 64, 65, 67, 69, 71])
    // no black key after E (64) and after the last key
    expect(blackAfter).toEqual([61, 63, null, 66, 68, 70, null])
  })

  it("repeats over several octaves", () => {
    const { white } = keyLayout(48, 3)
    expect(white).toHaveLength(21)
    expect(white[0]).toBe(48)
    expect(white[20]).toBe(83)
  })

  it("knows the black keys", () => {
    expect([61, 63, 66, 68, 70].every(isBlackKey)).toBe(true)
    expect([60, 62, 64, 65, 67, 69, 71].some(isBlackKey)).toBe(false)
  })

  it("stops at the top of the MIDI range", () => {
    const { white } = keyLayout(120, 3)
    expect(white.every((n) => n <= 127)).toBe(true)
  })
})

describe("pressDuration", () => {
  it("measures a press inside the loop", () => {
    expect(pressDuration(120, 480, 1920)).toBe(360)
  })

  it("counts a press that wraps around the end marker as forward time", () => {
    // pressed just before the end, released after the loop restarted
    expect(pressDuration(1800, 240, 1920)).toBe(360)
  })

  it("reads a release in the same tick as a tap, not as a whole loop", () => {
    expect(pressDuration(480, 480, 1920)).toBe(0)
  })
})

describe("pressToNote", () => {
  const options = { lengthTicks: 1920, step: 120, quantize: true }

  it("snaps a slightly early note onto the beat", () => {
    const note = pressToNote(
      { noteNumber: 60, startTick: 470, endTick: 590, velocity: 90 },
      options,
    )
    expect(note.startTick).toBe(480)
    expect(note.durationTicks).toBe(120)
  })

  it("never quantizes a note down to nothing", () => {
    const note = pressToNote(
      { noteNumber: 60, startTick: 480, endTick: 500, velocity: 90 },
      options,
    )
    expect(note.durationTicks).toBe(120)
  })

  it("wraps a note nudged past the end marker to the start of the loop", () => {
    const note = pressToNote(
      { noteNumber: 60, startTick: 1900, endTick: 1910, velocity: 90 },
      options,
    )
    expect(note.startTick).toBe(0)
  })

  it("keeps the played timing when quantizing is off", () => {
    const note = pressToNote(
      { noteNumber: 60, startTick: 473, endTick: 611, velocity: 77 },
      { ...options, quantize: false },
    )
    expect(note).toEqual({
      startTick: 473,
      durationTicks: 138,
      noteNumber: 60,
      velocity: 77,
    })
  })

  it("keeps a held note held across the seam", () => {
    const note = pressToNote(
      { noteNumber: 60, startTick: 1680, endTick: 240, velocity: 90 },
      options,
    )
    expect(note.startTick).toBe(1680)
    expect(note.durationTicks).toBe(480)
  })
})

describe("PatternRecording", () => {
  const options = { lengthTicks: 1920, step: 120, quantize: true }

  it("pairs a release with its press", () => {
    const recording = new PatternRecording()
    recording.start(60, 0, 100)
    expect(recording.isHeld(60)).toBe(true)
    const note = recording.finish(60, 240, options)
    expect(note?.noteNumber).toBe(60)
    expect(note?.durationTicks).toBe(240)
    expect(recording.isHeld(60)).toBe(false)
  })

  it("ignores a release for a key that was never pressed", () => {
    expect(new PatternRecording().finish(60, 100, options)).toBeNull()
  })

  it("lets a repeated press replace the open one instead of stacking", () => {
    const recording = new PatternRecording()
    recording.start(60, 0, 100)
    recording.start(60, 480, 100)
    expect(recording.pending).toEqual([60])
    expect(recording.finish(60, 600, options)?.startTick).toBe(480)
  })

  it("closes keys that were still down when the transport stopped", () => {
    const recording = new PatternRecording()
    recording.start(60, 0, 100)
    recording.start(64, 120, 100)
    const notes = recording.finishAll(480, options)
    expect(notes.map((n) => n.noteNumber).sort()).toEqual([60, 64])
    expect(recording.pending).toEqual([])
  })

  it("keeps several keys apart while a chord is held", () => {
    const recording = new PatternRecording()
    recording.start(60, 0, 100)
    recording.start(64, 0, 100)
    recording.start(67, 0, 100)
    expect(recording.finish(64, 240, options)?.noteNumber).toBe(64)
    expect(recording.pending.sort()).toEqual([60, 67])
  })
})
