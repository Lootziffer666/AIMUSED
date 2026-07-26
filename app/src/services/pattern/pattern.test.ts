import { describe, expect, it } from "vitest"
import {
  audibleLayers,
  gridTicks,
  type MusePattern,
  stepCount,
} from "../../entities/pattern/MusePattern"
import { createEmptySongMakerPattern } from "../jamRoom/songMaker"
import {
  createEnvelope,
  envelopePeak,
  moveEnvelopePoint,
  normalizeEnvelope,
  sampleEnvelope,
  sampleEnvelopeCurve,
} from "./envelope"
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redo,
  undo,
} from "./patternHistory"
import {
  addLayer,
  addNote,
  createPattern,
  hasOverhang,
  moveNote,
  noteCount,
  overhangNotes,
  quantizeLayer,
  removeNote,
  resizeNote,
  resizeNoteStart,
  setGridDivision,
  setNoteEnvelope,
  setNotePitch,
  setPatternLength,
  setPatternSteps,
  toggleLayerFlag,
  trimOverhang,
  updateLayer,
} from "./patternOps"
import {
  collectPatternEvents,
  effectiveVelocity,
  envelopeSteps,
  noteNumberFor,
} from "./patternPlayback"
import { songMakerPatternToMusePattern } from "./songMakerMigration"

const TIMEBASE = 480

function patternWithLayers(): {
  pattern: MusePattern
  piano: string
  violin: string
} {
  let pattern = createPattern({ timebase: TIMEBASE, steps: 16 })
  const piano = pattern.trackLayers[0].id
  pattern = addLayer(pattern, { name: "Violine", kind: "melodic", program: 40 })
  const violin = pattern.trackLayers[1].id
  return { pattern, piano, violin }
}

describe("Pattern length", () => {
  it("supports free lengths, not just multiples of 16 steps", () => {
    const pattern = setPatternSteps(createPattern({ timebase: TIMEBASE }), 13)
    expect(stepCount(pattern)).toBe(13)
    expect(pattern.lengthTicks).toBe(13 * gridTicks(pattern))
  })

  it("grows and shrinks", () => {
    let pattern = createPattern({ timebase: TIMEBASE, steps: 16 })
    pattern = setPatternSteps(pattern, 32)
    expect(stepCount(pattern)).toBe(32)
    pattern = setPatternSteps(pattern, 4)
    expect(stepCount(pattern)).toBe(4)
  })

  it("never shrinks below a single grid step", () => {
    const pattern = setPatternLength(createPattern({ timebase: TIMEBASE }), 0)
    expect(pattern.lengthTicks).toBe(gridTicks(pattern))
  })

  it("keeps events beyond the end marker instead of deleting them", () => {
    const { pattern: base, piano } = patternWithLayers()
    const step = gridTicks(base)
    const withNotes = addNote(
      addNote(base, piano, { startTick: 0, noteNumber: 60 }).pattern,
      piano,
      { startTick: step * 14, noteNumber: 64 },
    ).pattern

    const shortened = setPatternSteps(withNotes, 8)
    expect(noteCount(shortened)).toBe(2)
    expect(hasOverhang(shortened)).toBe(true)
    expect(overhangNotes(shortened)).toHaveLength(1)

    const restored = setPatternSteps(shortened, 16)
    expect(hasOverhang(restored)).toBe(false)
    expect(noteCount(restored)).toBe(2)
  })

  it("only trims overhanging events on an explicit request", () => {
    const { pattern: base, piano } = patternWithLayers()
    const step = gridTicks(base)
    const withNotes = addNote(
      addNote(base, piano, { startTick: 0, noteNumber: 60 }).pattern,
      piano,
      { startTick: step * 20, noteNumber: 64 },
    ).pattern
    const trimmed = trimOverhang(setPatternSteps(withNotes, 8))
    expect(noteCount(trimmed)).toBe(1)
    expect(hasOverhang(trimmed)).toBe(false)
  })

  it("changing the grid keeps the musical length", () => {
    const pattern = createPattern({ timebase: TIMEBASE, steps: 16 })
    const finer = setGridDivision(pattern, 32)
    expect(finer.lengthTicks).toBe(pattern.lengthTicks)
    expect(stepCount(finer)).toBe(32)
  })
})

