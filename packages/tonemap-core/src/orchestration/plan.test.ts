import { describe, expect, it } from "vitest"
import { midiToGraph } from "../midi/eventGraph.ts"
import { buildMidiFile, syntheticMotifMidi } from "../midi/synthetic.ts"
import { buildMotifGraph } from "../motifs/motifGraph.ts"
import {
  addDirection,
  assignInstrument,
  checkVoiceCrossing,
  createPlanFromGraph,
  doublePart,
  duplicatePart,
  extractMotif,
  melodyHandoff,
  setArticulation,
  setProminence,
  splitChord,
  transposePart,
  undoLastOperation,
} from "./plan.ts"

const graph = midiToGraph(syntheticMotifMidi())
const motifGraph = buildMotifGraph(graph)

function freshPlan() {
  return createPlanFromGraph(graph, motifGraph, { toneMapProjectId: "p1" })
}

describe("Plan creation", () => {
  it("starts with one part per voice and no operations", () => {
    const plan = freshPlan()
    expect(plan.parts.length).toBe(motifGraph.voices.length)
    expect(plan.operations).toHaveLength(0)
    expect(plan.parts[0].notes.length).toBeGreaterThan(0)
  })

  it("keeps a reference to the source notes", () => {
    const plan = freshPlan()
    expect(plan.parts[0].notes[0].sourceNoteId).toBeDefined()
  })
})

