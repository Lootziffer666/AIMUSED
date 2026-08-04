import { describe, expect, it } from "vitest"
import { midiToGraph } from "../midi/eventGraph.ts"
import { buildMidiFile, syntheticMotifMidi } from "../midi/synthetic.ts"
import {
  buildMotifGraph,
  detectMotifs,
  extractPhrases,
  extractVoices,
  stableHash,
} from "./motifGraph.ts"

function note(
  tick: number,
  duration: number,
  channel: number,
  noteNumber: number,
  velocity = 90,
) {
  return [
    { tick, event: { type: "noteOn", channel, noteNumber, velocity } as never },
    {
      tick: tick + duration,
      event: { type: "noteOff", channel, noteNumber, velocity: 0 } as never,
    },
  ]
}

const graph = midiToGraph(syntheticMotifMidi())

describe("Voice extraction", () => {
  it("separates channels into voices", () => {
    const voices = extractVoices(graph)
    expect(voices.length).toBeGreaterThanOrEqual(2)
    const channels = new Set(voices.map((voice) => voice.channel))
    expect(channels.has(0)).toBe(true)
    expect(channels.has(1)).toBe(true)
  })

  it("splits a polyphonic track into voices, lowest first", () => {
    const bytes = buildMidiFile({
      tracks: [
        [
          ...note(0, 480, 0, 60),
          ...note(0, 480, 0, 64),
          ...note(0, 480, 0, 67),
          ...note(480, 480, 0, 62),
          ...note(480, 480, 0, 65),
          ...note(480, 480, 0, 69),
        ],
      ],
    })
    const voices = extractVoices(midiToGraph(bytes))
    expect(voices).toHaveLength(3)
    expect(voices[0].notes[0].noteNumber).toBeLessThan(
      voices[2].notes[0].noteNumber,
    )
    expect(voices.every((voice) => voice.notes.length === 2)).toBe(true)
    expect(voices[0].isMonophonic).toBe(false)
  })

  it("gives every voice a stable id", () => {
    const first = extractVoices(graph).map((voice) => voice.id)
    const second = extractVoices(midiToGraph(syntheticMotifMidi())).map(
      (v) => v.id,
    )
    expect(second).toEqual(first)
  })
})

describe("Phrase detection", () => {
  it("cuts at rests", () => {
    const bytes = buildMidiFile({
      tracks: [
        [
          ...note(0, 240, 0, 60),
          ...note(240, 240, 0, 62),
          // one beat of rest
          ...note(960, 240, 0, 64),
          ...note(1200, 240, 0, 65),
        ],
      ],
    })
    const inner = midiToGraph(bytes)
    const voices = extractVoices(inner)
    const phrases = extractPhrases(voices[0], inner.ticksPerQuarterNote)
    expect(phrases).toHaveLength(2)
    expect(phrases[0].boundary).toBe("rest")
    expect(phrases[0].noteIds).toHaveLength(2)
    expect(phrases[1].startTick).toBe(960)
  })

  it("keeps a continuous line as one phrase", () => {
    const voices = extractVoices(graph)
    const melody = voices.find((voice) => voice.channel === 0)
    const phrases = extractPhrases(melody!, graph.ticksPerQuarterNote)
    expect(phrases.length).toBeGreaterThanOrEqual(1)
    expect(phrases[0].noteIds.length).toBeGreaterThanOrEqual(4)
  })
})