describe("Layers", () => {
  it("lets several instruments share one time position", () => {
    const { pattern, piano, violin } = patternWithLayers()
    const a = addNote(pattern, piano, { startTick: 0, noteNumber: 60 }).pattern
    const b = addNote(a, violin, { startTick: 0, noteNumber: 64 }).pattern
    const events = collectPatternEvents(b, 0, 1)
    expect(events).toHaveLength(2)
    expect(events.map((e) => e.note.noteNumber).sort()).toEqual([60, 64])
  })

  it("supports polyphony inside one layer", () => {
    const { pattern, piano } = patternWithLayers()
    const chord = [60, 64, 67].reduce(
      (p, noteNumber) =>
        addNote(p, piano, { startTick: 0, noteNumber }).pattern,
      pattern,
    )
    expect(collectPatternEvents(chord, 0, 1)).toHaveLength(3)
  })

  it("visibility does not change the stored notes", () => {
    const { pattern, piano } = patternWithLayers()
    const withNote = addNote(pattern, piano, {
      startTick: 0,
      noteNumber: 60,
    }).pattern
    const hidden = toggleLayerFlag(withNote, piano, "visible")
    expect(hidden.trackLayers[0].visible).toBe(false)
    expect(noteCount(hidden)).toBe(1)
    expect(collectPatternEvents(hidden, 0, 1)).toHaveLength(1)
    const shown = toggleLayerFlag(hidden, piano, "visible")
    expect(shown.trackLayers[0].visible).toBe(true)
  })

  it("edits only touch the addressed layer", () => {
    const { pattern, piano, violin } = patternWithLayers()
    const withPiano = addNote(pattern, piano, {
      startTick: 0,
      noteNumber: 60,
    }).pattern
    const withViolin = addNote(withPiano, violin, {
      startTick: 0,
      noteNumber: 72,
    }).pattern
    const noteId = withViolin.trackLayers[1].notes[0].id
    const moved = moveNote(withViolin, violin, noteId, 240, 2)
    expect(moved.trackLayers[0].notes[0]).toEqual(
      withPiano.trackLayers[0].notes[0],
    )
    expect(moved.trackLayers[1].notes[0].noteNumber).toBe(74)
  })

  it("lock prevents accidental changes", () => {
    const { pattern, piano } = patternWithLayers()
    const withNote = addNote(pattern, piano, {
      startTick: 0,
      noteNumber: 60,
    }).pattern
    const locked = toggleLayerFlag(withNote, piano, "locked")
    const noteId = locked.trackLayers[0].notes[0].id

    expect(
      addNote(locked, piano, { startTick: 240, noteNumber: 62 }).noteId,
    ).toBeNull()
    expect(moveNote(locked, piano, noteId, 240, 0)).toBe(locked)
    expect(removeNote(locked, piano, noteId)).toBe(locked)
    expect(noteCount(locked)).toBe(1)
  })

  it("mute and solo decide what sounds, without deleting anything", () => {
    const { pattern, piano, violin } = patternWithLayers()
    let p = addNote(pattern, piano, { startTick: 0, noteNumber: 60 }).pattern
    p = addNote(p, violin, { startTick: 0, noteNumber: 64 }).pattern

    const muted = toggleLayerFlag(p, piano, "muted")
    expect(audibleLayers(muted).map((l) => l.id)).toEqual([violin])
    expect(collectPatternEvents(muted, 0, 1)).toHaveLength(1)

    const soloed = toggleLayerFlag(p, piano, "soloed")
    expect(audibleLayers(soloed).map((l) => l.id)).toEqual([piano])
    expect(noteCount(soloed)).toBe(2)
  })

  it("applies layer transposition on playback", () => {
    const { pattern, piano } = patternWithLayers()
    const p = updateLayer(
      addNote(pattern, piano, { startTick: 0, noteNumber: 60 }).pattern,
      piano,
      { transpose: -12 },
    )
    const [event] = collectPatternEvents(p, 0, 1)
    expect(noteNumberFor(event.layer, event.note)).toBe(48)
  })
})