describe("Non-destructive transformations", () => {
  it("duplicates a part without touching the original", () => {
    const plan = freshPlan()
    const before = plan.parts[0].notes.map((note) => note.noteNumber)
    const next = duplicatePart(plan, plan.parts[0].id, { instrument: "cello" })

    expect(next.parts).toHaveLength(plan.parts.length + 1)
    expect(next.parts[0].notes.map((note) => note.noteNumber)).toEqual(before)
    expect(next.operations[0].kind).toBe("duplicate-voice")
    expect(next.operations[0].reason).toBeTruthy()
  })

  it("adds an octave doubling as its own part", () => {
    const plan = freshPlan()
    const source = plan.parts[0]
    const next = doublePart(plan, source.id, { semitones: -12 })
    const copy = next.parts[next.parts.length - 1]

    expect(copy.notes.map((note) => note.noteNumber)).toEqual(
      source.notes.map((note) => note.noteNumber - 12),
    )
    expect(next.parts[0].notes.map((n) => n.noteNumber)).toEqual(
      source.notes.map((n) => n.noteNumber),
    )
  })

  it("transposes a register and records the reason", () => {
    const plan = freshPlan()
    const partId = plan.parts[0].id
    const next = transposePart(plan, partId, 12, { reason: "an octave up" })
    expect(next.parts[0].notes[0].noteNumber).toBe(
      plan.parts[0].notes[0].noteNumber + 12,
    )
    expect(next.operations[0].parameters).toMatchObject({ semitones: 12 })
    expect(next.operations[0].reason).toBe("an octave up")
  })

  it("extracts a motif into a separate part", () => {
    const plan = freshPlan()
    const motif = motifGraph.motifs[0]
    const next = extractMotif(plan, motifGraph, motif.id, { label: "Theme" })
    const part = next.parts[next.parts.length - 1]

    expect(part.sourceMotifId).toBe(motif.id)
    expect(part.notes.length).toBeGreaterThan(0)
    expect(part.notes.length).toBeLessThan(plan.parts[0].notes.length + 1)
  })

  it("hands the melody over at a given tick", () => {
    const plan = freshPlan()
    const source = plan.parts.find((part) => part.notes.length > 4)!
    const splitTick = source.notes[2].startTick
    const next = melodyHandoff(plan, source.id, splitTick, {
      instrument: "horn",
    })

    const kept = next.parts.find((part) => part.id === source.id)!
    const receiver = next.parts[next.parts.length - 1]
    expect(kept.notes.every((note) => note.startTick < splitTick)).toBe(true)
    expect(receiver.notes.every((note) => note.startTick >= splitTick)).toBe(
      true,
    )
    expect(kept.notes.length + receiver.notes.length).toBe(source.notes.length)
    expect(receiver.instrument).toBe("horn")
  })

  it("splits a chord across voices", () => {
    const bytes = buildMidiFile({
      tracks: [
        [
          {
            tick: 0,
            event: {
              type: "noteOn",
              channel: 0,
              noteNumber: 60,
              velocity: 90,
            } as never,
          },
          {
            tick: 0,
            event: {
              type: "noteOn",
              channel: 0,
              noteNumber: 64,
              velocity: 90,
            } as never,
          },
          {
            tick: 0,
            event: {
              type: "noteOn",
              channel: 0,
              noteNumber: 67,
              velocity: 90,
            } as never,
          },
          {
            tick: 480,
            event: {
              type: "noteOff",
              channel: 0,
              noteNumber: 60,
              velocity: 0,
            } as never,
          },
          {
            tick: 480,
            event: {
              type: "noteOff",
              channel: 0,
              noteNumber: 64,
              velocity: 0,
            } as never,
          },
          {
            tick: 480,
            event: {
              type: "noteOff",
              channel: 0,
              noteNumber: 67,
              velocity: 0,
            } as never,
          },
        ],
      ],
    })
    const chordGraph = midiToGraph(bytes)
    const chordMotifs = buildMotifGraph(chordGraph)
    let plan = createPlanFromGraph(chordGraph, chordMotifs, {
      toneMapProjectId: "p",
    })
    // merge everything into one part first
    const merged = {
      ...plan.parts[0],
      notes: plan.parts.flatMap((part) => part.notes),
    }
    plan = { ...plan, parts: [merged] }

    const next = splitChord(plan, merged.id, 3)
    expect(next.parts).toHaveLength(3)
    expect(next.parts[0].notes[0].noteNumber).toBe(60)
    expect(next.parts[2].notes[0].noteNumber).toBe(67)
  })

  it("stores prominence and articulation directions on a part", () => {
    const plan = freshPlan()
    const partId = plan.parts[0].id
    let next = setProminence(plan, partId, 0.85)
    next = setArticulation(next, partId, "legato")
    const part = next.parts.find((entry) => entry.id === partId)!
    expect(part.prominence).toBe(0.85)
    expect(part.articulation).toBe("legato")
  })

  it("accepts a prominence envelope", () => {
    const plan = freshPlan()
    const next = setProminence(plan, plan.parts[0].id, {
      points: [
        { tick: 0, value: 0.2 },
        { tick: 1920, value: 0.9 },
      ],
    })
    const part = next.parts[0]
    expect(typeof part.prominence).toBe("object")
    expect((part.prominence as { points: unknown[] }).points).toHaveLength(2)
  })
})

describe("Warnings", () => {
  it("warns about notes outside the instrument range", () => {
    const plan = freshPlan()
    const next = assignInstrument(
      plan,
      plan.parts[0].id,
      { instrument: "piccolo" },
      { range: { lowMidi: 74, highMidi: 108 } },
    )
    expect(
      next.warnings.some((warning) => warning.code === "out-of-range"),
    ).toBe(true)
  })

  it("warns about an uncomfortable register", () => {
    const plan = freshPlan()
    const melodic = plan.parts.find((part) => part.notes[0].noteNumber > 55)!
    const next = assignInstrument(
      plan,
      melodic.id,
      { instrument: "cello" },
      {
        range: {
          lowMidi: 36,
          highMidi: 84,
          preferredLowMidi: 36,
          preferredHighMidi: 60,
        },
      },
    )
    expect(
      next.warnings.some((warning) => warning.code === "extreme-register"),
    ).toBe(true)
  })

  it("warns about voice crossing", () => {
    const plan = freshPlan()
    const upper = plan.parts.find((part) => part.notes[0].noteNumber > 55)!
    const lower = plan.parts.find((part) => part.id !== upper.id)!
    const raised = transposePart(plan, lower.id, 36)
    const checked = checkVoiceCrossing(raised, upper.id, lower.id)
    expect(
      checked.warnings.some((warning) => warning.code === "voice-crossing"),
    ).toBe(true)
  })

  it("warns instead of throwing for an unknown part", () => {
    const plan = duplicatePart(freshPlan(), "does-not-exist")
    expect(plan.warnings[0].code).toBe("missing-source")
    expect(plan.operations).toHaveLength(0)
  })
})