describe("Motif detection", () => {
  it("finds a motif that repeats transposed", () => {
    const motifs = detectMotifs(extractVoices(graph))
    const transposed = motifs.find((motif) =>
      motif.occurrences.some((occurrence) => occurrence.transposition !== 0),
    )
    expect(transposed).toBeDefined()
    expect(transposed!.occurrences.length).toBeGreaterThanOrEqual(2)
    // the fixture repeats the motif a fifth up
    expect(
      transposed!.occurrences.map((occurrence) => occurrence.transposition),
    ).toContain(7)
  })

  it("identifies a motif independently of track, instrument and octave", () => {
    // same shape, different channel and two octaves lower
    const shape = [0, 2, 4, 7]
    const events = [
      ...shape.flatMap((step, index) => note(index * 480, 400, 0, 72 + step)),
      ...shape.flatMap((step, index) =>
        note(2400 + index * 480, 400, 5, 48 + step),
      ),
    ]
    const inner = midiToGraph(buildMidiFile({ tracks: [events] }))
    const motifs = detectMotifs(extractVoices(inner))
    const motif = motifs.find((m) => m.occurrences.length >= 2)
    expect(motif).toBeDefined()
    const voiceIds = new Set(motif!.occurrences.map((o) => o.voiceId))
    expect(voiceIds.size).toBe(2)
    expect(motif!.occurrences.map((o) => o.transposition)).toContain(-24)
  })

  it("produces the same motif ids for the same input", () => {
    const a = detectMotifs(extractVoices(graph)).map((motif) => motif.id)
    const b = detectMotifs(
      extractVoices(midiToGraph(syntheticMotifMidi())),
    ).map((motif) => motif.id)
    expect(b).toEqual(a)
    expect(a.every((id) => id.startsWith("m-"))).toBe(true)
  })

  it("ignores a static repeated pitch as a motif", () => {
    const events = Array.from({ length: 8 }, (_, i) =>
      note(i * 480, 400, 0, 60),
    ).flat()
    const motifs = detectMotifs(
      extractVoices(midiToGraph(buildMidiFile({ tracks: [events] }))),
    )
    expect(motifs).toHaveLength(0)
  })

  it("hashes deterministically", () => {
    expect(stableHash("0,2,4|1,1,1")).toBe(stableHash("0,2,4|1,1,1"))
    expect(stableHash("0,2,4|1,1,1")).not.toBe(stableHash("0,2,5|1,1,1"))
  })
})

describe("Relations between voices", () => {
  it("finds an octave doubling", () => {
    const events = [
      ...[0, 2, 4, 7].flatMap((step, index) =>
        note(index * 480, 400, 0, 60 + step),
      ),
      ...[0, 2, 4, 7].flatMap((step, index) =>
        note(index * 480, 400, 1, 72 + step),
      ),
    ]
    const inner = midiToGraph(buildMidiFile({ tracks: [events] }))
    const relations = buildMotifGraph(inner).relations
    expect(
      relations.some((relation) => relation.kind === "octave-doubling"),
    ).toBe(true)
  })

  it("finds a unison doubling", () => {
    const events = [
      ...[0, 3, 5].flatMap((step, index) =>
        note(index * 480, 400, 0, 60 + step),
      ),
      ...[0, 3, 5].flatMap((step, index) =>
        note(index * 480, 400, 2, 60 + step),
      ),
    ]
    const inner = midiToGraph(buildMidiFile({ tracks: [events] }))
    const relations = buildMotifGraph(inner).relations
    expect(
      relations.some((relation) => relation.kind === "unison-doubling"),
    ).toBe(true)
  })

  it("finds call and response", () => {
    const events = [
      ...[0, 2, 4].flatMap((step, index) =>
        note(index * 480, 400, 0, 67 + step),
      ),
      ...[0, -2, -4].flatMap((step, index) =>
        note(1920 + index * 480, 400, 1, 72 + step),
      ),
    ]
    const inner = midiToGraph(buildMidiFile({ tracks: [events] }))
    const relations = buildMotifGraph(inner).relations
    expect(
      relations.some((relation) => relation.kind === "call-and-response"),
    ).toBe(true)
  })

  it("finds an ostinato and a bass figure", () => {
    const pattern = [36, 43, 36, 43, 36, 43, 36, 43]
    const events = pattern.flatMap((pitch, index) =>
      note(index * 240, 200, 1, pitch),
    )
    const inner = midiToGraph(buildMidiFile({ tracks: [events] }))
    const relations = buildMotifGraph(inner).relations
    expect(relations.some((relation) => relation.kind === "ostinato")).toBe(
      true,
    )
    expect(relations.some((relation) => relation.kind === "bass-figure")).toBe(
      true,
    )
  })
})

describe("Full graph", () => {
  it("returns voices, phrases, motifs and relations together", () => {
    const result = buildMotifGraph(graph)
    expect(result.voices.length).toBeGreaterThan(0)
    expect(result.phrases.length).toBeGreaterThan(0)
    expect(result.motifs.length).toBeGreaterThan(0)
    expect(Array.isArray(result.relations)).toBe(true)
  })
})