describe("Notes", () => {
  it("adds, moves, resizes, repitches and deletes", () => {
    const { pattern, piano } = patternWithLayers()
    const step = gridTicks(pattern)
    const added = addNote(pattern, piano, {
      startTick: step,
      noteNumber: 60,
      durationTicks: step,
    })
    const noteId = added.noteId as string
    expect(noteId).not.toBeNull()

    const moved = moveNote(added.pattern, piano, noteId, step, 0)
    expect(moved.trackLayers[0].notes[0].startTick).toBe(step * 2)

    const longer = resizeNote(moved, piano, noteId, step * 4)
    expect(longer.trackLayers[0].notes[0].durationTicks).toBe(step * 4)

    const shorter = resizeNote(longer, piano, noteId, step)
    expect(shorter.trackLayers[0].notes[0].durationTicks).toBe(step)

    const repitched = setNotePitch(shorter, piano, noteId, 67)
    expect(repitched.trackLayers[0].notes[0].noteNumber).toBe(67)

    expect(noteCount(removeNote(repitched, piano, noteId))).toBe(0)
  })

  it("resizing from the left keeps the note end fixed", () => {
    const { pattern, piano } = patternWithLayers()
    const step = gridTicks(pattern)
    const { pattern: p, noteId } = addNote(pattern, piano, {
      startTick: step * 4,
      durationTicks: step * 4,
      noteNumber: 60,
    })
    const resized = resizeNoteStart(p, piano, noteId as string, step * 2)
    const note = resized.trackLayers[0].notes[0]
    expect(note.startTick).toBe(step * 2)
    expect(note.startTick + note.durationTicks).toBe(step * 8)
  })

  it("keeps notes that run across bar lines", () => {
    const { pattern, piano } = patternWithLayers()
    const { pattern: p } = addNote(pattern, piano, {
      startTick: TIMEBASE * 3,
      durationTicks: TIMEBASE * 4,
      noteNumber: 60,
    })
    expect(p.trackLayers[0].notes[0].durationTicks).toBe(TIMEBASE * 4)
  })

  it("never produces zero-length notes", () => {
    const { pattern, piano } = patternWithLayers()
    const { pattern: p, noteId } = addNote(pattern, piano, {
      startTick: 0,
      noteNumber: 60,
    })
    const squashed = resizeNote(p, piano, noteId as string, 0)
    expect(squashed.trackLayers[0].notes[0].durationTicks).toBeGreaterThan(0)
  })

  it("quantizes a layer onto the grid", () => {
    const { pattern, piano } = patternWithLayers()
    const step = gridTicks(pattern)
    const { pattern: p } = addNote(pattern, piano, {
      startTick: step + 7,
      durationTicks: step + 11,
      noteNumber: 60,
    })
    const quantized = quantizeLayer(p, piano, { lengths: true })
    const note = quantized.trackLayers[0].notes[0]
    expect(note.startTick % step).toBe(0)
    expect(note.durationTicks % step).toBe(0)
  })
})

describe("Undo and redo", () => {
  it("covers every editing step", () => {
    const { pattern, piano } = patternWithLayers()
    let history = createHistory(pattern)
    expect(canUndo(history)).toBe(false)

    const added = addNote(pattern, piano, { startTick: 0, noteNumber: 60 })
    history = pushHistory(history, added.pattern)
    history = pushHistory(
      history,
      moveNote(added.pattern, piano, added.noteId as string, 240, 0),
    )
    expect(noteCount(history.present)).toBe(1)
    expect(history.present.trackLayers[0].notes[0].startTick).toBe(240)

    history = undo(history)
    expect(history.present.trackLayers[0].notes[0].startTick).toBe(0)
    history = undo(history)
    expect(noteCount(history.present)).toBe(0)
    expect(canUndo(history)).toBe(false)

    history = redo(history)
    expect(noteCount(history.present)).toBe(1)
    expect(canRedo(history)).toBe(true)
    history = redo(history)
    expect(history.present.trackLayers[0].notes[0].startTick).toBe(240)
    expect(canRedo(history)).toBe(false)
  })

  it("drops the redo branch after a new edit", () => {
    const { pattern, piano } = patternWithLayers()
    let history = createHistory(pattern)
    history = pushHistory(
      history,
      addNote(pattern, piano, { startTick: 0, noteNumber: 60 }).pattern,
    )
    history = undo(history)
    history = pushHistory(
      history,
      addNote(history.present, piano, { startTick: 480, noteNumber: 72 })
        .pattern,
    )
    expect(canRedo(history)).toBe(false)
    expect(history.present.trackLayers[0].notes[0].noteNumber).toBe(72)
  })
})