describe("Undo", () => {
  it("removes a part created by an operation", () => {
    const plan = freshPlan()
    const next = duplicatePart(plan, plan.parts[0].id)
    const undone = undoLastOperation(next)
    expect(undone.parts).toHaveLength(plan.parts.length)
    expect(undone.operations).toHaveLength(0)
  })

  it("restores note values after a transposition", () => {
    const plan = freshPlan()
    const before = plan.parts[0].notes.map((note) => note.noteNumber)
    const next = transposePart(plan, plan.parts[0].id, 7)
    const undone = undoLastOperation(next)
    expect(undone.parts[0].notes.map((note) => note.noteNumber)).toEqual(before)
  })

  it("restores a part after a handoff", () => {
    const plan = freshPlan()
    const source = plan.parts.find((part) => part.notes.length > 4)!
    const next = melodyHandoff(plan, source.id, source.notes[2].startTick, {})
    const undone = undoLastOperation(next)
    const restored = undone.parts.find((part) => part.id === source.id)!
    expect(restored.notes).toHaveLength(source.notes.length)
    expect(undone.parts).toHaveLength(plan.parts.length)
  })

  it("restores the original part after a chord split", () => {
    const plan = freshPlan()
    const partId = plan.parts[0].id
    const noteCount = plan.parts[0].notes.length
    const next = splitChord(plan, partId, 2)
    const undone = undoLastOperation(next)
    const restored = undone.parts.find((part) => part.id === partId)
    expect(restored?.notes).toHaveLength(noteCount)
  })

  it("never modifies the source MIDI graph", () => {
    const before = JSON.stringify(graph.notes)
    const plan = freshPlan()
    transposePart(doublePart(plan, plan.parts[0].id), plan.parts[0].id, 12)
    expect(JSON.stringify(graph.notes)).toBe(before)
  })
})

describe("Motif directions", () => {
  it("stores a precise direction", () => {
    const plan = addDirection(freshPlan(), {
      motifId: motifGraph.motifs[0].id,
      trigger: { type: "time", startBeat: 64 },
      preserve: { identity: true, rhythm: true },
      prominence: 0.85,
      register: { octaveShift: -1 },
      instrumentation: { family: "strings", instrument: "cello" },
      articulation: { articulation: "legato" },
      mix: { loudnessTargetDb: -4 },
    })
    expect(plan.directions).toHaveLength(1)
    expect(plan.directions[0].instrumentation?.instrument).toBe("cello")
    expect(plan.directions[0].provenance.status).toBe("manually-confirmed")
  })

  it("keeps a vague instruction verbatim", () => {
    const text =
      "Das bisher übersehene Motiv soll plötzlich wichtig wirken: warm, etwas zu groß und leicht peinlich."
    const plan = addDirection(freshPlan(), {
      motifId: motifGraph.motifs[0].id,
      trigger: { type: "dramatic-event", event: "guybrush-enters" },
      preserve: { identity: true },
      freeTextIntent: text,
      emotionalIntent: {
        axes: { dignity: 0.7, comedy: 0.6 },
        tags: ["unangenehm würdevoll"],
      },
    })
    expect(plan.directions[0].freeTextIntent).toBe(text)
    expect(plan.directions[0].emotionalIntent?.tags).toContain(
      "unangenehm würdevoll",
    )
  })
})