describe("Envelopes", () => {
  it("stores normalized points", () => {
    const envelope = normalizeEnvelope({
      preset: "custom",
      curve: 4,
      points: [
        { t: 0.5, v: 2 },
        { t: -1, v: -3 },
      ],
    })
    expect(envelope.curve).toBe(1)
    for (const point of envelope.points) {
      expect(point.t).toBeGreaterThanOrEqual(0)
      expect(point.t).toBeLessThanOrEqual(1)
      expect(point.v).toBeGreaterThanOrEqual(0)
      expect(point.v).toBeLessThanOrEqual(1)
    }
    expect(envelope.points[0].t).toBe(0)
    expect(envelope.points[envelope.points.length - 1].t).toBe(1)
  })

  it("fade-in rises and fade-out falls", () => {
    const fadeIn = createEnvelope("fade-in")
    expect(sampleEnvelope(fadeIn, 0)).toBeCloseTo(0)
    expect(sampleEnvelope(fadeIn, 1)).toBeCloseTo(1)
    expect(sampleEnvelope(fadeIn, 0.5)).toBeGreaterThan(0)
    expect(sampleEnvelope(fadeIn, 0.5)).toBeLessThan(1)

    const fadeOut = createEnvelope("fade-out")
    expect(sampleEnvelope(fadeOut, 0)).toBeCloseTo(1)
    expect(sampleEnvelope(fadeOut, 1)).toBeCloseTo(0)
  })

  it("moving a point keeps the envelope valid and marks it custom", () => {
    const moved = moveEnvelopePoint(createEnvelope("swell"), 1, 0.4, 0.2)
    expect(moved.preset).toBe("custom")
    expect(moved.points[1].t).toBeCloseTo(0.4)
    expect(moved.points[1].v).toBeCloseTo(0.2)
    expect(moved.points[0].t).toBe(0)
  })

  it("adapts to a changed event duration because it is relative", () => {
    const { pattern, piano } = patternWithLayers()
    const { pattern: withNote, noteId } = addNote(pattern, piano, {
      startTick: 0,
      durationTicks: 480,
      noteNumber: 60,
    })
    const shaped = setNoteEnvelope(
      withNote,
      piano,
      noteId as string,
      "volumeEnvelope",
      createEnvelope("fade-in"),
    )
    const short = collectPatternEvents(shaped, 0, 1)[0]
    const shortSteps = envelopeSteps(short, "volumeEnvelope")

    const longer = resizeNote(shaped, piano, noteId as string, 1920)
    const long = collectPatternEvents(longer, 0, 1)[0]
    const longSteps = envelopeSteps(long, "volumeEnvelope")

    expect(shortSteps.map((s) => s.value)).toEqual(
      longSteps.map((s) => s.value),
    )
    expect(longSteps[longSteps.length - 1].tick).toBe(1920)
    expect(shortSteps[shortSteps.length - 1].tick).toBe(480)
  })

  it("produces controller steps that actually rise for a fade-in", () => {
    const { pattern, piano } = patternWithLayers()
    const { pattern: withNote, noteId } = addNote(pattern, piano, {
      startTick: 0,
      durationTicks: 960,
      noteNumber: 60,
    })
    const shaped = setNoteEnvelope(
      withNote,
      piano,
      noteId as string,
      "volumeEnvelope",
      createEnvelope("fade-in"),
    )
    const steps = envelopeSteps(
      collectPatternEvents(shaped, 0, 1)[0],
      "volumeEnvelope",
    )
    expect(steps[0].value).toBeLessThan(20)
    expect(steps[steps.length - 1].value).toBeGreaterThan(120)
    expect(steps.every((s) => s.value >= 0 && s.value <= 127)).toBe(true)
  })

  it("notes without an envelope schedule no controller traffic", () => {
    const { pattern, piano } = patternWithLayers()
    const p = addNote(pattern, piano, { startTick: 0, noteNumber: 60 }).pattern
    expect(
      envelopeSteps(collectPatternEvents(p, 0, 1)[0], "volumeEnvelope"),
    ).toEqual([])
  })

  it("expression shapes the attack velocity", () => {
    const { pattern, piano } = patternWithLayers()
    const { pattern: withNote, noteId } = addNote(pattern, piano, {
      startTick: 0,
      noteNumber: 60,
      velocity: 100,
    })
    const soft = setNoteEnvelope(
      withNote,
      piano,
      noteId as string,
      "expressionEnvelope",
      createEnvelope("fade-in"),
    )
    const plain = effectiveVelocity(collectPatternEvents(withNote, 0, 1)[0])
    const shaped = effectiveVelocity(collectPatternEvents(soft, 0, 1)[0])
    expect(shaped).toBeLessThan(plain)
    expect(shaped).toBeGreaterThan(0)
  })

  it("reports the peak for one-shot destinations", () => {
    expect(envelopePeak(createEnvelope("direct"))).toBeCloseTo(1)
    expect(envelopePeak(createEnvelope("fade-out"))).toBeCloseTo(1)
    expect(sampleEnvelopeCurve(createEnvelope("direct"), 5)).toHaveLength(5)
  })
})

describe("Playback model", () => {
  it("respects the end marker while looping", () => {
    const { pattern, piano } = patternWithLayers()
    const step = gridTicks(pattern)
    let p = addNote(pattern, piano, { startTick: 0, noteNumber: 60 }).pattern
    p = addNote(p, piano, { startTick: step * 12, noteNumber: 64 }).pattern
    p = setPatternSteps(p, 8)

    const wholeLoop = collectPatternEvents(p, 0, p.lengthTicks)
    expect(wholeLoop).toHaveLength(1)
    expect(wholeLoop[0].note.noteNumber).toBe(60)
  })

  it("clips a held note at the pattern end", () => {
    const { pattern, piano } = patternWithLayers()
    const step = gridTicks(pattern)
    let p = addNote(pattern, piano, {
      startTick: step * 6,
      durationTicks: step * 16,
      noteNumber: 60,
    }).pattern
    p = setPatternSteps(p, 8)
    const [event] = collectPatternEvents(p, 0, p.lengthTicks)
    expect(event.durationTicks).toBe(step * 2)
    expect(event.note.durationTicks).toBe(step * 16)
  })

  it("returns events sorted by start tick", () => {
    const { pattern, piano, violin } = patternWithLayers()
    let p = addNote(pattern, piano, { startTick: 480, noteNumber: 60 }).pattern
    p = addNote(p, violin, { startTick: 120, noteNumber: 64 }).pattern
    const events = collectPatternEvents(p, 0, 960)
    expect(events.map((e) => e.startTick)).toEqual([120, 480])
  })
})

describe("Song Maker migration", () => {
  it("turns melody cells into a melodic layer and drums into their own layers", () => {
    const legacy = createEmptySongMakerPattern()
    legacy.melody[0][0] = true // top row, first step
    legacy.melody[13][4] = true // bottom row
    legacy.drums[0][0] = true // kick
    legacy.drums[1][8] = true // snare

    const pattern = songMakerPatternToMusePattern(legacy, {
      timebase: TIMEBASE,
    })

    expect(stepCount(pattern)).toBe(16)
    const melodic = pattern.trackLayers.filter((l) => l.kind === "melodic")
    const percussion = pattern.trackLayers.filter(
      (l) => l.kind === "percussion",
    )
    expect(melodic).toHaveLength(1)
    expect(melodic[0].notes).toHaveLength(2)
    expect(percussion.map((l) => l.drumZoneId)).toEqual(["kick", "snare"])
    expect(percussion[0].notes[0].startTick).toBe(0)
    expect(percussion[1].notes[0].startTick).toBe(8 * gridTicks(pattern))
  })

  it("keeps empty drum rows out of the layer rail", () => {
    const pattern = songMakerPatternToMusePattern(createEmptySongMakerPattern())
    expect(
      pattern.trackLayers.filter((l) => l.kind === "percussion"),
    ).toHaveLength(0)
  })
})
